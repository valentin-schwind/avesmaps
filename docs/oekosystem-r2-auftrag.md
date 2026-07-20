# Ökosystem R2 — Erste Geometrie

> **🔴 Die härteste Regel dieses Vorhabens, vom Owner:**
>
> **Die politische Karte und die Territorien werden weder angetastet noch
> verändert. Erlaubt ist ausschließlich, die Werkzeuge von dort zu KOPIEREN.**
>
> Kein politisches File wird zum Bearbeiten geöffnet. Kein politisches File wird
> zur Laufzeit aufgerufen. Auch nicht die „reine Mathematik" — ein Aufruf koppelt
> in die Gegenrichtung, und wer später eine Boolean-Funktion für die Politik
> anpasst, ändert damit still das Ökosystem mit.
>
> Die Vorlagen werden **gelesen und abgeschrieben**, nicht wiederverwendet.

## 1. Was das für den Zuschnitt bedeutet

Ein früherer Entwurf dieses Dokuments wollte die gemeinsamen Zeichenwerkzeuge
*parametrisieren* — ein Entitäts-Deskriptor, acht Nahtstellen, rund 500 Zeilen
umgebaut. **Das ist gestrichen.** Damit entfällt auch die ganze Stufe, die diesen
Umbau enthielt, und mit ihr:

- die Frage, ob `activeRegionGeometryEdit` ein `entity`-Feld bekommt (Ökosystem
  hat schlicht seine **eigene** Zustandsvariable daneben)
- die 19 `source`-Wachen (wir laufen nie durch die politischen Pfade, also sehen
  ihre Wachen uns nie)
- die sieben zur Laufzeit überschriebenen Vertex-Handler (die überschreiben *die
  politischen*; unsere sind davon unberührt)

**R2 hat damit drei Stufen statt vier, und alles daran ist additiv:**

| | | Fehlermodus zeigt sich |
|---|---|---|
| **R2a** | Daten + API | in einer Antwort, ganz ohne Karte |
| **R2b** | Darstellung | erst beim Verschieben der Karte |
| **R2c** | Zeichnen | erst nach dem Neuladen |

Rund **2.000 Zeilen neu, null Zeilen geändert.**

> Der ehrliche Preis ist **Drift** — zwei Vertex-Editoren, die auseinanderlaufen
> können. Bewusst in Kauf genommen: die Kopien sind durchweg *kleiner* als ihre
> Vorbilder, und falls die beiden je zusammengeführt werden, macht man das später
> mit zwei sichtbaren Beispielen statt heute blind.

## 2. Die Kopierliste

Jede Vorlage wird **gelesen**, das Gebrauchte abgeschrieben, der politische
Apparat weggelassen. Die rechte Spalte ist der eigentliche Gewinn: Ökosystem hat
keine Hierarchie, keine Zoom-Bänder, keinen BF-Zeitstrahl, keine abgeleiteten
Grenzen, keine Streitgebiete.

| Vorlage (nur lesen) | Zeilen | → Ökosystem-Datei | ca. | was wegfällt |
|---|---|---|---|---|
| `-region-geometry-helpers.js` | 405 | `-ecosystem-geometry-helpers.js` | 150 | ungenutzte Helfer; Snapping über fremde Ebenen |
| `-region-edit-handles.js` | 97 | `-ecosystem-edit-handles.js` | 70 | `applySharedBoundaryVertexMove` — Ökosysteme erben nichts |
| `-region-edit-edge-controls.js` | 251 | `-ecosystem-edit-edge-controls.js` | 200 | — |
| `-region-boolean-geometry.js` | 81 | `-ecosystem-boolean-geometry.js` | 60 | der `?debugMap`-Schreiber |
| `-region-edit-ops.js` (nur die Schnitt-Mathematik) | 38 | `-ecosystem-edit-ops.js` | 40 | die politische Zustandsmaschine |
| `-region-operation-pipeline.js` | 127 | `-ecosystem-operation-pipeline.js` | 90 | politische Repository-Aufrufe |
| `-region-split-preview.js`, `-pending-highlight.js`, `-operation-chip.js` | 113 | eine Datei | 113 | — |
| `-region-crud.js` | 409 | `-ecosystem-crud.js` | 150 | Wappen, Hauptstadt, BF, Vererbung, ~40 Felder |
| `-region-rendering.js` | 555 | `-ecosystem-rendering.js` | 200 | Zoom-Bänder, Streitgebiete, abgeleitete Hüllen |
| `-region-feature-normalization.js` | 142 | `-ecosystem-normalization.js` | 60 | ~40 politische Felder |
| `-region-context-menu.js` | 117 | `-ecosystem-context-menu.js` | 80 | politische Aktionen |

Alle Vorlagen liegen in `js/map-features/`.

## 3. R2a — Daten und API, keine Oberfläche

```
Baue Stufe R2a des Ökosystem-Features in Avesmaps.

🔴 HARTE REGEL, GILT DURCHGEHEND:
Die politische Karte und die Territorien werden NICHT angetastet und NICHT
verändert. Kein File unter js/map-features/map-features-region-*, kein
js/territory/*, kein api/_internal/political/* wird bearbeitet. Erlaubt ist
ausschliesslich, sie zu LESEN und abzuschreiben. Wenn eine Aenderung an
politischem Code noetig erscheint, ist der Entwurf falsch -- melden statt machen.

LIES ZUERST:
  docs/oekosystem-editor-leitfaden.md  §1 (Datenmodell, Typenliste, Punkte)
  docs/oekosystem-r2-auftrag.md        §3 (dieser Abschnitt)
  api/edit/map/citymaps.php            die VORLAGE, ganz lesen
  api/_internal/app/citymaps.php       die zugehoerige Bibliothek, ueberfliegen

ZIEL, vollstaendig:
Regionen und Flaechen ueber die API anlegen, lesen, aendern, weich loeschen.
KEINE Oberflaeche, KEIN Rendering, KEIN Zeichnen. Verifizierbar ohne Karte.

TABELLEN (inline DDL, self-healing wie im Rest des Projekts):
  ecosystem_region       public_id, name, region_type, origin('wiki'|'own'),
                         wiki_region_key, wiki_url, properties_json,
                         is_active, created_by, updated_by, Zeitstempel
  ecosystem_area         public_id, region_id, geometry_geojson,
                         min_x/min_y/max_x/max_y, is_active, created_by,
                         updated_by, Zeitstempel
  ecosystem_region_type  key, label, sort_order, is_active
Die 13 Starttypen aus dem Leitfaden §1.3 als Seed einspielen.

KEINE Spalten fuer: min_zoom/max_zoom, parent_id, valid_from_bf/valid_to_bf.
Die gibt es hier nicht (Leitfaden §1.2). Wer sie aus dem politischen Schema
mitkopiert, baut den Apparat wieder auf, den wir gerade weggelassen haben.

ENDPOINTS:
  api/edit/map/ecosystem.php      Verteiler, VORLAGE citymaps.php:
                                  POST-only, CORS, avesmapsRequireUserWithCapability('edit'),
                                  match($action), duenn -- Logik in die Bibliothek
                                  Aktionen: list, detail, create_region, update_region,
                                  delete_region, create_area, update_area_geometry, delete_area
  api/_internal/app/ecosystem.php die Logik
  api/app/ecosystem.php           oeffentliches Lesen + Kill-Switch 'ecosystem_enabled'
                                  (api/_internal/app/app-setting.php, Standard AN)

NICHT vom politischen Endpoint uebernehmen: PATCH fuer alles, DDL bei jedem
Aufruf, getMessage()-Lecks. Der ist 215 Zeilen, citymaps.php ist 145 -- und die
richtige Vorlage.

CLIENT:
  js/map-features/map-features-ecosystem-repository.js
Das Repository ist der TATSAECHLICHE Engpass: KEIN Schreibpfad daran vorbei.
(Das politische Repository ist es NICHT -- dort rufen mehrere Stellen den
Transport direkt auf. Diese Altlast nicht mitkopieren.)

FERTIG, WENN:
  - eine Region anlegen, lesen, aendern, weich loeschen -- per echtem Request
  - eine Flaeche zu einer Region anlegen und ihre Geometrie aendern
  - die bbox wird beim Schreiben der Geometrie serverseitig gepflegt
  - Kill-Switch aus => oeffentliches Lesen liefert leer, Editor-Schreiben geht weiter
  - Fehlerfaelle liefern den kanonischen Envelope {ok:false,error:{code,message}}
  - `git status` zeigt KEINE Aenderung an politischen Dateien
  - VERIFIZIERT durch tatsaechliche Requests, nicht durch Codelesen

RANDBEDINGUNGEN:
  - Windows + PowerShell; Bash-Werkzeug fuer git vorhanden
  - Geteilter Arbeitsbaum: NIE git add -A. Nur eigene Pfade einzeln stagen.
  - Kleine Commits direkt auf master, Push loest ~1-2 min Auto-Deploy aus
  - Deutsche UI-Strings bleiben deutsch; Code, Kommentare, Commits englisch
```

## 4. R2b — Die Fläche erscheint

```
Baue Stufe R2b des Ökosystem-Features in Avesmaps.

🔴 HARTE REGEL, GILT DURCHGEHEND:
Die politische Karte und die Territorien werden NICHT angetastet und NICHT
verändert. Kein File unter js/map-features/map-features-region-*, kein
js/territory/*, kein api/_internal/political/* wird bearbeitet. Erlaubt ist
ausschliesslich, sie zu LESEN und abzuschreiben -- auch die scheinbar reine
Geometrie-Mathematik wird KOPIERT, nicht aufgerufen. Ein Aufruf koppelt in die
Gegenrichtung: wer spaeter etwas fuer die Politik anpasst, aendert sonst still
das Oekosystem mit.

LIES ZUERST:
  docs/oekosystem-editor-leitfaden.md  §7 (Ebene, Zeichnen, Klicks), §9 (Fallen)
  docs/oekosystem-r2-auftrag.md        §2 (Kopierliste), §4 (dieser Abschnitt)
R2a ist fertig: Tabellen, Endpoint und Repository stehen.

ZIEL, vollstaendig:
Eine Flaeche aus der Datenbank erscheint im Modus "Ökosystem" auf der Karte.
NUR LESEN -- kein Zeichnen, keine Griffe, kein Speichern. Das kommt in R2c.

ZU BAUEN:
1. Eigene Leaflet-Pane, z-index zwischen 201 und 299 (regionsPane liegt bei 200,
   Anlage in js/app/bootstrap.js:16/29). Nicht 350 -- dort liegen schon zwei.
2. EIGENE Registry (eigenes Array), NICHT regionPolygons mitbenutzen.
3. Eigener Loader + eigene Sichtbarkeitsfunktion, die auf den Moduswechsel hoert.
4. Eigener Normalisierer (Kopiervorlage: map-features-region-feature-
   normalization.js, 142 Zeilen -> ca. 60). Gleicher STRUKTURELLER Vertrag
   (layer, layers, label, source), aber nur die Oekosystem-Felder; die ~40
   politischen NICHT mitkopieren.
5. Eigenes Rendering (Kopiervorlage: map-features-region-rendering.js, 555 -> ca.
   200). Ohne Zoom-Baender, Streitgebiete, abgeleitete Huellen.
6. Klick auf eine Flaeche: zuerst window.avesmapsTryOpenLocationAtContainerPoint
   aufrufen (Konvention, siehe docs/click-arbiter-coordination.md), erst dann
   selbst reagieren. Das ist eine LESENDE Nutzung einer fremden Funktion und
   ausdruecklich erlaubt -- sie gehoert nicht der Politik, sondern der
   Klick-Schlichtung.

DREI FALLEN:
  - regionPolygons NICHT mitbenutzen. clearRenderedRegionLayers leert das Array
    bei jedem politischen Reload, und der laeuft bei JEDEM moveend. Eine fremde
    Ebene stirbt beim Kartenschwenk. DAS IST DER WICHTIGSTE TEST DIESER STUFE.
  - syncRegionVisibility ist ZWEIMAL definiert (map-features-political-region-
    visibility.js:1 und map-features-political-territory-loader.js:473; der
    Loader gewinnt). Beide in Ruhe lassen -- eigene Funktion schreiben.
  - Die Pane-Hoehe entscheidet, wer den Klick sieht. Ueber 200 sieht die
    politische Ebene ihn nicht mehr.

FERTIG, WENN:
  - eine per API angelegte Flaeche erscheint im Oekosystem-Modus
  - sie UEBERLEBT mehrfaches Verschieben der Karte (Falle 1)
  - sie ueberlebt Hin- und Herschalten zwischen den Modi
  - die politische Ebene ist unbeschaedigt: umschalten, Territorium anklicken,
    Editor oeffnen -- alles wie vorher
  - `git status` zeigt KEINE Aenderung an politischen Dateien
  - VERIFIZIERT im Browser durch tatsaechliches Verschieben und Umschalten

RANDBEDINGUNGEN: wie R2a.
```

## 5. R2c — Zeichnen

**Ziel:** Rechtsklick legt eine Fläche an, Ecken lassen sich ziehen, Kanten
unterteilen, und alles überlebt einen Neuladen.

Kopiervorlagen: die Zeilen 2–8 der Kopierliste (§2) — Griffe, Kantensteuerung,
Boolean, Schnitt-Mathematik, Pipeline, Vorschau, CRUD, Kontextmenü.

Anlegen läuft über das **Kontextmenü**, nicht über einen Knopf. Beim Anlegen muss
der Modus mitgeschaltet werden, sonst landet das neue Polygon in einer
unsichtbaren Ebene. Für die Menü-Registrierung gibt es ein selbstregistrierendes
Muster im Baum (`map-features-settlement-context-action.js`), das ohne Eingriff in
die politische Verteilungstabelle auskommt — das ist der Weg.

**Fertig, wenn:**
- Rechtsklick → „Ökosystem-Fläche anlegen" erzeugt ein Polygon
- Ecken ziehen, Kante unterteilen, Fläche löschen
- **nach Neuladen ist alles noch da** (der Rundlauf, nicht nur der Anschein)
- das politische Zeichnen ist unbeschädigt — Territorium anlegen, Ecke ziehen,
  speichern
- `git status` zeigt keine Änderung an politischen Dateien

Danach ist R2 fertig und **R3 ist die Abnahme durch den Owner**: er zeichnet einen
Wald.

## 6. Was für ganz R2 gilt

- **Die harte Regel steht in jedem Prompt.** Absichtlich — jede Sitzung startet
  frisch, und der naheliegendste Griff einer frischen Sitzung ist „ich häng schnell
  einen Zweig in die vorhandene Funktion". Genau der ist verboten.
- **`ASSET_VERSION` bumpen** (`js/territory/territory-editor-inline-host.js:23`),
  falls je ein Ökosystem-Panel am selben Inline-Host hängt. Sonst veralteter
  Editor-Code **ohne Fehlermeldung**. *(In R2 vermutlich nicht nötig — und diese
  eine Zeile ist die einzige denkbare Ausnahme von der harten Regel. Sie ist eine
  Cache-Marke, kein Verhalten. Im Zweifel fragen.)*
- **Routing kommt in R2 nicht vor.** Keine Faktoren, keine Höhen, keine
  Vorberechnung. `properties_json` wird geschrieben und gelesen, aber von niemandem
  ausgewertet.
- **Der politische Editor ist die Kontrollgruppe.** Nach jeder Stufe einmal
  Territorium anlegen, Ecke ziehen, speichern. Da nichts Politisches angefasst
  wird, *muss* das durchlaufen — tut es das nicht, ist versehentlich doch etwas
  Gemeinsames verändert worden.
