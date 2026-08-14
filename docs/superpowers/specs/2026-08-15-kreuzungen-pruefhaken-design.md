# Der Prüfhaken „Kreuzungen mit 2 Wegen" — Entwurf

> Stand: 2026-08-15 · Anlass: Owner-Meldung an `?pin=677.850,662.555`
> („warum wird die Stelle markiert, obwohl alle Wege darin enden?")

## 1. Wozu der Haken da ist

Er gehört den Editoren, die aus

```
----X----     zu     ----------
```

machen sollen: ein Knoten, der zwei Wege aneinanderreiht, ohne etwas zu verbinden,
wird aufgelöst und die beiden Wege werden einer.

**Er hält das heute nicht.** Von 921 markierten Kreuzungen führen 182 zu einer
Kreuzung, die einwandfrei funktioniert. Jeder fünfte Klick geht ins Leere — und ein
Werkzeug, dessen Funde man erst nachprüfen muss, benutzt niemand zweimal.

## 2. Die Ursache: gemessen wird mit dem Graphen, auf dem nicht gefahren wird

Es gibt zwei Graph-Erzeuger, und sie sind sich an genau einer Stelle uneinig.

| | Erzeuger | Knoten entstehen an |
|---|---|---|
| **Router (live)** | `avesmapsAddClientCompatiblePathConnection`, `api/_internal/routing/client-graph.php:191` | Weg-Endpunkten **und jedem inneren Stützpunkt, der round-5 exakt auf einem Ort liegt** — der Weg wird dort geschnitten |
| **Prüfhaken** | `addRegularPathToGraph`, `js/routing/route-graph-routing.js:113` | **nur** Weg-Endpunkten |

Eine Straße, die *durch* eine Kreuzung läuft, ist für den Router ein vollwertiger
Knoten und für den Haken unsichtbar. Und genau diese Bauform erzeugt der
Editor-Knopf „Ort verbinden und Straße weiterführen": er hängt die Kreuzung als
exakten Vertex an die LineString.

🔴 **Der Split gehört NICHT in den Routing-Zweig.** Er stand dort schon einmal und
wurde am 20.06.2026 zurückgerollt (Revert `1f9e0b9e`), weil er im echten Netz
nicht-deterministische Routen erzeugte. Er kommt ausschließlich in den
Konnektivitäts-Zweig (`graphOptions.transports === "all"`), der früh und mit
eigenem `return` aussteigt. Der Routing-Zweig bleibt Zeile für Zeile, wie er ist.

### Der zweite, kleinere Grund

`getLocationAtPathEndpoint` (`js/map-features/map-features-location-editing.js:18`)
löst einen Endpunkt in zwei Stufen auf: exakter Treffer < 0,01, sonst der 0,5-Kasten
mit **Array-Reihenfolge** als Schiedsrichter. Der gemeldete Fall ist genau das:
`Weg-5120` endet 0,015 von `Kreuzung-2090` — zu weit für Stufe 1 — und ging an
**Lonatfurt**, 0,245 entfernt, weil Lonatfurt an Index 1503 vor der Kreuzung
(Index 4888 von 4889) steht.

⚠️ **Diese Stufe wird nicht angefasst.** „Nächster gewinnt" ist gemessen worden und
riss 56 Knoten aus dem Hauptnetz (`js/map-features/__tests__/location-at-path-endpoint.test.js:121`).
Kartenweit sind es 13 solcher Enden — ein Datenfall für die Editoren, kein Codefall.
Der neue Haken markiert sie nicht mehr, weil sie nach Regel 1 unten drei Arme haben.

## 3. Die neue Regel

Eine Kreuzung trägt den türkisen Ring, wenn **alle drei** zutreffen:

| # | Bedingung | trifft aus |
|---|---|---|
| 1 | **genau 2 Arme** im Graphen, gezählt nach der Server-Regel (Split mitgezählt) | 145 |
| 2 | **kein weiterer Weg läuft über sie hinweg** (Abstand < 0,02 zu einer fremden Wegstrecke) | − 19 |
| 3 | **beide Arme sind dieselbe Wegart** | − 31 |

**Ergebnis: 95 Ringe statt 921.**

**Zu Regel 2:** die 19 sind keine Auflös-Fälle, sondern das Gegenteil — dort fehlt
einem dritten Weg der Stützpunkt auf der Kreuzung. Auflösen würde ihn abschneiden.
Sie fallen still heraus; ihr eigener Haken ist ein späteres Thema.

**Zu Regel 3:** ein Knoten, an dem Pfad→Straße, Straße→Gebirgspass oder
Seeweg→Flussweg wechselt, trägt Information. `----------` gäbe es dort nicht, weil
die zusammengelegte Linie eine Wegart verlöre. (Owner-Entscheid 2026-08-15 auf
Nachfrage: Regel 3 bleibt drin.)

### Was aus dem Haken verschwindet

523 Sackgassen und Datenleichen (0 oder 1 Arm) sowie die 89 Stütz-Fälle. Die
0-Arm-Leichen darunter zeigt der pinke „Unverbunden"-Ring bereits — der Haken hört
also auf, zwei fremde Aufgaben mitzuschleppen, statt sie zu verlieren.

### Nebenbefund: derselbe Split repariert auch den pinken Ring

`unconnected` und `sparseCrossings` kommen aus **einem** Lauf über **einen** Graphen
(`computeLocationConnectivityIndex`). Von heute 182 pinken Ringen stehen **12**
falsch: Orte, die sehr wohl am Netz hängen — als Stützpunkt statt als Endpunkt.
Sie verschwinden mit derselben Änderung.

💣 **Wer nur den türkisen Ring nachmisst, übersieht das.** Beide Zahlen gehören in
die Abnahme.

## 4. Die Beschriftung

„Kreuzungen ≤ 2 Wege" → **„Kreuzungen mit 2 Wegen"** (Owner 2026-08-15). Das `≤`
war die alte Regel; „mit 2 Wegen" ist die neue.

Eine Zeile in `index.html:2544`. 💣 Die Prüfhaken-Beschriftungen tragen **kein**
`data-i18n` (die Nachbarn im selben Menü schon) und `js/app/i18n-en.js` kennt sie
nicht — hier wird kein Schlüssel gepflegt, sondern Text ersetzt. Wer einen anlegt,
baut eine halbe Übersetzung.

🔴 **Die Beschriftung ändert sich, der Code nicht.** `toggleSparseCrossings`,
`toggleSparseCrossingsControl`, `.location-visual-marker__shape--sparse-crossing`
und `--color-marker-sparse-crossing-ring` bleiben, wie sie heißen — dieselbe
Trennung wie bei „Neuigkeiten"/`changelog` (AGENTS.md §11). Sie stehen in
ausgeliefertem HTML, CSS und in `js/map-features/__tests__/pruefringe-css.test.js`;
eine Umbenennung wäre Lärm ohne Gegenwert.

⚠️ **Eine Ausnahme:** `SPARSE_CROSSING_MAX_WAYS` (`js/config.js:78`) heißt „MAX" und
wird künftig auf **Gleichheit** geprüft. Ein Konstantenname, der das Gegenteil des
Vergleichs sagt, ist eine Falle für den nächsten Leser — und anders als DOM-IDs und
CSS-Token steht er in keinem ausgelieferten Dokument. Er wird zu
`SPARSE_CROSSING_WAY_COUNT`.

## 5. Die Kreuzung melden

Ein Editor kann die Stelle heute nicht benennen. `Kreuzung-2090` steht nirgends —
und wäre als Adresse auch unbrauchbar:

```js
// js/routing/routing.js:80
name: isCrossing ? `Kreuzung-${crossingCount++}` : feature.properties.name,
```

💣 **Der Name entsteht erst im Browser**, als laufender Zähler über die
Payload-Reihenfolge. Legt jemand eine Kreuzung an, die früher einsortiert, rutscht
**jede folgende Nummer um eins**. Was ein Editor heute meldet, zeigt morgen
woandershin. Die Nummer wird deshalb **nicht** wiederbelebt.

Stattdessen ein Melden-Knopf im Editor-Band des Kreuzungs-Popups
(`crossingActionsMarkup`, `js/ui/popups.js:638`), der eine Zeile in die
Zwischenablage legt:

```
Kreuzung · 2 Arme (Strasse) · https://avesmaps.de/index.html?pin=677.850,662.555
```

Gebaut aus dem vorhandenen `buildSharePinLink(latlng)`
(`js/map-features/map-features-share-pin.js:148`) plus `copyTextToClipboard` und
`showFeedbackToast` — kein zweiter Link-Bauer.

⚠️ Der Knopf steht **an jeder** Kreuzung, nicht nur an markierten: gemeldet wird
auch, was der Haken gerade nicht zeigt.

💣 **Der Knopf baut den Index nicht.** Die Armzahl ist Beiwerk — sie wird gelesen,
wenn der Index ohnehin schon steht (`locationConnectivityIndex` befüllt), und sonst
fällt der Mittelteil weg. `getLocationConnectivityIndex()` hier aufzurufen hieße,
einen Popup-Klick mit einem Graphbau über 5929 Wege zu bezahlen — an einer Stelle,
an der der Editor nur eine Adresse kopieren will.

## 6. Bauteile

| Datei | Änderung |
|---|---|
| `js/routing/route-graph-routing.js` | round-5-Split im `transports:"all"`-Zweig von `addRegularPathToGraph`; Zwilling zu `avesmapsAddClientCompatiblePathConnection` |
| `js/routing/route-graph-routing.js` | `computeLocationConnectivityIndex`: die drei Regeln + Segment-Gitter; Arm-Zahl und Wegart je Kreuzung im Index ablegen (der Melden-Knopf liest sie) |
| `js/config.js` | `SPARSE_CROSSING_MAX_WAYS` → `SPARSE_CROSSING_WAY_COUNT`, Kommentar auf die neue Regel |
| `index.html` | Beschriftung |
| `js/ui/popups.js` | Melden-Knopf im Kreuzungs-Band |
| `js/map-features/map-features-location-marker-rendering.js` | Kommentar (Zeile 198 beschreibt die alte Regel) |

⚠️ **Kein `?v=` von Hand** (AGENTS.md §7) — alle sechs Dateien hängen an
`index.html` und werden vom Deploy gestempelt.

## 7. Aufwand an der Laufzeit

Der Index wird **lazy** gebaut und nur, wenn ein Prüfhaken an ist
(`getLocationConnectivityIndex`) — die Kartenanzeige zahlt nichts, auch im
Editor nicht.

💣 **Regel 2 naiv ist O(Kreuzungen × Segmente)** und lief in der Messung sekundenlang
(2090 × ~5929 Wege). Sie braucht ein Segment-Gitter über die Wegstrecken, einmal je
Indexbau — dieselbe Bauform wie der round-5-Vertex-Index daneben. Der Index wird bei
jeder Feature-Änderung verworfen (`refreshPlannerAfterFeatureChange`), im Editor also
oft; ein sekundenlanger Neubau wäre dort spürbar.

## 8. Tests

`js/routing/__tests__/location-connectivity-index.test.js` erbt die neuen Regeln,
je Ausschlussgrund ein Fall:

- Kreuzung mit 2 Endpunkt-Armen, gleiche Wegart → **markiert**
- Kreuzung als **innerer Stützpunkt** eines dritten Weges → nicht markiert
  *(der gemeldete Fall; ohne Split wäre sie markiert)*
- Kreuzung mit 2 Armen, aber ein fremder Weg **läuft über sie hinweg** → nicht markiert
- Kreuzung mit 2 Armen, **Pfad + Straße** → nicht markiert
- Kreuzung mit 0 / 1 Arm → nicht markiert *(neu: war es vorher)*
- Ort, der als innerer Stützpunkt an einem Weg hängt → **nicht** „unverbunden"

`js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js` und
`js/routing/__tests__/create-graph-connectivity.test.js` bleiben gültig und laufen mit.

💣 **Vor dem Push das GANZE Testfeld** (AGENTS.md §9), nicht die eigenen Tests:
`pruefringe-css.test.js` prüft die Token-Namen aus §4, und ein roter Test lädt
**nichts** hoch — mit dem bekannten Nachspiel für den `?v=`-Stempel.

## 9. Abnahme — Ablauf, nicht Maß

Eine Tabelle mit 95 statt 921 belegt nichts. Vor „fertig" wird ausgeführt und benannt:

1. `?edit=1`, Haken „Kreuzungen mit 2 Wegen" **an** → die Beschriftung stimmt.
2. `?pin=677.850,662.555` → **kein** türkiser Ring an Kreuzung-2090.
3. Eine der 95 aufsuchen, anklicken → Popup öffnet, Melden-Knopf da, Klick →
   Toast erscheint, Zwischenablage trägt die Zeile, der Link führt zurück auf die Stelle.
4. Haken „Unverbunden" an → 170 statt 182 Ringe, und die 12 Verschwundenen liegen
   nachweislich auf einem Weg.
5. Eine Route über eine aufliegende Kreuzung rechnen → unverändert
   (Beweis, dass der Routing-Zweig nicht berührt wurde).

⚠️ Was hier nicht beantwortet wird: ob die 95 fachlich wirklich alle auflösbar sind.
Das entscheidet der Editor an der Karte, nicht der Haken.

## 10. Was dieser Entwurf NICHT tut

- **Keine Datenänderung.** Die 13 fehlgeschnappten Wegenden, die 19 fehlenden
  Stützpunkte und die 523 Leichen bleiben, wie sie sind — der Haken hört nur auf,
  falsch über sie zu reden.
- **Kein neuer Haken** für Sackgassen oder Stütz-Fälle. Beide sind benannt und
  gemessen; ob sie einen bekommen, ist eine eigene Entscheidung.
- **Kein Eingriff in `getLocationAtPathEndpoint`** (§2) und keiner in den
  Routing-Zweig (§2, 🔴).
