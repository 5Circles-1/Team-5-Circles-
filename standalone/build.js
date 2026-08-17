/**
 * Injects the 5 Circles logo into the standalone dashboard.
 * The published file must be self-contained (no external requests), so the
 * SVG rides along as a data URI.
 *
 *   node standalone/build.js
 *
 * Source of truth for the mark: standalone/assets/logo.svg
 * (exported from the "5 Circles Logo" file in the company Drive).
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const svg = fs.readFileSync(path.join(dir, 'assets/logo.svg'), 'utf8');
const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const src = path.join(dir, '5c-pulse.html');
let html = fs.readFileSync(src, 'utf8');

// Replace the placeholder, or an already-injected data URI on a rebuild.
// (Re-running with an unchanged logo is a no-op, not a failure.)
const slot = /src="(__LOGO__|data:image\/svg\+xml;base64,[^"]*)"/g;
const hits = html.match(slot);

if (!hits) {
  console.error('No logo slot found — expected src="__LOGO__" in 5c-pulse.html');
  process.exit(1);
}
html = html.replace(slot, `src="${dataUri}"`);

fs.writeFileSync(src, html);
console.log(`Logo injected (${(dataUri.length / 1024).toFixed(1)} KB data URI)`);
console.log(`5c-pulse.html is now ${(html.length / 1024).toFixed(0)} KB`);
