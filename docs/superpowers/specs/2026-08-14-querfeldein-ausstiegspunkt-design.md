# Wo eine Querfeldein-Etappe das Wegenetz verlässt

**Stand:** 14.08.2026 · **Zustand:** Entwurf, nichts gebaut

Seit der Owner-Regel vom selben Tag (`detour.php`,
`avesmapsRouteKeepChordsWithOffNetworkEnd`) läuft Querfeldein nur noch zu Orten
ohne Anschluss ans Wegenetz. Der Owner hat daraufhin die Anschlussfrage gestellt:

> „ist es möglich von der straße wegzugehen? also den straßenpunkt zu nehmen,
> der am schnellste/kürzesten zum querfeldein punkt entfernt ist"

Heute startet jede Querfeldein-Etappe an einer **Ortschaft**. Dieser Entwurf
beschreibt, wie sie stattdessen an dem **Punkt auf der Straße** startet, der die
günstigste Gesamtreise ergibt — und warum dafür fast kein neuer Code nötig ist.

🔴 **Der Sammler, der das kann, existiert bereits.** Er läuft bei jeder Anfrage.
Er wird nur an einer einzigen Stelle benutzt, und dort nimmt der Aufrufer nur
den ersten seiner Treffer.

---

## 1 · Der Befund

Zwei Stellen binden pro Anfrage einen netzfernen Endpunkt an, und sie tun es
völlig verschieden:

| Erzeuger | Kandidaten | Quelle |
|---|---|---|
| Kartenpunkt („Hierher reisen") | die **12 nächsten Ortschaften**, nie ein Punkt dazwischen | `avesmapsFindNearestOffroadExitNodes`, `offroad-leg.php:60` |
| Wegpunkt ohne Weganbindung | **ein** Fußpunkt, der geometrisch nächste | `avesmapsFindNearestClientLandPathAnchor`, `client-graph.php:838` |

Der zweite Fall zeigt, dass das Werkzeug da ist:
`avesmapsCollectNearestClientLandPathAnchors` (`client-graph.php:849`)
projiziert einen Punkt auf **jedes Segment jedes Landwegs** im Graphen und
liefert die K nächsten Fußpunkte samt Weg, Segmentindex und Teilungsstelle.
`avesmapsAnchorClientWaypointToLandPath` (`client-graph.php:909`) teilt den Weg
dort und hängt die Querfeldein-Kante an — inklusive anteiliger Aufteilung von
Strecke, Zeit und Höhenprofil.

Es fehlt also kein Rechenverfahren. Es fehlt, dass die beiden Erzeuger dasselbe
benutzen und dass mehr als ein Fußpunkt zur Wahl steht.

### Der Fall, um den es geht

```
Ferdok ──────── Spinnried ──────────────────────── Luring     Reichsstraße
                    │
                    ╲                              (a) Ausstieg auf freier
                     ╲                                 Strecke
     ▪ Ziel           ╲  (b) Fußpunkt
   ohne Anbindung      ╲
                        ╲
                         Avestreu                  (c) letzte Ortschaft
```

* **(c) ist der Ausstieg von heute** — der Router muss die Landstraße bis
  Avestreu ausfahren, weil nur dort ein Knoten steht, und läuft von dort wieder
  zurück.
* **(b) ist der nächste Punkt der Landstraße überhaupt.**
* **(a) gewinnt, wenn die Landstraße ein langsamer Karrenweg ist** oder in die
  falsche Richtung schleift: der Querweg ist länger, aber die schnelle
  Reichsstraße trägt viel weiter.

⭐ **(a) und (b) sind beide Fußpunkte** — auf verschiedenen Wegen. Beide fallen
aus demselben Sammler, sobald er pro Weg entdoppelt. Welcher gewinnt, muss
niemand vorher wissen: das entscheidet der Dijkstra.

## 2 · Der Maßstab

🔴 **Owner-Entscheid, 14.08.2026: der Dijkstra wählt.** Nicht die kürzeste
Luftlinie zum Netz und nicht die schnellste Querfeldein-Etappe, sondern die
günstigste **Gesamtreise** — Straßenzeit bis zum Ausstieg plus Querweg. Alle
Kandidaten werden als Kante ANGEBOTEN, wie überall sonst in diesem Router.

Die verworfenen Alternativen, damit sie niemand erneut vorschlägt:

* *Kürzeste Luftlinie* (was der Wegpunkt-Anker heute tut) ist blind gegenüber
  der Richtung — der nächste Punkt kann auf einem Weg liegen, der von der
  falschen Seite kommt, und dann fährt die Reise erst hin und wieder zurück.
* *Schnellste Querfeldein-Etappe* optimiert genau den benannten Teil, kann aber
  einen Ausstieg wählen, der über die ganze Reise teurer ist.

## 3 · Der Umbau

### Bauteil 1 — der Sammler bekommt eine Entdopplung

`avesmapsCollectNearestClientLandPathAnchors` liefert künftig **höchstens einen
Kandidaten je Weg**, dann die K besten.

> 💣 **Ohne Entdopplung ist die Auswahl eine Attrappe.** Die K nächsten
> Fußpunkte liegen alle auf demselben Weg, ein paar Karteneinheiten
> auseinander — K A\*-Läufe für praktisch denselben Ausstieg, und (a) aus dem
> Bild oben wäre nie dabei. Die Entdopplung ist das, was aus „K Punkte" „K
> Straßen zur Auswahl" macht.

> ⚠️ **Die Abbruchschranke muss überleben.** Die Schleife überspringt heute
> jeden Treffer, der schlechter ist als der K-beste (`distance >= worst`). Sie
> misst danach gegen den K-ten **verschiedenen** Weg. Das bleibt korrekt: ein
> Fußpunkt, der schlechter ist als der K-te verschiedene, kann die Endauswahl
> nicht mehr erreichen.

> ⚠️ **Beide Richtungen sind dasselbe Objekt.** Der Graph speichert jede
> Verbindung zweimal, mit demselben Array (`client-graph.php:411-413`). Die
> Entdopplung über die Kanten-`id` fängt das mit ab — ohne sie stünde jeder Weg
> ohnehin doppelt in der Liste.

### Bauteil 2 — der Teiler wird herausgelöst

Neu: `avesmapsSplitClientPathAtAnchor(&$graph, $anchor, $nodeName): string`,
herausgelöst aus `avesmapsAnchorClientWaypointToLandPath:909-950`. Liefert den
tatsächlich benutzten Knotennamen zurück — fällt die Projektion auf einen
Endknoten (Epsilon 1e-7), wird nicht geteilt und der Endknoten kommt zurück.

Zwei Aufrufer, eine Abschrift. Das ist der einzige Umbau am Bestand.

> 🔴 **Die Ursprungskante wird entfernt, sobald beide Hälften stehen.** Heute
> bleibt `A↔B` neben `A↔P` und `P↔B` liegen (`client-graph.php:940-949` fügt nur
> hinzu). Bei einem Anker je Anfrage ist das harmlos. Bei mehreren Endpunkten
> nicht: der Sammler des nächsten Endpunkts sähe den ungeteilten Weg erneut,
> teilte ihn ein zweites Mal, und die beiden Fußpunkte hingen nebeneinander am
> selben Weg, **ohne miteinander verbunden zu sein** — die Reise zwischen ihnen
> liefe über den gemeinsamen Endknoten zurück. Mit dem Entfernen entsteht eine
> saubere Kette, und ein dritter Anker teilt die richtige Hälfte.

> 💣 **Die Bedingung „beide Hälften" ist Pflicht.** Fällt eine Hälfte weg (Slice
> unter zwei Punkten — der Bestand prüft das bereits), bliebe nach dem Entfernen
> eine **Lücke in der Straße**. Lieber eine überflüssige Dopplung als ein Netz,
> das an einer Stelle reißt, die niemand sucht.

> ⚠️ **Der Knotenname bleibt `__wp_anchor_<n>`**, nur mit laufendem Zähler über
> alle Erzeuger. Zwei JS-Stellen lesen genau dieses Muster:
> `map-features.js:236` beschriftet es als „Kreuzung",
> `route-engine.js:324` schlägt es bewusst nicht im Ortsbestand nach. Ein
> sprechenderer Name kostet beide Stellen und bringt nichts.

### Bauteil 3 — die Kandidatenwahl je Erzeuger

| | Kandidaten | Kante entsteht durch | Wassertest |
|---|---|---|---|
| Kartenpunkt | K Fußpunkte **plus** die 12 Ortschaften, in EINEM Topf | A\* je Kandidat, eine gemeinsame Suchkiste | der A\* selbst |
| Wegpunkt ohne Anbindung | K Fußpunkte (heute: 1) | gerade Querfeldein-Kante mit ×25, wie heute | je Sehne, wie heute |

> 🔴 **KORREKTUR VOM 14.08.2026, BEIM BAU GEFUNDEN.** Hier stand „K Fußpunkte,
> **Rückfall** auf die 12 Ortschaften" — die Ortschaften also erst, wenn kein
> Fußpunkt trägt. Das wäre in einem Fall **schlechter als der Stand davor**:
> liegt der geklickte Punkt 4,6 Einheiten neben einer Hafenstadt, aber 40 von der
> nächsten Straße, dann trägt der Fußpunkt — und die viel nähere Stadt käme nie
> zur Wahl. Der Reisende liefe 40 Einheiten querfeldein statt 4,6.
> Aufgefallen an `offroad-leg-test.php`, Abschnitt „a harbour town drawn just
> inside a generously drawn coastline".
>
> ⭐ **Richtig ist EIN Topf, keine Rangfolge.** Beide Familien werden zusammen
> nach Entfernung sortiert, über den Namen entdoppelt (ein Fußpunkt auf einem
> Endknoten trägt dessen Namen) und gemeinsam durch die zweistufige Rettung des
> Bestands geschickt (nahe Menge über den Reichweitenfaktor 2,5, dann alle).
> Damit gilt die Zusage wieder, und zwar ohne Sonderfall: die Antwort kann nie
> schlechter werden als vorher, weil jeder Kandidat von vorher weiterhin im
> Angebot steht.

**K = 6.** Nicht 12: mit der Entdopplung sind das sechs *verschiedene* Straßen,
also mehr echte Auswahl als die zwölf Ortschaften je hatten. Der bestehende
Reichweitenfilter schneidet davon meist noch etwas ab.

### Datenfluss

```
Graph bauen (Komponentenbrücken wie bisher)
  → je netzfernem Endpunkt: K Fußpunkte sammeln → teilen → Kanten anbieten
  → Dijkstra
  → Umweg-Sehne (unverändert) → Refine (unverändert)
```

Die Reihenfolge bleibt, wie sie ist.

## 4 · Kosten

| | heute | danach |
|---|---|---|
| Sammler-Durchläufe je Anfrage | bis 3 (Wegpunkte) | bis 5 (+2 Kartenpunkte) |
| A\*-Läufe je Kartenpunkt | bis 12 | bis **18** (12 Ortschaften + 6 Fußpunkte), meist deutlich weniger |
| zusätzliche Knoten je Anfrage | bis 3 | bis ~30, gegen ~5.900 Wege |

🔴 **KORREKTUR VOM 14.08.2026, LIVE GEMESSEN.** Hier stand „bis **6**, Rückfall
nur im Notfall" und „⭐ Der Kartenpunkt wird billiger, nicht teurer". Beides fiel
mit der Rückfall-Korrektur oben: liegen beide Familien in einem Topf, laufen im
schlechtesten Fall beide. Der Versuch, das über die gemeinsame
Reichweitenschranke einzufangen, hat live genau die Verschlechterung erzeugt,
die der Entwurf ausschließt — ein Kartenpunkt 0,497 neben der Straße bot **nur
noch einen** Ausstieg an (vorher vier) und die Reise wurde 2,8 % teurer. Grund:
die Schranke ist relativ (nächster × 2,5), und ein Fußpunkt liegt fast immer
näher als jede Ortschaft; gemeinsam gerechnet überlebt sie keine Ortschaft mehr.

🔴 **UND EINE DRITTE FASSUNG, AM SELBEN TAG VOM OWNER GEMELDET.** Hier stand „die
Schranke misst JE FAMILIE". Auch das war falsch, nur andersherum: sie hängt dann
am nächsten Kandidaten *dieser* Familie, und ein zufällig sehr naher Fußpunkt
verengt sie für alle übrigen Fußpunkte. Gemessen an einer Probe südlich von
Salmingen: ein Fußpunkt bei 2,911 drückte die Reichweite auf 7,28 und schnitt
damit den Fußpunkt bei **7,61** weg — während eine Ortschaft bei **8,30** im
Angebot blieb, weil ihre Familie ihren eigenen, weiteren Maßstab hatte. Über den
weggeschnittenen Fußpunkt war die Reise rund 15 % schneller.

> 🪤 **DIE PROBE WAR NICHT DIE GEMELDETE STELLE, und das ist die zweite Lehre
> dieses Abschnitts.** Der Kartenpunkt war aus der Wegpunkt-Beschriftung
> abgetippt, und die zeigt `lat, lng`, während `to_point` `{x: lng, y: lat}`
> erwartet (`applyMapPointRouteEndpoints`, `js/routing/route-travel-here.js`).
> Gemessen wurde damit eine ganz andere Stelle der Karte als die, nach der der
> Owner gefragt hatte — mehrere Erklärungsversuche in Folge gingen ins Leere
> („Browser-Cache", „liegt am Transportmittel", „liegt an Kürzeste Route"), bis
> die Etappenliste der Oberfläche die Zahlen dagegenhielt. Der Befund oben ist
> davon unberührt: er ist an einer echten Stelle gemessen und sein Test ist
> synthetisch. ⚠️ **Wer einen Kartenpunkt aus der Oberfläche in eine API-Probe
> übernimmt, muss ihn drehen.**

⭐ **Richtig ist: EIN Maßstab, und das ist der nächste ORTSKNOTEN.** Die Aufgabe
der Schranke ist die Größe der Suchkiste, und die spannten seit jeher die
Ortschaften auf; ein Fußpunkt liegt fast immer näher und darf den Maßstab
deshalb nicht setzen. Damit ist die Kiste exakt so groß wie vor dem 14.08.2026 —
die Fußpunkte liegen darin und kosten nichts extra, und ein Fußpunkt, der weiter
liegt als diese Reichweite, würde die Kiste aufziehen und fällt zu Recht heraus.
Der Kartenpunkt kostet damit so viel wie vorher plus die Fußpunkte; die
Antwortzeit wird ohnehin vom Laden der Feature-Tabelle bestimmt (~1,5 s,
Instruction C §5.8), nicht von den Suchläufen.

> 💣 **Die Lehre aus drei Anläufen an einem Tag:** eine RELATIVE Schranke braucht
> einen Maßstab, der nicht mitwandert. Wer sie an „den nächsten Kandidaten"
> hängt, ändert ihre Weite jedes Mal, wenn eine neue Kandidatenart dazukommt —
> und merkt es erst an einer Route, die niemand nachgerechnet hat.

⚠️ **Rein serverseitig.** Einen Client-Zwilling des Ankers gibt es nicht; die
beiden JS-Stellen oben lesen nur das Namensmuster. Es entsteht also keine
Spiegelpflicht in `js/routing/`.

## 5 · Was nicht dazugehört

**Die Umweg-Sehne behält ihr Netz-Ende als Kettenknoten.** Nach der Entdopplung
deckt Bauteil 1 auch Fall (a) ab — der Ausstieg auf freier Strecke ist der
nächste Punkt der Reichsstraße und damit ein eigener Kandidat. Was der Sehne
bleibt, ist ein enger Rest: ein Ausstieg, der **nicht** der nächste Punkt seines
eigenen Weges zum Ziel ist, etwa 30 Meilen weiter westlich wegen flacheren
Geländes. Ihr Netz-Ende freizugeben hieße, jeden Stützpunkt der gefundenen
Routen-Geometrie zu prüfen — statt höchstens acht Kettenknoten schnell mehrere
hundert Kandidaten, gegen einen Deckel von 3.

**Die ~876 Komponentenbrücken beim Graphbau.** Der Entwurf vom 08.07.2026 hat
das mit „≈ 24 Mio Rechenschritte pro Graph-Build → auf STRATO riskant"
verworfen; es bräuchte einen räumlichen Index. Sie sind der Rückfall, der
Erreichbarkeit garantiert — jede Route, die ein Reisender wirklich plant, wird
von Bauteil 3 bedient.

## 6 · Fehlerfälle

Alle bestehenden Absagen behalten ihren Code und ihren Satz.

| Lage | Verhalten |
|---|---|
| Kein Landweg im Graphen (nur Fluss/See aktiv) | Sammler liefert nichts → Ortschaften-Rückfall → am Ende `no_exit_node` wie heute |
| Kein trockener Weg zu irgendeinem Fußpunkt | zwei Stufen wie heute, dann Ortschaften-Rückfall, dann `no_offroad_route` |
| Klick aufs Meer | Landprüfung schlägt vor allem anderen zu, `point_not_on_land` |
| Projektion trifft einen Endknoten | kein Split, Anbindung direkt an den Knoten |
| Nur eine Hälfte entsteht | Ursprungskante bleibt stehen, kein Entfernen |
| Kutsche als Landtransport | kein Kandidat, keine Kante |
| Seegebundener Wegpunkt | wird übersprungen, wie heute |

> 💣 **Die Kutschen-Sperre muss in BEIDEN Erzeugern stehen.** Der Bestand warnt
> an dieser Stelle wörtlich, dass nur einen zu sichern das Loch genau dort offen
> lässt, wo der Nutzer selbst Punkte setzt (`client-graph.php:638-642`,
> `733-739`). Der neue Kandidatenweg darf daran nicht vorbeiführen.

> ⚠️ **Der ×25 bleibt ein Dijkstra-Gewicht.** Die geraden Anker-Kanten tragen ihn
> weiterhin als `cost_factor` mit, damit jede gemeldete Zahl ihn herausrechnen
> kann. Dass es jetzt K Kanten statt einer sind, ändert daran nichts.

## 7 · Abnahme

**Neue Tests — `api/_internal/routing/__tests__/anchor-candidates-test.php`:**

1. **Entdopplung:** ein Weg mit fünf Stützpunkten dicht am Ziel und ein zweiter
   Weg weiter weg → höchstens ein Kandidat je Weg, und der zweite Weg ist dabei.
   *Ohne diesen Test ist die Entdopplung nicht belegt — und genau sie holt Fall
   (a) ins Angebot.*
2. **Kette:** denselben Weg zweimal teilen → die Ursprungskante ist weg, die
   beiden Fußpunkte hängen aneinander und nicht beide am gemeinsamen Endknoten.
3. **Endknoten-Treffer:** kein Split, der Endknotenname kommt zurück.
4. **Halbe Hälfte:** Slice unter zwei Punkten → Ursprungskante bleibt stehen.

**Erweiterung `offroad-leg-test.php`:** Kartenpunkt neben einer langen Straße
zwischen zwei fernen Ortschaften → Ausstieg am Fußpunkt. Und: kein trockener
Fußpunkt → Ortschaften-Rückfall greift, die Route existiert weiterhin.

**Live-Abnahme — Handgriffe, keine Maßtabelle:**

1. Rechtsklick zwischen Spinnried und Salmingen → Wanderschuh. Der Querweg
   startet auf der Straße; die Etappenliste zeigt dort „Kreuzung".
2. Dieselbe Stelle mit Kutsche → keine Querfeldein-Etappe, Absage wie heute.
3. Ein Ort aus der Editor-Markierung „unverbundene Orte" als Ziel → kurzer Anker
   statt Reise zur fernen Ortschaft.
4. Gareth → Punin → unverändert, 0 Querfeldein. Regressionsprobe.
5. Klick aufs Meer → weiterhin „Dorthin führt kein Landweg".

Je Fall **eine** `POST /api/route/`-Anfrage vorher und nachher, `cost` und
`edge_ids` protokolliert — auf STRATO keine Schleifen. Vor dem Push das ganze
Testfeld, JS und PHP.

⚠️ Was ein Test **nicht** beantwortet: ob die gezeichnete Linie an der neuen
Nahtstelle mitten auf der Straße sauber von durchgezogen auf gestrichelt
wechselt, und ob „Kreuzung" an einer Stelle, an der gar keine Kreuzung ist, für
den Reisenden verständlich bleibt. Das ist am fertigen Bau zu sehen.

## 8 · Offene Entscheidungen

🔧 **DU:** zwei Punkte, die nach dem Bau nachzumessen sind, nicht vorher.

1. **K = 6.** Höher heißt mehr Auswahl und mehr A\*-Läufe. Der Vorschlag liegt
   unter den heutigen 12, der Bau wird also nicht teurer — ob sechs Straßen
   reichen, zeigt erst die Abnahme.
2. **Die Beschriftung „Kreuzung"** für einen Fußpunkt auf freier Strecke. Sie
   kommt aus dem Bestand und kostet nichts; ob sie am Ausstiegspunkt richtig
   klingt, entscheidest du am fertigen Bau.

---

## Belege

Die Aussagen dieses Entwurfs über den Bestand sind an den genannten Stellen
gelesen, nicht erinnert:

- `offroad-leg.php:60-81` — die Ausstiegskandidaten sind ausschließlich
  Ortschaften; `EXIT_NODE_LIMIT = 12`, `EXIT_DISTANCE_FACTOR = 2,5`.
- `client-graph.php:838-894` — der Sammler projiziert auf jedes Segment jedes
  Landwegs, ohne Entdopplung, und der einzige Aufrufer nimmt den ersten
  trockenen Treffer.
- `client-graph.php:909-975` — der Teiler fügt beide Hälften hinzu und entfernt
  die Ursprungskante **nicht**.
- `client-graph.php:29` — `AVESMAPS_ROUTE_CLIENT_LAND_PATH_TYPES` enthält weder
  Querfeldein noch Fluss- oder Seewege; das ist der Begriff von „hängt am
  Wegenetz", den auch die Owner-Regel in `detour.php` benutzt.
- `js/` enthält keinen Zwilling des Ankers — nur die beiden Lesestellen
  `map-features.js:236` und `route-engine.js:324`.

Verwandt: [2026-07-08-querfeldein-wegpunkt-anbindung-design.md](2026-07-08-querfeldein-wegpunkt-anbindung-design.md)
(die Fußpunkt-Anbindung, aus der Bauteil 1 und 2 stammen) und
[2026-08-14-querfeldein-teilstrecken-design.md](2026-08-14-querfeldein-teilstrecken-design.md)
(die Umweg-Sehnen). Dessen offene Entscheidung §6.2 — die „strengere Lesart" —
hat der Owner am selben Tag zugunsten der strengen Lesart entschieden; der dort
beschriebene Fall Salmingen → Luring entsteht deshalb nicht mehr.
