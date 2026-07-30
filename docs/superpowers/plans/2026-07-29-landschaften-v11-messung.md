# Landschaften V11 — Messungen

**Diese Datei sammelt, was gemessen wurde — sie ist kein Entwurf.** Sie wächst in drei Schritten:
Aufgabe 1 (Bestand), Aufgabe 11 (Verteilung und Kurve), Aufgabe 12 (Abnahme).

## 1. Bestand, nachgezählt am 2026-07-29

| | Spec (ecosystem_revision 3983) | heute | Abweichung |
|---|---|---|---|
| Gebirgsflächen | 15 | 16 | +6,7% |
| Gipfel gesamt | 67 | 67 | — |
| **Gipfel mit Höhe** | **16** | **16** | **—** |
| Wege | 5.655 | 5.657 | +0,04% |
| Wegstücke | 36.139 | 36.153 | +0,04% |
| mittlere Wegstücklänge | 1,436 E | 1,4355 E | −0,03% |
| Raster roh, alle | 1,01 MB | 1,0157 MB | +0,67% |
| größtes Raster roh | 286 KB | 285,4 KB | −0,21% |

Verfahren: je eine Anfrage an `/api/app/ecosystem-areas.php` und `/api/app/map-features.php`, danach offline ausgezählt. Keine Schleife gegen die API.

**Hinweis zur Messung:** Der Bestand ist stabil. Abweichungen liegen alle unter 10 % und reflektieren Wachstum der Karte seit ecosystem_revision 3983. Die Gebirgsflächen-Anzahl ist um 1 gestiegen (15 → 16), alle anderen Kennzahlen bleiben im Plan. `peaks_with_height` wurde mit korrigiertem Lesepfad (`properties.height_schritt` statt `properties.properties.height_schritt`) ermittelt.

---

## 1a. 🔴 Die Grundlinie, gegen die Abnahmeschritt 1 vergleicht

Gemessen am **2026-07-29 am Livebestand, VOR dem Deploy dieses Zweigs** — eine Sonde, keine Schleife:

```
POST https://avesmaps.de/api/route/   {"from":"Gareth","to":"Thorwal"}
cost     = 65.60202533378045
segments = 45
```

**Mit Schalter AUS muss dieselbe Anfrage nach dem Deploy exakt diese Zahl liefern.** Nicht „ungefähr" —
bit-genau. Weicht sie ab, hat V11 in seinem Ruhezustand etwas angefasst, und das ist ein Grund
anzuhalten, kein Rundungsproblem.

Was diese Zusicherung im Code trägt: bei leerer Terrain-Karte greift der Vor-V11-Zweig mit dem
**geteilten** Verbindungsobjekt, und am Wegpunkt-Anker ist der Elternfaktor exakt `1.0`, sodass
`$originalTime / 1.0` in IEEE 754 verlustfrei ist. Die Prüfung hat das zusätzlich empirisch belegt:
`client-graph.php` aus dem Stand vor der Faktor-Anwendung neu gebaut und den **vollständigen
serialisierten Graphen** (16 Kanteneinträge, Land + Fluss + Anker) gegen den neuen verglichen —
byte-identisch.

---

## 1b. 🔴 Was NIE ausgeführt wurde — die Reihenfolge für die Abnahme

💣 **Die Entwicklungsumgebung hat PDO, aber NULL Treiber** (`PDO::getAvailableDrivers()` liefert `[]`;
weder `pdo_mysql` noch `pdo_sqlite` sind einkompiliert). **Keine einzige datenbankberührende Zeile
dieses Zweigs wurde je ausgeführt** — auch nicht gegen eine Speicherdatenbank. Ebenso wenig wurde eine
Editor-Oberfläche je angeklickt (Overlay-iframe mit Anmeldung).

Die Abnahme ist deshalb **kein Nachweis, sondern der erste Lauf.** Nach Risiko geordnet:

| # | Pfad | Worauf achten |
|---|---|---|
| 1 | **Profillauf (`terrain_profile_step`)** | 💣 `rows_with_profile` **> 0**. Steht es auf 0, *obwohl* Raster da sind, verfehlt der Verbund die Wege — **nicht** die Kurve. Genau dieser Fehler kostete V10 einen Totalausfall. |
| 2 | **`heightmap_put` für eine echte Fläche** | Base64 → Wächter → `gzdeflate` → LONGBLOB → `gzinflate` → `unpack('v')`. Bytereihenfolge, die Invariante `w·h·2`, und das DECIMAL-Hin-und-Zurück von `origin_x`/`cell_size` treffen hier zum ersten Mal auf die Wirklichkeit. **Ein abgeschnittenes Blob sieht aus wie ein ganzes.** |
| 3 | **Rasterlauf bei ~1,4 Mio Pixeln** | Das 32-Zeilen-Band ist das Einzige zwischen dir und einem eingefrorenen Tab. Die Kachel muss sichtbar hochzählen. |
| 4 | **Eine Route mit Schalter AN, zeitlich gemessen** | ~5.657 Zeilen plus `json_decode` je Besucheranfrage — nie gemessen. Einmal vorher, einmal nachher. |
| 5 | **`avesmapsHeightmapLoadAll` je Schritt** | Der ganze Rasterbestand wird pro Schritt neu entpackt. Bei 16 Flächen unkritisch, eine Zahl wert. |
| 6 | **Wegpunkt-Anker an echter Geometrie** | Unit-getestet (absolute Werte, drei Mutationen rot gesehen), aber nie live. `via` wird abgewiesen, es erreicht ihn also nur ein gestrandeter Start/Zielort. |
| 7 | **Veraltungs-Meldung** | `debug.context.terrain.stale` nach einer geänderten Gipfelhöhe. Kachel und Route sind **zwei unabhängige Vergleiche**, die noch nie gemeinsam gesehen wurden. |

⚠️ **Und die neue DDL läuft bei jedem Ökosystem-Lesen mit.** Drei `CREATE TABLE` plus ein `ALTER`
stehen in `avesmapsEcosystemEnsureTables`. Ist eine davon auf diesem MySQL fehlerhaft, bricht der
Landschaften-Editor sofort nach dem Deploy — laut, nicht still. Die generierten Spalten brauchen
MySQL ≥ 5.7; dieselbe Untergrenze gilt für die `JSON`-Spalten, die dort längst stehen.

**Der Schalter bleibt AUS**, bis Abschnitt 2 vorliegt und die obere Klemme entschieden ist.
*(Erledigt am 2026-07-30 — siehe Abschnitt 2.)*

---

## 1c. Abnahmeschritt 1 — bestanden, live, am 2026-07-30

Nach dem Deploy von `bbe76741` (Schalter AUS, wie ausgeliefert):

```
cost      65.60202533378045   ← bit-identisch mit der Grundlinie
segments  45                  ← unverändert
terrain   {"enabled":false,"requested":true,"profile_rows":0,"matched_ways":0,"stale":false}
api rev   14
segment   {"terrain_time_factor":1, "ascent_schritt":null, "descent_schritt":null}
```

✅ **V11 fasst im Ruhezustand keine einzige veröffentlichte Zahl an.** `ascent_schritt: null` statt
`0` bestätigt zugleich, dass „keine Höhendaten" und „gemessen und eben" auseinandergehalten werden.

### 💣 Und ein Zwischenfall beim selben Deploy — behoben, aber die Lehre bleibt

`GET /api/app/ecosystem-areas.php` antwortete unmittelbar nach dem Deploy mit **500**. Ursache: die
Tabelle `ecosystem_area_heightmap` ging mit zwei **generierten Spalten** (`max_x`/`max_y`, `STORED`)
plus Index darüber live; auf diesem MySQL scheitert das `CREATE`. Weil
`avesmapsEcosystemEnsureTables` **auf dem Lesepfad** läuft, nahm das sofort die Datenquelle des
ganzen Landschaften-Editors mit.

Behoben in `cc54dd67` durch Entfernen der Spalten — sie waren **totes Schema**: nichts las `max_x`,
`max_y` oder den Index (zweimal per grep belegt), und `avesmapsHeightmapLoadAll` rechnet dieselbe
Grenze ohnehin in PHP. Danach wieder `200`, 687 Flächen, 16 Gebirge, und `cost` weiterhin
bit-identisch.

**Warum es niemand vorher sah:** die Entwicklungsumgebung hat PDO, aber **null Treiber** — keine DDL
dieses Zweigs konnte je ausgeführt werden. `php -l` prüft PHP-Syntax, nicht SQL. Ausgerechnet die
einzige exotische SQL-Anweisung des Zweigs war die einzige, die niemand ausprobieren konnte.
Regel daraus: **DDL in einer selbstheilenden Funktion auf einem Lesepfad bleibt langweilig**, und
totes Schema ist dort nicht gratis.

---

## 2. Das Bild, am 2026-07-30 mit eingeschaltetem Schalter gemessen

Zwei Sonden, Gareth → Thorwal, einmal normal und einmal mit `terrain: false`.
Stand: 15/16 Raster (Windhagberge fehlt, s. u.), 583 von 5.676 Wegen mit Profil, Lauf 7,3 s.

| | cost | Etappen |
|---|---|---|
| **mit Gelände** | **66,1865** | 45 |
| ohne Gelände (`terrain:false`) | 65,6020 | 45 |
| Grundlinie vor dem Deploy | 65,6020 | 45 |

**Aufschlag: +0,89 %.** `terrain:false` liefert die Grundlinie **bit-identisch** — der Ausstieg
funktioniert. ⭐ **Die Route ist dieselbe** (identische Kantenfolge und Knoten): das Gelände hat hier
nur den Preis geändert, nicht die Wahl. Dass es umrouten *kann*, bleibt wahr (§8.3) — auf dieser
Strecke tut es das nicht.

### Die betroffenen Etappen — es ist genau der Koschberge-Pass

8 von 45 Etappen tragen ein Profil, 6 davon einen Faktor ≠ 1.

| Wegart | Etappe | Steigung | Gefälle | Faktor | km/h (statt 4,5) |
|---|---|---|---|---|---|
| Reichsstrasse | Kreuzung-1977 → Paßwacht | **23,9 %** | — | **2,195** | 2,05 |
| Reichsstrasse | Dunkelhain → Kreuzung-1977 | 23,3 % | — | 2,166 | 2,08 |
| Reichsstrasse | Paßwacht → Kammhütten | 12,7 % | — | 1,633 | 2,76 |
| Reichsstrasse | Kammhütten → Trottweiher | 1,4 % | — | 1,071 | 4,20 |
| Reichsstrasse | Koschwacht → Gratenfels | — | 0,1 % | 0,998 | 4,51 |
| Reichsstrasse | **Koschwacht → Dunkelhain** | 0,5 % | **16,6 %** | **0,856** | **5,26** |
| Reichsstrasse | Trottweiher → Anpforten | 0,0 % | 0,0 % | 1,000 | 4,50 |
| Reichsstrasse | Gratenfels → Kreuzung-818 | 0,0 % | 0,0 % | 1,000 | 4,50 |

✅ Abnahmeschritt 3: die Koschberge-Etappen sind langsamer, und zwar genau die, die hinaufführen.
✅ Owner-Entscheid 3 wirkt sichtbar: **bergab 5,26 km/h statt 4,5** auf dem 16,6-%-Gefälle.
✅ Die letzten beiden Zeilen sind **gemessen eben** (`ascent_schritt: 0`, Faktor exakt 1,000) und
damit unterscheidbar von den 37 Etappen ohne Höhendaten (`null`) — die Regel, an der die halbe Spec
hängt, ist im Livebetrieb sichtbar.

### 🔴 Die Klemmen-Frage lässt sich mit diesen Daten NICHT beantworten

| | Vorgabe | höchster/tiefster gemessener Wert |
|---|---|---|
| obere Klemme | 4,0 | **2,195** — nie erreicht |
| untere Klemme | 0,5 | **0,856** — nie erreicht (Kurvenminimum ist ohnehin 0,8125) |

Der steilste Punkt der meistbefahrenen Gebirgsquerung der Karte liegt bei **2,195**. Bis zur
Sättigung (Steigung 0,6 → Faktor 4,0) fehlt mehr als die Hälfte. **Die Frage „bleibt 4,0?" hat
derzeit keine Datengrundlage** — es gibt nichts, was daran anstößt. Sie wird erst entscheidbar, wenn
echte Gipfelhöhen erfasst sind.

### ⚠️ Woran die Zahlen heute wirklich hängen

- **Nur 10 der 67 Gipfel mit Höhe liegen in einer Gebirgsfläche**, davon **9 im Finsterkamm**. Sechs
  erfasste Höhen liegen außerhalb jeder Fläche und tragen deshalb **nichts** bei (ein Gipfel wird nur
  *innerhalb* eines Feldes zum Buckel).
- Alle übrigen 15 Flächen laufen auf der eingetragenen **Maximalhöhe**, überwiegend dem 2000er-Wert.
- **Die 23,9 % Steigung auf einer Reichsstraße** kommen daher: das prozedurale Rauschen weiß nicht,
  wo die Straße verläuft, und die Straße nimmt, was darunter liegt. Für eine Passstraße über die
  Koschberge ist 2,05 km/h vertretbar (zwischen Gebirgspass 1,5 und Pfad 3,0) — aber es ist eine
  Zahl aus Platzhalter-Gelände, nicht aus vermessenen Bergen.
- **Windhagberge hat kein Raster** und das ist kein Fehler: keine Gipfel darin, keine Maximalhöhe
  eingetragen. Das Modul erfindet dort korrekt nichts. Ein Eintrag im Flächendialog behebt es.

### 🔧 Entscheid des Owners

- [x] Bild gesehen am **2026-07-30**.
- [x] Schalter **AN** — der Effekt ist klein (+0,89 %), richtungsrichtig, wirkt nur dort, wo
      Höhendaten liegen, ändert keine Routenwahl, und `terrain:false` liefert jederzeit die alten
      Zahlen.
- [ ] Obere Klemme **vertagt** — nicht entscheidbar, solange nichts über 2,2 kommt. Neu bewerten,
      wenn die Gipfelhöhen erfasst sind.
