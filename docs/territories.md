# Herrschaftsgebiete

Diese Notiz beschreibt das neue Daten- und Editor-Modell fuer politische
Herrschaftsgebiete im bestehenden Avesmaps-System.

## Datenmodell

Das Modell trennt Wiki-Referenzdaten, redaktionelle Avesmaps-Daten und
Geometrien:

- `political_territory_wiki` speichert importierte Wiki-Aventurica-Felder
  moeglichst unveraendert. WikiSync aktualisiert diese Tabelle anhand eines
  stabilen Schluessels aus Wiki-Link oder normalisiertem Namen.
- `political_territory` ist das redaktionelle Avesmaps-Modell. Es enthaelt
  Anzeigenamen, Farbe, Transparenz, Hierarchie, Timeline, Zoomfilter,
  Wappen-Link und redaktionelle Notizen.
- `political_territory_geometry` enthaelt die eigentliche Kartengeometrie als
  GeoJSON `Polygon` oder `MultiPolygon`. Ein Herrschaftsgebiet kann beliebig
  viele Geometrien haben; Enklaven, Exklaven und Loecher werden ueber
  MultiPolygons und Polygon-Ringe abgebildet.
- `political_territory_relation` ist fuer zeitlich oder semantisch erweiterte
  Beziehungen vorbereitet. Die aktuelle Parent-Hierarchie liegt direkt auf
  `political_territory.parent_id`.

Die Migration liegt in `sql/2026-05-15-political-territories.sql`; das gleiche
Schema ist auch in `api/schema.future.mysql.sql` enthalten. Der bestehende
Admin-Endpoint meldet die neuen Tabellen im Datenbankstatus.

## WikiSync

Der normale WikiSync-Lauf importiert Herrschaftsgebiete in einer eigenen Phase
`political_territories`. Die serverseitige Referenz liegt in der Tabelle
`political_territory_wiki`; lokale JSON-Ablagen werden dafuer nicht mehr
verwendet.

Beim Import werden nur Datensaetze mit `Kontinent = Aventurien` als lokale
Herrschaftsgebiete angelegt. Wiki-Referenzdaten werden aktualisiert, aber
redaktionelle Felder und vorhandene Geometrien werden nicht ueberschrieben.
Die importierte Referenz enthaelt 500 Herrschaftsgebiete in 36
`Zugehoerigkeit-Root`-Bereichen; der Editor nutzt diese Root-Werte als
Such- und Gruppierungsstruktur im Parent/Hierarchie-Baum.
Wenn ein lokales Gebiet noch keine redaktionelle Geometrie hat und eine alte
`region` per Name, normalisiertem Namen, geographischem/politischem Feld oder
Zugehoerigkeitspfad passt, wird diese als Startgeometrie kopiert. Automatisch
geseedete `legacy_region_seed`-Geometrien duerfen vom Sync regeneriert werden,
redaktionell gespeicherte `editor`-Geometrien nicht.

Wappen-URLs werden importiert, wenn sie nicht nach Navigations-, Karten- oder
Platzhaltergrafiken aussehen. Geblockt sind unter anderem `pfeil`, `arrow`,
`positionskarte`, `karte`, `map`, `icon`, `noimage`, `transparent` und
`region_ohne`.

## API

`api/political-territories.php` stellt die neuen Endpunkte bereit:

- `GET action=layer`: sichtbare Herrschaftsgebiete fuer Layer, BF-Jahr, Zoom und
  optionale Bounding Box laden.
- `GET action=list`: auswaehlbare Herrschaftsgebiete fuer den Editor laden.
- `GET action=get`: einzelnes Gebiet mit Wiki-Referenz und Geometrien laden.
- `GET action=wiki`: Wiki-Referenzdaten fuer ein Gebiet laden.
- `GET action=wiki_list`: alle Wiki-Referenzen fuer den Editor-Picker laden.
- `GET action=hierarchy`: aktuelle Baumstruktur laden.
- `GET action=geometries`: Geometrien eines Gebiets laden.
- `PATCH action=create_territory|update_territory|delete_territory`: das
  redaktionelle Modell bearbeiten.
- `PATCH action=create_geometry|update_geometry|delete_geometry`: Geometrien
  bearbeiten.
- `PATCH action=save_hierarchy`: Parent-Struktur speichern.
- `PATCH action=geometry_operation`: Ergebnis einer Union, Difference oder
  Intersection serverseitig persistieren.

Der Layer-Endpoint filtert numerisch ueber `valid_from_bf`, `valid_to_bf` sowie
Geometrie-Zeitfelder. Wenn Parent und Child gleichzeitig sichtbar waeren, wird
der Parent deterministisch unterdrueckt.

## Frontend und Editor

Der bestehende Layer `political` laedt bei SQL-Konfiguration das neue
Herrschaftsgebiete-Modell. Falls die API nicht erreichbar ist, faellt die Karte
auf die bisherigen `map_features`-Regionen zurueck.

Die BF-Timeline erscheint nur, wenn der politische Layer aktiv ist. Der
Standardwert ist das aktuelle Redaktionsjahr `1049 BF`. Negative
BF-Werte stehen intern fuer `v. BF`. Textuelle Datierungen aus dem Wiki bleiben
fuer Anzeige und Redaktion erhalten.

Im Editor koennen Herrschaftsgebiete ausgewaehlt, per Doppelklick in der
Geometrie bearbeitet und ueber Rechtsklick per Kontextmenue verarbeitet werden.
Das Kontextmenue bietet:

- Grenzen bearbeiten
- Eigenschaften bearbeiten
- Mit anderem vereinigen
- Von anderem ausschneiden
- Neues von anderem ausschneiden
- Loeschen

Aktive mehrstufige Operationen werden als Chip angezeigt und koennen mit `Esc`
abgebrochen werden.

Der Eigenschaften-Dialog zeigt die Wiki-Referenz dauerhaft als Box oben an,
inklusive anklickbarem Wiki-Link. Ueber "Wiki-Referenz aendern" kann eine
andere importierte Wiki-Referenz gesucht und verknuepft werden. Der
Parent/Hierarchie-Baum hat eine Suchmaske, einklappbare Root-/Parent-Knoten und
gruppiert die langen Listen nach den 36 Wiki-Root-Bereichen. Farbe und
Transparenz liegen in einer Zeile; der Wappen-Link zeigt sofort eine Vorschau.
Numerische Von/Bis-Jahre koennen direkt gesetzt werden, wobei "heute" das
Bis-Feld deaktiviert und als offenes Ende gespeichert wird.

## Geometriephase

Vollstaendig umgesetzt:

- mehrere Geometrien pro Herrschaftsgebiet
- `Polygon` und `MultiPolygon` inklusive Loechern
- Snap-to-vertex
- Snap-to-edge
- Shared-Vertex-Aktualisierung angrenzender Herrschaftsgebiete beim Verschieben
  gemeinsamer Eckpunkte
- Union, Difference und Intersection ueber `polygon-clipping`
- serverseitiges Speichern der berechneten Operationsergebnisse

Vorbereitet, aber noch nicht als echte Shared-Boundary-Topologie umgesetzt:

- eine eigene Relationstabelle fuer spaetere Topologie- und Zeitbeziehungen
- Geometrieoperationen, die gemeinsame Grenzen sauberer erzeugen koennen
- Edge-Splitting und vollstaendige gemeinsame Kantenpflege ohne identische
  Eckpunkte

Das Verschieben einer gemeinsamen Ecke aktualisiert angrenzende Gebiete, wenn
deren Eckpunkt bereits auf derselben Koordinate liegt. Das Verschieben ganzer
Kanten ohne gemeinsame Eckpunkte ist die naechste Ausbaustufe.

## Manuelle Tests

1. Schema installieren oder die Migration ausfuehren.
2. Im Editor WikiSync oeffnen und "Synchronisieren" ausfuehren. Der Lauf
   importiert Orte und anschliessend Herrschaftsgebiete.
3. Layer "Politisch" aktivieren und pruefen, dass die Timeline unten mittig
   erscheint.
4. BF-Jahr aendern und sichtbare Gebiete pruefen.
5. Zoomstufen wechseln und Parent/Child-Darstellung pruefen.
6. Ein Herrschaftsgebiet doppelklicken, Eckpunkte ziehen und Speichern pruefen.
7. Rechtsklick auf eine Region, Union/Difference/Intersection waehlen und ein
   zweites Gebiet anklicken.
8. `Esc` waehrend einer Operation druecken und pruefen, dass der Chip
   verschwindet.

Lokaler Hinweis: Die PHP-CLI in dieser Arbeitsumgebung hat kein `mbstring`;
eine direkte Import-Laufzeitprobe bricht deshalb bei bestehenden
`mb_*`-Helpern ab. Die PHP-Dateien wurden statisch mit `php -l` geprueft.
