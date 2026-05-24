# Map-Features Feature-State Boundary Check

## 1. Zweck

Diese Boundary-Analyse prueft einen moeglichen naechsten Split aus `js/map-features.js` fuer den Block Feature-Revisionen / Softlocks.

Der Block ist ein guter Kandidat, weil er eine klar erkennbare technische Verantwortung hat:

- lokale Revisionen lesen
- erwartete Revisionen an Edit-Payloads anhaengen
- Softlocks fuer editierbare Features anfordern, erneuern und freigeben
- globale Karten-Datenrevision aktualisieren

Der Split waere kein Produktfeature und keine Logikaenderung, sondern ein enger 1:1-Extract in eine eigene klassische Script-Datei.

## 2. Kandidatenfunktionen

### `updateRevisionFromEditResponse(payload)`

Verantwortung:

- liest eine Revision aus API-/Edit-Antworten
- aktualisiert `mapDataSourceStatus.revision`
- ruft `updateMapDataStatus(...)` auf

Bewertung:

- technisch klarer Revision-Helper
- guter Bestandteil des Feature-State-Clusters

### `getLocalFeatureRevision(publicId)`

Verantwortung:

- ermittelt die lokale Revision eines Features anhand seiner Public-ID
- sucht in Location-Markern, Paths, Labels und Regionen

Bewertung:

- liest mehrere globale Stores, mutiert aber nichts
- gehoert fachlich zu Revision-/Concurrency-State

### `withExpectedRevision(payload)`

Verantwortung:

- haengt `expected_revision` an Edit-Payloads an, sofern sinnvoll
- laesst Create-/Lock-Actions unveraendert

Bewertung:

- klarer API-/Revision-Helper
- vermutlich von `submitMapFeatureEdit(...)` oder editnahen Flows genutzt

### `acquireFeatureSoftLock(publicId)`

Verantwortung:

- fordert fuer SQL-basierte Feature-IDs einen Softlock an
- erneuert den Lock periodisch
- speichert Timer in `activeFeatureLocks`
- zeigt Fehler ueber `showFeedbackToast(...)`

Bewertung:

- klarer Lock-Helper
- mutiert `activeFeatureLocks`
- gehoert eng zu `releaseFeatureSoftLock(...)`

### `releaseFeatureSoftLock(publicId)`

Verantwortung:

- stoppt den Refresh-Timer fuer einen aktiven Softlock
- entfernt Eintrag aus `activeFeatureLocks`
- gibt Lock per API frei

Bewertung:

- klarer Lock-Helper
- mutiert `activeFeatureLocks`
- muss mit `acquireFeatureSoftLock(...)` zusammenbleiben

## 3. Gelesene globale Daten

Der Kandidatenblock liest:

- `mapDataSourceStatus`
- `activeFeatureLocks`
- `locationMarkers`
- `pathData`
- `labelMarkers`
- `regionData`
- `regionPolygons`
- `IS_EDIT_MODE`

Diese Lesezugriffe sind fuer einen globalen Script-Split akzeptabel, solange keine ES-Module eingefuehrt werden und die neue Datei vor `js/map-features.js` geladen wird.

## 4. Geschriebene globale Daten

Der Kandidatenblock mutiert:

- `mapDataSourceStatus.revision`
- `activeFeatureLocks`

Indirekt:

- `updateMapDataStatus({ avesmapsSource: mapDataSourceStatus })` aktualisiert UI-/Statusdarstellung.
- `submitMapFeatureEdit(...)` wird fuer Lock-Actions aufgerufen.

Es werden keine Location-, Path-, Label- oder Region-Daten direkt veraendert.

## 5. Externe Abhaengigkeiten

Der Kandidatenblock benoetigt:

- `updateMapDataStatus(...)`
- `findLocationMarkerByPublicId(...)`
- `findPathByPublicId(...)`
- `normalizeRegionFeature(...)`
- `isSqlMapFeatureId(...)`
- `submitMapFeatureEdit(...)`
- `showFeedbackToast(...)`

Ein Teil dieser Funktionen liegt weiterhin in `js/map-features.js`. Das ist bei klassischem Script-Tag-Aufbau akzeptabel, weil die Funktionen erst zur Laufzeit aufgerufen werden. Wichtig ist aber, dass die neue Datei nach allen Dateien geladen wird, deren globale Konstanten sie direkt benoetigt, und vor den Aufrufern, die ihre Funktionen nutzen.

## 6. Externe Aufrufer und Nutzung

Die Kandidatenfunktionen werden in mehreren Edit-Flows verwendet:

- Location-Marker-Bearbeitung nutzt `acquireFeatureSoftLock(...)` und `releaseFeatureSoftLock(...)`.
- Path-Geometrie-Bearbeitung nutzt Softlocks.
- Edit-/Save-Flows nutzen `updateRevisionFromEditResponse(...)` nach erfolgreichen API-Antworten.
- API-nahe Edit-Flows nutzen `withExpectedRevision(...)`, sofern die Edit-API darueber Payloads absichert.

Wichtig: Der Split darf die Funktionsnamen nicht aendern. Alle Funktionen bleiben global verfuegbar.

## 7. Vorgeschlagene Zieldatei

Empfohlene Datei:

```text
js/map-features/map-features-feature-state.js
```

Begruendung:

- Der Block umfasst mehr als nur Locks.
- Der Block umfasst mehr als nur Revisionen.
- `feature-state` beschreibt Revisionen, erwartete Revisionen und Softlocks als gemeinsamen Concurrency-/Edit-State.

Alternative:

```text
js/map-features/map-features-feature-revisions.js
```

Diese Alternative ist weniger passend, weil `acquireFeatureSoftLock(...)` und `releaseFeatureSoftLock(...)` dann nur indirekt abgedeckt waeren.

## 8. Script-Reihenfolge

Empfohlene Position in `index.html`:

```text
js/map-features/map-features-layer-state.js
js/map-features/map-features-display-mode.js
js/map-features/map-features-feature-state.js
js/map-features/map-features-share-pin.js
...
js/map-features.js
```

Begruendung:

- Die Datei muss vor `js/map-features.js` geladen werden, wenn `map-features.js` die Funktionen aufruft.
- Sie muss nicht vor `map-features-layer-state.js` geladen werden.
- Sie sollte vor den restlichen map-features-nahen Edit-/Lifecycle-Flows verfuegbar sein.

Falls sich beim konkreten Extract zeigt, dass andere bereits ausgelagerte Dateien `withExpectedRevision(...)` oder Softlock-Funktionen direkt verwenden, muss die Position entsprechend vor diese Dateien verschoben werden. Aktuell wirkt eine Position nach `map-features-display-mode.js` und vor `map-features-share-pin.js` plausibel.

## 9. Risiko

### Syntaxrisiko

Niedrig.

Die Funktionen koennen voraussichtlich 1:1 verschoben werden.

### Laufzeitrisiko

Mittel.

Die Funktionen greifen auf globale Daten und Funktionen zu. Das ist im bestehenden klassischen Script-System normal, aber die Script-Reihenfolge muss stimmen.

### UI-Risiko

Niedrig bis mittel.

Der Block erzeugt kaum direkte UI, nutzt aber `showFeedbackToast(...)` bei Lock-Fehlern.

### Editmode-/API-Risiko

Mittel.

Fehler koennten nur in Edit-Flows sichtbar werden: Speichern, Softlocks, Revision-Konflikte. Daher ist ein gezielter Editmode-Smoke erforderlich.

### Deployment-Risiko

Niedrig.

Eine neue JS-Datei und ein neuer Script-Tag reichen aus. Keine API-, PHP-, SQL- oder CSS-Aenderungen.

## 10. Empfohlener Smoke

Nach einem Code-Split testen:

1. Seite laden.
2. Browser-Konsole pruefen: keine `ReferenceError`, keine `SyntaxError`.
3. Editmode oeffnen.
4. Bestehenden Ort bearbeiten und speichern.
5. Bestehenden Weg bearbeiten und speichern, falls sicher moeglich.
6. Marker-Drag fuer einen sicheren Testort pruefen, falls sicher moeglich.
7. Weggeometrie-Bearbeitung starten und wieder beenden.
8. Auf Toast-/Lock-Fehler achten.
9. Nach Speichern pruefen, ob Status/Revision weiter aktualisiert wird.
10. Route/Planner kurz neu berechnen, falls Path oder Ort veraendert wurde.

## 11. Entscheidung

Empfehlung: Split durchfuehren, aber nur als enger 1:1-Extract.

Zu verschieben:

- `updateRevisionFromEditResponse`
- `getLocalFeatureRevision`
- `withExpectedRevision`
- `acquireFeatureSoftLock`
- `releaseFeatureSoftLock`

Nicht verschieben:

- `applyMapFeatureEditResult`
- `applyLiveMapFeatureUpdate`
- `removeLiveFeature`
- Location-/Path-/Label-/Region-Lifecycle-Funktionen
- Dialog-/Review-Submit-Flows
- API-Funktionen

Zieldatei:

```text
js/map-features/map-features-feature-state.js
```

Code-Regeln:

- keine Funktionsnamen aendern
- keine Logik aendern
- keine ES-Module
- keine Imports/Exports
- nur Script-Tag in `index.html` ergaenzen
- `node --check` fuer neue Datei und `js/map-features.js`

## 12. Empfohlener naechster Code-Schritt

Naechster Commit nach dieser Boundary:

```text
Split map features feature state helpers
```

Minimaler Inhalt:

- neue Datei `js/map-features/map-features-feature-state.js`
- fuenf Funktionen aus `js/map-features.js` 1:1 verschoben
- Script-Tag in `index.html` eingefuegt
- keine weiteren Dateien

Danach gezielter Editmode-/API-Smoke.
