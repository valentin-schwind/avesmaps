# Way-Labels: automatische Beschriftung zugewiesener Wege — Plan

> Owner-Auftrag 2026-07-05: Segmentübergreifende Beschriftung aller wiki-zugewiesenen
> Wege in regelmäßigen Bildschirm-Intervallen; die per-Segment-Checkbox „Weg anzeigen"
> entfällt für zugewiesene Wege. Unzugewiesene Segmente behalten das bisherige
> show_label-Verhalten (Owner-Lookup: 72 gelabelte unzugewiesene Segmente / 48 Namen —
> überwiegend Flüsse ohne Wiki-Artikel — dürfen nicht verschwinden). „Auto" = reines
> Client-Rendering aus bereits geladenen Daten (wiki_path.name), kein Lookup/Server-Call.

## Verhalten

- Kanal A (NEU, nur Canvas-Modus): Wege mit `properties.wiki_path.wiki_key` werden als
  Ganzes beschriftet: sichtbare Segmente eines Wegs → Endpunkt-Verkettung zu Ketten →
  Wegname (wiki_path.name, Fallback display_name) alle ~`WAY_LABEL_SCREEN_INTERVAL_PX`
  (600) Bildschirm-Pixel entlang der Kette (Glyph-Lauf wie bestehende Pfad-Labels).
  Kurze Ketten: 1 Label mittig, wenn es passt. `show_label` wird auf diesen Wegen
  IGNORIERT (keine Doppel-Labels: der per-Segment-Zweig überspringt zugewiesene Wege).
- Kanal B (unverändert): unzugewiesene Segmente rendern wie bisher per-Segment
  (show_label-gated). SVG-Fallback (`?canvaspathlabels=0`) bleibt KOMPLETT beim
  Altverhalten (auch für zugewiesene Wege) — dokumentierte Einschränkung.
- Zoom-/Toggle-Gates wie bisher (minZoom 4, #togglePaths bzw. Fluss-Label-Toggle,
  powerlines aus, cssZoomActive überspringt Redraw). Escape: `?waylabels=0`.
- Editor: Checkbox „Weg anzeigen" (Zeile in index.html um #path-edit-show-label) wird
  bei wiki-zugewiesenen Wegen AUSGEBLENDET (populatePathEditForm), Wert bleibt
  unverändert im Payload (Checkbox behält befüllten Zustand).

## Bausteine (Anker aus der Recon)

- Neues Modul `js/map-features/map-features-way-labels.js`: pure Helfer
  `buildWayLabelChains(segments)` (Endpunkt-Adjazenz mit gerundetem Koordinaten-Key,
  Grad-1-Start, Verzweigung = Kettenschnitt) und
  `computeWayLabelIntervalOffsets(totalLenPx, intervalPx, textLenPx)` (Mittelpunkte,
  halbes Intervall Versatz; [] wenn textLen > totalLen*0.9). Integration in
  `map-features-path-label-canvas-overlay.js` redraw(): Partition pathData sichtbar →
  zugewiesen (Kanal A) / sonst (Kanal B alt). Glyphen via vorhandenem
  `drawGlyphsAlong` (:42), Stil via `getPathLabelStyle`/Halo wie gehabt, Leitlinie je
  Segment via `getPathLabelVisualLatLngCoordinates` (:155 rendering), Screen-Projektion
  `map.latLngToContainerPoint`. Selbstkollision: akzeptierte Label-BBoxen je redraw,
  Überlappung → Platzierung auslassen.
- Sichtbarkeit: neue Fn `isWayLabelEligible(path)` = wie `isPathLabelVisibleAtCurrentZoom`
  (path-labels.js:17) OHNE `shouldPathNameBeDisplayed`, PLUS `wiki_path.wiki_key` vorhanden.
- Per-Segment-Zweig (canvas overlay + SVG refreshPathLayerText NICHT anfassen —
  nur Canvas-Zweig): überspringe Segmente mit wiki_key, wenn Way-Labels aktiv.
- Editor: review-paths.js populatePathEditForm → Checkbox-Label verstecken wenn
  pathWikiCurrentAssignment(); guards wie üblich (typeof).
- Tests `tools/paths/test-way-labels.mjs` (extractFunction-Muster): Ketten-Bau
  (2 Segmente verbunden; 3 mit Lücke → 2 Ketten; Verzweigung → Schnitt; Reihenfolge/
  Richtung stabil) + Intervall-Offsets (lange Kette n Labels, kurze 1, zu kurz 0).

## Nicht-Ziele / Constraints

- Kein Server-/Datenmodell-Change; show_label-Daten bleiben unangetastet.
- Keine Änderung am DOM-Kollisionssystem (Canvas-Pfad-Labels nehmen daran heute auch
  nicht teil); nur Selbstkollision der Way-Labels untereinander.
- Perf: Ketten nur über VIEWPORT-gefilterte zugewiesene Segmente, nur auf
  moveend/zoomend/resize (nie pro Frame, nie während cssZoomActive); tab-indent, classic
  scripts, deutsche UI-Strings, TABS.
- Rollout: 1 Commit Modul+Overlay+Editor+Tests; danach Push durch Controller, Live-Check
  (Highlight-Zählung + Owner-Sichtprüfung), `?waylabels=0` als Rückfallebene.
