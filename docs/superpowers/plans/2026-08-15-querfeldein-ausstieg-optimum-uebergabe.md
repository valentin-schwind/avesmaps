# Übergabe: der Ausstiegspunkt liegt systematisch falsch

**Stand:** 15.08.2026 · **Zustand:** Befund gemessen, Ursache verstanden, **nichts gebaut**
**Vorgeschichte:** [Entwurf Ausstiegspunkt](../specs/2026-08-14-querfeldein-ausstiegspunkt-design.md) (live 14.08.2026), dort §5 „Was nicht dazugehört"

---

## 1 · Der Befund in einem Satz

Der Router prüft je Weg **genau einen** möglichen Ausstiegspunkt — den, der dem **Ziel** am
nächsten liegt. Das ist systematisch der falsche: gemessen an einer echten Route ist er die
**schlechteste** von vier Möglichkeiten, während das Optimum weit früher auf demselben Weg liegt
und nie geprüft wird.

🔴 **Es ist kein Rechenfehler.** Jede angebotene Kante wird korrekt bewertet, und der Dijkstra
wählt korrekt die beste. Das Angebot selbst ist falsch zusammengestellt.

## 2 · Die Messung

Etappe **Salmingen → Kartenpunkt (x = 501.076, y = 504.530)**, zu Fuß, „Schnellste Route",
Fluss/See an. Alle Zahlen live gegen `POST /api/route/` am 14./15.08.2026.

| Ausstieg | Straße | quer | Zeit | gegen die gewählte |
|---|---:|---:|---:|---:|
| ab Salmingen — **das wählt der Router heute** | 0 | 42,1 Mln | 6,540 | — |
| **(505.501, 511.905) — das Optimum** | **7,9 Mln** | **34,4 Mln** | **6,288** | **−3,8 %** |
| (506.715, 510.863) — erste Owner-Vermutung | 12,7 Mln | 31,8 Mln | 6,475 | −1,0 % |
| (508.575, 507.535) — **der einzige geprüfte Fußpunkt** | 24,8 Mln | 28,2 Mln | 6,898 | **+5,5 %** |

Der Kandidat, den der Router prüft, ist der einzige der vier, der **schlechter** ist als gar kein
Ausstieg. Das Optimum liegt bei rund einem Drittel der Strecke dorthin.

### Warum ausgerechnet der zielnächste Punkt der falsche ist

Er minimiert nur den **zweiten** Summanden (den Querweg) und ignoriert den ersten (die Straße
dorthin). Das Optimum minimiert die **Summe** und liegt deshalb immer früher auf dem Weg — umso
früher, je größer der Tempounterschied zwischen Straße und Gelände ist. Bei `groupFoot` steht
3,07 gegen 2,30, also Faktor 1,33; bei der Kutsche auf der Reichsstraße wären es 5,59 gegen 3,84.

⭐ Das ist **Brechung** — dieselbe Gestalt wie ein Lichtstrahl beim Übergang Luft → Wasser, und
dasselbe wie das „Rettungsschwimmer-Problem" (am Strand schneller laufen, im Wasser langsamer
schwimmen). Der optimale Übergangspunkt erfüllt

```
sin(α_Straße) / v_Straße  =  sin(α_Gelände) / v_Gelände
```

und ist **in geschlossener Form** zu bestimmen — je Weg ein bis zwei zusätzliche Kandidaten statt
einer Abtastung mit hunderten. Genau davor hatte §5 des Entwurfs gewarnt, und diese Warnung ist
damit hinfällig.

💣 **ABER: die Luftlinie ist nicht der Querweg.** Der A\* umgeht Wasser und teures Gelände, und
zwar unterschiedlich stark je nach Startpunkt — an dieser Route gemessen:

| von | Luftlinie | A\*-Weg | Faktor |
|---|---:|---:|---:|
| Salmingen | 10,61 | 14,02 | 1,32 |
| (506.715, 510.863) | 8,48 | 10,60 | 1,25 |
| (508.575, 507.535) | 8,07 | 9,40 | 1,17 |

Eine reine Brechungsrechnung auf Luftlinien liegt hier also um bis zu 32 % daneben. Sie taugt
als **Kandidatengenerator**, nicht als Entscheider — entschieden wird weiterhin vom A\* und vom
Dijkstra.

## 3 · Wo das im Code sitzt

| Datei | Funktion | Rolle |
|---|---|---|
| `api/_internal/routing/client-graph.php` ~849 | `avesmapsCollectNearestClientLandPathAnchors` | **Hier entsteht der falsche Kandidat.** Projiziert das Ziel auf jedes Landweg-Segment, behält je Weg-`id` den nächsten, liefert die K besten. |
| `api/_internal/routing/client-graph.php` | `avesmapsSplitClientPathAtAnchor` | teilt den Weg am Fußpunkt, entfernt die Ursprungskante, liefert den Knotennamen |
| `api/_internal/routing/client-graph.php` | `avesmapsAllocateClientAnchorIndex` | vergibt `__wp_anchor_<n>` aus dem Graphen |
| `api/_internal/routing/offroad-leg.php` ~122 | `avesmapsAttachOffroadPointToGraph` | baut Kandidaten (Fußpunkte + 12 Ortschaften), Reichweitenschranke, A\* je Kandidat in EINER Suchkiste |
| `api/_internal/routing/client-graph.php` ~754 | `avesmapsConnectClientRouteWaypointsToNearestLandPath` | derselbe Sammler für benannte Orte ohne Weganbindung |

Konstanten: `AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT` = 6 · `AVESMAPS_ROUTE_OFFROAD_EXIT_NODE_LIMIT` = 12 ·
`AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR` = 2,5.

**Das Angebot für die gemessene Etappe**, aus `debug.context.offroad.to.exit_nodes`:

```
__wp_anchor_0@6.27  Moorbrück@6.77  __wp_anchor_1@8.07  __wp_anchor_2@9.87  Tarnelfurt@10.01
Grantelwacht@10.04  Kreuzung-2468@10.31  Kreuzung-7149@10.35  Donken@10.58  Salmingen@10.61
Kreuzung-7926@10.94  Kreuzung-11145@11.16  Gerrun@11.37  Tallon@11.44  Kreuzung-7943@11.69
```

`__wp_anchor_1@8.07` **ist** der Punkt (508.575, 507.535) aus der Tabelle oben — der geprüfte und
zu Recht verworfene. Der Weg, auf dem beide Owner-Vermutungen liegen, ist das Feature
`path16-3-99-1` (Talloner Hügelsteig, Salmingen ↔ Tarnelfurt).

## 4 · Wie man einen Kandidaten misst, ohne Code zu ändern

Zwei Anfragen je Stelle, keine Änderung am Server nötig:

```bash
# A: was kostet es, bis zur Stelle zu kommen?
curl -s -X POST https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{
  "from":"Salmingen","to":"Stelle","to_point":{"x":505.501,"y":511.905},
  "optimize":"fastest","include_geometry":true,"include_steps":true,"minimize_transfers":false,
  "transports":{"land":"groupFoot","river":"riverSailer","sea":"cargoShip","synthetic":"groupFoot"},
  "enabled_transports":{"land":true,"river":true,"sea":true,"synthetic":true}}'

# B: was kostet der Querweg von dort? (BEIDE Enden als Kartenpunkt)
curl -s -X POST https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{
  "from":"Stelle","to":"Ziel",
  "from_point":{"x":505.501,"y":511.905},"to_point":{"x":501.076,"y":504.530}, ... }'
```

`route.cost` von A + B ist die Zeit dieses Ausstiegs. Wegegeometrie für eigene Rechnungen:
`GET /api/app/map-features.php?bbox=497,500,514,518` (Antwort ~5,6 MB, also **eine** Abfrage,
lokal auswerten).

🪤 **STRATO: einzelne Proben, niemals Schleifen.** Das Projekt hat dort schon einmal die
PHP-Worker gesättigt.

## 5 · Fallen, die diese Sitzung Zeit gekostet haben

> 🪤 **lat/lng gegen x/y.** Die Wegpunkt-Beschriftung („Kartenpunkt (504.530, 501.076)") und der
> `?pin=`-Parameter tragen **`lat, lng`**; `to_point` will **`{x: lng, y: lat}`**
> (`applyMapPointRouteEndpoints`, `js/routing/route-travel-here.js`). Wer die Zahlen aus der
> Oberfläche abtippt und ungedreht in eine API-Probe steckt, misst eine gespiegelte Stelle der
> Karte. Das ist hier passiert und hat drei falsche Erklärungen in Folge erzeugt
> („Browser-Cache", „liegt am Transportmittel", „liegt an Kürzeste Route"), bis die
> **Etappenliste der Oberfläche** die Zahlen dagegenhielt. ⚠️ Bei jedem Verdacht auf
> „der Browser zeigt etwas anderes als die API": die Etappenliste zeigen lassen und die Meilen
> vergleichen, bevor irgendetwas anderes vermutet wird.

> 🪤 **Die Reichweitenschranke hat an einem Tag drei Fassungen gebraucht** (Details in
> `AGENTS.md` §11 und im Entwurf). Ihr Maßstab ist jetzt der **nächste Ortsknoten**, und das muss
> so bleiben: ein relativer Maßstab, der mit der Kandidatenmenge mitwandert, ändert seine Weite
> jedes Mal, wenn eine neue Kandidatenart dazukommt. **Wer Kandidaten hinzufügt, muss prüfen, was
> das mit dieser Schranke macht.**

> ⚠️ **Ortschaften und Fußpunkte stehen in EINEM Topf, ohne Rangfolge.** Eine Staffelung
> („Ortschaften nur als Rückfall") war schon einmal falsch und ließe eine Stadt dicht am Ziel
> hinter einem Fußpunkt verschwinden.

## 5a · 🔴 SERVER ODER CLIENT — vor der ersten Zeile klären

**Die Oberfläche routet ÜBER DEN SERVER.** `updateMapViewServerPrimary`
(`js/routing/route-engine.js`) ruft `buildRouteResultFromSelectedLocationsServer`, und die schickt
je Wegpunktpaar **eine eigene** `POST /api/route/`-Anfrage. Eine Reise über drei Wegpunkte sind
zwei Anfragen, nicht eine — wer eine Etappe nachmessen will, muss genau dieses Paar anfragen.

💣 **`USE_SERVER_ROUTING = false` in `js/routing/route-graph-routing.js` ist eine FALLE.** Die
Konstante gehört zu `calculateRouteByMode`, und diese Funktion wird von der Oberfläche **nicht**
benutzt; der Kommentar daneben („Current UI flow still uses calculateRouteClientLegacy") ist
veraltet. Wer sie liest und daraus schließt, die Route werde im Browser gerechnet, sucht danach
stundenlang an der falschen Stelle.

**Was der Client-Graph (`js/routing/route-graph-core.js`, `route-graph-routing.js`) heute noch tut:**

| Zweck | benutzt |
|---|---|
| Vergleichsprobe neben der Serverroute (`shouldProbeServerRouting`) | ja, nur zum Protokollieren |
| Konnektivitäts-Index für die Editor-Markierungen „unverbundene Orte" / „dünne Kreuzungen" | ja |
| die Route, die der Reisende sieht | **nein** |

💣 **Und er ist KEIN Spiegel des Servers.** Er kennt weder den Fußpunkt-Anker noch den
Umweg-Auslöser noch das Teilen von Wegen — diese drei gibt es ausschließlich serverseitig. Die
Regel „Client und Server müssen dasselbe rechnen" gilt für den Graphbau der Wege, **nicht** für
diese Features. Wer sie in `js/routing/` „nachzieht", baut totes Gewicht.

⭐ **Für diese Aufgabe heißt das: der Umbau ist rein serverseitig** (`api/_internal/routing/`).
Am Client ist nur zu prüfen, ob er das Ergebnis richtig ANZEIGT — siehe §5b.

## 5b · 🔧 Den Renderer selbst prüfen — das ist offen

Eine richtige Serverantwort kann falsch gezeichnet werden, und **das hat bisher niemand
angesehen**. Der Entwurf vom 14.08. nennt es unter „Abnahme" ausdrücklich als das, was ein Test
nicht beantworten kann — erledigt wurde es nie.

Konkret zu prüfen, mit einer Route, die wirklich an einem Fußpunkt aussteigt:

1. **Die Naht.** Eine Etappe endet mitten auf einer Straße (Knoten `__wp_anchor_<n>`), die nächste
   ist Querfeldein. Wechselt die Linie dort sauber von durchgezogen auf gestrichelt
   (`SYNTHETIC_ROUTE_STYLE`, `js/config.js`), oder klafft/überlappt etwas? Die geteilten Hälften
   tragen die Kennungen `wp-slice-<n>-a` / `-b` und die Wegart des Elternweges — sie müssen wie
   eine gewöhnliche Straße aussehen.
2. **Die Beschriftung.** `js/map-features/map-features.js:236` ersetzt `__wp_anchor_\d+` durch
   „Kreuzung". An einem Ausstieg auf freier Strecke ist dort **keine** Kreuzung. Liest sich
   „von Salmingen bis Kreuzung" für den Reisenden richtig, oder braucht es ein eigenes Wort?
   🔧 Das ist eine Owner-Frage, keine technische.
3. **Die Etappenliste.** Werden die beiden Hälften eines geteilten Weges zu einer Zeile
   zusammengefasst oder stehen sie doppelt da? Es gibt eine Segment-Aggregation
   (Commit `0035fcd2`, „Reichsstraße Segment-Aggregation") — greift sie über einen
   Anker-Knoten hinweg?
4. **Die Meilenzahl.** Stimmt die Summe in der Reiseübersicht mit der Summe der Etappen? An
   dieser Route war die Übersicht die einzige verlässliche Gegenprobe zur API — sie muss stimmen.

Beteiligte Dateien: `js/routing/route-engine.js` (`buildRouteResultFromServerRoute`),
`js/routing/route-render.js`, `js/routing/route-plan.js` (Etappenliste),
`js/routing/route-result.js`, `js/config.js` (`SYNTHETIC_ROUTE_STYLE`).

## 6 · Was noch niemand weiß

🔧 **Wie groß der Gewinn typischerweise ist.** Es gibt **eine** Messung: 3,8 %. Ob das an anderen
Routen 0,5 % oder 15 % sind, ist offen — und davon hängt ab, ob der Bau sich überhaupt lohnt.
Der Gewinn müsste dort am größten sein, wo der Tempounterschied groß ist (Kutsche, Reiter) und
wo ein Weg lange schräg am Ziel vorbeiführt.

**Erster Schritt für die neue Sitzung: messen, nicht bauen.** Fünf bis acht echte Routen,
je Route das Optimum von Hand suchen (Abschnitt 4), Gewinn gegen den heutigen Stand notieren.
Erst mit dieser Zahlenreihe zum Owner.

## 7 · Woran eine Lösung zu messen ist

1. **Der Fall oben wird gefunden.** Für die Etappe Salmingen → (501.076, 504.530) muss der
   Ausstieg bei rund (505.5, 511.9) liegen, Zeit ≈ 6,29 statt 6,54.
2. **Kein bestehender Test wird rot**, insbesondere nicht `offroad-leg-test.php`,
   `anchor-candidates-test.php`, `carriage-offroad-test.php`, `water-bridge-test.php`.
3. **Die Zahl der A\*-Läufe je Kartenpunkt steigt nicht wesentlich** — heute bis 18
   (6 Fußpunkte + 12 Ortschaften, meist deutlich weniger durch die Reichweitenschranke).
   Ein Kandidatengenerator, der je Weg ein bis zwei Punkte liefert, ist im Rahmen; eine
   Abtastung mit hunderten Punkten ist es nicht.
4. **Keine Route wird schlechter als heute.** Alle heutigen Kandidaten bleiben im Angebot;
   die neuen kommen dazu.
5. **Der neue Test ist gegen den alten Stand rot belegt**, nicht nur behauptet
   (`git show HEAD:<datei> > <datei>` , laufen lassen, zurückkopieren).
6. Vor dem Push das **ganze** Testfeld, PHP und JS. ⚠️ `linkcheck/link-url-test.php` ist auf dem
   Entwicklungsrechner vorbestehend rot (echter DNS-Abruf) — das ist kein Regressionssignal.
7. **Der Renderer ist angesehen worden** (§5b), und zwar an einer echten Route im Browser, nicht
   an einer Zahlentabelle. Was ein Emulator nicht beantworten kann, wird als offene Frage
   gemeldet, nicht als bestanden.

## 8 · Ein Gedanke zur Bauart, nicht mehr

Der Brechungspunkt hängt davon ab, **aus welcher Richtung** man auf den Weg trifft — und das
entscheidet erst der Dijkstra. Ein pragmatischer Zuschnitt wäre deshalb: je Kandidatenweg **zwei**
Punkte anbieten statt einem — den heutigen zielnächsten **und** den Brechungspunkt, gerechnet aus
dem Startknoten der Etappe. Ob das reicht oder ob es einen dritten braucht, ist offen; die
Messreihe aus §6 sollte das mitbeantworten.

Kein Zuschlag, keine neue Stellschraube: das Angebot wird ergänzt, entschieden wird weiterhin
vom Dijkstra über die Zeit.
