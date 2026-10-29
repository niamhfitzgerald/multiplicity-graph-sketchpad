# Cross-check of the 27 October 2026 methods check against graphicalMCP
# --------------------------------------------------------------------------
# The worked examples behind self-tests S1, S2 and S7 (Sketchpad 1.3.4) and the
# related checks from claude/methods-check-inventory-2026-10-27-papers.md.
# Each value printed by the Sketchpad engine is written beside the call; the
# script stops at the first mismatch.
#
# Papers: Wang and Ting (2014), Figs. 2 and 3 and Table 1; Gou (2024), p. 98;
# Robertson, Wason and Bretz (2020), Fig. 4; Wang et al. (2015), Table 1, p. 19
# and Example 1, p. 15; Zhang, Quan, Ng and Stepanavage (1997), Table 6, p. 218;
# Gordi and Khamis (2004), Table II, p. 783.
#
# Uses only graph_create, graph_test_shortcut, graph_test_closure and
# graph_update, with the fields $outputs$rejected, $outputs$adjusted_p,
# $updated_graph$hypotheses and $updated_graph$transitions, as the other
# R/validate-*.R scripts do. Run on 29 October 2026 with graphicalMCP 0.3.0.9000:
# every check passed.

library(graphicalMCP)
set.seed(2009)
ok <- function(cond, what) { if (!isTRUE(cond)) stop("Mismatch: ", what); cat("OK:", what, "\n") }
rej <- function(r) paste(names(r)[r], collapse = ",")
close_to <- function(a, b, tol) isTRUE(all(abs(unname(a) - b) <= tol))

## Wang and Ting (2014), Fig. 2, p. 4: gatekeeping graph, alpha 0.05
w <- c(1/2, 1/2, 0, 0, 0, 0)
G <- matrix(0, 6, 6)
G[1, 3] <- G[1, 4] <- 1/2; G[3, 4] <- G[4, 3] <- 1
G[2, 5] <- G[2, 6] <- 1/2; G[5, 6] <- G[6, 5] <- 1
g2 <- graph_create(w, G, paste0("H", 1:6))
p <- c(0.005, 0.027, 0.020, 0.009, 0.133, 0.018)
ok(rej(graph_test_shortcut(g2, p, alpha = 0.05)$outputs$rejected) == "H1,H3,H4", "Wang and Ting Fig. 2 rejects H1, H3, H4")
# Hochberg-type test within {H3, H4} (p. 3): graphicalMCP's grouped Simes is Bretz et al. (2011) eq. 8,
# which rejects H1, H3, H4 as the paper does. The Sketchpad's "Simes within groups" follows gMCP and rejects
# H1 only here: a stated difference (00-START-HERE, method decisions), not an error.
pc <- c(0.005, 0.027, 0.020, 0.024, 0.133, 0.018)
r <- graph_test_closure(g2, pc, alpha = 0.05, test_groups = list(1, 2, 3:4, 5:6), test_types = c("bonferroni", "bonferroni", "simes", "simes"))
ok(rej(r$outputs$rejected) == "H1,H3,H4", "Wang and Ting Fig. 2, Simes in families (eq. 8): H1, H3, H4")

## Wang and Ting (2014), Fig. 3, p. 4 and Table 1, p. 5
G3 <- matrix(0, 6, 6)
G3[1, 3] <- G3[1, 4] <- 1/2; G3[3, 4] <- G3[4, 3] <- 1/2; G3[3, 2] <- G3[4, 2] <- 1/2
G3[2, 5] <- G3[2, 6] <- 1/2; G3[5, 6] <- G3[6, 5] <- 1/2; G3[5, 1] <- G3[6, 1] <- 1/2
g3 <- graph_create(w, G3, paste0("H", 1:6))
ok(close_to(graph_test_shortcut(g3, p, alpha = 0.05)$outputs$adjusted_p, c(0.01, 0.0432, 0.16 / 3, 0.036, 0.133, 0.16 / 3), 1e-9), "Wang and Ting Fig. 3 adjusted p")
ok(close_to(graph_update(g3, delete = c(TRUE, FALSE, FALSE, TRUE, FALSE, FALSE))$updated_graph$hypotheses, c(0, 5/8, 3/8, 0, 0, 0), 1e-12), "Wang and Ting Fig. 3 after H1 and H4: H2 5/8, H3 3/8")

## Gou (2024), p. 98
g4 <- graph_create(c(0.5, 0.3, 0.2), rbind(c(0, 3/5, 2/5), c(2/3, 0, 1/3), c(1/2, 1/2, 0)), c("H1", "H2", "H3"))
ok(rej(graph_test_shortcut(g4, c(0.020, 0.025, 0.060), alpha = 0.05)$outputs$rejected) == "H1,H2", "Gou p. 98 rejects H1, H2")
ok(close_to(graph_update(g4, delete = c(FALSE, FALSE, TRUE))$updated_graph$hypotheses, c(0.6, 0.4, 0), 1e-12), "Gou p. 98 after H3: 0.6, 0.4")

## Robertson, Wason and Bretz (2020), Fig. 4, families expanded, epsilon 1e-6
e <- 1e-6
G7 <- matrix(0, 7, 7)
G7[1, 2] <- 3/4; G7[1, 4] <- G7[1, 5] <- 1/8; G7[2, 3] <- 3/4; G7[2, 6] <- G7[2, 7] <- 1/8; G7[3, 1] <- 1
G7[4, 5] <- G7[5, 4] <- 1 - e; G7[4, 2] <- G7[5, 2] <- e; G7[6, 7] <- G7[7, 6] <- 1 - e; G7[6, 1] <- G7[7, 1] <- e
g7 <- graph_create(c(1/2, 1/2, 0, 0, 0, 0, 0), G7, c("H1", "H2", "H3", "H41", "H42", "H51", "H52"))
ok(rej(graph_test_shortcut(g7, c(0.1, 0.007, 0.05, 0.0015, 0.04, 0.0031, 0.001), alpha = 0.025)$outputs$rejected) == "H2,H51,H52", "Robertson Fig. 4 rejects H2, H51, H52")
u <- graph_update(g7, delete = c(FALSE, TRUE, FALSE, FALSE, FALSE, TRUE, TRUE))$updated_graph
ok(close_to(u$hypotheses, c(5/8, 0, 3/8, 0, 0, 0, 0), 1e-9), "Robertson Fig. 4 updated weights")
ok(close_to(u$transitions[1, c(3, 4, 5)], c(9/13, 2/13, 2/13), 1e-6) && u$transitions[3, 1] == 1, "Robertson Fig. 4 updated transitions")

## Wang et al. (2015), Table 1, p. 19: four procedures, five p-vectors, alpha 0.05
L4 <- c("H1", "H2", "H3", "H4")
g3a <- graph_create(c(.5, .5, 0, 0), rbind(c(0, 0, 1, 0), c(0, 0, 0, 1), c(0, 0, 0, 0), c(0, 0, 0, 0)), L4)
gpar <- graph_create(c(.5, .5, 0, 0), rbind(c(0, 0, .5, .5), c(0, 0, .5, .5), c(0, 0, 0, 1), c(0, 0, 1, 0)), L4)
eps <- 0.001
gser <- graph_create(c(.5, .5, 0, 0), rbind(c(0, 1 - eps, eps, 0), c(1 - eps, 0, 0, eps), c(0, 0, 0, 1), c(0, 0, 1, 0)), L4)
g3b <- graph_create(c(.5, .5, 0, 0), rbind(c(0, 0, 1, 0), c(0, 0, 0, 1), c(0, 1, 0, 0), c(1, 0, 0, 0)), L4)
rows <- rbind(c(.02, .015, .012, .04), c(.02, .04, .012, .024), c(.02, .06, .012, .024), c(.02, .04, .04, .024), c(.02, .04, .024, .04))
# Row 5 under serial gatekeeping is printed as H1 only in the paper; all four is right (Holm in each family).
want <- list(c("H1,H2,H3", "H1,H2,H3,H4", "H1,H2,H3,H4", "H1,H2,H3,H4"), c("H1,H3", "H1,H3,H4", "H1,H2,H3,H4", "H1,H2,H3,H4"),
             c("H1,H3", "H1,H3,H4", "H1", "H1,H3"), c("H1", "H1", "H1,H2,H3,H4", "H1"), c("H1,H3", "H1", "H1,H2,H3,H4", "H1,H2,H3,H4"))
gs <- list(g3a, gpar, gser, g3b)
for (i in 1:5) for (k in 1:4) ok(rej(graph_test_shortcut(gs[[k]], rows[i, ], alpha = 0.05)$outputs$rejected) == want[[i]][k], sprintf("Wang et al. Table 1, row %d, procedure %d", i, k))

holm <- function(m) { G <- matrix(1 / (m - 1), m, m); diag(G) <- 0; graph_create(rep(1 / m, m), G, paste0("H", 1:m)) }
## Wang et al. (2015), Example 1, p. 15, with p(1) = 0.026: Simes closure on Holm(2)
r <- graph_test_closure(holm(2), c(.04, .026), alpha = .05, test_groups = list(1:2), test_types = "simes")
ok(close_to(r$outputs$adjusted_p, c(0.04, 0.04), 1e-9) && all(r$outputs$rejected), "Wang et al. Example 1: both rejected, adjusted p 0.04")

## Zhang, Quan, Ng and Stepanavage (1997), Table 6, p. 218
pz <- c(.0037, .0077, .0274, .0369)
w <- c(1, 1, 2, 1) / 5; G <- outer(1 / (1 - w), w); diag(G) <- 0
gw <- graph_create(w, G, c("FEV1", "PEFR", "SS", "AMU"))
ok(all(graph_test_shortcut(gw, pz, alpha = .05)$outputs$rejected), "Zhang weighted Holm rejects all four")
r <- graph_test_closure(gw, pz, alpha = .05, test_groups = list(1:4), test_types = "bonferroni")
ok(close_to(r$outputs$adjusted_p, c(0.0185, 0.0308, 0.0411, 0.0411), 5e-5), "Zhang weighted Holm adjusted p")
r <- graph_test_closure(holm(4), pz, alpha = .05, test_groups = list(1:4), test_types = "simes")
ok(close_to(r$outputs$adjusted_p, c(0.0148, 0.0231, 0.0369, 0.0369), 5e-5) && all(r$outputs$rejected), "Zhang Simes closure on Holm(4)")
R <- rbind(c(1, .25, .31, .24), c(.25, 1, .42, .43), c(.31, .42, 1, .67), c(.24, .43, .67, 1))
r <- graph_test_closure(holm(4), pz / 2, alpha = .025, test_groups = list(1:4), test_types = "parametric", test_corr = list(R))
ok(close_to(r$outputs$adjusted_p, c(0.00683, 0.0105, 0.0238, 0.0238), 2e-4) && all(r$outputs$rejected), "Zhang parametric closure on Holm(4) (Monte Carlo, tolerance 0.0002)")

## Gordi and Khamis (2004), Table II, p. 783
r <- graph_test_closure(holm(4), c(.008, .015, .043, .048), alpha = .05, test_groups = list(1:4), test_types = "simes")
ok(close_to(r$outputs$adjusted_p, c(0.03, 0.045, 0.048, 0.048), 1e-9) && all(r$outputs$rejected), "Gordi and Khamis Table II")

cat("\nAll methods-check cross-checks passed.\n")
