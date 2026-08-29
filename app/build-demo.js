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

const bridge = `
/* google.script.run, faked: routes the real client at the real server. */
window.google = { script: { run: (function () {
  function make(h) {
    return {
      withSuccessHandler: function (f) { return make(Object.assign({}, h, { ok: f })); },
      withFailureHandler: function (f) { return make(Object.assign({}, h, { err: f })); },
      api: function (token, action, data) {
        setTimeout(function () {
          var res, threw = false, err;
          try { res = window.FAKE_API(token, action, data); }
          catch (e) { threw = true; err = e; }
          // The handler runs OUTSIDE the try: real google.script.run does not
          // swallow exceptions thrown by your own callback, and neither must this.
          if (threw) (h.err || function () {})(err);
          else (h.ok || function () {})(res);
        }, 25);
      }
    };
  }
  return make({});
})() } };
`;

const inject = [
  '<script>\n' + fakes + '\n</' + 'script>',
  '<script>\n/* ═══ the REAL server code (Code.gs), running on the fake Google ═══ */\n'
    + server
    + '\n;window.FAKE_API = function (token, action, data) { return api(token, action, data); };\n'
    + bridge
    + '</' + 'script>'
].join('\n');

const out = client.replace(marker, inject);
const dest = path.join(dir, 'demo.html');
fs.writeFileSync(dest, out);
console.log(`demo.html built (${(out.length / 1024).toFixed(0)} KB)`);
