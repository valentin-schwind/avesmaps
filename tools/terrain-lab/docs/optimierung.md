# Optimierung und Bewertung (WI-0250, Phase A4)

Das Lab sucht die Werte der Gebirgstypen systematisch, statt sie von Hand zu raten: gestuft, fortsetzbar, mit festen Saaten, ohne KI im Lauf. **Ergebnis ist eine
Vorschlagsdatei, nie eine Fassung.** Der Optimierer schreibt weder `config/terrain/aventuria/19.json` noch sonst etwas, das der Generator liest, und ändert keine Kartendaten.
Code: `tools/terrain-lab/terrainlab/{bewertung,optimierung}/`, Profile: `tools/terrain-lab/konfig/`, Tests: `tools/terrain-lab/tests/test_{bewertung,optimierung}*.py`.

## 1 Aufruf

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"
& $py -s -m terrainlab optimierung profile                              # Profile unter konfig\
& $py -s -m terrainlab optimierung grenzen kettengebirge --commit HEAD  # der Parameterraum eines Typs, aus den Verträgen des Generators (nicht abgeschrieben)
& $py -s -m terrainlab optimierung starten durchstich --trocken         # Plan und Grenzen anzeigen
& $py -s -m terrainlab optimierung starten durchstich                   # neuer Lauf unter <Labor>\optimierung\<zeit>-durchstich-<commit>
& $py -s -m terrainlab optimierung stand [<lauf>]                       # Stufen, Messungen, Verbrauch
& $py -s -m terrainlab optimierung stoppen <lauf>                       # legt die Datei STOP an; der Lauf hält vor der nächsten neuen Rechnung
& $py -s -m terrainlab optimierung fortsetzen <lauf>                    # macht dort weiter, wo es gestoppt hat (löscht STOP)
& $py -s -m terrainlab optimierung vorschlag <lauf>                     # Vorschläge ausgeben
& $py -s -m terrainlab optimierung nachmessen <vorschlag> --commit <C>  # Vorschläge an einem geänderten Generator neu messen, ohne neue Suche (Abschnitt 14)
& $py -s -m terrainlab bericht <lauf>                                   # HTML-Bericht (docs/bericht.md)
```

`starten` und `fortsetzen` nehmen `--zeit-s`, `--versuche` (Grenzen dieses Aufrufs), `--ohne-sperre` (die Sperre „nur ein schwerer Lauf“ aus `docs/lauf.md` nicht nehmen);
`starten` zusätzlich `--commit` (anderen Generator-Stand als das Profil), `--ausgabe`, `--nur-stufen`. Exit: 0 fertig, **10 gestoppt (fortsetzbar)**, 1 Fehler, 2 Eingabe, 5 Sperre, 6 Vorprüfung.
Wer den Lauf allein starten lässt, braucht danach nichts zu überwachen: Ergebnisort ist der Laufordner, der Stand steht in `stand.json` und im Befehl `stand`.
`nachmessen` nimmt eine Vorschlagsdatei (oder den Laufordner, dann die jüngste `vorschlag-*.json`), `--commit` (Pflicht), `--ausgabe` (vorhandener Ordner wird fortgesetzt), `--zeit-s`, `--versuche`, `--ohne-sperre`.

Der Adapterbefehl `scripts/dev/terrain-lab/grenzen.ts` (aufgerufen von `Adapter.grenzen`) gibt die Grenzen, Schritte, die Typen und die wirksamen Ausgangswerte je Typ als JSON aus. Er liest
`GEBIRGS_WERT_GRENZEN`, `GEBIRGS_MUSTER`, `GEBIRGSTYPEN` (`regler.ts`), `GEBIRGS_MODELL_GRENZEN` (`modell-werte.ts`), `RUECKENNETZ_TYPWERTE` und `typwert` (`rueckennetz/typwerte.ts`),
`typVorschlag` (`rueckennetz/typen.ts`) und die Presets der Fassung am Stand eines Commits. Ändert sich der Vertrag, ändert sich der Suchraum, ohne dass hier etwas nachzuziehen ist.

## 2 Grundsätze

- **Ein Stand.** Alles eines Laufs wird an **einem** Commit des Generators gerechnet (Profil `commit`, aufgelöst und im Lauf festgehalten). Ein halb veränderter Arbeitsbaum wird nie gemessen.
  `fortsetzen` rechnet am selben Commit weiter, auch wenn das Profil heute etwas anderes sagt: Das gespeicherte Profil gilt.
- **Rollen strikt getrennt.** Die Suche sieht nur Referenzausschnitte der Rolle `optimierung`; die Validierung nur `validierung`. Die Validierung **ordnet nie um**: Sie bestätigt oder verwirft
  (Abschnitt 6). Ein Ausschnitt wechselt die Rolle nie.
- **Kein Gesamtwert.** Drei Dimensionen, jede für sich; Kandidaten werden nach Pareto geordnet (Abschnitt 7).
- **Nie die Karte.** Nur Rechnen und Lesen. Presets werden nicht geschrieben; die Vorschlagsdatei hat die Form von „19 (Test)“ und ist für einen Menschen gedacht.
- **Deterministisch.** Seeds stehen im Profil (Sobol, Morris, Verfeinerung) und die Saaten der Generatorläufe ebenso. Zwei Läufe mit demselben Profil und Commit messen dasselbe.

## 3 Die drei Dimensionen

### 3.1 Geomorphologische Plausibilität (`bewertung/plausibilitaet.py`)

Das erzeugte Raster wird mit den Deskriptoren (`docs/deskriptoren.md`) gegen die realen Referenzausschnitte **desselben Typs im selben Maßstab** (187,5 / 375 / 750 m) verglichen
(`vergleiche`, Maßstabsprüfung). Je Kennzahl ein Abstand von 0 (gleich) bis 1:

- **Einzelwert:** `|a − b| / (|a| + |b| + Boden)`, der Boden je Einheit (`BODEN`) ist der Rauschboden (0,02 % gegen 0 % ist kein Maximalabstand).
- **Verteilung:** `W1 / (W1 + IQR_Referenz)` mit dem Wasserstein-Abstand `W1` in der Einheit der Metrik (0,5: um einen Interquartilsabstand der Referenz verschoben).
- **Getrennt nach Art** (`absolut`, `relativ`, `verteilung`, `raeumlich`, wie im Katalog): je Art Median, 90. Perzentil, Maximum, Zahl der Kennzahlen und die sechs schlechtesten Einzelkennzahlen.
- **Leitwert** zum Ordnen: Mittel der Art-Mediane der in `leitwert_arten` genannten Arten (Vorgabe: relativ, verteilung, raeumlich), Median über die Referenzfälle; der schlechteste Fall wird mitgemeldet.
  `absolut` hängt vom Reliefumfang ab und steht daneben, nicht darin. Ein Hang wird nie auf 0 bis 1 normiert: Neigungen sind Grad aus Metern.
- **Randband** (`rand_m`, Vorgabe 1500 m): Das erzeugte Gebirge läuft an seinem Umriss auf 0 aus; Zellen näher am Umriss bleiben ungewertet (die Referenz hat keinen solchen Rand).
- **Reliefangleichung** (`relief_angleichen`, Vorgabe an): Die Referenz wird senkrecht so gestreckt, dass ihr Relief der Kammhöhe des Gebirges gleicht (Faktor im Ergebnis). Formmaße
  vergleichen so Gebirge gleicher Höhe. Ohne sie bestimmt der Höhenunterschied zwischen dem Gebirge der Fixture und dem realen Ausschnitt fast alles.
- **Ausgeschlossen:** Gruppe `frequenz` (NoData- und kantenempfindlich bei Rastern mit großem Außenanteil) und Maße der Höhenlage und Flächengröße (`HOEHENLAGE`).
- **Referenzstreuung:** der Abstand der Optimierungs- zu den Validierungsausschnitten desselben Typs, also zweier **echter** Gebirge. Sie ist der Maßstab für „erreichbar“: Ein erzeugtes Gebirge
  muss der Referenz nicht näher kommen als echte Gebirge einander.

### 3.2 Redaktioneller Formerhalt (`bewertung/formerhalt.py`)

Gezeichnete Gipfel, Nebengipfel, Kämme und Täler der Gebirgsdatei (Fixture) gegen das Ergebnis, in Python nachgebaut nach `apps/server/test/support/gebirge-form.ts` und dem P1-Befund
(`project-control/discovery/wi-0249-formerhalt/`). Das Raster wird über `herkunft.grenzen_e` und `zellweite_e` (Endgelände: `fenster_e`) georeferenziert.

| Komponente (Anteil 0 bis 1) | Definition                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gipfel_exakt`              | die Zelle am gesetzten Gipfel trägt die gesetzte Höhe (Toleranz 1 m; ohne Höhe die Kammhöhe)                                                                                                                           |
| `gipfel_kopf`               | strikte Gipfelzelle (höher als alle 8 Nachbarn in der Fläche) mit mindestens 1 m Prominenz über den Schlüsselsattel im Umkreis von 0,5 E (`findeKopf`)                                                                 |
| `neben_exakt`, `neben_kopf` | dasselbe für Nebengipfel mit eigener Höhe; auf einem Fluss, auf einer Gipfelzelle oder überschrieben von einem späteren zählt ein Nebengipfel nicht (wie die Tore des Generators). Ohne eigene Höhe nur Kopf und Kuppe |
| `grat`                      | Kammrelief quer: Höhe auf der Kante minus Mittel der Höhen 1,5 E quer (alle 0,25 E, ohne Enden und Randauslauf), Median als Anteil der Höchsthöhe, bezogen auf den Mindestgrat `gratMin` des Typs (höchstens 1)        |
| `kammlage`                  | Abstand des höchsten Punkts im Querprofil (±1,5 E) von der gezeichneten Kante; bis 0,25 E (eine Zelle der groben Vorschau) gilt als genau, bei 0,75 E null                                                             |
| `fluss_faellt`, `tal_tief`  | Flüsse steigen in Fließrichtung nicht über 1 m; sie liegen im Mittel mehr als 1 m tiefer als ihre Umgebung 1 E quer                                                                                                    |
| `mulde_tief`                | gesetzte Mulden liegen tiefer als der Ring von 1,5 E                                                                                                                                                                   |

Zusätzlich gemeldet: Kuppe (Höhe minus Ringmittel) und Prominenz der Köpfe der Nebengipfel, Median des Grats je Kante, Lage der Kammachse in E. Die **Bewertung des Grats** nimmt `gratMin` der
**unveränderten Vorgabe** des Typs, nie den Wert des Kandidaten (sonst ließe sich das Soll weglassen).

**Formtor (harte Mindestbedingung).** Ein Kandidat gilt nur, wenn (a) jeder gesetzte Gipfel exakt steht (in jeder Saat) und (b) keine Komponente unter 80 % (`tor_faktor`) des Werts der **unveränderten
Vorgabe des Typs** am selben Maßstab und denselben Saaten fällt; fehlt eine Komponente, die die Vorgabe messen konnte, ist das Tor verfehlt. Wer das Tor verfehlt, steht in jeder Ordnung hinter allen, die es
halten, und wird nie vorgeschlagen. So kann ein statistisch glaubwürdiges Gebirge, das die gezeichneten Strukturen ignoriert, nie gut abschneiden (Beispiel: Strategie „ohne Kammnetz“, Abschnitt 8). Ergänzend schützt die
**Pareto-Dominanz** (Abschnitt 7): Ein Kandidat mit gleichem Abstand und schlechterer Form wird dominiert.

### 3.3 Technische Effizienz (`bewertung/effizienz.py`)

Wanduhr, CPU-Zeit, RSS-Spitze, Zellzahl, Fremdlast des kalten Laufs aus der `meta.json` des Adapters (`docs/lauf.md` Abschnitt 2.3). Auf einem geteilten Rechner schwankt die Zeit mit der Fremdlast; sie steht dabei.
Die Zeit dient als drittes Ziel der Pareto-Front und im Bericht (Qualitätsgewinn je Rechenzeit), nicht der Ordnung der Suche.

## 4 Der Parameterraum (`optimierung/raum.py`)

Je Typ 26 Parameter aus den Verträgen: die **zehn V12-Regler** (`v12.<wert>`), die **fünfzehn Typwerte des Rückennetzes** (`netz.<id>`) und das **Grundmuster** (`muster`: rauschen oder zellen). Ein Wert mit
`schritt` 1 ist ganzzahlig (so prüft ihn `mitTest`), alle anderen stetig auf dem Raster ihres Schritts. Die Kammhöhe wird **nicht** verstellt (sie gehört dem Gebirge). Jeder Parameter wird auf `[0, 1]` abgebildet.

Ein **Kandidat besteht nur aus Abweichungen** von der Vorgabe des Typs. Er wird als Überlagerung „19 (Test)“ (`rezept.ueberlagerung.presets.typen.<typ>.{werte, rueckennetz, muster}`) in den Auftrag an den Adapter
gelegt, mit `reglerQuelle: "preset"`; der Auftrag ist damit derselbe, den ein Mensch im Reiter „Umgebungen“ setzen würde. Wer nichts ändert, **ist** die Vorgabe und teilt ihre Rechnung und den Zwischenspeicher.
Fehlt der Fassung die Preset-Gruppe (bis Fassung 18), bricht der Lauf mit dieser Meldung ab: Presets gibt es erst in der offenen Fassung 19.

## 5 Stufen

Je Typ, jede Stufe merkt sich ihr Ergebnis (`phase`), alle Messungen stehen einzeln in der Datenbank.

1. **`basis`**: Vorgabe des Typs bei 1× über alle Saaten (Bezug des Formtors); die Referenzstreuung.
2. **`sensitivitaet`** (Morris, `optimierung/sensitivitaet.py`): `trajektorien` zufällige Gitterläufe, in jedem ändert sich jeder Parameter einmal um zwei Drittel seines Bereichs (`ebenen` 4). Je Parameter und Ausgabe
   (Abstand, Formverlust, Zeit): μ* (Betrag), μ (Richtung), σ (Wechselwirkung). Jede Trajektorie rechnet mit einer festen Saat, reihum; in einer Trajektorie ist die Rechnung deterministisch, ein wirkungsloser Parameter hat
   also einen elementaren Effekt von **exakt 0**. Weil ein Parameter nur in bestimmten Kombinationen wirken kann (die Bergform nur, wo die Kammschärfe über null liegt, und wenige Trajektorien können zufällig alle in der
   unwirksamen Kombination liegen), wird jeder Parameter mit Effekt 0 **an der Vorgabe des Typs** an beiden Enden seines Bereichs noch einmal gerechnet („Bestätigung“): „wirkungslos“ heißt null in jedem Schritt **und**
   an der Vorgabe; wirkt er dort, ist er „bedingt wirksam“ und wird mit dieser Wirkung eingeordnet. „Schwach“: beide Wirkungen unter `schwelle` (5 %) des größten Werts. Höchstens `max_aktiv` Parameter bleiben im
   Suchraum. Der Bericht stellt den Befund der Reglerstudie WI-0249 P4 daneben.
3. **`suche`** (`optimierung/suche.py`): verwürfelte **Sobol**-Folge im Raum der wirksamen Parameter (`kandidaten`, dazu die Vorgabe), **Successive Halving** mit Faktor `eta`: Runde 1 alle mit der ersten Saat, danach das beste
   Drittel mit einer weiteren Saat usw. bis alle `saaten` der Suche; wer das Formtor verfehlt, scheidet zuerst aus. Ausgesondert wird vorzeitig, ohne dass etwas verloren geht (alles steht in der Datenbank).
4. **`verfeinerung`**: (1 + λ)-Evolutionsstrategie um den Besten (`runden`, `nachkommen`, Schritt `schritt`, halbiert je Runde, Wahlparameter kippen selten); ein Nachkomme ersetzt ihn nur, wenn er das Formtor hält und den
   Abstand um mehr als das Messrauschen (0,002) senkt.
5. **`validierung`**: Abschnitt 6.
6. **`strategie`**: Abschnitt 8.
7. **`endgelaende`**: nur mit `endgelaende.aktiv` im Profil **und** einem Schnappschuss der Eingaben (`docs/lauf.md` 2.2); höchstens `beste` bestätigte Kandidaten und die Vorgabe, mit einer Saat, gegen beide Referenzrollen.
   Das lokale Endgelände rechnet die ganze grobe Stufe (mehrere Minuten, mehrere GB); die Stufe nimmt es nur ausdrücklich. Das Ergebnis ist eine Messung, keine Entscheidung. Im Durchstich nicht gerechnet.
8. **`vorschlag`**: Abschnitt 9.

## 6 Validierung

Die besten `beste` Kandidaten der Suche (in der Reihenfolge der Suche, ohne die Vorgabe selbst) werden bei 2× (und der erste bei 4×, `vier_x_fuer`, im Durchstich alle drei) neu gerechnet und gegen die Referenzausschnitte der Rolle
`validierung` gemessen, dazu gegen die der Optimierung, und die **Vorgabe im selben Maßstab** daneben. Ein Kandidat ist **bestätigt**, wenn sein Abstand zur Validierungsreferenz an **jeder** validierten Auflösung um
mindestens `gewinn_min` (relativ) unter dem der Vorgabe liegt **und** er an jeder das Formtor hält. Der **Vorschlag** ist der erste bestätigte Kandidat in der Reihenfolge der Suche. Bestätigt keiner, bleibt die Vorgabe
(„Überanpassung an die Optimierungsreferenz“).

## 7 Ordnung und Pareto

Wer das Formtor hält, steht vor allen anderen; darunter zählt der **Pareto-Rang** über (Abstand, Formverlust) mit der Toleranz des Messrauschens (0,002 und 0,01), dann der Abstand. `bewertung/pareto.py` kennt auch die
dritte Achse Zeit. Der Bericht zeigt alle Kandidaten bei 1× (Abstand gegen Formverlust, Farbe = Rechenzeit) und die Front der zulässigen.

## 8 Strategievergleich

Je Typ vier Strategien, soweit der Generator sie heute erlaubt: **gezeichnete Kämme** (Rückennetz) oder **ohne Kammnetz** (die V12-Kette ohne Kämme und Nebengipfel; die Gebirgsdatei wird ohne diese Teile in den Laufordner
geschrieben), je mit Grundmuster **rauschen** oder **zellen**. Je Strategie eine kleine Sobol-Suche (`strategien.kandidaten`, die Vorgabe des Typs mit festem Muster als erster Kandidat) über die Parameter, die dort wirken (ohne Kammnetz nur die V12-Regler); die beiden Strategien mit
gezeichneten Kämmen nehmen zusätzlich **alle Kandidaten der Hauptsuche** mit ihrem Muster auf (bei der ersten Saat, aus der Datenbank), denn die Hauptsuche verstellt das Muster mit, und der Vergleich darf ihr nicht widersprechen. Die Formmaße werden **immer**
gegen die gezeichnete Form gemessen: Eine Strategie ohne Kammnetz ist statistisch vielleicht glaubwürdig, verfehlt aber das Formtor und wird nie empfohlen. Ergebnis: **„empfohlene Strategie“** (kleinster Abstand unter den
zulässigen) oder **„mit dem Modell nicht erreichbar“**, wenn dieser Abstand mehr als `erreichbar_faktor` (2) mal die Referenzstreuung beträgt oder keine Strategie das Formtor hält.

## 9 Fortsetzen, Grenzen, Speicher

- **Datenbank** `<lauf>\lauf.sqlite` (SQLite, WAL): `kandidat` (Abweichungen, Herkunft), `messung` (je Kandidat, Auflösung, Saat, Rolle: Commit, Auftrag als JSON, Fingerabdruck, Messwerte der drei Dimensionen, Status, aus dem
  Zwischenspeicher?), `phase` (Ergebnis je Stufe), `ereignis`, `meta` (Profil, Commit, Grenzen des Generators, Status). Dazu `protokoll.jsonl` (eine Zeile je neue Messung), `stand.json`, `profil.json`, `gebirge\` (die
  gezeichnete Form und die Variante ohne Kamm).
- **Cache** (aus `terrainlab.lauf`): Das Raster eines Auftrags an einem Commit liegt unter `<Labor>\cache\raster\<commit>\<auftrag>`; identische Rechnungen (andere Rolle, späterer Lauf, Bericht) kosten nichts.
- **Fortsetzen:** `fortsetzen` plant dieselben Messungen noch einmal und überspringt die gespeicherten; fertige Stufen werden nicht angefasst. Das Ergebnis eines unterbrochenen und fortgesetzten Laufs ist
  **dasselbe** wie das eines durchgelaufenen (getestet: gleiche Zahl Rechnungen, gleiche Vorschlagsdatei).
- **Grenzen** (`grenzen` im Profil, je Aufruf): `zeit_s`, `versuche` (neue Rechnungen), `cpu_s` (Python plus Adapter), `ram_min_mib` (vor jeder neuen Rechnung; 4× braucht 1200 MiB frei, Endgelände 6000), `ram_warten_s`. Eine Grenze oder die
  Datei `STOP` im Laufordner hält den Lauf **vor der nächsten neuen Rechnung** an, nie mittendrin.
- **Ein schwerer Lauf gleichzeitig:** Die Sperre `<Labor>\laeufe\.lauf.sperre` aus `docs/lauf.md`; die Optimierung rechnet sequentiell, ein Generatorprozess zugleich.
- **Kosten** (Rechner mit 24 logischen Prozessoren, Vorschau 1×): eine Rechnung der Blutzinnen rund 2 s (davon 1,5 s Start des Adapters), der Trollzacken rund 4 bis 7 s. Der Start des Adapters ist der größte Teil; ein Stapelbetrieb
  (viele Aufträge in einem Prozess) würde die Läufe etwa halbieren und ist als Verbesserung vorgemerkt (Abschnitt 11).

## 10 Die Vorschlagsdatei

`<lauf>\vorschlag-<profil>-<commit12>.json`, Format `avesmaps-terrainlab-vorschlag` Version 1: Kopf (Lauf, Profil, Commit, Fassung, Saaten, Einstellungen), `hinweis` („keine Fassung“), `nach_wi_0249` und je Typ:

- `status` (`bestaetigt` oder `vorgabe_bleibt`), `begruendung` (Zahlen vorher/nachher, bestätigt als Platz n), `kennzahlen` je Auflösung,
- `werte` (nur Abweichungen, gruppiert `v12`, `netz`, `muster`) mit `vorgabe` daneben, und `ueberlagerung` (die Form von „19 (Test)“: `presets.typen.<typ>`),
- `strategie` (Empfehlung, Urteil, Referenzstreuung, `vorbehalt`: Die Empfehlung gilt bei 1× mit einer Saat; wo der Vorschlag ihr widerspricht oder keiner bestätigt wurde, steht es dort), `sensitivitaet` (Suchraum,
  wirkungslose und bedingt wirksame Parameter), `modellgrenzen` (Kennzahlen, die in fast jedem Kandidaten unter den am weitesten entfernten bleiben, und bekannte Grenzen des Typs),
- `am_rand` (Werte im äußersten Zwanzigstel ihres Bereichs: Wer am Rand sucht, nutzt oft eine Schwäche der Kennzahlen aus; ein Mensch soll hinsehen) und bei `vorgabe_bleibt` `beste_unbestaetigt` (der beste Kandidat der Suche
  mit dem, woran er scheiterte: zum Ansehen, **nicht** zum Übernehmen).

## 11 Grenzen dieses Verfahrens

- **Gebirge der Fixture.** Das erzeugte Gebirge hat den Umriss und die Kämme der Fixture (zum Beispiel ein schmales Band mit 74 % NoData in seinem Rechteck), die Referenz ist ein Rechteck; Maße, die von der Fläche
  abhängen, sind daher ausgenommen oder nur über Dichten und Anteile in der Wertung (Randband, Ausschluss). Ein Typ wird an **einem** Gebirge kalibriert; dass der Vorschlag für ein anderes Gebirge desselben Typs trägt,
  prüft nur die Validierung an einem anderen **realen** Ausschnitt, nicht an einem anderen gezeichneten Gebirge.
- **Referenzen sind Näherungen des Typs** (`docs/referenzkorpus.md`): Die Zuordnung ist fachlich, Mischformen sind die Regel. Bei Karst ist der Optimierungsausschnitt (Kentucky, 170 m Relief) kaum ein Gebirge; das Ergebnis dort ist
  entsprechend zu lesen. Dolinen liegen unter der Zellgröße von 187,5 m.
- **Nur Vorschau.** Die Suche misst die Vorschau 1×, die Validierung 2× und 4× (Talboden des Typs). Das Endgelände (Erosion der ganzen Karte) ist nicht Teil der Suche; Wirkungen, die erst dort entstehen (WI-0249),
  sieht die Suche nicht.
- **Rauschen der Sensitivität.** Wenige Trajektorien (Vorgabe 3) ordnen die Parameter grob; die Klasse „wirkungslos“ (exakt null in jedem Schritt) ist belastbarer als der Rang unter den wirksamen.
- **Stapelbetrieb** (viele Aufträge in einem Prozess des Adapters) und eine Gradientenverfeinerung stehen nicht an; die Verbesserungen wären Zeit, nicht Ergebnis.

## 12 Durchstich (2026-10-23)

Kettengebirge (Fixture Blutzinnen) und Karst (Trollzacken), Profil `durchstich`, Generator-Stand `f1586257d` (Fassung 19), Vorschau mit Talboden des Typs, Saaten Fixture, 4711, 9173. Suche bei 1× gegen
`kettengebirge-ch-bern` und `karst-us-kentucky`, Validierung bei 2× und 4× gegen `kettengebirge-ch-glarus` und `karst-us-guadalupe`. **Bericht:** `C:\avesmaps3d-data\terrain-lab\berichte\2026-10-23-durchstich.html`;
**Vorschlagsdatei:** `tools/terrain-lab/vorschlaege/2026-10-23-durchstich-f1586257ddb1.json` (Kopie aus `<Labor>\optimierung\2026-10-23-durchstich\`).

**Aufwand.** 545 Messungen (Kandidat × Auflösung × Saat × Rolle) an 521 verschiedenen Rechnungen des Generators; ein Lauf von Grund auf dauert rund 30 bis 35 Minuten auf dem Rechner mit 24 logischen Prozessoren (eine Rechnung
nach der anderen: 16 Minuten Generator, dazu je Rechnung 1,6 s Start des Adapters und die Messung der drei Dimensionen). Der Durchstich entstand in mehreren Läufen, die auf demselben Zwischenspeicher aufbauten, weil Formtor (Toleranz der Kammlage), Strategievergleich,
Validierung bei 4× für alle drei Kandidaten und die Bestätigung wirkungsloser Parameter während der Arbeit nachgezogen wurden (Abschnitt 13); der maßgebliche Lauf rechnete 187 neue Generatorläufe in 653 s.

|                                               | Kettengebirge (Blutzinnen)                                                               | Karst (Trollzacken)                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Referenzstreuung (zwei echte Gebirge, 1×)     | 0,081                                                                                    | 0,271 (Kentucky mit 170 m Relief, auf 3200 m gestreckt: Faktor 18,8)               |
| Abstand der Vorgabe, 1× Optimierung           | 0,201                                                                                    | 0,166                                                                              |
| Abstand des Vorschlags, 1×                    | **0,105** (−48 %)                                                                        | **0,155** (−7 %)                                                                   |
| Validierung 2×: Vorgabe → Vorschlag           | 0,189 → 0,107 (−43 %)                                                                    | 0,231 → 0,202 (−13 %)                                                              |
| Validierung 4×: Vorgabe → Vorschlag           | 0,176 → 0,113 (−36 %)                                                                    | 0,217 → 0,199 (−8 %)                                                               |
| Formerhalt (Leitwert) 1×: Vorgabe → Vorschlag | 0,82 → 0,90                                                                              | 0,98 → 1,00                                                                        |
| Formtor bei 1×, 2×, 4×                        | gehalten                                                                                 | gehalten                                                                           |
| Ergebnis                                      | Vorschlag bestätigt (Platz 1 der Suche)                                                  | Vorschlag bestätigt (Platz 1), kleiner Gewinn                                      |
| Strategie                                     | empfohlen: gezeichnete Kämme, rauschen (0,105, unter dem Doppelten der Referenzstreuung) | empfohlen: gezeichnete Kämme, zellen (0,153); „rauschen“ (0,157) liegt im Rauschen |
| Suchraum nach der Sensitivität                | 12 von 26                                                                                | 12 von 26                                                                          |

**Vorschlag Kettengebirge** (zehn Werte, Muster unverändert): Bergform 2,5 → 4,4, Erosion 5 → 1, Körnung 9 → 86,1, Rauschen 0,5 → 0,47, Talbreite 1,1 → 1,0; Rückenbreite 1,2 → 1,4, Erhalt 0,5 → 0,9, Grat 0,18 → 0,24,
Gratbreite 0,45 → 0,5, Talboden 0,2 → 0,6. **Vorschlag Karst** (zehn Werte, Muster unverändert): Einschnitt 1925 → 1875, Erosion 4 → 5, Körnung 18 → 28,5, Rauschen 0,94 → 1, Talbreite 3,8 → 4,2; Rückenbreite 1,4 → 0,65, Grat 0,12 → 0,06,
Gratbreite 0,45 → 0,15, Randbreite 2 → 1,5, Talboden 0,65 → 0,56. Beim Karst liegen drei Werte am Rand ihres Bereichs (Erosion 5, Rauschen 1, Gratbreite 0,15), der Gewinn ist klein: ein Vorschlag zum Ansehen, nicht zum Übernehmen ohne Blick auf die Bilder.

**Sensitivität** (Morris, drei Trajektorien, Saaten reihum; beide Typen gleich): **wirkungslos** (exakt null in jedem Schritt und an der Vorgabe) sind `netz.band.ziel`, `netz.gratMin`, `v12.hypsometrie` (in der groben Vorschau mit Talboden des Typs nicht
gelesen) und die vier Typwerte, die ein V12-Preset übersteuert (`netz.form.schaerfe`, `.rauschen`, `.koernung`, `.erosion`): **die Liste des P4-Befunds** (bis auf `struktur.welle`: dort schwach statt null). `v12.bergform` ist **nur bedingt wirksam**: In den drei Trajektorien lag die
Kammschärfe (`plateau`) jedes Mal bei 0, dann hat die Bergform keine Wirkung; an der Vorgabe wirkt sie. Der erste Durchstich hatte sie deshalb fälschlich als wirkungslos geführt; die Bestätigung an der Vorgabe (Abschnitt 5) behebt das.
Am stärksten wirken in beiden Typen `netz.form.talboden`, `muster`, `v12.rauschen`, `v12.koernung` und `netz.form.breite`. Abweichungen zum P4-Befund (zwei Klassen Unterschied, ein Gespräch, kein Fehler einer der Seiten): `v12.rauschen`, `v12.koernung`
und `netz.form.gratBreite` wirken hier stark, P4 maß sie schwach (andere Messgröße: Wirkung auf den Abstand zur Referenz im ganzen Suchraum samt Wechselwirkung mit dem Muster statt Höhenänderung in Prozent der Kammhöhe an den Vorgaben).

**Erkannte Modellgrenzen.** (1) **Senken**: Die Referenzen haben geschlossene Senken (Berner Alpen 49, Kentucky 150, mit 10 % der Zellen), das Modell füllt alle Senken: `hydro_senken_*` steht in 88 bis 100 % aller
Messungen unter den am weitesten entfernten Kennzahlen, mit keinem Parameter erreichbar. Beim Karst sind das die Dolinen (unter der Zellgröße von 187,5 m). (2) **Karst-Referenz**: Der Optimierungsausschnitt (Kentucky) ist eine Dolinenebene mit 170 m Relief; auf die Kammhöhe der
Trollzacken gestreckt (Faktor 18,8) ist er kaum ein Gebirge. Der Gewinn von 7 % beim Karst ist daher gering und nur durch die Validierung (Guadalupe) gestützt; die Referenzstreuung von 0,27 zeigt, wie verschieden zwei „Karste“ des Korpus sind. (3) **Ohne Kammnetz** erreicht
kein Kandidat das Formtor (Formverlust 0,6 und mehr); die V12-Kette formt die Kämme nicht dorthin, wo sie gezeichnet sind. (4) **Wechselwirkung des Talbodens**: Ein `netz.form.talboden` über 0,7 hebt Nebengipfel ohne eigene Höhe über die 80 % der Kammhöhe (`nebengipfelVorgabe`: mindestens Talboden + 0,1; bei 0,95 auf die ganze Kammhöhe). Frühe Kandidaten mit 0,92 bis 0,95 taten das; der Vorschlag mit 0,6 nicht. Der Formerhalt sieht es nicht (die Höhe ist dort frei).

**Nach WI-0249 neu zu messen** (der Generator ändert sich gerade, Einbettung, Erosion und Formerhalt in P2): (a) alle Vorschläge dieser Datei, denn sie gelten nur für `f1586257d` (am Stand von P2 nachgemessen: Abschnitt 14); (b) `v12.erosion`, `netz.form.erosion`, `netz.form.erhalt` und `v12.plateau`/`netz.form.schaerfe`,
deren Wirkung P2 verschiebt (die Erosion ist die Stufe, die den Formerhalt verliert); (c) die Talbodenableitung (`v12.hypsometrie`, `netz.band.ziel`, `netz.gratMin`): in der Vorschau mit Talboden des Typs wirkungslos, im Gelände entscheidend;
das Profil `vorschau.talboden: "ableiten"` misst sie, kostet beim Karst rund das Dreifache; (d) das Formtor und seine Vorgabewerte (der Anteil der Köpfe, die Lage der Kämme verbessern sich mit P2 von selbst); (e) die Entscheidung, ob bei Schärfe, Rauschen, Erosion und Körnung der Typwert
des Rückennetzes oder das V12-Preset gilt (P4 8.3): bis dahin sind vier der fünfzehn Typwerte wirkungslos und kein Gegenstand einer Kalibrierung; (f) die Endgelände-Stufe (`endgelaende.aktiv`, Schnappschuss nötig), die erst die Erosion der ganzen Karte sieht.

## 13 Fallen, die der Durchstich aufdeckte

- **Formtor und Auflösung.** Die Lage der Kammachse als Abweichung in Zellen bestrafte feinere Auflösungen (dieselbe Form wirkte bei 4× „daneben“): Die Toleranz ist jetzt eine feste Länge (0,25 E, die Zelle der groben Vorschau).
- **Wenige Trajektorien, bedingte Wirkung.** Siehe Sensitivität: „exakt 0“ in drei Trajektorien beweist nichts über einen Parameter, der nur in bestimmten Kombinationen wirkt. Darum die Bestätigung an der Vorgabe.
- **Strategievergleich gegen Hauptsuche.** Eine kleine Suche je Strategie widersprach der großen Hauptsuche (die das Muster mitverstellt). Der Vergleich nimmt jetzt alle Kandidaten der Hauptsuche mit auf.
- **Validierung bei 4× nur für den Ersten.** Ein Kandidat auf Platz 3 wurde ohne 4× bestätigt und scheiterte dort. Im Durchstich gilt 4× für alle drei (`vier_x_fuer` des Profils).
- **Ältere Ergebnisdateien.** Die Vergleichsdateien früherer Läufe tragen nicht alle Schlüssel der heutigen (`geaendert`): Der Bericht liest sie trotzdem (getestet).

## 14 Nachmessung nach WI-0249 P2 (2026-10-23)

`optimierung nachmessen <vorschlagsdatei> --commit <C>` beantwortet, ob ein Vorschlag einen geänderten Generator überlebt, **ohne neue Suche**: Die ausdrücklichen Werte des Vorschlags (seine Überlagerung „19 (Test)“, `kandidat`) werden über die
Vorgabe des **neuen** Standes gelegt und mit den Einstellungen des ursprünglichen Laufs gemessen (Saaten, Vorschau, Bewertung, Formtor 80 % der Vorgabe). Gemessen werden die Vorgabe des neuen Standes bei 1× (Bezug von Abstand und Formtor), der Kandidat bei 1× und
die Validierung bei 2× (zwei Saaten) und 4× (eine Saat) gegen die Validierungsausschnitte, mit dem Mindestgewinn von 2 %. Werte, die der neue Stand nicht mehr kennt oder die außerhalb seiner Grenzen liegen, fallen weg und werden genannt. Ergebnis: `nachmessung.json` im Ordner
der Nachmessung, die Tabelle auf der Konsole und mit `bericht --nachmessung` ein Abschnitt „Nachmessung am neuen Generator-Stand“. Ein abgebrochener Aufruf lässt sich mit demselben `--ausgabe` fortsetzen; Grenzen wie bei `starten`.

**Durchstich-Vorschläge von `f1586257d` am Stand `83c781853` (WI-0249 P2)**, Laufordner `<Labor>\optimierung\2026-10-23-nachmessung-p2`, 24 Generatorläufe (36 Messungen) in rund 5 Minuten; Zahlen „damals → jetzt“:

|                                              | Kettengebirge (Blutzinnen)                          | Karst (Trollzacken)                              |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Vorgabe 1×: Abstand zur Referenz             | 0,201 → **0,183**                                   | 0,166 → 0,160                                    |
| Vorgabe 1×: Formverlust                      | 0,177 → **0,000**                                   | 0,024 → **0,000**                                |
| Formkomponenten der Vorgabe                  | `gipfel_kopf` 0,00 → 1,00; `neben_kopf` 0,76 → 1,00 | `neben_kopf` 0,83 → 1,00                         |
| Vorschlag 1×: Abstand                        | 0,105 → 0,111                                       | 0,155 → **0,168** (über der neuen Vorgabe 0,160) |
| Vorschlag 1×: Formverlust, Formtor           | 0,095 → 0,000, gehalten                             | 0,000 → 0,000, gehalten                          |
| Validierung 2×: Vorgabe → Vorschlag (Gewinn) | 0,189 → 0,162 / 0,107 → 0,096 (43 % → 41 %)         | 0,231 → 0,230 / 0,202 → 0,204 (13 % → 11 %)      |
| Validierung 4×: Vorgabe → Vorschlag (Gewinn) | 0,176 → 0,164 / 0,113 → 0,105 (36 % → 36 %)         | 0,217 → 0,236 / 0,199 → 0,198 (8 % → 16 %)       |
| Urteil am neuen Stand                        | **bestätigt**                                       | bestätigt, **aber dünn**                         |

**Lesart.** (1) P2 wirkt, wie WI-0249 es verspricht: Der Formverlust der Vorgabe verschwindet (die Köpfe der Gipfel und Nebengipfel bleiben erhalten), und der Abstand zur Referenz sinkt bei der Vorgabe leicht, ohne dass ein Wert verstellt wurde. (2) Der **Vorschlag für das
Kettengebirge trägt**: 41 % Gewinn bei 2× und 36 % bei 4× gegen die Validierungsausschnitte, Formtor gehalten, bei 1× 39 % statt 48 %. Er bleibt ein brauchbarer Ausgangspunkt für eine Überlagerung auf der Stage; vor einer Übernahme in eine Fassung gehören die Bilder des Berichts dazu. (3) Der
**Vorschlag für den Karst trägt nicht mehr überzeugend**: Bei 1× gegen die Optimierungsausschnitte (Kentucky) liegt er über der neuen Vorgabe, sein Gewinn bei 2× und 4× ist klein (11 % und 16 %, der Vorteil beruht auf Guadalupe). Das passt zur Modellgrenze 2 aus Abschnitt 12 (die Karst-Referenz ist
eine Dolinenebene): Er ist nicht zu übernehmen; neu zu suchen ist sinnvoll, sobald der Korpus einen Karst mit Gebirgsrelief als Optimierungsausschnitt hat. (4) Nicht erneut gemessen sind die Sensitivität, der Strategievergleich und das Endgelände. Der Suchraum des neuen Standes hat 28 statt 26 Parameter je
Typ (`netz.form.kopf`, `netz.form.kammMuster`, beide aus P2; `grenzen.ts` liefert sie ohne Änderung am Lab): Sie fehlen im Vorschlag und gelten deshalb mit ihrer Vorgabe. Eine neue Suche am neuen Stand ist der nächste Schritt (`optimierung starten durchstich --commit <C>`, rund 35 Minuten) und sagt, ob die beiden Werte
und die übrigen Kalibrierungen aus Abschnitt 12 („nach WI-0249 neu zu messen“) etwas bringen.
