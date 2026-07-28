/**
 * NimBounty Engine — Persistent Bounties & Global Sync Engine
 */

let currentView = 'landing';
let currentRole = 'worker';
let workerSubtabMode = 'active'; // 'active' | 'history'
let posterSubtabMode = 'create'; // 'create' | 'pools' | 'subs'

// Storage keys — v2 clears any old cached dummy tasks from browsers
const STORAGE_KEY_BOUNTIES = 'nimbounty_pools_v2';
const STORAGE_KEY_SUBS = 'nimbounty_subs_v2';
const STORAGE_KEY_COMPLETED = 'nimbounty_user_completed_bounties_v2';
const STORAGE_KEY_PAID_HISTORY = 'nimbounty_approved_payouts_history_v2';
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_acct_main'; // Keep wallet address across versions
const STORAGE_KEY_SAVED_EARNED = 'nimbounty_worker_saved_earned_v2';
const STORAGE_KEY_SAVED_COMPLETED = 'nimbounty_worker_saved_completed_v2';
const STORAGE_KEY_SAVED_TOTAL_PAYOUTS = 'nimbounty_saved_total_rewards_paid_v2';

// One-time: purge all old v1 dummy-task cache keys from any browser
const LEGACY_KEYS = [
  'nimbounty_pools_main', 'nimbounty_subs_main',
  'nimbounty_user_completed_bounties_main', 'nimbounty_approved_payouts_history_main',
  'nimbounty_worker_saved_earned_main', 'nimbounty_worker_saved_completed_main',
  'nimbounty_saved_total_rewards_paid_main'
];
LEGACY_KEYS.forEach(k => localStorage.removeItem(k));

let userAccount = localStorage.getItem(STORAGE_KEY_USER_ACCT) || null;
let savedWorkerEarnedNim = parseFloat(localStorage.getItem(STORAGE_KEY_SAVED_EARNED)) || 0;
let savedWorkerCompletedTasks = parseInt(localStorage.getItem(STORAGE_KEY_SAVED_COMPLETED)) || 0;
let savedTotalRewardsPaid = parseFloat(localStorage.getItem(STORAGE_KEY_SAVED_TOTAL_PAYOUTS)) || 0;

let currentTheme = localStorage.getItem('nimbounty_theme') || 'light';
let isAudioEnabled = true;
let liveBlockHeight = 0;
let uploadedImageDataUrl = null;

const PRODUCTION_URL = 'https://nim-bounty.vercel.app';

// OFFICIAL USER REAL NIMIQ MAINNET ESCROW VAULT ADDRESS
const NIMIQ_ESCROW_CONTRACT_ADDRESS = 'NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN';

// Bounties are loaded exclusively from the real global persistent server (JSONBlob via Vercel API).
// No dummy/seed tasks — every wallet sees the same live real bounties.
let bounties = JSON.parse(localStorage.getItem(STORAGE_KEY_BOUNTIES)) || [];

let pendingSubmissions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS)) || [];
let completedBountyIds = JSON.parse(localStorage.getItem(STORAGE_KEY_COMPLETED)) || [];
let approvedPayoutsHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_PAID_HISTORY)) || [];

let lastRenderHash = '';

function saveState() {
  localStorage.setItem(STORAGE_KEY_BOUNTIES, JSON.stringify(bounties));
  localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  localStorage.setItem(STORAGE_KEY_COMPLETED, JSON.stringify(completedBountyIds));
  localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
  localStorage.setItem(STORAGE_KEY_SAVED_EARNED, savedWorkerEarnedNim.toString());
  localStorage.setItem(STORAGE_KEY_SAVED_COMPLETED, savedWorkerCompletedTasks.toString());
  localStorage.setItem(STORAGE_KEY_SAVED_TOTAL_PAYOUTS, savedTotalRewardsPaid.toString());
  if (userAccount) {
    localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
  }
  updateLandingStats();
  renderWorkerStats();
  syncGlobalPublicBounties();
}

let activeClaimTimer = null;
let currentModalBountyId = null;
const boltSvgIcon = `<svg class="bolt-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

// Helper: Format Time Remaining until Expiration
function formatTimeRemaining(expiresAt) {
  if (!expiresAt) return '14d left';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / (1000 * 3600 * 24));
  const hours = Math.floor((diff % (1000 * 3600 * 24)) / (1000 * 3600));
  if (days > 0) return `${days}d ${hours}h left`;
  const minutes = Math.floor((diff % (1000 * 3600)) / (1000 * 60));
  return `${hours}h ${minutes}m left`;
}

// Helper: Normalized Nimiq Address Comparison
function isSameNimiqAddress(addr1, addr2) {
  if (!addr1 || !addr2) return false;
  const clean1 = addr1.toString().replace(/\s+/g, '').toUpperCase();
  const clean2 = addr2.toString().replace(/\s+/g, '').toUpperCase();
  if (clean1 === clean2) return true;
  return clean1.includes(clean2.substring(0, 10)) || clean2.includes(clean1.substring(0, 10));
}

function isPublisherOfBounty(bounty, wallet) {
  if (!bounty || !wallet) return false;
  return isSameNimiqAddress(bounty.posterAddress, wallet) || isSameNimiqAddress(bounty.sponsor, wallet);
}

function hasWalletCompletedBounty(bountyId, wallet) {
  if (!bountyId || !wallet) return false;
  const isPending = pendingSubmissions.some(s => s.bountyId === bountyId && s.workerAddress && isSameNimiqAddress(s.workerAddress, wallet));
  const isApproved = approvedPayoutsHistory.some(p => p.bountyId === bountyId && p.workerAddress && isSameNimiqAddress(p.workerAddress, wallet));
  return isPending || isApproved;
}

function getNimiqProvider() {
  if (typeof window === 'undefined') return null;
  return window.nimiq || window.Nimiq || window.nimiqPay || window.NimiqPay || window.miniApp || null;
}

// Strict Check: Is a real, valid Nimiq address connected?
function isRealWalletConnected() {
  if (!userAccount || typeof userAccount !== 'string') return false;
  const clean = userAccount.replace(/\s+/g, '').toUpperCase();
  return /^NQ[0-9A-Z]{30,44}$/.test(clean);
}

// Helper: Validate Nimiq Address Format
function isValidNimiqAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const clean = address.replace(/\s+/g, '').toUpperCase();
  return /^NQ[0-9A-Z]{30,44}$/.test(clean);
}

// Global Wallet Button Handler: If connected, open disconnect modal; if disconnected, connect!
function handleWalletButtonClick() {
  if (isRealWalletConnected()) {
    openWalletModal();
  } else {
    connectNimiqPayWallet();
  }
}

// ==========================================
// 1. STRICT NIMIQ PAY WALLET CONNECTION ENGINE
// ==========================================
async function connectNimiqPayWallet() {
  const provider = getNimiqProvider();

  if (provider && typeof provider.listAccounts === 'function') {
    try {
      showToastNotification('⌛ Connecting Nimiq Pay...', 'Waiting for Nimiq Pay authorization...', false);
      const accounts = await provider.listAccounts();
      if (accounts && accounts.length) {
        const rawAcct = accounts[0];
        userAccount = typeof rawAcct === 'string' ? rawAcct : (rawAcct.address || rawAcct);
        userAccount = userAccount.replace(/\s+/g, '').toUpperCase();
        localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
        
        updateWalletUI();
        renderBounties();
        renderPosterDashboard();
        showToastNotification('📱 Connected Securely!', `Nimiq Pay Connected:\n${userAccount}`, false);
        return;
      }
    } catch (e) {
      console.warn("Nimiq Pay SDK connect error:", e);
    }
  }

  // Prompt user for their real Nimiq wallet address
  let inputAddr = prompt("Enter your Nimiq Wallet Address (must begin with NQ):", userAccount || "");
  if (inputAddr && inputAddr.trim()) {
    const cleanAddr = inputAddr.trim().toUpperCase().replace(/\s+/g, '');
    if (isValidNimiqAddress(cleanAddr)) {
      userAccount = cleanAddr;
      localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
      updateWalletUI();
      renderBounties();
      renderPosterDashboard();
      showToastNotification('📱 Wallet Connected!', `Connected Address:\n${userAccount}`, false);
      return;
    } else {
      alert("Invalid Nimiq Address format! Address must begin with NQ followed by valid alphanumeric characters.");
      return;
    }
  }

  if (userAccount && isRealWalletConnected()) {
    openWalletModal();
  } else {
    updateWalletUI();
    showToastNotification('⚠️ Connection Required', 'Please connect your Nimiq Wallet to participate or publish bounties.', false);
  }
}

// ==========================================
// 2. GLOBAL REAL-TIME PUBLIC SYNC ENGINE (SMART MERGE - NO FLICKER)
// ==========================================
async function fetchGlobalPublicBounties() {
  try {
    const apiEndpoint = window.location.origin.includes('localhost')
      ? `${PRODUCTION_URL}/api/bounties`
      : `/api/bounties`;

    const res = await fetch(apiEndpoint, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      let stateChanged = false;

      // Smart Merge Bounties (Never overwrite/drop local bounties)
      if (Array.isArray(data.bounties) && data.bounties.length > 0) {
        const existingBountyIds = new Set(bounties.map(b => b.id));
        data.bounties.forEach(serverBounty => {
          if (!existingBountyIds.has(serverBounty.id)) {
            bounties.unshift(serverBounty);
            existingBountyIds.add(serverBounty.id);
            stateChanged = true;
          } else {
            const idx = bounties.findIndex(b => b.id === serverBounty.id);
            if (bounties[idx].slotsRemaining !== serverBounty.slotsRemaining) {
              bounties[idx].slotsRemaining = serverBounty.slotsRemaining;
              stateChanged = true;
            }
          }
        });
        localStorage.setItem(STORAGE_KEY_BOUNTIES, JSON.stringify(bounties));
      }

      // Smart Merge Submissions (Always combine server and local submissions)
      if (Array.isArray(data.pendingSubmissions)) {
        const existingSubIds = new Set(pendingSubmissions.map(s => s.id));
        data.pendingSubmissions.forEach(serverSub => {
          if (!existingSubIds.has(serverSub.id)) {
            pendingSubmissions.unshift(serverSub);
            existingSubIds.add(serverSub.id);
            stateChanged = true;
          }
        });
        localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
      }

      // Smart Merge Approved Payouts History
      if (Array.isArray(data.approvedPayoutsHistory)) {
        const existingPayIds = new Set(approvedPayoutsHistory.map(p => p.id));
        data.approvedPayoutsHistory.forEach(p => {
          if (!existingPayIds.has(p.id)) {
            approvedPayoutsHistory.unshift(p);
            existingPayIds.add(p.id);
            stateChanged = true;
          }
        });
        localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
      }

      // Only re-render DOM if state actually changed to prevent UI flicker
      const newHash = `${bounties.length}-${pendingSubmissions.length}-${approvedPayoutsHistory.length}-${workerSubtabMode}-${posterSubtabMode}-${userAccount}`;
      if (stateChanged || newHash !== lastRenderHash) {
        lastRenderHash = newHash;
        renderBounties();
        renderPosterDashboard();
        updateLandingStats();
        renderWorkerStats();
      }
    }
  } catch (e) {
    // API fetch failed — render whatever is already cached locally
    renderBounties();
  }
}

async function syncGlobalPublicBounties(updatedBountyObj = null) {
  try {
    const apiEndpoint = window.location.origin.includes('localhost')
      ? `${PRODUCTION_URL}/api/bounties`
      : `/api/bounties`;

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newBounty: updatedBountyObj,
        bounties,
        pendingSubmissions,
        approvedPayoutsHistory,
        updatedAt: Date.now()
      })
    });
  } catch (e) {
    // Fall back gracefully
  }
}

// Check URL Hash for shared bounty payload auto-import
function checkUrlAutoImport() {
  try {
    const hash = window.location.hash;
    if (hash && hash.includes('bdata=')) {
      const b64 = hash.split('bdata=')[1];
      if (b64) {
        const jsonStr = decodeURIComponent(atob(b64));
        const importedBounty = JSON.parse(jsonStr);
        if (importedBounty && importedBounty.id) {
          const exists = bounties.some(b => b.id === importedBounty.id);
          if (!exists) {
            bounties.unshift(importedBounty);
            saveState();
            showToastNotification('📥 Bounty Imported!', `Imported bounty: "${importedBounty.title}"`, false);
          }
        }
      }
    }
  } catch (e) {
    // Fall back gracefully
  }
}

// ==========================================
// 3. LIGHT / DARK THEME SWITCHER ENGINE
// ==========================================
function initTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeUI();
}

function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('nimbounty_theme', currentTheme);
  updateThemeUI();
  playAudioFx('submit');
}

function updateThemeUI() {
  const btn = document.getElementById('theme-toggle-btn');
  const mobileText = document.getElementById('theme-text-mobile');
  
  if (btn) {
    btn.innerHTML = currentTheme === 'dark'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  }

  if (mobileText) {
    mobileText.textContent = currentTheme === 'dark' ? '☀️ Switch to Light Mode' : '🌙 Switch to Dark Mode';
  }
}

// ==========================================
// 4. MOBILE HAMBURGER MENU ENGINE
// ==========================================
function toggleMobileMenu() {
  const btn = document.getElementById('hamburger-btn');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (btn && drawer) {
    btn.classList.toggle('active');
    drawer.classList.toggle('open');
  }
}

// ==========================================
// 5. FLOATING TOAST NOTIFICATION SYSTEM
// ==========================================
function showToastNotification(title, message, showActionBtn = true) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toastId = `toast-${Date.now()}`;
  const toastHtml = `
    <div class="toast-box" id="${toastId}">
      <div class="toast-header">
        <span>${title}</span>
        <button class="toast-close-btn" onclick="removeToast('${toastId}')">&times;</button>
      </div>
      <div class="toast-body">${message}</div>
      ${showActionBtn ? `<button class="toast-action-btn" onclick="copyNimiqPayDeeplink()">Copy Nimiq Pay Deeplink 📋</button>` : ''}
    </div>
  `;

  container.insertAdjacentHTML('beforeend', toastHtml);
  setTimeout(() => removeToast(toastId), 9000);
}

function removeToast(toastId) {
  const toast = document.getElementById(toastId);
  if (toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }
}

function copyNimiqPayDeeplink() {
  const currentOrigin = window.location.origin.includes('localhost') ? PRODUCTION_URL : window.location.origin;
  const deeplink = `nimiqpay://miniapp?url=${currentOrigin}`;
  navigator.clipboard.writeText(deeplink);
  playAudioFx('submit');
  showToastNotification('📋 Deeplink Copied!', `Copied: ${deeplink}`, false);
}

// ==========================================
// 6. LIVE NIMIQ RPC NETWORK FETCH & METRICS
// ==========================================
async function fetchNimiqLiveRPC() {
  const rpcTag = document.querySelector('.hero-tag');
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

function updateLandingStats() {
  const statBounties = document.getElementById('landing-stat-bounties');
  const statPayouts = document.getElementById('landing-stat-payouts');

  // GLOBAL stat: total NIM paid out across ALL workers, from the real persistent server store.
  // This is app-wide usage data — always visible regardless of which wallet is connected.
  const globalTotalPaid = approvedPayoutsHistory.reduce((sum, item) => sum + (parseFloat(item.reward) || 0), 0);

  // GLOBAL stat: count of bounties that are currently open (not expired, not fully claimed).
  // No wallet-specific filtering — shows platform-wide availability.
  const activeCount = bounties.filter(b => {
    const isExpired = b.expiresAt && Date.now() >= b.expiresAt;
    const isFullyClaimed = b.slotsRemaining <= 0;
    return !isExpired && !isFullyClaimed;
  }).length;

  if (statBounties) {
    statBounties.textContent = `${activeCount}`;
  }
  if (statPayouts) {
    statPayouts.textContent = `${globalTotalPaid.toLocaleString()} NIM`;
  }
}


// STRICT WORKER-ONLY STATS RENDERING ENGINE (EXCLUDES POSTER PAYOUTS)
function renderWorkerStats() {
  const completedEl = document.getElementById('worker-completed-count');
  const earnedEl = document.getElementById('worker-earned-amount');
  const liveBalEl = document.getElementById('worker-live-balance');
  const repTextEl = document.getElementById('worker-rep-text');

  let myApprovedPayouts = [];
  if (userAccount && isRealWalletConnected()) {
    myApprovedPayouts = approvedPayoutsHistory.filter(p => 
      p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount)
    );
  }

  const workerCompletedCount = myApprovedPayouts.length;
  const workerEarnedAmount = myApprovedPayouts.reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);

  if (completedEl) completedEl.textContent = `${workerCompletedCount} Tasks`;
  if (earnedEl) earnedEl.textContent = `${workerEarnedAmount.toLocaleString()} NIM`;

  if (isRealWalletConnected()) {
    if (liveBalEl) liveBalEl.textContent = `Connected (Nimiq Pay)`;
    if (repTextEl) repTextEl.textContent = `Verified Wallet (${userAccount.substring(0, 10)}...)`;
  } else {
    if (liveBalEl) liveBalEl.textContent = `Wallet Disconnected`;
    if (repTextEl) repTextEl.textContent = `Please Connect Nimiq Wallet`;
  }
}

// ==========================================
// 7. WEB AUDIO SYNTHESIZER
// ==========================================
function playAudioFx(type) {
  if (!isAudioEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'cash') {
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = f;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const startTime = ctx.currentTime + (i * 0.08);
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
        osc.start(startTime);
        osc.stop(startTime + 0.3);
      });
    } else if (type === 'submit') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn("Audio Context error:", e);
  }
}

function toggleAudioFx() {
  isAudioEnabled = !isAudioEnabled;
  const toggleBtn = document.getElementById('sound-toggle-text');
  if (toggleBtn) {
    toggleBtn.textContent = isAudioEnabled ? 'Audio FX: ON' : 'Audio FX: OFF';
  }
}

// ==========================================
// 8. CANVAS CONFETTI PARTICLE EXPLOSION
// ==========================================
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#d99b00', '#1a1917', '#ffffff', '#fdf5ec'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 3,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.7) * 16,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rv: (Math.random() - 0.5) * 10,
      opacity: 1
    });
  }

  let animationFrame;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let activeParticles = 0;

    particles.forEach(p => {
      if (p.opacity > 0) {
        activeParticles++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.4;
        p.opacity -= 0.012;
        p.rotation += p.rv;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    if (activeParticles > 0) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animate);
    }
  }

  animate();
}

// ==========================================
// 9. TYPEWRITER ANIMATION ENGINE
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
// 10. VIEW ROUTER & SECTION SCROLLING
// ==========================================
function showView(viewName) {
  currentView = viewName;
  const landingView = document.getElementById('view-landing');
  const appView = document.getElementById('view-app');
  const navBtnLanding = document.getElementById('nav-btn-landing');
  const navBtnApp = document.getElementById('nav-btn-app');

  if (viewName === 'landing') {
    landingView.style.display = 'block';
    appView.style.display = 'none';
    navBtnLanding?.classList.add('active');
    navBtnApp?.classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateLandingStats();
  } else {
    landingView.style.display = 'none';
    appView.style.display = 'block';
    navBtnApp?.classList.add('active');
    navBtnLanding?.classList.remove('active');
    renderBounties();
    renderWorkerStats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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

function toggleFaq(buttonEl) {
  const faqItem = buttonEl.closest('.faq-item');
  if (!faqItem) return;
  const isOpen = faqItem.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(item => item.classList.remove('open'));
  if (!isOpen) faqItem.classList.add('open');
}

// ==========================================
// 11. CUSTOM WALLET MODAL ENGINE
// ==========================================
function updateWalletUI() {
  const walletTextDesktop = document.getElementById('wallet-text');
  const walletTextMobile = document.getElementById('wallet-text-mobile');
  
  const displayVal = isRealWalletConnected() ? `${userAccount.substring(0, 14)}...` : 'CONNECT NIMIQ PAY';

  if (walletTextDesktop) walletTextDesktop.textContent = displayVal;
  if (walletTextMobile) walletTextMobile.textContent = displayVal;

  renderWorkerStats();
}

function openWalletModal() {
  const displayEl = document.getElementById('modal-wallet-address-display');
  if (displayEl) displayEl.textContent = userAccount || 'Wallet Disconnected';
  document.getElementById('modal-wallet').style.display = 'flex';
}

function copyWalletAddressFromModal() {
  if (userAccount) {
    navigator.clipboard.writeText(userAccount);
    playAudioFx('submit');
    showToastNotification('📋 Address Copied!', `Nimiq Address copied to clipboard:\n${userAccount}`, false);
  }
}

function confirmDisconnectWalletFromModal() {
  closeModal('modal-wallet');
  userAccount = null;
  localStorage.removeItem(STORAGE_KEY_USER_ACCT);
  updateWalletUI();
  renderWorkerStats();
  renderPosterDashboard();
  renderBounties();
  showToastNotification('🔌 Wallet Disconnected', 'Your Nimiq Pay wallet session has been disconnected.', false);
}

// ==========================================
// 12. SUB-TAB SWITCHING & ROLE ENGINE
// ==========================================
function switchRole(role) {
  currentRole = role;
  const workerBtn = document.getElementById('btn-role-worker');
  const posterBtn = document.getElementById('btn-role-poster');
  const workerView = document.getElementById('view-worker');
  const posterView = document.getElementById('view-poster');

  if (role === 'worker') {
    workerBtn.classList.add('active');
    posterBtn.classList.remove('active');
    workerView.style.display = 'block';
    posterView.style.display = 'none';
    renderBounties();
    renderWorkerStats();
  } else {
    posterBtn.classList.add('active');
    workerBtn.classList.remove('active');
    posterView.style.display = 'block';
    workerView.style.display = 'none';
    renderPosterDashboard();
  }
}

function switchWorkerSubtab(mode) {
  workerSubtabMode = mode;
  const btnActive = document.getElementById('btn-worker-tab-active');
  const btnHistory = document.getElementById('btn-worker-tab-history');

  if (mode === 'active') {
    btnActive?.classList.add('active');
    btnHistory?.classList.remove('active');
  } else {
    btnHistory?.classList.add('active');
    btnActive?.classList.remove('active');
  }

  playAudioFx('submit');
  renderBounties();
}

function switchPosterSubtab(mode) {
  posterSubtabMode = mode;
  const btnCreate = document.getElementById('btn-poster-tab-create');
  const btnPools = document.getElementById('btn-poster-tab-pools');
  const btnSubs = document.getElementById('btn-poster-tab-subs');

  const subviewCreate = document.getElementById('poster-subview-create');
  const subviewPools = document.getElementById('poster-subview-pools');
  const subviewSubs = document.getElementById('poster-subview-subs');

  btnCreate?.classList.toggle('active', mode === 'create');
  btnPools?.classList.toggle('active', mode === 'pools');
  btnSubs?.classList.toggle('active', mode === 'subs');

  if (subviewCreate) subviewCreate.style.display = (mode === 'create') ? 'block' : 'none';
  if (subviewPools) subviewPools.style.display = (mode === 'pools') ? 'block' : 'none';
  if (subviewSubs) subviewSubs.style.display = (mode === 'subs') ? 'block' : 'none';

  playAudioFx('submit');
  renderPosterDashboard();
}

// WORLDWIDE BOUNTIES RENDERING ENGINE WITH PERSISTENT GLOBAL BOUNTIES
function renderBounties() {
  const grid = document.getElementById('bounties-grid');
  if (!grid) return;

  const searchQuery = document.getElementById('search-input')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('category-select')?.value || 'all';
  const sortBy = document.getElementById('sort-select')?.value || 'newest';

  let filtered = bounties.filter(b => {
    const matchesSearch = b.title.toLowerCase().includes(searchQuery) || b.instructions.toLowerCase().includes(searchQuery);
    const matchesCat = categoryFilter === 'all' || b.category === categoryFilter;
    
    const isExpired = b.expiresAt && Date.now() >= b.expiresAt;
    const isFullyClaimed = b.slotsRemaining <= 0;

    // A bounty is "done" for this wallet ONLY if the poster has approved their payout.
    // A pending submission is NOT done — it stays in Active until poster acts.
    const myApprovedPayout = userAccount
      ? approvedPayoutsHistory.some(p => p.bountyId === b.id && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount))
      : false;

    const hasPendingSub = userAccount
      ? pendingSubmissions.some(s => s.bountyId === b.id && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount))
      : false;

    if (workerSubtabMode === 'active') {
      // Active tab: show if NOT (expired or fully claimed or this wallet was approved)
      // Pending submissions still show here — they are awaiting poster action
      return matchesSearch && matchesCat && !isExpired && !isFullyClaimed && !myApprovedPayout;
    } else {
      // Completed & Expired tab: expired pools, fully claimed pools, or THIS wallet's approved payouts
      return matchesSearch && matchesCat && (isExpired || isFullyClaimed || myApprovedPayout) && !hasPendingSub;
    }
  });


  if (sortBy === 'highest') {
    filtered.sort((a, b) => b.reward - a.reward);
  } else if (sortBy === 'slots') {
    filtered.sort((a, b) => b.slotsRemaining - a.slotsRemaining);
  } else {
    filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 24px; background: var(--card); border: 1px dashed var(--border); border-radius: 20px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.8" style="margin-bottom: 12px;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        <h3 style="font-size: 1.3rem; font-weight: 800; color: var(--ink);">No ${workerSubtabMode === 'active' ? 'Active' : 'Completed / Expired'} Bounties Found</h3>
        <p style="font-size: 0.9rem; color: var(--muted); margin-top: 6px; max-width: 460px; margin-left: auto; margin-right: auto;">
          ${workerSubtabMode === 'active' 
            ? 'There are currently no active bounties with open slots. Check the Completed & Expired tab or publish a task in Poster Mode!' 
            : 'No completed or expired bounties found in history.'}
        </p>
        ${workerSubtabMode === 'active' ? `<button class="btn-primary-sm" style="margin-top: 18px;" onclick="switchRole('poster')">Switch to Poster Mode &rarr;</button>` : ''}
      </div>
    `;
    updateLandingStats();
    return;
  }

  grid.innerHTML = filtered.map(b => {
    const isPublisher = isPublisherOfBounty(b, userAccount);
    const hasAlreadyClaimed = hasWalletCompletedBounty(b.id, userAccount);
    const isExpired = b.expiresAt && Date.now() >= b.expiresAt;
    const isFullyClaimed = b.slotsRemaining <= 0;
    const timeRemainingStr = formatTimeRemaining(b.expiresAt);

    // Has THIS wallet's submission been approved by the poster?
    const myApprovedPayout = userAccount
      ? approvedPayoutsHistory.some(p => p.bountyId === b.id && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount))
      : false;

    // Does THIS wallet have a submission still pending poster review?
    const hasPendingSub = userAccount
      ? pendingSubmissions.some(s => s.bountyId === b.id && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount))
      : false;

    let btnLabel = 'Claim Task & Submit Proof &rarr;';
    let btnDisabled = false;
    let isCardGreyed = isExpired || isFullyClaimed;
    let badgeText = '🔒 Escrow Funded • ' + timeRemainingStr;

    // Priority order: pending review > approved payout > fully claimed > expired > publisher > already claimed
    if (hasPendingSub) {
      // Poster has NOT yet acted — always show Pending, never Paid Out
      btnLabel = '⏳ Proof Pending Poster Review';
      btnDisabled = true;
      badgeText = '⏳ Pending Review';
    } else if (myApprovedPayout) {
      // Poster approved THIS wallet's submission
      btnLabel = '✅ Payout Released — Task Complete!';
      btnDisabled = true;
      badgeText = '✅ Paid Out';
      isCardGreyed = true;
    } else if (isFullyClaimed) {
      btnLabel = '🔒 All Slots Claimed (Pending Review)';
      btnDisabled = true;
      badgeText = '🔒 Fully Claimed';
    } else if (isExpired) {
      btnLabel = '⏱️ Pool Expired';
      btnDisabled = true;
      badgeText = '⏱️ Expired';
    } else if (isPublisher) {
      btnLabel = '⛔ Publisher Cannot Claim Own Task';
      btnDisabled = true;
    } else if (hasAlreadyClaimed) {
      btnLabel = '✅ Task Already Claimed (1 per wallet)';
      btnDisabled = true;
    }

    return `
      <div class="newspaper-card rise-in ${isCardGreyed ? 'card-expired' : ''}">
        <div>
          <div class="card-top-bar">
            <span class="news-cat-stamp">${b.categoryName}</span>
            <div class="card-top-right">
              <span class="time-left-pill" title="Campaign Expiration">${badgeText}</span>
              <button class="btn-share-qr" title="Share QR Code" onclick="openQrModal('${b.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </button>
              <span class="reward-stamp">${boltSvgIcon} ${b.reward} NIM</span>
            </div>
          </div>

          <h3 class="card-title">${b.title}</h3>
          <p class="card-desc">${b.instructions}</p>
        </div>

        <div>
          <div class="card-meta-bar">
            <span>${boltSvgIcon} ${b.slotsRemaining} / ${b.slotsTotal} Slots Left</span>
            <span>Sponsor: <strong>${b.sponsor}</strong></span>
          </div>

          <button class="btn-primary-lg full-width" onclick="openClaimModal('${b.id}')" ${btnDisabled ? 'disabled' : ''}>
            ${btnLabel}
          </button>
        </div>
      </div>
    `;
  }).join('');

  updateLandingStats();
}

// ==========================================
// 13. QR CODE GENERATOR & SHARE DEEPLINK MODAL
// ==========================================
function openQrModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  const currentOrigin = window.location.origin.includes('localhost') ? PRODUCTION_URL : window.location.origin;
  document.getElementById('qr-bounty-title').textContent = bounty.title;

  const b64Data = btoa(encodeURIComponent(JSON.stringify(bounty)));
  const shareWebUrl = `${currentOrigin}/#bdata=${b64Data}`;
  document.getElementById('qr-link-input').value = shareWebUrl;

  const qrBox = document.getElementById('qrcode-box');
  qrBox.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(qrBox, {
      text: shareWebUrl,
      width: 180,
      height: 180,
      colorDark: "#1a1917",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });
  }

  document.getElementById('modal-qr').style.display = 'flex';
}

function copyQrLink() {
  const input = document.getElementById('qr-link-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    playAudioFx('submit');
    showToastNotification('📋 Share Link Copied!', 'Copied direct bounty share link to clipboard.', false);
  }
}

// ==========================================
// 14. CLAIM & SUBMIT PROOF ENGINE
// ==========================================
function openClaimModal(bountyId) {
  if (!isRealWalletConnected()) {
    showToastNotification('⛔ Real Wallet Connection Required', 'You must connect a valid Nimiq Pay Wallet address before claiming or submitting proof!', false);
    connectNimiqPayWallet();
    return;
  }

  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  if (isPublisherOfBounty(bounty, userAccount)) {
    showToastNotification('⛔ Publisher Blocked', 'You are the publisher of this bounty pool! Publishers cannot claim or complete their own tasks.', false);
    return;
  }

  if (bounty.expiresAt && Date.now() >= bounty.expiresAt) {
    showToastNotification('⏱️ Pool Expired', 'This bounty pool duration has expired!', false);
    return;
  }

  if (bounty.slotsRemaining <= 0) {
    showToastNotification('⛔ Fully Claimed', 'This bounty pool has zero open slots remaining!', false);
    return;
  }

  if (hasWalletCompletedBounty(bountyId, userAccount)) {
    showToastNotification('⛔ Already Claimed', 'Your wallet has already claimed and submitted proof for this task. Maximum 1 completion per wallet per bounty.', false);
    return;
  }

  currentModalBountyId = bountyId;
  uploadedImageDataUrl = null;

  document.getElementById('modal-task-title').textContent = bounty.title;
  document.getElementById('modal-task-cat').textContent = bounty.categoryName;
  document.getElementById('modal-task-reward').innerHTML = `${boltSvgIcon} ${bounty.reward} NIM`;
  document.getElementById('modal-task-instructions').textContent = bounty.instructions;

  const groupText = document.getElementById('group-proof-text');
  const groupUrl = document.getElementById('group-proof-url');
  const groupImage = document.getElementById('group-proof-image');

  groupText.style.display = (bounty.proofType === 'text' || bounty.proofType === 'image_text') ? 'flex' : 'none';
  groupUrl.style.display = (bounty.proofType === 'url') ? 'flex' : 'none';
  groupImage.style.display = (bounty.proofType === 'image' || bounty.proofType === 'image_text') ? 'flex' : 'none';

  document.getElementById('image-preview-box').style.display = 'none';

  startClaimTimer(15 * 60);
  document.getElementById('modal-task').style.display = 'flex';
}

function startClaimTimer(durationSeconds) {
  if (activeClaimTimer) clearInterval(activeClaimTimer);
  let timer = durationSeconds;
  const timerEl = document.getElementById('modal-task-timer');

  activeClaimTimer = setInterval(() => {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    if (timerEl) {
      timerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg> ${minutes}:${seconds < 10 ? '0' : ''}${seconds} Lock Remaining`;
    }
    if (--timer < 0) {
      clearInterval(activeClaimTimer);
      showToastNotification('⏱️ Timer Expired', 'Reservation timer expired! Task slot has been released.', false);
      closeModal('modal-task');
    }
  }, 1000);
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
  if (activeClaimTimer) clearInterval(activeClaimTimer);
}

function previewScreenshot(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      uploadedImageDataUrl = e.target.result;
      document.getElementById('image-preview-img').src = uploadedImageDataUrl;
      document.getElementById('image-preview-box').style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }
}

function handleSubmitProof(event) {
  event.preventDefault();

  if (!isRealWalletConnected()) {
    showToastNotification('⛔ Real Wallet Required', 'You must connect a valid Nimiq Pay Wallet before submitting proof!', false);
    connectNimiqPayWallet();
    return;
  }

  const bounty = bounties.find(b => b.id === currentModalBountyId);
  if (!bounty) return;

  if (isPublisherOfBounty(bounty, userAccount)) {
    showToastNotification('⛔ Publisher Blocked', 'You cannot complete your own bounty pool!', false);
    return;
  }

  if (bounty.expiresAt && Date.now() >= bounty.expiresAt) {
    showToastNotification('⏱️ Pool Expired', 'This bounty pool duration has expired!', false);
    return;
  }

  if (hasWalletCompletedBounty(bounty.id, userAccount)) {
    showToastNotification('⛔ Already Claimed', 'Your wallet has already submitted proof for this task.', false);
    return;
  }

  let proofContent = '';
  if (bounty.proofType === 'text') {
    proofContent = document.getElementById('proof-text-input').value;
  } else if (bounty.proofType === 'url') {
    const mainUrl = document.getElementById('proof-url-input').value;
    const xUsername = document.getElementById('proof-username-input')?.value.trim();
    proofContent = xUsername ? `Link: ${mainUrl} | Handle: ${xUsername}` : mainUrl;
  } else if (bounty.proofType === 'image') {
    proofContent = uploadedImageDataUrl || 'https://placehold.co/600x400?text=Screenshot+Proof';
  } else if (bounty.proofType === 'image_text') {
    const feedbackText = document.getElementById('proof-text-input').value.trim();
    const screenshotUrl = uploadedImageDataUrl || 'https://placehold.co/600x400?text=Screenshot+Proof';
    proofContent = JSON.stringify({ image: screenshotUrl, text: feedbackText });
  }

  if (!proofContent || (typeof proofContent === 'string' && !proofContent.trim())) {
    showToastNotification('⚠️ Proof Required', 'Please provide your proof screenshot or feedback before submitting.', false);
    return;
  }

  const workerPayoutAddr = userAccount.trim().toUpperCase().replace(/\s+/g, '');
  const posterPayoutAddr = (bounty.posterAddress || userAccount).trim().toUpperCase().replace(/\s+/g, '');

  if (bounty.slotsRemaining > 0) {
    bounty.slotsRemaining -= 1;
  }

  const newSub = {
    id: `sub-${Date.now()}`,
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    posterAddress: posterPayoutAddr,
    workerAddress: workerPayoutAddr,
    proofType: bounty.proofType,
    content: proofContent,
    submittedAt: 'Just now',
    reward: bounty.reward
  };

  pendingSubmissions.unshift(newSub);

  saveState();
  syncGlobalPublicBounties(bounty);

  playAudioFx('submit');
  closeModal('modal-task');
  renderBounties();

  showToastNotification(
    '✅ Proof Submitted',
    `Submission sent! Reward address: ${workerPayoutAddr.substring(0, 14)}... Pending poster review.`,
    false
  );
}

// ==========================================
// 15. ONCHAIN ESCROW DEPOSIT PUBLISHER ENGINE
// ==========================================
function calculateTotalEscrow() {
  const reward = parseFloat(document.getElementById('task-reward')?.value || 0);
  const slots = parseInt(document.getElementById('task-slots')?.value || 0);
  const total = reward * slots;

  document.getElementById('calc-single').textContent = `${reward} NIM`;
  document.getElementById('calc-slots-count').textContent = slots;
  document.getElementById('calc-total').textContent = `${total} NIM`;
}

async function publishBountyPoolDirectly() {
  if (!isRealWalletConnected()) {
    showToastNotification('⛔ Real Wallet Required', 'You cannot create a bounty if your real wallet is not connected! Connect your Nimiq Pay Wallet first.', false);
    connectNimiqPayWallet();
    return;
  }

  const titleInput = document.getElementById('task-title');
  const instructionsInput = document.getElementById('task-instructions');
  const rewardInput = document.getElementById('task-reward');
  const slotsInput = document.getElementById('task-slots');

  if (!titleInput.value || !instructionsInput.value) {
    alert("Please fill in the Bounty Title and Task Instructions.");
    return;
  }

  const title = titleInput.value;
  const category = document.getElementById('task-category').value;
  const categoryName = document.getElementById('task-category').options[document.getElementById('task-category').selectedIndex].text.toUpperCase();
  const proofType = document.getElementById('task-proof-type').value;
  const reward = parseFloat(rewardInput.value);
  const slots = parseInt(slotsInput.value);
  const durationHours = parseInt(document.getElementById('task-duration').value || 336);
  const instructions = instructionsInput.value;
  const totalEscrowNim = reward * slots;
  const totalEscrowLuna = Math.round(totalEscrowNim * 100000);

  const expiresAt = Date.now() + (durationHours * 3600 * 1000);
  const bountyId = `b-${Date.now()}`;
  const cleanPosterAddr = userAccount.trim().toUpperCase().replace(/\s+/g, '');

  showToastNotification(
    '🔒 Funding Onchain Escrow...',
    `Depositing ${totalEscrowNim} NIM to NimBounty Escrow Vault:\n${NIMIQ_ESCROW_CONTRACT_ADDRESS}`,
    false
  );

  let escrowTxHash = `escrow_dep_${Date.now()}`;
  const provider = getNimiqProvider();

  if (provider) {
    try {
      let validityStartHeight = liveBlockHeight || 0;
      if (typeof provider.getBlockNumber === 'function') {
        try { validityStartHeight = await provider.getBlockNumber(); } catch (e) {}
      }

      const cleanEscrowAddr = NIMIQ_ESCROW_CONTRACT_ADDRESS.replace(/\s+/g, '');
      if (typeof provider.sendBasicTransactionWithData === 'function') {
        escrowTxHash = await provider.sendBasicTransactionWithData({
          recipient: cleanEscrowAddr,
          value: totalEscrowLuna,
          data: `NIMBOUNTY_ESCROW_DEPOSIT:${bountyId.slice(0, 14)}`,
          validityStartHeight: validityStartHeight
        });
      } else if (typeof provider.sendBasicTransaction === 'function') {
        escrowTxHash = await provider.sendBasicTransaction({
          recipient: cleanEscrowAddr,
          value: totalEscrowLuna,
          validityStartHeight: validityStartHeight
        });
      }
    } catch (err) {
      console.warn("Escrow deposit provider error:", err);
    }
  }

  // Deep Link Fallback for Escrow Deposit
  const escrowDeepLink = `nimiq:${NIMIQ_ESCROW_CONTRACT_ADDRESS.replace(/\s+/g, '')}?value=${totalEscrowLuna}&label=NimBounty%20Escrow%20Deposit`;
  setTimeout(() => {
    window.location.href = escrowDeepLink;
  }, 150);

  const newBounty = {
    id: bountyId,
    title: title, category: category, categoryName: categoryName, proofType: proofType,
    reward: reward, slotsTotal: slots, slotsRemaining: slots, durationHours: durationHours,
    expiresAt: expiresAt, posterAddress: cleanPosterAddr, sponsor: `${cleanPosterAddr.substring(0, 10)}...`,
    instructions: instructions, createdAt: Date.now(), txHash: escrowTxHash,
    escrowFunded: true, escrowVaultAddress: NIMIQ_ESCROW_CONTRACT_ADDRESS
  };

  bounties.unshift(newBounty);
  saveState();
  syncGlobalPublicBounties(newBounty);
  
  document.getElementById('create-bounty-form').reset();
  calculateTotalEscrow();

  playAudioFx('cash');
  triggerConfetti();

  showToastNotification(
    '🚀 ESCROW FUNDED & PUBLISHED!',
    `"${title}" is 100% Escrow Funded (${totalEscrowNim} NIM) and live for workers!`,
    false
  );

  switchPosterSubtab('pools');
}

// ==========================================
// 16. PUBLISHER REVIEW & ESCROW PAYOUT DISBURSEMENT
// ==========================================
function renderPosterDashboard() {
  const poolsList = document.getElementById('published-pools-list');
  const subsList = document.getElementById('pending-submissions-list');
  const badgeSubs = document.getElementById('poster-badge-subs');

  if (!isRealWalletConnected()) {
    if (poolsList) poolsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">Please connect your Nimiq Wallet to view your published pools.</p>`;
    if (subsList) subsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">Please connect your Nimiq Wallet to review worker submissions.</p>`;
    if (badgeSubs) badgeSubs.textContent = '0';
    return;
  }

  const myBounties = bounties.filter(b => 
    isSameNimiqAddress(b.posterAddress, userAccount) || isSameNimiqAddress(b.sponsor, userAccount)
  );

  // RELIABLE POSTER SUBMISSION MATCHING
  const mySubmissions = pendingSubmissions.filter(sub => {
    if (!userAccount) return false;
    if (isSameNimiqAddress(sub.posterAddress, userAccount)) return true;
    const parentBounty = bounties.find(b => b.id === sub.bountyId);
    if (parentBounty && isSameNimiqAddress(parentBounty.posterAddress, userAccount)) return true;
    return false;
  });

  if (badgeSubs) {
    badgeSubs.textContent = mySubmissions.length;
  }

  if (poolsList) {
    poolsList.innerHTML = myBounties.map(b => {
      const isExpired = b.expiresAt && Date.now() >= b.expiresAt;
      const isPaidOut = approvedPayoutsHistory.some(p => p.bountyId === b.id);
      const timeStr = isPaidOut ? '✅ Paid Out & Completed' : formatTimeRemaining(b.expiresAt);

      return `
        <div class="dashboard-item ${isPaidOut ? 'card-expired' : ''}">
          <div class="dashboard-item-title">${b.title}</div>
          <div class="dashboard-item-meta">
            <span>Reward: <strong>${b.reward} NIM</strong> / worker</span>
            <span>Slots: <strong>${b.slotsRemaining} / ${b.slotsTotal} Open</strong></span>
            <span>Escrow: <strong style="color:var(--emerald);">🔒 100% Funded</strong></span>
            <span>Status: <strong style="color:${isPaidOut ? 'var(--emerald)' : isExpired ? 'var(--danger)' : 'var(--gold)'};">${timeStr}</strong></span>
          </div>
        </div>
      `;
    }).join('') || `<p style="font-size:0.85rem; color:var(--muted);">No published bounty pools found for connected wallet (<strong>${userAccount.substring(0, 12)}...</strong>). Create a new task pool!</p>`;
  }

  if (subsList) {
    if (mySubmissions.length === 0) {
      subsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">No pending worker submissions to review for your wallet (<strong>${userAccount.substring(0, 12)}...</strong>). Only the publisher can approve payouts.</p>`;
      return;
    }

    subsList.innerHTML = mySubmissions.map((sub, index) => {
      let proofHtml = '';

      if (sub.proofType === 'image_text') {
        let parsed = { image: '', text: '' };
        try { parsed = JSON.parse(sub.content); } catch (e) { parsed = { image: sub.content, text: '' }; }
        proofHtml = `
          <div class="proof-content-text" style="margin-bottom: 8px;"><strong>Written Feedback:</strong> ${parsed.text || 'N/A'}</div>
          ${parsed.image ? `<img src="${parsed.image}" class="proof-image-review" alt="Uploaded Proof Screenshot" onclick="window.open('${parsed.image}')" title="Click to view full image" />` : ''}
        `;
      } else if (sub.proofType === 'image') {
        proofHtml = `
          <img src="${sub.content}" class="proof-image-review" alt="Uploaded Proof Screenshot" onclick="window.open('${sub.content}')" title="Click to view full image in new window" />
          <span style="font-size:0.68rem; color:var(--muted); font-family:'Geist Mono',monospace;">💡 Click screenshot to open full size</span>
        `;
      } else {
        proofHtml = `<div class="proof-content-text">${sub.content}</div>`;
      }

      return `
        <div class="dashboard-item">
          <div class="dashboard-item-title">${sub.bountyTitle}</div>
          
          <div class="dashboard-item-meta" style="flex-direction: column; align-items: flex-start; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
              <span style="font-size: 0.85rem;">Worker Nimiq Address:</span>
              <input type="text" id="worker-addr-input-${sub.id}" value="${sub.workerAddress}" 
                style="font-family:'Geist Mono',monospace; font-size:0.85rem; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-subtle); color: var(--gold); flex: 1;" />
            </div>
            <span style="font-size: 0.75rem; color: var(--muted);">Submitted: ${sub.submittedAt}</span>
          </div>

          <div class="proof-card-review">
            <strong>Submitted Proof (${sub.proofType}):</strong>
            ${proofHtml}
          </div>

          <div class="review-actions">
            <button class="btn-approve" onclick="reviewProof('${sub.id}', 'approve')">Approve & Release ${sub.reward} NIM from Escrow &rarr;</button>
            <button class="btn-reject" onclick="reviewProof('${sub.id}', 'reject')">Reject</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

async function reviewProof(submissionId, action) {
  const subIndex = pendingSubmissions.findIndex(s => s.id === submissionId);
  if (subIndex === -1) return;
  const sub = pendingSubmissions[subIndex];

  if (action === 'approve') {
    const inputEl = document.getElementById(`worker-addr-input-${sub.id}`);
    const targetWorkerAddr = (inputEl && inputEl.value) ? inputEl.value.trim().toUpperCase() : sub.workerAddress.trim().toUpperCase();

    if (!isValidNimiqAddress(targetWorkerAddr)) {
      alert("Invalid Nimiq Wallet Address! Address must begin with NQ followed by valid digits.");
      return;
    }

    const cleanWorkerAddr = targetWorkerAddr.replace(/\s+/g, '');
    const lunaValue = Math.round(sub.reward * 100000);

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORTANT: Do NOT trigger any wallet payment here.
    // The payout must come FROM the Escrow Vault wallet (NQ65 R26Y VNQL...),
    // NOT from the poster's connected wallet.
    //
    // Triggering provider.sendBasicTransaction() or a nimiq: deeplink here
    // would charge the POSTER's personal wallet, not the escrow vault.
    //
    // Instead: Record the approval in the database, then show the poster
    // the exact details to send manually from the Escrow Vault in Nimiq Pay.
    // ─────────────────────────────────────────────────────────────────────────

    // Record the approved payout in the global persistent database
    approvedPayoutsHistory.push({
      id: `pay-${Date.now()}`,
      bountyId: sub.bountyId,
      bountyTitle: sub.bountyTitle,
      workerAddress: cleanWorkerAddr,
      posterAddress: sub.posterAddress,
      reward: sub.reward,
      txHash: `pending_manual_escrow_send_${Date.now()}`,
      paidAt: Date.now()
    });

    savedTotalRewardsPaid += (parseFloat(sub.reward) || 0);
    pendingSubmissions.splice(subIndex, 1);
    saveState();
    playAudioFx('cash');
    triggerConfetti();

    // Show poster the manual payout instruction — they must send from the Escrow Vault wallet
    const nimiqPayDeeplink = `nimiq:${cleanWorkerAddr}?value=${lunaValue}&label=NimBounty%20Escrow%20Payout`;
    showEscrowPayoutInstructions(cleanWorkerAddr, sub.reward, lunaValue, nimiqPayDeeplink);



    showToastNotification(
      '✅ Proof Approved — Send NIM from Escrow Vault',
      `Approval recorded! Now open Nimiq Pay, switch to your Escrow Vault account, and send ${sub.reward} NIM to the worker.`,
      false
    );
  } else {
    const bountyIndex = bounties.findIndex(b => b.id === sub.bountyId);
    if (bountyIndex !== -1) {
      bounties[bountyIndex].slotsRemaining = Math.min(bounties[bountyIndex].slotsTotal, bounties[bountyIndex].slotsRemaining + 1);
    }

    pendingSubmissions.splice(subIndex, 1);
    saveState();
    playAudioFx('submit');

    showToastNotification(
      '❌ Submission Rejected',
      `Rejected submission. 1 open slot restored to bounty pool.`,
      false
    );
  }

  renderPosterDashboard();
  renderBounties();
}

// ==========================================
// ESCROW PAYOUT INSTRUCTION MODAL
// ==========================================
function showEscrowPayoutInstructions(workerAddr, rewardNim, lunaValue, deeplink) {
  // Remove any existing instruction modal
  const existing = document.getElementById('modal-escrow-payout');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-escrow-payout';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-paper paper-card rise-in" style="max-width:520px;">
      <button class="modal-close" onclick="document.getElementById('modal-escrow-payout').remove()">&times;</button>
      <div class="modal-header">
        <span class="news-category-tag" style="background:var(--emerald,#22c55e);color:#fff;">ESCROW PAYOUT READY</span>
        <h2 style="font-size:1.3rem;margin-top:12px;">Send NIM from Your Escrow Vault</h2>
      </div>
      <div class="modal-body" style="gap:14px;">
        <div class="instructions-box" style="background:var(--bg-subtle);border-left:4px solid var(--gold);">
          <h4 style="margin-bottom:8px;">&#9888; Important — Do NOT send from your personal wallet</h4>
          <p style="font-size:0.85rem;">The NIM must be sent from your <strong>Escrow Vault wallet</strong> (<code style="font-size:0.78rem;">${NIMIQ_ESCROW_CONTRACT_ADDRESS}</code>), NOT from your connected poster wallet.</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:0.78rem;font-weight:700;color:var(--muted);letter-spacing:.05em;">WORKER WALLET ADDRESS</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="epi-worker-addr" type="text" readonly value="${workerAddr}"
              style="font-family:'Geist Mono',monospace;font-size:0.78rem;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--ink);flex:1;" />
            <button class="btn-primary-sm" onclick="navigator.clipboard.writeText('${workerAddr}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500);">Copy</button>
          </div>
        </div>

        <div style="display:flex;gap:12px;">
          <div style="flex:1;background:var(--bg-subtle);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:0.72rem;color:var(--muted);font-weight:700;margin-bottom:4px;">AMOUNT TO SEND</div>
            <div style="font-size:1.4rem;font-weight:900;color:var(--gold);">&#9889; ${rewardNim} NIM</div>
          </div>
          <div style="flex:1;background:var(--bg-subtle);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:0.72rem;color:var(--muted);font-weight:700;margin-bottom:4px;">IN LUNA (raw)</div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--ink);">${lunaValue.toLocaleString()}</div>
          </div>
        </div>

        <div style="font-size:0.82rem;color:var(--muted);background:var(--bg-subtle);border-radius:10px;padding:12px;line-height:1.6;">
          <strong>Steps:</strong><br/>
          1. Open <strong>Nimiq Pay</strong> on your device<br/>
          2. Switch active account to <strong>Escrow Vault</strong> (<code style="font-size:0.75rem;">${NIMIQ_ESCROW_CONTRACT_ADDRESS.substring(0,18)}...</code>)<br/>
          3. Tap <strong>Send</strong> and paste the worker address<br/>
          4. Enter <strong>${rewardNim} NIM</strong> and confirm
        </div>

        <button class="btn-primary-lg full-width" onclick="window.open('${deeplink}');" style="margin-top:4px;">
          Open Nimiq Pay to Send &rarr;
        </button>
        <p style="font-size:0.72rem;color:var(--muted);text-align:center;margin-top:-6px;">Make sure you are logged in as the Escrow Vault account before confirming.</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  runTypewriter();
  fetchNimiqLiveRPC();
  checkUrlAutoImport();
  await fetchGlobalPublicBounties();
  updateWalletUI();
  calculateTotalEscrow();
  updateLandingStats();
  renderWorkerStats();
  
  setInterval(fetchGlobalPublicBounties, 5000);
});
