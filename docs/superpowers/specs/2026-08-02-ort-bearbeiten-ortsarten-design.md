# „Ort bearbeiten“ — Umbenennung + zweites Auswahlmenü „Art“ (Entwurf)

**Stand:** 2026-08-02 · **Herkunft:** Owner-Auftrag (Valentin, 2026-08-02)

> „zunächst soll es ‚Ort bearbeiten‘ heißen (auch im WikiSync-Menü nicht ‚Siedlungen‘ sondern
> ‚Orte‘) und wir wollen nicht nur dörfer, städte, usw., sondern alle möglichen ortstypen (im
> wiki siedlungstypen) abbilden. das problem is: es sind zu viele.“
>
> Präzisierung (Owner, dieselbe Sitzung): „es geht uns übrigens hauptsächlich ums erstellen
> (rechtsklick neue -> ort) … ich glaube alles was wir wollen fällt eigentlich als Besondere
> Bauwerke/Stätten. wenn da alles reinfällt könnte man ein 2. auswahlmenü machen und die ganzen
> bisherigen ortsarten nach häufigkeit sortieren und mit einer eingabemaske filtern, um z. B.
> ‚Brücke‘ auszuwählen“.

---

## 1. Datenlage — gemessen, nicht geschätzt

Alle Zahlen live am 2026-08-02 aus der Wiki-API erhoben (`https://de.wiki-aventurica.de/de/api.php`,
`prop=categoryinfo`, Einzelabfragen, keine Schleifen). Es sind **Artikelzahlen je Wiki-Kategorie**,
nicht Kartenpunkte.

### 1.1 Das Wiki hat keine flache Ortstypen-Liste

Es hat mehrere **orthogonale Achsen**, die sich überschneiden:

| Achse (Wiki-Kategorie) | Unterkategorien | Beispiele mit Artikelzahl |
|---|---:|---|
| `Siedlung nach Größe` | 7 | Dorf, Kleinstadt, Mittelgroße Stadt, Großstadt, Metropole (Siedlungsgröße), Siedlung unbekannter Größe, Unbewohnte Siedlung |
| `Siedlung nach Art` | 14 | Ruine 111, Oase 24, Eshbathya 13, Unterirdische Siedlung 10, Hof (Thorwal) 9, Hof 8, Zwergenstadt 6, Wehrhof 6, Elementare Stadt 6, Gut 4, Tiefe Stadt 3, Schwimmende Siedlung 2, Planstadt 1 |
| `Bauwerk nach Art` | 37 | Festung 421, Straße 143, Palast 125, Tempel 95, Platz 81, Turm 70, Stadttor 57, Statue 43, Brücke 40, Binge 32, Arena 22, Theater 21, Pyramide 18, … Akademie 0 |
| `Bauwerk nach Verwendung` | 23 | Wohnhaus 119, Kloster 72, Kontor 58, Gildenhaus 50, Verwaltungsgebäude 49, Grabanlage 41, Garnison 31, Bibliothek 28, Karawanserei 26, Gestüt 25, … Stall 0, Remise 0 |
| Kult- und Höhlenstätten (2026-07-28 vom Owner ergänzt) | ~14 | Heiligtum 41, Höhle 35, Schrein 30, Unheiligtum 29, Kultstätte 26, Steinkreis 13, Sphärenruptur 7, Grotte 7, Hexentanzplatz 6, Drachenhort 3, Toteninsel 2, Feentor 2 |

Zusammengenommen rund **90 Namen**. Die Verteilung ist extrem langschwänzig: Festung allein hat
mehr Artikel als die unteren 30 Kategorien zusammen, ein Dutzend Kategorien hat 0–3 Artikel.

### 1.2 Warum es sich nach „zu viele“ anfühlt

Der heutige Dialog wirft davon **6 Werte in ein einziges Feld** ([index.html:1162](../../../index.html)):
`dorf · kleinstadt · stadt · grossstadt · metropole · gebaeude`. Fünf davon sind die
**Größen**-Achse, `gebaeude` ist ein Sammeltopf für **alle** anderen Achsen.

Es ist also nicht eine zu lange Liste, sondern eine **zweidimensionale Taxonomie, die in eine
Dimension gepresst wird**. Trennt man die Achsen, ist die Zahl kein Problem mehr — sie wird zu
einer normalen durchsuchbaren Auswahl.

### 1.3 Was es schon gibt (und nicht neu gebaut werden darf)

| Vorhanden | Wo | Bedeutung für diesen Entwurf |
|---|---|---|
| Kontextmenü sagt bereits **„Neuer Ort“** | [index.html:251](../../../index.html) | Der Einstiegspunkt ist schon richtig benannt. Nur der Dialog dahinter sagt „Siedlung“. |
| `building_type` (VARCHAR(120)) in `wiki_sync_pages` | [settlements.php:130](../../../api/_internal/wiki/settlements.php) | Genau dieses Feld, aber nur für `settlement_class='gebaeude'` und nur vom Crawl gefüllt — nie vom Editor. |
| `AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES` (24 Einträge) | [place-kinds.php](../../../api/_internal/wiki/place-kinds.php) (bis 2026-08-03 in `settlements.php`) | Ausdrücklich „EINE Quelle der Wahrheit“ für den Typkatalog. Speist Online-Crawl **und** Dump-Phase. |
| `building_type` reist im Karten-Payload mit | [map-features.php:457](../../../api/app/map-features.php) | Als `properties.wiki_settlement.building_type`. |
| Infobox ersetzt „Besondere Bauwerke/Stätten“ schon durch den genauen Typ | [marker-entry.js:47](../../../js/map-features/map-features-location-marker-entry.js) und `:144` | Die Anzeigestrecke existiert bereits — sie greift nur, wenn der Punkt an einer Wiki-Seite hängt. |
| `building_type` ist schon ein Unterfilter der Ortsliste | [review-settlement-list.js:311](../../../js/review/review-settlement-list.js) | Inklusive „ohne Art“ als eigene, bewusst sichtbare Antwort. |
| `is_ruined` ist ein **eigenes Merkmal**, kein Typ | [settlements.php:209](../../../api/_internal/wiki/settlements.php), `create/update_point` | Infobox hängt „(Ruine)“ selbst an. |
| Generischer Typeahead `attachTypeahead(inputEl, opts)` | [source-autocomplete.js:123](../../../js/ui/source-autocomplete.js) | Reine Render-Funktion + DOM-Verdrahtung, `options.search(term, signal)` frei steckbar, ARIA fertig. |
| innerorts/ausserorts-Regel aus `\|Standort=` | [place-scope.php](../../../api/_internal/wiki/place-scope.php) | Kennt bereits, was auf eine Weltkarte gehört und was in eine Stadt. |

---

## 2. Entscheidung

**Ein zweites, optionales Auswahlmenü „Art“ unter „Ortsgröße“.** Es beschreibt den Ort, es
verändert **nicht**, wie er gezeichnet wird.

### 2.1 Was sich NICHT ändert

`feature_subtype` bleibt exakt die heutigen sechs Werte. Es ist in Wahrheit kein Typ, sondern die
**Darstellungsstufe**: Radius, Form, Rahmenbreite, Icon, Label-Größe, ab welchem Zoom das Label
erscheint, welcher Ebenen-Schalter den Ort ausblendet ([js/config.js:476](../../../js/config.js)
ff.). 90 Werte dort hinein hieße: 90 Icons, 90 Zoomstufen, 90 `toggle…`-URL-Parameter und eine
Migration aller Bestandspunkte. Das wird **nicht** gemacht.

Karte, Marker, Labels, Ebenen-Schalter, `queryParam`-Namen, Routing: unverändert.

### 2.2 Was dazukommt

Ein Feld **„Art“** am Kartenpunkt, gespeichert als `properties.place_kind` (String, `''` = leer).

- **Immer sichtbar**, bei jeder Ortsgröße — nicht nur bei „Besondere Bauwerke/Stätten“.
  *Begründung:* Oase (24), Hof (8+9), Unterirdische Siedlung (10), Zwergenstadt (6), Wehrhof (6),
  Elementare Stadt (6), Gut (4), Tiefe Stadt (3) sind im Wiki Siedlungs-**Arten** und haben
  zugleich eine Größe. Ein Feld, das nur bei `gebaeude` erscheint, könnte sie nie aufnehmen.
  Es kostet nichts, weil das Feld leer bleiben darf.
- **Optional.** Vorbelegung ist leer, Speichern ohne Art ist ein gültiger Zustand.
- **Durchsuchbar statt aufklappbar.** Eingabefeld + Trefferliste; tippen „Brü“ → **Brücke**.
  Bei leerem Feld / Fokus zeigt es die **ganze** Liste, nach Häufigkeit sortiert.

### 2.3 Woher die Liste kommt

Nicht hartkodiert im Frontend. Zwei Bestandteile:

1. **Das Vokabular** ist `AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES`, erweitert von 24 auf
   rund 90 Einträge (§3.1). Diese Konstante ist bereits die dokumentierte einzige Quelle der
   Wahrheit für den Typkatalog und speist Crawl **und** Dump — es kommt also keine zweite Liste
   dazu, die auseinanderlaufen könnte.
2. **Die Sortierung** ist die gemessene Häufigkeit aus den eigenen Daten:
   `SELECT building_type, COUNT(*) FROM wiki_sync_pages WHERE building_type <> '' GROUP BY building_type`,
   plus `properties.place_kind` der Kartenpunkte. Namen ohne Treffer stehen alphabetisch hinter
   den gezählten. Die Reihenfolge folgt damit eurer Datenlage, nicht einer Meinung.

> 💣 **Die Reihenfolge der Konstante ist tragend.**
> `avesmapsWikiDumpCategoryAssembleBuildingMap` behält den **ersten** Typ, der einen Titel
> beansprucht ([dump-category-layer.php](../../../api/_internal/wiki/dump-category-layer.php)) —
> eine spezifische Art muss vor ihrer Sammelkategorie stehen, sonst wird jeder Steinkreis als
> „Kultstätte“ abgelegt. Deshalb: **alle neuen Namen kommen ans Ende**, hinter `'Bauwerk'`.
> Dann klassifiziert der Dump keinen einzigen Bestandsartikel um. Die Sortierung der
> *Editor-Liste* ist davon unabhängig (sie kommt aus der Häufigkeit, §2.3.2).

### 2.4 Was in der Liste NICHT angeboten wird

Drei Namen fehlen in der Editor-Liste, aus drei verschiedenen Gründen:

| Name | Im Katalog? | Grund |
|---|---|---|
| `Ruine` | **ja** (der Crawl braucht ihn) | Ist bei euch ein **eigenes Merkmal** (`is_ruined`), und die Infobox hängt „(Ruine)“ selbst an. Sonst gäbe es „Festung“ und „Festung + Ruine“ doppelt. |
| `Bauwerk` | **ja** (der Crawl braucht ihn) | Die Sammelkategorie ohne Aussage — identisch mit „leer lassen“. |
| `Straße` (143) | **nein**, wird gar nicht erst aufgenommen | Ist ein **Weg**, kein Punkt. Gehört in `PATH_SUBTYPE_KEYS`, nicht hierher. |

Katalog 90 Einträge − 2 versteckte − 5 lineare = **83 wählbare Arten** (gemessen, §4).

### 2.5 Was NICHT Teil dieses Entwurfs ist

- Kein eigenes Kartensymbol je Art. (Ausdrücklich verworfen: Icon-Programm + Dauerstreit, welche
  Gruppen es gibt.)
- Keine Ausblendung der ~40 innerorts-Arten (Wohnhaus 119, Platz 81, Statue 43, Stadttor 57,
  Torbogen, Treppe, Kanalisation, Therme, Zunfthaus …). Sie stehen in der Liste; die vorhandene
  innerorts-Regel kann sie später nach unten sortieren, **falls** sie stören. Erst messen.
- Keine Rückwirkung auf die Bestands-Kartenpunkte. `place_kind` bleibt leer, bis jemand es
  setzt; die Wiki-Ableitung wirkt wie bisher.
- Keine Umbenennung von Tabellen, Spalten, Slugs oder `error.code`-Werten.

---

## 3. Umsetzung

### 3.1 Katalog erweitern — `api/_internal/wiki/settlements.php`

`AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES` behält seine 24 Einträge **in unveränderter
Reihenfolge** und bekommt drei angehängte Blöcke:

- **Bauwerk nach Art**, neu (32): Akademie, Amphitheater, Arena, Binge, Brücke, Brunnen, Damm,
  Deich, Eispalast, Fährstation, Feggagir, Gutshof, Hafen, Kanalisation, Kriegshafen, Labyrinth,
  Luftschiffhafen, Mauer, Plantage, Platz, Pyramide, Schloss, Stadion, Stadttor, Statue, Theater,
  Therme, Tor (Bauwerk), Torbogen, Treppe, Zoo, Äquadukt
- **Bauwerk nach Verwendung**, neu (22): Archiv, Bank, Bibliothek, Garnison, Gestüt, Gildenhaus,
  Grabanlage, Kaiserpfalz, Karawanserei, Kerker, Kontor, Labor, Lagerhaus, Museum, Observatorium,
  Remise, Siechenhaus, Stall, Verwaltungsgebäude, Wohnhaus, Zeughaus, Zunfthaus
- **Siedlung nach Art**, neu (12): Oase, Eshbathya, Hof, Hof (Thorwal), Zwergenstadt, Wehrhof,
  Gut, Unterirdische Siedlung, Tiefe Stadt, Schwimmende Siedlung, Elementare Stadt, Planstadt

`Straße` wird bewusst **nicht** aufgenommen (§2.4). Ergebnis: 90 Einträge.

Dazu eine zweite Konstante `AVESMAPS_PLACE_KIND_HIDDEN` = `['Ruine', 'Bauwerk']` mit dem Grund
als Kommentar, damit der Editor-Endpunkt filtern kann, ohne den Katalog zu beschneiden.

### 3.2 Neuer Lese-Endpunkt — `api/app/place-kinds.php`

`GET`, öffentlich lesbar wie die übrigen `api/app/`-Endpunkte. Antwortet im kanonischen Umschlag:

```json
{ "ok": true, "kinds": [ { "kind": "Festung", "count": 421 }, { "kind": "Brücke", "count": 40 } ] }
```

- `kind`: Name aus dem Katalog (ohne die versteckten aus §2.4).
- `count`: Treffer aus `wiki_sync_pages.building_type` **plus** `properties.place_kind` der
  Kartenpunkte, absteigend sortiert; Gleichstand und `0` alphabetisch.
- Cachebar (`Cache-Control: public, max-age=…`) — die Liste ändert sich selten.

⚠️ Kein DDL im Lesepfad (siehe `docs/`-Memo zur Unprüfbarkeit solcher Pfade). Die Zählung ist
ein reiner `SELECT`; existiert eine Tabelle nicht, ist die Antwort `count: 0`, kein Fehler.

### 3.3 Schreibpfad — `api/_internal/map/features.php`

Je eine Zeile in `avesmapsCreatePointFeature` (~1333) und im `update_point`-Zweig (~1254), direkt
neben dem bestehenden `is_ruined`:

```php
$placeKind = avesmapsReadPlaceKind($payload['place_kind'] ?? '');
if ($placeKind !== '') { $properties['place_kind'] = $placeKind; } else { unset($properties['place_kind']); }
```

`avesmapsReadPlaceKind()` ist rein und testbar: trimmt, kappt auf 120 Zeichen (wie
`building_type`), und **rastet case-insensitiv auf einen Katalognamen ein**, wenn einer passt —
sonst kämen „Brücke“, „brücke“ und „Bruecke“ als drei Arten in die Liste. Ein Name außerhalb des
Katalogs wird unverändert übernommen (das Vokabular soll nicht blockieren), aber nicht
eingerastet.

Die Property reist automatisch mit: `properties_json` ist bereits Teil des Audit-Snapshots und
der `update_point`-Spaltenliste — **Verlauf und „Rückgängig“ funktionieren ohne Zutun**.

### 3.4 Anzeige — `js/map-features/map-features-location-marker-entry.js`

An beiden Stellen (`:47` schwebende Box, `:144` Popup) bekommt `typeLabel` eine Vorstufe:

```
place_kind (eigener Wert)  >  wiki_settlement.building_type  >  locationTypeLabel
```

Eigener Wert schlägt Wiki — dieselbe Vorrangregel wie bei Wappen und Abenteuer-Covern. Das
„(Ruine)“-Anhängsel bleibt unverändert dahinter.

### 3.5 Editor-Oberfläche — `index.html` + `js/review/`

Neues Feld direkt unter „Ortsgröße“ im Abschnitt **Identität**
([index.html:1159–1172](../../../index.html)):

```html
<label class="location-report-form__field">
  <span>Art</span>
  <input id="location-edit-place-kind" name="place_kind" type="search" maxlength="120"
         placeholder="z. B. Brücke – leer lassen, wenn unbekannt" />
</label>
```

Verdrahtet über den **vorhandenen** `attachTypeahead()` aus
[js/ui/source-autocomplete.js:123](../../../js/ui/source-autocomplete.js) — kein neues Widget:

- `minChars: 0`, damit Fokus die ganze Liste zeigt (Vorgabe dort ist 2).
- `options.search` filtert **im Speicher** über die einmal geholte Liste aus §3.2. Kein
  Netzverkehr je Tastendruck.
- Trefferzeile zeigt den Namen und rechts die Häufigkeit, damit die Sortierung erklärt ist.

Berührt: `js/review/review-locations.js` (Feld beim Öffnen füllen, in `resetLocationEditForm`
leeren), `js/review/review-editor-submit.js` (Wert mitsenden).

> ✅ **Geprüft, keine Änderung nötig.** Der Typeahead legt seine Box an `document.body`. Die
> z-index-Leiter trägt das bereits: `--z-autocomplete` = 1600 gegen 1260 des Dialog-Overlays,
> und `elementFromPoint` auf der offenen Liste trifft die Liste, nicht das Overlay.

### 3.6 Umbenennung „Siedlung“ → „Ort“

Nur **nutzersichtbarer** Text. Maschinenwerte (`settlement_class`, `wiki_sync_pages`,
`gebaeude`, `settlement_*`-Funktionsnamen, `<option value>`) bleiben — AGENTS.md §8.

| Datei | Heute | Neu |
|---|---|---|
| `index.html:1138` | `<h2>Siedlung bearbeiten</h2>` | **Ort bearbeiten** |
| `index.html:1139` | aria-label „Siedlungsbearbeitung schließen“ | „Ortsbearbeitung schließen“ |
| `index.html:537` | Knopf „Siedlungen bearbeiten“ | **Orte bearbeiten** |
| `index.html:537` | title „Öffnet den Siedlungseditor …“ | „Öffnet den Ortseditor …“ |
| `index.html:557` | Platzhalter „Siedlung suchen …“ / aria „Siedlungen durchsuchen“ | „Ort suchen …“ / „Orte durchsuchen“ |
| `index.html:1156/1170` | title „… aus der verbundenen Wiki-Siedlung übernehmen“ | „… aus dem verbundenen Wiki-Ort übernehmen“ |
| `index.html:1176–1187` | Abschnitt „Wiki-Siedlung“, „Siedlung aus dem Wiki“, Platzhalter, aria | „Wiki-Ort“, „Ort aus dem Wiki“, … |
| `html/wiki-sync-settlement-editor.html` | 31 Vorkommen | dieselbe Regel, Datei**name** bleibt |

Der Dateiname `wiki-sync-settlement-editor.html` bleibt: er wird dynamisch geladen und hängt an
`ASSET_VERSION` — ein Umbenennen wäre reines Risiko ohne Nutzen.

⚠️ **`ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen**, sobald
`html/wiki-sync-settlement-editor.html` angefasst wird (AGENTS.md §7).

---

## 4. Prüfen

**Einheitstests (neu, laufen ohne Datenbank):**

- `avesmapsReadPlaceKind()`: leert Leerraum, kappt bei 120, rastet `"brücke"` → `"Brücke"` ein,
  lässt `"Wachhäuschen"` unverändert durch, `""` bleibt `""`.
- Katalog: enthält 90 Einträge, die ersten 24 sind **byte-gleich** die alten (das ist der Test,
  der die tragende Reihenfolge schützt), `Straße` fehlt, `Ruine`/`Bauwerk` sind im Katalog aber
  nicht in der Editor-Liste.
- `avesmapsWikiSettlementMatchBuildingType()` liefert für einen Titel mit den Kategorien
  `[Kultstätte, Steinkreis]` weiterhin `Steinkreis` — Beweis, dass die Erweiterung nichts
  umklassifiziert.
- Typeahead-Filter (Node, ohne DOM): „brü“ trifft „Brücke“, Groß/Klein egal, Sortierung nach
  `count` absteigend, dann alphabetisch.

**Von Hand, lokal (`php -S 127.0.0.1:<freier port> -t .`, dann `?edit=1`):**

1. Rechtsklick → „Hier hinzufügen“ → „Neuer Ort“: Dialog heißt **„Ort bearbeiten“**, hat
   „Ortsgröße“ **und** „Art“.
2. In „Art“ „brü“ tippen → „Brücke“ erscheint, Auswahl per Klick und per Tastatur (↓/Enter).
3. Speichern, Punkt anklicken: Infobox zeigt **„Brücke“** statt „Besondere Bauwerke/Stätten“.
4. Punkt erneut öffnen: „Art“ ist gefüllt. Art leeren, speichern → Infobox zeigt wieder die
   Ortsgröße.
5. Ein Dorf anlegen **ohne** Art → speichert durch, Infobox zeigt „Dorf“.
6. Editor-Verlauf: der Schritt steht drin, „Rückgängig“ stellt die alte Art wieder her.
7. WikiSync-Reiter: Knopf heißt **„Orte bearbeiten“**, Suchfeld „Ort suchen …“.
8. Konsole beim Laden fehlerfrei (außer den bekannten „keine API-Konfiguration“-Meldungen).

**Nach dem Deploy (einzelne Proben, keine Schleifen — STRATO):**

- `GET /api/app/place-kinds.php` antwortet `ok: true` mit 83 Einträgen, `Festung` oben.
- Ein bestehender Bauwerks-Punkt mit Wiki-Bindung zeigt seinen `building_type` unverändert.

---

## 5. Fertig, wenn

- Der Dialog heißt „Ort bearbeiten“, der WikiSync-Knopf „Orte bearbeiten“, und in beiden
  Dateien steht kein nutzersichtbares „Siedlung“ mehr, das einen Ort meint.
- Ein Editor kann beim Anlegen **und** beim Bearbeiten eine Art aus 83 Werten filtern und
  wählen, oder das Feld leer lassen.
- Die gewählte Art steht in der Infobox, im Verlauf und in der Ortsliste.
- Karte, Marker, Labels, Ebenen-Schalter und URL-Parameter sind nachweislich unverändert.
- Kein Bestandsartikel wurde vom Dump umklassifiziert (Test aus §4).

---

## 6. Nachtrag aus der Umsetzung (2026-08-03)

Vier Dinge kamen beim Bauen anders als hier geplant. Sie stehen hier, nicht als stille Abweichung
im Code.

**(a) Der Katalog zog in eine eigene Datei.** Geplant war, ihn in `wiki/settlements.php` stehen zu
lassen. Das geht nicht: der Karten-Schreibpfad (`map/features.php`) braucht ihn ebenfalls, und
`settlements.php` ist gross, zieht `place-scope` + `coat-display` nach und macht DDL. Der Katalog
und die reinen Helfer liegen jetzt in **`api/_internal/wiki/place-kinds.php`**; `settlements.php`
`require_once`t sie. Inhalt und tragende Reihenfolge sind unveraendert uebernommen.

**(b) Es gab schon einen Ausschluss — und er ist jetzt der einzige.**
`avesmapsWikiSettlementIsExcludedBuildingType()` entscheidet seit jeher, dass Straße, Mauer, Damm,
Deich, Kanalisation und Äquadukt *lineare Infrastruktur* sind und kein Ort. Die Editor-Liste
benutzt sie mit, statt die Frage ein zweites Mal zu beantworten. Deshalb **83 statt 88** wählbare
Arten: Mauer/Damm/Deich/Kanalisation/Äquadukt stehen sehr wohl im Katalog (sie *sind*
Unterkategorien von „Bauwerk nach Art“, der Katalog spiegelt das Wiki ehrlich) — dass sie kein
wählbarer Ort sind, sagt eine Stelle, für alle. Die Funktion ist mit nach `place-kinds.php`
gezogen, ohne eine Zeile zu ändern.

**(c) `attachTypeahead` konnte `minChars: 0` gar nicht ausdrücken.** Der Wächter lautete
`Number(options.minChars) > 0 ? ... : 2` — eine ausdrückliche 0 sah aus wie „nicht angegeben“
und fiel auf 2 zurück, das leere Feld blieb stumm. Behoben, und zusätzlich öffnet die Liste
jetzt **bei `focus`**, aber nur wenn `minChars === 0` — bei jedem anderen Aufrufer (Quellensuche)
wäre das eine Anfrage ohne Suchbegriff gegen einen offenen Katalog.

**(d) Die doppelte Typzeile ist eine Funktion geworden.** Die Vorrangregel stand zweimal wortgleich
inline (schwebende Box + Popup); die dritte Stufe wäre die dritte Kopie gewesen. Jetzt
`locationTypeLabelForDisplay(location)` mit eigenem Test.
⚠️ Die „(Ruine)“-Regel ist dabei **bewusst unverändert** geblieben: der Zusatz hängt nur an
einer Art, nie an der blossen Ortsgrösse, und liest nur `wikiSettlement.is_ruined`, nicht das
eigene `is_ruined` des Kartenpunkts. Beides wäre vertretbar zu ändern — aber nicht nebenbei.
