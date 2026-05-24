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
- Location-Marker-Rendering-/Sichtbarkeits-Helfer
- Feature-State-/Revision-/Softlock-Helfer
- Share-Pin-/Clipboard-Helfer
- Waypoint-UI-Helfer
- Ortsnamenlabel-Helfer
- Label-Kollisions-Helfer
- Path-Domain-/Basis-Helfer
- Path-Textlabel-Helfer
- Path-Rendering-Core-Helfer
- Path-Creation-Helfer
- Path-Geometry-Editing-Helfer

`js/map-features.js` enthaelt danach vor allem Restverantwortungen mit hoher Kopplung:

- zentrale Datenmutation
- globale Karten-/Layer-Orchestrierung
- Editmode- und Lock-Flows
- Feature-Response-Dispatcher
- DOM-/Event-Kanten
- Region-/Gebietslogik
- Location-Marker- und Popup-Anbindung
- Path-Lifecycle und Live-Update-Flows

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

Der Gesamtblock Location-Marker und Ortsdaten bleibt zu stark gekoppelt fuer einen direkten Komplettsplit. Der engere Split fuer Location-Marker-Rendering und Sichtbarkeit wurde bereits umgesetzt und bleibt stabil. Der verbleibende Location-Block ist vor allem Lifecycle, Datenmutation und Popup-Anbindung.

Moegliche Zielmodule spaeter:

- `js/map-features/location-markers.js` fuer den groesseren Lifecycle, nur nach eigener Boundary und Datenflussanalyse.

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

Status: abgeschlossen.

Die Label-Kollisionslogik wurde aus `js/map-features.js` nach `js/map-features-label-collisions.js` verschoben.

Verantwortung der ausgelagerten Datei:

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

Dieser technische Service bleibt stabil. Weitere Aenderungen an Label-Kollisionen sollten nicht mit anderen Splits vermischt werden, weil sie direkt sichtbare Labelpositionen betreffen.

### 4.4 Path-Creation

Status: abgeschlossen.

Die Path-Creation-Helfer wurden aus `js/map-features.js` nach `js/map-features-path-creation.js` verschoben.

Verantwortung der ausgelagerten Datei:

- Pending-State fuer neue Wege verwalten
- Startpunkt aus Ort/Kreuzung oder Kartenclick setzen
- Preview-Marker und Preview-Linie anzeigen
- Zwischenpunkte aufnehmen
- Zielknoten suchen und Weg final erstellen
- erstellten Weg lokal anwenden und Path-Edit-Dialog anschliessen

Bewusst als Shared-Helper in `js/map-features.js` belassen:

- `findNearestGraphEndpointToLatLng(...)`, da diese Funktion aktuell auch vom Path-Geometry-Editing genutzt wird.

Architekturbewertung:

Der Split ist als enger 1:1-Extract erfolgt. Path-Creation bleibt vorerst stabil und sollte ohne neue Boundary nicht weiter aufgeteilt werden.

### 4.5 Path-Geometry-Editing

Status: abgeschlossen.

Die Path-Geometry-Editing-Helfer wurden aus `js/map-features.js` nach `js/map-features-path-geometry-editing.js` verschoben.

Verantwortung der ausgelagerten Datei:

- aktive Weg-Geometriebearbeitung starten und beenden
- Edit-Handles erzeugen und synchronisieren
- Knoten ziehen, einfuegen und loeschen
- Endpunkte an Orte/Kreuzungen snappen
- Weg an Zwischenknoten teilen
- Geometrie speichern und Layer aktualisieren

Bewusst in `js/map-features.js` belassen:

- `deletePathFeature(...)` als CRUD/Lifecycle-naher Grenzfall
- `findNearestGraphEndpointToLatLng(...)` als Shared-Helper fuer Path-Creation und Path-Geometry-Editing

Architekturbewertung:

Der Split ist als enger 1:1-Extract erfolgt. Path-Geometry-Editing bleibt vorerst stabil und sollte ohne neue Boundary nicht weiter aufgeteilt werden.

### 4.6 Path-Lifecycle, Path-CRUD und Live-Updates

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

- `js/map-features/path-lifecycle.js`
- `js/map-features/path-edits.js`
- `js/map-features/path-live-updates.js`

Nicht als ein grosser Split umsetzen.

### 4.7 Path-Style-Helfer

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

### 4.8 Region-/Gebiets-Orchestrierung

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

### 4.9 Editmode, Softlocks und Feature-Response-Flows

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

Revisionen und Softlocks wurden bereits in `js/map-features-feature-state.js` ausgelagert. Der verbleibende Feature-Response-Dispatcher ist weiterhin ein Konsistenzkern und sollte nicht direkt gesplittet werden.

Moegliches Zielmodul spaeter:

- `js/map-features/feature-dispatch.js` erst spaeter fuer den groesseren Feature-Response-Dispatcher.

### 4.10 DOM-/Event-Bindings und Initialisierung

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
| Path-Creation-Pending-State | `js/map-features-path-creation.js` | stabiler Split |
| Path-Geometry-Edit-State | `js/map-features-path-geometry-editing.js` | stabiler Split |
| freie Labels | `js/map-features-labels.js` | stabiler Split |
| Ortsnamenlabels | `js/map-features-location-name-labels.js` | stabiler Split |
| Label-Kollision | `js/map-features-label-collisions.js` | stabiler Split, DOM-/Layout-nahe Verantwortung |
| Powerlines | `js/map-features-powerlines.js` | stabiler Split |
| Planner-/URL-State | `js/map-features-layer-state.js` | stabiler Split |
| Share-Pin | `js/map-features-share-pin.js` | stabiler Split |
| Waypoint-UI | `js/map-features-waypoints.js` | stabiler Split |
| Location-Marker-Rendering | `js/map-features-location-marker-rendering.js` | stabiler Split |
| Locks/Revisionen | `js/map-features-feature-state.js` | stabiler Split |
| Gebiete/Regionen | `js/map-features.js` | eigene Architekturaufgabe |

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

### Path-Creation-Flow (ausgelagert, aber gekoppelt)

1. Startort oder Startposition wird bestimmt (in `js/map-features-path-creation.js`).
2. Pending-State und Preview-Layer werden aufgebaut.
3. Zwischenpunkte werden gesammelt.
4. Zielknoten wird gesucht und hinzugefuegt.
5. API erstellt den Weg.
6. Lokale Path-Daten und Layer werden aktualisiert.
7. Path-Edit-Dialog wird fuer Feineinstellungen geoeffnet.

Risiko:

- haengende Preview-Layer, falsche Map-Click-Handler, unvollstaendige Pending-State-Bereinigung, doppelte Path-Layer.

### Path-Geometry-Edit-Flow

1. Wegbearbeitung wird gestartet und Softlock wird angefordert.
2. Edit-Handles werden erzeugt.
3. Knoten werden gezogen, eingefuegt, geloescht oder zum Split vorbereitet.
4. Geometrie wird lokal und serverseitig gespeichert.
5. Layer, Route und Planner-State werden aktualisiert.
6. Bearbeitung wird beendet und Softlock wird freigegeben.

Risiko:

- stale Handles, falsche Endpoint-Snaps, verlorene Geometrie, fehlende Lock-Freigabe.

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

Weitere `map-features.js`-Splits sind moeglich, aber nur mit separater Boundary, engem Scope und eigenem Smoke.

Der naechste sinnvolle technische Schritt ist eine neue Restbewertung mit Fokus auf Path-Lifecycle/CRUD.

## 9. Konkrete naechste Boundary-Kandidaten

Nur mit separater Boundary:

1. Path-Lifecycle/CRUD (inklusive Grenzfall `deletePathFeature`).

Nicht als naechster Code-Schritt:

- Region-/Gebietsblock.
- Feature-Response-Dispatcher als Ganzes.
- grobe Location-Datenmutation.
- Path-Lifecycle-Komplettsplit.
- DOM-/Init-/Event-Bindings ohne Bootstrap-Boundary.

## 10. Schlussentscheidung

`js/map-features.js` bleibt vorerst bewusst gross, aber die Groesse ist jetzt genauer dokumentiert: Die Datei enthaelt Rest-Orchestrierung und Datenmutation, aber innerhalb dieser Restarchitektur existieren noch abgrenzbare Boundary-Kandidaten.

Weitere Entschlackung ist moeglich, aber nur als Architekturarbeit mit explizitem Datenfluss- und Smoke-Plan. Der naechste Kandidat ist eine gesonderte Path-Lifecycle/CRUD-Boundary.
