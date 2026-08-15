# Entwurf: der Abgangspunkt — jeder gezeichnete Punkt einer Straße ist ein Ausstieg

**Stand:** 15.08.2026 · **Zustand:** Entwurf, Owner-Freigabe eingeholt, nichts gebaut
**Vorgeschichte:** [Ausstiegspunkt](2026-08-14-querfeldein-ausstiegspunkt-design.md) (live 14.08.2026) ·
[Übergabe „der Ausstiegspunkt liegt systematisch falsch"](../plans/2026-08-15-querfeldein-ausstieg-optimum-uebergabe.md)

---

## 1 · Der Befund, und warum die Übergabe ihn zu klein beschrieben hat

Die Übergabe nannte es eine Fehlplatzierung: der Ausstieg liege systematisch zu spät.
Der Owner hat am 15.08.2026 widersprochen, und er hat recht. **Es gibt gar keinen Ausstieg.**

Gemessen an seiner Route (`https://avesmaps.de/?s=9PtTgmCH`, `Salmingen → Kartenpunkt
(504.530, 501.076)`, Reisegruppe zu Fuß, schnellste Route) antwortet der Server mit **genau
einer Kante**:

```
Salmingen -> __offroad_to   Querfeldein   14,019 Einheiten (= 42,06 Meilen)   6,5396
```

Kein Straßensegment. Die Reise läuft 42 Meilen durch den Dunkelwald — **neben dem Talloner
Hügelsteig her**, den sie nie betritt.

### Warum

`avesmapsCollectNearestClientLandPathAnchors` behält **einen** Kandidaten je Graphkante: die
Projektion des ZIELS auf diese Kante. Der Talloner Hügelsteig (`716d1d5e`, Strasse, Salmingen ↔
Tarnelfurt) ist im Graphen *eine* Kante, 10,90 Einheiten lang, ohne Kreuzung dazwischen. Er
bietet also genau einen Ausstieg an: bei 8,27 von 10,90, kurz vor Tarnelfurt.

Dieser eine verliert:

| Ausstieg | Straße | quer | Summe |
|---|---:|---:|---:|
| direkt ab Salmingen | 0 | 6,5396 | **6,5396** |
| `__wp_anchor_1` (508.563, 507.531) — der einzige Vorschlag | 2,694 | 4,2539 | 6,948 |
| Vertex (505.470, 511.933) — der Knick | 0,847 | 5,3274 | **6,175** |

⚠️ Der Querweg 5,3274 ist live abgefragt. Die 0,847 sind **abgeleitet**, nicht einzeln
geprobt: 2,601 Bogeneinheiten mal dem gemessenen Straßenpreis 0,32573 je Einheit (aus der
Probe `Salmingen → (505.950, 511.500)`: 1,0580 für 3,248 Einheiten). Der Abnahmefall (§6)
prüft die Zahl am fertigen Bau noch einmal direkt.

🔴 **Sobald der eine Vorschlag verliert, existiert die Straße für diese Reise nicht mehr.**
Es gibt keinen zweiten. Das ist der Unterschied zwischen „schlecht gewählt" und „nicht
vorhanden", und er ist der ganze Grund für diesen Entwurf.

Die übrigen zwölf Kandidaten sind **Ortschaften**, also gewöhnliche Graphknoten — dort
auszusteigen ist keine Querfeldein-Anbindung, sondern normales Routing. Ein Ausstieg *mitten
auf einer Straße* wird im ganzen System höchstens sechsmal je Reise angeboten.

### Die Probe, die es entscheidet

Die Geländelinie ab dem Knick und die von heute sind **ab (505.775, 507.163) dieselbe Linie**,
Koordinate für Koordinate (beide live abgefragt). Der ganze Unterschied ist das obere Stück:

* heute: 9,6 Meilen querfeldein, neben der Straße her
* richtig: 7,8 Meilen **auf** der Straße, dann 1,2 Meilen quer bis zur selben Stelle

Kürzer **und** schneller. Es gibt keine Lesart, in der das heutige Ergebnis richtig ist.

## 2 · Entscheidungen des Owners (15.08.2026)

| Frage | Entscheidung |
|---|---|
| Umfang | **Nur der angeklickte Kartenpunkt** (`avesmapsAttachOffroadPointToGraph`). Der Wegpunkt-Anker und die Umweg-Sehnen bleiben unberührt — sie leiden am selben Fehler, aber dort würde der Umbau Rechenzeit *hinzufügen* statt sparen. |
| Kandidaten | **Alle gezeichneten Vertices der 6 nächsten Wegstücke.** Die Wegauswahl bleibt wie heute; nur was ein Wegstück liefert, ändert sich. Keine erfundenen Zwischenpunkte. |
| Wortlaut | **„Abgangspunkt"** wo die Reise die Straße verlässt, **„Anschlusspunkt"** wo sie auf sie trifft. Richtungsabhängig. |
| kurz / schnell | Nicht angefasst. Entschieden wird über die Kosten, wie überall sonst. |

## 3 · Die drei Bauteile

### 3.1 Der Sammler — `client-graph.php`

Neu: `avesmapsCollectClientLandPathExitCandidates(array $graph, float $px, float $py, int $limit): array`

Er ruft `avesmapsCollectNearestClientLandPathAnchors` unverändert auf (die 6 nächsten
Wegstücke, eines je Kante, entdoppelt über die Kanten-`id`) und liefert je Wegstück:

* **jeden inneren gezeichneten Vertex** der Kantengeometrie, und
* **den bisherigen Fußpunkt** der Projektion.

⚠️ **Der Fußpunkt bleibt im Angebot.** Ohne ihn könnte eine Route schlechter werden als heute —
Abnahmekriterium 4 der Übergabe. Das Angebot wächst, es wird nie kleiner.

⚠️ Endpunkte der Kante werden **nicht** aufgenommen: das sind bereits Graphknoten (Ortschaften
oder Kreuzungen) und stehen über den zweiten Topf ohnehin zur Wahl. Sie hier noch einmal zu
führen erzeugte einen zweiten Namen für denselben Ort.

💣 **Die Entdopplung je Kante bleibt der Angelpunkt.** Sie ist der Grund, warum überhaupt
sechs *verschiedene Straßen* im Angebot stehen und nicht sechs Punkte auf derselben. Wer sie
löst, weil ja jetzt ohnehin viele Punkte je Straße kommen, bekommt sechs Nachbarn auf einem Weg
und die schnelle Straße zwei Täler weiter nie zu sehen (`anchor-candidates-test.php`).

### 3.2 Der Teiler — `client-graph.php`

Neu: `avesmapsSplitClientPathAtPoints(array &$graph, array $edge, array $points, callable $allocateIndex): array`

Schneidet **eine** Kante in **einem** Durchgang an k aufsteigend sortierten Punkten und liefert
die Knotennamen in Reihenfolge.

💣 **Nicht k-mal den Einzelteiler aufrufen.** `avesmapsSplitClientPathAtAnchor` entfernt die
Ursprungskante, sobald beide Hälften stehen. Der zweite Aufruf suchte danach eine Kante, die
es nicht mehr gibt, und hinge seinen Punkt an ein Bruchstück oder ins Leere. Genau diese
Doppelteilung hat am 14.08.2026 zwei unverbundene Fußpunkte an derselben Straße erzeugt.

🔴 **Der Einzelteiler bleibt unverändert.** Er trägt den Wegpunkt-Anker (Erzeuger 2) und wird
von `water-bridge-test.php` und `synthetic-distance-report-test.php` geprüft. Der neue Teiler
steht daneben, er ersetzt ihn nicht.

Regeln, die der Einzelteiler schon hat und die der neue übernimmt: ein Punkt, der auf einen
Endknoten fällt, erzeugt keinen Schnitt, sondern gibt diesen Endknoten zurück; das
Höhenprofil wird an denselben Stellen mitgeschnitten (`avesmapsRouteSplitTerrainProfile`); die
Ursprungskante fällt erst, wenn **alle** Teilstücke stehen.

### 3.3 Der Suchlauf — `offroad-grid.php`

Neu: `avesmapsOffroadFindPathsFromPoint(array $box, string $blocked, ?string $factors, ?string $heights, float $speed, float $x, float $y, array $goals, float $eps, array $rasters): array`

Ein Dijkstra-Lauf über dasselbe Gitter, von `(x, y)` nach außen, der alle Ziele bedient.
Rückgabe je Ziel dieselbe Struktur, die `avesmapsOffroadFindPath` heute liefert
(`points`, `distance`, `time`, `ascent_schritt`, `descent_schritt`, …), oder `null` für ein
unerreichtes Ziel.

🔴 **Er bepreist jeden Schritt in GEGENRICHTUNG.** Der Reisende geht vom Ausstieg zum
Kartenpunkt; der Lauf geht andersherum. Die Schrittkosten sind **nicht** symmetrisch —
`avesmapsTerrainLeistungsFactor` bestraft Steigung anders als Gefälle. Beim Entspannen von
Zelle `u` nach `v` ist deshalb der Anstieg `Höhe(u) − Höhe(v)` zu nehmen, nicht umgekehrt.
Ohne das steht in der Antwort die Zeit der **Rückreise** — derselbe Fehler, den V11 §6.3 schon
einmal gekostet hat und den `avesmapsAddOffroadEdge` beim Umdrehen der Kante ausdrücklich
behandelt.

⚠️ **Keine Heuristik.** Ein A\* ohne einzelnes Ziel hat keine zulässige Schätzung; die
Heuristik entfällt ersatzlos und der Lauf ist ein reiner Dijkstra.

💣 **Die Bremse ist der Abbruch bei erreichtem letzten Ziel**, nicht die volle Kiste. Der Lauf
zählt offene Ziele herunter und bricht ab, wenn keines mehr offen ist. Ohne diesen Abbruch
läuft er über die ganze Suchkiste (bis 150.000 Zellen), und dann ist der Umbau langsamer als
die 15 Läufe, die er ersetzt.

⚠️ `avesmapsOffroadFreeAround` wird für den Kartenpunkt **und für jedes Ziel** aufgerufen. Ein
Ausstieg, der geometrisch in einer Wasserfläche liegt (Ufer-Zeichenspiel), wäre sonst von der
ersten Zelle an eingemauert.

Die Strecke je Ziel kommt wie heute aus `cameFrom`, wird an den echten Endpunkten vernäht
(`$points[0]`, `$points[count-1]`) und durch `avesmapsOffroadFinishPath` gemessen — an genau
der Linie, die ausgeliefert wird.

### 3.4 Der Aufrufer — `offroad-leg.php`

Reihenfolge in `avesmapsAttachOffroadPointToGraph`, geändert gegenüber heute:

1. Landprüfung, Verkehrsmittel-Sperre, Tempo — **unverändert, und weiter vor allem anderen**.
2. Ortschaften sammeln (`avesmapsFindNearestOffroadExitNodes`, 12) — unverändert.
3. Ausstiegspunkte sammeln (neu, §3.1) — **noch ohne zu teilen**.
4. Reichweite bestimmen und filtern — unverändert (§4).
5. **Erst jetzt** die überlebenden Punkte je Wegstück in einem Durchgang schneiden (§3.2).
6. Suchkiste über Kartenpunkt und überlebende Kandidaten, ein Satz Datenbankabfragen — unverändert.
7. **Ein** Suchlauf (§3.3); je erreichtem Kandidaten eine Querfeldein-Kante wie heute.

⚠️ **Schritt 4 vor Schritt 5, und das ist neu.** Heute wird geteilt und danach gefiltert. Bei
einem Kandidaten je Weg war das gleichgültig; bei elf hieße es, eine Straße für Punkte zu
zerschneiden, die ohnehin herausfallen.

## 4 · Was ausdrücklich gleich bleibt

* **Die Reichweitenschranke und ihr Maßstab.** `AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR`
  (2,5), Bezug ist weiter der nächste **Ortsknoten**. 🔴 Sie hat am 14.08.2026 drei Fassungen an
  einem Tag gebraucht, und die Lehre daraus steht in AGENTS.md §11: *eine relative Schranke
  braucht einen Maßstab, der nicht mitwandert*. Die neuen Vertices sind Kandidaten wie alle
  anderen und werden von derselben Schranke gefiltert — sie setzen sie nie.
* **Ein Topf, keine Rangfolge.** Fußpunkte, Vertices und Ortschaften stehen nebeneinander;
  der Dijkstra entscheidet.
* **Der Rückfall der Schranke**, wenn es gar keine Ortschaft im Angebot gibt: heute setzt dann
  der nächste Fußpunkt den Maßstab. Er bleibt — nur heißt „nächster Kandidat" jetzt
  gegebenenfalls ein Vertex. ⚠️ Das ist die einzige Stelle, an der die neuen Punkte die
  Schranke berühren können, und sie greift nur, wenn im Umkreis keine einzige Ortschaft liegt.
* **Die zweite Stufe** (wenn kein naher Kandidat trägt, alle) bleibt.
* `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT` = 6 und `AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT` = 12
  bleiben. Sie zählen weiter **Wegstücke** bzw. **Ortschaften**, nicht Punkte.
* Fehlercodes, Landprüfung, Verkehrsmittel-Sperre, `synthetic-refine.php`.

### Eine neue Schranke, und nur eine

`AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT = 24` — Höchstzahl der Vertices, die **ein** Wegstück
beisteuert.

Am Livebestand gemessen, nicht geraten (3.538 Landwege, innere Vertices je Weg-Feature):
p50 = 3, p75 = 6, p90 = 10, p95 = 13, p99 = 23, max = 53. **32 Wege von 3.538 liegen über 24**,
keiner über 60. Ein Graph-Wegstück ist kürzer als sein Feature (an Kreuzungen geschnitten), die
echten Zahlen liegen also darunter. Bei 24 bleiben 99 % der Wege unangetastet, und der
schlimmste Fall sind 6 × 24 = 144 Kandidatenpunkte je Anfrage — gegen 4.889 Knoten im
Wegegraphen ist das nichts, und der Suchlauf kostet ohnehin unabhängig von ihrer Zahl.

⚠️ Wird der Deckel wirksam, werden die **zielnächsten** behalten, und das gehört ins
`debug`-Feld der Antwort, nicht still gekappt (AGENTS.md: „No silent caps").

## 5 · Der Renderer

Die Etappenzeile trägt den Wegnamen bereits (`route-plan.js`, `entry.segmentLabel` →
„Straße über Talloner Hügelsteig"). Zu ändern ist nur der **Name des Ausstiegsknotens**.

Heute schreibt `js/map-features/map-features.js:236` global
`__wp_anchor_\d+` → „Kreuzung", und `formatRoutePlanNodeName` (`route-plan.js:543`) zeigt
„Kreuzung" als **„Markierung"** an. ⚠️ Was der Reisende in der Etappenliste sieht, ist also
„Markierung", nicht „Kreuzung" — zwei Umbenennungen hintereinander, und die zweite ist die
sichtbare. 🔴 Beides ist an einem Ausstieg auf freier Strecke falsch, und beides ist
**richtungsblind**. Die Benennung gehört an den Etappenbauer, der weiß, was vor und was nach
dem Knoten liegt:

* Vorgänger ist ein Landweg, Nachfolger Querfeldein → **„Abgangspunkt"**
* Vorgänger ist Querfeldein, Nachfolger ein Landweg → **„Anschlusspunkt"**
* sonst (beidseitig Landweg, etwa ein geteiltes Wegstück ohne Querfeldein) → der bisherige
  Wortlaut bleibt

⚠️ Die globale Ersetzung in `map-features.js` bleibt als Rückfall stehen: sie bedient auch
Beschriftungen außerhalb der Etappenliste, und ein `__wp_anchor_7` darf nirgends roh auftauchen.

## 6 · Abnahme

1. **Die Route des Owners.** `Salmingen → Kartenpunkt (504.530, 501.076)`, Reisegruppe zu Fuß,
   schnellste Route: **zwei** Etappen, rund 7,8 Meilen Talloner Hügelsteig, dann rund 33,7 Meilen
   Unwegsames Gelände, Gesamtkosten ≈ 6,18 statt 6,54. Nachgewiesen an `POST /api/route/`
   **und** an `https://avesmaps.de/?s=9PtTgmCH` im Browser, mit Blick auf die gezeichnete Linie
   und die Etappenliste — nicht an einer Zahlentabelle.
2. **Kein bestehender Test wird rot**, insbesondere `offroad-leg-test.php`,
   `anchor-candidates-test.php`, `carriage-offroad-test.php`, `water-bridge-test.php`,
   `offroad-astar-test.php`, `synthetic-distance-report-test.php`.
3. **Der neue Test ist gegen den alten Stand rot belegt**, nicht behauptet
   (`git show HEAD:<datei> > <datei>`, laufen lassen, zurückkopieren).
4. **Die Zahl der Suchläufe je Kartenpunkt sinkt** von bis zu 18 (gemessen 15 an der
   Owner-Route) auf **einen**.
5. **Die Laufzeit ist gemessen** und dem Owner genannt, gegen den heutigen Stand, an derselben
   Route. Steigt sie, wird das gemeldet, bevor etwas hochgeht.
6. **Keine Route wird schlechter als heute.** Alle heutigen Kandidaten bleiben im Angebot.
7. Vor dem Push das **ganze** Testfeld, PHP und JS. ⚠️ `linkcheck/link-url-test.php` ist auf dem
   Entwicklungsrechner vorbestehend rot (echter DNS-Abruf) — kein Regressionssignal.

## 7 · Fallen, die dieser Entwurf sich selbst stellt

Diese Liste ist die Abnahmeliste (AGENTS.md §9: *der eigene Entwurf ist die Abnahmeliste*).
Jede Zeile wird vor „fertig" einzeln abgehakt — erfüllt, oder ausdrücklich verworfen mit
Begründung.

1. 💣 Rückwärtsbepreisung im Suchlauf (§3.3) — sonst steht die Zeit der Rückreise in der Antwort.
2. 💣 Abbruch bei erreichtem letztem Ziel (§3.3) — sonst ist der Umbau langsamer als heute.
3. 💣 Teilen in **einem** Durchgang (§3.2) — sonst unverbundene Punkte an derselben Straße.
4. 💣 Entdopplung je Kante bleibt (§3.1) — sonst sechs Nachbarn auf einer Straße.
5. ⚠️ Filtern vor Teilen (§3.4) — sonst Schnitte für Kandidaten, die herausfallen.
6. ⚠️ Fußpunkt bleibt im Angebot (§3.1) — sonst kann eine Route schlechter werden.
7. ⚠️ `avesmapsOffroadFreeAround` je Ziel (§3.3).
8. 🔴 Reichweitenschranke und ihr Maßstab unangetastet (§4).
9. 🔴 Einzelteiler unangetastet (§3.2).
10. ⚠️ Vertex-Deckel protokolliert, nicht still (§4).
11. 🔴 Richtungsabhängige Beschriftung im Etappenbauer, Rückfall in `map-features.js` bleibt (§5).

## 8 · Was dieser Entwurf NICHT tut

* **Er fasst „kürzeste" gegen „schnellste" nicht an.** Owner, 15.08.2026: „komm nicht
  durcheinander zwischen kurz und schnell. das können wir später noch unterscheiden."
* **Er verschiebt keine Schranke, um ein Ergebnis zu erzwingen.** Das Angebot wächst,
  entschieden wird weiter vom Dijkstra über die Kosten.
* **Er rührt die drei anderen Querfeldein-Erzeuger nicht an** (§2). Sie leiden am selben
  Fehler; sie ziehen nach, wenn dieser hier steht und gemessen ist.
* **Er erfindet keine Punkte.** Nur gezeichnete Vertices, wie vom Owner verlangt. Die
  Zwischenpunkt-Variante wurde ausdrücklich verworfen.
