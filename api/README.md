# Ortsmeldungen per PHP und SQL

Die API-Datei `report-location.php` nimmt neue Ortsmeldungen als JSON entgegen und
schreibt sie in die Tabelle `location_reports`.

## Dateien

- `config.example.php`: Beispiel fuer eine lokale Konfiguration ohne echte Secrets
- `report-location.php`: POST-Endpoint fuer neue Ortsmeldungen
- `bootstrap.php`: Konfigurations-, CORS- und PDO-Helfer
- `list-location-reports.php`: liest Ortsmeldungen fuer das lokale Import-Skript
- `update-location-report-status.php`: setzt den Status einer Ortsmeldung
- `delete-location-report.php`: loescht Ortsmeldungen nach Ablehnung
- `map-features.php`: liest die neue SQL-basierte Vektorkarte als GeoJSON
- `map-search.php`: liefert die Spotlight-Kartensuche fuer Orte, Labels, Regionen, benannte Wege und Kraftlinien
- `map-database-admin.php`: token-geschuetzter Aufbau der Future-Map-Tabellen
- `schema.mysql.sql`: Tabellen-Schema fuer MySQL oder MariaDB
- `schema.pgsql.sql`: Tabellen-Schema fuer PostgreSQL
- `schema.future.mysql.sql`: Future-Schema fuer User, Vektorkarte, Vorschlaege und Revisionen

## Lokale Konfiguration

1. `config.example.php` nach `config.local.php` kopieren
2. echte Datenbankwerte eintragen
3. `config.local.php` nicht committen
4. Frontend-Origin in `cors.allowed_origins` eintragen

Wenn Frontend und API auf derselben Domain liegen, reicht die eigene Origin.
Wenn das Frontend statisch auf einer anderen Domain liegt, muss diese hier
ebenfalls freigegeben werden.

Alternativ kann die API auch ueber Umgebungsvariablen konfiguriert werden:

- `AVESMAPS_DB_DRIVER`
- `AVESMAPS_DB_HOST`
- `AVESMAPS_DB_PORT`
- `AVESMAPS_DB_NAME`
- `AVESMAPS_DB_CHARSET`
- `AVESMAPS_DB_USER`
- `AVESMAPS_DB_PASSWORD`
- `AVESMAPS_ALLOWED_ORIGINS`
- `AVESMAPS_IMPORT_API_TOKEN`

`AVESMAPS_ALLOWED_ORIGINS` erwartet eine kommaseparierte Liste, zum Beispiel:

```text
http://localhost:8000,https://valentin-schwind.github.io
```

## SQL-Schema anlegen

Je nach Datenbank eines der beiden Schemata ausfuehren:

- MySQL/MariaDB: `schema.mysql.sql`
- PostgreSQL: `schema.pgsql.sql`

Beispiel:

```bash
mysql -u USER -p DBNAME < api/schema.mysql.sql
```

oder

```bash
psql -U USER -d DBNAME -f api/schema.pgsql.sql
```

## Frontend verbinden

Wenn `index.html` zusammen mit `api/` auf demselben PHP-Server laeuft, nutzt das
Formular automatisch `api/report-location.php`.

Wenn das Frontend statisch woanders liegt, muss vor dem Avesmaps-Skript eine
globale Endpoint-Variable gesetzt werden:

```html
<script>
	window.AVESMAPS_LOCATION_REPORT_ENDPOINT = "https://example.org/avesmaps/api/report-location.php";
</script>
```

## Import-Skript verbinden

Das lokale Python-Skript `map/import_reported_locations.py` kann statt direkter
Datenbankverbindung ueber die serverseitigen Admin-Endpunkte laufen. Dafuer wird
ein separates Import-Token verwendet.

Beispiel in `config.local.php`:

```php
'import_api' => [
    'token' => 'replace-with-a-long-random-import-token',
],
```

Oder per Umgebungsvariable:

```text
AVESMAPS_IMPORT_API_TOKEN=replace-with-a-long-random-import-token
```

Das Python-Skript nutzt dann:

- `list-location-reports.php`
- `update-location-report-status.php`
- `delete-location-report.php`

Lokal in PowerShell zum Beispiel:

```powershell
$env:AVESMAPS_IMPORT_API_BASE_URL = "https://example.org/avesmaps/api"
$env:AVESMAPS_IMPORT_API_TOKEN = "replace-with-a-long-random-import-token"
python map/import_reported_locations.py
```

## Future-Map-Datenbank ohne phpMyAdmin verwalten

`map-database-admin.php` ist ein enger, token-geschuetzter Wartungs-Endpoint fuer
die SQL-basierte Karte. Er fuehrt kein frei formuliertes SQL aus, sondern nur die
fest eingebauten Aktionen.

Header fuer alle Beispiele:

```powershell
$headers = @{
    "Authorization" = "Bearer replace-with-a-long-random-import-token"
    "Content-Type" = "application/json"
}
```

Status der Future-Tabellen und Feature-Zaehler:

```powershell
Invoke-RestMethod -Uri "https://example.org/avesmaps/api/map-database-admin.php" -Headers $headers
```

Future-Schema installieren:

```powershell
Invoke-RestMethod `
    -Uri "https://example.org/avesmaps/api/map-database-admin.php" `
    -Method Post `
    -Headers $headers `
    -Body '{"action":"install_schema"}'
```

GeoJSON-Import trocken pruefen:

```powershell
Invoke-RestMethod `
    -Uri "https://example.org/avesmaps/api/map-database-admin.php" `
    -Method Post `
    -Headers $headers `
    -Body '{"action":"dry_run_geojson"}'
```

Schema installieren und `map/Aventurien_routes.geojson` importieren:

```powershell
Invoke-RestMethod `
    -Uri "https://example.org/avesmaps/api/map-database-admin.php" `
    -Method Post `
    -Headers $headers `
    -Body '{"action":"install_schema_and_import_geojson","replace_existing":true}'
```

`replace_existing:true` leert nur die neuen Future-Map-Tabellen
`map_features`, `map_feature_relations` und `map_audit_log`. Die bisherigen
Ortsmeldungen bleiben unangetastet.

Ersten Admin- oder Editor-Zugang anlegen:

```powershell
Invoke-RestMethod `
    -Uri "https://example.org/avesmaps/api/map-database-admin.php" `
    -Method Post `
    -Headers $headers `
    -Body '{"action":"upsert_user","username":"valentin","password":"replace-with-a-long-password","role":"admin"}'
```

Erlaubte Rollen sind `admin`, `editor` und `reviewer`. Fuer `/edit` reichen
`admin` oder `editor`; `reviewer` ist fuer spaetere Freigabe-Workflows gedacht.

## Herrschaftsgebiete

Der politische Layer nutzt fuer neue Installationen das dreigeteilte
Herrschaftsgebiete-Modell:

- `political_territory_wiki` fuer importierte Wiki-Aventurica-Referenzdaten
- `political_territory` fuer redaktionelle Avesmaps-Felder
- `political_territory_geometry` fuer Polygon- und MultiPolygon-Geometrien
- `political_territory_relation` als Erweiterungspunkt fuer komplexere
  Beziehungen

Die Migration liegt in `sql/2026-05-15-political-territories.sql` und ist auch
in `schema.future.mysql.sql` enthalten. Der Editor-Endpoint ist
`political-territories.php`; er bietet `list`, `get`, `wiki`, `hierarchy`,
`geometries`, `layer` sowie schreibende Aktionen fuer Gebiete, Hierarchien,
Geometrien und Geometrieoperationen.

WikiSync importiert Herrschaftsgebiete ueber:

```json
{
  "action": "import_political_territories",
  "records": []
}
```

Der Editor kann JSON- oder CSV-Dateien laden und sendet sie als `records` an
WikiSync. Der Import aktualisiert nur Wiki-Referenzfelder. Redaktionelle
Overrides und vorhandene Geometrien bleiben erhalten. Nur Datensaetze fuer
`Aventurien` werden als lokale Herrschaftsgebiete angelegt.

Weitere Details: `docs/herrschaftsgebiete.md`.

## Edit-API

`map-feature-update.php` ist der erste schreibende Karten-Endpoint fuer
angemeldete Editoren. Aktuell erlaubt er Point-Features fuer Orte anzulegen,
zu verschieben, in Name/Beschreibung/Typ zu bearbeiten und weich zu loeschen.

Payload:

```json
{
  "action": "move_point",
  "public_id": "00000000-0000-0000-0000-000000000000",
  "lat": 512.125,
  "lng": 404.875
}
```

Weitere Aktionen:

- `create_point`: `name`, `feature_subtype`, `description`, `wiki_url`, `lat`, `lng`
- `update_point`: `public_id`, `name`, `feature_subtype`, `description`, `wiki_url`
- `delete_feature`: `public_id`

Der Endpoint aktualisiert je nach Aktion `geometry_json`, Bounding Box,
Feature-Revision, `updated_by`, `map_revision` und schreibt einen Eintrag in
`map_audit_log`.

## Request-Format

Die API erwartet einen `POST` mit JSON:

```json
{
  "name": "Festum",
  "size": "stadt",
  "source": "Regionalband XY",
  "wiki_url": "https://...",
  "comment": "liegt am Fluss",
  "lat": 512.125,
  "lng": 404.875,
  "page_url": "https://example.org/avesmaps/",
  "client_version": "20260424-120000",
  "website": ""
}
```

## Response-Format

Erfolg:

```json
{
  "ok": true,
  "message": "Ort wurde gemeldet."
}
```

Fehler:

```json
{
  "ok": false,
  "error": "Bitte eine Quelle angeben."
}
```
