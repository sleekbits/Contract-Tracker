const state = {
  fileHandle: null, file: null, lastModified: 0,
  contracts: [], variationOrders: [], filtered: [], warnings: [],
  sort: { key: '', asc: true }, selectedRef: null,
};

const REQUIRED_COLUMNS = ['contractKey','businessUnit','madeBy','contractType','referenceNumber','description','contractorName','poNumber','signingDate','commencementDate','expiryDate','extensionCount','extensionDates','baseValue','__source','signingDateObj','commencementDateObj','expiryDateObj','revisedExpiryDateObj','revisedExpiryWithVOObj'];
const EDITABLE_FIELDS = ['referenceNumber','businessUnit','madeBy','contractType','description','contractorName','poNumber','signingDateObj','commencementDateObj','expiryDateObj','revisedExpiryDateObj','revisedExpiryWithVOObj','extensionCount','extensionDates','baseValue'];
const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
const contractRef = (r) => String(r.referenceNumber || r.contractKey || '').trim();

function parseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') return XLSXLite.excelSerialToDate(value);
  const d = new Date(value);
  return isNaN(d) ? null : d;
}
function parseNumber(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
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
  vos.forEach(vo => {
    const key = String(vo.contractKey || vo.referenceNumber || '').trim();
    const arr = voMap.get(key) || [];
    arr.push({ ...vo, voAmount: parseNumber(vo.voAmount), voDateObj: parseDate(vo.voDate) });
    voMap.set(key, arr);
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const warnings = [];

  const rows = contracts.map(r => {
    r.referenceNumber = contractRef(r);
    r.contractKey = r.referenceNumber;
    const comm = parseDate(r.commencementDateObj || r.commencementDate || r.signingDateObj || r.signingDate);
    const expiry = parseDate(r.expiryDateObj || r.expiryDate);
    const rev = parseDate(r.revisedExpiryDateObj);
    const revVo = parseDate(r.revisedExpiryWithVOObj);
    const effective = revVo || rev || expiry;
    const voRows = voMap.get(r.referenceNumber) || [];
    const durationDays = comm && expiry ? Math.floor((expiry - comm) / 86400000) : null;
    if (durationDays !== null && durationDays < 0) warnings.push(`Contract ${r.referenceNumber} has expiry before commencement.`);
    const daysRemaining = effective ? Math.floor((effective - today) / 86400000) : null;

    return {
      ...r,
      signingDateObj: parseDate(r.signingDateObj || r.signingDate),
      commencementDateObj: comm,
      expiryDateObj: expiry,
      revisedExpiryDateObj: rev,
      revisedExpiryWithVOObj: revVo,
      effectiveExpiryDate: effective,
      extensionCount: parseInt(r.extensionCount || 0, 10) || 0,
      baseValue: parseNumber(r.baseValue),
      voCount: voRows.length,
      totalVOValue: voRows.reduce((n, x) => n + x.voAmount, 0),
      finalRevisedValue: parseNumber(r.baseValue) + voRows.reduce((n, x) => n + x.voAmount, 0),
      durationDays,
      revisedDurationDays: comm && effective ? Math.floor((effective - comm) / 86400000) : null,
      daysRemaining,
      expiring30: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30,
      expiring60: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 60,
      expiring90: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 90,
      hasExtension: (parseInt(r.extensionCount || 0, 10) || 0) > 0,
      hasVO: voRows.length > 0,
      missingDataFlag: ['referenceNumber','contractorName','businessUnit','contractType'].some(k => !String(r[k] || '').trim()),
    };
  });
  rows.forEach(r => r.contractStatus = toStatus(r));
  return { rows, warnings };
}

function kpis(rows) {
  const count = (f) => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
  return {
    'Total Contracts': rows.length,
    'Active Contracts': count(r => r.contractStatus === 'Active'),
    'Expired Contracts': count(r => r.contractStatus === 'Expired'),
    'Expiring in 30 Days': count(r => r.expiring30),
    'Expiring in 60 Days': count(r => r.expiring60),
    'Expiring in 90 Days': count(r => r.expiring90),
    'Contracts with Extensions': count(r => r.hasExtension),
    'Contracts with Variation Orders': count(r => r.hasVO),
    'Total Base Contract Value': rows.reduce((n, r) => n + r.baseValue, 0),
    'Total Revised Contract Value': rows.reduce((n, r) => n + r.finalRevisedValue, 0),
  };
}

const groupCount = (rows, key) => [...rows.reduce((m, r) => m.set(String(r[key] || 'Unknown'), (m.get(String(r[key] || 'Unknown')) || 0) + 1), new Map()).entries()].sort((a,b)=>b[1]-a[1]);

function renderBarChart(elId, data) {
  const el = $(elId); el.innerHTML = '';
  const max = Math.max(1, ...data.map(x => x[1]));
  data.slice(0, 12).forEach(([label, value]) => {
    const row = document.createElement('div'); row.className = 'bar';
    row.innerHTML = `<div class="bar-label" title="${label}">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${(value/max)*100}%"></div></div><div class="bar-value">${value}</div>`;
    el.appendChild(row);
  });
}

function tableHtml(columns, rows) {
  const h = `<tr>${columns.map(c => `<th data-key="${c.key}">${c.label}</th>`).join('')}</tr>`;
  const b = rows.map((r,i) => `<tr data-index="${i}">${columns.map(c => `<td>${c.render ? c.render(r,i) : (r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<thead>${h}</thead><tbody>${b}</tbody>`;
}
const statusBadge = (s) => `<span class="status ${String(s).replace(/\s/g,'-')}">${s}</span>`;

function renderTables() {
  $('contractsTable').innerHTML = tableHtml([
    { key:'_row', label:'#', render:(_,i)=>i+1 },
    { key:'referenceNumber', label:'Contract Reference Number' },
    { key:'description', label:'Description' },
    { key:'businessUnit', label:'Business Unit' },
    { key:'contractType', label:'Contract Type' },
    { key:'contractorName', label:'Contractor' },
    { key:'poNumber', label:'PO #' },
    { key:'contractStatus', label:'Status', render:r=>statusBadge(r.contractStatus) },
    { key:'commencementDateObj', label:'Start', render:r=>fmtDate(r.commencementDateObj) },
    { key:'effectiveExpiryDate', label:'Expiry', render:r=>fmtDate(r.effectiveExpiryDate) },
    { key:'daysRemaining', label:'Days Left' },
    { key:'baseValue', label:'Base Value', render:r=>fmtMoney(r.baseValue) },
    { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) },
    { key:'actions', label:'Actions', render:r=>`<button class="edit-btn" data-ref="${r.referenceNumber}">Edit</button>` },
  ], state.filtered);

  $('expiryTable').innerHTML = tableHtml([
    { key:'referenceNumber', label:'Contract Reference Number' }, { key:'description', label:'Description' },
    { key:'contractorName', label:'Contractor' }, { key:'effectiveExpiryDate', label:'Effective Expiry', render:r=>fmtDate(r.effectiveExpiryDate) },
    { key:'daysRemaining', label:'Days Remaining' }, { key:'contractStatus', label:'Status', render:r=>statusBadge(r.contractStatus) },
  ], [...state.filtered].sort((a,b)=>(a.daysRemaining??999999)-(b.daysRemaining??999999)));

  $('extensionTable').innerHTML = tableHtml([
    { key:'referenceNumber', label:'Contract Reference Number' }, { key:'description', label:'Description' },
    { key:'extensionCount', label:'Extension Count' }, { key:'extensionDates', label:'Extension Dates' },
    { key:'revisedExpiryDateObj', label:'Revised Expiry', render:r=>fmtDate(r.revisedExpiryDateObj) },
  ], state.filtered.filter(r=>r.hasExtension));

  $('voSummaryTable').innerHTML = tableHtml([
    { key:'referenceNumber', label:'Contract Reference Number' }, { key:'description', label:'Description' },
    { key:'voCount', label:'VO Count' }, { key:'totalVOValue', label:'Total VO', render:r=>fmtMoney(r.totalVOValue) },
    { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) },
  ], state.filtered.filter(r=>r.hasVO));

  $('voTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Reference Number' }, { key:'voNumber', label:'VO Number' },
    { key:'voDate', label:'VO Date', render:r=>fmtDate(parseDate(r.voDate)) }, { key:'voDescription', label:'Description' },
    { key:'voAmount', label:'Amount', render:r=>fmtMoney(parseNumber(r.voAmount)) }, { key:'voStatus', label:'Status' },
  ], state.variationOrders);

  $('contractsTable').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-btn')) return;
    showDetail(state.filtered[Number(tr.dataset.index)]);
  }));
  $('contractsTable').querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditor(btn.dataset.ref);
  }));

  document.querySelectorAll('th[data-key]').forEach(th => th.onclick = () => sortBy(th.dataset.key));
}

function renderAll() {
  const cards = kpis(state.filtered);
  $('kpiCards').innerHTML = Object.entries(cards).map(([k,v]) => `<div class="kpi"><h4>${k}</h4><p>${k.includes('Value') ? fmtMoney(v) : v}</p></div>`).join('');
  $('warnings').innerHTML = (state.warnings.length ? state.warnings : ['No validation warnings']).map(x => `<li>${x}</li>`).join('');
  renderBarChart('chartBu', groupCount(state.filtered,'businessUnit'));
  renderBarChart('chartType', groupCount(state.filtered,'contractType'));
  renderBarChart('chartStatus', groupCount(state.filtered,'contractStatus'));
  const expiry = new Map();
  state.filtered.forEach(r => {
    if (!r.effectiveExpiryDate) return;
    const m = `${r.effectiveExpiryDate.getFullYear()}-${String(r.effectiveExpiryDate.getMonth()+1).padStart(2,'0')}`;
    expiry.set(m, (expiry.get(m)||0)+1);
  });
  renderBarChart('chartExpiry', [...expiry.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-12));
  renderTables();
}

function showDetail(r) {
  const voRows = state.variationOrders.filter(v => String(v.contractKey || '').trim() === r.referenceNumber);
  $('detailBody').textContent = [
    `Contract Reference Number: ${r.referenceNumber}`,
    `Description: ${r.description || ''}`,
    `Business Unit: ${r.businessUnit || ''}`,
    `Type: ${r.contractType || ''}`,
    `Contractor: ${r.contractorName || ''}`,
    `PO Number: ${r.poNumber || ''}`,
    `Status: ${r.contractStatus}`,
    `Expiry: ${fmtDate(r.effectiveExpiryDate)} | Days Remaining: ${r.daysRemaining ?? ''}`,
    `Base: ${fmtMoney(r.baseValue)} | VO: ${fmtMoney(r.totalVOValue)} | Final: ${fmtMoney(r.finalRevisedValue)}`,
    '', 'Variation Orders:', ...voRows.map(v => `- ${v.voNumber || ''} | ${fmtDate(parseDate(v.voDate))} | ${v.voDescription || ''} | ${fmtMoney(v.voAmount)} | ${v.voStatus || ''}`),
  ].join('\n');
  $('detailDialog').showModal();
}

function sortBy(key) {
  if (!key || key === '_row' || key === 'actions') return;
  state.sort.asc = state.sort.key === key ? !state.sort.asc : true;
  state.sort.key = key;
  state.filtered.sort((a,b)=>((a[key] ?? '') > (b[key] ?? '') ? 1 : (a[key] ?? '') < (b[key] ?? '') ? -1 : 0) * (state.sort.asc ? 1 : -1));
  renderTables();
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const status = $('statusFilter').value, bu = $('buFilter').value, type = $('typeFilter').value, ext = $('extensionFilter').value, vo = $('voFilter').value;
  state.filtered = state.contracts.filter(r => {
    const search = !q || [r.referenceNumber,r.description,r.contractorName,r.poNumber].some(v => String(v||'').toLowerCase().includes(q));
    return search
      && (status==='all' || r.contractStatus===status)
      && (bu==='all' || String(r.businessUnit||'')===bu)
      && (type==='all' || String(r.contractType||'')===type)
      && (ext==='all' || (ext==='yes' ? r.hasExtension : !r.hasExtension))
      && (vo==='all' || (vo==='yes' ? r.hasVO : !r.hasVO));
  });
  renderAll();
}

function renderFilters() {
  const fill = (id, label, vals) => {
    const sel = $(id), cur = sel.value || 'all';
    sel.innerHTML = `<option value="all">${label}: All</option>` + vals.map(v => `<option value="${v}">${label}: ${v}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
  };
  fill('statusFilter','Status',[...new Set(state.contracts.map(r=>r.contractStatus).filter(Boolean))]);
  fill('buFilter','Business Unit',[...new Set(state.contracts.map(r=>r.businessUnit).filter(Boolean))]);
  fill('typeFilter','Contract Type',[...new Set(state.contracts.map(r=>r.contractType).filter(Boolean))]);
}

async function loadFromFile(file) {
  $('statusLabel').textContent = 'Reading workbook...';
  const wb = await XLSXLite.readWorkbook(file);
  const rawContracts = wb.sheets.contracts_filtered || [];
  const vos = wb.sheets.variation_orders || [];

  state.warnings = [];
  const missing = REQUIRED_COLUMNS.filter(c => !rawContracts[0] || !(c in rawContracts[0]));
  if (!rawContracts.length) state.warnings.push('No rows found in contracts_filtered sheet.');
  if (missing.length) state.warnings.push(`Missing columns in contracts_filtered: ${missing.join(', ')}`);

  const contracts = rawContracts.map(r => ({ ...Object.fromEntries(REQUIRED_COLUMNS.map(c => [c, r[c] ?? ''])), ...r }));
  const enriched = enrich(contracts, vos);
  state.contracts = enriched.rows;
  state.filtered = [...state.contracts];
  state.variationOrders = vos;
  state.warnings.push(...enriched.warnings.slice(0, 50));
  renderFilters();
  renderAll();
  $('statusLabel').textContent = `Loaded ${state.contracts.length} contracts`;
}

async function refresh() {
  try { if (state.file) await loadFromFile(state.file); }
  catch (e) { $('statusLabel').textContent = `Error: ${e.message}`; }
}

async function pickFile() {
  try {
    if (!window.showOpenFilePicker) return alert('Use latest Edge/Chrome for local file access.');
    const [h] = await window.showOpenFilePicker({ types:[{ description:'Excel Workbook', accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']} }], multiple:false });
    state.fileHandle = h;
    state.file = await h.getFile();
    state.lastModified = state.file.lastModified;
    $('fileLabel').textContent = state.file.name;
    await refresh();
  } catch (e) {
    if (e.name !== 'AbortError') $('statusLabel').textContent = e.message;
  }
}

async function saveWorkbook() {
  if (!state.fileHandle || !state.file) return alert('Open Excel file first.');

  const contractsRows = state.contracts.map(r => {
    const out = {};
    REQUIRED_COLUMNS.forEach(c => {
      if (c === 'contractKey' || c === 'referenceNumber') out[c] = r.referenceNumber;
      else if (c.endsWith('Obj')) out[c] = fmtDate(parseDate(r[c]));
      else out[c] = r[c] ?? '';
    });
    out.signingDate = out.signingDate || out.signingDateObj;
    out.commencementDate = out.commencementDate || out.commencementDateObj;
    out.expiryDate = out.expiryDate || out.expiryDateObj;
    return out;
  });

  const voRows = state.variationOrders.map(v => ({
    contractKey: String(v.contractKey || v.referenceNumber || ''),
    voNumber: v.voNumber || '', voDate: fmtDate(parseDate(v.voDate)), voDescription: v.voDescription || '',
    voAmount: parseNumber(v.voAmount), voStatus: v.voStatus || '',
  }));

  const blob = await XLSXLite.updateWorkbookBlob(state.file, { contractsRows, voRows });
  const writable = await state.fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  state.file = await state.fileHandle.getFile();
  state.lastModified = state.file.lastModified;
  $('statusLabel').textContent = `Updated same file: ${state.file.name}`;
}

function openEditor(ref = null) {
  state.selectedRef = ref;
  const row = ref ? state.contracts.find(r => r.referenceNumber === ref) : null;
  const form = $('editorForm');
  $('editorTitle').textContent = row ? `Edit ${row.referenceNumber}` : 'Add New Contract';
  EDITABLE_FIELDS.forEach(f => {
    const el = form.elements[f];
    if (!el) return;
    const v = row ? row[f] : '';
    el.value = el.type === 'date' ? fmtDate(parseDate(v)) : (v ?? '');
  });
  $('deleteContractBtn').style.display = row ? 'inline-block' : 'none';
  $('editorDialog').showModal();
}

function saveEditor() {
  const form = $('editorForm');
  const payload = Object.fromEntries(EDITABLE_FIELDS.map(f => [f, form.elements[f]?.value ?? '']));
  if (!payload.referenceNumber) return alert('Contract Reference Number is required.');

  payload.contractKey = payload.referenceNumber;
  payload.baseValue = parseNumber(payload.baseValue);
  payload.extensionCount = parseInt(payload.extensionCount || 0, 10) || 0;
  payload.signingDate = payload.signingDateObj;
  payload.commencementDate = payload.commencementDateObj;
  payload.expiryDate = payload.expiryDateObj;

  const idx = state.contracts.findIndex(r => r.referenceNumber === (state.selectedRef || payload.referenceNumber));
  if (idx >= 0) state.contracts[idx] = { ...state.contracts[idx], ...payload };
  else state.contracts.push({ ...Object.fromEntries(REQUIRED_COLUMNS.map(c => [c, ''])), ...payload });

  state.contracts = enrich(state.contracts, state.variationOrders).rows;
  applyFilters();
  $('editorDialog').close();
  $('statusLabel').textContent = 'Updated in app. Click Save Changes to Excel.';
}

function deleteCurrentContract() {
  if (!state.selectedRef) return;
  if (!confirm('Delete this contract?')) return;
  state.contracts = state.contracts.filter(r => r.referenceNumber !== state.selectedRef);
  state.variationOrders = state.variationOrders.filter(v => String(v.contractKey || '').trim() !== state.selectedRef);
  state.contracts = enrich(state.contracts, state.variationOrders).rows;
  applyFilters();
  $('editorDialog').close();
  $('statusLabel').textContent = 'Deleted in app. Click Save Changes to Excel.';
}

async function pollChanges() {
  if (!state.fileHandle) return;
  try {
    const f = await state.fileHandle.getFile();
    if (f.lastModified !== state.lastModified) {
      state.file = f; state.lastModified = f.lastModified;
      $('statusLabel').textContent = 'Excel changed externally. Auto-refreshing...';
      await refresh();
    }
  } catch {}
}

function initEvents() {
  $('pickFileBtn').onclick = pickFile;
  $('refreshBtn').onclick = async () => { if (state.fileHandle) { state.file = await state.fileHandle.getFile(); state.lastModified = state.file.lastModified; } await refresh(); };
  $('saveWorkbookBtn').onclick = saveWorkbook;
  ['searchInput','statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).addEventListener('input', applyFilters));
  $('clearFiltersBtn').onclick = () => { $('searchInput').value=''; ['statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).value='all'); applyFilters(); };
  $('addContractBtn').onclick = () => openEditor();
  $('saveContractBtn').onclick = (e) => { e.preventDefault(); saveEditor(); };
  $('deleteContractBtn').onclick = (e) => { e.preventDefault(); deleteCurrentContract(); };
  $('cancelEditorBtn').onclick = (e) => { e.preventDefault(); $('editorDialog').close(); };
  $('exportCsvBtn').onclick = () => {
    if (!state.filtered.length) return;
    const cols = Object.keys(state.filtered[0]);
    const csv = [cols.join(','), ...state.filtered.map(r => cols.map(c => JSON.stringify(r[c] instanceof Date ? fmtDate(r[c]) : (r[c] ?? '')).replace(/\n/g, ' ')).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    a.download = 'contracts_export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('printBtn').onclick = () => window.print();
  $('closeDialogBtn').onclick = () => $('detailDialog').close();

  document.querySelectorAll('.nav-btn').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $(btn.dataset.page).classList.add('active');
  });
}

initEvents();
setInterval(pollChanges, 5000);
