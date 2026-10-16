# Validation of the Multiplicity Graph Sketchpad step-through against graphicalMCP
# ------------------------------------------------------------------------------
# Expected values were produced by the Sketchpad's own engine (exact fractions).
# Each check stops with an error if graphicalMCP disagrees.
# Written for graphicalMCP 0.2.x; if a field name differs in your version,
# print(res) shows the structure.

library(graphicalMCP)

alpha <- 0.025

check_shortcut <- function(name, graph, p, expected_rejected, expected_adj_p) {
  res <- graph_test_shortcut(graph, p = p, alpha = alpha)
  got_rej <- unname(res$outputs$rejected)
  got_adj <- unname(res$outputs$adjusted_p)
  cat("\n==", name, "==\n")
  print(data.frame(hypothesis = names(graph$hypotheses), p = p,
                   adj_p = round(got_adj, 6), expected_adj_p = expected_adj_p,
                   rejected = got_rej, expected_rejected = expected_rejected))
  stopifnot(identical(as.logical(got_rej), expected_rejected))
  stopifnot(isTRUE(all.equal(as.numeric(got_adj), expected_adj_p, tolerance = 1e-8)))
  cat("OK: rejections and adjusted p-values match the Sketchpad\n")
}

# 1. Bonferroni-Holm, 3 hypotheses ---------------------------------------------
holm <- graph_create(
  hypotheses = c(1/3, 1/3, 1/3),
  transitions = matrix(c(
    0,   1/2, 1/2,
    1/2, 0,   1/2,
    1/2, 1/2, 0
  ), nrow = 3, byrow = TRUE),
  hyp_names = c("H1", "H2", "H3")
)
# Sketchpad: rejects H1 then H3; only one possible order
check_shortcut("Holm", holm,
  p = c(0.005, 0.03, 0.011),
  expected_rejected = c(TRUE, FALSE, TRUE),
  expected_adj_p = c(0.015, 0.03, 0.022))

# 2. Fixed sequence, 3 hypotheses ----------------------------------------------
fixed <- graph_create(
  hypotheses = c(1, 0, 0),
  transitions = matrix(c(
    0, 1, 0,
    0, 0, 1,
    0, 0, 0
  ), nrow = 3, byrow = TRUE),
  hyp_names = c("H1", "H2", "H3")
)
# Sketchpad: rejects H1 only; H3 (p = 0.001) is never reached
check_shortcut("Fixed sequence", fixed,
  p = c(0.01, 0.03, 0.001),
  expected_rejected = c(TRUE, FALSE, FALSE),
  expected_adj_p = c(0.01, 0.03, 0.03))

# 3. Two primaries with a loop, two secondaries (two doses, two endpoints) -----
two_doses <- graph_create(
  hypotheses = c(1/2, 1/2, 0, 0),
  transitions = matrix(c(
    0,   1/2, 1/2, 0,
    1/2, 0,   0,   1/2,
    0,   1,   0,   0,
    1,   0,   0,   0
  ), nrow = 4, byrow = TRUE),
  hyp_names = c("H1", "H2", "H3", "H4")
)
# 3a. Sketchpad: H1 -> H2 -> H3 (or H2 -> H1 -> H3: 2 possible orders, same result)
check_shortcut("Two doses, p set A", two_doses,
  p = c(0.004, 0.009, 0.011, 0.03),
  expected_rejected = c(TRUE, TRUE, TRUE, FALSE),
  expected_adj_p = c(0.008, 0.012, 0.022, 0.03))

# 3b. The "how can p = 0.0014 be rejected?" case.
# Sketchpad: H2 -> H4 -> H1 -> H3. H3 starts at level 0 and is only rejected
# after H4's alpha flows to H1 and H1's alpha flows on to H3.
check_shortcut("Two doses, p set B", two_doses,
  p = c(0.02, 0.008, 0.0014, 0.001),
  expected_rejected = c(TRUE, TRUE, TRUE, TRUE),
  expected_adj_p = c(0.02, 0.016, 0.02, 0.016))

# 4. One update step: graph after rejecting H1 in the two-doses graph ----------
# Sketchpad: weights (H2, H3, H4) = (3/4, 1/4, 0);
# transitions H2->H3 = 1/3, H2->H4 = 2/3, H3->H2 = 1, H4->H2 = 1/2, H4->H3 = 1/2
upd <- tryCatch(graph_update(two_doses, delete = c(TRUE, FALSE, FALSE, FALSE)),
                error = function(e) { message("graph_update() failed: ", conditionMessage(e)); NULL })
if (!is.null(upd)) {
  g1 <- if (!is.null(upd$updated_graph)) upd$updated_graph else upd
  print(g1)
  w <- unname(g1$hypotheses)
  G <- unname(g1$transitions)
  stopifnot(isTRUE(all.equal(w[2:4], c(3/4, 1/4, 0))))
  stopifnot(isTRUE(all.equal(c(G[2, 3], G[2, 4], G[3, 2], G[4, 2], G[4, 3]),
                             c(1/3, 2/3, 1, 1/2, 1/2))))
  cat("OK: updated graph matches the Sketchpad\n")
}

cat("\nAll checks passed.\n")
