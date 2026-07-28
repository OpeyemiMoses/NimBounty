# nimBounty

> Instant Micro-Task & Escrow Engine powered by Nimiq Pay

---

## ⚡ What is NimBounty?

**NimBounty** is a safe, non-custodial micro-task and crowd-testing platform built on the **Nimiq Pay Mini Apps Framework**. It enables creators and web3 builders to post bounties (app testing, UI feedback, bug reports, social sharing, copywriting) backed by smart NIM/USDT escrow pools, while workers earn instant payouts with **zero gas fees**.

---

## 🌟 Build Features

### 🖥️ 1. Landing Page (`#view-landing`)
* **HatchAI-Inspired Design System:** Styled with warm linen canvas background (`#f5f3ef`), Work Sans display headings, Instrument Serif italic gold accents, and Geist Mono technical font.
* **Typewriter Hero Header:** Dynamic typewriter animation cycling through key value propositions (*"fast"*, *"safe"*, *"direct"*, *"onchain"*, *"instant"*).
* **Process Flow Pills:** Step indicators (`1. Select Task` &rarr; `2. Escrow Protection` &rarr; `3. Instant Payout`).
* **5-Step Process Cards:** Visual walkthrough (*DEPOSIT*, *PROTECT*, *EXECUTE*, *VERIFY*, *SETTLE*).
* **Built-in Protections 2x2 Grid:** Onchain safeguards with clean SVG icon badges (no stickers or emojis).
* **Interactive FAQ Accordion:** Expandable `+` / `−` toggles for common questions.

### 💼 2. App Console (`#view-app`)
* **Dual-Mode Switcher:** Instant toggle between **Worker Mode** and **Poster Mode**.
* **Worker Mode:** 
  * Interactive task board with search bar, category filtering (*App Testing*, *UI Feedback*, *Social Share*, *Bug Hunt*, *Translation*), and sorting (*Newest*, *Highest Reward*, *Most Slots*).
  * Task claim modal with a **15-minute reservation timer**.
  * Multi-format proof submission (Text, URL link, or Screenshot upload with live preview).
  * Worker Reputation Badge & Status Bar (Reputation: `98/100`).
* **Poster Mode:**
  * **Publish Bounty Form:** Create task pools, set reward per worker, set total slot capacity, and detailed guidelines.
  * **Live Escrow Calculator:** Automatically computes total NIM deposit required.
  * **Review Dashboard:** Poster can review pending worker submissions and click **"Approve & Pay"** or **"Reject"**.

### 🛡️ 3. Protocol Protections
* **Anti-Sybil Device ID Binding:** Integrates Nimiq SDK `requestDeviceIdentifier` to bind task claims to a unique 64-character SHA-256 hardware hash, preventing bot farming and multi-accounting.
* **24-Hour Auto-Approve Safeguard:** If a poster remains inactive for >24 hours after a proof submission, funds automatically release to the worker.
* **Zero Worker Gas Costs:** Workers sign submissions off-chain; reward payouts are covered out of the poster's initial deposit.

---

## 📁 Repository Structure

```text
nimbounty/
├── index.html                  # Main application structure (Landing Page & App Console)
├── style.css                   # HatchAI design system, Nimiq Gold palette, SVG styles
├── app.js                      # View router, FAQ toggle, Typewriter engine, Nimiq SDK logic
├── README.md                   # Project documentation
├── LICENSE                     # MIT License
├── CODE_OF_CONDUCT.md          # Contributor code of conduct
├── CONTRIBUTING.md             # Contribution guidelines
├── SECURITY.md                 # Security policy & vulnerability reporting
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.md       # Bug report issue template
    │   └── feature_request.md  # Feature request issue template
    └── PULL_REQUEST_TEMPLATE.md# Pull request review template
```

---

## 🚀 Running Locally

### 1. Launch Dev Server
```bash
python -m http.server 8080
```

### 2. Access App
* **Desktop Browser:** Navigate to `http://localhost:8080`
* **Nimiq Pay Mobile Test:** Open Nimiq Pay and open the deeplink:
  `nimiqpay://miniapp?url=http://YOUR_LOCAL_IP:8080`

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
