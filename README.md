# Avesmaps

Avesmaps ist ein statischer Routenplaner fuer Aventurien aus dem Rollenspiel "Das Schwarze Auge". Die Anwendung zeigt eine kachelbasierte Karte, Orte, Wege und optionale Regionsgrenzen an und berechnet Reiserouten direkt im Browser.

![Beispielansicht](img/example.jpg)

## Was das Projekt kann

- Orte, Wege und Grenzen auf einer lokal gehosteten Karte darstellen
- eine politische Karte mit den Grenzen der Reiche anzeigen
- Routen zwischen mehreren Wegpunkten berechnen
- zwischen kuerzester und schnellster Route unterscheiden
- Land-, Fluss- und Seewege mit unterschiedlichen Transportmitteln einbeziehen
- Umstiege auf Wunsch mit einer Strafgewichtung minimieren
- die aktuelle URL kopieren, um Routen und Einstellungen direkt zu teilen

## Wie die Routen berechnet werden

Die Routenberechnung basiert auf dem **Dijkstra-Algorithmus**. Im Code wird dafuer ein gewichteter Graph aus den GeoJSON-Wegen aufgebaut:

- Orte werden als Knoten verwendet
- Wege zwischen zwei Orten werden als Kanten verwendet
- jede Kante erhaelt Gewichte fuer Distanz und Reisezeit
- optional wird eine zusaetzliche Umstiegsstrafe beruecksichtigt, wenn das Transportmittel wechselt

Zur Beschleunigung verwendet die Implementierung eine **PriorityQueue auf Basis eines Min-Heaps**. Dadurch werden immer zuerst die aktuell guenstigsten Kandidaten verarbeitet. Je nach Einstellung optimiert der Algorithmus auf Distanz oder auf Reisezeit.

## Technischer Aufbau

Die Anwendung ist bewusst einfach gehalten:

- `index.html` enthaelt den groessten Teil der Logik fuer Karte, Datenverarbeitung und Routenplanung
- `tiles/` enthaelt die Kartenkacheln
- `map/aventurien_routes.geojson` enthaelt Orte und Wege fuer die Routenplanung
- `map/Aventurien_routes.svg` ist die SVG-Quelldatei fuer die Geodaten
- `css/`, `js/` und `fonts/` enthalten alle benoetigten Assets lokal im Repository

Es gibt **keine Abhaengigkeit zu externen Diensten**:

- kein Backend
- keine API
- keine Datenbank
- kein externer Tile-Server
- keine CDN-Einbindung

Damit kann das Projekt auf **jedem normalen Webserver** betrieben werden, der statische Dateien ausliefert.

## Lokale Nutzung

Da die Anwendung GeoJSON per XMLHttpRequest laedt, sollte sie nicht direkt per `file://` geoeffnet werden. Stattdessen sollte ein kleiner lokaler Webserver verwendet werden.

Beispiel mit Python im Projektverzeichnis:

```bash
python -m http.server 8000
```

Danach ist die Anwendung unter [http://localhost:8000](http://localhost:8000) erreichbar.

## Deployment

Fuer den Betrieb reicht es, den kompletten Projektordner auf einen beliebigen Webserver zu legen. Es ist kein Build-Schritt und keine Serverlogik notwendig. Solange HTML-, CSS-, JS-, Bild-, Tile- und GeoJSON-Dateien statisch ausgeliefert werden, laeuft die Anwendung.

## URL-Sharing des Routenplaners

Der Zustand des Routenplaners kann ueber Query-Parameter in der URL gespeichert und geteilt werden. Dazu gehoeren insbesondere:

- die Wegpunkte
- die Auswahl schnellste oder kuerzeste Route
- die Anzeigeoptionen fuer Orte, Wege und Grenzen
- die aktivierten Transportwege
- die gewaehlten Transportmittel
- Rastzeiten
- die Option zum Minimieren von Umstiegen

Dadurch kann eine fertig konfigurierte Route einfach geteilt werden, indem die URL aus dem Browser kopiert und weitergegeben wird.

## SVG zu GeoJSON konvertieren

Die Datei [`map/SVGtoGeoJSON.py`](map/SVGtoGeoJSON.py) konvertiert die SVG-Grundlage in die von der Anwendung verwendete GeoJSON-Datei.

### Erwartete Dateien

Das Skript arbeitet mit festen Dateinamen im Ordner `map/`:

- Eingabe: `map/Aventurien_routes.svg`
- Ausgabe: `map/aventurien_routes.geojson`

### Ausfuehrung

Im Projektverzeichnis:

```bash
python map/SVGtoGeoJSON.py
```

Alternativ direkt im `map`-Ordner:

```bash
python SVGtoGeoJSON.py
```

### Was das Skript macht

- es liest `circle`-Elemente als Punkte ein
- es liest `path`-Elemente als Linien ein
- es uebernimmt Inkscape-Labels als Namen
- es erkennt doppelte Ortsnamen und bricht in diesem Fall ab
- es schreibt daraus eine GeoJSON-`FeatureCollection`

### Abhaengigkeiten des Skripts

Das aktuelle Skript verwendet nur Python-Standardbibliothek:

- `xml.etree.ElementTree`
- `json`
- `pathlib`

Es werden auch fuer die Konvertierung **keine externen Services** benoetigt.

## Hinweise zur Datenpflege

- Die SVG ist die fachliche Quelle fuer Orte und Wege.
- Nach Aenderungen an der SVG sollte die GeoJSON-Datei neu erzeugt werden.
- Danach kann der aktualisierte Stand direkt ueber den statischen Webserver ausgeliefert werden.
