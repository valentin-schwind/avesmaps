# API-Restrukturierungsplan

Stand: 2026-05-25

Dieses Dokument beschreibt den geplanten Umbau der PHP/API-Struktur von Avesmaps. Ziel ist eine klare Trennung zwischen dokumentierter Entwickler-API, App-internen Endpunkten, Editor-/Import-Endpunkten, Diagnosewerkzeugen, internen PHP-Libraries und SQL-Schemas.

Der Plan ist bewusst als Arbeitsgrundlage fuer die naechsten Refactoring-Schritte geschrieben. Die API soll dabei nicht nur optisch aufgeraeumt werden, sondern stabiler, sicherer und langfristig dokumentierbar werden.

## Grundsaetze

1. Die Entwickler-API soll nicht nur Fassade sein. Avesmaps selbst soll die kanonische Routing-API verwenden.
2. Extern dokumentiert werden nur Endpunkte, die als stabiler Vertrag gedacht sind.
3. Browser-erreichbare App-Endpunkte sind nicht automatisch eine oeffentliche Entwickler-API.
4. Interne PHP-Dateien und SQL-Schemas duerfen nicht direkt per URL abrufbar sein.
5. Alte URLs bleiben zunaechst als Wrapper erhalten, damit Frontend, Editor, Importskripte und bestehende Tests nicht gleichzeitig brechen.
6. Die Dokumentation wird erst nach der technischen Strukturentscheidung und den wichtigsten Wrappern aktualisiert.

## Zielstruktur

```text
api/
  route/
    index.php

  locations/
    index.php

  app/
    map-features.php
    map-search.php
    report-location.php
    political-territories.php
    political-territory-wiki.php
    wiki-proxy.php

  edit/
    map/
      features.php
      audit-log.php
      presence.php

    reports/
      locations.php

    wiki/
      sync.php
      territories.php
      dom-sync.php
      dom-source.php
      dom-filter.php
      playground-seed.php

    political/
      assignment.php
      display-overrides.php
      subtree-display.php
      assignment-zoom-sync.php

  import/
    location-reports/
      index.php
      update-status.php
      delete.php

  diagnostics/
    .htaccess
    political-schema.php
    route-map-data.php
    route-network-data.php
    route-location-node.php

  _internal/
    .htaccess
    bootstrap.php
    auth.php

    routing/
      request.php
      map-data.php
      network-data.php
      graph.php
      client-graph.php
      response.php

    wiki/
      sync.php
      locations.php
      territories.php
      territories-dom.php

    political/
      territory.php

  _schema/
    .htaccess
    mysql.sql
    pgsql.sql
    future.mysql.sql
```

`api/config.example.php` bleibt vorerst direkt unter `api/`, weil es ein bewusst sichtbares Beispiel fuer Betreiber ist. `api/config.local.php` bleibt ebenfalls der lokale/serverseitige Konfigurationsort, wird aber nicht committed und vom Deploy weiterhin ausgeschlossen.

## Dokumentierte Entwickler-API

Nur diese Endpunkte sollen als stabile Entwickler-API dokumentiert werden:

```text
POST /api/route/
GET  /api/locations/
```

`/api/route/` berechnet Routen und liefert JSON. Dieser Endpunkt wird auch von der Avesmaps-App selbst verwendet.

`/api/locations/` liefert eine schlanke Liste routingfaehiger Orte. Entwickler koennen damit gueltige Eingaben fuer `/api/route/` ermitteln, ohne das interne Kartenfeaturemodell verstehen zu muessen.

Nicht als stabile Entwickler-API dokumentiert werden zunaechst:

```text
/api/app/map-features.php
/api/app/map-search.php
/api/app/report-location.php
/api/app/political-territories.php
/api/app/political-territory-wiki.php
```

Diese Endpunkte duerfen vom Browser erreichbar sein, sind aber App-Infrastruktur und koennen staerker am internen Datenmodell haengen.

## Datei-Mapping

### Routing

```text
api/route.php
  -> api/route/index.php
```

`api/route/index.php` wird der kanonische Routing-Endpunkt. `api/route.php` bleibt als Kompatibilitaetswrapper erhalten.

```text
api/route-request.php
  -> api/_internal/routing/request.php

api/route-map-data.php
  -> api/_internal/routing/map-data.php

api/route-network-data.php
  -> api/_internal/routing/network-data.php

api/route-graph.php
  -> api/_internal/routing/graph.php

api/route-response.php
  -> api/_internal/routing/response.php
```

Falls vorhanden oder im Zuge der Paritaetspruefung neu angelegt:

```text
api/route-client-graph.php
  -> api/_internal/routing/client-graph.php
```

Die bisherigen Diagnosemodi aus `route.php`, etwa `?diagnostic=map-data`, sollen langfristig aus dem oeffentlichen Routing-Endpunkt herausgeloest werden:

```text
route.php?diagnostic=map-data
  -> api/diagnostics/route-map-data.php

route.php?diagnostic=network-data
  -> api/diagnostics/route-network-data.php

route.php?diagnostic=location-node-data
  -> api/diagnostics/route-location-node.php
```

### Locations-API

Neu:

```text
api/locations/index.php
```

Der Endpoint soll aus derselben Datenbasis arbeiten wie der Serverrouter. Er soll keine vollstaendige `map_features`-FeatureCollection liefern, sondern nur routingfaehige Orte.

Vorgeschlagenes Response-Modell:

```json
{
  "ok": true,
  "revision": 123,
  "locations": [
    {
      "id": "gareth",
      "name": "Gareth",
      "type": "metropole",
      "type_label": "Metropole",
      "x": 123.45,
      "y": 678.9,
      "has_land": true,
      "has_river": true,
      "has_sea": false
    }
  ]
}
```

Die genaue Berechnung von `has_land`, `has_river` und `has_sea` sollte aus dem Routingnetz abgeleitet werden, nicht aus frei geratenen Orts-Metadaten.

### App-Endpunkte

```text
api/map-features.php
  -> api/app/map-features.php

api/map-search.php
  -> api/app/map-search.php

api/report-location.php
  -> api/app/report-location.php

api/political-territories.php
  -> api/app/political-territories.php

api/political-territory-wiki.php
  -> api/app/political-territory-wiki.php

api/wiki-proxy.php
  -> api/app/wiki-proxy.php
```

Alte Dateien bleiben zunaechst als Wrapper erhalten:

```php
<?php
require __DIR__ . '/app/map-features.php';
```

Bei `political-territory-wiki.php` sollte im Zuge des Umbaus geprueft werden, ob der Endpoint noch eigene Config-/PDO-/CORS-Logik enthaelt. Ziel ist, auch hier den gemeinsamen Bootstrap zu verwenden.

### Edit-Endpunkte

```text
api/map-feature-update.php
  -> api/edit/map/features.php

api/map-audit-log.php
  -> api/edit/map/audit-log.php

api/editor-presence.php
  -> api/edit/map/presence.php

api/location-report-review.php
  -> api/edit/reports/locations.php

api/wiki-sync.php
  -> api/edit/wiki/sync.php

api/wiki-sync-territories.php
  -> api/edit/wiki/territories.php

api/wiki-dom-sync.php
  -> api/edit/wiki/dom-sync.php

api/wiki-dom-sync-source.php
  -> api/edit/wiki/dom-source.php

api/wiki-dom-sync-filter.php
  -> api/edit/wiki/dom-filter.php

api/wiki-dom-playground-seed.php
  -> api/edit/wiki/playground-seed.php

api/political-territory-assignment.php
  -> api/edit/political/assignment.php

api/political-territory-display-overrides.php
  -> api/edit/political/display-overrides.php

api/political-territory-subtree-display.php
  -> api/edit/political/subtree-display.php

api/political-territory-assignment-zoom-sync.php
  -> api/edit/political/assignment-zoom-sync.php
```

Auch hier bleiben alte URLs zunaechst als Wrapper erhalten, damit Editor-Frontend und bestehende Links nicht sofort angepasst werden muessen.

### Import-Endpunkte

```text
api/list-location-reports.php
  -> api/import/location-reports/index.php

api/update-location-report-status.php
  -> api/import/location-reports/update-status.php

api/delete-location-report.php
  -> api/import/location-reports/delete.php
```

Diese Endpunkte bleiben token-geschuetzt. Das lokale Importskript kann spaeter auf die neuen URLs umgestellt werden. Bis dahin bleiben die alten flachen Endpunkte als Wrapper erhalten.

### Diagnose

```text
api/debug-political-schema.php
  -> api/diagnostics/political-schema.php
```

Weitere Diagnose-Endpunkte aus dem Routing werden wie oben beschrieben ausgelagert.

`api/diagnostics/` wird nicht als normale API dokumentiert. Der Ordner wird per `.htaccess` standardmaessig gesperrt oder spaeter gezielt per Auth/IP freigegeben.

### Interne Infrastruktur

```text
api/bootstrap.php
  -> api/_internal/bootstrap.php

api/auth.php
  -> api/_internal/auth.php
```

`auth.php` ist Infrastrukturcode fuer Sessions, Login, Rollen und Capabilities. Es ist kein Endpoint.

`bootstrap.php` muss nach dem Verschieben die API-Root stabil bestimmen. Wichtig: Endpoints duerfen nicht je nach Tiefe ihres Ordners an unterschiedlichen Orten nach `config.local.php` suchen.

Vorgeschlagene Konstante:

```php
define('AVESMAPS_API_ROOT', dirname(__DIR__));
```

wenn `bootstrap.php` in `api/_internal/bootstrap.php` liegt.

### Wiki-Libraries

```text
api/wiki-sync-lib.php
  -> api/_internal/wiki/sync.php

api/wiki-sync-locations-lib.php
  -> api/_internal/wiki/locations.php

api/wiki-sync-territories-lib.php
  -> api/_internal/wiki/territories.php

api/wiki-sync-territories-dom-lib.php
  -> api/_internal/wiki/territories-dom.php
```

Die Dateinamen werden im Zielordner bewusst gekuerzt, weil der Ordnerkontext bereits `wiki` und `_internal` ausdrueckt.

### Political-Library

```text
api/political-territory-lib.php
  -> api/_internal/political/territory.php
```

### Schema

```text
api/schema.mysql.sql
  -> api/_schema/mysql.sql

api/schema.pgsql.sql
  -> api/_schema/pgsql.sql

api/schema.future.mysql.sql
  -> api/_schema/future.mysql.sql
```

`api/_schema/` wird per `.htaccess` gesperrt.

## .htaccess

Die Root-`.htaccess` erlaubt aktuell grundsaetzlich Zugriff und deaktiviert nur Directory Listing. Deshalb brauchen interne API-Ordner eigene Sperren.

Mindestschutz:

```text
api/_internal/.htaccess
api/_schema/.htaccess
api/diagnostics/.htaccess
```

Inhalt fuer gesperrte Ordner:

```apache
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>

<IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
</IfModule>
```

Fuer `api/diagnostics/` kann spaeter eine Auth- oder IP-Freigabe statt harter Sperre verwendet werden. Startpunkt bleibt: nicht oeffentlich.

## Kompatibilitaetswrapper

Alte URLs bleiben zunaechst erhalten. Beispiele:

```php
<?php
require __DIR__ . '/route/index.php';
```

```php
<?php
require __DIR__ . '/app/map-features.php';
```

```php
<?php
require __DIR__ . '/edit/wiki/sync.php';
```

Die Wrapper sollten moeglichst keine eigene Logik enthalten. Sie sind nur Weiterleitungen auf den neuen kanonischen Code.

## Frontend-Umstellung

Der Routing-Client soll nach erfolgreicher Wrapper-Migration den neuen kanonischen Endpoint verwenden:

```js
window.AVESMAPS_ROUTE_ENDPOINT || "api/route/"
```

Aktuell relevante API-Pfade muessen im Frontend gesucht und schrittweise angepasst werden, insbesondere:

```text
api/route.php
api/map-features.php
api/map-search.php
api/report-location.php
api/map-feature-update.php
api/wiki-sync.php
api/political-territories.php
api/political-territories-2.php
api/political-territory-wiki.php
```

Besonderheit: Fuer politische Territorien wurde bereits festgelegt, dass bevorzugt die absolute URL genutzt wird:

```js
const API_URL = "https://avesmaps.de/api/political-territories-2.php";
```

Diese Datei bzw. dieser Pfad muss vor dem Umbau gezielt gesucht und in das Mapping aufgenommen werden, falls er noch produktiv genutzt wird.

## Import-Skript-Umstellung

Das lokale Importskript kann zunaechst ueber alte Wrapper weiterlaufen. Danach wird es auf die neue Struktur umgestellt.

Alt:

```text
/api/list-location-reports.php
/api/update-location-report-status.php
/api/delete-location-report.php
```

Neu:

```text
/api/import/location-reports/
/api/import/location-reports/update-status.php
/api/import/location-reports/delete.php
```

Die Umgebungsvariable `AVESMAPS_IMPORT_API_BASE_URL` kann vorerst auf `/api` bleiben, wenn das Skript die neuen Pfade kennt.

## Smoke-Tests

Nach jedem groesseren Schritt sollen mindestens diese Tests durchgefuehrt werden.

Oeffentlich/kanonisch:

```text
GET  /api/locations/
POST /api/route/
```

Kompatibilitaet:

```text
POST /api/route.php
GET  /api/map-features.php
GET  /api/map-search.php?q=Gareth
POST /api/report-location.php
```

Editor/Auth, sofern Session vorhanden:

```text
POST /api/map-feature-update.php
GET  /api/wiki-sync.php?action=cases
```

Import/Token:

```text
GET   /api/list-location-reports.php?status=neu
PATCH /api/update-location-report-status.php
POST  /api/delete-location-report.php
```

Sicherheitschecks:

```text
GET /api/_internal/bootstrap.php     -> 403 oder keine verwertbare Ausgabe
GET /api/_schema/mysql.sql           -> 403
GET /api/diagnostics/political-schema.php -> 403 oder bewusst geschuetzt
```

Routing-Regression:

```text
https://avesmaps.de/?route=Gareth&route=Tuzak
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak
https://avesmaps.de/?route=Gareth&route=Tuzak&route=Paavi
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak&route=Paavi
```

Erwartung: Serverrouting und Clientrouting bleiben fachlich vergleichbar. Explizite Wegpunkte wie `Tuzak` muessen im Routenplan sichtbar bleiben.

## Empfohlene Commit-Reihenfolge

Nicht alles in einem Commit umbauen. Ziel ist, jeden Schritt einzeln testen und notfalls zurueckrollen zu koennen.

### Commit 1: Protected API folder skeleton

- Zielordner anlegen.
- `.htaccess` fuer `_internal`, `_schema`, `diagnostics` hinzufuegen.
- Noch keine grossen Codeverschiebungen.

### Commit 2: Stabilize bootstrap root handling

- `bootstrap.php` auf stabile API-Root-Erkennung vorbereiten.
- Config-Ladepfade pruefen.
- Alle bestehenden Endpunkte muessen danach noch an alter Position funktionieren.

### Commit 3: Move routing internals and expose `/api/route/`

- Routing-Libraries nach `_internal/routing/` verschieben.
- `api/route/index.php` als kanonischen Endpoint anlegen.
- `api/route.php` als Wrapper erhalten.
- Frontend noch nicht zwingend umstellen.

### Commit 4: Add `/api/locations/`

- Routingfaehige Orte aus dem Routingnetz ausgeben.
- Response bewusst klein und stabil halten.
- Noch keine externe Doku versprechen, bevor Smoke-Test passt.

### Commit 5: Move app endpoints behind wrappers

- `map-features`, `map-search`, `report-location`, politische App-Endpunkte und `wiki-proxy` nach `api/app/` verschieben.
- Alte Dateien als Wrapper erhalten.
- Frontend optional spaeter auf neue Pfade umstellen.

### Commit 6: Move edit endpoints behind wrappers

- `edit/map`, `edit/reports`, `edit/wiki`, `edit/political` anlegen.
- Geschuetzte Endpunkte verschieben.
- Alte flache Endpunkte als Wrapper erhalten.
- Editor-Frontend pruefen.

### Commit 7: Move import endpoints behind wrappers

- Import-Endpunkte nach `api/import/location-reports/` verschieben.
- Alte Endpunkte als Wrapper erhalten.
- Lokales Python-Importskript anschliessend separat umstellen.

### Commit 8: Move diagnostics

- Diagnosecode aus `route.php` herausloesen.
- `api/diagnostics/` schuetzen.
- Debug-Doku entsprechend anpassen.

### Commit 9: Update documentation

- `api/README.md` neu schreiben.
- Entwickler-API `/api/route/` und `/api/locations/` dokumentieren.
- App-, Edit-, Import- und Diagnosebereiche klar abgrenzen.
- Alte Routing-Phase-1-Hinweise entfernen oder archivieren.

## Offene Entscheidungen

1. Soll `/api/route/` neben POST auch GET fuer einfache Browser-Tests akzeptieren?
2. Welche Felder sind im stabilen `/api/locations/` Response garantiert?
3. Wird `api/diagnostics/` komplett gesperrt oder per Auth/IP erreichbar gemacht?
4. Sollen alte Wrapper dauerhaft bleiben oder nach einer Uebergangszeit entfernt werden?
5. Wird `map-search` langfristig durch eine eigene Entwickler-Suche ergaenzt, z. B. `/api/locations/search/`?

## Nicht-Ziele fuer den ersten Umbau

- Keine vollstaendige REST-Neuentwicklung aller App-Endpunkte.
- Keine sofortige Entfernung alter URLs.
- Keine externe Stabilitaetsgarantie fuer `api/app/*`.
- Keine groessere Aenderung am Datenbankschema, ausser sie ist fuer `/api/locations/` zwingend noetig.
- Keine gleichzeitige Umstellung des gesamten Editor-Frontends ohne Wrapper.
