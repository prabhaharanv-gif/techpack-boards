// Bundles index.html + libraries + export.js + app.js into one standalone file: TechPack-Boards.html
const fs = require('fs');
const read = f => fs.readFileSync(__dirname + '/' + f);
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const inline = (html, src, code) => html.replace(`<script src="${src}"></script>`, () => `<script>${safe(code)}</script>`);

let html = read('index.html').toString('utf8');
const worker = read('lib/pdf.worker.min.js').toString('base64');
const app = read('app.js').toString('utf8').replace(
  "pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';",
  "pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([Uint8Array.from(atob(window.__PDF_WORKER_B64), c => c.charCodeAt(0))], { type: 'text/javascript' }));"
);

html = inline(html, 'lib/pdf.min.js', read('lib/pdf.min.js').toString('utf8'));
html = inline(html, 'lib/jspdf.umd.min.js', read('lib/jspdf.umd.min.js').toString('utf8'));
html = inline(html, 'lib/exceljs.min.js', read('lib/exceljs.min.js').toString('utf8'));
html = inline(html, 'export.js', read('export.js').toString('utf8'));
html = html.replace('<script src="app.js"></script>', () => `<script>window.__PDF_WORKER_B64="${worker}";</script>\n<script>${safe(app)}</script>`);

fs.writeFileSync(__dirname + '/TechPack-Boards.html', html);
console.log('Built TechPack-Boards.html', (html.length / 1024).toFixed(0) + ' KB');
