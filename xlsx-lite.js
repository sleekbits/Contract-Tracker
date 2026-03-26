/* Minimal XLSX read/write for offline browser use (no external libs). */
(function (global) {
  const textDecoder = new TextDecoder('utf-8');
  const textEncoder = new TextEncoder();

  function u16(v, o) { return v[o] | (v[o + 1] << 8); }
  function u32(v, o) { return (v[o]) | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24); }
  function put16(a, v) { a.push(v & 255, (v >> 8) & 255); }
  function put32(a, v) { a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser does not support DecompressionStream');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function unzip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid XLSX (EOCD not found)');

    const cdOffset = u32(bytes, eocd + 16);
    const cdSize = u32(bytes, eocd + 12);
    const files = new Map();
    let p = cdOffset;

    while (p < cdOffset + cdSize) {
      if (!(bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x01 && bytes[p + 3] === 0x02)) break;
      const method = u16(bytes, p + 10);
      const compSize = u32(bytes, p + 20);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const localOffset = u32(bytes, p + 42);
      const name = textDecoder.decode(bytes.slice(p + 46, p + 46 + nameLen));

      const lfh = localOffset;
      const lfNameLen = u16(bytes, lfh + 26);
      const lfExtraLen = u16(bytes, lfh + 28);
      const dataStart = lfh + 30 + lfNameLen + lfExtraLen;
      const compData = bytes.slice(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = compData;
      else if (method === 8) data = await inflateRaw(compData);
      else throw new Error(`Unsupported ZIP compression method ${method} in ${name}`);
      files.set(name, data);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function xmlFromBytes(bytes) { return new DOMParser().parseFromString(textDecoder.decode(bytes), 'application/xml'); }

  function parseWorkbook(files) {
    const wbBytes = files.get('xl/workbook.xml');
    const relBytes = files.get('xl/_rels/workbook.xml.rels');
    if (!wbBytes || !relBytes) throw new Error('Workbook relationship files missing');
    const wb = xmlFromBytes(wbBytes);
    const rels = xmlFromBytes(relBytes);
    const relMap = new Map([...rels.getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    return [...wb.getElementsByTagName('sheet')].map(s => {
      const target = relMap.get(s.getAttribute('r:id'));
      return { name: s.getAttribute('name'), path: target.startsWith('xl/') ? target : `xl/${target.replace(/^\/?/, '')}` };
    });
  }

  function parseSharedStrings(files) {
    const entry = files.get('xl/sharedStrings.xml');
    if (!entry) return [];
    const doc = xmlFromBytes(entry);
    return [...doc.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent || '').join(''));
  }

  function excelSerialToDate(serial) {
    const utc = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(utc);
  }

  function cellValue(c, sharedStrings) {
    const t = c.getAttribute('t');
    const vNode = c.getElementsByTagName('v')[0];
    if (!vNode) return '';
    const raw = vNode.textContent || '';
    if (t === 's') return sharedStrings[Number(raw)] || '';
    if (t === 'b') return raw === '1';
    if (!Number.isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  function parseSheet(files, path, sharedStrings) {
    const bytes = files.get(path); if (!bytes) return [];
    const doc = xmlFromBytes(bytes);
    const rows = [...doc.getElementsByTagName('row')];
    const matrix = [];
    for (const row of rows) {
      const arr = [];
      for (const c of [...row.getElementsByTagName('c')]) {
        const ref = c.getAttribute('r') || '';
        const colIndex = ref.replace(/[0-9]/g, '').split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        arr[colIndex] = cellValue(c, sharedStrings);
      }
      matrix.push(arr);
    }
    if (!matrix.length) return [];
    const headers = matrix[0].map(h => String(h || '').trim());
    return matrix.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, r[i] ?? ''])));
  }

  async function readWorkbook(file) {
    const files = await unzip(await file.arrayBuffer());
    const shared = parseSharedStrings(files);
    const sheets = parseWorkbook(files);
    const out = {};
    const paths = {};
    for (const s of sheets) {
      out[s.name] = parseSheet(files, s.path, shared);
      paths[s.name] = s.path;
    }
    return { sheets: out, excelSerialToDate, sheetPaths: paths };
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(n) {
    let s = '';
    let x = n + 1;
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  function buildSheetXml(rows) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    const allRows = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
    allRows.forEach((arr, ri) => {
      lines.push(`<row r="${ri + 1}">`);
      arr.forEach((v, ci) => {
        const ref = `${colName(ci)}${ri + 1}`;
        if (v === null || v === undefined || v === '') lines.push(`<c r="${ref}" t="inlineStr"><is><t></t></is></c>`);
        else if (typeof v === 'number' && Number.isFinite(v)) lines.push(`<c r="${ref}"><v>${v}</v></c>`);
        else lines.push(`<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`);
      });
      lines.push('</row>');
    });
    lines.push('</sheetData></worksheet>');
    return textEncoder.encode(lines.join(''));
  }

  function zipStoreFromMap(fileMap) {
    const parts = [];
    const cd = [];
    let offset = 0;

    [...fileMap.entries()].forEach(([name, data]) => {
      const nameBytes = textEncoder.encode(name);
      const payload = data instanceof Uint8Array ? data : textEncoder.encode(String(data));
      const crc = crc32(payload);

      const local = [];
      put32(local, 0x04034b50); put16(local, 20); put16(local, 0); put16(local, 0);
      put16(local, 0); put16(local, 0); put32(local, crc); put32(local, payload.length); put32(local, payload.length);
      put16(local, nameBytes.length); put16(local, 0); local.push(...nameBytes);
      parts.push(new Uint8Array(local), payload);

      const central = [];
      put32(central, 0x02014b50); put16(central, 20); put16(central, 20); put16(central, 0); put16(central, 0);
      put16(central, 0); put16(central, 0); put32(central, crc); put32(central, payload.length); put32(central, payload.length);
      put16(central, nameBytes.length); put16(central, 0); put16(central, 0); put16(central, 0); put16(central, 0); put32(central, 0);
      put32(central, offset); central.push(...nameBytes);
      cd.push(new Uint8Array(central));
      offset += local.length + payload.length;
    });

    const cdStart = offset;
    let cdSize = 0;
    cd.forEach(c => { parts.push(c); cdSize += c.length; });

    const eocd = [];
    put32(eocd, 0x06054b50); put16(eocd, 0); put16(eocd, 0);
    put16(eocd, fileMap.size); put16(eocd, fileMap.size);
    put32(eocd, cdSize); put32(eocd, cdStart); put16(eocd, 0);
    parts.push(new Uint8Array(eocd));
    return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function updateWorkbookBlob(file, { contractsRows, voRows }) {
    const files = await unzip(await file.arrayBuffer());
    const sheets = parseWorkbook(files);
    const mapByName = new Map(sheets.map(s => [s.name, s.path]));

    if (mapByName.has('contracts_filtered')) files.set(mapByName.get('contracts_filtered'), buildSheetXml(contractsRows));
    if (mapByName.has('variation_orders')) files.set(mapByName.get('variation_orders'), buildSheetXml(voRows));

    return zipStoreFromMap(files);
  }

  global.XLSXLite = { readWorkbook, excelSerialToDate, updateWorkbookBlob };
})(window);
