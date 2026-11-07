// node shoot.cjs <outdir> <query>...  (with the repo served on localhost:8123)  -> renders _spidey.html?<query> (and its key=1 mask twin) to <outdir>/<i>.png / <i>_key.png
const { chromium } = require('playwright');
(async () => {
  const [,, out, ...qs] = process.argv;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  for (let i = 0; i < qs.length; i++) {
    for (const k of ['', '&key=1']) {
      await p.goto('http://localhost:8123/_spidey.html?' + qs[i] + k);
      await p.waitForFunction(() => document.title === 'ready', null, { timeout: 180000 });
      const c = await p.$('canvas');
      await c.screenshot({ path: `${out}/${i}${k ? '_key' : ''}.png` });
    }
  }
  await b.close();
})();
