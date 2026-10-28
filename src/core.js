'use strict';
/* Version shown in About, the footer and the exports. Bump on every published change. */
const APP_VERSION = '1.3.6';
const APP_DATE = '2026-10-28';
/* Public home of the source; shown in About when set. Repository name: multiplicity-graph-sketchpad. */
const REPO_URL = 'https://github.com/niamhfitzgerald/multiplicity-graph-sketchpad';
/* The author's LinkedIn profile; the header byline and About link to it. */
const AUTHOR_URL = 'https://www.linkedin.com/in/niamh-fitzgerald-59481422a';
/* The author's ORCID iD; About links to it, and CITATION.cff lists it. */
const AUTHOR_ORCID = 'https://orcid.org/0009-0006-2866-2892';
/* =====================================================================
   CORE: exact rational arithmetic, graph model, the sequentially
   rejective update (Bretz et al., 2009), parsers, exporters, self-test.
   Nothing in this section touches the DOM, so it can be reused or
   extended (e.g. weighted Simes / parametric tests) without UI changes.
   ===================================================================== */

/* ---------- Exact rationals (BigInt) ---------- */
const Q = (() => {
  const abs = x => (x < 0n ? -x : x);
  function gcd(a, b) { a = abs(a); b = abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
  function make(n, d) {
    if (d === 0n) throw new Error('Division by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    return Object.freeze({ n: n / g, d: d / g });
  }
  const ZERO = make(0n, 1n), ONE = make(1n, 1n);
  const add = (a, b) => make(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => make(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => make(a.n * b.n, a.d * b.d);
  const div = (a, b) => make(a.n * b.d, a.d * b.n);
  const cmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
  const eq = (a, b) => a.n === b.n && a.d === b.d;
  const isZero = a => a.n === 0n;
  function toNum(a) {
    if (abs(a.n) < 9007199254740992n && a.d < 9007199254740992n) return Number(a.n) / Number(a.d);
    const s = 10n ** 18n;
    return Number((a.n * s) / a.d) / 1e18;
  }
  function parseDec(s) {
    const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) return null;
    const ip = m[2] || '', fp = m[3] || '';
    if (ip === '' && fp === '') return null;
    let n = BigInt((ip + fp) || '0');
    let d = 10n ** BigInt(fp.length);
    const e = m[4] ? parseInt(m[4], 10) : 0;
    if (Math.abs(e) > 300) return null;
    if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
    if (m[1] === '-') n = -n;
    return make(n, d);
  }
  function parse(str) {
    if (str == null) return null;
    let s = String(str).replace(/[\u2212\u2013]/g, '-').trim().replace(/\s*\/\s*/g, '/').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
    while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
    if (s === '' || /\s/.test(s)) return null;
    const parts = s.split('/');
    if (parts.length === 1) return parseDec(parts[0]);
    if (parts.length === 2) {
      const a = parseDec(parts[0]), b = parseDec(parts[1]);
      if (!a || !b || isZero(b)) return null;
      return div(a, b);
    }
    return null;
  }
  function fromNumber(x) { return Number.isFinite(x) ? parse(String(x)) : null; }
  const exact = a => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
  function dec(a) {
    const x = toNum(a);
    if (x === 0) return '0';
    if (Math.abs(x) >= 0.001) return String(Number(x.toFixed(4)));
    return String(Number(x.toPrecision(3)));
  }
  /* Display: exact fraction when the denominator is small, else a decimal. */
  function fmt(a, mode) {
    if (a.d === 1n) return `${a.n}`;
    if (mode !== 'dec' && a.d <= 100n) return `${a.n}/${a.d}`;
    return dec(a);
  }
  const isExactShort = a => a.d <= 100n;
  return { make, ZERO, ONE, add, sub, mul, div, cmp, eq, isZero, toNum, parse, fromNumber, exact, fmt, dec, isExactShort };
})();

/* Plain number display (alpha, local levels, p-values) to 4 significant figures */
function fmtNum(x, sig = 4) {
  if (x == null || !Number.isFinite(x)) return '';
  if (x === 0) return '0';
  return String(Number(x.toPrecision(sig)));
}

/* p-values: decimals, scientific notation or fractions; must lie in [0, 1] */
function parseP(s) {
  if (s == null || String(s).trim() === '') return null;
  const q = Q.parse(s);
  if (!q) return NaN;
  const x = Q.toNum(q);
  return x >= 0 && x <= 1 ? x : NaN;
}

/* ---------- Symbolic weights: expressions in variables such as epsilon, gamma ---------- */
const GREEK = { eps: 'ε', epsilon: 'ε', gamma: 'γ', delta: 'δ', nu: 'ν', tau: 'τ', omega: 'ω', theta: 'θ', lambda: 'λ', beta: 'β', rho: 'ρ', phi: 'φ', psi: 'ψ', kappa: 'κ', mu: 'μ', sigma: 'σ', alpha_: 'α' };
function normaliseExpr(s) {
  /* Spaces are dropped except between two names or numbers ("gamma gamma", "1 2"), where they stay and make the tokenizer report an error */
  const t = String(s).replace(/[−–]/g, '-').replace(/·|×/g, '*').trim().replace(/\s+/g, ' ');
  const word = /[A-Za-z_0-9.Ͱ-Ͽ]/;
  let out = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === ' ' && !(i > 0 && word.test(t[i - 1]) && i + 1 < t.length && word.test(t[i + 1]))) continue;
    out += t[i];
  }
  return out.replace(/[A-Za-z_][A-Za-z_0-9]*/g, w => GREEK[w.toLowerCase()] || w);
}
/* Returns {vars: [names]} or throws; tokens: numbers, names, + - * / ( ) */
function tokenizeExpr(src) {
  const out = []; let i = 0;
  const s = normaliseExpr(src);
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push({ t: 'num', v: s.slice(i, j) }); i = j; }
    else if (/[A-Za-z_Ͱ-Ͽ]/.test(ch)) { let j = i; while (j < s.length && /[A-Za-z_0-9Ͱ-Ͽ]/.test(s[j])) j++; out.push({ t: 'var', v: s.slice(i, j) }); i = j; }
    else if ('+-*/()'.includes(ch)) { out.push({ t: ch }); i++; }
    else throw new Error(`Unexpected character "${ch}" in a weight.`);
  }
  return out;
}
function exprVars(src) { try { return [...new Set(tokenizeExpr(src).filter(t => t.t === 'var').map(t => t.v))]; } catch (e) { return []; } }
function isExpr(src) { return /[A-Za-z_Ͱ-Ͽ]/.test(String(src)); }
/* Evaluates an expression exactly (Q) with variable values vars: {name: Q}. Throws on unknown variables. */
function evalExpr(src, vars) {
  const T = tokenizeExpr(src); let k = 0;
  const peek = () => T[k], next = () => T[k++];
  function atom() {
    const t = next();
    if (!t) throw new Error('A weight ended unexpectedly.');
    if (t.t === 'num') { const q = Q.parse(t.v); if (!q) throw new Error(`Could not read "${t.v}".`); return q; }
    if (t.t === 'var') { if (!vars || !vars[t.v]) throw new Error(`Unknown variable ${t.v}.`); return vars[t.v]; }
    if (t.t === '(') { const v = sum(); if (!peek() || peek().t !== ')') throw new Error('Missing ).'); next(); return v; }
    if (t.t === '-') return Q.sub(Q.ZERO, atom());
    if (t.t === '+') return atom();
    throw new Error(`Unexpected "${t.t}" in a weight.`);
  }
  function prod() { let v = atom(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = atom(); if (op === '/' && Q.isZero(r)) throw new Error('Division by zero in a weight.'); v = op === '*' ? Q.mul(v, r) : Q.div(v, r); } return v; }
  function sum() { let v = prod(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = prod(); v = op === '+' ? Q.add(v, r) : Q.sub(v, r); } return v; }
  const v = sum();
  if (k < T.length) throw new Error('Could not read the whole weight.');
  return v;
}
function exprDisplay(src) { return normaliseExpr(src).replace(/-/g, '−').replace(/\*/g, '·'); }
function exprTeX(src) {
  const names = { 'ε': '\\epsilon', 'γ': '\\gamma', 'δ': '\\delta', 'ν': '\\nu', 'τ': '\\tau', 'ω': '\\omega', 'θ': '\\theta', 'λ': '\\lambda', 'β': '\\beta', 'ρ': '\\rho', 'φ': '\\phi', 'ψ': '\\psi', 'κ': '\\kappa', 'μ': '\\mu', 'σ': '\\sigma' };
  return '$' + normaliseExpr(src).replace(/[Ͱ-Ͽ]/g, c => names[c] || c).replace(/\*/g, '\\cdot ') + '$';
}
/* Default value for a new variable: epsilon is tiny, anything else is 1/2 */
function defaultVarValue(name) { return name === 'ε' ? Q.make(1n, 1000n) : Q.make(1n, 2n); }
/* Re-evaluates every symbolic weight in G from G.vars. Returns a list of problems (unknown variables get defaults). */
function evaluateGraph(G) {
  G.vars = G.vars || {};
  const problems = [];
  const items = [...G.nodes.filter(n => n.wexpr).map(n => ({ obj: n, key: 'w', src: n.wexpr })), ...G.edges.filter(e => e.expr).map(e => ({ obj: e, key: 'g', src: e.expr }))];
  /* Entangled graphs: the stored copies of the other components and the component weights c_h are symbolic too */
  if (G.ent) {
    G.ent.comps.forEach((cs, k) => {
      if (k === G.ent.active) return;
      for (const id of Object.keys(cs.wexpr || {})) if (cs.wexpr[id]) items.push({ obj: cs.w, key: id, src: cs.wexpr[id] });
      for (const e of cs.edges) if (e.expr) items.push({ obj: e, key: 'g', src: e.expr });
    });
    (G.ent.cexpr || []).forEach((src, k) => { if (src) items.push({ obj: G.ent.c, key: k, src }); });
  }
  for (const it of items) for (const v of exprVars(it.src)) if (!G.vars[v]) G.vars[v] = defaultVarValue(v);
  for (const it of items) {
    try { it.obj[it.key] = evalExpr(it.src, G.vars); }
    catch (e) { problems.push(e.message); it.obj[it.key] = Q.ZERO; }
  }
  const used = new Set(items.flatMap(it => exprVars(it.src)));
  for (const v of Object.keys(G.vars)) if (!used.has(v)) delete G.vars[v];
  return problems;
}
/* Sets a weight from user text: a number, or an expression that becomes symbolic */
function weightFromText(G, txt) {
  const q = Q.parse(txt);
  if (q) return { q, expr: null };
  if (!isExpr(txt)) return null;
  G.vars = G.vars || {};
  for (const v of exprVars(txt)) if (!G.vars[v]) G.vars[v] = defaultVarValue(v);
  try { return { q: evalExpr(txt, G.vars), expr: normaliseExpr(txt) }; } catch (e) { return null; }
}

/* ---------- Graph model ---------- */
const NODE_R = 36;
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[ilj.,:;|!'1 ]/.test(ch)) w += 0.32;
    else if (/[mwMW]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.64;
    else w += 0.54;
  }
  return w * size;
}
/* "H12" renders as H with subscript 12, so it is narrower than plain text */
function labelParts(label) {
  const m = /^([A-Za-z]{1,3})_?(\d{1,3})$/.exec(String(label));
  return m ? { base: m[1], sub: m[2] } : null;
}
function nodeRx(label) {
  const lp = labelParts(label);
  const w = lp ? textWidth(lp.base, 17) + textWidth(lp.sub, 12) : textWidth(label, 15);
  return Math.min(110, Math.max(NODE_R, w / 2 + 14));
}
const gKey = (a, b) => `${a}>${b}`;

/* ---------- The sequentially rejective update ---------- */
/* state: { ids: [remaining ids], w: Map id->Q, g: Map 'a>b'->Q } */
function getg(st, a, b) { return st.g.get(gKey(a, b)) || Q.ZERO; }

function rejectNode(st, j) {
  if (st.ent) return rejectNodeEntangled(st, j);
  const rem = st.ids.filter(x => x !== j);
  const wj = st.w.get(j) || Q.ZERO;
  const w = new Map();
  for (const l of rem) w.set(l, Q.add(st.w.get(l) || Q.ZERO, Q.mul(wj, getg(st, j, l))));
  const g = new Map();
  for (const l of rem) {
    const glj = getg(st, l, j), gjl = getg(st, j, l);
    const prod = Q.mul(glj, gjl);
    for (const k of rem) {
      if (l === k) continue;
      let v = Q.ZERO;
      if (Q.cmp(prod, Q.ONE) < 0) {
        v = Q.div(Q.add(getg(st, l, k), Q.mul(glj, getg(st, j, k))), Q.sub(Q.ONE, prod));
      }
      if (!Q.isZero(v)) g.set(gKey(l, k), v);
    }
  }
  return { ids: rem, w, g };
}

/* ---------------------------------------------------------------------
   PLUG-IN POINT for group sequential designs (out of scope for now).
   A GSD extension would replace the single comparison p_j <= w_j * alpha
   in isRejectable() below with a stage-wise boundary check (e.g. the
   local level w_j * alpha spent through an alpha-spending function at the
   current analysis), and keep rejectNode() unchanged: the graph update
   after a rejection is the same. Test mode would also need a "current
   analysis" control.
   --------------------------------------------------------------------- */
function isRejectable(st, id, pOf, alpha) {
  const p = pOf(id);
  if (p == null || !Number.isFinite(p)) return false;
  const level = Q.toNum(st.w.get(id) || Q.ZERO) * alpha;
  /* A hypothesis with no level cannot be rejected, even at p = 0: this matches the closed test and
     Algorithm 2, where p_j / w_j is taken as infinite when w_j = 0. */
  return level > 0 && p <= level * (1 + 1e-12);
}
function rejectableIds(st, pOf, alpha) { return st.ids.filter(id => isRejectable(st, id, pOf, alpha)); }

/* Every order in which the procedure could reject, explored over sets of
   rejected hypotheses (the graph after rejecting a set does not depend on
   the order). Returns the number of possible orders and every final set. */
function orderAnalysis(st0, pOf, alpha, maxStates = 20000) {
  const memo = new Map(), finals = new Set();
  let states = 0, capped = false;
  const realVisit = (rej, st) => {
    const key = rej.slice().sort().join(',');
    if (memo.has(key)) return memo.get(key);
    if (++states > maxStates) { capped = true; return 0n; }
    const R = rejectableIds(st, pOf, alpha);
    let count = 0n;
    if (!R.length) { finals.add(key); count = 1n; }
    else for (const j of R) count += realVisit(rej.concat(j), rejectNode(st, j));
    memo.set(key, count);
    return count;
  };
  const orders = realVisit([], st0);
  return { orders, finals: [...finals].map(k => k ? k.split(',') : []), capped };
}

/* "What would it take": for one hypothesis, look at every set of OTHER open
   hypotheses that could be rejected, and the level the target would then
   have. The graph after rejecting a set does not depend on the order, so
   each set is visited once. Subsets are enumerated, so the caller limits m. */
function whatWouldItTake(st, target, pOf, alpha, maxOthers = 10) {
  const others = st.ids.filter(i => i !== target);
  const m = others.length;
  if (m > maxOthers) return { tooMany: true, m };
  const memo = new Map([['', st]]);
  const stateFor = key => {
    if (memo.has(key)) return memo.get(key);
    const ids = key.split(',');
    const s = rejectNode(stateFor(ids.slice(0, -1).join(',')), ids[ids.length - 1]);
    memo.set(key, s);
    return s;
  };
  const all = [];
  for (let mask = 0; mask < (1 << m); mask++) {
    const set = others.filter((_, i) => mask & (1 << i));
    const s = stateFor(set.join(','));
    const w = s.w.get(target) || Q.ZERO;
    all.push({ set, mask, w, level: Q.toNum(w) * alpha });
  }
  const now = all[0];
  let best = now;
  for (const r of all) if (r.level > best.level + 1e-15 || (Math.abs(r.level - best.level) <= 1e-15 && r.set.length < best.set.length)) best = r;
  const p = pOf(target);
  let minimal = null;
  if (p != null && Number.isFinite(p)) {
    const ok = all.filter(r => r.level > 0 && p <= r.level * (1 + 1e-12));
    minimal = ok.filter(r => !ok.some(q => q.mask !== r.mask && (q.mask & r.mask) === q.mask))
      .sort((a, b) => a.set.length - b.set.length || b.level - a.level);
  }
  return { tooMany: false, others, now, best, minimal, p, sets: all.length };
}

/* Any H_j with p_j <= w_j * alpha. If several qualify, take the smallest p/(w alpha). */
function findCandidate(st, pOf, alpha) {
  let best = null;
  for (const id of st.ids) {
    const p = pOf(id);
    if (p == null || !Number.isFinite(p)) continue;
    const level = Q.toNum(st.w.get(id) || Q.ZERO) * alpha;
    if (level > 0 && p <= level * (1 + 1e-12)) {
      const r = p / level;
      if (!best || r < best.r) best = { id, p, level, r };
    }
  }
  return best;
}

function runProcedure(st, pOf, alpha, pick = findCandidate) {
  const order = [];
  let c;
  while (st.ids.length && (c = pick(st, pOf, alpha))) {
    order.push(c.id);
    st = rejectNode(st, c.id);
  }
  return { order, final: st };
}

function stateFromGraph(G) {
  if (G.ent) return stateFromEntangled(G);
  return {
    ids: G.nodes.map(n => n.id),
    w: new Map(G.nodes.map(n => [n.id, n.w])),
    g: new Map(G.edges.filter(e => !Q.isZero(e.g)).map(e => [gKey(e.from, e.to), e.g]))
  };
}

/* ---------- Entangled graphs (Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753) ----------
   An entangled graph is n component graphs G_h = (w_h, G_h) on the same m hypotheses, each meeting the usual
   rules (section 3.2, p. 1743, eq. 1), with component weights c_h >= 0 summing to at most 1 (section 3.3,
   p. 1744; gMCP: the weights slot of entangledMCP). H_i is tested at alpha * sum_h c_h w_hi. After a rejection
   every component is updated separately with the Bretz et al. (2009) step (Algorithm 1, p. 1743). The closed
   test uses the convex combination of the components' closure weights (Algorithm 2, p. 1745).

   Model: G.ent = { c: [Q], cexpr: [string | undefined], active: k, comps: [component] } with
   component = { w: { id: Q }, wexpr: { id: string | undefined }, edges: [{ from, to, g, bend, expr }] }.
   The active component is the live copy in G.nodes[].w / wexpr and G.edges, so every existing editor path keeps
   working; entSync(G) writes it back into G.ent.comps[active] and is called before any computation. */
function isEntangled(G) { return !!(G && G.ent && Array.isArray(G.ent.comps) && G.ent.comps.length > 0); }
function entCloneEdges(edges) { return edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend == null ? null : e.bend, expr: e.expr || undefined })); }
/* Writes the live copy (G.nodes, G.edges) back into the active component */
function entSync(G) {
  if (!isEntangled(G)) return G;
  const cs = G.ent.comps[G.ent.active];
  cs.w = {}; cs.wexpr = {};
  for (const n of G.nodes) { cs.w[n.id] = n.w; if (n.wexpr) cs.wexpr[n.id] = n.wexpr; }
  cs.edges = entCloneEdges(G.edges);
  return G;
}
/* Loads component k into the live copy. Hypotheses the component has not seen get weight 0. */
function entLoad(G, k, noSync) {
  if (!isEntangled(G)) return G;
  if (!noSync) entSync(G);
  k = Math.max(0, Math.min(G.ent.comps.length - 1, k | 0));
  const cs = G.ent.comps[k], ids = new Set(G.nodes.map(n => n.id));
  for (const n of G.nodes) { n.w = cs.w[n.id] || Q.ZERO; n.wexpr = (cs.wexpr || {})[n.id] || undefined; }
  G.edges = entCloneEdges(cs.edges.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to));
  G.ent.active = k;
  return G;
}
/* Component k as an ordinary graph object sharing the node records' labels, positions and colours (a view for
   validation, exhaustiveness and float arrays). Not for editing. */
function entViewGraph(G, k) {
  entSync(G);
  const cs = G.ent.comps[k], ids = new Set(G.nodes.map(n => n.id));
  return {
    nodes: G.nodes.map(n => Object.assign({}, n, { w: cs.w[n.id] || Q.ZERO, wexpr: (cs.wexpr || {})[n.id] || undefined })),
    edges: cs.edges.filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to && (e.expr || !Q.isZero(e.g))),
    diag: {}, alpha: G.alpha, sided: G.sided, vars: G.vars, test: G.test, note: G.note
  };
}
/* Exact state for the step-through: per-component states plus the combined levels. st.g shows the active
   component's transitions (the picture), st.w the combined weights sum_h c_h w_h (the test). */
function stateFromEntangled(G) {
  entSync(G);
  const ids = G.nodes.map(n => n.id);
  const comps = G.ent.comps.map((cs, k) => {
    const v = entViewGraph(G, k);
    return { w: new Map(v.nodes.map(n => [n.id, n.w])), g: new Map(v.edges.filter(e => !Q.isZero(e.g)).map(e => [gKey(e.from, e.to), e.g])) };
  });
  return entCombine({ ids, ent: { c: G.ent.c.slice(), comps, active: G.ent.active } });
}
function entCombine(st) {
  const w = new Map();
  for (const id of st.ids) {
    let s = Q.ZERO;
    st.ent.comps.forEach((cs, h) => { s = Q.add(s, Q.mul(st.ent.c[h], cs.w.get(id) || Q.ZERO)); });
    w.set(id, s);
  }
  st.w = w;
  st.g = st.ent.comps[st.ent.active].g;
  return st;
}
/* Algorithm 1, step 3 (p. 1743): remove H_j from every component with the Bretz et al. (2009) update */
function rejectNodeEntangled(st, j) {
  const rem = st.ids.filter(x => x !== j);
  const comps = st.ent.comps.map(cs => { const r = rejectNode({ ids: st.ids, w: cs.w, g: cs.g }, j); return { w: r.w, g: r.g }; });
  return entCombine({ ids: rem, ent: { c: st.ent.c, comps, active: st.ent.active } });
}
/* Appendix A, p. 1752: components with one and the same transition matrix are a single graph with weights
   sum_h c_h w_h. Returns that graph as a saved-file object, or null when the matrices differ. */
function entCollapse(G) {
  if (!isEntangled(G)) return null;
  entSync(G);
  const key = cs => cs.edges.filter(e => !Q.isZero(e.g)).map(e => `${e.from}>${e.to}=${Q.exact(e.g)}`).sort().join(';');
  const k0 = key(G.ent.comps[0]);
  if (!G.ent.comps.every(cs => key(cs) === k0)) return null;
  const o = serializeGraph(G);
  const nodes = o.nodes.map((n, i) => {
    let s = Q.ZERO; G.ent.comps.forEach((cs, h) => { s = Q.add(s, Q.mul(G.ent.c[h], cs.w[G.nodes[i].id] || Q.ZERO)); });
    return Object.assign({}, n, { weight: Q.exact(s), wexpr: undefined });
  });
  const edges = G.ent.comps[0].edges.filter(e => e.expr || !Q.isZero(e.g)).map(e => ({ from: e.from, to: e.to, weight: Q.exact(e.g), bend: e.bend, expr: e.expr }));
  return Object.assign({}, o, { version: 1, nodes, edges, ent: undefined, note: (o.note ? o.note + ' ' : '') + 'Reduced from an entangled graph whose components shared one transition matrix (Maurer and Bretz, 2013, Appendix A).' });
}
/* Entangled templates. Each returns a version 2 saved-file object. Node positions follow the papers' figures. */
const ENTANGLED_TEMPLATES = {
  maurerFig2: {
    name: 'Entangled: two doses with memory (Maurer and Bretz, 2013, Fig. 2)',
    build() {
      const nodes = [['H1', 0, 0], ['H2', 300, 0], ['H3', 150, 190], ['H4', 0, 380], ['H5', 300, 380]];
      return entangledJSON({
        note: 'Maurer and Bretz (2013, Statistics in Medicine 32:1739-1753), Figure 2, p. 1747, and section 4. H1, H2: primary hypotheses for the low and high dose (alpha/2 each). H3: a later primary hypothesis, tested once H1 or H2 is rejected. H4, H5: secondary hypotheses paired with H1 and H2. Graph 1 carries the level of H1 and sends it through H3 to H4 (the pair {H1, H4}); graph 2 does the same for H2 and H5. Each component weight c is 1/2. A single graph (Fig. 1, the "two primary then secondary" shape) forgets where the level of H3 came from and can reject H5 without H2; the entangled graph remembers (requirement (III), p. 1741). gMCP: Entangled1Maurer2012.',
        nodes,
        c: ['1/2', '1/2'],
        comps: [
          { w: ['1', '0', '0', '0', '0'], edges: [[0, 2, '1'], [1, 2, '1'], [2, 3, '1-ε'], [2, 4, 'ε'], [3, 1, '1', -140]] },
          { w: ['0', '1', '0', '0', '0'], edges: [[0, 2, '1'], [1, 2, '1'], [2, 4, '1-ε'], [2, 3, 'ε'], [4, 0, '1', 140]] }
        ]
      });
    }
  },
  maurerFig4: {
    name: 'Entangled: the same procedure as two fixed sequences (Maurer and Bretz, 2013, Fig. 4)',
    build() {
      const nodes = [['H1', 0, 0], ['H2', 300, 0], ['H3', 150, 190], ['H4', 0, 380], ['H5', 300, 380]];
      return entangledJSON({
        note: 'Maurer and Bretz (2013, Statistics in Medicine 32:1739-1753), Figure 4, p. 1748, and section 5.1. The Fig. 2 procedure written without ε edges: graph 1 is the fixed sequence H1, H3, H4, H2, H5 and graph 2 the fixed sequence H2, H3, H5, H1, H4, each with component weight c = 1/2. This is also the Burman, Sonesson and Guilbaud (2009) default graph with those two sequences (Fig. 4(a)). It gives the same rejections as the Fig. 2 entangled graph; the levels equal the Fig. 2 levels with ε set to 0. gMCP: Entangled2Maurer2012.',
        nodes,
        c: ['1/2', '1/2'],
        comps: [
          { w: ['1', '0', '0', '0', '0'], edges: [[0, 2, '1'], [2, 3, '1'], [3, 1, '1', -140], [1, 4, '1']] },
          { w: ['0', '1', '0', '0', '0'], edges: [[1, 2, '1'], [2, 4, '1'], [4, 0, '1', 140], [0, 3, '1']] }
        ]
      });
    }
  },
  maurerFig5: {
    name: 'Entangled: two doses with memory and recycling between the doses (Maurer and Bretz, 2013, Fig. 5; γ1, γ2)',
    build() {
      const nodes = [['H1', 0, 0], ['H2', 300, 0], ['H3', 150, 190], ['H4', 0, 380], ['H5', 300, 380]];
      return entangledJSON({
        note: 'Maurer and Bretz (2013, Statistics in Medicine 32:1739-1753), Figure 5, p. 1749. As Fig. 2, but after a primary hypothesis is rejected its level is split: in graph 1 a share γ1 goes to H3 and 1 − γ1 to the other primary H2; in graph 2 a share γ2 goes to H3 and 1 − γ2 to H1. With γ1 = γ2 = 1 this is the Fig. 2 graph. The paper excludes γ = 0, which would make both primaries a fixed sequence before H3. Guilbaud (2018, Fig. 4(b), p. 230) draws the same graph with one γ. The defaults here are γ1 = γ2 = 1/2.',
        nodes,
        c: ['1/2', '1/2'],
        comps: [
          { w: ['1', '0', '0', '0', '0'], edges: [[0, 1, '1-γ1'], [0, 2, 'γ1'], [1, 2, '1'], [2, 3, '1-ε'], [2, 4, 'ε'], [3, 1, '1', -140]] },
          { w: ['0', '1', '0', '0', '0'], edges: [[1, 0, '1-γ2'], [1, 2, 'γ2'], [0, 2, '1'], [2, 4, '1-ε'], [2, 3, 'ε'], [4, 0, '1', 140]] }
        ]
      });
    }
  },
  truncatedHolmGate: {
    name: 'Entangled: parallel gatekeeping with truncated Holm on two primaries (Maurer and Bretz, 2013, section 5.3.1; γ)',
    build() {
      return entangledJSON({
        note: 'Parallel gatekeeping with a truncated Holm procedure for the primary family (Maurer and Bretz, 2013, section 5.3.1, p. 1750; drawn as in Xi and Bretz, 2019, Fig. 5, pp. 5275-5276). Graph 1 (weight γ) is serial gatekeeping: Holm on H1 and H2, and the secondary pair H3, H4 is reached only once both primaries are rejected (the ε edges). Graph 2 (weight 1 − γ) is a single-step Bonferroni test on the primaries that passes a rejected primary\'s level to the secondaries at once. The entangled graph tests the primaries with truncated Holm (share γ kept in the pair, 1 − γ passed on) and the secondaries with Holm. γ = 1 is serial gatekeeping; γ = 0 is Bonferroni on the primaries with parallel gatekeeping. The single-graph truncated Holm template in the picker is the same procedure for two primaries (Bretz et al., 2011, section 4.1); more primaries need this entangled form.',
        nodes: [['H1', 0, 0], ['H2', 300, 0], ['H3', 0, 220], ['H4', 300, 220]],
        groups: ['primary', 'primary', 'secondary', 'secondary'],
        c: ['γ', '1-γ'],
        comps: [
          { w: ['1/2', '1/2', '0', '0'], edges: [[0, 1, '1-ε'], [0, 2, 'ε/2'], [0, 3, 'ε/2'], [1, 0, '1-ε'], [1, 2, 'ε/2'], [1, 3, 'ε/2'], [2, 3, '1'], [3, 2, '1']] },
          { w: ['1/2', '1/2', '0', '0'], edges: [[0, 2, '1/2'], [0, 3, '1/2'], [1, 2, '1/2'], [1, 3, '1/2'], [2, 3, '1'], [3, 2, '1']] }
        ]
      });
    }
  }
};
/* Truncated Holm for m hypotheses as an entangled graph (Maurer and Bretz, 2013, section 5.3.1, p. 1750): Holm with
   weight γ and single-step Bonferroni with weight 1 − γ. For m = 2 the single-graph template does the same. */
function entangledTruncatedHolm(m) {
  const pos = circlePositions(m);
  const holm = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) holm.push([i, j, m === 2 ? '1' : `1/${m - 1}`]);
  return entangledJSON({
    note: `Truncated Holm on ${m} hypotheses as an entangled graph (Maurer and Bretz, 2013, section 5.3.1, p. 1750; the procedure is from Dmitrienko, Tamhane and Wiens, 2008): graph 1 is Bonferroni-Holm with weight γ, graph 2 the single-step Bonferroni test (equal weights, no transitions) with weight 1 − γ. A rejected hypothesis passes on a share γ of its level and keeps 1 − γ unspent, so the procedure stops short of full Holm and the unspent part can be given to a later family. γ = 1 is Holm; γ = 0 is Bonferroni. The paper notes that for two hypotheses a single graph suffices (Bretz et al., 2011).`,
    nodes: pos.map((p, i) => [`H${i + 1}`, p.x, p.y]),
    c: ['γ', '1-γ'],
    comps: [
      { w: Array.from({ length: m }, () => `1/${m}`), edges: holm },
      { w: Array.from({ length: m }, () => `1/${m}`), edges: [] }
    ]
  });
}
/* At least k of m primaries before one secondary (Maurer and Bretz, 2013, section 5.3.2, pp. 1750-1751, and Fig. 6,
   p. 1751; Guilbaud, 2018, Fig. 5(b), p. 230, for 2 of 3): one component per k-subset of the primaries, c = 1/C(m,k).
   In each component the subset is tested with Holm; its highest-index member sends ε to the secondary and the rest of
   that share to the lowest-index member, so the secondary is reached only once the whole subset is rejected; the other
   primaries are isolated with weight 0. Taken together (p. 1751, m = 4, k = 3): Holm on the primaries until three are
   rejected, the fourth at 3α/4, the secondary at α/4 if the fourth is retained and at α if it is rejected. */
function entangledKOfM(m, k, alpha) {
  if (!(m >= 2 && m <= 6 && k >= 1 && k < m)) throw new Error('At least k of m needs 2 to 6 primaries and k between 1 and m − 1.');
  const subsets = []; const rec = (start, cur) => { if (cur.length === k) { subsets.push(cur.slice()); return; } for (let i = start; i < m; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } }; rec(0, []);
  const nodes = Array.from({ length: m }, (_, i) => [`H${i + 1}`, i * 200, 0]).concat([[`H${m + 1}`, (m - 1) * 100, 230]]);
  const share = k > 1 ? `1/${k - 1}` : '1';
  const comps = subsets.map(J => {
    const w = Array(m + 1).fill('0'); J.forEach(i => { w[i] = `1/${k}`; });
    const edges = [], top = J[J.length - 1], low = J[0];
    for (const a of J) for (const b of J) { if (a === b) continue; edges.push(a === top && b === low && k > 1 ? [a, b, `${share}-ε`] : [a, b, share]); }
    edges.push(k > 1 ? [top, m, 'ε'] : [top, m, '1']);
    return { w, edges };
  });
  /* Levels once k primaries are rejected (checked against the engine for every m <= 6 and k, rejecting in index order, 28 October 2026; in other orders they hold up to terms in ε):
     H(m+1) at alpha/C(m,k); each remaining primary at (1 - 1/C(m,k)) alpha/(m - k); after r >= k rejections H(m+1)
     holds C(r,k)/C(m,k) of alpha. Maurer and Bretz (2013), p. 1751, give the 3 of 4 case: 3 alpha/4 and alpha/4. */
  const nC = subsets.length, gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const aFrac = (num, den) => { const g = gcd(num, den); num /= g; den /= g; return den === 1 ? (num === 1 ? 'α' : `${num}α`) : `${num === 1 ? '' : num}α/${den}`; };
  const pFrac = (num, den) => { const g = gcd(num, den); return den / g === 1 ? `${num / g}` : `${num / g}/${den / g}`; };
  const xt = k === 1 ? ' With k = 1 this is the k-out-of-n gatekeeping procedure of Xi and Tamhane (2014) with γ = 0.'
    : k === m - 1 ? ` With k = m − 1 this is the k-out-of-n gatekeeping procedure of Xi and Tamhane (2014) with γ = 1 − 2/m = ${pFrac(m - 2, m)}.`
    : ' It is not the k-out-of-n gatekeeping procedure of Xi and Tamhane (2014), whose secondary level rises in equal steps; both control the familywise error rate.';
  return entangledJSON({
    alpha, nodes, groups: Array.from({ length: m }, () => 'primary').concat(['secondary']),
    note: `At least ${k} of ${m} primary hypotheses (H1 to H${m}) must be rejected before the secondary hypothesis H${m + 1} is tested (Maurer and Bretz, 2013, section 5.3.2, pp. 1750-1751, and Fig. 6; Guilbaud, 2018, Example 11 and Fig. 5(b), for 2 of 3). One component graph per set of ${k} primaries (${nC} in all, c = 1/${nC} each): Holm within the set, and only the last of the set to be rejected hands its level to H${m + 1} (the ε edge); the other primaries are isolated with weight 0. Taken together, ignoring terms in ε: Holm on the primaries until ${k === 1 ? 'one is' : `${k} are`} rejected. Then H${m + 1} is at α/C(${m}, ${k}) = ${aFrac(1, nC)} and each remaining primary at (1 − 1/C(${m}, ${k}))α/(${m} − ${k}) = ${aFrac(nC - 1, nC * (m - k))}. Each further primary rejection raises the level of H${m + 1}: after r rejections it is C(r, ${k})/C(${m}, ${k}) of α, so α once all ${m} are rejected.${xt}`,
    c: subsets.map(() => `1/${subsets.length}`),
    comps
  });
}
/* Builds a version 2 saved-file object from short lists: nodes [label, x, y], comps [{ w: [...], edges: [[from, to, weight, bend?]] }] */
function entangledJSON(spec) {
  const wt = v => (isExpr(v) ? { weight: '0', wexpr: v } : { weight: v });
  const comps = spec.comps.map(cs => ({
    nodes: spec.nodes.map((r, i) => Object.assign({ id: String(i) }, wt(cs.w[i]))),
    edges: cs.edges.map(r => Object.assign({ from: String(r[0]), to: String(r[1]), bend: r[3] == null ? null : r[3] }, isExpr(r[2]) ? { weight: '0', expr: r[2] } : { weight: r[2] }))
  }));
  const cw = spec.c.map(v => (isExpr(v) ? { c: '0', cexpr: v } : { c: v }));
  return {
    format: 'multiplicity-graph', version: 2, alpha: spec.alpha || 0.025, note: spec.note || '',
    nodes: spec.nodes.map((r, i) => Object.assign({ id: String(i), label: r[0], x: r[1], y: r[2], p: '', group: spec.groups ? spec.groups[i] : '' }, comps[0].nodes[i])),
    edges: comps[0].edges,
    ent: { c: cw.map(x => x.c), cexpr: cw.some(x => x.cexpr) ? cw.map(x => x.cexpr) : undefined, active: 0, comps }
  };
}
function entangledTemplateJSON(key) { return ENTANGLED_TEMPLATES[key].build(); }

/* ---------- Validation ---------- */
function validateGraph(G, fmt) {
  const out = [];
  const name = id => (G.nodes.find(n => n.id === id) || {}).label || '?';
  const list = ids => ids.map(name).join(', ');
  if (!G.nodes.length) return out;
  if (isEntangled(G)) {
    /* Each component must be a valid graph on its own (eq. 1, p. 1743); the component weights c_h lie in [0, 1]
       and sum to at most 1 (p. 1744). Messages are prefixed with the component; one-click fixes apply to the
       active component only, since the others are not on the canvas. */
    entSync(G);
    G.ent.comps.forEach((cs, k) => {
      for (const v of validateGraph(entViewGraph(G, k), fmt)) {
        v.text = `Graph ${k + 1}: ${v.text}`;
        if (k !== G.ent.active) v.fix = null;
        out.push(v);
      }
    });
    const c = G.ent.c;
    let cs = Q.ZERO;
    c.forEach((v, k) => { if (Q.cmp(v, Q.ZERO) < 0 || Q.cmp(v, Q.ONE) > 0) out.push({ level: 'error', text: `Component weight c${k + 1} is ${fmt(v)}. Component weights must be between 0 and 1.` }); cs = Q.add(cs, v); });
    if (Q.cmp(cs, Q.ONE) > 0) out.push({ level: 'error', text: `The component weights add up to ${fmt(cs)}, which is more than 1.` });
    else if (Q.cmp(cs, Q.ONE) < 0) out.push({ level: 'warn', text: `The component weights add up to ${fmt(cs)}, so the procedure does not use all of alpha. Valid, but not alpha-exhaustive.` });
    return out;
  }

  const badW = G.nodes.filter(n => Q.cmp(n.w, Q.ZERO) < 0 || Q.cmp(n.w, Q.ONE) > 0);
  for (const n of badW) out.push({ level: 'error', nodes: [n.id], fix: { act: 'clampW', id: n.id, label: 'Clamp to [0, 1]' }, text: `${n.label} has initial weight ${fmt(n.w)}. Weights must be between 0 and 1.` });

  let sum = Q.ZERO; for (const n of G.nodes) sum = Q.add(sum, n.w);
  if (Q.cmp(sum, Q.ONE) > 0 && !badW.length) out.push({ level: 'error', nodes: G.nodes.map(n => n.id), fix: { act: 'normW', label: 'Rescale so they sum to 1' }, text: `Initial weights add up to ${fmt(sum)}, which is more than 1.` });

  for (const e of G.edges) {
    if (Q.cmp(e.g, Q.ZERO) < 0 || Q.cmp(e.g, Q.ONE) > 0)
      out.push({ level: 'error', edges: [gKey(e.from, e.to)], fix: { act: 'clampE', key: gKey(e.from, e.to), label: 'Clamp to [0, 1]' }, text: `Transition ${name(e.from)} \u2192 ${name(e.to)} has weight ${fmt(e.g)}. Transition weights must be between 0 and 1.` });
  }
  for (const id of Object.keys(G.diag || {})) {
    const v = G.diag[id];
    if (v && !Q.isZero(v)) out.push({ level: 'error', nodes: [id], diag: id, fix: { act: 'zeroDiag', id, label: 'Set to 0' }, text: `Diagonal entry for ${name(id)} is ${fmt(v)}. A hypothesis cannot pass weight to itself, so it must be 0.` });
  }
  const under = [], leaves = [];
  for (const n of G.nodes) {
    let r = Q.ZERO;
    const outs = G.edges.filter(e => e.from === n.id);
    for (const e of outs) r = Q.add(r, e.g);
    if (Q.cmp(r, Q.ONE) > 0) out.push({ level: 'error', nodes: [n.id], rows: [n.id], fix: outs.every(e => Q.cmp(e.g, Q.ZERO) >= 0) ? { act: 'normRows', ids: [n.id], label: 'Rescale so they sum to 1' } : null, text: `Transitions out of ${n.label} add up to ${fmt(r)}, which is more than 1.` });
    else if (Q.cmp(r, Q.ONE) < 0) (outs.length ? under : leaves).push(n.id);
  }

  const labels = G.nodes.map(n => n.label.trim());
  const dup = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (dup.length) out.push({ level: 'warn', text: `More than one hypothesis is called ${dup.join(', ')}. Unique labels keep the exports unambiguous.` });

  if (Q.cmp(sum, Q.ONE) < 0) out.push({ level: 'warn', fix: { act: 'normW', label: Q.isZero(sum) ? 'Share equally' : 'Scale up to 1' }, text: `Initial weights add up to ${fmt(sum)}, so the procedure does not use all of alpha. Valid, but not alpha-exhaustive.` });
  if (under.length) out.push({ level: 'warn', nodes: under, fix: { act: 'normRows', ids: under, label: 'Scale up to 1' }, text: `Transitions out of ${list(under)} add up to less than 1, so ${under.length > 1 ? 'their' : 'its'} level is not fully passed on after rejection. Valid, but not alpha-exhaustive.` });
  if (leaves.length) out.push({ level: 'warn', nodes: leaves, text: `${list(leaves)} ${leaves.length > 1 ? 'have' : 'has'} no outgoing transitions, so ${leaves.length > 1 ? 'their' : 'its'} level is lost whenever ${leaves.length > 1 ? 'one of them' : 'it'} is rejected while other hypotheses are still open. Harmless only for the last hypothesis of a fixed sequence; otherwise add a transition (compare the fallback and improved fallback templates).` });
  return out;
}
/* Alpha-exhaustive: every intersection hypothesis has weights summing to 1 (Xi et al., 2017; Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753, eq. 3).
   Checked on the generated closure for m <= 12; for larger graphs falls back to the row-sum rule, which can
   overstate it when two hypotheses exchange their whole level (g_lj g_jl = 1). Returns true, false or null (unknown). */
function isAlphaExhaustive(G) {
  const m = G.nodes.length;
  if (!m) return null;
  if (isEntangled(G)) {
    /* The convex combination is exhaustive exactly when the component weights sum to 1 and every component
       with positive weight is exhaustive (Maurer and Bretz, 2013, p. 1745). */
    let cs = Q.ZERO; for (const v of G.ent.c) cs = Q.add(cs, v);
    if (!Q.eq(cs, Q.ONE)) return false;
    let unknown = false;
    for (let k = 0; k < G.ent.comps.length; k++) {
      if (Q.isZero(G.ent.c[k])) continue;
      const r = isAlphaExhaustive(entViewGraph(G, k));
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  let sum = Q.ZERO; for (const n of G.nodes) sum = Q.add(sum, n.w);
  if (!Q.eq(sum, Q.ONE)) return false;
  if (m > 12) {
    for (const n of G.nodes) { let r = Q.ZERO; for (const e of G.edges) if (e.from === n.id) r = Q.add(r, e.g); if (!Q.eq(r, Q.ONE)) return false; }
    return null;
  }
  const fg = floatGraph(G), W = closureWeights(fg), full = (1 << m) - 1;
  for (let mask = 1; mask <= full; mask++) {
    let s = 0; for (let i = 0; i < m; i++) if (mask & (1 << i)) s += W[mask * m + i];
    if (Math.abs(s - 1) > 1e-9) return false;
  }
  return true;
}

/* ---------- Parsing R-style and plain input ---------- */
function stripAssign(s) { return s.trim().replace(/^[A-Za-z_.][\w.]*\s*<-\s*/, '').replace(/;\s*$/, '').trim(); }
function callInner(s, names) {
  const re = new RegExp('^(' + names.join('|') + ')\\s*\\(', 'i');
  const m = re.exec(s);
  if (!m) return null;
  let depth = 0;
  for (let i = m[0].length - 1; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return { fn: m[1].toLowerCase(), inner: s.slice(m[0].length, i) }; }
  }
  throw new Error(`Unbalanced brackets after ${m[1]}(.`);
}
function splitArgs(s) {
  const out = []; let depth = 0, cur = '', quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur);
  return out.map(x => x.trim()).filter(x => x !== '');
}
const unquote = s => s.trim().replace(/^["'`]|["'`]$/g, '');
function parseVector(src) {
  let s = stripAssign(src);
  const call = callInner(s, ['c']);
  let tokens;
  if (call) tokens = splitArgs(call.inner);
  else if (/,/.test(s)) tokens = splitArgs(s.replace(/\n/g, ','));
  else tokens = s.split(/[\s;]+/).filter(Boolean);
  const values = [], names = [];
  for (const t of tokens) {
    let v = t, nm = null;
    const m = /^("[^"]*"|'[^']*'|`[^`]*`|[A-Za-z_.][\w.]*)\s*=\s*(.+)$/.exec(t);
    if (m) { nm = unquote(m[1]); v = m[2]; }
    const q = Q.parse(v);
    if (!q) throw new Error(`Could not read "${t}" as a number. Use decimals such as 0.25 or fractions such as 1/3.`);
    values.push(q); names.push(nm);
  }
  return { values, names: names.some(Boolean) ? names : null };
}
function parseNames(src) {
  let s = stripAssign(src);
  const call = callInner(s, ['c']);
  const tokens = call ? splitArgs(call.inner) : s.split(/[,\s;]+/).filter(Boolean);
  return tokens.map(unquote);
}
function parseMatrix(src, m) {
  let s = stripAssign(src);
  const notes = [];
  const call = callInner(s, ['matrix', 'rbind', 'cbind']);
  let rows;
  if (call && call.fn === 'matrix') {
    const args = splitArgs(call.inner);
    let data = null, nrow = null, ncol = null, byrow = false, pos = 0;
    for (const a of args) {
      const nm = /^(\w+)\s*=\s*([\s\S]+)$/.exec(a);
      const key = nm ? nm[1].toLowerCase() : ['data', 'nrow', 'ncol', 'byrow'][pos++];
      const val = nm ? nm[2] : a;
      if (key === 'data') data = parseVector(val).values;
      else if (key === 'nrow') nrow = parseInt(val, 10);
      else if (key === 'ncol') ncol = parseInt(val, 10);
      else if (key === 'byrow') byrow = /^(T|TRUE)$/i.test(val.trim());
    }
    if (!data) throw new Error('matrix() needs its values, for example matrix(c(0, 1, 1, 0), nrow = 2).');
    const len = data.length;
    if (!nrow && !ncol) { nrow = m; ncol = Math.round(len / m); }
    else if (!nrow) nrow = Math.round(len / ncol);
    else if (!ncol) ncol = Math.round(len / nrow);
    if (len === 1) data = Array(nrow * ncol).fill(data[0]);
    if (data.length !== nrow * ncol) throw new Error(`matrix() has ${data.length} values, which does not fill ${nrow} \u00d7 ${ncol}.`);
    rows = [];
    for (let i = 0; i < nrow; i++) {
      rows.push([]);
      for (let j = 0; j < ncol; j++) rows[i].push(byrow ? data[i * ncol + j] : data[j * nrow + i]);
    }
    if (!byrow) notes.push('Read column by column, as R does when byrow = TRUE is not given.');
  } else if (call) {
    const vecs = splitArgs(call.inner).map(a => parseVector(a.replace(/^\w+\s*=\s*/, '')).values);
    if (call.fn === 'rbind') rows = vecs;
    else rows = vecs[0].map((_, i) => vecs.map(v => v[i]));
  } else {
    const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const lineVals = lines.map(l => parseVector(l.replace(/^c\(/, 'c(')).values);
    if (lineVals.length === 1) {
      const v = lineVals[0];
      if (v.length !== m * m) throw new Error(`Found ${v.length} values on one line; a ${m} \u00d7 ${m} matrix needs ${m * m}. Put one row per line or give exactly ${m * m} values.`);
      rows = []; for (let i = 0; i < m; i++) rows.push(v.slice(i * m, i * m + m));
      notes.push('Read row by row.');
    } else rows = lineVals;
  }
  if (rows.some(r => r.length !== rows.length)) throw new Error('The transition matrix must be square, with one row and one column per hypothesis.');
  if (rows.length !== m) throw new Error(`The weights describe ${m} hypotheses but the matrix is ${rows.length} \u00d7 ${rows.length}.`);
  return { rows, notes };
}

/* ---------- gMCP code for entangled graphs ----------
   Reads a script such as
     m1 <- rbind(H1 = c(0, 0, 1, 0, 0), H2 = c(0, 0, 1, 0, 0), H3 = c(0, 0, 0, "1-\\epsilon", "\\epsilon"), ...)
     graph1 <- new("graphMCP", m = m1, weights = c(1, 0, 0, 0, 0))
     ...
     graph <- new("entangledMCP", subgraphs = list(graph1, graph2), weights = c(0.5, 0.5))
   Values may be numbers, fractions or gMCP's quoted expressions ("1-\\epsilon"). Variables are resolved from
   earlier assignments. Returns { m, names, c: [string], comps: [{ w: [string], rows: [[string]] }] } or throws. */
function parseEntangledR(text) {
  const src = String(text).replace(/\r/g, '').split('\n').map(l => l.replace(/#.*$/, '')).join('\n');
  /* statements: top-level, split at newlines or semicolons when brackets are balanced */
  const stmts = []; let cur = '', depth = 0, quote = null;
  for (const ch of src) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if ((ch === '\n' || ch === ';') && depth <= 0) { if (cur.trim()) stmts.push(cur.trim()); cur = ''; depth = 0; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  const vars = new Map();
  let result = null;
  const value = tok => {
    const t = tok.trim();
    const q = Q.parse(unquote(t));
    if (q) return Q.exact(q);
    if (/^["']/.test(t)) return normaliseExpr(unquote(t).replace(/\\\\/g, '').replace(/\\/g, ''));
    throw new Error(`Could not read "${t}" as a weight. Numbers, fractions and quoted expressions such as "1-\\\\epsilon" are understood.`);
  };
  const resolve = expr => {
    const e = expr.trim();
    if (/^[A-Za-z_.][\w.]*$/.test(e)) { if (!vars.has(e)) throw new Error(`"${e}" is used before it is defined.`); return vars.get(e); }
    return evalR(e);
  };
  const vecOf = call => { const toks = splitArgs(call.inner); const names = [], values = []; for (const t of toks) { const m = /^("[^"]*"|'[^']*'|[A-Za-z_.][\w.]*)\s*=\s*([\s\S]+)$/.exec(t); names.push(m ? unquote(m[1]) : null); values.push(value(m ? m[2] : t)); } return { kind: 'vec', values, names: names.some(Boolean) ? names : null }; };
  const evalR = e => {
    let call;
    if ((call = callInner(e, ['c']))) return vecOf(call);
    if ((call = callInner(e, ['rbind']))) {
      const rows = [], names = [];
      for (const a of splitArgs(call.inner)) { const m = /^("[^"]*"|'[^']*'|[A-Za-z_.][\w.]*)\s*=\s*([\s\S]+)$/.exec(a); names.push(m ? unquote(m[1]) : null); const v = resolve(m ? m[2] : a); if (v.kind !== 'vec') throw new Error('rbind() needs vectors.'); rows.push(v.values); }
      return { kind: 'mat', rows, names: names.some(Boolean) ? names : null };
    }
    if ((call = callInner(e, ['matrix']))) {
      const args = splitArgs(call.inner); let data = null, nrow = null, ncol = null, byrow = false, pos = 0;
      for (const a of args) { const nm = /^(\w+)\s*=\s*([\s\S]+)$/.exec(a); const key = nm ? nm[1].toLowerCase() : ['data', 'nrow', 'ncol', 'byrow'][pos++]; const val = nm ? nm[2] : a; if (key === 'data') data = resolve(val).values; else if (key === 'nrow') nrow = parseInt(val, 10); else if (key === 'ncol') ncol = parseInt(val, 10); else if (key === 'byrow') byrow = /^(T|TRUE)$/i.test(val.trim()); }
      if (!data) throw new Error('matrix() needs its values.');
      if (!nrow && !ncol) nrow = ncol = Math.round(Math.sqrt(data.length)); else if (!nrow) nrow = Math.round(data.length / ncol); else if (!ncol) ncol = Math.round(data.length / nrow);
      if (data.length !== nrow * ncol) throw new Error(`matrix() has ${data.length} values, which does not fill ${nrow} × ${ncol}.`);
      const rows = []; for (let i = 0; i < nrow; i++) { rows.push([]); for (let j = 0; j < ncol; j++) rows[i].push(byrow ? data[i * ncol + j] : data[j * nrow + i]); }
      return { kind: 'mat', rows, names: null };
    }
    if ((call = callInner(e, ['list']))) return { kind: 'list', items: splitArgs(call.inner).map(resolve) };
    if ((call = callInner(e, ['new']))) {
      const args = splitArgs(call.inner); const cls = unquote(args[0] || ''); const named = {}; let pos = 0;
      const order = cls === 'graphMCP' ? ['m', 'weights'] : ['subgraphs', 'weights'];
      for (const a of args.slice(1)) { const nm = /^(\w+)\s*=\s*([\s\S]+)$/.exec(a); named[nm ? nm[1] : order[pos++]] = nm ? nm[2] : a; }
      if (cls === 'graphMCP') {
        if (named.m == null || named.weights == null) throw new Error('new("graphMCP") needs m (the transition matrix) and weights.');
        const m = resolve(named.m), w = resolve(named.weights);
        if (m.kind !== 'mat' || w.kind !== 'vec') throw new Error('In new("graphMCP"), m must be a matrix and weights a vector.');
        return { kind: 'graph', rows: m.rows, w: w.values, names: m.names || w.names };
      }
      if (cls === 'entangledMCP') {
        if (named.subgraphs == null) throw new Error('new("entangledMCP") needs subgraphs = list(...).');
        const l = resolve(named.subgraphs); if (l.kind !== 'list' || !l.items.length || l.items.some(x => x.kind !== 'graph')) throw new Error('subgraphs must be a list of graphMCP objects.');
        const c = named.weights != null ? resolve(named.weights) : { kind: 'vec', values: l.items.map(() => Q.exact(Q.make(1n, BigInt(l.items.length)))) };
        if (c.kind !== 'vec' || c.values.length !== l.items.length) throw new Error('weights of the entangledMCP must give one number per subgraph.');
        return { kind: 'ent', comps: l.items, c: c.values };
      }
      throw new Error(`new("${cls}") is not understood; only graphMCP and entangledMCP are.`);
    }
    throw new Error(`Could not read "${e.slice(0, 40)}${e.length > 40 ? '…' : ''}".`);
  };
  for (const st of stmts) {
    const m = /^([A-Za-z_.][\w.]*)\s*(<-|=)\s*([\s\S]+)$/.exec(st);
    if (m) { const v = evalR(m[3]); vars.set(m[1], v); if (v.kind === 'ent') result = v; }
    else if (/^(library|require|print|plot|gMCP|graphGUI)\b/.test(st) || /^[A-Za-z_.][\w.]*$/.test(st)) continue;
    else { const v = evalR(st); if (v.kind === 'ent') result = v; }
  }
  if (!result) { const ents = [...vars.values()].filter(v => v.kind === 'ent'); if (ents.length) result = ents[ents.length - 1]; }
  if (!result) throw new Error('No new("entangledMCP", subgraphs = list(...), weights = c(...)) found in the code.');
  const m = result.comps[0].w.length;
  for (const g of result.comps) {
    if (g.w.length !== m) throw new Error('Every component must have the same number of hypotheses.');
    if (g.rows.length !== m || g.rows.some(r => r.length !== m)) throw new Error(`Each transition matrix must be ${m} × ${m}.`);
  }
  if (m > 40) throw new Error('That is more than 40 hypotheses. This tool is built for smaller graphs.');
  const names = result.comps.map(g => g.names).find(Boolean) || Array.from({ length: m }, (_, i) => 'H' + (i + 1));
  return { m, names, c: result.c, comps: result.comps.map(g => ({ w: g.w, rows: g.rows })) };
}

/* ---------- Node colours ---------- */
function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : ''; }
/* Dark text on light fills, white text on dark fills (WCAG relative luminance) */
function textOnColor(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#1b1f23' : '#ffffff';
}

/* ---------- Arrange: snap the whole graph into a fixed shape ---------- */
/* Returns new {x, y} per node (same order), centred on (cx, cy). */
function arrangePositions(G, shape, gap, cx, cy) {
  const m = G.nodes.length;
  if (!m) return [];
  const vgap = Math.round(gap * 0.85);
  let pos;
  const rowsOf = rows => {
    const out = new Array(m);
    rows.forEach((row, r) => row.forEach((i, k) => { out[i] = { x: (k - (row.length - 1) / 2) * gap, y: r * vgap }; }));
    return out;
  };
  const idx = G.nodes.map((_, i) => i);
  if (shape === 'circle' && m >= 3) {
    const r = Math.max(gap * 0.6, gap / (2 * Math.sin(Math.PI / m)));
    pos = idx.map(i => { const a = -Math.PI / 2 + 2 * Math.PI * i / m; return { x: r * Math.cos(a), y: r * Math.sin(a) }; });
  } else if (shape === 'circle' || shape === 'line') {
    pos = rowsOf([idx]);
  } else if (shape === 'grid') {
    const cols = Math.ceil(Math.sqrt(m));
    const rows = []; for (let i = 0; i < m; i += cols) rows.push(idx.slice(i, i + cols));
    pos = rowsOf(rows);
  } else if (shape === 'tworows') {
    const cols = Math.ceil(m / 2);
    pos = rowsOf([idx.slice(0, cols), idx.slice(cols)].filter(r => r.length));
  } else if (shape === 'column') {
    pos = idx.map(i => ({ x: 0, y: i * vgap }));
  } else if (shape === 'layers') {
    /* Rows by how many transitions away from a hypothesis that starts with weight */
    const ids = G.nodes.map(n => n.id);
    let starts = idx.filter(i => Q.cmp(G.nodes[i].w, Q.ZERO) > 0);
    if (!starts.length) starts = idx.filter(i => !G.edges.some(e => e.to === ids[i]));
    if (!starts.length) starts = [0];
    const depth = new Array(m).fill(-1);
    const queue = [...starts];
    starts.forEach(i => { depth[i] = 0; });
    while (queue.length) {
      const i = queue.shift();
      for (const e of G.edges) {
        if (e.from !== ids[i] || Q.isZero(e.g)) continue;
        const j = ids.indexOf(e.to);
        if (depth[j] < 0) { depth[j] = depth[i] + 1; queue.push(j); }
      }
    }
    const maxD = Math.max(0, ...depth);
    idx.forEach(i => { if (depth[i] < 0) depth[i] = maxD + 1; });
    const rows = [];
    idx.forEach(i => { (rows[depth[i]] = rows[depth[i]] || []).push(i); });
    pos = rowsOf(rows.filter(Boolean));
  } else pos = rowsOf([idx]);
  const mx = pos.reduce((a, p) => a + p.x, 0) / m, my = pos.reduce((a, p) => a + p.y, 0) / m;
  return pos.map(p => ({ x: Math.round(p.x - mx + cx), y: Math.round(p.y - my + cy) }));
}

/* ---------- Edge geometry (shared by canvas, SVG/PNG and TikZ) ---------- */
function borderPoint(n, toward) {
  const dx = toward.x - n.x, dy = toward.y - n.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const t = 1 / Math.sqrt((ux / n.rx) ** 2 + (uy / n.ry) ** 2);
  return { x: n.x + ux * t, y: n.y + uy * t, ang: Math.atan2(-uy, ux) * 180 / Math.PI };
}
function curveGeom(a, b, bend) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = { x: m.x + 2 * bend * nx, y: m.y + 2 * bend * ny };
  const straight = Math.abs(bend) < 0.5;
  const s = borderPoint(a, straight ? b : c), e = borderPoint(b, straight ? a : c);
  const d = straight ? `M${s.x.toFixed(2)},${s.y.toFixed(2)} L${e.x.toFixed(2)},${e.y.toFixed(2)}`
    : `M${s.x.toFixed(2)},${s.y.toFixed(2)} Q${c.x.toFixed(2)},${c.y.toFixed(2)} ${e.x.toFixed(2)},${e.y.toFixed(2)}`;
  return { s, e, c, m, n: { x: nx, y: ny }, L, straight, d };
}
function pointAt(geo, t) {
  if (geo.straight) return { x: geo.s.x + (geo.e.x - geo.s.x) * t, y: geo.s.y + (geo.e.y - geo.s.y) * t };
  const u = 1 - t;
  return { x: u * u * geo.s.x + 2 * u * t * geo.c.x + t * t * geo.e.x, y: u * u * geo.s.y + 2 * u * t * geo.c.y + t * t * geo.e.y };
}
function insideNode(n, p, pad) {
  return ((p.x - n.x) / (n.rx + pad)) ** 2 + ((p.y - n.y) / (n.ry + pad)) ** 2 < 1;
}
function autoBend(a, b, bidir, nodes) {
  const cands = bidir ? [24, 46, 72, 104] : [0, 42, -42, 72, -72, 104, -104];
  for (const bend of cands) {
    const g = curveGeom(a, b, bend);
    let ok = true;
    for (const n of nodes) {
      if (n.id === a.id || n.id === b.id) continue;
      for (let t = 0.06; t < 0.95 && ok; t += 0.06) if (insideNode(n, pointAt(g, t), 10)) ok = false;
      if (!ok) break;
    }
    if (ok) return bend;
  }
  return cands[0];
}
function rectHitsNode(r, n, pad) {
  const qx = Math.max(r.x, Math.min(n.x, r.x + r.w)), qy = Math.max(r.y, Math.min(n.y, r.y + r.h));
  return insideNode(n, { x: qx, y: qy }, pad);
}
const rectsOverlap = (a, b, pad) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/* vm: { nodes: [{id,x,y,rx,ry}], edges: [{from,to,bend,text}] } */
function layoutEdges(vm) {
  const byId = new Map(vm.nodes.map(n => [n.id, n]));
  /* captions under a node (test mode) count as part of the obstacle */
  const obstacles = vm.nodes.map(n => (n.capH ? Object.assign({}, n, { y: n.y + n.capH / 2, ry: n.ry + n.capH / 2 }) : n));
  const keys = new Set(vm.edges.map(e => gKey(e.from, e.to)));
  const out = [];
  /* the same transition in several components (an entangled graph's All view, e.comp set) is drawn as separate
     curves spread apart, keyed by component */
  const seen = new Map();
  for (const e of vm.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || a === b) continue;
    const bidir = keys.has(gKey(e.to, e.from));
    const base = gKey(e.from, e.to), dup = seen.get(base) || 0; seen.set(base, dup + 1);
    const spread = dup ? (dup % 2 ? 1 : -1) * Math.ceil(dup / 2) * 30 : 0;
    const bend = (e.bend == null ? autoBend(a, b, bidir, obstacles) : e.bend) + spread;
    out.push(Object.assign({}, e, { key: e.comp == null ? base : `${base}#${e.comp}`, a, b, bend, auto: e.bend == null }, curveGeom(a, b, bend)));
  }
  const placed = [];
  const ts = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8];
  const ordered = out.slice().sort((x, y) => (x.key < y.key ? -1 : 1));
  /* keep a label off other arrows so it is clear which arrow it belongs to */
  const crossesOther = (e, r) => out.some(o => {
    if (o === e) return false;
    for (let t = 0.03; t < 0.98; t += 0.025) {
      const p = pointAt(o, t);
      if (p.x > r.x - 2 && p.x < r.x + r.w + 2 && p.y > r.y - 2 && p.y < r.y + r.h + 2) return true;
    }
    return false;
  });
  for (const e of ordered) {
    const w = textWidth(e.text, 12.5) + 14, h = 21;
    let chosen = null, fallback = null;
    for (const t of ts) {
      const p = pointAt(e, t);
      const r = { x: p.x - w / 2, y: p.y - h / 2, w, h };
      if (obstacles.some(n => rectHitsNode(r, n, 3))) continue;
      if (placed.some(q => rectsOverlap(q, r, 2))) continue;
      const c = { x: p.x, y: p.y, w, h, t, r };
      if (!fallback) fallback = c;
      if (crossesOther(e, r)) continue;
      chosen = c;
      break;
    }
    if (!chosen) chosen = fallback;
    if (!chosen) { const p = pointAt(e, 0.5); chosen = { x: p.x, y: p.y, w, h, t: 0.5, r: { x: p.x - w / 2, y: p.y - h / 2, w, h } }; }
    placed.push(chosen.r);
    e.label = chosen;
  }
  return out;
}

/* ---------- Exports (pure string builders) ---------- */
function rNum(q) {
  if (q.d === 1n) return `${q.n}`;
  if (q.d <= 1000n) return `${q.n}/${q.d}`;
  return String(Number(Q.toNum(q).toPrecision(15)));
}
const rStr = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
function matrixRows(G, num) {
  return G.nodes.map(a => G.nodes.map(b => {
    if (a.id === b.id) return num((G.diag && G.diag[a.id]) || Q.ZERO);
    const e = G.edges.find(x => x.from === a.id && x.to === b.id);
    return num(e ? e.g : Q.ZERO);
  }));
}
function pVector(G) {
  const ps = G.nodes.map(n => parseP(n.p));
  if (!ps.length || ps.some(p => p == null || Number.isNaN(p))) return null;
  return `c(${G.nodes.map(n => String(n.p).trim()).join(', ')})`;
}
function varsComment(G) { const v = Object.keys(G.vars || {}); return v.length ? `# Symbolic weights evaluated with ${v.map(k => `${k} = ${rNum(G.vars[k])}`).join(', ')}\n` : ''; }
/* Entangled graphs (Maurer and Bretz, 2013). gMCP: one matrix2graph() per component joined as an entangledMCP
   object; gMCP() tests it with Bonferroni only (gMCP 0.8-17 stops for Simes and for the parametric test).
   graphicalMCP has no entangled graph object, so that export builds each component and gives the Sketchpad's
   intersection weights v_i(J) = sum_h c_h w_hi(J) (Algorithm 2, p. 1745) for a closed test by hand. */
function entCompR(G, k, indent) {
  const v = entViewGraph(G, k);
  return { rows: matrixRows(v, rNum).map(r => indent + r.join(', ')), weights: v.nodes.map(n => rNum(n.w)).join(', ') };
}
function entCompComment(G, k) { return `# Graph ${k + 1} (c = ${G.ent.cexpr && G.ent.cexpr[k] ? exprDisplay(G.ent.cexpr[k]) + ' = ' : ''}${rNum(G.ent.c[k])})`; }
/* The intersection weights as R code in the layout of gMCP's generateWeights(): one row per non-empty
   intersection, the first m columns say which hypotheses are in it (1 = in), the next m give the weights.
   Rows run in gMCP's order (H1 the most significant bit). */
function entWeightTableR(G) {
  const m = G.nodes.length;
  if (m > 8) return `# The intersection weight table is written for up to 8 hypotheses (this graph has ${m}).\n`;
  const fg = floatGraph(G), W = closureWeights(fg);
  const lines = [];
  for (let r = 1; r < (1 << m); r++) {
    let mask = 0; const mem = [];
    for (let j = 0; j < m; j++) { const b = (r >> (m - 1 - j)) & 1; mem.push(b); if (b) mask |= 1 << j; }
    const ws = []; for (let i = 0; i < m; i++) ws.push(mem[i] ? String(Number(W[mask * m + i].toPrecision(12))) : '0');
    lines.push('  ' + mem.join(', ') + ',  ' + ws.join(', '));
  }
  return `# Intersection weights of the whole procedure (Maurer and Bretz, 2013, Algorithm 2, p. 1745):\n# one row per intersection hypothesis; columns 1 to ${m} say which hypotheses it contains (1 = in),\n# columns ${m + 1} to ${2 * m} give the weights. Same layout and row order as gMCP's generateWeights().\nsketchpad_weights <- matrix(c(\n${lines.join(',\n')}\n), ncol = ${2 * m}, byrow = TRUE)\n`;
}
function exportGMCPEntangled(G) {
  const m = G.nodes.length, n = G.ent.comps.length, pv = pVector(G), t = G.test || defaultTest();
  const names = `c(${G.nodes.map(x => rStr(x.label)).join(', ')})`;
  let s = `# Written by Multiplicity Graph Sketchpad ${APP_VERSION}\nlibrary(gMCP)\n# Entangled graph (Maurer and Bretz, 2013): ${n} component graphs on the same hypotheses, joined with the\n# component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).\n${varsComment(G)}`;
  for (let k = 0; k < n; k++) {
    const c = entCompR(G, k, '  ');
    s += `\n${entCompComment(G, k)}\nm_${k + 1} <- matrix(c(\n${c.rows.join(',\n')}\n), nrow = ${m}, byrow = TRUE)\nweights_${k + 1} <- c(${c.weights})\nrownames(m_${k + 1}) <- colnames(m_${k + 1}) <- ${names}\ngraph_${k + 1} <- matrix2graph(m_${k + 1}, weights_${k + 1})\n`;
  }
  s += `\ngraph <- new("entangledMCP", subgraphs = list(${G.ent.comps.map((_, k) => `graph_${k + 1}`).join(', ')}),\n  weights = c(${G.ent.c.map(rNum).join(', ')}))\ngraph\n`;
  s += `\n# Intersection weights of the whole procedure (Algorithm 2, p. 1745); the Sketchpad's table is below for comparison\ngenerateWeights(graph)\n${entWeightTableR(G)}max(abs(generateWeights(graph) - sketchpad_weights))\n`;
  if (pv) {
    if (t.type === 'bonferroni') s += `\n# NOTE: for an entangled graph gMCP rejects when p < level (strict), the Sketchpad when p <= level; they differ\n# only if a p-value equals its level exactly. gMCP gives no adjusted p-values for entangled graphs${t.upscale ? ',\n# and ignores upscale = TRUE for them' : ''}.\ngMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)})\n`;
    else if (t.type === 'simes' || t.type === 'simes-groups') s += `\n# No test call: gMCP 0.8-17 stops with "Simes test is not yet supported for entangled graphs". The Sketchpad\n# runs the closed test on the intersection weights above (Maurer and Bretz, 2013, p. 1745); check it by hand\n# with sketchpad_weights, or test the Bonferroni version with gMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}).\n`;
    else s += `\n# No test call: gMCP's parametric test does not support entangled graphs ("parametric case does not support\n# multiple graphs yet"). Check the closed test by hand with sketchpad_weights, or test the Bonferroni version\n# with gMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}).\n`;
  }
  return s;
}
function exportGraphicalMCPEntangled(G) {
  const m = G.nodes.length, n = G.ent.comps.length, pv = pVector(G), t = G.test || defaultTest();
  const names = `c(${G.nodes.map(x => rStr(x.label)).join(', ')})`;
  let s = `# Written by Multiplicity Graph Sketchpad ${APP_VERSION}\nlibrary(graphicalMCP)\n# Entangled graph (Maurer and Bretz, 2013): ${n} component graphs on the same hypotheses, joined with the\n# component weights c. graphicalMCP has no object for an entangled graph, so this file builds each component\n# and gives the intersection weights of the whole procedure for a closed test by hand. To test the whole\n# procedure in R use the gMCP export instead.\n${varsComment(G)}`;
  for (let k = 0; k < n; k++) {
    const c = entCompR(G, k, '    ');
    s += `\n${entCompComment(G, k)}\ngraph_${k + 1} <- graph_create(\n  hypotheses = c(${c.weights}),\n  transitions = matrix(c(\n${c.rows.join(',\n')}\n  ), nrow = ${m}, byrow = TRUE),\n  hyp_names = ${names}\n)\n`;
  }
  s += `\nc_weights <- c(${G.ent.c.map(rNum).join(', ')})\nhyp_names <- ${names}\n\n${entWeightTableR(G)}`;
  if (m <= 8) s += `# The same weights follow from graph_generate_weights(graph_1), graph_generate_weights(graph_2), ... combined\n# with c_weights (see that function's help page for the layout of its result).\n`;
  if (pv && m <= 8) {
    s += `\np <- ${pv}\nalpha <- ${fmtNum(G.alpha, 12)}\nm <- ${m}\nin_set <- sketchpad_weights[, 1:m] == 1\nw <- sketchpad_weights[, m + (1:m)]\n`;
    s += `# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected\n# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,\n# 2013, p. 1745).\nrej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)\nrejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))\nnames(rejected) <- hyp_names\nrejected\n`;
    if (t.type !== 'bonferroni') s += `# The Sketchpad's test type here is ${t.type === 'parametric' ? 'parametric' : 'Simes'}: replace the Bonferroni test of each intersection with that test on the same weights.\n`;
  } else if (pv) s += `\n# Enter up to 8 hypotheses to get the closed test by hand here.\n`;
  else s += `\n# Enter a p-value for every hypothesis to add the closed test by hand here.\n`;
  return s;
}
function exportGraphicalMCP(G) {
  if (isEntangled(G)) return exportGraphicalMCPEntangled(G);
  const m = G.nodes.length;
  const rows = matrixRows(G, rNum).map(r => '    ' + r.join(', '));
  const pv = pVector(G);
  let s = `# Written by Multiplicity Graph Sketchpad ${APP_VERSION}\nlibrary(graphicalMCP)\n${varsComment(G)}\ngraph <- graph_create(\n  hypotheses = c(${G.nodes.map(n => rNum(n.w)).join(', ')}),\n  transitions = matrix(c(\n${rows.join(',\n')}\n  ), nrow = ${m}, byrow = TRUE),\n  hyp_names = c(${G.nodes.map(n => rStr(n.label)).join(', ')})\n)\ngraph\n`;
  const t = G.test || defaultTest();
  if (pv) {
    if (t.type === 'bonferroni') s += `\ngraph_test_shortcut(graph, p = ${pv}, alpha = ${fmtNum(G.alpha, 12)})\n`;
    else if (t.type === 'simes') s += `\ngraph_test_closure(graph, p = ${pv}, alpha = ${fmtNum(G.alpha, 12)}, test_types = "simes")\n`;
    else if (t.type === 'simes-groups') {
      const groups = [...new Set(G.nodes.map(n => n.group).filter(Boolean))];
      const gl = groups.map(g => `c(${G.nodes.map((n, i) => (n.group === g ? i + 1 : null)).filter(Boolean).join(', ')})`);
      const rest = G.nodes.map((n, i) => (n.group ? null : i + 1)).filter(Boolean);
      const types = groups.map(() => '"simes"');
      if (rest.length) { gl.push(`c(${rest.join(', ')})`); types.push('"bonferroni"'); }
      s += `\n# NOTE: graphicalMCP applies the weighted Simes test within each test group and combines the\n# groups by Bonferroni (Bretz et al. 2011, eq. 8; Lu 2016). The Sketchpad's "Simes within groups"\n# follows gMCP's simes.on.subsets.test instead: Simes only when every hypothesis of an intersection\n# is in one group, plain Bonferroni otherwise. graphicalMCP's test is at least as powerful, so it can\n# reject more than the Sketchpad; the two agree whenever every intersection lies within one group.\ngraph_test_closure(graph, p = ${pv}, alpha = ${fmtNum(G.alpha, 12)},\n  test_groups = list(${gl.join(', ')}), test_types = c(${types.join(', ')}))\n`;
    } else {
      /* graphicalMCP wants one parametric test group per block of known correlations, each with its own
         (complete) correlation matrix, and Bonferroni for the hypotheses whose correlations are unknown. */
      const tt = G.test || defaultTest();
      const corrAt = (i, j) => { const a = G.nodes[i].id, b = G.nodes[j].id; const v = tt.corr[a < b ? a + '|' + b : b + '|' + a]; return v == null ? null : v; };
      let blocks;
      try { blocks = corrBlocks(G.nodes.map((_, i) => i), corrAt); } catch (e) { blocks = null; }
      if (!blocks) s += `\n# The known correlations do not form complete blocks, so no test call can be written. Fix the correlation matrix in the Test tab.\n`;
      else {
        const para = blocks.filter(b => b.length > 1), single = blocks.filter(b => b.length === 1).map(b => b[0]);
        const gl = [], types = [], corrs = [];
        para.forEach((b, k) => {
          gl.push(`c(${b.map(i => i + 1).join(', ')})`); types.push('"parametric"');
          const rows = b.map(i => '  ' + b.map(j => (i === j ? '1' : String(corrAt(i, j)))).join(', '));
          s += `\n# Correlation of the test statistics for ${b.map(i => G.nodes[i].label).join(', ')} (one-sided tests, multivariate normal)\ncorr_${k + 1} <- matrix(c(\n${rows.join(',\n')}\n), nrow = ${b.length}, byrow = TRUE)\n`;
          corrs.push(`corr_${k + 1}`);
        });
        if (single.length) { gl.push(`c(${single.map(i => i + 1).join(', ')})`); types.push('"bonferroni"'); corrs.push('NA'); }
        s += `\n# Parametric test within each block of known correlations, Bonferroni between blocks (Xi et al. 2017)\ngraph_test_closure(graph, p = ${pv}, alpha = ${fmtNum(G.alpha, 12)},\n  test_groups = list(${gl.join(', ')}),\n  test_types = c(${types.join(', ')}),\n  test_corr = list(${corrs.join(', ')}))\n`;
      }
    }
    if (t.upscale && t.type !== 'bonferroni') s += `# The Sketchpad's "upscale" option (gMCP upscale = TRUE) has no graphicalMCP equivalent; results differ\n# for intersections whose weights sum to less than 1.\n`;
  } else s += `\n# Enter a p-value for every hypothesis to add the test call here.\n`;
  return s;
}
function corrRowsR(G) {
  const t = G.test || defaultTest();
  return G.nodes.map(a => G.nodes.map(b => {
    if (a.id === b.id) return '1';
    const v = t.corr[a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id];
    return v == null ? 'NA' : String(v);
  }));
}
function exportGMCP(G) {
  if (isEntangled(G)) return exportGMCPEntangled(G);
  const m = G.nodes.length;
  const rows = matrixRows(G, rNum).map(r => '  ' + r.join(', '));
  const pv = pVector(G);
  let s = `# Written by Multiplicity Graph Sketchpad ${APP_VERSION}\nlibrary(gMCP)\n${varsComment(G)}\nm <- matrix(c(\n${rows.join(',\n')}\n), nrow = ${m}, byrow = TRUE)\nweights <- c(${G.nodes.map(n => rNum(n.w)).join(', ')})\nrownames(m) <- colnames(m) <- c(${G.nodes.map(n => rStr(n.label)).join(', ')})\n\ngraph <- matrix2graph(m, weights)\ngraph\n`;
  const t = G.test || defaultTest();
  if (pv) {
    if (t.type === 'bonferroni') s += `\ngMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}${t.upscale ? ', upscale = TRUE' : ''})\n`;
    else if (t.type === 'simes') s += `\ngMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}, test = "Simes"${t.upscale ? ', upscale = TRUE' : ''})\n`;
    else if (t.type === 'simes-groups') {
      const groups = [...new Set(G.nodes.map(n => n.group).filter(Boolean))];
      s += `\ngMCP.extended(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}, test = simes.on.subsets.test,\n  subsets = list(${groups.map(g => `c(${G.nodes.map((n, i) => (n.group === g ? i + 1 : null)).filter(Boolean).join(', ')})`).join(', ')})${t.upscale ? ', upscale = TRUE' : ''})\n`;
    } else {
      s += `\n# Parametric test. NA marks an unknown correlation.\n# NOTE: gMCP finds one constant for all blocks of known correlation in an intersection (Bretz et al. 2011,\n# eq. 3; w.dunnet in gMCP). The Sketchpad, like graphicalMCP, finds a separate constant for each block\n# (Xi et al. 2017, eq. 6). Results can differ slightly when an intersection has two or more blocks with weight.\ncorrelation <- matrix(c(\n${corrRowsR(G).map(r => '  ' + r.join(', ')).join(',\n')}\n), nrow = ${m}, byrow = TRUE)\ngMCP(graph, pvalues = ${pv}, alpha = ${fmtNum(G.alpha, 12)}, test = "parametric", correlation = correlation, upscale = ${t.upscale ? 'TRUE' : 'FALSE'})\n`;
    }
  }
  return s;
}
function texEscape(s) {
  const t = String(s).replace(/\\/g, '\\textbackslash{}').replace(/([#$%&_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
  const sym = { '\u03b1': '$\\alpha$', '\u2264': '$\\le$', '\u2265': '$\\ge$', '\u00d7': '$\\times$', '\u2192': '$\\to$', '\u2013': '--', '\u2014': '---', '\u2713': '$\\checkmark$', '\u2715': '$\\times$', '\u1d62': '$_i$' };
  return t.replace(/[\u03b1\u2264\u2265\u00d7\u2192\u2013\u2014\u2713\u2715\u1d62]/g, c => sym[c]);
}
function texLabel(label) {
  const lp = labelParts(label);
  return lp ? `$${lp.base}_{${lp.sub}}$` : texEscape(label);
}
/* vector of component weights, e.g. $(1, 0)$, in the All view of an entangled graph */
function texVec(v) { return `{\\scriptsize $(${v.map(q => texNum(q).slice(1, -1)).join(', ')})$}`; }
function texNum(q) {
  if (q.d === 1n) return `$${q.n}$`;
  if (q.d <= 1000n) return `$${q.n < 0n ? '-' : ''}\\frac{${q.n < 0n ? -q.n : q.n}}{${q.d}}$`;
  return `$${Q.dec(q)}$`;
}
/* vm nodes carry x, y, rx, ry, label, w (Q), rejected; layout from layoutEdges */
/* Bounding boxes of the groups (primary, secondary, ...) for shaded bands behind the nodes */
function groupBoxes(vm, pad = 22) {
  const groups = [...new Set(vm.nodes.map(n => n.group).filter(Boolean))];
  return groups.map(g => {
    const ns = vm.nodes.filter(n => n.group === g);
    const x1 = Math.min(...ns.map(n => n.x - n.rx)) - pad, x2 = Math.max(...ns.map(n => n.x + n.rx)) + pad;
    const y1 = Math.min(...ns.map(n => n.y - n.ry)) - pad - 16, y2 = Math.max(...ns.map(n => n.y + n.ry + (n.capH || 0))) + pad;
    const colored = ns.find(n => n.color);
    return { group: g, x: x1, y: y1, w: x2 - x1, h: y2 - y1, color: colored ? colored.color : '' };
  });
}
const TIKZ_S = 60; // pixels per cm
/* The style lines of a picture; withComp adds one line style per component (All view and side-by-side panels) */
function tikzStyles(withComp) {
  const L = ['\\begin{tikzpicture}['];
  L.push('  hyp/.style={circle, draw, thick, minimum size=1.2cm, inner sep=1pt, outer sep=0pt, align=center, font=\\small},');
  L.push('  hypwide/.style={ellipse, draw, thick, inner sep=1pt, outer sep=0pt, align=center, font=\\small},');
  L.push('  rejected/.style={draw=gray, dashed, text=gray},');
  L.push('  trans/.style={-{Stealth[length=2.2mm]}, semithick},');
  L.push('  wt/.style={fill=white, draw, rounded corners=1pt, inner sep=1.5pt, font=\\scriptsize}' + (withComp ? ',' : ''));
  if (withComp) {
    /* entangled graph: one line style per component (Maurer and Bretz, 2013, Fig. 2, p. 1746, and Fig. 3, p. 1747) */
    L.push('  comp1/.style={dashed},');
    L.push('  comp2/.style={dotted, line cap=round},');
    L.push('  comp3/.style={dash pattern=on 5pt off 2pt on 1pt off 2pt}');
  }
  L.push(']');
  return L;
}
/* The bands, nodes, edges, key and level captions of one picture. cx, cy map pixels to cm. opts.cScale (a Q):
   the level under a node is c x w x alpha, the component's own level in a side-by-side panel (Algorithm 1, p. 1743). */
function tikzBody(vm, layout, opts, cx, cy) {
  const S = TIKZ_S;
  const id = n => 'n' + (vm.nodes.indexOf(n) + 1);
  const L = [];
  const boxes = opts.bands === false ? [] : groupBoxes(vm);
  const cols = [...new Set(vm.nodes.filter(n => n.color && !n.rejected).map(n => n.color.toUpperCase()))];
  cols.forEach((c, i) => L.push(`\\definecolor{hypfill${String.fromCharCode(65 + i)}}{HTML}{${c.slice(1)}}`));
  if (boxes.length) {
    L.push('\\begin{scope}[on background layer]');
    boxes.forEach((b, i) => {
      if (b.color) L.push(`\\definecolor{band${String.fromCharCode(65 + i)}}{HTML}{${b.color.slice(1).toUpperCase()}}`);
      const col = b.color ? `band${String.fromCharCode(65 + i)}!35` : 'gray!12';
      L.push(`\\draw[fill=${col}, draw=${b.color ? `band${String.fromCharCode(65 + i)}!70` : 'gray!40'}, rounded corners=6pt] (${cx(b.x)}, ${cy(b.y)}) rectangle (${cx(b.x + b.w)}, ${cy(b.y + b.h)}) node[anchor=north west, inner sep=4pt, font=\\scriptsize\\scshape, text=black!70] at (${cx(b.x)}, ${cy(b.y)}) {${texEscape(b.group)}};`);
    });
    L.push('\\end{scope}');
  }
  for (const n of vm.nodes) {
    const wide = Math.abs(n.rx - n.ry) > 0.5;
    let style = wide ? `hypwide, minimum width=${(2 * n.rx / S).toFixed(2)}cm, minimum height=${(2 * n.ry / S).toFixed(2)}cm` : 'hyp';
    if (n.rejected) style += ', rejected';
    else if (n.color) { const k = cols.indexOf(n.color.toUpperCase()); style += `, fill=hypfill${String.fromCharCode(65 + k)}${textOnColor(n.color) === '#ffffff' ? ', text=white' : ''}`; }
    L.push(`\\node[${style}] (${id(n)}) at (${cx(n.x)}, ${cy(n.y)}) {${texLabel(n.label)}\\\\ ${n.wvec ? texVec(n.wvec) : n.wexpr && !n.rejected ? exprTeX(n.wexpr) : texNum(n.w)}};${n.rejected ? ' % rejected' : ''}`);
  }
  const compOf = e => (vm.all && e.comp != null ? e.comp : vm.comp != null ? vm.comp : 0);
  for (const e of layout) {
    const A = id(e.a), B = id(e.b);
    const lab = `node[wt, pos=${e.label.t.toFixed(2)}] {${e.expr ? exprTeX(e.expr) : texNum(e.g)}}`;
    const st = 'trans' + (compOf(e) % 4 ? `, comp${compOf(e) % 4}` : '');
    if (e.straight) L.push(`\\draw[${st}] (${A}) -- ${lab} (${B});`);
    else {
      const c1 = { x: e.s.x + 2 / 3 * (e.c.x - e.s.x), y: e.s.y + 2 / 3 * (e.c.y - e.s.y) };
      const c2 = { x: e.e.x + 2 / 3 * (e.c.x - e.e.x), y: e.e.y + 2 / 3 * (e.c.y - e.e.y) };
      L.push(`\\draw[${st}] (${A}.${e.s.ang.toFixed(1)}) .. controls (${cx(c1.x)}, ${cy(c1.y)}) and (${cx(c2.x)}, ${cy(c2.y)}) .. ${lab} (${B}.${e.e.ang.toFixed(1)});`);
    }
  }
  if (vm.all) {
    /* key: one short line per component below the picture */
    const kx = Math.min(...vm.nodes.map(n => n.x - n.rx)), ky = Math.max(...vm.nodes.map(n => n.y + n.ry + (n.capH || 0))) + (opts.levels ? 60 : 36);
    for (let k = 0; k < vm.n; k++) {
      const st = 'semithick' + (k % 4 ? `, comp${k % 4}` : '');
      L.push(`\\draw[${st}] (${cx(kx)}, ${cy(ky + 18 * k)}) -- ++(0.7, 0) node[right, font=\\scriptsize] {Graph ${k + 1}${vm.c ? ` ($c = ${texNum(vm.c[k]).slice(1, -1)}$)` : ''}};`);
    }
  }
  if (opts.levels && opts.alpha != null) {
    for (const n of vm.nodes) {
      const lv = opts.cScale ? Q.toNum(Q.mul(n.w, opts.cScale)) * opts.alpha : Q.toNum(n.w) * opts.alpha;
      if (n.rejected) L.push(`\\node[below=1pt of ${id(n)}, font=\\scriptsize, text=gray, fill=white, inner sep=1pt] {rejected};`);
      else L.push(`\\node[below=1pt of ${id(n)}, font=\\scriptsize, align=center, fill=white, inner sep=1pt] {level $${fmtNum(lv)}$${n.p != null && Number.isFinite(parseP(n.p)) ? `\\\\ $p = ${fmtNum(parseP(n.p))}$` : ''}};`);
    }
  }
  return L;
}
function exportTikZ(vm, layout, opts = {}) {
  const S = TIKZ_S;
  const xs = vm.nodes.map(n => n.x), ys = vm.nodes.map(n => n.y);
  const x0 = opts.x0 != null ? opts.x0 : Math.min(...xs), y0 = opts.y0 != null ? opts.y0 : Math.min(...ys);
  const cx = x => ((x - x0) / S).toFixed(2), cy = y => (-(y - y0) / S).toFixed(2);
  const L = [];
  const boxes = opts.bands === false ? [] : groupBoxes(vm);
  if (!opts.inner) L.push(`% Needs: \\usepackage{tikz} and \\usetikzlibrary{arrows.meta, shapes.geometric${boxes.length ? ', backgrounds' : ''}}`);
  L.push(...tikzStyles(!!vm.all));
  L.push(...tikzBody(vm, layout, opts, cx, cy));
  L.push('\\end{tikzpicture}');
  return L.join('\n') + '\n';
}
/* The component graphs side by side (Fig. 2, p. 1746): one tikzpicture, one scope per panel with a name prefix so
   node names stay unique, and the component's name and c under each panel. opts.box: a common box across several
   pictures (the beamer overlays), so the panels keep their places from frame to frame. */
function exportTikZPanels(panels, opts = {}) {
  const S = TIKZ_S, gap = 0.8, labelCm = 0.55;
  const P = panelPlaces(panels, 0, 0);
  const box = opts.box || P.box;
  const bw = (box.maxX - box.minX) / S, bh = (box.maxY - box.minY) / S + (opts.levels ? 0.6 : 0);
  const cols = P.cols;
  const L = [];
  const bands = panels.some(p => groupBoxes(p.vm).length);
  if (!opts.inner) L.push(`% Needs: \\usepackage{tikz} and \\usetikzlibrary{arrows.meta, shapes.geometric, positioning${bands ? ', backgrounds' : ''}}`);
  if (!opts.inner) L.push(`% The component graphs of an entangled graph drawn side by side (Maurer and Bretz, 2013, Fig. 2).`);
  L.push(...tikzStyles(true));
  panels.forEach((p, k) => {
    const dx = (k % cols) * (bw + gap), dy = -Math.floor(k / cols) * (bh + labelCm + gap);
    const cx = x => ((x - box.minX) / S).toFixed(2), cy = y => (-(y - box.minY) / S).toFixed(2);
    L.push(`\\begin{scope}[xshift=${dx.toFixed(2)}cm, yshift=${dy.toFixed(2)}cm, name prefix=g${k + 1}-]`);
    L.push(...tikzBody(p.vm, p.layout, Object.assign({}, opts, { cScale: p.c }), cx, cy));
    L.push(`\\node[font=\\small\\bfseries, anchor=north] at (${(bw / 2).toFixed(2)}, ${(-bh - 0.2).toFixed(2)}) {Graph ${k + 1}${p.c ? ` ($c = ${texNum(p.c).slice(1, -1)}$)` : ''}};`);
    L.push('\\end{scope}');
  });
  L.push('\\end{tikzpicture}');
  const rows = Math.ceil(panels.length / cols);
  return { text: L.join('\n') + '\n', widthCm: cols * bw + (cols - 1) * gap, heightCm: rows * (bh + labelCm + 0.45) + (rows - 1) * gap, box };
}
/* Beamer frame with one overlay per step. frames: [{vm, layout, caption, alpha}], or [{panels, caption, alpha}]
   for an entangled graph drawn side by side (every overlay is the panel set at that step, the panels keeping
   their places; a picture too wide or too tall for the frame is scaled down with \resizebox). */
function exportBeamer(frames, title) {
  const L = [];
  L.push('% Needs in the preamble: \\usepackage{tikz} \\usetikzlibrary{arrows.meta, shapes.geometric, positioning, backgrounds}');
  L.push('% One overlay per step: use the arrow keys in the PDF viewer to step through the rejections.');
  L.push(`\\begin{frame}{${texEscape(title)}}`);
  L.push('\\centering');
  if (frames.some(f => f.panels)) {
    const box = panelPlaces(frames.flatMap(f => f.panels), 0, 0).box;
    frames.forEach((f, k) => {
      const r = exportTikZPanels(f.panels, { inner: true, levels: true, alpha: f.alpha, box });
      /* fit the picture into the frame: about 11 cm wide and 6.2 cm tall under a Metropolis frame title with the caption below */
      const scale = Math.min(1, 11 / r.widthCm, 6.2 / r.heightCm);
      L.push(`\\only<${k + 1}>{%`);
      if (scale < 1) L.push(`\\resizebox{${(r.widthCm * scale).toFixed(2)}cm}{!}{%`);
      L.push(r.text.trimEnd());
      if (scale < 1) L.push('}');
      L.push('}');
    });
  } else {
    const allX = frames.flatMap(f => f.vm.nodes.map(n => n.x)), allY = frames.flatMap(f => f.vm.nodes.map(n => n.y));
    const x0 = Math.min(...allX), y0 = Math.min(...allY);
    frames.forEach((f, k) => {
      L.push(`\\only<${k + 1}>{%`);
      L.push(exportTikZ(f.vm, f.layout, { inner: true, x0, y0, levels: true, alpha: f.alpha }).trimEnd());
      L.push('}');
    });
  }
  L.push('\\par\\vspace{0.5em}');
  frames.forEach((f, k) => L.push(`\\only<${k + 1}>{\\small ${texEscape(f.caption)}}`));
  L.push('\\end{frame}');
  return L.join('\n') + '\n';
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function svgLabelText(label, x, y, size, attrs) {
  const lp = labelParts(label);
  if (lp) return `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${xmlEsc(lp.base)}<tspan font-size="${(size * 0.7).toFixed(1)}" dy="${(size * 0.28).toFixed(1)}">${xmlEsc(lp.sub)}</tspan></text>`;
  return `<text x="${x}" y="${y}" font-size="${size - 2}" ${attrs}>${xmlEsc(label)}</text>`;
}
/* Unpadded bounds of a picture: nodes, group bands, every curve and its label, and the All view's key */
function svgBounds(vm, layout) {
  const pts = [];
  for (const n of vm.nodes) pts.push([n.x - n.rx, n.y - n.ry], [n.x + n.rx, n.y + n.ry]);
  for (const b of groupBoxes(vm)) pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]);
  for (const e of layout) {
    for (let t = 0; t <= 1; t += 0.1) { const p = pointAt(e, t); pts.push([p.x, p.y]); }
    pts.push([e.label.r.x, e.label.r.y], [e.label.r.x + e.label.r.w, e.label.r.y + e.label.r.h]);
  }
  const key = vm.all ? { x: Math.min(...vm.nodes.map(n => n.x - n.rx)), y: Math.max(...vm.nodes.map(n => n.y + n.ry + (n.capH || 0))) + 30 } : null;
  if (key) { pts.push([key.x, key.y - 8], [key.x + 160, key.y + 18 * vm.n]); }
  if (!pts.length) pts.push([0, 0], [100, 100]);
  return { key, minX: Math.min(...pts.map(p => p[0])), minY: Math.min(...pts.map(p => p[1])), maxX: Math.max(...pts.map(p => p[0])), maxY: Math.max(...pts.map(p => p[1])) };
}
const SVG_INK = '#1b1f23', SVG_GREY = '#9aa0a6', SVG_FONT = 'Helvetica, Arial, sans-serif';
const SVG_DASH = ['', ' stroke-dasharray="9 5"', ' stroke-dasharray="2.5 4" stroke-linecap="round"', ' stroke-dasharray="10 4 2.5 4"'];
const SVG_LDASH = ['', ' stroke-dasharray="4 3"', ' stroke-dasharray="1.5 3"', ' stroke-dasharray="5 3 1.5 3"'];
/* The elements of a picture (no <svg> wrapper, no background). vm.all: the All view, one line style per
   component (e.comp); vm.comp: one component drawn on its own in that component's line style (a side-by-side panel). */
function svgBody(vm, layout, fmt, key) {
  const ink = SVG_INK, grey = SVG_GREY;
  const o = [];
  for (const b of groupBoxes(vm)) {
    o.push(`<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="10" fill="${b.color || '#e9ebee'}" fill-opacity="${b.color ? 0.35 : 0.6}" stroke="${b.color || '#c4c9d0'}" stroke-opacity="0.7"/>`);
    o.push(`<text x="${(b.x + 10).toFixed(1)}" y="${(b.y + 16).toFixed(1)}" font-size="12" letter-spacing="1" fill="#5a6470">${xmlEsc(String(b.group).toUpperCase())}</text>`);
  }
  const compOf = e => (vm.all && e.comp != null ? e.comp : vm.comp != null ? vm.comp : null);
  const dashOf = e => (compOf(e) != null ? SVG_DASH[compOf(e) % 4] : '');
  for (const e of layout) o.push(`<path d="${e.d}" fill="none" stroke="${ink}" stroke-width="1.6"${dashOf(e)} marker-end="url(#ah)"/>`);
  for (const e of layout) {
    const l = e.label;
    o.push(`<rect x="${l.r.x.toFixed(1)}" y="${l.r.y.toFixed(1)}" width="${l.w.toFixed(1)}" height="${l.h}" rx="3" fill="#ffffff" stroke="${ink}" stroke-width="0.8"${compOf(e) != null ? SVG_LDASH[compOf(e) % 4] : ''}/>`);
    o.push(`<text x="${l.x.toFixed(1)}" y="${(l.y + 4.3).toFixed(1)}" font-size="12.5" text-anchor="middle" fill="${ink}">${xmlEsc(e.text)}</text>`);
  }
  for (const n of vm.nodes) {
    const col = n.rejected ? grey : (n.color ? textOnColor(n.color) : ink);
    o.push(`<ellipse cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" rx="${n.rx.toFixed(1)}" ry="${n.ry.toFixed(1)}" fill="${n.rejected ? '#f1f2f3' : (n.color || '#ffffff')}" stroke="${col}" stroke-width="1.8"${n.rejected ? ' stroke-dasharray="4 3"' : ''}/>`);
    o.push(svgLabelText(n.label, n.x.toFixed(1), (n.y - 3).toFixed(1), 17, `text-anchor="middle" font-weight="700" fill="${col}"`));
    const wt = n.wvec ? `(${n.wvec.map(q => fmt(q)).join(', ')})` : n.wexpr && !n.rejected ? exprDisplay(n.wexpr) : fmt(n.w);
    o.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 16).toFixed(1)}" font-size="${n.wvec && wt.length > 7 ? 11 : 13}" text-anchor="middle" fill="${col}">${xmlEsc(wt)}</text>`);
    if (n.rejected) o.push(`<line x1="${(n.x - n.rx * 0.62).toFixed(1)}" y1="${(n.y - 8).toFixed(1)}" x2="${(n.x + n.rx * 0.62).toFixed(1)}" y2="${(n.y - 8).toFixed(1)}" stroke="${grey}" stroke-width="2"/>`);
  }
  if (key) {
    for (let k = 0; k < vm.n; k++) {
      const y = key.y + 18 * k;
      o.push(`<line x1="${key.x.toFixed(1)}" y1="${y}" x2="${(key.x + 34).toFixed(1)}" y2="${y}" stroke="${ink}" stroke-width="1.6"${SVG_DASH[k % 4]}/>`);
      o.push(`<text x="${(key.x + 42).toFixed(1)}" y="${y + 4}" font-size="12" fill="${ink}">Graph ${k + 1}${vm.c ? ` (c = ${fmt(vm.c[k])})` : ''}</text>`);
    }
  }
  return o;
}
const svgArrowDef = () => `<defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${SVG_INK}"/></marker></defs>`;
function exportSVG(vm, layout, fmt) {
  const b = svgBounds(vm, layout);
  const pad = 24;
  const minX = b.minX - pad, minY = b.minY - pad;
  const W = b.maxX + pad - minX, H = b.maxY + pad - minY;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" font-family="${SVG_FONT}">`);
  o.push(svgArrowDef());
  o.push(`<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#ffffff"/>`);
  o.push(...svgBody(vm, layout, fmt, b.key));
  o.push('</svg>');
  return o.join('\n');
}

/* ---------- Side by side: the component graphs of an entangled graph as separate panels ----------
   Maurer and Bretz (2013), Fig. 2, p. 1746, draws the two component graphs next to each other with the
   hypotheses in the same places; Fig. 3, p. 1747, overlays them (the app's All view). Here every component is
   drawn as an ordinary graph in that component's line style, with its name and share c under the panel. */
/* Panels in a row: two or three side by side; four as a 2 x 2 grid; more in rows of three */
function panelColumns(n) { return n <= 3 ? n : n === 4 ? 2 : 3; }
/* One view model per component, nodes in the shared positions. G: the entangled graph. st: an entangled state
   (stateFromGraph, or the test's current state) for the current weights and transitions; null for the stored
   design graph with its symbolic labels. rejected: Map id -> { wvec } (or any Map or Set of ids) for the
   hypotheses already rejected; a rejected hypothesis shows the component weight it had when rejected (wvec[k])
   when given. Returns [{ vm, layout, title, c }]. */
function componentPanels(G, st, rejected, fmt, capH) {
  entSync(G);
  const rej = rejected || new Map();
  const info = id => (rej.has(id) && typeof rej.get === 'function' ? rej.get(id) : null);
  return G.ent.comps.map((_, k) => {
    const v = entViewGraph(G, k), cs = st ? st.ent.comps[k] : null;
    const nodes = v.nodes.map(n => {
      const r = info(n.id), isRej = rej.has(n.id);
      const w = isRej && r && r.wvec ? (r.wvec[k] || Q.ZERO) : cs ? (cs.w.get(n.id) || Q.ZERO) : n.w;
      return { id: n.id, label: n.label, x: n.x, y: n.y, rx: nodeRx(n.label), ry: NODE_R, p: n.p, color: n.color || '', group: n.group || '', wexpr: st ? '' : (n.wexpr || ''), w, rejected: isRej, capH: capH || 0 };
    });
    const edges = cs
      ? [...cs.g.entries()].filter(([, g]) => !Q.isZero(g)).map(([key, g]) => { const [a, b] = key.split('>'); const o = v.edges.find(e => e.from === a && e.to === b); return { from: a, to: b, g, bend: o ? o.bend : null, text: fmt(g) }; })
      : v.edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend, expr: e.expr, text: e.expr ? exprDisplay(e.expr) : fmt(e.g) }));
    const vm = { nodes, edges, comp: k };
    return { vm, layout: layoutEdges(vm), title: `Graph ${k + 1} (c = ${fmt(G.ent.c[k])})`, c: G.ent.c[k] };
  });
}
/* The common box of a set of panels (so every panel is the same size) and where each panel goes */
function panelPlaces(panels, gap, labelH) {
  const bs = panels.map(p => svgBounds(p.vm, p.layout));
  const box = { minX: Math.min(...bs.map(b => b.minX)), minY: Math.min(...bs.map(b => b.minY)), maxX: Math.max(...bs.map(b => b.maxX)), maxY: Math.max(...bs.map(b => b.maxY)) };
  const pad = 24, pw = box.maxX - box.minX + 2 * pad, ph = box.maxY - box.minY + 2 * pad;
  const cols = panelColumns(panels.length), rows = Math.ceil(panels.length / cols);
  const at = panels.map((_, k) => ({ dx: (k % cols) * (pw + gap), dy: Math.floor(k / cols) * (ph + labelH + gap) }));
  return { box, pad, pw, ph, cols, rows, at, W: cols * pw + (cols - 1) * gap, H: rows * (ph + labelH) + (rows - 1) * gap };
}
/* One SVG with every panel: the picture of each component translated into place and its title underneath */
function exportSVGPanels(panels, fmt) {
  const gap = 48, labelH = 28;
  const P = panelPlaces(panels, gap, labelH);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(P.W)}" height="${Math.ceil(P.H)}" viewBox="0 0 ${P.W.toFixed(1)} ${P.H.toFixed(1)}" font-family="${SVG_FONT}">`);
  o.push(svgArrowDef());
  o.push(`<rect x="0" y="0" width="${P.W.toFixed(1)}" height="${P.H.toFixed(1)}" fill="#ffffff"/>`);
  panels.forEach((p, k) => {
    const { dx, dy } = P.at[k];
    o.push(`<g transform="translate(${(dx + P.pad - P.box.minX).toFixed(1)}, ${(dy + P.pad - P.box.minY).toFixed(1)})">`);
    o.push(...svgBody(p.vm, p.layout, fmt, null));
    o.push('</g>');
    o.push(`<text x="${(dx + P.pw / 2).toFixed(1)}" y="${(dy + P.ph + 18).toFixed(1)}" font-size="14" font-weight="700" text-anchor="middle" fill="${SVG_INK}">${xmlEsc(p.title)}</text>`);
  });
  o.push('</svg>');
  return o.join('\n');
}

/* ---------- Serialisation and share links ---------- */
function serializeGraph(G) {
  const ent = isEntangled(G);
  if (ent) entSync(G);
  /* Version 2 (entangled): the top-level hypotheses and transitions hold component 1, so an older version of the
     app opens the file as that one graph; "ent" holds every component and the component weights. */
  const v0 = ent ? entViewGraph(G, 0) : G;
  const edgeOut = e => ({ from: e.from, to: e.to, weight: Q.exact(e.g), bend: e.bend == null ? null : Math.round(e.bend * 10) / 10, expr: e.expr || undefined });
  return {
    format: 'multiplicity-graph', version: ent ? 2 : 1, generator: 'Multiplicity Graph Sketchpad ' + APP_VERSION, alpha: G.alpha, sided: G.sided === 'two' ? 'two' : 'one', note: G.note || '',
    nodes: v0.nodes.map(n => ({ id: n.id, label: n.label, weight: Q.exact(n.w), x: Math.round(n.x), y: Math.round(n.y), p: n.p || '', color: n.color || '', desc: n.desc || '', group: n.group || '', wexpr: n.wexpr || undefined })),
    edges: v0.edges.map(edgeOut),
    vars: Object.keys(G.vars || {}).length ? Object.fromEntries(Object.entries(G.vars).map(([k, v]) => [k, Q.exact(v)])) : undefined,
    diag: ent ? [] : Object.keys(G.diag || {}).filter(k => G.diag[k] && !Q.isZero(G.diag[k])).map(k => ({ id: k, weight: Q.exact(G.diag[k]) })),
    test: serializeTest(G.test),
    optimisation: !ent && G.opt ? writeOptimisationBlock(G.opt) : undefined,
    ent: ent ? {
      c: G.ent.c.map(v => Q.exact(v)),
      cexpr: (G.ent.cexpr || []).some(Boolean) ? G.ent.comps.map((_, k) => (G.ent.cexpr || [])[k] || undefined) : undefined,
      active: G.ent.active,
      comps: G.ent.comps.map((cs, k) => { const v = entViewGraph(G, k); return { nodes: v.nodes.map(n => ({ id: n.id, weight: Q.exact(n.w), wexpr: n.wexpr || undefined })), edges: v.edges.map(edgeOut) }; })
    } : undefined
  };
}
function defaultTest() { return { type: 'bonferroni', upscale: false, corr: {} }; }
function serializeTest(t) {
  if (!t || (t.type === 'bonferroni' && !t.upscale && !Object.keys(t.corr || {}).length)) return undefined;
  return { type: t.type, upscale: !!t.upscale, corr: Object.assign({}, t.corr) };
}
function deserializeTest(t, map) {
  const out = defaultTest();
  if (!t || typeof t !== 'object') return out;
  if (TEST_TYPES[t.type]) out.type = t.type;
  out.upscale = !!t.upscale;
  for (const k of Object.keys(t.corr || {})) {
    const [a, b] = k.split('|'), ia = map ? map.get(a) : a, ib = map ? map.get(b) : b;
    const v = Number(t.corr[k]);
    if (ia && ib && Number.isFinite(v) && v >= -1 && v <= 1) out.corr[ia < ib ? ia + '|' + ib : ib + '|' + ia] = v;
  }
  return out;
}
/* Returns {G, maxId}. keepIds keeps node ids (used by undo); otherwise ids are renumbered. */
function deserializeGraph(o, keepIds, startId) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.nodes)) throw new Error('This file does not look like a saved graph (no list of hypotheses found).');
  const map = new Map(); let next = startId || 1; let maxId = 0;
  const num = (v, what) => {
    const q = typeof v === 'number' ? Q.fromNumber(v) : Q.parse(v);
    if (!q) throw new Error(`Could not read ${what} "${v}".`);
    return q;
  };
  const nodes = o.nodes.map((n, i) => {
    const oldId = n.id != null ? String(n.id) : 'i' + i;
    let id;
    if (keepIds) { id = oldId; const k = parseInt(String(id).replace(/\D/g, ''), 10); if (k > maxId) maxId = k; }
    else id = 'n' + (next++);
    map.set(oldId, id); map.set(String(i), id);
    return { id, label: String(n.label != null ? n.label : 'H' + (i + 1)), w: num(n.weight != null ? n.weight : 0, 'the weight'), x: +n.x || 0, y: +n.y || 0, p: n.p != null ? String(n.p) : '', color: validColor(n.color), desc: n.desc != null ? String(n.desc) : '', group: n.group != null ? String(n.group) : '', wexpr: n.wexpr ? normaliseExpr(n.wexpr) : undefined };
  });
  const edges = [];
  for (const e of o.edges || []) {
    const a = map.get(String(e.from)), b = map.get(String(e.to));
    if (!a || !b || a === b) continue;
    const g = e.expr ? Q.ZERO : num(e.weight, 'a transition weight');
    if (Q.isZero(g) && !e.expr) continue;
    edges.push({ from: a, to: b, g, bend: e.bend == null ? null : +e.bend, expr: e.expr ? normaliseExpr(e.expr) : undefined });
  }
  const diag = {};
  for (const d of o.diag || []) { const id = map.get(String(d.id)); if (id) diag[id] = num(d.weight, 'a diagonal entry'); }
  const alpha = Number(o.alpha);
  const vars = {};
  for (const [k, v] of Object.entries(o.vars || {})) { const q = typeof v === 'number' ? Q.fromNumber(v) : Q.parse(v); if (q) vars[normaliseExpr(k)] = q; }
  const Gout = { nodes, edges, diag, alpha: alpha > 0 && alpha < 1 ? alpha : 0.025, sided: o.sided === 'two' ? 'two' : 'one', note: String(o.note || ''), test: deserializeTest(o.test, map), vars };
  /* Version 2: entangled components. A file with a damaged "ent" block falls back to the top-level graph. */
  if (o.ent && typeof o.ent === 'object' && Array.isArray(o.ent.comps) && o.ent.comps.length) {
    const comps = o.ent.comps.map(cs => {
      const w = {}, wexpr = {};
      for (const n of (cs && Array.isArray(cs.nodes)) ? cs.nodes : []) {
        const id = map.get(String(n.id)); if (!id) continue;
        w[id] = num(n.weight != null ? n.weight : 0, 'a component weight');
        if (n.wexpr) wexpr[id] = normaliseExpr(n.wexpr);
      }
      const ce = [];
      for (const e of (cs && Array.isArray(cs.edges)) ? cs.edges : []) {
        const a = map.get(String(e.from)), b = map.get(String(e.to));
        if (!a || !b || a === b) continue;
        const g = e.expr ? Q.ZERO : num(e.weight, 'a transition weight');
        if (Q.isZero(g) && !e.expr) continue;
        ce.push({ from: a, to: b, g, bend: e.bend == null ? null : +e.bend, expr: e.expr ? normaliseExpr(e.expr) : undefined });
      }
      return { w, wexpr, edges: ce };
    });
    const c = comps.map((_, k) => num(Array.isArray(o.ent.c) && o.ent.c[k] != null ? o.ent.c[k] : 0, 'a component weight c'));
    const cexpr = Array.isArray(o.ent.cexpr) ? comps.map((_, k) => (o.ent.cexpr[k] ? normaliseExpr(o.ent.cexpr[k]) : undefined)) : [];
    Gout.ent = { c, cexpr, active: 0, comps };
    const active = Math.max(0, Math.min(comps.length - 1, (+o.ent.active) | 0));
    entLoad(Gout, active, true);
  }
  evaluateGraph(Gout);
  Gout.edges = Gout.edges.filter(e => e.expr || !Q.isZero(e.g));
  if (Gout.ent) entSync(Gout);
  if (!Gout.ent && o.optimisation) { const opt = readOptimisationBlock(o.optimisation, Gout.nodes.length); if (opt) { opt.share = !!(o.optimisation && o.optimisation.share); if (!opt.graphKey) opt.graphKey = graphKey(Gout); Gout.opt = opt; } }
  return { G: Gout, maxId: keepIds ? maxId : next - 1 };
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
/* Compact form so links stay short: g1 + base64url(JSON) uses only link-safe characters */
function encodeShare(G) {
  const idx = new Map(G.nodes.map((n, i) => [n.id, i]));
  const c = {
    a: G.alpha,
    n: G.nodes.map(n => { const r = [n.label, Q.exact(n.w), Math.round(n.x), Math.round(n.y), n.p || '', n.color ? n.color.slice(1) : '']; if (n.desc || n.group) r.push(n.desc || '', n.group || ''); while (r.length > 5 && r[r.length - 1] === '') r.pop(); return r; }),
    e: G.edges.map(e => [idx.get(e.from), idx.get(e.to), Q.exact(e.g), e.bend == null ? null : Math.round(e.bend)])
  };
  if (G.nodes.some(n => n.wexpr) || G.edges.some(e => e.expr)) {
    c.x = { n: G.nodes.map(n => n.wexpr || ''), e: G.edges.map(e => e.expr || ''), v: Object.fromEntries(Object.entries(G.vars || {}).map(([k, v]) => [k, Q.exact(v)])) };
  }
  const t = serializeTest(G.test);
  if (t) c.t = { type: t.type, upscale: t.upscale, corr: Object.fromEntries(Object.entries(t.corr).map(([k, v]) => [k.split('|').map(id => idx.get(id)).join('|'), v])) };
  if (G.sided === 'two') c.s = 2;
  if (G.opt && G.opt.share && !isEntangled(G)) c.o = writeOptimisationBlock(G.opt);
  if (isEntangled(G)) {
    /* Entangled components: c (component weights), a (active), k (per component: w, e and optional expressions) */
    const o = serializeGraph(G);
    c.E = {
      c: o.ent.c, a: o.ent.active,
      k: o.ent.comps.map(cs => {
        const r = { w: cs.nodes.map(n => n.weight), e: cs.edges.map(e => [idx.get(e.from), idx.get(e.to), e.weight, e.bend == null ? null : Math.round(e.bend)]) };
        if (cs.nodes.some(n => n.wexpr) || cs.edges.some(e => e.expr)) r.x = { n: cs.nodes.map(n => n.wexpr || ''), e: cs.edges.map(e => e.expr || '') };
        return r;
      })
    };
    if (o.ent.cexpr) c.E.cx = o.ent.cexpr.map(x => x || '');
    if (!c.x && Object.keys(G.vars || {}).length) c.x = { n: G.nodes.map(() => ''), e: G.edges.map(() => ''), v: Object.fromEntries(Object.entries(G.vars).map(([k, v]) => [k, Q.exact(v)])) };
  }
  return 'g1' + b64urlEncode(JSON.stringify(c));
}
function decodeShare(token) {
  if (!/^g1[A-Za-z0-9_-]+$/.test(token)) throw new Error('Not a graph link.');
  let c;
  try { c = JSON.parse(b64urlDecode(token.slice(2))); } catch (e) { throw new Error('This link or share code is damaged: it does not decode to a graph.'); }
  if (!c || typeof c !== 'object' || !Array.isArray(c.n) || !Array.isArray(c.e) || c.n.some(r => !Array.isArray(r)) || c.e.some(r => !Array.isArray(r))) throw new Error('This link or share code is damaged: it does not decode to a graph.');
  const out = {
    format: 'multiplicity-graph', alpha: c.a, test: c.t, sided: c.s === 2 ? 'two' : 'one',
    nodes: c.n.map((r, i) => ({ id: String(i), label: r[0], weight: r[1], x: r[2], y: r[3], p: r[4], color: r[5] ? '#' + r[5] : '', desc: r[6] || '', group: r[7] || '', wexpr: c.x && c.x.n[i] ? c.x.n[i] : undefined })),
    edges: c.e.map((r, k) => ({ from: String(r[0]), to: String(r[1]), weight: r[2], bend: r[3], expr: c.x && c.x.e[k] ? c.x.e[k] : undefined })),
    vars: c.x ? c.x.v : undefined,
    optimisation: c.o && typeof c.o === 'object' ? c.o : undefined
  };
  if (c.E && typeof c.E === 'object' && Array.isArray(c.E.k) && c.E.k.length) {
    out.version = 2;
    out.ent = {
      c: Array.isArray(c.E.c) ? c.E.c : [], cexpr: Array.isArray(c.E.cx) ? c.E.cx.map(x => x || undefined) : undefined, active: c.E.a | 0,
      comps: c.E.k.map(r => ({
        nodes: (Array.isArray(r.w) ? r.w : []).map((w, i) => ({ id: String(i), weight: w, wexpr: r.x && r.x.n[i] ? r.x.n[i] : undefined })),
        edges: (Array.isArray(r.e) ? r.e : []).map((e, k) => ({ from: String(e[0]), to: String(e[1]), weight: e[2], bend: e[3], expr: r.x && r.x.e[k] ? r.x.e[k] : undefined }))
      }))
    };
  }
  return out;
}

/* ---------- Templates ---------- */
const TEMPLATES = {
  holm: {
    name: 'Bonferroni-Holm (3 hypotheses)',
    note: 'Bonferroni-Holm with three hypotheses: equal weights of 1/3, and each hypothesis passes its level equally to the other two.',
    nodes: [['H1', '1/3', 0, 0], ['H2', '1/3', 260, 0], ['H3', '1/3', 130, 210]],
    edges: [[0, 1, '1/2'], [0, 2, '1/2'], [1, 0, '1/2'], [1, 2, '1/2'], [2, 0, '1/2'], [2, 1, '1/2']]
  },
  fixed: {
    name: 'Fixed sequence (3 hypotheses)',
    note: 'Fixed-sequence (hierarchical) testing (Maurer, Hothorn and Lehmacher, 1995; Westfall and Krishen, 2001; graph as in Bretz et al., 2009, Fig. 6): H1 gets all of alpha, and each later hypothesis is tested only after the one before it is rejected. The order is the whole design: a hypothesis placed after one that fails can never be tested, whatever its p-value. Choose the order from clinical priority and expected effect sizes, and check it by simulation in the Power tab. With poor estimates of the effects a Holm graph is often safer (Zhang, Wang and Troendle, 2015, section 4; Paux and Dmitrienko, 2018, section 4.2).',
    nodes: [['H1', '1', 0, 0], ['H2', '0', 220, 0], ['H3', '0', 440, 0]],
    edges: [[0, 1, '1'], [1, 2, '1']]
  },
  fallback: {
    name: 'Fallback (3 hypotheses)',
    note: 'Fallback procedure (Wiens, 2003, who called it the fixed sequence Bonferroni procedure; named and proved for any number of hypotheses by Wiens and Dmitrienko, 2005; graph as in Bretz et al., 2009, section 2.3): alpha is split across the hypotheses up front, and a rejected hypothesis passes its level to the next one in the sequence. The level of the last hypothesis is lost if it is rejected while earlier ones are still open; see the improved fallback templates.',
    nodes: [['H1', '1/3', 0, 0], ['H2', '1/3', 220, 0], ['H3', '1/3', 440, 0]],
    edges: [[0, 1, '1'], [1, 2, '1']]
  },
  parallel: {
    name: 'Two primary + two secondary (parallel gatekeeping)',
    note: 'Parallel gatekeeping (Dmitrienko, Offen and Westfall, 2003, Table I; drawn as in Bretz et al., 2009, Fig. 2; gMCP: parallelGatekeeping): H1 and H2 are the primary family, H3 and H4 the secondary family. The secondary hypotheses get weight only once a primary hypothesis is rejected. Not alpha-exhaustive: see the improved version with ε edges. Published power comparisons labelled "Bonferroni gatekeeping" often use that ε-improved version (Bretz et al., 2009, Fig. 12), which is the improved parallel gatekeeping template here, so their numbers can differ from this graph\'s.',
    nodes: [['H1', '1/2', 0, 0], ['H2', '1/2', 280, 0], ['H3', '0', 0, 210], ['H4', '0', 280, 210]],
    edges: [[0, 2, '1/2'], [0, 3, '1/2'], [1, 2, '1/2'], [1, 3, '1/2'], [2, 3, '1'], [3, 2, '1']]
  },
  bretz: {
    name: 'Two doses, two endpoints (Maurer et al., 2011, simple successive II)',
    note: 'Two doses compared with control on a primary and a secondary endpoint. H1, H2: dose 1 and dose 2 on the primary endpoint. H3, H4: the same doses on the secondary endpoint. Each secondary hypothesis is tested only after its own dose succeeds on the primary endpoint. Figure 2(b) of Maurer, Glimm and Bretz (2011), also Figure 6 of Bretz, Maurer and Hommel (2011) with γ₁ = γ₂ = 1/2 (gMCP: simpleSuccessiveII).',
    nodes: [['H1', '1/2', 0, 0], ['H2', '1/2', 280, 0], ['H3', '0', 0, 210], ['H4', '0', 280, 210]],
    edges: [[0, 1, '1/2'], [0, 2, '1/2'], [1, 0, '1/2'], [1, 3, '1/2'], [2, 1, '1'], [3, 0, '1']]
  },
  bretzFig14Left: {
    name: 'Two doses, three endpoints: each dose in sequence (Bretz et al., 2009, Fig. 14 left)',
    note: 'Two doses compared with control on three ordered endpoints (Bretz et al., 2009, Fig. 14 left, p. 600, their multiple sclerosis example). H11, H12, H13: dose 1 on endpoints 1, 2 and 3; H21, H22, H23: dose 2 on the same endpoints. Each dose starts with alpha/2 on its first endpoint and the three endpoints are tested in a fixed sequence within the dose; when a dose\'s last hypothesis is rejected, its level passes to the first hypothesis of the other dose. Alpha-exhaustive. The same graph is Fig. 4 of Minini, Paux and Dmitrienko (2026); Li and Zhou (2021, Fig. 7) work both Fig. 14 graphs through with p-values, and Guilbaud and Karlsson (2011, Example 2) show that this one is the default graph of the two sequences 123456 and 456123 with weight 1/2 each.',
    nodes: [['H11', '1/2', 0, 0], ['H12', '0', 260, 0], ['H13', '0', 520, 0], ['H21', '1/2', 520, 230], ['H22', '0', 260, 230], ['H23', '0', 0, 230]],
    edges: [[0, 1, '1'], [1, 2, '1'], [2, 3, '1'], [3, 4, '1'], [4, 5, '1'], [5, 0, '1']]
  },
  bretzFig14Right: {
    name: 'Two doses, three endpoints: shared between doses (Bretz et al., 2009, Fig. 14 right)',
    note: 'Two doses compared with control on three ordered endpoints (Bretz et al., 2009, Fig. 14 right, p. 600, their multiple sclerosis example). H11, H12, H13: dose 1 on endpoints 1, 2 and 3; H21, H22, H23: dose 2 on the same endpoints. Each dose starts with alpha/2 on its first endpoint. A rejected hypothesis passes half its level to the next endpoint of its own dose and half to the first open hypothesis of the other dose (H11 and H12 to H21; H21 and H22 to H11); a dose\'s last hypothesis passes everything to the other dose. Alpha-exhaustive. The same graph is Fig. 5 of Minini, Paux and Dmitrienko (2026); Li and Zhou (2021, Fig. 7) work both Fig. 14 graphs through with p-values. It is close to, but not the same as, the six-sequence default graph of Guilbaud and Karlsson (2011, Example 2): four of the 63 intersections differ.',
    nodes: [['H11', '1/2', 0, 0], ['H12', '0', 260, 0], ['H13', '0', 520, 0], ['H21', '1/2', 520, 230], ['H22', '0', 260, 230], ['H23', '0', 0, 230]],
    edges: [[0, 1, '1/2'], [0, 3, '1/2'], [1, 2, '1/2'], [1, 3, '1/2'], [2, 3, '1'], [3, 0, '1/2'], [3, 4, '1/2'], [4, 5, '1/2'], [4, 0, '1/2'], [5, 0, '1']]
  }
};
Object.assign(TEMPLATES, {
  improvedParallel: {
    name: 'Improved parallel gatekeeping (Bretz et al., 2009, Fig. 12)',
    note: 'Improved parallel gatekeeping with ε edges (Bretz et al., 2009, Fig. 12; the improvement itself is from Hommel, Bretz and Maurer, 2007, and Guilbaud, 2007): as parallel gatekeeping, but a rejected secondary hypothesis passes a small share ε back to the primary family, so a primary hypothesis can still be rejected once both secondaries are (gMCP: improvedParallelGatekeeping).',
    nodes: [['H1', '1/2', 0, 0], ['H2', '1/2', 280, 0], ['H3', '0', 0, 210], ['H4', '0', 280, 210]],
    edges: [[0, 2, '1/2'], [0, 3, '1/2'], [1, 2, '1/2'], [1, 3, '1/2'], [2, 3, '1-ε'], [2, 0, 'ε'], [3, 2, '1-ε'], [3, 1, 'ε']], groups: ['primary', 'primary', 'secondary', 'secondary']
  },
  bretz2011: {
    name: 'Bretz, Maurer and Hommel (2011): three doses, two endpoints',
    note: 'Three doses on a primary endpoint (H11, H21, H31, weights 1/3) and a secondary endpoint (H12, H22, H32). Figure 2 of Bretz, Maurer and Hommel (2011), Statistics in Medicine 30:1489-1501; gMCP: BretzEtAl2011. Their section 3.3 works through p = 0.1, 0.008, 0.005, 0.15, 0.04, 0.006 at one-sided α = 0.025 and rejects H31, H21 and H32.',
    nodes: [['H11', '1/3', 0, 0], ['H21', '1/3', 260, 0], ['H31', '1/3', 520, 0], ['H12', '0', 0, 220], ['H22', '0', 260, 220], ['H32', '0', 520, 220]],
    edges: [[0, 1, '1/2'], [0, 3, '1/2'], [1, 0, '1/3'], [1, 2, '1/3'], [1, 4, '1/3'], [2, 1, '1/2'], [2, 5, '1/2'], [3, 1, '1'], [4, 0, '1/2'], [4, 2, '1/2'], [5, 1, '1']], groups: ['primary', 'primary', 'primary', 'secondary', 'secondary', 'secondary']
  },
  successive: {
    name: 'General successive (Maurer et al., 2011)',
    note: 'Two doses and two hierarchical endpoints with free parameters γ and δ (written γ₁ and γ₂ in Maurer, Glimm and Bretz, 2011, Fig. 5, and in Bretz, Maurer and Hommel, 2011, Fig. 6; gMCP uses gamma and delta): H1 passes γ to H2 and 1−γ to its own secondary H3; H2 passes δ to H1 and 1−δ to H4. γ = δ = 1/2 gives the two doses, two endpoints template (simple successive II); γ = δ = 0 gives simple successive I (gMCP: generalSuccessive).',
    nodes: [['H1', '1/2', 0, 0], ['H2', '1/2', 280, 0], ['H3', '0', 0, 210], ['H4', '0', 280, 210]],
    edges: [[0, 1, 'γ'], [0, 2, '1-γ'], [1, 0, 'δ'], [1, 3, '1-δ'], [2, 1, '1'], [3, 0, '1']], groups: ['primary', 'primary', 'secondary', 'secondary']
  },
  successiveI: {
    name: 'Simple successive I (Maurer et al., 2011)',
    note: 'Each primary hypothesis passes everything to its own secondary; a rejected secondary passes everything to the other primary (Maurer, Glimm and Bretz, 2011, Fig. 2(a); the same graph is Example 1 of Bretz et al., 2011; gMCP: simpleSuccessiveI).',
    nodes: [['H1', '1/2', 0, 0], ['H2', '1/2', 280, 0], ['H3', '0', 0, 210], ['H4', '0', 280, 210]],
    edges: [[0, 2, '1'], [1, 3, '1'], [2, 1, '1'], [3, 0, '1']], groups: ['primary', 'primary', 'secondary', 'secondary']
  },
  improvedFallbackI: {
    name: 'Improved fallback I (Wiens and Dmitrienko, 2005)',
    note: 'Alpha-exhaustive fallback (Wiens and Dmitrienko, 2005, section 3.2; Bretz et al., 2009, Fig. 7): the level of the last hypothesis is returned to the earlier ones in proportion to their initial weights (r = α₂/(α₁ + α₂) to H2 and 1 − r to H1, so 1/2 each here), so no alpha is lost. The two return transitions are stored as 1/2 and do not follow the weights: if you change the weights, re-enter them as w₁/(w₁ + w₂) and w₂/(w₁ + w₂), or choose "Improved fallback I for any m" in the template picker, which works them out from the weights you type (gMCP: improvedFallbackI, which also keeps 1/2, 1/2; graphicalMCP: fallback_improved_1, which works them out). Any split 0 ≤ r ≤ 1 keeps the procedure valid (Huque, Dmitrienko and D\'Agostino, 2013, Fig. 4); this r is the choice of Wiens and Dmitrienko (2005).',
    nodes: [['H1', '1/3', 0, 0], ['H2', '1/3', 220, 0], ['H3', '1/3', 440, 0]],
    edges: [[0, 1, '1'], [1, 2, '1'], [2, 0, '1/2', -60], [2, 1, '1/2']]
  },
  efficacySafety: {
    name: 'Efficacy and safety for three treatments (Bretz et al., 2009, Fig. 8)',
    note: 'Three treatments, each with an efficacy hypothesis and a safety hypothesis (Bretz et al., 2009, Fig. 8, p. 594). HE1, HE2, HE3 (efficacy) share alpha equally; HS1, HS2, HS3 (safety) start at 0. A treatment\'s safety hypothesis is tested only once its efficacy hypothesis is rejected, which passes it the whole level; a rejected safety hypothesis passes its level equally to the efficacy hypotheses of the other two treatments. Alpha-exhaustive. The paper gives the graph only, with no worked numbers. Koenig et al. (2025, Fig. 5, p. 10, and Table 7, p. 11) use the same graph for a primary and a secondary endpoint with three doses against placebo.',
    nodes: [['HE1', '1/3', 0, 0], ['HE2', '1/3', 260, 0], ['HE3', '1/3', 520, 0], ['HS1', '0', 0, 230], ['HS2', '0', 260, 230], ['HS3', '0', 520, 230]],
    edges: [[0, 3, '1'], [1, 4, '1'], [2, 5, '1'], [3, 1, '1/2'], [3, 2, '1/2'], [4, 0, '1/2'], [4, 2, '1/2'], [5, 0, '1/2'], [5, 1, '1/2']], groups: ['efficacy', 'efficacy', 'efficacy', 'safety', 'safety', 'safety']
  },
  hungWang: {
    name: 'Hung and Wang (2010): non-inferiority then superiority, two endpoints',
    note: 'Non-inferiority and superiority on a primary and a secondary endpoint (Hung and Wang, 2010, Biometrical Journal 52:747-756, Fig. 1, p. 751; section 7, p. 754). H1,NI (non-inferiority on the primary endpoint) holds all of alpha. When it is rejected, a share ν goes to superiority on the primary endpoint (H1,S) and 1−ν to non-inferiority on the secondary endpoint (H2,NI). H1,S passes τ to H2,S and 1−τ to H2,NI; H2,NI passes ω to H1,S and 1−ω to H2,S. H2,S (superiority on the secondary endpoint) passes nothing on, so the graph is not alpha-exhaustive and validation shows that one warning. The paper warns (p. 754) that τ = ω = 1 lets H2,S be tested without H2,NI having been rejected, and then H2,S can never be tested unless H1,S is. More generally, H2,S can be rejected without H2,NI whenever ν > 0 and τ > 0 (Guilbaud, 2011, Biometrical Journal 53:927-937, p. 930). The defaults here are ν = τ = ω = 1/2. gMCP\'s HungEtWang2010(nu, tau, omega) has the same nodes in the same order but puts its tau on the H1,S → H2,NI edge, the other way round from the figure, so this graph is HungEtWang2010(nu = ν, tau = 1 − τ, omega = ω); the gMCP export writes the matrix in full.',
    nodes: [['H1,NI', '1', 0, 0], ['H1,S', '0', 300, 0], ['H2,NI', '0', 0, 220], ['H2,S', '0', 300, 220]],
    edges: [[0, 1, 'ν'], [0, 2, '1-ν'], [1, 3, 'τ'], [1, 2, '1-τ'], [2, 1, 'ω'], [2, 3, '1-ω']]
  },
  improvedFallbackII: {
    name: 'Improved fallback II (Bretz et al., 2009, Fig. 11)',
    note: 'Fallback that returns a rejected level to the first hypothesis still open in the hierarchy (Bretz et al., 2009, Fig. 11, answering the criticism in Hommel and Bretz, 2008): H2 passes 1 − ε back to H1 and only ε onward to H3, so H3 receives H2\'s level only once H1 is rejected; H3 returns everything to H1 (gMCP: improvedFallbackII; graphicalMCP: fallback_improved_2).',
    nodes: [['H1', '1/3', 0, 0], ['H2', '1/3', 220, 0], ['H3', '1/3', 440, 0]],
    edges: [[0, 1, '1'], [1, 0, '1-ε'], [1, 2, 'ε'], [2, 0, '1', -60]]
  }
});
function templateJSON(key) {
  const t = TEMPLATES[key];
  return {
    format: 'multiplicity-graph', alpha: 0.025, note: t.note,
    nodes: t.nodes.map((r, i) => ({ id: String(i), label: r[0], weight: isExpr(r[1]) ? '0' : r[1], wexpr: isExpr(r[1]) ? r[1] : undefined, x: r[2], y: r[3], p: '', group: t.groups ? t.groups[i] : '' })),
    edges: t.edges.map(r => ({ from: String(r[0]), to: String(r[1]), weight: isExpr(r[2]) ? '0' : r[2], expr: isExpr(r[2]) ? r[2] : undefined, bend: r[3] == null ? null : r[3] }))
  };
}
/* Cycle graph (gMCP: cycleGraph): node i passes everything to node i + 1, the last to the first */
function cycleTemplate(m) {
  const pos = circlePositions(m);
  return {
    format: 'multiplicity-graph', alpha: 0.025, note: `Cycle graph with ${m} hypotheses: equal weights, and each hypothesis passes its whole level to the next one round the circle (gMCP: cycleGraph).`,
    nodes: pos.map((p, i) => ({ id: String(i), label: 'H' + (i + 1), weight: `1/${m}`, x: p.x, y: p.y, p: '' })),
    edges: Array.from({ length: m }, (_, i) => ({ from: String(i), to: String((i + 1) % m), weight: '1', bend: null }))
  };
}
/* Truncated Holm (gMCP: truncatedHolm): Holm on H1, H2 with a share 1 - gamma passed to the secondary pair */
function truncatedHolmTemplate() {
  return {
    format: 'multiplicity-graph', alpha: 0.025, note: 'Truncated Holm (Dmitrienko, Tamhane and Wiens, 2008, eq. 6; Bretz et al., 2011, section 4.1; gMCP: truncatedHolm): the primary pair is tested with a truncated Holm procedure that keeps a share γ within the pair and passes 1−γ to the secondary pair, which is then tested with Holm at (1−γ)α/2 or at α. γ = 0 is Bonferroni on the primaries. Dmitrienko et al. define it for γ < 1: at γ = 1 the two primaries exchange their whole level and the secondaries can never be tested, so use γ = 1−ε for Holm on the primaries. A single graph represents truncated Holm for two primary hypotheses only; more need entangled graphs (Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753).',
    nodes: [{ id: '0', label: 'H1', weight: '1/2', x: 0, y: 0, p: '', group: 'primary' }, { id: '1', label: 'H2', weight: '1/2', x: 280, y: 0, p: '', group: 'primary' }, { id: '2', label: 'H3', weight: '0', x: 0, y: 210, p: '', group: 'secondary' }, { id: '3', label: 'H4', weight: '0', x: 280, y: 210, p: '', group: 'secondary' }],
    edges: [{ from: '0', to: '1', weight: '0', expr: 'γ' }, { from: '0', to: '2', weight: '0', expr: '(1-γ)/2' }, { from: '0', to: '3', weight: '0', expr: '(1-γ)/2' }, { from: '1', to: '0', weight: '0', expr: 'γ' }, { from: '1', to: '2', weight: '0', expr: '(1-γ)/2' }, { from: '1', to: '3', weight: '0', expr: '(1-γ)/2' }, { from: '2', to: '3', weight: '1' }, { from: '3', to: '2', weight: '1' }]
  };
}
/* joinGraphs: appends graph B below graph A; renames clashing labels; rescales weights if they sum to more than 1 */
function joinGraphs(A, B) {
  const a = serializeGraph(A), b = serializeGraph(B);
  const ay = a.nodes.length ? Math.max(...a.nodes.map(n => n.y)) : 0, by = b.nodes.length ? Math.min(...b.nodes.map(n => n.y)) : 0;
  const ax = a.nodes.length ? Math.min(...a.nodes.map(n => n.x)) : 0, bx = b.nodes.length ? Math.min(...b.nodes.map(n => n.x)) : 0;
  const labels = new Set(a.nodes.map(n => n.label));
  const idMap = new Map();
  b.nodes.forEach((n, i) => { const id = 'b' + i; idMap.set(n.id, id); n.id = id; n.y = n.y - by + ay + 230; n.x = n.x - bx + ax; while (labels.has(n.label)) n.label += "'"; labels.add(n.label); });
  b.edges.forEach(e => { e.from = idMap.get(e.from); e.to = idMap.get(e.to); });
  const out = { format: 'multiplicity-graph', alpha: a.alpha, note: [a.note, b.note].filter(Boolean).join(' Joined with: '), nodes: a.nodes.concat(b.nodes), edges: a.edges.concat(b.edges), diag: [], vars: Object.assign({}, b.vars || {}, a.vars || {}) };
  const tot = out.nodes.reduce((s, n) => Q.add(s, Q.parse(n.weight) || Q.ZERO), Q.ZERO);
  if (Q.cmp(tot, Q.ONE) > 0) out.nodes.forEach(n => { if (!n.wexpr) n.weight = Q.exact(Q.div(Q.parse(n.weight), tot)); });
  return out;
}
/* subgraph: keeps only the given node ids, with their weights and the transitions among them */
function subgraphOf(G, keep) {
  const o = serializeGraph(G), set = new Set(keep);
  o.nodes = o.nodes.filter(n => set.has(n.id));
  o.edges = o.edges.filter(e => set.has(e.from) && set.has(e.to));
  o.diag = (o.diag || []).filter(d => set.has(d.id));
  return o;
}

/* ---------- Built-in self-test ---------- */
function runSelfTest() {
  const res = [];
  const check = (name, fn) => {
    try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); }
    catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); }
  };
  const q = s => Q.parse(s);
  const st = (ws, edges) => ({
    ids: ws.map((_, i) => 'h' + i),
    w: new Map(ws.map((w, i) => ['h' + i, q(w)])),
    g: new Map(edges.map(([a, b, v]) => [gKey('h' + a, 'h' + b), q(v)]))
  });
  const pFrom = arr => id => arr[+id.slice(1)];
  const holmGraph = m => {
    const e = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) e.push([i, j, `1/${m - 1}`]);
    return st(Array(m).fill(`1/${m}`), e);
  };
  const holmDirect = (p, alpha) => {
    const ord = p.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const rej = new Set();
    for (let k = 0; k < ord.length; k++) { if (ord[k][0] <= alpha / (ord.length - k)) rej.add(ord[k][1]); else break; }
    return rej;
  };
  const setOf = order => new Set(order.map(id => +id.slice(1)));
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

  check('Fractions parse and reduce (0.25, 1/3, 2/6, 1e-3)', () =>
    Q.exact(q('0.25')) === '1/4' && Q.exact(q('1/3')) === '1/3' && Q.exact(q('2/6')) === '1/3' && Q.exact(q('1e-3')) === '1/1000' && q('abc') === null || 'parse mismatch');
  check('Exact arithmetic: 1/3 + 1/6 = 1/2', () => Q.exact(Q.add(q('1/3'), q('1/6'))) === '1/2' || 'got ' + Q.exact(Q.add(q('1/3'), q('1/6'))));

  check('Holm (3): weights after rejecting H1 are 1/2, 1/2', () => {
    const s2 = rejectNode(holmGraph(3), 'h0');
    return (Q.exact(s2.w.get('h1')) === '1/2' && Q.exact(s2.w.get('h2')) === '1/2') || `got ${Q.exact(s2.w.get('h1'))}, ${Q.exact(s2.w.get('h2'))}`;
  });
  check('Holm (3): transitions after rejecting H1 are g23 = g32 = 1', () => {
    const s2 = rejectNode(holmGraph(3), 'h0');
    return (Q.exact(getg(s2, 'h1', 'h2')) === '1' && Q.exact(getg(s2, 'h2', 'h1')) === '1') || 'unexpected transitions';
  });
  check('Holm (3), alpha 0.05, p = (0.01, 0.04, 0.03): rejects H1 only', () => {
    const r = runProcedure(holmGraph(3), pFrom([0.01, 0.04, 0.03]), 0.05);
    return (r.order.length === 1 && r.order[0] === 'h0') || 'rejected ' + r.order.join(', ');
  });
  check('Holm (3), alpha 0.05, p = (0.01, 0.02, 0.04): rejects all three', () => {
    const r = runProcedure(holmGraph(3), pFrom([0.01, 0.02, 0.04]), 0.05);
    return r.order.length === 3 || 'rejected ' + r.order.length;
  });
  check('Holm boundary: p exactly equal to the local level is rejected', () => {
    const r = runProcedure(holmGraph(2), pFrom([0.0125, 0.9]), 0.025);
    return (r.order.length === 1 && r.order[0] === 'h0') || 'rejected ' + r.order.join(', ');
  });
  check('Graph matches direct Holm on 500 random p-value sets (m = 2 to 6)', () => {
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 500; k++) {
      const m = 2 + (k % 5), alpha = [0.025, 0.05, 0.1][k % 3];
      const p = Array.from({ length: m }, () => rnd() * rnd() * 0.12);
      const r = runProcedure(holmGraph(m), pFrom(p), alpha);
      if (!same(setOf(r.order), holmDirect(p, alpha))) return `mismatch at m = ${m}, p = ${p.map(x => x.toFixed(4)).join(', ')}`;
    }
    return true;
  });
  const fixed = () => st(['1', '0', '0'], [[0, 1, '1'], [1, 2, '1']]);
  check('Fixed sequence, p = (0.01, 0.03, 0.001), alpha 0.025: rejects H1 only', () => {
    const r = runProcedure(fixed(), pFrom([0.01, 0.03, 0.001]), 0.025);
    return (r.order.join() === 'h0') || 'rejected ' + r.order.join(', ');
  });
  check('Fixed sequence, p = (0.02, 0.01, 0.024), alpha 0.025: rejects all, in order', () => {
    const r = runProcedure(fixed(), pFrom([0.02, 0.01, 0.024]), 0.025);
    return (r.order.join() === 'h0,h1,h2') || 'order ' + r.order.join(', ');
  });
  check('Fixed sequence: H1 not rejected blocks everything after it', () => {
    const r = runProcedure(fixed(), pFrom([0.03, 0.0001, 0.0001]), 0.025);
    return r.order.length === 0 || 'rejected ' + r.order.join(', ');
  });
  check('Fixed sequence: weight moves fully to H2 after rejecting H1', () => {
    const s2 = rejectNode(fixed(), 'h0');
    return (Q.exact(s2.w.get('h1')) === '1' && Q.exact(s2.w.get('h2')) === '0' && Q.exact(getg(s2, 'h1', 'h2')) === '1') || 'unexpected update';
  });
  check('Two doses, two endpoints: update after rejecting H1 matches hand calculation', () => {
    const s = st(['1/2', '1/2', '0', '0'], [[0, 1, '1/2'], [0, 2, '1/2'], [1, 0, '1/2'], [1, 3, '1/2'], [2, 1, '1'], [3, 0, '1']]);
    const s2 = rejectNode(s, 'h0');
    const got = [Q.exact(s2.w.get('h1')), Q.exact(s2.w.get('h2')), Q.exact(getg(s2, 'h1', 'h2')), Q.exact(getg(s2, 'h1', 'h3')), Q.exact(getg(s2, 'h3', 'h1')), Q.exact(getg(s2, 'h3', 'h2')), Q.exact(getg(s2, 'h2', 'h1'))].join(' ');
    return got === '3/4 1/4 1/3 2/3 1/2 1/2 1' || 'got ' + got;
  });
  check('Rejected set does not depend on rejection order (300 random graphs)', () => {
    let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 300; k++) {
      const m = 2 + (k % 4);
      const w = Array.from({ length: m }, () => Math.floor(rnd() * 4));
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      const edges = [];
      for (let i = 0; i < m; i++) {
        const raw = Array.from({ length: m }, (_, j) => (i === j ? 0 : Math.floor(rnd() * 3)));
        const rs = raw.reduce((a, b) => a + b, 0);
        raw.forEach((v, j) => { if (v) edges.push([i, j, `${v}/${rs}`]); });
      }
      const s = st(w.map(v => `${v}/${tot}`), edges);
      const p = Array.from({ length: m }, () => rnd() * 0.06);
      const first = (s0, pOf, a) => { for (const id of s0.ids) { const lv = Q.toNum(s0.w.get(id)) * a; if (pOf(id) <= lv) return { id }; } return null; };
      const last = (s0, pOf, a) => { for (const id of s0.ids.slice().reverse()) { const lv = Q.toNum(s0.w.get(id)) * a; if (pOf(id) <= lv) return { id }; } return null; };
      const A = setOf(runProcedure(s, pFrom(p), 0.05, first).order), B = setOf(runProcedure(s, pFrom(p), 0.05, last).order);
      if (!same(A, B)) return `order changed the result for graph ${k}`;
    }
    return true;
  });
  check('Updated graphs stay valid (weights sum and row sums at most 1)', () => {
    let s = holmGraph(4);
    for (const j of ['h2', 'h0']) {
      s = rejectNode(s, j);
      let tot = Q.ZERO; for (const id of s.ids) tot = Q.add(tot, s.w.get(id));
      if (Q.cmp(tot, Q.ONE) > 0) return 'weights exceed 1';
      for (const a of s.ids) { let r = Q.ZERO; for (const b of s.ids) r = Q.add(r, getg(s, a, b)); if (Q.cmp(r, Q.ONE) > 0) return 'row exceeds 1'; }
    }
    return true;
  });
  check('R import: matrix(c(...), nrow = 2, byrow = TRUE) and column-major default', () => {
    const a = parseMatrix('matrix(c(0, 1, 1/2, 0), nrow = 2, byrow = TRUE)', 2).rows;
    const b = parseMatrix('matrix(c(0, 1, 1/2, 0), nrow = 2)', 2).rows;
    return (Q.exact(a[0][1]) === '1' && Q.exact(b[0][1]) === '1/2') || 'byrow handling wrong';
  });
  check('Share link round trip keeps weights, transitions and labels', () => {
    const o = templateJSON('bretz');
    const { G } = deserializeGraph(o, false, 1);
    G.alpha = 0.025;
    const back = deserializeGraph(decodeShare(encodeShare(G)), false, 1).G;
    return (JSON.stringify(serializeGraph(back).edges) === JSON.stringify(serializeGraph(G).edges) && back.nodes.map(n => n.label + Q.exact(n.w)).join() === G.nodes.map(n => n.label + Q.exact(n.w)).join()) || 'round trip changed the graph';
  });
  return res;
}

/* ---------- One-click fixes for validation messages ---------- */
function applyFix(G, f) {
  const clamp = q => (Q.cmp(q, Q.ZERO) < 0 ? Q.ZERO : Q.cmp(q, Q.ONE) > 0 ? Q.ONE : q);
  if (f.act === 'normW') {
    let s = Q.ZERO; for (const n of G.nodes) s = Q.add(s, n.w);
    if (Q.isZero(s)) { const eq = Q.make(1n, BigInt(G.nodes.length)); G.nodes.forEach(n => { n.w = eq; }); }
    else G.nodes.forEach(n => { n.w = Q.div(n.w, s); });
  } else if (f.act === 'clampW') {
    const n = G.nodes.find(x => x.id === f.id); if (n) n.w = clamp(n.w);
  } else if (f.act === 'clampE') {
    const e = G.edges.find(x => gKey(x.from, x.to) === f.key);
    if (e) { e.g = clamp(e.g); if (Q.isZero(e.g)) G.edges = G.edges.filter(x => x !== e); }
  } else if (f.act === 'zeroDiag') {
    delete G.diag[f.id];
  } else if (f.act === 'normRows') {
    for (const id of f.ids) {
      const outs = G.edges.filter(e => e.from === id);
      let r = Q.ZERO; for (const e of outs) r = Q.add(r, e.g);
      if (!Q.isZero(r)) outs.forEach(e => { e.g = Q.div(e.g, r); });
    }
  } else if (f.act === 'equalW') {
    const eq = Q.make(1n, BigInt(Math.max(1, G.nodes.length)));
    G.nodes.forEach(n => { n.w = eq; });
  } else if (f.act === 'equalRow') {
    const outs = G.edges.filter(e => e.from === f.id);
    if (outs.length) { const eq = Q.make(1n, BigInt(outs.length)); outs.forEach(e => { e.g = eq; }); }
  }
}

/* ---------- Adjusted p-values (Bretz et al., 2009, Algorithm 2) ---------- */
/* H_j is rejected at level alpha exactly when its adjusted p-value is <= alpha. */
function adjustedPValues(st, pOf) {
  const adj = new Map();
  let prev = 0;
  while (st.ids.length) {
    let best = null, br = Infinity;
    for (const id of st.ids) {
      const w = Q.toNum(st.w.get(id) || Q.ZERO), p = pOf(id);
      const r = w > 0 ? p / w : Infinity;
      if (best === null || r < br) { best = id; br = r; }
    }
    if (!Number.isFinite(br)) { for (const id of st.ids) adj.set(id, 1); break; }
    const q = Math.max(Math.min(br, 1), prev);
    adj.set(best, q); prev = q;
    st = rejectNode(st, best);
  }
  return adj;
}

/* ---------- Power simulation (one-sided z-tests, multivariate normal) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalGen(rand) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * f;
    return u * f;
  };
}
/* Complementary error function, fractional error below 1.2e-7 everywhere (Numerical Recipes) */
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const pnormUpper = z => 0.5 * erfc(z / Math.SQRT2);
/* Standard normal quantile (Acklam's algorithm, relative error about 1e-9) */
function qnorm(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function cholesky(R, m) {
  const L = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = R[i * m + j];
      for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k];
      if (i === j) { if (s <= 1e-10) return null; L[i * m + i] = Math.sqrt(s); }
      else L[i * m + j] = s / L[j * m + j];
    }
  }
  return L;
}
function floatGraph(G) {
  const m = G.nodes.length, idx = new Map(G.nodes.map((n, i) => [n.id, i]));
  const arrays = H => {
    const w = Float64Array.from(H.nodes.map(n => Q.toNum(n.w)));
    const g = new Float64Array(m * m);
    for (const e of H.edges) g[idx.get(e.from) * m + idx.get(e.to)] = Q.toNum(e.g);
    return { w, g };
  };
  if (!isEntangled(G)) return Object.assign({ m }, arrays(G));
  /* Entangled: one array pair per component, the component weights c, and the combined weights sum_h c_h w_h
     (the active component's transitions in g, for display only) */
  const comps = G.ent.comps.map((_, k) => arrays(entViewGraph(G, k))), c = G.ent.c.map(v => Q.toNum(v));
  const w = new Float64Array(m);
  comps.forEach((cs, h) => { for (let i = 0; i < m; i++) w[i] += c[h] * cs.w[i]; });
  return { m, w, g: comps[G.ent.active].g, comps, c };
}
/* Shortcut on float arrays for either kind of graph; out[i] = 1 if H_i is rejected */
function runShortcut(fg, p, alpha, out) {
  if (fg.comps) shortcutFloatEntangled(fg.m, fg.comps, fg.c, p, alpha, out); else shortcutFloat(fg.m, fg.w, fg.g, p, alpha, out);
}
/* Algorithm 1 of Maurer and Bretz (2013, p. 1743) on float arrays: test at sum_h c_h w_hi alpha, then update every
   component separately after each rejection */
function shortcutFloatEntangled(m, comps, c, p, alpha, out) {
  const n = comps.length;
  const w = comps.map(cs => cs.w.slice()), g = comps.map(cs => cs.g.slice());
  const act = new Uint8Array(m).fill(1), lv = new Float64Array(m);
  out.fill(0);
  for (;;) {
    for (let i = 0; i < m; i++) { let s = 0; for (let h = 0; h < n; h++) s += c[h] * w[h][i]; lv[i] = s * alpha; }
    let j = -1;
    for (let i = 0; i < m; i++) if (act[i] && lv[i] > 0 && p[i] <= lv[i] * (1 + 1e-12)) { j = i; break; }
    if (j < 0) return;
    act[j] = 0; out[j] = 1;
    for (let h = 0; h < n; h++) {
      const wj = w[h][j], gh = g[h], gn = new Float64Array(m * m);
      for (let l = 0; l < m; l++) if (act[l]) w[h][l] += wj * gh[j * m + l];
      for (let l = 0; l < m; l++) {
        if (!act[l]) continue;
        const glj = gh[l * m + j], den = 1 - glj * gh[j * m + l];
        for (let k = 0; k < m; k++) {
          if (!act[k] || k === l) continue;
          gn[l * m + k] = den > 1e-12 ? (gh[l * m + k] + glj * gh[j * m + k]) / den : 0;
        }
      }
      g[h] = gn; w[h][j] = 0;
    }
  }
}
/* Fast floating-point version of the shortcut procedure; out[i] = 1 if H_i is rejected */
function shortcutFloat(m, w0, g0, p, alpha, out) {
  let w = w0.slice(), g = g0.slice();
  const act = new Uint8Array(m).fill(1);
  out.fill(0);
  for (;;) {
    let j = -1;
    for (let i = 0; i < m; i++) if (act[i] && w[i] > 0 && p[i] <= w[i] * alpha * (1 + 1e-12)) { j = i; break; }
    if (j < 0) return;
    act[j] = 0; out[j] = 1;
    const wj = w[j], gn = new Float64Array(m * m);
    for (let l = 0; l < m; l++) if (act[l]) w[l] += wj * g[j * m + l];
    for (let l = 0; l < m; l++) {
      if (!act[l]) continue;
      const glj = g[l * m + j], den = 1 - glj * g[j * m + l];
      for (let k = 0; k < m; k++) {
        if (!act[k] || k === l) continue;
        gn[l * m + k] = den > 1e-12 ? (g[l * m + k] + glj * g[j * m + k]) / den : 0;
      }
    }
    g = gn; w[j] = 0;
  }
}
/* Runs n simulations and adds to tallies; success: {idx: [...], rule: 'any'|'all'} or null. If success.gain is a
   compiled gain function (compileGain), its value for each trial is added to tally.gain and its square to tally.gain2. */
function simulateChunk(fg, mean, L, alpha, n, norm, tally, success, tester) {
  const m = fg.m, z = new Float64Array(m), e = new Float64Array(m), p = new Float64Array(m), out = new Uint8Array(m);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < m; i++) e[i] = norm();
    for (let i = 0; i < m; i++) {
      let v = mean[i];
      for (let k = 0; k <= i; k++) v += L[i * m + k] * e[k];
      z[i] = v; p[i] = pnormUpper(v);
    }
    if (tester) tester(p, out); else runShortcut(fg, p, alpha, out);
    let cnt = 0;
    for (let i = 0; i < m; i++) { if (out[i]) { tally.rej[i]++; cnt++; } }
    if (cnt > 0) tally.any++;
    if (cnt === m) tally.all++;
    tally.total += cnt;
    if (success && success.idx && success.idx.length) {
      const ok = success.rule === 'all' ? success.idx.every(i => out[i]) : success.idx.some(i => out[i]);
      if (ok) tally.custom++;
    }
    if (success && success.gain) { const g = success.gain(out); tally.gain = (tally.gain || 0) + g; tally.gain2 = (tally.gain2 || 0) + g * g; }
    tally.n++;
  }
}

/* ---------- Comparing two graphs ---------- */
/* Paired power simulation: the same simulated trials are tested with graph A and graph B (common random
   numbers), so the difference in power is estimated with far less noise than two separate runs. Both graphs
   must list the same hypotheses; mapB[i] gives B's index of A's hypothesis i. tally: n, rejA, rejB, d10 (A rejects,
   B does not), d01 (B rejects, A does not), and the same four counts for "any", "all" and the success rule. */
function simulatePairedChunk(fgA, fgB, mapB, mean, L, alpha, n, norm, tally, success, testerA, testerB) {
  const m = fgA.m, e = new Float64Array(m), p = new Float64Array(m), pB = new Float64Array(m), outA = new Uint8Array(m), outB = new Uint8Array(m);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < m; i++) e[i] = norm();
    for (let i = 0; i < m; i++) {
      let v = mean[i];
      for (let k = 0; k <= i; k++) v += L[i * m + k] * e[k];
      p[i] = pnormUpper(v);
    }
    for (let i = 0; i < m; i++) pB[mapB[i]] = p[i];
    if (testerA) testerA(p, outA); else runShortcut(fgA, p, alpha, outA);
    if (testerB) testerB(pB, outB); else runShortcut(fgB, pB, alpha, outB);
    let cA = 0, cB = 0;
    for (let i = 0; i < m; i++) {
      const a = outA[i], b = outB[mapB[i]];
      if (a) { tally.rejA[i]++; cA++; }
      if (b) { tally.rejB[i]++; cB++; }
      if (a && !b) tally.d10[i]++; else if (b && !a) tally.d01[i]++;
    }
    const pair = (key, a, b) => { if (a) tally[key + 'A']++; if (b) tally[key + 'B']++; if (a && !b) tally[key + '10']++; else if (b && !a) tally[key + '01']++; };
    pair('any', cA > 0, cB > 0);
    pair('all', cA === m, cB === m);
    if (success && success.idx.length) {
      const okA = success.rule === 'all' ? success.idx.every(i => outA[i]) : success.idx.some(i => outA[i]);
      const okB = success.rule === 'all' ? success.idx.every(i => outB[mapB[i]]) : success.idx.some(i => outB[mapB[i]]);
      pair('custom', okA, okB);
    }
    tally.totalA += cA; tally.totalB += cB;
    tally.n++;
  }
}
function newPairedTally(m) {
  const t = { n: 0, rejA: Array(m).fill(0), rejB: Array(m).fill(0), d10: Array(m).fill(0), d01: Array(m).fill(0), totalA: 0, totalB: 0 };
  for (const k of ['any', 'all', 'custom']) { t[k + 'A'] = 0; t[k + 'B'] = 0; t[k + '10'] = 0; t[k + '01'] = 0; }
  return t;
}
/* Difference of two paired proportions, first minus second, with its standard error: d = (n10 - n01) / n,
   Var(d) = (n10 + n01) / n^2 - d^2 / n, where n10 counts trials where only the first rejects and n01 only the second. */
function pairedDiff(n10, n01, n) {
  if (!n) return { d: 0, se: 0 };
  const d = (n10 - n01) / n;
  return { d, se: Math.sqrt(Math.max(0, (n10 + n01) / (n * n) - d * d / n)) };
}
/* Matches the hypotheses of two serialized graphs by label (or by position). Returns
   { pairs: [{label, a: index or null, b: index or null}], same: every hypothesis matched both ways, mapB } */
function matchHypotheses(A, B, by = 'label') {
  const pairs = [];
  if (by === 'position') {
    const m = Math.max(A.nodes.length, B.nodes.length);
    for (let i = 0; i < m; i++) pairs.push({ label: (A.nodes[i] || B.nodes[i]).label, a: i < A.nodes.length ? i : null, b: i < B.nodes.length ? i : null });
  } else {
    const used = new Set();
    A.nodes.forEach((n, i) => { const j = B.nodes.findIndex((x, k) => !used.has(k) && x.label.trim() === n.label.trim()); if (j >= 0) used.add(j); pairs.push({ label: n.label, a: i, b: j >= 0 ? j : null }); });
    B.nodes.forEach((n, j) => { if (!used.has(j)) pairs.push({ label: n.label, a: null, b: j }); });
  }
  const same = pairs.every(p => p.a != null && p.b != null) && A.nodes.length === B.nodes.length;
  const mapB = same ? A.nodes.map((_, i) => pairs.find(p => p.a === i).b) : null;
  return { pairs, same, mapB };
}
/* Transition entries that differ between two serialized graphs, over matched hypotheses. num: Q -> number */
function transitionDiffs(A, B, pairs) {
  const q = s => (s == null ? Q.ZERO : (Q.parse(String(s)) || Q.ZERO));
  const at = (S, i, j) => { if (i == null || j == null) return null; const e = S.edges.find(x => x.from === S.nodes[i].id && x.to === S.nodes[j].id); return e ? q(e.weight) : Q.ZERO; };
  const out = [];
  for (const pf of pairs) for (const pt of pairs) {
    if (pf === pt) continue;
    const a = at(A, pf.a, pt.a), b = at(B, pf.b, pt.b);
    if (a == null || b == null) { if ((a && !Q.isZero(a)) || (b && !Q.isZero(b))) out.push({ from: pf.label, to: pt.label, a, b }); continue; }
    if (!Q.eq(a, b)) out.push({ from: pf.label, to: pt.label, a, b });
  }
  return out;
}

/* ---------- Default graphs: fixed sequences with weights (Burman, Sonesson and Guilbaud, 2009) ---------- */
/* Decomposition of a graph into fixed sequences, Maurer and Bretz (2013), Appendix A, pp. 1752-1753: a single
   graph G(w, G) equals the entangled graph E(c = w; G_h(e_h, G)), one quasi-hierarchical component per hypothesis
   with weight 1 on H_h; after H_h is rejected that component has weights g_hk with the updated transition matrix,
   and the decomposition repeats, so a sequence r = (r1, r2, ...) gets the weight w_r1 × g_r1r2 × g'_r2r3 × ...,
   the transition weights being those of the graph as updated along the sequence. The hypotheses then are tested
   at the sum of the weights of the sequences in which they come first among the unrejected ones (section 5.1,
   p. 1748), which is the default graph of Burman et al. An entangled graph decomposes component by component,
   each sequence weighted by c_h (section 5.2, pp. 1749-1750). A sequence stops early when the hypotheses after
   it would all have weight 0; its weight is then lost at its last hypothesis (the graph is not alpha-exhaustive).
   Returns { m, seqs: [{ order: [ids], c: Q, partial }], total } with the sequences sorted by weight, or null when
   m > maxM (the number of sequences is at most m!). */
function defaultGraphOf(G, maxM = 6) {
  const m = G.nodes.length;
  if (!m || m > maxM) return null;
  const st0 = stateFromGraph(G);
  const parts = st0.ent ? st0.ent.comps.map((cs, h) => ({ c: st0.ent.c[h], st: { ids: st0.ids, w: cs.w, g: cs.g } })) : [{ c: Q.ONE, st: st0 }];
  const acc = new Map();
  const emit = (order, c, partial) => {
    if (Q.isZero(c)) return;
    const key = order.join('>');
    const cur = acc.get(key);
    if (cur) cur.c = Q.add(cur.c, c); else acc.set(key, { order: order.slice(), c, partial });
  };
  const walk = (st, prefix, factor) => {
    let sum = Q.ZERO;
    for (const h of st.ids) {
      const wh = st.w.get(h) || Q.ZERO;
      if (Q.cmp(wh, Q.ZERO) <= 0) continue;
      sum = Q.add(sum, wh);
      const f = Q.mul(factor, wh), order = prefix.concat(h);
      if (st.ids.length === 1) { emit(order, f, false); continue; }
      const unit = new Map(st.ids.map(id => [id, id === h ? Q.ONE : Q.ZERO]));
      walk(rejectNode({ ids: st.ids, w: unit, g: st.g }, h), order, f);
    }
    if (prefix.length && Q.cmp(sum, Q.ONE) < 0) emit(prefix, Q.mul(factor, Q.sub(Q.ONE, sum)), true);
  };
  for (const p of parts) { if (Q.cmp(p.c, Q.ZERO) > 0) walk(p.st, [], p.c); }
  const idx = new Map(G.nodes.map((n, i) => [n.id, i]));
  const seqs = [...acc.values()].sort((a, b) => {
    const d = Q.cmp(b.c, a.c); if (d) return d;
    for (let i = 0; i < Math.min(a.order.length, b.order.length); i++) { const e = idx.get(a.order[i]) - idx.get(b.order[i]); if (e) return e; }
    return a.order.length - b.order.length;
  });
  let total = Q.ZERO; for (const s of seqs) total = Q.add(total, s.c);
  return { m, seqs, total };
}
/* The default graph as an entangled graph of fixed sequences (one component per sequence, c = its weight), keeping
   the labels, positions, colours, groups, descriptions, p-values and settings of G. Symbolic weights become numbers. */
function defaultGraphToEntangled(G, dg) {
  if (!dg || !dg.seqs.length) throw new Error('No sequence has a positive weight, so there is nothing to build.');
  const o = serializeGraph(G);
  const ids = G.nodes.map(n => n.id);
  const comps = dg.seqs.map(s => ({
    nodes: ids.map(id => ({ id, weight: id === s.order[0] ? '1' : '0' })),
    edges: s.order.slice(0, -1).map((id, k) => ({ from: id, to: s.order[k + 1], weight: '1', bend: null }))
  }));
  o.version = 2;
  o.nodes = o.nodes.map((n, i) => Object.assign({}, n, { weight: comps[0].nodes[i].weight, wexpr: undefined }));
  o.edges = comps[0].edges;
  o.vars = undefined; o.diag = [];
  o.ent = { c: dg.seqs.map(s => Q.exact(s.c)), cexpr: undefined, active: 0, comps };
  o.note = (o.note ? o.note + ' ' : '') + `Default graph: ${dg.seqs.length} fixed sequence${dg.seqs.length === 1 ? '' : 's'} with weights, from the decomposition of Maurer and Bretz (2013), Appendix A.`;
  return o;
}
/* Parses a default graph typed as one sequence per line, e.g. "H1 > H3 > H4 > H2 > H5 : 1/2" (also → or -> between
   the hypotheses, and = before the weight). Lines starting with # are ignored. Returns { names, seqs: [{ order:
   [indices], c: string }] }; the weights may be fractions, decimals or expressions such as γ/2. */
function parseDefaultGraph(text) {
  const names = [], seqs = [];
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('Type one sequence per line, such as "H1 > H2 > H3 : 1/2".');
  for (const line of lines) {
    const m = /^(.*?)\s*[:=]\s*([^:=]+)$/.exec(line);
    if (!m) throw new Error(`"${line}": write the weight after a colon, such as "H1 > H2 : 1/2".`);
    const labels = m[1].split(/\s*(?:>|→|->|-->|,)\s*/).map(s => s.trim()).filter(Boolean);
    if (labels.length < 1) throw new Error(`"${line}": no hypotheses before the colon.`);
    const order = labels.map(l => { let i = names.indexOf(l); if (i < 0) { names.push(l); i = names.length - 1; } return i; });
    if (new Set(order).size !== order.length) throw new Error(`"${line}": a hypothesis appears twice in one sequence.`);
    const c = m[2].trim();
    if (!(Q.parse(c) || isExpr(c))) throw new Error(`"${line}": the weight "${c}" is not a number, fraction or expression.`);
    if (Q.parse(c) && (Q.cmp(Q.parse(c), Q.ZERO) < 0 || Q.cmp(Q.parse(c), Q.ONE) > 0)) throw new Error(`"${line}": the weight must be between 0 and 1.`);
    seqs.push({ order, c });
  }
  if (names.length > 30) throw new Error('At most 30 hypotheses.');
  return { names, seqs };
}
/* Builds the version 2 JSON of an entangled graph of fixed sequences from parseDefaultGraph's result */
function defaultGraphJSON(parsed, positions, alpha) {
  const m = parsed.names.length;
  return entangledJSON({
    alpha, note: `Default graph (Burman, Sonesson and Guilbaud, 2009): ${parsed.seqs.length} fixed sequence${parsed.seqs.length === 1 ? '' : 's'} with weights, as an entangled graph of hierarchical components (Maurer and Bretz, 2013, section 5.1, p. 1748).`,
    nodes: parsed.names.map((nm, i) => [nm, positions[i].x, positions[i].y]),
    c: parsed.seqs.map(s => s.c),
    comps: parsed.seqs.map(s => ({ w: Array.from({ length: m }, (_, i) => (i === s.order[0] ? '1' : '0')), edges: s.order.slice(0, -1).map((i, k) => [i, s.order[k + 1], '1']) }))
  });
}
/* Picture of a default graph in the style of Maurer and Bretz (2013), Fig. 4(a), p. 1748: one column per sequence,
   its weight on top, the hypotheses from the most important (top) to the least important (bottom). */
function defaultGraphSVG(G, dg, fmt, maxCols = 24) {
  const ink = '#1b1f23', grey = '#9aa0a6', font = 'Helvetica, Arial, sans-serif';
  const lab = id => (G.nodes.find(n => n.id === id) || {}).label || '?';
  const seqs = dg.seqs.slice(0, maxCols), colW = 96, rowH = 62, r = 22, top = 34;
  const rows = Math.max(...seqs.map(s => s.order.length), 1);
  const W = Math.max(1, seqs.length) * colW, H = top + rows * rowH + 10;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}" role="img" aria-label="Default graph: ${seqs.length} fixed sequence${seqs.length === 1 ? '' : 's'}">`];
  o.push(`<defs><marker id="dgah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${ink}"/></marker></defs>`);
  o.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  seqs.forEach((s, k) => {
    const cx = k * colW + colW / 2;
    o.push(`<text x="${cx}" y="18" font-size="13" text-anchor="middle" fill="${ink}">${xmlEsc(fmt(s.c))}${s.partial ? ' *' : ''}</text>`);
    s.order.forEach((id, j) => {
      const cy = top + j * rowH + r + 4;
      const n = G.nodes.find(x => x.id === id);
      o.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${n && n.color ? n.color : '#ffffff'}" stroke="${ink}" stroke-width="1.6"/>`);
      o.push(svgLabelText(lab(id), cx, cy + 5, 15, `text-anchor="middle" font-weight="700" fill="${n && n.color ? textOnColor(n.color) : ink}"`));
      if (j < s.order.length - 1) o.push(`<line x1="${cx}" y1="${cy + r}" x2="${cx}" y2="${cy + rowH - r}" stroke="${ink}" stroke-width="1.6" marker-end="url(#dgah)"/>`);
      else if (s.partial) o.push(`<text x="${cx}" y="${cy + r + 14}" font-size="11" text-anchor="middle" fill="${grey}">* lost</text>`);
    });
  });
  o.push('</svg>');
  return o.join('\n');
}

/* ---------- Template generators (any number of hypotheses) ---------- */
function circlePositions(m) {
  if (m <= 2) return Array.from({ length: m }, (_, i) => ({ x: i * 260, y: 0 }));
  const r = 110 + 32 * m;
  return Array.from({ length: m }, (_, i) => {
    const a = -Math.PI / 2 + 2 * Math.PI * i / m;
    return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) };
  });
}
function rowPositions(m) {
  const perRow = 5;
  return Array.from({ length: m }, (_, i) => ({ x: (i % perRow) * 220, y: Math.floor(i / perRow) * 190 }));
}
const TEMPLATE_GEN = {
  holm: m => ({
    note: `Bonferroni-Holm with ${m} hypotheses: equal weights of 1/${m}, and each hypothesis passes its level equally to the other ${m - 1 === 1 ? 'one' : m - 1}.`,
    pos: circlePositions(m),
    w: () => `1/${m}`,
    edges: () => { const e = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) e.push([i, j, m === 2 ? '1' : `1/${m - 1}`]); return e; }
  }),
  /* Weighted Holm for any m, built from typed initial weights w_1 ... w_m that add up to 1:
     g_ij = w_j / (1 - w_i) (Bretz et al., 2009, p. 594; Wiens, Dmitrienko and Marchenko, 2013, p. 1412).
     The graph is the weighted Holm procedure of Holm (1979) with the typed weights. At least two weights
     must be positive, since a hypothesis with weight 1 has 1 - w_i = 0. A zero-weight hypothesis is allowed:
     no edge leads into it, but it still passes on any level it is given. The gMCP helper BonferroniHolm(n,
     weights) and graphicalMCP's bonferroni_holm_weighted() keep equal transitions 1/(m - 1) whatever the
     weights are (read in both sources), so they are different graphs; both R exports write this matrix
     explicitly. `weights` is an array of m exact rationals; equal weights when it is missing. */
  weightedHolm: (m, weights) => {
    const w = weights && weights.length === m ? weights : Array.from({ length: m }, () => Q.make(1n, BigInt(m)));
    const tot = w.reduce((a, q) => Q.add(a, q), Q.ZERO);
    if (Q.cmp(tot, Q.ONE) !== 0) throw new Error(`The weights add up to ${Q.exact(tot)}. Weighted Holm needs them to add up to exactly 1.`);
    if (w.filter(q => !Q.isZero(q)).length < 2) throw new Error('At least two weights must be positive: a hypothesis with weight 1 would have nowhere to pass its level.');
    const g = (i, j) => Q.div(w[j], Q.sub(Q.ONE, w[i]));
    const list = w.map(q => Q.exact(q)).join(', ');
    return {
      note: `Weighted Holm with ${m} hypotheses (Holm, 1979; as a graph in Bretz et al., 2009, p. 594): the initial weights ${list}, and each hypothesis passes its level to the others in proportion to their initial weights, gᵢⱼ = wⱼ/(1 − wᵢ). The procedure tests the smallest pᵢ/wᵢ first and is alpha-exhaustive. These transitions do not follow the weights if you edit them later, so create the template again instead. The weighted Holm helpers in gMCP (BonferroniHolm with weights) and graphicalMCP (bonferroni_holm_weighted) keep equal transitions of 1/(m − 1) whatever the weights, which is a different graph, so the R exports write this matrix out in full.`,
      pos: circlePositions(m), w: i => Q.exact(w[i]),
      edges: () => { const e = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j && !Q.isZero(w[j])) e.push([i, j, Q.exact(g(i, j))]); return e; }
    };
  },
  fixed: m => ({
    note: `Fixed-sequence (hierarchical) testing with ${m} hypotheses (Maurer, Hothorn and Lehmacher, 1995; Westfall and Krishen, 2001; Bretz et al., 2009, Fig. 6): H1 gets all of alpha, and each later hypothesis is tested only after the one before it is rejected. The order is the whole design: a hypothesis placed after one that fails can never be tested, whatever its p-value. Choose the order from clinical priority and expected effect sizes, and check it by simulation in the Power tab. With poor estimates of the effects a Holm graph is often safer (Zhang, Wang and Troendle, 2015, section 4; Paux and Dmitrienko, 2018, section 4.2).`,
    pos: rowPositions(m), w: i => (i === 0 ? '1' : '0'),
    edges: () => Array.from({ length: m - 1 }, (_, i) => [i, i + 1, '1'])
  }),
  fallback: m => ({
    note: `Fallback procedure (Wiens, 2003; named and proved for any number of hypotheses by Wiens and Dmitrienko, 2005) with ${m} hypotheses: alpha is split equally up front, and a rejected hypothesis passes its level to the next one in the sequence. The last hypothesis's level is lost if it is rejected while earlier ones are open; the improved fallback templates return it.`,
    pos: rowPositions(m), w: () => `1/${m}`,
    edges: () => Array.from({ length: m - 1 }, (_, i) => [i, i + 1, '1'])
  }),
  /* Improved fallback I for any m, built from the initial weights: the fallback chain, with the last
     hypothesis returning its level to H1 ... H(m-1) in proportion to their initial weights,
     g(m, i) = w_i / (w_1 + ... + w_(m-1)) (Wiens and Dmitrienko, 2005, section 3.2, p. 934, for m = 3;
     Bretz et al., 2009, Fig. 7). The same rule for any m is graphicalMCP's fallback_improved_1. gMCP's
     improvedFallbackI has three hypotheses and keeps the return edges at 1/2, 1/2 whatever the weights
     are, like the three-node template above. `weights` is an array of m exact rationals; equal weights
     when it is missing. */
  improvedFallbackI: (m, weights) => {
    const w = weights && weights.length === m ? weights : Array.from({ length: m }, () => Q.make(1n, BigInt(m)));
    const S = w.slice(0, m - 1).reduce((a, q) => Q.add(a, q), Q.ZERO);
    if (Q.isZero(S)) throw new Error(`The weights of H1 to H${m - 1} must not all be zero: the last hypothesis would have nowhere to return its level.`);
    const ret = w.slice(0, m - 1).map(q => Q.div(q, S));
    const list = w.map(q => Q.exact(q)).join(', '), rets = ret.map(q => Q.exact(q)).join(', ');
    return {
      note: `Improved fallback I with ${m} hypotheses (Wiens and Dmitrienko, 2005, section 3.2; Bretz et al., 2009, Fig. 7): the fallback chain, with the level of the last hypothesis returned to the earlier ones in proportion to their initial weights, wᵢ/(w₁ + … + wₘ₋₁), so no alpha is lost. Built from the weights ${list}, which give return transitions ${rets}. These transitions do not follow the weights if you edit them later, so create the template again instead. For three hypotheses this is the paper's graph; for any number it is graphicalMCP's fallback_improved_1 (gMCP's improvedFallbackI has three hypotheses and keeps 1/2, 1/2 whatever the weights are).`,
      pos: rowPositions(m), w: i => Q.exact(w[i]),
      edges: () => Array.from({ length: m - 1 }, (_, i) => [i, i + 1, '1']).concat(ret.map((q, i) => [m - 1, i, Q.exact(q)]).filter(r => r[2] !== '0'))
    };
  }
};
function generatedTemplate(key, m, weights) {
  const t = TEMPLATE_GEN[key](m, weights);
  return {
    format: 'multiplicity-graph', alpha: 0.025, note: t.note,
    nodes: t.pos.map((p, i) => ({ id: String(i), label: 'H' + (i + 1), weight: t.w(i), x: p.x, y: p.y, p: '' })),
    edges: t.edges().map(r => ({ from: String(r[0]), to: String(r[1]), weight: r[2], bend: null }))
  };
}
/* Reads a list of initial weights typed by the user ("1/2, 3/10, 1/5", "0.5 0.3 0.2" or "c(1/2, 3/10, 1/5)").
   Returns an array of exact rationals, or throws an Error with a message for the user. For the improved
   fallback I generator the weights of all but the last hypothesis must not all be zero. */
function parseWeightList(txt, minCount) {
  const s = String(txt || '').trim().replace(/^c\s*\(/, '').replace(/\)\s*$/, '');
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length < (minCount || 2)) throw new Error(`Type at least ${minCount || 2} weights, separated by commas, such as 1/2, 3/10, 1/5.`);
  const w = parts.map(p => { const q = Q.parse(p); if (!q || q.n < 0n) throw new Error(`Could not read "${p}" as a weight. Use fractions or decimals from 0 to 1.`); return q; });
  const tot = w.reduce((a, q) => Q.add(a, q), Q.ZERO);
  if (Q.cmp(tot, Q.ONE) > 0) throw new Error(`The weights add up to ${Q.exact(tot)}, which is more than 1.`);
  return w;
}

/* ---------- Extra self-tests for adjusted p-values and simulation ---------- */
function runAllSelfTests() {
  const res = runSelfTest();
  const check = (name, fn) => {
    try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); }
    catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); }
  };
  let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const holmState = m => {
    const g = new Map(); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) g.set(gKey('h' + i, 'h' + j), Q.make(1n, BigInt(m - 1)));
    return { ids: Array.from({ length: m }, (_, i) => 'h' + i), w: new Map(Array.from({ length: m }, (_, i) => ['h' + i, Q.make(1n, BigInt(m))])), g };
  };
  check('Adjusted p-values equal Holm adjusted p-values (300 random sets)', () => {
    for (let k = 0; k < 300; k++) {
      const m = 2 + (k % 4), p = Array.from({ length: m }, () => rnd() * 0.2);
      const adj = adjustedPValues(holmState(m), id => p[+id.slice(1)]);
      const ord = p.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      let prev = 0;
      for (let r = 0; r < m; r++) {
        const want = Math.max(prev, Math.min(1, ord[r][0] * (m - r))); prev = want;
        if (Math.abs(adj.get('h' + ord[r][1]) - want) > 1e-12) return `mismatch at m = ${m}`;
      }
    }
    return true;
  });
  const bretz = () => {
    const { G } = deserializeGraph(templateJSON('bretz'), false, 1);
    return G;
  };
  check('Adjusted p <= alpha exactly when the test rejects (two doses, two endpoints)', () => {
    const G = bretz();
    for (let k = 0; k < 300; k++) {
      const p = G.nodes.map(() => rnd() * 0.05), pOf = id => p[G.nodes.findIndex(n => n.id === id)];
      const rej = new Set(runProcedure(stateFromGraph(G), pOf, 0.025).order);
      const adj = adjustedPValues(stateFromGraph(G), pOf);
      for (const n of G.nodes) if ((adj.get(n.id) <= 0.025) !== rej.has(n.id)) return `disagreement at set ${k}`;
    }
    return true;
  });
  check('Fast simulation procedure matches the exact one (500 random cases)', () => {
    const G = bretz(), fg = floatGraph(G), out = new Uint8Array(4);
    for (let k = 0; k < 500; k++) {
      const p = Array.from({ length: 4 }, () => rnd() * 0.04);
      shortcutFloat(4, fg.w, fg.g, Float64Array.from(p), 0.025, out);
      const rej = new Set(runProcedure(stateFromGraph(G), id => p[G.nodes.findIndex(n => n.id === id)], 0.025).order);
      for (let i = 0; i < 4; i++) if (!!out[i] !== rej.has(G.nodes[i].id)) return `mismatch at case ${k}`;
    }
    return true;
  });
  check('Normal functions: qnorm(0.975) = 1.95996, upper tail at 1.95996 = 0.025', () =>
    (Math.abs(qnorm(0.975) - 1.959964) < 1e-5 && Math.abs(pnormUpper(1.959964) - 0.025) < 1e-6) || `got ${qnorm(0.975)}, ${pnormUpper(1.959964)}`);
  check('Simulated power of a single test at 80% comes out at 80% (40,000 runs)', () => {
    const G = { nodes: [{ id: 'a', w: Q.ONE }], edges: [] };
    const tally = { n: 0, rej: [0], any: 0, all: 0, total: 0, custom: 0 };
    simulateChunk(floatGraph(G), [qnorm(0.975) + qnorm(0.8)], Float64Array.of(1), 0.025, 40000, normalGen(mulberry32(7)), tally, null);
    const pw = tally.rej[0] / tally.n;
    return Math.abs(pw - 0.8) < 0.01 || 'got ' + pw.toFixed(4);
  });
  check('Graph after rejecting a set is the same whatever the order (two doses, two endpoints)', () => {
    const G = bretz(), st = stateFromGraph(G), [a, b, c] = G.nodes.map(n => n.id);
    const s1 = rejectNode(rejectNode(rejectNode(st, a), b), c), s2 = rejectNode(rejectNode(rejectNode(st, c), a), b);
    const dump = s => s.ids.map(i => Q.exact(s.w.get(i))).join() + '|' + [...s.g.entries()].sort().map(([k, v]) => k + '=' + Q.exact(v)).join();
    return dump(s1) === dump(s2) || 'states differ';
  });
  check('Every rejection order ends with the same set (200 random p-value sets, all orders explored)', () => {
    const G = bretz();
    for (let k = 0; k < 200; k++) {
      const p = G.nodes.map(() => rnd() * 0.03), pOf = id => p[G.nodes.findIndex(n => n.id === id)];
      const r = orderAnalysis(stateFromGraph(G), pOf, 0.025);
      if (r.finals.length !== 1) return `${r.finals.length} different final sets at case ${k}`;
      const auto = runProcedure(stateFromGraph(G), pOf, 0.025).order.slice().sort().join(',');
      if (r.finals[0].slice().sort().join(',') !== auto) return `final set differs from the automatic run at case ${k}`;
    }
    return true;
  });
  check('Validation cases shared with the graphicalMCP script give the expected rejections and adjusted p-values', () => {
    const cases = [
      [generatedTemplate('holm', 3), [0.005, 0.03, 0.011], [1, 0, 1], [0.015, 0.03, 0.022]],
      [generatedTemplate('fixed', 3), [0.01, 0.03, 0.001], [1, 0, 0], [0.01, 0.03, 0.03]],
      [templateJSON('bretz'), [0.004, 0.009, 0.011, 0.03], [1, 1, 1, 0], [0.008, 0.012, 0.022, 0.03]],
      [templateJSON('bretz'), [0.02, 0.008, 0.0014, 0.001], [1, 1, 1, 1], [0.02, 0.016, 0.02, 0.016]]
    ];
    for (const [o, p, rej, adj] of cases) {
      const G = deserializeGraph(o, false, 1).G, i = id => G.nodes.findIndex(n => n.id === id), pOf = id => p[i(id)];
      const r = new Set(runProcedure(stateFromGraph(G), pOf, 0.025).order), a = adjustedPValues(stateFromGraph(G), pOf);
      if (G.nodes.some((n, k) => r.has(n.id) !== !!rej[k] || Math.abs(a.get(n.id) - adj[k]) > 1e-12)) return 'mismatch for p = ' + p.join(', ');
    }
    return true;
  });
  check('SAP text (two doses, two endpoints): numeric initial levels, initial-graph wording, gatekeeping sentence, no wrong citations', () => {
    const G = bretz(); G.nodes.forEach((n, i) => { n.desc = ['Dose 1, primary', 'Dose 2, primary', 'Dose 1, secondary', 'Dose 2, secondary'][i]; });
    const sap = sapText(G), t = sap.paragraphs.join(' ');
    const want = ['H1 and H2 will each initially be tested at one-sided level 0.0125 (weight 1/2)', 'In the initial graph, H1 passes 1/2 of its level to H2 and 1/2 to H3', 'H3 and H4 receive no initial significance level (weight 0)', 'Algorithm 1 of Bretz et al. (2009)', 'Figure [X]', 'No confirmatory conclusion will be drawn'];
    for (const w of want) if (!t.includes(w)) return 'missing: ' + w;
    if (/Sarkar|equation 3|section 3\.2/.test(t)) return 'a corrected citation came back';
    /* Bretz et al. (2009) plus the three references cited inside the interim analyses placeholder (1.1.6) */
    if (!/Glimm, Maurer and Bretz, 2010; Maurer, Glimm and Bretz, 2011, section 3\.1/.test(t) || !/Maurer and Bretz, 2013, section 4/.test(t)) return 'interim analyses placeholder';
    return (sap.heads.length === sap.paragraphs.length && sap.refs.length === 4) || 'heads or references wrong';
  });
  check('What would it take: H3 (p = 0.0014) needs H1; with p = 0.01 it needs H1 and H2; best level 0.025', () => {
    const G = bretz(), ids = G.nodes.map(n => n.id), lab = id => G.nodes[ids.indexOf(id)].label;
    const r1 = whatWouldItTake(stateFromGraph(G), ids[2], id => [0.02, 0.008, 0.0014, 0.001][ids.indexOf(id)], 0.025);
    const r2 = whatWouldItTake(stateFromGraph(G), ids[2], id => [0.02, 0.008, 0.01, 0.001][ids.indexOf(id)], 0.025);
    const s1 = r1.minimal.map(x => x.set.map(lab).join('+')).join(' '), s2 = r2.minimal.map(x => x.set.map(lab).join('+')).join(' ');
    if (s1 !== 'H1') return 'p = 0.0014 gave ' + s1;
    if (s2 !== 'H1+H2') return 'p = 0.01 gave ' + s2;
    if (Math.abs(r1.best.level - 0.025) > 1e-12 || r1.best.set.length !== 3) return 'best level ' + r1.best.level + ' with ' + r1.best.set.map(lab).join('+');
    if (Math.abs(r1.now.level) > 0) return 'level now should be 0';
    return true;
  });
  check('Fix "rescale weights" makes the weights sum to exactly 1', () => {
    const G = { nodes: [{ id: 'a', w: Q.parse('1/2') }, { id: 'b', w: Q.parse('3/4') }], edges: [], diag: {} };
    applyFix(G, { act: 'normW' });
    return Q.exact(Q.add(G.nodes[0].w, G.nodes[1].w)) === '1' || 'sum not 1';
  });
  return res;
}

/* ---------- Exchange format (for R, multigrain and other tools) ----------
   {
     "format": "multiplicity-graph", "version": 1, "source": "multigrain 1.0.0",
     "alpha": 0.025,
     "hypotheses": [ {"name": "H1", "label": "Dose 1, primary endpoint", "weight": 0.5, "group": "primary"}, ... ],
     "transitions": [[0, 0.9, 0.1, 0], ...]      rows = from, columns = to, same order as hypotheses
   }
   "label", "group" and "source" are optional. Weights may be numbers or strings such as "1/3".
   An optional "optimisation" block (written by sketchpad_json() for a graph_optimise() result) is read by
   readOptimisationBlock() below and carried through for the Optimise tab. */
function isExchangeFormat(o) { return o && typeof o === 'object' && Array.isArray(o.hypotheses) && Array.isArray(o.transitions); }
function fromExchangeFormat(o, positionsFor, colorFor) {
  const m = o.hypotheses.length;
  if (!m) throw new Error('The file lists no hypotheses.');
  if (o.transitions.length !== m || o.transitions.some(r => !Array.isArray(r) || r.length !== m)) throw new Error(`"transitions" must be a ${m} × ${m} matrix (one row per hypothesis, in the same order).`);
  const num = (v, what) => { const q = typeof v === 'number' ? Q.fromNumber(v) : Q.parse(v); if (!q) throw new Error(`Could not read ${what} "${v}".`); return q; };
  const names = o.hypotheses.map((h, i) => (h && h.name != null ? String(h.name) : 'H' + (i + 1)));
  const groups = [...new Set(o.hypotheses.map(h => (h && h.group ? String(h.group) : '')).filter(Boolean))];
  const pos = positionsFor(m);
  /* multigrain sets weights and transitions between 1e-4 and 1e-3 to exactly 0.001 after pruning (its R/post_optim_processing.R);
     the Sketchpad shows those as ε (= 1/1000 by default), the number on hover and in the Graph tab */
  const fromMg = /^multigrain/i.test(String(o.source || ''));
  const isEps = v => fromMg && typeof v === 'number' && Math.abs(v - 0.001) < 1e-12;
  const nodes = o.hypotheses.map((h, i) => ({
    id: String(i), label: names[i], weight: Q.exact(num(h && h.weight != null ? h.weight : 0, `the weight of ${names[i]}`)),
    x: pos[i].x, y: pos[i].y, p: h && h.p != null ? String(h.p) : '',
    desc: h && h.label ? String(h.label) : '', group: h && h.group ? String(h.group) : '',
    color: h && h.group ? colorFor(groups.indexOf(String(h.group))) : '',
    wexpr: h && isEps(h.weight) ? 'ε' : undefined
  }));
  const edges = [], diag = [];
  o.transitions.forEach((row, i) => row.forEach((v, j) => {
    const q = num(v, `transition ${names[i]} → ${names[j]}`);
    if (Q.isZero(q)) return;
    if (i === j) diag.push({ id: String(i), weight: Q.exact(q) }); else edges.push({ from: String(i), to: String(j), weight: Q.exact(q), bend: null, expr: isEps(v) ? 'ε' : undefined });
  }));
  const alpha = Number(o.alpha);
  const note = [o.source ? `Imported from ${o.source}.` : 'Imported.', groups.length ? `Groups: ${groups.join(', ')}.` : ''].filter(Boolean).join(' ');
  const out = { format: 'multiplicity-graph', alpha: alpha > 0 && alpha < 1 ? alpha : undefined, note, nodes, edges, diag };
  if (o.optimisation && typeof o.optimisation === 'object') out.optimisation = o.optimisation;
  return out;
}
/* A key for "the same weights and transitions": the SAP text and the Optimise tab use it to tell whether the graph is still
   the one multigrain returned */
function graphKey(G) {
  const ix = new Map(G.nodes.map((n, i) => [n.id, i]));
  return JSON.stringify([G.nodes.map(n => Q.exact(n.w)), G.edges.map(e => [ix.get(e.from), ix.get(e.to), Q.exact(e.g)]).sort()]);
}
/* The block as written to a file, share link or the exchange format (snake_case, as sketchpad_json() writes it) */
function writeOptimisationBlock(opt) {
  const b = { package: opt.package || '', gain: opt.gain || '' };
  if (opt.expectedGain != null) b.expected_gain = opt.expectedGain;
  if (opt.localPower) b.local_power = opt.localPower;
  if (opt.expectedRejections != null) b.expected_rejections = opt.expectedRejections;
  if (opt.disjunctivePower != null) b.disjunctive_power = opt.disjunctivePower;
  if (opt.conjunctivePower != null) b.conjunctive_power = opt.conjunctivePower;
  if (opt.optSource) b.opt_source = opt.optSource;
  if (opt.graphValid) b.graph_valid = { local: opt.graphValid.local, global: opt.graphValid.global };
  if (opt.globalSearch != null) b.global_search = opt.globalSearch;
  if (opt.inputs) { b.inputs = {}; if (opt.inputs.powerNominal) b.inputs.power_nominal = opt.inputs.powerNominal; if (opt.inputs.corrMatrix) b.inputs.corr_matrix = opt.inputs.corrMatrix; if (opt.inputs.nsim != null) b.inputs.nsim = opt.inputs.nsim; }
  if (opt.start) b.start = { weights: opt.start.weights, transitions: opt.start.transitions };
  if (opt.graphKey) b.graph_key = opt.graphKey;
  if (opt.share) b.share = true;
  return b;
}
/* The block without the gain function and multigrain's own numbers: what leaves the app when sharing is off */
function stripOptimisation(o) {
  if (!o || !o.optimisation) return o;
  const c = Object.assign({}, o); delete c.optimisation; return c;
}
/* The optional "optimisation" block written by sketchpad_json() for a graph_optimise() result (R/multigrain-to-sketchpad.R).
   Returns a checked copy, or null when there is no usable block. Numbers that are missing or malformed are left out. */
function readOptimisationBlock(b, m) {
  if (!b || typeof b !== 'object') return null;
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
  const vec = v => (Array.isArray(v) && v.length === m && v.every(x => num(x) != null) ? v.map(num) : null);
  const mat = v => (Array.isArray(v) && v.length === m && v.every(r => vec(r)) ? v.map(vec) : null);
  const out = { package: b.package != null ? String(b.package) : '', gain: typeof b.gain === 'string' ? b.gain : '' };
  out.expectedGain = num(b.expected_gain); out.localPower = vec(b.local_power);
  out.expectedRejections = num(b.expected_rejections); out.disjunctivePower = num(b.disjunctive_power); out.conjunctivePower = num(b.conjunctive_power);
  out.optSource = b.opt_source != null ? String(b.opt_source) : '';
  out.graphValid = b.graph_valid && typeof b.graph_valid === 'object' ? { local: b.graph_valid.local == null ? null : !!b.graph_valid.local, global: b.graph_valid.global == null ? null : !!b.graph_valid.global } : null;
  out.globalSearch = typeof b.global_search === 'boolean' ? b.global_search : null;
  const inp = b.inputs && typeof b.inputs === 'object' ? b.inputs : null;
  out.inputs = inp ? { powerNominal: vec(inp.power_nominal), corrMatrix: mat(inp.corr_matrix), nsim: num(inp.nsim) } : null;
  out.start = b.start && typeof b.start === 'object' && vec(b.start.weights) && mat(b.start.transitions) ? { weights: vec(b.start.weights), transitions: mat(b.start.transitions) } : null;
  out.graphKey = typeof b.graph_key === 'string' ? b.graph_key : '';
  return out;
}
function toExchangeFormat(G) {
  return {
    format: 'multiplicity-graph', version: 1, source: 'Multiplicity Graph Sketchpad', alpha: G.alpha,
    hypotheses: G.nodes.map(n => { const h = { name: n.label, weight: Q.toNum(n.w) }; if (n.desc) h.label = n.desc; if (n.group) h.group = n.group; if (n.p) h.p = n.p; return h; }),
    transitions: matrixRows(G, q => Q.toNum(q))
  };
}

/* ---------- Plain-language description (for clinicians) ---------- */
function pctWords(x) { const v = x * 100; return +v.toPrecision(4) + '%'; }
function shareWords(q) {
  const words = { '1/2': 'half', '1/3': 'a third', '2/3': 'two thirds', '1/4': 'a quarter', '3/4': 'three quarters', '1/5': 'a fifth', '1/6': 'a sixth', '1/8': 'an eighth' };
  return words[Q.exact(q)] || pctWords(Q.toNum(q));
}
function joinWords(arr) { return arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
/* Sentences describing the graph as a whole. nameOf(id, full) gives "H1" or "H1 (dose 1, primary endpoint)".
   For the closed tests (Simes, parametric) the claim rule and the order sentence do not apply, so the text says so. */
function plainGraphText(G, nameOf) {
  const out = [];
  const m = G.nodes.length;
  if (!m) return out;
  const tt = (G.test || defaultTest()).type;
  const closed = tt !== 'bonferroni';
  if (isEntangled(G)) {
    /* Entangled graph (Maurer and Bretz, 2013): the allowance is split across linked graphs; a question's share is
       the sum of its shares in all of them, and each graph hands its part on in its own way */
    const n = G.ent.comps.length;
    out.push(`The trial asks ${m} question${m > 1 ? 's' : ''} (${joinWords(G.nodes.map(nd => nameOf(nd.id, true)))}). It is allowed a ${pctWords(G.alpha)} chance of wrongly claiming at least one success across all of them, whichever of the questions truly have no effect. That allowance is split between ${n} linked graphs (${joinWords(G.ent.comps.map((_, k) => `graph ${k + 1} holds ${pctWords(Q.toNum(G.ent.c[k]) * G.alpha)}`))}). A question's share at any time is the sum of its shares in all the graphs${closed ? '.' : ', and it can only be claimed as a success if its p-value is no bigger than that sum.'} When a question succeeds, each graph hands its part of the share on in its own way, so a share remembers which graph it came from.`);
    G.ent.comps.forEach((cs, k) => {
      const v = entViewGraph(G, k), ck = Q.toNum(G.ent.c[k]) * G.alpha;
      const withW = v.nodes.filter(nd => !Q.isZero(nd.w));
      let t = `Graph ${k + 1}: at the start, ${joinWords(withW.map(nd => `${nameOf(nd.id)} holds ${pctWords(Q.toNum(nd.w) * ck)}`)) || 'no question holds anything'}.`;
      const passes = v.nodes.map(nd => {
        const outs = v.edges.filter(e => e.from === nd.id && !Q.isZero(e.g));
        if (!outs.length) return null;
        if (outs.length === 1) return Q.eq(outs[0].g, Q.ONE) ? `When ${nameOf(nd.id)} succeeds, its whole share in this graph passes to ${nameOf(outs[0].to)}.` : `When ${nameOf(nd.id)} succeeds, it hands ${shareWords(outs[0].g)} of its share in this graph to ${nameOf(outs[0].to)}.`;
        return `When ${nameOf(nd.id)} succeeds, it hands ${joinWords(outs.map(e => `${shareWords(e.g)} of its share in this graph to ${nameOf(e.to)}`))}.`;
      }).filter(Boolean);
      out.push(t + (passes.length ? ' ' + passes.join(' ') : ''));
    });
    if (!closed) out.push('Handing allowance on is what lets a question with a very small p-value be claimed later, even though it started with no share. The order in which successes are found makes no difference to the final answer.');
    else if (tt === 'parametric') out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together, using how strongly the test results are correlated to make the shares go further, and a question is claimed only when every combination that includes it passes the check. This needs the stated correlations to be right and the p-values to be one-sided.');
    else out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together with a Simes test, which can confirm a combination when all of its p-values are fairly small even if none is below its own share, and a question is claimed only when every combination that includes it passes the check. This relies on the test results not being negatively related to one another.');
    return out;
  }
  out.push(`The trial asks ${m} question${m > 1 ? 's' : ''} (${joinWords(G.nodes.map(n => nameOf(n.id, true)))}). It is allowed a ${pctWords(G.alpha)} chance of wrongly claiming at least one success across all of them, whichever of the questions truly have no effect. That allowance is shared out${closed ? ' as described below.' : ', and a question can only be claimed as a success if its p-value is no bigger than its share at the time.'}`);
  const withW = G.nodes.filter(n => !Q.isZero(n.w)), noW = G.nodes.filter(n => Q.isZero(n.w));
  const starts = withW.map(n => `${nameOf(n.id)} starts with ${pctWords(Q.toNum(n.w) * G.alpha)}`);
  let s = `At the start, ${joinWords(starts) || 'no question has a share'}.`;
  if (noW.length) s += ` ${joinWords(noW.map(n => nameOf(n.id)))} ${noW.length > 1 ? 'start' : 'starts'} with nothing, so ${noW.length > 1 ? 'they' : 'it'} cannot succeed until another question hands some allowance on.`;
  out.push(s);
  const passes = G.nodes.map(n => {
    const outs = G.edges.filter(e => e.from === n.id && !Q.isZero(e.g));
    if (!outs.length) return `${nameOf(n.id)} keeps its share: once it succeeds, nothing is handed on.`;
    if (outs.length === 1) return Q.eq(outs[0].g, Q.ONE) ? `When ${nameOf(n.id)} succeeds, its whole share passes to ${nameOf(outs[0].to)}.` : `When ${nameOf(n.id)} succeeds, it hands ${shareWords(outs[0].g)} of its share to ${nameOf(outs[0].to)}.`;
    return `When ${nameOf(n.id)} succeeds, it hands ${joinWords(outs.map(e => `${shareWords(e.g)} of its share to ${nameOf(e.to)}`))}.`;
  });
  out.push(...passes);
  if (!closed) out.push('Handing allowance on is what lets a question with a very small p-value be claimed later, even though it started with no share. The order in which successes are found makes no difference to the final answer.');
  else if (tt === 'parametric') out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together, using how strongly the test results are correlated to make the shares go further, and a question is claimed only when every combination that includes it passes the check. This needs the stated correlations to be right and the p-values to be one-sided.');
  else out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together with a Simes test, which can confirm a combination when all of its p-values are fairly small even if none is below its own share, and a question is claimed only when every combination that includes it passes the check. This relies on the test results not being negatively related to one another.');
  return out;
}
/* One sentence per rejection. step: {label, p, level, manual, gave: [[toLabel, amountQ]], now: [[label, levelNumber]]} */
function plainStepText(st, alpha) {
  let s = st.manual ? `Suppose ${st.label} succeeds.` : `${st.label} succeeded: its p-value ${fmtNum(st.p)} is within its share of ${pctWords(st.level)}.`;
  if (st.gave.length) s += ` Its share was handed on: ${joinWords(st.gave.map(([to, q]) => `${to} gained ${pctWords(Q.toNum(q) * alpha)}`))}.`;
  else if (st.wj !== undefined && !Q.isZero(st.wj)) s += ' Nothing was handed on.';
  if (st.now.length) s += ` Shares now: ${joinWords(st.now.map(([l, lv]) => `${l} ${pctWords(lv)}`))}.`;
  return s;
}

/* ---------- SAP / protocol text ---------- */
/* Bonferroni: the sequentially rejective procedure of Bretz et al. (2009). Simes, Simes within groups and
   parametric: a closed test (Bretz et al., 2011; Xi et al., 2017) whose intersection weights come from the graph;
   those paragraphs must not describe the step-by-step rejection rule, which does not apply to them.
   SAP / protocol text for the multiplicity strategy (revised in 1.1.4 after a review against the primary papers,
   the FDA guidance Multiple Endpoints in Clinical Trials (2022, Appendix 8) and real SAPs).
   Returns {paragraphs, heads, tables, refs}: heads[i] is the bold lead-in of paragraphs[i] (the paragraph text
   starts with it, so plain copies read naturally); refs is the reference list, kept separate from the text.
   Facts the graph cannot hold (success criterion, justifications, software) are left as [square-bracket
   placeholders] for the statistician to complete. */
function sapText(G, opts = {}) {
  const fmtW = q => (Q.isExactShort(q) ? Q.exact(q) : Q.dec(q));
  const nm = n => (n.desc ? `${n.label} (${n.desc})` : n.label);
  const lab = id => (G.nodes.find(x => x.id === id) || {}).label;
  const m = G.nodes.length, aNum = G.alpha, a = fmtNum(aNum, 6);
  const two = G.sided === 'two';
  const sided = two ? 'two-sided' : 'one-sided';
  const tt = (G.test || defaultTest()).type;
  const closed = tt !== 'bonferroni';
  const upscale = closed && !!(G.test && G.test.upscale);
  const groups = [...new Set(G.nodes.map(n => n.group).filter(Boolean))];
  const NUMW = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const count = k => (k < NUMW.length ? NUMW[k] : String(k));
  const REF = {
    bretz2009: 'Bretz F, Maurer W, Brannath W, Posch M (2009). A graphical approach to sequentially rejective multiple test procedures. Statistics in Medicine 28(4):586–604.',
    bretz2011: 'Bretz F, Posch M, Glimm E, Klinglmueller F, Maurer W, Rohmeyer K (2011). Graphical approaches for multiple comparison procedures using weighted Bonferroni, Simes, or parametric tests. Biometrical Journal 53(6):894–913.',
    marcus1976: 'Marcus R, Peritz E, Gabriel KR (1976). On closed testing procedures with special reference to ordered analysis of variance. Biometrika 63(3):655–660.',
    bh1997: 'Benjamini Y, Hochberg Y (1997). Multiple hypotheses testing with weights. Scandinavian Journal of Statistics 24(3):407–418.',
    by2001: 'Benjamini Y, Yekutieli D (2001). The control of the false discovery rate in multiple testing under dependency. Annals of Statistics 29(4):1165–1188.',
    bheller2007: 'Benjamini Y, Heller R (2007). False discovery rates for spatial signals. Journal of the American Statistical Association 102(480):1272–1281.',
    samuelcahn1996: 'Samuel-Cahn E (1996). Is the Simes improved Bonferroni procedure conservative? Biometrika 83(4):928–933.',
    lu2016: 'Lu K (2016). Graphical approaches using a Bonferroni mixture of weighted Simes tests. Statistics in Medicine 35(22):4041–4055.',
    xi2017: 'Xi D, Glimm E, Maurer W, Bretz F (2017). A unified framework for weighted parametric multiple test procedures. Biometrical Journal 59(5):918–931.',
    genz2009: 'Genz A, Bretz F (2009). Computation of Multivariate Normal and t Probabilities. Lecture Notes in Statistics 195. Springer.',
    gmcp: 'Rohmeyer K, Klinglmueller F (2024). gMCP: Graph Based Multiple Comparison Procedures. R package version 0.8-17.',
    sarkar1998: 'Sarkar SK (1998). Some probability inequalities for ordered MTP2 random variables: a proof of the Simes conjecture. Annals of Statistics 26(2):494–504.',
    maurerbretz2013a: 'Maurer W, Bretz F (2013). Memory and other properties of multiple test procedures generated by entangled graphs. Statistics in Medicine 32(10):1739–1753.',
    maurerbretz2013b: 'Maurer W, Bretz F (2013). Multiple testing in group sequential trials using graphical approaches. Statistics in Biopharmaceutical Research 5(4):311–320.',
    glimm2010: 'Glimm E, Maurer W, Bretz F (2010). Hierarchical testing of multiple endpoints in group-sequential trials. Statistics in Medicine 29(2):219–228. doi:10.1002/sim.3748',
    maurer2011: 'Maurer W, Glimm E, Bretz F (2011). Multiple and repeated testing of primary, coprimary, and secondary hypotheses. Statistics in Biopharmaceutical Research 3(2):336–352.',
    spiers2026: 'Spiers ADV, Grayling MJ, Wheeler GM, Mander AP (2026). Gain-function optimisation of graphical multiple testing procedures for confirmatory clinical trials. arXiv:2609.19994.',
    multigrain: `Spiers A, Moldovan-Grünfeld D (2026). multigrain: Optimise Graphical Approaches to Multiple Testing Procedures. R package${G.opt && /^multigrain \S/.test(G.opt.package || '') ? ' version ' + G.opt.package.replace(/^multigrain\s+/, '') : ''}. https://CRAN.R-project.org/package=multigrain`
  };
  const refs = [];
  const cite = (...keys) => { for (const k of keys) if (!refs.includes(REF[k])) refs.push(REF[k]); };
  const P = [], H = [];
  const add = (head, text) => { H.push(head); P.push(head + '. ' + text); };
  const lvl = x => fmtNum(x * aNum, 6);
  /* Entangled graph (Maurer and Bretz, 2013): the text describes each component graph and the combined rule
     level_i = α Σ_h c_h w_hi (Algorithm 1, p. 1743); closed tests use the Algorithm 2 weights (p. 1745). */
  const ent = isEntangled(G);
  const views = ent ? G.ent.comps.map((_, k) => entViewGraph(G, k)) : null;
  const nComp = ent ? views.length : 1;
  const cText = k => (G.ent.cexpr && G.ent.cexpr[k] ? `${exprDisplay(G.ent.cexpr[k])} = ${fmtW(G.ent.c[k])}` : fmtW(G.ent.c[k]));
  const compW = (k, id) => views[k].nodes.find(n => n.id === id).w;
  const combW = id => (ent ? views.reduce((s, v, k) => Q.add(s, Q.mul(G.ent.c[k], compW(k, id))), Q.ZERO) : G.nodes.find(n => n.id === id).w);
  const compTitle = k => `component graph ${k + 1} (c${k + 1} = ${cText(k)})`;

  /* 1. Hypotheses */
  const anyDesc = G.nodes.some(n => n.desc);
  let hyp = `The confirmatory family consists of the ${count(m)} null hypotheses in Table [X.1]: ${joinWords(G.nodes.map(nm))}.`;
  if (!G.nodes.every(n => n.desc)) hyp += ` [State each null hypothesis${anyDesc ? ' that has no description' : ''}: endpoint, comparison, population and direction.]`;
  if (groups.length) hyp += ' ' + groups.map(g => { const h = G.nodes.filter(n => n.group === g).map(n => n.label); return `The ${g} hypotheses ${h.length > 1 ? 'are' : 'is'} ${joinWords(h)}.`; }).join(' ');
  hyp += ' No multiplicity adjustment will be made for endpoints outside this family; [their p-values will be presented as nominal and descriptive].';
  add('Hypotheses', hyp);

  /* 2. Error rate and procedure */
  const rate = two
    ? (closed
      ? `The family-wise error rate for these hypotheses will be controlled in the strong sense at two-sided α = ${a}, with two-sided p-values in every intersection test`
      : `The family-wise error rate for these hypotheses will be controlled in the strong sense at two-sided α = ${a}, that is, one-sided ${fmtNum(aNum / 2, 6)} in the direction of benefit`)
    : `The family-wise error rate for these hypotheses will be controlled in the strong sense at one-sided α = ${a}`;
  let proc;
  const entIntro = ent ? ` The testing strategy is an entangled graph (Maurer and Bretz, 2013): ${count(nComp)} component graphs on the same hypotheses, shown in Figure [X], with component weights ${joinWords(views.map((_, k) => `c${k + 1} = ${cText(k)}`))}${Q.eq(views.reduce((s, _, k) => Q.add(s, G.ent.c[k]), Q.ZERO), Q.ONE) ? '' : ' (the component weights add up to less than 1, so the procedure does not use the full α)'}.` : '';
  if (!closed && ent) {
    proc = `${rate}, using the graphical approach of Bretz et al. (2009) in its entangled form (Maurer and Bretz, 2013).${entIntro} Each hypothesis H_i will be tested at the local significance level α × (c1 × w1i + c2 × w2i${nComp > 2 ? ' + …' : ''}), the sum over the component graphs of the component weight times the current weight of H_i in that component graph (Maurer and Bretz, 2013, Algorithm 1, p. 1743). The procedure is equivalent to a closed testing procedure with weighted Bonferroni tests whose weights are the same sums over the component graphs (Maurer and Bretz, 2013, Algorithm 2, p. 1745), and controls the family-wise error rate for any dependence between the test statistics.`;
    cite('bretz2009', 'maurerbretz2013a');
  } else if (!closed) {
    proc = `${rate}, using the graphical approach of Bretz et al. (2009). The testing strategy is shown in Figure [X]. The procedure is equivalent to a closed testing procedure with weighted Bonferroni tests, and controls the family-wise error rate for any dependence between the test statistics.`;
    cite('bretz2009');
  } else {
    const what = tt === 'parametric' ? 'weighted parametric tests (Xi et al., 2017)' : tt === 'simes' ? 'weighted Simes tests (Benjamini and Hochberg, 1997)' : 'weighted Simes tests within groups of hypotheses and weighted Bonferroni tests otherwise';
    proc = `${rate}, using a closed testing procedure (Marcus et al., 1976) with ${what}, with weights defined by the ${ent ? 'entangled graph (Bretz et al., 2009, 2011; Maurer and Bretz, 2013, p. 1746)' : 'graph (Bretz et al., 2009, 2011)'}.${ent ? entIntro : ' The testing strategy is shown in Figure [X].'} ${tt === 'parametric' ? 'The procedure assumes that the test statistics are multivariate normal within blocks of hypotheses with known correlations' : 'The procedure assumes positively dependent test statistics'}; the assumptions and the test of each intersection hypothesis are given under Technical details.`;
    cite('bretz2009', 'bretz2011', 'marcus1976');
    if (ent) cite('maurerbretz2013a');
    if (tt === 'parametric') cite('xi2017'); else cite('bh1997');
  }
  add('Error rate and procedure', proc);

  /* 3. Initial allocation */
  const nodesW = ent ? G.nodes.map(n => Object.assign({}, n, { w: combW(n.id), wexpr: undefined })) : G.nodes;
  const withW = nodesW.filter(n => !Q.isZero(n.w)), noW = nodesW.filter(n => Q.isZero(n.w));
  const byW = [];
  for (const n of withW) { const k = byW.find(x => Q.eq(x.w, n.w)); if (k) k.ns.push(n); else byW.push({ w: n.w, ns: [n] }); }
  let alloc = byW.map(x => {
    const wtxt = x.ns[0].wexpr ? exprDisplay(x.ns[0].wexpr) + ' = ' + fmtW(x.w) : fmtW(x.w);
    return closed
      ? `${joinWords(x.ns.map(n => n.label))} ${x.ns.length > 1 ? 'each have' : 'has'} initial weight ${wtxt}`
      : `${joinWords(x.ns.map(n => n.label))} will ${x.ns.length > 1 ? 'each ' : ''}initially be tested at ${sided} level ${lvl(Q.toNum(x.w))} (weight ${wtxt})`;
  });
  alloc = alloc.length ? alloc.join('; ') + '.' : '';
  if (ent) {
    /* the weights in each component graph first, then the combined weights */
    const perComp = views.map((v, k) => {
      const wn = v.nodes.filter(n => !Q.isZero(n.w));
      return `In ${compTitle(k)}, ${wn.length ? joinWords(wn.map(n => `${n.label} has initial weight ${n.wexpr ? exprDisplay(n.wexpr) + ' = ' + fmtW(n.w) : fmtW(n.w)}`)) : 'every hypothesis has initial weight 0'}${wn.length < v.nodes.length ? ` and ${joinWords(v.nodes.filter(n => Q.isZero(n.w)).map(n => n.label))} ${v.nodes.length - wn.length > 1 ? 'have' : 'has'} weight 0` : ''}.`;
    }).join(' ');
    alloc = `${perComp} Taken together (combined weight c1 × w1i + c2 × w2i${nComp > 2 ? ' + …' : ''}, Table [X.1]): ${alloc}`;
  }
  let wsum = Q.ZERO; for (const n of nodesW) wsum = Q.add(wsum, n.w);
  if (!Q.eq(wsum, Q.ONE)) alloc += ` The initial ${ent ? 'combined ' : ''}weights add up to ${fmtW(wsum)}, so the procedure does not use the full α.`;
  if (noW.length) {
    const anyEdgeTo = id => (ent ? views.some(v => v.edges.some(e => e.to === id && !Q.isZero(e.g))) : G.edges.some(e => e.to === id && !Q.isZero(e.g)));
    const reach = noW.filter(n => anyEdgeTo(n.id));
    const never = noW.filter(n => !reach.includes(n));
    if (reach.length && !closed) alloc += ` ${joinWords(reach.map(n => n.label))} ${reach.length > 1 ? 'receive' : 'receives'} no initial significance level (weight 0): ${reach.length > 1 ? 'each' : 'it'} can be tested only after significance level has been passed to it from a rejected hypothesis.`;
    if (reach.length && closed) alloc += ` ${joinWords(reach.map(n => n.label))} ${reach.length > 1 ? 'have' : 'has'} weight 0 in the global intersection hypothesis and ${reach.length > 1 ? 'receive' : 'receives'} weight only in intersection hypotheses that leave out the hypotheses passing weight to ${reach.length > 1 ? 'them' : 'it'}.`;
    if (never.length) alloc += ` ${joinWords(never.map(n => n.label))} ${never.length > 1 ? 'have' : 'has'} weight 0 and no transition weight leads to ${never.length > 1 ? 'them' : 'it'}, so ${never.length > 1 ? 'they' : 'it'} can never be rejected.`;
  }
  add('Initial allocation', alloc.trim());

  /* 4. Propagation */
  const unit = closed ? 'weight' : 'level';
  const passesOf = (nodes, edges) => nodes.map(n => {
    const outs = edges.filter(e => e.from === n.id && !Q.isZero(e.g));
    if (!outs.length) return `${n.label} passes nothing on`;
    if (outs.length === 1 && !outs[0].expr && Q.eq(outs[0].g, Q.ONE)) return `${n.label} passes all of its ${unit} to ${lab(outs[0].to)}`;
    return `${n.label} passes ${joinWords(outs.map((e, k) => `${e.expr ? exprDisplay(e.expr) : fmtW(e.g)}${k === 0 ? ` of its ${unit}` : ''} to ${lab(e.to)}`))}`;
  });
  const listPasses = p => (p.length > 1 ? p.slice(0, -1).join('; ') + '; and ' + p[p.length - 1] : p[0]);
  const initial = ent
    ? views.map((v, k) => `Initially, in ${compTitle(k)}, ${listPasses(passesOf(v.nodes, v.edges))}.`).join(' ')
    : `In the initial graph, ${listPasses(passesOf(G.nodes, G.edges))}.`;
  const dir = two ? ' and the estimated effect favours [the experimental treatment]' : '';
  let prop;
  if (!closed && ent) {
    prop = `A hypothesis will be rejected if its ${sided} p-value is at most its current local significance level${dir}. When a hypothesis is rejected, it will be removed from every component graph with the update of Bretz et al. (2009), its weight in each component graph being passed on according to that component graph's transition weights (Table [X.2]), and the local level of each remaining hypothesis will be recomputed as α times the sum over the component graphs of the component weight times its current weight (Maurer and Bretz, 2013, Algorithm 1, p. 1743). ${initial} After each rejection the weights and transition weights are updated, so later proportions can differ from these. Testing will continue until no further hypothesis can be rejected. The final set of rejected hypotheses does not depend on the order in which hypotheses are tested.`;
  } else if (!closed) {
    prop = `A hypothesis will be rejected if its ${sided} p-value is at most its current local significance level${dir}. When a hypothesis is rejected, its local level will be passed on according to the transition weights in Table [X.2], and the graph will be updated with Algorithm 1 of Bretz et al. (2009). ${initial} After each rejection the weights and transition weights are updated, so later proportions can differ from these. Testing will continue until no further hypothesis can be rejected. The final set of rejected hypotheses does not depend on the order in which hypotheses are tested.`;
  } else {
    prop = `The weights of each intersection hypothesis will be derived from the initial weights (Table [X.1]) and the transition weights (Table [X.2]) by removing the hypotheses not in the intersection one at a time with Algorithm 1 of Bretz et al. (2011)${ent ? ', in every component graph, the weight of a hypothesis in the intersection being the sum over the component graphs of the component weight times its weight there (Maurer and Bretz, 2013, Algorithm 2, p. 1745)' : ''}; the result does not depend on the order of removal. ${initial} After each removal the weights and transition weights are updated, so later proportions can differ from these. An elementary hypothesis will be rejected if and only if every intersection hypothesis containing it is rejected (closure principle). With ${tt === 'parametric' ? 'parametric' : 'Simes'} tests the graph defines the weights of the intersection hypotheses; it is not a sequence of tests, and the closed test is not consonant in general, so it is not carried out step by step (Bretz et al., 2011, ${tt === 'parametric' ? 'eq. 4, p. 901' : 'section 3.3, p. 906'}).${two ? ' A hypothesis rejected with an estimated effect that does not favour [the experimental treatment] will not be claimed as a benefit.' : ''}`;
  }
  /* Not alpha-exhaustive: say so, with an example from the closure */
  const exh = isAlphaExhaustive(G);
  let lowest = null;
  if (exh === false && m >= 2 && m <= 12) {
    const W = closureWeights(floatGraph(G));
    let best = -1, bw = 1;
    for (let i = 0; i < m; i++) { const w = W[(1 << i) * m + i]; if (w < bw - 1e-9) { bw = w; best = i; } }
    if (best >= 0) lowest = { label: G.nodes[best].label, w: bw };
  }
  if (exh === false && Q.eq(wsum, Q.ONE) && !upscale) {
    if (!closed) prop += ` In some rejection sequences, significance level is not passed on${lowest ? `; for example, if all other hypotheses are rejected, ${lowest.label} is tested at ${sided} level ${fmtNum(lowest.w * aNum, 6)}` : ''}. The procedure therefore does not always use the full α.`;
    else prop += ` The graph is not α-exhaustive: in some intersection hypotheses the weights sum to less than 1${lowest ? `; for example, the intersection hypothesis consisting of ${lowest.label} alone has weight ${fmtNum(lowest.w, 6)} and is tested at level ${fmtNum(lowest.w * aNum, 6)}` : ''}. As a result, a hypothesis can be rejected even when the hypotheses that pass weight to it are not, so the order of testing suggested by the graph is not guaranteed.`;
  }
  /* Symbolic weights */
  const vnames = Object.keys(G.vars || {});
  const hasEps = vnames.includes('ε');
  if (hasEps) prop += ` Edges labelled ε are the infinitesimal weights of Bretz et al. (2009, section 3.3): ${closed ? 'weight' : 'level'} passes along them only when no other route is open. For computation ε = ${fmtW(G.vars['ε'])}, as in the gMCP package; a small share of ${closed ? 'weight' : 'level'} then always passes along these edges, so decisions can differ from the infinitesimal procedure only when a p-value lies very close to a critical value.`;
  const others = vnames.filter(v => v !== 'ε');
  if (others.length) prop += ` The graph uses the parameter${others.length > 1 ? 's' : ''} ${joinWords(others.map(v => `${v} = ${fmtW(G.vars[v])}`))}; the tables give the resulting numeric weights.`;
  if (hasEps) cite('gmcp');
  add('Propagation', prop);

  /* 4b. Choice of the graph, when it came from multigrain (plan section 10): the gain function only when sharing is on */
  if (!ent && G.opt) {
    const O = G.opt, same = !O.graphKey || O.graphKey === graphKey(G);
    const inp = O.inputs || {};
    const assume = inp.powerNominal ? ` under the planning assumptions of ${joinWords(G.nodes.map((n, i) => `${fmtNum(100 * inp.powerNominal[i], 4)}% power for ${n.label}`))}${inp.corrMatrix ? (() => { const off = []; for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) off.push(inp.corrMatrix[i][j]); return off.length && off.every(v => Math.abs(v - off[0]) < 1e-12) ? ` and a correlation of ${fmtNum(off[0], 4)} between every pair of test statistics` : ' and the correlations between the test statistics given in Table [X.4]'; })() : ''}` : '';
    let txt = same
      ? `The initial weights and transition weights were chosen by gain-function optimisation (Spiers et al., 2026)${O.package ? ` with the R package ${O.package}` : ''}: among the graphs allowed by the prespecified constraints, the one maximising the expected gain${assume}${inp.nsim ? `, estimated over ${inp.nsim.toLocaleString('en-GB')} simulated trials` : ''}.${O.expectedGain != null ? ` The expected gain of the chosen graph was ${fmtNum(O.expectedGain, 4)} on the simulated sample used for the optimisation${O.localPower ? `, with marginal powers of ${joinWords(G.nodes.map((n, i) => `${fmtNum(100 * O.localPower[i], 4)}% for ${n.label}`))}` : ''}.` : ''}`
      : `The graph was derived from one chosen by gain-function optimisation (Spiers et al., 2026)${O.package ? ` with the R package ${O.package}` : ''}${assume} and then edited by hand. [State what was changed and why.]`;
    txt += O.share && O.gain ? ` The gain function was ψ(r) = ${O.gain}, where r1, r2, ... indicate rejection of ${joinWords(G.nodes.map(n => n.label))}.` : ' [The gain function is not reproduced here. Spiers et al. (2026) note that it may encode commercially sensitive judgements and need not be disclosed; only the resulting graph is prespecified.]';
    txt += ' The optimisation chose the weights only; the error rate control stated above does not depend on how they were chosen.';
    add('Choice of the graph', txt);
    cite('spiers2026', 'multigrain');
  }

  /* 5. Conclusions, interim analyses, reporting */
  add('Conclusions', 'A hypothesis rejected by this procedure will be declared statistically significant. No confirmatory conclusion will be drawn for a hypothesis that is not rejected. [The study will be considered positive if ...]');
  add('Interim analyses', 'Each hypothesis will be tested once, at the final analysis. [Or, for a group sequential design: state the spending function for each hypothesis. The boundary for a hypothesis at each look will be computed from its spending function at its current local level, not by scaling a boundary computed at the full α (Maurer and Bretz, 2013, section 4). A secondary hypothesis will not be tested at the full α once its primary hypothesis is rejected at an interim analysis; that strategy can raise the family-wise error rate above α (Glimm, Maurer and Bretz, 2010; Maurer, Glimm and Bretz, 2011, section 3.1).]');
  cite('maurerbretz2013b', 'glimm2010', 'maurer2011');
  add('Reporting', `Multiplicity-adjusted p-values (${closed ? 'for each hypothesis, the largest p-value of the intersection hypotheses containing it, where the p-value of an intersection hypothesis is the smallest level at which it can be rejected; Bretz et al., 2011, section 3.2' : 'Bretz et al., 2009, section 3.1'}) [will / will not] be reported. Confidence intervals will be presented at the nominal [95%] level and are not adjusted for multiplicity. Analyses will use [software and version].`);

  /* 6. Technical details (closed tests only) */
  const tables = [];
  if (closed) {
    const scale = upscale
      ? (tt === 'parametric'
        ? ' The weights of each intersection hypothesis will first be increased proportionally so that they sum to 1 (Xi et al., 2017, section 4.2).'
        : ' The weights of each intersection hypothesis will first be increased proportionally so that they sum to 1 (as with upscale = TRUE in the gMCP package).')
      : '';
    if (upscale && tt !== 'parametric') cite('gmcp');
    const upNote = upscale && exh === false ? ` The graph is not α-exhaustive, so rescaling changes the procedure: some intersection hypotheses are tested at the full α rather than at α times the sum of their weights${lowest ? `; for example, ${lowest.label} alone is tested at level ${a} rather than ${fmtNum(lowest.w * aNum, 6)}` : ''}. The procedure therefore does not keep the gatekeeping property that the graph suggests.` : '';
    let tech;
    if (tt === 'parametric') {
      tech = `Each intersection hypothesis H_J will be tested with the weighted parametric test of Xi et al. (2017, section 4.3, eq. 6).${scale} The hypotheses in J are split into blocks: the correlations are known within a block (Table [X.3]) and not between blocks. Within each block B, H_J is rejected if p_i ≤ c_{J,B} w_i(J) α for some i in B, where w_i(J) are the ${upscale ? 'rescaled ' : ''}weights and the constant c_{J,B} ≥ 1 is chosen so that, under H_J, this event has probability α times the sum of w_i(J) over B. The blocks are combined by the Bonferroni inequality, so H_J is tested at level ${upscale ? 'α' : 'α times the sum of its weights'}; because each block has its own constant, a block with one hypothesis has c = 1. This differs from the single common constant for all blocks of Bretz et al. (2011, eq. 3), used by the gMCP package. Within each block, the one-sided test statistics are assumed to be multivariate normal with the correlations in Table [X.3]; [the test statistics are z statistics / are treated as approximately normal]. Multivariate normal probabilities are computed by a randomised quasi-Monte Carlo lattice rule (Genz and Bretz, 2009) with a fixed random seed, so that results can be reproduced, and a reported Monte Carlo standard error.${upNote}`;
      cite('genz2009', 'gmcp');
    } else {
      const simesRule = 'p_j is at most α times the sum of w_k(J) over the hypotheses k in J with p_k ≤ p_j';
      const cond = `The weighted Simes test controls its level when the test statistics are positively regression dependent on the subset of true null hypotheses (PRDS; Bretz et al., 2011, section 3.3, citing Kling, 2005). This holds, for example, for one-sided tests whose statistics are multivariate normal with non-negative correlations (Benjamini and Yekutieli, 2001, section 3.1; Benjamini and Heller, 2007). For one-sided tests it may exceed its level under negative correlation (Samuel-Cahn, 1996).${two ? ' The p-values here are two-sided, so the condition concerns the absolute values of the test statistics. It holds for two normal statistics with any correlation (Samuel-Cahn, 1996) and for equicorrelated normal statistics (Sarkar, 1998, Proposition 3.2), but is not established for general correlation matrices.' : ''} The assumption is considered to hold here because [justification].`;
      if (two) cite('sarkar1998');
      cite('by2001', 'bheller2007', 'samuelcahn1996');
      if (tt === 'simes') {
        tech = `Each intersection hypothesis H_J will be tested with the weighted Simes test (Benjamini and Hochberg, 1997; Bretz et al., 2011, section 3.3, eqs. 5 and 6), using the weights w_j(J) derived from the graph.${scale} H_J is rejected if, for some j in J, ${simesRule}; ${upscale ? 'with rescaled weights this test has level α' : 'this test has level α times the sum of the weights'}. ${cond}${upNote}`;
      } else {
        tech = `Each intersection hypothesis H_J will be tested with the weighted Simes test when all of its hypotheses belong to the same group (${groups.length ? 'groups: ' + groups.join('; ') : '[no groups are defined]'}), and with the weighted Bonferroni test otherwise, as in the function simes.on.subsets.test of the gMCP package (Rohmeyer and Klinglmueller, 2024).${scale} The weighted Simes test rejects H_J if, for some j in J, ${simesRule}. This rule is more conservative than the Bonferroni mixture of weighted Simes tests of Bretz et al. (2011, eq. 8) and Lu (2016), which applies the Simes test within each group of an intersection. ${cond.replace('when the test statistics are', 'when the test statistics within each group are')}${upNote}`;
        cite('gmcp', 'lu2016');
      }
    }
    add('Technical details', tech);
  }

  /* Tables */
  const labels = G.nodes.map(n => n.label);
  const transRows = (nodes, edges, diag) => nodes.map(x => nodes.map(y => {
    if (x.id === y.id) return fmtW((diag && diag[x.id]) || Q.ZERO);
    const e = edges.find(z => z.from === x.id && z.to === y.id);
    return e ? (e.expr ? `${exprDisplay(e.expr)} = ${fmtW(e.g)}` : fmtW(e.g)) : '0';
  }));
  const wCell = n => (n.wexpr ? `${exprDisplay(n.wexpr)} = ${fmtW(n.w)}` : fmtW(n.w));
  if (ent) {
    const h1 = ['Hypothesis', 'Description', ...views.map((_, k) => `Initial weight in component graph ${k + 1} (c${k + 1} = ${cText(k)})`), 'Combined initial weight', closed ? `Combined weight × α (α = ${a})` : `Initial ${sided} level (α = ${a})`];
    if (groups.length) h1.push('Group');
    tables.push({ title: 'Table [X.1]. Hypotheses, initial weights in each component graph, combined weights and levels', header: h1, rows: G.nodes.map(n => { const cw = combW(n.id); const r = [n.label, n.desc || '[description]', ...views.map(v => wCell(v.nodes.find(x => x.id === n.id))), fmtW(cw), fmtNum(Q.toNum(cw) * aNum, 6)]; if (groups.length) r.push(n.group || ''); return r; }) });
    views.forEach((v, k) => { const rows = transRows(v.nodes, v.edges, null); tables.push({ title: `Table [X.2${nComp > 1 ? String.fromCharCode(97 + k) : ''}]. Transition weights of component graph ${k + 1} (c${k + 1} = ${cText(k)}; row: from, column: to)`, header: ['From \\ To', ...labels], rows: labels.map((l, i) => [l, ...rows[i]]) }); });
  } else {
    const rows = transRows(G.nodes, G.edges, G.diag);
    const h1 = ['Hypothesis', 'Description', 'Initial weight', closed ? `Initial weight × α (α = ${a})` : `Initial ${sided} level (α = ${a})`];
    if (groups.length) h1.push('Group');
    tables.push({ title: 'Table [X.1]. Hypotheses, initial weights and levels', header: h1, rows: G.nodes.map(n => { const r = [n.label, n.desc || '[description]', wCell(n), fmtNum(Q.toNum(n.w) * aNum, 6)]; if (groups.length) r.push(n.group || ''); return r; }) });
    tables.push({ title: 'Table [X.2]. Transition weights (row: from, column: to)', header: ['From \\ To', ...labels], rows: labels.map((l, i) => [l, ...rows[i]]) });
  }
  if (tt === 'parametric') {
    const corr = (G.test && G.test.corr) || {};
    const at = (i, j) => { if (i === j) return 1; const p = G.nodes[i].id, q = G.nodes[j].id; const v = corr[p < q ? p + '|' + q : q + '|' + p]; return v == null ? null : v; };
    let blockTxt = '';
    try { const B = corrBlocks(G.nodes.map((_, i) => i), at); blockTxt = B.map(b => '{' + b.map(i => labels[i]).join(', ') + '}').join(', '); } catch (e) { blockTxt = '[the correlations do not form complete blocks]'; }
    tables.push({ title: `Table [X.3]. Correlations between the test statistics under the null hypotheses (blank: unknown). Blocks: ${blockTxt}`, header: ['', ...labels], rows: labels.map((l, i) => [l, ...labels.map((_, j) => { const v = at(i, j); return v == null ? '' : String(v); })]) });
  }
  if (!ent && G.opt && G.opt.inputs && G.opt.inputs.corrMatrix) {
    const R = G.opt.inputs.corrMatrix, off = []; for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) off.push(R[i][j]);
    if (off.length && !off.every(v => Math.abs(v - off[0]) < 1e-12)) tables.push({ title: 'Table [X.4]. Correlations between the test statistics assumed for the gain-function optimisation', header: ['', ...labels], rows: labels.map((l, i) => [l, ...labels.map((_, j) => fmtNum(R[i][j], 4))]) });
  }
  refs.sort((x, y) => x.localeCompare(y));
  return { paragraphs: P, heads: H, tables, refs };
}
function tableToTSV(t) { return [t.title, t.header.join('\t'), ...t.rows.map(r => r.join('\t'))].join('\n'); }
function tableToHTML(t) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<p><b>${esc(t.title)}</b></p><table border="1" cellpadding="4" style="border-collapse:collapse"><tr>${t.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

/* =====================================================================
   CLOSED TESTING (Bretz et al., 2011): weighted Bonferroni, Simes and
   parametric tests for every intersection hypothesis.
   Subsets are bitmasks over hypothesis indices 0..m-1 (bit i set = H_i in J).
   ===================================================================== */
const TEST_TYPES = { bonferroni: 'Bonferroni', simes: 'Weighted Simes', 'simes-groups': 'Simes within groups', parametric: 'Parametric (correlated statistics)' };
function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

/* One rejection step on float arrays (same algorithm as rejectNode) */
function updateFloat(m, w, g, j) {
  const w2 = w.slice(), g2 = new Float64Array(m * m);
  const wj = w[j];
  for (let l = 0; l < m; l++) if (l !== j) w2[l] = w[l] + wj * g[j * m + l];
  w2[j] = 0;
  for (let l = 0; l < m; l++) {
    if (l === j) continue;
    const glj = g[l * m + j], den = 1 - glj * g[j * m + l];
    for (let k = 0; k < m; k++) {
      if (k === l || k === j) continue;
      g2[l * m + k] = den > 1e-12 ? (g[l * m + k] + glj * g[j * m + k]) / den : 0;
    }
  }
  return { w: w2, g: g2 };
}
/* Weights of every intersection hypothesis: W[mask * m + i] (generateWeights). m <= 12. */
function closureWeights(fg) {
  if (fg.comps) {
    /* Algorithm 2 of Maurer and Bretz (2013, p. 1745): v_i(J) = sum_h c_h w_hi(J), each component's closure
       weights from the ordinary generateWeights step */
    const m = fg.m, W = new Float64Array((1 << m) * m);
    fg.comps.forEach((cs, h) => { const Wh = closureWeights({ m, w: cs.w, g: cs.g }); for (let i = 0; i < W.length; i++) W[i] += fg.c[h] * Wh[i]; });
    return W;
  }
  const m = fg.m, full = (1 << m) - 1;
  const W = new Float64Array((1 << m) * m);
  const gs = new Map();
  W.set(fg.w, full * m); gs.set(full, fg.g);
  const masks = []; for (let k = 1; k <= full; k++) masks.push(k);
  masks.sort((a, b) => popcount(b) - popcount(a));
  for (const mask of masks) {
    if (mask === full) continue;
    let k = 0; while (mask & (1 << k) || !(full & (1 << k))) k++;
    const parent = mask | (1 << k);
    const r = updateFloat(m, W.subarray(parent * m, parent * m + m), gs.get(parent), k);
    W.set(r.w, mask * m); gs.set(mask, r.g);
  }
  return W;
}

/* ---- Standard normal and multivariate normal (Genz, randomised Richtmyer lattice) ---- */
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
/* P(Z_i < b_i for all i), Z ~ N(0, R), L = chol(R) lower: randomised quasi-Monte Carlo (Genz and Bretz, 2009,
   section 4.2.2): a Richtmyer lattice (square roots of primes) with the baker transform, averaged over nShift
   random shifts. Returns {p, se}, where se is the standard error across the shifts (Genz's error estimate). */
function mvnLowerSE(b, L, m, rand, nPts = 512, nShift = 6) {
  if (m === 1) return { p: pnormUpper(-b[0]), se: 0 };
  const sq = PRIMES.slice(0, m - 1).map(Math.sqrt);
  let total = 0, total2 = 0;
  const y = new Float64Array(m);
  for (let s = 0; s < nShift; s++) {
    const shift = Array.from({ length: m - 1 }, () => rand());
    let sum = 0;
    for (let k = 1; k <= nPts; k++) {
      let f = pnormUpper(-b[0] / L[0]);
      let e = f;
      for (let i = 1; i < m && f > 0; i++) {
        const u = (k * sq[i - 1] + shift[i - 1]) % 1;
        const ui = Math.abs(2 * u - 1); // antithetic fold
        y[i - 1] = qnorm(Math.max(1e-300, Math.min(1 - 1e-16, ui * e)));
        let t = b[i];
        for (let j = 0; j < i; j++) t -= L[i * m + j] * y[j];
        e = pnormUpper(-t / L[i * m + i]);
        f *= e;
      }
      sum += f;
    }
    const est = sum / nPts;
    total += est; total2 += est * est;
  }
  const p = total / nShift;
  const v = Math.max(0, total2 / nShift - p * p);
  return { p, se: nShift > 1 ? Math.sqrt(v / (nShift - 1)) : 0 };
}
function mvnLower(b, L, m, rand, nPts = 512, nShift = 6) { return mvnLowerSE(b, L, m, rand, nPts, nShift).p; }
/* Correlation blocks: connected components of known (non-null) correlations. Throws if a block is incomplete. */
function corrBlocks(idx, corrAt) {
  const n = idx.length, seen = new Array(n).fill(false), blocks = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const comp = [s]; seen[s] = true;
    for (let q = 0; q < comp.length; q++) for (let t = 0; t < n; t++) if (!seen[t] && corrAt(idx[comp[q]], idx[t]) != null) { seen[t] = true; comp.push(t); }
    for (const a of comp) for (const b of comp) if (a !== b && corrAt(idx[a], idx[b]) == null) throw new Error('The correlation matrix must be complete within each block of known correlations (if two statistics are each correlated with a third, their own correlation must be given too).');
    blocks.push(comp.map(q => idx[q]));
  }
  return blocks;
}
/* Smallest set of statistics whose correlations cannot all hold at once (null when the block is positive definite).
   Looks at pairs, then triples (blocks of up to 20), then gives the whole block. */
function corrConflict(block, corrAt) {
  const pd = s => { const n = s.length, R = new Float64Array(n * n); s.forEach((i, a) => s.forEach((j, c) => { R[a * n + c] = i === j ? 1 : corrAt(i, j); })); return !!cholesky(R, n); };
  const n = block.length;
  if (n < 2 || pd(block)) return null;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (!pd([block[a], block[b]])) return [block[a], block[b]];
  if (n <= 20) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) if (!pd([block[a], block[b], block[c]])) return [block[a], block[b], block[c]];
  return block.slice();
}
/* Plain-English message for a conflicting set of hypothesis labels */
function corrConflictText(labels, whole) {
  if (labels.length === 2) return `The correlation between ${labels[0]} and ${labels[1]} must lie strictly between −1 and 1.`;
  const list = labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
  return whole && labels.length > 3 ? 'These correlations cannot all hold at once, or they make one statistic an exact combination of the others, as for a full population, a subgroup and its complement (the matrix is not positive definite). Try values closer to 0, or leave one of them out.' : `The correlations between ${list} cannot all hold at once, or they make one statistic an exact combination of the others, as for a full population, a subgroup and its complement (the matrix is not positive definite). Try values closer to 0, or leave one of them out.`;
}
/* c such that P(some Z_i >= z_{1 - c w_i a}) = level, for a block with known correlation. Cached per call context. */
function paramConstant(block, w, a, level, cholL, rand, cache) {
  const m = block.length;
  if (m === 1) return 1;
  const wmax = Math.max(...w);
  if (!(wmax > 0)) return 1;
  const key = cache ? block.join(',') + '|' + w.map(x => x.toPrecision(6)).join(',') + '|' + a.toPrecision(6) + '|' + level.toPrecision(6) : null;
  if (cache && cache.has(key)) return cache.get(key);
  const prob = c => {
    const b = w.map(wi => (wi > 0 ? qnorm(1 - Math.min(1, c * wi * a)) : Infinity));
    return 1 - mvnLower(b, cholL, m, rand, 512, 4);
  };
  let lo = 1, hi = Math.min(1 / (wmax * a), 1e6), out;
  if (prob(lo) >= level) out = 1;
  else if (prob(hi) <= level) out = hi;
  else {
    for (let it = 0; it < 30; it++) {
      const mid = Math.sqrt(lo * hi);
      if (prob(mid) < level) lo = mid; else hi = mid;
      if (hi / lo < 1.0003) break;
    }
    out = Math.sqrt(lo * hi);
  }
  if (cache) cache.set(key, out);
  return out;
}
/* Adjusted p-value of one intersection hypothesis J (mask) */
function intersectionAdjP(mask, m, W, p, test, ctx) {
  const idx = []; for (let i = 0; i < m; i++) if (mask & (1 << i)) idx.push(i);
  let w = idx.map(i => W[mask * m + i]);
  const s = w.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return 1;
  if (ctx.upscale) w = w.map(x => x / s);
  const bonf = (ii, ww) => { let best = 1; ii.forEach((i, k) => { if (ww[k] > 0) best = Math.min(best, p[i] / ww[k]); }); return Math.min(1, best); };
  const simes = (ii, ww) => {
    const order = ii.map((i, k) => k).sort((a, b) => p[ii[a]] - p[ii[b]]);
    let cum = 0, best = 1;
    for (const k of order) { cum += ww[k]; if (cum > 0) best = Math.min(best, p[ii[k]] / cum); }
    return Math.min(1, best);
  };
  if (test === 'bonferroni') return bonf(idx, w);
  if (test === 'simes') return simes(idx, w);
  if (test === 'simes-groups') {
    const inOne = ctx.groups.some(gset => idx.every(i => gset.has(i)));
    return inOne ? simes(idx, w) : bonf(idx, w);
  }
  if (test === 'parametric') {
    const blocks = corrBlocks(idx, ctx.corrAt);
    if (blocks.every(b => b.length === 1)) return bonf(idx, w);
    const wOf = i => w[idx.indexOf(i)];
    const chols = blocks.map(b => {
      if (b.length === 1) return null;
      const R = new Float64Array(b.length * b.length);
      b.forEach((i, a) => b.forEach((j, c) => { R[a * b.length + c] = i === j ? 1 : ctx.corrAt(i, j); }));
      const L = cholesky(R, b.length);
      if (!L) throw new Error('The correlation matrix is not positive definite.');
      return L;
    });
    /* Xi, Glimm, Maurer and Bretz (2017), eq. (2) and (7): for each block B with weights w_i (summing to s_B) and
       q_B = min_i p_i / w_i, the p-value of H_J restricted to B is min(1, P_H(min_i P_i / w_i <= q_B) / s_B), where
       P(min_i P_i / w_i <= q) = 1 - P(Z_i < z_{1 - q w_i} for all i in B). The p-value of H_J is the minimum over
       blocks (Bonferroni between blocks). This is the smallest a at which p_i <= c_B(a) w_i a for some i in B, with
       c_B(a) the constant of the weighted parametric test at level a s_B. One MVN probability per block, with the
       Monte Carlo standard error from the random shifts recorded in ctx.se (largest over all intersections). */
    let best = 1;
    blocks.forEach((b, k) => {
      const wb = b.map(wOf), sb = wb.reduce((x, y) => x + y, 0);
      if (!(sb > 0)) return;
      const q = Math.min(...b.map((i, j) => (wb[j] > 0 ? p[i] / wb[j] : Infinity)));
      let a;
      if (b.length === 1 || !(q < 1 / Math.max(...wb))) a = Math.min(1, q);
      else {
        const bnd = wb.map(wi => (wi > 0 ? qnorm(1 - Math.min(1, q * wi)) : Infinity));
        const r = mvnLowerSE(bnd, chols[k], b.length, ctx.rand, 512, 12);
        /* Exact bounds: q w_max / s_B <= p_B <= q (Bonferroni inequality), so Monte Carlo noise never makes the
           parametric test look weaker than Bonferroni or stronger than a single test. */
        a = Math.min(1, Math.max(q * Math.max(...wb) / sb, Math.min(q, (1 - r.p) / sb)));
        const se = r.se / sb;
        if (ctx && (ctx.se == null || se > ctx.se)) ctx.se = se;
      }
      best = Math.min(best, a);
    });
    return best;
  }
  throw new Error('Unknown test ' + test);
}
/* Full closed test. Returns {adj: adjusted p per hypothesis, subsets: [{mask, w, adjP}], rejected} */
function closedTest(fg, p, alpha, test, ctx) {
  const m = fg.m;
  if (m > 12) throw new Error('The closed test is available for up to 12 hypotheses.');
  const W = closureWeights(fg);
  const full = (1 << m) - 1;
  const subsets = [];
  const adj = new Array(m).fill(0);
  if (ctx) ctx.se = null;
  for (let mask = 1; mask <= full; mask++) {
    const a = intersectionAdjP(mask, m, W, p, test, ctx);
    subsets.push({ mask, w: Array.from(W.subarray(mask * m, mask * m + m)), adjP: a });
    for (let i = 0; i < m; i++) if (mask & (1 << i)) adj[i] = Math.max(adj[i], a);
  }
  return { adj, subsets, rejected: adj.map(a => a <= alpha * (1 + 1e-9)), W, se: ctx ? ctx.se : null };
}
/* Rejection constants for the parametric test at level alpha (generateBounds): c per block of each subset */
function closedTestCritical(fg, alpha, test, ctx) {
  const m = fg.m, W = closureWeights(fg), full = (1 << m) - 1;
  const crit = []; // per mask: array of {idx:[i], c}
  for (let mask = 1; mask <= full; mask++) {
    const idx = []; for (let i = 0; i < m; i++) if (mask & (1 << i)) idx.push(i);
    let w = idx.map(i => W[mask * m + i]);
    const s = w.reduce((a, b) => a + b, 0);
    if (ctx.upscale && s > 0) w = w.map(x => x / s);
    const wOf = i => w[idx.indexOf(i)];
    let entry = { idx, w, blocks: null };
    if (test === 'parametric' && s > 0) {
      const blocks = corrBlocks(idx, ctx.corrAt);
      entry.blocks = blocks.map(b => {
        const wb = b.map(wOf), sb = wb.reduce((x, y) => x + y, 0);
        if (b.length === 1 || !(sb > 0)) return { b, c: 1 };
        const R = new Float64Array(b.length * b.length);
        b.forEach((i, a) => b.forEach((j, q) => { R[a * b.length + q] = i === j ? 1 : ctx.corrAt(i, j); }));
        const L = cholesky(R, b.length);
        if (!L) throw new Error('The correlation matrix is not positive definite.');
        return { b, c: paramConstant(b, wb, alpha, alpha * sb, L, ctx.rand, ctx.cache) };
      });
    }
    crit[mask] = entry;
  }
  return { W, crit };
}
/* Closed test on one p-value vector using precomputed constants (fast path for power simulation) */
function closedTestFast(m, crit, p, alpha, test, ctx, out) {
  const full = (1 << m) - 1;
  const rejJ = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const e = crit[mask];
    let rej = false;
    if (test === 'parametric' && e.blocks) {
      for (const blk of e.blocks) { for (const i of blk.b) { const wi = e.w[e.idx.indexOf(i)]; if (wi > 0 && p[i] <= blk.c * wi * alpha) { rej = true; break; } } if (rej) break; }
    } else if (test === 'simes' || (test === 'simes-groups' && ctx.groups.some(gset => e.idx.every(i => gset.has(i))))) {
      const order = e.idx.map((i, k) => k).sort((a, b) => p[e.idx[a]] - p[e.idx[b]]);
      let cum = 0;
      for (const k of order) { cum += e.w[k]; if (cum > 0 && p[e.idx[k]] <= cum * alpha) { rej = true; break; } }
    } else {
      for (let k = 0; k < e.idx.length; k++) if (e.w[k] > 0 && p[e.idx[k]] <= e.w[k] * alpha) { rej = true; break; }
    }
    rejJ[mask] = rej ? 1 : 0;
  }
  for (let i = 0; i < m; i++) {
    let all = 1;
    for (let mask = 1; mask <= full && all; mask++) if ((mask & (1 << i)) && !rejJ[mask]) all = 0;
    out[i] = all;
  }
}
/* Self-tests for the closed test */
function runClosureSelfTests() {
  const res = [];
  const check = (name, fn) => { try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); } catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); } };
  const holm = m => { const G = deserializeGraph(generatedTemplate('holm', m), false, 1).G; return floatGraph(G); };
  const ctxB = { upscale: false };
  check('Closed Bonferroni test equals the shortcut on Holm (gMCP example: adjusted p = 0.05, 0.08, 0.12, 0.12, 0.7)', () => {
    const r = closedTest(holm(5), [0.01, 0.02, 0.04, 0.04, 0.7], 0.05, 'bonferroni', ctxB);
    const want = [0.05, 0.08, 0.12, 0.12, 0.7];
    return r.adj.every((a, i) => Math.abs(a - want[i]) < 1e-12) || 'got ' + r.adj.map(x => x.toFixed(4)).join(', ');
  });
  check('Closed Bonferroni test matches the shortcut on 200 random graphs and p-value sets', () => {
    let seed = 77; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 200; k++) {
      const m = 2 + (k % 4), o = generatedTemplate('holm', m);
      o.nodes.forEach(n => { n.weight = String(Math.floor(rnd() * 3)); });
      const tot = o.nodes.reduce((a, n) => a + +n.weight, 0) || 1; o.nodes.forEach(n => { n.weight = `${n.weight}/${tot}`; });
      o.edges = []; for (let i = 0; i < m; i++) { const raw = Array.from({ length: m }, (_, j) => (i === j ? 0 : Math.floor(rnd() * 3))); const rs = raw.reduce((a, b) => a + b, 0); raw.forEach((v, j) => { if (v) o.edges.push({ from: String(i), to: String(j), weight: `${v}/${rs}` }); }); }
      const G = deserializeGraph(o, false, 1).G, p = G.nodes.map(() => rnd() * 0.08);
      const sc = new Set(runProcedure(stateFromGraph(G), id => p[G.nodes.findIndex(n => n.id === id)], 0.05).order);
      const ct = closedTest(floatGraph(G), p, 0.05, 'bonferroni', ctxB);
      if (G.nodes.some((n, i) => sc.has(n.id) !== ct.rejected[i])) return 'mismatch at graph ' + k;
    }
    return true;
  });
  check('Weighted Simes on Holm (Hommel procedure): p = (0.01, 0.02, 0.04, 0.04, 0.7) rejects H1 only, adjusted p(H1) = 0.05', () => {
    const r = closedTest(holm(5), [0.01, 0.02, 0.04, 0.04, 0.7], 0.05, 'simes', ctxB);
    return (r.rejected.join() === 'true,false,false,false,false' && Math.abs(r.adj[0] - 0.05) < 1e-12) || 'got ' + r.rejected.join() + ' adj ' + r.adj[0];
  });
  check('Weighted Simes, two hypotheses: p = (0.03, 0.04), weights 1/2: both rejected at 0.05 (Bonferroni rejects neither)', () => {
    const G = deserializeGraph(generatedTemplate('holm', 2), false, 1).G;
    const rs = closedTest(floatGraph(G), [0.03, 0.04], 0.05, 'simes', ctxB), rb = closedTest(floatGraph(G), [0.03, 0.04], 0.05, 'bonferroni', ctxB);
    return (rs.rejected.every(Boolean) && !rb.rejected.some(Boolean)) || 'simes ' + rs.rejected.join() + ' bonf ' + rb.rejected.join();
  });
  check('Simes adjusted p-values are never larger than Bonferroni ones (100 random sets)', () => {
    let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 100; k++) {
      const p = Array.from({ length: 4 }, () => rnd() * 0.2);
      const a = closedTest(holm(4), p, 0.05, 'bonferroni', ctxB).adj, b = closedTest(holm(4), p, 0.05, 'simes', ctxB).adj;
      if (b.some((x, i) => x > a[i] + 1e-12)) return 'Simes larger at set ' + k;
    }
    return true;
  });
  check('Bivariate normal probability: P(Z1 < 1.96, Z2 < 1.96) with rho = 0.5 is 0.95462 (within 0.001)', () => {
    const L = cholesky(Float64Array.of(1, 0.5, 0.5, 1), 2);
    const v = mvnLower([1.959964, 1.959964], L, 2, mulberry32(1));
    return Math.abs(v - 0.954622) < 0.001 || 'got ' + v.toFixed(5);
  });
  check('Parametric constant for two statistics with rho = 0.5, weights 1/2, alpha 0.05: c = 1.1065 (within 0.01)', () => {
    const L = cholesky(Float64Array.of(1, 0.5, 0.5, 1), 2);
    const c = paramConstant([0, 1], [0.5, 0.5], 0.05, 0.05, L, mulberry32(2));
    return Math.abs(c - 1.1065) < 0.01 || 'got ' + c.toFixed(4);
  });
  check('Parametric constant: two independent statistics with weights 1/2 give c = 1.0127 (Dunnett-type), within 0.005', () => {
    const L = cholesky(Float64Array.of(1, 0, 0, 1), 2);
    const c = paramConstant([0, 1], [0.5, 0.5], 0.05, 0.05, L, mulberry32(2));
    /* exact: 1 - (1 - 0.025 c)^2 = 0.05 -> c = (1 - sqrt(0.95)) / 0.025 = 1.01268 */
    return Math.abs(c - 1.01268) < 0.005 || 'got ' + c.toFixed(4);
  });
  check('Parametric test with all correlations unknown equals Bonferroni', () => {
    const p = [0.012, 0.03, 0.009, 0.02];
    const a = closedTest(holm(4), p, 0.05, 'bonferroni', ctxB).adj;
    const b = closedTest(holm(4), p, 0.05, 'parametric', { upscale: false, corrAt: () => null, rand: mulberry32(3) }).adj;
    return a.every((x, i) => Math.abs(x - b[i]) < 1e-12) || 'differ';
  });
  check('Parametric test with rho = 0.9 everywhere rejects at least what Bonferroni does and no more than the single-step bound', () => {
    const p = [0.02, 0.03, 0.009, 0.02];
    const a = closedTest(holm(4), p, 0.05, 'bonferroni', ctxB).adj;
    const b = closedTest(holm(4), p, 0.05, 'parametric', { upscale: false, corrAt: () => 0.9, rand: mulberry32(4) }).adj;
    if (b.some((x, i) => x > a[i] + 1e-3)) return 'parametric larger than Bonferroni';
    if (b.some((x, i) => x < p[i] - 1e-9)) return 'adjusted p below raw p';
    return true;
  });
  return res;
}

/* ---------- Self-tests against worked examples in the literature ---------- */
function runLiteratureSelfTests() {
  const res = [];
  const check = (name, fn) => { try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); } catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); } };
  const load = o => deserializeGraph(o, false, 1).G;
  const pOfG = (G, p) => id => p[G.nodes.findIndex(n => n.id === id)];
  const labels = (G, ids) => ids.map(id => G.nodes.find(n => n.id === id).label).sort().join(',');
  check('Bretz et al. (2009) Fig. 4: Holm(3), alpha 0.05, p = (0.02, 0.055, 0.012) gives adjusted p = (0.04, 0.055, 0.036)', () => {
    const G = load(generatedTemplate('holm', 3)), adj = adjustedPValues(stateFromGraph(G), pOfG(G, [0.02, 0.055, 0.012]));
    const got = G.nodes.map(n => adj.get(n.id)), want = [0.04, 0.055, 0.036];
    return got.every((x, i) => Math.abs(x - want[i]) < 1e-9) || 'got ' + got.map(x => x.toFixed(4)).join(', ');
  });
  check('Bretz et al. (2009) section 3.3: improved parallel gatekeeping, alpha 0.05, p = (0.02, 0.04, 0.01, 0.015) rejects all four; plain gatekeeping rejects three', () => {
    const Gi = load(templateJSON('improvedParallel')), Gp = load(templateJSON('parallel'));
    const ri = runProcedure(stateFromGraph(Gi), pOfG(Gi, [0.02, 0.04, 0.01, 0.015]), 0.05).order.length;
    const rp = labels(Gp, runProcedure(stateFromGraph(Gp), pOfG(Gp, [0.02, 0.04, 0.01, 0.015]), 0.05).order);
    return (ri === 4 && rp === 'H1,H3,H4') || `improved ${ri}, plain ${rp}`;
  });
  check('Bretz, Maurer and Hommel (2011) section 3.3: three-dose template, alpha 0.025, p = (0.1, 0.008, 0.005, 0.15, 0.04, 0.006) rejects H21, H31, H32', () => {
    const G = load(templateJSON('bretz2011'));
    const r = labels(G, runProcedure(stateFromGraph(G), pOfG(G, [0.1, 0.008, 0.005, 0.15, 0.04, 0.006]), 0.025).order);
    return r === 'H21,H31,H32' || 'rejected ' + r;
  });
  check('Wiens and Dmitrienko (2005) section 3.2: improved fallback I returns H3\'s level to H1 and H2 in proportion (1/2 each with equal weights)', () => {
    const G = load(templateJSON('improvedFallbackI')), s2 = rejectNode(stateFromGraph(G), G.nodes[2].id);
    const got = [Q.exact(s2.w.get(G.nodes[0].id)), Q.exact(s2.w.get(G.nodes[1].id))].join(' ');
    return got === '1/2 1/2' || 'got ' + got;
  });
  check('Wiens and Dmitrienko (2005) Table 1, p. 934 (alpha-exhaustive version) and Guilbaud (2018) Example 6, p. 225: improved fallback I for any m built from weights (1/2, 3/10, 1/5) has return transitions 5/8, 3/8 and gives the intersection {H1, H2} the weights (5/8, 3/8); the graph is alpha-exhaustive, and the three-node template with the same weights gives (3/5, 2/5) instead', () => {
    const w = parseWeightList('1/2, 3/10, 1/5'), o = generatedTemplate('improvedFallbackI', 3, w);
    const ret = o.edges.filter(e => e.from === '2').map(e => e.to + ':' + e.weight).join(' ');
    if (ret !== '0:5/8 1:3/8') return 'return transitions ' + ret;
    const G = load(o), s2 = rejectNode(stateFromGraph(G), G.nodes[2].id);
    const got = [Q.exact(s2.w.get(G.nodes[0].id)), Q.exact(s2.w.get(G.nodes[1].id))].join(' ');
    if (got !== '5/8 3/8') return 'generated {H1, H2} ' + got;
    if (isAlphaExhaustive(G) !== true) return 'generated graph not alpha-exhaustive';
    const t = templateJSON('improvedFallbackI'); t.nodes[0].weight = '1/2'; t.nodes[1].weight = '3/10'; t.nodes[2].weight = '1/5';
    const G2 = load(t), s3 = rejectNode(stateFromGraph(G2), G2.nodes[2].id);
    const got2 = [Q.exact(s3.w.get(G2.nodes[0].id)), Q.exact(s3.w.get(G2.nodes[1].id))].join(' ');
    if (got2 !== '3/5 2/5') return 'three-node template {H1, H2} ' + got2;
    /* five hypotheses: the same rule as graphicalMCP fallback_improved_1 (R/example_graphs.R), w_i / (w_1 + ... + w_4) */
    const o5 = generatedTemplate('improvedFallbackI', 5, parseWeightList('2/5, 1/4, 1/4, 1/20, 1/20'));
    const ret5 = o5.edges.filter(e => e.from === '4').map(e => e.weight).join(' ');
    return ret5 === '8/19 5/19 5/19 1/19' || 'm = 5 return transitions ' + ret5;
  });
  check('Wiens and Dmitrienko (2005) Example 1: fallback(2) with weights 0.8, 0.2 at alpha 0.05, p = (0.044, 0.003): plain fallback rejects H2 only, alpha-exhaustive fallback rejects both', () => {
    const plain = { ids: ['a', 'b'], w: new Map([['a', Q.parse('4/5')], ['b', Q.parse('1/5')]]), g: new Map([[gKey('a', 'b'), Q.ONE]]) };
    const impr = { ids: ['a', 'b'], w: new Map([['a', Q.parse('4/5')], ['b', Q.parse('1/5')]]), g: new Map([[gKey('a', 'b'), Q.ONE], [gKey('b', 'a'), Q.ONE]]) };
    const pf = id => ({ a: 0.044, b: 0.003 })[id];
    const r1 = runProcedure(plain, pf, 0.05).order.join(), r2 = runProcedure(impr, pf, 0.05).order.sort().join();
    return (r1 === 'b' && r2 === 'a,b') || `plain ${r1}, improved ${r2}`;
  });
  check('Hommel and Bretz (2008) section 4, Table 1 (p. 662) and the numerical example (p. 662): fallback(3) with weights 1/3 has the printed intersection weights for all seven index sets ({1,2}, {1} and {2} not exhausting alpha); improved fallback I has them divided by their sum (the Wiens and Dmitrienko improvement, WD); alpha 0.05, p = (0.02, 0.015, 0.06) rejects H2 only and p = (0.06, 0.015, 0.02) rejects H2 and H3 for both, while Holm rejects two in both; for n = 2 (pp. 661 to 662) fallback(2) with w = (1/2, 1/2), p = (0.04, 0.02) rejects H2 only and weighted Holm (= WD) both', () => {
    const Gf = load(templateJSON('fallback')), Gi = load(templateJSON('improvedFallbackI'));
    /* the weights of an index set are the state after rejecting the hypotheses outside it; exact rationals */
    const wOf = (G, keep) => { let st = stateFromGraph(G); G.nodes.forEach((n, i) => { if (!keep.includes(i)) st = rejectNode(st, n.id); }); return keep.map(i => Q.exact(st.w.get(G.nodes[i].id))).join(' '); };
    /* Table 1 with w1 = w2 = w3 = 1/3: index set -> weights of its members in order */
    const table = [[[0, 1, 2], '1/3 1/3 1/3'], [[0, 1], '1/3 1/3'], [[0, 2], '1/3 2/3'], [[1, 2], '2/3 1/3'], [[0], '1/3'], [[1], '2/3'], [[2], '1']];
    for (const [keep, want] of table) { const got = wOf(Gf, keep); if (got !== want) return `fallback {${keep.map(i => i + 1).join(',')}}: ${got}, Table 1 ${want}`; }
    /* WD: each row of Table 1 divided by its sum */
    const wd = [[[0, 1, 2], '1/3 1/3 1/3'], [[0, 1], '1/2 1/2'], [[0, 2], '1/3 2/3'], [[1, 2], '2/3 1/3'], [[0], '1'], [[1], '1'], [[2], '1']];
    for (const [keep, want] of wd) { const got = wOf(Gi, keep); if (got !== want) return `WD {${keep.map(i => i + 1).join(',')}}: ${got}, want ${want}`; }
    if (isAlphaExhaustive(Gf) === true || isAlphaExhaustive(Gi) !== true) return 'exhaustiveness: fallback ' + isAlphaExhaustive(Gf) + ', WD ' + isAlphaExhaustive(Gi);
    /* the numerical example: p(1) = 0.015 is p2; p2 < p1 < p3, then p2 < p3 < p1 */
    const Gh = load(generatedTemplate('holm', 3));
    for (const [p, want] of [[[0.02, 0.015, 0.06], 'H2'], [[0.06, 0.015, 0.02], 'H2,H3']]) {
      const rf = labels(Gf, runProcedure(stateFromGraph(Gf), pOfG(Gf, p), 0.05).order);
      const ri = labels(Gi, runProcedure(stateFromGraph(Gi), pOfG(Gi, p), 0.05).order);
      const ci = closedTest(floatGraph(Gi), p, 0.05, 'bonferroni', { upscale: false }).rejected.map((r, i) => r ? Gi.nodes[i].label : '').filter(Boolean).sort().join(',');
      const rh = runProcedure(stateFromGraph(Gh), pOfG(Gh, p), 0.05).order.length;
      if (rf !== want || ri !== want || ci !== want || rh !== 2) return `p = (${p.join(', ')}): fallback ${rf}, WD ${ri}, WD closed ${ci}, Holm rejects ${rh}`;
    }
    /* n = 2: weighted Holm rejects H1 when p2 <= w2 alpha and w1 alpha < p1 <= alpha; the fallback does not */
    const f2 = load(generatedTemplate('fallback', 2)), h2 = load(generatedTemplate('holm', 2));
    const r2f = labels(f2, runProcedure(stateFromGraph(f2), pOfG(f2, [0.04, 0.02]), 0.05).order), r2h = labels(h2, runProcedure(stateFromGraph(h2), pOfG(h2, [0.04, 0.02]), 0.05).order);
    return (r2f === 'H2' && r2h === 'H1,H2') || `n = 2: fallback ${r2f}, weighted Holm ${r2h}`;
  });
  check('Bretz et al. (2009) Fig. 11: improved fallback II passes H2\'s level to H1 first, and H3 gets everything once H1 and H2 are both rejected', () => {
    const G = load(templateJSON('improvedFallbackII')), [h1, h2, h3] = G.nodes.map(n => n.id);
    const s2 = rejectNode(stateFromGraph(G), h2), s3 = rejectNode(s2, h1);
    const w1 = Q.exact(s2.w.get(h1)), w3 = Q.exact(s2.w.get(h3)), e13 = Q.exact(getg(s2, h1, h3)), w3b = Q.exact(s3.w.get(h3));
    return (w1 === '1999/3000' && w3 === '1001/3000' && e13 === '1' && w3b === '1') || `got w1 ${w1}, w3 ${w3}, H1 to H3 ${e13}, then w3 ${w3b}`;
  });
  check('Hommel et al. (2007) Remark 3: Holm(3) with Simes, alpha 0.05, p = (0.03, 0.03, 0.9): the global intersection is rejected but no elementary hypothesis', () => {
    const G = load(generatedTemplate('holm', 3));
    const r = closedTest(floatGraph(G), [0.03, 0.03, 0.9], 0.05, 'simes', { upscale: false });
    const global = r.subsets.find(x => x.mask === 7).adjP;
    return (global <= 0.05 && r.rejected.every(x => !x)) || `global ${global}, rejected ${r.rejected.join()}`;
  });
  check('Bretz et al. (2011) Example 2 and section 4.2: parametric test with rho = 0.5 in {H1, H2} and {H3, H4}, alpha 0.025, p = (0.0131, 0.1, 0.012, 0.01): rejects H1 and H3, adjusted p(H1) = 0.02431856 (within 0.0005)', () => {
    const G = load(templateJSON('successiveI'));
    const corrAt = (i, j) => ((i < 2) === (j < 2) ? 0.5 : null);
    const r = closedTest(floatGraph(G), [0.0131, 0.1, 0.012, 0.01], 0.025, 'parametric', { upscale: false, corrAt, rand: mulberry32(2011), cache: new Map() });
    if (r.rejected.join() !== 'true,false,true,false') return 'rejected ' + r.rejected.join();
    return Math.abs(r.adj[0] - 0.02431856) < 5e-4 || 'adjusted p(H1) = ' + r.adj[0].toFixed(5);
  });
  check('Bretz et al. (2009) Fig. 9, pp. 596-597: Holm with an ε edge to H3, alpha 0.05, p = (0.04, 0.01, 0.03): rejects H2, H1, H3 in that order; after H2 the edge H1 to H3 is exactly 1', () => {
    const e = Q.parse('1/1000'), h = Q.parse('1/2');
    const s = { ids: ['1', '2', '3'], w: new Map([['1', h], ['2', h], ['3', Q.ZERO]]), g: new Map([[gKey('1', '2'), Q.ONE], [gKey('2', '1'), Q.sub(Q.ONE, e)], [gKey('2', '3'), e]]) };
    const p = { 1: 0.04, 2: 0.01, 3: 0.03 }, order = runProcedure(s, id => p[id], 0.05).order.join(), e13 = Q.exact(getg(rejectNode(s, '2'), '1', '3'));
    return (order === '2,1,3' && e13 === '1') || `order ${order}, H1 to H3 ${e13}`;
  });
  check('Bretz et al. (2009) Fig. 10, p. 597: two Holm pairs joined by ε edges (r = 0.8, 0.2), alpha 0.05, p = (0.04, 0.01, 0.03, 0.04): after H2 the edge H1 to H3 is 0.8; after H1, H3 and H4 get levels 0.04 and 0.01; all four rejected', () => {
    const e = Q.parse('1/1000'), h = Q.parse('1/2'), r1 = Q.parse('4/5'), r2 = Q.parse('1/5');
    const s = { ids: ['1', '2', '3', '4'], w: new Map([['1', h], ['2', h], ['3', Q.ZERO], ['4', Q.ZERO]]), g: new Map([[gKey('1', '2'), Q.ONE], [gKey('2', '1'), Q.sub(Q.ONE, e)], [gKey('2', '3'), Q.mul(r1, e)], [gKey('2', '4'), Q.mul(r2, e)], [gKey('3', '4'), Q.ONE], [gKey('4', '3'), Q.ONE]]) };
    const p = { 1: 0.04, 2: 0.01, 3: 0.03, 4: 0.04 }, n = runProcedure(s, id => p[id], 0.05).order.length;
    const s2 = rejectNode(s, '2'), s3 = rejectNode(s2, '1');
    const got = [Q.exact(getg(s2, '1', '3')), Q.toNum(s3.w.get('3')) * 0.05, Q.toNum(s3.w.get('4')) * 0.05];
    return (n === 4 && got[0] === '4/5' && Math.abs(got[1] - 0.04) < 1e-12 && Math.abs(got[2] - 0.01) < 1e-12) || `rejected ${n}, H1 to H3 ${got[0]}, levels ${got[1]}, ${got[2]}`;
  });
  check('Bretz et al. (2011) Example 1 and Table 1, pp. 897-898: the weights of all 15 intersection hypotheses', () => {
    const G = load(templateJSON('successiveI')), W = closureWeights(floatGraph(G));
    /* Table 1, rows as H1 H2 H3 H4 ('-' = not in the intersection) */
    const T = ['.5 .5 0 0', '.5 .5 0 -', '.5 .5 - 0', '.5 .5 - -', '.5 - 0 .5', '1 - 0 -', '.5 - - .5', '1 - - -', '- .5 .5 0', '- .5 .5 -', '- 1 - 0', '- 1 - -', '- - .5 .5', '- - 1 -', '- - - 1'];
    const bad = [];
    for (const row of T) {
      const v = row.split(' '), mask = v.reduce((a, x, i) => (x === '-' ? a : a | (1 << i)), 0);
      v.forEach((x, i) => { if (x !== '-' && Math.abs(W[mask * 4 + i] - Number(x)) > 1e-12) bad.push(`row ${row}: H${i + 1} ${W[mask * 4 + i]}`); });
    }
    return !bad.length || bad.join('; ');
  });
  check('Bretz et al. (2011) section 3.1, p. 899 (Fig. 3): same graph, alpha 0.025, p = (0.01, 0.005, 0.1, 0.5): rejects H1 and H2 only', () => {
    const G = load(templateJSON('successiveI')), r = labels(G, runProcedure(stateFromGraph(G), pOfG(G, [0.01, 0.005, 0.1, 0.5]), 0.025).order);
    return r === 'H1,H2' || 'rejected ' + r;
  });
  check('Bretz et al. (2011) section 3.3, p. 907: same graph, alpha 0.025, p = (0.01, 0.005, 0.015, 0.022): closed Simes rejects all four, closed Bonferroni only H1 and H2', () => {
    const fg = floatGraph(load(templateJSON('successiveI'))), p = [0.01, 0.005, 0.015, 0.022];
    const s = closedTest(fg, p, 0.025, 'simes', { upscale: false }).rejected.join(), b = closedTest(fg, p, 0.025, 'bonferroni', { upscale: false }).rejected.join();
    return (s === 'true,true,true,true' && b === 'true,true,false,false') || `Simes ${s}; Bonferroni ${b}`;
  });
  check('Bretz et al. (2011) section 3.2, p. 903, and the gMCP parametric vignette: c = 1.0783 for two statistics with rho = 0.5, weights 1/2, alpha 0.025 (within 0.003; Monte Carlo)', () => {
    const c = paramConstant([0, 1], [0.5, 0.5], 0.025, 0.025, cholesky(Float64Array.of(1, 0.5, 0.5, 1), 2), mulberry32(2011));
    return Math.abs(c - 1.078306) < 0.003 || 'got ' + c.toFixed(4);
  });
  check('Bretz et al. (2011) section 4.1, p. 908: truncated Holm with gamma 1/2, alpha 0.05, p = (0.0121, 0.0337, 0.0084, 0.0160): adjusted p = 0.024, 0.045, 0.045, 0.045 (to 3 decimal places)', () => {
    const o = truncatedHolmTemplate(); o.vars = { 'γ': '1/2' };
    const G = load(o), adj = adjustedPValues(stateFromGraph(G), pOfG(G, [0.0121, 0.0337, 0.0084, 0.0160]));
    const got = G.nodes.map(n => adj.get(n.id).toFixed(3)).join(' ');
    return got === '0.024 0.045 0.045 0.045' || 'got ' + got;
  });
  check('Bretz, Maurer and Hommel (2011) section 3.3, p. 1495, and Appendix: after rejecting H31, H21 and H32, H11 and H22 are left at levels 2α/3 and α/3, with the final edges of the paper\'s SAS output', () => {
    const G = load(templateJSON('bretz2011')), id = l => G.nodes.find(n => n.label === l).id;
    let st = stateFromGraph(G);
    for (const l of ['H31', 'H21', 'H32']) st = rejectNode(st, id(l));
    const got = [Q.exact(st.w.get(id('H11'))), Q.exact(st.w.get(id('H22'))), Q.exact(st.w.get(id('H12'))), ...[['H11', 'H12'], ['H11', 'H22'], ['H12', 'H11'], ['H12', 'H22'], ['H22', 'H11']].map(([a, b]) => Q.exact(getg(st, id(a), id(b))))].join(' ');
    return got === '2/3 1/3 0 2/3 1/3 1/2 1/2 1' || 'got ' + got;
  });
  check('gMCP vignette "Weighted parametric tests defined by graphs", pp. 6-7: z = (2.24, 2.24, 2.24, 2.3): Bonferroni adjusted p = 0.02509 for all four; at alpha 0.025 Bonferroni rejects none, the parametric test (rho = 0.5 within each endpoint) rejects H1 only', () => {
    const G = load(templateJSON('successiveI')), fg = floatGraph(G), p = [2.24, 2.24, 2.24, 2.3].map(pnormUpper);
    const adj = adjustedPValues(stateFromGraph(G), pOfG(G, p)), a = G.nodes.map(n => adj.get(n.id).toFixed(5)).join(' ');
    const b = closedTest(fg, p, 0.025, 'bonferroni', { upscale: false }).rejected.join();
    const corrAt = (i, j) => ((i < 2) === (j < 2) ? 0.5 : null);
    const r = closedTest(fg, p, 0.025, 'parametric', { upscale: false, corrAt, rand: mulberry32(2011), cache: new Map() }).rejected.join();
    return (a === '0.02509 0.02509 0.02509 0.02509' && b === 'false,false,false,false' && r === 'true,false,false,false') || `adjusted ${a}; Bonferroni ${b}; parametric ${r}`;
  });
  check('graphicalMCP vignette "Graphical multiple comparison procedures based on the closure principle": six hypotheses, alpha 0.025: Bonferroni adjusted p = (0.026, 0.026, 0.028, 0.028, 0.1, 0.028), none rejected; parametric on H1, H2 (rho = 0.5) rejects H1 and H2, adjusted p 0.02413846 (within 0.0005)', () => {
    const T = [[0, '1/2', '1/4', 0, '1/4', 0], ['1/2', 0, 0, '1/4', 0, '1/4'], [0, 0, 0, 0, '1', 0], ['0.00001', 0, 0, 0, 0, '0.99999'], [0, '0.00001', '0.99999', 0, 0, 0], [0, 0, 0, '1', 0, 0]];
    const o = { format: 'multiplicity-graph', alpha: 0.025, nodes: ['1/2', '1/2', '0', '0', '0', '0'].map((w, i) => ({ id: String(i), label: 'H' + (i + 1), weight: w, x: i * 60, y: 0, p: '' })), edges: [] };
    T.forEach((row, i) => row.forEach((v, j) => { if (v !== 0) o.edges.push({ from: String(i), to: String(j), weight: v }); }));
    const fg = floatGraph(load(o)), p = [0.015, 0.013, 0.01, 0.007, 0.1, 0.0124];
    const b = closedTest(fg, p, 0.025, 'bonferroni', { upscale: false }), ba = b.adj.map(x => x.toFixed(3)).join(' ');
    const corrAt = (i, j) => (i < 2 && j < 2 ? 0.5 : null);
    const r = closedTest(fg, p, 0.025, 'parametric', { upscale: false, corrAt, rand: mulberry32(2011), cache: new Map() });
    const ok = ba === '0.026 0.026 0.028 0.028 0.100 0.028' && b.rejected.every(x => !x) && r.rejected.join() === 'true,true,false,false,false,false' && Math.abs(r.adj[0] - 0.02413846) < 5e-4;
    return ok || `Bonferroni ${ba}; parametric ${r.rejected.join()}, adjusted p(H1) ${r.adj[0].toFixed(6)}`;
  });
  check('Genz and Bretz (2009) section 5.5.1: trivariate normal probability 0.8279847 (within 0.001)', () => {
    const R = Float64Array.of(1, 0.6, 1 / 3, 0.6, 1, 11 / 15, 1 / 3, 11 / 15, 1);
    const v = mvnLowerSE([1, 4, 2], cholesky(R, 3), 3, mulberry32(9), 512, 12);
    return Math.abs(v.p - 0.8279847) < 1e-3 || `got ${v.p.toFixed(5)} (se ${v.se.toExponential(1)})`;
  });

  /* ---- Added in 1.1.6 from the methods check of 22 October 2026 (24 examples). Graphs not in TEMPLATES are built
     inline from exact fractions with mk(); every number comes from the app's own functions. ---- */
  const byLabel = (G, l) => G.nodes.find(n => n.label === l).id;
  /* graph from exact weights and a transition matrix of exact fractions (strings; expressions such as 'ε' or '1-ε' allowed) */
  const mk = (w, Gm, lab, alpha, vars) => {
    const o = { format: 'multiplicity-graph', alpha: alpha || 0.025, nodes: w.map((x, i) => ({ id: String(i), label: lab ? lab[i] : 'H' + (i + 1), weight: isExpr(String(x)) ? '0' : String(x), wexpr: isExpr(String(x)) ? String(x) : undefined, x: i * 120, y: 0, p: '' })), edges: [], vars };
    Gm.forEach((row, i) => row.forEach((v, j) => { if (i !== j && v !== 0 && v !== '0') o.edges.push(isExpr(String(v)) ? { from: String(i), to: String(j), weight: '0', expr: String(v) } : { from: String(i), to: String(j), weight: String(v) }); }));
    return load(o);
  };
  /* weighted Holm transition matrix g_ij = w_j / (1 - w_i) (Bretz et al., 2009, p. 594; Wiens et al., 2013, p. 1412) */
  const wHolm = ws => { const q = ws.map(x => Q.parse(x)); return q.map((_, i) => q.map((wj, j) => (i === j ? '0' : Q.exact(Q.div(wj, Q.sub(Q.ONE, q[i])))))); };
  const order = (G, p, alpha) => runProcedure(stateFromGraph(G), pOfG(G, p), alpha).order.map(id => G.nodes.find(n => n.id === id).label).join(',');
  const after = (G, labs) => { let st = stateFromGraph(G); for (const l of labs) st = rejectNode(st, byLabel(G, l)); return st; };
  const wOf = (G, st, l) => { const q = st.w.get(byLabel(G, l)); return q ? Q.exact(q) : '-'; };
  const gOf = (G, st, a, b) => Q.exact(getg(st, byLabel(G, a), byLabel(G, b)));
  const closedAdj = (G, p, alpha, test, opts = {}) => closedTest(floatGraph(G), p, alpha, test, { upscale: !!opts.upscale, groups: (opts.groups || []).map(a => new Set(a)), corrAt: opts.corr ? (i, j) => (opts.corr[i][j] == null ? null : opts.corr[i][j]) : () => null, rand: mulberry32(opts.seed || 2011), cache: new Map() });
  const near = (got, want, tol) => got.length === want.length && got.every((x, i) => Math.abs(x - want[i]) <= tol);
  const f5 = a => a.map(x => x.toFixed(5)).join(' ');

  /* Batch 1: Bonferroni step-through and templates */
  check('Ding, Li and Wu (2025) pp. 2-3, graph GA2: six hypotheses, w = (1/4, 1/4, 1/4, 1/4, 0, 0), alpha 0.025, p = (0.0071, 0.7638, 0.0095, 0.005, 0.0075, 0.4512): rejects H4, H1, H3, H5 in that order; after H4 the first row of G is (0, 8/35, 13/35, 0, 12/35, 2/35) and the levels are (7/960, 1/120, 7/960, 0, 0, 1/480); final levels (0, 1/60, 0, 0, 0, 1/120)', () => {
    const G = mk(['1/4', '1/4', '1/4', '1/4', '0', '0'], [['0', '1/6', '1/3', '1/6', '1/3', '0'], ['1/6', '0', '1/6', '1/3', '0', '1/3'], ['1/3', '1/6', '0', '1/6', '1/3', '0'], ['1/6', '1/3', '1/6', '0', '0', '1/3'], ['1/3', '0', '1/3', '0', '0', '1/3'], ['0', '1/3', '0', '1/3', '1/3', '0']]);
    const p = [0.0071, 0.7638, 0.0095, 0.005, 0.0075, 0.4512], a = Q.parse('1/40');
    const o = order(G, p, 0.025); if (o !== 'H4,H1,H3,H5') return 'order ' + o;
    const s4 = after(G, ['H4']);
    const row = ['H2', 'H3', 'H5', 'H6'].map(l => gOf(G, s4, 'H1', l)).join(' '); if (row !== '8/35 13/35 12/35 2/35') return 'row 1 after H4: ' + row;
    const lv = st => G.nodes.map(n => (st.w.has(n.id) ? Q.exact(Q.mul(st.w.get(n.id), a)) : '0')).join(' ');
    if (lv(s4) !== '7/960 1/120 7/960 0 0 1/480') return 'levels after H4: ' + lv(s4);
    const sf = after(G, ['H4', 'H1', 'H3', 'H5']);
    return lv(sf) === '0 1/60 0 0 0 1/120' || 'final levels: ' + lv(sf);
  });
  check('Dmitrienko, Wiens and Westfall (2006) Table 1, p. 747: fallback with w = (2/5, 1/4, 1/4, 1/10), alpha 0.05. Scenario 1, p = (0.0036, 0.0240, 0.0394, 0.1962): rejects H1, H2, H3 at levels 0.02, 0.0325, 0.045, then H4 at 0.05. Scenario 2, p = (0.0562, 0.0106, 0.0232, 0.0196): rejects H2, H3, H4 at 0.0125, 0.025, 0.03. The weighted Holm graph (g_ij = w_j/(1 - w_i), p. 748) rejects H1 only (H2, H3 then at 1/48) and H2 only (H3 at 1/60)', () => {
    const w = ['2/5', '1/4', '1/4', '1/10'], a = Q.parse('1/20');
    const fb = mk(w, [['0', '1', '0', '0'], ['0', '0', '1', '0'], ['0', '0', '0', '1'], ['0', '0', '0', '0']], null, 0.05), wh = mk(w, wHolm(w), null, 0.05);
    const lvl = (G, st, l) => Q.exact(Q.mul(st.w.get(byLabel(G, l)), a));
    const p1 = [0.0036, 0.0240, 0.0394, 0.1962], p2 = [0.0562, 0.0106, 0.0232, 0.0196];
    let o = order(fb, p1, 0.05); if (o !== 'H1,H2,H3') return 'scenario 1 order ' + o;
    let got = [lvl(fb, after(fb, []), 'H1'), lvl(fb, after(fb, ['H1']), 'H2'), lvl(fb, after(fb, ['H1', 'H2']), 'H3'), lvl(fb, after(fb, ['H1', 'H2', 'H3']), 'H4')].join(' ');
    if (got !== '1/50 13/400 9/200 1/20') return 'scenario 1 levels ' + got;
    o = order(fb, p2, 0.05); if (o !== 'H2,H3,H4') return 'scenario 2 order ' + o;
    got = [lvl(fb, after(fb, []), 'H2'), lvl(fb, after(fb, ['H2']), 'H3'), lvl(fb, after(fb, ['H2', 'H3']), 'H4')].join(' ');
    if (got !== '1/80 1/40 3/100') return 'scenario 2 levels ' + got;
    o = order(wh, p1, 0.05); if (o !== 'H1') return 'weighted Holm scenario 1 ' + o;
    got = [lvl(wh, after(wh, ['H1']), 'H2'), lvl(wh, after(wh, ['H1']), 'H3')].join(' '); if (got !== '1/48 1/48') return 'weighted Holm after H1: ' + got;
    o = order(wh, p2, 0.05); if (o !== 'H2') return 'weighted Holm scenario 2 ' + o;
    got = lvl(wh, after(wh, ['H2']), 'H3'); return got === '1/60' || 'weighted Holm after H2: ' + got;
  });
  check('Weighted Holm for any m (Bretz et al., 2009, p. 594; Holm, 1979), built from typed weights. With w = (2/5, 1/4, 1/4, 1/10) every transition is w_j/(1 - w_i) exactly (rows 5/12, 5/12, 1/6; 8/15, 1/3, 2/15; 8/15, 1/3, 2/15; 4/9, 5/18, 5/18), the graph validates clean and is alpha-exhaustive, and the Dmitrienko, Wiens and Westfall (2006) Table 1 scenarios (p. 747) reject H1 only and H2 only. With w = (1/2, 3/10, 1/5) the closure weights are w_j divided by the sum over the intersection, as in Guilbaud (2018) Example 6, p. 225. A zero weight is allowed (no edge leads into it); weights not adding up to 1, or fewer than two positive weights, are refused', () => {
    const w = ['2/5', '1/4', '1/4', '1/10'].map(x => Q.parse(x));
    const G = load(generatedTemplate('weightedHolm', 4, w));
    const want = [['0', '5/12', '5/12', '1/6'], ['8/15', '0', '1/3', '2/15'], ['8/15', '1/3', '0', '2/15'], ['4/9', '5/18', '5/18', '0']];
    const got = G.nodes.map(a => G.nodes.map(b => { if (a.id === b.id) return '0'; const e = G.edges.find(x => x.from === a.id && x.to === b.id); return e ? Q.exact(e.g) : '0'; }));
    if (JSON.stringify(got) !== JSON.stringify(want)) return 'transitions ' + JSON.stringify(got);
    if (G.nodes.map(n => Q.exact(n.w)).join(' ') !== '2/5 1/4 1/4 1/10') return 'weights ' + G.nodes.map(n => Q.exact(n.w)).join(' ');
    const v = validateGraph(G, q => Q.fmt(q)); if (v.length) return 'validation: ' + v.map(x => x.text).join('; ');
    if (isAlphaExhaustive(G) !== true) return 'not exhaustive';
    let o = order(G, [0.0036, 0.0240, 0.0394, 0.1962], 0.05); if (o !== 'H1') return 'scenario 1 ' + o;
    o = order(G, [0.0562, 0.0106, 0.0232, 0.0196], 0.05); if (o !== 'H2') return 'scenario 2 ' + o;
    const w3 = ['1/2', '3/10', '1/5'].map(x => Q.parse(x)), G3 = load(generatedTemplate('weightedHolm', 3, w3));
    for (let mask = 1; mask < 8; mask++) {
      const keep = [0, 1, 2].filter(i => mask & (1 << i)), st = after(G3, [0, 1, 2].filter(i => !(mask & (1 << i))).map(i => 'H' + (i + 1)));
      const S = keep.reduce((a, i) => Q.add(a, w3[i]), Q.ZERO);
      for (const i of keep) if (wOf(G3, st, 'H' + (i + 1)) !== Q.exact(Q.div(w3[i], S))) return `intersection ${keep.map(i => 'H' + (i + 1)).join(',')}: ${wOf(G3, st, 'H' + (i + 1))}`;
    }
    const Gz = load(generatedTemplate('weightedHolm', 3, ['1/2', '1/2', '0'].map(x => Q.parse(x))));
    const z = Gz.nodes[2].id;
    if (Gz.edges.some(e => e.to === z)) return 'edge into a zero-weight hypothesis';
    if (Gz.edges.filter(e => e.from === z).map(e => Q.exact(e.g)).join(' ') !== '1/2 1/2') return 'zero-weight hypothesis edges ' + Gz.edges.filter(e => e.from === z).map(e => Q.exact(e.g)).join(' ');
    let threw = 0;
    try { generatedTemplate('weightedHolm', 2, ['1/2', '1/4'].map(x => Q.parse(x))); } catch (e) { threw += /add up to 3\/4/.test(e.message) ? 1 : 0; }
    try { generatedTemplate('weightedHolm', 2, ['1', '0'].map(x => Q.parse(x))); } catch (e) { threw += /two weights/.test(e.message) ? 1 : 0; }
    return threw === 2 || 'refusals: ' + threw;
  });
  check('Guilbaud (2018) Examples 4 and 5, p. 224: weights (1/2, 1/4, 1/4), alpha 0.05, p = (0.03, 0.01, 0.04). Fallback rejects H2 only and then tests H3 at 0.025. Improved fallback II rejects H2, H1, H3 in that order, with H1 tested at (1/2 + (1 - ε)/4) alpha and H3 at alpha', () => {
    const w = ['1/2', '1/4', '1/4'], p = [0.03, 0.01, 0.04];
    const fb = mk(w, [['0', '1', '0'], ['0', '0', '1'], ['0', '0', '0']], null, 0.05);
    let o = order(fb, p, 0.05); if (o !== 'H2') return 'fallback order ' + o;
    let got = wOf(fb, after(fb, ['H2']), 'H3'); if (got !== '1/2') return 'fallback H3 weight after H2: ' + got;
    const t = templateJSON('improvedFallbackII'); t.alpha = 0.05; t.nodes.forEach((n, i) => { n.weight = w[i]; });
    const G = load(t);
    o = order(G, p, 0.05); if (o !== 'H2,H1,H3') return 'improved fallback II order ' + o;
    got = wOf(G, after(G, ['H2']), 'H1'); if (got !== '2999/4000') return 'H1 weight after H2: ' + got;
    got = wOf(G, after(G, ['H2', 'H1']), 'H3'); return got === '1' || 'H3 weight after H2, H1: ' + got;
  });
  check('Guilbaud (2018) section 4.3.4, p. 229: truncated Holm with gamma 1/2, alpha 0.025, p = (0.01, 0.02, 0.003, 0.006): rejects H1, H3 and H4; H2 is held at 3 alpha/4', () => {
    const o = truncatedHolmTemplate(); o.vars = { 'γ': '1/2' };
    const G = load(o), p = [0.01, 0.02, 0.003, 0.006];
    const r = labels(G, runProcedure(stateFromGraph(G), pOfG(G, p), 0.025).order); if (r !== 'H1,H3,H4') return 'rejected ' + r;
    const got = wOf(G, runProcedure(stateFromGraph(G), pOfG(G, p), 0.025).final, 'H2');
    return got === '3/4' || 'H2 weight ' + got;
  });
  check('Hung and Wang (2010) Fig. 1, p. 751, and section 7, p. 754: the template has H1,NI at weight 1, the other three at 0, and transitions ν, 1 - ν (from H1,NI), τ, 1 - τ (from H1,S), ω, 1 - ω (from H2,NI); at ν = τ = ω = 1/2 every transition is 1/2, the graph is not alpha-exhaustive and validation gives the one warning that H2,S passes nothing on. With τ = ω = 1 and alpha 0.025, p = (0.01, 0.01, 0.5, 0.01) rejects H1,NI, H1,S and H2,S without H2,NI, and p = (0.01, 0.5, 0.001, 0.001) rejects H1,NI and H2,NI while H2,S is never tested (p. 754). At 1/2, 1/2, 1/2, p = (0.01, 0.02, 0.005, 0.02) rejects H1,NI and H2,NI and leaves H1,S at weight 3/4 (level 3/160)', () => {
    const o = templateJSON('hungWang');
    const G = load(o);
    const L = ['H1,NI', 'H1,S', 'H2,NI', 'H2,S'];
    if (G.nodes.map(n => n.label).join('|') !== L.join('|')) return 'labels ' + G.nodes.map(n => n.label).join('|');
    if (G.nodes.map(n => Q.exact(n.w)).join(' ') !== '1 0 0 0') return 'weights ' + G.nodes.map(n => Q.exact(n.w)).join(' ');
    const ex = (a, b) => { const e = G.edges.find(x => x.from === byLabel(G, a) && x.to === byLabel(G, b)); return e ? (e.expr || Q.exact(e.g)) : '0'; };
    const want = { 'H1,NI': ['0', 'ν', '1-ν', '0'], 'H1,S': ['0', '0', '1-τ', 'τ'], 'H2,NI': ['0', 'ω', '0', '1-ω'], 'H2,S': ['0', '0', '0', '0'] };
    for (const a of L) { const got = L.map(b => ex(a, b)).join(' '); if (got !== want[a].join(' ')) return `${a}: ${got}`; }
    if (Object.keys(G.vars).sort().join('') !== 'ντω' || Object.values(G.vars).some(v => Q.exact(v) !== '1/2')) return 'variables ' + JSON.stringify(Object.fromEntries(Object.entries(G.vars).map(([k, v]) => [k, Q.exact(v)])));
    const num = L.map(a => L.map(b => Q.exact(getg(stateFromGraph(G), byLabel(G, a), byLabel(G, b)))).join(' '));
    if (num.join('|') !== '0 1/2 1/2 0|0 0 1/2 1/2|0 1/2 0 1/2|0 0 0 0') return 'numeric transitions ' + num.join('|');
    if (isAlphaExhaustive(G) !== false) return 'should not be exhaustive';
    const v = validateGraph(G, q => Q.fmt(q)); if (v.length !== 1 || v[0].level !== 'warn' || !/H2,S/.test(v[0].text)) return 'validation: ' + JSON.stringify(v.map(x => x.level + ': ' + x.text));
    const o1 = templateJSON('hungWang'); o1.vars = { 'ν': '1/2', 'τ': '1', 'ω': '1' };
    const G1 = load(o1);
    let r = order(G1, [0.01, 0.01, 0.5, 0.01], 0.025); if (r !== 'H1,NI,H1,S,H2,S') return 'tau = omega = 1, first run: ' + r;
    const run2 = runProcedure(stateFromGraph(G1), pOfG(G1, [0.01, 0.5, 0.001, 0.001]), 0.025);
    r = run2.order.map(id => G1.nodes.find(n => n.id === id).label).join(','); if (r !== 'H1,NI,H2,NI') return 'tau = omega = 1, second run: ' + r;
    if (wOf(G1, run2.final, 'H2,S') !== '0') return 'H2,S should still have weight 0, got ' + wOf(G1, run2.final, 'H2,S');
    const run3 = runProcedure(stateFromGraph(G), pOfG(G, [0.01, 0.02, 0.005, 0.02]), 0.025);
    r = run3.order.map(id => G.nodes.find(n => n.id === id).label).join(','); if (r !== 'H1,NI,H2,NI') return 'third run: ' + r;
    const w = wOf(G, run3.final, 'H1,S'); return w === '3/4' || 'H1,S weight ' + w;
  });
  check('Li and Zhou (2021) Fig. 7, pp. 52 and 54, on Bretz et al. (2009) Fig. 14, p. 600 (left and right), alpha 0.05. Scenario 1, p = (0.024, 0.024, 0.024, 0.04, 0.04, 0.04): the left graph rejects all six, the right graph H11 only. Scenario 2, p = (0.0374, 0.024, 0.024, 0.024, 0.04, 0.024): left H21 only, right H11, H12 and H21', () => {
    const L = ['H11', 'H12', 'H13', 'H21', 'H22', 'H23'], w = ['1/2', '0', '0', '1/2', '0', '0'];
    const left = mk(w, [['0', '1', '0', '0', '0', '0'], ['0', '0', '1', '0', '0', '0'], ['0', '0', '0', '1', '0', '0'], ['0', '0', '0', '0', '1', '0'], ['0', '0', '0', '0', '0', '1'], ['1', '0', '0', '0', '0', '0']], L, 0.05);
    const right = mk(w, [['0', '1/2', '0', '1/2', '0', '0'], ['0', '0', '1/2', '1/2', '0', '0'], ['0', '0', '0', '1', '0', '0'], ['1/2', '0', '0', '0', '1/2', '0'], ['1/2', '0', '0', '0', '0', '1/2'], ['1', '0', '0', '0', '0', '0']], L, 0.05);
    const s1 = [0.024, 0.024, 0.024, 0.04, 0.04, 0.04], s2 = [0.0374, 0.024, 0.024, 0.024, 0.04, 0.024];
    const rej = (G, p) => labels(G, runProcedure(stateFromGraph(G), pOfG(G, p), 0.05).order);
    const got = [rej(left, s1), rej(right, s1), rej(left, s2), rej(right, s2)];
    const want = ['H11,H12,H13,H21,H22,H23', 'H11', 'H21', 'H11,H12,H21'];
    return got.join(' | ') === want.join(' | ') || 'got ' + got.join(' | ');
  });
  check('Bretz et al. (2009) Fig. 14, p. 600, as templates (also Minini, Paux and Dmitrienko, 2026, Figs. 4 and 5): each equals its transcribed matrix exactly, with weights (1/2, 0, 0, 1/2, 0, 0); both validate with no message and are alpha-exhaustive; the Li and Zhou (2021) Fig. 7 scenarios (pp. 52 and 54, alpha 0.05) give all six and H11 only (scenario 1), and H21 only and H11, H12, H21 (scenario 2); after H11 the right graph holds H12 at 1/4 and H21 at 3/4 (Guilbaud and Karlsson, 2011, p. 689)', () => {
    const L = ['H11', 'H12', 'H13', 'H21', 'H22', 'H23'];
    const want = {
      bretzFig14Left: [['0', '1', '0', '0', '0', '0'], ['0', '0', '1', '0', '0', '0'], ['0', '0', '0', '1', '0', '0'], ['0', '0', '0', '0', '1', '0'], ['0', '0', '0', '0', '0', '1'], ['1', '0', '0', '0', '0', '0']],
      bretzFig14Right: [['0', '1/2', '0', '1/2', '0', '0'], ['0', '0', '1/2', '1/2', '0', '0'], ['0', '0', '0', '1', '0', '0'], ['1/2', '0', '0', '0', '1/2', '0'], ['1/2', '0', '0', '0', '0', '1/2'], ['1', '0', '0', '0', '0', '0']]
    };
    const Gs = {};
    for (const k of Object.keys(want)) {
      const o = templateJSON(k); o.alpha = 0.05; const G = load(o); Gs[k] = G;
      if (G.nodes.map(n => n.label).join(',') !== L.join(',')) return k + ' labels ' + G.nodes.map(n => n.label).join(',');
      if (G.nodes.map(n => Q.exact(n.w)).join(' ') !== '1/2 0 0 1/2 0 0') return k + ' weights ' + G.nodes.map(n => Q.exact(n.w)).join(' ');
      const got = G.nodes.map(a => G.nodes.map(b => { if (a.id === b.id) return '0'; const e = G.edges.find(x => x.from === a.id && x.to === b.id); return e ? Q.exact(e.g) : '0'; }));
      if (JSON.stringify(got) !== JSON.stringify(want[k])) return k + ' transitions ' + JSON.stringify(got);
      const v = validateGraph(G, q => Q.fmt(q)); if (v.length) return k + ' validation: ' + v.map(x => x.text).join('; ');
      if (isAlphaExhaustive(G) !== true) return k + ' not exhaustive';
    }
    const s1 = [0.024, 0.024, 0.024, 0.04, 0.04, 0.04], s2 = [0.0374, 0.024, 0.024, 0.024, 0.04, 0.024];
    const rej = (G, p) => labels(G, runProcedure(stateFromGraph(G), pOfG(G, p), 0.05).order);
    const got = [rej(Gs.bretzFig14Left, s1), rej(Gs.bretzFig14Right, s1), rej(Gs.bretzFig14Left, s2), rej(Gs.bretzFig14Right, s2)];
    const wantR = ['H11,H12,H13,H21,H22,H23', 'H11', 'H21', 'H11,H12,H21'];
    if (got.join(' | ') !== wantR.join(' | ')) return 'scenarios: ' + got.join(' | ');
    const st = after(Gs.bretzFig14Right, ['H11']);
    const w = [wOf(Gs.bretzFig14Right, st, 'H12'), wOf(Gs.bretzFig14Right, st, 'H21')].join(' ');
    return w === '1/4 3/4' || 'after H11: ' + w;
  });
  check('Bretz et al. (2009) Fig. 8, p. 594, as a template: HE1, HE2, HE3 at 1/3 and HS1, HS2, HS3 at 0; HEi passes 1 to HSi and HSi passes 1/2 to each other HEj, exactly; validates with no message; alpha-exhaustive. With p = (0.01, 0.02, 0.2, 0.03, 0.5, 0.01) at alpha 0.05 only HE1 is rejected and HS1 is then held at 1/3 (level 1/60); after HE1 and HS1 the other two efficacy hypotheses hold 1/2 each', () => {
    const o = templateJSON('efficacySafety'); o.alpha = 0.05; const G = load(o);
    const L = ['HE1', 'HE2', 'HE3', 'HS1', 'HS2', 'HS3'];
    if (G.nodes.map(n => n.label).join(',') !== L.join(',')) return 'labels ' + G.nodes.map(n => n.label).join(',');
    if (G.nodes.map(n => Q.exact(n.w)).join(' ') !== '1/3 1/3 1/3 0 0 0') return 'weights ' + G.nodes.map(n => Q.exact(n.w)).join(' ');
    if (G.nodes.map(n => n.group).join(',') !== 'efficacy,efficacy,efficacy,safety,safety,safety') return 'groups ' + G.nodes.map(n => n.group).join(',');
    const want = [['0', '0', '0', '1', '0', '0'], ['0', '0', '0', '0', '1', '0'], ['0', '0', '0', '0', '0', '1'], ['0', '1/2', '1/2', '0', '0', '0'], ['1/2', '0', '1/2', '0', '0', '0'], ['1/2', '1/2', '0', '0', '0', '0']];
    const got = G.nodes.map(a => G.nodes.map(b => { if (a.id === b.id) return '0'; const e = G.edges.find(x => x.from === a.id && x.to === b.id); return e ? Q.exact(e.g) : '0'; }));
    if (JSON.stringify(got) !== JSON.stringify(want)) return 'transitions ' + JSON.stringify(got);
    const v = validateGraph(G, q => Q.fmt(q)); if (v.length) return 'validation: ' + v.map(x => x.text).join('; ');
    if (isAlphaExhaustive(G) !== true) return 'not exhaustive';
    const run = runProcedure(stateFromGraph(G), pOfG(G, [0.01, 0.02, 0.2, 0.03, 0.5, 0.01]), 0.05);
    const r = run.order.map(id => G.nodes.find(n => n.id === id).label).join(','); if (r !== 'HE1') return 'rejected ' + r;
    if (wOf(G, run.final, 'HS1') !== '1/3') return 'HS1 weight ' + wOf(G, run.final, 'HS1');
    const st = after(G, ['HE1', 'HS1']);
    const w = [wOf(G, st, 'HE2'), wOf(G, st, 'HE3'), wOf(G, st, 'HS2'), wOf(G, st, 'HS3')].join(' ');
    return w === '1/2 1/2 0 0' || 'after HE1, HS1: ' + w;
  });
  check('Maurer, Glimm and Bretz (2011) section 4.2, p. 344: simple successive I and II (Fig. 2a, 2b), alpha 0.05, p = (0.01, 0.03, 0.02, 0.08): both reject exactly H1, H2 and H3, in the orders H1, H3, H2 and H1, H2, H3, and every rejection order ends with the same set. Section 4.3, p. 347: the two uncoupled chains of Quan et al. (H1 to H3, H2 to H4) reject H1 and H3 only', () => {
    const p = [0.01, 0.03, 0.02, 0.08];
    const sI = load(templateJSON('successiveI')), sII = load(templateJSON('bretz'));
    const oI = order(sI, p, 0.05), oII = order(sII, p, 0.05);
    if (oI !== 'H1,H3,H2' || oII !== 'H1,H2,H3') return `orders ${oI} and ${oII}`;
    for (const G of [sI, sII]) { const r = orderAnalysis(stateFromGraph(G), pOfG(G, p), 0.05); if (r.finals.length !== 1 || labels(G, r.finals[0]) !== 'H1,H2,H3') return 'order analysis gave ' + r.finals.length + ' final sets'; }
    const chains = mk(['1/2', '1/2', '0', '0'], [['0', '0', '1', '0'], ['0', '0', '0', '1'], ['0', '0', '0', '0'], ['0', '0', '0', '0']], null, 0.05);
    const oc = labels(chains, runProcedure(stateFromGraph(chains), pOfG(chains, p), 0.05).order);
    return oc === 'H1,H3' || 'chains rejected ' + oc;
  });
  check('Maurer and Bretz (2013, Statistics in Biopharmaceutical Research 5:311-320) Fig. 1, p. 317, and Table 2, p. 318: two doses, two endpoints template, alpha 0.025, p = (0.0024, 0.0172, 0.0117, 0.1285): rejects H1, H2, H3 at levels 1/80, 3/160, 1/80, with H4 retained at 1/40. After H1 the weights are (3/4, 1/4, 0) with H2 to H3 1/3, H2 to H4 2/3, H3 to H2 1, H4 to H2 1/2, H4 to H3 1/2; after H1 and H2 they are (1/2, 1/2) with H3 and H4 linked by 1', () => {
    const G = load(templateJSON('bretz')), p = [0.0024, 0.0172, 0.0117, 0.1285], a = Q.parse('1/40');
    const o = order(G, p, 0.025); if (o !== 'H1,H2,H3') return 'order ' + o;
    const lvl = (st, l) => Q.exact(Q.mul(st.w.get(byLabel(G, l)), a));
    const got = [lvl(after(G, []), 'H1'), lvl(after(G, ['H1']), 'H2'), lvl(after(G, ['H1', 'H2']), 'H3'), lvl(after(G, ['H1', 'H2', 'H3']), 'H4')].join(' ');
    if (got !== '1/80 3/160 1/80 1/40') return 'levels ' + got;
    const s1 = after(G, ['H1']);
    const mid = [wOf(G, s1, 'H2'), wOf(G, s1, 'H3'), wOf(G, s1, 'H4'), gOf(G, s1, 'H2', 'H3'), gOf(G, s1, 'H2', 'H4'), gOf(G, s1, 'H3', 'H2'), gOf(G, s1, 'H4', 'H2'), gOf(G, s1, 'H4', 'H3')].join(' ');
    if (mid !== '3/4 1/4 0 1/3 2/3 1 1/2 1/2') return 'after H1: ' + mid;
    const s2 = after(G, ['H1', 'H2']);
    const right = [wOf(G, s2, 'H3'), wOf(G, s2, 'H4'), gOf(G, s2, 'H3', 'H4'), gOf(G, s2, 'H4', 'H3')].join(' ');
    return right === '1/2 1/2 1 1' || 'after H1, H2: ' + right;
  });
  check('Maurer and Bretz (2013, Statistics in Medicine 32:1739-1753) Fig. 1(a), p. 1743, and section 3.1, p. 1742: five hypotheses, w = (1/2, 1/2, 0, 0, 0), H1 to H3 1, H2 to H3 1, H3 to H4 1/2, H3 to H5 1/2, alpha 0.025, p = (0.01, 0.022, 0.005, 0.012, 0.001): rejects H1, H3, H5 in that order, H5 at 1/160; H2 and H4 are retained', () => {
    const G = mk(['1/2', '1/2', '0', '0', '0'], [['0', '0', '1', '0', '0'], ['0', '0', '1', '0', '0'], ['0', '0', '0', '1/2', '1/2'], ['0', '0', '0', '0', '0'], ['0', '0', '0', '0', '0']]);
    const o = order(G, [0.01, 0.022, 0.005, 0.012, 0.001], 0.025); if (o !== 'H1,H3,H5') return 'order ' + o;
    const got = Q.exact(Q.mul(after(G, ['H1', 'H3']).w.get(byLabel(G, 'H5')), Q.parse('1/40')));
    return got === '1/160' || 'H5 level ' + got;
  });
  check('Wiens and Dmitrienko (2005) section 4, p. 937, and Wolf and Zhou (2021) section 3.2, p. 3187: fallback with five endpoints, w = (4/5, 1/10, 1/25, 1/25, 1/50), alpha 0.05, p = (0.010, 0.060, 0.0002, 0.0004, 0.0268): rejects exactly H1, H3 and H4; the levels are 0.04, 0.045 (H2 retained), 0.002, 0.004 and 0.005 (H5 retained)', () => {
    const w = ['4/5', '1/10', '1/25', '1/25', '1/50'], a = Q.parse('1/20');
    const G = mk(w, [['0', '1', '0', '0', '0'], ['0', '0', '1', '0', '0'], ['0', '0', '0', '1', '0'], ['0', '0', '0', '0', '1'], ['0', '0', '0', '0', '0']], null, 0.05);
    const p = [0.010, 0.060, 0.0002, 0.0004, 0.0268], r = runProcedure(stateFromGraph(G), pOfG(G, p), 0.05);
    const set = labels(G, r.order); if (set !== 'H1,H3,H4') return 'rejected ' + set;
    const lvl = (st, l) => Q.exact(Q.mul(st.w.get(byLabel(G, l)), a));
    const got = [lvl(after(G, []), 'H1'), lvl(r.final, 'H2'), lvl(after(G, []), 'H3'), lvl(after(G, ['H3']), 'H4'), lvl(r.final, 'H5')].join(' ');
    return got === '1/25 9/200 1/500 1/250 1/200' || 'levels ' + got;
  });
  check('Wolf and Zhou (2021) Example 2, p. 3186: weights (4/5, 3/20, 1/20), alpha 0.05, p = (0.042, 0.001, 0.0002): the fallback rejects H2 and H3 with H1 retained at 0.04; the weighted Holm graph rejects H3, H2, H1 in that order, with H2 tested at 3/380 = 0.007895', () => {
    const w = ['4/5', '3/20', '1/20'], p = [0.042, 0.001, 0.0002], a = Q.parse('1/20');
    const fb = mk(w, [['0', '1', '0'], ['0', '0', '1'], ['0', '0', '0']], null, 0.05), wh = mk(w, wHolm(w), null, 0.05);
    const rf = runProcedure(stateFromGraph(fb), pOfG(fb, p), 0.05);
    const sf = labels(fb, rf.order); if (sf !== 'H2,H3') return 'fallback rejected ' + sf;
    let got = Q.exact(Q.mul(rf.final.w.get(byLabel(fb, 'H1')), a)); if (got !== '1/25') return 'fallback H1 level ' + got;
    const o = order(wh, p, 0.05); if (o !== 'H3,H2,H1') return 'weighted Holm order ' + o;
    got = Q.exact(Q.mul(after(wh, ['H3']).w.get(byLabel(wh, 'H2')), a));
    return got === '3/380' || 'weighted Holm H2 level after H3: ' + got;
  });
  check('Wiens, Dmitrienko and Marchenko (2013) p. 1412: the weighted Holm graph with g_ij = w_j / (sum of the other weights) gives the same rejections as an independent weighted Holm shortcut (order p_i/w_i, reject while p_(j)/w_(j) <= alpha / sum of the remaining weights) on 200 seeded random cases with unequal weights, m = 3 to 6', () => {
    const rand = mulberry32(12345);
    for (let t = 0; t < 200; t++) {
      const m = 3 + (t % 4), alpha = t % 2 ? 0.025 : 0.05;
      const raw = Array.from({ length: m }, () => 1 + Math.floor(rand() * 9)), s = raw.reduce((x, y) => x + y, 0);
      const w = raw.map(x => `${x}/${s}`), wn = raw.map(x => x / s);
      const p = Array.from({ length: m }, () => +(rand() * (t % 3 ? 0.08 : 0.5)).toFixed(4));
      const G = mk(w, wHolm(w), null, alpha);
      const app = new Set(runProcedure(stateFromGraph(G), pOfG(G, p), alpha).order.map(id => G.nodes.findIndex(n => n.id === id)));
      /* independent shortcut, not the engine */
      const rej = new Set(); let rem = p.map((_, i) => i);
      while (rem.length) {
        let best = rem[0]; for (const i of rem) if (p[i] / wn[i] < p[best] / wn[best]) best = i;
        const sumW = rem.reduce((x, i) => x + wn[i], 0);
        if (p[best] / wn[best] <= alpha / sumW + 1e-15) { rej.add(best); rem = rem.filter(i => i !== best); } else break;
      }
      if (app.size !== rej.size || [...rej].some(i => !app.has(i))) return `mismatch at case ${t}: w = (${w.join(', ')}), p = (${p.join(', ')})`;
    }
    return true;
  });
  check('Guilbaud and Karlsson (2011) Example 2, p. 688: the closure weights of Bretz et al. (2009) Fig. 14 left equal those of the default graph with the sequences 123456 and 456123 at 1/2 each, for all 63 intersections (the paper\'s rule (i) to (iii), p. 689)', () => {
    const L = ['H11', 'H12', 'H13', 'H21', 'H22', 'H23'];
    const G = mk(['1/2', '0', '0', '1/2', '0', '0'], [['0', '1', '0', '0', '0', '0'], ['0', '0', '1', '0', '0', '0'], ['0', '0', '0', '1', '0', '0'], ['0', '0', '0', '0', '1', '0'], ['0', '0', '0', '0', '0', '1'], ['1', '0', '0', '0', '0', '0']], L, 0.05);
    const seqs = [[0, 1, 2, 3, 4, 5], [3, 4, 5, 0, 1, 2]], half = Q.parse('1/2');
    for (let mask = 1; mask < 64; mask++) {
      let st = stateFromGraph(G);
      for (let i = 0; i < 6; i++) if (!(mask & (1 << i))) st = rejectNode(st, G.nodes[i].id);
      const want = Array(6).fill(Q.ZERO);
      for (const sq of seqs) { const red = sq.filter(i => mask & (1 << i)); want[red[0]] = Q.add(want[red[0]], half); }
      for (let i = 0; i < 6; i++) if ((mask & (1 << i)) && !Q.eq(st.w.get(G.nodes[i].id), want[i])) return `intersection ${mask}: ${L[i]} ${Q.exact(st.w.get(G.nodes[i].id))} versus ${Q.exact(want[i])}`;
    }
    return true;
  });

  /* Batch 2: closed tests */
  check('Lu (2016) section 2, p. 4042: simple successive I, alpha 0.025, p = (0.01, 0.005, 0.015, 0.022), families {H1, H2} and {H3, H4}: Simes within groups and the full weighted Simes test both give adjusted p = (0.02, 0.01, 0.022, 0.022), closed Bonferroni (0.02, 0.01, 0.03, 0.03), and the 15 intersection p-values in the order of Bretz et al. (2011) Table 1 are 0.01, 0.01, 0.01, 0.01, 0.02, 0.01, 0.02, 0.01, 0.01, 0.01, 0.005, 0.005, 0.022, 0.015, 0.022', () => {
    const G = load(templateJSON('successiveI')), p = [0.01, 0.005, 0.015, 0.022], groups = [[0, 1], [2, 3]];
    const rg = closedAdj(G, p, 0.025, 'simes-groups', { groups }), rs = closedAdj(G, p, 0.025, 'simes'), rb = closedAdj(G, p, 0.025, 'bonferroni');
    if (!near(rg.adj, [0.02, 0.01, 0.022, 0.022], 1e-9)) return 'Simes within groups ' + f5(rg.adj);
    if (!near(rs.adj, [0.02, 0.01, 0.022, 0.022], 1e-9)) return 'Simes ' + f5(rs.adj);
    if (!near(rb.adj, [0.02, 0.01, 0.03, 0.03], 1e-9)) return 'Bonferroni ' + f5(rb.adj);
    const masks = [15, 7, 11, 3, 13, 5, 9, 1, 14, 6, 10, 2, 12, 4, 8], want = [0.01, 0.01, 0.01, 0.01, 0.02, 0.01, 0.02, 0.01, 0.01, 0.01, 0.005, 0.005, 0.022, 0.015, 0.022];
    const got = masks.map(mk => rg.subsets.find(s => s.mask === mk).adjP);
    return near(got, want, 1e-9) || 'intersections ' + f5(got);
  });
  check('Lu (2016) graph, a case that separates the two Simes rules: p = (0.012, 0.010, 0.001, 0.001), alpha 0.015, families {H1, H2} and {H3, H4}: Simes within groups (the gMCP simes.on.subsets.test rule used here) gives adjusted p = 0.02 for all four and rejects none; the full weighted Simes test gives 0.012 for all four; closed Bonferroni 0.02. The Bretz et al. (2011) eq. 8 mixture used by graphicalMCP would give 0.012 for all four', () => {
    const G = load(templateJSON('successiveI')), p = [0.012, 0.010, 0.001, 0.001], groups = [[0, 1], [2, 3]];
    const rg = closedAdj(G, p, 0.015, 'simes-groups', { groups }), rs = closedAdj(G, p, 0.015, 'simes'), rb = closedAdj(G, p, 0.015, 'bonferroni');
    if (!near(rg.adj, [0.02, 0.02, 0.02, 0.02], 1e-9) || rg.rejected.some(Boolean)) return 'Simes within groups ' + f5(rg.adj) + ' rejected ' + rg.rejected.join();
    if (!near(rs.adj, [0.012, 0.012, 0.012, 0.012], 1e-9)) return 'Simes ' + f5(rs.adj);
    return near(rb.adj, [0.02, 0.02, 0.02, 0.02], 1e-9) || 'Bonferroni ' + f5(rb.adj);
  });
  check('Kundu et al. (2026) chapter 7, Tables 2 and 3, pp. 245-246: Holm(3), alpha 0.025, p = (0.0019, 0.0564, 0.0024): Simes intersection p-values p123 = 0.0036, p12 = 0.0038, p13 = 0.0024, p23 = 0.0048 and adjusted p = (0.0038, 0.0564, 0.0048); Bonferroni p123 = 0.0057, p12 = 0.0038, p13 = 0.0038, p23 = 0.0048 and adjusted p = (0.0057, 0.0564, 0.0057)', () => {
    const G = load(generatedTemplate('holm', 3)), p = [0.0019, 0.0564, 0.0024];
    const rs = closedAdj(G, p, 0.025, 'simes'), rb = closedAdj(G, p, 0.025, 'bonferroni');
    const inter = r => [7, 3, 5, 6].map(mk => r.subsets.find(s => s.mask === mk).adjP);
    if (!near(inter(rs), [0.0036, 0.0038, 0.0024, 0.0048], 1e-9)) return 'Simes intersections ' + f5(inter(rs));
    if (!near(rs.adj, [0.0038, 0.0564, 0.0048], 1e-9)) return 'Simes adjusted ' + f5(rs.adj);
    if (!near(inter(rb), [0.0057, 0.0038, 0.0038, 0.0048], 1e-9)) return 'Bonferroni intersections ' + f5(inter(rb));
    return near(rb.adj, [0.0057, 0.0564, 0.0057], 1e-9) || 'Bonferroni adjusted ' + f5(rb.adj);
  });
  check('Hommel (1988) section 4, p. 385: Holm(10), alpha 0.05, the ten ordered p-values (0.0021, 0.0074, 0.0093, 0.0106, 0.0121, 0.0218, 0.0238, 0.0352, 0.0466, 0.0605): the Simes closure (Hommel procedure) rejects exactly H1, H2, H3 with adjusted p = (0.021, 0.0444, 0.0476, 0.053, 0.05825, then 0.0605); the Bonferroni closure (Holm) rejects H1 only; the m = 10 closure runs in under a second', () => {
    const G = load(generatedTemplate('holm', 10)), p = [0.0021, 0.0074, 0.0093, 0.0106, 0.0121, 0.0218, 0.0238, 0.0352, 0.0466, 0.0605];
    const t0 = performance.now(), rs = closedAdj(G, p, 0.05, 'simes'), ms = performance.now() - t0;
    if (rs.rejected.join() !== 'true,true,true,false,false,false,false,false,false,false') return 'Simes rejected ' + rs.rejected.join();
    if (!near(rs.adj, [0.021, 0.0444, 0.0476, 0.053, 0.05825, 0.0605, 0.0605, 0.0605, 0.0605, 0.0605], 5e-4)) return 'Simes adjusted ' + f5(rs.adj);
    const rb = closedAdj(G, p, 0.05, 'bonferroni');
    if (rb.rejected.join() !== 'true,false,false,false,false,false,false,false,false,false') return 'Bonferroni rejected ' + rb.rejected.join();
    return ms < 1000 || `closure took ${ms.toFixed(0)} ms`;
  });
  check('Meijer, Krebs and Goeman (2019) Fig. 1, p. 76: Holm(7), p = (0, 0.01, 0.08, 0.1, 0.5, 0.7, 0.9): Simes closure adjusted p = (0, 0.06, 0.32, 0.4, 0.9, 0.9, 0.9); p. 75: Holm(4), alpha 0.05, p = (0.02, 0.02, 0.03, 0.9): rejects H1 and H2 with adjusted p = (0.045, 0.045, 0.06, 0.9)', () => {
    const r7 = closedAdj(load(generatedTemplate('holm', 7)), [0, 0.01, 0.08, 0.1, 0.5, 0.7, 0.9], 0.05, 'simes');
    if (!near(r7.adj, [0, 0.06, 0.32, 0.4, 0.9, 0.9, 0.9], 1e-9)) return 'm = 7 adjusted ' + f5(r7.adj);
    const r4 = closedAdj(load(generatedTemplate('holm', 4)), [0.02, 0.02, 0.03, 0.9], 0.05, 'simes');
    if (r4.rejected.join() !== 'true,true,false,false') return 'm = 4 rejected ' + r4.rejected.join();
    return near(r4.adj, [0.045, 0.045, 0.06, 0.9], 1e-9) || 'm = 4 adjusted ' + f5(r4.adj);
  });
  check('Tamhane and Gou (2018) section 5.3, p. 21: truncated Holm with gamma 1/2, alpha 0.05, p = (0.031, 0.013, 0.039, 0.027): the step-through rejects H2 then H1 and leaves H3 and H4 at 0.025 each; Simes within groups with the secondary family {H3, H4} rejects all four, adjusted p = (0.041333, 0.026, 0.041333, 0.041333); with gamma 0 the step-through rejects H2 only and the secondary family is not rejected', () => {
    const o = truncatedHolmTemplate(); o.vars = { 'γ': '1/2' }; o.alpha = 0.05;
    const G = load(o), p = [0.031, 0.013, 0.039, 0.027];
    const r = runProcedure(stateFromGraph(G), pOfG(G, p), 0.05);
    const od = r.order.map(id => G.nodes.find(n => n.id === id).label).join(','); if (od !== 'H2,H1') return 'order ' + od;
    const fin = [wOf(G, r.final, 'H3'), wOf(G, r.final, 'H4')].join(' '); if (fin !== '1/2 1/2') return 'final weights ' + fin;
    const rg = closedAdj(G, p, 0.05, 'simes-groups', { groups: [[2, 3]] });
    if (!rg.rejected.every(Boolean)) return 'gamma 1/2 rejected ' + rg.rejected.join();
    if (!near(rg.adj, [0.041333, 0.026, 0.041333, 0.041333], 1e-6)) return 'adjusted ' + f5(rg.adj);
    const o0 = truncatedHolmTemplate(); o0.vars = { 'γ': '0' }; o0.alpha = 0.05;
    const G0 = load(o0), od0 = order(G0, p, 0.05); if (od0 !== 'H2') return 'gamma 0 order ' + od0;
    const rg0 = closedAdj(G0, p, 0.05, 'simes-groups', { groups: [[2, 3]] });
    return (!rg0.rejected[2] && !rg0.rejected[3]) || 'gamma 0 rejected ' + rg0.rejected.join();
  });
  check('Xi and Bretz (2019) Fig. 6A and 6B, p. 5277, with the section 5.2 p-values, p. 5278, alpha 0.025. Fig. 6B (six hypotheses, ε = 1/1000), p = (0.01, 0.02, 0.002, 0.01, 0.02, 0.03), Simes within the families {H31, H32} and {H41, H42}: rejects H1 and H31 only, adjusted p = (0.02, 0.026667, 0.02, 0.026667, 0.03, 0.03); the intersection {H2, H31, H32, H41, H42} has weights (3/4, 1/8, 1/8, 0, 0). Fig. 6A (two doses, two endpoints), p = (0.01, 0.02, 0.01, 0.02): rejects H1 only, leaving H2 at 0.01875 and H3 at 0.00625', () => {
    const L = ['H1', 'H2', 'H31', 'H32', 'H41', 'H42'];
    const G = mk(['1/2', '1/2', '0', '0', '0', '0'], [['0', '1/2', '1/4', '1/4', '0', '0'], ['1/2', '0', '0', '0', '1/4', '1/4'], ['0', '0', '0', '1', '0', '0'], ['0', 'ε', '1-ε', '0', '0', '0'], ['ε', '0', '0', '0', '0', '1-ε'], ['0', '0', '0', '0', '1', '0']], L);
    const p = [0.01, 0.02, 0.002, 0.01, 0.02, 0.03];
    const rg = closedAdj(G, p, 0.025, 'simes-groups', { groups: [[2, 3], [4, 5]] });
    if (rg.rejected.join() !== 'true,false,true,false,false,false') return 'rejected ' + rg.rejected.join();
    if (!near(rg.adj, [0.02, 0.026667, 0.02, 0.026667, 0.03, 0.03], 1e-6)) return 'adjusted ' + f5(rg.adj);
    const s1 = after(G, ['H1']), got = ['H2', 'H31', 'H32', 'H41', 'H42'].map(l => wOf(G, s1, l)).join(' ');
    if (got !== '3/4 1/8 1/8 0 0') return 'weights after H1: ' + got;
    const A = load(templateJSON('bretz')), rA = runProcedure(stateFromGraph(A), pOfG(A, [0.01, 0.02, 0.01, 0.02]), 0.025);
    const oA = labels(A, rA.order); if (oA !== 'H1') return 'Fig. 6A rejected ' + oA;
    const fA = [wOf(A, rA.final, 'H2'), wOf(A, rA.final, 'H3'), wOf(A, rA.final, 'H4')].join(' ');
    return fA === '3/4 1/4 0' || 'Fig. 6A final weights ' + fA;
  });

  /* Batch 3: parametric test and the multivariate normal routine */
  check('Millen and Dmitrienko (2011) pp. 21-22, Table 3: cyclical chain (Holm(3) with transitions 1/2), rho 0.5 for every pair, alpha 0.025, parametric test: the levels c w alpha are 0.009413 for the full intersection, 0.013479 for each pair and 0.025 for a single hypothesis (within 0.00005; Monte Carlo); p = (0.0093, 0.5, 0.5) rejects H1, (0.0095, 0.5, 0.5) rejects none, (0.001, 0.0134, 0.5) rejects H1 and H2, (0.001, 0.0136, 0.5) rejects H1 only', () => {
    const G = load(generatedTemplate('holm', 3)), corr = [[1, 0.5, 0.5], [0.5, 1, 0.5], [0.5, 0.5, 1]];
    const cr = closedTestCritical(floatGraph(G), 0.025, 'parametric', { upscale: false, corrAt: (i, j) => corr[i][j], rand: mulberry32(2011), cache: new Map() });
    const lvl = mask => { const e = cr.crit[mask], b = e.blocks[0]; return b.c * e.w[0] * 0.025; };
    const got = [lvl(7), lvl(3), lvl(5), lvl(6), lvl(1)];
    if (!near(got, [0.009413, 0.013479, 0.013479, 0.013479, 0.025], 5e-5)) return 'levels ' + got.map(x => x.toFixed(6)).join(' ');
    const want = [[[0.0093, 0.5, 0.5], 'true,false,false'], [[0.0095, 0.5, 0.5], 'false,false,false'], [[0.001, 0.0134, 0.5], 'true,true,false'], [[0.001, 0.0136, 0.5], 'true,false,false']];
    for (const [p, rj] of want) { const r = closedAdj(G, p, 0.025, 'parametric', { corr }); if (r.rejected.join() !== rj) return `p = (${p.join(', ')}) rejected ${r.rejected.join()}`; }
    return true;
  });
  check('Zhao, Dmitrienko and Tamura (2010) p. 74, Fig. 1 and Table 1, p. 75: H0 (full population) and H+ (subgroup), weights 1/2, transitions 1 both ways, rho 0.5, alpha 0.025, parametric test: the intersection level is 0.013479 (within 0.00005); p = (0.02, 0.01) rejects both, (0.03, 0.01) rejects H+ only, (0.02, 0.02) rejects neither, (0.0134, 0.5) rejects H0 and (0.0136, 0.5) neither', () => {
    const G = mk(['1/2', '1/2'], [['0', '1'], ['1', '0']], ['H0', 'H+']), corr = [[1, 0.5], [0.5, 1]];
    const cr = closedTestCritical(floatGraph(G), 0.025, 'parametric', { upscale: false, corrAt: (i, j) => corr[i][j], rand: mulberry32(2011), cache: new Map() });
    const e = cr.crit[3], lvl = e.blocks[0].c * e.w[0] * 0.025;
    if (Math.abs(lvl - 0.013479) > 5e-5) return 'intersection level ' + lvl.toFixed(6);
    const want = [[[0.02, 0.01], 'true,true'], [[0.03, 0.01], 'false,true'], [[0.02, 0.02], 'false,false'], [[0.0134, 0.5], 'true,false'], [[0.0136, 0.5], 'false,false']];
    for (const [p, rj] of want) { const r = closedAdj(G, p, 0.025, 'parametric', { corr }); if (r.rejected.join() !== rj) return `p = (${p.join(', ')}) rejected ${r.rejected.join()}`; }
    return true;
  });
  check('Slepian (1962) eqs (6) and (7), p. 467: orthant probabilities from the lattice rule (512 points, 12 shifts): P(Z1 < 0, Z2 < 0) = 1/3 and P(Z1 < 0, Z2 < 0, Z3 < 0) = 1/4 at rho 0.5, each within 3 standard errors; at rho 0 the rule gives 1/4 and 1/8 within 1e-6', () => {
    const cs = (m, rho) => { const R = new Float64Array(m * m); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) R[i * m + j] = i === j ? 1 : rho; return cholesky(R, m); };
    const bad = [];
    for (const [m, rho, want, tolFixed] of [[2, 0.5, 1 / 3, 0], [3, 0.5, 1 / 4, 0], [2, 0, 1 / 4, 1e-6], [3, 0, 1 / 8, 1e-6]]) {
      const r = mvnLowerSE(new Array(m).fill(0), cs(m, rho), m, mulberry32(2011), 512, 12);
      const tol = tolFixed || Math.max(3 * r.se, 1e-6);
      if (Math.abs(r.p - want) > tol) bad.push(`m = ${m}, rho ${rho}: ${r.p.toFixed(7)} (se ${r.se.toExponential(1)}) versus ${want.toFixed(7)}`);
    }
    return !bad.length || bad.join('; ');
  });

  /* Batch 4: power simulation (the Power tab's own code path: seed 2009, one-sided z-tests, mean = qnorm(1 - alpha) + qnorm(power)) */
  const power = (G, opts) => {
    const m = G.nodes.length, alpha = opts.alpha || 0.025, Rm = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) Rm[i * m + j] = i === j ? 1 : Math.min(opts.corr[i][j], 0.999999);
    const L = cholesky(Rm, m), za = qnorm(1 - alpha), mean = opts.means || opts.pw.map(x => za + qnorm(x / 100));
    const fg = floatGraph(G), tally = { n: 0, rej: Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 }, norm = normalGen(mulberry32(2009)), n = opts.n || 100000;
    while (tally.n < n) simulateChunk(fg, mean, L, alpha, Math.min(5000, n - tally.n), norm, tally, opts.success || null, null);
    return { rej: tally.rej.map(x => x / n), any: tally.any / n, all: tally.all / n, custom: tally.custom / n, means: mean };
  };
  const cs = (m, rho) => Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : rho)));
  check('Bretz, Maurer and Hommel (2011) Table I, p. 1497: general successive graph (Fig. 6), corr(Z1, Z2) = 1/2, corr(Z1, Z3) = corr(Z2, Z4) = rho, cross pairs rho/2, 100,000 runs with seed 2009: pi (H1 or H2 rejected) and pi1 to pi4 within 0.01 of the printed values for cases 8, 11 and 13 (all 14 cases are in the code; the full run takes about 13 s and every case is within 0.009)', () => {
    /* Columns: alpha1, alpha2, gamma1, gamma2, rho, theta1 to theta4, [pi, pi1, pi2, pi3, pi4] as printed. The app's values at seed 2009
       (100,000 runs) differ from the printed ones by at most 0.009 (case 10) over all 14 cases; run all of them with `run = cases.keys()`. */
    const cases = [
      [.0125, .0125, '1/2', '1/2', .5, 0, 0, 0, 0, [.025, .015, .014, .002, .001]],
      [.0125, .0125, '1/2', '1/2', .5, 3, 0, 0, 0, [.773, .773, .018, .006, .003]],
      [.0125, .0125, '1/2', '1/2', .5, 3, 0, 3, 0, [.774, .774, .022, .596, .003]],
      [.0125, .0125, '1/2', '1/2', .5, 3, 0, 3, 3, [.78, .78, .026, .606, .025]],
      [.0125, .0125, '1/2', '1/2', .5, 2, 0, 3, 3, [.404, .403, .023, .351, .022]],
      [.0125, .0125, '1/2', '1/2', .5, 1, 0, 3, 3, [.111, .108, .018, .102, .017]],
      [.0125, .0125, '1/2', '1/2', .5, 3, 3, 0, 0, [.897, .806, .806, .014, .015]],
      [.0125, .0125, '1/2', '1/2', .5, 3, 3, 2, 2, [.896, .808, .809, .409, .402]],
      [.0125, .0125, '1/2', '1/2', 0, 3, 3, 2, 2, [.899, .812, .81, .359, .353]],
      [.0125, .0125, '1/2', '1/2', .99, 3, 3, 2, 2, [.897, .812, .812, .448, .44]],
      [.0125, .0125, '1-ε', '1-ε', .5, 3, 0, 3, 0, [.774, .774, .024, .131, .004]],
      [.0125, .0125, '0', '0', .5, 3, 0, 3, 0, [.779, .779, .026, .663, .005]],
      [.025, 0, '0', '0', .5, 3, 0, 3, 0, [.85, .85, .023, .759, .004]],
      [.025, 0, '0', '0', .5, 0, 3, 3, 0, [.025, .025, .024, .024, .002]]];
    const run = [7, 10, 12]; /* cases 8, 11 and 13 */
    const oneMinus = g => (g === '1-ε' ? 'ε' : Q.exact(Q.sub(Q.ONE, Q.parse(g))));
    const bad = [];
    for (const k of run) {
      const [a1, a2, g1, g2, rho, t1, t2, t3, t4, want] = cases[k];
      const G = mk([Q.exact(Q.parse(String(a1 / 0.025))), Q.exact(Q.parse(String(a2 / 0.025))), '0', '0'], [['0', g1, oneMinus(g1), '0'], [g2, '0', '0', oneMinus(g2)], ['0', '1', '0', '0'], ['1', '0', '0', '0']]);
      const R = [[1, .5, rho, rho / 2], [.5, 1, rho / 2, rho], [rho, rho / 2, 1, .5], [rho / 2, rho, .5, 1]];
      const r = power(G, { alpha: 0.025, n: 100000, means: [t1, t2, t3, t4], corr: R, success: { idx: [0, 1], rule: 'any' } });
      const got = [r.custom, ...r.rej];
      if (!near(got, want, 0.01)) bad.push(`case ${k + 1}: app ${got.map(x => x.toFixed(3)).join(' ')} versus ${want.join(' ')}`);
    }
    return !bad.length || bad.join('; ');
  });
  check('Xi and Chen (2024) eq. (2), p. 477, Table 1, p. 479, and Table C2, p. 498; Zhan et al. (2022) Table 3, p. 100: 100,000 runs with seed 2009, alpha 0.025. Three independent tests at powers 90% (weights 1/3, no edges) have means 3.2415 and disjunctive power 0.99220 and conjunctive power 0.51518 (exact formulas); two tests with weights (0.404, 0.596) at powers (90, 80) have conjunctive power 0.60361; the FNN graph of Zhan et al., Fig. 5(a), rho 0.5, powers (95, 90, 85, 65, 60), gives (95.0, 86.7, 78.4, 54.6, 48.5) percent, all within 0.005', () => {
    const none = m => Array.from({ length: m }, () => Array(m).fill('0'));
    const G3 = mk(['1/3', '1/3', '1/3'], none(3)), r3 = power(G3, { pw: [90, 90, 90], corr: cs(3, 0), success: { idx: [0, 1, 2], rule: 'all' } });
    if (Math.abs(r3.means[0] - 3.2415) > 1e-4) return 'mean z ' + r3.means[0].toFixed(5);
    if (Math.abs(r3.any - 0.99220) > 0.005) return 'disjunctive ' + r3.any.toFixed(5);
    if (Math.abs(r3.custom - 0.51518) > 0.005 || r3.custom !== r3.all) return 'conjunctive ' + r3.custom.toFixed(5);
    const G2 = mk(['0.404', '0.596'], none(2)), r2 = power(G2, { pw: [90, 80], corr: cs(2, 0), success: { idx: [0, 1], rule: 'all' } });
    if (Math.abs(r2.custom - 0.60361) > 0.005) return 'two tests conjunctive ' + r2.custom.toFixed(5);
    /* Zhan et al. (2022) Fig. 5(a), transitions read from the figure */
    const Z = mk(['1', '0', '0', '0', '0'], [['0', '0.962', '0.038', '0', '0'], ['0', '0', '0.975', '0.023', '0.002'], ['0', '0.844', '0', '0.096', '0.06'], ['0', '0.597', '0.353', '0', '0.05'], ['0', '0.309', '0.564', '0.127', '0']]);
    const rz = power(Z, { pw: [95, 90, 85, 65, 60], corr: cs(5, 0.5) });
    return near(rz.rej, [0.950, 0.867, 0.784, 0.546, 0.485], 0.005) || 'Zhan powers ' + rz.rej.map(x => (100 * x).toFixed(2)).join(' ');
  });
  /* 1.3.4: worked examples from the methods check of 27 October 2026 */
  check('Wang and Ting (2014), Figs. 2 to 4 (pp. 4 to 6) and Table 1 (p. 5): two doses, non-inferiority H1, H2 and superiority on the primary and secondary endpoints (H3, H4 for the high dose; H5, H6 for the low dose), α 0.05, p = (0.005, 0.027, 0.020, 0.009, 0.133, 0.018). Gatekeeping (Fig. 2) rejects H1, H3, H4; Fig. 3 rejects H1, H2, H4, with H3 at 3α/8 and H2 at 5α/8 after H1 and H4; Fig. 4 (ε edges) rejects H1, H2, H3, H4, H6', () => {
    const L6 = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'], p = [0.005, 0.027, 0.020, 0.009, 0.133, 0.018], w = ['1/2', '1/2', '0', '0', '0', '0'];
    const z = () => Array.from({ length: 6 }, () => Array(6).fill('0'));
    const f2 = z(); f2[0][2] = f2[0][3] = f2[1][4] = f2[1][5] = '1/2'; f2[2][3] = f2[3][2] = f2[4][5] = f2[5][4] = '1';
    const f3 = z(); f3[0][2] = f3[0][3] = f3[1][4] = f3[1][5] = '1/2'; f3[2][3] = f3[2][1] = f3[3][2] = f3[3][1] = f3[4][5] = f3[4][0] = f3[5][4] = f3[5][0] = '1/2';
    const f4 = z(); f4[0][2] = f4[0][3] = f4[1][4] = f4[1][5] = '1/2'; f4[2][3] = f4[3][2] = f4[4][5] = f4[5][4] = '1-ε'; f4[2][1] = f4[3][1] = f4[4][0] = f4[5][0] = 'ε';
    const G2 = mk(w, f2, L6, 0.05), G3 = mk(w, f3, L6, 0.05), G4 = mk(w, f4, L6, 0.05);
    const rj = G => labels(G, runProcedure(stateFromGraph(G), pOfG(G, p), 0.05).order);
    if (rj(G2) !== 'H1,H3,H4') return 'Fig. 2 rejects ' + rj(G2);
    if (rj(G3) !== 'H1,H2,H4') return 'Fig. 3 rejects ' + rj(G3);
    const s = after(G3, ['H1', 'H4']);
    if (wOf(G3, s, 'H3') !== '3/8' || wOf(G3, s, 'H2') !== '5/8') return `Fig. 3 after H1, H4: H3 ${wOf(G3, s, 'H3')}, H2 ${wOf(G3, s, 'H2')}`;
    return rj(G4) === 'H1,H2,H3,H4,H6' || 'Fig. 4 rejects ' + rj(G4);
  });
  check('Wang et al. (2015), Fig. 3 (p. 18) and Table 1 (p. 19): primaries H1, H2 and secondaries H3, H4, α 0.05, five p-value rows under within-dose fixed sequences (Fig. 3(a)), Bonferroni parallel gatekeeping, serial gatekeeping with Holm in each family (ε edges) and the "no-dead-end" graph (Fig. 3(b)). All 20 printed results match except row 5 under serial gatekeeping, printed as H1 only: Holm rejects H1 then H2 (0.02 ≤ 0.025, 0.04 ≤ 0.05), then H3 and H4 (0.024 ≤ 0.025, 0.04 ≤ 0.05), so all four', () => {
    const L4 = ['H1', 'H2', 'H3', 'H4'], w = ['1/2', '1/2', '0', '0'];
    const fixed = mk(w, [[0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0]], L4, 0.05);
    const par = mk(w, [[0, 0, '1/2', '1/2'], [0, 0, '1/2', '1/2'], [0, 0, 0, 1], [0, 0, 1, 0]], L4, 0.05);
    const ser = mk(w, [[0, '1-ε', 'ε', 0], ['1-ε', 0, 0, 'ε'], [0, 0, 0, 1], [0, 0, 1, 0]], L4, 0.05);
    const nde = mk(w, [[0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 0, 0], [1, 0, 0, 0]], L4, 0.05);
    const rows = [
      [[0.02, 0.015, 0.012, 0.04], 'H1,H2,H3', 'H1,H2,H3,H4', 'H1,H2,H3,H4', 'H1,H2,H3,H4'],
      [[0.02, 0.04, 0.012, 0.024], 'H1,H3', 'H1,H3,H4', 'H1,H2,H3,H4', 'H1,H2,H3,H4'],
      [[0.02, 0.06, 0.012, 0.024], 'H1,H3', 'H1,H3,H4', 'H1', 'H1,H3'],
      [[0.02, 0.04, 0.04, 0.024], 'H1', 'H1', 'H1,H2,H3,H4', 'H1'],
      [[0.02, 0.04, 0.024, 0.04], 'H1,H3', 'H1', 'H1,H2,H3,H4', 'H1,H2,H3,H4']];
    const names = ['fixed sequence', 'parallel gatekeeping', 'serial gatekeeping', 'no-dead-end'];
    for (let r = 0; r < rows.length; r++) [fixed, par, ser, nde].forEach((G, k) => {
      const got = labels(G, runProcedure(stateFromGraph(G), pOfG(G, rows[r][0]), 0.05).order);
      if (got !== rows[r][k + 1]) throw new Error(`row ${r + 1}, ${names[k]}: ${got}`);
    });
    return true;
  });
  check('Koenig et al. (2025), Table 6 (p. 10): step-down Dunnett for three doses against placebo is the parametric test on an equally weighted Holm graph with correlation 1/2; p = (0.3492, 0.0247, 0.0065) gives adjusted p (0.3492, 0.0449, 0.0176), tolerance 0.0002', () => {
    const r = closedAdj(load(generatedTemplate('holm', 3)), [0.3492, 0.0247, 0.0065], 0.025, 'parametric', { corr: cs(3, 0.5) });
    return near(r.adj, [0.3492, 0.0449, 0.0176], 0.0002) || 'adjusted ' + r.adj.map(x => x.toFixed(5)).join(', ');
  });
  check('Koenig et al. (2025), Fig. 5 (p. 10) and Table 7 (p. 11): the efficacy and safety template is their graph for a primary (HE) and a secondary (HS) endpoint with three doses; the local levels of all seven printed intersections match exactly', () => {
    const G = load(templateJSON('efficacySafety')), labs = G.nodes.map(n => n.label);
    const want = { 'HE1,HE2,HE3,HS1,HS2,HS3': '1/3 1/3 1/3 0 0 0', 'HS1,HS2,HS3': '1/3 1/3 1/3', 'HE1,HE2,HS1,HS2,HS3': '1/3 1/3 0 0 1/3', 'HE1,HE2,HS1,HS2': '1/2 1/2 0 0', 'HE1,HS1,HS2,HS3': '1/3 0 1/3 1/3', 'HE1,HS1,HS3': '1/2 0 1/2', 'HE1,HS3': '1/2 1/2' };
    for (const [set, w] of Object.entries(want)) {
      const keep = set.split(','), st = after(G, labs.filter(l => !keep.includes(l)));
      const got = keep.map(l => wOf(G, st, l)).join(' ');
      if (got !== w) return `${set}: ${got}`;
    }
    return true;
  });
  check('Ristl et al. (2024), p. 606: the closed max-type test of two survival summaries is the parametric test on Holm(2) with the estimated correlation 0.87; p = (0.0100, 0.0053) gives adjusted p (0.0100, 0.0082), tolerance 0.0002', () => {
    const r = closedAdj(load(generatedTemplate('holm', 2)), [0.0100, 0.0053], 0.025, 'parametric', { corr: cs(2, 0.87) });
    return near(r.adj, [0.0100, 0.0082], 0.0002) || 'adjusted ' + r.adj.map(x => x.toFixed(5)).join(', ');
  });
  check('Guilbaud (2011), Fig. 1 (p. 928): the Hung and Wang template with ν = 1/5, τ = 3/10, ω = 1/2 has the default graph of four sequences with weights ντ = 3/50, ν(1 − τ) = 7/50, (1 − ν)ω = 2/5 and (1 − ν)(1 − ω) = 2/5. Example 1 and Table 1 (pp. 929, 933), Fig. 2A (τ = 0 and an edge of 1 from H2,S to H1,S): after H1,NI, H1,S holds ν and H2,NI 1 − ν; after H1,NI and H2,NI, H1,S holds ν + (1 − ν)ω and H2,S (1 − ν)(1 − ω)', () => {
    const G = load(templateJSON('hungWang'));
    G.vars = Object.assign({}, G.vars || {}, { 'ν': Q.parse('1/5'), 'τ': Q.parse('3/10'), 'ω': Q.parse('1/2') }); evaluateGraph(G);
    const lab = id => G.nodes.find(n => n.id === id).label, dg = defaultGraphOf(G);
    const got = dg.seqs.map(s => s.order.map(lab).join('>') + ':' + Q.exact(s.c)).sort().join(' ');
    const want = ['H1,NI>H1,S>H2,S:3/50', 'H1,NI>H1,S>H2,NI>H2,S:7/50', 'H1,NI>H2,NI>H1,S>H2,S:2/5', 'H1,NI>H2,NI>H2,S:2/5'].sort().join(' ');
    if (got !== want) return 'default graph ' + got;
    const A = mk(['1', '0', '0', '0'], [['0', '1/5', '4/5', '0'], ['0', '0', '1', '0'], ['0', '1/2', '0', '1/2'], ['0', '1', '0', '0']], ['H1,NI', 'H1,S', 'H2,NI', 'H2,S'], 0.025);
    let s = after(A, ['H1,NI']);
    if (wOf(A, s, 'H1,S') !== '1/5' || wOf(A, s, 'H2,NI') !== '4/5') return `Fig. 2A after H1,NI: ${wOf(A, s, 'H1,S')}, ${wOf(A, s, 'H2,NI')}`;
    s = after(A, ['H1,NI', 'H2,NI']);
    return (wOf(A, s, 'H1,S') === '3/5' && wOf(A, s, 'H2,S') === '2/5') || `Fig. 2A after H1,NI and H2,NI: ${wOf(A, s, 'H1,S')}, ${wOf(A, s, 'H2,S')}`;
  });
  check('Zhang, Quan, Ng and Stepanavage (1997), Table 6 and text (p. 218): weighted Holm with weights 1, 1, 2, 1 (here 1/5, 1/5, 2/5, 1/5), α 0.05, p = (0.0037, 0.0077, 0.0274, 0.0369) tests the endpoints at 0.0100, 0.0125, 0.0333 and 0.0500 in turn and rejects all four; equally weighted Holm rejects the first two; the closed Simes test rejects all four', () => {
    const w = ['1/5', '1/5', '2/5', '1/5'], G = mk(w, wHolm(w), null, 0.05), p = [0.0037, 0.0077, 0.0274, 0.0369];
    const r = runProcedure(stateFromGraph(G), pOfG(G, p), 0.05);
    if (r.order.map(id => G.nodes.find(n => n.id === id).label).join(',') !== 'H1,H2,H3,H4') return 'weighted Holm order ' + order(G, p, 0.05);
    let st = stateFromGraph(G); const lv = [];
    for (const id of r.order) { lv.push(Q.toNum(st.w.get(id)) * 0.05); st = rejectNode(st, id); }
    if (!near(lv, [0.01, 0.0125, 0.05 * 2 / 3, 0.05], 1e-12)) return 'levels ' + lv.map(x => x.toFixed(4)).join(', ');
    const Hm = load(generatedTemplate('holm', 4));
    if (order(Hm, p, 0.05) !== 'H1,H2') return 'Holm rejected ' + order(Hm, p, 0.05);
    const s = closedAdj(Hm, p, 0.05, 'simes');
    return s.rejected.every(Boolean) || 'closed Simes rejected ' + s.rejected.map(Number).join('');
  });
  check('Xi and Tamhane (2014), section 6 and Table III (pp. 1328 to 1329): at least 3 of 4 primaries (their γ = 1/2), α 0.05, p = (0.01, 0.02, 0.024, 0.04, 0.01) rejects H1 only; the adjusted p-values are 0.040 for H1 and 0.060 for H2 to H5 (T-HOLM), tolerance 0.0001 for ε = 1/1000', () => {
    const G = load(entangledKOfM(4, 3, 0.05)), p = [0.01, 0.02, 0.024, 0.04, 0.01];
    if (order(G, p, 0.05) !== 'H1') return 'rejected ' + order(G, p, 0.05);
    const a = adjustedPValues(stateFromGraph(G), pOfG(G, p)), got = G.nodes.map(n => a.get(n.id));
    return near(got, [0.04, 0.06, 0.06, 0.06, 0.06], 0.0001) || 'adjusted ' + got.map(x => x.toFixed(5)).join(', ');
  });
  check('Rauch and Beyersmann (2013), Figs. 2 and 3 (p. 3603): a composite CE and its component EP1 at α/2 each pass 1 − ε to each other and ε/2 to each of EP2 and EP3, which pass 1 to each other. After CE is rejected, EP1 holds 1 − ε/2 and EP2, EP3 ε/4 each (ε = 1/1000), with EP1 passing 1/2 to each, the ε → 0 graph of Fig. 3 (left); after CE and EP1, EP2 and EP3 hold 1/2 each and pass 1 to each other (Fig. 3, right)', () => {
    const G = mk(['1/2', '1/2', '0', '0'], [['0', '1-ε', 'ε/2', 'ε/2'], ['1-ε', '0', 'ε/2', 'ε/2'], ['0', '0', '0', '1'], ['0', '0', '1', '0']], ['CE', 'EP1', 'EP2', 'EP3'], 0.025);
    let s = after(G, ['CE']);
    const w1 = ['EP1', 'EP2', 'EP3'].map(l => wOf(G, s, l)).join(' ');
    if (w1 !== '1999/2000 1/4000 1/4000') return 'after CE: ' + w1;
    if (gOf(G, s, 'EP1', 'EP2') !== '1/2' || gOf(G, s, 'EP1', 'EP3') !== '1/2' || gOf(G, s, 'EP2', 'EP3') !== '1') return 'after CE, transitions ' + [gOf(G, s, 'EP1', 'EP2'), gOf(G, s, 'EP1', 'EP3'), gOf(G, s, 'EP2', 'EP3')].join(' ');
    s = after(G, ['CE', 'EP1']);
    return (wOf(G, s, 'EP2') === '1/2' && wOf(G, s, 'EP3') === '1/2' && gOf(G, s, 'EP2', 'EP3') === '1' && gOf(G, s, 'EP3', 'EP2') === '1') || `after CE and EP1: ${wOf(G, s, 'EP2')}, ${wOf(G, s, 'EP3')}`;
  });
  check('Giacalone et al. (2018), Tables 1 and 2 (pp. 5 to 6): Holm on 22 raw p-values at α 0.05 rejects nine hypotheses and gives the printed adjusted p-values to four decimals. The follow-up time p-value is 0.0577 as in Table 1 (Table 2 prints 0.0567 beside the adjusted 0.5770, a misprint); the paper caps adjusted p-values at 0.9999', () => {
    const p = [0.0281, 0.0019, 0.0001, 0.0002, 0.0032, 0.0004, 0.0053, 0.0008, 0.0007, 0.6274, 0.2755, 0.0006, 0.7376, 0.9852, 0.5074, 0.1553, 0.8858, 0.6075, 0.0316, 0.0003, 0.6643, 0.0577];
    const want = [0.3372, 0.0285, 0.0022, 0.0042, 0.0448, 0.0076, 0.0689, 0.0128, 0.0119, 0.9999, 0.9999, 0.0108, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.9999, 0.3476, 0.0060, 0.9999, 0.5770];
    const G = load(generatedTemplate('holm', 22)), a = adjustedPValues(stateFromGraph(G), pOfG(G, p)), got = G.nodes.map(n => Math.min(a.get(n.id), 0.9999));
    if (!near(got, want, 5e-5)) return 'adjusted ' + got.map(x => x.toFixed(4)).join(', ');
    const n = runProcedure(stateFromGraph(G), pOfG(G, p), 0.05).order.length;
    return n === 9 || 'rejected ' + n;
  });
  check('Maurer, Bretz and Posch (2022), Algorithm 1 (p. 759), the "otherwise 0" case: with w = (1/3, 1/3, 1/3), g12 = g21 = 1 and g31 = g32 = 1/2, removing H2 gives H1 the weight 2/3 and no outgoing edge (g13 = 0) and makes g31 = 1; after H1 and H2 are removed, in either order, H3 keeps 1/3', () => {
    const G = mk(['1/3', '1/3', '1/3'], [['0', '1', '0'], ['1', '0', '0'], ['1/2', '1/2', '0']], null, 0.05);
    const s = after(G, ['H2']);
    if (wOf(G, s, 'H1') !== '2/3' || gOf(G, s, 'H1', 'H3') !== '0' || gOf(G, s, 'H3', 'H1') !== '1') return `after H2: ${wOf(G, s, 'H1')}, g13 ${gOf(G, s, 'H1', 'H3')}, g31 ${gOf(G, s, 'H3', 'H1')}`;
    const a = after(G, ['H1', 'H2']), b = after(G, ['H2', 'H1']);
    return (wOf(G, a, 'H3') === '1/3' && wOf(G, b, 'H3') === '1/3') || `H3 ${wOf(G, a, 'H3')} and ${wOf(G, b, 'H3')}`;
  });
  return res;
}

/* Closed test in chunks so the page stays responsive; onProgress(done, total) */
/* Self-tests for entangled graphs (Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753), with the worked
   examples of the paper, Xi and Bretz (2019) and Guilbaud (2018). Levels are exact rationals; ε = 1/1000 throughout,
   so where the paper writes the ε → 0 limit (α/2 at step 3 of Fig. 3) the app shows (1 − ε)α/2. */
function runEntangledSelfTests() {
  const res = [];
  const check = (name, fn) => { try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); } catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); } };
  const load = o => deserializeGraph(o, false, 1).G;
  const byLabel = (G, l) => G.nodes.find(n => n.label === l).id;
  const pOfG = (G, p) => id => p[G.nodes.findIndex(n => n.id === id)];
  const lab = (G, ids) => ids.map(id => G.nodes.find(n => n.id === id).label).join(',');
  const lv = (G, st, l) => Q.toNum(st.w.get(byLabel(G, l)) || Q.ZERO) * G.alpha;
  const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
  /* Runs the procedure and records the combined levels before each rejection */
  const trace = (G, p) => {
    let st = stateFromGraph(G); const steps = [];
    for (;;) { const c = findCandidate(st, pOfG(G, p), G.alpha); const levels = Object.fromEntries(G.nodes.filter(n => st.ids.includes(n.id)).map(n => [n.label, lv(G, st, n.label)])); steps.push({ levels, reject: c ? G.nodes.find(n => n.id === c.id).label : null }); if (!c) break; st = rejectNode(st, c.id); }
    return steps;
  };
  const levelsAre = (got, want) => Object.keys(want).every(k => near(got[k], want[k], 1e-12)) || `levels ${JSON.stringify(got)}`;
  const F = () => load(entangledTemplateJSON('maurerFig2'));
  const pSec3 = [0.01, 0.022, 0.005, 0.012, 0.001];

  check('Maurer and Bretz (2013) Fig. 2 template loads as two components with c = (1/2, 1/2); G1 is their matrix on p. 1746', () => {
    const G = F(); if (!isEntangled(G) || G.ent.comps.length !== 2) return 'not two components';
    if (G.ent.c.map(Q.exact).join() !== '1/2,1/2') return 'c = ' + G.ent.c.map(Q.exact).join();
    const st = stateFromGraph(G), g1 = st.ent.comps[0].g, id = l => byLabel(G, l);
    const g = (a, b) => Q.exact(g1.get(gKey(id(a), id(b))) || Q.ZERO);
    const want = [['H1', 'H3', '1'], ['H2', 'H3', '1'], ['H3', 'H4', '999/1000'], ['H3', 'H5', '1/1000'], ['H4', 'H2', '1'], ['H5', 'H1', '0']];
    for (const [a, b, v] of want) if (g(a, b) !== v) return `${a} to ${b} is ${g(a, b)}`;
    const w1 = st.ent.comps[0].w, w2 = st.ent.comps[1].w;
    return (Q.exact(w1.get(id('H1'))) === '1' && Q.exact(w2.get(id('H2'))) === '1' && Q.exact(st.w.get(id('H1'))) === '1/2' && Q.exact(st.w.get(id('H3'))) === '0') || 'weights wrong';
  });
  check('Self-test B. Maurer and Bretz (2013) Fig. 3, p. 1747: the section 3.1 p-values on the entangled graph reject H1, H3, H4, H2, H5 in that order, all five, at levels 0.0125, 0.0125, (1−ε)0.0125, 0.0249875, 0.0249875', () => {
    const G = F(), t = trace(G, pSec3);
    if (t.map(x => x.reject).join(',') !== 'H1,H3,H4,H2,H5,') return 'order ' + t.map(x => x.reject).join(',');
    let r;
    if ((r = levelsAre(t[0].levels, { H1: 0.0125, H2: 0.0125, H3: 0, H4: 0, H5: 0 })) !== true) return 'step 0 ' + r;
    if ((r = levelsAre(t[1].levels, { H2: 0.0125, H3: 0.0125, H4: 0, H5: 0 })) !== true) return 'step 1 ' + r;
    if ((r = levelsAre(t[2].levels, { H2: 0.0125, H4: 0.0124875, H5: 0.0000125 })) !== true) return 'step 2 ' + r;
    if ((r = levelsAre(t[3].levels, { H2: 0.0249875, H5: 0.0000125 })) !== true) return 'step 3 ' + r;
    if ((r = levelsAre(t[4].levels, { H5: 0.0249875 })) !== true) return 'step 4 ' + r;
    const oa = orderAnalysis(stateFromGraph(G), pOfG(G, pSec3), 0.025);
    return (oa.finals.length === 1 && oa.finals[0].length === 5) || 'final set depends on the order';
  });
  check('Self-test B (contrast). The Fig. 1(a) single graph on the same p-values rejects only H1, H3, H5: the memory of the pairing {H1, H4} is what the entangled graph adds', () => {
    const o = { format: 'multiplicity-graph', alpha: 0.025, nodes: ['H1', 'H2', 'H3', 'H4', 'H5'].map((l, i) => ({ id: String(i), label: l, weight: i < 2 ? '1/2' : '0', x: 0, y: 0 })), edges: [[0, 2, '1'], [1, 2, '1'], [2, 3, '1/2'], [2, 4, '1/2']].map(r => ({ from: String(r[0]), to: String(r[1]), weight: r[2] })) };
    const G = load(o), r = runProcedure(stateFromGraph(G), pOfG(G, pSec3), 0.025);
    return lab(G, r.order) === 'H1,H3,H5' || 'rejected ' + lab(G, r.order);
  });
  check('Self-test C. Maurer and Bretz (2013) Fig. 4(b), p. 1748: the two fixed sequences (H1 H3 H4 H2 H5 and H2 H3 H5 H1 H4, c = 1/2 each) reject the same five in the same order at levels 1/80, 1/80, 1/80, 1/40, 1/40 (the Fig. 2 levels with ε = 0)', () => {
    const G = load(entangledTemplateJSON('maurerFig4')), t = trace(G, pSec3);
    if (t.map(x => x.reject).join(',') !== 'H1,H3,H4,H2,H5,') return 'order ' + t.map(x => x.reject).join(',');
    const got = t.slice(0, 5).map(x => x.levels[x.reject]);
    return got.every((v, k) => near(v, [1 / 80, 1 / 80, 1 / 80, 1 / 40, 1 / 40][k])) || 'levels ' + got.join(' ');
  });
  check('Self-test D. Maurer and Bretz (2013) Fig. 5, p. 1749, with γ1 = γ2 = 1/2: rejects H1 at 1/80, then H3 at 0.00625; H2 stays at 0.01875 and H4 at (1−ε)0.00625, so only H1 and H3 are rejected. With γ1 = γ2 = 1 it is the Fig. 2 graph again', () => {
    /* γ is a symbolic weight; a new variable defaults to 1/2 */
    const fig5 = () => entangledJSON({ nodes: [['H1', 0, 0], ['H2', 300, 0], ['H3', 150, 190], ['H4', 0, 380], ['H5', 300, 380]], c: ['1/2', '1/2'], comps: [
      { w: ['1', '0', '0', '0', '0'], edges: [[0, 1, '1-γ'], [0, 2, 'γ'], [1, 2, '1'], [2, 3, '1-ε'], [2, 4, 'ε'], [3, 1, '1']] },
      { w: ['0', '1', '0', '0', '0'], edges: [[1, 0, '1-γ'], [1, 2, 'γ'], [0, 2, '1'], [2, 4, '1-ε'], [2, 3, 'ε'], [4, 0, '1']] }] });
    const G = load(fig5()); if (Q.exact(G.vars['γ']) !== '1/2') return 'γ default ' + Q.exact(G.vars['γ']);
    const t = trace(G, pSec3);
    if (t.map(x => x.reject).join(',') !== 'H1,H3,') return 'order ' + t.map(x => x.reject).join(',');
    let r;
    if ((r = levelsAre(t[1].levels, { H2: 0.01875, H3: 0.00625, H4: 0, H5: 0 })) !== true) return 'step 1 ' + r;
    if ((r = levelsAre(t[2].levels, { H2: 0.01875, H4: 0.00624375, H5: 0.00000625 })) !== true) return 'step 2 ' + r;
    const G1 = load(fig5()); G1.vars['γ'] = Q.ONE; evaluateGraph(G1);
    const t1 = trace(G1, pSec3);
    return t1.map(x => x.reject).join(',') === 'H1,H3,H4,H2,H5,' || 'gamma = 1 order ' + t1.map(x => x.reject).join(',');
  });
  const kOfM = entangledKOfM;
  check('Self-test E. Maurer and Bretz (2013) section 5.3.2 and Fig. 6, p. 1751, at least 3 of 4 primaries, α 0.05: Holm on the primaries until three are rejected, the fourth at 3α/4, H5 at α/4 if the fourth is retained and at α if rejected', () => {
    const G = load(kOfM(4, 3, 0.05));
    if (G.ent.comps.length !== 4) return 'components ' + G.ent.comps.length;
    let t = trace(G, [0.01, 0.01, 0.01, 0.04, 0.01]), r;
    if (t.map(x => x.reject).join(',') !== 'H1,H2,H3,H5,') return 'case 1 order ' + t.map(x => x.reject).join(',');
    if ((r = levelsAre(t[0].levels, { H1: 0.0125, H2: 0.0125, H3: 0.0125, H4: 0.0125, H5: 0 })) !== true) return 'case 1 step 0 ' + r;
    if ((r = levelsAre(t[1].levels, { H2: 0.05 / 3, H3: 0.05 / 3, H4: 0.05 / 3, H5: 0 })) !== true) return 'case 1 step 1 ' + r;
    if ((r = levelsAre(t[2].levels, { H3: 0.025, H4: 0.025, H5: 0 })) !== true) return 'case 1 step 2 ' + r;
    if ((r = levelsAre(t[3].levels, { H4: 0.0375, H5: 0.0125 })) !== true) return 'case 1 step 3 ' + r;
    t = trace(G, [0.01, 0.01, 0.01, 0.03, 0.04]);
    if (t.map(x => x.reject).join(',') !== 'H1,H2,H3,H4,H5,') return 'case 2 order ' + t.map(x => x.reject).join(',');
    if ((r = levelsAre(t[4].levels, { H5: 0.05 })) !== true) return 'case 2 step 4 ' + r;
    t = trace(G, [0.01, 0.01, 0.03, 0.03, 0.001]);
    if (t.map(x => x.reject).join(',') !== 'H1,H2,') return 'case 3 order ' + t.map(x => x.reject).join(',');
    return levelsAre(t[2].levels, { H3: 0.025, H4: 0.025, H5: 0 });
  });
  check('Self-test F. Maurer and Bretz (2013) Appendix A, p. 1752: Holm on three hypotheses as the six fixed sequences with c = 1/6 matches the Holm graph step for step; two components with one transition matrix reduce to the single graph with weights sum of c_h w_h', () => {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const six = entangledJSON({ alpha: 0.05, nodes: [['H1', 0, 0], ['H2', 200, 0], ['H3', 400, 0]], c: perms.map(() => '1/6'), comps: perms.map(pm => { const w = ['0', '0', '0']; w[pm[0]] = '1'; return { w, edges: [[pm[0], pm[1], '1'], [pm[1], pm[2], '1']] }; }) });
    const G = load(six), H = load(generatedTemplate('holm', 3)); H.alpha = 0.05;
    const p = [0.01, 0.02, 0.03], a = trace(G, p), b = trace(H, p);
    if (a.map(x => x.reject).join() !== b.map(x => x.reject).join()) return 'orders differ';
    for (let k = 0; k < a.length; k++) for (const l of Object.keys(a[k].levels)) if (!near(a[k].levels[l], b[k].levels[l])) return `step ${k} level of ${l}: ${a[k].levels[l]} vs ${b[k].levels[l]}`;
    if (isAlphaExhaustive(G) !== true) return 'six sequences not exhaustive';
    const W1 = closureWeights(floatGraph(G)), W2 = closureWeights(floatGraph(H));
    for (let i = 0; i < W1.length; i++) if (!near(W1[i], W2[i], 1e-12)) return 'closure weights differ at ' + i;
    const same = load(entangledJSON({ nodes: [['H1', 0, 0], ['H2', 200, 0], ['H3', 400, 0]], c: ['1/2', '1/2'], comps: [{ w: ['1', '0', '0'], edges: [[0, 1, '1/2'], [0, 2, '1/2'], [1, 2, '1'], [2, 1, '1']] }, { w: ['0', '1', '0'], edges: [[0, 1, '1/2'], [0, 2, '1/2'], [1, 2, '1'], [2, 1, '1']] }] }));
    const col = entCollapse(same); if (!col) return 'collapse refused';
    if (col.nodes.map(n => n.weight).join() !== '1/2,1/2,0' || col.ent) return 'collapsed weights ' + col.nodes.map(n => n.weight).join();
    const Gc = load(col), q = [0.011, 0.012, 0.001];
    if (lab(same, runProcedure(stateFromGraph(same), pOfG(same, q), 0.025).order) !== lab(Gc, runProcedure(stateFromGraph(Gc), pOfG(Gc, q), 0.025).order)) return 'collapsed graph rejects differently';
    const different = F();
    return entCollapse(different) === null || 'Fig. 2 should not collapse';
  });
  check('Self-test G. Guilbaud (2018) Example 11 and Fig. 5(b), p. 230, at least 2 of 3 primaries, α 0.05: p = (0.01, 0.02, 0.04, 0.015) rejects H1, H2 and H4 with H3 retained at 1/30; (0.01, 0.01, 0.01, 0.04) rejects all four, H4 at 1/20; (0.01, 0.03, 0.04, 0.001) rejects H1 only', () => {
    const G = load(kOfM(3, 2, 0.05));
    if (G.ent.comps.length !== 3) return 'components ' + G.ent.comps.length;
    let t = trace(G, [0.01, 0.02, 0.04, 0.015]), r;
    if (t.map(x => x.reject).join(',') !== 'H1,H2,H4,') return 'case 1 order ' + t.map(x => x.reject).join(',');
    if ((r = levelsAre(t[0].levels, { H1: 1 / 60, H2: 1 / 60, H3: 1 / 60, H4: 0 })) !== true) return 'case 1 step 0 ' + r;
    if ((r = levelsAre(t[1].levels, { H2: 1 / 40, H3: 1 / 40, H4: 0 })) !== true) return 'case 1 step 1 ' + r;
    if ((r = levelsAre(t[2].levels, { H3: 1 / 30, H4: 1 / 60 })) !== true) return 'case 1 step 2 ' + r;
    t = trace(G, [0.01, 0.01, 0.01, 0.04]);
    if (t.map(x => x.reject).join(',') !== 'H1,H2,H3,H4,') return 'case 2 order ' + t.map(x => x.reject).join(',');
    if ((r = levelsAre(t[3].levels, { H4: 1 / 20 })) !== true) return 'case 2 step 3 ' + r;
    t = trace(G, [0.01, 0.03, 0.04, 0.001]);
    return t.map(x => x.reject).join(',') === 'H1,' || 'case 3 order ' + t.map(x => x.reject).join(',');
  });
  check('Self-test H. Xi and Bretz (2019) section 5.1 and Fig. 5, pp. 5275-5276: closed weighted Simes on the entangled parallel gatekeeping graph (γ = 1/2) with p = (0.01, 0.015, 0.011, 0.03) at α 0.025 rejects H1, H2, H3 but not H4; the intersection weights are those of their Table 3 shape, {H2, H3, H4} = (3/4, 1/8, 1/8)', () => {
    const o = entangledJSON({ nodes: [['H1', 0, 0], ['H2', 300, 0], ['H3', 0, 220], ['H4', 300, 220]], c: ['1/2', '1/2'], comps: [
      { w: ['1/2', '1/2', '0', '0'], edges: [[0, 1, '1'], [1, 0, '1-ε'], [1, 2, 'ε/2'], [1, 3, 'ε/2'], [2, 3, '1'], [3, 2, '1']] },
      { w: ['1/2', '1/2', '0', '0'], edges: [[0, 2, '1/2'], [0, 3, '1/2'], [1, 2, '1/2'], [1, 3, '1/2'], [2, 3, '1'], [3, 2, '1']] }] });
    const G = load(o), p = [0.01, 0.015, 0.011, 0.03];
    const r = closedTest(floatGraph(G), p, 0.025, 'simes', { upscale: false });
    if (r.rejected.join() !== 'true,true,true,false') return 'rejected ' + r.rejected.join();
    const W = r.W, m = 4, wOf = (mask, i) => W[mask * m + i];
    const full = 15, m234 = 14, m134 = 13, m34 = 12;
    if (!near(wOf(full, 0), 0.5) || !near(wOf(full, 1), 0.5) || !near(wOf(full, 2), 0) || !near(wOf(full, 3), 0)) return 'full set weights';
    if (!near(wOf(m234, 1), 0.75) || !near(wOf(m234, 2), 0.125) || !near(wOf(m234, 3), 0.125)) return '{H2,H3,H4} weights ' + [1, 2, 3].map(i => wOf(m234, i)).join();
    if (!near(wOf(m134, 0), 0.74975) || !near(wOf(m134, 2), 0.125125)) return '{H1,H3,H4} weights ' + [0, 2, 3].map(i => wOf(m134, i)).join();
    if (!near(wOf(m34, 2), 0.5) || !near(wOf(m34, 3), 0.5)) return '{H3,H4} weights';
    const b = runProcedure(stateFromGraph(G), pOfG(G, p), 0.025);
    return lab(G, b.order.slice().sort()) === 'H1,H2,H3' || 'Bonferroni rejected ' + lab(G, b.order);
  });
  check('Self-test I. At least k of m (Maurer and Bretz, 2013, section 5.3.2, p. 1751; Robertson, Wason and Bretz, 2020, Table 4, p. 3148): after H1 to Hk are rejected the secondary holds 1/C(m, k) and each remaining primary (1 − 1/C(m, k))/(m − k); after r ≥ k rejections the secondary holds C(r, k)/C(m, k); the template note states the same levels (3 of 4: 3α/4 and α/4)', () => {
    const choose = (n, r) => { let x = 1; for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i; return x; };
    const said = { '4,3': ['α/4', '3α/4'], '4,2': ['α/6', '5α/12'], '3,2': ['α/3', '2α/3'], '4,1': ['α/4', 'α/4'], '6,3': ['α/20', '19α/60'] };
    for (const [m, k] of [[3, 1], [3, 2], [4, 1], [4, 2], [4, 3], [5, 2], [6, 3], [6, 5]]) {
      const o = kOfM(m, k, 0.025), G = load(o), ids = G.nodes.map(n => n.id), sec = ids[m], C = choose(m, k);
      let st = stateFromGraph(G);
      for (let r = 1; r <= m; r++) {
        st = rejectNode(st, ids[r - 1]);
        if (r < k) continue;
        if (!near(Q.toNum(st.w.get(sec)), choose(r, k) / C)) return `${k} of ${m}, r = ${r}: secondary ${Q.exact(st.w.get(sec))}`;
        if (r === k) for (let i = k; i < m; i++) if (!near(Q.toNum(st.w.get(ids[i])), (1 - 1 / C) / (m - k))) return `${k} of ${m}: H${i + 1} ${Q.exact(st.w.get(ids[i]))}`;
      }
      const s = said[m + ',' + k];
      if (s && !(o.note.includes(`= ${s[0]} and each remaining primary`) && o.note.includes(`= ${s[1]}. Each further`))) return `${k} of ${m}: the note does not state ${s.join(' and ')}`;
    }
    return true;
  });
  check('Entangled JSON (version 2) and the share link round-trip every component, c, ε expressions and the active component; the top-level graph is component 1', () => {
    const G = F(); entLoad(G, 1);
    const o = serializeGraph(G);
    if (o.version !== 2 || !o.ent || o.ent.active !== 1 || o.ent.comps.length !== 2) return 'serialise';
    if (o.nodes[0].weight !== '1' || o.nodes[1].weight !== '0') return 'top level is not component 1';
    const back = load(o);
    if (!isEntangled(back) || back.ent.active !== 1) return 'active lost';
    if (JSON.stringify(serializeGraph(back).ent) !== JSON.stringify(o.ent)) return 'JSON round trip changed the components';
    const link = load(decodeShare(encodeShare(G)));
    if (JSON.stringify(serializeGraph(link).ent) !== JSON.stringify(o.ent)) return 'share link changed the components';
    if (JSON.stringify(serializeGraph(link).edges) !== JSON.stringify(o.edges)) return 'share link changed the edges';
    const r1 = lab(G, runProcedure(stateFromGraph(G), pOfG(G, pSec3), 0.025).order), r2 = lab(link, runProcedure(stateFromGraph(link), pOfG(link, pSec3), 0.025).order);
    if (r1 !== r2) return 'link rejects differently';
    const v1 = load(Object.assign({}, o, { ent: undefined }));
    return (!isEntangled(v1) && v1.nodes.map(n => Q.exact(n.w)).join() === '1,0,0,0,0') || 'older reader would not get component 1';
  });
  check('Entangled validation and exhaustiveness: Fig. 2 gets only the two leaf warnings (H5 in graph 1, H4 in graph 2). With ε = 1/1000 it is not exactly alpha-exhaustive (the intersection {H2} of graph 1 has weight 1 − ε, the ε share lost at the leaf H5); the ε-free Fig. 4(b) form is. c summing to more than 1 is an error; a component with weights summing to less than 1 is reported with its number', () => {
    const G = F();
    const v0 = validateGraph(G, q => Q.fmt(q));
    if (v0.length !== 2 || !v0.every(x => x.level === 'warn') || !/^Graph 1: H5 has no outgoing/.test(v0[0].text) || !/^Graph 2: H4 has no outgoing/.test(v0[1].text)) return 'Fig. 2 validation: ' + v0.map(v => v.text).join('; ');
    if (isAlphaExhaustive(G) !== false) return 'Fig. 2 with a real ε should not be exhaustive';
    const W1 = closureWeights(floatGraph(entViewGraph(G, 0))), i2 = G.nodes.findIndex(n => n.label === 'H2');
    if (!near(W1[(1 << i2) * 5 + i2], 0.999, 1e-12)) return '{H2} weight in graph 1 is ' + W1[(1 << i2) * 5 + i2];
    const G4 = load(entangledTemplateJSON('maurerFig4'));
    if (isAlphaExhaustive(G4) !== true) return 'Fig. 4(b) not exhaustive';
    const v4 = validateGraph(G4, q => Q.fmt(q));
    if (v4.length !== 2 || !v4.every(x => x.level === 'warn' && /no outgoing/.test(x.text))) return 'Fig. 4(b) validation: ' + v4.map(v => v.text).join('; ');
    G.ent.c = [Q.parse('3/4'), Q.parse('1/2')];
    const v = validateGraph(G, q => Q.fmt(q)); if (!v.some(x => x.level === 'error' && /add up to 5\/4/.test(x.text))) return 'c sum not reported';
    if (isAlphaExhaustive(G) !== false) return 'c sum 5/4 called exhaustive';
    const H = F(); H.ent.comps[1].w[H.nodes[1].id] = Q.parse('1/2');
    const vh = validateGraph(H, q => Q.fmt(q));
    if (!vh.some(x => /^Graph 2: Initial weights add up to 1\/2/.test(x.text))) return 'component 2 shortfall not reported: ' + vh.map(x => x.text).join('; ');
    return isAlphaExhaustive(H) === false || 'shortfall called exhaustive';
  });
  check('Float shortcut, exact step-through and closed Bonferroni agree on 200 random entangled graphs (m 2 to 5, 2 or 3 components); the final set does not depend on the rejection order', () => {
    let seed = 2013; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    for (let t = 0; t < 200; t++) {
      const m = ri(2, 5), n = ri(2, 3), alpha = 0.05;
      const comps = Array.from({ length: n }, () => {
        const raw = Array.from({ length: m }, () => (rnd() < 0.3 ? 0 : ri(1, 5))); if (raw.every(v => !v)) raw[ri(0, m - 1)] = 1;
        const tot = raw.reduce((a, b) => a + b, 0);
        const edges = [];
        for (let i = 0; i < m; i++) { const row = Array.from({ length: m }, (_, j) => (i === j || rnd() < 0.3 ? 0 : ri(1, 4))); const rs = row.reduce((a, b) => a + b, 0) || 1; row.forEach((v, j) => { if (v) edges.push([i, j, `${v}/${rs}`]); }); }
        return { w: raw.map(v => `${v}/${tot}`), edges };
      });
      const cr = Array.from({ length: n }, () => ri(1, 4)), ct = cr.reduce((a, b) => a + b, 0);
      const G = load(entangledJSON({ alpha, nodes: Array.from({ length: m }, (_, i) => [`H${i + 1}`, i * 100, 0]), c: cr.map(v => `${v}/${ct}`), comps }));
      const p = Array.from({ length: m }, () => rnd() * 0.08), pOf = pOfG(G, p);
      const exact = new Set(runProcedure(stateFromGraph(G), pOf, alpha).order.map(id => G.nodes.findIndex(x => x.id === id)));
      const out = new Uint8Array(m); runShortcut(floatGraph(G), Float64Array.from(p), alpha, out);
      for (let i = 0; i < m; i++) if (!!out[i] !== exact.has(i)) return `float vs exact at graph ${t}`;
      const ct2 = closedTest(floatGraph(G), p, alpha, 'bonferroni', { upscale: false });
      for (let i = 0; i < m; i++) if (ct2.rejected[i] !== exact.has(i)) return `closed test vs exact at graph ${t}`;
      const oa = orderAnalysis(stateFromGraph(G), pOf, alpha);
      if (oa.finals.length !== 1) return `order-dependent final set at graph ${t}`;
      const adj = adjustedPValues(stateFromGraph(G), pOf);
      for (let i = 0; i < m; i++) if ((adj.get(G.nodes[i].id) <= alpha * (1 + 1e-9)) !== exact.has(i)) return `adjusted p vs exact at graph ${t}`;
    }
    return true;
  });
  check('gMCP code import: the source of Entangled1Maurer2012() (rbind with "1-\\epsilon", reused variables m and weights, new("graphMCP"), new("entangledMCP")) parses to the Fig. 2 template; an inline new("entangledMCP") works; code without one is refused', () => {
    const code = ['library(gMCP)', 'm <- rbind(H1=c(0, 0, 1, 0, 0), H2=c(0, 0, 1, 0, 0), H3=c(0, 0, 0, "1-\\epsilon", "\\epsilon"), H4=c(0, 1, 0, 0, 0), H5=c(0, 0, 0, 0, 0))', 'weights <- c(1, 0, 0, 0, 0)', 'graph1 <- new("graphMCP", m=m, weights=weights)',
      'm <- rbind(H1=c(0, 0, 1, 0, 0), H2=c(0, 0, 1, 0, 0), H3=c(0, 0, 0, "\\epsilon", "1-\\epsilon"), H4=c(0, 0, 0, 0, 0), H5=c(1, 0, 0, 0, 0))', 'weights <- c(0, 1, 0, 0, 0)', 'graph2 <- new("graphMCP", m=m, weights=weights)',
      'graph <- new("entangledMCP", subgraphs=list(graph1,graph2), weights=c(0.5,0.5))'].join('\n');
    const r = parseEntangledR(code);
    if (r.m !== 5 || r.names.join() !== 'H1,H2,H3,H4,H5' || r.c.join() !== '1/2,1/2' || r.comps.length !== 2) return 'shape ' + JSON.stringify([r.m, r.names, r.c]);
    if (r.comps[0].rows[2].join() !== '0,0,0,1-ε,ε' || r.comps[1].rows[4].join() !== '1,0,0,0,0' || r.comps[1].w.join() !== '0,1,0,0,0') return 'values ' + JSON.stringify(r.comps);
    const o = entangledJSON({ nodes: r.names.map((nm, i) => [nm, i * 100, 0]), c: r.c, comps: r.comps.map(cs => ({ w: cs.w, edges: cs.rows.flatMap((row, i) => row.map((v, j) => (i !== j && v !== '0' ? [i, j, v] : null)).filter(Boolean)) })) });
    const G = load(o), t = trace(G, pSec3);
    if (t.map(x => x.reject).join(',') !== 'H1,H3,H4,H2,H5,') return 'imported graph rejects ' + t.map(x => x.reject).join(',');
    const r2 = parseEntangledR('new("entangledMCP", subgraphs = list(new("graphMCP", m = matrix(c(0, 1, 1, 0), nrow = 2), weights = c(1, 0)), new("graphMCP", m = matrix(c(0, 1, 1, 0), nrow = 2), weights = c(0, 1))), weights = c(1/2, 1/2))');
    if (r2.m !== 2 || r2.comps[1].w.join() !== '0,1') return 'inline form';
    try { parseEntangledR('x <- c(1, 2)'); return 'no entangledMCP should be refused'; } catch (e) { if (!/entangledMCP/.test(e.message)) return 'wrong message: ' + e.message; }
    return true;
  });
  check('Templates: Fig. 5 (γ1 = γ2 = 1/2 by default) matches self-test D and equals Fig. 2 at γ1 = γ2 = 1; the truncated Holm gatekeeping template is the Xi and Bretz (2019) Fig. 5 graph (closed Simes rejects H1, H2, H3); entangled truncated Holm on 3 hypotheses at γ = 1/2 tests at α/3, then (γ/2 + (1 − γ)/3)α, then (γ + (1 − γ)/3)α (Dmitrienko, Tamhane and Wiens, 2008)', () => {
    const G5 = load(entangledTemplateJSON('maurerFig5'));
    if (Q.exact(G5.vars['γ1']) !== '1/2' || Q.exact(G5.vars['γ2']) !== '1/2') return 'γ defaults';
    if (trace(G5, pSec3).map(x => x.reject).join(',') !== 'H1,H3,') return 'Fig. 5 default rejects ' + trace(G5, pSec3).map(x => x.reject).join(',');
    G5.vars['γ1'] = Q.ONE; G5.vars['γ2'] = Q.ONE; evaluateGraph(G5);
    const a = trace(G5, pSec3), b = trace(F(), pSec3);
    for (let k = 0; k < b.length; k++) for (const l of Object.keys(b[k].levels)) if (!near(a[k].levels[l], b[k].levels[l])) return `Fig. 5 at γ = 1 differs from Fig. 2 at step ${k}, ${l}`;
    const Gt = load(entangledTemplateJSON('truncatedHolmGate'));
    if (Q.exact(Gt.ent.c[0]) !== '1/2' || Gt.ent.cexpr.join() !== 'γ,1-γ') return 'gatekeeping c: ' + Gt.ent.c.map(Q.exact).join() + ' ' + Gt.ent.cexpr.join();
    const rs = closedTest(floatGraph(Gt), [0.01, 0.015, 0.011, 0.03], 0.025, 'simes', { upscale: false });
    if (rs.rejected.join() !== 'true,true,true,false') return 'gatekeeping Simes rejected ' + rs.rejected.join();
    const Gh = load(entangledTruncatedHolm(3)); Gh.alpha = 0.05;
    const t = trace(Gh, [0.01, 0.02, 0.03]);
    if (t.map(x => x.reject).join(',') !== 'H1,H2,H3,') return 'truncated Holm order ' + t.map(x => x.reject).join(',');
    const want = [0.05 / 3, (0.25 + 1 / 6) * 0.05, (0.5 + 1 / 6) * 0.05];
    for (let k = 0; k < 3; k++) if (!near(t[k].levels[t[k].reject], want[k], 1e-12)) return `truncated Holm step ${k}: ${t[k].levels[t[k].reject]} vs ${want[k]}`;
    Gh.vars['γ'] = Q.ONE; evaluateGraph(Gh);
    const th = trace(Gh, [0.01, 0.02, 0.03]);
    return (near(th[1].levels.H2, 0.025) && near(th[2].levels.H3, 0.05)) || 'γ = 1 is not Holm';
  });
  check('Switching the active component keeps every component intact; a hypothesis added later has weight 0 in the other components; symbolic ε in a hidden component follows the variables panel', () => {
    const G = F();
    const sum = () => stateFromGraph(G).ent.comps.map(cs => [...cs.w.values()].reduce((a, b) => Q.add(a, b), Q.ZERO)).map(Q.exact).join();
    if (sum() !== '1,1') return 'sums ' + sum();
    entLoad(G, 1); if (Q.exact(G.nodes[1].w) !== '1' || !G.edges.some(e => e.expr === '1-ε' && e.from === byLabel(G, 'H3') && e.to === byLabel(G, 'H5'))) return 'component 2 not loaded';
    entLoad(G, 0); if (Q.exact(G.nodes[0].w) !== '1' || sum() !== '1,1') return 'component 1 not restored';
    G.nodes.push({ id: 'n99', label: 'H6', w: Q.ZERO, x: 0, y: 0, p: '', color: '', desc: '', group: '' });
    const st = stateFromGraph(G);
    if (Q.exact(st.ent.comps[1].w.get('n99')) !== '0' || st.ids.length !== 6) return 'new hypothesis missing from component 2';
    G.vars['ε'] = Q.parse('1/10'); evaluateGraph(G);
    const g2 = stateFromGraph(G).ent.comps[1].g.get(gKey(byLabel(G, 'H3'), byLabel(G, 'H5')));
    return Q.exact(g2) === '9/10' || 'hidden component kept the old ε: ' + Q.exact(g2);
  });
  check('Default graph (Appendix A, pp. 1752-1753): Holm on m hypotheses is all m! sequences at 1/m! (p. 1753); Fig. 5 is the four hierarchies of p. 1749 and at γ1 = γ2 = 1 the two of Fig. 4(a); Fig. 2 with ε = 1/1000 gives the Fig. 4(a) chains at (1 − ε)/2 plus ε-order sequences; 100 random graphs (ordinary and entangled) reproduce the Algorithm 2 weights, and the entangled form of the sequences does too; the text import round trip', () => {
    const seqText = (G, s) => s.order.map(id => G.nodes.find(n => n.id === id).label).join('>');
    for (const m of [3, 4]) {
      const H = load(templateJSON('holm'));
      while (H.nodes.length < m) { const id = 'x' + H.nodes.length; H.nodes.push({ id, label: 'H' + (H.nodes.length + 1), w: Q.ZERO, x: 0, y: 0, p: '', color: '', desc: '', group: '' }); }
      const ids = H.nodes.map(n => n.id);
      for (const n of H.nodes) n.w = Q.make(1n, BigInt(m));
      H.edges = []; for (const a of ids) for (const b of ids) if (a !== b) H.edges.push({ from: a, to: b, g: Q.make(1n, BigInt(m - 1)), bend: null });
      const dg = defaultGraphOf(H);
      const fact = [1, 1, 2, 6, 24][m];
      if (dg.seqs.length !== fact || !dg.seqs.every(s => Q.exact(s.c) === `1/${fact}` && s.order.length === m && !s.partial)) return `Holm m = ${m}: ${dg.seqs.length} sequences, first ${dg.seqs.length ? Q.exact(dg.seqs[0].c) : '-'}`;
      if (Q.exact(dg.total) !== '1') return 'Holm total ' + Q.exact(dg.total);
    }
    const F5 = load(entangledTemplateJSON('maurerFig5'));
    /* with ε = 1/1000 the four hierarchies of p. 1749 carry the factor 1 − ε, and ε-order sequences end early (an ε
       share reaches a leaf); at ε = 0 exactly the two-cycle H3 <-> H4 has product 1 and the update gives 0, so the
       paper's ε-free reading is the limit, not the value at 0 */
    const bigOnes = dg => dg.seqs.filter(s => Q.cmp(s.c, Q.parse('1/100')) >= 0);
    F5.vars['γ1'] = Q.parse('1/3'); F5.vars['γ2'] = Q.parse('1/5'); evaluateGraph(F5);
    const d5 = defaultGraphOf(F5), b5 = bigOnes(d5);
    const want5 = { 'H1>H2>H3>H4>H5': '333/1000', 'H1>H3>H4>H2>H5': '333/2000', 'H2>H1>H3>H5>H4': '999/2500', 'H2>H3>H5>H1>H4': '999/10000' };
    if (b5.length !== 4 || !b5.every(s => want5[seqText(F5, s)] === Q.exact(s.c) && !s.partial) || !d5.seqs.slice(4).every(s => s.partial) || Q.exact(d5.total) !== '1') return 'Fig. 5 at γ1 = 1/3, γ2 = 1/5: ' + d5.seqs.map(s => seqText(F5, s) + ' ' + Q.exact(s.c) + (s.partial ? '*' : '')).join('; ');
    F5.vars['γ1'] = Q.ONE; F5.vars['γ2'] = Q.ONE; evaluateGraph(F5);
    const b5b = bigOnes(defaultGraphOf(F5));
    if (b5b.length !== 2 || b5b.map(s => seqText(F5, s) + ' ' + Q.exact(s.c)).sort().join('; ') !== 'H1>H3>H4>H2>H5 999/2000; H2>H3>H5>H1>H4 999/2000') return 'Fig. 4(a): ' + b5b.map(s => seqText(F5, s) + ' ' + Q.exact(s.c)).join('; ');
    const F2 = F(); const d2 = defaultGraphOf(F2);
    const big = d2.seqs.filter(s => Q.cmp(s.c, Q.parse('1/100')) >= 0);
    if (big.length !== 2 || big.map(s => seqText(F2, s) + ' ' + Q.exact(s.c)).sort().join('; ') !== 'H1>H3>H4>H2>H5 999/2000; H2>H3>H5>H1>H4 999/2000') return 'Fig. 2 main chains: ' + big.map(s => seqText(F2, s) + ' ' + Q.exact(s.c)).join('; ');
    if (!d2.seqs.some(s => s.partial) || Q.exact(d2.total) !== '1') return 'Fig. 2 ε sequences: partial ' + d2.seqs.filter(s => s.partial).length + ', total ' + Q.exact(d2.total);
    /* random graphs: the hypotheses are tested, for every intersection J, at the sum of the weights of the sequences
       in which they come first among J (section 5.1, p. 1748), which must equal v_i(J) of Algorithm 2 */
    const rnd = mulberry32(2013);
    const randomGraph = (m, ent) => {
      const o = { format: 'multiplicity-graph', version: ent ? 2 : 1, alpha: 0.025, nodes: [], edges: [] };
      const mk = () => {
        const w = Array.from({ length: m }, () => Math.floor(rnd() * 3)); if (!w.some(Boolean)) w[0] = 1; const sw = w.reduce((a, b) => a + b, 0);
        const nodes = w.map((x, i) => ({ id: String(i), weight: `${x}/${sw}` }));
        const edges = [];
        for (let i = 0; i < m; i++) { const g = Array.from({ length: m }, (_, j) => (j === i ? 0 : Math.floor(rnd() * 3))); const sg = g.reduce((a, b) => a + b, 0) + (rnd() < 0.3 ? 1 : 0); if (!sg) continue; g.forEach((x, j) => { if (x) edges.push({ from: String(i), to: String(j), weight: `${x}/${sg}`, bend: null }); }); }
        return { nodes, edges };
      };
      const c1 = mk();
      o.nodes = c1.nodes.map((n, i) => Object.assign({ label: 'H' + (i + 1), x: 0, y: 0, p: '' }, n)); o.edges = c1.edges;
      if (ent) { const c2 = mk(); o.ent = { c: ['1/3', '2/3'], active: 0, comps: [c1, c2] }; }
      return load(o);
    };
    for (let t = 0; t < 100; t++) {
      const m = 2 + Math.floor(rnd() * 4), ent = t % 2 === 1, Gr = randomGraph(m, ent);
      const dg = defaultGraphOf(Gr); if (!dg) return 'no decomposition';
      const W = closureWeights(floatGraph(Gr)), ids = Gr.nodes.map(n => n.id);
      for (let mask = 1; mask < (1 << m); mask++) {
        const v = new Array(m).fill(0);
        for (const s of dg.seqs) { const first = s.order.find(id => mask & (1 << ids.indexOf(id))); if (first != null) v[ids.indexOf(first)] += Q.toNum(s.c); }
        for (let i = 0; i < m; i++) if (mask & (1 << i) && !near(v[i], W[mask * m + i], 1e-9)) return `random ${t} (m = ${m}${ent ? ', entangled' : ''}): J = ${mask}, H${i + 1}: sequences give ${v[i]}, Algorithm 2 gives ${W[mask * m + i]}`;
      }
      const E = load(defaultGraphToEntangled(Gr, dg)), WE = closureWeights(floatGraph(E));
      for (let i = 0; i < W.length; i++) if (!near(W[i], WE[i], 1e-9)) return `random ${t}: entangled form of the sequences differs at ${i}`;
      if (E.ent.comps.length !== dg.seqs.length) return 'component count';
    }
    const parsed = parseDefaultGraph('# Fig. 4(a)\nH1 > H3 > H4 > H2 > H5 : 1/2\nH2 → H3 → H5 → H1 → H4 = 1/2');
    const P = load(defaultGraphJSON(parsed, Array.from({ length: 5 }, (_, i) => ({ x: i * 100, y: 0 })), 0.025));
    const F4 = load(entangledTemplateJSON('maurerFig4')), W4 = closureWeights(floatGraph(F4)), WP = closureWeights(floatGraph(P));
    if (P.nodes.map(n => n.label).join(',') !== 'H1,H3,H4,H2,H5' || P.ent.comps.length !== 2) return 'import shape';
    const perm = P.nodes.map(n => F4.nodes.findIndex(x => x.label === n.label));
    for (let mask = 1; mask < 32; mask++) { let mask4 = 0; for (let i = 0; i < 5; i++) if (mask & (1 << i)) mask4 |= 1 << perm[i]; for (let i = 0; i < 5; i++) if (mask & (1 << i) && !near(WP[mask * 5 + i], W4[mask4 * 5 + perm[i]], 1e-12)) return 'imported Fig. 4(a) differs from the Fig. 4(b) template'; }
    let bad = null; try { parseDefaultGraph('H1 > H1 : 1'); } catch (e) { bad = e.message; }
    if (!/appears twice/.test(bad || '')) return 'duplicate not refused';
    return true;
  });
  /* Side by side (Maurer and Bretz, 2013, Fig. 2, p. 1746): one panel per component with the hypotheses in the same places */
  const fq = q => Q.fmt(q);
  const panelNodes = svg => [...svg.matchAll(/<g transform="translate\(([-\d.]+), ([-\d.]+)\)">([\s\S]*?)<\/g>/g)].map(m => ({ dx: +m[1], dy: +m[2], ellipses: [...m[3].matchAll(/<ellipse cx="([-\d.]+)" cy="([-\d.]+)"/g)].map(e => [+e[1], +e[2]]), edges: (m[3].match(/marker-end/g) || []).length, dashed: (m[3].match(/<path [^>]*stroke-dasharray="9 5"/g) || []).length, weights: [...m[3].matchAll(/<text x="[-\d.]+" y="[-\d.]+" font-size="1[13]" text-anchor="middle" fill="#[0-9a-f]+">([^<]*)<\/text>/g)].map(e => e[1]), grey: (m[3].match(/stroke="#9aa0a6" stroke-width="1.8"/g) || []).length }));
  check('Side by side, Fig. 2 (p. 1746): the SVG has two panels, every hypothesis of panel 2 at panel 1\'s place plus one offset, five transitions each (panel 2 dashed), the weights (1, 0, 0, 0, 0) and (0, 1, 0, 0, 0), labels "Graph 1 (c = 1/2)" and "Graph 2 (c = 1/2)"; the TikZ has two scopes with a name prefix and unique node names', () => {
    const G = F(), panels = componentPanels(G, null, null, fq);
    if (panels.length !== 2 || panels[0].title !== 'Graph 1 (c = 1/2)' || panels[1].title !== 'Graph 2 (c = 1/2)') return 'titles ' + panels.map(p => p.title).join(' | ');
    const svg = exportSVGPanels(panels, fq), P = panelNodes(svg);
    if (P.length !== 2) return 'panels in the SVG: ' + P.length;
    if (P[0].ellipses.length !== 5 || P[1].ellipses.length !== 5) return 'hypotheses per panel';
    /* same places inside each panel (the panel is translated as a whole) */
    for (let i = 0; i < 5; i++) if (P[0].ellipses[i][0] !== P[1].ellipses[i][0] || P[0].ellipses[i][1] !== P[1].ellipses[i][1]) return `H${i + 1} moved between the panels`;
    if (!(P[1].dx > P[0].dx && P[1].dy === P[0].dy)) return 'panel 2 is not to the right of panel 1';
    if (P[0].edges !== 5 || P[1].edges !== 5) return `transitions ${P[0].edges}, ${P[1].edges}`;
    if (P[0].dashed !== 0 || P[1].dashed !== 5) return `dashed ${P[0].dashed}, ${P[1].dashed}`;
    if (P[0].weights.join() !== '1,0,0,0,0' || P[1].weights.join() !== '0,1,0,0,0') return 'weights ' + P.map(p => p.weights.join()).join(' | ');
    if (!/>Graph 1 \(c = 1\/2\)<\/text>/.test(svg) || !/>Graph 2 \(c = 1\/2\)<\/text>/.test(svg)) return 'labels missing';
    const tex = exportTikZPanels(panels).text;
    if ((tex.match(/\\begin\{scope\}\[xshift=[-\d.]+cm, yshift=[-\d.]+cm, name prefix=g[12]-\]/g) || []).length !== 2) return 'scopes';
    if ((tex.match(/\\node\[hyp[^\]]*\] \(n\d\)/g) || []).length !== 10 || !/\\draw\[trans, comp1\]/.test(tex) || (tex.match(/\\draw\[trans\]/g) || []).length !== 5) return 'tikz nodes or styles';
    if (!/\{Graph 1 \(\$c = \\frac\{1\}\{2\}\$\)\}/.test(tex) || !/\{Graph 2 \(\$c = \\frac\{1\}\{2\}\$\)\}/.test(tex)) return 'tikz labels';
    return true;
  });
  check('Side by side, layout: three components in one row, "3 of 4" (four components) as a 2 x 2 grid, six in two rows of three; Fig. 5 keeps the symbolic labels 1−γ1, γ1, 1−γ2 and γ2 in its two panels', () => {
    const grid = svg => { const P = panelNodes(svg); return { n: P.length, cols: new Set(P.map(p => p.dx)).size, rows: new Set(P.map(p => p.dy)).size }; };
    const G3 = load(entangledKOfM(3, 2, 0.05)), g3 = grid(exportSVGPanels(componentPanels(G3, null, null, fq), fq));
    if (g3.n !== 3 || g3.cols !== 3 || g3.rows !== 1) return '2 of 3: ' + JSON.stringify(g3);
    const G4 = load(entangledKOfM(4, 3, 0.05)), g4 = grid(exportSVGPanels(componentPanels(G4, null, null, fq), fq));
    if (g4.n !== 4 || g4.cols !== 2 || g4.rows !== 2) return '3 of 4: ' + JSON.stringify(g4);
    const G6 = load(entangledKOfM(4, 2, 0.05)), g6 = grid(exportSVGPanels(componentPanels(G6, null, null, fq), fq));
    if (g6.n !== 6 || g6.cols !== 3 || g6.rows !== 2) return '2 of 4: ' + JSON.stringify(g6);
    if (panelColumns(2) !== 2 || panelColumns(5) !== 3 || panelColumns(7) !== 3) return 'panelColumns';
    const G5 = load(entangledTemplateJSON('maurerFig5')), s5 = exportSVGPanels(componentPanels(G5, null, null, fq), fq);
    for (const t of ['1−γ1', 'γ1', '1−γ2', 'γ2', '1−ε', 'ε']) if (!s5.includes(`>${t}</text>`)) return 'Fig. 5 label missing: ' + t;
    const t5 = exportTikZPanels(componentPanels(G5, null, null, fq)).text;
    if (!/\$1-\\gamma1\$/.test(t5) || !/\$\\gamma2\$/.test(t5)) return 'Fig. 5 TikZ symbols';
    return true;
  });
  check('Side by side in Test mode, Fig. 3(c) (p. 1747) drawn apart: after rejecting H1 and H3 on the section 3.1 p-values, panel 1 shows H4 at 0.999 and H5 at 0.001, panel 2 still (0, 1, 0, 0, 0) since H1 and H3 carried no weight there (Fig. 3(c): α_24 = α_25 = 0), H1 and H3 greyed in both panels with the component weights they had when rejected (H3: 1 in graph 1, 0 in graph 2); the beamer frames carry each panel\'s own level (c × w × α) under the hypotheses', () => {
    const G = F(), id = l => byLabel(G, l);
    let st = stateFromGraph(G); const rej = new Map();
    for (const l of ['H1', 'H3']) { rej.set(id(l), { wvec: st.ent.comps.map(cs => cs.w.get(id(l)) || Q.ZERO) }); st = rejectNode(st, id(l)); }
    const panels = componentPanels(G, st, rej, fq), svg = exportSVGPanels(panels, fq), P = panelNodes(svg);
    if (P.length !== 2) return 'panels ' + P.length;
    if (P[0].weights.join() !== '1,0,1,0.999,0.001') return 'panel 1 weights ' + P[0].weights.join();
    if (P[1].weights.join() !== '0,1,0,0,0') return 'panel 2 weights ' + P[1].weights.join();
    if (P[0].grey !== 2 || P[1].grey !== 2) return `greyed ${P[0].grey}, ${P[1].grey}`;
    if (P[0].edges !== 3 || P[1].edges !== 3) return `transitions ${P[0].edges}, ${P[1].edges}`; /* H4 → H2, H2 → H4, H2 → H5; H2 → H5, H2 → H4, H5 → H4 (the loop through H1 and H3 closes to 1) */
    const tex = exportBeamer([{ panels: componentPanels(G, stateFromGraph(G), null, fq), caption: 'start', alpha: 0.025 }, { panels, caption: 'two steps', alpha: 0.025 }], 'T');
    if ((tex.match(/\\only<\d>\{%/g) || []).length !== 2 || (tex.match(/name prefix=g[12]-/g) || []).length !== 4) return 'beamer overlays';
    /* second overlay, panel 1: H4 at level 1/2 × 999/1000 × 0.025 = 0.0124875 and H5 at 1/2 × 1/1000 × 0.025 = 0.0000125; panel 2: H4 and H5 at level 0 */
    const second = tex.split('\\only<2>{%')[1];
    if (!/level \$0\.01249\$/.test(second)) return 'panel 1 level of H4: ' + (second.match(/level \$[^$]*\$/g) || []).join(' ');
    if (!/level \$0\.0000125\$/.test(second)) return 'panel 1 level of H5: ' + (second.match(/level \$[^$]*\$/g) || []).join(' ');
    if ((second.match(/level \$0\$/g) || []).length !== 3) return 'panel 2 levels of H2, H4 and H5 should be 0, 0.0125 and 0: ' + (second.match(/level \$[^$]*\$/g) || []).join(' ');
    if (!/\\resizebox\{\d+\.\d\dcm\}\{!\}/.test(tex)) return 'no resizebox for a picture too big for the frame';
    return true;
  });
  return res;
}

function closedTestAsync(fg, p, alpha, test, ctx, onProgress) {
  return new Promise((resolve, reject) => {
    const m = fg.m;
    if (m > 12) { reject(new Error('The closed test is available for up to 12 hypotheses.')); return; }
    let W;
    try { W = closureWeights(fg); } catch (e) { reject(e); return; }
    const full = (1 << m) - 1, subsets = [], adj = new Array(m).fill(0);
    if (ctx) ctx.se = null;
    let mask = 1;
    const step = () => {
      const t0 = performance.now();
      try {
        while (mask <= full && performance.now() - t0 < 60) {
          const a = intersectionAdjP(mask, m, W, p, test, ctx);
          subsets.push({ mask, w: Array.from(W.subarray(mask * m, mask * m + m)), adjP: a });
          for (let i = 0; i < m; i++) if (mask & (1 << i)) adj[i] = Math.max(adj[i], a);
          mask++;
        }
      } catch (e) { reject(e); return; }
      if (onProgress) onProgress(mask - 1, full);
      if (mask <= full) setTimeout(step, 0);
      else resolve({ adj, subsets, rejected: adj.map(a => a <= alpha * (1 + 1e-9)), W, se: ctx ? ctx.se : null });
    };
    setTimeout(step, 0);
  });
}

/* ---------- Gain functions (Spiers, Grayling, Wheeler and Mander, 2026, arXiv:2609.19994) ----------
   A gain function psi scores each rejection pattern r (section 2.3.1, p. 4). It is written the way multigrain's
   trial_success() takes it: r1, r2, ... for "H1 rejected", "H2 rejected", ..., numbers, + - * /, && and ||
   (or the words and, or) and brackets.
   Precedence here is the usual one, as in R and C: * and / before + and -, then &&, then ||.
   multigrain 1.0.0 reads && and || before * and + (it turns them into %AND% and %OR%), so r1*r2 || r3*r4 would
   mean r1 * (r2 or r3) * r4 there. gainToR() therefore brackets every operation, and the script means exactly
   what the app evaluates. As in multigrain, && and || may only join true/false terms: r1, r2, ..., other && and
   || terms, and products of these. && is a * b and || is min(1, a + b), the values multigrain uses. */
function parseGain(text, m) {
  const src = String(text == null ? '' : text), toks = [];
  const fail = (msg, pos) => { const e = new Error(msg); e.gainPos = pos == null ? src.length : pos; throw e; };
  try {
    for (let i = 0; i < src.length;) {
      const rest = src.slice(i), c = src[i];
      let mm;
      if (/\s/.test(c)) { i++; continue; }
      if ((mm = /^(\d+(\.\d*)?|\.\d+)/.exec(rest))) {
        if (/^[eE]/.test(rest.slice(mm[0].length))) fail('Write numbers as plain decimals, such as 0.001, not with e.', i);
        toks.push({ k: 'num', v: Number(mm[0]), raw: mm[0], s: i }); i += mm[0].length; continue;
      }
      if ((mm = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) {
        const w = mm[0];
        if (/^r\d+$/.test(w)) toks.push({ k: 'r', i: parseInt(w.slice(1), 10), raw: w, s: i });
        else if (/^and$/i.test(w)) toks.push({ k: 'op', v: '&&', raw: w, s: i });
        else if (/^or$/i.test(w)) toks.push({ k: 'op', v: '||', raw: w, s: i });
        else if (/^R\d+$/.test(w)) fail(`Write "${w}" in lower case: r${w.slice(1)}.`, i);
        else fail(`"${w}" is not a hypothesis. Use r1, r2, ... for "H1 rejected", "H2 rejected", and so on.`, i);
        i += w.length; continue;
      }
      if (rest.startsWith('&&') || rest.startsWith('||')) { toks.push({ k: 'op', v: rest.slice(0, 2), raw: rest.slice(0, 2), s: i }); i += 2; continue; }
      if ('+-*/()'.includes(c)) { toks.push({ k: 'op', v: c, raw: c, s: i }); i++; continue; }
      fail(`"${c}" cannot be used. Use numbers, r1, r2, ..., + - * /, && (and), || (or) and brackets.`, i);
    }
    if (!toks.length) fail('Write a gain function, for example r1 || r2.', 0);
    let p = 0;
    const isOp = (t, v) => t && t.k === 'op' && t.v === v;
    const node = (op, a, b, tok) => {
      if ((op === '&&' || op === '||') && (a.type !== 'bool' || b.type !== 'bool'))
        fail(`"${op === '&&' ? 'and' : 'or'}" can only join r1, r2, ... and other and/or terms. Put numbers and sums outside it, for example (r1 && r2) * (1 + r3).`, tok.s);
      const bool = op === '&&' || op === '||' || (op === '*' && a.type === 'bool' && b.type === 'bool');
      return { t: 'op', op, a, b, type: bool ? 'bool' : 'real' };
    };
    const level = (ops, next) => () => {
      let a = next();
      while (toks[p] && toks[p].k === 'op' && ops.includes(toks[p].v)) { const tok = toks[p++]; a = node(tok.v, a, next(), tok); }
      return a;
    };
    const primary = () => {
      const t = toks[p];
      if (!t) fail('The expression stops too early. A term is missing at the end.');
      if (t.k === 'num') { p++; return { t: 'num', v: t.v, raw: t.raw, type: 'real' }; }
      if (t.k === 'r') {
        p++;
        if (t.i < 1) fail('Hypotheses are numbered from r1.', t.s);
        if (m && t.i > m) fail(`${t.raw} does not exist: the graph has ${m} hypotheses.`, t.s);
        return { t: 'r', i: t.i, type: 'bool' };
      }
      if (isOp(t, '(')) {
        p++;
        const e = orLevel();
        if (!isOp(toks[p], ')')) fail('A bracket is opened here but not closed.', t.s);
        p++;
        return e;
      }
      if (isOp(t, '-') || isOp(t, '+')) fail(`A ${t.v === '-' ? 'minus' : 'plus'} sign must come between two terms. multigrain cannot read a sign at the start of a term.`, t.s);
      fail(`"${t.raw}" is in the wrong place. A term (a number or r1, r2, ...) should come here.`, t.s);
    };
    const mulLevel = level(['*', '/'], primary), addLevel = level(['+', '-'], mulLevel);
    const andLevel = level(['&&'], addLevel), orLevel = level(['||'], andLevel);
    const ast = orLevel();
    if (p < toks.length) fail(isOp(toks[p], ')') ? 'This bracket closes but none was opened.' : `"${toks[p].raw}" is in the wrong place. An operator such as + or * may be missing before it.`, toks[p].s);
    const used = new Set();
    (function walk(n) { if (n.t === 'r') used.add(n.i); else if (n.t === 'op') { walk(n.a); walk(n.b); } })(ast);
    if (!used.size) fail('The gain must use at least one hypothesis (r1, r2, ...).', 0);
    return { ok: true, ast, used: [...used].sort((a, b) => a - b), fn: compileGain(ast) };
  } catch (e) {
    if (e.gainPos == null) throw e;
    return { ok: false, msg: e.message, pos: e.gainPos };
  }
}
/* Compiles a parsed gain into a function of the rejection indicators (out[i] = 1 if H_{i+1} is rejected) */
function compileGain(n) {
  if (n.t === 'num') { const v = n.v; return () => v; }
  if (n.t === 'r') { const k = n.i - 1; return r => (r[k] ? 1 : 0); }
  const A = compileGain(n.a), B = compileGain(n.b);
  switch (n.op) {
    case '+': return r => A(r) + B(r);
    case '-': return r => A(r) - B(r);
    case '*': return r => A(r) * B(r);
    case '/': return r => A(r) / B(r);
    case '&&': return r => A(r) * B(r);
    case '||': return r => Math.min(1, A(r) + B(r));
  }
  throw new Error('Unknown operator ' + n.op);
}
/* The gain as text for multigrain's trial_success(): every operation in brackets (see the note above parseGain),
   and "+ 0 * rk" for each of r1 ... rm the gain does not use, since graph_optimise() needs the highest index
   in the gain to equal the number of hypotheses (multigrain 1.0.0, R/optimisation.R). */
function gainToR(ast, m) {
  const used = new Set();
  const w = n => {
    if (n.t === 'num') return n.raw != null ? n.raw : fmtGainNum(n.v);
    if (n.t === 'r') { used.add(n.i); return 'r' + n.i; }
    return '(' + w(n.a) + ' ' + n.op + ' ' + w(n.b) + ')';
  };
  let s = w(ast);
  for (let k = 1; k <= (m || 0); k++) if (!used.has(k)) s += ' + 0 * r' + k;
  return s;
}
/* Plain decimal for a gain value, at most 4 decimal places, never in e-notation */
function fmtGainNum(v) {
  const s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
/* Gain for every rejection pattern (m up to 8). Pattern k has H_{i+1} rejected when bit i of k is set. */
function gainTable(fn, m) {
  if (m > 8) throw new Error('The table of gains is shown for up to 8 hypotheses.');
  const rows = [], r = new Uint8Array(m);
  let negative = false, notFinite = false, max = -Infinity;
  for (let k = 0; k < (1 << m); k++) {
    for (let i = 0; i < m; i++) r[i] = (k >> i) & 1;
    const v = fn(r);
    if (!Number.isFinite(v)) notFinite = true; else { if (v < 0) negative = true; if (v > max) max = v; }
    rows.push({ k, v });
  }
  return { rows, negative, notFinite, max };
}
/* Gain from elicited values (Spiers et al. 2026, section 2.4, eq. 5 and p. 8).
   reg: the hypotheses (numbered from 1) that define regulatory success; regRule: 'all' or 'any' of them.
   scores: {j: median direct-rating score} for the other hypotheses (0 to 100).
   sAll: the anchor answer, the value of regulatory success plus every other claim when success alone is 100.
   kappa = (sAll - 100) / 100, v_base = 1 / (1 + kappa), v_j = kappa / (1 + kappa) * s_j / sum(s). */
function elicitGain(m, reg, regRule, scores, sAll) {
  const err = msg => ({ ok: false, msg });
  if (!Array.isArray(reg) || !reg.length) return err('Tick at least one hypothesis for regulatory success.');
  if (reg.some(i => !Number.isInteger(i) || i < 1 || i > m)) return err('A regulatory hypothesis is not in the graph.');
  if (regRule !== 'all' && regRule !== 'any') return err('Choose whether all or any of the regulatory hypotheses are needed.');
  const inc = [];
  for (let j = 1; j <= m; j++) if (!reg.includes(j)) inc.push(j);
  const s = inc.map(j => Number(scores && scores[j] != null ? scores[j] : 0));
  if (s.some(x => !Number.isFinite(x) || x < 0 || x > 100)) return err('Each score must be between 0 and 100.');
  const S = s.reduce((a, b) => a + b, 0), A = Number(sAll);
  if (!Number.isFinite(A) || A < 100) return err('The anchor answer must be 100 or more (100 means the other claims add nothing).');
  /* With no other hypotheses the gain is regulatory success alone (value 1), and the anchor answer is not used */
  const kappa = inc.length ? (A - 100) / 100 : 0, vBase = 1 / (1 + kappa), v = {};
  if (kappa > 0 && S === 0) return err('Give at least one of the other hypotheses a score above 0.');
  inc.forEach((j, k) => { v[j] = kappa > 0 && S > 0 ? kappa / (1 + kappa) * s[k] / S : 0; });
  const regExpr = reg.map(i => 'r' + i).join(regRule === 'all' ? ' && ' : ' || ');
  const terms = inc.filter(j => v[j] > 0);
  let expr;
  if (!terms.length) expr = regExpr;
  else {
    const I = reg.length > 1 ? '(' + regExpr + ')' : regExpr;
    expr = I + ' * (' + [fmtGainNum(vBase), ...terms.map(j => fmtGainNum(v[j]) + '*r' + j)].join(' + ') + ')';
  }
  return { ok: true, kappa, vBase, v, expr };
}
/* Expected gain U(w, G; theta) by simulation (Spiers et al. 2026, eq. 3, p. 5): one-sided z-tests with means
   Delta_i = qnorm(1 - alpha) + qnorm(power_i) (eq. 9, p. 10) and correlation matrix R (m x m, row-major).
   fg: a float graph (floatGraph). Returns the mean gain, its Monte Carlo standard error and the local powers. */
function expectedGain(fg, powers, R, alpha, gain, n, seed = 2009) {
  const m = fg.m, L = cholesky(R, m);
  if (!L) throw new Error('The correlation matrix is not positive definite.');
  const mean = powers.map(p => qnorm(1 - alpha) + qnorm(p));
  const tally = { n: 0, rej: new Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0, gain: 0, gain2: 0 };
  simulateChunk(fg, mean, L, alpha, n, normalGen(mulberry32(seed)), tally, { gain });
  const mu = tally.gain / n, v = Math.max(0, tally.gain2 / n - mu * mu);
  return { mean: mu, se: Math.sqrt(v / Math.max(1, n - 1)), local: tally.rej.map(x => x / n), n };
}

/* ---------- multigrain script writer (plan section 8) ----------
   optimiseRScript(spec) writes a complete R script that calls multigrain 1.0.0 and prints the optimised graph as the
   app's exchange JSON. Argument names were read from the package source (R/sim_pvals.R, R/trial_success.R,
   R/graph_constraint.R, R/optimisation.R), not guessed. spec:
     labels[]      hypothesis names in order (H1, H2, ...)
     descs[]       descriptions, '' when none; groups[] likewise
     alpha         one-sided level
     powers[]      power alone of each hypothesis, as proportions
     corr[]        m x m correlation matrix, row-major
     nsim          simulated trials for the p-value matrix
     gainR         the gain in multigrain's form, already bracketed by gainToR()
     hyp[]         weight constraints: a number (fixed) or null (free)
     trans[][]     transition constraints: a number or null; the diagonal is 0
     start         {w[], g[][]} the current graph as a starting point, or null
     globalSearch, threads, file
   Fixed values are written as plain numbers (rNum of a rational, or a decimal). */
function optimiseRScript(spec) {
  const m = spec.labels.length, pad = '    ';
  const num = v => (typeof v === 'string' ? v : (v != null && v.n !== undefined ? rNum(v) : String(Number(v.toPrecision ? v.toPrecision(15) : v))));
  const vec = xs => 'c(' + xs.map(num).join(', ') + ')';
  const mat = rows => `matrix(c(\n${rows.map(r => pad + r.map(num).join(', ')).join(',\n')}\n  ), nrow = ${m}, byrow = TRUE)`;
  const cvec = xs => xs.map(x => (x == null ? 'NA' : num(x)));
  const names = 'c(' + spec.labels.map(rStr).join(', ') + ')';
  const allFree = spec.hyp.every(x => x == null) && spec.trans.every((r, i) => r.every((x, j) => (i === j ? true : x == null)));
  const corrRows = []; for (let i = 0; i < m; i++) corrRows.push(spec.corr.slice(i * m, i * m + m));
  const hasDesc = spec.descs.some(Boolean), hasGroup = spec.groups.some(Boolean);
  let s = `# Optimise a graphical multiple testing procedure with multigrain
# Written by Multiplicity Graph Sketchpad ${APP_VERSION} (Niamh Fitzgerald)
# Method: Spiers ADV, Grayling MJ, Wheeler GM, Mander AP (2026). Gain-function optimisation of graphical
#   multiple testing procedures for confirmatory clinical trials. arXiv:2609.19994.
# Package: multigrain 1.0.0 (Spiers A, Moldovan-Grunfeld D; LGPL >= 3). Install once with install.packages("multigrain").
#
# This script contains the gain function, which can encode commercially sensitive judgements. The graph it
# produces can be shared without it (Spiers et al. 2026, p. 19).
#
# How to use: run the whole script in R. It prints the optimised graph and saves it as ${rStr(spec.file)}.
# Open that file in the Sketchpad: Export tab, "Open a saved graph".

library(multigrain)
library(jsonlite)   # used by sketchpad_json() below

alpha <- ${num(spec.alpha)}
hyp_names <- ${names}

# 1. Simulated p-values: one-sided z-tests with mean qnorm(1 - alpha) + qnorm(power) (eq. 9, p. 10) and the
#    correlation matrix below. set.seed() makes the p-values, and the search that uses them, repeatable.${spec.note ? '\n' + spec.note.split('\n').map(l => '# ' + l).join('\n') : ''}
power_nominal <- ${vec(spec.powers)}
corr_matrix <- ${mat(corrRows)}
nsim <- ${spec.nsim}
set.seed(2009)
pvals <- simulate_pvalues(power_nominal = power_nominal, alpha = alpha, corr_matrix = corr_matrix, nsim = nsim)

# 2. Gain function psi (section 2.3.1, p. 4): r1, r2, ... mean "H1 rejected", "H2 rejected", ...
#    Every operation is bracketed because multigrain 1.0.0 reads && and || before * and +.
ts <- trial_success(${rStr(spec.gainR)})

# 3. Fixed and free parts. NA is free; a number is fixed at that value (a locked cell in the Sketchpad).
`;
  if (allFree) s += `gc <- graph_constraint_free(${m}, names = hyp_names)   # everything free\n`;
  else s += `gc <- graph_constraint(
  hyp_constraint = c(${cvec(spec.hyp).join(', ')}),
  trans_constraint = matrix(c(
${spec.trans.map(r => pad + cvec(r).join(', ')).join(',\n')}
  ), nrow = ${m}, byrow = TRUE),
  names = hyp_names
)
`;
  s += `
# 4. Optimise (eq. 6, p. 9). multigrain starts from its own graphs (a Holm-type graph and a fixed sequence)${spec.start ? '\n#    and from the graph drawn in the Sketchpad,' : ','} and keeps the best result. global_search = TRUE runs a genetic
#    algorithm before the local search (slower, more thorough).
${spec.start ? `start_graph <- list(
  hyp_weight = ${vec(spec.start.w)},
  trans_matrix = ${mat(spec.start.g)}
)
` : ''}res <- graph_optimise(
  pvals = pvals,
  graph_constraint = gc,
  trial_success = ts,
  alpha = alpha,${spec.start ? `
  start_graph = list(start_graph),` : ''}
  global_search = ${spec.globalSearch ? 'TRUE' : 'FALSE'},
  num_threads = ${spec.threads}L
)
print(res)

# 5. Write the graph for the Sketchpad. sketchpad_json() is copied from R/multigrain-to-sketchpad.R in the
#    Sketchpad repository, so no other file is needed. It reads $hyp_weight and $trans_matrix from the result, and
#    $power, $solution and the gain for the "optimisation" block, which lets the Sketchpad re-estimate the gain on
#    a fresh sample and compare the optimised graph with the starting graph.
${SKETCHPAD_JSON_R}

json <- sketchpad_json(res, alpha = alpha, names = hyp_names,${hasDesc ? `\n  labels = c(${spec.descs.map(rStr).join(', ')}),` : ''}${hasGroup ? `\n  groups = c(${spec.groups.map(rStr).join(', ')}),` : ''}
  inputs = list(power_nominal = power_nominal, corr_matrix = corr_matrix, nsim = nsim),${spec.start ? '\n  start = start_graph,' : ''}
  file = ${rStr(spec.file)})
cat(json)
`;
  return s;
}
/* sketchpad_json() as text, kept identical to R/multigrain-to-sketchpad.R (the engine stress suite checks this) */
const SKETCHPAD_JSON_R = `sketchpad_json <- function(graph, alpha = 0.025, names = NULL, labels = NULL,
                           groups = NULL, file = NULL, inputs = NULL, start = NULL,
                           source = paste("multigrain", tryCatch(as.character(utils::packageVersion("multigrain")), error = function(e) ""))) {
  if (inherits(graph, "graphMCP")) {
    # A gMCP graph: numeric matrix (variables such as epsilon are replaced by 0.001)
    if (requireNamespace("gMCP", quietly = TRUE) && is.character(graph@m)) graph <- gMCP::substituteEps(gMCP::replaceVariables(graph, ask = FALSE, partial = TRUE), eps = 0.001)
    w <- graph@weights
    G <- graph@m
    if (is.character(G)) stop("The gMCP graph still contains variables; give them values with replaceVariables() first.")
    if (is.null(names)) names <- rownames(G)
  } else {
    w <- if (!is.null(graph$hyp_weight)) graph$hyp_weight else graph$w
    G <- if (!is.null(graph$trans_matrix)) graph$trans_matrix else graph$G
  }
  if (is.null(w) || is.null(G)) stop("Expected a graph_optimise() result with $hyp_weight and $trans_matrix, a list(w = , G = ), or a gMCP graphMCP object.")
  w <- as.numeric(w); G <- as.matrix(G)
  m <- length(w)
  if (!all(dim(G) == c(m, m))) stop("The transition matrix must be ", m, " x ", m, ".")
  if (is.null(names)) {
    names <- if (!is.null(names(graph$hyp_weight))) names(graph$hyp_weight)
             else if (!is.null(rownames(G))) rownames(G)
             else paste0("H", seq_len(m))
  }
  if (length(names) != m) stop("\`names\` must have one entry per hypothesis.")
  if (!is.null(labels) && length(labels) != m) stop("\`labels\` must have one entry per hypothesis.")
  if (!is.null(groups) && length(groups) != m) stop("\`groups\` must have one entry per hypothesis.")

  hyps <- lapply(seq_len(m), function(i) {
    h <- list(name = names[i], weight = unname(w[i]))
    if (!is.null(labels)) h$label <- labels[i]
    if (!is.null(groups)) h$group <- groups[i]
    h
  })
  obj <- list(format = "multiplicity-graph", version = 1L, source = trimws(source),
              alpha = alpha, hypotheses = hyps,
              transitions = lapply(seq_len(m), function(i) unname(G[i, ])))

  # The optional optimisation block, from a graph_optimise() result (fields missing in older versions are left out)
  pw <- if (is.list(graph) && !inherits(graph, "graphMCP")) graph$power else NULL
  sol <- if (is.list(graph) && !inherits(graph, "graphMCP")) graph$solution else NULL
  if (!is.null(pw) || !is.null(sol) || !is.null(inputs) || !is.null(start)) {
    num1 <- function(x) if (is.null(x) || length(x) != 1 || is.na(x)) NULL else unname(as.numeric(x))
    opt <- list(package = trimws(source))
    gain <- graph$trial_success$objective
    if (!is.null(gain) && is.character(gain)) opt$gain <- gain[1]
    if (!is.null(pw)) {
      opt$expected_gain <- num1(pw$trial_success)
      if (!is.null(pw$local_power)) opt$local_power <- unname(as.numeric(pw$local_power))
      opt$expected_rejections <- num1(pw$exp_rejections)
      opt$disjunctive_power <- num1(pw$disj_power)
      opt$conjunctive_power <- num1(pw$conj_power)
    }
    if (!is.null(sol)) {
      if (!is.null(sol$opt_source)) opt$opt_source <- as.character(sol$opt_source)[1]
      gv <- sol$graph_valid
      if (!is.null(gv)) opt$graph_valid <- lapply(stats::setNames(as.list(gv), names(gv)), function(v) if (is.na(v)) NULL else as.logical(v))
    }
    if (!is.null(graph$global_search) && !is.na(graph$global_search)) opt$global_search <- as.logical(graph$global_search)
    if (!is.null(inputs)) {
      inp <- list()
      if (!is.null(inputs$power_nominal)) inp$power_nominal <- unname(as.numeric(inputs$power_nominal))
      if (!is.null(inputs$corr_matrix)) { cm <- as.matrix(inputs$corr_matrix); inp$corr_matrix <- lapply(seq_len(nrow(cm)), function(i) unname(cm[i, ])) }
      if (!is.null(inputs$nsim)) inp$nsim <- num1(inputs$nsim)
      opt$inputs <- inp
    }
    if (!is.null(start) && !is.null(start$hyp_weight) && !is.null(start$trans_matrix)) {
      sm <- as.matrix(start$trans_matrix)
      opt$start <- list(weights = unname(as.numeric(start$hyp_weight)), transitions = lapply(seq_len(nrow(sm)), function(i) unname(sm[i, ])))
    }
    obj$optimisation <- opt
  }
  txt <- jsonlite::toJSON(obj, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
  if (!is.null(file)) writeLines(txt, file)
  invisible(txt)
}`;
/* multigrain 1.0.0's rules for a graph constraint, read from R/graph_constraint_validation.R,
   R/hyp_constraint_validation.R and R/trans_constraint_validation.R: something must be free; fixed parts add up to at
   most 1; a complete vector or row must add up to exactly 1; an incomplete one must not already add up to 1; and no
   vector or row may have exactly one free value. hyp: numbers or null (free); trans: m x m, diagonal 0.
   Returns [{what: 'all' | 'w' | 'row', id?, text}] with id the row index. */
function multigrainConstraintProblems(hyp, trans, labels) {
  const m = hyp.length, tol = 1e-9, out = [];
  if (hyp.every(x => x != null) && trans.every((r, i) => r.every((x, j) => i === j || x != null))) out.push({ what: 'all', text: 'Everything is locked, so there is nothing for multigrain to optimise.' });
  const near1 = x => Math.abs(x - 1) <= tol;
  const show = x => fmtNum(x, 6);
  const check = (xs, what, i) => {
    const fixed = xs.filter(x => x != null), free = xs.length - fixed.length, sum = fixed.reduce((a, b) => a + b, 0);
    const who = what === 'w' ? 'weights' : `transitions from ${labels[i]}`;
    if (sum - 1 > tol) out.push({ what, id: i, text: `The locked ${who} add up to ${show(sum)}, more than 1.` });
    else if (!free && !near1(sum)) out.push({ what, id: i, text: what === 'w' ? `Every weight is locked, but they add up to ${show(sum)}, not 1.` : `Every transition from ${labels[i]} is fixed, but the row adds up to ${show(sum)}, not 1 (multigrain needs every fixed row to add up to 1).` });
    else if (free && near1(sum)) out.push({ what, id: i, text: `The locked ${who} already add up to 1, so the free ${what === 'w' ? 'weights' : 'ones'} could only be 0. Lock them too, or unlock one.` });
    else if (free === 1) out.push({ what, id: i, text: what === 'w' ? 'Only one weight is free, so its value is forced (weights add up to 1). multigrain needs at least two free weights, or none.' : `Only one transition from ${labels[i]} is free, so its value is forced (rows add up to 1). multigrain needs at least two free transitions in a row, or none.` });
  };
  check(hyp, 'w');
  for (let i = 0; i < m; i++) check(trans[i].filter((_, j) => j !== i), 'row', i);
  return out;
}

/* ---------- Self-tests for gain functions ---------- */
function runGainSelfTests() {
  const res = [];
  const check = (name, fn) => { try { const r = fn(); res.push({ name, pass: r === true, detail: r === true ? '' : String(r) }); } catch (err) { res.push({ name, pass: false, detail: 'Threw: ' + err.message }); } };
  const pattern = (k, m) => Uint8Array.from({ length: m }, (_, i) => (k >> i) & 1);
  const agrees = (text, m, ref) => {
    const g = parseGain(text, m);
    if (!g.ok) return `"${text}" was refused: ${g.msg}`;
    for (let k = 0; k < (1 << m); k++) { const r = pattern(k, m), a = g.fn(r), b = ref(r); if (Math.abs(a - b) > 1e-12) return `"${text}" gives ${a} for pattern ${[...r].join('')}, expected ${b}`; }
    return true;
  };
  check('Gain functions from the multigrain help page give the right value for every rejection pattern', () => {
    const cases = [
      ['r1 + r2 + r3 + r4', r => r[0] + r[1] + r[2] + r[3]],
      ['r1 || r2 || r3 || r4', r => (r[0] || r[1] || r[2] || r[3] ? 1 : 0)],
      ['r1 && r2 && r3 && r4', r => (r[0] && r[1] && r[2] && r[3] ? 1 : 0)],
      ['(r1 && r2) * (r3 + r4)', r => r[0] * r[1] * (r[2] + r[3])],
      ['2*r1 + r2 + r3', r => 2 * r[0] + r[1] + r[2]],
      ['r1 and r2 OR r3', r => ((r[0] && r[1]) || r[2] ? 1 : 0)]
    ];
    for (const [t, f] of cases) { const a = agrees(t, 4, f); if (a !== true) return a; }
    return true;
  });
  check('Gain precedence: r1*r2 || r3*r4 means "H1 and H2, or H3 and H4" (Spiers et al. 2026, eq. 10); the R text is fully bracketed', () => {
    const a = agrees('r1*r2 || r3*r4', 4, r => (r[0] * r[1] + r[2] * r[3] >= 1 ? 1 : 0));
    if (a !== true) return a;
    const R = gainToR(parseGain('r1*r2 || r3*r4', 4).ast, 4);
    return R === '((r1 * r2) || (r3 * r4))' || 'R text ' + R;
  });
  check('Hypotheses the gain does not use are added to the R text as 0 * rk, so multigrain counts all of them', () => {
    const R = gainToR(parseGain('r1 || r3', 5).ast, 5);
    return R === '(r1 || r3) + 0 * r2 + 0 * r4 + 0 * r5' || 'R text ' + R;
  });
  check('Gain functions multigrain cannot read are refused with a message', () => {
    const bad = ['', 'r1 && (r2 + r3)', '-r1 + r2', 'r5', 'R1', 'x1 + r2', '(r1 + r2', 'r1 + r2)', 'r1 r2', '2r1', 'r1 && 0.5', 'r1 ^ 2', '1e-3 * r1', 'r0', '3 + 4'];
    for (const t of bad) { const g = parseGain(t, 4); if (g.ok) return `"${t}" was accepted`; if (!g.msg) return `"${t}" gave no message`; }
    return true;
  });
  check('Elicited gain, osteoporosis example (Spiers et al. 2026, p. 8): v_base 0.667, v_2 0.222, v_3 0.111', () => {
    const e = elicitGain(3, [1], 'all', { 2: 90, 3: 45 }, 150);
    if (!e.ok) return e.msg;
    const got = [e.vBase, e.v[2], e.v[3]], want = [0.667, 0.222, 0.111];
    if (got.some((x, i) => Math.abs(x - want[i]) > 5e-4)) return 'got ' + got.map(x => x.toFixed(4)).join(', ');
    return e.expr === 'r1 * (0.6667 + 0.2222*r2 + 0.1111*r3)' || 'expression ' + e.expr;
  });
  check('Elicited gain, Example 3 (Spiers et al. 2026, p. 14): v_base 0.556; v_3, v_4, v_5 = 0.252, 0.148, 0.044', () => {
    const e = elicitGain(5, [1, 2], 'all', { 3: 85, 4: 50, 5: 15 }, 180);
    if (!e.ok) return e.msg;
    const got = [e.vBase, e.v[3], e.v[4], e.v[5]], want = [0.556, 0.252, 0.148, 0.044];
    if (got.some((x, i) => Math.abs(x - want[i]) > 5e-4)) return 'got ' + got.map(x => x.toFixed(4)).join(', ');
    return parseGain(e.expr, 5).ok || 'the elicited expression does not parse: ' + e.expr;
  });
  const fixedSeq = order => {
    const m = order.length, w = new Float64Array(m), g = new Float64Array(m * m);
    w[order[0]] = 1;
    for (let k = 0; k + 1 < m; k++) g[order[k] * m + order[k + 1]] = 1;
    return { m, w, g };
  };
  const near = (r, want) => Math.abs(r.mean - want) <= 3 * r.se + 0.0005;
  check('Expected gain, Spiers et al. (2026) Example 3 (Table 4, p. 16): H1, H2, then Holm on H3 to H5 gives 0.770 (20,000 trials)', () => {
    const S = [1, .8, .5, .5, .8, .8, 1, .5, .5, .8, .5, .5, 1, .5, .5, .5, .5, .5, 1, .5, .8, .8, .5, .5, 1];
    const g = parseGain('r1 * r2 * (0.556 + 0.252*r3 + 0.148*r4 + 0.044*r5)', 5).fn;
    const holm = { m: 5, w: Float64Array.of(1, 0, 0, 0, 0), g: new Float64Array(25) };
    holm.g[1] = 1; for (const j of [2, 3, 4]) holm.g[5 + j] = 1 / 3;
    for (const i of [2, 3, 4]) for (const j of [2, 3, 4]) if (i !== j) holm.g[i * 5 + j] = 0.5;
    const r = expectedGain(holm, [0.90, 0.90, 0.80, 0.70, 0.85], S, 0.025, g, 20000);
    return near(r, 0.770) || `${r.mean.toFixed(4)} (SE ${r.se.toFixed(4)}), paper 0.770`;
  });
  check('Expected gain, Spiers et al. (2026) Example 4 (Table 5, p. 16): fixed sequence gives 0.803 (20,000 trials)', () => {
    const S = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) S.push(i === j ? 1 : 0.7);
    const g = parseGain('r1 * (0.4 + 0.2*r2 + 0.2*r3 + 0.2*r4)', 4).fn;
    const r = expectedGain(fixedSeq([0, 1, 2, 3]), [0.90, 0.90, 0.80, 0.70], S, 0.025, g, 20000);
    return near(r, 0.803) || `${r.mean.toFixed(4)} (SE ${r.se.toFixed(4)}), paper 0.803`;
  });
  return res;
}
