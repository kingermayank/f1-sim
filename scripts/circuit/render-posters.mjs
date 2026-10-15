/**
 * Renders the circuit's printed graphics: billboards, barrier wraps, the DRS
 * and braking boards, turn numbers, garage boards, pit signs and the big
 * screen. Each is laid out in HTML with the app's own typefaces and captured
 * from headless Chromium, so the circuit wears the same APEX look as the
 * garage. No third-party marks: everything is APEX's own.
 *
 * Reads work/track-build/shanghai-layout.json (for the circuit outline).
 * Writes work/track-build/posters/*.png for the Blender build.
 *
 * Usage: node scripts/circuit/render-posters.mjs
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAYOUT = resolve(ROOT, 'work/track-build/shanghai-layout.json');
const OUT = resolve(ROOT, 'work/track-build/posters');
// Embedded as data URLs: a page set from a string may not load local files.
const font = (file) => `data:font/woff2;base64,${readFileSync(resolve(ROOT, 'public/assets/fonts', file)).toString('base64')}`;

const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));

// The circuit outline, traced from the same centreline the cars drive.
function outline(width, height, pad) {
  const points = layout.centre.filter((_, index) => index % 6 === 0).map(([x, , z]) => [x, z]);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const scale = Math.min((width - pad * 2) / (Math.max(...xs) - minX), (height - pad * 2) / (Math.max(...zs) - minZ));
  const offX = (width - (Math.max(...xs) - minX) * scale) / 2;
  const offY = (height - (Math.max(...zs) - minZ) * scale) / 2;
  return `${points.map(([x, z], index) => `${index ? 'L' : 'M'}${(offX + (x - minX) * scale).toFixed(1)} ${(offY + (z - minZ) * scale).toFixed(1)}`).join(' ')} Z`;
}

const TEAMS = [
  ['Ferrari', '#c8001a', '#ffd400'], ['McLaren', '#ff7a00', '#3fc4ff'], ['Red Bull Racing', '#15204a', '#ffc906'],
  ['Racing Bulls', '#eef1f8', '#1840d0'], ['Alpine', '#ff7ab4', '#0b4c9e'], ['Williams', '#0a2a66', '#00a3e0'], ['Aston Martin', '#0a5a42', '#c9db00'],
];

const css = `
@font-face { font-family: Wide; src: url('${font('formula1-wide.woff2')}') format('woff2'); font-weight: 100 900; }
@font-face { font-family: Display; src: url('${font('formula1-display-regular.woff2')}') format('woff2'); }
@font-face { font-family: Mono; src: url('${font('monospec-variable.woff2')}') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { background: #000; }
.poster { position: relative; overflow: hidden; color: #f2f5fb; font-family: Display, sans-serif; }
.navy { background: radial-gradient(120% 140% at 85% 20%, #1b2a4a 0%, #0b0f1a 55%, #070a12 100%); }
.amber { color: #ffb82e; }
.wide { font-family: Wide, sans-serif; text-transform: uppercase; letter-spacing: .02em; line-height: .9; }
.mono { font-family: Mono, monospace; text-transform: uppercase; letter-spacing: .18em; white-space: nowrap; }
.mark { display: inline-grid; place-items: center; background: #ffb82e; color: #0b0f1a; transform: skew(-8deg); font-family: Wide; }
.stripe { position: absolute; left: 0; right: 0; height: 6%; background: repeating-linear-gradient(90deg, #ffb82e 0 40px, #0b0f1a 40px 80px); }
`;

const shanghai = (w, h, pad, stroke) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${outline(w, h, pad)}" fill="none" stroke="${stroke}" stroke-width="${Math.max(6, w / 160)}" stroke-linejoin="round"/></svg>`;

const posters = [
  // Billboards, 2:1.
  { id: 'billboard-apex', w: 2048, h: 1024, html: `<div class="poster navy" style="width:2048px;height:1024px;padding:110px 120px">
      <div class="wide" style="font-size:250px">APEX</div>
      <div class="mono amber" style="font-size:54px;margin-top:70px">Formula, finally legible</div>
      <div class="stripe" style="bottom:0"></div></div>` },
  { id: 'billboard-shanghai', w: 2048, h: 1024, html: `<div class="poster" style="width:2048px;height:1024px;background:#f2f4f7;color:#0b0f1a;padding:100px 120px;display:grid;grid-template-columns:1fr 820px;align-items:center">
      <div><div class="mono" style="font-size:44px;color:#c8001a">Round 2 · 2026</div>
      <div class="wide" style="font-size:128px;margin-top:40px">Shanghai</div>
      <div class="mono" style="font-size:40px;margin-top:50px;color:#4a5466">5.451 km · 16 turns · 56 laps</div></div>
      <div>${shanghai(820, 720, 40, '#0b0f1a')}</div></div>` },
  { id: 'billboard-podium', w: 2048, h: 1024, html: `<div class="poster" style="width:2048px;height:1024px;background:#ffb82e;color:#0b0f1a;padding:120px">
      <div class="mono" style="font-size:52px">APEX · predict</div>
      <div class="wide" style="font-size:210px;margin-top:60px">The<br>podium</div>
      <div class="wide" style="position:absolute;right:120px;bottom:90px;font-size:300px;opacity:.16">P1</div></div>` },
  { id: 'billboard-driver', w: 2048, h: 1024, html: `<div class="poster" style="width:2048px;height:1024px;background:linear-gradient(110deg,#0b0f1a 0 55%,#c8001a 55% 62%,#ffb82e 62% 69%,#0b0f1a 69%);padding:120px">
      <div class="mono amber" style="font-size:52px">Six questions</div>
      <div class="wide" style="font-size:180px;margin-top:60px">Find<br>your<br>driver</div></div>` },
  { id: 'billboard-legible', w: 2048, h: 1024, html: `<div class="poster" style="width:2048px;height:1024px;background:#0b0f1a;padding:120px;display:grid;align-content:center">
      <div class="wide" style="font-size:150px;line-height:1.05">Box, box.<br><span class="amber">Now you</span><br>know why.</div>
      <div class="mono" style="font-size:44px;margin-top:70px;color:#9aa5b4">APEX explains every pit stop</div></div>` },
  { id: 'billboard-grid', w: 2048, h: 1024, html: `<div class="poster navy" style="width:2048px;height:1024px;padding:110px 120px">
      <div class="mono" style="font-size:52px;color:#9aa5b4">The 2026 grid</div>
      <div class="wide" style="font-size:150px;margin-top:40px">Race<br>them all</div>
      <div style="position:absolute;left:120px;right:120px;bottom:110px;display:flex;gap:18px">${TEAMS.map(([, a, b]) => `<i style="flex:1;height:70px;background:linear-gradient(90deg,${a} 0 70%,${b} 70%)"></i>`).join('')}</div></div>` },
  // Barrier wraps, 8:1, tiling end to end.
  { id: 'wrap-navy', w: 2048, h: 256, html: `<div class="poster" style="width:2048px;height:256px;background:#0b0f1a;display:flex;align-items:center;justify-content:space-evenly">
      <span class="wide" style="font-size:80px">APEX</span><span class="mono amber" style="font-size:36px">Shanghai 2026</span>
      <span class="wide" style="font-size:80px">APEX</span><span class="mono" style="font-size:36px;color:#9aa5b4">Finally legible</span></div>` },
  { id: 'wrap-white', w: 2048, h: 256, html: `<div class="poster" style="width:2048px;height:256px;background:#f2f4f7;color:#0b0f1a;display:flex;align-items:center;justify-content:space-evenly">
      <span class="wide" style="font-size:80px">APEX</span><span class="mono" style="font-size:30px;color:#c8001a">Predict the podium</span>
      <span class="wide" style="font-size:80px">2026</span><span class="mono" style="font-size:30px">Find your driver</span></div>` },
  { id: 'wrap-amber', w: 2048, h: 256, html: `<div class="poster" style="width:2048px;height:256px;background:#ffb82e;color:#0b0f1a;display:flex;align-items:center;justify-content:space-evenly">
      <span class="wide" style="font-size:80px">APEX</span><span class="mono" style="font-size:36px">Race the 2026 grid</span>
      <span class="wide" style="font-size:80px">APEX</span><span class="mono" style="font-size:36px">Shanghai</span></div>` },
  // Boards.
  { id: 'drs', w: 1024, h: 512, html: `<div class="poster" style="width:1024px;height:512px;background:#0b0f1a;border:28px solid #f2f4f7;display:grid;place-items:center">
      <div class="wide" style="font-size:190px">DRS</div></div>` },
  { id: 'distance', w: 1536, h: 512, html: `<div style="display:flex">${['300', '200', '100'].map((n) => `<div class="poster" style="width:512px;height:512px;background:#f2f4f7;color:#0b0f1a;border:22px solid #0b0f1a;display:grid;place-items:center">
      <div class="wide" style="font-size:96px">${n}</div></div>`).join('')}</div>` },
  { id: 'turns', w: 2560, h: 2048, html: `<div style="display:grid;grid-template-columns:repeat(5,512px)">${Array.from({ length: 20 }, (_, index) => `<div class="poster" style="width:512px;height:512px;background:#0b0f1a;border:20px solid #ffb82e;display:grid;place-items:center;text-align:center">
      <div><div class="mono" style="font-size:54px;color:#9aa5b4">Turn</div><div class="wide" style="font-size:${index + 1 > 9 ? 150 : 220}px">${index + 1}</div></div></div>`).join('')}</div>` },
  { id: 'garages', w: 2048, h: 1024, html: `<div style="display:grid;grid-template-columns:repeat(2,1024px)">${[...TEAMS, ['APEX', '#ffb82e', '#0b0f1a']].map(([name, a, b]) => `<div class="poster" style="width:1024px;height:256px;background:#0b0f1a;display:flex;align-items:center;gap:40px;padding:0 60px">
      <i style="width:22px;height:150px;background:${a};box-shadow:16px 0 0 ${b}"></i>
      <span class="wide" style="font-size:${name.length > 12 ? 62 : 80}px;margin-left:24px">${name}</span></div>`).join('')}</div>` },
  { id: 'pit-signs', w: 2048, h: 512, html: `<div style="display:flex">
      <div class="poster" style="width:1024px;height:512px;background:#0b0f1a;display:grid;place-items:center"><div class="wide" style="font-size:96px">Pit lane</div></div>
      <div class="poster" style="width:512px;height:512px;background:#f2f4f7;display:grid;place-items:center"><div style="width:440px;height:440px;border-radius:50%;border:46px solid #d40018;display:grid;place-items:center;color:#0b0f1a" class="wide"><span style="font-size:120px">80</span></div></div>
      <div class="poster" style="width:512px;height:512px;background:#ffb82e;color:#0b0f1a;display:grid;place-items:center;text-align:center"><div class="wide" style="font-size:84px">Pit<br>exit</div></div></div>` },
  { id: 'screen', w: 1600, h: 900, html: `<div class="poster navy" style="width:1600px;height:900px;padding:70px 80px;display:grid;grid-template-columns:1fr 640px;gap:60px;align-items:center">
      <div><div class="mono amber" style="font-size:40px">Live · Shanghai</div>
      <div class="wide" style="font-size:108px;margin-top:30px">Lights<br>out</div>
      <div style="display:grid;gap:14px;margin-top:50px">${TEAMS.slice(0, 5).map(([name, a], index) => `<div style="display:flex;gap:24px;align-items:center;font-size:40px" class="mono"><b style="width:56px">P${index + 1}</b><i style="width:12px;height:44px;background:${a}"></i>${name}</div>`).join('')}</div></div>
      <div>${shanghai(640, 640, 30, '#ffb82e')}</div></div>` },
  { id: 'stand-back', w: 2048, h: 512, html: `<div class="poster" style="width:2048px;height:512px;background:#0b0f1a;display:flex;align-items:center;justify-content:center;gap:80px">
      <span class="wide" style="font-size:230px">APEX</span><span class="mono amber" style="font-size:60px;line-height:1.4">Shanghai<br>2026</span></div>` },
  { id: 'bridge', w: 4096, h: 512, html: `<div class="poster" style="width:4096px;height:512px;background:#0b0f1a;display:flex;align-items:center;justify-content:space-around">
      <span class="wide" style="font-size:220px">APEX</span><span class="mono amber" style="font-size:64px">Shanghai International Circuit</span><span class="wide" style="font-size:220px">2026</span></div>` },
];

if (!existsSync(LAYOUT)) throw new Error('Run export-shanghai-layout.mjs first.');
mkdirSync(OUT, { recursive: true });
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((path) => path && existsSync(path));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const poster of posters) {
  await page.setViewportSize({ width: poster.w, height: poster.h });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div id="p" style="width:${poster.w}px;height:${poster.h}px">${poster.html}</div></body></html>`);
  await page.evaluate(async () => { await Promise.all(['Wide', 'Display', 'Mono'].map((family) => document.fonts.load(`64px ${family}`))); await document.fonts.ready; });
  await page.locator('#p').screenshot({ path: resolve(OUT, `${poster.id}.png`) });
  console.log(`${poster.id}.png ${poster.w}×${poster.h}`);
}
await browser.close();
