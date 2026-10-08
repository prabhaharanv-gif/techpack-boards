pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
const MIN_BOARDS = 6;
const SCALE = 2.5;
const boards = [];
const $ = s => document.querySelector(s);

async function readPdf(file) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const rows = {};
    tc.items.forEach(t => {
      if (!t.str.trim()) return;
      const y = Math.round(t.transform[5] / 3);
      (rows[y] = rows[y] || []).push({ x: t.transform[4], y: t.transform[5], h: t.height || 8, s: t.str.trim() });
    });
    const lines = Object.keys(rows).sort((a, b) => b - a).map(k => rows[k].sort((a, b) => a.x - b.x));
    pages.push({ page, lines });
  }
  return pages;
}

const SIZE_RE = /^(?:\d{1,4}|[2-6]?XS|XXS|S|M|L|XL|XXL|XXXL|\d{1,2}(?:-\d{1,2})?[MY]|NB|OS)$/i;
const GSM_RE = /(\d+(?:\.\d+)?)\s*g(?:sm)?\b/i;

function pickSizes(all) {
  const hi = all.findIndex(l => l.some(s => /Point of Measurement/i.test(s)));
  const fromList = sz => sz.length > 1 ? sz[0] + '-' + sz[sz.length - 1] : (sz[0] || '');
  if (hi >= 0) {
    // sizes may sit on the header row (between "Ref as per" and "Tolerance") or on the row just below/above it
    for (const k of [0, 1, -1, 2]) {
      let l = all[hi + k];
      if (!l) continue;
      if (k === 0) {
        const a = l.findIndex(s => /^Ref as per/i.test(s));
        const b = l.findIndex(s => /^Tolerance/i.test(s));
        l = l.slice(a + 1, b < 0 ? undefined : b);
      }
      const sz = l.filter(s => SIZE_RE.test(s));
      if (sz.length) return fromList(sz);
    }
  }
  const text = all.map(l => l.join(' ')).join('\n');
  const g = text.match(/SIZE\s*(?:GROUP|RANGE|S)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9 &,\/\-]*?)(?:\s*\(|\n|$)/i);
  return g ? g[1].trim() : '';
}

const SECTION_RE = /^(Fabrics?|Labels?|Trims?|Print|Embroidery|Packaging|Packing|Accessories|Notions|Washes?)$/i;
// Items listed under a BOM section such as "Print" or "Embroidery": rows that start with a code (PR012, EM002...)
function sectionItems(all, titleRe) {
  const out = [];
  for (let i = 0; i < all.length; i++) {
    if (!(all[i].length === 1 && titleRe.test(all[i][0]))) continue;
    for (let j = i + 1; j < all.length; j++) {
      const l = all[j];
      if (l.length === 1 && SECTION_RE.test(l[0])) break;
      if (/LABELLING AND PACKAGING|STYLE SPECIFICATION/i.test(l[0])) break;
      if (l.length > 1 && /^[A-Z]{1,4}\d+$/.test(l[0]) && l[1]) out.push(l[0] + ' ' + l[1]);
    }
  }
  return [...new Set(out)].join(' / ');
}

function extract(pages) {
  const all = pages.flatMap(p => p.lines.map(l => l.map(i => i.s)));
  const text = all.map(l => l.join(' ')).join('\n');
  const d = { style: '', name: '', sizes: '', print: 'N/A', emb: 'N/A', qty: '' };

  const m = text.match(/PRODUCT:\s*(\S+)\s+(.+)/) || text.match(/PRODUCT\s+(PB\w+)\s+(.+)/);
  if (m) { d.style = m[1]; d.name = m[2].trim(); }
  else {
    const s = text.match(/STYLE\s*(?:No\.?|#|NO)\s*:?\s*([A-Z0-9][\w\-\/ ]*?)\s+(?:FABRIC|SEASON|DESCRIPTION|\n)/i);
    const n = text.match(/DESCRIPTION\s*:?\s*(.+?)\s+COLOU?R\b/i);
    if (s) d.style = s[1].trim();
    if (n) d.name = n[1].trim();
    if (!d.style) { const h = text.match(/^STYLE\s+([A-Z]{2}\d\w*)\s+(.+?)\s+PRODUCT STORY/m); if (h) { d.style = h[1]; d.name = h[2].trim(); } }
  }

  d.sizes = pickSizes(all);

  // fabric rows: code (F###), description, GSM wherever it appears in the row
  const rowIdx = [];
  all.forEach((l, i) => { if (l.length > 2 && /^F\d+$/.test(l[0])) rowIdx.push(i); });
  const rows = rowIdx.map(i => all[i]);
  const anyG = text.match(GSM_RE);
  // a long description can wrap, leaving "420g" on the line below the row
  const gsmBelow = ri => {
    for (let j = rowIdx[ri] + 1; j < Math.min(all.length, rowIdx[ri] + 4); j++) {
      const x = all[j];
      if (/^[A-Z]{1,4}\d+$/.test(x[0]) || (x.length === 1 && SECTION_RE.test(x[0]))) break;
      const t = x.find(s => /^\d+(?:\.\d+)?\s*g(?:sm)?$/i.test(s));
      if (t) return t.match(GSM_RE)[1];
    }
    return '';
  };
  // each fabric reads "code description NNN GSM"; the GSM comes from the description, another cell of the row, or the line below
  d.details = rows.map((l, ri) => {
    const desc = String(l[1]);
    if (GSM_RE.test(desc)) return l[0] + ' ' + desc.replace(GSM_RE, '$1 GSM');
    const t = l.slice(2).find(s => GSM_RE.test(s));
    const g = t ? t.match(GSM_RE)[1] : (gsmBelow(ri) || (rows.length === 1 && anyG ? anyG[1] : ''));
    return l[0] + ' ' + desc + (g ? ' ' + g + ' GSM' : '');
  });
  if (!rows.length && anyG) d.details.push(anyG[1] + ' GSM');

  d.print = sectionItems(all, /^Print$/i) || 'N/A';
  d.emb = sectionItems(all, /^Embroidery$/i) || 'N/A';

  // colour of each fabric: the cells after the unit of measure in its row (one per colourway),
  // else the "COLOR WAYS" list on the cover page, else the last cell of the row.
  // One card is made per colourway; each card lists every fabric with its colour for that colourway.
  const UOM = /^(Each|Metre|Meter|Mtr|Kg|Yard|Yds?|Set|Pair|Pcs|Piece)$/i;
  const cw = text.match(/COLOU?R\s*WAYS?\s+(.+?)\s+SIZE\b/i);
  const cover = cw ? cw[1].split(/\s*[\/,&]\s*/).map(s => s.trim()).filter(Boolean) : [];
  const perRow = rows.map(l => {
    const u = l.findIndex(s => UOM.test(s));
    const c = u >= 0 ? l.slice(u + 1).map(s => s.trim()).filter(Boolean) : [];
    return c.length ? c : (cover.length ? cover : [String(l[l.length - 1]).trim()]);
  });
  const ncol = Math.max(1, ...perRow.map(c => c.length));
  const seen = new Set();
  d.cards = [];
  for (let j = 0; j < ncol; j++) {
    const vec = perRow.map(c => c[Math.min(j, c.length - 1)]);
    const key = vec.join('|');
    if (!seen.has(key)) { seen.add(key); d.cards.push(vec); }
  }
  return d;
}

// Pictures drawn on the page, as boxes in canvas pixels (found from the PDF's drawing operations).
async function imageBoxes(page, vp) {
  const ops = await page.getOperatorList();
  const O = pdfjsLib.OPS;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [], boxes = [];
  ops.fnArray.forEach((fn, i) => {
    const a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (area < vp.width * vp.height * 0.85 && area > 400) boxes.push(b);
    }
  });
  return boxes;
}

// The sketch sits in the largest empty vertical band between lines of text.
function sketchBand(page, lines, vp) {
  const H = page.view[3];
  const bands = lines.map(l => ({ top: Math.max(...l.map(i => i.y + i.h)), bot: Math.min(...l.map(i => i.y)) - 2 }))
    .sort((a, b) => b.top - a.top);
  const edges = [{ top: H, bot: H }, ...bands, { top: 0, bot: 0 }];
  let best = null;
  for (let i = 0; i < edges.length - 1; i++) {
    const gap = edges[i].bot - edges[i + 1].top;
    if (!best || gap > best.gap) best = { gap, y0: (H - edges[i].bot) * SCALE, y1: (H - edges[i + 1].top) * SCALE };
  }
  return best && best.gap > 40 ? best : { y0: 0, y1: vp.height };
}

// Render page 1 and crop to the sketch.
async function cropSketch(pages) {
  const { page, lines } = pages[0];
  const vp = page.getViewport({ scale: SCALE });
  const cv = document.createElement('canvas');
  cv.width = vp.width; cv.height = vp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;

  const band = sketchBand(page, lines, vp);
  let left = 0, w = cv.width, top = Math.max(0, Math.floor(band.y0)), bot = Math.min(cv.height, Math.ceil(band.y1));
  // pictures whose centre lies in the band: use them to narrow the crop
  const inBand = (await imageBoxes(page, vp)).filter(b => (b.y0 + b.y1) / 2 > band.y0 && (b.y0 + b.y1) / 2 < band.y1);
  if (inBand.length) {
    const u = inBand.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) }));
    left = Math.max(0, Math.floor(u.x0)); w = Math.max(1, Math.min(cv.width, Math.ceil(u.x1)) - left);
    top = Math.max(top, Math.floor(u.y0)); bot = Math.min(bot, Math.ceil(u.y1));
  }
  const h = Math.max(1, bot - top);
  const data = ctx.getImageData(left, top, w, h).data;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return '';
  const pad = 12;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(cv, left + x0, top + y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function addFile(file) {
  const pages = await readPdf(file);
  const { cards, details, ...d } = extract(pages);
  d.img = await cropSketch(pages);
  d.file = file.name;
  // one board per colourway, all sharing the same sketch and data; every fabric gets its own row, with its colour in brackets
  const nf = Math.max(1, details.length);
  (cards.length ? cards : [[]]).forEach(vec => {
    const b = { ...d, nf };
    for (let i = 0; i < nf; i++) b['fd' + (i + 1)] = (details[i] || '') + (vec[i] ? ' (' + vec[i] + ')' : '');
    for (const k of Object.keys(b)) if (typeof b[k] === 'string' && k !== 'img' && k !== 'file') b[k] = b[k].toUpperCase();
    boards.push(b);
  });
}

function render() {
  const box = $('#boards');
  box.innerHTML = '';
  const today = new Date().toLocaleDateString('en-GB');
  const newSheet = blank => {
    const s = document.createElement('section');
    s.className = 'sheet' + (blank ? ' blank' : '');
    s.innerHTML = '<h2 class="ptitle">Story Board <b>- Oh My Baby</b></h2><div class="pdate">' + today + '</div>';
    box.appendChild(s);
    return s;
  };
  const card = (d, g) => {
    const c = document.createElement('div');
    c.className = 'card';
    const row = ([k, label]) => `<div class="row"><span class="lab">${label}</span><div class="val" contenteditable="true" data-k="${k}"></div></div>`;
    c.innerHTML = `<button class="x" title="Remove">×</button>
      <div class="img">${d.img ? `<img src="${d.img}" alt="">` : '<span>No sketch found</span>'}</div>
      ${rowsFor(g.nf, g.nf > 1).map(row).join('')}`;
    c.querySelectorAll('.val').forEach(r => {
      r.textContent = d[r.dataset.k] || '';
      r.addEventListener('input', () => { d[r.dataset.k] = r.textContent.trim(); });
    });
    c.querySelector('.x').onclick = () => { boards.splice(boards.indexOf(d), 1); render(); };
    return c;
  };
  // pages hold whole rows of 3 boards; a board with several fabrics is taller, so fewer rows fit
  const pages = paginate(boards);
  pages.forEach((pg, pi) => {
    const sheet = newSheet(false);
    if (pi === pages.length - 1) sheet.classList.add('lastreal');
    pg.groups.forEach(g => {
      // one grid per row of 3 boards, so the same rows line up across the boards (see .grp in the CSS)
      const grp = document.createElement('div');
      grp.className = 'grp';
      grp.style.setProperty('--n', 1 + rowsFor(g.nf, false).length);
      g.items.forEach(d => grp.appendChild(card(d, g)));
      sheet.appendChild(grp);
    });
  });
  const fill = Math.max(0, MIN_BOARDS - boards.length);
  if (fill) {
    const sheet = newSheet(true);
    for (let i = 0; i < fill; i++) {
      const c = document.createElement('div');
      c.className = 'card empty';
      c.innerHTML = `<div class="img"><span>Board ${boards.length + i + 1} — upload a PDF</span></div>`;
      sheet.appendChild(c);
    }
  }
}

async function handle(files) {
  const pdfs = [...files].filter(f => /\.pdf$/i.test(f.name));
  for (const f of pdfs) {
    $('#status').textContent = `Reading ${f.name}…`;
    try { await addFile(f); } catch (e) { console.error(e); $('#status').textContent = `Could not read ${f.name}`; continue; }
    render();
  }
  const n = boards.length;
  $('#status').textContent = n < MIN_BOARDS
    ? `${n} board(s) loaded — upload ${MIN_BOARDS - n} more to fill the sheet.`
    : `${n} boards loaded. Click any cell to edit (e.g. GSM).`;
}

$('#file').onchange = e => { handle(e.target.files); e.target.value = ''; };
$('#clear').onclick = () => { boards.length = 0; render(); $('#status').textContent = ''; };
const needBoards = fn => () => boards.length ? fn().catch(e => { console.error(e); $('#status').textContent = 'Download failed: ' + e.message; }) : ($('#status').textContent = 'Upload at least one PDF first.');
$('#print').onclick = () => window.print();
$('#dlpdf').onclick = needBoards(downloadPdf);
$('#dlxls').onclick = needBoards(downloadXlsx);
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handle(e.dataTransfer.files));
render();
