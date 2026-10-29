/**
 * Studio Rekonsiliasi Jurnal & Penjualan
 * Sistem Verifikasi & Komparasi Pembukuan Mandiri
 * Fitur:
 *  1. Rekonsiliasi Agregasi Label & Kontribusi Gudang (Two-Tier Warehouse Breakdown)
 *  2. Generator Jurnal Seimbang 100% (2 Debit + 1 Kredit Bill Otomatis)
 *  3. Komparasi Komprehensif Jurnal Asli vs Jurnal Seimbang Baru
 *  4. Indikator Loading Nyata di Modal Unggah Berkas
 *  5. Sistem Notifikasi Toast Tanpa Jendela Dialog (Zero window.alert)
 */

// State Store
const state = {
  rawJournalWb: null,
  rawJournalRows: [],
  rawSalesRows: [],
  normalizedJournalRows: [],
  generatedJournalRows: [],
  deletedBills: [],
  reconciliationResults: [],
  comparisonResults: [],
  comparisonFilters: {
    search: '',
    mode: 'ALL'
  },
  expandedRows: new Set(),
  reconcileFilters: {
    search: '',
    status: 'ALL',
    entitas: 'ALL'
  },
  pagination: {
    reconcile: { page: 1, limit: 25 },
    normalized: { page: 1, limit: 25 },
    compare: { page: 1, limit: 25 }
  }
};

// Formatting Utilities
const formatCurrency = (val) => {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
};

const formatNumber = (val) => {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('id-ID').format(num);
};

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Normalisasi Adaptif Label Jurnal
 * Mendukung format lama: "{Partner} {Metode} | {SKU} {Product}"
 * Dan format baru koma: "{Partner} {Date} {Payment} , {SKU} {Product} {Qty} , {Warehouse}"
 */
const cleanJournalLabel = (rawLabel) => {
  let lbl = String(rawLabel || '').trim();
  if (!lbl) return '';

  // 1. Format Baru dengan Koma: "{Partner} {Date} {Payment} , {SKU} {Product} {Qty} , {Warehouse}"
  if (lbl.includes(' , ')) {
    const parts = lbl.split(' , ').map(p => p.trim());
    if (parts.length >= 2) {
      // Bagian kiri: Hapus tanggal DD/MM/YYYY atau YYYY-MM-DD
      const left = parts[0].replace(/\s+\d{2}[/-]\d{2}[/-]\d{4}/g, '').trim();
      // Bagian tengah: Hapus kuantitas di akhir string nama produk (misal: "ETA01 Etawaku x 4" atau "ETA01 Etawaku 1" -> "ETA01 Etawaku")
      const mid = parts[1].replace(/\s+(?:x\s+)?\d+$/i, '').trim();
      return `${left} | ${mid}`.trim();
    }
  }

  // 2. Format Lama dengan Pipe: Bersihkan penanda gudang di akhir jika ada
  lbl = lbl.replace(/\s*\|\s*Jakarta/gi, '')
           .replace(/\s*\|\s*Surabaya/gi, '')
           .trim();

  return lbl;
};

/**
 * Format tanggal pengiriman (Shipped Date) ke standar DD/MM/YYYY
 */
const formatShippedDate = (val) => {
  if (!val) return '';
  if (typeof XLSX !== 'undefined' && XLSX.SSF && typeof val === 'number') {
    const p = XLSX.SSF.parse_date_code(val);
    if (p) {
      const dd = String(p.d).padStart(2, '0');
      const mm = String(p.m).padStart(2, '0');
      return `${dd}/${mm}/${p.y}`;
    }
  }
  if (val instanceof Date) {
    const d = new Date(val.getTime() + 60000);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const s = String(val).trim();
  const matchIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matchIso) {
    const dd = String(matchIso[3]).padStart(2, '0');
    const mm = String(matchIso[2]).padStart(2, '0');
    return `${dd}/${mm}/${matchIso[1]}`;
  }
  const matchDm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (matchDm) {
    const dd = String(matchDm[1]).padStart(2, '0');
    const mm = String(matchDm[2]).padStart(2, '0');
    return `${dd}/${mm}/${matchDm[3]}`;
  }
  return s;
};

// DOM Elements
const el = {
  // Modal & Chips
  modalUpload: document.getElementById('modal-upload'),
  chipJournal: document.getElementById('chip-journal'),
  chipSales: document.getElementById('chip-sales'),
  dotJournal: document.getElementById('dot-journal'),
  dotSales: document.getElementById('dot-sales'),
  valJournal: document.getElementById('val-journal'),
  valSales: document.getElementById('val-sales'),
  btnOpenJournalModal: document.getElementById('btn-open-journal-modal'),
  btnOpenSalesModal: document.getElementById('btn-open-sales-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalDone: document.getElementById('btn-modal-done'),

  // Dropzones & In-Modal Loaders
  dropJournal: document.getElementById('dropzone-journal'),
  dropSales: document.getElementById('dropzone-sales'),
  fileJournal: document.getElementById('file-journal'),
  fileSales: document.getElementById('file-sales'),
  badgeJournal: document.getElementById('badge-journal'),
  badgeSales: document.getElementById('badge-sales'),
  progressJournal: document.getElementById('progress-journal'),
  progressSales: document.getElementById('progress-sales'),
  btnPickJournal: document.getElementById('btn-pick-journal'),
  btnPickSales: document.getElementById('btn-pick-sales'),

  // Action Buttons
  btnProcessAll: document.getElementById('btn-process-all'),
  btnMoreOptions: document.getElementById('btn-more-options'),
  dropdownMenu: document.getElementById('dropdown-menu'),
  btnGenerateJournal: document.getElementById('btn-generate-journal'),
  btnResetAll: document.getElementById('btn-reset-all'),
  btnExportReconcile: document.getElementById('btn-export-reconcile'),
  btnExportJournal: document.getElementById('btn-export-journal'),
  btnExportGenerated: document.getElementById('btn-export-generated'),

  // Metrics Cockpit
  metricsPanel: document.getElementById('metrics-panel'),
  workspacePanel: document.getElementById('workspace-panel'),
  metricMatchRate: document.getElementById('metric-match-rate'),
  metricMatchCount: document.getElementById('metric-match-count'),
  metricSalesTotal: document.getElementById('metric-sales-total'),
  metricSalesLines: document.getElementById('metric-sales-lines'),
  metricJournalTotal: document.getElementById('metric-journal-total'),
  metricJournalEntries: document.getElementById('metric-journal-entries'),
  metricVariance: document.getElementById('metric-variance'),
  metricDiscrepancyCount: document.getElementById('metric-discrepancy-count'),
  metricDeletedBills: document.getElementById('metric-deleted-bills'),
  metricDeletedRows: document.getElementById('metric-deleted-rows'),

  // Tables & Tabs
  tbodyReconcile: document.getElementById('tbody-reconcile'),
  tbodyNormalized: document.getElementById('tbody-normalized'),
  tbodyDeleted: document.getElementById('tbody-deleted'),
  tbodyCompare: document.getElementById('tbody-compare'),
  tabBtnCompare: document.getElementById('tab-btn-compare'),
  countReconcileTab: document.getElementById('count-reconcile-tab'),
  countJournalTab: document.getElementById('count-journal-tab'),
  countDeletedTab: document.getElementById('count-deleted-tab'),

  // Comparison Stat Elements
  compRowsOld: document.getElementById('comp-rows-old'),
  compRowsNew: document.getElementById('comp-rows-new'),
  compRowsHint: document.getElementById('comp-rows-hint'),
  compOmsetOld: document.getElementById('comp-omset-old'),
  compOmsetNew: document.getElementById('comp-omset-new'),
  compBalanceOld: document.getElementById('comp-balance-old'),
  filterCompareSearch: document.getElementById('filter-compare-search'),
  filterCompareMode: document.getElementById('filter-compare-mode'),

  // Filters & Toast
  filterSearch: document.getElementById('filter-search'),
  filterStatus: document.getElementById('filter-status'),
  filterEntitas: document.getElementById('filter-entitas'),
  toastContainer: document.getElementById('toast-container'),

  // Global Loading
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingTitle: document.getElementById('loading-title'),
  loadingDesc: document.getElementById('loading-desc')
};

// --------------------------------------------------------------------------
// 0. Non-Blocking Toast Notification Center
// --------------------------------------------------------------------------

function showToast(title, message, type = 'info', duration = 4500) {
  const container = el.toastContainer || document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-desc">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" type="button" title="Tutup">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="toast-progress"></div>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 200);
  };

  closeBtn.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
  container.appendChild(toast);
}

// UI Loading Control
function showLoading(title, desc) {
  if (el.loadingTitle) el.loadingTitle.textContent = title || 'Memproses Data...';
  if (el.loadingDesc) el.loadingDesc.textContent = desc || 'Harap tunggu, kalkulasi berjalan di memori browser.';
  if (el.loadingOverlay) el.loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  if (el.loadingOverlay) el.loadingOverlay.style.display = 'none';
}

// Modal Upload Controls
function openUploadModal() {
  if (el.modalUpload) el.modalUpload.style.display = 'flex';
}

function closeUploadModal() {
  if (el.modalUpload) el.modalUpload.style.display = 'none';
}

// --------------------------------------------------------------------------
// 1. File Handling & Parsing (Non-Freezing Async In-Modal Progress)
// --------------------------------------------------------------------------

function setupDropzones() {
  const setupOne = (dropzone, inputEl, onLoaded, type) => {
    if (!dropzone || !inputEl) return;
    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file, type);
    });
    inputEl.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file, type);
    });
  };

  setupOne(el.dropJournal, el.fileJournal, null, 'journal');
  setupOne(el.dropSales, el.fileSales, null, 'sales');
}

function handleFile(file, type) {
  const isJournal = type === 'journal';
  const dropzone = isJournal ? el.dropJournal : el.dropSales;
  const badge = isJournal ? el.badgeJournal : el.badgeSales;
  const progress = isJournal ? el.progressJournal : el.progressSales;
  const btnPick = isJournal ? el.btnPickJournal : el.btnPickSales;

  // 1. Immediate in-modal loading UI (No page freeze!)
  if (dropzone) {
    dropzone.classList.remove('file-loaded');
    dropzone.classList.add('is-loading');
  }
  if (progress) progress.style.display = 'block';
  if (btnPick) btnPick.disabled = true;

  const updateBadge = (msg) => {
    if (badge) {
      badge.innerHTML = `<span style="color:var(--accent-blue); font-weight:600;">${escapeHtml(msg)}</span>`;
    }
  };

  const cleanupUI = () => {
    if (dropzone) dropzone.classList.remove('is-loading');
    if (progress) progress.style.display = 'none';
    if (btnPick) btnPick.disabled = false;
  };

  updateBadge(`Mempersiapkan ${file.name} (${formatFileSize(file.size)})...`);

  const reader = new FileReader();
  reader.onerror = () => {
    showToast('Gagal Membaca Berkas', 'Tidak dapat mengakses berkas lokal.', 'error');
    if (badge) badge.textContent = 'Gagal memproses berkas';
    cleanupUI();
  };

  reader.onload = (e) => {
    const arrayBuffer = e.target.result;

    // Web Worker untuk pemrosesan non-blocking di background thread
    let worker = null;
    try {
      worker = new Worker('excel-worker.js');
    } catch (workerErr) {
      console.warn('Web Worker tidak didukung / diblokir (misal file:// protocol), beralih ke Main Thread:', workerErr);
    }

    if (worker) {
      updateBadge(`Memproses di background worker (${formatFileSize(file.size)})...`);

      worker.onmessage = (event) => {
        const res = event.data;
        if (res.status === 'progress') {
          updateBadge(res.message);
        } else if (res.status === 'done') {
          worker.terminate();
          cleanupUI();
          if (type === 'journal') {
            applyJournalData(res.rows, res.name, res.size);
          } else {
            applySalesData(res.rows, res.name, res.size, res.totalRawRows, res.successRows);
          }
        } else if (res.status === 'error') {
          worker.terminate();
          cleanupUI();
          showToast('Gagal Memproses Berkas', res.message, 'error');
          if (badge) badge.textContent = 'Gagal memproses berkas';
        }
      };

      worker.onerror = (err) => {
        console.warn('Worker runtime error, beralih ke parser main thread:', err);
        worker.terminate();
        runMainThreadParser(arrayBuffer, file, type, updateBadge, cleanupUI);
      };

      // Transfer ArrayBuffer ke worker secara zero-copy
      worker.postMessage({ data: arrayBuffer, type, name: file.name, size: file.size }, [arrayBuffer]);
    } else {
      // Fallback Main Thread
      runMainThreadParser(arrayBuffer, file, type, updateBadge, cleanupUI);
    }
  };

  reader.readAsArrayBuffer(file);
}

function runMainThreadParser(arrayBuffer, file, type, updateBadge, cleanupUI) {
  updateBadge(`Mengekstrak lembar data (${formatFileSize(file.size)})...`);

  setTimeout(() => {
    try {
      const data = new Uint8Array(arrayBuffer);
      const wb = XLSX.read(data, { type: 'array', cellDates: true, dense: true });

      if (type === 'journal') {
        const sheetName = wb.SheetNames.includes('Journal Entry') ? 'Journal Entry' : wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        cleanupUI();
        applyJournalData(rows, file.name, file.size);
      } else {
        const sheetName = wb.SheetNames.includes('Sales')
          ? 'Sales'
          : (wb.SheetNames.includes('Sales Report') ? 'Sales Report' : wb.SheetNames[0]);
        const sheet = wb.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        const totalRaw = rawRows.length - 1;
        const header = (rawRows[0] || []).map(h => String(h || '').trim());

        const neededCols = [
          'Entitas', 'Kanal', 'Group', 'MetodeBayar', 'Warehouse',
          'Code SKU', 'Product Name', 'Totalperline', 'Quantity',
          'Ongkir', 'DiscountOngkir', 'ShippingFee', 'Status', 'Shipped Date'
        ];

        const matchedCols = [];
        const colIndices = [];
        neededCols.forEach(col => {
          const idx = header.findIndex(h => h.toLowerCase() === col.toLowerCase());
          if (idx !== -1) {
            matchedCols.push(header[idx]);
            colIndices.push(idx);
          }
        });

        const statusIdx = header.findIndex(h => h.toLowerCase() === 'status');
        const filtered = [matchedCols];

        for (let i = 1; i < rawRows.length; i++) {
          const r = rawRows[i];
          if (!r || r.length === 0) continue;

          if (statusIdx !== -1) {
            const st = String(r[statusIdx] || '').trim().toLowerCase();
            if (st && !st.includes('success') && !st.includes('progress')) continue;
          }

          const cleanRow = colIndices.map(idx => (r[idx] !== undefined ? r[idx] : ''));
          filtered.push(cleanRow);
        }

        cleanupUI();
        applySalesData(filtered, file.name, file.size, totalRaw, filtered.length - 1);
      }
    } catch (err) {
      cleanupUI();
      showToast('Gagal Membaca Berkas', 'Format berkas tidak sesuai: ' + err.message, 'error');
    }
  }, 50);
}

function applyJournalData(rows, name, size) {
  state.rawJournalRows = rows;

  if (el.dropJournal) el.dropJournal.classList.add('file-loaded');
  if (el.badgeJournal) {
    el.badgeJournal.innerHTML = `<span class="text-emerald" style="font-weight:600;">✓ Siap: ${formatNumber(rows.length - 1)} baris (${formatFileSize(size)})</span>`;
    el.badgeJournal.classList.add('loaded');
  }
  if (el.valJournal) el.valJournal.textContent = name;
  if (el.dotJournal) el.dotJournal.classList.add('active');
  if (el.chipJournal) el.chipJournal.classList.add('loaded');

  checkReadyState();
  showToast('Jurnal Finance Dimuat', `${name} (${formatNumber(rows.length - 1)} baris)`, 'success');
}

function applySalesData(rows, name, size, totalRawRows, successRows) {
  state.rawSalesRows = rows;

  if (el.dropSales) el.dropSales.classList.add('file-loaded');
  if (el.badgeSales) {
    let badgeText = `✓ Siap: ${formatNumber(rows.length - 1)} baris (${formatFileSize(size)})`;
    if (totalRawRows && totalRawRows > (rows.length - 1)) {
      badgeText = `✓ Siap: ${formatNumber(rows.length - 1)} baris diproses (dari ${formatNumber(totalRawRows)} baris, ${formatFileSize(size)})`;
    }
    el.badgeSales.innerHTML = `<span class="text-emerald" style="font-weight:600;">${badgeText}</span>`;
    el.badgeSales.classList.add('loaded');
  }
  if (el.valSales) el.valSales.textContent = name;
  if (el.dotSales) el.dotSales.classList.add('active');
  if (el.chipSales) el.chipSales.classList.add('loaded');

  checkReadyState();
  showToast('Laporan Sales Dimuat', `${name} (${formatNumber(rows.length - 1)} baris diproses)`, 'success');
}

function checkReadyState() {
  const hasJournal = state.rawJournalRows && state.rawJournalRows.length > 0;
  const hasSales = state.rawSalesRows && state.rawSalesRows.length > 0;

  if (el.btnProcessAll) {
    el.btnProcessAll.disabled = !(hasJournal && hasSales);
  }
  if (el.btnGenerateJournal) {
    el.btnGenerateJournal.disabled = !hasSales;
  }
}

// --------------------------------------------------------------------------
// 2. Normalization Engine (Hapus Bill Non-SOSCOM COD)
// --------------------------------------------------------------------------

function normalizeJournalData(autoHide = true) {
  if (!state.rawJournalRows || state.rawJournalRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Jurnal Finance terlebih dahulu.', 'warning');
    return;
  }

  const rows = state.rawJournalRows;
  const headers = rows[0];
  const journalIdx = 6;
  const partnerIdx = 0;
  const paymentIdx = 5;

  const normalized = [headers];
  const deleted = [];

  let i = 1;
  let blockNum = 1;
  let deletedRowsCount = 0;

  while (i < rows.length) {
    const row = rows[i];
    const journalVal = String(row[journalIdx] || '').trim();

    if (journalVal.toLowerCase() === 'bill') {
      const partnerVal = String(row[partnerIdx] || '').toUpperCase();
      const paymentVal = String(row[paymentIdx] || '').toUpperCase();

      const isSoscom = partnerVal.includes('SOSCOM');
      const isCod = paymentVal.includes('COD');

      // Tentukan batas blok Bill secara dinamis (semua baris sampai ada entri Journal baru)
      let nextI = i + 1;
      while (nextI < rows.length && String(rows[nextI][journalIdx] || '').trim() === '') {
        nextI++;
      }
      const blockRows = rows.slice(i, nextI);

      if (!isSoscom && isCod) {
        // DELETE THIS BILL BLOCK
        let debits = [];
        let credits = [];
        for (const bRow of blockRows) {
          const dr = Number(bRow[11]) || 0;
          const cr = Number(bRow[12]) || 0;
          if (dr > 0) debits.push(dr);
          if (cr > 0) credits.push(cr);
        }

        deleted.push({
          blockNum: blockNum++,
          partner: row[partnerIdx] || '-',
          payment: row[paymentIdx] || '-',
          label: row[9] || '-',
          debitOngkirBersih: debits[0] || 0,
          debitPromo: debits[1] || 0,
          creditOngkir: credits[0] || (credits.reduce((a, b) => a + b, 0)),
          reason: 'Non-SOSCOM & COD'
        });
        deletedRowsCount += blockRows.length;
        i = nextI;
        continue;
      } else {
        // KEEP THIS BILL BLOCK
        for (const bRow of blockRows) {
          normalized.push(bRow);
        }
        i = nextI;
        continue;
      }
    } else {
      normalized.push(row);
      i++;
    }
  }

  state.normalizedJournalRows = normalized;
  state.deletedBills = deleted;

  renderNormalizedTable();
  renderDeletedTable();

  // Update Metrics
  if (el.metricDeletedBills) el.metricDeletedBills.textContent = formatNumber(deleted.length);
  if (el.metricDeletedRows) el.metricDeletedRows.textContent = `${formatNumber(deletedRowsCount)} baris dieliminasi`;
  if (el.countJournalTab) el.countJournalTab.textContent = formatNumber(normalized.length - 1);
  if (el.countDeletedTab) el.countDeletedTab.textContent = formatNumber(deleted.length);

  if (autoHide) hideLoading();
}

// --------------------------------------------------------------------------
// 3. Auto-Balanced Journal Generator & Diff Comparison Builder
// --------------------------------------------------------------------------

function generateBalancedJournal() {
  if (!state.rawSalesRows || state.rawSalesRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Laporan Penjualan (Sales).', 'warning');
    return;
  }

  showLoading('Menyusun Jurnal Seimbang Baru', 'Mengkalkulasi pos 2 Debit + 1 Kredit Bill & menyiapkan komparasi...');

  setTimeout(() => {
    const sRows = state.rawSalesRows;
    const sHeaders = sRows[0].map(h => String(h || '').trim());

    const colEntitas = sHeaders.indexOf('Entitas');
    const colKanal = sHeaders.indexOf('Kanal');
    const colGroup = sHeaders.indexOf('Group');
    const colMetode = sHeaders.indexOf('MetodeBayar');
    const colWarehouse = sHeaders.indexOf('Warehouse');
    const colSKU = sHeaders.indexOf('Code SKU');
    const colProduct = sHeaders.indexOf('Product Name');
    const colTotal = sHeaders.indexOf('Totalperline');
    const colQty = sHeaders.indexOf('Quantity');
    const colOngkir = sHeaders.indexOf('Ongkir');
    const colDiscOngkir = sHeaders.indexOf('DiscountOngkir');
    const colShipping = sHeaders.indexOf('ShippingFee');
    const colStatus = sHeaders.indexOf('Status');
    const colShipped = sHeaders.indexOf('Shipped Date');

    // Group By: Entitas, Kanal, Group, ShippedDate, Metode, SKU, Product, Warehouse
    const aggMap = new Map();

    for (let r = 1; r < sRows.length; r++) {
      const row = sRows[r];
      if (!row || row.length === 0) continue;

      // Filter status pesanan: proses status sukses (Success & Success DFOD) dan On Progress, abaikan retur (Return Putaway)
      if (colStatus !== -1) {
        const st = String(row[colStatus] || '').trim().toLowerCase();
        if (st && !st.includes('success') && !st.includes('progress')) {
          continue;
        }
      }

      const entitas = String(row[colEntitas] || 'FHI').trim();
      const kanal = String(row[colKanal] || '').trim();
      const group = String(row[colGroup] || '').trim();
      const metode = String(row[colMetode] || '').trim();
      const warehouse = String(row[colWarehouse] || 'jakarta').trim();
      const sku = String(row[colSKU] || '').trim();
      const product = String(row[colProduct] || '').trim();
      const shippedDate = colShipped !== -1 ? formatShippedDate(row[colShipped]) : '';

      const total = Number(row[colTotal]) || 0;
      const qty = Number(row[colQty]) || 0;
      const ongkir = Number(row[colOngkir]) || 0;
      const discOngkir = Number(row[colDiscOngkir]) || 0;
      const shipping = Number(row[colShipping]) || 0;

      const key = `${entitas}|||${kanal}|||${group}|||${shippedDate}|||${metode}|||${sku}|||${product}|||${warehouse}`;

      if (!aggMap.has(key)) {
        aggMap.set(key, {
          entitas,
          kanal,
          group,
          shippedDate,
          metode,
          sku,
          product,
          warehouse,
          total: 0,
          quantity: 0,
          ongkir: 0,
          discountOngkir: 0,
          shippingFee: 0
        });
      }

      const item = aggMap.get(key);
      item.total += total;
      item.quantity += qty;
      item.ongkir += ongkir;
      item.discountOngkir += discOngkir;
      item.shippingFee += shipping;
    }

    // Build Journal Rows
    const headers = [
      'Partner', 'Attention', 'Analytic Group', 'Delivery Address', 'Date',
      'Payment Type', 'Journal', 'Company', 'Journal Items/Account',
      'Journal Items/Label', 'Journal Items/Analytic Groups', 'Journal Items/Debit', 'Journal Items/Credit'
    ];
    const generatedRows = [headers];

    aggMap.forEach(item => {
      const isSoscom = item.kanal.toUpperCase().includes('SOSCOM') || item.group.toUpperCase().includes('SOSCOM');
      const isCod = item.metode.toUpperCase().includes('COD');

      const companyName = item.entitas === 'FH' ? 'PT Family Herbal' : 'PT Family Herbal Indonesia';
      const partnerName = `${item.kanal} ${item.group}`.trim();
      let baseLabel = '';
      if (item.shippedDate) {
        baseLabel = `${partnerName} ${item.shippedDate} ${item.metode} , ${item.sku} ${item.product} x ${item.quantity} , ${item.warehouse}`.trim();
      } else {
        baseLabel = `${partnerName} ${item.metode} | ${item.sku} ${item.product}`.trim();
      }
      const analyticGroup = `[${item.entitas}] Channel : ${item.kanal}/Sub : ${item.group}/Platform : ${item.kanal}`;

      // Invoices Account
      let piutangAccount = '10140101 Piutang Usaha';
      let revenueAccount = '40100005 Pendapatan MP';
      if (isSoscom) {
        piutangAccount = '20160001 Pendapatan diterima di muka';
        if (item.group.toUpperCase().includes('CRM')) revenueAccount = '40100004 Pendapatan CRM';
        else if (item.group.toUpperCase().includes('AKUISISI')) revenueAccount = '40100003 Pendapatan Akuisisi';
        else if (item.group.toUpperCase().includes('COMMERCE')) revenueAccount = '40100012 Pendapatan Web Commerce';
      } else if (item.kanal.toUpperCase().includes('TIKTOK')) {
        if (partnerName.toUpperCase().includes('GRASON')) {
          revenueAccount = '4010022 Pendapatan Tiktok-GRASON';
        } else {
          revenueAccount = '40100006 Pendapatan Tiktok';
        }
      } else if (partnerName.toUpperCase().includes('GRASON')) {
        revenueAccount = '4010021 Pendapatan MP-GRASON';
      }

      // 1. Invoices Block
      generatedRows.push([
        partnerName, baseLabel, analyticGroup, partnerName, item.shippedDate || '',
        item.metode, `[${item.entitas}] Invoices`, companyName,
        piutangAccount, baseLabel, analyticGroup, item.total, ''
      ]);
      generatedRows.push([
        '', '', '', '', '',
        '', '', '',
        revenueAccount, baseLabel, analyticGroup, '', item.total
      ]);

      // 2. Inventory Valuation Block (HPP LIN01 @ Rp 90.000)
      const invVal = item.sku === 'LIN01' ? item.quantity * 90000 : 0;
      generatedRows.push([
        partnerName, baseLabel, analyticGroup, partnerName, '',
        item.metode, `[${item.entitas}] Inventory Valuation`, companyName,
        '10130001 Persediaan Barang Dagang', baseLabel, analyticGroup, invVal, ''
      ]);
      generatedRows.push([
        '', '', '', '', '',
        '', '', '',
        '50100001 Harga Pokok Penjualan - Internal', baseLabel, analyticGroup, '', invVal
      ]);

      // 3. Bill Block (2 Debit + 1 Credit)
      // Normalization: Non-SOSCOM COD -> Tidak ada Bill
      if (!isSoscom && isCod) {
        return;
      }

      const grossOngkir = Number(item.ongkir) || 0;
      const discOngkir = Number(item.discountOngkir) || 0;
      const netOngkir = grossOngkir - discOngkir;

      // Jika tidak ada ongkir dan tidak ada diskon promo ongkir, skip blok Bill (tidak membuat baris Rp 0)
      if (grossOngkir === 0 && discOngkir === 0) {
        return;
      }

      let promoAccount = '60130130 Biaya Promo MP';
      if (partnerName.toUpperCase().includes('GRASON')) {
        if (item.kanal.toUpperCase().includes('TIKTOK')) {
          promoAccount = '60191412 Biaya Promo Tiktok-Grason';
        } else {
          promoAccount = '60191313 Biaya Promo MP-Grason';
        }
      } else if (item.kanal.toUpperCase().includes('TIKTOK')) {
        promoAccount = '60140012 Biaya Promo Tiktok';
      } else if (item.group.toUpperCase().includes('CRM')) {
        promoAccount = '60120003 Biaya Promo CRM';
      } else if (item.group.toUpperCase().includes('AKUISISI')) {
        promoAccount = '60110090 Biaya Promo Akuisisi';
      }

      const headerAccount = isSoscom ? '20160001 Pendapatan diterima di muka' : '10140101 Piutang Usaha';

      // Row 1: Header Bill (Debit 1: Net Ongkir)
      generatedRows.push([
        partnerName, baseLabel, analyticGroup, partnerName, '',
        item.metode, 'Bill', companyName,
        headerAccount, baseLabel, analyticGroup, netOngkir, ''
      ]);

      // Row 2: Child 1 (Debit 2: Diskon Ongkir)
      generatedRows.push([
        '', '', '', '', '',
        '', '', '',
        promoAccount, baseLabel, analyticGroup, discOngkir, ''
      ]);

      // Row 3: Child 2 (Kredit: Gross Ongkir)
      generatedRows.push([
        '', '', '', '', '',
        '', '', '',
        '20120104 Utang Ongkir', baseLabel, analyticGroup, '', grossOngkir
      ]);
    });

    state.generatedJournalRows = generatedRows;
    state.normalizedJournalRows = generatedRows;

    renderNormalizedTable();
    if (el.countJournalTab) el.countJournalTab.textContent = formatNumber(generatedRows.length - 1);
    if (el.btnExportGenerated) el.btnExportGenerated.style.display = 'inline-flex';

    // 4. Build Comparison Data (Jurnal Asli vs Jurnal Baru)
    buildComparisonData();

    // 5. Activate Comparison Tab
    if (el.tabBtnCompare) el.tabBtnCompare.style.display = 'inline-flex';
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    if (el.tabBtnCompare) el.tabBtnCompare.classList.add('active');
    const compPane = document.getElementById('tab-compare');
    if (compPane) compPane.classList.add('active');

    hideLoading();
    showToast('Jurnal Seimbang Siap', `Berhasil menyusun ${formatNumber(generatedRows.length - 1)} baris jurnal seimbang 100%. Komparasi aktif.`, 'success');
  }, 100);
}

// --------------------------------------------------------------------------
// 3B. Comparison Engine (Jurnal Asli vs Jurnal Baru Seimbang)
// --------------------------------------------------------------------------

function buildComparisonData() {
  const origRowsCount = state.rawJournalRows.length > 1 ? state.rawJournalRows.length - 1 : 0;
  const newRowsCount = state.generatedJournalRows.length > 1 ? state.generatedJournalRows.length - 1 : 0;

  if (el.compRowsOld) el.compRowsOld.textContent = formatNumber(origRowsCount);
  if (el.compRowsNew) el.compRowsNew.textContent = formatNumber(newRowsCount);
  if (el.compRowsHint) {
    const diffRows = origRowsCount - newRowsCount;
    el.compRowsHint.textContent = diffRows > 0 ? `${diffRows} baris beban berlebih disingkirkan` : 'Struktur baris diselaraskan';
  }

  let totalSales = 0;
  state.reconciliationResults.forEach(r => totalSales += r.salesTotal);

  if (el.compOmsetOld) {
    el.compOmsetOld.textContent = formatCurrency(totalSales);
    el.compOmsetOld.title = formatCurrency(totalSales);
  }
  if (el.compOmsetNew) {
    el.compOmsetNew.textContent = formatCurrency(totalSales);
    el.compOmsetNew.title = formatCurrency(totalSales);
  }

  const compList = [];

  state.reconciliationResults.forEach(r => {
    const isCod = r.label.toUpperCase().includes('COD');
    const isSoscom = r.label.toUpperCase().includes('SOSCOM');
    const isNonSoscomCod = !isSoscom && isCod;

    let adjustmentType = 'INTACT';
    let adjBadgeClass = 'badge-intact';
    let adjLabel = 'Sesuai';
    let newBillHtml = '-';
    let hasBill = false;

    if (isNonSoscomCod) {
      adjustmentType = 'ELIMINATED';
      adjBadgeClass = 'badge-eliminated';
      adjLabel = 'Bill Dieliminasi';
      newBillHtml = '<span style="color:var(--text-muted); font-style:italic;">Tanpa Bill (Non-SOSCOM COD)</span>';
    } else if (r.ongkirGross > 0 || r.discOngkir > 0) {
      hasBill = true;
      adjustmentType = 'ADJUSTED';
      adjBadgeClass = 'badge-adjusted';
      adjLabel = 'Formula Seimbang';
      newBillHtml = `Dr1: ${formatNumber(r.netOngkir)} + Dr2: ${formatNumber(r.discOngkir)} = Cr: ${formatNumber(r.ongkirGross)}`;
    } else {
      newBillHtml = '<span style="color:var(--text-muted);">- Tanpa Beban Ongkir -</span>';
    }

    compList.push({
      id: r.id,
      entitas: r.entitas,
      label: r.label,
      salesTotal: r.salesTotal,
      origStatus: r.status,
      adjustmentType,
      adjBadgeClass,
      adjLabel,
      newBillHtml,
      hasBill
    });
  });

  state.comparisonResults = compList;
  renderComparisonTable();
}

function renderComparisonTable() {
  const tbody = el.tbodyCompare || document.getElementById('tbody-compare');
  if (!tbody) return;
  tbody.innerHTML = '';

  const { search, mode } = state.comparisonFilters;

  const filtered = state.comparisonResults.filter(item => {
    if (mode === 'CHANGED' && item.adjustmentType === 'INTACT') return false;
    if (mode === 'BILL_ONLY' && !item.hasBill) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.label.toLowerCase().includes(q) || item.entitas.toLowerCase().includes(q);
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 28px; color: var(--text-muted);">Tidak ada transaksi yang sesuai kriteria filter.</td></tr>`;
    return;
  }

  // Pagination for compare tab
  const { page, limit } = state.pagination.compare;
  const start = (page - 1) * limit;
  const pageItems = filtered.slice(start, start + limit);

  pageItems.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted);">${start + idx + 1}</td>
      <td><span class="badge" style="background: var(--bg-elevated);">${escapeHtml(row.entitas)}</span></td>
      <td style="font-weight: 600;">${escapeHtml(row.label)}</td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(row.salesTotal)}</td>
      <td style="text-align: center;">
        <span class="badge ${row.origStatus === 'MATCHED' || row.origStatus === 'MATCHED*' ? 'badge-matched' : 'badge-discrepancy'}">
          ${escapeHtml(row.origStatus)}
        </span>
      </td>
      <td style="text-align: center; font-size: 11.5px;" class="font-mono">
        ${row.newBillHtml}
      </td>
      <td style="text-align: center;">
        <span class="badge ${row.adjBadgeClass}">${escapeHtml(row.adjLabel)}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationControls('pagination-compare', filtered.length, page, limit, (newPage) => {
    state.pagination.compare.page = newPage;
    renderComparisonTable();
  });
}

// --------------------------------------------------------------------------
// 4. Reconciliation Engine (Roll-up Label + Warehouse Breakdown Two-Tier)
// --------------------------------------------------------------------------

function runReconciliation(autoHide = true) {
  if (!state.rawSalesRows || state.rawSalesRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Laporan Penjualan (Sales).', 'warning');
    return;
  }
  if (!state.rawJournalRows || state.rawJournalRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Jurnal Finance terlebih dahulu.', 'warning');
    return;
  }

  if (state.normalizedJournalRows.length === 0) {
    normalizeJournalData(false);
  }

  // A. Parse & Aggregate Sales Report
  const sRows = state.rawSalesRows;
  const sHeaders = sRows[0].map(h => String(h || '').trim());

  const colEntitas = sHeaders.indexOf('Entitas');
  const colKanal = sHeaders.indexOf('Kanal');
  const colGroup = sHeaders.indexOf('Group');
  const colMetode = sHeaders.indexOf('MetodeBayar');
  const colWarehouse = sHeaders.indexOf('Warehouse');
  const colSKU = sHeaders.indexOf('Code SKU');
  const colProduct = sHeaders.indexOf('Product Name');
  const colTotal = sHeaders.indexOf('Totalperline');
  const colQty = sHeaders.indexOf('Quantity');
  const colOngkir = sHeaders.indexOf('Ongkir');
  const colDiscOngkir = sHeaders.indexOf('DiscountOngkir');
  const colShipping = sHeaders.indexOf('ShippingFee');
  const colStatus = sHeaders.indexOf('Status');
  const colShipped = sHeaders.indexOf('Shipped Date');

  const jRows = state.normalizedJournalRows;
  const isGranularJournal = jRows.some((r, idx) => idx > 0 && String(r[9] || '').includes(' , '));

  const tempGrouped = new Map();

  for (let r = 1; r < sRows.length; r++) {
    const row = sRows[r];
    if (!row || row.length === 0) continue;

    // Filter status pesanan: proses status sukses (Success & Success DFOD) dan On Progress, abaikan retur (Return Putaway)
    if (colStatus !== -1) {
      const st = String(row[colStatus] || '').trim().toLowerCase();
      if (st && !st.includes('success') && !st.includes('progress')) {
        continue;
      }
    }

    const entitas = String(row[colEntitas] || 'FHI').trim();
    const kanal = String(row[colKanal] || '').trim();
    const group = String(row[colGroup] || '').trim();
    const metode = String(row[colMetode] || '').trim();
    const warehouse = String(row[colWarehouse] || 'Gudang Utama').trim();
    const sku = String(row[colSKU] || '').trim();
    const product = String(row[colProduct] || '').trim();
    const shippedDate = colShipped !== -1 ? formatShippedDate(row[colShipped]) : '';

    const total = Number(row[colTotal]) || 0;
    const qty = Number(row[colQty]) || 0;
    const ongkir = Number(row[colOngkir]) || 0;
    const discOngkir = Number(row[colDiscOngkir]) || 0;
    const shipping = Number(row[colShipping]) || 0;

    let aggKey;
    if (isGranularJournal) {
      aggKey = `${entitas}|||${kanal}|||${group}|||${shippedDate}|||${metode}|||${sku}|||${product}|||${warehouse}`;
    } else {
      aggKey = `${entitas}|||${kanal}|||${group}|||${metode}|||${sku}|||${product}`;
    }

    if (!tempGrouped.has(aggKey)) {
      tempGrouped.set(aggKey, {
        entitas,
        kanal,
        group,
        shippedDate,
        metode,
        sku,
        product,
        warehouse,
        totalPerline: 0,
        quantity: 0,
        ongkir: 0,
        discountOngkir: 0,
        shippingFee: 0,
        warehouses: new Map()
      });
    }

    const item = tempGrouped.get(aggKey);
    item.totalPerline += total;
    item.quantity += qty;
    item.ongkir += ongkir;
    item.discountOngkir += discOngkir;
    item.shippingFee += shipping;

    if (!item.warehouses.has(warehouse)) {
      item.warehouses.set(warehouse, {
        name: warehouse,
        total: 0,
        quantity: 0,
        ongkir: 0,
        discountOngkir: 0,
        shippingFee: 0
      });
    }
    const whData = item.warehouses.get(warehouse);
    whData.total += total;
    whData.quantity += qty;
    whData.ongkir += ongkir;
    whData.discountOngkir += discOngkir;
    whData.shippingFee += shipping;
  }

  // Final salesGrouped keyed by label
  const salesGrouped = new Map();
  tempGrouped.forEach((item) => {
    let label;
    if (isGranularJournal) {
      label = `${item.kanal} ${item.group} ${item.shippedDate} ${item.metode} , ${item.sku} ${item.product} x ${item.quantity} , ${item.warehouse}`.trim();
    } else {
      label = `${item.kanal} ${item.group} ${item.metode} | ${item.sku} ${item.product}`.trim();
    }
    item.label = label;
    const groupKey = `${item.entitas}:::${label.toLowerCase()}`;
    salesGrouped.set(groupKey, item);
  });

  // B. Group Normalized Journal Entries (Separate Invoices vs Bill)
  const journalMap = new Map();

  let j = 1;
  while (j < jRows.length) {
    const row = jRows[j];
    const journalType = String(row[6] || '').trim();
    const company = String(row[7] || '').trim();
    const rawLabel = String(row[9] || '').trim();
    const debit = Number(row[11]) || 0;
    const account = String(row[8] || '').trim();

    let entitasCode = 'FHI';
    if (company.toLowerCase().includes('family herbal')) {
      entitasCode = company.toLowerCase().includes('indonesia') ? 'FHI' : 'FH';
    }

    let lookupLabel = rawLabel;
    if (!isGranularJournal) {
      lookupLabel = cleanJournalLabel(rawLabel);
    }

    const jKey = `${entitasCode}:::${lookupLabel.toLowerCase()}`;

    if (!journalMap.has(jKey)) {
      journalMap.set(jKey, {
        rawLabel,
        totalDebit: 0,
        invoicesDebit: 0,
        billDebit: 0,
        billPromoDebit: 0,
        billCredit: 0,
        entriesCount: 0,
        billsCount: 0,
        unbalancedBillsCount: 0,
        breakdown: {
          invoices: { debit: 0, credit: 0, count: 0 },
          inventory: { debit: 0, credit: 0, count: 0 },
          bill: { debit: 0, credit: 0, count: 0 }
        }
      });
    }

    const entry = journalMap.get(jKey);

    // Tentukan batas blok dinamis untuk entri jurnal ini (semua baris sampai ada nama Journal baru)
    let nextJ = j + 1;
    while (nextJ < jRows.length && String(jRows[nextJ][6] || '').trim() === '') {
      nextJ++;
    }
    const blockRows = jRows.slice(j, nextJ);

    const jTypeLower = journalType.toLowerCase();

    if (jTypeLower === 'bill') {
      let bDebitSum = 0;
      let bPromoSum = 0;
      let bCreditSum = 0;

      blockRows.forEach((bRow) => {
        const dr = Number(bRow[11]) || 0;
        const cr = Number(bRow[12]) || 0;
        const acct = String(bRow[8] || '').toLowerCase();

        if (dr > 0) {
          if (acct.includes('promo') || acct.includes('biaya')) {
            bPromoSum += dr;
          } else {
            bDebitSum += dr;
          }
        }
        if (cr > 0) {
          bCreditSum += cr;
        }
      });

      const totalDr = bDebitSum + bPromoSum;
      entry.billDebit += bDebitSum;
      entry.billPromoDebit += bPromoSum;
      entry.billCredit += bCreditSum;
      entry.totalDebit += bDebitSum;
      entry.billsCount = (entry.billsCount || 0) + 1;

      entry.breakdown.bill.debit += totalDr;
      entry.breakdown.bill.credit += bCreditSum;
      entry.breakdown.bill.count += blockRows.length;

      // Cek keseimbangan internal baris Bill (Dr_total == Cr_total)
      if (Math.abs(totalDr - bCreditSum) > 0.05) {
        entry.unbalancedBillsCount = (entry.unbalancedBillsCount || 0) + 1;
      }

      j = nextJ;
      continue;
    } else if (jTypeLower.includes('inventory')) {
      let invDr = 0;
      let invCr = 0;

      blockRows.forEach((bRow) => {
        invDr += Number(bRow[11]) || 0;
        invCr += Number(bRow[12]) || 0;
      });

      entry.breakdown.inventory.debit += invDr;
      entry.breakdown.inventory.credit += invCr;
      entry.breakdown.inventory.count += blockRows.length;

      j = nextJ;
      continue;
    } else {
      let invDr = 0;
      let invCr = 0;

      blockRows.forEach((bRow) => {
        const dr = Number(bRow[11]) || 0;
        const cr = Number(bRow[12]) || 0;
        const acct = String(bRow[8] || '').trim();

        const isInvoice = journalType.toLowerCase().includes('invoice');
        const isPiutang = acct.includes('Piutang');
        const isRevenue = acct.includes('Pendapatan');

        if (dr > 0) {
          invDr += dr;
          if (isInvoice || isPiutang || isRevenue) {
            entry.invoicesDebit += dr;
            entry.totalDebit += dr;
            entry.entriesCount += 1;
          }
        }
        if (cr > 0) {
          invCr += cr;
        }
      });

      entry.breakdown.invoices.debit += invDr;
      entry.breakdown.invoices.credit += invCr;
      entry.breakdown.invoices.count += blockRows.length;

      j = nextJ;
      continue;
    }
  }

  // C. Reconcile Matches & Variances (Dual-Layer Audit: Faktur Omset + Keseimbangan Bill)
  const results = [];
  let matchedCount = 0;
  let discrepancyCount = 0;
  let billUnbalancedCount = 0;
  let totalSalesVal = 0;
  let totalJournalVal = 0;
  let totalVarianceVal = 0;

  salesGrouped.forEach((sData, groupKey) => {
    totalSalesVal += sData.totalPerline;

    const jMatch = journalMap.get(groupKey);
    const totalDebitCombined = jMatch ? jMatch.totalDebit : 0;
    const invoicesDebit = jMatch ? jMatch.invoicesDebit : 0;
    const billDebit = jMatch ? jMatch.billDebit : 0;
    const billPromoDebit = jMatch ? jMatch.billPromoDebit : 0;
    const billCredit = jMatch ? jMatch.billCredit : 0;
    const journalEntriesCount = jMatch ? jMatch.entriesCount : 0;
    const billsCount = jMatch ? (jMatch.billsCount || 0) : 0;
    const unbalancedBillsCount = jMatch ? (jMatch.unbalancedBillsCount || 0) : 0;

    // Perbandingan Apple-to-Apple: Omset Faktur Barang (Invoices Debit)
    totalJournalVal += invoicesDebit;

    // Layer 1: Validasi Faktur Barang
    const diff = Math.abs(sData.totalPerline - invoicesDebit);
    const isInvoiceMatched = jMatch && diff <= 0.05;

    // Layer 2: Validasi Keseimbangan Jurnal Bill Ekspedisi
    const hasBills = billsCount > 0;
    const totalBillDr = billDebit + billPromoDebit;
    const isBillInternallyBalanced = !hasBills || (Math.abs(totalBillDr - billCredit) <= 0.05 && unbalancedBillsCount === 0);
    const billImbalance = Math.abs(totalBillDr - billCredit);

    let status = 'MATCHED';
    if (!jMatch) {
      status = 'MISSING_IN_JOURNAL';
    } else if (!isInvoiceMatched) {
      status = 'DISCREPANCY';
      discrepancyCount++;
      totalVarianceVal += diff;
    } else if (!isBillInternallyBalanced) {
      status = 'BILL_UNBALANCED';
      billUnbalancedCount++;
    } else {
      matchedCount++;
      if (journalEntriesCount > 1 || sData.warehouses.size > 1) {
        status = 'MATCHED*';
      }
    }

    const whList = [];
    sData.warehouses.forEach(wh => whList.push(wh));
    whList.sort((a, b) => b.total - a.total);

    const grossOngkir = Number(sData.ongkir) || 0;
    const discOngkir = Number(sData.discountOngkir) || 0;
    const netOngkir = grossOngkir - discOngkir;

    results.push({
      id: groupKey,
      entitas: sData.entitas,
      label: sData.label,
      salesTotal: sData.totalPerline,
      journalDebit: invoicesDebit, // Ditampilkan di kolom 'Nilai Jurnal' sebagai pembanding omset faktur
      totalDebit: totalDebitCombined, // Total debit gabungan (faktur + bill) jika ada
      invoicesDebit: invoicesDebit,
      billDebit: billDebit,
      billPromoDebit: billPromoDebit,
      billCredit: billCredit,
      billsCount: billsCount,
      unbalancedBillsCount: unbalancedBillsCount,
      isBillInternallyBalanced: isBillInternallyBalanced,
      billImbalance: billImbalance,
      journalEntriesCount: journalEntriesCount,
      variance: sData.totalPerline - invoicesDebit,
      quantity: sData.quantity,
      ongkirGross: grossOngkir,
      discOngkir: discOngkir,
      netOngkir: netOngkir,
      isBillBalanced: isBillInternallyBalanced,
      journalBreakdown: jMatch ? jMatch.breakdown : {
        invoices: { debit: 0, credit: 0, count: 0 },
        inventory: { debit: 0, credit: 0, count: 0 },
        bill: { debit: 0, credit: 0, count: 0 }
      },
      warehouses: whList,
      status: status
    });
  });

  state.reconciliationResults = results;

  // Update Cockpit Metrics with dynamic title tooltip to avoid truncation
  const totalLines = results.length;
  const matchRate = totalLines > 0 ? ((matchedCount / totalLines) * 100).toFixed(1) : 0;

  if (el.metricMatchRate) el.metricMatchRate.textContent = `${matchRate}%`;
  if (el.metricMatchCount) el.metricMatchCount.textContent = `${formatNumber(matchedCount)} / ${formatNumber(totalLines)} Label Cocok`;

  if (el.metricSalesTotal) {
    el.metricSalesTotal.textContent = formatCurrency(totalSalesVal);
    el.metricSalesTotal.title = formatCurrency(totalSalesVal);
  }
  if (el.metricSalesLines) el.metricSalesLines.textContent = `${formatNumber(totalLines)} kelompok transaksi`;

  if (el.metricJournalTotal) {
    el.metricJournalTotal.textContent = formatCurrency(totalJournalVal);
    el.metricJournalTotal.title = formatCurrency(totalJournalVal);
  }
  if (el.metricJournalEntries) el.metricJournalEntries.textContent = `${formatNumber(journalMap.size)} entri akun piutang`;

  if (el.metricVariance) {
    el.metricVariance.textContent = formatCurrency(totalVarianceVal);
    el.metricVariance.title = formatCurrency(totalVarianceVal);
  }
  if (el.metricDiscrepancyCount) {
    if (billUnbalancedCount > 0 && discrepancyCount === 0) {
      el.metricDiscrepancyCount.textContent = `${formatNumber(billUnbalancedCount)} Bill tidak seimbang`;
      el.metricDiscrepancyCount.style.color = 'var(--accent-rose)';
    } else if (billUnbalancedCount > 0 && discrepancyCount > 0) {
      el.metricDiscrepancyCount.textContent = `${formatNumber(discrepancyCount)} berselisih, ${formatNumber(billUnbalancedCount)} Bill tidak seimbang`;
      el.metricDiscrepancyCount.style.color = 'var(--accent-rose)';
    } else {
      el.metricDiscrepancyCount.textContent = `${formatNumber(discrepancyCount)} transaksi berselisih`;
      el.metricDiscrepancyCount.style.color = '';
    }
  }

  if (el.countReconcileTab) el.countReconcileTab.textContent = formatNumber(results.length);

  renderReconcileTable();

  if (autoHide) hideLoading();
}

// --------------------------------------------------------------------------
// 4B. Unified 1-Click Action (Normalize + Reconcile)
// --------------------------------------------------------------------------

function processAll() {
  if (!state.rawJournalRows || state.rawJournalRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Jurnal Finance terlebih dahulu.', 'warning');
    openUploadModal();
    return;
  }
  if (!state.rawSalesRows || state.rawSalesRows.length === 0) {
    showToast('Berkas Belum Lengkap', 'Silakan muat berkas Laporan Penjualan (Sales).', 'warning');
    openUploadModal();
    return;
  }

  showLoading('Memproses Data...', 'Menjalankan normalisasi dan rekonsiliasi otomatis...');

  setTimeout(() => {
    normalizeJournalData(false);
    runReconciliation(false);

    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const recTab = document.querySelector('[data-tab="tab-reconcile"]');
    if (recTab) recTab.classList.add('active');
    const recPane = document.getElementById('tab-reconcile');
    if (recPane) recPane.classList.add('active');

    hideLoading();
    showToast(
      'Rekonsiliasi Selesai',
      `${formatNumber(state.reconciliationResults.length)} kelompok transaksi dianalisa, ${formatNumber(state.deletedBills.length)} baris beban COD keliru dinormalisasi.`,
      'success'
    );
  }, 80);
}

// --------------------------------------------------------------------------
// 5. Rendering & Pagination (Two-Tier Warehouse Breakdown)
// --------------------------------------------------------------------------

function toggleRowExpand(rowId) {
  if (state.expandedRows.has(rowId)) {
    state.expandedRows.delete(rowId);
  } else {
    state.expandedRows.add(rowId);
  }
  renderReconcileTable();
}

function renderReconcileTable() {
  const tbody = el.tbodyReconcile;
  if (!tbody) return;
  tbody.innerHTML = '';

  const { search, status, entitas } = state.reconcileFilters;

  const filtered = state.reconciliationResults.filter(item => {
    if (status !== 'ALL') {
      if (status === 'MATCHED' && !item.status.startsWith('MATCHED')) return false;
      if (status !== 'MATCHED' && item.status !== status) return false;
    }
    if (entitas !== 'ALL' && item.entitas !== entitas) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.label.toLowerCase().includes(q) || item.entitas.toLowerCase().includes(q);
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 36px; color: var(--text-muted);">Tidak ada data rekonsiliasi yang sesuai kriteria pencarian.</td></tr>`;
    const pag = document.getElementById('pagination-reconcile');
    if (pag) pag.style.display = 'none';
    return;
  }

  const { page, limit } = state.pagination.reconcile;
  const start = (page - 1) * limit;
  const pageItems = filtered.slice(start, start + limit);

  pageItems.forEach((row, idx) => {
    const isExpanded = state.expandedRows.has(row.id);
    const tr = document.createElement('tr');
    tr.className = `reconcile-main-row ${isExpanded ? 'is-expanded' : ''}`;

    let badgeClass = 'badge-matched';
    if (row.status === 'DISCREPANCY') badgeClass = 'badge-discrepancy';
    if (row.status === 'BILL_UNBALANCED') badgeClass = 'badge-bill-unbalanced';
    if (row.status.includes('MISSING')) badgeClass = 'badge-missing';

    const whCount = row.warehouses.length;
    const whBadge = whCount > 1 
      ? `<span class="wh-trigger-badge" title="Klik untuk melihat rincian gudang">${whCount} Gudang ▾</span>`
      : `<span class="wh-trigger-badge-single">${row.warehouses[0]?.name || 'Gudang'}</span>`;

    // Format Column 8: Journal Composition (Invoices vs Bill)
    let compositionHtml = '';
    if (!row.journalDebit || row.status === 'MISSING_IN_JOURNAL') {
      compositionHtml = `<span style="color:var(--text-muted); font-size:11px;">Belum Ada Jurnal</span>`;
    } else if (!row.isBillInternallyBalanced) {
      compositionHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:11px;">
          <span style="color:var(--text-primary); font-weight:600;">Inv: ${formatCurrency(row.invoicesDebit)}</span>
          <span style="color:var(--accent-rose); font-size:10px; background:rgba(239, 68, 68, 0.08); padding:1px 6px; border-radius:4px; font-weight:600;" title="Debit Bill (${formatCurrency(row.billDebit + row.billPromoDebit)}) ≠ Kredit Bill (${formatCurrency(row.billCredit)})">
            ⚠ Bill Out-of-Balance
          </span>
        </div>
      `;
    } else if (row.billDebit > 0 || row.billCredit > 0) {
      compositionHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:11px;">
          <span style="color:var(--text-primary); font-weight:600;">Inv: ${formatCurrency(row.invoicesDebit)}</span>
          <span style="color:var(--accent-emerald); font-size:10px; background:rgba(5, 150, 105, 0.08); padding:1px 6px; border-radius:4px;" title="Bill Seimbang: Debit ${formatCurrency(row.billDebit + row.billPromoDebit)} = Kredit ${formatCurrency(row.billCredit)}">
            ✓ Bill Seimbang (${formatCurrency(row.billCredit)})
          </span>
        </div>
      `;
    } else {
      compositionHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:11px;">
          <span style="color:var(--text-primary); font-weight:600;">Inv: ${formatCurrency(row.invoicesDebit)}</span>
          <span style="color:var(--accent-emerald); font-size:10px;">Murni Faktur Barang</span>
        </div>
      `;
    }

    tr.innerHTML = `
      <td style="color: var(--text-muted);">${start + idx + 1}</td>
      <td><span class="badge" style="background: var(--bg-elevated);">${escapeHtml(row.entitas)}</span></td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="expand-btn" data-id="${escapeHtml(row.id)}" title="Buka rincian diagnostik &amp; gudang">
            ${isExpanded ? '▼' : '▶'}
          </button>
          <div>
            <div style="font-weight: 600; font-family: var(--font-sans);">${escapeHtml(row.label)}</div>
            <div style="margin-top:2px;">${whBadge}</div>
          </div>
        </div>
      </td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(row.salesTotal)}</td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(row.journalDebit)}</td>
      <td style="text-align: right; ${Math.abs(row.variance) > 0.05 ? 'color: var(--accent-amber); font-weight: 600;' : 'color: var(--text-muted);'}" class="font-mono">${formatCurrency(row.variance)}</td>
      <td style="text-align: right;" class="font-mono">${formatNumber(row.quantity)}</td>
      <td style="text-align: right;" class="font-mono">
        ${compositionHtml}
      </td>
      <td style="text-align: center;"><span class="badge ${badgeClass}">${escapeHtml(row.status)}</span></td>
    `;
    tbody.appendChild(tr);

    if (isExpanded) {
      const subTr = document.createElement('tr');
      subTr.className = 'reconcile-sub-row';

      const whRowsHtml = row.warehouses.map(wh => {
        const whGross = Number(wh.ongkir) || 0;
        const whDisc = Number(wh.discountOngkir) || 0;
        const whNet = whGross - whDisc;

        const ongkirInfo = (whGross > 0 || whDisc > 0)
          ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:1px;">Ongkir: ${formatCurrency(whNet)} + Disc: ${formatCurrency(whDisc)}</div>`
          : '';

        return `
          <div class="wh-item-card">
            <div class="wh-item-header">
              <span class="wh-icon">🏢</span>
              <strong>${escapeHtml(wh.name)}</strong>
            </div>
            <div class="wh-item-stats font-mono">
              <div>Omset: <strong>${formatCurrency(wh.total)}</strong> <span style="color:var(--text-muted); font-size:10.5px;">(${formatNumber(wh.quantity)} pcs)</span></div>
              ${ongkirInfo}
            </div>
          </div>
        `;
      }).join('');

      // Root-cause Audit Diagnosis (Ultra-Compact)
      let alertClass = 'alert-clean';
      let auditExplanation = '';

      if (row.status === 'MISSING_IN_JOURNAL') {
        alertClass = 'alert-danger';
        auditExplanation = '<strong>Belum Tercatat:</strong> Faktur belum ditemukan di Jurnal Finance.';
      } else if (row.status === 'BILL_UNBALANCED') {
        alertClass = 'alert-danger';
        auditExplanation = `<strong>Bill Out-of-Balance:</strong> Faktur klop (${formatCurrency(row.invoicesDebit)}), namun Bill selisih <strong>${formatCurrency(row.billImbalance)}</strong> (Dr ${formatCurrency(row.billDebit + row.billPromoDebit)} ≠ Cr ${formatCurrency(row.billCredit)}).`;
      } else if (Math.abs(row.variance) <= 0.05 && (row.billDebit > 0 || row.billCredit > 0)) {
        alertClass = 'alert-clean';
        auditExplanation = `<strong>Dual-Layer Klop:</strong> Faktur ${formatCurrency(row.invoicesDebit)} &amp; Bill ${formatCurrency(row.billCredit)} seimbang sempurna.`;
      } else if (Math.abs(row.variance) <= 0.05) {
        alertClass = 'alert-clean';
        auditExplanation = `<strong>Faktur Klop 100%:</strong> Omset Sales &amp; Debit Jurnal selaras (${formatCurrency(row.invoicesDebit)}).`;
      } else {
        alertClass = 'alert-danger';
        auditExplanation = `<strong>Selisih Faktur:</strong> Sales berselisih <strong>${formatCurrency(row.variance)}</strong> dibanding Jurnal.`;
      }

      // Multi-Journal Breakdown Table
      const bd = row.journalBreakdown || {
        invoices: { debit: 0, credit: 0 },
        inventory: { debit: 0, credit: 0 },
        bill: { debit: 0, credit: 0 }
      };

      const jTypesList = [
        { label: '📄 Invoices', desc: 'Faktur Penjualan Barang', data: bd.invoices },
        { label: '📦 Inventory Valuation', desc: 'Persediaan &amp; HPP Internal', data: bd.inventory },
        { label: '🚚 Bill', desc: 'Tagihan Ekspedisi &amp; Promo', data: bd.bill }
      ];

      const breakdownRowsHtml = jTypesList.map(jt => {
        const dVal = jt.data ? jt.data.debit : 0;
        const cVal = jt.data ? jt.data.credit : 0;
        const diff = Math.abs(dVal - cVal);
        let statusTag = '';

        if (dVal === 0 && cVal === 0) {
          statusTag = '<span style="color: var(--text-muted); font-size:10.5px;">(Tidak ada)</span>';
        } else if (diff <= 0.05) {
          statusTag = '<span style="color: var(--accent-emerald); font-size:10.5px; font-weight:600;">✓ Seimbang</span>';
        } else {
          statusTag = `<span style="color: var(--accent-rose); font-size:10.5px; font-weight:600;">⚠ Selisih ${formatCurrency(diff)}</span>`;
        }

        return `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 3px 6px;">
              <span style="font-weight: 500;">${jt.label}</span>
              <span style="font-size: 10px; color: var(--text-muted); display: block;">${jt.desc}</span>
            </td>
            <td style="padding: 3px 6px; text-align: right; font-family: var(--font-mono);">${dVal > 0 ? formatCurrency(dVal) : '-'}</td>
            <td style="padding: 3px 6px; text-align: right; font-family: var(--font-mono);">${cVal > 0 ? formatCurrency(cVal) : '-'}</td>
            <td style="padding: 3px 6px; text-align: right;">${statusTag}</td>
          </tr>
        `;
      }).join('');

      const totalDr = (bd.invoices?.debit || 0) + (bd.inventory?.debit || 0) + (bd.bill?.debit || 0);
      const totalCr = (bd.invoices?.credit || 0) + (bd.inventory?.credit || 0) + (bd.bill?.credit || 0);
      const totalDiff = Math.abs(totalDr - totalCr);
      const totalTag = (totalDr === 0 && totalCr === 0)
        ? '<span style="color: var(--text-muted); font-size:10.5px;">-</span>'
        : (totalDiff <= 0.05
          ? '<span style="color: var(--accent-emerald); font-size:10.5px; font-weight:700;">✓ Klop</span>'
          : `<span style="color: var(--accent-rose); font-size:10.5px; font-weight:700;">⚠ Selisih ${formatCurrency(totalDiff)}</span>`);

      subTr.innerHTML = `
        <td colspan="9">
          <div class="breakdown-dual-layout">
            <!-- Left Card: Audit Diagnostics & Root Cause (Compact) -->
            <div class="audit-card">
              <div class="audit-card-title">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="audit-icon">🔍</span>
                  <strong>Diagnostik Pembukuan &amp; Akar Selisih</strong>
                </div>
                <span class="badge ${badgeClass}">${escapeHtml(row.status)}</span>
              </div>
              <div class="audit-kpi-strip font-mono">
                <div class="kpi-item">
                  <span class="kpi-label">Faktur (Invoices)</span>
                  <span class="kpi-val">${formatCurrency(row.invoicesDebit)}</span>
                </div>
                <div class="kpi-sep">&bull;</div>
                <div class="kpi-item ${row.isBillInternallyBalanced ? 'highlight-clean' : 'highlight-variance'}">
                  <span class="kpi-label">Status Jurnal Bill</span>
                  <span class="kpi-val">${row.billsCount === 0 ? 'Tanpa Bill' : (row.isBillInternallyBalanced ? '✓ Seimbang' : `⚠ Selisih ${formatCurrency(row.billImbalance)}`)}</span>
                </div>
                <div class="kpi-sep">&bull;</div>
                <div class="kpi-item ${Math.abs(row.variance) > 0.05 ? 'highlight-variance' : 'highlight-clean'}">
                  <span class="kpi-label">Selisih Faktur</span>
                  <span class="kpi-val">${formatCurrency(row.variance)}</span>
                </div>
              </div>
              <div class="audit-summary-alert ${alertClass}">
                ${auditExplanation}
              </div>

              <!-- Rincian Multi-Journal Debit & Kredit -->
              <div style="margin-top: 8px; background: rgba(0,0,0,0.18); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 6px 8px;">
                <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
                  Perhitungan Debit &amp; Kredit Tiap Journal
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                  <thead>
                    <tr style="color: var(--text-muted); border-bottom: 1px solid var(--border-subtle); text-align: left; font-size: 10px;">
                      <th style="padding: 2px 6px; font-weight: 500;">Kolom Journal</th>
                      <th style="padding: 2px 6px; text-align: right; font-weight: 500;">Debit</th>
                      <th style="padding: 2px 6px; text-align: right; font-weight: 500;">Kredit</th>
                      <th style="padding: 2px 6px; text-align: right; font-weight: 500;">Keseimbangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${breakdownRowsHtml}
                    <tr style="border-top: 1px solid var(--border-subtle); font-weight: 600; background: rgba(255,255,255,0.02);">
                      <td style="padding: 4px 6px; font-size: 10.5px;">Total Mutasi Buku</td>
                      <td style="padding: 4px 6px; text-align: right; font-family: var(--font-mono);">${formatCurrency(totalDr)}</td>
                      <td style="padding: 4px 6px; text-align: right; font-family: var(--font-mono);">${formatCurrency(totalCr)}</td>
                      <td style="padding: 4px 6px; text-align: right;">${totalTag}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Right Card: Warehouse Distribution -->
            <div class="audit-card">
              <div class="audit-card-title">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="audit-icon">🏢</span>
                  <strong>Rincian Kontribusi Gudang (Sales Report)</strong>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span class="badge" style="background:var(--bg-elevated); font-size:11px;">${whCount} Gudang</span>
                  ${row.journalEntriesCount > 1 ? `<span class="journal-match-note" style="font-size:11px;">(${row.journalEntriesCount} entri jurnal)</span>` : ''}
                </div>
              </div>
              <div class="wh-grid">
                ${whRowsHtml}
              </div>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(subTr);
    }
  });

  tbody.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      toggleRowExpand(id);
    });
  });

  tbody.querySelectorAll('.reconcile-main-row').forEach(rowEl => {
    rowEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const btn = rowEl.querySelector('.expand-btn');
      if (btn) {
        const id = btn.getAttribute('data-id');
        toggleRowExpand(id);
      }
    });
  });

  renderPaginationControls('pagination-reconcile', filtered.length, page, limit, (newPage) => {
    state.pagination.reconcile.page = newPage;
    renderReconcileTable();
  });
}

function renderNormalizedTable() {
  const tbody = el.tbodyNormalized;
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = state.normalizedJournalRows;

  if (rows.length <= 1) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted);">Data belum dinormalisasi atau disusun.</td></tr>`;
    const pag = document.getElementById('pagination-normalized');
    if (pag) pag.style.display = 'none';
    return;
  }

  const { page, limit } = state.pagination.normalized;
  const start = 1 + (page - 1) * limit;
  const end = Math.min(start + limit, rows.length);

  for (let i = start; i < end; i++) {
    const r = rows[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted);">${i}</td>
      <td>${escapeHtml(r[0] || '-')}</td>
      <td>${escapeHtml(r[5] || '-')}</td>
      <td><span class="badge" style="background:var(--bg-elevated);">${escapeHtml(r[6] || '-')}</span></td>
      <td>${escapeHtml(r[7] || '-')}</td>
      <td>${escapeHtml(r[8] || '-')}</td>
      <td style="font-weight: 500;">${escapeHtml(r[9] || '-')}</td>
      <td style="text-align: right;" class="font-mono">${r[11] ? formatCurrency(r[11]) : '-'}</td>
      <td style="text-align: right;" class="font-mono">${r[12] ? formatCurrency(r[12]) : '-'}</td>
    `;
    tbody.appendChild(tr);
  }

  renderPaginationControls('pagination-normalized', rows.length - 1, page, limit, (newPage) => {
    state.pagination.normalized.page = newPage;
    renderNormalizedTable();
  });
}

function renderDeletedTable() {
  const tbody = el.tbodyDeleted;
  if (!tbody) return;
  tbody.innerHTML = '';
  const deleted = state.deletedBills;

  if (deleted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--text-muted);">Tidak ada baris Bill yang memenuhi syarat eliminasi.</td></tr>`;
    return;
  }

  deleted.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted);">${d.blockNum}</td>
      <td>${escapeHtml(d.partner)}</td>
      <td><span class="badge" style="background: rgba(239, 68, 68, 0.12); color: var(--accent-rose);">${escapeHtml(d.payment)}</span></td>
      <td style="font-weight: 500;">${escapeHtml(d.label)}</td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(d.debitOngkirBersih)}</td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(d.debitPromo)}</td>
      <td style="text-align: right;" class="font-mono">${formatCurrency(d.creditOngkir)}</td>
      <td style="text-align: center;"><span class="badge badge-missing">${escapeHtml(d.reason)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPaginationControls(containerId, totalItems, currentPage, limit, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems <= limit) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  const totalPages = Math.ceil(totalItems / limit) || 1;
  const startItem = totalItems > 0 ? (currentPage - 1) * limit + 1 : 0;
  const endItem = Math.min(currentPage * limit, totalItems);

  container.innerHTML = `
    <span>Menampilkan ${formatNumber(startItem)} - ${formatNumber(endItem)} dari ${formatNumber(totalItems)} data</span>
    <div class="page-controls">
      <button class="btn btn-sm btn-outline" ${currentPage === 1 ? 'disabled' : ''} id="${containerId}-prev">Sebelumnya</button>
      <span style="display:flex; align-items:center; padding: 0 8px; font-weight:600;">Hal ${currentPage} / ${totalPages}</span>
      <button class="btn btn-sm btn-outline" ${currentPage === totalPages ? 'disabled' : ''} id="${containerId}-next">Berikutnya</button>
    </div>
  `;

  document.getElementById(`${containerId}-prev`).addEventListener('click', () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  });
  document.getElementById(`${containerId}-next`).addEventListener('click', () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  });
}

// --------------------------------------------------------------------------
// 6. Excel Exporters
// --------------------------------------------------------------------------

function exportNormalizedJournal() {
  if (state.normalizedJournalRows.length === 0) {
    showToast('Data Kosong', 'Belum ada data jurnal yang dinormalisasi.', 'warning');
    return;
  }

  showLoading('Menyiapkan Berkas Unduhan', 'Mengonversi jurnal bersih ke format XLSX...');
  setTimeout(() => {
    const ws = XLSX.utils.aoa_to_sheet(state.normalizedJournalRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Journal Entry');
    XLSX.writeFile(wb, 'jurnal-finance-bersih-ter-normalisasi.xlsx');
    hideLoading();
    showToast('Ekspor Berhasil', 'Berkas jurnal-finance-bersih-ter-normalisasi.xlsx berhasil diunduh.', 'success');
  }, 100);
}

function exportGeneratedJournal() {
  if (state.generatedJournalRows.length === 0) {
    showToast('Data Kosong', 'Belum ada data jurnal seimbang yang digenerate.', 'warning');
    return;
  }

  showLoading('Menyiapkan Berkas Unduhan', 'Mengonversi jurnal seimbang ke XLSX...');
  setTimeout(() => {
    const ws = XLSX.utils.aoa_to_sheet(state.generatedJournalRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Journal Entry');
    XLSX.writeFile(wb, 'jurnal-finance-baru-seimbang.xlsx');
    hideLoading();
    showToast('Ekspor Berhasil', 'Berkas jurnal-finance-baru-seimbang.xlsx berhasil diunduh.', 'success');
  }, 100);
}

function exportReconciliationReport() {
  if (state.reconciliationResults.length === 0) {
    showToast('Rekonsiliasi Diperlukan', 'Jalankan proses rekonsiliasi terlebih dahulu sebelum mengunduh laporan.', 'warning');
    return;
  }

  showLoading('Membuat Buku Kerja Rekonsiliasi', 'Mengompilasi multi-sheet XLSX (Rekonsiliasi, Gudang, & Selisih)...');
  setTimeout(() => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Rekap Utama
    const reportData = [
      ['No', 'Entitas', 'Journal Items / Label', 'Sales Totalperline (IDR)', 'Jurnal Debit (IDR)', 'Selisih (Variance)', 'Quantity', 'Shipping Net (Dr1)', 'Diskon Ongkir (Dr2)', 'Gross Ongkir (Cr)', 'Bill Balanced?', 'Status Rekonsiliasi']
    ];

    state.reconciliationResults.forEach((r, idx) => {
      reportData.push([
        idx + 1,
        r.entitas,
        r.label,
        r.salesTotal,
        r.journalDebit,
        r.variance,
        r.quantity,
        r.netOngkir,
        r.discOngkir,
        r.ongkirGross,
        r.isBillBalanced ? 'YES' : 'NO',
        r.status
      ]);
    });
    const wsMain = XLSX.utils.aoa_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, wsMain, 'Rekap Rekonsiliasi');

    // Sheet 2: Breakdown Per Gudang
    const whDetailData = [
      ['No', 'Entitas', 'Journal Items / Label', 'Warehouse / Gudang', 'Totalperline (IDR)', 'Quantity', 'Shipping Net (Dr1)', 'Diskon Ongkir (Dr2)', 'Gross Ongkir (Cr)']
    ];
    let whCounter = 1;
    state.reconciliationResults.forEach(r => {
      r.warehouses.forEach(wh => {
        const whGross = Number(wh.ongkir) || 0;
        const whDisc = Number(wh.discountOngkir) || 0;
        const whNet = whGross - whDisc;

        whDetailData.push([
          whCounter++,
          r.entitas,
          r.label,
          wh.name,
          wh.total,
          wh.quantity,
          whNet,
          whDisc,
          whGross
        ]);
      });
    });
    const wsWh = XLSX.utils.aoa_to_sheet(whDetailData);
    XLSX.utils.book_append_sheet(wb, wsWh, 'Rincian Per Gudang');

    // Sheet 3: Discrepancy Only
    const discrepancies = reportData.filter((r, idx) => idx === 0 || !r[11].startsWith('MATCHED'));
    const wsDisc = XLSX.utils.aoa_to_sheet(discrepancies);
    XLSX.utils.book_append_sheet(wb, wsDisc, 'Daftar Selisih (Discrepancy)');

    XLSX.writeFile(wb, 'laporan-rekonsiliasi-sales-jurnal.xlsx');
    hideLoading();
    showToast('Ekspor Berhasil', 'Berkas laporan-rekonsiliasi-sales-jurnal.xlsx berhasil diunduh.', 'success');
  }, 100);
}

// --------------------------------------------------------------------------
// 7. Event Listeners & Initialization
// --------------------------------------------------------------------------

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');
    });
  });
}

function initFilters() {
  if (el.filterSearch) {
    el.filterSearch.addEventListener('input', (e) => {
      state.reconcileFilters.search = e.target.value;
      state.pagination.reconcile.page = 1;
      renderReconcileTable();
    });
  }

  if (el.filterStatus) {
    el.filterStatus.addEventListener('change', (e) => {
      state.reconcileFilters.status = e.target.value;
      state.pagination.reconcile.page = 1;
      renderReconcileTable();
    });
  }

  if (el.filterEntitas) {
    el.filterEntitas.addEventListener('change', (e) => {
      state.reconcileFilters.entitas = e.target.value;
      state.pagination.reconcile.page = 1;
      renderReconcileTable();
    });
  }

  if (el.filterCompareSearch) {
    el.filterCompareSearch.addEventListener('input', (e) => {
      state.comparisonFilters.search = e.target.value;
      state.pagination.compare.page = 1;
      renderComparisonTable();
    });
  }

  if (el.filterCompareMode) {
    el.filterCompareMode.addEventListener('change', (e) => {
      state.comparisonFilters.mode = e.target.value;
      state.pagination.compare.page = 1;
      renderComparisonTable();
    });
  }
}

function initModalAndChips() {
  if (el.chipJournal) el.chipJournal.addEventListener('click', openUploadModal);
  if (el.chipSales) el.chipSales.addEventListener('click', openUploadModal);
  if (el.btnOpenJournalModal) {
    el.btnOpenJournalModal.addEventListener('click', (e) => {
      e.stopPropagation();
      openUploadModal();
    });
  }
  if (el.btnOpenSalesModal) {
    el.btnOpenSalesModal.addEventListener('click', (e) => {
      e.stopPropagation();
      openUploadModal();
    });
  }

  if (el.btnCloseModal) el.btnCloseModal.addEventListener('click', closeUploadModal);
  if (el.btnModalCancel) el.btnModalCancel.addEventListener('click', closeUploadModal);
  if (el.btnModalDone) {
    el.btnModalDone.addEventListener('click', () => {
      closeUploadModal();
      if (state.rawJournalRows.length > 0 && state.rawSalesRows.length > 0) {
        showToast('Berkas Siap', 'Kedua berkas siap diproses. Klik "Proses & Rekonsiliasi" untuk mulai.', 'info');
      }
    });
  }

  if (el.modalUpload) {
    el.modalUpload.addEventListener('click', (e) => {
      if (e.target === el.modalUpload) closeUploadModal();
    });
  }
}

function initActions() {
  if (el.btnProcessAll) el.btnProcessAll.addEventListener('click', processAll);

  if (el.btnMoreOptions && el.dropdownMenu) {
    el.btnMoreOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      el.dropdownMenu.classList.toggle('show');
    });
    document.addEventListener('click', () => {
      el.dropdownMenu.classList.remove('show');
    });
  }

  if (el.btnGenerateJournal) el.btnGenerateJournal.addEventListener('click', generateBalancedJournal);
  if (el.btnExportJournal) el.btnExportJournal.addEventListener('click', exportNormalizedJournal);
  if (el.btnExportGenerated) el.btnExportGenerated.addEventListener('click', exportGeneratedJournal);
  if (el.btnExportReconcile) el.btnExportReconcile.addEventListener('click', exportReconciliationReport);

  // In-Memory Data Reset
  if (el.btnResetAll) {
    el.btnResetAll.addEventListener('click', () => {
      state.rawJournalWb = null;
      state.rawJournalRows = [];
      state.rawSalesRows = [];
      state.normalizedJournalRows = [];
      state.generatedJournalRows = [];
      state.deletedBills = [];
      state.reconciliationResults = [];
      state.comparisonResults = [];
      state.expandedRows.clear();

      if (el.valJournal) el.valJournal.textContent = 'Belum Ada Berkas';
      if (el.valSales) el.valSales.textContent = 'Belum Ada Berkas';
      if (el.dotJournal) el.dotJournal.classList.remove('active');
      if (el.dotSales) el.dotSales.classList.remove('active');
      if (el.chipJournal) el.chipJournal.classList.remove('loaded');
      if (el.chipSales) el.chipSales.classList.remove('loaded');
      if (el.badgeJournal) {
        el.badgeJournal.textContent = 'Belum Ada Berkas';
        el.badgeJournal.classList.remove('loaded');
      }
      if (el.badgeSales) {
        el.badgeSales.textContent = 'Belum Ada Berkas';
        el.badgeSales.classList.remove('loaded');
      }
      if (el.dropJournal) el.dropJournal.classList.remove('file-loaded');
      if (el.dropSales) el.dropSales.classList.remove('file-loaded');

      if (el.fileJournal) el.fileJournal.value = '';
      if (el.fileSales) el.fileSales.value = '';

      if (el.btnProcessAll) el.btnProcessAll.disabled = true;
      if (el.btnGenerateJournal) el.btnGenerateJournal.disabled = true;
      if (el.btnExportGenerated) el.btnExportGenerated.style.display = 'none';
      if (el.tabBtnCompare) el.tabBtnCompare.style.display = 'none';

      // Reset Metrics
      if (el.metricMatchRate) el.metricMatchRate.textContent = '0%';
      if (el.metricMatchCount) el.metricMatchCount.textContent = '0 / 0 Label Cocok';
      if (el.metricSalesTotal) {
        el.metricSalesTotal.textContent = 'Rp 0';
        el.metricSalesTotal.title = 'Rp 0';
      }
      if (el.metricSalesLines) el.metricSalesLines.textContent = '0 kelompok transaksi';
      if (el.metricJournalTotal) {
        el.metricJournalTotal.textContent = 'Rp 0';
        el.metricJournalTotal.title = 'Rp 0';
      }
      if (el.metricJournalEntries) el.metricJournalEntries.textContent = '0 entri akun piutang';
      if (el.metricVariance) {
        el.metricVariance.textContent = 'Rp 0';
        el.metricVariance.title = 'Rp 0';
      }
      if (el.metricDiscrepancyCount) el.metricDiscrepancyCount.textContent = '0 transaksi berselisih';
      if (el.metricDeletedBills) el.metricDeletedBills.textContent = '0';
      if (el.metricDeletedRows) el.metricDeletedRows.textContent = '0 baris dieliminasi';

      if (el.countReconcileTab) el.countReconcileTab.textContent = '0';
      if (el.countJournalTab) el.countJournalTab.textContent = '0';
      if (el.countDeletedTab) el.countDeletedTab.textContent = '0';

      if (el.tbodyReconcile) {
        el.tbodyReconcile.innerHTML = `
          <tr>
            <td colspan="9" class="empty-state-cell">
              <div class="empty-state-content">
                <div class="empty-icon-wrap">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <h3>Belum Ada Data yang Diproses</h3>
                <p>Silakan unggah berkas Jurnal Finance &amp; Sales Report melalui chip di atas, lalu tekan <strong>"Proses &amp; Rekonsiliasi"</strong>.</p>
              </div>
            </td>
          </tr>
        `;
      }
      if (el.tbodyNormalized) {
        el.tbodyNormalized.innerHTML = `<tr><td colspan="9" class="empty-state-cell">Belum ada data jurnal yang dimuat.</td></tr>`;
      }
      if (el.tbodyDeleted) {
        el.tbodyDeleted.innerHTML = `<tr><td colspan="8" class="empty-state-cell">Belum ada data normalisasi yang dijalankan.</td></tr>`;
      }
      if (el.tbodyCompare) {
        el.tbodyCompare.innerHTML = `<tr><td colspan="7" class="empty-state-cell">Jalankan "Buat Jurnal Seimbang Baru" untuk mengaktifkan komparasi.</td></tr>`;
      }

      showToast('Data Direset', 'Semua data di memori peramban telah dibersihkan.', 'info');
    });
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupDropzones();
  initTabs();
  initFilters();
  initModalAndChips();
  initActions();
});
