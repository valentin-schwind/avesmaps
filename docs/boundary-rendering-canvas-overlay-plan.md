# Plan: Grenzen-Rendering — Außen solide/clip-inside + Innen gestrichelt/dedup (Canvas-Overlay)

Stand 2026-05-31. Vorbedingungen (Machbarkeit) am Prototyp bestätigt. Bauen erst nach OK.

## Ziel / Vision
Zwei getrennte Techniken, weil **eine Linie nur eine Farbe/einen Stil tragen kann**:
- **Außengrenze** (= abgeleitete Boundary eines Territoriums): **solide, farbig** (Territoriumsfarbe), **„inside" geclippt**. Zwei benachbarte Staaten zeigen so **beide** Farben nebeneinander auf ihrer jeweiligen Seite — kein Overlap-Konflikt, keine „eine Farbe gewinnt".
- **Innengrenze**: **weiß/leicht transparent, gestrichelt**, **genau EINE Rekursionstiefe** (die Trennlinien der DIREKTEN Kinder), per **Segment-Dedup nur EINMAL** gezeichnet (kein Doppellinien-Gewusel zweier gestrichelter Konturen).
- **Rekursiv:** zoomt man rein, werden die angedeuteten weißen Innenlinien zu den farbigen Außengrenzen der Kinder, die ihrerseits ihre Innengrenzen andeuten usw. Deckt sich mit dem schon gebauten Feature #2 („Füllung wandert die Hierarchie hinab").
- **KEINE GUI-Umstellung für den Karten-Betrachter.** Editor-Häkchen bleiben unverändert; nur der Trigger-Button wird umbenannt.

## Semantik (Nutzer-Vorgabe 2026-05-31)
- **„Außengrenzen an"** → solide + farbig + **clip-inside** (Existenz der Derived = „an").
- **„Innengrenzen an"** (`show_inner_boundaries`) → weiß-gestrichelt, **genau 1 Tiefe** (direkte Kinder), dedup'd, einmal pro Grenze.
- **Alle** Berechnungen passieren im Editor-/Rechtsklick-Schritt. Button **umbenennen** „Außengrenzen erzeugen/aktualisieren" → **„Grenzen berechnen"**; in diesem einen Schritt werden Außen- **und** Innengrenzen berechnet & gespeichert.
- **Keine** neue Betrachter-GUI; on-demand rechnen, statisch rendern (kein Live-Geometrierechnen beim Zoomen).

## Bestätigte Machbarkeit (Prototyp `prototype/inside-outline-proto.html` + `geom.js`)
- **Clip-„inside" auf Canvas** ist die robuste Variante (auch konkav sauber) UND günstig: gemessen **5,4 µs/Polygon, Faktor 1,68× vs. naiv** → absolut vernachlässigbar (>3000 gleichzeitige Polygone bis Frame-Grenze; die Karte zeigt nie so viele).
- Variante B (geometrischer Inset/Buffer) **verworfen** — Spikes/Selbstüberschneidungen an konkaven Ecken.
- SVG kann **kein** `stroke-alignment: inner`; avesmaps rendert **SVG** (Leaflet-Default, kein `preferCanvas`/`L.canvas`/`renderer:` in der App-JS). → Grenzlinien gehören auf eine **eigene Canvas-Overlay-Ebene** (Linien sind nicht-interaktiv: man klickt die Fläche, nicht die Linie). Das umgeht auch das SVG-Zoom-Redraw-Problem.
- **Segment-Dedup-Voraussetzung real erfüllt:** benachbarte Quellpolygone teilen exakte Stützpunkte (Breitenbruck ca037e40 / Weihenhorst 6b377f5c: **38 gemeinsame Vertices**).

## Wo was ist (Bestand, Fundstellen)
**Daten / Compute (Außengrenzen, on-demand, gespeichert):**
- Tabelle `political_territory_derived_geometry`. Ensure-Tables + `save_derived_geometry`: `api/_internal/political/territories-derived-geometry.php`.
- Kaskaden-Engine: `js/territory/territory-derived-geometry-editor.js` → `generateOrUpdateDerivedBoundaryForTerritory(territoryPublicId, {applyToSubregions})`, bottom-up über `plan.recompute_targets`; exportiert `window.AvesmapsDerivedBoundaryEditor`. Blatt-Skip (`child_boundary_source_count>0`).
- Plan-Endpoint: `derived_geometry_plan` → `territories-derived-geometry-plan.php` (liefert plan_nodes inkl. Hierarchie + recompute_targets).
- **Trigger Rechtsklick:** `js/map-features/map-features-derived-boundary-context-action.js` — Menü-Button-Text „Außengrenzen erzeugen/aktualisieren", ruft `AvesmapsDerivedBoundaryEditor.generateOrUpdateForRegion`.
- **Trigger Breadcrumb-Editor:** `js/territory/territory-derived-geometry-iframe-editor.js` `saveIfNeeded` → delegiert an die Engine (Phase-4-Umbau, HEAD ~80021bc3).
- **Backend-Layer-Emission:** `api/_internal/political/territories-derived-layer.php` (`avesmapsPoliticalReadDerivedLayerFeatures`) — emittiert Derived-Features auf ALLEN Zooms (Feature #2), inkl. `derived_fill_active`, `derived_source_*_public_ids`.

**Rendering (SVG, Leaflet-Default):**
- `js/map-features/map-features-region-rendering.js` → `buildRegionPolygonStyle` (ab Z.45):
  - Derived außen: `weight 3` (oder levelLineStyle), Territoriumsfarbe, `fillOpacity` nach Feature #2 (nur im eigenen Zoom-Band).
  - **Innen heute („C", Z.80-94):** re-styled die **QUELL-Polygone** weiß-gestrichelt (`#ffffff`/opacity 0.6/weight 1.5/dashArray "5 4") via `getActiveInnerBoundarySourceIds` (Z.148). Jede Quelle malt ihren **vollen Ring** → **Doppellinien** auf geteilten Grenzen (genau das Problem). Granularität = Blatt/Quelle (nicht direkte Kinder).
  - `getActiveOuterBoundaryHideTargets` (Z.129) blendet Kinder aus, wo die Derived füllt (`show_inner_boundaries=false` + im Band).
- `js/map-features/map-features-region-feature-normalization.js` → mappt Properties → `regionEntry` (`isDerivedGeometry`, `derivedFillActive`, `showInnerBoundaries`, `color` …).
- Flags pro Derived: Existenz der Derived ≈ „Außengrenzen an"; `show_inner_boundaries` (boolean) = „Innengrenzen an".

**Editor-Asset-Cache:** `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` (aktuell `20260531k`) cache-bustet inline-/lazy geladene Editor-Assets (inkl. iframe-editor.js über ui-hints, seit Commit 1fabf1a5). **index.html-JS (z.B. `map-features-region-rendering.js`) lädt OHNE `?v=`** → nach Edit `location.reload(true)`/Strg+Shift+R nötig. Siehe `memory/push-workflow.md`.

## Umsetzungsschritte (Reihenfolge)

### Schritt 1 — Schema + Compute: Innenlinien vorberechnen, Button umbenennen
- `territories-derived-geometry.php`: Spalte **`inner_boundary_geojson`** (nullable, JSON/TEXT) in der Ensure-Tables-Funktion ergänzen; `save_derived_geometry` nimmt das Feld an und speichert es.
- Engine (`territory-derived-geometry-editor.js`): im Generate/Recompute pro Ziel zusätzlich die **Innenlinien** rechnen:
  1. **Direkte Kinder** des Ziels bestimmen (politische `parent_id`-Kette — diese Session als zuverlässig bestätigt für die Haupt-Hierarchie; Helfer-Muster wie `findDescendants`/`findSiblings` in `territory-editor-inheritance.js`).
  2. Je direktem Kind dessen **Boundary** nehmen: Derived-Geometrie, falls vorhanden (Aggregator-Kind), sonst die Quellgeometrie (Blatt-Kind). = **eine Tiefe**, nicht rekursiv.
  3. **Segment-Dedup:** alle Kind-Ring-Kanten zerlegen → Endpunkte **runden** (Snapping-Toleranz ~3–4 Nachkommastellen als Sicherheitsnetz; Daten sind ohnehin gesnappt) → normalisierter Schlüssel (beide Endpunkte sortiert) → Kanten mit **Zähler == 2** behalten (geteilte Grenze = Innenlinie), `== 1` verwerfen (liegt auf dem Außenrand, malt die solide Außenkontur).
  4. Behaltene Kanten zu **Linienzügen stitchen** (Kante an Kante) → saubere Strich-Phase.
  5. Ergebnis als GeoJSON `MultiLineString` → in `inner_boundary_geojson` speichern.
- Bottom-up-Kaskade garantiert: Kinder vor Eltern → Kind-Boundaries existieren, wenn die Eltern-Innenlinien gerechnet werden.
- **Button umbenennen** „Außengrenzen erzeugen/aktualisieren" → **„Grenzen berechnen"** in `map-features-derived-boundary-context-action.js` (+ ggf. Panel-Button im Editor).

### Schritt 2 — Backend-Emission
- `territories-derived-layer.php`: `inner_boundary_geojson` mit ausliefern (Property am Derived-Feature ODER eigenes Linien-Feature). Das Derived-Polygon (Außengrenze) wird schon geliefert.

### Schritt 3 — Canvas-Boundary-Overlay (Rendering)
- Neue Leaflet-Ebene: eigenes `L.Layer` mit `<canvas>` (oder `L.canvas`-Renderer NUR für die Grenzen) **über** der SVG-Füll-Ebene; redraw bei `moveend`/`zoomend`; **non-interaktiv** (`pointer-events:none`). Koordinaten via `map.latLngToContainerPoint`.
- Pro sichtbarem Derived:
  - wenn **„Außengrenzen an"**: Derived-Polygon **clip-inside**, Stroke doppelt-breit, Territoriumsfarbe, **solid** (exakt Prototyp-Technik: `ctx.save(); clip(poly); stroke(lineWidth=2W); restore()`).
  - wenn **„Innengrenzen an"**: `inner_boundary_geojson` als **weiß-gestrichelte Polyline** (eine Tiefe, dedup'd, einmal).
- SVG-Seite (`buildRegionPolygonStyle`): Derived-**Stroke auf `weight 0`** (Außenlinie kommt jetzt vom Canvas); **Füllung + Klick** bleiben SVG.
- **Altes „C"-Innen-Restyling entfernen:** `getActiveInnerBoundarySourceIds` + den weiß-gestrichelt-Branch in `buildRegionPolygonStyle` (Z.80-94) zurückbauen.

### Schritt 4 — Verifikation / Cleanup
- `ASSET_VERSION` bump (Editor-Teile) + `location.reload(true)` (region-rendering ohne `?v=`).
- Live prüfen (authed Tab): zwei benachbarte Staaten → **beide Außenfarben** sichtbar, kein Overlap; Innengrenzen = **eine** saubere gestrichelte Linie, **eine** Tiefe; Zoom rein → Kinder-Außengrenzen erscheinen dort, wo vorher die weißen Innenlinien waren.

## Risiken / offene Punkte
- **Canvas-Overlay-Integration** in die bestehende Leaflet-/Feature-Pipeline (Layer-Reihenfolge, Redraw-Timing, Transform) = der größte neue Brocken → vor Vollausbau an 2–3 Gebieten verifizieren.
- **„Eine Tiefe"**: Innenlinien nur aus DIREKTEN Kindern, nicht rekursiv; Kind-Boundary = Derived (Aggregator) vs. Quellgeometrie (Blatt) korrekt wählen.
- **Dedup-Toleranz**: exakte Vertices reichen (38 bestätigt); Rundung als Sicherheitsnetz; ggf. Kanten an gemeinsamen Punkten aufsplitten, falls Unterteilung mal nicht 1:1.
- **Performance**: Clip vernachlässigbar (gemessen); Canvas-Redraw nur über **sichtbare** Features.
- Verträge wahren: `memory/identity-layering-contract.md`, on-demand-Compute-Prinzip `memory/derived-boundary-umbau.md`. CRLF-Edit-Falle (`memory/crlf-edit-gotcha.md`), Push-Workflow.

## Prototyp
`prototype/inside-outline-proto.html` (+ `geom.js`, echte Geometrien) — Wegwerf-Test, Canvas: Variante A (Clip) vs. B (Inset) vs. Naiv + Benchmark. Belegt: A robust + günstig. Kann nach Abschluss gelöscht werden.
