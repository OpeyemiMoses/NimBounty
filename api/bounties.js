// Vercel Serverless API — NimBounty Global Store Sync Engine
// Manages global real-time synchronization for bounties, worker submissions, and approved payouts.

let activeBlobId = '019faf56-d7e8-7f3c-882e-0486g15d910f';

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

      // 2. Sync Approved Payouts History
      if (Array.isArray(body.approvedPayoutsHistory) && body.approvedPayoutsHistory.length > 0) {
        const existingPayKeys = new Set(
          approvedPayoutsHistory.map(p => p.id || `${p.bountyId}_${(p.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`)
        );
        body.approvedPayoutsHistory.forEach(incoming => {
          const key = incoming.id || `${incoming.bountyId}_${(incoming.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`;
          if (!existingPayKeys.has(key)) {
            approvedPayoutsHistory.unshift(incoming);
            existingPayKeys.add(key);
          }
        });
      }

      // 3. Sync Pending Submissions
      if (body.newSubmission && body.newSubmission.id) {
        const alreadyExists = pendingSubmissions.some(s => s.id === body.newSubmission.id);
        if (!alreadyExists) {
          pendingSubmissions.unshift(body.newSubmission);
        } else {
          const idx = pendingSubmissions.findIndex(s => s.id === body.newSubmission.id);
          if (idx !== -1) pendingSubmissions[idx] = { ...pendingSubmissions[idx], ...body.newSubmission };
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
