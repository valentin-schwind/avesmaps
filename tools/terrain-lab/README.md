# Terrain Calibration & Benchmark Lab (WI-0250)

Lokale Mess-, Benchmark- und Optimierungsumgebung für die Gebirge. Läuft ohne KI; Netz nur beim einmaligen Bezug der Referenzdaten.
Ändert keine Kartendaten, keine Fassung (`config/terrain/aventuria/19.json`) und nichts auf Stage oder Production. Auftrag und Stand:
`project-control/work-items/WI-0250-terrain-lab.md`.

## Umgebung

Python aus der projektlokalen micromamba-Umgebung `C:\avesmaps3d-data\terrain-lab\env` (Rezept `environment.yml`: NumPy, SciPy, GDAL,
Matplotlib, Pillow, pytest), immer mit `-s` aufgerufen, damit keine Benutzerpakete hineinrutschen. Daten außerhalb des
Repositoriums unter `C:\avesmaps3d-data\terrain-lab` (überschreibbar mit `AVESMAPS_TERRAIN_LAB`). Höhenraster tauschen Python und
Generator im Format aus `terrainlab/raster.py` (Float32 plus JSON-Kopf).

## Runbook (Windows PowerShell)

Alle Befehle aus `C:\GIT\avesmaps3D\tools\terrain-lab`, Python immer als `& $py -s …`:

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"

# --- Umgebung und Tests ---------------------------------------------------------------------------------------------
& $py -s -m pytest                                              # alle Tests (einige Minuten; die Tests des echten Adapters brauchen Node)
& $py -s -m terrainlab --help                                   # alle Befehle

# --- Referenzkorpus (docs/referenzkorpus.md) --------------------------------------------------------------------------------
& $py -s -m terrainlab referenz liste                           # Ausschnitte mit Zustand
& $py -s -m terrainlab referenz pruefen                         # Manifest, Rezepte, Dateien, Prüfsummen; Exit 1 bei Abweichung

# --- Gelände-Kennzahlen (docs/deskriptoren.md) ---------------------------------------------------------------------------------
& $py -s -m terrainlab deskriptoren <raster.json> --json <ergebnis.json>      # 172 Kennzahlen, 23 Verteilungen, 4 Reihen
& $py -s -m terrainlab deskriptoren referenz.json --vergleich erzeugt.json    # Wasserstein-Abstand je Verteilung
& $py -s -m terrainlab deskriptoren --katalog                                 # Metrikkatalog

# --- Läufe: Generatoradapter, Performance, Qualität, Commit-Vergleich (docs/lauf.md) ------------------------------------------
& $py -s -m terrainlab lauf profile                                           # eingebaute Profile (schnell, basis, voll, qualitaet)
& $py -s -m terrainlab lauf perf schnell --commit HEAD                       # schneller Regressionslauf, rund 3 Minuten
& $py -s -m terrainlab lauf perf basis --commit HEAD                          # Basismessung, rund 10 Minuten
& $py -s -m terrainlab lauf perf voll --commit HEAD --schnappschuss <ordner>  # bewusst gestartet, rund eine Stunde, mit lokalem Endgelände
& $py -s -m terrainlab lauf qualitaet qualitaet --commit HEAD                # Metrikvektor je Fall, mit Zwischenspeicher
& $py -s -m terrainlab lauf vergleiche <commitA> <commitB> qualitaet          # Verbesserung/Regression je Kennzahl
& $py -s -m terrainlab lauf vergleiche <vor P2> <nach P2> konfig\lauf\p2-vergleich.json   # Regressionsprofil WI-0249 P2 (Blutzinnen, Trollzacken, Nordwalser), rund 1 Minute
& $py -s -m terrainlab lauf stand <commit>                                    # nur die Arbeitskopie zu einem Commit anlegen

# --- Optimierung der Typwerte (docs/optimierung.md) ------------------------------------------------------------------------
& $py -s -m terrainlab optimierung profile                                    # Profile unter konfig\
& $py -s -m terrainlab optimierung grenzen kettengebirge --commit HEAD        # Parameterraum aus den Verträgen des Generators
& $py -s -m terrainlab optimierung starten durchstich --trocken               # Plan und Grenzen
& $py -s -m terrainlab optimierung starten durchstich                         # neuer Lauf, rund 40 Minuten, nach <Labor>\optimierung\<zeit>-durchstich-<commit>
& $py -s -m terrainlab optimierung stand [<lauf>]                             # Stufen, Messungen, Verbrauch
& $py -s -m terrainlab optimierung stoppen <lauf>                             # Datei STOP: hält vor der nächsten neuen Rechnung an
& $py -s -m terrainlab optimierung fortsetzen <lauf>                          # nach STOP, Grenze oder Abbruch
& $py -s -m terrainlab optimierung vorschlag <lauf>                           # die Vorschläge (Vorschlagsdatei, nie eine Fassung)
& $py -s -m terrainlab optimierung nachmessen <vorschlagsdatei|lauf> --commit <neuer Stand>   # Vorschläge an einem geänderten Generator neu messen (ohne neue Suche)

# --- Bericht (docs/bericht.md) -----------------------------------------------------------------------------------------
& $py -s -m terrainlab bericht <lauf> [--perf <ordner>] [--vergleich <ordner>]   # eine statische HTML-Datei unter <Labor>\berichte\
```

Nur ein schwerer Lauf gleichzeitig (Sperre `<Labor>\laeufe\.lauf.sperre`); `lauf …` und `optimierung …` rechnen am **festgelegten Commit** (`--commit`, im Profil `commit`), nie an einem
halb veränderten Arbeitsbaum. Die Daten liegen außerhalb des Repositoriums unter `C:\avesmaps3d-data\terrain-lab` (`referenz`, `cache`, `staende`, `laeufe`, `optimierung`, `berichte`).

## Dokumentation

| Dokument                 | Inhalt                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `docs/referenzkorpus.md` | 22 reale Geländeausschnitte, Quellen, Lizenzen, Aufbereitung                                                        |
| `docs/deskriptoren.md`   | Katalog der Gelände-Kennzahlen, Definitionen, Kosten, Grenzen                                                       |
| `docs/lauf.md`           | Adapter, Aufträge, Performance, Qualität, Zwischenspeicher, Commit-Vergleich, Basismessung                          |
| `docs/optimierung.md`    | Bewertung in drei Dimensionen, Formtor, Parameterraum, Stufen, Validierung, Strategien, Vorschlagsdatei, Durchstich |
| `docs/bericht.md`        | der statische HTML-Bericht                                                                                          |
| `vorschlaege/`           | versionierte Vorschlagsdateien der Optimierung (Typ → Werte, Commit, Begründung; nie eine Fassung)                  |
