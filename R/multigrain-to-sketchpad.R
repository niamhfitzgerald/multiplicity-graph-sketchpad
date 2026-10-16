# sketchpad_json(): write a multigrain optimised graph (or a gMCP graphMCP object) as JSON for the
# Multiplicity Graph Sketchpad ("Export > Open a saved graph", file or paste).
#
# Fields read from the graph_optimise() result (multigrain 0.3.0): $hyp_weight
# and $trans_matrix. Nothing else in the result object is read. A plain
# list(w = , G = ) is accepted too.
#
# Names: multigrain matches by position, so the result usually carries no
# hypothesis names. Give them with `names`, or they default to H1, H2, ...
#
# Format written:
# {
#   "format": "multiplicity-graph", "version": 1, "source": "multigrain 0.3.0",
#   "alpha": 0.025,
#   "hypotheses": [ {"name": "H1", "label": "Dose 1, primary", "weight": 0.5, "group": "primary"}, ... ],
#   "transitions": [[0, 0.9, 0.1, 0], ...]        rows = from, columns = to, same order as hypotheses
# }
# "label" and "group" are optional (one per hypothesis).

sketchpad_json <- function(graph, alpha = 0.025, names = NULL, labels = NULL,
                           groups = NULL, file = NULL,
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
  txt <- jsonlite::toJSON(obj, auto_unbox = TRUE, digits = NA, pretty = TRUE)
  if (!is.null(file)) writeLines(txt, file)
  invisible(txt)
}

# Example -------------------------------------------------------------------
# g <- readRDS("optimised_graph.rds")        # a graph_optimise() result
# sketchpad_json(g, alpha = 0.025,
#                names  = c("H1", "H2", "H3", "H4"),
#                labels = c("Dose 1, primary", "Dose 1, secondary", "Dose 2, primary", "Dose 2, secondary"),
#                groups = c("primary", "secondary", "primary", "secondary"),
#                file   = "optimised_graph.json")
#
# Without a file name it returns the JSON text, which you can paste into the
# Sketchpad: cat(sketchpad_json(g))
#
# Any gMCP example graph works too:
# cat(sketchpad_json(gMCP::HommelEtAl2007(), alpha = 0.025))
