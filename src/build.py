import pathlib
d = pathlib.Path(__file__).parent
head = (d / 'head.html').read_text()
js = (d / 'core.js').read_text() + '\n' + (d / 'ui.js').read_text()
body = head + '\n<script>\n' + js + '\n</script>\n'
(d / 'multiplicity-graph-sketchpad-artifact.html').write_text(body)
title_end = head.rindex('</style>', 0, head.index('<div class="app"')) + len('</style>')
standalone = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
              '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
              + head[:title_end] + '\n</head>\n<body>\n' + head[title_end:] + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n')
(d / 'multiplicity-graph-sketchpad.html').write_text(standalone)
print(len(body), len(standalone))
