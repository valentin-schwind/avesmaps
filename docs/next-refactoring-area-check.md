# Next Refactoring Area Check

## 1. Current Routing Stop Point

- Der Routing-Bereich bleibt vorerst stabil.
- `createGraph`, `addRegularPathToGraph`, `updateMapView`, `collectAndValidateSelectedLocations`, `buildRouteResultFromSelectedLocations` und `routing/route-graph-core.js` werden aktuell nicht weiter umgebaut.
- Ziel fuer den naechsten Schritt ist ein kleiner, verhaltensneutraler Bereich ausserhalb des Routings.

## 2. Candidate Areas

A. `js/popups.js`

- Kleinster Kandidat (ca. 393 Zeilen).
- Hauptsaechlich Markup-/Action-Builder fuer Popups.

B. `js/ui-controls.js`

- Mittelgross (ca. 554 Zeilen).
- Mischt Karten-Controls, Messwerkzeug, Transport-UI, Review-Tab-UI und Startlogik.

C. `js/dialogs-review.js`

- Sehr gross (ca. 5491 Zeilen).
- Starkes Mixing aus Dialog-UI, Form-Validierung, Persistenz, API-Aufrufen, Review/Wiki-Sync/Presence.

D. `js/map-features.js`

- Sehr gross (ca. 5608 Zeilen).
- Kern der produktiven Karte mit Rendering, Edit-Flow, URL-State, Layer-Management, API-Integrationen.

## 3. For Each Candidate

### A) `js/popups.js`

- Dateigroesse / Komplexitaet:
  - klein, fokussiert, gut ueberschaubar.
- UI-/DOM-Kopplung:
  - erzeugt HTML-Markup; keine direkte DOM-Manipulation und keine Event-Bindings.
- Globale State-Abhaengigkeiten:
  - liest globale Flags/Zustaende wie `IS_EDIT_MODE`, `pendingPathCreationStart`, `pendingPowerlineCreationStart`.
  - nutzt globale Helfer/Finder (`escapeHtml`, `buildHtmlAttributes`, `findLocationMarkerByPublicId`, `findLabelEntryByPublicId`).
- Risiko fuer produktive Karte:
  - niedrig bis mittel (primär Popup-Aktionen/Labels betroffen, kein Routing-Kern).
- Moegliche kleine 1-Commit-Schritte:
  - rein lokaler 1:1-Extract wiederholter Action-Button-Bloecke (z. B. Pfad-Weiterfuehren/Abschliessen oder Powerline-Start/Abschluss) innerhalb von `js/popups.js`.
- Doku oder direkt Code:
  - direkter kleiner Code-Schritt ist vertretbar.

### B) `js/ui-controls.js`

- Dateigroesse / Komplexitaet:
  - mittel, aber mehrere Themen in einer Datei.
- UI-/DOM-Kopplung:
  - hoch (Leaflet-Control, DOM-Events, Keyboard-Handling, LocalStorage, URL-History).
- Globale State-Abhaengigkeiten:
  - viele globale Konstanten und globale Map-/Measurement-States.
- Risiko fuer produktive Karte:
  - mittel (Transport-Menues und Distanzmessung sind user-sichtbar und interaktiv).
- Moegliche kleine 1-Commit-Schritte:
  - rein interne Helper-Extraktion in einem Teilbereich (z. B. Transport-Menu Positionierungslogik).
- Doku oder direkt Code:
  - eher zuerst Mini-Analyse fuer einen ganz konkreten Subblock.

### C) `js/dialogs-review.js`

- Dateigroesse / Komplexitaet:
  - sehr hoch; faktisch eigener Subsystem-Cluster.
- UI-/DOM-Kopplung:
  - sehr hoch (viele Dialoge, Status, Form-Handling, Fokussteuerung).
- Globale State-Abhaengigkeiten:
  - sehr hoch; zahlreiche globale Funktionen, Caches, Edit-/Review-Zustaende.
- Risiko fuer produktive Karte:
  - mittel bis hoch (Edit-/Review-Funktionen, API-Interaktion, Nebenwirkungen auf Datenzustand).
- Moegliche kleine 1-Commit-Schritte:
  - nur sehr lokal in status-/formnahen Hilfsfunktionen sinnvoll.
- Doku oder direkt Code:
  - zuerst gezielte Analyse fuer klaren Subbereich, nicht direkt refactoren.

### D) `js/map-features.js`

- Dateigroesse / Komplexitaet:
  - sehr hoch; zentrale Integrationsdatei.
- UI-/DOM-Kopplung:
  - sehr hoch (Leaflet-Layer, Popups, Interaktionen, Context-Menues, Edit-Overlays).
- Globale State-Abhaengigkeiten:
  - sehr hoch (Map-State, Feature-Arrays, URL-State, Edit-States, API-Verbindungen).
- Risiko fuer produktive Karte:
  - hoch (direkter Einfluss auf Rendering, Navigation, Editing, Datenfluss).
- Moegliche kleine 1-Commit-Schritte:
  - nur in isolierten Hilfsfunktionen; trotzdem erhoehte Regressionflaeche.
- Doku oder direkt Code:
  - zuerst Analyse statt Code.

## 4. Recommendation

Empfehlung: **A. `js/popups.js` als naechster Refactoring-Bereich**.

Begruendung nach Prioritaeten:

- kleinster Diff moeglich (kleine Datei, klarer Scope)
- verhaltensneutrale 1:1-Extraktion realistisch
- geringe Regressionflaeche gegenueber `map-features.js` und `dialogs-review.js`
- keine Aenderung am Routing erforderlich
- kein Build-System / keine Module noetig

## 5. Next Safe Commit

Empfohlener naechster sicherer Code-Schritt:

- Datei: nur `js/popups.js`
- Art: rein lokaler 1:1-Extract eines wiederverwendeten Action-Button-Blocks, z. B.:
  - Helper fuer Pfad-Weiterfuehren/Abschliessen vs. Neuer Weg
  - ohne Aenderung von Labels, `data-popup-action`-Werten oder Reihenfolge
- Grenzen:
  - keine Aenderung an Event-Handling
  - keine Aenderung an Call-Sites ausser Ersetzung des duplizierten Markup-Blocks
  - keine Routing-Dateien anfassen

Falls maximal konservativ vorgegangen werden soll:

- alternativ zuerst eine kurze Detail-Planung nur fuer `js/popups.js` (z. B. `docs/popups-helper-extraction-plan.md`) und danach den 1-Commit-Extract.
