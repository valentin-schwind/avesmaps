# Instruction C — der ×25-Aufschlag, der automatische Auslöser, und der Anker bekommt den A\*

**Auftrag Owner 2026-08-02.** Drei Stücke, **in dieser Reihenfolge**, ein Rechner.

> ⭐ **Der Rechner steht.** „Hierher reisen" ist live (Instruction B,
> `docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md`). Was hier folgt, baut **nichts
> Neues an Mathematik** — es holt die zwei anderen Aufrufer an denselben Rechner und repariert eine
> Zahl, auf die sich der mittlere sonst stützen würde.

---

## 0. 🔴 Was in den Papieren falsch steht — lies das zuerst

Instruction B bestand zur Hälfte daraus, Behauptungen der V14-Spec zu berichtigen. **Jetzt ist es
umgekehrt**, und wer das nicht weiß, baut ein zweites Mal, was schon dasteht:

| Papier | sagt | wahr ist |
|---|---|---|
| V14 §5.6 / Selbstprüfung | 🔴 NEUBAU: PHP-Zwilling von `findNearestLocationToLatLng`, Koordinatenziel in `POST /api/route/`, Douglas-Peucker in PHP, bbox-Höhenlader, Landflächen-Lader | **alle fünf gebaut und live** |
| Fahrplan `2026-07-24-landschaften.md` Zeile 2136 | „V14: nur clientseitig, on demand" | **serverseitig gebaut**; die Zeile stammt aus der Zeit vor V11 §10 |
| V14 §5.3 Selbstprüfung | „kleinster vorkommender Faktor **muss gemessen werden**" | **entfällt** — das Leistungskilometer-Modell hat keine untere Klemme, der kleinste Faktor ist konstruktionsbedingt exakt 1,0 |

⚠️ Die Fahrplan-Zeile 2136 gehört dem Landschaften-Fahrplan, an dem andere Sitzungen arbeiten.
**Nicht nebenbei umschreiben** — beim Owner anfragen, wenn sie berichtigt werden soll.

---

## 1. 💣 ZUERST: der ×25-Aufschlag steht im Streckenfeld der öffentlichen API

**Live gemessen 2026-08-02**, Gulbladdirstadir → Rekheim, neun Etappen:

```
0-4: Seeweg       gemeldet  22.39 …  6.16 | aus Geometrie identisch | Faktor  1.00
5-7: Pfad         gemeldet  14.04 …  0.84 | aus Geometrie identisch | Faktor  1.00
8:   Querfeldein  gemeldet 484.65        | aus Geometrie    19.39  | Faktor 25.00  <<<
```

`AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR` (`client-graph.php:15`) ist als **Kosten**-
Aufschlag gedacht und landet im Feld `distance`. Von dort wandert er in `distance_units` **und**
`cost_units` des stabilen Vertrags `POST /api/route/`: für 58 Meilen steht dort 1.454.

Zwei Erzeuger, beide betroffen:

| Stelle | was |
|---|---|
| `client-graph.php:634` | Komponentenbrücke (`avesmapsConnectClientCompatibleDetachedGraphComponents`) |
| `client-graph.php:896` | Wegpunkt-Anker (`avesmapsAnchorClientWaypointToLandPath`) |

⚠️ **Der Reiseplan zeigt es nicht** — er summiert die Geometrie (`buildRoutePlanEntries`), also
stimmen die Zahlen im Fenster. Betroffen ist, wer die API liest. Und der Auslöser aus §2.

### 1.1 💣 Der Aufschlag ist zugleich das Dijkstra-Gewicht — er darf nicht einfach weg

`client-graph.php:1337`:

```php
$weight = $useShortestPath ? (float) ($connection['distance'] ?? 0.0) : (float) ($connection['time'] ?? 0.0);
```

`time` ist `distance / speed`, erbt den Aufschlag also mit. Er wirkt damit in **beiden** Modi als
Abschreckung gegen Notbrücken — genau dafür ist er da. Wer `distance` ehrlich macht, ohne das
Gewicht zu ersetzen, lässt „Kürzeste" plötzlich Luftlinien bevorzugen. **Das wäre eine Änderung am
Routenverhalten, nicht an einer Zahl.**

### 1.2 ⭐ Der vorgeschlagene Zuschnitt: Gewicht lassen, Auskunft ehrlich machen

`avesmapsBuildClientRouteDiagnosticSegments` (`client-graph.php:1377`) **hat die Koordinaten schon**.
Die Strecke dort aus der Geometrie rechnen statt aus `$segment['distance']` — dann stimmt sie für
**alle** Etappen (an den acht anderen ist sie ohnehin identisch, Faktor 1,00 gemessen), und das
Gewicht im Graphen bleibt unangetastet.

Den Aufschlag dabei **sichtbar** machen, nicht verschweigen: ein eigenes Feld (`cost_factor` o. ä.),
damit `cost_units` erklärbar bleibt. Eine Zahl, die man nicht herleiten kann, ist die nächste, die
jemand für kaputt hält.

⚠️ Alternativen sind vertretbar (eigene Gewichtsfelder im Graphen), kosten aber mehr Fläche. Die
Entscheidung gehört in den Commit, nicht in einen Kommentar.

---

## 2. Der automatische Auslöser (V14 §5.5)

Der zweite Aufrufer desselben Rechners. **Kein Knopf, kein Rechtsklick** — er wirkt auf jede normal
geplante Route.

**In `avesmapsBuildMinimalRouteResultFromRequest` (`response.php`), NACH
`avesmapsFindClientCompatibleRoute`:**

1. Luftlinie zwischen `from` und `to`, echte Wegstrecke der gefundenen Route.
2. Verhältnis ≤ `AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD` (**3,0**) → fertig, nichts passiert.
   ⭐ Der Vorfilter ist **gratis**: beide Zahlen liegen vor. 90,9 % der Routen zahlen nichts.
3. Darüber: A\* zwischen den beiden Orten (§4 nennt die Funktionen).
4. Ist seine **Zeit** kleiner als die der Graph-Route, ersetzt **eine** Querfeldein-Etappe die ganze
   Route zwischen den Punkten. Sonst bleibt alles, wie es ist.

**Gemessen (V14 §4.2/§4.3, Livebestand 2026-07-30):**

| Schwelle | löst aus bei | Kiste p50 / max | Zeit p50 / max | Weg gefunden | Verkürzung p50 |
|---|---|---|---|---|---|
| **3×** | **9,1 %** der nahen Ortspaare | 1.125 / 4.130 Zellen | **14 / 112 ms** | 136 / 138 | **4,2×** |

⭐ **Die Kisten sind hier KLEIN, nicht groß** — anders als bei „Hierher reisen" (p50 10.600). Eine
Route sieht nur dann absurd aus, wenn die beiden Orte *nah* beieinander liegen, und nah heißt kleine
Kiste. Die Schwelle begrenzt die Kiste, ohne dass man sie begrenzen muss.

**Live nachgemessen 2026-08-02** — der Referenzfall `?s=kgDKf9Ha`, heute:

```
Gulbladdirstadir 383,40/832,15   Rekheim 387,00/839,09
Luftlinie   7,81 Einheiten =  23,4 Meilen
gefahren  140,69 Einheiten = 422,1 Meilen   -> Faktor 18,0x   (löst bei 3x aus)
```

⚠️ Die Spec nennt für denselben Fall 15,6× (121,7 Einheiten). Das Netz hat sich seither geändert —
**neu messen, nicht abschreiben.**

---

## 3. Der Anker bekommt den A\* — ein Rechner, drei Aufrufer

Zwei fast gleich lange Querfeldein-Etappen in **derselben** Route (live, 2026-08-02):

| | Länge | Punkte | Streckenfeld | weicht aus |
|---|---|---|---|---|
| Wegpunkt-Anker → Rekheim | 19,39 | **2** | ×25 | nichts |
| A\* → Kartenpunkt | 18,24 | **16** | ehrlich | Wasser, Gelände, Höhe |

Der Anker (`avesmapsAnchorClientWaypointToLandPath`) und die Komponentenbrücke
(`avesmapsConnectClientCompatibleDetachedGraphComponents`) ziehen **gerade Linien**. Sie kennen
seit V13 die Wassersperre (die Sehne wird geprüft, die Kante entsteht sonst nicht), aber sie
**biegen nicht** — kein Gelände, keine Höhe, keine Vereinfachung.

Der Rechner dafür steht. Die Aufgabe ist, ihn dort einzusetzen, wo heute eine Sehne liegt.

💣 **Und hier ist die Kostenfrage eine andere als in §2.** Anker und Brücke entstehen beim
**Graphbau**, also für *jede* Anfrage und für bis zu drei Wegpunkte plus alle abgehängten
Komponenten — nicht erst, wenn ein Verhältnis auffällt. **Erst messen, wie viele es je Anfrage
sind, dann entscheiden**, ob alle den A\* bekommen oder nur die langen. V13 hat für dieselbe Stelle
gemessen: 861 synthetische Kanten im Graphen, aber nur eine Handvoll je *Route*.

⚠️ **Reihenfolge**: nach §1 und §2. Wer hier anfängt, ändert die Geometrie von Kanten, auf die
sich der Auslöser gerade stützt.

---

## 4. Was schon dasteht — Namen und Signaturen, nicht Beschreibungen

Alles in `api/_internal/routing/`. **Vor dem Bauen die Signatur lesen**, nicht dieses Dokument
(Instruction B §3.1 ist genau daran gescheitert).

```php
// offroad-grid.php -- rein, keine DB
avesmapsBuildOffroadBox(float $x1, float $y1, float $x2, float $y2,
    float $cell = 0.5, int $cellLimit = 150000): array
avesmapsOffroadRasteriseBlocked(array $box, array $water): string
avesmapsOffroadSampleHeights(array $box, array $rasters): string
avesmapsOffroadFindPath(array $box, string $blocked, ?string $factors, ?string $heights,
    float $speed, float $x1, float $y1, float $x2, float $y2,
    float $eps = 0.10, array $rasters = []): ?array
    // -> ['points','distance','time','ascent_schritt','descent_schritt','cells_opened']
avesmapsSimplifyLineDouglasPeucker(array $points, float $eps): array

// offroad-data.php -- nimmt PDO, faellt inert aus
avesmapsOffroadLoadHeightRasters(PDO $pdo, array $box): array
avesmapsOffroadLoadFactorPlane(PDO $pdo, array $box): string

// offroad-leg.php -- haengt Kanten in den Graphen
avesmapsAddOffroadEdge(array &$graph, string $from, string $to, array $path,
    string $transport, string $connectionId): void
avesmapsAttachOffroadPointToGraph(array &$clientGraph, array $locations, array $request,
    array $water, array $land, ?PDO $pdo, float $x, float $y, string $nodeName,
    bool $terrainEnabled = true): array

// land-areas.php
avesmapsLoadRouteLand(array $config, ?PDO $pdo): array
avesmapsRoutePointIsOnLand(float $x, float $y, array $land, array $water): bool
```

⭐ **`avesmapsAddOffroadEdge` ist der Griff für §3**: sie baut die Kante in beide Richtungen,
vertauscht dabei Anstieg und Gefälle und setzt die Höhensummen nur, wenn es welche gibt.

⭐ **Eine Kiste für mehrere Suchen.** `avesmapsAttachOffroadPointToGraph` spannt eine gemeinsame
Kiste über alle Ausstiegskandidaten und rastert **einmal**; zwölf A\*-Läufe darin kosteten gemessen
**4,5 ms** bei 8.277 Zellen. Für §3 dasselbe Muster.

---

## 5. 💣 Fallen — jede einzelne ist schon einmal zugeschnappt

1. **`time` ist NICHT in Stunden.** Der ganze Client-Graph rechnet
   `Strecke[Karteneinheiten] / Tempo[km/h]` (`client-graph.php:386`) — dreimal kleiner als die Uhr,
   weil eine Karteneinheit drei Meilen sind. Eine Kante, die sich in echten Stunden bepreist, wäre
   dreimal teurer als jede Straße, gegen die sie antritt. (Das Diagnosefeld hieß deshalb einmal
   `time_hours` und log; es heißt jetzt `cost_units`.)
2. **Echte Strecke, nicht Kosten** beim Verhältnis in §2 — siehe §1. Mit `distance_units` käme für
   Gulbladdirstadir → Rekheim **77×** statt 18× heraus.
3. **`null` ≠ `0`** bei den Höhensummen, in beiden Richtungen:
   * den Schlüssel bei fehlender Messung **gar nicht setzen** — `avesmapsBuildClientRouteDiagnosticSegments`
     liest ihn mit `array_key_exists(...) ? (float) ... : null`, macht also aus null eine 0,0;
   * die Summen erst bei der ersten echten Abtastung von `null` auf `0.0` schalten. „Ein Raster
     überlappt die **Kiste**" ist nicht „unter dieser **Linie** liegen Höhendaten" — ein Prüf-Agent
     fand genau das an einem Zufallsfall (0/0 über 12,7 km, Linie 2,87 Einheiten neben dem Raster).
4. **Eine Auflösung für die Höhe: `AVESMAPS_TERRAIN_CELL_SIZE = 0,25`** (`terrain-store.php:32`).
   Der Anstieg ist eine totale Variation und wächst mit der Abtastdichte (×√2 je Halbierung); wer
   im Zellraster (0,5) integriert, lässt dieselbe Flanke anders hoch aussehen als bei jedem
   gezeichneten Weg — und beide Zahlen stehen im selben Reiseplan untereinander.
5. **Der Gelände-Notschalter gilt überall** (V11 §8.3). `$terrainEnabled` bis in den Rasterlader
   durchreichen, sonst bedeutet „Gelände aus" für Wege etwas anderes als für Querfeldein.
6. **Kein zweiter Wasserbegriff.** `avesmapsLoadRouteWater()` ist der eine Lader.
7. **Start- und Zielzelle freigeben**, und zwar im Umkreis von
   `AVESMAPS_ROUTE_CLIENT_WATER_COAST_TOLERANCE` (1,0) — 571 von 4.653 Orten liegen geometrisch im
   Wasser. Eine einzelne freigegebene Zelle reicht nicht: ein Hafenort sitzt **mitten** im
   Meerpolygon, und alle acht Nachbarn bleiben gesperrt.
8. **STRATO:** Einzelsonden, keine Schleifen. Der Endpunkt lädt bei **jeder** Anfrage die komplette
   Feature-Tabelle (~1,5 s), auch bei einer Ablehnung.
9. **Geteilter Baum:** nie `git add -A`, nur eigene Pfade. ⚠️ `api/_internal/routing/__tests__/water-trial-test.php`
   hat gemischte Zeilenenden im Index und erzeugt einen Diff, der sich **nicht wegchecken lässt** —
   er blockiert `git rebase`. Weg: Wegwerf-Worktree auf `origin/master`, `cherry-pick`, pushen.

---

## 6. Nachweis

**§1 (Aufschlag):**
* Gulbladdirstadir → Rekheim: die Querfeldein-Etappe meldet **19,39**, nicht 484,65; alle anderen
  acht bleiben unverändert.
* 🔴 **Eine gewöhnliche Route muss bit-gleich bleiben** — der Aufschlag ist Gewicht, nicht Anzeige.
  Gareth → Kuslik vorher/nachher vergleichen: Etappenzahl, Reihenfolge, `cost`.
* Unit: eine Route mit synthetischer Etappe, gemeldete Strecke = Summe ihrer Koordinaten.

**§2 (Auslöser):** die vier Freigabelinks, jeder mit Erwartung —
`?s=kgDKf9Ha` Rekheim (18,0×, löst aus) · `?s=7nkaEHL8` Fiering → Taining (6,8×, löst aus) ·
`?s=DFtqNyn6` Rovik → Skarsten (3,8×, löst aus) · `?s=E3BaLxNe` Flammersbach → Hardorp
(**1,2× — muss unverändert bleiben**). Dazu Gareth → Kuslik bit-gleich: der Vorfilter darf im
Normalfall nichts anfassen.

**§3 (Anker):** die Ankeretappe nach Rekheim hat **mehr als zwei Punkte** und ihre Länge ist ≥ der
Luftlinie. Kein Ort verliert seine Anbindung (Etappenzahl je Wegpunkt vorher/nachher).

⭐ **Das Werkzeug aus dem Härtelauf liegt bereit** und misst all das gegen ein lokales Orakel
(dieselbe Landregel auf die öffentliche Flächen-Nutzlast): es prüft „Länge ≥ Luftlinie", tastet die
Linie alle 0,1 Einheiten auf Wasser ab und vergleicht Server ↔ Orakel. Aufruf und Fallpakete siehe
den Sitzungsverlauf vom 2026-08-02; das Muster ist
`curl … | php pruef.php "$FALL"` mit demselben JSON an beide.

---

## 7. Reihenfolge

1. **§1** — der Aufschlag. Klein, isoliert, und §2 stützt sich sonst auf eine Zahl, die 25× daneben
   liegt.
2. **§2** — der Auslöser. Der Rechner steht, der Vorfilter ist gratis, die Kisten sind klein.
3. **§3** — der Anker. Ändert Geometrie, auf die sich §2 stützt; deshalb zuletzt, und **erst
   messen, dann bauen**.

Jedes Stück ist ein eigener Commit und ein eigener Netzlauf.
