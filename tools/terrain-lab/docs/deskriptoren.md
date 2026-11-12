# Gelände-Deskriptoren (WI-0250, Phase A2)

Wiederverwendbare Qualitätsmetriken für Höhenraster. Sie messen, wie ein Gelände aussieht (Höhenverteilung, Hänge, Gipfel und Kämme,
Entwässerung, Skalenverhalten), und bilden die Grundlage für den späteren Vergleich real gegen generiert, für den Optimierer und für den
Bericht des Terrain-Labs. Code: `tools/terrain-lab/terrainlab/deskriptoren/`, Tests: `tools/terrain-lab/tests/test_deskriptoren*.py`.

Das Ergebnis ist **kein Gesamtwert**, sondern ein nachvollziehbarer Metrikvektor: jede Metrik hat Name, Wert, Einheit, Gruppe, Art und
Kostenklasse. Dazu kommen Verteilungen (als Quantilfunktion) und Reihen (radiales Spektrum, Querprofile, Autokorrelation).

## 1 Aufruf

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"
& $py -s -m terrainlab deskriptoren C:\avesmaps3d-data\terrain-lab\referenz\alpen.json --json C:\avesmaps3d-data\terrain-lab\laeufe\alpen-desk.json
& $py -s -m terrainlab deskriptoren referenz.json --vergleich generiert.json --json-vergleich vergleich.json --ohne-teuer --zeiten
& $py -s -m terrainlab deskriptoren --katalog          # Metrikkatalog als Markdown (Quelle der Tabellen unten)
```

Optionen: `--gruppen hoehe,hang,frequenz` wählt Gruppen, `--ohne-teuer` lässt die Kostenklasse „hoch“ weg, `--zeiten` gibt die Laufzeit
je Teilberechnung aus, `--ruhig` unterdrückt die Tabelle. Das Raster ist das Austauschformat aus `terrainlab/raster.py` (`.json` plus `.f32`).

```python
from terrainlab.raster import lies
from terrainlab.deskriptoren import berechne, vergleiche

a = berechne(lies("referenz.json"))              # Metrikvektor
b = berechne(lies("generiert.json"))
v = vergleiche(a, b)                             # b gegen die Referenz a; MassstabFehler bei ungleicher Zellgröße oder Parametern
print(a["hang_neigung_mittel"], v.verteilungen["hang_neigung"].w1_norm, v.gruppenabstand())
```

`Parameter` (in `kern.py`) bündelt alle Längen und Schwellen **in Metern**; sie gelten für jede Zellgröße gleich. Zwei Metrikvektoren sind
nur vergleichbar, wenn ihre Parameter gleich sind; `vergleiche` prüft das und die Zellgröße.

## 2 Konventionen

- **Einheiten:** Höhen in Metern, Neigung in Grad (physikalisch aus Metern, `arctan` des Gradienten; keine Normierung auf 0..1, die
  unrealistisch steile Hänge gut aussehen ließe), Krümmung in 1/m, Flächen in km² oder m², Längen in m oder km.
- **NoData:** NaN. Ableitungen sind NaN, wo ihre 3x3-Umgebung nicht vollständig gültig ist (auch am Rand). Fenstermaße verwenden die gültigen
  Zellen des Fensters, wenn mindestens die Hälfte gültig ist. Der Anteil steht in `hoehe_nodata_anteil`.
- **Nachbarschaft:** immer 8er (Achsen und Diagonalen); Gefälle werden durch den Zellabstand geteilt (Diagonale √2).
- **Fenster:** quadratisch mit Halbkante `r = round(R / Zellgröße)` Zellen (mindestens 1). Fenster, die nicht ins Raster passen, entfallen mit
  Eintrag in `kopf["hinweise"]`.
- **Art:** `absolut` (Meter, Grad; hängt vom Reliefumfang ab), `relativ` (auf Wertebereich oder Länge normiert, vergleicht auch Ausschnitte
  unterschiedlicher Höhe), `verteilung` (Kennwert einer Zellverteilung; die Verteilung selbst steht in `verteilungen`), `raeumlich`
  (hängt von der Anordnung ab: Dichten, Abstände, Netze, Spektrum).
- **Kosten:** Laufzeit der Metrik allein (mit ihren Vorstufen) auf einem 1024²-Raster, Entwicklungsrechner: `gering` unter 0,25 s, `mittel`
  bis 1 s, `hoch` darüber. Messwerte in Abschnitt 6.
- **Namen:** Parameterwerte stehen als Suffix: `_r250m` Fensterradius, `_d500m` Abstand, `_h25m` Höhe, `_p100m` Prominenz, `_l500m` Länge
  (Wellenlänge oder Lag), `_a1km2` Flächenschwelle, `_f2` Skalenfaktor, `_b3` Band. Im Katalog stehen die Familien mit Platzhaltern
  (`_r{N}m`); die Definition nennt als Beispiel den ersten Parameterwert.
- **Verteilungen:** Quantilfunktion an 512 Stützstellen u = (i + ½) / 512 aus allen gültigen Zellen. Daraus folgt der Wasserstein-Abstand
  unabhängig von der Rasterkante.

## 3 Befund zur Autorenimplementation (Argudo et al. 2025)

Quelle: Argudo et al., *Terrain Descriptors for Landscape Synthesis, Analysis and Simulation*, Computer Graphics Forum 2025,
<https://doi.org/10.1111/cgf.70080>; Autorencode <https://github.com/oargudo/terrain-descriptors>. Durchsicht am 2026-10-23 über die
GitHub-Rohdateien (`LICENSE`, `README.md`, `appMetrics/heightfield.h`, `heightfield-metrics-{local,orometry,hydrology}.cpp`,
`terrainanalysis.cpp`); das Repository wurde nicht lokal geklont oder gebaut.

| Frage | Befund |
|---|---|
| Sprache | C++ mit Qt-Projekt (`AppTerrainMetrics.pro`) und GLSL-Shadern, interaktive Anwendung zum Anzeigen der Metriken. Kein Python, keine einbindbare Bibliothek. |
| Lizenz | MIT, Copyright Oscar Argudo 2025: Übernahme unter Nennung der Quelle wäre zulässig. Der Unterordner `appMetrics/akirmse-mountains/` (Prominenz und Isolation nach Andrew Kirmse) trägt keine eigene Lizenzdatei; seine Lizenz ist ungeklärt. |
| Charakter | Laut README „einfacher, illustrativer“ Code nach den Metrikdefinitionen, nicht optimiert, Sichtbarkeitsmaße laufen im UI-Thread und sind langsam. Für 1024²-Raster in einer Optimierungsschleife ungeeignet. |
| Umfang | Lokal: Neigung, Aspekt, Laplace, Krümmung (Mittel, Gauß, Profil, Kontur, Tangential, Min/Max), lokales Relief, lokale Varianz, Flächenverhältnis, TPI, Rauheitsindex, Oberflächenrauheit, Hangasymmetrie. Sichtbarkeit: Viewshed, Openness, Himmelsansicht, Sonne. Landformen: Dikau-Wood, TPI-Klassen, Geomorphons. Hydrologie: D8, MFD, D∞, Rho8, kinematische Fläche, Feuchteindex, Stream Power. Orometrie: Gipfelanteil, ORS, Jut/Rut, Peakness; Prominenz/Isolation; Fluss- und Kammnetz mit Ordnungsschemata. |
| Übernommen | **Kein Code.** Die Definitionen und Formeln (Profil-/Plankrümmung, TRI, TPI, Zählweise der Prominenz über den Schlüsselsattel, D8-Fläche) wurden geprüft und mit den Standardquellen abgeglichen (siehe Abschnitt 4). Die Python-Fassung ist neu, vektorisiert in NumPy/SciPy. |
| Gründe | Andere Sprache und GUI-Kopplung (Portierung wäre ohnehin Neuschreibung), reine Zellschleifen wären in Python um Größenordnungen zu langsam, eine Teillizenz ist ungeklärt, und einige Stellen sind für einen Maßstab-Vergleich ungeeignet (siehe unten). |

Auffälligkeiten beim Lesen (noch nicht gegen eine gebaute Fassung des Autorencodes gemessen):

- `RuggednessIndex` nennt sich RMS, teilt aber nicht durch die Zellzahl; es entspricht Rileys TRI (Wurzel der Summe der Quadrate). Wir folgen Riley.
- Die Quadrikanpassung für Krümmungen größerer Fenster (`FitQuadric`) wirkt in der Normalmatrix unvollständig; wir verwenden das 3x3-Schema (Evans/Zevenbergen–Thorne), das mit GDAL und Horn zusammenpasst.
- Randzellen der Krümmung erhalten dort den Wert 0 statt „undefiniert“; wir setzen NaN, damit Ränder die Verteilungen nicht verfälschen.
- Das Kammnetz entsteht dort aus dem Divide-Tree (Gipfel und Sättel, Dijkstra-Pfade); wir bilden es billiger über die Aufwärts-Einzugsfläche auf dem gipfelaufgelösten, invertierten Gelände (Abschnitt 4, Gruppe C). Die Gratordnungen nach Rak 2019 und Scherler 2020 sind nicht übernommen; `gipfel_baum_*` ist ein einfacher Ersatz.
- Nicht in der ersten Auswahl (teuer oder für die Gebirgsform wenig aussagekräftig): Sichtbarkeit, Sonne, Geomorphons, Dikau-Wood, Jut/Rut/ORS/Peakness, Hangasymmetrie, MFD/D∞/Rho8. Sie lassen sich als weitere Metrikfamilien in `deskriptoren/` ergänzen.

## 4 Definitionen und Quellen

### Gruppe A Höhenverteilung (`hoehe.py`)

- Min, Max, Mittel, Standardabweichung, Reliefspanne; Quantile 5, 25, 50, 75, 95 %.
- **Hypsometrisches Integral** = (Mittel − Minimum) / Spanne (Strahler 1952; Pike & Wilson 1971). Eine Ebene ergibt genau 0,5.
- **Histogramm** als zehn Höhenbänder der auf 0..1 normierten Höhe; `hoehe_anteil_hoch` / `hoehe_anteil_tief` = Anteil oberhalb 75 % bzw. unterhalb 25 % der Spanne.
- **Relative Reliefhöhe** `hoehe_ueber_grund_*`: Höhe über dem tiefsten Punkt des Fensters ±R (mittlere und größte).

### Gruppe B Hang und Relief (`hang.py`)

- **Neigung:** Horn (1981), gewichtete 3x3-Differenz, `p = ∂z/∂x` nach Osten, `q = ∂z/∂y` nach Süden; Neigung = `arctan(√(p²+q²))`. Verteilungskennwerte, Anteile über 30°, 45°, 60° und unter 5°.
- **Neigung auf mehreren Skalen:** Blockmittel der Höhe mit Faktor f (Zellkante f·dx), Neigung wie oben. `hang_skalenexponent` ist die Steigung von ln(mittlerer Gradient) über ln(Zellkante): 0 für eine Ebene, negativ für raues Gelände (Hänge werden bei Vergröberung flacher).
- **Krümmung:** zweite Ableitungen nach Evans/Young `r = (z₋ − 2z + z₊)/dx²` usw., Kreuzterm `s = (a − c − g + i)/(4dx²)`. Profilkrümmung (in Fallrichtung) = −(p²r + 2pqs + q²t) / ((p²+q²)(1+p²+q²)^{3/2}), Plankrümmung (Höhenlinie) = −(q²r − 2pqs + p²t) / (p²+q²)^{3/2}. **Vorzeichen: positiv = konvex (Kuppe, Rücken), negativ = konkav (Mulde, Tal).** Undefiniert (NaN) bei |∇z| < 10⁻⁴. Test an einer Parabelkuppel mit bekannter Formel.
- **Reliefenergie:** Maximum minus Minimum im quadratischen Fenster ±R; `hang_reliefverhaeltnis_*` teilt durch die Fensterkante.
- **Variation:** mittlere lokale Standardabweichung der Höhe im Fenster; `hang_variation_exponent` ist die Steigung von ln(Streuung) über ln(Radius).
- **Rauheit:** `hang_tri_*` nach Riley et al. (1999), √Σ(zᵢ − z₀)² über die acht Nachbarn (Einheit Meter; Ebene mit Gefälle g je Zelle: g·√6). `hang_vrm_*` nach Sappington et al. (2007): 1 − |Σn|/N über die Einheitsnormalen im Fenster (0 glatt).

### Gruppe C Gipfel und Kämme (`gipfel.py`, `regionen.py`, `fliess.py`, `netz.py`)

- **Lokale Maxima:** Zellen ohne strikt höheren Nachbarn; zusammenhängende Zellen gleicher Höhe (Plateaus) zählen als ein Maximum.
- **Topographische Prominenz** über den **Schlüsselsattel** (nicht über eine Nachbarschaftsdifferenz): Das Raster wird in Becken des steilsten Anstiegs zerlegt (alle Zellen, die auf steilstem Weg im selben Maximum enden); zwischen Nachbarbecken zählt der höchste Übergang. Die Übergänge werden von hoch nach tief abgearbeitet und die Becken mit Union-Find vereinigt; trifft eine Kante zwei verschiedene Komponenten, stirbt der niedrigere Gipfel dort (Persistenz der Überschreitungsmengen, Edelsbrunner et al. 2002), und seine Prominenz ist Gipfelhöhe minus Höhe dieser Kante. Das entspricht der Definition der Orometrie (Kirmse & de Ferranti 2017). **Hauptgipfel** jeder zusammenhängenden gültigen Fläche: Höhe über dem tiefsten Wert dieser Fläche. Der Rechenaufwand liegt in NumPy/SciPy auf Zellebene und in einer Python-Schleife nur über die Becken. Gegen ein zellweises Verfahren (Sortieren, Union-Find je Zelle) mit Zufalls-, NoData- und Plateau-Rastern geprüft.
- **Gipfel-Kennzahlen:** Dichten je Prominenzstufe (`gipfel_dichte_p*`), bedeutsame Gipfel ab `min_prominenz_m` (Standard 100 m), deren Prominenz (Verteilung, auf die Reliefspanne bezogen), mittlere normierte Höhe.
- **Abstände:** nächster bedeutsamer Nachbar (Median, Mittel), **Nächster-Nachbar-Index** (Clark & Evans 1954; mittlerer Abstand geteilt durch 0,5/√Dichte; Randeffekt unkorrigiert), **Isolation** = Abstand zum nächsten höheren bedeutsamen Gipfel (Näherung: Gipfel statt beliebiger höherer Zelle; eine obere Schranke der echten Isolation).
- **Gipfelbaum:** der Elter eines Gipfels ist der bedeutsame Gipfel jenseits seines Schlüsselsattels (Nachbarbecken; unbedeutende Becken werden übersprungen). `gipfel_baum_kinder_*` und `gipfel_baum_blattanteil` messen die Verzweigung der Gratsysteme.
- **Kammnetz:** D8-Fließnetz auf dem invertierten Gelände. Gipfel sind dort Senken und laufen über ihren höchsten Schlüsselsattel in das Nachbarbecken über (wie Senken in Gruppe D); sonst bliebe jedes Rauschmaximum ein Endpunkt, und das Netz zerfiele. Kammzellen sind Zellen, deren Aufwärts-Einzugsfläche die Schwelle (`netz_schwellen_m2`, Standard 0,1 und 1 km², mindestens 9 Zellen) erreicht. Kennzahlen: Länge je Fläche (D8-Schritte, Sprünge über Sättel zählen null), Quellen, Zusammenflüsse (Zuflüsse minus eins), höchste Strahler-Ordnung und Bifurkationsverhältnis (Regression von ln der Abschnittszahl über der Ordnung; Horton 1945, Strahler 1957). Auf statistisch symmetrischem Gelände (Spektralsynthese) stimmen Kamm- und Gerinnedichte überein; das dient als Probe.
- **Kammachse und Querprofil** (Kostenklasse „hoch“): Kammnetz der gröbsten Schwelle, begrenzt auf Zellen, die quer zum Kamm konvex sind (kleinster Eigenwert der Hesse-Matrix auf leicht geglättetem Gelände < −`kamm_kruemmung_min`). Für jede Zelle bestimmt eine Distanztransformation die nächste Kammzelle; `kamm_profil_d*` ist der mittlere Höhenabfall zu Zellen im Abstandsband 0,8 d bis 1,2 d (Querprofil, auch als Reihe `kamm_querprofil`); `kamm_tpi_r*` die mittlere Höhe der Kammzellen über dem Fenstermittel (Weiss 2001). Test an einem geraden Dachkamm mit bekannter Flankenneigung.

### Gruppe D Hydrologie (`hydrologie.py`, `fliess.py`)

- **Fließrichtung:** D8 (O'Callaghan & Mark 1984), steilstes Gefälle zu einem der acht Nachbarn, Diagonalen durch √2 geteilt.
- **Geschlossene Senken:** Füllhöhe jeder Zelle = Engpass des tiefsten Überlaufs bis zum Rand (Priority-Flood-Ergebnis, Barnes et al. 2014), bestimmt über Becken des steilsten Abstiegs, Passhöhen zwischen Nachbarbecken und einen minimalen Spannbaum auf dem Beckengraphen statt über eine Prioritätswarteschlange aller Zellen. Senkentiefe = Füllhöhe − Zellhöhe. Anteil, Anzahl, Dichte, Tiefe (Zellen und je Senke), Fläche und mittlere Füllhöhe (`hydro_senken_*`) sind die Karst-Merkmale. Der Rand (Rasterkante oder NoData-Nachbar) ist Auslass. Exakter Abgleich mit einem Priority-Flood auf Zufalls-, NoData- und Stufenrastern.
- **Fließnetz und Einzugsfläche:** Zellen auf einem Senkenboden springen über den Sattel in das Nachbarbecken (virtueller Schritt, in der Länge null); dadurch erreicht jede Zelle einen Auslass und die Flächen bilanzieren: die Summe der Flächen aller Auslässe ist die Zahl der gültigen Zellen (als Test geprüft). Die Fläche wird schichtweise (topologische Ordnung) vektorisiert summiert.
- **Einzugsgebiete:** Auslässe mit Fläche ≥ `einzugsgebiet_min_m2` (Standard 1 km²); `hydro_einzugsgebiet_groesstes_anteil`, Verteilung der Gebietsflächen, Verteilung der Einzugsfläche aller Zellen (log₁₀ km²).
- **Gerinnenetz:** Zellen mit Einzugsfläche ≥ Schwelle (wie beim Kammnetz). Entwässerungsdichte = Gerinnelänge je Fläche (`gerinne_dichte_*`), Quellen, Zusammenflüsse, Strahler-Ordnung, Bifurkationsverhältnis. Hinweis: auf ebenen Hängen erzeugt D8 parallele Fließlinien, deren Fläche mit dem Abstand wächst; die Dichte ist dort schwellenabhängig und nur zwischen Geländen gleicher Parameter vergleichbar.
- **Tal** (Kostenklasse „hoch“): Distanztransformation vom Gerinne der gröbsten Schwelle. `tal_hand_*` = Höhe über dem nächsten Gerinne (HAND, euklidisch), `tal_abstand_median`, **Talbreite** `tal_breite_h*` = Fläche der Zellen höchstens h über dem nächsten Gerinne geteilt durch die Gerinnelänge, **Einschnitt** `tal_profil_d*` = mittlerer Anstieg vom Gerinne zu Zellen im Abstand d (Querprofil, Reihe `tal_querprofil`), `gerinne_neigung_median` = Geländeneigung auf Gerinnezellen.

### Gruppe E Frequenz und Skalen (`frequenz.py`)

- **Leistungsspektrum:** Höhe nach Abzug der besten Ebene, NoData als 0, Hann-Fenster, `rfft2`; Leistungsdichte in m⁴ so normiert, dass ihr Integral über die Wellenzahlebene die Höhenvarianz ergibt. Radial gemittelt in logarithmischen Bändern (Reihe `frequenz_spektrum_radial`, log₁₀ der Leistung über der Wellenzahl in 1/m). `frequenz_spektrum_beta` = −Steigung der Leistung über k im Bereich 8 Zellen bis ein Viertel der Rasterkante (fraktale Gelände: β = 2H + 2, Gebirge etwa 2 bis 3; an der Synthese mit β = 2 und 3 getestet).
- **Wellenlängenbänder:** Anteil der Höhenvarianz in den durch `wellenlaengen_m` begrenzten Bändern (Standard 500, 2000, 8000 m: vier Bänder, Summe 1) als Maß für groß- gegen kleinräumiges Relief.
- **Richtung und Gitterartefakte:** Die Leistung wird je Ring durch das Ringmittel geteilt (≈ 1 bei Isotropie). `frequenz_anisotropie` ist die Streuung dieses Verhältnisses über 16 Richtungssektoren (isotrop ≈ 0,05), `frequenz_hauptrichtung` der stärkste Sektor. `frequenz_achsenverhaeltnis` und `frequenz_diagonalenverhaeltnis` mitteln das Verhältnis genau auf den Rasterachsen bzw. Diagonalen: Zeilen-/Spaltenstreifen und D8-Vorzugsrichtungen heben es deutlich über 1 (an Streifenartefakten getestet: 3 bis 4 gegen 0,7 bis 0,9). **Spitzen** (`frequenz_spitzen_*`): Zellen, deren Leistung das `spitzen_schwelle`-Fache (Standard 20) des Ringmittels (aus dem Ringmedian, Median einer Exponentialverteilung = ln 2 · Mittel) übersteigt; Rauschen erreicht höchstens etwa 10 bis 16, periodische Muster (Terrassierung, Rasterwellen) 60 bis 110. Eine einzelne schwache Spitze (hier 3 m Amplitude auf 800 m Relief) bleibt unter der Schwelle; sie ist bewusst konservativ.
- **Autokorrelation:** inverse Fouriertransformation des Periodogramms (Wiener–Khinchin), radial gemittelt (Reihe `frequenz_autokorrelation_radial`); Korrelationslänge = Abstand, bei dem sie auf 1/e fällt (NaN, wenn bis ein Viertel der Rasterkante nicht erreicht), und Werte bei den Lags aus `lags_m`.
- **Räumliche Zusammenhängigkeit:** globales **Moran-I** (Moran 1950; 8er-Nachbarschaft, binäre Gewichte) der Hangneigung und der Plankrümmung; **Gradiententensor** (`frequenz_orientierung_*`): Kohärenz 0 isotrop, 1 alle Hänge in einer Richtung; Richtung des mittleren Gradienten (quer zu den Rücken), 0° nach Osten, 90° nach Süden.

## 5 Vergleich real gegen generiert

`vergleiche(a, b)` (`vergleich.py`) vergleicht `b` gegen die Referenz `a`:

- **Je Verteilung der Wasserstein-1-Abstand** (Erdbewegungsabstand) in der Einheit der Metrik, aus den Quantilfunktionen als Mittel der absoluten Unterschiede (512 Stützstellen). `wasserstein_exakt(x, y)` rechnet exakt aus zwei Stichproben beliebiger Größe. `w1_norm` teilt durch den Interquartilsabstand der Referenz (dimensionslos; NaN, wenn die Referenz keine Streuung hat).
- **Je Einzelwert** Differenz und relative Abweichung `(b − a) / |a|`.
- **Je Reihe** (Spektrum, Querprofile, Autokorrelation) der mittlere absolute Abstand auf dem gemeinsamen x-Bereich (Spektrum logarithmisch interpoliert).
- `gruppenabstand()` mittelt `w1_norm` je Gruppe als Wegweiser; er ersetzt keine Einzelbetrachtung.
- **Maßstab:** gleiche Zellgröße (relativ 10⁻⁶) und gleiche `Parameter`, sonst `MassstabFehler`. Verschiedene Rasterkanten sind zulässig. Reale Referenz und generiertes Gelände vorher auf dieselbe Zellgröße bringen (Resampling gehört nicht in dieses Paket).
- Das Maß für die absolute Höhenlage (`hoehe`) ist von der Referenzhöhe abhängig; für einen Formvergleich `hoehe_rel` und die relativen Maße heranziehen.

## 6 Kosten und Skalierung

Messung auf dem Entwicklungsrechner (Windows 11, NumPy 2.5.4, SciPy 1.18.1), Spektralsynthese 1024×1024 mit 30 m Zellkante,
`pytest -s tests/test_deskriptoren_laufzeit.py` bzw. `--zeiten`:

| Lauf | Zeit |
|---|---|
| alle Gruppen, alle 172 Metriken (Standardparameter) | 5,7 s |
| alle Gruppen mit `--ohne-teuer` (151 Metriken) | 5,0 s |
| Gruppe A allein | 0,8 s |
| Gruppe B allein | 1,6 s |
| Gruppe C allein (mit Kamm-Querprofil) | 2,4 s |
| Gruppe D allein (mit Tal) | 1,4 s |
| Gruppe E allein | 0,7 s |
| Schnellprofil `--gruppen hoehe,hang,frequenz` (99 Metriken) | ca. 2,5 s |

Teilberechnungen (Sekunden auf 1024², gemeinsame Vorstufen nur einmal gezählt):

| Teilberechnung | Zeit | Bemerkung |
|---|---|---|
| `fliessnetz_aufwaerts` (gipfelaufgelöstes Kammnetz) | 0,9 | Beckenzerlegung, Spannbaum, Schichtsumme |
| `prominenz` | 0,9 | Beckenzerlegung, Union-Find über die Becken (Python-Schleife je Becken) |
| `fliessnetz_abwaerts` (senkenaufgelöstes Gerinnenetz) | 0,8 | wie oben |
| `hoehe` (mit den Fenstermaßen aller Radien) | 0,8 | je Radius etwa 0,15 s für Maximum, Minimum, Mittel, Streuung |
| `hang_rauheit` (TRI und VRM) | 0,55 | |
| `hang_neigung`, `hang_kruemmung` | 0,27 und 0,22 | |
| `frequenz_spektrum` | 0,25 | eine `rfft2`, Ringstatistik, eine `irfft2` |
| `hydro_tal`, `kamm_profil` | 0,2 und 0,1 | je eine Distanztransformation |
| übrige | unter 0,1 | |

Skalierung: Alles ist linear in der Zellzahl bis auf die Python-Schleifen über die **Becken** (`prominenz`, Senkenauflösung; Aufwand
proportional zur Zahl lokaler Extrema, bei verrauschtem Gelände bis zu 1 bis 3 % der Zellen) und die Schichtsumme des Fließnetzes (Zahl der
Durchläufe = längster Fließweg in Zellen). 2048×2048: etwa 25 s. **Speicher:** etwa 0,5 KB je Zelle (1024²: 0,55 GB Spitze, 2048²:
2,0 GB), 4096² brauchen rund 8 GB und sollten gekachelt oder auf gröbere Zellen gebracht werden.

Die Kostenklasse „hoch“ trägt, was Kammachse oder Gerinne zusätzlich zu einem Fließnetz und einer Distanztransformation braucht
(`kamm_profil_*`, `kamm_tpi_*`, `kamm_achse_anteil`, `gerinne_neigung_median`, `tal_*`); `--ohne-teuer` spart davon rund 0,7 s und die
Reihen `kamm_querprofil` und `tal_querprofil`. Das größte Einsparpotenzial liegt im Weglassen der Gruppen C und D (`--gruppen`).

## 7 Katalog

Erzeugt mit `python -m terrainlab deskriptoren --katalog`. Spalte „Kosten“ wie in Abschnitt 2.

### A Höhenverteilung

| Metrik | Einheit | Art | Kosten | Definition |
|---|---|---|---|---|
| `hoehe_nodata_anteil` | 1 | relativ | gering | Anteil ungültiger Zellen (NoData/NaN); Spektral- und Fenstermaße sind bei großen Anteilen nur grob verlässlich |
| `hoehe_flaeche` | km² | absolut | gering | Fläche der gültigen Zellen |
| `hoehe_min` | m | absolut | gering | niedrigste gültige Höhe |
| `hoehe_max` | m | absolut | gering | höchste gültige Höhe |
| `hoehe_mittel` | m | absolut | gering | mittlere Höhe |
| `hoehe_std` | m | absolut | gering | Standardabweichung der Höhe |
| `hoehe_relief` | m | absolut | gering | Reliefspanne des Ausschnitts (Maximum minus Minimum) |
| `hoehe_q05` | m | verteilung | gering | Höhenquantil 05 % |
| `hoehe_q25` | m | verteilung | gering | Höhenquantil 25 % |
| `hoehe_q50` | m | verteilung | gering | Höhenquantil 50 % |
| `hoehe_q75` | m | verteilung | gering | Höhenquantil 75 % |
| `hoehe_q95` | m | verteilung | gering | Höhenquantil 95 % |
| `hoehe_hypsometrisches_integral` | 1 | relativ | gering | (Mittel - Minimum) / Spanne; 0,5 = gleichmäßig, klein = Gipfel auf großer Fläche tief |
| `hoehe_rel_q25` | 1 | relativ | gering | Quantil 25 % der auf 0..1 normierten Höhe |
| `hoehe_rel_q50` | 1 | relativ | gering | Quantil 50 % der auf 0..1 normierten Höhe |
| `hoehe_rel_q75` | 1 | relativ | gering | Quantil 75 % der auf 0..1 normierten Höhe |
| `hoehe_anteil_hoch` | 1 | relativ | gering | Anteil der Zellen im obersten Viertel der Spanne |
| `hoehe_anteil_tief` | 1 | relativ | gering | Anteil der Zellen im untersten Viertel der Spanne |
| `hoehe_schiefe` | 1 | relativ | gering | Schiefe der Höhenverteilung |
| `hoehe_anteil_band_b{I}` | 1 | relativ | gering | Anteil im Höhenband 0–10 % der Spanne (Histogramm) |
| `hoehe_ueber_grund_mittel_r{N}m` | m | absolut | mittel | mittlere Höhe über dem tiefsten Punkt im Fenster ±250 m |
| `hoehe_ueber_grund_max_r{N}m` | m | absolut | mittel | größte Höhe über dem tiefsten Punkt im Fenster ±250 m |

Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:

| Name | Einheit | Inhalt |
|---|---|---|
| `hoehe` | m | Verteilung: Höhenverteilung in Metern |
| `hoehe_rel` | 1 | Verteilung: auf 0..1 normierte Höhe |
| `hoehe_ueber_grund_r{N}m` | m | Verteilung: relative Reliefhöhe: Höhe über dem Fenstertiefpunkt ±1000 m |

### B Hang und Relief

| Metrik | Einheit | Art | Kosten | Definition |
|---|---|---|---|---|
| `hang_neigung_mittel` | ° | verteilung | gering | mittlere Hangneigung |
| `hang_neigung_median` | ° | verteilung | gering | Median der Hangneigung |
| `hang_neigung_p90` | ° | verteilung | gering | 90. Perzentil der Hangneigung |
| `hang_neigung_p99` | ° | verteilung | gering | 99. Perzentil der Hangneigung |
| `hang_neigung_max` | ° | verteilung | gering | steilste Hangneigung |
| `hang_neigung_std` | ° | verteilung | gering | Standardabweichung der Hangneigung |
| `hang_anteil_flach_lt5` | 1 | verteilung | gering | Anteil der Zellen flacher als 5° |
| `hang_anteil_gt30` | 1 | verteilung | gering | Anteil der Zellen steiler als 30° |
| `hang_anteil_gt45` | 1 | verteilung | gering | Anteil der Zellen steiler als 45° |
| `hang_anteil_gt60` | 1 | verteilung | gering | Anteil der Zellen steiler als 60° |
| `hang_neigung_mittel_f{F}` | ° | verteilung | gering | mittlere Hangneigung bei 2-facher Zellkante (Blockmittel) |
| `hang_skalenexponent` | 1 | relativ | gering | Exponent der mittleren Neigung über der Zellkante (0 = Ebene, negativ = rau: Hänge werden bei Vergröberung flacher) |
| `hang_kruemmung_profil_mittel` | 1/m | verteilung | gering | mittlere Profilkrümmung (in Fallrichtung); positiv konvex, negativ konkav |
| `hang_kruemmung_profil_abs_mittel` | 1/m | verteilung | gering | mittlerer Betrag der Profilkrümmung (in Fallrichtung) |
| `hang_kruemmung_profil_p05` | 1/m | verteilung | gering | 5. Perzentil der Profilkrümmung (in Fallrichtung) |
| `hang_kruemmung_profil_p95` | 1/m | verteilung | gering | 95. Perzentil der Profilkrümmung (in Fallrichtung) |
| `hang_kruemmung_profil_anteil_konvex` | 1 | verteilung | gering | Anteil konvexer Zellen (Profilkrümmung (in Fallrichtung)) |
| `hang_kruemmung_plan_mittel` | 1/m | verteilung | gering | mittlere Plankrümmung (entlang der Höhenlinie); positiv konvex, negativ konkav |
| `hang_kruemmung_plan_abs_mittel` | 1/m | verteilung | gering | mittlerer Betrag der Plankrümmung (entlang der Höhenlinie) |
| `hang_kruemmung_plan_p05` | 1/m | verteilung | gering | 5. Perzentil der Plankrümmung (entlang der Höhenlinie) |
| `hang_kruemmung_plan_p95` | 1/m | verteilung | gering | 95. Perzentil der Plankrümmung (entlang der Höhenlinie) |
| `hang_kruemmung_plan_anteil_konvex` | 1 | verteilung | gering | Anteil konvexer Zellen (Plankrümmung (entlang der Höhenlinie)) |
| `hang_reliefenergie_mittel_r{N}m` | m | verteilung | mittel | mittlere Reliefenergie (Maximum minus Minimum) im Fenster ±250 m |
| `hang_reliefenergie_p95_r{N}m` | m | verteilung | mittel | 95. Perzentil der Reliefenergie im Fenster ±250 m |
| `hang_reliefenergie_max_r{N}m` | m | verteilung | mittel | größte Reliefenergie im Fenster ±250 m |
| `hang_reliefverhaeltnis_mittel_r{N}m` | 1 | relativ | mittel | mittlere Reliefenergie geteilt durch die Fensterkante (±250 m) |
| `hang_variation_std_r{N}m` | m | verteilung | mittel | mittlere lokale Standardabweichung der Höhe im Fenster ±250 m |
| `hang_variation_exponent` | 1 | relativ | mittel | Exponent der lokalen Höhenstreuung über dem Fensterradius (Hurst-ähnlich; ~1 glatt, ~0 schwach strukturiert) |
| `hang_tri_mittel` | m | verteilung | gering | Geländerauheitsindex (Riley 1999): Wurzel der Summe der Quadrate der Höhenunterschiede zu den 8 Nachbarn, Mittel |
| `hang_tri_p95` | m | verteilung | gering | 95. Perzentil des Geländerauheitsindex |
| `hang_vrm_mittel_r{N}m` | 1 | verteilung | mittel | Vektor-Rauheitsmaß (Sappington 2007) im Fenster ±100 m: 0 glatt, größer rauer |

Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:

| Name | Einheit | Inhalt |
|---|---|---|
| `hang_neigung` | ° | Verteilung: Hangneigung in Grad (aus Metern, Horn-Gradient) |
| `hang_kruemmung_profil` | 1/m | Verteilung: Profilkrümmung (in Fallrichtung) |
| `hang_kruemmung_plan` | 1/m | Verteilung: Plankrümmung (entlang der Höhenlinie) |
| `hang_reliefenergie_r{N}m` | m | Verteilung: Reliefenergie im Fenster ±1000 m |
| `hang_tri` | m | Verteilung: Geländerauheitsindex nach Riley |
| `hang_vrm_r{N}m` | 1 | Verteilung: Vektor-Rauheitsmaß im Fenster ±500 m |

### C Gipfel und Kämme

| Metrik | Einheit | Art | Kosten | Definition |
|---|---|---|---|---|
| `gipfel_lokale_maxima_dichte` | 1/km² | raeumlich | mittel | lokale Maxima (Plateaus zählen einfach) je Fläche; hoch = Rauschen oder feines Relief |
| `gipfel_dichte_p{N}m` | 1/km² | raeumlich | mittel | Gipfel mit Prominenz ≥ 50 m je Fläche |
| `gipfel_anzahl` | 1 | absolut | mittel | Gipfel mit Prominenz ≥ 100 m (bedeutsame Gipfel) |
| `gipfel_prominenz_mittel` | m | verteilung | mittel | mittlere Prominenz der bedeutsamen Gipfel |
| `gipfel_prominenz_median` | m | verteilung | mittel | Median der Prominenz der bedeutsamen Gipfel |
| `gipfel_prominenz_p90` | m | verteilung | mittel | 90. Perzentil der Prominenz der bedeutsamen Gipfel |
| `gipfel_prominenz_max` | m | verteilung | mittel | größte Prominenz (Hauptgipfel: Höhe über dem Rastertiefpunkt) |
| `gipfel_prominenz_rel_mittel` | 1 | relativ | mittel | mittlere Prominenz der bedeutsamen Gipfel geteilt durch die Reliefspanne |
| `gipfel_hoehe_rel_mittel` | 1 | relativ | mittel | mittlere auf 0..1 normierte Höhe der bedeutsamen Gipfel |
| `gipfel_abstand_nn_median` | m | raeumlich | mittel | Median des Abstands zum nächsten bedeutsamen Gipfel |
| `gipfel_abstand_nn_mittel` | m | raeumlich | mittel | mittlerer Abstand zum nächsten bedeutsamen Gipfel |
| `gipfel_nni` | 1 | raeumlich | mittel | Nächster-Nachbar-Index (1 zufällig, <1 gehäuft, >1 gleichmäßig verteilt; Randeffekt nicht korrigiert) |
| `gipfel_isolation_median` | m | raeumlich | mittel | Median der Isolation (Abstand zum nächsten höheren bedeutsamen Gipfel) |
| `gipfel_isolation_p90` | m | raeumlich | mittel | 90. Perzentil der Isolation |
| `gipfel_baum_kinder_max` | 1 | raeumlich | mittel | größte Zahl direkter Kindgipfel eines Gipfels im Gipfelbaum (Verzweigung der Gratsysteme) |
| `gipfel_baum_kinder_mittel` | 1 | raeumlich | mittel | mittlere Zahl der Kindgipfel der Gipfel mit mindestens einem Kind |
| `gipfel_baum_blattanteil` | 1 | raeumlich | mittel | Anteil der bedeutsamen Gipfel ohne Kindgipfel |
| `kamm_dichte_a{A}km2` | km/km² | raeumlich | mittel | Länge des Kammnetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)); Länge aus D8-Schritten, Senkensprünge zählen nicht |
| `kamm_quellen_dichte_a{A}km2` | 1/km² | raeumlich | mittel | Quellen des Kammnetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `kamm_zusammenfluesse_dichte_a{A}km2` | 1/km² | raeumlich | mittel | Zusammenflüsse (Zuflüsse minus 1) des Kammnetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `kamm_strahler_max_a{A}km2` | 1 | raeumlich | mittel | höchste Strahler-Ordnung des Kammnetzes (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `kamm_bifurkation_a{A}km2` | 1 | relativ | mittel | Bifurkationsverhältnis des Kammnetzes (Abnahme der Abschnittszahl je Ordnung, Regression; Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `kamm_achse_anteil` | 1 | raeumlich | hoch | Anteil der Kammachsenzellen (Netz der gröbsten Schwelle, quer konvex) an den gültigen Zellen |
| `kamm_profil_d{N}m` | m | absolut | hoch | mittlerer Höhenabfall von der Kammachse zu Zellen im Abstand 100 m (±20 %) – Querprofil |
| `kamm_tpi_r{N}m` | m | absolut | hoch | mittlere Höhe der Kammzellen über dem Fenstermittel ±250 m (Topographic Position Index) |

Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:

| Name | Einheit | Inhalt |
|---|---|---|
| `gipfel_prominenz` | m | Verteilung: Prominenz der bedeutsamen Gipfel |
| `gipfel_abstand_nn` | m | Verteilung: Abstand zum nächsten bedeutsamen Gipfel |
| `gipfel_isolation` | m | Verteilung: Isolation der bedeutsamen Gipfel |
| `kamm_querprofil` | m → m | Reihe: mittlerer Höhenabfall gegenüber der nächsten Kammzelle über dem Abstand |

### D Hydrologie

| Metrik | Einheit | Art | Kosten | Definition |
|---|---|---|---|---|
| `hydro_senken_anteil` | 1 | verteilung | mittel | Anteil der Zellen in geschlossenen Senken (Füllhöhe über der Zelle um mehr als 0.01 m) |
| `hydro_senken_fuelltiefe_mittel` | m | absolut | mittel | mittlere Füllhöhe über alle gültigen Zellen (Senkenvolumen je Fläche) |
| `hydro_senken_anzahl` | 1 | absolut | mittel | Zahl getrennter geschlossener Senken |
| `hydro_senken_dichte` | 1/km² | raeumlich | mittel | geschlossene Senken je Fläche |
| `hydro_senken_tiefe_mittel` | m | verteilung | mittel | mittlere Tiefe der Zellen in Senken |
| `hydro_senken_tiefe_max` | m | verteilung | mittel | größte Senkentiefe |
| `hydro_senken_tiefe_je_senke_median` | m | verteilung | mittel | Median der größten Tiefe je Senke |
| `hydro_senken_flaeche_median` | m² | verteilung | mittel | Median der Senkenfläche |
| `hydro_einzugsgebiete_anzahl` | 1 | absolut | mittel | Zahl der Auslässe mit Einzugsfläche ≥ 1 km² (Gebiete, die den Rand oder NoData erreichen) |
| `hydro_einzugsgebiet_groesstes_anteil` | 1 | relativ | mittel | Anteil des größten Einzugsgebiets an allen gültigen Zellen |
| `hydro_einzugsflaeche_p99` | km² | verteilung | mittel | 99. Perzentil der Einzugsfläche aller Zellen |
| `gerinne_dichte_a{A}km2` | km/km² | raeumlich | mittel | Länge des Gerinnenetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)); Länge aus D8-Schritten, Senkensprünge zählen nicht |
| `gerinne_quellen_dichte_a{A}km2` | 1/km² | raeumlich | mittel | Quellen des Gerinnenetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `gerinne_zusammenfluesse_dichte_a{A}km2` | 1/km² | raeumlich | mittel | Zusammenflüsse (Zuflüsse minus 1) des Gerinnenetzes je Fläche (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `gerinne_strahler_max_a{A}km2` | 1 | raeumlich | mittel | höchste Strahler-Ordnung des Gerinnenetzes (Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `gerinne_bifurkation_a{A}km2` | 1 | relativ | mittel | Bifurkationsverhältnis des Gerinnenetzes (Abnahme der Abschnittszahl je Ordnung, Regression; Einzugsfläche ≥ 0.1 km² (mindestens 9 Zellen)) |
| `gerinne_neigung_median` | ° | verteilung | hoch | Median der Geländeneigung auf Gerinnezellen (Einzugsfläche ≥ 1 km²) |
| `tal_hand_median` | m | verteilung | hoch | Median der Höhe über dem nächsten Gerinne (Height Above Nearest Drainage, euklidisch) |
| `tal_hand_p90` | m | verteilung | hoch | 90. Perzentil der Höhe über dem nächsten Gerinne |
| `tal_abstand_median` | m | raeumlich | hoch | Median des Abstands zum nächsten Gerinne |
| `tal_breite_h{N}m` | m | raeumlich | hoch | Talbreite: Fläche der Zellen höchstens 25 m über dem nächsten Gerinne geteilt durch die Gerinnelänge |
| `tal_profil_d{N}m` | m | absolut | hoch | Einschnitt: mittlerer Anstieg vom Gerinne zu Zellen im Abstand 100 m (±20 %) – Talquerprofil |

Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:

| Name | Einheit | Inhalt |
|---|---|---|
| `hydro_senken_tiefe` | m | Verteilung: Tiefe der Zellen in geschlossenen Senken |
| `hydro_senken_flaeche` | m² | Verteilung: Fläche der einzelnen Senken |
| `hydro_einzugsgebiet_flaeche` | km² | Verteilung: Flächen der Einzugsgebiete mit Auslass |
| `hydro_einzugsflaeche_log10` | log10 km² | Verteilung: Zehnerlogarithmus der Einzugsfläche aller Zellen |
| `tal_hand` | m | Verteilung: Höhe über dem nächsten Gerinne |
| `tal_abstand` | m | Verteilung: Abstand zum nächsten Gerinne |
| `tal_querprofil` | m → m | Reihe: mittlerer Höhenanstieg gegenüber dem nächsten Gerinne über dem Abstand |

### E Frequenz und Skalen

| Metrik | Einheit | Art | Kosten | Definition |
|---|---|---|---|---|
| `frequenz_spektrum_beta` | 1 | relativ | mittel | Spektralexponent β der Leistungsdichte ~ k^-β zwischen 8 Zellen und einem Viertel der Rasterkante (Gebirge ≈ 2–3; größer = glatter) |
| `frequenz_anteil_ge_l{N}m` | 1 | relativ | mittel | Anteil der Höhenvarianz bei Wellenlänge ≥ 8000 m |
| `frequenz_anteil_l{N}m_l{N}m` | 1 | relativ | mittel | Anteil der Höhenvarianz bei Wellenlänge 2000 bis 8000 m |
| `frequenz_anteil_lt_l{N}m` | 1 | relativ | mittel | Anteil der Höhenvarianz bei Wellenlänge < 500 m |
| `frequenz_anisotropie` | 1 | raeumlich | mittel | Streuung der auf den Ringmittelwert normierten Leistung über 16 Richtungssektoren (≈0,05 isotrop; größer = Vorzugsrichtung) |
| `frequenz_hauptrichtung` | ° | raeumlich | mittel | Richtung der größten Spektralleistung (Wellenvektor), 0° = Ost-West-Variation, 90° = Nord-Süd-Variation |
| `frequenz_diagonalenverhaeltnis` | 1 | raeumlich | mittel | wie Achsenverhältnis, aber genau auf den Rasterdiagonalen (gleicher Frequenzindex in beiden Richtungen; D8-Vorzugsrichtungen) |
| `frequenz_achsenverhaeltnis` | 1 | raeumlich | mittel | mittlere auf den Ringmittelwert normierte Leistung genau auf den Rasterachsen (Frequenzindex 0 in einer Richtung; ≈1 isotrop, deutlich >1 = Zeilen-/Spaltenstreifen oder Gitterartefakt) |
| `frequenz_spitzen_anzahl` | 1 | raeumlich | mittel | Spektralzellen, deren Leistung das 20-fache des Ringmittels (aus dem Median) übersteigt; ≈0 bei Rauschen, >0 bei periodischen Mustern |
| `frequenz_spitzen_anteil` | 1 | raeumlich | mittel | Anteil der Leistung (im untersuchten Wellenzahlbereich) in solchen Spitzen |
| `frequenz_spitzen_max` | 1 | raeumlich | mittel | größtes Verhältnis einer Spektralzelle zum Ringmittel (Rauschen ≈ 10–14) |
| `frequenz_autokorrelation_laenge` | m | raeumlich | mittel | Korrelationslänge: Abstand, bei dem die Autokorrelation der Höhe auf 1/e fällt |
| `frequenz_autokorrelation_l{N}m` | 1 | raeumlich | mittel | Autokorrelation der Höhe im Abstand 150 m |
| `frequenz_orientierung_kohaerenz` | 1 | raeumlich | gering | Kohärenz des Gradiententensors (0 isotrop, 1 alle Hänge zeigen in dieselbe Richtung) |
| `frequenz_orientierung_richtung` | ° | raeumlich | gering | Hauptrichtung des Gradienten (quer zu den Rücken), 0° = nach Osten, 90° = nach Süden, modulo 180° |
| `frequenz_moran_hang` | 1 | raeumlich | gering | Moran-I der Hangneigung (8er-Nachbarschaft): räumliche Zusammenhängigkeit der Steilheit; nahe 1 = Steilheit in zusammenhängenden Flächen |
| `frequenz_moran_plankruemmung` | 1 | raeumlich | gering | Moran-I der Plankrümmung (8er-Nachbarschaft) |

Verteilungen (Quantilfunktion, Grundlage des Wasserstein-Abstands) und Reihen dieser Gruppe:

| Name | Einheit | Inhalt |
|---|---|---|
| `frequenz_spektrum_radial` | 1/m → log10 m^4 | Reihe: radial gemittelte Leistungsdichte über der Wellenzahl (Zyklen je Meter) |
| `frequenz_autokorrelation_radial` | m → 1 | Reihe: radial gemittelte Autokorrelation der (ebenenbereinigten, gefensterten) Höhe über dem Abstand |

## 8 Grenzen und Näherungen

- **Fenster quadratisch**, nicht kreisförmig; Reliefenergie und Streuung sind dadurch in Diagonalrichtung leicht größer.
- **Netzschwellen sind Parameter.** Dichten und Ordnungen hängen von `netz_schwellen_m2` ab und sind nur bei gleichen Parametern vergleichbar. D8 erzeugt auf ebenen Hängen parallele Fließlinien.
- **Kammnetz ist eine Näherung** der Gratlinien: die Länge zählt nur D8-Schritte mit ausreichender Aufwärtsfläche; Sprünge über Sättel, wo ein Gipfel in den Nachbarn überläuft, zählen null. Die Richtung ist gut (Dichte, Verzweigung), die absolute Länge eine Untergrenze.
- **Isolation** ist über Gipfel statt über beliebige höhere Zellen definiert und damit eine obere Schranke; **Prominenz** und **Gipfelabstände** kennen nur das Raster, Gipfel am Rand und ihre Sättel außerhalb sind abgeschnitten. Der Hauptgipfel bekommt die Konvention Höhe minus Rastertiefpunkt.
- **Spektrum bei viel NoData** nur grob verlässlich; das Raster sollte möglichst rechteckig und gültig sein. Das Periodogramm ist nicht gemittelt (kein Welch); Einzelwerte streuen (Rauschen der Ringverhältnisse etwa ±0,2).
- **Krümmung auf 3x3** misst bei feinen Rastern Rauschen; für feine Zellen (unter 5 m) erst vergröbern.
- **Alle Parameter in Metern.** Bei sehr feinen Rastern (1 m) werden die Fenster groß (Kosten wachsen mit der Zellzahl, nicht mit dem Fenster, aber `fenster_radien_m` muss zum Merkmalsmaßstab passen).
- **Nicht enthalten:** Sichtbarkeit/Openness, Geomorphons, MFD/D∞-Flächen, Gratordnung nach Rak/Scherler, Hangasymmetrie (Abschnitt 3).

## 9 Tests

`tools/terrain-lab/tests/test_deskriptoren.py` (synthetische Flächen: Ebene, schiefe Ebene mit bekannter Neigung, Kegel, zwei Kegel mit
bekannter Prominenz, gerader Kamm mit bekanntem Querprofil, künstliche Senken, Spektralsynthese mit Gitter- und Streifenartefakten,
Parabelkuppel für die Krümmung, NoData), `test_deskriptoren_kerne.py` (Prominenz, Senkenfüllung, Bilanz und Strahler gegen langsame
Referenzverfahren, auch mit Plateaus), `test_deskriptoren_vergleich.py` (Wasserstein, Maßstabsprüfung), `test_deskriptoren_cli.py` (Befehl und
vollständige Dokumentation aller Metriken), `test_deskriptoren_laufzeit.py` (1024²-Messung). Alle Tests laufen mit Warnungen als Fehler.

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
C:\avesmaps3d-data\terrain-lab\env\python.exe -s -m pytest tests/test_deskriptoren.py tests/test_deskriptoren_kerne.py tests/test_deskriptoren_vergleich.py tests/test_deskriptoren_cli.py
C:\avesmaps3d-data\terrain-lab\env\python.exe -s -m pytest -s tests/test_deskriptoren_laufzeit.py
```

## 10 Literatur

Argudo et al. (2025), CGF, doi 10.1111/cgf.70080 · Barnes, Lehman, Mulla (2014), Priority-Flood · Clark & Evans (1954), Nearest-Neighbor-Index
· Edelsbrunner, Letscher, Zomorodian (2002), Topological Persistence · Horn (1981), Hill shading and the reflectance map · Horton (1945) ·
Kirmse & de Ferranti (2017), Calculating the prominence and isolation of every mountain in the world · Moran (1950) · O'Callaghan & Mark (1984),
D8 · Pike & Wilson (1971), Hypsometric Integral · Riley, DeGloria, Elliot (1999), Terrain Ruggedness Index · Sappington, Longshore,
Thompson (2007), Vector Ruggedness Measure · Strahler (1952, 1957) · Weiss (2001), Topographic Position Index · Evans (1980) und
Zevenbergen & Thorne (1987) für die Krümmung auf 3x3.
