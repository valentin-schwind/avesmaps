# Sprachenkarte: von der Referenzkarte zu den Sprachflächen (WI-0261)

Werkzeugkette, die aus der Referenzkarte „DSA Aventurische Sprachen“ die elf Sprachflächen für Avesmaps3D ableitet. Sie ändert keine Kartendaten.
Das Ergebnis `sprachen-s1.geojson` spielt `npm run migrate:sprachen` ein (WI-0261 S6, `apps/server/src/migration/sprachen-import.ts`).

## Herkunft

- **Referenzkarte:** „DSA Aventurische Sprachen“ (Karte Steffen Brand, 2026), PDF-Download aus dem Ulisses-eBook-Shop, Produkt 584605. Sie gehört zum normalen
  Kartenpaket von Ulisses (WI-0261 E0, geklärt 2026-10-30).
- **Format:** Das PDF trägt ein einziges JPEG, 5385 × 7610 px, keine Vektoren. Elf flache Legendenfarben; eine 45°-Schraffur zweier Sprachen (Abstand
  etwa 20 px) ist ein Mischgebiet, Hellgrau heißt „ohne Angabe“.
- **Einpassung:** 99 Ortsmarken gegen die Orte der Karte, rein affin: mittlere Abweichung 0,6 Karteneinheiten (E, etwa 2 Meilen), höchstens 1,7. Thin-Plate-Spline
  verbessert die Kreuzvalidierung nicht (`einpassen.py` zeigt es).

## Keine Daten im Repository

PDF, Bilder, `label.npy`, GeoJSON und die Passpunktlisten liegen **nie** hier, sondern im Arbeitsordner außerhalb des Repositoriums, zum Beispiel
`C:\avesmaps3d-data\work\sprachen-20261030\` (unten `<ao>`). Die Skripte lesen und schreiben flach in diesem Ordner; alle außer `pdfscan.py`, `extract.py`,
`crop.py` und `farben.py` nehmen ihn als erstes Argument.

## Umgebung

- **Python 3.10** mit `numpy`, `opencv-python`, `shapely`, `scipy`, `Pillow` (die Stände der Ableitung vom 2026-10-30: numpy 2.2.6, OpenCV 4.10.0, Shapely 2.1.2,
  SciPy 1.15.3, Pillow 11.3.0; andere Stände von Shapely/GEOS können die Ränder um Bruchteile verschieben). Aufruf immer isoliert:
  `py -3.10 -I <skript> …`. Die Python-Dateien prüfen weder ESLint noch Prettier.
- **Lokaler Server** (`npm run dev`, Fastify auf Port 3000) für `passpunkte.py` (Ortssuche), `je-sprache.py` und `ueberlagern.py` (Rasterkacheln), nur lesend.
  Eine andere Adresse steht in `AVESMAPS_API` (Vorgabe `http://127.0.0.1:3000`).
- **Node** für `wasser.mjs`: liest mit EINEM `SELECT` die Wasserflächen aus der Datenbank von `DATABASE_URL` (lokal) und schreibt nichts.

## Reihenfolge

Eingaben und Ausgaben liegen in `<ao>`; `<pdf>` und die Zwischenbilder dürfen anderswo liegen.

| Nr. | Schritt                                  | Aufruf                                                                       | Liest                                         | Schreibt                                                         |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 1   | PDF ansehen (optional)                   | `pdfscan.py <pdf>`                                                           | PDF                                           | nur Ausgabe: ein JPEG, keine Vektoren                            |
| 2   | JPEG aus dem PDF ziehen                  | `extract.py <pdf> <roh.jpg> <ao>/karte.png <vorschau.png>`                   | PDF                                           | `karte.png` (Vollauflösung), Vorschau auf ein Viertel            |
| 3   | Legendenfarben (optional)                | `farben.py <ao>/karte.png`                                                   | `karte.png`                                   | nur Ausgabe: RGB der elf Felder, häufigste Farben                |
| 4   | Ausschnitt ansehen (Hilfe)               | `crop.py <bild> <ausgabe> x0 y0 x1 y1 [massstab]`                            | ein Bild                                      | ein Bild                                                         |
| 5   | Ortsmarken finden                        | `punkte.py <ao>`                                                             | `karte.png`                                   | `punkte.json`, `teil-nw/no/mw/mo/sw/so.jpg` (mit Nummern)        |
| 6   | Passpunkte lesen (von Hand)              | `tools/sprachenkarte/passpunkte-roh.txt` nach `<ao>/` kopieren (Format unten) | die Teilbilder                                | `passpunkte-roh.txt`                                             |
| 7   | Passpunkte an unsere Orte binden         | `passpunkte.py <ao>`                                                         | `passpunkte-roh.txt`, `punkte.json`, Server   | `passpunkte.json`                                                |
| 8   | Einpassung prüfen                        | `einpassen.py <ao>`                                                          | `passpunkte.json`                             | nur Ausgabe: Rest je Punkt, Kreuzvalidierung affin gegen TPS     |
| 9   | Pixel → Klasse                           | `klassen.py <ao> [fenster=25]`                                               | `karte.png`                                   | `label.npy`, `klassen.json`, `vorschau.png`                      |
| 10  | Klassen als GeoJSON (Probe, optional)    | `vektor.py <ao>`                                                             | `label.npy`, `klassen.json`, `passpunkte.json` | `sprachen-karte.geojson`, `sprachen-lnglat.geojson`              |
| 11  | Überlagerung prüfen (optional)           | `ueberlagern.py <ao> <name> <z> <xmin> <xmax> <ymin> <ymax> [breite]`        | `sprachen-karte.geojson`, Server              | `ueber-<name>.jpg`                                               |
| 12  | Wasserflächen holen                      | `node --env-file-if-exists=.env tools/sprachenkarte/wasser.mjs <ao>/wasser.geojson` (Wurzel) | Datenbank (nur lesend)         | `wasser.geojson`                                                 |
| 13  | **S1: Flächen je Sprache**               | `s1-ableitung.py <ao> [mindest_e2=0.5]`                                      | `label.npy`, `klassen.json`, `passpunkte.json`, `wasser.geojson` | **`sprachen-s1.geojson`**, Bericht auf der Ausgabe |
| 14  | Grundkarte für das Sichtbild             | `je-sprache.py <ao>`                                                         | `label.npy`, `passpunkte.json`, Server        | `grundkarte-z3.jpg/.json`, `sprachen-je-sprache.geojson` (erste Fassung, überholt) |
| 15  | Sichtbild der Ableitung                  | `s1-bild.py <ao>`                                                            | `sprachen-s1.geojson`, `grundkarte-z3.*`      | `s1-gesamt.jpg`, `s1-svellt.png`, `s1-sicheln.png`, `s1-mhanadi.png` |
| 16  | Einspielen                               | `npm run migrate:sprachen -- --source <ao>/sprachen-s1.geojson` (siehe unten) | `sprachen-s1.geojson`                         | Datenbank, nur mit Freigabe                                      |

Format von `passpunkte-roh.txt`: eine Zeile je Ortsmarke, `teil|ortsname|x|y`. `teil` ist das Teilbild aus Schritt 5 (`nw`, `no`, `mw`, `mo`, `sw`, `so`), `x` und `y` sind
Pixel in diesem Teilbild (1400 px breit), von Hand abgelesen (Beispiel: `no|Glyndhaven|418|482`). `passpunkte.py` rastet jede Zeile auf die nächste gefundene Ortsmarke
ein (bis 25 px) und holt die Koordinaten des Ortes mit dem Namen aus `/api/search` (bei mehreren der größte).

## Parameter

**Klassen (`klassen.py`):** Halbauflösung (Fenster 25 px, rund 2,5 Streifenperioden); Mischgebiet ab Anteil 0,22 der zweiten Sprache. Das Meer wird nicht über die
Küstenlinie geflutet (sie hat Lücken), sondern vom Bildrand über meerartige Pixel (`min(R,G,B) ≥ 175` und `R−B ≤ 20`; das Hellgrau „ohne Angabe“ hat R−B ≈ 24).
Tinte unter `max(R,G,B) < 70` (Orkisch (96, 76, 52) ist selbst dunkel); Pixel bis 4 px um Tinte gelten als unsicher und bekommen die nächste sichere Klasse. Schmale
Mischsäume an reinen Grenzen fallen per Öffnung weg.

**S1 (`s1-ableitung.py`, WI-0261 E3, T-4):**

| Parameter                 | Wert                                                       | Wirkung                                                                                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Glättung R                | 0,6 E (etwa 2 Meilen)                                      | Schließen und Öffnen: runde Ecken der Mischgebiete, reine Grenzen kaum berührt                   |
| Enklaven                  | ab 0,5 E² (zweites Argument, Vorgabe 0,5)                  | kleinere Teilflächen entfallen (E3 Empfehlung A: alle Enklaven behalten; B wäre 2 E²)            |
| Löcher                    | unter 2 E² werden geschlossen, wenn keine andere Sprache sie füllt | Reste verworfener Pixelinseln                                                             |
| Meer                      | nur gegen `region_type = 'meer'` geschnitten, nie gegen Seen | T-4: Seen hätten jeder Sprachfläche Hunderte Löcher gegeben; die Zeichnung legt das Wasser darüber |
| Säume                     | eine Sprache ragt in die reine Fläche einer anderen nur, wo die Karte beide mischt (Puffer 2 R) | kein Glättungssaum über reinem Gebiet                                  |
| Vereinfachung             | 0,15 E                                                     | weniger Stützpunkte                                                                              |

Ergebnis der Ableitung vom 2026-10-30: 11 MultiPolygone, 527 Teilflächen, 27 023 Stützpunkte, 168 Löcher, alle gültig, SHA-256 beginnt mit `e0619e909dcc`; 81 % des Landes im
Ausschnitt tragen eine Sprache, der Rest ist vor allem „ohne Angabe“ (Khôm, Hochgebirge, Yeti-Land). Zwischen zwei reinen Nachbarn bleibt stellenweise ein Haarspalt unter 0,3 E.

## Einspielen (S6)

`sprachen-s1.geojson` hat elf Features (`properties.sprache` = Schlüssel der Farbtafel aus `apps/server/src/migration/sprachen-karte.ts`, `name`, `farbe`; Geometrie MultiPolygon
in Kartenkoordinaten 0 bis 1024, SRID 0).

```powershell
# Probelauf (Vorgabe): liest, rechnet den Bericht, schreibt nichts (Transaktion zurückgerollt); --json für den Bericht als JSON
npm run migrate:sprachen -- --source <ao>\sprachen-s1.geojson
# Schreiblauf: nur mit dem Zuruf des Betreibers für GENAU diese Datenbank (Map Mutation Guard)
npm run migrate:sprachen -- --source <ao>\sprachen-s1.geojson --operator-said "<Zitat des Betreibers>"
```

Der Import legt fehlende Sprachen an und lässt vorhandene unverändert (T-2), spielt die Flächen idempotent ein (T-1: gleiche Datei ändert nichts, neue Datei legt die Flächen
der Herkunft `sprachenkarte` still und neu an, Flächen der Redaktion bleiben), ordnet Wiki-Artikel zu, die noch keiner Sprache gehören, und reiht danach den Auftrag
„Treffer neu rechnen“ ein. Stage und Production laufen über Claudio, je Umgebung mit eigener Freigabe.
