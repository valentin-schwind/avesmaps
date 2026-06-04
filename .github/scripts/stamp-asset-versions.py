#!/usr/bin/env python3
"""Stamp per-file content hashes into local JS/CSS references of an HTML file.

Rewrites every `<script src="js/...">` / `<link href="css/...">` reference whose
path is local (js/, css/ or assets/ and ends in .js/.css) to carry a
`?v=<sha1-prefix>` query derived from the referenced file's content. This lets
the server long-cache those assets ("immutable") while guaranteeing end users
receive fresh files the moment their content changes -- no hard reload needed.

Usage:
    stamp-asset-versions.py <html_file> <asset_root>

  html_file   The HTML file to rewrite in place (e.g. the deploy copy of index.html).
  asset_root  Directory the referenced paths are relative to (the repo checkout),
              used to read file contents for hashing. Unchanged/cached assets keep
              a stable hash, so only genuinely changed files get re-downloaded.

Only references inside <script>/<link> tags are touched (no false matches in
inline JS). External URLs (http/https/protocol-relative) and non js/css assets
are left untouched. Missing files are left untouched (no version appended).
"""

import hashlib
import os
import re
import sys

TAG_RE = re.compile(r"<(?:script|link)\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(
    r'(?P<attr>\b(?:src|href))="'
    r'(?P<path>(?:js|css|assets)/[^"?]+\.(?:js|css))'
    r'(?:\?[^"]*)?"'
)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: stamp-asset-versions.py <html_file> <asset_root>\n")
        return 2

    html_file = sys.argv[1]
    asset_root = sys.argv[2]

    with open(html_file, "r", encoding="utf-8") as handle:
        html = handle.read()

    hash_cache = {}
    stats = {"stamped": 0, "missing": 0}

    def short_hash(rel_path):
        if rel_path in hash_cache:
            return hash_cache[rel_path]
        abs_path = os.path.join(asset_root, rel_path)
        try:
            with open(abs_path, "rb") as asset_handle:
                digest = hashlib.sha1(asset_handle.read()).hexdigest()[:10]
        except OSError:
            digest = None
        hash_cache[rel_path] = digest
        return digest

    def replace_attr(match):
        rel_path = match.group("path")
        digest = short_hash(rel_path)
        if not digest:
            stats["missing"] += 1
            sys.stderr.write(f"warning: referenced asset not found, left unversioned: {rel_path}\n")
            return match.group(0)
        stats["stamped"] += 1
        return f'{match.group("attr")}="{rel_path}?v={digest}"'

    def replace_tag(match):
        return ATTR_RE.sub(replace_attr, match.group(0))

    new_html = TAG_RE.sub(replace_tag, html)

    with open(html_file, "w", encoding="utf-8") as handle:
        handle.write(new_html)

    print(f"stamped {stats['stamped']} reference(s) in {html_file} ({stats['missing']} missing)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
