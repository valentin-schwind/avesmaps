# Ökosystem R2 — Erste Geometrie

> R2 ist der große Brocken: Tabellen, Endpoint, Repository, der Entitäts-Deskriptor,
> die acht Nahtstellen und das Zeichnen. Rund **2.100 Zeilen neu, 500 umgebaut**.
>
> **Das passt nicht in eine Sitzung.** Dieses Dokument schneidet R2 in vier Stufen,
> die einzeln abnehmbar sind. Gliederung und Fallen stehen in
> `oekosystem-editor-leitfaden.md`; hier steht, in welcher Reihenfolge gebaut wird
> und woran man merkt, dass eine Stufe fertig ist.

## 1. Warum vier Stufen

R1 war klein geschnitten, weil sein einziger Fehlermodus die stumme
Modus-Verdrahtung war. R2 hat **vier** unabhängige Fehlermodi, und sie in einem
Rutsch zu bauen heißt, sie gemeinsam zu debuggen:

| | Fehlermodus | wo er sich zeigt |
|---|---|---|
| **R2a** Daten + API | Schema und Envelope | in einer Antwort, ohne Karte |
| **R2b** Darstellung | fremde Ebene stirbt beim Kartenschwenk | erst beim Verschieben |
| **R2c** Nahtstellen | politisches System beschädigt | erst im politischen Editor |
| **R2d** Zeichnen | Speicherpfad | erst beim Rundlauf |

Besonders **R2c** verlangt die Trennung: dort wird an **lebendem politischem Code**
operiert. Wenn dabei etwas bricht, will man wissen, dass es nicht am neuen
Datenmodell lag.

Jede Stufe ist eine Sitzung und endet in etwas, das man **ansehen** kann.

## 2. Die Entscheidung, die vor R2c fällt — entschieden

`activeRegionGeometryEdit` (`js/app/runtime-state.js:166`) ist der Singleton, den
der gesamte Vertex-Editor liest. Ein Singleton mit `entity`-Feld, oder zwei
Instanzen?

> **Ein Singleton mit `entity`-Feld.**

Zwei Gründe, beide praktisch:

1. **Es ist immer nur eine Geometrie in Bearbeitung.** Man kann keinen politischen
   und einen Ökosystem-Vertex gleichzeitig ziehen. Der Singleton ist kein Versehen,
   er bildet die Interaktion korrekt ab. Zwei Instanzen würden einen Zustand
   modellieren, den es nicht gibt.
2. **Sieben Vertex-/Kanten-Handler werden zur Laufzeit überschrieben** — von
   `map-features-region-vertex-detach-edit.js`, nachgeladen ausgerechnet aus
   `js/routing/route-priority-queue.js:66`. Bei zwei Instanzen müssten genau diese
   Handler wissen, welche gemeint ist. Das ist die schlechteste Stelle im Baum, um
   Parametrisierung einzuziehen: Änderungen an der Basisdatei sind dort **still
   wirkungslos**.

Das `entity`-Feld trägt den Deskriptor `{sourceKey, repository, reloadFn,
layerRegistry, paneName, labels}`. Die Handler lesen weiter dieselbe Variable und
fragen nur dort nach, wo sie entitätsabhängig handeln müssen — praktisch nur beim
Speichern.

## 3. R2a — Daten und API, keine Oberfläche

**Ziel:** Regionen und Flächen lassen sich über die API anlegen, lesen, ändern und
weich löschen. Nichts davon ist auf der Karte sichtbar.

```
Baue Stufe R2a des Ökosystem-Features in Avesmaps.

LIES ZUERST:
  docs/oekosystem-editor-leitfaden.md  §1 (Datenmodell, Typenliste, Punkte), §6 (Endpoint)
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
(Das politische Repository ist es NICHT -- createRegionAt und der Speicher-Flow
rufen den Transport direkt auf. Diese Altlast nicht mitkopieren.)

FERTIG, WENN:
  - eine Region anlegen, lesen, aendern, weich loeschen -- per echtem Request
  - eine Flaeche zu einer Region anlegen und ihre Geometrie aendern
  - die bbox wird beim Schreiben der Geometrie serverseitig gepflegt
  - Kill-Switch aus => oeffentliches Lesen liefert leer, Editor-Schreiben geht weiter
  - Fehlerfaelle liefern den kanonischen Envelope {ok:false,error:{code,message}}
  - VERIFIZIERT durch tatsaechliche Requests, nicht durch Codelesen

RANDBEDINGUNGEN:
  - Windows + PowerShell; Bash-Werkzeug fuer git vorhanden
  - Geteilter Arbeitsbaum: NIE git add -A. Nur eigene Pfade einzeln stagen.
  - Kleine Commits direkt auf master, Push loest ~1-2 min Auto-Deploy aus
  - Deutsche UI-Strings bleiben deutsch; Code, Kommentare, Commits englisch
```

## 4. R2b — Die Fläche erscheint

**Ziel:** Eine in R2a angelegte Fläche wird in der Ökosystem-Ebene gezeichnet.
Nur lesen — noch kein Bearbeiten.

```
Baue Stufe R2b des Ökosystem-Features in Avesmaps.

LIES ZUERST:
  docs/oekosystem-editor-leitfaden.md  §7 (Ebene, Zeichnen, Klicks), §9 (Fallen)
  docs/oekosystem-r2-auftrag.md        §4 (dieser Abschnitt)
R2a ist fertig: Tabellen, Endpoint und Repository stehen.

ZIEL, vollstaendig:
Eine Flaeche aus der Datenbank erscheint im Modus "Ökosystem" auf der Karte.
NUR LESEN -- kein Zeichnen, keine Griffe, kein Speichern. Das kommt in R2d.

ZU BAUEN:
1. Eigene Leaflet-Pane, z-index zwischen 201 und 299 (regionsPane liegt bei 200,
   Anlage in js/app/bootstrap.js:16/29). Nicht 350 -- dort liegen schon zwei.
2. EIGENE Registry (ein eigenes Array), NICHT regionPolygons mitbenutzen.
3. Eigener Loader + eigene Sichtbarkeitsfunktion, die auf den Moduswechsel hoert.
4. Eigener Normalisierer, der denselben STRUKTURELLEN Vertrag erfuellt wie
   normalizeRegionFeature (layer, layers, label, source) -- aber nur die
   Oekosystem-Felder. Die ~40 politischen Felder NICHT mitkopieren.
5. Klick auf eine Flaeche: zuerst window.avesmapsTryOpenLocationAtContainerPoint
   aufrufen (Konvention, siehe docs/click-arbiter-coordination.md), erst dann
   selbst reagieren.

DREI FALLEN:
  - regionPolygons NICHT mitbenutzen. clearRenderedRegionLayers leert das Array
    bei jedem politischen Reload, und der laeuft bei JEDEM moveend. Eine fremde
    Ebene stirbt beim Kartenschwenk. DAS IST DER WICHTIGSTE TEST DIESER STUFE.
  - syncRegionVisibility ist ZWEIMAL definiert (map-features-political-region-
    visibility.js:1 und map-features-political-territory-loader.js:473; der
    Loader gewinnt). Nicht erweitern -- eigene Funktion schreiben.
  - Die Pane-Hoehe entscheidet, wer den Klick sieht. Ueber 200 sieht die
    politische Ebene ihn nicht mehr.

FERTIG, WENN:
  - eine per API angelegte Flaeche erscheint im Oekosystem-Modus
  - sie UEBERLEBT mehrfaches Verschieben der Karte (Falle 1)
  - sie ueberlebt Hin- und Herschalten zwischen den Modi
  - die politische Ebene ist unbeschaedigt: umschalten, Territorium anklicken,
    Editor oeffnen -- alles wie vorher
  - VERIFIZIERT im Browser durch tatsaechliches Verschieben und Umschalten

RANDBEDINGUNGEN: wie R2a.
```

## 5. R2c — Die Nahtstellen

**Ziel:** Die vorhandenen Zeichenwerkzeuge akzeptieren einen zweiten Entitätstyp.
Kein neues Verhalten — der Umbau ist fertig, wenn **nichts** anders aussieht.

Die acht Stellen stehen im Leitfaden §5. Der Deskriptor wird über
`activeRegionGeometryEdit.entity` gereicht (§2 dieses Dokuments).

**Reihenfolge:** erst die fünf reinen Rechenstellen (Payload-Bauer,
Operations-Pipeline), dann `saveRegionGeometry`, zuletzt die 19 `source`-Wachen.
Die Wachen zum Schluss, weil sie bis dahin als Schutznetz wirken: solange sie
Ökosystem ablehnen, kann ein halbfertiger Umbau nichts kaputtmachen.

**Fertig, wenn:**
- das politische System **unverändert** funktioniert — Territorium anlegen,
  Ecke ziehen, Kante teilen, Boolean-Split, Editor speichern
- die vorhandenen Routing- und Fluss-Tests laufen durch
- der Deskriptor liegt an, ein zweiter `sourceKey` wird akzeptiert statt abgelehnt
- **verifiziert am politischen Editor**, nicht am neuen — R2c hat noch keine
  eigene Oberfläche

> Mehrere Werkzeuge müssen für Ökosystem **absichtlich abgeschaltet** bleiben
> (Vererbung, abgeleitete Grenzen, BF-Gültigkeit). Aus den Verweigerungen werden
> Fähigkeitsprüfungen — eine ausgeschaltete Fähigkeit ist etwas anderes als eine
> vergessene.

## 6. R2d — Zeichnen

**Ziel:** Rechtsklick legt eine Fläche an, Ecken lassen sich ziehen, Kanten
unterteilen, und alles überlebt einen Neuladen.

Anlegen läuft über das **Kontextmenü**, nicht über einen Knopf — der Pfad steht im
Leitfaden §4. Beim Anlegen muss der Modus mitgeschaltet werden, sonst landet das
neue Polygon in einer unsichtbaren Ebene.

**Fertig, wenn:**
- Rechtsklick → „Ökosystem-Fläche anlegen" erzeugt ein Polygon
- Ecken ziehen, Kante unterteilen, Fläche löschen
- **nach Neuladen ist alles noch da** (der Rundlauf, nicht nur der Anschein)
- das politische Zeichnen ist unbeschädigt

Danach ist R2 fertig und **R3 ist deine Abnahme**: du zeichnest einen Wald.

## 7. Was für ganz R2 gilt

- **`ASSET_VERSION` bumpen** (`js/territory/territory-editor-inline-host.js:23`),
  sobald ein Ökosystem-Panel am selben Inline-Host hängt. Sonst veralteter
  Editor-Code **ohne Fehlermeldung**.
- **Routing kommt in R2 nicht vor.** Keine Faktoren, keine Höhen, keine
  Vorberechnung. `properties_json` bleibt ein Feld, das geschrieben und gelesen,
  aber von niemandem ausgewertet wird.
- **Der politische Editor ist die Kontrollgruppe.** Nach jeder Stufe einmal
  Territorium anlegen, Ecke ziehen, speichern. Wenn das bricht, ist die Ursache in
  der Stufe, die gerade fertig wurde — nicht drei Stufen später.
