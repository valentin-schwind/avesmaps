# Ökosystem — Leitfaden für den neuen Kartenmodus im Edit-Mode

> Bauanleitung für den Zeichen-Modus: Architektur, Bauteile, Kopiervorlagen.
>
> **Was der Editor tut, wenn jemand klickt, steht in
> `oekosystem-editor-verhalten.md`** — Ebenen umschalten, Fläche anlegen,
> Überlappung, Gipfel, Speichern, Prüfungen. Vorgeführt in
> `html/landschaften-modell.html`.
>
> Die Routing-Wirkung steht in `oekosystem-instruction.md`, das Gesamtbild in
> `oekosystem-feature-design.md`, die Bauphasen in `oekosystem-r1-auftrag.md`
> und `oekosystem-r2-auftrag.md`.

## 1. Was ein Ökosystem ist

**Ökosystem ist eine Kartenebene** — wie „politisch" oder „Standard". Sie zeigt
**statische Regionen mit Eigenschaften**, und sie ist **vorerst nur im Edit-Mode
sichtbar**; die öffentliche Ebene kommt später.

Sie funktioniert wie die Territorien, **ohne den Hierarchie-Apparat**.

### 1.1 Zwei Ebenen, zwei Entitäten

**Landschaften bestehen aus zwei getrennt gezeichneten Ebenen**, die sich frei
überlappen dürfen:

| Ebene | beschreibt | gezeichnet werden |
|---|---|---|
| **Topographie** | die Form des Landes | nur `gebirge`, `ebene`, `see`, `meer` — **alles andere gilt als „normal" und wird nicht gezeichnet** |
| **Bedeckung** | was auf dem Land wächst oder liegt | Wald, Sumpf, Wüste, … |

**Warum zwei und nicht ein Feld an einer Fläche:** Berg und Bewuchs haben
verschiedene Umrisse. Ein Wald reicht vom Bergfuß in die Ebene hinunter, ein
Gebirgszug ist teils bewaldet und teils kahl. Vor allem aber **begrenzt das
topographische Polygon das Höhenfeld** — an seinem Rand ist die Höhe null. Wäre
es um den Wald gezeichnet, würde das Gebirge an der Waldkante abgeschnitten.

Der tiefere Grund, und der trägt die Entscheidung:

> **Eine Bedeckungsfläche hält einen Wert fest. Eine topographische Fläche ist der
> Definitionsbereich eines Generators.** In ihr entsteht das Höhenfeld, aus ihrem
> Umriss und ihrem Saatwert. Das sind zwei verschiedene Arten von Ding.

Innerhalb einer Ebene gilt weiter die Trennung von Name und Geometrie: die
**Region** ist das benannte Ding mit den Eigenschaften, die **Fläche** nur ihre
Geometrie. Eine Region darf **mehrere** Flächen haben (ein Moor in zwei Teilen).

```
ecosystem_region                      -- das benannte Ding
  public_id, name,
  kind             'topographie' | 'bedeckung'   -- die Ebene
  region_type                                    -- aus dem Vokabular der Ebene (1.3)
  origin           'wiki' | 'own'     -- aus dem Wiki zugewiesen oder selbst angelegt
  wiki_region_key, wiki_url           -- NULL bei origin='own'
  properties_json                     -- nach Abnehmer getrennt
  is_active, created_by, updated_by, Zeitstempel

ecosystem_area                        -- eine gezeichnete Fläche
  public_id, region_id,
  geometry_geojson, min_x/min_y/max_x/max_y,
  is_active, created_by, updated_by, Zeitstempel
```

> `kind` sitzt an der **Region**, nicht an der Fläche. Eine Region ist entweder
> topographisch oder eine Bedeckung; ein Gebilde, das beides zugleich wäre, gibt
> es nicht. Die Flächen erben es über `region_id`.

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

### 1.3 Zwei Vokabulare, je eines pro Ebene

Die 19 Label-Subtypen sind eine **Beschriftungs**-Taxonomie und taugen nicht
unverändert als Typenliste. Die Label-Liste bleibt unangetastet — zwei Taxonomien
für zwei Zwecke: Labels beschriften die Karte, Landschaften beschreiben Gelände.

**Topographie — vier Typen, und das ist Absicht:**

```
gebirge     erzeugt ein Höhenfeld (§1.4)
ebene       ausdrücklich flach
see  meer   Wasser
```

> **Alles Ungezeichnete gilt als „normal".** Es gibt keinen Typ dafür und keine
> Fläche. Das halbiert die Handarbeit: die Editoren zeichnen die Ausnahmen, nicht
> die Karte.
>
> ⚠️ **`ebene` verdient seinen Platz nur, wenn es sich anders verhält als
> „normal".** Bekommt es denselben Faktor, ist es eine Fläche, die nichts tut, und
> gehört gestrichen. Das entscheidet der erste Abnehmer, nicht dieses Dokument.

**Bedeckung — am Wiki ausgerichtet.** *Wiki Aventurica* führt unter
[Vegetationszone](https://de.wiki-aventurica.de/wiki/Vegetationszone/Liste) 14
Einträge. Wir übernehmen deren Vokabular, damit die Zuweisung in R4 eins zu eins
läuft:

```
aus dem Wiki   wald  regenwald  trockenwald  nebelwald  sumpf
               mangrovensumpf  wueste  savanne  steppe  kueste
ergänzt        tundra  grasland  aue  fels  eis
```

**Drei Einträge der Wiki-Liste übernehmen wir nicht, und der Grund ist derselbe:**

| | warum nicht |
|---|---|
| `fluss` | ist eine **Linie**, kein Gebiet — Flusswege sind bereits ein Wegtyp |
| `ebene` | ist **Relief**, keine Bedeckung → wandert in die Topographie |
| `bergwald` | ist **beides zugleich** → bei uns `wald` + eine Gebirgsfläche darüber |

> `bergwald` ist der aufschlussreichste Fall. Die Wiki-Liste brauchte Höhe,
> konnte sie in einer Vegetationskategorie aber nicht unterbringen — also wurde
> sie durch die Vegetation geschmuggelt. Dasselbe bei `nebelwald`, definiert als
> *„ab einer Höhe von 2.000 Schritt"*. **Die Zwei-Ebenen-Trennung ist damit kein
> Einfall von uns, sondern die Auflösung eines Problems, das die Datengrundlage
> schon hat.** Und sie rechnet besser: eine Route durch Bergwald bekommt bei uns
> den Waldfaktor **und** das Höhenfeld statt eines Mischwerts, in dem beides
> steckt und keins stimmt.

Beide Listen gehören in eine **Tabelle, nicht in den Code**
(`ecosystem_region_type` mit `kind`). Dann lassen sich „Dschungel", „Salzwüste"
oder „Hochmoor" ohne Entwickler ergänzen — dasselbe Argument wie bei den Faktoren.

### 1.4 Punkte, die auf eine Region wirken

Ein `berggipfel`-Label ist kein Regionstyp, aber es ist auch nicht bedeutungslos:
**liegt es innerhalb einer topographischen Fläche vom Typ `gebirge`, ist es deren
Höhenpunkt.** In einer Bedeckungsfläche bewirkt es nichts — ein Gipfel im Wald
ist ein Gipfel, kein Wald-Merkmal.

> **Und damit gibt es kein Relief-Feld.** Ein Aufzählwert `relief=gebirge` würde
> nur wiederholen, was die Gipfel schon sagen, und könnte ihnen widersprechen.
> Schlimmer: er wäre *gleichmäßig* für die ganze Fläche, während ein echter
> Gebirgszug im Norden hoch ausläuft und im Süden flach. Höhenpunkte bilden das
> ab, ein Enum nicht. Auch „Hügelland gegen Gebirge" ist dadurch kein
> Schubladenpaar mehr, sondern ein Übergang: 300 Schritt sind Hügel, 9.000 sind
> Wall, dazwischen muss niemand wählen.

> 🔴 **1:1, nicht kopiert.** Die Gipfel liegen bereits im Standard-Layer. Das
> Ökosystem legt **keine eigenen Höhenpunkte an** und führt **keine zweite
> Positionsliste** — es *referenziert* dieselben `map_features`-Zeilen
> (`feature_type='label'`, `feature_subtype='berggipfel'`). Es gibt genau **ein**
> Objekt, in zwei Ansichten.

**Daraus folgt zweierlei:**

**Die Höhe gehört ans Label**, nicht an das Ökosystem — als Feld in
`properties_json` des Labels (neben dem dort schon vorhandenen `wiki_region`).
Damit trägt der *Amboss* seine Höhe selbst, sichtbar und pflegbar im
Standard-Layer, unabhängig davon, ob es je ein Ökosystem darüber gibt. Die
Ökosystem-Ebene liest sie nur.

**Nicht jeder Gipfel gehört auf die öffentliche Karte.** Für ein brauchbares
Höhenfeld braucht das Modell **mehr** Stützpunkte, als ein Leser sehen will. Daher:

> Ein `berggipfel`-Label wird im **Standard-Layer** nur gezeichnet, wenn es
> **wiki-verknüpft** ist. Gipfel ohne Wiki-Eintrag existieren als Datensatz,
> erscheinen aber **nicht** als Dreieck auf der Karte — sie sind nur in der
> Ökosystem-Ebene sichtbar und dienen der Berechnung der anisotropen Gebirge.

Damit können Editoren so viele Arbeitspunkte setzen, wie das Gelände braucht, ohne
die Karte zuzumüllen. Die Regel gilt **nur für `berggipfel`** — andere Label-Typen
behalten ihr heutiges Verhalten. *(Es gibt bereits eine Wiki-Unterscheidung an
Labels, sie steuert bisher nur die Darstellung — hier kommt für diesen einen
Subtyp die Sichtbarkeit dazu.)*

**Bearbeiten ist bidirektional.** Wird der Gipfel im Standard-Layer verschoben,
wandert der Höhenpunkt mit; wird er aus der Ökosystem-Ebene heraus verschoben,
bewegt sich das Label im Standard-Layer. Beide Wege schreiben dieselbe Aktion
(`move_label` bzw. `update_label`) auf dieselbe Zeile — es gibt keinen
Synchronisationspfad, weil es nichts zu synchronisieren gibt.

> ⚠️ **Neue Invalidierungskante:** verschiebt jemand einen `berggipfel` — egal aus
> welcher Ebene —, muss die **enthaltende Region neu gerechnet** werden. Das ist
> derselbe begrenzte Nachlauf wie bei einer geänderten Fläche (§ Vorberechnung in
> `oekosystem-instruction.md`), nur mit dem Label als Auslöser.

Das ist **kein Gebirgs-Sonderfall, sondern ein Muster**:

> Eine Region trägt Fläche und Typ. **Punktförmige Kartenobjekte innerhalb ihrer
> Fläche können ihre Eigenschaften modulieren** — als Referenz, nie als Kopie.
> Welcher Punkttyp welche Eigenschaft beeinflusst, entscheidet der jeweilige
> *Abnehmer*, nicht die Region.

Heute: `berggipfel` → Höhe für den Routing-Abnehmer. Später können andere
Punktsorten andere Abnehmer speisen, ohne dass Region oder Fläche sich ändern.
Gefunden werden sie über den bbox-Vorfilter, den die Vorberechnung ohnehin fährt —
Punkt-Labels haben `min_x = max_x`, ihre bbox *ist* ihre Position.

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

### 3.1 Was der Modus zeigt

Der Ökosystem-Modus ist **kein leerer Zeichentisch**. Er zeigt im Edit-Mode
weiterhin die übrigen Karteninhalte — Grundkarte, Wege, Orte —, sonst zeichnet man
Flächen ins Nichts.

Dazu ein **Häkchen „Labels"**, das die Beschriftungen der Standardkarte einblendet.
Das ist mehr als Bequemlichkeit:

> **Es macht Fehlzuweisungen sichtbar.** Hat eine Ökosystem-Fläche eine
> Wiki-Region zugewiesen bekommen, kann daneben ihr Name stehen — und wenn dort
> „Farindel" steht, während das Standard-Label darunter „Farindel" sagt, stimmt die
> Zuweisung. Steht etwas anderes da, ist sie falsch. Ein Abgleich, den sonst
> niemand macht.

Das Ökosystem selbst braucht **keine** eigene Beschriftung — die Fläche ist ja
schon sichtbar. Angezeigt wird nur der **zugewiesene Name**, als Prüfhilfe.

**Kill-Switch:** `ecosystem_enabled` in den App-Einstellungen
(`api/_internal/app/app-setting.php:17`, bewusst feature-agnostischer
Schlüssel/Wert-Speicher, Standard-Polarität „aktiviert"). Drei Zeilen neben
`api/_internal/app/citymaps.php:52`.

## 4. Das Zeichnen — kopieren, nicht umbauen

> 🔴 **Harte Regel des Owners: die politische Karte und die Territorien werden
> weder angetastet noch verändert. Erlaubt ist ausschließlich, die Werkzeuge von
> dort zu KOPIEREN.**
>
> Kein politisches File wird bearbeitet — und keines wird zur Laufzeit aufgerufen,
> auch nicht die scheinbar reine Geometrie-Mathematik. Ein Aufruf koppelt in die
> Gegenrichtung: wer später eine Boolean-Funktion für die Politik anpasst, ändert
> sonst still das Ökosystem mit.

Die Vermessung der Zeichenwerkzeuge bleibt trotzdem wertvoll — sie sagt, **wie
sauber sich abschreiben lässt**. Politische Referenzen je Datei:

| Was | Datei | politische Refs |
|---|---|---|
| 35 Geometrie-Helfer | `map-features-region-geometry-helpers.js` | **0** |
| Vertex-Griffe | `map-features-region-edit-handles.js` | **0** |
| Kanten-Unterteilung | `map-features-region-edit-edge-controls.js` | **0** |
| Boolean-Geometrie | `map-features-region-boolean-geometry.js:1-63` | **0** |
| Vorschau, Hervorhebung, Chip | 3 kleine Dateien, 113 Zeilen | **0** |
| Schnitt-Mathematik | `map-features-region-edit-ops.js:203-240` | rein rechnerisch |
| Operations-Berechnung | `map-features-region-operation-pipeline.js:57-78` | rein rechnerisch |

Diese Dateien enthalten **generisches Polygon-Handwerk** — Ecken ziehen, Kanten
unterteilen, Ringe verschneiden. Politisch daran ist nichts. Sie lassen sich fast
wörtlich abschreiben, und die Kopien werden dabei **kleiner**, weil der ganze
politische Apparat wegfällt (Hierarchie, Zoom-Bänder, BF-Zeitstrahl, abgeleitete
Grenzen, Streitgebiete).

> **Vollständige Kopierliste — Vorlage, Zeilenzahl, Zielgröße, was wegfällt:**
> `oekosystem-r2-auftrag.md` §2. Zusammen rund 1.200 Zeilen Ökosystem-Zeichenschicht
> aus rund 2.300 Zeilen Vorlage.

### Was daraus folgt

`regionEntry.source` (`map-features-region-feature-normalization.js:22`) ist der
Unterscheider, auf den 19 Dateien verzweigen — **immer als Verweigerung, nie als
Verteilung.** Ein früherer Entwurf wollte daraus Fähigkeitsprüfungen machen und
einen Entitäts-Deskriptor durch acht Nahtstellen reichen.

**Das ist gestrichen.** Ökosystem läuft nie durch die politischen Pfade, also
sehen deren Wachen es nie. Damit entfallen ersatzlos:

- der Deskriptor und die acht Nahtstellen
- die Frage, ob `activeRegionGeometryEdit` ein `entity`-Feld bekommt — Ökosystem
  hat schlicht seine **eigene** Zustandsvariable daneben
- die Sorge um die sieben zur Laufzeit überschriebenen Vertex-Handler; die
  überschreiben *die politischen*, unsere sind unberührt

Der Preis ist **Drift** — zwei Vertex-Editoren, die auseinanderlaufen können.
Bewusst in Kauf genommen: die Kopien sind kleiner als ihre Vorbilder, und falls
die beiden je zusammengeführt werden, macht man das später mit zwei sichtbaren
Beispielen statt heute blind.

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

Ausgerollt wird **behutsam und in dieser Reihenfolge**. Jede Stufe endet mit etwas,
das der Owner **anschauen** kann — erst danach beginnt die nächste. Eins nach dem
andern.

### R1 — Die Ebene existiert

Modus „Ökosystem" im Edit-Mode. Man schaltet um und sieht **die Karte**: Kacheln,
Wege, Orte — und eine leere Ökosystem-Ebene. Sonst nichts.

*Fertig, wenn:* der Modus umschaltbar ist, die Karte darunter vollständig steht und
ein Moduswechsel hin und zurück nichts kaputt macht.

> Bewusst eine eigene Stufe: Der Moduseintrag muss an **fünf Stellen** stimmen
> (§3), und wenn eine fehlt, fällt er **stumm** zurück. Das will man isoliert
> gesehen haben, bevor Daten im Spiel sind.

### R2 — Erste Geometrie

Tabellen, Endpoint, Repository — dann die eigene Zeichenschicht, abgeschrieben von
den politischen Werkzeugen (§4): Kontextmenü, Fläche anlegen, Ecken ziehen, Kante
teilen.

*Fertig, wenn:* eine gezeichnete Fläche gespeichert wird, den Reload überlebt —
und `git status` **keine Änderung an politischen Dateien** zeigt.

Das ist der große Brocken — rund **2.000 Zeilen neu, null geändert** — und damit zu
groß für eine Sitzung. **`oekosystem-r2-auftrag.md` schneidet R2 in drei einzeln
abnehmbare Stufen** (Daten+API → Darstellung → Zeichnen) und enthält die
vollständige Kopierliste sowie die fertigen Prompts.

### R3 — Der Owner zeichnet einen Wald

Kein Code. **Abnahme.** Eine echte Fläche, von Hand gezeichnet, mit dem Werkzeug,
das die Editoren später benutzen.

*Fertig, wenn:* es sich gut anfühlt. Wenn nicht, wird R2 nachgeschärft, bevor
irgendetwas darauf aufbaut.

### R4 — Zuweisung aus dem Wiki

- **Wiki-Regionen werden ziehbar** und lassen sich per Drag'n'drop auf eine Fläche
  fallen lassen. Vorlage ist die vorhandene Territorien-Zuweisung
  (`js/territory/territory-drag-assignment.js`, 441 Zeilen) — dasselbe Muster, ohne
  Hierarchie.
- **Rechtsklick auf eine Fläche → erster Eintrag öffnet den Regioneneditor.**

*Fertig, wenn:* eine gezogene Wiki-Region an der Fläche hängt und das
Labels-Häkchen (§3.1) bestätigt, dass der Name zum Standard-Label darunter passt.

### R5 — Den Regioneneditor gestalten

**Erst jetzt.** Wenn feststeht, was zugewiesen wird und wie es sich anfühlt, wird
die Übersicht entworfen (§8) — nicht vorher auf Verdacht.

### Später, ausdrücklich nicht jetzt

| | |
|---|---|
| Öffentliche Ebene + Kill-Switch | erst wenn Nutzer sie sehen sollen |
| **Routing** | als **erster Abnehmer** fertiger Regionen (`oekosystem-instruction.md`) |
| Kräuter, Reisesimulation | als weitere Abnehmer |

> 🔴 **Routing ist in R1–R5 NICHT enthalten.** Die Wirkungen kommen später und
> **modular**. Diese Stufen liefern Flächen mit Eigenschaften, sonst nichts — und
> solange kein Abnehmer dranhängt, kann auch keiner kaputtgehen.

## 11. Die Entscheidung, die keine mehr ist

Ein früherer Stand dieses Dokuments hielt hier eine offene Frage fest: bekommt
`activeRegionGeometryEdit` (`js/app/runtime-state.js:166`) ein `entity`-Feld, oder
läuft eine zweite Instanz?

**Die Frage existierte nur unter der Annahme, dass wir den politischen Zustand
mitbenutzen.** Mit der harten Regel aus §4 fällt sie weg: Ökosystem bekommt seine
**eigene** Zustandsvariable daneben, additiv, und der politische Singleton bleibt
unangetastet.

Es bleibt eine Lehre, die weiterträgt:

> Die naheliegendste Frage beim Erweitern eines Systems — „wie parametrisiere ich
> das Vorhandene?" — setzt voraus, dass Erweitern und Ändern dasselbe sind. In
> einer Anwendung ohne Build-Schritt, wo alles global ist, sind sie es nicht.
> **Danebenstellen ist oft billiger als Umbauen, und immer sicherer.**
