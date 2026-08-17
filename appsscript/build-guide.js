/**
 * Builds the shareable guide page (standalone/5c-pulse.html):
 * the setup walkthrough + the live in-page demo + copy buttons that carry
 * the two real files (Code.gs and index.html) to the clipboard.
 *
 *   node appsscript/build-demo.js && node appsscript/build-guide.js
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const template = read('guide-template.html');
const demo = read('demo.html');
const code = read('Code.gs');
const index = read('index.html');
const logoB64 = fs.readFileSync(path.join(dir, '../standalone/assets/logo.b64'), 'utf8').trim();
const logo = /^data:/.test(logoB64) ? logoB64 : 'data:image/svg+xml;base64,' + logoB64;

const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kb = s => Math.round(Buffer.byteLength(s, 'utf8') / 1024) + ' KB';

// A JS object literal that is safe inside a <script> tag ("</script>" in the
// payloads must never appear literally).
const filesJson = JSON.stringify({ code, index }).replace(/</g, '\\u003c');

let out = template
  .split('__DEMO_SRCDOC__').join(escAttr(demo))
  .split('__FILES_JSON__').join(filesJson)
  .split('__CODE_PRE__').join(escHtml(code))
  .split('__INDEX_PRE__').join(escHtml(index))
  .split('__KB_CODE__').join(kb(code))
  .split('__KB_INDEX__').join(kb(index))
  .split('__LOGO__').join(logo);

for (const marker of ['__DEMO_SRCDOC__', '__FILES_JSON__', '__CODE_PRE__', '__INDEX_PRE__', '__LOGO__']) {
  if (out.includes(marker)) {
    console.error('Marker not replaced: ' + marker);
    process.exit(1);
  }
}

const dest = path.join(dir, '../standalone/5c-pulse.html');
fs.writeFileSync(dest, out);
console.log(`guide built: standalone/5c-pulse.html (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
