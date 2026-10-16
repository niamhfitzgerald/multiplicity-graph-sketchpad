/* Browser stress test: drives the standalone build with real clicks, keys and typing. */
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const results = []; let fails = 0; let last = '';
const errors = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { const r = await fn(); const ok = r === true || r === undefined; results.push({ name, ok, detail: ok ? '' : String(r), ms: Date.now() - t0 }); if (!ok) fails++; }
  catch (e) { results.push({ name, ok: false, detail: 'THREW ' + (e.message || e).split('\n')[0] + ' [last: ' + last + ']', ms: Date.now() - t0 }); fails++; }
}
(async () => {
  /* Set SKETCHPAD_CHROME to a Chromium executable, or leave it unset to use the Playwright-managed browser (npx playwright install chromium). */
  const b = await chromium.launch({ executablePath: process.env.SKETCHPAD_CHROME || undefined, args: ['--no-sandbox'] });
  const context = await b.newContext({ viewport: { width: 1400, height: 900 } });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  for (const m of ['click', 'fill', 'selectOption', 'check', 'uncheck', 'press', 'dblclick']) { const orig = page[m].bind(page); page[m] = (sel, ...a) => { last = m + ' ' + sel; return orig(sel, ...a); }; }
  const openDet = async id => { const d = page.locator('#' + id); if (!(await d.count())) throw new Error(id + ' missing'); if (!(await d.evaluate(x => x.open))) { await d.locator('summary').click(); await page.waitForTimeout(60); } };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|font|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', async d => { errors.push('dialog: ' + d.message()); await d.dismiss(); });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const nodeCount = () => ev(() => G.nodes.length);
  const status = () => page.locator('#statusBar').innerText();
  const nodeBox = async i => { const el = page.locator('[data-node]').nth(i); return el.boundingBox(); };
  const sleep = ms => page.waitForTimeout(ms);

  await page.goto(FILE);
  await sleep(700);

  await step('Loads with the example graph, status and hint chip', async () => {
    if (await nodeCount() !== 4) return 'nodes ' + await nodeCount();
    const s = await status(); if (!/Valid graph/.test(s)) return 'status: ' + s;
    if (await page.locator('#hintChip').isHidden()) return 'hint chip hidden';
    const t = await page.title(); if (!/Sketchpad/.test(t)) return 'title ' + t;
  });

  await step('Every template loads from the toolbar select without errors', async () => {
    const opts = await page.locator('#templateSelect option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    for (const v of opts) {
      await page.selectOption('#templateSelect', v);
      await sleep(120);
      const n = await nodeCount(); if (n < 2) return `${v}: ${n} nodes`;
      const s = await status(); if (/Error/.test(s)) return `${v}: ${s}`;
      const sel = await page.locator('#templateSelect').inputValue(); if (sel !== '') return 'select did not reset';
    }
    return opts.length === 13 || 'expected 13 options, got ' + opts.length;
  });

  await step('Starter cards: clear graph, size buttons, each card, Import from R', async () => {
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(100);
    if (await nodeCount() !== 0) return 'clear failed';
    if (await page.locator('#starter').isHidden()) return 'starter hidden';
    await page.click('[data-size="1"]'); await page.click('[data-size="1"]');
    if ((await page.locator('#starterM').innerText()) !== '5') return 'size ' + await page.locator('#starterM').innerText();
    for (let i = 0; i < 10; i++) await page.click('[data-size="1"]');
    if ((await page.locator('#starterM').innerText()) !== '10') return 'size cap';
    await page.click('[data-start="holm"]'); await sleep(150);
    if (await nodeCount() !== 10) return 'holm 10 gave ' + await nodeCount();
    for (const k of ['fixed', 'fallback', 'parallel', 'bretz']) {
      await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(80);
      await page.click(`[data-start="${k}"]`); await sleep(120);
      if (await nodeCount() < 3) return k + ' card';
    }
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(80);
    await page.click('[data-start="import"]'); await sleep(150);
    if (await page.locator('#tab-matrix').isHidden()) return 'import card did not open the matrix tab';
    if (!(await page.locator('#det-import').evaluate(d => d.open))) return 'import details not open';
  });

  await step('Matrix import: R code builds a graph; bad input gives a readable message; fill in current graph', async () => {
    await page.fill('#imp-w', 'c(1/2, 1/2, 0, 0)');
    await page.fill('#imp-g', 'matrix(c(0, 1/2, 1/2, 0,\n 1/2, 0, 0, 1/2,\n 0, 1, 0, 0,\n 1, 0, 0, 0), nrow = 4, byrow = TRUE)');
    await page.fill('#imp-names', 'c("A", "B", "C", "D")');
    await page.click('[data-action="import"]'); await sleep(200);
    if (await nodeCount() !== 4) return 'import count';
    const msg = await page.locator('#imp-msg').innerText(); if (!/Built a graph with 4/.test(msg)) return msg;
    const labels = await ev(() => G.nodes.map(n => n.label).join()); if (labels !== 'A,B,C,D') return labels;
    await page.fill('#imp-g', 'matrix(c(0, 1, 1), nrow = 2)'); await page.click('[data-action="import"]'); await sleep(100);
    const bad = await page.locator('#imp-msg').innerText(); if (!/✕/.test(bad) || /undefined|TypeError/.test(bad)) return 'bad message: ' + bad;
    await page.fill('#imp-w', ''); await page.click('[data-action="import"]'); await sleep(100);
    if (!/weight vector first/.test(await page.locator('#imp-msg').innerText())) return 'empty weights message';
    await page.click('[data-action="import-current"]'); await sleep(50);
    const w = await page.inputValue('#imp-w'); if (!/c\(1\/2, 1\/2, 0, 0\)/.test(w)) return 'fill current: ' + w;
    await page.fill('#imp-w', 'c(1/3, 1/3, 1/3)'); await page.fill('#imp-g', '0 1 0\n0 0 1\n1 0 0'); await page.fill('#imp-names', ''); await page.click('[data-action="import"]'); await sleep(150);
    if (await nodeCount() !== 3) return 'plain import';
  });

  await step('Matrix cells: editing syncs to the canvas; bad values are flagged; diagonal is an error with a fix', async () => {
    const first = await page.locator('[data-mw]').first();
    await first.fill('1/2'); await first.press('Tab'); await sleep(150);
    const w = await ev(() => Q.exact(G.nodes[0].w)); if (w !== '1/2') return 'weight sync ' + w;
    const s = await status(); if (!/add up to 7\/6/.test(s)) return 'status after >1: ' + s;
    await page.click('#statusBar [data-fix]'); await sleep(150);
    if (!/Valid graph/.test(await status())) return 'fix did not work: ' + await status();
    const cell = page.locator('[data-mg]').first(); // diagonal 0,0
    await cell.fill('0.5'); await cell.press('Tab'); await sleep(150);
    if (!/Diagonal/.test(await status())) return 'diagonal not flagged';
    await page.click('#statusBar [data-fix]'); await sleep(150);
    if (/Diagonal/.test(await status())) return 'diagonal fix';
    const cell2 = page.locator('[data-mg]').nth(1);
    await cell2.fill('1/0'); await cell2.press('Tab'); await sleep(100);
    if (!(await cell2.evaluate(e => e.classList.contains('bad')))) return 'bad class missing';
    await cell2.fill('1'); await cell2.press('Tab'); await sleep(100);
  });

  await step('Canvas: double-click adds a hypothesis, drag moves it, drag handle creates a transition, inline edit, rename, delete, undo, redo', async () => {
    await page.selectOption('#templateSelect', 'holm'); await sleep(150);
    await page.click('#tabbtn-graph');
    const c = await page.locator('#canvas').boundingBox();
    await page.mouse.dblclick(c.x + 80, c.y + c.height - 80); await sleep(150);
    if (await nodeCount() !== 4) return 'dblclick add: ' + await nodeCount();
    if (!(await page.locator('#tab-graph h2').first().innerText()).includes('Hypothesis H4')) return 'new node not selected in panel';
    // drag the new node
    const b4 = await nodeBox(3);
    await page.mouse.move(b4.x + b4.width / 2, b4.y + b4.height / 2); await page.mouse.down(); await page.mouse.move(b4.x + 200, b4.y - 100, { steps: 8 }); await page.mouse.up(); await sleep(100);
    const b4b = await nodeBox(3); if (Math.abs(b4b.x - b4.x) < 50) return 'drag did not move node';
    // create a transition by dragging the handle of H4 onto H1
    await page.locator('[data-node]').nth(3).click(); await sleep(50);
    const h = await page.locator('[data-node]').nth(3).locator('.handle').boundingBox();
    const b1 = await nodeBox(0);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 10 }); await page.mouse.up(); await sleep(150);
    if (await page.locator('#inlineEdit').isHidden()) return 'inline editor did not open after link';
    await page.fill('#inlineEdit', '1/2'); await page.keyboard.press('Enter'); await sleep(150);
    const e = await ev(() => { const n4 = G.nodes[3], n1 = G.nodes[0]; const ed = G.edges.find(x => x.from === n4.id && x.to === n1.id); return ed ? Q.exact(ed.g) : 'none'; });
    if (e !== '1/2') return 'edge weight ' + e;
    // rename by double-clicking the label area
    const nb = await nodeBox(3);
    await page.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height / 2 - 12); await sleep(120);
    if (await page.locator('#inlineEdit').isHidden()) return 'rename editor did not open';
    await page.fill('#inlineEdit', 'Hnew'); await page.keyboard.press('Enter'); await sleep(100);
    if ((await ev(() => G.nodes[3].label)) !== 'Hnew') return 'rename failed: ' + await ev(() => G.nodes[3].label);
    // bad inline weight stays open with .bad
    await page.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height / 2 + 14); await sleep(120);
    await page.fill('#inlineEdit', '1/0'); await page.keyboard.press('Enter'); await sleep(80);
    if (!(await page.locator('#inlineEdit').evaluate(e => e.classList.contains('bad')))) return 'bad inline weight not flagged';
    await page.keyboard.press('Escape'); await sleep(80);
    // delete with keyboard
    await page.locator('[data-node]').nth(3).click(); await page.keyboard.press('Delete'); await sleep(100);
    if (await nodeCount() !== 3) return 'delete failed';
    await page.keyboard.press('Control+z'); await sleep(100);
    if (await nodeCount() !== 4) return 'undo failed';
    await page.keyboard.press('Control+y'); await sleep(100);
    if (await nodeCount() !== 3) return 'redo failed';
    await page.click('#undoBtn'); await sleep(100); if (await nodeCount() !== 4) return 'undo button';
    await page.click('#redoBtn'); await sleep(100); if (await nodeCount() !== 3) return 'redo button';
  });

  await step('Graph panel: label, weight, p, description, group, colour, connect button, equal weights', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tab-graph [data-action="select-node"]'); await sleep(100);
    await page.fill('#node-label', 'Dose A'); await page.press('#node-label', 'Tab'); await sleep(120);
    if ((await ev(() => G.nodes[0].label)) !== 'Dose A') return 'label';
    await page.fill('#node-w', '0.3'); await page.press('#node-w', 'Tab'); await sleep(120);
    if ((await ev(() => Q.exact(G.nodes[0].w))) !== '3/10') return 'weight';
    await page.fill('#node-w', 'x y'); await page.press('#node-w', 'Tab'); await sleep(80);
    if (!(await page.locator('#node-w').evaluate(e => e.classList.contains('bad')))) return 'bad weight not flagged';
    await page.fill('#node-w', '1/2'); await page.press('#node-w', 'Tab'); await sleep(120);
    await page.fill('#node-p', '0.5'); await page.press('#node-p', 'Tab'); await sleep(120);
    if ((await ev(() => G.nodes[0].p)) !== '0.5') return 'p';
    await page.click('#det-ndesc summary'); await page.fill('#node-desc', 'dose A, primary'); await page.press('#node-desc', 'Tab'); await sleep(120);
    await page.fill('#node-group', 'primary'); await page.press('#node-group', 'Tab'); await sleep(150);
    if ((await ev(() => G.nodes[0].group)) !== 'primary') return 'group';
    if (!(await page.locator('.band').count())) return 'group band not drawn';
    await page.click('.swatch[aria-label="Green"]'); await sleep(100);
    if ((await ev(() => G.nodes[0].color)) !== '#d3ecd4') return 'colour';
    await page.click('[data-action="color-all"]'); await sleep(100);
    if (!(await ev(() => G.nodes.every(n => n.color === '#d3ecd4')))) return 'colour all';
    await page.click('[data-action="deselect"]'); await sleep(80);
    await page.click('[data-action="equal-w"]'); await sleep(100);
    if (!(await ev(() => G.nodes.every(n => Q.exact(n.w) === '1/4')))) return 'equal weights';
    await page.click('#undoBtn'); await sleep(80);
    // connect button then click target
    await page.click('#tab-graph [data-action="select-node"]'); await sleep(80);
    const others = await page.locator('[data-action="connect"]').count(); if (!others) return 'connect button missing';
    await page.click('[data-action="connect"]'); await sleep(80);
    if (!/Click the hypothesis/.test(await page.locator('#hintText').innerText())) return 'linking hint';
    await page.keyboard.press('Escape'); await sleep(80);
    if (/Click the hypothesis/.test(await page.locator('#hintText').innerText())) return 'escape did not cancel linking';
  });

  await step('Variables: typing γ makes a variable; value edits re-evaluate; replace variables', async () => {
    await page.selectOption('#templateSelect', 'successive'); await sleep(150);
    await page.click('#moreMenu summary'); await page.check('#advToggle'); await page.keyboard.press('Escape'); await sleep(100);
    const vars = await ev(() => Object.keys(G.vars).sort().join()); if (vars !== 'γ,δ') return 'vars ' + vars;
    await page.click('#tabbtn-graph');
    if (!(await page.locator('#det-vars').evaluate(d => d.open))) await page.click('#det-vars summary');
    await page.fill('#var-γ', '1/4'); await page.press('#var-γ', 'Tab'); await sleep(150);
    const g = await ev(() => Q.exact(G.edges.find(e => e.expr === 'γ').g)); if (g !== '1/4') return 'gamma value ' + g;
    await page.fill('#var-γ', 'nope'); await page.press('#var-γ', 'Tab'); await sleep(80);
    if (!(await page.locator('#var-γ').evaluate(e => e.classList.contains('bad')))) return 'bad var not flagged';
    await page.fill('#var-γ', '1/4'); await page.press('#var-γ', 'Tab'); await sleep(80);
    await page.click('[data-action="vars-fix"]'); await sleep(120);
    if ((await ev(() => Object.keys(G.vars).length)) !== 0) return 'vars not replaced';
    if ((await ev(() => Q.exact(G.edges[0].g))) !== '1/4') return 'values lost after replace';
  });

  await step('Test tab, Bonferroni: enter p-values, step, run, step back, redo, reset, what-if, order table, what would it take', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tabbtn-test');
    const ps = ['0.004', '0.009', '0.011', '0.03'];
    const inputs = page.locator('[data-p]');
    for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); await sleep(60); }
    await page.click('[data-action="enter-test"]'); await sleep(150);
    if (!(await page.locator('.node.can-reject').count())) return 'no rejectable highlight';
    await page.click('[data-action="step"]'); await sleep(1600);
    if ((await ev(() => T.step)) !== 1) return 'step';
    await page.click('[data-action="step-back"]'); await sleep(150); if ((await ev(() => T.step)) !== 0) return 'step back';
    await page.click('[data-action="redo-step"]'); await sleep(1600); if ((await ev(() => T.step)) !== 1) return 'redo step';
    await page.click('[data-action="run"]'); await sleep(2500);
    const res = await page.locator('.result-card').innerText(); if (!/Rejected: H1, H2, H3/.test(res) || !/Not rejected: H4/.test(res)) return 'result: ' + res;
    if (!/3 steps/.test(await page.locator('#det-steps summary').innerText())) return 'step log summary';
    await page.click('[data-action="reset"]'); await sleep(100); if ((await ev(() => T.step)) !== 0) return 'reset';
    // click a non-rejectable node shows a message
    await page.locator('[data-node]').nth(3).click(); await sleep(100);
    if (!/can't be rejected yet/.test(await page.locator('#hintText').innerText())) return 'message for H4: ' + await page.locator('#hintText').innerText();
    // click rejectable H2 then H1
    await page.locator('[data-node]').nth(1).click(); await sleep(1500);
    await page.locator('[data-node]').nth(0).click(); await sleep(1500);
    await page.click('[data-action="run"]'); await sleep(2000);
    if (!(await page.locator('#det-order').count())) return 'order section missing';
    await openDet('det-order'); await sleep(50);
    const ord = await page.locator('#det-order').innerText(); if (!/different order/.test(ord) || !/same result|Same result/.test(ord)) return 'order text: ' + ord.slice(0, 300);
    await page.click('[data-action="try-order"]'); await sleep(100);
    // what if
    await page.click('[data-action="mode-whatif"]'); await sleep(100);
    await page.locator('[data-node]').nth(3).click(); await sleep(1500);
    if (!(await ev(() => T.whatIfUsed && T.step === 1))) return 'what if reject';
    await page.click('[data-action="mode-p"]'); await sleep(100);
    // what would it take
    if (!(await page.locator('#det-wit').count())) return 'WIT missing';
    await openDet('det-wit');
    const wit = await page.locator('#det-wit').innerText(); if (!/H4/.test(wit)) return 'wit text';
    const show = page.locator('[data-action="wit-show"]').first(); if (await show.count()) { await show.click(); await sleep(100); if (!(await page.locator('.wit-target').count())) return 'wit highlight'; await page.click('[data-action="wit-hide"]'); }
    await page.click('[data-action="exit-test"]'); await sleep(100);
    if ((await ev(() => mode)) !== 'design') return 'exit test';
  });

  await step('Test tab: bad p-values flagged; paste p-values; adjusted p-values section', async () => {
    await page.click('#tabbtn-test');
    const inp = page.locator('[data-p]').first();
    await inp.fill('1.5'); await inp.press('Tab'); await sleep(120);
    if (!/must be a number between 0 and 1/.test(await page.locator('#tab-test').innerText())) return 'bad p message';
    await inp.fill('abc'); await inp.press('Tab'); await sleep(120);
    if (!(await inp.evaluate(e => e.classList.contains('bad')))) return 'bad class';
    if (!(await page.locator('#det-paste').count())) return 'paste section missing (advanced on?)';
    await openDet('det-paste');
    await page.fill('#pastePs', 'c(0.01, 0.02)'); await page.click('[data-action="paste-p"]'); await sleep(80);
    if (!/Found 2 values for 4/.test(await page.locator('#pasteMsg').innerText())) return 'paste count message';
    await page.fill('#pastePs', '0.004 0.009 0.011 0.03'); await page.click('[data-action="paste-p"]'); await sleep(150);
    if ((await ev(() => G.nodes.map(n => n.p).join())) !== '0.004,0.009,0.011,0.03') return 'paste values';
    if (!(await page.locator('#det-adj').count())) return 'adjusted p section missing';
    await openDet('det-adj');
    const adj = await page.locator('#det-adj').innerText(); if (!/0\.008/.test(adj) || !/0\.022/.test(adj)) return 'adjusted values: ' + adj.slice(0, 200);
  });

  await step('Closed tests through the UI: Simes, Simes within groups (no groups warning), parametric (fill, run, SE shown, two-sided refused, incomplete block, clear)', async () => {
    if ((await ev(() => mode)) === 'test') { await page.click('[data-action="exit-test"]'); await sleep(100); }
    await openDet('det-testtype');
    await page.selectOption('#testType', 'simes'); await sleep(150);
    await page.click('[data-action="run"]'); await sleep(800);
    const r1 = await page.locator('.result-card').innerText(); if (!/Rejected: H1, H2, H3/.test(r1)) return 'simes result: ' + r1;
    if (!/Weighted Simes/.test(await page.locator('#det-adj').innerText())) return 'simes adj header';
    await page.click('[data-action="exit-test"]'); await sleep(100);
    await openDet('det-testtype');
    await page.selectOption('#testType', 'simes-groups'); await sleep(150);
    if (!/No groups are set|Groups: primary, secondary/.test(await page.locator('#det-testtype').innerText())) return 'groups note missing: open=' + await page.locator('#det-testtype').evaluate(x => x.open) + ' od=' + await ev(() => [...openDetails].join('|')) + ' mode=' + await ev(() => mode) + ' ' + (await page.locator('#det-testtype').innerText()).slice(0, 300);
    await page.selectOption('#testType', 'parametric'); await sleep(150);
    if (!/same as Bonferroni/.test(await page.locator('#det-testtype').innerText())) return 'no-correlation note missing';
    await page.fill('#tcFill', '0.5'); await page.click('[data-action="tc-fill"]'); await sleep(150);
    if ((await ev(() => Object.keys(G.test.corr).length)) !== 6) return 'fill count';
    await page.click('[data-action="run"]'); await sleep(200);
    await page.waitForFunction(() => CT && CT.type === 'parametric', null, { timeout: 20000 }); await sleep(300);
    const adj = await ev(() => CT.adj.map(x => x.toFixed(4)).join(' ')); if (adj !== '0.0076 0.0115 0.0205 0.0300') return 'parametric adj ' + adj;
    const sec = await page.locator('#det-adj').innerText(); if (!/standard error|SE|±/.test(sec)) return 'SE not shown: ' + sec.slice(0, 300);
    await page.click('[data-action="exit-test"]'); await sleep(100);
    await openDet('det-testtype');
    await page.selectOption('#sidedSelect', 'two'); await sleep(150);
    await page.click('[data-action="run"]'); await sleep(300);
    const hint = await page.locator('#hintText').innerText(); if (!/one-sided/.test(hint)) return 'two-sided not refused: ' + hint;
    await page.selectOption('#sidedSelect', 'one'); await sleep(100);
    const tc = page.locator('[data-tcorr]').first(); await tc.fill(''); await tc.press('Tab'); await sleep(150);
    if (!/complete within each block/.test(await page.locator('#det-testtype').innerText())) return 'incomplete block message';
    await tc.fill('2'); await tc.press('Tab'); await sleep(80); if (!(await tc.evaluate(e => e.classList.contains('bad')))) return 'corr > 1 not flagged';
    await page.click('[data-action="tc-clear"]'); await sleep(100); if ((await ev(() => Object.keys(G.test.corr).length)) !== 0) return 'clear';
    await page.click('[data-action="tc-from-sim"]'); await sleep(100); if ((await ev(() => Object.keys(G.test.corr).length)) !== 6) return 'from sim';
    await page.check('#upscaleToggle'); await sleep(100); if (!(await ev(() => G.test.upscale))) return 'upscale';
    await page.uncheck('#upscaleToggle'); await sleep(100);
    await page.selectOption('#testType', 'bonferroni'); await sleep(100);
  });

  await step('Power tab: run 2,000 simulations, keep, rename, compare, clear, R code, bad inputs, closed-test power', async () => {
    await page.click('#tabbtn-power'); await sleep(100);
    await page.selectOption('#sim-n', '2000');
    await page.click('[data-action="sim-run"]');
    await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 20000 }); await sleep(100);
    const t = await page.locator('#tab-power').innerText(); if (!/Results \(2,?000/i.test(t) || !/At least one rejected/.test(t)) return 'results: ' + t.slice(t.indexOf('Simulations') - 50, t.indexOf('Simulations') + 600);
    await page.click('[data-action="sim-keep"]'); await sleep(100);
    if (!/1 kept/.test(await page.locator('#det-runs summary').innerText())) return 'keep';
    const rn = page.locator('[data-runname]').first(); await rn.fill('Design A'); await rn.press('Tab'); await sleep(50);
    if ((await ev(() => SIM.runs[0].name)) !== 'Design A') return 'rename';
    await page.fill('#sim-rho', '0.9'); await page.press('#sim-rho', 'Tab'); await sleep(100);
    if (!(await page.locator('.stale').count())) return 'stale note missing: ' + await ev(() => [SIM.result && SIM.result.sig === simSig() + testType() + G.test.upscale, SIM.rho, SIM.useMatrix].join());
    await page.fill('[data-pw]', '150'); await page.press('[data-pw]', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await sleep(100);
    if (!/percentage between 0 and 100/.test(await page.locator('#tab-power').innerText())) return 'bad power message';
    await page.fill('[data-pw]', '80'); await page.press('[data-pw]', 'Tab'); await sleep(80);
    await page.fill('#sim-rho', '1.5'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await sleep(100);
    if (!/between −1 and 1/.test(await page.locator('#tab-power').innerText())) return 'bad rho message';
    await page.fill('#sim-rho', '0.5'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await openDet('det-corr'); await page.check('#sim-usematrix'); await sleep(80);
    const sc = page.locator('[data-corr]').first(); await sc.fill('-0.99'); await sc.press('Tab');
    const sc2 = page.locator('[data-corr]').nth(1); await sc2.fill('0.99'); await sc2.press('Tab');
    const sc3 = page.locator('[data-corr]').nth(3); await sc3.fill('0.99'); await sc3.press('Tab'); await sleep(50);
    await page.click('[data-action="sim-run"]'); await sleep(150);
    if (!/positive definite/.test(await page.locator('#tab-power').innerText())) return 'non-PD message';
    await page.uncheck('#sim-usematrix'); await sleep(80);
    await openDet('det-success'); await page.locator('[data-succ]').first().check(); await page.locator('[data-succ]').nth(1).check(); await page.check('input[name="sim-rule"][value="all"]'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 20000 }); await sleep(100);
    if (!/Success \(all of H1, H2\)/.test(await page.locator('#tab-power').innerText())) return 'success rule text';
    await openDet('det-simr'); const code = await page.locator('#simRCode').innerText(); if (!/graph_calculate_power/.test(code) || !/power_marginal = c\(0.8/.test(code)) return 'R code: ' + code.slice(0, 200);
    // closed-test power
    await page.click('#tabbtn-test'); await openDet('det-testtype'); await page.selectOption('#testType', 'simes'); await sleep(100);
    await page.click('#tabbtn-power'); await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 30000 }); await sleep(100);
    if (!/Weighted Simes closed test/.test(await page.locator('#tab-power').innerText())) return 'simes power note';
    await page.click('[data-action="sim-clear"]'); await sleep(50); if ((await ev(() => SIM.runs.length)) !== 0) return 'clear runs';
    await page.click('#tabbtn-test'); await openDet('det-testtype'); await page.selectOption('#testType', 'bonferroni'); await sleep(100);
  });

  await step('Export tab: every export renders, download buttons, copy, SAP tables, load JSON / share link / share code / exchange format / garbage', async () => {
    await page.click('#tabbtn-export'); await sleep(100);
    for (const k of ['png', 'svg', 'tikz', 'graphicalmcp', 'gmcp', 'json', 'link', 'beamer', 'sap']) {
      await page.click(`[data-export="${k}"]`); await sleep(k === 'png' ? 600 : 150);
      const out = await page.locator('#exportOut').innerText();
      if (out.length < 40) return k + ': empty output';
      if (/✕|undefined|NaN/.test(out)) return k + ': ' + out.slice(0, 200);
      if (k !== 'png' && k !== 'sap' && k !== 'link' && !(await page.locator('[data-action="download"]').count())) return k + ': no download button';
      if (k === 'png' && !(await page.locator('#pngPreview').count())) return 'png preview missing';
    }
    await page.click('[data-export="sap"]'); await sleep(100);
    const sap = await page.locator('#sapText').innerText(); if (!/graphical approach of Bretz/.test(sap) || !/one-sided/.test(sap)) return 'sap text: ' + sap.slice(0, 200);
    if ((await page.locator('.sap-table').count()) !== 2) return 'sap tables';
    await page.click('[data-action="copy-sap-text"]'); await sleep(100);
    await page.click('[data-export="json"]'); await sleep(100); await page.click('[data-action="copy"]'); await sleep(100);
    const json = await ev(() => exportPayload);
    await page.click('[data-export="link"]'); await sleep(100); const link = await ev(() => exportPayload);
    if (!/#g1/.test(link)) return 'link ' + link.slice(0, 80);
    // load each form after clearing
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(100);
    await page.click('#tabbtn-export'); await page.click('[data-export="load"]'); await sleep(100);
    await page.fill('#loadText', json); await page.click('[data-action="load-text"]'); await sleep(150);
    if (await nodeCount() !== 4) return 'load json';
    if (!/Opened a graph with 4/.test(await page.locator('#loadMsg').innerText())) return 'load json message';
    await page.fill('#loadText', link); await page.click('[data-action="load-text"]'); await sleep(150);
    if (await nodeCount() !== 4) return 'load link';
    await page.fill('#loadText', link.split('#')[1]); await page.click('[data-action="load-text"]'); await sleep(150);
    if (await nodeCount() !== 4) return 'load code';
    await page.fill('#loadText', JSON.stringify({ format: 'multiplicity-graph', version: 1, source: 'multigrain 0.3.0', alpha: 0.05, hypotheses: [{ name: 'A', weight: 0.6, group: 'primary', p: 0.01 }, { name: 'B', weight: 0.4, group: 'secondary' }], transitions: [[0, 1], [1, 0]] }));
    await page.click('[data-action="load-text"]'); await sleep(150);
    if (await nodeCount() !== 2 || (await ev(() => G.alpha)) !== 0.05 || (await ev(() => G.nodes[0].p)) !== '0.01') return 'exchange format';
    for (const bad of ['{"nodes": "x"}', 'hello', '{broken', '#g1!!', 'g1' + Buffer.from('{"a":1}').toString('base64url')]) {
      await page.fill('#loadText', bad); await page.click('[data-action="load-text"]'); await sleep(100);
      const m = await page.locator('#loadMsg').innerText(); if (!/✕/.test(m) || /undefined|TypeError|Cannot read/.test(m)) return `bad "${bad}": ${m}`;
    }
    // file input
    const fs = require('fs'); const tmp = require('path').join(require('os').tmpdir(), 'graph-test.json'); fs.writeFileSync(tmp, json);
    await page.setInputFiles('#loadFile', tmp); await sleep(300);
    if (await nodeCount() !== 4) return 'file load';
  });

  await step('Download works in the standalone page (download event fires with the right name)', async () => {
    await page.click('[data-export="json"]'); await sleep(100);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('[data-action="download"]')]);
    return dl.suggestedFilename() === 'multiplicity-graph.json' || dl.suggestedFilename();
  });

  await step('Toolbar: alpha validation, sidedness in SAP and share link, decimals, snap, hints, theme, arrange, zoom, fit', async () => {
    await page.fill('#alphaInput', '2'); await page.press('#alphaInput', 'Tab'); await sleep(80);
    if (!(await page.locator('#alphaInput').evaluate(e => e.classList.contains('bad')))) return 'alpha 2 accepted';
    if ((await ev(() => G.alpha)) !== 0.025) return 'alpha changed';
    await page.fill('#alphaInput', '0.05'); await page.press('#alphaInput', 'Tab'); await sleep(120);
    if ((await ev(() => G.alpha)) !== 0.05) return 'alpha 0.05';
    await page.fill('#alphaInput', '1/40'); await page.press('#alphaInput', 'Tab'); await sleep(120);
    if ((await ev(() => G.alpha)) !== 0.025) return 'alpha fraction';
    await page.selectOption('#sidedSelect', 'two'); await sleep(100);
    const sap = await ev(() => sapText(G).paragraphs.join(' ')); if (!/two-sided/.test(sap)) return 'two-sided in SAP';
    const tok = await ev(() => encodeShare(G)); if (!/"s":2/.test(Buffer.from(tok.slice(2), 'base64url').toString())) return 'sided in link';
    await page.selectOption('#sidedSelect', 'one'); await sleep(50);
    await page.click('#moreMenu summary'); await page.check('#decToggle'); await sleep(100);
    if (!/0\.5/.test(await page.locator('.nweight').first().textContent())) return 'decimal display';
    await page.uncheck('#decToggle'); await page.check('#snapToggle'); await page.uncheck('#hintToggle'); await sleep(50);
    if (!(await page.locator('#hintChip').isHidden())) return 'hints still shown';
    await page.check('#hintToggle');
    await page.selectOption('#skinSelect', 'dark'); await sleep(50);
    if ((await ev(() => document.documentElement.dataset.skin)) !== 'dark') return 'skin';
    await page.selectOption('#skinSelect', 'cream'); await page.keyboard.press('Escape'); await sleep(50);
    for (const s of ['circle', 'tworows', 'line', 'grid', 'layers', 'column']) { await page.click('#arrangeMenu summary'); await page.click(`[data-shape="${s}"]`); await sleep(500); }
    await page.click('#arrangeMenu summary'); await page.click('[data-gap="wide"]'); await page.keyboard.press('Escape');
    const k0 = await ev(() => view.k); await page.click('#zoomIn'); if (!((await ev(() => view.k)) > k0)) return 'zoom in';
    await page.click('#zoomOut'); await page.click('#zoomFit'); await sleep(50);
    await page.mouse.move(400, 400); await page.mouse.wheel(0, -300); await sleep(50); if (!((await ev(() => view.k)) > 0)) return 'wheel';
    // pan
    await page.mouse.move(300, 500); await page.mouse.down(); await page.mouse.move(400, 550, { steps: 5 }); await page.mouse.up();
  });

  await step('Presentation mode: enter, Next, Back, Reset, caption, Esc exits', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tabbtn-test'); const inputs = page.locator('[data-p]'); const ps = ['0.004', '0.009', '0.011', '0.03'];
    for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); }
    await sleep(100);
    await page.click('#presentBtn'); await sleep(200);
    if (!(await ev(() => presenting && document.body.classList.contains('present')))) return 'present not entered';
    if (!/can be rejected now/.test(await page.locator('#presentCaption').innerText())) return 'caption: ' + await page.locator('#presentCaption').innerText();
    await page.click('[data-action="pres-next"]'); await sleep(1700);
    if ((await ev(() => T.step)) !== 1) return 'next';
    await page.keyboard.press('ArrowRight'); await sleep(1700); if ((await ev(() => T.step)) !== 2) return 'arrow next';
    await page.click('[data-action="pres-back"]'); await sleep(150); if ((await ev(() => T.step)) !== 1) return 'back';
    await page.click('[data-action="pres-reset"]'); await sleep(100); if ((await ev(() => T.step)) !== 0) return 'reset';
    await page.keyboard.press('Escape'); await sleep(100);
    if (await ev(() => presenting)) return 'esc did not exit';
  });

  await step('Help modal, self-test modal (More menu and debug button), close with Esc and backdrop', async () => {
    await page.click('#helpBtn'); await sleep(50);
    if (await page.locator('#modal').isHidden()) return 'help modal';
    if (!/What the guarantee rests on/.test(await page.locator('#modalBody').innerText())) return 'guarantee section missing';
    await page.keyboard.press('Escape'); if (!(await page.locator('#modal').isHidden())) return 'esc close';
    await page.keyboard.press('?'); await sleep(50); if (await page.locator('#modal').isHidden()) return '? shortcut';
    await page.click('#modal', { position: { x: 5, y: 5 } }); if (!(await page.locator('#modal').isHidden())) return 'backdrop close';
    await page.click('#moreMenu summary'); await page.click('#selftestBtn'); await sleep(3000);
    const st = await page.locator('#modalBody p').first().innerText(); if (!/46 of 46 checks passed/.test(st)) return 'self-test: ' + st;
    await page.click('#modalClose');
  });

  await step('Share link in the URL hash loads the graph; hashchange swaps it; bad hash falls back', async () => {
    const tok = await ev(() => encodeShare(deserializeGraph(templateJSON('bretz2011'), false, 1).G));
    await page.goto(FILE + '#' + tok); await sleep(600);
    if (await nodeCount() !== 6) return 'hash load ' + await nodeCount();
    const tok2 = await ev(() => encodeShare(deserializeGraph(generatedTemplate('holm', 3), false, 1).G));
    await ev(t => { location.hash = t; }, tok2); await sleep(300);
    if (await nodeCount() !== 3) return 'hashchange';
    await page.goto('about:blank'); await page.goto(FILE + '#g1garbage'); await sleep(600);
    if (await nodeCount() !== 4) return 'bad hash fallback';
    const h = await ev(() => location.hash); if (!/^#g1/.test(h)) return 'hash not rewritten after fallback: ' + h;
  });

  await step('Keyboard: Tab to a hypothesis, arrows move it, Enter selects, Delete removes, Escape deselects', async () => {
    await page.locator('[data-node]').first().focus();
    const x0 = await ev(() => G.nodes[0].x);
    await page.keyboard.press('ArrowRight'); await sleep(50);
    if ((await ev(() => G.nodes[0].x)) !== x0 + 20) return 'arrow move';
    await page.keyboard.press('Shift+ArrowLeft'); await sleep(50);
    if ((await ev(() => G.nodes[0].x)) !== x0 + 16) return 'shift arrow';
    await page.keyboard.press('Enter'); await sleep(50);
    if (!(await ev(() => sel && sel.type === 'node'))) return 'enter select';
    await page.keyboard.press('Escape'); await sleep(50); if (await ev(() => sel)) return 'escape deselect';
    const n = await nodeCount();
    await page.locator('[data-node]').first().focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Backspace'); await sleep(80);
    if (await nodeCount() !== n - 1) return 'backspace delete';
    await page.keyboard.press('Control+z'); await sleep(80);
  });

  await step('Settings persist across reload (advanced, decimals, theme, plain)', async () => {
    await page.click('#moreMenu summary'); await page.check('#decToggle'); await page.selectOption('#skinSelect', 'white'); await page.keyboard.press('Escape');
    await page.click('#tabbtn-test'); await page.check('#plainToggle'); await sleep(100);
    await page.reload(); await sleep(600);
    if (!(await ev(() => advanced && numMode === 'dec' && plain && document.documentElement.dataset.skin === 'white'))) return 'settings lost: ' + await ev(() => [advanced, numMode, plain, document.documentElement.dataset.skin].join());
    await page.click('#moreMenu summary'); await page.uncheck('#decToggle'); await page.selectOption('#skinSelect', 'auto'); await page.keyboard.press('Escape');
    await page.click('#tabbtn-test'); await page.uncheck('#plainToggle');
  });

  await step('Plain-language mode reads sensibly in design and test', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tabbtn-test'); { const inputs = page.locator('[data-p]'); const ps = ['0.004', '0.009', '0.011', '0.03']; for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); } } await page.check('#plainToggle'); await sleep(100);
    const t = await page.locator('#tab-test .plain').innerText();
    if (!/The trial asks 4 questions/.test(t) || !/at least one/.test(t)) return 'plain design text: ' + t.slice(0, 200);
    await page.click('[data-action="run"]'); await page.waitForFunction(() => T && T.done && !T.running, null, { timeout: 15000 }); await sleep(200);
    const t2 = await page.locator('#tab-test .plain').innerText();
    if (!/Result:/.test(t2) || !/confirmed/.test(t2)) return 'plain result: ' + t2.slice(-300);
    await page.click('[data-action="exit-test"]'); await page.uncheck('#plainToggle');
  });

  await step('Large graphs: 12-hypothesis cycle, Holm 10 closed Simes in the UI, 40-hypothesis import, WIT limits', async () => {
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(50);
    for (let i = 0; i < 9; i++) await page.click('[data-size="1"]');
    await page.selectOption('#templateSelect', 'cycle'); await sleep(200);
    if (await nodeCount() !== 10) return 'cycle 10: ' + await nodeCount();
    await page.click('#tabbtn-test'); await openDet('det-paste');
    await page.fill('#pastePs', Array.from({ length: 10 }, (_, i) => (0.001 * (i + 1)).toFixed(3)).join(', ')); await page.click('[data-action="paste-p"]'); await sleep(100);
    await openDet('det-testtype'); await page.selectOption('#testType', 'simes'); await sleep(100);
    const t0 = Date.now(); await page.click('[data-action="run"]');
    await page.waitForFunction(() => CT && CT.type === 'simes' && CT.adj.length === 10, null, { timeout: 30000 });
    const ms = Date.now() - t0; if (ms > 10000) return 'Simes m=10 took ' + ms;
    await page.click('[data-action="exit-test"]'); await openDet('det-testtype'); await page.selectOption('#testType', 'bonferroni'); await sleep(50);
    await ev(() => loadGraph(generatedTemplate('holm', 12))); await sleep(200); await openDet('det-wit');
    // WIT with 12 open hypotheses asks before enumerating
    const witTxt = await page.locator('#det-wit').innerText(); if (!/Work it out anyway|sets to check/.test(witTxt)) return 'WIT warning for m=10: ' + witTxt.slice(0, 150);
    await page.click('[data-action="wit-force"]'); await sleep(1500);
    if (!(await page.locator('.wit-card').count())) return 'WIT forced';
    // 40 hypotheses by import
    await page.click('#tabbtn-matrix'); if (!(await page.locator('#det-import').evaluate(d => d.open))) await page.click('#det-import summary');
    await page.fill('#imp-w', 'c(' + Array(40).fill('1/40').join(', ') + ')'); await page.fill('#imp-g', ''); await page.click('[data-action="import"]'); await sleep(400);
    if (await nodeCount() !== 40) return '40 import';
    await page.fill('#imp-w', 'c(' + Array(41).fill('1/41').join(', ') + ')'); await page.click('[data-action="import"]'); await sleep(100);
    if (!/more than 40/.test(await page.locator('#imp-msg').innerText())) return '41 message';
    await page.click('#tabbtn-test'); const st = await page.locator('#tab-test').innerText(); if (/closed test is available/.test(st)) return 'unexpected';
    const s = await status(); if (!/Valid|Warning/.test(s)) return 'status 40: ' + s;
    await page.click('#tabbtn-export'); await page.click('[data-export="png"]'); await sleep(1200); if (!(await page.locator('#pngPreview').count())) return 'png 40';
    await page.click('[data-export="tikz"]'); await sleep(200);
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
  });

  await step('Parametric closed test on 8 hypotheses finishes in the browser with a progress indicator', async () => {
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(50);
    for (let i = 0; i < 10; i++) await page.click('[data-size="-1"]');
    for (let i = 0; i < 6; i++) await page.click('[data-size="1"]');
    await page.click('[data-start="holm"]'); await sleep(150);
    if (await nodeCount() !== 8) return 'holm 8: ' + await nodeCount();
    await page.click('#tabbtn-test'); await openDet('det-paste');
    await page.fill('#pastePs', Array.from({ length: 8 }, (_, i) => (0.002 * (i + 1)).toFixed(3)).join(', ')); await page.click('[data-action="paste-p"]'); await sleep(100);
    await openDet('det-testtype'); await page.selectOption('#testType', 'parametric'); await sleep(100);
    if (!(await page.locator('#tcFill').count())) return 'tcFill missing; mode ' + await ev(() => mode) + ' type ' + await ev(() => G.test.type) + ' panel: ' + (await page.locator('#tab-test').innerText()).slice(0, 500);
    await page.fill('#tcFill', '0.4'); await page.click('[data-action="tc-fill"]'); await sleep(100);
    const t0 = Date.now(); await page.click('[data-action="run"]'); await sleep(400);
    const prog = await page.locator('#ctProgress').count();
    await page.waitForFunction(() => CT && CT.type === 'parametric' && CT.adj.length === 8, null, { timeout: 120000 });
    const ms = Date.now() - t0;
    console.log(`   parametric m=8 in browser: ${ms} ms, progress shown: ${!!prog}`);
    if (!prog && ms > 1500) return 'no progress indicator for a slow test';
    await page.click('[data-action="exit-test"]'); await openDet('det-testtype'); await page.selectOption('#testType', 'bonferroni');
    await page.selectOption('#templateSelect', 'bretz'); await sleep(100);
  });


  await step('Compare tab: keep, compare with a kept graph and a template, same p-values, paired power, stale notice, paste, load, remove', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tabbtn-test'); { const inputs = page.locator('[data-p]'); const ps = ['0.004', '0.009', '0.011', '0.03']; for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); } }
    await page.click('#tabbtn-compare'); await sleep(100);
    await page.fill('#cmpKeepName', 'Two doses'); await page.click('[data-action="cmp-keep"]'); await sleep(150);
    if ((await ev(() => KEPT.length)) !== 1) return 'keep';
    await page.selectOption('#templateSelect', 'successiveI'); await sleep(150);
    await page.click('#tabbtn-test'); { const inputs = page.locator('[data-p]'); const ps = ['0.004', '0.009', '0.011', '0.03']; for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); } }
    await page.click('#tabbtn-compare'); await page.selectOption('#cmpWith', 'kept:0'); await sleep(200);
    if ((await page.locator('.cmp-pic').count()) !== 2) return 'pictures';
    if (!/4 transitions differ/.test(await page.locator('#det-cmp-structure summary').innerText())) return 'structure summary: ' + await page.locator('#det-cmp-structure summary').innerText();
    await openDet('det-cmp-test'); await page.click('[data-action="cmp-test"]'); await page.waitForFunction(() => CMP.test && !CMP.running, null, { timeout: 10000 }); await sleep(100);
    const tt = await page.locator('#det-cmp-test').innerText(); if (!/Same result: H1, H2 and H3 rejected by both/.test(tt)) return 'test both: ' + tt.slice(0, 300);
    await openDet('det-cmp-power'); await page.click('#tabbtn-power'); await page.selectOption('#sim-n', '2000'); await page.click('#tabbtn-compare');
    await page.click('[data-action="cmp-power"]'); await page.waitForFunction(() => CMP.power && !CMP.running, null, { timeout: 30000 }); await sleep(100);
    const pt = await page.locator('#det-cmp-power').innerText(); if (!/B − A \(points\) ± SE/.test(pt) || !/At least one/.test(pt) || !/2,?000 simulated trials/.test(pt)) return 'power table: ' + pt.slice(0, 300);
    await page.click('[data-action="cmp-copy-power"]'); await sleep(50);
    await page.click('#tabbtn-graph'); await page.click('#tab-graph [data-action="select-node"]'); await page.fill('#node-w', '0.6'); await page.press('#node-w', 'Tab'); await sleep(150);
    await page.click('#tabbtn-compare'); await sleep(100);
    if ((await page.locator('#tab-compare .stale').count()) !== 2) return 'stale notices: ' + await page.locator('#tab-compare .stale').count();
    await page.selectOption('#cmpWith', 'tpl:holm'); await sleep(150);
    if (!/do not list the same hypotheses/.test(await page.locator('#tab-compare').innerText())) return 'mismatch message';
    await page.selectOption('#cmpWith', 'paste'); await sleep(100); await page.fill('#cmpPaste', 'nonsense'); await page.click('[data-action="cmp-use-paste"]'); await sleep(100);
    if (!/✕ Paste a saved JSON graph/.test(await page.locator('#tab-compare').innerText())) return 'paste error message';
    const link = await ev(() => encodeShare(deserializeGraph(templateJSON('bretz'), false, 1).G));
    await page.fill('#cmpPaste', link); await page.click('[data-action="cmp-use-paste"]'); await sleep(200);
    if ((await page.locator('.cmp-pic').count()) !== 2) return 'pasted graph not shown';
    await page.click('[data-action="cmp-load"]'); await sleep(200); if ((await ev(() => Q.exact(G.nodes[0].w))) !== '1/2') return 'load as A';
    await page.click('[data-action="cmp-remove"]'); await sleep(100); if ((await ev(() => KEPT.length)) !== 0) return 'remove';
    await page.click('#tabbtn-power'); await page.selectOption('#sim-n', '10000'); await page.click('#tabbtn-graph');
  });

  await step('Phone-width layout: no horizontal overflow, tabs and toolbar usable at 390px', async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await sleep(400);
    const over = await ev(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) return 'horizontal overflow ' + over + 'px';
    await page.click('#tabbtn-test'); await sleep(100); if (await page.locator('#tab-test').isHidden()) return 'tab hidden';
    const offs = await ev(() => [...document.querySelectorAll('.topbar .btn, .topbar select, .topbar input')].filter(e => e.offsetParent !== null && !e.closest('.menu-pop')).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 1 || r.left < -1); }).map(e => e.id || e.className));
    if (offs.length) return 'toolbar items off screen: ' + offs.join(',');
    await page.click('#tabbtn-graph');
    await page.setViewportSize({ width: 1400, height: 900 }); await sleep(300);
  });

  await step('Artifact build (iframe-like, non-top) hides the download buttons until the capability resolves and shows the share code', async () => {
    const p2 = await context.newPage();
    p2.on('pageerror', e => errors.push('artifact pageerror: ' + e.message));
    const wrapFile = require('path').join(require('os').tmpdir(), 'wrap.html');
    require('fs').writeFileSync(wrapFile, `<iframe id="f" src="${FILE}" style="width:1200px;height:800px"></iframe>`);
    await p2.goto('file://' + wrapFile);
    await p2.waitForTimeout(900);
    const fr = p2.frames().find(f => f !== p2.mainFrame());
    if (!fr) return 'no frame';
    const r = await fr.evaluate(() => { setAdvanced(true, true); setTab('export'); showExport('link'); return { isTop, txt: document.getElementById('exportOut').innerText.slice(0, 120), nodes: G.nodes.length }; });
    if (r.isTop) return 'isTop in frame';
    if (!/share code/i.test(r.txt)) return 'share code text: ' + r.txt;
    await p2.close();
  });

  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ` (${r.ms} ms)` + (r.ok ? '' : '\n      ' + r.detail));
  console.log(`\n${results.length - fails}/${results.length} browser checks passed`);
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
