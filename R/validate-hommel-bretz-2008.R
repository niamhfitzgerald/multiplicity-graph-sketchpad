# Cross-check of Hommel and Bretz (2008), section 4, against graphicalMCP
# --------------------------------------------------------------------------
# Hommel G, Bretz F (2008). Aesthetics and power considerations in multiple
# testing: a contradiction? Biometrical Journal 50(5):657-666.
# Section 4 (pp. 661-663): Table 1 (p. 662) gives the weights of the fallback
# procedure for every intersection hypothesis with n = 3; the Wiens and
# Dmitrienko improvement (WD) divides each row by its sum. The numerical
# example (p. 662) has equal weights 1/3, alpha = 0.05 and ordered p-values
# 0.015, 0.02, > 0.05: Holm rejects two hypotheses whatever their indices;
# the fallback and WD reject H2 only when p2 < p1 < p3, and H2 and H3 when
# p2 < p3 < p1. For n = 2 (pp. 661-662) weighted Holm (= WD) also rejects H1
# when p2 <= w2 alpha and w1 alpha < p1 <= alpha; the fallback does not.
# The same values are the Sketchpad self-test "Hommel and Bretz (2008) section 4".
# Uses the same result fields as validate-graphicalMCP.R and
# validate-templates-1.1.7.R (res$outputs$rejected, res$outputs$adjusted_p,
# graph_generate_weights(graph) with the indicator columns first).

library(graphicalMCP)

# Graphs ----------------------------------------------------------------------
w <- c(1/3, 1/3, 1/3)
fallback <- graph_create(w, rbind(c(0, 1, 0), c(0, 0, 1), c(0, 0, 0)), c("H1", "H2", "H3"))
# Improved fallback I (Wiens and Dmitrienko 2005, section 3.2; Bretz et al. 2009, Fig. 7):
# the chain, with H3's level returned to H1 and H2 in proportion to their weights
wd <- graph_create(w, rbind(c(0, 1, 0), c(0, 0, 1), c(1/2, 1/2, 0)), c("H1", "H2", "H3"))
holm3 <- graph_create(w, rbind(c(0, 1/2, 1/2), c(1/2, 0, 1/2), c(1/2, 1/2, 0)), c("H1", "H2", "H3"))

# 1. Table 1, p. 662: weights of every intersection hypothesis -------------------
# Rows are index sets (indicator columns 1:3), columns 4:6 the weights.
table1 <- list("1,2,3" = c(1/3, 1/3, 1/3), "1,2" = c(1/3, 1/3, 0), "1,3" = c(1/3, 0, 2/3),
               "2,3" = c(0, 2/3, 1/3), "1" = c(1/3, 0, 0), "2" = c(0, 2/3, 0), "3" = c(0, 0, 1))
check_closure_weights <- function(name, graph, expected, normalise) {
  cw <- graph_generate_weights(graph)
  cat("\n==", name, "==\n")
  for (i in seq_len(nrow(cw))) {
    inset <- as.logical(cw[i, 1:3]); key <- paste(which(inset), collapse = ",")
    want <- expected[[key]]
    if (normalise) want <- want / sum(want)
    got <- unname(cw[i, 4:6])
    cat(sprintf("  {%s}: graphicalMCP %s, paper %s\n", key, paste(round(got, 4), collapse = " "), paste(round(want, 4), collapse = " ")))
    stopifnot(isTRUE(all.equal(got, want, tolerance = 1e-9)))
  }
  cat("OK: all seven index sets match\n")
}
check_closure_weights("Table 1: fallback weights", fallback, table1, normalise = FALSE)
check_closure_weights("Table 1 divided by row sums: WD (improved fallback I)", wd, table1, normalise = TRUE)

# 2. The numerical example, p. 662 ----------------------------------------------
check_rejections <- function(name, graph, p, alpha, expected, closure = FALSE) {
  res <- if (closure) graph_test_closure(graph, p = p, alpha = alpha, test_types = "bonferroni") else graph_test_shortcut(graph, p = p, alpha = alpha)
  got <- as.logical(unname(res$outputs$rejected))
  cat("\n==", name, "==\n")
  print(data.frame(hypothesis = names(graph$hypotheses), p = p, rejected = got, paper = expected))
  stopifnot(identical(got, expected))
  cat("OK\n")
}
# p(1) = p2 = 0.015, p(2) = 0.02, p(3) = 0.06 > alpha
cases <- list(list(p = c(0.02, 0.015, 0.06), want = c(FALSE, TRUE, FALSE), name = "p2 < p1 < p3: H2 only"),
              list(p = c(0.06, 0.015, 0.02), want = c(FALSE, TRUE, TRUE), name = "p2 < p3 < p1: H2 and H3"))
for (cs in cases) {
  check_rejections(paste("Fallback,", cs$name), fallback, cs$p, 0.05, cs$want)
  check_rejections(paste("WD shortcut,", cs$name), wd, cs$p, 0.05, cs$want)
  check_rejections(paste("WD closed test,", cs$name), wd, cs$p, 0.05, cs$want, closure = TRUE)
  res <- graph_test_shortcut(holm3, p = cs$p, alpha = 0.05)
  n_holm <- sum(as.logical(unname(res$outputs$rejected)))
  cat(sprintf("Holm, %s: %d rejections (paper: 2)\n", cs$name, n_holm))
  stopifnot(n_holm == 2)
}

# 3. n = 2, pp. 661-662: fallback(2) and weighted Holm, w = (1/2, 1/2) -----------
fallback2 <- graph_create(c(1/2, 1/2), rbind(c(0, 1), c(0, 0)), c("H1", "H2"))
holm2 <- graph_create(c(1/2, 1/2), rbind(c(0, 1), c(1, 0)), c("H1", "H2"))
check_rejections("n = 2, fallback, p = (0.04, 0.02): H2 only", fallback2, c(0.04, 0.02), 0.05, c(FALSE, TRUE))
check_rejections("n = 2, weighted Holm (= WD), p = (0.04, 0.02): both", holm2, c(0.04, 0.02), 0.05, c(TRUE, TRUE))

cat("\nAll Hommel and Bretz (2008) section 4 checks passed.\n")
