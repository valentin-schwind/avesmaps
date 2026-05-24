# Finale Restbewertung: `js/map-features.js` nach den risikoarmen Splits

## 1. Zweck

Diese Restbewertung fasst den Zustand von `js/map-features.js` nach den abgeschlossenen risikoarmen Splits zusammen. Ziel ist eine klare Entscheidung, welche verbleibenden Bereiche stabil bleiben sollen und welche nur mit neuer Boundary-Analyse weiter angefasst werden duerfen.

## 2. Bereits stabil ausgelagert

Folgende `map-features`-Cluster sind inzwischen stabil ausgelagert:

- `js/map-features/map-features-labels.js`
- `js/map-features/map-features-powerlines.js`
- `js/map-features/map-features-layer-state.js`
- `js/map-features/map-features-display-mode.js`
- `js/map-features/map-features-share-pin.js`
- `js/map-features/map-features-waypoints.js`
- `js/map-features/map-features-location-name-labels.js`
- `js/map-features/map-features-path-domain.js`
- `js/map-features/map-features-path-labels.js`
- `js/map-features/map-features-path-rendering.js`

Diese Splits waren jeweils als enge 1:1-Extracts ohne Logikaenderung angelegt und wurden nachgelagert mit gezielten Browser-Smokes geprueft.

## 3. Aktueller Rest in `js/map-features.js`

Nach den Splits bleiben im Kern folgende Verantwortungen in `js/map-features.js`:

- Location-Marker-/Ortsdaten-Orchestrierung
- Location-Popup-/Popup-Action-Anbindung
- Label-Kollisionslogik
- Path-Lifecycle, Path-CRUD und Live-Update-Anbindung
- `getPathStyleColors` als zoom-/renderingabhaengiger Helper
- Region-/Gebiets-Orchestrierung inklusive Timeline-/Gebietsdaten-Anbindung
- Editmode-/Softlock-/Feature-Response-Flows
- allgemeine Karten-/Feature-Orchestrierung
- DOM-/Event-Bindings, die mehrere Cluster verbinden

## 4. Verbleibende Clusterbewertung

### Location-Marker / Ortsdaten

Bewertung: stabil lassen.

Grund:
- stark gekoppelt an `locationData`, `locationMarkers`, Editmode, Marker-Icons, Popup-Bindings, Label-Sync und Live-Update-Flows
- direkte Auswirkungen auf Routing, Suche, Review-/Edit-Flows und Karte
- ein Split waere kein einfacher Helper-Extract mehr, sondern wuerde zentrale Datenmutation betreffen

Moeglicher spaeterer Schritt:
- nur mit eigener Boundary fuer Location-Marker-Orchestrierung
- nur nach klarer Trennung zwischen Marker-Rendering, Datenmutation und Popup-Bindings

### Location-Popups / Popup-Actions

Bewertung: vorerst stabil lassen.

Grund:
- Popup-Markup kommt aus anderen Dateien, aber Bindings und Marker-Zustand liegen nahe an Location-Daten
- Aktionen greifen in Routing, Editmode, Waypoints und Feature-Update-Flows
- UI-Smoke-Aufwand waere hoch

Moeglicher spaeterer Schritt:
- eigene Boundary fuer reine Popup-Bindings
- kein Split zusammen mit Location-Datenmutation

### Label-Kollision

Bewertung: stabil lassen.

Grund:
- gemeinsam genutzt von freien Labels und Ortsnamenlabels
- DOM-Messung, Offsets, Priority-Regeln und Scheduling sind eng gekoppelt
- kleine Aenderungen koennen Layout/Lesbarkeit stark beeinflussen

Moeglicher spaeterer Schritt:
- eigene Datei `js/map-features/map-features-label-collisions.js` nur nach separater Collision-Boundary
- vorher dedizierter visueller Smoke mit mehreren Zoomstufen und dichten Label-Regionen

### Path-Lifecycle / Path-CRUD / Live-Updates

Bewertung: stabil lassen.

Grund:
- Rendering-Core und Domain-Helfer sind bereits ausgelagert
- der Rest mutiert `pathData`, `pathLayers`, Popup-/Tooltip-Zustand, Edit-/Lock-Zustand und Live-Update-Ergebnisse
- weitere Splits waeren nicht mehr risikoarm, sondern betreffen Datenfluss und Konsistenz

Moeglicher spaeterer Schritt:
- Sub-Boundary fuer reine Path-Response-Anwendung
- Sub-Boundary fuer Path-Edit-/Lock-Flows
- keine direkte Umsetzung ohne vorherige Analyse

### `getPathStyleColors`

Bewertung: vorerst in `js/map-features.js` lassen.

Grund:
- nutzt Map-/Zoom-/Rendering-Kontext
- steht fachlich zwischen Path-Domain und Path-Rendering
- ein Umzug ist klein, aber nicht wertvoll genug, solange weitere Path-Lifecycle-Teile im Rest bleiben

Moeglicher spaeterer Schritt:
- nur zusammen mit einer Path-Style-Sub-Boundary
- Ziel waere ggf. `js/map-features/map-features-path-rendering.js` oder eine kleine `js/map-features/map-features-path-style.js`

### Region-/Gebiets-Orchestrierung

Bewertung: stabil lassen, kein risikoarmer Split mehr.

Grund:
- sehr grosser zusammenhaengender Block mit Layern, UI, Timeline, Auswahl, Editmode, Datenladung und Gebietsdaten-Anbindung
- hohe Anzahl indirekter Zustandsaenderungen
- starke Kopplung an `js/config.js`, Dialog-/Review-Flows und Kartenzustand

Moeglicher spaeterer Schritt:
- nicht als Rest-Split behandeln
- als eigene Architekturaufgabe planen
- zuerst Zielarchitektur und Datenfluss dokumentieren, dann Submodule ableiten

### Editmode / Softlocks / Feature-Response-Flows

Bewertung: stabil lassen.

Grund:
- verbindet Location, Path, Label, Region, Live-Update, Revisionen und Locks
- ist fachlich ein Dispatcher-/Konsistenzbereich
- Fehler koennen Datenverlust oder inkonsistente UI-Zustaende verursachen

Moeglicher spaeterer Schritt:
- eigene Boundary fuer Revision-/Lock-Helfer
- kein direkter Split von Dispatcher-Flows

### DOM-/Event-Bindings

Bewertung: stabil lassen.

Grund:
- Bindings sind oft die Kanten zwischen ausgelagerten Helper-Dateien und Rest-Orchestrator
- Top-Level-Reihenfolge ist bei klassischem Script-Tag-Aufbau kritisch
- weitere Extraktion wuerde eher Initialisierung/Bootstrapping beruehren

Moeglicher spaeterer Schritt:
- nur im Rahmen einer Init-/Bootstrap-Boundary

## 5. Noch risikoarm moeglich?

Kurzbewertung: kaum noch.

Nach den erledigten Splits bleiben keine klaren, isolierten Helper-Cluster mehr uebrig, die ohne nennenswertes Risiko direkt ausgelagert werden sollten.

Allenfalls noch analysierbar, aber nicht direkt umzusetzen:

- Label-Kollision als eigener technischer Service
- Path-Style-Helfer rund um `getPathStyleColors`
- einzelne Revision-/Lock-Helfer
- einzelne Popup-Binding-Helfer

Diese Kandidaten sind kleiner, aber nicht automatisch risikoarm. Jeder braucht eine neue Boundary und einen eigenen Smoke.

## 6. Empfehlung fuer den aktuellen Refactoring-Stopp

Empfehlung: Die risikoarme `map-features.js`-Split-Serie hier stoppen.

Begruendung:
- die gut isolierbaren Cluster sind ausgelagert
- die Script-Reihenfolge ist noch beherrschbar
- der Rest enthaelt vor allem Orchestrierung, Datenmutation und UI-Kanten
- weitere direkte Splits wuerden das Risiko-Nutzen-Verhaeltnis verschlechtern

## 7. Naechste sinnvolle Arbeitspakete statt weiterer Mikro-Splits

### A. Status konsolidieren

`docs/refactoring-status.md` lokal aktualisieren und den neuen Display-Mode-Stabilitaetsnachtrag in die Hauptstatusdatei uebernehmen.

Grund:
- `docs/map-features-display-mode-stable.md` ist korrekt, aber ein Nachtrag
- langfristig sollte `docs/refactoring-status.md` wieder die zentrale Uebersicht sein

### B. Map-Features-Restarchitektur skizzieren

Neue Doku fuer spaetere Architekturarbeit:

- `docs/map-features-rest-architecture.md`

Inhalt:
- verbleibende Verantwortungen
- Datenbesitz
- mutierende Flows
- Event-/Init-Kanten
- moegliche Zielmodule fuer eine spaetere groessere Bereinigung

### C. Keine weiteren Code-Splits ohne konkreten Produktnutzen

Weitere Splits nur, wenn sie ein konkretes Problem loesen:

- Bug-Isolation
- neue Feature-Arbeit
- Testbarkeit
- Reduktion eines bekannten Konfliktbereichs

Nicht mehr aus reinem Aufraeumtrieb.

## 8. Schlussentscheidung

Die risikoarme Modularisierungsphase fuer `js/map-features.js` ist abgeschlossen.

Naechster empfohlener Schritt ist kein Code-Split, sondern Dokumentations- und Architekturarbeit:

1. `docs/refactoring-status.md` lokal konsolidieren.
2. Restarchitektur fuer die verbleibenden Orchestrator-Bloecke beschreiben.
3. Danach mit Produktfeatures oder gezielten Bugfixes weitermachen.
