/* Reads the visible text of the Test tab for the clinician set-up (two doses, two endpoints; p = 0.004, 0.009, 0.011,
   0.03), in Design, Step through, after Run test, What-if after H1, the click messages and presentation mode.
   Used by browser-stress.js and by make-plain-snapshot.js (which saved tests/plain-off-1.3.0.json from 1.3.0).

   With plain = false the "What would it take?" and "Step log" sections are opened, so their text is compared too.
   With plain = true only "What would it take?" is opened: "Show the sums" stays closed, as a clinician sees it.
   #plainToggle is the Plain language box: in the Test tab up to 1.3.1, at the foot of the side panel after that. */
const SETUP_P = ['0.004', '0.009', '0.011', '0.03'];

async function capturePlain(page, plain) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const sleep = ms => page.waitForTimeout(ms);
  const idle = async () => { for (let i = 0; i < 200; i++) { if (await ev(() => !animating && !(T && T.running))) return; await sleep(50); } throw new Error('still animating'); };
  const open = async ids => { await ev(ids => ids.forEach(id => { const d = document.getElementById(id); if (d && !d.open) { d.open = true; openDetails.add(id); } }), ids); await sleep(50); };
  const opens = plain ? ['det-wit'] : ['det-wit', 'det-steps'];
  const read = async () => ({
    tab: await page.locator('#tab-test').innerText(),
    canvas: await ev(() => [...document.querySelectorAll('#world .ncap')].map(x => x.textContent)),
    hint: await page.locator('#hintText').innerText(),
    toolbar: await ev(() => [document.querySelector('label[for="alphaInput"]').innerText, ...[...document.querySelectorAll('#sidedSelect option')].map(o => o.textContent)])
  });
  const out = {};

  /* the clinician set-up, in a fresh page */
  await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
  await page.click('#tabbtn-test'); await sleep(100);
  const inputs = page.locator('[data-p]');
  for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(SETUP_P[i]); await inputs.nth(i).press('Tab'); }
  if (plain) await page.check('#plainToggle'); else await page.uncheck('#plainToggle');
  await sleep(150);

  await open(opens); out.design = await read();

  /* Step through it: before any step, then the click messages for H3 (no share yet), one step, H3 again (share too small) */
  await page.click('[data-action="enter-test"]'); await sleep(150);
  await open(opens); out.stepStart = await read();
  const clickNode = async label => { const id = await ev(l => G.nodes.find(n => n.label === l).id, label); await page.click(`[data-node="${id}"] .node-body`); await sleep(100); return page.locator('#hintText').innerText(); };
  out.clickNoShare = await clickNode('H3');
  await page.click('[data-action="step"]'); await idle(); await sleep(100);
  await open(opens); out.afterOneStep = await read();
  out.clickTooSmall = await clickNode('H3');

  /* Run test to the end */
  await page.click('[data-action="reset"]'); await idle();
  await page.click('[data-action="run"]'); await idle(); await sleep(150);
  await open(opens); out.afterRun = await read();

  /* What-if after H1 */
  await page.click('[data-action="reset"]'); await idle();
  await page.click('[data-action="mode-whatif"]'); await sleep(150);
  await open(opens); out.whatIfStart = await read();
  const h1 = await ev(() => G.nodes.find(n => n.label === 'H1').id);
  await page.click(`[data-action="reject"][data-id="${h1}"]`); await idle(); await sleep(150);
  await open(opens); out.whatIfH1 = await read();

  /* Presentation mode: every caption from the start to the end, and the drawing at the end */
  await page.click('[data-action="mode-p"]'); await sleep(150);
  await ev(() => enterPresent()); await sleep(150);
  const caps = [await page.locator('#presentCaption').innerText()];
  for (let i = 0; i < 6; i++) {
    if (await page.locator('[data-action="pres-next"]').isDisabled()) break;
    await page.click('[data-action="pres-next"]'); await idle(); await sleep(100);
    caps.push(await page.locator('#presentCaption').innerText());
  }
  out.present = { captions: caps, canvas: await ev(() => [...document.querySelectorAll('#world .ncap')].map(x => x.textContent)) };
  await ev(() => exitPresent()); await sleep(100);
  await page.click('[data-action="exit-test"]'); await sleep(100);
  return out;
}

/* Words a clinician should not meet with Plain language ticked (Bonferroni step-through) */
const OLD_WORDS = [/Hyp\./, /Weight now/, /Level now/, /\bStatus\b/, /\breject/i, /α/, /\balpha\b/i, /\blevel\b/i, /≤/, /one-sided p/, /two-sided p/];

/* Every place an old word appears, as "state/part: word in '...context...'" */
function oldWordsIn(cap) {
  const hits = [];
  const scan = (where, text) => { for (const re of OLD_WORDS) { const m = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g'); let x; while ((x = m.exec(text))) hits.push(`${where}: ${x[0]} in "${text.slice(Math.max(0, x.index - 30), x.index + 30).replace(/\s+/g, ' ')}"`); } };
  const walk = (where, v) => { if (typeof v === 'string') scan(where, v); else if (Array.isArray(v)) v.forEach((x, i) => walk(`${where}[${i}]`, x)); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(where ? `${where}.${k}` : k, x)); };
  walk('', cap);
  return hits;
}

module.exports = { capturePlain, oldWordsIn, OLD_WORDS, SETUP_P };
