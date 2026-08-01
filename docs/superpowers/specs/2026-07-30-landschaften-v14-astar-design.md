# Landschaften V14 — A\* für Querfeldein — Design

**Stand:** 2026-07-30 · **Auftraggeber:** Owner · **Vorgänger:** V8 (Höhenfeld), V9 (Kern),
V11 ✅ live (Gelände + **der Vorentwurf, siehe §2**), V13 ✅ live (Wasser) ·
**Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md` Zeile 2136 ·
**Abnehmer:** keiner — V14 ist für sich fertig.

---

## 0. Kurzfassung

Heute ist eine Querfeldein-Etappe eine **gerade Linie zwischen zwei vorhandenen Knoten**, und sie
entsteht nur als **Reparatur für abgehängte Komponenten**. Zwei Orte, die schon verbunden sind —
und sei es über einen 15-fachen Umweg — bekommen nie eine Abkürzung.

V14 gibt dem Planer einen **A\* über ein Gitter**: eine Querfeldein-Strecke, die sich **um** Wasser
biegt und Gelände nach Kosten meidet, statt gerade durchzustoßen. Zwei Auslöser, **ein** Rechner:
automatisch bei absurdem Umweg, und auf Rechtsklick als „Hierher reisen".

Gerechnet wird **im Server**. Gemessen am Livebestand: bei der Schwelle **3×** feuert der
automatische Auslöser auf **9,1 %** der nahen Ortspaare und kostet **14 ms** im Median, **112 ms**
im schlimmsten Fall — bei 4.130 Zellen gegen einen Deckel von 150.000. Die anderen 90,9 % zahlen
**nichts**, weil der Vorfilter aus zwei Zahlen besteht, die ohnehin vorliegen.

---

## 1. Owner-Entscheide dieser Sitzung

| | Entscheid |
|---|---|
| **Auslöser** | **automatisch bei absurdem Umweg** — nicht Knopf, nicht nur Rechtsklick |
| **Schwelle** | **3×** — nachträglich von 8× korrigiert, weil 8× drei der vier gemeldeten Fälle nicht anfasst (§4.2) |
| **„Hierher reisen"** | kommt **mit dazu** (Rechtsklick, `schuh.png`) — dasselbe Vorhaben, zweiter Auslöser |
| **Darstellung** | die Etappe ist **erkennbar**, mit Hinweis „wegloses Gelände" |
| **Bericht „hier fehlt ein Weg"** | 🔴 **abgewählt** — siehe §8.1, die Folge gehört benannt |
| **Zielbild** | die vom Owner gezeichnete rote Linie in `?s=kgDKf9Ha` **ist** das Soll |

> Der Owner hat die Kostenwarnung zum automatischen Auslöser gehört und ihn trotzdem gewählt.
> Die Messung in §4.3 hat die Warnung anschließend entkräftet — sie galt dem Rechtsklick.

---

## 2. 🔴 Der Vorentwurf steht schon — in V11 §10, nicht in V14

**Wer V14 baut, liest zuerst `docs/superpowers/specs/2026-07-29-landschaften-v11-gelaende-reisezeiten-design.md`
§10.** Dort ist der halbe A\* bereits entworfen **und gemessen**. Diese Spec leitet das nicht neu her,
sie übernimmt es und ergänzt, was §10 offenließ.

Übernommen, unverändert:

| | aus V11 §10 |
|---|---|
| Suchraum | eine **Kiste** aus Start, Ziel und Rand — nie die ganze Karte |
| Zellgröße | **0,5 Karteneinheiten** (1.500 Schritt), einstellbar |
| **Wasser** | **unpassierbar** — sperrt, wird nicht teuer |
| **Geländeart** | **Kostenfaktor**, zur Anfragezeit aus den Polygonen in die Kiste gerastert; **kein** zweites gespeichertes Raster |
| **Höhe** | aus dem **gespeicherten** Raster (V11 §3), in dieselbe Kiste abgetastet |
| Kosten | `Strecke / Grundtempo(Querfeldein) × Steigungsfaktor × Geländefaktor(Art)` |
| Ausstieg beim Rechtsklick | `findNearestLocationToLatLng` ⚠️ **nur im Client vorhanden**, und sie schliesst Kreuzungen nur nach NAMEN aus (~200 `Kreuzung-auto-<n>` rutschen durch) |
| Symbol | `schuh.png` |

⭐ **Damit ist „Wand oder Kostenfläche" kein Entweder-oder** — die Antwort ist beides: Wasser sperrt,
Gelände kostet. Diese Sitzung hatte die Frage falsch gestellt; §10 hatte sie richtig beantwortet.

💣 **Drei Warnungen aus §10, die tragend sind:**

1. **Das Gitter ist NIE ein PHP-Array.** Gemessen 33,2 Byte je Zelle — 568.000 Ganzzahlen sind
   **18 MB**, derselbe Inhalt als Binärstring **0,5 MB**. `str_repeat` / `$s[$i]`.
2. **Ein Byte je Zelle reicht nicht — es sind drei Ebenen.** `derographisch`, `vegetation` und
   `topographie` liegen **übereinander**: eine Zelle ist gleichzeitig „Kosch" *und* „Wald" *und*
   „Gebirge". Die drei `offroad_factor` werden per **Maximum** verknüpft, nicht multipliziert.
3. **Der Zelldeckel liegt bei 150.000–200.000**, nicht bei 568.000 (§4.4).

---

## 3. Wo es läuft: **Server**

💣 **Die Fahrplan-Zeile 2136 sagt „nur clientseitig, on demand" — das ist überholt und wird
berichtigt.** Sie stammt aus der Zeit vor V11 §10 (dessen Messungen durchgehend PHP sind) und vor
V13. Drei Gründe:

1. **Der automatische Auslöser hat keine Wahl.** Live läuft server-primäres Routing
   (`shouldUseServerPrimaryRouting()`, V13 §1); ein Browser-A\* könnte die vom Server gelieferte
   Route nicht beeinflussen.
2. **Beide Eingaben sind serverseitig lesbar.** Die Wasserpolygone hat V13 schon verdrahtet
   (`avesmapsLoadRouteWater`), das Höhenraster liegt gespeichert vor — V11 §3.3: der Browser
   **erzeugt** es auf Knopfdruck, aber gelesen wird es danach von beiden Seiten. Live nachgeprüft
   am 2026-07-30: `terrain.enabled = true`, 3.331 Profilzeilen, 433 Wege, `stale = false`.
3. **Ein Rechner ist besser als zwei.** V13 hat gezeigt, was die Alternative kostet: der Client hat
   bis heute **gar keine** Wasserlogik.

---

## 4. Die Messungen (2026-07-30, `map_revision` 46793, `ecosystem_revision` 6139)

Verfahren wie bei V13: **zwei** Leseanfragen (`map-features.php` 18,7 MB, `ecosystem-areas.php`
1,5 MB), danach Nachbau mit den **unveränderten** Produktionsfunktionen, validiert gegen die
Kennzahlen aus dem regulären Antwortkörper. Siehe [[offline-graph-rebuild-validated-against-live]].

### 4.1 Die vier Referenzfälle des Owners

| Freigabelink | Fall | Luftlinie | heute | Faktor | A\* Wasser | A\* + Gebirge |
|---|---|---|---|---|---|---|
| `?s=kgDKf9Ha` | Gulbladdirstadir → Rekheim | 7,8 | **121,7** | **15,6×** | **8,4** | 8,4 |
| `?s=E3BaLxNe` | Flammersbach → Hardorp | 16,4 | 19,7 | 1,2× | 16,2 | 16,2 |
| `?s=7nkaEHL8` | Fiering → Taining | 7,6 | **52,1** | **6,8×** | 7,6 | 7,6 |
| `?s=DFtqNyn6` | Rovik → Skarsten | 6,5 | **24,8** | 3,8× | 6,4 ⚠️ | **11,2** |

### 4.1a 💣 „A\* ≈ Luftlinie" heißt NICHT „kein Hindernis"

Diese Sitzung hat aus „der A\* liefert ungefähr die Luftlinie" geschlossen, es liege dort kein
Hindernis. **Der Schluss ist falsch**, der Owner hat widersprochen, und die Geometrie gibt ihm
recht: ein Weg kann ein Hindernis **knapp umgehen**, ohne lang zu werden.

Direkt gefragt (V9-Kern auf der Sehne, ohne jede Toleranz):

| Fall | Wasser auf der Sehne | Gebirge auf der Sehne | löst bei 3× aus? |
|---|---|---|---|
| Gulbladdirstadir → Rekheim | 2 Flächen, **88 %** der Sehne nass | — | **ja** (15,6×) |
| Fiering → Taining | 1 Fläche, **40,7 %** nass | — | **ja** (6,8×) |
| Rovik → Skarsten | — | 1 Fläche, **79 %** drin | **ja** (3,8×) |
| Flammersbach → Hardorp | keins | keins | nein (1,2×) — und richtig so |

⭐ **Die drei Fälle mit Hindernis lösen bei 3× alle aus, der ohne Hindernis nicht.** Das ist der
stärkste Hinweis darauf, dass 3× die richtige Schwelle ist — sie trennt hier genau entlang der
Geometrie, nicht entlang einer runden Zahl.

Fiering → Taining ist der Beleg: **40,7 % Wasser** auf der Sehne, und der A\* kommt auf 8,16 gegen
7,63 Luftlinie — **7 % Mehrlänge** für eine Umgehung, die man in der Zahl nicht sieht.

⭐ **Die Lehre für die Umsetzung:** ob ein Hindernis vorliegt, wird an der **Geometrie** gefragt, nie
aus der Länge geschlossen. Der Nachweis in §7.2 prüft deshalb Sehnen-Schnitte, nicht Verhältnisse.

⚠️ **Rovik → Skarsten ist der Beweis für die Geländeebene:** ohne Gebirgsdaten läuft der A\*
**durch 70 % der Punkte im Gebirge**, also schnurgerade über den Kamm. Mit der Fläche „Gebirge im
Weg" biegt er ab und braucht 11,2 statt 6,4 — immer noch weniger als die Hälfte der heutigen 24,8.

⚠️ **Die blaue Linie im Fall Rekheim ist keine Landroute.** Die Etappen sind
`Seeweg ×4 + Flussweg ×1 + Pfad ×3 + Querfeldein ×1`: der Planer setzt den Reisenden aufs Schiff,
fährt um die Halbinsel und lässt ihn im Süden an Land. Für 7,8 Einheiten Luftlinie.

### 4.2 Was „unverhältnismäßig" heißt — die Verteilung

1.503 echte Routen zwischen **nahen** Ortspaaren (Luftlinie 1–25 Einheiten; nur dort kann eine Bucht
aus 8 Einheiten 121 machen):

| | Weg / Luftlinie |
|---|---|
| Median | 1,57× |
| p75 | 2,03× |
| p90 | 2,96× |
| p95 | 4,46× |
| p99 | 7,25× |
| max | **22,3×** |

🔴 **Die Verteilung hat keinen natürlichen Sprung** — dieselbe Lage wie bei V13s Küstentoleranz. Die
Schwelle ist eine Ermessensfrage. Messbar ist nur, was sie kostet:

| Schwelle | löst aus bei | Kiste p50 / max | Zeit p50 / max | Weg gefunden | Verkürzung p50 |
|---|---|---|---|---|---|
| > 2× | 26 % | — | — | — | ein Umweg um einen Hügel ist normal |
| **> 3×** | **9,1 %** | **1.125 / 4.130** | **14 / 112 ms** | **136 / 138** | **4,2×** |
| > 5× | 3,8 % | 902 / 3.696 | 10,5 / 101 ms | 56 / 58 | 5,9× |
| > 8× | 0,53 % | 180 / 1.920 | 1,9 / 23 ms | 8 / 8 | 10,2× |
| > 12× | 0,27 % | — | — | — | — |
| > 20× | 0,13 % | — | — | — | — |

**Owner-Entscheid 2026-07-30: 3×.** 💣 **Und der Grund ist eine Korrektur:** die erste Fassung dieser
Spec schrieb **8×** — bei dem Wert löst genau **einer** der vier gemeldeten Fälle aus (Rekheim
15,6×), während Fiering (6,8×), Rovik (3,8×) und Flammersbach (1,2×) unangetastet bleiben. Der Owner
hatte 8× durchgewinkt, ohne das zu wissen; mit der Zahl vorgelegt entschied er 3×.

Bei 3× fallen Rekheim, Fiering **und** Rovik hinein, Flammersbach bleibt draußen, wo es hingehört.
**3× ist zugleich das p90 der Verteilung** — „schlechter als 90 % vergleichbarer Routen" ist eine
verteidigungsfähige Definition von *unverhältnismäßig*, und damit hat die Schwelle doch eine
Begründung, wenn auch keinen Sprung.

⚠️ **Nicht tiefer.** Der Median liegt bei 1,57×; bei 2× würde der A\* auf einem Viertel aller nahen
Routen eingreifen, wo Straßen einfach um Hügel biegen.

### 4.3 ⭐ Der Auslöser wählt sich seine Kiste selbst klein

⚠️ **Die Liste unten ist die 8×-Teilmenge, nicht die geltende.** Bei der beschlossenen Schwelle 3×
sind es **138** Fälle (§4.2). Die acht werden gezeigt, weil sie die Extremfälle sind — wenn schon
die schlimmsten Umwege kleine Kisten ergeben, gilt es für die milderen erst recht. Kiste bei
Zellweite 0,5 und Rand 30 %:

```
Gluckenhang              -> Wasserburg         Luft  2,5  heute  55,9  A*  2,2   130 Z   1,4 ms
Catco                    -> Fort Südergart     Luft  2,7  heute  39,7  A*  2,7   140 Z   1,5 ms
Branfeld                 -> Burg Nardesbroch   Luft  2,7  heute  25,4  A*  2,9   143 Z   1,5 ms
Schwarzfall (Wasserfall) -> Ungolfsroden       Luft  3,7  heute  82,5  A*  3,6   180 Z   1,9 ms
Albentrutz               -> Clachoven          Luft  8,5  heute  92,0  A*  8,7   494 Z   5,4 ms
Felshöhe                 -> Salzsteige         Luft 10,1  heute  81,0  A* 10,4   620 Z  10,0 ms
Eslamsroden              -> Quastenbroich      Luft 13,6  heute 114,6  A* 14,1   880 Z  10,7 ms
Donnerfall               -> Rödingen           Luft 19,0  heute 208,1  A* 20,4  1920 Z  23,2 ms
```

| | automatischer Auslöser | Rechtsklick (V11 §10) |
|---|---|---|
| Kiste p50 | **1.125 Zellen** | 10.600 |
| Kiste p90 | 3.149 | 168.900 |
| Kiste max | **4.130** | **568.000** |
| Zeit p50 | **14 ms** | 16 ms |
| Zeit max | **112 ms** | 816 ms → **5–12 s auf STRATO** |

⭐ **Das ist strukturell, nicht Glück.** Eine Route sieht nur dann absurd aus, wenn die beiden Orte
*nah* beieinander liegen — und nah heißt kleine Kiste. Die Schwelle begrenzt die Kiste, ohne dass
man sie eigens begrenzen muss. Weg gefunden in **8 von 8** Fällen, Verkürzung im Median **10,2×**,
maximal 25,3×.

⚠️ **Kein Beweis, nur eine Beobachtung im Bestand.** Ein weit entferntes Paar mit Faktor 9 wäre
theoretisch möglich (in 400 gemischten Paaren war der Höchstwert 3,67×, also kam es nicht vor).
Deshalb bleibt der Zelldeckel als **Netz**.

### 4.4 Der Zelldeckel — gemessen in V11 §10.2

| Zellen | Zeit (minimaler A\*, ohne Geländemathematik) | geöffnet |
|---|---|---|
| 10.609 | 16 ms | 8.878 |
| 168.900 | ~242 ms | 140.437 |
| 568.516 | **816 ms** | 469.235 |

Das echte A\* addiert je Relaxation Höhenabfrage, Kurve, Geländebyte und Multiplikation —
**3–5×**, STRATO-Shared nochmals **2–3×**. Deckel **150.000–200.000 Zellen**; darüber vergröbert
der Code **für diese eine Anfrage** und schreibt die tatsächlich benutzte Zellweite in die Antwort.

### 4.5 Die Datenlage — der A\* wird zunächst kaum Gelände spüren

| | Stand 2026-07-30 |
|---|---|
| Wasserflächen (abgenommen) | **298** |
| `gebirge`-Flächen | 17 — **alle 17 Erprobung** |
| Flächen mit Höhenparametern | 58 — **fast alle Erprobung** |
| Wege mit Geländeprofil | **433 von 5.676** (7,6 %) |

⚠️ **Diese Tabelle ist eine Momentaufnahme und veraltet absichtsvoll.** Noch am selben Tag hat eine
Parallel-Sitzung (`10073976`) die Rastererzeugung für Gebirge **ohne Gipfel** repariert — vorher
schwieg sie, jetzt bauen **16 von 17** Gebirgsflächen ein Feld. Das ändert den *gespeicherten*
Bestand erst beim nächsten Knopfdruck, hebt aber die Obergrenze dessen, was der A\* je spüren kann.
Wer V14 baut, zählt die Zeilen neu, statt diese zu glauben.

🔧 **Owner-Aktion:** Solange die Gebirgsflächen `is_trial = 1` tragen, sind sie für das Routing
unsichtbar — V13s Filter schließt Erprobungsflächen bewusst aus („Routing darf sich nicht ändern,
weil jemand etwas ausprobiert"). Der A\* meidet dann **nur Wasser**. Das ist kein Baufehler,
sondern der Bestand; er wächst mit der Zeichenarbeit hinein. **Die Regel soll nicht aufgeweicht
werden** — der Knopf `promote_trial` ist der richtige Weg.

---

## 5. Der Bauplan

### 5.1 Die Kiste und das Gitter

Neu: `api/_internal/routing/offroad-grid.php`.

```
avesmapsBuildOffroadBox(float $x1, float $y1, float $x2, float $y2): array
```

Kiste = bbox der zwei Punkte plus Rand (30 % der Luftlinie, mindestens 2 Einheiten). Zellweite aus
der Owner-Einstellung, Voreinstellung **0,5**. Überschreitet `w × h` den Deckel, wird die Zellweite
verdoppelt, bis sie hineinpasst; die benutzte Weite wandert in die Antwort.

💣 **Belegung als Binärstring**, ein Zeichen je Zelle je Ebene — nie ein PHP-Array (§2).

### 5.2 Die Hindernisse

- **Wasser sperrt.** Quelle ist V13s `avesmapsLoadRouteWater()` — **dieselbe** Abfrage, dieselben
  Filter (`meer` + `see`, `is_trial = 0`, **kein** `affects_paths`). Kein zweiter Wasserbegriff.
- **Geländeart kostet.** Zur Anfragezeit per Scanline in die Kiste gerastert, drei Byte-Ebenen
  (§2), Faktoren per **Maximum** verknüpft.
- **Höhe kostet.** Aus dem gespeicherten Raster (V11 §3), in dieselbe Kiste abgetastet; fehlt es,
  gilt Faktor 1,0 — genau wie V11 es für Wege schon tut.

⚠️ **Start- und Zielzelle sind immer begehbar**, auch wenn sie in Wasser liegen. Das ist keine
Ausnahme, sondern derselbe Befund wie V13 §2.3: **571 von 4.653 Orten liegen geometrisch IM
Wasser**, 55 benannte darunter Belhanka und Kuslik. Ohne diese Freigabe wäre für jede Hafenstadt
sofort „kein Weg".

### 5.3 Der A\* selbst

8 Nachbarn, Kosten nach der Formel aus §2, Heuristik = Luftlinie / bestmögliches Tempo.

> 🔴 **BERICHTIGT 2026-07-30 nach feindlicher Pruefung — dieser Abschnitt ist entfallen.**
> Die Heuristik-Falle aus V11 §10.4 (Bergab-Bonus, Klemme 0,5, „kleinsten vorkommenden Faktor
> messen") ist **gegenstandslos**: das gebaute Modell hat **keine untere Klemme** mehr
> (`api/_internal/routing/terrain-factor.php:60-63`, festgenagelt durch
> `assert(!defined('AVESMAPS_TERRAIN_FACTOR_MIN'))`). Der kleinste vorkommende Faktor ist **exakt
> 1,0**, die Schaetzung verliert keine Schaerfe, und die geplante Messung entfaellt ersatzlos.
> 💣 Die Funktion heisst ausserdem nicht mehr `avesmapsTerrainTimeFactor`, sondern
> `avesmapsTerrainLeistungsFactor` (Leistungskilometer / DIN 33466, Owner-Entscheid 2026-07-30).

### 5.4 💣 Die Linie wird an die echten Endpunkte genäht

Der A\* läuft zwischen **Zellmitten**. Bei Zellweite 0,5 liegt eine Zellmitte bis **0,35 Einheiten**
neben dem echten Ort. Gemessen an Gluckenhang → Wasserburg: der A\* meldete **2,2** Einheiten bei
einer Luftlinie von **2,5** — eine Strecke *kürzer* als die Luftlinie, was nicht sein kann.

Die erste und die letzte Zellmitte werden deshalb durch die **echten Koordinaten** ersetzt, und die
Länge wird über die genähte Punktfolge neu gerechnet. Ohne das lügen alle kurzen Hüpfer.

### 5.5 Auslöser 1 — automatisch

In `avesmapsBuildMinimalRouteResultFromRequest`, **nach** dem Dijkstra:

1. Luftlinie zwischen `from` und `to`, echte Wegstrecke der gefundenen Route.
2. 💣 **Die echte Strecke, nicht die Kosten.** Eine Querfeldein-Kante trägt
   `distance × AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR` (×25). Wer die Kosten summiert,
   misst den Aufschlag — in dieser Sitzung einmal passiert und als 77× statt 15,6× berichtet.
3. Verhältnis ≤ Schwelle → fertig, nichts passiert. Der Vorfilter ist **gratis**, die beiden Zahlen
   liegen ohnehin vor.
4. Darüber: A\* laufen lassen. Ist seine **Zeit** kleiner als die der Graph-Route, ersetzt eine
   einzelne Querfeldein-Etappe die ganze Route zwischen den beiden Punkten.
5. Findet er nichts oder ist er langsamer, bleibt alles wie heute.

```php
const AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD = 3.0;
```

### 5.6 Auslöser 2 — „Hierher reisen"

Rechtsklick auf die Karte → Kontextmenü-Eintrag mit `schuh.png` → Dijkstra bis zum nächsten
benannten Ort (`findNearestLocationToLatLng`), von dort A\* zum angeklickten Punkt.

💣 **Hier liegen die großen Kisten** (§4.3/§4.4). Der Zelldeckel ist bei diesem Auslöser tragend.

⚠️ **Das Symbol muss vor dem Einbau umgesetzt werden — Owner-Vorgabe:** die Quelle
`C:\GIT\avesmaps-map-processing\icons\menu\schuh.png` ist **581 × 570 px und 490,7 KB**. Ins Repo
gehört sie als **`icons/schuh.webp`**, im Format der übrigen Menü-Icons — nachgemessen am Bestand:

| | Bestand (`icons/*.webp`) | Quelle |
|---|---|---|
| Auflösung | **80 × 80** | 581 × 570 |
| Format | **WebP lossless (VP8L)** | PNG |
| Größe | 3,6 – 7,2 KB (compass 7,2 · feder 3,6) | 490,7 KB |

Also: auf 80 × 80 skalieren, als verlustfreies WebP schreiben, Zielgröße im einstelligen KB-Bereich.
💣 **Nicht als PNG einchecken und nicht in Originalauflösung** — 491 KB für ein 80-px-Symbol wären
das Hundertfache des Bestands.

### 5.7 Die Etappe im Reiseplan

Die Etappe bleibt vom Typ `Querfeldein` und bekommt den Zusatz **„wegloses Gelände"**
(Owner-Entscheid §1). Damit weiß der Reisende, dass dort **kein gezeichneter Weg** existiert.

### 5.7a 🔴 Die Linie wird VEREINFACHT — eine Handvoll Punkte, keine Gittertreppe

**Owner-Vorgabe 2026-07-30:** *„warum viele punkte? das darf nicht geschehen, nur gelände soll
hinzukommen."*

Der rohe A\*-Pfad ist eine **Treppe aus Gitterschritten** — 13 bis 34 Punkte in den vier
Referenzfällen. Die gehört nicht in eine Etappe. Sie wird mit dem **vorhandenen** Vereinfacher
(Douglas-Peucker, den V7 beim Grenzimport schon benutzt) eingekocht, **bevor** sie die Etappe
erreicht. Gemessen bei eps **0,10**:

| Fall | roh | vereinfacht | Längenänderung |
|---|---|---|---|
| Gulbladdirstadir → Rekheim | 15 | **4** | **0,00 %** |
| Fiering → Taining | 13 | **5** | 0,00 % |
| Rovik → Skarsten | 21 | 10 | 0,00 % |
| Flammersbach → Hardorp | 34 | 6 | 0,00 % |

⭐ **eps 0,10 kostet null Länge** und lässt nur die echten Richtungswechsel stehen — bei Rekheim
sind das die vier Punkte des Bogens um die Bucht. Größere eps verkürzen die Linie (0,25 schon um
1,2–1,9 %), also **0,10 und nicht mehr**: die Länge ist eine Reisezeit, sie darf nicht schrumpfen,
weil das Rendern hübscher wird.

⚠️ **Zwei Punkte sind nicht möglich.** Eine gerade Linie ist genau das, was V13 verweigert — der
Bogen ist der Sinn der Sache. Die Etappe trägt also eine kleine Punktfolge, wie jeder gezeichnete
Weg auch, aber keine Gittertreppe.

### 5.7b Was die Punktfolge bei den Verbrauchern anrichtet

💣 Die Geometrie hat jetzt **eine Handvoll** Punkte statt zwei. Drei fertige Sachen lesen sie:

| Verbraucher | was sich ändert |
|---|---|
| **V10** „führt durch" | misst Landschaften *entlang* der Etappe — die Etappe biegt jetzt |
| **V11** Gelände | summiert Steigung und Gefälle über die Etappe |
| Reisezeit | rechnet mit der Länge — 8,4 statt 7,8 ist die ehrlichere Zahl, aber eine andere |

Keine davon bricht, aber jede muss geprüft werden. Das ist der Grund, warum V14 kein Nebenbei-Bau ist.

---

## 6. Fallen für die Umsetzung

1. 💣 **V11 §10 zuerst lesen.** Der halbe Entwurf steht dort, gemessen. §2.
2. 💣 **Gitter als Binärstring**, nie als PHP-Array — 33,2 gegen 1 Byte je Zelle.
3. 💣 **Drei Byte-Ebenen**, nicht eine; Faktoren per Maximum, nicht Produkt.
4. 💣 **Echte Strecke, nicht Kosten** beim Verhältnis (×25-Aufschlag). §5.5.
5. 💣 **Endpunkte annähen**, sonst kommen Strecken unter der Luftlinie heraus. §5.4.
6. 💣 **Start- und Zielzelle begehbar halten** — 571 Orte liegen im Wasser. §5.2.
7. 💣 **Kein zweiter Wasserbegriff** — V13s Loader wird benutzt, nicht nachgebaut.
8. ⚠️ **Heuristik-Schärfe**: kleinsten *vorkommenden* Faktor messen, nicht die Klemme annehmen. §5.3.
9. ⚠️ **Zelldeckel** greift beim Rechtsklick, nicht beim automatischen Auslöser.
10. ⚠️ **`bounds` ist snake_case** (`min_x`, nicht `minX`).
11. ⚠️ **Kein `?v=`-Bump von Hand** für den Serverteil; der Kontextmenü-Eintrag ist Client und fällt
    unter die normale Stempelung.

---

## 7. Nachweis

### 7.1 Unit (lokal, ohne DB)

- **Gitter:** Kiste aus zwei Punkten, Rand, Deckel-Vergröberung; Belegung als Binärstring gegen
  eine Referenz aus Polygonen.
- **A\*:** ein handgebautes Hindernis (Mauer mit Lücke) — der Weg muss durch die Lücke; eine
  vollständige Sperre — kein Weg; Start = Ziel; Start in Wasser (muss laufen, §5.2).
- **Endpunkte:** eine Sehne, deren Zellmitten kürzer sind als die Luftlinie — nach dem Annähen
  muss die Länge **≥ Luftlinie** sein. Genau der Gluckenhang-Fall.
- **Verhältnis:** eine Route mit Querfeldein-Etappe — die Kennzahl muss die **echte** Strecke
  benutzen, nicht die ×25-Kosten.

### 7.2 Netzlauf nach dem Deploy

Die vier Freigabelinks aus §4.1, jeder mit einer Erwartung:

| Link | erwartet |
|---|---|
| `?s=kgDKf9Ha` | Rekheim: eine Querfeldein-Etappe **~8,4** statt 121,7 mit 9 Etappen |
| `?s=7nkaEHL8` | Fiering → Taining: **~7,6** statt 52,1 |
| `?s=DFtqNyn6` | Rovik → Skarsten: **~6,4** heute (Gebirge Erprobung) bzw. **~11,2** nach `promote_trial` |
| `?s=E3BaLxNe` | Flammersbach → Hardorp: **unverändert** — 1,2× liegt unter der Schwelle |

Dazu: eine gewöhnliche Route (z. B. Gareth → Kuslik) muss **bit-gleich** bleiben — der Vorfilter
darf im Normalfall nichts anfassen.

---

## 8. Ausdrücklich NICHT in V14

- **Graph-Route und A\* kombinieren** (teils Straße, teils Abkürzung). Das braucht die Antwort auf
  „wo verlässt man den Weg?" und ist ein eigenes, größeres Vorhaben. Der Rechtsklick-Auslöser
  kombiniert nur an **einer** festen Stelle (dem nächsten benannten Ort), und das ist §10s Entscheid.
- **Der Bericht „hier fehlt vermutlich ein Weg"** — Owner-Entscheid §1, siehe §8.1 unten.
- **Die Client-Parität.** Der Client hat nicht einmal V13s Wasserlogik. Eigene Sitzung.
- **Gebirgsflächen abnehmen** und Höhen zeichnen — Redaktionsarbeit, §4.5.
- **Das Symbol umsetzen** (`schuh.png` → `icons/schuh.webp`, 80 × 80, lossless) ist Vorarbeit mit
  festen Zielwerten (§5.6), kein offener Entwurfspunkt.

### 8.1 🔴 Die Folge des abgewählten Berichts — bewusst getragen

> 🔴 **Eine frühere Fassung dieses Abschnitts war falsch und ist berichtigt.** Sie behauptete, drei
> der vier Referenzfälle hätten „kein modelliertes Hindernis", geschlossen aus „der A\* liefert
> ungefähr die Luftlinie". **Der Schluss ist unzulässig** — ein Weg kann ein Hindernis knapp
> umgehen, ohne lang zu werden: Fiering → Taining hat **40,7 % Wasser auf der Sehne** und kommt
> trotzdem auf 8,16 gegen 7,63 Luftlinie heraus. Der Owner hat widersprochen, die Geometrie hat ihm
> recht gegeben (§4.1a).

Der Befund ist nach der Nachprüfung **zweigeteilt**, und beide Hälften sind wahr:

| Grundgesamtheit | mit `meer`/`see`/`gebirge` auf der Sehne |
|---|---|
| die vier Fälle des Owners | **3 von 4** — und der vierte (1,2×) löst nie aus |
| acht systematisch gefundene Auslösefälle (§4.3) | **2 von 8** |

⭐ **Der Unterschied ist erklärbar, und er ist die eigentliche Einsicht:** der Owner hat seine Fälle
ausgewählt, indem er **auf die Karte geschaut** hat — und die Kartengrafik zeigt Gelände, das als
Daten nicht existiert. Genau wie bei Rovik → Skarsten, wo der Berg erst existierte, nachdem er
gezeichnet wurde. Die systematische Stichprobe findet dagegen überwiegend **Datenlücken**, weil der
Datenbestand dünn ist (§4.5).

**Was bleibt:** bei sechs der acht Auslösefälle — Gluckenhang → Wasserburg (2,5 Luftlinie, 55,9
Wegstrecke), Catco → Fort Südergart, Branfeld → Burg Nardesbroch, Schwarzfall → Ungolfsroden,
Albentrutz → Clachoven, Eslamsroden → Quastenbroich — steht **nichts** in den Daten. Dort fehlt
entweder ein gezeichneter Weg, oder das Gelände ist noch nicht gezeichnet. V14 repariert diese
Routen und macht nicht unterscheidbar, welches von beidem es war.

Abgemildert wird es durch den Hinweis **„wegloses Gelände"** an der Etappe. Die acht Fälle liegen
als Liste vor, falls der Bericht später doch gewünscht wird.

⚠️ **Ein Nebenlicht, das zusammenpasst:** bei Felshöhe → Salzsteige liegt **„Windhagberge"** auf
91 % der Sehne — genau die Fläche, die laut `10073976` als einzige von 17 kein Höhenraster bauen
konnte (kein Gipfel, keine gespeicherte Höhe). Die Datenlücken der Landschaftsebene und die
Auslösefälle des A\* zeigen auf dieselben Stellen.

---

## 9. Stellschrauben

| Konstante | Vorschlag | sichere Spanne | Wirkung |
|---|---|---|---|
| `AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD` | **3,0** | 3 … 8 | kleiner = mehr Routen betroffen: 3× sind 9,1 %, 5× sind 3,8 %, 8× sind 0,53 %. ⚠️ Nicht unter 3 — der Median liegt bei 1,57× |
| Zellweite | **0,5** | 0,25 … 1,0 | größer = billiger, aber ab 1,0 werden 24 Seen zu Mauern (V11 §10.2) |
| Zelldeckel | **150.000** | 100k … 200k | greift nur beim Rechtsklick |

---

## Selbstprüfung

**Erzeuger-Prüfung** (Verbraucher ohne Erzeuger *und* Erzeuger ohne Sperre):

| gebraucht von | Name | erzeugt von |
|---|---|---|
| §5.2 Wassersperre | Wasserpolygone im Request | **V13 ✅ live** |
| §5.2 Geländekosten | `offroad_factor` je Art | V11 §4.5 ✅ (Spalte angelegt) |
| §5.2 Höhenkosten | gespeichertes Höhenraster | V11 §3 ✅ (live, 3.331 Profilzeilen) |
| §5.3 Heuristik | kleinster vorkommender Faktor | ✅ **entfaellt** — konstruktionsbedingt 1,0 (§5.3) |
| §5.6 Ausstiegsort | PHP-Zwilling von `findNearestLocationToLatLng` | 🔴 **NEUBAU** — existiert nur im Client, und `POST /api/route/` nimmt keine Koordinate |
| §5.7a Vereinfachung | Douglas-Peucker in PHP | 🔴 **NEUBAU** — der vorhandene ist Leaflets `L.LineUtil.simplify`, null Treffer in `api/` |
| §5.2 Hoehe | bbox-begrenzter Rasterlader | 🔴 **NEUBAU** — `heightmap.php:12-14` verbietet dem Routing-Pfad das Rasterlesen ausdruecklich |
| §5.5 Verhältnis | Luftlinie + echte Wegstrecke | liegt nach dem Dijkstra vor ✅ |
| §5.6 Ausstiegsort | `findNearestLocationToLatLng` | vorhanden ✅ |
| §5.7 Hinweistext | „wegloses Gelände" | 🔴 neu, i18n-Tabelle (AGENTS.md §8) |

| Erzeuger von Querfeldein-Geometrie | von V14 berührt |
|---|---|
| `avesmapsConnectClientCompatibleDetachedGraphComponents` | nein — bleibt die Komponenten-Reparatur |
| `avesmapsConnectClientRouteWaypointsToNearestLandPath` | nein — bleibt der Wegpunkt-Anker |
| **A\* (neu)** | §5.5 + §5.6 |

**Was diese Spec NICHT beantwortet:** ob die Gebirgs-Erprobungsflächen abgenommen werden (§4.5,
Owner), ob der Bericht später kommt (§7.3), und wie groß der kleinste vorkommende Geländefaktor ist
(§5.3 — wird in der Umsetzung gemessen, nicht hier geschätzt).

---

Siehe [[landschaften-v13-querfeldein-wasser]], [[landschaften-v11-gelaende-reisezeiten]],
[[landschaften-v9-zugehoerigkeit]], [[routing-two-server-switches]],
[[offline-graph-rebuild-validated-against-live]], [[oekosystem-terrain-routing]].
