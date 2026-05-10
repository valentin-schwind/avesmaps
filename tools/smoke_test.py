#!/usr/bin/env python3
"""Read-only smoke and consistency checks for an Avesmaps deployment."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from typing import Any


MAP_MIN = 0
MAP_MAX = 1024
SCRIPT_SRC_PATTERN = re.compile(r'<script\s+src="([^"]+)"')
FRONTEND_SCRIPT_PATHS = [
    "js/priority-queue.js",
    "js/config.js",
    "js/utils.js",
    "js/popups.js",
    "js/api.js",
    "js/dialogs-review.js",
    "js/ui-controls.js",
    "js/map-features.js",
    "js/routing.js",
]


@dataclass
class CheckResult:
    status: str
    name: str
    message: str


class SmokeTester:
    def __init__(self, base_url: str, admin_token: str = "", timeout: int = 20, frontend_only: bool = False) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.admin_token = admin_token
        self.timeout = timeout
        self.frontend_only = frontend_only
        self.results: list[CheckResult] = []
        self.feature_collection: dict[str, Any] | None = None

    def ok(self, name: str, message: str) -> None:
        self.results.append(CheckResult("OK", name, message))

    def warn(self, name: str, message: str) -> None:
        self.results.append(CheckResult("WARN", name, message))

    def fail(self, name: str, message: str) -> None:
        self.results.append(CheckResult("FAIL", name, message))

    def request_json(self, path: str, headers: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url, path.lstrip("/")),
            headers={"Accept": "application/json", **(headers or {})},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
                return response.status, json.loads(body)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {"raw": body}
            return error.code, payload

    def request_text(self, path: str) -> tuple[int, str]:
        request = urllib.request.Request(urllib.parse.urljoin(self.base_url, path.lstrip("/")), method="GET")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.status, response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", errors="replace")

    def run(self) -> int:
        self.check_frontend()
        if self.frontend_only:
            self.print_results()
            return 1 if any(result.status == "FAIL" for result in self.results) else 0

        self.check_sql_features()
        self.check_feature_consistency()
        self.check_auth_boundaries()
        self.check_admin_status()
        self.print_results()
        return 1 if any(result.status == "FAIL" for result in self.results) else 0

    def check_frontend(self) -> None:
        status, html = self.request_text("index.html")
        if status != 200:
            self.fail("frontend", f"index.html returned HTTP {status}")
            return

        script_paths = SCRIPT_SRC_PATTERN.findall(html)
        missing_scripts = [path for path in FRONTEND_SCRIPT_PATHS if path not in script_paths]
        if missing_scripts:
            self.fail("frontend", f"missing script references: {', '.join(missing_scripts)}")
            return

        script_failures = self.check_frontend_scripts()
        if script_failures:
            self.fail("frontend-js", "; ".join(script_failures))
            return

        self.ok("frontend", "index.html and modular JS files are reachable")

    def check_frontend_scripts(self) -> list[str]:
        failures: list[str] = []
        for path in FRONTEND_SCRIPT_PATHS:
            status, body = self.request_text(path)
            if status != 200:
                failures.append(f"{path} returned HTTP {status}")
                continue

            if path == "js/config.js" and ("tiles/stylized" not in body or "api/map-features.php" not in body):
                failures.append("js/config.js does not contain expected SQL/stylized configuration")
        return failures

    def check_sql_features(self) -> None:
        status, payload = self.request_json("api/map-features.php")
        if status != 200 or payload.get("ok") is not True:
            self.fail("map-features", f"HTTP {status}: {payload.get('error') or payload}")
            return

        features = payload.get("features")
        if not isinstance(features, list) or not features:
            self.fail("map-features", "FeatureCollection has no features")
            return

        self.feature_collection = payload
        revision = payload.get("revision", "?")
        self.ok("map-features", f"{len(features)} active features, revision {revision}")

    def check_feature_consistency(self) -> None:
        if self.feature_collection is None:
            self.warn("consistency", "Skipped because map-features failed")
            return

        features = self.feature_collection.get("features", [])
        type_counts: Counter[str] = Counter()
        issues: list[str] = []
        public_ids: set[str] = set()
        path_endpoint_names = self.collect_location_names(features)

        for feature in features:
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry") or {}
            feature_type = str(properties.get("feature_type") or properties.get("type") or "unknown")
            geometry_type = str(geometry.get("type") or "")
            public_id = str(properties.get("public_id") or feature.get("id") or "")
            type_counts[feature_type] += 1

            if public_id:
                if public_id in public_ids:
                    issues.append(f"duplicate public_id {public_id}")
                public_ids.add(public_id)

            if not geometry_type:
                issues.append(f"{public_id or feature_type}: missing geometry type")

            if not self.geometry_within_bounds(geometry):
                issues.append(f"{public_id or feature_type}: geometry outside {MAP_MIN}..{MAP_MAX}")

            if feature_type == "path":
                missing_endpoint = self.find_missing_path_endpoint(feature, path_endpoint_names)
                if missing_endpoint:
                    issues.append(f"{public_id}: path endpoint not found: {missing_endpoint}")

        summary = ", ".join(f"{name}={count}" for name, count in sorted(type_counts.items()))
        if issues:
            visible = "; ".join(issues[:8])
            suffix = f" (+{len(issues) - 8} more)" if len(issues) > 8 else ""
            self.warn("consistency", f"{summary}; issues: {visible}{suffix}")
            return

        self.ok("consistency", summary)

    def check_auth_boundaries(self) -> None:
        protected_paths = [
            "api/map-audit-log.php",
            "api/location-report-review.php",
        ]
        failures = []
        for path in protected_paths:
            status, payload = self.request_json(path)
            if status != 401:
                failures.append(f"{path} returned HTTP {status} instead of 401")
            elif payload.get("ok") is not False:
                failures.append(f"{path} returned unexpected auth payload")

        if failures:
            self.warn("auth-boundaries", "; ".join(failures))
            return

        self.ok("auth-boundaries", "review/audit APIs reject anonymous requests")

    def check_admin_status(self) -> None:
        if not self.admin_token:
            self.warn("admin-status", "Skipped; pass --admin-token to check DB table/revision status")
            return

        status, payload = self.request_json(
            "api/map-database-admin.php",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        if status != 200 or payload.get("ok") is not True:
            self.fail("admin-status", f"HTTP {status}: {payload.get('error') or payload}")
            return

        tables = payload.get("tables") or {}
        missing_tables = [name for name, exists in tables.items() if not exists]
        if missing_tables:
            self.fail("admin-status", f"missing tables: {', '.join(missing_tables)}")
            return

        revision = payload.get("revision", "?")
        counts = payload.get("feature_counts") or []
        self.ok("admin-status", f"all tables present, revision {revision}, {len(counts)} feature count rows")

    def collect_location_names(self, features: list[dict[str, Any]]) -> set[str]:
        names = set()
        for feature in features:
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry") or {}
            feature_type = str(properties.get("feature_type") or "")
            if geometry.get("type") == "Point" and feature_type in {"location", "crossing"}:
                name = str(properties.get("name") or "")
                if name:
                    names.add(name)
        return names

    def find_missing_path_endpoint(self, feature: dict[str, Any], known_names: set[str]) -> str:
        properties = feature.get("properties") or {}
        for key in ("from", "to", "start", "end", "source", "target"):
            value = properties.get(key)
            if isinstance(value, str) and value and value not in known_names:
                return value
        return ""

    def geometry_within_bounds(self, geometry: dict[str, Any]) -> bool:
        coordinates = geometry.get("coordinates")
        for coordinate in self.iter_coordinates(coordinates):
            x, y = coordinate
            if x < MAP_MIN or x > MAP_MAX or y < MAP_MIN or y > MAP_MAX:
                return False
        return True

    def iter_coordinates(self, value: Any) -> list[tuple[float, float]]:
        if (
            isinstance(value, list)
            and len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            return [(float(value[0]), float(value[1]))]

        coordinates = []
        if isinstance(value, list):
            for item in value:
                coordinates.extend(self.iter_coordinates(item))
        return coordinates

    def print_results(self) -> None:
        for result in self.results:
            print(f"{result.status:4} {result.name}: {result.message}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run read-only Avesmaps deployment smoke checks.")
    parser.add_argument("--base-url", default="https://avesmaps.de/", help="Deployment base URL.")
    parser.add_argument("--admin-token", default="", help="Optional import/admin bearer token for read-only DB status.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds.")
    parser.add_argument("--frontend-only", action="store_true", help="Only verify frontend files and script references.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    tester = SmokeTester(args.base_url, args.admin_token, args.timeout, args.frontend_only)
    try:
        return tester.run()
    except Exception as error:
        print(f"FAIL smoke-test: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
