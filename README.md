# ⚡ NimBounty — Instant Micro-Task & Crowd-Testing Protocol on Nimiq Pay

[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](LICENSE)
[![Framework](https://img.shields.io/badge/Framework-Nimiq_Pay_Mini_Apps-1a7a4a.svg)](https://nimiq.dev/mini-apps)
[![Network](https://img.shields.io/badge/Network-Nimiq_Mainnet_%7C_EVM-blue.svg)](https://nimiq.com)
[![Status](https://img.shields.io/badge/Status-Live_on_Mainnet-brightgreen.svg)](https://nim-bounty.vercel.app)
[![Deploy](https://img.shields.io/badge/Deployed-Vercel-black.svg)](https://nim-bounty.vercel.app)

> **Live App:** [https://nim-bounty.vercel.app](https://nim-bounty.vercel.app)

---

## 🧩 The Problem

The global gig economy is broken for small-scale tasks:

- **Platforms like Fiverr, Upwork, and MTurk** charge **20–30% commission fees**, making micro-payments economically unviable.
- **Traditional payment rails** (Stripe, PayPal) impose a fixed fee of ~$0.30 per transaction, meaning a $1.00 task payout loses 30% immediately — and $0.10 tasks are simply impossible.
- **Freelance platforms have $50+ minimum withdrawal thresholds**, locking out workers in emerging markets who complete small tasks for $1–$5 each.
- **Builders and startups** need fast, affordable feedback loops — real user testing, app reviews, social amplification — but can't afford traditional research firms or influencer agencies.
- **Centralized escrow intermediaries** hold worker funds and charge fees for their custody, adding a layer of bureaucracy and trust risk.
- **Bot farming and Sybil attacks** on traditional crowdsourcing platforms (e.g., MTurk) corrupt data quality and allow single actors to farm multiple rewards.

The result: legitimate micro-task economies fail to launch, workers in emerging markets are excluded, and builders get low-quality feedback that doesn't reflect real users.

---

## 💡 How NimBounty is the Solution

**NimBounty** is a non-custodial, peer-to-peer micro-task bounty protocol built natively on the **Nimiq Pay Mini Apps Framework** — the only mobile payment stack designed from the ground up for instant, feeless micro-payments.

Here's how NimBounty solves every problem above:

| Problem | NimBounty Solution |
|---|---|
| 20–30% platform fees | **0% platform commission.** Poster pays worker directly, wallet-to-wallet. |
| $0.30 fixed transaction fees | **Nimiq Pay's near-zero fee rails** make $0.10–$5 tasks economically viable. |
| $50 minimum withdrawal | **Any amount, any time.** Workers receive NIM directly to their wallet on approval. |
| No affordable feedback channel | **Task pools are free to create.** Post a task with 1 click, no upfront deposit required. |
| Custodial escrow risk | **Non-custodial by design.** Funds stay in poster's wallet until the moment of payout. |
| Bot farming & Sybil attacks | **Hardware-bound anti-Sybil:** Nimiq's `requestDeviceIdentifier` API locks 1 device to 1 task slot. |
| No proof of work integrity | **Off-chain proof signatures:** Workers sign submissions with Nimiq wallet keys at zero gas cost. |

NimBounty connects **task posters** (builders, startups, researchers) with **workers** (testers, community members, content creators) through a trustless, direct settlement protocol powered by Nimiq Pay.

---

## 🔑 Key Features

### For Task Posters
- **Free Task Publishing** — Create bounty pools instantly with no upfront deposit. Set reward amount, worker slots, proof type, and deadline.
- **Rich Proof Types** — Request text feedback, URL links, Twitter/X handles, screenshots, or combined image + text proof.
- **Off-Chain Approval Signature** — Sign your approval decision off-chain with your Nimiq Pay keys (zero gas fees).
- **Direct Wallet Payout** — Approve a worker's proof and pay them directly from your connected Nimiq Pay wallet, wallet-to-wallet, with one click.
- **Campaign Dashboard** — Manage all published pools and review submitted worker proofs from a dedicated Poster Mode console.
- **Real-Time Submissions Queue** — View, approve, or reject worker submissions as they arrive with a live global sync engine.

### For Workers
- **Browse Live Bounties** — Discover and filter active task pools in the global worker dashboard.
- **Off-Chain Proof Submission** — Sign and submit proof with your Nimiq wallet keys at **zero gas cost**. No transaction fees.
- **Anti-Sybil Protection** — One physical device, one slot per bounty pool. Prevents multi-account farming.
- **Proof History Tracking** — Track pending submissions and approved payouts in a dedicated history tab.
- **Instant Payout on Approval** — Receive NIM directly from poster's wallet the moment your proof is approved.

### Platform-Wide
- ⚡ **Nimiq Pay Mini App SDK Integration** — Native wallet provider, device ID, and transaction signing.
- 🌍 **Global Real-Time Sync** — All bounties and submissions are synchronized globally via a persistent serverless backend.
- 🎨 **Dark/Light Theme Toggle** — Full system-aware theming with Nimiq Gold design tokens.
- 🔊 **Audio FX + Confetti Animations** — Premium micro-interactions for submission and payout events.
- 📱 **Mobile-First Design** — Built and optimized for Nimiq Pay's mobile WebView sandbox.
- 🔗 **Shareable Bounty Links** — Posters can share unique deep-link URLs that auto-import specific bounties for workers.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML5, CSS3 (Custom Design Tokens), ES6+ JavaScript |
| **Typography** | Work Sans, Instrument Serif, Geist Mono (Google Fonts) |
| **Web3 SDK** | `@nimiq/mini-app-sdk` — `init()`, `listAccounts()`, `requestDeviceIdentifier()`, `sendBasicTransaction()` |
| **EVM Support** | `window.ethereum` provider (Polygon, Base, Arbitrum USDT payouts) |
| **Backend API** | Vercel Serverless Functions (Node.js 18+) |
| **Persistent Store** | JSONBlob REST API (global bounty + submission sync) |
| **Deployment** | Vercel (auto-deploys from GitHub `main` branch) |
| **Icons** | Inline SVG (zero external dependencies) |
| **Version Control** | Git + GitHub |

---

## 🚀 How to Run Locally

### Prerequisites

- **Node.js v18+** installed ([nodejs.org](https://nodejs.org))
- **Git** installed
- **Nimiq Pay Mobile App** ([iOS](https://apps.apple.com/app/id6471844738) / [Android](https://play.google.com/store/apps/details?id=com.nimiq.pay)) for full wallet functionality
- **Vercel CLI** (optional, for testing serverless API locally)

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/OpeyemiMoses/NimBounty.git
cd NimBounty
```

---

### Step 2 — Install Dependencies

```bash
npm install
```

---

### Step 3 — Run a Local Dev Server

**Option A — Python (no install needed):**
```bash
python -m http.server 8080
```

**Option B — Node `http-server`:**
```bash
npx http-server -p 8080
```

**Option C — Vercel Dev (with API routes):**
```bash
npx vercel dev
```
> This runs the `api/bounties.js` serverless function locally alongside the frontend.

---

### Step 4 — Access in Browser

```
http://localhost:8080
```

---

### Step 5 — Test in Nimiq Pay Mobile App

Open Nimiq Pay on your phone and navigate to the Mini Apps section, then paste:

```
http://YOUR_LOCAL_IP:8080
```

Replace `YOUR_LOCAL_IP` with your local network IP (e.g., `192.168.1.10`).

> **Tip:** Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to find your local IP.

---

### Environment Variables (for Vercel deployment)

Create a `.env` file at the project root:

```env
# No secrets required for current direct wallet payout model.
# The following is reserved for the upcoming on-chain Escrow Vault (see Roadmap).
# ESCROW_MNEMONIC=your_twelve_word_escrow_vault_seed_phrase_here
```

---

## 📁 Project Structure

```
NimBounty/
├── index.html          # Landing page + App Console SPA
├── app.js              # Core application logic & state engine
├── api/
│   └── bounties.js     # Vercel serverless sync API (JSONBlob backend)
├── package.json        # Project dependencies
├── vercel.json         # Vercel deployment config (if present)
├── .gitignore          # Excludes node_modules, .env, .vercel/
└── README.md           # This file
```

---

## 🗺️ Roadmap

### ✅ Phase 1 — Core Protocol (Live)
- [x] Nimiq Pay Mini App SDK integration
- [x] Worker Mode + Poster Mode dual-console
- [x] Hardware anti-Sybil device locking via `requestDeviceIdentifier`
- [x] Off-chain proof submission signatures (worker, zero gas)
- [x] Off-chain approval signatures (poster, zero gas)
- [x] Direct wallet-to-wallet payout (poster → worker on approval)
- [x] Global real-time sync via Vercel serverless + JSONBlob
- [x] Shareable bounty deep links
- [x] Dark/Light theme + audio FX + confetti micro-animations

### 🔧 Phase 2 — On-Chain Escrow Vaults (In Development)
> The next major upgrade introduces **trustless on-chain escrow** — removing any reliance on poster goodwill for payment.

- [ ] **Automatic Escrow Vault Deposit** — Poster locks total reward pool (NIM) into a smart escrow wallet at task creation time.
- [ ] **Serverless Escrow Disburser** — Upon poster approval, a Vercel backend function signs and broadcasts a NIM transaction *from* the escrow vault *to* the worker, requiring no further poster action.
- [ ] **24-Hour Auto-Release Safeguard** — If a poster fails to review a submission within 24 hours, the escrow vault automatically releases the reward to the worker to protect their labor.
- [ ] **Poster Reclaim on Expiry** — If a bounty pool expires with unclaimed slots, the poster can withdraw unused NIM from the vault.
- [ ] **Escrow Audit Trail** — Full on-chain transaction history for every bounty disbursement viewable on Nimiq's blockchain explorer.

### 🌐 Phase 3 — Ecosystem Expansion
- [ ] USDT/ERC-20 token bounty pools (EVM multi-chain)
- [ ] Task category marketplace with search and filter
- [ ] Reputation scoring for workers (based on approval rate)
- [ ] Dispute resolution flow
- [ ] NimBounty DAO governance token for protocol parameters

---

## 📄 License

Distributed under the **MIT License**.

```
MIT License

Copyright (c) 2024 NimBounty Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

See [`LICENSE`](LICENSE) for details.

---

## 🔐 Security

Please review our [`SECURITY.md`](SECURITY.md) for details on vulnerability disclosure and security practices.

---

<p align="center">
  Built with ⚡ on <a href="https://nimiq.com">Nimiq Pay</a> • <a href="https://nim-bounty.vercel.app">Live App</a> • <a href="https://github.com/OpeyemiMoses/NimBounty">GitHub</a>
</p>
