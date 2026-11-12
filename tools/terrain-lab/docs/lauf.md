# Läufe: Generatoradapter, Performance, Qualität, Commit-Vergleich (WI-0250, Phase B)

Das Lab rechnet die Gebirge nicht selbst. Der **Adapter** (`scripts/dev/terrain-lab/rechne.ts`, TypeScript, Node 24) ruft den Generator als
Rechenkern auf, misst und legt Raster im Austauschformat (`terrainlab/raster.py`) und eine `meta.json` ab. Der **Python-Teil**
(`tools/terrain-lab/terrainlab/lauf/`) startet den Adapter, wiederholt, fasst zusammen, bewertet die Raster mit den Deskriptoren
(`docs/deskriptoren.md`) und vergleicht Commits. Gemessen wird immer ein **festgelegter Stand**, nie ein halb veränderter Arbeitsbaum.

## 1 Aufruf

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"
& $py -s -m terrainlab lauf profile                                   # eingebaute Profile
& $py -s -m terrainlab lauf perf schnell --commit HEAD                # schneller Regressionslauf (etwa 3 Minuten)
& $py -s -m terrainlab lauf perf basis --commit HEAD                  # Basismessung (Abschnitt 8)
& $py -s -m terrainlab lauf perf voll --commit HEAD --schnappschuss C:\avesmaps3d-data\wi-0249\snap   # bewusst gestartet, rund eine Stunde
& $py -s -m terrainlab lauf qualitaet qualitaet --commit HEAD         # Metrikvektor je Fall, mit Zwischenspeicher
& $py -s -m terrainlab lauf vergleiche <commitA> <commitB> qualitaet  # Verbesserung/Regression je Kennzahl
& $py -s -m terrainlab lauf stand <commit>                            # nur die Arbeitskopie zu einem Commit anlegen
```

`perf` und `qualitaet` nehmen eine Konfigurationsdatei oder den Namen eines eingebauten Profils (`terrainlab/lauf/profile/*.json`).
Gemeinsame Optionen: `--commit` (Abschnitt 3), `--ausgabe ORDNER` (Vorgabe `<Labor>\laeufe\<art>\<zeit>-<konfig>-<commit>`),
`--nur NAME[,NAME]` (Fälle, deren Name den Text enthält), `--schnappschuss ORDNER` (für alle Endgelände-Fälle), `--trocken` (nur
anzeigen), `--schmutzig-erlauben`, `--ohne-sperre`, `--ohne-pruefung`. `perf` kennt zusätzlich `--wiederholungen`, `--warm`, `--arbeiter`;
`qualitaet` und `vergleiche` `--cache-neu`.

**Nur ein schwerer Lauf gleichzeitig.** Jeder Lauf nimmt die Sperre `<Labor>\laeufe\.lauf.sperre` (Prozess und Zweck stehen darin) und bricht
ab, wenn ein anderer sie hält; er wartet nicht. Davor prüft er freien Arbeitsspeicher (Vorgabe: 800 MiB für Vorschau und Saat, gemessene Spitze bis 270 MiB;
6000 MiB mit Endgelände) und 5 GiB Platz. Ein Lauf eines toten Prozesses wird abgeräumt. Wer die Läufe bewusst nebeneinander fährt, nimmt
`--ohne-sperre` und `--ohne-pruefung` und liest die Zeiten nicht mehr als Messung.

## 2 Der Adapter

```powershell
node --expose-gc scripts\dev\terrain-lab\rechne.ts <auftrag.json> <ausgabeordner> [Optionen]
```

| Option                | Wirkung                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--commit <sha>`      | rechnet in der Arbeitskopie zu diesem Commit (Abschnitt 3); ohne: in diesem Checkout, wenn die Generator-Verzeichnisse sauber sind                                      |
| `--schmutzig-erlauben` | misst auch einen unsauberen Baum (Entwicklung); der Lauf trägt den Hash der Änderung und `reproduzierbar: false`                                                         |
| `--warm <n>`          | nach dem kalten Lauf n warme Läufe im selben Prozess (Vorgabe 0); prüft nebenbei, dass jeder Lauf dieselben Bytes liefert (`deterministisch`)                           |
| `--phasen`            | Phasenproben des Rückennetzes (Abschnitt 2.3), `--phasen-wiederholungen <n>` (Vorgabe 3)                                                                                 |
| `--arbeiter <n>`      | `TERRAIN_EROSION_WORKERS` für diesen Lauf (0 bis 8; wirkt auf die Erosion des Geländes ab 1024²)                                                                         |
| `--ohne-raster`       | keine Rasterdateien, nur `meta.json` (reine Zeitmessungen)                                                                                                               |
| `--fingerprint`       | gibt Fingerabdruck des Auftrags, Commit und Sauberkeit aus und rechnet nichts (der Schlüssel des Zwischenspeichers)                                                      |
| `--stand-vorbereiten` | legt nur den Stand zu `--commit` an                                                                                                                                      |
| `--labor <ordner>`    | Datenwurzel (Vorgabe `AVESMAPS_TERRAIN_LAB`, sonst `C:\avesmaps3d-data\terrain-lab`)                                                                                     |

Ausgang: 0 gut, 1 Fehler im Lauf, 2 falsche Eingabe, 3 Arbeitsbaum unsauber (verweigert), 4 Stand nicht herstellbar. Die letzte Zeile der
Standardausgabe ist ein JSON-Objekt mit dem Pfad der `meta.json`. Für das Endgelände startet sich der Adapter selbst mit `--expose-gc` und
8 GiB Heap neu, wenn man die Flags nicht nennt.

### 2.1 Der Auftrag

Ein Auftrag sagt, **was** gerechnet wird, nicht, wie gemessen wird (Wiederholungen, Phasenproben, Arbeiter stehen nicht darin). Zwei Aufträge,
die dasselbe Ergebnis verlangen, haben denselben Fingerabdruck; er ist mit dem Commit der Schlüssel des Zwischenspeichers.

```json
{
    "name": "blutzinnen-2x",
    "gebirge": { "fixture": "blutzinnen" },
    "typ": "kettengebirge",
    "reglerQuelle": "fixture",
    "regler": { "erosion": 7 },
    "modell": { "talboden": 0.4 },
    "saat": 12345,
    "stufe": "vorschau",
    "vorschau": { "aufloesung": 2, "kante": 640, "talboden": "typ" },
    "rezept": {
        "fassung": 19,
        "ueberlagerung": { "presets": { "typen": { "kettengebirge": { "werte": { "erosion": 8 } } } } },
        "roh": null
    }
}
```

| Feld                     | Bedeutung                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gebirge`                | `{ "fixture": "<name>" }` (die Fälle unter `apps/server/test/fixtures/rueckennetz/`, im Stand des Commits) oder `{ "datei": "<pfad>" }` (gleiche Form: `input`, `paesse`, `area`)                                                |
| `typ`                    | Gebirgstyp (`kettengebirge`, `plateaugebirge`, …); wirkt auf die Typwerte des Rückennetzes (`gebirgsPresets.typen.<typ>.rueckennetz`) und bei `reglerQuelle: "preset"` auf die V12-Regler. `null`: Kettengebirge                 |
| `reglerQuelle`           | `fixture`: Regler der Fixture (Vorgabe, so sind die Prüfsummen der Tests reproduzierbar) · `preset`: Regler des Typs aus dem Rezept (`gebirgsRegler`), damit wirken Änderungen an den Presets                                      |
| `regler`                 | Überschreibungen der V12-Regler über der Quelle (`erosion`, `koernung`, `maximalhoehe`, …)                                                                                                                                       |
| `modell`                 | Abweichungen des Reiters „Gebirge“: `grat`, `gratBreite`, `talboden` (ein fester Talboden verhindert die Suche)                                                                                                                  |
| `saat`                   | überschreibt die Saat der Fixture                                                                                                                                                                                                |
| `stufe`                  | `vorschau` · `saat` · `endgelaende-lokal` (Abschnitt 2.2)                                                                                                                                                                         |
| `rezept.fassung`         | Fassung des Rezepts; leer: die Vorgabe der Datei `config/terrain/aventuria.json` (**derzeit 18**, nicht die offene 19). Die Profile nennen 19 ausdrücklich                                                                       |
| `rezept.ueberlagerung`   | die Werte von „19 (Test)“ (`HoehenmodellTestWerte`: `regler`, `rezept`, `presets`), geprüft von `mitTest`; Presets überlagern auch die Typwerte des Rückennetzes                                                                  |
| `rezept.roh`             | Rohwerte, ungeprüft in das Rezept gemischt (Tiefenmischung): für Werte außerhalb des Katalogs und für verkleinerte Proben (`generator.size`). Der Lauf vermerkt es (`roh_angewendet`)                                              |

### 2.2 Die Stufen

| Stufe               | Was gerechnet wird                                                                                                                                                                                                                                                                                         | Raster                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `vorschau`          | `rechneVorschau`, die Rechnung der Gebirge-Vorschau im Editor (Rückennetz der Landschaft, `kante` Zellen je längerer Kante bei Auflösung 1). Auflösung 1×/2×/4× = 750/375/187,5 m Zellweite (mindestens 0,25/0,125/0,0625 E; große Gebirge gröber, die Zellweite steht in `meta.raster.zellgroesse_m`) | `vorschau-<n>x`, außerhalb der Fläche NoData        |
| `saat`              | `buildMountainRaster`, die Saat, die das Gelände übernimmt: 0,25 E = 750 m, mit Pässen, Talboden aus dem Band des Typs gesucht, wenn kein fester gesetzt ist                                                                                                                                                  | `saat`, außerhalb der Fläche NoData                 |
| `endgelaende-lokal` | `computeLocalTerrain`: Saat neu rechnen und in den Schnappschuss einsetzen, grobe Stufe (4096², die **ganze** Karte, domainweit gekoppelt), feine Stufe (8192²) nur in den Rechenkacheln des Gebirges, Schlussschritte (Flüsse, Seen, Gipfel). Zwischenstände mit `endgelaende.zwischenstaende: true`    | `endgelaende` (Fenster um das Gebirge), `stufen/…` |

Alle Raster: Meter, **Zeile 0 = Nord** (der Generator rechnet mit Zeile 0 = Süd; gespiegelt wird im Adapter und nirgends sonst), 1 E = 3000 m,
1 Schritt = 1 m. Das Endgelände schneidet ein Fenster um den Rahmen des Gebirges plus `endgelaende.rand` (Vorgabe 6 E) aus dem feinen Gitter
(8192²: 0,125 E = 375 m je Zelle). Die Zwischenstände (nur mit `zwischenstaende`) liegen als `stufen/<phase>.*` im Fenster ihres Gitters
(grob 750 m, fein 375 m): `landforms`, `initial`, `seed`, `erosion-<r>-stream|diffusion|uplift`, `erosion`, `mountain-interior`,
`grob-constraints-water|cap|summits`, `fine-tiles`, `fein-constraints-water|cap|summits`.

**Dieselben Optionen wie der Server (WI-0249 P2).** Die Formerhaltung wirkt nur, wenn der Aufrufer dem Generator zwei Dinge mitgibt; Saat und Endgelände des Adapters tun es
genau wie der Server und rufen dazu dessen Funktionen aus dem Stand des Commits auf (`generator.ts`: `rueckennetzGitter`, `rueckennetzNetz`), statt sie nachzubauen. (1) Mit
`mountainMorphology.rueckennetz` im Rezept der Fassung (Fassung 19; 17 und 18 haben den Eintrag nicht) rechnet die Saat auf dem **Gitter des Geländes**
(`rueckennetzGitter(rezept)` aus `apps/server/src/terrain/inputs.ts`: `{ zelle: 1024 / size, mitte: zelle / 2 }`) statt ab dem Rahmen der Fläche; das Raster hat dann das Format des
Geländes (Blutzinnen 168 × 209 statt eines Rahmenrasters). (2) Das Endgelände hängt das gezeichnete Netz an den Eintrag des Gebirges (`rueckennetzNetz(input)` aus
`domain/rueckennetz-flaechen.ts`), und nur ein Gebirge, das das Rückennetz rechnet, steht in der Liste (`rechnetRueckennetz(netz, kopf)`, dieselbe Weiche wie in Gelände und Vorschau;
in Ständen davor die alte Regel „Kämme oder Mulden“, ein Gebirge nur mit Nebengipfeln rechnet dort V12). Die Vorschau nutzt dieselbe Weiche. `meta.parameter` meldet
`rueckennetz_gitter` und im Endgelände `rueckennetz_netz`; an Ständen ohne die Funktionen ist beides `null`/`false` und alles rechnet wie zuvor. Geprüft in
`apps/server/test/terrain-lab-adapter.test.ts` (Gitter und Zellmitten der Saat, Fassung 18 ohne Gitter, Mini-Endgelände mit Netz).

**Der Schnappschuss** (Eingaben des Geländes, nur lesend aus der Datenbank gezogen) liegt in einem Ordner mit `inputs.json`, `seeds.u16`,
`gebirge.json`, `master.json`, `master.u16`; Muster und Erzeugung: `project-control/discovery/wi-0249-formerhalt/snapshot.mjs` (REPEATABLE
READ, READ ONLY). Der Adapter liest ihn nur; sein Inhalts-Hash geht in den Fingerabdruck des Auftrags ein. Vorgabeort
`<Labor>\schnappschuss\aktuell`, sonst `endgelaende.schnappschuss` oder `--schnappschuss`. Die Rahmen von Fixture und Gebirge im Schnappschuss
müssen übereinstimmen.

### 2.3 Messung und Phasen

Jeder Adapter-Prozess rechnet **einmal kalt** (frischer Prozess, Module geladen, aber ungewärmt) und dann `--warm`-mal warm. Je Lauf:

- `wall_ms`: Wanduhr des Aufrufs (ohne Laden der Module, ohne Schreiben der Raster),
- `cpu_ms`: CPU-Zeit des ganzen Prozesses (`process.cpuUsage`, mit den Workern der Erosion),
- `rss_spitze_mib`: Spitzen-Arbeitssatz seit Prozessbeginn (monoton: nach dem kalten Lauf gelesen ist es dessen Spitze), `rss_ende_mib`,
- `fremdlast_kerne`: wie viele logische Prozessoren die Maschine im Mittel belegte, **minus die des eigenen Prozesses**, also die Last der anderen Sitzungen
  (24 auf diesem Rechner; gegengeprüft mit WMI `LoadPercentage`);
  `maschine_prozent` die Auslastung insgesamt. Eine Zeit ohne diese Angabe ist auf diesem Rechner kaum zu deuten.

Vor jedem gemessenen Lauf räumt der Adapter den Speicher auf (`gc`, deshalb `--expose-gc`).

**Phasen des Rückennetzes** (Vorschau, Saat) gibt es als Differenzen, weil die Rechnung keinen Rückruf je Phase hat, aber zwei Schalter:
`stufe: "grundform" | "landschaft"` und `talbodenFest`. Mit dem im Hauptlauf gefundenen Talboden als festem Wert rechnet sie dasselbe ohne
Suche. Dann gilt `netz_hebung` = Zeit(Grundform), `landschaft` = Zeit(Landschaft) − Zeit(Grundform) (Täler, Erosion, Pässe, Senkenfüllung),
`talboden_ableitung` = Zeit(wie im Hauptlauf) − Zeit(Landschaft, Talboden fest) (nur wenn der Hauptlauf sucht). Die Proben laufen nach dem
Hauptlauf (Module und JIT warm) und werden gemedianet (`--phasen-wiederholungen`). Stimmt das Ergebnis der letzten Probe nicht mit dem
Hauptlauf überein, steht `ergebnis_gleich: false` und die Anteile gelten nicht.

**Phasen des Endgeländes** kommen aus den Rückrufen des Generators (`phase`, `coarsePhase` von `computeLocalTerrain`, mit Zwischenständen
der Beobachter): `phasen_ms` einzeln, `gruppen_ms` in vier festen Gruppen (`saat`, `grob`, `fein`, `schluss`), gleich benannt für beide Wege.

### 2.4 Die `meta.json`

| Schlüssel                            | Inhalt                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auftrag`, `auftrag_fingerprint`     | der geprüfte Auftrag und sein Fingerabdruck (SHA-256 über das Ergebnis bestimmende Felder und die Inhalte von Datei und Schnappschuss)                                       |
| `eingabe_fingerprint`                | Fingerabdruck der **wirksamen** Eingabe (aufgelöste Regler, Saat, Typ, Gebirgsdatei, Rezept); zwei Aufträge, die dasselbe rechnen, teilen ihn                                  |
| `stand`                              | `art` (`arbeitsbaum` \| `stand`), `commit`, `baum_sauber`, `geaendert`, `aenderung_sha256`, `wurzel`, `reproduzierbar`                                                         |
| `rezept`                             | `fassung`, `fingerprint` (wie `recipeFingerprint`, nach Überlagerung und Rohwerten), `basis_fingerprint`, `ueberlagert`, `roh_angewendet`                                       |
| `parameter`                          | Stufe, aufgelöste Regler, Saat, Typ, Modell, Auflösung beziehungsweise Kacheln, Schnappschuss                                                                                  |
| `raster`                             | `breite`, `hoehe`, `zellgroesse_m`, `zellen`, `eigene_zellen`, **`ergebnis_fingerprint`**, `dateien`                                                                             |
| `laeufe`                             | je Lauf `art` (`kalt`/`warm`) mit den Messwerten aus 2.3 und der eigenen Zeit des Generators (`intern_ms`)                                                                      |
| `deterministisch`                    | alle Läufe des Prozesses lieferten dieselben Bytes                                                                                                                             |
| `phasenproben`, `phasen_ms`, `gruppen_ms`, `zwischenstaende` | Abschnitt 2.3 und 2.2                                                                                                                                  |
| `umgebung`                           | Node und V8, Plattform, Prozessor, Kerne, Arbeitsspeicher, Node-Optionen, `erosion_arbeiter_umgebung`, Fassungen der Drittpakete (`abhaengigkeiten`)                           |
| `zusatz`                             | Talboden, Zellweite in E, beim Endgelände Erosionsiterationen und -arbeiter, gerechnete Feinkacheln, Befunde, `voll_fingerprint` (die ganze 8192²-Karte)                          |

Der **Ergebnis-Fingerabdruck** ist der SHA-256 über die Uint16-Höhen (Schritt, gerundet und auf 0 bis 65535 geklemmt, außerhalb der Fläche 0,
little-endian). Float64-Rundungen unterscheiden sich je Plattform, die gerundeten Schritte nicht. Die Regel steht im Adapter und nicht im
Generator, damit ein Vergleich über Commits nicht an einer geänderten Rundung hängt. Beim Endgelände gilt er für das ausgeschnittene Fenster.

## 3 Bindung an einen Commit

Ohne `--commit` rechnet der Adapter in **diesem Checkout** und verweigert (Ausgang 3), wenn in `packages/shared/src`, `apps/server/src/terrain`,
`apps/web/src/gebirge-vorschau` oder `config/terrain` etwas vom Commit abweicht, auch ungetrackte Dateien (eine neue `.ts` kann eine alte
überschatten). Mit `--schmutzig-erlauben` läuft es trotzdem; die `meta.json` trägt `baum_sauber: false` und den Hash der Änderung, der
Zwischenspeicher wird dann nicht benutzt.

Mit `--commit <sha>` (Hash, Kurzhash oder Name):

1. `git archive` des Commits entpackt `packages/shared`, `apps/server/src`, `apps/web/src/gebirge-vorschau`, `config`, die Fixtures und die
   `package.json`-Dateien nach `<Labor>\staende\<sha12>` (bitgenau, ohne Zeilenenden-Umwandlung, ohne `.git`). Fehlende Pfade älterer Commits
   werden übersprungen. Einmal je Commit, danach wiederverwendet (`STAND.json` trägt Commit, Pfade und Fassungen).
2. Die zwei Drittpakete, die der Generator lädt (`@sinclair/typebox`, `postgres`), werden in der Fassung der `package-lock.json` **des Commits**
   in den Stand installiert (`npm install --ignore-scripts`, ein eigenes `package.json`, rund 6 Sekunden mit gefülltem npm-Zwischenspeicher).
   Es wird **kein `node_modules` des Hauptcheckouts verlinkt**, und kein Workspace-`npm ci`.
3. Der Adapter selbst läuft aus dem aktuellen Checkout und importiert die Module des Stands per `import()` mit absoluten Pfaden. Er braucht
   also keinen Adapter im alten Commit, solange dessen öffentliche Funktionen dieselben Namen tragen; eine fehlende Funktion meldet
   `Schnittstelle fehlt im Stand …: <name>`.
4. `@avesmaps3d/shared` löst `modul-hook.mjs` auf die **Quellen des Stands** auf (`packages/shared/src/index.ts` und `…/gebirge/browser.ts`).

🪤 **Warum der Hook.** In einer Arbeitskopie unter `.claude/worktrees/…` findet Node `@avesmaps3d/shared` über das `node_modules` des
Hauptcheckouts und damit dessen gebautes `dist`, nicht die Quellen der Arbeitskopie. Ein Messskript, das `apps/server/src/terrain/domain/*.ts` direkt
importiert (so die Skripte unter `project-control/discovery/`), rechnet `streamPowerHeight`, `fbm` und `hash2` mit dem Stand des Hauptcheckouts,
wann immer dessen `dist` gebaut wurde. Der Adapter vermeidet das für beide Wege; `vitest.config.ts` löst dasselbe Problem für die Tests mit einem Alias.

## 4 Performance-Benchmark

`lauf perf <konfig>`: je Fall `wiederholungen` frische Prozesse, in jedem ein kalter und `warm` warme Läufe; Phasenproben im ersten
Prozess (`phasen: "erster"`) oder in jedem (`"alle"`). Raster werden nicht geschrieben. Zusammengefasst wird je Kennzahl der **Median** mit
`streuung_prozent` (mediane absolute Abweichung, bezogen auf den Median, robust gegen einen Ausreißer), `spanne_prozent`, Minimum, Maximum.

```json
{
    "name": "schnell",
    "vorgabe": { "rezept": { "fassung": 19 } },
    "wiederholungen": 3,
    "warm": 1,
    "phasen": "erster",
    "phasen_wiederholungen": 3,
    "arbeiter": null,
    "matrix": [{ "fixtures": ["blutzinnen", "trollzacken"], "stufe": "vorschau", "aufloesungen": [1, 2] }],
    "faelle": [{ "name": "blutzinnen-saat", "gebirge": { "fixture": "blutzinnen" }, "stufe": "saat", "warm": 0 }]
}
```

`vorgabe` wird tief in jeden Fall gemischt; ein Fall kann `wiederholungen`, `warm`, `phasen`, `phasen_wiederholungen` überschreiben. `matrix` erzeugt
Fälle nach `<fixture>-vorschau-<n>x`, `<fixture>-saat`, `<fixture>-endgelaende`. Weitere Schlüssel: `qualitaet` und `ziele` (Abschnitt 5 und 6),
`mindest_frei_ram_mib`.

**Ergebnis** (`ergebnis.json` im Ausgabeordner, dazu `<fall>/p<i>/meta.json` je Prozess): Kopf mit Konfiguration, Stand (Commit, Art, Sauberkeit),
Rechner (Prozessor, Kerne, Arbeitsspeicher, Python, NumPy, SciPy, Node, Node-Optionen, Drittpakete, Erosionsarbeiter) und je Fall `kalt` und
`warm` (`wall_ms`, `cpu_ms`, `rss_spitze_mib`), `phasen` (Millisekunden und Anteile), beim Endgelände `domain` (Gruppen und Phasen, Erosion),
`fremdlast_kerne`, `unruhig`, `ergebnis_fingerprint`, `fingerprint_stabil`, `deterministisch`. **`unruhig`** ist wahr, wenn die Streuung der kalten Zeiten über 10 % liegt oder die Fremdlast im Median über 40 % der logischen
Prozessoren — dann die Reihe wiederholen, wenn die Maschine ruhiger ist. Mäßige Fremdlast (auf diesem Rechner meist 4 bis 7 von 24, mehrere Sitzungen
rechnen) macht eine Reihe nicht unruhig, steht aber in jedem Fall dabei.

Profile:

| Profil      | Inhalt                                                                                                                                              | Dauer           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `schnell`   | Blutzinnen, Nordwalser Höhen, Trollzacken; Vorschau 1× und 2×; 3 Prozesse, je ein warmer Lauf, Phasenproben im ersten                                | unter 5 Minuten |
| `basis`     | Blutzinnen und Trollzacken, Vorschau 1×/2×/4×, Phasenproben im ersten Prozess (Abschnitt 8)                                                           | etwa 10 Minuten |
| `voll`      | alle fünf Fixtures, Vorschau 1×/2×/4×, Saat von Blutzinnen und Nordwalser Höhen, lokales Endgelände der Blutzinnen (Schnappschuss nötig, ganze grobe Stufe) | rund eine Stunde |
| `qualitaet` | Grundlage für `lauf qualitaet`                                                                                                                      |                 |

## 5 Qualitätsbenchmark und Zwischenspeicher

`lauf qualitaet <konfig>`: je Fall (1) Schlüssel beim Adapter erfragen, (2) das Raster aus dem Zwischenspeicher holen oder rechnen lassen,
(3) den Metrikvektor aus dem Zwischenspeicher holen oder mit `terrainlab.deskriptoren` berechnen, (4) mit `referenz` zusätzlich den Vektor
des Referenzrasters und den Abstand zu ihm. Ergebnis: `ergebnis.json` (je Fall alle Einzelwerte als Liste, Herkunft aus dem Zwischenspeicher)
und `metriken/<fall>.json` (der volle Metrikvektor mit Verteilungen und Reihen, Format der Deskriptoren, wieder lesbar mit
`Metrikvektor.lies`). Einstellungen der Deskriptoren in der Konfiguration: `"qualitaet": { "gruppen": ["hoehe","hang"], "ohne_teuer": true, "parameter": { "min_prominenz_m": 50 } }`.
Ein Gesamtwert entsteht nicht.

**Zwischenspeicher** (`<Labor>\cache\`): `raster\<commit12>\<auftrag24>\` (die Ausgabe des Adapters; Schlüssel: Commit und Auftrag) und
`metrik\<commit12>\<auftrag24>\<schluessel24>.json` (Schlüssel zusätzlich: Prüfsumme des Rasters, Parameter, Gruppen, `ohne_teuer` und ein Hash über
den **Quelltext der Deskriptoren**, damit eine geänderte Metrik den alten Eintrag nicht trifft). Veröffentlicht wird atomar (erst ein vollständiger Lauf
wird umbenannt). Ein unsauberer Baum nutzt ihn nicht. `--cache-neu` übergeht ihn. Ein Treffer gilt als das Ergebnis: Das Raster eines Auftrags
an einem Commit ist deterministisch (der Adapter und `perf` prüfen das mit `deterministisch` und `fingerprint_stabil`).

## 6 Vergleich zweier Commits

`lauf vergleiche <commitA> <commitB> <konfig>` lässt den Qualitätslauf an beiden Commits laufen (Zwischenspeicher: was schon gerechnet ist, wird nicht
wiederholt) und vergleicht Fall für Fall, B gegen A: Einzelwerte (Differenz, relative Änderung), Verteilungen (normierter Wasserstein-Abstand
zwischen A und B), Reihen (mittlerer Abstand). Die Deskriptoren-Einstellungen beider Läufe müssen gleich sein.

**Bewertung.** Ob eine Änderung besser ist, sagt nicht die Zahl, sondern ein Maßstab, und den gibt es nur, wo er benannt ist (Reihenfolge):

1. `ziele` der Konfiguration, je Metrikname oder Familie (`hang_neigung_mittel_f{F}`): `{ "richtung": "hoeher" | "niedriger" }` oder `{ "ziel": 12.5 }`,
   optional `"toleranz"`.
2. die `referenz` des Falls (Pfad eines Referenzrasters gleicher Zellgröße, z. B. aus dem Referenzkorpus): näher an der Referenz ist besser, für
   Einzelwerte, Verteilungen und Reihen.
3. sonst `unbewertet`: Die Änderung wird gemeldet, aber nicht gedeutet.

Urteile: `besser`, `schlechter`, `gleich` (innerhalb der Toleranz `--toleranz`, Vorgabe 1 % des größeren Betrags), `unbewertet`. Die Ausgabe zählt je Fall und
Urteil und listet die größten Regressionen und Verbesserungen der Einzelwerte; `vergleich.json` trägt alles.

## 7 Dateien

| Datei                                                                  | Inhalt                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/dev/terrain-lab/rechne.ts`                                    | Einstieg des Adapters                                                               |
| `…/auftrag.ts`, `eingabe.ts`, `stufen.ts`, `endgelaende.ts`, `phasen.ts` | Auftrag und Fingerabdruck; Gebirge, Rezept, Regler; Vorschau und Saat; Endgelände; Phasenproben |
| `…/stand.ts`, `modul-hook.mjs`, `generator.ts`, `pfade.ts`             | Baum prüfen, Stand anlegen; Auflösung von `@avesmaps3d/shared`; Laden der öffentlichen Funktionen |
| `…/austausch.ts`, `messung.ts`, `schnappschuss.ts`, `typen.ts`         | Austauschformat und Fingerabdruck; Messwerkzeuge; Schnappschuss lesen; gemeinsame Typen |
| `…/grenzen.ts`                                                         | Parametergrenzen, Typen und Ausgangswerte aus den Verträgen des Generators als JSON (`docs/optimierung.md`) |
| `tools/terrain-lab/terrainlab/lauf/`                                   | `cli`, `adapter`, `konfig`, `perf`, `qualitaet`, `vergleich`, `cache`, `sperre`, `statistik`, `umgebung`, `profile/` |
| `apps/server/test/terrain-lab-adapter.test.ts`                         | Adapter: Auftrag, Austauschformat, Baum, Fenster, Prozess an Vorschau und Mini-Endgelände |
| `tools/terrain-lab/tests/test_lauf*.py`                                | Konfiguration, Statistik, Zwischenspeicher, Sperre, Perf, Qualität, Vergleich; der echte Adapter |

## 8 Basismessung (2026-10-23)

Gemessen mit `lauf perf basis --commit HEAD` an dem Commit, der diesen Adapter einführt (Generator, Rezepte und Fixtures unverändert gegenüber `origin/master` `a3c958f85`; Rezept Fassung 19),
am 23.10.2026 zwischen 14:59 und 15:08, Dauer 546 s. Rechner: Windows 11, AMD Ryzen 9 5900X (12 Kerne, 24 logische Prozessoren), 32 GiB, Node 24.14.1
mit `--expose-gc`, `@sinclair/typebox` 0.34.52, Python 3.12.15, NumPy 2.5.4. Ergebnis: `C:\avesmaps3d-data\terrain-lab\laeufe\perf\basis-2026-10-23\ergebnis.json`.
Je Fall 3 frische Prozesse (kalt), bei 1× und 2× je ein warmer Lauf; Phasenproben im ersten Prozess (3 Wiederholungen je Probe, beim 4× der
Blutzinnen 1). Alle Fingerabdrücke je Fall stabil über die Prozesse, jeder Lauf deterministisch. Die Maschine war nicht leer: **Fremdlast 4 bis 8 von 24
logischen Prozessoren** (andere Sitzungen), dennoch Streuung der kalten Zeiten höchstens 5,2 %.

| Fall                | Raster (Zellen, Zellweite) | kalt ms (Median ± %) | warm ms | CPU ms | RSS-Spitze MiB | Fremdlast | netz_hebung ms | landschaft ms |
| ------------------- | -------------------------- | -------------------- | ------- | ------ | -------------- | --------- | -------------- | ------------- |
| Blutzinnen 1×       | 166 × 208 (34 528; 750 m)    | 1 319 ± 3,5          | 1 433   | 1 906  | 166            | 6,6       | 185 (12 %)     | 1 365 (88 %)  |
| Blutzinnen 2×       | 332 × 415 (137 780; 375 m)   | 5 564 ± 4,8          | 6 143   | 7 031  | 164            | 6,7       | 562 (9 %)      | 5 453 (91 %)  |
| Blutzinnen 4×       | 662 × 829 (548 798; 187,5 m) | 25 066 ± 0,2         | -       | 29 953 | 234            | 4,3       | 1 792 (7 %)    | 24 228 (93 %) |
| Trollzacken 1×      | 265 × 210 (55 650; 750 m)    | 1 845 ± 5,2          | 2 482   | 2 499  | 160            | 7,7       | 159 (7 %)      | 2 201 (93 %)  |
| Trollzacken 2×      | 528 × 419 (221 232; 375 m)   | 10 874 ± 1,3         | 11 794  | 12 296 | 212            | 6,4       | 484 (4 %)      | 10 991 (96 %) |
| Trollzacken 4×      | 1 055 × 836 (881 980; 187,5 m) | 75 278 ± 2,3       | -       | 81 812 | 253            | 6,0       | -              | -             |

Lesehilfe und Befund:

- **Die Landschaft dominiert**: 88 bis 96 % der Zeit gehen in Täler, Erosion, Pässe und Senkenfüllung (`landschaft`); Netz und Hebung (`netz_hebung`) sind 4 bis
  12 %. Mit der Auflösung wächst der Anteil der Landschaft. Die Proben laufen warm nach dem Hauptlauf; ihre Summe entspricht der warmen Zeit, nicht der kalten.
  Der Talboden war bei der Vorschau mit `talboden: typ` fest (0,2), es gab keine Ableitung. Die Saat (Abschnitt 2.2) sucht ihn: bei den Blutzinnen 1,9 s
  (davon `talboden_ableitung` 0,75 s), bei Trollzacken 5,5 s (3,9 s), Nordwalser Höhen 0,4 s.
- **Skalierung**: Von 1× auf 2× und 2× auf 4× vervierfacht sich die Zellzahl. Die Blutzinnen brauchen das 4,2- und 4,5-Fache (fast linear), die Trollzacken das
  5,9- und 6,9-Fache (überlinear: Längen in Zellen wachsen mit, Täler und Erosion laufen länger).
- **Warm ist nicht schneller als kalt** (+8 bis +35 %): Das Aufwärmen der Module spielt bei Rechnungen von über einer Sekunde keine Rolle; der kalte Lauf ist der
  maßgebliche. Die CPU-Zeit liegt 9 bis 44 % über der Wanduhr (Speicherbereinigung und Übersetzer von V8 in eigenen Threads).
- **Speicher**: Spitzen-RSS 160 bis 253 MiB, davon rund 115 MiB Grundlast des Prozesses mit geladenen Modulen (`rss_nach_vorbereitung_mib`).
- Einzelläufe der übrigen Fixtures (ein Prozess, Vorschau 1×/2×/4×, mit Startzeit): Nordwalser Höhen 0,3/0,9/3,7 s, Grimmfrostöde-Massiv 3,5/16/83 s, Ehernes Schwert
  13/53/229 s. Saat: Nordwalser 0,4 s, Blutzinnen 1,9 s, Trollzacken 5,5 s, Grimmfrostöde-Massiv 5,0 s, Ehernes Schwert 146 s. Das schnelle Profil (`schnell`) brauchte 219 s.
- **Endgelände**: nicht an der Karte gemessen (die grobe Stufe ist ein Lauf der ganzen Karte). Der Pfad ist an einem Mini-Gelände geprüft (256²/512², beide Wege
  gleiche Bytes); die Zahlen dieser Probe sagen nichts über die Karte. Die erste Messung der Karte ist ein bewusster Start von `lauf perf voll --nur endgelaende`.

**Beispiel Commit-Vergleich** (`lauf vergleiche e36048e76 7c9d2c986 qualitaet`, die Commits vom 21.10. „Gipfel und Flanken“): Alle vier Fälle haben ein anderes Raster,
109 bis 142 von 161 bis 171 Einzelwerten ändern sich um mehr als 1 %. Am größten in der Saat der Blutzinnen: `hoehe_q25` 0,12 m → 188,8 m,
`hoehe_anteil_hoch` 0,9 % → 7,2 %, `hang_kruemmung_profil_mittel` wechselt das Vorzeichen; die Vorschau 2× der Blutzinnen: `hydro_senken_flaeche_median`
0,28 km² → 64 km². Ohne `ziele` und `referenz` urteilt der Vergleich dazu nichts (`unbewertet`). Zwischen `a514b0a5a~1` und `a514b0a5a` (WI-0249 P0) sind
alle vier Raster **gleich**, wie dessen Commit-Text sagt („die fünf Fixtures rechnen bytegleich“).

**Beispiel Commit-Vergleich WI-0249 P2** (`lauf vergleiche f1586257d 83c781853 konfig/lauf/p2-vergleich.json`, 62 s; das Profil liegt unter `konfig/lauf/`, damit es nicht mit den Optimierungsprofilen
gemischt wird): Saat und Vorschau 2× der Blutzinnen (Kettengebirge) und der Trollzacken (Karst) sowie die Vorschau 2× der Nordwalser Höhen, je gegen den Referenzausschnitt desselben Typs und
Maßstabs (Rohvergleich: keine Reliefangleichung, auch die Höhenlagemaße zählen, die die Bewertung der Optimierung ausschließt). **Alle fünf Raster sind verschieden**; von 948 Einzelwerten
werden 328 besser, 267 schlechter, 304 bleiben gleich, 49 sind unbewertet. Auffälligste Verschiebungen: Trollzacken 2× `hoehe_anteil_band_b9` +384 %, `hoehe_anteil_hoch` +134 %; Blutzinnen 2× `hydro_senken_anteil`
→ 0; besser: Nordwalser 2× `hoehe_anteil_band_b8` +210 %, Trollzacken Saat `hang_anteil_gt45` −74 %. Der Rohvergleich zeigt, **dass** sich P2 überall auswirkt, nicht, ob das Gelände dadurch plausibler wird;
dafür gibt es die Nachmessung der Vorschläge mit der vollen Bewertung (`optimierung nachmessen`, `docs/optimierung.md` Abschnitt 14). Zeit: Die Saat der Blutzinnen braucht 4,3 s statt 2,0 s (Gitter des Geländes).

## 9 Grenzen und offene Punkte

- **Fehlende Schnittstellen des Generators** (gehören WI-0249, hier nicht gebaut): (1) `LocalComputeOptions` hat kein Feld `beobachter`; für Zwischenstände
  bildet der Adapter die drei Schritte von `computeLocalTerrain` nach (`endgelaende.ts`, `laufMitBeobachter`; beide Wege liefern dieselben Bytes, das prüft der
  Test mit einem Mini-Gelände). (2) `rechneRueckennetz` hat keinen Rückruf je Phase; die Phasen kommen aus Differenzen (Abschnitt 2.3), was bei
  kleinen Zeiten rauscht. Ein Rückruf wie `phase(name)` machte beide Umwege überflüssig.
- Die Phasenproben des Rückennetzes bilden die Optionen nach, mit denen `rechnen.ts` der Vorschau und `rueckennetz/raster.ts` die Rechnung aufrufen. Ändert sich
  dort ein Aufruf, steht `ergebnis_gleich: false`, bis `stufen.ts` folgt.
- Der Schnappschuss entsteht noch mit einem Messskript aus WI-0249; ein Werkzeug im Lab, das ihn aus der Datenbank zieht (nur lesend), gibt es nicht.
- Das lokale Endgelände rechnet die ganze grobe Stufe (rund 3 bis 6 Minuten und mehrere GB); es steht nur im Profil `voll`. Gemessen wurde es hier nur an
  einem Mini-Gelände (256²/512²) für die Korrektheit des Pfades, nicht an der Karte.
- Warme Läufe des Endgeländes sind nicht vorgesehen (`--warm` ist dort nur für Mini-Proben sinnvoll).
- Die Zeiten sind Zeiten dieses Rechners unter Last anderer Sitzungen (`fremdlast_kerne`); zwischen Rechnern oder Tagen vergleichbar sind nur Reihen
  mit niedriger Fremdlast und gleicher Node-Fassung.
