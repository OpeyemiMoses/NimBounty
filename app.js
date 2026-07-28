/**
 * NimBounty Engine — HatchAI Gold Architecture
 */

let currentView = 'landing';
let currentRole = 'worker';
let userAccount = null;
let deviceId = null;
let workerStats = {
  completed: 5,
  earned: 350,
  activeClaims: 0,
  reputation: 98
};

// Seed Data for Bounties
let bounties = [
  {
    id: 'b1',
    title: 'Test Nimiq Mini App & Write 3 Feedback Points',
    category: 'app-test',
    categoryName: 'APP TESTING',
    proofType: 'text',
    reward: 50,
    slotsTotal: 10,
    slotsRemaining: 8,
    sponsor: 'Nimiq Dev Team',
    instructions: 'Open our Nimiq Pay test app at https://nimiq.dev, navigate through the payment flow, and provide 3 clear points on what felt fast and what could be improved.',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'b2',
    title: 'Review NimBounty Console UI & Rate Experience',
    category: 'feedback',
    categoryName: 'UI/UX FEEDBACK',
    proofType: 'text',
    reward: 25,
    slotsTotal: 15,
    slotsRemaining: 14,
    sponsor: 'Design Studio',
    instructions: 'Check out the console app layout, typewriter animation, and fonts. Rate the design from 1 to 10 and mention your favorite feature.',
    createdAt: Date.now() - 7200000
  },
  {
    id: 'b3',
    title: 'Share Nimiq Mini Apps Competition Launch',
    category: 'social',
    categoryName: 'SOCIAL SHARE',
    proofType: 'url',
    reward: 30,
    slotsTotal: 20,
    slotsRemaining: 4,
    sponsor: 'MiniApp Competition',
    instructions: 'Post a tweet introducing the Nimiq Mini Apps Competition with hashtag #NimiqMiniApps and paste your tweet link as proof.',
    createdAt: Date.now() - 10800000
  },
  {
    id: 'b4',
    title: 'Bug Hunt: Test Mobile WebView Checkout Flow',
    category: 'bug',
    categoryName: 'BUG HUNT',
    proofType: 'image',
    reward: 100,
    slotsTotal: 5,
    slotsRemaining: 2,
    sponsor: 'Nimiq Ecosystem',
    instructions: 'Perform a checkout test in Nimiq Pay WebView on iOS or Android. Upload a screenshot showing the transaction confirmation dialog.',
    createdAt: Date.now() - 14400000
  },
  {
    id: 'b5',
    title: 'Translate 4 Mini App UI Strings into Spanish',
    category: 'copy',
    categoryName: 'TRANSLATION',
    proofType: 'text',
    reward: 60,
    slotsTotal: 5,
    slotsRemaining: 5,
    sponsor: 'Global Nimiq',
    instructions: 'Translate the following strings into Spanish: 1. "Connect Wallet", 2. "Lock Escrow", 3. "Task Submitted", 4. "Instant Payout Released".',
    createdAt: Date.now() - 18000000
  }
];

// Pending Proof Submissions Queue for Poster Review
let pendingSubmissions = [
  {
    id: 'sub-1',
    bountyId: 'b1',
    bountyTitle: 'Test Nimiq Mini App & Write 3 Feedback Points',
    workerAddress: 'NQ42 NIMIQ WORKER 7890',
    proofType: 'text',
    content: '1. Onboarding took 11 seconds (super fast).\n2. Payment pop-up styling is clean.\n3. Would love a dark mode toggle!',
    submittedAt: '10 mins ago',
    reward: 50
  }
];

let activeClaimTimer = null;
let currentModalBountyId = null;

// SVG Lightning Bolt Icon Template
const boltSvgIcon = `<svg class="bolt-icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

// ==========================================
// 1. TYPEWRITER ANIMATION (HatchAI Gold Style)
// ==========================================
const typewriterPhrases = ["fast", "safe", "direct", "onchain", "instant"];
let phraseIndex = 0;
let charIndex = 4;
let isDeleting = true;
const typewriterSpeed = 120;
const typewriterDeleteSpeed = 70;
const typewriterDelay = 2200;

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

  let timeout = isDeleting ? typewriterDeleteSpeed : typewriterSpeed;

  if (!isDeleting && charIndex === currentPhrase.length) {
    timeout = typewriterDelay;
    isDeleting = true;
  } else if (isDeleting && charIndex === 0) {
    isDeleting = false;
    phraseIndex = (phraseIndex + 1) % typewriterPhrases.length;
    timeout = 400;
  }

  setTimeout(runTypewriter, timeout);
}

// ==========================================
// 2. VIEW & SECTION SWITCHER
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

// ==========================================
// 3. FAQ ACCORDION TOGGLE
// ==========================================
function toggleFaq(buttonEl) {
  const faqItem = buttonEl.closest('.faq-item');
  if (!faqItem) return;

  const isOpen = faqItem.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(item => item.classList.remove('open'));

  if (!isOpen) {
    faqItem.classList.add('open');
  }
}

// ==========================================
// 4. SDK & WALLET INTEGRATION
// ==========================================
async function initNimiqSDK() {
  const walletText = document.getElementById('wallet-text');
  try {
    if (window.nimiqPay || window.Nimiq) {
      walletText.textContent = "Connecting Nimiq Pay...";
    }
    userAccount = "NQ77 NIMIQ PAY USER 1234";
    deviceId = "dev_id_sha256_" + Math.random().toString(36).substring(2, 12);
    walletText.textContent = `${userAccount.substring(0, 14)}...`;
  } catch (err) {
    userAccount = "NQ77 DEMO WALLET";
    walletText.textContent = userAccount;
  }
}

function connectWallet() {
  if (userAccount) {
    alert(`Connected to Nimiq Pay Wallet:\n${userAccount}\nDevice ID: ${deviceId || 'Verified'}`);
  } else {
    initNimiqSDK();
  }
}

// ==========================================
// 5. ROLE SWITCHER & RENDER ENGINE
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
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: var(--card); border: 1px solid var(--border); border-radius: 16px;">
        <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--muted);">No bounties match your search</h3>
        <p style="font-size: 0.85rem; color: var(--muted); margin-top: 6px;">Try selecting another category or clear your search query.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(b => `
    <div class="newspaper-card rise-in">
      <div>
        <div class="card-top-bar">
          <span class="news-cat-stamp">${b.categoryName}</span>
          <span class="reward-stamp">${boltSvgIcon} ${b.reward} NIM</span>
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
// 6. MODAL & CLAIM ENGINE
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
  document.getElementById('worker-completed-count').textContent = `${workerStats.completed} Tasks`;

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

  closeModal('modal-task');
  renderBounties();

  alert(`Proof Submitted Successfully!\nYour submission for "${bounty.title}" is pending review. Payout will trigger upon approval.`);
}

// ==========================================
// 7. POSTER CREATION & DASHBOARD ENGINE
// ==========================================
function calculateTotalEscrow() {
  const reward = parseFloat(document.getElementById('task-reward')?.value || 0);
  const slots = parseInt(document.getElementById('task-slots')?.value || 0);
  const total = reward * slots;

  document.getElementById('calc-single').textContent = `${reward} NIM`;
  document.getElementById('calc-slots-count').textContent = slots;
  document.getElementById('calc-total').textContent = `${total} NIM`;
}

function handleCreateBounty(event) {
  event.preventDefault();

  const title = document.getElementById('task-title').value;
  const category = document.getElementById('task-category').value;
  const categoryName = document.getElementById('task-category').options[document.getElementById('task-category').selectedIndex].text.toUpperCase();
  const proofType = document.getElementById('task-proof-type').value;
  const reward = parseFloat(document.getElementById('task-reward').value);
  const slots = parseInt(document.getElementById('task-slots').value);
  const instructions = document.getElementById('task-instructions').value;

  const newBounty = {
    id: `b-${Date.now()}`,
    title: title,
    category: category,
    categoryName: categoryName,
    proofType: proofType,
    reward: reward,
    slotsTotal: slots,
    slotsRemaining: slots,
    sponsor: 'You (Poster)',
    instructions: instructions,
    createdAt: Date.now()
  };

  bounties.unshift(newBounty);
  document.getElementById('create-bounty-form').reset();
  calculateTotalEscrow();

  alert(`Escrow Locked & Bounty Published!\n${reward * slots} NIM locked in Nimiq Pay escrow vault. Workers can now claim your task.`);

  renderPosterDashboard();
}

function renderPosterDashboard() {
  const poolsList = document.getElementById('published-pools-list');
  const subsList = document.getElementById('pending-submissions-list');

  if (poolsList) {
    poolsList.innerHTML = bounties.filter(b => b.sponsor === 'You (Poster)' || b.sponsor === 'Nimiq Dev Team').map(b => `
      <div class="dashboard-item">
        <div class="dashboard-item-title">${b.title}</div>
        <div class="dashboard-item-meta">
          <span>Reward: <strong>${b.reward} NIM</strong> / worker</span>
          <span>Slots: <strong>${b.slotsRemaining} / ${b.slotsTotal} Open</strong></span>
        </div>
      </div>
    `).join('') || `<p style="font-size:0.85rem; color:var(--muted);">No published bounty pools yet.</p>`;
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

function reviewProof(index, action) {
  const sub = pendingSubmissions[index];
  if (!sub) return;

  if (action === 'approve') {
    workerStats.earned += sub.reward;
    document.getElementById('worker-earned-amount').textContent = `${workerStats.earned} NIM`;
    alert(`Payout Released!\nSent ${sub.reward} NIM to ${sub.workerAddress} via Nimiq Pay.`);
  } else {
    alert(`Rejected submission from ${sub.workerAddress}. Worker notified.`);
  }

  pendingSubmissions.splice(index, 1);
  renderPosterDashboard();
}

window.addEventListener('DOMContentLoaded', () => {
  runTypewriter();
  initNimiqSDK();
  calculateTotalEscrow();
});
