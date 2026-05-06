# Avesmaps Future Map Architecture

Arbeitsstand fuer den Umbau von Avesmaps auf eine SQL-basierte, editierbare
Vektorkarte mit neuer hochaufgeloester Rasterkarte.

## Ausgangslage

- Die bestehende Anwendung ist eine statische Leaflet-1.9.4-App mit
  `L.CRS.Simple`, Kartenbounds `0..1024`, Zoomstufen `0..5` und alter
  Tile-Pyramide unter `tiles/`.
- Die fachliche Datenquelle ist aktuell `map/Aventurien_routes.svg`.
- `map/Aventurien_routes.geojson` enthaelt aktuell 6.403 Features:
  2.954 Punkte, 3.374 Linien und 75 Regionen.
- Die neue stilisierte Karte ist `32768 x 32768` Pixel gross. Das passt exakt
  zu `1024 * 2^5`, wenn die bestehenden Zoomstufen beibehalten werden.
- Die bestehende PHP-API speichert nur Ortsmeldungen in `location_reports`.

## Grundentscheidungen

- SQL wird die operative Wahrheit fuer alle Vektordaten.
- Die SVG wird nach der Migration nur noch Importquelle beziehungsweise
  Exportformat sein.
- Berechtigte Nutzer schreiben im Editmode live in SQL.
- Nicht berechtigte Community-Vorschlaege bleiben moderiert und werden erst
  nach Freigabe in die echten Kartendaten uebernommen.
- `avesmaps.de/` zeigt standardmaessig die neue stilisierte Karte.
- `avesmaps.de/edit` ist per Login geschuetzt.
- `avesmaps.de/admin` ist nur fuer Admins und verwaltet Benutzer und Rollen.
- Es bleibt bei PHP, MySQL/MariaDB und clientseitigem JavaScript ohne
  verpflichtenden Build-Schritt.

## Koordinatensystem

Die Datenbank speichert Koordinaten im bestehenden GeoJSON-/Leaflet-System:

- Weltbounds: `0..1024` auf X und Y.
- GeoJSON-Koordinaten bleiben `[x, y]`.
- Leaflet rendert weiter als `[lat, lng] = [y, x]`.
- Die neue 32k-Karte wird nicht als neuer Koordinatenraum betrachtet, sondern
  als hoehere Rasterauflosung derselben Welt.

Damit muessen bestehende Routen, Orte und Regionen nicht neu skaliert werden.
Das spaetere SQL-zu-SVG-Skript rechnet bei Bedarf in die SVG-ViewBox zurueck.

## Tile-Architektur

Kartenstile werden als austauschbare Basemap-Layer modelliert:

- `Old`: alte Karte, in dieselbe Tile-Matrix exportiert.
- `Stylized`: neue Karte, WebP, Standard fuer die oeffentliche Karte.

Empfohlene Struktur:

```text
tiles/
  old/
    manifest.json
    0/0/0.webp
    ...
  stylized/
    manifest.json
    0/0/0.webp
    ...
```

Empfohlene Tile-Matrix:

- `tileSize`: 256
- `minZoom`: 0
- `maxZoom`: 5
- hoechste native Aufloesung fuer `Stylized`: Zoom 5
- WebP mit konfigurierbarer Qualitaet, z.B. `80..88`

Der wiederholbare Workflow liegt besser in `avesmaps-map-processing`, weil dort
die grossen PSB/PNG-Dateien und Bildskripte liegen:

1. PSB in Photoshop/Affinity bearbeiten.
2. `merged_water_and_land_edited.png` exportieren.
3. Retile-Skript ausfuehren:

   ```powershell
   python scripts\retile_avesmaps_leaflet.py --input gpt-image2\merged_water_and_land_edited.png --output C:\GIT\avesmaps\tiles\stylized --format webp --quality 84 --max-zoom 5
   ```

4. Skript prueft Bildgroesse, erzeugt alle Zoomstufen, schreibt
   `manifest.json` mit Checksummen und meldet geaenderte Tiles.
5. Deployment kopiert nur geaenderte Tiles.

Im Editmode kann der Kartenstil ohne Neuladen gewechselt werden, indem der
aktive Leaflet-TileLayer entfernt und der andere mit denselben Bounds/Z-Stufen
eingeblendet wird.

## SQL-Datenmodell

Fuer Version 1 ist ein kompatibles MySQL-Modell mit GeoJSON-in-JSON plus
indizierten Bounding-Box-Spalten am robustesten. MySQL unterstuetzt zwar
Spatial Types und GeoJSON-Funktionen, aber JSON plus BBox ist auf
MySQL/MariaDB-Hosting einfacher zu deployen und fuer die aktuelle Datenmenge
mehr als ausreichend.

### map_features

Eine Tabelle fuer alle editierbaren Kartenobjekte.

```sql
CREATE TABLE map_features (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    feature_type VARCHAR(40) NOT NULL,
    feature_subtype VARCHAR(60) NOT NULL,
    name VARCHAR(160) NULL,
    geometry_type VARCHAR(40) NOT NULL,
    geometry_json JSON NOT NULL,
    properties_json JSON NULL,
    style_json JSON NULL,
    min_x DECIMAL(10, 4) NOT NULL,
    min_y DECIMAL(10, 4) NOT NULL,
    max_x DECIMAL(10, 4) NOT NULL,
    max_y DECIMAL(10, 4) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_map_features_public_id (public_id),
    KEY idx_map_features_type_active (feature_type, feature_subtype, is_active),
    KEY idx_map_features_bbox (min_x, min_y, max_x, max_y),
    KEY idx_map_features_revision (revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`feature_type`:

- `location`
- `crossing`
- `path`
- `river`
- `region`
- `label`

`feature_subtype` Beispiele:

- Orte: `dorf`, `kleinstadt`, `stadt`, `grossstadt`, `metropole`
- Wege: `pfad`, `strasse`, `reichsstrasse`, `gebirgspass`, `wuestenpfad`,
  `seeweg`
- Fluesse: `river`
- Labels: `flussname`, `meeresname`, `gebirgsname`, `regionsname`,
  `seename`, `inselname`

Fluesse sind eigene Linienfeatures. Bisherige `Flussweg`-Features werden als
`feature_type = river` und `properties_json.befahrbar = true` importiert.
Neue unbefahrbare Fluesse bekommen `befahrbar = false`.

### map_feature_relations

Relationen zwischen Features, z.B. ein Label, das einem Fluss folgt.

```sql
CREATE TABLE map_feature_relations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    from_feature_id BIGINT UNSIGNED NOT NULL,
    relation_type VARCHAR(60) NOT NULL,
    to_feature_id BIGINT UNSIGNED NOT NULL,
    properties_json JSON NULL,
    PRIMARY KEY (id),
    KEY idx_feature_relations_from (from_feature_id, relation_type),
    KEY idx_feature_relations_to (to_feature_id, relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Beispiele:

- `label_follows_feature`
- `route_uses_river`
- `derived_from_legacy_svg`

### map_proposals

Moderierte Vorschlaege aus dem oeffentlichen Frontend.

```sql
CREATE TABLE map_proposals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposal_type VARCHAR(40) NOT NULL,
    target_feature_id BIGINT UNSIGNED NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    title VARCHAR(160) NOT NULL,
    payload_json JSON NOT NULL,
    review_note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (id),
    KEY idx_map_proposals_status_created_at (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`location_reports` kann fuer Rueckwaertskompatibilitaet bleiben. Im Editmode
wird es entweder direkt angezeigt oder in `map_proposals` migriert.

### users

Serverseitiger Login mit Rollen.

```sql
CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Rollen:

- `admin`: Benutzerverwaltung, alle Edits, alle Reviews.
- `editor`: direkte Karten-Edits und Freigabe/Ablehnung von Vorschlaegen.
- `reviewer`: Vorschlaege pruefen und freigeben/ablehnen, aber keine freie
  Geometriepflege.

Passwoerter werden mit PHP `password_hash()` gespeichert und mit
`password_verify()` geprueft.

### map_revision und map_audit_log

Eine globale Revision macht Live-Aktualisierung per Polling einfach.

```sql
CREATE TABLE map_revision (
    id TINYINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO map_revision (id, revision) VALUES (1, 1);
```

`map_audit_log` speichert eine sichtbare Liste autorisierter Aenderungen, ohne
eine vollstaendige Versionierung aufzubauen.

## API-Architektur

Bestehende API-Helfer in `api/bootstrap.php` werden erweitert, nicht ersetzt.

### Oeffentlich

- `GET api/map-bootstrap.php`
  - liefert Tile-Manifest, aktuelle Revision und initiale FeatureCollection.
- `GET api/map-features.php?since_revision=123`
  - liefert seitdem geaenderte, geloeschte oder neue Features.
- `POST api/report-location.php`
  - bleibt fuer die bestehende Ortsmeldung aktiv.
- spaeter optional: `POST api/propose-feature-change.php`
  - generische Community-Vorschlaege fuer neue/veraenderte Features.

Fuer die oeffentliche Karte wird zuerst die komplette FeatureCollection geladen.
Bei aktuell 6.403 Features und 38.317 Koordinatenpunkten ist das einfacher,
zuverlaessiger fuer Suche/Routing und mit HTTP-Kompression gut vertretbar.
Viewport-Queries koennen spaeter hinzukommen.

### Auth

- `POST api/auth/login.php`
- `POST api/auth/logout.php`
- `GET api/auth/me.php`

Sessions laufen serverseitig ueber PHP-Sessions. CSRF-Schutz kommt ueber ein
Session-Token, das bei mutierenden Requests mitgesendet werden muss.

### Edit

- `GET api/editor/features.php`
- `POST api/editor/features.php`
- `PATCH api/editor/features/{id}.php`
- `DELETE api/editor/features/{id}.php`
- `GET api/editor/proposals.php`
- `POST api/editor/proposals/{id}/approve.php`
- `POST api/editor/proposals/{id}/reject.php`

Mutierende Feature-Requests senden immer `base_revision` mit. Wenn die
Datenbank bereits eine neuere Feature-Revision hat, antwortet die API mit `409`
und dem aktuellen Serverstand. So gibt es eine Wahrheit, ohne dass Nutzer
versehentlich fremde Edits ueberschreiben.

### Admin

- `GET api/admin/users.php`
- `POST api/admin/users.php`
- `PATCH api/admin/users/{id}.php`
- `DELETE api/admin/users/{id}.php`

Admin-Endpunkte pruefen `role = admin`.

## Frontend-Architektur

V1 bleibt ohne Build-Step:

```text
index.html
edit/index.php
admin/index.php
js/
  app/
    map-core.js
    map-data-client.js
    map-renderer.js
    routing.js
    labels.js
    proposal-client.js
    edit-tools.js
    admin-users.js
```

Die grosse Inline-Logik aus `index.html` wird schrittweise in Module zerlegt,
aber weiterhin per normalen `<script>`-Tags geladen.

Fuer Geometrie-Editing wird Leaflet.Editable bevorzugt:

- kein Build-Step
- passt zu eigener rechter Maustaste und eigener Seitenleiste
- kann Marker, Linien, Polygone und Multi-Geometrien editieren
- die UI bleibt Avesmaps-eigen

Wenn spaeter Schneiden, Teilen, fortgeschrittenes Snapping oder sehr grosse
Edit-Sessions wichtiger werden, kann Leaflet-Geoman erneut bewertet werden.

## Editmode UX

Der Editmode bekommt links eine Arbeitsleiste und nutzt das bestehende
Rechtsklick-Muster.

Rechtsklick-Menue:

- `Neu -> Ort`
- `Neu -> Kreuzung`
- `Neu -> Pfad`
- `Neu -> Strasse`
- `Neu -> Fluss`
- `Neu -> Seeweg`
- `Neu -> Region`
- `Neu -> Label`

Workflow fuer neue Linien/Polygone:

1. Objektkategorie waehlen.
2. Punkte auf der Karte setzen.
3. Mit Enter oder Doppelklick abschliessen.
4. Eigenschaften im Seitenpanel setzen.
5. API schreibt Feature live in SQL.
6. Globale Revision steigt.
7. Andere geoeffnete Edit-Sessions holen die Aenderung per Polling nach.

Bestehende Features:

- anklicken
- Eigenschaften bearbeiten
- Knoten verschieben
- Knoten einfuegen/loeschen
- speichern geschieht explizit oder nach kurzer Debounce-Phase

Fuer V1 ist explizites Speichern pro Feature sicherer als jede Mausbewegung
sofort zu persistieren. Nach dem Speichern ist SQL sofort die Wahrheit.

## Labels

Labels werden echte Features mit eigener Kategorie.

Label-Modi:

- `point`: gerades Label an einer Position.
- `line`: gekruemmtes Label entlang einer eigenen Linie.
- `follow_feature`: Label folgt einer Zielgeometrie, z.B. einem Fluss.

Leaflet selbst liefert keine vollstaendige automatische Label-Kollision und
keine nativen Textpfade entlang Linien. Deshalb bekommt Avesmaps eine eigene
Label-Schicht:

- SVG-Overlay fuer gekruemmte Labels mit `<textPath>`.
- Canvas/DOM-Labels fuer einfache Punktlabels.
- Prioritaeten pro Labeltyp und Zoomstufe.
- einfache Kollisionsboxen pro Viewport.
- Ausblenden niedriger Prioritaeten bei Kollision.

Label-relevante Properties:

```json
{
  "label_type": "gebirgsname",
  "label_mode": "line",
  "min_zoom": 2,
  "max_zoom": 5,
  "priority": 60,
  "font_size": 18,
  "letter_spacing": 0,
  "rotation": 0,
  "follow_feature_id": null
}
```

## Routing

Routing bleibt clientseitig, aber die Daten kommen aus SQL.

- Orte und Kreuzungen bleiben Knoten.
- Wege, Strassen, Seewege und befahrbare Fluesse bilden Kanten.
- Flussfeatures mit `befahrbar = false` werden gerendert, aber nicht als
  Flussweg geroutet.
- Der Graph wird beim Laden aus der aktuellen FeatureCollection gebaut.
- Mittel- und langfristig kann die API optional einen vorberechneten
  Routing-Graphen liefern.

## SVG-Migration und SVG-Export

Neue Skripte:

- `map/import_geojson_to_sql.py`
- `map/export_sql_to_svg.py`
- optional `map/export_sql_to_geojson.py`

Import:

1. bestehendes `svg_to_geojson.py` erzeugt GeoJSON.
2. Import-Skript normalisiert Featuretypen/Subtypen.
3. Legacy-Metadaten wie `svg_id`, Layername, Style und `data-*` Attribute
   landen in `properties_json` oder `style_json`.
4. Bisherige `Flussweg`-Linien werden zu befahrbaren Flussfeatures.

Export:

1. SQL-Features werden nach Typ/Subtyp in Inkscape-Layer geschrieben.
2. Geometrien werden aus GeoJSON in SVG-Pfade/Kreise umgesetzt.
3. Gespeicherte Legacy-Styles werden, soweit vorhanden, wiederverwendet.
4. Fehlende Inkscape-Metadaten werden minimal und stabil rekonstruiert.

Ziel ist nicht, die alte SVG byte-identisch zu erzeugen, sondern eine in
Inkscape sinnvoll editierbare SVG aus SQL zu bauen.

## Umsetzung in Phasen

### Phase 1: SQL-Foundation

- MySQL-Schema fuer Features, Proposals, User, Revision und Audit anlegen.
- Import von `Aventurien_routes.geojson` in SQL.
- Export der SQL-Daten als FeatureCollection.
- Tests mit aktuellem Routingdatenbestand.

### Phase 2: Public Read Path

- `index.html` liest Vektordaten aus API oder gecachter SQL-GeoJSON.
- Public Map nutzt `Stylized` als Default.
- Routenplanung und Suche bleiben funktional.
- Alte statische GeoJSON bleibt als Fallback bis zur Umschaltung erhalten.

### Phase 3: Auth und Admin

- Login/Logout.
- PHP-Session- und CSRF-Schutz.
- Admin-UI fuer Benutzer, Rollen und Aktiv/Inaktiv.
- Initialer Admin wird per SQL-Seed oder CLI-Skript erzeugt.

### Phase 4: Editmode

- `edit/index.php` geschuetzt.
- Feature-Auswahl und Eigenschaftenpanel.
- Live-CRUD fuer Orte, Kreuzungen, Linien, Regionen, Fluesse und Labels.
- Optimistische Konflikterkennung mit `revision`.
- Polling auf globale `map_revision`.

### Phase 5: Moderation

- Bestehende Ortsmeldungen im Editmode anzeigen.
- Annehmen erzeugt/aktualisiert ein Feature.
- Ablehnen setzt Status und Review-Notiz.
- Generische `map_proposals` fuer spaetere Community-Aenderungen.

### Phase 6: Labels

- Label-Featuretypen importieren/anlegen.
- Punktlabels rendern.
- Kurvenlabels mit SVG-Overlay rendern.
- Flusslabels optional an Flussverlauf binden.
- Kollisions- und Prioritaetsregeln pro Zoomstufe.

### Phase 7: Tile-Pipeline

- Retile-Skript fuer 32k-PNG nach WebP.
- Manifest und Checksummen.
- `Old` und `Stylized` im Editmode umschaltbar.
- Public Default auf `Stylized`.

### Phase 8: SQL zu SVG

- Export-Skript fuer Inkscape-taugliche SVG.
- Vergleichsexport mit aktuellem SQL-Stand.
- Dokumentierter Restore-/Backup-Prozess.

## Risiken

- Gekruemmte Labels mit Kollision sind die komplexeste Frontend-Aufgabe.
- Live-Edits brauchen Backup-Disziplin, auch ohne vollstaendige
  Feature-Historie.
- Gemeinsames Editing ohne harte Locks braucht klare 409-Konfliktmeldungen.
- 32k-Tiles koennen als Deployment-Artefakt gross werden; sie sollten nicht
  automatisch in Git landen.
- MySQL/MariaDB-Version muss vor dem finalen Schema geprueft werden, besonders
  fuer `JSON`-Spalten.

## Referenzen

- Leaflet 1.9.4 API: https://leafletjs.com/reference.html
- Leaflet.Editable: https://leaflet.github.io/Leaflet.Editable/
- MySQL Spatial Types: https://dev.mysql.com/doc/refman/8.0/en/spatial-type-overview.html
- MySQL JSON Functions: https://dev.mysql.com/doc/refman/8.0/en/json-functions.html
- PHP `password_verify`: https://www.php.net/manual/en/function.password-verify.php
