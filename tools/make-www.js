// Copies the web app into www/ for Capacitor. The app ships inside the APK,
// so it opens with no connection at all; sw.js stays out (the WebView loads
// from local files, and a worker would only cache stale copies of them).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'])
  fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('www/ ready');
