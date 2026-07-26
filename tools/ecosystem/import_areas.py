"""Import a derived manifest through the EXISTING ecosystem write endpoint (plan V5, question 4).

🔴 No new endpoint, no direct SQL, no bulk verb. Two ordinary calls per landscape:
create_region, then create_area -- exactly what a human editor's client sends.

🔴 124 areas are not a loop against STRATO (AGENTS.md, Claude notes). One run, throttled
(--delay, default 1.0 s), resumable through a state file. --dry-run is the DEFAULT; the real
run needs --commit.

🔧 The session cookie comes from a FILE THE OWNER WRITES. This script never asks for
credentials, never prints the cookie, and contains none. Create it with:

    Chrome -> avesmaps.de, logged in -> DevTools -> Application -> Cookies -> copy PHPSESSID
    echo "PHPSESSID=<value>" > cookie.txt

Delete cookie.txt when the run is done.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "/api/edit/map/ecosystem.php"


def build_requests(entry: dict) -> tuple[dict, dict]:
    """(create_region payload, create_area payload without region_public_id)."""
    region = {
        "action": "create_region",
        "kind": entry["kind"],
        "region_type": entry["region_type"],
        "name": entry["name"],
        "label_public_id": entry["label_public_id"],
    }
    # 19 of the 149 labels carry no wiki link. An empty string is not a URL, and
    # avesmapsEcosystemWikiRegionKey would derive NULL from it anyway -- so omit the field
    # rather than send "".
    if entry.get("wiki_url"):
        region["wiki_url"] = entry["wiki_url"]

    area = {
        "action": "create_area",
        "geometry_geojson": entry["geometry"],
        # Explicit, so the import does not depend on app_setting['ecosystem_trial']
        # (api/_internal/app/ecosystem.php:960) and therefore not on whether the owner has
        # already run promote_trial.
        "is_trial": False,
    }
    return region, area


def pending_entries(entries: list[dict], state: dict) -> list[dict]:
    """Everything that has no area yet. A half-finished entry (region written, area not) is
    NOT skipped -- it is finished, using the region_public_id already in the state file."""
    pending = []
    for entry in entries:
        done = state.get(entry["label_public_id"]) or {}
        if done.get("area_public_id"):
            continue
        pending.append(entry)
    return pending


def post(base_url: str, cookie: str, payload: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        base_url.rstrip("/") + ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:400]
        hint = ""
        if error.code == 401:
            hint = "  -> the cookie is missing or expired; log in again and rewrite cookie.txt"
        elif error.code == 403:
            hint = "  -> this account lacks the 'edit' capability"
        raise SystemExit(f"HTTP {error.code} on {payload['action']}: {body}{hint}") from error


def save_state(path: Path, state: dict) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import derived Landschaften areas, throttled.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base-url", default="https://avesmaps.de")
    parser.add_argument("--cookie-file", help="File holding the editor session Cookie header.")
    parser.add_argument("--state", default="import-state.json")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between two writes.")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--limit", type=int, default=0, help="Stop after N areas (0 = all).")
    parser.add_argument("--commit", action="store_true", help="Actually write. Default is a dry run.")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    state_path = Path(args.state)
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {}

    todo = pending_entries(manifest["entries"], state)
    if args.limit:
        todo = todo[:args.limit]

    already = len(manifest["entries"]) - len(pending_entries(manifest["entries"], state))
    print(f"{len(manifest['entries'])} in manifest, {already} already imported, "
          f"{len(todo)} to write, {'COMMIT' if args.commit else 'DRY RUN'}, delay {args.delay}s")

    if not args.commit:
        for entry in todo[:10]:
            region, _ = build_requests(entry)
            wiki = "wiki" if "wiki_url" in region else "kein wiki"
            print(f"  would create: {region['kind']}/{region['region_type']} "
                  f"{region['name']!r} ({entry['position_count']} positions, {wiki})")
        if len(todo) > 10:
            print(f"  ... and {len(todo) - 10} more")
        print("  --commit to write")
        return

    if not args.cookie_file:
        raise SystemExit("--commit needs --cookie-file")
    # 💣 utf-8-sig, not utf-8: on Windows, Out-File and Set-Content happily write a BOM, and a
    # BOM is NOT whitespace -- str.strip() leaves it in place and it rides along in the Cookie
    # header, which then silently fails to authenticate. utf-8-sig eats it if present.
    cookie = Path(args.cookie_file).read_text(encoding="utf-8-sig").strip()
    if not cookie:
        raise SystemExit(f"{args.cookie_file} is empty")
    if "PHPSESSID" not in cookie:
        raise SystemExit(f"{args.cookie_file} does not look like a Cookie header "
                         "(expected something like 'PHPSESSID=...')")

    for index, entry in enumerate(todo, start=1):
        key = entry["label_public_id"]
        done = state.get(key) or {}
        region_payload, area_payload = build_requests(entry)

        if not done.get("region_public_id"):
            result = post(args.base_url, cookie, region_payload, args.timeout)
            done["region_public_id"] = result["region"]["public_id"]
            state[key] = done
            save_state(state_path, state)
            time.sleep(args.delay)

        area_payload["region_public_id"] = done["region_public_id"]
        result = post(args.base_url, cookie, area_payload, args.timeout)
        done["area_public_id"] = result["area"]["public_id"]
        state[key] = done
        save_state(state_path, state)

        print(f"[{index}/{len(todo)}] {entry['name']} "
              f"({entry['kind']}, {entry['position_count']} Ecken) "
              f"-> ecosystem_revision {result.get('revision')}")
        time.sleep(args.delay)

    print("done")


if __name__ == "__main__":
    main()
