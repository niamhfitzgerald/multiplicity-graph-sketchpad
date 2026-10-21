# Changelog

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
