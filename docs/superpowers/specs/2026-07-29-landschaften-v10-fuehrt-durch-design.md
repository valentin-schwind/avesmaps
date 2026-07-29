# Landschaften V10 — „Führt durch" an Route, Etappe und Weg — Design

**Stand:** 2026-07-29 · **Auftraggeber:** Owner · **Vorgänger:** V9 ✅ live und abgenommen
(9.091 Zeilen in 0,4 s) · **Auftakt:** `docs/superpowers/specs/2026-07-29-landschaften-v10-auftakt.md`
· **Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md` Zeile 2132.

---

## 0. Kurzfassung

V9 hat gespeichert, **von welcher Bogenlänge bis zu welcher** ein Weg durch eine Fläche
läuft (`path_ecosystem`). V10 macht daraus eine Zeile, die ein Besucher lesen kann — an
**vier** Stellen und in **zwei Tonlagen**:

```
Planer, Zusammenfassung   Landschaften   Herz des Kontinents · Seenland · Tommellande · …
Planer, Etappenzeile      … von Hirschfurt bis Bitani        durch: Reichsforst
Etappen-Infobox           Führt durch    Herz des Kontinents · Reichsforst (20 %)
Weg-Infobox               Führt durch    Herz des Kontinents · Reichsforst (20 %)
```

**Der Planer erzählt, die Infobox belegt.** Im Planer stehen blanke Namen, und die
Etappenliste nennt nur, was gegenüber der Zeile darüber **neu** ist; die Infoboxen zeigen
immer die volle Wahrheit dieser einen Etappe, mit Anteilen. Unter den Infoboxen, faul
nachgeladen, die Flora und Fauna der genannten Landschaften aus dem Lore-System.

**Es wird nichts gezeichnet und nichts eingefärbt.** V10 ist Text. Einfärben,
Ein-/Austrittsmarker und der Routensimulator brauchen `basis=1` und sind eine eigene Sache
(§9).

---

## 1. Owner-Entscheide dieser Sitzung

| | Entscheid |
|---|---|
| **1** | Die Zeile steht an der **Etappe UND an der Route**. Wörtlich: „es geht nicht nur um Routen, sondern auch um Routensegmente." |
| **2** | Prozent nur, wenn es **nicht** die ganze Etappe ist („ja das is natürlich schöner"). |
| **2a** | 🔴 **Im Planer gar keine Prozente** — „einfach sagen was aufm weg liegt". Die Zahlen bleiben den Infoboxen (§2, §3.1a/b). |
| **2b** | Einleitung **`durch:`** statt „durch den …" — der Artikel ist nicht ableitbar (§3.1b). |
| **2c** | In der Etappen**liste** **nur nennen, was neu ist** („schön!!!"). Aus 31 gleichförmigen Zeilen werden 9 (§3.1c). |
| **3** | 🔴 **„Wald is Wald, egal ob der 'n Namen hat."** Eine namenlose Fläche wird **nicht weggelassen**, sie zeigt ihre **Art**. Siehe §3.2 — dieser Entscheid hat einen früheren Entwurf dieser Spec korrigiert. |
| **4** | Meer/Kontinent/Küste bleiben unsichtbar (`affects_paths = 0`, V9 §4.5). Umkehrbar per Datenzeile plus einem Druck auf „Zugehörigkeit rechnen". |
| **5** | Von den vier Arten von Vorkommen erscheinen **Flora und Fauna** („‚Flora und Fauna‘ is richtig"). Waren wären von allein mitgekommen und werden ausgeschaltet (§6.1). |
| **6** | Die Anteile der Routen-Zeile werden **nicht auf 100 % normiert** („4.3: alles gut") — zwei Drittel der Karte tragen noch keine Flächen, und das soll man sehen dürfen. |

---

## 2. Wo die Zeile steht

> 🔴 **Die Trennlinie, die alles andere ordnet — Owner 2026-07-29:** *„beim routenplaner
> muss kein % dranstehn. einfach sagen was aufm weg liegt … während bei der infosegment
> anzeige %e dranstehen können."*
>
> **Der Planer ist Prosa, die Infobox ist der Beleg.** Vier Flächen, zwei Tonlagen:

| Fläche | Einbaustelle | Zeile | Prozente |
|---|---|---|---|
| **Routen-Zusammenfassung** | `showRoutePlan` (`js/routing/route-plan.js:523`), der `$overview.prepend`-Kasten ab Zeile 597 neben Distanz/Drachenflug/Reisezeit/Rastzeit/Gesamtzeit | `Landschaften   Herz des Kontinents · Seenland · Tommellande · …` | **nein** |
| **Etappen-ZEILE im Planer** | `showRoutePlan`, die `.route-plan-entry`-Zeile ab 561 | `… von Bitani bis Hirschfurt in 8.24 Stunden   durch: Reichsforst` | **nein** |
| **Etappen-Infobox** | `buildRouteLegPopupHtml` (`js/routing/route-plan.js:196`), als fünfte Zeile nach *von / bis / Distanz / Reisezeit* | `Führt durch   Herz des Kontinents · Reichsforst (20 %)` | ja |
| **Weg-Infobox** | `createPathPopupMarkup` (`js/map-features/map-features-path-rendering.js:99`) | dieselbe Zeile, für dieses eine Wegsegment | ja |

Die Flora hängt **nur** unter den beiden Infoboxen — an der Routen-Zusammenfassung wären es
elf Landschaften auf einmal (§6).

---

## 3. Die Regeln der Zeile

### 3.1 Aufbau — überall gleich

- **Nach Anteil sortiert**, das Größte zuerst. Auch dort, wo der Anteil nicht gedruckt
  wird: er entscheidet weiter die Reihenfolge.
- **Unter 5 % weggelassen.** Die Schwelle ist am Livebestand geeicht und die Kurve ist dort
  flach: 5 % verwirft 274 von 3.995 Treffern (6,9 %), 3 % verwürfe 167, 10 % verwürfe 426.
  Es gibt keine Kante, an der die Wahl kippt — deshalb der runde Wert.
- **Die Art ist der Titel-Tooltip** jedes Namens („Finsterkamm" → *Gebirge*). Sie reist
  ohnehin mit und beantwortet die Beispielfrage des Owners („führt der Weg durch ein
  Gebirge"), ohne die Zeile zu verlängern.

### 3.1a Nur in den Infoboxen: die Prozente

- **Ab 90 % ohne Zahl.** Der Median-Anteil ist **100 %** (§4.2) — ohne diese Regel stünde
  in der Mehrzahl aller Zeilen „(100 %)", und die Zahl trüge keine Information mehr.
- **Trenner `·`**, kein Komma: die Namen sind keine Aufzählung eines Ganzen (§3.3), und
  zwischen „Name (68 %)"-Einträgen läge ein Komma zu dicht an der Klammer.

### 3.1b Nur im Planer: `durch:` und Kommas

- Einleitung **`durch:`** — mit Doppelpunkt, ohne Artikel.
- **Trenner `,`**: hier stehen blanke Namen, und die lesen sich als Aufzählung.

> 💣 **Der Artikel ist nicht ableitbar, und ein geratener wäre sichtbar falsches Deutsch.**
> Der Owner hatte „durch **den** Reichsforst" vorgeschlagen — richtig, aber der Artikel
> hängt am Geschlecht des Namens, und das steht in keinem Feld: *das* Herz des Kontinents,
> *die* Flusslande, *die* Koschberge, *der* Farindelwald — und **Weiden** ganz ohne. Es
> gibt keine Regel, die das aus dem Namen holt, und rund ein Drittel der Namen bekäme den
> falschen. Der Doppelpunkt macht aus dem Satz eine Beschriftung; dann wird keiner
> erwartet. (Owner 2026-07-29: „äh ja artikel geht nicht, machs mit durch: …")
>
> Wer das je ändern will, braucht ein **Feld an der Region** („der/die/das/—"), von Hand
> gefüllt für heute 137 und künftig mehrere hundert Namen. Das ist eine Datenaufgabe, keine
> Anzeigeentscheidung — und es ist nicht V10.

### 3.1c 🔴 Nur in der Etappen**liste**: nur nennen, was neu ist

Eine Etappenzeile nennt **nur die Landschaften, die in der Zeile davor noch nicht standen**.
Der Plan liest sich dann wie eine Reise: der Name steht da, wo man die Landschaft betritt,
und schweigt, solange man drin bleibt.

Gemessen an Gareth → Thorwal (45 Etappen, 31 mit Daten):

| | Zeilen mit Text | Nennungen |
|---|---|---|
| jede Zeile die volle Wahrheit | 31 | 53 |
| **nur was neu ist** | **9** | **12** |

Ohne die Regel stünden **16 der 31 Zeilen wortgleich unter ihrer Vorgängerin** — die
Reichsstraße läuft sieben Etappen am Stück durchs Herz des Kontinents.

**Ein Wiedereintritt wird wieder genannt.** „Tommellande" steht auf dieser Route zweimal,
weil die Route sie zwischendurch verlässt. Das ist richtig: V9 §9.0 hat nachgemessen, dass
die Lücken zwischen zwei Durchquerungen im Median **2,09 Meilen** betragen — echte
Geographie, kein Zittern, das man wegglätten dürfte.

> 💣 **Eine Etappe OHNE Daten setzt das Gedächtnis NICHT zurück.** Sie wird übersprungen,
> die nächste vergleicht sich weiter mit der letzten Zeile, die etwas wusste. Grund: nur
> **34,3 %** der Wegstrecke liegt überhaupt in einer Fläche (§4.1) — „leer" heißt hier fast
> immer *noch nicht gezeichnet*, nicht *draußen*. Ein Zurücksetzen machte aus einer Lücke
> im Bestand eine Ankündigung („du betrittst das Herz des Kontinents"), die nie stattfand.
> Auf dieser Route ergeben beide Regeln **dasselbe Ergebnis** (0 Unterschied) — die Wahl
> ist heute folgenlos und morgen nicht, sobald mehr gezeichnet ist.

**Die Infoboxen machen das NICHT mit.** Sie zeigen immer die volle Wahrheit dieser einen
Etappe, mit Prozenten. Genau dafür sind sie da: die Liste ist die Erzählung, die Infobox
der Beleg. Wer mitten in die Liste springt und wissen will, wo er ist, klickt die Zeile an.

### 3.2 🔴 Name, sonst Art — die Hausregel, nicht eine neue

Ein auto-benannter Bereich heißt intern `Wald-001`. Das ist **kein Anzeigename**, und das
Haus weiß das bereits: `ecosystemRegionDisplayName(name, artLabel)`
(`js/map-features/map-features-ecosystem-naming.js:81`) liefert „Wald". Die Datei sagt es
wörtlich: *„Ein Auto-Name ist interne Buchführung und darf nie nach aussen dringen — statt
`Wald-001` bekommt er `Wald`."*

**V10 ruft diese Funktion auf und baut die Regel nicht nach.** Sie ist in `index.html`
Zeile 2168 geladen, also lange vor `path-rendering` (2226), `route-plan` (2274) und
`lore` (2288).

> 💣 **Ein früherer Entwurf dieser Spec wollte namenlose Flächen wegwerfen** — mit der
> Begründung, nur 17 Wege im ganzen Bestand verlören dadurch ihre einzige Aussage. Der
> Owner hat das kassiert: *„Wald is Wald, egal ob der 'n Namen hat."* Er hat recht, und
> die Zahl war die falsche Frage. Ob eine Etappe ihre *einzige* Aussage verliert, ist
> nicht das Maß; das Maß ist, ob die Zeile **wahr** ist. „Weiden" statt „Weiden ·
> Finsterkamm (84 %) · See (13 %)" verschweigt zwei Tatsachen, die in den Daten stehen.
>
> Die Lehre ist allgemeiner: **eine Hausregel wurde durch eine Statistik überstimmt.** Die
> Regel stand fertig und kommentiert im Repository; die Statistik beantwortete eine Frage,
> die niemand gestellt hatte.

**Wirklich weg** ist nur, wer **weder Name noch Art** hat (`Fläche-011`): 395 der 3.995
Treffer. Da gibt es buchstäblich nichts zu drucken.

| | Treffer |
|---|---|
| mit echtem Namen | 3.556 |
| als blosse Art (`Insel` 15, `See` 23, `Wald` 6) | 44 |
| ohne beides → weg | 395 |

**Zusammenfassen bei Namensgleichheit.** Zwei namenlose Seen an einer Etappe ergäben
„See · See". Gleiche Anzeigenamen werden zu **einem** Eintrag verschmolzen, die gedeckten
Längen addiert, der Anteil bei 100 % gekappt. Live: **9 solche Fälle**.

### 3.3 💣 Die Prozente summieren sich NICHT auf 100 — und das ist kein Fehler

Das Beispiel im Auftakt („Farindelwald (62 %), Winhaller Land (38 %)") liest sich wie eine
Aufteilung. Die Daten sind keine. Landschaften liegen in **drei sich überlagernden
Ebenen**:

| `kind` | Flächen | Beispiele |
|---|---|---|
| `derographisch` | 277 | Weiden, Almada, Darpatien, Herz des Kontinents |
| `topographie` | 355 | Gebirge, See, Insel, Meer, Küste |
| `vegetation` | 50 | Wald, Steppe, Sümpfe, Wüste |

Eine Etappe kann **gleichzeitig** zu 100 % in Darpatien und zu 68 % im Reichsforst liegen.
Gemessene Zeilen:

```
Führt durch: Streitende Königreiche (100 %), Orklandsteppe (100 %)
Führt durch: Herz des Kontinents (100 %), Reichsforst (68 %)
```

Jede Zahl ist **der Anteil DIESER Etappe an DIESER Landschaft**, unabhängig von den
anderen. Wer sie als Aufteilung liest, liest falsch — deshalb der Trenner `·` und nicht
`,`, und deshalb steht die Art im Tooltip.

> 🔴 **Die drei Ebenen werden NICHT getrennt ausgewiesen.** Ich hatte das angeboten
> („Region: Darpatien / Landschaft: Reichsforst (68 %)"); der Owner hat die gemischte Liste
> gewählt. Sie kostet eine Zeile statt zweier in einer Infobox, die schon vier hat.

### 3.4 Was der Besucher am Ende sieht — gemessene Beispiele, keine erfundenen

**In den Infoboxen** (volle Wahrheit, mit Prozenten):

```
Führt durch: Weiden
Führt durch: Darpatien · Sichelhag
Führt durch: Herz des Kontinents · Reichsforst (20 %)
Führt durch: Weiden · Finsterkamm (84 %) · See (13 %)
Führt durch: Trollzacken (42 %) · Darpatien (30 %) · Ochsenwasser (18 %)
```

**In der Etappenliste des Planers** (nur was neu ist, ohne Prozente) — echte Zeilen aus
Gareth → Thorwal:

```
Reichsstraße … von Weyring bis Randersburg      durch: Herz des Kontinents
Reichsstraße … von Hornbach bis Randersburg
Reichsstraße … von Kreuzung-1545 bis Hirschfurt
Reichsstraße … von Hirschfurt bis Bitani        durch: Reichsforst
Reichsstraße … von Leustein bis Steinbrücken    durch: Flusslande
Reichsstraße … von Kammhütten bis Trottweiher   durch: Koschberge
Reichsstraße … von Koschwacht bis Gratenfels    durch: Gratenfelser Becken, Tommellande
```

---

## 4. Mengengerüst — live gemessen, nicht geschätzt

Gemessen **2026-07-29** gegen den Livebestand (`ecosystem_revision` **3890**,
`map_revision` **46238**): je eine Anfrage an `GET /api/app/ecosystem-areas.php`,
`GET /api/app/map-features.php` und `POST /api/route/`, danach offline nachgerechnet mit
dem **ausgelieferten V9-Kern** (`js/map-features/map-features-ecosystem-path-assign.js`,
in Node geladen).

**Gegenprobe:** der Nachbau liefert 3.995 Paare / 4.635 Zeilen bei `basis=0`. V9 maß bei
`ecosystem_revision` 3082 3.829 / 4.426. Der Bestand ist seither gewachsen (609 → 645
mitrechnende Flächen), die Größenordnung stimmt — der Nachbau ist der richtige.

### 4.1 Wieviel überhaupt etwas zeigt

| | |
|---|---|
| Wege gesamt | 5.655 |
| davon mit mindestens einer Fläche | 2.842 |
| davon mit einer **anzeigbaren** Zeile (nach §3) | ~2.700 |
| **Anteil der Wegstrecke, der in irgendeiner Fläche liegt** | **34,3 %** |

> ⚠️ **Über die Hälfte aller Etappen zeigt heute gar nichts** — und das ist richtig so. Die
> Karte ist erst zu einem Drittel mit Flächen belegt (V9 §3.2: Zielstand ~937 Flächen
> gegenüber 682 heute). Die Zeile entfällt dann ersatzlos; es steht kein „unbekannt" da.

### 4.2 Die Verteilung, aus der die Regeln folgen

| Anteil je (Weg × Landschaft), n = 3.995 | |
|---|---|
| p05 | 3,7 % |
| p10 | 8,7 % |
| p25 | 54,9 % |
| **p50** | **100 %** |
| p75 / p90 | 100 % |

| Namen je Etappe (nach §3) | Etappen |
|---|---|
| 1 | 1.898 |
| 2 | 543 |
| 3 | 83 |
| 4 | 9 |

**Drei Viertel aller Zeilen tragen genau einen Namen**, das Maximum sind vier. Die Zeile
wird nicht lang.

### 4.3 Eine echte Route, ganz durchgerechnet

Gareth → Thorwal über `POST /api/route/`, 45 Etappen, 31 davon mit Zeile:

```
Reichsstrasse   10.4   Führt durch: Herz des Kontinents · Reichsforst (20 %)
Reichsstrasse    3.7   Führt durch: Herz des Kontinents (53 %)
Reichsstrasse    5.6   Führt durch: Flusslande (29 %)
Reichsstrasse   11.0   Führt durch: Flusslande
```

Und aggregiert über die **Gesamtstrecke** — das ist die Routen-Zeile. Sortiert nach Anteil,
gedruckt ohne ihn (§3.1b):

```
Landschaften   Herz des Kontinents · Seenland · Tommellande · Streitende Königreiche ·
               Winhaller Land · Gratenfelser Becken · Flusslande · Koschberge ·
               Farindelwald · Honinger Land · Reichsforst
```

> ⭐ **Die Reihenfolge ist die ganze Information, die die Prozente sonst trügen** — und sie
> bleibt erhalten, auch wenn die Zahl nicht dasteht. Zur Einordnung, was hinter dieser
> Sortierung steckt: 16 % / 14 % / 13 % / 8 % / 8 % / 6 % / 4 % / 3 % / 2 % / 2 % / 1 %.

Die Anteile summieren sich auf **77 %**, nicht auf 100 — zwei Drittel der Karte tragen noch
keine Flächen (§4.1). **Das wird nicht kaschiert** (Owner 2026-07-29: „4.3: alles gut") —
keine Restzeile „sonstiges", keine Normierung. Eine normierte Zahl behauptete
Vollständigkeit, die es nicht gibt; eine bloße Namensliste behauptet sie gar nicht erst.

---

## 5. Woher die Daten kommen

### 5.1 🔴 Der Befund, der die Architektur trägt: eine Etappe ist ein GANZER Weg

Der Auftakt fürchtete, ein Routen-Teilstück gegen die gespeicherten Intervalle schneiden zu
müssen. **Das ist nicht nötig.** Nachgelesen:

- `getRouteSegments` (`js/routing/route-engine.js:1`) sucht das Segment über
  `properties.id` aus `pathData` — also die **ganze** `map_features`-Zeile.
- `addRegularPathToGraph` (`js/routing/route-graph-routing.js:109`) legt je Weg **genau
  eine** Kante an, von Endpunkt zu Endpunkt. Es gibt keine Teilkante.
- `properties.id` **ist** die `public_id` (`api/app/map-features.php:399`).

Damit ist die Zuordnung ein reines Nachschlagen: Weg-`public_id` → gespeicherte Zeilen.
Kein Zuschneiden, kein Interpolieren.

> ⭐ **Und die Richtungsfalle greift hier gar nicht.** Der Auftakt nennt sie als Falle 1:
> Intervalle stehen in Zeichenrichtung, eine Route kann rückwärts fahren. Für einen
> **Anteil** ist das gleichgültig — `SUM(exit − enter)` ist richtungsblind. Die Falle
> bleibt scharf für alles **Verortete** (Einfärben, Marker, Simulator) und steht dort
> weiter in V9 §9.0.

### 5.2 Der Lese-Endpunkt

```
POST /api/app/path-landscapes.php
  Anfrage:  { "paths": ["<public_id>", …] }            (max. 400)
  Antwort:  { ok:true,
              payload_version: 1,
              stamp: { computed_at, ecosystem_revision, map_revision, stale:bool } | null,
              landscapes: { "<region_public_id>": { name, art, kind, wiki_key, wiki_url } },
              paths:      { "<path_public_id>":   { length: 12.3456,
                                                    in: [ ["<region_public_id>", 4.2100], … ] } } }
```

- **`basis = 0`, die Sehne.** Das ist das Maß, in dem auch die Etappenlängen stehen
  (`calculatePathCoordinateDistance`, `getCoordinateDistance` summieren `hypot` über die
  **gespeicherten** Stützpunkte). `basis = 1` ist die gezeichnete Kurve und für eine
  Anteilsrechnung das falsche Maßsystem — dieselbe Falle wie die ×3-/×23-Einheitenfalle,
  nur leiser (V9 §5.2).
- **Namenskatalog getrennt von den Zuordnungen.** „Weiden" berührt 675 Wege; ohne die
  Trennung stünde der Name 675-mal im Payload. Gemessen für Gareth → Thorwal: **~2 KB**
  für 45 Etappen.
- **Rohe Werte, keine fertigen Prozente.** Der Server liefert `length` und die gedeckte
  Länge; Schwelle, Sortierung und die 90-%-Regel sind **Anzeigepolitik** und gehören dorthin,
  wo die Anzeige steht. Ein Server, der schon 5 % weggeworfen hat, kann die Routen-Summe
  nicht mehr richtig bilden — dort zählt eine Landschaft, die auf jeder einzelnen Etappe
  unter der Schwelle liegt, in der Summe womöglich sichtbar mit.
- **`name` und `art` reisen ROH**, nicht als fertiger Anzeigename. Die Auswahlregel ist
  `ecosystemRegionDisplayName` und existiert in JavaScript (§3.2). Sie in PHP nachzubauen
  wäre eine **zweite Umsetzung derselben Regel** — genau der Fehler, den dieses Haus beim
  Quellensystem schon einmal bezahlt hat.
- **POST, nicht GET.** 45 Wege sind 1,6 KB Adresszeile; lange Routen sprengen sie. `POST
  /api/route/` ist der Präzedenzfall im selben Haus. Kein ETag, keine Zwischenspeicherung
  auf der Leitung — der Client hält den Speicher (§5.3).
- **Über 400 Wege stückelt der CLIENT**, der Server lehnt ab. Eine Route mit mehr als 400
  Etappen ist heute nicht in Sicht (die längste gemessene hat 45), aber die Obergrenze darf
  nicht als stiller Abschnitt wirken: der Server antwortet `400 too_many_paths`, und der
  Client teilt vorher in Blöcke. **Nie abschneiden** — eine halb beantwortete Zeile sieht
  aus wie eine vollständige.
- **`api/app/`, öffentlich** — V10 ist eine Besucher-Ansicht. Kein Auth, `avesmapsApplyCorsPolicy`
  wie bei `lore.php`, Gold-Envelope.
- **Kein DDL**, keine `information_schema`-Sonde. Fehlt `path_ecosystem`, ist die Antwort
  leer und die Zeile entfällt. (Der Endpunkt ist ein **Leser**; die Tabellen entstehen im
  Editor-Schreibpfad.)
- **Name:** `path-landscapes.php`, nicht `path-ecosystem.php` — unter letzterem liegt
  bereits die Schreib-Bibliothek in `api/_internal/app/`, und zwei Dateien gleichen Namens
  in einem Haus mit Server↔Repo-Drift sind eine Falle ohne Gegenwert.

### 5.3 Wann geholt wird — und die eine Abweichung vom Auftakt

| Lage | Abruf |
|---|---|
| **Eine Route wird angezeigt** | **einmal, sofort**, für alle Wege der Route |
| **Eine Weg-Infobox geht auf** (Kartenklick, keine Route) | einmal für diesen Weg, **über den DOM-Beobachter** |
| zweite Etappen-Infobox derselben Route | **gar nicht** — steht schon im Speicher |

> 🔴 **Abweichung vom Auftakt, mit Grund.** Der Auftakt sagt „faul, beim ERSTEN Aufklappen
> — nie beim Markup-Bau". Für die Routen-Zusammenfassung geht das nicht: sie ist sofort
> sichtbar, ein fauler Abruf hätte keinen Auslöser. Also wird **beim Zeichnen der Route**
> geholt — und das ist **kein** Markup-Bau, sondern eine Nutzeraktion, die genau einmal
> stattfindet. Das Ergebnis ist **strenger** als der Auftakt verlangte: eine Anfrage je
> Route statt einer je aufgeklapptem Popup, und die Etappen-Infoboxen holen danach gar
> nichts mehr.
>
> 💣 **Für die Weg-Infobox bleibt die Regel des Auftakts wörtlich bestehen.** Popup-Markup
> wird in diesem Haus **für jeden Weg beim Kartenaufbau** gebaut (`bindPopup` mit fertigem
> HTML) — ein `fetch` an dieser Stelle wären 5.655 gleichzeitige Anfragen. Das ist der
> Pool-Vorfall vom 2026-07-21, Wort für Wort. Deshalb dort: leerer, markierter Container,
> gefüllt durch denselben DOM-Beobachter, den `map-features-lore.js:365` schon betreibt.

### 5.4 Zwischenspeicher

Je **Weg-`public_id`** im Speicher, nicht je Route: zwei Routen über dieselbe Reichsstraße
holen sie einmal. Der Speicher wird verworfen, wenn `map_revision` oder
`ecosystem_revision` im Stempel wechselt. Kein `localStorage` — der Bestand ändert sich mit
jedem Editorlauf, und ein Tag alter Schnappschuss auf der Platte wäre schlechter als ein
frischer Abruf von 2 KB.

### 5.5 💣 Gespeichert heißt Schnappschuss

Die Zeile stammt aus dem, was „Zugehörigkeit rechnen" **zuletzt** gespeichert hat. Wird
eine Fläche neu gezeichnet, ändert sich die Zeile erst nach dem nächsten Knopfdruck. Der
Endpunkt liefert den Stempel samt `stale`-Vergleich mit; **dem Besucher wird er nicht
gezeigt** — er hätte nichts davon. Er existiert, damit die Frage „warum steht da das
Alte?" eine Antwort hat, ohne dass jemand raten muss.

Ist gar nichts gerechnet (`stamp = null`), ist die Antwort leer und keine Zeile erscheint.
Das ist derselbe Zustand wie „diese Etappe berührt keine Fläche" — und richtig so, denn
beides heißt: *wir haben nichts zu sagen.*

---

## 6. Flora und Fauna — die Vorkommen der genannten Landschaften

Unter der „Führt durch"-Zeile der **Etappen-** und der **Weg-Infobox**, nicht an der Route.

### 6.1 🔴 Genau zwei Zeilen: Flora und Fauna

Das Lore-System führt vier Arten von Vorkommen. Was davon hier erscheint, ist ein
Owner-Entscheid, kein Vorgabewert:

| Art | an der Etappe | warum |
|---|---|---|
| **Flora** | ✅ | Owner 2026-07-29: „Flora und Fauna ist richtig" |
| **Fauna** | ✅ | dieselbe Antwort |
| **Waren** | ❌ | käme sonst **von allein mit** — `AVESMAPS_LORE_ROWS` führt sie an erster Stelle |
| **Spezies** | ❌ | öffentlich ohnehin abgeschaltet (2026-07-21): das Feld „Regionen" der `{{Infobox Spezies}}` ist im Wiki zu schlecht gepflegt |

**Gemessen** an `GET /api/app/lore.php?place=herz-des-kontinents,reichsforst` (eine
Anfrage, beide Landschaften einer echten Etappe): 11 Flora, 6 Fauna, **12 Waren**,
0 Spezies — Blautanne, Blutulme, Elbenkastanie, Waldwolf, Griswolf,
Ikanariaschmetterling … und eben auch Garether Bier und Eichstätter Weizen. Alle mit
`rank 0`, also direkt an der Landschaft hängend, nicht aus einem Obergebiet geerbt.

> 💣 **`AVESMAPS_LORE_ROWS` wird NICHT angefasst.** Die Liste steht auf Modulebene
> (`map-features-lore.js:213`) und speist **auch die Siedlungs-Infobox** — wer die Waren
> dort herausnimmt, nimmt sie überall heraus, und niemand sieht den Zusammenhang. Die
> Auswahl gehört an den **Container**: ein `data-lore-kinds="flora|fauna"`, das
> `avesmapsLoreFillContainers` liest und das ohne Angabe alle Zeilen bedeutet. Vier Zeilen
> Änderung, kein zweiter Renderer, und die Siedlung bleibt unberührt.

### 6.2 Ein Abruf für alle Landschaften der Etappe

`api/app/lore.php` nimmt Kommalisten bereits entgegen (`?place=darpatien,reichsforst`,
Zeile 170), und `avesmapsLoreFetch` reicht sie schon durch („Mehrere Schlüssel werden
kommagetrennt übergeben"). **Nur `avesmapsLoreNormalizeKey` wirft sie heute weg** — die
Zeichenklasse `^[a-z0-9_-]{1,190}$` kennt kein Komma. Das ist die ganze Änderung: an Kommas
teilen, jeden Teilschlüssel einzeln prüfen, leere verwerfen, wieder zusammensetzen.

- **116 der 177** vom Wegenetz erreichbaren Regionen haben einen `wiki_region_key`; die
  übrigen liefern nichts, und der Abschnitt entfällt dann still (heutiges Verhalten).
- **Über den DOM-Beobachter**, unverändert. `buildLoreMarkup` liefert sofort den leeren
  Container; V10 füllt nur dessen `data-lore-fetch` mit der Kommaliste und setzt
  `data-lore-kinds`.
- **Keine Handelswaren-Freitextliste** (`data-lore-goods`): die kommt aus dem Infobox-Feld
  einer Siedlung, und eine Etappe hat keines. Leer lassen, nicht erfinden.

---

## 7. Der Bauplan im Code

| | |
|---|---|
| **neu** `js/map-features/map-features-path-landscapes.js` | Abruf, Speicher, und der **reine** Zeilenbauer |
| **neu** `api/app/path-landscapes.php` | der Lese-Endpunkt (§5.2) |
| **neu** `api/_internal/app/path-landscapes.php` | die Abfrage, offline entscheidbar getrennt |
| `js/routing/route-plan.js` | Zeile in `buildRouteLegPopupHtml`, `durch:`-Anhang an der Etappenzeile (560), Zeile im Zusammenfassungskasten (597), Abruf beim Zeichnen |
| `js/map-features/map-features-path-rendering.js` | Zeile in `createPathPopupMarkup` (Container + Beobachter) |
| `js/map-features/map-features-lore.js` | `avesmapsLoreNormalizeKey` lässt Kommalisten durch; `avesmapsLoreFillContainers` liest `data-lore-kinds` (§6.1) |
| `index.html` | ein `<script>`, **nach** `map-features-ecosystem-naming.js` (2168) und **vor** `path-rendering` (2226) |

> 🔴 **Der Zeilenbauer ist rein und kennt keine Route.** Signatur:
> `buildLandscapeLine(pathIds, catalogue)` → `[{ name, art, share }, …]`, sortiert und
> gefiltert nach §3.1, **ohne jede Formatierung**. **Dieselbe Funktion speist alle vier
> Flächen**: die Etappe ruft sie mit einem Weg, die Route mit fünfundvierzig, die
> Weg-Infobox mit einem. Ein zweiter Bauer für „die Route" wäre dieselbe Mathematik zum
> zweiten Mal — genau die Regel, die V9 §5 für seinen Kern aufgestellt hat, eine Ebene
> höher.
>
> Darüber liegen **drei dünne Schreiber**, und nur sie kennen Prozente, Trenner und
> Doppelpunkt: `formatLandscapesForInfobox(list)` (§3.1a), `formatLandscapesForPlanner(list)`
> (§3.1b) und `pickFreshLandscapes(list, previousList)` (§3.1c). Die Trennung ist der Grund,
> warum „im Planer ohne Prozente" **keine** zweite Rechnung ist, sondern ein anderer Satz
> derselben Liste.
>
> ⚠️ **Gewichtet wird durchgehend mit der `length` aus dem Endpunkt, nie mit
> `entry.distance` aus dem Planer.** Beide sind proportional (`DISTANCE_SCALING_FACTOR`),
> die Anteile kämen gleich heraus — aber nur, solange sie es sind. Eine Etappe, die der
> Planer als Wasser-Aggregat aus mehreren Wegen zusammenfasst, hat **eine** Distanz und
> **mehrere** `length`-Werte; wer dort mischt, verrechnet Meilen mit Karteneinheiten.
> Deshalb nimmt der Bauer nur Weg-Kennungen entgegen und holt sich die Längen selbst.

> ⚠️ **Ein neues `<script>` in `index.html` betrifft die Testgerüste.** V9 hat sechs davon
> repariert, weil sie die Ladereihenfolge von `index.html` nachbilden (`c914234b`,
> `15af1250`). Wer hier eine Datei einfügt, prüft sie mit.

---

## 8. Nachweis

### 8.1 Unit-Tests — `js/map-features/__tests__/path-landscapes.test.js`

**Der Bauer** (`buildLandscapeLine`):

| Fall | Erwartung |
|---|---|
| ein Weg, eine Fläche über die volle Länge | ein Eintrag, `share = 1` |
| Anteil 0,04 | fällt weg (5-%-Schwelle) |
| zwei Flächen, 0,62 und 0,38 | absteigend sortiert |
| Fläche `Wald-001`, Art „Wald" | Anzeigename **„Wald"** |
| Fläche `Fläche-011`, keine Art | fällt weg |
| zwei namenlose Seen, 0,3 und 0,2 | **ein** Eintrag „See", `share = 0,5` |
| Summe der gedeckten Länge > Gesamtlänge (Rundung) | bei 1,0 gekappt |
| Route: 45 Wege, Gewichtung nach Weglänge | Anteil an der **Gesamt**strecke |
| Etappe aus **mehreren** Wegen (Wasser-Aggregat) | Anteil an der Summe ihrer Weglängen |
| Weg ohne Zuordnung | leere Liste, **kein** Fehler |
| leerer Katalog / fehlende `landscapes`-Zeile | Eintrag übersprungen, kein Absturz |

**Die Schreiber** (§3.1a/b/c):

| Fall | Erwartung |
|---|---|
| Infobox, `share = 1` | „Weiden", **ohne** Prozentangabe |
| Infobox, `share = 0,68` | „Weiden (68 %)" |
| Infobox, `share = 0,93` | ohne Zahl (90-%-Regel) |
| Infobox, zwei Einträge | Trenner `·` |
| Planer, zwei Einträge | `durch: A, B` — **nie** eine Prozentangabe, **nie** ein Artikel |
| Etappenliste, Vorgängerin nannte dieselben Namen | **leer** |
| Etappenliste, ein Name kommt hinzu | **nur** der neue |
| Etappenliste, Vorgängerin ohne Daten | Vergleich gegen die letzte Zeile **mit** Daten |
| Etappenliste, erste Zeile | alle Namen |
| Etappenliste, Name kehrt nach einer Unterbrechung zurück | **wieder genannt** (Wiedereintritt) |

**Der Lore-Schlüssel** (`js/map-features/__tests__/lore-key.test.js`, §6):

| Fall | Erwartung |
|---|---|
| `"darpatien,reichsforst"` | bleibt erhalten |
| `"darpatien, reichsforst"` (mit Leerzeichen) | getrimmt, bleibt erhalten |
| `"darpatien,,"` | `"darpatien"` |
| `"darpatien,<script>"` | `"darpatien"` — der schlechte Teil fällt, der gute bleibt |
| `"<script>"` | `""` |
| `"wiki:darpatien"` | Präfix weiter abgeschnitten (heutiges Verhalten) |
| Container **ohne** `data-lore-kinds` | alle Zeilen — die Siedlungs-Infobox ändert sich nicht |
| Container mit `data-lore-kinds="flora\|fauna"` | genau zwei Zeilen, **keine** Waren |

### 8.2 PHP-Tests — `api/_internal/app/__tests__/path-landscapes-test.php`

(`php -d extension=mbstring -d zend.assertions=1` — **ohne `zend.assertions=1` prüft
`assert()` nichts**.)

| Fall | Erwartung |
|---|---|
| leere `paths`-Liste | 400 `paths_required` |
| mehr als 400 Wege | 400 `too_many_paths` |
| unbekannte `public_id` | fehlt in `paths`, **kein** Fehler |
| `public_id` mit Unsinn-Zeichen | verworfen, nicht abgefragt |
| kein Stempel | `stamp: null`, `paths: {}` |
| Stempel älter als `ecosystem_revision` | `stale: true` |

### 8.3 Abnahme am Livebestand

1. **Gareth → Thorwal** im Planer: die Routen-Zeile nennt in dieser Reihenfolge Herz des
   Kontinents, Seenland, Tommellande, Streitende Königreiche, Winhaller Land, Gratenfelser
   Becken, Flusslande, Koschberge, Farindelwald, Honinger Land, Reichsforst — **elf Namen,
   keine Prozente** (§4.3).
2. **Dieselbe Route, Etappenliste**: **9** der 45 Zeilen tragen ein `durch:`, mit
   **12** Nennungen — und keine zwei aufeinanderfolgenden Zeilen sind wortgleich (§3.1c).
   „Tommellande" steht zweimal, weil die Route sie zwischendurch verlässt.
3. **Eine Etappe anklicken**: „Führt durch" steht als fünfte Zeile der Infobox — dort
   **mit** Prozenten und **vollständig**, auch wenn die Listenzeile schwieg. Darunter
   **Flora und Fauna, keine Waren** — und **eine** Anfrage an `lore.php` für beide
   Landschaften zusammen, nicht zwei.
4. **Eine Siedlung anklicken** (Gegenprobe): ihre Infobox zeigt weiterhin **Waren, Fauna,
   Flora** wie bisher. Die Auswahl an der Etappe darf sie nicht mitgenommen haben (§6.1).
5. **Netzwerk-Register**: für die ganze Route **genau eine** Anfrage an
   `path-landscapes.php`. Ein zweites geöffnetes Etappen-Popup erzeugt **keine**.
6. **Kartenaufbau ohne Route**: **null** Anfragen an `path-landscapes.php`.
7. **Einen Weg auf der Karte anklicken**: eine Anfrage, danach keine mehr für denselben Weg.

> ⚠️ **Vor der Abnahme neu zählen.** Die Zahlen in §4 stehen gegen
> `ecosystem_revision` 3890 / `map_revision` 46238. Der Bestand wächst täglich; das ist ein
> Abgleich gegen eine nachgerechnete Nutzlast, nicht gegen eine Konstante.

---

## 9. Abgrenzung

| | wohin | warum nicht hier |
|---|---|---|
| Streckenabschnitt einfärben, Ein-/Austrittsmarker | später | braucht `basis = 1` (die gezeichnete Kurve). Mit Sehnen-Werten läge der Punkt im Median 1,3 px, im p90 10,8 px daneben (V9 §4.1b). V10 zeigt keine Orte, nur Anteile — dafür ist die Sehne richtig. |
| Routensimulator („ihr betretet den Farindelwald") | eigene Sache | `basis = 1`, plus die Richtungsfalle und die Wiedereintrittsfrage (V9 §9.0) |
| Meer / Kontinent / Küste | Datenzeile | `affects_paths = 0`; „führt durch Aventurien" gilt für jede Route und kostete 90 % des Rechenlaufs |
| Steigung, Tempofaktoren, Kantengewichte | **V11** | braucht das Höhenfeld; V10 ist Anzeige, nicht Routing |
| Änderungen an Graph oder Routing | — | V10 fasst weder `client-graph.php` noch `route-graph-*.js` an |
| Landschaften in die Kartennutzlast | — | +1,3 MB für jeden Besucher, ob er routet oder nicht (Auftakt §2) |
| Neuberechnung bei jeder Flächenänderung | später, falls überhaupt | der Stempel macht „veraltet" sichtbar; das genügt |

---

## 10. Aufwand und Risiko

| | |
|---|---|
| Zeilenbauer + drei Schreiber + Speicher + Abruf (JS) | ~220 Zeilen |
| Endpunkt + Abfrage (PHP) | ~150 Zeilen |
| Vier Einbaustellen | ~80 Zeilen |
| Kommalisten im Lore-Schlüssel | ~8 Zeilen |
| Tests | ~260 Zeilen |
| **Risiko** | **gering.** Die Daten liegen, der Kern ist abgenommen, die Zuordnung ist ein Nachschlagen (§5.1). Der einzige scharfe Punkt ist die Abrufstelle: eine Zeile am falschen Ort baut den Pool-Vorfall nach. Abnahmeschritte 4–6 prüfen genau das. |
