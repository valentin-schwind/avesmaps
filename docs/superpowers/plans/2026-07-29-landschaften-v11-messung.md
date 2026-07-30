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
- [x] Obere Klemme **vertagt** — nicht entscheidbar, solange nichts über 2,2 kommt. Neu bewerten,
      wenn die Gipfelhöhen erfasst sind.
      ⤳ **Überholt am selben Tag:** aus der Routensicht war das richtig, über den ganzen Bestand
      gemessen ist die Frage entscheidbar. Der Owner hat sie entschieden — §2a unten.

---

## 2a. Die Verteilung über den ganzen Bestand — Aufgabe 11, nachgeholt am 2026-07-30

§2 hat das Bild **einer** Route gemessen und daraus geschlossen, die Klemmen-Frage sei nicht
entscheidbar. Über den ganzen Bestand gemessen ist sie es.

**Verfahren — offline nachgebaut, gegen live geprüft.** Die Verteilung steht in `path_terrain`, und
dort kommt niemand ohne Datenbank hin (§1b: PDO ohne Treiber). Sie ist aber **rekonstruierbar**: die
Raster entstehen ohnehin im Browser aus zwei rein öffentlichen Nutzlasten. Also je **eine** Anfrage
an `ecosystem-areas.php` und `map-features.php`, dann derselbe Browser-Code, den die Editor-Kachel
`runHeightmaps()` ausführt (`buildEcosystemHeightStack` → `ecosystemHeightmapGrid` →
`rasterizeEcosystemHeightField`), und darauf die **echten** Produktionsfunktionen
`avesmapsHeightmapDecode`, `avesmapsHeightmapSampleSum`, `avesmapsTerrainProfileForLine`,
`avesmapsTerrainTimeFactor`. Keine Portierung, keine Nachbildung, keine Schleife gegen STRATO.

Ein Nachbau ist nur so viel wert wie seine Deckung mit dem Livebestand:

| Prüfmarke | live | Nachbau |
|---|---|---|
| Raster | 15 von 16, Windhagberge fehlt (§2) | 15 von 16, Windhagberge fehlt |
| Raster roh, alle | 1,0157 MB über 16 Flächen (§1) | 0,9590 MB über 15 — mit Windhagberge ≈ 1,016 MB |
| Wege mit Profil | 583 von 5.676 (§2) | **583** von 5.676 |
| die 8 Etappen mit Profil | Anstieg, Gefälle, Faktor | **8 von 8 bit-genau**, größte Abweichung **0,0000 Schritt** |

💣 **Die Geometrie einer Etappe liegt in der gespeicherten Eckenfolge des Weges, nicht in der
Fahrtrichtung.** Bei fünf der acht Etappen kam der Nachbau mit getauschtem Anstieg und Gefälle
heraus — die Route läuft diese Wege rückwärts, und `avesmapsRouteReverseTerrain` tauscht dann beides.
Wer nur die Vorwärtsrichtung vergleicht, verwirft fünf exakte Treffer als Abweichung.

### Anstieg und Gefälle (Schritt)

Perzentile nearest-rank, **je Größe getrennt gebildet** — die Zeile „p90" ist also nicht derselbe Weg.

| je Weg (n=583) | Median | p90 | p99 | Maximum | Mittel |
|---|---|---|---|---|---|
| Anstieg | 0 | 747 | 2.800 | 5.229 | 207,7 |
| Gefälle | 0 | 873 | 3.007 | 6.650 | 233,4 |

| je Wegstück (n=4.300) | Median | p90 | p99 | Maximum | Mittel |
|---|---|---|---|---|---|
| Anstieg | 0 | 32,8 | 548,1 | 3.503,9 | 28,2 |
| Gefälle | 0 | 66,5 | 604,9 | 3.557,4 | 31,6 |

### Steigung und Faktor

| je Weg (n=583) | Median | p90 | p99 | Maximum | Mittel |
|---|---|---|---|---|---|
| Steigung | 0,00 % | 3,40 % | 18,46 % | **40,78 %** | 1,05 % |
| Gefälle | 0,00 % | 3,92 % | 23,33 % | 40,39 % | 1,21 % |
| Faktor | 1,0000 | 1,1152 | 1,9231 | **3,0388** | 1,0392 |

| je Wegstück (n=4.300) | Median | p90 | p99 | Maximum | Mittel |
|---|---|---|---|---|---|
| Steigung | 0,00 % | 1,23 % | 16,45 % | **43,97 %** | 0,82 % |
| Gefälle | 0,00 % | 2,05 % | 20,56 % | 52,04 % | 1,07 % |
| Faktor | 1,0000 | 1,0157 | 1,8227 | **3,1783** | 1,0305 |

⭐ **Der Median ist in jeder Zeile 1,0000.** Ein Weg mit Profil ist im Regelfall ein Weg über
gemessen ebenen Boden — das Gelände wirkt auf ein knappes Zehntel des Bestands und dort wieder nur
auf dessen Ränder.

**Kleinster tatsächlich vorkommender Faktor** (Spec §10.4): **0,8126** je Wegstück, 0,8129 je Weg —
und über beide Fahrtrichtungen **genau 0,8125**, das Kurvenminimum. Die theoretische Schranke ist die
echte.

⚠️ **Alle Tabellen dieses Abschnitts stehen in der gespeicherten Eckenrichtung**, weil `path_terrain`
so speichert. Für die Klemmenfrage ist das nicht genug — siehe den Kasten weiter unten.

### Die zehn am stärksten verlangsamten Wege

| Name | Art | Anstieg | Gefälle | Länge | Steigung | Faktor |
|---|---|---|---|---|---|---|
| Weg-5 | Weg | 869 | 0 | 0,710 | 40,78 % | **3,0388** |
| Gebirgspass-3679 | Gebirgspass | 740 | 0 | 1,081 | 22,81 % | 2,1404 |
| Gebirgspass-4916 | Gebirgspass | 1.936 | 27 | 3,005 | 21,48 % | 2,0694 |
| Strasse-5121 | Gebirgspass | 299 | 0 | 0,476 | 20,93 % | 2,0463 |
| Pfad-821 | Pfad | 1.350 | 57 | 2,155 | 20,89 % | 2,0313 |
| Schattenbachpass | Pfad | 353 | 0 | 0,637 | 18,46 % | 1,9231 |
| Reichsstraße 3 | Reichsstrasse | 1.930 | 52 | 3,869 | 16,63 % | 1,8246 |
| Gebirgspass-92 | Gebirgspass | 665 | 25 | 1,386 | 16,00 % | 1,7909 |
| Gebirgspass-106 | Gebirgspass | 1.472 | 0 | 3,262 | 15,04 % | 1,7520 |
| Pfad-3676 | Pfad | 448 | 0 | 1,163 | 12,84 % | 1,6421 |

Die Koschberge-Querung aus §2 ist hier die „Reichsstraße 3" — sie ist **Platz 7**, nicht die Spitze.
Sie zeigt zugleich, was die Richtungsabhängigkeit anrichtet: gespeichert steigt sie um 1.930 (Faktor
1,8246), auf der Route Gareth → Thorwal wird sie **abwärts** befahren und trägt dort 0,8561.

### Die zehn am stärksten verlangsamten Wegstücke

| Weg | Art | Anstieg | Gefälle | Länge | Steigung | Faktor |
|---|---|---|---|---|---|---|
| Radrompfad | Pfad | 3.503,9 | 110,6 | 2,656 | **43,97 %** | **3,1783** |
| Gebirgspass-94 | Gebirgspass | 1.318,8 | 0,0 | 1,033 | 42,56 % | 3,1281 |
| Weg-5 | Weg | 868,6 | 0,0 | 0,710 | 40,76 % | 3,0378 |
| Gebirgspass-4916 | Gebirgspass | 776,4 | 0,0 | 0,675 | 38,36 % | 2,9180 |
| Pfad-822 | Pfad | 655,8 | 0,0 | 0,650 | 33,63 % | 2,6815 |
| Gebirgspass-4916 | Gebirgspass | 347,2 | 0,0 | 0,357 | 32,42 % | 2,6210 |
| Flussweg-5091 | Flussweg | 965,0 | 97,2 | 1,059 | 30,39 % | 2,4764 |
| Karawanenroute von Malkillabad … | Gebirgspass | 1.592,1 | 0,0 | 1,920 | 27,64 % | 2,3822 |
| Pfad-3827 | Pfad | 882,6 | 0,0 | 1,099 | 26,78 % | 2,3391 |
| Pfad-3855 | Pfad | 673,0 | 0,0 | 0,859 | 26,11 % | 2,3055 |

⭐ Das Wegstück ist die **feinste** Körnung, die es gibt. Eine Graph-Kante spannt ein oder mehrere
Wegstücke, und ihre Steigung ist das längengewichtete Mittel der Stücke — das Maximum über Stücke
ist damit eine **obere Schranke** für alles, was eine Kante je tragen kann. Die 43,97 % sind also
nicht „irgendwo tief drin", sondern das Steilste, dem ein Reisender überhaupt begegnen kann.

### Nach Wegart, je Wegstück

| Art | n | Median | p90 | Maximum |
|---|---|---|---|---|
| Flussweg | 1.729 | 1,0000 | 1,0000 | 2,4764 |
| Gebirgspass | 445 | 1,0000 | 1,4318 | 3,1281 |
| Pfad | 1.085 | 1,0000 | 1,0000 | 3,1783 |
| Reichsstrasse | 109 | 1,0000 | 1,0000 | 1,8247 |
| Seeweg | 78 | 1,0000 | 1,0000 | 1,0000 |
| Strasse | 554 | 1,0000 | 1,0000 | 1,7391 |
| Weg | 133 | 1,0000 | 1,0666 | 3,0378 |
| Wuestenpfad | 167 | 1,0000 | 1,0000 | 1,4731 |

### 🔴 Die Klemmen-Frage, jetzt mit Datengrundlage

🔴 **Alle Zahlen bis hierher stehen in der GESPEICHERTEN Eckenrichtung des Wegs — und das ist nicht
die Frage, die die Klemme stellt.** Ein Weg wird in beiden Richtungen befahren, Anstieg und Gefälle
tauschen dabei (`avesmapsRouteReverseTerrain`), und die Kurve ist **nicht symmetrisch**: bergauf
straft sie linear, bergab belohnt sie erst und bremst dann quadratisch. Weil das größte **Gefälle**
(6.650) größer ist als der größte **Anstieg** (5.229), liegt das wahre Maximum in der Rückrichtung.
Maßgeblich ist also `max` über beide Richtungen je Zeile:

| | Vorgabe | gespeicherte Richtung | **über beide Richtungen** |
|---|---|---|---|
| höchster Faktor je Wegstück | — | 3,1783 | **3,6019** |
| höchster Faktor je Weg | — | 3,0388 | 3,0388 |
| obere Klemme | 4,0 | 0 von 4.300 | **0 von 4.300** |
| Sättigung bergauf | Steigung 0,60 | 43,97 % | **52,04 %** |
| untere Klemme | 0,5 | 0 von 4.300 | **0**; kleinster Faktor **0,8125** |

Das steilste Stück, dem ein Reisender überhaupt begegnen kann, ist der **Vildrom** — ein **Flussweg**,
Gefälle 687,1 auf 0,440 Einheiten, aufwärts befahren also **Faktor 3,6019**. Siehe dazu den
Wasserwege-Befund unten; das Maximum der ganzen Karte hängt an genau der Frage, die dort offen ist.

Wie viele Wegstücke eine Klemme treffen würde, über beide Richtungen:

| Klemme | geklemmte Wegstücke | Anteil |
|---|---|---|
| 2,0 | 76 | 1,767 % |
| 2,5 | 22 | 0,512 % |
| 3,0 | 11 | 0,256 % |
| 3,5 | 1 | 0,023 % |
| 4,0 | **0** | 0 % |

**§2s Schätzung war für ihre Route richtig und für den Bestand deutlich zu pessimistisch — aber die
Luft ist kleiner, als die gespeicherte Richtung vermuten lässt.** Aus der Routensicht (höchster Faktor
2,195) fehlte „mehr als die Hälfte" bis zur Sättigung. Über beide Richtungen gemessen fehlt der Faktor
**1,15**, also **15 %**. Das ist der Unterschied zwischen „nicht entscheidbar" und „knapp".

⭐ Und die untere Klemme trifft es genau: über beide Richtungen ist der kleinste vorkommende Faktor
**0,8125** — das Kurvenminimum, exakt. Die theoretische Schranke ist erreicht, die Klemme 0,5 bleibt
trotzdem tot.

### ⚠️ Der 2,67×-Anker wird von den Daten nicht getragen

Spec §7.2 wollte, dass „ein typischer Bergweg nahe der 2,67× landet" — dem Verhältnis, das die
veröffentlichte Tempotabelle zwischen Gebirgspass (1,5 km/h) und Straße (4,0 km/h) ohnehin trägt.

| | |
|---|---|
| Wegstücke mit Faktor ≥ 2,667 | **5 von 4.300** (0,12 %) |
| typisches Gebirgspass-Wegstück **mit Profil** | Median **1,0000**, p90 1,4318 |
| Gebirgspass-Wegstücke mit Faktor genau 1,0000 | **137 von 445** |

Die Kurve hält ihren Anker per Konstruktion ein (`1 + 5,0 · 0,3333 = 2,667`, und
`terrain-factor-test.php` hält das fest — der Test läuft grün). **Die Daten erreichen ihn nicht.**
Die Ursache ist die, die §2 schon benannt hat: nur 10 der 67 Gipfel mit Höhe liegen in einer
Gebirgsfläche, 9 davon im Finsterkamm, und 15 der 16 Flächen laufen auf ihrer eingetragenen
Maximalhöhe — überwiegend dem 2000er-Platzhalter. Ein Gebirge, das flach ist, macht keinen Weg steil.
**Das ist ein Datenauftrag, kein Kurvenauftrag** — an den vier Konstanten wurde deshalb nichts
geändert.

### ⚠️ Und ein Befund, der keine Klemmenfrage ist: das Gelände wirkt auch auf Wasserwege

`avesmapsRouteAttachTerrain` kennt **keine Wegart-Weiche** (nachgesehen in `client-graph.php` um
Zeile 136) — der Steigungsfaktor greift auf jeden Wegtyp, auch auf `Flussweg`.

| Art | Wegstücke mit Profil | davon Faktor ≠ 1 | langsamer / schneller | Median der bewegten | Maximum |
|---|---|---|---|---|---|
| Flussweg | 1.729 | **293** (16,9 %) | 133 / 160 | 0,9804 | **2,4764** |
| Seeweg | 78 | 2 (2,6 %) | 0 / 2 | 0,9705 | 0,9738 |

Ein Fluss wird damit **zweimal** bepreist: über `flow_time_factor` (Strömung, geklemmt auf
[1,0 … 3,0]) und zusätzlich über die Steigung des prozeduralen Höhenfelds, das nichts über den
Flusslauf weiß. Beim Seeweg ist es heute folgenlos, beim Flussweg trifft es 293 Wegstücke, das
steilste mit dem Faktor 2,4764 in der gespeicherten und **3,6019 in der anderen Richtung** — der
**Vildrom** ist damit das steilste Wegstück der ganzen Karte, steiler als jeder Gebirgspass. Das
Maximum, an dem die obere Klemme gemessen wird, hing also an einem **Fluss**. Spec §1 Entscheid 2 sagt
nur, dass `Gebirgspass` **nicht** ausgenommen wird; über Wasser sagt sie nichts.

### ✅ Entschieden und umgesetzt am 2026-07-30: Wasser trägt keine Steigung

Owner-Entscheid: **Flusswege und Seewege raus.** Umgesetzt an drei Stellen, mit **einer** Liste
(`AVESMAPS_TERRAIN_WATER_ROUTE_TYPES` in `terrain-store.php`, bei den übrigen Terrain-Konstanten —
`terrain-read.php` erreicht sie über `heightmap.php`, also braucht es keine zweite Kopie):

1. `avesmapsRouteAttachTerrain` weist Wasser ab, **bevor** irgendetwas gelesen wird. Das ist DAS Tor —
   `avesmapsRouteCountTerrainMatches` ruft dieselbe Funktion, der harte Zähler stimmt damit mit dem
   überein, was die Route wirklich anwendet.
2. `avesmapsRouteLoadTerrain` lädt Wasserzeilen gar nicht mehr (im SQL). Das ist die billige Hälfte:
   **150 der 583 Zeilen (26 %)** und **1.807 der 4.300 Profilpaare (42 %)** fallen bei jeder
   Besucheranfrage weg.
3. Der Profillauf schreibt keine Wasserzeilen mehr und löscht die bestehenden beim Laufstart — sonst
   blieben sie liegen, würden nie erneuert und drifteten aus der Revision.

💣 **Eine Verbotsliste, keine Erlaubnisliste.** Eine Erlaubnisliste nähme jedem künftigen
**Land**-Subtyp stillschweigend das Gelände weg, und „eine neue Wegart ist heimlich flach" ist die
Fehlerklasse, die monatelang unentdeckt bleibt. Wasser ist die Ausnahme, also wird Wasser benannt —
per Unit-Test festgehalten (ein unbekannter Subtyp **behält** seine Steigung).

💣 **Ein bestehender Test kodierte die Gegenregel** („flow and slope must multiply") und wurde rot. Er
war nicht falsch: die Regel, die er schützte — die Steigungsklemme ist **nicht** die Flussklemme
[1,0 … 3,0] — ist echt und lebt jetzt an einem **Landweg** weiter. Umgeschrieben, nicht gelöscht. Zwei
Mutationen gegengeprüft: Tor aus → rot, Erlaubnisliste statt Verbotsliste → rot.

**Was der Schnitt an den Klemmen-Zahlen ändert** (Land, beide Richtungen, 2.493 Wegstücke):

| | mit Wasser | **nur Land** |
|---|---|---|
| höchster Faktor | 3,6019 (ein Fluss) | **3,4782** |
| steilste Steigung | 52,04 % | **49,56 %** → Sättigung 21 % entfernt |
| Klemme 4,0 trifft | 0 | **0** |
| Klemme 3,5 trifft | 1 | **0** |
| Klemme 3,0 trifft | 11 | **9** |

---

## 3. Abnahme am Livebestand — Aufgabe 12, am 2026-07-30

⚠️ **Der Schalter stand bei dieser Abnahme AN** — so, wie der Owner ihn in §2 entschieden hat. Der
Plan war für „Schalter AUS" geschrieben; Schritt 1 ist deshalb über den Anfrage-Ausstieg
`terrain: false` geprüft, nicht über den Schalter. Der Schalter-AUS-Fall selbst steht bereits in §1c.
💣 Eine Sonde je Zeile, keine Schleife — insgesamt fünf Routenabfragen.

| # | Schritt | Ergebnis |
|---|---|---|
| 1 | Ausstieg liefert die Grundlinie | ✅ `terrain:false` → `cost 65.60202533378045`, **bit-identisch**, 45 Etappen, kein Segment mit Profil, alle Faktoren 1,0. Mit Gelände 66,18654735895522 (+0,891 %), **gleiche Kantenfolge**. |
| 2 | 🔴 Der harte Zähler | ⚠️ **nur mittelbar.** `debug.context.terrain` ist seit `886efeee` an die `edit`-Berechtigung gebunden und aus einer anonymen Sonde nicht lesbar. Ersatzbeweis: 8 der 45 Etappen tragen einen Anstieg ≠ null, der Verbund über `public_id` trifft also — und der Nachbau reproduziert genau die 583 Zeilen, die §2 an der Kachel gezählt hat. |
| 3 | Faktoren plausibel, Koschberge langsamer | ✅ 8 Etappen mit Profil, 6 mit Faktor ≠ 1; die vier bergauf 1,0708 / 1,6328 / 2,1662 / 2,1951, die Abfahrt 0,8561. |
| 4 | Ein Weg ohne Höhendaten | ✅ 37 der 45 Etappen `ascent_schritt: null`, **alle 37** mit Faktor genau 1,0. Daneben 2 Etappen „gemessen eben" (0/0, Faktor 1,0) — die Unterscheidung `null` ≠ `0` ist live sichtbar. |
| 5 | Wegpunkt-Anker auf einer Bergstraße | ⚠️ **teilweise, siehe unten.** |
| 6 | Weg durch einen Überlappungsstreifen | ❌ **heute nicht prüfbar, siehe unten.** |
| 7 | Zeit und Speicher | ✅ Gareth → Thorwal: mit Gelände **1,336 s**, mit `terrain:false` **1,285 s** (+4 %). Je eine Sonde, Netzwerk eingeschlossen — kein Server-Profil. |
| 8 | Nach einem Rasterlauf erste Route normal schnell | ✅ **bestanden**, vom Owner am 2026-07-30 geprüft: „sie rechnet ohne Profile etwas schneller". Genau die erwartete Richtung — die Route füllt **nichts** nach, ohne Profilzeilen gibt es nur weniger zu laden. Ein Nachfüllen im Request hätte sie *langsamer* gemacht. |

### Schritt 5 — was der Anker live belegt und was nicht

Gesucht war ein Ort, den `avesmapsConnectClientRouteWaypointsToNearestLandPath` anbindet. Die
Bedingung ist nicht „unverbunden", sondern **Knoten vorhanden, aber keine Landweg-Kante** — das
trifft Orte, die nur an einem Flussweg liegen (63 auf der Karte, 3 davon mit Anker in einem
Gebirgsraster). Zwei Sonden nach `Düsterquell`:

```
wp-slice-1-a   Gebirgspass  d=2,0537  up=545.167195564748  dn=128.1885606141545  f=1.412521
synthetic-Düsterquell->__wp_anchor_1   Querfeldein  d=21,0201  up=null  f=1.0
   … mit terrain:false:  wp-slice-1-a  up=null  dn=null  f=1.0
```

✅ **Das Teilstück rechnet sein eigenes Profil, nicht das der Elternkante.** Die ungeteilte Kante
trägt (nachgerechnet) Anstieg 566,31 auf Länge 2,133; das Teilstück meldet **545,167195564748** auf
2,0537 — ein interpolierter Wert bei voller Gleitkommagenauigkeit, also genau 96,3 % des
Elternanstiegs bei 96,3 % der Länge. Mit der Rückrechnung, die `e4a3208c` ersetzt hat, hätte hier der
gerundete Elternwert gestanden.
✅ Mit `terrain:false` ist die Teilung verlustfrei: dasselbe Teilstück, kein Profil, Faktor 1,0.

⚠️ **Zwei Punkte des Schritts sind live nicht sichtbar.** Nur die Hälfte `-a` liegt auf der Route,
`-b` führt in die andere Richtung — Punkt 1 („beide tragen verschiedene Faktoren") und Punkt 3
(„die Anstiege summieren sich auf die Elternkante") sind so nicht beobachtbar. Und weil der Anker
auf dieser Karte nahe am Ende eines Wegstücks landet, ist der Faktor des Teilstücks (1,412521) vom
Elternfaktor (1,4125) nicht zu unterscheiden. ⭐ Alle vier Punkte bleiben durch die Unit-Tests aus
Aufgabe 9b gedeckt — dieser Schritt war ausdrücklich nicht mehr ihr einziger Nachweis.

### Schritt 6 — es gibt heute keinen Überlappungsstreifen

💣 **Zuerst hat dieser Schritt einen Fehler in der eigenen Prüfung gemeldet, nicht im Code.** Der
Anstieg ist eine **Totalvariation** und damit unempfindlich gegen einen *konstanten* Summanden. Ein
zweites Raster, das einen Weg nur mit seiner **bbox** streift, liefert dort außerhalb seines Polygons
konstant 0 und ändert die Summe deshalb nicht — richtig, nicht falsch. Wer „summierter Anstieg =
Einzelanstieg" als Fehlschlag liest, hat die Regel falsch herum getestet.

Direkt an den Polygonen nachgesehen (mit `ecosystemBooleanGeometry`, dem echten Clipper):

| | |
|---|---|
| Gebirgsflächen | 16 |
| Paare mit **bbox**-Überlappung | 3 (Finsterkamm × Thasch, Goldfelsen × Hohe Eternen, Stierbuckel × Unauer Berge) |
| Paare mit **Polygon**-Überlappung | **0** — alle drei verschneiden zu nichts |

Es gibt also keinen Überlappungsstreifen, durch den ein Weg laufen könnte. Der Schritt ist am
heutigen Bestand **nicht** prüfbar; die Summenregel §5.0 bleibt durch `heightmap-read-test.php`
gedeckt, nicht durch Daten. Er wird prüfbar, sobald zwei Gebirgsflächen sich wirklich überlappen.

⚠️ Beim ersten Anlauf hat der Clipper sich nicht an das nachgebaute `window` gehängt, und ein `catch`
daneben hat jeden Aufruf als „kein Schnitt" verschluckt — die 0 war da noch **kein Messwert**. Erst
mit `require` geladen und mit einer Fehlerausgabe, die nur den Leer-Fall durchlässt, ist sie einer.

### Unit-Tests, alle vier grün

```
terrain-factor-test.php    all asserts passed   (hält die 2,67x-Verankerung)
terrain-read-test.php      all asserts passed
terrain-store-test.php     all asserts passed
heightmap-read-test.php    all asserts passed
```

### 🔧 Was jetzt beim Owner liegt

- [x] **Obere Klemme — 4,0 bleibt** (Owner, 2026-07-30). Sie greift nach dem Wasserschnitt bei keinem
      einzigen der 2.493 Land-Wegstücke, in keiner Richtung; 3,5 träfe ebenfalls 0, 3,0 träfe 9 und
      begänne, echte Unterschiede einzuebnen. Die Zahl, die neu bewertet werden muss, ist nicht die
      Klemme, sondern das Paar `UP_PENALTY = 5,0` **mit** ihr: bis zur Sättigung fehlen nur noch
      **21 %** Geländeschärfe, und echte Gipfelhöhen (Entscheid 5 erlaubt 15.000 Schritt gegen die
      heutigen ~2.000–6.000) gehen weit darüber hinaus. Dann sind zwei verschieden steile Pässe nicht
      mehr unterscheidbar — und **das** ist der Schaden, nicht die Klemme selbst.
      ⭐ Mit dem Entscheid kam die Auflage, die Rechnung **im Tempo-Dialog offenzulegen**: erledigt in
      `transport.speedInfo.slopeRule` (300 Schritt Anstieg je Meile ≈ +50 %, Deckel das Vierfache,
      bergab am schnellsten bei ~750 Schritt Gefälle je Meile, ab ~1.500 wieder langsamer als flach,
      Wasser ausgenommen) — deutsch und englisch, im Browser gegengeprüft.
- [x] **Untere Klemme 0,5 — bleibt stehen** (Owner, 2026-07-30). Sie ist tot (kleinster vorkommender
      Faktor über beide Richtungen 0,8125 = das Kurvenminimum), aber harmlos — mit steilerem Gelände
      wird das Minimum nicht tiefer, sondern nur häufiger erreicht.
- [x] **Wasserwege — raus** (Owner, 2026-07-30). Siehe den Abschnitt oben; umgesetzt und getestet.
- [x] **Abnahmeschritt 8 — bestanden** (Owner, 2026-07-30): „sie rechnet ohne Profile etwas
      schneller". Genau das war die Erwartung — die Route füllt **nichts** nach; ohne Profilzeilen
      gibt es nur weniger zu laden. Ein Nachfüllen im Request hätte sie *langsamer* gemacht, nicht
      schneller. Damit sind alle acht Abnahmeschritte durch, zwei davon eingeschränkt (5, 6).
- [ ] **Gipfelhöhen — Redaktionsarbeit, nicht Entwicklung** (Owner, 2026-07-30: „das müssen die
      Editoren machen, die müssen auch die Gipfelhöhen ermitteln"). Der eigentliche Hebel bleibt es
      trotzdem: 57 der 67 Gipfel tragen keine Höhe *in einer Fläche*, und 15 der 16 Flächen laufen auf
      dem Platzhalter — deshalb bekommt ein typischer Gebirgspass heute Faktor 1,0000. Ein Eintrag im
      Flächendialog behebt auch Windhagberge (§2). **Erst danach lohnt es, `UP_PENALTY` und die obere
      Klemme neu anzusehen** — heute fehlen bis zur Sättigung nur 21 %.
