# Cross-check of the four templates added in Sketchpad 1.1.7 against graphicalMCP
# ------------------------------------------------------------------------------
# Expected values were produced by the Sketchpad's own engine (exact fractions,
# self-tests "Weighted Holm for any m", "Hung and Wang (2010) Fig. 1",
# "Bretz et al. (2009) Fig. 14 ... as templates" and "Bretz et al. (2009) Fig. 8").
# Each check stops with an error if graphicalMCP disagrees.
# Uses the same result fields as validate-graphicalMCP.R (res$outputs$rejected,
# res$outputs$adjusted_p) and graph_update(...)$updated_graph$hypotheses.

library(graphicalMCP)

check_shortcut <- function(name, graph, p, alpha, expected_rejected, expected_adj_p) {
  res <- graph_test_shortcut(graph, p = p, alpha = alpha)
  got_rej <- unname(res$outputs$rejected)
  got_adj <- unname(res$outputs$adjusted_p)
  cat("\n==", name, "==\n")
  print(data.frame(hypothesis = names(graph$hypotheses), p = p,
                   adj_p = round(got_adj, 6), expected_adj_p = expected_adj_p,
                   rejected = got_rej, expected_rejected = expected_rejected))
  stopifnot(identical(as.logical(got_rej), expected_rejected))
  stopifnot(isTRUE(all.equal(as.numeric(got_adj), expected_adj_p, tolerance = 1e-6)))
  cat("OK: rejections and adjusted p-values match the Sketchpad\n")
}

check_weights_after <- function(name, graph, delete, expected) {
  got <- unname(graph_update(graph, delete = delete)$updated_graph$hypotheses)
  cat("\n==", name, ": weights after deleting", delete, "==\n")
  print(rbind(got = round(got, 6), expected = expected))
  stopifnot(isTRUE(all.equal(got, expected, tolerance = 1e-9)))
  cat("OK\n")
}

# 1. Weighted Holm for any m, w = (2/5, 1/4, 1/4, 1/10), g_ij = w_j / (1 - w_i) ----
w <- c(2/5, 1/4, 1/4, 1/10)
Gm <- outer(1 - w, w, function(a, b) b / a); diag(Gm) <- 0
stopifnot(isTRUE(all.equal(Gm, rbind(c(0, 5/12, 5/12, 1/6), c(8/15, 0, 1/3, 2/15),
                                      c(8/15, 1/3, 0, 2/15), c(4/9, 5/18, 5/18, 0)))))
wholm <- graph_create(w, Gm, c("H1", "H2", "H3", "H4"))
check_shortcut("Weighted Holm, Dmitrienko 2006 scenario 1", wholm,
               c(0.0036, 0.0240, 0.0394, 0.1962), 0.05,
               c(TRUE, FALSE, FALSE, FALSE), c(0.009, 0.0576, 0.0576, 0.1962))
check_shortcut("Weighted Holm, Dmitrienko 2006 scenario 2", wholm,
               c(0.0562, 0.0106, 0.0232, 0.0196), 0.05,
               c(FALSE, TRUE, FALSE, FALSE), c(0.07025, 0.0424, 0.0696, 0.07025))
# Guilbaud 2018 Example 6: closure weights w_j / sum over the intersection
w3 <- c(1/2, 3/10, 1/5)
G3 <- outer(1 - w3, w3, function(a, b) b / a); diag(G3) <- 0
cw <- graph_generate_weights(graph_create(w3, G3))
for (i in seq_len(nrow(cw))) {
  inset <- as.logical(cw[i, 1:3]); expect <- ifelse(inset, w3 / sum(w3[inset]), 0)
  stopifnot(isTRUE(all.equal(unname(cw[i, 4:6]), expect)))
}
cat("\nOK: weighted Holm closure weights are w_j / sum_J for all 7 intersections\n")

# 2. Hung and Wang (2010) Fig. 1, node order H1,NI, H1,S, H2,NI, H2,S ------------
hw <- function(nu, tau, omega) graph_create(c(1, 0, 0, 0),
  rbind(c(0, nu, 1 - nu, 0), c(0, 0, 1 - tau, tau), c(0, omega, 0, 1 - omega), c(0, 0, 0, 0)),
  c("H1,NI", "H1,S", "H2,NI", "H2,S"))
check_shortcut("Hung and Wang, nu = tau = omega = 1/2", hw(1/2, 1/2, 1/2),
               c(0.01, 0.02, 0.005, 0.02), 0.025,
               c(TRUE, FALSE, TRUE, FALSE), c(0.01, 0.02666667, 0.01, 0.02666667))
check_weights_after("Hung and Wang, 1/2 each", hw(1/2, 1/2, 1/2), c(1, 3), c(0, 3/4, 0, 1/4))
check_shortcut("Hung and Wang, tau = omega = 1, H2,S without H2,NI (p. 754)", hw(1/2, 1, 1),
               c(0.01, 0.01, 0.5, 0.01), 0.025,
               c(TRUE, TRUE, FALSE, TRUE), c(0.01, 0.02, 1, 0.02))
check_shortcut("Hung and Wang, tau = omega = 1, H2,S never tested (p. 754)", hw(1/2, 1, 1),
               c(0.01, 0.5, 0.001, 0.001), 0.025,
               c(TRUE, FALSE, TRUE, FALSE), c(0.01, 0.5, 0.01, 0.5))

# 3. Bretz et al. (2009) Fig. 14 left and right, node order H11, H12, H13, H21, H22, H23
L7 <- c("H11", "H12", "H13", "H21", "H22", "H23")
left <- graph_create(c(1/2, 0, 0, 1/2, 0, 0), rbind(c(0, 1, 0, 0, 0, 0), c(0, 0, 1, 0, 0, 0), c(0, 0, 0, 1, 0, 0),
                                                     c(0, 0, 0, 0, 1, 0), c(0, 0, 0, 0, 0, 1), c(1, 0, 0, 0, 0, 0)), L7)
right <- graph_create(c(1/2, 0, 0, 1/2, 0, 0), rbind(c(0, 1/2, 0, 1/2, 0, 0), c(0, 0, 1/2, 1/2, 0, 0), c(0, 0, 0, 1, 0, 0),
                                                      c(1/2, 0, 0, 0, 1/2, 0), c(1/2, 0, 0, 0, 0, 1/2), c(1, 0, 0, 0, 0, 0)), L7)
s1 <- c(0.024, 0.024, 0.024, 0.04, 0.04, 0.04); s2 <- c(0.0374, 0.024, 0.024, 0.024, 0.04, 0.024)
check_shortcut("Fig. 14 left, Li and Zhou scenario 1", left, s1, 0.05, rep(TRUE, 6), rep(0.048, 6))
check_shortcut("Fig. 14 left, Li and Zhou scenario 2", left, s2, 0.05,
               c(FALSE, FALSE, FALSE, TRUE, FALSE, FALSE), c(0.0748, 0.0748, 0.0748, 0.048, 0.0748, 0.0748))
check_shortcut("Fig. 14 right, Li and Zhou scenario 1", right, s1, 0.05,
               c(TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
               c(0.048, 0.05333333, 0.05714286, 0.05333333, 0.05714286, 0.05714286))
check_shortcut("Fig. 14 right, Li and Zhou scenario 2", right, s2, 0.05,
               c(TRUE, TRUE, FALSE, TRUE, FALSE, FALSE),
               c(0.04986667, 0.04986667, 0.05714286, 0.048, 0.05714286, 0.05714286))
check_weights_after("Fig. 14 right", right, 1, c(0, 1/4, 0, 3/4, 0, 0))

# 4. Bretz et al. (2009) Fig. 8, node order HE1, HE2, HE3, HS1, HS2, HS3 -----------
fig8 <- graph_create(c(1/3, 1/3, 1/3, 0, 0, 0), rbind(c(0, 0, 0, 1, 0, 0), c(0, 0, 0, 0, 1, 0), c(0, 0, 0, 0, 0, 1),
                                                       c(0, 1/2, 1/2, 0, 0, 0), c(1/2, 0, 1/2, 0, 0, 0), c(1/2, 1/2, 0, 0, 0, 0)),
                     c("HE1", "HE2", "HE3", "HS1", "HS2", "HS3"))
check_shortcut("Fig. 8", fig8, c(0.01, 0.02, 0.2, 0.03, 0.5, 0.01), 0.05,
               c(TRUE, FALSE, FALSE, FALSE, FALSE, FALSE), c(0.03, 0.06, 0.4, 0.09, 0.5, 0.4))
check_weights_after("Fig. 8", fig8, c(1, 4), c(0, 1/2, 1/2, 0, 0, 0))

cat("\nAll template cross-checks passed.\n")
