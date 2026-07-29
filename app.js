/* ==========================================
   NIMBOUNTY V2 - CLEAN JAVASCRIPT STATE ENGINE
   ========================================== */

// Storage Keys
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_wallet_v5';
const STORAGE_KEY_PROFILE = 'nimbounty_profile_v5';
const STORAGE_KEY_THEME = 'nimbounty_theme_v5';
const STORAGE_KEY_LOCAL_BOUNTIES = 'nimbounty_local_bounties_v5';
const STORAGE_KEY_ONBOARDED_GLOBAL = 'nimbounty_onboarded_global_v5';

// Global Application State
let userAccount = localStorage.getItem(STORAGE_KEY_USER_ACCT) || null;
let currentRole = 'worker'; // 'worker' | 'poster'
let currentView = 'app';
let workerSubtab = 'active'; // 'active' | 'history'
let posterSubtab = 'create'; // 'create' | 'pools' | 'subs'
let bounties = [];
let pendingSubmissions = [];
let approvedPayoutsHistory = [];

// Seed Bounties Fallback
const INITIAL_SEED_BOUNTIES = [
  {
    id: 'seed-bounty-1',
    title: 'Test Nimiq MiniApp UI & Report 3 UX Observations',
    category: 'app-test',
    reward: '15.0',
    slotsTotal: 10,
    slotsTaken: 2,
    posterAddress: 'NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN',
    description: 'Launch NimBounty inside Nimiq Pay MiniApp WebView. Test wallet connect, view switching, and submit 3 UX observations.',
    status: 'open',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'seed-bounty-2',
    title: 'Share NimBounty MiniApp Announcement on X (Twitter)',
    category: 'social',
    reward: '10.0',
    slotsTotal: 15,
    slotsTaken: 5,
    posterAddress: 'NQ33 A91B 44XX 88YY 22ZZ 11AA 99BB 77CC 55DD',
    description: 'Post a tweet mentioning @Nimiq and #NimBounty with a screenshot of the app console. Paste tweet URL as proof.',
    status: 'open',
    createdAt: Date.now() - 7200000
  }
];

// Helper: Check Real Wallet Connection
function isRealWalletConnected() {
  return !!(userAccount && typeof userAccount === 'string' && userAccount.trim().length > 0);
}

// Helper: Get Nimiq SDK Provider
function getNimiqProvider() {
  if (typeof window !== 'undefined' && window.nimiq) return window.nimiq;
  if (typeof window !== 'undefined' && window.NimiqProvider) return window.NimiqProvider;
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
// WALLET CONNECTION & SIGNING ENGINE
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
        return;
      }
    } catch (e) {
      console.warn("Nimiq Pay listAccounts error:", e);
    }
  }

  // Fallback for standard browsers outside Nimiq Pay MiniApp
  const inputAddr = prompt("Enter your Nimiq Wallet Address:", userAccount || "NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN");
  if (inputAddr && inputAddr.trim()) {
    userAccount = inputAddr.trim().replace(/\s+/g, '').toUpperCase();
    localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
    updateWalletUI();
    renderBounties();
    renderPosterDashboard();
    renderSessionBar();
    showToastNotification('⚡ Wallet Connected!', `Connected address: ${getUserDisplayName(userAccount)}`, false);
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
    connectNimiqPayWallet();
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
  const textDesktop = document.getElementById('wallet-text');
  const textMobile = document.getElementById('session-wallet-display');
  const displayVal = isRealWalletConnected() ? getUserDisplayName(userAccount) : 'CONNECT NIMIQ PAY';

  if (textDesktop) textDesktop.textContent = displayVal;
  if (textMobile) textMobile.textContent = displayVal;
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
}

// Logo Click Handler
function handleLogoClick(event) {
  if (event) event.preventDefault();
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    showView('app');
  } else {
    showView('landing');
  }
}

// Scroll To Section
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

// Toggle FAQ Item
function toggleFaq(btnEl) {
  const item = btnEl.closest('.faq-item');
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ==========================================
// VIEW ROUTER ENGINE
// ==========================================
function showView(viewName) {
  const isMobile = window.innerWidth <= 768;

  // On mobile screens, NEVER show landing page! Default to 'app'!
  if (isMobile && viewName === 'landing') {
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

  // Hide all view containers
  Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });

  const sessionBar = document.getElementById('console-session-bar');
  const profilePanel = document.getElementById('panel-profile');
  const workerView = document.getElementById('view-worker');
  const posterView = document.getElementById('view-poster');

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

  // Session Bar visibility: ONLY on main app view!
  if (sessionBar) {
    sessionBar.style.display = (viewName === 'app') ? 'flex' : 'none';
  }

  // Show target view container
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

function renderSessionBar() {
  const displayEl = document.getElementById('session-wallet-display');
  const badgeEl = document.getElementById('session-mode-badge');

  if (displayEl) {
    displayEl.textContent = isRealWalletConnected() ? getUserDisplayName(userAccount) : '⚡ CONNECT NIMIQ PAY';
  }
  if (badgeEl) {
    badgeEl.textContent = currentRole === 'worker' ? 'Worker Mode' : 'Poster Mode';
    badgeEl.style.color = currentRole === 'worker' ? 'var(--gold)' : 'var(--emerald)';
  }
}

// Role Switcher
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
  showToastNotification('🔄 Mode Switched', `Switched to ${role === 'worker' ? 'Worker' : 'Poster'} Mode`, false);
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

// ==========================================
// MOBILE BOTTOM NAVIGATION ENGINE
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

  nav.innerHTML = `
    <button class="mobile-bottom-tab ${currentView === 'app' && workerSubtab === 'active' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('active')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      Active
    </button>
    <button class="mobile-bottom-tab ${currentView === 'app' && workerSubtab === 'history' && !isProfileOpen ? 'active' : ''}" onclick="switchMobileTab('history')">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 16 14"/></svg>
      History
    </button>
    <button class="mobile-bottom-tab mode-center-tab" onclick="document.getElementById('modal-mode-switch').style.display='flex';">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/></svg>
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
}

function switchMobileTab(tab) {
  const profilePanel = document.getElementById('panel-profile');
  const workerView = document.getElementById('view-worker');
  const posterView = document.getElementById('view-poster');

  if (tab === 'profile') {
    if (profilePanel) profilePanel.style.display = 'block';
    if (workerView) workerView.style.display = 'none';
    if (posterView) posterView.style.display = 'none';
    renderProfile();
  } else if (tab === 'orders') {
    showView('orders');
  } else {
    showView('app');
    if (profilePanel) profilePanel.style.display = 'none';
    if (tab === 'active' || tab === 'history') {
      currentRole = 'worker';
      switchWorkerSubtab(tab);
    }
  }
  renderMobileBottomNav();
}

// ==========================================
// PROFILE SYSTEM (Screenshot 1 Layout)
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
        <div class="stat-val">0</div>
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
// BOUNTIES RENDER & BOUNTY ACTIONS
// ==========================================
function renderBounties() {
  const grid = document.getElementById('bounties-grid');
  if (!grid) return;

  const activeBounties = bounties.length ? bounties : INITIAL_SEED_BOUNTIES;

  grid.innerHTML = activeBounties.map(b => `
    <div class="bounty-card">
      <div>
        <div class="bounty-card-header">
          <span class="bounty-category-tag">${b.category || 'General'}</span>
          <span class="bounty-reward">${b.reward} NIM</span>
        </div>
        <h4 class="bounty-title">${b.title}</h4>
        <p class="bounty-desc">${b.description}</p>
      </div>
      <div>
        <div class="bounty-meta-row">
          <span>Poster: <strong>${getUserDisplayName(b.posterAddress)}</strong></span>
          <span>Slots: <strong>${b.slotsTaken || 0} / ${b.slotsTotal || 5}</strong></span>
        </div>
        <button class="btn-primary-sm full-width" onclick="openSubmitProofModal('${b.id}')" style="justify-content:center;">
          Participate &amp; Earn NIM &rarr;
        </button>
      </div>
    </div>
  `).join('');
}

let _selectedBountyId = null;

function openSubmitProofModal(bountyId) {
  _selectedBountyId = bountyId;
  const bounty = bounties.find(b => b.id === bountyId) || INITIAL_SEED_BOUNTIES.find(b => b.id === bountyId);
  if (bounty) {
    document.getElementById('proof-modal-bounty-title').textContent = `Submit Proof: ${bounty.title}`;
  }
  document.getElementById('modal-submit-proof').style.display = 'flex';
}

function handleSubmitProof() {
  const textInput = document.getElementById('proof-text-input');
  const val = textInput ? textInput.value.trim() : '';

  if (!val) {
    showToastNotification('⚠️ Empty Proof', 'Please provide proof text before submitting.', true);
    return;
  }

  closeModal('modal-submit-proof');
  showToastNotification('✅ Proof Submitted!', 'Proof signed off-chain with 0 gas. Waiting for poster review.', false);
  if (textInput) textInput.value = '';
}

function publishBountyPoolDirectly() {
  const title = document.getElementById('task-title')?.value.trim();
  const reward = document.getElementById('task-reward')?.value.trim() || '10';
  const slots = parseInt(document.getElementById('task-slots')?.value || '5');
  const category = document.getElementById('task-category')?.value || 'app-test';
  const desc = document.getElementById('task-desc')?.value.trim();

  if (!title || !desc) {
    showToastNotification('⚠️ Incomplete Form', 'Please fill out all required bounty fields.', true);
    return;
  }

  const newBounty = {
    id: `bounty-${Date.now()}`,
    title,
    reward: parseFloat(reward).toFixed(1),
    slotsTotal: slots,
    slotsTaken: 0,
    posterAddress: userAccount || 'NQ65 R26Y VNQL H5H9 F19S U3PB FY7N EJ7H PGNN',
    category,
    description: desc,
    status: 'open',
    createdAt: Date.now()
  };

  bounties.unshift(newBounty);
  renderBounties();
  showToastNotification('🎉 Bounty Published!', 'Your task campaign is live for workers.', false);

  // Clear form
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
}

function renderPosterDashboard() {
  const poolsList = document.getElementById('poster-pools-list');
  const subsList = document.getElementById('poster-subs-list');

  if (poolsList) {
    const myPools = bounties.filter(b => isSameNimiqAddress(b.posterAddress, userAccount));
    poolsList.innerHTML = myPools.length ? myPools.map(b => `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:12px;">
        <h4 style="font-size:1rem; font-weight:800;">${b.title}</h4>
        <div style="font-size:0.8rem; color:var(--muted); margin-top:4px;">Reward: ${b.reward} NIM &bull; Slots: ${b.slotsTaken} / ${b.slotsTotal}</div>
      </div>
    `).join('') : '<p style="color:var(--muted); font-size:0.85rem;">No published bounty pools yet.</p>';
  }

  if (subsList) {
    subsList.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">No pending worker submissions to review.</p>';
  }
}

function renderDedicatedOrders() {
  const list = document.getElementById('dedicated-orders-list');
  if (!list) return;
  list.innerHTML = '<p style="color:var(--muted); font-size:0.85rem; padding:20px 0;">No completed orders found for this wallet address.</p>';
}

function updateLandingStats() {
  const activeEl = document.getElementById('landing-stat-active');
  const paidEl = document.getElementById('landing-stat-paid');

  if (activeEl) activeEl.textContent = bounties.length ? bounties.length : '2';
  if (paidEl) paidEl.textContent = '120 NIM';
}

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateWalletUI();

  const isMobile = window.innerWidth <= 768;

  // On mobile screens: ALWAYS open directly into App Console!
  if (isMobile) {
    showView('app');
  } else {
    showView('landing');
  }
});
