# Restarchitektur: `js/map-features.js`

## 1. Zweck

Dieses Dokument beschreibt die verbleibende Architektur von `js/map-features.js` nach den abgeschlossenen risikoarmen 1:1-Splits.

Ziel ist nicht, sofort weitere Funktionen zu verschieben. Ziel ist, die Restdatei als Orchestrator- und Datenflussproblem zu verstehen, bevor spaeter wieder Code veraendert wird.

Diese Datei ist der Anschluss an:

- `docs/refactoring-status.md`
- `docs/map-features-final-rest-assessment.md`
- `docs/map-features-remaining-boundary-check.md`

## 2. Ausgangspunkt

Die gut isolierbaren Helper-/UI-/Rendering-Cluster wurden bereits ausgelagert:

- freie Kartenlabels
- Kraftlinien-/Powerline-Helfer
- URL-/Planner-State-Helfer
- Display-/Layer-Mode-Helfer
- Share-Pin-/Clipboard-Helfer
- Waypoint-UI-Helfer
- Ortsnamenlabel-Helfer
- Path-Domain-/Basis-Helfer
- Path-Textlabel-Helfer
- Path-Rendering-Core-Helfer

`js/map-features.js` enthaelt danach vor allem Restverantwortungen mit hoher Kopplung:

- zentrale Datenmutation
- globale Karten-/Layer-Orchestrierung
- Editmode- und Lock-Flows
- Feature-Response-Dispatcher
- DOM-/Event-Kanten
- Region-/Gebietslogik
- Location-Marker- und Popup-Anbindung
- Path-Lifecycle und Live-Update-Flows
- Label-Kollision

## 3. Leitprinzip fuer die naechste Refactoring-Phase

Die naechste Phase darf nicht mehr nach dem Muster "ein paar Helper finden und verschieben" ablaufen.

Stattdessen gilt:

1. Datenbesitz klaeren.
2. Mutierende Flows kartieren.
3. Event-/Init-Kanten sichtbar machen.
4. Erst danach Zielmodule definieren.
5. Code nur in kleinen Schritten mit eigenem Smoke verschieben.

Weitere Splits sind ab jetzt Architekturarbeit, keine unvorbereiteten Mikro-Splits. Nach erneuter Pruefung sind aber weitere Splits moeglich, wenn sie jeweils eine eigene Boundary erhalten.

## 4. Restbloecke in `js/map-features.js`

### 4.1 Location-Marker und Ortsdaten

Verantwortung:

- Marker fuer Orte erzeugen und aktualisieren
- Location-Daten mit Marker-Entries synchron halten
- Location-Typen, Sichtbarkeit und Editmode-Regeln anwenden
- Marker-Drag und Positionsspeicherung koordinieren
- angeschlossene Wege bei verschobenen Orten aktualisieren
- Ortsnamenlabels nach Location-Aenderungen synchronisieren

Typische Daten:

- `locationData`
- `locationMarkers`
- aktive Location-Edit-Zustaende
- Marker-Layer
- Location-Typ-Konfiguration
- Toggle-Zustaende

Kopplungen:

- Routing nutzt Locations und Marker-Zustaende indirekt
- Suche/Spotlight fokussiert Orte
- Popups haengen an Marker-Entries
- Ortsnamenlabels werden aus Marker-/Location-Zustand gespeist
- Live-Updates und Review-Flows koennen Location-Daten aendern

Architekturbewertung:

Der Gesamtblock Location-Marker und Ortsdaten bleibt zu stark gekoppelt fuer einen direkten Komplettsplit. Innerhalb des Blocks ist jedoch ein engerer Split fuer Location-Marker-Rendering und Sichtbarkeit moeglich.

Moegliche Zielmodule spaeter:

- `js/map-features-location-marker-rendering.js` fuer Marker-Icon-, Zoom-, Sichtbarkeits- und Render-Bounds-Helfer.
- `js/map-features/location-markers.js` erst spaeter fuer den groesseren Lifecycle, nur nach eigener Boundary und Datenflussanalyse.

### 4.2 Location-Popups und Popup-Actions

Verantwortung:

- Location-Popups an Marker binden
- Popup-Actions mit Routing, Waypoints, Editmode und Reports verbinden
- Popup-Inhalte nach Datenupdates erneuern

Typische Daten:

- Marker-Entries
- Location-Properties
- Popup-Markup aus `js/popups.js`
- Editmode-/Action-Zustaende

Kopplungen:

- `js/popups.js`
- Routing-/Waypoint-Flows
- Review-/Edit-Flows
- Spotlight/Search

Architekturbewertung:

Der Bereich kann spaeter aufgeteilt werden, aber nicht zusammen mit Location-Datenmutation. Erst sollte klar sein, welche Funktionen reine Popup-Bindings sind und welche Location-State mutieren.

Moegliches Zielmodul spaeter:

- `js/map-features/location-popups.js`

### 4.3 Label-Kollision

Verantwortung:

- Kollisionen zwischen freien Labels und Ortsnamenlabels erkennen
- Prioritaeten bestimmen
- Offsets berechnen und anwenden
- Reflow/Scheduling ueber Frame-Callbacks koordinieren

Typische Daten:

- freie Label-Marker
- Ortsnamenlabel-Marker
- DOM-Rect-/Pixelmesswerte
- Zoom-/Map-Zustand
- Collision-Frame-State

Kopplungen:

- `js/map-features-labels.js`
- `js/map-features-location-name-labels.js`
- CSS/Layout
- Leaflet-Rendering

Architekturbewertung:

Technisch waere ein eigenes Modul plausibel, aber visuell riskant. Ein Split braucht vorher eine genaue Collision-Boundary und einen visuellen Smoke mit dichten Label-Gebieten und mehreren Zoomstufen.

Moegliches Zielmodul spaeter:

- `js/map-features-label-collisions.js`

### 4.4 Path-Lifecycle, Path-CRUD und Live-Updates

Verantwortung:

- Pfaddaten vorbereiten und aktualisieren
- neue Wege/Kanten anwenden
- Live-Updates auf bestehende Path-Layer uebertragen
- Path-Layer entfernen oder ersetzen
- Edit- und Lock-Flows fuer Wege koordinieren
- Rendering-Core-Helper aufrufen
- Routing-/Planner-Refresh nach Path-Aenderungen ausloesen

Typische Daten:

- `pathData`
- `pathLayers`
- aktive Path-Edit-Zustaende
- Feature-Revisions
- Lock-Zustaende
- Map-Layer

Kopplungen:

- `js/map-features-path-domain.js`
- `js/map-features-path-rendering.js`
- `js/map-features-path-labels.js`
- `js/routing.js`
- Review-/Editor-Flows
- Popup-Actions

Architekturbewertung:

Der Rendering-Core und die Domain-Helfer sind bereits ausgelagert. Der Rest ist Datenfluss und Lifecycle. Weitere Schritte muessen als Sub-Boundaries geplant werden.

Moegliche Zielmodule spaeter:

- `js/map-features-path-creation.js`
- `js/map-features-path-geometry-editing.js`
- `js/map-features/path-lifecycle.js`
- `js/map-features/path-edits.js`
- `js/map-features/path-live-updates.js`

Nicht als ein grosser Split umsetzen.

### 4.5 Path-Style-Helfer

Verantwortung:

- Darstellungsfarben und Style-Werte fuer Wege aus Map-/Zoom-/Feature-Kontext ableiten

Typische Daten:

- Map-Zoom
- Path-Konfiguration
- Feature-Subtype
- Rendering-Kontext

Kopplungen:

- `js/map-features-path-rendering.js`
- `js/map-features.js`

Architekturbewertung:

Klein, aber nicht dringend. Ein Umzug waere nur sinnvoll, wenn die Path-Rendering-Grenze bewusst erweitert wird.

Moegliches Zielmodul spaeter:

- `js/map-features/path-style.js`
- oder Integration in `js/map-features-path-rendering.js`

### 4.6 Region-/Gebiets-Orchestrierung

Verantwortung:

- Gebiets-Layer aufbauen und sichtbar schalten
- Timeline-/Jahreslogik koordinieren
- Gebietsdaten laden und anwenden
- Editmode fuer Gebiete verwalten
- Geometrieoperationen und Auswahlzustaende koordinieren
- Tooltips, Kontextmenues und UI-Zustaende synchronisieren

Typische Daten:

- Region-/Gebietsdaten
- Polygon-/Label-Layer
- Timeline-Zustand
- aktive Auswahl-/Edit-Zustaende
- API-/Reload-Status
- Map-Zustand

Kopplungen:

- `js/config.js`
- Dialog-/Review-Dateien
- API-Endpunkte
- Map-Layer
- Editmode
- UI-Bindings

Architekturbewertung:

Das ist kein Rest-Split, sondern eine eigene Architekturaufgabe. Vor Codearbeit muss ein Zielbild entstehen: Datenbesitz, Ladefluss, Layer-Aufbau, Edit-Flows und UI-Bindings.

Moegliche Zielmodule spaeter:

- `js/regions/data.js`
- `js/regions/layers.js`
- `js/regions/timeline.js`
- `js/regions/editing.js`
- `js/regions/ui.js`

Diese Zielstruktur ist nur eine Richtung, keine unmittelbare Umsetzungsempfehlung.

### 4.7 Editmode, Softlocks und Feature-Response-Flows

Verantwortung:

- lokale Revisionen lesen und aktualisieren
- Locks anfordern und freigeben
- Edit-Ergebnisse auf lokale Daten anwenden
- Live-Updates verteilen
- verschiedene Feature-Typen dispatchen

Typische Daten:

- Feature-Payloads
- Revisionen
- Lock-Map
- Location-/Path-/Label-/Region-State
- Feedback-Toast

Kopplungen:

- Location-Flows
- Path-Flows
- Label-Flows
- Region-Flows
- Review-/Dialog-Flows
- API-Endpunkte

Architekturbewertung:

Dieser Bereich ist ein Konsistenzkern. Direkte Splits koennen Seiteneffekte erzeugen. Innerhalb des Bereichs ist aber ein enger Split fuer Feature-Revisionen und Softlocks realistisch, weil diese Funktionen eine klare technische Verantwortung haben.

Moegliche Zielmodule spaeter:

- `js/map-features-feature-state.js` fuer Revisionen und Softlocks als naechster Boundary-Kandidat.
- `js/map-features/feature-dispatch.js` erst spaeter fuer den groesseren Feature-Response-Dispatcher.

### 4.8 DOM-/Event-Bindings und Initialisierung

Verantwortung:

- UI-Events registrieren
- Toggles mit Sichtbarkeitsfunktionen verbinden
- Initiale Syncs ausloesen
- klassische Script-Reihenfolge praktisch zusammenhalten

Typische Daten:

- DOM-Elemente
- jQuery-Selektoren
- globale Funktionen aus anderen Dateien
- Initialisierungsreihenfolge

Kopplungen:

- nahezu alle ausgelagerten `map-features`-Dateien
- `index.html`
- UI-Controls
- Routing
- Editmode

Architekturbewertung:

Event-Bindings sind die Kanten zwischen Modulen. Sie sollten vorerst nicht verteilt werden, solange es kein klares Bootstrap-Konzept gibt.

Moegliches Zielmodul spaeter:

- `js/map-features/bootstrap.js`

Aber erst, wenn klar ist, welche Initialisierung zentral bleiben soll.

## 5. Datenbesitz: grobe Zuordnung

| Daten/Zustand | Aktueller Besitzer | Bemerkung |
| --- | --- | --- |
| `locationData` | `js/map-features.js` | zentrale Ortsdaten, stark mutierend |
| `locationMarkers` | `js/map-features.js` | Marker-Entries, Popup- und Label-Kanten |
| `pathData` | `js/map-features.js` | Path-Lifecycle bleibt Restverantwortung |
| `pathLayers` | `js/map-features.js` | Rendering-Core ausgelagert, Besitz bleibt hier |
| freie Labels | `js/map-features-labels.js` | Kollision bleibt Restkante |
| Ortsnamenlabels | `js/map-features-location-name-labels.js` | Kollision bleibt Restkante |
| Powerlines | `js/map-features-powerlines.js` | stabiler Split |
| Planner-/URL-State | `js/map-features-layer-state.js` | stabiler Split |
| Share-Pin | `js/map-features-share-pin.js` | stabiler Split |
| Waypoint-UI | `js/map-features-waypoints.js` | stabiler Split |
| Gebiete/Regionen | `js/map-features.js` | eigene Architekturaufgabe |
| Locks/Revisionen | `js/map-features.js` | naechster enger Boundary-Kandidat |

## 6. Mutierende Flows, die vor jedem weiteren Split verstanden werden muessen

### Location-Move-Flow

1. Marker wird verschoben.
2. neue Position wird gespeichert.
3. lokale Location-Daten werden aktualisiert.
4. angeschlossene Wege werden ggf. mitverschoben.
5. Labels und Route werden aktualisiert.
6. Feedback/Revisionen werden synchronisiert.

Risiko:

- Datenkonsistenz zwischen Location, Path, Route und UI.

### Path-Update-Flow

1. Path-Payload kommt aus Edit, Review oder Live-Update.
2. `pathData` wird aktualisiert.
3. Layer-Geometrie und Popup werden aktualisiert.
4. Labels/Rendering werden synchronisiert.
5. Route wird ggf. aktualisiert.

Risiko:

- doppelte Layer, stale Popups, falsche Route, verlorene Revisionen.

### Feature-Response-Flow

1. API- oder Live-Update-Ergebnis kommt zurueck.
2. Feature-Typ wird erkannt.
3. passender lokaler Datenbestand wird mutiert.
4. UI-/Layer-/Route-/Label-Syncs werden ausgeloest.

Risiko:

- zentrale Dispatch-Logik darf nicht versehentlich auseinandergezogen werden.

### Region-Mode-Flow

1. Kartenmodus oder Timeline-Zustand aendert sich.
2. Gebietsdaten werden sichtbar/unsichtbar.
3. Layer, Labels und optionale Datenreloads werden synchronisiert.
4. Edit-/Auswahlzustaende muessen ggf. geschlossen werden.

Risiko:

- Moduswechsel, UI-Zustand und Layer-Zustand koennen auseinanderlaufen.

## 7. Potenzielle Zielarchitektur spaeter

Eine spaetere groessere Bereinigung koennte langfristig in diese Richtung gehen:

```text
js/
  map-features/
    display-mode.js
    layer-state.js
    share-pin.js
    waypoints.js
    labels.js
    label-collisions.js
    location-name-labels.js
    location-markers.js
    location-marker-rendering.js
    location-popups.js
    path-domain.js
    path-style.js
    path-labels.js
    path-rendering.js
    path-creation.js
    path-geometry-editing.js
    path-lifecycle.js
    feature-state.js
    feature-dispatch.js
    bootstrap.js
  regions/
    data.js
    layers.js
    timeline.js
    editing.js
    ui.js
```

Diese Struktur ist kein kurzfristiger Umzugsplan. Sie beschreibt nur eine moegliche Richtung, falls `map-features.js` spaeter systematisch weiter zerlegt wird.

## 8. Kurzfristige Empfehlung

Kein unvorbereiteter Code-Split sofort.

Weitere `map-features.js`-Splits sind moeglich, aber nur mit separater Boundary, engem Scope und eigenem Smoke. Die aktuell plausiblen Kandidaten sind:

1. Feature-Revisionen / Softlocks.
2. Location-Marker-Rendering / Sichtbarkeit.
3. Label-Kollision.
4. Path-Creation.
5. Path-Geometry-Editing.

Der naechste sinnvolle technische Schritt ist die Boundary-Analyse fuer Feature-Revisionen / Softlocks.

## 9. Konkrete naechste Boundary-Kandidaten

Nur mit separater Boundary:

1. Feature-Revisionen / Softlocks.
2. Location-Marker-Rendering / Sichtbarkeit.
3. Label-Kollision als technischer Service.
4. Path-Creation.
5. Path-Geometry-Editing.

Nicht als naechster Code-Schritt:

- Region-/Gebietsblock.
- Feature-Response-Dispatcher als Ganzes.
- grobe Location-Datenmutation.
- Path-Lifecycle-Komplettsplit.
- DOM-/Init-/Event-Bindings ohne Bootstrap-Boundary.

## 10. Schlussentscheidung

`js/map-features.js` bleibt vorerst bewusst gross, aber die Groesse ist jetzt genauer dokumentiert: Die Datei enthaelt Rest-Orchestrierung und Datenmutation, aber innerhalb dieser Restarchitektur existieren noch mehrere abgrenzbare Boundary-Kandidaten.

Weitere Entschlackung ist moeglich, aber nur als Architekturarbeit mit explizitem Datenfluss- und Smoke-Plan. Der naechste Kandidat ist Feature-Revisionen / Softlocks.