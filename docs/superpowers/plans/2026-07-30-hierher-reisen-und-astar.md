# Instruction B — „Hierher reisen" + A\* mit Höhe

**Auftrag Owner 2026-07-30.** Zwei Ziele, ein Rechner.

**Entwurf:** `docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md` — **ganz lesen**,
diese Instruction wiederholt ihn nicht, sie ergänzt ihn um den Rechtsklick und die Höhe.

**Vorarbeit:** `2026-07-30-landschaften-erprobung-abschaffen.md` (Instruction A). Ohne sie sind die
19 Gebirge für das Routing unsichtbar und Ziel 2 lässt sich nicht abnehmen.

---

## 0. Was gebaut wird

**„Hierher reisen":** Rechtsklick auf einen **beliebigen** Punkt der Karte → Kontextmenü-Eintrag
mit dem Wanderschuh → der Planer reist bis zum nächstgelegenen Knoten des Routing-Graphen und von
dort **querfeldein per A\*** zum angeklickten Punkt.

Liegt der Punkt nicht an Land, kommt eine Meldung, dass ein Landpunkt gewählt werden muss.

Der A\* berücksichtigt dabei **Höhenunterschiede**: eine Querfeldein-Strecke geht **nicht** über
Erhebungen oder Senken, wenn es einen kostengünstigeren Weg gibt.

---

## 1. 🔴 Die Landprüfung gilt NUR dem angeklickten Punkt

**Owner-Korrektur 2026-07-30, wörtlich:** *„ORTE IM WASSER sind nicht zu überprüfen, diese können
per Straße immer erreicht werden (wenn es eine gibt). Es geht bei der Wasser-Überprüfung um
‚Hierhin reisen' → einen beliebigen Punkt auf der Karte."*

💣 **Das ist eine harte Abgrenzung, und sie war schon einmal falsch verstanden.** Eine frühere
Fassung dieser Instruction wollte prüfen, ob *Orte* an Land liegen, und maß, dass 85 von 2.674
durchfallen würden (Belhanka, Nostria …). **Diese Messung ist gegenstandslos.** Ein Ort ist über
seine Straße erreichbar, ganz gleich wo sein Punkt geometrisch liegt. Wer die Prüfung auf Orte
ausdehnt, baut einen Fehler ein, den es vorher nicht gab.

### 1.1 Die Regel

Ein angeklickter Punkt gilt als **Land**, wenn er

* in einer Fläche mit `region_type` **`kontinent`** oder **`insel`** liegt, **und**
* in **keiner** Fläche mit `region_type` **`meer`** oder **`see`** liegt.

💣 **Wasser schlägt Land.** Manche Bereiche sind doppelt deklariert — ein See in einer erhöhten
Region liegt zugleich im Kontinent. Gemessen: **0,4 %** der Karte. Dort gilt **Wasser**, und der
Nutzer bekommt die Meldung.

### 1.2 Gemessene Abdeckung (2026-07-30, `ecosystem_revision` 6211, 262.144 Rasterpunkte)

| | Anteil der Karte |
|---|---|
| Wasser | 67,6 % |
| Land | 31,7 % |
| **weder noch** | **0,7 %** |
| doppelt (Land *und* Wasser) | 0,4 % |

⭐ Die Regionen decken **99,3 %** der Karte ab — die Regel ist damit tragfähig.

⚠️ **Die 0,7 % „weder noch" werden wie Wasser behandelt**, also abgelehnt. Begründung: eine Fläche
zu erfinden, wo keine gezeichnet ist, wäre die schlechtere Antwort. Es sind Datenlücken an den
Rändern, und sie schrumpfen mit der Zeichenarbeit.

### 1.3 Die Meldung

Freundlich, in der Sache eindeutig, deutsch (AGENTS.md §8 — **in die i18n-Tabelle**, nicht inline):
sinngemäß *„Dorthin führt kein Landweg — bitte einen Punkt an Land wählen."*

⚠️ **Keine Route halb bauen und dann scheitern.** Die Prüfung steht **vor** allem anderen: kein
Dijkstra, kein Gitter, kein A\*, wenn der Punkt im Wasser liegt.

---

## 2. Der Weg dorthin — zwei Stücke

| Stück | wie |
|---|---|
| Start → nächster Graphknoten | **Dijkstra**, wie heute |
| nächster Graphknoten → angeklickter Punkt | **A\***, querfeldein |

Der Ausstiegspunkt ist die vorhandene Funktion **`findNearestLocationToLatLng`** — nächster
**benannter** Ort per Luftlinie, Kreuzungen ausgeschlossen (V11 §10, dort entschieden und
begründet: deterministisch und für den Nutzer vorhersagbar).

💣 **Hier liegen die großen Suchräume.** V11 §10.1 hat gemessen: die Luftlinie von einem beliebigen
Kartenpunkt zum nächsten benannten Ort ist p50 **39,5**, p90 **157,8**, max **290** Einheiten. Bei
Zellweite 0,5 sind das p50 **10.600**, p90 168.900, max **568.000** Zellen. Der **Zelldeckel**
(150.000–200.000) ist bei diesem Auslöser tragend, nicht Kosmetik — anders als beim automatischen
Auslöser, wo gemessene 4.130 Zellen der schlimmste Fall sind.

Reicht eine Anfrage über den Deckel, **vergröbert** der Code die Zellweite für diese eine Anfrage
und schreibt die benutzte Größe in die Antwort (V11 §10.2).

---

## 3. Die Höhe

**Owner:** *„Querfeldein-Wege gehen nicht über Erhebungen/Vertiefungen, wenn es einen kostenärmeren
Weg gibt."*

### 3.1 💣 Die Einheiten — dreifach nachgerechnet

| | |
|---|---|
| 1 aventurischer **Schritt** | 1 Meter |
| 1.000 Schritt | 1 **Meile** = 1 Kilometer |
| 1 **Karteneinheit** | **3.000 Schritt** = 3 Meilen = 3 km |

Daraus folgt die Steigung: `Steigung = Höhendifferenz[Schritt] / (Strecke[Karteneinheiten] × 3.000)`.

⚠️ **Gegenprobe an V11:** `avesmapsTerrainTimeFactor(3000.0, 0.0, 3.0)` ergibt dort Steigung ⅓ —
3.000 Schritt Anstieg auf 3 Karteneinheiten. Das passt zur Formel. **Die Formel nicht neu
herleiten, sondern V11s `avesmapsTerrainTimeFactor` benutzen** (`api/_internal/routing/terrain-factor.php`).

💣 **Diese Umrechnung ist schon einmal schiefgegangen** und ein Spieler hat es live gefunden: eine
frühere Faustregel setzte die Meile auf 3.000 Schritt und lag damit durchgehend um Faktor 3 daneben.
Anker zum Gegenrechnen: die Koschberge haben 239 Schritt je Meile = 23,9 % Steigung.

### 3.2 Woher die Höhe kommt

Aus dem **gespeicherten** Höhenraster (V11 §3, `ecosystem_area_heightmap`) — nicht aus dem
prozeduralen Feld, das nur im Browser existiert. Der Server liest es; live nachgeprüft am
2026-07-30: `terrain.enabled = true`, 3.331 Profilzeilen, `stale = false`.

Bestand: **19 `gebirge`-Flächen, 18 mit Höhenwerten; 63 Flächen insgesamt mit Höhe.** ⚠️ Neu
zählen, der Owner zeichnet täglich.

### 3.3 ⚠️ Die Heuristik-Falle

V11 §10.4: der Bergab-Bonus (Klemme bis 0,5) zwingt A\* anzunehmen, der Rest laufe überall doppelt
so schnell — die Schätzung wird halb so scharf und A\* öffnet viel mehr Knoten (gemessen: **83 %
der Kiste**). Der Ausweg steht dort: nicht die theoretische Klemme annehmen, sondern den
**kleinsten tatsächlich vorkommenden** Faktor — **messen**, nicht schätzen.

---

## 4. Das Symbol

Quelle `C:\GIT\avesmaps-map-processing\icons\menu\schuh.png` — **581 × 570 px, 490,7 KB**.

Ins Repo als **`icons/schuh.webp`**, im Format der übrigen Menü-Icons: **80 × 80, WebP lossless
(VP8L), 3,6–7,2 KB**. 💣 Nicht als PNG und nicht in Originalauflösung.

---

## 5. Nachweis

**Lokal (ohne DB):**
- **Landprüfung:** Punkt im Meer → abgelehnt · Punkt mitten im Kontinent → Land · Punkt in
  **beidem** → abgelehnt (Wasser schlägt Land) · Punkt in **keiner** Fläche → abgelehnt.
  Kontrollpunkte aus der Messung: `(120, 300)` ist Wasser, `(500, 500)` ist Land.
- **Einheiten:** ein Anstieg von 3.000 Schritt auf 3 Karteneinheiten ergibt Steigung ⅓. Der Test
  nagelt die Umrechnung fest, weil sie schon einmal um Faktor 3 danebenlag.
- **A\*:** Hindernis mit Lücke → Weg durch die Lücke · vollständige Sperre → kein Weg ·
  Start = Ziel · Zelldeckel greift und meldet die benutzte Zellweite.
- **Höhe:** zwei Wege gleicher Länge, einer über einen Buckel → der flache gewinnt.

**Am Livebestand, nach dem Deploy:**
- Rechtsklick **im Meer** → Meldung, keine Route.
- Rechtsklick **an Land, nah an einer Straße** → Route mit einer kurzen Querfeldein-Etappe am Ende.
- Rechtsklick **an Land, weit weg** (p90-Fall) → Route entsteht, und die Antwort nennt eine
  vergröberte Zellweite, wenn der Deckel griff.
- 🔴 **Der Gebirgs-Nachweis:** `?s=DFtqNyn6` (Rovik → Skarsten). Ohne Höhendaten läuft der Weg
  **durch 70 % der Punkte im Gebirge**, mit ihnen geht er herum — **11,2 statt 6,4 Einheiten**, und
  beides ist weniger als die heutigen 24,8. Zeigt der Weg weiterhin 6,4, wirkt die Höhe nicht.

---

## 6. Fallen

1. 💣 **Landprüfung nur für den angeklickten Punkt** (§1), nie für Orte.
2. 💣 **Wasser schlägt Land** bei Doppel-Deklaration (0,4 % der Karte).
3. 💣 **Zelldeckel ist hier tragend** (§2) — anders als beim automatischen Auslöser.
4. 💣 **Einheiten:** 1 Schritt = 1 m, 1.000 Schritt = 1 Meile = 1 km, 1 Karteneinheit = 3.000
   Schritt (§3.1). Schon einmal um Faktor 3 falsch gewesen.
5. 💣 **Gitter als Binärstring**, nie als PHP-Array — 33,2 gegen 1 Byte je Zelle (V11 §10.2).
6. 💣 **Drei Byte-Ebenen** je Zelle (derographisch/vegetation/topographie überlagern sich),
   Faktoren per **Maximum** verknüpft.
7. 💣 **Linie an die echten Endpunkte nähen** und mit Douglas-Peucker bei **eps 0,10** vereinfachen
   — gemessen: 13–34 rohe Punkte werden 4–10, bei **null** Längenänderung. Größere eps verkürzen
   die Linie, und die Länge ist eine Reisezeit (V14-Spec §5.7a).
8. ⚠️ **V10, V11 und die Reisezeit lesen die Etappengeometrie** — alle drei nach dem Bau prüfen.
9. ⚠️ **`bounds` ist snake_case** (`min_x`, nicht `minX`).
10. ⚠️ **STRATO:** keine Schleifen gegen teure Endpunkte, Einzelsonden.

---

## 7. Reihenfolge

1. **Instruction A** — sonst ist Ziel 2 nicht abnehmbar.
2. Symbol umsetzen (§4) — Vorarbeit, unabhängig.
3. Landprüfung (§1) mit Tests — das kleinste, am besten prüfbare Stück.
4. A\*-Rechner (V14-Spec §5.1–5.4) + Höhe (§3).
5. Rechtsklick-Eintrag (§2) verdrahten.
6. Netzlauf (§5).

⚠️ Der **automatische** Auslöser aus der V14-Spec (§5.5, Schwelle 3×) ist **nicht** Teil dieser
Instruction, teilt aber den Rechner. Wer zuerst fertig ist, baut ihn so, dass der andere ihn nutzen
kann — **ein** Rechner, zwei Aufrufer.

---

Siehe `docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md`,
`docs/superpowers/specs/2026-07-29-landschaften-v11-gelaende-reisezeiten-design.md` §10,
`docs/superpowers/specs/2026-07-29-landschaften-v13-wasser-design.md`.
