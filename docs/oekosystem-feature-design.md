# Ökosystem — physische Geographie mit Routen-Wirkung

> Status: **Entwurf zur Abstimmung mit den Editoren.** Die Architektur ist
> durchgesprochen, die konkreten Zahlen (Faktoren, Kurven) ausdrücklich nicht —
> die gehören den Editoren, siehe §8.

## 1. Kurzfassung

Editoren zeichnen die **physische Geographie** Aventuriens als Flächen — Sümpfe,
Wälder, Wüsten, Gebirge — und taggen sie semantisch. Diese Flächen wirken auf die
**Routenplanung**: eine Route durch das Nebelmoor wird langsamer, und die
Etappen-Anzeige sagt „Führt durch: Nebelmoor, Großfeenwald".

Das Vorbild ist der politische Territorien-Editor. Der „Ökosystem-Modus" ist sein
Geschwister für die *natürliche* statt der *politischen* Geographie — mit demselben
Zeichenwerkzeug, aber ohne dessen Hierarchie-, Ableitungs- und Streitgebiets-Maschinerie.

## 2. Ausgangslage

Drei Befunde aus dem Code, die den Zuschnitt bestimmen:

1. **Landschaften haben heute keine Flächen.** Die 19 Landschaftstypen
   (`suempfe_moore`, `wald`, `wueste`, … — Allowlist in
   `api/_internal/map/features.php`) existieren ausschließlich als **Punkt-Labels**:
   ein Ankerpunkt plus Text. Für keine einzige Landschaft gibt es ein Polygon.
   Der Editor zum *Zeichnen* der Flächen ist also der große Brocken, nicht das Routing.

2. **Das Zeichenwerkzeug existiert schon.** Der politische Editor bringt einen
   eigenen Vertex-Editor, Boolean-Operationen über `polygon-clipping`,
   Multipolygone, Zuweisungen und Wiki-Verknüpfung mit. Wiederverwendbar; die
   hierarchiespezifische Hälfte (Vererbung, abgeleitete Außengrenzen,
   Streitgebiete) fällt für flache Naturflächen weg.

3. **Das Routing ist besser vorbereitet als gedacht.** Der Graph legt für *jeden*
   Weg **zwei** Kanten an, eine je Richtung, und darf sie schon unterschiedlich
   teuer machen — das fährt seit der **Flussrichtung** in Produktion
   (`js/routing/route-graph-routing.js`, gespiegelt in
   `api/_internal/routing/client-graph.php`). Ein „gerichteter Graph" muss also
   nicht gebaut werden, er läuft bereits.

Ebenfalls schon da und deshalb zu beachten: `Gebirgspass` und `Wuestenpfad` sind
**eigene Wegtypen** mit eigenen Geschwindigkeiten (`SPEED_TABLE` in `js/config.js`).
Ein Pass ist heute bereits rund 2,7× langsamer als eine Straße. Terrain-Faktoren
dürfen das **nicht doppelt** berechnen (siehe §9).

## 3. Grundidee: ein Substrat, mehrere Schichten

**Eine Geometrieart für alles: das Polygon.** Konkav, mit Löchern, beliebig zerfranst.

- Ein Polygon **ohne** Höhenpunkte ist eine flache Zone — Sumpf, Wald, Wüste.
- Dasselbe Polygon **mit** Höhenpunkten wird zum Gebirge.

Die Editoren lernen damit *ein* Werkzeug, nicht zwei. Höhenpunkte sind der einzige
Zusatz: ein paar Klicks im Polygon, jeder mit einer Höhe. Der Polygonrand ist die
Fußhöhe (Standardwert 0, pro Fläche einstellbar), dazwischen interpoliert ein
Dreiecksnetz.

## 4. Das Faktor-Modell

Jede Schicht liefert einen Multiplikator auf die Kantenzeit:

```
Kantenzeit(Richtung) = Distanz / Tempo
                     × isotrop
                     × richtung(Richtung)
                     × saison
```

- **isotrop** — das **Maximum** über alle überlappenden Flächen. Ein Sumpf (×2,0)
  im Gebirge (×1,8) ergibt ×2,0; die Faktoren werden *nicht* multipliziert, das
  stapelt unrealistisch. Die **Anzeige listet trotzdem beide Namen**.
- **richtung** — hängt von der Fahrtrichtung ab: Höhe (Auf-/Abstieg) und später
  Wind. Nutzt das vorhandene `forwardFactor`/`backwardFactor`-Paar.
- **saison** — Toggle plus Breitengrad plus Terrain (Schnee).

Weil das *verschiedene Arten* von Modifikatoren sind, multiplizieren sie sich
sauber. Symmetrie ist kein Sonderfall, sondern schlicht der Fall, in dem die beiden
Richtungswerte gleich sind — dann verhält sich alles exakt wie heute.

## 5. Was das Modell NICHT tut

Ausdrückliche Nicht-Ziele, damit später niemand das Falsche hinterherbaut:

- **Es findet keine Wege.** Avesmaps routet auf einem **fest gezeichneten Wegenetz**.
  Das Höhenfeld *bewertet* vorhandene Wege, es erzeugt keine neuen und sucht keine
  Pässe. Stehen zwei Wege über ein Massiv zur Wahl, gewinnt der günstigere — aber
  nur, weil beide gezeichnet sind.
- **Keine Sattel-/Tiefpunkt-Erkennung**, keine Geländeanalyse, kein Ableiten von
  Geographie aus dem Höhenfeld. Das Höhenfeld hat genau einen Abnehmer: den
  Abtaster entlang gezeichneter Wege.
- **Kein Querfeldein-Gelände.** Terrain wirkt auf Wege, nicht auf freie Bewegung.

Der Nutzen ist entsprechend **Konsistenz, nicht Entdeckung**: heute ist eine
Bergstraße nur langsam, wenn jemand sie als `Gebirgspass` getaggt hat; künftig
folgt der Aufwand der gezeichneten Geographie.

## 6. Die vier Schichten

| | Schicht | Wirkung | Geometrie |
|---|---|---|---|
| 1 | **Landschaften** — Sumpf, Wald, Wüste, … | isotrop | Polygon |
| 2 | **Jahreszeiten** — Schnee ab Breitengrad | isotrop, Toggle | keine (global) |
| 3 | **Höhe** — Gebirge, Auf- und Abstieg | richtungsabhängig | Polygon + Höhenpunkte |
| 4 | **Wind** — Seewege | richtungsabhängig | Polygon + Richtung + Stärke |

**Schicht 3 im Detail.** Aus dem Polygon und seinen Höhenpunkten entsteht per
**Constrained-Delaunay-Triangulation** ein Dreiecksnetz: die Polygonkanten sind
Zwangskanten (nichts läuft aus der Fläche heraus, egal wie konkav sie ist), die
Höhenpunkte gehen als innere Stützpunkte ein. Entlang eines Wegs wird das Netz
abgetastet → Höhenprofil → Auf- und Abstieg. Beide Werte werden **in Zeichenrichtung
des Wegs** gespeichert; fährt man rückwärts, tauschen sie.

**Schicht 4 im Detail.** Kein glattes Vektorfeld zeichnen, sondern Zonen mit
konstanter Windrichtung und -stärke. Die Kosten hängen vom Winkel zwischen
Segmentrichtung und Wind ab (Rückenwind schnell, Gegenwind zäh). Am spekulativsten,
deshalb zuletzt.

## 7. Baureihenfolge und Aufwand

| | Stück | grobe Größe |
|---|---|---|
| **F** | Ökosystem-Editor: Polygon-Substrat, volles Werkzeug | ~2–4 Wochen |
| **1** | Landschaften: Vorberechnung, Anzeige, Toggle | ~1–2 Wochen |
| **2** | Jahreszeiten | ~Tage |
| **3** | Höhe: Dreiecksnetz, Abtastung, Richtungsfaktoren | ~1–2 Wochen |
| **4** | Wind | offen |

Zahlen sind eine erste Einschätzung, keine Zusage. **F + 1** ist die erste
sinnvolle Ausbaustufe und in `oekosystem-instruction.md` ausspezifiziert.

Der ehrlichste Aufwandsposten ist keine Programmierung, sondern die **Handarbeit
der Editoren**: Aventuriens Landschaften müssen von Hand nachgezeichnet werden,
es gibt heute null Flächen.

## 8. Die Faktoren gehören den Editoren

Die Zahlen dürfen **nicht** in `js/config.js` liegen, sonst sitzt die Spielbalance
in einer Datei, an die nur Entwickler herankommen. Stattdessen:

- **Typ-Defaults als Datensatz** in einer Tabelle, im Editor pflegbar.
- **Pro Fläche überschreibbar**, wenn ein bestimmter Sumpf besonders zäh ist.
- **Der Kurvenverlauf** (wie Steigung auf Tempo wirkt) bleibt ein austauschbares
  Stück, keine fest verdrahtete Formel.

Das Rechenmodell ist damit ausdrücklich **noch nicht festgelegt** und soll flexibel
bleiben.

## 9. Risiken und offene Punkte

- **Doppelzählung.** `Gebirgspass` (×2,7) und `Wuestenpfad` kodieren Terrain bereits
  im Wegtyp. Der Landschaftsfaktor darf dort nicht zusätzlich greifen, sonst
  entstehen absurde Reisezeiten. Für Sumpf und Wald gibt es kein Gegenstück — dort
  ist der Faktor der volle neue Wert.
- **Datenmenge.** Der Nutzen wächst mit der Zahl gezeichneter Flächen. Bis
  Aventurien flächendeckend erfasst ist, wirkt das Feature lückenhaft.
- **Netzdichte.** Terrain ändert die *Routenwahl* nur dort, wo es überhaupt
  Alternativwege gibt. Sonst ändert sich nur die gemeldete Zeit.
- **Kein Doppelpflege-Pfad.** Die Vorberechnung darf niemals pro Routenanfrage
  laufen (STRATO), und die beiden Routing-Engines dürfen die Geometrie nicht
  getrennt nachbauen — beide lesen dieselben vorberechneten Werte.
- **Offen:** konkrete Faktorwerte, Kurvenform Steigung→Tempo, Abtastschrittweite,
  Jahreszeiten-Details, Wind-Modell.

## 10. Verwandte Dokumente

- `docs/oekosystem-instruction.md` — Bauanleitung für Ausbaustufe F + 1.
- `docs/political-territory-editor.md` — der Editor, der als Vorlage dient.
- `docs/superpowers/plans/2026-07-05-flussrichtung.md` — das Muster für
  richtungsabhängige Kantenkosten.
- `docs/routing-featurestand.md` — Stand der Routing-Engine.
