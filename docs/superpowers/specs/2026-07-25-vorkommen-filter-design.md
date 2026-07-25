# Vorkommen-Liste: Filter-Trichter (Kontinent + drei weitere Facetten)

**Stand:** 2026-07-25 · **Auslöser:** Owner-Wunsch nach Bug #53. Neben „Name oder
Art suchen" soll die Vorkommen-Liste einen Trichter-Filter bekommen; vorrangig
**Kontinent (Vorgabe Aventurien)**, dazu **Herkunft**, **Ohne Ortsangabe**, **Ohne
Quelle**.

## Warum server-seitig

Seit Bug #53 (`7b8fc7f6`) lädt die Vorkommen-Liste seitenweise nach (Endlos-Scroll,
`limit=200&offset=`). Ein Browser-Filter — wie ihn Siedlungen/Abenteuer/Karten über
`WIKI_SYNC_SUBJECT_FACETS` (aus geladenen Zeilen abgeleitet) nutzen — sähe nur die
schon geladene Seite. `review-subjects.js` hat das ausdrücklich vermerkt: Vorkommen-
Facetten „müssen in die Abfrage, nicht in den Browser; das ist ein eigener Schritt."
Das ist dieser Schritt. Der Trichter selbst ist die geteilte `js/ui/filter-menu.js`
(`avmFilterMenuAttach`), die UI bleibt identisch zu den anderen fünf Filterflächen.

## Die vier Facetten

| Facette | Trichter-Art | Datenquelle | Re-Sync nötig? |
|---|---|---|---|
| **Kontinent** | `multi`, Vorgabe **Aventurien** | neue Spalte `lore_entry.continent` | **ja** |
| **Herkunft** | `multi` (wiki/manual/community) | `lore_entry.origin` (existiert) | nein |
| **Ohne Ortsangabe** | `single` (alle/mit/ohne) | `lore_place`-Verknüpfung | nein |
| **Ohne Quelle** | `single` (alle/mit/ohne) | `feature_sources` (entity_type='lore') | nein |

**Leerer Kontinent zählt als Aventurien.** Vor dem Re-Sync ist `continent` bei allen
Einträgen leer → alles gilt als Aventurien → die Vorgabe blendet nichts aus (kein
Bruch). Die drei anderen Facetten wirken sofort, ihre Spalten existieren schon.

**Aktiv-Badge:** Kontinent=nur-Aventurien zählt NICHT als aktiver Filter (Karten-
Identität, keine Einschränkung — dieselbe Ausnahme wie in
`filter-funnel-shared-component`). Jede Abweichung davon zeigt „(n)" im Knopf.

## Server

### Schema (`api/_internal/wiki/lore-sync.php`)
- `continent VARCHAR(120) NULL` in `lore_entry` UND im Staging-Katalog
  `wiki_lore_catalog`; selbstheilend über das `SHOW COLUMNS`+`ADD COLUMN`-Muster
  (wie `api/_internal/app/citymaps.php`).
- `'continent'` in `AVESMAPS_LORE_WIKI_FIELDS` → override-sicher (Handkorrektur per
  `field_origins_json` überlebt, wie jedes andere Lore-Feld).

### Kontinent-Erkennung (Dump-Build, `avesmapsLoreBuildCatalogStep`)
- Aus dem Seiten-Wikitext die `[[Kategorie:…]]` ziehen (reiner Regex, kein API-Fetch)
  und mit Titel + `lebensraum` zu einem Kontext fügen.
- `avesmapsWikiSyncMonitorDetectContinent($context)` — **dieselbe** Logik wie
  Regionen/Wege/Siedlungen. Auf dem Dump-Pfad geladen (dump.php zieht
  sync-monitor/paths/regions), hier `function_exists`-guarded (die Datei bleibt
  side-effect-free include für den Unit-Test); ohne Erkenner → leer = Aventurien.
- Der stärkste Signalgeber ist die Kategorie (`Myranor-Artikel` …); Aventurien-
  Artikel tragen meist keine Kontinent-Kategorie → Default Aventurien greift.

### Reconcile
- `continent` in `$desired` (aus Staging), in den Insert (`insertEntryLive`) und —
  automatisch — in den Update-Plan (`avesmapsLoreFieldPlan` iteriert WIKI_FIELDS).

### Katalog-Endpoint (`api/_internal/app/lore.php` `avesmapsLoreReadCatalog` + `api/app/lore.php`)
- Neue Parameter: `&continent=` und `&origin=` (mehrwertig, `|`-getrennt),
  `&has_place=0|1`, `&has_source=0|1`.
- WHERE: `continent IN (…)` (mit „Aventurien gewählt ⇒ auch leerer continent");
  `origin IN (…)`; `EXISTS/NOT EXISTS lore_place`; `EXISTS/NOT EXISTS feature_sources`.
- Antwort liefert zusätzlich die **verfügbaren Werte mit Zählern** für den Trichter:
  `continents:[{value,count}]`, `origins:[{value,count}]` — berechnet über die Basis
  (kind+q), NICHT über die Facetten selbst, damit man alle Werte weiter sieht. Nur
  bei `offset==0` berechnet (auf Scroll-Seiten unnötig).

## UI

- `index.html`: neben BEIDEN Suchfeldern (`#lore-list-search` im Reiter,
  `#lore-dlg-search` im Fenster) ein Trichter-Knopf + verstecktes Panel mit vier
  Abschnitts-Containern.
- `js/review/review-wiki-sync.js`: `avmFilterMenuAttach` je Ansicht; Zustands-Objekte
  (Kontinent-Set default {Aventurien}), `getOptions` aus der letzten Katalog-Antwort,
  `applyFilter` = frischer `loadLoreList`. Die Filterwerte reisen als URL-Parameter in
  `avesmapsLoreFetchList`; Endlos-Scroll trägt sie auf Folgeseiten mit.
- Kein `ASSET_VERSION`-Bump: alle drei Dateien lädt `index.html` direkt (auto-stamped).

## Rollout

1. Code deployen → Herkunft/Ortsangabe/Quelle wirken sofort; Kontinent-Trichter ist
   da, zeigt aber nur „Aventurien" (alle Einträge), bis Daten da sind.
2. Owner: **1× „Dump holen" + „Vorkommen syncen"** → `continent` füllt sich, der
   Kontinent-Filter wird scharf.

## Test

- PURE Unit-Tests: Kontinent-Kontextbau (Kategorie-Extraktion) und die WHERE-/Params-
  Auflösung (DB-frei, wie `lore-sync-test.php`).
- UI: Prüfgestell mit Stub-Fetch für die Kette Trichter→Parameter→frische Liste
  (wie beim Bug-#53-Gestell).
- Server-SQL end-to-end: Herkunft/Ortsangabe/Quelle per curl gegen den Live-Katalog
  nach dem Deploy; Kontinent erst nach dem Owner-Re-Sync.
