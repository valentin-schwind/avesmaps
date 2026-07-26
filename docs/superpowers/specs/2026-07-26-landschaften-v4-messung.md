# Landschaften V4 — Messung und Entscheidungsgrundlage

**Stand:** 2026-07-26. Gemessen gegen `origin/master` = `4d06db8d` (enthält `ea27cf1a`,
den Abschluss von V3.6). Plan: `docs/superpowers/plans/2026-07-24-landschaften.md`.

> **Wozu dieses Dokument.** V4 schreibt keinen Code. Es ist die Stufe, die entscheidet,
> ob V5–V15 überhaupt gebaut werden. Alles hängt an zwei Zahlen: was eine fertige
> Landschaftsfläche von Hand kostet (Durchgang A) und was das Übernehmen per
> „Senden an …" davon einspart (Durchgang B). Dieses Dokument hält die vier
> Vorabmessungen fest, stellt das Protokoll für A und B bereit und rechnet die
> Hochrechnung vor, damit die gemessenen Zeiten ohne Zwischenschritt einsortierbar sind.

**Was hier gemessen ist und was noch fehlt:**

| | Zustand |
|---|---|
| Vorabmessung 1 — Graphgröße | ✅ gemessen |
| Vorabmessung 2 — Engine-Abweichung | ✅ gemessen |
| Vorabmessung 3 — `revision` bei einem Flächen-Save | ✅ statisch bewiesen + Leerlauf-Grundlinie aufgenommen; die Save-Probe steht beim Owner |
| Vorabmessung 4 — Querfeldein-Strecken | ✅ gemessen |
| Durchgang A / B (2 × 10 Flächen) | 🔧 **DU (Owner)** — Protokoll unten |
| Erprobungs-Entscheidung `promote_trial` | 🔧 **DU (Owner)** — erst nachdem A und B im Dokument stehen |

---

## 0. Methodik — warum keine Diagnose-Endpunkte angefasst wurden

Globale Regel 10 des Plans verbietet alle sechs `?diagnostic=`-Zweige. Der V4-Text
schlug für die Graphgröße trotzdem „eingeloggt **ein** Aufruf von `?diagnostic=graph-data`"
vor. Das widerspricht der Regel desselben Plans, und die Regel gewinnt: `graph-data` löst
acht Graphbauten aus, 11,3 s bei 10.000 Knoten, und ist die Signatur des Pool-Vorfalls vom
2026-07-17.

Der Ausweg war weder der Diagnose-Zweig noch `SELECT COUNT(*)` (das zählt Tabellenzeilen,
nicht Graphkanten — die Aufteilung an Innenknoten sieht SQL nicht):

1. **Eine** gewöhnliche Leseanfrage `GET /api/app/map-features.php` (29.743.396 B),
   lokal abgelegt. Sie liefert zugleich den ETag für Vorabmessung 3 und die
   Landschafts-Labels für die Kandidatenliste.
2. **Ein** gewöhnlicher `POST /api/route/` — der stabile Vertragsendpunkt. Er trägt
   `route.debug.context.client_graph_statistics` **im regulären Antwortkörper**
   (`api/_internal/routing/response.php:204`, `:231`), also Knotenzahl,
   `path_feature_count` und `synthetic_connection_count`, ohne jeden Diagnose-Zweig.
3. Der Graph wurde **offline nachgebaut** — mit den Produktionsfunktionen unverändert
   (`avesmapsBuildRouteNetworkData`, `avesmapsBuildClientCompatibleRouteGraph`), gefüttert
   aus der abgelegten Nutzlast. Beide Ladequeries sortieren identisch
   (`ORDER BY sort_order ASC, id ASC`, `is_active = 1`), Powerlines fallen in beiden Fällen
   heraus; nötig war nur ein Formadapter, weil der öffentliche Endpunkt `properties_json`
   flach einmischt und der Routing-Pfad es unter `properties.properties` verschachtelt hält.

> ⭐ **Der Nachbau ist nur deshalb belastbar, weil er gegen die eine Live-Probe validiert
> ist.** Fünf Zahlen mussten exakt stimmen, und sie stimmen exakt:
>
> | | live (`POST /api/route/`) | offline nachgebaut |
> |---|---:|---:|
> | `location_count` | 4.557 | 4.557 |
> | `path_count` | 5.559 | 5.559 |
> | `node_count` | 4.557 | 4.557 |
> | `path_feature_count` | 5.559 | 5.559 |
> | `synthetic_connection_count` | 858 | 858 |
>
> Damit kosten alle weiteren Varianten (andere Transportauswahl, Kantenzählung,
> Aufteilungsanalyse) den Server **null** Anfragen. Serverlast dieser Sitzung insgesamt:
> 1 × map-features, 1 × POST /api/route/, 1 × ecosystem-areas, 3 × `If-None-Match`-Probe
> (304, 0 Byte), 4 Seitenaufrufe für den Engine-Vergleich. Keine Schleife.

---

## 1. Bestand am Messtag

**Nutzlast und Zähler** (2026-07-26, 17:55 UTC):

| | zweiter Prüfbericht (2026-07-25) | **heute gemessen** |
|---|---:|---:|
| Payload roh | 29.651.233 B | **29.743.396 B** (+92.163 B) |
| `revision` | 35.074 | **40.455** (+5.381) |
| ETag | — | `W/"mf-8-40455-3eb416223e"` |
| Features gesamt | 10.745 | **10.821** |
| ⤷ location / crossing / junction / path / label / powerline | — | 2.618 / 797 / 1.142 / 5.559 / 543 / 162 |
| Landschafts-Labels | 540 | **543** |

> 🪤 **+5.381 Revisionen an einem Tag.** Das ist der empirische Beleg für Regel 3 und für
> die Warnung des Plans, die Byte-Zahl sei als Wächter untauglich. Es ist zugleich der
> Grund, warum Vorabmessung 3 eine Leerlauf-Grundlinie braucht (§4).

**Landschafts-Labels nach Ebene** (Zuordnung nach Machbarkeitsanalyse §1.2):

| Ebene | Subtypen | Plan 25.07. | **heute** |
|---|---|---:|---:|
| derographisch | `region` 135, `insel` 95, `sonstiges` 3, `kontinent` 2 | 234 | **235** |
| topographie | `gebirge` 60, `see` 46, `berggipfel` 36, `meer` 35, `huegelland` 3, `kueste` 2 | 181 | **182** |
| vegetation | `wald` 68, `suempfe_moore` 28, `steppe` 10, `auenlandschaft` 8, `wueste` 4, `graslandschaft` 2 | 119 | **120** |
| *(Linie, keine Fläche)* | `fluss` 5 | — | 5 |
| *(unzugeordnet)* | `ebene` 1 — „Zwergenpforte", der 🪤 aus der Zahlen-Tabelle | 1 | 1 |

**Die drei Zahlen, die die Hochrechnung tragen:**

| | Rechnung | Plan | **heute** |
|---|---|---:|---:|
| Flächen gesamt | 235 + 182 + 120 − 36 `berggipfel` (Punkte) | 500 | **501** |
| Zwillinge (V3.6 / `copy_regions`) | 182 + 120 − 36 | ~266 | **266** |
| leichte Klasse, die V5 abnimmt | `insel` 95 + `see` 46 + `wueste` 4 + `kueste` 2 + `kontinent` 2 | 149 | **149** |
| **schwere Klasse — die Messgrundlage** | `wald` 68 + `gebirge` 60 + `suempfe_moore` 28 | — | **156** |

Die Planzahlen halten also; die Drift eines Tages liegt bei ±1 je Ebene.

**Bestand an Landschaftsflächen** (`GET /api/app/ecosystem-areas.php`):
`ecosystem_enabled: true`, `ecosystem_revision: 276`, **5 Flächen, alle `is_trial = 1`** —
„Probe Derographisch", „Probe Topographie", „Probe Vegetation" und zweimal „Farinedel"
(Tippfehler, ohne Wiki-Link, ohne `label_public_id`). Das sind Entwicklungsproben aus
V3.x, keine Inhaltsarbeit. **Sie sind für die Erprobungs-Entscheidung in §8 relevant.**

---

## 2. Vorabmessung 1 — Graphgröße

Offline nachgebaut, gegen die Live-Probe validiert (§0). Standardanfrage, alle drei
Transportdomänen aktiv:

| | |
|---|---:|
| Knoten | **4.557** |
| Kanten, ungerichtet | **6.069** |
| Kanten, gerichtet (= Relaxationen je Dijkstra-Lauf) | **12.138** |
| ⤷ davon ganze Wege (1 Weg = 1 Kante) | 4.808 |
| ⤷ davon Teilstücke aus aufgeteilten Wegen | 403 (aus 191 Wegen) |
| ⤷ davon synthetisch (Querfeldein) | **858** |
| isolierte Knoten | 1 |

**Wofür die Zahl gebraucht wird:** V9 (Vorberechnung Wege × Flächen) und V11 (Terrain auf
Kantengewichte) skalieren mit den Kanten, nicht mit den Wegen. Die Bezugsgröße ist also
**6.069**, nicht 5.559 — knapp 10 % mehr, und die 858 Querfeldein-Kanten haben keine
Geometrie in der Datenbank, tragen also in V11 keinen Terrain-Faktor aus einer Fläche,
sondern brauchen eine eigene Regel. Das ist eine Feststellung für V11, kein Auftrag hier.

---

## 3. Vorabmessung 2 — Weichen die Engines heute schon ab?

**Ja, grob.** Die Frage entscheidet laut Plan, „ob die Paritätsforderung gestrichen wird".
Sie ist mit deutlichem Abstand beantwortet.

### 3.1 Strukturell

Der Server teilt einen Weg an jedem Innenknoten auf, der genau auf einem Ort liegt
(`client-graph.php:130–166`; die Teilstücke bekommen ein `#<n>` an die Kanten-ID). Der
Client tut das nicht (`route-graph-routing.js:109–112`: nur Anfang und Ende).

| | |
|---|---:|
| reale Weg-Kanten-Träger (ganze Wege + aufgeteilte) | 4.999 |
| davon **nur serverseitig aufgeteilt** | **191 = 3,8 %** |
| davon mit **benanntem** Innenknoten (nicht `Kreuzung-…`) | 34 |

Jeder dieser 191 Wege ist ein Punkt, an dem die beiden Graphen verschieden geformt sind —
unabhängig von jeder Kantengewichtung.

### 3.2 Live, derselbe Ortsnamen-Paar, nur `?clientrouting=1` unterschiedlich

**Fall 1 — `Quirod → Retingen`.** `Retingen` ist Innenknoten der Straße `Quirod ↔ Neudorf`
(Eisenstraße). Luftlinie 4,1 Meilen.

| | Server (Standard) | Client (`?clientrouting=1`) |
|---|---:|---:|
| Distanz | **4,15 Meilen** | **45,4 Meilen** |
| Reisezeit | 1,23 h | 12,8 h |
| Gesamtzeit | 2,5 h | 25,5 h |
| Segmente | 1 (Eisenstraße, direkt) | 3 (Reichsstraße 2 → Punin, Eisenstraße → Valquirbrück, Eisenstraße → Retingen) |

**Faktor 11 in der Strecke.** Die Ursache ist genau die Aufteilung: der Server darf am
Innenknoten enden, der Client muss den ganzen Weg nehmen oder gar nicht — und läuft
deshalb 45 Meilen außen herum, um `Retingen` vom anderen Ende eines anderen Segments zu
erreichen.

**Fall 2 — `Trallop → Falkenau`** (Gegenprobe mit erlaubtem Seeweg, Luftlinie 49,3 Meilen):

| | Server | Client |
|---|---:|---:|
| Distanz | 67,6 Meilen | 73,6 Meilen |
| Gesamtzeit | 9,3 h (0,4 Tage) | 50,1 h (2,1 Tage) |
| Verkehrsmittel | Seeweg, 1 Segment | Straße + Pfad, 2 Segmente über Kifenbeck |

Hier weicht zusätzlich die Verkehrsmittelwahl ab, und die Rastzeit-Rechnung ebenfalls
(0,0 h gegen 25,0 h). Fall 2 ist deshalb der schwächere Beleg — Fall 1 isoliert die
Aufteilung sauber.

### 3.3 Was daraus folgt

> 🔴 **Die Paritätsforderung ist heute schon gebrochen, und zwar um Größenordnungen.**
> Von V11 zu verlangen, die beiden Engines dürften nicht auseinanderlaufen, verlangt etwas
> herzustellen, was es nie gab. **Empfehlung: die Paritätsforderung streichen** und durch
> die Forderung ersetzen, die tatsächlich trägt — *der Server ist die Wahrheit, der Client
> ist die Vorschau*. Der Nachweis für V11 bleibt der Netzlauf gegen den **Server** (wie in
> V0.2 gefahren), nicht ein Abgleich der beiden Engines.
>
> ⚠️ Das ist eine Empfehlung, keine erledigte Aufgabe. Die 3,8 % sind ein eigener,
> vorbestehender Befund über das Routing — **nicht** Gegenstand dieses Plans und hier nur
> benannt, damit er nicht wieder verloren geht.

---

## 4. Vorabmessung 3 — Fasst ein Flächen-Save `map_revision` an?

**Nein.** Der Nachweis läuft über zwei Wege, weil der eine allein nicht trägt.

### 4.1 Statischer Beweis (der belastbare)

`avesmapsNextMapRevision` kommt in `api/_internal/app/ecosystem.php` **zweimal** vor —
beide Male in einem Kommentar (`:12` „THE ONE RULE THIS FILE EXISTS FOR", `:258` „and
pointedly NOT that function"). **Null Aufrufe.** Stattdessen 9 Aufrufe von
`avesmapsNextEcosystemRevision`. Auch `api/edit/map/ecosystem.php` und
`api/app/ecosystem-areas.php` rufen `avesmapsNextMapRevision` nicht.

Gegenprobe an der Wirklichkeit: `ecosystem_revision` steht heute bei **276**, `map_revision`
bei **40.455**. Zwei getrennte Zähler, die getrennt laufen. **Regel 3 hält.**

### 4.2 Die Probe am lebenden System — und warum sie eine Grundlinie braucht

Der V4-Text schlug vor: `curl` auf `map-features.php`, `revision` lesen, Save auslösen,
erneut lesen. Das zieht zweimal 29,7 MB und ist unnötig — der ETag wird **aus** `revision`
gesät und **vor** der teuren Query gesetzt, und `If-None-Match` steigt bei
`api/app/map-features.php:62–64` mit 304 und `exit` aus, ebenfalls vor der Query. Also:
ETag einmal holen, danach nur noch mit `If-None-Match` proben.

Der zweite Einwand wiegt schwerer: **ein 200 beweist nicht, dass der Flächen-Save schuld
war.** `map_revision` wurde an einem Tag 5.381-mal gebumpt (§1), von gewöhnlicher
Editorarbeit anderer Sitzungen. Ohne Leerlauf-Grundlinie misst der Test fremde Arbeit.

**Grundlinie aufgenommen — das System war ruhig:**

| Probe | Zeit (UTC) | Antwort | ETag |
|---|---|---|---|
| 1 | 17:55:14 | **304**, 0 Byte | `W/"mf-8-40455-3eb416223e"` |
| 2 | 17:57:20 | **304**, 0 Byte | unverändert |
| 3 | 18:01:02 | **304**, 0 Byte | unverändert |

**5 min 48 s Leerlauf ohne jede Änderung.** Das Fenster ist damit heute belastbar.

### 4.3 🔧 DU (Owner): die Save-Probe

Vor Durchgang A, einzelne Aufrufe, keine Schleife:

```bash
curl -s -o /dev/null -D - -H 'If-None-Match: W/"mf-8-40455-3eb416223e"' -w "http=%{http_code}\n" "https://avesmaps.de/api/app/map-features.php"
```

1. **Zweimal** proben, ~2 Minuten Abstand, **ohne irgendetwas zu tun**.
   Beide 304 → Fenster ruhig, weiter. Ein 200 → fremde Sitzung arbeitet gerade, den
   neuen ETag aus der Antwort übernehmen und später erneut ansetzen. **Nicht** in diesem
   Zustand messen.
2. **Eine** Landschaftsfläche speichern.
3. Erneut proben. **304 = Regel 3 hält.** Ein 200 hieße, ein Landschafts-Pfad ruft
   `avesmapsNextMapRevision` — dann §4.1 gegen die Wirklichkeit prüfen, bevor irgendetwas
   umgebaut wird.

---

## 5. Vorabmessung 4 — Wie viele Querfeldein-Strecken entstehen real?

Offline über alle vier sinnvollen Transportauswahlen, nachdem die Standardvariante gegen
die Live-Probe validiert war (858 = 858):

| Transportauswahl | Querfeldein | Kanten gesamt | Anteil | isolierte Knoten |
|---|---:|---:|---:|---:|
| alle (Land + Fluss + See) — *Standard* | **858** | 6.069 | 14,1 % | 1 |
| ohne See | 867 | 4.803 | 18,1 % | 579 |
| Land + See, ohne Fluss | 1.122 | 5.780 | 19,4 % | 1 |
| nur Land | **1.129** | 4.512 | 25,0 % | 609 |

**Wofür die Zahl gebraucht wird:** V14 (A\* für Querfeldein) und V13 (Wasser meiden).

> ⭐ **Die Bandbreite ist 858–1.129, nicht „ein paar".** Im ungünstigsten realistischen
> Fall — nur Land — ist **jede vierte Kante** des Graphen synthetisch. Vorberechnen lässt
> sich das nicht sinnvoll: die Menge hängt an der Transportauswahl des Nutzers und ändert
> sich mit jeder Umschaltung im Routenplaner. Das ist ein Argument **für** V14 „nur
> clientseitig, on demand" (so steht es im Plan) und **gegen** jede Vorberechnungstabelle
> für Querfeldein.
>
> 🪤 **Nebenbefund, nicht Gegenstand dieses Plans:** ohne See bleiben **579** Knoten
> isoliert, nur Land **609**. Das sind Orte, die in dieser Transportauswahl aus dem Graphen
> fallen. Ob das durchweg gewollt ist (Inseln ohne Schiff sind es), ist hier nicht geprüft.

---

## 6. 🔧 DU (Owner): Durchgang A und B

### 6.1 Die zehn Messflächen

🪤 **Aus der schweren Klasse**, nicht aus Inseln und Seen: die leichte Klasse ist klein und
rundlich, und V5 nimmt sie ohnehin ganz aus der Hand (149 Flächen). Zehn Inseln messen
90 Sekunden und begründen ein Projekt, das an Wäldern scheitert.

Die zehn sind aus den 156 Labels der schweren Klasse gezogen — alle mit Wiki-Link (V3.0b
braucht ihn), über die Karte verteilt, mengenmäßig im Verhältnis der Subtypen (68/60/28):

| # | Landschaft | Subtyp | Ebene | x | y |
|---|---|---|---|---:|---:|
| 1 | Farindelwald | `wald` | vegetation | 401,5 | 546,0 |
| 2 | Kupfertann | `wald` | vegetation | 494,6 | 471,2 |
| 3 | Iseholz | `wald` | vegetation | 548,8 | 628,1 |
| 4 | Altnordener Forst | `wald` | vegetation | 604,1 | 621,1 |
| 5 | Donnerzacken | `gebirge` | topographie | 398,3 | 760,9 |
| 6 | Tosch Mur | `gebirge` | topographie | 467,9 | 458,2 |
| 7 | Thalus-Massiv | `gebirge` | topographie | 606,4 | 287,4 |
| 8 | Beilunker Berge | `gebirge` | topographie | 707,0 | 525,9 |
| 9 | Drei Klageweiber | `suempfe_moore` | vegetation | 434,5 | 772,1 |
| 10 | Rashduler Sümpfe | `suempfe_moore` | vegetation | 647,9 | 344,5 |

Am schnellsten zu finden über die Spotlight-Suche nach dem Namen. Die Verteilung über die
Karte ist Absicht: „das Wiederfinden der nächsten Stelle" gehört zu den Kosten.

### 6.2 Durchgang A — zehn Flächen neu

**Gemessen wird die fertige Fläche, nicht die Geometrie.** Also je Fläche: Region wählen
oder anlegen, Art (`region_type`) setzen, Wiki zuweisen, zeichnen, benennen, speichern.
Die Uhr läuft ab „ich fange mit dieser Landschaft an" bis „gespeichert".

⏱️ **Zusätzlich getrennt notieren: der Overhead-Anteil** — die Zeit, die auf Menü,
Regionsauswahl, Art und Wiki geht, ohne das Zeichnen selbst. Der Plan schätzt sie auf
15–18 s je Fläche. Das ist die Zahl, die den späteren Stapelbetrieb (`copy_regions`)
begründet oder erledigt, und sie geht im Gesamtwert unter.

| # | Landschaft | Gesamt (s) | davon Overhead (s) | Bemerkung |
|---|---|---:|---:|---|
| 1 | Farindelwald | | | |
| 2 | Kupfertann | | | |
| 3 | Iseholz | | | |
| 4 | Altnordener Forst | | | |
| 5 | Donnerzacken | | | |
| 6 | Tosch Mur | | | |
| 7 | Thalus-Massiv | | | |
| 8 | Beilunker Berge | | | |
| 9 | Drei Klageweiber | | | |
| 10 | Rashduler Sümpfe | | | |

### 6.3 Durchgang B — dieselben zehn per „Senden an …" übernehmen

⭐ **A liefert die Quellen für B.** Genau die zehn Flächen aus A werden per „Senden an …"
(V3.6, Kontextmenü an der Fläche) auf die derographische Ebene kopiert — das sind die
Zwillingsfälle. Gleiche Formen in beiden Durchgängen machen die zwei Zahlen überhaupt erst
vergleichbar.

💣 **B misst „senden **und anpassen**", nicht „senden".** Ein Vegetations-Umriss ist nicht
derselbe wie der Umriss des Namens — der Name reicht meist weiter als der Bewuchs. Wer
beim Toast stoppt, misst 15 Sekunden, und die Wirklichkeit sind 90. Die Uhr läuft bis die
kopierte Fläche **an ihrem neuen Platz stimmt** und gespeichert ist.

| # | Landschaft | Gesamt (s) | davon Anpassen (s) | Bemerkung |
|---|---|---:|---:|---|
| 1 | Farindelwald | | | |
| 2 | Kupfertann | | | |
| 3 | Iseholz | | | |
| 4 | Altnordener Forst | | | |
| 5 | Donnerzacken | | | |
| 6 | Tosch Mur | | | |
| 7 | Thalus-Massiv | | | |
| 8 | Beilunker Berge | | | |
| 9 | Drei Klageweiber | | | |
| 10 | Rashduler Sümpfe | | | |

> ⭐ **Roh notieren, nicht mitteln.** Die Streuung sagt mehr als der Schnitt: zehnmal
> 3 Minuten heißt „planbar", und 8× 90 s + 2× 9 min heißt „an den zerklüfteten Fällen
> scheitert es" — und *das* wäre der Befund, der über V5 und V7 entscheidet.

---

## 7. Hochrechnung — vorgerechnet

**Das Mengengerüst** (§1): 501 Flächen aus Labels, davon nimmt V5 **149** ab → **352**
bleiben von Hand. Dazu **266 Zwillinge** — die zweite Fläche derselben Landschaft auf der
derographischen Ebene, die laut Machbarkeitsanalyse §2.1 („Der Farindel … wird zweimal
gezeichnet") zusätzlich entsteht und die V3.6 / `copy_regions` billiger machen soll.

> ⚠️ **Eine Modellannahme, die der Plan offenlässt und die der Owner treffen muss:**
> Sind die 266 Zwillinge **zusätzlich** zu den 501 (so liest es die Analyse: eine Fläche
> für den Namen, eine für den Bewuchs), oder sind sie **in** den 501 enthalten? Die
> Tabellen unten rechnen die additive Lesart; ist sie falsch, fällt der Zwillingsanteil
> ganz weg und es bleiben allein die Spalten „Grundlast".

**Grundlast** — nur die Label-Flächen, ein Durchgang A je Fläche:

| t_A je Fläche | ohne V5 (501) | **mit V5 (352)** |
|---|---:|---:|
| 90 s (1,5 min) | 12,5 h | **8,8 h** |
| 120 s (2 min) | 16,7 h | **11,7 h** |
| 150 s (2,5 min) | 20,9 h | **14,7 h** |
| 180 s (3 min) | 25,1 h | **17,6 h** |
| 240 s (4 min) | 33,4 h | **23,5 h** |
| 300 s (5 min) | 41,8 h | **29,3 h** |

**Gesamt mit V5** = 352 × t_A + 266 × t_B, je nachdem was B einspart:

| t_A | t_B = 30 % von t_A | t_B = 50 % | t_B = 70 % |
|---|---:|---:|---:|
| 90 s | 10,8 h | 12,1 h | 13,5 h |
| 120 s | 14,4 h | 16,2 h | 17,9 h |
| 150 s | 18,0 h | 20,2 h | 22,4 h |
| **180 s** | **21,6 h** | **24,3 h** | **26,9 h** |
| 240 s | 28,8 h | 32,3 h | 35,9 h |
| 300 s | 36,0 h | 40,4 h | 44,9 h |

**Gesamt ohne V5** = 501 × t_A + 266 × t_B:

| t_A | t_B = 30 % | t_B = 50 % | t_B = 70 % |
|---|---:|---:|---:|
| 90 s | 14,5 h | 15,8 h | 17,2 h |
| 120 s | 19,4 h | 21,1 h | 22,9 h |
| 150 s | 24,2 h | 26,4 h | 28,6 h |
| **180 s** | **29,0 h** | **31,7 h** | **34,4 h** |
| 240 s | 38,7 h | 42,3 h | 45,8 h |
| 300 s | 48,4 h | 52,8 h | 57,3 h |

**Die Schwelle des Plans:** „Bei 5 Minuten je Fläche sind es 42 Stunden für 500 — es wird
nicht fertig. Bei 2 Minuten sind es 17 — es wird." Die Tabellen zeigen, dass **V5 der
größere Hebel ist als „Senden an …"**: V5 nimmt bei t_A = 180 s **7,5 Stunden** ab, die
Zwillingsersparnis zwischen t_B = 70 % und t_B = 30 % nur **5,3 Stunden**.

**Lohnt sich das serverseitige `copy_regions`?** Es ersetzt beim Zwilling das Menü, nicht
das Anpassen. Sein Gewinn ist also ≈ 266 × Overhead-Anteil:

| Overhead je Fläche | eingesparte Zeit über 266 Zwillinge |
|---|---:|
| 10 s | 0,7 h |
| 15 s | 1,1 h |
| 18 s | 1,3 h |
| 25 s | 1,8 h |

> 🔴 **Vorwegnahme, die die Messung wahrscheinlich bestätigen wird: `copy_regions` lohnt
> sich nicht.** Selbst bei 25 s Overhead spart ein serverseitiger Massenlauf ~1,8 Stunden —
> gegen eine Aufgabe mit eigenem Endpunkt, eigener Zuordnungslogik (welcher Zwilling gehört
> zu welchem Label?), Transaktion, Audit und Abnahme. Das ist der schlechteste Tauschkurs
> im ganzen Plan. **Der Overhead-Wert aus §6.2 entscheidet das endgültig** — deshalb steht
> er dort in einer eigenen Spalte.
>
> Die Gegenrechnung, die ihn doch retten würde: wenn der Overhead nicht 15–18 s, sondern
> deutlich mehr ist, weil die Regionsauswahl bei 266 Zwillingen jedes Mal neu gesucht
> werden muss. Genau deshalb wird er gemessen und nicht geschätzt.

---

## 8. 🔧 DU (Owner): Erprobungs-Entscheidung

Ein Aufruf, kein Aufräumen von Hand: `POST /api/edit/map/ecosystem.php` mit
`{"action":"promote_trial","mode":"keep"}` oder `"discard"`.

- `keep` — löscht nur die Marke (`is_trial = 0`), keine Audit-Zeile, nichts geht verloren.
- `discard` — soft-löscht **alle** Erprobungsflächen und schreibt **je Fläche eine eigene
  Audit-Zeile** (`api/_internal/app/ecosystem.php:1104–1119`), ist also rückholbar, aber
  nur von Hand.

Beide setzen `app_setting['ecosystem_trial']` auf `0`.

> ⚠️ **`promote_trial` ist alles-oder-nichts über `is_trial = 1` — es gibt keine Auswahl
> je Fläche.** Nach den Durchgängen stehen dort **25** Flächen: die 20 Messflächen **und
> die 5 Entwicklungsproben** aus §1 („Probe Derographisch", „Probe Topographie",
> „Probe Vegetation", 2 × „Farinedel" mit Tippfehler, alle ohne Wiki-Link).
>
> - `keep` macht die fünf Proben zu dauerhaften Inhaltsdaten.
> - `discard` wirft die 20 Messflächen mit weg — und das ist echte Arbeit an echten
>   Landschaften mit Namen, Region, Art und Wiki-Zuweisung.
>
> **Empfehlung: die fünf Proben vorher von Hand löschen** (Kontextmenü an der Fläche,
> V3.4 — sie sind an ihren Namen zweifelsfrei erkennbar), **dann `mode=keep`.** So bleibt
> die Messarbeit erhalten und der Datenbestand sauber.
>
> 🔴 **Erst entscheiden, wenn die Zahlen in §6 stehen.** Die 20 Messflächen tragen
> `is_trial = 1`; ein `discard` vor der Auswertung nimmt die Grundlage mit.

---

## 9. Empfehlung — weiterbauen oder nicht

*Wird ausgefüllt, sobald Durchgang A und B gemessen sind.* Was schon feststeht:

| Frage | Stand |
|---|---|
| Paritätsforderung an V11 streichen? | **Ja** — sie ist heute schon um Faktor 11 gebrochen (§3). Ersatzforderung: der Server ist die Wahrheit, Nachweis bleibt der Netzlauf gegen den Server. |
| Querfeldein vorberechnen (V14 als Tabelle)? | **Nein** — 858–1.129 Kanten, abhängig von der Transportauswahl des Nutzers, also zur Laufzeit veränderlich. Der Plan liegt mit „nur clientseitig, on demand" richtig (§5). |
| `copy_regions` für die 266 Zwillinge bauen? | **Wahrscheinlich nein** — Gewinn ≈ 0,7–1,8 h (§7). Endgültig nach dem Overhead-Wert aus §6.2. |
| Regel 3 (Flächen-Save fasst `map_revision` nicht an) | **Hält** (§4). |
| V5 vor V6/V7 ziehen? | **Ja, deutlich** — V5 ist mit 7,5 h bei t_A = 3 min der größte Einzelhebel und der einzige, der ohne Handarbeit skaliert (§7). |
| Weiterbauen? | ⏳ hängt an t_A und t_B. |

**Die Entscheidungsregel, vorab festgelegt, damit sie nicht nachträglich passend gemacht
wird:** Gesamtaufwand *mit V5* aus §7 ablesen.

- **unter ~20 h** → weiterbauen wie geplant.
- **20–30 h** → weiterbauen, aber V5 **vor** V6/V7 ziehen und die schwere Klasse zuerst
  angehen, solange die Motivation trägt.
- **über ~30 h** → nicht als Handarbeitsprojekt weiterbauen. Dann ist die ehrliche Antwort,
  V5 zu bauen, die 149 abgeleiteten Flächen zu nehmen und den Rest **nicht** flächendeckend
  zu erfassen, sondern nur dort, wo eine Fläche konkret gebraucht wird.

---

## Anhang — Nachvollziehen

Der Offline-Nachbau lebt im Scratchpad dieser Sitzung, nicht im Repo (V4 schreibt keinen
Code). Er ist in zwanzig Zeilen wiederherstellbar:

1. `curl -s -D h.txt -o map-features.json https://avesmaps.de/api/app/map-features.php`
   — **eine** Anfrage; der ETag steht in `h.txt`.
2. `api/_internal/routing/network-data.php` und `api/_internal/routing/client-graph.php`
   einbinden.
3. Jede Nutzlast-Feature in die Routing-Form bringen: `properties` bekommt
   `public_id, feature_type, feature_subtype, name, geometry_type, revision, updated_at`
   flach und **das gesamte flache `properties`-Objekt zusätzlich verschachtelt unter
   `properties.properties`** (dort liest der Graphbauer `flow` und `allowed_transports`).
   `style` bleibt leer, weil der öffentliche Endpunkt `style_json` bereits eingemischt hat.
4. `avesmapsBuildRouteNetworkData(['features' => $features, 'revision' => 0])`, dann
   `avesmapsBuildClientCompatibleRouteGraph($network, $request)`.
5. **Zuerst validieren**, dann rechnen: `node_count`, `path_feature_count` und
   `synthetic_connection_count` müssen die Werte einer Live-`POST /api/route/`-Antwort
   exakt treffen (§0). Tun sie es nicht, ist der Adapter falsch und alle weiteren Zahlen
   sind es auch.
6. Kanten zählen: `$graph[$from][$to]` ist eine **Liste** paralleler Verbindungen. Eine
   ungerichtete Kante wird zweimal eingetragen, in beiden Richtungen mit **derselben**
   `id` — also sind die verschiedenen `id`-Werte die ungerichteten Kanten. Aufgeteilte
   Wege erkennt man am `#<n>` in der `id`.

Speicherbedarf: ~170 MB, Laufzeit unter einer Minute. `php -d memory_limit=6G`.
