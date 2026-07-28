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
      
      // Update bounties pool if provided
      if (body.newBounty) {
        const exists = globalBounties.some(b => b.id === body.newBounty.id);
        if (!exists) {
          globalBounties.unshift(body.newBounty);
        } else {
          const idx = globalBounties.findIndex(b => b.id === body.newBounty.id);
          globalBounties[idx] = body.newBounty;
        }
      } else if (Array.isArray(body.bounties)) {
        globalBounties = body.bounties;
      }

      // STRICT SYNC FOR SUBMISSIONS: Overwrite globalSubmissions so approved/rejected items are permanently removed!
      if (Array.isArray(body.pendingSubmissions)) {
        globalSubmissions = body.pendingSubmissions;
      }

      // Update approved payouts history
      if (Array.isArray(body.approvedPayoutsHistory)) {
        globalPayouts = body.approvedPayoutsHistory;
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
