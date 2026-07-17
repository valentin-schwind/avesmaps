#!/usr/bin/env python3
"""Stamp per-file content hashes into every local JS/CSS reference of the app.

Rewrites `<script src>` / `<link href>` references in HTML files AND `@import url(...)` lines in CSS
files to carry a `?v=<sha1-prefix>` derived from the referenced file's content. The server can then
long-cache those assets ("immutable", see .htaccess) while end users still receive fresh files the
moment their content changes -- no hard reload, and nothing to bump by hand.

Usage:
    stamp-asset-versions.py --asset-root <dir> --deploy-dir <dir> <entry> [<entry> ...]

  --asset-root  The repo checkout. Referenced paths resolve against it and are hashed from it.
  --deploy-dir  Where stamped files are written (the deploy package). Entry points are always
                written; other files only if stamping actually changed them.
  <entry>       Repo-relative files to stamp, e.g. index.html html/citymap-editor.html.
                Their whole reference tree is followed and stamped with them.

THE CHAIN, AND WHY ORDER MATTERS
    index.html -> css/styles.css -> base/tokens.css (+37 more) -> ...
Only 9 stylesheets hang directly in index.html; the rest hang behind css/styles.css. A file's hash
must be computed from its content AFTER its own references were stamped -- otherwise index.html would
carry the hash of the *original* styles.css, the browser would keep serving its cached copy, and it
would never see the new import URLs. The chain would look stamped and be silently broken, pinning
users to old CSS for up to a year. `content()` is therefore recursive and memoised: asking for a
file's bytes transparently stamps everything below it first.

Anything not local js/css (external URLs, images) is left untouched, as are references to files that
do not exist -- no ?v= means `no-cache`, which is slow but never stale. Inventing a hash for a missing
file would pin users to a 404 for a year.

See docs/asset-caching-and-versioning.md; tests in __tests__/stamp-asset-versions.test.py.
"""

import argparse
import hashlib
import os
import re
import sys

TAG_RE = re.compile(r"<(?:script|link)\b[^>]*>", re.IGNORECASE)
# Leading "/" is optional: index.html uses repo-relative paths, the html/ sub-pages absolute ones.
ATTR_RE = re.compile(
    r'(?P<attr>\b(?:src|href))="'
    r'(?P<path>/?(?:js|css|assets)/[^"?]+\.(?:js|css))'
    r'(?:\?[^"]*)?"'
)
IMPORT_RE = re.compile(
    r'(?P<head>@import\s+url\(\s*(?P<quote>["\']))'
    r'(?P<path>[^"\'?)]+\.css)'
    r'(?:\?[^"\')]*)?'
    r'(?P<tail>(?P=quote)\s*\))'
)


class Stamper:
    def __init__(self, asset_root, deploy_dir):
        self.asset_root = asset_root
        self.deploy_dir = deploy_dir
        self._content = {}
        self._rewritten = set()
        self.stats = {"stamped": 0, "missing": 0, "files": 0}

    def _abs(self, rel):
        return os.path.join(self.asset_root, rel.replace("/", os.sep))

    def content(self, rel):
        """Bytes of `rel` after stamping its own references. Memoised and cycle-safe."""
        if rel in self._content:
            return self._content[rel]
        # Guard first: a cyclic re-entry sees None and leaves that one edge unstamped (no-cache =
        # safe) instead of recursing forever.
        self._content[rel] = None
        try:
            with open(self._abs(rel), "rb") as handle:
                raw = handle.read()
        except OSError:
            return None
        out = self._rewrite(rel, raw)
        self._content[rel] = out
        return out

    def digest(self, rel):
        data = self.content(rel)
        if data is None:
            return None
        return hashlib.sha1(data).hexdigest()[:10]

    def _resolve(self, rel, ref):
        """Resolve a reference against the file it appears in. Absolute refs are repo-root-relative."""
        if ref.startswith("/"):
            return ref.lstrip("/")
        joined = os.path.join(os.path.dirname(rel), ref)
        return os.path.normpath(joined).replace(os.sep, "/")

    def _stamp_ref(self, rel, ref):
        """Return the ?v=-carrying URL for `ref` as written inside `rel`, or None to leave it alone."""
        target = self._resolve(rel, ref)
        digest = self.digest(target)
        if not digest:
            self.stats["missing"] += 1
            sys.stderr.write("warning: referenced asset not found, left unversioned: %s\n" % target)
            return None
        self.stats["stamped"] += 1
        return "%s?v=%s" % (ref, digest)

    def _rewrite(self, rel, raw):
        ext = os.path.splitext(rel)[1].lower()
        if ext in (".html", ".htm"):
            rewriter = self._rewrite_html
        elif ext == ".css":
            rewriter = self._rewrite_css
        else:
            return raw

        text = raw.decode("utf-8")
        new_text = rewriter(rel, text)
        if new_text == text:
            return raw
        self._rewritten.add(rel)
        return new_text.encode("utf-8")

    def _rewrite_html(self, rel, text):
        def attr(match):
            url = self._stamp_ref(rel, match.group("path"))
            if url is None:
                return match.group(0)
            return '%s="%s"' % (match.group("attr"), url)

        return TAG_RE.sub(lambda tag: ATTR_RE.sub(attr, tag.group(0)), text)

    def _rewrite_css(self, rel, text):
        def imp(match):
            url = self._stamp_ref(rel, match.group("path"))
            if url is None:
                return match.group(0)
            return "%s%s%s" % (match.group("head"), url, match.group("tail"))

        return IMPORT_RE.sub(imp, text)

    def write(self, entry_points):
        """Write every rewritten file plus the entry points into the deploy dir."""
        for rel in sorted(self._rewritten | {e for e in entry_points if self._content.get(e)}):
            data = self._content.get(rel)
            if data is None:
                continue
            path = os.path.join(self.deploy_dir, rel.replace("/", os.sep))
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(data)
            self.stats["files"] += 1


def stamp_tree(asset_root, deploy_dir, entry_points):
    """Stamp `entry_points` and everything they reference. Returns the stats dict."""
    stamper = Stamper(asset_root, deploy_dir)
    for rel in entry_points:
        if stamper.content(rel) is None:
            sys.stderr.write("warning: entry point not found: %s\n" % rel)
    stamper.write(entry_points)
    return stamper.stats


def main():
    parser = argparse.ArgumentParser(description="Stamp content-hash ?v= into local JS/CSS references.")
    parser.add_argument("--asset-root", required=True, help="repo checkout the paths resolve against")
    parser.add_argument("--deploy-dir", required=True, help="deploy package to write stamped files into")
    parser.add_argument("entries", nargs="+", help="repo-relative entry points (e.g. index.html)")
    args = parser.parse_args()

    stats = stamp_tree(args.asset_root, args.deploy_dir, args.entries)
    print("stamped %d reference(s) across %d file(s) (%d missing)"
          % (stats["stamped"], stats["files"], stats["missing"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
