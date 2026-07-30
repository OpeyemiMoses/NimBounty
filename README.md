# NimBounty ⚡ 

> **Proof-First Task Board & Instant NIM Micro-Rewards Engine powered by Nimiq Pay.**

[![Live Demo](https://img.shields.io/badge/Live_App-nim--bounty.vercel.app-ffc72c?style=for-the-badge&logo=vercel&logoColor=black)](https://nim-bounty.vercel.app)
[![Nimiq Pay Mini App](https://img.shields.io/badge/Nimiq_Pay-Mini_App-e6a800?style=for-the-badge&logo=nimiq&logoColor=black)](https://nimiq.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](./LICENSE)
[![Build Status](https://img.shields.io/badge/Vercel-Deploys_Live-000000?style=for-the-badge&logo=vercel)](https://vercel.com)

---

## 📌 Project Overview

**NimBounty** is a mobile-first, decentralized task marketplace built specifically for the **Nimiq Pay Mini App** ecosystem. It bridges task requesters (Posters) and contributors (Workers) through cryptographic proof receipts and instant, zero-custody NIM settlements.

Whether it's app testing, UI/UX feedback, social shares, bug hunting, or local fact verification, NimBounty eliminates long proposals, platform custody fees, and delayed payouts:
1. **Define** — Requesters publish task bounty pools specifying proof requirements and NIM rewards.
2. **Do & Prove** — Workers complete tasks, attach evidence (text, link, or screenshot CDN), and sign an off-chain receipt via Nimiq Pay.
3. **Verify & Settle** — Requesters review proof and trigger instant on-chain NIM settlement directly inside Nimiq Pay.

---

## ✨ Key Features

### 🔄 Dual Role System (Worker vs. Poster Mode)
- **Worker Mode**: Browse active bounty pools, claim reservation slots, and submit proof packages.
- **Poster Mode**: Publish new task campaigns, set escrow budgets, review pending submissions, and payout workers with 1-click.

### 🔐 Cryptographic Off-Chain Signature Protocol
- Powered by `@nimiq/mini-app-sdk` (`provider.sign()`).
- Workers and posters sign cryptographic proof receipts directly in Nimiq Pay without spending gas or transferring funds.

### ⚡ Instant NIM Settlement Engine
- Uses Nimiq Pay's native `sendBasicTransactionWithData()` method.
- Payments transfer directly from requester to worker in seconds with on-chain memo tracking (`NIMBOUNTY_PAYOUT:bounty-id`).

### 🏆 Global Real-Time Leaderboard & Profile Sync
- Tracks total NIM earned and completed task counts globally.
- Real-time profile engine syncs user handles (`@USERNAME`) across all devices instantly.

### 📸 Multi-Format Proof Pipeline
- Supports written feedback, proof URL links, and direct screenshot image attachments.
- Integrated cloud CDN ([catbox.moe](https://catbox.moe)) compresses and uploads screenshots to ~35-byte HTTPS URLs for mobile WebView compatibility.

### ⏳ Live Expiration & Slot Tracking
- Dynamic time-left badges (e.g. `⏳ 14d 2h left`) show remaining campaign duration.
- Real-time slot management prevents over-allocation.

---

## 🛠️ Nimiq Pay SDK Integration

NimBounty leverages Nimiq's Mini App SDK to deliver a native wallet experience:

| SDK Method | Purpose in NimBounty |
| :--- | :--- |
| `init({ timeout: 5000 })` | Initializes connection with Nimiq Pay container |
| `listAccounts()` | Discovers connected user's Nimiq address |
| `provider.sign(jsonPayload)` | Off-chain cryptographic signature for proof receipts & campaign creation (0 NIM cost) |
| `sendBasicTransactionWithData({ recipient, value, data })` | Executes instant on-chain NIM payment with memo link |

```javascript
// Example: Instant NIM Settlement to Worker in NimBounty
const lunaValue = Math.round(parseFloat(rewardNIM) * 100000); // 1 NIM = 100,000 Luna

const txHash = await provider.sendBasicTransactionWithData({
  recipient: workerNimiqAddress,
  value: lunaValue,
  data: `NIMBOUNTY_PAYOUT:${bountyId}`
});
```

---

## 🏗️ Technical Architecture

NimBounty is built with a lightweight, high-performance web architecture:

- **Frontend**: Vanilla JavaScript (ESNext), Semantic HTML5, Custom Modern CSS Design System (Light/Dark themes, glassmorphism accents).
- **Backend API**: Vercel Serverless Server Engine (`/api/bounties`).
- **Data Persistence**: JSONBlob Cloud Store with optimistic real-time polling synchronization (2-second interval).
- **Media Delivery**: Catbox.moe API for anonymous, instant screenshot hosting.

---

## 🚀 Getting Started & Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18.0 or higher
- A browser with Nimiq Pay Mini App container or supported web wallet

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/OpeyemiMoses/NimBounty.git
   cd NimBounty
   ```

2. **Run locally using any local web server** (e.g. VS Code Live Server or `npx serve`):
   ```bash
   npx serve .
   ```

3. **Open in browser**:
   Navigate to `http://localhost:3000` (or local port shown).

---

## 🔒 Security & Privacy

- **Zero Key Storage**: NimBounty never requests, handles, or stores private keys or seed phrases.
- **Native Wallet Authority**: All signature requests and payment approvals occur inside the user's Nimiq Pay wallet.
- **Client-Side Validation**: Addresses and inputs are validated before submitting transactions.

---

## 🔮 Future Roadmap (V2 Custody Escrow Vault)

Future iterations of NimBounty will introduce an automated **Custody Escrow Vault**:
- **Upfront Escrow Deposit**: Posters deposit pool funds into a smart custody address upon campaign publishing.
- **Automated Backend Release**: Approved payouts auto-release via a Node.js signer microservice (`@nimiq/core`).
- **Dispute Resolution & Auto-Refunds**: Automated refunds for expired, unclaimed slots after campaign deadlines.

---

## 🤝 Contributing

Contributions are welcome! Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on opening issues, suggesting features, and submitting pull requests.

Please adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md) in all community interactions.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.
