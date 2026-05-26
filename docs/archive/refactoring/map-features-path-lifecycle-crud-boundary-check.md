# Map-Features Path-Lifecycle/CRUD Boundary Check

## 1. Zweck
Diese Analyse bewertet die naechste moegliche Boundary fuer Phase 2: Path-Lifecycle/CRUD aus `js/map-features.js`.

Wichtig: Dies ist **noch kein Code-Split**. Es werden nur Scope, Risiken, Abhaengigkeiten und ein moeglicher spaeterer erster Schritt dokumentiert.

## 2. Kandidatenfunktionen
Gepruefter Zielbereich in `js/map-features.js`:

- `normalizeRoutePathFeature`
- `preparePathData`
- `addCreatedPathFeature`
- `applyLivePathFeature`
- `findPathByPublicId`
- `syncPathRendering`
- `applyPathFeatureResponse`
- `removePathFeature`
- `deletePathFeature`

Grenzfaelle:

- `getPathStyleColors`
- `findNearestGraphEndpointToLatLng`
- `applyLiveMapFeatureUpdate`
- `applyMapFeatureEditResult`
- `removeLiveFeature`

Bewertung je Funktion:

- **geeignet fuer engen Split**:
  - `addCreatedPathFeature`
  - `applyLivePathFeature`
  - `findPathByPublicId`
  - `syncPathRendering`
  - `applyPathFeatureResponse`
  - `removePathFeature`

- **Grenzfall (separat behandeln)**:
  - `deletePathFeature`

- **besser in `js/map-features.js` belassen (vorerst)**:
  - `normalizeRoutePathFeature`
  - `preparePathData`
  - `getPathStyleColors`
  - `findNearestGraphEndpointToLatLng`
  - `applyLiveMapFeatureUpdate`
  - `applyMapFeatureEditResult`
  - `removeLiveFeature`

Explizite Entscheidung zu `deletePathFeature`:

- **Im ersten Lifecycle-Split nicht mitnehmen.**
- Grund: Delete ist CRUD-/Dispatcher-nah, verknuepft Popup-Flow, Best�tigung, API-Delete, Revision-Update und Entfernen ueber `removePathFeature` mit weiteren Restkanten.

## 3. Verantwortlichkeiten
Der Lifecycle/CRUD-Bereich uebernimmt aktuell:

- Path-Daten normalisieren
- initiale Path-Daten vorbereiten
- neue Paths lokal anwenden
- Live-Updates auf Paths anwenden
- Path-Layer aktualisieren
- Path-Layer entfernen
- Path-Popups/Rendering synchronisieren
- Routing/Planner nach Path-Aenderungen refreshen
- Path loeschen

## 4. Gelesene globale Daten
Konkrete Lesezugriffe:

- `pathData`
- `pathLayers`
- `map`
- `PATH_RENDER_CONFIG`
- jQuery-Status von `#togglePaths` (indirekt ueber `syncPathVisibility`/UI-Kopplung)
- Feature-Payloads (`feature.properties`, `feature.geometry`)

## 5. Geschriebene globale Daten
Konkrete Mutation:

- `pathData` (push/update/filter)
- `pathLayers` (set/delete)
- `path._layerGroup` / `path._pathLines` / `path._pathLabelLine`
- `path.geometry`
- `path.properties`
- `#togglePaths` wird indirekt ueber `syncPathVisibility`-Flows beeinflusst (Sichtbarkeitszustand)

## 6. Externe Abhaengigkeiten
Direkt/indirekt gekoppelte Funktionen und APIs:

- `createPathLayer`
- `updatePathLayerGeometry`
- `updatePathLayerStyle`
- `refreshPathLayerPopup`
- `syncPathVisibility`
- `syncPathTransportOptions`
- `refreshPlannerAfterFeatureChange`
- `submitMapFeatureEdit`
- `updateRevisionFromEditResponse`
- `getPathPublicId`
- `getPathDisplayName`
- `normalizePathSubtype`
- `getNextLocalPathId`
- `getNextPathDisplayName`
- `map.removeLayer`
- jQuery (`#togglePaths`, Event-gebundene Sichtbarkeitsfluesse)

Hinweis zu `applyLivePowerlineFeature`:

- kein direkter Aufruf im Path-Lifecycle-Block; nur Nachbarschaft im Dispatcher-Kontext.

## 7. Externe Aufrufer
Per grep identifizierte Aufrufer:

- `normalizeRoutePathFeature`
  - intern in `preparePathData`
  - intern in `addCreatedPathFeature`
  - intern in `applyLivePathFeature`
- `preparePathData`
  - `js/routing/routing.js`
- `addCreatedPathFeature`
  - `js/map-features-path-creation.js`
  - `js/map-features-path-geometry-editing.js`
- `applyLivePathFeature`
  - intern in `applyLiveMapFeatureUpdate`
- `findPathByPublicId`
  - `js/routing/routing.js`
  - intern in `applyLivePathFeature` und `removeLiveFeature`
- `syncPathRendering`
  - keine externen Treffer, aktuell interner Utility-Helfer
- `applyPathFeatureResponse`
  - `js/map-features-path-geometry-editing.js`
  - intern in `applyLivePathFeature`
- `removePathFeature`
  - `js/map-features-path-geometry-editing.js`
  - intern in `removeLiveFeature` und `deletePathFeature`
- `deletePathFeature`
  - `js/routing/routing.js`

## 8. Boundary-Bewertung
Ist ein enger 1:1-Extract realistisch?

- **Ja**, aber nicht als gesamter Block A+B+C.

Sicherster erster Subscope:

- **Subscope A (Path-Apply/Live)**
  - `addCreatedPathFeature`
  - `applyLivePathFeature`
  - `findPathByPublicId`
  - `syncPathRendering`
  - `applyPathFeatureResponse`
  - `removePathFeature`

Was soll in `js/map-features.js` bleiben?

- `normalizeRoutePathFeature`
- `preparePathData`
- `deletePathFeature`
- Dispatcher-nahe Grenzfaelle (`removeLiveFeature`, `applyLiveMapFeatureUpdate`, `applyMapFeatureEditResult`)
- Shared-Helper `findNearestGraphEndpointToLatLng`

Darf die neue Datei Top-Level-Ausfuehrung enthalten?

- **Nein.** Nur Funktionsdefinitionen.

## 9. Vorgeschlagene Zieldatei
Empfohlener Name fuer den ersten Schritt:

- `js/map-features-path-updates.js`

Begruendung:

- Der erste sichere Subscope ist Apply/Live/Update-zentriert, nicht der komplette Lifecycle/CRUD-Block.
- `path-lifecycle` waere als Name fuer einen breiteren spaeteren Schritt weiterhin passend.

Alternativen:

- `js/map-features-path-lifecycle.js` fuer spaeteren groesseren Scope
- `js/map-features-path-crud.js` erst sinnvoll, wenn Delete-Flow mit Boundary sauber entschieden ist

## 10. Script-Reihenfolge
Falls spaeter umgesetzt, sichere Position:

- nach `js/map-features-path-geometry-editing.js`
- vor `js/map-features.js`

Begruendung:

- `js/map-features-path-creation.js` und `js/map-features-path-geometry-editing.js` nutzen `addCreatedPathFeature`, `applyPathFeatureResponse`, `removePathFeature`.
- Diese Funktionen muessen vor der Laufzeitnutzung global verfuegbar sein.

## 11. Risiko
### Syntaxrisiko
- niedrig bei engem 1:1-Extract.

### Laufzeitrisiko
- mittel bis hoch (globale Daten und Layer-Mutationen).

### UI-/Interaction-Risiko
- mittel (Popup-/Sichtbarkeits-/Refresh-Kopplung).

### Datenrisiko
- hoch (`pathData`/`pathLayers`-Konsistenz).

### API-/Editmode-Risiko
- mittel bis hoch (Response-Anwendung, Revisionen, Delete-Pfade).

### Routing-/Planner-Risiko
- hoch (Route-Rebuild nach Path-Aenderungen, Waypoint-Abhaengigkeiten).

## 12. Empfohlener Smoke nach spaeterem Code-Split
Konkrete manuelle Tests:

1. Seite laden, keine Konsolenfehler.
2. Wege sichtbar.
3. Weg-Popup oeffnen.
4. Route berechnen.
5. Path-Creation erzeugt neuen Weg.
6. Neuer Weg erscheint und ist routingfaehig.
7. Path-Geometry-Editing speichert Geometrie.
8. Weg loeschen, falls UI sichtbar.
9. Live-/Reload-Verhalten pruefen.
10. Toggle Wege an/aus.
11. Path-Labels bleiben sichtbar.
12. Route nach Path-Update neu berechnen.

## 13. Entscheidung
Empfehlung:

- **Ja, Split ist moeglich**, aber nicht als kompletter Lifecycle/CRUD-Block in einem Schritt.
- Sicherer erster Schritt ist **Subscope A (Path-Apply/Live)**.

Exakter erster Code-Schritt (verschiebbar):

- `addCreatedPathFeature`
- `applyLivePathFeature`
- `findPathByPublicId`
- `syncPathRendering`
- `applyPathFeatureResponse`
- `removePathFeature`

Nicht im ersten Schritt:

- `normalizeRoutePathFeature`
- `preparePathData`
- `deletePathFeature`
- Dispatcher-Funktionen (`removeLiveFeature`, `applyLiveMapFeatureUpdate`, `applyMapFeatureEditResult`)

## 14. Konkreter naechster Code-Schritt
Vorgeschlagener Commit-Name fuer spaeter:

- `Split map features path lifecycle helpers`

Praeziser fuer den ersten engen Schritt waere alternativ:

- `Split map features path updates helpers`

Wichtig:

- **Noch nicht in dieser Aufgabe umsetzen.**