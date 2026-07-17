#!/usr/bin/env python3
"""Prove the deploy package's cache-busting chain is intact. Fails the deploy if it is not.

Usage:
    verify-stamped-chain.py --asset-root <dir> --deploy-dir <dir> <entry> [<entry> ...]

Walks the same reference tree stamp-asset-versions.py just stamped and re-derives every hash from the
bytes that will actually be served. Reports a reference whose ?v= does not match those bytes, and one
that carries no ?v= at all although the file exists.

WHY THIS EXISTS
A broken chain has no symptom: the deploy is green, the file on the server is correct, and .htaccess
serves anything with a ?v= as immutable for a year -- so users silently keep old CSS and nobody finds
out until someone wonders why a token "won't apply". This guard turns that silent, months-long
failure into a loud, immediate one.

It deliberately looks WIDER than the stamper: any `@import` spelling counts here, not just the
`url("...")` form the stamper rewrites. An import the stamper's regex does not know would otherwise
sail through unstamped and quietly lose its caching. Sharing the stamper's regexes would mean
checking its work with its own blind spots.

A reference to a file that does not exist is NOT an error: the stamper leaves it unversioned on
purpose, and unversioned means no-cache -- slow, but never stale.

See docs/asset-caching-and-versioning.md; tests in __tests__/verify-stamped-chain.test.py.
"""

import argparse
import hashlib
import os
import re
import sys

TAG_RE = re.compile(r"<(?:script|link)\b[^>]*>", re.IGNORECASE)
HTML_REF_RE = re.compile(
    r'\b(?:src|href)="'
    r'(?P<path>/?(?:js|css|assets)/[^"?]+\.(?:js|css))'
    r'(?:\?v=(?P<version>[^"&]*))?'
    r'[^"]*"'
)
# Wider than the stamper on purpose: url() optional, quotes optional.
CSS_REF_RE = re.compile(
    r'@import\s+(?:url\(\s*)?["\']?'
    r'(?P<path>[^"\')\s;]+\.css)'
    r'(?:\?v=(?P<version>[^"\')\s;]*))?'
)


def _rel_to_os(rel):
    return rel.replace("/", os.sep)


def verify_chain(asset_root, deploy_dir, entry_points):
    """Return a list of human-readable problems. Empty list = the chain is intact."""
    problems = []
    visited = set()

    def served_path(rel):
        """The bytes a user actually gets: the stamped copy if the package has one, else the repo's."""
        in_deploy = os.path.join(deploy_dir, _rel_to_os(rel))
        if os.path.isfile(in_deploy):
            return in_deploy
        in_repo = os.path.join(asset_root, _rel_to_os(rel))
        return in_repo if os.path.isfile(in_repo) else None

    def digest(rel):
        path = served_path(rel)
        if path is None:
            return None
        with open(path, "rb") as handle:
            return hashlib.sha1(handle.read()).hexdigest()[:10]

    def resolve(rel, ref):
        if ref.startswith("/"):
            return ref.lstrip("/")
        joined = os.path.join(os.path.dirname(rel), ref)
        return os.path.normpath(joined).replace(os.sep, "/")

    def references(rel, text):
        ext = os.path.splitext(rel)[1].lower()
        if ext in (".html", ".htm"):
            for tag in TAG_RE.finditer(text):
                for match in HTML_REF_RE.finditer(tag.group(0)):
                    yield match.group("path"), match.group("version")
        elif ext == ".css":
            for match in CSS_REF_RE.finditer(text):
                yield match.group("path"), match.group("version")

    def walk(rel):
        if rel in visited:
            return
        visited.add(rel)
        path = served_path(rel)
        if path is None or os.path.splitext(rel)[1].lower() not in (".html", ".htm", ".css"):
            return
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()

        for ref, version in references(rel, text):
            target = resolve(rel, ref)
            actual = digest(target)
            if actual is None:
                continue  # missing file: unversioned on purpose, no-cache, never stale
            if version is None:
                problems.append("%s: %s carries no ?v= although the file exists" % (rel, ref))
            elif version != actual:
                problems.append(
                    "%s: %s?v=%s but the served file hashes to %s" % (rel, ref, version, actual)
                )
            walk(target)

    for entry in entry_points:
        walk(entry)
    return problems


def main():
    parser = argparse.ArgumentParser(description="Verify the deploy package's cache-busting chain.")
    parser.add_argument("--asset-root", required=True)
    parser.add_argument("--deploy-dir", required=True)
    parser.add_argument("entries", nargs="+")
    args = parser.parse_args()

    problems = verify_chain(args.asset_root, args.deploy_dir, args.entries)
    if problems:
        sys.stderr.write("Cache-busting chain is BROKEN -- refusing to deploy:\n")
        for problem in problems:
            sys.stderr.write("  %s\n" % problem)
        sys.stderr.write(
            "\nUsers would silently keep the old files for up to a year.\n"
            "See docs/asset-caching-and-versioning.md.\n"
        )
        return 1
    print("cache-busting chain verified: every reference matches the bytes being served")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
