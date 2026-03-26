/* Minimal XLSX reader for offline browser use (no external libs).
   Supports standard .xlsx files with DEFLATE or STORE compression. */
(function (global) {
  const textDecoder = new TextDecoder('utf-8');

  function u16(v, o) { return v[o] | (v[o + 1] << 8); }
  function u32(v, o) { return (v[o]) | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24); }

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

  function xmlFromBytes(bytes) {
    const xml = textDecoder.decode(bytes);
    return new DOMParser().parseFromString(xml, 'application/xml');
  }

  function parseSharedStrings(files) {
    const entry = files.get('xl/sharedStrings.xml');
    if (!entry) return [];
    const doc = xmlFromBytes(entry);
    return [...doc.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent || '').join(''));
  }

  function parseWorkbook(files) {
    const wb = xmlFromBytes(files.get('xl/workbook.xml'));
    const rels = xmlFromBytes(files.get('xl/_rels/workbook.xml.rels'));
    const relMap = new Map([...rels.getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    return [...wb.getElementsByTagName('sheet')].map(s => {
      const name = s.getAttribute('name');
      const relId = s.getAttribute('r:id');
      const target = relMap.get(relId);
      const normalized = target.startsWith('xl/') ? target : `xl/${target.replace(/^\/?/, '')}`;
      return { name, path: normalized };
    });
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
    const bytes = files.get(path);
    if (!bytes) return [];
    const doc = xmlFromBytes(bytes);
    const rows = [...doc.getElementsByTagName('row')];
    const matrix = [];
    for (const row of rows) {
      const arr = [];
      for (const c of [...row.getElementsByTagName('c')]) {
        const ref = c.getAttribute('r') || '';
        const colRef = ref.replace(/[0-9]/g, '');
        const colIndex = colRef.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        arr[colIndex] = cellValue(c, sharedStrings);
      }
      matrix.push(arr);
    }
    if (!matrix.length) return [];
    const headers = matrix[0].map(h => String(h || '').trim());
    return matrix.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h || `col${i + 1}`] = r[i] ?? ''; });
      return obj;
    });
  }

  async function readWorkbook(file) {
    const ab = await file.arrayBuffer();
    const files = await unzip(ab);
    const shared = parseSharedStrings(files);
    const sheets = parseWorkbook(files);
    const out = {};
    for (const s of sheets) out[s.name] = parseSheet(files, s.path, shared);
    return { sheets: out, excelSerialToDate };
  }

  global.XLSXLite = { readWorkbook, excelSerialToDate };
})(window);
