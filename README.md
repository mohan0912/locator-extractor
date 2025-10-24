# 🧭 Locator Extractor CLI 

A **production-ready, enterprise-grade Playwright-based CLI tool** that allows QA engineers and automation developers to extract web element locators, capture metadata, and generate AI-ready prompts for multiple automation frameworks.

This CLI edition shares the same extraction core as the **Locator Extractor Dashboard (v2)** but is optimized for:
- 🧱 **Headless CLI environments**
- 🧩 **Proxy/Firewall-secure networks**
- 🔐 **Enterprise testing and restricted systems**

---

## 📂 Project Structure

```
locator-extractor-enterprise/
│
├── locator-extractor.js       # Main enterprise CLI (manual + auto extraction)
├── config.json                # Default configuration file (can be overridden by CLI args)
├── package.json               # Node module metadata and scripts
├── README.md                  # This documentation
│
├── output/                    # Output folder (auto-created if missing)
│   ├── locators_<timestamp>.json
│   └── copilot_prompts_<framework>_<timestamp>.txt
│
└── tools/
    └── test-proxy.js          # Proxy connectivity tester
```

---

## ⚙️ Key Highlights

✅ **Multi-Framework Prompt Generation**
- Playwright, Selenium, Cypress, Robot Framework, BDD (Cucumber), and custom syntax support.

✅ **Two Extraction Modes**
- **Manual Mode:** Ctrl/Cmd + Click on elements to capture.
- **Auto Mode:** Smart DOM Walker scans entire page intelligently.

✅ **Chrome DevTools Protocol (CDP)**
- Collect advanced metadata like:
  - z-index, opacity, display/visibility
  - aria role/name
  - attached event listeners
  - color, background, font

✅ **Iframe + Shadow DOM Support**
- Automatically injects capture logic into all frames and shadow roots.

✅ **Proxy + Auth**
- Works with corporate proxy servers, environment variables, or CLI credentials.

✅ **Atomic Output Handling**
- Prevents corrupted writes during concurrent runs.

✅ **Cross-Platform Ready**
- Windows, macOS, Linux (Node ≥ 18).

---

## 🧰 Installation

### 1️⃣ Clone and Install
```bash
git clone https://github.com/<your-org>/locator-extractor-enterprise.git
cd locator-extractor-enterprise
npm install
```

### 2️⃣ Install Playwright Browsers
Playwright requires browser binaries for automation.
```bash
npx playwright install
```

---

## 🚀 Quick Start

### Manual Capture
```bash
node locator-extractor.js https://example.com --framework=playwright
```
1. Browser opens your target page.  
2. Hold **Ctrl (Windows/Linux)** or **Cmd (Mac)** and click on any elements to capture.  
3. Press **Enter** in terminal to save and close.

---

### Auto Extraction
Automatically capture all interactive elements:
```bash
node locator-extractor.js https://example.com --framework=selenium --autoExtract
```

---

### CDP Metadata Mode
Include advanced styling and accessibility metadata:
```bash
node locator-extractor.js https://example.com --useCDP --framework=playwright
```

---

### Headless Mode (CLI/Enterprise)
Run fully automated extractions without UI:
```bash
node locator-extractor.js https://example.com --headless --autoExtract --useCDP
```

---

### With Proxy (CLI Flags)
```bash
node locator-extractor.js https://enterprise.portal.com   --proxyUrl=http://proxy.corp.local:8080   --proxyUser=jane   --proxyPass=Secret123
```

---

### Using `config.json`
All options can be preconfigured in `config.json`.  
Just run:
```bash
node locator-extractor.js
```
CLI arguments always override config values.

---

## ⚡ CLI Options

| Flag | Description | Example |
|------|--------------|----------|
| `--framework` | Target test framework (`playwright`, `selenium`, `cypress`, `robot`, `bdd`, `custom`) | `--framework=selenium` |
| `--customExample` | Example definition for custom frameworks | `'this.btn = page.locator("[data-test=login]");'` |
| `--tagFilter` | Comma-separated list (`button,input,a,[data-test]`) | `--tagFilter=button,input,a` |
| `--scanHidden` | Include hidden/offscreen elements | `--scanHidden` |
| `--autoExtract` | Run Smart DOM Walker automatically | `--autoExtract` |
| `--headless` | Run browser in headless mode | `--headless` |
| `--promptType` | `locator`, `action`, or `assertion` | `--promptType=action` |
| `--useCDP` | Enable Chrome DevTools metadata capture | `--useCDP` |
| `--timeout` | Auto-stop after inactivity (seconds) | `--timeout=90` |
| `--outputDir` | Output folder path | `--outputDir=output` |
| `--jsonPrefix` | Prefix for JSON filename | `--jsonPrefix=locators` |
| `--promptPrefix` | Prefix for Copilot prompt file | `--promptPrefix=copilot_prompts` |
| `--proxyUrl` | Proxy server URL | `--proxyUrl=http://proxy.corp.local:8080` |
| `--proxyUser` | Proxy username | `--proxyUser=alice` |
| `--proxyPass` | Proxy password (masked in logs) | `--proxyPass=Secret123` |

---

## 🧾 `config.json` Reference

```json
{
  "url": "https://www.makemytrip.com",
  "framework": "selenium",
  "customExample": "",
  "tagFilter": ["button", "input", "a"],
  "scanHidden": false,
  "autoExtract": false,
  "headless": false,
  "promptType": "locator",
  "outputDir": "output",
  "jsonPrefix": "locators",
  "promptPrefix": "copilot_prompts",
  "timeout": 60,
  "useCDP": true,
  "proxyUrl": "",
  "proxyUser": "",
  "proxyPass": ""
}
```

---

## 📦 Output Files

| File | Purpose |
|------|----------|
| `locators_<timestamp>.json` | Captured locator metadata |
| `copilot_prompts_<framework>_<timestamp>.txt` | AI prompt file for Copilot/ChatGPT |
| Timestamp format | `YYYY-MM-DD_HH-MM-SS` |
| Output directory | configurable via `outputDir` |

Each locator entry in the JSON includes:
```json
{
  "tag": "button",
  "id": "loginBtn",
  "text": "Login",
  "attributes": { "data-test": "login-button" },
  "visible": true,
  "pageUrl": "https://example.com/login",
  "timestamp": "2025-10-24T12:22:31Z"
}
```

---

## 🧠 Advanced: CDP Metadata Fields

When `--useCDP` is enabled, additional fields may appear:
```json
"advanced": {
  "zIndex": "999",
  "opacity": "1",
  "visibility": "visible",
  "backgroundColor": "rgb(255,255,255)",
  "ariaRole": "button",
  "ariaName": "Submit",
  "listeners": ["click", "keydown"]
}
```

---

## 🌐 Proxy Configuration

### Option 1 — Environment Variables
#### Windows
```bash
set HTTPS_PROXY=http://proxy.corp.local:8080
set PROXY_USER=jane
set PROXY_PASS=Secret123
```

#### macOS/Linux
```bash
export HTTPS_PROXY=http://proxy.corp.local:8080
export PROXY_USER=jane
export PROXY_PASS=Secret123
```

### Option 2 — CLI Flags
```bash
node locator-extractor.js https://example.com   --proxyUrl=http://proxy.corp.local:8080   --proxyUser=jane --proxyPass=Secret123
```

### Option 3 — Proxy Test Script
Test connectivity before running:
```bash
node tools/test-proxy.js https://example.com
```

---

## 🧩 Enterprise Readiness Checklist

| Capability | Status |
|-------------|---------|
| Proxy & Auth | ✅ |
| Headless CLI Ready | ✅ |
| CDP Metadata (CSS/ARIA) | ✅ |
| Iframe / Shadow DOM Support | ✅ |
| Auto Extract (Smart DOM Walker) | ✅ |
| Popup & Multi-Page Handling | ✅ |
| Deduplication & Atomic Writes | ✅ |
| Visible/Hidden Summary | ✅ |
| Graceful Shutdown / SIGINT | ✅ |
| Configurable Prefixes | ✅ |
| Secure URL Validation | ✅ |

---

## 🧪 Example Console Log

```
[12:00:42 PM] [INFO] Loaded config.json successfully.
[12:00:43 PM] [INFO] Launching browser for https://www.makemytrip.com (headless=false)
[12:00:45 PM] [INFO] ✅ Page loaded: https://www.makemytrip.com
[12:00:46 PM] [SUCCESS] Captured <button> #loginBtn
[12:00:49 PM] [SUCCESS] Captured <input> name=email
[12:00:51 PM] [INFO] ---------------------------------------------
[12:00:51 PM] [INFO] 📄 Extraction Summary
[12:00:51 PM] [INFO]   • Framework: selenium
[12:00:51 PM] [INFO]   • Total elements captured: 2
[12:00:51 PM] [INFO]   • Unique locators saved: 2
[12:00:51 PM] [INFO]   • Visible: 2  Hidden: 0
[12:00:51 PM] [INFO] ---------------------------------------------
[12:00:51 PM] [SUCCESS] 💾 Locators -> output/locators_2025-10-24_12-00-51.json
[12:00:51 PM] [SUCCESS] 💾 Prompts  -> output/copilot_prompts_selenium_2025-10-24_12-00-51.txt
[12:00:52 PM] [INFO] 🧹 Browser closed. Extraction complete.
```

---

## 🪶 Troubleshooting

| Symptom | Cause | Fix |
|----------|--------|-----|
| “Invalid or unsafe URL” | URL not HTTP/HTTPS | Must start with http or https |
| “No elements captured” | Didn’t Ctrl+Click or tagFilter too narrow | Adjust `--tagFilter` |
| “Cannot GET /” | Wrong working directory | Run inside project folder |
| “Proxy refused connection” | Wrong proxy URL | Test with `node tools/test-proxy.js` |
| “CDP failed” | Page restricted DevTools | Disable `--useCDP` |
| “Empty JSON output” | Page fully dynamic | Increase timeout or use autoExtract |

---

## 🧩 Future Enhancements

- Element screenshots per capture  
- Parallel multi-URL extraction  
- CSV/XLSX export format  
- Built-in Copilot/LLM integration  
- Enhanced hidden element logic  

---

## 🧑‍💻 Author

**Automation AI Framework Team**  
Built with ❤️ using [Playwright](https://playwright.dev/)

---

## 🪪 License

MIT License © 2025
