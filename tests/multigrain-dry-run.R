# Dry run of a script written by the Sketchpad's Optimise tab, without the compiled multigrain package.
#
# Usage: Rscript multigrain-dry-run.R <script.R> <path to multigrain's R/ folder>
#
# What it checks:
#   * the script parses as R;
#   * every argument the script passes exists in multigrain 1.0.0's signatures (read from its R sources);
#   * graph_constraint() runs multigrain's own validation code (R/graph_constraint.R and the
#     *_validation.R files, which are plain R), so a constraint the package would refuse fails here too;
#   * the gain function is read by multigrain's own replace_r_indices() and count_unique_indices();
#   * sketchpad_json() (copied into the script) writes the exchange JSON from a stand-in result whose
#     $hyp_weight and $trans_matrix are the start graph, and the JSON is printed for the caller to check.
# Stubs replace only simulate_pvalues(), trial_success() (the C++ compile) and graph_optimise() (the search).
# Needs: cli, rlang, vctrs, purrr, glue, jsonlite.

args <- commandArgs(TRUE)
script_file <- args[1]
mg_r <- args[2]
if (is.na(script_file) || is.na(mg_r)) stop("Usage: Rscript multigrain-dry-run.R <script.R> <multigrain/R>")

src_no_roxygen <- function(f) {
  src <- readLines(file.path(mg_r, f))
  src <- src[!grepl("^#'", src)]
  # Older rlang releases (such as 1.1.3) have check_number_whole() and friends but do not export them
  src <- gsub("rlang::(check_number_whole|check_number_decimal|check_string|check_bool)\\(", "rlang:::\\1(", src)
  eval(parse(text = src), envir = globalenv())
}
# multigrain's own helpers and validators (plain R); import-standalone files give check_double() etc.
for (f in c("import-standalone-obj-type.R", "import-standalone-types-check.R", "check_equal.R", "check_types.R",
            "check_dims.R", "utils_verbosity.R", "hyp_constraint_validation.R", "trans_constraint_validation.R",
            "graph_constraint_validation.R", "graph_constraint.R", "trial_success.R")) {
  ok <- tryCatch({ src_no_roxygen(f); TRUE }, error = function(e) { message("could not source ", f, ": ", conditionMessage(e)); FALSE })
  if (!ok) quit(status = 2)
}
info_diagnose <- "Run with diagnose = TRUE for details."

# Stubs for the compiled and search parts, with multigrain 1.0.0's argument names (R/sim_pvals.R, R/trial_success.R,
# R/optimisation.R). Any other argument name is an error, as it would be in the package (check_dots_empty).
simulate_pvalues <- function(power_nominal, ..., alpha = 0.025, corr_matrix = diag(length(power_nominal)), nsim = 1e5) {
  rlang::check_dots_empty()
  stopifnot(is.numeric(power_nominal), all(power_nominal > 0 & power_nominal < 1))
  stopifnot(is.matrix(corr_matrix), all(dim(corr_matrix) == length(power_nominal)), all(diag(corr_matrix) == 1), isSymmetric(corr_matrix))
  stopifnot(nsim >= 1)
  structure(matrix(runif(2 * length(power_nominal)), nrow = 2), nsim = nsim)
}
trial_success <- function(objective, verbose = "silent") {
  expr_string <- if (is.character(objective)) objective else deparse1(substitute(objective))
  m <- count_unique_indices(expr_string)
  cpp <- replace_r_indices(expr_string)
  structure(list(func = NULL, m = m, objective = expr_string, cpp_code = cpp), class = "multigrain_trial_success")
}
graph_optimise <- function(pvals, graph_constraint, trial_success, ..., alpha = 0.025, start_graph = list(list(hyp_weight = NULL, trans_matrix = NULL)),
                           global_search = TRUE, num_threads = 1L, control = NULL, verbose = "silent") {
  rlang::check_dots_empty()
  stopifnot(inherits(graph_constraint, "multigrain_graph_constraint"), inherits(trial_success, "multigrain_trial_success"))
  m <- length(graph_constraint$hyp_constraint)
  if (trial_success$m != ncol(pvals)) stop("trial_success m (", trial_success$m, ") must equal the number of columns of pvals (", ncol(pvals), ")")
  stopifnot(is.logical(global_search), is.integer(num_threads), num_threads >= 1)
  sg <- start_graph[[1]]
  if (!is.null(sg$hyp_weight)) {
    stopifnot(length(sg$hyp_weight) == m, all(dim(sg$trans_matrix) == c(m, m)))
    w <- sg$hyp_weight; G <- sg$trans_matrix
  } else { w <- rep(1 / m, m); G <- matrix(1 / (m - 1), m, m); diag(G) <- 0 }
  names(w) <- attr(graph_constraint, "names")
  # $power and $solution in the layout of a real multigrain 0.3.0 run (27 October 2026: str(res$power), str(res$solution))
  structure(list(hyp_weight = w, trans_matrix = G, constraints = graph_constraint, trial_success = trial_success,
                 power = list(local_power = rep(0.5, m), exp_rejections = m / 2, disj_power = 0.9, conj_power = 0.1, trial_success = 0.5),
                 solution = list(opt_source = "stub", graph_valid = c(local = TRUE, global = NA)), global_search = global_search),
            class = "multigrain_graph_optimal")
}
print.multigrain_graph_optimal <- function(x, ...) { cat("<stub multigrain_graph_optimal>\n"); invisible(x) }
library <- function(package, ...) { p <- as.character(substitute(package)); if (p != "multigrain") base::library(p, character.only = TRUE); invisible() }

# Run the script
script <- readLines(script_file)
exprs <- parse(text = script)
withCallingHandlers(
  for (e in exprs) eval(e, envir = globalenv()),
  warning = function(w) { message("WARNING: ", conditionMessage(w)); invokeRestart("muffleWarning") }
)
cat("\nDRY RUN OK: gain m =", ts$m, "; constraint m =", length(gc$hyp_constraint), "\n")
