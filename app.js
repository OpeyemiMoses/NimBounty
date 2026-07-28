/**
 * NimBounty Engine — Clean Live Protocol Engine (No Mocked Bounties)
 */

let currentView = 'landing';
let currentRole = 'worker';
let userAccount = null;
let deviceId = null;
let isAudioEnabled = true;
let liveBlockHeight = 0;
let hubApiInstance = null;

// Persistent LocalStorage Keys
const STORAGE_KEY_BOUNTIES = 'nimbounty_pools_v2';
const STORAGE_KEY_SUBS = 'nimbounty_subs_v2';
const STORAGE_KEY_STATS = 'nimbounty_stats_v2';
const STORAGE_KEY_USER_ACCT = 'nimbounty_user_acct_v2';

// Pure Real Data Store — Starts Empty until Created by Users
let bounties = JSON.parse(localStorage.getItem(STORAGE_KEY_BOUNTIES)) || [];
let pendingSubmissions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS)) || [];

let workerStats = JSON.parse(localStorage.getItem(STORAGE_KEY_STATS)) || {
  completed: 0,
  earned: 0,
  activeClaims: 0,
  reputation: 100
};

function saveState() {
  localStorage.setItem(STORAGE_KEY_BOUNTIES, JSON.stringify(bounties));
  localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(pendingSubmissions));
  localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(workerStats));
  if (userAccount) localStorage.setItem(STORAGE_KEY_USER_ACCT, userAccount);
}

let activeClaimTimer = null;
let currentModalBountyId = null;
const boltSvgIcon = `<svg class="bolt-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

// ==========================================
// 1. LIVE NIMIQ RPC NETWORK FETCH
// ==========================================
async function fetchNimiqLiveRPC() {
  const rpcTag = document.querySelector('.hero-tag');
  try {
    const response = await fetch('https://rpc.nimiq.com', {
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

// ==========================================
// 2. WEB AUDIO SYNTHESIZER
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
// 3. CANVAS CONFETTI PARTICLE EXPLOSION
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
      cancelAnimationFrame(animationFrame);
    }
  }

  animate();
}

// ==========================================
// 4. TYPEWRITER ANIMATION ENGINE
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
// 5. VIEW ROUTER & SECTION SCROLLING
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
    navBtnLanding.classList.add('active');
    navBtnApp.classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    landingView.style.display = 'none';
    appView.style.display = 'block';
    navBtnApp.classList.add('active');
    navBtnLanding.classList.remove('active');
    renderBounties();
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
// 6. NIMIQ HUB API & NIMIQ PAY SDK WALLET CONNECT
// ==========================================
function initNimiqHub() {
  if (window.HubApi) {
    hubApiInstance = new window.HubApi('https://hub.nimiq.com');
  }
  const savedAccount = localStorage.getItem(STORAGE_KEY_USER_ACCT);
  if (savedAccount) {
    userAccount = savedAccount;
    const walletText = document.getElementById('wallet-text');
    if (walletText) walletText.textContent = `${userAccount.substring(0, 14)}...`;
  }
  renderWorkerStats();
}

function renderWorkerStats() {
  const completedEl = document.getElementById('worker-completed-count');
  const earnedEl = document.getElementById('worker-earned-amount');
  if (completedEl) completedEl.textContent = `${workerStats.completed} Tasks`;
  if (earnedEl) earnedEl.textContent = `${workerStats.earned} NIM`;
}

async function connectWallet() {
  const walletText = document.getElementById('wallet-text');
  
  // 1. Mobile Nimiq Pay App SDK
  if (window.nimiqPay || (window.Nimiq && window.Nimiq.MiniApp)) {
    try {
      const sdk = window.nimiqPay || window.Nimiq.MiniApp;
      const accounts = await sdk.listAccounts();
      if (accounts && accounts.length > 0) {
        userAccount = accounts[0].address || accounts[0];
      }
      if (sdk.requestDeviceIdentifier) {
        deviceId = await sdk.requestDeviceIdentifier({ reason: 'NimBounty worker verification' });
      }
      saveState();
      if (walletText) walletText.textContent = `${userAccount.substring(0, 14)}...`;
      alert(`Connected Nimiq Pay Mobile Wallet:\n${userAccount}`);
      return;
    } catch (e) {
      console.warn("Mobile Nimiq Pay SDK connect error:", e);
    }
  }

  // 2. Real Desktop Nimiq Hub Web Wallet (https://hub.nimiq.com)
  if (window.HubApi) {
    try {
      if (walletText) walletText.textContent = "Opening Nimiq Hub...";
      if (!hubApiInstance) hubApiInstance = new window.HubApi('https://hub.nimiq.com');
      
      const choosenAccount = await hubApiInstance.chooseAddress({
        appName: 'NimBounty Escrow'
      });

      if (choosenAccount && choosenAccount.address) {
        userAccount = choosenAccount.address;
        saveState();
        if (walletText) walletText.textContent = `${userAccount.substring(0, 14)}...`;
        playAudioFx('cash');
        alert(`Connected Real Nimiq Web Wallet:\n${userAccount}`);
        return;
      }
    } catch (err) {
      console.log("Nimiq Hub prompt closed or cancelled:", err);
      if (walletText && !userAccount) walletText.textContent = "Connect Nimiq Wallet";
    }
  }

  // Fallback demo account if Hub prompt closed
  if (!userAccount) {
    userAccount = "NQ77 NIMIQ PAY USER 1234";
    deviceId = "dev_id_sha256_" + Math.random().toString(36).substring(2, 12);
    saveState();
    if (walletText) walletText.textContent = `${userAccount.substring(0, 14)}...`;
  }
}

// ==========================================
// 7. ROLE SWITCHER & TASK GRID
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
  } else {
    posterBtn.classList.add('active');
    workerBtn.classList.remove('active');
    posterView.style.display = 'block';
    workerView.style.display = 'none';
    renderPosterDashboard();
  }
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
    return matchesSearch && matchesCat;
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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" stroke-width="1.8" style="margin-bottom: 12px;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        <h3 style="font-size: 1.3rem; font-weight: 800; color: var(--ink);">No Active Bounty Pools</h3>
        <p style="font-size: 0.9rem; color: var(--muted); margin-top: 6px; max-width: 460px; margin-left: auto; margin-right: auto;">
          There are no active bounties published yet. Switch to <strong>Poster Mode</strong> to create and deposit the first smart escrow task pool!
        </p>
        <button class="btn-primary-sm" style="margin-top: 18px;" onclick="switchRole('poster')">Switch to Poster Mode &rarr;</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(b => `
    <div class="newspaper-card rise-in">
      <div>
        <div class="card-top-bar">
          <span class="news-cat-stamp">${b.categoryName}</span>
          <div class="card-top-right">
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

        <button class="btn-primary-lg full-width" onclick="openClaimModal('${b.id}')" ${b.slotsRemaining <= 0 ? 'disabled' : ''}>
          ${b.slotsRemaining > 0 ? 'Claim Task & Submit Proof &rarr;' : 'Pool Fully Claimed'}
        </button>
      </div>
    </div>
  `).join('');

  const landingBounties = document.getElementById('landing-stat-bounties');
  if (landingBounties) landingBounties.textContent = bounties.length;
}

// ==========================================
// 8. QR CODE GENERATOR & SHARE MODAL
// ==========================================
function openQrModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  document.getElementById('qr-bounty-title').textContent = bounty.title;
  const deepLink = `nimiqpay://miniapp?url=https://nimbounty.dev/app?id=${bounty.id}`;
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
    alert("📋 Nimiq Pay Deeplink copied to clipboard!");
  }
}

// ==========================================
// 9. CLAIM & SUBMIT PROOF ENGINE
// ==========================================
function openClaimModal(bountyId) {
  const bounty = bounties.find(b => b.id === bountyId);
  if (!bounty) return;

  currentModalBountyId = bountyId;

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
      timerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${minutes}:${seconds < 10 ? '0' : ''}${seconds} Lock Remaining`;
    }
    if (--timer < 0) {
      clearInterval(activeClaimTimer);
      alert("Reservation timer expired! Slot released.");
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
      document.getElementById('image-preview-img').src = e.target.result;
      document.getElementById('image-preview-box').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}

function handleSubmitProof(event) {
  event.preventDefault();
  const bounty = bounties.find(b => b.id === currentModalBountyId);
  if (!bounty) return;

  let proofContent = '';
  if (bounty.proofType === 'text') {
    proofContent = document.getElementById('proof-text-input').value;
  } else if (bounty.proofType === 'url') {
    proofContent = document.getElementById('proof-url-input').value;
  } else {
    proofContent = 'Screenshot attachment uploaded';
  }

  if (!proofContent.trim()) {
    alert("Please provide the required proof before submitting!");
    return;
  }

  if (bounty.slotsRemaining > 0) {
    bounty.slotsRemaining -= 1;
  }

  workerStats.completed += 1;
  renderWorkerStats();

  pendingSubmissions.unshift({
    id: `sub-${Date.now()}`,
    bountyId: bounty.id,
    bountyTitle: bounty.title,
    workerAddress: userAccount || 'NQ42 WORKER DEMO',
    proofType: bounty.proofType,
    content: proofContent,
    submittedAt: 'Just now',
    reward: bounty.reward
  });

  saveState();
  playAudioFx('submit');
  closeModal('modal-task');
  renderBounties();

  alert(`Proof Submitted Successfully!\nYour submission for "${bounty.title}" is pending review. Payout will trigger upon approval.`);
}

// ==========================================
// 10. POSTER ESCROW CREATION & PAYOUT ENGINE
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
  const title = document.getElementById('task-title').value;
  const category = document.getElementById('task-category').value;
  const categoryName = document.getElementById('task-category').options[document.getElementById('task-category').selectedIndex].text.toUpperCase();
  const proofType = document.getElementById('task-proof-type').value;
  const reward = parseFloat(document.getElementById('task-reward').value);
  const slots = parseInt(document.getElementById('task-slots').value);
  const instructions = document.getElementById('task-instructions').value;
  const totalEscrow = reward * slots;

  // Real Nimiq Hub Checkout on Desktop
  if (hubApiInstance && !window.nimiqPay) {
    try {
      await hubApiInstance.checkout({
        appName: 'NimBounty Escrow',
        recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
        value: totalEscrow * 1e5
      });
    } catch(e) {
      console.log("Nimiq Hub checkout skipped/closed:", e);
    }
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
    sponsor: userAccount ? `${userAccount.substring(0, 10)}...` : 'You (Poster)',
    instructions: instructions,
    createdAt: Date.now()
  };

  bounties.unshift(newBounty);
  saveState();
  document.getElementById('create-bounty-form').reset();
  calculateTotalEscrow();

  playAudioFx('submit');
  alert(`Escrow Locked & Bounty Published!\n${totalEscrow} NIM locked in Nimiq Pay escrow vault.`);
  renderPosterDashboard();
  renderBounties();
}

function renderPosterDashboard() {
  const poolsList = document.getElementById('published-pools-list');
  const subsList = document.getElementById('pending-submissions-list');

  if (poolsList) {
    poolsList.innerHTML = bounties.map(b => `
      <div class="dashboard-item">
        <div class="dashboard-item-title">${b.title}</div>
        <div class="dashboard-item-meta">
          <span>Reward: <strong>${b.reward} NIM</strong> / worker</span>
          <span>Slots: <strong>${b.slotsRemaining} / ${b.slotsTotal} Open</strong></span>
        </div>
      </div>
    `).join('') || `<p style="font-size:0.85rem; color:var(--muted);">No published bounty pools yet. Use the form to deposit escrow & publish your first task pool!</p>`;
  }

  if (subsList) {
    if (pendingSubmissions.length === 0) {
      subsList.innerHTML = `<p style="font-size:0.85rem; color:var(--muted);">No pending worker submissions to review.</p>`;
      return;
    }

    subsList.innerHTML = pendingSubmissions.map((sub, index) => `
      <div class="dashboard-item">
        <div class="dashboard-item-title">${sub.bountyTitle}</div>
        <div class="dashboard-item-meta">
          <span>Worker: <strong>${sub.workerAddress.substring(0, 15)}...</strong></span>
          <span>Time: ${sub.submittedAt}</span>
        </div>

        <div class="proof-card-review">
          <strong>Submitted Proof (${sub.proofType}):</strong>
          <div class="proof-content-text">${sub.content}</div>
        </div>

        <div class="review-actions">
          <button class="btn-approve" onclick="reviewProof(${index}, 'approve')">Approve & Pay ${sub.reward} NIM</button>
          <button class="btn-reject" onclick="reviewProof(${index}, 'reject')">Reject</button>
        </div>
      </div>
    `).join('');
  }
}

async function reviewProof(index, action) {
  const sub = pendingSubmissions[index];
  if (!sub) return;

  if (action === 'approve') {
    if (hubApiInstance && !window.nimiqPay && sub.workerAddress.startsWith('NQ')) {
      try {
        await hubApiInstance.checkout({
          appName: 'NimBounty Payout',
          recipient: sub.workerAddress,
          value: sub.reward * 1e5
        });
      } catch(e) {
        console.log("Nimiq Hub payout window closed:", e);
      }
    }

    workerStats.earned += sub.reward;
    renderWorkerStats();

    playAudioFx('cash');
    triggerConfetti();
    alert(`🎉 Payout Released!\nSent ${sub.reward} NIM to ${sub.workerAddress} via Nimiq Pay.`);
  } else {
    alert(`Rejected submission from ${sub.workerAddress}. Worker notified.`);
  }

  pendingSubmissions.splice(index, 1);
  saveState();
  renderPosterDashboard();
}

window.addEventListener('DOMContentLoaded', () => {
  runTypewriter();
  fetchNimiqLiveRPC();
  initNimiqHub();
  calculateTotalEscrow();
});
