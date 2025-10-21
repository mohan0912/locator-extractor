#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// --------------------------------------
// 🔹 Utility helpers
// --------------------------------------
function log(level, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${level}] ${msg}`);
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function deduplicate(arr) {
  const seen = new Set();
  return arr.filter((a) => {
    const key = `${a.tag}|${a.id}|${a.name}|${a.class}|${a.css}|${a.xpath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --------------------------------------
// 🔹 Config Loader
// --------------------------------------
function loadConfig() {
  const configPath = path.resolve("config.json");
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      log("INFO", "Loaded config.json successfully.");
      return cfg;
    } catch (err) {
      log("WARN", `Invalid config.json: ${err.message}`);
    }
  }
  return {};
}

// --------------------------------------
// 🔹 Prompt builder (multi-framework)
// --------------------------------------
function buildPrompt(payload, framework = "playwright", promptType = "locator", automationFramework = "", customExample = "") {
  const json = JSON.stringify(payload, null, 2);

  if (framework === "custom" && customExample) {
    return `You are writing code for a custom test framework.
Example of element definition:
${customExample}

Given this element:
${json}

Generate ${promptType} code following the same pattern.`;
  }

  if (framework === "selenium") {
    if (promptType === "action") {
      return `You are writing a Selenium WebDriver (Java) test step.
Given this element:
${json}

Write a single Java step that interacts with the element and includes a verification.`;
    }
    if (promptType === "assertion") {
      return `You are writing a Selenium WebDriver (Java) assertion.
Given this element:
${json}

Write a Java assertion verifying visibility or state.`;
    }
    return `You are an automation expert using Selenium WebDriver (Java).
Generate the most stable locator using By.id, By.name, By.cssSelector, or By.xpath.

Element details:
${json}

Return only the Java locator statement.`;
  }

  if (framework === "playwright") {
    if (promptType === "action") {
      return `You are writing an automation step in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write one Playwright line that interacts with the element and includes a simple verification.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write a Playwright assertion checking visibility or text.`;
    }
    return `You are an automation expert using Playwright.
Generate the most stable locator using page.getByRole, page.getByTestId, or page.locator.

Element details:
${json}

Return only the Playwright locator statement.`;
  }

  if (framework === "cypress") {
    return `You are an automation expert using Cypress (JavaScript).
Generate the most stable Cypress locator using cy.get(), cy.contains(), or cy.xpath().

Element details:
${json}`;
  }

  if (framework === "robot") {
    return `You are writing a Robot Framework (SeleniumLibrary) locator.
Given this element:
${json}

Return the most stable Robot locator string (id=, name=, css=, xpath=).`;
  }

  if (framework === "bdd") {
    return `You are writing a Gherkin (BDD) step.
Given this element:
${json}

Write a "Then" or "When" step describing the element interaction or verification.`;
  }

  return `You are an automation engineer using ${framework}.
Given this element:
${json}

Generate the most stable locator or action step for this framework.`;
}

// --------------------------------------
// 🔹 Capture Script
// --------------------------------------
const CAPTURE_SCRIPT = `
(function(){
  if (window.__locator_installed) return;
  window.__locator_installed = true;

  function serializeAttributes(el){
    const attrs = {};
    if(!el || !el.getAttribute) return attrs;
    for (const a of el.attributes) attrs[a.name] = a.value;
    return attrs;
  }

  function cssPath(el){
    if(!(el instanceof Element)) return '';
    const path = [];
    while (el && el.nodeType === 1) {
      let sel = el.nodeName.toLowerCase();
      if (el.id) { sel += '#' + el.id; path.unshift(sel); break; }
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling)
        if (sib.nodeName.toLowerCase() === sel) nth++;
      if (nth !== 1) sel += ':nth-of-type(' + nth + ')';
      path.unshift(sel);
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  function absoluteXPath(el){
    if(!(el instanceof Element)) return '';
    const comps = [];
    for (; el && el.nodeType === 1; el = el.parentNode) {
      let idx = 1;
      for (let sib = el.previousSibling; sib; sib = sib.previousSibling)
        if (sib.nodeType === 1 && sib.tagName === el.tagName) idx++;
      comps.unshift(el.tagName.toLowerCase() + "[" + idx + "]");
    }
    return "/" + comps.join("/");
  }

  function serializeElement(el){
    if(!el) return null;
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      name: el.getAttribute && el.getAttribute('name') || null,
      class: el.className || null,
      text: (el.innerText || "").trim().slice(0, 250),
      role: el.getAttribute && el.getAttribute('role') || null,
      ariaLabel: el.getAttribute && el.getAttribute('aria-label') || null,
      attributes: serializeAttributes(el),
      css: cssPath(el),
      xpath: absoluteXPath(el),
      visible: (function(r){
        try {
          const s = window.getComputedStyle(r);
          return !(s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'));
        } catch(e){ return true; }
      })(el)
    };
  }

  document.addEventListener('click', function(e){
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    el.style.outline = '2px solid #1e90ff';
    el.style.boxShadow = '0 0 6px 2px rgba(30,144,255,0.5)';
    console.log('ELEMENT_CAPTURED:' + JSON.stringify(serializeElement(el)));
  }, true);
})();`;

// --------------------------------------
// 🔹 Frame Injector
// --------------------------------------
async function injectIntoAllFrames(page) {
  try {
    await page.addInitScript({ content: CAPTURE_SCRIPT });
    for (const frame of page.frames()) {
      try {
        await frame.evaluate((src) => {
          if (!window.__locator_installed) {
            const s = document.createElement('script');
            s.text = src;
            document.documentElement.appendChild(s);
          }
        }, CAPTURE_SCRIPT);
      } catch {}
    }
  } catch {}
}

// --------------------------------------
// 🔹 Main Extractor
// --------------------------------------
async function runExtractor(options) {
  const {
    url,
    framework = "playwright",
    customExample = "",
    tagFilter = null,
    scanHidden = false,
    headless = false,
    outputDir = "output",
    promptType = "locator",
    timeout = 0
  } = options;

  ensureDir(outputDir);

  const browser = await chromium.launch({ headless, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const allLocators = [];
  const allPrompts = [];
  let pageCount = 0;
  let lastActivity = Date.now();
  const resetTimer = () => (lastActivity = Date.now());

  await injectIntoAllFrames(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  pageCount++;
  log("INFO", `✅ Page loaded: ${url}`);
  log("INFO", `Hold Ctrl/Cmd + Click to capture. Press Enter to stop.`);

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("ELEMENT_CAPTURED:")) {
      try {
        const raw = text.replace("ELEMENT_CAPTURED:", "");
        const payload = JSON.parse(raw);
        if (tagFilter && Array.isArray(tagFilter)) {
          const allowed = tagFilter.map((t) => t.toLowerCase());
          if (!allowed.includes(payload.tag?.toLowerCase())) return;
        }
        payload.pageUrl = page.url();
        payload.timestamp = new Date().toISOString();
        allLocators.push(payload);
        allPrompts.push(buildPrompt(payload, framework, promptType, framework, customExample));
        log("SUCCESS", `Captured <${payload.tag}>`);
        resetTimer();
      } catch (err) {
        log("WARN", `Failed to process element: ${err.message}`);
      }
    }
  });

  // Auto-timeout
  if (timeout > 0) {
    setInterval(() => {
      if (Date.now() - lastActivity > timeout * 1000) {
        log("WARN", `⏳ Timeout reached (${timeout}s inactivity). Auto-stopping.`);
        process.stdin.emit("data");
      }
    }, 2000);
  }

  await new Promise((resolve) => process.stdin.once("data", resolve));

  const unique = deduplicate(allLocators);
  const ts = getTimestamp();
  const jsonFile = path.join(outputDir, `locators_${ts}.json`);
  const txtFile = path.join(outputDir, `copilot_prompts_${framework}_${ts}.txt`);
  atomicWrite(jsonFile, JSON.stringify(unique, null, 2));
  atomicWrite(txtFile, allPrompts.join("\n\n========================\n\n"));

  log("INFO", "---------------------------------------------");
  log("INFO", `📄 Extraction Summary`);
  log("INFO", `  • Framework: ${framework}`);
  log("INFO", `  • Total pages scanned: ${pageCount}`);
  log("INFO", `  • Total elements captured: ${allLocators.length}`);
  log("INFO", `  • Unique locators saved: ${unique.length}`);
  log("INFO", `  • Prompts generated: ${allPrompts.length}`);
  log("INFO", "---------------------------------------------");
  log("SUCCESS", `💾 Locators -> ${jsonFile}`);
  log("SUCCESS", `💾 Prompts  -> ${txtFile}`);

  await browser.close();
  log("INFO", "🧹 Browser closed. Extraction complete.");
}

// --------------------------------------
// 🔹 CLI + config merge (fixed for tagFilter)
// --------------------------------------
const args = process.argv.slice(2);
const fileConfig = loadConfig();

function getArg(flag, fallback) {
  const val = args.find((a) => a.startsWith(flag + "="));
  return val ? val.split("=")[1] : fallback;
}

let tagFilterVal = getArg("--tagFilter", fileConfig.tagFilter);
if (typeof tagFilterVal === "string") {
  tagFilterVal = tagFilterVal.split(",").map((t) => t.trim()).filter(Boolean);
} else if (Array.isArray(tagFilterVal)) {
  // keep as is from config.json
} else {
  tagFilterVal = null;
}

const options = {
  url: args[0] || fileConfig.url,
  framework: getArg("--framework", fileConfig.framework || "playwright"),
  customExample: getArg("--customExample", fileConfig.customExample || ""),
  tagFilter: tagFilterVal,
  scanHidden: args.includes("--scanHidden") || fileConfig.scanHidden || false,
  headless: args.includes("--headless") || fileConfig.headless || false,
  outputDir: getArg("--outputDir", fileConfig.outputDir || "output"),
  promptType: getArg("--promptType", fileConfig.promptType || "locator"),
  timeout: parseInt(getArg("--timeout", fileConfig.timeout)) || 0
};

if (!options.url) {
  console.log("❗ URL is required. Provide it in config.json or CLI.");
  process.exit(1);
}

await runExtractor(options);
