# Cross-check of the Sketchpad's constraint rules against multigrain's own graph_constraint() validation.
#
# Usage: Rscript multigrain-constraints-check.R <cases.json> [<path to multigrain's R/ folder>]
#
# cases.json: a JSON array of {"hyp": [...], "trans": [[...], ...]} with null for a free value (NA in R).
# For each case the script calls graph_constraint() and prints one line: OK or ERROR: <message>.
# With multigrain installed it uses the package; otherwise give the path to the package's R/ folder
# (for example a clone of https://github.com/cran/multigrain) and the validation code is sourced from it
# (plain R; needs cli, rlang, vctrs, purrr, glue and jsonlite).

args <- commandArgs(TRUE)
cases_file <- args[1]
mg_r <- if (length(args) >= 2) args[2] else NA
if (is.na(cases_file)) stop("Usage: Rscript multigrain-constraints-check.R <cases.json> [<multigrain/R>]")

if (requireNamespace("multigrain", quietly = TRUE)) {
  gc_fun <- multigrain::graph_constraint
  cat("# using the installed multigrain", as.character(utils::packageVersion("multigrain")), "\n")
} else {
  if (is.na(mg_r)) stop("multigrain is not installed; give the path to its R/ folder as the second argument")
  src_no_roxygen <- function(f) {
    src <- readLines(file.path(mg_r, f))
    src <- src[!grepl("^#'", src)]
    # Older rlang releases (such as 1.1.3) have check_number_whole() and friends but do not export them
    src <- gsub("rlang::(check_number_whole|check_number_decimal|check_string|check_bool)\\(", "rlang:::\\1(", src)
    eval(parse(text = src), envir = globalenv())
  }
  for (f in c("import-standalone-obj-type.R", "import-standalone-types-check.R", "check_equal.R", "check_types.R",
              "check_dims.R", "hyp_constraint_validation.R", "trans_constraint_validation.R",
              "graph_constraint_validation.R", "graph_constraint.R")) src_no_roxygen(f)
  info_diagnose <- "Run with diagnose = TRUE for details."
  gc_fun <- graph_constraint
  cat("# using multigrain's validation code sourced from", mg_r, "\n")
}

cases <- jsonlite::fromJSON(cases_file, simplifyVector = FALSE)
to_num <- function(x) vapply(x, function(v) if (is.null(v)) NA_real_ else as.numeric(v), numeric(1))
for (cs in cases) {
  hyp <- to_num(cs$hyp)
  trans <- do.call(rbind, lapply(cs$trans, to_num))
  res <- tryCatch({ gc_fun(hyp_constraint = hyp, trans_constraint = trans); "OK" },
                  error = function(e) paste("ERROR:", gsub("\\s+", " ", conditionMessage(e))))
  cat(res, "\n")
}
