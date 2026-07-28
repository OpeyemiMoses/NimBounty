// Vercel Serverless API Function for NimBounty Global Public Sync

let globalBounties = [];
let globalSubmissions = [];
let globalPayouts = [];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      
      if (body.newBounty) {
        const exists = globalBounties.some(b => b.id === body.newBounty.id);
        if (!exists) {
          globalBounties.unshift(body.newBounty);
        }
      } else if (Array.isArray(body.bounties)) {
        const existingIds = new Set(globalBounties.map(b => b.id));
        body.bounties.forEach(b => {
          if (!existingIds.has(b.id)) {
            globalBounties.unshift(b);
            existingIds.add(b.id);
          }
        });
      }

      if (Array.isArray(body.pendingSubmissions)) {
        const existingSubIds = new Set(globalSubmissions.map(s => s.id));
        body.pendingSubmissions.forEach(s => {
          if (!existingSubIds.has(s.id)) {
            globalSubmissions.unshift(s);
            existingSubIds.add(s.id);
          }
        });
      }

      if (Array.isArray(body.approvedPayoutsHistory)) {
        const existingPayIds = new Set(globalPayouts.map(p => p.id));
        body.approvedPayoutsHistory.forEach(p => {
          if (!existingPayIds.has(p.id)) {
            globalPayouts.unshift(p);
            existingPayIds.add(p.id);
          }
        });
      }

      return res.status(200).json({
        success: true,
        bounties: globalBounties,
        pendingSubmissions: globalSubmissions,
        approvedPayoutsHistory: globalPayouts
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  return res.status(200).json({
    bounties: globalBounties,
    pendingSubmissions: globalSubmissions,
    approvedPayoutsHistory: globalPayouts
  });
}
