/* Saves the visible text of the Test tab with Plain language off, for the clinician set-up, to plain-off-1.3.0.json.
   Run once on the 1.3.0 build (27 October 2026) before the plain-language changes:
     node make-plain-snapshot.js ../index.html
   browser-stress.js then checks that, with Plain language off, every later build shows exactly this text. */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { capturePlain } = require('./plain-capture');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.SKETCHPAD_CHROME || undefined, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(FILE); await page.waitForTimeout(700);
  const cap = await capturePlain(page, false);
  const version = await page.evaluate(() => APP_VERSION);
  fs.writeFileSync(path.join(__dirname, 'plain-off-1.3.0.json'), JSON.stringify({ version, setup: 'Two doses, two endpoints; p = 0.004, 0.009, 0.011, 0.03; Plain language off; Advanced off', text: cap }, null, 1) + '\n');
  console.log('saved from', version);
  await b.close();
})();
