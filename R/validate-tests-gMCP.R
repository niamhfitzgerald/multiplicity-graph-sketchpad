# Validation of the Sketchpad's closed tests (weighted Simes and parametric)
# against gMCP and graphicalMCP.
# Expected values come from the Sketchpad's own engine. Simes values are exact;
# parametric values come from Monte Carlo integration in the browser, so they
# are checked to a relative tolerance of 0.3%.

library(gMCP)
library(graphicalMCP)

two_doses_m <- matrix(c(
  0,   1/2, 1/2, 0,
  1/2, 0,   0,   1/2,
  0,   1,   0,   0,
  1,   0,   0,   0
), nrow = 4, byrow = TRUE)
rownames(two_doses_m) <- colnames(two_doses_m) <- paste0("H", 1:4)
two_doses <- matrix2graph(two_doses_m, c(1/2, 1/2, 0, 0))
holm4 <- BonferroniHolm(4)

check <- function(name, got_adj, got_rej, exp_adj, exp_rej, tol = 1e-8) {
  cat("\n==", name, "==\n")
  print(data.frame(adj_p = signif(got_adj, 5), expected = exp_adj, rejected = got_rej, expected_rej = exp_rej))
  stopifnot(identical(as.logical(unname(got_rej)), exp_rej))
  stopifnot(isTRUE(all.equal(as.numeric(unname(got_adj)), exp_adj, tolerance = tol)))
  cat("OK\n")
}

# 1. Weighted Simes, two doses, alpha 0.025 ------------------------------------
p <- c(0.004, 0.009, 0.011, 0.03)
r <- gMCP(two_doses, pvalues = p, alpha = 0.025, test = "Simes")
check("Simes, two doses (gMCP)", r@adjPValues, r@rejected,
      exp_adj = c(0.008, 0.011, 0.022, 0.03), exp_rej = c(TRUE, TRUE, TRUE, FALSE))
r2 <- graph_test_closure(graph_create(c(1/2, 1/2, 0, 0), two_doses_m), p = p, alpha = 0.025, test_types = "simes")
check("Simes, two doses (graphicalMCP)", r2$outputs$adjusted_p, r2$outputs$rejected,
      exp_adj = c(0.008, 0.011, 0.022, 0.03), exp_rej = c(TRUE, TRUE, TRUE, FALSE))

# 2. Weighted Simes (Hommel), Holm graph with 4 hypotheses ----------------------
p <- c(0.01, 0.02, 0.03, 0.02)
r <- gMCP(holm4, pvalues = p, alpha = 0.025, test = "Simes")
check("Simes, Holm(4)", r@adjPValues, r@rejected,
      exp_adj = c(0.03, 0.03, 0.03, 0.03), exp_rej = c(FALSE, FALSE, FALSE, FALSE))

# 3. Parametric, two doses, rho = 0.5 for every pair, upscale = FALSE ----------
corr <- matrix(0.5, 4, 4); diag(corr) <- 1
p <- c(0.004, 0.009, 0.011, 0.03)
r <- gMCP(two_doses, pvalues = p, alpha = 0.025, test = "parametric", correlation = corr, upscale = FALSE)
check("Parametric, two doses, rho 0.5 (gMCP)", r@adjPValues, r@rejected,
      exp_adj = c(0.0076353, 0.011494, 0.020529, 0.03), exp_rej = c(TRUE, TRUE, TRUE, FALSE), tol = 3e-3)
r2 <- graph_test_closure(graph_create(c(1/2, 1/2, 0, 0), two_doses_m), p = p, alpha = 0.025,
                         test_types = "parametric", test_corr = list(corr))
check("Parametric, two doses, rho 0.5 (graphicalMCP)", r2$outputs$adjusted_p, r2$outputs$rejected,
      exp_adj = c(0.0076353, 0.011494, 0.020529, 0.03), exp_rej = c(TRUE, TRUE, TRUE, FALSE), tol = 3e-3)

# 4. Parametric, Holm(4), rho = 0.5 ----------------------------------------------
p <- c(0.01, 0.02, 0.03, 0.02)
r <- gMCP(holm4, pvalues = p, alpha = 0.025, test = "parametric", correlation = corr, upscale = FALSE)
check("Parametric, Holm(4), rho 0.5", r@adjPValues, r@rejected,
      exp_adj = c(0.03362, 0.050956, 0.050956, 0.050956), exp_rej = c(FALSE, FALSE, FALSE, FALSE), tol = 3e-3)

# 5. Bretz et al. (2011) section 3: partially known correlation, alpha 0.05 -----
g <- matrix(c(0,0,1,0, 0,0,0,1, 0,1,0,0, 1,0,0,0), nrow = 4, byrow = TRUE)
rownames(g) <- colnames(g) <- paste0("H", 1:4)
cr <- diag(4); cr[1:2, 3:4] <- NA; cr[3:4, 1:2] <- NA
cr[1, 2] <- cr[2, 1] <- 1/2; cr[3, 4] <- cr[4, 3] <- 1/2
p <- c(0.0121, 0.0337, 0.0084, 0.0160)
r <- gMCP(matrix2graph(g, c(0.5, 0.5, 0, 0)), pvalues = p, alpha = 0.05, test = "parametric", correlation = cr, upscale = FALSE)
check("Parametric, Bretz 2011 example, partial correlation", r@adjPValues, r@rejected,
      exp_adj = c(0.0242, 0.0337, 0.0242, 0.0337), exp_rej = c(TRUE, TRUE, TRUE, TRUE), tol = 3e-3)

cat("\nAll checks passed.\n")
