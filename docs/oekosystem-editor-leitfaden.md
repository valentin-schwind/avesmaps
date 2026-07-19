# Ökosystem — Leitfaden für den neuen Kartenmodus im Edit-Mode

> Bauanleitung für den Zeichen-Modus. Das Datenmodell und die Routing-Wirkung
> stehen in `oekosystem-instruction.md`, das Gesamtbild in
> `oekosystem-feature-design.md`. **Dieses Dokument beschreibt nur den Editor.**

## 1. Was ein Ökosystem ist

**Ökosystem ist eine Kartenebene** — wie „politisch" oder „Standard". Sie zeigt
**statische Regionen mit Eigenschaften**, und sie ist **vorerst nur im Edit-Mode
sichtbar**; die öffentliche Ebene kommt später.

Sie funktioniert wie die Territorien, **ohne den Hierarchie-Apparat**.

### 1.1 Zwei Entitäten, nicht eine

Die **Region** ist das benannte Ding mit den Eigenschaften. Die **Fläche** ist nur
ihre Geometrie. Eine Region darf **mehrere** Flächen haben (ein Moor in zwei
Teilen), und die Eigenschaften hängen an der Region, nicht an jedem Stück.

```
ecosystem_region                      -- das benannte Ding
  public_id, name, region_type,
  origin           'wiki' | 'own'     -- aus dem Wiki zugewiesen oder selbst angelegt
  wiki_region_key, wiki_url           -- NULL bei origin='own'
  properties_json                     -- nach Abnehmer getrennt
  is_active, created_by, updated_by, Zeitstempel

ecosystem_area                        -- eine gezeichnete Fläche
  public_id, region_id,
  geometry_geojson, min_x/min_y/max_x/max_y,
  is_active, created_by, updated_by, Zeitstempel
```

```json
properties_json = {
  "routing":  { "speed_factor": 1.8, "max_height": 9000, … },
  "kraeuter": { … später … }
}
```

**Routing ist nur ein Abnehmer, nicht der Zweck.** Die Wirkungen werden *später*
und *modular* gebaut — dieselben Regionen sollen andere Fragen beantworten können
(Reisesimulation, Kräuterfunde, was noch kommt). Ein JSON-Feld nach Abnehmer
getrennt statt eigener Spalten, damit ein zweiter Abnehmer **ohne
Schema-Änderung** dazukommt.

> Dies **ersetzt** die flache Feldliste in `oekosystem-instruction.md` §2. Wer
> Routing-Werte in die Wurzel schreibt, zwingt in einem halben Jahr die
> Kräuterwahrscheinlichkeit in ein Feld namens Tempo-Faktor.

### 1.2 Was ausdrücklich NICHT mitkommt

Der Territorien-Editor ist voll von Maschinerie, die hier **nicht** gebraucht wird
und beim Abschreiben versehentlich mitwandert:

| Nicht übernehmen | Warum |
|---|---|
| **Zoom-Bänder** (`min_zoom`/`max_zoom` + der ganze Synchronisier-Apparat) | Eine in Zoom 7 gezeichnete Fläche gilt genauso in Zoom 1. Es gibt **keine** Zoom-Abhängigkeit. |
| Hierarchie (`parent_id`, Vererbung, Breadcrumb) | Regionen liegen nebeneinander, nicht ineinander. |
| Abgeleitete Außengrenzen | Es gibt keine Kinder, aus denen sich etwas ableiten ließe. |
| BF-Zeitstrahl (`valid_from_bf`/`valid_to_bf`) | Regionen sind **statisch**. |
| Streitgebiete / Ansprüche | Politisch. |

Das ist etwa ein Drittel des politischen Systems — und der Grund, warum der Umbau
überschaubar bleibt.

### 1.3 Die Typenliste — eigene Liste, eigene Tabelle

Die 19 Label-Subtypen sind eine **Beschriftungs**-Taxonomie und taugen nicht
unverändert als Ökosystem-Typen. Ökosysteme bekommen eine **eigene Liste**; die
Label-Liste bleibt unangetastet (zwei Taxonomien für zwei Zwecke — Labels
beschriften die Karte, Ökosysteme beschreiben Gelände).

**Startbestand, 13 Typen:**

| Land | Wasser | Grenzfall |
|---|---|---|
| `wald`, `suempfe_moore`, `wueste`, `steppe`, `tundra`, `graslandschaft`, `auenlandschaft`, `gebirge`, `huegelland`, `ebene` | `see`, `meer` | `kueste` |

**Nicht aufgenommen, mit Grund:**

| | warum nicht |
|---|---|
| `fluss` | ist eine **Linie**, keine Fläche — Flusswege sind bereits ein Wegtyp |
| `berggipfel` | ist ein **Punkt** — wirkt *auf* eine Region, ist keine (siehe §1.4) |
| `insel`, `kontinent` | Landformen bzw. Beschriftung; auf einer Insel liegen mehrere Ökosysteme |
| `region`, `sonstiges` | Auffangkategorien — tragen für **keinen** Abnehmer Information |

> Die Liste gehört in eine **Tabelle, nicht in den Code** (`ecosystem_region_type`).
> Dann lassen sich „Dschungel", „Salzwüste", „Gletscher" oder „Hochmoor" ohne
> Entwickler ergänzen — dasselbe Argument wie bei den Faktoren.

### 1.4 Punkte, die auf eine Region wirken

Ein `berggipfel`-Label ist kein Regionstyp, aber es ist auch nicht bedeutungslos:
**liegt es innerhalb einer Gebirgsregion, wird es zu deren Höhenpunkt.** Position
und Name stammen dann aus einem Label, das seit Jahren auf der Karte liegt und
wiki-verknüpft ist — es muss nichts neu erfasst werden.

Das ist **kein Gebirgs-Sonderfall, sondern ein Muster**, und es gehört so gebaut:

> Eine Region trägt Fläche und Typ. **Punktförmige Kartenobjekte innerhalb ihrer
> Fläche können ihre Eigenschaften modulieren.** Welcher Punkttyp welche Eigenschaft
> beeinflusst, entscheidet der jeweilige *Abnehmer* — nicht die Region.

Heute: `berggipfel` → Höhenpunkte für den Routing-Abnehmer. Später könnten andere
Punktsorten andere Abnehmer speisen, ohne dass Region oder Fläche sich ändern.
Gefunden werden diese Punkte über den bbox-Vorfilter, den die Vorberechnung ohnehin
schon fährt.

### 1.5 Zuweisung: Wiki-Regionen und eigene

Eine Region ist entweder **aus dem Wiki zugewiesen** (dann trägt sie
`wiki_region_key` und erbt Namen und Beleg) oder **selbst angelegt** (`origin='own'`)
— für Gebiete, die es bei uns gibt, im Wiki aber nicht. Die vorhandene
Landschafts-Wiki-Anbindung (`wiki_region_staging`, Picker in
`js/review/review-label-wiki.js`) ist dafür die Vorlage.

## 2. Machbarkeit — gemessen

Zielgröße laut Owner: **20–30 anisotrope** (Gebirge mit Höhenfeld) und
**100–200 isotrope** Gebiete. Gemessen an 150 + 25 Gebieten gegen 5.080 Wege,
kompletter Stapellauf:

| | |
|---|---|
| bbox-Vorfilter | 889.000 Tests → **8.329 Paare** (0,9 % kommen durch) |
| Ein-/Austritte | 18,2 Mio Kantentests, **449 ms** |
| Höhenfeld + Tempokurve | 109.461 Auswertungen, **47 ms** |
| **Gesamt** | **511 ms** (Node) ≈ **1,5–5 s** (PHP) |

Der **volle** Lauf dauert Sekunden; im Betrieb rechnet nur nach, was sich geändert
hat. Das Höhenfeld ist mit einem Zehntel der Kosten der **billigste** Posten — die
anisotropen Gebiete sind kein Performance-Thema. Reserve, falls echte Wege mehr
Stützpunkte haben: eine bbox-Prüfung **pro Wegsegment** vor der Kantenschleife.

## 3. Der neue Kartenmodus

> ⚠️ **Für den Zeichen-Modus nicht** dem Kachelband von Karten-/Abenteuer-Editor
> nachbauen — das ist das Muster für eigenständige Listen-Editoren. Ein
> **Zeichen**-Modus folgt dem **Politik-Muster**: Modus-Auswahl + Karten-Kontextmenü
> + Werkzeuge auf der Karte.
>
> *(Für den **Regioneneditor** aus §8 ist das Kachelband dagegen genau die richtige
> Vorlage. Beide Muster kommen vor, an verschiedenen Stellen.)*

> 🔒 **Die Ebene ist vorerst nur im Edit-Mode sichtbar.** Der Modus-Eintrag wird
> also an `IS_EDIT_MODE` gehängt; die öffentliche Ebene kommt später und bekommt
> dann den Kill-Switch als Schalter. Bis dahin sehen normale Nutzer nichts davon.

Ein Modus muss an **fünf Stellen** deklariert werden, die übereinstimmen müssen —
fehlt eine, fällt der Modus stumm auf `deregraphic` zurück:

| Stelle | Datei |
|---|---|
| `<option>` in der Modusliste | `index.html:1253` |
| Whitelist der erlaubten Modi | `js/map-features/map-features-display-mode.js:155` |
| Icon | `js/config.js:507` |
| Standardmodus (unverändert lassen) | `js/config.js:481` |
| Übersetzung | `js/app/i18n-en.js:80` |

Das Auswahlfeld baut sich aus den `<option>`-Elementen selbst
(`js/ui/ui-controls.js:449`) — es ist **kein** Menü-Code zu schreiben.

**Anlegen läuft über das Kontextmenü, nicht über einen Knopf:** Rechtsklick →
`js/app/bootstrap.js:599` → Eintrag in `index.html:251` → Verzweigung in
`js/routing/routing.js:677` → `createRegionAt`. Für Ökosystem kommt ein zweiter
Eintrag daneben. Beim Anlegen muss der Modus mitgeschaltet werden — Politik macht
das in `map-features-region-crud.js:159`, sonst landet das neue Polygon in einer
unsichtbaren Ebene.

**Kill-Switch:** `ecosystem_enabled` in den App-Einstellungen
(`api/_internal/app/app-setting.php:17`, bewusst feature-agnostischer
Schlüssel/Wert-Speicher, Standard-Polarität „aktiviert"). Drei Zeilen neben
`api/_internal/app/citymaps.php:52`.

## 4. Das Zeichnen — was wiederverwendet wird

Der Zustand ist besser als erhofft: **die eigentlichen Zeichenwerkzeuge sind
politisch weitgehend sauber.** Gemessen an politischen Referenzen je Datei:

**Ohne jede Kopplung, direkt nutzbar (~1.000 Zeilen):**

| Was | Datei | Bedingung |
|---|---|---|
| 35 Geometrie-Helfer | `map-features-region-geometry-helpers.js` | duck-typed auf `{layer, layers}` |
| Vertex-Griffe | `map-features-region-edit-handles.js` | braucht 2 Injektionen (s. u.) |
| Kanten-Unterteilung | `map-features-region-edit-edge-controls.js` | dieselben 2 |
| Boolean-Geometrie | `map-features-region-boolean-geometry.js:1-63` | rein rechnerisch |
| Schnitt-Mathematik | `map-features-region-edit-ops.js:203-240` | rein rechnerisch |
| Operations-Berechnung | `map-features-region-operation-pipeline.js:57-78` | rein rechnerisch |
| Vorschau, Hervorhebung, Chip | 3 kleine Dateien | 113 Zeilen zusammen |

**Der einzige Unterscheider im ganzen System ist `regionEntry.source`**
(`map-features-region-feature-normalization.js:22`). 19 Dateien verzweigen darauf —
aber immer als **Verweigerung**, nie als Verteilung. Ein dritter Wert würde derzeit
überall abgelehnt.

### Die acht Nahtstellen

Statt `source` weiter zu verzweigen: ein **Entitäts-Deskriptor**
`{sourceKey, repository, reloadFn, layerRegistry, paneName, labels}`, der durch
diese Stellen gereicht wird:

1. **`activeRegionGeometryEdit`** (`js/app/runtime-state.js:166`) — der Singleton,
   den der gesamte Vertex-Editor liest. Entweder bekommt er ein `entity`-Feld, oder
   es läuft eine zweite Instanz. **Das ist die folgenreichste Entscheidung im
   ganzen Vorhaben** und gehört vor Baubeginn getroffen.
2. **`saveRegionGeometry`** (`map-features-region-crud.js:75`) — die
   Zwei-Wege-Verzweigung wird Deskriptor-Aufruf. *Jedes* wiederverwendete Werkzeug
   endet hier.
3. **`applySharedBoundaryVertexMove`** (`:49`, Filter `:53`) — muss auf die Quelle
   des *Aufrufers* filtern statt auf das Literal.
4. **Die fünf Payload-Bauer** (`map-features-region-payload-builders.js`) — reine
   `regionEntry → {action, …}`-Funktionen, die natürliche Parametrisierungsstelle.
5. **`persistRegionOperationResult`** (`-region-operation-pipeline.js:80`) +
   `finishPendingRegionOperation` `:93` — Repository und Reload tauschen; die
   übrigen zwei Pipeline-Stufen brauchen nur eine gelockerte Wache.
6. **Die 19 `source`-Wachen** — aus Verweigerungen werden Fähigkeitsprüfungen.
   Ökosystem hat **keine** Hierarchie, keine abgeleiteten Außengrenzen, keinen
   BF-Zeitstrahl; mehrere Werkzeuge müssen also **absichtlich** abgeschaltet werden,
   nicht versehentlich.
7. **`resolveOverlappingRegionLayerSelection`** (`-region-overlap-selection.js:83`).
8. **`normalizeRegionFeature`** (`-region-feature-normalization.js:6`) — rund 40 der
   55 Felder sind politisch. Ökosystem braucht einen eigenen Normalisierer mit
   demselben *strukturellen* Vertrag (`layer`, `layers`, `label`, `handles`, `source`).

## 5. Der Endpoint

> **Vorlage ist `api/edit/map/citymaps.php` (145 Zeilen), nicht der politische
> Endpoint (215 Zeilen).** Citymaps ist POST-only, ein schlanker Verteiler mit
> `match($action)`, Fähigkeitsprüfung an einer Stelle, **ohne** DDL-Präambel; die
> Logik liegt in `api/_internal/app/citymaps.php`.

Der politische Endpoint hat drei Eigenheiten, die **nicht** übernommen werden:
`PATCH` für alles inklusive Anlegen und Löschen, DDL bei jedem Aufruf, und
`getMessage()`-Lecks an zwei Stellen.

Neu zu schreiben:

| Baustein | Vorlage | ca. |
|---|---|---|
| `api/edit/map/ecosystem.php` (Verteiler) | `api/edit/map/citymaps.php` | 150 |
| `api/_internal/app/ecosystem.php` (Logik) | `_internal/app/citymaps.php` | 400 |
| `api/app/ecosystem.php` (öffentliches Lesen + Kill-Switch) | `api/app/citymaps.php:43` | 90 |
| Tabellen als Inline-DDL | `api/_internal/political/territory.php:58` | 150 |
| `ecosystemRepository` im Client | `-political-territory-repository.js` | 120 |

> **Beim Repository eine Altlast nicht mitkopieren:** das politische Repository ist
> *nicht* der Engpass — `createRegionAt` und der Speicher-Flow rufen den Transport
> direkt auf, das Repository deckt nur etwa ein Drittel der Aktionen ab. Das
> Ökosystem-Repository soll der **tatsächliche** Engpass sein: kein Schreibpfad
> daran vorbei.

## 6. Ebene, Zeichnen, Klicks

**Eigene Ebene, eigene Registry — nicht mitbenutzen.** `regionsPane` liegt bei
z-index 200 (`js/app/bootstrap.js:29`), frei ist 201–299. Nicht 350 nehmen, dort
liegen schon zwei.

> 🔴 **Ökosystem darf `regionPolygons` nicht teilen.** Drei unabhängige Gründe:
> `clearRenderedRegionLayers` leert das gesamte Array bei jedem politischen Reload —
> und der läuft bei **jedem `moveend`**, eine fremde Ebene stirbt also bei jedem
> Verschieben der Karte. `syncRegionVisibility` filtert **nicht** nach Quelle und
> entfernt alles, sobald der Modus ≠ `political` ist. Und die Hover-Hervorhebung
> scannt dasselbe Array.

**Klick-Schlichtung: es gibt keinen zentralen Verteiler**, sondern eine
Konvention — jede Ebene ruft freiwillig zuerst
`window.avesmapsTryOpenLocationAtContainerPoint` auf. Reihenfolge laut
`docs/click-arbiter-coordination.md`: Siedlung > Straße/Fluss > Region >
Herrschaftsgebiet. Ökosystem hält sich daran und reiht sich ein; die
**Pane-Höhe entscheidet**, wer den Klick überhaupt sieht.

## 7. Das Editor-Panel

Das Panel wird per Inline-Host injiziert (`territory-editor-inline-host.js`), das
De-iframe-Umbau ist erledigt. **Das Formular ist handgeschrieben, nicht
datengetrieben** — `territory-editor-form.js` ist ein *Leser*, der feste DOM-IDs
abfragt. Es gibt keine Feldkonfiguration, also muss das Ökosystem-Formular
**geklont** werden.

`territory-editor-embedded.js` (3.101 Zeilen) bleibt unangetastet — Wiki-Baum,
Breadcrumb, Vererbung, abgeleitete Grenzen sind irreduzibel politisch.

Als Formularmuster für die eine Zahl (`max_height`) dient der **Strömungsfaktor**
der Flusswege (`index.html:926`, `js/review/review-path-flow.js`): ausklappbarer
Abschnitt, dreiwertige Herkunftszeile („aus Wiki" / „manuell" / „unbekannt"),
kleines Zahlenfeld mit Einheit, eigener Speichern-Knopf, beidseitig identisch
geklemmt.

## 8. Der Regioneneditor — die Übersicht

Neben dem Zeichnen auf der Karte braucht es eine **Liste**: welche Regionen haben
wir, woher stammen sie, und welche Eigenschaften tragen sie. Das ist bewusst eine
zweite Oberfläche, weil sie eine andere Frage beantwortet — die Karte zeigt *wo*,
die Liste zeigt *was*.

**Hier ist das Kachelband die richtige Vorlage**, konkret `html/citymap-editor.html`
und `html/adventure-editor.html`: eigenständige Seite, Tabelle, Filter, Kachelband
für Aktionen.

Die Liste zeigt je Region:

| Spalte | Quelle |
|---|---|
| Name | `ecosystem_region.name` |
| Typ | `region_type` |
| Herkunft | `origin` — Wiki-Beleg oder „eigen", als Chip mit Herkunftsfarbe |
| Flächen | Anzahl zugehöriger `ecosystem_area`, Klick springt zur Karte |
| Eigenschaften | je Abnehmer eine Spalte oder ein aufklappbarer Block |
| Zustand | zugewiesen / ohne Fläche / ohne Eigenschaften |

Die letzte Spalte ist der eigentliche Nutzen: **sie zeigt die Lücken.** Eine Region
ohne Fläche ist unbenutzt, eine Fläche ohne Eigenschaften wirkt nirgends. Das ist
dasselbe Muster wie der „Fehlt"-Reiter bei den Territorien-Listen.

> Der Regioneneditor **schreibt keine Geometrie**. Zeichnen passiert auf der Karte,
> hier werden nur Zuordnung und Eigenschaften gepflegt.

## 9. Die drei Fallen, die zuverlässig zuschlagen

1. **`regionPolygons` teilen** → Ökosystem-Flächen verschwinden bei jedem
   Kartenschwenk. Eigene Registry.
2. **Die überschriebene Kopie bearbeiten.** `syncRegionVisibility` ist **zweimal**
   definiert (der Loader gewinnt). Und sieben Vertex-/Kanten-Handler werden zur
   Laufzeit von `map-features-region-vertex-detach-edit.js` überschrieben — das
   ausgerechnet aus `js/routing/route-priority-queue.js:66` nachgeladen wird.
   Änderungen an den Basisdateien sind still wirkungslos.
3. **`ASSET_VERSION` vergessen** (`territory-editor-inline-host.js:23`), falls das
   Ökosystem-Panel denselben Inline-Host nutzt → veralteter Editor-Code ohne
   Fehlermeldung.

## 10. Aufwand und Phasen

**~2.300 Zeilen neu, ~500 umgebaut, ~1.000 wiederverwendet.**

| Phase | Inhalt | fertig, wenn |
|---|---|---|
| **E1** | Zwei Tabellen + Endpoint + Repository | Region und Fläche per API anlegen, lesen, ändern, soft-löschen |
| **E2** | Deskriptor + die acht Nahtstellen | politische Tests unverändert grün, zweiter Typ akzeptiert |
| **E3** | Modus (edit-only), Kontextmenü, eigene Ebene + Loader | Fläche erscheint, überlebt Kartenschwenk und Moduswechsel |
| **E4** | Zeichenwerkzeuge am neuen Typ | Ecken ziehen, Kante teilen, Boolean-Split |
| **E5** | Panel: Typ, Name, Wiki-Zuweisung, eigene Region | Zuordnung speicherbar |
| **E6** | Regioneneditor (§8) | Übersicht zeigt Regionen, Herkunft, Flächenzahl, Lücken |
| **E7** | Kill-Switch + öffentliche Ebene | erst wenn die Ebene für Nutzer sichtbar werden soll |

> 🔴 **Routing ist in diesen Phasen NICHT enthalten.** Die Wirkungen werden später
> und **modular** gebaut — als erster *Abnehmer* der fertigen Regionen
> (`oekosystem-instruction.md`), Kräuter und Reisesimulation später als weitere.
> E1–E6 liefern Flächen mit Eigenschaften, sonst nichts. Das ist Absicht: solange
> kein Abnehmer dranhängt, kann auch keiner kaputtgehen.

## 11. Offene Entscheidung vor Baubeginn

**Zweite Instanz oder gemeinsamer Singleton für `activeRegionGeometryEdit`?**
Zwei Instanzen sind sauberer getrennt, aber die überschriebenen Handler
(Falle 2) lesen den Singleton direkt — bei zwei Instanzen müssten sie ebenfalls
parametrisiert werden. Ein gemeinsamer Singleton mit `entity`-Feld ist der
kleinere Eingriff, koppelt aber beide Editoren aneinander.

Das ist die Stelle, an der ein falscher Griff später teuer wird. Sie gehört
entschieden, bevor E2 anfängt.
