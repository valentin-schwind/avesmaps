# Landschaften — Gipfel als Kegel mit Steigung — Entwurf

**Stand:** 2026-09-14 · **Auftraggeber:** Owner (Sitzung „Gebirge wachsen zum Kamm hin an") ·
**Vorgänger:** Gebirgssimulation V12 ✅ (`js/map-features/map-features-ecosystem-hydrologie.js`),
Kamm-Anwuchs-Konzept vom 03.09.2026 (nie gebaut, **durch diesen Entwurf ersetzt**) ·
**Nachbar:** Fall #109 „Flusstäler im Höhenfeld" (GO 14.09.2026, eigene Sitzung, siehe §7) ·
**Bilder:** alle Zahlen und Bilder dieses Entwurfs sind mit der **unveränderten Produktionsdatei**
(Stand `origin/master` 14.09.2026) und den **Live-Eingaben** gerechnet (je eine Anfrage an
`ecosystem-areas.php?kind=topographie` und `map-features.php`); die Variante tauscht per Naht in
einer Kopie genau die beschriebene Stelle, Gegenprobe ohne Naht bitgleich zur Produktion ·
**Bauplan:** folgt nach Freigabe dieses Entwurfs · **Mockup** des Dialogs: vor der ersten Zeile
Oberflächen-Code (§5.4) ·
**Nachtrag 14.09.2026:** 🔴 Owner-Wahl nach Prüfung der Bilder: **„Eingeblendet, korrigiert"** statt
der sanften Einblendung (§3, §4.3, §4.4, §4.8)

> 🔴 = Owner-Entscheid oder Owner-Aussage · ⭐ = vorgeschlagene Vorgabe · 🔧 = Frage oder Handgriff
> für den Owner · 💣 = Falle · ⚠️ = Einschränkung oder offener technischer Punkt

---

## 0. Kurzfassung

Der **Kamm-Anwuchs wird nicht gebaut** (🔴 Owner): die Randwertaufgabe von V12 ist bereits genau
diese Form — die Grundform folgt der Formel vom 03.09.2026 mit Korrelation 0,89 bis 0,99, und eine
Grundform nach der Formel ändert das fertige Gelände um ±1 %.

Das eigentliche Problem liegt woanders: **die Erosion arbeitet um den festgehaltenen Gipfel herum.**
Ein hoher Gipfel wird zur **Nadel** (ringsum abgetragen), ein niedriger **überwachsen** (ringsum
angehoben). Beides entsteht erst in der Erosion; die heutige „Ausstrahlung der Gipfel" wirkt vorher
und wird von der Erosion wieder eingeebnet.

Die Lösung dieses Entwurfs:

1. **Ein Gipfel ist ein Kegel mit Steigung.** Radius = Höhe ÷ tan(Steigung) — ein 5.000er bei 45°
   reicht 5 Meilen, bei 30° 8,7 Meilen (🔴 Owner-Idee).
2. **Nach der Erosion eingeblendet, korrigiert:** zum Gipfel hin wird das Gelände auf den Kegel
   gezogen, am Gipfel ganz, am Kreisrand gar nicht. Gelände **unter** dem Kegel wird sanft angehoben,
   Gelände **über** dem Kegel kräftig, bis kurz vor den Kreisrand, herabgezogen — damit kein Gipfel
   überwachsen bleibt (🔴 Owner-Wahl nach Prüfung der Bilder).
3. **Am Flächenrand** läuft der Kegel mit derselben Steigung auf 0 aus.
4. Der Regler **„Ausstrahlung der Gipfel" wird zu „Steigung der Gipfel"**; jede Gebirgsform bringt
   eine Steigung als Vorlage mit (🔴 „Steigung von sinnvollen Gebirgseinstellungen abhängig").
5. Im Flächendialog steht um jeden Gipfel ein **gestrichelter Kreis** mit diesem Radius (🔴 „den
   Radius auch gerne so anzeigen").

---

## 1. Owner-Aussagen

- 03.09.2026, die Ausgangsidee: ein Gebirge soll „zur Mitte hin anwachsen", entlang des Kamms, auf
  dem die Beschriftung sitzt — nur mit vorhandenen Werten, höchstens ein Regler zum Weichzeichnen.
- 14.09.2026, nach dem Vergleich heute gegen Anwuchs: **„a"** (nicht bauen) — „zeig mir die
  Ausstrahlung der Gipfel in Stufen".
- „kannst du das nicht von der höhe abhängig machen? wenn ein berg 5000 schritt hoch ist kann man
  bei 45° steigung (steigung kannst du gerne von sinnvollen gebirgseinstellungen abhängig machen)
  einen radius von 5 meilen - oder?"
- „wenn du das tust, kannst du den radius (wie im mockup) tatsächlich auch gerne so anzeigen"
- „was ist wenn wir den kegel stabiler oder immun gegen erosion machen? also danach drauf addieren
  oder so?"
- „gibts ne mischung aus ‚Danach als Boden' und ‚Danach eingeblendet'? ansonsten machen wir
  ‚Danach eingeblendet'"
- „ja, schreib den Entwurf"
- Nach dem Lesen: „Eingeblendet, korrigiert scheint mir nach der prüfung der bessere weg zu sein -
  lässt sich das noch korrigieren?, ansonsten passt der entwurf"

---

## 2. Was heute passiert (gemessen)

### 2.1 Die Grundform ist schon der Anwuchs

Grundform ÷ Kammhöhe gegen `dRand / (dRand + dKamm)` (dKamm = Kurve oder Gipfel), freie Zellen:

| | Finsterkamm | Rote Sichel | Schwarze Sichel |
|---|---|---|---|
| Korrelation | 0,99 | 0,97 | 0,89 |
| mittlere Höhe fertig: heute → Formel als Grundform | 1.214 → 1.219 | 1.870 → 1.860 | 2.388 → 2.422 |

### 2.2 Die Ausstrahlung hängt an ihrer Kappung

Die heutige Ausstrahlung wird auf 0,72 × Abstand zum nächsten Gipfel gekappt. Bitweise verglichen:
an der Roten Sichel sind die Stufen **5, 8 und 12 identisch** (alle 14 Gipfel gekappt), an der
Schwarzen Sichel **8 und 12**. Im fertigen Relief ist ein Kegel kaum zu sehen, weil die Erosion ihr
Rinnennetz im Kreis neu zieht. Ein Gipfel **unter** seinem Umland bekommt gar keinen Kegel
(`ueber = H − basis ≤ 0`).

### 2.3 Nadel und Überwachsen entstehen in der Erosion

Mittlere Höhe auf dem Zellring im Abstand 0 / 1 / 2 / 3 / 4 Zellen (eine Zelle = 750 Schritt):

| | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Nebelstein (5.000) ohne Erosion | 5.000 | 5.000 | 5.000 | 4.936 | 4.608 |
| Nebelstein (5.000) mit Erosion (heute) | 5.000 | 5.000 | **2.616** | 1.872 | 1.634 |
| Aarenfels (2.600) ohne Erosion | 2.600 | 2.600 | 2.335 | 2.033 | 1.865 |
| Aarenfels (2.600) mit Erosion (heute) | 2.600 | 2.600 | **2.950** | 3.304 | 3.576 |

💣 Der Gipfel ist ein festgehaltener 3×3-Kern (`kern`, in `festEro`); die Erosion trägt direkt
daneben ab (Nebelstein: 2.400 Schritt Wand auf 750 Schritt), die gleichmäßige Hebung hebt das
Umland eines niedrigen Gipfels über ihn. Fuß des Aarenfels in Anteilen seiner Höhe: Grundform 0,35 →
mit Rauschen 0,70 → mit Erosion ohne Rauschen 1,01 → beides 1,40.

### 2.4 Gelände und Bestand

- Steigung des fertigen Geländes, Median über alle Zellen: Finsterkamm **12°**, Rote Sichel **18°**,
  Schwarze Sichel **25°** (ohne Rauschen und Erosion dort nur 6°).
- **71** Gebirgsflächen; **4** tragen einen eigenen Ausstrahlungswert (Beilunker Berge 10,5 ·
  Gorische Wüste 0,5 · Rorwhed 10,5 · Schwarze Sichel 1,3), **9** eine Vorlage (8 × Karst,
  1 × Kuppengebirge), 62 keine.
- **59** Gipfel und Vulkane liegen in Gebirgsflächen, **7** ohne eingetragene Höhe (gelten als
  5.000); eingetragene Höhen 1.400 bis 9.000, Median 5.000.
- ⚠️ **50 der 71 Gebirgsflächen haben keinen einzigen Gipfel.** Dort bewirkt dieser Entwurf nichts, und
  der Regler steht grau (§5.3) — die Wirkung betrifft 21 Gebirge.
- Eine Probe an `POST /api/route/` meldet `terrain.enabled: true`, 71 Höhenraster, 503 Wege mit
  Profil und **`stale: true`** — die Höhen wirken live auf Reisezeiten, und die Wegprofile hinken dem
  Rasterstand schon vor dieser Arbeit hinterher.

---

## 3. Verworfen, jeweils gemessen

| Weg | Warum nicht |
|---|---|
| Anwuchs-Formel als Grundform | ±1 % im fertigen Feld (§2.1) |
| Ausstrahlung größer stellen | endet an der Kappung (§2.2) |
| Kegel mit Steigung **vor** der Erosion | das Gelände liegt nah am Gipfel schon höher; angehobene Zellen bei 45°/30°/20°: Finsterkamm 1/5/291, Rote Sichel 31/208/770, Schwarze Sichel 19/379/1.279 — die Nadel bleibt |
| Deckel „nicht überwachsen" nur auf angehobene Zellen | fast wirkungslos; bei 20° eine sichtbare Ringkante |
| **Immun** (Kegel vor der Erosion, im Umkreis keine Erosion) | beste Zahlen, im Bild eine glatte Scheibe mit dunklem Ring |
| **Danach als Boden** (`max(h, Kegel)`) | heilt die Nadel, nicht das Überwachsen |
| **Mischung** (unter dem Kegel voll anheben, darüber einblenden) | praktisch gleich „eingeblendet" (Nebelstein 3.985 gegen 3.844 bei 2 Zellen) |
| **Eingeblendet, sanft** (nach oben und unten dasselbe Smoothstep-Gewicht) | 🔴 vom Owner nach Prüfung der Bilder zugunsten der korrigierten Fassung verworfen: überwachsenes Gelände bleibt stehen — Zellen im Gipfelkreis höher als der Gipfel 47 / 36 / 132 gegen 15 / 28 / 39 korrigiert |

---

## 4. Die Regel

### 4.1 Der Kegel

Für jeden Gipfel `p` der Fläche: Höhe `H` (eingetragen, sonst `ECOSYSTEM_HYDRO_STANDARDHOEHE` =
5.000), Steigung `α` der Fläche (§5.1), Radius in Karteneinheiten

    r = H / tan(α) / SCHRITT_JE_EINHEIT

### 4.2 Die Zielfläche, mit Randkeil

    T(x) = max über alle Gipfel mit d_p(x) < r_p von
           min( H_p − d_p(x) · 3000 · tan α ,  dRand(x) · 3000 · tan α )

💣 **Der zweite Term ist tragend.** Ohne ihn reicht ein Kegel über den Flächenrand hinaus: gemessen
stiegen die Randzellen über 1.000 Schritt an der Schwarzen Sichel von 0 auf 13, an der Roten Sichel
von 6 auf 17. Mit ihm: 0 und 3. Die Fußhöhe 0 am Rand ist die Invariante, an der die Naht zweier
Gebirge hängt. `dRand` kommt aus `randAbstand(r)` (Chamfer, Zellen × 3), nie aus einer zweiten
Abstandsrechnung.
⚠️ `max` über die Gipfel, nie eine Summe: zwei Kegel addieren sich nicht. Deshalb braucht es **keine
Kappung** mehr.

### 4.3 Die zwei Gewichte

    u(x)    = min über die Gipfel von d_p(x) / r_p
    wAuf(x) = 1 − u² · (3 − 2u)       (Smoothstep: sanft, 1 am Gipfel, 0 am Kreisrand)
    wAb(x)  = 1 − u⁴                  (kräftig bis kurz vor den Kreisrand, dort 0)

### 4.4 Die Einblendung

    h'(x) = h(x) + wAuf(x) · (T(x) − h(x))     wenn h(x) < T(x)   (Gelände unter dem Kegel)
    h'(x) = h(x) + wAb(x)  · (T(x) − h(x))     sonst              (Gelände über dem Kegel)

für jede Zelle **in der Fläche**, die **kein Gipfelkern** (`kern`) und **keine Flussachse oder
Seefläche** (`senke`) ist.

- 🔴 „Eingeblendet, korrigiert" (Owner-Wahl): Anheben sanft, Herabziehen kräftig. Das nimmt dem
  Überwachsen den Ring, der bei gleichem Gewicht stehen bliebe (§3).
- ⚠️ Außerhalb aller Kreise ändert sich nichts.
- ⚠️ Der Exponent 4 ist gemessen, nicht hergeleitet: er ist der Wert, mit dem die Bilder entstanden sind,
  die der Owner gewählt hat. Wer ihn ändert, ändert das gewählte Bild.

### 4.5 Talflanken — 💣 Pflicht vor dem Bau, zusammen mit #109

Flusszellen im Gipfelkreis liegen nach der korrigierten Einblendung im Mittel deutlich **über** ihrem
Ufer: die Flanke wird herabgezogen, die Achse nicht. Das ist ein **Damm**, kein Tal.

| über dem Ufer, Mittel | heute | korrigiert |
|---|---|---|
| Rote Sichel (240 Zellen) | +125 | **+477** |
| Finsterkamm (31 Zellen) | −41 | **+159** |

Das kräftige Herabziehen macht es spürbar schlimmer als die sanfte Fassung (+177 / −19) — die
korrigierte Fassung kann ohne diese Regel **nicht** live gehen.
⭐ Regel: die Einblendung senkt eine Talflanke **nie unter die Sohle ihres Tals** —
`ecosystemTalSohle(talIndex, x, y)` liefert sie bereits. Aufgabe 1 des Bauplans: bauen, messen (Ziel:
nicht über heute), erst dann weiter. Die Talregel gehört Fall #109 (§7).

### 4.6 Ort in der Kette

Im Trichter `avesmapsGebirgsRasterBauen`:

    Gipfelkerne → lösen → Kamm → lösen → [Bergform entfällt] → Rauschen → Massigkeit
    → Täler → Erosion → Deckel am Ausgang → **Gipfelkegel einblenden**

- 🔴 Die heutige **Ausstrahlung** (`addiereGipfelkegel` vor dem Rauschen) **fällt aus der Kette**.
  `mantel` bleibt damit leer; die Erosionsmaske ändert sich dadurch nicht (sie nimmt den Mantel nur
  heraus).
- Der Kegel steht **nach** dem Deckel am Ausgang — so ist er gemessen. Der Deckel bleibt trotzdem
  wirksam: nach ihm liegt jede Zelle unter dem höchsten festen Wert, `T` ebenfalls (`T ≤ H`), und eine
  Einblendung zwischen zwei Werten unter dieser Grenze bleibt darunter.
  ⚠️ Vor dem Deckel wäre es **nicht** dasselbe: eine Zelle über der Grenze würde erst eingeblendet und
  dann gekappt, also anders als gemessen.
- **Steigung 0 = kein Kegel** — dieselbe Lesart wie heute bei der ausdrücklichen 0 der Ausstrahlung.

### 4.7 Invarianten (gemessen an der Probe mit 30°)

| | Finsterkamm | Rote Sichel | Schwarze Sichel |
|---|---|---|---|
| Gipfel zeigen ihre Höhe (größte Abweichung) | 0 | 0 | 0 |
| Randzellen über 1.000 Schritt (ohne Kammlinie): heute → neu | 2 → 2 | 6 → 3 | 0 → 0 |
| Zellen im Gipfelkreis höher als der Gipfel: heute → neu | 94 → **15** | 92 → **28** | 199 → **39** |
| Nadel: Höhe 2 Zellen neben dem Gipfel (Ideal 30°) | 2.616 → 3.844 (4.134) | 4.589 → 5.575 (5.784) | — |
| mittlere Höhe: heute → neu | 1.214 → 1.205 | 1.870 → **1.775** (−5 %) | 2.388 → 2.369 |
| Flüsse im Gipfelkreis über ihrem Ufer: heute → neu | −41 → +159 | +125 → +477 | — |

Flussachsen und Seen sind per Konstruktion unberührt (`senke`); die Abnahme misst trotzdem „Fluss
fließt bergab" und „See ist eben" mit den vorhandenen Kennzahlen nach — und den Damm aus §4.5.

### 4.8 Bekannte Nebenwirkungen der korrigierten Fassung (gemessen)

Mittlere Höhe auf dem Zellring im Abstand 0 / 1 / 2 / 3 / 4 / 5 / 6 / 8 / 10 Zellen:

| | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| Aarenfels (2.600, Radius 6 Zellen) heute | 2.600 | 2.600 | 2.950 | 3.304 | 3.576 | 3.703 | 3.720 | 3.567 | 3.291 |
| Aarenfels korrigiert | 2.600 | 2.600 | 1.630 | **1.393** | 1.810 | 2.938 | **3.662** | 3.516 | 3.301 |
| Adlerspitze (6.650, Radius 15 Zellen) heute | 6.650 | 6.650 | 4.589 | 3.919 | 3.729 | 3.687 | 3.666 | 3.615 | 3.312 |
| Adlerspitze korrigiert | 6.650 | 6.650 | 5.575 | 4.990 | 4.435 | 3.922 | 3.488 | **2.807** | **2.413** |

- ⚠️ **Mulde um einen Gipfel in hohem Umland:** der Aarenfels ist jetzt der höchste Punkt seiner
  Nähe, steht aber in einer Senke, deren Rand am Kreis 2.269 Schritt höher liegt als ihr Boden.
  Ursache bleibt die Kammhöhe über den Gipfeln (§8).
- ⚠️ **Das Umland großer Gipfel wird tiefer:** bei einem großen Radius (Adlerspitze 11,5 Meilen) zieht
  der Kegel auch Gelände herab, das zum Massiv gehört — 10 Zellen neben der Adlerspitze 900 Schritt.
  Daher die −5 % mittlere Höhe an der Roten Sichel.
- ⚠️ In der Gesamtansicht sind die Kreise großer Gipfel als ruhigere, glatte Flächen erkennbar.

---

## 5. Regler, Vorlagen, Daten, Anzeige

### 5.1 Neue Spalte, alte bleibt

`ecosystem_area.terrain_gipfel_steigung` (`DECIMAL(6,2)`, Grad, `NULL` = Vorgabe), angelegt über
denselben Spalten-Nachzug wie die übrigen Gelände-Spalten in `api/_internal/app/ecosystem.php`.

💣 **Nicht `terrain_bergform` umdeuten.** Die vier gespeicherten Werte sind Radien in Karteneinheiten
(10,5 · 0,5 · 10,5 · 1,3); als Grad gelesen würden daraus stillschweigend flache Steigungen — die
Schwarze Sichel (1,3) bekäme um jeden 5.000er einen Kegel mit **220 Meilen** Radius. Die alte Spalte
bleibt stehen (der Deploy löscht nie) und hat danach keinen Leser mehr.

⭐ **Vorgabe ohne eigenen Wert: 30°** (`ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG`). Wie bei allen Reglern heißt
`NULL` „Modulvorgabe", nicht „Wert der Vorlage" — eine Vorlage schreibt Werte in die Regler und ist
danach vergessen.

⭐ Die vier Flächen mit eigener Ausstrahlung werden **nicht umgerechnet**: ein gekappter Radius hat
keine sinnvolle Steigung. Sie rechnen mit der Vorgabe, bis jemand den neuen Regler stellt. Zwei davon
(Beilunker Berge, Gorische Wüste) haben ohnehin keinen Gipfel.

### 5.2 🔧 Steigung je Gebirgsform

Der Wert `bergform` in `ECOSYSTEM_HYDRO_MORPHOLOGIEN` wird durch `steigung` ersetzt. Die übrigen neun
Zahlen je Form bleiben unverändert — sie sind Owner-Messungen und in `gelaende-vorlagen.test.js`
festgenagelt. **Vorschlag nach typischen Hangneigungen der Vorbilder, keine Messung:**

| Gebirgsform | Steigung | Radius eines 5.000ers | Gedanke |
|---|---|---|---|
| Kammgebirge | 25° | 10,7 Meilen | eine Hauptkammlinie, glatte Flanken |
| Gratgebirge | 30° | 8,7 Meilen | verästelte Grate, enge Täler |
| Kettengebirge | 35° | 7,1 Meilen | Hochgebirge mit parallelen Ketten |
| Kuppengebirge | 20° | 13,7 Meilen | runde Kuppen auf gemeinsamem Fuß |
| Massengebirge | 20° | 13,7 Meilen | geschlossener, massiger Block |
| Plateaugebirge | 15° | 18,7 Meilen | Tafel mit wenigen Gipfeln |
| Rumpfgebirge | 12° | 23,5 Meilen | abgetragene Hügellandschaft |
| Schild | 6° | 47,6 Meilen | fast eben |
| Inselberg | 45° | 5,0 Meilen | steiler Einzelberg |
| Karst | 30° | 8,7 Meilen | zerklüftet, steile Wände |

💣 Jeder Vorlagenwert muss innerhalb der Reglerschranken liegen — ein `range` klemmt beim Zuweisen
still (die Falle von Schild und Inselberg, AGENTS.md §11 „Die zehn Gebirgsformen"). Der Test liest
die Schranken aus `index.html`.

### 5.3 Der Regler

- Beschriftung **„Steigung der Gipfel"**, Schieber **0–60°**, Schritt 1, Zahlenfeld, Vorgabemarke der
  Vorlage, ↺ — dieselbe Bauform wie die übrigen Regler im Gelände-Panel (`TERRAIN_FIELDS`).
- ⭐ Tooltip: „Wie steil ein Gipfel abfällt. Daraus folgt, wie weit er ins Gelände reicht: Höhe ÷
  tan(Steigung) — ein 5.000er reicht bei 30° 8,7 Meilen. 0 = die Gipfel formen das Gelände nicht."
- Ohne Gipfel grau, mit dem Satz aus `avesmapsGebirgsReglerOhneWirkung` (der Schlüssel wandert von
  `terrain_bergform` zu `terrain_gipfel_steigung`).

### 5.4 Der Kreis

- Bei offenem Flächendialog in der Topographie-Ebene steht um jeden Gipfel der angeklickten Fläche und
  ihrer mitgezeigten Nachbarn ein **gestrichelter Kreis** mit dem Radius aus §4.1.
- Er folgt dem Regler sofort, auch bevor das neue Raster gerechnet ist.
- ⚠️ Neue Farbe nur als Token in `css/base/tokens.css` (AGENTS.md §12), in hell und dunkel lesbar.
- 🔴 **Mockup vor dem Bau:** Dialog mit Regler und Kreisen an der Roten Sichel, als
  `docs/gipfel-steigung-dialog-mockup.html`. Die Bilder dieser Sitzung zeigen die Wirkung, nicht die
  Bedienung.

### 5.5 Stempel und Weitergabe

💣 Jeder dieser Wege muss den neuen Wert kennen, sonst gilt ein veraltetes Raster als aktuell oder die
Vorschau zeigt altes Gelände:

- `avesmapsTerrainAreaFingerprint` (`terrain-store.php`): Schlüssel `steigung=` neben `bergform=`.
- `reglerFuer` (`map-features-ecosystem-height-render.js`) — daraus folgt `hydroFlaechenSchluessel`.
- die Feldliste des Loaders (`map-features-ecosystem-loader.js`) und die Nutzlast von
  `ecosystem-areas.php`.
- der Schreibweg der Gelände-Regler in `api/_internal/app/ecosystem.php` — samt seiner **Server-
  Schranke**: dort steht heute `'terrain_bergform' => [0.0, 12.0]`, der neue Wert braucht
  `[0.0, 60.0]`, deckungsgleich mit dem Schieber (sonst lehnt der Server ab, was der Regler anbietet).
- der Worker bekommt `regler` als Ganzes und braucht nichts Eigenes.

---

## 6. Folgen

### 6.1 Reisezeiten — vor dem Livegang messen

Der Wege-Router liest `path_terrain`, der Querfeldein-A* das Raster, beide eingeschaltet (§2.4).
Die Einblendung ändert die Höhen um die Gipfel (Rote Sichel: mittlere Höhe −5 %, §4.8).

Vor dem Livegang, offline gegen die gespeicherten und die neu gerechneten Raster:
- für jeden Weg, der eine der 71 Gebirgsflächen berührt, `avesmapsTerrainProfileForLine` und daraus
  `avesmapsTerrainLeistungsFactor`, heute gegen neu;
- die zehn größten Änderungen beim Namen nennen;
- dazu eine Stichprobe Querfeldein durch die drei Messgebirge.

🔧 **DU nach dem Livegang:** „Höhenraster starten" und die Wegprofile neu rechnen — **einmal**,
gemeinsam mit Fall #109 (§7).

### 6.2 Aussehen

Im Streiflicht stehen die Gipfel als Kuppen ohne Nadel, und kein Gipfel bleibt deutlich überwachsen.
Außerhalb der Kreise ändert die Einblendung nichts — per Konstruktion, nicht gemessen; der einzige
Unterschied zu heute ist dort die weggefallene Ausstrahlung. Die sichtbaren Nebenwirkungen stehen in
§4.8.

---

## 7. Abstimmung mit Fall #109 (Flusstäler)

Beide Arbeiten ändern dieselbe Rechnung. Stand 14.09.2026: #109 hat GO und noch keinen Commit.

| Stelle | #109 | dieser Entwurf |
|---|---|---|
| Trichter | Talabschnitt (Mündungsbaum, linearer Abfall) | nach der Erosion, eigener Block |
| `avesmapsTerrainAreaFingerprint` / Gipfelstempel | Flüsse und Seen hinein | `steigung=` hinein |
| `hydroFlaechenSchluessel` | Flüsse hinein | über `reglerFuer` |
| `gebirgssimulation.test.js` | ja | ja |
| Talflanke im Gipfelkreis (§4.5) | Talsohle | nutzt sie |

- ⭐ **#109 zuerst.** Dieser Bau setzt auf dessen Stand auf und rechnet die Zahlen aus §4.7 neu.
- **Ein** Rasterlauf und **ein** Profillauf für beide.
- Vor jedem Push die jüngsten Commits an `map-features-ecosystem-hydrologie.js` lesen.

---

## 8. Nicht in diesem Entwurf (bleibt offen)

- 🔧 **Darf die Kammhöhe über den Gipfeln stehen?** Schwarze Sichel: Kammhöhe 6.400, höchster
  Gipfel 5.000 — der Aarenfels (2.600) steht mit der korrigierten Einblendung in einer Mulde (§4.8).
- **Streifen aus der Erosion:** die D8-Fließrichtung zieht auf glatten Hängen achsparallele Rinnen
  (belegt: ohne Rauschen stark, ohne Erosion keine).
- **Kammlinie außerhalb der Fläche:** Schwarze Sichel, 5 von 32 Kurvenpunkten; 12 Randzellen stehen
  in der Grundform auf 6.400, die Erosion verdeckt es.
- **Massigkeit wirkt nur auf die Grundform:** Schwarze Sichel eingestellt 0,24, fertig 0,37.
- **Die Wegprofile sind schon heute veraltet** (`stale: true`).

---

## 9. Abnahme — der Ablauf

1. Karte mit `?edit=1`, Topographie, Flächendialog der **Roten Sichel** öffnen.
2. Der Regler heißt „Steigung der Gipfel", steht auf 30°, zeigt die Vorgabemarke der Vorlage (Karst).
3. Um jeden der 14 Gipfel steht ein gestrichelter Kreis.
4. Regler auf 45° ziehen: die Kreise schrumpfen sofort, das Streiflicht rechnet neu.
5. An der Adlerspitze steht keine Nadel mehr (Querschnitt wie in §4.7); an der Schwarzen Sichel ist
   der Aarenfels der höchste Punkt seiner Nähe (Mulde wie in §4.8, nicht tiefer).
6. Regler auf 0: keine Kreise, keine Gipfelkegel.
7. „Höhenfeld erzeugen": das Raster wird gespeichert, der Stempel ändert sich.
8. Fläche ohne Gipfel (z. B. Gorische Wüste): Regler grau, Satz sichtbar.
9. Die Karte als **Besucher** laden (ohne `edit=1`) und die Konsole lesen — dort fehlt jede Fehlermeldung.
10. Zahlen: Gipfel exakt; Randzellen nicht über heute; Fluss bergab und See eben wie heute;
    Flüsse im Gipfelkreis nicht höher über ihrem Ufer als heute (§4.5); Reisezeitvergleich (§6.1)
    liegt vor.

Tests, die die Sache **ausführen**, nicht den Quelltext lesen:
- der Trichter mit Fixture: Gipfel exakt, Nadel geheilt (Zellring 2 ≥ Schwelle), Randkeil (Randzelle
  bleibt 0), `senke`-Zellen bitgleich, Steigung 0 = kein Kegel;
- Fingerabdruck ändert sich mit `terrain_gipfel_steigung` (PHP);
- alle zehn Vorlagen tragen `steigung` innerhalb der Schranken aus `index.html`;
- Regler ohne Wirkung ohne Gipfel.

Jeder Test wird gegen Mutationen gefahren (Randkeil entfernt, `max` durch Summe ersetzt, `kern`- oder
`senke`-Ausnahme gestrichen, `wAb` durch `wAuf` ersetzt, Talsohlen-Riegel aus §4.5 gestrichen) — jede
muss rot werden.

---

## 10. Betroffene Dateien

`bergform` steht auf `origin/master` (14.09.2026) in diesen Dateien — alle sind beim Bau anzusehen:

- `js/map-features/map-features-ecosystem-hydrologie.js`
- `js/map-features/map-features-ecosystem-properties.js`
- `js/map-features/map-features-ecosystem-loader.js`
- `js/map-features/map-features-ecosystem-height-render.js`
- `index.html`
- `api/_internal/app/ecosystem.php`
- `api/_internal/app/terrain-store.php`
- `api/app/ecosystem-areas.php`
- Tests: `js/map-features/__tests__/gebirgssimulation.test.js`, `…/gelaenderegler-kette.test.js`,
  `…/gelaende-vorlagen.test.js`, `…/gelaende-regler-ausgrauen.test.js`,
  `…/gelaende-tal-schneidet-nicht-auf-null.test.js`, `…/gelaende-preset-wirkt.test.js`,
  `…/gelaende-gruppen-und-rangfolge.test.js`, `…/gelaende-vorgabemarken.test.js`,
  `…/gelaende-schranken-gleich.test.js`, `js/review/__tests__/garetien-karte.test.js`,
  `api/_internal/app/__tests__/terrain-store-test.php`

⚠️ Die Liste ist ein `git grep`, keine Prüfung auf Vollständigkeit — der Kreis (§5.4) und der Token
kommen hinzu. Vor dem Bau neu greppen.

Nicht anfassen: `html/editor-handbuch.html` (nächtliche Routine, AGENTS.md §9).
