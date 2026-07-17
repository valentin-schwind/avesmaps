#!/usr/bin/env python3
"""Tests for verify-stamped-chain.py -- the deploy's proof that the cache chain is intact.

Run from the repo root:

    python .github/scripts/__tests__/verify-stamped-chain.test.py

The stamper computes hashes; this guard re-derives them independently and refuses the deploy if any
reference points at the wrong bytes or was never stamped at all. It exists because a broken chain is
invisible: the deploy stays green, the file on the server is correct, and users silently keep old CSS
for up to a year (.htaccess serves any ?v= as immutable). See docs/asset-caching-and-versioning.md.
"""

import hashlib
import importlib.util
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, "..", filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

verifier = load("verify_stamped_chain", "verify-stamped-chain.py")
stamper = load("stamp_asset_versions", "stamp-asset-versions.py")

_tmpdirs = []


def build_repo(files):
    root = tempfile.mkdtemp(prefix="verify-src-")
    _tmpdirs.append(root)
    for rel, content in files.items():
        path = os.path.join(root, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
    return root


def new_deploy_dir():
    path = tempfile.mkdtemp(prefix="verify-deploy-")
    _tmpdirs.append(path)
    return path


def write(root, rel, text):
    with open(os.path.join(root, rel.replace("/", os.sep)), "w", encoding="utf-8") as handle:
        handle.write(text)


def read(root, rel):
    with open(os.path.join(root, rel.replace("/", os.sep)), "r", encoding="utf-8") as handle:
        return handle.read()


GOOD = {
    "index.html": '<link rel="stylesheet" href="css/styles.css">\n',
    "css/styles.css": '@import url("base/tokens.css");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
}


# ---- a freshly stamped tree verifies clean --------------------------------------------------------
root = build_repo(GOOD)
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])
problems = verifier.verify_chain(root, deploy, ["index.html"])
assert problems == [], "a freshly stamped tree must verify clean, got: %r" % (problems,)
print("clean tree verifies ok")


# ---- a tampered hash is caught --------------------------------------------------------------------
# This is the failure that must never ship: index.html points at a styles.css that is not the one in
# the package, so the browser keeps its cached copy and never sees the new imports.
root = build_repo(GOOD)
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])
write(deploy, "index.html", '<link rel="stylesheet" href="css/styles.css?v=deadbeef00">\n')

problems = verifier.verify_chain(root, deploy, ["index.html"])
assert problems, "a wrong hash must be reported"
assert any("styles.css" in p for p in problems), "the report must name the offending file: %r" % (problems,)
print("tampered hash caught ok")


# ---- an unstamped local reference is caught -------------------------------------------------------
# Catches what the fixtures cannot: an @import spelling the stamper's regex does not know would sail
# through unstamped. Harmless for correctness (no ?v= = no-cache) but it silently loses the caching,
# so the deploy should say so rather than pretend the chain is complete.
root = build_repo(GOOD)
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])
write(deploy, "css/styles.css", '@import url("base/tokens.css");\n')  # tag stripped again

problems = verifier.verify_chain(root, deploy, ["index.html"])
assert problems, "an unstamped reference must be reported"
assert any("tokens.css" in p for p in problems), "the report must name the unstamped file: %r" % (problems,)
print("unstamped reference caught ok")


# ---- a stale hash after a leaf edit is caught -----------------------------------------------------
# Exactly the real-world bug: someone changes tokens.css but the chain still carries the old hash.
root = build_repo(GOOD)
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])
write(root, "css/base/tokens.css", ":root { --color: blue; }\n")  # leaf edited AFTER stamping

problems = verifier.verify_chain(root, deploy, ["index.html"])
assert problems, "a stale hash after a leaf edit must be reported"
print("stale hash caught ok")


# ---- missing files are not reported as chain errors -----------------------------------------------
# No ?v= on a nonexistent file is the stamper's deliberate safe degradation, not a chain break.
root = build_repo({"index.html": '<link rel="stylesheet" href="css/gone.css">\n'})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])

problems = verifier.verify_chain(root, deploy, ["index.html"])
assert problems == [], "an unversioned missing file is not a chain error, got: %r" % (problems,)
print("missing file tolerated ok")


for path in _tmpdirs:
    shutil.rmtree(path, ignore_errors=True)

print("\nall verify-stamped-chain tests passed")
