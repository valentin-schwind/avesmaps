# Avesmaps

Avesmaps ist ein offener, nicht-kommerzieller Routenplaner fuer Aventurien aus
dem Rollenspiel "Das Schwarze Auge". Die Anwendung zeigt eine kachelbasierte
Karte, Orte, Wege und optionale Regionsgrenzen an und berechnet Reiserouten
direkt im Browser.

![Beispielansicht](img/example.jpg)

Die aktuell erreichbare Version laeuft unter [https://valentin-schwind.github.io/avesmaps/](https://valentin-schwind.github.io/avesmaps/).

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
- `map/Aventurien_routes.geojson` enthaelt Orte und Wege fuer die Routenplanung
- `map/Aventurien_routes.svg` ist die editierbare SVG-Quelle fuer die Geodaten
- `map/svg_to_geojson.py` konvertiert die SVG in die GeoJSON-Datei
- `api/` enthaelt den optionalen PHP-Endpoint fuer Ortsmeldungen, Beispiel-Konfiguration und SQL-Schemata
- `css/`, `js/` und `fonts/` enthalten alle benoetigten Assets lokal im Repository

Die Karten- und Routenlogik selbst bleibt komplett im Browser:

- kein externer Tile-Server
- keine CDN-Einbindung
- kein Build-Schritt

Fuer Ortsmeldungen kann Avesmaps optional ein kleines PHP-/SQL-Backend nutzen. Ohne `api/` laeuft die Anwendung weiterhin als rein statische Karte und Routenplanung.

## Lokale Nutzung

Da die Anwendung GeoJSON per XMLHttpRequest laedt, sollte sie nicht direkt per `file://` geoeffnet werden. Stattdessen sollte ein kleiner lokaler Webserver verwendet werden.

Beispiel mit Python im Projektverzeichnis:

```bash
python -m http.server 8000
```

Danach ist die Anwendung unter [http://localhost:8000](http://localhost:8000) erreichbar.

Wenn auch das Ortsmelde-Formular lokal getestet werden soll, ist ein PHP-faehiger Server sinnvoll, zum Beispiel:

```bash
php -S localhost:8000
```

Dann koennen die statischen Dateien und `api/report-location.php` direkt ueber denselben Host laufen.

## Deployment

Fuer die reine Karte reicht es, den kompletten Projektordner auf einen beliebigen statischen Webserver zu legen. Es ist kein Build-Schritt notwendig.

Wenn das Ortsmelde-Formular aktiv sein soll, braucht die API einen PHP-faehigen Server und eine SQL-Datenbank. Zwei typische Varianten:

- gesamtes Projekt auf einem PHP-Webserver hosten, sodass `api/report-location.php` relativ erreichbar ist
- Frontend statisch hosten und `window.AVESMAPS_LOCATION_REPORT_ENDPOINT` auf eine absolute API-URL setzen

Wichtig: GitHub Pages kann den PHP-Teil nicht selbst ausfuehren. Ohne separate API bleibt das Meldeformular dort deshalb deaktiviert.

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

## Ortsmeldungen per PHP und SQL

Die Datei `api/report-location.php` nimmt neue Ortsmeldungen als JSON entgegen und speichert sie in der Tabelle `location_reports`.

### Einmaliges Setup

1. Passendes SQL-Schema aus `api/schema.mysql.sql` oder `api/schema.pgsql.sql` ausfuehren.
2. `api/config.example.php` nach `api/config.local.php` kopieren.
3. Dort Datenbank-Zugang und erlaubte Frontend-Origins eintragen.
4. Den Ordner `api/` auf einem PHP-faehigen Server ausliefern.

Alternativ kann die API ueber Umgebungsvariablen konfiguriert werden:

- `AVESMAPS_DB_DRIVER`
- `AVESMAPS_DB_HOST`
- `AVESMAPS_DB_PORT`
- `AVESMAPS_DB_NAME`
- `AVESMAPS_DB_CHARSET`
- `AVESMAPS_DB_USER`
- `AVESMAPS_DB_PASSWORD`
- `AVESMAPS_ALLOWED_ORIGINS`

Wenn Frontend und API nicht auf derselben Origin laufen, muss die Frontend-Seite den Endpoint explizit setzen, zum Beispiel:

```html
<script>
	window.AVESMAPS_LOCATION_REPORT_ENDPOINT = "https://example.org/avesmaps/api/report-location.php";
</script>
```

### Moderations- und Import-Workflow

Ortsmeldungen aus dem Formular werden nicht automatisch in die Karte uebernommen.
Sie landen zuerst als Vorschlaege in der Datenbank und muessen lokal geprueft
werden. Erst das Import-Skript entscheidet interaktiv, ob ein Ort in die SVG
geschrieben wird.

Der praktische Ablauf:

1. Nutzer melden Orte ueber das Formular in Avesmaps.
2. Die PHP-API speichert die Meldungen mit `status = neu` in `location_reports`.
3. Der Betreiber startet lokal `python map/import_reported_locations.py`.
4. Das Skript zeigt jede neue Meldung einzeln mit Name, Quelle, Kommentar und Koordinaten an.
5. Bei Zustimmung wird der Ort in `map/Aventurien_routes.svg` eingefuegt.
6. Danach erzeugt das Skript `map/Aventurien_routes.geojson` neu.
7. Die uebernommene Meldung wird auf `status = alt` gesetzt.
8. Die geaenderte SVG und GeoJSON werden anschliessend bewusst per Git commit/push veroeffentlicht.

Wichtig: Weil die Melde-API und Datenbank von der jeweiligen Avesmaps-Instanz
gehostet werden, sind Community-Meldungen nur Vorschlaege. Die Entscheidung,
welche SVG-Version in GitHub landet und damit oeffentlich ausgeliefert wird,
liegt beim Betreiber dieser gehosteten Instanz.

## SVG zu GeoJSON konvertieren

Die Datei [`map/svg_to_geojson.py`](map/svg_to_geojson.py) konvertiert die
SVG-Grundlage in die von der Anwendung verwendete GeoJSON-Datei.

### Erwartete Dateien

Die relevanten Dateien liegen im Ordner `map/`:

- Eingabe: `map/Aventurien_routes.svg`
- Ausgabe: `map/Aventurien_routes.geojson`

### Ausfuehrung

Im Projektverzeichnis:

```bash
python map/svg_to_geojson.py map/Aventurien_routes.svg --output map/Aventurien_routes.geojson
```

### Was das Skript macht

- es liest Orte, Kreuzungen, Wege und Regionen aus Inkscape-Layern
- es uebernimmt Layer- und Label-Informationen in GeoJSON-Metadaten
- es erhaelt Ortskategorien fuer die UI
- es schreibt daraus eine GeoJSON-`FeatureCollection`

### Abhaengigkeiten des Skripts

Das Skript verwendet ausschliesslich Python-Standardbibliothek.

Es werden fuer die Konvertierung **keine externen Services** benoetigt.

## Wiki-Aventurica-Links erzeugen

Die Datei `map/wiki_location_links.json` enthaelt die statische Lookup-Tabelle
fuer Ortslinks zu Wiki Aventurica. Die Anwendung laedt diese Datei lokal und
fragt Wiki Aventurica nicht zur Laufzeit im Browser ab.

Im Projektverzeichnis:

```bash
python map/build_wiki_location_links.py
```

Das Skript liest die Orte aus `map/Aventurien_routes.geojson`, gleicht sie ueber
die MediaWiki-API mit Wiki Aventurica ab und schreibt zusaetzlich
`map/wiki_location_links_report.json` mit Treffer- und Restlisten.

## Neue Ortsmeldungen aus SQL importieren

Die Datei `map/import_reported_locations.py` liest neue Ortsmeldungen direkt aus
der Tabelle `location_reports` beziehungsweise ueber die serverseitigen Import-Endpunkte,
fragt sie interaktiv durch und uebernimmt angenommene Eintraege in die SVG-Quelle.

Der Ablauf des Skripts:

- es liest Datensaetze mit `status = neu` aus `location_reports`
- es zeigt jeden Eintrag einzeln mit Leaflet- und SVG-Koordinaten an
- bei Zustimmung fuegt es den Ort in `map/Aventurien_routes.svg` ein
- danach erzeugt es direkt `map/Aventurien_routes.geojson` neu
- anschliessend setzt es den angenommenen Eintrag in der Datenbank auf `status = alt`
- bei Ablehnung fragt es zusaetzlich, ob der Datenbank-Eintrag geloescht werden soll

### Voraussetzungen

Die Python-Abhaengigkeiten einmal installieren:

```bash
pip install -r map/requirements-location-import.txt
```

Wenn dein Rechner die MySQL-Datenbank direkt erreichen kann, kannst du dieselben Datenbankwerte bereitstellen, die auch die PHP-API nutzt, zum Beispiel per Umgebungsvariablen:

```bash
export AVESMAPS_DB_DRIVER=mysql
export AVESMAPS_DB_HOST=127.0.0.1
export AVESMAPS_DB_PORT=3306
export AVESMAPS_DB_NAME=avesmaps
export AVESMAPS_DB_USER=avesmaps_user
export AVESMAPS_DB_PASSWORD=replace-with-a-secret-password
```

Unter PowerShell entsprechend:

```powershell
$env:AVESMAPS_DB_DRIVER = "mysql"
$env:AVESMAPS_DB_HOST = "127.0.0.1"
$env:AVESMAPS_DB_PORT = "3306"
$env:AVESMAPS_DB_NAME = "avesmaps"
$env:AVESMAPS_DB_USER = "avesmaps_user"
$env:AVESMAPS_DB_PASSWORD = "replace-with-a-secret-password"
```

Wenn die Datenbank nur intern vom Webserver aus erreichbar ist, kann das Skript stattdessen ueber HTTPS mit den PHP-Import-Endpunkten sprechen. Dann sind diese Umgebungsvariablen ausreichend:

```powershell
$env:AVESMAPS_IMPORT_API_BASE_URL = "https://example.org/avesmaps/api"
$env:AVESMAPS_IMPORT_API_TOKEN = "replace-with-a-long-random-import-token"
```

Das Skript nutzt automatisch die Import-API, sobald `AVESMAPS_IMPORT_API_BASE_URL` gesetzt ist.

### Ausfuehrung

Im Projektverzeichnis:

```bash
python map/import_reported_locations.py
```

Standardmaessig setzt das Skript erfolgreich uebernommene Meldungen auf `status = alt`.

Optional als Testlauf ohne Schreiben:

```bash
python map/import_reported_locations.py --dry-run
```

## Hinweise zur Datenpflege

- Die SVG ist die fachliche Quelle fuer Orte, Wege und Regionen.
- In `map/Aventurien_routes.svg` liegt die editierbare Karte.
- Die SVG wurde in **Inkscape** erstellt und sollte auch dort gepflegt werden.
- Nach Aenderungen an der SVG sollte die GeoJSON-Datei neu erzeugt werden.
- Danach kann der aktualisierte Stand direkt ueber den statischen Webserver
  ausgeliefert werden.

## Rechtliches und Quellen

Avesmaps ist ein Fanprojekt und verwendet DSA-bezogenes Material unter
Beruecksichtigung der Ulisses-Fanrichtlinien.

Wichtige Punkte fuer dieses Repository:

- keine pauschale Open-Source-Lizenz fuer DSA-bezogene Karten-, Bild- und
  Datenassets
- Fanprojekt-Logo statt offizieller Produktlogos
- keine Weitergabe des verwendeten Materials unter Creative-Commons- oder
  vergleichbaren Fremdlizenzen
- keine offizielle Verbindung zu Ulisses Spiele

Details, Quellen und Hinweise zur Rechte-Lage stehen in
[`NOTICE.md`](NOTICE.md).
