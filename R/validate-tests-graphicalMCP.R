# Validation of the Sketchpad's closed tests (weighted Simes and parametric)
# against graphicalMCP only (no gMCP, no Java needed).
# Expected values come from the Sketchpad's own engine. Simes values are exact;
# parametric values come from Monte Carlo integration in the browser, so they
# are checked to a relative tolerance of 0.3%.

library(graphicalMCP)

check <- function(name, res, exp_adj, exp_rej, tol = 1e-8) {
  got_adj <- as.numeric(unname(res$outputs$adjusted_p))
  got_rej <- as.logical(unname(res$outputs$rejected))
  cat("\n==", name, "==\n")
  print(data.frame(adj_p = signif(got_adj, 5), expected = exp_adj,
                   rejected = got_rej, expected_rej = exp_rej))
  stopifnot(identical(got_rej, exp_rej))
  stopifnot(isTRUE(all.equal(got_adj, exp_adj, tolerance = tol)))
  cat("OK\n")
}

two_doses <- graph_create(
  hypotheses = c(1/2, 1/2, 0, 0),
  transitions = matrix(c(
    0,   1/2, 1/2, 0,
    1/2, 0,   0,   1/2,
    0,   1,   0,   0,
    1,   0,   0,   0
  ), nrow = 4, byrow = TRUE),
  hyp_names = paste0("H", 1:4)
)
holm4 <- graph_create(
  hypotheses = rep(1/4, 4),
  transitions = matrix(1/3, 4, 4) - diag(1/3, 4),
  hyp_names = paste0("H", 1:4)
)

# 1. Weighted Simes, two doses, alpha 0.025 ------------------------------------
p <- c(0.004, 0.009, 0.011, 0.03)
r <- graph_test_closure(two_doses, p = p, alpha = 0.025, test_types = "simes")
check("Simes, two doses", r,
      exp_adj = c(0.008, 0.011, 0.022, 0.03), exp_rej = c(TRUE, TRUE, TRUE, FALSE))

# 2. Weighted Simes (Hommel), Holm graph with 4 hypotheses ----------------------
p <- c(0.01, 0.02, 0.03, 0.02)
r <- graph_test_closure(holm4, p = p, alpha = 0.025, test_types = "simes")
check("Simes, Holm(4)", r,
      exp_adj = c(0.03, 0.03, 0.03, 0.03), exp_rej = c(FALSE, FALSE, FALSE, FALSE))

# 3. Simes vs Bonferroni, the two-hypothesis hand example, alpha 0.05 ----------
holm2 <- graph_create(c(1/2, 1/2), matrix(c(0, 1, 1, 0), 2), hyp_names = c("H1", "H2"))
p <- c(0.04, 0.045)
r <- graph_test_closure(holm2, p = p, alpha = 0.05, test_types = "bonferroni")
check("Bonferroni, Holm(2), alpha 0.05", r,
      exp_adj = c(0.08, 0.08), exp_rej = c(FALSE, FALSE))
r <- graph_test_closure(holm2, p = p, alpha = 0.05, test_types = "simes")
check("Simes, Holm(2), alpha 0.05", r,
      exp_adj = c(0.045, 0.045), exp_rej = c(TRUE, TRUE))

# 4. Parametric, two doses, rho = 0.5 for every pair ---------------------------
corr <- matrix(0.5, 4, 4); diag(corr) <- 1
p <- c(0.004, 0.009, 0.011, 0.03)
r <- graph_test_closure(two_doses, p = p, alpha = 0.025,
                        test_types = "parametric", test_corr = list(corr))
check("Parametric, two doses, rho 0.5", r,
      exp_adj = c(0.0076353, 0.011494, 0.020529, 0.03),
      exp_rej = c(TRUE, TRUE, TRUE, FALSE), tol = 3e-3)

# 5. Parametric, Holm(4), rho = 0.5 ----------------------------------------------
p <- c(0.01, 0.02, 0.03, 0.02)
r <- graph_test_closure(holm4, p = p, alpha = 0.025,
                        test_types = "parametric", test_corr = list(corr))
check("Parametric, Holm(4), rho 0.5", r,
      exp_adj = c(0.03362, 0.050956, 0.050956, 0.050956),
      exp_rej = c(FALSE, FALSE, FALSE, FALSE), tol = 3e-3)

# 6. Bretz et al. (2011) section 3: partially known correlation, alpha 0.05 -----
# Correlation known within {H1, H2} and within {H3, H4} (rho = 1/2), unknown
# between the blocks. In graphicalMCP this is two parametric test groups.
g <- matrix(c(0,0,1,0, 0,0,0,1, 0,1,0,0, 1,0,0,0), nrow = 4, byrow = TRUE)
bretz2011 <- graph_create(c(0.5, 0.5, 0, 0), g, hyp_names = paste0("H", 1:4))
blk <- matrix(c(1, 0.5, 0.5, 1), 2)
p <- c(0.0121, 0.0337, 0.0084, 0.0160)
r <- graph_test_closure(bretz2011, p = p, alpha = 0.05,
                        test_groups = list(1:2, 3:4),
                        test_types = c("parametric", "parametric"),
                        test_corr = list(blk, blk))
check("Parametric, Bretz 2011 example, partial correlation", r,
      exp_adj = c(0.0242, 0.0337, 0.0242, 0.0337),
      exp_rej = c(TRUE, TRUE, TRUE, TRUE), tol = 3e-3)

cat("\nAll checks passed.\n")
