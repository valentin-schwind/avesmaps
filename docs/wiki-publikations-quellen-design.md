# Wiki-Publikationsquellen — Bulk-Lookup (Design-Spec)

> Status: Entwurf zum Gegenlesen (2026-07-09). Danach → Umsetzungsplan → Instruction für eine neue Session.
> Sprache: Design-Doc auf Deutsch; Code/Tabellen/Spalten/`error.code` bleiben Englisch.

## 1. Ziel

Die Original-**Publikationsquellen** eines Kartenelements automatisch aus **Wiki Aventurica** in unser
`sources`/`feature_sources`-System übertragen. Eine Wiki-Ortsseite listet ihre Publikationen (z. B. A'Sarar →
*Efferds Wogen* S. 54, *Im Bann des Diamanten* S. 40, 145, *Historia Aventurica* S. 176); jede Publikation hat
eine eigene Wiki-Seite mit Shop-Links. Wir wollen daraus je Publikation eine Quelle (mit bevorzugtem Kauf-Link
oder ohne Link) und je Element die passenden Verknüpfungen erzeugen — **automatisch bei jedem Dump+Sync**,
**ohne unsere manuellen Overrides je zu überschreiben**.

## 2. Globale Constraints (gelten für jede Task)

- **Datenquelle NUR Dump/API, KEINE HTML-Crawls** (Betreiber-Policy). Publikations- und Entity-Seiten kommen als
  Roh-Wikitext aus dem täglichen Dump (`dewa_dump_small.xml.bz2`), gelesen über den bestehenden Dump-Reader.
- **STRATO: keine schweren Loops** — gechunkt/resumable über `wiki_sync_runs`-Phasen, keine Pro-Publikation-HTTP-Fetches im Request-Loop.
- **Override-Garantie (hart):** der Lauf verwaltet ausschließlich die Wiki-Ebene; manuelle und freigegebene
  Community-Quellen bleiben unangetastet (siehe §6).
- **Erweitern statt neu bauen:** bestehende Tabellen/Endpoints/Komponenten erweitern (siehe §8-Reuse-Map);
  neue Tabellen nur im bestehenden `wiki_*_staging`-Muster.
- **Gold-Envelope** (`{ok:true,…}` / `{ok:false,error:{code,message}}`); Deutsch-UI; kein `getMessage()`-Leak.
- **Agent baut nur** — der eigentliche Lauf/Write ist owner-getriggert.

## 3. Wiki-Struktur (verifiziert am Rohwikitext)

**Ortsseite** — `==Publikationen==` mit Unterabschnitten, je Eintrag ein Wikilink + Seitentext (KEIN Template):
```
==Publikationen==
===Ausführliche Quellen===
*[[Efferds Wogen]] Seite 54
*[[Im Bann des Diamanten]] Seiten 40, '''145'''
===Ergänzende Quellen===   (optional)
===Erwähnungen===
*[[Historia Aventurica]] Seite 176 <small>(Zerstörung)</small>
===Elektronische Quellen===/===Bildquellen===   (IGNORIEREN)
```

**Publikationsseite** — `{{Infobox Produkt}}` mit strukturierten Parametern:
```
{{Infobox Produkt
 |Titel=Efferds Wogen
 |Art=Spielhilfe |Unterkategorie=Themenband
 |ISBN=978-3-940424-11-2
 |Direktlinks={{F-Shop|PID=12017}}
 |Download={{PDF-Shop|ID=109956|ISBN=978-3-86889-664-0}}
}}
```
Fehlen `Direktlinks`/`Download` (z. B. *Im Bann des Diamanten*) → No-Link-Fall.

## 4. Was wird übernommen (Owner-Entscheidungen)

- **Abschnitte:** ALLE (Ausführliche + Ergänzende + Erwähnungen). Erwähnungen werden als solche **markiert**
  (`reference_kind`), nicht gleichrangig verschluckt. `Elektronische/Bildquellen` werden ignoriert.
- **Seitenangaben: strukturiert zerlegen und hinterlegen** — `Seite 54` → `[54]`, `Seiten 40, 145` → `[40,145]`;
  Fettung (`'''145'''`) wird ignoriert; Klammer-Notiz (`(Zerstörung)`) separat als `note`.
- **Link-Hierarchie (erster Treffer gewinnt):** F-Shop (`Direktlinks`) → PDF-Shop (`Download`) → **kein Link**
  (nur der Name als Klartext). Buchhandel/Buchkatalog (ISBN-Suche) werden NICHT verwendet.
  Der Orts-Wiki-Link ist ohnehin immer separat in der Quellenliste (verifiziert, `buildSourceListMarkup`), also
  KEIN Publikations-Wiki-Fallback.
- **Offiziell:** alle Publikations-Quellen `is_official = 1` (auch die No-Link-Bücher).
- **Typ-Badge (8er-Taxonomie, aus `Art` gemappt):** `regionalspielhilfe | abenteuer | aventurischer_bote |
  quellenband | roman | briefspiel | regelbuch | sonstiges`. Mapping-Tabelle Art→Typ in der Umsetzung
  (fuzzy; unbekannt → `sonstiges`). Ersetzt/erweitert das bisherige 4er-Enum `regionalband|abenteuer|briefspiel|sonstiges`.
- **Scope:** alle vier Entity-Typen (`settlement|region|path|territory`) im ersten Lauf.
- **Trigger:** automatisch als Phase bei jedem Dump+Sync (kein separater Button/Skript).

## 5. URL-Konstruktion (deterministisch, kein Shop-Scraping)

Die Shop-Links sind Templates mit IDs → Ziel-URL aus der ID bauen:
- `{{PDF-Shop|ID=109956}}` → `https://www.ulisses-ebooks.de/de/product/109956/` (Muster bestätigt an der von der
  Community eingetragenen „Goldene Flügel"-URL `…/product/100144/…`).
- `{{F-Shop|PID=12017}}` → F-Shop-Produkt-URL. **Exaktes Muster in der Umsetzung aus der Template-Definition
  ableiten** (`Template:F-Shop` / `Template:PDF-Shop` aus dem Dump/der API lesen — kein Rateraten, kein Hardcode
  ohne Beleg). Fallback bei Unsicherheit: kein Link (Name-only), nie eine geratene URL.

## 6. Datenmodell (ERWEITERN)

**`sources` (erweitern):**
- `source_type`-Werte auf die 8er-Taxonomie erweitern (Whitelist im Upsert anpassen).
- **url-lose Quellen erlauben:** `url=''`, `url_hash = SHA256('wikipub:' + <publikation_wiki_key>)` → stabile
  Identität ohne echte URL. Anzeige rendert url-lose Quelle als **Klartext** (kein `<a>`).

**`feature_sources` (erweitern, neue Spalten):**
- `origin VARCHAR(24) NOT NULL DEFAULT 'manual'` ∈ `wiki_publication | manual | community`.
- `reference_kind VARCHAR(16) NULL` ∈ `ausfuehrlich | ergaenzend | erwaehnung` (nur Wiki-Ebene).
- `pages VARCHAR(120) NULL` (normalisiert, z. B. `40, 145`) und `note VARCHAR(200) NULL`.
- `status` existiert bereits (`approved`); Community-Vorschläge = `pending` (§7).
- **Suppression-Tombstone:** manuelles Entfernen einer Wiki-Verknüpfung wird gemerkt (z. B. Zeile bleibt mit
  `status='suppressed'`), damit der Sync sie nicht wieder anlegt.

**Neu (im `wiki_*_staging`-Muster):**
- `wiki_publication_catalog` — PK `wiki_key`; `title, art, source_type, isbn, f_shop_url, pdf_shop_url, chosen_url, has_link, synced_at`.
- `wiki_entity_publication` — `entity_wiki_key, publication_wiki_key, reference_kind, pages, note` (UNIQUE zusammen).

## 7. Ablauf: neue Sync-Phase „Publikationsquellen"

Läuft als zusätzliche Phase im Dump+Sync (neben settlements/regions/paths/territories), resumable, Zähler in `wiki_sync_runs.stats_json`.

1. **Katalog bauen** — Publikationsseiten (`{{Infobox Produkt}}` via bestehendem
   `avesmapsWikiSyncMonitorExtractInfoboxBlock`/`ParseTemplateParams`) → `wiki_publication_catalog`
   (Art→Typ, ISBN, F-Shop/PDF-Shop → `chosen_url`/`has_link`).
2. **Referenzen bauen** — Entity-Seiten der 4 Typen → `==Publikationen==`-Sektion parsen → je Referenz
   (Publikation via Redirect-Alias aufgelöst, `reference_kind`, `pages`, `note`) → `wiki_entity_publication`.
3. **Abgleich (Reconcile) in die Wiki-Ebene:**
   - Je Publikation → `source` upserten (Identität = `wiki_key`; `url = chosen_url` oder `''`; `label=title`;
     `source_type`; `is_official=1`). Manuell überschriebene Quellen NICHT anfassen.
   - Je Entity→Publikation → `feature_sources`-Verknüpfung `origin='wiki_publication'` upserten (mit
     `reference_kind/pages/note`). Wiki-Verknüpfungen, die im Wiki nicht mehr existieren, entfernen —
     **NUR** `origin='wiki_publication'` und **nicht** die suppression-Tombstones/manuellen Zeilen.
   - **Idempotenz:** Identität je Publikation = `wiki_key` → wiederholte Läufe aktualisieren statt zu duplizieren.

**Override-Garantie konkret:** der Reconcile schreibt/löscht ausschließlich `origin='wiki_publication'`.
Manueller Add (`origin='manual'`) bleibt; manuelles Entfernen einer Wiki-Quelle bleibt entfernt (Tombstone);
manuelle Edits gewinnen.

## 8. Anzeige & Editor (ERWEITERN)

- `avesmapsReadFeatureSources` (public read) zusätzlich `reference_kind/pages/note` je Quelle liefern.
- `buildSourceListMarkup`: `pages` anzeigen (z. B. „S. 40, 145"), Erwähnungen dezent markieren, **url-lose Quelle
  als Klartext** (kein Link).
- `review-feature-sources.js`: Typ-Dropdown auf die 8er-Taxonomie; Wiki-abgeleitete Quellen als eigene
  („automatisch")-Gruppe zeigen, Entfernen = Suppression. Hinweisbox bleibt.

**Reuse-Map (erweitern vs. neu):**

| Erweitern (bestehend) | Neu (im bestehenden Muster) |
|---|---|
| `sources`/`feature_sources` (+Spalten, +8er-Typ, url-los) | `wiki_publication_catalog` |
| `avesmapsFeatureSourceUpsert`/`…Link` (+origin) | `wiki_entity_publication` |
| Dump-Reader + `…ExtractInfoboxBlock`/`ParseTemplateParams` | — |
| `wiki_sync_runs` (+Phase) | — |
| `avesmapsReadFeatureSources` + `buildSourceListMarkup` | — |
| `review-feature-sources.js` | — |

## 9. Community-Slot (RESERVIERT — eigene Fast-Follow-Instruction)

Nicht Teil dieser Instruction, aber hier vorbereitet: dritte Ebene `origin='community'`, `status='pending'`;
public read zeigt nur `approved` → Vorschläge unsichtbar bis moderiert. Umsetzung später durch **Erweiterung**
von `report-location.php` + `review-report-flow.js` (+ Moderation `api/edit/reports/locations.php`); beim Klick
auf eine Quelle das Meldeformular aus dem bestehenden Eintrag vorbefüllen.

## 10. Edge Cases

- Publikation in mehreren Abschnitten desselben Elements → stärkstes `reference_kind` gewinnt (ausführlich > ergänzend > erwähnung).
- Referenz ohne Seitenangabe → Quelle trotzdem, `pages=NULL`.
- Publikation ohne eigene Wiki-Seite/Infobox → Quelle als Name-only (kein Link), `wiki_key` aus dem Referenz-Titel.
- Redirects (Publikationstitel) über die bestehende `wiki_redirect_alias`-Map auflösen.
- `wiki_key`-Ableitung bit-genau über die bestehenden Helfer (Invariante I1 der Dump-Migration).

## 11. Nicht in Scope

Community-„Quelle vorschlagen"-UI + Moderation (§9, eigene Instruction); URL-Auto-Offiziell-Heuristiken über die
Template-basierte Offiziell-Markierung hinaus; Nicht-Publikations-Quelltypen.

## 12. Handoff

Dieser Spec → Umsetzungsplan (Task-Zerlegung, TDD) → Instruction-Doc für eine neue Session (Muster wie
`docs/refactoring-wikidump-migration.md`). Verwandte Docs: `docs/quellen-system-2-editor-design.md`,
`docs/refactoring-wikidump-migration.md`, `AGENTS.md` (Dump/STRATO/Policy).
