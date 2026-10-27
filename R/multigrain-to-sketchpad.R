# sketchpad_json(): write a multigrain optimised graph (or a gMCP graphMCP object) as JSON for the
# Multiplicity Graph Sketchpad ("Export > Open a saved graph", file or paste).
#
# Fields read from the graph_optimise() result (multigrain 1.0.0; also 0.3.0): $hyp_weight and
# $trans_matrix for the graph, and, when present, $power (trial_success, local_power, exp_rejections,
# disj_power, conj_power), $solution (opt_source, graph_valid), $trial_success$objective and
# $global_search for the optional "optimisation" block. Layouts were read from a real run on
# 27 October 2026. A plain list(w = , G = ) is accepted too.
#
# Names: multigrain matches by position, so the result usually carries no
# hypothesis names. Give them with `names`, or they default to H1, H2, ...
#
# Format written:
# {
#   "format": "multiplicity-graph", "version": 1, "source": "multigrain 1.0.0",
#   "alpha": 0.025,
#   "hypotheses": [ {"name": "H1", "label": "Dose 1, primary", "weight": 0.5, "group": "primary"}, ... ],
#   "transitions": [[0, 0.9, 0.1, 0], ...],       rows = from, columns = to, same order as hypotheses
#   "optimisation": { ... }                        optional; only for a graph_optimise() result
# }
# "label" and "group" are optional (one per hypothesis). The optimisation block holds the gain function,
# multigrain's expected gain on its own sample, the local powers, where the solution came from, the
# inputs (`inputs`: power_nominal, corr_matrix, nsim) and the starting graph (`start`: hyp_weight,
# trans_matrix), so the Sketchpad can re-estimate the gain on a fresh sample and compare the two graphs.
# Note that the gain function may be commercially sensitive: the Sketchpad only keeps it in a saved
# file or share link when asked to.

sketchpad_json <- function(graph, alpha = 0.025, names = NULL, labels = NULL,
                           groups = NULL, file = NULL, inputs = NULL, start = NULL,
                           source = paste("multigrain", tryCatch(as.character(utils::packageVersion("multigrain")), error = function(e) ""))) {
  if (inherits(graph, "graphMCP")) {
    # A gMCP graph: numeric matrix (variables such as epsilon are replaced by 0.001)
    if (requireNamespace("gMCP", quietly = TRUE) && is.character(graph@m)) graph <- gMCP::substituteEps(gMCP::replaceVariables(graph, ask = FALSE, partial = TRUE), eps = 0.001)
    w <- graph@weights
    G <- graph@m
    if (is.character(G)) stop("The gMCP graph still contains variables; give them values with replaceVariables() first.")
    if (is.null(names)) names <- rownames(G)
  } else {
    w <- if (!is.null(graph$hyp_weight)) graph$hyp_weight else graph$w
    G <- if (!is.null(graph$trans_matrix)) graph$trans_matrix else graph$G
  }
  if (is.null(w) || is.null(G)) stop("Expected a graph_optimise() result with $hyp_weight and $trans_matrix, a list(w = , G = ), or a gMCP graphMCP object.")
  w <- as.numeric(w); G <- as.matrix(G)
  m <- length(w)
  if (!all(dim(G) == c(m, m))) stop("The transition matrix must be ", m, " x ", m, ".")
  if (is.null(names)) {
    names <- if (!is.null(names(graph$hyp_weight))) names(graph$hyp_weight)
             else if (!is.null(rownames(G))) rownames(G)
             else paste0("H", seq_len(m))
  }
  if (length(names) != m) stop("`names` must have one entry per hypothesis.")
  if (!is.null(labels) && length(labels) != m) stop("`labels` must have one entry per hypothesis.")
  if (!is.null(groups) && length(groups) != m) stop("`groups` must have one entry per hypothesis.")

  hyps <- lapply(seq_len(m), function(i) {
    h <- list(name = names[i], weight = unname(w[i]))
    if (!is.null(labels)) h$label <- labels[i]
    if (!is.null(groups)) h$group <- groups[i]
    h
  })
  obj <- list(format = "multiplicity-graph", version = 1L, source = trimws(source),
              alpha = alpha, hypotheses = hyps,
              transitions = lapply(seq_len(m), function(i) unname(G[i, ])))

  # The optional optimisation block, from a graph_optimise() result (fields missing in older versions are left out)
  pw <- if (is.list(graph) && !inherits(graph, "graphMCP")) graph$power else NULL
  sol <- if (is.list(graph) && !inherits(graph, "graphMCP")) graph$solution else NULL
  if (!is.null(pw) || !is.null(sol) || !is.null(inputs) || !is.null(start)) {
    num1 <- function(x) if (is.null(x) || length(x) != 1 || is.na(x)) NULL else unname(as.numeric(x))
    opt <- list(package = trimws(source))
    gain <- graph$trial_success$objective
    if (!is.null(gain) && is.character(gain)) opt$gain <- gain[1]
    if (!is.null(pw)) {
      opt$expected_gain <- num1(pw$trial_success)
      if (!is.null(pw$local_power)) opt$local_power <- unname(as.numeric(pw$local_power))
      opt$expected_rejections <- num1(pw$exp_rejections)
      opt$disjunctive_power <- num1(pw$disj_power)
      opt$conjunctive_power <- num1(pw$conj_power)
    }
    if (!is.null(sol)) {
      if (!is.null(sol$opt_source)) opt$opt_source <- as.character(sol$opt_source)[1]
      gv <- sol$graph_valid
      if (!is.null(gv)) opt$graph_valid <- lapply(stats::setNames(as.list(gv), names(gv)), function(v) if (is.na(v)) NULL else as.logical(v))
    }
    if (!is.null(graph$global_search) && !is.na(graph$global_search)) opt$global_search <- as.logical(graph$global_search)
    if (!is.null(inputs)) {
      inp <- list()
      if (!is.null(inputs$power_nominal)) inp$power_nominal <- unname(as.numeric(inputs$power_nominal))
      if (!is.null(inputs$corr_matrix)) { cm <- as.matrix(inputs$corr_matrix); inp$corr_matrix <- lapply(seq_len(nrow(cm)), function(i) unname(cm[i, ])) }
      if (!is.null(inputs$nsim)) inp$nsim <- num1(inputs$nsim)
      opt$inputs <- inp
    }
    if (!is.null(start) && !is.null(start$hyp_weight) && !is.null(start$trans_matrix)) {
      sm <- as.matrix(start$trans_matrix)
      opt$start <- list(weights = unname(as.numeric(start$hyp_weight)), transitions = lapply(seq_len(nrow(sm)), function(i) unname(sm[i, ])))
    }
    obj$optimisation <- opt
  }
  txt <- jsonlite::toJSON(obj, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null")
  if (!is.null(file)) writeLines(txt, file)
  invisible(txt)
}

# Example -------------------------------------------------------------------
# g <- readRDS("optimised_graph.rds")        # a graph_optimise() result
# sketchpad_json(g, alpha = 0.025,
#                names  = c("H1", "H2", "H3", "H4"),
#                labels = c("Dose 1, primary", "Dose 1, secondary", "Dose 2, primary", "Dose 2, secondary"),
#                groups = c("primary", "secondary", "primary", "secondary"),
#                inputs = list(power_nominal = c(0.9, 0.9, 0.8, 0.8), corr_matrix = diag(4), nsim = 1e5),
#                file   = "optimised_graph.json")
#
# Without a file name it returns the JSON text, which you can paste into the
# Sketchpad: cat(sketchpad_json(g))
#
# The Sketchpad's Optimise tab writes a complete script that calls this function.
#
# Any gMCP example graph works too:
# cat(sketchpad_json(gMCP::HommelEtAl2007(), alpha = 0.025))
