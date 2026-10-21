# Changelog

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
