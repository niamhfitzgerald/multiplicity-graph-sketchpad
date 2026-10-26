# validate-entangled-1.2.0.R: entangled graphs (Maurer and Bretz, 2013, Statistics in Medicine 32:1739-1753)
# Written by Multiplicity Graph Sketchpad 1.2.0 from its gMCP and graphicalMCP exports.
#
# Two checks per case:
#   1. gMCP (needs Java): gMCP(entangledMCP, pvalues, alpha), Bonferroni, and generateWeights() against the
#      Sketchpad's intersection weight table (Algorithm 2, p. 1745). Skipped when gMCP is not installed.
#   2. Base R only: a Bonferroni closed test by hand on the Sketchpad's weight table, which equals the
#      step-by-step procedure (p. 1745). Runs on any machine with R.
# Each case prints the rejections next to the expected ones from the Sketchpad self-tests.
# Note: gMCP rejects when p < level (strict), the Sketchpad when p <= level; none of these cases has a tie.
# ε = 1/1000 and γ1 = γ2 = γ = 1/2 as in the Sketchpad.

have_gmcp <- requireNamespace("gMCP", quietly = TRUE)
if (have_gmcp) suppressMessages(library(gMCP))
show <- function(label, got, expected) cat(sprintf("%-14s %s   (expected %s)\n", label, paste(got, collapse = " "), expected))


## ---- Case 1. Self-test B: Maurer and Bretz (2013) Fig. 2, section 3.1 p-values (p. 1742), alpha 0.025. Expected: reject all five (H1, H3, H4, H2, H5 in that order; Fig. 3, p. 1747). ----
cat("\nCase 1: Self-test B: Maurer and Bretz (2013) Fig. 2, section 3.1 p-values (p. 1742), alpha 0.025.\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 2 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with ε = 1/1000
  
  # Graph 1 (c = 1/2)
  m_1 <- matrix(c(
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 999/1000, 1/1000,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_1 <- c(1, 0, 0, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4", "H5")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/2)
  m_2 <- matrix(c(
    0, 0, 1, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1/1000, 999/1000,
    0, 0, 0, 0, 0,
    1, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_2 <- c(0, 1, 0, 0, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4", "H5")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2),
    weights = c(1/2, 1/2))
  res <- gMCP(graph, pvalues = c(0.01, 0.022, 0.005, 0.012, 0.001), alpha = 0.025)
  show("gMCP:", res@rejected, "TRUE TRUE TRUE TRUE TRUE")
}
hyp_names <- c("H1", "H2", "H3", "H4", "H5")
sketchpad_weights <- matrix(c(
  0, 0, 0, 0, 1,  0, 0, 0, 0, 0.9995,
  0, 0, 0, 1, 0,  0, 0, 0, 0.9995, 0,
  0, 0, 0, 1, 1,  0, 0, 0, 0.5, 0.5,
  0, 0, 1, 0, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 0, 1,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 1,  0, 0, 1, 0, 0,
  0, 1, 0, 0, 0,  0, 0.9995, 0, 0, 0,
  0, 1, 0, 0, 1,  0, 0.9995, 0, 0, 0.0005,
  0, 1, 0, 1, 0,  0, 0.5, 0, 0.4995, 0,
  0, 1, 0, 1, 1,  0, 0.5, 0, 0.4995, 0.0005,
  0, 1, 1, 0, 0,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 0, 1,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 1, 0,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 1, 1,  0, 0.5, 0.5, 0, 0,
  1, 0, 0, 0, 0,  0.9995, 0, 0, 0, 0,
  1, 0, 0, 0, 1,  0.5, 0, 0, 0, 0.4995,
  1, 0, 0, 1, 0,  0.9995, 0, 0, 0.0005, 0,
  1, 0, 0, 1, 1,  0.5, 0, 0, 0.0005, 0.4995,
  1, 0, 1, 0, 0,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 0, 1,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 1, 0,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 1, 1,  0.5, 0, 0.5, 0, 0,
  1, 1, 0, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 1,  0.5, 0.5, 0, 0, 0
), ncol = 10, byrow = TRUE)
p <- c(0.01, 0.022, 0.005, 0.012, 0.001)
alpha <- 0.025
m <- 5
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE TRUE TRUE TRUE TRUE")
if (have_gmcp) cat("max |generateWeights(graph) - sketchpad_weights| =", max(abs(generateWeights(graph) - sketchpad_weights)), "(expected 0 up to rounding)\n")

## ---- Case 2. Self-test C: Fig. 4(b), the same as two fixed sequences, same p-values. Expected: all five. ----
cat("\nCase 2: Self-test C: Fig. 4(b), the same as two fixed sequences, same p-values.\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 2 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  
  # Graph 1 (c = 1/2)
  m_1 <- matrix(c(
    0, 0, 1, 0, 0,
    0, 0, 0, 0, 1,
    0, 0, 0, 1, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_1 <- c(1, 0, 0, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4", "H5")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/2)
  m_2 <- matrix(c(
    0, 0, 0, 1, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 0,
    1, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_2 <- c(0, 1, 0, 0, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4", "H5")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2),
    weights = c(1/2, 1/2))
  res <- gMCP(graph, pvalues = c(0.01, 0.022, 0.005, 0.012, 0.001), alpha = 0.025)
  show("gMCP:", res@rejected, "TRUE TRUE TRUE TRUE TRUE")
}
hyp_names <- c("H1", "H2", "H3", "H4", "H5")
sketchpad_weights <- matrix(c(
  0, 0, 0, 0, 1,  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,  0, 0, 0, 1, 0,
  0, 0, 0, 1, 1,  0, 0, 0, 0.5, 0.5,
  0, 0, 1, 0, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 0, 1,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 1,  0, 0, 1, 0, 0,
  0, 1, 0, 0, 0,  0, 1, 0, 0, 0,
  0, 1, 0, 0, 1,  0, 1, 0, 0, 0,
  0, 1, 0, 1, 0,  0, 0.5, 0, 0.5, 0,
  0, 1, 0, 1, 1,  0, 0.5, 0, 0.5, 0,
  0, 1, 1, 0, 0,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 0, 1,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 1, 0,  0, 0.5, 0.5, 0, 0,
  0, 1, 1, 1, 1,  0, 0.5, 0.5, 0, 0,
  1, 0, 0, 0, 0,  1, 0, 0, 0, 0,
  1, 0, 0, 0, 1,  0.5, 0, 0, 0, 0.5,
  1, 0, 0, 1, 0,  1, 0, 0, 0, 0,
  1, 0, 0, 1, 1,  0.5, 0, 0, 0, 0.5,
  1, 0, 1, 0, 0,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 0, 1,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 1, 0,  0.5, 0, 0.5, 0, 0,
  1, 0, 1, 1, 1,  0.5, 0, 0.5, 0, 0,
  1, 1, 0, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 1,  0.5, 0.5, 0, 0, 0
), ncol = 10, byrow = TRUE)
p <- c(0.01, 0.022, 0.005, 0.012, 0.001)
alpha <- 0.025
m <- 5
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE TRUE TRUE TRUE TRUE")

## ---- Case 3. Self-test D: Fig. 5 with gamma1 = gamma2 = 1/2, same p-values. Expected: H1 and H3 only (H2 stays at 0.01875, H4 at (1 - eps) 0.00625). ----
cat("\nCase 3: Self-test D: Fig. 5 with gamma1 = gamma2 = 1/2, same p-values.\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 2 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with γ1 = 1/2, ε = 1/1000, γ2 = 1/2
  
  # Graph 1 (c = 1/2)
  m_1 <- matrix(c(
    0, 1/2, 1/2, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 999/1000, 1/1000,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_1 <- c(1, 0, 0, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4", "H5")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/2)
  m_2 <- matrix(c(
    0, 0, 1, 0, 0,
    1/2, 0, 1/2, 0, 0,
    0, 0, 0, 1/1000, 999/1000,
    0, 0, 0, 0, 0,
    1, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_2 <- c(0, 1, 0, 0, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4", "H5")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2),
    weights = c(1/2, 1/2))
  res <- gMCP(graph, pvalues = c(0.01, 0.022, 0.005, 0.012, 0.001), alpha = 0.025)
  show("gMCP:", res@rejected, "TRUE FALSE TRUE FALSE FALSE")
}
hyp_names <- c("H1", "H2", "H3", "H4", "H5")
sketchpad_weights <- matrix(c(
  0, 0, 0, 0, 1,  0, 0, 0, 0, 0.9995,
  0, 0, 0, 1, 0,  0, 0, 0, 0.9995, 0,
  0, 0, 0, 1, 1,  0, 0, 0, 0.5, 0.5,
  0, 0, 1, 0, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 0, 1,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 0,  0, 0, 1, 0, 0,
  0, 0, 1, 1, 1,  0, 0, 1, 0, 0,
  0, 1, 0, 0, 0,  0, 0.99975, 0, 0, 0,
  0, 1, 0, 0, 1,  0, 0.99975, 0, 0, 0.00025,
  0, 1, 0, 1, 0,  0, 0.75, 0, 0.24975, 0,
  0, 1, 0, 1, 1,  0, 0.75, 0, 0.24975, 0.00025,
  0, 1, 1, 0, 0,  0, 0.75, 0.25, 0, 0,
  0, 1, 1, 0, 1,  0, 0.75, 0.25, 0, 0,
  0, 1, 1, 1, 0,  0, 0.75, 0.25, 0, 0,
  0, 1, 1, 1, 1,  0, 0.75, 0.25, 0, 0,
  1, 0, 0, 0, 0,  0.99975, 0, 0, 0, 0,
  1, 0, 0, 0, 1,  0.75, 0, 0, 0, 0.24975,
  1, 0, 0, 1, 0,  0.99975, 0, 0, 0.00025, 0,
  1, 0, 0, 1, 1,  0.75, 0, 0, 0.00025, 0.24975,
  1, 0, 1, 0, 0,  0.75, 0, 0.25, 0, 0,
  1, 0, 1, 0, 1,  0.75, 0, 0.25, 0, 0,
  1, 0, 1, 1, 0,  0.75, 0, 0.25, 0, 0,
  1, 0, 1, 1, 1,  0.75, 0, 0.25, 0, 0,
  1, 1, 0, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 0, 1, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 0, 1,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 0,  0.5, 0.5, 0, 0, 0,
  1, 1, 1, 1, 1,  0.5, 0.5, 0, 0, 0
), ncol = 10, byrow = TRUE)
p <- c(0.01, 0.022, 0.005, 0.012, 0.001)
alpha <- 0.025
m <- 5
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE FALSE TRUE FALSE FALSE")

## ---- Case 4. Self-test E: at least 3 of 4 primaries (section 5.3.2, Fig. 6, p. 1751), alpha 0.05, p = (0.01, 0.01, 0.01, 0.04, 0.01). Expected: H1, H2, H3, H5 (H4 retained at 3 alpha / 4 = 0.0375). ----
cat("\nCase 4: Self-test E: at least 3 of 4 primaries (section 5.3.2, Fig. 6, p. 1751), alpha 0.05, p = (0.01, 0.01, 0.01, 0.04, 0.01).\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 4 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with ε = 1/1000
  
  # Graph 1 (c = 1/4)
  m_1 <- matrix(c(
    0, 1/2, 1/2, 0, 0,
    1/2, 0, 1/2, 0, 0,
    499/1000, 1/2, 0, 0, 1/1000,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_1 <- c(1/3, 1/3, 1/3, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4", "H5")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/4)
  m_2 <- matrix(c(
    0, 1/2, 0, 1/2, 0,
    1/2, 0, 0, 1/2, 0,
    0, 0, 0, 0, 0,
    499/1000, 1/2, 0, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_2 <- c(1/3, 1/3, 0, 1/3, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4", "H5")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  # Graph 3 (c = 1/4)
  m_3 <- matrix(c(
    0, 0, 1/2, 1/2, 0,
    0, 0, 0, 0, 0,
    1/2, 0, 0, 1/2, 0,
    499/1000, 0, 1/2, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_3 <- c(1/3, 0, 1/3, 1/3, 0)
  rownames(m_3) <- colnames(m_3) <- c("H1", "H2", "H3", "H4", "H5")
  graph_3 <- matrix2graph(m_3, weights_3)
  
  # Graph 4 (c = 1/4)
  m_4 <- matrix(c(
    0, 0, 0, 0, 0,
    0, 0, 1/2, 1/2, 0,
    0, 1/2, 0, 1/2, 0,
    0, 499/1000, 1/2, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_4 <- c(0, 1/3, 1/3, 1/3, 0)
  rownames(m_4) <- colnames(m_4) <- c("H1", "H2", "H3", "H4", "H5")
  graph_4 <- matrix2graph(m_4, weights_4)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2, graph_3, graph_4),
    weights = c(1/4, 1/4, 1/4, 1/4))
  res <- gMCP(graph, pvalues = c(0.01, 0.01, 0.01, 0.04, 0.01), alpha = 0.05)
  show("gMCP:", res@rejected, "TRUE TRUE TRUE FALSE TRUE")
}
hyp_names <- c("H1", "H2", "H3", "H4", "H5")
sketchpad_weights <- matrix(c(
  0, 0, 0, 0, 1,  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,  0, 0, 0, 0.75, 0,
  0, 0, 0, 1, 1,  0, 0, 0, 0.75, 0.25,
  0, 0, 1, 0, 0,  0, 0, 0.749666888741, 0, 0,
  0, 0, 1, 0, 1,  0, 0, 0.749666888741, 0, 0.250333111259,
  0, 0, 1, 1, 0,  0, 0, 0.5, 0.5, 0,
  0, 0, 1, 1, 1,  0, 0, 0.5, 0.5, 0,
  0, 1, 0, 0, 0,  0, 0.749500222074, 0, 0, 0,
  0, 1, 0, 0, 1,  0, 0.749500222074, 0, 0, 0.250499777926,
  0, 1, 0, 1, 0,  0, 0.49983344437, 0, 0.5, 0,
  0, 1, 0, 1, 1,  0, 0.49983344437, 0, 0.5, 0.00016655562958,
  0, 1, 1, 0, 0,  0, 0.499750111037, 0.49983344437, 0, 0,
  0, 1, 1, 0, 1,  0, 0.499750111037, 0.49983344437, 0, 0.000416444592494,
  0, 1, 1, 1, 0,  0, 0.333333333333, 0.333333333333, 0.333333333333, 0,
  0, 1, 1, 1, 1,  0, 0.333333333333, 0.333333333333, 0.333333333333, 0,
  1, 0, 0, 0, 0,  0.7495, 0, 0, 0, 0,
  1, 0, 0, 0, 1,  0.7495, 0, 0, 0, 0.2505,
  1, 0, 0, 1, 0,  0.499833333333, 0, 0, 0.5, 0,
  1, 0, 0, 1, 1,  0.499833333333, 0, 0, 0.5, 0.000166666666667,
  1, 0, 1, 0, 0,  0.49975, 0, 0.49983344437, 0, 0,
  1, 0, 1, 0, 1,  0.49975, 0, 0.49983344437, 0, 0.00041655562958,
  1, 0, 1, 1, 0,  0.333333333333, 0, 0.333333333333, 0.333333333333, 0,
  1, 0, 1, 1, 1,  0.333333333333, 0, 0.333333333333, 0.333333333333, 0,
  1, 1, 0, 0, 0,  0.499666666667, 0.499833333333, 0, 0, 0,
  1, 1, 0, 0, 1,  0.499666666667, 0.499833333333, 0, 0, 0.0005,
  1, 1, 0, 1, 0,  0.33325, 0.333333333333, 0, 0.333333333333, 0,
  1, 1, 0, 1, 1,  0.33325, 0.333333333333, 0, 0.333333333333, 0.0000833333333333,
  1, 1, 1, 0, 0,  0.333166666667, 0.33325, 0.333333333333, 0, 0,
  1, 1, 1, 0, 1,  0.333166666667, 0.33325, 0.333333333333, 0, 0.00025,
  1, 1, 1, 1, 0,  0.25, 0.25, 0.25, 0.25, 0,
  1, 1, 1, 1, 1,  0.25, 0.25, 0.25, 0.25, 0
), ncol = 10, byrow = TRUE)
p <- c(0.01, 0.01, 0.01, 0.04, 0.01)
alpha <- 0.05
m <- 5
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE TRUE TRUE FALSE TRUE")

## ---- Case 5. Self-test E, case 2: p = (0.01, 0.01, 0.01, 0.03, 0.04). Expected: all five (H5 at alpha once all four primaries are rejected). ----
cat("\nCase 5: Self-test E, case 2: p = (0.01, 0.01, 0.01, 0.03, 0.04).\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 4 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with ε = 1/1000
  
  # Graph 1 (c = 1/4)
  m_1 <- matrix(c(
    0, 1/2, 1/2, 0, 0,
    1/2, 0, 1/2, 0, 0,
    499/1000, 1/2, 0, 0, 1/1000,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_1 <- c(1/3, 1/3, 1/3, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4", "H5")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/4)
  m_2 <- matrix(c(
    0, 1/2, 0, 1/2, 0,
    1/2, 0, 0, 1/2, 0,
    0, 0, 0, 0, 0,
    499/1000, 1/2, 0, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_2 <- c(1/3, 1/3, 0, 1/3, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4", "H5")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  # Graph 3 (c = 1/4)
  m_3 <- matrix(c(
    0, 0, 1/2, 1/2, 0,
    0, 0, 0, 0, 0,
    1/2, 0, 0, 1/2, 0,
    499/1000, 0, 1/2, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_3 <- c(1/3, 0, 1/3, 1/3, 0)
  rownames(m_3) <- colnames(m_3) <- c("H1", "H2", "H3", "H4", "H5")
  graph_3 <- matrix2graph(m_3, weights_3)
  
  # Graph 4 (c = 1/4)
  m_4 <- matrix(c(
    0, 0, 0, 0, 0,
    0, 0, 1/2, 1/2, 0,
    0, 1/2, 0, 1/2, 0,
    0, 499/1000, 1/2, 0, 1/1000,
    0, 0, 0, 0, 0
  ), nrow = 5, byrow = TRUE)
  weights_4 <- c(0, 1/3, 1/3, 1/3, 0)
  rownames(m_4) <- colnames(m_4) <- c("H1", "H2", "H3", "H4", "H5")
  graph_4 <- matrix2graph(m_4, weights_4)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2, graph_3, graph_4),
    weights = c(1/4, 1/4, 1/4, 1/4))
  res <- gMCP(graph, pvalues = c(0.01, 0.01, 0.01, 0.03, 0.04), alpha = 0.05)
  show("gMCP:", res@rejected, "TRUE TRUE TRUE TRUE TRUE")
}
hyp_names <- c("H1", "H2", "H3", "H4", "H5")
sketchpad_weights <- matrix(c(
  0, 0, 0, 0, 1,  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,  0, 0, 0, 0.75, 0,
  0, 0, 0, 1, 1,  0, 0, 0, 0.75, 0.25,
  0, 0, 1, 0, 0,  0, 0, 0.749666888741, 0, 0,
  0, 0, 1, 0, 1,  0, 0, 0.749666888741, 0, 0.250333111259,
  0, 0, 1, 1, 0,  0, 0, 0.5, 0.5, 0,
  0, 0, 1, 1, 1,  0, 0, 0.5, 0.5, 0,
  0, 1, 0, 0, 0,  0, 0.749500222074, 0, 0, 0,
  0, 1, 0, 0, 1,  0, 0.749500222074, 0, 0, 0.250499777926,
  0, 1, 0, 1, 0,  0, 0.49983344437, 0, 0.5, 0,
  0, 1, 0, 1, 1,  0, 0.49983344437, 0, 0.5, 0.00016655562958,
  0, 1, 1, 0, 0,  0, 0.499750111037, 0.49983344437, 0, 0,
  0, 1, 1, 0, 1,  0, 0.499750111037, 0.49983344437, 0, 0.000416444592494,
  0, 1, 1, 1, 0,  0, 0.333333333333, 0.333333333333, 0.333333333333, 0,
  0, 1, 1, 1, 1,  0, 0.333333333333, 0.333333333333, 0.333333333333, 0,
  1, 0, 0, 0, 0,  0.7495, 0, 0, 0, 0,
  1, 0, 0, 0, 1,  0.7495, 0, 0, 0, 0.2505,
  1, 0, 0, 1, 0,  0.499833333333, 0, 0, 0.5, 0,
  1, 0, 0, 1, 1,  0.499833333333, 0, 0, 0.5, 0.000166666666667,
  1, 0, 1, 0, 0,  0.49975, 0, 0.49983344437, 0, 0,
  1, 0, 1, 0, 1,  0.49975, 0, 0.49983344437, 0, 0.00041655562958,
  1, 0, 1, 1, 0,  0.333333333333, 0, 0.333333333333, 0.333333333333, 0,
  1, 0, 1, 1, 1,  0.333333333333, 0, 0.333333333333, 0.333333333333, 0,
  1, 1, 0, 0, 0,  0.499666666667, 0.499833333333, 0, 0, 0,
  1, 1, 0, 0, 1,  0.499666666667, 0.499833333333, 0, 0, 0.0005,
  1, 1, 0, 1, 0,  0.33325, 0.333333333333, 0, 0.333333333333, 0,
  1, 1, 0, 1, 1,  0.33325, 0.333333333333, 0, 0.333333333333, 0.0000833333333333,
  1, 1, 1, 0, 0,  0.333166666667, 0.33325, 0.333333333333, 0, 0,
  1, 1, 1, 0, 1,  0.333166666667, 0.33325, 0.333333333333, 0, 0.00025,
  1, 1, 1, 1, 0,  0.25, 0.25, 0.25, 0.25, 0,
  1, 1, 1, 1, 1,  0.25, 0.25, 0.25, 0.25, 0
), ncol = 10, byrow = TRUE)
p <- c(0.01, 0.01, 0.01, 0.03, 0.04)
alpha <- 0.05
m <- 5
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE TRUE TRUE TRUE TRUE")

## ---- Case 6. Self-test G: Guilbaud (2018) Example 11 and Fig. 5(b), p. 230, at least 2 of 3, alpha 0.05, p = (0.01, 0.02, 0.04, 0.015). Expected: H1, H2, H4 (H3 retained at 1/30). ----
cat("\nCase 6: Self-test G: Guilbaud (2018) Example 11 and Fig. 5(b), p. 230, at least 2 of 3, alpha 0.05, p = (0.01, 0.02, 0.04, 0.015).\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 3 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with ε = 1/1000
  
  # Graph 1 (c = 1/3)
  m_1 <- matrix(c(
    0, 1, 0, 0,
    999/1000, 0, 0, 1/1000,
    0, 0, 0, 0,
    0, 0, 0, 0
  ), nrow = 4, byrow = TRUE)
  weights_1 <- c(1/2, 1/2, 0, 0)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3", "H4")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1/3)
  m_2 <- matrix(c(
    0, 0, 1, 0,
    0, 0, 0, 0,
    999/1000, 0, 0, 1/1000,
    0, 0, 0, 0
  ), nrow = 4, byrow = TRUE)
  weights_2 <- c(1/2, 0, 1/2, 0)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3", "H4")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  # Graph 3 (c = 1/3)
  m_3 <- matrix(c(
    0, 0, 0, 0,
    0, 0, 1, 0,
    0, 999/1000, 0, 1/1000,
    0, 0, 0, 0
  ), nrow = 4, byrow = TRUE)
  weights_3 <- c(0, 1/2, 1/2, 0)
  rownames(m_3) <- colnames(m_3) <- c("H1", "H2", "H3", "H4")
  graph_3 <- matrix2graph(m_3, weights_3)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2, graph_3),
    weights = c(1/3, 1/3, 1/3))
  res <- gMCP(graph, pvalues = c(0.01, 0.02, 0.04, 0.015), alpha = 0.05)
  show("gMCP:", res@rejected, "TRUE TRUE FALSE TRUE")
}
hyp_names <- c("H1", "H2", "H3", "H4")
sketchpad_weights <- matrix(c(
  0, 0, 0, 1,  0, 0, 0, 1,
  0, 0, 1, 0,  0, 0, 0.666666666667, 0,
  0, 0, 1, 1,  0, 0, 0.666666666667, 0.333333333333,
  0, 1, 0, 0,  0, 0.6665, 0, 0,
  0, 1, 0, 1,  0, 0.6665, 0, 0.3335,
  0, 1, 1, 0,  0, 0.5, 0.5, 0,
  0, 1, 1, 1,  0, 0.5, 0.5, 0,
  1, 0, 0, 0,  0.666333333333, 0, 0, 0,
  1, 0, 0, 1,  0.666333333333, 0, 0, 0.333666666667,
  1, 0, 1, 0,  0.499833333333, 0, 0.5, 0,
  1, 0, 1, 1,  0.499833333333, 0, 0.5, 0.000166666666667,
  1, 1, 0, 0,  0.499833333333, 0.499833333333, 0, 0,
  1, 1, 0, 1,  0.499833333333, 0.499833333333, 0, 0.000333333333333,
  1, 1, 1, 0,  0.333333333333, 0.333333333333, 0.333333333333, 0,
  1, 1, 1, 1,  0.333333333333, 0.333333333333, 0.333333333333, 0
), ncol = 8, byrow = TRUE)
p <- c(0.01, 0.02, 0.04, 0.015)
alpha <- 0.05
m <- 4
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE TRUE FALSE TRUE")

## ---- Case 7. Truncated Holm on 3 hypotheses as an entangled graph (section 5.3.1, p. 1750), gamma = 1/2, alpha 0.025, p = (0.004, 0.012, 0.02). Expected: H1 at alpha/3 = 0.008333 rejected; H2 then at (gamma/2 + (1 - gamma)/3) alpha = 0.010417 retained; H3 retained. ----
cat("\nCase 7: Truncated Holm on 3 hypotheses as an entangled graph (section 5.3.1, p. 1750), gamma = 1/2, alpha 0.025, p = (0.004, 0.012, 0.02).\n")
if (have_gmcp) {
  # Entangled graph (Maurer and Bretz, 2013): 2 component graphs on the same hypotheses, joined with the
  # component weights c. Each hypothesis is tested at alpha * sum_h c_h w_hi (Algorithm 1, p. 1743).
  # Symbolic weights evaluated with γ = 1/2
  
  # Graph 1 (c = γ = 1/2)
  m_1 <- matrix(c(
    0, 1/2, 1/2,
    1/2, 0, 1/2,
    1/2, 1/2, 0
  ), nrow = 3, byrow = TRUE)
  weights_1 <- c(1/3, 1/3, 1/3)
  rownames(m_1) <- colnames(m_1) <- c("H1", "H2", "H3")
  graph_1 <- matrix2graph(m_1, weights_1)
  
  # Graph 2 (c = 1−γ = 1/2)
  m_2 <- matrix(c(
    0, 0, 0,
    0, 0, 0,
    0, 0, 0
  ), nrow = 3, byrow = TRUE)
  weights_2 <- c(1/3, 1/3, 1/3)
  rownames(m_2) <- colnames(m_2) <- c("H1", "H2", "H3")
  graph_2 <- matrix2graph(m_2, weights_2)
  
  graph <- new("entangledMCP", subgraphs = list(graph_1, graph_2),
    weights = c(1/2, 1/2))
  res <- gMCP(graph, pvalues = c(0.004, 0.012, 0.02), alpha = 0.025)
  show("gMCP:", res@rejected, "TRUE FALSE FALSE")
}
hyp_names <- c("H1", "H2", "H3")
sketchpad_weights <- matrix(c(
  0, 0, 1,  0, 0, 0.666666666667,
  0, 1, 0,  0, 0.666666666667, 0,
  0, 1, 1,  0, 0.416666666667, 0.416666666667,
  1, 0, 0,  0.666666666667, 0, 0,
  1, 0, 1,  0.416666666667, 0, 0.416666666667,
  1, 1, 0,  0.416666666667, 0.416666666667, 0,
  1, 1, 1,  0.333333333333, 0.333333333333, 0.333333333333
), ncol = 6, byrow = TRUE)
p <- c(0.004, 0.012, 0.02)
alpha <- 0.025
m <- 3
in_set <- sketchpad_weights[, 1:m] == 1
w <- sketchpad_weights[, m + (1:m)]
# Bonferroni closed test: an intersection is rejected when some member has p <= weight * alpha; H_i is rejected
# when every intersection containing it is rejected. This equals the step-by-step procedure (Maurer and Bretz,
# 2013, p. 1745).
rej_int <- apply(in_set & (matrix(p, nrow(w), m, byrow = TRUE) <= w * alpha), 1, any)
rejected <- sapply(1:m, function(i) all(rej_int[in_set[, i]]))
names(rejected) <- hyp_names
show("by hand:", rejected, "TRUE FALSE FALSE")
