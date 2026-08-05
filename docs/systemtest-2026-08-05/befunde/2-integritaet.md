# Agent 2 — Integrität und Stabilität der Datenlage

## Kern

Die Schemapflege ist besser als ihr Ruf: **kein einziges DDL zwischen `beginTransaction()` und
`commit()`** (alle PHP-Dateien statisch geprüft), jede nachgerüstete `NOT NULL`-Spalte hat einen
Default, und die Startwert-Blöcke sind je Spalte einzeln bewacht. Auch die Kartendaten selbst sind
sauber: 0 doppelte `public_id`, 0 leere Namen, 0 Koordinaten ausserhalb 0..1024, 0 doppelte
Ortsnamen, 0 ins Leere zeigende `source_id`. `/api/locations/` und `map-features` stimmen bei
allen 4.854 Punkten in Menge und Koordinate überein.

Die Löcher liegen **an den Rändern, wo etwas gelöscht wird** — und genau das ist für diesen
Systemtest heikel, weil gleich elf Agenten Testobjekte anlegen und wieder entfernen:

1. **Löschen räumt die Quellen nie mit weg.** Verwaiste `feature_sources`: 284 citymap, 123 region
   (3.471 Verweise), 84 path (1.218), 9 settlement. `DELETE FROM sources` existiert nirgends —
   132 Katalogzeilen zeigt nichts mehr an. (B2, B3)
2. **Die drei Wiki-Abgleicher schreiben ganz ohne Transaktion** über 4–6 Tabellen je Objekt; der
   Sync-Löschpfad vergisst zudem `citymap_related` und `citymap_link`, die der Handlöschpfad räumt. (B3, B4)
3. **`/api/locations/` — der stabile öffentliche Vertrag — vergibt 2.079 von 4.854 Namen
   fortlaufend** (`Kreuzung-1…2079`). Eine einzige gelöschte Kreuzung benennt bis zu 2.078 Knoten
   um; Routen und geteilte Links reisen als Name. (B1)
4. **14 Kraftlinien zeigen auf gelöschte Endpunkte**, 516 Abenteuer-Zuordnungen auf gelöschte
   Label — davon 25 unrettbar unsichtbar. (B5, B6)

---

### B1 `/api/locations/` vergibt für 43 % aller Zeilen fortlaufende Namen, die kein Objekt festhalten
- **Kategorie:** AKUT
- **Fundstelle:** api/_internal/routing/network-data.php:19,33-36,127-132 · api/locations/index.php:66
- **Beobachtung:** `avesmapsBuildRouteLocationData()` ersetzt den gespeicherten Namen jedes Knotens,
  dessen Name mit `Kreuzung` beginnt, durch `'Kreuzung-' . $clientCrossingIndex` — einen Zähler, der
  in Payload-Reihenfolge hochläuft. Das betrifft 2.079 der 4.854 Zeilen (42,8 %). Auch
  `is_crossing` wird aus dem so erfundenen Namen abgeleitet. Der Zähler ist nirgends gespeichert:
  in `map_features` heissen dieselben Knoten `Kreuzung` (1.296×), `Kreuzung-41` (329×),
  `Kreuzung-auto-<n>` (185×) — 309 verschiedene Namen für 2.078 Knoten. Simuliert man die Löschung
  **einer** Kreuzung, bezeichnen danach **2.078** (erste Kreuzung) bzw. **1.039** (mittlere)
  `Kreuzung-N`-Namen einen anderen Knoten. `POST /api/route/` nimmt `from`/`to` als Namen
  (AGENTS.md §4: stabiler Vertrag), und Wegpunkte reisen in geteilten Links als Name.
- **Erwartet:** Ein Name im stabilen Vertrag hält das Objekt fest — entweder der gespeicherte Name,
  oder `public_id` als Auflösungsachse für `from`/`to`, oder ein einmal vergebener, persistierter
  Kreuzungsname.
- **Beleg:** Portierung der Serverlogik nach Node und Abgleich gegen die Momentaufnahme:
  `work/a4-crossing-index.js` reproduziert **4.854 von 4.854** Namen aus `locations-api.json`
  byteweise — die Portierung ist also die echte Regel. Verschiebungsmessung im selben Lauf.
  Client- und Serverzählung stimmen heute überein (0 Abweichungen) — die Instabilität ist zeitlich,
  nicht seitenübergreifend.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B2 Ein gelöschtes Kartenobjekt lässt seine Quellenverweise für immer zurück
- **Kategorie:** AKUT
- **Fundstelle:** api/_internal/map/features.php:2729-2816 (`avesmapsDeleteMapFeature`) · Tabelle `feature_sources`
- **Beobachtung:** Das Löschen ist weich (`UPDATE map_features SET is_active = 0`). Danach räumt
  die Funktion **nur** den Kraftlinien-Sonderfall auf (Quellen auf das neue Ankersegment umhängen,
  Z. 2764-2782) und die Landschaftskaskade. `feature_sources` wird für Ort, Weg oder Region nie
  angefasst. Gemessen am Produktivbestand zeigen ins Leere: **123** `region:`-Einträge mit 3.471
  Verweisen, **84** `path:` mit 1.218, **9** `settlement:` mit 25. Dazu kommt: es gibt in der
  gesamten Codebasis **kein `DELETE FROM sources`** — der gemeinsame Katalog wächst nur; 132 der
  1.342 echten Katalogzeilen werden von niemandem mehr referenziert.
- **Erwartet:** Entweder räumt der Löschpfad die Verweise mit (wie er es für Kraftlinien tut), oder
  es gibt einen Aufräumlauf. Sonst wächst die Tabelle monoton und ein späterer `UNIQUE`-Schritt
  (der Kommentar in feature-sources.php:65-73 plant genau den auf `sources.wiki_key`) stolpert
  über Zeilen, die niemand mehr sieht.
- **Beleg:** Code gelesen (Zeilen oben). Zahlen aus `work/a3-refine.js`, Abschnitt 5, gegen
  `snapshots/map-features.json` (11.486 Features) und `snapshots/citymaps.json`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Der Karten-Sync löscht anders als die Hand — und lässt zwei Kindtabellen stehen
- **Kategorie:** AKUT
- **Fundstelle:** api/_internal/wiki/citymap-sync.php:1835-1869 (`avesmapsCitymapRemoveVanished`) gegen api/_internal/app/citymaps.php:2051-2078 (`avesmapsDeleteCitymap`)
- **Beobachtung:** Der Handlöschpfad räumt ausdrücklich in einer Transaktion
  `citymap_related` (beidseitig), `citymap_place`, `citymap_type`, `citymap_link`, dann die Karte —
  sein Kommentar sagt sogar warum („This schema has no ON DELETE CASCADE"). Der Sync-Löschpfad
  räumt nur `citymap_place`, `citymap_type` und die Karte. `citymap_related` und `citymap_link`
  bleiben mit toter `citymap_id` liegen; `feature_sources` in beiden Pfaden. Gemessen: **284 von
  631** `citymap:`-Quelleneinträgen zeigen auf eine Karte, die in der Sammlung nicht mehr steht.
  Zusätzlich läuft `avesmapsCitymapRemoveVanished` **ohne Transaktion** — drei einzelne `DELETE`
  je Karte in einer Schleife.
- **Erwartet:** Ein Löschvorgang, zwei Aufrufer — der Sync sollte `avesmapsDeleteCitymap` benutzen
  oder mindestens dieselben fünf Tabellen räumen, in einer Transaktion.
- **Beleg:** Beide Funktionen vollständig gelesen. `grep -c beginTransaction
  api/_internal/wiki/citymap-sync.php` → **0**. Zahlen aus `work/a3-refine.js` Abschnitt 5.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B4 Die drei Wiki-Abgleicher schreiben über 4–6 Tabellen ohne jede Transaktion
- **Kategorie:** AKUT
- **Fundstelle:** api/_internal/wiki/citymap-sync.php · adventure-sync.php · publication-sync.php
- **Beobachtung:** `grep -c beginTransaction` liefert für alle drei Dateien **0**.
  `avesmapsCitymapReconcileEntity()` (citymap-sync.php:1639 ff.) schreibt je Karte nacheinander
  `citymap`, `citymap_type`, `citymap_place`, `citymap_link`, `sources` und `feature_sources`.
  Der Abbruch mitten drin — auf STRATO ein realistischer Fall, der Pool ist an einem Dump-Lauf
  schon einmal zusammengebrochen (Memory `dump-holen-on2-fastcgi-kill`) — hinterlässt eine Karte
  ohne Typ, ohne Fundstellen oder ohne Quellen. Der Schrittzähler (`nextCursor`) rückt nur nach
  vollständig verarbeiteten Objekten weiter, ein Wiederanlauf würde also reparieren — aber nur,
  weil `INSERT IGNORE`/Upsert das zufällig tragen, nicht weil es zugesichert wäre.
- **Erwartet:** Eine Transaktion je Objekt (nicht je Schritt — DDL läuft in `EnsureTables` davor,
  die Hausregel bliebe eingehalten).
- **Beleg:** grep oben; `avesmapsCitymapReconcileEntity` und `avesmapsCitymapReconcileStep`
  vollständig gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B5 14 Kraftlinien-Segmente hängen an Endpunkten, die es nicht mehr gibt
- **Kategorie:** AKUT
- **Fundstelle:** Daten: `map-features.json`, `properties.from_public_id`/`to_public_id` der 162 `feature_type='powerline'` · Code: api/_internal/map/features.php:1553-1570 gegen :2729
- **Beobachtung:** Beim Anlegen prüft `avesmapsCreatePowerlineFeature` beide Endpunkte hart
  (`avesmapsFetchEditablePointFeature` + „nur Nodix-Orte"). Beim Löschen eines Ortes prüft niemand,
  ob Kraftlinien darauf zeigen. Ergebnis im Bestand: **14 Segmente mit einem toten Endpunkt**, auf
  **6** verschiedene verschwundene Ids verteilt (`8d75b8ba…` von 4 Segmenten genannt, `a5e72c86…`
  von 3, `ef5b84b6…` von 2, `fa83a5b6…` von 2). Betroffen u. a. „Strick des Schwarzen Mannes",
  „Konzilslinie", „Nelkra-Linie", „Hexenband(-schleife)", „Drachenblick". Die Linie zeichnet
  weiter (die Geometrie steht im Feature), aber „verbindet A mit B" ist tot — und der
  Kraftlinien-Editor sortiert Segmente über genau diese Kette.
- **Erwartet:** Der Löschpfad eines Nodix-Ortes verweigert (oder repariert) solange Kraftlinien
  daran hängen — dieselbe Prüfung, die das Anlegen schon hat, nur andersherum.
- **Beleg:** `work/a3-refine.js` Abschnitt 6 listet alle 14 mit `public_id`. Beide Codestellen gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Aufgelöste Orts-Zuordnungen veralten still — 516 Abenteuerzeilen zeigen auf gelöschte Label
- **Kategorie:** AKUT
- **Fundstelle:** api/_internal/app/adventure-resolve.php:393 ff. (`avesmapsResolvePlacesInTable`) · Tabellen `adventure_place.target_public_id`, `citymap_place.target_public_id`
- **Beobachtung:** Der Auflöser bearbeitet laut eigenem Kommentar nur Zeilen, die `unresolved`
  sind oder noch keinen Territoriumspfad haben. Eine **einmal aufgelöste** Zeile wird nie wieder
  angesehen — auch dann nicht, wenn ihr Ziel inzwischen gelöscht ist. Gemessen: **516
  `adventure_place`-Zeilen** (75 verschiedene Regionen, darunter Aventurien, Albernia, Maraskan,
  Nordmarken, Weiden, Raschtulswall, Khôm, Almada) tragen eine `target_public_id`, die im
  Kartenbestand nicht existiert; für **61 der 75** existiert ein Label **gleichen Namens unter
  anderer `public_id`** — das Label wurde also ersetzt, der Zeiger nicht. Dazu 14
  `citymap_place`-Zeilen. Der Client fängt das über `byRegionKey` teilweise ab: von den 516 werden
  **491 gerettet**, **25 nicht** (Wildermark, Elburische Halbinsel, Blautann, Kosch, Perricumer
  Land) — dort fehlt die Abenteuer-Sektion in der Infobox lautlos. Bei den Kartenzeilen retten
  alle 14.
- **Erwartet:** Der Auflöser prüft aufgelöste Zeilen gegen den lebenden Bestand und setzt tote
  Zeiger auf `unresolved` zurück (dann greift die vorhandene Auflösung von selbst).
- **Beleg:** Zählungen in `work/a3-refine.js` (Abschnitt 2) und einem Nachlauf mit einer
  wörtlichen Portierung von `avesmapsNormalizeAdventureKey`
  (js/map-features/map-features-adventures.js:78-88); Kontrollprobe: von den 465 Zeilen mit
  **lebender** `public_id` passt bei 465 auch der Schlüssel — der Rettungsweg ist also korrekt
  gemessen. Beide Indexbauer (adventures.js:150-170, citymaps.js:128-150) gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B7 Neun Ortspaare teilen sich eine `wiki_url` — teils die eines Abenteuers, teils eine Fremdseite
- **Kategorie:** KANN
- **Fundstelle:** `map-features.json`, `properties.wiki_url` auf `feature_type='location'`
- **Beobachtung:** 285 von 2.870 `wiki_url` werden von mehr als einem Feature getragen. Davon sind
  246 Gruppen `path|path` (die Segmente einer Strasse — laut AGENTS.md §11 die einzige legitime
  Teilung) und 15 `label|label`. Übrig bleiben **9 Gruppen aus lauter Orten**, davon zwei klar
  falsch: `…/Das_Erbe_von_Blaustein` (ein Abenteuer) steht als Quelle an **fünf** Orten
  (Junkergut Schwanbrück, Wirselgrund, Burg Blaustein, Schotterfels, Metanar), und
  `herzogtum-weiden.net/…/hollerheide` an **vier** (Hirschensprung, Weissengrat, Hollerstockhöhe,
  Weiler Fialgrau). Die übrigen sieben sind echte Namensverwandtschaften (Jergan / Jergan
  (Wasserfall), Rathila / Fährstation (Rathila)) — dort ist die geteilte URL vertretbar.
  Dazu 10 Gruppen `label|location` und 4 `location|path`.
- **Erwartet:** Die `wiki_url` eines Ortes ist sein eigener Artikel; ein Abenteuer oder eine
  Fanseite gehört in `feature_sources`, nicht in das Wiki-Feld.
- **Beleg:** `work/a1-mapfeatures.js`, Abschnitt 5 (vollständige Gruppenliste im Lauf).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 Vier Zeiger zwischen Landschaftsflächen und ihren Beschriftungen zeigen ins Leere
- **Kategorie:** KANN
- **Fundstelle:** `ecosystem-areas.json` (`label_public_id`) · `map-features.json` (Label-`ecosystem_region_public_id`)
- **Beobachtung:** **3** `ecosystem_area`-Zeilen tragen ein `label_public_id`
  (`79beff5f-…`, `18ae5738-…`, `dde61e89-…`), zu dem es kein aktives Label gibt. Umgekehrt zeigt
  **1** Label („Südthorwal") auf die Region `d343cfea-be8a-447c-aa0a-28c86dfa095c`, zu der keine
  Fläche existiert. Beide Richtungen sind gemäss Memory `landschaften-flaeche-label-kopplung`
  „ein Ding"; die Löschkaskade, die genau das verhindern soll, ist mit
  `AVESMAPS_ECOSYSTEM_CASCADE_ENABLED = false` abgeschaltet.
  *(Nicht als Befund gezählt: die 382 Flächen in Regionen ganz ohne Label — 372 davon
  automatisch benannt (`Insel-001` …), 8 sind die Klimabänder, die per Entwurf kein Label
  tragen. Das ist der bekannte Zustand nach dem V7-Grenzimport.)*
- **Erwartet:** Kein Zeiger ohne Gegenstück; solange die Kaskade aus ist, wenigstens ein
  Aufräumlauf oder ein Hinweis im Editor.
- **Beleg:** `work/a1-mapfeatures.js`, Abschnitt 14; Aufschlüsselung der 382 in einem Nachlauf.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B9 48 Karten der Sammlung haben überhaupt keine Adresse
- **Kategorie:** KANN
- **Fundstelle:** `citymaps.json` — `map_url` + `map_local_url` + `links`
- **Beobachtung:** 48 der 456 Karten haben weder `map_url` noch `map_local_url`; **47** davon
  haben auch keinen einzigen Eintrag in `links`. Sie tragen aber Titel, Fundort und Zuordnung
  (z. B. „Stadtplan von Abilacht (Die Siebenwindküste)", „rudimentäre schwarz-weiß
  Aventurienkarte"). Der Sync schreibt bewusst `''` statt NULL, wenn er keine Quelle verlinken
  kann (Kommentar in citymap-sync.php:1680) — das ist also gewollt entstanden, führt aber zu
  einem Katalogeintrag, der nirgendwohin führt.
- **Erwartet:** Entweder als „nur nachgewiesen, nicht verlinkt" gekennzeichnet, oder aus der
  öffentlichen Sammlung heraus.
- **Beleg:** Nachlauf über `snapshots/citymaps.json`; Codekommentar gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 305 Flusswege sind für jedes Transportmittel gesperrt
- **Kategorie:** KANN
- **Fundstelle:** `map-features.json`, `properties.allowed_transports` + `transport_domain`
- **Beobachtung:** 324 Wege tragen eine **leere** `allowed_transports`-Liste. Davon haben **305**
  zusätzlich eine gesetzte `transport_domain` (alle `Flussweg`/`river`) — nach der Regel in
  client-graph.php:1302-1306 heisst das „kein Transportmittel darf hier fahren", der Weg ist im
  Graph unbrauchbar. Die restlichen **19** (alle `Wuestenpfad`, leere Liste ohne Domain) sind der
  bekannte Rest der Aktion `normalize_wuestenpfad_transports` und werden korrekt ignoriert.
  2.629 Wege tragen das Feld gar nicht. Die 305 sind gegenüber dem Stand vom 14.07.2026
  (308 laut Memory) praktisch unverändert — sie sind also keine frische Fehlbedienung, sondern
  ein Bestand, den niemand mehr prüft.
- **Erwartet:** Eine Editor-Liste „Wege ohne jedes Transportmittel", damit der handgepflegte
  Ober-/Unterlauf-Fall vom Versehen unterscheidbar bleibt.
- **Beleg:** Nachlauf über die Momentaufnahme; `client-graph.php:1293-1306` und Memory
  `routing-per-path-allowed-transports` gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B11 Fünf Territoriums-Schlüssel aus Abenteuerzuordnungen haben keinen Eintrag in `territory_meta`
- **Kategorie:** KANN
- **Fundstelle:** `adventures.json` — `places[].target_wiki_key` gegen `territory_meta`
- **Beobachtung:** `territory_meta` (340 Einträge) liefert dem Client Namen und Rang zu jedem
  Territoriumsschlüssel, der in `places[].target_wiki_key` oder `territory_path` vorkommt.
  **5 Schlüssel fehlen** (8 Zeilen): `wiki:bergk-nigreich-lorgolosch`,
  `wiki:f-rstentum-andergast`, `wiki:diamantenes-sultanat`, `wiki:moghulat-oron`,
  `wiki:d-monenkaiserreich-transysilien`. Für diese Zeilen kann die Oberfläche den
  Territoriumsnamen nicht anzeigen.
- **Erwartet:** `territory_meta` deckt jeden Schlüssel ab, den die Zuordnungen nennen — oder die
  Zuordnung wird beim Abgleich als unauflösbar markiert.
- **Beleg:** Nachlauf über `snapshots/adventures.json` (1.352 Abenteuer, 2.737 Zuordnungen).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 183 Abenteuer ohne jede Ortszuordnung, 429 Zuordnungen unauflösbar
- **Kategorie:** KANN
- **Fundstelle:** `adventures.json`
- **Beobachtung:** 183 der 1.352 Abenteuer haben `places: []` — sie erscheinen im Katalogfenster,
  aber an keinem Ort der Karte. 429 der 2.737 Zuordnungen stehen auf `target_kind='unresolved'`
  (mit Rohnamen wie „Thalhaus", „Ewiges Eis", „Uthuria", „Sultanat Thalusa (Großsultanat Elem)")
  — überwiegend Orte ausserhalb Aventuriens oder ohne Kartenobjekt, also erwartbar, aber die
  Zahl ist unbeobachtet. Dazu 29 doppelte Titel — geprüft: **alle** unterscheiden sich in Edition
  und Wiki-Seite (z. B. „Auf Messers Schneide" DSA4.1/Abenteuer gegen DSA4/Szenario), es gibt
  **keine** zwei Abenteuer mit derselben `wiki_url`. Das ist also kein Datenfehler, nur eine
  Mehrdeutigkeit in jeder Liste, die nach Titel sortiert.
- **Erwartet:** Eine Zählung im Editor („x ohne Ort, y unauflösbar"), damit der Rest nach einem
  Sync sichtbar wird statt zu wachsen.
- **Beleg:** `work/a3-refine.js` Abschnitt 2+3.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 32 Katalogquellen ohne Bezeichnung, 132 ohne jeden Verweis
- **Kategorie:** KANN
- **Fundstelle:** `map-features.json` → `source_catalog` · Tabelle `sources`
- **Beobachtung:** Der Katalog im Kartenpayload hat 1.697 Einträge: 1.342 echte `sources`-Zeilen
  und 355 aus dem Altfeld `other_source` synthetisierte. Von den echten haben **14 keine
  Bezeichnung** (bei den synthetisierten 18), und **132 werden von keinem einzigen
  `feature_sources`-Eintrag mehr genannt**. Die 357 Zeilen ohne `url` sind **kein** Fehler —
  das sind die URL-losen Wiki-Publikationen, deren `url_hash` synthetisiert wird
  (feature-sources.php:475). Doppelte URLs im echten Katalog: **0** — die
  `url_hash`-Entdopplung hält.
- **Erwartet:** Eine Quelle ohne Bezeichnung ist in der Infobox eine nackte URL; unreferenzierte
  Zeilen gehören in einen Aufräumlauf (siehe B2).
- **Beleg:** `work/a3-refine.js` Abschnitt 4; `avesmapsEnsureFeatureSourceTables` gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B14 Der Löschpfad kennt keinen Weg zurück für Bilder in `uploads/`
- **Kategorie:** ZUKUNFT
- **Fundstelle:** api/_internal/app/adventures.php:1262-1264 (Kommentar) · api/_internal/app/citymaps.php:2051 ff.
- **Beobachtung:** Beim Löschen eines Abenteuers bleibt die Coverdatei in `uploads/questcovers`
  bewusst liegen — der Kommentar begründet das gut („a bad unlink costs a cover that was still in
  use"). Beim Löschen einer Karte wird die hochgeladene Datei ebenfalls nicht entfernt (`@unlink`
  gibt es in citymaps.php nur beim **Ersetzen** einer Vorschau, Z. 2258). Für Wappen
  (`uploads/wappen`) und Siedlungsbilder gilt dasselbe. Das ist eine bewusste, verteidigbare
  Entscheidung — aber es gibt keinen Gegenpart, also wächst `uploads/` monoton, und aus dem Repo
  ist nicht prüfbar, wie viel dort schon verwaist ist.
- **Erwartet:** Ein Bericht („Dateien in uploads/, auf die keine Zeile mehr zeigt"), der nur
  zählt und nicht löscht — die Entscheidung bliebe beim Owner.
- **Beleg:** Kommentar und Code gelesen; `grep -rn "unlink(" api/ edit/ tools/` (25 Treffer,
  keiner in einem Löschpfad eines Objekts). Der Dateibestand selbst wurde **nicht** geprüft —
  dazu bräuchte es Serverzugriff.
- **Sicherheit:** PLAUSIBEL
- **Aufwand:** mittel

---

## Nachweislich in Ordnung (damit es niemand zweimal prüft)

Diese Punkte standen in meinem Auftrag und sind **negativ** ausgegangen — das ist ein Ergebnis,
kein Loch im Bericht:

- **Kein DDL in einer Transaktion.** Statischer Lauf über alle 300+ PHP-Dateien in `api/`,
  `edit/`, `tools/` (`work/b1-ddl-in-tx.js`): erst alle 62 Funktionen bestimmt, die DDL ausführen
  (inkl. aller `*EnsureTables` und `avesmapsAppSetting*`), dann jede
  `beginTransaction`…`commit`-Strecke auf inline-DDL **und** auf Aufrufe dieser Funktionen
  geprüft. **0 echte Treffer** (4 gemeldete waren `DELETE FROM`, also DML). Die Hausregel in
  ecosystem.php:1350-1355 wird eingehalten.
- **Nachrüst-DDL:** Jedes `ADD COLUMN … NOT NULL` trägt einen `DEFAULT`
  (`thumb_origin`, `origin`, `report_mode`, `affects_paths`, `offroad_factor`, `entity_type`).
  Wo ein Startwert nötig ist, hängt er an **seiner eigenen** Spalte (`$typeColumnsAdded[]`,
  ecosystem.php:455-519) — die Falle aus Memory `ddl-retrofit-seed-guard-per-column` ist
  geschlossen. `political_territory.wiki_key` wird nach dem Nachrüsten zweistufig nachgefüllt
  (territory.php:153-159). Die Reihenfolge „`south_type_key` **vor** dem Saatlauf" stimmt
  (ecosystem.php:402 vor :894).
- **Kartendaten:** 11.486 Features — 0 doppelte `public_id`, 0 fehlende `public_id`, 0 leere
  Namen, 0 nicht-endliche Koordinaten, 0 Koordinaten ausserhalb 0..1024, 0 leere Geometrien,
  0 `LineString` mit unter 2 Punkten, 0 Label mit `min_zoom > max_zoom`.
- **Ortsnamen sind eindeutig:** 0 doppelte Namen unter den 2.776 Siedlungen, 0 Kollisionen
  zwischen Siedlung und Kreuzung. Die Sperre `avesmapsAssertUniqueLocationName` hält
  (Memory `location-names-are-graph-keys`).
- **`/api/locations/` gegen `map-features`:** identische Menge (4.854 zu 4.854, 0 nur hier /
  0 nur dort), identische `map_revision` (56.665), **0** abweichende Koordinaten. Nur die Namen
  der Kreuzungen weichen ab — das ist B1 und Absicht des Codes, kein Datenfehler.
- **Klimazonen:** alle 2.776 Orte tragen genau einen der 8 deklarierten Schlüssel, 0 unbekannte
  Werte, 0 ohne Zone.
- **Gültigkeiten:** 0 Zeilen mit `valid_from_bf > valid_to_bf` — weder in den 379 politischen
  Gebieten noch in den 456 Karten.
- **Politik-Layer (Zoom 3, 1049 BF):** 0 doppelte `public_id`, 0 doppelte `wiki_key`, 0 leere
  Namen, **0** Haupt- oder Regierungssitze, die auf einen nicht existierenden Ort zeigen
  (`capital_place_public_id`, `seat_place_public_id`). Elternketten und abgeleitete Quellen
  konnte ich nicht prüfen — die Momentaufnahme ist nach Zoom und Jahr gefiltert.
- **Quellenverweise im Payload:** 61.482 Verweise, **0** mit einer `source_id`, die nicht im
  Katalog steht. Der Katalog selbst hat 0 doppelte URLs.
- **`in_settlement_places`:** 1.604 Einträge, 0 ohne Namen, **0** mit einem `settlement`, das
  nicht unter den Ortsnamen steht.

## Nicht prüfbar ohne Server/DB

- Ob die 655 `territory:`-Quelleneinträge, die im Zoom-3/1049-Ausschnitt kein Gegenstück haben,
  wirklich verwaist sind — der Ausschnitt zeigt 379 von rund 1.384 Gebieten. Für Orte, Wege,
  Regionen und Karten war der Vergleich vollständig (B2, B3).
- Der tatsächliche Dateibestand in `uploads/` (B14).
- Ob die inline-DDL auf dem Produktivserver je gelaufen ist — geprüft ist der Code, nicht das
  Schema. `sql/` ist laut AGENTS.md §10 ohnehin nur eine Teilkopie.

## Arbeitsdateien

Alle Auswertungen liegen als wiederholbare Node-Skripte in `../work/`:
`a1-mapfeatures.js` (Struktur- und Feldprüfung), `a2-crosscheck.js` (Quellenabgleich),
`a3-refine.js` (Verwaisungszählung), `a4-crossing-index.js` (Portierung der Kreuzungs-Nummerierung,
4.854/4.854 gegen die Momentaufnahme verifiziert), `b1-ddl-in-tx.js` (statischer DDL/Transaktions-
Scan über die PHP-Quellen). Keine Netzanfrage, keine Änderung am Arbeitsbaum.
