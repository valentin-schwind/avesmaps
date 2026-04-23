# Avesmaps

> Avesmaps ist ein offenes, nicht-kommerzielles Fanprojekt und statischer Routenplaner fuer Aventurien aus dem Rollenspiel "Das Schwarze Auge".

## Kurzbeschreibung

Avesmaps ist eine interaktive Webkarte fuer Aventurien. Die Anwendung zeigt Orte, Wege und optional die politischen Grenzen der Reiche. Sie berechnet Reiserouten direkt im Browser und kann auf jedem normalen Webserver als statische Seite betrieben werden.

## Fachlicher Fokus

- Aventurien
- Das Schwarze Auge
- DSA
- Routenplaner
- Politische Karte
- Grenzen der Reiche
- Reisewege und Reisezeiten

## Routing-Logik

- Die Routenberechnung basiert auf dem Dijkstra-Algorithmus.
- Grundlage ist ein gewichteter Graph aus Orten und GeoJSON-Wegebeziehungen.
- Es kann zwischen schnellster und kuerzester Route unterschieden werden.
- Optional wird eine Umstiegsstrafe verwendet, um Transportwechsel zu reduzieren.

## Wichtige Funktionen

- Mehrere Wegpunkte in einer Route
- Auswahl von Land-, Fluss- und Seewegen
- Politische Karte mit optional einblendbaren Reichsgrenzen
- Teilbare Routen und Einstellungen per URL

## Daten und Hosting

- Die Kartendaten liegen lokal im Projekt und werden nicht ueber externe Dienste geladen.
- Die Datei `map/Aventurien_routes_hybrid.geojson` wird von der Anwendung direkt verwendet.
- Die Datei `map/svg_to_geojson.py` konvertiert `map/Aventurien_routes_hybrid.svg` in `map/Aventurien_routes_hybrid.geojson`.
- Es gibt kein Backend, keine Datenbank und keine externe API-Abhaengigkeit.

## Rechtliches

- Das Projekt ist als DSA-Fanprojekt gekennzeichnet.
- Quellen- und Lizenzhinweise stehen in `NOTICE.md`.
- DSA-bezogene Karten-, Bild- und Datenassets stehen nicht unter einer pauschalen Open-Source-Lizenz des Repositories.

## Wichtige URLs

- Live: https://valentin-schwind.github.io/avesmaps/
- Repository: https://github.com/valentin-schwind/avesmaps
