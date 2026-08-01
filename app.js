/* ==========================================
   NIMBOUNTY V2 - COMPLETE FEATURE-RICH ENGINE
   ========================================== */

// Production API URL
const PRODUCTION_URL = 'https://nimbounty-production.up.railway.app';

// Permanent Wallet Key & Storage Keys — Version 1200 (Clean Slate)
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_wallet_permanent';
const STORAGE_KEY_PROFILE = 'nimbounty_profile_v1200';
const STORAGE_KEY_THEME = 'nimbounty_theme_v1200';
const STORAGE_KEY_LOCAL_BOUNTIES = 'nimbounty_pools_v1200';
const STORAGE_KEY_SUBS = 'nimbounty_subs_v1200';
const STORAGE_KEY_PAID_HISTORY = 'nimbounty_approved_payouts_history_v1200';
const STORAGE_KEY_REPUTATION = 'nimbounty_reputation_v1200';
const STORAGE_KEY_ONBOARDED_GLOBAL = 'nimbounty_onboarded_global_v1200';

// Global Application State
let userAccount = localStorage.getItem(STORAGE_KEY_USER_ACCT) || null;

// Recover legacy wallet account if present in older keys
if (!userAccount) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.includes('nimbounty_user_wallet')) {
        const val = localStorage.getItem(k);
        if (val && val.trim().length > 0) {
          userAccount = val.trim();
          localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
          break;
        }
      }
    }
  } catch(e) {}
}

// Clear pool & submission caches across prior versions while strictly preserving wallet & theme
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('nimbounty_') && !k.endsWith('_v1200') && !k.includes('wallet') && !k.includes('theme')) {
      localStorage.removeItem(k);
    }
  }
} catch(e) {}

let currentRole = 'worker'; // 'worker' | 'poster'
let currentView = 'app';
let lastActiveViewBeforeDisconnect = null;
let workerSubtab = 'active'; // 'active' | 'history'
let posterSubtab = 'create'; // 'create' | 'pools' | 'subs'
let globalReports = {};
let currentReportTarget = null;
let currentReportsModalTab = 'outbound';
let bounties = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL_BOUNTIES)) || [];
let pendingSubmissions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS)) || [];
let approvedPayoutsHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_PAID_HISTORY)) || [];
let liveBlockHeight = 0;
let uploadedImageDataUrl = null;
let activeClaimTimer = null;
let currentModalBountyId = null;
let lastRenderHash = '';
const INITIAL_SEED_BOUNTIES = [];

// Helper: Check Real Wallet Connection
function isRealWalletConnected() {
  return !!(userAccount && typeof userAccount === 'string' && userAccount.trim().length > 0);
}

// Helper: Get Nimiq SDK Provider
function getNimiqProvider() {
  if (typeof window !== 'undefined') {
    return window.nimiq || window.NimiqProvider || window.nimiqPay || window.NimiqPay || window.miniApp || null;
  }
  return null;
}

// Helper: Compare Nimiq Addresses Normalized
function isSameNimiqAddress(addr1, addr2) {
  if (!addr1 || !addr2) return false;
  const clean1 = String(addr1).replace(/\s+/g, '').toUpperCase();
  const clean2 = String(addr2).replace(/\s+/g, '').toUpperCase();
  return clean1 === clean2;
}

// Helper: Calculate effective slotsRemaining DYNAMICALLY from live data
// Never trust stored slotsRemaining — always compute from real pending + approved counts
function getEffectiveSlotsRemaining(bounty) {
  const bId = String(bounty.id);
  const total = parseInt(bounty.slotsTotal || 5);
  // Include 'pending' and 'rejected' so a rejected slot remains reserved for the rejected worker!
  const pendingCount = pendingSubmissions.filter(s => String(s.bountyId) === bId && (s.status === 'pending' || s.status === 'rejected')).length;
  const approvedCount = approvedPayoutsHistory.filter(p => String(p.bountyId) === bId).length;
  return Math.max(0, total - (pendingCount + approvedCount));
}

// Helper: Check 24-Hour Post-Expiration Unpaid Defaulter Lockout
function getDefaulterStatus(walletAddress) {
  if (!walletAddress) return { isDefaulter: false, isWarning: false };
  const cleanAddr = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const now = Date.now();

  const myBounties = bounties.filter(b => b.posterAddress && isSameNimiqAddress(b.posterAddress, cleanAddr));

  for (let b of myBounties) {
    const createdAt = b.createdAt || (b.id && String(b.id).startsWith('bounty-') ? parseInt(String(b.id).replace('bounty-', '')) : now);
    const durationHours = b.duration || 336;
    const expiresAt = b.expiresAt || (createdAt + (durationHours * 3600 * 1000));

    const pendingSubs = pendingSubmissions.filter(s => String(s.bountyId) === String(b.id) && s.status === 'pending');
    if (pendingSubs.length === 0) continue; // No pending workers left

    const timePastExpirationMs = now - expiresAt;

    // 1. Defaulter Lockout: >24 hours past expiration with unpaid pending workers
    if (timePastExpirationMs > (24 * 3600 * 1000)) {
      const hoursOverdue = Math.floor(timePastExpirationMs / (3600 * 1000));
      return {
        isDefaulter: true,
        isWarning: false,
        defaultedBounty: b,
        pendingCount: pendingSubs.length,
        hoursOverdue: hoursOverdue
      };
    }

    // 2. Warning Grace Period: 18-24 hours past expiration (6h remaining to lockout)
    if (timePastExpirationMs > (18 * 3600 * 1000)) {
      const hoursRemaining = Math.max(1, 24 - Math.floor(timePastExpirationMs / (3600 * 1000)));
      return {
        isDefaulter: false,
        isWarning: true,
        warningBounty: b,
        pendingCount: pendingSubs.length,
        hoursRemaining: hoursRemaining
      };
    }
  }

  return { isDefaulter: false, isWarning: false };
}

// Helper: Get Reputation & Unique Reporter Wallet Count
function getReputation(posterAddress) {
  if (!posterAddress) return { reports: 0, uniqueReporters: 0, isFlagged: false, list: [] };
  const clean = String(posterAddress).replace(/\s+/g, '').toUpperCase();
  const repData = globalReports[clean] || { count: 0, list: [] };
  const list = Array.isArray(repData.list) ? repData.list : [];

  // Single effective report rule: count distinct reporter wallets ONLY
  const uniqueReporters = new Set(list.map(r => String(r.reporterAddress || '').replace(/\s+/g, '').toUpperCase())).size;

  return {
    reports: list.length,
    uniqueReporters: uniqueReporters,
    isFlagged: uniqueReporters >= 3,
    list: list
  };
}

// Helper: Calculate Poster Rating & Reputation Stars
function getPosterRating(posterAddress) {
  const starIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="margin-right:2px; vertical-align:-1px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

  if (!posterAddress) return { score: '5.0', label: 'New Poster', count: 0, HTML: '' };
  const paidCount = approvedPayoutsHistory.filter(p => p.posterAddress && isSameNimiqAddress(p.posterAddress, posterAddress)).length;
  const rejectedCount = pendingSubmissions.filter(s => s.posterAddress && isSameNimiqAddress(s.posterAddress, posterAddress) && s.status === 'rejected').length;
  const rep = getReputation(posterAddress);
  const uniqueReporters = rep.uniqueReporters || 0;

  const def = getDefaulterStatus(posterAddress);
  if (def.isDefaulter) {
    const defaultTag = `<span style="background:rgba(239,68,68,0.15); color:var(--danger); border:1px solid rgba(239,68,68,0.3); font-size:0.68rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;" title="Account locked: Unpaid workers >24h past expiration"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> DEFAULTER (UNPAID WORKERS)</span>`;
    return { score: '1.0', label: 'DEFAULTER', count: paidCount, HTML: defaultTag };
  }

  if (paidCount === 0 && rejectedCount === 0 && uniqueReporters === 0) {
    return {
      score: '5.0',
      label: 'New Poster',
      count: 0,
      HTML: `<span style="font-size:0.7rem; font-weight:700; color:var(--gold-text); background:var(--gold-tint); border:1px solid var(--gold-border); padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center;">${starIcon} 5.0 (New Poster)</span>`
    };
  }

  // Score formula: ONLY 1 report per unique reporter wallet degrades rating!
  let numeric = 5.0 - (rejectedCount * 0.25) - (uniqueReporters * 0.5);
  if (paidCount > 0) numeric += Math.min(0.5, paidCount * 0.1);
  numeric = Math.max(1.0, Math.min(5.0, numeric));
  const scoreStr = numeric.toFixed(1);

  const badgeColor = numeric >= 4.0 ? 'var(--gold-text)' : (numeric >= 2.5 ? '#f59e0b' : 'var(--danger)');
  const badgeBg = numeric >= 4.0 ? 'var(--gold-tint)' : (numeric >= 2.5 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)');
  const badgeBorder = numeric >= 4.0 ? 'var(--gold-border)' : (numeric >= 2.5 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)');

  return {
    score: scoreStr,
    label: `${paidCount} Paid`,
    count: paidCount,
    HTML: `<span style="font-size:0.7rem; font-weight:800; color:${badgeColor}; background:${badgeBg}; border:1px solid ${badgeBorder}; padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center;" title="${paidCount} paid payouts, ${rejectedCount} rejections, ${uniqueReporters} unique reports">${starIcon} ${scoreStr} (${paidCount} Paid)</span>`
  };
}

let globalProfiles = {};

// Helper: Get User Profile Data
function getProfile(walletAddress) {
  if (!walletAddress) return { username: null, avatarUrl: null, joinedAt: null };
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const allProfiles = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}');

  if (!allProfiles[clean]) {
    allProfiles[clean] = { username: null, avatarUrl: null, joinedAt: Date.now() };
  } else if (!allProfiles[clean].joinedAt) {
    allProfiles[clean].joinedAt = Date.now();
  }

  // Merge server-authoritative profile data if present
  if (globalProfiles && globalProfiles[clean]) {
    const sProf = globalProfiles[clean];
    if (sProf.username) allProfiles[clean].username = sProf.username;
    if (sProf.avatarUrl || sProf.avatar) {
      allProfiles[clean].avatarUrl = sProf.avatarUrl || sProf.avatar;
    }
  }

  // Persistent avatar fallback check
  const localAvatar = localStorage.getItem(`nimbounty_avatar_${clean}`);
  if (localAvatar && !allProfiles[clean].avatarUrl) {
    allProfiles[clean].avatarUrl = localAvatar;
  }

  localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(allProfiles));
  return allProfiles[clean];
}

// Helper: Save User Profile Data & Sync Globally
function saveProfile(walletAddress, profileData) {
  if (!walletAddress) return;
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const allProfiles = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}');
  allProfiles[clean] = profileData;
  localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(allProfiles));

  if (profileData.avatarUrl) {
    localStorage.setItem(`nimbounty_avatar_${clean}`, profileData.avatarUrl);
  } else {
    localStorage.removeItem(`nimbounty_avatar_${clean}`);
  }

  // Also update globalProfiles in memory
  if (!globalProfiles) globalProfiles = {};
  globalProfiles[clean] = { ...globalProfiles[clean], ...profileData };

  pushUserProfile(clean, profileData);
}

async function pushUserProfile(walletAddress, profileData) {
  if (!walletAddress) return;
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: walletAddress,
        profile: profileData,
        updatedAt: Date.now()
      })
    });
  } catch (e) {}
}

// Helper: Get Display Name (ALL CAPS Username if set, else Shortened Address)
function getUserDisplayName(walletAddress) {
  if (!walletAddress) return 'CONNECT NIMIQ PAY';
  const profile = getProfile(walletAddress);
  if (profile.username && profile.username.trim()) {
    return profile.username.toUpperCase();
  }
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  return `${clean.substring(0, 6)}...${clean.substring(clean.length - 4)}`;
}

// Helper: Create Empty State HTML Component
function createEmptyStateHTML(title, description, svgIcon = '') {
  return `
    <div style="grid-column:1/-1; text-align:center; padding:40px 20px; background:var(--card); border:1px dashed var(--border); border-radius:16px; margin:10px 0;">
      ${svgIcon ? `<div style="margin-bottom:10px; display:flex; justify-content:center;">${svgIcon}</div>` : ''}
      <h4 style="font-size:1.05rem; font-weight:800; color:var(--ink); margin-bottom:6px;">${title}</h4>
      <p style="font-size:0.85rem; color:var(--muted); margin:0; max-width:440px; margin-left:auto; margin-right:auto;">${description}</p>
    </div>
  `;
}

// Helper: Calculate Remaining Expiration Time / Status for Bounty
function getBountyTimeLeftStr(b, userAddr = null) {
  if (!b) return '';

  // 1. Per-Worker check: if userAddr is provided and has been paid out, show CLOSED (RED)
  if (userAddr) {
    const hasUserPaid = approvedPayoutsHistory.some(p =>
      String(p.bountyId) === String(b.id) &&
      p.workerAddress &&
      isSameNimiqAddress(p.workerAddress, userAddr)
    );
    if (hasUserPaid) {
      return `<span style="color:#ef4444; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> CLOSED</span>`;
    }
  }

  // 2. Global Check: Has EVERY slot been paid out by the poster?
  const slotsTotal = b.slotsTotal || 5;
  const approvedCount = approvedPayoutsHistory.filter(p => String(p.bountyId) === String(b.id)).length;
  const pendingCount = pendingSubmissions.filter(s => String(s.bountyId) === String(b.id) && s.status === 'pending').length;
  const effectiveSlots = getEffectiveSlotsRemaining(b);

  const isAllPaidOut = (approvedCount >= slotsTotal) || (effectiveSlots <= 0 && pendingCount === 0 && approvedCount > 0);

  if (isAllPaidOut) {
    return `<span style="color:#ef4444; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> CLOSED</span>`;
  }

  // 3. Expiration Check: Timer naturally elapsed BEFORE slots/payouts were finished
  const createdAt = b.createdAt || (b.id && String(b.id).startsWith('bounty-') ? parseInt(String(b.id).replace('bounty-', '')) : Date.now());
  const durationHours = b.duration || 336;
  const expiresAt = b.expiresAt || (createdAt + (durationHours * 3600 * 1000));
  const diffMs = expiresAt - Date.now();

  if (diffMs <= 0) {
    return `<span style="color:#dc2626; background:rgba(220,38,38,0.12); border:1px solid rgba(220,38,38,0.3); font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> EXPIRED</span>`;
  }

  // 4. Active Countdown
  const totalMins = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  let timeStr = `${mins}m left`;
  if (days > 0) timeStr = `${days}d ${hours}h left`;
  else if (hours > 0) timeStr = `${hours}h ${mins}m left`;

  return `<span style="font-size:0.72rem; color:var(--muted); font-weight:700; display:inline-flex; align-items:center; gap:4px; background:var(--bg-subtle); padding:3px 8px; border-radius:6px; border:1px solid var(--border);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${timeStr}</span>`;
}

// Live Escrow Budget Calculator for Publish Campaign Form
function calculateTotalEscrow() {
  const rewardInput = document.getElementById('task-reward');
  const slotsInput = document.getElementById('task-slots');

  const reward = parseFloat(rewardInput?.value || 0);
  const slots = parseInt(slotsInput?.value || 0);
  const total = reward * slots;

  const singleEl = document.getElementById('calc-single');
  const slotsEl = document.getElementById('calc-slots-count');
  const totalEl = document.getElementById('calc-total');

  if (singleEl) singleEl.textContent = `${reward} NIM`;
  if (slotsEl) slotsEl.textContent = `${slots}`;
  if (totalEl) totalEl.textContent = `${total} NIM`;
}

// Toast Notifications
function showToastNotification(title, message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  if (isError) toast.style.borderLeftColor = 'var(--danger)';

  toast.innerHTML = `
    <div style="font-weight:800; font-size:0.9rem; color:var(--ink);">${title}</div>
    <div style="font-size:0.8rem; color:var(--muted); margin-top:2px;">${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// Theme System
function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(STORAGE_KEY_THEME, next);
  showToastNotification('Theme Toggled', `Switched to ${next} theme.`, false);
}

// ==========================================
// 1. FEATURE: PERSISTENT GLOBAL BACKEND SYNC (/api/bounties)
// ==========================================
async function fetchGlobalPublicBounties() {
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    const res = await fetch(apiEndpoint, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();

    // ── SERVER IS AUTHORITATIVE ──
    // Server state is absolute truth for all wallets globally.

    // 1. BOUNTIES — server is truth (preserve local unsynced bounties + auto-heal)
    if (Array.isArray(data.bounties)) {
      const serverIds = new Set(data.bounties.map(b => String(b.id)));
      const unsyncedLocalBounties = bounties.filter(b => b && b.id && !serverIds.has(String(b.id)));
      bounties = [...data.bounties, ...unsyncedLocalBounties];
      localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

      if (unsyncedLocalBounties.length > 0) {
        unsyncedLocalBounties.forEach(lb => syncGlobalPublicBounties(lb));
      }
    }

    // 2. APPROVED PAYOUTS HISTORY — server is truth
    if (Array.isArray(data.approvedPayoutsHistory)) {
      const serverPayKeys = new Set(
        data.approvedPayoutsHistory.map(p => p.id || `${p.bountyId}_${(p.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`)
      );
      const unsyncedLocalPays = approvedPayoutsHistory.filter(p => {
        const key = p.id || `${p.bountyId}_${(p.workerAddress || '').toUpperCase().replace(/\s+/g,'')}`;
        return !serverPayKeys.has(key);
      });
      approvedPayoutsHistory = [...data.approvedPayoutsHistory, ...unsyncedLocalPays];
      localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
    }

    // 3. PENDING SUBMISSIONS — server is truth (preserve local unsynced subs + auto-heal)
    // Server only stores truncated content (max 800 chars). Always restore full content from local memory.
    if (Array.isArray(data.pendingSubmissions)) {
      const serverSubIds = new Set(data.pendingSubmissions.map(s => s.id));
      const unsyncedLocalSubs = pendingSubmissions.filter(s => s && s.id && !serverSubIds.has(s.id));
      const mergedServerSubs = data.pendingSubmissions.map(ss => {
        const localMatch = pendingSubmissions.find(ls => ls.id === ss.id);
        if (localMatch && localMatch.content) {
          // Always prefer full local content over truncated server content
          return { ...ss, content: localMatch.content };
        }
        return ss;
      });
      pendingSubmissions = [...mergedServerSubs, ...unsyncedLocalSubs];

      // Auto-heal: re-push unsynced local submissions to guarantee poster receives every proof
      if (unsyncedLocalSubs.length > 0) {
        unsyncedLocalSubs.forEach(ls => pushNewSubmission(ls, bounties.find(b => String(b.id) === String(ls.bountyId))));
      }
    }

    // Mark any pending sub as 'approved' if it matches an approved payout
    const approvedKeys = new Set(
      approvedPayoutsHistory.map(p => String(p.bountyId) + '_' + (p.workerAddress || '').toUpperCase().replace(/\s+/g,''))
    );
    pendingSubmissions = pendingSubmissions.map(s => {
      const key = String(s.bountyId) + '_' + (s.workerAddress || '').toUpperCase().replace(/\s+/g,'');
      if (approvedKeys.has(key) && s.status !== 'approved') {
        return { ...s, status: 'approved' };
      }
      return s;
    });

    // Purge legacy corrupted [LOCAL_IMG:...] entries from pendingSubmissions
    pendingSubmissions = pendingSubmissions.filter(s => s && s.content && !s.content.startsWith('[LOCAL_IMG:'));

    try { localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions)); } catch(e) {}

    // 4. Sync Global Reports
    if (data.reports && typeof data.reports === 'object') {
      globalReports = data.reports;
    }

    // 5. Merge global user profiles (PRESERVE custom local avatars + sync server avatars)
    if (data.profiles && typeof data.profiles === 'object') {
      // Update in-memory globalProfiles so getProfile() can merge server data
      globalProfiles = data.profiles;

      const allProfiles = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}');
      Object.keys(data.profiles).forEach(cleanAddr => {
        const incoming = data.profiles[cleanAddr];
        if (incoming) {
          const currentLocal = allProfiles[cleanAddr] || {};
          const localAvatar = localStorage.getItem(`nimbounty_avatar_${cleanAddr}`);
          const serverAvatar = incoming.avatarUrl || incoming.avatar || null;
          const preservedAvatar = currentLocal.avatarUrl || localAvatar || serverAvatar || null;
          // Restore local avatar to server if server lost it
          if (preservedAvatar && !serverAvatar && userAccount && String(userAccount).replace(/\s+/g,'').toUpperCase() === cleanAddr) {
            setTimeout(() => pushUserProfile(cleanAddr, { ...currentLocal, avatarUrl: preservedAvatar }), 500);
          }
          allProfiles[cleanAddr] = { ...currentLocal, ...incoming, avatarUrl: preservedAvatar };
        }
      });
      localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(allProfiles));
    }

    // 4.5. Merge global user reports
    if (data.reports && typeof data.reports === 'object') {
      const localRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
      Object.keys(data.reports).forEach(cleanAddr => {
        const incomingRep = data.reports[cleanAddr];
        if (incomingRep) {
          localRep[cleanAddr] = {
            count: Math.max(localRep[cleanAddr]?.count || 0, incomingRep.count || 0),
            list: incomingRep.list || localRep[cleanAddr]?.list || []
          };
        }
      });
      localStorage.setItem(STORAGE_KEY_REPUTATION, JSON.stringify(localRep));
    }

    // 5. Only re-render if data actually changed (prevents UI flicker & form input destruction)
    const allProfStr = JSON.stringify(JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}'));
    const contentHash = JSON.stringify({
      bLen: bounties.length,
      bSlots: bounties.map(b => getEffectiveSlotsRemaining(b)).join(','),
      aLen: approvedPayoutsHistory.length,
      aIds: approvedPayoutsHistory.map(p => p.id).join(','),
      pLen: pendingSubmissions.length,
      pIds: pendingSubmissions.map(s => `${s.id}:${s.status}`).join(','),
      prof: allProfStr
    });

    if (contentHash === lastRenderHash) return; // Nothing changed — skip re-render entirely
    lastRenderHash = contentHash;

    renderBounties();
    renderPosterDashboard();
    renderSessionBar();
    renderProfile();
    renderDedicatedOrders();
    renderLeaderboard();
    renderGlobalRegistry();
    updateLandingStats();
    updateWalletUI();
  } catch (e) {
    // Silent graceful fallback
  }
}

// Push a single new submission to the server without overwriting other users' data.
// Includes the compressed image data URL so the poster receives the image on their device.
async function pushNewSubmission(newSub, updatedBounty = null) {
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    const payload = {
      newSubmission: newSub,
      newBounty: updatedBounty,
      updatedAt: Date.now()
    };

    console.log('[PUSH] Sending submission:', newSub.id, 'proofType:', newSub.proofType, 'contentLen:', (newSub.content || '').length);

    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log('[PUSH] Server response:', res.status, text.substring(0, 200));

    if (!res.ok) {
      console.error('[PUSH] FAILED - HTTP', res.status, text.substring(0, 500));
    }
  } catch (e) {
    console.error('[PUSH] Network error:', e);
  }
}

async function pushApprovedPayout(approvedItem, removedSubId, updatedBounty) {
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    const payload = {
      approvedPayoutsHistory: [approvedItem],
      removeSubmissionId: removedSubId || null,
      updatedAt: Date.now()
    };
    // Also send the updated bounty with current slot count
    if (updatedBounty) {
      payload.newBounty = updatedBounty;
    }

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('[pushApprovedPayout] Network error:', e);
  }
}

async function syncGlobalPublicBounties(updatedBountyObj = null) {
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;
    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newBounty: updatedBountyObj,
        updatedAt: Date.now()
      })
    });
  } catch (e) {}
}

// ==========================================
// 2. FEATURE: LIVE NIMIQ RPC BLOCK HEIGHT
// ==========================================
async function fetchNimiqLiveRPC() {
  const rpcTag = document.getElementById('live-rpc-tag');
  try {
    const response = await fetch('https://rpc.nimiq.network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getBlockNumber',
        params: [],
        id: 1
      })
    });
    const data = await response.json();
    if (data && data.result) {
      liveBlockHeight = parseInt(data.result, 16) || data.result;
      if (rpcTag) {
        rpcTag.innerHTML = `<span class="tag-pulse-dot"></span> LIVE NIMIQ PAY MAINNET &bull; BLOCK #${liveBlockHeight}`;
      }
    }
  } catch (err) {
    if (rpcTag) {
      rpcTag.innerHTML = `<span class="tag-pulse-dot"></span> LIVE ON NIMIQ PAY MINI APP SDK`;
    }
  }
}

// ==========================================
// 3. FEATURE: TYPEWRITER ANIMATION
// ==========================================
const typewriterPhrases = ["fast", "safe", "direct", "onchain", "instant"];
let phraseIndex = 0;
let charIndex = 4;
let isDeleting = true;

function runTypewriter() {
  const textEl = document.getElementById('typewriter-text');
  if (!textEl) return;

  const currentPhrase = typewriterPhrases[phraseIndex];
  if (isDeleting) {
    textEl.textContent = currentPhrase.substring(0, charIndex - 1);
    charIndex--;
  } else {
    textEl.textContent = currentPhrase.substring(0, charIndex + 1);
    charIndex++;
  }

  let timeout = isDeleting ? 70 : 120;
  if (!isDeleting && charIndex === currentPhrase.length) {
    timeout = 2200;
    isDeleting = true;
  } else if (isDeleting && charIndex === 0) {
    isDeleting = false;
    phraseIndex = (phraseIndex + 1) % typewriterPhrases.length;
    timeout = 400;
  }

  setTimeout(runTypewriter, timeout);
}

// ==========================================
// 4. WALLET CONNECTION & LIVE UPDATER ENGINE
// ==========================================
function checkWalletConnectionGate() {
  const appView = document.getElementById('view-app');
  const gateModal = document.getElementById('modal-wallet-connect-gate');
  const mobileNav = document.getElementById('mobile-bottom-nav');

  if (!isRealWalletConnected()) {
    if (currentView !== 'landing') {
      if (appView) appView.classList.add('app-blur-locked');
      if (mobileNav) mobileNav.classList.add('nav-blur-locked');
      if (gateModal) gateModal.style.display = 'flex';
    } else {
      if (appView) appView.classList.remove('app-blur-locked');
      if (mobileNav) mobileNav.classList.remove('nav-blur-locked');
      if (gateModal) gateModal.style.display = 'none';
    }
  } else {
    if (appView) appView.classList.remove('app-blur-locked');
    if (mobileNav) mobileNav.classList.remove('nav-blur-locked');
    if (gateModal) gateModal.style.display = 'none';
    const errEl = document.getElementById('wallet-gate-error');
    if (errEl) errEl.style.display = 'none';
  }
}

function renderQrCodeToContainer(containerEl, url) {
  if (!containerEl) return;
  const targetUrl = url || window.location.href;
  const encoded = encodeURIComponent(targetUrl);
  containerEl.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px; background:#ffffff; border-radius:16px; border:1px solid var(--border); box-shadow:0 4px 16px rgba(0,0,0,0.06);">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&color=1a1917&bgcolor=ffffff" width="180" height="180" style="border-radius:12px; display:block;" alt="Nimiq Pay QR Code" />
    </div>
  `;
}

function openDesktopConnectModal() {
  const qrBox = document.getElementById('desktop-connect-qr-box');
  if (qrBox) {
    const shareUrl = window.location.origin + window.location.pathname;
    renderQrCodeToContainer(qrBox, shareUrl);
  }

  const modal = document.getElementById('modal-desktop-connect');
  if (modal) modal.style.display = 'flex';
}

async function triggerWalletGateConnection() {
  const errEl = document.getElementById('wallet-gate-error');
  if (errEl) errEl.style.display = 'none';

  const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp);

  if (isNimiqApp) {
    try {
      await connectNimiqPayWallet();
      if (isRealWalletConnected()) {
        renderMobileBottomNav();
        checkWalletConnectionGate();
      } else {
        if (errEl) {
          errEl.textContent = 'User rejected connection. Please connect your wallet inside Nimiq Pay to continue.';
          errEl.style.display = 'block';
        }
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = 'User rejected connection. Please connect your wallet inside Nimiq Pay to continue.';
        errEl.style.display = 'block';
      }
    }
  } else {
    openDesktopConnectModal();
  }
}

async function connectNimiqPayWallet() {
  const provider = getNimiqProvider();

  if (provider && typeof provider.listAccounts === 'function') {
    try {
      showToastNotification('Connecting Nimiq Pay', 'Opening wallet accounts...', false);
      const accounts = await provider.listAccounts();
      if (accounts && accounts.length) {
        const rawAcct = accounts[0];
        let candidateAccount = typeof rawAcct === 'string' ? rawAcct : (rawAcct.address || rawAcct);
        userAccount = candidateAccount.replace(/\s+/g, '').toUpperCase();
        localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);

        await fetchGlobalPublicBounties();
        updateWalletUI();
        renderBounties();
        renderPosterDashboard();
        renderSessionBar();
        renderMobileBottomNav();

        // Restore exact view they were on before disconnect (e.g. Profile or Registry) without jumping
        const targetView = lastActiveViewBeforeDisconnect || currentView || 'app';
        showView(targetView);

        showToastNotification('Wallet Connected', `Wallet connected: ${getUserDisplayName(userAccount)}`, false);
        checkAndLaunchOnboarding();
        return;
      }
    } catch (e) {
      console.warn("Nimiq Pay listAccounts error:", e);
      throw e;
    }
  } else {
    openDesktopConnectModal();
  }
}

function handleWalletButtonClick() {
  if (isRealWalletConnected()) {
    const modal = document.getElementById('modal-wallet');
    if (modal) {
      const addrEl = document.getElementById('modal-wallet-address');
      if (addrEl) addrEl.textContent = userAccount;
      modal.style.display = 'flex';
    }
  } else {
    triggerWalletGateConnection();
  }
}

function confirmDisconnectWalletFromModal() {
  closeModal('modal-wallet');
  
  // Store exact active view BEFORE disconnect so reconnection restores exact page!
  lastActiveViewBeforeDisconnect = currentView;

  // Total Disconnect
  userAccount = null;
  localStorage.removeItem(STORAGE_KEY_USER_ACCT);

  updateWalletUI();
  renderMobileBottomNav();
  renderSessionBar();
  renderBounties();
  renderPosterDashboard();

  // Stay cleanly on current view and display blurred wallet connection gate modal!
  showView(lastActiveViewBeforeDisconnect || currentView || 'app');
  checkWalletConnectionGate();

  showToastNotification('Wallet Disconnected', 'Your wallet session has been disconnected.', false);
}

function updateWalletUI() {
  const walletTextDesktop = document.getElementById('wallet-text');
  const walletTextMobile = document.getElementById('wallet-text-mobile');
  const sessionWallet = document.getElementById('session-wallet-display');
  const nimEarnedEl = document.getElementById('session-nim-earned');
  
  const displayVal = isRealWalletConnected() ? getUserDisplayName(userAccount) : 'CONNECT NIMIQ PAY';

  if (walletTextDesktop) walletTextDesktop.textContent = displayVal;
  if (walletTextMobile) walletTextMobile.textContent = displayVal;

  if (sessionWallet) {
    sessionWallet.textContent = isRealWalletConnected() ? displayVal : 'CONNECT NIMIQ PAY';
  }

  if (nimEarnedEl) {
    if (isRealWalletConnected()) {
      const workerEarned = approvedPayoutsHistory
        .filter(p => isSameNimiqAddress(p.workerAddress, userAccount))
        .reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);
      nimEarnedEl.textContent = `${workerEarned} NIM Earned`;
      nimEarnedEl.style.display = 'block';
    } else {
      nimEarnedEl.style.display = 'none';
    }
  }

  renderWorkerStats();
  renderProfile();
}

function checkWalletConnectionGate() {
  const gateModal = document.getElementById('modal-wallet-connect-gate');
  const mobileNav = document.getElementById('mobile-bottom-nav');
  if (!gateModal) return;

  const activeViews = ['view-app', 'view-orders', 'view-registry', 'view-faq', 'view-protections', 'view-how-it-works'];

  // Suppress gate modal ONLY on public landing page ('landing')
  if (currentView === 'landing') {
    gateModal.style.display = 'none';
    activeViews.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('app-blur-locked');
    });
    if (mobileNav) mobileNav.classList.remove('nav-blur-locked');
    return;
  }

  if (!isRealWalletConnected()) {
    gateModal.style.display = 'flex';
    activeViews.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('app-blur-locked');
    });
    if (mobileNav) mobileNav.classList.add('nav-blur-locked');
  } else {
    gateModal.style.display = 'none';
    activeViews.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('app-blur-locked');
    });
    if (mobileNav) mobileNav.classList.remove('nav-blur-locked');
    const errEl = document.getElementById('wallet-gate-error');
    if (errEl) errEl.style.display = 'none';
  }
}

function handleLaunchApp() {
  const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp || (navigator.userAgent && navigator.userAgent.indexOf('Nimiq') !== -1));
  if (isNimiqApp || isRealWalletConnected()) {
    showView('app');
  } else {
    openDesktopConnectModal();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
  if (activeClaimTimer) clearInterval(activeClaimTimer);
}

function handleLogoClick(event) {
  if (event) event.preventDefault();
  if (currentView === 'landing') return;
  showView('app');
}

function scrollToSection(sectionId) {
  if (currentView !== 'landing') {
    showView('landing');
    setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
  } else {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  }
}

function toggleFaq(btnEl) {
  const item = btnEl.closest('.faq-item');
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ==========================================
// 5. VIEW ROUTER ENGINE
// ==========================================
function showView(viewName) {
  const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp);

  if (isNimiqApp && viewName === 'landing') {
    viewName = 'app';
  }

  currentView = viewName;

  const views = {
    landing: document.getElementById('view-landing'),
    app: document.getElementById('view-app'),
    orders: document.getElementById('view-orders'),
    registry: document.getElementById('view-registry'),
    faq: document.getElementById('view-faq'),
    protections: document.getElementById('view-protections'),
    'how-it-works': document.getElementById('view-how-it-works')
  };

  // Hide all views
  Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });

  const sessionBar = document.getElementById('console-session-bar');
  const profilePanel = document.getElementById('panel-profile');
  const workerView = document.getElementById('view-worker');
  const posterView = document.getElementById('view-poster');
  const mobileNav = document.getElementById('mobile-bottom-nav');

  // Handle profile: show view-app but only the profile panel
  if (viewName === 'profile') {
    if (views.app) views.app.style.display = 'block';
    if (workerView) workerView.style.display = 'none';
    if (posterView) posterView.style.display = 'none';
    if (profilePanel) {
      profilePanel.style.display = 'block';
      renderProfile();
    }
    if (sessionBar) sessionBar.style.display = 'flex';
    if (mobileNav && window.innerWidth <= 768) mobileNav.style.setProperty('display', 'flex', 'important');
    renderMobileBottomNav();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderSessionBar();
    return;
  }

  if (viewName === 'app') {
    if (profilePanel) profilePanel.style.display = 'none';
    if (currentRole === 'worker') {
      if (workerView) workerView.style.display = 'block';
      if (posterView) posterView.style.display = 'none';
    } else {
      if (workerView) workerView.style.display = 'none';
      if (posterView) posterView.style.display = 'block';
    }
  }

  // Session bar only visible in app view
  if (sessionBar) {
    sessionBar.style.display = (viewName === 'app') ? 'flex' : 'none';
  }

  // Info pages: hide bottom nav
  const infoPages = ['how-it-works', 'protections', 'faq'];
  if (infoPages.includes(viewName)) {
    if (mobileNav) mobileNav.style.setProperty('display', 'none', 'important');
    if (views[viewName]) views[viewName].style.display = 'block';
  } else if (views[viewName]) {
    views[viewName].style.display = 'block';
    if (viewName === 'registry') renderGlobalRegistry();
  } else if (views.app) {
    views.app.style.display = 'block';
  }

  renderMobileBottomNav();
  checkWalletConnectionGate();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'landing') {
    updateLandingStats();
  } else if (viewName === 'app') {
    renderBounties();
    renderSessionBar();
  } else if (viewName === 'orders') {
    renderDedicatedOrders();
  }
}

function updateLandingStats() {
  const elBounties = document.getElementById('landing-stat-bounties');
  const elPayouts = document.getElementById('landing-stat-payouts');

  const activeCount = bounties.filter(b => getEffectiveSlotsRemaining(b) > 0).length;
  const livePayoutsSum = approvedPayoutsHistory.reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);

  if (elBounties) elBounties.textContent = activeCount;
  if (elPayouts) elPayouts.textContent = `${livePayoutsSum.toFixed(1)} NIM`;
}

function renderSessionBar() {
  const displayEl = document.getElementById('session-wallet-display');
  const badgeEl = document.getElementById('session-mode-badge');
  const nimEarnedEl = document.getElementById('session-nim-earned');

  if (displayEl) {
    displayEl.textContent = isRealWalletConnected() ? getUserDisplayName(userAccount) : 'CONNECT NIMIQ PAY';
  }
  if (badgeEl) {
    badgeEl.textContent = currentRole === 'worker' ? 'Worker Mode' : 'Poster Mode';
    badgeEl.style.color = currentRole === 'worker' ? 'var(--gold)' : 'var(--emerald)';
  }

  // Update desktop role switcher buttons
  const workerBtn = document.getElementById('btn-role-worker');
  const posterBtn = document.getElementById('btn-role-poster');
  if (workerBtn && posterBtn) {
    if (currentRole === 'worker') {
      workerBtn.classList.add('active');
      posterBtn.classList.remove('active');
    } else {
      posterBtn.classList.add('active');
      workerBtn.classList.remove('active');
    }
  }

  // Update NIM earned badge in session card
  if (nimEarnedEl) {
    if (isRealWalletConnected()) {
      const workerEarned = approvedPayoutsHistory
        .filter(p => isSameNimiqAddress(p.workerAddress, userAccount))
        .reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);
      nimEarnedEl.textContent = `${workerEarned} NIM Earned`;
      nimEarnedEl.style.display = 'inline-block';
    } else {
      nimEarnedEl.style.display = 'none';
    }
  }

  updateLandingStats();
}

function openModeSwitchModal() {
  const workerBtn = document.getElementById('mode-modal-btn-worker');
  const posterBtn = document.getElementById('mode-modal-btn-poster');
  if (workerBtn && posterBtn) {
    if (currentRole === 'worker') {
      workerBtn.style.border = '2px solid #ffc72c';
      workerBtn.style.background = '#ffc72c';
      workerBtn.style.color = '#1a1917';
      workerBtn.style.fontWeight = '800';
      workerBtn.style.boxShadow = '0 4px 14px rgba(255, 199, 44, 0.4)';

      posterBtn.style.border = '1px solid var(--border)';
      posterBtn.style.background = 'var(--bg-subtle)';
      posterBtn.style.color = 'var(--ink)';
      posterBtn.style.fontWeight = '600';
      posterBtn.style.boxShadow = 'none';
      posterBtn.style.opacity = '0.85';
    } else {
      posterBtn.style.border = '2px solid #10b981';
      posterBtn.style.background = '#10b981';
      posterBtn.style.color = '#ffffff';
      posterBtn.style.fontWeight = '800';
      posterBtn.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.4)';

      workerBtn.style.border = '1px solid var(--border)';
      workerBtn.style.background = 'var(--bg-subtle)';
      workerBtn.style.color = 'var(--ink)';
      workerBtn.style.fontWeight = '600';
      workerBtn.style.boxShadow = 'none';
      workerBtn.style.opacity = '0.85';
    }
  }
  const modal = document.getElementById('modal-mode-switch');
  if (modal) modal.style.display = 'flex';
}

function switchToRole(role) {
  closeModal('modal-mode-switch');
  currentRole = role;
  const workerView = document.getElementById('view-worker');
  const posterView = document.getElementById('view-poster');
  const profilePanel = document.getElementById('panel-profile');

  if (profilePanel) profilePanel.style.display = 'none';

  if (role === 'worker') {
    if (workerView) workerView.style.display = 'block';
    if (posterView) posterView.style.display = 'none';
    switchWorkerSubtab(workerSubtab || 'active');
  } else {
    if (workerView) workerView.style.display = 'none';
    if (posterView) posterView.style.display = 'block';
    switchPosterSubtab(posterSubtab || 'create');
  }
  renderSessionBar();
  renderMobileBottomNav();
  showToastNotification('Mode Switched', `Switched to ${role === 'worker' ? 'Worker' : 'Poster'} Mode`, false);
}

function switchWorkerSubtab(subtab) {
  workerSubtab = subtab;
  document.getElementById('btn-worker-tab-active')?.classList.toggle('active', subtab === 'active');
  document.getElementById('btn-worker-tab-history')?.classList.toggle('active', subtab === 'history');
  renderBounties();
}

function switchPosterSubtab(subtab) {
  posterSubtab = subtab;
  document.getElementById('btn-poster-tab-create')?.classList.toggle('active', subtab === 'create');
  document.getElementById('btn-poster-tab-pools')?.classList.toggle('active', subtab === 'pools');
  document.getElementById('btn-poster-tab-subs')?.classList.toggle('active', subtab === 'subs');

  document.getElementById('poster-subview-create').style.display = subtab === 'create' ? 'block' : 'none';
  document.getElementById('poster-subview-pools').style.display = subtab === 'pools' ? 'block' : 'none';
  document.getElementById('poster-subview-subs').style.display = subtab === 'subs' ? 'block' : 'none';

  if (subtab === 'pools' || subtab === 'subs') renderPosterDashboard();
}

function renderDedicatedOrders() {
  const lists = [
    document.getElementById('dedicated-orders-list'),
    document.getElementById('worker-orders-list')
  ].filter(Boolean);

  if (!lists.length) return;

  if (!isRealWalletConnected()) {
    const empty = createEmptyStateHTML(
      'Wallet Required',
      'Connect your Nimiq Pay wallet to view your submitted orders and payout history.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
    );
    lists.forEach(el => el.innerHTML = empty);
    return;
  }

  const myApproved = approvedPayoutsHistory.filter(p => p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount));
  const myPending = pendingSubmissions.filter(s => s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'pending');
  const myRejected = pendingSubmissions.filter(s => s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected');

  if (myApproved.length === 0 && myPending.length === 0 && myRejected.length === 0) {
    const empty = createEmptyStateHTML(
      'No Submission Orders',
      'Your completed task payouts and order history will appear here once you complete bounties.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
    );
    lists.forEach(el => el.innerHTML = empty);
    return;
  }

  let html = '';

  // 1. Pending Review Section
  if (myPending.length > 0) {
    html += `<h4 style="font-size:0.9rem; font-weight:800; color:var(--gold); margin-bottom:10px; display:flex; align-items:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pending Poster Review (${myPending.length})</h4>`;
    html += myPending.map(s => `
      <div style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <strong style="font-size:0.95rem; color:var(--ink); display:block;">${s.bountyTitle}</strong>
          <span style="font-size:0.78rem; color:var(--muted);">Submitted: ${s.submittedAt || 'Recently'}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-weight:800; color:var(--gold); display:block;">${s.reward} NIM</span>
          <span style="font-size:0.75rem; background:var(--gold-tint); color:var(--gold); padding:2px 8px; border-radius:6px; font-weight:700;">Pending Review</span>
        </div>
      </div>
    `).join('');
  }

  // 2. Rejected Submissions Section
  if (myRejected.length > 0) {
    html += `<h4 style="font-size:0.9rem; font-weight:800; color:var(--danger); margin-top:20px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Rejected Tasks / Needs Action (${myRejected.length})</h4>`;
    html += myRejected.map(s => {
      const posterRating = getPosterRating(s.posterAddress);
      return `
        <div style="background:rgba(239,68,68,0.05); border:1.5px solid rgba(239,68,68,0.3); border-radius:16px; padding:18px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
            <div>
              <strong style="font-size:1rem; color:var(--ink); display:block;">${s.bountyTitle}</strong>
              <div style="font-size:0.78rem; color:var(--muted); margin-top:2px;">Poster: ${getUserDisplayName(s.posterAddress)} &bull; ${posterRating.HTML}</div>
            </div>
            <span style="font-size:0.75rem; background:rgba(239,68,68,0.15); color:var(--danger); border:1px solid rgba(239,68,68,0.3); padding:2px 8px; border-radius:6px; font-weight:800; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Rejected</span>
          </div>

          <div style="font-size:0.85rem; color:var(--ink); background:var(--card); border:1px solid rgba(239,68,68,0.25); padding:12px 14px; border-radius:12px; margin-bottom:14px; line-height:1.5;">
            <div style="display:flex; align-items:center; gap:6px; font-weight:800; color:var(--danger); margin-bottom:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>Poster's Rejection Reason:</span>
            </div>
            ${s.rejectionReason || 'No reason provided by poster.'}
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button onclick="openSubmitProofModal('${s.bountyId}')" class="btn-primary-sm" style="font-size:0.8rem; padding:8px 14px; display:inline-flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              <span>Resubmit Proof &rarr;</span>
            </button>
            ${(() => {
              const reportedTasks = JSON.parse(localStorage.getItem('nimbounty_reported_tasks_v1200') || '{}');
              const cleanUser = userAccount ? String(userAccount).replace(/\s+/g,'').toUpperCase() : '';
              const isReported = reportedTasks[`${s.bountyId}_${cleanUser}`];
              if (isReported) {
                return `<span style="font-size:0.78rem; color:var(--muted); font-weight:700; padding:8px 12px; background:var(--bg-subtle); border:1px solid var(--border); border-radius:10px; display:inline-flex; align-items:center; gap:4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Reported</span>`;
              }
              return `<button onclick="openReportPosterModal('${s.posterAddress}', '${s.bountyTitle}', '${s.bountyId}')" class="btn-ghost-sm" style="color:var(--danger); border-color:rgba(239,68,68,0.3); font-size:0.8rem; padding:8px 14px; display:inline-flex; align-items:center; gap:6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                <span>Report Poster</span>
              </button>`;
            })()}
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. Approved & Paid Out Section
  if (myApproved.length > 0) {
    html += `<h4 style="font-size:0.9rem; font-weight:800; color:var(--emerald); margin-top:20px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Approved &amp; Paid Out (${myApproved.length})</h4>`;
    html += myApproved.map(p => `
      <div style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <strong style="font-size:0.95rem; color:var(--ink); display:block;">${p.bountyTitle}</strong>
          <span style="font-size:0.78rem; color:var(--muted);">Payout Address: ${p.workerAddress ? p.workerAddress.substring(0, 14) + '...' : 'Nimiq Wallet'}</span>
        </div>
        <div style="text-align:right;">
          <span style="font-weight:800; color:var(--emerald); display:block;">+${p.reward} NIM</span>
          <span style="font-size:0.75rem; background:var(--emerald-tint); color:var(--emerald); padding:2px 8px; border-radius:6px; font-weight:700;">Paid Out</span>
        </div>
      </div>
    `).join('');
  }

  lists.forEach(el => el.innerHTML = html);
}

// ==========================================
// 6. MOBILE BOTTOM NAVIGATION ENGINE (DYNAMIC ROLE ICONS)
// ==========================================
function renderMobileBottomNav() {
  const nav = document.getElementById('mobile-bottom-nav');
  if (!nav) return;

  if (currentView === 'landing') {
    nav.style.display = 'none';
    return;
  }

  if (!isRealWalletConnected()) {
    nav.classList.add('nav-blur-locked');
  } else {
    nav.classList.remove('nav-blur-locked');
  }

  const isProfileOpen = currentView === 'app' && document.getElementById('panel-profile')?.style.display === 'block';
  const stackLogo = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

  if (currentRole === 'worker') {
    nav.innerHTML = `
      <button class="mobile-bottom-tab ${currentView === 'app' && workerSubtab === 'active' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('active')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        Active
      </button>
      <button class="mobile-bottom-tab ${currentView === 'app' && workerSubtab === 'history' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('history')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg>
        History
      </button>
      <button class="mobile-bottom-tab mode-center-tab" onclick="openModeSwitchModal();">
        ${stackLogo}
        Mode
      </button>
      <button class="mobile-bottom-tab ${currentView === 'orders' ? 'active' : ''}" onclick="switchMobileTab('orders')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Orders
      </button>
      <button class="mobile-bottom-tab ${isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('profile')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Profile
      </button>
    `;
  } else {
    // Poster Mode Bottom Nav
    const pendingCount = pendingSubmissions.filter(s => isSameNimiqAddress(s.posterAddress, userAccount) && s.status === 'pending').length;

    nav.innerHTML = `
      <button class="mobile-bottom-tab ${currentView === 'app' && posterSubtab === 'create' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('publish')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        Publish
      </button>
      <button class="mobile-bottom-tab ${currentView === 'app' && posterSubtab === 'pools' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('pools')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        My Pools
      </button>
      <button class="mobile-bottom-tab mode-center-tab" onclick="openModeSwitchModal();">
        ${stackLogo}
        Mode
      </button>
      <button class="mobile-bottom-tab ${currentView === 'app' && posterSubtab === 'subs' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('subs')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
        Submissions ${pendingCount > 0 ? `<span class="tab-badge-count" style="margin-left:2px;">${pendingCount}</span>` : ''}
      </button>
      <button class="mobile-bottom-tab ${isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('profile')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Profile
      </button>
    `;
  }
}

function switchMobileTab(tab) {
  const profilePanel  = document.getElementById('panel-profile');
  const workerView    = document.getElementById('view-worker');
  const posterView    = document.getElementById('view-poster');
  const appView       = document.getElementById('view-app');
  const ordersView    = document.getElementById('view-orders');
  const registryView  = document.getElementById('view-registry');
  const landingView   = document.getElementById('view-landing');
  const sessionBar    = document.getElementById('console-session-bar');
  const mobileNav     = document.getElementById('mobile-bottom-nav');

  // Hide landing, orders, and registry; always keep tabs scoped
  if (landingView)  landingView.style.display  = 'none';
  if (ordersView)   ordersView.style.display   = 'none';
  if (registryView) registryView.style.display = 'none';

  if (tab === 'orders') {
    if (appView)      appView.style.display      = 'none';
    if (profilePanel) profilePanel.style.display = 'none';
    if (ordersView)   ordersView.style.display   = 'block';
    if (sessionBar)   sessionBar.style.display   = 'none';
    currentView = 'orders';
    renderDedicatedOrders();
  } else {
    // Make the app wrapper visible
    if (appView)    appView.style.display    = 'block';
    if (sessionBar) sessionBar.style.display = 'flex';
    currentView = 'app';

    if (tab === 'profile') {
      if (profilePanel) profilePanel.style.display = 'block';
      if (workerView)   workerView.style.display   = 'none';
      if (posterView)   posterView.style.display   = 'none';
      renderProfile();

    } else if (tab === 'publish' || tab === 'pools' || tab === 'subs') {
      currentRole = 'poster';
      if (profilePanel) profilePanel.style.display = 'none';
      if (workerView)   workerView.style.display   = 'none';
      if (posterView)   posterView.style.display   = 'block';
      if (tab === 'publish') switchPosterSubtab('create');
      else if (tab === 'pools') switchPosterSubtab('pools');
      else switchPosterSubtab('subs');

    } else if (tab === 'active' || tab === 'history') {
      currentRole = 'worker';
      if (profilePanel) profilePanel.style.display = 'none';
      if (workerView)   workerView.style.display   = 'block';
      if (posterView)   posterView.style.display   = 'none';
      switchWorkerSubtab(tab);
    }
  }

  renderSessionBar();
  renderMobileBottomNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function calculateTotalEscrow() {
  const reward = parseFloat(document.getElementById('task-reward')?.value) || 50;
  const slots = parseInt(document.getElementById('task-slots')?.value) || 10;
  const single = document.getElementById('calc-single');
  const slotsCount = document.getElementById('calc-slots-count');
  const total = document.getElementById('calc-total');
  if (single) single.textContent = `${reward} NIM`;
  if (slotsCount) slotsCount.textContent = slots;
  if (total) total.textContent = `${(reward * slots).toLocaleString()} NIM`;
}
function calculateTotalPool() { calculateTotalEscrow(); }

// ==========================================
// 7. PROFILE SYSTEM (Screenshot 1 Layout)
// ==========================================
// Image Compression Helper for Profile Avatar
function compressImageFile(file, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      const minDim = Math.min(width, height);
      const startX = (width - minDim) / 2;
      const startY = (height - minDim) / 2;

      canvas.width = 200;
      canvas.height = 200;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, 200, 200);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      callback(compressedDataUrl);
    };
    img.onerror = function() {
      callback(e.target.result);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function uploadProfileAvatar(event) {
  const file = event.target.files[0];
  if (!file || !userAccount) return;

  compressImageFile(file, function(compressedUrl) {
    try {
      const profile = getProfile(userAccount);
      profile.avatarUrl = compressedUrl;
      saveProfile(userAccount, profile);
      showToastNotification('Photo Updated', 'Profile avatar updated!', false);
      renderProfile();
      updateWalletUI();
    } catch (e) {
      console.error("Avatar save error:", e);
      showToastNotification('Photo Save Error', 'Failed to save image. Try a different file.', true);
    }
  });
}

let pendingUsernameToSet = null;

function openSetUsernameModal() {
  if (!userAccount) {
    showToastNotification('Wallet Required', 'Connect your wallet to set a username.', true);
    return;
  }
  const profile = getProfile(userAccount);
  const input = document.getElementById('username-input');
  if (input) input.value = profile.username ? profile.username : '';
  const modal = document.getElementById('modal-set-username');
  if (modal) modal.style.display = 'flex';
}

function confirmSetUsername() {
  const input = document.getElementById('username-input');
  const val = input ? input.value.trim().toUpperCase() : '';
  if (!val || val.length < 3) {
    showToastNotification('Username Required', 'Username must be at least 3 characters.', true);
    return;
  }
  if (!/^[A-Z0-9_]+$/.test(val)) {
    showToastNotification('Invalid Format', 'Username can only contain letters, numbers, and underscores.', true);
    return;
  }
  pendingUsernameToSet = val;
  closeModal('modal-set-username');

  const displayEl = document.getElementById('username-confirm-display');
  if (displayEl) displayEl.textContent = val;
  const modal = document.getElementById('modal-confirm-username');
  if (modal) modal.style.display = 'flex';
}

async function finalizeUsername() {
  if (!pendingUsernameToSet || !userAccount) return;
  closeModal('modal-confirm-username');

  const profile = getProfile(userAccount);
  profile.username = pendingUsernameToSet;
  saveProfile(userAccount, profile);

  showToastNotification('Username Synced', `Permanent username set to: ${pendingUsernameToSet}`, false);
  pendingUsernameToSet = null;

  renderProfile();
  renderSessionBar();
  renderBounties();
  renderPosterDashboard();
  renderLeaderboard();
  renderGlobalRegistry();
}

function getAccountReports(walletAddr) {
  if (!walletAddr) return { count: 0, reports: 0, list: [], isFlagged: false };
  const cleanTarget = String(walletAddr).replace(/\s+/g, '').toUpperCase();
  const localRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');

  let combinedList = [];
  const seenIds = new Set();

  if (globalReports && typeof globalReports === 'object') {
    Object.keys(globalReports).forEach(targetKey => {
      if (isSameNimiqAddress(targetKey, cleanTarget)) {
        const item = globalReports[targetKey];
        if (item && Array.isArray(item.list)) {
          item.list.forEach(r => {
            if (r.id && !seenIds.has(r.id)) {
              combinedList.push(r);
              seenIds.add(r.id);
            }
          });
        }
      }
    });
  }

  Object.keys(localRep).forEach(targetKey => {
    if (isSameNimiqAddress(targetKey, cleanTarget)) {
      const item = localRep[targetKey];
      if (item && Array.isArray(item.list)) {
        item.list.forEach(r => {
          if (r.id && !seenIds.has(r.id)) {
            combinedList.push(r);
            seenIds.add(r.id);
          }
        });
      }
    }
  });

  const uniqueReporters = new Set(combinedList.map(r => String(r.reporterAddress || '').replace(/\s+/g, '').toUpperCase()));
  const effectiveCount = uniqueReporters.size;

  return {
    count: effectiveCount,
    reports: effectiveCount,
    list: combinedList,
    isFlagged: effectiveCount >= 3
  };
}

function getReputation(walletAddr) {
  return getAccountReports(walletAddr);
}

function getPosterRating(posterAddress) {
  if (!posterAddress) return { rating: '5.0', HTML: '<span class="star-rating" style="font-size:0.75rem; font-weight:800; color:var(--gold-text); background:var(--gold-tint); border:1px solid var(--gold-border); padding:2px 8px; border-radius:6px; font-family:var(--font-mono);">★ 5.0</span>' };
  const cleanPoster = String(posterAddress).replace(/\s+/g, '').toUpperCase();

  const paidCount = approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.posterAddress, cleanPoster)).length;
  const repData = getReputation(cleanPoster);
  const reportCount = repData.reports;

  let ratingVal = 5.0 - (reportCount * 0.5) + (paidCount * 0.1);
  ratingVal = Math.max(1.0, Math.min(5.0, ratingVal));
  const ratingStr = ratingVal.toFixed(1);

  const starHTML = `<span class="star-rating" style="font-size:0.75rem; font-weight:800; color:var(--gold-text); background:var(--gold-tint); border:1px solid var(--gold-border); padding:2px 8px; border-radius:6px; font-family:var(--font-mono);">★ ${ratingStr}</span>`;

  return { rating: ratingStr, HTML: starHTML };
}

async function settleReport(posterAddress, workerAddress) {
  if (!posterAddress) return;
  const cleanPoster = String(posterAddress).replace(/\s+/g, '').toUpperCase();
  const cleanWorker = workerAddress ? String(workerAddress).replace(/\s+/g, '').toUpperCase() : null;

  if (globalReports && typeof globalReports === 'object') {
    Object.keys(globalReports).forEach(targetKey => {
      if (isSameNimiqAddress(targetKey, cleanPoster)) {
        if (globalReports[targetKey] && Array.isArray(globalReports[targetKey].list)) {
          if (cleanWorker) {
            globalReports[targetKey].list = globalReports[targetKey].list.filter(r => !isSameNimiqAddress(r.reporterAddress, cleanWorker));
          } else {
            globalReports[targetKey].list.pop();
          }
          globalReports[targetKey].count = globalReports[targetKey].list.length;
        }
      }
    });
  }

  const localRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
  Object.keys(localRep).forEach(targetKey => {
    if (isSameNimiqAddress(targetKey, cleanPoster)) {
      if (localRep[targetKey] && Array.isArray(localRep[targetKey].list)) {
        if (cleanWorker) {
          localRep[targetKey].list = localRep[targetKey].list.filter(r => !isSameNimiqAddress(r.reporterAddress, cleanWorker));
        } else {
          localRep[targetKey].list.pop();
        }
        localRep[targetKey].count = localRep[targetKey].list.length;
      }
    }
  });
  localStorage.setItem(STORAGE_KEY_REPUTATION, JSON.stringify(localRep));
}

function renderProfile() {
  const el = document.getElementById('profile-content');
  if (!el) return;

  if (!isRealWalletConnected()) {
    el.innerHTML = `
      <div style="text-align:center; padding:50px 20px;">
        <div style="width:64px; height:64px; background:var(--gold-tint); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        </div>
        <h3 style="font-size:1.3rem; font-weight:800; margin-bottom:8px;">Wallet Disconnected</h3>
        <p style="font-size:0.85rem; color:var(--muted); margin-bottom:20px;">Connect your Nimiq Pay wallet to view trader profile and statistics.</p>
        <button class="btn-primary-lg" onclick="connectNimiqPayWallet()" style="justify-content:center; margin:0 auto;">Connect Wallet &rarr;</button>
      </div>
    `;
    return;
  }

  const profile = getProfile(userAccount);
  const rep = getReputation(userAccount);

  const bountiesPosted = bounties.filter(b => isSameNimiqAddress(b.posterAddress, userAccount)).length;
  const workerCompleted = approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.workerAddress, userAccount)).length;
  const workerRejections = pendingSubmissions.filter(s => isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected').length;

  let ratingVal = 5.0;
  if (workerCompleted + workerRejections > 0) {
    const successRatio = workerCompleted / (workerCompleted + workerRejections);
    ratingVal = Math.max(1.0, Math.min(5.0, (successRatio * 4.0) + 1.0));
  }
  const ratingStr = ratingVal.toFixed(1);

  const displayUsername = profile.username ? profile.username.toUpperCase() : 'SET USERNAME';
  const hasCustomAvatar = !!profile.avatarUrl;
  const joinedDateStr = profile.joinedAt
    ? new Date(profile.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const avatarSvg = hasCustomAvatar
    ? `<img src="${profile.avatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`
    : `<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="var(--gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 6L6 19l26 13 26-13L32 6zM6 45l26 13 26-13M6 32l26 13 26-13"/></svg>`;

  const posterPaidOutNIM = userAccount
    ? approvedPayoutsHistory
        .filter(p => isSameNimiqAddress(p.posterAddress, userAccount))
        .reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0)
        .toFixed(1)
    : '0.0';

  el.innerHTML = `
    <!-- Top Header Navigation -->
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px; font-size:0.75rem; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
      <span>USER PROFILE</span>
    </div>

    <!-- Unified Profile Card (Matches User Screenshot) -->
    <div style="background:var(--card); border:1px solid var(--border); border-radius:20px; overflow:hidden; margin-bottom:16px; box-shadow:0 2px 12px rgba(0,0,0,0.03);">
      
      <!-- Top Section -->
      <div style="padding:20px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:14px; min-width:0;">
          <!-- Avatar Container -->
          <div style="position:relative; width:64px; height:64px; flex-shrink:0;">
            <div style="width:64px; height:64px; border-radius:50%; background:#000; border:2px solid var(--border); overflow:hidden; display:flex; align-items:center; justify-content:center;">
              ${avatarSvg}
            </div>
            <button onclick="document.getElementById('profile-avatar-input').click()" title="Change Profile Picture" style="position:absolute; bottom:-2px; right:-2px; width:24px; height:24px; border-radius:50%; background:#1b6348; border:2px solid #ffffff; display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <input type="file" id="profile-avatar-input" accept="image/*" onchange="uploadProfileAvatar(event)" style="display:none;" />
          </div>

          <!-- User Info -->
          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <h3 style="font-size:1.35rem; font-weight:800; color:var(--ink); margin:0; letter-spacing:-0.02em;">${displayUsername}</h3>
              ${getDefaulterStatus(userAccount).isDefaulter ? `
                <span style="background:rgba(239,68,68,0.15); color:var(--danger); border:1px solid rgba(239,68,68,0.3); font-size:0.68rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  DEFAULTER (UNPAID WORKERS)
                </span>
              ` : ''}
              ${profile.username ? `
                <button onclick="openSetUsernameModal()" title="Sync username globally" style="background:none; border:none; cursor:pointer; padding:2px; color:var(--muted); display:inline-flex; align-items:center; opacity:0.6;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              ` : `
                <button class="btn-ghost-sm" onclick="openSetUsernameModal()" style="font-size:0.75rem; padding:4px 10px; border-color:var(--gold); color:var(--gold);">+ Set Username</button>
              `}
            </div>
            ${hasCustomAvatar ? `
              <button onclick="removeProfileAvatar()" style="background:none; border:none; color:var(--muted); font-size:0.82rem; cursor:pointer; padding:0; margin-top:4px; display:block; font-weight:500;">Remove photo</button>
            ` : ''}
          </div>
        </div>

        <!-- Address Pill -->
        <div class="address-pill-copy" onclick="navigator.clipboard.writeText('${userAccount}'); showToastNotification('Address Copied', 'Address copied to clipboard.', false);" style="padding:6px 14px; border-radius:20px; border:1px solid var(--border); background:var(--bg-subtle); font-family:var(--font-mono); font-size:0.82rem; font-weight:600; color:var(--muted); display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
          <span>${userAccount.substring(0,6)}...${userAccount.substring(userAccount.length-4)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
      </div>

      <!-- Bottom 4-Column Grid -->
      <div style="border-top:1px solid var(--border); display:grid; grid-template-columns:repeat(4, 1fr); background:var(--card);">
        <div style="padding:14px 8px; text-align:center; border-right:1px solid var(--border);">
          <div style="font-size:1.25rem; font-weight:800; color:var(--ink); line-height:1.2;">${bountiesPosted}</div>
          <div style="font-size:0.65rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">MY BOUNTIES</div>
        </div>
        <div style="padding:14px 8px; text-align:center; border-right:1px solid var(--border);">
          <div style="font-size:1.25rem; font-weight:800; color:var(--ink); line-height:1.2;">${workerCompleted}</div>
          <div style="font-size:0.65rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">COMPLETED</div>
        </div>
        <div style="padding:14px 8px; text-align:center; border-right:1px solid var(--border);">
          <div style="font-size:1.25rem; font-weight:800; color:var(--ink); line-height:1.2;">${ratingStr}</div>
          <div style="font-size:0.65rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">RATING</div>
        </div>
        <div onclick="openReportsModal()" style="padding:14px 8px; text-align:center; cursor:pointer;" title="View dispute & report details">
          <div style="font-size:1.25rem; font-weight:800; color:${rep.reports > 0 ? 'var(--danger)' : 'var(--ink)'}; line-height:1.2;">${rep.reports || 0}</div>
          <div style="font-size:0.65rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px;">REPORTS</div>
        </div>
      </div>

    </div>

    <!-- Particular Wallet NIM Paid Out Thin Card -->
    <div style="background:var(--card); border:1px solid var(--border); border-radius:14px; padding:12px 16px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; box-shadow:var(--shadow-sm);">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:36px; height:36px; border-radius:10px; background:var(--gold-tint); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div>
          <div style="font-size:0.86rem; font-weight:800; color:var(--ink);">NIM Paid Out by You</div>
          <div style="font-size:0.7rem; color:var(--muted); font-weight:600;">Total NIM rewards funded from this wallet</div>
        </div>
      </div>
      <div style="font-family:var(--font-mono); font-size:1.15rem; font-weight:900; color:var(--gold-text);">${posterPaidOutNIM} NIM</div>
    </div>

    <!-- Menu Action Cards -->
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
      <div class="menu-action-card" onclick="showView('registry')">
        <div class="menu-action-icon" style="display:flex; align-items:center; justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
        </div>
        <div style="flex:1;">
          <div class="menu-action-title">Global Bounty Registry</div>
          <div class="menu-action-desc">View public live ledger of all created bounties &amp; stats</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="openLeaderboardModal()" style="border:1.5px solid var(--gold); background:linear-gradient(135deg, rgba(255,199,44,0.08) 0%, rgba(255,199,44,0.02) 100%);">
        <div class="menu-action-icon" style="background:var(--gold-tint); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>
        </div>
        <div style="flex:1;">
          <div class="menu-action-title" style="color:var(--gold-text); display:flex; align-items:center; gap:6px;">
            Global Leaderboard <span style="background:var(--gold); color:#1a1917; font-size:0.65rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase;">LIVE RANKINGS</span>
          </div>
          <div class="menu-action-desc">Track top earning worker wallets &amp; global NIM rankings</div>
        </div>
        <span class="menu-action-arrow" style="color:var(--gold);">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="showView('how-it-works')">
        <div class="menu-action-icon" style="display:flex; align-items:center; justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <div style="flex:1;">
          <div class="menu-action-title">How It Works</div>
          <div class="menu-action-desc">Learn about bounty creation, proof signing &amp; payouts</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="showView('protections')">
        <div class="menu-action-icon" style="display:flex; align-items:center; justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div style="flex:1;">
          <div class="menu-action-title">Built-in Protections</div>
          <div class="menu-action-desc">Cryptographic signing &amp; anti-sybil device IDs</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="showView('faq')">
        <div class="menu-action-icon" style="display:flex; align-items:center; justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div style="flex:1;">
          <div class="menu-action-title">Frequently Asked Questions</div>
          <div class="menu-action-desc">Common questions about NimBounty micro-tasks</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>
    </div>
  `;
}

// Username Confirm & Finalize
let _pendingUsernameChoice = null;

function openSetUsernameModal() {
  if (!userAccount) return;
  const profile = getProfile(userAccount);
  const input = document.getElementById('username-input');
  const modal = document.getElementById('modal-set-username');
  const titleEl = document.querySelector('#modal-set-username h3');
  const descEl = document.querySelector('#modal-set-username p');
  const btnEl = document.querySelector('#modal-set-username .btn-primary-lg');

  if (profile.username) {
    // Already set — allow re-sync to global server
    if (input) { input.value = profile.username; input.disabled = true; input.style.opacity = '0.5'; input.style.cursor = 'not-allowed'; }
    if (titleEl) titleEl.textContent = 'Sync Username Globally';
    if (descEl) descEl.textContent = 'Re-sync your username to the global server so it appears on the leaderboard and registry for all users.';
    if (btnEl) btnEl.textContent = 'Sync \u2192';
  } else {
    if (input) { input.value = ''; input.disabled = false; input.style.opacity = '1'; input.style.cursor = ''; }
    if (titleEl) titleEl.textContent = 'Set Username';
    if (descEl) descEl.textContent = 'Choose a permanent username linked to your wallet address.';
    if (btnEl) btnEl.textContent = 'Set Username \u2192';
  }
  if (modal) modal.style.display = 'flex';
}

function confirmSetUsername() {
  if (!userAccount) return;
  const profile = getProfile(userAccount);
  const input = document.getElementById('username-input');
  const val = input ? input.value.trim().toUpperCase() : '';
  if (!val || val.length < 3) {
    showToastNotification('Invalid Username', 'Username must be at least 3 characters.', true);
    return;
  }
  // If already set permanently and trying to change to a different name, block it
  if (profile.username && val !== profile.username.toUpperCase()) {
    showToastNotification('Username Locked', `Your permanent username @${profile.username} cannot be changed. Syncing it globally instead.`, true);
    _pendingUsernameChoice = profile.username.toUpperCase();
  } else {
    _pendingUsernameChoice = val;
  }
  document.getElementById('username-confirm-display').textContent = _pendingUsernameChoice;
  closeModal('modal-set-username');
  document.getElementById('modal-confirm-username').style.display = 'flex';
}

async function finalizeUsername() {
  if (!_pendingUsernameChoice || !userAccount) return;
  const profile = getProfile(userAccount);
  profile.username = _pendingUsernameChoice;
  saveProfile(userAccount, profile);

  // Update sponsor display on any bounties posted by this account
  bounties.forEach(b => {
    if (isSameNimiqAddress(b.posterAddress, userAccount)) {
      b.sponsor = _pendingUsernameChoice;
    }
  });
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

  // Sync updated username and bounty sponsor names to global server store
  await pushUserProfile(userAccount, profile);
  await syncGlobalPublicBounties();

  closeModal('modal-confirm-username');
  renderProfile();
  updateWalletUI();
  renderSessionBar();
  renderBounties();
  renderPosterDashboard();
  renderDedicatedOrders();
  renderLeaderboard();
  renderGlobalRegistry();
  showToastNotification('Username Set', `Permanent username set: @${_pendingUsernameChoice}`, false);
}

// ==========================================
// 8. BOUNTIES RENDER & BOUNTY ACTIONS
// ==========================================
function renderBounties() {
  const grid = document.getElementById('bounties-grid');
  if (!grid) return;

  const searchQuery = document.getElementById('search-input')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('category-select')?.value || 'all';

  const activeBounties = bounties;

  let filtered = activeBounties.filter(b => {
    const matchesSearch = b.title.toLowerCase().includes(searchQuery) || (b.instructions || b.description || '').toLowerCase().includes(searchQuery);
    const matchesCat = categoryFilter === 'all' || b.category === categoryFilter;

    if (!userAccount) {
      // Disconnected or new user sees all active bounties!
      return matchesSearch && matchesCat && getEffectiveSlotsRemaining(b) > 0;
    }

    const myApprovedPayout = approvedPayoutsHistory.some(p => String(p.bountyId) === String(b.id) && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount)) ||
      pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'approved');

    const hasPendingSub = pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'pending');
    const hasRejectedSub = pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected');

    const isPublisher = isSameNimiqAddress(b.posterAddress, userAccount);

    if (workerSubtab === 'active') {
      return matchesSearch && matchesCat && getEffectiveSlotsRemaining(b) > 0 && !myApprovedPayout && !hasPendingSub && !hasRejectedSub && !isPublisher;
    } else {
      return matchesSearch && matchesCat && (myApprovedPayout || hasPendingSub || hasRejectedSub);
    }
  });

  if (filtered.length === 0) {
    if (workerSubtab === 'active') {
      grid.innerHTML = createEmptyStateHTML(
        'No Active Bounties',
        'No open task bounties match your search filter right now. Check back soon or publish a new bounty pool!',
        `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`
      );
    } else {
      grid.innerHTML = createEmptyStateHTML(
        'No Completed Tasks',
        'You have not completed any bounties yet. Explore active bounties to start earning instant NIM rewards!',
        `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg>`
      );
    }
    return;
  }

  grid.innerHTML = filtered.map(b => {
    const isPublisher = isSameNimiqAddress(b.posterAddress, userAccount);
    const hasPendingSub = userAccount ? pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'pending') : false;
    const hasApproved = userAccount
      ? (approvedPayoutsHistory.some(p => String(p.bountyId) === String(b.id) && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount)) ||
         pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'approved'))
      : false;

    const hasRejectedSub = userAccount ? pendingSubmissions.some(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected') : false;

    let btnLabel = 'Participate &amp; Earn NIM &rarr;';
    let btnDisabled = false;

    if (hasApproved) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" style="margin-right:6px; vertical-align:middle;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Paid Out Successfully</span>`;
      btnDisabled = true;
    } else if (hasPendingSub) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Proof Pending Review</span>`;
      btnDisabled = true;
    } else if (hasRejectedSub) {
      const rejSub = pendingSubmissions.find(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected');
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" style="margin-right:6px; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Rejected: Resubmit Proof &rarr;</span>`;
      btnDisabled = false;
    } else if (isPublisher) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Publisher (Cannot Claim)</span>`;
      btnDisabled = true;
    }

    const posterRating = getPosterRating(b.posterAddress);
    const posterRep = getReputation(b.posterAddress);
    const posterDisplayName = (b.sponsor && String(b.sponsor).trim() && !String(b.sponsor).startsWith('NQ'))
      ? String(b.sponsor).trim().toUpperCase()
      : getUserDisplayName(b.posterAddress);

    const rejSub = hasRejectedSub ? pendingSubmissions.find(s => String(s.bountyId) === String(b.id) && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount) && s.status === 'rejected') : null;

    if (hasRejectedSub && rejSub) {
      return `
        <div class="bounty-card" style="border:1.5px solid rgba(239,68,68,0.35); background:var(--card);">
          <div>
            <div class="bounty-card-header">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="bounty-category-tag">${b.categoryName || b.category || 'General'}</span>
                <span style="font-size:0.72rem; color:var(--danger); font-weight:800; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); padding:2px 8px; border-radius:6px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> REJECTED</span>
                ${posterRating.HTML}
                ${posterRep.isFlagged ? `<span style="background:rgba(220,38,38,0.15); color:#dc2626; border:1px solid rgba(220,38,38,0.3); font-size:0.65rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> FLAGGED (3+ REPORTS)</span>` : ''}
              </div>
              <span class="bounty-reward">${b.reward} NIM</span>
            </div>

            <h4 class="bounty-title">${b.title}</h4>
            <p class="bounty-desc">${b.instructions || b.description}</p>

            <div style="font-size:0.83rem; color:var(--ink); background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25); padding:12px 14px; border-radius:12px; margin:12px 0; line-height:1.5;">
              <div style="display:flex; align-items:center; gap:6px; font-weight:800; color:var(--danger); margin-bottom:4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>Poster's Rejection Reason:</span>
              </div>
              ${rejSub.rejectionReason || 'No reason provided by poster.'}
            </div>
          </div>

          <div>
            <div class="bounty-meta-row" style="margin-bottom:12px;">
              <span>Poster: <strong>${posterDisplayName}</strong></span>
              <span>Slots: <strong>Reserved for You</strong></span>
            </div>
            <button class="btn-ghost-sm" onclick="openUserProfileModal('${b.posterAddress}')" style="width:100%; justify-content:center; margin-bottom:10px; padding:8px; font-size:0.78rem; color:var(--muted); border-color:var(--border); display:inline-flex; align-items:center; gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              View Poster Profile
            </button>

            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-primary-sm" onclick="openSubmitProofModal('${b.id}')" style="flex:1; justify-content:center; padding:10px; display:inline-flex; align-items:center; gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                <span>Resubmit Proof &rarr;</span>
              </button>
              ${isPosterReported(b.posterAddress, b.id) ? `
                <button class="btn-ghost-sm" disabled style="opacity:0.65; cursor:not-allowed; border-color:var(--border); color:var(--muted); padding:10px; justify-content:center; display:inline-flex; align-items:center; gap:6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>✓ Report Submitted</span>
                </button>
              ` : `
                <button class="btn-ghost-sm" onclick="openReportPosterModal('${b.posterAddress}', '${b.title}', '${b.id}')" style="color:var(--danger); border-color:rgba(239,68,68,0.3); padding:10px; justify-content:center; display:inline-flex; align-items:center; gap:6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                  <span>Report Poster</span>
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="bounty-card">
        <div>
          <div class="bounty-card-header">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="bounty-category-tag">${b.categoryName || b.category || 'General'}</span>
              ${posterRating.HTML}
              ${posterRep.isFlagged ? `<span style="background:rgba(220,38,38,0.15); color:#dc2626; border:1px solid rgba(220,38,38,0.3); font-size:0.65rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase;">⚠️ FLAGGED (3+ REPORTS)</span>` : ''}
              ${getBountyTimeLeftStr(b, userAccount)}
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="bounty-reward">${b.reward} NIM</span>
            </div>
          </div>
          <h4 class="bounty-title">${b.title}</h4>
          <p class="bounty-desc">${b.instructions || b.description}</p>
        </div>
        <div>
          <div class="bounty-meta-row">
            <span>Poster: <strong>${posterDisplayName}</strong></span>
            <span>Slots: <strong>${getEffectiveSlotsRemaining(b)} / ${b.slotsTotal || 5}</strong></span>
          </div>
          <button class="btn-ghost-sm" onclick="openUserProfileModal('${b.posterAddress}')" style="width:100%; justify-content:center; margin-bottom:8px; padding:8px; font-size:0.78rem; color:var(--muted); border-color:var(--border); display:inline-flex; align-items:center; gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            View Poster Profile
          </button>
          <button class="btn-primary-sm full-width" onclick="openSubmitProofModal('${b.id}')" ${btnDisabled ? 'disabled' : ''} style="justify-content:center;">
            ${btnLabel}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// syncGlobalPublicBounties is defined near the top of the file (line ~228) — do not redeclare here.

function openSubmitProofModal(bountyId) {
  if (!isRealWalletConnected()) {
    showToastNotification('Wallet Required', 'Connect your Nimiq Pay wallet first!', true);
    openDesktopConnectModal();
    return;
  }

  const def = getDefaulterStatus(userAccount);
  if (def.isDefaulter) {
    showToastNotification('Account Locked', `You cannot claim bounties while you have unpaid workers on expired campaign "${def.defaultedBounty.title}". Pay your workers to unlock.`, true);
    return;
  }

  currentModalBountyId = bountyId;
  const bounty = bounties.find(b => String(b.id) === String(bountyId));
  if (!bounty) return;

  if (isSameNimiqAddress(bounty.posterAddress, userAccount)) {
    showToastNotification('Publisher Blocked', 'You are the publisher of this bounty pool!', true);
    return;
  }

  uploadedImageDataUrl = null;
  const titleEl = document.getElementById('proof-modal-bounty-title');
  const instEl = document.getElementById('proof-modal-bounty-instructions');

  if (titleEl) titleEl.textContent = `Submit Proof: ${bounty.title}`;
  if (instEl) instEl.textContent = `Task Instructions: ${bounty.instructions || bounty.description || 'Follow instructions and provide required proof.'}`;

  const groupText = document.getElementById('group-proof-text');
  const groupUrl = document.getElementById('group-proof-url');
  const groupImage = document.getElementById('group-proof-image');

  const pType = bounty.proofType || 'text';
  if (groupText) groupText.style.display = (pType === 'text' || pType === 'image_text') ? 'flex' : 'none';
  if (groupUrl) groupUrl.style.display = (pType === 'url') ? 'flex' : 'none';
  if (groupImage) groupImage.style.display = (pType === 'image' || pType === 'image_text') ? 'flex' : 'none';

  const typeLabel = document.getElementById('proof-modal-type-label');
  if (typeLabel) {
    if (pType === 'image_text') {
      typeLabel.textContent = 'Screenshot Image + Feedback (Required)';
    } else {
      typeLabel.textContent = 'Screenshot Image (Required)';
    }
  }

  const previewBox = document.getElementById('image-preview-box');
  if (previewBox) previewBox.style.display = 'none';

  // Clear previous values
  if (document.getElementById('proof-text-input')) document.getElementById('proof-text-input').value = '';
  if (document.getElementById('proof-url-input')) document.getElementById('proof-url-input').value = '';
  if (document.getElementById('proof-x-handle-input')) document.getElementById('proof-x-handle-input').value = '';
  if (document.getElementById('proof-image-file')) document.getElementById('proof-image-file').value = '';
  if (document.getElementById('proof-image-url-input')) document.getElementById('proof-image-url-input').value = '';
  uploadedImageDataUrl = null;

  startClaimTimer(15 * 60);
  document.getElementById('modal-submit-proof').style.display = 'flex';
}

function startClaimTimer(durationSeconds) {
  if (activeClaimTimer) clearInterval(activeClaimTimer);
  let timer = durationSeconds;
  const timerEl = document.getElementById('proof-modal-timer');

  activeClaimTimer = setInterval(() => {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    if (timerEl) {
      timerEl.textContent = `Lock Remaining: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }
    if (--timer < 0) {
      clearInterval(activeClaimTimer);
      showToastNotification('Timer Expired', 'Slot reservation expired.', false);
      closeModal('modal-submit-proof');
    }
  }, 1000);
}

async function processImageFileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = function(e) {
      const rawDataUrl = e.target.result;
      const img = new Image();
      img.onload = function() {
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1000; // Optimized HD for Nimiq Pay Mini App WebView (<100KB)
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
            else { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.70));
        } catch (err) {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function uploadScreenshotToCloud(file) {
  return null;
}

async function previewScreenshot(event) {
  const file = event.target.files[0];
  if (file) {
    showToastNotification('Optimizing Image', 'Processing screenshot for Nimiq Pay Mini App...', false);
    try {
      const compressedUrl = await processImageFileToDataUrl(file);
      if (compressedUrl) {
        uploadedImageDataUrl = compressedUrl;
        const previewImg = document.getElementById('image-preview-img');
        const previewBox = document.getElementById('image-preview-box');
        if (previewImg) previewImg.src = compressedUrl;
        if (previewBox) previewBox.style.display = 'flex';
        showToastNotification('Screenshot Ready', 'Screenshot optimized & ready for instant submission.', false);
      }
    } catch(e) {
      showToastNotification('Image Error', 'Failed to process screenshot.', true);
    }
  }
}

function handleImageUrlInput(event) {
  const val = event.target.value.trim();
  if (val) {
    uploadedImageDataUrl = val;
    const previewImg = document.getElementById('image-preview-img');
    const previewBox = document.getElementById('image-preview-box');
    if (previewImg) previewImg.src = val;
    if (previewBox) previewBox.style.display = 'flex';
  }
}

async function handleSubmitProof() {
  if (!isRealWalletConnected()) {
    showToastNotification('Wallet Required', 'Connect your Nimiq Pay wallet first!', true);
    openDesktopConnectModal();
    return;
  }

  const bounty = bounties.find(b => String(b.id) === String(currentModalBountyId));
  if (!bounty) {
    showToastNotification('Error', 'Bounty not found. Please close and reopen the modal.', true);
    return;
  }

  const pType = bounty.proofType || 'text';
  let proofContent = '';

  if (pType === 'text') {
    proofContent = document.getElementById('proof-text-input')?.value.trim() || '';
    if (!proofContent) {
      showToastNotification('Proof Required', 'Please fill in your written proof details.', true);
      return;
    }
  } else if (pType === 'url') {
    const rawUrl = document.getElementById('proof-url-input')?.value.trim() || '';
    const xHandle = document.getElementById('proof-x-handle-input')?.value.trim() || '';

    if (!rawUrl) {
      showToastNotification('Proof Required', 'Please paste your proof URL link.', true);
      return;
    }
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      showToastNotification('Invalid Link', 'Proof URL must start with http:// or https://', true);
      return;
    }

    if (xHandle) {
      const cleanHandle = xHandle.startsWith('@') ? xHandle : `@${xHandle}`;
      proofContent = JSON.stringify({ url: rawUrl, xHandle: cleanHandle });
    } else {
      proofContent = rawUrl;
    }
  } else if (pType === 'image') {
    const finalImg = uploadedImageDataUrl || document.getElementById('proof-image-url-input')?.value.trim() || '';
    if (!finalImg) {
      showToastNotification('Screenshot Required', 'Please select or upload a screenshot image file to submit.', true);
      return;
    }
    proofContent = finalImg;
  } else if (pType === 'image_text') {
    const txt = document.getElementById('proof-text-input')?.value.trim() || '';
    const finalImg = uploadedImageDataUrl || document.getElementById('proof-image-url-input')?.value.trim() || '';

    if (!txt) {
      showToastNotification('Feedback Required', 'Please enter your written feedback before submitting.', true);
      return;
    }
    if (!finalImg) {
      showToastNotification('Screenshot Required', 'Please select or upload a screenshot image file to submit.', true);
      return;
    }
    proofContent = JSON.stringify({ text: txt, image: finalImg });
  }

  const workerAddr = userAccount.replace(/\s+/g, '').toUpperCase();
  const posterAddr = (bounty.posterAddress && bounty.posterAddress !== 'SYSTEM')
    ? bounty.posterAddress.replace(/\s+/g, '').toUpperCase()
    : 'SYSTEM';

  const timestamp = Date.now();
  let signature = `sig_fallback_${timestamp}`;
  let publicKey = null;

  // --- Ergon-pattern: provider.sign() — free cryptographic receipt, ZERO NIM sent ---
  const provider = getNimiqProvider();
  const proofReceipt = JSON.stringify({
    app: 'NimBounty',
    action: 'submit-proof',
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    proofType: pType,
    worker: workerAddr,
    reward: bounty.reward,
    timestamp
  });

  if (provider && typeof provider.sign === 'function') {
    try {
      showToastNotification('Sign Proof', 'Review & sign the proof receipt in Nimiq Pay — no NIM is sent.', false);
      const res = await provider.sign(proofReceipt);
      if (res && !res.error) {
        signature = res.signature || signature;
        publicKey = res.publicKey || null;
      }
    } catch (e) {
      // Fallback: try signMessage as backup (older SDK versions)
      if (typeof provider.signMessage === 'function') {
        try {
          const res2 = await provider.signMessage(proofReceipt);
          if (res2) signature = typeof res2 === 'string' ? res2 : (res2.signature || signature);
        } catch (e2) {}
      }
    }
  } else if (provider && typeof provider.signMessage === 'function') {
    try {
      const res = await provider.signMessage(proofReceipt);
      if (res) signature = typeof res === 'string' ? res : (res.signature || signature);
    } catch (e) {}
  }

  const existingRejIdx = pendingSubmissions.findIndex(s => String(s.bountyId) === String(bounty.id) && isSameNimiqAddress(s.workerAddress, workerAddr) && s.status === 'rejected');

  let newSub;
  if (existingRejIdx !== -1) {
    // Re-submit previous rejected submission back to 'pending' state!
    newSub = {
      ...pendingSubmissions[existingRejIdx],
      proofType: pType,
      content: proofContent,
      signature: signature,
      publicKey: publicKey,
      submittedAt: new Date().toLocaleTimeString(),
      status: 'pending',
      rejectionReason: null
    };
    pendingSubmissions[existingRejIdx] = newSub;
  } else {
    // Brand new submission
    newSub = {
      id: `sub-${Date.now()}`,
      bountyId: bounty.id,
      bountyTitle: bounty.title,
      posterAddress: posterAddr,
      workerAddress: workerAddr,
      proofType: pType,
      content: proofContent,
      signature: signature,
      publicKey: publicKey,
      submittedAt: new Date().toLocaleTimeString(),
      reward: bounty.reward,
      status: 'pending'
    };
    pendingSubmissions.unshift(newSub);
  }

  if (!bounties.some(b => String(b.id) === String(bounty.id))) bounties.push(bounty);
  const targetBounty = bounties.find(b => String(b.id) === String(bounty.id));

  try {
    localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  } catch(e) {}
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

  await pushNewSubmission(newSub, targetBounty || bounty);

  closeModal('modal-submit-proof');
  renderPosterDashboard();
  renderBounties();
  renderSessionBar();
  triggerConfetti();
  triggerConfetti();
  playAudioFx('submit');
  showToastNotification('Proof Submitted!', 'Proof signed off-chain with 0 gas. Waiting for poster review.', false);
  uploadedImageDataUrl = null;
}

async function pushNewSubmission(newSub, targetBounty) {
  if (!newSub) return;
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newSubmission: newSub,
        bounties: targetBounty ? [targetBounty] : []
      })
    });
  } catch (e) {
    console.error("pushNewSubmission error:", e);
  }
}

function openQrModal(bountyId) {
  const bounty = bounties.find(b => String(b.id) === String(bountyId));
  if (!bounty) return;

  document.getElementById('qr-bounty-title').textContent = bounty.title;
  const b64Data = btoa(encodeURIComponent(JSON.stringify(bounty)));
  const shareWebUrl = `${PRODUCTION_URL}/#bdata=${b64Data}`;
  document.getElementById('qr-link-input').value = shareWebUrl;

  const qrBox = document.getElementById('qrcode-box');
  if (qrBox) {
    renderQrCodeToContainer(qrBox, shareWebUrl);
  }

  document.getElementById('modal-qr').style.display = 'flex';
}

function copyQrLink() {
  const input = document.getElementById('qr-link-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToastNotification('Link Copied', 'Bounty share link copied to clipboard.', false);
  }
}

async function publishBounty() {
  if (!isRealWalletConnected()) {
    showToastNotification('Wallet Required', 'Connect your Nimiq Pay wallet first!', true);
    openDesktopConnectModal();
    return;
  }

  const def = getDefaulterStatus(userAccount);
  if (def.isDefaulter) {
    showToastNotification('Account Locked', `You have unpaid workers on expired campaign "${def.defaultedBounty.title}". Pay your workers to unlock publishing.`, true);
    return;
  }

  const title = document.getElementById('task-title')?.value.trim();
  const reward = document.getElementById('task-reward')?.value.trim() || '50';
  const slots = parseInt(document.getElementById('task-slots')?.value || '10');
  const category = document.getElementById('task-category')?.value || 'app-test';
  const proofType = document.getElementById('task-proof-type')?.value || 'text';
  const duration = parseInt(document.getElementById('task-duration')?.value || '336');
  const desc = document.getElementById('task-instructions')?.value.trim();

  if (!title || !desc) {
    showToastNotification('Form Incomplete', 'Please fill out the title and task instructions.', true);
    return;
  }

  const categoryNames = {
    'app-test': 'App Testing',
    'feedback': 'UI/UX Feedback',
    'social': 'Social Share',
    'bug': 'Bug Hunt',
    'copy': 'Copywriting'
  };

  const expiresAt = Date.now() + (duration * 60 * 60 * 1000);
  const createdAt = Date.now();
  const posterAddr = userAccount.replace(/\s+/g, '').toUpperCase();

  // --- Ergon-pattern: provider.sign() — Poster signs bounty creation receipt, no NIM sent ---
  let publishSignature = `pubsig_fallback_${Date.now()}`;
  let publishPublicKey = null;

  const provider = getNimiqProvider();
  const bountyReceipt = JSON.stringify({
    app: 'NimBounty',
    action: 'publish-bounty',
    title,
    category,
    proofType,
    reward: parseFloat(reward).toFixed(1),
    slots,
    poster: posterAddr,
    duration,
    timestamp: createdAt
  });

  if (provider && typeof provider.sign === 'function') {
    try {
      showToastNotification('Sign Bounty', 'Review & sign the bounty receipt in Nimiq Pay — no NIM is sent.', false);
      const res = await provider.sign(bountyReceipt);
      if (res && !res.error) {
        publishSignature = res.signature || publishSignature;
        publishPublicKey = res.publicKey || null;
      }
    } catch (e) {
      if (typeof provider.signMessage === 'function') {
        try {
          const res2 = await provider.signMessage(bountyReceipt);
          if (res2) publishSignature = typeof res2 === 'string' ? res2 : (res2.signature || publishSignature);
        } catch (e2) {}
      }
    }
  } else if (provider && typeof provider.signMessage === 'function') {
    try {
      const res = await provider.signMessage(bountyReceipt);
      if (res) publishSignature = typeof res === 'string' ? res : (res.signature || publishSignature);
    } catch (e) {}
  }

  const newBounty = {
    id: `bounty-${createdAt}`,
    title,
    category,
    categoryName: categoryNames[category] || category.toUpperCase(),
    proofType,
    reward: parseFloat(reward).toFixed(1),
    slotsTotal: slots,
    slotsRemaining: slots,
    posterAddress: posterAddr,
    sponsor: getUserDisplayName(userAccount),
    instructions: desc,
    description: desc,
    duration,
    expiresAt,
    createdAt,
    publishSignature,
    publishPublicKey
  };

  bounties.unshift(newBounty);
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));
  await syncGlobalPublicBounties(newBounty);

  renderBounties();
  renderSessionBar();
  triggerConfetti();
  showToastNotification('Bounty Published!', 'Your task campaign is live — signed proof recorded.', false);

  // Clear form
  document.getElementById('task-title').value = '';
  document.getElementById('task-instructions').value = '';
  calculateTotalEscrow();
}

function togglePosterProofInfoBox() {
  const select = document.getElementById('task-proof-type');
  const box = document.getElementById('poster-proof-info-box');
  if (!select || !box) return;
  const val = select.value;
  box.style.display = (val === 'image' || val === 'image_text') ? 'block' : 'none';
}

function renderPosterDashboard() {
  togglePosterProofInfoBox();
  const poolsList = document.getElementById('poster-pools-list');
  const subsList = document.getElementById('poster-subs-list');

  const def = getDefaulterStatus(userAccount);
  let bannerHTML = '';
  if (def.isDefaulter) {
    bannerHTML = `
      <div style="background:rgba(239,68,68,0.12); border:1.5px solid rgba(239,68,68,0.4); border-radius:14px; padding:16px; margin-bottom:16px; color:var(--ink);">
        <div style="display:flex; align-items:center; gap:8px; font-weight:900; color:var(--danger); font-size:0.95rem; margin-bottom:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ACCOUNT LOCKED: UNPAID WORKERS (&gt;24H OVERDUE)
        </div>
        <div style="font-size:0.83rem; color:var(--ink); line-height:1.5;">
          You have <strong>${def.pendingCount} pending worker submission(s)</strong> on expired bounty <strong>"${def.defaultedBounty.title}"</strong> waiting past 24h. Your account is locked from publishing new bounties or claiming tasks until you review and pay your workers.
        </div>
      </div>`;
  } else if (def.isWarning) {
    bannerHTML = `
      <div style="background:var(--gold-tint); border:1.5px solid var(--gold-border); border-radius:14px; padding:16px; margin-bottom:16px; color:var(--ink);">
        <div style="display:flex; align-items:center; gap:8px; font-weight:900; color:var(--gold-text); font-size:0.95rem; margin-bottom:4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          WARNING: 24-HOUR PAYOUT DEADLINE APPROACHING
        </div>
        <div style="font-size:0.83rem; color:var(--ink); line-height:1.5;">
          You have <strong>${def.hoursRemaining} hours remaining</strong> to review pending worker submissions on expired bounty <strong>"${def.warningBounty.title}"</strong> before automatic account lockdown!
        </div>
      </div>`;
  }

  if (poolsList) {
    const myPools = bounties.filter(b => isSameNimiqAddress(b.posterAddress, userAccount));
    const poolsHTML = myPools.length ? myPools.map(b => {
      const approvedCount = approvedPayoutsHistory.filter(p => String(p.bountyId) === String(b.id)).length;
      const pendingSubCount = pendingSubmissions.filter(s => String(s.bountyId) === String(b.id) && s.status === 'pending').length;
      const isSlotsZero = getEffectiveSlotsRemaining(b) <= 0;
      const isFullyCompleted = (approvedCount >= (b.slotsTotal || 5)) || (isSlotsZero && pendingSubCount === 0 && approvedCount > 0);
      const isExpired = !isFullyCompleted && (b.expiresAt ? Date.now() > b.expiresAt : false);

      const statusBadge = isFullyCompleted
        ? `<span style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> CLOSED</span>`
        : (isExpired
            ? `<span style="background:rgba(220,38,38,0.15); color:#dc2626; border:1px solid rgba(220,38,38,0.3); font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.04em;">EXPIRED</span>`
            : (isSlotsZero
                ? `<span style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.04em;">SLOTS FILLED (${pendingSubCount} PENDING)</span>`
                : `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); font-size:0.7rem; font-weight:800; padding:3px 8px; border-radius:6px; text-transform:uppercase; letter-spacing:0.04em;">ACTIVE POOL</span>`
              )
          );

      return `
        <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
            <h4 style="font-size:1rem; font-weight:800; margin:0; color:var(--ink);">${b.title}</h4>
            ${statusBadge}
          </div>
          <div style="font-size:0.8rem; color:var(--muted); font-weight:600;">Reward: ${b.reward} NIM &bull; Slots Remaining: ${getEffectiveSlotsRemaining(b)} / ${b.slotsTotal}</div>
        </div>
      `;
    }).join('') : createEmptyStateHTML(
      'No Published Pools',
      'You have not published any task bounty pools yet. Click "Publish New Bounty" above to launch your first task pool!',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
    );
    poolsList.innerHTML = bannerHTML + poolsHTML;
  }

  if (subsList) {
    const mySubs = pendingSubmissions.filter(s =>
      s.status === 'pending' &&
      (isSameNimiqAddress(s.posterAddress, userAccount) || !s.posterAddress || s.posterAddress === 'SYSTEM' || isSameNimiqAddress(bounties.find(b => String(b.id) === String(s.bountyId))?.posterAddress, userAccount))
    );
    subsList.innerHTML = mySubs.length ? mySubs.map(s => {

      let proofHTML = '';
      const content = s.content || '';
      let imageUrl = null;
      let textContent = '';
      let linkContent = '';
      let xHandleContent = '';

      if (content.startsWith('data:image') || content.startsWith('http://') || content.startsWith('https://')) {
        const b = bounties.find(item => String(item.id) === String(s.bountyId));
        const pType = (s.proofType || b?.proofType || '').toLowerCase();
        if (pType.includes('image') || content.startsWith('data:image') || content.match(/\.(jpeg|jpg|png|webp|gif)/i)) {
          imageUrl = content;
        } else {
          linkContent = content;
        }
      } else if (content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.url) linkContent = parsed.url;
          if (parsed.xHandle) xHandleContent = parsed.xHandle;
          if (parsed.image) imageUrl = parsed.image;
          if (parsed.text) textContent = parsed.text;
        } catch (e) {
          textContent = content;
        }
      } else if (content.startsWith('[LOCAL_IMG:')) {
        proofHTML += `<div style="font-size:0.8rem; font-weight:700; color:var(--muted); background:var(--bg-subtle); padding:8px 12px; border-radius:8px; margin-bottom:8px;">📷 Screenshot Proof Attached</div>`;
      } else {
        textContent = content;
      }

      if (xHandleContent) {
        proofHTML += `
          <div style="margin-bottom:10px;">
            <span style="font-size:0.72rem; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; display:inline-block; margin-right:6px;">X (Twitter) Handle:</span>
            <span style="font-size:0.85rem; font-weight:800; font-family:var(--font-mono); color:var(--gold-text); background:var(--gold-tint); border:1px solid var(--gold-border); padding:3px 10px; border-radius:6px;">${xHandleContent}</span>
          </div>`;
      }

      if (imageUrl) {
        proofHTML += `
          <div style="margin-bottom:12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <div style="font-size:0.75rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em;">Screenshot Proof</div>
              <button type="button" onclick="event.stopPropagation(); toggleCardImageExpand('card-img-${s.id}', 'btn-expand-${s.id}')"
                      id="btn-expand-${s.id}"
                      style="background:var(--gold-tint); border:1px solid var(--gold-border); color:var(--gold-text); font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:8px; cursor:pointer;">
                ↔ Expand Full Size
              </button>
            </div>
            <div style="position:relative; display:block; cursor:pointer; border-radius:12px; overflow:hidden; border:2px solid var(--border); width:100%;"
                 onclick="toggleCardImageExpand('card-img-${s.id}', 'btn-expand-${s.id}')" title="Tap to toggle full size">
              <img id="card-img-${s.id}" src="${imageUrl}" alt="Proof screenshot" style="display:block; width:100%; max-height:180px; object-fit:cover; border-radius:10px; transition:max-height 0.25s ease;" />
            </div>
          </div>`;
      }
      if (textContent) {
        proofHTML += `<div style="font-size:0.85rem; background:var(--bg-subtle); padding:10px 14px; border-radius:10px; margin-bottom:12px; line-height:1.5; white-space:pre-wrap;">${textContent}</div>`;
      }
      if (linkContent) {
        proofHTML += `
          <div style="margin-bottom:12px;">
            <div style="font-size:0.75rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Submitted Proof Link</div>
            <a href="${linkContent}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:8px; background:var(--gold-tint); border:1px solid var(--gold-border); padding:10px 16px; border-radius:12px; font-size:0.85rem; font-weight:700; color:var(--gold-text); text-decoration:none; word-break:break-all;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Open Public Proof Link</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <div style="font-size:0.72rem; color:var(--muted); margin-top:4px; font-family:var(--font-mono);">${linkContent}</div>
          </div>`;
      }
      if (!proofHTML) {
        proofHTML = `<div style="font-size:0.85rem; color:var(--muted); padding:10px; background:var(--bg-subtle); border-radius:10px; margin-bottom:12px;">No proof content attached.</div>`;
      }

      const workerRating = getPosterRating(s.workerAddress);

      return `
        <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:12px;" data-sub-id="${s.id}">
          <h4 style="font-size:1rem; font-weight:800; margin-bottom:4px;">${s.bountyTitle}</h4>
          <p style="font-size:0.82rem; color:var(--muted); margin:0 0 12px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span>Worker: <strong>${getUserDisplayName(s.workerAddress)}</strong></span>
            <span>&bull;</span>
            ${workerRating.HTML}
          </p>
          ${proofHTML}
          <div style="display:flex; gap:10px;">
            <button class="btn-primary-sm" id="btn-approve-${s.id}" onclick="approveWorkerPayout('${s.id}')" style="flex:1; justify-content:center;">Approve &amp; Pay ${s.reward} NIM</button>
            <button class="btn-ghost-sm" onclick="openRejectionModal('${s.id}')" style="flex:1; justify-content:center; color:var(--danger);">Reject</button>
          </div>
        </div>`;
    }).join('') : createEmptyStateHTML(
      'No Pending Submissions',
      'When workers complete your published bounties and submit proof packages, they will appear here for 1-click review and payout.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
    );
  }
}

function openScreenshotLightbox(subId) {
  const sub = pendingSubmissions.find(s => s.id === subId);
  if (!sub) return;

  let imageUrl = null;
  const content = sub.content || '';

  if (content.startsWith('data:image')) {
    imageUrl = content;
  } else if (content.startsWith('{')) {
    try { imageUrl = JSON.parse(content).image || null; } catch (e) {}
  }

  if (!imageUrl) return;

  const modal = document.getElementById('modal-screenshot-lightbox');
  const img = document.getElementById('lightbox-img');
  const title = document.getElementById('lightbox-title');
  const dlBtn = document.getElementById('lightbox-download-btn');

  if (!modal || !img) return;

  img.src = imageUrl;
  if (title) title.textContent = sub.bountyTitle || 'Proof Screenshot';
  if (dlBtn) dlBtn.href = imageUrl;
  modal.style.display = 'flex';
}

function closeLightboxOnBackdrop(event) {
  // Close only when clicking the dark backdrop itself, not the image/card
  if (event.target === event.currentTarget) {
    document.getElementById('modal-screenshot-lightbox').style.display = 'none';
  }
}

async function approveWorkerPayout(subId) {
  const subIndex = pendingSubmissions.findIndex(s => s.id === subId);
  if (subIndex === -1) return;
  const sub = pendingSubmissions[subIndex];

  const btn = document.getElementById(`btn-approve-${subId}`) || (typeof event !== 'undefined' && event?.target?.closest('button'));
  const originalBtnHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.85';
    btn.style.cursor = 'wait';
    btn.innerHTML = `<svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Paying ${sub.reward} NIM...`;
  }

  const provider = getNimiqProvider();
  let txHash = `tx_${Date.now()}`;

  if (provider && typeof provider.sendBasicTransactionWithData === 'function') {
    try {
      const lunaValue = Math.round(parseFloat(sub.reward) * 100000);
      txHash = await provider.sendBasicTransactionWithData({
        recipient: sub.workerAddress,
        value: lunaValue,
        data: `NIMBOUNTY_PAYOUT:${sub.bountyId}`
      });
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.innerHTML = originalBtnHTML;
      }
      showToastNotification('Transaction Cancelled', 'Payout transaction was cancelled.', true);
      return;
    }
  }

  sub.status = 'approved';
  sub.approvedAt = Date.now();
  sub.txHash = txHash;

  const approvedItem = {
    id: `pay-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    bountyId: sub.bountyId,
    bountyTitle: sub.bountyTitle,
    workerAddress: (sub.workerAddress || '').toUpperCase().replace(/\s+/g, ''),
    posterAddress: (sub.posterAddress || '').toUpperCase().replace(/\s+/g, ''),
    reward: sub.reward,
    paidAt: Date.now(),
    txHash: txHash
  };

  approvedPayoutsHistory.unshift(approvedItem);

  // Remove approved submission from pendingSubmissions queue
  pendingSubmissions = pendingSubmissions.filter(s => s.id !== subId);

  try { localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions)); } catch(e) {}
  localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

  // Find the bounty and send it with the updated state
  const bountyForSub = bounties.find(b => String(b.id) === String(sub.bountyId));

  // Push approved payout + sub removal + bounty update atomically to server
  await pushApprovedPayout(approvedItem, subId, bountyForSub || null);

  // Auto-settle any active report filed by this worker against this poster
  await settleReport(sub.posterAddress, sub.workerAddress);

  renderPosterDashboard();
  renderBounties();
  renderMobileBottomNav();
  renderSessionBar();
  renderProfile();
  renderDedicatedOrders();
  renderLeaderboard();
  updateWalletUI();
  triggerConfetti();
  showToastNotification('Worker Paid', `${sub.reward} NIM transferred directly to ${getUserDisplayName(sub.workerAddress)}.`, false);
}

async function pushNewReport(targetAddress, reason) {
  if (!targetAddress) return;
  const cleanTarget = String(targetAddress).replace(/\s+/g, '').toUpperCase();
  const reporterAddr = userAccount ? userAccount.replace(/\s+/g, '').toUpperCase() : 'ANONYMOUS';

  // 1. Update local storage immediately
  const allRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
  if (!allRep[cleanTarget]) allRep[cleanTarget] = { count: 0, list: [] };
  allRep[cleanTarget].count = (allRep[cleanTarget].count || 0) + 1;
  if (!Array.isArray(allRep[cleanTarget].list)) allRep[cleanTarget].list = [];
  allRep[cleanTarget].list.unshift({
    id: `rep-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
    reporterAddress: reporterAddr,
    reason: reason,
    timestamp: Date.now()
  });
  localStorage.setItem(STORAGE_KEY_REPUTATION, JSON.stringify(allRep));

  // 2. Push to global server store
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newReport: {
          targetAddress: cleanTarget,
          reporterAddress: reporterAddr,
          reason: reason
        }
      })
    });
  } catch (e) {}

  // 3. Trigger UI re-renders
  renderProfile();
  renderBounties();
  renderPosterDashboard();
  renderDedicatedOrders();
  renderLeaderboard();
  renderGlobalRegistry();
}

function isPosterReported(posterAddress, bountyId = null) {
  if (!userAccount || !posterAddress) return false;
  const cleanUser = String(userAccount).replace(/\s+/g, '').toUpperCase();
  const cleanPoster = String(posterAddress).replace(/\s+/g, '').toUpperCase();

  const reportedTasks = JSON.parse(localStorage.getItem('nimbounty_reported_tasks_v1200') || '{}');
  const reportedPosters = JSON.parse(localStorage.getItem('nimbounty_reported_posters_v1200') || '{}');

  if (reportedPosters[`${cleanPoster}_${cleanUser}`]) return true;
  if (bountyId && reportedTasks[`${bountyId}_${cleanUser}`]) return true;

  if (globalReports && typeof globalReports === 'object') {
    let hasFiled = false;
    Object.keys(globalReports).forEach(targetKey => {
      if (isSameNimiqAddress(targetKey, cleanPoster)) {
        const item = globalReports[targetKey];
        if (item && Array.isArray(item.list)) {
          if (item.list.some(r => r.reporterAddress && isSameNimiqAddress(r.reporterAddress, cleanUser))) {
            hasFiled = true;
          }
        }
      }
    });
    if (hasFiled) return true;
  }

  return false;
}

function openReportPosterModal(posterAddress, bountyTitle = '', bountyId = null) {
  if (!userAccount) {
    showToastNotification('Wallet Required', 'Connect your wallet to file a report.', true);
    return;
  }
  const cleanPoster = String(posterAddress).replace(/\s+/g, '').toUpperCase();
  const cleanUser = String(userAccount).replace(/\s+/g, '').toUpperCase();
  if (cleanPoster === cleanUser) {
    showToastNotification('Action Invalid', 'You cannot report your own account.', true);
    return;
  }

  if (isPosterReported(posterAddress, bountyId)) {
    showToastNotification('Report Submitted', 'You have already submitted a report for this user.', false);
    return;
  }

  currentReportTarget = { posterAddress, bountyTitle, bountyId };
  if (document.getElementById('report-poster-reason')) document.getElementById('report-poster-reason').value = '';
  document.getElementById('modal-report-poster').style.display = 'flex';
}

async function submitReportPoster() {
  if (!currentReportTarget || !userAccount) return;
  const reason = document.getElementById('report-poster-reason')?.value.trim();
  if (!reason) {
    showToastNotification('Reason Required', 'Please describe the issue details.', true);
    return;
  }

  const cleanUser = String(userAccount).replace(/\s+/g, '').toUpperCase();
  const cleanPoster = String(currentReportTarget.posterAddress).replace(/\s+/g, '').toUpperCase();
  const taskKey = `${currentReportTarget.bountyId}_${cleanUser}`;
  const posterKey = `${cleanPoster}_${cleanUser}`;

  // Record reported task and poster locally to disable button
  const reportedTasks = JSON.parse(localStorage.getItem('nimbounty_reported_tasks_v1200') || '{}');
  const reportedPosters = JSON.parse(localStorage.getItem('nimbounty_reported_posters_v1200') || '{}');
  reportedTasks[taskKey] = true;
  reportedPosters[posterKey] = true;
  localStorage.setItem('nimbounty_reported_tasks_v1200', JSON.stringify(reportedTasks));
  localStorage.setItem('nimbounty_reported_posters_v1200', JSON.stringify(reportedPosters));

  // CLOSE MODAL IMMEDIATELY
  closeModal('modal-report-poster');
  if (document.getElementById('report-poster-reason')) document.getElementById('report-poster-reason').value = '';
  showToastNotification('Report Submitted', 'Your report has been logged successfully.', false);

  // Update local reputation state immediately
  pushNewReport(cleanPoster, reason);

  // INSTANT UI SYNCHRONOUS RE-RENDER (0ms delay — button transforms immediately on single click)
  renderBounties();
  renderPosterDashboard();
  renderDedicatedOrders();
  renderProfile();

  // Send POST to server in background
  try {
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;
    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newReport: {
          targetAddress: cleanPoster,
          reporterAddress: cleanUser,
          reason: reason,
          bountyId: currentReportTarget.bountyId,
          bountyTitle: currentReportTarget.bountyTitle,
          timestamp: Date.now()
        }
      })
    });
    await fetchGlobalPublicBounties();
    renderBounties();
    renderPosterDashboard();
    renderDedicatedOrders();
    renderProfile();
  } catch(e) {}
}

function openReportsModal() {
  if (!userAccount) {
    showToastNotification('Wallet Required', 'Connect wallet to view dispute center.', true);
    return;
  }
  switchReportsModalTab('outbound');
  document.getElementById('modal-reports-list').style.display = 'flex';
}

function switchReportsModalTab(tab) {
  currentReportsModalTab = tab;
  const btnOut = document.getElementById('reports-tab-btn-outbound');
  const btnIn = document.getElementById('reports-tab-btn-inbound');

  if (btnOut && btnIn) {
    if (tab === 'outbound') {
      btnOut.style.border = '1px solid var(--gold-border)';
      btnOut.style.background = 'var(--gold-tint)';
      btnOut.style.color = 'var(--gold-text)';
      btnOut.style.fontWeight = '800';

      btnIn.style.border = '1px solid var(--border)';
      btnIn.style.background = 'var(--bg-subtle)';
      btnIn.style.color = 'var(--muted)';
      btnIn.style.fontWeight = '700';
    } else {
      btnIn.style.border = '1px solid var(--gold-border)';
      btnIn.style.background = 'var(--gold-tint)';
      btnIn.style.color = 'var(--gold-text)';
      btnIn.style.fontWeight = '800';

      btnOut.style.border = '1px solid var(--border)';
      btnOut.style.background = 'var(--bg-subtle)';
      btnOut.style.color = 'var(--muted)';
      btnOut.style.fontWeight = '700';
    }
  }
  renderReportsModalContent();
}

function renderReportsModalContent() {
  const container = document.getElementById('reports-modal-content');
  if (!container || !userAccount) return;
  const cleanUser = String(userAccount).replace(/\s+/g, '').toUpperCase();

  if (currentReportsModalTab === 'outbound') {
    // Reports filed BY userAccount (Workers can resolve disputes from here)
    let outboundList = [];
    const seenIds = new Set();

    if (globalReports && typeof globalReports === 'object') {
      Object.keys(globalReports).forEach(targetAddr => {
        const item = globalReports[targetAddr];
        if (item && Array.isArray(item.list)) {
          item.list.forEach(r => {
            if (r.reporterAddress && isSameNimiqAddress(r.reporterAddress, cleanUser) && !seenIds.has(r.id)) {
              outboundList.push({ ...r, targetAddress: targetAddr });
              seenIds.add(r.id);
            }
          });
        }
      });
    }

    const localRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
    Object.keys(localRep).forEach(targetAddr => {
      const item = localRep[targetAddr];
      if (item && Array.isArray(item.list)) {
        item.list.forEach(r => {
          if (r.reporterAddress && isSameNimiqAddress(r.reporterAddress, cleanUser) && !seenIds.has(r.id)) {
            outboundList.push({ ...r, targetAddress: targetAddr });
            seenIds.add(r.id);
          }
        });
      }
    });

    if (outboundList.length === 0) {
      container.innerHTML = createEmptyStateHTML('No Filed Reports', 'You have not filed any dispute reports against posters.');
      return;
    }

    container.innerHTML = outboundList.map(r => `
      <div style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:14px; padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:0.85rem; color:var(--ink);">Target: ${getUserDisplayName(r.targetAddress)}</strong>
          <span style="font-size:0.7rem; color:var(--muted);">${new Date(r.timestamp).toLocaleDateString()}</span>
        </div>
        <p style="font-size:0.8rem; color:var(--muted); margin-bottom:10px; line-height:1.4;">${r.reason}</p>
        <button class="btn-primary-sm" onclick="resolveDispute('${r.id}', '${r.targetAddress}')" style="background:#10b981; color:#fff; padding:6px 12px; font-size:0.78rem;">✓ Mark Dispute Resolved</button>
      </div>
    `).join('');
  } else {
    // Reports filed AGAINST userAccount (Posters cannot self-settle; resolves via payouts)
    const repData = getAccountReports(cleanUser);
    const inboundList = repData.list || [];

    if (inboundList.length === 0) {
      container.innerHTML = createEmptyStateHTML('Clean Record', 'No workers have filed any reports against your wallet.');
      return;
    }

    container.innerHTML = `
      <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); padding:10px 14px; border-radius:12px; margin-bottom:12px; font-size:0.78rem; color:var(--muted); line-height:1.4;">
        <strong style="color:var(--gold-text); display:block; margin-bottom:2px;">Automated Rating Recovery:</strong>
        Reports automatically resolve as you approve worker payouts. Workers can also mark disputes resolved from their end.
      </div>
    ` + inboundList.map(r => `
      <div style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.25); border-radius:14px; padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:0.85rem; color:var(--danger);">Filed by Worker: ${getUserDisplayName(r.reporterAddress)}</strong>
          <span style="font-size:0.7rem; color:var(--muted);">${new Date(r.timestamp).toLocaleDateString()}</span>
        </div>
        <p style="font-size:0.8rem; color:var(--muted); margin:0; line-height:1.4;">${r.reason}</p>
      </div>
    `).join('');
  }
}

async function resolveDispute(reportId, targetAddress) {
  if (!userAccount) return;
  const cleanUser = String(userAccount).replace(/\s+/g, '').toUpperCase();
  const cleanTarget = String(targetAddress).replace(/\s+/g, '').toUpperCase();

  try {
    showToastNotification('Resolving Dispute', 'Updating dispute status...', false);
    const apiEndpoint = `${PRODUCTION_URL}/api/bounties`;
    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settleReport: {
          targetAddress: cleanTarget,
          reporterAddress: cleanUser,
          reportId: reportId
        }
      })
    });
    await fetchGlobalPublicBounties();
    renderReportsModalContent();
    renderBounties();
    renderPosterDashboard();
    renderProfile();
    showToastNotification('Dispute Resolved', 'Report removed and poster rating restored.', false);
  } catch(e) {}
}

let _pendingRejectSubId = null;

function openRejectionModal(subId) {
  _pendingRejectSubId = subId;
  const modal = document.getElementById('modal-reject-reason');
  if (modal) modal.style.display = 'flex';
}

async function submitTaskRejectionWithReason() {
  const reasonInput = document.getElementById('rejection-reason-input');
  const flagSpamCheck = document.getElementById('reject-flag-spam-check');
  const val = reasonInput ? reasonInput.value.trim() : '';

  if (!val) {
    showToastNotification('Reason Required', 'Please provide a rejection reason.', true);
    return;
  }

  const subIndex = pendingSubmissions.findIndex(s => s.id === _pendingRejectSubId);
  if (subIndex !== -1) {
    const sub = pendingSubmissions[subIndex];
    sub.status = 'rejected';
    sub.rejectionReason = val;

    localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));

    // Push updated rejection status & reason to global server so worker receives rejection instantly
    await pushNewSubmission(sub);

    if (flagSpamCheck && flagSpamCheck.checked && sub.workerAddress) {
      await pushNewReport(sub.workerAddress, `Fake/Spam proof submitted for task: "${sub.bountyTitle}" - Reason: ${val}`);
    }
  }

  closeModal('modal-reject-reason');
  if (flagSpamCheck) flagSpamCheck.checked = false;
  if (reasonInput) reasonInput.value = '';
  renderPosterDashboard();
  renderDedicatedOrders();
  renderBounties();
  showToastNotification('Task Rejected', 'Worker notified of rejection reason. Task slot remains open.', false);
}

let _pendingReportTargetAddr = null;

function openReportPosterModal(targetAddr, bountyTitle = '') {
  _pendingReportTargetAddr = targetAddr;
  const modal = document.getElementById('modal-report-poster');
  const titleEl = document.querySelector('#modal-report-poster h3');
  if (titleEl) titleEl.textContent = bountyTitle ? `Report Poster: ${bountyTitle}` : 'Report Account';
  if (modal) modal.style.display = 'flex';
}

async function submitReportPoster() {
  const reasonInput = document.getElementById('report-poster-reason');
  const val = reasonInput ? reasonInput.value.trim() : '';

  if (!val) {
    showToastNotification('Reason Required', 'Please explain the issue.', true);
    return;
  }

  const target = _pendingReportTargetAddr || 'POSTER';
  await pushNewReport(target, val);

  closeModal('modal-report-poster');
  showToastNotification('Report Submitted', 'Report recorded against user account on global ledger.', false);
  if (reasonInput) reasonInput.value = '';
}

function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = Array.from({ length: 80 }).map(() => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    r: Math.random() * 6 + 4,
    d: Math.random() * 80,
    color: ['#d99b00', '#ffc107', '#1a7a4a', '#ffffff'][Math.floor(Math.random() * 4)],
    tilt: Math.random() * 10 - 10
  }));

  let ticks = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt, p.y);
      ctx.lineTo(p.x, p.y + p.tilt + p.r);
      ctx.stroke();

      p.y += Math.cos(p.d) + 3 + p.r / 2;
      p.tilt = Math.sin(ticks / 10) * 15;
    });

    ticks++;
    if (ticks < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

function renderDedicatedOrders() {
  const lists = [
    document.getElementById('dedicated-orders-list'),
    document.getElementById('worker-orders-list')
  ].filter(Boolean);

  if (!lists.length) return;

  const content = !isRealWalletConnected()
    ? createEmptyStateHTML(
        'Wallet Required',
        'Connect your Nimiq Pay wallet to view your submitted orders and payout history.',
        `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
      )
    : (approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.workerAddress, userAccount)).length
        ? approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.workerAddress, userAccount)).map(p => `
          <div class="paper-card" style="background:var(--card); border:1px solid var(--border); border-radius:20px; padding:18px 20px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h4 style="font-size:0.95rem; font-weight:800;">${p.bountyTitle}</h4>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">Paid: ${new Date(p.paidAt).toLocaleDateString()}</div>
            </div>
            <div style="font-family:var(--font-mono); font-size:1.1rem; font-weight:900; color:var(--gold);">+${p.reward} NIM</div>
          </div>
        `).join('')
        : createEmptyStateHTML(
          'No Submission Orders',
          'Your completed task payouts and order history will appear here once you complete bounties.',
          `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
        ));

  lists.forEach(el => el.innerHTML = content);
}

function updateLandingStats() {
  const activeEl = document.getElementById('landing-stat-active');
  const paidEl = document.getElementById('landing-stat-paid');

  if (activeEl) activeEl.textContent = bounties.length ? bounties.length : '2';
  if (paidEl) paidEl.textContent = `${approvedPayoutsHistory.reduce((s, p) => s + (parseFloat(p.reward) || 0), 0)} NIM`;
}

function renderWorkerStats() {}

// Onboarding Walkthrough
const ONBOARDING_STEPS = [
  {
    section: 'WELCOME',
    title: 'Welcome to NimBounty!',
    description: 'Outcome-based micro-task bounties powered by Nimiq Pay. Earn NIM by completing tasks or publish task pools for instant execution.',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    targetId: 'console-session-bar'
  },
  {
    section: 'MODE SWITCH',
    title: 'Switch Roles (Worker vs Poster)',
    description: 'Tap the Mode button or badge to switch between Worker Mode (earn NIM rewards) and Poster Mode (publish & manage bounties).',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    targetId: 'session-mode-badge'
  },
  {
    section: 'ACTIVE BOUNTIES',
    title: 'Browse & Claim Tasks',
    description: 'Explore active bounties, review detailed instructions, and claim open slots to start earning instant NIM rewards.',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`,
    targetId: 'bounties-grid'
  },
  {
    section: 'PUBLISH TASK POOLS',
    title: 'Create & Escrow Bounties',
    description: 'Publish your own micro-task campaign, customize worker proof requirements, and deposit NIM rewards into live escrow.',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    targetId: 'btn-poster-tab-create'
  },
  {
    section: 'ZERO-GAS PROOFS',
    title: 'Off-Chain Proof Signing',
    description: 'Submit text, link, or screenshot proof packages directly from your Nimiq Pay wallet with 0 gas fees and cryptographic signing.',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    targetId: 'session-wallet-display'
  },
  {
    section: 'ORDER HISTORY',
    title: 'Payout Orders & History',
    description: 'Track your pending reviews, completed task history, and direct wallet payout transfers in real-time.',
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--gold)" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    targetId: 'worker-orders-list'
  }
];

let onboardingStep = 0;

function checkAndLaunchOnboarding() {
  if (!userAccount) return;
  const done = localStorage.getItem(STORAGE_KEY_ONBOARDED_GLOBAL);
  if (!done) {
    document.getElementById('onboarding-overlay').style.display = 'flex';
    onboardingStep = -1;
    updateOnboardingUI();
  }
}

function removeTourHighlights() {
  document.querySelectorAll('.tour-highlight').forEach(el => {
    el.classList.remove('tour-highlight');
  });
}

function updateOnboardingUI() {
  removeTourHighlights();

  const welcomeCard = document.getElementById('onboarding-welcome-card');
  const stepCard = document.getElementById('onboarding-step-card');
  const modal = document.querySelector('#onboarding-overlay .modal-paper');

  if (onboardingStep === -1) {
    if (welcomeCard) welcomeCard.style.display = 'flex';
    if (stepCard) stepCard.style.display = 'none';
    // Welcome step: centre the modal
    if (modal) {
      modal.style.position = 'fixed';
      modal.style.top = '50%';
      modal.style.left = '50%';
      modal.style.transform = 'translate(-50%, -50%)';
      modal.style.transition = 'top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1)';
    }
    return;
  }

  if (onboardingStep >= ONBOARDING_STEPS.length) {
    skipOnboarding();
    return;
  }

  if (welcomeCard) welcomeCard.style.display = 'none';
  if (stepCard) stepCard.style.display = 'flex';

  const step = ONBOARDING_STEPS[onboardingStep];
  document.getElementById('ob-step-section').textContent = step.section;
  document.getElementById('ob-step-title').textContent = step.title;
  document.getElementById('ob-step-desc').textContent = step.description;

  const iconCircle = document.getElementById('ob-step-icon');
  if (iconCircle && step.icon) {
    iconCircle.innerHTML = step.icon;
  }

  // Update Progress Dots
  const dotsContainer = document.getElementById('ob-step-dots');
  if (dotsContainer) {
    dotsContainer.innerHTML = ONBOARDING_STEPS.map((_, idx) => `
      <div style="width:${idx === onboardingStep ? '18px' : '8px'}; height:8px; border-radius:4px; background:${idx === onboardingStep ? 'var(--gold)' : 'var(--border)'}; transition:all 0.2s ease;"></div>
    `).join('');
  }

  // Highlight Target App Section & smartly reposition modal away from it
  if (step.targetId) {
    const targetEl = document.getElementById(step.targetId);
    if (targetEl) {
      targetEl.classList.add('tour-highlight');
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // After scroll settles, compute where to dock the modal
      setTimeout(() => {
        if (!modal) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const modalH = modal.offsetHeight || 340;
        const modalW = Math.min(440, vw - 32);
        const padding = 16; // gap between modal edge and target

        const rect = targetEl.getBoundingClientRect();
        const targetTop = rect.top;
        const targetBottom = rect.bottom;

        // Space available above and below the target
        const spaceAbove = targetTop - padding;
        const spaceBelow = vh - targetBottom - padding;

        let top;

        if (spaceBelow >= modalH + padding) {
          // Enough room below — dock below target
          top = targetBottom + padding;
        } else if (spaceAbove >= modalH + padding) {
          // Enough room above — dock above target
          top = targetTop - modalH - padding;
        } else if (spaceBelow >= spaceAbove) {
          // More room below, but tight — push as high as still visible
          top = Math.max(8, vh - modalH - 8);
        } else {
          // More room above — push to top
          top = 8;
        }

        // Clamp within viewport
        top = Math.max(8, Math.min(top, vh - modalH - 8));

        modal.style.position = 'fixed';
        modal.style.top = top + 'px';
        modal.style.left = '50%';
        modal.style.transform = 'translateX(-50%)';
        modal.style.transition = 'top 0.38s cubic-bezier(0.4,0,0.2,1), left 0.38s cubic-bezier(0.4,0,0.2,1)';
        modal.style.width = modalW + 'px';
      }, 420); // wait for scroll to settle
    }
  } else {
    // No target — centre the modal
    if (modal) {
      modal.style.position = 'fixed';
      modal.style.top = '50%';
      modal.style.left = '50%';
      modal.style.transform = 'translate(-50%, -50%)';
      modal.style.transition = 'top 0.35s cubic-bezier(0.4,0,0.2,1)';
    }
  }
}

function onboardingNext() { onboardingStep++; updateOnboardingUI(); }
function onboardingBack() { if (onboardingStep > 0) { onboardingStep--; updateOnboardingUI(); } }

function skipOnboarding() {
  removeTourHighlights();
  document.getElementById('onboarding-overlay').style.display = 'none';
  localStorage.setItem(STORAGE_KEY_ONBOARDED_GLOBAL, '1');
}

// Check URL Hash for shared bounty payload auto-import
function checkUrlAutoImport() {
  try {
    const hash = window.location.hash;
    if (hash && hash.includes('bdata=')) {
      const b64 = hash.split('bdata=')[1];
      if (b64) {
        const jsonStr = decodeURIComponent(atob(b64));
        const imported = JSON.parse(jsonStr);
        if (imported && imported.id && !bounties.some(b => b.id === imported.id)) {
          bounties.unshift(imported);
          localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));
          showToastNotification('📥 Bounty Imported!', `Imported: "${imported.title}"`, false);
        }
      }
    }
  } catch (e) {}
}

// Reputation Helper
function getReputation(walletAddress) {
  if (!walletAddress) return { reports: 0, isFlagged: false, list: [] };
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const allRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
  const rep = allRep[clean] || { count: 0, reports: 0, list: [] };
  const count = parseInt(rep.count || rep.reports || 0);
  return {
    reports: count,
    isFlagged: count >= 3,
    list: rep.list || []
  };
}

// Initializer
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Immediately switch view synchronously BEFORE any network fetches
  const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp || (navigator.userAgent && navigator.userAgent.indexOf('Nimiq') !== -1));
  const hasWallet = isRealWalletConnected();

  if (isNimiqApp || hasWallet) {
    showView('app');
  } else {
    showView('landing');
  }

  // 2. Initialize local UI components
  initTheme();
  runTypewriter();
  fetchNimiqLiveRPC();
  checkUrlAutoImport();
  updateWalletUI();
  calculateTotalEscrow();
  updateLandingStats();
  checkWalletConnectionGate();

  // 3. Background async network fetches
  await fetchGlobalPublicBounties();
  setInterval(fetchGlobalPublicBounties, 8000);
});

// ==========================================
// GLOBAL LEADERBOARD ENGINE
// ==========================================
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-list-container');
  if (!container) return;

  const workerStats = {};

  approvedPayoutsHistory.forEach(p => {
    if (!p.workerAddress) return;
    const cleanAddr = String(p.workerAddress).replace(/\s+/g, '').toUpperCase();
    if (!workerStats[cleanAddr]) {
      const prof = getProfile(cleanAddr);
      workerStats[cleanAddr] = {
        rawAddress: p.workerAddress,
        cleanAddress: cleanAddr,
        username: prof.username || null,
        totalEarned: 0,
        tasksCompleted: 0
      };
    }
    workerStats[cleanAddr].totalEarned += (parseFloat(p.reward) || 0);
    workerStats[cleanAddr].tasksCompleted += 1;
    if (!workerStats[cleanAddr].username) {
      const prof = getProfile(cleanAddr);
      if (prof.username) workerStats[cleanAddr].username = prof.username;
    }
  });

  const ranked = Object.values(workerStats).sort((a, b) => {
    if (b.totalEarned !== a.totalEarned) return b.totalEarned - a.totalEarned;
    return b.tasksCompleted - a.tasksCompleted;
  });

  if (ranked.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px;">
        <div style="width:56px; height:56px; background:var(--gold-tint); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 14px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8 21 12 17 16 21"/></svg>
        </div>
        <h4 style="font-size:1.1rem; font-weight:800; color:var(--ink); margin-bottom:6px;">No Leaderboard Stats Yet</h4>
        <p style="font-size:0.82rem; color:var(--muted); margin-bottom:0;">Complete active task bounties to earn NIM and climb the global rankings!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = ranked.map((w, index) => {
    const rank = index + 1;
    let rankBadge = `<span style="font-weight:900; color:var(--muted); width:28px; text-align:center; font-size:0.9rem;">#${rank}</span>`;
    if (rank === 1) rankBadge = `<span style="width:28px; height:28px; background:linear-gradient(135deg, #ffc72c 0%, #e6a800 100%); border-radius:50%; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(255,199,44,0.4);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1917" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg></span>`;
    else if (rank === 2) rankBadge = `<span style="width:28px; height:28px; background:linear-gradient(135deg, #94a3b8 0%, #64748b 100%); border-radius:50%; display:inline-flex; align-items:center; justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg></span>`;
    else if (rank === 3) rankBadge = `<span style="width:28px; height:28px; background:linear-gradient(135deg, #d97706 0%, #b45309 100%); border-radius:50%; display:inline-flex; align-items:center; justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg></span>`;

    const isCurrentConnected = userAccount && isSameNimiqAddress(w.cleanAddress, userAccount);
    const displayAddr = `${w.cleanAddress.substring(0, 6)}...${w.cleanAddress.substring(w.cleanAddress.length - 4)}`;
    const currentProf = getProfile(w.cleanAddress);
    const effectiveUsername = currentProf.username || w.username;
    const displayUser = effectiveUsername
      ? `<span style="font-weight:800; color:var(--ink); font-size:0.88rem;">@${effectiveUsername.toUpperCase()}</span>`
      : `<span style="color:var(--muted); font-size:0.8rem; font-style:italic;">No username set</span>`;

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; background:${isCurrentConnected ? 'var(--gold-tint)' : 'var(--card)'}; border:1px solid ${isCurrentConnected ? 'var(--gold-border)' : 'var(--border)'}; border-radius:14px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:12px; min-width:0;">
          ${rankBadge}
          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${displayUser}
              ${isCurrentConnected ? `<span style="background:var(--gold); color:#1a1917; font-size:0.65rem; font-weight:800; padding:1px 5px; border-radius:4px;">YOU</span>` : ''}
            </div>
            <div style="font-size:0.75rem; font-family:var(--font-mono); color:var(--muted); margin-top:2px;">${displayAddr} &bull; ${w.tasksCompleted} task${w.tasksCompleted === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1rem; font-weight:900; color:var(--gold-text);">${w.totalEarned.toFixed(1)} NIM</div>
          <div style="font-size:0.68rem; color:var(--muted); font-weight:700;">TOTAL EARNED</div>
        </div>
      </div>
    `;
  }).join('');
}

function openLeaderboardModal() {
  renderLeaderboard();
  const modal = document.getElementById('modal-leaderboard');
  if (modal) modal.style.display = 'flex';
}

let registrySubtab = 'active';

function switchRegistrySubtab(tab) {
  registrySubtab = tab;
  renderGlobalRegistry();
}

function renderGlobalRegistry() {
  const container = document.getElementById('global-registry-list');
  const countBadge = document.getElementById('registry-count-badge');
  const statsCard = document.getElementById('global-registry-stats-card');
  if (!container) return;

  if (countBadge) countBadge.textContent = `${bounties.length} Bounties Created`;

  if (statsCard) {
    const rawPaidOut = approvedPayoutsHistory.reduce((acc, p) => acc + (parseFloat(p.reward) || 0), 0);
    const formattedPaidOut = rawPaidOut.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const formattedTaskCount = bounties.length.toLocaleString('en-US');

    statsCard.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; width:100%;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:9px; height:9px; border-radius:50%; background:var(--emerald); box-shadow:0 0 10px var(--emerald);"></div>
          <span style="font-size:0.78rem; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em;">GLOBAL PROTOCOL STATS</span>
        </div>
        <span style="font-size:0.7rem; background:var(--gold); color:#1a1917; font-weight:800; padding:3px 10px; border-radius:6px; text-transform:uppercase; letter-spacing:0.04em;">LIVE ENGINE</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; width:100%; box-sizing:border-box;">
        <div style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:16px; padding:18px 16px; text-align:center; min-width:0; width:100%;">
          <div style="font-size:clamp(1.2rem, 3.2vw, 1.8rem); font-weight:900; color:var(--ink); word-break:break-word; line-height:1.2;">${formattedTaskCount}</div>
          <div style="font-size:0.72rem; font-weight:800; color:var(--muted); text-transform:uppercase; margin-top:6px; letter-spacing:0.05em;">TOTAL TASKS CREATED</div>
        </div>
        <div style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:16px; padding:18px 16px; text-align:center; min-width:0; width:100%;">
          <div style="font-size:clamp(1.2rem, 3.2vw, 1.8rem); font-weight:900; color:var(--emerald); word-break:break-word; line-height:1.2;">${formattedPaidOut} NIM</div>
          <div style="font-size:0.72rem; font-weight:800; color:var(--muted); text-transform:uppercase; margin-top:6px; letter-spacing:0.05em;">TOTAL NIM PAID OUT</div>
        </div>
      </div>
    `;
  }

  const activeBounties = bounties.filter(b => getEffectiveSlotsRemaining(b) > 0 && (!b.expiresAt || b.expiresAt > Date.now()));
  const closedBounties = bounties.filter(b => getEffectiveSlotsRemaining(b) <= 0 || (b.expiresAt && b.expiresAt <= Date.now()));

  const currentList = registrySubtab === 'closed' ? closedBounties : activeBounties;

  const subtabsHTML = `
    <div style="display:flex; gap:10px; margin-bottom:16px; width:100%;">
      <button onclick="switchRegistrySubtab('active')" style="flex:1; padding:10px 14px; border-radius:12px; font-size:0.82rem; font-weight:800; border:1px solid ${registrySubtab === 'active' ? 'var(--gold-border)' : 'var(--border)'}; background:${registrySubtab === 'active' ? 'var(--gold-tint)' : 'var(--bg-subtle)'}; color:${registrySubtab === 'active' ? 'var(--gold-text)' : 'var(--muted)'}; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
        <span>Active Bounties</span>
        <span style="font-size:0.7rem; font-weight:900; background:${registrySubtab === 'active' ? 'var(--gold)' : 'var(--border)'}; color:${registrySubtab === 'active' ? '#1a1917' : 'var(--ink)'}; padding:2px 7px; border-radius:10px;">${activeBounties.length}</span>
      </button>
      <button onclick="switchRegistrySubtab('closed')" style="flex:1; padding:10px 14px; border-radius:12px; font-size:0.82rem; font-weight:800; border:1px solid ${registrySubtab === 'closed' ? 'var(--gold-border)' : 'var(--border)'}; background:${registrySubtab === 'closed' ? 'var(--gold-tint)' : 'var(--bg-subtle)'}; color:${registrySubtab === 'closed' ? 'var(--gold-text)' : 'var(--muted)'}; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
        <span>Closed / Completed</span>
        <span style="font-size:0.7rem; font-weight:900; background:${registrySubtab === 'closed' ? 'var(--gold)' : 'var(--border)'}; color:${registrySubtab === 'closed' ? '#1a1917' : 'var(--ink)'}; padding:2px 7px; border-radius:10px;">${closedBounties.length}</span>
      </button>
    </div>
  `;

  if (currentList.length === 0) {
    container.innerHTML = subtabsHTML + createEmptyStateHTML(
      registrySubtab === 'closed' ? 'No Closed Bounties' : 'No Active Bounties',
      registrySubtab === 'closed' ? 'No task bounty pools have been completed or closed yet.' : 'No active bounty pools match this view right now.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    );
    return;
  }

  const itemsHTML = currentList.map(b => {
    const creatorDisplayName = (b.sponsor && String(b.sponsor).trim() && !String(b.sponsor).startsWith('NQ'))
      ? String(b.sponsor).trim().toUpperCase()
      : getUserDisplayName(b.posterAddress);

    const posterRating = getPosterRating(b.posterAddress);
    const isSlotsZero = getEffectiveSlotsRemaining(b) <= 0;
    const timeLeftStr = getBountyTimeLeftStr(b);
    const createdDate = b.createdAt
      ? new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Live Campaign';

    return `
      <div class="paper-card" style="background:var(--card); border:1px solid var(--border); border-radius:20px; padding:20px; margin-bottom:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="bounty-category-tag">${b.categoryName || b.category || 'General'}</span>
            ${posterRating.HTML}
            ${timeLeftStr}
          </div>
          <span style="font-size:1.1rem; font-weight:900; color:var(--gold-text);">${b.reward} NIM</span>
        </div>

        <h4 style="font-size:1.05rem; font-weight:800; color:var(--ink); margin-bottom:6px;">${b.title}</h4>
        <p style="font-size:0.83rem; color:var(--muted); margin-bottom:12px; line-height:1.5;">${b.instructions || b.description || 'Task campaign'}</p>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:10px; border-top:1px dashed var(--border); font-size:0.78rem; flex-wrap:wrap;">
          <div style="color:var(--muted);">Created by: <strong style="color:var(--ink);">${creatorDisplayName}</strong> &bull; ${createdDate}</div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <button onclick="openUserProfileModal('${b.posterAddress}')" style="background:none; border:1px solid var(--border); color:var(--muted); font-size:0.72rem; font-weight:700; padding:4px 10px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              View Profile
            </button>
            <div style="font-weight:700; color:${isSlotsZero ? 'var(--danger)' : 'var(--emerald)'};">Slots: ${getEffectiveSlotsRemaining(b)} / ${b.slotsTotal || 5}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = subtabsHTML + itemsHTML;
}

// ==========================================
// PUBLIC USER PROFILE MODAL
// ==========================================
let _profileModalAddress = null;

function openUserProfileModal(posterAddress) {
  if (!posterAddress) return;
  const clean = String(posterAddress).replace(/\s+/g, '').toUpperCase();
  _profileModalAddress = clean;

  const modal = document.getElementById('modal-user-profile');
  if (!modal) return;

  // Get profile data
  const profile = getProfile(clean);
  const displayName = profile.username ? `@${profile.username.toUpperCase()}` : `${clean.substring(0, 6)}...${clean.substring(clean.length - 4)}`;

  // Avatar
  const avatarEl = document.getElementById('pub-profile-avatar');
  if (avatarEl) {
    if (profile.avatarUrl) {
      avatarEl.innerHTML = `<img src="${profile.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
      avatarEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    }
  }

  // Username
  const usernameEl = document.getElementById('pub-profile-username');
  if (usernameEl) usernameEl.textContent = displayName;

  // Address
  const addrEl = document.getElementById('pub-profile-address');
  if (addrEl) addrEl.textContent = clean;

  // Rating badge
  const ratingEl = document.getElementById('pub-profile-rating-badge');
  if (ratingEl) {
    const ratingData = getPosterRating(clean);
    ratingEl.innerHTML = ratingData.HTML;
  }

  // Stats
  const posterBounties = bounties.filter(b => isSameNimiqAddress(b.posterAddress, clean));
  const paidOutCount = approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.posterAddress || p.workerAddress, clean)).length;
  const paidByPosterCount = bounties.filter(b => isSameNimiqAddress(b.posterAddress, clean))
    .reduce((sum, b) => {
      return sum + approvedPayoutsHistory.filter(p => String(p.bountyId) === String(b.id)).length;
    }, 0);
  const reportsData = getAccountReports(clean);

  const createdEl = document.getElementById('pub-profile-created-count');
  const paidEl = document.getElementById('pub-profile-paid-count');
  const reportsEl = document.getElementById('pub-profile-reports-count');
  if (createdEl) createdEl.textContent = posterBounties.length;
  if (paidEl) paidEl.textContent = paidByPosterCount;
  if (reportsEl) reportsEl.textContent = reportsData ? (reportsData.count || 0) : 0;

  // Tasks list
  const tasksList = document.getElementById('pub-profile-tasks-list');
  if (tasksList) {
    if (posterBounties.length === 0) {
      tasksList.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--muted);font-size:0.85rem;">No bounties created by this user yet.</div>`;
    } else {
      tasksList.innerHTML = posterBounties.map(b => {
        const slotsLeft = getEffectiveSlotsRemaining(b);
        const isActive = slotsLeft > 0 && (!b.expiresAt || b.expiresAt > Date.now());
        return `
          <div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="bounty-category-tag" style="font-size:0.68rem;padding:2px 8px;">${b.categoryName || b.category || 'General'}</span>
                <span style="font-size:0.72rem;font-weight:800;color:${isActive ? 'var(--emerald)' : 'var(--muted)'};background:${isActive ? 'rgba(16,185,129,0.12)' : 'var(--bg-subtle)'};border:1px solid ${isActive ? 'rgba(16,185,129,0.3)' : 'var(--border)'};padding:2px 8px;border-radius:6px;text-transform:uppercase;">${isActive ? 'ACTIVE' : 'CLOSED'}</span>
              </div>
              <span style="font-size:0.95rem;font-weight:900;color:var(--gold-text);">${b.reward} NIM</span>
            </div>
            <div style="font-size:0.9rem;font-weight:800;color:var(--ink);margin-bottom:4px;">${b.title}</div>
            <div style="font-size:0.75rem;color:var(--muted);">Slots: ${slotsLeft} / ${b.slotsTotal || 5} remaining</div>
          </div>
        `;
      }).join('');
    }
  }

  modal.style.display = 'flex';
}

function closeUserProfileModalOnBackdrop(event) {
  if (event.target === document.getElementById('modal-user-profile')) {
    closeModal('modal-user-profile');
  }
}

function copyPosterAddressFromModal() {
  if (!_profileModalAddress) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(_profileModalAddress)
      .then(() => showToastNotification('Address Copied!', `${_profileModalAddress.substring(0, 10)}... copied to clipboard.`, false))
      .catch(() => fallbackCopyToClipboard(_profileModalAddress));
  } else {
    fallbackCopyToClipboard(_profileModalAddress);
  }
}

function fallbackCopyToClipboard(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  showToastNotification('Address Copied!', `${text.substring(0, 10)}... copied to clipboard.`, false);
}

function triggerConfetti() {
  if (typeof window.confetti === 'function') {
    window.confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });
  } else {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    const colors = ['#e5a93c', '#10b981', '#3b82f6', '#ec4899', '#f59e0b'];
    for (let i = 0; i < 65; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 300,
        y: canvas.height * 0.4 + (Math.random() - 0.5) * 100,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.8) * 16,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 12
      });
    }
    let frame = 0;
    function anim() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.45;
        p.rotation += p.vRot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      frame++;
      if (frame < 60) requestAnimationFrame(anim);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    anim();
  }
}

function handleScreenshotThumbnailClick(arg1, arg2) {
  let evt = null;
  let targetEl = null;

  if (arg1 && typeof arg1.stopPropagation === 'function') {
    evt = arg1;
    targetEl = arg2;
  } else if (arg1 && arg1.nodeType) {
    targetEl = arg1;
    evt = arg2;
  }

  if (evt) {
    if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
    if (typeof evt.preventDefault === 'function') evt.preventDefault();
  }

  if (!targetEl && arg1 && arg1.nodeType) targetEl = arg1;
  if (!targetEl) return;

  const subId = targetEl.getAttribute('data-sub-id');
  const imgInside = targetEl.querySelector('img');
  const srcFromImg = imgInside ? imgInside.src : null;

  openScreenshotLightbox(subId, srcFromImg);
}

function openScreenshotLightbox(subId, directSrc = null) {
  const modal = document.getElementById('modal-screenshot-lightbox');
  const imgEl = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  const downloadBtn = document.getElementById('lightbox-download-btn');
  const spinnerEl = document.getElementById('lightbox-spinner');

  if (!modal || !imgEl) return;

  let targetSrc = null;
  let targetTitle = 'Proof Screenshot';

  if (subId) {
    const sub = pendingSubmissions.find(s => String(s.id) === String(subId)) ||
                approvedPayoutsHistory.find(s => String(s.id) === String(subId));
    if (sub) {
      targetTitle = sub.bountyTitle || 'Proof Screenshot';
      const content = sub.content || '';
      if (content.startsWith('data:image') || content.startsWith('http://') || content.startsWith('https://')) {
        targetSrc = content;
      } else if (content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.image) targetSrc = parsed.image;
          else if (parsed.url) targetSrc = parsed.url;
        } catch (e) {}
      }
    }
  }

  if (!targetSrc) targetSrc = directSrc;

  if (!targetSrc || targetSrc.endsWith('#') || targetSrc === window.location.href) {
    showToastNotification('Image Error', 'Could not load screenshot preview.', true);
    return;
  }

  if (titleEl) titleEl.textContent = targetTitle;
  if (downloadBtn) downloadBtn.href = targetSrc;
  const openDirectBtn = document.getElementById('lightbox-open-direct-btn');
  if (openDirectBtn) openDirectBtn.href = targetSrc;

  if (spinnerEl) {
    spinnerEl.style.display = 'flex';
    spinnerEl.innerHTML = `
      <div style="width:32px; height:32px; border:3px solid rgba(255,255,255,0.2); border-top-color:var(--gold); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:0.8rem; font-weight:600;">Loading HD Screenshot...</span>
    `;
  }
  imgEl.style.display = 'none';

  imgEl.onload = () => {
    if (spinnerEl) spinnerEl.style.display = 'none';
    imgEl.style.display = 'block';
  };

  imgEl.onerror = () => {
    if (spinnerEl) {
      spinnerEl.style.display = 'flex';
      spinnerEl.innerHTML = '<span style="color:#ef4444; font-weight:700; font-size:0.88rem;">⚠️ Image preview failed to render</span>';
    }
  };

  imgEl.src = targetSrc;

  if (imgEl.complete && imgEl.naturalWidth !== 0) {
    if (spinnerEl) spinnerEl.style.display = 'none';
    imgEl.style.display = 'block';
  }

  isLightboxZoomed = false;
  const txtEl = document.getElementById('lightbox-zoom-text');
  if (txtEl) txtEl.textContent = 'Full Zoom';
  imgEl.style.maxHeight = '75vh';
  imgEl.style.width = 'auto';
  imgEl.style.maxWidth = '100%';
  imgEl.style.objectFit = 'contain';

  modal.style.display = 'flex';
}

let isLightboxZoomed = false;

function toggleLightboxZoom() {
  const imgEl = document.getElementById('lightbox-img');
  const txtEl = document.getElementById('lightbox-zoom-text');
  if (!imgEl) return;

  isLightboxZoomed = !isLightboxZoomed;
  if (isLightboxZoomed) {
    imgEl.style.maxHeight = 'none';
    imgEl.style.width = '100%';
    imgEl.style.objectFit = 'initial';
    if (txtEl) txtEl.textContent = 'Fit Screen';
  } else {
    imgEl.style.maxHeight = '75vh';
    imgEl.style.width = 'auto';
    imgEl.style.maxWidth = '100%';
    imgEl.style.objectFit = 'contain';
    if (txtEl) txtEl.textContent = 'Full Zoom';
  }
}

function toggleCardImageExpand(imgId, btnId) {
  const img = document.getElementById(imgId);
  const btn = document.getElementById(btnId);
  if (!img) return;

  if (img.style.maxHeight === 'none') {
    img.style.maxHeight = '180px';
    img.style.objectFit = 'cover';
    if (btn) btn.innerHTML = '↔ Expand Full Size';
  } else {
    img.style.maxHeight = 'none';
    img.style.objectFit = 'contain';
    if (btn) btn.innerHTML = '↕ Collapse Preview';
  }
}

function closeLightboxOnBackdrop(event) {
  if (event.target && event.target.id === 'modal-screenshot-lightbox') {
    document.getElementById('modal-screenshot-lightbox').style.display = 'none';
  }
}
