# Changelog

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
