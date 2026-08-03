# Reisemodell: Überarbeitung nach der Quellenlage — Stand (gebaut 2026-08-03)

> ## ✅ GEBAUT 2026-08-03 — dies ist kein Auftrag mehr, sondern der Stand
>
> **Alle sechs Arbeitspakete sind gebaut, alle drei Owner-Entscheidungen gefallen.** Was unten
> als „zu tun" formuliert ist, ist Historie; der Status steht je Paket in §4. Offen sind nur noch
> zwei Sätze im Geschwindigkeits-Dialog (P5) — die Zahlen darin stammen aus dem alten Modell.
>
> | | Entscheidung | gebaut in |
> |---|---|---|
> | **A** Steigungskurve | **Leistungskilometer** (nicht Tobler, nicht Irmischer & Clarke, und ausdrücklich nicht DIN 33466) | bestand bereits, begründet in `terrain-factor.php` |
> | **B** `α` | **1** — volle Umverteilung, als Konstante statt als Spalte | `aa7ac68d` |
> | **C** absolutes Niveau | **ja, angeglichen** — jedes Reisemittel trägt seine eigene Tagesleistung aus der Quelle | `d9d7ab39` |
>
> ⚠️ **Entscheidung C ist die sichtbarste Änderung, die dieses Projekt am Reisemodell gemacht
> hat.** Gareth → Fasar ging von 9,13 auf 15,64 Reisetage, die berittene Gruppe von 69,5 auf
> 37,5 Meilen am Tag. Jede geteilte Route zeigt seither andere Zahlen. Das war so gewollt.
>
> 💣 **`α` wurde NICHT als Spalte gebaut.** §4/P4 sah eine neue Spalte neben `c` vor; gebaut ist
> die Konstante 1 in `terrain-calibration.php`, weil ein Regler ohne zweiten Wert nichts regelt.
> Wer `α` je einstellbar machen will, findet die Formel dort kommentiert.
>
> ### Die Eichwerte — gemessen am 02.08., `map_revision` 49317, weiter gültig
>
> | | |
> |---|---|
> | `c` (Tagesleistung ebene Straße) | **31,0** |
> | `mean_G(F)` (Straße) | **1,032** |
> | `mean_pass(F)` (Gebirgspass) | **1,323** |
> | Verhältnis Pass zu G | **1,281** |
> | vermessene Wege | **595 von 3.361** (17,7 %), Referenzmenge G = **124** Straßen |
>
> 💣 **Der Passnormierer hängt an der Straßeneichung** und ist nicht frei wählbar. Mittelwert-
> eichung (`c` = 31,0, wie gemessen) paart mit **÷ 1,281** — das ist `relative_to_reference`, und
> genau das wurde gebaut. Punkteichung (ebene Straße = 30) paart mit ÷ 1,323 (`mean_factor`). Die
> Kreuzung beider ergibt 3,3 % zu schnelle Pässe.
>
> ⚠️ **Auswahlverzerrung:** Höhenraster gibt es nur für Gebirgsflächen, eine Straße hat also genau
> dann ein Profil, wenn sie gebirgsnah verläuft. `mean_G(F)` ist dadurch nach oben verzerrt — aber
> gedeckelt bei 3,2 %, denn mehr Effekt ist gar nicht da.
>
> **Spreizung:** ein vermessen ebener Gebirgspass reist **32 %** schneller als der durchschnitt-
> liche Gebirgspass — der Wert ist `mean_pass(F)` selbst und vom Normierer unabhängig.
>
> **Der Reisetag** (Modellentscheidung des Owners, 2026-08-02): 24 Stunden, modelliert als **12 h
> Reise + 8 h Schlaf + 4 h Rast/Lager**. Eine Setzung — DSA nennt für Landreisen nur Tages-
> leistungen, keine Zeitaufteilung. Die Rastzeit bleibt einstellbar, Standard 12 Stunden.
>
> **Benchmark gegen die Entfernungstabelle (S. 254): weiter zurückgestellt.** Die Seite ist die
> einzige ohne OCR-Textlayer; Tesseract erreicht 30 % Trefferquote und verliert das Dezimalkomma
> (aus 34,5 wird 345). Gesichert ist bislang **ein** Wert — Gareth–Festum = **29 Reisetage** —
> sowie die Lesart der Matrix: der Wert an der Beschriftung ist Al'Anfa, dann alphabetisch nach
> links. Alle 39 Städte der Tabelle existieren in Avesmaps.

> **Wofür dieses Dokument noch gut ist.** Es hält fest, *warum* das Reisemodell so rechnet, wie
> es rechnet — die Herleitung, die Eichung und die drei Entscheidungen. Pflichtlektüre bleiben:
>
> - `docs/dsa-reisegeschwindigkeiten-quellenlage.md` — was die Regelquelle sagt, mit Seitenzahlen
> - `docs/steigung-gebirgspass-entscheidung.md` — Quelle, Regelableitung und Setzung getrennt
>
> 🔴 **NICHTS AN `html/editor-handbuch.html` ÄNDERN.** Es gehört einer nächtlichen Routine. Deine
> Pflicht ist ein Commit-Betreff, der die sichtbare Wirkung nennt.

---

## 1. Die Regel, in einfachen Worten

Das Regelwerk nennt **eine Zahl je Reiseart** — zu Fuß 30 Meilen am Tag, beritten 35, Kutsche 50 —
für eine gute Straße ohne Zwischenfälle. Alles andere macht davon nur langsamer:

1. **der Wegtyp** (Reichsstraße ×1,1 · Straße ×1,0 · Weg ×0,8 · Gebirgspass ×0,4) — aus der Quelle,
2. **die Steigung des konkreten Abschnitts** — unser Beitrag, denn die Quelle kennt nur Kategorien,
3. **die Strömung** auf Flüssen.

**Die Ausnahme, um die es geht:** Auf **Gebirgspässen** enthält der Wegtyp-Faktor die Steigung
bereits (Geographia Aventurica S. 123, wörtlich). Dort darf nicht ein zweites Mal gebremst werden.

**Unser Ausweg** (Setzung, *nicht* Regel): auf Pässen entscheidet die Steigung nur noch, ob ein Pass
über oder unter dem Durchschnitt liegt. Dazu wird durch den mittleren Steigungseffekt aller Pässe
geteilt. Der Durchschnittspass landet exakt auf dem Wert der Quelle.

```
F_α(s) = 1 + α · ( F(s) / mean_pass(F) − 1 )      nur für Subtyp „Gebirgspass"
F(s)   unverändert                                 für alle anderen Landsubtypen
```

`α = 0` ist die strenge Regelumsetzung, `α = 1` die volle Umverteilung. **Gebaut ist `α = 1`** — als Konstante, siehe §3/B.

---

## 2. Was schon da ist

| | Stand |
|---|---|
| `mean_pass(F)`, `c`, Mittel je Wegart | ✅ berechnet und in `path_terrain_stamp` gespeichert (`api/_internal/routing/terrain-calibration.php`) |
| Auslösung | ✅ Kachel „Wegprofile kalibrieren" im Wege-Editor |
| Wirkung aufs Routing | ✅ **seit `aa7ac68d`** — der Router liest den Normierer und wendet ihn auf `Gebirgspass` an. Gelesen, nie gerechnet |
| `alpha` | ✅ entschieden: **1**, als Konstante in `terrain-calibration.php`, nicht als Spalte |
| Kurvenspiegel für die Plots | ✅ `js/pages/wege-editor-model.js`, gegen `terrain-factor.php` getestet (346 Prüfungen) |

---

## 3. ✅ Die drei Owner-Entscheidungen — alle gefallen

**A — Welche Steigungskurve?** → **Leistungskilometer.** Zur Wahl standen die damalige Kurve,
Tobler und Irmischer & Clarke (bei 20 % Steigung 3,00 / 2,01 / 1,27 — Faktor 2,4 auseinander).
Entschieden hat ein unabhängiger Prüfstein: rechnet man den Faktor in eine **implizierte
Steigrate** zurück, ergibt die alte Kurve am Koschberge-Pass 490 Hm/h und Tobler 466 Hm/h —
schneller als jede veröffentlichte Norm für trainierte Wanderer. Der Leistungskilometer
impliziert 317 Hm/h. Begründung im Kopf von `terrain-factor.php`. ⚠️ Die DSA-Werte ×0,75 und
×0,5 taugten **nicht** als Prüfstein; die Quelle nennt sie selbst schwer angebbar und definiert
weder „Hügel" noch „Berg".

**B — Welcher Wert für `α`?** → **1**, volle Umverteilung (`aa7ac68d`). Der durchschnittlich
vermessene Pass landet exakt auf dem Wegtyp-Faktor der Quelle, ein flacher Pass ist schneller,
ein steiler langsamer — die Geländeebene behält auf Pässen also eine Bedeutung, statt dort
abgeschaltet zu werden. 💣 **Nur wo ein Profil existiert:** ein unvermessener Pass wird gar nicht
angefasst. Seine implizite 1,0 zu teilen hieße, ihm 22 % Rabatt fürs Nichtvermessensein zu
geben — am schnellsten genau dort, wo wir am wenigsten wissen. Das ist kein Randfall: 44 % der
Passmeilen haben kein Höhenprofil.

**C — Wird das absolute Niveau an die Quelle angeglichen?** → **Ja** (`d9d7ab39`). Wir lagen an
Land 11–87 % und auf Flüssen 2,5× über den Tagesleistungen der Quelle. Jedes Reisemittel trägt
jetzt seine eigene Zahl aus S. 123 / 129 / 131. Die ganze Karte ist dadurch spürbar langsamer
geworden — das war die sichtbarste Änderung von allen und ist genau so beabsichtigt.

---

## 4. Arbeitspakete — Status

### ✅ P1 — Wasser: der Skalierungsfehler *(`3dc64753`)*

💣 Die rohen Tabellenwerte **stimmten** — sie trafen die Quelle exakt, wenn man sie mit *ihrer*
Stundenzahl multiplizierte. Der Router ließ auf dem Wasser aber **24 Stunden** fahren, weil dort
keine Rast anfiel. Gelöst wurde es über die Rastregel, nicht über die Tabelle: `Flussweg` hat die
Rastbefreiung verlassen (S. 129 nennt den 12-Stunden-Reisetag ausdrücklich), und die Basiswerte
tragen seither die Tagesleistung der Quelle — Flusskahn 5,0 → 4,0, Flusssegler 7,5 → 6,0.

Auf **See** blieb es zunächst unberührt und wurde dann in `d9d7ab39` anders gelöst als gedacht:
die Nachtfahrt gehört einem **Schiff**, nicht dem Wegtyp. `seaNote` wurde entsprechend neu
geschrieben — nicht, weil es der Quelle widersprach, sondern weil es alle drei Seeschiffe über
einen Kamm schor.

### ✅ P2 — Strömung *(`3dc64753`)*

Vorgabewert von 1,5 auf **2,0** gehoben; die Quelle paart stromauf gegen stromab durchgehend so
(Kahn 20/40, Segler 30/60), die Flussgaleere liegt bei 2,14. Klemme `[1,0 … 3,0]` unverändert.
`riverNote` ist mitgezogen, das Editor-Feld „Strömungsfaktor" füllt mit 2,0 vor. ⚠️ Das wirkt auf
fast alle Flüsse, weil der Verlauf-Sync `dir` schreibt und `factor` nie.

### ✅ P3 — Kutsche auf Pässen *(`3dc64753`)*

„Auf Karrenwegen und Pässen nur halbe Geschwindigkeit" (S. 123) ist abgebildet: `Weg` und
`Gebirgspass` halbiert, gemessen gegen die Straße 0,409 und 0,182.

### ✅ P4 — Die Normierung auf Gebirgspass *(`aa7ac68d`)*

Der Router liest `relative_to_reference` aus der gespeicherten Eichung und teilt den Steigungs-
faktor eines `Gebirgspass` dadurch. Kein anderer Subtyp wird angefasst.

💣 **Der Wert wird gelesen, nie berechnet** — eine indizierte Einzelzeilen-Abfrage auf der
ohnehin offenen PDO. Fehlt die Eichung oder liegt der Wert außerhalb `[1,0 … 4,0]`, ist das
Ergebnis exakt 1,0, also ein echtes No-op. Eine bewegte `map_revision` wird **gemeldet**
(`terrain.stale`), nie stillschweigend nachgerechnet — der veraltete Wert wird trotzdem
angewandt, denn ihn zu verweigern hieße, die Doppelbremse zurückzuholen.

### ⚠️ P5 — Texte *(zwei Reste offen)*

Nachgezogen sind `seaNote`, `restRule`, `riverNote`, das Planerfeld („Reisestunden pro Tag", weil
Flüsse jetzt auch rasten), die ausgeschriebenen Geschwindigkeiten der Land-Auswahl und die
englischen Entsprechungen in `js/app/i18n-en.js`.

🔧 **Offen, gemessen am 2026-08-03** — beide in `js/routing/transport-speed-info.js`:

- `intro`: *„Eine gute Reichsstraße trägt dich **doppelt so schnell** wie ein **Gebirgspfad**."*
  Zwei Fehler in einem Satz: der Wegtyp heißt **Gebirgspass**, und das Verhältnis ist **2,7- bis
  3,0-fach** (Kutsche sogar 6,0×, weil sie auf Pässen zusätzlich halbiert).
- `crossCountryRule`: *„Das ist zäh (**1,25–2,5** Meilen/h)"* — die Querfeldein-Spanne ist seit
  `d9d7ab39` **0,96–1,6 Meilen/h**.

⚠️ Der Wächter `api/_internal/routing/__tests__/terrain-text-claims-test.php` ist grün: er deckt
den Steigungssatz, `riverNote`, `restRule` und `seaNote` ab — diese beiden Zahlen aber nicht. Wer
sie korrigiert, sollte sie gleich mit in den Wächter nehmen.

### ✅ P6 — Der Wege-Editor

„Funktionen anzeigen" zeigt die geltende Kurve; `wege-editor-model.js` ist Spiegel von
`terrain-factor.php` und trägt dieselben Geschwindigkeiten wie die beiden anderen Tabellen. Die
Kalibrier-Kachel listet je Wegart `mean_factor`, die Anzahl vermessener Wege und
`relative_to_reference` — also den Passnormierer selbst. `α` erscheint nicht, weil es eine
Konstante ist und kein Eichwert.

---

## 5. Fallen

💣 **`js/pages/wege-editor-model.js` und `api/_internal/routing/terrain-factor.php` sind zwei
Implementierungen derselben Regel.** Beide sind gegen dieselben Stützpunkte getestet. Eine Änderung
auf einer Seite ohne die andere macht einen Test rot — genau dafür ist er da.

💣 **Querfeldein ist landschaftsabhängig** und darf nicht pauschal behandelt werden. Heute folgenlos:
synthetische Kanten tragen gar keinen Geländefaktor. ⚠️ **Für die V14-Offroad-Etappen ist das nicht
geprüft** — das ist eine offene Lücke, prüf sie.

✅ **Die Rastzeit an Land — gelöst, und so bitte lassen.** DSAs 30 Meilen sind ein *ganzer*
Reisetag inklusive Rast, der Planer schlägt die Rast aber auf die Reisezeit auf. Das wäre mit
Entscheidung C eine Doppelzählung geworden. Aufgelöst ist es über den Divisor: die Tagesleistung
der Quelle wird auf **12 Reisestunden** gelegt, die Rast füllt die anderen 12. Ein voller
24-Stunden-Reisetag ergibt damit wieder genau die 30 Meilen der Quelle. 💣 Wer die Tabellenwerte
ohne diesen Divisor anfasst, holt die Doppelzählung zurück.

💣 **`ASSET_VERSION`** in `js/territory/territory-editor-inline-host.js` bumpen bei dynamisch
geladenen Editor-Assets. `edit/index.php` verlinkt `css/pages/edit.css` mit handgeschriebenem `?v=`.

💣 **Geteilter Arbeitsbaum:** nie `git add -A`, eigener Worktree aus `origin/master`, Hauptbaum nicht
umstellen. Er hinkt mehrere hundert Commits hinterher — immer `git fetch` zuerst.

💣 **STRATO:** eine Anfrage, nie in einer Schleife.

---

## 6. Alle Orte, an denen das Modell auftaucht

`api/_internal/routing/terrain-factor.php` (der Rechenkern) · `terrain-calibration.php` ·
`client-graph.php` (Anwendung + Strömung) · `js/pages/wege-editor-model.js` (Spiegel) ·
`js/routing/route-plan.js` + `route-node.js` (angezeigte Zeit) · `route-result.js` (Rast) ·
`route-speed-arrows.js` · `js/routing/transport-speed-info.js` + `js/app/i18n-en.js` (Dialog) ·
`js/config.js` (`SPEED_TABLE`, `TIME_SCALE_FACTOR`) · `html/landschaften-editor.html` ·
`html/wege-editor.html` + `js/pages/wege-editor.js` · `html/landschaften-modell.html` ·
🔴 `html/editor-handbuch.html` — **nur melden, nicht anfassen**.

---

## 7. Tests

Vorhanden und grün zu halten: `terrain-factor-test`, `terrain-read-test`, `terrain-calibration-test`,
`terrain-text-claims-test`, `carriage-offroad-test` (PHP, **mit `-d zend.assertions=1`**, sonst prüft
`assert()` nichts) sowie die elf Tests in `js/routing/__tests__/` und
`js/pages/__tests__/wege-editor-model.test.js`.

Neu zu sichern: `α = 0` liefert auf Gebirgspass exakt 1,0 · `α = 1` liefert über den gespeicherten
Bestand ein längengewichtetes Mittel von exakt 1,0 · alle anderen Landsubtypen bleiben unnormiert ·
der Normierungswert wird gelesen, nie berechnet · ein veralteter Eichsatz meldet, statt zu rechnen.

---

## 8. Bekannte Lücken — bewusst nicht in diesem Auftrag

Sie stehen hier, damit sie nicht als Auslassung durchgehen:

**Aus der Quelle nicht abgebildet:** „Reittiere müssen geführt werden" auf den mit \* markierten
Geländearten (Tagesleistung fällt auf Fußgruppe) · Wetter- und Bodenmodifikatoren · Eilmarsch ·
die Untergrenze 0,05 für den Gesamtmodifikator · Reichs- und Landstraßen sind von aufgeweichtem
Boden ausgenommen.

⭐ Die **Kutsche auf Karrenwegen und Pässen** und die **saisonale Passsperrung** standen hier
bis 2026-08-03 mit in der Liste. Erstere ist gebaut (`3dc64753`), letztere hat seit `b3310d83`
ihre Mechanik — ⚠️ aber noch kein einziges gepflegtes Zeitfenster, alle Wege gelten als
ganzjährig gangbar.

**Modellseitig offen:** die Kante bei 20 % Gefälle (Sprung von 1,0 auf 2,33; Reparatur braucht einen
zusätzlichen Profilwert und damit DDL plus neuen Profillauf) · die landschaftsabhängige Behandlung
von Querfeldein · dass für *leichter Wanderer*, *Reisegruppe beritten* und *Karawane* kein
offizieller Tagesleistungswert existiert, den man angleichen könnte.

**Nicht gemessen:** `mean_pass(F)` über den Livebestand. Der Knopf existiert, gedrückt hat ihn
niemand. **Das ist der erste Schritt** — ohne diese Zahl ist P4 nicht bewertbar.
