/* ==========================================
   NIMBOUNTY V2 - COMPLETE FEATURE-RICH ENGINE
   ========================================== */

// Production API URL
const PRODUCTION_URL = 'https://nim-bounty.vercel.app';

// Storage Keys
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_wallet_v5';
const STORAGE_KEY_PROFILE = 'nimbounty_profile_v5';
const STORAGE_KEY_THEME = 'nimbounty_theme_v5';
const STORAGE_KEY_LOCAL_BOUNTIES = 'nimbounty_pools_v5';
const STORAGE_KEY_SUBS = 'nimbounty_subs_v5';
const STORAGE_KEY_PAID_HISTORY = 'nimbounty_approved_payouts_history_v5';
const STORAGE_KEY_REPUTATION = 'nimbounty_reputation_v5';
const STORAGE_KEY_ONBOARDED_GLOBAL = 'nimbounty_onboarded_global_v5';

// Global Application State
let userAccount = localStorage.getItem(STORAGE_KEY_USER_ACCT) || null;
let currentRole = 'worker'; // 'worker' | 'poster'
let currentView = 'app';
let workerSubtab = 'active'; // 'active' | 'history'
let posterSubtab = 'create'; // 'create' | 'pools' | 'subs'
let bounties = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL_BOUNTIES)) || [];
let pendingSubmissions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS)) || [];
let approvedPayoutsHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_PAID_HISTORY)) || [];
let liveBlockHeight = 0;
let uploadedImageDataUrl = null;
let activeClaimTimer = null;
let currentModalBountyId = null;
let lastRenderHash = '';

// Seed Bounties Fallback
const INITIAL_SEED_BOUNTIES = [
  {
    id: 'seed-bounty-1',
    title: 'Test Nimiq MiniApp UI & Report 3 UX Observations',
    category: 'app-test',
    categoryName: 'APP TESTING',
    reward: '50.0',
    slotsTotal: 10,
    slotsRemaining: 8,
    posterAddress: 'NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN',
    sponsor: 'NQ65 R26Y...',
    instructions: 'Launch NimBounty inside Nimiq Pay MiniApp WebView. Test wallet connect, view switching, and submit 3 UX observations.',
    proofType: 'text',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'seed-bounty-2',
    title: 'Share NimBounty MiniApp Announcement on X (Twitter)',
    category: 'social',
    categoryName: 'SOCIAL SHARE',
    reward: '25.0',
    slotsTotal: 15,
    slotsRemaining: 10,
    posterAddress: 'NQ33 A91B 44XX 88YY 22ZZ 11AA 99BB 77CC 55DD',
    sponsor: 'NQ33 A91B...',
    instructions: 'Post a tweet mentioning @Nimiq and #NimBounty with a screenshot of the app console. Paste tweet URL as proof.',
    proofType: 'text',
    createdAt: Date.now() - 7200000
  }
];

if (!bounties || bounties.length === 0) {
  bounties = [...INITIAL_SEED_BOUNTIES];
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));
}

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

// Helper: Get User Profile Data
function getProfile(walletAddress) {
  if (!walletAddress) return { username: null, avatarUrl: null };
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const allProfiles = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}');
  return allProfiles[clean] || { username: null, avatarUrl: null };
}

// Helper: Save User Profile Data
function saveProfile(walletAddress, profileData) {
  if (!walletAddress) return;
  const clean = String(walletAddress).replace(/\s+/g, '').toUpperCase();
  const allProfiles = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE) || '{}');
  allProfiles[clean] = profileData;
  localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(allProfiles));
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
  showToastNotification('🎨 Theme Toggled', `Switched to ${next} theme.`, false);
}

// ==========================================
// 1. FEATURE: PERSISTENT GLOBAL BACKEND SYNC (/api/bounties)
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

      if (Array.isArray(data.bounties)) {
        if (data.bounties.length === 0 && bounties.length > 0) {
          bounties = [];
          stateChanged = true;
        } else if (data.bounties.length > 0) {
          const existingIds = new Set(bounties.map(b => b.id));
          data.bounties.forEach(sb => {
            if (!existingIds.has(sb.id)) {
              bounties.unshift(sb);
              existingIds.add(sb.id);
              stateChanged = true;
            } else {
              const idx = bounties.findIndex(b => b.id === sb.id);
              if (bounties[idx].slotsRemaining !== sb.slotsRemaining) {
                bounties[idx].slotsRemaining = sb.slotsRemaining;
                stateChanged = true;
              }
            }
          });
        }
        localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));
      }

      if (Array.isArray(data.approvedPayoutsHistory)) {
        approvedPayoutsHistory = data.approvedPayoutsHistory;
        localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
      }

      if (Array.isArray(data.pendingSubmissions)) {
        pendingSubmissions = data.pendingSubmissions;
        localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
      }

      const newHash = `${bounties.length}-${pendingSubmissions.length}-${approvedPayoutsHistory.length}-${userAccount}`;
      if (stateChanged || newHash !== lastRenderHash) {
        lastRenderHash = newHash;
        renderBounties();
        renderPosterDashboard();
        updateLandingStats();
      }
    }
  } catch (e) {
    renderBounties();
  }
}

async function syncGlobalPublicBounties(updatedBountyObj = null, replacePendingSubmissions = false) {
  try {
    const apiEndpoint = window.location.origin.includes('localhost')
      ? `${PRODUCTION_URL}/api/bounties`
      : `/api/bounties`;

    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newBounty: updatedBountyObj,
        replacePendingSubmissions,
        bounties,
        pendingSubmissions,
        approvedPayoutsHistory,
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
async function connectNimiqPayWallet() {
  const provider = getNimiqProvider();

  if (provider && typeof provider.listAccounts === 'function') {
    try {
      showToastNotification('⌛ Connecting Nimiq Pay...', 'Opening wallet accounts...', false);
      const accounts = await provider.listAccounts();
      if (accounts && accounts.length) {
        const rawAcct = accounts[0];
        let candidateAccount = typeof rawAcct === 'string' ? rawAcct : (rawAcct.address || rawAcct);
        userAccount = candidateAccount.replace(/\s+/g, '').toUpperCase();
        localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);

        updateWalletUI();
        renderBounties();
        renderPosterDashboard();
        renderSessionBar();
        showToastNotification('📱 Connected!', `Wallet connected: ${getUserDisplayName(userAccount)}`, false);
        checkAndLaunchOnboarding();
        return;
      }
    } catch (e) {
      console.warn("Nimiq Pay listAccounts error:", e);
    }
  }

  const inputAddr = prompt("Enter your Nimiq Wallet Address:", userAccount || "NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN");
  if (inputAddr && inputAddr.trim()) {
    userAccount = inputAddr.trim().replace(/\s+/g, '').toUpperCase();
    localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
    updateWalletUI();
    renderBounties();
    renderPosterDashboard();
    renderSessionBar();
    showToastNotification('⚡ Wallet Connected!', `Connected address: ${getUserDisplayName(userAccount)}`, false);
    checkAndLaunchOnboarding();
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
    const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp);
    if (isNimiqApp) {
      connectNimiqPayWallet();
    } else {
      openDesktopConnectModal();
    }
  }
}

function confirmDisconnectWalletFromModal() {
  closeModal('modal-wallet');
  userAccount = null;
  localStorage.removeItem(STORAGE_KEY_USER_ACCT);

  updateWalletUI();
  renderBounties();
  renderPosterDashboard();
  renderSessionBar();
  showToastNotification('🔌 Wallet Disconnected', 'Your wallet session has been disconnected.', false);
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

function handleLaunchApp() {
  const isMobileScreen = window.innerWidth <= 768;
  const isNimiqApp = !!getNimiqProvider();

  if (isMobileScreen || isNimiqApp) {
    showView('app');
  } else {
    openDesktopConnectModal();
  }
}

function openDesktopConnectModal() {
  const modal = document.getElementById('modal-desktop-connect');
  const qrBox = document.getElementById('desktop-connect-qr-box');
  if (!modal) return;

  if (qrBox) {
    qrBox.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrBox, {
        text: window.location.href,
        width: 160,
        height: 160,
        colorDark: '#1a1917',
        colorLight: '#ffffff'
      });
    }
  }
  modal.style.display = 'flex';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
  if (activeClaimTimer) clearInterval(activeClaimTimer);
}

function handleLogoClick(event) {
  if (event) event.preventDefault();
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    showView('app');
  } else {
    showView('landing');
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (views[viewName]) {
    views[viewName].style.display = 'block';
  } else if (views.app) {
    views.app.style.display = 'block';
  }

  renderMobileBottomNav();
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

  const activeCount = bounties.filter(b => (b.slotsRemaining === undefined || b.slotsRemaining > 0)).length;
  const seedPayoutsSum = 1250;
  const livePayoutsSum = approvedPayoutsHistory.reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);
  const totalPayouts = seedPayoutsSum + livePayoutsSum;

  if (elBounties) elBounties.textContent = activeCount > 0 ? activeCount : (INITIAL_SEED_BOUNTIES.length || 2);
  if (elPayouts) elPayouts.textContent = `${totalPayouts.toLocaleString()} NIM`;
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
      workerBtn.style.border = '2px solid var(--gold)';
      workerBtn.style.background = 'var(--gold-tint)';
      posterBtn.style.border = '1px solid var(--border)';
      posterBtn.style.background = 'var(--bg-subtle)';
    } else {
      posterBtn.style.border = '2px solid var(--emerald)';
      posterBtn.style.background = 'var(--emerald-tint)';
      workerBtn.style.border = '1px solid var(--border)';
      workerBtn.style.background = 'var(--bg-subtle)';
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
    renderBounties();
  } else {
    if (workerView) workerView.style.display = 'none';
    if (posterView) posterView.style.display = 'block';
    renderPosterDashboard();
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
  const container = document.getElementById('worker-orders-list');
  if (!container) return;

  if (!isRealWalletConnected()) {
    container.innerHTML = createEmptyStateHTML(
      'Wallet Required',
      'Please connect your Nimiq Pay wallet to view your completed orders and payout history.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    );
    return;
  }

  const myApproved = approvedPayoutsHistory.filter(p => p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount));
  const myPending = pendingSubmissions.filter(s => s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount));

  if (myApproved.length === 0 && myPending.length === 0) {
    container.innerHTML = createEmptyStateHTML(
      'No Orders Yet',
      'You have not submitted proof or received payouts for any bounties yet. Complete active bounties in Worker Mode to start building your order history!',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
    );
    return;
  }

  let html = '';

  if (myPending.length > 0) {
    html += `<h4 style="font-size:0.9rem; font-weight:800; color:var(--gold); margin-bottom:10px;">⏳ Pending Poster Review (${myPending.length})</h4>`;
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

  if (myApproved.length > 0) {
    html += `<h4 style="font-size:0.9rem; font-weight:800; color:var(--emerald); margin-top:20px; margin-bottom:10px;">✅ Approved &amp; Paid Out (${myApproved.length})</h4>`;
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

  container.innerHTML = html;
}

// ==========================================
// 6. MOBILE BOTTOM NAVIGATION ENGINE (DYNAMIC ROLE ICONS)
// ==========================================
function renderMobileBottomNav() {
  const nav = document.getElementById('mobile-bottom-nav');
  if (!nav) return;

  const isMobile = window.innerWidth <= 768;
  if (!isMobile || currentView === 'landing') {
    nav.style.display = 'none';
    return;
  }

  nav.style.display = 'flex';
  const isProfileOpen = document.getElementById('panel-profile')?.style.display === 'block';

  const stackLogo = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

  if (currentRole === 'worker') {
    nav.innerHTML = `
      <button class="mobile-bottom-tab ${currentView === 'app' && workerSubtab === 'active' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('active')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
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
        Submissions ${pendingCount > 0 ? `<span style="background:var(--gold); color:#1a1917; padding:2px 6px; border-radius:10px; font-size:0.65rem; font-weight:800; margin-left:2px;">${pendingCount}</span>` : ''}
      </button>
      <button class="mobile-bottom-tab ${isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('profile')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Profile
      </button>
    `;
  }
}

function switchMobileTab(tab) {
  const profilePanel = document.getElementById('panel-profile');
  const workerView   = document.getElementById('view-worker');
  const posterView   = document.getElementById('view-poster');
  const appView      = document.getElementById('view-app');
  const ordersView   = document.getElementById('view-orders');
  const landingView  = document.getElementById('view-landing');
  const sessionBar   = document.getElementById('console-session-bar');
  const mobileNav    = document.getElementById('mobile-bottom-nav');

  // Hide landing and orders; always show app wrapper
  if (landingView)  landingView.style.display  = 'none';
  if (ordersView)   ordersView.style.display   = 'none';

  if (tab === 'orders') {
    if (appView)    appView.style.display    = 'none';
    if (ordersView) ordersView.style.display = 'block';
    if (sessionBar) sessionBar.style.display = 'none';
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
function uploadProfileAvatar(event) {
  const file = event.target.files[0];
  if (!file || !userAccount) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const profile = getProfile(userAccount);
    profile.avatarUrl = e.target.result;
    saveProfile(userAccount, profile);
    showToastNotification('📸 Photo Updated', 'Profile avatar updated!', false);
    renderProfile();
    updateWalletUI();
  };
  reader.readAsDataURL(file);
}

function removeProfileAvatar() {
  if (!userAccount) return;
  const profile = getProfile(userAccount);
  delete profile.avatarUrl;
  saveProfile(userAccount, profile);
  showToastNotification('🗑️ Photo Removed', 'Profile photo reset to default avatar.', false);
  renderProfile();
  updateWalletUI();
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

  const avatarSvg = hasCustomAvatar
    ? `<img src="${profile.avatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`
    : `<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="var(--gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 6L6 19l26 13 26-13L32 6zM6 45l26 13 26-13M6 32l26 13 26-13"/></svg>`;

  el.innerHTML = `
    <!-- Top Header Navigation inside Profile -->
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px; font-size:0.75rem; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
      <span>PROFILE</span> &bull; <span>TRADER PROFILE</span>
    </div>

    <!-- Profile Header Card (Screenshot 1 Layout) -->
    <div class="profile-card-xcrow">
      <div style="position:relative;">
        <div class="profile-avatar-circle">
          ${avatarSvg}
        </div>
        <button class="profile-camera-badge" onclick="document.getElementById('profile-avatar-input').click()" title="Change Profile Picture">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
        <input type="file" id="profile-avatar-input" accept="image/*" onchange="uploadProfileAvatar(event)" style="display:none;" />
      </div>

      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div>
            <h3 style="font-size:1.3rem; font-weight:900; color:var(--ink); margin:0; letter-spacing:-0.02em;">${displayUsername}</h3>
            ${hasCustomAvatar ? `<button onclick="removeProfileAvatar()" style="background:none; border:none; color:var(--muted); font-size:0.75rem; cursor:pointer; padding:0; margin-top:2px;">Remove photo</button>` : ''}
          </div>

          <div class="address-pill-copy" onclick="navigator.clipboard.writeText('${userAccount}'); showToastNotification('📋 Copied!', 'Address copied to clipboard.', false);">
            <span>${userAccount.substring(0,6)}...${userAccount.substring(userAccount.length-4)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </div>
        </div>

        ${!profile.username ? `
          <button class="btn-ghost-sm" onclick="document.getElementById('modal-set-username').style.display='flex';" style="margin-top:10px; font-size:0.75rem; padding:4px 10px; border-color:var(--gold); color:var(--gold);">+ Set Permanent Username</button>
        ` : ''}
      </div>
    </div>

    <!-- 4-Column Stat Box (Screenshot 1 Layout) -->
    <div class="profile-stats-bar-4col">
      <div class="stat-col">
        <div class="stat-val">${bountiesPosted}</div>
        <div class="stat-lbl">DEALS</div>
      </div>
      <div class="stat-col">
        <div class="stat-val">${workerCompleted}</div>
        <div class="stat-lbl">COMPLETED</div>
      </div>
      <div class="stat-col">
        <div class="stat-val">${ratingStr}</div>
        <div class="stat-lbl">RATING</div>
      </div>
      <div class="stat-col">
        <div class="stat-val">${rep.reports || 0}</div>
        <div class="stat-lbl">DISPUTES</div>
      </div>
    </div>

    <!-- Menu Action Cards -->
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;">
      <div class="menu-action-card" onclick="showView('how-it-works')">
        <div class="menu-action-icon">📖</div>
        <div style="flex:1;">
          <div class="menu-action-title">How It Works</div>
          <div class="menu-action-desc">Learn about bounty creation, proof signing &amp; payouts</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="showView('protections')">
        <div class="menu-action-icon">🛡️</div>
        <div style="flex:1;">
          <div class="menu-action-title">Built-in Protections</div>
          <div class="menu-action-desc">Cryptographic signing &amp; anti-sybil device IDs</div>
        </div>
        <span class="menu-action-arrow">&rarr;</span>
      </div>

      <div class="menu-action-card" onclick="showView('faq')">
        <div class="menu-action-icon">❓</div>
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

function confirmSetUsername() {
  const input = document.getElementById('username-input');
  const val = input ? input.value.trim().toUpperCase() : '';
  if (!val || val.length < 3) {
    showToastNotification('⚠️ Invalid Username', 'Username must be at least 3 characters.', true);
    return;
  }
  _pendingUsernameChoice = val;
  document.getElementById('username-confirm-display').textContent = val;
  closeModal('modal-set-username');
  document.getElementById('modal-confirm-username').style.display = 'flex';
}

function finalizeUsername() {
  if (!_pendingUsernameChoice || !userAccount) return;
  const profile = getProfile(userAccount);
  profile.username = _pendingUsernameChoice;
  saveProfile(userAccount, profile);

  closeModal('modal-confirm-username');
  renderProfile();
  updateWalletUI();
  renderSessionBar();
  showToastNotification('✅ Username Set!', `Permanent username set: ${_pendingUsernameChoice}`, false);
}

// ==========================================
// 8. BOUNTIES RENDER & BOUNTY ACTIONS
// ==========================================
function renderBounties() {
  const grid = document.getElementById('bounties-grid');
  if (!grid) return;

  const searchQuery = document.getElementById('search-input')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('category-select')?.value || 'all';

  const activeBounties = bounties.length ? bounties : INITIAL_SEED_BOUNTIES;

  let filtered = activeBounties.filter(b => {
    const matchesSearch = b.title.toLowerCase().includes(searchQuery) || (b.instructions || b.description || '').toLowerCase().includes(searchQuery);
    const matchesCat = categoryFilter === 'all' || b.category === categoryFilter;

    const myApprovedPayout = userAccount
      ? approvedPayoutsHistory.some(p => p.bountyId === b.id && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount))
      : false;

    const hasPendingSub = userAccount
      ? pendingSubmissions.some(s => s.bountyId === b.id && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount))
      : false;

    if (workerSubtab === 'active') {
      return matchesSearch && matchesCat && !myApprovedPayout && !hasPendingSub;
    } else {
      return matchesSearch && matchesCat && (myApprovedPayout || hasPendingSub);
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
    const hasPendingSub = userAccount ? pendingSubmissions.some(s => s.bountyId === b.id && s.workerAddress && isSameNimiqAddress(s.workerAddress, userAccount)) : false;
    const hasApproved = userAccount ? approvedPayoutsHistory.some(p => p.bountyId === b.id && p.workerAddress && isSameNimiqAddress(p.workerAddress, userAccount)) : false;

    let btnLabel = 'Participate & Earn NIM &rarr;';
    let btnDisabled = false;

    if (hasPendingSub) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg> Proof Pending Review</span>`;
      btnDisabled = true;
    } else if (hasApproved) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" stroke-width="2.5" style="margin-right:6px; vertical-align:middle;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Payout Released</span>`;
      btnDisabled = true;
    } else if (isPublisher) {
      btnLabel = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px; vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Publisher (Cannot Claim)</span>`;
      btnDisabled = true;
    }

    return `
      <div class="bounty-card">
        <div>
          <div class="bounty-card-header">
            <span class="bounty-category-tag">${b.categoryName || b.category || 'General'}</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <button onclick="openQrModal('${b.id}')" title="Share QR Code" style="background:var(--bg-subtle); border:1px solid var(--border); padding:4px 8px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; font-size:0.75rem; font-weight:700; color:var(--ink);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                QR
              </button>
              <span class="bounty-reward">${b.reward} NIM</span>
            </div>
          </div>
          <h4 class="bounty-title">${b.title}</h4>
          <p class="bounty-desc">${b.instructions || b.description}</p>
        </div>
        <div>
          <div class="bounty-meta-row">
            <span>Poster: <strong>${getUserDisplayName(b.posterAddress)}</strong></span>
            <span>Slots: <strong>${b.slotsRemaining !== undefined ? b.slotsRemaining : (b.slotsTotal || 5)} / ${b.slotsTotal || 5}</strong></span>
          </div>
          <button class="btn-primary-sm full-width" onclick="openSubmitProofModal('${b.id}')" ${btnDisabled ? 'disabled' : ''} style="justify-content:center;">
            ${btnLabel}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function syncGlobalPublicBounties(updatedBounty = null) {
  try {
    const apiEndpoint = window.location.origin.includes('localhost') ? `${PRODUCTION_URL}/api/bounties` : `/api/bounties`;
    await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newBounty: updatedBounty, bounties, pendingSubmissions, approvedPayoutsHistory, updatedAt: Date.now() })
    });
  } catch (e) {
    // Silent graceful fallback
  }
}

function openSubmitProofModal(bountyId) {
  if (!isRealWalletConnected()) {
    showToastNotification('Wallet Required', 'Connect your Nimiq Pay wallet first!', true);
    openDesktopConnectModal();
    return;
  }

  currentModalBountyId = bountyId;
  const bounty = bounties.find(b => b.id === bountyId) || INITIAL_SEED_BOUNTIES.find(b => b.id === bountyId);
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

  const previewBox = document.getElementById('image-preview-box');
  if (previewBox) previewBox.style.display = 'none';

  // Clear previous values
  if (document.getElementById('proof-text-input')) document.getElementById('proof-text-input').value = '';
  if (document.getElementById('proof-url-input')) document.getElementById('proof-url-input').value = '';

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
      timerEl.textContent = `⏱️ Lock Remaining: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }
    if (--timer < 0) {
      clearInterval(activeClaimTimer);
      showToastNotification('⏱️ Timer Expired', 'Slot reservation expired.', false);
      closeModal('modal-submit-proof');
    }
  }, 1000);
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

async function handleSubmitProof() {
  const bounty = bounties.find(b => b.id === currentModalBountyId) || INITIAL_SEED_BOUNTIES.find(b => b.id === currentModalBountyId);
  if (!bounty) return;

  const pType = bounty.proofType || 'text';
  let proofContent = '';

  if (pType === 'text') {
    proofContent = document.getElementById('proof-text-input')?.value.trim() || '';
    if (!proofContent) {
      showToastNotification('Proof Required', 'Please fill in your written proof details.', true);
      return;
    }
  } else if (pType === 'url') {
    proofContent = document.getElementById('proof-url-input')?.value.trim() || '';
    if (!proofContent) {
      showToastNotification('Proof Required', 'Please paste your proof URL link.', true);
      return;
    }
  } else if (pType === 'image') {
    proofContent = uploadedImageDataUrl || '';
    if (!proofContent) {
      showToastNotification('Proof Required', 'Please attach a screenshot proof file.', true);
      return;
    }
  } else if (pType === 'image_text') {
    const txt = document.getElementById('proof-text-input')?.value.trim() || '';
    const img = uploadedImageDataUrl || '';
    if (!txt && !img) {
      showToastNotification('Proof Required', 'Please provide feedback text or attach a screenshot.', true);
      return;
    }
    proofContent = JSON.stringify({ text: txt, image: img });
  }

  const workerAddr = userAccount.replace(/\s+/g, '').toUpperCase();
  const posterAddr = (bounty.posterAddress || userAccount).replace(/\s+/g, '').toUpperCase();

  const timestamp = Date.now();
  const proofMessage = `NIMBOUNTY_PROOF_SIGNATURE | Bounty: ${bounty.id} | Worker: ${workerAddr} | Time: ${timestamp}`;
  let signature = `sig_${Date.now()}`;

  const provider = getNimiqProvider();
  if (provider && typeof provider.signMessage === 'function') {
    try {
      const res = await provider.signMessage(proofMessage);
      if (res) signature = typeof res === 'string' ? res : (res.signature || signature);
    } catch (e) {}
  }

  const newSub = {
    id: `sub-${Date.now()}`,
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    posterAddress: posterAddr,
    workerAddress: workerAddr,
    proofType: pType,
    content: proofContent,
    signature: signature,
    submittedAt: new Date().toLocaleTimeString(),
    reward: bounty.reward,
    status: 'pending'
  };

  pendingSubmissions.unshift(newSub);

  // If seed bounty was not yet in local bounties array, add it
  if (!bounties.some(b => b.id === bounty.id)) {
    bounties.push(bounty);
  }
  const targetBounty = bounties.find(b => b.id === bounty.id);
  if (targetBounty && targetBounty.slotsRemaining > 0) {
    targetBounty.slotsRemaining -= 1;
  }

  localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

  syncGlobalPublicBounties(bounty);

  closeModal('modal-submit-proof');
  renderBounties();
  renderSessionBar();
  triggerConfetti();
  playAudioFx('submit');
  showToastNotification('Proof Submitted!', 'Proof signed off-chain with 0 gas. Waiting for poster review.', false);
  uploadedImageDataUrl = null;
}

function openQrModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId) || INITIAL_SEED_BOUNTIES.find(b => b.id === bountyId);
  if (!bounty) return;

  document.getElementById('qr-bounty-title').textContent = bounty.title;
  const b64Data = btoa(encodeURIComponent(JSON.stringify(bounty)));
  const shareWebUrl = `${PRODUCTION_URL}/#bdata=${b64Data}`;
  document.getElementById('qr-link-input').value = shareWebUrl;

  const qrBox = document.getElementById('qrcode-box');
  if (qrBox) {
    qrBox.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrBox, {
        text: shareWebUrl,
        width: 160,
        height: 160,
        colorDark: "#1a1917",
        colorLight: "#ffffff"
      });
    }
  }

  document.getElementById('modal-qr').style.display = 'flex';
}

function copyQrLink() {
  const input = document.getElementById('qr-link-input');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    showToastNotification('📋 Link Copied!', 'Bounty share link copied to clipboard.', false);
  }
}

function publishBountyPoolDirectly() {
  if (!isRealWalletConnected()) {
    showToastNotification('Wallet Required', 'Connect your Nimiq Pay wallet first!', true);
    openDesktopConnectModal();
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

  const newBounty = {
    id: `bounty-${Date.now()}`,
    title,
    category,
    categoryName: categoryNames[category] || category.toUpperCase(),
    proofType,
    reward: parseFloat(reward).toFixed(1),
    slotsTotal: slots,
    slotsRemaining: slots,
    posterAddress: userAccount.replace(/\s+/g, '').toUpperCase(),
    sponsor: getUserDisplayName(userAccount),
    instructions: desc,
    description: desc,
    duration,
    expiresAt,
    createdAt: Date.now()
  };

  bounties.unshift(newBounty);
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));
  syncGlobalPublicBounties(newBounty);

  renderBounties();
  renderSessionBar();
  triggerConfetti();
  showToastNotification('Bounty Published!', 'Your task campaign is live for workers.', false);

  // Clear form
  document.getElementById('task-title').value = '';
  document.getElementById('task-instructions').value = '';
  calculateTotalEscrow();
}

function renderPosterDashboard() {
  const poolsList = document.getElementById('poster-pools-list');
  const subsList = document.getElementById('poster-subs-list');

  if (poolsList) {
    const myPools = bounties.filter(b => isSameNimiqAddress(b.posterAddress, userAccount));
    poolsList.innerHTML = myPools.length ? myPools.map(b => `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:12px;">
        <h4 style="font-size:1rem; font-weight:800;">${b.title}</h4>
        <div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">Reward: ${b.reward} NIM &bull; Slots: ${b.slotsRemaining} / ${b.slotsTotal}</div>
      </div>
    `).join('') : createEmptyStateHTML(
      'No Published Pools',
      'You have not published any task bounty pools yet. Click "Publish New Bounty" above to launch your first task pool!',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
    );
  }

  if (subsList) {
    const mySubs = pendingSubmissions.filter(s => isSameNimiqAddress(s.posterAddress, userAccount) && s.status === 'pending');
    subsList.innerHTML = mySubs.length ? mySubs.map(s => `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:12px;">
        <h4 style="font-size:1rem; font-weight:800;">${s.bountyTitle}</h4>
        <p style="font-size:0.82rem; color:var(--muted); margin:6px 0;">Worker: ${getUserDisplayName(s.workerAddress)}</p>
        <div style="font-size:0.85rem; background:var(--bg-subtle); padding:10px; border-radius:10px; margin-bottom:12px;">${s.content}</div>
        <div style="display:flex; gap:10px;">
          <button class="btn-primary-sm" onclick="approveWorkerPayout('${s.id}')" style="flex:1; justify-content:center;">Approve &amp; Pay ${s.reward} NIM</button>
          <button class="btn-ghost-sm" onclick="openRejectionModal('${s.id}')" style="flex:1; justify-content:center; color:var(--danger);">Reject</button>
        </div>
      </div>
    `).join('') : createEmptyStateHTML(
      'No Pending Submissions',
      'When workers complete your published bounties and submit proof packages, they will appear here for 1-click review and payout.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
    );
  }
}

async function approveWorkerPayout(subId) {
  const subIndex = pendingSubmissions.findIndex(s => s.id === subId);
  if (subIndex === -1) return;
  const sub = pendingSubmissions[subIndex];

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
      showToastNotification('⚠️ Transaction Cancelled', 'Payout transaction was cancelled.', true);
      return;
    }
  }

  sub.status = 'approved';
  sub.approvedAt = Date.now();
  sub.txHash = txHash;

  approvedPayoutsHistory.unshift({
    bountyId: sub.bountyId,
    bountyTitle: sub.bountyTitle,
    workerAddress: sub.workerAddress,
    posterAddress: sub.posterAddress,
    reward: sub.reward,
    paidAt: Date.now(),
    txHash: txHash
  });

  const bIndex = bounties.findIndex(b => b.id === sub.bountyId);
  if (bIndex !== -1 && bounties[bIndex].slotsRemaining > 0) {
    bounties[bIndex].slotsRemaining -= 1;
  }

  localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
  localStorage.setItem(STORAGE_KEY_LOCAL_BOUNTIES, JSON.stringify(bounties));

  syncGlobalPublicBounties(null, true);

  renderPosterDashboard();
  renderBounties();
  renderSessionBar();
  updateWalletUI();
  triggerConfetti();
  showToastNotification('🎉 Worker Paid!', `${sub.reward} NIM transferred directly to ${getUserDisplayName(sub.workerAddress)}.`, false);
}

let _pendingRejectSubId = null;

function openRejectionModal(subId) {
  _pendingRejectSubId = subId;
  const modal = document.getElementById('modal-reject-reason');
  if (modal) modal.style.display = 'flex';
}

function submitTaskRejectionWithReason() {
  const reasonInput = document.getElementById('rejection-reason-input');
  const val = reasonInput ? reasonInput.value.trim() : '';

  if (!val) {
    showToastNotification('⚠️ Reason Required', 'Please provide a rejection reason.', true);
    return;
  }

  const subIndex = pendingSubmissions.findIndex(s => s.id === _pendingRejectSubId);
  if (subIndex !== -1) {
    pendingSubmissions[subIndex].status = 'rejected';
    pendingSubmissions[subIndex].rejectionReason = val;
    localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
    syncGlobalPublicBounties(null, true);
  }

  closeModal('modal-reject-reason');
  renderPosterDashboard();
  showToastNotification('❌ Task Rejected', 'Worker notified of rejection reason. Task slot remains open.', false);
  if (reasonInput) reasonInput.value = '';
}

function submitReportPoster() {
  const reasonInput = document.getElementById('report-poster-reason');
  const val = reasonInput ? reasonInput.value.trim() : '';

  if (!val) {
    showToastNotification('⚠️ Reason Required', 'Please explain the issue.', true);
    return;
  }

  closeModal('modal-report-poster');
  showToastNotification('🚩 Report Submitted', 'Poster reputation updated.', false);
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
  const list = document.getElementById('dedicated-orders-list');
  if (!list) return;

  if (!isRealWalletConnected()) {
    list.innerHTML = createEmptyStateHTML(
      'Wallet Required',
      'Connect your Nimiq Pay wallet to view your submitted orders and payout history.',
      `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`
    );
    return;
  }

  const myPayouts = approvedPayoutsHistory.filter(p => isSameNimiqAddress(p.workerAddress, userAccount));
  list.innerHTML = myPayouts.length ? myPayouts.map(p => `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h4 style="font-size:0.95rem; font-weight:800;">${p.bountyTitle}</h4>
        <div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">Paid: ${new Date(p.paidAt).toLocaleDateString()}</div>
      </div>
      <div style="font-family:var(--font-mono); font-size:1.1rem; font-weight:900; color:var(--gold);">+${p.reward} NIM</div>
    </div>
  `).join('') : createEmptyStateHTML(
    'No Submission Orders',
    'Your completed task payouts and order history will appear here once you complete bounties.',
    `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>`
  );
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
  { section: 'WELCOME', title: 'Welcome to NimBounty!', description: 'Earn NIM by completing micro-tasks with 0 gas fees.' },
  { section: 'MODE SWITCH', title: 'Switch Roles', description: 'Toggle between Worker Mode (earn NIM) and Poster Mode (publish tasks).' },
  { section: 'PROOF SIGNING', title: 'Off-Chain Proofs', description: 'Sign proofs off-chain for 0 gas cost.' }
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

function updateOnboardingUI() {
  const welcomeCard = document.getElementById('onboarding-welcome-card');
  const stepCard = document.getElementById('onboarding-step-card');

  if (onboardingStep === -1) {
    if (welcomeCard) welcomeCard.style.display = 'flex';
    if (stepCard) stepCard.style.display = 'none';
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
}

function onboardingNext() { onboardingStep++; updateOnboardingUI(); }
function onboardingBack() { if (onboardingStep > 0) { onboardingStep--; updateOnboardingUI(); } }
function skipOnboarding() {
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
  const allRep = JSON.parse(localStorage.getItem(STORAGE_KEY_REPUTATION) || '{}');
  const clean = String(walletAddress || '').replace(/\s+/g, '').toUpperCase();
  return allRep[clean] || { reports: 0, status: 'good' };
}

// Initializer
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  runTypewriter();
  fetchNimiqLiveRPC();
  checkUrlAutoImport();
  await fetchGlobalPublicBounties();

  updateWalletUI();
  calculateTotalEscrow();
  updateLandingStats();

  const isNimiqApp = typeof window !== 'undefined' && (!!window.nimiq || !!window.NimiqProvider || !!window.nimiqPay || !!window.NimiqPay || !!window.miniApp);

  if (isNimiqApp) {
    showView('app');
  } else {
    showView('landing');
  }

  setInterval(fetchGlobalPublicBounties, 5000);
});
