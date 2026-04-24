# Ortsmeldungen per PHP und SQL

Die API-Datei `report-location.php` nimmt neue Ortsmeldungen als JSON entgegen und
schreibt sie in die Tabelle `location_reports`.

## Dateien

- `config.example.php`: Beispiel fuer eine lokale Konfiguration ohne echte Secrets
- `report-location.php`: POST-Endpoint fuer neue Ortsmeldungen
- `bootstrap.php`: Konfigurations-, CORS- und PDO-Helfer
- `schema.mysql.sql`: Tabellen-Schema fuer MySQL oder MariaDB
- `schema.pgsql.sql`: Tabellen-Schema fuer PostgreSQL

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
