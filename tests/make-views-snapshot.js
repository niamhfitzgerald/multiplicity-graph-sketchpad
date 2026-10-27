/* Saves what the 1.3.0 build shows with Advanced off and with Advanced on, to views-1.3.0.json.
   Run once on the 1.3.0 build (commit caf46ae) before the one-switch change:
     node make-views-snapshot.js /path/to/1.3.0/index.html
   browser-stress.js then checks that Plain language on shows what Advanced off showed, and Plain language off
   what Advanced on showed (view-capture.js). */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { captureViews } = require('./view-capture');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.SKETCHPAD_CHROME || undefined, args: ['--no-sandbox'] });
  const out = {};
  for (const adv of [false, true]) {
    const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.goto(FILE); await page.waitForTimeout(700);
    await page.evaluate(on => setAdvanced(on), adv); await page.waitForTimeout(100);
    out[adv ? 'advancedOn' : 'advancedOff'] = await captureViews(page);
    out.version = await page.evaluate(() => APP_VERSION);
    await page.context().close();
  }
  fs.writeFileSync(path.join(__dirname, 'views-1.3.0.json'), JSON.stringify({ version: out.version, setup: 'Two doses, two endpoints; p = 0.004, 0.009, 0.011, 0.03; then Maurer and Bretz Fig. 4', advancedOff: out.advancedOff, advancedOn: out.advancedOn }, null, 1) + '\n');
  console.log('saved from', out.version);
  await b.close();
})();
