/* Reads what the page shows in each view: the tab buttons, the template options, the More menu items, the
   section and button ids in the Graph, Test, Compare and Export tabs, and the component bar. Captured from the
   1.3.0 build with Advanced off and Advanced on (tests/views-1.3.0.json, by make-views-snapshot.js); from the
   clinician view (one switch, after 1.3.1) the browser suite checks that Plain language on shows what Advanced
   off showed, and Plain language off what Advanced on showed.

   Three states: the clinician set-up in Design mode (two doses, two endpoints; p = 0.004, 0.009, 0.011, 0.03),
   the same at the start of Step through, and an entangled template (Maurer and Bretz 2013, Fig. 4) in Design mode.
   Hidden tabs (Matrix, Power, Optimise) are not opened: opening one in 1.3.0 switched Advanced on. */
const { SETUP_P } = require('./plain-capture');

/* Ids of the switches themselves and of what moved with them; left out of every capture so the views compare */
const IGNORE = ['advToggle', 'advSwitch', 'plainToggle', 'plainMenuToggle', 'plainSwitch'];
const IGNORE_ACTIONS = ['go-advanced'];

async function captureViews(page) {
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const sleep = ms => page.waitForTimeout(ms);
  const idle = async () => { for (let i = 0; i < 200; i++) { if (await ev(() => !animating && !(T && T.running))) return; await sleep(50); } throw new Error('still animating'); };
  const visibleIn = sel => ev(({ sel, ignore, ignoreActions }) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const seen = new Set();
    const vis = el => el.getClientRects().length > 0;
    for (const el of root.querySelectorAll('details[id], [data-action], [data-export], [id]')) {
      if (!vis(el)) continue;
      if (el.tagName === 'DETAILS' && el.id) seen.add('details#' + el.id);
      else if (el.dataset.action) { if (!ignoreActions.includes(el.dataset.action)) seen.add('action:' + el.dataset.action); }
      else if (el.dataset.export) seen.add('export:' + el.dataset.export);
      else if (el.id && !/^(tp-|cw-|node-|edge-|mx|opt-|pow-|cmp-|exp)/.test(el.id) && !ignore.includes(el.id)) seen.add('#' + el.id);
    }
    return [...seen].sort();
  }, { sel, ignore: IGNORE, ignoreActions: IGNORE_ACTIONS });
  const common = async () => ({
    tabs: await ev(() => [...document.querySelectorAll('.tabs [role="tab"]')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.id)),
    templates: await ev(() => [...document.querySelectorAll('#templateSelect option')].map(o => o.value).filter(Boolean)),
    menu: await ev(ignore => [...document.querySelectorAll('#moreMenu .menu-pop [id]')].filter(e => getComputedStyle(e).display !== 'none' && !ignore.includes(e.id)).map(e => e.id), IGNORE)
  });
  const tabsOf = async () => {
    const out = {};
    for (const t of ['graph', 'test', 'compare', 'export']) { await ev(t => setTab(t), t); await sleep(60); out[t] = await visibleIn('#tab-' + t); }
    out.compBar = await visibleIn('#compBar');
    await ev(() => setTab('graph'));
    return out;
  };
  const out = { ...(await common()) };

  await page.selectOption('#templateSelect', 'bretz'); await sleep(150);
  await ev(() => setTab('test')); await sleep(60);
  const inputs = page.locator('[data-p]');
  for (let i = 0; i < 4; i++) { await inputs.nth(i).fill(SETUP_P[i]); await inputs.nth(i).press('Tab'); }
  await ev(() => setTab('graph')); await sleep(60);
  out.design = await tabsOf();

  await ev(() => setTab('test')); await page.click('[data-action="enter-test"]'); await idle(); await sleep(100);
  out.stepStart = await tabsOf();
  await ev(() => setTab('test')); await page.click('[data-action="exit-test"]'); await sleep(100);

  await page.selectOption('#templateSelect', 'ent:maurerFig4'); await sleep(200);
  out.entangledDesign = await tabsOf();
  return out;
}

/* Every difference between two captures, as "where: only in A: ... / only in B: ..." lines */
function diffViews(a, b, nameA, nameB) {
  const lines = [];
  const walk = (where, x, y) => {
    if (Array.isArray(x) || Array.isArray(y)) {
      const sx = new Set(x || []), sy = new Set(y || []);
      const onlyA = [...sx].filter(v => !sy.has(v)), onlyB = [...sy].filter(v => !sx.has(v));
      if (onlyA.length || onlyB.length) lines.push(`${where}: ${onlyA.length ? `only with ${nameA}: ${onlyA.join(', ')}` : ''}${onlyA.length && onlyB.length ? '; ' : ''}${onlyB.length ? `only with ${nameB}: ${onlyB.join(', ')}` : ''}`);
    } else if (x && y && typeof x === 'object') for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(where ? where + '.' + k : k, x[k], y[k]);
    else if (x !== y) lines.push(`${where}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  };
  walk('', a, b);
  return lines;
}

module.exports = { captureViews, diffViews, IGNORE, IGNORE_ACTIONS };
