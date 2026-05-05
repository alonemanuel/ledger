// Smoke test — builds dist/, runs fast bundle checks, then loads in headless
// Chromium to verify the page renders.
//
// Three stages:
//   0. Bundle checks — fast Node-only assertions on the built output
//   1. Example mode (VITE_EXAMPLE_MODE=true) — renders App directly
//   2. Live mode (normal build) — renders Bootstrap, clicks "Load demo data"
//
// Stage 0 catches missing assets / broken bundles in <1s without a browser.
// Stages 1–2 verify the app actually renders.
//
// Run:  npm test
// CI:   .github/workflows/test.yml

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

async function viteBuild(env = {}) {
  await new Promise((res, rej) => {
    const p = spawn('npx', ['vite', 'build'], {
      cwd: REPO,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    p.on('exit', code => code === 0 ? res() : rej(new Error(`vite build exit ${code}`)));
  });
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/index.html missing after build');
}

async function serve() {
  const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    let filePath = join(DIST, url === '/' ? 'index.html' : url);
    try {
      const data = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      // SPA fallback — serve index.html for non-asset paths
      try {
        const data = await readFile(join(DIST, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    }
  });
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

function bundleCheck(label, checks) {
  console.log(`▸ [${label}] Bundle checks…`);
  const assetsDir = join(DIST, 'assets');
  if (!existsSync(assetsDir)) throw new Error('dist/assets/ missing');
  const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  if (!jsFiles.length) throw new Error('No JS files in dist/assets/');
  const bundle = jsFiles.map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n');
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const failures = [];
  for (const { name, test } of checks) {
    if (!test({ bundle, html, jsFiles })) failures.push(name);
  }
  if (failures.length) {
    console.log(`  ❌ Failed: ${failures.join(', ')}`);
    return false;
  }
  console.log(`  ✓ All ${checks.length} checks passed`);
  return true;
}

function checkResults(label, rootText, pageErrors, consoleErrors) {
  const blank = rootText.trim().length < 50;
  const failed = pageErrors.length || consoleErrors.length || blank;

  console.log(`\n▸ [${label}] Root text: ${rootText.length} chars`);
  if (rootText.length > 0) console.log(`  preview: ${rootText.slice(0, 120).replace(/\s+/g, ' ').trim()}…`);

  if (pageErrors.length) {
    console.log(`\n❌ [${label}] PAGE ERRORS:`);
    pageErrors.forEach(e => console.log('   ' + e));
  }
  if (consoleErrors.length) {
    console.log(`\n❌ [${label}] CONSOLE ERRORS:`);
    consoleErrors.forEach(e => console.log('   ' + e));
  }
  if (blank) console.log(`\n❌ [${label}] Root element is blank (< 50 chars).`);

  return !failed;
}

async function run() {
  const browser = await chromium.launch();
  let allPassed = true;

  // ── Pass 1: Example mode ──────────────────────────────────────────────
  console.log('▸ Pass 1: Example mode');
  await viteBuild({ VITE_EXAMPLE_MODE: 'true' });

  if (!bundleCheck('example', [
    { name: 'has React',       test: ({ bundle }) => bundle.includes('createElement') },
    { name: 'has Fin helpers', test: ({ bundle }) => bundle.includes('fmtILS') },
    { name: 'has demo data',   test: ({ bundle, jsFiles }) =>
      jsFiles.some(f => f.includes('data.example')) || bundle.includes('ACCOUNTS') },
    { name: 'index.html has module script', test: ({ html }) => html.includes('type="module"') },
  ])) allPassed = false;

  const s1 = await serve();

  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await ctx1.newPage();
  const errors1 = [], consoleErr1 = [];
  page1.on('pageerror', err => errors1.push(err.message));
  page1.on('console', msg => { if (msg.type() === 'error') consoleErr1.push(msg.text()); });

  await page1.goto(`http://localhost:${s1.port}/`, { waitUntil: 'networkidle' });
  await page1.waitForTimeout(1000);

  const text1 = await page1.evaluate(() => document.getElementById('root')?.innerText || '');
  await writeFile(join(DIST, 'smoke-example.png'), await page1.screenshot({ fullPage: false }));
  await ctx1.close();
  s1.server.close();

  if (!checkResults('example', text1, errors1, consoleErr1)) allPassed = false;

  // ── Pass 2: Live mode + "Load demo data" button ──────────────────────
  console.log('\n▸ Pass 2: Live mode (demo-data button)');
  await viteBuild();

  if (!bundleCheck('live', [
    { name: 'has React',              test: ({ bundle }) => bundle.includes('createElement') },
    { name: 'has Fin helpers',        test: ({ bundle }) => bundle.includes('fmtILS') },
    { name: 'has DbLoader',           test: ({ bundle }) => bundle.includes('DbLoader') },
    { name: 'has demo source inlined', test: ({ bundle }) => bundle.includes('__LEDGER_DEMO_SOURCE__') },
    { name: 'has Bootstrap component', test: ({ bundle }) => bundle.includes('NEEDS_SIGNIN') },
  ])) allPassed = false;

  const s2 = await serve();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  const errors2 = [], consoleErr2 = [];
  page2.on('pageerror', err => errors2.push(err.message));
  page2.on('console', msg => { if (msg.type() === 'error') consoleErr2.push(msg.text()); });

  await page2.goto(`http://localhost:${s2.port}/`, { waitUntil: 'networkidle' });
  await page2.waitForTimeout(1000);

  // The Bootstrap screen should be showing. Click "Load demo data".
  const demoBtn = page2.getByRole('button', { name: /demo data/i });
  if (await demoBtn.isVisible()) {
    await demoBtn.click();
    await page2.waitForTimeout(2000);
  } else {
    console.log('  ⚠ "Load demo data" button not found — page may have auto-signed-in or errored');
  }

  const text2 = await page2.evaluate(() => document.getElementById('root')?.innerText || '');
  await writeFile(join(DIST, 'smoke-live.png'), await page2.screenshot({ fullPage: false }));
  await ctx2.close();
  s2.server.close();

  if (!checkResults('live+demo', text2, errors2, consoleErr2)) allPassed = false;

  await browser.close();

  if (!allPassed) {
    console.log('\n❌ Smoke test FAILED');
    process.exit(1);
  }
  console.log('\n✓ Smoke test PASSED (both passes)');
}

run().catch(err => { console.error(err); process.exit(1); });
