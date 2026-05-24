# Map-Features Path-Creation Boundary Check

## 1. Zweck
Diese Analyse bewertet einen moeglichen spaeteren Split des Path-Creation-Blocks aus `js/map-features.js`.

Wichtig: Dies ist **noch kein Code-Split**. Es werden nur Boundaries, Abhaengigkeiten, Risiken und ein moeglicher spaeterer Schritt dokumentiert.

## 2. Kandidatenfunktionen
Gepruefte Kernkandidaten aus `js/map-features.js`:
- `clearPendingPathCreation`
- `showPendingPathCreationPreview`
- `updatePendingPathCreationLine`
- `findNearestGraphEndpointToLatLng`
- `startPathCreationAt`
- `startPathCreationFromLocation`
- `appendPendingPathCreationLocation`
- `extendPendingPathCreationAtLocation`
- `completePendingPathCreationAtLocation`
- `handlePendingPathCreationClick`

Boundary-Einschaetzung pro Funktion:
- **geeignet fuer Path-Creation-Split**:
  - `showPendingPathCreationPreview`
  - `updatePendingPathCreationLine`
  - `startPathCreationAt`
  - `startPathCreationFromLocation`
  - `appendPendingPathCreationLocation`
  - `extendPendingPathCreationAtLocation`
  - `completePendingPathCreationAtLocation`
  - `handlePendingPathCreationClick`
- **geeignet, aber mit Cross-Boundary-Kopplung**:
  - `clearPendingPathCreation` (wird auch beim Start der Path-Geometry-Bearbeitung verwendet)
  - `findNearestGraphEndpointToLatLng` (wird auch von Geometry-Editing genutzt)

Zusaetzlicher Grenzfall in direkter Naehe:
- `getVisualLatLngCoordinates(...)` wird in `updatePendingPathCreationLine(...)` genutzt, liegt aber im Inline-Script in `index.html` und ist **Abhaengigkeit**, kein Kandidat fuer diesen Split.

## 3. Verantwortlichkeiten
Der Block deckt die Path-Creation-Fachlogik ab:
- Pending-State verwalten (`start`, `points`, `preview`, `line`)
- Preview-Marker / Preview-Linie erstellen und aufraeumen
- Startpunkt setzen (Map-Kontext oder aus Ort)
- Zwischenpunkte aufnehmen
- Zielknoten per Snapping suchen
- Weg per API erstellen
- neu erstellten Weg lokal anwenden und Path-Edit-Dialog oeffnen

## 4. Gelesene globale Daten
Konkret gelesen:
- `pendingPathCreationStart`
- `pendingPathCreationPoints`
- `pendingPathCreationPreview`
- `pendingPathCreationLine`
- `locationData`
- `map`
- `PATH_ENDPOINT_SNAP_DISTANCE_PX`
- `IS_EDIT_MODE` (indirekt ueber aufgerufene Helfer, nicht als direkte Kernbedingung im Block)

## 5. Geschriebene globale Daten
Konkret mutiert:
- `pendingPathCreationStart`
- `pendingPathCreationPoints`
- `pendingPathCreationPreview`
- `pendingPathCreationLine`
- Map-Click-Handler per `map.on("click", handlePendingPathCreationClick)` und `map.off(...)`
- CSS-Klasse `path-creation-cursor` am `map.getContainer()`

## 6. Externe Abhaengigkeiten
Direkte externe Aufrufe im Block:
- `clearPendingPowerlineCreation()`
- `refreshAllLocationMarkerPopups()`
- `findNearestGraphNodeToLatLng()`
- `submitMapFeatureEdit()`
- `addCreatedPathFeature()`
- `updateRevisionFromEditResponse()`
- `openPathEditDialog()`
- `showFeedbackToast()`
- `L.circleMarker`, `L.polyline`, `L.latLng`
- `map.on/off("click", ...)`

Fuer den Start aus Kontextmenue-Flow relevant (aus Aufruferseite):
- `ensureCrossingsEnabled()` wird in `routing.js` vor `startPathCreationAt(...)` aufgerufen.

## 7. Externe Aufrufer
Repo-weite Aufrufer (per `grep`) fuer die angefragten Funktionen:

- `startPathCreationAt`
  - `js/routing.js` (Kontextmenue-Action)
- `startPathCreationFromLocation`
  - `js/routing.js` (Popup-/Action-Flow)
- `clearPendingPathCreation`
  - `index.html` (ESC/Cancel-Keydown-Flow)
  - `js/map-features.js` intern mehrfach
  - `js/map-features.js` in `startPathGeometryEdit(...)` (Cross-Boundary-Kante)
- `extendPendingPathCreationAtLocation`
  - `js/routing.js`
- `completePendingPathCreationAtLocation`
  - `js/routing.js`
  - intern aus `handlePendingPathCreationClick(...)`
- `handlePendingPathCreationClick`
  - intern via `map.on/off` in `js/map-features.js`

Zusaetzlich relevant:
- `findNearestGraphEndpointToLatLng` wird intern fuer Creation **und** Path-Geometry-Editing genutzt (`finishPathNodeDrag`-Pfad).

## 8. Boundary-Bewertung
Ist ein enger 1:1-Extract realistisch?
- **Ja**, prinzipiell.

Welche Funktionen sollten in `js/map-features.js` bleiben?
- Alle nicht-Path-Creation-Bloecke, insbesondere:
  - Path-Lifecycle/CRUD/Live-Update (`addCreatedPathFeature`, `applyLivePathFeature`, `applyPathFeatureResponse`, `removePathFeature`, ...)
  - Path-Geometry-Editing (`clearPathGeometryEdit`, `startPathGeometryEdit`, `splitPathAtNode`, ...)
  - Dispatcher-/Bootstrap-Bloecke

Welche Funktionen duerfen in neue Datei?
- die 10 Kandidaten aus Abschnitt 2 (mit Grenzfallhinweis fuer `clearPendingPathCreation` und `findNearestGraphEndpointToLatLng`).

Risiken durch Script-Reihenfolge/globale Variablen:
- hochrelevant, weil viele Globals gelesen/geschrieben werden und externe Aufrufer (`routing.js`, `index.html`) bestehen.

Top-Level-Ausfuehrung in neuer Datei?
- **Nein.** Nur Funktionsdefinitionen, keine neuen Event-Bindings/Init-Ausfuehrung.

## 9. Vorgeschlagene Zieldatei
Falls positiv:
- `js/map-features/map-features-path-creation.js`

## 10. Script-Reihenfolge
Aus Abhaengigkeiten folgt als sicherer spaeterer Platz:
- nach `js/map-features/map-features-path-rendering.js`
- vor `js/map-features.js`

Begruendung:
- `map-features.js` enthaelt weiterhin aufrufende Flows (u. a. Geometry-Editing-Kanten).
- `routing.js` muss die Creation-Funktionen global verfuegbar vorfinden; `routing.js` wird bereits nach `js/map-features.js` geladen.
- `getVisualLatLngCoordinates(...)` liegt im Inline-Script in `index.html`; die Functions werden erst zur Laufzeit genutzt, daher bleibt das beherrschbar.

## 11. Risiko
### Syntaxrisiko
- niedrig (reiner 1:1-Extract moeglich).

### Laufzeitrisiko
- mittel bis hoch (starker Global-State, Map-Handler und Pending-Layer).

### UI-/Interaction-Risiko
- hoch (Cursor-Status, Preview-Marker/Linie, Click-Verhalten, Abbruchpfade).

### Datenrisiko
- mittel (falsche Pending-State-Bereinigung kann zu stale Zustaenden fuehren).

### API-/Editmode-Risiko
- mittel (Create-API + lokale Anwendung + Edit-Dialog-Kette).

## 12. Empfohlener Smoke nach spaeterem Code-Split
Konkrete manuelle Tests:
1. Seite laden, keine Konsolenfehler.
2. Rechtsklick/Map-Kontext fuer Wegerstellung (falls vorhanden).
3. Weg von bestehendem Ort starten.
4. Zwischenpunkte setzen.
5. Zielort anklicken und Weg erstellen.
6. Neuer Weg erscheint.
7. Weg-Edit-Dialog oeffnet sich.
8. Abbrechen/Neustart raeumt Preview-Layer auf.
9. Start aus Ort-Popup pruefen.
10. Path-Creation darf Powerline-Creation nicht haengen lassen.
11. Routenplanung nach neuem Weg kurz pruefen.
12. Reload/URL ohne Fehler.

## 13. Entscheidung
Empfehlung: **Split ist sinnvoll**, aber nur als enger 1:1-Extract der Path-Creation-Funktionen.

Erlaubter Split-Umfang (positiv):
- `clearPendingPathCreation`
- `showPendingPathCreationPreview`
- `updatePendingPathCreationLine`
- `findNearestGraphEndpointToLatLng`
- `startPathCreationAt`
- `startPathCreationFromLocation`
- `appendPendingPathCreationLocation`
- `extendPendingPathCreationAtLocation`
- `completePendingPathCreationAtLocation`
- `handlePendingPathCreationClick`

Falls die Kopplung zu Geometry-Editing (`findNearestGraphEndpointToLatLng`, `clearPendingPathCreation`) im Review als zu eng bewertet wird, ist eine engere Variante moeglich: zuerst nur die eindeutig creation-spezifischen acht Funktionen verschieben und die zwei Shared-Helper vorerst im Rest belassen.

## 14. Konkreter naechster Code-Schritt
Vorgeschlagener spaeterer Commit-Name:
- `Split map features path creation helpers`

Wichtig:
- **Nicht in dieser Aufgabe umsetzen.**
- Vor Umsetzung nochmals Aufruferliste und Script-Reihenfolge gegen aktuellen `master` pruefen.
