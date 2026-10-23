'use strict';
/* Version shown in About, the footer and the exports. Bump on every published change. */
const APP_VERSION = '1.1.6';
const APP_DATE = '2026-10-23';
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
  return {
    ids: G.nodes.map(n => n.id),
    w: new Map(G.nodes.map(n => [n.id, n.w])),
    g: new Map(G.edges.filter(e => !Q.isZero(e.g)).map(e => [gKey(e.from, e.to), e.g]))
  };
}

/* ---------- Validation ---------- */
function validateGraph(G, fmt) {
  const out = [];
  const name = id => (G.nodes.find(n => n.id === id) || {}).label || '?';
  const list = ids => ids.map(name).join(', ');
  if (!G.nodes.length) return out;

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
  for (const e of vm.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || a === b) continue;
    const bidir = keys.has(gKey(e.to, e.from));
    const bend = e.bend == null ? autoBend(a, b, bidir, obstacles) : e.bend;
    out.push(Object.assign({}, e, { key: gKey(e.from, e.to), a, b, bend, auto: e.bend == null }, curveGeom(a, b, bend)));
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
function exportGraphicalMCP(G) {
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
function exportTikZ(vm, layout, opts = {}) {
  const S = 60; // pixels per cm
  const xs = vm.nodes.map(n => n.x), ys = vm.nodes.map(n => n.y);
  const x0 = opts.x0 != null ? opts.x0 : Math.min(...xs), y0 = opts.y0 != null ? opts.y0 : Math.min(...ys);
  const cx = x => ((x - x0) / S).toFixed(2), cy = y => (-(y - y0) / S).toFixed(2);
  const id = n => 'n' + (vm.nodes.indexOf(n) + 1);
  const L = [];
  const boxes = opts.bands === false ? [] : groupBoxes(vm);
  if (!opts.inner) L.push(`% Needs: \\usepackage{tikz} and \\usetikzlibrary{arrows.meta, shapes.geometric${boxes.length ? ', backgrounds' : ''}}`);
  L.push('\\begin{tikzpicture}[');
  L.push('  hyp/.style={circle, draw, thick, minimum size=1.2cm, inner sep=1pt, outer sep=0pt, align=center, font=\\small},');
  L.push('  hypwide/.style={ellipse, draw, thick, inner sep=1pt, outer sep=0pt, align=center, font=\\small},');
  L.push('  rejected/.style={draw=gray, dashed, text=gray},');
  L.push('  trans/.style={-{Stealth[length=2.2mm]}, semithick},');
  L.push('  wt/.style={fill=white, draw, rounded corners=1pt, inner sep=1.5pt, font=\\scriptsize}');
  L.push(']');
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
    L.push(`\\node[${style}] (${id(n)}) at (${cx(n.x)}, ${cy(n.y)}) {${texLabel(n.label)}\\\\ ${n.wexpr && !n.rejected ? exprTeX(n.wexpr) : texNum(n.w)}};${n.rejected ? ' % rejected' : ''}`);
  }
  for (const e of layout) {
    const A = id(e.a), B = id(e.b);
    const lab = `node[wt, pos=${e.label.t.toFixed(2)}] {${e.expr ? exprTeX(e.expr) : texNum(e.g)}}`;
    if (e.straight) L.push(`\\draw[trans] (${A}) -- ${lab} (${B});`);
    else {
      const c1 = { x: e.s.x + 2 / 3 * (e.c.x - e.s.x), y: e.s.y + 2 / 3 * (e.c.y - e.s.y) };
      const c2 = { x: e.e.x + 2 / 3 * (e.c.x - e.e.x), y: e.e.y + 2 / 3 * (e.c.y - e.e.y) };
      L.push(`\\draw[trans] (${A}.${e.s.ang.toFixed(1)}) .. controls (${cx(c1.x)}, ${cy(c1.y)}) and (${cx(c2.x)}, ${cy(c2.y)}) .. ${lab} (${B}.${e.e.ang.toFixed(1)});`);
    }
  }
  if (opts.levels && opts.alpha != null) {
    for (const n of vm.nodes) {
      if (n.rejected) L.push(`\\node[below=1pt of ${id(n)}, font=\\scriptsize, text=gray, fill=white, inner sep=1pt] {rejected};`);
      else L.push(`\\node[below=1pt of ${id(n)}, font=\\scriptsize, align=center, fill=white, inner sep=1pt] {level $${fmtNum(Q.toNum(n.w) * opts.alpha)}$${n.p != null && Number.isFinite(parseP(n.p)) ? `\\\\ $p = ${fmtNum(parseP(n.p))}$` : ''}};`);
    }
  }
  L.push('\\end{tikzpicture}');
  return L.join('\n') + '\n';
}
/* Beamer frame with one overlay per step. frames: [{vm, layout, caption}] */
function exportBeamer(frames, title) {
  const allX = frames.flatMap(f => f.vm.nodes.map(n => n.x)), allY = frames.flatMap(f => f.vm.nodes.map(n => n.y));
  const x0 = Math.min(...allX), y0 = Math.min(...allY);
  const L = [];
  L.push('% Needs in the preamble: \\usepackage{tikz} \\usetikzlibrary{arrows.meta, shapes.geometric, positioning, backgrounds}');
  L.push('% One overlay per step: use the arrow keys in the PDF viewer to step through the rejections.');
  L.push(`\\begin{frame}{${texEscape(title)}}`);
  L.push('\\centering');
  frames.forEach((f, k) => {
    L.push(`\\only<${k + 1}>{%`);
    L.push(exportTikZ(f.vm, f.layout, { inner: true, x0, y0, levels: true, alpha: f.alpha }).trimEnd());
    L.push('}');
  });
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
function exportSVG(vm, layout, fmt) {
  const pts = [];
  for (const n of vm.nodes) pts.push([n.x - n.rx, n.y - n.ry], [n.x + n.rx, n.y + n.ry]);
  for (const b of groupBoxes(vm)) pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]);
  for (const e of layout) {
    for (let t = 0; t <= 1; t += 0.1) { const p = pointAt(e, t); pts.push([p.x, p.y]); }
    pts.push([e.label.r.x, e.label.r.y], [e.label.r.x + e.label.r.w, e.label.r.y + e.label.r.h]);
  }
  if (!pts.length) pts.push([0, 0], [100, 100]);
  const pad = 24;
  const minX = Math.min(...pts.map(p => p[0])) - pad, minY = Math.min(...pts.map(p => p[1])) - pad;
  const W = Math.max(...pts.map(p => p[0])) + pad - minX, H = Math.max(...pts.map(p => p[1])) + pad - minY;
  const ink = '#1b1f23', grey = '#9aa0a6', font = 'Helvetica, Arial, sans-serif';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" font-family="${font}">`);
  o.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${ink}"/></marker></defs>`);
  o.push(`<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#ffffff"/>`);
  for (const b of groupBoxes(vm)) {
    o.push(`<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="10" fill="${b.color || '#e9ebee'}" fill-opacity="${b.color ? 0.35 : 0.6}" stroke="${b.color || '#c4c9d0'}" stroke-opacity="0.7"/>`);
    o.push(`<text x="${(b.x + 10).toFixed(1)}" y="${(b.y + 16).toFixed(1)}" font-size="12" letter-spacing="1" fill="#5a6470">${xmlEsc(String(b.group).toUpperCase())}</text>`);
  }
  for (const e of layout) o.push(`<path d="${e.d}" fill="none" stroke="${ink}" stroke-width="1.6" marker-end="url(#ah)"/>`);
  for (const e of layout) {
    const l = e.label;
    o.push(`<rect x="${l.r.x.toFixed(1)}" y="${l.r.y.toFixed(1)}" width="${l.w.toFixed(1)}" height="${l.h}" rx="3" fill="#ffffff" stroke="${ink}" stroke-width="0.8"/>`);
    o.push(`<text x="${l.x.toFixed(1)}" y="${(l.y + 4.3).toFixed(1)}" font-size="12.5" text-anchor="middle" fill="${ink}">${xmlEsc(e.text)}</text>`);
  }
  for (const n of vm.nodes) {
    const col = n.rejected ? grey : (n.color ? textOnColor(n.color) : ink);
    o.push(`<ellipse cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" rx="${n.rx.toFixed(1)}" ry="${n.ry.toFixed(1)}" fill="${n.rejected ? '#f1f2f3' : (n.color || '#ffffff')}" stroke="${col}" stroke-width="1.8"${n.rejected ? ' stroke-dasharray="4 3"' : ''}/>`);
    o.push(svgLabelText(n.label, n.x.toFixed(1), (n.y - 3).toFixed(1), 17, `text-anchor="middle" font-weight="700" fill="${col}"`));
    o.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 16).toFixed(1)}" font-size="13" text-anchor="middle" fill="${col}">${xmlEsc(n.wexpr && !n.rejected ? exprDisplay(n.wexpr) : fmt(n.w))}</text>`);
    if (n.rejected) o.push(`<line x1="${(n.x - n.rx * 0.62).toFixed(1)}" y1="${(n.y - 8).toFixed(1)}" x2="${(n.x + n.rx * 0.62).toFixed(1)}" y2="${(n.y - 8).toFixed(1)}" stroke="${grey}" stroke-width="2"/>`);
  }
  o.push('</svg>');
  return o.join('\n');
}

/* ---------- Serialisation and share links ---------- */
function serializeGraph(G) {
  return {
    format: 'multiplicity-graph', version: 1, generator: 'Multiplicity Graph Sketchpad ' + APP_VERSION, alpha: G.alpha, sided: G.sided === 'two' ? 'two' : 'one', note: G.note || '',
    nodes: G.nodes.map(n => ({ id: n.id, label: n.label, weight: Q.exact(n.w), x: Math.round(n.x), y: Math.round(n.y), p: n.p || '', color: n.color || '', desc: n.desc || '', group: n.group || '', wexpr: n.wexpr || undefined })),
    edges: G.edges.map(e => ({ from: e.from, to: e.to, weight: Q.exact(e.g), bend: e.bend == null ? null : Math.round(e.bend * 10) / 10, expr: e.expr || undefined })),
    vars: Object.keys(G.vars || {}).length ? Object.fromEntries(Object.entries(G.vars).map(([k, v]) => [k, Q.exact(v)])) : undefined,
    diag: Object.keys(G.diag || {}).filter(k => G.diag[k] && !Q.isZero(G.diag[k])).map(k => ({ id: k, weight: Q.exact(G.diag[k]) })),
    test: serializeTest(G.test)
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
  evaluateGraph(Gout);
  Gout.edges = Gout.edges.filter(e => e.expr || !Q.isZero(e.g));
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
  return 'g1' + b64urlEncode(JSON.stringify(c));
}
function decodeShare(token) {
  if (!/^g1[A-Za-z0-9_-]+$/.test(token)) throw new Error('Not a graph link.');
  let c;
  try { c = JSON.parse(b64urlDecode(token.slice(2))); } catch (e) { throw new Error('This link or share code is damaged: it does not decode to a graph.'); }
  if (!c || typeof c !== 'object' || !Array.isArray(c.n) || !Array.isArray(c.e) || c.n.some(r => !Array.isArray(r)) || c.e.some(r => !Array.isArray(r))) throw new Error('This link or share code is damaged: it does not decode to a graph.');
  return {
    format: 'multiplicity-graph', alpha: c.a, test: c.t, sided: c.s === 2 ? 'two' : 'one',
    nodes: c.n.map((r, i) => ({ id: String(i), label: r[0], weight: r[1], x: r[2], y: r[3], p: r[4], color: r[5] ? '#' + r[5] : '', desc: r[6] || '', group: r[7] || '', wexpr: c.x && c.x.n[i] ? c.x.n[i] : undefined })),
    edges: c.e.map((r, k) => ({ from: String(r[0]), to: String(r[1]), weight: r[2], bend: r[3], expr: c.x && c.x.e[k] ? c.x.e[k] : undefined })),
    vars: c.x ? c.x.v : undefined
  };
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
  const w = Float64Array.from(G.nodes.map(n => Q.toNum(n.w)));
  const g = new Float64Array(m * m);
  for (const e of G.edges) g[idx.get(e.from) * m + idx.get(e.to)] = Q.toNum(e.g);
  return { m, w, g };
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
/* Runs n simulations and adds to tallies; success: {idx: [...], rule: 'any'|'all'} or null */
function simulateChunk(fg, mean, L, alpha, n, norm, tally, success, tester) {
  const m = fg.m, z = new Float64Array(m), e = new Float64Array(m), p = new Float64Array(m), out = new Uint8Array(m);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < m; i++) e[i] = norm();
    for (let i = 0; i < m; i++) {
      let v = mean[i];
      for (let k = 0; k <= i; k++) v += L[i * m + k] * e[k];
      z[i] = v; p[i] = pnormUpper(v);
    }
    if (tester) tester(p, out); else shortcutFloat(m, fg.w, fg.g, p, alpha, out);
    let cnt = 0;
    for (let i = 0; i < m; i++) { if (out[i]) { tally.rej[i]++; cnt++; } }
    if (cnt > 0) tally.any++;
    if (cnt === m) tally.all++;
    tally.total += cnt;
    if (success && success.idx.length) {
      const ok = success.rule === 'all' ? success.idx.every(i => out[i]) : success.idx.some(i => out[i]);
      if (ok) tally.custom++;
    }
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
    if (testerA) testerA(p, outA); else shortcutFloat(m, fgA.w, fgA.g, p, alpha, outA);
    if (testerB) testerB(pB, outB); else shortcutFloat(m, fgB.w, fgB.g, pB, alpha, outB);
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
     "format": "multiplicity-graph", "version": 1, "source": "multigrain 0.3.0",
     "alpha": 0.025,
     "hypotheses": [ {"name": "H1", "label": "Dose 1, primary endpoint", "weight": 0.5, "group": "primary"}, ... ],
     "transitions": [[0, 0.9, 0.1, 0], ...]      rows = from, columns = to, same order as hypotheses
   }
   "label", "group" and "source" are optional. Weights may be numbers or strings such as "1/3". */
function isExchangeFormat(o) { return o && typeof o === 'object' && Array.isArray(o.hypotheses) && Array.isArray(o.transitions); }
function fromExchangeFormat(o, positionsFor, colorFor) {
  const m = o.hypotheses.length;
  if (!m) throw new Error('The file lists no hypotheses.');
  if (o.transitions.length !== m || o.transitions.some(r => !Array.isArray(r) || r.length !== m)) throw new Error(`"transitions" must be a ${m} × ${m} matrix (one row per hypothesis, in the same order).`);
  const num = (v, what) => { const q = typeof v === 'number' ? Q.fromNumber(v) : Q.parse(v); if (!q) throw new Error(`Could not read ${what} "${v}".`); return q; };
  const names = o.hypotheses.map((h, i) => (h && h.name != null ? String(h.name) : 'H' + (i + 1)));
  const groups = [...new Set(o.hypotheses.map(h => (h && h.group ? String(h.group) : '')).filter(Boolean))];
  const pos = positionsFor(m);
  const nodes = o.hypotheses.map((h, i) => ({
    id: String(i), label: names[i], weight: Q.exact(num(h && h.weight != null ? h.weight : 0, `the weight of ${names[i]}`)),
    x: pos[i].x, y: pos[i].y, p: h && h.p != null ? String(h.p) : '',
    desc: h && h.label ? String(h.label) : '', group: h && h.group ? String(h.group) : '',
    color: h && h.group ? colorFor(groups.indexOf(String(h.group))) : ''
  }));
  const edges = [], diag = [];
  o.transitions.forEach((row, i) => row.forEach((v, j) => {
    const q = num(v, `transition ${names[i]} → ${names[j]}`);
    if (Q.isZero(q)) return;
    if (i === j) diag.push({ id: String(i), weight: Q.exact(q) }); else edges.push({ from: String(i), to: String(j), weight: Q.exact(q), bend: null });
  }));
  const alpha = Number(o.alpha);
  const note = [o.source ? `Imported from ${o.source}.` : 'Imported.', groups.length ? `Groups: ${groups.join(', ')}.` : ''].filter(Boolean).join(' ');
  return { format: 'multiplicity-graph', alpha: alpha > 0 && alpha < 1 ? alpha : undefined, note, nodes, edges, diag };
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
  out.push(`The trial asks ${m} question${m > 1 ? 's' : ''} (${joinWords(G.nodes.map(n => nameOf(n.id, true)))}). It is allowed a ${pctWords(G.alpha)} chance of wrongly claiming at least one success across all of them. That allowance is shared out${closed ? ' as described below.' : ', and a question can only be claimed as a success if its p-value is no bigger than its share at the time.'}`);
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
  else if (tt === 'parametric') out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together, using how strongly the test results are correlated to make the shares go further, and a question is confirmed only when every combination that includes it is rejected. This needs the stated correlations to be right and the p-values to be one-sided.');
  else out.push('These shares are not compared with the p-values one question at a time. Instead every combination of questions is checked together with a Simes test, which can confirm a combination when all of its p-values are fairly small even if none is below its own share, and a question is confirmed only when every combination that includes it is rejected. This relies on the test results not being negatively related to one another.');
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
    maurerbretz2013b: 'Maurer W, Bretz F (2013). Multiple testing in group sequential trials using graphical approaches. Statistics in Biopharmaceutical Research 5(4):311–320.',
    glimm2010: 'Glimm E, Maurer W, Bretz F (2010). Hierarchical testing of multiple endpoints in group-sequential trials. Statistics in Medicine 29(2):219–228. doi:10.1002/sim.3748',
    maurer2011: 'Maurer W, Glimm E, Bretz F (2011). Multiple and repeated testing of primary, coprimary, and secondary hypotheses. Statistics in Biopharmaceutical Research 3(2):336–352.'
  };
  const refs = [];
  const cite = (...keys) => { for (const k of keys) if (!refs.includes(REF[k])) refs.push(REF[k]); };
  const P = [], H = [];
  const add = (head, text) => { H.push(head); P.push(head + '. ' + text); };
  const lvl = x => fmtNum(x * aNum, 6);

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
  if (!closed) {
    proc = `${rate}, using the graphical approach of Bretz et al. (2009). The testing strategy is shown in Figure [X]. The procedure is equivalent to a closed testing procedure with weighted Bonferroni tests, and controls the family-wise error rate for any dependence between the test statistics.`;
    cite('bretz2009');
  } else {
    const what = tt === 'parametric' ? 'weighted parametric tests (Xi et al., 2017)' : tt === 'simes' ? 'weighted Simes tests (Benjamini and Hochberg, 1997)' : 'weighted Simes tests within groups of hypotheses and weighted Bonferroni tests otherwise';
    proc = `${rate}, using a closed testing procedure (Marcus et al., 1976) with ${what}, with weights defined by the graph (Bretz et al., 2009, 2011). The testing strategy is shown in Figure [X]. ${tt === 'parametric' ? 'The procedure assumes that the test statistics are multivariate normal within blocks of hypotheses with known correlations' : 'The procedure assumes positively dependent test statistics'}; the assumptions and the test of each intersection hypothesis are given under Technical details.`;
    cite('bretz2009', 'bretz2011', 'marcus1976');
    if (tt === 'parametric') cite('xi2017'); else cite('bh1997');
  }
  add('Error rate and procedure', proc);

  /* 3. Initial allocation */
  const withW = G.nodes.filter(n => !Q.isZero(n.w)), noW = G.nodes.filter(n => Q.isZero(n.w));
  const byW = [];
  for (const n of withW) { const k = byW.find(x => Q.eq(x.w, n.w)); if (k) k.ns.push(n); else byW.push({ w: n.w, ns: [n] }); }
  let alloc = byW.map(x => {
    const wtxt = G.nodes.find(n => n === x.ns[0]).wexpr ? exprDisplay(x.ns[0].wexpr) + ' = ' + fmtW(x.w) : fmtW(x.w);
    return closed
      ? `${joinWords(x.ns.map(n => n.label))} ${x.ns.length > 1 ? 'each have' : 'has'} initial weight ${wtxt}`
      : `${joinWords(x.ns.map(n => n.label))} will ${x.ns.length > 1 ? 'each ' : ''}initially be tested at ${sided} level ${lvl(Q.toNum(x.w))} (weight ${wtxt})`;
  });
  alloc = alloc.length ? alloc.join('; ') + '.' : '';
  let wsum = Q.ZERO; for (const n of G.nodes) wsum = Q.add(wsum, n.w);
  if (!Q.eq(wsum, Q.ONE)) alloc += ` The initial weights add up to ${fmtW(wsum)}, so the procedure does not use the full α.`;
  if (noW.length) {
    const reach = noW.filter(n => G.edges.some(e => e.to === n.id && !Q.isZero(e.g)));
    const never = noW.filter(n => !reach.includes(n));
    if (reach.length && !closed) alloc += ` ${joinWords(reach.map(n => n.label))} ${reach.length > 1 ? 'receive' : 'receives'} no initial significance level (weight 0): ${reach.length > 1 ? 'each' : 'it'} can be tested only after significance level has been passed to it from a rejected hypothesis.`;
    if (reach.length && closed) alloc += ` ${joinWords(reach.map(n => n.label))} ${reach.length > 1 ? 'have' : 'has'} weight 0 in the global intersection hypothesis and ${reach.length > 1 ? 'receive' : 'receives'} weight only in intersection hypotheses that leave out the hypotheses passing weight to ${reach.length > 1 ? 'them' : 'it'}.`;
    if (never.length) alloc += ` ${joinWords(never.map(n => n.label))} ${never.length > 1 ? 'have' : 'has'} weight 0 and no transition weight leads to ${never.length > 1 ? 'them' : 'it'}, so ${never.length > 1 ? 'they' : 'it'} can never be rejected.`;
  }
  add('Initial allocation', alloc.trim());

  /* 4. Propagation */
  const unit = closed ? 'weight' : 'level';
  const passes = G.nodes.map(n => {
    const outs = G.edges.filter(e => e.from === n.id && !Q.isZero(e.g));
    if (!outs.length) return `${n.label} passes nothing on`;
    if (outs.length === 1 && !outs[0].expr && Q.eq(outs[0].g, Q.ONE)) return `${n.label} passes all of its ${unit} to ${lab(outs[0].to)}`;
    return `${n.label} passes ${joinWords(outs.map((e, k) => `${e.expr ? exprDisplay(e.expr) : fmtW(e.g)}${k === 0 ? ` of its ${unit}` : ''} to ${lab(e.to)}`))}`;
  });
  const initial = `In the initial graph, ${passes.length > 1 ? passes.slice(0, -1).join('; ') + '; and ' + passes[passes.length - 1] : passes[0]}.`;
  const dir = two ? ' and the estimated effect favours [the experimental treatment]' : '';
  let prop;
  if (!closed) {
    prop = `A hypothesis will be rejected if its ${sided} p-value is at most its current local significance level${dir}. When a hypothesis is rejected, its local level will be passed on according to the transition weights in Table [X.2], and the graph will be updated with Algorithm 1 of Bretz et al. (2009). ${initial} After each rejection the weights and transition weights are updated, so later proportions can differ from these. Testing will continue until no further hypothesis can be rejected. The final set of rejected hypotheses does not depend on the order in which hypotheses are tested.`;
  } else {
    prop = `The weights of each intersection hypothesis will be derived from the initial weights (Table [X.1]) and the transition weights (Table [X.2]) by removing the hypotheses not in the intersection one at a time with Algorithm 1 of Bretz et al. (2011); the result does not depend on the order of removal. ${initial} After each removal the weights and transition weights are updated, so later proportions can differ from these. An elementary hypothesis will be rejected if and only if every intersection hypothesis containing it is rejected (closure principle). With ${tt === 'parametric' ? 'parametric' : 'Simes'} tests the graph defines the weights of the intersection hypotheses; it is not a sequence of tests, and the closed test is not consonant in general, so it is not carried out step by step (Bretz et al., 2011, ${tt === 'parametric' ? 'eq. 4, p. 901' : 'section 3.3, p. 906'}).${two ? ' A hypothesis rejected with an estimated effect that does not favour [the experimental treatment] will not be claimed as a benefit.' : ''}`;
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
  const rows = G.nodes.map(x => G.nodes.map(y => {
    if (x.id === y.id) return fmtW((G.diag && G.diag[x.id]) || Q.ZERO);
    const e = G.edges.find(z => z.from === x.id && z.to === y.id);
    return e ? (e.expr ? `${exprDisplay(e.expr)} = ${fmtW(e.g)}` : fmtW(e.g)) : '0';
  }));
  const h1 = ['Hypothesis', 'Description', 'Initial weight', closed ? `Initial weight × α (α = ${a})` : `Initial ${sided} level (α = ${a})`];
  if (groups.length) h1.push('Group');
  tables.push({ title: 'Table [X.1]. Hypotheses, initial weights and levels', header: h1, rows: G.nodes.map(n => { const r = [n.label, n.desc || '[description]', n.wexpr ? `${exprDisplay(n.wexpr)} = ${fmtW(n.w)}` : fmtW(n.w), fmtNum(Q.toNum(n.w) * aNum, 6)]; if (groups.length) r.push(n.group || ''); return r; }) });
  tables.push({ title: 'Table [X.2]. Transition weights (row: from, column: to)', header: ['From \\ To', ...labels], rows: labels.map((l, i) => [l, ...rows[i]]) });
  if (tt === 'parametric') {
    const corr = (G.test && G.test.corr) || {};
    const at = (i, j) => { if (i === j) return 1; const p = G.nodes[i].id, q = G.nodes[j].id; const v = corr[p < q ? p + '|' + q : q + '|' + p]; return v == null ? null : v; };
    let blockTxt = '';
    try { const B = corrBlocks(G.nodes.map((_, i) => i), at); blockTxt = B.map(b => '{' + b.map(i => labels[i]).join(', ') + '}').join(', '); } catch (e) { blockTxt = '[the correlations do not form complete blocks]'; }
    tables.push({ title: `Table [X.3]. Correlations between the test statistics under the null hypotheses (blank: unknown). Blocks: ${blockTxt}`, header: ['', ...labels], rows: labels.map((l, i) => [l, ...labels.map((_, j) => { const v = at(i, j); return v == null ? '' : String(v); })]) });
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
  return whole && labels.length > 3 ? 'These correlations cannot all hold at once (the matrix is not positive definite). Try values closer to 0.' : `The correlations between ${list} cannot all hold at once (the matrix is not positive definite). Try values closer to 0.`;
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
  return res;
}

/* Closed test in chunks so the page stays responsive; onProgress(done, total) */
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
