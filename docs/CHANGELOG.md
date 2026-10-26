# Changelog

## 1.2.0 (2026-10-26)

Entangled graphs (Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753), gMCP parity stage 3, from `plans/entangled-plan-2026-10-22.md`.

- Model and engine: an entangled graph is n component graphs on the same hypotheses with component weights c (sum at most 1). Each hypothesis is tested at α Σ c_h w_hi and a rejection updates every component (Algorithm 1, p. 1743); closed tests use the intersection weights Σ c_h w_hi(J) (Algorithm 2, p. 1745), so Simes, Simes within groups and the parametric test run as full closures on an entangled graph (p. 1746), as do adjusted p-values, order analysis, What would it take and the power simulation. Validation per component, c between 0 and 1 with sum at most 1; alpha-exhaustive when the sum is 1 and every component with positive c is exhaustive (p. 1745); components with one transition matrix reduce to a single graph (Appendix A, p. 1752).
- Canvas: a component bar (Graph 1, Graph 2, ..., All) above the canvas. One component is edited at a time; names, positions, colours, groups and p-values are shared. The All view overlays every component with one line style each and the vector of weights at each hypothesis (Fig. 3, p. 1747; Xi and Bretz, 2019, Fig. 5), read only. Advanced features: add and remove components, edit c (symbolic allowed), keep one component as an ordinary graph, reduce to one graph, make any graph entangled. Join and extract are off for entangled graphs.
- Test mode opens on the All view; the step log gives what each open hypothesis receives from each component; the flow animation runs per component; rejected hypotheses keep their weight vector; Design returns to the component being edited.
- Matrix tab: a c row and the weights and transitions of every component, all editable. Import of gMCP code with `new("entangledMCP", subgraphs = list(...), weights = c(...))`.
- Templates, picker group "Entangled graphs": Fig. 2 (two doses with memory; gMCP `Entangled1Maurer2012`), Fig. 4(b) (the same as two chains; `Entangled2Maurer2012`), Fig. 5 (recycling between the doses, γ1 and γ2, p. 1749), parallel gatekeeping with truncated Holm (Xi and Bretz, 2019, section 5.1 and Fig. 5). Advanced: truncated Holm for any m (section 5.3.1, p. 1750; Dmitrienko, Tamhane and Wiens, 2008) and at least k of m primaries (section 5.3.2 and Fig. 6, p. 1751; Guilbaud, 2018, Example 11 and Fig. 5(b) for 2 of 3), one component per set of k primaries.
- Default graph (Matrix tab, advanced): any graph of up to 6 hypotheses as fixed sequences with weights (Burman, Sonesson and Guilbaud, 2009), by the decomposition of Appendix A, pp. 1752-1753, drawn as in Fig. 4(a), p. 1748. A box hides sequences with weight below 1/100, which gives the ε-free picture for graphs with ε edges. Copy as text; make the equivalent entangled graph of chains. Import box for sequences typed as `H1 > H3 > H4 > H2 > H5 : 1/2`.
- Exports: JSON version 2 (top-level graph is component 1, so older versions open that graph; `ent` holds everything); share links carry the components. gMCP code builds the components with `matrix2graph()`, joins them as an `entangledMCP`, prints `generateWeights()` beside the Sketchpad's intersection weight table and tests with `gMCP()` (Bonferroni; gMCP rejects at p < level, the Sketchpad at p ≤ level; gMCP has no Simes or parametric test for entangled graphs, noted in the code). graphicalMCP has no entangled graph object: the code builds each component, gives the weight table and a Bonferroni closed test by hand in base R. The Power tab's R code uses gMCP's `calcPower()` with `getWeights()`, `getMatrices()` and `alpha * graph@weights`. SVG, PNG, TikZ and beamer draw the All view with the line styles and a key; beamer captions give the per-component hand-ons. SAP text: procedure, allocation and propagation per component with the combined rule, Table X.1 with a weight column per component, one transition table per component, Maurer and Bretz (2013) in the references.
- Compare tab: entangled graphs are drawn in the All view; weights compared are the combined weights with each component's weight in brackets; transitions are compared component by component, an ordinary graph counting as Graph 1; the entangled templates can be chosen as B.
- About: entangled graphs taken out of "Not covered"; a check note on gMCP's strict inequality and the closed tests; references for Xi and Bretz (2019) and Burman, Sonesson and Guilbaud (2009).
- Self-test: 16 new checks, 102 in all: the Fig. 2 matrix (p. 1746); the plan's self-tests B to H (Fig. 3 sequence and levels; the Fig. 1(a) contrast; Fig. 4(b); Fig. 5 at γ = 1/2 and at γ = 1; at least 3 of 4 (Fig. 6); Holm as six sequences and the Appendix A reduction; Guilbaud's 2 of 3; Xi and Bretz section 5.1 closed Simes with the intersection weights); gMCP code import; JSON and link round trip; validation and exhaustiveness (Fig. 2 with ε = 1/1000 is not exactly exhaustive: the ε share reaching a leaf is lost); 200 random entangled graphs (float shortcut = exact step-through = closed Bonferroni = adjusted p, order-independent); templates (Fig. 5 against self-test D, truncated Holm levels α/3, (γ/2 + (1 − γ)/3)α, (γ + (1 − γ)/3)α); component switching with hidden symbolic ε; the default graph (Holm m! sequences at 1/m!, the four hierarchies of p. 1749, Fig. 4(a) from Fig. 2, 100 random graphs reproduce the Algorithm 2 weights from the sequences and from the entangled graph of chains, text import round trip).
- Engine stress suite: 34 checks. Browser suite: 34 checks (four new steps: design and test mode, exports, Compare, default graph; the self-test count check now reads "N of N" with N at least 86).
- `R/validate-entangled-1.2.0.R`: seven cases (self-tests B, C, D, E, G and the truncated Holm levels) with the gMCP `entangledMCP` test and `generateWeights()` comparison on a machine with Java, and a base-R Bonferroni closed test on the exported weight tables that runs anywhere. The base-R part was run: all seven agree with the self-tests.

## 1.1.7 (2026-10-26)

Four new templates (part 5 of the plan that followed the methods check of 22 October).

- Weighted Holm for any number of hypotheses (Bretz et al., 2009, p. 594). A start panel card and a template picker entry ("Weighted Holm for any m") ask for the initial weights, which must add up to 1 (at least two positive), and build the transitions w_j/(1 − w_i) as exact fractions. A zero weight is allowed. The weights box on the start panel and in the Graph tab now serves both this and improved fallback I. The note says that gMCP's `BonferroniHolm(n, weights)` and graphicalMCP's `bonferroni_holm_weighted()` keep equal transitions 1/(m − 1), a different graph, so the R exports write the matrix in full.
- Two doses, three ordered endpoints: Bretz et al. (2009) Fig. 14 left ("each dose in sequence") and right ("shared between doses"), in the main picker group. The same graphs are Figs. 4 and 5 of Minini, Paux and Dmitrienko (2026). Drawn as a six-node cycle so that no transitions cross.
- Efficacy and safety for three treatments (Bretz et al., 2009, Fig. 8), with efficacy and safety bands. Advanced features only.
- Hung and Wang (2010) Fig. 1: non-inferiority then superiority on two endpoints, with variables ν, τ and ω (default 1/2) and a note on the τ = ω = 1 choice (p. 754). Advanced features only. Checked against the figure: gMCP's `HungEtWang2010` puts its tau on the H1,S → H2,NI edge, the other way round, so the note gives the mapping `HungEtWang2010(nu = ν, tau = 1 − τ, omega = ω)`.
- The picker group "More from gMCP" is now "More templates". Entries for advanced features only are taken out of the picker in simple mode and put back in advanced mode.
- About: references added for Hung and Wang (2010), Guilbaud and Karlsson (2011), Li and Zhou (2021) and Minini, Paux and Dmitrienko (2026).
- Self-test: four structural checks with exact weights and transitions, exhaustiveness, validation and worked p-values (Dmitrienko, Wiens and Westfall, 2006, Table 1, and Guilbaud, 2018, Example 6, on the weighted Holm generator; the two p. 754 statements of Hung and Wang; the Li and Zhou, 2021, Fig. 7 scenarios on the Fig. 14 templates; the Fig. 8 run from the methods check). 86 checks in all.
- Engine stress suite: 34 checks (the weighted Holm generator and the three fixed templates are in the template and exhaustiveness loops). Browser suite: 30 checks (new step for advanced-only picker entries).
- `R/validate-templates-1.1.7.R`: graphicalMCP runs of the four templates' self-test p-values, to be run on a machine with graphicalMCP.

## 1.1.6 (2026-10-23)

Follows a methods check of the app against 61 papers (22 October 2026): no engine fault was found in 232 checks. The changes are wording, one new template entry, help text and self-tests.

- Improved fallback I for any number of hypotheses. A start panel card and a template picker entry ("Improved fallback I for any m") ask for the initial weights, and the last hypothesis's return transitions are worked out from them (w_i / (w_1 + ... + w_(m-1)), Wiens and Dmitrienko, 2005, section 3.2; the same rule as graphicalMCP's fallback_improved_1). Weights can be typed as fractions, decimals or `c(...)` from R. The three-hypothesis template in the "More from gMCP" group keeps return transitions of 1/2 and 1/2 whatever the weights, like gMCP; its note now says so. The start card pictures draw return arrows as arcs.
- Reference and attribution fixes in the About panel and template notes: the two Maurer and Bretz (2013) papers (entangled graphs, Statistics in Medicine; group sequential designs, Statistics in Biopharmaceutical Research) are cited by journal and both listed; Benjamini and Heller (2007) credited with the one-sided normal example only, and Kling (2005) with the PRDS result, as Bretz et al. (2011) cite them; γ₁ and γ₂ named as the symbols of Maurer, Glimm and Bretz (2011) and Bretz, Maurer and Hommel (2011) in the successive template notes; new entries for Brannath et al. (2009), Huque, Dmitrienko and D'Agostino (2013), Strassburger and Bretz (2008), Guilbaud (2008, 2018), Klinglmueller, Posch and Koenig (2014) and the EMA (2017) draft guideline; the "Not covered" note names the papers for each gap.
- Help text added. Power tab and parametric Test tab: what correlation to enter (two doses against one control, full population and subgroup, two endpoints on the same patients, tetrachoric for binary endpoints; Bretz et al., 2011; Li, Deng and Ting, 2023; Zhao, Dmitrienko and Tamura, 2010; Westfall et al., 2008). Fixed sequence notes: the order is the whole design, and Holm is often safer with poor effect estimates (Zhang, Wang and Troendle, 2015; Paux and Dmitrienko, 2018). Power tab: the mean of each z statistic is Φ⁻¹(1 − α) + Φ⁻¹(power) with the trial's one-sided α (Xi and Chen, 2024, eq. 2). Test tab, Bonferroni test: a hypothesis is rejected when its p-value is at or below its level (Bretz et al., 2009, Algorithm 1). Parallel gatekeeping note: published "Bonferroni gatekeeping" comparisons often use the ε-improved version (Bretz et al., 2009, Fig. 12).
- SAP text: the "Interim analyses" placeholder now says that group sequential boundaries come from the spending function at the local level, not by scaling (Maurer and Bretz, 2013, SBR, section 4), and that a secondary hypothesis is not tested at the full α once its primary is rejected at an interim (Glimm, Maurer and Bretz, 2010; Maurer, Glimm and Bretz, 2011, section 3.1). The three papers are in the SAP reference list.
- Power tab and Compare tab: when a correlation entered as 1 is set to 0.999999 so that the simulation can run, the result text says how many pairs were changed.
- Self-test: 25 more worked examples checked against their sources with page numbers (82 checks in all): improved fallback I for any m (Wiens and Dmitrienko, 2005, Table 1; Guilbaud, 2018, Example 6); Bonferroni step-through and templates (Ding, Li and Wu, 2025; Dmitrienko, Wiens and Westfall, 2006, Table 1; Guilbaud, 2018, Examples 4 and 5 and section 4.3.4; Li and Zhou, 2021, Fig. 7 on Bretz et al., 2009, Fig. 14; Maurer, Glimm and Bretz, 2011, sections 4.2 and 4.3; Maurer and Bretz, 2013, both papers; Wiens and Dmitrienko, 2005, section 4; Wolf and Zhou, 2021, Example 2; Wiens, Dmitrienko and Marchenko, 2013, weighted Holm rule; Guilbaud and Karlsson, 2011, Example 2); closed tests (Lu, 2016, with a case that separates the Simes-within-groups rule from the eq. 8 mixture; Kundu et al., 2026, Tables 2 and 3; Hommel, 1988; Meijer, Krebs and Goeman, 2019; Tamhane and Gou, 2018, section 5.3; Xi and Bretz, 2019, Figs. 6A and 6B); parametric (Millen and Dmitrienko, 2011, pp. 21-22; Zhao, Dmitrienko and Tamura, 2010, Fig. 1; Slepian, 1962, orthant probabilities); power (Bretz, Maurer and Hommel, 2011, Table I, three of its 14 cases, the rest in the code; Xi and Chen, 2024, Tables 1 and C2; Zhan et al., 2022, Table 3).
- Engine stress suite: 34 checks (the template and generator checks cover improved fallback I for any m). Browser suite: 29 checks (a new step for the weights box; the Power step checks the capped-correlation text).

## 1.1.5 (2026-10-21)

- Self-test: ten more worked examples, each checked against its source with page numbers. Bretz et al. (2009) Figs. 9 and 10 (ε edges). Bretz et al. (2011): Example 1 and Table 1, Fig. 3, the section 3.3 Simes example, the parametric constant c = 1.0783 and the truncated Holm example in section 4.1. Bretz, Maurer and Hommel (2011): the final levels and edges in section 3.3. The gMCP parametric vignette and the graphicalMCP closure vignette. 57 checks in all.
- Correlations: when some correlations cannot all hold at once (the matrix is not positive definite), a red message names the hypotheses involved. In the Test tab this replaces the error that appeared only on Run test; in the Power tab it appears as soon as you leave the box.
- Test tab: with a Simes test, a warning when a negative correlation is entered in the Power tab or the Test tab. For Simes within groups, only pairs in the same group count.
- Phone: Fit places the graph below the hint box, so the hint no longer covers the top of the graph. The view refits when the window changes width, unless you have zoomed or moved it.
- Engine stress suite: one new check (correlation conflicts, 34 checks). Browser suite: one new step (correlation checks and the Simes warning, 28 checks); the phone step also checks the hint box and the resize rule.

## 1.1.4 (2026-10-21)

- SAP / protocol text rewritten after a review against the primary papers, the FDA guidance on multiple endpoints (2022) and published SAPs.
  - Corrected citations: the weighted Simes test's validity (Benjamini and Heller, 2007; Benjamini and Yekutieli, 2001; Bretz et al., 2011, section 3.3) in place of Sarkar (1998); the "Simes within groups" rule credited to gMCP and contrasted with Bretz et al. (2011, eq. 8); the parametric test credited to Xi et al. (2017, eq. 6) only, with its difference from the common constant of Bretz et al. (2011, eq. 3); upscaling credited to gMCP (Simes) and Xi et al. (2017, section 4.2) (parametric).
  - The propagation sentences now say they describe the initial graph, and that later proportions change.
  - New parts: numeric initial levels, gatekeeping wording for weight-0 hypotheses, conclusions, interim analyses, reporting, a flag for graphs that are not alpha-exhaustive, the meaning of ε edges, a direction rule for two-sided p-values, a correlation table for the parametric test, technical details for closed tests, and a separate reference list.
  - Facts the graph cannot hold are left as [square-bracket placeholders]; tables and the figure are numbered [X.1], [X.2], [X.3] and [X].
- gMCP R export (parametric test): a note that gMCP uses one constant for all blocks, while the Sketchpad and graphicalMCP use one per block.
- The same citation corrections in the Test-tab help (Simes, parametric, upscale) and the help and About panels. About reference notes corrected: Bretz et al. (2011) no longer credited with the Simes within groups rule used here; Hommel and Bretz (2008) no longer credited with improved fallback II (that graph is Bretz et al., 2009, Fig. 11).
- About: new notes on the free combination condition and restricted hypotheses, on two-sided p-values in closed tests, on closed tests with graphs that are not alpha-exhaustive, and on the regulatory context (FDA 2022, EMA 2002). Seven references added.
- Test tab: a warning line when a closed test (Simes, Simes within groups or parametric) is used on a graph that is not alpha-exhaustive. A hypothesis can then be rejected while the hypotheses that pass alpha to it are not. The line also says when upscaling changes the procedure.
- Test tab: a warning line when a closed test is used with two-sided p-values. It controls the two-sided error rate, not a one-sided rate of alpha/2 for claims of benefit.
- CITATION.cff: affiliation now "Newcastle University and GSK", matching the About panel.
- Firefox: a mouse-wheel notch now zooms about as much as in Chrome and Safari (Firefox reports the wheel in lines, not pixels).
- iPhone and other touch screens: text boxes use 16px text, so Safari no longer zooms the page in when one is tapped.
- Self-test: 47 checks (one new SAP check). Engine stress suite: one new SAP check over random graphs. Browser suite (27 checks): the zoom step also checks a Firefox-style wheel notch, and a new step checks the two Test-tab warnings.

## 1.1.3 (2026-10-21)

- The author's name at the top of the page links to her LinkedIn profile (opens in a new tab); the About panel links to it too.
- The author's ORCID iD is shown in the About panel and listed in CITATION.cff.

## 1.1.2 (2026-10-21)

- Author's name shown under the title at the top of the page, at every screen width.

## 1.1.1 (2026-10-16)

- Author shown in the footer and the About panel.
- About panel and citation link to the GitHub repository.
- Example weights in the exchange-format help changed to 0.5.
- Tested in the Safari engine (WebKit): all automated checks pass; simulation and parametric results identical to the Chrome engine.

## 1.1.0 (2026-10-14)

- Compare tab: keep copies of the graph on the canvas; compare it with a kept graph, a template or a pasted graph. Shows both pictures, the weights and transitions that differ, whether each is alpha-exhaustive, the test result on the same p-values, and the power on the same simulated trials (common random numbers) with the difference and its paired standard error. Hypotheses matched by label or by position.

## 1.0.0 (2026-10-14)

First public version. Internal builds 1 to 14 preceded it.

- Literature audit against the primary papers; corrected template attributions and edges (improved fallback I and II), SAP text for closed tests, the "Simes within groups" description and the parametric R export; the parametric intersection test now follows Xi, Glimm, Maurer and Bretz (2017), equation 7, with the Monte Carlo standard error shown.
- One-sided / two-sided p-value setting; alpha-exhaustiveness checked through the closure.
- Stress test: engine (32 checks) and browser (25 checks) suites; eight bugs fixed, including p = 0 with weight 0, parametric p-values outside their exact bounds, spaces inside weights, damaged share codes, missing messages in Design mode, the stale notice for power results.
- Fonts embedded; no network requests. About panel with version, citation, licence, limitations and references.
