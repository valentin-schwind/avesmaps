# Routing API Boundary Check

## 1. Ziel

Dieses Dokument definiert die naechste Refactoring-Grenze fuer das Avesmaps-Routing. Ziel ist eine fachliche Boundary zwischen Browser-UI, Routing-Optionen, Graph-Aufbau, Wegsuche, Routenplan-Aggregation und einem spaeteren PHP-Endpunkt fuer externe Anfragen.

Die Boundary ist bewusst ein vorbereitender Schritt. Der naechste Code-Commit soll klein und verhaltensneutral bleiben.

## 2. Ausgangslage

Die bestehende Refactoring-Dokumentation legt eine konservative Methodik fest: klassische globale Script-Dateien, keine ES-Module, keine unvorbereiteten Mikro-Splits und Boundary-Checks vor Code-Aenderungen.

Relevante bestehende Dokumente:

- `docs/refactoring-status.md`
- `docs/route-graph-extraction-plan.md`
- `docs/routing-core-status.md`
- `docs/create-graph-boundary-check.md`
- `docs/create-graph-transport-boundary-check.md`
- `api/README.md`

Der aktuelle Stand ist:

- `api/map-features.php` liefert SQL-basierte Kartendaten als GeoJSON.
- `api/map-search.php` liefert die Spotlight-Suche.
- Edit- und Review-Flows verwenden bereits PHP-/SQL-Endpunkte.
- Die eigentliche Routenberechnung laeuft weiterhin im Browser.
- `calculateRouteCore(...)` ist bereits relativ sauber parameterisiert.
- `createGraph(...)` ist der zentrale Kopplungspunkt, weil dort Kartendaten, Transportauswahl, Geschwindigkeiten, synthetische Verbindungen und UI-Zustand zusammenlaufen.

## 3. Neue Boundary

Die neue fachliche Grenze lautet:

Routing nimmt ein explizites RouteRequest-Modell entgegen und liefert ein vollstaendiges RouteResult-Modell zurueck. Browser-UI und PHP-API duerfen dieses Modell verwenden. HTML, Leaflet-Layer und jQuery-Control-Zugriffe gehoeren nicht in die fachliche Route.

## 4. RouteRequest-Felder

Das Request-Modell muss alle vorhandenen Anwendungsparameter abbilden:

- `from`: Startort.
- `to`: Zielort.
- `via`: optionale Zwischenorte.
- `optimize`: `fastest` oder `shortest`.
- `include_air_distance`: Luftlinie berechnen.
- `include_geometry`: zusammengefuehrte Routengeometrie liefern.
- `include_steps`: lesbare Etappen liefern.
- `include_routed_segments`: zugrundeliegende Segmente liefern.
- `include_rests`: Rastzeiten einrechnen.
- `rest_hours_per_day`: Raststunden pro Tag.
- `minimize_transfers`: Umstiegsstrafe verwenden.
- `transports.land.enabled` und `transports.land.mode`.
- `transports.river.enabled` und `transports.river.mode`.
- `transports.sea.enabled` und `transports.sea.mode`.
- `transports.synthetic.enabled` und `transports.synthetic.mode`.

## 5. RouteResult-Felder

Das Resultat muss fuer Browser, API-Clients und spaetere textuelle Antworten geeignet sein:

- `ok`: Erfolg oder Fehler.
- `query`: normalisierter Request.
- `from`, `to`, `waypoints`.
- `summary.distance_miles`.
- `summary.air_distance_miles`.
- `summary.travel_hours`.
- `summary.rest_hours`.
- `summary.total_hours`.
- `summary.total_days`.
- `summary.optimize`.
- `summary.transfers`.
- `steps`: Etappen mit Typ, Transport, Start, Ziel, Wegname, Distanz, Reisezeit, Rastzeit und Segment-IDs.
- `geometry`: optionale LineString-Geometrie.
- `segments`: optionale Rohsegmente fuer UI/Debug.
- `warnings`: nicht-fatale Hinweise.
- `metadata`: Revision, Feature-Anzahl und Generierungszeitpunkt.

Fehler sollen strukturiert als `ok: false`, `error`, `code` und `details` zurueckgegeben werden.

## 6. Zu erhaltende Produktparameter

Beim Refactor duerfen keine bestehenden Funktionen verloren gehen:

- Start, Ziel und mehrere Wegpunkte.
- Schnellste oder kuerzeste Route.
- Landwege, Flusswege und Seewege aktiv/inaktiv.
- jeweilige Verkehrsmittel fuer Land, Fluss und See.
- synthetische Querfeldein-Verbindungen.
- Rastzeiten und Raststunden.
- Umstiege minimieren.
- Luftlinie.
- Routengeometrie.
- Segment-IDs fuer UI-Selektion.
- sprechende Etappennamen, inklusive Kreuzungen/Markierungen.
- benannte Fluss- oder Wegstrecken.

## 7. Browser-Zielstruktur

Langfristige Struktur, weiterhin ohne ES-Module:

- `js/routing/route-options.js`: RouteRequest normalisieren und aus UI lesen.
- `js/routing/route-graph.js`: Graph-Aufbau aus Locations, Paths und Options.
- `js/routing/route-core.js`: Wegsuche.
- `js/routing/route-result.js`: Summary, Steps, Luftlinie und Aggregation.
- `js/routing/route-display.js`: Leaflet-Route und Routenplan-HTML.
- `js/routing/route-controller.js`: UI-Orchestrierung.

Diese Zielstruktur wird nicht in einem Schritt umgesetzt.

## 8. PHP/API-Zielstruktur

Langfristige Struktur:

- `api/route.php`.
- `api/route-lib/RouteOptions.php`.
- `api/route-lib/RouteFeatureRepository.php`.
- `api/route-lib/RouteGraph.php`.
- `api/route-lib/RouteFinder.php`.
- `api/route-lib/RouteResult.php`.

`api/route.php` soll spaeter Bootstrap/CORS der bestehenden API nutzen, Request-Parameter normalisieren, SQL-Features aus der bestehenden Kartendatenquelle laden, einen Routing-Graphen bauen, die Route berechnen und ein RouteResult als JSON liefern.

## 9. Wichtige Architekturentscheidung

Produktziel ist ein echter PHP-Endpunkt fuer externe Routing-Requests. Trotzdem soll dieser nicht sofort gebaut werden.

Grund: Ohne stabilen JS-RouteRequest/RouteResult-Vertrag wuerde die PHP-Implementierung zu frueh festgelegt. Ausserdem droht Drift zwischen JS und PHP bei Geschwindigkeiten, Transportdomains, synthetischen Verbindungen und Aggregationslogik.

Der sichere Weg ist daher:

1. Zuerst Browser-seitig RouteOptions explizit machen.
2. Danach Graph-Aufbau von direkten DOM-Zugriffen entkoppeln.
3. Danach RouteResult als fachliches Modell stabilisieren.
4. Erst danach PHP-Portierung und `api/route.php`.

## 10. Naechste Refactoring-Boundary

Die naechste Boundary ist Route Options Extraction.

Kleiner naechster Code-Schritt:

- `buildRouteOptionsFromPlannerControls()` einfuehren.
- `getTransportOptionForRouteType(routeType, routeOptions)` einfuehren.
- `getTransportOption(routeType)` als Kompatibilitaetswrapper erhalten.
- `createGraph(routeOptions = buildRouteOptionsFromPlannerControls())` vorbereiten, wenn die Aufrufkette risikoarm bleibt.
- Keine HTML-, Leaflet- oder sichtbare Routing-Aenderung.

## 11. Explizite Nicht-Ziele fuer den naechsten Commit

Nicht im naechsten Commit:

- kein `api/route.php`.
- keine PHP-Portierung des Dijkstra-Algorithmus.
- keine ES-Module.
- keine grossflaechige Umbenennung aller Routing-Dateien.
- kein Umbau von `showRoutePlan(...)`.
- keine Aenderung von Geschwindigkeiten oder Distanzskalierung.
- keine Entfernung synthetischer Verbindungen.

## 12. Smoke-Plan fuer den naechsten Code-Commit

Nach dem Options-Boundary-Commit pruefen:

1. Standardroute mit zwei Orten.
2. Route mit Zwischenwegpunkt.
3. Schnellste vs. kuerzeste Route.
4. Landwege deaktivieren.
5. Flusswege deaktivieren.
6. Seewege deaktivieren.
7. Verkehrsmittel wechseln und Reisezeit vergleichen.
8. Rastzeiten aktivieren/deaktivieren.
9. `minimizeTransfers` aktivieren/deaktivieren.
10. Route teilen und aus URL wiederherstellen.
11. Browser-Konsole auf Routing-Warnungen pruefen.

## 13. Entscheidung

Die naechste technische Arbeit soll nicht mit der PHP-API beginnen, sondern mit der Route-Options-Boundary im Browser. Das reduziert die aktuelle DOM-Kopplung von `createGraph(...)` und bereitet gleichzeitig den spaeteren PHP-Endpunkt vor.
