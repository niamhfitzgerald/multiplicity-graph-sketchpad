# Cross-check of the Sketchpad 1.4.0 parametric test against mvtnorm and graphicalMCP
# --------------------------------------------------------------------------
# From 1.4.0 the Test tab computes parametric adjusted p-values for blocks of
# two to four correlated hypotheses by exact numerical integration (Genz, 2004;
# Genz and Bretz, 2009, section 2.1.2), and accepts a singular but valid
# correlation matrix (Thomas, Bornkamp, Posch and Koenig, 2020, p. 58).
#
# Each value printed by the Sketchpad 1.4.0 engine is written beside the call.
# Checks:
#   1. graphicalMCP's closed parametric test (tolerance 3e-5: graphicalMCP uses
#      mvtnorm's randomised Genz-Bretz rule, whose result moves by a few 1e-6
#      from run to run).
#   2. For Holm graphs, an exact closed test written here with mvtnorm's TVPACK
#      (blocks of two and three) and Miwa (blocks of four) algorithms
#      (tolerance 1e-7).
#   3. The singular example with the correlations entered to six decimals.
#   4. Two nearly singular blocks: exact closed test only (graphicalMCP's
#      value is printed; its default integration is about 1e-4 out here).
#
# Uses only graph_create and graph_test_closure, with the field
# $outputs$adjusted_p, as the other R/validate-*.R scripts do. Run on
# 29 October 2026 with graphicalMCP 0.3.0.9000 and mvtnorm 1.2.4: every check
# passed.

library(graphicalMCP)
library(mvtnorm)
set.seed(2009)
ok <- function(cond, what) { if (!isTRUE(cond)) stop("Mismatch: ", what); cat("OK:", what, "\n") }
close_to <- function(a, b, tol) isTRUE(all(abs(unname(a) - b) <= tol))
holm <- function(m) { G <- matrix(1 / (m - 1), m, m); diag(G) <- 0; graph_create(rep(1 / m, m), G, paste0("H", 1:m)) }
cs <- function(m, r) { M <- matrix(r, m, m); diag(M) <- 1; M }
gm <- function(g, p, alpha, R) graph_test_closure(g, p, alpha = alpha, test_groups = list(seq_along(p)), test_types = "parametric", test_corr = list(R))$outputs$adjusted_p

# Exact closed test for an equally weighted Holm graph: for each intersection J
# the weights are 1 / |J|, q = min p_j / w_j, and the p-value of H_J is
# 1 - P(Z_j < qnorm(1 - q w_j) for all j in J), within the Bonferroni bounds.
exact_holm <- function(p, R) {
  m <- length(p); adj <- rep(0, m)
  for (mask in 1:(2^m - 1)) {
    J <- which(bitwAnd(mask, 2^(0:(m - 1))) > 0); w <- rep(1 / length(J), length(J)); q <- min(p[J] / w)
    pj <- if (length(J) == 1) min(1, q) else {
      alg <- if (length(J) <= 3) TVPACK(abseps = 1e-12) else Miwa(steps = 4096)
      min(1, max(q * max(w), min(q, 1 - pmvnorm(upper = qnorm(1 - pmin(1, q * w)), corr = R[J, J, drop = FALSE], algorithm = alg)[1])))
    }
    adj[J] <- pmax(adj[J], pj)
  }
  adj
}

## Ristl et al. (2024): two endpoints, correlation 0.87, Holm(2), alpha 0.025
app <- c(0.01, 0.0082147)
p <- c(0.01, 0.0053); R <- cs(2, 0.87)
ok(close_to(gm(holm(2), p, 0.025, R), app, 3e-5), "Ristl 2024, block of two: graphicalMCP")
ok(close_to(exact_holm(p, R), app, 1e-7), "Ristl 2024, block of two: exact (TVPACK)")

## Koenig et al. (2025), Table 6: Holm(3), correlation 0.5, alpha 0.025
app <- c(0.3492, 0.0448549, 0.0175446)
p <- c(0.3492, 0.0247, 0.0065); R <- cs(3, 0.5)
ok(close_to(gm(holm(3), p, 0.025, R), app, 3e-5), "Koenig 2025 Table 6, block of three: graphicalMCP")
ok(close_to(exact_holm(p, R), app, 1e-7), "Koenig 2025 Table 6, block of three: exact (TVPACK)")

## Zhang, Quan, Ng and Stepanavage (1997), Table 6, p. 218: Holm(4), one-sided p = two-sided / 2
app <- c(0.0068825, 0.0104194, 0.0238324, 0.0238324)
p <- c(0.0037, 0.0077, 0.0274, 0.0369) / 2
R <- matrix(c(1, .25, .31, .24, .25, 1, .42, .43, .31, .42, 1, .67, .24, .43, .67, 1), 4)
ok(close_to(gm(holm(4), p, 0.025, R), app, 3e-5), "Zhang 1997 Table 6, block of four: graphicalMCP")
ok(close_to(exact_holm(p, R), app, 1e-7), "Zhang 1997 Table 6, block of four: exact (Miwa)")

## An example graph: two doses, each with a primary and a secondary endpoint, one block of four
G <- rbind(c(0, 1/2, 1/2, 0), c(1/2, 0, 0, 1/2), c(0, 1, 0, 0), c(1, 0, 0, 0))
g <- graph_create(c(1/2, 1/2, 0, 0), G, paste0("H", 1:4))
app <- c(0.0187061, 0.02, 0.0196596, 0.5)
p <- c(0.01, 0.02, 0.005, 0.5)
R <- matrix(c(1, .5, .5, .25, .5, 1, .25, .5, .5, .25, 1, .5, .25, .5, .5, 1), 4)
ok(close_to(gm(g, p, 0.025, R), app, 3e-5), "Two doses, two endpoints, block of four: graphicalMCP")

## Thomas, Bornkamp, Posch and Koenig (2020), p. 58: full population F, subgroup S
## and its complement C with prevalence 1/2, so corr(F, S) = corr(F, C) = sqrt(1/2)
## and corr(S, C) = 0. The matrix is singular (F is an exact combination of S and C).
## Holm(3), alpha 0.05, p = (0.02, 0.03, 0.4).
app <- c(0.0471798, 0.0591, 0.4)
p <- c(0.02, 0.03, 0.4); h <- sqrt(1 / 2)
R <- matrix(c(1, h, h, h, 1, 0, h, 0, 1), 3)
ok(abs(det(R)) < 1e-12, "Thomas 2020: the matrix is singular")
ok(close_to(gm(holm(3), p, 0.05, R), app, 3e-5), "Thomas 2020, singular block of three: graphicalMCP")
ok(close_to(exact_holm(p, R), app, 1e-6), "Thomas 2020, singular block of three: exact (TVPACK)")

## The same correlations entered to six decimals (0.707107), as typed in the Test tab.
## The Sketchpad accepts them and gives 0.0471798 again. graphicalMCP refuses a
## matrix that is a little outside the valid set, so in R write the exact values
## (sqrt(1/2)) as above.
R6 <- round(R, 6)
ok(min(eigen(R6, only.values = TRUE)$values) < 0, "six decimals: smallest eigenvalue is just below 0")
ok(inherits(try(gm(holm(3), p, 0.05, R6), silent = TRUE), "try-error"), "six decimals: graphicalMCP refuses the matrix (write sqrt(1/2) in R)")

## Two nearly singular blocks (found by the independent review of 29 October).
## The app gives the same values in every order of the hypotheses.
## (a) Prevalence 0.248, correlations rounded to six decimals.
app <- c(0.0241573267, 0.0241573267, 0.0241573267)
p <- c(0.0101, 0.012, 0.0105)
R <- matrix(c(1, 0.497996, 0.867179, 0.497996, 1, 0, 0.867179, 0, 1), 3)
ok(close_to(exact_holm(p, R), app, 1e-8), "nearly singular (a): exact (TVPACK)")
cat("   graphicalMCP gives", format(gm(holm(3), p, 0.025, R), digits = 7), "(its default Genz-Bretz rule is less accurate here)\n")
## (b) Two statistics correlated 0.9999995, each 0.5 with a third.
app <- c(0.0187157554, 0.0187157554, 0.2)
p <- c(0.01, 0.01, 0.2); r <- 0.9999995
R <- matrix(c(1, r, .5, r, 1, .5, .5, .5, 1), 3)
ok(close_to(exact_holm(p, R), app, 1e-8), "nearly singular (b): exact (TVPACK)")
cat("   graphicalMCP gives", format(gm(holm(3), p, 0.025, R), digits = 7), "(its default Genz-Bretz rule is less accurate here)\n")

cat("\nAll checks passed.\n")
