#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

POLITICAL_SOURCE = REPO_ROOT / "api" / "_internal" / "political-territories.php"
WIKI_SOURCE = REPO_ROOT / "api" / "_internal" / "political-territory-wiki.php"

POLITICAL_APP_WRAPPER = REPO_ROOT / "api" / "app" / "political-territories.php"
WIKI_APP_WRAPPER = REPO_ROOT / "api" / "app" / "political-territory-wiki.php"

POLITICAL_DIR = REPO_ROOT / "api" / "_internal" / "political"


PHP_HEADER = "<?php\n\ndeclare(strict_types=1);\n\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split large Avesmaps political PHP endpoint files into smaller internal modules."
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write files. Without this flag, only prints the planned split.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create a local backup before writing.",
    )
    args = parser.parse_args()

    require_existing(POLITICAL_SOURCE)
    require_existing(WIKI_SOURCE)

    political_text = POLITICAL_SOURCE.read_text(encoding="utf-8")
    wiki_text = WIKI_SOURCE.read_text(encoding="utf-8")

    political_plan = build_political_plan(political_text)
    wiki_plan = build_wiki_plan(wiki_text)

    print_plan("political-territories.php", political_plan)
    print_plan("political-territory-wiki.php", wiki_plan)

    if not args.write:
        print("\nDry run only. Re-run with --write to apply.")
        return

    if not args.no_backup:
        create_backup([POLITICAL_SOURCE, WIKI_SOURCE, POLITICAL_APP_WRAPPER, WIKI_APP_WRAPPER])

    write_plan(political_plan)
    write_plan(wiki_plan)

    write_text(
        POLITICAL_APP_WRAPPER,
        PHP_HEADER + "require __DIR__ . '/../_internal/political/territories-endpoint.php';\n",
    )
    write_text(
        WIKI_APP_WRAPPER,
        PHP_HEADER + "require __DIR__ . '/../_internal/political/wiki-browser-endpoint.php';\n",
    )

    POLITICAL_SOURCE.unlink()
    WIKI_SOURCE.unlink()

    print("\nDone.")
    print("Run these checks:")
    print("php -l api/app/political-territories.php")
    print("php -l api/app/political-territory-wiki.php")
    print("Get-ChildItem api/_internal/political/*.php | ForEach-Object { php -l $_.FullName }")


def require_existing(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Required source file not found: {path}")


def build_political_plan(text: str) -> dict[Path, str]:
    preamble, functions, tail = split_php_functions(text)

    controller_start = preamble.find("$debugErrors")
    if controller_start < 0:
        raise RuntimeError("Could not find $debugErrors in political source.")

    endpoint_body = preamble[controller_start:].lstrip()
    endpoint_requires = (
        "require __DIR__ . '/../bootstrap.php';\n"
        "require_once __DIR__ . '/../auth.php';\n"
        "require_once __DIR__ . '/territory.php';\n"
        "require_once __DIR__ . '/assignment.php';\n"
        "require_once __DIR__ . '/territories-support.php';\n"
        "require_once __DIR__ . '/territories-layer.php';\n"
        "require_once __DIR__ . '/territories-read.php';\n"
        "require_once __DIR__ . '/territories-write.php';\n"
        "require_once __DIR__ . '/territories-geometry.php';\n"
        "require_once __DIR__ . '/territories-audit.php';\n"
        "require_once __DIR__ . '/territories-debug.php';\n\n"
    )

    buckets: dict[str, list[str]] = {
        "territories-support.php": [],
        "territories-layer.php": [],
        "territories-read.php": [],
        "territories-write.php": [],
        "territories-geometry.php": [],
        "territories-audit.php": [],
        "territories-debug.php": [],
    }

    for name, block in functions:
        buckets[classify_political_function(name)].append(block)

    if tail.strip():
        buckets["territories-support.php"].append(
            "\n/* Non-function tail preserved by split script. */\n" + tail.strip() + "\n"
        )

    plan: dict[Path, str] = {
        POLITICAL_DIR / "territories-endpoint.php": PHP_HEADER + endpoint_requires + endpoint_body,
    }

    for file_name, blocks in buckets.items():
        plan[POLITICAL_DIR / file_name] = module_content(blocks)

    return plan


def build_wiki_plan(text: str) -> dict[Path, str]:
    preamble, functions, tail = split_php_functions(text)

    controller_start = preamble.find("$configPath")
    if controller_start < 0:
        raise RuntimeError("Could not find $configPath in wiki source.")

    endpoint_body = preamble[controller_start:].lstrip()
    endpoint_requires = (
        "require_once __DIR__ . '/wiki-browser-support.php';\n"
        "require_once __DIR__ . '/wiki-browser-normalize.php';\n"
        "require_once __DIR__ . '/wiki-browser-tree.php';\n\n"
    )

    buckets: dict[str, list[str]] = {
        "wiki-browser-support.php": [],
        "wiki-browser-normalize.php": [],
        "wiki-browser-tree.php": [],
    }

    for name, block in functions:
        buckets[classify_wiki_function(name)].append(block)

    if tail.strip():
        buckets["wiki-browser-support.php"].append(
            "\n/* Non-function tail preserved by split script. */\n" + tail.strip() + "\n"
        )

    plan: dict[Path, str] = {
        POLITICAL_DIR / "wiki-browser-endpoint.php": PHP_HEADER + endpoint_requires + endpoint_body,
    }

    for file_name, blocks in buckets.items():
        plan[POLITICAL_DIR / file_name] = module_content(blocks)

    return plan


def classify_political_function(name: str) -> str:
    lower = name.lower()

    if "debug" in lower:
        return "territories-debug.php"

    if "audit" in lower or "changelog" in lower or "change_log" in lower:
        return "territories-audit.php"

    if (
        "geometry" in lower
        or "geometries" in lower
        or "boundingbox" in lower
        or "bounds" in lower
        or "polygon" in lower
        or "multipolygon" in lower
    ):
        return "territories-geometry.php"

    if (
        "readlayer" in lower
        or "editorlayer" in lower
        or "layer" in lower
        or "feature" in lower
        or "fallback" in lower
        or "effective" in lower
        or "normalizedvalidtosql" in lower
    ):
        return "territories-layer.php"

    if (
        "create" in lower
        or "update" in lower
        or "delete" in lower
        or "save" in lower
        or "restore" in lower
        or "ensure" in lower
        or "assign" in lower
        or "unassign" in lower
        or "undo" in lower
    ):
        return "territories-write.php"

    if (
        "list" in lower
        or "get" in lower
        or "read" in lower
        or "fetch" in lower
        or "hierarchy" in lower
        or "wiki" in lower
        or "territory" in lower
    ):
        return "territories-read.php"

    return "territories-support.php"


def classify_wiki_function(name: str) -> str:
    lower = name.lower()

    tree_terms = [
        "legacy",
        "tree",
        "node",
        "path",
        "rowindex",
        "rowaliases",
        "canonicalrow",
        "canonicalitem",
        "existencelabel",
    ]
    if any(term in lower for term in tree_terms):
        return "wiki-browser-tree.php"

    normalize_terms = [
        "normalize",
        "dedupe",
        "merge",
        "sanitize",
        "rootterritory",
        "synthetic",
        "territoryitem",
    ]
    if any(term in lower for term in normalize_terms):
        return "wiki-browser-normalize.php"

    return "wiki-browser-support.php"


def module_content(blocks: list[str]) -> str:
    body = "\n\n".join(block.strip() for block in blocks if block.strip())
    if body:
        return PHP_HEADER + body + "\n"
    return PHP_HEADER + "// Intentionally empty for now. Kept as a stable module slot.\n"


def split_php_functions(text: str) -> tuple[str, list[tuple[str, str]], str]:
    matches = list(re.finditer(r"^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", text, re.MULTILINE))

    if not matches:
        return text, [], ""

    preamble = text[:matches[0].start()]
    functions: list[tuple[str, str]] = []

    for index, match in enumerate(matches):
        name = match.group(1)
        start = match.start()
        end = find_function_end(text, match.end())
        block = text[start:end].strip()
        functions.append((name, block))

        if index + 1 < len(matches):
            next_start = matches[index + 1].start()
            gap = text[end:next_start]
            if gap.strip():
                functions[-1] = (name, block + "\n\n" + gap.strip())

    tail_start = find_function_end(text, matches[-1].end())
    tail = text[tail_start:]

    return preamble, functions, tail


def find_function_end(text: str, search_from: int) -> int:
    opening = text.find("{", search_from)
    if opening < 0:
        raise RuntimeError("Could not find opening brace for function.")

    depth = 0
    index = opening
    state = "normal"

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if state == "normal":
            if char == "'":
                state = "single"
            elif char == '"':
                state = "double"
            elif char == "/" and next_char == "/":
                state = "line_comment"
                index += 1
            elif char == "/" and next_char == "*":
                state = "block_comment"
                index += 1
            elif char == "#":
                state = "line_comment"
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return index + 1

        elif state == "single":
            if char == "\\":
                index += 1
            elif char == "'":
                state = "normal"

        elif state == "double":
            if char == "\\":
                index += 1
            elif char == '"':
                state = "normal"

        elif state == "line_comment":
            if char == "\n":
                state = "normal"

        elif state == "block_comment":
            if char == "*" and next_char == "/":
                state = "normal"
                index += 1

        index += 1

    raise RuntimeError("Could not find closing brace for function.")


def print_plan(title: str, plan: dict[Path, str]) -> None:
    print(f"\n{title}")
    print("-" * len(title))

    for path, content in sorted(plan.items(), key=lambda item: str(item[0])):
        function_count = len(re.findall(r"^function\s+", content, re.MULTILINE))
        line_count = content.count("\n") + 1
        print(f"{path.relative_to(REPO_ROOT)}: {line_count} lines, {function_count} functions")


def write_plan(plan: dict[Path, str]) -> None:
    for path, content in plan.items():
        write_text(path, content)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def create_backup(paths: list[Path]) -> None:
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = REPO_ROOT / ".refactor-backup" / timestamp
    backup_root.mkdir(parents=True, exist_ok=True)

    for path in paths:
        if not path.exists():
            continue
        target = backup_root / path.relative_to(REPO_ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)

    print(f"\nBackup written to {backup_root.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()