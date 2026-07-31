// NimBounty Backend — Express Server for Railway
// Persistent JSON file store. No size limits. No third-party blob service.

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Data file path — Railway mounts persistent volume at /data if configured,
// otherwise falls back to local ./data directory
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(__dirname, 'data');

const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Store helpers ──────────────────────────────────────────────
function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return { bounties: [], pendingSubmissions: [], approvedPayoutsHistory: [], profiles: {}, reports: {} };
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.bounties)) data.bounties = [];
    if (!Array.isArray(data.pendingSubmissions)) data.pendingSubmissions = [];
    if (!Array.isArray(data.approvedPayoutsHistory)) data.approvedPayoutsHistory = [];
    if (!data.profiles || typeof data.profiles !== 'object') data.profiles = {};
    if (!data.reports || typeof data.reports !== 'object') data.reports = {};
    return data;
  } catch (e) {
    console.error('readStore error:', e.message);
    // NEVER return empty on read error — throw so caller can handle safely
    throw new Error('Store read failed: ' + e.message);
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('writeStore error:', e.message);
    throw new Error('Store write failed: ' + e.message);
  }
}

// ── Middleware ─────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Force no-cache for Nimiq Pay Mini App WebView
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ── Serve static frontend files ────────────────────────────────
// When run as "node backend/server.js" from repo root, process.cwd() = repo root
const FRONTEND_DIR = process.cwd();
app.use(express.static(FRONTEND_DIR));

// ── Health / API routes ─────────────────────────────────────────

// ── GET /api/bounties — Return full store ──────────────────────
app.get('/api/bounties', (req, res) => {
  try {
    const store = readStore();
    res.json(store);
  } catch (e) {
    res.status(500).json({ error: 'Store read error', message: e.message });
  }
});

// ── POST /api/bounties — Sync store ───────────────────────────
app.post('/api/bounties', (req, res) => {
  try {
    const body = req.body || {};
    const store = readStore();
    let { bounties, pendingSubmissions, approvedPayoutsHistory, profiles, reports } = store;

    if (!Array.isArray(bounties)) bounties = [];
    if (!Array.isArray(pendingSubmissions)) pendingSubmissions = [];
    if (!Array.isArray(approvedPayoutsHistory)) approvedPayoutsHistory = [];
    if (!profiles || typeof profiles !== 'object') profiles = {};
    if (!reports || typeof reports !== 'object') reports = {};

    // ── 0. Handle New Reports ──────────────────────────────────
    if (body.newReport && body.newReport.targetAddress) {
      const cleanTarget = String(body.newReport.targetAddress).replace(/\s+/g, '').toUpperCase();
      if (!reports[cleanTarget]) reports[cleanTarget] = { count: 0, list: [] };
      reports[cleanTarget].count = (reports[cleanTarget].count || 0) + 1;
      reports[cleanTarget].list.unshift({
        id: `rep-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        reporterAddress: body.newReport.reporterAddress || 'ANONYMOUS',
        reason: body.newReport.reason || 'Flagged for review',
        bountyId: body.newReport.bountyId || null,
        bountyTitle: body.newReport.bountyTitle || null,
        timestamp: Date.now()
      });
    }

    // ── 0.1 Handle Settle / Dismiss Report (POSTER CANNOT SELF-SETTLE) ──
    if (body.settleReport && body.settleReport.targetAddress && body.settleReport.reporterAddress) {
      const cleanTarget = String(body.settleReport.targetAddress).replace(/\s+/g, '').toUpperCase();
      const cleanReporter = String(body.settleReport.reporterAddress).replace(/\s+/g, '').toUpperCase();
      if (reports[cleanTarget] && Array.isArray(reports[cleanTarget].list)) {
        reports[cleanTarget].list = reports[cleanTarget].list.filter(r =>
          String(r.reporterAddress || '').replace(/\s+/g, '').toUpperCase() !== cleanReporter &&
          r.id !== body.settleReport.reportId
        );
        reports[cleanTarget].count = reports[cleanTarget].list.length;
      }
    }

    // ── 0.2 Sync Profile Data ──────────────────────────────────
    if (body.profile && body.walletAddress) {
      const clean = String(body.walletAddress).replace(/\s+/g, '').toUpperCase();
      // Strip avatar (too large for server store — stays in local storage)
      const { avatarUrl, ...profileWithoutAvatar } = body.profile;
      profiles[clean] = { ...profiles[clean], ...profileWithoutAvatar, updatedAt: Date.now() };
      if (body.profile.username) {
        const uname = String(body.profile.username).trim().toUpperCase();
        bounties.forEach(b => {
          if (b.posterAddress && String(b.posterAddress).replace(/\s+/g, '').toUpperCase() === clean) {
            b.sponsor = uname;
          }
        });
      }
    }

    // ── 1. Sync Bounties ───────────────────────────────────────
    if (body.newBounty) {
      const existingIdx = bounties.findIndex(b => String(b.id) === String(body.newBounty.id));
      if (existingIdx === -1) {
        bounties.unshift(body.newBounty);
      } else {
        bounties[existingIdx] = { ...bounties[existingIdx], ...body.newBounty };
      }
    }

    if (Array.isArray(body.bounties) && body.bounties.length > 0) {
      const existingIds = new Set(bounties.map(b => String(b.id)));
      body.bounties.forEach(incoming => {
        const key = String(incoming.id);
        if (!existingIds.has(key)) {
          bounties.push(incoming);
          existingIds.add(key);
        } else {
          const idx = bounties.findIndex(b => String(b.id) === key);
          if (idx !== -1 && incoming.slotsRemaining < bounties[idx].slotsRemaining) {
            bounties[idx].slotsRemaining = incoming.slotsRemaining;
          }
        }
      });
    }

    // ── 2. Sync Approved Payouts & Automated Rating Recovery ──
    if (Array.isArray(body.approvedPayoutsHistory) && body.approvedPayoutsHistory.length > 0) {
      const existingPayKeys = new Set(
        approvedPayoutsHistory.map(p => p.id || `${p.bountyId}_${p.paidAt}_${(p.workerAddress || '').toUpperCase().replace(/\s+/g, '')}`)
      );
      body.approvedPayoutsHistory.forEach(incoming => {
        const key = incoming.id || `${incoming.bountyId}_${incoming.paidAt}_${(incoming.workerAddress || '').toUpperCase().replace(/\s+/g, '')}`;
        if (!existingPayKeys.has(key)) {
          approvedPayoutsHistory.unshift(incoming);
          existingPayKeys.add(key);
          // Automated Rating Recovery
          if (incoming.posterAddress) {
            const cleanPoster = String(incoming.posterAddress).replace(/\s+/g, '').toUpperCase();
            if (reports[cleanPoster] && Array.isArray(reports[cleanPoster].list) && reports[cleanPoster].list.length > 0) {
              reports[cleanPoster].list.pop();
              reports[cleanPoster].count = reports[cleanPoster].list.length;
            }
          }
        }
      });
    }

    if (body.removeSubmissionId) {
      pendingSubmissions = pendingSubmissions.filter(s => s.id !== body.removeSubmissionId);
    }

    // ── 3. Sync Pending Submissions ────────────────────────────
    if (body.newSubmission && body.newSubmission.id) {
      const existingIdx = pendingSubmissions.findIndex(s => s.id === body.newSubmission.id);
      if (existingIdx === -1) {
        pendingSubmissions.unshift(body.newSubmission);
      } else {
        pendingSubmissions[existingIdx] = { ...pendingSubmissions[existingIdx], ...body.newSubmission };
      }
    } else if (Array.isArray(body.pendingSubmissions)) {
      if (body.replacePendingSubmissions) {
        pendingSubmissions = body.pendingSubmissions;
      } else {
        const existingSubIds = new Set(pendingSubmissions.map(s => s.id));
        body.pendingSubmissions.forEach(incoming => {
          if (!existingSubIds.has(incoming.id)) {
            pendingSubmissions.unshift(incoming);
            existingSubIds.add(incoming.id);
          } else {
            const idx = pendingSubmissions.findIndex(s => s.id === incoming.id);
            if (idx !== -1 && incoming.status !== pendingSubmissions[idx].status) {
              pendingSubmissions[idx] = { ...pendingSubmissions[idx], ...incoming };
            }
          }
        });
      }
    }

    // ── 4. Purge subs that match an approved payout ────────────
    const approvedKeys = new Set(
      approvedPayoutsHistory.map(p => String(p.bountyId) + '_' + (p.workerAddress || '').toUpperCase().replace(/\s+/g, ''))
    );
    pendingSubmissions = pendingSubmissions.filter(s => {
      const key = String(s.bountyId) + '_' + (s.workerAddress || '').toUpperCase().replace(/\s+/g, '');
      return !approvedKeys.has(key);
    });

    // ── 5. Dynamic slot recalculation ─────────────────────────
    bounties.forEach(b => {
      const bId = String(b.id);
      const pendingCount = pendingSubmissions.filter(s => String(s.bountyId) === bId && s.status === 'pending').length;
      const approvedCount = approvedPayoutsHistory.filter(p => String(p.bountyId) === bId).length;
      const total = parseInt(b.slotsTotal || 5);
      b.slotsRemaining = Math.max(0, total - (pendingCount + approvedCount));
    });

    const newStore = { bounties, pendingSubmissions, approvedPayoutsHistory, profiles, reports, updatedAt: Date.now() };
    writeStore(newStore);

    res.json({ success: true, ...newStore });
  } catch (e) {
    console.error('POST /api/bounties error:', e.message);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── Start server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ NimBounty backend running on port ${PORT}`);
  console.log(`📁 Store file: ${STORE_FILE}`);
});
