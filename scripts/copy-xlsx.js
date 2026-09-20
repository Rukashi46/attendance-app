// Copies the SheetJS (xlsx) UMD build into www/lib so it ships inside the
// Android app bundle and the Excel importer works with NO internet connection.
// Runs automatically after `npm install` (see package.json "postinstall").
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const destDir = path.join(__dirname, '..', 'www', 'lib');
const dest = path.join(destDir, 'xlsx.full.min.js');

try {
  if (!fs.existsSync(src)) {
    console.warn('[copy-xlsx] node_modules/xlsx/dist/xlsx.full.min.js not found. Run `npm install` first.');
    process.exit(0);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[copy-xlsx] Vendored xlsx.full.min.js into www/lib (offline-ready).');
} catch (e) {
  console.warn('[copy-xlsx] Could not copy xlsx library automatically:', e.message);
  console.warn('[copy-xlsx] Manually copy node_modules/xlsx/dist/xlsx.full.min.js to www/lib/xlsx.full.min.js');
}
