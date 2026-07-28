// Vercel Serverless API — NimBounty Global Store + Automatic Escrow Payout Disburser
//
// Automatic escrow payout flow:
// 1. Poster clicks Approve in the UI
// 2. Frontend calls POST /api/bounties with action:'disburse_escrow'
// 3. This function derives the escrow vault keypair from ESCROW_MNEMONIC env var
// 4. Signs and broadcasts a BasicTransaction FROM the escrow vault TO the worker
// 5. Returns txHash — no manual sending needed!

import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import { blake2b } from '@noble/hashes/blake2b';

const JSONBLOB_ID = '019fa96a-4867-71b6-a7be-8899b024110a';
const JSONBLOB_BASE = `https://jsonblob.com/api/jsonBlob/${JSONBLOB_ID}`;
const NIMIQ_RPC = 'https://rpc.nimiqwatch.com';

// ── Nimiq Address & Transaction Helpers ──────────────────────────────────────

// Convert BIP39 mnemonic to Ed25519 keypair for Nimiq
function deriveNimiqKeypairFromMnemonic(mnemonic) {
  const cleanMnemonic = mnemonic.trim();
  let seedBytes;
  if (bip39.validateMnemonic(cleanMnemonic)) {
    const entropyHex = bip39.mnemonicToEntropy(cleanMnemonic);
    const entropy = Buffer.from(entropyHex, 'hex');
    // If 16 bytes (12 words), duplicate to 32 bytes for Ed25519 seed
    seedBytes = entropy.length === 16 ? Buffer.concat([entropy, entropy]) : entropy.slice(0, 32);
  } else {
    // Direct seed or hex fallback
    const seed = bip39.mnemonicToSeedSync(cleanMnemonic);
    seedBytes = seed.slice(0, 32);
  }
  return nacl.sign.keyPair.fromSeed(seedBytes);
}

// Convert 32-byte Ed25519 public key to 20-byte Nimiq address via Blake2b (20 bytes)
function publicKeyToAddressBytes(publicKey) {
  return blake2b(publicKey, { dkLen: 20 });
}

// Encode Nimiq address bytes to NQ... base32 string
const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY';
function bytesToNimiqAddress(addrBytes) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < addrBytes.length; i++) {
    value = (value << 8) | addrBytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += NIMIQ_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    output += NIMIQ_ALPHABET[(value << (5 - bits)) & 31];
  }
  const grouped = output.match(/.{1,4}/g).join(' ');
  const forCheck = grouped.replace(/\s/g, '') + 'NQ00';
  const checkNum = 98 - (forCheck.split('').reduce((acc, c) => {
    const v = NIMIQ_ALPHABET.indexOf(c);
    return ((acc * (v < 10 ? 10 : 100)) + v) % 97;
  }, 0));
  return `NQ${checkNum.toString().padStart(2,'0')} ${grouped}`;
}

// Decode NQ address to 20-byte array
function nimiqAddressToBytes(address) {
  const clean = address.replace(/\s+/g, '').toUpperCase().slice(4); // strip NQ##
  let bits = 0, value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i++) {
    value = (value << 5) | NIMIQ_ALPHABET.indexOf(clean[i]);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
    }
  }
  return new Uint8Array(output.slice(0, 20));
}

// Get current block number from Nimiq RPC
async function getNimiqBlockNumber() {
  try {
    const res = await fetch(NIMIQ_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'getBlockNumber', params:[], id:1 })
    });
    const data = await res.json();
    if (data && data.result) {
      if (typeof data.result === 'number') return data.result;
      if (typeof data.result === 'object' && typeof data.result.data === 'number') return data.result.data;
      if (typeof data.result === 'string') return parseInt(data.result.replace('0x',''), data.result.startsWith('0x') ? 16 : 10);
    }
    return 0;
  } catch(e) {
    console.warn("getBlockNumber RPC fetch error:", e);
    return 0;
  }
}

// Build and sign a Nimiq BasicTransaction
function buildSignedNimiqTransaction({ senderPrivateKey, senderPublicKey, recipientBytes, lunaValue, fee, validityStartHeight, networkId }) {
  // Nimiq BasicTransaction serialization:
  // type(1) + sender_type(1) + sender_pubkey(32) + recipient(20) + value(8) + fee(8) + validity_start(4) + network(1) + extra_data_size(1)
  // Then 2-byte proof_size + 1-byte proof_type + 64-byte signature + 32-byte pubkey

  const buf = new Uint8Array(200);
  let offset = 0;

  // Transaction header
  buf[offset++] = 0; // type: Basic
  buf[offset++] = 0; // sender_type: Basic

  // Sender public key (32 bytes)
  buf.set(senderPublicKey, offset); offset += 32;

  // Recipient address (20 bytes)
  buf.set(recipientBytes, offset); offset += 20;

  // Value (8 bytes big-endian luna)
  const valueView = new DataView(buf.buffer, offset, 8);
  valueView.setBigUint64(0, BigInt(lunaValue), false);
  offset += 8;

  // Fee (8 bytes big-endian)
  const feeView = new DataView(buf.buffer, offset, 8);
  feeView.setBigUint64(0, BigInt(fee || 0), false);
  offset += 8;

  // Validity start height (4 bytes big-endian)
  const validityView = new DataView(buf.buffer, offset, 4);
  validityView.setUint32(0, validityStartHeight || 0, false);
  offset += 4;

  // Network ID (1 byte) — 42 = mainnet, 1 = testnet
  buf[offset++] = networkId || 42;

  // Extra data length (1 byte)
  buf[offset++] = 0;

  const txData = buf.slice(0, offset);

  // Sign the transaction data
  const signature = nacl.sign.detached(txData, senderPrivateKey);

  // Build proof: size(2) + type(1) + signature(64) + pubkey(32) = 99 bytes
  const proofBuf = new Uint8Array(3 + 64 + 32);
  const proofSizeView = new DataView(proofBuf.buffer, 0, 2);
  proofSizeView.setUint16(0, 1 + 64 + 32, false); // proof size
  proofBuf[2] = 0; // proof type: Ed25519
  proofBuf.set(signature, 3);
  proofBuf.set(senderPublicKey, 3 + 64);

  // Full serialized transaction
  const fullTx = new Uint8Array(txData.length + proofBuf.length);
  fullTx.set(txData, 0);
  fullTx.set(proofBuf, txData.length);

  return Buffer.from(fullTx).toString('hex');
}

// Broadcast signed transaction hex to Nimiq RPC
async function broadcastNimiqTransaction(hexTx) {
  const res = await fetch(NIMIQ_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sendRawTransaction',
      params: [hexTx],
      id: 1
    })
  });
  const data = await res.json();
  if (data.error) {
    const errMsg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error);
    throw new Error(`RPC error: ${errMsg}`);
  }
  return typeof data.result === 'string' ? data.result : (data.result?.hash || `tx_${Date.now()}`);
}

// ── JSONBlob Persistent Store ─────────────────────────────────────────────────

async function readStore() {
  try {
    const res = await fetch(JSONBLOB_BASE, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`JSONBlob read failed: ${res.status}`);
    return await res.json();
  } catch(e) {
    return { bounties: [], pendingSubmissions: [], approvedPayoutsHistory: [] };
  }
}

async function writeStore(data) {
  const res = await fetch(JSONBLOB_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`JSONBlob write failed: ${res.status}`);
  return res.json();
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Return the full global store ──
  if (req.method === 'GET') {
    const store = await readStore();
    return res.status(200).json(store);
  }

  // ── POST: Handle actions ──
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      // ─── AUTOMATIC ESCROW PAYOUT ───────────────────────────────────────────
      if (body.action === 'disburse_escrow') {
        const mnemonic = process.env.ESCROW_MNEMONIC;
        if (!mnemonic || !mnemonic.trim()) {
          return res.status(400).json({
            error: 'ESCROW_MNEMONIC environment variable is not configured in Vercel settings.'
          });
        }

        const { recipient, reward, bountyId } = body;
        if (!recipient || !reward) {
          return res.status(400).json({ error: 'recipient and reward parameters are required.' });
        }

        const lunaValue = Math.round(parseFloat(reward) * 100000);
        const validityStartHeight = await getNimiqBlockNumber();

        // Derive escrow vault keypair from mnemonic
        const keypair = deriveNimiqKeypairFromMnemonic(mnemonic);
        const derivedAddr = bytesToNimiqAddress(publicKeyToAddressBytes(keypair.publicKey));
        const recipientBytes = nimiqAddressToBytes(recipient);

        // Build and sign the transaction
        const hexTx = buildSignedNimiqTransaction({
          senderPrivateKey: keypair.secretKey,
          senderPublicKey: keypair.publicKey,
          recipientBytes,
          lunaValue,
          fee: 0,
          validityStartHeight,
          networkId: 42 // Nimiq mainnet
        });

        // Broadcast to Nimiq network
        const txHash = await broadcastNimiqTransaction(hexTx);

        return res.status(200).json({ success: true, txHash, lunaValue, recipient, senderAddress: derivedAddr });
      }

      // ─── STORE SYNC (bounties, submissions, payouts) ───────────────────────
      const store = await readStore();
      let { bounties, pendingSubmissions, approvedPayoutsHistory } = store;

      if (body.newBounty) {
        const existingIdx = bounties.findIndex(b => b.id === body.newBounty.id);
        if (existingIdx === -1) {
          bounties.unshift(body.newBounty);
        } else {
          bounties[existingIdx] = { ...bounties[existingIdx], ...body.newBounty };
        }
      }

      if (Array.isArray(body.bounties) && body.bounties.length > 0) {
        const existingIds = new Set(bounties.map(b => b.id));
        body.bounties.forEach(incoming => {
          if (!existingIds.has(incoming.id)) {
            bounties.push(incoming);
            existingIds.add(incoming.id);
          } else {
            const idx = bounties.findIndex(b => b.id === incoming.id);
            if (idx !== -1 && incoming.slotsRemaining < bounties[idx].slotsRemaining) {
              bounties[idx].slotsRemaining = incoming.slotsRemaining;
            }
          }
        });
      }

      if (Array.isArray(body.pendingSubmissions)) {
        const existingSubIds = new Set(pendingSubmissions.map(s => s.id));
        body.pendingSubmissions.forEach(incoming => {
          if (!existingSubIds.has(incoming.id)) {
            pendingSubmissions.unshift(incoming);
            existingSubIds.add(incoming.id);
          }
        });
        const approvedBountySubIds = new Set(
          approvedPayoutsHistory.map(p => p.bountyId + '_' + (p.workerAddress || '').toUpperCase().replace(/\s+/g,''))
        );
        pendingSubmissions = pendingSubmissions.filter(s => {
          const key = s.bountyId + '_' + (s.workerAddress || '').toUpperCase().replace(/\s+/g,'');
          return !approvedBountySubIds.has(key);
        });
      }

      if (Array.isArray(body.approvedPayoutsHistory)) {
        const existingPayIds = new Set(approvedPayoutsHistory.map(p => p.id));
        body.approvedPayoutsHistory.forEach(incoming => {
          if (!existingPayIds.has(incoming.id)) {
            approvedPayoutsHistory.unshift(incoming);
            existingPayIds.add(incoming.id);
          }
        });
      }

      if (bounties.length > 200) bounties = bounties.slice(0, 200);
      if (pendingSubmissions.length > 500) pendingSubmissions = pendingSubmissions.slice(0, 500);
      if (approvedPayoutsHistory.length > 1000) approvedPayoutsHistory = approvedPayoutsHistory.slice(0, 1000);

      const newStore = { bounties, pendingSubmissions, approvedPayoutsHistory, updatedAt: Date.now() };
      await writeStore(newStore);

      return res.status(200).json({ success: true, ...newStore });
    } catch(e) {
      console.error('POST handler error:', e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
