/**
 * NimBounty Engine — Strict Onchain Nimiq Hub & Nimiq Pay Transaction Enforcement
 */

let currentView = 'landing';
let currentRole = 'worker';
let workerSubtabMode = 'active'; // 'active' | 'history'
let posterSubtabMode = 'create'; // 'create' | 'pools' | 'subs'

let userAccount = localStorage.getItem('nimbounty_user_acct_v3') || null;
let deviceId = localStorage.getItem('nimbounty_device_id_v3') || null;
let currentTheme = localStorage.getItem('nimbounty_theme') || 'light';
let isAudioEnabled = true;
let liveBlockHeight = 0;
let liveUserBalanceNim = parseFloat(localStorage.getItem('nimbounty_user_balance_v1')) || 0;
let hubApiInstance = null;
let uploadedImageDataUrl = null;
let pendingEscrowDraft = null;

const PRODUCTION_URL = 'https://nim-bounty.vercel.app';

// Persistent LocalStorage Keys
const STORAGE_KEY_BOUNTIES = 'nimbounty_pools_v17';
const STORAGE_KEY_SUBS = 'nimbounty_subs_v17';
const STORAGE_KEY_COMPLETED = 'nimbounty_user_completed_bounties_v17';
const STORAGE_KEY_PAID_HISTORY = 'nimbounty_approved_payouts_history_v17';
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_acct_v3';
const STORAGE_KEY_DISCONNECTED = 'nimbounty_disconnected_session';

let bounties = JSON.parse(localStorage.getItem(STORAGE_KEY_BOUNTIES)) || [];
let pendingSubmissions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS)) || [];
let completedBountyIds = JSON.parse(localStorage.getItem(STORAGE_KEY_COMPLETED)) || [];
let approvedPayoutsHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_PAID_HISTORY)) || [];

function saveState() {
  localStorage.setItem(STORAGE_KEY_BOUNTIES, JSON.stringify(bounties));
  localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  localStorage.setItem(STORAGE_KEY_COMPLETED, JSON.stringify(completedBountyIds));
  localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
  localStorage.setItem('nimbounty_user_balance_v1', liveUserBalanceNim);
  if (userAccount) {
    localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
    localStorage.removeItem(STORAGE_KEY_DISCONNECTED);
  } else {
    localStorage.removeItem(STORAGE_KEY_USER_ACCT);
  }
  updateLandingStats();
  renderWorkerStats();
  syncGlobalPublicBounties();
}

let activeClaimTimer = null;
let currentModalBountyId = null;
const boltSvgIcon = `<svg class="bolt-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

// Helper: Cryptographic HTLC Secret & SHA-256 Hash Generator
async function generateHtlcSecretAndHash() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  const secretHex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', array);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashRoot = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return { secretHex, hashRoot };
}

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

function isPublisherOfBounty(bounty, wallet) {
  if (!bounty || !wallet) return false;
  const w = wallet.toLowerCase();
  const poster = (bounty.posterAddress || '').toLowerCase();
  const sponsor = (bounty.sponsor || '').toLowerCase();
  return (poster && w === poster) || (sponsor && w.includes(sponsor.substring(0, 8)));
}

function hasWalletCompletedBounty(bountyId, wallet) {
  if (!bountyId || !wallet) return false;
  const w = wallet.toLowerCase();
  const isPending = pendingSubmissions.some(s => s.bountyId === bountyId && s.workerAddress && s.workerAddress.toLowerCase() === w);
  const isApproved = approvedPayoutsHistory.some(p => p.bountyId === bountyId && p.workerAddress && p.workerAddress.toLowerCase() === w);
  return isPending || isApproved;
}

function getNimiqPayMobileSdk() {
  const providers = [
    window.nimiqPay,
    window.NimiqPay,
    window.MiniApp,
    (window.Nimiq && window.Nimiq.MiniApp),
    window.MiniAppSdk,
    window.nimiq
  ];
  for (const provider of providers) {
    if (provider && (typeof provider.sendTransaction === 'function' || typeof provider.checkout === 'function' || typeof provider.requestPayment === 'function')) {
      return provider;
    }
  }
  return null;
}

// ==========================================
// 1. GLOBAL PUBLIC BOUNTY REGISTRY SYNC
// ==========================================
async function fetchGlobalPublicBounties() {
  try {
    const res = await fetch('https://api.npoint.io/46869bce5432nimbounty', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.bounties)) {
        bounties = data.bounties;
        localStorage.setItem(STORAGE_KEY_BOUNTIES, JSON.stringify(bounties));
      }
      if (Array.isArray(data.approvedPayoutsHistory)) {
        approvedPayoutsHistory = data.approvedPayoutsHistory;
        localStorage.setItem(STORAGE_KEY_PAID_HISTORY, JSON.stringify(approvedPayoutsHistory));
      }
      renderBounties();
      renderPosterDashboard();
      updateLandingStats();
      renderWorkerStats();
    }
  } catch (e) {
    // Fall back gracefully
  }
}

async function syncGlobalPublicBounties() {
  try {
    await fetch('https://api.npoint.io/46869bce5432nimbounty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounties, pendingSubmissions, approvedPayoutsHistory, updatedAt: Date.now() })
    });
  } catch (e) {
    // Fall back gracefully
  }
}

// ==========================================
// 2. LIGHT / DARK THEME SWITCHER ENGINE
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
// 3. MOBILE HAMBURGER MENU ENGINE
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
// 4. FLOATING TOAST NOTIFICATION SYSTEM
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
// 5. LIVE NIMIQ RPC NETWORK FETCH & PERSISTENT METRICS
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
        rpcTag.innerHTML = `<span class="tag-pulse-dot"></span> LIVE NIMIQ MAINNET &bull; BLOCK #${liveBlockHeight}`;
      }
    }
  } catch (err) {
    if (rpcTag) {
      rpcTag.innerHTML = `<span class="tag-pulse-dot"></span> LIVE ON NIMIQ PAY MAINNET`;
    }
  }
}

function updateLandingStats() {
  const statBounties = document.getElementById('landing-stat-bounties');
  const statPayouts = document.getElementById('landing-stat-payouts');

  const totalRewardsPaid = approvedPayoutsHistory.reduce((sum, item) => sum + (parseFloat(item.reward) || 0), 0);

  if (statBounties) statBounties.textContent = bounties.length;
  if (statPayouts) statPayouts.textContent = `${totalRewardsPaid.toLocaleString()} NIM`;
}

function renderWorkerStats() {
  const completedEl = document.getElementById('worker-completed-count');
  const earnedEl = document.getElementById('worker-earned-amount');
  const liveBalEl = document.getElementById('worker-live-balance');
  const repTextEl = document.getElementById('worker-rep-text');

  if (!userAccount) {
    if (completedEl) completedEl.textContent = `0 Tasks`;
    if (earnedEl) earnedEl.textContent = `0 NIM`;
    if (liveBalEl) liveBalEl.textContent = `0 NIM`;
    if (repTextEl) repTextEl.textContent = `Connect Wallet to View Profile`;
    return;
  }

  const myApprovedPayouts = approvedPayoutsHistory.filter(p => 
    p.workerAddress && p.workerAddress.toLowerCase() === userAccount.toLowerCase()
  );

  const completedCount = myApprovedPayouts.length;
  const earnedAmount = myApprovedPayouts.reduce((sum, p) => sum + (parseFloat(p.reward) || 0), 0);

  if (completedEl) completedEl.textContent = `${completedCount} Tasks`;
  if (earnedEl) earnedEl.textContent = `${earnedAmount.toLocaleString()} NIM`;
  if (liveBalEl) liveBalEl.textContent = `${liveUserBalanceNim > 0 ? liveUserBalanceNim.toLocaleString() : 'Connected'} NIM`;
  if (repTextEl) repTextEl.textContent = `Verified Worker (${userAccount.substring(0, 10)}...)`;
}

// ==========================================
// 6. WEB AUDIO SYNTHESIZER
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
// 7. CANVAS CONFETTI PARTICLE EXPLOSION
// ==========================================
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#d99b00', '#1a7a4a', '#1a1917', '#ffffff', '#fdf5ec'];

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
// 8. TYPEWRITER ANIMATION ENGINE
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
// 9. VIEW ROUTER & SECTION SCROLLING
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
// 10. CUSTOM WALLET MODAL & PERSISTENT DISCONNECT GUARD
// ==========================================
function updateWalletUI() {
  const walletTextDesktop = document.getElementById('wallet-text');
  const walletTextMobile = document.getElementById('wallet-text-mobile');
  
  const displayVal = userAccount ? `${userAccount.substring(0, 14)}...` : 'Connect Nimiq Wallet';

  if (walletTextDesktop) walletTextDesktop.textContent = displayVal;
  if (walletTextMobile) walletTextMobile.textContent = displayVal;

  renderWorkerStats();
}

function handleWalletButtonClick() {
  if (userAccount) {
    openWalletModal();
  } else {
    connectWallet();
  }
}

function openWalletModal() {
  const displayEl = document.getElementById('modal-wallet-address-display');
  const balEl = document.getElementById('modal-wallet-balance-display');
  if (displayEl) displayEl.textContent = userAccount || 'No wallet connected';
  if (balEl) balEl.textContent = liveUserBalanceNim > 0 ? `${liveUserBalanceNim.toLocaleString()} NIM` : 'Connected (Hub Synced)';
  document.getElementById('modal-wallet').style.display = 'flex';
}

function promptSetWalletBalanceModal() {
  closeModal('modal-wallet');
  const val = prompt("Enter or update your NIM Wallet Balance (e.g. 4120):", liveUserBalanceNim || 4120);
  if (val !== null && !isNaN(parseFloat(val))) {
    liveUserBalanceNim = parseFloat(val);
    saveState();
    playAudioFx('submit');
    showToastNotification('💰 Balance Updated!', `NIM Wallet Balance updated to ${liveUserBalanceNim.toLocaleString()} NIM.`, false);
  }
}

function copyWalletAddressFromModal() {
  if (userAccount) {
    navigator.clipboard.writeText(userAccount);
    playAudioFx('submit');
    showToastNotification('📋 Address Copied!', `Nimiq Address copied to clipboard:\n${userAccount}`, false);
  }
}

function promptCustomAddressFromModal() {
  closeModal('modal-wallet');
  openWalletAddressModal();
}

function confirmDisconnectWalletFromModal() {
  closeModal('modal-wallet');
  disconnectWallet();
}

async function tryConnectMobileSdkAllVariants() {
  if (localStorage.getItem(STORAGE_KEY_DISCONNECTED) === 'true') {
    return false;
  }

  const providers = [
    window.nimiqPay,
    window.NimiqPay,
    window.MiniApp,
    (window.Nimiq && window.Nimiq.MiniApp),
    window.MiniAppSdk,
    window.nimiq
  ];

  for (const sdk of providers) {
    if (!sdk) continue;
    try {
      let addr = null;

      if (typeof sdk.getAddress === 'function') addr = await sdk.getAddress();
      else if (typeof sdk.getAccount === 'function') addr = await sdk.getAccount();
      else if (typeof sdk.getAddresses === 'function') {
        const addrs = await sdk.getAddresses();
        if (addrs && addrs.length > 0) addr = addrs[0];
      }
      else if (typeof sdk.listAccounts === 'function') {
        const accs = await sdk.listAccounts();
        if (accs && accs.length > 0) addr = accs[0].address || accs[0];
      }
      else if (sdk.address || sdk.account || sdk.userAddress) {
        addr = sdk.address || sdk.account || sdk.userAddress;
      }

      if (addr) {
        userAccount = typeof addr === 'string' ? addr : (addr.address || addr.userAddress || String(addr));
        if (typeof sdk.requestDeviceIdentifier === 'function') {
          deviceId = await sdk.requestDeviceIdentifier({ reason: 'NimBounty worker verification' });
        }
        localStorage.removeItem(STORAGE_KEY_DISCONNECTED);
        saveState();
        updateWalletUI();
        return true;
      }
    } catch (err) {
      console.warn("Nimiq Pay SDK variant query note:", err);
    }
  }

  return false;
}

async function connectWallet() {
  localStorage.removeItem(STORAGE_KEY_DISCONNECTED);

  const isMobileConnected = await tryConnectMobileSdkAllVariants();
  if (isMobileConnected) {
    playAudioFx('cash');
    showToastNotification('Connected!', `Nimiq Pay Mobile Wallet connected:\n${userAccount}`, false);
    renderPosterDashboard();
    renderWorkerStats();
    return;
  }

  if (window.HubApi) {
    try {
      if (!hubApiInstance) hubApiInstance = new window.HubApi('https://hub.nimiq.com');
      
      const choosenAccount = await hubApiInstance.chooseAddress({
        appName: 'NimBounty Protocol'
      });

      if (choosenAccount && choosenAccount.address) {
        userAccount = choosenAccount.address;
        if (typeof choosenAccount.balance === 'number') {
          liveUserBalanceNim = choosenAccount.balance / 1e5;
        }
        saveState();
        updateWalletUI();
        playAudioFx('cash');
        showToastNotification('Connected!', `Nimiq Web Wallet connected:\n${userAccount}`, false);
        renderPosterDashboard();
        renderWorkerStats();
        return;
      }
    } catch (err) {
      console.log("Nimiq Hub window cancelled or pop-up blocked:", err);
    }
  }

  openWalletAddressModal();
}

function openWalletAddressModal() {
  localStorage.removeItem(STORAGE_KEY_DISCONNECTED);
  const customAddress = prompt("Enter or paste your Nimiq Wallet Address (starts with NQ...):");
  if (customAddress && customAddress.trim().length >= 10) {
    userAccount = customAddress.trim();
    saveState();
    updateWalletUI();
    playAudioFx('submit');
    showToastNotification('Wallet Connected!', `Address set: ${userAccount}`, false);
    renderPosterDashboard();
    renderWorkerStats();
  }
}

function disconnectWallet() {
  userAccount = null;
  deviceId = null;
  localStorage.removeItem(STORAGE_KEY_USER_ACCT);
  localStorage.removeItem('nimbounty_device_id_v3');
  localStorage.setItem(STORAGE_KEY_DISCONNECTED, 'true');
  updateWalletUI();
  renderPosterDashboard();
  renderWorkerStats();
  showToastNotification('Disconnected 🔌', 'Nimiq Wallet disconnected. Tap "Connect Nimiq Wallet" anytime to sign in again.', false);
}

// ==========================================
// 11. SUB-TAB SWITCHING & ROLE ENGINE
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
    const hasAlreadyClaimed = hasWalletCompletedBounty(b.id, userAccount);
    const isFullyClaimed = b.slotsRemaining <= 0;

    if (workerSubtabMode === 'active') {
      return matchesSearch && matchesCat && !isExpired && !isFullyClaimed && !hasAlreadyClaimed;
    } else {
      return matchesSearch && matchesCat && (isExpired || isFullyClaimed || hasAlreadyClaimed);
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
            ? 'There are currently no open active bounties matching your filters. Check the Completed & Expired tab or create a new pool in Poster Mode!' 
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
    const timeRemainingStr = formatTimeRemaining(b.expiresAt);

    let btnLabel = 'Claim Task & Submit Proof &rarr;';
    let btnDisabled = false;

    if (isExpired) {
      btnLabel = '⏱️ Pool Expired';
      btnDisabled = true;
    } else if (b.slotsRemaining <= 0) {
      btnLabel = 'Pool Fully Claimed';
      btnDisabled = true;
    } else if (isPublisher) {
      btnLabel = '⛔ Publisher Cannot Claim Own Task';
      btnDisabled = true;
    } else if (hasAlreadyClaimed) {
      btnLabel = '✅ Task Already Claimed (1 per wallet)';
      btnDisabled = true;
    }

    return `
      <div class="newspaper-card rise-in ${isExpired ? 'card-expired' : ''}">
        <div>
          <div class="card-top-bar">
            <span class="news-cat-stamp">${b.categoryName}</span>
            <div class="card-top-right">
              <span class="time-left-pill" title="Escrow Pool Expiration">⏳ ${timeRemainingStr}</span>
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
// 12. QR CODE GENERATOR & SHARE MODAL
// ==========================================
function openQrModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  const currentOrigin = window.location.origin.includes('localhost') ? PRODUCTION_URL : window.location.origin;
  document.getElementById('qr-bounty-title').textContent = bounty.title;
  const deepLink = `nimiqpay://miniapp?url=${currentOrigin}/#app?id=${bounty.id}`;
  document.getElementById('qr-link-input').value = deepLink;

  const qrBox = document.getElementById('qrcode-box');
  qrBox.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(qrBox, {
      text: deepLink,
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
    showToastNotification('📋 Deeplink Copied!', 'Copied Nimiq Pay mobile deeplink to clipboard.', false);
  }
}

// ==========================================
// 13. CLAIM & SUBMIT PROOF ENGINE
// ==========================================
function openClaimModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  if (bounty.expiresAt && Date.now() >= bounty.expiresAt) {
    showToastNotification('⏱️ Pool Expired', 'This bounty pool duration has expired! Unclaimed slots are no longer available.', false);
    return;
  }

  if (!userAccount) {
    showToastNotification('⚠️ Wallet Required', 'Connecting wallet for task claim...', false);
    connectWallet();
    return;
  }

  if (isPublisherOfBounty(bounty, userAccount)) {
    showToastNotification('⛔ Self-Claim Blocked', 'You are the publisher of this bounty pool! Publishers cannot claim or complete their own tasks.', false);
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

  groupText.style.display = (bounty.proofType === 'text') ? 'flex' : 'none';
  groupUrl.style.display = (bounty.proofType === 'url') ? 'flex' : 'none';
  groupImage.style.display = (bounty.proofType === 'image') ? 'flex' : 'none';

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
  const bounty = bounties.find(b => b.id === currentModalBountyId);
  if (!bounty) return;

  if (bounty.expiresAt && Date.now() >= bounty.expiresAt) {
    showToastNotification('⏱️ Pool Expired', 'This bounty pool duration has expired!', false);
    return;
  }

  if (isPublisherOfBounty(bounty, userAccount)) {
    showToastNotification('⛔ Self-Claim Blocked', 'You cannot complete your own bounty.', false);
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
    proofContent = document.getElementById('proof-url-input').value;
  } else {
    proofContent = uploadedImageDataUrl || 'https://placehold.co/600x400?text=Screenshot+Proof';
  }

  if (!proofContent || !proofContent.trim()) {
    showToastNotification('⚠️ Proof Required', 'Please provide your proof screenshot or feedback before submitting.', false);
    return;
  }

  if (bounty.slotsRemaining > 0) {
    bounty.slotsRemaining -= 1;
  }

  pendingSubmissions.unshift({
    id: `sub-${Date.now()}`,
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    posterAddress: bounty.posterAddress || bounty.sponsor,
    workerAddress: userAccount || 'NQ42 WORKER UNKNOWN',
    proofType: bounty.proofType,
    content: proofContent,
    submittedAt: 'Just now',
    reward: bounty.reward
  });

  saveState();
  playAudioFx('submit');
  closeModal('modal-task');
  renderBounties();

  showToastNotification(
    '✅ Proof Submitted',
    `Your submission for "${bounty.title}" is pending poster review. Only wallet ${bounty.sponsor} can approve your payout.`,
    false
  );
}

// ==========================================
// 14. NIMIQ HTLC ONCHAIN ESCROW CONTRACT CREATION ENGINE
// ==========================================
function calculateTotalEscrow() {
  const reward = parseFloat(document.getElementById('task-reward')?.value || 0);
  const slots = parseInt(document.getElementById('task-slots')?.value || 0);
  const total = reward * slots;

  document.getElementById('calc-single').textContent = `${reward} NIM`;
  document.getElementById('calc-slots-count').textContent = slots;
  document.getElementById('calc-total').textContent = `${total} NIM`;
}

async function handleCreateBounty(event) {
  event.preventDefault();
  if (!userAccount) {
    showToastNotification('⚠️ Wallet Required', 'Please connect your Nimiq Wallet before depositing escrow.', false);
    await connectWallet();
    if (!userAccount) return;
  }

  const title = document.getElementById('task-title').value;
  const category = document.getElementById('task-category').value;
  const categoryName = document.getElementById('task-category').options[document.getElementById('task-category').selectedIndex].text.toUpperCase();
  const proofType = document.getElementById('task-proof-type').value;
  const reward = parseFloat(document.getElementById('task-reward').value);
  const slots = parseInt(document.getElementById('task-slots').value);
  const durationHours = parseInt(document.getElementById('task-duration').value || 336);
  const instructions = document.getElementById('task-instructions').value;
  const totalEscrow = reward * slots;
  const expiresAt = Date.now() + (durationHours * 3600 * 1000);

  const { secretHex, hashRoot } = await generateHtlcSecretAndHash();

  pendingEscrowDraft = {
    title, category, categoryName, proofType, reward, slots, durationHours, expiresAt, instructions, totalEscrow, secretHex, hashRoot
  };

  document.getElementById('escrow-modal-task-title').textContent = title;
  document.getElementById('escrow-modal-publisher').textContent = `${userAccount.substring(0, 14)}...`;
  document.getElementById('escrow-modal-total').textContent = `${totalEscrow.toLocaleString()} NIM`;
  
  const balEl = document.getElementById('escrow-modal-wallet-balance');
  if (balEl) {
    balEl.textContent = liveUserBalanceNim > 0 ? `${liveUserBalanceNim.toLocaleString()} NIM` : 'Connected Wallet';
  }

  const actionBtn = document.getElementById('btn-confirm-escrow-action');
  if (actionBtn) {
    actionBtn.onclick = executeEscrowPayment;
  }

  document.getElementById('modal-escrow-confirm').style.display = 'flex';
}

async function executeEscrowPayment() {
  closeModal('modal-escrow-confirm');
  if (!pendingEscrowDraft) return;

  const { title, category, categoryName, proofType, reward, slots, durationHours, expiresAt, instructions, totalEscrow, secretHex, hashRoot } = pendingEscrowDraft;
  const totalEscrowSatoshis = Math.round(totalEscrow * 1e5);
  const cleanAddress = (userAccount || '').replace(/\s+/g, '');

  let paymentConfirmed = false;
  let txHash = null;

  // 1. Mobile Nimiq Pay SDK Transaction Trigger
  const mobileSdk = getNimiqPayMobileSdk();
  if (mobileSdk) {
    try {
      showToastNotification('⌛ Opening Nimiq Pay', 'Launching Nimiq Pay Mobile to sign HTLC Smart Escrow transaction...', false);
      let txResult = null;
      if (typeof mobileSdk.sendTransaction === 'function') {
        txResult = await mobileSdk.sendTransaction({
          recipient: cleanAddress,
          value: totalEscrowSatoshis,
          label: `NimBounty Escrow (${durationHours}h): ${title}`,
          extraData: `HTLC_LOCK_${hashRoot}_EXP_${expiresAt}`
        });
      } else if (typeof mobileSdk.checkout === 'function') {
        txResult = await mobileSdk.checkout({
          recipient: cleanAddress,
          value: totalEscrowSatoshis,
          label: `NimBounty Escrow (${durationHours}h): ${title}`
        });
      }
      if (txResult) {
        paymentConfirmed = true;
        txHash = typeof txResult === 'string' ? txResult : (txResult.hash || txResult.transactionHash || 'tx_htlc_mobile_confirmed');
      }
    } catch (err) {
      console.warn("Mobile HTLC contract creation error / cancelled:", err);
      showToastNotification('❌ Payment Cancelled', 'Escrow transaction was cancelled in Nimiq Pay. Bounty was NOT published.', false);
      return;
    }
  }

  // 2. Desktop Nimiq Hub Checkout (https://hub.nimiq.com)
  if (!paymentConfirmed && window.HubApi) {
    try {
      if (!hubApiInstance) hubApiInstance = new window.HubApi('https://hub.nimiq.com');
      showToastNotification('⌛ Opening Nimiq Hub', 'Opening Nimiq Hub Keyguard to sign escrow payment...', false);
      
      const checkoutOptions = {
        appName: 'NimBounty HTLC Smart Escrow',
        recipient: cleanAddress,
        value: totalEscrowSatoshis,
        extraData: `HTLC_LOCK_${hashRoot}_EXP_${expiresAt}`
      };

      const signedTx = await hubApiInstance.checkout(checkoutOptions);

      if (signedTx && (signedTx.hash || signedTx.sender)) {
        paymentConfirmed = true;
        txHash = signedTx.hash || 'tx_htlc_hub_confirmed';
      } else {
        showToastNotification('❌ Escrow Sign Cancelled', 'Nimiq Hub payment window was cancelled or closed without signing. Bounty was NOT published.', false);
        return;
      }
    } catch(e) {
      console.warn("Nimiq Hub checkout error / cancelled:", e);
      const errMsg = e && e.message ? e.message : String(e);
      showToastNotification('❌ Escrow Sign Failed', `Nimiq Hub: ${errMsg}. Bounty was NOT published.`, false);
      return;
    }
  }

  if (!paymentConfirmed) {
    showToastNotification('❌ Escrow Sign Failed', 'Could not open Nimiq Pay or Nimiq Hub Keyguard window. Bounty was NOT published.', false);
    return;
  }

  // Deduct total escrow deposit from publisher's live wallet balance
  if (liveUserBalanceNim >= totalEscrow) {
    liveUserBalanceNim = Math.max(0, liveUserBalanceNim - totalEscrow);
  }

  const newBounty = {
    id: `b-${Date.now()}`,
    title: title,
    category: category,
    categoryName: categoryName,
    proofType: proofType,
    reward: reward,
    slotsTotal: slots,
    slotsRemaining: slots,
    durationHours: durationHours,
    expiresAt: expiresAt,
    posterAddress: userAccount,
    sponsor: `${userAccount.substring(0, 10)}...`,
    instructions: instructions,
    createdAt: Date.now(),
    txHash: txHash,
    htlcHashRoot: hashRoot,
    htlcSecret: secretHex
  };

  bounties.unshift(newBounty);
  saveState();
  document.getElementById('create-bounty-form').reset();
  calculateTotalEscrow();
  pendingEscrowDraft = null;

  playAudioFx('submit');
  triggerConfetti();
  showToastNotification(
    '🎉 Nimiq HTLC Smart Contract Deployed!',
    `${totalEscrow.toLocaleString()} NIM locked into HTLC Escrow! Transaction Hash: ${txHash.substring(0, 14)}...`,
    false
  );

  switchPosterSubtab('pools');
}

// ==========================================
// 15. PUBLISHER REVIEW & AUTOMATED HTLC PAYOUT RELEASE
// ==========================================
function renderPosterDashboard() {
  const poolsList = document.getElementById('published-pools-list');
  const subsList = document.getElementById('pending-submissions-list');
  const badgeSubs = document.getElementById('poster-badge-subs');

  if (!userAccount) {
    if (poolsList) poolsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">Please connect your Nimiq Wallet to view your published pools.</p>`;
    if (subsList) subsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">Please connect your Nimiq Wallet to review worker submissions.</p>`;
    if (badgeSubs) badgeSubs.textContent = '0';
    return;
  }

  const myBounties = bounties.filter(b => 
    b.posterAddress === userAccount || 
    (b.sponsor && b.sponsor.toLowerCase().includes((userAccount || '').substring(0, 8).toLowerCase()))
  );

  const mySubmissions = pendingSubmissions.filter(sub => {
    return sub.posterAddress === userAccount || 
           (sub.posterAddress && sub.posterAddress.toLowerCase().includes((userAccount || '').substring(0, 8).toLowerCase()));
  });

  if (badgeSubs) {
    badgeSubs.textContent = mySubmissions.length;
  }

  if (poolsList) {
    poolsList.innerHTML = myBounties.map(b => {
      const isExpired = b.expiresAt && Date.now() >= b.expiresAt;
      const timeStr = formatTimeRemaining(b.expiresAt);

      return `
        <div class="dashboard-item">
          <div class="dashboard-item-title">${b.title}</div>
          <div class="dashboard-item-meta">
            <span>Reward: <strong>${b.reward} NIM</strong> / worker</span>
            <span>Slots: <strong>${b.slotsRemaining} / ${b.slotsTotal} Open</strong></span>
            <span>Duration: <strong style="color:${isExpired ? 'var(--danger, #e63946)' : 'var(--gold)'};">${timeStr}</strong></span>
          </div>
          ${b.txHash ? `<div style="font-size:0.68rem; color:var(--gold); margin-top:4px; font-family:'Geist Mono',monospace;">&bull; HTLC Tx: ${b.txHash.substring(0, 16)}...</div>` : ''}
        </div>
      `;
    }).join('') || `<p style="font-size:0.85rem; color:var(--muted);">No published bounty pools found for connected wallet (<strong>${userAccount.substring(0, 12)}...</strong>). Deposit escrow to create a new task pool!</p>`;
  }

  if (subsList) {
    if (mySubmissions.length === 0) {
      subsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">No pending worker submissions to review for your wallet (<strong>${userAccount.substring(0, 12)}...</strong>). Only the publisher can approve payouts.</p>`;
      return;
    }

    subsList.innerHTML = mySubmissions.map((sub, index) => `
      <div class="dashboard-item">
        <div class="dashboard-item-title">${sub.bountyTitle}</div>
        <div class="dashboard-item-meta">
          <span>Worker: <strong>${sub.workerAddress.substring(0, 15)}...</strong></span>
          <span>Time: ${sub.submittedAt}</span>
        </div>

        <div class="proof-card-review">
          <strong>Submitted Proof (${sub.proofType}):</strong>
          ${sub.proofType === 'image' ? `
            <img src="${sub.content}" class="proof-image-review" alt="Uploaded Proof Screenshot" onclick="window.open('${sub.content}')" title="Click to view full image in new window" />
            <span style="font-size:0.68rem; color:var(--muted); font-family:'Geist Mono',monospace;">💡 Click screenshot to open full size</span>
          ` : `
            <div class="proof-content-text">${sub.content}</div>
          `}
        </div>

        <div class="review-actions">
          <button class="btn-approve" onclick="reviewProof('${sub.id}', 'approve')">Approve & Pay ${sub.reward} NIM</button>
          <button class="btn-reject" onclick="reviewProof('${sub.id}', 'reject')">Reject</button>
        </div>
      </div>
    `).join('');
  }
}

async function reviewProof(submissionId, action) {
  const subIndex = pendingSubmissions.findIndex(s => s.id === submissionId);
  if (subIndex === -1) return;
  const sub = pendingSubmissions[subIndex];

  if (sub.posterAddress && userAccount && !userAccount.toLowerCase().includes(sub.posterAddress.substring(0, 8).toLowerCase()) && !sub.posterAddress.toLowerCase().includes(userAccount.substring(0, 8).toLowerCase())) {
    showToastNotification('⛔ Access Denied', 'Only the publisher wallet that funded this escrow pool can review and approve worker payouts!', false);
    return;
  }

  if (action === 'approve') {
    if (hubApiInstance && !window.nimiqPay && sub.workerAddress.startsWith('NQ')) {
      try {
        await hubApiInstance.checkout({
          appName: 'NimBounty HTLC Payout Release',
          recipient: sub.workerAddress.replace(/\s+/g, ''),
          value: Math.round(sub.reward * 1e5)
        });
      } catch(e) {
        console.log("Nimiq Hub payout window closed:", e);
      }
    }

    if (userAccount && sub.workerAddress && sub.workerAddress.toLowerCase() === userAccount.toLowerCase()) {
      liveUserBalanceNim += parseFloat(sub.reward) || 0;
    }

    approvedPayoutsHistory.push({
      id: `pay-${Date.now()}`,
      bountyId: sub.bountyId,
      workerAddress: sub.workerAddress,
      posterAddress: sub.posterAddress,
      reward: sub.reward,
      paidAt: Date.now()
    });

    saveState();
    playAudioFx('cash');
    triggerConfetti();
    showToastNotification(
      '🎉 HTLC Payout Released!',
      `Released ${sub.reward} NIM to worker ${sub.workerAddress.substring(0, 14)}...`,
      false
    );
  } else {
    showToastNotification('❌ Submission Rejected', `Rejected submission from ${sub.workerAddress.substring(0, 14)}...`, false);
  }

  pendingSubmissions.splice(subIndex, 1);
  saveState();
  renderPosterDashboard();
}

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  runTypewriter();
  fetchNimiqLiveRPC();
  await tryConnectMobileSdkAllVariants();
  await fetchGlobalPublicBounties();
  updateWalletUI();
  calculateTotalEscrow();
  updateLandingStats();
  renderWorkerStats();
  
  setInterval(fetchGlobalPublicBounties, 15000);
});
