# Map-Features Label-Collisions Boundary Check

## 1. Zweck

Diese Boundary-Analyse prueft einen moeglichen Split aus `js/map-features.js` fuer die Label-Kollisionslogik.

Der Kandidat ist ein technischer Rendering-/Layout-Service. Er liegt zwischen freien Labels und Ortsnamenlabels und entscheidet, ob sichtbare Label-Elemente versetzt oder als kollidierend markiert werden.

Der Split waere ein klassischer globaler Script-Split ohne ES-Module und ohne Logikaenderung. Wegen direkter visueller Wirkung braucht er einen genauen Smoke.

## 2. Kandidatenfunktionen

Zu pruefende Funktionen aus `js/map-features.js`:

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

## 3. Verantwortlichkeiten

### Scheduling

- `scheduleLabelCollisionResolution`

Plant die Kollisionsberechnung per `window.requestAnimationFrame(...)` und verhindert doppelte Frames.

### Geometrie-Helfer

- `rectanglesOverlap`
- `expandRect`
- `measureLabelRect`
- `measureLabelCollisionRect`

Berechnen und vergleichen DOM-Rect-Werte fuer sichtbare Labels.

### Prioritaeten und Kandidaten

- `getLocationNameLabelPriority`
- `getLabelOffsetCandidates`
- `getLocationNameLabelOffsets`

Definieren, welche Labels Vorrang haben und welche Offset-Positionen versucht werden.

### Offset-Anwendung

- `setLabelElementOffset`
- `getLocationNameLabelBaseOffset`
- `applyLocationNameLabelOffset`
- `getLabelCollisionTarget`

Setzen CSS Custom Properties und beruecksichtigen die besondere Struktur von Ortsnamenlabels.

### Kollisionsauflosung

- `getCollisionEntries`
- `resolveLabelCollisions`

Sammeln sichtbare freie Labels und Ortsnamenlabels, sortieren nach Prioritaet und wenden die erste kollisionsfreie Position an. Falls keine Position kollisionsfrei ist, wird `is-colliding` gesetzt.

## 4. Gelesene globale Daten

Der Kandidatenblock liest:

- `labelCollisionFrameId`
- `labelMarkers`
- `locationNameLabels`
- `LOCATION_NAME_LABEL_CONFIG`
- `LOCATION_LABEL_GAP`
- `LOCATION_LABEL_SHIFT_SMALL`
- `LOCATION_LABEL_COLLISION_PADDING`
- `map`

Er liest ausserdem DOM-Zustand ueber:

- `marker.getElement()`
- `element.getBoundingClientRect()`
- `window.getComputedStyle(...)`
- CSS Custom Properties auf Label-Elementen

## 5. Geschriebene globale Daten

Der Kandidatenblock mutiert:

- `labelCollisionFrameId`

Er veraendert ausserdem DOM-/CSS-Zustand:

- entfernt `is-colliding`
- setzt `is-colliding`
- setzt `--label-offset-x`
- setzt `--label-offset-y`

Er mutiert keine Label-Datenarrays und keine Location-Daten.

## 6. Externe Abhaengigkeiten

Der Kandidatenblock benoetigt:

- `window.requestAnimationFrame(...)`
- `window.getComputedStyle(...)`
- `map.hasLayer(...)`
- `labelMarkers`
- `locationNameLabels`
- `LOCATION_NAME_LABEL_CONFIG`
- CSS-Klassen:
  - `location-name-label`
  - `is-colliding`

Ein Teil der Daten kommt aus bereits ausgelagerten Dateien:

- freie Labels aus `js/map-features-labels.js`
- Ortsnamenlabels aus `js/map-features-location-name-labels.js`

Deshalb muss die neue Datei nach diesen beiden Dateien geladen werden oder zumindest erst nach deren Globals verfuegbar sein. Da die Funktionen erst zur Laufzeit aufgerufen werden, ist eine Position vor `js/map-features.js`, aber nach beiden Label-Dateien am saubersten.

## 7. Externe Aufrufer

Wichtige Aufrufer sind voraussichtlich:

- freie Label-Flows nach Label-Anlage/Aenderung
- Ortsnamenlabel-Flows nach Marker-Sichtbarkeit oder Zoomwechsel
- Map-Zoom-/Move-/Render-Flows
- `syncLocationNameLabelVisibility(...)`
- eventuell Initialisierungs- oder Resize-Flows

Vor einem Code-Split lokal repositoryweit suchen:

```powershell
git grep -n "scheduleLabelCollisionResolution\|resolveLabelCollisions\|rectanglesOverlap\|expandRect\|getLocationNameLabelPriority\|getLabelOffsetCandidates\|setLabelElementOffset\|getLocationNameLabelBaseOffset\|getLocationNameLabelOffsets\|applyLocationNameLabelOffset\|getLabelCollisionTarget\|measureLabelRect\|measureLabelCollisionRect\|getCollisionEntries"
```

## 8. Vorgeschlagene Zieldatei

Empfohlene Datei:

```text
js/map-features-label-collisions.js
```

Begruendung:

- Der Name beschreibt den technischen Service direkt.
- Der Block betrifft sowohl freie Labels als auch Ortsnamenlabels.
- Der Name vermeidet die falsche Zuordnung zu nur einem Label-Typ.

Nicht empfohlen:

```text
js/map-features-labels-collisions.js
```

Der doppelte Plural wirkt schwerer lesbar.

## 9. Script-Reihenfolge

Empfohlene Position in `index.html`:

```text
js/map-features-location-name-labels.js
js/map-features-label-collisions.js
js/map-features-path-domain.js
...
js/map-features.js
```

Begruendung:

- `js/map-features-labels.js` wird bereits frueh geladen.
- `js/map-features-location-name-labels.js` muss vor der Kollisionsdatei liegen, weil die Kollisionslogik `locationNameLabels` und Ortsnamenlabel-Konfiguration nutzt.
- Die neue Datei muss vor `js/map-features.js` liegen, falls dort Aufrufer verbleiben.

Alternative:

```text
js/map-features-labels.js
...
js/map-features-location-name-labels.js
js/map-features-label-collisions.js
```

Die genaue Position muss mit `git grep` abgesichert werden.

## 10. Risiko

### Syntaxrisiko

Niedrig.

Die Funktionen sind normale Function-Declarations und koennen voraussichtlich 1:1 verschoben werden.

### Laufzeitrisiko

Mittel.

Der Block greift auf mehrere globale Arrays, Configs, DOM-Elemente und CSS Custom Properties zu. Script-Reihenfolge und vorhandene Globals muessen stimmen.

### UI-/Rendering-Risiko

Mittel bis hoch.

Der Split betrifft sichtbare Labelpositionen. Fehler koennen sich als ueberlappende Labels, verschobene Labels, verschwundene Labels oder falsche `is-colliding`-Klassen zeigen.

### Datenrisiko

Niedrig.

Der Block mutiert keine fachlichen Daten.

### Performance-Risiko

Niedrig bis mittel.

Die Kollisionsberechnung misst DOM-Rects und laeuft per Animation Frame. Ein Split allein sollte die Performance nicht aendern, aber doppelte Aufrufe oder fehlendes Frame-Gating waeren sichtbar.

## 11. Empfohlener Smoke

Nach einem Code-Split testen:

1. Seite laden.
2. Browser-Konsole pruefen: keine `ReferenceError`, keine `SyntaxError`.
3. Normale freie Labels sichtbar.
4. Ortsnamenlabels sichtbar.
5. Dichte Labelregion mit vielen Orten pruefen.
6. Zoomwechsel 0 bis 5: Labels verschieben sich plausibel.
7. Kartenbewegung/Pan: keine dauerhaft falschen Offsets.
8. Ortstyp-Filter an/aus: Ortsnamenlabels bleiben synchron.
9. Label-Kollisionen: keine offensichtlich ueberlappenden wichtigen Labels.
10. Kleine Orte/Dorf/Gebaeude mit Ortsnamenlabels pruefen.
11. Freie Labels und Ortsnamenlabels gemeinsam pruefen.
12. Mobile/schmale Breite kurz pruefen, falls lokal einfach moeglich.

## 12. Entscheidung

Empfehlung: Split durchfuehren, aber nur als enger 1:1-Extract.

Zu verschieben:

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

Nicht verschieben:

- freie Label-Lifecycle-Funktionen aus `js/map-features-labels.js`
- Ortsnamenlabel-Lifecycle-Funktionen aus `js/map-features-location-name-labels.js`
- Location-Marker-Rendering
- Location-Marker-Lifecycle
- DOM-/Bootstrap-Bindings als Ganzes

## 13. Offene Pruefung vor Code-Split

Vor dem Code-Split lokal pruefen:

```powershell
git grep -n "scheduleLabelCollisionResolution\|resolveLabelCollisions\|rectanglesOverlap\|expandRect\|getLocationNameLabelPriority\|getLabelOffsetCandidates\|setLabelElementOffset\|getLocationNameLabelBaseOffset\|getLocationNameLabelOffsets\|applyLocationNameLabelOffset\|getLabelCollisionTarget\|measureLabelRect\|measureLabelCollisionRect\|getCollisionEntries"
```

Ziel:

- Aufrufer erfassen
- Script-Reihenfolge absichern
- sicherstellen, dass keine Funktionen beim Laden sofort auf fehlende Globals zugreifen

## 14. Empfohlener naechster Code-Schritt

Naechster Commit nach dieser Boundary:

```text
Split map features label collision helpers
```

Minimaler Inhalt:

- neue Datei `js/map-features-label-collisions.js`
- oben genannte Funktionen aus `js/map-features.js` 1:1 verschoben
- Script-Tag in `index.html` eingefuegt
- keine weiteren Dateien

Danach gezielter Label-/Zoom-/Kollisions-Smoke.
