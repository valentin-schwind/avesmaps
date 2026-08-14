# Querfeldein als Teilstrecke, nicht als Ersatz für die ganze Reise

**Stand:** 14.08.2026 · **Zustand:** Entwurf, nichts gebaut

Eine Reise von Salmingen nach Luring läuft heute vom ersten bis zum letzten
Meter querfeldein, obwohl die Reichsstraße 6 das letzte Drittel trägt. Dieser
Entwurf beschreibt, warum der Router gar nicht anders kann — und was ihm fehlt,
damit „man geht eine Straße, bis man querfeldein gehen muss" herauskommt
(Owner, 14.08.2026).

🔴 **Der Router rechnet nicht falsch.** Von den zwei Möglichkeiten, die er hat,
wählt er die richtige. Es fehlt die dritte, und die wäre die beste.

---

## 1 · Der Befund

`avesmapsMaybeOfferOffroadDetour` (`api/_internal/routing/detour.php:183`) hängt
**genau eine** Kante in den Graphen: `$fromNode → $toNode`. Vom Start direkt zum
Ziel. Eine Querfeldein-Kante zu einem *Zwischen*knoten entsteht nirgends.

Damit hat der Dijkstra zwei Angebote und kein drittes:

| | Strecke | Zeit |
|---|---|---|
| alles über Wege | 107,3 Meilen | 10,963 |
| alles querfeldein | 27,5 Meilen | 9,558 ← gewinnt |

> 💣 **Der Kommentar im Code behauptet das Gegenteil und ist seit dem ersten Tag
> falsch:** „🔴 ANGEBOT, NICHT VORSCHRIFT … Er darf dabei auch etwas Drittes
> wählen (ein Stück Straße, dann quer), und das wäre dann die richtige Antwort,
> nicht ein Fehler." Er *darf*, aber er *kann* nicht — es gibt keine Kante, die
> das ausdrücken würde. Ein Satz, der eine Freiheit beschreibt, die der Graph
> nicht hergibt, hat die Fehlersuche zweimal in die Irre geführt.

### Warum ausgerechnet hier

Salmingen hängt an **zwei** Straßen, ist also keineswegs unverbunden — beide
führen nach Süden weg:

| von Salmingen | wohin | Länge |
|---|---|---|
| Talloner Hügelsteig | Avestreu | 16,1 Meilen |
| Talloner Hügelsteig | Tarnelfurt | 32,7 Meilen |

Spinnried und Luring hängen an der Reichsstraße 6 im Norden. Zwischen beiden
Netzen liegen **15,8 Meilen ohne einen einzigen Knoten und ohne einen einzigen
Landweg** — nachgemessen, kein Erfassungsfehler: an jeder Stelle, an der sich
zwei Wege wirklich schneiden, sitzt ein Knoten (0 Fundstellen im 40×40-Ausschnitt).

Der einzige Weg über Straßen ist deshalb dieser Bogen:

```
Salmingen → Avestreu → Kreuzung-11894 → Rottan → Ferdok → Rakulbruck → Spinnried → Luring
                                                                       107,3 Meilen
```

Luftlinie: 25,4 Meilen. Verhältnis **4,22** über der Schwelle 3,0 — der Auslöser
feuert zu Recht, und die Zeitprüfung gibt dem Querweg zu Recht recht.

## 2 · Was fehlt

Dieselbe Route, wenn man **jede Sehne** der gefundenen Route anbieten würde statt
nur die eine über das Ganze (lokal gerechnet, Graph gegen die Live-API auf drei
Strecken auf die Nachkommastelle verifiziert):

| Sehne | Umweg | über Wege | querfeldein | Ersparnis |
|---|---|---|---|---|
| **Salmingen → Spinnried** | 5,80× | 91,7 Mln | 17,1 Mln | **+3,51** |
| Avestreu → Spinnried | 4,98× | 75,6 Mln | 16,4 Mln | +2,01 |
| Salmingen → Luring *(heute die einzige)* | 4,22× | 107,3 Mln | 27,5 Mln | +1,41 |
| Kreuzung-11894 → Spinnried | 3,76× | 68,0 Mln | 19,6 Mln | +0,08 |
| Avestreu → Luring | 2,98× | — | — | *unter der Schwelle* |

Die beste Sehne ist **nicht** die, die heute als einzige angeboten wird. Das
Ergebnis:

```
Salmingen ~~> Spinnried    querfeldein   17,1 Meilen
Spinnried  →  Luring       Reichsstraße  15,6 Meilen
                           ------------------------
                           32,7 Meilen, Zeit 7,448
```

gegen heute 27,5 Meilen und Zeit 9,558.

> ⭐ **Die Route, die der Owner sehen will, ist zugleich die schnellste.** Sie ist
> 2,1 Zeiteinheiten billiger als das, was heute herauskommt, und der
> Querfeldein-Anteil fällt von 100 % auf 52 %. Es braucht also **keine
> Sonderregel und keinen Zuschlag**, die Querfeldein künstlich verteuern — es
> reicht, dem Dijkstra die Kante zu geben, die ihm fehlt. Eine Strafe obendrauf
> wäre eine zweite Stellschraube für ein Problem, das die erste schon löst.

## 3 · Der Umbau

In `avesmapsMaybeOfferOffroadDetour`, an der Stelle, an der heute eine Kante
entsteht:

```
route = dijkstra(from, to)
knoten = die Knotenfolge der gefundenen Route
für jedes Paar (i, j) mit j > i+1:
    verhaeltnis = netzstrecke(i..j) / luftlinie(i, j)
    wenn verhaeltnis > SCHWELLE:            <- gratis, beides liegt vor
        kandidat merken
kandidaten nach erwartetem Gewinn sortieren, die besten K rechnen:
    kante = astar(knoten_i, knoten_j)
    wenn kante.zeit < netzzeit(i..j): anbieten
route = dijkstra(from, to)                  <- derselbe zweite Lauf wie heute
```

Der heutige Fall ist darin das Paar `(0, n)` und bleibt erhalten — kein
Rückschritt, nur mehr Auswahl.

> ⭐ **Der Vorfilter bleibt gratis.** Luftlinie und Teilstrecke stehen nach dem
> ersten Dijkstra für jedes Paar schon fest; erst der A\* kostet. Das ist
> dieselbe Begründung, die der heutige Auslöser für sich in Anspruch nimmt — sie
> gilt für Sehnen genauso.

> 💣 **Der Deckel K ist Pflicht, nicht Feinschliff.** Eine Route mit n Knoten hat
> n²/2 Sehnen; bei 50 Kanten sind das 1.250 Paare. Der Vorfilter ist gratis, der
> A\* nicht (p50 14 ms je Lauf) — ohne Deckel wäre eine lange Route ein
> Lastproblem auf einem Shared Host, und genau dort hat das Projekt schon einmal
> die PHP-Worker gesättigt. Vorschlag: **K = 3**, nach erwartetem Gewinn
> sortiert.

> 💣 **Ein Durchlauf, nie iterativ.** Die neue Route hat wieder Sehnen, und die
> hätten wieder welche. Ein zweiter Durchlauf ist der Anfang einer Schleife ohne
> Abbruchbedingung, deren Kosten niemand mehr abschätzt.

> 💣 **Die Zeitprüfung bleibt, und sie bleibt an jeder einzelnen Sehne.** Verliert
> eine, wird ihre Kante wieder ausgehängt (`avesmapsRemoveClientRouteConnection`).
> Eine Kante, die nie gewinnen kann, ist nicht bloß totes Gewicht — bei
> „Kürzeste Route" gewinnt sie **fälschlich**, weil dort die Distanz entscheidet
> und Querfeldein immer die kürzere ist. Das steht heute schon so im Code und
> gilt für n Kanten genauso wie für eine.

> ⚠️ **Kartenpunkte bleiben, wie sie sind.** „Hierher reisen" hängt seinen Punkt
> weiterhin mit einer Querfeldein-Kante ans Netz (`avesmapsAttachOffroadPointToGraph`)
> — ein angeklickter Fleck Wiese *ist* nicht am Netz, dort ist Querfeldein keine
> Notlösung, sondern die Sache selbst. Dieser Entwurf betrifft nur den
> Umweg-Auslöser.

## 4 · Was nicht dazugehört

**Der Fluss.** Die Route quert einen Fluss, weil der A\* nur Wasser*flächen*
meidet (`water-areas.php`: Seen, offenes Meer). Ein Flusslauf ist eine **Linie**
und damit für ihn nicht vorhanden. Das ist ein echter Befund, aber eine eigene
Sache — er wird durch Sehnen weder besser noch schlechter, und ihn hier
mitzunehmen hieße, zwei Ursachen in einem Umbau zu vermischen.

**Der Einheitenfehler.** `client-graph.php:397` rechnet `distance_units / speed`,
wobei die Strecke in Karteneinheiten und das Tempo in Meilen pro Stunde steht
(Owner-Befund, 14.08.2026). Jede Graph-Zeit ist dadurch um den Faktor 3 zu klein
— gleichmäßig, weshalb die Kantenwahl unverzerrt bleibt. Wirksam wird er nur
dort, wo eine **absolute** Stundengröße *addiert* statt multipliziert wird: am
Umsteigezuschlag (`response.php:144`), der dadurch dreifach wiegt. Ebenfalls eine
eigene Sache — aber eine, die vor jeder Arbeit an den Kosten geklärt sein sollte.

## 5 · Abnahme

Nicht gemessen, sondern **gefahren** — jeder Punkt ist eine Route, die man
anfordert und deren Etappenliste man liest:

1. **Salmingen → Luring** zeigt zwei Etappen: eine querfeldein bis Spinnried,
   dann Reichsstraße 6. Nicht mehr eine einzige Querfeldein-Etappe.
2. **Spinnried → Luring** bleibt unverändert eine Reichsstraßen-Etappe
   (Verhältnis 1,00, der Auslöser darf hier gar nicht anspringen).
3. **Die Gegenrichtung Luring → Salmingen** liefert dieselbe Aufteilung. Heute
   unterscheiden sich Hin- und Rückweg schon im Netzteil (`travelled` 35,75
   gegen 36,63) — wenn die Sehnen das nicht glätten, ist das ein eigener Befund
   und gehört benannt, nicht überdeckt.
4. **Ein Ort ohne jede Weganbindung** ist weiterhin erreichbar (die
   Notbrücken-Mechanik bleibt unberührt).
5. **„Hierher reisen"** auf einen freien Fleck verhält sich unverändert.
6. **Eine lange Route** (20+ Etappen) antwortet nicht spürbar langsamer — der
   Deckel K greift.

⚠️ Was ein lokaler Nachbau **nicht** beantwortet: ob die Etappenliste die neue
Aufteilung lesbar darstellt und ob die gezeichnete Linie an der Nahtstelle
sauber von gestrichelt auf durchgezogen wechselt. Das ist am fertigen Bau zu
sehen, nicht vorher.

## 6 · Offene Entscheidungen

🔧 **DU:** Zwei Punkte, die ich nicht allein entscheiden sollte.

1. **Deckel K.** Vorschlag 3. Höher heißt bessere Routen und mehr Serverarbeit;
   die Messung oben zeigt, dass in diesem Fall schon die beste Sehne genügt.
2. **Die strengere Lesart deiner Regel.** „Solang ein Ort an Wegen gebunden ist,
   soll kein Querfeldein kommen" ließe sich auch hart lesen: Querfeldein nur,
   wenn *gar keine* Route existiert. Dann bekäme Salmingen → Luring die vollen
   107 Meilen über Ferdok — 11 Tage statt 3. Dieser Entwurf folgt deshalb dem
   zweiten Satz („bis man querfeldein gehen muss") und lässt die Zeit
   entscheiden. Wenn du die harte Lesart willst, ist das ein anderer Bau.

---

## Belege

Alle Zahlen dieses Entwurfs sind gemessen, nicht geschätzt:

- Drei Einzelproben gegen `POST /api/route/` (Salmingen→Spinnried,
  Spinnried→Luring, Luring→Salmingen) samt `debug.context.detour`.
- Ein lokaler Nachbau des Servergraphen aus `GET /api/locations/` (4.883 Knoten)
  und `map-features.php?bbox=488,498,528,538` (80 Wege), der die Live-Werte auf
  drei Strecken exakt reproduziert: 91,7 / 107,3 / 15,6 Meilen bei Zeiten
  9,46 / 10,96 / 1,50.
- Zwei unterwegs **widerlegte** Thesen, hier festgehalten, damit sie niemand
  erneut verfolgt: verschmolzene Knotennamen (0 Dubletten bei 4.883 Knoten) und
  fehlende Kreuzungen (0 echte Schnittpunkte ohne Knoten im Ausschnitt).
