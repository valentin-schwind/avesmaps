# Landschaft und Wiki-Artikel: EINE Quelle, die Region

Stand 15.09.2026. Auftrag des Owners, wörtlich: „ich will dass du einen auftrag startest, dass der
garetien importer fläche und label mit dem selben wiki eintrag versorgt, eine inkonsistenz darf es hier
nicht geben (eigentlich hättest du das problem mit den regionen = eine quelle, N labels, M flächen)
schon längst fixen sollen". Nachtrag: „Der Garetien-Importer soll in diesem Zug ebenfalls repariert und
von dir getestet werden, um zu zeigen, dass das problem wirklich gefixt ist".

## 1. Die Regel

Eine Landschaft ist EINE Region (`ecosystem_region`) mit N Beschriftungen (`map_features`,
`feature_type = 'label'`) und M Flächen (`ecosystem_area`). Für den Wiki-Artikel gibt es EINE Quelle:
die Region.

**Invariante.** Für jede aktive Beschriftung, die an eine aktive Region gebunden ist, gilt:
`properties.wiki_region.wiki_key` = `ecosystem_region.wiki_region_key` — beide leer oder beide gleich.

Gebunden heißt: dieselbe Auflösung wie im Lesepfad (`avesmapsEcosystemLabelRegionMap`,
`ecosystem-label-link.php`) — der eigene Zeiger der Beschriftung gewinnt, sonst der primäre Zeiger der
Region. Freie Beschriftungen (Berggipfel, Flüsse, Ebenen …) behalten ihr eigenes Nest.

## 2. Messung vorher (live, 15.09.2026, je EIN Abruf von `map-features.php` und `ecosystem-areas.php`)

| | |
|---|---|
| Regionen (mit Fläche) | 2042, davon 4 mit mehr als einer Fläche |
| Regionen mit mehr als einer gebundenen Beschriftung | 11 |
| Beschriftungen | 1181, davon 964 gebunden, 217 frei |
| gebunden: beide leer / gleich | 472 / 490 |
| **nur an der Beschriftung** | **2** — „Erlensee (Kosch)" (`erlensee`), „Weydenauer See" (`weydenauer-see`) |
| nur an der Region / verschieden | 0 / 0 |

Hexenhain ist seit der Messung des Auftrags konsistent, der Blaue See wurde vom Owner von Hand gelöst.

**Zwei Ableitungen desselben Schlüssels?** Der Regionsschlüssel kommt aus der Adresse
(`avesmapsEcosystemWikiRegionKey`), der Nest-Schlüssel des Importers aus `wiki_region_staging.wiki_key`.
Gegenprobe über alle 662 Nester der Live-Karte (jedes aus dem Staging gebaut, Schlüssel und Adresse
derselben Zeile): **0 Abweichungen** zwischen `wiki_key` und Slug der Adresse. Die Faltung stimmt heute
also überein. Behoben wird trotzdem an der Wurzel (§4.3): der Schlüssel der Beschriftung WIRD der
Schlüssel der Region, er wird nicht zweimal abgeleitet.

## 3. Warum es auseinanderläuft — die Erzeuger

Gezählt am Code von `origin/master` (211a264d5), nicht aus der Liste des Auftrags übernommen:

| Weg | Datei | vorher |
|---|---|---|
| Garetien-Import, Fläche | `import/garetien-uebernahme.php` (`avesmapsGaretienFlaecheAnlegen`) | Nest aus dem Staging per NAME an die Beschriftung, Adresse getrennt an die Region — und `create_region` zieht die Beschriftung **nicht** nach |
| `create_region` mit `label_public_id` | `app/ecosystem.php` | bindet (Zeiger), gleicht das Nest nicht an |
| `update_region` | `app/ecosystem.php` | Durchtrag abwärts / ausdrückliches Entfernen — richtig, aber ein neu gebundenes Label mit fremdem Artikel bleibt stehen, wenn die Region leer ist |
| `assign_wiki_region` | `app/ecosystem.php` | Durchtrag abwärts / Entfernen — richtig |
| `create_label` (Duplizieren, Zeichnen) | `map/features.php` | schreibt das mitgeschickte Nest, auch an eine gebundene Beschriftung |
| `update_label` (Beschriftungsdialog, Umbenennen aus dem Flächendialog, Umhängen) | `map/features.php` | schreibt das Nest an die Beschriftung, die Region erfährt es nur über den Browser-Rückweg |
| WikiSync `assign` / `assign_all` (Namensabgleich) | `wiki/regions.php` | Nest per NAME an gebundene Beschriftungen, Region unberührt |
| WikiSync `assign_labels` (V6c, ausdrücklich) | `wiki/regions.php` | Nest an die Beschriftung, Region unberührt |
| **Rückgängig einer Beschriftung** (Änderungsprotokoll der Karte) | `map/features.php` (`avesmapsUndoAuditChange`) | stellt `properties_json` samt altem Nest wieder her — **nicht im Auftrag gelistet** |
| **Rückgängig einer Zuweisung** (Fenster „Änderungen", Landschaften) | `app/ecosystem.php` (`avesmapsEcosystemRestoreAuditRow`) | stellt `wiki_url`/`wiki_region_key` der Region zurück, die Beschriftungen bleiben stehen — **nicht im Auftrag gelistet** |
| Bestandslauf „Wiki & Art" | `app/ecosystem.php` | ruft den Durchtrag — richtig |

Nur lesend (keine Erzeuger): Konfliktzentrum, Lore, Suche, „Was ist hier?", Publikationsabgleich,
Kanon-Rückfall `avesmapsEcosystemNamespacesAusBeschriftungen`.

## 4. Der Umbau

### 4.1 Ein Trichter: `api/_internal/app/landschaft-wiki.php`

Die EINE Datei, in der `properties.wiki_region` einer Beschriftung geschrieben oder entfernt wird.
Ein Wächtertest zählt das repoweit (§6).

- `avesmapsLandschaftWikiNestSetzen(array $properties, ?array $nest): array` — rein, die einzige Zeile,
  die das Feld setzt oder löscht.
- `avesmapsLandschaftWikiRegionDerBeschriftung(PDO, labelId, properties): ?array` — die aktive Region
  nach der Auflösungsregel des Lesepfads.
- `avesmapsEcosystemWikiRegionAssignObject(PDO, key, url): array` — zieht um, mit zwei Riegeln:
  Staging erst per Schlüssel, dann per Adresse; und **der Schlüssel des Nests IST der Schlüssel der
  Region**, auch wenn die Staging-Zeile einen anderen trägt.
- `avesmapsLandschaftWikiBeschriftungenAngleichen(PDO, region, primär, sollKey, sollUrl, leerLöscht,
  user, grund)` — der eine Schreiber für alle gebundenen Beschriftungen einer Region. Die Region gewinnt;
  eine LEERE Region löscht nur, wo `leerLöscht` es sagt (ganz, gar nicht oder nur für genannte, frisch
  gebundene Beschriftungen). `avesmapsEcosystemPushWikiRegionToLabels` und
  `avesmapsEcosystemClearWikiRegionFromLabels` bleiben als die zwei Lesarten davon stehen.
- `avesmapsLandschaftWikiRegionSetzen(PDO, regionRow, url, user)` — schreibt den Artikel an die Region
  (Protokoll `assign_wiki_region`, rücknehmbar), gleicht alle Beschriftungen an, hebt die Kartenrevision
  bei echtem Wechsel. Keine Transaktion, kein DDL — der Aufrufer hält beides.
- `avesmapsLandschaftWikiBeschriftungFestlegen(…)` — die Entscheidung für `create_label`,
  `update_label` und das Rückgängig einer Beschriftung (§4.2).
- `avesmapsLandschaftWikiNachReaktivierung(…)` — eine zurückgeholte Region gleicht ihre Beschriftungen an
  (Befund des Prüfagenten, §4.4).

### 4.2 Was jeder Weg jetzt tut

| Weg | gebundene Beschriftung | freie Beschriftung |
|---|---|---|
| `create_label` (Duplizieren, Zeichnen) | Nest = das der Region; ein mitgeschicktes Nest wird verworfen | Nest wie mitgeschickt |
| `update_label` **mit** `wiki_region` im Rumpf | **an die Region weitergereicht** (Leitplanke 2: der Kasten ist dort ausgeblendet, „es gewinnt die Fläche"); die Antwort trägt die mitgezogenen Geschwister als `labels` | Nest wie mitgeschickt |
| `update_label` **ohne** `wiki_region`, Bindung **neu** (Umhängen) | Nest = das der neuen Region, auch leer | unverändert |
| `update_label` ohne `wiki_region`, Bindung unverändert | trägt die Region einen Artikel, wird er nachgezogen; ist sie leer, bleibt die Beschriftung stehen (ein bloßes Speichern nimmt nichts zurück) | unverändert |
| `create_region` / `update_region` mit `label_public_id` | die frisch gebundene Beschriftung bekommt das Nest der Region, auch leer | — |
| `update_region` / `assign_wiki_region` | wie bisher: Artikel abwärts, ausdrückliches Entfernen in beide Richtungen, bloßes Umbenennen nimmt nichts | — |
| WikiSync `assign` / `assign_all` (per Name) | **übersprungen und gezählt** (`gebunden_uebersprungen`) — ein Namensabgleich entscheidet nicht über den Artikel einer Fläche; dafür gibt es „Fläche zuweisen" | wie bisher |
| WikiSync `assign_labels` (ausdrücklich) | an die Region weitergereicht; die Vorschau nennt die Fläche | wie bisher |
| Rückgängig einer Beschriftung | die Region gewinnt, auch leer | unverändert |
| Rückgängig einer Zuweisung der Region | die Beschriftungen folgen in beide Richtungen | — |

### 4.3 Der Garetien-Importer

Die Fläche legt die Beschriftung **ohne** Nest an; die Adresse des Wiki-Treffers geht an die Region, und
`create_region` gleicht die Beschriftung aus der Region an. Es gibt keine zweite Ableitung mehr: Nest
und Region hängen an derselben Adresse, der Schlüssel des Nests ist der der Region. Der Berggipfel bleibt
eine freie Beschriftung mit eigenem Nest (Owner-Entscheid 30.08.2026). Der Name bleibt der Suchweg
(Owner-Entscheid); eine Warnung „schon vergeben" ist nicht Teil dieses Auftrags.

`wiki_nachzug` (Garetien, noch nie scharf) bleibt unverändert stehen; der allgemeine Bestandslauf (§5)
deckt seinen Fall mit ab und fragt dabei jeden Einzelfall.

## 5. Bestand: Trockenlauf, jede Abweichung einzeln entschieden

Admin-Aktion `landschaft_wiki_bestand` an `api/edit/map/ecosystem.php`. Trockenlauf ist die Vorgabe:
er liest ALLE aktiven Regionen und Beschriftungen in einem Durchgang, zählt wie §2 und listet jede Region,
an der Beschriftung und Region verschiedene Artikel tragen, mit Namen, Schlüsseln und Adressen.

Scharf nur mit `dry_run: false`, `confirm: 'apply'` und einer Entscheidung JE Region:

- `region_gewinnt` — die Beschriftungen bekommen das Nest der Region (bei leerer Region: entfernt);
- `heben` + `wiki_key` — der Artikel einer ihrer Beschriftungen geht an die Region, alle folgen;
- `entfernen` — Region und Beschriftungen verlieren den Artikel.

Eine Region ohne Entscheidung wird nicht angefasst. Jede läuft in ihrer eigenen Transaktion und wird
unmittelbar davor neu gelesen (ist sie inzwischen konsistent: `inzwischen_erledigt`).

## 6. Wächter und Tests

- **Wächter** (`landschaft-wiki-schreiber-waechter-test.php`): scannt `api/` kommentarfrei (Tokenizer).
  Eine Zuweisung `['wiki_region'] =` oder ein `unset(…['wiki_region'])` außerhalb von
  `landschaft-wiki.php` ist rot; ein neuer Rumpfschlüssel `'wiki_region' =>` außerhalb der benannten
  Liste ebenfalls; im Browser werden die Dateien gezählt, die `wiki_region` in einen Rumpf legen.
- **Ausgeführt, nicht gelesen** (`landschaft-wiki-eine-quelle-test.php`): jeder Weg aus §4.2 gegen
  SQLite mit den echten Bibliotheken, und nach jedem Schritt der Trockenlauf aus §5 als Orakel —
  er muss 0 Abweichungen melden.
- **Der Importer** (`garetien-flaeche-wiki-eine-quelle-test.php`): `avesmapsGaretienUebernehmen` echt
  gefahren — Fläche mit Treffer, Treffer mit abweichendem Staging-Schlüssel, ohne Treffer, Verbund aus zwei
  Fragmenten; Region und Beschriftung tragen danach denselben Schlüssel. Der Berggipfel (freie Beschriftung,
  eigenes Nest) bleibt in `garetien-uebernahme-test.php` abgedeckt.
- **Mutationsproben** mit Byte-Gegenprobe: 20 von 20 gefangen (vor den Nachbesserungen aus §4.4).

## 4.4 Nachbesserungen nach dem feindlichen Prüfagenten (15.09.2026)

- **Zurückgeholte Region:** das Rückgängig von `delete_region`, `delete_region_cascade` und
  `delete_area_with_region` gleicht die Beschriftungen an (`avesmapsLandschaftWikiNachReaktivierung`).
  Szenario ohne das: Zuweisung setzen → Region löschen → Zuweisung zurücknehmen (trifft die inaktive Region)
  → Löschen zurücknehmen = Region und Schild verschieden.
- **Recht:** `assign_labels` (Endpunkt `api/edit/wiki/regions.php`, Fähigkeit `review`) schreibt für gebundene
  Ziele an die Region; das verlangt jetzt `edit`, sonst 400 mit Grund. Freie Ziele bleiben bei `review`.
- **Rückgängig einer Beschriftungszeile nimmt den Artikel NICHT zurück** — die Region gewinnt. Zurückgenommen
  wird eine Artikeländerung an der Region (Fenster „Änderungen" der Landschaften, `assign_wiki_region`).
  Gewollt, aber zu wissen.
- **Offen, bewusst nicht gebaut:** die Oberfläche von „Label zuweisen" nennt die Fläche noch nicht (die
  Antwort trägt `region_public_id`/`region_name`/`regionen`); der Namensabgleich meldet
  `gebunden_uebersprungen` nur in der Antwort. Beides ist sichtbare Oberfläche und geht einzeln.
- **Theoretisch, live 0:** zwei aktive Regionen nennen dasselbe primäre Label (ohne eigenen Zeiger). Der
  Trichter nimmt dann die älteste Region; seit dem 24.08.2026 schreibt jede Zuweisung den eigenen Zeiger.

## 7. Das Sicherheitsnetz von 8957d8e15 bleibt

Der Wiki-Kasten einer Fläche zeigt bei leerer Region die Zuweisung ihrer Beschriftungen
(`avesmapsWikiAssignLandschaftGespeichert`). Nach dem Umbau entsteht dieser Zustand auf keinem
Schreibweg mehr, der Kasten ist dann inert. Er bleibt trotzdem, aus einem Grund: ein
**Datenbank-Backup von vor diesem Umbau** (`docs/database-backup.md`) bringt alte Paare zurück, und
bis der Bestandslauf entschieden ist, stehen live zwei davon. Ohne den Kasten wären sie im Editor
wieder unlösbar — genau der Befund, der zu 8957d8e15 geführt hat. Ein inertes Stück Anzeige kostet
nichts; ein unlösbarer Zustand kostet eine Sitzung.

## 8. Offen / bewusst nicht

- Die Browser-Wege schicken weiter ein Nest mit; für gebundene Beschriftungen entscheidet der Server.
  Sie umzubauen wäre ein zweiter Umbau ohne Wirkung auf die Invariante.
- Die Warnung „dieser Artikel ist schon an eine andere Fläche vergeben" (Blauer See) gehört nicht hierher.
