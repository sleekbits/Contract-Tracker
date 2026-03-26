const state = {
  fileHandle: null, file: null, lastModified: 0,
  contracts: [], variationOrders: [], filtered: [], warnings: [],
  sort: { key: '', asc: true },
  selectedContractKey: null,
};

const REQUIRED_COLUMNS = ['contractKey','businessUnit','madeBy','contractType','referenceNumber','description','contractorName','poNumber','signingDate','commencementDate','expiryDate','extensionCount','extensionDates','baseValue','__source','signingDateObj','commencementDateObj','expiryDateObj','revisedExpiryDateObj','revisedExpiryWithVOObj'];
const EDITABLE_FIELDS = ['contractKey','businessUnit','madeBy','contractType','referenceNumber','description','contractorName','poNumber','signingDateObj','commencementDateObj','expiryDateObj','revisedExpiryDateObj','revisedExpiryWithVOObj','extensionCount','extensionDates','baseValue'];

const $ = (id) => document.getElementById(id);
const fmtMoney = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';

const parseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number') return XLSXLite.excelSerialToDate(value);
  const d = new Date(value);
  return isNaN(d) ? null : d;
};
const parseNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

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
    const extCount = parseInt(r.extensionCount || 0, 10) || 0;
    const durationDays = comm && expiry ? Math.floor((expiry - comm) / 86400000) : null;
    if (durationDays !== null && durationDays < 0) warnings.push(`Contract ${r.contractKey || r.referenceNumber || '(unknown)'} has expiry before commencement.`);

    return {
      ...r,
      signingDateObj: signing, commencementDateObj: comm, expiryDateObj: expiry,
      revisedExpiryDateObj: revExp, revisedExpiryWithVOObj: revVoExp, effectiveExpiryDate: effective,
      extensionCount: extCount,
      voCount: voRows.length, totalVOValue: totalVO,
      baseValue: parseNumber(r.baseValue),
      finalRevisedValue: parseNumber(r.baseValue) + totalVO,
      durationDays,
      revisedDurationDays: comm && effective ? Math.floor((effective - comm) / 86400000) : null,
      daysRemaining: effective ? Math.floor((effective - today) / 86400000) : null,
      contractStatus: '',
      expiring30: effective ? Math.floor((effective - today) / 86400000) <= 30 && Math.floor((effective - today) / 86400000) >= 0 : false,
      expiring60: effective ? Math.floor((effective - today) / 86400000) <= 60 && Math.floor((effective - today) / 86400000) >= 0 : false,
      expiring90: effective ? Math.floor((effective - today) / 86400000) <= 90 && Math.floor((effective - today) / 86400000) >= 0 : false,
      hasExtension: extCount > 0,
      hasVO: voRows.length > 0,
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
  const m = new Map();
  rows.forEach(r => m.set(String(r[key] || 'Unknown'), (m.get(String(r[key] || 'Unknown')) || 0) + 1));
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

function renderBarChart(elId, data) {
  const el = $(elId); el.innerHTML = '';
  const max = Math.max(1, ...data.map(x => x[1]));
  data.slice(0, 12).forEach(([label, value]) => {
    const row = document.createElement('div'); row.className = 'bar';
    row.innerHTML = `<div class="bar-label" title="${label}">${label}</div><div class="bar-track"><div class="bar-fill" style="width:${(value/max)*100}%"></div></div><div class="bar-value">${value}</div>`;
    el.appendChild(row);
  });
}

function renderKpi() {
  const data = kpis(state.filtered);
  $('kpiCards').innerHTML = Object.entries(data).map(([k,v]) => `<div class="kpi"><h4>${k}</h4><p>${k.includes('Value') ? fmtMoney(v) : v}</p></div>`).join('');
}

function renderWarnings() {
  $('warnings').innerHTML = (state.warnings.length ? state.warnings : ['No validation warnings']).map(x => `<li>${x}</li>`).join('');
}

function statusBadge(s) { return `<span class="status ${String(s).replace(/\s/g,'-')}">${s}</span>`; }

function tableHtml(columns, rows) {
  const header = `<tr>${columns.map(c => `<th data-key="${c.key}">${c.label}</th>`).join('')}</tr>`;
  const body = rows.map((r,i) => `<tr data-index="${i}">${columns.map(c => `<td>${c.render ? c.render(r,i) : (r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<thead>${header}</thead><tbody>${body}</tbody>`;
}

function renderTables() {
  $('contractsTable').innerHTML = tableHtml([
    { key:'_row', label:'#', render:(_,i)=>i+1 },
    { key:'contractKey', label:'Contract Key' }, { key:'referenceNumber', label:'Reference #' },
    { key:'businessUnit', label:'Business Unit' }, { key:'contractType', label:'Contract Type' },
    { key:'contractorName', label:'Contractor' }, { key:'poNumber', label:'PO #' },
    { key:'contractStatus', label:'Status', render:r=>statusBadge(r.contractStatus) },
    { key:'commencementDateObj', label:'Start', render:r=>fmtDate(r.commencementDateObj) },
    { key:'effectiveExpiryDate', label:'Expiry', render:r=>fmtDate(r.effectiveExpiryDate) },
    { key:'daysRemaining', label:'Days Left' },
    { key:'baseValue', label:'Base Value', render:r=>fmtMoney(r.baseValue) },
    { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) },
    { key:'actions', label:'Actions', render:r=>`<button class="edit-btn" data-key="${r.contractKey}">Edit</button>` }
  ], state.filtered);

  $('expiryTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' }, { key:'referenceNumber', label:'Reference #' }, { key:'contractorName', label:'Contractor' },
    { key:'effectiveExpiryDate', label:'Effective Expiry', render:r=>fmtDate(r.effectiveExpiryDate) }, { key:'daysRemaining', label:'Days Remaining' },
    { key:'contractStatus', label:'Status', render:r=>statusBadge(r.contractStatus) },
    { key:'expiring30', label:'30d', render:r=>r.expiring30?'Yes':'No' }, { key:'expiring60', label:'60d', render:r=>r.expiring60?'Yes':'No' }, { key:'expiring90', label:'90d', render:r=>r.expiring90?'Yes':'No' }
  ], [...state.filtered].sort((a,b)=>(a.daysRemaining??999999)-(b.daysRemaining??999999)));

  $('extensionTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' },{ key:'referenceNumber', label:'Reference #' },
    { key:'extensionCount', label:'Extension Count' },{ key:'extensionDates', label:'Extension Dates' },
    { key:'expiryDateObj', label:'Original Expiry', render:r=>fmtDate(r.expiryDateObj) },
    { key:'revisedExpiryDateObj', label:'Revised Expiry', render:r=>fmtDate(r.revisedExpiryDateObj) },
    { key:'revisedDurationDays', label:'Revised Duration Days' }
  ], state.filtered.filter(r=>r.hasExtension));

  $('voSummaryTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' }, { key:'referenceNumber', label:'Reference #' }, { key:'contractorName', label:'Contractor' },
    { key:'voCount', label:'VO Count' }, { key:'totalVOValue', label:'Total VO', render:r=>fmtMoney(r.totalVOValue) }, { key:'finalRevisedValue', label:'Final Value', render:r=>fmtMoney(r.finalRevisedValue) }
  ], state.filtered.filter(r=>r.hasVO));

  $('voTable').innerHTML = tableHtml([
    { key:'contractKey', label:'Contract Key' }, { key:'voNumber', label:'VO Number' }, { key:'voDate', label:'VO Date', render:r=>fmtDate(parseDate(r.voDate)) },
    { key:'voDescription', label:'Description' }, { key:'voAmount', label:'Amount', render:r=>fmtMoney(parseNumber(r.voAmount)) }, { key:'voStatus', label:'Status' }
  ], state.variationOrders);

  $('contractsTable').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-btn')) return;
    showDetail(state.filtered[Number(tr.dataset.index)]);
  }));
  $('contractsTable').querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditor(btn.dataset.key);
  }));

  document.querySelectorAll('th[data-key]').forEach(th => th.onclick = () => sortBy(th.dataset.key));
}

function showDetail(r) {
  const voRows = state.variationOrders.filter(v => String(v.contractKey||'') === String(r.contractKey||''));
  $('detailBody').textContent = [
    `Contract Key: ${r.contractKey || ''}`,
    `Reference Number: ${r.referenceNumber || ''}`,
    `Business Unit: ${r.businessUnit || ''}`,
    `Made By: ${r.madeBy || ''}`,
    `Contract Type: ${r.contractType || ''}`,
    `Description: ${r.description || ''}`,
    `Contractor: ${r.contractorName || ''}`,
    `PO Number: ${r.poNumber || ''}`,
    `Status: ${r.contractStatus}`,
    `Commencement: ${fmtDate(r.commencementDateObj)} | Expiry: ${fmtDate(r.effectiveExpiryDate)} | Days Remaining: ${r.daysRemaining ?? ''}`,
    `Base Value: ${fmtMoney(r.baseValue)} | Total VO: ${fmtMoney(r.totalVOValue)} | Final: ${fmtMoney(r.finalRevisedValue)}`,
    '', 'Variation Orders:', ...voRows.map(v=>`- ${v.voNumber||''} | ${fmtDate(parseDate(v.voDate))} | ${v.voDescription||''} | ${fmtMoney(v.voAmount)} | ${v.voStatus||''}`)
  ].join('\n');
  $('detailDialog').showModal();
}

function sortBy(key) {
  if (!key || key === '_row' || key === 'actions') return;
  state.sort.asc = state.sort.key === key ? !state.sort.asc : true;
  state.sort.key = key;
  state.filtered.sort((a,b)=>{
    const av=a[key], bv=b[key];
    const cmp = (av ?? '') > (bv ?? '') ? 1 : (av ?? '') < (bv ?? '') ? -1 : 0;
    return state.sort.asc ? cmp : -cmp;
  });
  renderTables();
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();
  const status = $('statusFilter').value, bu = $('buFilter').value, type = $('typeFilter').value, ext = $('extensionFilter').value, vo = $('voFilter').value;
  state.filtered = state.contracts.filter(r => {
    const search = !q || [r.referenceNumber,r.description,r.contractorName,r.poNumber,r.contractKey].some(v => String(v||'').toLowerCase().includes(q));
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
    sel.value = [...sel.options].some(o=>o.value===cur) ? cur : 'all';
  };
  fill('statusFilter','Status',[...new Set(state.contracts.map(r=>r.contractStatus).filter(Boolean))]);
  fill('buFilter','Business Unit',[...new Set(state.contracts.map(r=>r.businessUnit).filter(Boolean))]);
  fill('typeFilter','Contract Type',[...new Set(state.contracts.map(r=>r.contractType).filter(Boolean))]);
}

function renderAll() {
  renderKpi(); renderWarnings();
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
  $('statusLabel').textContent = `Loaded ${state.contracts.length} contracts${state.fileHandle ? ' (unsaved edits supported)' : ''}`;
}

async function loadFromFile(file) {
  $('statusLabel').textContent = 'Reading workbook...';
  const wb = await XLSXLite.readWorkbook(file);
  const rawContracts = wb.sheets.contracts_filtered || [];
  const vos = wb.sheets.variation_orders || [];
  const missing = REQUIRED_COLUMNS.filter(c => !rawContracts[0] || !(c in rawContracts[0]));
  state.warnings = [];
  if (!rawContracts.length) state.warnings.push('No rows found in contracts_filtered sheet.');
  if (missing.length) state.warnings.push(`Missing columns in contracts_filtered: ${missing.join(', ')}`);
  if (!wb.sheets.variation_orders) state.warnings.push('Sheet variation_orders not found. Add it later for VO tracking.');

  const contracts = rawContracts.map(r => ({ ...Object.fromEntries(REQUIRED_COLUMNS.map(c => [c, r[c] ?? ''])), ...r }));
  const enriched = enrich(contracts, vos);
  state.contracts = enriched.rows;
  state.filtered = [...state.contracts];
  state.variationOrders = vos;
  state.warnings.push(...enriched.warnings.slice(0,50));
  renderFilters(); renderAll();
}

async function refresh() {
  try { if (!state.file) return; await loadFromFile(state.file); }
  catch (e) { $('statusLabel').textContent = `Error: ${e.message}`; }
}

async function pickFile() {
  try {
    if (!window.showOpenFilePicker) return alert('Use latest Edge/Chrome for local file access.');
    const [h] = await window.showOpenFilePicker({
      types:[{description:'Excel Workbook',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],multiple:false,
    });
    state.fileHandle = h; state.file = await h.getFile(); state.lastModified = state.file.lastModified;
    $('fileLabel').textContent = state.file.name;
    await refresh();
  } catch (e) { if (e.name !== 'AbortError') $('statusLabel').textContent = e.message; }
}

async function saveWorkbook() {
  if (!state.fileHandle) return alert('Open Excel file first.');
  const contractsRows = state.contracts.map(r => {
    const out = {};
    REQUIRED_COLUMNS.forEach(c => {
      if (c.endsWith('Obj')) out[c] = fmtDate(parseDate(r[c]));
      else out[c] = r[c] ?? '';
    });
    out.signingDate = out.signingDate || out.signingDateObj;
    out.commencementDate = out.commencementDate || out.commencementDateObj;
    out.expiryDate = out.expiryDate || out.expiryDateObj;
    return out;
  });
  const voRows = state.variationOrders.map(v => ({
    contractKey: v.contractKey || '', voNumber: v.voNumber || '', voDate: fmtDate(parseDate(v.voDate)), voDescription: v.voDescription || '', voAmount: parseNumber(v.voAmount), voStatus: v.voStatus || ''
  }));

  const blob = XLSXLite.buildWorkbookBlob({ contractsRows, voRows });
  const writable = await state.fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  state.file = await state.fileHandle.getFile();
  state.lastModified = state.file.lastModified;
  $('statusLabel').textContent = `Saved changes to ${state.file.name}`;
}

function openEditor(contractKey = null) {
  state.selectedContractKey = contractKey;
  const form = $('editorForm');
  const row = contractKey ? state.contracts.find(r => String(r.contractKey) === String(contractKey)) : null;
  $('editorTitle').textContent = row ? `Edit Contract ${row.referenceNumber || row.contractKey}` : 'Add New Contract';
  EDITABLE_FIELDS.forEach(name => {
    const el = form.elements[name];
    if (!el) return;
    const value = row ? row[name] : '';
    el.value = el.type === 'date' ? fmtDate(parseDate(value)) : (value ?? '');
  });
  $('deleteContractBtn').style.display = row ? 'inline-block' : 'none';
  $('editorDialog').showModal();
}

function saveEditor() {
  const form = $('editorForm');
  const payload = Object.fromEntries(EDITABLE_FIELDS.map(k => [k, form.elements[k]?.value ?? '']));
  payload.baseValue = parseNumber(payload.baseValue);
  payload.extensionCount = parseInt(payload.extensionCount || 0, 10) || 0;
  payload.signingDate = payload.signingDateObj;
  payload.commencementDate = payload.commencementDateObj;
  payload.expiryDate = payload.expiryDateObj;

  if (!payload.contractKey || !payload.referenceNumber) return alert('Contract Key and Reference Number are required.');

  const idx = state.contracts.findIndex(r => String(r.contractKey) === String(state.selectedContractKey || payload.contractKey));
  if (idx >= 0) state.contracts[idx] = { ...state.contracts[idx], ...payload };
  else state.contracts.push({ ...Object.fromEntries(REQUIRED_COLUMNS.map(c => [c, ''])), ...payload });

  const enriched = enrich(state.contracts, state.variationOrders);
  state.contracts = enriched.rows;
  applyFilters();
  $('editorDialog').close();
  $('statusLabel').textContent = 'Contract updated in app. Click "Save Changes to Excel" to persist.';
}

function deleteCurrentContract() {
  if (!state.selectedContractKey) return;
  if (!confirm('Delete this contract? This action will update the in-app data.')) return;
  state.contracts = state.contracts.filter(r => String(r.contractKey) !== String(state.selectedContractKey));
  state.variationOrders = state.variationOrders.filter(v => String(v.contractKey) !== String(state.selectedContractKey));
  const enriched = enrich(state.contracts, state.variationOrders);
  state.contracts = enriched.rows;
  applyFilters();
  $('editorDialog').close();
  $('statusLabel').textContent = 'Contract deleted in app. Click "Save Changes to Excel" to persist.';
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
  $('refreshBtn').onclick = async () => { if (state.fileHandle) { state.file = await state.fileHandle.getFile(); state.lastModified = state.file.lastModified; } refresh(); };
  $('saveWorkbookBtn').onclick = saveWorkbook;
  ['searchInput','statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).addEventListener('input', applyFilters));
  $('clearFiltersBtn').onclick = () => { $('searchInput').value=''; ['statusFilter','buFilter','typeFilter','extensionFilter','voFilter'].forEach(id => $(id).value='all'); applyFilters(); };
  $('addContractBtn').onclick = () => openEditor(null);

  $('saveContractBtn').onclick = (e) => { e.preventDefault(); saveEditor(); };
  $('deleteContractBtn').onclick = (e) => { e.preventDefault(); deleteCurrentContract(); };
  $('cancelEditorBtn').onclick = (e) => { e.preventDefault(); $('editorDialog').close(); };

  document.querySelectorAll('.nav-btn').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); $(btn.dataset.page).classList.add('active');
  });

  $('exportCsvBtn').onclick = () => {
    if (!state.filtered.length) return;
    const cols = Object.keys(state.filtered[0]);
    const csv = [cols.join(','), ...state.filtered.map(r => cols.map(c => JSON.stringify(r[c] instanceof Date ? fmtDate(r[c]) : (r[c] ?? '')).replace(/\n/g,' ')).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' })); a.download = 'contracts_export.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('printBtn').onclick = () => window.print();
  $('closeDialogBtn').onclick = () => $('detailDialog').close();
}

initEvents();
setInterval(pollChanges, 5000);
