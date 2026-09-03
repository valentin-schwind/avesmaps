# Landschaften — Flusstäler im Höhenfeld (Fall #109) — Entwurf

**Stand:** 2026-09-03 · **Fall:** #109 (Ideensystem, „Flussläufe in Topographie berücksichtigen") ·
**Auftraggeber:** Owner (Bild der Roten Sichel mit eingezeichneten Flüssen) · **Vorgänger:** V8
(Höhenfeld) ✅, V11 (Gelände auf Reisezeiten) ✅, Höhenskala (#79) ✅ ·
**Mockup:** `docs/flusstaeler-hoehenfeld-mockup.html` — **fährt den echten Feldbau** über die echte
Fläche „Rote Sichel" mit ihren 13 Gipfeln und 50 Flussstücken; der Prototyp des Talmoduls steht in
der Datei · **Bauplan:** `docs/superpowers/plans/2026-09-03-flusstaeler-hoehenfeld.md`

> 🔴 = Owner-Entscheid oder Anforderung aus dem Fall · ⭐ = vorgeschlagene Vorgabe, im Mockup
> einstellbar · 🔧 = Frage an den Owner, vor dem Bau zu beantworten (Regler im Mockup) · 💣 = Falle

---

## 0. Kurzfassung

Das Höhenfeld einer Gebirgsfläche entsteht heute aus benannten Gipfeln plus Rauschen. **Es weiß
nichts von den Flüssen**, die durch die Fläche gezeichnet sind — ein Fluss läuft im Bild über Kuppen
und Grate, und ein Weg, der ihm folgt, wird beim Routen bepreist, als kletterte er über sie.

Dieser Entwurf gibt dem Feld die Flüsse: **jeder `Flussweg`, der eine Gebirgsfläche berührt, senkt
ihr Feld zu einem Tal** — automatisch, ohne Zuweisung. Der Talboden fließt nie bergauf und fällt
zwischen zwei Knoten (Quelle, Mündung eines Zuflusses, Mündung) **linear** ab. Am Fluss steht die
Talbodenhöhe, am Talrand das heutige Gelände. Kein Gipfel verliert seine Zahl, der Rand bleibt auf 0,
und das Tal sitzt in **derselben Abfrage**, aus der Karte, Höhenraster und damit die Wegprofile
lesen — es reist beim nächsten Rasterlauf von selbst in die Reisezeiten.

Dazu zeichnet die Graustufen-Ansicht des Dialogs die Flussläufe **auf** das Raster (Owner: „wär gut
die verläufe dann zu sehen") — heute liegen sie darunter und sind unsichtbar.

---

## 1. Der Fall

Fall #109 (Ideensystem), wörtlich:

> Die topografische Struktur von Gebirge-Landschaften wird bisher weitgehend zufällig generiert;
> Ausnahmen sind die explizit eingesetzten Berggipfel. Logischerweise muss aber jeder Flusslauf
> (Flussweg) die lokalen Minima seines Einzugsgebiets abbilden, d.h. von jedem Punkt des Flusswegs
> geht rundum bergauf, außer den Flussweg hinab, dort geht es immer bergab.

Der Owner dazu (03.09.2026, am Bild der Roten Sichel):

> analog zum höhenprofil von bergen täler mit einer automatischen senke wo flüsse verlaufen ins
> rasterprofil von bergen. […] gebirge müssen erkennen, dass ein fluss durch ihr raster verläuft und
> es um das tal herum senken. richtig schön wärs wenn der verlauf des flusses es linear absenkt. […]
> kannst du die flussverläufe im höhenprofil überlagern […] die zuordnung müsste vollständig
> automatisch passieren (wie bei bergen)

Daraus drei 🔴 Anforderungen: **automatisch** (kein Häkchen, keine Zuweisung — wie ein Gipfel-Label
von selbst zum Buckel wird) · **linear absenken** entlang des Laufs · **Flussläufe im Höhenprofil
sichtbar**.

---

## 2. Was heute passiert (gemessen, nicht gelesen)

Gemessen am 03.09.2026 an den öffentlichen Nutzlasten (`map-features.php` 20,8 MB,
`ecosystem-areas.php` 4,4 MB — je EINE Anfrage), Feldbau mit den unveränderten Produktionsmodulen
unter Node (die vm-Ladeliste aus `terrain-offline-rebuild-validated`).

| | |
|---|---|
| Gebirgsflächen (`kind = topographie`, `region_type = gebirge`) | **69** |
| Gipfel-Labels (`berggipfel`/`vulkan`) | 76 |
| `Flussweg`-Stücke insgesamt | **1.108** (49 davon Bäche, 993 mit Fließrichtung) |
| Stücke mit mindestens einem Stützpunkt in einer Gebirgsfläche | **231** in **49** der 69 Flächen |
| Flusslänge innerhalb von Gebirgsflächen | 1.453 Karteneinheiten = **4.358 Meilen** |
| davon ohne Fließrichtung | 13 Stücke |
| Rote Sichel allein | 50 Stücke (27 Bäche), 349 Einheiten, 13 Gipfel |

**Das Feld ignoriert alle davon.** `buildEcosystemHeightField` kennt Gipfel, Regler und Geometrie
(`map-features-ecosystem-height-field.js`), sonst nichts. Wo ein Fluss über einen Rauschbuckel
läuft, steht er im Bild oben drauf; entlang des Weißwassers in der Roten Sichel liest das Feld
heute Werte zwischen 2 und 7.505 Schritt (Weißwasser-Stück #14, 36 Stützpunkte).

**Und man sieht die Flüsse im Höhenprofil nicht.** Die Höhen-Leinwand liegt in einer eigenen Pane
mit `z-index 420` (`map-features-ecosystem-height-render.js:93`), die Wege in `roadsPane` darunter
(400). Im Bearbeiten-Modus ist die Leinwand deckend (`solidMode`) — der Owner musste die Flüsse in
sein Bild von Hand einzeichnen. ⭐ Die **Fließrichtungs-Pfeile** liegen dagegen schon heute
DARÜBER (Pane 469, `map-features-river-flow-arrows.js:42`) und bleiben sichtbar.

**Für die Reisezeit heißt das:** Wasser trägt seit dem 30.07.2026 keine Steigung
(`AVESMAPS_TERRAIN_WATER_ROUTE_TYPES`), der Fluss selbst ist also richtig bepreist. Falsch bepreist
ist der **Landweg im Tal**: er folgt dem Fluss und klettert im Raster über jeden Rauschbuckel, den
das Feld dort erfindet — genau die Sorte „erfundenes Geländedetail", vor der
`oekosystem-instruction.md` §4.1.3 warnt. §4.3 derselben Anleitung sagt seit Juli: **„Das Wegenetz
ist Randbedingung — Pässe werden abgelesen, nicht erfunden."** Für Flüsse war das nie gebaut.

---

## 3. Entscheide und Vorgaben

| | Entscheid / Vorgabe | Herkunft |
|---|---|---|
| **1** | 🔴 **Automatisch.** Jeder `Flussweg`, der eine Gebirgsfläche berührt, senkt sie. Kein Häkchen, keine Zuweisung, kein Regler je Fluss. | Owner |
| **2** | 🔴 **Der Talboden fließt nie bergauf.** Entlang des Laufs ist er monoton fallend — über Zuflüsse hinweg. | Fall #109 |
| **3** | 🔴 **Linear zwischen den Knoten.** Quelle → Mündung als gerade Rampe, wo das Gelände nicht ohnehin tiefer liegt. | Owner („linear absenkt") |
| **4** | 🔴 **Flussläufe auf dem Höhenprofil**, in der Graustufen-Ansicht des Dialogs. | Owner |
| **5** | ⭐ **Talbreite 4,5 Meilen** (halbe Breite, Fluss bis Talrand; = 1,5 Karteneinheiten). 🔧 Regler im Mockup 1,5–15 Meilen. | Vorschlag |
| **6** | ⭐ **Ein Bach zählt mit halber Talbreite.** Ein `Flussweg` mit Häkchen „Bach" ist ein Fluss; ihn auszunehmen wäre der Sonderfall. 🔧 Regler 10–100 %. | Vorschlag |
| **7** | ⭐ **Tiefe 100 %** — bis auf den Talboden, die reine Regel. 🔧 Regler 25–100 %; §4.6 nennt den Preis. | Vorschlag |
| **8** | ⭐ **Jeder Gipfel liest weiter genau seine Zahl** — das Tal wird nie breiter als der halbe Abstand zum nächsten Gipfel. | aus der Höhenskala (#79): „Die Marke lügt nicht" |
| **9** | ⭐ **Kein neuer Regler im Dialog** in dieser Stufe. Die Zahlen sind Modulkonstanten; das Modul nimmt sie als Option, damit ein Regler je Fläche später eine Zeile kostet. | AGENTS.md („zwei Schalter, nicht die Werkstatt") |

---

## 4. Das Modell

Das Höhenfeld einer Fläche bleibt, was es ist: `h(x, y)` = Gipfelbuckel + gefenstertes Rauschen
(V8). Das Tal ist ein **Nachschritt an der Abfrage**:

```
h'(x, y) = h(x, y) − max über alle Talsegmente s in Reichweite:  k(d_s / w_s) · max(0, h − bed_s)

    d_s   = Abstand von (x, y) zum Segment s
    w_s   = Talbreite an der Fußpunktstelle (linear zwischen den Segmentenden)
    bed_s = Talbodenhöhe an der Fußpunktstelle (linear zwischen den Segmentenden)
    k(u)  = 1 − u²(3 − 2u)  für u < 1, sonst 0          (Smoothstep: 1 am Fluss, 0 am Talrand)
```

Am Fluss (`d = 0`) steht damit `min(h, bed)`, am Talrand (`d ≥ w`) das unveränderte `h`. Wo sich
zwei Täler überlagern, gilt der **tiefere Schnitt** (`max` über die Segmente) — stetig, weil jedes
Glied stetig ist.

### 4.1 Auswahl und Orientierung

Ein Stück zählt für eine Fläche, wenn es ihre bbox (plus Talbreite) berührt **und** mindestens einer
seiner dicht abgetasteten Punkte in der Fläche liegt. Abgetastet wird alle **0,5 Einheiten**
(1,5 Meilen) entlang des Laufs, die gespeicherten Stützpunkte bleiben erhalten — sonst folgte der
Talboden zwischen zwei weit auseinander liegenden Stützpunkten einer Sehne statt dem Gelände.

Orientiert wird nach `properties.flow.dir` (`forward`/`reverse`, dieselbe Quelle wie die
Fließrichtungs-Pfeile). ⭐ **Fehlt die Richtung, ist die Quelle das höhere Ende** des ungeschnittenen
Feldes; bei Gleichstand bleibt die gespeicherte Reihenfolge. Das Stück wird als „geraten" markiert
und im Profil **gestrichelt** gezeichnet — Fließrichtung eintragen, und die Annahme verschwindet.
Live sind es 13 von 231 Stücken.

💣 **Die Stücke werden nach `public_id` sortiert verarbeitet**, nicht in Ladereihenfolge: Verkettung
und Talboden dürfen nicht davon abhängen, wie die Nutzlast ankam (§4.2 von
`oekosystem-instruction.md`: Determinismus, sonst verschieben sich Routen lautlos).

### 4.2 Verkettung

Die Mündung eines Stücks, die auf einen Punkt eines anderen Stücks trifft (Toleranz **0,05 Einheiten
= 150 Schritt**), fließt dorthin. So entsteht je Fläche ein **Entwässerungsbaum**: Stücke, in die
niemand mündet, sind Quellen; ein Stück kann mehrere Zuflüsse an inneren Punkten tragen. Rote
Sichel: 50 Stücke, 37 verkettet, 25 Quellen.

💣 **Kreise** (Stück A mündet in B, B in A — widersprüchliche Fließrichtungen, verzweigte Läufe)
werden erkannt und aufgebrochen: das zuerst besuchte Stück behandelt den Rückläufer als Quelle. Rote
Sichel: 8 solche Nähte. Die Folge ist eine kleine Stufe an der Mündung — sichtbar, nicht gefährlich,
und ein Hinweis auf eine falsche Fließrichtung.

### 4.3 Der Talboden

Je Stück, in topologischer Reihenfolge (Zuflüsse zuerst):

1. **Kumulativer Tiefstwert flussabwärts** über die Punkte IN der Fläche: `bed_i = min(bed_{i−1},
   h_i)`. An einer Mündung kommt der End-Talboden des Zuflusses als weiterer Kandidat hinein — der
   Hauptfluss unterhalb einer Mündung liegt nie über seinem Zufluss. Das ist Fall #109 wörtlich.
2. **Linear zwischen den Knoten** (Quelle, jede Mündung eines Zuflusses, Mündung): `bed_i =
   min(bed_i, lin(bed_Knoten_a → bed_Knoten_b))`. Das Minimum zweier fallender Funktionen fällt —
   die Monotonie überlebt den Deckel. Wo das Gelände unter der Rampe liegt, folgt der Talboden dem
   Gelände (eine Senke bleibt eine Senke).

Gemessen (Rote Sichel, 1.077 Flusspunkte in der Fläche): **0 Monotonie-Verstöße**, Einschnitt Ø 518
Schritt, maximal 7.024 — der Maximalwert liegt an einem Punkt, an dem das heutige Feld einen
Gipfelbuckel und Rauschen aufeinandertürmt (7.024 > Weißpunkt 6.650; das Feld übersteigt dort schon
heute die Skala, die Höhenskala sagt „was höher liegt, wird nicht heller").

### 4.4 Talbreite und Gipfelschutz

Die Talbreite `w` eines Punkts ist die Grundbreite (Fluss 1,5 Einheiten, Bach × 0,5), **gedeckelt
auf die Hälfte des Abstands zum nächsten Gipfel** — gemessen gegen die beiden ANGRENZENDEN Segmente,
nicht nur gegen den Stützpunkt, damit jeder Punkt eines Segments mindestens `2w` vom Gipfel liegt.
Ein Gipfel liegt damit immer außerhalb des Tals und liest genau seine eingetragene Höhe.

⚠️ **Preis:** ein Fluss dicht an einem Gipfel bekommt dort ein sehr schmales Tal. Live liegt der
nächste Gipfel in 3 Flächen unter 0,4 Einheiten (1.200 Schritt) von einem Fluss (Rote Sichel 0,34,
Finsterkamm und Schwarzkuppen 0,37); dort ist das Tal auf wenige hundert Schritt Breite verengt.
Das Mockup nennt es im Querschnitt („durch Gipfelnähe verengt"). Gegen 76 Gipfel gemessen: **0
angetastet**.

Die Gipfel, die zählen, sind **alle wirksamen Gipfel des Stapels** (das verdichtete Gipfelfenster),
nicht nur die eigenen: das Feld einer Fläche trägt auch am Ort eines fremden Gipfels Rauschen bei, und
ein Schnitt dort ließe den fremden Gipfel in der Summe unter seine Zahl fallen.

### 4.5 Der Schnitt (§4, Formel oben)

- **Nie angehoben.** `max(0, h − bed)` — wo das Gelände schon unter dem Talboden liegt, passiert
  nichts. Am Flächenrand ist `h = 0`, also bleibt es 0: die **Fußhöhe-0-Invariante** gilt wörtlich,
  und mit ihr die Verschmelzung überlappender Flächen (`map-features-ecosystem-height-combine.js`).
  Gemessen an 540 Randpunkten der Roten Sichel: 0 verändert.
- **Je Feld, nicht je Stapel.** Zwei überlappende Flächen schneiden je ihren eigenen Beitrag; die
  Summe zweier fallender Talböden fällt. Und nur so steht das Tal im **Raster** — das trägt je Fläche
  ihr eigenes Feld, und der Server summiert (`avesmapsHeightmapSampleSum`).
- **Zellindex wie beim Buckelindex.** Jedes Talsegment steht in allen Zellen, die sein um die
  Talbreite aufgeblasenes Rechteck berührt (Zelle = größte Talbreite, mindestens 0,5); eine Abfrage
  liest nur ihre eigene Zelle. Fern von Flüssen kostet das Tal eine Zellprüfung.

### 4.6 💣 Außerhalb der Fläche sagt dieses Feld nichts — nicht „null"

Der Rasterleser kennt die Regel längst: „Outside is no data, NOT 0" (`heightmap.php`), und der
Profillauf bricht an einer Lücke die Kette, „statt einen Schritt hinunter ins Nichts zu erfinden".
Dieselbe Regel gilt dem Talboden: **Punkte außerhalb der Fläche treiben ihn nicht**, und eine
Mündung außerhalb trägt nichts herein.

Ohne diese Regel zöge jeder von außen kommende Fluss einen Canyon auf Fußhöhe 0 durch das ganze
Massiv — denn „außerhalb" ist in DIESEM Feld immer 0, auch wenn dort ein anderes Gebirge steht. Erste
Fassung des Prototyps genau so gerechnet: Weißwasser (Stück #18, 32 Innenpunkte, Gelände bis 2.306)
lag auf Talboden 0.

⚠️ **Was die Regel NICHT heilt:** ein Fluss, der INNERHALB der Fläche am Rand entlangläuft, liest
dort ~0 und trägt das flussabwärts weiter. Rote Sichel: der Gotjasach hat einen Innenpunkt mit
Höhe 1 und mündet ins Weißwasser — dessen Stück #18 liegt deshalb weiter auf Talboden 1 durch
Gelände bis 2.306. Über alle Flusspunkte der Roten Sichel gemessen: **5 % sind bis unter 5 % ihrer
Höhe geschnitten.** Das ist die Regel aus #109, konsequent angewandt, an einer Fläche, deren Rand
ungenau gezeichnet ist. 🔧 Der Regler **„Tiefe"** im Mockup lässt einen Anteil der örtlichen Höhe
stehen (`bed ≥ (1 − Tiefe) · h`) — dann kann Wasser im Modell bergauf fließen, dafür wird aus einem
Grenzfluss kein Schlitz. Vorgeschlagen ist 100 %; die Entscheidung gehört dem Owner am Bild.

### 4.7 Die Invarianten, geprüft

| Invariante | Prüfung |
|---|---|
| Talboden monoton fallend, über Mündungen hinweg | 0 Verstöße an 1.077 Punkten (Rote Sichel), 0 an allen 49 Flächen |
| Jeder Gipfel liest seine Zahl | 76 Gipfel, 0 angetastet |
| Fußhöhe 0 am Rand | 540 Randpunkte, 0 verändert |
| Nie angehoben | per Konstruktion (`max(0, ·)`), im Test festgenagelt |
| Ohne Flüsse Zahl für Zahl das Feld von heute | `buildEcosystemHeightStack(areas, peaks)` ohne dritten Parameter bleibt bit-identisch — der Test hält es fest |
| Determinismus | Stücke sortiert; keine `Math.random`; dieselben Eingaben → dieselben Segmente |

---

## 5. Wo es sitzt

```
map-features-ecosystem-river-valley.js   NEU, rein: Auswahl, Orientierung, Abtastung, Verkettung,
                                          Talboden, Talbreite, Zellindex, carve()
map-features-ecosystem-height-field.js    sampleEcosystemHeightField() → ruft carve() als LETZTEN Schritt
map-features-ecosystem-height-combine.js  buildEcosystemHeightStack(areas, peaks, rivers)
                                            → nach dem Bau aller Felder und compact(): je Feld die Täler
map-features-ecosystem-heightmap-raster.js unverändert — liest dieselbe Abfrage
map-features-ecosystem-height-render.js   riverList() aus pathData; Flussläufe auf die Leinwand;
                                            Statuszeile im Dialog
map-features-path-lifecycle.js            Flussweg geändert → Höhenfeld ungültig
api/edit/map/rivers-geometry.php          NEU: Flussstücke für den Rasterlauf des Editors
html/landschaften-editor.html             lädt Flüsse, gibt sie in den Stapel; Kachel zählt sie
api/_internal/app/terrain-store.php       Stempel kennt die Flüsse (§5.4)
```

### 5.1 EINE Abfrage, alle Leser

Das Tal sitzt am Ende von `sampleEcosystemHeightField` — der einen öffentlichen Abfrage, die die
Malschleife (`-height-render.js:363`), die Stapelsumme (`-combine.js:197`) und das Raster
(`-heightmap-raster.js:74`) benutzen. Wer eine davon anders rechnet, speichert ein anderes Gelände
als das gezeichnete; deshalb gibt es keinen zweiten Einstieg.

💣 **Die Messschleife des Feldbaus** (`loudest`/Mittelwert für Maximal- und Durchschnittshöhe) läuft
VOR dem Talbau und sieht das ungeschnittene Feld — gewollt: die Regler beschreiben das Gebirge, das
Tal nimmt danach Material weg. Der Mittelwert einer Fläche mit Tälern liegt also unter der
eingestellten Durchschnittshöhe (Rote Sichel: 6,5 % des Volumens entfernt).

### 5.2 Der Talbau gehört an den STAPEL, nicht ans Feld

`buildEcosystemHeightField` kann die Täler nicht selbst bauen: der Talboden liest das ungeschnittene
Feld **samt Gipfelfenster**, und dessen Radien entstehen erst beim Bau ALLER Felder
(`peakWindow.radii`, `compact()`). Also: `buildEcosystemHeightStack` baut alle Felder, verdichtet das
Fenster, und baut DANN je Feld die Täler mit `sample(x, y, window.sample(x, y))` als Leser. Ein Feld
ohne Täler trägt `valley = null`, und `carve()` gibt dann sofort zurück.

### 5.3 Woher die Flüsse kommen

- **Karte:** aus `pathData` (die geladene Nutzlast; `feature_subtype === "Flussweg"`,
  `properties.flow.dir`, `properties.is_bach`). Die Fließrichtungs-Pfeile lesen dieselben Felder.
- **Landschaften-Editor** (Rasterlauf): er lädt keine `map_features`. Wie bei den Gipfeln
  (`peaks-geometry.php`) ein kleiner Editor-Endpunkt **`rivers-geometry.php`** (GET, Fähigkeit
  `edit`), der nur die Stücke liefert, deren bbox eine Gebirgsfläche berührt — `public_id`,
  Koordinaten, `flow.dir`, `is_bach`, `revision`. Rund 250 Stücke, kein voller Nutzlast-Abruf.

💣 **Beide Quellen müssen dieselben Stücke dieselbe Form ergeben** — sonst zeichnet die Karte ein
anderes Tal als das Raster speichert. Der Editor bekommt `{ properties: { public_id, feature_subtype,
is_bach, flow }, geometry }` gebaut, genau die Form von `pathData`; das Modul kennt nur diese Form.

### 5.4 Der Stempel

Ein Raster ist gültig, solange Geometrie-Revision, Regler-Fingerabdruck und **`peaks_fingerprint`**
stimmen (`avesmapsTerrainHeightmapStatus`). Der dritte trägt heute den globalen Zustand aller Gipfel
und höhentragenden Flächen. ⭐ **Er trägt künftig auch die Flüsse:** alle `Flussweg`-Stücke, deren
bbox eine Gebirgsfläche berührt, als `public_id:revision` (sortiert). Ein verschobener Fluss, eine
gesetzte Fließrichtung, ein Bach-Häkchen bumpt die Revision des Stücks → jedes Raster wird „veraltet"
→ der Editor sieht es in der Kachel.

Das ist kein DDL: der Fingerabdruck ist ein `sha1` über eine Zeichenkette. Der Spaltenname
`peaks_fingerprint` sagt dann weniger als er trägt — wie `terrain_avg_height` (die Maximalhöhe) und
`changelog` (die Neuigkeiten), aus demselben Grund und mit demselben Kommentar an der Stelle. Eine
eigene Spalte `rivers_fingerprint` hätte ein `ALTER TABLE` auf dem Status-Pfad gekostet; bewusst nicht
(§9). ⚠️ **Beim ersten Deploy werden ALLE Raster veraltet** — richtig so, denn das Feld ist ein anderes.
Der Owner fährt einmal „Höhenraster", dann „Wegprofile".

### 5.5 Die Flussläufe auf dem Höhenprofil

In `redraw()` nach `putImageData`, nur bei `solidMode`: die Läufe der Felder im Stapel als Linien,
Fluss 1,5 px in `--color-path-flussweg`, Bach 1 px in `--color-path-bach` (Token, gelesen wie
`RAMP_TOKENS`), **gestrichelt, wo die Richtung geraten ist**. Nichts anderes wird gezeichnet: die
Pfeile liegen ohnehin darüber, Ortsnamen und Beschriftungen bleiben, wo sie sind. Die Statuszeile des
Gelände-Abschnitts im Dialog (`ecosystem-properties-terrain-status`) sagt: „Täler: 50 Flussstücke
senken diese Fläche (27 Bäche, 1 ohne Fließrichtung)."

### 5.6 Ungültig werden

Jede Änderung an einem Flussweg im Bearbeiten-Modus (anlegen, verschieben, Fließrichtung, Bach,
löschen) macht den Stapel ungültig — an denselben vier Stellen in `map-features-path-lifecycle.js`,
an denen heute `avesmapsWegEinschraenkungNeuRechnen()` steht. Der Stapel baut sowieso komplett neu
(V8: „ES WIRD ALLES NEU GEBAUT, NICHT NUR DIE ENTHALTENDE FLÄCHE"); der Talbau kostet je geladener
Fläche einige Millisekunden (§7).

---

## 6. Messungen am Livebestand (03.09.2026)

Alle 69 Gebirgsflächen, echte Gipfel, echte Flüsse, Vorgaben aus §3:

| | |
|---|---|
| Flächen mit Tälern | 49 von 69 |
| Flussstücke in Tälern | 231 · verkettet 90 · Richtung geraten 13 |
| Quellstücke: Quelle in der Fläche / von außen kommend | 149 / 7 |
| Einschnitt entlang der Flüsse | Ø 333 Schritt · max 7.024 (Rote Sichel) |
| Monotonie-Verstöße | 0 · Gipfel angetastet 0 · Mündungen unter dem Hauptfluss 2 (Kreise) |
| Talbau, alle 49 Flächen, Node | 834 ms (Rote Sichel 105 ms — im Lauf über alle Flächen, mit dem globalen Gipfelfenster; allein gebaut 49 ms, siehe unten; Median ~20 ms) |

Rote Sichel im Detail (die Fläche aus dem Owner-Bild; Erhebungen 23,6 · Erosion 5 · Maximalhöhe
2.000 · Ø 500 → 19.447 Buckel, Detailstufe 4 ausgelassen):

| | |
|---|---|
| Talbau | 49 ms Node · Feldbau davor 2.304 ms Node / **265 ms Browser** |
| Bild 240 × 235 Rasterpunkte (56.400 Abfragen) | 108 ms ohne · 130 ms mit Tälern (**+22 ms, +20 %**), Browser 65 → 81 ms |
| veränderte Rasterpunkte | 8.329 von 56.400 (15 %) · Volumen −6,5 % |
| Flusspunkte bis unter 5 % ihrer Höhe geschnitten | 52 von 998 (5 %), fast alle Weißwasser #18 (§4.6) |

---

## 7. Kosten

- **Malschleife:** +20 % je Abfrage in einer flussreichen Fläche, +1 Zellprüfung fern von Flüssen. Am
  Viewport des Owners (2560 × 1271, 4-px-Raster ≈ 203.000 Abfragen, heute 191–507 ms) hochgerechnet
  **+40 bis +100 ms** in der Graustufen-Ansicht — die einzige, in der das Feld überhaupt gemalt wird.
- **Talbau:** je Fläche linear in Flusslänge × Gipfelzahl, plus eine Feldabfrage je 1,5 Meilen Fluss.
  Rote Sichel 49 ms Node (Browser rund 9 × schneller, gemessen am Feldbau 2.304 → 265 ms). Im Stapel
  der Karte liegen nur die geladenen Flächen (bbox + 25 %), nicht alle 69.
- **Raster:** dieselbe Abfrage, +20 % auf den Lauf (heute rund 0,2 s bei 40 Flächen).
- **Nutzlast:** nichts Neues reist zum Besucher; das Tal wird aus Daten gerechnet, die längst da sind.

---

## 8. Was sich für die Reisezeit ändert

Nichts von selbst. Erst der Rasterlauf schreibt die Täler in `ecosystem_area_heightmap`, erst der
Profillauf in `path_terrain`. Danach: ein **Landweg im Tal** trägt weniger Anstieg (er klettert nicht
mehr über erfundene Buckel), ein Landweg **quer zum Tal** trägt einen Abstieg und Anstieg von Talbreite
und Taltiefe — mit dem Leistungskilometer bepreist wie jede andere Steigung (`terrain-factor.php`).
Flusswege selbst bleiben unberührt (`AVESMAPS_TERRAIN_WATER_ROUTE_TYPES`).

⚠️ `POST /api/route/` ist ein stabiler Vertrag; die **Werte** ändern sich, sobald der Owner die zwei
Läufe fährt (V11 §8 gilt unverändert; der Schalter „Geländeabhängiges Reisen" bleibt der Notaus).

---

## 9. Bewusst nicht gebaut / offen

- **Kein Regler „Talbreite" je Fläche** (Entscheid 9). Das Modul nimmt `width`/`bachShare`/
  `depthShare` als Optionen — ein Regler kostet später eine Spalte, eine Zeile in `TERRAIN_FIELDS`
  und einen Eintrag im Regler-Fingerabdruck.
- **Keine eigene Spalte `rivers_fingerprint`** (§5.4). Kostet ein `ALTER TABLE` auf dem Status-Pfad;
  der bestehende Stempel trägt die Information.
- **Seen bleiben, wie sie sind.** Eine `see`-Fläche im Gebirge müsste eigentlich ein ebener
  Wasserspiegel sein; das ist ein eigener Fall mit eigener Frage (Spiegelhöhe?) und gehört nicht in
  diesen Schnitt. `Seeweg` ist kein Fluss und senkt nichts.
- **Hügelland ist keine Höhenfläche** — das Tor ist `region_type = gebirge` (drei Stellen, siehe
  `terrain-store.php`). Wird es geöffnet, bekommen Hügel ihre Täler mit, ohne Änderung hier.
- **Kreise im Flussnetz** werden aufgebrochen, nicht gemeldet. Ein Prüfhaken „Fließrichtung
  widersprüchlich" wäre ein eigener Fall (das Konfliktzentrum kennt Fließrichtungen bisher nicht).
- **Der SVG-Abzug** kennt das Höhenfeld nicht und braucht nichts.
- 🔧 **Drei Zahlen am Mockup zu entscheiden:** Talbreite (4,5 Meilen), Bach-Anteil (50 %), Tiefe
  (100 %).

---

## 10. Tests

| Test | prüft |
|---|---|
| `js/map-features/__tests__/ecosystem-river-valley.test.js` **neu** | Abtastung; Orientierung (`reverse`, geraten); Verkettung + Baum-Tiefstwert (Zufluss senkt Hauptfluss); linearer Deckel; außerhalb = keine Aussage; nie angehoben (Rand 0 bleibt 0); Gipfelschutz (Gipfel 0,3 vom Fluss liest seine Zahl); Stetigkeit über eine Zellgrenze; Determinismus (vertauschte Eingabereihenfolge → gleiche Segmente); Kreis wird aufgebrochen |
| `js/map-features/__tests__/hoehenfeld-taeler-im-stapel.test.js` **neu** | `buildEcosystemHeightStack(areas, peaks, rivers)` senkt am Fluss; **ohne dritten Parameter bit-identisch zu heute**; das Raster (`rasterizeEcosystemHeightField`) liest den geschnittenen Wert; zwei überlappende Felder: Summe monoton |
| `js/map-features/__tests__/hoehenfeld-fluesse-verdrahtung.test.js` **neu** | `riverList()` liest nur `Flussweg` aus `pathData`; die vier Lebenszyklus-Stellen rufen die Ungültigkeits-Hilfe; Ladereihenfolge in `index.html` und `landschaften-editor.html` (Modul vor `-combine.js`); Überlagerung nimmt die zwei Token |
| `api/_internal/app/__tests__/terrain-store-test.php` erweitern | Fingerabdruck ändert sich mit `revision` eines berührenden Flusses und NICHT mit einem Fluss außerhalb jeder Gebirgs-bbox; reine bbox-Berührung getestet |
| `api/edit/map/__tests__/rivers-geometry-test.php` **neu** | die reine Zeilenformung (`flow.dir`, `is_bach`, Koordinaten) aus einer `map_features`-Zeile |

⚠️ **Ausgeführt, nicht gelesen** (Lehre vom 03.09.2026, Regressions-Popup): der Stapel-Test FÄHRT die
Abfrage über ein Feld mit Fluss und vergleicht Zahlen, der Verdrahtungstest lädt die Module per `vm`
mit den echten Geometrie-Helfern — kein Regex über Quelltext, wo Laden geht.

---

## 11. Abnahme — Ablauf, nicht Maß

1. Landschaften-Ebene → Topographie → Rote Sichel → Fläche bearbeiten. **Die Flüsse liegen auf dem
   Grauraster**, Bäche dünner, ein Stück gestrichelt (Flussweg-6043). Entlang des Weißwassers läuft
   eine dunkle Rinne durch die helle Zone zwischen Naira Theluzi und Wallspitzhorn.
2. Statuszeile im Gelände-Abschnitt: „Täler: 50 Flussstücke …".
3. Zeiger auf einen Gipfel: die Höhenskala zeigt unverändert seine Zahl (Adlerspitze 6.650).
4. Einen Flussweg ein Stück verschieben → das Raster folgt sofort; zurückschieben.
5. Landschaften-Editor → Rechnen ▾ → Höhenraster: die Kachel sagt vorher „69 veraltet", nachher
   „… Raster · 231 Flussstücke". Dann Wegprofile.
6. Eine Route entlang eines Talwegs vor und nach dem Lauf: die Infobox-Zeile „Auf und ab" ist kleiner
   geworden (eine Zahl genügt als Beleg, welche wird beim Bau gemessen).
7. **Als Besucher** (kein `edit=1`) die Live-Seite laden, Konsole lesen: leer.
