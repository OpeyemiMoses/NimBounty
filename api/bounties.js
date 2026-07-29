// Vercel Serverless API — NimBounty Global Store Sync Engine
// Manages global real-time synchronization for bounties, worker submissions, and approved payouts.

let activeBlobId = '019faf0c-b8b8-7f1e-881f-0264e03b798d';

async function createNewBlob(initialData = { bounties: [], pendingSubmissions: [], approvedPayoutsHistory: [] }) {
  try {
    const res = await fetch('https://jsonblob.com/api/jsonBlob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(initialData)
    });
    const loc = res.headers.get('location');
    if (loc) {
      const parts = loc.split('/');
      activeBlobId = parts[parts.length - 1];
    }
    return initialData;
  } catch (e) {
    return initialData;
  }
}

async function readStore() {
  try {
    const res = await fetch(`https://jsonblob.com/api/jsonBlob/${activeBlobId}`, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (res.status === 404) {
      return await createNewBlob();
    }
    if (!res.ok) throw new Error(`JSONBlob read status: ${res.status}`);
    return await res.json();
  } catch(e) {
    return { bounties: [], pendingSubmissions: [], approvedPayoutsHistory: [] };
  }
}

async function writeStore(data) {
  try {
    const res = await fetch(`https://jsonblob.com/api/jsonBlob/${activeBlobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.status === 404) {
      return await createNewBlob(data);
    }
    if (!res.ok) throw new Error(`JSONBlob write status: ${res.status}`);
    return res.json();
  } catch (e) {
    return await createNewBlob(data);
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
      let { bounties, pendingSubmissions, approvedPayoutsHistory } = store;

      if (!Array.isArray(bounties)) bounties = [];
      if (!Array.isArray(pendingSubmissions)) pendingSubmissions = [];
      if (!Array.isArray(approvedPayoutsHistory)) approvedPayoutsHistory = [];

      // 1. Sync Bounties
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

      // 2. Sync Approved Payouts History
      if (Array.isArray(body.approvedPayoutsHistory)) {
        const existingPayIds = new Set(approvedPayoutsHistory.map(p => p.id));
        body.approvedPayoutsHistory.forEach(incoming => {
          if (!existingPayIds.has(incoming.id)) {
            approvedPayoutsHistory.unshift(incoming);
            existingPayIds.add(incoming.id);
          }
        });
      }

      // 3. Sync Pending Submissions
      if (Array.isArray(body.pendingSubmissions)) {
        if (body.replacePendingSubmissions) {
          pendingSubmissions = body.pendingSubmissions;
        } else {
          const existingSubIds = new Set(pendingSubmissions.map(s => s.id));
          body.pendingSubmissions.forEach(incoming => {
            if (!existingSubIds.has(incoming.id)) {
              pendingSubmissions.unshift(incoming);
              existingSubIds.add(incoming.id);
            }
          });
        }
      }

      // 4. Purge pendingSubmissions that match an approved payout
      const approvedKeys = new Set(
        approvedPayoutsHistory.map(p => p.bountyId + '_' + (p.workerAddress || '').toUpperCase().replace(/\s+/g,''))
      );
      pendingSubmissions = pendingSubmissions.filter(s => {
        const key = s.bountyId + '_' + (s.workerAddress || '').toUpperCase().replace(/\s+/g,'');
        return !approvedKeys.has(key);
      });

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
