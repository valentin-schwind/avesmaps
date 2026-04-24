#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import shutil
import sys
import textwrap
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials as UserCredentials
    from google.oauth2.service_account import Credentials as ServiceAccountCredentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
except ImportError as import_error:  # pragma: no cover - depends on local environment
    print(
        "Fehlende Python-Abhängigkeiten für den Google-Sheets-Zugriff.\n"
        "Bitte zuerst installieren:\n"
        "  pip install -r map/requirements-location-import.txt",
        file=sys.stderr,
    )
    raise SystemExit(import_error) from import_error

from svg_to_geojson import svg_to_geojson


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
DEFAULT_SHEET_ID = "1BCAH1WFP49YqcMYAYK2GEBf_IGmy3KM9hrWqTqMGebo"
DEFAULT_WORKSHEET_NAME = "Ortsmeldungen"
DEFAULT_ROW_STATUS = "neu"

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
}


@dataclass
class ReportRow:
    row_number: int
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
        description="Importiert neue Ortsmeldungen interaktiv aus Google Sheets in die SVG und aktualisiert das GeoJSON."
    )
    parser.add_argument(
        "--credentials",
        default=str(map_dir / "google-sheets-credentials.json"),
        help="Pfad zur Google-OAuth- oder Service-Account-JSON-Datei.",
    )
    parser.add_argument(
        "--token",
        default=str(map_dir / "google-sheets-token.json"),
        help="Pfad zur gespeicherten OAuth-Token-Datei fuer lokale Logins.",
    )
    parser.add_argument(
        "--sheet-id",
        default=DEFAULT_SHEET_ID,
        help="Spreadsheet-ID der Ortsmeldungen.",
    )
    parser.add_argument(
        "--worksheet",
        default=DEFAULT_WORKSHEET_NAME,
        help="Name des Tabellenblatts mit den Meldungen.",
    )
    parser.add_argument(
        "--status",
        default=DEFAULT_ROW_STATUS,
        help="Es werden nur Zeilen mit diesem Status verarbeitet.",
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
        help="Zeigt nur an, was passieren wuerde, ohne SVG, GeoJSON oder Sheet zu veraendern.",
    )
    return parser.parse_args()


def normalize_header(header_value: str) -> str:
    return header_value.strip().lower().replace(" ", "_")


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


def collect_xml_namespaces(svg_path: Path) -> List[Tuple[str, str]]:
    namespaces: List[Tuple[str, str]] = []
    for _, namespace in ET.iterparse(svg_path, events=("start-ns",)):
        if namespace not in namespaces:
            namespaces.append(namespace)
    return namespaces


def register_xml_namespaces(namespaces: Iterable[Tuple[str, str]]) -> None:
    for prefix, uri in namespaces:
        ET.register_namespace(prefix, uri)


def load_google_credentials(credentials_path: Path, token_path: Path):
    if not credentials_path.exists():
        raise FileNotFoundError(
            f"Google-Credentials-Datei nicht gefunden: {credentials_path}\n"
            "Lege dort entweder eine OAuth-Client-JSON oder eine Service-Account-JSON ab."
        )

    credentials_payload = json.loads(credentials_path.read_text(encoding="utf-8"))
    credentials_type = credentials_payload.get("type")

    if credentials_type == "service_account":
        return ServiceAccountCredentials.from_service_account_file(str(credentials_path), scopes=SCOPES)

    credentials = None
    if token_path.exists():
        credentials = UserCredentials.from_authorized_user_file(str(token_path), SCOPES)

    if credentials and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        token_path.write_text(credentials.to_json(), encoding="utf-8")
        return credentials

    if credentials and credentials.valid:
        return credentials

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
    credentials = flow.run_local_server(port=0)
    token_path.write_text(credentials.to_json(), encoding="utf-8")
    return credentials


def build_sheets_service(credentials):
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def get_sheet_metadata(service, spreadsheet_id: str, worksheet_name: str) -> Dict[str, object]:
    spreadsheet = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    for sheet in spreadsheet.get("sheets", []):
        properties = sheet.get("properties", {})
        if properties.get("title") == worksheet_name:
            return properties
    raise ValueError(f"Tabellenblatt '{worksheet_name}' wurde im Spreadsheet nicht gefunden.")


def parse_report_row(row_number: int, row_values: Sequence[str], header_map: Dict[str, int]) -> Optional[ReportRow]:
    def get_value(column_name: str) -> str:
        index = header_map.get(column_name)
        if index is None or index >= len(row_values):
            return ""
        return str(row_values[index]).strip()

    name = get_value("name")
    if not name:
        return None

    status = get_value("status")
    size = get_value("size").lower()
    lat_text = get_value("lat")
    lng_text = get_value("lng")
    if not lat_text or not lng_text:
        return None

    try:
        lat = float(lat_text)
        lng = float(lng_text)
    except ValueError:
        return None

    return ReportRow(
        row_number=row_number,
        created_at=get_value("created_at"),
        status=status,
        name=name,
        size=size,
        lat=lat,
        lng=lng,
        source=get_value("source"),
        wiki_url=get_value("wiki_url"),
        comment=get_value("comment"),
        page_url=get_value("page_url"),
        client_version=get_value("client_version"),
        review_note=get_value("review_note"),
    )


def fetch_report_rows(service, spreadsheet_id: str, worksheet_name: str, status_filter: str) -> Tuple[int, List[ReportRow]]:
    metadata = get_sheet_metadata(service, spreadsheet_id, worksheet_name)
    sheet_id = int(metadata["sheetId"])
    value_range = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{worksheet_name}'",
    ).execute()
    rows = value_range.get("values", [])
    if not rows:
        return sheet_id, []

    header_map = {normalize_header(value): index for index, value in enumerate(rows[0])}
    parsed_rows: List[ReportRow] = []
    normalized_status_filter = status_filter.strip().lower()

    for zero_based_index, row_values in enumerate(rows[1:], start=1):
        report_row = parse_report_row(zero_based_index + 1, row_values, header_map)
        if report_row is None:
            continue
        if report_row.status.lower() != normalized_status_filter:
            continue
        if report_row.size not in SETTLEMENT_CONFIG:
            print(
                f"Zeile {report_row.row_number} wird uebersprungen: unbekannte Ortsgroesse '{report_row.size}'.",
                file=sys.stderr,
            )
            continue
        parsed_rows.append(report_row)

    return sheet_id, parsed_rows


def delete_sheet_row(service, spreadsheet_id: str, sheet_id: int, row_number: int) -> None:
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "deleteDimension": {
                        "range": {
                            "sheetId": sheet_id,
                            "dimension": "ROWS",
                            "startIndex": row_number - 1,
                            "endIndex": row_number,
                        }
                    }
                }
            ]
        },
    ).execute()


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
    for element in root.iter():
        if local_name(element.tag) != "g":
            continue

        layer_label = (element.get("data-layer-label") or element.get(ATTR_INKSCAPE_LABEL) or "").strip()
        if layer_label in {config["layer_label"] for config in SETTLEMENT_CONFIG.values()}:
            target_layers[layer_label] = element

    missing_layers = [config["layer_label"] for config in SETTLEMENT_CONFIG.values() if config["layer_label"] not in target_layers]
    if missing_layers:
        raise ValueError(f"SVG-Layer fuer Siedlungen fehlen: {', '.join(missing_layers)}")

    return target_layers


def collect_existing_locations(root: ET.Element) -> List[ExistingLocation]:
    locations: List[ExistingLocation] = []
    for element in root.iter():
        if local_name(element.tag) not in {"circle", "ellipse"}:
            continue

        name = (element.get("data-place-name") or element.get("data-item-label") or element.get(ATTR_INKSCAPE_LABEL) or "").strip()
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
    print(f"Zeile {report_row.row_number}: {report_row.name} ({config['type_label']})")
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


def adjust_remaining_row_numbers(rows: Sequence[ReportRow], deleted_row_number: int) -> None:
    for row in rows:
        if row.row_number > deleted_row_number:
            row.row_number -= 1


def review_rows(service, spreadsheet_id: str, sheet_id: int, report_rows: List[ReportRow], context: SvgImportContext, dry_run: bool) -> None:
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
                if dry_run:
                    print(
                        f"Dry-Run: {report_row.name} wuerde bei cx={svg_x:.3f}, cy={svg_y:.3f} eingefuegt "
                        "und anschliessend aus dem Sheet geloescht."
                    )
                else:
                    delete_sheet_row(service, spreadsheet_id, sheet_id, report_row.row_number)
                    print(f"{report_row.name} wurde importiert und aus dem Google Sheet geloescht.")
                deleted_row_number = report_row.row_number
                report_rows.pop(index)
                adjust_remaining_row_numbers(report_rows, deleted_row_number)
                continue
            except Exception as error:  # pragma: no cover - depends on external state
                print(f"Fehler beim Import von {report_row.name}: {error}", file=sys.stderr)
                print("Der Sheet-Eintrag bleibt erhalten.", file=sys.stderr)
                index += 1
                continue

        delete_decision = prompt_choice(
            "Nicht importiert. Soll der Sheet-Eintrag geloescht werden? [j]a / [n]ein: ",
            valid_choices=("j", "n"),
            default_choice="n",
        )
        if delete_decision == "j":
            if dry_run:
                print(f"Dry-Run: Zeile {report_row.row_number} wuerde aus dem Google Sheet geloescht.")
            else:
                delete_sheet_row(service, spreadsheet_id, sheet_id, report_row.row_number)
                print(f"Zeile {report_row.row_number} wurde aus dem Google Sheet geloescht.")
            deleted_row_number = report_row.row_number
            report_rows.pop(index)
            adjust_remaining_row_numbers(report_rows, deleted_row_number)
            continue

        print("Eintrag bleibt im Google Sheet erhalten.")
        index += 1


def main() -> int:
    args = parse_args()

    credentials_path = Path(args.credentials).resolve()
    token_path = Path(args.token).resolve()
    svg_path = Path(args.svg).resolve()
    geojson_path = Path(args.geojson).resolve()

    if not svg_path.exists():
        raise FileNotFoundError(f"SVG-Datei nicht gefunden: {svg_path}")

    credentials = load_google_credentials(credentials_path, token_path)
    service = build_sheets_service(credentials)
    sheet_id, report_rows = fetch_report_rows(service, args.sheet_id, args.worksheet, args.status)

    if not report_rows:
        print(f"Keine Ortsmeldungen mit status='{args.status}' gefunden.")
        return 0

    context = load_svg_context(svg_path, geojson_path)
    review_rows(
        service=service,
        spreadsheet_id=args.sheet_id,
        sheet_id=sheet_id,
        report_rows=report_rows,
        context=context,
        dry_run=args.dry_run,
    )

    print("Fertig.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
