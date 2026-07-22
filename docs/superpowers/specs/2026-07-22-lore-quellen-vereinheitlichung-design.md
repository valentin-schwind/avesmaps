# Lore-Quellen auf das geteilte Quellensystem (Design)

**Datum:** 2026-07-22 · **Auftraggeber:** Owner · **Maßstab:** AGENTS.md §5
„Sources live in ONE place"

## 1. Ausgangslage

Das Feature „Natur & Waren" (Flora/Fauna/Spezies/Handelswaren, ausgeliefert
2026-07-21) hat ein eigenes Quellensystem bekommen: die Tabelle `lore_source`
mit eigenem Staging (`wiki_lore_source_staging`) und eigenem Reconcile. Das
verstößt gegen die Regel, die seither in AGENTS.md §5 steht.

Die Kosten sind gemessen, nicht theoretisch:

* `publication_title` steht in **jeder** der ~35.000 Zeilen statt einmal im
  geteilten Katalog `sources`.
* Der Editor kann Lore-Quellen nur **anzeigen** — kein Hinzufügen, kein
  Entfernen, kein Autocomplete, keine sichtbare Provenienz.
* Dieselben Wiki-Publikationsangaben laufen durch **zwei** Reconciler.

## 2. Der entscheidende Befund

Der Umbau ist klein, weil System A alles schon mitbringt:

**a) Der Lesepfad hängt fast nicht an `lore_source`.** Das öffentliche
Infopanel zeigt Lore-Quellen überhaupt nicht (`avesmapsLoreReadForPlaces` liest
sie nie). Benutzt werden nur drei Stellen: eine Zählung in der Editor-Liste,
eine Zählung in der Statistik und die Nur-Lese-Liste im Editor-Detail.

**b) Der Editor kann es bereits.**
`mountFeatureSourceEditor(container, entityType, idGetter)` in
`js/review/review-feature-sources.js` ist generisch. Skript **und**
`css/features/feature-sources.css` sind in `index.html` geladen — genau dort,
wo der Lore-Editor lebt. Hinzufügen/Entfernen/Autocomplete/Provenienz sind ein
Mount-Aufruf, kein Neubau.

**c) `publication-sync.php` kann Lore mit erledigen.** Der Lore-Parser ruft für
seine Quellen bereits `avesmapsWikiParsePublicationsSection` auf — denselben
Parser wie System A. Und die vier Lore-Infoboxen (Tierart, Pflanzenart, Spezies,
Gegenstandsgruppe) fallen im Klassifizierer
(`avesmapsWikiDumpClassifyEntityKind`) sauber durch: keine Kollision mit
settlement/region/path/territory. Es reicht, `avesmapsPublicationEntityRefForPage`
um einen Lore-Zweig zu erweitern.

> **Nebeneffekt, kein Nachteil:** der geteilte Weg löst Publikationstitel über
> `wiki_redirect_alias` auf (`avesmapsPublicationResolvePublicationKey`). Der
> Lore-Eigenweg tat das nie — er slugte den Titel roh. Ein Auflagen- oder
> Klammervariantentitel trifft nach dem Umbau also den richtigen Katalogeintrag.

## 3. Zielbild

```
wiki_publication_catalog ─┐
                          ├─► wiki_entity_publication (entity_type='lore')
Lore-Seite im Dump ───────┘        │
                                   ▼
                          feature_sources (entity_type='lore',
                                           entity_public_id=lore_entry.wiki_key,
                                           origin='wiki_publication')
                                   │
                                   ▼
                          sources  (geteilter Katalog — ein Titel, einmal)
```

`lore_source` und `wiki_lore_source_staging` entfallen.

## 4. Identität

`entity_public_id` = `lore_entry.wiki_key`.

Lore hat keine `public_id`, und der `wiki_key` **ist** seine öffentliche
Identität — er reist so im API-Payload und ist der Fremdschlüssel in
`lore_place`. Eine zweite Identität einzuführen wäre der gleiche Fehler in Grün.

💣 **Dafür muss `feature_sources.entity_public_id` von `VARCHAR(64)` auf
`VARCHAR(190)`.** Lore-Schlüssel stammen aus Artikeltiteln und können länger als
64 Zeichen werden; MySQL würde sie stillschweigend abschneiden und zwei Einträge
kollidieren lassen. Selbstheilender `ALTER` mit Längenprüfung über
`information_schema`, wie im Rest des Projekts. Die Spaltenbreite bleibt unter
der Indexgrenze (16·4 + 190·4 + 8 = 832 Byte < 3072).

## 5. Änderungen

### 5.1 Freischaltung (zwei Zeilen, wie bei `citymap`)

* `api/edit/map/feature-sources.php` — `$allowedTypes` + Fehlermeldung
* `api/app/feature-sources.php` — `$allowedTypes` + Fehlermeldung

### 5.2 Geteilte Bibliothek

`api/_internal/app/feature-sources.php`:

* `avesmapsEnsureFeatureSourceTables` — die Verbreiterung aus §4
* `avesmapsFeatureSourcesReadWikiUrl` — `lore`-Zweig, liest `lore_entry.wiki_url`
* `avesmapsFeatureSourcesReadRevision` — braucht **nichts**: Lore ist keine
  `map_features`-Zeile, der bestehende Riegel gibt bereits `null` zurück

### 5.3 Wiki-Weg

`api/_internal/wiki/publication-sync.php`:

* `avesmapsPublicationEntityRefForPage` — Lore-Zweig als **Fallback** nach den
  vier bestehenden Fällen. Er greift nur, wenn der Klassifizierer nichts sagt,
  kann also keinem bestehenden Typ etwas wegnehmen.
* `avesmapsPublicationReconcileSegmentOrder` — Segment `lore`
* `avesmapsPublicationFetchLiveEntityBatch` — `lore`-Zweig über `lore_entry`
  (`public_id` **und** `wiki_key` sind derselbe Wert). `try/catch`, damit eine
  Installation ohne Lore-Tabelle nicht bricht.

`api/_internal/wiki/lore-sync.php`:

* Quellen-Staging (`wiki_lore_source_staging`) entfällt: DDL, Insert, Delete,
  Select.
* Der Quellenblock in `avesmapsLoreReconcileStep` wird **ein Aufruf** von
  `avesmapsPublicationReconcileEntity($pdo, 'lore', $wikiKey, $wikiKey, $userId)`.
  Damit tut „Natur & Waren syncen" weiter genau, was es tat — die Quellen landen
  nur im geteilten System.
* `avesmapsLoreSourceKey` entfällt (der Kindplan wird nur noch für Orte gebraucht).
* `AVESMAPS_LORE_TABLE_SOURCE` entfällt ebenfalls. Die Migration nennt die Tabelle
  im SQL beim Namen und fasst ein Fehlen als Zustand auf — 🪤 eine Konstante mit
  `CREATE TABLE IF NOT EXISTS` daneben würde die Tabelle nach dem `DROP` leer
  wiederauferstehen lassen, und die Migration meldete dann „nichts zu tun".

**Warum beide Wege?** `sync_lore` reconciled je Eintrag sofort, damit ein
einzelner Sync vollständig ist. Das Segment im Publikations-Reconcile fängt den
Fall ab, dass jemand nur „Publikationsquellen syncen" drückt. Beide sind
idempotent, ein Doppellauf schreibt nichts.

### 5.4 Lesepfad

`api/_internal/app/lore.php`:

* `avesmapsLoreReadCatalog` — `source_count` aus `feature_sources`
  (`entity_type='lore'`, `status='approved'`), weiterhin **eine** Abfrage für die
  ganze Seite, kein N+1.
* `avesmapsLoreReadStats` — `sources` aus `feature_sources`

`api/_internal/app/lore-edit.php`:

* `avesmapsLoreReadEntryDetail` — die Quellenabfrage entfällt. Der Editor holt
  die Liste über den geteilten Endpoint, so wie der Siedlungseditor auch.

### 5.5 Editor

`js/review/review-wiki-sync.js`, `renderLoreDetail`:

Die Nur-Lese-Liste `<ul class="lore-detail__sources">` weicht einem
Container-`<div>`; danach `mountFeatureSourceEditor(el, "lore",
() => avesmapsLoreDetailKey)`. Ab da kann der Lore-Editor, was der
Siedlungseditor kann: hinzufügen, entfernen, Autocomplete, Provenienz sichtbar,
`suppressed` als Grabstein.

⚠️ Der Mount muss **nach** jedem `renderLoreDetail` laufen (die Funktion
überschreibt `innerHTML`) und darf den Detailschlüssel nur über den Getter
lesen, nie kopieren — sonst schreibt ein Klick nach dem Eintragswechsel auf den
alten Eintrag.

### 5.6 Editorhandbuch

Der Editor gewinnt sichtbare Fähigkeiten → `html/editor-handbuch.html` wird im
selben Commit nachgezogen, `Stand:` bekommt das Datum (AGENTS.md §9).

## 6. Migration der Bestandsdaten

Eigene owner-getriggerte Aktion `migrate_lore_sources` in
`api/edit/wiki/dump.php`, resumierbar über einen `entry_wiki_key`-Cursor, mit
`dry_run`. Sie liest `lore_source` **direkt** und braucht **keinen frischen
Dump** — das ist der Grund, warum sie vor dem ersten neuen Sync läuft.

### 6.1 💣 Die Zahl, die nicht stimmt, wenn man sie naiv vergleicht

`lore_source` ist unique über `(entry, publication, reference_kind, sort_order)`,
`feature_sources` über `(entity_type, entity_public_id, source_id)`. **Dieselbe
Publikation zweimal an einem Eintrag kollabiert also zu einer Zeile.**

> Die Zielzahl ist **nicht** 34.933, sondern
> `COUNT(DISTINCT entry_wiki_key, publication_wiki_key)`.

Beide Zahlen werden vorher gemessen und beide gemeldet. Wer gegen die rohe
Zeilenzahl prüft, hält einen korrekten Lauf für Datenverlust.

### 6.2 Kollaps-Regel (PURE, unit-getestet)

Für ein Paar (Eintrag, Publikation) mit mehreren Zeilen gewinnt:

| Feld | Regel |
|---|---|
| `reference_kind`, `pages`, `note` | Zeile mit dem kleinsten `sort_order` (die erste Nennung im Wiki) |
| `origin` | `manual`, wenn **irgendeine** Zeile manuell ist, sonst `wiki_publication` |
| `status` | `suppressed`, wenn **irgendeine** Zeile unterdrückt ist, sonst `approved` |

Die letzten beiden spiegeln `avesmapsMergeWinningLink`: eine Handentscheidung
und eine Unterdrückung sind bewusste Akte und überleben eine Zusammenführung.

### 6.3 Katalog-Identität

Je `publication_wiki_key` wird **dieselbe** Identität gebildet, die der
Reconcile berechnet — sonst entstünde ein Duplikat statt einer Zusammenführung:

* in `wiki_publication_catalog` mit `has_link=1` → `url = chosen_url`
* in `wiki_publication_catalog` mit `has_link=0` → URL-los, `wiki_key` als Identität
* **nicht** im Katalog → URL-los über `wiki_key`, Label aus dem gespeicherten
  `publication_title`

Der dritte Fall ist selbstheilend: taucht die Publikation später mit `has_link=0`
auf, verschmelzen die Zeilen; taucht sie mit `has_link=1` auf, legt der nächste
Reconcile die Shop-Zeile an und räumt die alte weg (sie ist
`origin='wiki_publication'` und nicht mehr gewünscht).

### 6.4 Schreiben

Über `avesmapsFeatureSourceUpsert` + `avesmapsFeatureSourceLink`, nicht über
eigenes SQL. Deren `ON DUPLICATE KEY UPDATE` degradiert eine bestehende
manuelle Zeile nicht und belebt keinen Grabstein — die Migration kann also
mehrfach laufen.

## 7. Reihenfolge

1. Unit-Tests (Kollaps-Regel, Override-Sicherheit, Idempotenz) — rot
2. Code, Tests grün
3. Deploy
4. 🔧 Owner: `migrate_lore_sources` im Probelauf, Zahlen prüfen
5. 🔧 Owner: `migrate_lore_sources` scharf, Zählabgleich
6. **Erst dann** der `DROP` — mit dem Nachweis, nicht davor

## 8. Was NICHT dazugehört

* Kein neues Feld, kein neuer Reiter, keine neue Tabelle.
* `sort_order` fällt weg. Siedlungen kennen es auch nicht; die Reihung läuft
  über `is_official` / Alter. Eine Spalte nur für Lore wäre wieder ein Sonderweg.
* Das öffentliche Infopanel zeigt Lore-Quellen weiterhin nicht. Ob es das soll,
  ist eine Produktfrage und gehört in eine eigene Sitzung.
