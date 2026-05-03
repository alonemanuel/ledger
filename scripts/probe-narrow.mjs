// Probe responsive layout at multiple widths.
// Builds example bundle, serves it, screenshots at several widths,
// and reports horizontal overflow + offending elements.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist');
const OUT = resolve(REPO, 'probe-out');

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png' };

const WIDTHS = [320, 375, 480, 600, 768, 960];

async function build() {
  console.log('▸ Building example bundle…');
  await new Promise((res, rej) => {
    const p = spawn('python3', ['scripts/bundle.py', '--example'], { cwd: REPO, stdio: 'inherit' });
    p.on('exit', code => code === 0 ? res() : rej(new Error(`bundle.py ${code}`)));
  });
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
    } catch { res.writeHead(200, {'Content-Type':'text/html'}); res.end(await readFile(join(DIST,'index.html'))); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

async function run() {
  await build();
  await mkdir(OUT, { recursive: true });
  const { server, port } = await serve();
  const url = `http://localhost:${port}/`;
  console.log(`▸ Serving on ${url}`);

  const browser = await chromium.launch();

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const overflowX = html.scrollWidth - html.clientWidth;
      const offenders = [];
      if (overflowX > 0) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.right > html.clientWidth + 1 && r.width > 0 && r.height > 0) {
            offenders.push({
              tag: el.tagName.toLowerCase(),
              cls: el.className?.toString?.() || '',
              right: Math.round(r.right),
              width: Math.round(r.width),
              text: (el.innerText || '').slice(0, 40).replace(/\s+/g,' ').trim(),
            });
          }
        }
      }
      const navScrollW = document.querySelector('.app-nav')?.scrollWidth ?? 0;
      const navClientW = document.querySelector('.app-nav')?.clientWidth ?? 0;
      return { docW: html.clientWidth, scrollW: html.scrollWidth, overflowX, offenders: offenders.slice(0, 12), navScrollW, navClientW };
    });

    const png = await page.screenshot({ fullPage: false });
    await writeFile(join(OUT, `w${width}.png`), png);

    console.log(`\n▸ ${width}px — doc=${info.docW} scroll=${info.scrollW} overflowX=${info.overflowX} | tabnav scroll=${info.navScrollW} client=${info.navClientW}`);
    info.offenders.forEach(o => console.log(`    overflow: <${o.tag}.${o.cls.split(' ')[0]}> right=${o.right} w=${o.width} "${o.text}"`));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(`\n▸ Screenshots → ${OUT}`);
}

run().catch(e => { console.error(e); process.exit(1); });