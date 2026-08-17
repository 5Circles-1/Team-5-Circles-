/**
 * Builds demo.html: the real client (index.html) + the real server (Code.gs)
 * + the fake Google layer, merged into one page that runs with no Google at
 * all. This single file powers the live demo and the automated tests.
 *
 *   node appsscript/build-demo.js
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const client = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8');
const fakes = fs.readFileSync(path.join(dir, 'fake-google.js'), 'utf8');

for (const [name, src] of [['Code.gs', server], ['fake-google.js', fakes]]) {
  if (/<\/script/i.test(src)) {
    console.error(`${name} contains "</script" — it cannot be inlined safely.`);
    process.exit(1);
  }
}

const marker = '<!--DEMO_INJECT-->';
if (!client.includes(marker)) {
  console.error('index.html is missing the <!--DEMO_INJECT--> marker.');
  process.exit(1);
}

const inject = [
  '<script>\n' + fakes + '\n</script>',
  '<script>\n/* ═══ the REAL server code (Code.gs), running on the fake Google ═══ */\n'
    + server
    + '\n;window.FAKE_API = function (token, action, data) { return api(token, action, data); };\n'
    + '</script>'
].join('\n');

const out = client.replace(marker, inject);
const dest = path.join(dir, 'demo.html');
fs.writeFileSync(dest, out);
console.log(`demo.html built (${(out.length / 1024).toFixed(0)} KB)`);
