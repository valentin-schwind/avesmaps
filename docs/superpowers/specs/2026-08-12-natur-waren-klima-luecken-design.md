# Waren · Fauna · Flora · Klimazone — die zwei fehlenden Felder

**Stand:** 2026-08-12 · Owner-Auftrag: „Waren / Fauna / Flora / Klimazone sollen — sofern
verfügbar und nicht schon vorhanden — bei allen Features im Infopanel angezeigt werden:
Territorien, Regionen, Siedlungen, Wege."

## 1. Was schon steht

Die vier Angaben sind zwei getrennte Bausteine, jeder mit einem eigenen Zeilenbauer:

- **Waren / Fauna / Flora** — `buildLoreMarkup()` in `js/map-features/map-features-lore.js`
- **Klimazone** — `avesmapsClimateRow*()` in `js/map-features/map-features-climate-row.js`

Gemessen am Code (2026-08-12):

| Oberfläche | Zeilenbauer | Waren/Fauna/Flora | Klimazone |
|---|---|---|---|
| Siedlung | `map-features-location-marker-entry.js` | ✅ Z. 351 | ✅ Z. 356 |
| Landschaftsregion (Label) | `map-features-labels.js` | ✅ Z. 374 | ✅ Z. 383 |
| Herrschaftsgebiet | `map-features-region-info-markup.js` | ✅ Z. 140 | ❌ **fehlt** |
| Weg | `map-features-path-rendering.js` / `-path-landscapes.js` | ❌ **fehlt** | ✅ Z. 408 |

Also **zwei** Lücken, nicht acht. Beide Zeilen existieren fertig; es fehlt jeweils nur der
Zulieferer.

⚠️ Eine fünfte Oberfläche gibt es auch: die Routen-**Etappe** (`js/routing/route-plan.js:489`).
Sie bleibt unangetastet — dort hat der Owner am 2026-07-29 ausdrücklich nur Flora und Fauna
gewollt („Flora und Fauna is richtig"), und sie ist die kurze Erzählung, nicht der Beleg.

## 2. Lücke A — Klimazone am Herrschaftsgebiet

### Woher die Daten kommen

Sie liegen bereits in der Datenbank. `ecosystem_region_territory` (region_id ·
territory_public_id · share · is_aggregate) wird beim Knopf **„Zugehörigkeit rechnen"** im
Landschaften-Editor mitgeschrieben — dieselbe Schleife, die
`ecosystem_region_overlap` füllt, aus der die Landschaftsregionen ihre Zonen beziehen. Seit
die Klimabänder gewöhnliche `ecosystem_area`-Zeilen sind (2026-08-03), fällt jedes Territorium
beim Lauf automatisch in seine Zonen.

🔴 **Die Tabelle hat bis heute keinen Leser.** Genau deshalb fehlt die Zeile — nicht weil die
Zahlen fehlen.

### Der Weg in die Infobox

Neue Funktion `avesmapsClimateReadTerritoryZones(PDO, string $territoryPublicId)` in
`api/_internal/app/climate-membership.php`, direkt neben `avesmapsClimateReadRegionZones()`.
Sie liefert dieselbe Form `[[zone_key, share], …]`, größter Anteil zuerst, Gleichstand nach
`sort_order` (Nord → Süd).

`api/app/territory-detail.php` gibt sie als `climate_zones` mit aus. Das ist der Abruf, den die
Gebiets-Infobox **ohnehin schon macht** (`js/map-features/map-features-infopanel.js:799`) —
kein neuer Request, keine zusätzliche Ladezeit.

Client: eine Zeile in `createRegionWikiInfoBoxMarkup()` hinter dem Lore-Container:

```js
(typeof avesmapsClimateRowForShares === "function"
    ? avesmapsClimateRowForShares((detail && detail.climate_zones) || f.climate_zones)
    : "")
```

⭐ **Kein vierter Zeilenbauer.** Die Zonen-NAMEN reisen nicht mit; der Client löst den Schlüssel
über das Vokabular aus dem Kartenpayload auf (`avesmapsClimateSetVocabulary`), genau wie bei Ort
und Region. Der Server liefert Schlüssel + Anteil, nichts sonst.

⭐ **Die Funktion nimmt auch `f.climate_zones` an.** `createRegionWikiInfoBoxMarkup` bedient
nicht nur politische Territorien, sondern auch Landschaftsregionen, die über ihre Fläche statt
über ihr Label geöffnet werden (`regionEntry.source === "map_feature"`). Deren Zonen stehen im
Kartenpayload. Ein Selektor, der nur `detail` liest, ließe diesen Fall stumm.

### Fallen

💣 **`share` ist der Anteil der KLEINEREN der beiden Flächen** (V9-Regel,
`computeTerritoryHits` in `html/landschaften-editor.html:685`). Ein Klimaband bedeckt ein
Siebtel der Karte, ein Territorium ist kleiner — also ist die kleinere das Territorium, und
die Zahl liest sich als „so viel des Reichs liegt in dieser Zone". Genau das sagt die Zeile.
Bei etwas, das GRÖSSER ist als ein Band (es gibt kein solches Territorium), drehte sich die
Bedeutung um; solche Zeilen fielen ohnehin unter die Schwelle.

💣 **Schwelle 5 %** — derselbe Wert und derselbe Grund wie bei den Regionen
(`AVESMAPS_CLIMATE_REGION_MIN_SHARE`). Ein Schnipsel des Nachbarbands ist Rauschen. Der
Assignment-Lauf selbst schneidet schon bei 10 % ab (`RAYCAST_THRESHOLD`), die 5 % hier sind
die zweite, unabhängige Bremse — sie steht, damit dieser Leser dieselbe Regel trägt wie sein
Zwilling, auch wenn der Lauf seine Schwelle einmal senkt.

💣 **Kein zweiter Rechner.** Die Zone wird NICHT aus der Territoriumsgeometrie gegen die Bänder
gerechnet. Das wäre eine zweite Antwort auf dieselbe Frage, und die beiden liefen beim ersten
Regelwechsel auseinander — die Begründung steht wörtlich über
`avesmapsClimateReadRegionZones()`.

⚠️ **Abhängigkeit vom Lauf.** Erscheint die Zeile bei zu wenigen Gebieten, ist die Reparatur
ein Klick des Owners auf „Zugehörigkeit rechnen", kein Code. Nach dem Deploy wird gemessen, bei
wie vielen Gebieten sie wirklich steht (wie damals „123 von 127 Labels").

⚠️ **Purity-Vertrag** von `climate-membership.php` gilt weiter: kein DDL, nichts beim Include,
fehlende Tabellen liefern die leere Antwort statt einer 500.

## 3. Lücke B — Waren / Fauna / Flora am Weg

### Woher die Daten kommen

Ein Weg hat selbst keine Flora — er führt durch Landschaften, und die haben sie. Genau so macht
es die Routen-Etappe bereits: `landscapeWikiKeyList(buildLandscapeLine([pathId]))` liefert die
Komma-Liste, die `api/app/lore.php` als „gib mir die Flora all dieser Orte auf einmal" versteht.

Die Weg-Infobox holt ihre Landschaften **ohnehin schon** — die Zeile „Führt durch" steht auf
demselben Abruf. Es kommt kein einziger zusätzlicher Serverabruf dazu.

### Der Weg in die Infobox

In `avesmapsPathLandscapesFillPending()` (`js/map-features/map-features-path-landscapes.js`),
wo heute schon „Führt durch" und die Klimazeile in den Container geschrieben werden, kommt der
Lore-Container dazwischen:

```
Führt durch → [Waren · Fauna · Flora] → Klimazone
```

💣 **Die Reihenfolge ist tragend.** „Klimazone steht direkt unter Flora" ist eine
Owner-Entscheidung vom 2026-08-03 und gilt an allen vier Stellen. Wer die Lore-Zeilen hinter
die Klimazeile hängt, bricht sie genau hier.

💣 **`buildLoreMarkup()` lädt nicht selbst** — es liefert einen leeren, markierten Container,
den der Beobachter in `map-features-lore.js` füllt, sobald er im DOM steht. Der Beobachter hört
auf `document.documentElement`, also greift er auch für einen Container, der erst nachträglich
per `innerHTML` entsteht. Ein eigener Abruf an dieser Stelle wäre das Fan-out, das am
2026-07-21 den PHP-Pool gesättigt hat.

### Alle drei Arten, nicht zwei

Owner 2026-08-12: **alle drei** (Waren, Fauna, Flora) am Weg. Also **kein** `kinds`-Filter —
anders als bei der Routen-Etappe, die bewusst auf `"flora|fauna"` beschränkt bleibt. Begründung
des Unterschieds: An einer Handelsstraße sind die Waren der durchquerten Gegenden eine echte
Aussage; die Etappenliste im Reiseplan ist eine Kurzfassung und soll knapp bleiben.

### Fallen

💣 **Klimabänder tragen keinen Wiki-Schlüssel und dürfen nicht in die Liste.**
`buildLandscapeLine()` schließt `kind === 'klima'` bereits aus (der `wantClimate`-Schalter), also
enthält `landscapeWikiKeyList()` sie nie. Wer stattdessen über `avesmapsPathLandscapeCollect`
mit `wantClimate = true` ginge, bekäme „Flora der Gemäßigten Zone".

💣 **Leere Liste ⇒ gar nichts.** Trägt ein Weg keine Landschaft, entsteht kein Container und
kein Abruf. „Wir wissen nichts" gehört nicht als leeres Feld in die Box — dieselbe Regel wie bei
allen anderen Lore-Zeilen.

## 4. Was NICHT dazugehört

- **Spezies** bleibt ausgeblendet (Owner 2026-07-21: das Feld `Regionen` der
  `{{Infobox Spezies}}` ist im Wiki zu schlecht gepflegt). Die Daten bleiben in Katalog,
  Editor und Endpoint.
- **Die Routen-Etappe** behält Flora + Fauna ohne Waren (§1).
- **Kein Reise-Effekt.** Die Klimazone am Territorium ist eine Anzeige, keine Rechengröße für
  die Route.
- **Keine neue Tabelle, kein neuer Endpunkt.** Beide Lücken werden aus vorhandenen Daten über
  vorhandene Abrufe geschlossen.

## 5. Abnahme

Die Handgriffe, nicht die Maßtabellen (AGENTS.md §9):

1. Auf einen **Weg** klicken (eine Reichsstraße mit Landschaften, z. B. über eine bekannte
   Route) → Infobox öffnet → unter „Führt durch" stehen Waren/Fauna/Flora, darunter die
   Klimazone.
2. Auf ein **Herrschaftsgebiet** klicken → Infopanel → unter Flora steht „Klimazone".
3. Gegenprobe **Siedlung** und **Landschaftsregion**: unverändert.
4. Gegenprobe **Reiseplan-Etappe**: weiterhin nur Flora + Fauna, keine Waren.
5. Hell UND dunkel, Infopanel UND schwebendes Popup.

Unit-Tests: `js/map-features/__tests__/path-landscapes.test.js` (Reihenfolge der drei Blöcke)
und `api/_internal/app/__tests__/climate-membership-test.php` (der neue Territorien-Leser gegen
eine sqlite-Attrappe).
