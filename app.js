/* =============================================
   PARTY PAYMENT SCANNER - app.js
   Firebase Realtime Database Edition
   Data is shared across ALL devices in real time.
   ============================================= */

'use strict';

// ─── FIREBASE CONFIG STORAGE KEY ────────────────
const FB_CONFIG_KEY = 'party_scanner_fb_config';

// ─── DOM: SETUP SCREEN ──────────────────────────
const setupScreen       = document.getElementById('setup-screen');
const appRoot           = document.getElementById('app-root');
const fbConfigInput     = document.getElementById('firebase-config-input');
const btnSaveConfig     = document.getElementById('btn-save-config');
const configError       = document.getElementById('config-error');

// ─── DOM: APP ───────────────────────────────────
const statCount         = document.getElementById('stat-count');
const statTotal         = document.getElementById('stat-total');
const statAvg           = document.getElementById('stat-avg');
const recordBadge       = document.getElementById('record-badge');
const recordsTbody      = document.getElementById('records-tbody');
const emptyRow          = document.getElementById('empty-row');
const searchInput       = document.getElementById('search-input');
const btnToggleScanner  = document.getElementById('btn-toggle-scanner');
const scannerWrapper    = document.getElementById('scanner-wrapper');
const paymentModal      = document.getElementById('payment-modal');
const modalQrData       = document.getElementById('modal-qr-data');
const inputName         = document.getElementById('input-name');
const inputAmount       = document.getElementById('input-amount');
const inputNotes        = document.getElementById('input-notes');
const btnModalCancel    = document.getElementById('btn-modal-cancel');
const btnModalSave      = document.getElementById('btn-modal-save');
const manualModal       = document.getElementById('manual-modal');
const btnShowManual     = document.getElementById('btn-show-manual');
const manualName        = document.getElementById('manual-name');
const manualAmount      = document.getElementById('manual-amount');
const manualQr          = document.getElementById('manual-qr');
const manualNotes       = document.getElementById('manual-notes');
const btnManualCancel   = document.getElementById('btn-manual-cancel');
const btnManualSave     = document.getElementById('btn-manual-save');
const deleteModal       = document.getElementById('delete-modal');
const btnDeleteCancel   = document.getElementById('btn-delete-cancel');
const btnDeleteConfirm  = document.getElementById('btn-delete-confirm');
const btnExport         = document.getElementById('btn-export');
const toast             = document.getElementById('toast');

// ─── STATE ──────────────────────────────────────
let records        = [];   // local mirror of Firebase data
let scanner        = null;
let scannerRunning = false;
let pendingQrData  = null;
let deleteTargetId = null;
let dbRef          = null; // Firebase database reference

// ════════════════════════════════════════════════
//  FIREBASE SETUP
// ════════════════════════════════════════════════
function getSavedConfig() {
  try {
    const raw = localStorage.getItem(FB_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function initFirebase(config) {
  // Initialise Firebase app (only once)
  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }

  // Get reference to the "payments" node
  dbRef = firebase.database().ref('payments');

  // ── Real-time listener: fires on load AND on any change ──
  dbRef.on('value', snapshot => {
    const data = snapshot.val();
    if (data) {
      records = Object.entries(data).map(([key, val]) => ({ ...val, _fbKey: key }));
      records.sort((a, b) => new Date(a.time) - new Date(b.time));
    } else {
      records = [];
    }
    updateStats();
    renderTable(searchInput.value);
  });
}

// ─── Save Config Button ─────────────────────────
btnSaveConfig.addEventListener('click', () => {
  configError.textContent = '';
  const raw = fbConfigInput.value.trim();
  if (!raw) { configError.textContent = '⚠️ Please paste your Firebase config.'; return; }
  let config;
  try { config = JSON.parse(raw); } catch {
    configError.textContent = '❌ Invalid JSON. Copy the config exactly from Firebase.';
    return;
  }
  if (!config.databaseURL) {
    configError.textContent = '❌ Missing "databaseURL". Make sure you created a Realtime Database and copied the full config.';
    return;
  }
  try {
    localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(config));
    startApp(config);
  } catch (e) {
    configError.textContent = '❌ Firebase error: ' + e.message;
  }
});

function startApp(config) {
  try {
    initFirebase(config);
    setupScreen.style.display = 'none';
    appRoot.style.display = 'block';
    showToast('🔥 Connected to Firebase!', 'success');
    wireUpApp();
  } catch (e) {
    configError.textContent = '❌ ' + e.message;
    localStorage.removeItem(FB_CONFIG_KEY); // clear bad config
  }
}

// ════════════════════════════════════════════════
//  FIREBASE DATA OPERATIONS
// ════════════════════════════════════════════════
function saveRecord(rec) {
  // Push creates a unique Firebase key
  dbRef.push(rec);
}

function deleteRecord(fbKey) {
  dbRef.child(fbKey).remove();
}

// ════════════════════════════════════════════════
//  STATS
// ════════════════════════════════════════════════
function updateStats() {
  const count = records.length;
  const total = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const avg   = count > 0 ? Math.round(total / count) : 0;
  statCount.textContent = count;
  statTotal.textContent = 'Rs ' + total.toLocaleString();
  statAvg.textContent   = 'Rs ' + avg.toLocaleString();
  recordBadge.textContent = `${count} record${count !== 1 ? 's' : ''}`;
}

// ════════════════════════════════════════════════
//  RENDER TABLE
// ════════════════════════════════════════════════
function renderTable(filterText = '') {
  const query    = filterText.trim().toLowerCase();
  const filtered = query ? records.filter(r => r.name.toLowerCase().includes(query)) : records;

  const existing = recordsTbody.querySelectorAll('tr:not(#empty-row)');
  existing.forEach(r => r.remove());

  if (filtered.length === 0) {
    emptyRow.style.display = '';
    return;
  }
  emptyRow.style.display = 'none';

  [...filtered].reverse().forEach((rec, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.fbKey = rec._fbKey;
    tr.innerHTML = `
      <td>${filtered.length - idx}</td>
      <td class="td-name">${escHtml(rec.name || '—')}</td>
      <td class="td-amount">Rs ${Number(rec.amount || 0).toLocaleString()}</td>
      <td class="td-qr" title="${escHtml(rec.qrData || '')}">${escHtml(truncate(rec.qrData || 'Manual', 20))}</td>
      <td class="td-time">${formatTime(rec.time)}</td>
      <td><button class="btn-del" data-fbkey="${rec._fbKey}">🗑️ Del</button></td>
    `;
    recordsTbody.appendChild(tr);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
       + ' · ' + d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
}

// ════════════════════════════════════════════════
//  WIRE UP ALL APP LOGIC (called after Firebase ready)
// ════════════════════════════════════════════════
function wireUpApp() {

  // ─── QR SCANNER ───────────────────────────────
  async function startScanner() {
    try {
      scanner = new Html5Qrcode('reader');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        onQrSuccess,
        () => {}
      );
      scannerRunning = true;
      scannerWrapper.classList.add('visible');
      btnToggleScanner.textContent = '⏹ Stop Scanner';
      btnToggleScanner.classList.add('active');
      showToast('📷 Scanner started', 'success');
    } catch (err) {
      showToast('❌ Camera error: ' + (err.message || 'Permission denied'), 'error');
      scannerRunning = false;
    }
  }

  async function stopScanner() {
    if (scanner && scannerRunning) {
      try { await scanner.stop(); scanner.clear(); } catch {}
    }
    scanner = null;
    scannerRunning = false;
    scannerWrapper.classList.remove('visible');
    btnToggleScanner.textContent = 'Start Scanning';
    btnToggleScanner.classList.remove('active');
  }

  function onQrSuccess(decodedText) {
    if (scanner && scannerRunning) { try { scanner.pause(true); } catch {} }
    openPaymentModal(decodedText);
  }

  btnToggleScanner.addEventListener('click', async () => {
    scannerRunning ? await stopScanner() : await startScanner();
  });

  // ─── PAYMENT MODAL ────────────────────────────
  function openPaymentModal(qrData) {
    pendingQrData = qrData;
    modalQrData.textContent = 'QR: ' + truncate(qrData, 60);
    inputName.value = ''; inputAmount.value = ''; inputNotes.value = '';
    paymentModal.classList.add('open');
    setTimeout(() => inputName.focus(), 300);
  }
  function closePaymentModal() {
    paymentModal.classList.remove('open');
    pendingQrData = null;
    if (scanner && scannerRunning) { try { scanner.resume(); } catch {} }
  }
  btnModalCancel.addEventListener('click', closePaymentModal);
  paymentModal.addEventListener('click', e => { if (e.target === paymentModal) closePaymentModal(); });

  btnModalSave.addEventListener('click', () => {
    const name = inputName.value.trim();
    const amount = inputAmount.value;
    if (!name)   { shake(inputName);   showToast('⚠️ Please enter a name', 'error'); return; }
    if (!amount || isNaN(Number(amount))) { shake(inputAmount); showToast('⚠️ Please enter a valid amount', 'error'); return; }
    saveRecord({ name, amount: Number(amount), qrData: pendingQrData || '', notes: inputNotes.value.trim(), time: new Date().toISOString() });
    showToast(`✅ Saved: ${name} — Rs ${Number(amount).toLocaleString()}`, 'success');
    closePaymentModal();
  });
  [inputName, inputAmount, inputNotes].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') btnModalSave.click(); }));

  // ─── MANUAL MODAL ─────────────────────────────
  btnShowManual.addEventListener('click', () => {
    manualName.value = ''; manualAmount.value = ''; manualQr.value = ''; manualNotes.value = '';
    manualModal.classList.add('open');
    setTimeout(() => manualName.focus(), 300);
  });
  function closeManualModal() { manualModal.classList.remove('open'); }
  btnManualCancel.addEventListener('click', closeManualModal);
  manualModal.addEventListener('click', e => { if (e.target === manualModal) closeManualModal(); });

  btnManualSave.addEventListener('click', () => {
    const name = manualName.value.trim();
    const amount = manualAmount.value;
    if (!name)   { shake(manualName);   showToast('⚠️ Please enter a name', 'error'); return; }
    if (!amount || isNaN(Number(amount))) { shake(manualAmount); showToast('⚠️ Please enter a valid amount', 'error'); return; }
    saveRecord({ name, amount: Number(amount), qrData: manualQr.value.trim() || 'Manual', notes: manualNotes.value.trim(), time: new Date().toISOString() });
    showToast(`✅ Saved: ${name}`, 'success');
    closeManualModal();
  });
  [manualName, manualAmount, manualQr, manualNotes].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') btnManualSave.click(); }));

  // ─── DELETE ───────────────────────────────────
  recordsTbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-fbkey]');
    if (!btn) return;
    deleteTargetId = btn.dataset.fbkey;
    deleteModal.classList.add('open');
  });
  btnDeleteCancel.addEventListener('click', () => { deleteModal.classList.remove('open'); deleteTargetId = null; });
  deleteModal.addEventListener('click', e => { if (e.target === deleteModal) { deleteModal.classList.remove('open'); deleteTargetId = null; } });
  btnDeleteConfirm.addEventListener('click', () => {
    if (deleteTargetId) { deleteRecord(deleteTargetId); showToast('🗑️ Record deleted', 'error'); }
    deleteModal.classList.remove('open'); deleteTargetId = null;
  });

  // ─── SEARCH ───────────────────────────────────
  searchInput.addEventListener('input', () => renderTable(searchInput.value));

  // ─── EXPORT TO EXCEL ──────────────────────────
  btnExport.addEventListener('click', () => {
    if (records.length === 0) { showToast('⚠️ No records to export', 'error'); return; }
    const data = [['#', 'Name', 'Amount (Rs)', 'QR / Reference', 'Notes', 'Date', 'Time']];
    records.forEach((r, i) => {
      const d = new Date(r.time);
      data.push([i + 1, r.name, r.amount, r.qrData || '', r.notes || '', d.toLocaleDateString('en-PK'), d.toLocaleTimeString('en-PK')]);
    });
    const total = records.reduce((s, r) => s + (r.amount || 0), 0);
    data.push([], ['', 'TOTAL', total, '', '', '', ''], ['', 'COUNT', records.length, '', '', '', '']);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 15 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Party Payments');
    const now = new Date();
    XLSX.writeFile(wb, `Party_Payments_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.xlsx`);
    showToast('📊 Excel file downloaded!', 'success');
  });
}

// ════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════
let toastTimer = null;
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}
function shake(el) {
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}
const shakeStyle = document.createElement('style');
shakeStyle.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}';
document.head.appendChild(shakeStyle);

// ════════════════════════════════════════════════
//  INIT — check if config exists, else show setup
// ════════════════════════════════════════════════
const savedConfig = getSavedConfig();
if (savedConfig && savedConfig.databaseURL) {
  startApp(savedConfig);
} else {
  setupScreen.style.display = 'flex';
  appRoot.style.display = 'none';
}
