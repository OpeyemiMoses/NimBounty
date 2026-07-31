// Vercel Serverless API — NimBounty Global Store Sync Engine
// Manages global real-time synchronization for bounties, worker submissions, and approved payouts.

const ACTIVE_BLOB_ID = '019fb47c-e8e9-7698-9660-2086f93fafef';

async function readStore() {
  try {
    const res = await fetch(`https://jsonblob.com/api/jsonBlob/${ACTIVE_BLOB_ID}`, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`JSONBlob read status: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.bounties)) data.bounties = [];
    if (!Array.isArray(data.pendingSubmissions)) data.pendingSubmissions = [];
    if (!Array.isArray(data.approvedPayoutsHistory)) data.approvedPayoutsHistory = [];
    if (!data.profiles || typeof data.profiles !== 'object') data.profiles = {};
    if (!data.reports || typeof data.reports !== 'object') data.reports = {};
    return data;
  } catch(e) {
    return { bounties: [], pendingSubmissions: [], approvedPayoutsHistory: [], profiles: {}, reports: {} };
  }
}

async function writeStore(data) {
  try {
    const res = await fetch(`https://jsonblob.com/api/jsonBlob/${ACTIVE_BLOB_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`JSONBlob write status: ${res.status}`);
    return res.json();
  } catch (e) {
    console.error('writeStore error:', e);
    return data;
  }
}

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

  // ── POST: Handle global store sync ──
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const store = await readStore();
      let { bounties, pendingSubmissions, approvedPayoutsHistory, profiles, reports } = store;

      if (!Array.isArray(bounties)) bounties = [];
      if (!Array.isArray(pendingSubmissions)) pendingSubmissions = [];
      if (!Array.isArray(approvedPayoutsHistory)) approvedPayoutsHistory = [];
      if (!profiles || typeof profiles !== 'object') profiles = {};
      if (!reports || typeof reports !== 'object') reports = {};

      // 0. Handle New Reports
      if (body.newReport && body.newReport.targetAddress) {
        const cleanTarget = String(body.newReport.targetAddress).replace(/\s+/g, '').toUpperCase();
        if (!reports[cleanTarget]) {
          reports[cleanTarget] = { count: 0, list: [] };
        }
        reports[cleanTarget].count = (reports[cleanTarget].count || 0) + 1;
        reports[cleanTarget].list.unshift({
          id: `rep-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          reporterAddress: body.newReport.reporterAddress || 'ANONYMOUS',
          reason: body.newReport.reason || 'Flagged for review',
          timestamp: Date.now()
        });
      }

      // 0.1 Handle Settle / Dismiss Report
      if (body.settleReport && body.settleReport.targetAddress) {
        const cleanTarget = String(body.settleReport.targetAddress).replace(/\s+/g, '').toUpperCase();
        const cleanReporter = body.settleReport.reporterAddress ? String(body.settleReport.reporterAddress).replace(/\s+/g, '').toUpperCase() : null;

        if (reports[cleanTarget] && Array.isArray(reports[cleanTarget].list)) {
          if (cleanReporter) {
            reports[cleanTarget].list = reports[cleanTarget].list.filter(r => String(r.reporterAddress || '').replace(/\s+/g, '').toUpperCase() !== cleanReporter);
          } else if (body.settleReport.reportId) {
            reports[cleanTarget].list = reports[cleanTarget].list.filter(r => r.id !== body.settleReport.reportId);
          }
          reports[cleanTarget].count = reports[cleanTarget].list.length;
        }
      }

      // 0. Sync Profile Data
      if (body.profile && body.walletAddress) {
        const clean = String(body.walletAddress).replace(/\s+/g, '').toUpperCase();
        profiles[clean] = { ...profiles[clean], ...body.profile, updatedAt: Date.now() };
        if (body.profile.username) {
          const uname = String(body.profile.username).trim().toUpperCase();
          bounties.forEach(b => {
            if (b.posterAddress && String(b.posterAddress).replace(/\s+/g, '').toUpperCase() === clean) {
              b.sponsor = uname;
            }
          });
        }
      }

      // 1. Sync Bounties
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

      // 2. Sync Approved Payouts History (PERMANENTLY KEEP ALL APPROVED PAYOUTS)
      if (Array.isArray(body.approvedPayoutsHistory) && body.approvedPayoutsHistory.length > 0) {
        const existingPayKeys = new Set(
          approvedPayoutsHistory.map(p => p.id || `${p.bountyId}_${p.paidAt}_${(p.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`)
        );
        body.approvedPayoutsHistory.forEach(incoming => {
          const key = incoming.id || `${incoming.bountyId}_${incoming.paidAt}_${(incoming.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`;
          if (!existingPayKeys.has(key)) {
            approvedPayoutsHistory.unshift(incoming);
            existingPayKeys.add(key);
          }
        });
      }

      if (body.removeSubmissionId) {
        pendingSubmissions = pendingSubmissions.filter(s => s.id !== body.removeSubmissionId);
      }

      // 3. Sync Pending Submissions (Deduplicate strictly by submission ID)
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

      // 4. Purge pendingSubmissions that match an approved payout
      const approvedKeys = new Set(
        approvedPayoutsHistory.map(p => String(p.bountyId) + '_' + (p.workerAddress || '').toUpperCase().replace(/\s+/g,''))
      );
      pendingSubmissions = pendingSubmissions.filter(s => {
        const key = String(s.bountyId) + '_' + (s.workerAddress || '').toUpperCase().replace(/\s+/g,'');
        return !approvedKeys.has(key);
      });

      // 5. Dynamic slot recalculation based on real consumption
      bounties.forEach(b => {
        const bId = String(b.id);
        const pendingCount = pendingSubmissions.filter(s => String(s.bountyId) === bId && s.status === 'pending').length;
        const approvedCount = approvedPayoutsHistory.filter(p => String(p.bountyId) === bId).length;
        const total = parseInt(b.slotsTotal || 5);
        b.slotsRemaining = Math.max(0, total - (pendingCount + approvedCount));
      });

      const newStore = { bounties, pendingSubmissions, approvedPayoutsHistory, profiles, reports, updatedAt: Date.now() };
      await writeStore(newStore);

      return res.status(200).json({ success: true, ...newStore });
    } catch(e) {
      console.error('POST handler error:', e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
