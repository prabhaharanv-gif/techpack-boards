// Board rows, page layout, and downloads: PDF (A4 landscape) and Excel (same board layout, plus a plain data sheet).
const todayText = () => new Date().toLocaleDateString('en-GB');
const stamp = () => new Date().toISOString().slice(0, 10);
const loadImg = src => new Promise(r => { if (!src) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

// Rows of a board. Each fabric is one row (colour in brackets); several fabrics are numbered "FABRIC DETAILS - n".
function rowsFor(nf, numbered) {
  const r = [['name', 'PRODUCT DESCRIPTION'], ['sizes', 'SIZE RANGE'], ['style', 'STYLE No.']];
  for (let i = 1; i <= nf; i++) {
    r.push(['fd' + i, numbered ? `FABRIC DETAILS - ${i}` : 'FABRIC DETAILS']);
  }
  return r.concat([['print', 'PRINT'], ['emb', 'EMBROIDERY'], ['qty', 'ORDER QTY']]);
}

// Page layout, in mm: the fabric-details row is taller so long text can wrap. Three boards share one row of the page.
const IMG_MM = 29, GROUP_GAP_MM = 6, PAGE_CAP_MM = 180;
const rowMm = k => /^fd\d+$/.test(k) ? 12 : (k === 'name' || k === 'print' || k === 'emb') ? 9 : 6;
const groupMm = nf => IMG_MM + rowsFor(nf, false).reduce((a, [k]) => a + rowMm(k), 0);

// Split boards into pages of whole rows of 3; a board with more fabrics is taller, so fewer rows fit on its page.
function paginate(list) {
  const groups = [];
  for (let i = 0; i < list.length; i += 3) {
    const items = list.slice(i, i + 3);
    const nf = Math.max(...items.map(b => b.nf || 1));
    // a board with fewer fabrics than its neighbours shows N/A for the missing ones
    items.forEach(b => { for (let i = (b.nf || 1) + 1; i <= nf; i++) if (b['fd' + i] === undefined) b['fd' + i] = 'N/A'; });
    groups.push({ items, nf, h: groupMm(nf) });
  }
  const pages = []; let cur = null, used = 0;
  groups.forEach(g => {
    if (!cur || used + GROUP_GAP_MM + g.h > PAGE_CAP_MM) { cur = { groups: [] }; pages.push(cur); used = 0; }
    used += (cur.groups.length ? GROUP_GAP_MM : 0) + g.h;
    cur.groups.push(g);
  });
  return pages;
}

function toJpeg(im) {
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function downloadPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const M = 12, GAP = 6, CW = (297 - 2 * M - 2 * GAP) / 3, TOP = 22, LABW = CW * 0.46;
  const gold = [176, 141, 87], ink = [34, 35, 43], rule = [217, 210, 197];
  const imgs = new Map(await Promise.all(boards.map(async b => [b, await loadImg(b.img)])));

  paginate(boards).forEach((pg, pi) => {
    if (pi) doc.addPage();
    doc.setFont('times', 'normal'); doc.setFontSize(16); doc.setTextColor(...ink);
    doc.text('STORY BOARD - OH MY BABY', M, 14, { charSpace: 1.2 });
    doc.setDrawColor(...gold); doc.setLineWidth(0.5); doc.line(M, 18, 297 - M, 18);

    let y = TOP;
    pg.groups.forEach(g => {
      const rows = rowsFor(g.nf, g.nf > 1), RHS = rows.map(([k]) => rowMm(k)), CH = IMG_MM + RHS.reduce((a, b) => a + b, 0);
      g.items.forEach((b, n) => {
        const im = imgs.get(b), x = M + n * (CW + GAP);
        if (im) {
          const s = Math.min((CW - 4) / im.naturalWidth, (IMG_MM - 3) / im.naturalHeight);
          const w = im.naturalWidth * s, h = im.naturalHeight * s;
          doc.addImage(toJpeg(im), 'JPEG', x + (CW - w) / 2, y + (IMG_MM - h) / 2, w, h);
        }
        doc.setDrawColor(...rule); doc.setLineWidth(0.25);
        doc.roundedRect(x, y, CW, CH, 1.5, 1.5, 'S');
        doc.line(x + LABW, y + IMG_MM, x + LABW, y + CH);
        doc.setDrawColor(...gold); doc.setLineWidth(0.4); doc.line(x, y + IMG_MM, x + CW, y + IMG_MM);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...ink);
        rows.forEach(([k, label], r) => {
          const RH = RHS[r], ry = y + IMG_MM + RHS.slice(0, r).reduce((a, c) => a + c, 0);
          if (r) { doc.setDrawColor(...rule); doc.setLineWidth(0.2); doc.line(x, ry, x + CW, ry); }
          // label and value share one font size: the largest at which both fit their cells (wrapping if needed)
          const val = String(b[k] || '').toUpperCase();
          const fit = (text, width) => {
            let fs = 9;
            for (;;) {
              doc.setFontSize(fs);
              const lines = doc.splitTextToSize(String(text || ''), width - 3);
              if (lines.length * fs * 0.3528 * 1.2 <= RH - 1 || fs <= 6) return fs;
              fs -= 0.5;
            }
          };
          const fs = Math.min(fit(label, LABW), fit(val, CW - LABW));
          const put = (text, left, width) => {
            doc.setFontSize(fs);
            const lines = doc.splitTextToSize(String(text || ''), width - 3), lh = fs * 0.3528 * 1.2;
            doc.text(lines, left + 1.5, ry + RH / 2 - (lines.length - 1) * lh / 2 + fs * 0.3528 * 0.33, { lineHeightFactor: 1.2 });
          };
          put(label, x, LABW);
          put(val, x + LABW, CW - LABW);
        });
      });
      y += CH + GAP;
    });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(122, 116, 104);
    doc.text(todayText(), 297 - M, 204, { align: 'right' });
  });
  saveBlob(doc.output('blob'), `Story Board - Oh My Baby ${stamp()}.pdf`);
}

async function downloadXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Story Board', {
    // fixed scale (not fit-to-page) so the manual page breaks are honoured
    pageSetup: { paperSize: 9, orientation: 'landscape', scale: 74, horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 } },
    views: [{ showGridLines: false }]
  });
  const LAB_W = 28, VAL_W = 30, GAP_W = 3, SKETCH_H = 100, ROW_H = 20, LINE_H = 15, CHARS_PER_LINE = 28;
  const cols = [2, 5, 8];                                    // first column of each card: B, E, H (A is a margin; D and G are gaps)
  ws.columns = [2, LAB_W, VAL_W, GAP_W, LAB_W, VAL_W, GAP_W, LAB_W, VAL_W].map(width => ({ width }));
  ws.getRow(1).height = 10;                                  // top margin row
  const gold = { argb: 'FFB08D57' }, rule = { argb: 'FFD9D2C5' }, ink = { argb: 'FF22232B' };
  const thin = { style: 'thin', color: rule };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const imgs = new Map(await Promise.all(boards.map(async b => [b, await loadImg(b.img)])));

  let row = 2;
  paginate(boards).forEach(pg => {
    // heading with gold rule
    ws.mergeCells(row, 2, row, 9);
    const h = ws.getCell(row, 2);
    h.value = 'STORY BOARD - OH MY BABY';
    h.font = { name: 'Georgia', size: 16, color: ink };
    h.alignment = { vertical: 'middle', horizontal: 'left' };
    for (let c = 2; c <= 9; c++) ws.getCell(row, c).border = { bottom: { style: 'medium', color: gold } };
    ws.getRow(row).height = 30;
    row++;

    pg.groups.forEach((g, gi) => {
      const rows = rowsFor(g.nf, g.nf > 1), sketchRow = row;
      ws.getRow(sketchRow).height = SKETCH_H;
      rows.forEach(([k], r) => {
        // wrap long text: the row grows to the longest value among the boards in this group
        let lines = 1;
        g.items.forEach(b => { lines = Math.max(lines, Math.ceil(String(b[k] || '').length / CHARS_PER_LINE)); });
        ws.getRow(sketchRow + 1 + r).height = lines > 1 ? LINE_H * lines + 4 : ROW_H;
      });
      g.items.forEach((b, n) => {
        const col = cols[n];
        ws.mergeCells(sketchRow, col, sketchRow, col + 1);   // sketch spans label + value columns
        for (let c = col; c <= col + 1; c++) {
          ws.getCell(sketchRow, c).border = { top: thin, bottom: { style: 'medium', color: gold }, left: c === col ? thin : undefined, right: c === col + 1 ? thin : undefined };
        }
        rows.forEach(([k, label], r) => {
          const lab = ws.getCell(sketchRow + 1 + r, col), val = ws.getCell(sketchRow + 1 + r, col + 1);
          lab.value = label; val.value = String(b[k] || '').toUpperCase();
          lab.font = { name: 'Calibri', size: 11, color: ink };
          val.font = { name: 'Calibri', size: 11, color: ink };
          lab.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
          val.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
          lab.border = box; val.border = box;
        });
        const im = imgs.get(b);
        if (im) {
          const id = wb.addImage({ base64: b.img.split(',')[1], extension: 'png' });
          const cellW = (LAB_W + VAL_W) * 7 + 10, cellH = SKETCH_H * 96 / 72, firstColW = LAB_W * 7 + 5;
          const s = Math.min((cellW - 12) / im.naturalWidth, (cellH - 12) / im.naturalHeight);
          const w = im.naturalWidth * s, hh = im.naturalHeight * s;
          ws.addImage(id, { tl: { col: (col - 1) + (cellW - w) / 2 / firstColW, row: (sketchRow - 1) + (cellH - hh) / 2 / cellH }, ext: { width: w, height: hh } });
        }
      });
      row = sketchRow + 1 + rows.length;
      if (gi < pg.groups.length - 1) row += 3;               // 3 empty rows between two rows of boards
    });

    ws.getRow(row).height = 18;
    const d = ws.getCell(row, 9);
    d.value = todayText(); d.font = { size: 9, color: { argb: 'FF7A7468' } }; d.alignment = { horizontal: 'right' };
    ws.getRow(row).addPageBreak();
    row++;
  });
  ws.pageSetup.printArea = `A1:I${row - 1}`;

  // plain table for filtering / copying
  const ds = wb.addWorksheet('Data');
  const nfMax = Math.max(1, ...boards.map(b => b.nf || 1));
  const dcols = rowsFor(nfMax, nfMax > 1);
  ds.columns = dcols.map(([k, label]) => ({ header: label, key: k, width: /^fd/.test(k) ? 44 : k === 'name' ? 30 : 22 }));
  boards.forEach(b => ds.addRow(Object.fromEntries(dcols.map(([k]) => [k, String(b[k] || (/^fd/.test(k) ? 'N/A' : '')).toUpperCase()]))));
  ds.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: ink };
    c.alignment = { horizontal: 'center' };
  });
  ds.views = [{ state: 'frozen', ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Story Board - Oh My Baby ${stamp()}.xlsx`);
}
