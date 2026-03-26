const state = {
  fileHandle: null,
  file: null,
  lastModified: 0,
  contracts: [],
  variationOrders: [],
  filtered: [],
  warnings: [],
  sort: { key: '', asc: true }
};

const REQUIRED_COLUMNS = [
  'contractKey','businessUnit','madeBy','contractType','referenceNumber','description','contractorName','poNumber','signingDate','commencementDate','expiryDate','extensionCount','extensionDates','baseValue','__source','signingDateObj','commencementDateObj','expiryDateObj','revisedExpiryDateObj','revisedExpiryWithVOObj'
];

const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') return XLSXLite.excelSerialToDate(value);
  const d = new Date(value);
  return isNaN(d) ? null : d;
}
function parseNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toStatus(row) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (!row.effectiveExpiryDate) return 'Draft';
  const days = Math.floor((row.effectiveExpiryDate - today) / 86400000);
  if (days < 0) return 'Expired';
  if (days <= 90) return 'Expiring Soon';
  return 'Active';
}

function enrich(contracts, vos) {
  const voMap = new Map();
  for (const vo of vos) {
    const key = String(vo.contractKey || '');
    const arr = voMap.get(key) || [];
    arr.push({ ...vo, voAmount: parseNumber(vo.voAmount), voDateObj: parseDate(vo.voDate) });
    voMap.set(key, arr);
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const warnings = [];
  const rows = contracts.map((r) => {
    const signing = parseDate(r.signingDateObj || r.signingDate);
    const comm = parseDate(r.commencementDateObj || r.commencementDate || r.signingDateObj || r.signingDate);
    const expiry = parseDate(r.expiryDateObj || r.expiryDate);
    const revExp = parseDate(r.revisedExpiryDateObj);
    const revVoExp = parseDate(r.revisedExpiryWithVOObj);
    const effective = revVoExp || revExp || expiry;
    const key = String(r.contractKey || '');
    const voRows = voMap.get(key) || [];
    const totalVO = voRows.reduce((s, x) => s + x.voAmount, 0);
    const voCount = voRows.length;
    const base = parseNumber(r.baseValue);
    const extCount = parseInt(r.extensionCount || 0, 10) || 0;
    const durationDays = comm && expiry ? Math.floor((expiry - comm) / 86400000) : null;
    const revisedDurationDays = comm && effective ? Math.floor((effective - comm) / 86400000) : null;
    const daysRemaining = effective ? Math.floor((effective - today) / 86400000) : null;
    if (durationDays !== null && durationDays < 0) warnings.push(`Contract ${r.contractKey || r.referenceNumber || '(unknown)'} has expiry before commencement.`);

    return {
      ...r,
      signingDateObj: signing,
      commencementDateObj: comm,
      expiryDateObj: expiry,
      revisedExpiryDateObj: revExp,
      revisedExpiryWithVOObj: revVoExp,
      effectiveExpiryDate: effective,
      extensionCount: extCount,
      voCount,
      totalVOValue: totalVO,
      baseValue: base,
      finalRevisedValue: base + totalVO,
      durationDays,
      revisedDurationDays,
      contractAgeDays: comm ? Math.floor((today - comm) / 86400000) : null,
      daysRemaining,
      contractStatus: '',
      expiring30: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30,
      expiring60: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 60,
      expiring90: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 90,
      hasExtension: extCount > 0,
      hasVO: voCount > 0,
      missingDataFlag: ['contractKey','referenceNumber','contractorName','businessUnit','contractType'].some(k => !String(r[k] || '').trim()),
    };
  });
  rows.forEach(r => r.contractStatus = toStatus(r));
  return { rows, warnings };
}

function kpis(rows) {
  const sum = (f) => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
  return {
    'Total Contracts': rows.length,
    'Active Contracts': sum(r => r.contractStatus === 'Active'),
    'Expired Contracts': sum(r => r.contractStatus === 'Expired'),
    'Expiring in 30 Days': sum(r => r.expiring30),
    'Expiring in 60 Days': sum(r => r.expiring60),
    'Expiring in 90 Days': sum(r => r.expiring90),
    'Contracts with Extensions': sum(r => r.hasExtension),
    'Contracts with Variation Orders': sum(r => r.hasVO),
    'Total Base Contract Value': rows.reduce((n, r) => n + parseNumber(r.baseValue), 0),
    'Total Revised Contract Value': rows.reduce((n, r) => n + parseNumber(r.finalRevisedValue), 0),
  };
}

function groupCount(rows, key) {
  const map = new Map();
  rows.forEach(r => map.set(String(r[key] || 'Unknown'), (map.get(String(r[key] || 'Unknown')) || 0) + 1));
  return [...map.entries()].sort((a,b) => b[1]-a[1]);
}

function renderBarChart(elId, data) {
  const el = $(elId);
  el.innerHTML = '';
  const max = Math.max(1, ...data.map(x => x[1]));
  data.slice(0, 12).forEach(([label, value]) => {
    const row = document.createElement('div'); row.className = 'bar';
    row.innerHTML = `<div class="bar-label" title="${label}">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${(value/max)*100}%"></div></div><div class="bar-value">${value}</div>`;
    el.appendChild(row);
  });
}

function renderKpi() {
  const grid = $('kpiCards');
  grid.innerHTML = '';
  const data = kpis(state.filtered);
  Object.entries(data).forEach(([k,v]) => {
    const card = document.createElement('div');
    card.className = 'kpi';
    card.innerHTML = `<h4>${k}</h4><p>${k.includes('Value') ? fmtMoney(v) : v}</p>`;
    grid.appendChild(card);
  });
}

function renderWarnings() {
  const w = $('warnings');
  w.innerHTML = '';
  (state.warnings.length ? state.warnings : ['No validation warnings']).forEach(x => {
    const li = document.createElement('li'); li.textContent = x; w.appendChild(li);
  });
}

function tableHtml(columns, rows, opts={}) {
  const header = `<tr>${columns.map(c => `<th data-key="${c.key}">${c.label}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr data-index="${i}">${columns.map(c => `<td>${c.render ? c.render(r,i) : (r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<thead>${header}</thead><tbody>${body}</tbody>`;
}

function renderTables() {
  const cols = [
    { key:'_row', label:'#', render:(_,i)=>i+1 },
    { key:'contractKey', label:'Contract Key' }, { key:'referenceNumber', label:'Reference #' },
    { key:'businessUnit', label:'Business Unit' }, { key:'contractType', label:'Contract Type' },
    { key:'contractorName', label:'Contractor' }, { key:'poNumber', label:'PO #' },
    { key:'contractStatus', label:'Status' }, { key:'commencementDateObj', label:'Start', render:r=>fmtDate(r.commencementDateObj) },
    { key:'effectiveExpiryDate', label:'Expiry', render:r=>fmtDate(r.effectiveExpiryDate) },
    { key:'daysRemaining', label:'Days Left' },
    { key:'baseValue', label:'Base Value', render:r=>fmtMoney(r.baseValue) },
    { key:'totalVOValue', label:'Total VO', render:r=>fmtMoney(r.totalVOValue) },
    { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) },
  ];

  $('contractsTable').innerHTML = tableHtml(cols, state.filtered);
  $('expiryTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' },{ key:'referenceNumber', label:'Reference #' },{ key:'contractorName', label:'Contractor' },
    { key:'effectiveExpiryDate', label:'Effective Expiry', render:r=>fmtDate(r.effectiveExpiryDate) },
    { key:'daysRemaining', label:'Days Remaining' },{ key:'contractStatus', label:'Status' },
    { key:'expiring30', label:'30d', render:r=>r.expiring30?'Yes':'No' },{ key:'expiring60', label:'60d', render:r=>r.expiring60?'Yes':'No' },{ key:'expiring90', label:'90d', render:r=>r.expiring90?'Yes':'No' }
  ], [...state.filtered].sort((a,b)=>(a.daysRemaining??999999)-(b.daysRemaining??999999)));

  $('extensionTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' },{ key:'referenceNumber', label:'Reference #' },
    { key:'extensionCount', label:'Extension Count' },{ key:'extensionDates', label:'Extension Dates' },
    { key:'expiryDateObj', label:'Original Expiry', render:r=>fmtDate(r.expiryDateObj) },
    { key:'revisedExpiryDateObj', label:'Revised Expiry', render:r=>fmtDate(r.revisedExpiryDateObj) },
    { key:'revisedDurationDays', label:'Revised Duration Days' }
  ], state.filtered.filter(r=>r.hasExtension));

  $('voSummaryTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' }, { key:'referenceNumber', label:'Reference #' },
    { key:'contractorName', label:'Contractor' }, { key:'voCount', label:'VO Count' },
    { key:'totalVOValue', label:'Total VO Value', render:r=>fmtMoney(r.totalVOValue) },
    { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) }
  ], state.filtered.filter(r=>r.hasVO));

  $('voTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' }, { key:'voNumber', label:'VO Number' },
    { key:'voDate', label:'VO Date', render:r=>fmtDate(parseDate(r.voDate)) }, { key:'voDescription', label:'Description' },
    { key:'voAmount', label:'Amount', render:r=>fmtMoney(r.voAmount) }, { key:'voStatus', label:'Status' }
  ], state.variationOrders.map(v => ({ ...v, voAmount: parseNumber(v.voAmount) })));

  $('contractsTable').querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => showDetail(state.filtered[Number(tr.dataset.index)]));
  });

  document.querySelectorAll('th[data-key]').forEach(th => th.onclick = () => sortBy(th.dataset.key));
}

function showDetail(r) {
  if (!r) return;
  const voRows = state.variationOrders.filter(v => String(v.contractKey||'') === String(r.contractKey||''));
  const lines = [
    `Contract Key: ${r.contractKey || ''}`,
    `Reference Number: ${r.referenceNumber || ''}`,
    `Business Unit: ${r.businessUnit || ''}`,
    `Made By: ${r.madeBy || ''}`,
    `Contract Type: ${r.contractType || ''}`,
    `Description: ${r.description || ''}`,
    `Contractor: ${r.contractorName || ''}`,
    `PO Number: ${r.poNumber || ''}`,
    `Status: ${r.contractStatus}`,
    `Signing Date: ${fmtDate(r.signingDateObj)}`,
    `Commencement Date: ${fmtDate(r.commencementDateObj)}`,
    `Original Expiry: ${fmtDate(r.expiryDateObj)}`,
    `Revised Expiry (Extension): ${fmtDate(r.revisedExpiryDateObj)}`,
    `Revised Expiry (With VO): ${fmtDate(r.revisedExpiryWithVOObj)}`,
    `Effective Expiry: ${fmtDate(r.effectiveExpiryDate)}`,
    `Duration Days: ${r.durationDays ?? ''}`,
    `Revised Duration Days: ${r.revisedDurationDays ?? ''}`,
    `Days Remaining: ${r.daysRemaining ?? ''}`,
    `Extension Count: ${r.extensionCount || 0}`,
    `Extension Dates: ${r.extensionDates || ''}`,
    `Base Value: ${fmtMoney(r.baseValue)}`,
    `Total VO Value: ${fmtMoney(r.totalVOValue)}`,
    `Final Revised Value: ${fmtMoney(r.finalRevisedValue)}`,
    '',
    'Variation Orders:',
    ...voRows.map(v => `- ${v.voNumber || ''} | ${fmtDate(parseDate(v.voDate))} | ${v.voDescription || ''} | ${fmtMoney(v.voAmount)} | ${v.voStatus || ''}`),
  ];
  $('detailBody').textContent = lines.join('\n');
  $('detailDialog').showModal();
}

function sortBy(key) {
  if (!key || key === '_row') return;
  state.sort.asc = state.sort.key === key ? !state.sort.asc : true;
  state.sort.key = key;
  state.filtered.sort((a,b) => {
    const av = a[key], bv = b[key];
    const cmp = (av ?? '') > (bv ?? '') ? 1 : (av ?? '') < (bv ?? '') ? -1 : 0;
    return state.sort.asc ? cmp : -cmp;
  });
  renderTables();
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const bu = $('buFilter').value;
  const type = $('typeFilter').value;
  const ext = $('extensionFilter').value;
  const vo = $('voFilter').value;

  state.filtered = state.contracts.filter(r => {
    const searchMatch = !q || [r.referenceNumber,r.description,r.contractorName,r.poNumber,r.contractKey].some(v => String(v||'').toLowerCase().includes(q));
    const sMatch = status === 'all' || r.contractStatus === status;
    const buMatch = bu === 'all' || String(r.businessUnit||'') === bu;
    const tMatch = type === 'all' || String(r.contractType||'') === type;
    const eMatch = ext === 'all' || (ext === 'yes' ? r.hasExtension : !r.hasExtension);
    const vMatch = vo === 'all' || (vo === 'yes' ? r.hasVO : !r.hasVO);
    return searchMatch && sMatch && buMatch && tMatch && eMatch && vMatch;
  });

  renderAll();
}

function renderFilters() {
  const fillSelect = (id, label, values) => {
    const sel = $(id);
    const cur = sel.value || 'all';
    sel.innerHTML = `<option value="all">${label}: All</option>` + values.map(v => `<option value="${v}">${label}: ${v}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
  };

  fillSelect('statusFilter', 'Status', [...new Set(state.contracts.map(r=>r.contractStatus).filter(Boolean))].sort());
  fillSelect('buFilter', 'Business Unit', [...new Set(state.contracts.map(r=>r.businessUnit).filter(Boolean))].sort());
  fillSelect('typeFilter', 'Contract Type', [...new Set(state.contracts.map(r=>r.contractType).filter(Boolean))].sort());
}

function renderAll() {
  renderKpi();
  renderWarnings();
  renderBarChart('chartBu', groupCount(state.filtered, 'businessUnit'));
  renderBarChart('chartType', groupCount(state.filtered, 'contractType'));
  renderBarChart('chartStatus', groupCount(state.filtered, 'contractStatus'));

  const expiryMonthMap = new Map();
  state.filtered.forEach(r => {
    if (!r.effectiveExpiryDate) return;
    const m = `${r.effectiveExpiryDate.getFullYear()}-${String(r.effectiveExpiryDate.getMonth()+1).padStart(2,'0')}`;
    expiryMonthMap.set(m, (expiryMonthMap.get(m)||0)+1);
  });
  renderBarChart('chartExpiry', [...expiryMonthMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12));

  renderTables();
  $('statusLabel').textContent = `Loaded ${state.contracts.length} contracts`;
}

async function loadFromFile(file) {
  $('statusLabel').textContent = 'Reading workbook...';
  const wb = await XLSXLite.readWorkbook(file);
  const contracts = wb.sheets.contracts_filtered || [];
  const vos = wb.sheets.variation_orders || [];

  const missingColumns = REQUIRED_COLUMNS.filter(c => !contracts[0] || !(c in contracts[0]));
  state.warnings = [];
  if (!contracts.length) state.warnings.push('No rows found in contracts_filtered sheet.');
  if (missingColumns.length) state.warnings.push(`Missing columns in contracts_filtered: ${missingColumns.join(', ')}`);
  if (!wb.sheets.variation_orders) state.warnings.push('Sheet variation_orders not found. Add it later for VO tracking.');

  const enriched = enrich(contracts, vos);
  state.contracts = enriched.rows;
  state.filtered = [...state.contracts];
  state.variationOrders = vos;
  state.warnings.push(...enriched.warnings.slice(0, 50));
  renderFilters();
  renderAll();
}

async function refresh() {
  try {
    if (!state.file) return;
    await loadFromFile(state.file);
  } catch (e) {
    $('statusLabel').textContent = `Error: ${e.message}`;
  }
}

async function pickFile() {
  try {
    if (!window.showOpenFilePicker) {
      alert('This browser does not support direct file handle access. Use latest Edge/Chrome.');
      return;
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Excel Workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      multiple: false,
    });
    state.fileHandle = handle;
    state.file = await handle.getFile();
    state.lastModified = state.file.lastModified;
    $('fileLabel').textContent = state.file.name;
    await refresh();
  } catch (e) {
    if (e.name !== 'AbortError') $('statusLabel').textContent = `Open canceled/error: ${e.message}`;
  }
}

async function pollChanges() {
  if (state.fileHandle) {
    try {
      const f = await state.fileHandle.getFile();
      if (f.lastModified !== state.lastModified) {
        state.file = f;
        state.lastModified = f.lastModified;
        $('statusLabel').textContent = 'Excel file changed. Auto-refreshing...';
        await refresh();
      }
    } catch {
      // ignore transient lock errors
    }
  }
}

function initEvents() {
  $('pickFileBtn').onclick = pickFile;
  $('refreshBtn').onclick = async () => {
    if (state.fileHandle) {
      state.file = await state.fileHandle.getFile();
      state.lastModified = state.file.lastModified;
    }
    refresh();
  };
  ['searchInput','statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).addEventListener('input', applyFilters));
  $('clearFiltersBtn').onclick = () => {
    $('searchInput').value = '';
    ['statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).value = 'all');
    applyFilters();
  };

  document.querySelectorAll('.nav-btn').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $(btn.dataset.page).classList.add('active');
  });

  $('exportCsvBtn').onclick = () => {
    const rows = state.filtered;
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] instanceof Date ? fmtDate(r[c]) : (r[c] ?? ''))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'contracts_filtered_export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $('printBtn').onclick = () => window.print();
  $('closeDialogBtn').onclick = () => $('detailDialog').close();
}

initEvents();
setInterval(pollChanges, 5000);
