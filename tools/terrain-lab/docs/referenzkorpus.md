# Referenzkorpus realer Geländemodelle (WI-0250, Phase A1)

Ein kleiner, nachvollziehbarer Satz realer Geländeausschnitte als Maßstab für die Deskriptoren (A2), den Qualitätsvergleich, die
Optimierung und die Berichte des Terrain-Labs. Alles hier läuft lokal und ohne KI; nur der einmalige Bezug der Rohdaten braucht Netz.

**Reale Koordinaten gelten ausschließlich in der Referenz.** Sie stehen im Manifest und in den Rasterköpfen unter `herkunft`, werden aber nie
in den aventurischen Kartenraum übertragen. Die Ausschnitte dienen nur dem Vergleich von Form, Verteilung und Statistik.

## Maßstab

Avesmaps rechnet in Karteneinheiten, 1 E = 3000 m. Alle Ausschnitte liegen deshalb in den Zielmaßstäben der Gebirgsvorschau vor:

| Stufe    | Zellgröße | Verwendung                                                       | Herstellung                            |
| -------- | --------- | ---------------------------------------------------------------- | -------------------------------------- |
| `30m`    | 30 m      | Arbeitsstufe für Feinmetriken (Kämme, Täler, Hydrologie)         | Flächenmittel aus der Quelle (GDAL)    |
| `187_5m` | 187,5 m   | Vorschau 4×, feines Gelände (375 m: 2×)                          | Flächenmittel aus der Quelle (GDAL)    |
| `375m`   | 375 m     | Vorschau 2×, feines Gelände                                      | exaktes 2×2-Blockmittel von `187_5m`   |
| `750m`   | 750 m     | Vorschau 1×, Gebirgssaat, grobes Gelände                         | exaktes 4×4-Blockmittel von `187_5m`   |

Jeder Ausschnitt ist 60 km × 48 km groß (2880 km²), die Kanten liegen auf Vielfachen von 750 m im metrischen Ziel-CRS. Das ergibt 80 × 64
Zellen bei 750 m, 160 × 128 bei 375 m, 320 × 256 bei 187,5 m und 2000 × 1600 bei 30 m. Höhen sind Meter, die Zellgröße steht in Metern im Kopf
jedes Rasters (`terrainlab.raster`: Float32, Nord nach Süd, JSON-Kopf mit SHA-256). NoData ist immer NaN.

## Aufbau

| Was                                                  | Wo                                                                        | In Git |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| Manifest (Beschreibung, Lizenz, Typ, Rolle, Prüfsummen) | `tools/terrain-lab/referenz/manifest.json`                                 | ja     |
| Rezept je Ausschnitt (Quelle, Fenster, Stufen)        | `tools/terrain-lab/referenz/rezepte/<id>.json`                            | ja     |
| Rohdaten (Fenster aus der Quelle, unverändert)        | `C:\avesmaps3d-data\terrain-lab\referenz-roh\<id>\quelle.tif`             | nein   |
| Aufbereitete Raster (vier Stufen) und Schummerungsbild | `C:\avesmaps3d-data\terrain-lab\referenz\<id>\<stufe>.f32 / .json / .png` | nein   |

Die Datenwurzel ist `AVESMAPS_TERRAIN_LAB` oder `C:\avesmaps3d-data\terrain-lab`. Pfade im Manifest sind relativ dazu.

Das **Rezept** ist die maschinenlesbare Anleitung (Quelle, Zielfenster, Ziel-CRS, Stufen, NoData-Regel). Das **Manifest** beschreibt und
belegt: Herkunft (Region, Bounding Box im Quell-CRS und Zielfenster), Quelle mit Lizenz und Link, DTM/DSM mit Begründung, horizontale und
vertikale Einheiten samt Bezugssystem, ursprüngliche Auflösung, Abmessungen, Gebirgstyp, Aufbereitungsschritte (aus dem Rezept erzeugt),
SHA-256 der Rohdatei (Datei und Inhalt) und jedes Zielrasters, NoData-Anteil und Höhenbereich je Stufe, Rolle (Optimierung oder Validierung).

## Befehle (Windows PowerShell)

```powershell
cd C:\GIT\avesmaps3D\tools\terrain-lab
$py = "C:\avesmaps3d-data\terrain-lab\env\python.exe"

& $py -s -m terrainlab referenz liste                       # Ausschnitte mit Zustand (Rohdaten, Raster)
& $py -s -m terrainlab referenz pruefen                     # Manifest gegen Rezepte, Dateien, Prüfsummen; Exit 1 bei Abweichung
& $py -s -m terrainlab referenz pruefen --nur-manifest      # ohne Datenzugriff (Schema, Rezeptbezug, Maße, Schritte)
& $py -s -m terrainlab referenz pruefen --tief              # zusätzlich die Rohrasterköpfe über GDAL
& $py -s -m terrainlab referenz pruefen --ohne-roh          # Rohdateien übergehen (nur Raster lokal vorhanden)
& $py -s -m terrainlab referenz aufbereiten kettengebirge-ch-bern   # offline: Rohdaten -> vier Stufen, Vergleich mit dem Manifest
& $py -s -m terrainlab referenz vorschau --alle             # Schummerung (PNG) neben die Raster legen
& $py -s -m terrainlab referenz holen kettengebirge-ch-bern # einmaliger Bezug mit Netz; ohne --erneut nur, wenn lokal nichts passt
```

- `holen` und `aufbereiten` ändern das Manifest nur mit `--manifest-aktualisieren`; sonst melden sie nur, was sie eintragen würden.
  Danach das Manifest mit `npm exec prettier -- --write tools/terrain-lab/referenz` (aus der Repository-Wurzel) formatieren lassen, falls
  jemand es von Hand ändert; das Werkzeug schreibt es selbst prettier-fest.
- `aufbereiten` prüft zuerst die SHA-256 der Rohdatei gegen das Manifest und meldet am Ende je Stufe „reproduziert“ (Prüfsumme gleich),
  „neu“ oder „WEICHT vom Manifest ab“ (Exit 1). Die Rasterprüfsummen hängen von den Versionen von GDAL und NumPy ab (steht im Manifest unter
  `aufbereitung.werkzeug`); ein Versionssprung kann sie ändern, ohne dass sich die Werte merklich ändern.
- `pruefen` meldet jede Abweichung als FEHLER (Exit 1): fehlendes oder verändertes Rezept, fehlende oder veränderte Rohdatei, fehlendes
  oder verändertes Raster, falsche Maße oder Zellgröße, andere Einheit als Meter, Höhen außerhalb −500 bis 9000 m, NoData-Anteil über 1 %,
  anderer NoData-Anteil oder Höhenbereich als im Manifest. Fehlende Optimierungs- oder Validierungsausschnitte eines Typs sind nur ein Hinweis.
- `fenster` berechnet für ein neues Rezept ein Zielfenster auf dem 750-m-Netz:
  `referenz fenster --crs utm-nad83 --mitte -86.0 37.1 --breite-km 60 --hoehe-km 48`.

Tests ohne Netz und ohne die echten Daten (synthetische GeoTIFFs: NoData, Reprojektion, Resampling, Prüfsummen, Prüffälle):

```powershell
& $py -s -m pytest tests/test_referenz_aufbereitung.py tests/test_referenz_pruefen.py tests/test_referenz_befehle.py
```

## Aufbereitung im Einzelnen

1. **Bezug (`holen`):** GDAL öffnet die Quelle über `/vsicurl/` (Cloud-Optimized GeoTIFF), überträgt das metrische Zielfenster in das CRS der
   Quelle, nimmt acht Quellzellen Rand dazu und schreibt genau dieses Pixelfenster ungeändert als `quelle.tif` (Float32, DEFLATE, Prädiktor 3).
   Es gibt keine Neuberechnung der Werte. Das Manifest hält die SHA-256 der Datei, die SHA-256 über die Float32-Werte (unabhängig von der
   Kompression), den HTTP-Kopf der Quelle (Last-Modified, ETag) und das Bezugsdatum fest.
2. **Reprojektion:** Liegt die Quelle in Länge/Breite (3DEP, NAD83), wird beim Aufbereiten in die UTM-Zone des Ausschnitts (NAD83, EPSG:269zz)
   umgerechnet. Die Schweizer Quelle liegt schon in LV95 (EPSG:2056, Meter) und wird nicht umgerechnet.
3. **Stufen `30m` und `187_5m`:** `gdalwarp -r average` auf das Zielfenster: Mittelwert über die Fläche jeder Zielzelle, teilweise überdeckte
   Quellzellen anteilig gewichtet. Das ist Mittelwert-Resampling, kein Herausgreifen einzelner Punkte, und erhält den Mittelwert der Höhe.
4. **NoData:** Der NoData-Wert der Quelle (swisstopo 3,4e38, USGS −999999) wird beim Mitteln ausgelassen und im Ergebnis zu NaN. Zellen, deren
   Quellzellen alle NoData sind, werden NaN. Die gewählten Fenster enthalten keine NoData-Zellen (alle Stufen 0 %).
5. **Stufen `375m` und `750m`:** exakte 2×2- und 4×4-Blockmittel der Stufe `187_5m` (Mittel der gültigen Zellen, NaN bei weniger als 50 %
   gültigem Anteil). So sind die drei groben Stufen genau deckungsgleich verschachtelt.
6. **Nicht getan:** keine Glättung, keine Senkenfüllung, keine Höhenkorrektur, kein Zuschneiden von Wasserflächen. Seen und Stauseen sind in
   den Quellen eingeebnet und erscheinen als ebene Flächen.

## Ausschnitte

Maßgeblich ist das Manifest; `referenz liste` zeigt den Zustand. Stand 2026-10-23:

| Kennung | Typ | Rolle | Region | Quelle | Fläche | Rohdaten | Raster |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kettengebirge-ch-bern` | kettengebirge (gratgebirge) | optimierung | Schweizer Alpen: Berner Alpen und Oberwallis | swissALTIRegio 10 m | 60 × 48 km | 65 MB | 13 MB |
| `kettengebirge-ch-glarus` | kettengebirge | validierung | Schweizer Alpen: Glarner Alpen und Surselva | swissALTIRegio 10 m | 60 × 48 km | 66 MB | 13 MB |
| `karst-us-kentucky` | karst | optimierung | Zentral-Kentucky: Mammoth Cave und Pennyroyal-Dolinenebene | 3DEP 1/3″ (10 m) | 60 × 48 km | 82 MB | 13 MB |
| `karst-us-guadalupe` | karst | validierung | Guadalupe Mountains, Texas und New Mexico | 3DEP 1/3″ (10 m) | 60 × 48 km | 65 MB | 13 MB |
| `massengebirge-us-olympic` | massengebirge (kettengebirge) | optimierung | Olympic-Halbinsel, Washington | 3DEP 1/3″ (10 m) | 60 × 48 km | 93 MB | 13 MB |
| `massengebirge-us-adirondack` | massengebirge | validierung | Adirondack Mountains, New York | 3DEP 1/3″ (10 m) | 60 × 48 km | 87 MB | 13 MB |
| `rumpfgebirge-us-smokies` | rumpfgebirge | optimierung | Südliche Appalachen, Tennessee und North Carolina | 3DEP 1/3″ (10 m) | 60 × 48 km | 82 MB | 13 MB |
| `rumpfgebirge-us-green` | rumpfgebirge | validierung | Nördliche Appalachen, Vermont | 3DEP 1/3″ (10 m) | 60 × 48 km | 93 MB | 13 MB |
| `bergland-us-westvirginia` | bergland | optimierung | Allegheny-Plateau, West Virginia | 3DEP 1/3″ (10 m) | 60 × 48 km | 81 MB | 13 MB |
| `bergland-us-ozark` | bergland | validierung | Ozark-Hochland, Missouri | 3DEP 1/3″ (10 m) | 60 × 48 km | 82 MB | 13 MB |
| `plateaugebirge-us-aquarius` | plateaugebirge | optimierung | Colorado-Plateau, Utah | 3DEP 1/3″ (10 m) | 60 × 48 km | 69 MB | 13 MB |
| `plateaugebirge-us-roan` | plateaugebirge | validierung | Colorado-Plateau, Colorado | 3DEP 1/3″ (10 m) | 60 × 48 km | 81 MB | 13 MB |
| `inselberg-us-wichita` | inselberg | optimierung | Wichita Mountains, Oklahoma | 3DEP 1/3″ (10 m) | 60 × 48 km | 71 MB | 13 MB |
| `inselberg-us-llano` | inselberg | validierung | Llano Uplift, Texas | 3DEP 1/3″ (10 m) | 60 × 48 km | 69 MB | 13 MB |
| `gratgebirge-us-cascades` | gratgebirge (kettengebirge) | optimierung | North Cascades, Washington | 3DEP 1/3″ (10 m) | 60 × 48 km | 98 MB | 13 MB |
| `gratgebirge-us-sawtooth` | gratgebirge | validierung | Sawtooth Range, Idaho | 3DEP 1/3″ (10 m) | 60 × 48 km | 84 MB | 13 MB |
| `kammgebirge-us-sierra` | kammgebirge | optimierung | Sierra Nevada, Kalifornien | 3DEP 1/3″ (10 m) | 60 × 48 km | 74 MB | 13 MB |
| `kammgebirge-us-wasatch` | kammgebirge | validierung | Wasatch Range, Utah | 3DEP 1/3″ (10 m) | 60 × 48 km | 74 MB | 13 MB |
| `kuppengebirge-us-henry` | kuppengebirge | optimierung | Henry Mountains, Utah | 3DEP 1/3″ (10 m) | 60 × 48 km | 75 MB | 13 MB |
| `kuppengebirge-us-montana` | kuppengebirge | validierung | Zentral-Montana: Judith, Moccasin und Little Snowy Mountains | 3DEP 1/3″ (10 m) | 60 × 48 km | 81 MB | 13 MB |
| `schild-us-boundarywaters` | schild | optimierung | Kanadischer Schild, Nordost-Minnesota | 3DEP 1/3″ (10 m) | 60 × 48 km | 81 MB | 13 MB |
| `schild-us-michigan` | schild (rumpfgebirge) | validierung | Kanadischer Schild, Oberhalbinsel von Michigan | 3DEP 1/3″ (10 m) | 60 × 48 km | 88 MB | 13 MB |
| Summe | | | | | | 1741 MB | 291 MB |

Alle elf Avesmaps-Gebirgstypen (`packages/shared/src/gebirge/regler.ts`) sind vertreten, jeder mit einem Optimierungs- und einem
Validierungsausschnitt (`paarung`); ein Test hält die Typliste des Manifests und des TypeScript-Codes gleich. Der Auftrag nannte zuerst
Kettengebirge und Karst, dann Massengebirge, Bergland, Plateau und Inselberg; Rumpfgebirge, Gratgebirge, Kammgebirge, Kuppengebirge und
Schild kamen als Zugabe dazu. Bei diesen fünf ist die Typzuordnung am wenigsten eindeutig (sie folgt dem Formenbild, nicht einer
Fachdefinition); bei Schild liegen die Fenster nur am Südrand des Kanadischen Schilds, Seen sind eingeebnet.

**Datenmenge.** Auf der Platte liegen rund 1,7 GB Rohdaten und 0,3 GB Raster. Der Netzbezug war größer: Die Quellen sind LZW-komprimierte
Float32-COGs (kaum komprimierbar), die Fenster des Korpus kosteten zusammen rund 2,75 GB; dazu kamen rund 1,2 GB für Erkundungs- und
Ersatzfenster, die verworfen wurden (Schweizer Vergleichsfenster, drei Karstkandidaten, zwei Schild-Fenster an der kanadischen Grenze, ein
verschobenes Plateau-Fenster). Insgesamt flossen also rund 4 GB. Wer Platz braucht, kann die Rohdaten jedes Ausschnitts löschen: Die
aufbereiteten Raster genügen für alle Vergleiche; `referenz pruefen --ohne-roh` übergeht die Rohdateien, `referenz holen` holt sie wieder.

Die Zuordnung zu den Typen ist eine fachliche Näherung: reale Gebirge sind selten rein; `typ_weitere` nennt Nebenmerkmale. Sie ist Sache
der Anwender des Korpus und kann im Manifest geändert werden (Typ, Rolle, Paarung). Rolle `kontrolle` ist für Ausschnitte vorgesehen, die weder
optimiert noch validiert werden (derzeit keiner).

Lesender Zugriff aus anderem Python-Code des Labs:

```python
from terrainlab.referenz.korpus import ausschnitte, lade_raster

for eintrag in ausschnitte(typ="karst", rolle="validierung"):
    raster = lade_raster(eintrag["id"], "187_5m")   # Hoehenraster: Meter, NaN = NoData, Zellgröße in Metern
```

## Quellen und Lizenzen

| Quelle                                                               | Produkt                                | Lizenz                                                                                    | Verwendet |
| -------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| swisstopo, [swissALTIRegio](https://www.swisstopo.admin.ch/de/hoehenmodell-swissaltiregio) | DTM 10 m, COG, LV95, Höhen LN02      | [swisstopo: Nutzungsbedingungen für kostenlose Geodaten](https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste): Nutzung, Weitergabe, Bearbeitung, auch kommerziell; Quellenangabe Pflicht | ja        |
| USGS, [3DEP](https://www.usgs.gov/3d-elevation-program), 1/3 Bogensekunde | Bare-Earth-DEM 10 m, COG, NAD83, NAVD88 | Public Domain, ohne Nutzungsbeschränkung; Nennung des USGS erwünscht                       | ja        |
| swisstopo, swissALTI3D                                               | DTM 0,5 m und 2 m, 1-km-Kacheln        | wie swissALTIRegio                                                                        | nein (siehe unten) |
| Slowenien, ARSO Lidar und GURS DMV                                   | 1 m (ARSO), 5 und 12,5 m (GURS)        | GURS: CC BY 4.0; ARSO: nur E-Mail-Auskunft, keine förmliche Lizenz                         | nein (siehe unten) |
| Argudo et al. 2025, [Terrain Descriptors …](https://doi.org/10.1111/cgf.70080), [Repository](https://github.com/oargudo/terrain-descriptors) | Code (MIT) und Beispielgelände (ZIP, 152 MB) | Code MIT; für die Geländedaten steht keine Lizenz im Repository | nein (siehe unten) |

**Quellenangaben für Veröffentlichungen.** swisstopo: „Bundesamt für Landestopografie swisstopo“; für swissALTIRegio gilt die abweichende
Angabe der Produktseite (ab Edition 2025 mit den ausländischen Quellen, die für Fenster außerhalb der Schweiz einschlägig wären; die
gewählten Fenster liegen vollständig in der Schweiz und sind swissALTI3D). USGS: „U.S. Geological Survey, 3D Elevation Program (3DEP)“.

### Warum swissALTIRegio statt swissALTI3D

swissALTI3D (2 m, 1 km² je Kachel, rund 1 MB je 2-m-Kachel) hätte für ein Fenster von 60 km × 48 km rund 2900 Kacheln und etwa 3 GB bedeutet,
mehr als das Gesamtvolumen des Korpus (Vorgabe: unter 3 GB). Das amtliche gröbere Modell swissALTIRegio (10 m) ist in der Schweiz aus swissALTI3D
abgeleitet, liegt als ein einziges COG vor und lässt sich fensterweise lesen; 10 m reichen für Stufen ab 30 m. Die Fenster liegen
vollständig in der Schweiz (geprüft gegen swissBOUNDARIES3D über die swisstopo-API, Raster 2 bis 3 km), damit keine eingekauften ausländischen
Quellen mit anderer Genauigkeit einfließen (swissALTIRegio nutzt außerhalb der Schweiz TINITALY, DGM Österreich, DGM1 Bayern, RGEAlti u. a.,
teils hochgerechnet).

### Slowenien (Karst): nicht großflächig beziehbar

Bevorzugt war ein slowenisches Karstgebiet (Dolinen, Poljen, Plateaus). Geprüft am 2026-10-23:

- **ARSO Lidar DMR 1 m** (gis.arso.gov.si, Kacheln `TM1_<E>_<N>.txt`): eine 1-km²-Kachel ist 28 MB (ASCII); ein Fenster von 60 km × 48 km wären
  rund 2900 Kacheln und etwa 80 GB. Die Lizenz ist nur als E-Mail-Auskunft der Behörde belegt (kostenlose Nutzung, Quellenangabe), eine förmliche
  Lizenz fehlt. Die ASCII-Dateien haben vertauschte X/Y-Spalten und lassen sich nicht unmittelbar mit GDAL öffnen.
- **GURS DMV 5 m und 12,5 m** (Lizenz CC BY 4.0, ohne Registrierung): nur über die Anwendung „Javni geodetski podatki“
  (ipi.eprostor.gov.si/jgp), Blattweise (TTN-5-Blätter, 3258 Blätter für Slowenien) im ASCII-Format Y X H. Ein dokumentierter
  Massen- oder Dienstbezug (WCS, Atom) wurde nicht gefunden; geratene Dienst-Adressen lieferten 404. Auch die Lidar-Daten 2023 bis 2025 über den
  3D-Viewer (clss.si, .laz, höchstens zehn Kacheln je Download, kein Lizenztext auf der Seite) sind kein Massenbezug.
- **Ausweichgebiet:** ein US-Karstgebiet aus 3DEP (Kentucky als Dolinenebene und Plateau, Guadalupe Mountains als verkarstetes Riffkalk-Massiv).
  Beide decken Dolinen und Karstplateau ab, nicht aber Poljen und den dinarischen Formenschatz.
- **Nachrüsten:** Wer einige GURS-DMV-12,5-m-Blätter von Hand über die Anwendung lädt, kann sie als GeoTIFF (EPSG:3794) ablegen und ein Rezept
  mit `"art": "lokal"` anlegen; `referenz holen` erfasst dann nur die Prüfsummen und `referenz aufbereiten` läuft wie bei den anderen. Die
  ASCII-Spalten müssen vorher nach X Y Z getauscht und mit `gdal_translate` in ein GeoTIFF überführt werden.

### Argudo et al. (2025): Beispielgelände nicht aufgenommen

Das Repository liefert Beispielgelände (`terrains-presets.zip`, 152 MB, Beschreibung in `presets.txt`). Die meisten sind SRTM-Daten mit rund 90 m
(Oberflächenmodell, kein Geländemodell), einzelne hochaufgelöste Gelände stammen von ICGC, CNIG, swissALTI3D und USGS NED. Zu den Geländedaten
steht im Repository keine Lizenz; SRTM ist ein DSM. Sie sind daher nicht Teil des Korpus. Für die Prüfung der Deskriptor-Implementierung
(A2) können sie lokal ergänzend dienen, aber nie als Referenz für Optimierung oder Validierung.

## Grenzen und Fallen

- **Typzuordnung:** Reale Gebirge sind Mischformen. Ein Typ steht für das vorherrschende Formenbild des Fensters, nicht für eine Eigenschaft
  des ganzen Gebirges.
- **Quellqualität 3DEP:** Das Seamless-DEM 1/3″ ist ein Bare-Earth-Modell, überwiegend aus Lidar. Welche Teile eines Fensters aus Lidar und welche
  aus älteren NED-Quellen stammen, wurde nicht Fenster für Fenster geprüft (Folgearbeit: 3DEP-Quellenindex WESM).
- **Wasserflächen:** Seen und Flüsse sind eingeebnet; große Seen (Thuner See, Brienzer See, Stauseen) erscheinen als Ebenen und beeinflussen
  Höhenverteilung und Hangstatistik. Für Metriken, die das stört, Wasserflächen maskieren.
- **Zellgröße gegen Quellauflösung:** Die Stufe 30 m ist aus 10-m-Quellen gemittelt, nicht feiner erfasst. Dolinen unter 100 m
  Durchmesser sind bei 187,5 m und gröber nicht mehr sichtbar, nur in `30m`.
- **Höhenbezug:** LN02 (Schweiz) und NAVD88 (USA) unterscheiden sich um Dezimeter bis Meter von anderen Bezugsflächen; für Formvergleiche
  ohne Belang.
- **Verfügbarkeit:** `current` im USGS-Ordner ändert sich mit neuen Befliegungen. Bezogene Fenster bleiben gültig (Prüfsumme im Manifest);
  ein erneuter Bezug mit `--erneut` meldet, wenn der Inhalt der Quelle sich geändert hat.

## Neuen Ausschnitt anlegen

1. `referenz fenster …` für das Zielfenster, ein Rezept `referenz/rezepte/<id>.json` schreiben (Muster: ein vorhandenes Rezept; bei 3DEP die
   Kacheln `nXXwYYY`, die das Fenster samt Rand berühren, in `urls`).
2. Im Manifest einen Eintrag mit den Stammdaten anlegen (Bezeichnung, Typ, Geomorphologie, Rolle, Paarung, Region, Quelle samt Lizenz).
3. `referenz holen <id> --manifest-aktualisieren`, `referenz aufbereiten <id> --manifest-aktualisieren`, `referenz vorschau <id>` ansehen,
   `referenz pruefen`.
4. Rezepte und Manifest in den Commit; die Daten bleiben außerhalb des Repositoriums.
