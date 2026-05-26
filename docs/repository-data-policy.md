# Repository-Datenpolicy

Stand: 2026-05-25

Dieses Dokument legt fest, welche Informationen, Dateien und Konfigurationen im Avesmaps-GitHub-Repository liegen duerfen und welche nicht. Es ergaenzt den API-Restrukturierungsplan und ist besonders fuer die geplante PHP/API-Ordnerstruktur relevant.

## Grundsatz

Das GitHub-Repository darf Code, Dokumentation, Beispielkonfigurationen, Schemata und nicht-geheime Kartendaten enthalten. Es darf keine produktiven Zugangsdaten, Tokens, Passwoerter, privaten Sessions, Datenbankdumps mit Nutzerdaten oder geheimen Serverdetails enthalten.

Alles, was zur Reproduzierbarkeit der Anwendung noetig ist, darf ins Repository, sofern es keine Secrets oder personenbezogenen Daten enthaelt.

Alles, was einen realen Serverzugang, eine reale Datenbank, einen produktiven API-Key oder nicht oeffentliche Nutzerdaten offenlegt, darf nicht ins Repository.

## Darf ins Repository

### Code

Erlaubt:

```text
HTML, CSS, JavaScript
PHP-Endpunkte
PHP-Libraries
Python-Skripte
SQL-Schema-Dateien
GitHub Actions Workflows
.htaccess-Regeln
Smoke-Test-Skripte
```

Code darf auch interne Architektur enthalten, z. B. Routinggraph-Aufbau, Wiki-Sync-Logik oder Editorlogik. Dass Code intern verwendet wird, macht ihn nicht geheim. Er muss aber so organisiert werden, dass interne PHP-Dateien im Deployment nicht direkt per URL abrufbar sind.

### Dokumentation

Erlaubt:

```text
docs/*.md
README.md
API-Vertraege
Migrationsplaene
Smoke-Test-Beschreibungen
Architekturentscheidungen
Beispielrequests und Beispielresponses
```

Dokumentation darf beschreiben, welche Endpunkte es gibt, welche Methoden und Felder sie erwarten und welche Fehlercodes auftreten koennen. Sie darf keine realen Tokens, Passwoerter oder privaten Serverpfade enthalten.

### Beispielkonfigurationen

Erlaubt:

```text
config/api.config.example.php
.env.example
Beispielwerte wie example.org, localhost, replace-with-token
```

Beispielkonfigurationen muessen klar als Beispiele erkennbar sein. Platzhalter duerfen niemals echte Zugangsdaten sein.

Erlaubte Beispiele:

```php
'database' => [
    'host' => 'localhost',
    'name' => 'avesmaps',
    'user' => 'avesmaps_user',
    'password' => 'replace-with-password',
]
```

```text
AVESMAPS_IMPORT_API_TOKEN=replace-with-a-long-random-token
```

### SQL-Schemata

Erlaubt:

```text
api/_schema/mysql.sql
api/_schema/pgsql.sql
api/_schema/future.mysql.sql
```

Schemata duerfen Tabellen, Indizes, Constraints, Beispielkommentare und leere Seed-Strukturen enthalten.

Nicht erlaubt in Schema-Dateien sind produktive Dumps mit echten Nutzern, echten Passwort-Hashes, echten Tokens, privaten Reports oder produktiven Auditlogs.

### Oeffentliche oder redaktionell kontrollierte Kartendaten

Erlaubt, sofern bewusst freigegeben:

```text
GeoJSON
SVG-Quelldaten
statische Kartendaten
Ortsnamen
Wege
Regionen
politische Territorien
Wiki-URLs
nicht geheime Routingdaten
```

Diese Daten sind Kern der App. Sie duerfen ins Repository, wenn sie redaktionell kontrolliert sind und keine privaten Nutzerbeitraege oder Moderationsnotizen enthalten.

### .htaccess

Erlaubt und gewuenscht:

```text
.htaccess
api/.htaccess
api/_internal/.htaccess
api/_schema/.htaccess
api/diagnostics/.htaccess
```

`.htaccess` ist Teil der deployten Sicherheitsarchitektur und gehoert ins Repository. Besonders wichtig sind Zugriffssperren fuer interne Ordner.

## Darf nicht ins Repository

### Produktive Secrets

Verboten:

```text
api/config.local.php
.env
API-Tokens
Import-Tokens
Session-Secrets
Datenbankpasswoerter
FTP/SFTP-Zugangsdaten
SSH-Schluessel
OAuth-Client-Secrets
Google-Service-Account-Keys
```

Diese Werte muessen lokal, serverseitig oder in GitHub Secrets liegen.

### Produktive Serverdetails

Nicht ins Repository gehoeren:

```text
produktiver Datenbankname, falls nicht bewusst oeffentlich
produktiver DB-User
produktiver DB-Host, falls nicht bewusst oeffentlich
absolute interne Serverpfade
Hosting-Kontrollpanel-Zugangsdaten
SFTP-Host/User/Passwort
```

GitHub Actions duerfen Secret-Namen referenzieren, aber nicht deren Werte.

Erlaubt:

```yaml
AVESMAPS_HOST: ${{ secrets.AVESMAPS_HOST }}
```

Nicht erlaubt:

```yaml
AVESMAPS_HOST: real.server.example
AVESMAPS_PASSWORD: echtes-passwort
```

### Personenbezogene oder moderationelle Daten

Nicht ins Repository gehoeren:

```text
reale Nutzermeldungen aus location_reports
E-Mail-Adressen von Meldern
IP-Adressen
Admin-/Editor-Userdaten
Sessiondaten
Auditlogs aus Produktion
Moderationsnotizen
private Kommentare aus Review-Prozessen
```

Wenn Beispielreports benoetigt werden, muessen sie synthetisch und klar als Demo-Daten erkennbar sein.

### Produktive Datenbankdumps

Nicht erlaubt:

```text
vollstaendige SQL-Dumps aus Produktion
Dumps mit Nutzern
Dumps mit Tokens
Dumps mit Auditlogs
Dumps mit nicht geprueften Community-Meldungen
```

Erlaubt sind nur leere Schemata oder bewusst anonymisierte, kleine Testfixtures.

## Soll in GitHub Secrets liegen

```text
AVESMAPS_HOST
AVESMAPS_PORT
AVESMAPS_USER
AVESMAPS_PASSWORD
AVESMAPS_REMOTE_PATH
```

Weitere moegliche Secrets:

```text
AVESMAPS_IMPORT_API_TOKEN
AVESMAPS_DB_PASSWORD
AVESMAPS_DB_USER
AVESMAPS_DB_HOST
AVESMAPS_DB_NAME
```

Wenn diese Werte fuer GitHub Actions nicht gebraucht werden, bleiben sie ausschliesslich auf dem Server oder lokal.

## Soll lokal oder serverseitig liegen

```text
api/config.local.php
api/.env
.env
map/google-sheets-credentials.json
map/google-sheets-token.json
```

Diese Dateien duerfen nicht committed werden. Der Deploy-Workflow soll sie nicht hochladen oder ueberschreiben.

## Muss vor Webzugriff geschuetzt werden

Auch wenn Code im Repository liegen darf, darf nicht alles im Web abrufbar sein.

Harter Schutz per `.htaccess` fuer:

```text
api/_internal/
api/_schema/
api/diagnostics/
```

Minimaler Inhalt:

```apache
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>

<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

Wichtig: Repository-Sichtbarkeit und Web-Erreichbarkeit sind verschiedene Dinge. Interner Code darf im GitHub-Repo liegen, aber im Deployment nicht direkt als URL ausfuehrbar oder lesbar sein.

## API-Dokumentation und Stabilitaetsversprechen

Dokumentiert als stabile Entwickler-API werden nur Endpunkte, die bewusst als externer Vertrag gedacht sind:

```text
POST /api/route/
GET  /api/locations/
```

Nicht automatisch als externe Entwickler-API versprochen werden:

```text
/api/app/*
/api/edit/*
/api/import/*
/api/diagnostics/*
```

`api/app/*` darf vom Browser erreichbar sein, ist aber primaer Infrastruktur fuer die Avesmaps-App. Diese Endpunkte koennen spaeter dokumentiert werden, wenn sie bewusst stabilisiert wurden.

`api/edit/*` ist geschuetzt und nur fuer Editor-/Review-Funktionen gedacht.

`api/import/*` ist token-geschuetzt und fuer lokale Import-/Moderationsskripte gedacht.

`api/diagnostics/*` ist nicht fuer oeffentliche Nutzung gedacht.

## Pruefregeln vor Commits

Vor API-/Deployment-Commits pruefen:

```text
1. Enthaelt der Commit config.local.php, .env oder echte Tokens?
2. Enthaelt der Commit produktive Datenbankdumps?
3. Enthaelt der Commit reale Nutzerdaten, Reports oder Auditlogs?
4. Sind neue interne Ordner per .htaccess geschuetzt?
5. Verweist die Dokumentation nur auf Platzhalterwerte?
6. Bleiben GitHub Actions bei Secret-Referenzen statt echten Werten?
7. Sind Beispielresponses anonym oder synthetisch?
```

## Smoke-Test fuer Zugriffsschutz

Nach Deployment muessen diese URLs nicht oeffentlich verwertbar sein:

```text
GET /api/_internal/bootstrap.php
GET /api/_internal/auth.php
GET /api/_schema/mysql.sql
GET /api/diagnostics/political-schema.php
```

Erwartung: `403 Forbidden` oder eine andere nicht verwertbare Antwort. Keine PHP-Fehlerausgabe, kein SQL-Inhalt, keine Konfigurationsdetails.

## Umgang mit versehentlich committed Secrets

Wenn ein Secret versehentlich committed wurde:

1. Secret sofort als kompromittiert betrachten.
2. Secret auf Server/Provider/GitHub rotieren.
3. Commit nicht nur revertieren; das Secret bleibt sonst in der Git-Historie.
4. Historienbereinigung nur gezielt und bewusst durchfuehren.
5. Danach Deploy- und Zugriffstests wiederholen.

## Entscheidung fuer die API-Restrukturierung

Fuer den geplanten Umbau bedeutet diese Policy:

- `_internal` und `_schema` duerfen im Repo liegen.
- `_internal` und `_schema` muessen im Web gesperrt werden.
- `config.local.php` bleibt ausserhalb des Repos.
- `config/api.config.example.php` darf im Repo bleiben.
- Die Route- und Locations-API darf dokumentiert werden.
- App-, Edit-, Import- und Diagnose-Endpunkte werden klar von der dokumentierten Entwickler-API getrennt.
