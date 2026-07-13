# Abenteuer-Editor — Phase 4 (Dump-Sync + Menüband) Bau-Blueprint

> Status: **gescopt** (Infrastruktur kartiert 2026-07-13). Prosa DE, Bezeichner EN. Ergänzt
> `docs/abenteuer-instruction.md` §Phase 4 mit den konkreten Nahtstellen. **Bau = eigene fokussierte
> Session** (Owner-Regel „eine Phase pro Session"); dieses Dokument ist die Vorlage dafür.

## Vorabcheck (§4.0) — Ergebnis: **FELD-ERGÄNZUNG, keine Parser-Neuentwicklung**

Der bestehende Publikations-Sync (`api/_internal/wiki/publication-sync.php`) liest bereits
`{{Infobox Produkt}}` — **dieselbe** Infobox, die Abenteuer nutzen — und erfasst `Art` (→ Produkttyp,
inkl. Gruppen-/Solo-/Kurzabenteuer/…) + F-Shop-PID + ISBN. **Fehlen** (müssen im Infobox-Parser
`avesmapsWikiParseProductInfobox` ergänzt werden): **`Ort`** (geordnete Wikilink-Liste — Reihenfolge STRIKT
bewahren!), **`Komplexität Spielleiter`/`Komplexität Spieler`**, **`Genre`**, `Regelsystem`, Erscheinungs-/
Derisches Datum (BF), `Cover`.

## Menüband (die Sync-Ribbon) — exakte Nahtstellen

Muster: die vier bestehenden Sync-Tabs (Siedlungen/Territorien/Regionen/Wege) in `index.html:362–418`.

1. **Neuer Tab** in `<nav class="wiki-sync-panel__tabs">` (nach `data-wiki-sync-panel-tab="paths"`):
   `<button class="wiki-sync-panel__tab" data-wiki-sync-panel-tab="adventures">Abenteuer</button>`
2. **Neues Tab-Panel** (Muster Wege-Panel):
   `#wiki-sync-sync-adventure` (Button „🚨 Syncen", Klassen `wiki-sync-panel__start wiki-sync-kind-sync`) +
   `#wiki-sync-sync-adventure-synced` (Span) + `#wiki-sync-sync-adventure-progress` + `#wiki-sync-sync-adventure-status`.
3. **Bootstrap** (`js/app/bootstrap.js`, nach Zeile 274):
   `$("#wiki-sync-sync-adventure").on("click", () => startWikiSyncKindSync("adventure"));`
4. **`WIKI_SYNC_KIND_ELEMENTS`** (`js/review/review-wiki-sync.js:741`): `adventure`-Eintrag (button/progress/
   status/synced) → dann füllt die bestehende Synced-Schleife (`:535–561`) `#adventure-editor-synced` +
   `#wiki-sync-sync-adventure-synced` automatisch, sobald `synced.adventure` ankommt.
5. `startWikiSyncKindSync(kind)` (`:917–966`) auf den `adventure`-Kind erweitern.

## Sync-Kind-Maschinerie — `api/_internal/wiki/dump-sync-kind.php`

- `AVESMAPS_WIKI_DUMP_SYNC_KINDS` (`:84`): `'adventure'` hinzufügen.
- `avesmapsWikiDumpSyncKindEntityKinds()` (`:104`): `case 'adventure'`-Zweig.
- `avesmapsWikiDumpSyncKindLastSynced()` (`:150`): `$result['adventure'] = MAX(synced_at)` aus dem
  Abenteuer-Staging (bzw. `adventure`-Tabelle).

## Backend — Ingestion + override-sicherer Reconcile

- **Parser-Erweiterung:** `avesmapsWikiParseProductInfobox` um die o. g. Felder ergänzen; **`Ort`-Liste in
  Quell-Reihenfolge** parsen (Wikilinks in Reihenfolge; erster = Startort/`role='start'`, Rest `role='play'` —
  NICHT umsortieren). Test mit echtem Abenteuer-Wikitext (Node/PHP-Test neben dem Parser).
- **Staging:** neues `wiki_adventure_staging` (+ Orte-Staging), nur Staging schreiben (WikiDump-Invariante).
- **Reconcile:** `avesmapsAdventureDiffLinks($current,$desired)` (reiner Planer, Muster
  `avesmapsPublicationDiffLinks`, `publication-sync.php:118`): schreibt/aktualisiert/löscht **nur**
  `origin='wiki' AND status='approved'`; **`manual`/`community`/`suppressed` unangetastet**; idempotent per
  `wiki_key`. Gilt für Abenteuer-**Felder** (`field_origins_json`) **und** `adventure_place` (inkl. `role`-Schutz).
  Nach Reconcile: `resolve` (Namen→Entity) auf die neuen Wiki-Orte (nutzt den P1-Resolver + P3-Erkenntnisse:
  Regionen via `wiki_region`; nicht-verknüpfte bleiben `unresolved`/„ohne Wiki-Eintrag").
- **Phase-Registrierung** im Dump-Hybrid-Driver (`dump-hybrid-driver.php`), resumable via `stats_json`.

## Invarianten (Pflicht)

- **`Ort`-Reihenfolge strikt bewahren** (erster = Start). **Sync MUSS VOLLSTÄNDIG sein** — die Wiki-Listen
  (z. B. Gruppenabenteuer/Liste) haben pro Ort VIEL mehr Abenteuer als die 6 Bootstrap-Samples; nichts verlieren.
  **Dump-basiert, KEINE HTML-Crawls.**
- **Override-sicher:** die 6 `origin='manual'`-Bootstrap-Samples fasst der Reconcile NICHT an → vor dem
  Erst-Sync ggf. entfernen/mergen (sonst Dubletten).
- STRATO: schwere Endpoints nur Einzel-Request, nie loopen. Nur Tokens/kein Blau in der UI. `?v=Date.now()`
  bleibt für den Editor (nicht betroffen; die Ribbon ist Teil von `index.html`, wird gestempelt).

## Datei-Landkarte

| Datei | Aktion |
|---|---|
| `api/_internal/wiki/publication-parsing.php` (bzw. wo `avesmapsWikiParseProductInfobox` lebt) | **ändern** — Felder ergänzen |
| `api/_internal/wiki/publication-sync.php` | **ändern/erweitern** — Adventure-Staging + Reconcile-Aufruf |
| neues Adventure-Reconcile (Lib) | **neu** — `avesmapsAdventureDiffLinks` + `…ReconcileEntity` + Test |
| `api/_internal/wiki/dump-sync-kind.php` | **ändern** — `adventure`-Kind (`:84/104/150`) |
| `api/_internal/wiki/dump-hybrid-driver.php` | **ändern** — Adventure-Phase registrieren |
| `index.html` (`.wiki-sync-panel__tabs` + Panel) | **ändern** — „Abenteuer"-Tab + Sync-Steuerung |
| `js/app/bootstrap.js` | **ändern** — Klick-Wiring |
| `js/review/review-wiki-sync.js` | **ändern** — `WIKI_SYNC_KIND_ELEMENTS` + Kind-Sync + Synced-Datum |

Backend P1/P2/P3 (adventure/adventure_place, Editor, Resolver) unverändert — Phase 4 füllt/aktualisiert sie
override-sicher aus dem Dump.
