# Map-Features Label-Collisions Stable

## 1. Zweck

Dieses Dokument schliesst den Split der Label-Kollisionslogik aus `js/map-features.js` ab.

Der Split wurde auf Basis von `docs/map-features-label-collisions-boundary-check.md` umgesetzt und als stabile Boundary dokumentiert.

## 2. Ergebnis

Neue Datei:

```text
js/map-features-label-collisions.js
```

Commit:

```text
72ca6e983652c95c33267c158353a2a0e6869423
```

Commit-Message:

```text
Split map features label collision helpers
```

## 3. Verschobene Funktionen

Folgende Funktionen wurden als enger 1:1-Extract ausgelagert:

- `scheduleLabelCollisionResolution`
- `rectanglesOverlap`
- `expandRect`
- `getLocationNameLabelPriority`
- `getLabelOffsetCandidates`
- `setLabelElementOffset`
- `getLocationNameLabelBaseOffset`
- `getLocationNameLabelOffsets`
- `applyLocationNameLabelOffset`
- `getLabelCollisionTarget`
- `measureLabelRect`
- `measureLabelCollisionRect`
- `getCollisionEntries`
- `resolveLabelCollisions`

## 4. Script-Reihenfolge

`index.html` laedt die neue Datei im Map-Features-Bereich in dieser Reihenfolge:

```text
js/map-features-location-name-labels.js
js/map-features-label-collisions.js
js/map-features-path-domain.js
```

Diese Reihenfolge bleibt wichtig, weil die Kollisionslogik freie Labels, Ortsnamenlabels und globale Label-Konfigurationen nutzt.

## 5. Stabilitaetsentscheidung

Die Boundary ist fachlich abgeschlossen.

`js/map-features-label-collisions.js` bleibt stabil und soll nicht ohne neue Boundary-Analyse weiter aufgeteilt oder mit anderen Refactorings vermischt werden.

Weitere Aenderungen an diesem Bereich brauchen einen eigenen visuellen Label-/Zoom-/Kollisions-Smoke, weil kleine Aenderungen an DOM-Messung, Prioritaeten oder Offsets direkt sichtbare Labelpositionen beeinflussen koennen.

## 6. Naechster Schritt

Nach Abschluss dieses Splits ist der naechste plausible Boundary-Kandidat:

```text
Path-Creation
```

Path-Geometry-Editing folgt erst danach und nur mit eigener Boundary.
