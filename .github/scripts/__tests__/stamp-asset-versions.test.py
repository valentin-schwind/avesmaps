#!/usr/bin/env python3
"""Tests for stamp-asset-versions.py -- the deploy's cache-busting stamper.

Run from the repo root (no runner, no flags, like the JS/PHP tests):

    python .github/scripts/__tests__/stamp-asset-versions.test.py

These tests build a throwaway mini-repo on disk and run the REAL script against it. The script is a
filesystem tool, so faking the filesystem would test the fake -- and the bug class we care about here
(a stale hash silently breaking the chain) only exists in the real read/hash/write round-trip.

Background: docs/asset-caching-and-versioning.md. The chain is
    index.html -> css/styles.css -> base/tokens.css (+37 more)
and .htaccess serves anything carrying a ?v= as immutable for a year. A wrong hash therefore does not
fail loudly -- it pins users to old CSS for up to a year. That is what these tests exist to prevent.
"""

import hashlib
import importlib.util
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "stamp-asset-versions.py")

spec = importlib.util.spec_from_file_location("stamp_asset_versions", SCRIPT)
stamper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stamper)

_tmpdirs = []


def build_repo(files):
    """Materialise {relpath: content} as a temp repo, return its root."""
    root = tempfile.mkdtemp(prefix="stamp-src-")
    _tmpdirs.append(root)
    for rel, content in files.items():
        path = os.path.join(root, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
    return root


def new_deploy_dir():
    path = tempfile.mkdtemp(prefix="stamp-deploy-")
    _tmpdirs.append(path)
    return path


def read(root, rel):
    with open(os.path.join(root, rel.replace("/", os.sep)), "r", encoding="utf-8") as handle:
        return handle.read()


def sha1_of_file(root, rel):
    with open(os.path.join(root, rel.replace("/", os.sep)), "rb") as handle:
        return hashlib.sha1(handle.read()).hexdigest()[:10]


# ---- @import lines are stamped at all (Mechanism C's whole point) --------------------------------
# The old script only touched <script>/<link> tags, so every @import-ed file needed a hand-written ?v=.
root = build_repo({
    "css/styles.css": '@import url("base/tokens.css");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["css/styles.css"])

expected = sha1_of_file(root, "css/base/tokens.css")
assert 'base/tokens.css?v=%s' % expected in read(deploy, "css/styles.css"), \
    "@import must carry the hash of the imported file"
print("import stamped ok")


# ---- a hand-written tag is REPLACED, not appended to ---------------------------------------------
# The 27 existing hand-maintained tags must not survive as `tokens.css?v=20260717-ztokens1?v=abc`.
root = build_repo({
    "css/styles.css": '@import url("base/tokens.css?v=20260717-ztokens1");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["css/styles.css"])

out = read(deploy, "css/styles.css")
assert "20260717-ztokens1" not in out, "the hand-written tag must be gone"
assert out.count("?v=") == 1, "exactly one ?v= per reference"
print("hand-written tag replaced ok")


# ---- THE CORE TEST: index.html must carry the hash of the STAMPED styles.css ---------------------
# If index.html got the hash of the ORIGINAL styles.css, the browser would keep serving the cached
# styles.css and never see the new import URLs -- the chain would look stamped but be broken, with no
# error anywhere. This is the whole reason the stamping has to run bottom-up.
root = build_repo({
    "index.html": '<link rel="stylesheet" href="css/styles.css">\n',
    "css/styles.css": '@import url("base/tokens.css");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])

expected = sha1_of_file(deploy, "css/styles.css")
assert 'css/styles.css?v=%s' % expected in read(deploy, "index.html"), \
    "index.html must reference the hash of the stamped styles.css, not the original"
assert sha1_of_file(root, "css/styles.css") not in read(deploy, "index.html"), \
    "the original (unstamped) hash must NOT appear -- that is the silent chain break"
print("bottom-up chain ok")


# ---- a leaf change must propagate all the way up to index.html -----------------------------------
# The end-to-end promise: touch tokens.css, and index.html's styles.css URL changes by itself.
def index_url_for(tokens_css):
    root = build_repo({
        "index.html": '<link rel="stylesheet" href="css/styles.css">\n',
        "css/styles.css": '@import url("base/tokens.css");\n',
        "css/base/tokens.css": tokens_css,
    })
    deploy = new_deploy_dir()
    stamper.stamp_tree(root, deploy, ["index.html"])
    return read(deploy, "index.html")

before = index_url_for(":root { --color: red; }\n")
after = index_url_for(":root { --color: blue; }\n")
assert before != after, "changing tokens.css must change index.html's styles.css URL"
print("leaf change propagates ok")


# ---- two levels deep (the context-menu-sizing.css trap) ------------------------------------------
# styles.css -> context-menu-sizing.css -> map-context-menu-icons.css. Every level must carry the hash
# of the level below it AFTER that level was stamped.
root = build_repo({
    "index.html": '<link rel="stylesheet" href="css/styles.css">\n',
    "css/styles.css": '@import url("components/context-menu-sizing.css");\n',
    "css/components/context-menu-sizing.css": '@import url("map-context-menu-icons.css");\n',
    "css/components/map-context-menu-icons.css": ".icon { width: 1px; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])

icons_hash = sha1_of_file(root, "css/components/map-context-menu-icons.css")
sizing_out = read(deploy, "css/components/context-menu-sizing.css")
assert 'map-context-menu-icons.css?v=%s' % icons_hash in sizing_out, "level 2 stamped"

sizing_hash = sha1_of_file(deploy, "css/components/context-menu-sizing.css")
styles_out = read(deploy, "css/styles.css")
assert 'components/context-menu-sizing.css?v=%s' % sizing_hash in styles_out, \
    "level 1 must carry the hash of the STAMPED level 2 file"

assert 'css/styles.css?v=%s' % sha1_of_file(deploy, "css/styles.css") in read(deploy, "index.html"), \
    "index.html must carry the hash of the stamped styles.css"
print("two levels deep ok")


# ---- @import paths resolve relative to the importing FILE, not the repo root ---------------------
# `base/tokens.css` inside css/styles.css means css/base/tokens.css; `../base/tokens.css` inside
# css/pages/edit.css means css/base/tokens.css too.
root = build_repo({
    "css/pages/edit.css": '@import url("../base/tokens.css");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["css/pages/edit.css"])

expected = sha1_of_file(root, "css/base/tokens.css")
assert '../base/tokens.css?v=%s' % expected in read(deploy, "css/pages/edit.css"), \
    "a ../ import must resolve against the importing file's directory"
print("relative import paths ok")


# ---- absolute paths in html/ sub-pages (the tokens.css pins) --------------------------------------
# The editor iframes link /css/base/tokens.css with a leading slash. The old ATTR_RE only matched
# `css/...` without one, which is exactly why those three pins stayed hand-maintained.
root = build_repo({
    "html/citymap-editor.html": '<link rel="stylesheet" href="/css/base/tokens.css?v=20260717-ztokens1">\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["html/citymap-editor.html"])

expected = sha1_of_file(root, "css/base/tokens.css")
out = read(deploy, "html/citymap-editor.html")
assert '/css/base/tokens.css?v=%s' % expected in out, "absolute /css/ path must be stamped"
assert "20260717-ztokens1" not in out, "the hand-written pin must be gone"
print("absolute sub-page paths ok")


# ---- external URLs and unknown assets are left alone ----------------------------------------------
root = build_repo({
    "index.html": (
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">\n'
        '<link rel="stylesheet" href="//cdn.example.com/y.css">\n'
        '<img src="assets/logo.png">\n'
    ),
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])

out = read(deploy, "index.html")
assert "https://cdn.example.com/x.css?v=" not in out, "external https URL untouched"
assert "//cdn.example.com/y.css?v=" not in out, "protocol-relative URL untouched"
assert "logo.png?v=" not in out, "non js/css asset untouched"
print("external + unknown assets untouched ok")


# ---- a missing file is left unversioned rather than stamped with a bogus hash ---------------------
# Safe degradation: no ?v= means no-cache, which is slow but never stale. Inventing a hash for a file
# that is not there would pin users to a 404 for a year.
root = build_repo({
    "index.html": '<link rel="stylesheet" href="css/gone.css">\n',
})
deploy = new_deploy_dir()
result = stamper.stamp_tree(root, deploy, ["index.html"])

assert "css/gone.css?v=" not in read(deploy, "index.html"), "missing file must stay unversioned"
assert result["missing"] == 1, "a missing reference is reported"
print("missing file left unversioned ok")


# ---- an @import cycle must not hang -----------------------------------------------------------
# a.css imports b.css imports a.css. Nobody should ever write this, but an infinite recursion in the
# deploy would be a very annoying way to find out.
root = build_repo({
    "css/a.css": '@import url("b.css");\n',
    "css/b.css": '@import url("a.css");\n',
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["css/a.css"])
print("import cycle survived ok")


# ---- unchanged files are NOT written into the deploy dir ------------------------------------------
# The deploy package is incremental. Only files the stamper actually rewrote need to ride along; a
# stamped-but-identical leaf would just bloat the upload.
root = build_repo({
    "index.html": '<link rel="stylesheet" href="css/styles.css">\n',
    "css/styles.css": '@import url("base/tokens.css");\n',
    "css/base/tokens.css": ":root { --color: red; }\n",
})
deploy = new_deploy_dir()
stamper.stamp_tree(root, deploy, ["index.html"])

assert os.path.exists(os.path.join(deploy, "css", "styles.css")), "a rewritten file must be deployed"
assert not os.path.exists(os.path.join(deploy, "css", "base", "tokens.css")), \
    "an untouched leaf must not be copied into the deploy package"
print("only rewritten files deployed ok")


for path in _tmpdirs:
    shutil.rmtree(path, ignore_errors=True)

print("\nall stamp-asset-versions tests passed")
