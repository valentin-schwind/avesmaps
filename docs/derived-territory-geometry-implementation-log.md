# Derived Territory Geometry Implementation Log

Dieses Dokument ergaenzt `docs/derived-territory-geometry-plan.md` und protokolliert konkrete Umsetzungsschritte.

## Stand: 2026-05-28

### Umgesetzt

#### Backend-Datenmodell und API

Neue Datei:

```text
api/_internal/political/territories-derived-geometry.php
```

Enthaelt:

```text
- CREATE TABLE IF NOT EXISTS political_territory_derived_geometry
- Lesen einer aktiven derived geometry pro Territorium
- Lesen aller Quellgeometrien aus dem Unterbaum eines Territoriums
- Speichern einer derived geometry
- Deaktivieren einer derived geometry
- Public-Response-Normalisierung
```

Die Tabelle speichert automatisch erzeugte Aussengrenzen getrennt von redaktionellen Detailgeometrien.

Wichtige Felder:

```text
id
public_id
territory_id
geometry_geojson
label_lng
label_lat
min_zoom
max_zoom
min_x
min_y
max_x
max_y
source_revision
generated_at
is_active
created_by
updated_by
created_at
updated_at
```

Verhalten beim Speichern:

```text
1. Zielterritorium lesen.
2. GeoJSON validieren.
3. Bounds berechnen.
4. Zoomrange pruefen.
5. Labelposition aus Payload lesen oder aus Geometrie berechnen.
6. Alte aktive derived geometries fuer dieses Territorium deaktivieren.
7. Neue aktive derived geometry einfuegen.
```

Verhalten beim Deaktivieren:

```text
- Bestehende aktive derived geometries fuer das Territorium werden auf is_active = 0 gesetzt.
- Keine redaktionelle Detailgeometrie wird geloescht.
```

#### Endpoint-Integration

Geaenderte Datei:

```text
api/_internal/political/territories-endpoint.php
```

Ergaenzt:

```text
require_once __DIR__ . '/territories-derived-geometry.php';
require_once __DIR__ . '/territories-derived-layer.php';
```

Beim Endpoint-Start:

```text
avesmapsPoliticalEnsureDerivedGeometryTables($pdo);
```

Neue GET-Actions:

```text
derived_geometry
get_derived_geometry
derived_geometry_sources
get_derived_geometry_sources
```

Neue PATCH-Actions:

```text
save_derived_geometry
delete_derived_geometry
```

#### Oeffentliche Layer-Ausgabe

Neue Datei:

```text
api/_internal/political/territories-derived-layer.php
```

Enthaelt:

```text
avesmapsPoliticalReadLayerWithDerivedGeometry(...)
avesmapsPoliticalReadDerivedLayerFeatures(...)
```

Verhalten:

```text
- Edit-Mode bleibt unveraendert.
- Public-Layer liest zuerst den bestehenden Layer.
- Danach werden aktive derived geometries fuer Jahr/Zoom/BBox gelesen.
- Wenn eine derived geometry fuer ein Territorium existiert, wird das entsprechende Basisfeature fuer dasselbe territory_public_id aus der Ausgabe entfernt.
- Derived geometry wird als politisches Feature mit is_derived_geometry = true ausgegeben.
```

#### Client Repository

Geaenderte Datei:

```text
js/map-features/map-features-political-territory-repository.js
```

Ergaenzt:

```text
getDerivedGeometry(territoryPublicId)
getDerivedGeometrySources(territoryPublicId)
saveDerivedGeometry(payload)
deleteDerivedGeometry(territoryPublicId)
```

Zusaetzlich wird das Fallback-Modul fuer den alten Dialog dynamisch geladen:

```text
js/territory/territory-derived-geometry-editor.js
```

#### Fallback-Dialog

Neue Datei:

```text
js/territory/territory-derived-geometry-editor.js
```

Zweck:

```text
- dynamisches Panel fuer den alten region-edit-form-Fallback
- Vorschau-Layer auf der Parent-Karte
- Thumbnail-Erzeugung
- Speichern/Deaktivieren ueber neue API
```

Hinweis:

Der normale Workflow nutzt inzwischen den iframe-Editor. Das Fallback-Modul bleibt nuetzlich, weil es auch die Parent-Funktion `drawDerivedGeometryPreview(...)` fuer die Karten-Vorschau bereitstellt.

Geaenderte Fallback-Dateien:

```text
js/review/review-region-dialog-population.js
js/review/review-region-submit-flow.js
js/review/review-region-basics.js
```

Zweck:

```text
- Panel beim Befuellen des alten Dialogs synchronisieren
- derived geometry beim Speichern mitschreiben
- Vorschau beim Schliessen/Reset entfernen
```

#### Iframe-Editor

Neue Datei:

```text
js/territory/territory-derived-geometry-iframe-editor.js
```

Zweck:

```text
- reales Panel `Geometrie` im eingebetteten politischen Territorien-Editor
- Checkbox `Aussengrenzen darstellen`
- deaktivierte Checkbox `Fuer alle Unterregionen erzeugen`
- Zoom von/bis fuer derived geometry
- Thumbnail
- Statusanzeige
- Union der Unterflaechen via polygonClipping.union(...)
- Speichern nach dem normalen Assignment-Save ueber Save-Hook
```

Das Modul nutzt:

```text
- /api/app/political-territories.php?action=derived_geometry
- /api/app/political-territories.php?action=derived_geometry_sources
- PATCH save_derived_geometry
- PATCH delete_derived_geometry
```

Geaenderte Datei:

```text
js/territory/territory-editor-ui-hints.js
```

Zweck:

```text
- laedt /js/third-party/polygon-clipping.umd.min.js
- laedt danach /js/territory/territory-derived-geometry-iframe-editor.js
```

### Bekannte Einschraenkungen

```text
- `Fuer alle Unterregionen erzeugen` ist sichtbar, aber absichtlich noch deaktiviert.
- Labelposition nutzt vorerst gespeicherte Werte oder Bounding-Box-Mitte; Polylabel ist noch offen.
- source_revision/source_signature wird noch nicht automatisch aus Quellgeometrien berechnet.
- Runtime-/Browser-Test steht noch aus.
- Die iframe-UI muss im Browser geprueft werden, insbesondere ob der Ziel-Breadcrumb beim Wechsel der Auswahl korrekt aktualisiert wird.
```

### Testplan

PowerShell:

```powershell
git pull
```

Dann im Browser hart neu laden.

Manueller Funktionstest:

```text
1. Avesmaps im Edit-Modus oeffnen.
2. Politische Karte aktivieren.
3. Ein politisches Gebiet oeffnen: Eigenschaften bearbeiten.
4. Im iframe-Editor das Panel `Geometrie` suchen.
5. Ein Parent-/Breadcrumb-Territorium mit Unterflaechen auswaehlen.
6. `Aussengrenzen darstellen` aktivieren.
7. `Vorschau neu berechnen` klicken.
8. Thumbnail pruefen.
9. Karten-Vorschau pruefen.
10. Zoom von/bis setzen.
11. Speichern.
12. Politischen Layer bei passender Zoomstufe pruefen.
13. Checkbox deaktivieren und erneut speichern.
14. Pruefen, ob die derived geometry nicht mehr gerendert wird.
```

API-Pruefung im Browser:

```text
/api/app/political-territories.php?action=derived_geometry&territory_public_id=<PUBLIC_ID>&debug_errors=1
/api/app/political-territories.php?action=derived_geometry_sources&territory_public_id=<PUBLIC_ID>&debug_errors=1
```

### Relevante Commits

```text
d583047e02472a99a34d033b558e353d45617b21
8326aae4bba583f296d88b5f63be95a53f114a45
443a4996f44e4b83513de8cdb494ee990a2af3c9
f9dc2e80c2f31f90f9564da050a4604ae42b9fb7
d614e14541de72057719a303dcccd24363162382
d5439a46f1c8af12849ffea56c62246ef5b74743
0901a713d5c08b822890a19cd843002fa5a7f345
1e4528a7a6af415b4edd2b4e18b43afe818d6abd
aef0a3afff29b7a50d54ffb76cc3cdd99e1ef37b
e17089a82e24d0e749a3a2b2725ea7ea30863343
1c49d2ed04ff6ca89719c537d47498d0a1e9a95c
48b332edaea22c423544a4427096ae20ea16dd0a
c4189bc82c4ea97238fc468ea94963a9560a70ae
8adf927365d8ac3fb271f4f532634abd95f5fd23
c3112e6b7df257dd7433bca9f6a66e498de1e71a
74d3ce4c5c57ead4bcf6a923e580135f23c8732c
2246107ebbe8cf4b941d29912c5738bcf4399aa4
```
