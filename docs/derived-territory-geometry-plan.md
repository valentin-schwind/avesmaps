# Derived Territory Geometry Plan

Dieses Dokument beschreibt den geplanten Workflow fuer automatisch abgeleitete Aussengrenzen von Herrschaftsgebieten in Avesmaps. Es dient zugleich als Arbeitsprotokoll fuer die schrittweise Umsetzung.

## Ziel

Avesmaps pflegt weiterhin die Detailgeometrien redaktionell. Das sind die kleinsten konkret gezeichneten oder importierten Flaechen, zum Beispiel Provinzen, Baronien, freie Geometrien oder einzelne Herrschaftsgebiete.

Uebergeordnete Herrschaftsgebiete sollen ihre sichtbare Aussengrenze nicht manuell gezeichnet bekommen. Stattdessen wird ihre Aussengrenze aus den zugeordneten Unterflaechen automatisch erzeugt.

Beispielmodell:

```text
Bundeslaender werden gepflegt.
Deutschland wird automatisch aus der Union der Bundeslaender erzeugt.
```

Fuer Avesmaps:

```text
Detailflaechen bleiben Quelle.
Reiche, Koenigreiche, Provinzverbuende oder andere Parent-Territorien bekommen abgeleitete Aussengrenzen.
```

## Grundprinzip

Die automatisch erzeugte Aussengrenze ist keine redaktionelle Quellgeometrie. Sie ist eine abgeleitete Darstellungsgeometrie.

Die Quelle bleibt:

```text
political_territory_geometry
```

Die Ableitung kommt in eine neue Tabelle:

```text
political_territory_derived_geometry
```

Damit bleiben manuelle Datenpflege und automatisch berechnete Kartendarstellung getrennt.

## Datenmodell

### Bestehende Tabelle: political_territory_geometry

Bleibt unveraendert.

Verwendung:

```text
- manuell/redaktionell gepflegte Detailgeometrien
- source = editor, legacy, manual, editor-assignment, editor-split, ...
- wird weiter fuer Editieren, Splitten, Zuweisen und Detaildarstellung genutzt
```

### Neue Tabelle: political_territory_derived_geometry

Geplante Verwendung:

```text
- automatisch berechnete Parent-/Reichs-Aussengrenzen
- territory_id
- source_revision oder source_signature
- generated_at
- min_zoom
- max_zoom
- geometry_geojson
- label_lng
- label_lat
- is_active / enabled
```

Vorgeschlagene Felder:

```text
id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
public_id CHAR(36) NOT NULL UNIQUE
territory_id BIGINT UNSIGNED NOT NULL
geometry_geojson JSON NOT NULL
label_lng DECIMAL(12, 6) NULL
label_lat DECIMAL(12, 6) NULL
min_zoom TINYINT UNSIGNED NULL
max_zoom TINYINT UNSIGNED NULL
source_revision VARCHAR(255) NULL
generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
is_active TINYINT(1) NOT NULL DEFAULT 1
created_by BIGINT UNSIGNED NULL
updated_by BIGINT UNSIGNED NULL
created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
```

Optional koennen Bounding-Box-Spalten ergaenzt werden, falls BBox-Filter fuer derived Geometrien wichtig werden:

```text
min_x, min_y, max_x, max_y
```

## UI-Plan

Im bestehenden Herrschaftsgebiet-Editor wird ein neues Panel ergaenzt:

```text
Geometrie
```

Inhalt:

```text
[ ] Aussengrenzen darstellen
[ ] Fuer alle Unterregionen erzeugen
Zoom von [ ]
Zoom bis [ ]
Thumbnail / Vorschau der erzeugten Geometrie
Status / Fehlermeldungen
```

### Aussengrenzen darstellen

Wenn aktiviert:

```text
- das aktuell ausgewaehlte Breadcrumb-Territorium wird als Ziel genommen
- alle relevanten Unterflaechen werden gesammelt
- polygonClipping.union(...) erzeugt daraus eine Aussengrenze
- die Aussengrenze wird sofort als Vorschau auf der Karte angezeigt
- ein Thumbnail zeigt die abgeleitete Geometrie verkleinert
```

Wenn deaktiviert:

```text
- die derived geometry fuer dieses Territorium wird deaktiviert oder geloescht
- in der angegebenen Zoomstufe wird dieses Parent-Territorium nicht als abgeleitete Aussengrenze gerendert
```

Wichtig: Das Deaktivieren muss weiterhin erlauben, dass in einer Zoomstufe kein Parent-Territorium gerendert wird.

### Fuer alle Unterregionen erzeugen

Wenn aktiviert:

```text
- nicht nur fuer das aktuell ausgewaehlte Breadcrumb-Territorium wird eine Aussengrenze erzeugt
- auch fuer untergeordnete Territorien mit eigenen Kindern werden derived geometries erzeugt
- Blatt-/Unterste-Stufe-Territorien bekommen normalerweise keine derived geometry
```

Regel:

```text
Derived geometry nur fuer Territorien, deren sichtbare Flaeche nicht direkt aus genau einer eigenen political_territory_geometry gerendert werden soll.
```

## Client-Geometrie

Die Union wird clientseitig erzeugt, weil polygon-clipping bereits im Frontend vorhanden ist.

Vorhandene Basis:

```text
window.polygonClipping.union(...)
normalizeClippingMultiPolygon(...)
clippingMultiPolygonToGeoJson(...)
regionEntryToClippingMultiPolygon(...)
```

Geplanter Ablauf:

```text
1. Ziel-Territorium aus Breadcrumb/Editor-State bestimmen.
2. Relevante Kind-/Unterflaechen aus geladenen politischen Geometrien sammeln.
3. In clipping MultiPolygon konvertieren.
4. polygonClipping.union(...) ausfuehren.
5. Ergebnis normalisieren.
6. In GeoJSON zurueckwandeln.
7. Vorschau-Layer auf der Karte anzeigen.
8. Thumbnail aktualisieren.
9. Beim Speichern GeoJSON an API senden.
```

## Labelposition

Fuer derived geometries soll die Labelposition auf der abgeleiteten Aussengrenze berechnet und gespeichert werden.

Bevorzugt:

```text
Polylabel / Pole of Inaccessibility
```

Fallback:

```text
Bounding-Box-Mitte wie bisher
```

Die bestehende Funktion `avesmapsPoliticalComputeGeometryLabelCenter(...)` berechnet derzeit nur die Bounding-Box-Mitte. Sie soll entweder erweitert oder durch eine robustere Funktion ergaenzt werden.

## API-Plan

Neue API-Actions im politischen Endpoint:

```text
get_derived_geometry
save_derived_geometry
delete_derived_geometry
```

Optional spaeter:

```text
list_derived_geometries
rebuild_derived_geometry
```

### get_derived_geometry

Eingabe:

```text
territory_public_id
```

Antwort:

```text
ok
territory_public_id
derived_geometry oder null
```

### save_derived_geometry

Eingabe:

```text
territory_public_id
geometry_geojson
min_zoom
max_zoom
label_lng
label_lat
is_active
source_revision / source_signature optional
```

Verhalten:

```text
- liest Zielterritorium
- validiert GeoJSON
- validiert Zoomrange
- berechnet Bounds falls noetig
- deaktiviert alte derived geometry fuer dieses Territorium oder aktualisiert sie
- speichert neue aktive derived geometry
```

### delete_derived_geometry

Eingabe:

```text
territory_public_id
```

Verhalten:

```text
- setzt derived geometry fuer das Territorium inaktiv
- loescht keine redaktionelle Detailgeometrie
```

## Layer-Rendering

Die oeffentliche politische Layer-Ausgabe muss aktive derived geometries in passenden Zoomstufen beruecksichtigen.

Geplantes Verhalten:

```text
Wenn active derived geometry fuer ein Territorium existiert und Zoom passt:
    derived Aussengrenze rendern
    label_lng / label_lat aus derived geometry nutzen

Wenn keine active derived geometry existiert:
    keine automatische Parent-Aussengrenze rendern
    bestehende Detail-/Fallback-Logik bleibt erhalten
```

Wichtig: Derived geometries sollen nicht mit Detailgeometrien verwechselt werden. Der Client soll sie aber als politische Territorien rendern koennen.

Moegliche Feature-Properties:

```text
source = political_territory_derived
feature_type = political_territory
is_derived_geometry = true
show_region_label = true
label_lng
label_lat
```

## Unterste Territorien

Fuer Territorien der untersten Stufe werden normalerweise keine derived geometries benoetigt.

Regel:

```text
Unterste Stufe:
    rendert political_territory_geometry
    keine derived geometry noetig

Uebergeordnete Stufe:
    rendert political_territory_derived_geometry
    entsteht aus Union der Unterflaechen
```

Ausnahmen koennen spaeter eingefuehrt werden, zum Beispiel fuer Inselgruppen oder vereinfachte Darstellungsgeometrien.

## Implementierungsreihenfolge

### Schritt 1: Dokumentation

Status: geplant / begonnen

- Dieses Dokument anlegen.
- Zielbild und Datenmodell fixieren.

### Schritt 2: Backend-Datenmodell

- `political_territory_derived_geometry` in `avesmapsPoliticalEnsureTables(...)` ergaenzen.
- Neue Hilfsfunktionen fuer Fetch/Upsert/Delete der derived geometry anlegen.
- Moeglichst eigenes Modul `territories-derived-geometry.php` anlegen.
- Endpoint require erweitern.

### Schritt 3: API-Actions

- `get_derived_geometry`
- `save_derived_geometry`
- `delete_derived_geometry`

### Schritt 4: Client Repository

- `politicalTerritoryRepository` um Derived-Methoden erweitern.
- Keine direkte Kopplung an DOM im Repository.

### Schritt 5: UI Panel

- Neues Panel in `index.html` im `region-edit-form` einfuegen.
- Checkboxen, Zoomfelder, Thumbnail-Container und Statusfeld ergaenzen.
- CSS falls noetig klein halten.

### Schritt 6: Preview-Logik

- Zielterritorium aus Breadcrumb/Editor-State bestimmen.
- Unterflaechen sammeln.
- Union mit `polygonClipping.union(...)` bilden.
- Vorschau-Layer anzeigen.
- Thumbnail zeichnen.

### Schritt 7: Speichern

- Beim Speichern des Herrschaftsgebiet-Editors derived geometry mitspeichern, falls Panel aktiv ist.
- Bei deaktivierter Checkbox derived geometry deaktivieren.
- Reload der politischen Ebene ausloesen.

### Schritt 8: Layer-Integration

- Aktive derived geometries in `territories-layer.php` lesen.
- In passenden Zoomstufen als politische Features ausliefern.
- Label aus stored label_lng / label_lat verwenden.

### Schritt 9: Polylabel

- Serverseitige Labelpunktfunktion verbessern.
- Optional clientseitig fuer Vorschau denselben Algorithmus oder vorerst Bounds-Fallback verwenden.

### Schritt 10: Tests / manuelle Pruefung

- Parent ohne Kinder.
- Parent mit genau einem Kind.
- Parent mit mehreren angrenzenden Kindern.
- Parent mit Inseln / Exklaven.
- Deaktivierte Aussengrenze.
- Zoom von/bis.
- Editor-Mode vs Public-Mode.
- Speichern, Reload, erneutes Oeffnen des Editors.

## Arbeitsprotokoll

### 2026-05-28

- Plan fachlich geklaert.
- Festgelegt: Detailflaechen bleiben Quelle, Parent-Aussengrenzen werden als derived geometries gespeichert.
- Festgelegt: Unterste Territorien brauchen normalerweise keine derived geometries.
- Festgelegt: Union wird clientseitig mit `polygonClipping.union(...)` erzeugt.
- Festgelegt: Neues UI-Panel im Herrschaftsgebiet-Editor heisst `Geometrie`.
- Festgelegt: Checkbox `Aussengrenzen darstellen` erzeugt und zeigt Vorschau.
- Festgelegt: Checkbox `Fuer alle Unterregionen erzeugen` erzeugt auch fuer untergeordnete Parent-Territorien derived geometries.
- Festgelegt: Deaktivieren muss moeglich bleiben, damit ein Parent in einer Zoomstufe nicht als Aussengrenze gerendert wird.
- Repository auf aktuellem `master` gescannt.
- Relevante Dateien identifiziert:
  - `api/_internal/political/territory.php`
  - `api/_internal/political/territories-endpoint.php`
  - `api/_internal/political/territories-layer.php`
  - `api/_internal/political/territories-geometry.php`
  - `api/_internal/political/assignment.php`
  - `js/map-features/map-features.js`
  - `js/map-features/map-features-region-rendering.js`
  - `js/map-features/map-features-region-geometry-helpers.js`
  - `js/map-features/map-features-region-boolean-geometry.js`
  - `js/map-features/map-features-political-territory-repository.js`
  - `index.html`

## Noch offen vor Implementierung

- Exakte Strategie fuer `source_revision` / `source_signature` definieren.
- Entscheiden, ob `political_territory_derived_geometry` Bounding-Box-Spalten bekommt.
- Pruefen, ob der Client genug Kindgeometrien geladen hat, um alle Unterflaechen eines Parent-Territoriums sicher zu unionen.
- Falls nicht: API-Read fuer child source geometries ergaenzen.
