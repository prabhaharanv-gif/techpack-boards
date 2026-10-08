# Tech Pack Data Boards

Upload tech-pack PDFs and get story boards (sketch, product description, size range, style no., fabric details with GSM and colour, print, embroidery, order qty). Download as PDF or Excel (A4 landscape, 6 boards per page). Everything runs in the browser.

- Live site: `index.html` (single file, built from `src/`)
- Source: `src/` — `app.js` (PDF reading and board UI), `export.js` (layout, PDF and Excel downloads), `index.html`, `lib/` (pdf.js, jsPDF, ExcelJS)
- Rebuild the single file: `node src/build.js` (writes `src/TechPack-Boards.html`; copy it to the repo root as `index.html`)
- Run from source: `node src/server.js`, then open http://localhost:5199
