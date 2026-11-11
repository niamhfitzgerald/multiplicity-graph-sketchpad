# Multiplicity Graph Sketchpad

A single-page browser tool for drawing, testing and documenting graphical multiple comparison procedures (Bretz, Maurer, Brannath and Posch, 2009) and their closed-test extensions with weighted Simes and parametric tests (Bretz et al., 2011; Xi et al., 2017).

Everything runs in the browser. Nothing you enter is sent anywhere; the page makes no network requests at all (the fonts are embedded).

**Use it online:** https://niamhfitzgerald.github.io/multiplicity-graph-sketchpad/

Or download `index.html` and open it in any modern browser. It works offline.

Created by Niamh Fitzgerald.

## What It Does

- Draw a graph on a canvas (double-click to add a hypothesis, drag the blue dot to connect two), or build it from a matrix, R code (`c()`, `matrix()`, `rbind()`) or a template. The templates are Bonferroni-Holm, fixed sequence, fallback, parallel gatekeeping, improved parallel gatekeeping, successive procedures, weighted Holm, improved fallback I and II, cycle and truncated Holm, and published examples. The published examples are two doses with two or three endpoints, three doses with two endpoints, efficacy and safety for three treatments, and non-inferiority then superiority (Hung and Wang, 2010).
- Live validation with one-click fixes. Symbolic weights such as ε, γ and δ. Groups, colours and descriptions.
- Test with p-values. Step through the Bonferroni procedure one rejection at a time, in any order, with the weight moving along the arrows. See what it would take to reject a hypothesis. Run closed tests with weighted Simes, Simes within groups, or parametric tests with known correlations. See the adjusted p-values.
- Power by simulation, with runs kept for comparison and the matching graphicalMCP code.
- Compare two graphs: keep a copy, change it, and see both pictures, the weights and transitions that differ, the test result on the same p-values, and the power on the same simulated trials with the difference and its standard error.
- Entangled graphs (Maurer and Bretz, 2013): several component graphs on the same hypotheses with weights c, edited one at a time and overlaid in an All view. Templates for the paper's Figs. 2, 4(b) and 5, parallel gatekeeping with truncated Holm (Xi and Bretz, 2019), truncated Holm for any m and at least k of m. A default-graph view of any graph as fixed sequences with weights (Burman, Sonesson and Guilbaud, 2009).
- Optimise with multigrain (Spiers et al., 2026): a gain function window (quick rules, elicitation from scores, or typed), locks for fixed parts and a complete R script for the package. An import of the result, with a fresh estimate of the expected gain.
- Export a PNG, SVG, TikZ, beamer step-by-step frames, R code for graphicalMCP and gMCP, SAP or protocol text with tables, a JSON file or a share link.
- Plain-language mode for discussing a design with clinicians, and a presentation mode.

## Repository Layout

| Path | Contents |
| --- | --- |
| `index.html` | The built page. This is the only file a user needs. |
| `src/head.html` | Markup and CSS (fonts embedded). |
| `src/core.js` | Engine: exact rational arithmetic, graph update, closed tests, parsers, exporters, self-tests. No DOM access. |
| `src/ui.js` | Canvas, panels, events. |
| `src/build.py` | Joins the three sources into `src/multiplicity-graph-sketchpad.html`. Copy that file to `index.html` after building. |
| `tests/runtests.js` | Runs the 131 built-in self-tests in Node. |
| `tests/stress.js` | Engine stress test: random graphs, all test types, independent reference implementations, empirical familywise error. A few minutes. |
| `tests/browser-stress.js` | Playwright test that drives every control of the built page. |
| `tests/plain-capture.js`, `tests/make-plain-snapshot.js`, `tests/plain-off-1.3.0.json` | Plain-language checks for the browser test, in the Test tab, the Graph tab, the status line, the drawing and the toolbar. They hold the 1.3.0 text (with Advanced features on) that the page must show with Plain language off, and the words that must not appear with it on. |
| `tests/view-capture.js`, `tests/make-views-snapshot.js`, `tests/views-1.3.0.json` | Clinician-view checks: the tabs, templates, menu items, sections and buttons that 1.3.0 showed with Advanced features off and on. With Plain language on the page must show the first; off, the second. |
| `tests/multigrain-constraints-check.R`, `tests/multigrain-dry-run.R` | Checks of the Optimise tab against multigrain's own validation code; run by the stress test when R and multigrain (or `MULTIGRAIN_R`, a clone of the package source) are available. |
| `R/` | Validation scripts against graphicalMCP and gMCP, and `sketchpad_json()` for writing the app's exchange format from a multigrain result. |
| `docs/` | User guide, change log and `preview.png` (the picture shown when the link is shared). |
| `.github/workflows/checks.yml` | The checks GitHub runs on every pull request and every change to `main`. |

## Building and Testing

```sh
python3 src/build.py
cp src/multiplicity-graph-sketchpad.html index.html

cd tests
npm install                      # installs Playwright
npx playwright install chromium  # once
npm test                         # self-tests, engine stress test, browser test
```

`browser-stress.js` uses the Playwright-managed Chromium; set `SKETCHPAD_CHROME` to use another Chromium build.

Three checks in `stress.js` call R. Two of them check the Optimise tab against multigrain. With multigrain installed they use the package. Otherwise set `MULTIGRAIN_R` to the `R/` folder of a clone of https://github.com/cran/multigrain (they also need the cli, rlang, vctrs, purrr, glue and jsonlite packages). The third runs the graphicalMCP export of entangled graphs in R and needs graphicalMCP. Without R or the package it needs, each of the three passes with a note. The two multigrain scripts can also be run on their own:

```sh
Rscript tests/multigrain-constraints-check.R cases.json      # cases.json: [{"hyp": [...], "trans": [[...]]}, ...], null = free
Rscript tests/multigrain-dry-run.R optimise-graph.R          # a script written by the Optimise tab
```

GitHub runs these checks on every pull request and every change to `main`. There the three R checks run for real, with graphicalMCP and multigrain from CRAN, and so do the scripts in `R/` that need no Java. The results show on the pull request and in the Actions tab.

To send a change as a pull request, see `CONTRIBUTING.md`.

## Releasing a New Version

To release a new version: change `APP_VERSION` and `APP_DATE` in `src/core.js`, rebuild, run the tests, update `CITATION.cff` and `docs/CHANGELOG.md`, commit and tag.

## Validation

The built-in self-test (More menu, or the "Self-test" button in the footer) runs 131 checks. These include worked examples from Bretz et al. (2009, 2011), Bretz, Maurer and Hommel (2011), Wiens and Dmitrienko (2005), Hommel, Bretz and Maurer (2007), Hommel and Bretz (2008), Genz and Bretz (2009), and the gMCP and graphicalMCP vignettes. They also include more than 30 further papers checked in October 2026 (listed in `docs/CHANGELOG.md`). Results have been cross-checked against the graphicalMCP R package for Bonferroni, Simes and parametric tests (scripts in `R/`). The stress tests check the engine against independent implementations and the empirical familywise error rate under the global null.

## Limitations

- Closed tests (Simes and parametric) are available for up to 12 hypotheses; the Bonferroni procedure has no such limit.
- Parametric adjusted p-values are exact for blocks of two to four correlated hypotheses. For blocks of five or more they are Monte Carlo estimates, and the standard error is shown. Confirm them in R before relying on them in a submission.
- The Simes options need positively dependent one-sided statistics; the parametric option needs one-sided p-values.
- Entangled graphs: gMCP tests them with Bonferroni only; the Simes and parametric closed tests on an entangled graph follow Maurer and Bretz (2013, p. 1746) and are checked by hand from the exported intersection weights.
- Not covered: trimmed Simes tests, group sequential and adaptive designs, simultaneous confidence intervals, sample size.

## Citation

Fitzgerald N (2026). Multiplicity Graph Sketchpad, version 1.4.10. Newcastle University and GSK. https://github.com/niamhfitzgerald/multiplicity-graph-sketchpad. See `CITATION.cff`.

## Licence

MIT (see `LICENSE`). The embedded fonts Atkinson Hyperlegible and JetBrains Mono are under the SIL Open Font License 1.1.
