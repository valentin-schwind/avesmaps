# Avesmaps API

Diese API stellt die PHP-Endpunkte fuer Avesmaps bereit. Sie enthaelt oeffentliche App-Endpunkte, geschuetzte Editor- und Import-Endpunkte sowie interne PHP-Bibliotheken.

## Stabile Entwickler-API

Als stabiler externer API-Vertrag gelten derzeit nur diese Endpunkte:

```text
POST /api/route/
GET  /api/locations/
```

Andere Endpunkte werden von der Avesmaps-App, vom Editor, vom Import-Workflow oder fuer Diagnosezwecke verwendet. Sie koennen sich noch ohne Stabilitaetsversprechen aendern.

## Routing

### `POST /api/route/`

Berechnet eine serverseitige Route zwischen zwei bekannten Orten. Der alte Pfad `POST /api/route.php` bleibt als Kompatibilitaetswrapper erhalten und leitet intern auf `/api/route/`.

Minimaler Request:

```json
{
  "from": "Gareth",
  "to": "Tuzak",
  "via": [],
  "optimize": "fastest"
}
```

Typischer vollstaendiger Request:

```json
{
  "from": "Gareth",
  "to": "Tuzak",
  "via": [],
  "optimize": "fastest",
  "include_air_distance": true,
  "include_geometry": true,
  "include_steps": true,
  "include_rests": true,
  "rest_hours_per_day": 10,
  "minimize_transfers": false,
  "transports": {
    "land": "groupFoot",
    "river": "riverSailer",
    "sea": "cargoShip",
    "synthetic": "groupFoot"
  }
}
```

Erfolg:

```json
{
  "ok": true,
  "routing_engine": "server-minimal",
  "route": {
    "found": true,
    "from": "Gareth",
    "to": "Tuzak",
    "cost": 45.659557387792944,
    "summary": {
      "node_count": 12,
      "edge_count": 11
    },
    "debug": {},
    "segments": []
  }
}
```

Fehler:

```json
{
  "ok": false,
  "error": {
    "code": "location_not_found",
    "message": "Unknown from location: Beispielort"
  }
}
```

Unterstuetzte Methoden:

```text
POST    Routing-Request
OPTIONS CORS/Preflight
```

Einige technische Diagnoseabfragen koennen aktuell noch ueber `GET /api/route/?diagnostic=...` existieren. Sie sind nicht Teil des stabilen externen API-Vertrags.

## Locations

### `GET /api/locations/`

Liefert die routingfaehigen Orte aus derselben Datenbasis, die auch der serverseitige Router verwendet. Der Endpoint ist fuer Clients gedacht, die gueltige Ortsnamen fuer `/api/route/` anbieten oder validieren wollen.

Erfolg:

```json
{
  "ok": true,
  "map_revision": 123,
  "location_count": 3949,
  "locations": [
    {
      "id": "32063601-c38f-4187-9380-b023a6965a40",
      "public_id": "32063601-c38f-4187-9380-b023a6965a40",
      "name": "A'Kr'Urabaal",
      "subtype": "dorf",
      "is_crossing": false,
      "coordinates": {
        "x": 410.574,
        "y": 263.402
      }
    }
  ]
}
```

Unterstuetzte Methoden:

```text
GET     Ortsliste
OPTIONS CORS/Preflight
```

## App-Endpunkte

Die folgenden Endpunkte werden von der Avesmaps-App verwendet. Sie sind erreichbar, aber noch nicht als externe Entwickler-API stabilisiert:

```text
/api/map-features.php
/api/map-search.php
/api/report-location.php
/api/political-territories.php
/api/political-territory-wiki.php
/api/wiki-proxy.php
```

Diese Dateien werden schrittweise in die neue Zielstruktur unter `api/app/` migriert. Alte URLs bleiben dabei als Wrapper erhalten.

## Editor-, Import- und Diagnosebereiche

Die API wird in folgende Bereiche gegliedert:

```text
api/app/                    App-nahe Browser-Endpunkte
api/edit/                   geschuetzte Editor- und Review-Endpunkte
api/import/                 token-geschuetzte Import-Endpunkte
api/diagnostics/            Diagnoseendpunkte, nicht oeffentlich stabil
api/_internal/              interne PHP-Bibliotheken
api/_schema/                SQL-Schemata
```

`api/_internal/`, `api/_schema/` und `api/diagnostics/` muessen im Deployment per `.htaccess` gegen direkten Webzugriff geschuetzt sein.

## Konfiguration

1. `config.example.php` nach `config.local.php` kopieren
2. echte Datenbankwerte eintragen
3. `config.local.php` nicht committen
4. Frontend-Origin in `cors.allowed_origins` eintragen

Alternativ kann die API ueber Umgebungsvariablen konfiguriert werden:

```text
AVESMAPS_DB_DRIVER
AVESMAPS_DB_HOST
AVESMAPS_DB_PORT
AVESMAPS_DB_NAME
AVESMAPS_DB_CHARSET
AVESMAPS_DB_USER
AVESMAPS_DB_PASSWORD
AVESMAPS_ALLOWED_ORIGINS
AVESMAPS_IMPORT_API_TOKEN
```

`AVESMAPS_ALLOWED_ORIGINS` erwartet eine kommaseparierte Liste, zum Beispiel:

```text
http://localhost:8000,https://avesmaps.de
```

Wenn Frontend und API auf derselben Domain liegen, ist kein externer CORS-Origin noetig.

## SQL-Schemata

Schemata liegen perspektivisch unter:

```text
api/_schema/mysql.sql
api/_schema/pgsql.sql
api/_schema/future.mysql.sql
```

Solange alte Schema-Dateien noch im flachen API-Ordner liegen, bleiben sie fuer bestehende lokale Workflows nutzbar. Produktive Dumps, echte Reports, Auditlogs, Tokens oder Zugangsdaten duerfen nicht ins Repository.

## Ortsmeldungen und Import-Workflow

`report-location.php` nimmt neue Ortsmeldungen als JSON entgegen und schreibt sie in die Tabelle `location_reports`.

Das lokale Python-Skript `map/import_reported_locations.py` kann ueber serverseitige Admin-Endpunkte arbeiten. Dafuer wird ein separates Import-Token verwendet.

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

PowerShell-Beispiel:

```powershell
$env:AVESMAPS_IMPORT_API_BASE_URL = "https://example.org/avesmaps/api"
$env:AVESMAPS_IMPORT_API_TOKEN = "replace-with-a-long-random-import-token"
python map/import_reported_locations.py
```

## Lokale Smoke-Tests

Syntaxchecks:

```powershell
php -l api/bootstrap.php
php -l api/route.php
php -l api/route/index.php
php -l api/locations/index.php
php -l api/_internal/routing/request.php
php -l api/_internal/routing/map-data.php
php -l api/_internal/routing/network-data.php
php -l api/_internal/routing/graph.php
php -l api/_internal/routing/client-graph.php
php -l api/_internal/routing/response.php
```

HTTP-Smoke-Tests nach Deployment:

```powershell
Invoke-WebRequest -Method Options -Uri "https://avesmaps.de/api/route/"
Invoke-WebRequest -Method Options -Uri "https://avesmaps.de/api/route.php"
Invoke-WebRequest -Method Options -Uri "https://avesmaps.de/api/locations/"

$locations = Invoke-RestMethod -Method Get -Uri "https://avesmaps.de/api/locations/"
$locations.ok
$locations.location_count
$locations.locations | Select-Object -First 5
```
