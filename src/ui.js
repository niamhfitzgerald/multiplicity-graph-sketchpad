/* =====================================================================
   UI: canvas editing, side panels, test mode, power, exports.
   ===================================================================== */
const $ = id => document.getElementById(id);
const svg = $('canvas'), world = $('world'), overlay = $('overlay'), gridRect = $('gridRect');
const inl = $('inlineEdit');
const TABS = ['graph', 'matrix', 'test', 'power', 'compare', 'export'];

let G = { nodes: [], edges: [], diag: {}, alpha: 0.025, sided: 'one', note: '', test: defaultTest() };
let CT = null;        // last closed-test result: {sig, adj, subsets, rejected, type, ms}
let ctRunning = null; // {done, total} while a closed test is being computed
let nextId = 1;
let mode = 'design';
let T = null;
let sel = null;
let numMode = 'frac';
let snap = false;
let hints = true;
let manual = false;
let animating = false;
let activeTab = 'graph';
let view = { cx: 0, cy: 0, k: 1 };
let autoFit = true; /* true until the user pans or zooms; then a resize keeps their view */
const narrowScreen = () => window.matchMedia('(max-width: 640px)').matches;
let drag = null;
let linking = null;
let inline = null;
let lastDown = { time: 0, x: 0, y: 0, kind: '', id: '' };
let lastLayout = [];
let V = [];
let statusFixes = [];
let exportView = null;
let exportPayload = null;
let sapHTML = '';
let bendSliding = false;
let starterM = 3;
/* The "Improved fallback I for any m" weights box: on the start panel (starterW) or in the Graph panel (tplW) */
let starterWOpen = false, starterWFor = 0;
let tplW = null;
let mxView = 'current';
let arrGap = 'normal';
const GAPS = { compact: 170, normal: 230, wide: 300 };
const PALETTE = [['Blue', '#cfe3f5'], ['Green', '#d3ecd4'], ['Yellow', '#fbe7a1'], ['Orange', '#f9d3b0'], ['Red', '#f6c6c2'], ['Purple', '#ded2f2'], ['Teal', '#c6e8e3'], ['Grey', '#dfe2e6'], ['Navy', '#1c5a88'], ['Forest', '#2d6a39'], ['Burgundy', '#8e2c3a'], ['Charcoal', '#3b444c']];
const SHAPES = [['circle', 'Circle'], ['tworows', 'Two rows'], ['line', 'Line'], ['grid', 'Grid'], ['layers', 'Order of testing'], ['column', 'Column']];
let dlCap; // undefined until resolved; null when this view cannot save files
const openDetails = new Set(['det-steps', 'det-order', 'det-wit']);
let wit = null;      // {target, set, step, sig}: a 'what would it take' set shown on the canvas
let witForce = false; // user asked to enumerate a large graph anyway
let plain = false;    // plain-language view for clinicians
let presenting = false;
let advanced = false; // simple mode hides the matrix, power and technical exports until switched on
const hist = { past: [], future: [] };
const SIM = { power: {}, rho: '0.5', useMatrix: false, corr: {}, n: 10000, success: { ids: [], rule: 'any' }, running: null, result: null, runs: [], error: '' };
/* Help on what correlation to enter, shown in the Power tab and in the parametric help of the Test tab */
/* Result-text note for correlations entered as 1 and capped at 0.999999 so the matrix is positive definite (runSim and the Compare tab) */
function corrCapText(capped) { return capped ? ` (${capped} pair${capped > 1 ? 's' : ''} entered as 1 ${capped > 1 ? 'were' : 'was'} set to 0.999999 so that the matrix is positive definite)` : ''; }
const CORR_WHAT_TO_ENTER = 'What to enter. For two doses compared with one control, the correlation of the two z statistics is &radic;(n&#8321;n&#8322; / ((n&#8321; + n&#8320;)(n&#8322; + n&#8320;))), so 0.5 with equal group sizes (Bretz et al., 2011, p. 904; Li, Deng and Ting, 2023, section 3.4). For the same test in the full population and in a subgroup, it is about the square root of the subgroup\'s share of the sample (Zhao, Dmitrienko and Tamura, 2010, eq. 4). For two endpoints measured on the same patients, it is the correlation between the endpoints. For binary endpoints use the tetrachoric correlation, not the correlation of the 0/1 outcomes (Westfall et al., 2008, p. 620).';

const fmt = q => Q.fmt(q, numMode);
const editVal = q => (numMode === 'dec' ? Q.dec(q) : (Q.isExactShort(q) ? Q.exact(q) : Q.dec(q)));
const nodeById = id => G.nodes.find(n => n.id === id);
const edgeOf = (a, b) => G.edges.find(e => e.from === a && e.to === b);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
};
const isTop = (() => { try { return window.top === window; } catch (e) { return false; } })();
function det(id, summary, body, note) {
  return `<details class="more" id="${id}"${openDetails.has(id) ? ' open' : ''}><summary>${summary}${note ? ` <span class="sum-note">${note}</span>` : ''}</summary><div class="det-body">${body}</div></details>`;
}
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d && d.matches && d.matches('details.more') && d.id) { if (d.open) openDetails.add(d.id); else openDetails.delete(d.id); }
}, true);

/* ---------- history ---------- */
function snapshot() { return JSON.stringify(serializeGraph(G)); }
function checkpoint() {
  hist.past.push(snapshot());
  if (hist.past.length > 200) hist.past.shift();
  hist.future = [];
}
function restore(str) {
  const r = deserializeGraph(JSON.parse(str), true);
  G = r.G; nextId = Math.max(nextId, r.maxId + 1);
  if (sel && !(sel.type === 'node' ? nodeById(sel.id) : G.edges.some(e => gKey(e.from, e.to) === sel.key))) sel = null;
}
function undo() {
  if (mode === 'test') { stepBack(); return; }
  if (!hist.past.length || animating) return;
  closeInline(false); linking = null;
  hist.future.push(snapshot()); restore(hist.past.pop()); afterChange();
}
function redo() {
  if (mode === 'test') { redoStep(); return; }
  if (!hist.future.length || animating) return;
  closeInline(false); linking = null;
  hist.past.push(snapshot()); restore(hist.future.pop()); afterChange();
}

/* ---------- change plumbing ---------- */
function afterChange() {
  evaluateGraph(G);
  if (mode === 'test') resetTest();
  renderAll();
  scheduleHash();
}
function deferChange() { setTimeout(afterChange, 0); }
let hashTimer = null;
function scheduleHash() {
  if (!isTop) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    try { history.replaceState(null, '', G.nodes.length ? '#' + encodeShare(G) : location.pathname + location.search); } catch (e) { /* ignore */ }
  }, 500);
}
function loadGraph(o, opts = {}) {
  const r = deserializeGraph(o, false, nextId);
  if (opts.checkpoint !== false) checkpoint();
  tplW = null; starterWOpen = false;
  if (mode === 'test') setMode('design', true);
  G = r.G; nextId = r.maxId + 1; sel = null; linking = null;
  if (o.alpha == null) G.alpha = 0.025;
  afterChange();
  fitView();
}

/* ---------- model edits ---------- */
function setEdgeWeight(a, b, q, expr) {
  const ex = edgeOf(a, b);
  if (Q.isZero(q) && !expr) { G.edges = G.edges.filter(e => e !== ex); return; }
  if (ex) { ex.g = q; ex.expr = expr || undefined; } else G.edges.push({ from: a, to: b, g: q, bend: null, expr: expr || undefined });
}
/* Reads a weight typed by the user: number or expression. Returns null when it cannot be read. */
function readWeight(txt) { return weightFromText(G, (txt || '').trim() === '' ? '0' : txt); }
function weightText(q, expr) { return expr ? exprDisplay(expr) : editVal(q); }
function rowSum(id) { let r = Q.ZERO; for (const e of G.edges) if (e.from === id) r = Q.add(r, e.g); return r; }
function weightSum() { let t = Q.ZERO; for (const n of G.nodes) t = Q.add(t, n.w); return t; }
function addNodeAt(x, y) {
  if (mode !== 'design') return null;
  if (snap) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
  checkpoint();
  const used = new Set(G.nodes.map(n => n.label));
  let k = G.nodes.length + 1; while (used.has('H' + k)) k++;
  const rem = Q.sub(Q.ONE, weightSum());
  const n = { id: 'n' + (nextId++), label: 'H' + k, w: Q.cmp(rem, Q.ZERO) > 0 ? rem : Q.ZERO, x, y, p: '' };
  G.nodes.push(n);
  sel = { type: 'node', id: n.id };
  if (activeTab !== 'matrix') setTab('graph');
  afterChange();
  return n;
}
function freeSpot() {
  const c = { x: view.cx, y: view.cy };
  for (let r = 0; r < 1500; r += 60) {
    for (let a = 0; a < 360; a += (r ? 30 : 360)) {
      const x = c.x + r * Math.cos(a * Math.PI / 180), y = c.y + r * Math.sin(a * Math.PI / 180);
      if (G.nodes.every(n => Math.hypot(n.x - x, n.y - y) > 140)) return { x, y };
    }
  }
  return c;
}
function deleteSelection() {
  if (!sel || mode !== 'design') return;
  checkpoint();
  if (sel.type === 'node') {
    const id = sel.id;
    G.nodes = G.nodes.filter(n => n.id !== id);
    G.edges = G.edges.filter(e => e.from !== id && e.to !== id);
    delete G.diag[id];
  } else {
    G.edges = G.edges.filter(e => gKey(e.from, e.to) !== sel.key);
  }
  sel = null;
  afterChange();
}
function createLink(a, b) {
  const key = gKey(a, b);
  if (edgeOf(a, b)) { setSel({ type: 'edge', key }); openInline({ kind: 'edge', key }); return; }
  checkpoint();
  const rem = Q.sub(Q.ONE, rowSum(a));
  G.edges.push({ from: a, to: b, g: Q.cmp(rem, Q.ZERO) > 0 ? rem : Q.parse('1/2'), bend: null });
  sel = { type: 'edge', key };
  afterChange();
  openInline({ kind: 'edge', key, isNew: true });
}
function setColors(ids, c) {
  checkpoint();
  for (const id of ids) { const n = nodeById(id); if (n) n.color = c; }
  renderAll(); scheduleHash();
}
function shapeIcon(shape) {
  const fake = { nodes: Array.from({ length: 5 }, (_, i) => ({ id: 'i' + i, w: i < 2 ? Q.ONE : Q.ZERO })), edges: [[0, 2], [1, 3], [2, 4], [3, 4]].map(([a, b]) => ({ from: 'i' + a, to: 'i' + b, g: Q.ONE })) };
  const pts = arrangePositions(fake, shape, 100, 0, 0);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs)), h = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const sc = Math.min(52 / w, 22 / h, 0.5);
  return `<svg viewBox="0 0 64 34" aria-hidden="true">${pts.map(p => `<circle cx="${(32 + (p.x - (Math.max(...xs) + Math.min(...xs)) / 2) * sc).toFixed(1)}" cy="${(17 + (p.y - (Math.max(...ys) + Math.min(...ys)) / 2) * sc).toFixed(1)}" r="4.2"/>`).join('')}</svg>`;
}
function arrangeAs(shape) {
  if (!G.nodes.length || animating) return;
  const cx = G.nodes.reduce((a, n) => a + n.x, 0) / G.nodes.length, cy = G.nodes.reduce((a, n) => a + n.y, 0) / G.nodes.length;
  const target = arrangePositions(G, shape, GAPS[arrGap], cx, cy);
  checkpoint();
  if ($('arrangeStraight').checked) G.edges.forEach(e => { e.bend = null; });
  const from = G.nodes.map(n => ({ x: n.x, y: n.y }));
  const finish = () => { G.nodes.forEach((n, i) => { n.x = target[i].x; n.y = target[i].y; }); renderAll(); fitView(); scheduleHash(); };
  $('arrangeMenu').open = false;
  if (reduced()) { finish(); return; }
  const t0 = performance.now(), dur = 380;
  const frame = now => {
    const f = Math.min(1, (now - t0) / dur), ez = 1 - Math.pow(1 - f, 3);
    G.nodes.forEach((n, i) => { n.x = from[i].x + (target[i].x - from[i].x) * ez; n.y = from[i].y + (target[i].y - from[i].y) * ez; });
    renderCanvas();
    if (f < 1) requestAnimationFrame(frame); else finish();
  };
  requestAnimationFrame(frame);
}
function doFix(f) {
  if (!f || mode !== 'design') return;
  checkpoint();
  applyFix(G, f);
  afterChange();
}

/* ---------- view (pan / zoom) ---------- */
function canvasSize() { const r = svg.getBoundingClientRect(); return { W: r.width || 600, H: r.height || 400 }; }
function applyView() {
  const { W, H } = canvasSize();
  const w = W / view.k, h = H / view.k, x = view.cx - w / 2, y = view.cy - h / 2;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  gridRect.setAttribute('x', x); gridRect.setAttribute('y', y);
  gridRect.setAttribute('width', w); gridRect.setAttribute('height', h);
  positionInline();
}
function fitView() {
  if (!G.nodes.length) { view = { cx: 0, cy: 0, k: 1 }; applyView(); return; }
  const { W, H } = canvasSize();
  const xs = G.nodes.map(n => [n.x - nodeRx(n.label), n.x + nodeRx(n.label)]).flat();
  const ys = G.nodes.map(n => [n.y - NODE_R, n.y + NODE_R]).flat();
  const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80, minY = Math.min(...ys) - 95, maxY = Math.max(...ys) + 90;
  /* On a phone the hint box spans the top of the canvas: fit the graph into the space below it */
  let top = 0;
  const chip = $('hintChip');
  if (narrowScreen() && chip && !chip.hidden && !presenting) top = Math.max(0, Math.min(H * 0.5, chip.getBoundingClientRect().bottom - svg.getBoundingClientRect().top + 6));
  view.k = Math.max(0.3, Math.min(W / (maxX - minX), (H - top) / (maxY - minY), 1.35));
  view.cx = (minX + maxX) / 2; view.cy = (minY + maxY) / 2 - top / (2 * view.k);
  autoFit = true;
  applyView();
}
function zoomBy(f) { view.k = Math.max(0.25, Math.min(3, view.k * f)); autoFit = false; applyView(); }
function toWorld(e) {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: pt.x, y: pt.y };
}
function toClient(x, y) { return new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); }

/* ---------- view model ---------- */
function buildVM() {
  const nodes = G.nodes.map(n => {
    const v = { id: n.id, label: n.label, x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R, p: n.p, w: n.w, color: n.color || '', group: n.group || '', wexpr: mode === 'test' ? '' : (n.wexpr || ''), rejected: false, capH: mode === 'test' ? (manual ? 24 : 40) : (witActive() ? 24 : 0) };
    if (mode === 'test' && T) {
      const r = T.rejected.get(n.id);
      if (r) { v.w = r.w; v.rejected = true; v.step = r.step; }
      else {
        v.w = T.st.w.get(n.id) || Q.ZERO;
        if (T.pending === n.id) { v.rejected = true; v.pending = true; }
      }
    }
    return v;
  });
  let edges;
  if (mode === 'test' && T) {
    edges = [];
    for (const [k, g] of T.st.g) {
      if (Q.isZero(g)) continue;
      const [a, b] = k.split('>');
      const orig = edgeOf(a, b);
      edges.push({ from: a, to: b, g, bend: orig ? orig.bend : null, text: fmt(g) });
    }
  } else edges = G.edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend, expr: e.expr, text: e.expr ? exprDisplay(e.expr) : fmt(e.g) }));
  return { nodes, edges };
}

/* ---------- canvas rendering ---------- */
function renderCanvas() {
  const ae = document.activeElement;
  const focusedNode = ae && ae.closest && world.contains(ae) && ae.closest('[data-node]') ? ae.closest('[data-node]').getAttribute('data-node') : null;
  const vm = buildVM();
  const layout = layoutEdges(vm);
  lastLayout = layout;
  const errNodes = new Set(), errRows = new Set(), errEdges = new Set();
  if (mode === 'design') {
    for (const m of V) if (m.level === 'error') {
      (m.nodes || []).forEach(x => errNodes.add(x));
      (m.rows || []).forEach(x => errRows.add(x));
      (m.edges || []).forEach(x => errEdges.add(x));
    }
  }
  const P = [];
  P.push('<g class="bands">');
  for (const b of groupBoxes(vm)) {
    P.push(`<g class="band"><rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="10"${b.color ? ` style="fill:${b.color};stroke:${b.color};opacity:.35"` : ''}/><text x="${(b.x + 10).toFixed(1)}" y="${(b.y + 16).toFixed(1)}">${esc(b.group)}</text></g>`);
  }
  P.push('</g><g class="edges">');
  for (const e of layout) {
    const isSel = mode === 'design' && sel && sel.type === 'edge' && sel.key === e.key;
    const isErr = errRows.has(e.from) || errEdges.has(e.key);
    const flash = T && T.flashEdges && T.flashEdges.has(e.key);
    P.push(`<g class="edge${isSel ? ' sel' : ''}${isErr ? ' err' : ''}${flash ? ' flash' : ''}" data-edge="${e.key}"><path class="edge-hit" d="${e.d}"/><path class="edge-line" d="${e.d}" marker-end="url(#${isSel ? 'ahSel' : isErr ? 'ahErr' : 'ah'})"/></g>`);
  }
  P.push('</g><g class="nodes">');
  for (const n of vm.nodes) {
    const isSel = sel && sel.type === 'node' && sel.id === n.id;
    const cls = ['node'];
    if (isSel) cls.push('sel');
    if (errNodes.has(n.id)) cls.push('err');
    if (n.rejected) cls.push('rejected');
    if (linking && linking.from === n.id) cls.push('sel');
    if (witActive()) { if (wit.target === n.id) cls.push('wit-target'); else if (wit.set.includes(n.id)) cls.push('wit-set'); }
    const lp = labelParts(n.label);
    const colored = n.color && !n.rejected;
    const tcol = colored ? `fill:${textOnColor(n.color)};` : '';
    const lab = lp ? `<text class="nlabel" y="-3" style="${tcol}">${esc(lp.base)}<tspan font-size="12" dy="5">${esc(lp.sub)}</tspan></text>`
      : `<text class="nlabel" y="-3" style="font-size:15px;${tcol}">${esc(n.label)}</text>`;
    const flash = T && T.flashNodes && T.flashNodes.has(n.id);
    const wt = (mode !== 'test' && !n.rejected && (nodeById(n.id) || {}).wexpr) ? exprDisplay(nodeById(n.id).wexpr) : fmt(n.w);
    let aria = `${n.label}, weight ${wt}`;
    if (n.rejected) aria += ', rejected';
    let extra = '';
    if (n.rejected) extra += `<line class="strike" x1="${(-n.rx * 0.6).toFixed(1)}" y1="-9" x2="${(n.rx * 0.6).toFixed(1)}" y2="-9"/>`;
    if (errNodes.has(n.id)) extra += `<g class="badge" transform="translate(${(n.rx * 0.78).toFixed(1)},${(-n.ry * 0.8).toFixed(1)})"><circle r="9"/><text y="4">!</text></g>`;
    if (mode === 'test' && T) {
      const y1 = n.ry + 17;
      if (n.rejected && !n.pending) extra += `<text class="ncap rej" y="${y1}">\u2713 Rejected${T.closed ? '' : ` (step ${n.step})`}</text>`;
      else if (T.closed) { const p = parseP(n.p); extra += `<text class="ncap" y="${y1}">${ctRunning ? 'testing\u2026' : '\u2715 not rejected'}</text><text class="ncap" y="${y1 + 16}">p = ${fmtNum(p)}</text>`; }
      else if (!n.pending) {
        const p = parseP(n.p);
        const lvl = Q.toNum(n.w) * G.alpha;
        const can = !manual && isBonf() && T.st.ids.includes(n.id) && isRejectable(T.st, n.id, pOf, G.alpha);
        if (can) { cls.push('can-reject'); aria += ', can be rejected now'; }
        aria += `, local level ${fmtNum(lvl)}`;
        extra += `<text class="ncap lvl" y="${y1}">level ${fmtNum(lvl)}</text>`;
        if (!manual) {
          if (p == null || Number.isNaN(p)) extra += `<text class="ncap" y="${y1 + 16}">no p-value</text>`;
          else if (can) extra += `<text class="ncap ok" y="${y1 + 16}">p = ${fmtNum(p)} \u2713 can reject</text>`;
          else extra += `<text class="ncap" y="${y1 + 16}">p = ${fmtNum(p)}, above level</text>`;
        }
      }
    }
    if (witActive() && !n.rejected) {
      const yw = n.ry + 17 + (mode === 'test' ? 32 : 0);
      if (wit.target === n.id) extra += `<text class="ncap lvl" y="${yw}" style="fill:var(--accent)">\u2192 level would be ${fmtNum(wit.level)}</text>`;
      else if (wit.set.includes(n.id)) extra += `<text class="ncap lvl" y="${yw}" style="fill:var(--flow)">if rejected</text>`;
    }
    const hx = ((n.rx + 6.5) * Math.SQRT1_2).toFixed(1), hy = (-(n.ry + 6.5) * Math.SQRT1_2).toFixed(1);
    P.push(`<g class="${cls.join(' ')}" data-node="${n.id}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})" tabindex="0" role="button" aria-label="${esc(aria)}">` +
      `<ellipse class="node-ring" rx="${n.rx + 6.5}" ry="${n.ry + 6.5}"/><ellipse class="node-body" rx="${n.rx}" ry="${n.ry}"${colored ? ` style="fill:${n.color}"` : ''}/>${lab}` +
      `<text class="nweight${flash ? ' flash' : ''}" y="16"${colored ? ` style="${tcol}opacity:.85"` : ''}>${esc(wt)}</text>${extra}<circle class="handle" cx="${hx}" cy="${hy}" r="7"><title>Drag to another hypothesis, or click then click the target, to add a transition</title></circle></g>`);
  }
  P.push('</g><g class="labels">');
  for (const e of layout) {
    const l = e.label;
    const isSel = mode === 'design' && sel && sel.type === 'edge' && sel.key === e.key;
    const isErr = errRows.has(e.from) || errEdges.has(e.key);
    P.push(`<g class="elabel${isSel ? ' sel' : ''}${isErr ? ' err' : ''}" data-elabel="${e.key}" transform="translate(${l.x.toFixed(1)},${l.y.toFixed(1)})"><rect x="${(-l.w / 2).toFixed(1)}" y="${(-l.h / 2).toFixed(1)}" width="${l.w.toFixed(1)}" height="${l.h}" rx="4"/><text y="4.4">${esc(e.text)}</text></g>`);
    if (isSel && Math.abs(l.t - 0.5) > 0.01) {
      const m = pointAt(e, 0.5);
      P.push(`<circle class="bend-handle" data-bend="${e.key}" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="6.5"/>`);
    }
  }
  P.push('</g>');
  world.innerHTML = P.join('');
  svg.classList.toggle('design', mode === 'design');
  svg.classList.toggle('test', mode === 'test');
  svg.classList.toggle('manual', mode === 'test' && manual);
  svg.classList.toggle('linking', !!linking);
  renderStarter();
  updateHint();
  if (focusedNode) {
    const el = world.querySelector(`[data-node="${focusedNode}"]`);
    if (el) el.focus({ preventScroll: true });
  }
}
function hintText() {
  if (linking) { const n = nodeById(linking.from); return `Click the hypothesis that ${n ? n.label : 'it'} should pass weight to. Press Esc to cancel.`; }
  if (designMessage && mode !== 'test') return designMessage;
  if (mode === 'test') {
    if (T && T.message) return T.message;
    if (T && T.closed) return `Closed test (${TEST_TYPES[testType()]}): rejected hypotheses are greyed out. Reset or Back to Design to change anything.`;
    if (!isBonf() && !manual) return `${TEST_TYPES[testType()]} test: press Run test in the Test panel. Step-by-step rejection applies to the Bonferroni test only.`;
    if (manual) return 'What if mode: click any hypothesis to reject it and watch where its alpha goes. No p-values needed.';
    if (T && (T.done || !T.st.ids.length)) return 'Test finished. Step back or Reset to try a different order; the final result is always the same.';
    if (T && !rejectableIds(T.st, pOf, G.alpha).length) return 'No hypothesis can be rejected yet. Enter p-values in the Test panel, or switch on What if mode.';
    return 'Hypotheses outlined in green can be rejected now. Click one to reject it, in any order, or press Run test.';
  }
  if (!hints || !G.nodes.length) return '';
  if (inline) return 'Type a number such as 0.5 or 1/2, then press Enter. Esc cancels.';
  if (sel && sel.type === 'node') return 'Drag the blue dot onto another hypothesis to add a transition (or click the dot, then the target). Double-click to rename or change the weight.';
  if (sel && sel.type === 'edge') return 'Click the weight label again to change it. Drag the label to bend the arrow. Delete removes it.';
  return G.nodes.some(n => n.p) ? 'Double-click empty space to add a hypothesis; drag the blue dot to connect two. Press Test to see what gets rejected.' : 'Double-click empty space to add a hypothesis; drag the blue dot to connect two. Then enter p-values in the Test tab.';
}
function updateHint() {
  const chip = $('hintChip');
  const t = hintText();
  chip.hidden = !t;
  chip.classList.toggle('test', mode === 'test' || !!linking || !!designMessage);
  $('hintText').textContent = t;
  $('hintClose').hidden = mode === 'test' || !!linking || !!designMessage;
}
function miniSVG(o) {
  const xs = o.nodes.map(n => n.x), ys = o.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 140, H = 58, pad = 9;
  const sc = Math.min((W - 2 * pad) / Math.max(1, maxX - minX), (H - 2 * pad) / Math.max(1, maxY - minY), 0.3);
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const P = o.nodes.map(n => ({ x: ox + (n.x - minX) * sc, y: oy + (n.y - minY) * sc }));
  /* an edge that would run over another node is drawn as an arc above it (the return edges of improved fallback I) */
  const covers = (a, b) => P.some(p => p !== a && p !== b && Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y) < 4 && (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) < 0);
  const e = o.edges.map(r => {
    const a = P[+r.from], b = P[+r.to];
    if (!covers(a, b)) return `<line class="mini-e" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - Math.min(22, Math.hypot(b.x - a.x, b.y - a.y) / 3);
    return `<path class="mini-e" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none"/>`;
  }).join('');
  const nn = P.map(p => `<circle class="mini-n" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${e}${nn}</svg>`;
}
function renderStarter() {
  const show = !G.nodes.length && mode === 'design';
  $('starter').hidden = !show;
  if (!show) return;
  $('starterM').textContent = starterM;
  const cards = [
    ['holm', 'Bonferroni-Holm', 'Equal weights, shared out on rejection', generatedTemplate('holm', starterM)],
    ['fixed', 'Fixed sequence', 'Test in a set order', generatedTemplate('fixed', starterM)],
    ['fallback', 'Fallback', 'Split alpha, pass it down the line', generatedTemplate('fallback', starterM)],
    ['improvedFallbackI', 'Improved fallback I', 'Fallback that returns the last level', generatedTemplate('improvedFallbackI', starterM)],
    ['parallel', 'Parallel gatekeeping', 'Two primary, two secondary', templateJSON('parallel')],
    ['bretz', 'Two doses, two endpoints', 'Maurer et al. (2011)', templateJSON('bretz')]
  ];
  $('starterGrid').innerHTML = cards.map(c => `<button class="start-card" data-start="${c[0]}">${miniSVG(c[3])}<b>${c[1]}</b><span>${c[2]}</span></button>`).join('') +
    '<button class="start-card" data-start="import"><svg viewBox="0 0 140 58" aria-hidden="true"><text x="70" y="38" text-anchor="middle" font-size="22" font-family="monospace" fill="currentColor">c(&hellip;)</text></svg><b>Import from R</b><span>Paste weights and a matrix</span></button>';
  $('starterWeights').hidden = !starterWOpen;
  if (starterWOpen && starterWFor !== starterM) { starterWFor = starterM; $('starterW').value = equalWeightsText(starterM); $('starterWMsg').hidden = true; }
}
function equalWeightsText(m) { return Array.from({ length: m }, () => `1/${m}`).join(', '); }
/* Builds "Improved fallback I for any m" from typed weights. Shows the problem in msgEl and returns false if the text is not usable. */
function createImprovedFallbackI(txt, msgEl) {
  try {
    const w = parseWeightList(txt);
    loadGraph(generatedTemplate('improvedFallbackI', w.length, w));
    msgEl.hidden = true; starterWOpen = false; tplW = null;
    return true;
  } catch (err) { msgEl.hidden = false; msgEl.textContent = '✕ ' + err.message; return false; }
}
/* Opens the weights box: on the start panel when the canvas is empty, otherwise at the top of the Graph panel */
function openImprovedFallbackI() {
  if (!G.nodes.length) {
    starterWOpen = true; starterWFor = starterM; $('starterW').value = equalWeightsText(starterM); $('starterWMsg').hidden = true;
    if (mode === 'test') setMode('design', true);
    renderStarter(); $('starterW').focus(); $('starterW').select();
    return;
  }
  if (mode === 'test') setMode('design', true);
  tplW = { text: equalWeightsText(G.nodes.length), msg: '' };
  setSel(null); setTab('graph'); renderGraphPanel();
  const el = $('tplW'); if (el) { el.focus(); el.select(); }
}

function renderStatus() {
  const el = $('statusBar');
  statusFixes = [];
  if (!G.nodes.length) { el.innerHTML = '<div class="msg"><span class="muted">No hypotheses yet.</span></div>'; return; }
  const ordered = V.filter(m => m.level === 'error').concat(V.filter(m => m.level === 'warn'));
  if (!ordered.length) {
    const ex = isAlphaExhaustive(G);
    el.innerHTML = `<div class="msg ok"><span class="ic" aria-hidden="true">✓</span><span class="txt-part"><b>Valid graph.</b> ${ex === true ? 'Every intersection hypothesis has weights summing to 1, so the procedure is alpha-exhaustive.' : ex === false ? 'The initial weights and rows of G sum to 1, but some intersection hypotheses have weights summing to less than 1, so the procedure is not alpha-exhaustive (this happens when two hypotheses pass their whole level to each other, as the secondary pair in truncated Holm does: once one of them is removed the other has nowhere to send its level).' : 'The weights and every row of G sum to 1, which makes the procedure alpha-exhaustive unless two hypotheses exchange their whole level.'}</span></div>`;
    return;
  }
  el.innerHTML = ordered.map(m => {
    let fix = '';
    if (m.fix && mode === 'design') { statusFixes.push(m.fix); fix = `<button class="btn small fix" data-fix="${statusFixes.length - 1}">${esc(m.fix.label)}</button>`; }
    return `<div class="msg ${m.level}"><span class="ic" aria-hidden="true">${m.level === 'error' ? '✕' : '!'}</span><span class="txt-part"><b>${m.level === 'error' ? 'Error' : 'Warning'}:</b> ${esc(m.text)}</span>${fix}</div>`;
  }).join('');
}

/* ---------- panels ---------- */
function preserveFocus(container, fn) {
  const a = document.activeElement;
  let id = null, s = null, e2 = null;
  if (a && container.contains(a) && a.id) { id = a.id; try { s = a.selectionStart; e2 = a.selectionEnd; } catch (err) { /* no selection */ } }
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      try { if (s != null) el.setSelectionRange(s, e2); } catch (err) { /* not a text field */ }
    }
  }
}
function sumStatus(q) {
  const c = Q.cmp(q, Q.ONE);
  if (c > 0) return { cls: 'error', text: '✕ more than 1' };
  if (c < 0) return { cls: 'warn', text: '! below 1' };
  return { cls: 'ok', text: '✓' };
}

function overviewPanel() {
  const tot = weightSum();
  const rows = G.nodes.map(n => {
    const r = rowSum(n.id), st = sumStatus(r);
    return `<tr><td><button class="btn small" data-action="select-node" data-id="${n.id}">${n.color ? `<span class="dot" style="background:${n.color}"></span>` : ''}${esc(n.label)}</button></td><td>${esc(fmt(n.w))}</td><td>${fmtNum(Q.toNum(n.w) * G.alpha)}</td><td class="sum ${st.cls}">${esc(fmt(r))} ${st.text}</td></tr>`;
  }).join('');
  return `<h2>Graph</h2>
  ${tplW && mode === 'design' ? `<div class="tpl-w"><p class="small"><b>Improved fallback I for any m.</b> Type the initial weights of H1, H2, &hellip; separated by commas. The number of weights sets the number of hypotheses; the last hypothesis returns its level to the others in proportion to these weights. This replaces the current graph (Undo brings it back).</p>
    <div class="row-actions"><input class="txt" id="tplW" value="${esc(tplW.text)}" aria-label="Initial weights" spellcheck="false"><button class="btn small primary" data-action="tpl-w-create">Create</button><button class="btn small" data-action="tpl-w-cancel">Cancel</button></div>
    <p class="err-text" id="tplWMsg"${tplW.msg ? '' : ' hidden'}>${esc(tplW.msg)}</p></div>` : ''}
  ${G.note ? `<p class="note">${esc(G.note)}</p>` : ''}
  ${plain && G.nodes.length ? `<div class="plain">${plainGraphText(G, plainName).map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
  ${G.nodes.length ? `<table class="t"><thead><tr><th scope="col">Hypothesis</th><th scope="col">Weight</th><th scope="col">Level w&alpha;</th><th scope="col">Passed on</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="small muted">Total initial weight ${esc(fmt(tot))}, &alpha; = ${fmtNum(G.alpha)}. Click a hypothesis to edit it.</p>` : '<p class="muted">Add a hypothesis to get started.</p>'}
  ${G.nodes.length > 1 && mode === 'design' ? `<div class="row-actions"><button class="btn small" data-action="equal-w">Give every hypothesis equal weight</button></div>` : ''}
  ${varsSection()}
  ${advanced && mode === 'design' && G.nodes.length ? det('det-build', 'Join or extract', `<p class="small"><b>Join with a template</b> (gMCP joinGraphs): adds a second graph below this one. Weights are rescaled if they then add up to more than 1.</p>
    <div class="row-actions"><select class="sel" id="joinSelect" aria-label="Template to join">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select><button class="btn small" data-action="join">Join</button></div>
    <p class="small"><b>Extract a subgraph</b> (gMCP subgraph): keep only the ticked hypotheses, with the transitions among them.</p>
    <div class="row-actions">${G.nodes.map(n => `<label class="chk"><input type="checkbox" data-keep="${n.id}" checked> ${esc(n.label)}</label>`).join('')}</div>
    <div class="row-actions"><button class="btn small" data-action="subgraph">Keep only ticked</button></div>`) : ''}
  ${det('det-howto', 'How to edit', `<ul class="tips">
    <li><b>Add a hypothesis:</b> double-click empty space, or use + Hypothesis.</li>
    <li><b>Add a transition:</b> drag the blue dot (or the ring) of a hypothesis onto another, or click the dot and then the target. Type the weight and press Enter.</li>
    <li><b>Edit:</b> click a hypothesis or arrow to edit it here. Double-click a hypothesis to rename or reweight it on the canvas; click a selected weight label to change it.</li>
    <li><b>Bend an arrow:</b> drag its weight label.</li>
    <li><b>Remove:</b> select, then press <span class="kbd">Delete</span>. Undo with <span class="kbd">Ctrl</span> <span class="kbd">Z</span>.</li>
  </ul>`)}`;
}
function varsSection() {
  const names = Object.keys(G.vars || {});
  if (!names.length && !advanced) return '';
  const dis = mode === 'test' ? 'disabled' : '';
  const rows = names.map(v => `<tr><th scope="row">${esc(v)}</th><td><input id="var-${esc(v)}" data-var="${esc(v)}" value="${esc(editVal(G.vars[v]))}" ${dis} aria-label="Value of ${esc(v)}"></td><td class="small muted">${esc([...G.nodes.filter(n => n.wexpr && exprVars(n.wexpr).includes(v)).map(n => n.label), ...G.edges.filter(e => e.expr && exprVars(e.expr).includes(v)).map(e => `${nodeById(e.from).label}→${nodeById(e.to).label}`)].join(', '))}</td></tr>`).join('');
  return det('det-vars', 'Variables', `<p class="small muted">Type a letter in any weight, such as <code>ε</code>, <code>1-ε</code> or <code>(1-γ)/2</code> (eps, gamma, delta, nu, tau and omega are recognised), and it becomes a variable listed here. Tests use the values below. ε is evaluated numerically as 1/1000, as gMCP does by default (substituteEps); Bretz et al. (2009) treat ε symbolically, so here a share α/1000 is carried along an ε edge instead of nothing. Exports evaluate the variables too.</p>
    ${names.length ? `<table class="t"><thead><tr><th scope="col">Variable</th><th scope="col">Value</th><th scope="col">Used in</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row-actions"><button class="btn small" data-action="vars-fix" ${dis}>Replace variables with their values</button></div>` : '<p class="small muted">No variables yet.</p>'}`, names.length ? names.map(v => `${v} = ${fmt(G.vars[v])}`).join(', ') : '');
}
function nodePanel(n) {
  const dis = mode === 'test' ? 'disabled' : '';
  const outs = G.edges.filter(e => e.from === n.id);
  const r = rowSum(n.id), st = sumStatus(r);
  const others = G.nodes.filter(x => x.id !== n.id && !edgeOf(n.id, x.id));
  const rem = Q.sub(Q.ONE, r);
  const def = Q.cmp(rem, Q.ZERO) > 0 ? editVal(rem) : '1/2';
  const table = outs.length ? `<table class="t"><thead><tr><th scope="col">To</th><th scope="col">Weight</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody>${outs.map(e => {
    const to = nodeById(e.to);
    return `<tr><td>→ ${esc(to.label)}</td><td><input id="oe-${e.from}-${e.to}" data-edge-input="${gKey(e.from, e.to)}" value="${esc(weightText(e.g, e.expr))}" aria-label="Weight from ${esc(n.label)} to ${esc(to.label)}" ${dis}></td><td><button class="btn small" data-action="remove-edge" data-key="${gKey(e.from, e.to)}" aria-label="Remove transition to ${esc(to.label)}" ${dis}>Remove</button></td></tr>`;
  }).join('')}</tbody></table>`
    : `<p class="muted small">None yet.</p>`;
  const design = mode === 'design';
  return `<div class="row-actions" style="justify-content:space-between;align-items:center"><h2>Hypothesis ${esc(n.label)}</h2><button class="btn small" data-action="deselect">Done</button></div>
  ${design ? '' : '<p class="small muted">Switch to Design mode to change weights or transitions.</p>'}
  <div class="form">
    <label for="node-label">Label<input class="txt" id="node-label" value="${esc(n.label)}" autocomplete="off"></label>
    <label for="node-w">Initial weight <span class="hint">Decimal or fraction, such as 0.25 or 1/3. Local level = weight &times; &alpha;.</span><input class="txt" id="node-w" value="${esc(weightText(n.w, n.wexpr))}" autocomplete="off" ${dis}>${n.wexpr ? `<span class="hint">= ${esc(fmt(n.w))} with ${esc(Object.keys(G.vars).filter(v => exprVars(n.wexpr).includes(v)).map(v => `${v} = ${fmt(G.vars[v])}`).join(', '))}</span>` : ''}</label>
    <label for="node-p">p-value <span class="hint">Used when you test the graph</span><input class="txt" id="node-p" value="${esc(n.p || '')}" inputmode="decimal" autocomplete="off"></label>
  </div>
  ${det('det-ndesc', 'Description and group', `<div class="form">
    <label for="node-desc">Description <span class="hint">Used in plain-language and SAP text, such as "dose 1, primary endpoint"</span><input class="txt" id="node-desc" value="${esc(n.desc || '')}" autocomplete="off"></label>
    <label for="node-group">Group <span class="hint">Such as primary or secondary. Hypotheses in a group are drawn together.</span><input class="txt" id="node-group" value="${esc(n.group || '')}" autocomplete="off"></label>
  </div>`, (n.desc || n.group) ? esc([n.desc, n.group].filter(Boolean).join(', ')) : '')}
  <div class="form"><span style="font-weight:700;font-size:14px">Colour</span>
    <div class="swatches" role="group" aria-label="Colour of ${esc(n.label)}">
      <button class="swatch none" data-color="" aria-label="No colour" title="No colour" aria-pressed="${!n.color}"></button>
      ${PALETTE.map(([nm, c]) => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="${nm}" title="${nm}" aria-pressed="${n.color === c}"></button>`).join('')}
      <label class="swatch custom" title="Pick any colour" aria-pressed="${!!n.color && !PALETTE.some(p => p[1] === n.color)}"><input type="color" id="node-color-custom" value="${n.color || '#cfe3f5'}" aria-label="Pick any colour"></label>
    </div>
    ${G.nodes.length > 1 ? `<div class="row-actions"><button class="btn small" data-action="color-all">Use ${n.color ? 'this colour' : 'no colour'} for every hypothesis</button></div>` : ''}
  </div>
  <h3>When ${esc(n.label)} is rejected, its weight goes to</h3>
  ${table}
  <p class="small sum ${st.cls}">Total passed on: <b>${esc(fmt(r))}</b> ${st.text}</p>
  ${design ? `<div class="row-actions"><button class="btn primary small" data-action="connect" ${others.length ? '' : 'disabled'}>Connect to another hypothesis</button>${outs.length > 1 ? '<button class="btn small" data-action="equal-row">Share equally</button>' : ''}</div>` : ''}
  ${advanced && design && others.length ? det('det-addlist', 'Add a transition from a list', `<div class="row-actions"><select class="sel" id="node-add-to" aria-label="Add a transition to">${others.map(o => `<option value="${o.id}">→ ${esc(o.label)}</option>`).join('')}</select><input class="txt" id="node-add-g" style="width:6em" value="${esc(def)}" aria-label="Weight of new transition"><button class="btn small" data-action="add-edge">Add</button></div><p id="node-add-msg" class="err-text" hidden></p>`) : ''}
  ${design ? '<div class="row-actions"><button class="btn danger" data-action="delete-node">Delete hypothesis</button></div>' : ''}`;
}
function edgePanel(e) {
  const A = nodeById(e.from), B = nodeById(e.to);
  const lay = lastLayout.find(l => l.key === gKey(e.from, e.to));
  const bendNow = Math.round(e.bend != null ? e.bend : (lay ? lay.bend : 0));
  const rev = edgeOf(e.to, e.from);
  return `<div class="row-actions" style="justify-content:space-between;align-items:center"><h2>Transition ${esc(A.label)} → ${esc(B.label)}</h2><button class="btn small" data-action="deselect">Done</button></div>
  <div class="form">
    <label for="edge-g">Weight <span class="hint">Share of ${esc(A.label)}'s level passed to ${esc(B.label)} when ${esc(A.label)} is rejected</span><input class="txt" id="edge-g" value="${esc(weightText(e.g, e.expr))}" autocomplete="off">${e.expr ? `<span class="hint">= ${esc(fmt(e.g))} now. Variables are set in the Graph tab.</span>` : '<span class="hint">A letter such as ε or γ makes it a variable (advanced).</span>'}</label>
  </div>
  <p class="small muted">${esc(A.label)} passes on ${esc(fmt(rowSum(A.id)))} in total.</p>
  ${rev ? `<div class="row-actions"><button class="btn small" data-action="select-edge" data-key="${gKey(e.to, e.from)}">Go to ${esc(B.label)} → ${esc(A.label)}</button></div>` : ''}
  ${det('det-curve', 'Arrow shape', `<label for="edge-bend" class="small"><b>Curvature</b> (or drag the weight label on the canvas)<input type="range" id="edge-bend" min="-160" max="160" step="1" value="${Math.max(-160, Math.min(160, bendNow))}" style="width:100%"></label>
    <div class="row-actions"><button class="btn small" data-action="bend-auto">Automatic</button><button class="btn small" data-action="bend-straight">Straight</button></div>`)}
  <div class="row-actions"><button class="btn danger" data-action="delete-edge">Delete transition</button></div>`;
}
function renderGraphPanel() {
  const el = $('tab-graph');
  preserveFocus(el, () => {
    if (sel && sel.type === 'node' && nodeById(sel.id)) el.innerHTML = nodePanel(nodeById(sel.id));
    else if (sel && sel.type === 'edge' && mode === 'design') {
      const [a, b] = sel.key.split('>');
      const e = edgeOf(a, b);
      el.innerHTML = e ? edgePanel(e) : overviewPanel();
    } else el.innerHTML = overviewPanel();
  });
}

/* ---------- matrix tab ---------- */
function matrixTables(editable, labels, wCells, gCell, wSum, rowSums) {
  const head = labels.map(l => `<th scope="col">${esc(l)}</th>`).join('');
  return `<h3>Weights w</h3>
    <div class="mx-scroll"><table class="mx"><thead><tr><th></th>${head}<th>Sum</th></tr></thead><tbody><tr><th scope="row">w</th>${wCells}<td class="sum ${wSum.cls}">${wSum.html}</td></tr></tbody></table></div>
    <h3>Transition matrix G <span style="text-transform:none;letter-spacing:0;font-weight:400">(row = from, column = to)</span></h3>
    <div class="mx-scroll"><table class="mx"><thead><tr><th></th>${head}<th>Sum</th></tr></thead><tbody>${labels.map((l, i) => `<tr><th scope="row">${esc(l)}</th>${labels.map((_, j) => gCell(i, j)).join('')}<td class="sum ${rowSums[i].cls}">${rowSums[i].html}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderMatrixPanel() {
  const el = $('mx-dyn');
  preserveFocus(el, () => {
    if (!G.nodes.length) { el.innerHTML = '<h2>Matrix view</h2><p class="muted">Add hypotheses on the canvas, or import weights and a matrix below.</p>'; return; }
    if (mode === 'test' && T && mxView === 'current') {
      const ids = G.nodes.map(n => n.id), labels = G.nodes.map(n => n.label);
      const live = id => T.st.ids.includes(id);
      const cellTxt = (txt, muted) => `<td style="text-align:center;padding:6px 8px;${muted ? 'color:var(--rej)' : ''}">${txt}</td>`;
      let tw = Q.ZERO; for (const id of T.st.ids) tw = Q.add(tw, T.st.w.get(id));
      el.innerHTML = `<h2>Matrix view</h2>
        <div class="seg small" role="group" aria-label="Which graph"><button data-action="mx-current" aria-pressed="true">Current graph</button><button data-action="mx-initial" aria-pressed="false">Initial graph</button></div>
        <p class="small muted">After ${T.step} rejection${T.step === 1 ? '' : 's'}. Rejected hypotheses are shown as a dash.</p>` +
        matrixTables(false, labels,
          ids.map(id => live(id) ? cellTxt(esc(fmt(T.st.w.get(id)))) : cellTxt('–', true)).join(''),
          (i, j) => (!live(ids[i]) || !live(ids[j])) ? cellTxt('–', true) : cellTxt(i === j ? '0' : esc(fmt(getg(T.st, ids[i], ids[j])))),
          { cls: '', html: esc(fmt(tw)) },
          ids.map(id => { if (!live(id)) return { cls: '', html: '' }; let r = Q.ZERO; for (const k of T.st.ids) r = Q.add(r, getg(T.st, id, k)); return { cls: '', html: esc(fmt(r)) }; }));
      return;
    }
    const dis = mode === 'test' ? 'disabled' : '';
    const tot = weightSum(), ts = sumStatus(tot);
    const wCells = G.nodes.map(n => {
      const bad = Q.cmp(n.w, Q.ZERO) < 0 || Q.cmp(n.w, Q.ONE) > 0;
      return `<td><input id="mw-${n.id}" data-mw="${n.id}" value="${esc(weightText(n.w, n.wexpr))}" class="${bad ? 'bad' : ''}" aria-label="Initial weight of ${esc(n.label)}" ${dis}></td>`;
    }).join('');
    const gCell = (i, j) => {
      const a = G.nodes[i], b = G.nodes[j];
      if (i === j) {
        const d = G.diag[a.id] || Q.ZERO;
        return `<td><input id="mg-${a.id}-${b.id}" data-mg="${gKey(a.id, b.id)}" value="${esc(editVal(d))}" class="diag${Q.isZero(d) ? '' : ' bad'}" aria-label="Diagonal entry for ${esc(a.label)} (must be 0)" ${dis}></td>`;
      }
      const e = edgeOf(a.id, b.id);
      const bad = e && (Q.cmp(e.g, Q.ZERO) < 0 || Q.cmp(e.g, Q.ONE) > 0);
      return `<td><input id="mg-${a.id}-${b.id}" data-mg="${gKey(a.id, b.id)}" value="${e ? esc(weightText(e.g, e.expr)) : '0'}" class="${bad ? 'bad' : ''}" aria-label="Transition from ${esc(a.label)} to ${esc(b.label)}" ${dis}></td>`;
    };
    const rs = G.nodes.map(n => { const r = rowSum(n.id), st = sumStatus(r); return { cls: st.cls, html: `${esc(fmt(r))} ${st.text}` }; });
    el.innerHTML = `<h2>Matrix view</h2>
      ${mode === 'test' ? '<div class="seg small" role="group" aria-label="Which graph"><button data-action="mx-current" aria-pressed="false">Current graph</button><button data-action="mx-initial" aria-pressed="true">Initial graph</button></div><p class="small muted">Switch to Design mode to edit.</p>' : '<p class="small muted">Edits here and on the canvas stay in sync. Type 0 to remove a transition.</p>'}` +
      matrixTables(true, G.nodes.map(n => n.label), wCells, gCell, { cls: ts.cls, html: `${esc(fmt(tot))} ${ts.text}` }, rs);
  });
}
function initMatrixStatic() {
  $('tab-matrix').innerHTML = `<div id="mx-dyn" class="form"></div>
  <details class="more" id="det-import"><summary>Import from R or plain numbers</summary><div class="det-body" id="mx-import">
    <p class="small muted">Paste R code such as <code>c(1/2, 1/2, 0, 0)</code> and <code>matrix(c(...), nrow = 4, byrow = TRUE)</code>, or plain numbers separated by commas or spaces with one matrix row per line. This replaces the current graph (undo brings it back).</p>
    <label for="imp-w" class="small"><b>Weights</b><textarea class="txt" id="imp-w" rows="2" placeholder="c(1/2, 1/2, 0, 0)"></textarea></label>
    <label for="imp-g" class="small"><b>Transition matrix</b><textarea class="txt" id="imp-g" rows="5" placeholder="matrix(c(0, 1/2, 1/2, 0,&#10;  1/2, 0, 0, 1/2,&#10;  0, 1, 0, 0,&#10;  1, 0, 0, 0), nrow = 4, byrow = TRUE)"></textarea></label>
    <label for="imp-names" class="small"><b>Names</b> <span class="muted">(optional, such as c("H1", "H2", "H3", "H4"))</span><input class="txt" id="imp-names" autocomplete="off"></label>
    <div class="row-actions"><button class="btn primary" data-action="import">Build graph</button><button class="btn" data-action="import-current">Fill in the current graph</button></div>
    <div id="imp-msg" aria-live="polite"></div>
  </div></details>`;
}
function autoPositions(m) {
  if (m > 8) return circlePositions(m);
  const pos = [];
  if (m <= 3) { for (let i = 0; i < m; i++) pos.push({ x: i * 240, y: 0 }); return pos; }
  const cols = Math.ceil(m / 2);
  for (let i = 0; i < m; i++) pos.push(i < cols ? { x: i * 240, y: 0 } : { x: (i - cols) * 240, y: 200 });
  return pos;
}
function doImport() {
  const msg = $('imp-msg');
  try {
    const wsrc = $('imp-w').value, gsrc = $('imp-g').value;
    if (!wsrc.trim()) throw new Error('Paste the weight vector first.');
    const wv = parseVector(wsrc);
    const m = wv.values.length;
    if (!m) throw new Error('No weights found.');
    if (m > 40) throw new Error('That is more than 40 hypotheses. This tool is built for smaller graphs.');
    let rows, notes = [];
    if (gsrc.trim()) ({ rows, notes } = parseMatrix(gsrc, m));
    else { rows = Array.from({ length: m }, () => Array(m).fill(Q.ZERO)); notes = ['No matrix given, so no transitions were added.']; }
    let names = wv.names;
    const nsrc = $('imp-names').value;
    if (nsrc.trim()) {
      names = parseNames(nsrc);
      if (names.length !== m) throw new Error(`${names.length} names given for ${m} hypotheses.`);
    }
    if (!names) names = wv.values.map((_, i) => 'H' + (i + 1));
    const pos = autoPositions(m);
    const o = {
      alpha: G.alpha, note: '',
      nodes: names.map((nm, i) => ({ id: String(i), label: nm || 'H' + (i + 1), weight: Q.exact(wv.values[i]), x: pos[i].x, y: pos[i].y, p: '' })),
      edges: [], diag: []
    };
    rows.forEach((r, i) => r.forEach((v, j) => {
      if (Q.isZero(v)) return;
      if (i === j) o.diag.push({ id: String(i), weight: Q.exact(v) });
      else o.edges.push({ from: String(i), to: String(j), weight: Q.exact(v), bend: null });
    }));
    loadGraph(o);
    msg.innerHTML = `<p class="ok-text">✓ Built a graph with ${m} hypotheses. ${esc(notes.join(' '))}</p>`;
  } catch (err) {
    msg.innerHTML = `<p class="err-text" role="alert">✕ ${esc(err.message)}</p>`;
  }
}
function openImport() {
  if (!advanced) setAdvanced(true);
  setTab('matrix');
  openDetails.add('det-import');
  $('det-import').open = true;
  $('imp-w').focus();
}

/* ---------- test mode ---------- */
/* Completed p-value runs, kept to show that the order of rejection does not
   change the result. Cleared whenever the graph, alpha or p-values change. */
let orderRuns = [];
let orderSig = '';
function testSig() { return simSig() + '|' + G.nodes.map(n => n.p || '').join(',') + '|' + JSON.stringify(serializeTest(G.test) || ''); }
function testType() { return (G.test || defaultTest()).type; }
function isBonf() { return testType() === 'bonferroni'; }
function testCorrAt(i, j) { const a = G.nodes[i].id, b = G.nodes[j].id; const v = G.test.corr[a < b ? a + '|' + b : b + '|' + a]; return v == null ? null : v; }
function testCtx() {
  const groups = [...new Set(G.nodes.map(n => n.group).filter(Boolean))].map(g => new Set(G.nodes.map((n, i) => (n.group === g ? i : -1)).filter(i => i >= 0)));
  return { upscale: !!G.test.upscale, corrAt: testCorrAt, groups, rand: mulberry32(2011), cache: new Map() };
}
function corrProblem() {
  if (testType() !== 'parametric') return '';
  if (G.sided === 'two') return 'The parametric test needs one-sided p-values: it assumes that Φ⁻¹(1 − p) is multivariate normal, which does not hold for two-sided p-values (gMCP manual). Switch the p-values to one-sided in the toolbar, or choose another test.';
  let blocks;
  try { blocks = corrBlocks(G.nodes.map((_, i) => i), testCorrAt); } catch (e) { return e.message; }
  for (const b of blocks) { const bad = corrConflict(b, testCorrAt); if (bad) return corrConflictText(bad.map(i => G.nodes[i].label), bad.length === b.length); }
  const known = Object.keys(G.test.corr).length;
  if (!known) return 'No correlations are entered, so the parametric test is the same as Bonferroni. Enter the known correlations below.';
  return '';
}
function newTest() { return { st: stateFromGraph(G), rejected: new Map(), order: [], pending: null, step: 0, log: [], done: false, running: false, history: [], redo: [], message: '', whatIfUsed: false, picked: false }; }
function resetTest() { if (mode === 'test') T = newTest(); }
function setMode(m, silent) {
  if (animating || m === mode) return;
  closeInline(false); linking = null; overlay.innerHTML = '';
  mode = m;
  if (m === 'test') {
    T = newTest(); mxView = 'current'; tplW = null;
    if (sel) sel = null;
    if (activeTab !== 'matrix') setTab('test');
  } else { T = null; manual = false; if (presenting) { presenting = false; document.body.classList.remove('present'); $('presentBar').hidden = true; } }
  if (!silent) renderAll();
  /* the hint text changes with the mode; on a phone, refit so it does not cover the graph */
  if (autoFit && narrowScreen()) requestAnimationFrame(fitView);
}
function setWhatIf(on) {
  if (animating || (T && T.running)) return;
  manual = on;
  if (mode !== 'test') setMode('test', true);
  T = newTest();
  renderAll();
}
function pOf(id) { const n = nodeById(id); return n ? parseP(n.p) : null; }
function stopText() {
  const left = T.st.ids.map(id => nodeById(id));
  if (!left.length) return 'Stopped: every hypothesis is rejected.';
  const noP = left.filter(n => parseP(n.p) == null || Number.isNaN(parseP(n.p)));
  let s = `Stopped: no remaining hypothesis has p ≤ its local level. Not rejected: ${left.map(n => n.label).join(', ')}.`;
  if (noP.length) s += ` No valid p-value for ${noP.map(n => n.label).join(', ')}.`;
  return s;
}
function hasErrors() { return V.some(m => m.level === 'error'); }
function recordOrderRun() {
  if (!T || manual || T.whatIfUsed) return;
  if (orderSig !== testSig()) { orderRuns = []; orderSig = testSig(); }
  const key = T.order.join('>');
  if (orderRuns.some(r => r.key === key)) return;
  orderRuns.push({ key, order: T.order.slice(), final: T.order.slice().sort().join(','), how: T.picked ? 'your order' : 'Run test / Step' });
}
async function stepOnce(fast) {
  if (!T || animating || T.done || hasErrors() || manual || !isBonf() || T.closed) return false;
  const c = findCandidate(T.st, pOf, G.alpha);
  if (!c) { T.done = true; T.log.push({ stop: true, text: stopText() }); recordOrderRun(); renderAll(); return false; }
  await doReject(c.id, { p: c.p, level: c.level, how: 'auto' }, fast);
  return true;
}
async function runAllSteps() {
  if (!isBonf()) { runClosed(); return; }
  if (mode !== 'test') setMode('test');
  if (!T || animating || hasErrors() || manual) return;
  T.running = true; renderTestPanel();
  while (T && !T.done && await stepOnce(true)) await sleep(reduced() ? 0 : 140);
  if (T) { T.running = false; renderTestPanel(); updateToolbar(); }
}
let msgTimer = null;
let designMessage = ''; // a transient message shown on the canvas when there is no test in progress
function flashMessage(t) {
  if (T) T.message = t; else designMessage = t;
  updateHint();
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { if (T) T.message = ''; designMessage = ''; updateHint(); }, 6000);
}
/* A click on a hypothesis in Test mode: reject it if allowed, otherwise say why not */
function tryReject(id) {
  if (!T || animating || T.running || !T.st.ids.includes(id)) return;
  if (manual) {
    if (T.done) { T.done = false; if (T.log.length && T.log[T.log.length - 1].stop) T.log.pop(); }
    doReject(id, { manual: true }, false);
    return;
  }
  if (hasErrors()) return;
  if (!isBonf()) { flashMessage(`${TEST_TYPES[testType()]} runs as a closed test: press Run test. Step-by-step rejection applies to the Bonferroni test.`); return; }
  const n = nodeById(id), p = parseP(n.p), lvl = Q.toNum(T.st.w.get(id) || Q.ZERO) * G.alpha;
  if (isRejectable(T.st, id, pOf, G.alpha)) { doReject(id, { p, level: lvl, how: 'click' }, false); return; }
  if (p == null || Number.isNaN(p)) flashMessage(`${n.label} has no p-value yet. Enter one in the Test panel, or switch on What if.`);
  else if (lvl === 0) flashMessage(`${n.label} can't be rejected yet: it has no alpha at the moment (level 0). It only gets some when a hypothesis that passes alpha to it is rejected.`);
  else flashMessage(`${n.label} can't be rejected yet: p = ${fmtNum(p)} is above its current level ${fmtNum(lvl)}. See "What would it take?" in the Test panel.`);
}
function stepBack() {
  if (!T || animating || T.running || !T.history.length) return;
  const h = T.history.pop();
  T.redo.push({ id: h.id, info: h.info });
  Object.assign(T, { st: h.st, rejected: h.rejected, order: h.order, step: h.step, done: h.done, whatIfUsed: h.whatIfUsed, picked: h.picked, message: '' });
  T.log = T.log.slice(0, h.logLen);
  renderAll();
}
async function redoStep() {
  if (!T || animating || T.running || !T.redo.length) return;
  const r = T.redo.pop();
  if (!T.st.ids.includes(r.id)) { T.redo = []; updateToolbar(); return; }
  await doReject(r.id, r.info, false, true);
}
async function doReject(id, info, fast, fromRedo) {
  animating = true; T.message = '';
  const before = T.st, after = rejectNode(before, id);
  T.history.push({ st: before, rejected: new Map(T.rejected), order: T.order.slice(), step: T.step, logLen: T.log.length, done: T.done, whatIfUsed: T.whatIfUsed, picked: T.picked, id, info });
  if (!fromRedo) T.redo = [];
  updateToolbar(); renderTestPanel();
  const wj = before.w.get(id) || Q.ZERO;
  T.pending = id; T.flashEdges = null; T.flashNodes = null;
  renderCanvas();
  if (!reduced()) await animateFlow(id, before, wj, fast);
  if (!T) { animating = false; return; }
  T.step += 1;
  T.rejected.set(id, { step: T.step, w: wj });
  T.order.push(id);
  if (info.manual) T.whatIfUsed = true;
  if (info.how === 'click') T.picked = true;
  T.pending = null; T.st = after;
  T.flashNodes = new Set(after.ids.filter(l => !Q.eq(after.w.get(l), before.w.get(l))));
  T.flashEdges = new Set([...after.g.keys()].filter(k => !before.g.get(k) || !Q.eq(before.g.get(k), after.g.get(k))));
  const n = nodeById(id);
  const lvl = Q.toNum(wj) * G.alpha;
  const gave = before.ids.filter(l => l !== id && !Q.isZero(getg(before, id, l)) && !Q.isZero(wj))
    .map(l => `+${fmt(Q.mul(wj, getg(before, id, l)))} to ${nodeById(l).label}`);
  let text;
  if (info.manual) {
    const p = parseP(n.p);
    text = `What if: rejected ${n.label} (weight ${fmt(wj)}, level ${fmtNum(lvl)}${p != null && !Number.isNaN(p) ? `, p = ${fmtNum(p)}` : ''}).`;
  } else {
    text = `Rejected ${n.label}${info.how === 'click' ? ' (your choice)' : ''}: p = ${fmtNum(info.p)} ≤ ${fmt(wj)} × ${fmtNum(G.alpha)} = ${fmtNum(info.level)}.`;
  }
  const now = after.ids.length ? 'Weights now: ' + after.ids.map(l => `${nodeById(l).label} ${fmt(after.w.get(l))} (level ${fmtNum(Q.toNum(after.w.get(l)) * G.alpha)})`).join(', ') + '.' : '';
  T.log.push({ text, gave: gave.length ? 'Passed on: ' + gave.join(', ') + '.' : (Q.isZero(wj) ? '' : 'No outgoing arrows, so its weight is not passed on.'), now,
    data: { label: n.label, p: info.p, level: lvl, manual: !!info.manual, wj, gave: before.ids.filter(l => l !== id && !Q.isZero(getg(before, id, l)) && !Q.isZero(wj)).map(l => [nodeById(l).label, Q.mul(wj, getg(before, id, l))]), now: after.ids.map(l => [nodeById(l).label, Q.toNum(after.w.get(l)) * G.alpha]) } });
  if (!T.st.ids.length) { T.done = true; T.log.push({ stop: true, text: 'Stopped: every hypothesis is rejected.' }); recordOrderRun(); }
  else if (!manual && !rejectableIds(T.st, pOf, G.alpha).length) { T.done = true; T.log.push({ stop: true, text: stopText() }); recordOrderRun(); }
  animating = false;
  renderAll();
  if (T) { T.flashNodes = null; T.flashEdges = null; }
}
function animateFlow(j, before, wj, fast) {
  return new Promise(resolve => {
    const ns = 'http://www.w3.org/2000/svg';
    const items = [];
    for (const l of before.ids) {
      if (l === j) continue;
      const g = getg(before, j, l);
      if (Q.isZero(g) || Q.isZero(wj)) continue;
      const path = world.querySelector(`[data-edge="${j}>${l}"] .edge-line`);
      if (!path) continue;
      const c = document.createElementNS(ns, 'circle'); c.setAttribute('r', '7'); c.setAttribute('class', 'flow-dot'); c.style.opacity = '0';
      const t = document.createElementNS(ns, 'text'); t.setAttribute('class', 'flow-text'); t.textContent = '+' + fmt(Q.mul(wj, g)); t.style.opacity = '0';
      overlay.append(c, t);
      items.push({ path, len: path.getTotalLength(), c, t });
    }
    const wait = fast ? 180 : 420, dur = fast ? 520 : 950;
    const t0 = performance.now() + wait;
    if (!items.length) { setTimeout(resolve, wait + (fast ? 120 : 250)); return; }
    function frame(now) {
      const f = Math.max(0, Math.min(1, (now - t0) / dur));
      const ez = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      for (const it of items) {
        const p = it.path.getPointAtLength(ez * it.len);
        it.c.setAttribute('cx', p.x); it.c.setAttribute('cy', p.y);
        it.t.setAttribute('x', p.x + 11); it.t.setAttribute('y', p.y - 10);
        const op = now < t0 ? '0' : '1';
        it.c.style.opacity = op; it.t.style.opacity = op;
      }
      if (f < 1) requestAnimationFrame(frame);
      else setTimeout(() => { overlay.innerHTML = ''; resolve(); }, fast ? 60 : 150);
    }
    requestAnimationFrame(frame);
  });
}
function allPValid() { return G.nodes.length && G.nodes.every(n => { const p = parseP(n.p); return p != null && !Number.isNaN(p); }); }
/* ---------- closed test for Simes and parametric tests ---------- */
async function runClosed() {
  if (ctRunning || animating || hasErrors()) return;
  const prob = corrProblem();
  if (prob && !/same as Bonferroni/.test(prob)) { flashMessage(prob); renderTestPanel(); return; }
  const p = G.nodes.map(n => parseP(n.p));
  if (p.some(x => x == null || Number.isNaN(x))) { flashMessage('Enter a p-value for every hypothesis first: the closed test needs all of them.'); renderTestPanel(); return; }
  if (G.nodes.length > 12) { flashMessage('The closed test is available for up to 12 hypotheses.'); renderTestPanel(); return; }
  if (mode !== 'test') setMode('test', true);
  T = newTest(); T.closed = true;
  ctRunning = { done: 0, total: 1 };
  renderAll();
  const t0 = performance.now();
  try {
    const r = await closedTestAsync(floatGraph(G), p, G.alpha, testType(), testCtx(), (d, t) => { ctRunning = { done: d, total: t }; const el = $('ctProgress'); if (el) el.textContent = `Working out the closed test: ${Math.round(100 * d / t)}%`; });
    CT = { sig: testSig(), adj: r.adj, subsets: r.subsets, rejected: r.rejected, type: testType(), se: r.se, ms: performance.now() - t0 };
    ctRunning = null;
    if (!T || !T.closed) return;
    const rej = G.nodes.filter((n, i) => r.rejected[i]);
    rej.forEach(n => { T.rejected.set(n.id, { step: 1, w: n.w }); });
    T.st = { ids: G.nodes.filter(n => !T.rejected.has(n.id)).map(n => n.id), w: new Map(G.nodes.map(n => [n.id, n.w])), g: stateFromGraph(G).g };
    T.step = rej.length ? 1 : 0; T.done = true;
    T.log.push({ text: `${TEST_TYPES[testType()]} closed test at α = ${fmtNum(G.alpha)}: rejected ${rej.length ? rej.map(n => n.label).join(', ') : 'nothing'}.`, gave: `Adjusted p-values: ${G.nodes.map((n, i) => `${n.label} ${fmtNum(r.adj[i])}`).join(', ')}.` });
    renderAll();
  } catch (err) {
    ctRunning = null;
    if (T) T.closed = false;
    flashMessage('Closed test failed: ' + err.message);
    renderAll();
  }
}
function closedSection(inTest) {
  const m = G.nodes.length;
  if (!m) return '';
  if (CT && CT.sig === testSig()) {
    const adjRows = G.nodes.map((n, i) => `<tr><th scope="row">${esc(n.label)}</th><td class="num">${fmtNum(parseP(n.p))}</td><td class="num">${fmtNum(CT.adj[i])}</td><td>${CT.rejected[i] ? '<span class="status-cell rej">✓ Rejected</span>' : '✕ Not rejected'}</td></tr>`).join('');
    let h = det('det-adj', 'Adjusted p-values', `<p class="small muted">${TEST_TYPES[CT.type]} closed test. A hypothesis is rejected at level &alpha; exactly when its adjusted p-value is at most &alpha;.${CT.type === 'parametric' ? ` Parametric values come from randomised quasi-Monte Carlo integration of the multivariate normal distribution (Genz and Bretz, 2009; 512 lattice points, 12 random shifts)${CT.se != null ? `; the largest Monte Carlo standard error of an intersection p-value in this run is ${fmtNum(CT.se, 2)}` : ''}.` : ''}</p>
      <table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">p</th><th scope="col" class="num">Adjusted p</th><th scope="col">At &alpha; = ${fmtNum(G.alpha)}</th></tr></thead><tbody>${adjRows}</tbody></table>`);
    if (advanced && m <= 8) {
      const lab = mask => G.nodes.filter((_, i) => mask & (1 << i)).map(n => n.label).join(' ∩ ');
      const rows = CT.subsets.slice().sort((a, b) => popcount(b.mask) - popcount(a.mask) || a.mask - b.mask).map(sj => `<tr><td>${esc(lab(sj.mask))}</td><td class="num">${sj.w.map((w, i) => (sj.mask & (1 << i) ? fmtNum(w, 3) : '·')).join(' ')}</td><td class="num">${fmtNum(sj.adjP)}</td><td>${sj.adjP <= G.alpha * (1 + 1e-9) ? '✓' : '✕'}</td></tr>`).join('');
      h += det('det-closure', 'Closed test details', `<p class="small muted">Every intersection hypothesis with its weights (in hypothesis order) and the smallest level at which it is rejected. An elementary hypothesis is rejected when every intersection containing it is rejected.</p>
        <div class="mx-scroll"><table class="t"><thead><tr><th scope="col">Intersection</th><th scope="col" class="num">Weights</th><th scope="col" class="num">Adjusted p</th><th scope="col">At &alpha;</th></tr></thead><tbody>${rows}</tbody></table></div>`, `${CT.subsets.length} intersections`);
    }
    return h;
  }
  return '';
}
/* Warnings for closed tests (Simes, Simes within groups, parametric), shown above the p-value table. */
function closedWarnings() {
  const out = [];
  if (G.nodes.length > 1 && isAlphaExhaustive(G) === false) out.push(`This graph is not &alpha;-exhaustive. With a closed test, a hypothesis can then be rejected even when the hypotheses that pass &alpha; to it are not. The order of testing that the graph shows is not guaranteed.${G.test.upscale ? ' Upscaling the weights also changes the procedure from the one the graph shows.' : ''}`);
  if (G.sided === 'two' && testType() !== 'parametric') out.push('Two-sided p-values: the closed test controls the two-sided error rate, but not a one-sided rate of &alpha;/2 for claims of benefit. For claims of benefit, set the p-values to one-sided in the toolbar and halve &alpha;.');
  const neg = simesNegatives();
  if (neg.length) {
    const fmtR = v => String(v).replace('-', '−');
    const allSame = !SIM.useMatrix && neg.length > 1 && neg.every(x => x.where === 'Power tab');
    const what = allSame ? `The Power tab correlation is ${fmtR(neg[0].v)} for every pair.` : `Negative correlation entered: ${neg.slice(0, 3).map(x => `${esc(x.a)} and ${esc(x.b)}, ${fmtR(x.v)} (${x.where})`).join('; ')}${neg.length > 3 ? `; and ${neg.length - 3} more` : ''}.`;
    out.push(`${what} The weighted Simes test needs non-negative correlations between the test statistics. With negative correlations it can exceed &alpha; (Samuel-Cahn, 1996). Check the values, or use the Bonferroni or parametric test.`);
  }
  return out.map(t => `<p class="warn-line" data-warn="closed"><span class="ic" aria-hidden="true">!</span><span><b>Warning:</b> ${t}</span></p>`).join('');
}
function testTypeSection() {
  const t = G.test, type = t.type;
  const groups = [...new Set(G.nodes.map(n => n.group).filter(Boolean))];
  let body = `<label for="testType" class="small"><b>Test for each intersection hypothesis</b><select class="sel" id="testType" style="max-width:none">${Object.entries(TEST_TYPES).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
  if (type === 'bonferroni') body += '<p class="small muted">Weighted Bonferroni tests: the graph can be run step by step (the shortcut of Bretz et al., 2009). No assumption about the correlation between the tests; the p-values only need to be valid (one-sided or two-sided).</p>';
  else if (type === 'simes') body += '<p class="small muted">Weighted Simes test for every intersection (Bretz et al., 2011, section 3.3). Never less powerful than Bonferroni, but it controls the error rate only if the test statistics are positively regression dependent (PRDS), for example one-sided tests with multivariate normal statistics and non-negative correlations (Bretz et al., 2011, section 3.3; Benjamini and Heller, 2007); under negative dependence it can exceed the level (Samuel-Cahn, 1996; Brannath et al., 2009). Run as a closed test, since the closed Simes test is not consonant for more than two hypotheses (Hommel et al., 2007), so there is no step-by-step view.</p>';
  else if (type === 'simes-groups') body += `<p class="small muted">Weighted Simes test when every hypothesis of an intersection belongs to the same group, plain weighted Bonferroni otherwise (gMCP's <code>simes.on.subsets.test</code>). This is weaker than Simes within each group with Bonferroni between groups (Bretz et al., 2011, eq. 8), which graphicalMCP uses; the Simes condition then only has to hold within a group. ${groups.length ? `Groups: ${groups.map(esc).join(', ')}.` : 'No groups are set: give each hypothesis a group in its panel.'}</p>`;
  else {
    const prob = corrProblem();
    body += `<p class="small muted">Weighted parametric test (Xi et al., 2017, section 4.3, eq. 6): within each block of hypotheses with known correlations the test uses the multivariate normal distribution of the one-sided test statistics, with a separate constant for each block, and blocks are combined by Bonferroni. gMCP uses one common constant for all blocks instead (Bretz et al., 2011, eq. 3), so its results can differ slightly. It assumes that Φ⁻¹(1 − p) is multivariate normal under the null with the correlations entered here, so the p-values must be one-sided. Leave a pair blank when its correlation is unknown; known pairs must form complete blocks.</p>
      <p class="small muted">${CORR_WHAT_TO_ENTER}</p>
      ${prob ? `<p class="${/same as Bonferroni/.test(prob) ? 'small muted' : 'err-text'}">${/same as Bonferroni/.test(prob) ? '' : '✕ '}${esc(prob)}</p>` : ''}
      <div class="mx-scroll"><table class="mx"><thead><tr><th></th>${G.nodes.map(n => `<th scope="col">${esc(n.label)}</th>`).join('')}</tr></thead><tbody>${G.nodes.map((a, i) => `<tr><th scope="row">${esc(a.label)}</th>${G.nodes.map((b, j) => j <= i ? `<td style="text-align:center;color:var(--muted)">${j === i ? '1' : ''}</td>` : `<td><input id="tc-${a.id}-${b.id}" data-tcorr="${a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id}" value="${testCorrAt(i, j) == null ? '' : esc(String(testCorrAt(i, j)))}" placeholder="?" aria-label="Correlation between ${esc(a.label)} and ${esc(b.label)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="row-actions" style="align-items:center"><label class="small" for="tcFill">Fill every pair with</label><input class="txt" id="tcFill" value="0.5" style="width:5em"><button class="btn small" data-action="tc-fill">Fill</button><button class="btn small" data-action="tc-clear">Clear all</button>${G.nodes.length > 1 ? '<button class="btn small" data-action="tc-from-sim">Copy from the power simulation</button>' : ''}</div>`;
  }
  body += `<label class="chk small" style="align-items:flex-start"><input type="checkbox" id="upscaleToggle" ${t.upscale ? 'checked' : ''}> <span>Upscale weights: test each intersection at the full &alpha; even when its weights sum to less than 1 (gMCP's upscale = TRUE; for the parametric test, Xi et al., 2017, section 4.2). Off, each intersection is tested at &alpha; times the sum of its weights (gMCP's default, and what Xi et al., 2017, recommend). On a graph that is not alpha-exhaustive, upscaling changes the procedure and can undo its gatekeeping. Applies to the closed tests, not to the step-by-step Bonferroni graph.</span></label>`;
  return det('det-testtype', 'Test type', body, TEST_TYPES[type] + (t.upscale ? ', upscaled' : ''));
}
function orderSection() {
  if (orderSig !== testSig()) { orderRuns = []; orderSig = testSig(); }
  if (!orderRuns.length || manual) return '';
  const lab = id => (nodeById(id) || {}).label || '?';
  let analysis = '';
  if (G.nodes.length <= 14) {
    const r = orderAnalysis(stateFromGraph(G), pOf, G.alpha);
    if (!r.capped) {
      const fin = r.finals.map(f => f.map(lab).sort().join(', ') || 'none');
      analysis = r.finals.length === 1
        ? `<p>With these p-values the hypotheses can be rejected in <b>${r.orders} different order${r.orders === 1n ? '' : 's'}</b>, and ${r.orders === 1n ? 'it ends' : 'every one of them ends'} with the same result: <b>${esc(fin[0])}</b> rejected.</p>`
        : `<p class="err-text">✕ Different orders give different results (${fin.map(esc).join(' / ')}). This should not happen for a valid graph; please report it.</p>`;
    }
  }
  const same = orderRuns.every(r => r.final === orderRuns[0].final);
  return det('det-order', 'Does the order of rejection matter?', `<p class="small">No. Run test and Step choose, at each step, the hypothesis whose p-value is smallest compared with its level, but any order you choose ends with the same rejections (Bretz et al., 2009).</p>
    ${analysis}
    <table class="t"><thead><tr><th scope="col">Order tried</th><th scope="col">Rejected at the end</th></tr></thead><tbody>${orderRuns.map(r => `<tr><td>${r.order.map(lab).map(esc).join(' → ') || 'none'}<br><span class="small muted">${esc(r.how)}</span></td><td>${r.final ? r.final.split(',').map(lab).sort().map(esc).join(', ') : 'none'}</td></tr>`).join('')}</tbody></table>
    ${orderRuns.length > 1 ? `<p class="${same ? 'ok-text' : 'err-text'}">${same ? '✓ Same result every time.' : '✕ The results differ.'}</p>` : ''}
    <div class="row-actions"><button class="btn small" data-action="try-order">Try another order</button></div>`, `${orderRuns.length} tried`);
}
function plainName(id, full) { const n = nodeById(id); if (!n) return '?'; return full && n.desc ? `${n.label} (${n.desc})` : n.label; }
function plainSection() {
  if (!G.nodes.length) return '';
  const inTest = mode === 'test' && T;
  let body = plainGraphText(G, plainName).map(t => `<p>${esc(t)}</p>`).join('');
  if (inTest) {
    const steps = T.log.filter(l => l.data);
    if (steps.length) body += `<p><b>What has happened so far</b></p><ol class="log">${steps.map(l => `<li>${esc(plainStepText(l.data, G.alpha))}</li>`).join('')}</ol>`;
    const open = T.st.ids;
    if (T.closed) {
      const name = TEST_TYPES[testType()];
      body += `<p><b>How this was checked</b></p><p>${esc(ctRunning ? 'The closed test is still being worked out.' : `Every combination of questions was checked with the ${name} test, and a question is confirmed only when every combination that includes it is rejected. The shares shown are the starting shares; they are not compared with the p-values one question at a time, so the step-by-step picture does not apply here.`)}</p>`;
    } else if (open.length && !(T.done && !open.length)) {
      const lines = open.map(id => {
        const n = nodeById(id), lvl = Q.toNum(T.st.w.get(id) || Q.ZERO) * G.alpha, p = parseP(n.p);
        if (manual) return `${n.label} has a share of ${pctWords(lvl)}.`;
        if (p == null || Number.isNaN(p)) return `${n.label} has a share of ${pctWords(lvl)}; no p-value has been entered for it.`;
        if (isRejectable(T.st, id, pOf, G.alpha)) return `${n.label} can be claimed now: its p-value ${fmtNum(p)} is within its share of ${pctWords(lvl)}.`;
        let t = lvl === 0 ? `${n.label} has no share yet, so it cannot be claimed whatever its p-value (${fmtNum(p)}).` : `${n.label} cannot be claimed yet: its p-value ${fmtNum(p)} is bigger than its share of ${pctWords(lvl)}.`;
        if (open.length <= 11) {
          const r = whatWouldItTake(T.st, id, pOf, G.alpha, 10);
          if (!r.tooMany && r.minimal && r.minimal.length) t += ` It could be claimed if ${joinWords(r.minimal[0].set.map(j => nodeById(j).label))} ${r.minimal[0].set.length > 1 ? 'succeed' : 'succeeds'} first, which would raise its share to ${pctWords(r.minimal[0].level)}.`;
          else if (!r.tooMany && r.minimal && !r.minimal.length) t += ` No other successes could raise its share enough.`;
        }
        return t;
      });
      body += `<p><b>Where things stand</b></p><ul class="tips">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
    }
    if (T.done || !open.length) {
      const rej = G.nodes.filter(n => T.rejected.has(n.id)).map(n => n.label), not = G.nodes.filter(n => !T.rejected.has(n.id)).map(n => n.label);
      body += `<p><b>Result:</b> ${rej.length ? `${joinWords(rej)} ${rej.length > 1 ? 'are' : 'is'} confirmed as ${rej.length > 1 ? 'successes' : 'a success'}` : 'no question is confirmed'}${not.length ? `; ${joinWords(not)} ${not.length > 1 ? 'are' : 'is'} not` : ''}.</p>`;
    }
  }
  return `<div class="plain">${body}</div>`;
}
function witActive() { return !!wit && wit.sig === testSig() && wit.step === (T ? T.step : -1); }
function witSection() {
  const st = (mode === 'test' && T) ? T.st : stateFromGraph(G);
  if (!st.ids.length || hasErrors()) return '';
  const lab = id => (nodeById(id) || {}).label || '?';
  const list = ids => { const l = ids.map(lab); return l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]; };
  const m = st.ids.length;
  const intro = '<p class="small muted">For each open hypothesis: its level now, the highest level it could reach, and the smallest sets of other rejections that would make it rejectable with its p-value.</p>';
  if (m - 1 > 13) return det('det-wit', 'What would it take?', intro + `<p class="small">With ${m} hypotheses still open there are too many combinations to check (more than 8,000 per hypothesis). This view works for up to 14 open hypotheses.</p>`);
  if (m - 1 > 10 && !witForce) return det('det-wit', 'What would it take?', intro + `<p class="small">With ${m} hypotheses still open there are ${(2 ** (m - 1)).toLocaleString('en-GB')} sets to check for each one, which may take a few seconds.</p><div class="row-actions"><button class="btn small" data-action="wit-force">Work it out anyway</button></div>`);
  const final = manual ? null : new Set(runProcedure(st, pOf, G.alpha).order);
  const cards = st.ids.map(id => {
    const r = whatWouldItTake(st, id, pOf, G.alpha, 13);
    const p = r.p, hasP = p != null && Number.isFinite(p);
    const nowTxt = `level now <b>${fmtNum(r.now.level)}</b>${hasP ? `, p = <b>${fmtNum(p)}</b>` : ', no p-value'}`;
    const bestTxt = r.best.set.length === 0 ? 'It is already at its highest possible level.' : `Highest level it could reach: <b>${fmtNum(r.best.level)}</b>, if ${list(r.best.set)} ${r.best.set.length > 1 ? 'are' : 'is'} rejected.`;
    const showBtn = (set, label, level) => `<button class="btn small" data-action="wit-show" data-target="${id}" data-set="${set.join(',')}" data-level="${level}">${label}</button>`;
    let body = '';
    if (!hasP) {
      body = `<p class="small">It would need p ≤ ${fmtNum(r.now.level)} now${r.best.set.length ? `, or p ≤ ${fmtNum(r.best.level)} at best` : ''}. ${bestTxt}</p>`;
      if (r.best.set.length) body += `<div class="row-actions">${showBtn(r.best.set, 'Show on canvas', r.best.level)}</div>`;
    } else if (isRejectable(st, id, pOf, G.alpha)) {
      body = `<p class="small ok-text">✓ Can be rejected now: p = ${fmtNum(p)} ≤ level ${fmtNum(r.now.level)}.</p>`;
    } else if (r.minimal.length) {
      const shown = r.minimal.slice(0, 6);
      const items = shown.map(x => {
        const blocked = final ? x.set.filter(j => !final.has(j)) : [];
        let note = '';
        if (final) note = blocked.length ? `<span class="muted">but ${list(blocked)} ${blocked.length > 1 ? 'are' : 'is'} not rejected with these p-values</span>` : '<span class="ok-text">✓ possible with these p-values</span>';
        return `<li>If ${list(x.set)} ${x.set.length > 1 ? 'are' : 'is'} rejected, its level becomes <b>${fmtNum(x.level)}</b>, so p = ${fmtNum(p)} is enough. ${note} ${showBtn(x.set, 'Show', x.level)}</li>`;
      }).join('');
      body = `<p class="small">Not rejectable yet: p = ${fmtNum(p)} is above its level ${fmtNum(r.now.level)}. It becomes rejectable if:</p><ul class="tips">${items}</ul>${r.minimal.length > 6 ? `<p class="small muted">and ${r.minimal.length - 6} more set${r.minimal.length - 6 > 1 ? 's' : ''}.</p>` : ''}`;
      if (final) body += final.has(id) ? `<p class="small ok-text">✓ With these p-values this does happen: ${lab(id)} ends up rejected.</p>` : `<p class="small err-text">✕ With these p-values none of these sets is fully rejected, so ${lab(id)} stays unrejected.</p>`;
    } else {
      body = `<p class="small">No set of other rejections gets its level up to p = ${fmtNum(p)}. ${bestTxt}${r.best.set.length ? ` It would need p ≤ ${fmtNum(r.best.level)} even then.` : ''}</p>`;
      if (r.best.set.length) body += `<div class="row-actions">${showBtn(r.best.set, 'Show on canvas', r.best.level)}</div>`;
    }
    return `<div class="wit-card"><p><b>${esc(lab(id))}</b> <span class="small muted">${nowTxt}</span></p>${body}${hasP && !isRejectable(st, id, pOf, G.alpha) && r.minimal.length && r.best.set.length ? `<p class="small muted">${bestTxt}</p>` : ''}</div>`;
  }).join('');
  const hide = witActive() ? '<div class="row-actions"><button class="btn small" data-action="wit-hide">Clear highlight</button></div>' : '';
  return det('det-wit', 'What would it take?', intro + hide + cards + (mode !== 'test' ? '<p class="small muted">Shown for the initial graph. In Test mode it follows the current step.</p>' : ''), `${m} open`);
}
function renderTestPanel() {
  const el = $('tab-test');
  preserveFocus(el, () => {
    const errs = hasErrors();
    const inTest = mode === 'test' && T;
    let h = `<div class="row-actions" style="justify-content:space-between;align-items:center"><h2>Test the graph</h2><label class="chk" title="Describe the graph and each step in everyday words"><input type="checkbox" id="plainToggle" ${plain ? 'checked' : ''}> Plain language</label></div>`;
    if (plain) h += plainSection();
    if (!inTest) h += `<p class="small muted">Enter a p-value for each hypothesis, then run the test at &alpha; = ${fmtNum(G.alpha)}${isBonf() ? ', or step through it yourself' : ''}.</p>`;
    if (!isBonf() && !advanced) h += `<p class="small muted">Test: ${TEST_TYPES[testType()]} (change it under advanced features).</p>`;
    if (!isBonf() && !(inTest && manual)) h += closedWarnings();
    if (errs) h += '<div class="blocked" role="alert">✕ Fix the errors shown under the canvas before testing.</div>';
    const busy = animating || (inTest && T.running);
    if (inTest && T.closed) {
      h += ctRunning ? `<p class="progress" id="ctProgress">Working out the closed test…</p>` : '';
    } else if (inTest) {
      h += `<div class="seg" role="group" aria-label="How hypotheses are rejected"><button data-action="mode-p" aria-pressed="${!manual}" ${busy ? 'disabled' : ''}>Use p-values</button><button data-action="mode-whatif" aria-pressed="${manual}" ${busy ? 'disabled' : ''}>What if (no p-values)</button></div>
        <p class="small muted">${manual ? 'Click any hypothesis on the canvas, or Reject below, to see where its alpha goes. p-values are ignored.' : 'Hypotheses outlined in green can be rejected now. Reject them in any order by clicking them, or let Run test choose.'}</p>`;
    }
    const rejectable = inTest && !manual && !errs && !T.closed && isBonf() ? new Set(rejectableIds(T.st, pOf, G.alpha)) : new Set();
    const rows = G.nodes.map(n => {
      let w = n.w, status = '';
      if (inTest) {
        const r = T.rejected.get(n.id);
        if (r) { w = r.w; status = `<span class="status-cell rej">✓ Rejected${T.closed ? '' : ` (${r.step})`}</span>`; }
        else if (T.closed) { status = ctRunning ? '<span class="muted">…</span>' : '<span class="status-cell">✕ Not rejected</span>'; }
        else {
          w = T.st.w.get(n.id) || Q.ZERO;
          if (manual) status = `<button class="btn small" data-action="reject" data-id="${n.id}" ${busy ? 'disabled' : ''}>Reject</button>`;
          else if (rejectable.has(n.id)) status = `<button class="btn small primary" data-action="reject" data-id="${n.id}" ${busy ? 'disabled' : ''} aria-label="Reject ${esc(n.label)}">Reject</button>`;
          else status = T.done ? '<span class="status-cell">✕ Not rejected</span>' : '<span class="muted">Not yet</span>';
        }
      }
      const p = parseP(n.p);
      const bad = Number.isNaN(p);
      return `<tr><th scope="row">${esc(n.label)}</th><td><input id="tp-${n.id}" data-p="${n.id}" value="${esc(n.p || '')}" class="${bad ? 'bad' : ''}" inputmode="decimal" autocomplete="off" aria-label="p-value for ${esc(n.label)}" placeholder="p"></td><td>${esc(fmt(w))}</td><td>${fmtNum(Q.toNum(w) * G.alpha)}</td>${inTest ? `<td>${status}</td>` : ''}</tr>`;
    }).join('');
    if (G.nodes.length) h += `<table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col">p-value</th><th scope="col">${inTest ? 'Weight now' : 'Weight'}</th><th scope="col">${inTest ? 'Level now' : 'Level'}</th>${inTest ? '<th scope="col">Status</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
    const badP = G.nodes.filter(n => Number.isNaN(parseP(n.p)));
    if (badP.length) h += `<p class="err-text">✕ ${badP.map(n => esc(n.label)).join(', ')}: a p-value must be a number between 0 and 1.</p>`;
    const missing = G.nodes.filter(n => parseP(n.p) == null);
    if (!manual && missing.length && missing.length < G.nodes.length) h += `<p class="small muted">No p-value yet for ${missing.map(n => esc(n.label)).join(', ')}; ${missing.length > 1 ? 'they' : 'it'} will not be rejected.</p>`;
    if (isBonf() && !manual) h += '<p class="small muted">A hypothesis is rejected when its p-value is at or below its level (Bretz et al., 2009, Algorithm 1).</p>';
    if (!inTest) {
      const can = G.nodes.length && !errs && G.nodes.some(n => { const p = parseP(n.p); return p != null && !Number.isNaN(p); });
      h += `<div class="row-actions"><button class="btn primary" data-action="run" ${can ? '' : 'disabled'}>Run test</button>${isBonf() ? `<button class="btn" data-action="enter-test" ${G.nodes.length && !errs ? '' : 'disabled'}>Step through it</button><button class="btn" data-action="mode-whatif" ${G.nodes.length && !errs ? '' : 'disabled'}>What if (no p-values)</button>` : `<button class="btn" data-action="mode-whatif" ${G.nodes.length && !errs ? '' : 'disabled'}>What if (Bonferroni graph)</button>`}</div>`;
      if (advanced) h += testTypeSection();
      if (isBonf()) h += witSection(); else h += closedSection(false);
    } else {
      const done = T.done || !T.st.ids.length;
      if (!T.closed && !manual && !isBonf()) h += `<div class="row-actions"><button class="btn primary" data-action="run" ${busy || errs ? 'disabled' : ''}>Run test</button><button class="btn" data-action="exit-test" ${busy ? 'disabled' : ''}>Back to Design</button></div><p class="small muted">${esc(TEST_TYPES[testType()])} runs as a closed test, so there is no step-by-step rejection. Switch to What if to explore the Bonferroni graph by hand.</p>`;
      else if (T.closed) h += `<div class="row-actions"><button class="btn primary" data-action="run" ${ctRunning ? 'disabled' : ''}>Run again</button><button class="btn" data-action="reset" ${ctRunning ? 'disabled' : ''}>Reset</button><button class="btn" data-action="exit-test" ${ctRunning ? 'disabled' : ''}>Back to Design</button></div>`;
      else h += `<div class="row-actions">
        ${manual ? '' : `<button class="btn primary" data-action="run" ${busy || done || errs ? 'disabled' : ''}>${T.step ? 'Run to the end' : 'Run test'}</button>
        <button class="btn" data-action="step" ${busy || done || errs ? 'disabled' : ''}>Step</button>`}
        <button class="btn" data-action="step-back" ${busy || !T.history.length ? 'disabled' : ''}>Step back</button>
        <button class="btn" data-action="redo-step" ${busy || !T.redo.length ? 'disabled' : ''}>Redo</button>
        <button class="btn" data-action="reset" ${busy ? 'disabled' : ''}>Reset</button>
        <button class="btn" data-action="exit-test" ${busy ? 'disabled' : ''}>Back to Design</button>
      </div>`;
      if (done && !manual && !ctRunning) {
        const rej = G.nodes.filter(n => T.rejected.has(n.id)), not = G.nodes.filter(n => !T.rejected.has(n.id));
        h += `<div class="result-card" role="status"><b>Result at &alpha; = ${fmtNum(G.alpha)}</b>
          <span class="r-ok">✓ Rejected: ${rej.length ? rej.map(n => esc(n.label)).join(', ') : 'none'}</span>
          <span class="r-no">✕ Not rejected: ${not.length ? not.map(n => esc(n.label)).join(', ') : 'none'}</span></div>`;
      }
      if (advanced) h += testTypeSection();
      if (T.closed) h += closedSection(true);
      else { if (advanced) h += orderSection(); h += witSection(); }
      if (T.log.length) h += det('det-steps', 'Step log', `<ol class="log">${T.log.map(l => l.stop ? `<li class="stop">${esc(l.text)}</li>` : `<li>${esc(l.text)}${l.gave ? `<br><span class="small">${esc(l.gave)}</span>` : ''}${l.now ? `<br><span class="muted small">${esc(l.now)}</span>` : ''}</li>`).join('')}</ol>`, `${T.step} step${T.step === 1 ? '' : 's'}`);
      if (advanced) h += det('det-teach', 'Teaching tips', `<p class="small muted">The Matrix tab shows the current weights and transition matrix after each step. Step back and Redo (or Ctrl+Z and Ctrl+Y) move through the steps.</p>`);
    }
    if (advanced) h += det('det-paste', 'Paste all p-values at once', `<p class="small muted">In order (${G.nodes.map(n => esc(n.label)).join(', ')}), as <code>c(0.01, 0.02, ...)</code> or separated by commas or spaces.</p>
      <textarea class="txt" id="pastePs" rows="2" placeholder="c(0.004, 0.009, 0.011, 0.03)" aria-label="p-values for every hypothesis, in order"></textarea>
      <div class="row-actions"><button class="btn small" data-action="paste-p">Fill in p-values</button></div><p id="pasteMsg" class="err-text" hidden></p>`);
    if (advanced && isBonf() && allPValid() && !errs) {
      const adj = adjustedPValues(stateFromGraph(G), id => parseP(nodeById(id).p));
      h += det('det-adj', 'Adjusted p-values', `<p class="small muted">A hypothesis is rejected at level &alpha; exactly when its adjusted p-value is at most &alpha; (Bretz et al., 2009).</p>
        <table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">p</th><th scope="col" class="num">Adjusted p</th><th scope="col">At &alpha; = ${fmtNum(G.alpha)}</th></tr></thead><tbody>${G.nodes.map(n => { const a = adj.get(n.id); return `<tr><th scope="row">${esc(n.label)}</th><td class="num">${fmtNum(parseP(n.p))}</td><td class="num">${fmtNum(a)}</td><td>${a <= G.alpha * (1 + 1e-12) ? '<span class="status-cell rej">✓ Rejected</span>' : '✕ Not rejected'}</td></tr>`; }).join('')}</tbody></table>`);
    }
    el.innerHTML = h;
  });
}

/* ---------- power tab ---------- */
function simPower(id) { return SIM.power[id] != null ? SIM.power[id] : '80'; }
/* Everything a power result depends on: graph, alpha, test settings, marginal powers, correlations and the success rule */
function powerSig() { return simSig() + testType() + G.test.upscale + JSON.stringify(serializeTest(G.test) || '') + JSON.stringify([G.nodes.map(n => simPower(n.id)), SIM.rho, SIM.useMatrix, SIM.useMatrix ? G.nodes.map(a => G.nodes.map(b => corrOf(a.id, b.id))) : null, SIM.success, SIM.n]); }
function simSig() { return JSON.stringify({ a: G.alpha, n: G.nodes.map(n => [n.id, Q.exact(n.w)]), e: G.edges.map(e => [e.from, e.to, Q.exact(e.g)]) }); }
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
/* Live check of the Power tab correlations: '' when they are usable */
function simCorrProblem() {
  const m = G.nodes.length;
  if (m < 2) return '';
  const ids = G.nodes.map(n => n.id), val = (i, j) => Number(corrOf(ids[i], ids[j]));
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) { const v = val(i, j); if (!(v >= -1 && v <= 1)) return 'Correlations must be numbers between −1 and 1.'; }
  const bad = corrConflict(ids.map((_, i) => i), (i, j) => Math.min(val(i, j), 0.999999));
  return bad ? corrConflictText(bad.map(i => G.nodes[i].label), bad.length === m) : '';
}
/* Negative correlations that matter for a Simes test: from the Power tab and from the Test tab matrix. For Simes within groups, only pairs in the same group. */
function simesNegatives() {
  const t = testType();
  if (t !== 'simes' && t !== 'simes-groups') return [];
  const out = [], seen = new Set();
  const counts = (a, b) => t === 'simes' || (a.group && a.group === b.group);
  G.nodes.forEach((a, i) => G.nodes.forEach((b, j) => {
    if (j <= i || !counts(a, b)) return;
    const k = pairKey(a.id, b.id);
    const v = Number(corrOf(a.id, b.id)), u = G.test.corr[k];
    if (v < 0 && !seen.has(k)) { seen.add(k); out.push({ a: a.label, b: b.label, v, where: 'Power tab' }); }
    else if (u != null && u < 0 && !seen.has(k)) { seen.add(k); out.push({ a: a.label, b: b.label, v: u, where: 'Test tab' }); }
  }));
  return out;
}
function corrOf(a, b) {
  if (SIM.useMatrix && SIM.corr[pairKey(a, b)] != null) return SIM.corr[pairKey(a, b)];
  return SIM.rho;
}
function renderPowerPanel() {
  const el = $('tab-power');
  preserveFocus(el, () => {
    if (!G.nodes.length) { el.innerHTML = '<h2>Power</h2><p class="muted">Add hypotheses first.</p>'; return; }
    const za = qnorm(1 - G.alpha);
    const rows = G.nodes.map(n => {
      const v = simPower(n.id), x = Number(v);
      const ok = x > 0 && x < 100;
      return `<tr><th scope="row">${esc(n.label)}</th><td><input id="sp-${n.id}" data-pw="${n.id}" value="${esc(v)}" inputmode="decimal" class="${ok ? '' : 'bad'}" aria-label="Power of ${esc(n.label)} alone, percent"></td><td class="num">${ok ? (za + qnorm(x / 100)).toFixed(2) : ''}</td></tr>`;
    }).join('');
    const m = G.nodes.length;
    const corrBad = (a, b) => { const v = Number(corrOf(a, b)); return !(v >= -1 && v <= 1); };
    const corrTable = `<label class="chk"><input type="checkbox" id="sim-usematrix" ${SIM.useMatrix ? 'checked' : ''}> Use the values below instead</label>
      <div class="mx-scroll"><table class="mx"><thead><tr><th></th>${G.nodes.map(n => `<th scope="col">${esc(n.label)}</th>`).join('')}</tr></thead><tbody>${G.nodes.map((a, i) => `<tr><th scope="row">${esc(a.label)}</th>${G.nodes.map((b, j) => j <= i ? `<td style="text-align:center;color:var(--muted)">${j === i ? '1' : ''}</td>` : `<td><input id="sc-${a.id}-${b.id}" data-corr="${pairKey(a.id, b.id)}" value="${esc(String(corrOf(a.id, b.id)))}" class="${SIM.useMatrix && corrBad(a.id, b.id) ? 'bad' : ''}" aria-label="Correlation between ${esc(a.label)} and ${esc(b.label)}" ${SIM.useMatrix ? '' : 'disabled'}></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const succ = `<p class="small muted">Count a trial as a success when</p>
      <div class="row-actions"><label class="chk"><input type="radio" name="sim-rule" value="any" ${SIM.success.rule === 'any' ? 'checked' : ''}> any</label><label class="chk"><input type="radio" name="sim-rule" value="all" ${SIM.success.rule === 'all' ? 'checked' : ''}> all</label><span class="small muted" style="align-self:center">of these are rejected:</span></div>
      <div class="row-actions">${G.nodes.map(n => `<label class="chk"><input type="checkbox" data-succ="${n.id}" ${SIM.success.ids.includes(n.id) ? 'checked' : ''}> ${esc(n.label)}</label>`).join('')}</div>`;
    let h = `<h2>Power by simulation</h2>
      <p class="small muted">How often does the graph reject each hypothesis? Set the power each test would have on its own at the full &alpha;, and how correlated the test statistics are. The mean of each z statistic is then &Phi;&#8315;&sup1;(1 &minus; &alpha;) + &Phi;&#8315;&sup1;(power), with the trial\'s one-sided &alpha; (Xi and Chen, 2024, eq. 2). One-sided z-tests, initial graph, &alpha; = ${fmtNum(G.alpha)}, ${esc(TEST_TYPES[testType()])} test (set in the Test tab).${G.sided === 'two' ? ' The p-values are set to two-sided in the toolbar, but the simulation is one-sided: read its &alpha; as a one-sided level.' : ''}</p>
      <table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col">Power alone (%)</th><th scope="col" class="num">Mean z</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="form"><label for="sim-rho">Correlation between test statistics <span class="hint">The same value for every pair, between &minus;1 and 1</span><input class="txt" id="sim-rho" value="${esc(String(SIM.rho))}" inputmode="decimal" style="max-width:8em" ${SIM.useMatrix ? 'disabled' : ''}></label></div>
      <p class="small muted">${CORR_WHAT_TO_ENTER}</p>
      ${m > 1 ? det('det-corr', 'Set each pair separately', corrTable) : ''}
      ${!SIM.error && simCorrProblem() ? `<p class="err-text" id="simCorrMsg">✕ ${esc(simCorrProblem())}</p>` : ''}
      ${det('det-success', 'Define success', succ, SIM.success.ids.length ? `${SIM.success.rule} of ${SIM.success.ids.map(id => (nodeById(id) || {}).label).filter(Boolean).join(', ')}` : '')}
      <div class="row-actions" style="align-items:center"><label for="sim-n" class="small">Simulations</label><select class="sel" id="sim-n">${[2000, 10000, 100000].map(v => `<option value="${v}" ${SIM.n === v ? 'selected' : ''}>${v.toLocaleString('en-GB')}</option>`).join('')}</select>
      <button class="btn primary" data-action="sim-run" ${SIM.running || hasErrors() ? 'disabled' : ''}>${SIM.running ? 'Running…' : 'Run simulation'}</button></div>
      <div id="simProgress" class="progress">${SIM.running ? `${Math.round(100 * SIM.running.done / SIM.running.total)}% done` : ''}</div>`;
    if (hasErrors()) h += '<div class="blocked">✕ Fix the errors shown under the canvas first.</div>';
    if (SIM.error) h += `<p class="err-text" role="alert">✕ ${esc(SIM.error)}</p>`;
    const R = SIM.result;
    if (R) {
      const t = R.tally, n = t.n;
      const pct = x => (100 * x / n).toFixed(1) + '%';
      const se = x => { const p = x / n; return (100 * Math.sqrt(p * (1 - p) / n)).toFixed(1); };
      if (R.sig !== powerSig()) h += '<div class="stale">! The graph, &alpha;, test or simulation settings have changed since this run. Run it again to update.</div>';
      h += `<h3>Results (${n.toLocaleString('en-GB')} simulated trials)</h3>
        <table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">Power</th><th scope="col" class="num">&plusmn; 1 SE</th><th scope="col" class="num">Alone</th></tr></thead><tbody>${R.labels.map((l, i) => `<tr><th scope="row">${esc(l)}</th><td class="num"><b>${pct(t.rej[i])}</b></td><td class="num muted">${se(t.rej[i])}</td><td class="num muted">${R.pw[i]}%</td></tr>`).join('')}</tbody></table>
        <dl class="facts"><dt>At least one rejected</dt><dd><b>${pct(t.any)}</b></dd><dt>All rejected</dt><dd>${pct(t.all)}</dd><dt>Expected number rejected</dt><dd>${(t.total / n).toFixed(2)}</dd>${R.successText ? `<dt>Success (${esc(R.successText)})</dt><dd><b>${pct(t.custom)}</b></dd>` : ''}</dl>
        <p class="small muted">Test: ${esc(R.testNote || 'Bonferroni')}. Correlation: ${esc(R.corrText)}. Seed 2009, so the same settings give the same numbers.</p>
        <div class="row-actions"><button class="btn small" data-action="sim-keep">Keep for comparison</button></div>`;
    }
    if (SIM.runs.length) {
      const labels = [...new Set(SIM.runs.flatMap(r => r.labels))];
      h += det('det-runs', 'Compare runs', `<p class="small muted">Change the graph, run again and keep each result to compare designs side by side. Click a name to rename it.</p>
        <div class="mx-scroll"><table class="t"><thead><tr><th scope="col">Run</th>${labels.map(l => `<th scope="col" class="num">${esc(l)}</th>`).join('')}<th scope="col" class="num">Any</th><th scope="col" class="num">All</th><th scope="col" class="num">Success</th></tr></thead><tbody>${SIM.runs.map((r, k) => `<tr><td><input id="rn-${k}" data-runname="${k}" value="${esc(r.name)}" aria-label="Run name" style="min-width:6em"></td>${labels.map(l => { const i = r.labels.indexOf(l); return `<td class="num">${i < 0 ? '–' : r.power[i]}</td>`; }).join('')}<td class="num">${r.any}</td><td class="num">${r.all}</td><td class="num">${r.custom || '–'}</td></tr>`).join('')}</tbody></table></div>
        <div class="row-actions"><button class="btn small" data-action="sim-clear">Clear comparison</button></div>`, `${SIM.runs.length} kept`);
    }
    h += det('det-simr', 'Check it in R with graphicalMCP', `<pre class="code" id="simRCode">${esc(powerRCode())}</pre><div class="row-actions"><button class="btn small" data-action="sim-copy-r">Copy</button></div><p class="small muted">Check the argument names with <code>?graph_calculate_power</code> for your installed version.</p>`);
    el.innerHTML = h;
  });
}
function powerRCode() {
  const m = G.nodes.length;
  const base = exportGraphicalMCP(G).split('\ngraph\n')[0];
  const pm = G.nodes.map(n => fmtNum(Number(simPower(n.id)) / 100, 6)).join(', ');
  const rows = G.nodes.map(a => '    ' + G.nodes.map(b => (a.id === b.id ? '1' : String(Number(corrOf(a.id, b.id))))).join(', ')).join(',\n');
  return `${base}\n\nset.seed(2009)\ngraph_calculate_power(\n  graph,\n  alpha = ${fmtNum(G.alpha, 12)},\n  power_marginal = c(${pm}),\n  sim_corr = matrix(c(\n${rows}\n  ), nrow = ${m}, byrow = TRUE),\n  sim_n = 1e5\n)\n`;
}
function runSim() {
  if (SIM.running || hasErrors()) return;
  SIM.error = '';
  const m = G.nodes.length;
  const pw = G.nodes.map(n => Number(simPower(n.id)));
  if (pw.some(x => !(x > 0 && x < 100))) { SIM.error = 'Each power must be a percentage between 0 and 100, such as 80.'; renderPowerPanel(); return; }
  const Rm = new Float64Array(m * m);
  let capped = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    const v = i === j ? 1 : Number(corrOf(G.nodes[i].id, G.nodes[j].id));
    if (!(v >= -1 && v <= 1)) { SIM.error = 'Correlations must be numbers between −1 and 1.'; renderPowerPanel(); return; }
    Rm[i * m + j] = i === j ? 1 : Math.min(v, 0.999999);
    if (i < j && v > 0.999999) capped++;
  }
  const L = cholesky(Rm, m);
  if (!L) { SIM.error = 'Those correlations cannot all hold at once (the matrix is not positive definite). Try values closer to 0.'; renderPowerPanel(); return; }
  const za = qnorm(1 - G.alpha);
  const mean = pw.map(x => za + qnorm(x / 100));
  const fg = floatGraph(G);
  const ids = G.nodes.map(n => n.id);
  const sIdx = SIM.success.ids.map(id => ids.indexOf(id)).filter(i => i >= 0);
  const success = sIdx.length ? { idx: sIdx, rule: SIM.success.rule } : null;
  const tally = { n: 0, rej: Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 };
  const norm = normalGen(mulberry32(2009));
  let tester = null, testNote = '';
  if (!isBonf()) {
    if (m > 10) { SIM.error = 'Power with a closed test is available for up to 10 hypotheses.'; renderPowerPanel(); return; }
    const prob = corrProblem();
    if (prob && !/same as Bonferroni/.test(prob)) { SIM.error = prob; renderPowerPanel(); return; }
    try {
      const ctx = testCtx(), cr = closedTestCritical(fg, G.alpha, testType(), ctx);
      tester = (p, out) => closedTestFast(m, cr.crit, p, G.alpha, testType(), ctx, out);
      testNote = TEST_TYPES[testType()] + ' closed test';
    } catch (err) { SIM.error = err.message; renderPowerPanel(); return; }
  } else testNote = 'Bonferroni' + (G.test.upscale ? ' (upscale is ignored in the step-by-step Bonferroni test)' : '');
  const total = SIM.n, sig = powerSig();
  const corrText = (SIM.useMatrix ? 'set pair by pair' : `${Number(SIM.rho)} for every pair`) + corrCapText(capped);
  const successText = success ? `${success.rule} of ${sIdx.map(i => G.nodes[i].label).join(', ')}` : '';
  const labels = G.nodes.map(n => n.label), pwTxt = pw.map(x => fmtNum(x, 4));
  SIM.running = { done: 0, total };
  renderPowerPanel();
  const step = () => {
    const k = Math.min(5000, total - tally.n);
    simulateChunk(fg, mean, L, G.alpha, k, norm, tally, success, tester);
    SIM.running.done = tally.n;
    const pr = $('simProgress'); if (pr) pr.textContent = `${Math.round(100 * tally.n / total)}% done`;
    if (tally.n < total) setTimeout(step, 0);
    else { SIM.running = null; SIM.result = { tally, sig, labels, pw: pwTxt, corrText, successText, testNote }; renderPowerPanel(); }
  };
  setTimeout(step, 0);
}

/* ---------- presentation mode ---------- */
function enterPresent() {
  if (!G.nodes.length || animating) return;
  if (hasErrors()) { flashMessage('Fix the errors under the canvas before presenting.'); return; }
  presenting = true;
  document.body.classList.add('present');
  if (mode !== 'test') setMode('test', true);
  $('presentBar').hidden = false;
  renderAll();
  setTimeout(fitView, 30);
  $('canvas').focus({ preventScroll: true });
}
function exitPresent() {
  presenting = false;
  document.body.classList.remove('present');
  $('presentBar').hidden = true;
  renderAll();
  setTimeout(fitView, 30);
}
function presentCaption() {
  if (!T) return '';
  const last = T.log.length ? T.log[T.log.length - 1] : null;
  if (last) return plain && last.data ? plainStepText(last.data, G.alpha) : (last.stop ? last.text : last.text + (last.gave ? ' ' + last.gave : ''));
  const R = rejectableIds(T.st, pOf, G.alpha).map(id => nodeById(id).label);
  if (manual) return 'What if mode: click any hypothesis to reject it.';
  return R.length ? `Each hypothesis is tested at its level (weight × α). ${joinWords(R)} can be rejected now: press Next, or click one.` : 'No hypothesis can be rejected with these p-values.';
}
function updatePresentBar() {
  if (!presenting) return;
  $('presentCaption').textContent = presentCaption();
  const busy = animating || (T && T.running), done = !T || T.done || !T.st.ids.length;
  $('presentBar').querySelector('[data-action="pres-next"]').disabled = busy || done || manual || !T;
  $('presentBar').querySelector('[data-action="pres-back"]').disabled = busy || !T || !T.history.length;
}
$('presentBtn').addEventListener('click', enterPresent);
$('presentBar').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'pres-next') stepOnce(false);
  else if (act === 'pres-back') stepBack();
  else if (act === 'pres-reset') { T = newTest(); renderAll(); }
  else if (act === 'pres-exit') exitPresent();
});

/* ---------- step-by-step beamer export ---------- */
function stepFrames() {
  /* Use the steps taken in Test mode if there are any; otherwise run the procedure on the p-values. */
  const states = [];
  let st = stateFromGraph(G), rejected = new Map(), caps = [];
  const captionFor = (data) => data ? (plain ? plainStepText(data, G.alpha) : (data.manual ? `Rejected ${data.label} (what if).` : `Rejected ${data.label}: p = ${fmtNum(data.p)} ≤ ${fmtNum(data.level)}.`) + (data.gave.length ? ' Passed on: ' + data.gave.map(([to, q]) => `+${fmt(q)} to ${to}`).join(', ') + '.' : '')) : '';
  const push = (s, rej, cap) => states.push({ st: s, rejected: new Map(rej), caption: cap });
  push(st, rejected, 'Initial graph. Each hypothesis is tested at its level, weight × α.');
  if (mode === 'test' && T && T.closed && T.done) {
    /* A closed test has no rejection sequence: one overlay for the initial graph and one for the result. */
    const rej = G.nodes.filter(n => T.rejected.has(n.id)), not = G.nodes.filter(n => !T.rejected.has(n.id));
    rej.forEach((n, k) => rejected.set(n.id, k + 1));
    states[0].caption = `Initial graph (weights). Tested as a closed test with ${TEST_TYPES[testType()]} tests for every intersection hypothesis.`;
    push(st, rejected, `${TEST_TYPES[testType()]} closed test at α = ${fmtNum(G.alpha)}: rejected ${rej.length ? joinWords(rej.map(n => n.label)) : 'nothing'}${not.length ? `; not rejected ${joinWords(not.map(n => n.label))}` : ''}.`);
    return states.map(({ st: s, rejected: rj, caption }) => {
      const vm = {
        nodes: G.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R, p: n.p, group: n.group || '', color: n.color || '', w: n.w, rejected: rj.has(n.id) })),
        edges: [...s.g.entries()].filter(([, g]) => !Q.isZero(g)).map(([k, g]) => { const [a, b] = k.split('>'); const o = edgeOf(a, b); return { from: a, to: b, g, bend: o ? o.bend : null, text: fmt(g) }; })
      };
      return { vm, layout: layoutEdges(vm), caption, alpha: G.alpha };
    });
  }
  const steps = (mode === 'test' && T && T.log.some(l => l.data)) ? T.log.filter(l => l.data) : null;
  if (steps) {
    let cur = stateFromGraph(G), k = 0;
    for (const h of T.history) {
      const next = T.history[T.history.indexOf(h) + 1];
      const after = next ? next.st : T.st;
      k++; rejected.set(h.id, k);
      push(after, rejected, captionFor(steps[k - 1].data));
      cur = after;
    }
    void cur;
  } else {
    let k = 0;
    for (;;) {
      const c = findCandidate(st, pOf, G.alpha);
      if (!c) break;
      const before = st; st = rejectNode(st, c.id); k++; rejected.set(c.id, k);
      const n = nodeById(c.id);
      const gave = before.ids.filter(l => l !== c.id && !Q.isZero(getg(before, c.id, l))).map(l => [nodeById(l).label, Q.mul(before.w.get(c.id), getg(before, c.id, l))]);
      push(st, rejected, captionFor({ label: n.label, p: c.p, level: c.level, manual: false, wj: before.w.get(c.id), gave, now: st.ids.map(l => [nodeById(l).label, Q.toNum(st.w.get(l)) * G.alpha]) }));
    }
  }
  const rem = states.length > 1 ? G.nodes.filter(n => !states[states.length - 1].rejected.has(n.id)).map(n => n.label) : [];
  if (states.length > 1) states[states.length - 1].caption += rem.length ? ` Final result: ${joinWords(rem)} not rejected.` : ' Final result: all hypotheses rejected.';
  return states.map(({ st: s, rejected: rej, caption }) => {
    const vm = {
      nodes: G.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R, p: n.p, group: n.group || '', color: n.color || '', w: rej.has(n.id) ? Q.ZERO : (s.w.get(n.id) || Q.ZERO), rejected: rej.has(n.id) })),
      edges: [...s.g.entries()].filter(([, g]) => !Q.isZero(g)).map(([k, g]) => { const [a, b] = k.split('>'); const o = edgeOf(a, b); return { from: a, to: b, g, bend: o ? o.bend : null, text: fmt(g) }; })
    };
    for (const n of vm.nodes) if (n.rejected) { const r = G.nodes.find(x => x.id === n.id); n.w = r ? r.w : Q.ZERO; }
    return { vm, layout: layoutEdges(vm), caption, alpha: G.alpha };
  });
}

/* ---------- export panel ---------- */
function initExportPanel() {
  $('tab-export').innerHTML = `<h2>Export and share</h2>
  <p class="small muted">Pictures and TikZ show the graph as it is on the canvas, including any test progress. R code describes the initial graph.</p>
  <div class="export-grid">
    <button class="btn" data-export="png">Picture (PNG)</button>
    <button class="btn" data-export="link">Share link</button>
    <button class="btn" data-export="json">Save as a file</button>
    <button class="btn" data-export="load">Open a saved graph</button>
  </div>
  <div class="adv">
  <h3>For documents and slides</h3>
  <div class="export-grid">
    <button class="btn" data-export="sap">SAP / protocol text</button>
    <button class="btn" data-export="beamer">Beamer: step by step</button>
    <button class="btn" data-export="tikz">LaTeX (TikZ)</button>
    <button class="btn" data-export="svg">Vector picture (SVG)</button>
  </div>
  <h3>For R</h3>
  <div class="export-grid">
    <button class="btn" data-export="graphicalmcp">graphicalMCP</button>
    <button class="btn" data-export="gmcp">gMCP</button>
  </div>
  </div>
  <p class="small muted simple-only">LaTeX, R code and SAP text are under advanced features: <button class="btn small" data-action="go-advanced">Show advanced features</button></p>
  <div id="exportOut" class="form" aria-live="polite"></div>`;
}
const SAVE_OK = ['png', 'svg', 'json', 'txt', 'md', 'html', 'csv'];
function canDownload(file) {
  const ext = file.split('.').pop().toLowerCase();
  if (dlCap) return SAVE_OK.includes(ext);
  if (dlCap === undefined) return isTop && !(window.claude && window.claude.use);
  return isTop;
}
async function resolveDownloads() {
  if (!(window.claude && typeof window.claude.use === 'function')) { dlCap = null; return; }
  try { dlCap = await window.claude.use('downloads'); } catch (e) { dlCap = null; }
  if (activeTab === 'export' && exportView && exportView !== 'load') showExport(exportView);
}
function codeBlock(title, desc, code, file, mime) {
  const dl = file && canDownload(file);
  return `<h3>${esc(title)}</h3>${desc ? `<p class="small muted">${desc}</p>` : ''}
  <pre class="code" id="exportCode" tabindex="0">${esc(code)}</pre>
  <div class="row-actions"><button class="btn primary" data-action="copy">Copy</button>${dl ? `<button class="btn" data-action="download" data-file="${file}" data-mime="${mime}">Download ${esc(file)}</button>` : ''}</div>`;
}
function currentPicture() { const vm = buildVM(); return { vm, layout: layoutEdges(vm) }; }
function svgToPng(svgStr) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = 2, c = document.createElement('canvas');
      c.width = Math.ceil(img.naturalWidth * s); c.height = Math.ceil(img.naturalHeight * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/png'));
    };
    img.onerror = () => rej(new Error('Could not draw the image.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  });
}
function dataUrlToBlob(u) {
  const [head, b64] = u.split(',');
  const bin = atob(b64);
  return new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))], { type: head.slice(5).split(';')[0] });
}
async function download(name, mime, data, btn) {
  if (dlCap) {
    try { await dlCap.save({ filename: name, data }); }
    catch (err) { if (btn && err && err.code !== 'declined') btn.textContent = 'Saving is not available here: use Copy'; }
    return;
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { /* blocked */ }
}
async function showExport(kind) {
  exportView = kind;
  const out = $('exportOut');
  if (!out) return;
  if (!G.nodes.length && kind !== 'load') { out.innerHTML = '<p class="muted">Add some hypotheses first.</p>'; return; }
  const { vm, layout } = currentPicture();
  if (kind === 'svg') {
    exportPayload = exportSVG(vm, layout, fmt);
    out.innerHTML = codeBlock('SVG picture', 'White background, no interface chrome. Scales to any size.', exportPayload, 'multiplicity-graph.svg', 'image/svg+xml');
  } else if (kind === 'png') {
    const s = exportSVG(vm, layout, fmt);
    try {
      const url = await svgToPng(s);
      exportPayload = url;
      const dl = canDownload('x.png');
      out.innerHTML = `<h3>PNG picture</h3><p class="small muted">Twice screen resolution, white background.${dl ? '' : ' Right-click (or long-press) the picture to save or copy it.'}</p>
        <img class="preview-img" id="pngPreview" alt="The graph as a PNG picture" src="${url}">
        ${dl ? '<div class="row-actions"><button class="btn primary" data-action="download-png">Download multiplicity-graph.png</button></div>' : ''}`;
    } catch (err) { out.innerHTML = `<p class="err-text">✕ ${esc(err.message)}</p>`; }
  } else if (kind === 'tikz') {
    exportPayload = exportTikZ(vm, layout);
    out.innerHTML = codeBlock('TikZ', 'Same positions and curvature as the canvas (1 cm = 60 px). Paste into a LaTeX or beamer document.', exportPayload, 'multiplicity-graph.tex', 'text/x-tex');
  } else if (kind === 'graphicalmcp') {
    exportPayload = exportGraphicalMCP(G);
    out.innerHTML = codeBlock('R code for graphicalMCP', 'Initial graph, plus the test call when every hypothesis has a p-value. For the parametric test each block of known correlations becomes a test group; for Simes within groups, read the note in the code, since graphicalMCP\'s grouped Simes test is stronger than the Sketchpad\'s.', exportPayload, 'multiplicity-graph.R', 'text/plain');
  } else if (kind === 'gmcp') {
    exportPayload = exportGMCP(G);
    out.innerHTML = codeBlock('R code for gMCP', 'Builds the graph with matrix2graph(), and tests it when every hypothesis has a p-value.', exportPayload, 'multiplicity-graph-gMCP.R', 'text/plain');
  } else if (kind === 'json') {
    exportPayload = JSON.stringify(serializeGraph(G), null, 2);
    out.innerHTML = codeBlock('Graph file (JSON)', 'Keeps labels, exact weights, positions, curvature, p-values and &alpha;. Open it again with "Open a saved graph".', exportPayload, 'multiplicity-graph.json', 'application/json');
  } else if (kind === 'link') {
    const token = encodeShare(G);
    if (isTop) {
      exportPayload = location.href.split('#')[0] + '#' + token;
      out.innerHTML = codeBlock('Share link', 'The whole graph is stored in the link itself, so nothing is uploaded. Anyone opening it sees this graph.', exportPayload, null);
    } else {
      exportPayload = '#' + token;
      out.innerHTML = codeBlock('Share code', 'The whole graph is stored in this code, so nothing is uploaded. Add it to the end of this page\'s link (no spaces) to share the graph, or paste it into "Open a saved graph".', exportPayload, null);
    }
  } else if (kind === 'beamer') {
    const frames = stepFrames();
    exportPayload = exportBeamer(frames, 'Graphical multiple testing procedure');
    out.innerHTML = codeBlock('Beamer frame, one overlay per rejection', `${frames.length} overlay${frames.length === 1 ? '' : 's'}: the initial graph${frames.length > 1 ? ` and ${frames.length - 1} rejection${frames.length > 2 ? 's' : ''}` : ''}. ${mode === 'test' && T && T.closed ? 'A closed test has no rejection order, so the second overlay shows the final result.' : mode === 'test' && T && T.step ? 'Follows the steps you have taken in Test mode.' : 'Follows the automatic run of the Bonferroni graph on the entered p-values.'} Works with the Metropolis theme; add the \\usetikzlibrary line to the preamble.`, exportPayload, 'multiplicity-graph-steps.tex', 'text/x-tex');
  } else if (kind === 'sap') {
    const sap = sapText(G);
    const textAll = sapPlainText(sap) + '\n\n' + sap.tables.map(tableToTSV).join('\n\n') + '\n\n' + sapRefsText(sap);
    exportPayload = textAll;
    sapHTML = sapParasHTML(sap) + sap.tables.map(tableToHTML).join('') + sapRefsHTML(sap);
    out.innerHTML = `<h3>Multiplicity strategy for a SAP or protocol</h3>
      <p class="small muted">Describes the initial graph with the test type${G.test && G.test.type !== 'bonferroni' ? ' (closed test)' : ''} and the ${G.sided === 'two' ? 'two' : 'one'}-sided &alpha; set in the toolbar. Edit the wording to suit the document; the descriptions and groups in each hypothesis's panel feed into it. Check the stated assumptions against the trial's test statistics before using it. Fill in the [square-bracket placeholders], and number the tables and figure to match your document; Figure [X] is the graph, which you can export as PNG or SVG from this tab.${G.sided === 'two' && G.test && G.test.type !== 'bonferroni' ? ' <b>Two-sided p-values with a closed test:</b> this controls the two-sided error rate, but not a one-sided rate of &alpha;/2 for claims of benefit, since an effect in the harmful direction can help other hypotheses to be rejected. For directional claims, set the toolbar to one-sided p-values and halve &alpha;.' : ''}</p>
      <div class="sap" id="sapText">${sapParasHTML(sap)}</div>
      <div class="row-actions"><button class="btn primary" data-action="copy-sap-text">Copy text</button></div>
      ${sap.tables.map((t, i) => `<div class="mx-scroll sap-table" id="sapTable${i}"><p class="small"><b>${esc(t.title)}</b></p><table class="t"><thead><tr>${t.header.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, k) => k === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}
      <div class="sap" id="sapRefs">${sapRefsHTML(sap)}</div>
      <div class="row-actions"><button class="btn" data-action="copy-sap-tables">Copy tables</button><button class="btn" data-action="copy-sap-all">Copy everything</button></div>
      <p class="small muted">Copied tables paste into Word as real tables, and into Excel or a text editor as tab-separated text.</p>`;
  } else if (kind === 'load') {
    out.innerHTML = `<h3>Open a saved graph</h3>
      <label for="loadFile" class="small"><b>From a JSON file</b><br><input type="file" id="loadFile" accept=".json,application/json"></label>
      <label for="loadText"><b class="small">Or paste JSON, a share link or a share code</b><textarea class="txt" id="loadText" rows="4"></textarea></label>
      <div class="row-actions"><button class="btn primary" data-action="load-text">Open</button></div>
      <div id="loadMsg" aria-live="polite"></div>
      ${det('det-xfmt', 'File format for R and multigrain', `<p class="small muted">Besides its own saved files, the Sketchpad opens this simple JSON. <code>label</code>, <code>group</code>, <code>p</code> and <code>source</code> are optional; hypotheses in a group get matching colours. Rows of <code>transitions</code> are "from", columns are "to", in the same order as the hypotheses.</p>
<pre class="code" id="xfmtCode">${esc(JSON.stringify({ format: 'multiplicity-graph', version: 1, source: 'multigrain 0.3.0', alpha: 0.025, hypotheses: [{ name: 'H1', label: 'Dose 1, primary', weight: 0.5, group: 'primary' }, { name: 'H2', label: 'Dose 1, secondary', weight: 0.5, group: 'secondary' }], transitions: [[0, 1], [1, 0]] }, null, 2))}</pre>
<p class="small muted">The R function <code>sketchpad_json()</code> (supplied with the Sketchpad) writes this from a multigrain <code>graph_optimise()</code> result.</p>`)}`;
  }
}
function loadFromText(txt) {
  const msg = $('loadMsg');
  try {
    txt = txt.trim();
    const m = /#?(g1[A-Za-z0-9_-]+)\s*$/.exec(txt);
    let o;
    if (txt.startsWith('{')) { o = JSON.parse(txt); if (isExchangeFormat(o)) o = fromExchangeFormat(o, autoPositions, i => PALETTE[i % 8][1]); }
    else if (m) o = decodeShare(m[1]);
    else throw new Error('Paste a saved JSON graph, a share link or a share code.');
    loadGraph(o);
    if (msg) msg.innerHTML = `<p class="ok-text">✓ Opened a graph with ${G.nodes.length} hypotheses.</p>`;
  } catch (err) {
    if (msg) msg.innerHTML = `<p class="err-text" role="alert">✕ ${esc(err.message.startsWith('Unexpected') ? 'That text is not valid JSON.' : err.message)}</p>`;
  }
}
/* Copies text and an HTML version together, so Word gets a table and plain editors get tab-separated text */
function copyRich(text, html, btn, elId) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1400); } };
  const fallbackText = () => copyText(text, btn, elId);
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) });
      navigator.clipboard.write([item]).then(done, fallbackText);
    } else fallbackText();
  } catch (e) { fallbackText(); }
}
function copyText(text, btn, preId) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1400); } };
  const fallback = () => {
    const pre = $(preId || 'exportCode');
    if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    if (btn) { btn.textContent = 'Selected: press Ctrl+C'; setTimeout(() => { btn.textContent = 'Copy'; }, 2500); }
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
}


/* ---------- Compare tab: the graph on the canvas (A) against a kept graph, a template or a pasted graph (B) ---------- */
let KEPT = [];
const CMP = { with: '', matchBy: 'label', pasted: '', pasteMsg: '', test: null, power: null, running: null, error: '' };
function loadKept() { try { const v = JSON.parse(store.get('mgs-kept') || '[]'); KEPT = Array.isArray(v) ? v.filter(k => k && k.graph && k.name) : []; } catch (e) { KEPT = []; } }
function saveKept() { store.set('mgs-kept', JSON.stringify(KEPT)); }
/* Parses a pasted share link, share code, saved file or exchange file into a serialized graph */
function parseGraphText(txt) {
  txt = (txt || '').trim();
  const m = /#?(g1[A-Za-z0-9_-]+)\s*$/.exec(txt);
  let o;
  if (txt.startsWith('{')) { o = JSON.parse(txt); if (isExchangeFormat(o)) o = fromExchangeFormat(o, autoPositions, i => PALETTE[i % 8][1]); }
  else if (m) o = decodeShare(m[1]);
  else throw new Error('Paste a saved JSON graph, a share link or a share code.');
  return serializeGraph(deserializeGraph(o, false, 1).G);
}
/* The graph B as {name, graph (serialized)} or null */
function compareTarget() {
  const w = CMP.with;
  if (w.startsWith('kept:')) { const k = KEPT[+w.slice(5)]; return k ? { name: k.name, graph: k.graph } : null; }
  if (w.startsWith('tpl:')) {
    const key = w.slice(4);
    let o = null;
    if (key === 'cycle') o = cycleTemplate(Math.max(2, Math.min(12, starterM)));
    else if (key === 'truncatedHolm') o = truncatedHolmTemplate();
    else if (TEMPLATES[key]) o = templateJSON(key);
    if (!o) return null;
    const name = key === 'cycle' ? 'Cycle graph' : key === 'truncatedHolm' ? 'Truncated Holm' : TEMPLATES[key].name;
    return { name, graph: serializeGraph(deserializeGraph(o, false, 1).G) };
  }
  if (w === 'paste' && CMP.pasted) { try { return { name: 'Pasted graph', graph: parseGraphText(CMP.pasted) }; } catch (e) { return null; } }
  return null;
}
function cmpSig() { const t = compareTarget(); return snapshot() + '|' + CMP.matchBy + '|' + (t ? JSON.stringify(t.graph) : ''); }
/* Picture of a serialized graph, as an inline SVG */
function graphPicture(S) {
  const Gx = deserializeGraph(S, false, 1).G;
  const vm = {
    nodes: Gx.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R, p: n.p, w: n.w, color: n.color || '', group: n.group || '', wexpr: n.wexpr || '', rejected: false })),
    edges: Gx.edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend, expr: e.expr, text: e.expr ? exprDisplay(e.expr) : fmt(e.g) }))
  };
  return exportSVG(vm, layoutEdges(vm), fmt).replace(/<svg /, '<svg class="cmp-pic" ').replace(/ width="[^"]*" height="[^"]*"/, '');
}
function cmpInvalidate() { CMP.test = null; CMP.power = null; CMP.error = ''; }
function renderComparePanel() {
  const el = $('tab-compare');
  if (!el) return;
  preserveFocus(el, () => {
    const A = serializeGraph(G);
    const T = compareTarget();
    const keptOpts = KEPT.map((k, i) => `<option value="kept:${i}" ${CMP.with === 'kept:' + i ? 'selected' : ''}>${esc(k.name)} (${k.graph.nodes.length})</option>`).join('');
    const tplOpts = Object.entries(TEMPLATES).map(([k, t]) => `<option value="tpl:${k}" ${CMP.with === 'tpl:' + k ? 'selected' : ''}>${esc(t.name)}</option>`).join('') + `<option value="tpl:truncatedHolm" ${CMP.with === 'tpl:truncatedHolm' ? 'selected' : ''}>Truncated Holm (γ)</option><option value="tpl:cycle" ${CMP.with === 'tpl:cycle' ? 'selected' : ''}>Cycle graph</option>`;
    let h = `<h2>Compare two graphs</h2>
      <p class="small muted">A is the graph on the canvas. Keep a copy of it, change it, and compare the two; or compare it with a template or a pasted graph. Tests and power use the settings from the Test and Power tabs for both graphs.</p>
      <div class="row-actions" style="align-items:center"><input class="txt" id="cmpKeepName" placeholder="Name for the current graph" style="flex:1;min-width:10em" value="${esc(CMP.keepName || '')}" aria-label="Name for the kept copy"><button class="btn small primary" data-action="cmp-keep" ${G.nodes.length ? '' : 'disabled'}>Keep a copy of A</button></div>`;
    if (KEPT.length) h += `<table class="t"><thead><tr><th scope="col">Kept graph</th><th scope="col">Hyp.</th><th scope="col">Kept on</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${KEPT.map((k, i) => `<tr><td><input id="cmp-name-${i}" data-cmp-name="${i}" value="${esc(k.name)}" aria-label="Name of kept graph"></td><td>${k.graph.nodes.length}</td><td class="small muted">${esc(k.when || '')}</td><td style="white-space:nowrap"><button class="btn small" data-action="cmp-load" data-i="${i}" title="Put this graph on the canvas (A); undo brings the current one back">Load as A</button> <button class="btn small" data-action="cmp-remove" data-i="${i}" aria-label="Remove ${esc(k.name)}">Remove</button></td></tr>`).join('')}</tbody></table>`;
    h += `<div class="form"><label for="cmpWith" class="small"><b>Compare A with (B)</b><select class="sel" id="cmpWith" style="max-width:none"><option value="">Choose a graph…</option>${keptOpts ? `<optgroup label="Kept graphs">${keptOpts}</optgroup>` : ''}<optgroup label="Templates">${tplOpts}</optgroup><option value="paste" ${CMP.with === 'paste' ? 'selected' : ''}>A pasted share link, share code or saved file</option></select></label>
      ${CMP.with === 'paste' ? `<textarea class="txt" id="cmpPaste" rows="3" placeholder="Paste a share link, share code or JSON" aria-label="Graph to compare with">${esc(CMP.pasted)}</textarea><div class="row-actions"><button class="btn small" data-action="cmp-use-paste">Use it</button></div>${CMP.pasteMsg ? `<p class="err-text">✕ ${esc(CMP.pasteMsg)}</p>` : ''}` : ''}
      <label class="small" for="cmpMatch">Match hypotheses <select class="sel" id="cmpMatch"><option value="label" ${CMP.matchBy === 'label' ? 'selected' : ''}>by label</option><option value="position" ${CMP.matchBy === 'position' ? 'selected' : ''}>by position</option></select></label></div>`;
    if (!T || !G.nodes.length) { el.innerHTML = h + (G.nodes.length ? '' : '<p class="muted">Add hypotheses to the canvas first.</p>'); return; }
    const B = T.graph;
    const mt = matchHypotheses(A, B, CMP.matchBy);
    const stale = (CMP.test && CMP.test.sig !== cmpSig()) || (CMP.power && CMP.power.sig !== cmpSig());
    h += `<div class="cmp-grid"><div><p class="small"><b>A: current graph</b> (${A.nodes.length} hypotheses, α = ${fmtNum(A.alpha)})</p>${graphPicture(A)}</div><div><p class="small"><b>B: ${esc(T.name)}</b> (${B.nodes.length} hypotheses${Math.abs(B.alpha - A.alpha) > 1e-12 ? `, saved with α = ${fmtNum(B.alpha)}; compared at α = ${fmtNum(A.alpha)}` : ''})</p>${graphPicture(B)}</div></div>`;
    if (!mt.same) h += `<p class="small err-text">✕ The two graphs do not list the same hypotheses${CMP.matchBy === 'label' ? ' (matching by label)' : ''}. Only the structure is compared below; rename the hypotheses to match, or match by position when both have ${A.nodes.length === B.nodes.length ? 'the same number' : 'the same number of hypotheses'}.</p>`;
    // structure
    const exA = isAlphaExhaustive(G), GB = deserializeGraph(B, false, 1).G, exB = isAlphaExhaustive(GB);
    const wq = s => Q.parse(String(s)) || Q.ZERO;
    const rows = mt.pairs.map(p => { const a = p.a != null ? wq(A.nodes[p.a].weight) : null, b = p.b != null ? wq(B.nodes[p.b].weight) : null; const diff = a && b ? (Q.eq(a, b) ? '' : (Q.cmp(b, a) > 0 ? '+' : '') + fmt(Q.sub(b, a))) : (a ? 'only in A' : 'only in B'); return `<tr><th scope="row">${esc(p.label)}</th><td class="num">${a ? esc(fmt(a)) : '–'}</td><td class="num">${b ? esc(fmt(b)) : '–'}</td><td class="num ${diff && !/only/.test(diff) ? 'cmp-diff' : 'muted'}">${esc(diff)}</td></tr>`; }).join('');
    const tdiff = transitionDiffs(A, B, mt.pairs);
    h += det('det-cmp-structure', 'Weights and transitions', `<p class="small muted">A is ${exA === true ? '' : 'not '}alpha-exhaustive; B is ${exB === true ? '' : 'not '}alpha-exhaustive.</p>
      <table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">Weight A</th><th scope="col" class="num">Weight B</th><th scope="col" class="num">B − A</th></tr></thead><tbody>${rows}</tbody></table>
      ${tdiff.length ? `<p class="small"><b>Transitions that differ</b> (${tdiff.length})</p><div class="mx-scroll"><table class="t"><thead><tr><th scope="col">From → to</th><th scope="col" class="num">A</th><th scope="col" class="num">B</th></tr></thead><tbody>${tdiff.map(d => `<tr><td>${esc(d.from)} → ${esc(d.to)}</td><td class="num">${d.a ? esc(fmt(d.a)) : '–'}</td><td class="num">${d.b ? esc(fmt(d.b)) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small ok-text">✓ Every transition is the same.</p>'}`, tdiff.length ? `${tdiff.length} transition${tdiff.length === 1 ? '' : 's'} differ` : 'same transitions');
    if (mt.same) {
      // same p-values
      const haveP = allPValid();
      let body = `<p class="small muted">Both graphs are tested with the p-values entered in the Test tab (matched by hypothesis), at α = ${fmtNum(G.alpha)}, with the ${esc(TEST_TYPES[testType()])} test${G.test.upscale ? ', upscaled' : ''}.</p>`;
      if (!haveP) body += '<p class="small">Enter a p-value for every hypothesis in the Test tab first.</p>';
      else body += `<div class="row-actions"><button class="btn small primary" data-action="cmp-test" ${CMP.running ? 'disabled' : ''}>Test both</button></div>`;
      if (CMP.error) body += `<p class="err-text">✕ ${esc(CMP.error)}</p>`;
      if (CMP.test) {
        const r = CMP.test;
        body += (r.sig !== cmpSig() ? '<div class="stale">! Something changed since this run. Press Test both again.</div>' : '') +
          `<table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">p</th><th scope="col" class="num">Adj. p, A</th><th scope="col" class="num">Adj. p, B</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>${r.rows.map(x => `<tr><th scope="row">${esc(x.label)}</th><td class="num">${fmtNum(x.p)}</td><td class="num">${fmtNum(x.adjA)}</td><td class="num">${fmtNum(x.adjB)}</td><td>${x.rejA ? '<span class="status-cell rej">✓</span>' : '✕'}</td><td>${x.rejB ? '<span class="status-cell rej">✓</span>' : '✕'}</td></tr>`).join('')}</tbody></table>
          <p class="small"><b>${esc(r.summary)}</b></p>${r.se ? `<p class="small muted">Parametric values are Monte Carlo estimates; standard error up to ${fmtNum(r.se, 2)}.</p>` : ''}`;
      }
      h += det('det-cmp-test', 'Same p-values', body, CMP.test ? CMP.test.short : '');
      // power
      let pb = `<p class="small muted">Both graphs are simulated on the same trials (common random numbers) with the settings of the Power tab: marginal powers, correlation, success rule and number of simulations. The difference B − A is shown with its standard error.</p>
        <div class="row-actions"><button class="btn small primary" data-action="cmp-power" ${CMP.running || hasErrors() ? 'disabled' : ''}>${CMP.running ? 'Running…' : 'Simulate both'}</button>${CMP.running ? `<span class="progress" id="cmpProgress">${Math.round(100 * CMP.running.done / CMP.running.total)}% done</span>` : ''}</div>`;
      if (CMP.power) {
        const r = CMP.power, t = r.tally, n = t.n, pct = x => (100 * x / n).toFixed(1) + '%';
        const dcell = (n10, n01) => { const d = pairedDiff(n01, n10, n); const s = (100 * d.d).toFixed(1), se = (100 * d.se).toFixed(1); return `<td class="num ${Math.abs(d.d) > 2 * d.se ? 'cmp-diff' : ''}">${d.d > 0 ? '+' : ''}${s} ± ${se}</td>`; };
        pb += (r.sig !== cmpSig() + '|' + powerSig() ? '<div class="stale">! The graphs or the simulation settings changed since this run. Simulate again to update.</div>' : '') +
          `<table class="t"><thead><tr><th scope="col">Hyp.</th><th scope="col" class="num">Power A</th><th scope="col" class="num">Power B</th><th scope="col" class="num">B − A (points) ± SE</th></tr></thead><tbody>${r.labels.map((l, i) => `<tr><th scope="row">${esc(l)}</th><td class="num">${pct(t.rejA[i])}</td><td class="num">${pct(t.rejB[i])}</td>${dcell(t.d10[i], t.d01[i])}</tr>`).join('')}
          <tr><th scope="row">At least one</th><td class="num">${pct(t.anyA)}</td><td class="num">${pct(t.anyB)}</td>${dcell(t.any10, t.any01)}</tr>
          <tr><th scope="row">All</th><td class="num">${pct(t.allA)}</td><td class="num">${pct(t.allB)}</td>${dcell(t.all10, t.all01)}</tr>
          ${r.successText ? `<tr><th scope="row">Success (${esc(r.successText)})</th><td class="num">${pct(t.customA)}</td><td class="num">${pct(t.customB)}</td>${dcell(t.custom10, t.custom01)}</tr>` : ''}
          <tr><th scope="row">Expected number rejected</th><td class="num">${(t.totalA / n).toFixed(2)}</td><td class="num">${(t.totalB / n).toFixed(2)}</td><td class="num">${((t.totalB - t.totalA) / n > 0 ? '+' : '')}${((t.totalB - t.totalA) / n).toFixed(2)}</td></tr></tbody></table>
          <p class="small muted">${n.toLocaleString('en-GB')} simulated trials, ${esc(r.testNote)}, correlation ${esc(r.corrText)}, seed 2009. Differences larger than twice their standard error are highlighted.</p>
          <div class="row-actions"><button class="btn small" data-action="cmp-copy-power">Copy table</button></div>`;
      }
      h += det('det-cmp-power', 'Power on the same trials', pb, CMP.power ? CMP.power.short : '');
    }
    el.innerHTML = h;
  });
}
/* Correlation for B's indices, from the correlations entered for A (a property of the test statistics, not the graph) */
function corrAtForB(mapB) {
  const inv = []; mapB.forEach((jB, iA) => { inv[jB] = iA; });
  return (i, j) => testCorrAt(inv[i], inv[j]);
}
function ctxForB(GB, mapB) {
  const groups = [...new Set(GB.nodes.map(n => n.group).filter(Boolean))].map(g => new Set(GB.nodes.map((n, i) => (n.group === g ? i : -1)).filter(i => i >= 0)));
  return { upscale: !!G.test.upscale, corrAt: corrAtForB(mapB), groups, rand: mulberry32(2011), cache: new Map() };
}
async function runCompareTest() {
  if (CMP.running) return;
  const T = compareTarget(); if (!T) return;
  const A = serializeGraph(G), B = T.graph, mt = matchHypotheses(A, B, CMP.matchBy);
  if (!mt.same || !allPValid()) return;
  const prob = corrProblem();
  if (prob && !/same as Bonferroni/.test(prob)) { CMP.error = prob; renderComparePanel(); return; }
  if (G.nodes.length > 12) { CMP.error = 'The closed test is available for up to 12 hypotheses.'; renderComparePanel(); return; }
  CMP.error = ''; CMP.running = { done: 0, total: 1 }; renderComparePanel();
  try {
    const GB = deserializeGraph(B, false, 1).G;
    const pA = G.nodes.map(n => parseP(n.p)), pB = []; mt.mapB.forEach((jB, iA) => { pB[jB] = pA[iA]; });
    const ctxA = testCtx(), ctxB = ctxForB(GB, mt.mapB);
    const rA = await closedTestAsync(floatGraph(G), pA, G.alpha, testType(), ctxA, () => {});
    const rB = await closedTestAsync(floatGraph(GB), pB, G.alpha, testType(), ctxB, () => {});
    const rows = G.nodes.map((n, i) => ({ label: n.label, p: pA[i], adjA: rA.adj[i], adjB: rB.adj[mt.mapB[i]], rejA: rA.rejected[i], rejB: rB.rejected[mt.mapB[i]] }));
    const onlyA = rows.filter(r => r.rejA && !r.rejB).map(r => r.label), onlyB = rows.filter(r => r.rejB && !r.rejA).map(r => r.label);
    const nA = rows.filter(r => r.rejA).length, nB = rows.filter(r => r.rejB).length;
    const summary = !onlyA.length && !onlyB.length ? `Same result: ${nA ? joinWords(rows.filter(r => r.rejA).map(r => r.label)) + ' rejected' : 'nothing rejected'} by both.` : `A rejects ${nA}, B rejects ${nB}.${onlyA.length ? ` Only A rejects ${joinWords(onlyA)}.` : ''}${onlyB.length ? ` Only B rejects ${joinWords(onlyB)}.` : ''}`;
    CMP.test = { sig: cmpSig(), rows, summary, short: `A ${nA}, B ${nB} rejected`, se: Math.max(rA.se || 0, rB.se || 0) };
  } catch (err) { CMP.error = err.message; }
  CMP.running = null;
  renderComparePanel();
}
function runComparePower() {
  if (CMP.running || hasErrors()) return;
  const T = compareTarget(); if (!T) return;
  const A = serializeGraph(G), B = T.graph, mt = matchHypotheses(A, B, CMP.matchBy);
  if (!mt.same) return;
  CMP.error = '';
  const m = G.nodes.length;
  const pw = G.nodes.map(n => Number(simPower(n.id)));
  if (pw.some(x => !(x > 0 && x < 100))) { CMP.error = 'Each power in the Power tab must be a percentage between 0 and 100.'; renderComparePanel(); return; }
  const Rm = new Float64Array(m * m);
  let capped = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) { const v = i === j ? 1 : Number(corrOf(G.nodes[i].id, G.nodes[j].id)); if (!(v >= -1 && v <= 1)) { CMP.error = 'Correlations in the Power tab must be numbers between −1 and 1.'; renderComparePanel(); return; } Rm[i * m + j] = i === j ? 1 : Math.min(v, 0.999999); if (i < j && v > 0.999999) capped++; }
  const L = cholesky(Rm, m);
  if (!L) { CMP.error = 'The correlations in the Power tab cannot all hold at once (the matrix is not positive definite).'; renderComparePanel(); return; }
  const za = qnorm(1 - G.alpha), mean = pw.map(x => za + qnorm(x / 100));
  const GB = deserializeGraph(B, false, 1).G, fgA = floatGraph(G), fgB = floatGraph(GB);
  const ids = G.nodes.map(n => n.id), sIdx = SIM.success.ids.map(id => ids.indexOf(id)).filter(i => i >= 0);
  const success = sIdx.length ? { idx: sIdx, rule: SIM.success.rule } : null;
  let testerA = null, testerB = null, testNote = 'Bonferroni test';
  if (!isBonf()) {
    if (m > 10) { CMP.error = 'Power with a closed test is available for up to 10 hypotheses.'; renderComparePanel(); return; }
    const prob = corrProblem();
    if (prob && !/same as Bonferroni/.test(prob)) { CMP.error = prob; renderComparePanel(); return; }
    try {
      const ctxA = testCtx(), crA = closedTestCritical(fgA, G.alpha, testType(), ctxA);
      const ctxB = ctxForB(GB, mt.mapB), crB = closedTestCritical(fgB, G.alpha, testType(), ctxB);
      testerA = (p, out) => closedTestFast(m, crA.crit, p, G.alpha, testType(), ctxA, out);
      testerB = (p, out) => closedTestFast(m, crB.crit, p, G.alpha, testType(), ctxB, out);
      testNote = TEST_TYPES[testType()] + ' closed test';
    } catch (err) { CMP.error = err.message; renderComparePanel(); return; }
  }
  const total = SIM.n, tally = newPairedTally(m), norm = normalGen(mulberry32(2009));
  const sig = cmpSig() + '|' + powerSig();
  const corrText = (SIM.useMatrix ? 'set pair by pair' : `${Number(SIM.rho)} for every pair`) + corrCapText(capped);
  const successText = success ? `${success.rule} of ${sIdx.map(i => G.nodes[i].label).join(', ')}` : '';
  const labels = G.nodes.map(n => n.label);
  CMP.running = { done: 0, total }; renderComparePanel();
  const step = () => {
    const k = Math.min(5000, total - tally.n);
    simulatePairedChunk(fgA, fgB, mt.mapB, mean, L, G.alpha, k, norm, tally, success, testerA, testerB);
    CMP.running.done = tally.n;
    const pr = $('cmpProgress'); if (pr) pr.textContent = `${Math.round(100 * tally.n / total)}% done`;
    if (tally.n < total) setTimeout(step, 0);
    else {
      const dAny = pairedDiff(tally.any01, tally.any10, tally.n);
      CMP.running = null;
      CMP.power = { sig, tally, labels, corrText, successText, testNote, short: `at least one: ${(100 * dAny.d > 0 ? '+' : '')}${(100 * dAny.d).toFixed(1)} points` };
      renderComparePanel();
    }
  };
  setTimeout(step, 0);
}
function comparePowerTSV() {
  const r = CMP.power; if (!r) return '';
  const t = r.tally, n = t.n, pct = x => (100 * x / n).toFixed(2);
  const line = (l, a, b, n10, n01) => { const d = pairedDiff(n01, n10, n); return [l, pct(a), pct(b), (100 * d.d).toFixed(2), (100 * d.se).toFixed(2)].join('\t'); };
  const out = ['Hypothesis\tPower A (%)\tPower B (%)\tB − A (points)\tSE'];
  r.labels.forEach((l, i) => out.push(line(l, t.rejA[i], t.rejB[i], t.d10[i], t.d01[i])));
  out.push(line('At least one', t.anyA, t.anyB, t.any10, t.any01));
  out.push(line('All', t.allA, t.allB, t.all10, t.all01));
  if (r.successText) out.push(line('Success (' + r.successText + ')', t.customA, t.customB, t.custom10, t.custom01));
  return out.join('\n');
}
$('tab-compare').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'cmpWith') { CMP.with = t.value; cmpInvalidate(); renderComparePanel(); }
  else if (t.id === 'cmpMatch') { CMP.matchBy = t.value; cmpInvalidate(); renderComparePanel(); }
  else if (t.id === 'cmpPaste') { CMP.pasted = t.value; }
  else if (t.id === 'cmpKeepName') { CMP.keepName = t.value; }
  else if (t.dataset.cmpName != null) { const k = KEPT[+t.dataset.cmpName]; if (k) { k.name = t.value.trim() || k.name; saveKept(); renderComparePanel(); } }
});
$('tab-compare').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'cmp-keep') {
    const name = ($('cmpKeepName').value || '').trim() || `Graph ${KEPT.length + 1}`;
    KEPT.push({ name, graph: serializeGraph(G), when: new Date().toISOString().slice(0, 10) }); saveKept();
    CMP.keepName = ''; if (!CMP.with) CMP.with = 'kept:' + (KEPT.length - 1);
    cmpInvalidate(); renderComparePanel();
  } else if (act === 'cmp-remove') {
    const i = +b.dataset.i; KEPT.splice(i, 1); saveKept();
    if (CMP.with === 'kept:' + i) CMP.with = ''; else if (CMP.with.startsWith('kept:') && +CMP.with.slice(5) > i) CMP.with = 'kept:' + (+CMP.with.slice(5) - 1);
    cmpInvalidate(); renderComparePanel();
  } else if (act === 'cmp-load') {
    const k = KEPT[+b.dataset.i]; if (!k) return;
    loadGraph(JSON.parse(JSON.stringify(k.graph))); setTab('compare'); cmpInvalidate(); renderComparePanel();
  } else if (act === 'cmp-use-paste') {
    CMP.pasted = ($('cmpPaste').value || '').trim();
    try { parseGraphText(CMP.pasted); CMP.pasteMsg = ''; } catch (err) { CMP.pasteMsg = err.message.startsWith('Unexpected') ? 'That text is not valid JSON.' : err.message; }
    cmpInvalidate(); renderComparePanel();
  } else if (act === 'cmp-test') runCompareTest();
  else if (act === 'cmp-power') runComparePower();
  else if (act === 'cmp-copy-power') copyText(comparePowerTSV(), b);
});

/* ---------- toolbar, tabs, modal ---------- */
function updateToolbar() {
  const inT = mode === 'test' && T;
  $('undoBtn').disabled = animating || (inT ? !T.history.length || T.running : !hist.past.length);
  $('redoBtn').disabled = animating || (inT ? !T.redo.length || T.running : !hist.future.length);
  $('undoBtn').title = inT ? 'Step back (Ctrl+Z)' : 'Undo (Ctrl+Z)';
  $('redoBtn').title = inT ? 'Redo step (Ctrl+Y)' : 'Redo (Ctrl+Y)';
  $('modeDesign').setAttribute('aria-pressed', mode === 'design');
  $('modeTest').setAttribute('aria-pressed', mode === 'test');
  $('modeDesign').disabled = animating; $('modeTest').disabled = animating;
  $('addNodeBtn').disabled = mode !== 'design';
  $('clearBtn').disabled = mode !== 'design' || !G.nodes.length;
  const a = $('alphaInput');
  if (document.activeElement !== a) { a.value = fmtNum(G.alpha, 12); a.classList.remove('bad'); }
  const sd = $('sidedSelect');
  if (sd && sd.value !== (G.sided === 'two' ? 'two' : 'one')) sd.value = G.sided === 'two' ? 'two' : 'one';
}
function setAdvanced(on, silent) {
  advanced = !!on;
  store.set('mgs-adv', advanced ? '1' : '0');
  document.body.classList.toggle('simple', !advanced);
  $('advToggle').checked = advanced;
  $('advSwitch').checked = advanced;
  if (!advanced && (activeTab === 'matrix' || activeTab === 'power')) activeTab = 'graph';
  if (!silent) renderAll();
}
function setTab(name) {
  if (!advanced && (name === 'matrix' || name === 'power')) setAdvanced(true);
  activeTab = name;
  for (const t of TABS) {
    $('tab-' + t).hidden = t !== name;
    $('tabbtn-' + t).setAttribute('aria-selected', String(t === name));
    $('tabbtn-' + t).tabIndex = t === name ? 0 : -1;
  }
  if (name === 'export' && exportView && exportView !== 'load') showExport(exportView);
  if (name === 'power') renderPowerPanel();
  if (name === 'compare') renderComparePanel();
  if (name === 'test') renderTestPanel();
}
function renderAll() {
  V = validateGraph(G, fmt);
  renderCanvas();
  renderGraphPanel();
  renderMatrixPanel();
  renderTestPanel();
  if (activeTab === 'power') renderPowerPanel();
  if (activeTab === 'compare') renderComparePanel();
  renderStatus();
  updateToolbar();
  updatePresentBar();
  if (activeTab === 'export' && exportView && exportView !== 'load') showExport(exportView);
}
function setSel(s) {
  sel = s;
  if (s && mode === 'design' && activeTab !== 'matrix') setTab('graph');
  renderCanvas();
  renderGraphPanel();
}
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
  $('modalClose').focus();
}
function closeModal() { $('modal').hidden = true; }
function closeMenu() { $('moreMenu').open = false; $('clearConfirm').hidden = true; }
function startLinking(from) {
  if (mode !== 'design') return;
  linking = { from };
  renderCanvas();
}
function cancelLinking() { if (!linking) return; linking = null; overlay.innerHTML = ''; renderCanvas(); }

/* ---------- inline editor (transition weights, hypothesis labels and weights) ---------- */
function openInline(target) {
  if (mode !== 'design') return;
  let shown;
  if (target.kind === 'edge') {
    const [a, b] = target.key.split('>');
    const e = edgeOf(a, b);
    if (!e) return;
    shown = weightText(e.g, e.expr);
    inl.setAttribute('aria-label', 'Transition weight');
  } else {
    const n = nodeById(target.id);
    if (!n) return;
    shown = target.kind === 'nodew' ? weightText(n.w, n.wexpr) : n.label;
    inl.setAttribute('aria-label', target.kind === 'nodew' ? `Initial weight of ${n.label}` : 'Hypothesis label');
  }
  inline = Object.assign({ shown }, target);
  inl.value = shown;
  inl.style.width = target.kind === 'nodelabel' ? '120px' : '84px';
  inl.classList.remove('bad');
  inl.hidden = false;
  positionInline();
  inl.focus(); inl.select();
  updateHint();
}
function positionInline() {
  if (!inline) return;
  let x, y;
  if (inline.kind === 'edge') {
    const lay = lastLayout.find(l => l.key === inline.key);
    if (!lay) return;
    x = lay.label.x; y = lay.label.y;
  } else {
    const n = nodeById(inline.id);
    if (!n) return;
    x = n.x; y = inline.kind === 'nodew' ? n.y + 11 : n.y - 8;
  }
  const pt = toClient(x, y);
  const wr = svg.parentElement.getBoundingClientRect();
  const w = inline.kind === 'nodelabel' ? 120 : 84;
  inl.style.left = (pt.x - wr.left - w / 2) + 'px';
  inl.style.top = (pt.y - wr.top - 15) + 'px';
}
function commitInline() {
  if (!inline) return true;
  const cur = inline;
  const txt = inl.value.trim();
  if (txt === cur.shown && !cur.isNew) { closeInline(false); return true; }
  if (cur.kind === 'nodelabel') {
    const n = nodeById(cur.id);
    inline = null; inl.hidden = true;
    if (n && txt) { checkpoint(); n.label = txt; afterChange(); } else renderCanvas();
    return true;
  }
  const r = readWeight(txt);
  if (!r) { inl.classList.add('bad'); inl.focus(); return false; }
  const q = r.q;
  if (!cur.isNew) checkpoint();
  inline = null; inl.hidden = true;
  if (cur.kind === 'nodew') { const n = nodeById(cur.id); if (n) { n.w = q; n.wexpr = r.expr || undefined; } }
  else {
    const [a, b] = cur.key.split('>');
    setEdgeWeight(a, b, q, r.expr);
    if (Q.isZero(q) && !r.expr && sel && sel.key === cur.key) sel = null;
  }
  afterChange();
  return true;
}
function closeInline(cancel) {
  if (!inline) return;
  const cur = inline;
  inline = null; inl.hidden = true;
  if (cancel && cur.kind === 'edge' && cur.isNew) {
    G.edges = G.edges.filter(e => gKey(e.from, e.to) !== cur.key);
    hist.past.pop();
    sel = null;
    afterChange();
  } else updateHint();
}
inl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); commitInline(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeInline(true); }
});
inl.addEventListener('blur', () => {
  if (!inline) return;
  if (inline.kind !== 'nodelabel' && !readWeight(inl.value)) closeInline(true);
  else commitInline();
});

/* ---------- pointer interaction ---------- */
function nodeAt(p, exclude) {
  for (let i = G.nodes.length - 1; i >= 0; i--) {
    const n = G.nodes[i];
    if (n.id === exclude) continue;
    if (insideNode({ x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R }, p, 10)) return n;
  }
  return null;
}
function drawTempLink(fromId, p) {
  const a = nodeById(fromId);
  if (!a) return;
  const target = nodeAt(p, fromId);
  const end = target ? borderPoint({ x: target.x, y: target.y, rx: nodeRx(target.label), ry: NODE_R }, a) : p;
  const src = borderPoint({ x: a.x, y: a.y, rx: nodeRx(a.label), ry: NODE_R }, target ? target : p);
  overlay.innerHTML = `<path class="temp-link" d="M${src.x},${src.y} L${end.x},${end.y}" marker-end="url(#ahSel)"/>`;
  world.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (target) { const el = world.querySelector(`[data-node="${target.id}"]`); if (el) el.classList.add('drop-target'); }
}
svg.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const ae = document.activeElement;
  if (ae && ae !== inl && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
  closeMenu(); $('arrangeMenu').open = false;
  if (inline && !commitInline()) return;
  const p = toWorld(e), t = e.target;
  const nodeEl = t.closest('[data-node]'), bendEl = t.closest('[data-bend]'), labEl = t.closest('[data-elabel]'), edgeEl = t.closest('[data-edge]');
  if (linking) {
    e.preventDefault();
    const from = linking.from;
    const target = nodeEl ? nodeEl.dataset.node : (nodeAt(p, from) || {}).id;
    linking = null; overlay.innerHTML = '';
    if (target && target !== from) createLink(from, target); else renderCanvas();
    return;
  }
  let kind = 'empty', id = '';
  if (nodeEl) { kind = 'node'; id = nodeEl.dataset.node; }
  else if (bendEl) { kind = 'bend'; id = bendEl.dataset.bend; }
  else if (labEl) { kind = 'label'; id = labEl.dataset.elabel; }
  else if (edgeEl) { kind = 'edge'; id = edgeEl.dataset.edge; }
  const now = performance.now();
  const isDouble = now - lastDown.time < 420 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 9 && lastDown.kind === kind && lastDown.id === id;
  lastDown = { time: isDouble ? 0 : now, x: e.clientX, y: e.clientY, kind, id };
  const base = { sx: e.clientX, sy: e.clientY, start: p, moved: false, isDouble, kind, id };
  if (animating && kind !== 'empty') return;
  if (kind === 'node') {
    const n = nodeById(id);
    const onHandle = t.classList.contains('handle'), onRing = t.classList.contains('node-ring');
    drag = (onRing || onHandle) && mode === 'design' ? Object.assign(base, { type: 'link', from: id, handle: onHandle }) : Object.assign(base, { type: 'move', ox: n.x, oy: n.y });
    if (mode === 'design' && !(sel && sel.type === 'node' && sel.id === id)) setSel({ type: 'node', id });
  } else if ((kind === 'bend' || kind === 'label') && mode === 'design') {
    const wasSel = sel && sel.type === 'edge' && sel.key === id;
    if (!wasSel) setSel({ type: 'edge', key: id });
    const lay = lastLayout.find(l => l.key === id);
    drag = Object.assign(base, { type: 'bend', key: id, wasSel: wasSel && kind === 'label', t: kind === 'bend' ? 0.5 : (lay ? lay.label.t : 0.5) });
  } else if (kind === 'edge' && mode === 'design') {
    if (!(sel && sel.type === 'edge' && sel.key === id)) setSel({ type: 'edge', key: id });
    drag = Object.assign(base, { type: 'none' });
  } else {
    if (sel && kind === 'empty') setSel(null);
    drag = Object.assign(base, { type: 'pan', cx: view.cx, cy: view.cy });
  }
  try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  e.preventDefault();
});
svg.addEventListener('pointermove', e => {
  if (!drag) {
    if (linking) drawTempLink(linking.from, toWorld(e));
    return;
  }
  const p = toWorld(e);
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  const first = !drag.moved;
  drag.moved = true;
  if (drag.type === 'move') {
    const n = nodeById(drag.id);
    if (!n) return;
    if (first) checkpoint();
    let x = drag.ox + p.x - drag.start.x, y = drag.oy + p.y - drag.start.y;
    if (snap) { x = Math.round(x / 20) * 20; y = Math.round(y / 20) * 20; }
    n.x = x; n.y = y;
    renderCanvas();
  } else if (drag.type === 'link') {
    drawTempLink(drag.from, p);
  } else if (drag.type === 'bend') {
    const [ka, kb] = drag.key.split('>');
    const ed = edgeOf(ka, kb);
    if (!ed) return;
    if (first) checkpoint();
    const a = nodeById(ed.from), b = nodeById(ed.to);
    const t = Math.min(0.85, Math.max(0.15, drag.t));
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const qx = a.x + t * dx, qy = a.y + t * dy;
    let bend = ((p.x - qx) * nx + (p.y - qy) * ny) / (4 * t * (1 - t));
    if (Math.abs(bend) < 5) bend = 0;
    ed.bend = Math.max(-400, Math.min(400, bend));
    renderCanvas();
  } else if (drag.type === 'pan') {
    svg.classList.add('panning');
    view.cx = drag.cx - (e.clientX - drag.sx) / view.k;
    view.cy = drag.cy - (e.clientY - drag.sy) / view.k;
    autoFit = false;
    applyView();
  }
});
function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag; drag = null;
  svg.classList.remove('panning');
  try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  if (cancelled) { overlay.innerHTML = ''; renderCanvas(); return; }
  const p = toWorld(e);
  if (d.type === 'link') {
    overlay.innerHTML = '';
    const target = d.moved ? nodeAt(p, d.from) : null;
    if (target) { createLink(d.from, target.id); return; }
    if (!d.moved && d.handle) { startLinking(d.from); drawTempLink(d.from, p); return; }
    renderCanvas();
    return;
  }
  if (d.type === 'move') {
    if (d.moved) { scheduleHash(); updateToolbar(); if (activeTab === 'export' && exportView && exportView !== 'load') showExport(exportView); return; }
    if (mode === 'test') { tryReject(d.id); return; }
    if (d.isDouble && mode === 'design') {
      const n = nodeById(d.id);
      if (n) openInline({ kind: d.start.y > n.y + 2 ? 'nodew' : 'nodelabel', id: n.id });
    }
    return;
  }
  if (d.type === 'bend') {
    if (d.moved) { renderGraphPanel(); scheduleHash(); updateToolbar(); return; }
    if (d.isDouble || d.wasSel) openInline({ kind: 'edge', key: d.key });
    return;
  }
  if (d.type === 'pan') {
    if (!d.moved && d.isDouble && mode === 'design') addNodeAt(p.x, p.y);
    return;
  }
  if (d.type === 'none' && d.isDouble && d.kind === 'edge') openInline({ kind: 'edge', key: d.id });
}
svg.addEventListener('pointerup', e => endDrag(e, false));
svg.addEventListener('pointercancel', e => endDrag(e, true));
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const p = toWorld(e);
  /* Firefox reports a mouse-wheel notch in lines (deltaMode 1, about 3 per notch) or pages (2), not pixels;
     convert so a notch zooms about as much as in Chrome and Safari (about 100 pixels per notch) */
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? (svg.clientHeight || 800) : 1);
  const k2 = Math.max(0.25, Math.min(3, view.k * Math.exp(-dy * 0.0015)));
  view.cx = p.x - (p.x - view.cx) * view.k / k2;
  view.cy = p.y - (p.y - view.cy) * view.k / k2;
  view.k = k2;
  autoFit = false;
  applyView();
}, { passive: false });
svg.addEventListener('keydown', e => {
  const nodeEl = e.target.closest && e.target.closest('[data-node]');
  if (!nodeEl) return;
  const id = nodeEl.dataset.node, n = nodeById(id);
  if (!n) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (linking && linking.from !== id) { const from = linking.from; linking = null; createLink(from, id); return; }
    if (mode === 'test') tryReject(id); else setSel({ type: 'node', id });
    return;
  }
  if (presenting) return;
  const st = e.shiftKey ? 4 : 20;
  const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
  if (d) {
    e.preventDefault();
    checkpoint();
    n.x += d[0]; n.y += d[1];
    if (!(sel && sel.id === id)) sel = { type: 'node', id };
    renderCanvas(); updateToolbar(); scheduleHash();
  }
});

/* ---------- panel events (delegated) ---------- */
$('tab-graph').addEventListener('change', e => {
  const t = e.target;
  const n = sel && sel.type === 'node' ? nodeById(sel.id) : null;
  if (t.id === 'node-label' && n) {
    const v = t.value.trim();
    if (!v || v === n.label) { t.value = n.label; return; }
    checkpoint(); n.label = v; deferChange();
  } else if (t.id === 'node-w' && n) {
    const r = readWeight(t.value);
    if (!r) { t.classList.add('bad'); return; }
    if (Q.eq(r.q, n.w) && (r.expr || '') === (n.wexpr || '')) return;
    checkpoint(); n.w = r.q; n.wexpr = r.expr || undefined; deferChange();
  } else if (t.dataset.var) {
    const q = Q.parse(t.value);
    if (!q) { t.classList.add('bad'); return; }
    if (G.vars[t.dataset.var] && Q.eq(q, G.vars[t.dataset.var])) return;
    checkpoint(); G.vars[t.dataset.var] = q; CT = null; deferChange();
  } else if (t.id === 'node-color-custom' && n) {
    setColors([n.id], validColor(t.value));
  } else if (t.id === 'node-desc' && n) {
    if (t.value.trim() === (n.desc || '')) return;
    checkpoint(); n.desc = t.value.trim(); setTimeout(renderAll, 0); scheduleHash();
  } else if (t.id === 'node-group' && n) {
    if (t.value.trim() === (n.group || '')) return;
    checkpoint(); n.group = t.value.trim(); setTimeout(renderAll, 0); scheduleHash();
  } else if (t.id === 'node-p' && n) {
    n.p = t.value.trim();
    resetTest(); setTimeout(renderAll, 0); scheduleHash();
  } else if (t.dataset.edgeInput) {
    const [a, b] = t.dataset.edgeInput.split('>');
    const r = readWeight(t.value);
    if (!r) { t.classList.add('bad'); return; }
    const ex = edgeOf(a, b);
    if (ex && Q.eq(ex.g, r.q) && (r.expr || '') === (ex.expr || '')) return;
    checkpoint(); setEdgeWeight(a, b, r.q, r.expr); deferChange();
  } else if (t.id === 'edge-g' && sel && sel.type === 'edge') {
    const [a, b] = sel.key.split('>');
    const r = readWeight(t.value);
    if (!r) { t.classList.add('bad'); return; }
    const ex = edgeOf(a, b);
    if (ex && Q.eq(ex.g, r.q) && (r.expr || '') === (ex.expr || '')) return;
    checkpoint(); setEdgeWeight(a, b, r.q, r.expr);
    if (Q.isZero(r.q) && !r.expr) sel = null;
    deferChange();
  } else if (t.id === 'edge-bend') {
    bendSliding = false; renderGraphPanel(); scheduleHash();
  }
});
$('tab-graph').addEventListener('keydown', e => {
  if (e.target.id !== 'tplW' || !tplW) return;
  if (e.key === 'Enter') { e.preventDefault(); if (!createImprovedFallbackI(e.target.value, $('tplWMsg'))) tplW.msg = $('tplWMsg').textContent; }
  else if (e.key === 'Escape') { e.stopPropagation(); tplW = null; renderGraphPanel(); }
});
$('tab-graph').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'tplW' && tplW) { tplW.text = t.value; return; }
  if (t.id === 'edge-bend' && sel && sel.type === 'edge') {
    const [a, b] = sel.key.split('>');
    const ed = edgeOf(a, b);
    if (!ed) return;
    if (!bendSliding) { checkpoint(); bendSliding = true; updateToolbar(); }
    ed.bend = +t.value;
    renderCanvas();
  }
});
$('tab-graph').addEventListener('click', e => {
  const sw = e.target.closest('button[data-color]');
  if (sw && sel && sel.type === 'node') { setColors([sel.id], sw.dataset.color); return; }
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'select-node') setSel({ type: 'node', id: b.dataset.id });
  else if (act === 'select-edge') setSel({ type: 'edge', key: b.dataset.key });
  else if (act === 'deselect') setSel(null);
  else if (act === 'delete-node' || act === 'delete-edge') deleteSelection();
  else if (act === 'connect' && sel && sel.type === 'node') startLinking(sel.id);
  else if (act === 'color-all' && sel && sel.type === 'node') { const c = (nodeById(sel.id) || {}).color || ''; setColors(G.nodes.map(n => n.id), c); }
  else if (act === 'equal-row' && sel && sel.type === 'node') doFix({ act: 'equalRow', id: sel.id });
  else if (act === 'equal-w') doFix({ act: 'equalW' });
  else if (act === 'tpl-w-create' && tplW) { const txt = $('tplW').value; if (!createImprovedFallbackI(txt, $('tplWMsg'))) tplW.msg = $('tplWMsg').textContent; }
  else if (act === 'tpl-w-cancel') { tplW = null; renderGraphPanel(); }
  else if (act === 'vars-fix') { checkpoint(); G.nodes.forEach(n => { delete n.wexpr; }); G.edges.forEach(e => { delete e.expr; }); G.vars = {}; afterChange(); }
  else if (act === 'join') { const k = $('joinSelect').value; if (TEMPLATES[k]) loadGraph(joinGraphs(G, deserializeGraph(templateJSON(k), false, 1).G)); }
  else if (act === 'subgraph') {
    const keep = [...document.querySelectorAll('#tab-graph [data-keep]')].filter(c => c.checked).map(c => c.dataset.keep);
    if (!keep.length) return;
    if (keep.length < G.nodes.length) loadGraph(subgraphOf(G, keep));
  }
  else if (act === 'remove-edge') {
    checkpoint(); G.edges = G.edges.filter(x => gKey(x.from, x.to) !== b.dataset.key); afterChange();
  } else if (act === 'add-edge' && sel && sel.type === 'node') {
    const to = $('node-add-to').value, q = Q.parse($('node-add-g').value);
    if (!q || Q.isZero(q)) { const m = $('node-add-msg'); m.hidden = false; m.textContent = '✕ Enter a weight above 0, such as 1/2.'; return; }
    checkpoint(); setEdgeWeight(sel.id, to, q); afterChange();
  } else if ((act === 'bend-auto' || act === 'bend-straight') && sel && sel.type === 'edge') {
    const [x, y] = sel.key.split('>');
    const ed = edgeOf(x, y);
    if (!ed) return;
    checkpoint(); ed.bend = act === 'bend-auto' ? null : 0; afterChange();
  }
});
$('tab-matrix').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.mw) {
    const n = nodeById(t.dataset.mw);
    const r = readWeight(t.value);
    if (!r) { t.classList.add('bad'); return; }
    if (Q.eq(r.q, n.w) && (r.expr || '') === (n.wexpr || '')) return;
    checkpoint(); n.w = r.q; n.wexpr = r.expr || undefined; deferChange();
  } else if (t.dataset.mg) {
    const [a, b] = t.dataset.mg.split('>');
    const r = readWeight(t.value);
    if (!r) { t.classList.add('bad'); return; }
    const q = r.q;
    if (a !== b) {
      const ex = edgeOf(a, b);
      if ((ex && Q.eq(ex.g, q) && (r.expr || '') === (ex.expr || '')) || (!ex && Q.isZero(q) && !r.expr)) return;
      checkpoint(); setEdgeWeight(a, b, q, r.expr); deferChange(); return;
    }
    if (a === b) {
      const old = G.diag[a] || Q.ZERO;
      if (Q.eq(old, q)) return;
      checkpoint();
      if (Q.isZero(q)) delete G.diag[a]; else G.diag[a] = q;
    } else {
      const ex = edgeOf(a, b);
      if ((ex && Q.eq(ex.g, q)) || (!ex && Q.isZero(q))) return;
      checkpoint(); setEdgeWeight(a, b, q);
    }
    deferChange();
  }
});
$('tab-matrix').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const act = b.dataset.action;
  if (act === 'import') doImport();
  else if (act === 'mx-current' || act === 'mx-initial') { mxView = act === 'mx-current' ? 'current' : 'initial'; renderMatrixPanel(); }
  else if (act === 'import-current') {
    $('imp-w').value = `c(${G.nodes.map(n => rNum(n.w)).join(', ')})`;
    $('imp-g').value = `matrix(c(\n${matrixRows(G, rNum).map(r => '  ' + r.join(', ')).join(',\n')}\n), nrow = ${G.nodes.length}, byrow = TRUE)`;
    $('imp-names').value = `c(${G.nodes.map(n => rStr(n.label)).join(', ')})`;
  }
});
$('tab-test').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.p) {
    const n = nodeById(t.dataset.p);
    if (!n) return;
    n.p = t.value.trim();
    resetTest();
    setTimeout(renderAll, 0);
    scheduleHash();
  } else if (t.id === 'testType') {
    checkpoint(); G.test.type = t.value; CT = null; afterChange();
  } else if (t.id === 'upscaleToggle') {
    checkpoint(); G.test.upscale = t.checked; CT = null; afterChange();
  } else if (t.dataset.tcorr) {
    const v = t.value.trim();
    if (v === '') { checkpoint(); delete G.test.corr[t.dataset.tcorr]; CT = null; deferChange(); return; }
    const x = Number(v);
    if (!(x >= -1 && x <= 1)) { t.classList.add('bad'); return; }
    checkpoint(); G.test.corr[t.dataset.tcorr] = x; CT = null; deferChange();
  } else if (t.id === 'plainToggle') {
    plain = t.checked; store.set('mgs-plain', plain ? '1' : '0'); renderTestPanel(); renderGraphPanel();
  } else if (t.id === 'manualToggle') {
    manual = t.checked;
    renderCanvas(); renderTestPanel();
  }
});
$('tab-test').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'enter-test') { manual = false; setMode('test'); }
  else if (act === 'exit-test') { setMode('design'); setTab('test'); }
  else if (act === 'step') stepOnce(false);
  else if (act === 'run') runAllSteps();
  else if (act === 'reject') tryReject(b.dataset.id);
  else if (act === 'tc-fill') { const x = Number($('tcFill').value); if (!(x >= -1 && x <= 1)) return; checkpoint(); G.nodes.forEach((a, i) => G.nodes.forEach((c, j) => { if (j > i) G.test.corr[a.id < c.id ? a.id + '|' + c.id : c.id + '|' + a.id] = x; })); CT = null; afterChange(); }
  else if (act === 'tc-clear') { checkpoint(); G.test.corr = {}; CT = null; afterChange(); }
  else if (act === 'tc-from-sim') { checkpoint(); G.nodes.forEach((a, i) => G.nodes.forEach((c, j) => { if (j > i) { const v = Number(corrOf(a.id, c.id)); if (v >= -1 && v <= 1) G.test.corr[a.id < c.id ? a.id + '|' + c.id : c.id + '|' + a.id] = v; } })); CT = null; afterChange(); }
  else if (act === 'step-back') stepBack();
  else if (act === 'redo-step') redoStep();
  else if (act === 'mode-p') setWhatIf(false);
  else if (act === 'mode-whatif') setWhatIf(true);
  else if (act === 'reset') { T = newTest(); renderAll(); }
  else if (act === 'wit-show') { wit = { target: b.dataset.target, set: b.dataset.set ? b.dataset.set.split(',') : [], level: +b.dataset.level, step: T ? T.step : -1, sig: testSig() }; renderCanvas(); renderTestPanel(); }
  else if (act === 'wit-hide') { wit = null; renderCanvas(); renderTestPanel(); }
  else if (act === 'wit-force') { witForce = true; renderTestPanel(); }
  else if (act === 'try-order') { T = newTest(); renderAll(); flashMessage('Now reject the green hypotheses in a different order by clicking them. The result will be the same.'); }
  else if (act === 'paste-p') {
    const msg = $('pasteMsg');
    try {
      const v = parseVector($('pastePs').value).values;
      if (v.length !== G.nodes.length) throw new Error(`Found ${v.length} values for ${G.nodes.length} hypotheses.`);
      const xs = v.map(Q.toNum);
      if (xs.some(x => !(x >= 0 && x <= 1))) throw new Error('Every p-value must be between 0 and 1.');
      G.nodes.forEach((n, i) => { n.p = fmtNum(xs[i], 12); });
      resetTest(); renderAll(); scheduleHash();
    } catch (err) { msg.hidden = false; msg.textContent = '✕ ' + err.message; }
  }
});
$('tab-power').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pw) { SIM.power[t.dataset.pw] = t.value.trim(); setTimeout(renderPowerPanel, 0); }
  else if (t.id === 'sim-rho') { SIM.rho = t.value.trim(); SIM.error = ''; setTimeout(renderPowerPanel, 0); }
  else if (t.id === 'sim-usematrix') { SIM.useMatrix = t.checked; renderPowerPanel(); }
  else if (t.dataset.corr) { SIM.corr[t.dataset.corr] = t.value.trim(); SIM.error = ''; setTimeout(renderPowerPanel, 0); }
  else if (t.id === 'sim-n') { SIM.n = Number(t.value); }
  else if (t.name === 'sim-rule') { SIM.success.rule = t.value; renderPowerPanel(); }
  else if (t.dataset.succ) {
    const id = t.dataset.succ;
    SIM.success.ids = t.checked ? [...new Set([...SIM.success.ids, id])] : SIM.success.ids.filter(x => x !== id);
    renderPowerPanel();
  } else if (t.dataset.runname) { SIM.runs[+t.dataset.runname].name = t.value.trim() || `Run ${+t.dataset.runname + 1}`; }
});
$('tab-power').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'sim-run') runSim();
  else if (act === 'sim-keep' && SIM.result) {
    const t = SIM.result.tally, n = t.n, pct = x => (100 * x / n).toFixed(1) + '%';
    SIM.runs.push({ name: `Run ${SIM.runs.length + 1}`, labels: SIM.result.labels, power: t.rej.map(pct), any: pct(t.any), all: pct(t.all), custom: SIM.result.successText ? pct(t.custom) : '' });
    openDetails.add('det-runs');
    renderPowerPanel();
  } else if (act === 'sim-clear') { SIM.runs = []; renderPowerPanel(); }
  else if (act === 'sim-copy-r') copyText(powerRCode(), b, 'simRCode');
});
$('tab-export').addEventListener('click', e => {
  const ex = e.target.closest('[data-export]');
  if (ex) { showExport(ex.dataset.export); return; }
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const act = b.dataset.action;
  if (act === 'go-advanced') setAdvanced(true);
  else if (act === 'copy') copyText(exportPayload, b);
  else if (act === 'copy-sap-text') { const sp = sapText(G); copyRich(sapPlainText(sp) + '\n\n' + sapRefsText(sp), sapParasHTML(sp) + sapRefsHTML(sp), b, 'sapText'); }
  else if (act === 'copy-sap-tables') copyRich(sapText(G).tables.map(tableToTSV).join('\n\n'), sapText(G).tables.map(tableToHTML).join(''), b, 'sapTable0');
  else if (act === 'copy-sap-all') copyRich(exportPayload, sapHTML, b, 'sapText');
  else if (act === 'download') download(b.dataset.file, b.dataset.mime, exportPayload, b);
  else if (act === 'download-png') download('multiplicity-graph.png', 'image/png', dataUrlToBlob(exportPayload), b);
  else if (act === 'load-text') loadFromText($('loadText').value);
});
$('tab-export').addEventListener('change', e => {
  if (e.target.id !== 'loadFile') return;
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => loadFromText(String(r.result));
  r.onerror = () => { const m = $('loadMsg'); if (m) m.innerHTML = '<p class="err-text">✕ Could not read that file.</p>'; };
  r.readAsText(f);
});
$('statusBar').addEventListener('click', e => {
  const b = e.target.closest('[data-fix]');
  if (b) doFix(statusFixes[+b.dataset.fix]);
});
$('starter').addEventListener('click', e => {
  const sz = e.target.closest('[data-size]');
  if (sz) { starterM = Math.max(2, Math.min(10, starterM + Number(sz.dataset.size))); renderStarter(); return; }
  const c = e.target.closest('[data-start]');
  if (!c) return;
  const k = c.dataset.start;
  if (k === 'import') openImport();
  else if (k === 'improvedFallbackI') openImprovedFallbackI();
  else if (TEMPLATE_GEN[k]) loadGraph(generatedTemplate(k, starterM));
  else loadGraph(templateJSON(k));
});
$('starterWBtn').addEventListener('click', () => createImprovedFallbackI($('starterW').value, $('starterWMsg')));
$('starterW').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); createImprovedFallbackI($('starterW').value, $('starterWMsg')); } else if (e.key === 'Escape') { starterWOpen = false; renderStarter(); } });

/* ---------- toolbar events ---------- */
$('modeDesign').addEventListener('click', () => setMode('design'));
$('modeTest').addEventListener('click', () => setMode('test'));
$('alphaInput').addEventListener('change', e => {
  const q = Q.parse(e.target.value);
  const a = q ? Q.toNum(q) : NaN;
  if (!(a > 0 && a < 1)) { e.target.classList.add('bad'); return; }
  e.target.classList.remove('bad');
  if (a === G.alpha) return;
  checkpoint(); G.alpha = a; deferChange();
});
$('sidedSelect').addEventListener('change', e => {
  const v = e.target.value === 'two' ? 'two' : 'one';
  if (v === G.sided) return;
  checkpoint(); G.sided = v; CT = null; deferChange();
});
$('addNodeBtn').addEventListener('click', () => { const s = freeSpot(); addNodeAt(s.x, s.y); });
$('templateSelect').addEventListener('change', e => {
  const v = e.target.value;
  e.target.value = '';
  if (v === 'cycle') { const m = Math.max(2, Math.min(12, starterM)); loadGraph(cycleTemplate(m)); }
  else if (v === 'truncatedHolm') loadGraph(truncatedHolmTemplate());
  else if (v === 'improvedFallbackIAny') openImprovedFallbackI();
  else if (v && TEMPLATES[v]) loadGraph(templateJSON(v));
});
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('snapToggle').addEventListener('change', e => { snap = e.target.checked; store.set('mgs-snap', snap ? '1' : '0'); });
$('decToggle').addEventListener('change', e => { numMode = e.target.checked ? 'dec' : 'frac'; store.set('mgs-num', numMode); renderAll(); });
$('advToggle').addEventListener('change', e => setAdvanced(e.target.checked));
$('advSwitch').addEventListener('change', e => setAdvanced(e.target.checked));
$('hintToggle').addEventListener('change', e => { hints = e.target.checked; store.set('mgs-hints', hints ? '1' : '0'); updateHint(); });
$('hintClose').addEventListener('click', () => { hints = false; $('hintToggle').checked = false; store.set('mgs-hints', '0'); updateHint(); });
function applySkin(v) {
  if (v === 'auto') delete document.documentElement.dataset.skin; else document.documentElement.dataset.skin = v;
}
$('skinSelect').addEventListener('change', e => { applySkin(e.target.value); store.set('mgs-skin', e.target.value); });
$('importBtn').addEventListener('click', () => { closeMenu(); openImport(); });
$('clearBtn').addEventListener('click', () => { $('clearConfirm').hidden = false; $('clearNo').focus(); });
$('clearNo').addEventListener('click', () => { $('clearConfirm').hidden = true; });
$('clearYes').addEventListener('click', () => {
  checkpoint(); G = { nodes: [], edges: [], diag: {}, alpha: G.alpha, sided: G.sided, note: '', test: defaultTest() }; sel = null;
  closeMenu(); afterChange(); fitView();
});
$('moreMenu').addEventListener('toggle', () => {
  if (!$('moreMenu').open) return;
  const r = $('moreMenu').getBoundingClientRect();
  document.querySelector('.menu-pop').classList.toggle('flip', r.left + 300 > window.innerWidth);
});
document.addEventListener('click', e => { if ($('moreMenu').open && !$('moreMenu').contains(e.target)) closeMenu(); });
$('shapeGrid').innerHTML = SHAPES.map(([k, nm]) => `<button class="shape-btn" data-shape="${k}">${shapeIcon(k)}<span>${nm}</span></button>`).join('');
$('shapeGrid').addEventListener('click', e => { const b = e.target.closest('[data-shape]'); if (b) arrangeAs(b.dataset.shape); });
function setGap(g) { arrGap = g; store.set('mgs-gap', g); document.querySelectorAll('#gapSeg [data-gap]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gap === g))); }
$('gapSeg').addEventListener('click', e => { const b = e.target.closest('[data-gap]'); if (b) setGap(b.dataset.gap); });
document.addEventListener('click', e => { if ($('arrangeMenu').open && !$('arrangeMenu').contains(e.target)) $('arrangeMenu').open = false; });
$('zoomIn').addEventListener('click', () => zoomBy(1.25));
$('zoomOut').addEventListener('click', () => zoomBy(0.8));
$('zoomFit').addEventListener('click', fitView);
for (const t of TABS) $('tabbtn-' + t).addEventListener('click', () => setTab(t));
document.querySelector('.tabs').addEventListener('keydown', e => {
  const i = TABS.indexOf(activeTab);
  let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
  if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
  if (j != null) { e.preventDefault(); setTab(TABS[j]); $('tabbtn-' + TABS[j]).focus(); }
});
$('helpBtn').addEventListener('click', () => openModal('Help and shortcuts', `
  <p><b>The basics</b></p>
  <ul class="tips">
    <li><b>Start:</b> pick a template, or double-click empty space to add a hypothesis.</li>
    <li><b>Connect:</b> drag the blue dot of a hypothesis onto another one (or click the dot, then the target). Type the weight and press <span class="kbd">Enter</span>.</li>
    <li><b>Change a number:</b> double-click a hypothesis to rename it or change its weight; click a selected arrow's label to change its weight.</li>
    <li><b>Fix problems:</b> anything wrong shows under the canvas, usually with a one-click fix.</li>
    <li><b>Test:</b> open the Test tab, enter p-values and press Run test.</li>
  </ul>
  <p><b>More</b></p>
  <ul class="tips">
    <li><b>Step through a test:</b> Step shows one rejection at a time, with the weight moving along the arrows. Teaching tools let you reject any hypothesis by hand.</li>
    <li><b>Adjusted p-values</b> and <b>pasting all p-values at once</b> sit under the p-value table.</li>
    <li><b>Power:</b> the Power tab simulates how often each hypothesis is rejected, and lets you keep runs to compare designs.</li>
    <li><b>Compare:</b> keep a copy of the graph, change it, and the Compare tab shows both pictures, the weights and transitions that differ, the test result on the same p-values and the power on the same simulated trials.</li>
    <li><b>Matrix tab:</b> edit w and G as numbers, or import R code. In Test mode it shows the graph after each step.</li>
    <li><b>Export:</b> picture, TikZ, R code for graphicalMCP or gMCP, a share link, or a saved file.</li>
  </ul>
  <p><b>Shortcuts</b></p>
  <ul class="tips">
    <li><span class="kbd">Delete</span> removes the selection. <span class="kbd">Esc</span> cancels or deselects.</li>
    <li><span class="kbd">Ctrl</span> <span class="kbd">Z</span> undo, <span class="kbd">Ctrl</span> <span class="kbd">Y</span> redo (<span class="kbd">Cmd</span> on a Mac).</li>
    <li><span class="kbd">Tab</span> moves between hypotheses, arrow keys move the focused one (<span class="kbd">Shift</span> for small steps), <span class="kbd">Enter</span> selects it.</li>
    <li>Scroll to zoom, drag empty space to pan, Fit re-centres.</li>
  </ul>
  <p><b>What the guarantee rests on</b></p>
  <ul class="tips">
    <li><b>Bonferroni graph:</b> strong control of the familywise error rate at &alpha; for any dependence between the tests (Bretz et al., 2009). The p-values must be valid; say in the toolbar whether they are one-sided or two-sided.</li>
    <li><b>Weighted Simes:</b> needs positively regression dependent (PRDS) test statistics, for example one-sided multivariate normal statistics with non-negative correlations (Bretz et al., 2011, section 3.3; Benjamini and Heller, 2007); negative dependence can inflate the level (Samuel-Cahn, 1996).</li>
    <li><b>Parametric:</b> needs one-sided p-values whose statistics are multivariate normal with the correlations you enter (Xi et al., 2017; gMCP manual).</li>
    <li><b>Weights that sum to less than 1</b> are valid but waste alpha (Hommel et al., 2007); <b>&epsilon;</b> is evaluated as 1/1000 rather than symbolically.</li>
  </ul>
  <p class="small muted">Weights are kept as exact fractions and shown as fractions when the denominator is 100 or less. Type decimals (0.25) or fractions (1/3).</p>`));
function showSelfTest() {
  const r = runAllSelfTests().concat(runClosureSelfTests(), runLiteratureSelfTests());
  const passed = r.filter(x => x.pass).length;
  openModal('Self-test', `<p><b>${passed} of ${r.length} checks passed.</b></p><ul class="check-list">${r.map(x => `<li><span class="${x.pass ? 'pass' : 'fail'}">${x.pass ? '✓ Pass' : '✕ Fail'}</span><span>${esc(x.name)}${x.detail ? `<br><span class="small muted">${esc(x.detail)}</span>` : ''}</span></li>`).join('')}</ul>`);
}
$('debugBtn').addEventListener('click', showSelfTest);
$('selftestBtn').addEventListener('click', () => { closeMenu(); showSelfTest(); });
/* ---------- About, references and licence ---------- */
const REFERENCES = [
  ['Bretz2009', 'Bretz F, Maurer W, Brannath W, Posch M (2009). A graphical approach to sequentially rejective multiple test procedures. Statistics in Medicine 28(4):586–604. doi:10.1002/sim.3495', 'The graphical approach: weights, transition matrix, the update algorithm and adjusted p-values. Everything in Design and the Bonferroni test.'],
  ['Bretz2011', 'Bretz F, Posch M, Glimm E, Klinglmüller F, Maurer W, Rohmeyer K (2011). Graphical approaches for multiple comparison procedures using weighted Bonferroni, Simes, or parametric tests. Biometrical Journal 53(6):894–913. doi:10.1002/bimj.201000239', 'Graph as the weighting strategy of a closed test; weighted Simes and parametric intersection tests; the free combination condition (p. 895). Its Bonferroni mixture of Simes tests (eq. 8) is what graphicalMCP uses; the Simes within groups option here follows gMCP instead.'],
  ['Xi2017', 'Xi D, Glimm E, Maurer W, Bretz F (2017). A unified framework for weighted parametric multiple test procedures. Biometrical Journal 59(5):918–931. doi:10.1002/bimj.201600233', 'The parametric test used here: adjusted p-values within blocks of known correlation, Bonferroni between blocks.'],
  ['BMH2011', 'Bretz F, Maurer W, Hommel G (2011). Test and power considerations for multiple endpoint analyses using sequentially rejective graphical procedures. Statistics in Medicine 30(13):1489–1501. doi:10.1002/sim.3988', 'Worked trial example (three doses, two endpoints template) and power measures.'],
  ['Maurer2011', 'Maurer W, Glimm E, Bretz F (2011). Multiple and repeated testing of primary, coprimary, and secondary hypotheses. Statistics in Biopharmaceutical Research 3(2):336–352. doi:10.1198/sbr.2010.10010', 'Successive procedures (the two doses, two endpoints and successive templates).'],
  ['Glimm2010', 'Glimm E, Maurer W, Bretz F (2010). Hierarchical testing of multiple endpoints in group-sequential trials. Statistics in Medicine 29(2):219–228. doi:10.1002/sim.3748', 'Why a secondary hypothesis must not be tested at the full α once its primary is rejected at an interim analysis (cited in the SAP interim analyses placeholder).'],
  ['MaurerBretz2013a', 'Maurer W, Bretz F (2013). Memory and other properties of multiple test procedures generated by entangled graphs. Statistics in Medicine 32(10):1739–1753. doi:10.1002/sim.5711', 'Entangled graphs (not covered here); the definition of an alpha-exhaustive weighting scheme (eq. 3).'],
  ['MaurerBretz2013b', 'Maurer W, Bretz F (2013). Multiple testing in group sequential trials using graphical approaches. Statistics in Biopharmaceutical Research 5(4):311–320.', 'Group sequential use of a graph (not covered here): boundaries from the spending function at the local level, repeated p-values.'],
  ['Hommel2007', 'Hommel G, Bretz F, Maurer W (2007). Powerful short-cuts for multiple testing procedures with special reference to gatekeeping strategies. Statistics in Medicine 26(22):4063–4073. doi:10.1002/sim.2873', 'Why the step-by-step procedure equals the full closed test; improved parallel gatekeeping.'],
  ['Hommel2008', 'Hommel G, Bretz F (2008). Aesthetics and power considerations in multiple testing: a contradiction? Biometrical Journal 50(5):657–666. doi:10.1002/bimj.200710463', 'Shows the weakness of the fallback procedure that the improved fallback graphs address; the improved fallback II graph itself is Bretz et al. (2009), Fig. 11.'],
  ['Wiens2003', 'Wiens BL (2003). A fixed sequence Bonferroni procedure for testing multiple endpoints. Pharmaceutical Statistics 2(3):211–215. doi:10.1002/pst.64', 'The fallback procedure.'],
  ['Wiens2005', 'Wiens BL, Dmitrienko A (2005). The fallback procedure for evaluating a single family of hypotheses. Journal of Biopharmaceutical Statistics 15(6):929–942.', 'Improved fallback I.'],
  ['Westfall2001', 'Westfall PH, Krishen A (2001). Optimally weighted, fixed sequence, and gatekeeping multiple testing procedures. Journal of Statistical Planning and Inference 99(1):25–40.', 'Fixed-sequence testing.'],
  ['Zhang2015', 'Zhang Z, Wang C, Troendle JF (2015). Optimizing the order of hypotheses in serial testing of multiple endpoints in clinical trials. Statistics in Medicine 34(9):1467–1482.', 'Why the order of a fixed sequence matters, and when Holm is safer (fixed sequence template notes).'],
  ['Paux2018', 'Paux G, Dmitrienko A (2018). Penalty-based approaches to evaluating multiplicity adjustments in clinical trials: traditional multiplicity problems. Journal of Biopharmaceutical Statistics 28(1):146–168.', 'Fixed sequence lacks robustness when the effects are uncertain (fixed sequence template notes).'],
  ['Dmitrienko2003', 'Dmitrienko A, Offen WW, Westfall PH (2003). Gatekeeping strategies for clinical trials that do not require all primary effects to be significant. Statistics in Medicine 22(15):2387–2400. doi:10.1002/sim.1526', 'Parallel gatekeeping.'],
  ['Li2023', 'Li X, Deng Q, Ting N (2023). Consistency based multiplicity adjustment approach: multiple doses in phase III studies. Statistics in Biopharmaceutical Research 15(4):748–754. doi:10.1080/19466315.2022.2127872', 'Section 3.4: the correlation between two dose-versus-control z statistics (correlation help in the Power and Test tabs).'],
  ['Zhao2010', 'Zhao YD, Dmitrienko A, Tamura R (2010). Design and analysis considerations in clinical trials with a sensitive subpopulation. Statistics in Biopharmaceutical Research 2(1):72–83.', 'Eq. 4: the correlation between a full-population test and a subgroup test (correlation help).'],
  ['Westfall2008', 'Westfall PH, Tsai K, Ogenstad S, Tomoiaga A, Moseley S, Lu Y (2008). Clinical trials simulation: a statistical approach. Journal of Biopharmaceutical Statistics 18(4):611–630. doi:10.1080/10543400802071303', 'Binary endpoints need the tetrachoric correlation as the latent-normal input (correlation help).'],
  ['XiChen2024', 'Xi D, Chen Y (2024). Optimal weighted Bonferroni tests and their graphical extensions. Statistics in Medicine 43(3):475–500.', 'Eq. 2: the mean of a z statistic from its marginal power (Power tab).'],
  ['Dmitrienko2008', 'Dmitrienko A, Tamhane AC, Wiens BL (2008). General multistage gatekeeping procedures. Biometrical Journal 50(5):667–677.', 'Truncated Holm (the γ template).'],
  ['Huque2013', 'Huque MF, Dmitrienko A, D\'Agostino R (2013). Multiplicity issues in clinical trials with multiple objectives. Statistics in Biopharmaceutical Research 5(4):321–337. doi:10.1080/19466315.2013.807749', 'Fig. 4: the improved fallback graph with any split r of the last hypothesis\'s level between the earlier ones; also fixed sequence, fallback and truncated Holm drawn as graphs.'],
  ['Holm1979', 'Holm S (1979). A simple sequentially rejective multiple test procedure. Scandinavian Journal of Statistics 6(2):65–70.', 'Bonferroni-Holm.'],
  ['Marcus1976', 'Marcus R, Peritz E, Gabriel KR (1976). On closed testing procedures with special reference to ordered analysis of variance. Biometrika 63(3):655–660.', 'The closure principle.'],
  ['Simes1986', 'Simes RJ (1986). An improved Bonferroni procedure for multiple tests of significance. Biometrika 73(3):751–754.', 'The Simes test.'],
  ['Sarkar1998', 'Sarkar SK (1998). Some probability inequalities for ordered MTP2 random variables: a proof of the Simes conjecture. Annals of Statistics 26(2):494–504.', 'The (unweighted) Simes inequality for MTP2 statistics.'],
  ['SamuelCahn1996', 'Samuel-Cahn E (1996). Is the Simes improved Bonferroni procedure conservative? Biometrika 83(4):928–933.', 'When the Simes test is not valid (negative dependence).'],
  ['Brannath2009', 'Brannath W, Bretz F, Maurer W, Sarkar S (2009). Trimmed weighted Simes’ test for two one-sided hypotheses with arbitrarily correlated test statistics. Biometrical Journal 51(6):885–898. doi:10.1002/bimj.200900132', 'Inflation of the one-sided Simes test under negative correlation (up to 1.5α for two hypotheses); the trimmed test is not offered here.'],
  ['BH1997', 'Benjamini Y, Hochberg Y (1997). Multiple hypotheses testing with weights. Scandinavian Journal of Statistics 24(3):407–418.', 'The weighted Simes test.'],
  ['BY2001', 'Benjamini Y, Yekutieli D (2001). The control of the false discovery rate in multiple testing under dependency. Annals of Statistics 29(4):1165–1188.', 'Positive regression dependence (PRDS); one-sided multivariate normal statistics with non-negative correlations are PRDS.'],
  ['Kling2005', 'Kling Y (2005). Issues of multiple hypotheses testing in statistical process control. PhD thesis, Tel Aviv University.', 'The PRDS result for the weighted Simes test, as cited by Bretz et al. (2011, section 3.3); unpublished, so not checked here.'],
  ['BHeller2007', 'Benjamini Y, Heller R (2007). False discovery rates for spatial signals. Journal of the American Statistical Association 102(480):1272–1281.', 'The one-sided multivariate normal example (non-negative correlations) under which the weighted Simes test is valid, as cited by Bretz et al. (2011, section 3.3).'],
  ['BrannathBretz2010', 'Brannath W, Bretz F (2010). Shortcuts for locally consonant closed test procedures. Journal of the American Statistical Association 105(490):660–669.', 'Restricted hypotheses (when the free combination condition fails).'],
  ['Strassburger2008', 'Strassburger K, Bretz F (2008). Compatible simultaneous lower confidence bounds for the Holm procedure and other Bonferroni-based closed tests. Statistics in Medicine 27(24):4914–4927. doi:10.1002/sim.3338', 'Simultaneous confidence intervals compatible with Bonferroni-based closed tests (not computed here).'],
  ['Guilbaud2008', 'Guilbaud O (2008). Simultaneous confidence regions corresponding to Holm’s step-down procedure and other closed-testing procedures. Biometrical Journal 50(5):678–692. doi:10.1002/bimj.200710449', 'Simultaneous confidence regions for Holm, fixed sequence, gatekeeping and fallback procedures (not computed here).'],
  ['Guilbaud2018', 'Guilbaud O (2018). Simultaneous confidence intervals compatible with sequentially rejective graphical procedures. Statistics in Biopharmaceutical Research 10(3):220–232. doi:10.1080/19466315.2018.1497532', 'Simultaneous confidence intervals for graphical procedures (not computed here); truncated Holm as a graph for two primary hypotheses only.'],
  ['Klinglmueller2014', 'Klinglmueller F, Posch M, Koenig F (2014). Adaptive graph-based multiple testing procedures. Pharmaceutical Statistics 13(6):345–356. doi:10.1002/pst.1640', 'Graphical procedures in adaptive designs with an interim analysis (not covered here).'],
  ['Lu2016', 'Lu K (2016). Graphical approaches using a Bonferroni mixture of weighted Simes tests. Statistics in Medicine 35(22):4041–4055.', 'Adjusted p-values for the Bonferroni mixture of Simes tests (Bretz et al., 2011, eq. 8).'],
  ['FDA2022', 'US Food and Drug Administration (2022). Multiple Endpoints in Clinical Trials: Guidance for Industry. October 2022.', 'Regulatory context; graphical approaches in the Appendix, section 8.'],
  ['EMA2002', 'European Medicines Agency, CPMP (2002). Points to consider on multiplicity issues in clinical trials. CPMP/EWP/908/99.', 'Regulatory context: strong control, prespecification in the protocol or analysis plan.'],
  ['EMA2017', 'European Medicines Agency, CHMP (2017). Guideline on multiplicity issues in clinical trials (draft). EMA/CHMP/44762/2017.', 'Draft to replace the 2002 Points to Consider. Hierarchical testing in sections 5.1 and 6.2; the procedure must be in the protocol. It does not name graphical approaches.'],
  ['Genz2009', 'Genz A, Bretz F (2009). Computation of Multivariate Normal and t Probabilities. Lecture Notes in Statistics 195. Springer. doi:10.1007/978-3-642-01689-9', 'The randomised lattice rule used for the multivariate normal probabilities in the parametric test.'],
  ['gMCP', 'Rohmeyer K, Klinglmüller F (2024). gMCP: Graph Based Multiple Comparison Procedures. R package version 0.8-17. https://github.com/kornl/gMCP', 'Templates, ε convention, upscale option, Simes within groups rule; R export.'],
  ['graphicalMCP', 'Xi D, Brockmann E (2025). graphicalMCP: Graphical Multiple Comparison Procedures. R package version 0.3.0. https://openpharma.github.io/graphicalMCP/', 'R export and the validation scripts.']
];
/* SAP text: paragraphs with their bold lead-ins, and the reference list (sapText in core.js) */
function sapPlainText(sap) { return sap.paragraphs.join('\n\n'); }
function sapParasHTML(sap) { return sap.paragraphs.map((t, i) => { const h = sap.heads && sap.heads[i]; return h && t.startsWith(h + '. ') ? `<p><b>${esc(h)}.</b> ${esc(t.slice(h.length + 2))}</p>` : `<p>${esc(t)}</p>`; }).join(''); }
function sapRefsText(sap) { return sap.refs && sap.refs.length ? 'References\n' + sap.refs.join('\n') : ''; }
function sapRefsHTML(sap) { return sap.refs && sap.refs.length ? `<p><b>References</b></p>${sap.refs.map(r => `<p class="small">${esc(r)}</p>`).join('')}` : ''; }
function aboutHTML() {
  const refs = REFERENCES.map(r => `<li id="ref-${r[0]}">${esc(r[1])}<br><span class="small muted">${esc(r[2])}</span></li>`).join('');
  return `<p><b>Multiplicity Graph Sketchpad</b> version ${esc(APP_VERSION)} (${esc(APP_DATE)}). A single-page tool for drawing, testing and documenting graphical multiple comparison procedures. It runs entirely in your browser; nothing you enter is sent anywhere.</p>
  <p><b>Author</b><br>Niamh Fitzgerald${AUTHOR_URL ? ` (<a class="ext" href="${esc(AUTHOR_URL)}" target="_blank" rel="noopener">LinkedIn</a>)` : ''}${AUTHOR_ORCID ? `<br>ORCID: <a class="ext" href="${esc(AUTHOR_ORCID)}" target="_blank" rel="noopener">${esc(AUTHOR_ORCID.replace('https://orcid.org/', ''))}</a>` : ''}</p>
  <p><b>How to cite</b><br>Fitzgerald N (2026). Multiplicity Graph Sketchpad, version ${esc(APP_VERSION)}. Newcastle University and GSK.${REPO_URL ? ' ' + esc(REPO_URL) : ''}</p>
  <p><b>Licence</b><br>MIT Licence. Copyright (c) 2026 Niamh Fitzgerald. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. The software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.</p>
  <p class="small muted">Fonts: Atkinson Hyperlegible (Braille Institute of America) and JetBrains Mono (JetBrains), both under the SIL Open Font License 1.1, embedded in this file.</p>
  <p><b>Please check before relying on a result</b></p>
  <ul class="tips">
    <li>The Bonferroni procedure controls the familywise error rate in the strong sense for any dependence between the test statistics. The Simes options need positively dependent (PRDS or MTP2) one-sided statistics; the parametric option needs one-sided p-values whose statistics are multivariate normal with the correlations you enter. The SAP text states the condition for the test you chose.</li>
    <li>Parametric adjusted p-values are Monte Carlo estimates (512-point lattice, 12 random shifts); the standard error is shown with the result. For a regulatory submission, confirm them in R with graphicalMCP or gMCP using the exported code.</li>
    <li>Closed tests are available for up to 12 hypotheses; the step-by-step view, adjusted p-values and power simulation for the Bonferroni graph have no such limit (power up to 10 for closed tests).</li>
    <li>Not covered: trimmed Simes tests, entangled graphs (memory; Maurer and Bretz, 2013, Statistics in Medicine), group sequential designs (Maurer and Bretz, 2013, Statistics in Biopharmaceutical Research), adaptive designs (Klinglmueller, Posch and Koenig, 2014), simultaneous confidence intervals (Strassburger and Bretz, 2008; Guilbaud, 2008; Guilbaud, 2018), sample size. The R packages above cover some of these.</li>
    <li>Two-sided p-values can be entered for the Bonferroni and Simes tests; the parametric test refuses them. For the Bonferroni graph, two-sided p-values with a check of the direction of the effect amount to one-sided testing at &alpha;/2. For the closed Simes test they do not: an effect in the harmful direction can help other hypotheses to be rejected, so use one-sided p-values for claims of benefit.</li>
    <li>With the Simes or parametric tests, a graph that is not alpha-exhaustive does not guarantee its order of testing: a hypothesis can be rejected while the hypotheses that pass weight to it are not.</li>
    <li>The hypotheses are assumed to satisfy the free combination condition (Holm, 1979). If some combinations of true and false hypotheses are impossible (restricted hypotheses), the procedures still control the familywise error rate but may be conservative (Bretz et al., 2011, p. 895; Brannath and Bretz, 2010); the tool does not exploit such restrictions.</li>
    <li>Regulatory context: the FDA guidance on multiple endpoints (2022, Appendix, section 8) describes graphical approaches, and the EMA points to consider on multiplicity (2002) ask for the procedure to be fully specified in the protocol or statistical analysis plan.</li>
  </ul>
  <p><b>Validation</b><br>The built-in self-test (More menu) checks the engine against worked examples from the papers below and against direct implementations of Holm, Hommel and the closed tests. Results were cross-checked against graphicalMCP for the Bonferroni, Simes and parametric tests.${REPO_URL ? ' The source and the test scripts are in the repository.' : ''}</p>
  <p><b>References</b></p><ol class="refs">${refs}</ol>`;
}
function showAbout() { closeMenu(); openModal('About this tool', aboutHTML()); }
$('aboutBtn').addEventListener('click', showAbout);
$('versionBtn').textContent = 'v' + APP_VERSION;
$('versionBtn').addEventListener('click', showAbout);

$('modalClose').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

document.addEventListener('keydown', e => {
  if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (presenting && !typing) {
    if (e.key === 'Escape') { exitPresent(); return; }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); if (!(e.target.closest && e.target.closest('[data-node]'))) stepOnce(false); else stepOnce(false); return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); stepBack(); return; }
    if (e.key === 'r' || e.key === 'R') { T = newTest(); renderAll(); return; }
  }
  if (e.key === 'Escape') {
    if ($('moreMenu').open) { closeMenu(); return; }
    if ($('arrangeMenu').open) { $('arrangeMenu').open = false; return; }
    if (linking) { cancelLinking(); return; }
    if (!typing && sel) setSel(null);
    return;
  }
  if (typing || mod) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && mode === 'design') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === '?') $('helpBtn').click();
});

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (!h.startsWith('g1') || (G.nodes.length && h === encodeShare(G))) return;
  try { loadGraph(decodeShare(h)); } catch (err) { /* ignore bad links */ }
});
/* Refit when the canvas gets wider or narrower (window resized, phone turned), unless the user has moved the view */
let lastCanvasW = 0;
new ResizeObserver(() => {
  const w = Math.round(svg.getBoundingClientRect().width);
  if (autoFit && lastCanvasW && Math.abs(w - lastCanvasW) > 2) fitView(); else applyView();
  lastCanvasW = w;
}).observe(svg);

/* ---------- start ---------- */
(function init() {
  const sk = store.get('mgs-skin');
  if (sk && ['auto', 'cream', 'white', 'dark'].includes(sk)) { $('skinSelect').value = sk; applySkin(sk); }
  if (store.get('mgs-num') === 'dec') { numMode = 'dec'; $('decToggle').checked = true; }
  if (store.get('mgs-snap') === '1') { snap = true; $('snapToggle').checked = true; }
  if (GAPS[store.get('mgs-gap')]) setGap(store.get('mgs-gap'));
  if (store.get('mgs-plain') === '1') plain = true;
  setAdvanced(store.get('mgs-adv') === '1', true);
  if (store.get('mgs-hints') === '0') { hints = false; $('hintToggle').checked = false; }
  initMatrixStatic();
  initExportPanel();
  loadKept();
  let loaded = false;
  const h = location.hash.slice(1);
  if (h.startsWith('g1')) { try { loadGraph(decodeShare(h), { checkpoint: false }); loaded = true; } catch (err) { /* fall back to the example */ } }
  if (!loaded) {
    loadGraph(templateJSON('bretz'), { checkpoint: false });
    const ps = ['0.004', '0.009', '0.011', '0.03'];
    G.nodes.forEach((n, i) => { n.p = ps[i] || ''; });
  }
  hist.past = []; hist.future = [];
  renderAll();
  requestAnimationFrame(fitView);
  resolveDownloads();
})();
