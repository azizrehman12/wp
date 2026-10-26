/* =============================================
   PARTY PAYMENT SCANNER - app.js
   ============================================= */

'use strict';

// ─── STATE ──────────────────────────────────────
const STORAGE_KEY = 'party_scanner_records';
let records = [];          // Array of { id, name, amount, qrData, notes, time }
let scanner = null;        // Html5Qrcode instance
let scannerRunning = false;
let pendingQrData = null;  // QR data waiting for user to fill the form
let deleteTargetId = null; // ID to delete

// ─── DOM REFS ───────────────────────────────────
const statCount        = document.getElementById('stat-count');
const statTotal        = document.getElementById('stat-total');
const statAvg          = document.getElementById('stat-avg');
const recordBadge      = document.getElementById('record-badge');
const recordsTbody     = document.getElementById('records-tbody');
const emptyRow         = document.getElementById('empty-row');
const searchInput      = document.getElementById('search-input');

const btnToggleScanner = document.getElementById('btn-toggle-scanner');
const scannerWrapper   = document.getElementById('scanner-wrapper');

// Payment modal (after QR scan)
const paymentModal     = document.getElementById('payment-modal');
const modalQrData      = document.getElementById('modal-qr-data');
const inputName        = document.getElementById('input-name');
const inputAmount      = document.getElementById('input-amount');
const inputNotes       = document.getElementById('input-notes');
const btnModalCancel   = document.getElementById('btn-modal-cancel');
const btnModalSave     = document.getElementById('btn-modal-save');

// Manual modal
const manualModal      = document.getElementById('manual-modal');
const btnShowManual    = document.getElementById('btn-show-manual');
const manualName       = document.getElementById('manual-name');
const manualAmount     = document.getElementById('manual-amount');
const manualQr         = document.getElementById('manual-qr');
const manualNotes      = document.getElementById('manual-notes');
const btnManualCancel  = document.getElementById('btn-manual-cancel');
const btnManualSave    = document.getElementById('btn-manual-save');

// Delete modal
const deleteModal      = document.getElementById('delete-modal');
const btnDeleteCancel  = document.getElementById('btn-delete-cancel');
const btnDeleteConfirm = document.getElementById('btn-delete-confirm');

const btnExport        = document.getElementById('btn-export');
const toast            = document.getElementById('toast');

// ─── STORAGE (IndexedDB primary + localStorage fallback) ────
// IndexedDB works 100% with file:// protocol and NEVER resets on refresh.
const DB_NAME    = 'PartyScanner';
const DB_VERSION = 1;
const STORE_NAME = 'records';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function saveData() {
  if (db) {
    // Primary: IndexedDB
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    records.forEach(r => store.put(r));
  }
  // Fallback: localStorage (best-effort)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
}

function loadData() {
  return new Promise(resolve => {
    if (db) {
      // Primary: read from IndexedDB
      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.getAll();
      req.onsuccess = e => {
        const idbData = e.target.result || [];
        if (idbData.length > 0) {
          records = idbData.sort((a, b) => new Date(a.time) - new Date(b.time));
          resolve();
        } else {
          // IndexedDB empty — try localStorage fallback (migration)
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            records = raw ? JSON.parse(raw) : [];
            // Migrate into IndexedDB
            if (records.length > 0) saveData();
          } catch { records = []; }
          resolve();
        }
      };
      req.onerror = () => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          records = raw ? JSON.parse(raw) : [];
        } catch { records = []; }
        resolve();
      };
    } else {
      // No IndexedDB — localStorage only
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        records = raw ? JSON.parse(raw) : [];
      } catch { records = []; }
      resolve();
    }
  });
}


// ─── STATS ──────────────────────────────────────
function updateStats() {
  const count = records.length;
  const total = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const avg   = count > 0 ? Math.round(total / count) : 0;

  animateNumber(statCount, count, '', '');
  animateNumber(statTotal, total, 'Rs ', '');
  animateNumber(statAvg,   avg,   'Rs ', '');
  recordBadge.textContent = `${count} record${count !== 1 ? 's' : ''}`;
}

function animateNumber(el, target, prefix = '', suffix = '') {
  const current = parseInt(el.dataset.current || 0, 10);
  el.dataset.current = target;
  const diff = target - current;
  if (diff === 0) { el.textContent = prefix + target.toLocaleString() + suffix; return; }
  const steps = 20;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    const val = Math.round(current + (diff * (step / steps)));
    el.textContent = prefix + val.toLocaleString() + suffix;
    if (step >= steps) {
      clearInterval(timer);
      el.textContent = prefix + target.toLocaleString() + suffix;
    }
  }, 18);
}

// ─── RENDER TABLE ───────────────────────────────
function renderTable(filterText = '') {
  const query = filterText.trim().toLowerCase();
  const filtered = query
    ? records.filter(r => r.name.toLowerCase().includes(query))
    : records;

  // Clear existing rows (keep empty-row hidden)
  const rows = recordsTbody.querySelectorAll('tr:not(#empty-row)');
  rows.forEach(r => r.remove());

  if (filtered.length === 0) {
    emptyRow.style.display = '';
    return;
  }
  emptyRow.style.display = 'none';

  // Render newest first
  [...filtered].reverse().forEach((rec, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.id = rec.id;
    tr.style.animation = `fadeIn 0.3s ease ${idx * 0.04}s both`;
    tr.innerHTML = `
      <td>${filtered.length - idx}</td>
      <td class="td-name">${escHtml(rec.name || '—')}</td>
      <td class="td-amount">Rs ${Number(rec.amount || 0).toLocaleString()}</td>
      <td class="td-qr" title="${escHtml(rec.qrData || '')}">${escHtml(truncate(rec.qrData || 'Manual', 20))}</td>
      <td class="td-time">${formatTime(rec.time)}</td>
      <td><button class="btn-del" data-del="${rec.id}">🗑️ Del</button></td>
    `;
    recordsTbody.appendChild(tr);
  });

  // Add fadeIn keyframe if not already
  if (!document.getElementById('fadeInStyle')) {
    const s = document.createElement('style');
    s.id = 'fadeInStyle';
    s.textContent = '@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }';
    document.head.appendChild(s);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) +
         ' · ' + d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' });
}

// ─── ADD RECORD ─────────────────────────────────
function addRecord({ name, amount, qrData, notes }) {
  const rec = {
    id:     Date.now() + Math.random(),
    name:   name.trim(),
    amount: Number(amount) || 0,
    qrData: (qrData || '').trim(),
    notes:  (notes || '').trim(),
    time:   new Date().toISOString(),
  };
  records.push(rec);
  saveData();
  updateStats();
  renderTable(searchInput.value);
  showToast(`✅ Saved: ${rec.name} — Rs ${rec.amount.toLocaleString()}`, 'success');
}

// ─── QR SCANNER ─────────────────────────────────
async function startScanner() {
  try {
    scanner = new Html5Qrcode('reader');

    const config = {
      fps: 12,
      qrbox: { width: 220, height: 220 },
      aspectRatio: 1.0,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };

    await scanner.start(
      { facingMode: 'environment' }, // rear camera
      config,
      onQrSuccess,
      () => {}  // suppress ongoing error logs
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
    try {
      await scanner.stop();
      scanner.clear();
    } catch { /* ignore */ }
  }
  scanner = null;
  scannerRunning = false;
  scannerWrapper.classList.remove('visible');
  btnToggleScanner.textContent = 'Start Scanning';
  btnToggleScanner.classList.remove('active');
}

function onQrSuccess(decodedText) {
  // Pause scanner while modal is open to avoid double-scans
  if (scanner && scannerRunning) {
    scanner.pause(true);
  }
  openPaymentModal(decodedText);
}

btnToggleScanner.addEventListener('click', async () => {
  if (scannerRunning) {
    await stopScanner();
  } else {
    await startScanner();
  }
});

// ─── PAYMENT MODAL (after scan) ─────────────────
function openPaymentModal(qrData) {
  pendingQrData = qrData;
  modalQrData.textContent = 'QR: ' + truncate(qrData, 60);
  inputName.value = '';
  inputAmount.value = '';
  inputNotes.value = '';
  paymentModal.classList.add('open');
  setTimeout(() => inputName.focus(), 300);
}

function closePaymentModal() {
  paymentModal.classList.remove('open');
  pendingQrData = null;
  // Resume scanner
  if (scanner && scannerRunning) {
    try { scanner.resume(); } catch { /* ignore */ }
  }
}

btnModalCancel.addEventListener('click', closePaymentModal);
paymentModal.addEventListener('click', e => { if (e.target === paymentModal) closePaymentModal(); });

btnModalSave.addEventListener('click', () => {
  const name = inputName.value.trim();
  const amount = inputAmount.value;
  if (!name) { shake(inputName); showToast('⚠️ Please enter a name', 'error'); return; }
  if (!amount || isNaN(Number(amount))) { shake(inputAmount); showToast('⚠️ Please enter a valid amount', 'error'); return; }
  addRecord({ name, amount, qrData: pendingQrData, notes: inputNotes.value });
  closePaymentModal();
});

// Enter key in modal
[inputName, inputAmount, inputNotes].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') btnModalSave.click(); });
});

// ─── MANUAL MODAL ───────────────────────────────
btnShowManual.addEventListener('click', () => {
  manualName.value = '';
  manualAmount.value = '';
  manualQr.value = '';
  manualNotes.value = '';
  manualModal.classList.add('open');
  setTimeout(() => manualName.focus(), 300);
});

function closeManualModal() { manualModal.classList.remove('open'); }
btnManualCancel.addEventListener('click', closeManualModal);
manualModal.addEventListener('click', e => { if (e.target === manualModal) closeManualModal(); });

btnManualSave.addEventListener('click', () => {
  const name = manualName.value.trim();
  const amount = manualAmount.value;
  if (!name) { shake(manualName); showToast('⚠️ Please enter a name', 'error'); return; }
  if (!amount || isNaN(Number(amount))) { shake(manualAmount); showToast('⚠️ Please enter a valid amount', 'error'); return; }
  addRecord({ name, amount, qrData: manualQr.value || 'Manual', notes: manualNotes.value });
  closeManualModal();
});

[manualName, manualAmount, manualQr, manualNotes].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') btnManualSave.click(); });
});

// ─── DELETE ─────────────────────────────────────
recordsTbody.addEventListener('click', e => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  deleteTargetId = Number(btn.dataset.del) || btn.dataset.del;
  deleteModal.classList.add('open');
});

btnDeleteCancel.addEventListener('click', () => {
  deleteModal.classList.remove('open');
  deleteTargetId = null;
});
deleteModal.addEventListener('click', e => {
  if (e.target === deleteModal) {
    deleteModal.classList.remove('open');
    deleteTargetId = null;
  }
});
btnDeleteConfirm.addEventListener('click', () => {
  if (deleteTargetId !== null) {
    records = records.filter(r => String(r.id) !== String(deleteTargetId));
    saveData();
    updateStats();
    renderTable(searchInput.value);
    showToast('🗑️ Record deleted', 'error');
  }
  deleteModal.classList.remove('open');
  deleteTargetId = null;
});

// ─── CLEAR ALL ──────────────────────────────────
btnClear.addEventListener('click', () => {
  if (records.length === 0) { showToast('ℹ️ No records to clear', 'error'); return; }
  if (!confirm(`⚠️ Delete ALL ${records.length} records? This cannot be undone.`)) return;
  records = [];
  saveData();
  updateStats();
  renderTable();
  showToast('🗑️ All records cleared', 'error');
});

// ─── SEARCH ─────────────────────────────────────
searchInput.addEventListener('input', () => renderTable(searchInput.value));

// ─── EXPORT TO EXCEL ────────────────────────────
btnExport.addEventListener('click', () => {
  if (records.length === 0) { showToast('⚠️ No records to export', 'error'); return; }

  const data = [
    ['#', 'Name', 'Amount (Rs)', 'QR / Reference', 'Notes', 'Date', 'Time']
  ];
  records.forEach((r, i) => {
    const d = new Date(r.time);
    data.push([
      i + 1,
      r.name,
      r.amount,
      r.qrData || '',
      r.notes || '',
      d.toLocaleDateString('en-PK'),
      d.toLocaleTimeString('en-PK'),
    ]);
  });

  // Summary row
  const total = records.reduce((s, r) => s + (r.amount || 0), 0);
  data.push([]);
  data.push(['', 'TOTAL', total, '', '', '', '']);
  data.push(['', 'COUNT', records.length, '', '', '', '']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths
  ws['!cols'] = [
    { wch: 5 }, { wch: 22 }, { wch: 15 }, { wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 12 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Party Payments');

  const now = new Date();
  const fileName = `Party_Payments_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast('📊 Excel file downloaded!', 'success');
});

// ─── TOAST ──────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ─── SHAKE ANIMATION (validation) ───────────────
function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

if (!document.getElementById('shakeStyle')) {
  const s = document.createElement('style');
  s.id = 'shakeStyle';
  s.textContent = '@keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }';
  document.head.appendChild(s);
}


// ─── INIT ───────────────────────────────────────
(async () => {
  try {
    await openDB();
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage only:', e);
  }
  await loadData();
  updateStats();
  renderTable();
})();

