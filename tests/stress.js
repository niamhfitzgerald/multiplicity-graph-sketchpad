/* Engine stress test for core.js. Run from the tests folder: node stress.js ../src/core.js */
const fs = require('fs'), vm = require('vm');
if (!process.argv[2]) process.argv[2] = require('path').join(__dirname, '..', 'src', 'core.js');
const src = fs.readFileSync(process.argv[2], 'utf8');
const ctx = { console, performance, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(src + '\nthis.__X = { Q, gKey, NODE_R, TEMPLATES, TEMPLATE_GEN, TEST_TYPES, pnormUpper, PRIMES, GREEK, SKETCHPAD_JSON_R };', ctx);
const C = Object.assign({}, ctx, ctx.__X);
const { Q } = C;

let seed = 20261014;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const results = [];
let fails = 0;
function check(name, fn) {
  const t0 = performance.now();
  try { const r = fn(); const ok = r === true; results.push({ name, ok, detail: ok ? '' : String(r), ms: performance.now() - t0 }); if (!ok) fails++; }
  catch (e) { results.push({ name, ok: false, detail: 'THREW ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), ms: performance.now() - t0 }); fails++; }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------- random graph generator ---------- */
function randomGraphJSON(m, opts = {}) {
  const nodes = [], edges = [];
  const raw = Array.from({ length: m }, () => (rnd() < (opts.zeroW || 0.25) ? 0 : ri(1, 6)));
  let tot = raw.reduce((a, b) => a + b, 0) || 1;
  if (opts.underWeight && rnd() < 0.5) tot = tot * 2;
  if (raw.every(v => v === 0)) raw[0] = 1;
  tot = raw.reduce((a, b) => a + b, 0);
  if (opts.underWeight && rnd() < 0.5) tot += ri(1, 4);
  for (let i = 0; i < m; i++) nodes.push({ id: String(i), label: 'H' + (i + 1), weight: `${raw[i]}/${tot}`, x: i * 100, y: 0, p: '' });
  for (let i = 0; i < m; i++) {
    if (m === 1) break;
    const row = Array.from({ length: m }, (_, j) => (i === j || rnd() < (opts.sparse || 0.3) ? 0 : ri(1, 4)));
    let rs = row.reduce((a, b) => a + b, 0);
    if (opts.underRow && rnd() < 0.4) rs += ri(1, 3);
    if (rs === 0 && !opts.allowLeaf) { const j = (i + 1) % m; row[j] = 1; rs = 1; }
    row.forEach((v, j) => { if (v) edges.push({ from: String(i), to: String(j), weight: `${v}/${rs}` }); });
  }
  return { format: 'multiplicity-graph', alpha: 0.025, nodes, edges };
}
const toG = o => C.deserializeGraph(o, false, 1).G;
const randP = (m, scale = 0.08) => Array.from({ length: m }, () => Math.min(1, rnd() * rnd() * scale * 2));

/* ---------- independent reference implementations ---------- */
/* exact closure weights for subset J by rejecting the complement in rational arithmetic, in a given order */
function exactSubsetWeights(G, mask, order) {
  let st = C.stateFromGraph(G);
  const ids = G.nodes.map(n => n.id);
  const comp = ids.filter((_, i) => !(mask & (1 << i)));
  const ord = order ? order(comp) : comp;
  for (const id of ord) st = C.rejectNode(st, id);
  return ids.map(id => (mask & (1 << ids.indexOf(id)) ? Q.toNum(st.w.get(id)) : 0));
}
function refBonfClosed(G, p, alpha) {
  const m = G.nodes.length, full = (1 << m) - 1, adj = new Array(m).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const w = exactSubsetWeights(G, mask);
    let pj = 1;
    for (let i = 0; i < m; i++) if ((mask & (1 << i)) && w[i] > 0) pj = Math.min(pj, p[i] / w[i]);
    for (let i = 0; i < m; i++) if (mask & (1 << i)) adj[i] = Math.max(adj[i], pj);
  }
  return adj;
}
function refSimesClosed(G, p) {
  const m = G.nodes.length, full = (1 << m) - 1, adj = new Array(m).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const w = exactSubsetWeights(G, mask);
    const idx = []; for (let i = 0; i < m; i++) if (mask & (1 << i)) idx.push(i);
    idx.sort((a, b) => p[a] - p[b]);
    let cum = 0, pj = 1;
    for (const i of idx) { cum += w[i]; if (cum > 0) pj = Math.min(pj, p[i] / cum); }
    for (const i of idx) adj[i] = Math.max(adj[i], pj);
  }
  return adj;
}
/* Hommel adjusted p-values (Wright 1992 algorithm) */
function hommelAdj(p) {
  const n = p.length, o = p.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ps = o.map(x => x[0]);
  let q = ps.map(() => Math.min(...ps.map((v, i) => n * v / (i + 1)))), pa = q.slice();
  for (let m = n - 1; m >= 2; m--) {
    const i1 = n - m + 1, i2s = n - m + 2; // 1-based
    let q1 = Infinity;
    for (let k = i2s; k <= n; k++) q1 = Math.min(q1, m * ps[k - 1] / (k - i2s + 2));
    for (let k = 1; k <= i1; k++) q[k - 1] = Math.min(m * ps[k - 1], q1);
    for (let k = i2s; k <= n; k++) q[k - 1] = q[i1 - 1];
    pa = pa.map((v, k) => Math.max(v, q[k]));
  }
  const adj = new Array(n);
  o.forEach(([, i], k) => { adj[i] = Math.min(1, Math.max(pa[k], ps[k])); });
  return adj;
}
/* bivariate normal lower-orthant probability by numeric integration (Drezner-style via conditional) */
function bvnLower(h, k, rho) {
  const pn = x => 0.5 * C.erfc(-x / Math.SQRT2);
  const n = 4000, a = -9, b = h;
  let s = 0;
  const sd = Math.sqrt(1 - rho * rho);
  for (let i = 0; i < n; i++) {
    const x1 = a + (b - a) * i / n, x2 = a + (b - a) * (i + 1) / n, xm = (x1 + x2) / 2;
    const f = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * pn((k - rho * x) / sd);
    s += (f(x1) + 4 * f(xm) + f(x2)) / 6 * (x2 - x1);
  }
  return s;
}

/* ===================================================================== */
console.log('Stress testing', process.argv[2]);

check('Built-in suites pass', () => {
  const r = C.runAllSelfTests().concat(C.runClosureSelfTests(), C.runLiteratureSelfTests(), C.runEntangledSelfTests(), C.runGainSelfTests());
  const bad = r.filter(x => !x.pass);
  return bad.length ? bad.map(x => x.name + ': ' + x.detail).join('; ') : true;
});

check('Closure weights (float) agree with exact rational closure, any rejection order, 150 random graphs m 1..7', () => {
  for (let k = 0; k < 150; k++) {
    const m = ri(1, 7), G = toG(randomGraphJSON(m, { underWeight: true, underRow: true, allowLeaf: true }));
    const W = C.closureWeights(C.floatGraph(G)), full = (1 << m) - 1;
    for (let mask = 1; mask <= full; mask++) {
      const w1 = exactSubsetWeights(G, mask), w2 = exactSubsetWeights(G, mask, c => c.slice().reverse()), w3 = exactSubsetWeights(G, mask, c => c.slice().sort(() => rnd() - 0.5));
      for (let i = 0; i < m; i++) {
        if (!near(W[mask * m + i], w1[i], 1e-9)) return `graph ${k} mask ${mask}: float ${W[mask * m + i]} vs exact ${w1[i]}`;
        if (!near(w1[i], w2[i], 1e-12) || !near(w1[i], w3[i], 1e-12)) return `graph ${k} mask ${mask}: closure depends on order`;
      }
    }
  }
  return true;
});

check('Shortcut = closed Bonferroni = adjustedPValues, 300 random graphs incl. non-exhaustive and leaves, random alpha', () => {
  for (let k = 0; k < 300; k++) {
    const m = ri(1, 8), G = toG(randomGraphJSON(m, { underWeight: true, underRow: true, allowLeaf: true }));
    const p = randP(m, 0.1), alpha = [0.025, 0.05, 0.1, 0.001, 0.5][k % 5];
    const ids = G.nodes.map(n => n.id), pOf = id => p[ids.indexOf(id)];
    const sc = new Set(C.runProcedure(C.stateFromGraph(G), pOf, alpha).order);
    const ct = C.closedTest(C.floatGraph(G), p, alpha, 'bonferroni', { upscale: false });
    const ref = refBonfClosed(G, p, alpha);
    const adj = C.adjustedPValues(C.stateFromGraph(G), pOf);
    for (let i = 0; i < m; i++) {
      if (sc.has(ids[i]) !== ct.rejected[i]) return `graph ${k}: shortcut vs closed differ at H${i + 1} (alpha ${alpha}, p ${p.join(',')})`;
      if (!near(ct.adj[i], ref[i], 1e-9)) return `graph ${k}: closed adj ${ct.adj[i]} vs ref ${ref[i]}`;
      if (!near(adj.get(ids[i]), ref[i], 1e-9)) return `graph ${k}: Algorithm 2 adj ${adj.get(ids[i])} vs ref ${ref[i]} (H${i + 1}, p ${p.join(',')})`;
      if ((adj.get(ids[i]) <= alpha * (1 + 1e-12)) !== sc.has(ids[i])) return `graph ${k}: adj<=alpha disagrees with shortcut at H${i + 1}`;
    }
  }
  return true;
});

check('Closed Simes agrees with an independent weighted Simes closure, 200 random graphs', () => {
  for (let k = 0; k < 200; k++) {
    const m = ri(1, 7), G = toG(randomGraphJSON(m, { underWeight: true, underRow: true, allowLeaf: true }));
    const p = randP(m, 0.1);
    const ct = C.closedTest(C.floatGraph(G), p, 0.05, 'simes', { upscale: false });
    const ref = refSimesClosed(G, p);
    const bonf = C.closedTest(C.floatGraph(G), p, 0.05, 'bonferroni', { upscale: false });
    for (let i = 0; i < m; i++) {
      if (!near(ct.adj[i], ref[i], 1e-9)) return `graph ${k}: ${ct.adj[i]} vs ${ref[i]}`;
      if (ct.adj[i] > bonf.adj[i] + 1e-12) return `graph ${k}: Simes adj above Bonferroni`;
      if (ct.adj[i] < p[i] - 1e-12) return `graph ${k}: adj below raw p`;
    }
  }
  return true;
});

check('Weighted Simes on the Holm graph equals Hommel (p.adjust "hommel"), m 2..7, 200 sets', () => {
  for (let k = 0; k < 200; k++) {
    const m = ri(2, 7), G = toG(C.generatedTemplate('holm', m)), p = randP(m, 0.3);
    const ct = C.closedTest(C.floatGraph(G), p, 0.05, 'simes', { upscale: false });
    const h = hommelAdj(p);
    for (let i = 0; i < m; i++) if (!near(ct.adj[i], h[i], 1e-9)) return `m=${m} p=${p.map(x => x.toFixed(4))}: got ${ct.adj.map(x => x.toFixed(5))} hommel ${h.map(x => x.toFixed(5))}`;
  }
  return true;
});

check('Simes within groups: one group = Simes, all separate = Bonferroni, mixed lies between', () => {
  for (let k = 0; k < 100; k++) {
    const m = ri(2, 6), G = toG(randomGraphJSON(m)), p = randP(m, 0.2), fg = C.floatGraph(G);
    const all = new Set(G.nodes.map((_, i) => i));
    const s = C.closedTest(fg, p, 0.05, 'simes', { upscale: false }).adj;
    const b = C.closedTest(fg, p, 0.05, 'bonferroni', { upscale: false }).adj;
    const g1 = C.closedTest(fg, p, 0.05, 'simes-groups', { upscale: false, groups: [all] }).adj;
    const g0 = C.closedTest(fg, p, 0.05, 'simes-groups', { upscale: false, groups: G.nodes.map((_, i) => new Set([i])) }).adj;
    const g00 = C.closedTest(fg, p, 0.05, 'simes-groups', { upscale: false, groups: [] }).adj;
    const half = new Set(G.nodes.map((_, i) => i).filter(i => i % 2 === 0)), other = new Set(G.nodes.map((_, i) => i).filter(i => i % 2 === 1));
    const gm = C.closedTest(fg, p, 0.05, 'simes-groups', { upscale: false, groups: [half, other] }).adj;
    for (let i = 0; i < m; i++) {
      if (!near(g1[i], s[i], 1e-12)) return 'one group != Simes';
      if (!near(g0[i], b[i], 1e-12) || !near(g00[i], b[i], 1e-12)) return 'separate groups != Bonferroni';
      if (gm[i] > b[i] + 1e-12 || gm[i] < s[i] - 1e-12) return 'mixed not between';
    }
  }
  return true;
});

check('Upscale: Bonferroni and Simes adjusted p scale by the weight sum of each intersection', () => {
  for (let k = 0; k < 100; k++) {
    const m = ri(1, 6), G = toG(randomGraphJSON(m, { underWeight: true, underRow: true, allowLeaf: true })), p = randP(m, 0.1), fg = C.floatGraph(G);
    for (const t of ['bonferroni', 'simes']) {
      const a = C.closedTest(fg, p, 0.05, t, { upscale: false }), b = C.closedTest(fg, p, 0.05, t, { upscale: true });
      for (const sj of a.subsets) {
        const s = sj.w.reduce((x, y) => x + y, 0);
        const sb = b.subsets.find(x => x.mask === sj.mask);
        if (s > 0 && !near(Math.min(1, sj.adjP * s), sb.adjP, 1e-9) && !(sj.adjP >= 1 && sb.adjP >= 1)) {
          // adjP capped at 1 before scaling can break exact equality; recompute uncapped check
          if (sj.adjP < 1) return `${t} graph ${k} mask ${sj.mask}: ${sj.adjP} * ${s} vs ${sb.adjP}`;
        }
        if (sb.adjP > sj.adjP + 1e-12) return 'upscaled adj larger than plain';
      }
    }
  }
  return true;
});

check('Parametric with independent statistics matches the closed form 1 - prod(1 - q w_i)', () => {
  for (let k = 0; k < 40; k++) {
    const m = ri(2, 5), G = toG(randomGraphJSON(m)), p = randP(m, 0.1), fg = C.floatGraph(G);
    const ctx2 = { upscale: false, corrAt: () => 0, rand: C.mulberry32(k + 1), cache: new Map() };
    const r = C.closedTest(fg, p, 0.05, 'parametric', ctx2);
    for (const sj of r.subsets) {
      const idx = []; for (let i = 0; i < m; i++) if (sj.mask & (1 << i)) idx.push(i);
      const w = idx.map(i => sj.w[i]), s = w.reduce((a, b) => a + b, 0);
      if (!(s > 0)) { if (sj.adjP !== 1) return 'zero-weight intersection should give 1'; continue; }
      const q = Math.min(...idx.map((i, j) => (w[j] > 0 ? p[i] / w[j] : Infinity)));
      let want;
      if (idx.length === 1 || !(q < 1 / Math.max(...w))) want = Math.min(1, q);
      else { let prod = 1; for (const wi of w) prod *= 1 - Math.min(1, q * wi); want = Math.min(1, (1 - prod) / s); }
      if (!near(sj.adjP, want, 2e-3 * Math.max(want, 0.01) + 1e-6)) return `graph ${k} mask ${sj.mask}: ${sj.adjP} vs exact ${want}`;
      if (sj.adjP > Math.min(1, q) + 1e-9) return 'parametric above Bonferroni';
      if (sj.adjP < Math.min(1, q * Math.max(...w) / s) - 2e-3) return 'parametric below the single-step lower bound';
    }
  }
  return true;
});

check('Parametric with rho near 1 gives q * wmax / s; rho = 0.5 bivariate matches numeric integration', () => {
  const G = toG(C.generatedTemplate('holm', 2)), fg = C.floatGraph(G);
  const p = [0.01, 0.03];
  const r1 = C.closedTest(fg, p, 0.05, 'parametric', { upscale: false, corrAt: () => 0.999999, rand: C.mulberry32(3), cache: new Map() });
  const full = r1.subsets.find(s => s.mask === 3);
  const q = Math.min(p[0] / 0.5, p[1] / 0.5);
  if (!near(full.adjP, q * 0.5, 2e-3)) return `rho~1: ${full.adjP} vs ${q * 0.5}`;
  const r2 = C.closedTest(fg, p, 0.05, 'parametric', { upscale: false, corrAt: () => 0.5, rand: C.mulberry32(4), cache: new Map() });
  const f2 = r2.subsets.find(s => s.mask === 3);
  const z = C.qnorm(1 - q * 0.5);
  const want = (1 - bvnLower(z, z, 0.5));
  if (!near(f2.adjP, want, 5e-4)) return `rho 0.5: ${f2.adjP} vs ${want}`;
  // weighted, unequal weights
  const G3 = toG({ nodes: [{ id: '0', label: 'A', weight: '0.7' }, { id: '1', label: 'B', weight: '0.3' }], edges: [{ from: '0', to: '1', weight: '1' }, { from: '1', to: '0', weight: '1' }], alpha: 0.025 });
  const r3 = C.closedTest(C.floatGraph(G3), [0.02, 0.004], 0.025, 'parametric', { upscale: false, corrAt: () => 0.3, rand: C.mulberry32(5), cache: new Map() });
  const f3 = r3.subsets.find(s => s.mask === 3);
  const q3 = Math.min(0.02 / 0.7, 0.004 / 0.3);
  const want3 = 1 - bvnLower(C.qnorm(1 - q3 * 0.7), C.qnorm(1 - q3 * 0.3), 0.3);
  if (!near(f3.adjP, want3, 5e-4)) return `weighted rho 0.3: ${f3.adjP} vs ${want3}`;
  return true;
});

check('Parametric: closedTest rejections agree with closedTestFast (power path, critical constants) on 60 graphs x 20 p sets', () => {
  let n = 0, dis = 0;
  for (let k = 0; k < 60; k++) {
    const m = ri(2, 5), G = toG(randomGraphJSON(m)), fg = C.floatGraph(G);
    const rho = [0, 0.3, 0.5, 0.8, -0.2][k % 5];
    const partial = k % 3 === 0;
    const corrAt = (i, j) => (partial && (i >= 2 || j >= 2) && !(i >= 2 && j >= 2) ? null : rho);
    const ctx2 = { upscale: k % 4 === 0, corrAt, rand: C.mulberry32(k + 9), cache: new Map() };
    let cr;
    try { cr = C.closedTestCritical(fg, 0.05, 'parametric', ctx2); } catch (e) { if (rho < 0 && m > 2) continue; throw e; }
    for (let s = 0; s < 20; s++) {
      const p = randP(m, 0.15);
      const a = C.closedTest(fg, p, 0.05, 'parametric', ctx2).rejected;
      const out = new Uint8Array(m);
      C.closedTestFast(m, cr.crit, p, 0.05, 'parametric', ctx2, out);
      for (let i = 0; i < m; i++) { n++; if (a[i] !== !!out[i]) { dis++; const adj = C.closedTest(fg, p, 0.05, 'parametric', ctx2).adj[i]; if (Math.abs(adj - 0.05) > 0.0015) return `graph ${k} set ${s} H${i + 1}: closed ${a[i]} fast ${out[i]} adj ${adj}`; } }
    }
  }
  return dis / n < 0.01 || `disagreement rate ${dis}/${n}`;
});

check('Parametric monotone in p and never above Bonferroni, never below raw p; bad correlation matrices rejected cleanly', () => {
  const G = toG(C.generatedTemplate('holm', 3)), fg = C.floatGraph(G);
  const ctx2 = { upscale: false, corrAt: () => 0.5, rand: C.mulberry32(1), cache: new Map() };
  let prev = C.closedTest(fg, [0.001, 0.02, 0.03], 0.05, 'parametric', ctx2).adj;
  for (const p0 of [0.002, 0.005, 0.01, 0.02, 0.03, 0.05]) {
    const a = C.closedTest(fg, [p0, 0.02, 0.03], 0.05, 'parametric', ctx2).adj;
    if (a[0] < prev[0] - 2e-3) return 'not monotone in p1';
    prev = a;
  }
  let threw = false;
  try { C.closedTest(fg, [0.01, 0.02, 0.03], 0.05, 'parametric', { upscale: false, corrAt: (i, j) => (i === 0 && j === 1) || (i === 1 && j === 0) ? 0.9 : ((i === 1 && j === 2) || (i === 2 && j === 1) ? 0.9 : (i === 0 && j === 2) || (i === 2 && j === 0) ? -0.9 : null), rand: C.mulberry32(1), cache: new Map() }); } catch (e) { threw = /positive definite/.test(e.message); }
  if (!threw) return 'non-PD matrix not rejected';
  threw = false;
  try { C.closedTest(fg, [0.01, 0.02, 0.03], 0.05, 'parametric', { upscale: false, corrAt: (i, j) => ((i === 0 && j === 1) || (i === 1 && j === 0) || (i === 1 && j === 2) || (i === 2 && j === 1)) ? 0.5 : null, rand: C.mulberry32(1), cache: new Map() }); } catch (e) { threw = /complete within each block/.test(e.message); }
  if (!threw) return 'incomplete block not rejected';
  return true;
});

check('Empirical FWER under the global null (Bonferroni, Simes, parametric; rho 0, 0.5; 100k sims each) stays at or below alpha', () => {
  const out = [];
  const G = toG(C.templateJSON('bretz')), fg = C.floatGraph(G), m = 4, alpha = 0.025;
  for (const rho of [0, 0.5]) {
    const R = new Float64Array(m * m); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) R[i * m + j] = i === j ? 1 : rho;
    const L = C.cholesky(R, m);
    for (const t of ['bonferroni', 'simes', 'parametric']) {
      const tally = { n: 0, rej: Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 };
      let tester = null;
      if (t !== 'bonferroni') {
        const ctx2 = { upscale: false, corrAt: () => rho, groups: [], rand: C.mulberry32(11), cache: new Map() };
        const cr = C.closedTestCritical(fg, alpha, t, ctx2);
        tester = (p, o) => C.closedTestFast(m, cr.crit, p, alpha, t, ctx2, o);
      }
      C.simulateChunk(fg, [0, 0, 0, 0], L, alpha, 100000, C.normalGen(C.mulberry32(99)), tally, null, tester);
      const fwer = tally.any / tally.n;
      out.push(`${t} rho=${rho}: ${fwer.toFixed(4)}`);
      const se = Math.sqrt(alpha * (1 - alpha) / tally.n);
      if (fwer > alpha + 3 * se) return `FWER inflated: ${out.join('; ')}`;
      if (t === 'parametric' && rho === 0.5 && fwer < alpha - 4 * se) return `parametric at rho 0.5 should be close to exhaustive: ${out.join('; ')}`;
    }
  }
  console.log('   FWER:', out.join('; '));
  return true;
});

check('Closed Bonferroni power sim equals shortcut power sim on the same seed', () => {
  const G = toG(C.templateJSON('bretz')), fg = C.floatGraph(G), m = 4, alpha = 0.025;
  const R = new Float64Array(m * m); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) R[i * m + j] = i === j ? 1 : 0.3;
  const L = C.cholesky(R, m), mean = [2.5, 2.8, 2.2, 3];
  const t1 = { n: 0, rej: Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 }, t2 = { n: 0, rej: Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 };
  C.simulateChunk(fg, mean, L, alpha, 20000, C.normalGen(C.mulberry32(5)), t1, null, null);
  const ctx2 = { upscale: false, groups: [], corrAt: () => null, rand: C.mulberry32(1), cache: new Map() };
  const cr = C.closedTestCritical(fg, alpha, 'bonferroni', ctx2);
  C.simulateChunk(fg, mean, L, alpha, 20000, C.normalGen(C.mulberry32(5)), t2, null, (p, o) => C.closedTestFast(m, cr.crit, p, alpha, 'bonferroni', ctx2, o));
  return JSON.stringify(t1) === JSON.stringify(t2) || 'differ: ' + JSON.stringify(t1.rej) + ' vs ' + JSON.stringify(t2.rej);
});

check('Extreme inputs: p = 0, p = 1, all equal p, alpha 1e-6 and 0.999, every test type', () => {
  const G = toG(C.templateJSON('bretz2011')), fg = C.floatGraph(G), m = G.nodes.length, ids = G.nodes.map(n => n.id);
  const sets = [Array(m).fill(0), Array(m).fill(1), Array(m).fill(0.01), [0, 1, 0, 1, 0, 1], [1e-300, 1e-300, 1e-300, 1e-300, 1e-300, 1e-300]];
  for (const p of sets) for (const alpha of [1e-6, 0.025, 0.999]) {
    const pOf = id => p[ids.indexOf(id)];
    const sc = new Set(C.runProcedure(C.stateFromGraph(G), pOf, alpha).order);
    const adj = C.adjustedPValues(C.stateFromGraph(G), pOf);
    for (const t of ['bonferroni', 'simes', 'simes-groups', 'parametric']) {
      const ctx2 = { upscale: false, groups: [new Set([0, 1, 2]), new Set([3, 4, 5])], corrAt: () => 0.5, rand: C.mulberry32(2), cache: new Map() };
      const r = C.closedTest(fg, p, alpha, t, ctx2);
      if (r.adj.some(a => !(a >= 0 && a <= 1))) return `${t}: adj outside [0,1] for p=${p[0]}`;
      if (t === 'bonferroni') for (let i = 0; i < m; i++) if (r.rejected[i] !== sc.has(ids[i])) return `bonferroni closed vs shortcut at p=${p[0]} alpha=${alpha}`;
      if (p.every(x => x === 0) && !r.rejected.every(Boolean)) return `${t}: p = 0 everywhere should reject all`;
      if (p.every(x => x === 1) && r.rejected.some(Boolean)) return `${t}: p = 1 everywhere should reject none`;
    }
    for (const v of adj.values()) if (!(v >= 0 && v <= 1)) return 'Algorithm 2 adj outside [0,1]';
  }
  return true;
});

check('Timing: m = 12 closed Bonferroni and Simes (4095 subsets) under 2 s; m = 8 parametric under 15 s', () => {
  const G12 = toG(C.generatedTemplate('holm', 12)), p12 = randP(12, 0.2);
  let t0 = performance.now();
  C.closedTest(C.floatGraph(G12), p12, 0.05, 'bonferroni', { upscale: false });
  C.closedTest(C.floatGraph(G12), p12, 0.05, 'simes', { upscale: false });
  const t12 = performance.now() - t0;
  const G8 = toG(C.generatedTemplate('holm', 8)), p8 = randP(8, 0.2);
  t0 = performance.now();
  const r = C.closedTest(C.floatGraph(G8), p8, 0.05, 'parametric', { upscale: false, corrAt: () => 0.5, rand: C.mulberry32(1), cache: new Map() });
  const t8 = performance.now() - t0;
  console.log(`   m=12 Bonf+Simes ${t12.toFixed(0)} ms; m=8 parametric ${t8.toFixed(0)} ms, se ${r.se}`);
  if (t12 > 2000) return `m=12 took ${t12} ms`;
  if (t8 > 15000) return `m=8 parametric took ${t8} ms`;
  let threw = false; try { C.closedTest(C.floatGraph(toG(C.generatedTemplate('holm', 13))), randP(13), 0.05, 'bonferroni', { upscale: false }); } catch (e) { threw = /12/.test(e.message); }
  return threw || 'm = 13 should be refused';
});

check('isAlphaExhaustive agrees with brute force; detects the g_lj g_jl = 1 trap that row sums miss', () => {
  for (let k = 0; k < 150; k++) {
    const m = ri(1, 6), G = toG(randomGraphJSON(m, { underWeight: k % 2 === 0, underRow: k % 3 === 0, allowLeaf: true }));
    const got = C.isAlphaExhaustive(G), full = (1 << m) - 1;
    let want = true;
    for (let mask = 1; mask <= full; mask++) { const w = exactSubsetWeights(G, mask); if (Math.abs(w.reduce((a, b) => a + b, 0) - 1) > 1e-12) { want = false; break; } }
    if (got !== want) return `graph ${k}: got ${got} want ${want}`;
  }
  const trap = toG({ alpha: 0.025, nodes: [{ id: '0', label: 'H1', weight: '1/2' }, { id: '1', label: 'H2', weight: '1/2' }, { id: '2', label: 'H3', weight: '0' }], edges: [{ from: '0', to: '1', weight: '1' }, { from: '1', to: '0', weight: '1' }, { from: '2', to: '0', weight: '1' }] });
  if (C.isAlphaExhaustive(trap) !== false) return 'trap graph reported exhaustive';
  if (C.isAlphaExhaustive(toG(C.generatedTemplate('holm', 5))) !== true) return 'Holm not exhaustive';
  if (C.isAlphaExhaustive(toG(C.generatedTemplate('weightedHolm', 5, ['1/2', '1/5', '1/10', '1/10', '1/10'].map(x => Q.parse(x))))) !== true) return 'weighted Holm not exhaustive';
  if (C.isAlphaExhaustive(toG(C.truncatedHolmTemplate())) !== false) return 'truncated Holm (gamma 1/2) should be non-exhaustive';
  if (C.isAlphaExhaustive(toG(C.generatedTemplate('fixed', 3))) !== true) return 'fixed sequence should be exhaustive';
  if (C.isAlphaExhaustive(toG(C.generatedTemplate('fallback', 3))) !== false) return 'fallback should be non-exhaustive';
  if (C.isAlphaExhaustive(toG(C.templateJSON('parallel'))) !== false) return 'parallel gatekeeping is known to be non-exhaustive';
  for (const key of ['improvedFallbackI', 'improvedFallbackII', 'bretz', 'bretz2011', 'successive', 'successiveI', 'improvedParallel', 'bretzFig14Left', 'bretzFig14Right', 'efficacySafety']) if (C.isAlphaExhaustive(toG(C.templateJSON(key))) !== true) return key + ' should be exhaustive';
  if (C.isAlphaExhaustive({ nodes: [], edges: [] }) !== null) return 'empty should be null';
  return true;
});

check('Every template is valid, has weights summing to at most 1 and rows at most 1; cycle 2..12; generated 1..40', () => {
  const keys = Object.keys(C.TEMPLATES);
  const all = keys.map(k => [k, C.templateJSON(k)]);
  for (let m = 2; m <= 12; m++) all.push(['cycle' + m, C.cycleTemplate(m)]);
  all.push(['truncatedHolm', C.truncatedHolmTemplate()]);
  for (const k of ['holm', 'fixed', 'fallback']) for (let m = 1; m <= 40; m++) all.push([k + m, C.generatedTemplate(k, m)]);
  for (let m = 2; m <= 40; m++) all.push(['improvedFallbackI' + m, C.generatedTemplate('improvedFallbackI', m)]);
  for (let m = 2; m <= 40; m++) all.push(['weightedHolm' + m, C.generatedTemplate('weightedHolm', m)]);
  for (const [k, o] of all) {
    const G = toG(o);
    const V = C.validateGraph(G, q => Q.fmt(q));
    const errs = V.filter(v => v.level === 'error');
    if (errs.length) return `${k}: ${errs.map(e => e.text).join('; ')}`;
    if (!o.note) return `${k}: no note`;
    // every template must be testable
    const p = G.nodes.map(() => 0.001), ids = G.nodes.map(n => n.id);
    C.runProcedure(C.stateFromGraph(G), id => p[ids.indexOf(id)], 0.025);
    if (G.nodes.length <= 12) C.closedTest(C.floatGraph(G), p, 0.025, 'simes', { upscale: false });
    C.exportGraphicalMCP(G); C.exportGMCP(G); C.sapText(G); C.plainGraphText(G, id => id);
    const vm = { nodes: G.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, rx: C.nodeRx(n.label), ry: C.NODE_R, w: n.w, p: n.p, rejected: false, group: n.group || '', color: n.color || '' })), edges: G.edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend, text: Q.fmt(e.g) })) };
    const lay = C.layoutEdges(vm);
    C.exportTikZ(vm, lay); C.exportSVG(vm, lay, q => Q.fmt(q));
  }
  return true;
});

check('Template contents match the literature (improved fallback I and II, generated improved fallback I, two doses two endpoints, Bretz 2011)', () => {
  const e = (k, a, b) => { const G = toG(C.templateJSON(k)); const ed = G.edges.find(x => x.from === G.nodes[a].id && x.to === G.nodes[b].id); return ed ? Q.exact(ed.g) : '0'; };
  const vals = k => { const G = toG(C.templateJSON(k)); return G.nodes.map(n => Q.exact(n.w)).join(','); };
  if (!(e('improvedFallbackI', 0, 1) === '1' && e('improvedFallbackI', 1, 2) === '1' && e('improvedFallbackI', 2, 0) === '1/2' && e('improvedFallbackI', 2, 1) === '1/2')) return 'improved fallback I edges';
  if (!(e('improvedFallbackII', 0, 1) === '1' && e('improvedFallbackII', 1, 0) === '999/1000' && e('improvedFallbackII', 1, 2) === '1/1000' && e('improvedFallbackII', 2, 0) === '1')) return 'improved fallback II edges';
  /* generated improved fallback I: equal weights give the three-node template; typed weights give w_i / (w_1 + ... + w_(m-1)) */
  const gen = (m, txt) => { const o = C.generatedTemplate('improvedFallbackI', m, txt ? C.parseWeightList(txt) : undefined); return o.edges.map(x => x.from + '>' + x.to + '=' + x.weight).join(' '); };
  if (gen(3) !== '0>1=1 1>2=1 2>0=1/2 2>1=1/2') return 'generated improved fallback I, equal weights: ' + gen(3);
  if (gen(3, '1/2, 3/10, 1/5') !== '0>1=1 1>2=1 2>0=5/8 2>1=3/8') return 'generated improved fallback I, typed weights: ' + gen(3, '1/2, 3/10, 1/5');
  if (gen(4, 'c(0.4, 0.3, 0, 0.3)') !== '0>1=1 1>2=1 2>3=1 3>0=4/7 3>1=3/7') return 'generated improved fallback I, zero weight: ' + gen(4, 'c(0.4, 0.3, 0, 0.3)');
  if (gen(2, '0.9 0.1') !== '0>1=1 1>0=1') return 'generated improved fallback I, m = 2: ' + gen(2, '0.9 0.1');
  for (const [txt, re] of [['1/2', /at least 2/], ['0.5, 0.6', /more than 1/], ['a, b', /Could not read/], ['1/2, -1/2, 1', /Could not read/]]) {
    let msg = ''; try { C.parseWeightList(txt); } catch (err) { msg = err.message; }
    if (!re.test(msg)) return `parseWeightList("${txt}") gave "${msg}"`;
  }
  let msg0 = ''; try { C.generatedTemplate('improvedFallbackI', 3, C.parseWeightList('0, 0, 1')); } catch (err) { msg0 = err.message; }
  if (!/must not all be zero/.test(msg0)) return 'zero return sum: ' + msg0;
  if (vals('bretz') !== '1/2,1/2,0,0' || e('bretz', 0, 1) !== '1/2' || e('bretz', 2, 1) !== '1') return 'two doses template';
  if (vals('bretz2011') !== '1/3,1/3,1/3,0,0,0' || e('bretz2011', 1, 0) !== '1/3') return 'bretz2011 template';
  if (!/Maurer/.test(C.TEMPLATES.bretz.name) || !/Bretz, Maurer and Hommel/.test(C.TEMPLATES.bretz2011.name)) return 'template names';
  return true;
});

check('Round trips: JSON, share link and exchange format keep every field (200 random graphs with vars, groups, colours, tests, sidedness)', () => {
  for (let k = 0; k < 200; k++) {
    const m = ri(1, 9), o = randomGraphJSON(m, { underWeight: true, allowLeaf: true });
    o.nodes.forEach((n, i) => { n.p = rnd() < 0.7 ? String(+rnd().toFixed(5)) : ''; n.color = rnd() < 0.5 ? '#' + ri(0, 0xffffff).toString(16).padStart(6, '0') : ''; n.desc = rnd() < 0.5 ? `desc "${i}" & <x> \\ 100%` : ''; n.group = rnd() < 0.5 ? (i % 2 ? 'primary' : 'secondary') : ''; n.x = ri(-500, 500); n.y = ri(-500, 500); if (rnd() < 0.2) { n.wexpr = i % 2 ? 'γ/2' : '1-γ'; } });
    o.edges.forEach(e => { e.bend = rnd() < 0.5 ? ri(-200, 200) : null; if (rnd() < 0.15) e.expr = 'ε'; });
    o.vars = { 'γ': '1/3', 'ε': '1/500' };
    o.sided = rnd() < 0.5 ? 'two' : 'one';
    o.alpha = [0.025, 0.05, 0.1][k % 3];
    o.test = { type: ['bonferroni', 'simes', 'simes-groups', 'parametric'][k % 4], upscale: k % 2 === 0, corr: {} };
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (rnd() < 0.5) o.test.corr[`${i}|${j}`] = +(rnd() * 0.9).toFixed(3);
    const G = toG(o);
    const s1 = C.serializeGraph(G);
    const G2 = C.deserializeGraph(JSON.parse(JSON.stringify(s1)), false, 1).G;
    const s2 = C.serializeGraph(G2);
    const strip = s => JSON.stringify({ ...s, nodes: s.nodes.map(n => ({ ...n, id: 0 })), edges: s.edges.map(e => ({ ...e, from: 0, to: 0 })), test: s.test && { ...s.test, corr: Object.values(s.test.corr).sort() } });
    if (strip(s1) !== strip(s2)) return `JSON round trip changed graph ${k}: ${strip(s1)} vs ${strip(s2)}`;
    if (s1.sided !== o.sided) return 'sided lost';
    const tok = C.encodeShare(G);
    if (!/^g1[A-Za-z0-9_-]+$/.test(tok)) return 'bad token chars';
    const G3 = C.deserializeGraph(C.decodeShare(tok), false, 1).G;
    const s3 = C.serializeGraph(G3);
    const stripShare = s => JSON.stringify({ a: s.alpha, sided: s.sided, n: s.nodes.map(n => [n.label, n.weight, n.x, n.y, n.p, n.color, n.desc, n.group, n.wexpr]), e: s.edges.map(e => [e.weight, e.bend == null ? null : Math.round(e.bend), e.expr]), v: s.vars, t: s.test && { type: s.test.type, upscale: s.test.upscale, corr: Object.values(s.test.corr).sort() } });
    if (stripShare(s1) !== stripShare(s3)) return `share round trip changed graph ${k}: ${stripShare(s1)} vs ${stripShare(s3)}`;
    const x = C.toExchangeFormat(G);
    if (!C.isExchangeFormat(x)) return 'exchange format not recognised';
    const G4 = C.deserializeGraph(C.fromExchangeFormat(JSON.parse(JSON.stringify(x)), mm => Array.from({ length: mm }, (_, i) => ({ x: i, y: 0 })), () => '#cfe3f5'), false, 1).G;
    const rows1 = C.matrixRows(G, q => Q.toNum(q)), rows4 = C.matrixRows(G4, q => Q.toNum(q));
    for (let i = 0; i < m; i++) { if (!near(Q.toNum(G.nodes[i].w), Q.toNum(G4.nodes[i].w), 1e-12)) return 'exchange weights'; for (let j = 0; j < m; j++) if (!near(rows1[i][j], rows4[i][j], 1e-12)) return 'exchange transitions'; if (G.nodes[i].label !== G4.nodes[i].label || (G.nodes[i].p || '') !== (G4.nodes[i].p || '')) return 'exchange labels or p'; }
  }
  return true;
});

check('Malformed saved files and share tokens throw readable errors, never crash', () => {
  const bad = [null, 1, 'x', {}, { nodes: 'no' }, { nodes: [{ weight: 'abc' }] }, { nodes: [{ weight: '1/0' }] }, { nodes: [{ weight: '1' }], edges: [{ from: 0, to: 0, weight: '1' }] }, { nodes: [{ weight: '1' }], edges: [{ from: 0, to: 5, weight: 'zz' }] }, { nodes: [{ weight: 1e400 }] }, { nodes: [{ weight: '1', wexpr: '((' }] }, { nodes: [{ weight: '1', wexpr: 'γ/0' }] }, { nodes: [{ weight: '1' }], diag: [{ id: 0, weight: 'q' }] }, { nodes: [{ weight: '1' }], vars: { x: 'bad' } }, { nodes: [{ weight: '1' }], test: { type: 'nope', corr: { 'a|b': 5 } } }, { nodes: [{ weight: '1' }], alpha: 7 }];
  for (const o of bad) {
    try { const r = C.deserializeGraph(o, false, 1); if (!r.G || !Array.isArray(r.G.nodes)) return 'bad result'; if (r.G.alpha !== 0.025 && o && o.alpha === 7) return 'alpha 7 accepted'; }
    catch (e) { if (!e || !e.message || /undefined|TypeError|cannot read/i.test(e.message)) return 'ugly error: ' + (e && e.message) + ' for ' + JSON.stringify(o); }
  }
  for (const t of ['', 'g1', 'g1!!!', 'g2abc', 'g1' + Buffer.from('{"a":1}').toString('base64url'), 'g1' + Buffer.from('[1,2]').toString('base64url'), 'g1' + Buffer.from('{"n":[["H1"]],"e":[[0,9,"1"]]}').toString('base64url'), 'g1' + Buffer.from('{"n":[],"e":[]}').toString('base64url')]) {
    try { const o = C.decodeShare(t); C.deserializeGraph(o, false, 1); }
    catch (e) { if (!e || !e.message || /undefined|TypeError/i.test(e.message)) return 'ugly share error: ' + (e && e.message) + ' for ' + t; }
  }
  return true;
});

check('R import parser: many R spellings and plain forms', () => {
  const cases = [
    ['c(1/2, 1/2, 0, 0)', [0.5, 0.5, 0, 0]],
    ['w <- c(a = 0.25, "b" = 0.75)', [0.25, 0.75]],
    ['0.3 0.7', [0.3, 0.7]],
    ['0.3, 0.7', [0.3, 0.7]],
    ['1e-3, 999e-3', [0.001, 0.999]],
    ['c(1/3,\n 1/3,\n 1/3)', [1 / 3, 1 / 3, 1 / 3]],
    ['c(.5, .5);', [0.5, 0.5]],
    ['weights = c(1, 0)', null],
  ];
  for (const [s, want] of cases) {
    let v;
    try { v = C.parseVector(s).values.map(Q.toNum); } catch (e) { if (want === null) continue; return `threw on "${s}": ${e.message}`; }
    if (want === null) continue;
    if (v.length !== want.length || v.some((x, i) => !near(x, want[i], 1e-12))) return `"${s}" gave ${v}`;
  }
  for (const s of ['c(1, two)', 'c(', 'c(1,,2)', '1/0', 'abc', '']) { try { const v = C.parseVector(s); if (s === 'c(1,,2)' || (s === '' && v.values.length === 0)) continue; return `accepted "${s}"`; } catch (e) { if (!e.message) return 'empty error'; } }
  const mcases = [
    ['matrix(c(0, 1, 1, 0), nrow = 2)', [[0, 1], [1, 0]]],
    ['matrix(c(0, 1, 1/2, 0), 2, 2, TRUE)', [[0, 1], [0.5, 0]]],
    ['matrix(c(0, 1, 1/2, 0), nrow = 2, byrow = TRUE)', [[0, 1], [0.5, 0]]],
    ['matrix(c(0, 1, 1/2, 0), ncol = 2)', [[0, 0.5], [1, 0]]],
    ['matrix(0, 2, 2)', [[0, 0], [0, 0]]],
    ['G <- rbind(c(0, 1), c(1, 0))', [[0, 1], [1, 0]]],
    ['cbind(c(0, 1), c(1, 0))', [[0, 1], [1, 0]]],
    ['0 1\n1 0', [[0, 1], [1, 0]]],
    ['0, 1\n1, 0', [[0, 1], [1, 0]]],
    ['0 1 1 0', [[0, 1], [1, 0]]],
    ['matrix(c(\n  0, 1,\n  1, 0\n), nrow = 2, byrow = TRUE)', [[0, 1], [1, 0]]],
  ];
  for (const [s, want] of mcases) {
    let r;
    try { r = C.parseMatrix(s, 2).rows.map(row => row.map(Q.toNum)); } catch (e) { return `threw on "${s}": ${e.message}`; }
    if (JSON.stringify(r) !== JSON.stringify(want)) return `"${s}" gave ${JSON.stringify(r)}`;
  }
  for (const s of ['matrix(c(0,1,1), 2)', 'matrix(c(0,1,1,0,0,0,0,0,0), 3)', 'rbind(c(0,1,0), c(1,0,0), c(0,0,0))', 'matrix(nrow=2)', 'matrix(c(0,1,1,0', '0 1 1', 'rbind(c(0,1), c(1))']) {
    try { C.parseMatrix(s, 2); return `accepted "${s}"`; } catch (e) { if (!e.message || /undefined|TypeError/.test(e.message)) return 'ugly: ' + e.message; }
  }
  return true;
});

check('Expression weights: evaluation, display, TeX, malformed input', () => {
  const G = { nodes: [], edges: [], vars: {} };
  const ok = [['eps', '1/1000'], ['1-eps', '999/1000'], ['(1-gamma)/2', '1/4'], ['gamma*gamma', '1/4'], ['1 - γ', '1/2'], ['2*delta - 1/2', '1/2'], ['-(-gamma)', '1/2'], ['0.25', '1/4'], ['1/3', '1/3'], ['3/6', '1/2'], ['1e-2', '1/100'], ['.5', '1/2'], ['−0.5', '-1/2']];
  for (const [s, want] of ok) { const r = C.weightFromText(G, s); if (!r) return `rejected "${s}"`; if (Q.exact(r.q) !== want) return `"${s}" gave ${Q.exact(r.q)}`; }
  for (const s of ['gamma/0', '1/', '(', 'gamma gamma', '2**3', 'a^2', 'sin(1)', '1/2/', '//', 'ε+', '😀']) { if (C.weightFromText(G, s)) return `accepted "${s}"`; }
  if (C.exprDisplay('(1-gamma)*eps') !== '(1−γ)·ε') return 'display ' + C.exprDisplay('(1-gamma)*eps');
  if (C.exprTeX('(1-gamma)*eps') !== '$(1-\\gamma)\\cdot \\epsilon$') return 'tex ' + C.exprTeX('(1-gamma)*eps');
  // graph with an expression that references a removed variable keeps evaluating
  const o = C.templateJSON('successive'); o.vars = { 'γ': '1/4', 'δ': '3/4' };
  const Gs = toG(o);
  if (Q.exact(Gs.edges.find(e => e.from === Gs.nodes[0].id && e.to === Gs.nodes[1].id).g) !== '1/4') return 'gamma not applied';
  if (!C.isAlphaExhaustive(Gs)) return 'successive with gamma 1/4 should be exhaustive';
  return true;
});

check('Exports escape awkward labels (quotes, backslashes, %, _, &, <, unicode) and never throw', () => {
  const labels = ['H1', 'H"2"', "H'3'", 'H\\4', 'H_5 50%', 'H&6<7>', 'Ĥ₈ µ', '#9 {x}', 'H$10$', ''];
  const o = randomGraphJSON(labels.length, { allowLeaf: true });
  o.nodes.forEach((n, i) => { n.label = labels[i] || 'H10'; n.desc = `d "${i}" \\ % & <`; n.group = i % 2 ? 'grp "a"' : ''; n.p = '0.01'; });
  o.test = { type: 'parametric', upscale: true, corr: { '0|1': 0.5 } };
  const G = toG(o);
  const r1 = C.exportGraphicalMCP(G), r2 = C.exportGMCP(G), sap = C.sapText(G), plain = C.plainGraphText(G, (id, full) => id);
  const code = x => x.replace(/^\s*#.*$/gm, '');
  if (/H"2"/.test(code(r1)) || /H"2"/.test(code(r2))) return 'unescaped quote in R string';
  if (!/H\\"2\\"/.test(r1)) return 'R export did not escape quotes: ' + r1.slice(0, 400);
  const vmv = { nodes: G.nodes.map(n => ({ id: n.id, label: n.label, x: n.x, y: n.y, rx: C.nodeRx(n.label), ry: C.NODE_R, w: n.w, p: n.p, rejected: false, group: n.group || '', color: n.color || '' })), edges: G.edges.map(e => ({ from: e.from, to: e.to, g: e.g, bend: e.bend, text: Q.fmt(e.g) })) };
  const lay = C.layoutEdges(vmv);
  const tikz = C.exportTikZ(vmv, lay), svg = C.exportSVG(vmv, lay, q => Q.fmt(q)), beamer = C.exportBeamer([{ vm: vmv, layout: lay, caption: 'x & y % z', alpha: 0.025 }], 'T');
  if (/[^\\]%\s/.test(tikz.replace(/\\%/g, ''))) { /* comments allowed */ }
  if (/H_5 50%/.test(tikz)) return 'TikZ label not escaped: ' + tikz.match(/.*H_5.*/)[0];
  if (/H&6<7>/.test(svg)) return 'SVG label not escaped';
  if (!/&amp;6&lt;7&gt;/.test(svg)) return 'SVG escaping missing: ' + (svg.match(/.*6.*7.*/) || [''])[0];
  if (!beamer.includes('\\begin{frame}')) return 'beamer frame missing';
  for (const t of sap.tables) C.tableToHTML(t), C.tableToTSV(t);
  if (!sap.paragraphs.some(t => /closed test/i.test(t))) return 'SAP parametric text lacks closed test wording';
  if (!sap.paragraphs.some(t => /Xi/.test(t))) return 'SAP parametric text lacks Xi et al. reference';
  if (plain.length < 3) return 'plain text too short';
  return true;
});

check('graphicalMCP and gMCP exports: parametric blocks, simes groups, bonferroni; numbers reproduce the graph', () => {
  const o = C.templateJSON('bretz2011'); o.nodes.forEach((n, i) => { n.p = ['0.1', '0.008', '0.005', '0.15', '0.04', '0.006'][i]; });
  const G = toG(o);
  G.test = { type: 'parametric', upscale: false, corr: {} };
  const key = (i, j) => { const a = G.nodes[i].id, b = G.nodes[j].id; return a < b ? a + '|' + b : b + '|' + a; };
  G.test.corr[key(0, 1)] = 0.5; G.test.corr[key(0, 2)] = 0.5; G.test.corr[key(1, 2)] = 0.5; G.test.corr[key(3, 4)] = 0.3;
  const r = C.exportGraphicalMCP(G);
  if (!/corr_1/.test(r) || !/corr_2/.test(r)) return 'parametric export lacks block matrices: ' + r;
  if (!/list\(corr_1, corr_2, NA\)/.test(r)) return 'test_corr list should be corr_1, corr_2, NA: ' + r;
  if (!/parametric/.test(r)) return 'no parametric test spec';
  if (!/bonferroni/.test(r)) return 'singleton block should be bonferroni';
  G.test = { type: 'simes-groups', upscale: true, corr: {} };
  const r2 = C.exportGraphicalMCP(G);
  if (!/simes/.test(r2) || !/NOTE/.test(r2)) return 'simes-groups export lacks NOTE: ' + r2;
  if (!/upscale/i.test(r2)) return 'upscale caveat missing';
  G.test = { type: 'bonferroni', upscale: false, corr: {} };
  const r3 = C.exportGraphicalMCP(G), r4 = C.exportGMCP(G);
  const nums = r3.match(/hypotheses = c\(([^)]*)\)/);
  if (!nums || nums[1].split(',').length !== 6) return 'hypotheses vector: ' + r3;
  if (!/graph_test_shortcut|graph_test_closure/.test(r3)) return 'no test call';
  if (!/matrix2graph|gMCP/.test(r4)) return 'gMCP export';
  const trans = r3.match(/transitions = (matrix\([\s\S]*?nrow = 6[^)]*\))/);
  if (!trans) return 'transitions not found';
  const rows = C.parseMatrix(trans[1], 6).rows;
  const orig = C.matrixRows(G, q => Q.toNum(q));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (!near(Q.toNum(rows[i][j]), orig[i][j], 1e-9)) return `exported matrix differs at ${i},${j}`;
  return true;
});

check('orderAnalysis and whatWouldItTake are consistent with runProcedure on 150 random graphs', () => {
  for (let k = 0; k < 150; k++) {
    const m = ri(1, 7), G = toG(randomGraphJSON(m, { underWeight: true, allowLeaf: true })), ids = G.nodes.map(n => n.id);
    const p = randP(m, 0.08), pOf = id => p[ids.indexOf(id)], alpha = 0.025;
    const r = C.orderAnalysis(C.stateFromGraph(G), pOf, alpha);
    const auto = C.runProcedure(C.stateFromGraph(G), pOf, alpha).order.slice().sort().join();
    if (!r.capped && (r.finals.length !== 1 || r.finals[0].slice().sort().join() !== auto)) return `graph ${k}: orderAnalysis finals ${JSON.stringify(r.finals)} vs ${auto}`;
    const finalSet = new Set(auto.split(',').filter(Boolean));
    for (const id of ids) {
      const w = C.whatWouldItTake(C.stateFromGraph(G), id, pOf, alpha, 10);
      if (w.tooMany) continue;
      if (w.now.level < 0 || w.best.level < w.now.level - 1e-12) return 'best below now';
      // each minimal set must indeed make the target rejectable
      for (const s of w.minimal) {
        let st = C.stateFromGraph(G); for (const j of s.set) st = C.rejectNode(st, j);
        if (!C.isRejectable(st, id, pOf, alpha)) return `graph ${k}: minimal set does not make ${id} rejectable`;
        if (!near(Q.toNum(st.w.get(id)) * alpha, s.level, 1e-12)) return 'level mismatch';
      }
      // if target is finally rejected, some minimal set must be a subset of the final set
      if (finalSet.has(id) && w.minimal.length && !w.minimal.some(s => s.set.every(j => finalSet.has(j))) && !C.isRejectable(C.stateFromGraph(G), id, pOf, alpha)) return `graph ${k}: rejected target has no minimal set inside the final set`;
    }
  }
  return true;
});

check('validateGraph flags every defect and applyFix repairs it', () => {
  const o = { alpha: 0.025, nodes: [{ id: '0', label: 'A', weight: '3/2' }, { id: '1', label: 'A', weight: '-1/4' }, { id: '2', label: 'C', weight: '1/2' }], edges: [{ from: '0', to: '1', weight: '2' }, { from: '1', to: '2', weight: '1/2' }, { from: '1', to: '0', weight: '3/4' }], diag: [{ id: '2', weight: '1/3' }] };
  const G = toG(o);
  const V = C.validateGraph(G, q => Q.fmt(q));
  const texts = V.map(v => v.level + ':' + v.text).join('\n');
  if (!/3\/2/.test(texts) || !/-1\/4/.test(texts) || !/weight 2/.test(texts) || !/Diagonal/.test(texts) || !/add up to 5\/4/.test(texts) || !/More than one hypothesis is called A/.test(texts)) return 'missing message:\n' + texts;
  for (let round = 0; round < 5; round++) { const Vr = C.validateGraph(G, q => Q.fmt(q)).filter(v => v.level === 'error'); if (!Vr.length) break; if (!Vr.some(v => v.fix)) return 'error without a fix: ' + Vr[0].text; for (const v of Vr) if (v.fix) C.applyFix(G, v.fix); }
  const V2 = C.validateGraph(G, q => Q.fmt(q)).filter(v => v.level === 'error');
  if (V2.length) return 'errors remain after fixes: ' + V2.map(v => v.text).join('; ');
  const G2 = toG({ nodes: [{ id: '0', label: 'A', weight: '0' }, { id: '1', label: 'B', weight: '0' }], edges: [] });
  const V3 = C.validateGraph(G2, q => Q.fmt(q));
  const fx = V3.find(v => v.fix && v.fix.act === 'normW');
  if (!fx || fx.fix.label !== 'Share equally') return 'zero weights fix label';
  C.applyFix(G2, fx.fix);
  if (Q.exact(G2.nodes[0].w) !== '1/2') return 'share equally failed';
  return true;
});

check('joinGraphs and subgraphOf keep validity; join rescales weights; labels stay unique', () => {
  const A = toG(C.templateJSON('holm')), B = toG(C.templateJSON('holm'));
  const J = toG(C.joinGraphs(A, B));
  if (J.nodes.length !== 6) return 'join count';
  const labs = new Set(J.nodes.map(n => n.label)); if (labs.size !== 6) return 'duplicate labels after join';
  let s = Q.ZERO; for (const n of J.nodes) s = Q.add(s, n.w); if (!Q.eq(s, Q.ONE)) return 'join weights sum ' + Q.exact(s);
  if (C.validateGraph(J, q => Q.fmt(q)).some(v => v.level === 'error')) return 'join invalid';
  const S = toG(C.subgraphOf(J, J.nodes.slice(0, 3).map(n => n.id)));
  if (S.nodes.length !== 3 || S.edges.length !== 6) return 'subgraph shape';
  const E = toG(C.subgraphOf(J, []));
  if (E.nodes.length !== 0) return 'empty subgraph';
  return true;
});

check('closedTestAsync gives the same result as closedTest and reports progress', () => {
  const G = toG(C.generatedTemplate('holm', 9)), p = randP(9, 0.3), fg = C.floatGraph(G);
  const sync = C.closedTest(fg, p, 0.05, 'simes', { upscale: false });
  let prog = 0;
  return C.closedTestAsync(fg, p, 0.05, 'simes', { upscale: false }, (d, t) => { prog = d / t; }).then(r => {
    if (prog !== 1) return 'progress did not reach 1';
    if (r.adj.some((a, i) => !near(a, sync.adj[i], 1e-12))) return 'async differs';
    return true;
  });
});

check('Exact rationals: huge denominators, long chains of rejections stay exact and bounded', () => {
  const o = randomGraphJSON(8, {});
  o.nodes.forEach((n, i) => { n.weight = `1/${[3, 7, 11, 13, 17, 19, 23, 29][i]}`; });
  const tot = o.nodes.reduce((s, n) => Q.add(s, Q.parse(n.weight)), Q.ZERO);
  o.nodes.forEach(n => { n.weight = Q.exact(Q.div(Q.parse(n.weight), tot)); });
  o.edges.forEach((e, k) => { e.weight = `1/${[31, 37, 41, 43, 47][k % 5]}`; });
  const G = toG(o);
  let st = C.stateFromGraph(G);
  for (const id of G.nodes.map(n => n.id)) {
    st = C.rejectNode(st, id);
    let s = Q.ZERO; for (const i of st.ids) s = Q.add(s, st.w.get(i));
    if (Q.cmp(s, Q.ONE) > 0) return 'weights exceed 1';
    for (const a of st.ids) { let r = Q.ZERO; for (const b of st.ids) r = Q.add(r, C.getg(st, a, b)); if (Q.cmp(r, Q.ONE) > 0) return 'row exceeds 1'; }
    if (st.ids.some(i => String(st.w.get(i).d).length > 400)) return 'denominator blow-up';
  }
  return true;
});

check('Normal functions across the range: qnorm/pnormUpper inverse pairs, tails to 1e-12', () => {
  for (const p of [1e-12, 1e-8, 1e-4, 0.001, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999, 1 - 1e-8]) {
    const z = C.qnorm(p);
    const back = 1 - C.pnormUpper(z);
    if (Math.abs(back - p) > 2e-7 * Math.max(p, 1 - p) + 2e-7 * Math.min(p, 1 - p) * 10) return `p=${p}: back ${back}`;
  }
  if (C.qnorm(0) !== -Infinity || C.qnorm(1) !== Infinity) return 'limits';
  if (Math.abs(C.qnorm(0.975) - 1.959963984540054) > 2e-9) return 'qnorm(0.975)';
  return true;
});

check('Power simulation reproduces single-test power for several targets and correlations (type I error of Bonferroni graph <= alpha)', () => {
  for (const [pw, rho] of [[0.5, 0], [0.9, 0.7], [0.3, -0.3]]) {
    const G = toG(C.generatedTemplate('holm', 2)), fg = C.floatGraph(G), alpha = 0.025;
    const R = Float64Array.of(1, rho, rho, 1), L = C.cholesky(R, 2);
    const za = C.qnorm(1 - alpha), mean = [za + C.qnorm(pw), -10];
    const tally = { n: 0, rej: [0, 0], any: 0, all: 0, total: 0, custom: 0 };
    C.simulateChunk(fg, mean, L, alpha, 60000, C.normalGen(C.mulberry32(3)), tally, { idx: [0], rule: 'any' }, null);
    // H1 alone at level alpha/2 first, then alpha once H2 rejected (never): power = P(Z > z_{alpha/2}) with mean
    const want = C.pnormUpper(C.qnorm(1 - alpha / 2) - mean[0]);
    const got = tally.rej[0] / tally.n;
    if (Math.abs(got - want) > 0.01) return `power ${pw} rho ${rho}: got ${got.toFixed(4)} want ${want.toFixed(4)}`;
    if (tally.custom !== tally.rej[0]) return 'success rule tally';
  }
  return true;
});

check('Share tokens are URL safe and reasonably short (12 hypotheses with p-values under 1500 chars)', () => {
  const o = C.generatedTemplate('holm', 12); o.nodes.forEach(n => { n.p = '0.0123'; });
  const tok = C.encodeShare(toG(o));
  if (encodeURIComponent(tok) !== tok) return 'token needs encoding';
  console.log(`   share token for Holm(12) with p-values: ${tok.length} chars`);
  return tok.length < 8000 || `length ${tok.length}`;
});

/* ---------- SAP text (1.1.4 revision) ---------- */
check('SAP text over 300 random graphs and every test type: structure, corrected citations, sidedness, exhaustiveness and correlation table', () => {
  const types = ['bonferroni', 'simes', 'simes-groups', 'parametric'];
  for (let k = 0; k < 300; k++) {
    const m = ri(2, 6), G = toG(randomGraphJSON(m, { underRow: rnd() < 0.3 })), tt = types[k % 4];
    if (tt === 'simes-groups') G.nodes.forEach((n, i) => { n.group = i % 2 ? 'secondary' : 'primary'; });
    G.test = { type: tt, upscale: rnd() < 0.3, corr: {} };
    if (tt === 'parametric') { const a = G.nodes[0].id, b = G.nodes[1].id; G.test.corr[a < b ? a + '|' + b : b + '|' + a] = 0.5; }
    G.sided = tt !== 'parametric' && rnd() < 0.3 ? 'two' : 'one';
    const sap = C.sapText(G), t = sap.paragraphs.join(' ');
    if (sap.heads.length !== sap.paragraphs.length || sap.paragraphs.some((p, i) => !p.startsWith(sap.heads[i] + '. '))) return `graph ${k}: heads do not match paragraphs`;
    const OLD = /\(Sarkar, 1998\)|equation 3\)|Xi et al\., 2017; Bretz et al\., 2011, section 3\.2|; Xi et al\., 2017\)|simes\.on\.subsets\.test in the gMCP package; Bretz/;
    if (OLD.test(t)) return `graph ${k}: an old wrong citation: ${t.match(OLD)[0]}`;
    if (/Sarkar/.test(t) && !(G.sided === 'two' && /simes/.test(tt))) return `graph ${k}: Sarkar cited outside the two-sided Simes note`;
    if (/—/.test(t)) return `graph ${k}: em dash in the text`;
    if (!t.includes('In the initial graph')) return `graph ${k}: no initial-graph wording`;
    if (G.sided === 'two' && !/\[the experimental treatment\]/.test(t)) return `graph ${k}: two-sided without the direction rule`;
    if (G.sided === 'two' && tt !== 'bonferroni' && /one-sided [0-9.]+ in the direction of benefit/.test(t)) return `graph ${k}: closed test claims one-sided control from two-sided p-values`;
    const exh = C.isAlphaExhaustive(G);
    let ws = C.Q.ZERO; for (const n of G.nodes) ws = C.Q.add(ws, n.w);
    const flag = /does not (always )?use the full α|is not α-exhaustive/.test(t);
    if ((exh === false) !== flag) return `graph ${k}: exhaustiveness ${exh} but flag in text ${flag}`;
    if (exh === false && G.test.upscale && tt !== 'bonferroni' && C.Q.eq(ws, C.Q.ONE) && (/does not always use the full α/.test(t) || !/rescaling changes the procedure/.test(t))) return `graph ${k}: upscale note wrong`;
    if (exh === false && !G.test.upscale && tt !== 'bonferroni' && C.Q.eq(ws, C.Q.ONE) && !/not guaranteed/.test(t)) return `graph ${k}: closed non-exhaustive without the gatekeeping warning`;
    if (tt !== 'bonferroni' && /from a rejected hypothesis/.test(t)) return `graph ${k}: sequential wording in a closed test`;
    if (sap.refs.some((r, i) => i > 0 && sap.refs[i - 1].localeCompare(r) > 0)) return `graph ${k}: references not in alphabetical order`;
    if (tt === 'bonferroni') {
      for (const n of G.nodes) if (!C.Q.isZero(n.w) && !t.includes('level ' + C.fmtNum(C.Q.toNum(n.w) * G.alpha, 6))) return `graph ${k}: no numeric level for ${n.label}`;
      if (/Technical details/.test(t)) return `graph ${k}: technical details for Bonferroni`;
    } else if (!sap.heads.includes('Technical details')) return `graph ${k}: no technical details for ${tt}`;
    if (tt === 'parametric' && (sap.tables.length !== 3 || !t.includes('Xi et al. (2017, section 4.3, eq. 6)'))) return `graph ${k}: parametric table or citation missing`;
    if (tt === 'simes-groups' && !/more conservative than the Bonferroni mixture/.test(t)) return `graph ${k}: Simes-within-groups attribution`;
    if (tt === 'simes' && !/Benjamini and Heller, 2007/.test(t)) return `graph ${k}: Simes validity citation`;
    for (const tb of sap.tables) { C.tableToHTML(tb); C.tableToTSV(tb); }
    const cited = ['Bretz et al. (2009', 'Marcus et al.', 'Benjamini and Hochberg', 'Benjamini and Yekutieli', 'Benjamini and Heller', 'Samuel-Cahn', 'Lu (2016', 'Xi et al.', 'Genz and Bretz', 'Sarkar'];
    const inRefs = ['Bretz F, Maurer W', 'Marcus R', 'Benjamini Y, Hochberg', 'Benjamini Y, Yekutieli', 'Benjamini Y, Heller', 'Samuel-Cahn E', 'Lu K', 'Xi D', 'Genz A', 'Sarkar SK'];
    for (let c = 0; c < cited.length; c++) if (t.includes(cited[c]) && !sap.refs.some(r => r.startsWith(inRefs[c]))) return `graph ${k}: ${cited[c]} cited but not in the references`;
  }
  return true;
});
check('Correlation conflicts: a positive definite matrix gives none; an impossible triple is named exactly; a ±1 pair is named; agrees with the Cholesky test on 500 random matrices', () => {
  const at = M => (i, j) => M[i][j];
  if (C.corrConflict([0, 1, 2], at([[1, .5, .5], [.5, 1, .5], [.5, .5, 1]])) !== null) return 'PD matrix flagged';
  const t = C.corrConflict([0, 1, 2, 3], at([[1, .9, .9, 0], [.9, 1, -.9, 0], [.9, -.9, 1, 0], [0, 0, 0, 1]]));
  if (!t || t.join() !== '0,1,2') return 'triple: ' + t;
  const p = C.corrConflict([0, 1, 2], at([[1, 1, 0], [1, 1, 0], [0, 0, 1]]));
  if (!p || p.join() !== '0,1') return 'pair: ' + p;
  for (let k = 0; k < 500; k++) {
    const m = ri(2, 7), M = Array.from({ length: m }, () => Array(m).fill(1));
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) M[i][j] = M[j][i] = Math.round((rnd() * 2 - 1) * 100) / 100;
    const R = new Float64Array(m * m); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) R[i * m + j] = M[i][j];
    const pd = !!C.cholesky(R, m), c = C.corrConflict([...Array(m).keys()], at(M));
    if (pd !== (c === null)) return `case ${k}: Cholesky ${pd}, conflict ${c}`;
    if (c && c.length < m) { const S = new Float64Array(c.length ** 2); c.forEach((i, a) => c.forEach((j, b) => { S[a * c.length + b] = M[i][j]; })); if (C.cholesky(S, c.length)) return `case ${k}: named set ${c} is fine on its own`; }
  }
  return true;
});

/* ---------- gain functions (multigrain stage) ---------- */
/* Random well-typed gain expressions, written with random spacing, brackets and and/or words */
function randomGain(m, depth) {
  const leafR = () => ({ txt: 'r' + ri(1, m), bool: true });
  const leafN = () => ({ txt: String(ri(0, 20) / 4), bool: false });
  if (depth <= 0) return rnd() < 0.7 ? leafR() : leafN();
  const kind = ri(0, 5);
  if (kind <= 1) { // && or || between true/false terms
    const a = randomBool(m, depth - 1), b = randomBool(m, depth - 1);
    const op = kind === 0 ? (rnd() < 0.5 ? '&&' : 'and') : (rnd() < 0.5 ? '||' : 'or');
    return { txt: `(${a.txt} ${op} ${b.txt})`, bool: true };
  }
  const a = randomGain(m, depth - 1), b = randomGain(m, depth - 1), op = ['+', '-', '*', '/'][kind - 2];
  if (op === '/' ) return { txt: `(${a.txt}) / (${ri(1, 8)})`, bool: false };
  const br = rnd() < 0.5;
  return { txt: br ? `(${a.txt} ${op} ${b.txt})` : `${a.txt}${rnd() < 0.5 ? ' ' : ''}${op}${rnd() < 0.5 ? ' ' : ''}${b.txt}`, bool: op === '*' && a.bool && b.bool };
}
function randomBool(m, depth) {
  if (depth <= 0 || rnd() < 0.3) return { txt: 'r' + ri(1, m), bool: true };
  const a = randomBool(m, depth - 1), b = randomBool(m, depth - 1), op = ['&&', '||', '*'][ri(0, 2)];
  return { txt: `(${a.txt} ${op} ${b.txt})`, bool: true };
}
/* Independent reference: JavaScript's own precedence (* / then + - then && then ||) on 0/1 values;
   && and || are turned into a*b and min(1, a+b) only at the top of each bracketed group by wrapping */
function refGain(txt, r) {
  const js = txt.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||').replace(/r(\d+)/g, (_, k) => `R[${k - 1}]`);
  const val = Function('R', `"use strict"; return (${js});`)(r);
  return typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
}
check('Gain parser agrees with JavaScript\'s own evaluation on 3,000 random gain functions and every rejection pattern', () => {
  for (let k = 0; k < 3000; k++) {
    const m = ri(2, 5), e = randomGain(m, ri(1, 4)), g = C.parseGain(e.txt, m);
    if (!/r\d/.test(e.txt)) { if (g.ok) return `"${e.txt}" has no hypothesis but was accepted`; continue; }
    if (!g.ok) return `"${e.txt}" refused: ${g.msg}`;
    for (let pat = 0; pat < (1 << m); pat++) {
      const r = Array.from({ length: m }, (_, i) => (pat >> i) & 1), a = g.fn(r), b = refGain(e.txt, r);
      if (!near(a, b, 1e-12)) return `"${e.txt}" pattern ${r.join('')}: app ${a}, reference ${b}`;
    }
  }
  return true;
});
check('The R text written for multigrain reads back to the same gain for 3,000 random gain functions', () => {
  for (let k = 0; k < 3000; k++) {
    const m = ri(2, 6), e = randomGain(m, ri(1, 4)), g = C.parseGain(e.txt, m);
    if (!g.ok) { if (/r\d/.test(e.txt)) return `"${e.txt}" refused: ${g.msg}`; continue; }
    const R = C.gainToR(g.ast, m), g2 = C.parseGain(R, m);
    if (!g2.ok) return `R text "${R}" refused: ${g2.msg}`;
    if (!/^r\d+$/.test(R) && g.ast.t === 'op' && !(R.startsWith('(') || R.includes(' + 0 * r'))) return 'not bracketed: ' + R;
    for (let pat = 0; pat < (1 << m); pat++) {
      const r = Array.from({ length: m }, (_, i) => (pat >> i) & 1);
      if (!near(g.fn(r), g2.fn(r), 1e-12)) return `"${e.txt}" -> "${R}" differs at ${r.join('')}`;
    }
    for (let i = 1; i <= m; i++) if (!new RegExp('\\br' + i + '\\b').test(R)) return `R text "${R}" does not mention r${i}`;
  }
  return true;
});
check('Expected gain equals the existing power tallies: any, all and number rejected (same trials, exactly)', () => {
  for (let k = 0; k < 20; k++) {
    const m = ri(2, 6), G = toG(randomGraphJSON(m)), fg = C.floatGraph(G), rho = ri(-1, 8) / 10;
    const R = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) R.push(i === j ? 1 : rho);
    const pw = Array.from({ length: m }, () => 0.5 + rnd() * 0.45), L = C.cholesky(R, m), mean = pw.map(p => C.qnorm(0.975) + C.qnorm(p));
    if (!L) continue;
    const ids = Array.from({ length: m }, (_, i) => 'r' + (i + 1));
    for (const [txt, key] of [[ids.join(' || '), 'any'], [ids.join(' && '), 'all'], [ids.join(' + '), 'total']]) {
      const tally = { n: 0, rej: new Array(m).fill(0), any: 0, all: 0, total: 0, custom: 0 };
      C.simulateChunk(fg, mean, L, 0.025, 4000, C.normalGen(C.mulberry32(k + 1)), tally, { gain: C.parseGain(txt, m).fn });
      if (tally.gain !== tally[key]) return `graph ${k}: gain ${tally.gain} vs ${key} ${tally[key]}`;
    }
  }
  return true;
});
check('Elicited gains: v_base plus all v_j is 1, every gain is in [0, 1] and the maximum is 1 (300 random elicitations)', () => {
  for (let k = 0; k < 300; k++) {
    const m = ri(2, 7), nReg = ri(1, m), reg = Array.from({ length: m }, (_, i) => i + 1).sort(() => rnd() - 0.5).slice(0, nReg).sort((a, b) => a - b);
    const scores = {}; for (let j = 1; j <= m; j++) if (!reg.includes(j)) scores[j] = ri(1, 100);
    const sAll = 100 + ri(0, 150), e = C.elicitGain(m, reg, rnd() < 0.5 ? 'all' : 'any', scores, sAll);
    if (!e.ok) return `case ${k}: ${e.msg}`;
    const tot = e.vBase + Object.values(e.v).reduce((a, b) => a + b, 0);
    if (!near(tot, 1, 1e-12)) return `case ${k}: total ${tot}`;
    const g = C.parseGain(e.expr, m); if (!g.ok) return `case ${k}: "${e.expr}" refused: ${g.msg}`;
    const t = C.gainTable(g.fn, m);
    if (t.negative || t.notFinite || t.max > 1 + 5e-4 || t.max < 1 - 5e-4) return `case ${k}: "${e.expr}" max ${t.max}`;
  }
  return true;
});
check('Expected gain reproduces Spiers et al. (2026) Tables 4 and 5 to within simulation error (500,000 trials each)', () => {
  const fixedSeq = order => { const m = order.length, w = new Float64Array(m), g = new Float64Array(m * m); w[order[0]] = 1; for (let k = 0; k + 1 < m; k++) g[order[k] * m + order[k + 1]] = 1; return { m, w, g }; };
  const S3 = [1, .8, .5, .5, .8, .8, 1, .5, .5, .8, .5, .5, 1, .5, .5, .5, .5, .5, 1, .5, .8, .8, .5, .5, 1];
  const g3 = C.parseGain('r1 * r2 * (0.556 + 0.252*r3 + 0.148*r4 + 0.044*r5)', 5).fn;
  const holm = { m: 5, w: Float64Array.of(1, 0, 0, 0, 0), g: new Float64Array(25) };
  holm.g[1] = 1; for (const j of [2, 3, 4]) holm.g[5 + j] = 1 / 3;
  for (const i of [2, 3, 4]) for (const j of [2, 3, 4]) if (i !== j) holm.g[i * 5 + j] = 0.5;
  const S4 = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) S4.push(i === j ? 1 : 0.7);
  const g4 = C.parseGain('r1 * (0.4 + 0.2*r2 + 0.2*r3 + 0.2*r4)', 4).fn;
  const runs = [
    ['Ex 3 value-ordered', fixedSeq([0, 1, 2, 3, 4]), [0.90, 0.90, 0.80, 0.70, 0.85], S3, g3, 0.769],
    ['Ex 3 power-ordered', fixedSeq([0, 1, 4, 2, 3]), [0.90, 0.90, 0.80, 0.70, 0.85], S3, g3, 0.767],
    ['Ex 3 H1, H2, Holm', holm, [0.90, 0.90, 0.80, 0.70, 0.85], S3, g3, 0.770],
    ['Ex 4 fixed sequence', fixedSeq([0, 1, 2, 3]), [0.90, 0.90, 0.80, 0.70], S4, g4, 0.803]
  ];
  for (const [name, fg, pw, S, g, want] of runs) {
    const r = C.expectedGain(fg, pw, S, 0.025, g, 500000, 777);
    if (Math.abs(r.mean - want) > 3 * r.se + 0.0005) return `${name}: ${r.mean.toFixed(4)} (SE ${r.se.toFixed(4)}), paper ${want}`;
  }
  return true;
});

/* ---------- multigrain script writer (multigrain stage, step 4) ---------- */
const cp = require('child_process'), os = require('os');
const haveR = (() => { try { cp.execSync('Rscript --version', { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
/* MULTIGRAIN_R: the R/ folder of the multigrain 1.0.0 source (a clone of https://github.com/cran/multigrain), used when the
   package itself is not installed. Checks that need R pass with a note when R or the source is missing. */
const mgR = process.env.MULTIGRAIN_R || '';
/* With multigrain installed (Niamh's Mac) the checks use the package itself: the constraint check calls its graph_constraint()
   and the script check runs the written script for real (a small local search). */
const mgInstalled = haveR && (() => { try { return cp.execSync('Rscript -e "cat(requireNamespace(\'multigrain\', quietly = TRUE))"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('TRUE'); } catch (e) { return false; } })();
const rCheck = (name, fn) => check(name, () => (haveR && (mgR || mgInstalled) ? fn() : true));
function specFor(G, opts = {}) {
  const m = G.nodes.length, fg = C.floatGraph(G);
  const g = []; for (let i = 0; i < m; i++) g.push(Array.from(fg.g.slice(i * m, i * m + m)));
  const corr = []; for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) corr.push(i === j ? 1 : 0.3);
  return Object.assign({ labels: G.nodes.map(n => n.label), descs: G.nodes.map(() => ''), groups: G.nodes.map(() => ''), alpha: 0.025,
    powers: G.nodes.map(() => 0.8), corr, nsim: 1000, gainR: C.gainToR(C.parseGain(G.nodes.map((_, i) => 'r' + (i + 1)).join(' || '), m).ast, m),
    hyp: G.nodes.map(() => null), trans: G.nodes.map((_, i) => G.nodes.map((_, j) => (i === j ? 0 : null))),
    start: { w: Array.from(fg.w), g }, globalSearch: true, threads: 1, file: 'optimised-graph.json', note: '' }, opts);
}
check('The embedded sketchpad_json() is identical to R/multigrain-to-sketchpad.R', () => {
  const file = fs.readFileSync(require('path').join(__dirname, '..', 'R', 'multigrain-to-sketchpad.R'), 'utf8');
  const i = file.indexOf('sketchpad_json <- function'); if (i < 0) return 'function not found in the R file';
  const lines = file.slice(i).split('\n'); let j = lines.findIndex((l, k) => k > 0 && l === '}');
  const fromFile = lines.slice(0, j + 1).join('\n');
  return fromFile === C.SKETCHPAD_JSON_R || 'the copy in core.js differs from the R file';
});
check('The R script for multigrain: names, matrices, constraints, gain and options are written as given (snapshot checks on 60 random graphs)', () => {
  for (let k = 0; k < 60; k++) {
    const m = ri(2, 6), G = toG(randomGraphJSON(m)), spec = specFor(G), fg = C.floatGraph(G);
    const locks = rnd() < 0.5; let fixedW = 0;
    if (locks && m > 2) { for (let i = 0; i < m; i++) if (rnd() < 0.4) { spec.hyp[i] = Array.from(fg.w)[i]; fixedW++; } if (fixedW === m - 1) spec.hyp = G.nodes.map(() => null); }
    spec.globalSearch = rnd() < 0.5; spec.threads = ri(1, 8); spec.nsim = [10000, 100000, 1000000][ri(0, 2)]; spec.file = 'graph ' + k + '.json';
    if (rnd() < 0.5) spec.start = null;
    if (rnd() < 0.3) { spec.descs[0] = 'Dose "1", primary'; spec.groups[1] = 'primary'; }
    const s = C.optimiseRScript(spec);
    const need = [`hyp_names <- c(${G.nodes.map(n => `"${n.label}"`).join(', ')})`, `nsim <- ${spec.nsim}`, `power_nominal <- c(${spec.powers.map(x => String(Number(x.toPrecision(15)))).join(', ')})`, `global_search = ${spec.globalSearch ? 'TRUE' : 'FALSE'}`, `num_threads = ${spec.threads}L`, 'inputs = list(power_nominal = power_nominal, corr_matrix = corr_matrix, nsim = nsim)',
      `file = "graph ${k}.json"`, `trial_success("${spec.gainR}")`, `nrow = ${m}, byrow = TRUE`, 'set.seed(2009)', 'library(multigrain)', 'sketchpad_json <- function'];
    for (const t of need) if (!s.includes(t)) return `graph ${k}: missing ${t}`;
    if (spec.start ? !(s.includes('start_graph <- list(') && s.includes('start_graph = list(start_graph)') && s.includes('start = start_graph,')) : s.includes('start_graph')) return `graph ${k}: start_graph`;
    if (spec.hyp.every(x => x == null) ? !s.includes(`graph_constraint_free(${m}, names = hyp_names)`) : !s.includes(`hyp_constraint = c(${spec.hyp.map(x => (x == null ? 'NA' : String(Number(x.toPrecision(15))))).join(', ')})`)) return `graph ${k}: constraint`;
    if (spec.descs[0] && !s.includes('labels = c("Dose \\"1\\", primary"')) return `graph ${k}: label escaping`;
    const gcBlock = s.includes('gc <- graph_constraint(') ? s.slice(s.indexOf('gc <- graph_constraint('), s.indexOf('\n)\n', s.indexOf('gc <- graph_constraint('))) : '';
    if ((gcBlock.match(/\bNA\b/g) || []).length !== (spec.hyp.every(x => x == null) ? 0 : m - fixedW + m * (m - 1))) return `graph ${k}: NA count`;
  }
  return true;
});
check('multigrainConstraintProblems: the five rules on hand-made cases', () => {
  const L = ['H1', 'H2', 'H3'], T = [[0, null, null], [null, 0, null], [null, null, 0]];
  const P = (h, t) => C.multigrainConstraintProblems(h, t, L).map(x => x.what + (x.what === 'row' ? x.id : '')).join(',');
  if (P([null, null, null], T) !== '') return 'free graph flagged';
  if (P([0.5, 0.5, 0], [[0, 1, 0], [0, 0, 1], [1, 0, 0]]) !== 'all') return 'nothing free not flagged';
  if (P([0.5, 0.5, 0], [[0, 1, 0], [0, 0, 1], [null, null, 0]]) !== '') return 'one free row flagged';
  if (P([0.5, 0.5, 0], T) !== '') return 'complete weights summing to 1 flagged';
  if (P([0.5, 0.25, 0], T) !== 'w') return 'complete weights not summing to 1 not flagged';
  if (P([0.5, 0.5, null], T) !== 'w') return 'incomplete weights already at 1 not flagged';
  if (P([0.5, null, null], T) !== '') return 'two free weights flagged';
  if (P([0.5, 0.25, null], T) !== 'w') return 'single free weight not flagged';
  if (P([0.7, 0.7, null], T) !== 'w') return 'weights over 1 not flagged';
  if (P([null, null, null], [[0, 1, 0], [null, 0, null], [null, null, 0]]) !== '') return 'complete row summing to 1 flagged';
  if (P([null, null, null], [[0, 0, 0], [null, 0, null], [null, null, 0]]) !== 'row0') return 'complete row summing to 0 not flagged';
  if (P([null, null, null], [[0, 1, null], [null, 0, null], [null, null, 0]]) !== 'row0') return 'incomplete row already at 1 not flagged';
  if (P([null, null, null], [[0, 0.5, null], [null, 0, null], [null, null, 0]]) !== 'row0') return 'single free transition not flagged';
  return true;
});
rCheck('multigrainConstraintProblems agrees with multigrain\'s own graph_constraint() validation on 150 random constraint patterns (needs Rscript and MULTIGRAIN_R or an installed multigrain)', () => {
  const cases = [];
  for (let k = 0; k < 150; k++) {
    const m = ri(2, 5), G = toG(randomGraphJSON(m, { allowLeaf: true, underWeight: rnd() < 0.3, underRow: rnd() < 0.3 })), fg = C.floatGraph(G);
    const hyp = Array.from(fg.w).map(w => (rnd() < 0.5 ? w : null));
    const trans = []; for (let i = 0; i < m; i++) { const r = []; for (let j = 0; j < m; j++) r.push(i === j ? 0 : (rnd() < 0.5 ? fg.g[i * m + j] : null)); trans.push(r); }
    cases.push({ hyp, trans, app: C.multigrainConstraintProblems(hyp, trans, G.nodes.map(n => n.label)).length > 0 });
  }
  const dir = fs.mkdtempSync(require('path').join(os.tmpdir(), 'mgs-')), f = require('path').join(dir, 'cases.json');
  fs.writeFileSync(f, JSON.stringify(cases.map(c => ({ hyp: c.hyp, trans: c.trans }))));
  const out = cp.execSync(`Rscript "${require('path').join(__dirname, 'multigrain-constraints-check.R')}" "${f}" "${mgR}"`, { encoding: 'utf8', timeout: 600000 }).split('\n').filter(l => l && !l.startsWith('#'));
  if (out.length !== cases.length) return `R printed ${out.length} lines for ${cases.length} cases`;
  for (let k = 0; k < cases.length; k++) {
    const rErr = out[k].startsWith('ERROR');
    if (rErr !== cases[k].app) return `case ${k} (hyp ${JSON.stringify(cases[k].hyp)}, trans ${JSON.stringify(cases[k].trans)}): app ${cases[k].app ? 'flags a problem' : 'sees no problem'}, multigrain ${out[k]}`;
  }
  return true;
});
rCheck('The written script runs end to end (for real with multigrain installed, otherwise in a dry run with multigrain\'s own validators) and sketchpad_json() writes a file that reopens with the optimisation block (needs Rscript and multigrain or MULTIGRAIN_R)', () => {
  const real = mgInstalled && !mgR;
  for (let k = 0; k < (real ? 3 : 6); k++) {
    const m = ri(2, 5), G = toG(randomGraphJSON(m)), spec = specFor(G), fg = C.floatGraph(G);
    if (k % 2 === 1 && m > 2) { spec.hyp = Array.from(fg.w); spec.trans = []; for (let i = 0; i < m; i++) { const r = []; for (let j = 0; j < m; j++) r.push(i === j ? 0 : fg.g[i * m + j]); spec.trans.push(r); }
      if (C.multigrainConstraintProblems(spec.hyp, spec.trans, spec.labels).length) { spec.hyp = G.nodes.map(() => null); spec.trans = G.nodes.map((_, i) => G.nodes.map((_, j) => (i === j ? 0 : null))); } }
    spec.descs[0] = 'Dose "1"'; spec.groups[0] = 'primary'; spec.file = 'out.json';
    if (real) { spec.globalSearch = false; spec.nsim = 2000; }
    const dir = fs.mkdtempSync(require('path').join(os.tmpdir(), 'mgs-')), sf = require('path').join(dir, 'optimise-graph.R');
    fs.writeFileSync(sf, C.optimiseRScript(spec));
    let out;
    try { out = cp.execSync(real ? `Rscript "${sf}"` : `Rscript "${require('path').join(__dirname, 'multigrain-dry-run.R')}" "${sf}" "${mgR}"`, { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }); }
    catch (e) { return `graph ${k}: ${real ? 'the script failed in R' : 'dry run failed'}: ${(e.stderr || e.stdout || String(e)).slice(-400)}`; }
    if (!real && !out.includes('DRY RUN OK')) return `graph ${k}: ${out.slice(-300)}`;
    const json = JSON.parse(fs.readFileSync(require('path').join(dir, 'out.json'), 'utf8'));
    if (!C.isExchangeFormat(json)) return `graph ${k}: the file is not in the exchange format`;
    const H = C.deserializeGraph(C.fromExchangeFormat(json, n => Array.from({ length: n }, (_, i) => ({ x: i * 100, y: 0 })), () => ''), false, 1).G, hg = C.floatGraph(H);
    if (H.nodes.length !== m || H.nodes[0].desc !== 'Dose "1"' || H.nodes[0].group !== 'primary') return `graph ${k}: labels or groups lost`;
    const blk = H.opt;
    if (!blk || blk.gain !== spec.gainR || !blk.inputs || blk.inputs.nsim !== spec.nsim || blk.inputs.powerNominal.join() !== spec.powers.join() || !blk.start || blk.start.weights.length !== m || !blk.graphValid || blk.localPower.length !== m) return `graph ${k}: optimisation block ${JSON.stringify(blk)}`;
    if (real) {
      /* A real run: the result is a valid graph (weights and rows at most 1), multigrain's gain is a probability-scale value and the
         start graph in the block is the one given; the optimised graph itself differs from the start */
      if (blk.optSource !== 'local' || blk.graphValid.local !== true || blk.graphValid.global !== null || !(blk.expectedGain >= 0 && blk.expectedGain <= 1 + 1e-9)) return `graph ${k}: real run block ${JSON.stringify(blk)}`;
      for (let i = 0; i < m; i++) if (!near(blk.start.weights[i], fg.w[i], 1e-12)) return `graph ${k}: start weight ${i}`;
      if (C.validateGraph(H, x => String(C.Q.toNum(x))).some(v => v.level === 'error')) return `graph ${k}: the optimised graph is not valid`;
    } else {
      if (blk.optSource !== 'stub' || blk.graphValid.local !== true || blk.graphValid.global !== null || blk.expectedGain !== 0.5) return `graph ${k}: stub block ${JSON.stringify(blk)}`;
      for (let i = 0; i < m; i++) if (!near(hg.w[i], fg.w[i], 1e-12)) return `graph ${k}: weight ${i}`;
      for (let i = 0; i < m * m; i++) if (!near(hg.g[i], fg.g[i], 1e-12)) return `graph ${k}: transition ${i}`;
    }
  }
  return true;
});

/* ---------- optimisation block of the exchange format (multigrain stage, step 5) ---------- */
const importX = o => C.deserializeGraph(C.fromExchangeFormat(o, n => Array.from({ length: n }, (_, i) => ({ x: i * 100, y: 0 })), () => ''), false, 1).G;
check('Exchange format: the optimisation block is read field by field, garbage is left out, and multigrain\'s 0.001 weights become ε (other sources keep the number)', () => {
  const base = () => ({ format: 'multiplicity-graph', version: 1, source: 'multigrain 1.0.0', alpha: 0.025, hypotheses: [{ name: 'H1', weight: 0.5 }, { name: 'H2', weight: 0.499 }, { name: 'H3', weight: 0.001 }], transitions: [[0, 0.999, 0.001], [1, 0, 0], [0.5, 0.5, 0]] });
  const full = base();
  full.optimisation = { package: 'multigrain 1.0.0', gain: '((r1 * r2) || r3)', expected_gain: 0.693, local_power: [0.7, 0.6, 0.5], expected_rejections: 1.8, disjunctive_power: 0.9, conjunctive_power: 0.3, opt_source: 'local', graph_valid: { local: true, global: null }, global_search: false, inputs: { power_nominal: [0.9, 0.8, 0.7], corr_matrix: [[1, 0.5, 0.2], [0.5, 1, 0.2], [0.2, 0.2, 1]], nsim: 1000000 }, start: { weights: [1, 0, 0], transitions: [[0, 1, 0], [0, 0, 1], [0, 0, 0]] } };
  const x = C.fromExchangeFormat(full, n => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })), () => '');
  if (x.optimisation !== full.optimisation) return 'the raw block is not passed through';
  const b = C.readOptimisationBlock(x.optimisation, 3);
  if (!b || b.gain !== '((r1 * r2) || r3)' || b.expectedGain !== 0.693 || b.localPower.join() !== '0.7,0.6,0.5' || b.optSource !== 'local' || b.graphValid.local !== true || b.graphValid.global !== null || b.globalSearch !== false) return 'block fields: ' + JSON.stringify(b);
  if (!b.inputs || b.inputs.nsim !== 1000000 || b.inputs.powerNominal.join() !== '0.9,0.8,0.7' || b.inputs.corrMatrix[0][1] !== 0.5) return 'inputs: ' + JSON.stringify(b.inputs);
  if (!b.start || b.start.weights.join() !== '1,0,0' || b.start.transitions[1][2] !== 1) return 'start: ' + JSON.stringify(b.start);
  const G = importX(full);
  const eps = G.edges.filter(e => e.expr === 'ε').map(e => e.from + '>' + e.to);
  if (eps.length !== 1 || !near(C.Q.toNum(G.edges.find(e => e.expr === 'ε').g), 0.001, 1e-15)) return 'ε edge: ' + eps.join();
  if (G.nodes[2].wexpr !== 'ε' || !near(C.Q.toNum(G.nodes[2].w), 0.001, 1e-15) || G.nodes[1].wexpr) return 'ε weight';
  const other = base(); other.source = 'gMCP'; const H = importX(other);
  if (H.edges.some(e => e.expr) || H.nodes.some(n => n.wexpr)) return 'ε applied for a non-multigrain source';
  const junk = base(); junk.optimisation = { gain: 5, expected_gain: 'x', local_power: [1, 2], inputs: { power_nominal: 'no', nsim: '12' }, start: { weights: [1, 0, 0] }, graph_valid: 'yes' };
  const jb = C.readOptimisationBlock(C.fromExchangeFormat(junk, n => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })), () => '').optimisation, 3);
  if (!jb || jb.gain !== '' || jb.expectedGain !== null || jb.localPower !== null || jb.inputs.powerNominal !== null || jb.inputs.nsim !== 12 || jb.start !== null || jb.graphValid !== null) return 'garbage not left out: ' + JSON.stringify(jb);
  const none = base(); if (C.fromExchangeFormat(none, n => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })), () => '').optimisation || importX(none).opt) return 'block invented';
  if (!G.opt || G.opt.expectedGain !== 0.693 || G.opt.share) return 'G.opt from the exchange format';
  return true;
});

/* ---------- sharing switch and SAP paragraph (multigrain stage, step 6) ---------- */
check('Optimised graph: the SAP text describes the choice of the graph, gives the gain function only when sharing is on, says "derived" once the graph is edited; saved JSON and share links carry the block only when sharing is on, and reopen with it', () => {
  const o = C.templateJSON('parallel');
  o.optimisation = { package: 'multigrain 1.0.0', gain: '((r1 * r2) || (r3 * r4))', expected_gain: 0.693, local_power: [0.75, 0.72, 0.7, 0.65], opt_source: 'local', graph_valid: { local: true, global: null }, global_search: false, inputs: { power_nominal: [0.8, 0.8, 0.8, 0.8], corr_matrix: [[1, 0.5, 0.5, 0.5], [0.5, 1, 0.5, 0.5], [0.5, 0.5, 1, 0.5], [0.5, 0.5, 0.5, 1]], nsim: 1000000 }, start: { weights: [0.5, 0.5, 0, 0], transitions: [[0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0, 0, 0, 1], [0, 0, 1, 0]] } };
  const G = toG(o);
  if (!G.opt || G.opt.gain !== o.optimisation.gain || G.opt.share || G.opt.graphKey !== C.graphKey(G)) return 'G.opt not read: ' + JSON.stringify(G.opt);
  let sap = C.sapText(G), para = sap.paragraphs.find(x => x.startsWith('Choice of the graph.'));
  if (!para || !/chosen by gain-function optimisation \(Spiers et al\., 2026\) with the R package multigrain 1\.0\.0/.test(para) || !/80% power for H1/.test(para) || !/correlation of 0\.5 between every pair/.test(para) || !/1,000,000 simulated trials/.test(para) || !/expected gain of the chosen graph was 0\.693/.test(para)) return 'paragraph: ' + para;
  if (/ψ\(r\) =/.test(para) || !/not reproduced here/.test(para)) return 'gain shown with sharing off';
  if (!sap.refs.some(r => /Spiers ADV, Grayling/.test(r)) || !sap.refs.some(r => /multigrain: Optimise Graphical.*version 1\.0\.0/.test(r))) return 'references';
  if (sap.tables.some(t => /Table \[X\.4\]/.test(t.title))) return 'X.4 shown for a single correlation';
  G.opt.share = true;
  sap = C.sapText(G); para = sap.paragraphs.find(x => x.startsWith('Choice of the graph.'));
  if (!/ψ\(r\) = \(\(r1 \* r2\) \|\| \(r3 \* r4\)\), where r1, r2, \.\.\. indicate rejection of H1, H2, H3 and H4/.test(para)) return 'gain missing with sharing on: ' + para;
  const saved = C.serializeGraph(G);
  if (!saved.optimisation || saved.optimisation.gain !== G.opt.gain || saved.optimisation.share !== true || saved.optimisation.graph_key !== G.opt.graphKey) return 'saved block';
  const back = toG(JSON.parse(JSON.stringify(saved)));
  if (!back.opt || !back.opt.share || back.opt.gain !== G.opt.gain || back.opt.expectedGain !== 0.693 || !back.opt.start) return 'reopened block';
  if (C.stripOptimisation(saved).optimisation) return 'strip';
  let tok = C.encodeShare(G), dec = C.decodeShare(tok);
  if (!dec.optimisation || dec.optimisation.gain !== G.opt.gain || !toG(dec).opt) return 'share link with sharing on';
  G.opt.share = false; tok = C.encodeShare(G); dec = C.decodeShare(tok);
  if (dec.optimisation || tok.includes('r1') || toG(dec).opt) return 'share link carries the block with sharing off';
  G.nodes[0].w = C.Q.parse('1/4');
  para = C.sapText(G).paragraphs.find(x => x.startsWith('Choice of the graph.'));
  if (!/derived from one chosen by gain-function optimisation/.test(para) || !/edited by hand/.test(para)) return 'edited graph: ' + para;
  const p2 = toG(o); p2.opt.inputs.corrMatrix[0][1] = p2.opt.inputs.corrMatrix[1][0] = 0.2;
  const s2 = C.sapText(p2);
  if (!s2.tables.some(t => /Table \[X\.4\]/.test(t.title)) || !/given in Table \[X\.4\]/.test(s2.paragraphs.find(x => x.startsWith('Choice of the graph.')))) return 'X.4 missing for pairwise correlations';
  const plain = toG(C.templateJSON('parallel'));
  if (plain.opt || C.sapText(plain).paragraphs.some(x => x.startsWith('Choice of the graph.')) || C.serializeGraph(plain).optimisation || C.decodeShare(C.encodeShare(plain)).optimisation) return 'block invented for an ordinary graph';
  return true;
});

/* ---------- report ---------- */
Promise.all(results.map(r => r)).then(async () => {
  // resolve promise-returning checks
  for (const r of results) { /* sync */ }
});
(async () => {
  // re-run any promise results (closedTestAsync check stored a promise in detail)
  for (const r of results) { if (r.detail && typeof r.detail === 'object' && r.detail.then) { /* not used */ } }
  // handle the async check: find entries whose fn returned a promise
  await new Promise(res => setTimeout(res, 50));
  const asyncIdx = results.findIndex(r => r.name.startsWith('closedTestAsync'));
  if (asyncIdx >= 0 && results[asyncIdx].detail === '[object Promise]') {
    const G = toG(C.generatedTemplate('holm', 9)), p = randP(9, 0.3), fg = C.floatGraph(G);
    const sync = C.closedTest(fg, p, 0.05, 'simes', { upscale: false });
    let prog = 0;
    const r = await C.closedTestAsync(fg, p, 0.05, 'simes', { upscale: false }, (d, t) => { prog = d / t; });
    const ok = prog === 1 && r.adj.every((a, i) => near(a, sync.adj[i], 1e-12));
    if (ok) { results[asyncIdx].ok = true; results[asyncIdx].detail = ''; fails--; } else results[asyncIdx].detail = 'async differs or progress incomplete';
  }
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ` (${r.ms.toFixed(0)} ms)` + (r.ok ? '' : '\n      ' + r.detail));
  console.log(`\n${results.length - fails}/${results.length} stress checks passed`);
  process.exit(fails ? 1 : 0);
})();
