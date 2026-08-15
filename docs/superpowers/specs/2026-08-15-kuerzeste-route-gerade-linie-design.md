# Entwurf: „Kürzeste Route" rechnet im Gelände gar nicht kürzest

**Stand:** 15.08.2026 · **Zustand:** Befund gemessen, Bauart mit dem Owner besprochen, **nichts gebaut**
**Anlass:** Owner-Frage, wörtlich: „wenn ich ‚kürzeste' mach, ist dann A\* nicht eine gerade linie?"

---

## 1 · Der Befund

Live gemessen, dieselbe Route in beiden Modi:

```
fastest    Querfeldein-Etappe: 12,217 Einheiten,  Luftlinie 8,609  →  41,9 % Umweg
shortest   Querfeldein-Etappe: 12,217 Einheiten,  Luftlinie 8,609  →  41,9 % Umweg
```

**Zeichengleich.** Der Querweg unter „Kürzeste" ist exakt derselbe wie unter „Schnellste".

### Warum

Die Route wird auf **zwei** Ebenen entschieden, und `optimize` gilt nur auf einer:

| Ebene | Verfahren | Gewicht | folgt `optimize`? |
|---|---|---|---|
| Wegegraph | Dijkstra über Orte und Wegstücke | `distance` bzw. `time` der Kante | **ja** (`client-graph.php:1809`) |
| Gelände | A\* über Gitterzellen | `Strecke / Tempo × Steigung × Boden` | **nein** |

Die Querfeldein-Kante bekommt damit die **Länge eines Weges, der auf Schnelligkeit gelegt wurde**.
„Kürzeste" heißt heute also: *kürzest auf den Straßen, schnellst im Gelände.* Das ist keine Antwort
auf eine Frage, die jemand gestellt hat.

🔴 **Und es ist nicht nur eine falsche Anzeige.** Mit der um 42 % aufgeblähten Länge tritt die
Kante gegen die Straßen an. Unter „Kürzeste" sieht sie schlechter aus, als sie ist — der Modus kann
also auch die **falsche Route wählen**, nicht nur die richtige falsch beziffern.

## 2 · Was „kürzest" im Gelände bedeutet

Gewicht = Strecke. Sonst nichts.

Wald, Sumpf und Gebirge **bremsen**, sie verlängern nicht — auf eine Meilenzahl haben sie keinen
Einfluss, also hat eine kürzeste Linie keinen Grund, ihnen auszuweichen. **Wasser sperrt**, und nur
deshalb darf die Linie überhaupt einen Knick haben.

Ergebnis: eine Gerade, die nur um Wasser herumgeht.

⚠️ **Die unbequeme Folge, die der Owner kennen muss:** damit betritt die kürzeste Route eine Straße
gar nicht erst. An der Referenzroute sind das **31,8 Meilen schnurgerade** gegen 44,5 Meilen über
den Talloner Hügelsteig — und 31,8 Meilen ist exakt die Zahl, die im Planer schon unter
„Drachenflug" steht. Der Abgangspunkt (live seit heute) ist in diesem Modus bedeutungslos.

Das ist trotzdem richtig so: „kürzeste" ist eine Frage nach Meilen, und die Antwort darauf ist die
Luftlinie. Ob es die richtige **Frage** ist, steht in §8.

## 3 · Die Bauart

### 3.1 Der Wegegraph bleibt unangetastet

`avesmapsFindClientCompatibleRoute` wählt bereits `distance` gegen `time`
(`client-graph.php:1809`). Dort ist nichts zu tun. Der ganze Umbau sitzt im Gelände.

### 3.2 🔴 Suchen und Messen werden getrennt

Das ist der Kern, und heute sind es dieselben Daten:

* **Gesucht** wird mit dem Gewicht des Modus — Zeit bei „Schnellste", reine Strecke bei „Kürzeste".
* **Gemessen** wird immer mit dem echten Gelände: `avesmapsOffroadFinishPath` bepreist die
  ausgelieferte Linie mit Faktorebene und Höhenrastern.

💣 **Ohne diese Trennung verliert die kürzeste Etappe ihre Auskunft.** Nimmt man Höhen und Boden aus
dem Suchlauf, verschwinden sie auch aus der Messung — die Etappe hätte dann eine Länge, aber keine
Reisezeit und kein „↑ 400 Schritt bergauf". Genau die will der Reisende aber sehen: dass seine 31,8
geraden Meilen durch den Dunkelwald und über einen Grat führen und deshalb **länger dauern** als
44,5 Meilen über die Straße. Das ist die Abwägung, um die es geht.

⚠️ **Die Kiste, die Faktorebene und die Höhenraster bleiben deshalb erhalten** — sie werden nur
nicht mehr zum Suchen gebraucht. Owner, 15.08.2026: „ich habe bresenham gedacht, weil du dann das
raster nicht verwerfen müsstest." Das Bedenken war richtig, nur an dieser Stelle statt an jener.

### 3.3 Der gerade Weg zuerst, der Suchlauf nur bei Wasser

1. **Zwei Punkte, fertig.** Die kürzeste Verbindung zwischen Ausstieg und Kartenpunkt ist die
   Strecke zwischen ihnen.
2. **Ist sie trocken?** `avesmapsRouteChordCrossesWater($x1, $y1, $x2, $y2, $water)` — die Frage
   existiert seit V13 und wird dort schon für die Notbrücken gestellt.
3. **Trocken → das ist die Antwort.** Kein Gitterlauf. Die Linie geht unverändert an
   `avesmapsOffroadFinishPath`, das sie mit dem echten Gelände bepreist.
4. **Nass → Rückfall auf einen Suchlauf um das Wasser herum.**

⭐ Der Rückfall braucht **keine neue Suchfunktion**: derselbe Mehrziel-Lauf mit `factors = null`,
`heights = null` und `speed = 1.0` hat Schrittkosten, die genau die Schrittlänge sind. Der Suchkern
bleibt Zeile für Zeile, wie er ist. Gemessen wird die gefundene Linie danach trotzdem mit den echten
Ebenen (§3.2).

💣 **Bresenham wird nicht gebraucht.** Es rastert eine Linie in Zellen; eine Gerade braucht keine
Zellen, sondern zwei Punkte. Gerastert würde nur, um die Linie gegen das **Raster** zu prüfen statt
gegen die Polygone — siehe die offene Entscheidung in §5.

### 3.4 Wo das eingebaut wird

| Erzeuger | Datei | heute | danach |
|---|---|---|---|
| angeklickter Kartenpunkt | `offroad-leg.php` (`avesmapsAttachOffroadPointToGraph`) | A\*, zeitoptimal | Modus entscheidet |
| zwei Kartenpunkte | `offroad-leg.php` (`avesmapsConnectOffroadPoints`) | A\*, zeitoptimal | Modus entscheidet |
| Umweg-Sehnen | `detour.php` (über `avesmapsConnectOffroadPoints`) | A\*, zeitoptimal | Modus entscheidet |
| Sehnen-Verfeinerung | `synthetic-refine.php` | biegt gerade Notkanten mit dem A\* | ⚠️ unter „Kürzeste" darf sie **nicht** biegen — die gerade Kante IST dort schon die Antwort |
| Wegpunkt-Anker, Komponentenbrücke | `client-graph.php` | gerade Linie mit ×25 | unverändert (schon gerade) |

🔴 **Der Modus muss bis in den Suchlauf durchgereicht werden.** Heute kennt weder
`avesmapsOffroadFindPathsFromPoint` noch `avesmapsOffroadFindPath` das `$request`. Ein globaler
Schalter oder ein statischer Zustand kommt nicht in Frage (dieselbe Begründung wie bei
`avesmapsAllocateClientAnchorIndex`: verborgener Zustand, den jeder Test zurücksetzen müsste). Der
Weg ist ein zusätzlicher Parameter, und die vier Aufrufer geben ihn weiter.

## 4 · Was gleich bleibt

* Der Wegegraph und sein Gewicht (§3.1).
* Der ×25-Aufschlag der Notbrücken. Er gilt auf `distance` **und** `time`, also in beiden Modi
  gleich — eine Reparaturbrücke soll auch unter „Kürzeste" verlieren.
* Der Umsteige-Aufschlag: `+X Stunden` bei Schnellste, `+X Meilen` bei Kürzeste.
* Die Verkehrsmittel-Sperre, die Landprüfung, die Reichweitenschranke, der Abgangspunkt.
  ⚠️ Der Abgangspunkt wird unter „Kürzeste" praktisch nie gewinnen — das ist kein Fehler, sondern
  die Bedeutung des Wortes.

## 5 · 🔧 Offen, und vom Owner zu entscheiden

**Polygon oder Raster für den Nass-Test.** Beide antworten auf dieselbe Frage, aber nicht immer
gleich: das Raster sperrt eine Zelle schon, wenn Wasser sie *berührt* (Zellbreite 0,5 Einheiten).
Eine Linie kann also polygon-trocken und raster-nass sein.

* **Polygon** (`avesmapsRouteChordCrossesWater`): die Quelle statt ihrer Näherung, genauer, seit V13
  erprobt, braucht die Kiste nicht.
* **Raster**: eine Wahrheit für beide Modi — was „Schnellste" für nass hält, hält „Kürzeste" auch
  dafür. Dafür gröber, und es erbt die Freilegung um die Endpunkte.

⭐ Empfehlung: **Polygon**, weil das Raster nur sein Abbild ist. ⚠️ Vor der Festlegung zu messen:
an wie vielen echten Ausstiegen die beiden Tests **auseinandergehen**. Liegt die Zahl bei null, ist
die Frage müßig; liegt sie hoch, gewinnt die Einheitlichkeit.

## 6 · Abnahme

1. **Die Referenzroute.** `Salmingen → Kartenpunkt (504.530, 501.076)`, Reisegruppe zu Fuß,
   **Kürzeste**: eine Etappe, **31,8 Meilen** — exakt die Zahl, die im Planer schon unter
   „Drachenflug" steht. Heute sind es 44,5.
2. **Dieselbe Route unter Schnellste bleibt unverändert:** zwei Etappen, 7,80 Meilen Talloner
   Hügelsteig, dann 36,65 Meilen Gelände, Kosten 6,2124.
3. **Die kürzeste Etappe trägt weiterhin Reisezeit und Anstieg** — nicht nur eine Länge (§3.2).
4. **Ein Ziel hinter Wasser** liefert unter „Kürzeste" eine Linie, die um das Wasser herumgeht,
   nicht hindurch.
5. **Kein bestehender Test wird rot**, insbesondere `offroad-leg-test.php`,
   `offroad-multi-goal-test.php`, `abgangspunkt-test.php`, `water-bridge-test.php`,
   `water-crossing-test.php`.
6. **Der neue Test ist gegen den alten Stand rot belegt**, nicht behauptet.
7. Vor dem Push das **ganze** Testfeld mit den Erweiterungen (AGENTS.md §9).

## 7 · Fallen, die dieser Entwurf sich selbst stellt

1. 🔴 Suchen und Messen trennen (§3.2) — sonst verliert die Etappe Zeit und Anstieg.
2. 💣 Kiste, Faktorebene und Höhenraster bleiben erhalten (§3.2).
3. 🔴 Der Modus wird als **Parameter** durchgereicht, nie als globaler Zustand (§3.4).
4. ⚠️ `synthetic-refine.php` darf unter „Kürzeste" nicht biegen (§3.4).
5. ⚠️ Der ×25-Aufschlag bleibt in beiden Modi (§4).
6. 🔧 Polygon gegen Raster ist zu **messen**, bevor es entschieden wird (§5).

## 8 · Was dieser Entwurf NICHT tut — und die Frage dahinter

Er baut **A** aus dem Brainstorming vom 15.08.2026: „Kürzeste" wird ehrlich. Er beantwortet nicht,
ob „Kürzeste" die richtige zweite Frage ist.

🔧 Der Owner hat die Vermutung stehen lassen, dass Reisende in Aventurien nicht die Luftlinie wollen,
sondern **möglichst auf Wegen bleiben**. Das wäre ein anderer Modus („Wenigstes Gelände", Gewicht =
Meilen abseits gezeichneter Wege) und ein eigener Entwurf. Die Reihenfolge ist bewusst: **erst die
Wahrheit herstellen, dann darüber reden, ob die Frage die richtige war.** Solange „Kürzeste" falsch
rechnet, kann niemand beurteilen, ob sie nützlich ist.

Ebenfalls nicht Teil davon: die zwei Antworten nebeneinander in der Reiseübersicht zu zeigen
(Mockup vom 15.08.2026). Das kommt **danach** — eine zweite Zahl groß auf den Bildschirm zu stellen,
solange sie falsch ist, wäre das Schlechteste von beidem.
