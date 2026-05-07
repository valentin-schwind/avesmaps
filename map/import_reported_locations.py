#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import textwrap
import xml.etree.ElementTree as ET
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from svg_to_geojson import svg_to_geojson


DEFAULT_ROW_STATUS = "neu"
DEFAULT_IMPORTED_STATUS = "alt"
DEFAULT_DB_CHARSET = "utf8mb4"

SVG_NAMESPACE = "http://www.w3.org/2000/svg"
INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape"
ATTR_INKSCAPE_LABEL = f"{{{INKSCAPE_NAMESPACE}}}label"
ATTR_INKSCAPE_GROUPMODE = f"{{{INKSCAPE_NAMESPACE}}}groupmode"

MAP_DIMENSION = 1024.0
DEFAULT_POINT_RADIUS = "0.5"
DEFAULT_POINT_STYLE = "fill:#000000;fill-opacity:1;stroke:none;stroke-width:5.53701"

SETTLEMENT_CONFIG = {
    "metropole": {
        "layer_label": "Metropolen",
        "type_code": "m",
        "type_label": "Metropole",
        "icon": "🏛️",
    },
    "grossstadt": {
        "layer_label": "Großstädte",
        "type_code": "gs",
        "type_label": "Großstadt",
        "icon": "🏰",
    },
    "stadt": {
        "layer_label": "Städte",
        "type_code": "s",
        "type_label": "Stadt",
        "icon": "⛪",
    },
    "kleinstadt": {
        "layer_label": "Kleinstädte",
        "type_code": "ks",
        "type_label": "Kleinstadt",
        "icon": "🏘️",
    },
    "dorf": {
        "layer_label": "Dörfer",
        "type_code": "d",
        "type_label": "Dorf",
        "icon": "🏡",
    },
    "gebaeude": {
        "layer_label": "Gebaeude",
        "type_code": "g",
        "type_label": "Gebaeude",
        "icon": "Gebaeude",
    },
}


@dataclass
class DatabaseConfig:
    driver: str
    host: str
    port: int
    name: str
    user: str
    password: str
    charset: str = DEFAULT_DB_CHARSET


@dataclass
class ApiConfig:
    base_url: str
    token: str
    timeout_seconds: float = 20.0


@dataclass
class ImportBackend:
    kind: str
    connection: Any = None
    api_config: Optional[ApiConfig] = None


@dataclass
class ReportRow:
    report_id: int
    created_at: str
    status: str
    name: str
    size: str
    lat: float
    lng: float
    source: str
    wiki_url: str
    comment: str
    page_url: str
    client_version: str
    review_note: str


@dataclass
class ExistingLocation:
    name: str
    cx: float
    cy: float


@dataclass
class SvgImportContext:
    tree: ET.ElementTree
    root: ET.Element
    svg_path: Path
    geojson_path: Path
    target_layers: Dict[str, ET.Element]
    existing_locations: List[ExistingLocation]
    max_place_id: int
    backup_path: Optional[Path] = None


def parse_args() -> argparse.Namespace:
    map_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Importiert neue Ortsmeldungen interaktiv aus der SQL-Datenbank in die SVG und aktualisiert das GeoJSON."
    )
    parser.add_argument(
        "--db-driver",
        default=os.getenv("AVESMAPS_DB_DRIVER", ""),
        help="Datenbank-Treiber: mysql, mariadb oder pgsql/postgres.",
    )
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("AVESMAPS_IMPORT_API_BASE_URL", ""),
        help="Basis-URL der Import-API, zum Beispiel https://example.org/avesmaps/api.",
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("AVESMAPS_IMPORT_API_TOKEN", ""),
        help="Import-API-Token fuer die serverseitigen Moderations-Endpunkte.",
    )
    parser.add_argument(
        "--api-timeout",
        default=os.getenv("AVESMAPS_IMPORT_API_TIMEOUT", "20"),
        help="Timeout fuer Import-API-Anfragen in Sekunden.",
    )
    parser.add_argument(
        "--db-host",
        default=os.getenv("AVESMAPS_DB_HOST", ""),
        help="Datenbank-Host.",
    )
    parser.add_argument(
        "--db-port",
        default=os.getenv("AVESMAPS_DB_PORT", ""),
        help="Datenbank-Port.",
    )
    parser.add_argument(
        "--db-name",
        default=os.getenv("AVESMAPS_DB_NAME", ""),
        help="Datenbankname.",
    )
    parser.add_argument(
        "--db-user",
        default=os.getenv("AVESMAPS_DB_USER", ""),
        help="Datenbank-Benutzer.",
    )
    parser.add_argument(
        "--db-password",
        default=os.getenv("AVESMAPS_DB_PASSWORD", ""),
        help="Datenbank-Passwort.",
    )
    parser.add_argument(
        "--db-charset",
        default=os.getenv("AVESMAPS_DB_CHARSET", DEFAULT_DB_CHARSET),
        help="Zeichensatz fuer MySQL/MariaDB-Verbindungen.",
    )
    parser.add_argument(
        "--status",
        default=DEFAULT_ROW_STATUS,
        help="Es werden nur Meldungen mit diesem Status verarbeitet.",
    )
    parser.add_argument(
        "--imported-status",
        default=DEFAULT_IMPORTED_STATUS,
        help="Auf diesen Status werden erfolgreich importierte Meldungen gesetzt.",
    )
    parser.add_argument(
        "--svg",
        default=str(map_dir / "Aventurien_routes.svg"),
        help="Pfad zur zu aktualisierenden SVG-Datei.",
    )
    parser.add_argument(
        "--geojson",
        default=str(map_dir / "Aventurien_routes.geojson"),
        help="Pfad zur neu zu schreibenden GeoJSON-Datei.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Zeigt nur an, was passieren wuerde, ohne SVG, GeoJSON oder Datenbankeintraege zu veraendern.",
    )
    return parser.parse_args()


def prompt_choice(prompt_text: str, valid_choices: Sequence[str], default_choice: Optional[str] = None) -> str:
    normalized_choices = {choice.lower() for choice in valid_choices}
    normalized_default = default_choice.lower() if default_choice else None

    while True:
        raw_value = input(prompt_text).strip().lower()
        if not raw_value and normalized_default:
            return normalized_default
        if raw_value in normalized_choices:
            return raw_value

        print(f"Bitte eine der Optionen eingeben: {', '.join(valid_choices)}")


def build_api_config(args: argparse.Namespace) -> Optional[ApiConfig]:
    api_base_url = str(args.api_base_url).strip().rstrip("/")
    if api_base_url == "":
        return None

    api_token = str(args.api_token).strip()
    if api_token == "":
        raise ValueError(
            "Fuer die Import-API fehlt das Token. Bitte --api-token oder AVESMAPS_IMPORT_API_TOKEN setzen."
        )

    try:
        timeout_seconds = float(str(args.api_timeout).strip())
    except ValueError as error:
        raise ValueError("Der API-Timeout muss eine Zahl sein.") from error

    if timeout_seconds <= 0:
        raise ValueError("Der API-Timeout muss groesser als 0 sein.")

    return ApiConfig(
        base_url=api_base_url,
        token=api_token,
        timeout_seconds=timeout_seconds,
    )


def build_database_config(args: argparse.Namespace) -> DatabaseConfig:
    missing_fields = []
    for field_name in ("db_driver", "db_host", "db_port", "db_name", "db_user"):
        if not getattr(args, field_name):
            missing_fields.append(field_name.replace("db_", ""))

    if missing_fields:
        joined_fields = ", ".join(missing_fields)
        raise ValueError(
            "Die Datenbank-Konfiguration ist unvollstaendig. "
            f"Bitte Parameter oder AVESMAPS_DB_* Umgebungsvariablen fuer {joined_fields} setzen."
        )

    try:
        port = int(str(args.db_port).strip())
    except ValueError as error:
        raise ValueError("Der Datenbank-Port muss eine Zahl sein.") from error

    return DatabaseConfig(
        driver=normalize_driver_name(str(args.db_driver)),
        host=str(args.db_host).strip(),
        port=port,
        name=str(args.db_name).strip(),
        user=str(args.db_user).strip(),
        password=str(args.db_password),
        charset=str(args.db_charset or DEFAULT_DB_CHARSET).strip() or DEFAULT_DB_CHARSET,
    )


def normalize_driver_name(driver_name: str) -> str:
    normalized_driver = driver_name.strip().lower()
    if normalized_driver in {"mysql", "mariadb"}:
        return normalized_driver
    if normalized_driver in {"pgsql", "postgres", "postgresql"}:
        return "pgsql"
    raise ValueError("Unterstuetzte Datenbank-Treiber sind mysql, mariadb und pgsql/postgres.")


def open_database_connection(database_config: DatabaseConfig):
    if database_config.driver in {"mysql", "mariadb"}:
        try:
            import pymysql
        except ImportError as import_error:  # pragma: no cover - depends on local environment
            print(
                "Fehlende Python-Abhaengigkeit fuer MySQL/MariaDB.\n"
                "Bitte zuerst installieren:\n"
                "  pip install -r map/requirements-location-import.txt",
                file=sys.stderr,
            )
            raise SystemExit(import_error) from import_error

        return pymysql.connect(
            host=database_config.host,
            port=database_config.port,
            user=database_config.user,
            password=database_config.password,
            database=database_config.name,
            charset=database_config.charset,
            autocommit=False,
            cursorclass=pymysql.cursors.DictCursor,
        )

    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as import_error:  # pragma: no cover - depends on local environment
        print(
            "Fehlende Python-Abhaengigkeit fuer PostgreSQL.\n"
            "Bitte zuerst installieren:\n"
            "  pip install -r map/requirements-location-import.txt",
            file=sys.stderr,
        )
        raise SystemExit(import_error) from import_error

    return psycopg.connect(
        host=database_config.host,
        port=database_config.port,
        dbname=database_config.name,
        user=database_config.user,
        password=database_config.password,
        row_factory=dict_row,
    )


def open_import_backend(args: argparse.Namespace) -> ImportBackend:
    api_config = build_api_config(args)
    if api_config is not None:
        return ImportBackend(
            kind="api",
            api_config=api_config,
        )

    database_config = build_database_config(args)
    return ImportBackend(
        kind="database",
        connection=open_database_connection(database_config),
    )


def close_import_backend(backend: ImportBackend) -> None:
    if backend.kind == "database" and backend.connection is not None:
        backend.connection.close()


def perform_import_api_request(
    api_config: ApiConfig,
    method: str,
    endpoint_name: str,
    payload: Optional[Dict[str, Any]] = None,
    query_params: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    endpoint_url = f"{api_config.base_url}/{endpoint_name.lstrip('/')}"
    if query_params:
        endpoint_url = f"{endpoint_url}?{urllib.parse.urlencode(query_params)}"

    request_body: Optional[bytes] = None
    request_headers = {
        "Accept": "application/json",
        "X-Avesmaps-Import-Token": api_config.token,
    }

    if payload is not None:
        request_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        endpoint_url,
        data=request_body,
        headers=request_headers,
        method=method.upper(),
    )

    try:
        with urllib.request.urlopen(request, timeout=api_config.timeout_seconds) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace")
        try:
            response_payload = json.loads(response_body)
        except json.JSONDecodeError as decode_error:
            raise RuntimeError(
                f"Die Import-API hat mit HTTP {error.code} und ungueltigem JSON geantwortet."
            ) from decode_error

        error_message = str(response_payload.get("error") or response_payload.get("message") or "").strip()
        if error_message == "":
            error_message = f"Die Import-API hat HTTP {error.code} zurueckgegeben."
        raise RuntimeError(error_message) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Die Import-API ist nicht erreichbar: {error.reason}") from error

    try:
        response_payload = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise RuntimeError("Die Import-API hat ungueltiges JSON geliefert.") from error

    if not isinstance(response_payload, dict):
        raise RuntimeError("Die Import-API hat kein gueltiges JSON-Objekt geliefert.")

    if response_payload.get("ok") is False:
        error_message = str(response_payload.get("error") or response_payload.get("message") or "").strip()
        raise RuntimeError(error_message or "Die Import-API hat einen Fehler gemeldet.")

    return response_payload


def serialize_timestamp(timestamp_value: Any) -> str:
    if isinstance(timestamp_value, datetime):
        if timestamp_value.tzinfo is None:
            return timestamp_value.replace(tzinfo=timezone.utc).isoformat()
        return timestamp_value.isoformat()

    return str(timestamp_value or "").strip()


def parse_report_row(raw_row: Dict[str, Any]) -> Optional[ReportRow]:
    name = str(raw_row.get("name") or "").strip()
    if not name:
        return None

    size = str(raw_row.get("size") or "").strip().lower()
    if size not in SETTLEMENT_CONFIG:
        return None

    try:
        report_id = int(raw_row["id"])
        lat = float(raw_row["lat"])
        lng = float(raw_row["lng"])
    except (KeyError, TypeError, ValueError):
        return None

    return ReportRow(
        report_id=report_id,
        created_at=serialize_timestamp(raw_row.get("created_at")),
        status=str(raw_row.get("status") or "").strip(),
        name=name,
        size=size,
        lat=lat,
        lng=lng,
        source=str(raw_row.get("source") or "").strip(),
        wiki_url=str(raw_row.get("wiki_url") or "").strip(),
        comment=str(raw_row.get("comment") or "").strip(),
        page_url=str(raw_row.get("page_url") or "").strip(),
        client_version=str(raw_row.get("client_version") or "").strip(),
        review_note=str(raw_row.get("review_note") or "").strip(),
    )


def fetch_report_rows_from_database(connection, status_filter: str) -> List[ReportRow]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                id,
                created_at,
                status,
                name,
                size,
                lat,
                lng,
                source,
                wiki_url,
                comment,
                page_url,
                client_version,
                review_note
            FROM location_reports
            WHERE status = %s
            ORDER BY created_at ASC, id ASC
            """,
            (status_filter,),
        )
        raw_rows = cursor.fetchall()

    parsed_rows: List[ReportRow] = []
    for raw_row in raw_rows:
        report_row = parse_report_row(dict(raw_row))
        if report_row is None:
            report_identifier = raw_row.get("id", "?") if isinstance(raw_row, dict) else "?"
            print(
                f"Meldung {report_identifier} wird uebersprungen: unvollstaendige oder ungueltige Daten.",
                file=sys.stderr,
            )
            continue
        parsed_rows.append(report_row)

    return parsed_rows


def fetch_report_rows_from_api(api_config: ApiConfig, status_filter: str) -> List[ReportRow]:
    response_payload = perform_import_api_request(
        api_config=api_config,
        method="GET",
        endpoint_name="list-location-reports.php",
        query_params={"status": status_filter},
    )
    raw_rows = response_payload.get("reports", [])
    if not isinstance(raw_rows, list):
        raise RuntimeError("Die Import-API hat kein gueltiges report-Array geliefert.")

    parsed_rows: List[ReportRow] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            continue

        report_row = parse_report_row(raw_row)
        if report_row is None:
            report_identifier = raw_row.get("id", "?")
            print(
                f"Meldung {report_identifier} wird uebersprungen: unvollstaendige oder ungueltige Daten.",
                file=sys.stderr,
            )
            continue
        parsed_rows.append(report_row)

    return parsed_rows


def fetch_report_rows(backend: ImportBackend, status_filter: str) -> List[ReportRow]:
    if backend.kind == "api":
        if backend.api_config is None:
            raise RuntimeError("Die Import-API-Konfiguration fehlt.")
        return fetch_report_rows_from_api(backend.api_config, status_filter)

    if backend.connection is None:
        raise RuntimeError("Die Datenbank-Verbindung fehlt.")
    return fetch_report_rows_from_database(backend.connection, status_filter)


def delete_report_row(connection, report_id: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM location_reports WHERE id = %s", (report_id,))


def update_report_status(connection, report_id: int, status: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE location_reports
            SET
                status = %s,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            (status, report_id),
        )


def delete_report_via_api(api_config: ApiConfig, report_id: int) -> None:
    perform_import_api_request(
        api_config=api_config,
        method="POST",
        endpoint_name="delete-location-report.php",
        payload={"report_id": report_id},
    )


def update_report_status_via_api(api_config: ApiConfig, report_id: int, status: str) -> None:
    perform_import_api_request(
        api_config=api_config,
        method="POST",
        endpoint_name="update-location-report-status.php",
        payload={
            "report_id": report_id,
            "status": status,
        },
    )


def collect_xml_namespaces(svg_path: Path) -> List[Tuple[str, str]]:
    namespaces: List[Tuple[str, str]] = []
    for _, namespace in ET.iterparse(svg_path, events=("start-ns",)):
        if namespace not in namespaces:
            namespaces.append(namespace)
    return namespaces


def register_xml_namespaces(namespaces: Iterable[Tuple[str, str]]) -> None:
    for prefix, uri in namespaces:
        ET.register_namespace(prefix, uri)


def load_svg_context(svg_path: Path, geojson_path: Path) -> SvgImportContext:
    namespaces = collect_xml_namespaces(svg_path)
    register_xml_namespaces(namespaces)

    tree = ET.parse(svg_path)
    root = tree.getroot()
    target_layers = find_target_layers(root)
    existing_locations = collect_existing_locations(root)
    max_place_id = find_max_place_id(root)

    return SvgImportContext(
        tree=tree,
        root=root,
        svg_path=svg_path,
        geojson_path=geojson_path,
        target_layers=target_layers,
        existing_locations=existing_locations,
        max_place_id=max_place_id,
    )


def find_target_layers(root: ET.Element) -> Dict[str, ET.Element]:
    target_layers: Dict[str, ET.Element] = {}
    expected_layer_labels = {config["layer_label"] for config in SETTLEMENT_CONFIG.values()}

    for element in root.iter():
        if local_name(element.tag) != "g":
            continue

        layer_label = (element.get("data-layer-label") or element.get(ATTR_INKSCAPE_LABEL) or "").strip()
        if layer_label in expected_layer_labels:
            target_layers[layer_label] = element

    missing_layers = [
        config["layer_label"]
        for config in SETTLEMENT_CONFIG.values()
        if config["layer_label"] not in target_layers
    ]
    if missing_layers:
        raise ValueError(f"SVG-Layer fuer Siedlungen fehlen: {', '.join(missing_layers)}")

    return target_layers


def collect_existing_locations(root: ET.Element) -> List[ExistingLocation]:
    locations: List[ExistingLocation] = []
    for element in root.iter():
        if local_name(element.tag) not in {"circle", "ellipse"}:
            continue

        name = (
            element.get("data-place-name")
            or element.get("data-item-label")
            or element.get(ATTR_INKSCAPE_LABEL)
            or ""
        ).strip()
        if not name:
            continue

        try:
            cx = float(element.get("cx", "0"))
            cy = float(element.get("cy", "0"))
        except ValueError:
            continue

        locations.append(ExistingLocation(name=name, cx=cx, cy=cy))

    return locations


def find_max_place_id(root: ET.Element) -> int:
    max_place_id = 0
    for element in root.iter():
        raw_place_id = element.get("data-place-id")
        if not raw_place_id:
            continue
        try:
            max_place_id = max(max_place_id, int(raw_place_id))
        except ValueError:
            continue
    return max_place_id


def local_name(tag_name: str) -> str:
    return tag_name.rsplit("}", 1)[-1]


def leaflet_to_svg_coordinates(lat: float, lng: float) -> Tuple[float, float]:
    return (lng, MAP_DIMENSION - lat)


def format_iso_utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def create_svg_backup_if_needed(context: SvgImportContext) -> Tuple[Path, bool]:
    if context.backup_path is not None:
        return (context.backup_path, False)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = context.svg_path.with_name(f"{context.svg_path.stem}.backup-{timestamp}{context.svg_path.suffix}")
    shutil.copy2(context.svg_path, backup_path)
    context.backup_path = backup_path
    return (backup_path, True)


def build_new_location_element(context: SvgImportContext, report_row: ReportRow) -> ET.Element:
    config = SETTLEMENT_CONFIG[report_row.size]
    context.max_place_id += 1
    place_id = context.max_place_id
    cx, cy = leaflet_to_svg_coordinates(report_row.lat, report_row.lng)

    element = ET.Element(f"{{{SVG_NAMESPACE}}}circle")
    element.set("style", DEFAULT_POINT_STYLE)
    element.set("id", f"aves-ort-{place_id}")
    element.set("cx", f"{cx:.5f}")
    element.set("cy", f"{cy:.5f}")
    element.set(ATTR_INKSCAPE_LABEL, report_row.name)
    element.set("r", DEFAULT_POINT_RADIUS)
    element.set("data-place-id", str(place_id))
    element.set("data-place-type", config["type_code"])
    element.set("data-place-type-label", config["type_label"])
    element.set("data-place-name", report_row.name)
    element.set("data-layer-label", config["layer_label"])
    element.set("data-item-label", report_row.name)
    element.set("data-source", "manual")
    element.set("data-match-status", "manual_import")
    element.set("data-confidence", "manual_high")
    element.set("data-place-category", report_row.size)
    element.set("data-place-category-label", config["type_label"])
    element.set("data-place-icon", config["icon"])
    element.set("data-report-id", str(report_row.report_id))
    element.set("data-report-created-at", report_row.created_at)
    element.set("data-report-source", report_row.source)
    if report_row.wiki_url:
        element.set("data-report-wiki-url", report_row.wiki_url)
    if report_row.comment:
        element.set("data-report-comment", report_row.comment)
    if report_row.page_url:
        element.set("data-report-page-url", report_row.page_url)
    if report_row.client_version:
        element.set("data-report-client-version", report_row.client_version)
    if report_row.review_note:
        element.set("data-report-review-note", report_row.review_note)
    element.set("data-imported-at", format_iso_utc_now())

    return element


def append_location_to_svg(context: SvgImportContext, report_row: ReportRow, dry_run: bool) -> Tuple[float, float]:
    config = SETTLEMENT_CONFIG[report_row.size]
    target_layer = context.target_layers[config["layer_label"]]
    new_element = build_new_location_element(context, report_row)

    cx = float(new_element.get("cx", "0"))
    cy = float(new_element.get("cy", "0"))

    if dry_run:
        return (cx, cy)

    backup_path, was_created = create_svg_backup_if_needed(context)
    if was_created:
        print(f"Backup der SVG: {backup_path}")

    previous_child = target_layer[-1] if len(target_layer) else None
    if previous_child is not None and previous_child.tail:
        new_element.tail = previous_child.tail

    target_layer.append(new_element)
    context.tree.write(context.svg_path, encoding="utf-8", xml_declaration=True)
    context.existing_locations.append(ExistingLocation(name=report_row.name, cx=cx, cy=cy))
    return (cx, cy)


def regenerate_geojson(context: SvgImportContext, dry_run: bool) -> None:
    if dry_run:
        return

    svg_to_geojson(
        svg_file=context.svg_path,
        geojson_file=context.geojson_path,
    )


def find_name_conflicts(context: SvgImportContext, report_row: ReportRow) -> List[ExistingLocation]:
    normalized_name = report_row.name.strip().casefold()
    return [location for location in context.existing_locations if location.name.strip().casefold() == normalized_name]


def print_report_row(report_row: ReportRow) -> None:
    config = SETTLEMENT_CONFIG[report_row.size]
    svg_x, svg_y = leaflet_to_svg_coordinates(report_row.lat, report_row.lng)
    print("\n" + "=" * 72)
    print(f"DB-ID {report_row.report_id}: {report_row.name} ({config['type_label']})")
    print(f"Leaflet-Koordinaten: lat={report_row.lat:.3f}, lng={report_row.lng:.3f}")
    print(f"SVG-Koordinaten:     cx={svg_x:.3f}, cy={svg_y:.3f}")
    print(f"Quelle: {report_row.source or '-'}")
    if report_row.wiki_url:
        print(f"Wiki-Link: {report_row.wiki_url}")
    if report_row.comment:
        wrapped_comment = textwrap.fill(report_row.comment, width=72, subsequent_indent=" " * 11)
        print(f"Kommentar: {wrapped_comment}")
    if report_row.created_at:
        print(f"Gemeldet am: {report_row.created_at}")


def delete_report_with_feedback(backend: ImportBackend, report_row: ReportRow, dry_run: bool, reason_text: str) -> bool:
    if dry_run:
        print(f"Dry-Run: Meldung {report_row.report_id} wuerde entfernt ({reason_text}).")
        return True

    try:
        if backend.kind == "api":
            if backend.api_config is None:
                raise RuntimeError("Die Import-API-Konfiguration fehlt.")
            delete_report_via_api(backend.api_config, report_row.report_id)
        else:
            if backend.connection is None:
                raise RuntimeError("Die Datenbank-Verbindung fehlt.")
            delete_report_row(backend.connection, report_row.report_id)
            backend.connection.commit()
    except Exception as error:  # pragma: no cover - depends on external state
        if backend.kind == "database" and backend.connection is not None:
            backend.connection.rollback()
        print(
            f"Meldung {report_row.report_id} konnte nicht entfernt werden: {error}",
            file=sys.stderr,
        )
        return False

    print(f"Meldung {report_row.report_id} wurde entfernt ({reason_text}).")
    return True


def update_report_status_with_feedback(
    backend: ImportBackend,
    report_row: ReportRow,
    new_status: str,
    dry_run: bool,
    reason_text: str,
) -> bool:
    if dry_run:
        print(
            f"Dry-Run: Meldung {report_row.report_id} wuerde auf "
            f"status='{new_status}' gesetzt ({reason_text})."
        )
        return True

    try:
        if backend.kind == "api":
            if backend.api_config is None:
                raise RuntimeError("Die Import-API-Konfiguration fehlt.")
            update_report_status_via_api(backend.api_config, report_row.report_id, new_status)
        else:
            if backend.connection is None:
                raise RuntimeError("Die Datenbank-Verbindung fehlt.")
            update_report_status(backend.connection, report_row.report_id, new_status)
            backend.connection.commit()
    except Exception as error:  # pragma: no cover - depends on external state
        if backend.kind == "database" and backend.connection is not None:
            backend.connection.rollback()
        print(
            f"Meldung {report_row.report_id} konnte nicht auf status='{new_status}' gesetzt werden: {error}",
            file=sys.stderr,
        )
        return False

    print(f"Meldung {report_row.report_id} wurde auf status='{new_status}' gesetzt ({reason_text}).")
    return True


def review_rows(
    backend: ImportBackend,
    report_rows: List[ReportRow],
    context: SvgImportContext,
    dry_run: bool,
    imported_status: str,
) -> None:
    index = 0
    while index < len(report_rows):
        report_row = report_rows[index]
        print_report_row(report_row)

        name_conflicts = find_name_conflicts(context, report_row)
        if name_conflicts:
            conflict_list = ", ".join(sorted({location.name for location in name_conflicts}))
            print(f"Achtung: Ein gleichnamiger Ort ist bereits in der SVG vorhanden: {conflict_list}")

        decision = prompt_choice(
            "Importieren? [j]a / [n]ein / [q]uit: ",
            valid_choices=("j", "n", "q"),
            default_choice="n",
        )

        if decision == "q":
            print("Import beendet.")
            return

        if decision == "j":
            try:
                svg_x, svg_y = append_location_to_svg(context, report_row, dry_run=dry_run)
                regenerate_geojson(context, dry_run=dry_run)
            except Exception as error:  # pragma: no cover - depends on external state
                print(f"Fehler beim Import von {report_row.name}: {error}", file=sys.stderr)
                print("Der Eintrag bleibt erhalten.", file=sys.stderr)
                index += 1
                continue

            if dry_run:
                print(
                    f"Dry-Run: {report_row.name} wuerde bei cx={svg_x:.3f}, cy={svg_y:.3f} eingefuegt "
                    f"und anschliessend auf status='{imported_status}' gesetzt."
                )
                report_rows.pop(index)
                continue

            if update_report_status_with_feedback(
                backend,
                report_row,
                new_status=imported_status,
                dry_run=False,
                reason_text="nach Import",
            ):
                print(f"{report_row.name} wurde importiert.")
                report_rows.pop(index)
                continue

            print(
                "Der Ort wurde importiert, aber der Eintrag konnte nicht auf den Zielstatus gesetzt werden.",
                file=sys.stderr,
            )
            index += 1
            continue

        delete_decision = prompt_choice(
            "Nicht importiert. Soll der Eintrag geloescht werden? [j]a / [n]ein: ",
            valid_choices=("j", "n"),
            default_choice="n",
        )
        if delete_decision == "j":
            if delete_report_with_feedback(backend, report_row, dry_run=dry_run, reason_text="nach Ablehnung"):
                report_rows.pop(index)
                continue

        print("Eintrag bleibt erhalten.")
        index += 1


def main() -> int:
    args = parse_args()

    svg_path = Path(args.svg).resolve()
    geojson_path = Path(args.geojson).resolve()

    if not svg_path.exists():
        raise FileNotFoundError(f"SVG-Datei nicht gefunden: {svg_path}")

    backend = open_import_backend(args)
    try:
        report_rows = fetch_report_rows(backend, str(args.status).strip())

        if not report_rows:
            print(f"Keine Ortsmeldungen mit status='{args.status}' gefunden.")
            return 0

        context = load_svg_context(svg_path, geojson_path)
        review_rows(
            backend=backend,
            report_rows=report_rows,
            context=context,
            dry_run=args.dry_run,
            imported_status=str(args.imported_status).strip() or DEFAULT_IMPORTED_STATUS,
        )
    finally:
        close_import_backend(backend)

    print("Fertig.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
