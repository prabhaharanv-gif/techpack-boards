const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((q, r) => {
  const f = path.join(__dirname, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); return r.end('Not found'); }
    r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(5199, () => console.log('http://localhost:5199'));
