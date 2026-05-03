// Smoke test — builds dist/index.html in example mode, serves it locally,
// loads in headless Chromium, and fails if the page is blank or threw any
// JS errors. Catches TDZ / typo / missing-ref bugs before they reach prod.
//
// Run:  npm test
// CI:   .github/workflows/test.yml

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
};

async function build() {
  console.log('▸ Building example bundle…');
  await new Promise((res, rej) => {
    const p = spawn('python3', ['scripts/bundle.py', '--example'], { cwd: REPO, stdio: 'inherit' });
    p.on('exit', code => code === 0 ? res() : rej(new Error(`bundle.py exit ${code}`)));
  });
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html missing after build');
}

async function serve() {
  const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const filePath = join(DIST, url === '/' ? 'index.html' : url);
    try {
      const data = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

async function run() {
  await build();
  const { server, port } = await serve();
  const url = `http://localhost:${port}/`;
  console.log(`▸ Serving on ${url}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  console.log('▸ Loading in headless Chromium…');
  await page.goto(url, { waitUntil: 'networkidle' });
  // Babel compiles in-browser; give it a beat.
  await page.waitForTimeout(2000);

  const rootText = await page.evaluate(() => document.getElementById('root')?.innerText || '');
  const screenshot = await page.screenshot({ fullPage: false });
  await writeFile(join(DIST, 'smoke-screenshot.png'), screenshot);

  await browser.close();
  server.close();

  const blank = rootText.trim().length < 50;
  const failed = pageErrors.length || consoleErrors.length || blank;

  console.log('');
  console.log(`▸ Root text: ${rootText.length} chars`);
  if (rootText.length > 0) console.log(`  preview: ${rootText.slice(0, 120).replace(/\s+/g, ' ').trim()}…`);

  if (pageErrors.length) {
    console.log('\n❌ PAGE ERRORS:');
    pageErrors.forEach(e => console.log('   ' + e));
  }
  if (consoleErrors.length) {
    console.log('\n❌ CONSOLE ERRORS:');
    consoleErrors.forEach(e => console.log('   ' + e));
  }
  if (blank) console.log('\n❌ Root element is blank (< 50 chars).');

  if (failed) {
    console.log('\n❌ Smoke test FAILED');
    process.exit(1);
  }
  console.log('\n✓ Smoke test PASSED');
}

run().catch(err => { console.error(err); process.exit(1); });
