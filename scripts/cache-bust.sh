#!/usr/bin/env bash
# cache-bust.sh - append a content-hash ?v= to every local css/ and js/
# reference in the site's HTML pages, so a deploy invalidates the browser and
# CDN cache for exactly the assets that changed. Without this, GitHub Pages
# serves stale CSS/JS for the length of its edge TTL and browsers hold it even
# longer, so a style or script change does not show up until a hard refresh.
#
# Idempotent: re-running with no asset changes rewrites nothing. Run it before
# committing CSS/JS changes (it is wired into `make build`).
#
# Known limitation: this versions the entry references in HTML (each page's
# stylesheet, classic scripts, and module entry). It does NOT version relative
# `import ... from './x.js'` statements inside the ES modules, so a change to a
# deeply-imported module that does not also change its entry can still be
# cached. Tracked for a follow-up (full module-graph hashing).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, hashlib, glob, os

# Matches src="css/..." / href="js/..." with an optional existing ?v=.
REF = re.compile(r'(?P<attr>src|href)="(?P<path>(?:css|js)/[^"?]+)(?:\?v=[a-f0-9]+)?"')

def digest(path):
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]

changed = []
for html in sorted(glob.glob('*.html')):
    src = open(html, encoding='utf-8').read()

    def repl(m):
        path = m.group('path')
        if not os.path.isfile(path):
            return m.group(0)  # leave references to non-existent files untouched
        return f'{m.group("attr")}="{path}?v={digest(path)}"'

    out = REF.sub(repl, src)
    if out != src:
        open(html, 'w', encoding='utf-8').write(out)
        changed.append(html)

if changed:
    print(f"cache-bust: updated {len(changed)} page(s): {', '.join(changed)}")
else:
    print("cache-bust: all pages already current, nothing to do.")
PY
