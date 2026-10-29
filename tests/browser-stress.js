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
    /* the entangled templates come last; leave an ordinary graph for the steps that follow */
    await page.selectOption('#templateSelect', 'holm'); await sleep(120);
    /* 25 with Plain language off (the default): the four statistician-only templates are in (21 up to 1.3.1, with Advanced off) */
    return opts.length === 25 || 'expected 25 options, got ' + opts.length;
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

  await step('Improved fallback I for any m: start card and toolbar entry take typed weights, refuse bad ones, Escape and Cancel close the box', async () => {
    if (await nodeCount()) { await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(80); }
    await page.click('#tabbtn-graph'); await sleep(60);
    for (let i = 0; i < 12; i++) await page.click('[data-size="-1"]');
    await page.click('[data-size="1"]'); await page.click('[data-size="1"]');
    await page.click('[data-start="improvedFallbackI"]'); await sleep(100);
    if (await page.locator('#starterWeights').isHidden()) return 'weights box hidden';
    if ((await page.inputValue('#starterW')) !== '1/4, 1/4, 1/4, 1/4') return 'prefill ' + await page.inputValue('#starterW');
    await page.click('[data-size="-1"]'); await sleep(60);
    if ((await page.inputValue('#starterW')) !== '1/3, 1/3, 1/3') return 'prefill after size change ' + await page.inputValue('#starterW');
    await page.fill('#starterW', '0.5, 0.6'); await page.press('#starterW', 'Enter'); await sleep(100);
    if (await nodeCount() !== 0) return 'bad weights made a graph';
    if (!/more than 1/.test(await page.locator('#starterWMsg').innerText())) return 'no message for bad weights';
    await page.press('#starterW', 'Escape'); await sleep(60);
    if (!(await page.locator('#starterWeights').isHidden())) return 'Escape did not close the start box';
    await page.click('[data-start="improvedFallbackI"]'); await sleep(60);
    await page.fill('#starterW', '1/2, 3/10, 1/5'); await page.click('#starterWBtn'); await sleep(200);
    if (await nodeCount() !== 3) return 'start card gave ' + await nodeCount() + ' nodes';
    const ret = await ev(() => G.edges.filter(e => e.from === G.nodes[2].id).map(e => Q.exact(e.g)).join(' '));
    if (ret !== '5/8 3/8') return 'return transitions ' + ret;
    if (!/alpha-exhaustive\./.test(await status())) return 'status: ' + await status();
    /* toolbar entry with a graph open */
    await page.selectOption('#templateSelect', 'improvedFallbackIAny'); await sleep(150);
    if (!(await page.locator('#tplW').count())) return 'Graph panel box missing';
    if ((await page.inputValue('#tplW')) !== '1/3, 1/3, 1/3') return 'panel prefill ' + await page.inputValue('#tplW');
    await page.fill('#tplW', 'a, b'); await page.click('[data-action="tpl-w-create"]'); await sleep(100);
    if (await nodeCount() !== 3) return 'bad panel weights changed the graph';
    if (!/Could not read/.test(await page.locator('#tplWMsg').innerText())) return 'no panel message';
    if ((await page.inputValue('#tplW')) !== 'a, b') return 'typed text lost on re-render';
    await page.click('[data-action="tpl-w-cancel"]'); await sleep(60);
    if (await page.locator('#tplW').count()) return 'Cancel left the box open';
    await page.selectOption('#templateSelect', 'improvedFallbackIAny'); await sleep(100);
    await page.fill('#tplW', 'c(0.4, 0.25, 0.25, 0.05, 0.05)'); await page.press('#tplW', 'Enter'); await sleep(250);
    if (await nodeCount() !== 5) return 'panel gave ' + await nodeCount() + ' nodes';
    const ret5 = await ev(() => G.edges.filter(e => e.from === G.nodes[4].id).map(e => Q.exact(e.g)).join(' '));
    if (ret5 !== '8/19 5/19 5/19 1/19') return 'm = 5 return transitions ' + ret5;
    if (await page.locator('#tplW').count()) return 'box still open after Create';
    await page.click('#undoBtn'); await sleep(150);
    if (await nodeCount() !== 3) return 'undo gave ' + await nodeCount();
    await page.selectOption('#templateSelect', 'improvedFallbackIAny'); await sleep(100);
    await page.press('#tplW', 'Escape'); await sleep(60);
    if (await page.locator('#tplW').count()) return 'Escape left the panel box open';
    /* leave the page as the previous step did: empty canvas, Import from R open */
    await page.click('#moreMenu summary'); await page.click('#clearBtn'); await page.click('#clearYes'); await sleep(80);
    await page.click('[data-start="import"]'); await sleep(150);
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
    await ev(() => setPlain(false)); await sleep(100);
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

  await step('Statistician-only templates (data-adv): in the picker with Plain language off, loaded with their variables, taken out with it on', async () => {
    const adv = await page.locator('#templateSelect option[data-adv]').evaluateAll(os => os.map(o => o.value));
    if (!adv.includes('hungWang') || !adv.includes('efficacySafety')) return 'statistician-only options: ' + adv.join(',');
    const full = await page.locator('#templateSelect option').evaluateAll(os => os.map(o => o.value));
    for (const v of adv) {
      await page.selectOption('#templateSelect', v); await sleep(150);
      const n = await nodeCount(); if (n < 2) return `${v}: ${n} nodes`;
    }
    await page.selectOption('#templateSelect', 'hungWang'); await sleep(150);
    const lab = await ev(() => G.nodes.map(n => n.label).join('|')); if (lab !== 'H1,NI|H1,S|H2,NI|H2,S') return 'labels ' + lab;
    const vars = await ev(() => Object.keys(G.vars).sort().join('')); if (vars !== 'ντω') return 'vars ' + vars;
    const s = await status(); if (!/H2,S has no outgoing/.test(s)) return 'status: ' + s;
    await page.check('#plainToggle'); await sleep(100);
    const simple = await page.locator('#templateSelect option').evaluateAll(os => os.map(o => o.value));
    if (adv.some(v => simple.includes(v))) return 'statistician-only options still listed with Plain language on';
    await page.uncheck('#plainToggle'); await sleep(100);
    const back = await page.locator('#templateSelect option').evaluateAll(os => os.map(o => o.value));
    if (!adv.every(v => back.includes(v))) return 'statistician-only options not restored';
    if (back.join() !== full.join()) return 'options not back in their places: ' + back.join(',');
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
    if (!(await page.locator('#det-paste').count())) return 'paste section missing (Plain language on?)';
    await openDet('det-paste');
    await page.fill('#pastePs', 'c(0.01, 0.02)'); await page.click('[data-action="paste-p"]'); await sleep(80);
    if (!/Found 2 values for 4/.test(await page.locator('#pasteMsg').innerText())) return 'paste count message';
    await page.fill('#pastePs', '0.004 0.009 0.011 0.03'); await page.click('[data-action="paste-p"]'); await sleep(150);
    if ((await ev(() => G.nodes.map(n => n.p).join())) !== '0.004,0.009,0.011,0.03') return 'paste values';
    if (!(await page.locator('#det-adj').count())) return 'adjusted p section missing';
    await openDet('det-adj');
    const adj = await page.locator('#det-adj').innerText(); if (!/0\.008/.test(adj) || !/0\.022/.test(adj)) return 'adjusted values: ' + adj.slice(0, 200);
  });

  await step('Closed tests through the UI: Simes, Simes within groups (no groups warning), parametric (fill, run, exact for a block of four with no SE, two-sided refused, incomplete block, clear)', async () => {
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
    const sec = await page.locator('#det-adj').innerText(); if (!/exact numerical integration/.test(sec) || /largest Monte Carlo standard error/.test(sec) || (await ev(() => CT.se)) != null) return 'block of four should be exact with no SE: ' + sec.slice(0, 300);
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
    await page.fill('#tab-power [data-pw]', '150'); await page.press('#tab-power [data-pw]', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await sleep(100);
    if (!/percentage between 0 and 100/.test(await page.locator('#tab-power').innerText())) return 'bad power message';
    await page.fill('#tab-power [data-pw]', '80'); await page.press('#tab-power [data-pw]', 'Tab'); await sleep(80);
    await page.fill('#sim-rho', '1.5'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await sleep(100);
    if (!/between −1 and 1/.test(await page.locator('#tab-power').innerText())) return 'bad rho message';
    await page.fill('#sim-rho', '0.5'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await openDet('det-corr'); await page.check('#sim-usematrix'); await sleep(80);
    const sc = page.locator('#tab-power [data-corr]').first(); await sc.fill('-0.99'); await sc.press('Tab');
    const sc2 = page.locator('#tab-power [data-corr]').nth(1); await sc2.fill('0.99'); await sc2.press('Tab');
    const sc3 = page.locator('#tab-power [data-corr]').nth(3); await sc3.fill('0.99'); await sc3.press('Tab'); await sleep(50);
    await page.click('[data-action="sim-run"]'); await sleep(150);
    if (!/positive semi-definite/.test(await page.locator('#tab-power').innerText())) return 'non-PSD message';
    await page.uncheck('#sim-usematrix'); await sleep(80);
    // correlations entered as 1 are capped at 0.999999 and the result text says so (1.1.6)
    await page.fill('#sim-rho', '1'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 20000 }); await sleep(100);
    const capT = await page.locator('#tab-power').innerText();
    if (!/Correlation: 1 for every pair \(6 pairs entered as 1 were set to 0\.999999/.test(capT)) return 'cap notice: ' + capT.slice(capT.indexOf('Correlation:'), capT.indexOf('Correlation:') + 120);
    await page.fill('#sim-rho', '0.5'); await page.press('#sim-rho', 'Tab'); await sleep(80);
    await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 20000 }); await sleep(100);
    if (/set to 0\.999999/.test(await page.locator('#tab-power').innerText())) return 'cap notice shown without a cap';
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

  await step('Optimise tab: shared inputs, quick rules, build from values (p. 8 numbers), write your own, refusals, gain table, expected gain, Power tab shows the gain, simple mode hides it', async () => {
    await ev(() => { loadGraph(templateJSON('parallel')); SIM.success = { ids: [], rule: 'any' }; SIM.rho = '0.5'; SIM.useMatrix = false; OPT.source = 'quick'; OPT.quick = 'any'; OPT.text = ''; OPT.values = { reg: [], rule: 'all', scores: {}, anchor: '150' }; OPT.result = null; renderAll(); });
    await page.click('#tabbtn-optimise'); await sleep(100);
    const txt = () => page.locator('#tab-optimise').innerText();
    if (!/Tick at least one hypothesis/.test(await txt())) return 'no-tick message';
    await page.locator('#tab-optimise [data-osucc]').nth(0).check(); await page.locator('#tab-optimise [data-osucc]').nth(1).check(); await sleep(100);
    if ((await page.locator('#optExpr').innerText()) !== 'r1 || r2') return 'quick any: ' + await page.locator('#optExpr').innerText();
    if (!(await page.locator('#tab-power [data-succ]').nth(1).isChecked())) return 'ticks not shared with the Power tab';
    await page.click('#tab-optimise [data-oseg="quick"][data-val="all"]'); await sleep(100);
    if ((await page.locator('#optExpr').innerText()) !== 'r1 && r2' || !/both H1 and H2 are rejected/.test(await txt())) return 'quick all';
    await page.click('#tab-optimise [data-oseg="quick"][data-val="average"]'); await sleep(100);
    if ((await page.locator('#optExpr').innerText()) !== '(r1 + r2 + r3 + r4) / 4') return 'average';
    const ids = await ev(() => G.nodes.map(n => n.id));
    await page.click('#tab-optimise [data-oseg="source"][data-val="values"]'); await sleep(100);
    if (!/Tick the hypotheses that make up regulatory success/.test(await txt())) return 'values: no reg message';
    await page.locator('#tab-optimise [data-oreg]').nth(0).check(); await sleep(100);
    if (!/Give H2, H3, H4 a score/.test(await txt())) return 'values: score message';
    for (const [k, v] of [[1, '90'], [2, '45'], [3, '0']]) { await page.fill('#opt-score-' + ids[k], v); await page.locator('#opt-score-' + ids[k]).dispatchEvent('change'); await sleep(60); }
    if ((await page.locator('#optExpr').innerText()) !== 'r1 * (0.6667 + 0.2222*r2 + 0.1111*r3)') return 'osteoporosis gain: ' + await page.locator('#optExpr').innerText();
    await page.fill('#opt-anchor', '90'); await page.locator('#opt-anchor').dispatchEvent('change'); await sleep(100);
    if (!/100 or more/.test(await txt())) return 'anchor message';
    await page.fill('#opt-anchor', '150'); await page.locator('#opt-anchor').dispatchEvent('change'); await sleep(100);
    await page.click('#tab-optimise [data-oseg="source"][data-val="own"]'); await sleep(100);
    if ((await page.locator('#opt-text').inputValue()) !== 'r1 * (0.6667 + 0.2222*r2 + 0.1111*r3)') return 'own box not prefilled';
    await page.fill('#opt-text', 'r1 && (r2 + r3)'); await sleep(400);
    if (!(await page.locator('#optExpr mark').count()) || !/can only join/.test(await txt())) return 'refusal not shown';
    await page.fill('#opt-text', 'r1 - r2'); await sleep(400);
    if (!/negative for some rejection sets/.test(await txt())) return 'negative warning';
    await page.fill('#opt-text', 'r5'); await sleep(400);
    if (!/r5 does not exist/.test(await txt())) return 'r5 message';
    await page.fill('#opt-text', ''); await page.locator('#opt-text').focus(); await page.click('#tab-optimise [data-ins="r1"]'); await page.click('#tab-optimise [data-ins="||"]'); await page.click('#tab-optimise [data-ins="r2"]'); await sleep(400);
    if ((await page.locator('#opt-text').inputValue()) !== 'r1 || r2') return 'insert buttons: ' + await page.locator('#opt-text').inputValue();
    await page.fill('#opt-text', 'r1*r2 || r3*r4'); await sleep(400);
    if (!/either \(both H1 and H2 are rejected\) or \(both H3 and H4 are rejected\)/.test(await txt())) return 'reading: ' + (await txt()).match(/In words: [^\n]*/);
    await openDet('det-gaintable'); if ((await page.locator('#det-gaintable tbody tr').count()) !== 16) return 'gain table rows';
    await page.selectOption('#opt-n', '2000'); await page.click('[data-action="opt-run"]'); await page.waitForFunction(() => OPT.result && !OPT.running, null, { timeout: 20000 }); await sleep(100);
    const r = await ev(() => { const t = OPT.result.tally; return { n: t.n, g: t.gain / t.n }; });
    if (r.n !== 2000 || !(r.g > 0.3 && r.g < 0.9)) return 'expected gain result ' + JSON.stringify(r);
    if (!/Expected gain\n0\.\d{3} ± 0\.\d{3}/.test(await txt())) return 'result text';
    await page.fill('#opt-sim-rho', '0.2'); await page.locator('#opt-sim-rho').dispatchEvent('change'); await sleep(100);
    if (!(await page.locator('#tab-optimise .stale').count())) return 'stale note';
    await page.click('#tabbtn-power'); await sleep(60);
    if ((await page.locator('#sim-rho').inputValue()) !== '0.2') return 'rho not shared';
    await page.selectOption('#sim-n', '2000'); await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => SIM.result && !SIM.running, null, { timeout: 20000 }); await sleep(100);
    if (!/Expected gain\n0\.\d{3} ± 0\.\d{3} gain function from the Optimise tab/.test(await page.locator('#tab-power').innerText())) return 'Power tab gain missing';
    await page.fill('#sim-rho', '0.5'); await page.locator('#sim-rho').dispatchEvent('change'); await sleep(100);
    await page.click('#tabbtn-optimise'); await sleep(60);
    if ((await page.locator('#opt-sim-rho').inputValue()) !== '0.5') return 'rho edit in the Power tab not shown';
    await page.check('#plainToggle'); await sleep(100);
    if (await page.locator('#tabbtn-optimise').isVisible() || (await ev(() => activeTab)) !== 'graph' || await page.locator('#tab-optimise').isVisible() || !(await page.locator('#tab-graph').isVisible())) return 'Plain language on: Optimise tab or panel still shown';
    await page.uncheck('#plainToggle'); await sleep(100);
    await ev(() => { OPT.source = 'quick'; OPT.text = ''; SIM.success = { ids: [], rule: 'any' }; SIM.n = 10000; renderAll(); });
  });

  await step('Optimise tab, fixed and free parts: locks in the Matrix view, existing-edges shortcut, summary, constraint problems with one-click fixes, entangled graph note', async () => {
    await ev(() => { loadGraph(templateJSON('parallel')); OPT.lockW.clear(); OPT.lockG.clear(); OPT.existingOnly = false; OPT.showLocks = false; renderAll(); });
    await page.click('#tabbtn-optimise'); await sleep(100);
    const txt = () => page.locator('#tab-optimise').innerText();
    if (!/Free\n4 of 4 weights, 12 of 12 transitions\nLocked\nnone/.test(await txt())) return 'default summary: ' + (await txt()).match(/Free\n[^\n]*\nLocked\n[^\n]*/);
    await page.click('[data-action="opt-show-locks"]'); await sleep(100);
    if ((await ev(() => activeTab)) !== 'matrix' || !(await page.locator('#mx-locks').isChecked()) || (await page.locator('#tab-matrix .lock').count()) !== 16) return 'locks not shown in the Matrix tab';
    const ids = await ev(() => G.nodes.map(n => n.id));
    await page.click(`#tab-matrix [data-lockw="${ids[0]}"]`); await page.click(`#tab-matrix [data-lockg="${ids[0]}>${ids[2]}"]`); await sleep(100);
    if ((await page.locator('#tab-matrix .lock[aria-pressed="true"]').count()) !== 2 || (await page.locator('#tab-matrix input.locked').count()) !== 2) return 'lock toggles';
    await page.click('#tabbtn-optimise'); await sleep(60);
    if (!/Free\n3 of 4 weights, 11 of 12 transitions\nLocked\nw\(H1\) = 1\/2; H1 → H3: 1\/2/.test(await txt())) return 'summary after locks: ' + (await txt()).match(/Free\n[^\n]*\nLocked\n[^\n]*/);
    await page.check('#opt-existing'); await sleep(100);
    if (!/5 of 12 transitions/.test(await txt()) || !/Fixed at 0\n6 missing transitions/.test(await txt())) return 'existing-only summary';
    await page.click('#tabbtn-matrix'); await sleep(60);
    if ((await page.locator('#tab-matrix .lock:disabled').count()) !== 6 || (await page.locator('#tab-matrix .lock[aria-pressed="true"]').count()) !== 8) return 'forced locks in the matrix';
    await page.click('#tabbtn-optimise'); await page.uncheck('#opt-existing'); await sleep(60); await page.click('[data-action="opt-lock-w"]'); await sleep(60);
    if (/✕/.test(await txt())) return 'problem shown with all weights locked at a sum of 1: ' + ((await txt()).match(/✕[^\n]*/g) || []).join(' | ');
    await ev(() => { nodeById(G.nodes[0].id).w = Q.parse('1/4'); renderAll(); }); await sleep(60);
    if (!/add up to 0\.75, not 1/.test(await txt())) return 'weight-sum problem: ' + ((await txt()).match(/✕[^\n]*/) || 'none');
    await page.click('[data-action="opt-unlock-w"]'); await sleep(60);
    if (/✕/.test(await txt()) || !/Free\n4 of 4 weights/.test(await txt())) return 'unlock weights fix';
    await page.click('[data-action="opt-lock-g"]'); await sleep(60);
    if (!/0 of 12 transitions/.test(await txt()) || /✕/.test(await txt())) return 'lock all transitions';
    await ev(() => { setEdgeWeight(G.nodes[2].id, G.nodes[3].id, Q.parse('1/2')); renderAll(); }); await sleep(60);
    if (!/Every transition from H3 is fixed, but the row adds up to 0\.5, not 1/.test(await txt())) return 'row problem: ' + ((await txt()).match(/✕[^\n]*/) || 'none');
    await page.click('[data-action^="opt-free-row:"]'); await sleep(60);
    if (/✕/.test(await txt())) return 'row fix';
    await ev(() => { const ids = G.nodes.map(n => n.id); nodeById(ids[0]).w = Q.parse('1/2'); OPT.lockG.clear(); OPT.lockW.clear(); OPT.lockW.add(ids[0]); OPT.lockW.add(ids[1]); renderAll(); }); await sleep(60);
    if (!/locked weights already add up to 1/.test(await txt())) return 'incomplete weights at 1: ' + ((await txt()).match(/✕[^\n]*/) || 'none');
    await page.click('[data-action="opt-lock-w"]'); await sleep(60); if (/✕/.test(await txt())) return 'lock the free weights too';
    await ev(() => { OPT.lockW.clear(); OPT.freeRows.clear(); OPT.existingOnly = true; renderAll(); }); await sleep(60);
    if (!/Only one transition from H3 is free/.test(await txt()) || (await page.locator('#tab-optimise .msg').count()) !== 2) return 'single free transition (existing-only on parallel gatekeeping): ' + ((await txt()).match(/✕[^\n]*/g) || ['none']).join(' | ');
    await page.click('[data-action^="opt-free-row:"]'); await page.click('[data-action^="opt-free-row:"]'); await sleep(60);
    if (/✕/.test(await txt()) || !/rows kept free: H3, H4/.test(await txt())) return 'free-row fixes: ' + ((await txt()).match(/✕[^\n]*/g) || ['none']).join(' | ');
    await ev(() => { OPT.existingOnly = false; OPT.freeRows.clear(); const ids = G.nodes.map(n => n.id); for (const n of G.nodes) OPT.lockW.add(n.id); for (const a of G.nodes) for (const b of G.nodes) if (a !== b) OPT.lockG.add(gKey(a.id, b.id)); renderAll(); }); await sleep(60);
    if (!/nothing for multigrain to optimise/.test(await txt())) return 'nothing free';
    await page.click('[data-action="opt-unlock-all"]'); await sleep(60);
    if ((await ev(() => OPT.lockW.size + OPT.lockG.size)) !== 0) return 'unlock all';
    await ev(() => { loadGraph(entangledTemplateJSON('maurerFig2')); renderAll(); }); await sleep(60);
    if (!/multigrain optimises one graph, not an entangled graph/.test(await txt())) return 'entangled note';
    await page.click('#tabbtn-matrix'); await sleep(60);
    if (await page.locator('#mx-locks').count()) return 'locks offered for an entangled graph';
    await ev(() => { loadGraph(templateJSON('parallel')); OPT.existingOnly = false; OPT.showLocks = false; OPT.freeRows.clear(); renderAll(); });
  });

  await step('Optimise tab, R script: options, copy, the script text follows the inputs, the gain and the locks; refused without a gain or with a constraint problem', async () => {
    await ev(() => { loadGraph(templateJSON('parallel')); OPT.lockW.clear(); OPT.lockG.clear(); OPT.existingOnly = false; OPT.freeRows.clear(); OPT.source = 'quick'; OPT.quick = 'any'; OPT.text = ''; SIM.success = { ids: [], rule: 'any' }; SIM.rho = '0.5'; SIM.useMatrix = false; OPT.script = { nsim: 100000, global: true, threads: 1, start: true, file: 'optimised-graph.json' }; renderAll(); });
    await page.click('#tabbtn-optimise'); await sleep(100);
    const txt = () => page.locator('#tab-optimise').innerText();
    if (!/Give a gain function first/.test(await txt()) || (await page.locator('#optScript').count())) return 'script offered without a gain';
    await ev(() => { OPT.source = 'own'; OPT.text = 'r1*r2 || r3*r4'; renderOptimisePanel(); }); await sleep(60);
    let sc = await page.locator('#optScript').innerText();
    for (const t of ['library(multigrain)', 'set.seed(2009)', 'power_nominal <- c(0.8, 0.8, 0.8, 0.8)', 'nsim <- 100000', 'trial_success("((r1 * r2) || (r3 * r4))")', 'graph_constraint_free(4, names = hyp_names)', 'start_graph <- list(', 'hyp_weight = c(0.5, 0.5, 0, 0)', 'start_graph = list(start_graph)', 'global_search = TRUE', 'num_threads = 1L', 'inputs = list(power_nominal = power_nominal, corr_matrix = corr_matrix, nsim = nsim)', 'start = start_graph,', 'file = "optimised-graph.json"', 'sketchpad_json <- function']) if (!sc.includes(t)) return 'script missing: ' + t;
    await page.selectOption('#opt-snsim', '1000000'); await page.fill('#opt-threads', '4'); await page.locator('#opt-threads').dispatchEvent('change'); await page.uncheck('#opt-global'); await sleep(60); await page.uncheck('#opt-start'); await sleep(60); await page.fill('#opt-file', 'my/graph.json'); await page.locator('#opt-file').dispatchEvent('change'); await sleep(100);
    sc = await page.locator('#optScript').innerText();
    for (const t of ['nsim <- 1000000', 'num_threads = 4L', 'global_search = FALSE', 'file = "mygraph.json"']) if (!sc.includes(t)) return 'option not applied: ' + t;
    if (sc.includes('start_graph')) return 'start graph still written';
    await page.fill('#tab-optimise #opt-sp-' + (await ev(() => G.nodes[0].id)), '90'); await page.locator('#tab-optimise [data-pw]').first().dispatchEvent('change'); await sleep(100);
    if (!(await page.locator('#optScript').innerText()).includes('power_nominal <- c(0.9, 0.8, 0.8, 0.8)')) return 'power not applied';
    await ev(() => { const ids = G.nodes.map(n => n.id); OPT.lockW.add(ids[0]); for (const j of [1, 2, 3]) OPT.lockG.add(gKey(ids[0], ids[j])); renderAll(); }); await sleep(60);
    sc = await page.locator('#optScript').innerText();
    if (!sc.includes('hyp_constraint = c(0.5, NA, NA, NA)') || !/trans_constraint = matrix\(c\(\n\s+0, 0, 0\.5, 0\.5,\n\s+NA, 0, NA, NA,/.test(sc)) return 'constraint not written: ' + sc.slice(sc.indexOf('gc <-'), sc.indexOf('gc <-') + 200);
    await ev(() => { const ids = G.nodes.map(n => n.id); OPT.lockW.add(ids[1]); renderAll(); }); await sleep(60);
    if ((await page.locator('#optScript').count()) || !/Fix the fixed and free parts first/.test(await txt())) return 'script offered with a constraint problem';
    await ev(() => { OPT.lockW.clear(); OPT.lockG.clear(); renderAll(); }); await sleep(60);
    await page.click('[data-action="opt-copy-script"]'); await sleep(100);
    const bt = await page.locator('[data-action="opt-copy-script"]').innerText(); if (!/Copied|Selected/.test(bt)) return 'copy button: ' + bt;
    await ev(() => { OPT.source = 'quick'; OPT.text = ''; OPT.script = { nsim: 100000, global: true, threads: 1, start: true, file: 'optimised-graph.json' }; SIM.power = {}; renderAll(); });
  });

  await step('Optimise tab, result from multigrain: opening a file with the optimisation block shows the note, takes over the gain and inputs, estimates afresh, keeps the starting graph once in Compare, shows 0.001 as ε with the number on hover', async () => {
    const json = { format: 'multiplicity-graph', version: 1, source: 'multigrain 1.0.0', alpha: 0.025,
      hypotheses: [{ name: 'H1', weight: 0.5, label: 'Dose 1, primary', group: 'primary' }, { name: 'H2', weight: 0.3782 }, { name: 'H3', weight: 0.1218 }, { name: 'H4', weight: 0 }],
      transitions: [[0, 0, 0.5, 0.5], [0.547, 0, 0.452, 0.001], [0, 0, 0, 1], [0.4578, 0.5422, 0, 0]],
      optimisation: { package: 'multigrain 1.0.0', gain: '((r1 * r2) || (r3 * r4))', expected_gain: 0.693, local_power: [0.748, 0.72, 0.697, 0.65], expected_rejections: 2.81, disjunctive_power: 0.869, conjunctive_power: 0.531, opt_source: 'local', graph_valid: { local: true, global: null }, global_search: false,
        inputs: { power_nominal: [0.8, 0.8, 0.8, 0.8], corr_matrix: [[1, 0.5, 0.5, 0.5], [0.5, 1, 0.5, 0.5], [0.5, 0.5, 1, 0.5], [0.5, 0.5, 0.5, 1]], nsim: 1000000 },
        start: { weights: [0.5, 0.5, 0, 0], transitions: [[0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0, 0, 0, 1], [0, 0, 1, 0]] } } };
    await ev(() => { KEPT = []; saveKept(); OPT.imported = null; OPT.result = null; SIM.n = 2000; loadGraph(templateJSON('holm')); renderAll(); setTab('export'); showExport('load'); });
    for (let k = 0; k < 2; k++) { await ev(() => { setTab('export'); showExport('load'); }); await page.fill('#loadText', JSON.stringify(json)); await page.click('[data-action="load-text"]'); await page.waitForFunction(() => OPT.result && !OPT.running, null, { timeout: 30000 }); await sleep(100); }
    if ((await ev(() => activeTab)) !== 'optimise') return 'did not open the Optimise tab';
    if ((await ev(() => [OPT.source, OPT.text, SIM.rho, SIM.useMatrix, G.nodes.map(n => SIM.power[n.id]).join()].join('|'))) !== 'own|((r1 * r2) || (r3 * r4))|0.5|false|80,80,80,80') return 'gain or inputs not taken over: ' + await ev(() => [OPT.source, OPT.text, SIM.rho, SIM.useMatrix, G.nodes.map(n => SIM.power[n.id]).join()].join('|'));
    const t = await page.locator('#tab-optimise').innerText();
    if (!/Optimised with multigrain 1\.0\.0/.test(t) || !/multigrain 0\.693 on its own sample \(1,000,000 trials\)/.test(t) || !/Fresh sample here: 0\.\d{3} ± 0\.\d{3} \(2,000 trials/.test(t) || !/Difference [+-]0\.\d{3}: within simulation error/.test(t)) return 'note text: ' + t.slice(0, 600);
    if (!/H1 74\.8%, H2 72\.0%, H3 69\.7%, H4 65\.0%; any 86\.9%, all 53\.1%, expected number 2\.81/.test(t) || !/from the local search \(global search off\); valid graph: local yes, global not run/.test(t)) return 'powers or solution line';
    if ((await ev(() => KEPT.length)) !== 1 || (await ev(() => KEPT[0].name)) !== 'Starting graph (multigrain)' || (await ev(() => CMP.with)) !== 'kept:0') return 'starting graph not kept once: ' + await ev(() => KEPT.map(k => k.name).join());
    const eps = await ev(() => G.edges.filter(e => e.expr === 'ε').map(e => nodeById(e.from).label + '>' + nodeById(e.to).label + '=' + fmt(e.g)).join());
    if (eps !== 'H2>H4=0.001') return 'ε edge: ' + eps;
    if ((await ev(() => { const x = document.querySelector('.elabel title'); return x ? x.textContent : ''; })) !== 'ε = 0.001') return 'hover title';
    await page.click('[data-action="opt-compare-start"]'); await sleep(150);
    if ((await ev(() => activeTab)) !== 'compare' || !/Starting graph \(multigrain\)/.test(await page.locator('#tab-compare').innerText())) return 'compare with the starting graph';
    await page.click('#tabbtn-optimise'); await ev(() => { nodeById(G.nodes[1].id).w = Q.parse('1/3'); renderAll(); }); await sleep(80);
    if (!/has changed since it was opened/.test(await page.locator('#tab-optimise').innerText())) return 'changed note';
    await ev(() => { undo(); });
    await page.click('[data-action="opt-dismiss"]'); await sleep(60);
    if (/Optimised with multigrain/.test(await page.locator('#tab-optimise').innerText())) return 'dismiss';
    await ev(() => { OPT.imported = { sig: simSig(), when: '', keptIndex: -1, package: 'multigrain 1.0.0', gain: G.opt.gain }; });
    await page.click('#tabbtn-export'); await page.click('[data-export="sap"]'); await sleep(120);
    if ((await page.locator('#tab-export [data-optshare]').count()) !== 1) return 'sharing switch missing in the SAP view';
    let st = await page.locator('#sapText').innerText();
    if (!/Choice of the graph\. The initial weights and transition weights were chosen by gain-function optimisation/.test(st) || /ψ\(r\)/.test(st)) return 'SAP text with sharing off: ' + (st.match(/Choice of the graph\.[^\n]{0,120}/) || 'no paragraph');
    await page.check('#tab-export [data-optshare]'); await sleep(120);
    st = await page.locator('#sapText').innerText(); if (!/ψ\(r\) = \(\(r1 \* r2\) \|\| \(r3 \* r4\)\)/.test(st)) return 'SAP text with sharing on';
    await page.click('[data-export="json"]'); await sleep(100);
    if (!(await page.locator('#tab-export [data-optshare]').isChecked()) || !JSON.parse(await page.locator('#exportCode').innerText()).optimisation) return 'JSON with sharing on';
    await page.uncheck('#tab-export [data-optshare]'); await sleep(120);
    if (JSON.parse(await page.locator('#exportCode').innerText()).optimisation) return 'JSON with sharing off';
    await page.click('[data-export="link"]'); await sleep(100);
    if ((await page.locator('#exportCode').innerText()).includes('r1')) return 'link with sharing off';
    await page.click('#tabbtn-optimise'); await sleep(60);
    if ((await page.locator('#tab-optimise [data-optshare]').count()) !== 1) return 'switch missing in the Optimise note';
    await page.evaluate(() => { OPT.imported = null; });
    await ev(() => { KEPT = []; saveKept(); CMP.with = ''; OPT.source = 'quick'; OPT.text = ''; OPT.result = null; SIM.power = {}; SIM.n = 10000; loadGraph(templateJSON('parallel')); renderAll(); });
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
    const notch = await ev(() => { const sv = document.querySelector('.canvas-wrap svg'); const r = sv.getBoundingClientRect(); const z = init => { view.k = 1; applyView(); sv.dispatchEvent(new WheelEvent('wheel', Object.assign({ clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true }, init))); return view.k; }; return [z({ deltaY: -100, deltaMode: 0 }), z({ deltaY: -3, deltaMode: 1 })]; });
    if (Math.abs(notch[0] - notch[1]) > 0.02 || notch[1] < 1.1) return 'wheel in line mode (Firefox): ' + notch.map(x => x.toFixed(3)).join(' vs ');
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
    const st = await page.locator('#modalBody p').first().innerText(); const mm = /(\d+) of (\d+) checks passed/.exec(st); if (!mm || mm[1] !== mm[2] || +mm[2] < 110) return 'self-test: ' + st;
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

  await step('Settings persist across reload (decimals, theme, plain); both Plain language boxes agree; a stored mgs-adv is ignored', async () => {
    await page.click('#moreMenu summary'); await page.check('#decToggle'); await page.selectOption('#skinSelect', 'white'); await page.keyboard.press('Escape');
    await page.check('#plainToggle'); await sleep(100);
    if (!(await ev(() => $('plainMenuToggle').checked && document.body.classList.contains('clinician')))) return 'menu box or body class not in step with the switch';
    await ev(() => store.set('mgs-adv', '0')); /* a 1.3.0 browser with Advanced features off */
    await page.reload(); await sleep(600);
    if (!(await ev(() => numMode === 'dec' && plain && document.documentElement.dataset.skin === 'white' && $('plainToggle').checked && $('plainMenuToggle').checked))) return 'settings lost: ' + await ev(() => [numMode, plain, document.documentElement.dataset.skin].join());
    await page.click('#moreMenu summary'); await page.uncheck('#decToggle'); await page.selectOption('#skinSelect', 'auto'); await page.keyboard.press('Escape');
    await page.uncheck('#plainToggle'); await sleep(100);
    if (await ev(() => document.body.classList.contains('clinician') || $('plainMenuToggle').checked)) return 'menu box or body class still on after unticking';
    if (!(await page.locator('#tabbtn-matrix').isVisible())) return 'the stored mgs-adv = 0 still hides the Matrix tab';
    await ev(() => { localStorage.removeItem('mgs-adv'); });
  });

  await step('Plain-language mode reads sensibly in design and test', async () => {
    await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
    await page.click('#tabbtn-test'); { const inputs = page.locator('[data-p]'); const ps = ['0.004', '0.009', '0.011', '0.03']; for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(ps[i]); await inputs.nth(i).press('Tab'); } } await page.check('#plainToggle'); await sleep(100);
    const t = await page.locator('#tab-test .plain').innerText();
    if (!/The trial asks 4 questions/.test(t) || !/at least one/.test(t)) return 'plain design text: ' + t.slice(0, 200);
    await page.click('[data-action="run"]'); await page.waitForFunction(() => T && T.done && !T.running, null, { timeout: 15000 }); await sleep(200);
    const t2 = await page.locator('#tab-test .plain').innerText();
    if (!/Result:/.test(t2) || !/claimed as successes/.test(t2)) return 'plain result: ' + t2.slice(-300);
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

  await step('Closed-test warnings in the Test tab: not alpha-exhaustive (with and without upscale), two-sided p-values; none for Bonferroni or an exhaustive graph', async () => {
    if ((await ev(() => mode)) === 'test') { await page.click('[data-action="exit-test"]'); await sleep(100); }
    const saved = await ev(() => ({ g: JSON.stringify(serializeGraph(G)), sided: G.sided, pl: plain }));
    const warns = async () => { await page.click('#tabbtn-test'); await sleep(120); return (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | '); };
    await ev(() => { setPlain(false, true); loadGraph(templateJSON('parallel')); G.test.type = 'simes'; G.test.upscale = false; renderAll(); });
    let w = await warns(); if (!/not α-exhaustive/.test(w) || /Upscaling/.test(w) || /Two-sided/.test(w)) return 'parallel simes: ' + w;
    await ev(() => { G.test.upscale = true; renderAll(); });
    w = await warns(); if (!/Upscaling the weights also changes/.test(w)) return 'upscale: ' + w;
    await ev(() => { G.test.upscale = false; renderAll(); });
    await page.selectOption('#sidedSelect', 'two'); await sleep(150);
    w = await warns(); if (!/one-sided rate of α\/2/.test(w)) return 'two-sided: ' + w;
    await ev(() => { G.test.type = 'bonferroni'; renderAll(); });
    w = await warns(); if (w) return 'Bonferroni should have no closed-test warning: ' + w;
    await page.selectOption('#sidedSelect', 'one'); await sleep(150);
    await ev(() => { loadGraph(templateJSON('improvedParallel')); G.test.type = 'simes'; renderAll(); });
    w = await warns(); if (w) return 'exhaustive one-sided graph should have no warning: ' + w;
    await ev(s => { loadGraph(JSON.parse(s.g)); G.sided = s.sided; setPlain(s.pl, true); renderAll(); }, saved);
    await page.selectOption('#sidedSelect', saved.sided === 'two' ? 'two' : 'one'); await sleep(100);
  });

  await step('Correlation checks: impossible block named in the Test tab and live in the Power tab; Simes warning for negative correlations (Simes within groups: same group only)', async () => {
    if ((await ev(() => mode)) === 'test') { await page.click('[data-action="exit-test"]'); await sleep(100); }
    const saved = await ev(() => ({ g: JSON.stringify(serializeGraph(G)), sided: G.sided, pl: plain, sim: JSON.stringify({ rho: SIM.rho, useMatrix: SIM.useMatrix, corr: SIM.corr }) }));
    const K = await ev(() => { setPlain(false, true); loadGraph(templateJSON('parallel')); const id = G.nodes.map(n => n.id), k = (i, j) => pairKey(id[i], id[j]); G.sided = 'one'; G.test.type = 'parametric'; G.test.corr = { [k(0, 1)]: 0.9, [k(0, 2)]: 0.9, [k(1, 2)]: -0.9 }; SIM.rho = '0.5'; SIM.useMatrix = false; SIM.corr = {}; setTab('test'); renderAll(); return { k01: k(0, 1), k02: k(0, 2), k12: k(1, 2) }; });
    await openDet('det-testtype');
    let t = await page.locator('#det-testtype').innerText(); if (!/between H1, H2 and H3 cannot all hold/.test(t)) return 'Test tab block message: ' + t.slice(0, 400);
    await ev(k => { G.test.corr = { [k]: 1 }; renderAll(); }, K.k01);
    t = await page.locator('#det-testtype').innerText(); if (!/between H1 and H2 must lie strictly between/.test(t)) return 'Test tab pair message: ' + t.slice(0, 400);
    await ev(() => { G.test.corr = {}; G.test.type = 'simes'; renderAll(); });
    await page.click('#tabbtn-power'); await sleep(100);
    if (await page.locator('#simCorrMsg').count()) return 'message shown for valid correlations';
    await openDet('det-corr'); await page.check('#sim-usematrix'); await sleep(100);
    const fill = async (sel, v) => { const c = page.locator(sel); await c.fill(v); await c.press('Tab'); await sleep(120); };
    await fill(`#tab-power [data-corr="${K.k01}"]`, '0.9'); await fill(`#tab-power [data-corr="${K.k02}"]`, '0.9'); await fill(`#tab-power [data-corr="${K.k12}"]`, '-0.9');
    let msg = await page.locator('#simCorrMsg').count() ? await page.locator('#simCorrMsg').innerText() : '';
    if (!/between H1, H2 and H3 cannot all hold/.test(msg)) return 'Power tab live message: ' + msg;
    await page.click('#tabbtn-test'); await sleep(150);
    let w = (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | ');
    if (!/H2 and H3, −0\.9 \(Power tab\)/.test(w) || !/Samuel-Cahn/.test(w)) return 'Simes warning (matrix): ' + w;
    await ev(() => { G.test.type = 'simes-groups'; G.nodes.forEach((n, i) => { n.group = i < 2 ? 'primary' : 'secondary'; }); renderAll(); });
    w = (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | ');
    if (/Negative correlation/.test(w)) return 'Simes within groups should ignore pairs across groups: ' + w;
    await page.click('#tabbtn-power'); await sleep(100);
    await fill(`#tab-power [data-corr="${K.k12}"]`, '0.5'); await fill(`#tab-power [data-corr="${K.k02}"]`, '0.2'); await fill(`#tab-power [data-corr="${K.k01}"]`, '-0.3');
    if (await page.locator('#simCorrMsg').count()) return 'message left after fixing';
    await page.click('#tabbtn-test'); await sleep(150);
    w = (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | ');
    if (!/H1 and H2, −0\.3/.test(w)) return 'Simes within groups, same group: ' + w;
    await ev(() => { G.test.type = 'simes'; SIM.useMatrix = false; SIM.rho = '-0.2'; renderAll(); });
    w = (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | ');
    if (!/−0\.2 for every pair/.test(w)) return 'Simes warning (single value): ' + w;
    await ev(() => { G.test.type = 'bonferroni'; renderAll(); });
    w = (await page.locator('#tab-test [data-warn="closed"]').allInnerTexts()).join(' | '); if (w) return 'Bonferroni warned: ' + w;
    await ev(s => { const o = JSON.parse(s.sim); SIM.rho = o.rho; SIM.useMatrix = o.useMatrix; SIM.corr = o.corr; loadGraph(JSON.parse(s.g)); G.sided = s.sided; setPlain(s.pl, true); renderAll(); }, saved);
  });

  await step('Singular correlations (1.4.0): full population, subgroup and complement (sqrt(1/2), sqrt(1/2), 0) accepted with a note in the Test and Power tabs; exact global adjusted p 0.04718 (Thomas et al., 2020) with no Monte Carlo error; the simulation runs', async () => {
    if ((await ev(() => mode)) === 'test') { await page.click('[data-action="exit-test"]'); await sleep(100); }
    const saved = await ev(() => ({ g: JSON.stringify(serializeGraph(G)), sided: G.sided, alpha: G.alpha, pl: plain, sim: JSON.stringify({ rho: SIM.rho, useMatrix: SIM.useMatrix, corr: SIM.corr }) }));
    await ev(() => { setPlain(false, true); loadGraph(generatedTemplate('holm', 3)); G.alpha = 0.05; G.sided = 'one'; const id = G.nodes.map(n => n.id), k = (i, j) => pairKey(id[i], id[j]); const h = '0.707107'; G.test.type = 'parametric'; G.test.corr = { [k(0, 1)]: +h, [k(0, 2)]: +h, [k(1, 2)]: 0 }; G.nodes.forEach((n, i) => { n.p = ['0.02', '0.03', '0.4'][i]; }); SIM.useMatrix = true; SIM.corr = { [k(0, 1)]: h, [k(0, 2)]: h, [k(1, 2)]: '0' }; setTab('test'); renderAll(); });
    await openDet('det-testtype');
    let t = await page.locator('#det-testtype').innerText();
    if (/cannot all hold|not positive/.test(t) || !/That is allowed/.test(t)) return 'Test tab note: ' + t.slice(0, 500);
    await page.click('[data-action="run"]');
    await page.waitForFunction(() => CT && CT.type === 'parametric', null, { timeout: 20000 }); await sleep(200);
    const r = await ev(() => ({ adj: CT.adj, se: CT.se, rej: CT.rejected }));
    if (Math.abs(r.adj[0] - 0.047180) > 2e-5 || r.se != null) return 'closed test: ' + JSON.stringify(r);
    await openDet('det-adj');
    t = await page.locator('#det-adj').innerText();
    if (!/exact numerical integration/.test(t) || /largest Monte Carlo standard error/.test(t)) return 'adjusted p text: ' + t.slice(0, 400);
    await page.click('[data-action="exit-test"]'); await sleep(100);
    await page.click('#tabbtn-power'); await sleep(150);
    if (await page.locator('#simCorrMsg').count()) return 'Power tab refused: ' + await page.locator('#simCorrMsg').innerText();
    if (!/That is allowed/.test(await page.locator('#tab-power').innerText())) return 'Power tab note missing';
    await page.click('[data-action="sim-run"]'); await page.waitForFunction(() => (SIM.result && !SIM.running) || SIM.error, null, { timeout: 30000 }); await sleep(100);
    const e = await ev(() => SIM.error); if (e) return 'simulation error: ' + e;
    await ev(s => { const o = JSON.parse(s.sim); SIM.rho = o.rho; SIM.useMatrix = o.useMatrix; SIM.corr = o.corr; loadGraph(JSON.parse(s.g)); G.sided = s.sided; G.alpha = s.alpha; setPlain(s.pl, true); setTab('graph'); renderAll(); }, saved);
  });

  await step('Phone-width layout: no horizontal overflow, tabs and toolbar usable at 390px; the hint box does not cover the graph; a zoomed view is kept on resize', async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await sleep(400);
    const over = await ev(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) return 'horizontal overflow ' + over + 'px';
    await page.click('#tabbtn-test'); await sleep(100); if (await page.locator('#tab-test').isHidden()) return 'tab hidden';
    const offs = await ev(() => [...document.querySelectorAll('.topbar .btn, .topbar select, .topbar input')].filter(e => e.offsetParent !== null && !e.closest('.menu-pop')).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 1 || r.left < -1); }).map(e => e.id || e.className));
    if (offs.length) return 'toolbar items off screen: ' + offs.join(',');
    await page.click('#tabbtn-graph');
    /* the hint box must not cover the graph: after a width change (view not moved), after loading, and in test mode */
    const saved = await ev(() => JSON.stringify(serializeGraph(G)));
    const overlap = () => ev(() => { const c = document.getElementById('hintChip'); if (c.hidden) return -999; const cb = c.getBoundingClientRect().bottom; return Math.max(...[...document.querySelectorAll('#canvas .node-body')].map(e => cb - e.getBoundingClientRect().top)); });
    await page.setViewportSize({ width: 1400, height: 900 }); await sleep(200);
    await ev(() => { loadGraph(templateJSON('bretz2011')); fitView(); }); await sleep(100);
    await page.setViewportSize({ width: 390, height: 800 }); await sleep(400);
    let o = await overlap(); if (o > 0) return 'after narrowing, the hint covers a hypothesis by ' + Math.round(o) + 'px';
    await ev(() => loadGraph(templateJSON('parallel'))); await sleep(200);
    o = await overlap(); if (o > 0) return 'after loading, the hint covers a hypothesis by ' + Math.round(o) + 'px';
    await ev(() => setMode('test')); await sleep(300);
    o = await overlap(); if (o > 0) return 'in test mode, the hint covers a hypothesis by ' + Math.round(o) + 'px';
    await ev(() => setMode('design')); await sleep(200);
    /* a view the user has zoomed is kept when the window changes width */
    await page.click('#zoomIn'); await sleep(100);
    const k1 = await ev(() => view.k);
    await page.setViewportSize({ width: 1400, height: 900 }); await sleep(300);
    if (Math.abs((await ev(() => view.k)) - k1) > 1e-9) return 'zoomed view was refitted on resize';
    await ev(s => { loadGraph(JSON.parse(s)); }, saved); await sleep(100);
  });

  await step('Entangled graphs (design): template from the picker, component bar switches the component, c edited in the panel, add and remove a component, undo, make entangled and reduce, simple mode hides the editing buttons', async () => {
    await page.evaluate(() => { setMode('design', true); setPlain(false, true); setTab('graph'); });
    await page.selectOption('#templateSelect', 'ent:maurerFig2'); await sleep(250);
    let r = await ev(() => ({ ent: isEntangled(G), hidden: $('compBar').hidden, w: G.nodes.map(n => Q.exact(n.w)).join(), bar: $('compBar').innerText.replace(/\s+/g, ' ') }));
    if (!r.ent || r.hidden || r.w !== '1,0,0,0,0' || !/Graph 1.*Graph 2.*\+ Graph.*Remove Graph 1/.test(r.bar)) return 'template: ' + JSON.stringify(r);
    await page.click('#compBar [data-comp="1"]'); await sleep(150);
    r = await ev(() => ({ a: G.ent.active, w: G.nodes.map(n => Q.exact(n.w)).join(), e: G.edges.map(e => nodeById(e.from).label + '>' + nodeById(e.to).label + '=' + (e.expr || Q.exact(e.g))).sort().join(' '), panel: $('tab-graph').innerText }));
    if (r.a !== 1 || r.w !== '0,1,0,0,0' || r.e !== 'H1>H3=1 H2>H3=1 H3>H4=ε H3>H5=1-ε H5>H1=1' || !/Weight in Graph 2/.test(r.panel)) return 'switch: ' + JSON.stringify(r);
    await page.evaluate(() => { $('det-ent').open = true; });
    await page.fill('#cw-1', '1/4'); await page.press('#cw-1', 'Tab'); await sleep(120);
    r = await ev(() => ({ c: G.ent.c.map(Q.exact).join(), st: $('statusBar').innerText }));
    if (r.c !== '1/2,1/4' || !/add up to 3\/4/.test(r.st)) return 'c edit: ' + JSON.stringify(r);
    await page.click('#compBar [data-action="comp-add"]'); await sleep(120);
    r = await ev(() => ({ n: G.ent.comps.length, a: G.ent.active, c: G.ent.c.map(Q.exact).join(), w: G.nodes.map(n => Q.exact(n.w)).join() }));
    if (r.n !== 3 || r.a !== 2 || r.c !== '1/2,1/4,0' || r.w !== '0,1,0,0,0') return 'add: ' + JSON.stringify(r);
    await page.click('#compBar [data-action="comp-remove"]'); await sleep(120);
    r = await ev(() => ({ n: G.ent.comps.length, a: G.ent.active }));
    if (r.n !== 2 || r.a !== 1) return 'remove: ' + JSON.stringify(r);
    await page.click('#undoBtn'); await sleep(80); await page.click('#undoBtn'); await sleep(80); await page.click('#undoBtn'); await sleep(120);
    r = await ev(() => ({ n: G.ent.comps.length, c: G.ent.c.map(Q.exact).join() }));
    if (r.n !== 2 || r.c !== '1/2,1/2') return 'undo: ' + JSON.stringify(r);
    /* All view: every component overlaid with its own line style, weight vectors at the nodes, read only */
    await page.click('#compBar [data-comp="all"]'); await sleep(200);
    r = await ev(() => ({ all: allView, edges: document.querySelectorAll('#canvas .edge').length, c1: document.querySelectorAll('#canvas .edge.comp-1').length, hit: document.querySelectorAll('#canvas [data-edge]').length, wt: [...document.querySelectorAll('#canvas .nweight')].map(t => t.textContent).join('|'), key: /Graph 1.*Graph 2.*Read only/.test($('compBar').innerText.replace(/\s+/g, ' ')) }));
    if (!r.all || r.edges !== 10 || r.c1 !== 5 || r.hit !== 0 || r.wt !== '(1, 0)|(0, 1)|(0, 0)|(0, 0)|(0, 0)' || !r.key) return 'all view: ' + JSON.stringify(r);
    await page.click('[data-node]'); await sleep(150);
    r = await ev(() => ({ panel: $('tab-graph').innerText.replace(/\s+/g, ' '), inputs: document.querySelectorAll('#tab-graph input').length }));
    if (!/All components shown/.test(r.panel) || !/Graph 1 1 H3 \(1\) Graph 2 0 H3 \(1\)/.test(r.panel) || r.inputs !== 1) return 'all node panel: ' + JSON.stringify(r);
    await page.click('#compBar [data-comp="0"]'); await sleep(150);
    r = await ev(() => ({ all: allView, a: G.ent.active, edges: document.querySelectorAll('#canvas .edge').length, hit: document.querySelectorAll('#canvas [data-edge]').length }));
    if (r.all || r.a !== 0 || r.edges !== 5 || r.hit !== 5) return 'back to graph 1: ' + JSON.stringify(r);
    /* the procedure on the paper's p-values: all five rejected, H1 first (section 4, p. 1747); the All view follows the test */
    await page.evaluate(() => { const p = [0.01, 0.022, 0.005, 0.012, 0.001]; G.nodes.forEach((n, i) => { n.p = String(p[i]); }); setMode('test'); });
    /* Test mode opens on the All view (plan decision 9); the flow animation runs along the component edges */
    await sleep(150);
    r = await ev(() => ({ all: allView, pressed: $('compBar').querySelector('[data-comp="all"]').getAttribute('aria-pressed') }));
    if (!r.all || r.pressed !== 'true') return 'test should open on All: ' + JSON.stringify(r);
    const stepP = page.evaluate(() => stepOnce(false)); await sleep(250);
    r = await ev(() => ({ dots: document.querySelectorAll('#overlay .flow-dot').length, txt: [...document.querySelectorAll('#overlay .flow-text')].map(t => t.textContent).join('|') }));
    if (r.dots !== 1 || r.txt !== '+1/2') return 'flow animation: ' + JSON.stringify(r);
    await stepP; await page.evaluate(() => stepOnce(true)); await sleep(700);
    r = await ev(() => ({ order: T.order.map(id => nodeById(id).label).join(','), wt: [...document.querySelectorAll('#canvas .nweight')].map(t => t.textContent).join('|') }));
    if (r.order !== 'H1,H3' || r.wt !== '(1, 0)|(0, 1)|(1, 0)|(0.999, 0)|(0.001, 0)') return 'test all view (Fig. 3(c)): ' + JSON.stringify(r);
    await page.evaluate(() => runAllSteps()); await sleep(2600);
    r = await ev(() => ({ order: T.order.map(id => nodeById(id).label).join(','), done: T.done, log: T.log.filter(l => !l.stop).map(l => l.gave).join(' / '), orderTxt: ($('det-order') || { innerText: '' }).innerText.replace(/\s+/g, ' ') }));
    if (r.order !== 'H1,H3,H4,H2,H5') return 'test: ' + JSON.stringify(r);
    /* the step log gives the amounts passed on by component (Maurer and Bretz, 2013, Fig. 3): H2's level goes to H5 from both graphs */
    if (!/\+1\/2 to H3 \(Graph 1\)/.test(r.log) || !/\+0\.999 to H5 \(Graph 1 \+0\.4995, Graph 2 \+0\.4995\)/.test(r.log)) return 'step log: ' + r.log;
    if (!/with the same result/.test(r.orderTxt)) return 'order table: ' + r.orderTxt.slice(0, 160);
    await page.click('#compBar [data-comp="0"]'); await sleep(100);
    r = await ev(() => ({ all: allView, edges: document.querySelectorAll('#canvas .edge').length }));
    if (r.all || r.edges !== 0) return 'test, graph 1 after all rejected: ' + JSON.stringify(r);
    /* plain language describes every component; Design returns to the component view */
    await page.evaluate(() => { plain = true; renderAll(); }); await sleep(100);
    r = await ev(() => $('tab-test').innerText.replace(/\s+/g, ' '));
    if (!/split between 2 linked graphs/.test(r) || !/Graph 2: at the start, H2 holds 1\.25%/.test(r)) return 'plain text: ' + r.slice(0, 200);
    await page.evaluate(() => { plain = false; });
    await page.evaluate(() => { setMode('design', true); setTab('graph'); }); await sleep(50);
    r = await ev(() => ({ all: allView, a: G.ent.active }));
    if (r.all || r.a !== 0) return 'design after test: ' + JSON.stringify(r);
    await page.evaluate(() => { loadGraph(templateJSON('bretz')); $('det-ent').open = true; }); await sleep(120);
    await page.click('#tab-graph [data-action="make-ent"]'); await sleep(120);
    r = await ev(() => ({ ent: isEntangled(G), n: G.ent.comps.length, c: G.ent.c.map(Q.exact).join(), col: !!entCollapse(G), build: !!document.getElementById('det-build') }));
    if (!r.ent || r.n !== 2 || r.c !== '1/2,1/2' || !r.col || r.build) return 'make: ' + JSON.stringify(r);
    await page.evaluate(() => { $('det-ent').open = true; }); await page.click('#tab-graph [data-action="comp-collapse"]'); await sleep(120);
    r = await ev(() => ({ ent: isEntangled(G), w: G.nodes.map(n => Q.exact(n.w)).join(), hidden: $('compBar').hidden }));
    if (r.ent || r.w !== '1/2,1/2,0,0' || !r.hidden) return 'reduce: ' + JSON.stringify(r);
    await page.evaluate(() => { loadGraph(entangledTemplateJSON('maurerFig4')); setPlain(true); }); await sleep(120);
    r = await ev(() => ({ hidden: $('compBar').hidden, add: !!document.querySelector('#compBar [data-action="comp-add"]'), opt: !!document.querySelector('#templateSelect option[value="ent:maurerFig4"]'), ro: $('cw-0') ? $('cw-0').readOnly : null }));
    if (r.hidden || r.add || !r.opt || r.ro !== true) return 'simple: ' + JSON.stringify(r);
    /* Matrix view: c row, then w and G per component; a hidden component is editable there too; test mode shows each component's current state */
    await page.evaluate(() => { setPlain(false, true); loadGraph(entangledTemplateJSON('maurerFig2')); setTab('matrix'); }); await sleep(150);
    r = await ev(() => ({ mc: document.querySelectorAll('[data-mc]').length, mw: document.querySelectorAll('[data-mwk]').length, mg: document.querySelectorAll('[data-mgk]').length, txt: $('mx-dyn').innerText.replace(/\s+/g, ' ') }));
    if (r.mc !== 2 || r.mw !== 10 || r.mg !== 40 || !/COMPONENT WEIGHTS C/i.test(r.txt) || !/GRAPH 2/i.test(r.txt)) return 'matrix: ' + JSON.stringify(r);
    const ids = await ev(() => G.nodes.map(n => n.id));
    await page.fill('#mw-1-' + ids[1], '1/2'); await page.press('#mw-1-' + ids[1], 'Tab'); await sleep(120);
    await page.fill('#mg-1-' + ids[4] + '-' + ids[0], '1/2'); await page.press('#mg-1-' + ids[4] + '-' + ids[0], 'Tab'); await sleep(120);
    await page.fill('#mc-0', '1/3'); await page.press('#mc-0', 'Tab'); await sleep(120);
    r = await ev(() => { const v = entViewGraph(G, 1); return { w2: Q.exact(v.nodes[1].w), g51: Q.exact(v.edges.find(e => e.from === G.nodes[4].id && e.to === G.nodes[0].id).g), live: Q.exact(G.nodes[1].w), c: G.ent.c.map(Q.exact).join(), st: $('statusBar').innerText.replace(/\s+/g, ' ') }; });
    if (r.w2 !== '1/2' || r.g51 !== '1/2' || r.live !== '0' || r.c !== '1/3,1/2' || !/Graph 2: Initial weights add up to 1\/2/.test(r.st)) return 'matrix edits: ' + JSON.stringify(r);
    await page.click('#undoBtn'); await page.click('#undoBtn'); await page.click('#undoBtn'); await sleep(120);
    r = await ev(() => ({ c: G.ent.c.map(Q.exact).join(), w2: Q.exact(entViewGraph(G, 1).nodes[1].w) }));
    if (r.c !== '1/2,1/2' || r.w2 !== '1') return 'matrix undo: ' + JSON.stringify(r);
    await page.evaluate(() => { const p = [0.01, 0.022, 0.005, 0.012, 0.001]; G.nodes.forEach((n, i) => { n.p = String(p[i]); }); setMode('test'); setTab('matrix'); }); await sleep(150);
    await page.evaluate(() => stepOnce(true)); await sleep(500); await page.evaluate(() => stepOnce(true)); await sleep(500);
    r = await ev(() => $('mx-dyn').innerText.replace(/\s+/g, ' '));
    if (!/After 2 rejections/.test(r) || !/w – 0 – 0\.999 0\.001 1/.test(r)) return 'matrix in test: ' + r.slice(0, 300);
    await page.evaluate(() => { setMode('design', true); setTab('matrix'); });
    /* gMCP code import: the source of Entangled1Maurer2012() */
    await openDet('det-import');
    await page.fill('#imp-ent', ['m <- rbind(H1=c(0, 0, 1, 0, 0), H2=c(0, 0, 1, 0, 0), H3=c(0, 0, 0, "1-\\\\epsilon", "\\\\epsilon"), H4=c(0, 1, 0, 0, 0), H5=c(0, 0, 0, 0, 0))', 'weights <- c(1, 0, 0, 0, 0)', 'graph1 <- new("graphMCP", m=m, weights=weights)', 'm <- rbind(H1=c(0, 0, 1, 0, 0), H2=c(0, 0, 1, 0, 0), H3=c(0, 0, 0, "\\\\epsilon", "1-\\\\epsilon"), H4=c(0, 0, 0, 0, 0), H5=c(1, 0, 0, 0, 0))', 'weights <- c(0, 1, 0, 0, 0)', 'graph2 <- new("graphMCP", m=m, weights=weights)', 'graph <- new("entangledMCP", subgraphs=list(graph1,graph2), weights=c(0.5,0.5))'].join('\n'));
    await page.click('[data-action="import-ent"]'); await sleep(200);
    r = await ev(() => ({ msg: $('imp-ent-msg').innerText, ent: isEntangled(G), n: G.ent ? G.ent.comps.length : 0, c: G.ent ? G.ent.c.map(Q.exact).join() : '', eps: !!(G.vars || {})['ε'], e: entViewGraph(G, 0).edges.map(e => nodeById(e.from).label + '>' + nodeById(e.to).label + '=' + (e.expr || Q.exact(e.g))).sort().join(' ') }));
    if (!/Built an entangled graph with 5 hypotheses and 2 components/.test(r.msg) || !r.ent || r.n !== 2 || r.c !== '1/2,1/2' || !r.eps || r.e !== 'H1>H3=1 H2>H3=1 H3>H4=1-ε H3>H5=ε H4>H2=1') return 'gMCP import: ' + JSON.stringify(r);
    await page.fill('#imp-ent', 'x <- c(1, 2)'); await page.click('[data-action="import-ent"]'); await sleep(100);
    if (!/entangledMCP/.test(await page.locator('#imp-ent-msg').innerText())) return 'gMCP import refusal message';
    /* the other entangled templates and the k-of-m box */
    await page.evaluate(() => { setPlain(false, true); setTab('graph'); });
    await page.selectOption('#templateSelect', 'ent:maurerFig5'); await sleep(200);
    r = await ev(() => ({ n: G.ent.comps.length, vars: Object.keys(G.vars).sort().join(','), bar: !$('compBar').hidden }));
    if (r.n !== 2 || r.vars !== 'γ1,γ2,ε' || !r.bar) return 'Fig. 5 template: ' + JSON.stringify(r);
    await page.selectOption('#templateSelect', 'ent:truncatedHolmGate'); await sleep(200);
    r = await ev(() => ({ n: G.ent.comps.length, c: G.ent.cexpr.join(','), groups: G.nodes.map(n => n.group).join(',') }));
    if (r.n !== 2 || r.c !== 'γ,1-γ' || r.groups !== 'primary,primary,secondary,secondary') return 'truncated Holm gatekeeping template: ' + JSON.stringify(r);
    await page.selectOption('#templateSelect', 'entTruncatedHolmAny'); await sleep(200);
    r = await ev(() => ({ n: G.ent.comps.length, m: G.nodes.length, e2: entViewGraph(G, 1).edges.length }));
    if (r.n !== 2 || r.m < 2 || r.e2 !== 0) return 'truncated Holm any m: ' + JSON.stringify(r);
    await page.selectOption('#templateSelect', 'entKOfM'); await sleep(200);
    if (!(await page.locator('#tplW').count())) return 'k of m box did not open';
    await page.fill('#tplW', '2 of 3'); await page.click('#tab-graph [data-action="tpl-w-create"]'); await sleep(200);
    r = await ev(() => ({ n: G.ent ? G.ent.comps.length : 0, m: G.nodes.length, c: G.ent ? Q.exact(G.ent.c[0]) : '', note: G.note.slice(0, 40) }));
    if (r.n !== 3 || r.m !== 4 || r.c !== '1/3') return 'k of m: ' + JSON.stringify(r);
    await page.selectOption('#templateSelect', 'entKOfM'); await sleep(100); await page.fill('#tplW', '7 of 9'); await page.click('#tab-graph [data-action="tpl-w-create"]'); await sleep(100);
    if (!/2 to 6 primaries/.test(await page.locator('#tplWMsg').innerText())) return 'k of m refusal';
    await page.click('#tab-graph [data-action="tpl-w-cancel"]');
    await page.evaluate(() => { setPlain(false, true); loadGraph(templateJSON('holm')); });
  });

  await step('Entangled graphs (exports): gMCP entangledMCP code with generateWeights and the weight table, graphicalMCP per component with the closed test by hand, Power tab calcPower code, SVG, PNG and TikZ of the All view with a key, beamer overlays with weight vectors, exports of one component view', async () => {
    await page.evaluate(() => { loadGraph(entangledTemplateJSON('maurerFig2')); G.nodes.forEach((n, i) => { n.p = ['0.01', '0.022', '0.005', '0.012', '0.001'][i]; }); renderAll(); });
    await page.click('#tabbtn-export'); await sleep(100);
    await page.click('[data-export="gmcp"]'); await sleep(150);
    let out = await page.locator('#exportCode').innerText();
    if (!/new\("entangledMCP", subgraphs = list\(graph_1, graph_2\),\n  weights = c\(1\/2, 1\/2\)\)/.test(out)) return 'gmcp entangledMCP';
    if (!/matrix2graph\(m_2, weights_2\)/.test(out) || !/generateWeights\(graph\)/.test(out) || !/sketchpad_weights <- matrix/.test(out)) return 'gmcp parts';
    if (!/gMCP\(graph, pvalues = c\(0\.01, 0\.022, 0\.005, 0\.012, 0\.001\), alpha = 0\.025\)/.test(out)) return 'gmcp test call';
    if (!/0, 1, 0, 0, 0,  0, 0\.9995, 0, 0, 0,/.test(out)) return 'gmcp weight {H2} = 0.9995';
    if (!/Builds each component/.test(await page.locator('#exportOut p').first().innerText())) return 'gmcp desc';
    await page.click('[data-export="graphicalmcp"]'); await sleep(150);
    out = await page.locator('#exportCode').innerText();
    if (!/graph_1 <- graph_create\(/.test(out) || !/graph_2 <- graph_create\(/.test(out) || /graph_test_shortcut|graph_test_closure/.test(out)) return 'graphicalmcp parts';
    if (!/c_weights <- c\(1\/2, 1\/2\)/.test(out) || !/rej_int <- apply/.test(out) || !/names\(rejected\) <- hyp_names/.test(out)) return 'graphicalmcp by hand';
    if (/\$|@/.test(out)) return 'graphicalmcp guesses a field name';
    await page.click('[data-export="sap"]'); await sleep(150);
    out = await page.locator('#sapText').innerText();
    if (!/in its entangled form \(Maurer and Bretz, 2013\)/.test(out) || !/component weights c1 = 1\/2 and c2 = 1\/2/.test(out) || !/Algorithm 1, p\. 1743/.test(out)) return 'sap procedure';
    if (!/In component graph 1 \(c1 = 1\/2\), H1 has initial weight 1/.test(out) || !/Taken together/.test(out) || !/H1 and H2 will each initially be tested at one-sided level 0\.0125 \(weight 1\/2\)/.test(out)) return 'sap allocation';
    if (!/Initially, in component graph 2 \(c2 = 1\/2\), H1 passes all of its level to H3/.test(out) || !/removed from every component graph/.test(out)) return 'sap propagation';
    if (!/Memory and other properties/.test(await page.locator('#sapRefs').innerText())) return 'sap reference';
    if ((await page.locator('.sap-table').count()) !== 3) return 'sap tables ' + (await page.locator('.sap-table').count());
    if (!/Initial weight in component graph 2 \(c2 = 1\/2\)/.test(await page.locator('#sapTable0').innerText()) || !/Table \[X\.2b\]\. Transition weights of component graph 2/.test(await page.locator('#sapTable2').innerText())) return 'sap table headers';
    await page.click('#tabbtn-power'); await sleep(100); await openDet('det-simr');
    out = await page.locator('#simRCode').innerText();
    if (!/calcPower\(weights = getWeights\(graph\), alpha = 0\.025 \* graph@weights, G = getMatrices\(graph\),/.test(out) || !/n\.sim = 1e5/.test(out) || /graph_calculate_power/.test(out)) return 'power R code';
    if (!/Check it in R with gMCP/.test(await page.locator('#tab-power').innerText())) return 'power det title';
    /* All view pictures with the test two steps in */
    await page.evaluate(() => setMode('test')); await sleep(100);
    const s1 = page.evaluate(() => stepOnce(false)); await sleep(1300); await s1; const s2 = page.evaluate(() => stepOnce(false)); await sleep(1300); await s2;
    if (!(await ev(() => inAllView()))) return 'test not in All view';
    await page.click('#tabbtn-export'); await sleep(100);
    await page.click('[data-export="svg"]'); await sleep(150);
    out = await page.locator('#exportCode').innerText();
    if (!/\(0\.999, 0\)/.test(out) || !/\(0\.001, 0\)/.test(out) || !/stroke-dasharray="9 5"/.test(out) || !/Graph 2 \(c = 1\/2\)/.test(out)) return 'svg all view';
    if ((out.match(/marker-end/g) || []).length !== 6) return 'svg edges ' + (out.match(/marker-end/g) || []).length;
    await page.click('[data-export="png"]'); await sleep(900); if (!(await page.locator('#pngPreview').count())) return 'png all view';
    await page.click('[data-export="tikz"]'); await sleep(150);
    out = await page.locator('#exportCode').innerText();
    if (!/comp1\/\.style=\{dashed\}/.test(out) || !/\\draw\[trans, comp1\]/.test(out) || !/\{\\scriptsize \$\(\\frac\{999\}\{1000\}, 0\)\$\}/.test(out) || !/Graph 1 \(\$c = \\frac\{1\}\{2\}\$\)/.test(out)) return 'tikz all view';
    if (!/All view: one line style per component/.test(await page.locator('#exportOut p').first().innerText())) return 'tikz desc';
    await page.click('[data-export="beamer"]'); await sleep(200);
    out = await page.locator('#exportCode').innerText();
    if ((out.match(/\\only<\d>\{%/g) || []).length !== 3) return 'beamer overlays';
    if (!/\$\(1, 0\)\$/.test(out) || !/\$\(\\frac\{999\}\{1000\}, 0\)\$/.test(out) || !/comp1/.test(out)) return 'beamer vectors';
    if (!/Passed on: \+1\/2 to H3/.test(out) || !/\+0\.4995 to H4, \+0\.0005 to H5/.test(out)) return 'beamer captions';
    /* one component on the canvas: ordinary pictures of that component, with the current weights of the test */
    await page.click('#compBar .seg button[data-comp="0"]'); await sleep(150);
    await page.click('[data-export="svg"]'); await sleep(150);
    out = await page.locator('#exportCode').innerText();
    if (/stroke-dasharray="9 5"|Graph 2/.test(out) || (out.match(/marker-end/g) || []).length !== 3) return 'svg component view';
    /* design mode again: beamer runs the procedure on the p-values through all five rejections */
    await ev(() => setMode('design')); await sleep(200); await page.click('#tabbtn-export'); await sleep(100);
    await page.click('[data-export="beamer"]'); await sleep(200);
    out = await page.locator('#exportCode').innerText();
    if ((out.match(/\\only<\d>\{%/g) || []).length !== 6) return 'beamer design overlays ' + (out.match(/\\only<\d>\{%/g) || []).length;
    if (!/\+0\.999 to H5/.test(out) || !/all hypotheses rejected/.test(out)) return 'beamer design captions';
    await page.evaluate(() => { setPlain(false, true); loadGraph(templateJSON('holm')); });
  });

  await step('Side by side (1.3.6): the "Graphs side by side" button is absent for Holm and present for Fig. 2 in both views; it gives a PNG preview of the panels; in the clinician view the SVG, TikZ and beamer buttons and the tick box are hidden while the button shows', async () => {
    await page.evaluate(() => { setMode('design', true); setPlain(false, true); loadGraph(templateJSON('holm')); setTab('export'); }); await sleep(100);
    const vis = sel => page.locator(sel).evaluate(e => e.getClientRects().length > 0).catch(() => false);
    if (await vis('[data-export="sbs"]') || await vis('#sbsRow') || await vis('#sbsNote')) return 'shown for an ordinary graph';
    await page.evaluate(() => { loadGraph(entangledTemplateJSON('maurerFig2')); }); await sleep(100);
    if (!(await vis('[data-export="sbs"]')) || !(await vis('#sbsRow')) || !(await vis('#sbsNote'))) return 'not shown for Fig. 2';
    await page.click('[data-export="sbs"]'); await sleep(900);
    if (!(await page.locator('#pngPreview').count()) || !/component graphs side by side/i.test(await page.locator('#exportOut h3').innerText())) return 'no PNG preview of the panels';
    const img = await page.locator('#pngPreview').evaluate(i => ({ w: i.naturalWidth, h: i.naturalHeight }));
    if (!(img.w > 1.4 * img.h)) return 'the panel picture is not wide: ' + JSON.stringify(img);
    if (!/Download multiplicity-graph-components\.png/.test(await page.locator('#exportOut').innerText()) && (await ev(() => canDownload('x.png')))) return 'download name';
    await page.check('#plainToggle'); await sleep(150); await page.evaluate(() => setTab('export')); await sleep(80);
    const shown = await page.locator('#tab-export [data-export]').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => e.dataset.export).sort().join());
    if (shown !== 'json,link,load,png,sbs') return 'clinician view exports: ' + shown;
    if (await vis('#sbsRow')) return 'tick box shown in the clinician view';
    await page.click('[data-export="sbs"]'); await sleep(900);
    if (!(await page.locator('#pngPreview').count())) return 'no preview in the clinician view';
    await page.uncheck('#plainToggle'); await sleep(150);
  });

  await step('Side by side (1.3.6): with the box ticked the SVG and TikZ exports hold two panels (Fig. 2 after two steps: panel 1 shows 0.999 and 0.001 at H4 and H5, panel 2 still 0) and the beamer frame has three overlays of panels with each graph\'s own levels; unticked, every export is as before', async () => {
    await page.evaluate(() => { setPlain(false, true); loadGraph(entangledTemplateJSON('maurerFig2')); G.nodes.forEach((n, i) => { n.p = ['0.01', '0.022', '0.005', '0.012', '0.001'][i]; }); renderAll(); setMode('test'); }); await sleep(150);
    const s1 = page.evaluate(() => stepOnce(false)); await sleep(1300); await s1; const s2 = page.evaluate(() => stepOnce(false)); await sleep(1300); await s2;
    await page.evaluate(() => setTab('export')); await sleep(80);
    const grab = async k => { await page.click(`[data-export="${k}"]`); await sleep(200); return page.locator('#exportCode').innerText(); };
    const before = { svg: await grab('svg'), tikz: await grab('tikz'), beamer: await grab('beamer') };
    if (/translate\(/.test(before.svg) || /name prefix/.test(before.tikz) || /name prefix/.test(before.beamer)) return 'panels drawn with the box unticked';
    await page.check('#sbsToggle'); await sleep(250);
    let out = await page.locator('#exportCode').innerText();
    if ((out.match(/\\only<\d>\{%/g) || []).length !== 3 || (out.match(/name prefix=g[12]-/g) || []).length !== 6) return 'beamer panel overlays: ' + (out.match(/name prefix/g) || []).length;
    if (!/level \$0\.01249\$/.test(out) || !/level \$0\.0000125\$/.test(out) || !/\\resizebox\{/.test(out)) return 'beamer panel levels';
    if (!/Passed on: \+1\/2 to H3/.test(out)) return 'beamer caption kept';
    if (!/Every overlay is the panel set/.test(await page.locator('#exportOut p').first().innerText()) || !/multiplicity-graph-components-steps\.tex/.test(await page.locator('#exportOut').innerText())) return 'beamer description or file name';
    out = await grab('svg');
    const panels = [...out.matchAll(/<g transform="translate\([^)]*\)">([\s\S]*?)<\/g>/g)].map(m => m[1]);
    if (panels.length !== 2) return 'svg panels ' + panels.length;
    const wts = g => [...g.matchAll(/font-size="1[13]" text-anchor="middle" fill="#[0-9a-f]+">([^<]*)<\/text>/g)].map(m => m[1]).join();
    if (wts(panels[0]) !== '1,0,1,0.999,0.001' || wts(panels[1]) !== '0,1,0,0,0') return 'svg panel weights: ' + wts(panels[0]) + ' | ' + wts(panels[1]);
    if (!/>Graph 2 \(c = 1\/2\)<\/text>/.test(out) || (out.match(/stroke="#9aa0a6" stroke-width="1.8"/g) || []).length !== 4) return 'svg labels or greyed hypotheses';
    if (!/multiplicity-graph-components\.svg/.test(await page.locator('#exportOut').innerText())) return 'svg file name';
    out = await grab('tikz');
    if ((out.match(/name prefix=g[12]-/g) || []).length !== 2 || !/\\draw\[trans, comp1\]/.test(out) || !/One scope per panel/.test(await page.locator('#exportOut p').first().innerText())) return 'tikz panels';
    await page.uncheck('#sbsToggle'); await sleep(250);
    const after = { tikz: await page.locator('#exportCode').innerText(), svg: await grab('svg'), beamer: await grab('beamer') };
    if (after.svg !== before.svg || after.tikz !== before.tikz || after.beamer !== before.beamer) return 'exports changed after unticking';
    /* the PNG button follows the current state too: the preview exists in Test mode */
    await page.click('[data-export="sbs"]'); await sleep(900); if (!(await page.locator('#pngPreview').count())) return 'no PNG in Test mode';
    await ev(() => setMode('design')); await sleep(200);
    await page.evaluate(() => { setPlain(false, true); loadGraph(templateJSON('holm')); });
  });

  await step('Entangled graphs (Compare tab): All-view pictures, combined weights with the component vectors, transitions compared graph by graph against a kept copy with different c and against an ordinary graph, test both, paired power, entangled templates offered', async () => {
    await page.evaluate(() => { loadGraph(entangledTemplateJSON('maurerFig2')); G.nodes.forEach((n, i) => { n.p = ['0.01', '0.022', '0.005', '0.012', '0.001'][i]; }); renderAll(); });
    await page.click('#tabbtn-compare'); await sleep(100);
    await page.fill('#cmpKeepName', 'Fig 2'); await page.click('[data-action="cmp-keep"]'); await sleep(150);
    if ((await ev(() => KEPT.length)) !== 1 || !(await ev(() => !!KEPT[0].graph.ent))) return 'keep entangled';
    await page.click('#tabbtn-graph'); await page.fill('#cw-0', '1/4'); await page.press('#cw-0', 'Tab'); await page.fill('#cw-1', '3/4'); await page.press('#cw-1', 'Tab'); await sleep(150);
    await page.click('#tabbtn-compare'); await page.selectOption('#cmpWith', 'kept:0'); await sleep(250);
    if ((await page.locator('.cmp-pic').count()) !== 2) return 'pictures';
    const pics = await page.locator('.cmp-pic').evaluateAll(els => els.map(e => e.outerHTML));
    if (!pics.every(p => /\(1, 0\)/.test(p) && /Graph 2 \(c = /.test(p) && /stroke-dasharray="9 5"/.test(p))) return 'All-view pictures';
    const structText = () => page.evaluate(() => { const d = $('det-cmp-structure'); d.open = true; return d.innerText; });
    let st = await structText();
    if (!/A is an entangled graph with 2 component graphs \(c = 1\/4, 3\/4\); B is an entangled graph with 2 component graphs \(c = 1\/2, 1\/2\)/.test(st)) return 'entangled note: ' + st.slice(0, 300);
    if (!/H1\s+1\/4 \(1, 0\)\s+1\/2 \(1, 0\)\s+\+1\/4/.test(st) || !/H2\s+3\/4 \(0, 1\)\s+1\/2 \(0, 1\)\s+-1\/4/.test(st)) return 'combined weights: ' + st.slice(0, 500);
    if (!/same transitions/.test(await page.locator('#det-cmp-structure summary').innerText())) return 'same transitions';
    await openDet('det-cmp-test'); await page.click('[data-action="cmp-test"]'); await page.waitForFunction(() => CMP.test && !CMP.running, null, { timeout: 10000 }); await sleep(100);
    const tt = await page.locator('#det-cmp-test').innerText(); if (!/A rejects 0, B rejects 5\./.test(tt)) return 'test both (H1 at α\/4 = 0.00625 and H2 at 3α\/4 = 0.01875 fail in A): ' + tt.slice(0, 300);
    await openDet('det-cmp-power'); await page.click('#tabbtn-power'); await page.selectOption('#sim-n', '2000'); await page.click('#tabbtn-compare');
    await page.click('[data-action="cmp-power"]'); await page.waitForFunction(() => CMP.power && !CMP.running, null, { timeout: 30000 }); await sleep(100);
    const pt = await page.locator('#det-cmp-power').innerText(); if (!/B − A \(points\) ± SE/.test(pt) || !/2,?000 simulated trials/.test(pt)) return 'power table: ' + pt.slice(0, 200);
    /* against an ordinary graph with the same labels: Graph 1 of the entangled graph is compared with it, Graph 2 has no counterpart */
    await page.selectOption('#cmpWith', 'tpl:bretz'); await sleep(200);
    if (!/do not list the same hypotheses/.test(await page.locator('#tab-compare').innerText())) return 'bretz has 4 hypotheses';
    const ord = await ev(() => { const o = entangledTemplateJSON('maurerFig2'); delete o.ent; o.version = 1; return encodeShare(deserializeGraph(o, false, 1).G); });
    await page.selectOption('#cmpWith', 'paste'); await sleep(100); await page.fill('#cmpPaste', ord); await page.click('[data-action="cmp-use-paste"]'); await sleep(250);
    st = await structText();
    if (!/B is an ordinary graph/.test(st) || !/an ordinary graph counting as Graph 1/.test(st)) return 'ordinary B note: ' + st.slice(0, 300);
    if (!/no such graph/.test(st) || !/Graph 2/.test(st)) return 'graph 2 rows: ' + st.slice(0, 600);
    const ent5 = await ev(() => { const o = Object.keys(ENTANGLED_TEMPLATES); return o.length; });
    if ((await page.locator('#cmpWith option[value^="tpl:ent:"]').count()) !== ent5) return 'entangled templates in the list';
    await page.selectOption('#cmpWith', 'tpl:ent:maurerFig5'); await sleep(250);
    if (!/B: Entangled/.test(await page.locator('#tab-compare').innerText()) || (await page.locator('.cmp-pic').count()) !== 2) return 'entangled template as B';
    await page.click('[data-action="cmp-remove"]'); await sleep(100);
    await page.click('#tabbtn-power'); await page.selectOption('#sim-n', '10000');
    await page.evaluate(() => { setPlain(false, true); loadGraph(templateJSON('holm')); });
  });

  await step('Default-graph view (Matrix tab): Fig. 2 decomposes into the Fig. 4(a) chains plus ε-order sequences, hiding the small ones, copy as text, make an entangled graph of the sequences, the import box builds Fig. 4(a), Holm on 4 gives 24 sequences, 7 hypotheses refused', async () => {
    await page.evaluate(() => { setPlain(false, true); loadGraph(entangledTemplateJSON('maurerFig2')); setTab('matrix'); $('det-default').open = true; }); await sleep(250);
    let t = await page.locator('#dg-body').innerText();
    if (!/default graph of 4 fixed sequences/.test(t) || !/H1 > H3 > H4 > H2 > H5\s+0\.4995/.test(t) || !/H1 > H3 > H5 \*\s+0\.0005/.test(t) || !/Appendix A, pp\. 1752-1753/.test(t)) return 'fig 2 sequences: ' + t.slice(0, 600);
    if ((await page.locator('#dg-body svg circle').count()) !== 16) return 'picture circles ' + (await page.locator('#dg-body svg circle').count());
    await page.click('#dg-hide'); await sleep(200); t = await page.locator('#dg-body').innerText();
    if (!/2 sequences hidden \(total weight 0\.001\)/.test(t) || /H1 > H3 > H5/.test(t) || (await page.locator('#dg-body svg circle').count()) !== 10) return 'hide small: ' + t.slice(0, 400);
    await page.click('[data-action="dg-copy"]'); await sleep(100);
    const txt = await ev(() => defaultGraphText(defaultGraphOf(G).seqs.filter(s => Q.cmp(s.c, Q.parse('1/100')) >= 0)));
    if (txt !== 'H1 > H3 > H4 > H2 > H5 : 0.4995\nH2 > H3 > H5 > H1 > H4 : 0.4995') return 'copied text: ' + txt;
    await page.click('[data-action="dg-make"]'); await sleep(300);
    let r = await ev(() => ({ n: G.ent ? G.ent.comps.length : 0, c: G.ent ? G.ent.c.map(q => Q.exact(q)).join(',') : '', w: G.nodes.map(n => Q.exact(n.w)).join(','), e: G.edges.length, note: G.note }));
    if (r.n !== 2 || r.c !== '999/2000,999/2000' || r.w !== '1,0,0,0,0' || r.e !== 4 || !/Default graph: 2 fixed sequences/.test(r.note)) return 'make entangled: ' + JSON.stringify(r);
    t = await page.locator('#dg-body').innerText();
    if (!/default graph of 2 fixed sequences/.test(t) || !/add up to 0\.999/.test(t)) return 'view of the made graph: ' + t.slice(0, 300);
    /* import box */
    await page.evaluate(() => { $('det-import').open = true; });
    await page.fill('#imp-dg', '# Fig. 4(a)\nH1 > H3 > H4 > H2 > H5 : 1/2\nH2 → H3 → H5 → H1 → H4 : 1/2'); await page.click('[data-action="import-dg"]'); await sleep(300);
    if (!/✓ Built an entangled graph with 5 hypotheses and 2 component graphs/.test(await page.locator('#imp-dg-msg').innerText())) return 'import message: ' + await page.locator('#imp-dg-msg').innerText();
    r = await ev(() => ({ labels: G.nodes.map(n => n.label).join(','), n: G.ent.comps.length, ex: isAlphaExhaustive(G), c: G.ent.c.map(q => Q.exact(q)).join(',') }));
    if (r.labels !== 'H1,H3,H4,H2,H5' || r.n !== 2 || r.ex !== true || r.c !== '1/2,1/2') return 'imported graph: ' + JSON.stringify(r);
    await page.fill('#imp-dg', 'H1 > H1 : 1'); await page.click('[data-action="import-dg"]'); await sleep(100);
    if (!/appears twice/.test(await page.locator('#imp-dg-msg').innerText())) return 'import refusal';
    /* 1.3.7: labels with commas survive the round trip from "Copy as text" to the import box (Hung and Wang) */
    await page.evaluate(() => { loadGraph(templateJSON('hungWang')); $('det-default').open = true; $('det-import').open = true; }); await sleep(250);
    const hwText = await page.evaluate(() => defaultGraphText(defaultGraphOf(G).seqs));
    if (!/H1,NI > /.test(hwText)) return 'Hung and Wang copy text: ' + hwText.split('\n')[0];
    await page.fill('#imp-dg', hwText); await page.click('[data-action="import-dg"]'); await sleep(200);
    const hwMsg = await page.locator('#imp-dg-msg').innerText();
    r = await ev(() => ({ labels: G.nodes.map(n => n.label).sort().join('|'), ent: isEntangled(G) }));
    if (!/with 4 hypotheses/.test(hwMsg) || r.labels !== 'H1,NI|H1,S|H2,NI|H2,S' || !r.ent) return 'Hung and Wang round trip: ' + hwMsg + ' ' + JSON.stringify(r);
    /* Holm on 4 and a graph with 7 hypotheses */
    await page.evaluate(() => { loadGraph(cycleTemplate(4)); }); await sleep(250);
    t = await page.locator('#dg-body').innerText();
    if (!/default graph of 4 fixed sequences/.test(t) || !/H1 > H2 > H3 > H4\s+1\/4/.test(t)) return 'cycle 4: ' + t.slice(0, 300);
    await page.evaluate(() => { const o = cycleTemplate(4); o.edges = []; for (const a of o.nodes) for (const b of o.nodes) if (a !== b) o.edges.push({ from: a.id, to: b.id, weight: '1/3', bend: null }); loadGraph(o); }); await sleep(300);
    t = await page.locator('#dg-body').innerText();
    if (!/default graph of 24 fixed sequences/.test(t) || !/1\/24/.test(t)) return 'holm 4: ' + t.slice(0, 300);
    if (!(await page.locator('[data-action="dg-make"]').count()) || (await page.locator('[data-action="dg-make"]').isDisabled())) return 'make button for 24';
    await page.evaluate(() => { loadGraph(cycleTemplate(7)); }); await sleep(250);
    if (!/up to 6 hypotheses \(this graph has 7\)/.test(await page.locator('#dg-body').innerText())) return 'm = 7 message';
    await page.evaluate(() => { $('det-default').open = false; loadGraph(templateJSON('holm')); setTab('graph'); });
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
    const r = await fr.evaluate(() => { setPlain(false, true); setTab('export'); showExport('link'); return { isTop, txt: document.getElementById('exportOut').innerText.slice(0, 120), nodes: G.nodes.length }; });
    if (r.isTop) return 'isTop in frame';
    if (!/share code/i.test(r.txt)) return 'share code text: ' + r.txt;
    await p2.close();
  });

  /* Plain language (1.3.1). Each check runs in a fresh browser context, so settings from the steps above do not carry over. */
  const { capturePlain, oldWordsIn } = require('./plain-capture');
  const freshPage = async () => {
    const c = await b.newContext({ viewport: { width: 1400, height: 900 } }); c.setDefaultTimeout(8000);
    const p = await c.newPage();
    p.on('pageerror', e => errors.push('plain pageerror: ' + e.message));
    await p.goto(FILE); await p.waitForTimeout(700);
    return { c, p };
  };
  await step('Plain language off: the Test tab, drawing, hint, toolbar and presentation mode show exactly the 1.3.0 text with Advanced on (clinician set-up)', async () => {
    const want = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'plain-off-1.3.0.json'), 'utf8')).text;
    const { c, p } = await freshPage();
    const got = await capturePlain(p, false);
    await c.close();
    /* planned exceptions: (1) the Plain language box left the Test tab heading for the switch at the foot of the panel
       (1.3.2); (2) presentation mode now shows the last step's own sentence ("Rejected H3: ...") before the "Stopped"
       caption, which 1.3.0 never showed (1.3.5), so that one caption is taken out before the comparison */
    const noLabel = v => typeof v === 'string' ? v.replace(/^Test the graph\nPlain language\n/, 'Test the graph\n') : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noLabel(x)])) : v;
    const gc = got.present && got.present.captions;
    if (gc && gc.length === want.present.captions.length + 1 && /^Rejected H3: p = 0\.011 ≤ 1\/2 × 0\.025 = 0\.0125\. Passed on: \+1\/2 to H4\.$/.test(gc[gc.length - 2])) gc.splice(gc.length - 2, 1);
    for (const k of Object.keys(want)) {
      const a = JSON.stringify(noLabel(want[k])), g = JSON.stringify(noLabel(got[k]));
      if (a !== g) { let i = 0; while (i < a.length && a[i] === g[i]) i++; return `${k} differs at ${i}: 1.3.0 "${a.slice(Math.max(0, i - 40), i + 60)}" now "${(g || '').slice(Math.max(0, i - 40), i + 60)}"`; }
    }
  });
  await step('Plain language on: no "rejected", "level", α, ≤, "hypothesis", "weight" or other statistician words in the clinician set-up (Test tab, drawing, Graph tab, status line, dots); the sums are behind "Show the sums"; What-if buttons read "Wait…" while a share moves; "step 2 of 3" while Run test runs; the description tip; the last step\'s sentence shows before "Finished" in presentation mode', async () => {
    const { c, p } = await freshPage();
    const got = await capturePlain(p, true);
    const hits = oldWordsIn(got);
    let sums = '';
    /* 1.3.5: the dots carry shares as percentages; the status line names the allowance; the presentation captions end
       with the last step's own sentence and then "Finished" (the last step was never shown up to 1.3.4) */
    if (!got.dots.length || got.dots.some(t => !/^\+\d[\d.]*%$/.test(t))) sums += 'dots: ' + got.dots.join(', ') + '. ';
    if (!/allowance/.test(got.graphDesign.status)) sums += 'status line: ' + got.graphDesign.status.slice(0, 120) + '. ';
    /* the toolbar (1.3.5): "= 2.5%" after the allowance box from 1440 wide, one row at 1366 and 1440, nothing with Plain language off */
    for (const [w, want] of [[1366, false], [1440, true]]) {
      await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(150);
      const r = await p.evaluate(() => ({ pct: $('alphaPct').textContent, shown: $('alphaPct').getClientRects().length > 0, h: Math.round(document.querySelector('.topbar').getBoundingClientRect().height) }));
      if (r.pct !== '= 2.5%' || r.shown !== want || r.h > 60) sums += `toolbar at ${w}: ${JSON.stringify(r)}. `;
    }
    await p.evaluate(() => setPlain(false)); await p.waitForTimeout(100);
    if (await p.evaluate(() => $('alphaPct').getClientRects().length > 0 || $('alphaPct').textContent !== '' || $('addNodeBtn').textContent !== '+ Hypothesis')) sums += 'toolbar with Plain language off: percentage shown or button renamed. ';
    await p.evaluate(() => setPlain(true)); await p.setViewportSize({ width: 1400, height: 900 }); await p.waitForTimeout(150);
    /* What-if (D5): "What would it take?" ignores the typed p-values in the clinician view */
    for (const k of ['whatIfStart', 'whatIfH1']) if (!/p-values are ignored in What if/.test(got[k].tab) || /p-value 0\.0/.test(got[k].tab) || !/The most it could ever hold: 2\.5%/.test(got[k].tab)) sums += `What-if cards (${k}): ` + got[k].tab.replace(/\s+/g, ' ').slice(-300) + '. ';
    const caps = got.present.captions;
    if (caps.length !== 5 || !/^H3 succeeded/.test(caps[3]) || !/^Finished/.test(caps[4])) sums += 'presentation captions: ' + caps.map(x => x.slice(0, 40)).join(' | ') + '. ';
    /* What-if: while a share moves, every button reads "Wait…" and is disabled; then "If it succeeds" again */
    await p.click('#tabbtn-test'); await p.click('[data-action="mode-whatif"]'); await p.waitForTimeout(150);
    const firstId = await p.evaluate(() => G.nodes[0].id);
    await p.click(`[data-action="reject"][data-id="${firstId}"]`); await p.waitForTimeout(250);
    const during = await p.evaluate(() => [...document.querySelectorAll('#tab-test [data-action="reject"]')].map(x => x.textContent + (x.disabled ? '/off' : '/on')));
    for (let i = 0; i < 200 && await p.evaluate(() => animating); i++) await p.waitForTimeout(50);
    const after = await p.evaluate(() => [...document.querySelectorAll('#tab-test [data-action="reject"]')].map(x => x.textContent + (x.disabled ? '/off' : '/on')));
    if (!during.length || during.some(x => x !== 'Wait…/off')) sums += 'during the move: ' + during.join(', ') + '. ';
    if (!after.length || after.some(x => x !== 'If it succeeds/on')) sums += 'after the move: ' + after.join(', ') + '. ';
    await p.click('[data-action="mode-p"]'); await p.waitForTimeout(150);
    /* Run test shows "step k of 3" while it runs, and the line goes when it ends */
    await p.click('[data-action="run"]');
    const seen = new Set();
    for (let i = 0; i < 200 && await p.evaluate(() => animating || (T && T.running)); i++) { const t = await p.evaluate(() => { const e = document.querySelector('[data-progress="run"]'); return e ? e.textContent : ''; }); if (t) seen.add(t); await p.waitForTimeout(40); }
    if (![...seen].some(t => /step 2 of 3/.test(t)) || [...seen].some(t => !/^Running the test: step [123] of 3\.$/.test(t))) sums += 'progress lines: ' + [...seen].join(' | ') + '. ';
    if (await p.locator('[data-progress="run"]').count()) sums += 'progress line left after the run. ';
    const d = p.locator('#det-sums');
    if (!(await d.count())) sums += 'no "Show the sums" section';
    else if (await d.evaluate(x => x.open)) sums += '"Show the sums" is open by default';
    else { await p.click('[data-action="show-sums"]'); await p.waitForTimeout(400); if (!(await d.evaluate(x => x.open))) sums += 'the Show the sums button did not open it'; const t = await d.innerText(); if (!/Rejected H1: p = 0\.004 ≤ 1\/2 × 0\.025 = 0\.0125\./.test(t)) sums += 'sums text: ' + t.slice(0, 200); }
    /* the description tip shows while every description is empty, and goes once one is filled in */
    if (!(await p.locator('#tab-test [data-hint="desc"]').count())) sums += 'no description tip. ';
    await p.evaluate(() => { G.nodes[0].desc = 'dose 1, main outcome'; renderAll(); }); await p.waitForTimeout(100);
    if (await p.locator('#tab-test [data-hint="desc"]').count()) sums += 'description tip still shown with a description. ';
    await c.close();
    if (hits.length || sums) return `${hits.length} old word${hits.length === 1 ? '' : 's'} left${hits.length ? ': ' + hits.slice(0, 6).join('; ') : ''}${sums ? '. ' + sums : ''}`;
  });

  /* One switch (after 1.3.1): Plain language on shows what 1.3.0 showed with Advanced off; off, what Advanced on showed */
  const { captureViews, diffViews } = require('./view-capture');
  await step('Plain language on hides exactly what 1.3.0 hid with Advanced off: tabs, templates, menu, sections and buttons; off shows what Advanced on showed', async () => {
    const views = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'views-1.3.0.json'), 'utf8'));
    /* planned differences: Import opens the Matrix tab, so it is hidden with the tab in the clinician view (1.3.2);
       1.3.6: the side-by-side export of an entangled graph (Maurer and Bretz 2013, Fig. 2): the "Graphs side by side"
       button and its note show in both views, the tick box for the SVG, TikZ and beamer exports with Plain language off only */
    const planned = ['menu: only with 1.3.0 Advanced off: importBtn',
      'entangledDesign.export: only with Plain language on: #sbsNote, export:sbs',
      'entangledDesign.export: only with Plain language off: #sbsNote, #sbsRow, #sbsToggle, export:sbs'];
    let out = '';
    for (const on of [true, false]) {
      const { c, p } = await freshPage();
      await p.evaluate(on => setPlain(on), on); await p.waitForTimeout(100);
      const got = await captureViews(p);
      if (on) {
        /* the sentences that pointed to "advanced features" now point to the switch */
        await p.evaluate(() => setTab('export')); await p.waitForTimeout(60);
        const ex = await p.locator('#tab-export').innerText();
        if (!/for the statistician\. Untick Plain language to see them\./.test(ex) || /advanced/i.test(ex)) out += 'Export note: ' + ex.slice(0, 160).replace(/\s+/g, ' ') + '. ';
        await p.evaluate(() => { G.test.type = 'simes'; setTab('test'); }); await p.waitForTimeout(60);
        const tx = await p.locator('#tab-test').innerText();
        if (!/Test: Weighted Simes\. Untick Plain language to change it\./.test(tx) || /advanced/i.test(tx)) out += 'Test line: ' + tx.slice(0, 160).replace(/\s+/g, ' ') + '. ';
        if (await p.locator('#tab-test #testType').count()) out += 'Test type section shown in the clinician view. ';
        await p.evaluate(() => { G.test.type = 'bonferroni'; renderAll(); });
      }
      await c.close();
      const want = on ? views.advancedOff : views.advancedOn;
      const d = diffViews(want, got, `1.3.0 Advanced ${on ? 'off' : 'on'}`, `Plain language ${on ? 'on' : 'off'}`).filter(l => !planned.includes(l));
      if (d.length) out += `Plain language ${on ? 'on' : 'off'}: ${d.slice(0, 5).join(' | ')}${d.length > 5 ? ` (+${d.length - 5})` : ''}. `;
    }
    if (out) return out;
  });
  await step('Ticking Plain language on the Matrix, Power or Optimise tab moves to the Graph tab: only its panel and tab button show (the 1.3.0 Advanced-off bug)', async () => {
    const { c, p } = await freshPage();
    let out = '';
    for (const t of ['matrix', 'power', 'optimise']) {
      await p.evaluate(() => setPlain(false)); await p.evaluate(t => setTab(t), t); await p.waitForTimeout(80);
      await p.click('#plainToggle'); await p.waitForTimeout(120);
      const r = await p.evaluate(() => ({ active: activeTab, shown: TABS.filter(x => !$('tab-' + x).hidden), selected: TABS.filter(x => $('tabbtn-' + x).getAttribute('aria-selected') === 'true'), ticked: $('plainToggle').checked, plain }));
      if (!r.plain || !r.ticked || r.active !== 'graph' || r.shown.join() !== 'graph' || r.selected.join() !== 'graph') out += `${t}: ${JSON.stringify(r)}. `;
    }
    await c.close();
    if (out) return out;
  });

  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ` (${r.ms} ms)` + (r.ok ? '' : '\n      ' + r.detail));
  console.log(`\n${results.length - fails}/${results.length} browser checks passed`);
  console.log('page errors:', errors.length ? errors : 'none');
  await b.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
