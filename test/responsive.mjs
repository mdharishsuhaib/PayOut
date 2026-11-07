// Responsive audit: every page at phone, tablet, laptop, desktop and monitor sizes, signed out and signed in.
// Runs the real server in-process (copy of the workspace data), signs in through lib/login.js, drives headless
// Chrome over the DevTools protocol, reports anything wider than the screen and saves full-page screenshots.
//   node test/responsive.mjs            (all sizes)      node test/responsive.mjs 390 1440   (some widths)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

process.env.PORT = '3198';
process.env.DATA_FILE = 'data/responsive-store.json';
if (fs.existsSync('data/store.json')) fs.copyFileSync('data/store.json', process.env.DATA_FILE);
await import('../server.js');
const login = await import('../lib/login.js');
let sid = '';
login.createSession({ setHeader: (_k, v) => { sid = decodeURIComponent(v.split(';')[0].split('=')[1]); } }, { secure: false }, { name: 'Saira Test', email: 'saira@example.com' });

const SIZES = [[320, 640, 'small phone'], [360, 780, 'android'], [390, 844, 'iphone'], [430, 932, 'large phone'], [600, 960, 'small tablet'], [768, 1024, 'tablet'], [1024, 768, 'tablet landscape'], [1280, 800, 'laptop'], [1440, 900, 'desktop'], [1920, 1080, 'full hd'], [2560, 1440, 'monitor']]
  .filter(([w]) => process.argv.length < 3 || process.argv.slice(2).includes(String(w)));
const OUT = ['home', 'login', 'signup'];
const IN = ['preflight', 'routes', 'payouts', 'signals', 'resolve', 'rules', 'rules/currency', 'routes/US/IN/EUR'];
// detail screens, filled from the copied workspace data
{
  const db = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  const bs = Object.values(db.batches);
  const sentB = bs.find((b) => b.rows.some((r) => r.payout)), r = sentB?.rows.find((x) => x.payout);
  const openR = bs.flatMap((b) => b.rows.filter((x) => x.payout && x.payout.status !== 'SUCCESS').map((x) => [b.id, x.ref]))[0];
  if (bs[0]) IN.push(`preflight/${bs.find((b) => !b.payout)?.id || bs[0].id}`);
  if (r) IN.push(`payouts/${sentB.id}/${r.ref}`);
  if (openR) IN.push(`resolve/${openR[0]}/${openR[1]}`);
  if (db.events[0]) IN.push(`signals/${db.events[0].id}`);
}
const shots = path.resolve('shots/responsive'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${prof}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { const t = await (await fetch('http://127.0.0.1:9333/json/list')).json(); const pg = t.find((x) => x.type === 'page'); if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl); } catch { /* starting */ }
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const wait = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } });
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++n; wait.set(id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result))); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (fn) => (await cdp('Runtime.evaluate', { expression: `(${fn})()`, returnByValue: true, awaitPromise: true })).result.value;
await cdp('Page.enable'); await cdp('Network.enable');

// what counts as broken: page scrolls sideways, or a visible element pokes outside the screen and is not inside
// a container that scrolls on purpose (tables, grids, chip rows)
const AUDIT = () => {
  const W = innerWidth, bad = [];
  const scrolls = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed' && el.closest('.ppfab') || el.closest('.skip, .ag-aria-description-container')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > W + 1 || r.left < -1) && !scrolls(el) && !el.closest('[aria-hidden="true"]')) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    // text cut off inside its own box (single-line ellipsis is intended, so only flag when not ellipsis)
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis') bad.push(`clipped text: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`);
  }
  // tap targets: a checkbox inside a <label> is as big as its label; inline links inside a sentence are exempt
  const box = (e) => (e.closest('label') || e).getBoundingClientRect();
  const small = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="tab"]')].filter((e) => { const r = box(e); const s = getComputedStyle(e); return r.width && r.height && s.visibility !== 'hidden' && (r.height < 24 || r.width < 24) && !e.closest('.pp-foot, footer, p, .geo-in, .auth-swap'); })
    .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent || e.value || e.ariaLabel || '').trim().slice(0, 20)}" ${Math.round(box(e).width)}x${Math.round(box(e).height)}`);
  return { sideways: document.scrollingElement.scrollWidth - W, bad: [...new Set(bad)].slice(0, 12), small: [...new Set(small)].slice(0, 8), h: document.scrollingElement.scrollHeight, err: document.querySelector('.err-box, .error')?.textContent?.slice(0, 120) || null };
};

const report = [];
for (const signedIn of process.env.ONLY_X ? [] : [false, true]) {
  if (signedIn) await cdp('Network.setCookie', { name: 'pp_sid', value: sid, url: 'http://localhost:3198', httpOnly: true });
  for (const [w, h, label] of SIZES) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: w < 1024 });
    for (const route of signedIn ? IN : OUT) {
      await cdp('Page.navigate', { url: `http://localhost:3198/?r=${Date.now()}#/${route}` });
      // wait until the view has rendered and stopped growing (data loads, fonts), up to 8 s
      await evaluate(`async () => { let last = 0, same = 0; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 200)); const h = document.querySelector('#view')?.getBoundingClientRect().height || 0; if (h > 150 && h === last && document.fonts.status === 'loaded') { if (++same >= 3) return; } else same = 0; last = h; } }`);
      await sleep(300);
      const a = await evaluate(AUDIT);
      const ok = a.sideways <= 0 && !a.bad.length;
      report.push({ w, label, route, ...a, ok });
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(w).padStart(4)} ${route.padEnd(9)} ${a.sideways > 0 ? `scrolls sideways by ${a.sideways}px ` : ''}${a.bad.join(' | ')}${a.small.length ? `  small: ${a.small.join(' ; ')}` : ''}${a.err ? `  error: ${a.err}` : ''}`);
      const name = route.replace(/\//g, '_').slice(0, 40);
      if ([320, 390, 768, 1024, 1440, 2560].includes(w)) {
        if (w < 768) {
          // phones: readable screen-sized slices instead of one tall thumbnail
          for (let k = 0, y = 0; y < Math.min(a.h, 9000); k++, y += 900) {
            const s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: w, height: Math.min(900, a.h - y), scale: 1 } });
            fs.writeFileSync(path.join(shots, `${name}-${w}-${k}.png`), Buffer.from(s.data, 'base64'));
          }
          continue;
        }
        const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(a.h, 6000), scale: w > 1500 ? 0.5 : 1 } });
        fs.writeFileSync(path.join(shots, `${name}-${w}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
}
fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, null, 1));

// ---- interactions: tap the controls a customer needs at each size and confirm they work and stay on screen ----
console.log('\n# Interactions');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: 'http://localhost:3198/#/home' }); await sleep(1500);
await cdp('Network.setCookie', { name: 'pp_sid', value: sid, url: 'http://localhost:3198', httpOnly: true });
await cdp('Page.navigate', { url: 'http://localhost:3198/#/payouts' }); await sleep(3000); // warm-up load, signed in
const tap = (sel) => evaluate(`async () => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'missing'; e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 150)); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!top || !(e === top || e.contains(top) || top.contains(e))) return 'covered by ' + (top?.className || top?.tagName); e.click(); return 'ok'; }`);
const onScreen = (sel) => evaluate(`() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return 'not shown'; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.top < innerHeight ? 'ok' : 'off screen ' + JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round)); }`);
const shot = async (name) => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, `x-${name}.png`), Buffer.from(s.data, 'base64')); };
const go = async (route) => { await cdp('Page.navigate', { url: `http://localhost:3198/?r=${Date.now()}#/${route}` }); await sleep(1800); };
const steps = [];
const step = (w, what, res) => { steps.push({ w, what, res }); console.log(`${res === 'ok' ? 'ok  ' : 'FAIL'} ${String(w).padStart(4)} ${what}${res === 'ok' ? '' : `  (${res})`}`); };
for (const [w, h] of SIZES.filter(([w]) => [320, 390, 768, 1024, 1440].includes(w))) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  await go('payouts');
  const burger = await evaluate(`() => getComputedStyle(document.querySelector('#burger')).display !== 'none'`);
  if (burger) {
    step(w, 'menu button opens the menu', await tap('#burger'));
    await sleep(300);
    step(w, 'every section link is on screen in the menu', await evaluate(`() => { const bad = [...document.querySelectorAll('#nav a')].filter((a) => { const r = a.getBoundingClientRect(); return !r.height || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.height < 40; }).map((a) => a.textContent.trim()); return bad.length ? 'hidden or too small: ' + bad.join(', ') : 'ok'; }`));
    if (w === 320) await shot(`menu-${w}`);
    step(w, 'menu link navigates', await tap('#nav a[data-view="signals"]'));
    await sleep(1200);
    step(w, 'menu closes after choosing', await evaluate(`() => location.hash.startsWith('#/signals') && !document.querySelector('#hdr').classList.contains('open') ? 'ok' : location.hash`));
    await go('payouts');
  } else step(w, 'section links visible in the header', await evaluate(`() => [...document.querySelectorAll('#nav a')].every((a) => { const r = a.getBoundingClientRect(); return r.height && r.right <= innerWidth; }) ? 'ok' : 'some links cut off'`));
  if (w < 901) {
    step(w, 'Filters toggle opens the filters', await tap('#po-fw > summary, .f-wrap > summary'));
    await sleep(200);
    step(w, 'filter checkboxes reachable', await evaluate(`() => { const i = document.querySelector('.f-wrap .filters input'); if (!i) return 'no filters'; const r = i.closest('label').getBoundingClientRect(); return r.height >= 32 ? 'ok' : 'row ' + r.height + 'px'; }`));
  }
  step(w, 'filter changes the list', await evaluate(`async () => { const n0 = document.querySelectorAll('.cards .rcard').length; const i = [...document.querySelectorAll('.filters input')].find((x) => x.value === 'SUCCESS' || x.value === 'UNCLAIMED'); if (!i) return 'no status filter'; i.click(); await new Promise((r) => setTimeout(r, 300)); const n1 = document.querySelectorAll('.cards .rcard').length; return n1 > 0 && n1 < n0 ? 'ok' : n0 + ' -> ' + n1; }`));
  step(w, 'payout card opens its detail', await tap('.cards .rcard'));
  await sleep(1500);
  step(w, 'payout detail actions on screen', await evaluate(`() => { const b = document.querySelector('#refresh'); if (!b) return 'no actions'; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= 0 ? 'ok' : 'cut off'; }`));
  if (w === 320) await shot(`payout-detail-${w}`);
  step(w, 'PayPal AI button opens the assistant', await tap('#ppfab'));
  await sleep(400);
  step(w, 'assistant panel fits the screen', await evaluate(`() => { const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }; const a = R('#ask'), h = R('.ask-h'); return a[1] >= 0 && h[1] >= 0 && a[3] <= innerHeight + 1 && a[0] >= 0 && a[2] <= innerWidth + 1 ? 'ok' : 'ask ' + a + ' head ' + h + ' fab ' + R('#ppfab') + ' vh ' + innerHeight; }`));
  step(w, 'question box usable', await evaluate(`() => { const q = document.querySelector('#ask-q'), r = q.getBoundingClientRect(); return r.width > 120 && r.bottom <= innerHeight + 1 ? 'ok' : 'box ' + Math.round(r.width) + 'w bottom ' + Math.round(r.bottom); }`));
  if (w === 320 || w === 1440) await shot(`ask-${w}`);
  step(w, 'assistant closes', await tap('#ask-close'));
  await go('preflight');
  step(w, 'Sample loads a batch', await tap('#o-sample'));
  await sleep(2500);
  step(w, 'batch grid shows rows', await evaluate(`() => { const rows = document.querySelectorAll('.ag-row, .d-grid tr, [role="row"]'); return rows.length > 3 ? 'ok' : 'rows: ' + rows.length; }`));
  step(w, 'batch page fits the screen', await evaluate(`() => document.scrollingElement.scrollWidth <= innerWidth ? 'ok' : 'scrolls sideways ' + (document.scrollingElement.scrollWidth - innerWidth)`));
  step(w, 'Send button not covered by the PayPal AI button', await evaluate(`async () => { await new Promise((r) => setTimeout(r, 200)); const b = document.querySelector('#send'); if (!b) return 'no send button'; const r = b.getBoundingClientRect(); const pts = [[r.left + 6, r.top + r.height / 2], [r.right - 6, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2]]; const hit = pts.map(([x, y]) => document.elementFromPoint(x, y)).filter((e) => e && e !== b && !b.contains(e)); return hit.length ? 'covered by ' + (hit[0].id || hit[0].className) : 'ok'; }`));
  if (w <= 1024) await shot(`batch-${w}`);
  await go('routes/US/IN/EUR');
  step(w, 'route trace shows a verdict', await evaluate(`() => /review|blocked|eligible|confirm|can't|cannot/i.test(document.querySelector('#view').innerText) ? 'ok' : 'no verdict'`));
}
const badSteps = steps.filter((s) => s.res !== 'ok');
console.log(`\n${steps.length - badSteps.length}/${steps.length} interactions worked`);
const failed = report.filter((r) => !r.ok);
console.log(`\n${report.length - failed.length}/${report.length} page-size combinations fit the screen`);
proc.kill(); ws.close();
await sleep(300); fs.rmSync(process.env.DATA_FILE, { force: true });
process.exit(failed.length || badSteps.length ? 1 : 0);
