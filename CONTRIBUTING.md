# Contributing to the Multiplicity Graph Sketchpad

These notes are for anyone who wants to send a change to the Sketchpad as a pull request.

## Making a Change

- Edit `src/head.html`, `src/core.js` and `src/ui.js`.
- The page, `index.html`, is built from these three files. Run `python3 src/build.py`, then copy `src/multiplicity-graph-sketchpad.html` to `index.html`.
- Keep to plain HTML, CSS and JavaScript. Do not add a framework or a new build step.

## Pull Requests

- Make one change per pull request. Say in one line why it is needed.
- Before you open the pull request, run the self-tests, `tests/stress.js` and `tests/browser-stress.js`. In the `tests` folder, `npm test` runs all three. The README section "Building and Testing" gives the set-up.
- When you open a pull request, GitHub runs the same checks and shows the result on it. A first-time contributor's checks start once I approve them.
- Please do not change `.github/workflows/` unless we have agreed it first.
- Do not regenerate `tests/plain-off-1.3.0.json` or `tests/views-1.3.0.json`. They are the 1.3.0 records that the browser checks compare with. If a change is meant to alter them, list the planned difference in the check itself, in `tests/browser-stress.js`.

## Changes to Methods

- Give the primary paper, with page and equation numbers.
- Cross-check the numbers against the graphicalMCP R package. The scripts in `R/` show how earlier checks were done.

## Confidentiality

- Do not add company data, trial names, internal codes or unpublished results.

## Review

- I review and merge every pull request myself.
