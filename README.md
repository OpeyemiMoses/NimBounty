# ⚡ NimBounty — Instant Micro-Task & Crowd Testing Protocol on Nimiq Pay

[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](LICENSE)
[![Framework](https://img.shields.io/badge/Framework-Nimiq_Pay_Mini_Apps-1a7a4a.svg)](https://nimiq.dev/mini-apps)
[![Network](https://img.shields.io/badge/Network-Nimiq_Mainnet_%7C_EVM-blue.svg)](https://nimiq.com)
[![Status](https://img.shields.io/badge/Status-Production_Ready-brightgreen.svg)](#)

> **NimBounty** is a safe, non-custodial micro-task and crowd-testing engine built for the **Nimiq Pay Mini Apps Competition**. It allows Web3 builders to deposit NIM/USDT into smart escrow pools for instant user testing, feedback, and social micro-tasks, while workers complete tasks with **zero gas fees** and **instant onchain settlement**.

---

## 📑 Project Overview

Traditional task and freelancing platforms take 20%+ commission fees and enforce $50 minimum payout thresholds. Because traditional payment processors charge $0.30 fixed swipe fees per transaction, $0.10 - $2.00 micro-payments have been economically impossible — until now.

**NimBounty** solves this by pairing **Nimiq Pay's fast, zero-friction mobile payment rails** with smart escrow vaults and hardware-bound anti-sybil protections.

### 🌟 Key Features

* **⚡ Instant Smart Escrow:** Posters lock NIM/USDT into escrow in 1 click. Payouts trigger immediately upon proof approval.
* **🛡️ Hardware Anti-Sybil Protection:** Uses Nimiq SDK `requestDeviceIdentifier` to generate a 64-character hardware hash per device, preventing bot farming and multi-account abuse.
* **🌿 Zero Worker Gas Costs:** Workers sign submissions off-chain; reward disbursements are covered out of the poster's initial escrow pool deposit.
* **⏱️ 24-Hour Auto-Approve Safeguard:** Protects worker labor — if a task poster is inactive for >24 hours, the escrow contract automatically approves and releases the reward to the worker.
* **💼 Dual-Console Experience:** Seamless toggle between **Worker Mode** (browse, claim, submit proof) and **Poster Mode** (create pools, set rules, review submissions).

---

## 🏗️ System Architecture

```
                       ┌────────────────────────────────────────┐
                       │        Nimiq Pay Mobile App            │
                       │     (WebView Mini App Sandbox)         │
                       └───────────────────┬────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │   NimBounty Protocol Front-End       │
                        │ (Work Sans + Geist Mono + SVG UI)    │
                        └─────────┬───────────────────┬───────┘
                                  │                   │
            ┌─────────────────────┴───┐           ┌───┴─────────────────────┐
            ▼                         ▼           ▼                         ▼
  [@nimiq/mini-app-sdk]        [Nimiq Provider] [EVM / window.ethereum] [Device ID Sandbox]
  • Wallet Account Init        • NIM Transactions • USDT on Polygon/Base  • Anti-Sybil SHA-256
```

---

## 💻 Tech Stack

* **Core Language:** Modern Vanilla JavaScript (ES6+), HTML5, CSS3 Tokens
* **Typography & Styling:** Work Sans, Instrument Serif, Geist Mono (Custom HatchAI-style design system with Nimiq Gold palette)
* **Web3 SDKs:** `@nimiq/mini-app-sdk` (`init()`, `listAccounts()`, `requestDeviceIdentifier()`), `window.ethereum`
* **Icons:** Inline SVG Vector Icons (zero external font dependencies)

---

## 🚀 Quick Start & Local Development

### Prerequisites
* Node.js (v18+) or Python 3 (for serving static files)
* Nimiq Pay Mobile App ([iOS](https://apps.apple.com/app/id6471844738) / [Android](https://play.google.com/store/apps/details?id=com.nimiq.pay))

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/nimbounty.git
cd nimbounty
```

### 2. Run Local Development Server
Using Python:
```bash
python -m http.server 8080
```
Or using Node `http-server`:
```bash
npx http-server -p 8080
```

### 3. Access in Browser & Nimiq Pay
* **Desktop Preview:** Open `http://localhost:8080` in your web browser.
* **Nimiq Pay Mobile Test:** Open Nimiq Pay on your phone and open the deeplink:
  `nimiqpay://miniapp?url=http://YOUR_LOCAL_IP:8080`

---

## 🏆 Hackathon Competition Alignment

NimBounty is custom-engineered to excel across all 105 scoring criteria for the Nimiq Mini Apps Competition:

| Criteria | Score Impact | Implementation |
| :--- | :--- | :--- |
| **NIM Native Integration** | **+5 Bonus Points** | Uses native NIM transactions for escrow funding & worker rewards |
| **Onboarding Speed** | **< 15 Seconds** | Zero sign-up forms; auto-detects Nimiq Pay wallet address on load |
| **Anti-Abuse Safeguards** | **High Score** | Binds task claims to 64-hex hardware Device IDs |
| **Worker Protection** | **High Score** | 24-hour auto-approval release timers for inactive posters |
| **Visual Design** | **Top Tier** | HatchAI-inspired luxury canvas, typewriter hero, and SVG icon system |
| **License Compliance** | **Mandatory** | Released under permissive MIT Open Source License |

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

## 🛡️ Security Policy

Please review our [`SECURITY.md`](SECURITY.md) for details on vulnerability disclosure and security practices.
