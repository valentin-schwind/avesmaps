# Boundary-Analyse: Path-Domain-/Basis-Helper in `js/map-features.js`

## 1. Zweck der Analyse
Diese Analyse prüft, ob der Path-Domain-/Basis-Helper-Bereich in `js/map-features.js` als kleiner, verhaltensneutraler 1:1-Split ausgelagert werden kann, ohne Path-Lifecycle/CRUD/Live-Update mitzunehmen.

## 2. Exakte Funktionsliste des Path-Domain-/Basis-Helper-Clusters
Untersucht wurden diese Funktionen:
- `normalizePathSubtype`
- `getPathDisplayName`
- `getPathPublicId`
- `getNextPathDisplayName`
- `getPathDisplayNameOrGenerated`
- `getNextLocalPathId`
- `getPathStyleColors`

Zusätzlich angrenzend geprüft:
- `normalizePathName` (direkte Abhängigkeit von `normalizePathSubtype`)

## 3. Welche Funktionen bewusst nicht Teil des Clusters sind
Nicht Teil eines möglichen Domain-/Basis-Extracts:
- `preparePathData`
- `addCreatedPathFeature`
- `applyLivePathFeature`
- `applyPathFeatureResponse`
- `removePathFeature`
- `deletePathFeature`
- `syncPathVisibility`
- `syncPathRendering`
- `createPathLayer`
- `updatePathLayerStyle`
- `updatePathLayerGeometry`
- `refreshPathLayerText`
- `getPathLabelStyle`
- Routing-/Spotlight-/Review-Flows

## 4. Pure/Domain-Helper vs. Map-/Style-/Render-Abhängigkeit
Eher pure/domain:
- `normalizePathName`
- `normalizePathSubtype`
- `getPathDisplayName`
- `getPathPublicId`
- `getNextPathDisplayName`
- `getPathDisplayNameOrGenerated`
- `getNextLocalPathId`

Nicht mehr rein domain (Style-/Map-Abhängigkeit):
- `getPathStyleColors`
  - liest `map.getZoom()`
  - liest `PATH_RENDER_CONFIG`
  - steuert Rendergewichte/Opacity

## 5. Welche globalen Daten gelesen werden
- `pathData` (in `getNextPathDisplayName`, `getNextLocalPathId`)
- `PATH_RENDER_CONFIG` (in `getPathStyleColors`)
- `map` (in `getPathStyleColors` via `map.getZoom()`)
- `PATH_SUBTYPE_KEYS` (in `normalizePathSubtype`)
- `SYNTHETIC_ROUTE_TYPE` (in `normalizePathName`)

## 6. Welche globalen Daten geschrieben oder mutiert werden
- Keine direkten Schreibzugriffe auf globale Daten im untersuchten Cluster.
- Alle Funktionen sind lesend/berechnend (bei `getPathStyleColors` styleberechnend, aber ohne globale Mutation).

## 7. Welche externen Funktionen der Cluster aufruft
- `escapeRegExp(...)` (in `getNextPathDisplayName`)
- `normalizePathName(...)` (in `normalizePathSubtype`)
- `normalizePathSubtype(...)` (mehrfach intern)
- `getNextPathDisplayName(...)` (in `getPathDisplayNameOrGenerated`)

## 8. Welche Funktionen vermutlich von außen gebraucht werden
Direkte externe Nutzung (Dateien im aktuellen Stand):
- `dialogs-review-paths.js`
  - `normalizePathSubtype`
  - `getPathDisplayName`
  - `getNextPathDisplayName`
  - `getPathDisplayNameOrGenerated`
- `routing.js`
  - `normalizePathSubtype`
- `spotlight-search.js`
  - `normalizePathSubtype`
  - `getPathDisplayName`
  - `getPathPublicId`
- `map-features-path-labels.js`
  - `normalizePathSubtype`
  - `getPathDisplayName`
- `map-features-path-rendering.js`
  - `normalizePathSubtype`
  - `getPathDisplayName`
  - `getPathPublicId`
  - `getPathStyleColors`
- Inline-Script in `index.html` (Graph-Erzeugung)
  - `normalizePathSubtype`

## 9. Abhängigkeit zu `js/map-features-path-labels.js`
`js/map-features-path-labels.js` benötigt:
- `normalizePathSubtype`
- `getPathDisplayName`

Das erzwingt: Domain-Helper müssen vor `js/map-features-path-labels.js` geladen werden, wenn sie ausgelagert werden.

## 10. Abhängigkeit zu `js/map-features-path-rendering.js`
`js/map-features-path-rendering.js` benötigt:
- `normalizePathSubtype`
- `getPathDisplayName`
- `getPathPublicId`
- `getPathStyleColors`

Wenn `getPathStyleColors` nicht mit ausgelagert wird, bleibt eine Restabhängigkeit zu `js/map-features.js` bestehen; das wäre für eine saubere Abhängigkeitsrichtung ungünstig.

## 11. Abhängigkeit zu Path-Lifecycle-/CRUD-Funktionen
Path-Lifecycle-/CRUD-Funktionen in `js/map-features.js` nutzen diese Helper intensiv (z. B. bei Normalize/Response/IDs/Namen), schreiben aber selbst den State (`pathData`, `pathLayers`, Layer-Lifecycle). Diese Trennung bleibt bei einem reinen Helper-Split intakt.

## 12. Mögliche spätere Ziel-Datei
Bewertet:
- `js/map-features-path-domain.js`
- Integration in `js/map-features-path-rendering.js`

Risikoärmer für klassischen Script-Tag-Aufbau:
- `js/map-features-path-domain.js` als eigene, kleine Basis-Datei.

Begründung:
- Domain-Helper werden nicht nur vom Rendering gebraucht, sondern auch von Routing, Spotlight, Dialogen und Inline-Graph-Script.
- Eine enge Koppelung an `path-rendering.js` würde semantisch Rendering und fachliche Domain-Basis vermischen.

## 13. Nötige Script-Reihenfolge (falls später ausgelagert)
Empfohlene Reihenfolge im Map-Features-Block:
1. `js/map-features-labels.js`
2. `js/map-features-powerlines.js`
3. `js/map-features-layer-state.js`
4. `js/map-features-share-pin.js`
5. `js/map-features-location-name-labels.js`
6. `js/map-features-path-domain.js` (neu)
7. `js/map-features-path-labels.js`
8. `js/map-features-path-rendering.js`
9. `js/map-features.js`

Zusätzlich wichtig:
- `js/map-features-path-domain.js` muss auch vor `js/routing.js` und `js/spotlight-search.js` bleiben (beide folgen bereits nach `js/map-features.js`).
- Das Inline-Graph-Script in `index.html` nutzt `normalizePathSubtype`; diese Funktion muss dort weiterhin global verfügbar sein.

## 14. Risikoanalyse
- Globale Verfügbarkeit für externe Dateien: **mittel**
  - Viele externe Aufrufer (`dialogs-review-paths.js`, `routing.js`, `spotlight-search.js`, `map-features-path-*.js`, Inline-Script).
- Lade-Reihenfolge: **mittel**
  - Falsche Reihenfolge erzeugt sofort `ReferenceError`.
- `getPathStyleColors` mit Map-/Zoom-Abhängigkeit: **mittel bis hoch**
  - Domain-Kandidaten und Render-Kandidaten sind hier vermischt.
- Namensgenerierung/lokale IDs: **niedrig bis mittel**
  - Logik ist stabil, aber stark an `pathData` gebunden.
- Routing-/Search-/Review-Kopplung: **mittel**
  - Durch viele Konsumenten nur streng 1:1 verschieben, keine Signaturänderungen.

## 15. Klare Empfehlung
Soll danach ein Code-Split folgen: **Ja, aber klein und strikt**.

Empfohlener minimaler 1:1-Schnitt:
- `normalizePathName` (als notwendige interne Abhängigkeit)
- `normalizePathSubtype`
- `getPathDisplayName`
- `getPathPublicId`
- `getNextPathDisplayName`
- `getPathDisplayNameOrGenerated`
- `getNextLocalPathId`

`getPathStyleColors` vorerst **nicht** in denselben Domain-Split nehmen, sondern vorerst bei Path-Rendering-Bezug belassen (oder separat mit Rendering bewerten), weil sie direkt an Zoom/Renderkonfiguration gekoppelt ist.

Falls ein Split inklusive `getPathStyleColors` gewünscht ist, sollte vorher eine kurze Sub-Boundary festlegen, ob `getPathStyleColors` fachlich als Domain-Helper akzeptiert wird oder als Rendering-Helper behandelt werden soll.
