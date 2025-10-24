#!/usr/bin/env node
// Simple proxy connectivity tester using Playwright
import { chromium } from "playwright";
import { argv } from "process";

const testUrl = argv[2] || "https://example.com";
const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

(async () => {
  try {
    const proxy = proxyEnv ? { server: proxyEnv } : null;
    console.log("Testing connectivity to", testUrl, proxy ? `via proxy ${proxy.server}` : "direct");
    const browser = await chromium.launch({ headless: true, proxy });
    const page = await browser.newPage();
    const r = await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (r && r.ok()) console.log("✅ Success:", r.status());
    else if (r) console.log("⚠️ Got response:", r.status());
    else console.log("❌ No response received");
    await browser.close();
  } catch (e) {
    console.error("❌ Test failed:", e.message);
    process.exit(1);
  }
})();
