# Multiplicity Graph Sketchpad User Guide

Niamh Fitzgerald · version 1.1.2

The Sketchpad draws, tests and explains graphical multiple testing procedures (Bretz et al., 2009) in the browser. Nothing you enter leaves your computer. This guide covers how to use it, not the method.

The Sketchpad opens in simple mode: draw, test, explain and share. Tick **Advanced features** (at the bottom of the side panel, or in the More menu) to add the Matrix and Power tabs, order analysis, adjusted p-values, and the LaTeX, R and SAP exports. The setting is remembered.

## Draw a graph

Start from a template or from an empty canvas. The template picker in the toolbar loads Bonferroni-Holm, fixed sequence, fallback, parallel gatekeeping or the two doses, two endpoints example (simple successive II). On an empty canvas the start panel also lets you choose how many hypotheses the first three templates have.

- **Add a hypothesis:** double-click empty space, or press + Hypothesis.
- **Rename or reweight it:** double-click the top half of the circle to rename, the bottom half to change the weight. Weights can be decimals (0.25) or fractions (1/3); fractions are kept exactly.
- **Connect two hypotheses:** drag the blue dot of one onto the other, or click the dot and then click the target. Type the transition weight and press Enter. Esc cancels.
- **Change a transition:** click its arrow or label, then edit the weight in the Graph panel, or click the label again to edit it on the canvas.
- **Bend an arrow:** drag its weight label, or use the curvature slider in the Graph panel.
- **Remove:** select, then press Delete. Undo and redo with the arrow buttons or Ctrl+Z and Ctrl+Y.
- **Matrix tab:** edit the weight vector and transition matrix as numbers. It stays in step with the canvas.
- **Description and group:** each hypothesis has optional fields such as "dose 1, primary endpoint" and "primary". They feed the plain-language text, the SAP text and the group bands on the canvas.

Alpha is set in the toolbar (default 0.025). Next to it, say whether your p-values are one-sided or two-sided; the SAP text repeats the choice, and the parametric test accepts one-sided p-values only.

### Variables and ε edges (advanced)

Type a letter in any weight, such as `ε`, `1-ε` or `(1-γ)/2` (eps, gamma, delta, nu, tau and omega are recognised), and it becomes a variable. The Variables section of the Graph tab lists them with their values; ε defaults to 1/1000. Tests and exports use the values, the canvas and TikZ show the symbols. "Replace variables with their values" makes the numbers permanent.

### More templates, join and extract

The template list has a "More from gMCP" group: improved parallel gatekeeping (ε edges), simple successive I, general successive (γ, δ), Bretz, Maurer and Hommel (2011) with three doses and two endpoints, truncated Holm (γ), improved fallback I and II, and the cycle graph (its size follows the counter on the start panel). Under "Join or extract" in the Graph tab you can add a template below the current graph (weights are rescaled if they then exceed 1) or keep only the ticked hypotheses. Any other gMCP graph can be brought in with `sketchpad_json()` from `R/multigrain-to-sketchpad.R`, which also accepts graphMCP objects.

## Fix and tidy

The bar under the canvas checks the graph as you edit. Red messages are errors (weights outside 0 to 1, a total above 1, a non-zero diagonal, a row of transitions above 1) and block testing. Amber messages are warnings (weights or rows below 1) and do not. Most messages have a one-click fix, such as "Rescale so they sum to 1".

- **Arrange (top right of the canvas):** snap every hypothesis into a circle, two rows, a line, a grid, a column, or the order of testing. Choose the spacing and whether to straighten bent arrows. Undo puts them back.
- **Colour:** select a hypothesis and pick a swatch or any colour. "Use this colour for every hypothesis" applies it to the whole graph.
- **Groups:** hypotheses with the same group are drawn inside a shaded band with the group name, on the canvas and in the picture exports.
- **More menu:** hints on the canvas, snap to grid, decimals instead of fractions, the colour theme, import, the self-test, Clear graph, and About (version, how to cite, licence, limitations and references; the version number in the footer opens it too).

## Test the graph

Open the Test tab and enter a p-value for each hypothesis (or paste them all at once as `c(0.004, 0.009, 0.011, 0.03)`).

- **Run test** carries out the whole procedure and shows which hypotheses were rejected.
- **Step through it** switches to Test mode without rejecting anything. Hypotheses outlined in green can be rejected now: click one on the canvas, or press Reject in the table, in any order you like. Step rejects the one with the smallest p-value relative to its level.
- **Each node shows** its current level (weight × alpha), its p-value and whether it can be rejected. The weight moves along the arrows as it is passed on.
- **Step back, Redo and Reset** move through the steps (also Ctrl+Z and Ctrl+Y in Test mode). The step log lists each rejection, its level, where the weight went and the new weights.
- **Does the order matter?** This section counts every possible order with the current p-values and lists the orders you have tried, all with the same final result. "Try another order" starts again.
- **What if (no p-values):** reject any hypothesis by clicking it, to show where its alpha goes.
- **Adjusted p-values** appear under the table once every hypothesis has a p-value.
- **Matrix tab** in Test mode shows the weights and transition matrix after each step; switch to the initial graph with the buttons at the top.

Changing a p-value, a weight or alpha restarts the test. Back to Design returns to editing.

### Test type (advanced)

The default is the weighted Bonferroni test, which is the one that can be stepped through. Under **Test type** in the Test tab you can switch to the weighted Simes test, Simes within groups (Simes when every hypothesis of an intersection is in the same group, Bonferroni otherwise), or the parametric test for correlated test statistics. These run as a closed test: Run test gives the rejected set, adjusted p-values and, under advanced features, a table of every intersection hypothesis. For the parametric test, enter the known correlations in the matrix and leave unknown pairs blank; known pairs must form complete blocks. Its adjusted p-values come with a Monte Carlo standard error, shown above the table. The upscale box matches gMCP's `upscale = TRUE`. The Power tab uses whichever test is selected, and the R exports write the matching gMCP and graphicalMCP calls.

## Explain it to a team

- **Plain language:** tick the box at the top of the Test tab. The graph and each step are described in everyday words ("H1 starts with 1.25%. When it succeeds, it hands half of its share to H2..."), with no mention of weights, transition matrices or the familywise error rate. Fill in each hypothesis's description so the text names the endpoints.
- **What would it take?** For every hypothesis still open, this section in the Test tab gives its level now, the highest level it could reach, and the smallest sets of other rejections that would let it be rejected with its p-value. Press Show to outline that set on the canvas. It answers the question of how a hypothesis with a tiny p-value can still need another result first.
- **Present:** the button next to Fit hides the panels and enlarges the graph. Press the right arrow or Next to reject the next hypothesis, the left arrow to go back, R to reset and Esc to leave. The caption at the bottom narrates each step, in plain language if that box is ticked.

## Power by simulation

The Power tab estimates how often the graph rejects each hypothesis. Enter the power each test would have on its own at the full alpha, and the correlation between the test statistics (one value for every pair, or pair by pair). Define a success rule if you want one, such as "any of H1, H2". Run simulation gives the power for each hypothesis, the chance of at least one and of all rejections, and the expected number rejected. "Keep for comparison" stores a run so you can compare designs side by side. The matching graphicalMCP code is underneath. If you change the graph, the test or any simulation setting after a run, a notice asks you to run again.

## Compare two graphs

The Compare tab puts the graph on the canvas (A) next to a second graph (B) and shows what differs.

- **Keep a copy:** type a name and press "Keep a copy of A". Kept graphs are listed with Load as A (which puts the copy on the canvas; undo brings the previous graph back) and Remove. They are remembered in this browser.
- **Choose B:** a kept graph, any template, or a pasted share link, share code or saved file. The usual workflow is to keep a copy, change the graph, then compare the two.
- **Pictures and structure:** both graphs are drawn side by side. "Weights and transitions" lists each hypothesis's weight in A and B and every transition that differs, and says whether each graph is alpha-exhaustive. Hypotheses are matched by label; switch to "by position" when the labels differ but the order is the same.
- **Same p-values:** with p-values entered in the Test tab, "Test both" runs the test chosen in the Test tab on both graphs and shows the adjusted p-values and rejections side by side.
- **Power on the same trials:** "Simulate both" runs the Power tab's settings on both graphs using the same simulated trials, so the difference B − A comes with a small standard error; differences larger than twice their standard error are highlighted. Copy table gives the numbers as text.

When the graph or a setting changes after a comparison, a notice asks you to run it again.

## Import

- **R code or plain numbers:** More menu, "Import from R or a matrix". Paste a weight vector such as `c(1/2, 1/2, 0, 0)` and a matrix such as `matrix(c(...), nrow = 4, byrow = TRUE)`, or plain numbers with one matrix row per line. Names are optional.
- **From multigrain:** in R, run `source("multigrain-to-sketchpad.R")` and then `sketchpad_json(g, names = ..., labels = ..., groups = ..., file = "graph.json")`, where `g` is a `graph_optimise()` result. Open the file in the Sketchpad under Export, "Open a saved graph". Labels become descriptions and groups get matching colours.
- **Saved files and share links:** the same "Open a saved graph" box takes a JSON file saved by the Sketchpad, a share link, or a share code.

## Export

All exports are in the Export tab. Pictures and TikZ show the graph as it is on the canvas, including any test progress; the R code describes the initial graph.

- **Picture:** PNG at twice screen resolution, or SVG under More formats. Both have a white background and include group bands and colours.
- **LaTeX (TikZ):** the same positions and curves as the canvas, with the `\usetikzlibrary` line it needs in a comment at the top.
- **Beamer, step by step:** one frame with one overlay per rejection, following the steps you took in Test mode (or the automatic run on the p-values). Each overlay shows the levels and a caption. It works with the Metropolis theme.
- **R:** `graph_create()` for graphicalMCP, with `graph_test_shortcut()` when every p-value is entered; `matrix2graph()` for gMCP.
- **SAP / protocol text:** paragraphs describing the hypotheses, the initial allocation, how alpha is passed on and strong control of the familywise error rate, plus tables of the weights and transition matrix. Copy tables pastes into Word as a table.
- **Share link:** the whole graph is encoded in the link, so nothing is uploaded.
- **Save as a file:** JSON that keeps weights, positions, colours, p-values and alpha.

Every export can be downloaded or copied.

## Keyboard shortcuts

| Key | Design mode | Test mode |
| --- | --- | --- |
| Delete or Backspace | Remove the selected hypothesis or arrow |  |
| Ctrl+Z, Ctrl+Y | Undo, redo | Step back, redo step |
| Esc | Cancel a connection, deselect, close a menu | Leave presentation mode |
| Tab, then arrow keys | Move between hypotheses and nudge the focused one (Shift for small steps) | Move between hypotheses |
| Enter or Space | Select the focused hypothesis | Reject it, if it can be rejected |
| Right arrow, Space |  | Next rejection (presentation mode) |
| Left arrow |  | Step back (presentation mode) |
| R |  | Reset (presentation mode) |
| ? | Help | Help |
| Scroll, drag empty space | Zoom, pan | Zoom, pan |

On a Mac, use Cmd in place of Ctrl.
