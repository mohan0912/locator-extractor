#!/usr/bin/env node
/**
 * locator-extractor (Enterprise CLI) - Single consolidated production-grade file
 *
 * Features:
 * - Manual (Ctrl/Cmd+Click) capture + Smart Auto Extract (DOM Walker)
 * - CDP advanced metadata (optional via --useCDP)
 * - Iframe / shadow host injection
 * - Popup / new-tab handling
 * - Smart tag/attribute filtering ([attr], .class, #id, tag)
 * - Proxy support with credentials (env or CLI)
 * - Atomic writes, deduplication, visible/hidden summary
 * - Graceful shutdown and SIGINT handling
 *
 * Usage examples:
 *  node locator-extractor.js https://example.com --framework=selenium --autoExtract --useCDP
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// =========================
// Utility helpers
// =========================
function log(level, msg) {
  const colors = {
    INFO: "\x1b[36m",
    SUCCESS: "\x1b[32m",
    WARN: "\x1b[33m",
    ERROR: "\x1b[31m",
  };
  const reset = "\x1b[0m";
  const prefix = `${new Date().toLocaleTimeString()} [${level}]`;
  const color = colors[level] || "";
  console.log(`${color}${prefix} ${msg}${reset}`);
}

function getTimestamp() {
  // Matches dashboard format: 2025-10-24_04-36-44
  return new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+/, "");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function deduplicate(arr = []) {
  const seen = new Set();
  return arr.filter((item) => {
    const key = [
      item.pageUrl || "",
      item.tag || "",
      item.id || "",
      item.name || "",
      item.css || "",
      item.xpath || "",
    ].join("|").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    const allowed = ["http:", "https:"];
    if (!allowed.includes(parsed.protocol)) return false;
    // allow localhost and typical hostnames
    return parsed.hostname === "localhost" || /^[a-z0-9.-]+$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

// Mask password for logs
function mask(str) {
  if (!str) return str;
  return str.length > 4 ? str.slice(0, 2) + "..." + str.slice(-2) : "****";
}

// =========================
// Config loader
// =========================
function loadConfig() {
  const configPath = path.resolve("config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    log("INFO", "Loaded config.json successfully.");
    return parsed;
  } catch (err) {
    log("WARN", `Invalid config.json: ${err.message}`);
    return {};
  }
}

// =========================
// Proxy handling
// =========================
function getProxySettingsFrom(options = {}) {
  const proxyUrl =
    options.proxyUrl ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    null;

  if (!proxyUrl) return null;

  const proxy = { server: proxyUrl.trim() };
  if (options.proxyUser || process.env.PROXY_USER) proxy.username = options.proxyUser || process.env.PROXY_USER;
  if (options.proxyPass || process.env.PROXY_PASS) proxy.password = options.proxyPass || process.env.PROXY_PASS;
  return proxy;
}

// =========================
// CDP advanced metadata helper (ported from dashboard v2)
// =========================
async function getAdvancedMetadata(page, client, selector) {
  if (!selector || typeof selector !== "string" || selector.length === 0) return null;
  try {
    const { root } = await client.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) return null;

    const { computedStyle } = await client.send("CSS.getComputedStyleForNode", { nodeId }).catch(() => ({ computedStyle: [] }));
    const styles = {};
    if (Array.isArray(computedStyle)) for (const s of computedStyle) styles[s.name] = s.value;

    const { nodes } = await client.send("Accessibility.getPartialAXTree", { nodeId }).catch(() => ({ nodes: [] }));
    const accNode = Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : {};
    const ariaRole = accNode.role?.value || null;
    const ariaName = accNode.name?.value || null;

    const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: nodeId }).catch(() => ({ listeners: [] }));

    // bounding box can be obtained from page.evaluate separately if needed
    return {
      zIndex: styles["z-index"] || null,
      opacity: styles["opacity"] || null,
      display: styles["display"] || null,
      visibility: styles["visibility"] || null,
      pointerEvents: styles["pointer-events"] || null,
      cursor: styles["cursor"] || null,
      backgroundColor: styles["background-color"] || null,
      color: styles["color"] || null,
      font: styles["font-family"] || null,
      ariaRole,
      ariaName,
      listeners: listeners?.map(l => l.type) || [],
    };
  } catch (err) {
    return { error: err.message };
  }
}

// =========================
// Prompt builder (copied/compatible with dashboard v2)
// =========================
function buildPrompt(payload, framework = "playwright", promptType = "locator", automationFramework = "", customExample = "") {
  const json = JSON.stringify(payload, null, 2);

  // Custom framework
  if (automationFramework === "custom" && customExample) {
    if (promptType === "action") {
      return `You are writing an automation step for a **custom framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Write a single test step that interacts with this element (click/type)
and includes a brief verification following the same coding pattern.
Return only the code.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion for a **custom framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Write an assertion that validates visibility or expected state using the same style.
Return only the assertion code.`;
    }
    return `You are an automation engineer using a **custom test framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Generate the most stable locator or element definition consistent with that style.
Return only the code.`;
  }

  // Selenium (Java)
  if (framework === "selenium") {
    if (promptType === "action") {
      return `You are writing a Selenium WebDriver (Java) test step.
Given this element:
${json}

Write a single Java step that interacts with the element (click/type)
and includes a short verification. Return only the Java code.`;
    }
    if (promptType === "assertion") {
      return `You are writing a Selenium WebDriver (Java) assertion.
Given this element:
${json}

Write a Java assertion verifying visibility or expected state.
Return only the assertion code.`;
    }
    return `You are an automation expert using Selenium WebDriver (Java).
Generate the most stable locator (By.id, By.name, By.cssSelector, or By.xpath).

Element details:
${json}

Return only the Java locator statement (e.g. driver.findElement(By.cssSelector(...)));`;
  }

  // Playwright
  if (framework === "playwright") {
    if (promptType === "action") {
      return `You are writing an automation step in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write one Playwright line that interacts with the element (click/type)
and includes a simple verification. Return only the Playwright code.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write an assertion checking visibility or expected text/value.
Return only the Playwright assertion code.`;
    }
    return `You are an automation expert using Microsoft Playwright (TypeScript/JavaScript).
Generate the most stable Playwright locator using page.getByRole, page.getByTestId, or page.locator.

Element details:
${json}

Return only the Playwright locator statement (e.g. page.getByTestId(...));`;
  }

  // Cypress
  if (framework === "cypress") {
    if (promptType === "action") {
      return `You are writing an automation step using Cypress (JavaScript).
Given this element:
${json}

Write a single Cypress command (e.g. cy.get(...).click()) that interacts with the element
and includes a simple verification. Return only the Cypress code.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion in Cypress (JavaScript).
Given this element:
${json}

Write a Cypress assertion validating visibility or expected state.
Return only the Cypress assertion line (e.g. cy.get(...).should('be.visible')).`;
    }
    return `You are an automation expert using Cypress (JavaScript).
Generate the most stable Cypress locator using cy.get(), cy.contains(), or custom selectors.

Element details:
${json}

Return only the Cypress locator statement (e.g. cy.get('[data-test="login"]')).`;
  }

  // Robot Framework
  if (framework === "robot") {
    if (promptType === "action") {
      return `You are writing a Robot Framework keyword test step.
Given this element:
${json}

Write a single Robot Framework line using SeleniumLibrary syntax (e.g. Click Element, Input Text)
that interacts with the element. Return only the test step line.`;
    }
    if (promptType === "assertion") {
      return `You are writing a Robot Framework assertion keyword.
Given this element:
${json}

Write a single assertion validating that the element is visible or contains expected text.
Return only the Robot Framework line.`;
    }
    return `You are an automation expert using Robot Framework (SeleniumLibrary).
Generate the most stable locator (id=, name=, css=, xpath=).

Element details:
${json}

Return only the locator string (e.g. xpath=//button[@id="login"]).`;
  }

  // BDD
  if (framework === "bdd") {
    if (promptType === "action") {
      return `You are writing a Cucumber (BDD) Gherkin step for automation.
Given this element:
${json}

Write a single "When" or "Then" step describing an action that interacts with the element.
Return only the Gherkin step text (not implementation).`;
    }
    if (promptType === "assertion") {
      return `You are writing a Cucumber (BDD) Gherkin assertion step.
Given this element:
${json}

Write a "Then" step verifying visibility or expected state of the element.
Return only the Gherkin step text.`;
    }
    return `You are an automation expert writing BDD (Cucumber) test steps.
Generate a human-readable Gherkin step describing how to locate or interact with this element.

Element details:
${json}

Return only the Gherkin step.`;
  }

  // Fallback
  return `You are an automation engineer writing tests in ${framework}.
Given this element:
${json}

Generate a robust locator or action step for this framework.
Return only the code.`;
}

// =========================
// Capture script (injected into pages)
// (dashboard-grade script: serializes attributes, css path, xpath, shadow chain, visible flag)
// =========================
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

  function getShadowHostChain(el) {
    const hosts = [];
    let node = el;
    while (node) {
      const root = node.getRootNode && node.getRootNode();
      if (root && root.host) {
        hosts.unshift(root.host.tagName.toLowerCase());
        node = root.host;
      } else break;
    }
    return hosts.join(" > ") || null;
  }

  function serializeElement(el){
    if(!el) return null;
    try {
      const rect = el.getBoundingClientRect();
      const attrs = {};
      for(const a of el.attributes) attrs[a.name] = a.value;
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : null,
        id: el.id || null,
        name: el.getAttribute && el.getAttribute('name') || null,
        class: el.className || null,
        text: (el.innerText || el.value || "").trim().slice(0, 300),
        role: el.getAttribute && el.getAttribute('role') || null,
        ariaLabel: el.getAttribute && el.getAttribute('aria-label') || null,
        attributes: attrs,
        dataset: Object.assign({}, el.dataset),
        css: cssPath(el),
        xpath: absoluteXPath(el),
        shadowHostChain: getShadowHostChain(el),
        visible: !(window.getComputedStyle(el).display === 'none' || window.getComputedStyle(el).visibility === 'hidden' || window.getComputedStyle(el).opacity === '0' || rect.width === 0 || rect.height === 0),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        crossOrigin: window !== window.top
      };
    } catch(e){
      return null;
    }
  }

  document.addEventListener('click', function(e){
    try {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      if (!el) return;
      if (!window.__highlightedElements) window.__highlightedElements = new WeakSet();
      if (window.__highlightedElements.has(el)) {
        el.style.outline = '';
        el.style.boxShadow = '';
        window.__highlightedElements.delete(el);
      } else {
        el.style.outline = '2px solid #1e90ff';
        el.style.boxShadow = '0 0 6px 2px rgba(30,144,255,0.5)';
        window.__highlightedElements.add(el);
      }
      const payload = serializeElement(el);
      console.log('ELEMENT_CAPTURED:' + JSON.stringify(payload));
    } catch (err) {
      console.error('capture error', err);
    }
  }, true);

  // Public full-scan for auto extract
  window.__locatorScanAll = function(tagFilterCsv) {
    const allowed = tagFilterCsv && typeof tagFilterCsv === 'string'
      ? tagFilterCsv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : null;

    function elementMatchesFilter(el, filters) {
      if (!filters || !filters.length) return true;
      try {
        return filters.some(f => {
          if (f.startsWith(".")) return el.classList.contains(f.slice(1));
          if (f.startsWith("#")) return el.id === f.slice(1);
          if (f.startsWith("[") && f.endsWith("]")) {
            const inside = f.slice(1, -1);
            const [attr, val] = inside.split("=");
            if (val) return el.getAttribute(attr) === val.replace(/['"]/g, "");
            return el.hasAttribute(attr);
          }
          return el.tagName.toLowerCase() === f.toLowerCase();
        });
      } catch (e) { return false; }
    }

    function serialize(el) {
      try {
        const rect = el.getBoundingClientRect();
        const attrs = {};
        for (const a of el.attributes) attrs[a.name] = a.value;
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          name: el.getAttribute && el.getAttribute('name') || null,
          class: el.className || null,
          type: el.getAttribute && el.getAttribute('type') || null,
          placeholder: el.getAttribute && el.getAttribute('placeholder') || null,
          value: el.value || null,
          href: el.getAttribute && el.getAttribute('href') || null,
          title: el.getAttribute && el.getAttribute('title') || null,
          role: el.getAttribute && el.getAttribute('role') || null,
          ariaLabel: el.getAttribute && el.getAttribute('aria-label') || null,
          text: (el.innerText || el.value || "").trim().slice(0, 300),
          visible: !(rect.width === 0 && rect.height === 0) && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden' && window.getComputedStyle(el).opacity !== '0',
          css: (function(){ try { return cssPath(el); } catch { return null; } })(),
          xpath: (function(){ try { return absoluteXPath(el); } catch { return null; } })(),
          attributes: attrs,
          dataset: Object.assign({}, el.dataset),
          x: rect.x,
          y: rect.y
        };
      } catch (e) {
        return null;
      }
    }

    const results = [];
    const seen = new Set();
    const elements = Array.from(document.querySelectorAll("*"));
    for (const el of elements) {
      try {
        if (!elementMatchesFilter(el, allowed)) continue;
        // heuristics for interactable
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
        if (!isVisible) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        const s = serialize(el);
        if (s) results.push(s);
      } catch (e){}
    }
    return results;
  };
})();
`;

// =========================
// Inject helpers for frames and popups
// =========================
async function injectIntoAllFrames(page, scriptContent) {
  try {
    // add init script for future frames
    await page.addInitScript({ content: scriptContent });
    // also inject into existing frames
    const frames = page.frames();
    for (const frame of frames) {
      try {
        await frame.evaluate((src) => {
          if (!window.__locator_installed) {
            const s = document.createElement("script");
            s.type = "text/javascript";
            s.text = src;
            document.documentElement.appendChild(s);
          }
        }, scriptContent);
      } catch {
        // ignore cross-origin frames
      }
    }
  } catch (e) {
    // swallow
  }
}

// =========================
// Smart element-match helper (node-side for console payloads)
// =========================
function elementMatchesFilterNode(elData, filters) {
  if (!filters || !filters.length) return true;
  try {
    return filters.some(f => {
      if (f.startsWith(".")) {
        const cls = elData.class || '';
        return cls.split(/\s+/).includes(f.slice(1));
      }
      if (f.startsWith("#")) {
        return elData.id === f.slice(1);
      }
      if (f.startsWith("[") && f.endsWith("]")) {
        const inside = f.slice(1, -1);
        const [attr, val] = inside.split("=");
        if (val) {
          return elData.attributes && elData.attributes[attr] === val.replace(/['"]/g, "");
        }
        return elData.attributes && attr in elData.attributes;
      }
      return elData.tag && elData.tag.toLowerCase() === f.toLowerCase();
    });
  } catch (e) {
    return false;
  }
}

// =========================
// Main extraction + graceful shutdown
// =========================
async function runExtractor(options = {}) {
  const {
    url,
    framework = "playwright",
    customExample = "",
    tagFilter = null,
    scanHidden = false,
    headless = false,
    outputDir = "output",
    promptType = "locator",
    timeout = 0,
    proxyUrl = null,
    proxyUser = null,
    proxyPass = null,
    useCDP = false,
    autoExtract = false,
    jsonPrefix = "locators",
    promptPrefix = "copilot_prompts",
  } = options;

  if (!isValidUrl(url)) throw new Error("Invalid or unsafe URL: " + url);

  ensureDir(outputDir);

  const proxy = getProxySettingsFrom({ proxyUrl, proxyUser, proxyPass });
  if (proxy) {
    const userLabel = proxy.username ? ` user=${proxy.username}` : "";
    const passLabel = proxy.password ? ` pass=${mask(proxy.password)}` : "";
    log("INFO", `Using proxy: ${proxy.server}${userLabel}${passLabel}`);
  } else {
    log("INFO", "No proxy configured — direct connection mode.");
  }

  const launchOptions = { headless, args: ["--disable-dev-shm-usage"] };
  if (proxy) launchOptions.proxy = proxy;

  let browser = null;
  let context = null;
  let activeCDPClients = [];

  async function stopExtractorCleanup() {
    try {
      if (activeCDPClients.length) {
        log("INFO", `Detaching ${activeCDPClients.length} CDP client(s)...`);
        for (const c of activeCDPClients) {
          try { await c.detach(); } catch { /* ignore */ }
        }
        activeCDPClients = [];
      }
      if (browser) {
        try { await browser.close(); log("INFO", "Browser closed."); } catch (e) { log("WARN", `Browser close failed: ${e.message}`); }
      }
    } catch (e) {
      log("WARN", `Cleanup error: ${e.message}`);
    } finally {
      browser = null;
      context = null;
      activeCDPClients = [];
    }
  }

  // graceful SIGINT
  process.once("SIGINT", async () => {
    log("WARN", "SIGINT received — attempting graceful shutdown...");
    await stopExtractorCleanup();
    log("INFO", "Shutdown complete.");
    process.exit(0);
  });

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ ignoreHTTPSErrors: true });

    // Page popup/new-tab handler
    context.on("page", async (newPage) => {
      try {
        log("INFO", `New page opened: ${newPage.url() || "about:blank"}`);
        if (useCDP) {
          try {
            const popupClient = await context.newCDPSession(newPage);
            activeCDPClients.push(popupClient);
            log("INFO", "CDP attached to popup/new page.");
          } catch (err) {
            log("WARN", `CDP attach for popup failed: ${err.message}`);
          }
        }
        await injectIntoAllFrames(newPage, CAPTURE_SCRIPT);
      } catch (e) {
        log("WARN", `Failed to attach to new page: ${e.message}`);
      }
    });

    const page = await context.newPage();

    let client = null;
    if (useCDP) {
      try {
        client = await context.newCDPSession(page);
        activeCDPClients.push(client);
        log("INFO", "CDP session connected (advanced metadata ready).");
      } catch (err) {
        log("WARN", `CDP initialization failed: ${err.message}`);
      }
    }

    // Inject capture script into frames and page
    await injectIntoAllFrames(page, CAPTURE_SCRIPT);

    // Navigate
    log("INFO", `Launching browser for ${url} (headless=${headless})`);
    // 🕒 Informational log for navigation parameters
    log(
      "INFO",
      `Navigating to ${url} with timeout=${getArg("--navTimeout", fileConfig.navTimeout || 120000)
      }ms and waitUntil=${getArg("--waitUntil", fileConfig.waitUntil || "domcontentloaded")
      }`
    );

    await page.goto(url, {
      waitUntil: getArg("--waitUntil", fileConfig.waitUntil || "domcontentloaded"),
      timeout: parseInt(getArg("--navTimeout", fileConfig.navTimeout || 120000))
    });
    // small wait to stabilize
    await page.waitForTimeout(1000);
    log("INFO", `✅ Page loaded: ${page.url()}`);

    const allLocators = [];
    const allPrompts = [];
    let lastActivity = Date.now();
    const resetTimer = () => (lastActivity = Date.now());

    // Console handler (captures ELEMENT_CAPTURED from injected script)
    page.on("console", async (msg) => {
      try {
        const txt = msg.text();
        if (!txt || !txt.startsWith("ELEMENT_CAPTURED:")) return;
        const raw = txt.slice("ELEMENT_CAPTURED:".length);
        const payload = JSON.parse(raw);
        // Smart tag/attribute filter
        if (tagFilter && Array.isArray(tagFilter)) {
          if (!elementMatchesFilterNode(payload, tagFilter)) return;
        }
        payload.pageUrl = page.url();
        payload.timestamp = new Date().toISOString();

        // attach advanced metadata if requested
        if (useCDP && client && payload.css) {
          try {
            const meta = await getAdvancedMetadata(page, client, payload.css);
            if (meta) payload.advanced = meta;
          } catch (e) {
            // ignore meta errors
          }
        }

        allLocators.push(payload);
        allPrompts.push(buildPrompt(payload, framework, promptType, framework, customExample));
        log("SUCCESS", `Captured <${payload.tag}> ${payload.id ? `#${payload.id}` : ""} ${payload.css ? `(${payload.css})` : ""}`);
        resetTimer();
      } catch (e) {
        log("WARN", `Failed to process console message: ${e.message}`);
      }
    });

    // Auto Extract (Smart DOM Walker) - if requested
    if (autoExtract) {
      try {
        log("INFO", "🤖 Auto Extract All (Smart DOM Walker) starting...");
        const results = await page.evaluate((filtersCsv) => {
          // reuse __locatorScanAll if available
          try {
            if (typeof window.__locatorScanAll === "function") return window.__locatorScanAll(filtersCsv || null);
          } catch { }
          // fallback: simple walker
          const allowed = filtersCsv ? filtersCsv.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : null;
          function elementMatchesFilter(el, filters) {
            if (!filters || !filters.length) return true;
            return filters.some(f => {
              if (f.startsWith(".")) return el.classList.contains(f.slice(1));
              if (f.startsWith("#")) return el.id === f.slice(1);
              if (f.startsWith("[") && f.endsWith("]")) {
                const inside = f.slice(1, -1);
                const [attr, val] = inside.split("=");
                if (val) return el.getAttribute(attr) === val.replace(/['"]/g, "");
                return el.hasAttribute(attr);
              }
              return el.tagName.toLowerCase() === f.toLowerCase();
            });
          }
          const out = [];
          const elems = Array.from(document.querySelectorAll("*"));
          for (const el of elems) {
            try {
              if (!elementMatchesFilter(el, allowed)) continue;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (!(rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0")) continue;
              const attrs = {};
              for (const a of el.attributes) attrs[a.name] = a.value;
              out.push({
                tag: el.tagName.toLowerCase(),
                id: el.id || null,
                name: el.getAttribute && el.getAttribute('name') || null,
                class: el.className || null,
                text: (el.innerText || "").trim().slice(0, 300),
                css: (function () { try { /* cheap fallback */ return el.tagName.toLowerCase(); } catch { return null; } })(),
                xpath: null,
                attributes: attrs,
                dataset: Object.assign({}, el.dataset),
                visible: true,
                x: rect.x,
                y: rect.y
              });
            } catch { }
          }
          return out;
        }, tagFilter ? tagFilter.join(",") : null);

        if (Array.isArray(results) && results.length) {
          for (const r of results) {
            r.pageUrl = page.url();
            r.timestamp = new Date().toISOString();
            // advanced metadata per element if requested and possible
            if (useCDP && client && r.css) {
              try {
                const meta = await getAdvancedMetadata(page, client, r.css);
                if (meta) r.advanced = meta;
              } catch { }
            }
            allLocators.push(r);
            allPrompts.push(buildPrompt(r, framework, promptType, framework, customExample));
          }
          log("SUCCESS", `Auto-extracted ${results.length} elements from ${page.url()}`);
        } else {
          log("WARN", "Auto-extract found 0 elements.");
        }
      } catch (e) {
        log("WARN", `Auto extract failed: ${e.message}`);
      }
    }

    // scanHidden option: collect hidden elements too using dashboard logic
    if (scanHidden) {
      try {
        log("INFO", "🔍 Running hidden-element scan...");
        const results = await page.evaluate((filtersCsv) => {
          const filters = filtersCsv ? filtersCsv.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : null;
          function matchesFilter(el) {
            if (!filters || !filters.length) return true;
            return filters.some(f => {
              if (f.startsWith(".")) return el.classList.contains(f.slice(1));
              if (f.startsWith("#")) return el.id === f.slice(1);
              if (f.startsWith("[") && f.endsWith("]")) {
                const inside = f.slice(1, -1);
                const [attr, val] = inside.split("=");
                if (val) return el.getAttribute(attr) === val.replace(/['"]/g, "");
                return el.hasAttribute(attr);
              }
              return el.tagName.toLowerCase() === f.toLowerCase();
            });
          }
          const all = Array.from(document.querySelectorAll("*"));
          const out = [];
          for (const el of all) {
            try {
              if (!matchesFilter(el)) continue;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const visible = !(rect.width === 0 && rect.height === 0) && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
              if (visible) continue; // skip visible - only hidden scan
              const attrs = {};
              for (const a of el.attributes) attrs[a.name] = a.value;
              out.push({
                tag: el.tagName.toLowerCase(),
                id: el.id || null,
                name: el.getAttribute && el.getAttribute('name') || null,
                class: el.className || null,
                text: (el.innerText || "").trim().slice(0, 300),
                attributes: attrs,
                dataset: Object.assign({}, el.dataset),
                visible: false
              });
            } catch { }
          }
          return out;
        }, tagFilter ? tagFilter.join(",") : null);

        if (Array.isArray(results) && results.length) {
          for (const r of results) {
            r.pageUrl = page.url();
            r.timestamp = new Date().toISOString();
            if (useCDP && client && r.css) {
              try { const meta = await getAdvancedMetadata(page, client, r.css); if (meta) r.advanced = meta; } catch { }
            }
            allLocators.push(r);
            allPrompts.push(buildPrompt(r, framework, promptType, framework, customExample));
          }
          log("INFO", `Hidden-scan collected ${results.length} elements.`);
        } else {
          log("INFO", "Hidden-scan found 0 elements.");
        }
      } catch (e) {
        log("WARN", `Hidden scan failed: ${e.message}`);
      }
    }

    // auto-timeout watcher for inactivity
    if (timeout > 0) {
      const interval = setInterval(() => {
        try {
          if (Date.now() - lastActivity > timeout * 1000) {
            log("WARN", `Timeout reached (${timeout}s inactivity) — auto-stopping.`);
            // simulate Enter
            process.stdin.emit("data");
            clearInterval(interval);
          }
        } catch { }
      }, 2000);
    }

    // Now wait for manual stop (Enter from user) if not auto-extracted-only
    // If autoExtract was used, still allow manual Ctrl+click captures until user presses Enter.
    await new Promise((resolve) => process.stdin.once("data", resolve));

    // Collate results and save
    const unique = deduplicate(allLocators);
    const ts = getTimestamp();
    const safeFramework = typeof framework === "string" ? framework.replace(/[^a-z0-9_-]/gi, "") : "playwright";

    const jsonFile = path.join(outputDir, `${jsonPrefix || "locators"}_${ts}.json`);
    const txtFile = path.join(outputDir, `${promptPrefix || "copilot_prompts"}_${safeFramework}_${ts}.txt`);

    atomicWrite(jsonFile, JSON.stringify(unique, null, 2));
    atomicWrite(txtFile, allPrompts.join("\n\n========================\n\n"));

    // Visible vs hidden summary
    const visibleCount = unique.filter(el => el.visible).length;
    const hiddenCount = unique.length - visibleCount;

    log("INFO", "---------------------------------------------");
    log("INFO", `📄 Extraction Summary`);
    log("INFO", `  • Framework: ${framework}`);
    if (proxy) log("INFO", `  • Proxy: ${proxy.server}`);
    log("INFO", `  • Total elements captured: ${allLocators.length}`);
    log("INFO", `  • Unique locators saved: ${unique.length}`);
    log("INFO", `  • Visible: ${visibleCount}  Hidden: ${hiddenCount}`);
    log("INFO", `  • Prompts generated: ${allPrompts.length}`);
    log("INFO", "---------------------------------------------");
    log("SUCCESS", `💾 Locators -> ${jsonFile}`);
    log("SUCCESS", `💾 Prompts  -> ${txtFile}`);

    // cleanup CDP and browser
    await stopExtractorCleanup();
    log("INFO", "🧹 Extraction complete.");
  } catch (err) {
    log("ERROR", `Extraction failed: ${err.stack || err.message}`);
    try {
      if (context) await context.close();
      if (browser) await browser.close();
    } catch { }
    throw err;
  }
}

// =========================
// CLI parsing and run
// =========================
const args = process.argv.slice(2);
const fileConfig = loadConfig();

function getArg(flag, fallback) {
  const val = args.find(a => a.startsWith(`${flag}=`));
  return val ? val.split("=")[1] : fallback;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:
  node locator-extractor.js <url> [options]

Options:
  --framework=<type>       playwright | selenium | cypress | robot | custom | bdd
  --customExample=<text>   Example locator definition (for custom frameworks)
  --tagFilter=<tags>       Comma-separated tags/attrs (button,input,a,[data-test])
  --scanHidden             Include hidden elements in scan
  --autoExtract            Run Smart DOM Walker automatically
  --headless               Run browser headless (for CI or no-GUI environments)
  --promptType=<type>      locator | action | assertion
  --useCDP                 Enable Chrome DevTools Protocol advanced metadata
  --timeout=<seconds>      Auto-stop after inactivity (manual mode)
  --navTimeout=<ms>        Navigation timeout in milliseconds (default: 120000)
  --waitUntil=<state>      Wait condition: load | domcontentloaded | networkidle
  --outputDir=<dir>        Folder to save results (default: output)
  --jsonPrefix=<prefix>    Prefix for locator JSON files (default: locators)
  --promptPrefix=<prefix>  Prefix for Copilot prompt files (default: copilot_prompts)
  --proxyUrl=<url>         Proxy URL (overrides env)
  --proxyUser=<user>       Proxy username
  --proxyPass=<pass>       Proxy password

Examples:
  node locator-extractor.js https://example.com --framework=selenium --autoExtract --useCDP
  node locator-extractor.js https://example.com --waitUntil=domcontentloaded --navTimeout=180000

How to End Extraction:
  🖱️ In manual mode: Press ENTER in the terminal to save and stop.
  🤖 In autoExtract mode: Wait for scan to complete, then press ENTER to save and exit.
  ⏳ If --timeout is set: The process will auto-stop after inactivity.
  🛑 To cancel anytime: Press Ctrl + C for graceful shutdown.
`);

  process.exit(0);
}

// tagFilter merge from CLI or config.json
let tagFilterVal = getArg("--tagFilter", fileConfig.tagFilter);
if (typeof tagFilterVal === "string") tagFilterVal = tagFilterVal.split(",").map(s => s.trim()).filter(Boolean);
if (!Array.isArray(tagFilterVal)) tagFilterVal = fileConfig.tagFilter || null;

const options = {
  url: args[0] || fileConfig.url,
  framework: getArg("--framework", fileConfig.framework || "playwright"),
  customExample: getArg("--customExample", fileConfig.customExample || ""),
  tagFilter: tagFilterVal,
  scanHidden: args.includes("--scanHidden") || fileConfig.scanHidden || false,
  autoExtract: args.includes("--autoExtract") || fileConfig.autoExtract || false,
  headless: args.includes("--headless") || fileConfig.headless || false,
  outputDir: getArg("--outputDir", fileConfig.outputDir || "output"),
  promptType: getArg("--promptType", fileConfig.promptType || "locator"),
  timeout: parseInt(getArg("--timeout", String(fileConfig.timeout || 0))) || 0,
  useCDP: args.includes("--useCDP") || fileConfig.useCDP || false,
  proxyUrl: getArg("--proxyUrl", fileConfig.proxyUrl || null),
  proxyUser: getArg("--proxyUser", fileConfig.proxyUser || null),
  proxyPass: getArg("--proxyPass", fileConfig.proxyPass || null),
  jsonPrefix: getArg("--jsonPrefix", fileConfig.jsonPrefix || "locators"),
  promptPrefix: getArg("--promptPrefix", fileConfig.promptPrefix || "copilot_prompts"),
  navTimeout: parseInt(getArg("--navTimeout", fileConfig.navTimeout || 120000)),
  waitUntil: getArg("--waitUntil", fileConfig.waitUntil || "domcontentloaded"),
};

if (!options.url) {
  log("ERROR", "URL is required as first argument or in config.json.");
  process.exit(1);
}

(async () => {
  try {
    await runExtractor(options);
  } catch (e) {
    log("ERROR", `Fatal: ${e.message || e}`);
    process.exit(1);
  }
})();
