# Bericht (WI-0250, Phase A5)

`python -m terrainlab bericht <lauf|vergleich|messung>` schreibt **eine** statische HTML-Datei: Bilder eingebettet (PNG als Daten-URI), kein Server, kein Framework, kein
JavaScript. Die Datei lässt sich weitergeben, archivieren und ohne das Lab öffnen. Code: `tools/terrain-lab/terrainlab/bericht/`, Tests:
`tools/terrain-lab/tests/test_bericht.py`.

## 1 Aufruf

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"
# Bericht zu einem Optimierungslauf (Laufordner mit lauf.sqlite); Ziel: <Labor>\berichte\<lauf>.html
& $py -s -m terrainlab bericht C:\avesmaps3d-data\terrain-lab\optimierung\<lauf>
# mit einer Performance-Messung (Phasen, Streuung, Fremdlast) und einem Commit-Vergleich
& $py -s -m terrainlab bericht <lauf> --perf C:\avesmaps3d-data\terrain-lab\laeufe\perf\basis-2026-10-23 --vergleich C:\avesmaps3d-data\terrain-lab\laeufe\vergleich\<vergleich>
# mit einer Nachmessung der Vorschläge an einem geänderten Generator (optimierung nachmessen, docs/optimierung.md Abschnitt 14)
& $py -s -m terrainlab bericht <lauf> --nachmessung C:\avesmaps3d-data\terrain-lab\optimierung\<nachmessung>
# nur eine Messung, ein Vergleich oder eine Nachmessung (ohne Optimierung)
& $py -s -m terrainlab bericht C:\avesmaps3d-data\terrain-lab\laeufe\vergleich\<vergleich>
```

Die Art der Eingabe wird erkannt (`nachmessung.json`: Nachmessung; `lauf.sqlite`: Optimierung; `ergebnis.json` mit `format` perf oder qualitaet; `vergleich.json`). Optionen: `--ausgabe DATEI`, `--perf ORDNER`
(mehrfach), `--vergleich ORDNER` (mehrfach), `--nachmessung ORDNER` (mehrfach), `--cache ORDNER` (Zwischenspeicher der Läufe mit den Rastern, Vorgabe `<Labor>\cache`), `--titel TEXT`.

Der Bericht rechnet nichts am Generator: Er liest die Datenbank des Laufs und holt die Raster der gezeigten Kandidaten aus dem Zwischenspeicher der Läufe (Schlüssel: Commit und
Auftrags-Fingerabdruck stehen in der Datenbank). Fehlt etwas (Zwischenspeicher aufgeräumt, Referenzkorpus nicht lokal), steht das im Text des Abschnitts, und der Rest der Seite
entsteht trotzdem. Neu berechnet werden nur die Schummerung, die Kennlinien der Deskriptoren an den gespeicherten Rastern und die Formmaße der gezeigten Kandidaten (Sekunden).

## 2 Abschnitte

| Abschnitt                            | Inhalt                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zusammenfassung                      | Lauf, Commit, Profil, Verbrauch; je Typ: Ergebnis (Vorschlag bestätigt oder Vorgabe bleibt), Abstand und Formverlust vorher/nachher getrennt, Strategie; Begründungen; der Hinweis, dass alles nur für diesen Generator-Stand gilt                                     |
| Qualität je Typ                      | **Drei Dimensionen getrennt**: (1) Plausibilität (Leitwert und die vier Arten absolut/relativ/verteilungsbasiert/räumlich, je Maßstab und Referenzrolle; die Referenzstreuung zweier echter Gebirge als Maßstab), (2) Formerhalt (Komponenten, Formtor), (3) Effizienz |
| Formerhalt im Einzelnen              | Je Nebengipfel Höhe, Kopf, Prominenz (Vorgabe und Kandidat); Kammrelief quer, Lage der Kammachse, Täler                                                                                                                                                                |
| Referenzmetriken                     | Quantilfunktionen ausgewählter Verteilungen (Referenz, Vorgabe, Kandidat), die am weitesten entfernten Einzelkennzahlen (Ausreißer), je Referenzfall der Leitwert mit Streckungsfaktor                                                                                 |
| Performance                          | 1×/2×/4× (kalte Zeit, RSS, Zellen), Qualitätsgewinn je Rechenzeit, Aufwand der Suche; mit `--perf` die Messung des Labors samt Phasenanteilen, Streuung und Fremdlast                                                                                                  |
| Regressionen zwischen zwei Commits   | mit `--vergleich`: je Fall gleich/verschieden, Urteile, die auffälligsten Regressionen und Verbesserungen; ohne Maßstab (`ziele`, Referenz) ausdrücklich unbewertet                                                                                                    |
| Nachmessung am neuen Generator-Stand | mit `--nachmessung`: je Typ Vorgabe und Vorschlag **damals gegen jetzt** (Abstand, Formverlust, Formtor bei 1×; Validierung bei 2× und 4×; Formkomponenten einzeln), welche Werte am neuen Stand wegfielen, und das Urteil „besteht weiter“ oder „neu suchen“          |
| Bildvergleich                        | Schummerung aus den echten Höhen: Referenz, Vorgabe, Kandidat (1×, 2×, 4× mit der Referenz derselben Zellweite) und die Validierungsreferenz; Endgelände nur, wenn gerechnet                                                                                           |
| Profile                              | Kammprofil entlang der längsten Hauptkante mit den gesetzten Höhen, Querschnitt, mittlere Querprofile von Kamm und Tal (Reihen der Deskriptoren), Verteilung der Gipfelprominenzen                                                                                     |
| Parameteranalyse                     | Sensitivität (Diagramm, Tabelle mit dem P4-Befund daneben), die Besten, Wertebereiche der Besten, Pareto-Diagramm aller Kandidaten, Validierungsergebnisse, Strategievergleich, Modellgrenzen, Kalibrierungen „nach WI-0249“                                           |
| Anhang                               | Profil, Einstellungen der Plausibilität, Ereignisse des Laufs                                                                                                                                                                                                          |

## 3 Bilder

Alle Bilder entstehen aus den echten Höhenrastern; nichts wird erzeugt oder gemalt.

- **Schummerung** (`grafik.schummerung`): Hillshade von Matplotlib (`LightSource`, Licht aus Nordwest, 45° Höhe, Überhöhung 2×) aus den Höhen in Metern und der Zellweite in
  Metern, **ohne** Streckung der Höhen. Fester Kontrast, **200 m je Bildpunkt** (Raster werden dafür bilinear umgerechnet), ein roter Balken von 10 km, NoData weiß. Referenz,
  Vorgabe und Kandidat haben so denselben Maßstab und dieselbe Beleuchtung und stehen in einer Zeile nebeneinander (die Zeile scrollt, die Bilder werden nie verkleinert).
- Die Referenz im Bild ist der reale Ausschnitt in der Zellweite des Maßstabs der Zeile (750, 375 oder 187,5 m); die Wertung streckt die Referenz senkrecht auf das Relief des
  Gebirges (`relief_angleichen`), das Bild nicht.
- **Diagramme** (Matplotlib, PNG): Sensitivität (μ* mit σ), Pareto (Abstand gegen Formverlust, Größe der Marke = Zahl der Saaten, Farbe = Rechenzeit, grau = Formtor verfehlt),
  Quantilfunktionen, Querprofile, Höhenprofile, Rechenzeit (logarithmisch), Phasenanteile.

## 4 Grenzen

- Der Bericht deutet nicht, was keinen Maßstab hat: Ein Commit-Vergleich ohne `ziele` und ohne Referenzraster ist `unbewertet`, und der Bericht sagt es.
- Der **Kandidat** neben der Vorgabe ist der bestätigte Vorschlag; gibt es keinen, der beste Kandidat der Suche mit dem Vermerk „nicht bestätigt“ (und, wenn er das Formtor verfehlt, mit
  diesem Vermerk). Er ist dann kein Vorschlag.
- Die Zahlen gelten für den Generator-Stand im Kopf. Nach Änderungen am Generator (WI-0249) ist neu zu messen; die Seite sagt es im Abschnitt „Zusammenfassung“ und in der Parameteranalyse.
- Die Dateigröße liegt bei einigen MiB (Bilder als PNG, base64); für sehr große Gebirge bei 4× (mehr als 1000 × 800 Zellen) wachsen die Schummerungen entsprechend.
