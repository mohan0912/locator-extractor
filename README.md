# 🧭 Locator Extractor (Standalone Multi-Framework Version)

A powerful **Playwright-based CLI tool** that captures UI elements from any web page via **Ctrl/Cmd + Click** and auto-generates **framework-specific locators or test prompts** for:

✅ Playwright  
✅ Selenium (Java)  
✅ Cypress  
✅ Robot Framework  
✅ BDD (Gherkin)  
✅ Custom Frameworks (via example pattern)

---

## 🚀 Features

- 🎯 Cross-framework support
- 🖱️ Ctrl/Cmd + Click to capture elements
- ⚙️ Tag/Attribute filters
- 🔍 Hidden element scanning
- 🪞 Multi-frame & popup injection
- 🧠 AI-ready Copilot prompt generation
- 🧩 Deduplication of locators
- 🕒 Auto-timeout & manual stop
- 🧾 Summary report
- 💾 JSON + TXT file outputs

---

## 🧰 Installation

```bash
git clone <repo-url>
cd locator-extractor
npm install
```

---

## ⚡ Usage

### 🟢 Playwright Example
```bash
node locator-extractor.js https://example.com --framework=playwright
```

### 🟣 Selenium Example
```bash
node locator-extractor.js https://example.com --framework=selenium --promptType=action
```

### 🟠 Custom Framework Example
```bash
node locator-extractor.js https://example.com   --framework=custom   --customExample='this.loginButton = page.locator("[data-test=login]");'   --promptType=assertion
```

---

## 🧾 Options

| Option | Description | Example |
|--------|--------------|----------|
| `--framework` | Target automation framework | `--framework=selenium` |
| `--customExample` | Locator definition style for custom frameworks | `'this.loginBtn = page.locator("[data-test=login]")'` |
| `--tagFilter` | Comma-separated filters (tag/class/id/attribute) | `--tagFilter=button,input,a` |
| `--scanHidden` | Scan hidden DOM elements | `--scanHidden` |
| `--headless` | Run browser headless | `--headless` |
| `--promptType` | `locator`, `action`, `assertion` | `--promptType=action` |
| `--timeout` | Auto-stop after inactivity (in seconds) | `--timeout=120` |
| `--outputDir` | Folder to save results | `--outputDir=output` |

---

## 📦 Output Files

| File | Description |
|------|-------------|
| `locators_<timestamp>.json` | Captured element metadata |
| `copilot_prompts_<framework>_<timestamp>.txt` | Framework-specific Copilot prompts |

---

## 📊 Example Summary Output

```
---------------------------------------------
📄 Extraction Summary
  • Framework: selenium
  • Total pages scanned: 2
  • Total elements captured: 54
  • Unique locators saved: 48
  • Prompts generated: 48
---------------------------------------------
💾 Locators -> output/locators_2025-10-21T22-40-14-398Z.json
💾 Prompts  -> output/copilot_prompts_selenium_2025-10-21T22-40-14-398Z.txt
🧹 Browser closed. Extraction complete.
```

---

## 💡 Pro Tips

- Hold **Ctrl (Windows/Linux)** or **Cmd (Mac)** + Click to capture elements.
- Use `--tagFilter=button,a,[data-test-id]` to narrow scanning scope.
- Press **Enter** in the terminal to stop anytime.
- Combine with `--timeout` for unattended runs.

---

## 🧑‍💻 Author

**Automation AI Framework** — built with ❤️ using [Playwright](https://playwright.dev/).

---

## 🪪 License

MIT License © 2025
