# Sync-Übernahme — Sitzung 1: Fundament und Stadtkarten

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Entwurf:** [`docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`](../specs/2026-08-06-sync-uebernahme-design.md) ·
**Mockup:** [`docs/sync-uebernahme-mockup.html`](../../sync-uebernahme-mockup.html) · **Stand:** 2026-08-06

**Goal:** Der Wiki-Abgleich der Stadtkarten schreibt und löscht nichts mehr ohne Häkchen — er rechnet
einen Plan, zeigt ihn in drei Kategorien, und erst „Übernehmen" schreibt; die Übernahme hinterlässt
genau EINE Zeile im Änderungsprotokoll.

**Architecture:** Der Reconcile wird in zwei Hälften geschnitten. Die **Rechen-Hälfte**
(`avesmapsCitymapPlanStep`) behält die Cursor-Bauart des heutigen `avesmapsCitymapReconcileStep`, ruft
dieselben reinen Plan-Funktionen, schreibt aber Zeilen nach `sync_plan_item` statt in die Nutztabellen.
Die **Ausführ-Hälfte** (`avesmapsCitymapApplyStep`) arbeitet die angehäkelten Planzeilen ab und ruft
dafür den **unveränderten** `avesmapsCitymapReconcileEntity` — die Übernahme benutzt also denselben
override-sicheren Schreiber wie heute, nur ausgelöst durch ein Häkchen statt durch den Katalog. Drei
neue Tabellen (`sync_plan_run`, `sync_plan_item`, `sync_decision`) und **ein** Oberflächen-Bauteil, das
Sitzung 2–4 mitbenutzen.

**Tech Stack:** PHP 8 strict types + PDO/MySQL (self-healing Inline-DDL), vanilla JS ohne Build,
Tokens aus `css/base/tokens.css`. Tests: `assert()`-Skripte unter `__tests__/` (PHP) und
`node …test.js` mit `vm`-Sandbox (JS).

---

## Global Constraints

- **Ein Commit.** Vorher die volle Testsuite grün, nur selbst berührte Pfade stagen (AGENTS.md §9,
  geteilter Arbeitsbaum — **nie** `git add -A`).
- **Kein Dump, kein Sync, kein Massenlauf wird ausgelöst.** Live geprüft wird ausschließlich
  read-only + Statuscodes.
- **Keine Sprachänderung an Oberflächentexten**: neue UI-Texte sind deutsch, Kommentare/Doku englisch
  (AGENTS.md §8) — **außer** dort, wo die Nachbarschaft schon deutsch kommentiert (citymap-sync.php
  §Löschweg); dann in der Nachbarsprache bleiben.
- **Kein hartkodierter Farbwert / Radius / Trenner.** Alles aus `css/base/tokens.css`; fehlt ein Token,
  wird es dort zuerst angelegt (AGENTS.md §12).
- **`?v=` nie von Hand.** Neue CSS/JS werden aus `html/citymap-editor.html` verlinkt und damit vom
  Deploy gestempelt (AGENTS.md §7 Regel 1). `ASSET_VERSION` in
  `js/territory/territory-editor-inline-host.js` **nicht** anfassen — die Karten-Editorseite wird mit
  `?v=Date.now()` geladen (`js/review/review-settlement-list.js:907`).
- **STRATO:** nichts in einer Schleife abfragen; jede Liste in EINEM Abruf, serverseitig begrenzt.
- **Testbefehl PHP** (Extensions sind Pflicht, sonst falsche Rot-Meldungen):
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll <test>`
- **Testbefehl JS:** `node <pfad>.test.js`
- **Jede neue Zusicherung wird durch Mutation belegt** (Entwurf §8): den Fehler in einer Sandkopie
  wiederherstellen, Rot verlangen, zurücknehmen.

### Die zwei Antworten aus §10 (Owner-Entscheid, hier festgeschrieben)

1. **Löschungen anhäkeln darf `edit`** — nicht `admin`. Grund im Code: der Löschweg von Hand
   (`api/edit/map/citymaps.php:32` → `avesmapsDeleteCitymap`) löscht dieselbe Karte **sofort**, mit
   nur einer Rückfrage im Browser, und steht schon heute hinter `edit`. Der Vorschau-Weg wäre der
   strengere von beiden (zweite Bestätigung + Protokollzeile + dauerhafte Behalten-Entscheidung) — ihn
   auf `admin` zu legen, hieße den vorsichtigeren Weg zu verriegeln und den schnellen offen zu lassen.
   `admin` gibt es (3 Endpunkte, u. a. das Datenbank-Backup), hat aber fast niemand; Löschungen blieben
   liegen. Der `owner-only`-Kommentar an `avesmapsDeleteCitymap` wird bei der Gelegenheit **nicht**
   geändert — er ist älter als dieses Vorhaben und gehört in eine eigene Sitzung.
2. **200 Zeilen je Kategorie**, serverseitig (`AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT`). Die Vorschau nennt
   die **echte** Zahl aus `counts_json` und schreibt „… und 4.812 weitere (sind angehäkelt)". Die
   ausgeblendeten Zeilen stehen mit ihrem `selected`-Wert in der Datenbank — „alle übernehmen" wirkt
   also auch auf sie, ohne dass jemand sie sieht. Genau so rechnet auch das Mockup (`data-hidden`).

### Was in Sitzung 1 bewusst NICHT gebaut wird

- **Kein „N Läufe fehlend"-Merkmal** an Löschzeilen. Das Mockup zeigt es, aber wir speichern nirgends,
  seit wann ein `wiki_key` aus dem Katalog fehlt — die Zahl wäre erfunden. Die Löschzeile sagt
  stattdessen, was sie beweisen kann: *„Im aktuellen Dump nicht mehr enthalten. Mit ihr gehen 4
  Fundorte, 2 Quellenverweise, 1 Verweis."*
- **Kein `override_json` je Feld** für Karten. Bei Stadtkarten ist der Override die **ganze** Karte
  (`origin='manual'` ⇒ der Plan überspringt sie, sie taucht gar nicht auf). Die einzige Ausnahme, die
  es wirklich gibt, wird gefüllt: der **Ort** einer Karte, den ein Mensch gesetzt oder aufgelöst hat
  (`citymap_place.origin != 'wiki'` oder `target_kind != 'unresolved'`) — dort steht dann
  `{"place":"bleibt \"…\""}`. Die Spalte bleibt für Sitzung 2 (Vorkommen) da, wo es Feld-Overrides gibt.
- **Kein `apply_state='failed'`.** Bricht eine Zeile mit einer Exception ab, hört der Lauf auf (500)
  und der Client meldet den Fehlschlag — siehe Task 4, „Warum kein try/catch in der Ausführschleife".
  Der Wert bleibt im Schema, weil der Entwurf ihn nennt, wird in Sitzung 1 aber nie geschrieben.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| **neu** `api/_internal/wiki/sync-plan.php` | Das Fundament, **kind-agnostisch**: DDL der drei Tabellen, Lauf-Lebenszyklus, Zeilen schreiben/lesen/häkeln, Entscheidungs-Tabelle, und die **reinen** Regeln (Vorhäkeln, Veraltung, Zählung). Kennt keine Stadtkarte. |
| **ändern** `api/_internal/wiki/citymap-sync.php` | Bekommt die Rechen-Hälfte (`avesmapsCitymapPlanStep`), die read-only-Sonden (Quelle/Fundstellen/Ort), den Löschzeilen-Erzeuger (`avesmapsCitymapVanishedRows`) und den Einzel-Löscher (`avesmapsCitymapDeleteWikiRow`). Verliert `avesmapsCitymapReconcileStep` und `avesmapsCitymapRemoveVanished`. `…ReconcilePlan`, `…PlaceReconcilePlan`, `…RemovableKeys`, `…ReconcileEntity(+Writes)` bleiben **unverändert**. |
| **neu** `api/_internal/wiki/citymap-plan-apply.php` | Die Ausführ-Hälfte für Karten: `avesmapsCitymapApplyStep` (gebündelter Schritt, Nachprüfung, Abschlussarbeit, eine Protokollzeile). Eigene Datei, damit die Rechen-Hälfte nachweisbar keinen Schreiber sieht. |
| **ändern** `api/edit/wiki/dump.php` | `sync_citymaps` treibt jetzt die **Rechen**-Hälfte und antwortet mit `run_id` + `counts`. |
| **neu** `api/edit/wiki/sync-plan.php` | Vorschau-Endpunkt (`get` · `select` · `apply` · `declined` · `undecline`), Fähigkeit `edit`. |
| **ändern** `api/_internal/map/collection-audit.php` | Neue Aktion `apply_sync_plan` + Schreiber `avesmapsLogSyncPlanApply`. |
| **neu** `css/components/sync-plan-sheet.css` | Das Bauteil nach dem Mockup, nur mit Tokens. |
| **neu** `js/review/sync-plan-sheet.js` | Das Bauteil: reine Bauer (`syncPlanSheetMarkup`, `syncPlanFooterState`, `syncPlanFieldLabel`) + der DOM-Aufsatz. Läuft in der `vm`-Sandbox ohne DOM. |
| **ändern** `html/citymap-editor.html` | Verlinkt CSS+JS, hat den Wirt `<div id="ceSyncPlanHost">`, öffnet die Vorschau nach dem Rechnen. |
| **ändern** `js/review/review-wiki-sync.js` | Die Statuszeile sagt „46 Unterschiede — Vorschau offen" statt „übernommen"; der Loop gibt `run_id`/`counts` zurück. |
| **ändern** `js/review/review-panels-change-log.js` | Beschriftung für `apply_sync_plan`. |
| **neu** `api/_internal/wiki/__tests__/sync-plan-test.php` | Die reinen Regeln des Fundaments. |
| **neu** `api/_internal/wiki/__tests__/citymap-plan-test.php` | Planzeilen-Bildung, Leerkatalog-Riegel, Behalten-Riegel, Nachprüfung (sqlite, wo eine DB nötig ist). |
| **neu** `api/_internal/wiki/__tests__/sync-plan-purity-test.php` | 💣 Die Kern-Zusicherung: die Rechen-Hälfte enthält kein `INSERT/UPDATE/DELETE` auf eine Nutztabelle. |
| **neu** `js/review/__tests__/sync-plan-sheet.test.js` | Bauteil: Vorhäkeln, Fußzeile, Löschriegel, Escaping. |
| **ändern** `api/_internal/wiki/__tests__/citymap-delete-parity-test.php` | Zeigt auf `avesmapsCitymapDeleteWikiRow` statt auf den entfallenen Sammel-Löscher. |
| **ändern** `api/_internal/wiki/__tests__/reconcile-transaction-test.php` | `citymap-plan-apply.php` kommt in die `$callerFiles`-Liste. |
| **ändern** `api/_internal/map/__tests__/collection-audit-test.php`, `js/review/__tests__/change-log-collection-labels.test.js` | Die neue Aktion. |

---

## Task 1 — Das Fundament: drei Tabellen und die reinen Regeln

**Files:**
- Create: `api/_internal/wiki/sync-plan.php`
- Test: `api/_internal/wiki/__tests__/sync-plan-test.php`

**Interfaces:**
- Produces:
  - `avesmapsEnsureSyncPlanTables(PDO $pdo): void`
  - `avesmapsSyncPlanStartRun(PDO $pdo, string $kind, int $userId, ?string $sourceStamp): int`
  - `avesmapsSyncPlanBuildingRun(PDO $pdo, string $kind): ?array`
  - `avesmapsSyncPlanOpenRun(PDO $pdo, string $kind): ?array`
  - `avesmapsSyncPlanAddItem(PDO $pdo, int $runId, array $item): void`
  - `avesmapsSyncPlanFinishBuild(PDO $pdo, int $runId): array` (schreibt `counts_json`, `state='open'`, gibt die Zahlen zurück)
  - `avesmapsSyncPlanDecisions(PDO $pdo, string $kind): array` — `"<entity_key>\n<change_type>" => ['skipped_count'=>int,'last_skipped_at'=>?string,'declined_at'=>?string]`
  - `avesmapsSyncPlanDecisionKey(string $entityKey, string $changeType): string` *(PURE)*
  - `avesmapsSyncPlanDefaultSelected(string $changeType, int $skippedCount): int` *(PURE)*
  - `avesmapsSyncPlanIsStale(?array $stored, ?array $fresh): bool` *(PURE)*
  - `avesmapsSyncPlanCountsFromItems(array $items): array` *(PURE)*
  - `avesmapsSyncPlanRecordSkip(PDO,string $kind,string $entityKey,int $userId): void`
  - `avesmapsSyncPlanRecordDecline(PDO,string $kind,string $entityKey,int $userId): void`
  - `avesmapsSyncPlanClearSkip(PDO,string $kind,string $entityKey): void`
  - `avesmapsSyncPlanUndecline(PDO,string $kind,array $entityKeys): int`
  - `avesmapsSyncPlanDeclinedList(PDO,string $kind,int $limit): array`
  - Konstanten: `AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT = 200`, `AVESMAPS_SYNC_PLAN_APPLY_BUDGET = 40`,
    `AVESMAPS_SYNC_PLAN_CHANGE_TYPES = ['new','changed','deleted']`

- [ ] **Step 1: Den Test schreiben (rein, ohne DB)**

`api/_internal/wiki/__tests__/sync-plan-test.php`:

```php
<?php
declare(strict_types=1);
/**
 * Die reinen Regeln des Übernahme-Fundaments (Entwurf §2/§5/§8). Kein DB-Zugriff.
 * Run: php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
require_once __DIR__ . '/../sync-plan.php';

// --- Vorhäkeln (Entwurf §2) ------------------------------------------------------------------
assert(avesmapsSyncPlanDefaultSelected('new', 0) === 1, 'Neu ist vorangehäkelt');
assert(avesmapsSyncPlanDefaultSelected('new', 9) === 1, 'auch nach Überspringen -- Neu kennt keinen Zähler');
assert(avesmapsSyncPlanDefaultSelected('changed', 0) === 1, 'Geändert ist vorangehäkelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 1) === 1, 'einmal stehen gelassen: noch vorangehäkelt');
// 💣 Ab dem ZWEITEN Überspringen nicht mehr: der Mensch hat zweimal Nein gesagt.
assert(avesmapsSyncPlanDefaultSelected('changed', 2) === 0, 'zweimal Nein -> nicht mehr vorangehäkelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 7) === 0);
// 🔴 Gelöscht ist NIE vorangehäkelt -- das ist der Kern des Entwurfs, nicht eine Vorliebe.
assert(avesmapsSyncPlanDefaultSelected('deleted', 0) === 0, 'Löschen ist nie vorangehäkelt');
assert(avesmapsSyncPlanDefaultSelected('deleted', 5) === 0);

// --- Der Schlüssel der Entscheidung ------------------------------------------------------------
// 💣 Zwei Bedeutungen in EINER Tabelle: derselbe Eintrag kann eine abgelehnte Löschung UND eine
// übersprungene Änderung haben. Fiele change_type aus dem Schlüssel, überschriebe eines das andere.
assert(
    avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'deleted')
        !== avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'changed'),
    'Löschung und Änderung derselben Zeile sind zwei Entscheidungen'
);

// --- Veraltung (Entwurf §4a/§8) ----------------------------------------------------------------
$stored = ['title' => 'Havena – Hafenviertel', 'has_scale' => '1'];
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel', 'has_scale' => '1']) === false);
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena, Hafen', 'has_scale' => '1']) === true, 'Wert weicht ab');
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel']) === true, 'Feld fehlt jetzt');
assert(avesmapsSyncPlanIsStale($stored, null) === true, 'nichts mehr zu tun -> veraltet, nicht ausführen');
// ⚠️ Reihenfolge darf nicht zählen: der Vergleich ist über SCHLÜSSEL, nicht über die JSON-Zeichenkette.
assert(avesmapsSyncPlanIsStale($stored, ['has_scale' => '1', 'title' => 'Havena – Hafenviertel']) === false);
assert(avesmapsSyncPlanIsStale(null, null) === false, 'eine Löschzeile hat kein after_json');

// --- Zählen ------------------------------------------------------------------------------------
$counts = avesmapsSyncPlanCountsFromItems([
    ['change_type' => 'new'], ['change_type' => 'new'],
    ['change_type' => 'changed'], ['change_type' => 'deleted'],
]);
assert($counts === ['new' => 2, 'changed' => 1, 'deleted' => 1, 'total' => 4], 'die Kachel-Zahlen');
assert(avesmapsSyncPlanCountsFromItems([]) === ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0]);

echo "sync-plan ok\n";
```

- [ ] **Step 2: Rot sehen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-test.php`
Expected: FAIL — `Failed opening required '…/sync-plan.php'`.

- [ ] **Step 3: `api/_internal/wiki/sync-plan.php` schreiben**

Kopf (Kommentar auf Englisch, AGENTS.md §8), dann:

```php
const AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT = 200;
const AVESMAPS_SYNC_PLAN_APPLY_BUDGET = 40;
const AVESMAPS_SYNC_PLAN_CHANGE_TYPES = ['new', 'changed', 'deleted'];

/**
 * How a freshly computed row arrives pre-checked. PURE (Entwurf §2).
 *
 * 🔴 'deleted' is NEVER pre-checked, whatever happened before: a deletion has to be an act, not the
 * default a tired click confirms. 'changed' drops out of the pre-check at the SECOND skip -- one
 * "not now" is a mood, two is an answer.
 */
function avesmapsSyncPlanDefaultSelected(string $changeType, int $skippedCount): int
{
    if ($changeType === 'deleted') {
        return 0;
    }
    if ($changeType === 'changed' && $skippedCount >= 2) {
        return 0;
    }

    return 1;
}

/**
 * Has the world moved on since the plan was computed? PURE (Entwurf §4a).
 *
 * 💣 Compared by KEY, not by the JSON string: json_encode preserves insertion order, so two runs that
 * agree on every value but disagree on field order would look "stale" and nothing would ever apply.
 */
function avesmapsSyncPlanIsStale(?array $stored, ?array $fresh): bool
{
    if ($stored === null) {
        return false; // a deletion row carries no after_json -- its freshness is checked differently
    }
    if ($fresh === null) {
        return true;  // nothing left to do: somebody else already did it, or the wiki changed its mind
    }
    if (count($stored) !== count($fresh)) {
        return true;
    }
    foreach ($stored as $field => $value) {
        if (!array_key_exists($field, $fresh)) {
            return true;
        }
        if ((string) ($fresh[$field] ?? '') !== (string) ($value ?? '')) {
            return true;
        }
    }

    return false;
}
```

`avesmapsSyncPlanDecisionKey` verbindet mit `"\n"` (kann in keinem `wiki_key` vorkommen).
`avesmapsSyncPlanCountsFromItems` zählt über `AVESMAPS_SYNC_PLAN_CHANGE_TYPES` und `total`.

Die DDL — **ein** `avesmapsEnsureSyncPlanTables`, drei `CREATE TABLE IF NOT EXISTS` genau nach
Entwurf §5 (`sync_plan_run`, `sync_plan_item`, `sync_decision`), `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
Indizes `idx_sync_plan_item_run (run_id, change_type, id)` und
`idx_sync_plan_item_apply (run_id, selected, apply_state, id)`, Primärschlüssel der Entscheidung
`(kind, entity_key, change_type)`.

⚠️ **Die DDL läuft NUR im Schreibpfad** (Rechen-Hälfte, Ausführ-Hälfte) — nie im Lesepfad des
Vorschau-Endpunkts. Der `get` fängt „Tabelle fehlt" (SQLSTATE `42S02`) ab und antwortet „kein Plan".
Das ist die Lehre aus dem Änderungsverlauf (AGENTS.md §11): DDL im Lesepfad macht die Datei ohne
lebende Datenbank untestbar und lässt sie bei jedem Besuch laufen.

`avesmapsSyncPlanStartRun` setzt zuerst alle `state IN ('building','open')`-Läufe derselben `kind` auf
`'superseded'` (Entwurf §6) und legt dann den neuen an.

- [ ] **Step 4: Grün sehen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-test.php`
Expected: `sync-plan ok`

- [ ] **Step 5: Mutation — beißt der Test?**

`avesmapsSyncPlanDefaultSelected` kurz auf `return 1;` für `deleted` ändern → der Test MUSS rot werden
(„Löschen ist nie vorangehäkelt"). Zurücknehmen. Dasselbe mit `>= 2` → `>= 3`.

---

## Task 2 — Die Rechen-Hälfte für Stadtkarten

**Files:**
- Modify: `api/_internal/wiki/citymap-sync.php` (neu ans Ende von Abschnitt „reconcile"; `avesmapsCitymapReconcileStep` entfällt)
- Test: `api/_internal/wiki/__tests__/citymap-plan-test.php`

**Interfaces:**
- Consumes: `avesmapsSyncPlanStartRun`, `…AddItem`, `…FinishBuild`, `…Decisions`, `…DefaultSelected`,
  `…DecisionKey` (Task 1); unverändert `avesmapsCitymapReconcilePlan`, `avesmapsCitymapPlaceReconcilePlan`,
  `avesmapsCitymapWikiLinkPlan`, `avesmapsCitymapDesiredWikiLinks`.
- Produces:
  - `avesmapsCitymapPlanItem(?array $current, array $desired, ?array $currentPlace, string $desiredPlaceRaw, array $linkPlan, bool $sourceMissing): ?array` *(PURE)* → `null | ['change_type'=>…, 'after'=>[], 'before'=>[], 'override'=>[]]`
  - `avesmapsCitymapWikiLinkDiff(PDO $pdo, ?int $citymapId, string $sourceRaw): array` *(read-only)*
  - `avesmapsCitymapSourceLinkMissing(PDO $pdo, ?string $publicId, string $sourceRaw): bool` *(read-only)*
  - `avesmapsCitymapPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array`
    → `{done, nextCursor, run_id, planned, processed, counts}`

- [ ] **Step 1: Den Test für die reine Zeilenbildung schreiben**

`api/_internal/wiki/__tests__/citymap-plan-test.php` (Teil 1 — rein, ohne DB):

```php
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../citymap-sync.php';   // pure functions only; the file has no top-level code

$desired = ['title' => 'Havena – Hafenviertel', 'art' => 'stadtplan', 'is_color' => 1,
    'is_labeled' => 1, 'format' => 'A3', 'has_scale' => 1, 'author' => 'Ina Kramer',
    'publisher' => 'Ulisses', 'note' => null, 'map_url' => 'https://wiki/X'];
$leer = ['insert' => [], 'update' => [], 'delete' => []];

// --- Neu ---------------------------------------------------------------------------------------
$item = avesmapsCitymapPlanItem(null, $desired, null, 'Havena', $leer, true);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['title'] === 'Havena – Hafenviertel');
assert($item['before'] === [], 'eine neue Karte hat kein Vorher');

// --- Handarbeit taucht NICHT auf (Entwurf §3.1) --------------------------------------------------
// 💣 Diese Zusicherung ist der Grund, warum ein Editor der Vorschau trauen darf.
$manual = ['origin' => 'manual', 'status' => 'approved', 'title' => 'Eigener Titel'];
assert(avesmapsCitymapPlanItem($manual, $desired, null, 'Havena', $leer, true) === null);
$community = ['origin' => 'community', 'status' => 'approved', 'title' => 'X'];
assert(avesmapsCitymapPlanItem($community, $desired, null, 'Havena', $leer, true) === null);
$grabstein = ['origin' => 'wiki', 'status' => 'suppressed', 'title' => 'X'];
assert(avesmapsCitymapPlanItem($grabstein, $desired, null, 'Havena', $leer, true) === null);

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
$gleich = ['origin' => 'wiki', 'status' => 'approved'] + $desired;
$ortGleich = ['origin' => 'wiki', 'status' => 'approved', 'target_kind' => 'unresolved', 'raw_name' => 'Havena'];
assert(avesmapsCitymapPlanItem($gleich, $desired, $ortGleich, 'Havena', $leer, false) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile');

// --- Geändert: nur die abweichenden Felder ------------------------------------------------------
$alt = ['origin' => 'wiki', 'status' => 'approved'] + $desired;
$alt['title'] = 'Havena, Hafen';
$item = avesmapsCitymapPlanItem($alt, $desired, $ortGleich, 'Havena', $leer, false);
assert($item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['title'], 'nur das abweichende Feld, keine ganze Zeile');
assert($item['before']['title'] === 'Havena, Hafen');

// --- Quelle und Fundstellen sind auch ein Unterschied -------------------------------------------
// ⚠️ Ohne das bliebe eine Karte ohne Quellenverweis für immer ohne einen: sie hat ja kein Feld,
// das abweicht, und wäre damit unsichtbar für die Vorschau.
$item = avesmapsCitymapPlanItem($gleich, $desired, $ortGleich, 'Havena', $leer, true);
assert($item !== null && $item['after']['source'] === 'wird verknüpft');
$item = avesmapsCitymapPlanItem($gleich, $desired, $ortGleich, 'Havena',
    ['insert' => [['url' => 'https://f-shop', 'label' => 'F-Shop', 'is_paid' => 1]], 'update' => [], 'delete' => []], false);
assert($item !== null && isset($item['after']['links']));

// --- Der Ort als einziger echter Feld-Override ---------------------------------------------------
$ortEigen = ['origin' => 'manual', 'status' => 'approved', 'target_kind' => 'settlement', 'raw_name' => 'Havena (Hafen)'];
$item = avesmapsCitymapPlanItem($alt, $desired, $ortEigen, 'Havena', $leer, false);
assert(isset($item['override']['place']), 'ein von Hand gesetzter Ort steht als „bleibt" in der Zeile');
assert(!isset($item['after']['place']), 'und wird NICHT als Änderung vorgeschlagen');
```

- [ ] **Step 2: Rot sehen** — `Call to undefined function avesmapsCitymapPlanItem()`

- [ ] **Step 3: `avesmapsCitymapPlanItem` schreiben (rein)**

Regeln, in dieser Reihenfolge:
1. `$current === null` → `['change_type' => 'new', 'after' => alle Felder aus `avesmapsCitymapReconcilePlan`, 'before' => [], 'override' => []]`.
2. sonst `avesmapsCitymapReconcilePlan($current, $desired)`; `action === 'skip'` → **`null`** (Handarbeit,
   Community, Grabstein — §3.1).
3. `after` = `$plan['set']`; `before` = dieselben Schlüssel aus `$current`.
4. Ort: `avesmapsCitymapPlaceReconcilePlan($currentPlace, $desiredPlaceRaw)`
   - `create`/`update` → `after['place'] = $desiredPlaceRaw`, `before['place']` = alter Name
   - `skip` **und** `raw_name` weicht ab → `override['place'] = (string) $currentPlace['raw_name']`
5. `$sourceMissing` → `after['source'] = 'wird verknüpft'`.
6. Fundstellen: `insert/update/delete` nicht leer → `after['links'] = "+2 / ~0 / −1"` (kurzer Text,
   die Zeile ist eine Zeile).
7. `after === [] && override === []` → **`null`**; sonst `change_type = 'changed'`.

- [ ] **Step 4: Grün sehen**

- [ ] **Step 5: Die zwei read-only-Sonden schreiben**

```php
/**
 * Would the source link write anything? READ-ONLY twin of avesmapsCitymapLinkSource.
 *
 * 💣 The compute half may not call the writer "just to see": avesmapsCitymapLinkSource UPSERTS into
 * `sources` and links `feature_sources` as its way of answering. That is exactly the write this
 * whole change exists to move behind a checkmark.
 */
function avesmapsCitymapSourceLinkMissing(PDO $pdo, ?string $publicId, string $sourceRaw): bool
```
Baut denselben `wiki_key` (`avesmapsPublicationCatalogWikiKeyForTitle`), liest die Publikationszeile,
und fragt mit **einem** `SELECT` gegen `feature_sources` (`entity_type='citymap'`,
`entity_public_id = :pid`, `status <> 'suppressed'`), ob der Verweis schon steht. Kein Treffer im
Publikationskatalog ⇒ `false` (nie eine erfundene Quelle). Fehlende Tabellen (`42S02`) ⇒ `false`.
Ein `$publicId === null` (Karte existiert noch nicht) ⇒ `true`, wenn die Publikation bekannt ist.

`avesmapsCitymapWikiLinkDiff` = `avesmapsCitymapDesiredWikiLinks` + `SELECT … citymap_link … origin='wiki'`
+ `avesmapsCitymapWikiLinkPlan` — also **exakt** die erste Hälfte von `avesmapsCitymapReconcileWikiLinks`,
nur ohne deren drei Schreiber. `$citymapId === null` ⇒ `current = []`.

- [ ] **Step 6: `avesmapsCitymapPlanStep` schreiben**

Rumpf, Zeile für Zeile aus `avesmapsCitymapReconcileStep` übernommen, mit den Schreibern getauscht:

```php
function avesmapsCitymapPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_CITYMAP_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    avesmapsEnsureCitymapStagingTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);   // ⚠️ DDL, also VOR jeder Transaktion und nur hier

    // Der Lauf wird vom Server abgeleitet, nicht vom Client mitgeschickt: ein leerer Cursor heisst
    // "von vorn", alles andere gehört zum laufenden Bau. Eine run_id aus dem Netz wäre eine Kennung,
    // die ein zweiter Editor überschreiben könnte.
    $run = $cursor === ''
        ? ['id' => avesmapsSyncPlanStartRun($pdo, 'citymap', $userId, avesmapsCitymapLastStaged($pdo))]
        : avesmapsSyncPlanBuildingRun($pdo, 'citymap');
    …
}
```

Je Katalogzeile: `citymap` per `wiki_key` lesen → `map_url`/`publisher` ableiten (die zwei
read-only-Lookups, unverändert) → `citymap_place` lesen → die beiden Sonden → `avesmapsCitymapPlanItem`
→ bei nicht-`null` `avesmapsSyncPlanAddItem` mit
`selected = avesmapsSyncPlanDefaultSelected($changeType, $decisions[key]['skipped_count'] ?? 0)`.

Am Ende (`$done`): die Löschzeilen aus Task 3 anhängen, dann `avesmapsSyncPlanFinishBuild`.
**Nicht** mehr hier: `AppSettingSet(citymaps_last_synced)`, `avesmapsResolvePlacesInTable`,
`avesmapsWikiSyncNextMapRevision` — die wandern in die Ausführ-Hälfte (Task 4), weil sie erst nach
echten Schreibvorgängen etwas bedeuten.

- [ ] **Step 7: Testen und committen (noch nicht pushen)**

Run: der PHP-Test aus Step 1 + `php -l api/_internal/wiki/citymap-sync.php`

---

## Task 3 — Löschungen: Erzeuger und Einzel-Löscher

**Files:**
- Modify: `api/_internal/wiki/citymap-sync.php` (`avesmapsCitymapRemoveVanished` → zwei Funktionen)
- Modify: `api/_internal/wiki/__tests__/citymap-delete-parity-test.php`
- Test: `api/_internal/wiki/__tests__/citymap-plan-test.php` (Teil 2, sqlite)

**Interfaces:**
- Produces:
  - `avesmapsCitymapVanishedRows(PDO $pdo, array $declinedKeys): array` — je Zeile
    `['wiki_key','public_id','title','place_count','link_count','related_count','source_count']`
  - `avesmapsCitymapDeleteWikiRow(PDO $pdo, string $wikiKey): bool`

- [ ] **Step 1: Den sqlite-Test schreiben (Teil 2 von citymap-plan-test.php)**

```php
// --- 💣 Der Leerkatalog-Riegel (Entwurf §4c) ----------------------------------------------------
// Ein leerer Katalog heisst "Dump holen lief nicht", NICHT "das Wiki hat alles gelöscht". In der
// neuen Welt wäre der Schaden eine Vorschau mit 457 Löschvorschlägen -- und irgendwann klickt jemand.
$pdo = new PDO('sqlite::memory:');
… (citymap, citymap_place, citymap_link, citymap_related, feature_sources, wiki_citymap_catalog anlegen)
// Katalog LEER, drei lebende Wiki-Karten:
assert(avesmapsCitymapVanishedRows($pdo, []) === [], 'leerer Katalog => keine einzige Löschzeile');

// Katalog mit einer der drei -> genau zwei Löschzeilen
…
assert(count(avesmapsCitymapVanishedRows($pdo, [])) === 2);

// --- 💣 Der Behalten-Riegel (Entwurf §2/§8) ------------------------------------------------------
// Eine abgelehnte Löschung erzeugt KEINE Löschzeile mehr ...
$zeilen = avesmapsCitymapVanishedRows($pdo, ['stadtplanindex:punin-altstadt']);
assert(count($zeilen) === 1);
assert($zeilen[0]['wiki_key'] !== 'stadtplanindex:punin-altstadt');
// ... die Karte bleibt aber origin='wiki' und läuft weiter mit: sie ist über ihren wiki_key
// weiterhin auffindbar, also erzeugt der Plan-Schritt für sie weiterhin Änderungszeilen.
$row = $pdo->query("SELECT origin FROM citymap WHERE wiki_key='stadtplanindex:punin-altstadt'")->fetchColumn();
assert($row === 'wiki', '💣 NICHT manual -- „nicht löschen" ist nicht „nie wieder aktualisieren"');

// --- Manuell/Community/Grabstein tauchen nie auf ------------------------------------------------
… assert, dass eine origin='manual'-Karte ohne Katalogeintrag KEINE Löschzeile bekommt.

// --- Die Zahlen an der Zeile stimmen -------------------------------------------------------------
assert($zeilen[0]['place_count'] === 2 && $zeilen[0]['link_count'] === 1);
```

- [ ] **Step 2: Rot sehen**

- [ ] **Step 3: `avesmapsCitymapVanishedRows` schreiben**

Nimmt den Rumpf von `avesmapsCitymapRemoveVanished` bis einschließlich `avesmapsCitymapRemovableKeys`
(💣 **der Leerkatalog-Riegel wandert unverändert mit** — er steckt in `RemovableKeys` und wird nicht
angefasst), filtert `$declinedKeys` heraus und holt die Zahlen der Kinder mit **vier** gruppierten
Abfragen über die `IN (…)`-Menge — nicht einer je Karte (STRATO, §4f).

- [ ] **Step 4: `avesmapsCitymapDeleteWikiRow` schreiben**

Der Rumpf der heutigen Schleife für **eine** Karte, wörtlich: `SELECT id, public_id` → Transaktion
(`$ownsTransaction`) → `DELETE FROM citymap WHERE id = :id AND origin = 'wiki'` →
`rowCount() < 1` ⇒ rollback + `false` → `avesmapsDeleteCitymapChildRows` hinter `function_exists`
→ commit. **Der deutsche 💣-Kommentarblock über Reihenfolge und Transaktion zieht mit um** — er
erklärt genau diesen Rumpf.

- [ ] **Step 5: `citymap-delete-parity-test.php` nachziehen**

Die Regex `function avesmapsCitymapRemoveVanished\(PDO \$pdo\): int` → `function avesmapsCitymapDeleteWikiRow\(PDO \$pdo, string \$wikiKey\): bool`.
Alle sechs Zusicherungen darunter (Karte zuerst, Riegel dazwischen, Kinder danach, Transaktion,
Commit, Rollback, kein verschachteltes `beginTransaction`) bleiben **wörtlich** — sie beschreiben
denselben Rumpf. Der Kommentar bekommt einen Satz: warum die Schleife weg ist (die Auswahl trifft
jetzt ein Mensch).

⚠️ Ebenfalls prüfen: `!str_contains($syncSource, 'DELETE FROM citymap_place')` gilt weiter — die
Rechen-Hälfte darf ohnehin nichts löschen.

- [ ] **Step 6: Beide Tests grün**

Run: `citymap-plan-test.php`, `citymap-delete-parity-test.php`

- [ ] **Step 7: Mutation** — den Leerkatalog-Riegel in `avesmapsCitymapRemovableKeys` kurz auf
`if (false)` setzen → `citymap-plan-test.php` MUSS rot werden. Zurücknehmen.

---

## Task 4 — Die Ausführ-Hälfte und die eine Protokollzeile

**Files:**
- Create: `api/_internal/wiki/citymap-plan-apply.php`
- Modify: `api/_internal/map/collection-audit.php`
- Modify: `api/_internal/map/__tests__/collection-audit-test.php`
- Modify: `api/_internal/wiki/__tests__/reconcile-transaction-test.php`
- Test: `api/_internal/wiki/__tests__/sync-plan-purity-test.php`

**Interfaces:**
- Consumes: `avesmapsCitymapReconcileEntity` (unverändert!), `avesmapsCitymapDeleteWikiRow`,
  `avesmapsCitymapPlanItem`, `avesmapsSyncPlanIsStale`, `avesmapsSyncPlanRecordSkip/Decline/ClearSkip`.
- Produces:
  - `avesmapsCitymapApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array`
    → `{done, applied, deleted, stale, remaining, processed}`
  - `avesmapsLogSyncPlanApply(PDO $pdo, string $kind, array $planned, array $result, ?array $user): void`

- [ ] **Step 1: Die Reinheits-Zusicherung schreiben (§8, das Herzstück)**

`api/_internal/wiki/__tests__/sync-plan-purity-test.php` — baut auf dem Funktions-Index von
`reconcile-transaction-test.php` auf (Tokenizer + Erreichbarkeits-Lauf, dort erprobt):

```php
// 💣 DIE EIGENSCHAFT, DIE DAS GANZE VORHABEN AUSMACHT: die Rechen-Hälfte schreibt in KEINE Nutztabelle.
// Am Quelltext geprüft, über alles, was der Plan-Schritt erreicht -- nicht nur über seinen eigenen
// Rumpf. Genau so ist die erste Fassung der Transaktions-Zusicherung leer gelaufen (A21).
$forbidden = ['citymap', 'citymap_place', 'citymap_type', 'citymap_link', 'citymap_related',
    'feature_sources', 'sources', 'map_features', 'wiki_citymap_catalog'];
$spanned = $reachFrom($bodies, ['avesmapsCitymapPlanStep']);
assert(count($spanned) >= 10, 'der Lauf erreicht die aufgerufenen Funktionen (sonst beweist er nichts)');

foreach ($spanned as $name => $body) {
    foreach ($forbidden as $table) {
        foreach (["INSERT INTO {$table} ", "INSERT IGNORE INTO {$table} ",
                  "UPDATE {$table} ", "DELETE FROM {$table} "] as $statement) {
            assert(!str_contains($body, $statement),
                "{$name} steht in der Rechen-Hälfte und schreibt: {$statement}");
        }
    }
}

// 💣 UND DER LAUF MUSS BEISSEN. Dieselbe Prüfung von der AUSFÜHR-Hälfte aus MUSS die Schreiber finden --
// sonst ist das Grün oben ein kaputter Tokenizer und kein Beweis.
$applySpan = $reachFrom($bodies, ['avesmapsCitymapApplyStep']);
$writers = array_filter($applySpan, static fn(string $b): bool => str_contains($b, 'INSERT INTO citymap ')
    || str_contains($b, 'DELETE FROM citymap '));
assert($writers !== [], 'die Ausführ-Hälfte enthält die Schreiber -- sonst prüft der Lauf oben nichts');

// ⚠️ ALTER TABLE citymap (avesmapsEnsureCitymapStagingTables) ist erlaubt und bleibt erlaubt: das ist
// selbstheilendes Schema, kein Datenschreiben. Die Liste oben nennt deshalb Statements, keine Namen.
```

- [ ] **Step 2: Rot sehen** — `avesmapsCitymapApplyStep` gibt es noch nicht ⇒ der Beiß-Test schlägt fehl.

- [ ] **Step 3: `avesmapsCitymapApplyStep` schreiben**

```php
function avesmapsCitymapApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
```

Ablauf je Schritt (höchstens `AVESMAPS_SYNC_PLAN_APPLY_BUDGET` Zeilen, zusätzlich dieselbe
Zeitschranke wie der Reconcile):

1. `SELECT * FROM sync_plan_item WHERE run_id = :r AND selected = 1 AND apply_state IS NULL ORDER BY id LIMIT :n`
2. je Zeile:
   - `change_type IN ('new','changed')`: Katalogzeile per `entity_key` neu lesen; ist sie weg ⇒
     `apply_state='stale'`, `apply_note='Im Dump nicht mehr enthalten'`. Sonst die Planzeile mit
     genau denselben Sonden **neu rechnen** und gegen `after_json` halten
     (`avesmapsSyncPlanIsStale`) — abweichend ⇒ `stale`. Sonst
     **`avesmapsCitymapReconcileEntity($pdo, $catalog, $userId)`** (unverändert, eigene Transaktion,
     override-sicher) und `apply_state='applied'`.
   - `change_type='deleted'`: prüfen, dass der `wiki_key` weiterhin **nicht** im Katalog steht und die
     Karte weiterhin `origin='wiki' AND status='approved'` ist — sonst `stale`. Dann
     `avesmapsCitymapDeleteWikiRow`.
3. Sind keine offenen Zeilen mehr da (`done`), die **Abschlussarbeit**, genau einmal:
   - abgehäkelte `changed`-Zeilen → `avesmapsSyncPlanRecordSkip` (Zähler +1, Datum, Wer)
   - abgehäkelte `deleted`-Zeilen → `avesmapsSyncPlanRecordDecline` (dauerhaft)
   - **übernommene** `changed`-Zeilen → `avesmapsSyncPlanClearSkip` (⚠️ sonst lügt der Zähler „3×
     übersprungen" für etwas, das inzwischen übernommen wurde)
   - `sync_plan_run.state='applied'`, `applied_at/by`
   - `avesmapsAppSettingSet(citymaps_last_synced)`, `avesmapsResolvePlacesInTable($pdo,'citymap_place')`,
     `avesmapsWikiSyncNextMapRevision($pdo)` — die drei Abschlussarbeiten des alten Reconcile-Schritts,
     hierher gezogen, weil sie erst nach echten Schreibvorgängen etwas bedeuten
   - `avesmapsLogSyncPlanApply(...)` — **eine** Zeile

💣 **Warum kein `try/catch` in der Ausführschleife.** Ein „diese Zeile ist kaputt, weiter" ist genau
die Bauart, gegen die A21 die Zusicherung in `reconcile-transaction-test.php` geschrieben hat: der
Cursor läuft an einer zurückgerollten Zeile vorbei. Hier hört der Lauf stattdessen auf, der Client
meldet den Fehlschlag, und weil jede erledigte Zeile `apply_state='applied'` trägt, nimmt ein zweiter
Klick genau dort wieder auf. `apply_state='failed'` bleibt deshalb in Sitzung 1 ungeschrieben.

- [ ] **Step 4: Die Protokollzeile (§4e)**

In `api/_internal/map/collection-audit.php`:
- `'apply_sync_plan'` in `AVESMAPS_COLLECTION_AUDIT_ACTIONS`
- neuer Schreiber:

```php
/**
 * ONE row per Übernahme -- not one per entry (design §4e).
 *
 * 💣 map_audit_log keeps 200 entries. A run with 46 deletions writing 46 rows would flush yesterday's
 * own edits out of the log the moment the sync is confirmed. The detail lives in sync_plan_item,
 * which stays put; the log gets the numbers and a capped list of names.
 *
 * ⚠️ Uses the same writer as the deletions next door despite its name: it drops the keys that would
 * turn the row into a focusable button for an object that has no map position (see the reserved-key
 * comment above), and it is non-fatal. Both are exactly what is wanted here.
 */
function avesmapsLogSyncPlanApply(PDO $pdo, string $kind, array $planned, array $result, ?array $user): void
```
`before` = die geplanten Zahlen (`new/changed/deleted/total`), `after` = das Ergebnis
(`applied`, `deleted`, `stale`, `skipped`, `declined`, `kind`, `run_id`) plus `titles` — die ersten
**20** Titel gelöschter Karten als eine Zeichenkette, danach „… und N weitere".
⚠️ Alles skalar: `avesmapsCollectionAuditSnapshot` wirft Nicht-Skalare weg.

`collection-audit-test.php`: `$expectedActions` um `apply_sync_plan` erweitern und
`assert(avesmapsCanUndoAuditAction('apply_sync_plan') === false)` — eine Übernahme ist kein
Rückgängig-Kandidat (§9).

- [ ] **Step 5: `reconcile-transaction-test.php` nachziehen**

`$callerFiles` um `'api/_internal/wiki/citymap-plan-apply.php'` erweitern: die Schleife dort ruft
`avesmapsCitymapReconcileEntity($pdo, …)`, also gilt für sie dieselbe Regel — keine Transaktion und
kein weiterlaufendes `try {` um die Zeile herum.

- [ ] **Step 6: Alle vier Tests grün**

Run: `sync-plan-purity-test.php`, `reconcile-transaction-test.php`, `collection-audit-test.php`,
`change-log-collection-labels.test.js` (nach Task 7)

- [ ] **Step 7: Mutation** — ein `avesmapsCitymapLinkSource($pdo, …)` versuchsweise als erste Zeile in
`avesmapsCitymapPlanStep` einsetzen (das ist der realistische Rückfall) → `sync-plan-purity-test.php`
MUSS rot werden. Zurücknehmen.

---

## Task 5 — Die Endpunkte

**Files:**
- Create: `api/edit/wiki/sync-plan.php`
- Modify: `api/edit/wiki/dump.php` (`sync_citymaps`)

- [ ] **Step 1: `sync_citymaps` umhängen**

`avesmapsCitymapReconcileStep(...)` → `avesmapsCitymapPlanStep(...)`. Die Antwort verliert die
Schreib-Zähler (`created/updated/removed/…`) und trägt stattdessen `run_id`, `planned`, `counts`
(`{new,changed,deleted,total}`), `processed`, `progress`, `cursor`, `done`. Der Kommentarblock darüber
wird umgeschrieben: **dieser Knopf schreibt nicht mehr** (Entwurf §6). Der Pipeline-Riegel
(`avesmapsWikiDumpLockAcquireOrThrow`) und die Fähigkeit `edit` bleiben, wie sie sind.

- [ ] **Step 2: `api/edit/wiki/sync-plan.php` schreiben**

Gebaut wie `api/edit/map/citymaps.php` (dünner Dispatcher). `avesmapsRequireUserWithCapability('edit')`
— die Antwort auf §10.1. Aktionen:

| Aktion | Rumpf | Antwort |
|---|---|---|
| `get` | `{kind}` | `{ok, run:{id,state,created_at,source_stamp,age_hours,counts}, items:{new,changed,deleted}, truncated:{…}, declined_count}` — je Kategorie höchstens `AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT`, `truncated` nennt die Restzahl. Fehlt die Tabelle (`42S02`) oder gibt es keinen offenen Lauf ⇒ `{ok:true, run:null}` — **kein** DDL im Lesepfad. |
| `select` | `{run_id, ids?, change_type?, selected}` | setzt Häkchen (einzeln oder je Gruppe), nur solange `state='open'` |
| `apply` | `{run_id, confirm_delete}` | **ein** gebündelter Schritt; der Client ruft bis `done` |
| `declined` | `{kind}` | die abgelehnten Löschungen (§5: „kein schwarzes Loch") |
| `undecline` | `{kind, entity_keys}` | `declined_at = NULL` — beim nächsten Lauf wird wieder gefragt |

💣 **Der Löschriegel gehört an den Server, nicht nur an den Knopf.** Enthält der Lauf mindestens eine
angehäkelte `deleted`-Zeile und ist `confirm_delete !== true`, antwortet `apply` mit **400**
`delete_not_confirmed` — auch für den ersten Teilschritt. Ein ausgegrauter Knopf ist keine
Verteidigung (Merksatz „Riegel gehört an jede Geste"); die Vorschau ist genau der Ort, an dem eine
zweite Bestätigung sonst zur Empfehlung verkommt.

`apply` nimmt zusätzlich den Pipeline-Riegel (`avesmapsWikiDumpLockAcquireOrThrow`, Grund
`'apply_sync_plan'`) — es ist ein echter Produktionsschreiber, genau wie der alte Sync — und gibt ihn
bei `done` zurück.

- [ ] **Step 3: Die Endpunkte ohne DB beweisen (die Sonden-Technik)**

Mit der in `php-js-test-commands` beschriebenen Sonde (Umgebungsvariablen + toter Port `:1`):
- anonym ⇒ **401**, nicht 500 (Entwurf §8)
- als Editor mit leerem Rumpf ⇒ **400** (Gate passiert, Rumpf fehlt)
- GET ⇒ **405**

⚠️ Spaltenweise lesen: erst wenn anonym 401 UND Editor 400 herauskommt, liegt das Gate vor dem Rumpf.
Prüfen: `avesmapsRequireUserWithCapability` steht **vor** `avesmapsReadJsonRequest`.

---

## Task 6 — Das Bauteil (CSS + JS)

**Files:**
- Create: `css/components/sync-plan-sheet.css`, `js/review/sync-plan-sheet.js`
- Test: `js/review/__tests__/sync-plan-sheet.test.js`

- [ ] **Step 1: Den JS-Test schreiben** (vm-Sandbox, wie `change-log-collection-labels.test.js`)

```js
const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "review", "sync-plan-sheet.js"), "utf8"), sandbox);
// 🔴 Die ECHTE Datei, nicht eine abgeschriebene Kopie -- und sie muss OHNE DOM ladbar sein.

const footer = sandbox.syncPlanFooterState;
// Die Löschbestätigung ist die eine Stelle, an der aus einem Häkchen ein Riegel wird.
assert.strictEqual(footer({ selected: 42, deletions: 0, confirmed: false }).applyDisabled, false);
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: false }).applyDisabled, true,
  "eine angehäkelte Löschung sperrt ALLES, auch die harmlosen Übernahmen");
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: true }).applyDisabled, false);
assert.strictEqual(footer({ selected: 43, deletions: 2, confirmed: true }).applyLabel,
  "Übernehmen und 2 löschen");
// Die ausgeblendeten Zeilen zählen mit (§10.2) -- sonst behauptet die Fußzeile 200 von 5.012.
assert.strictEqual(footer({ selected: 200, hidden: 4812, deletions: 0 }).selectedTotal, 5012);

// Escaping: ein Kartentitel ist Wiki-Text, kein Vertrauensbeweis.
assert.ok(!sandbox.syncPlanSheetMarkup(planMit('<img src=x onerror=1>')).includes("<img src=x"));

// Feldnamen sind deutsch und vollständig -- ein roher Spaltenname in der Vorschau ist keine Antwort.
["title","map_url","art","is_color","is_labeled","format","has_scale","author","publisher","note",
 "place","source","links"].forEach((f) => {
  assert.notStrictEqual(sandbox.syncPlanFieldLabel(f), f, `${f} hat eine deutsche Beschriftung`);
});
```

- [ ] **Step 2: Rot sehen** (Datei fehlt)

- [ ] **Step 3: `js/review/sync-plan-sheet.js` schreiben**

Aufbau — **erst die reinen Bauer, dann der DOM-Aufsatz**, kein Top-Level-DOM (sonst ist die
vm-Sandbox tot):
- `syncPlanFieldLabel(field)` — die Tabelle deutscher Feldnamen
- `syncPlanFooterState({selected, hidden, deletions, confirmed})` → `{selectedTotal, applyLabel, applyDisabled}`
- `syncPlanRowMarkup(item)` / `syncPlanGroupMarkup(kind, items, meta)` / `syncPlanSheetMarkup(plan)`
- `syncPlanEscape(s)` (eigener Escaper — die Editorseite hat `ceEscape` im Modul-Verschluss, und das
  Bauteil muss auch in `index.html` und in der Sandbox laufen)
- `openSyncPlanSheet({ kind, mount, onApplied })` — Abruf, Zeichnen, Häkchen, „alle/keine",
  „Später" (schließt, schreibt nichts), „Übernehmen" (treibt `apply` bis `done`), die
  abgelehnten Löschungen aufklappen

Markup wörtlich nach dem Mockup: `.sheet`, `.sheet__head/__meta/__body`, `details.grp` (+ `.grp--del`),
`.grp__name/__count/__hint/__bulk`, `.rows`, `.row`, `.row__name/__sub/__why`, `dl.diff` mit
`.old/.arrow/.new/.kept`, `.tag` (+ `--own/--gone/--skip`), `.gate`, `.stale`, `.foot`.

💣 **`<details>/<summary>`, nichts Selbstgebautes** — dieselbe Begründung wie beim Inhaltsverzeichnis
der Hinweise (AGENTS.md §11): Strg+F findet Text in einem zugeklappten Abschnitt und klappt ihn selbst
auf, Fokus/Enter/`aria-expanded` kommen vom Element.

💣 **`overflow-anchor: none` am Scroll-Kasten** der Zeilenliste — ohne es springt die Vorschau beim
Nachladen an den Anfang (die Lehre aus dem Änderungsverlauf).

- [ ] **Step 4: `css/components/sync-plan-sheet.css` schreiben**

Das Mockup-CSS, aber **jede** Farbe/Radius als `var(--…)` aus `css/base/tokens.css`. Vor dem Schreiben
gegen die Token-Datei prüfen, welche der Mockup-Variablen es wirklich gibt
(`--color-panel-soft`, `--color-danger-soft*`, `--color-warning-soft*`, `--color-pill*`, `--radius-*`).
Fehlt eine, **erst das Token anlegen** (AGENTS.md §12) — nie einen Hex-Wert.
⚠️ Kein `@media (prefers-color-scheme)`-Block: die Tokens tragen das Thema schon (der Mockup-Block ist
nur da, weil das Mockup keine Tokens hat).

- [ ] **Step 5: Grün sehen** — `node js/review/__tests__/sync-plan-sheet.test.js`

- [ ] **Step 6: Mutation** — `applyDisabled` auf `false` festnageln → der Test MUSS rot werden.

---

## Task 7 — Verdrahten und sichtbar machen

**Files:**
- Modify: `html/citymap-editor.html`, `js/review/review-wiki-sync.js`, `js/review/review-panels-change-log.js`
- Modify: `js/review/__tests__/change-log-collection-labels.test.js`

- [ ] **Step 1: Beschriftung der Protokollzeile**

`review-panels-change-log.js`, neben `delete_citymap`:
`apply_sync_plan: "Wiki-Abgleich: Übernahme"` — der Test daneben um die Aktion erweitern.

- [ ] **Step 2: Der Loop meldet Unterschiede statt Übernahmen**

`review-wiki-sync.js`: `runWikiSyncCitymapsSyncLoop` summiert `planned` statt `created/updated/removed`;
`startWikiSyncCitymapsSync` schließt mit
`` setWikiSyncStatus(`${total} Unterschiede — Vorschau offen`, "success") `` und gibt
`{run_id, counts}` an den Aufrufer zurück. Der Kommentarblock darüber wird auf den neuen Zustand
umgeschrieben (er behauptet heute, der Loop schreibe).

- [ ] **Step 3: Die Editorseite**

`html/citymap-editor.html`:
- `<link rel="stylesheet" href="/css/components/sync-plan-sheet.css">` neben `editor-page.css`
- `<script src="/js/review/sync-plan-sheet.js"></script>` vor dem Seiten-Skript
- `<div id="ceSyncPlanHost"></div>` als Wirt
- `handleCeSyncClick`: nach dem Rechnen `openSyncPlanSheet({ kind: "citymap", mount: …, onApplied })`;
  `onApplied` lädt die Kartenliste neu und schreibt die Statuszeile.
- Der `title=` des Knopfes sagt jetzt die Wahrheit: **„zeigt erst, was übernommen würde"**.
- Beschriftung `🚨 Karten syncen` → **`🚨 Karten abgleichen`**? — **nein**, bleibt. Der Knopf tut
  weiterhin dasselbe (den Abgleich anstoßen), nur endet er jetzt in einer Vorschau; eine Umbenennung
  wäre eine zweite Änderung an derselben Stelle. Der `title` trägt die Neuigkeit.

⚠️ `ASSET_VERSION` wird **nicht** angefasst (die Seite lädt mit `?v=Date.now()`); die zwei neuen
Dateien hängen an `html/citymap-editor.html` und werden vom Deploy gestempelt.

- [ ] **Step 4: Ohne Anmeldung im Browser prüfen**

`?edit=1`-Trick bzw. eine kleine `verify-…html`, die `syncPlanSheetMarkup` mit einem festen Plan
zeichnet — hell **und** dunkel, damit die Tokens beweisbar tragen. (Die Datei wird **nicht**
committet; sie ist eine Sonde, wie die anderen `verify-*.html` im Arbeitsbaum.)

---

## Task 8 — Volle Suite, ein Commit, live gegenprüfen

- [ ] **Step 1: Die volle Suite, wie die CI sie fährt**

```bash
for t in $(find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) | sort); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll "$t" >/dev/null || echo "RED $t"; done
```
```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js' | sort); do node "$t" >/dev/null || echo "RED $t"; done
```
⚠️ Bei Rot **zuerst einen** roten Test einzeln laufen lassen und die Fehlerzeile lesen — fehlende
Extensions melden falsch rot.

- [ ] **Step 2: Nur eigene Pfade stagen**

`git status` lesen, die fremden geänderten/unverfolgten Dateien (u. a. `js/map-features/…-path-label-canvas-overlay.js`,
`tools/paths/test-path-label-dodge.mjs`, die `verify-*`-Sonden) **stehen lassen** und ausschließlich
die in „File Structure" genannten Pfade + diesen Bauplan einzeln mit `git add <pfad>` stagen.

- [ ] **Step 3: Commit**

Betreff nennt die für Editoren sichtbare Wirkung (AGENTS.md §9) — das Handbuch wird **nicht**
angefasst, die Nachtroutine liest den Commit:

```
feat(sync): der Karten-Abgleich zeigt erst, was er tun wuerde -- geschrieben wird nur, was angehaekelt ist
```

- [ ] **Step 4: Push, 2–4 Minuten warten, dann live mit Zahlen gegenprüfen**

- Remote-SHA gegen lokal vergleichen
- 💣 PHP wirkt auf STRATO **2–4 Minuten verzögert** (OPcache) — nicht vorher messen
- `GET https://avesmaps.de/api/edit/wiki/sync-plan.php?action=get&kind=citymap` **anonym** ⇒ 405 (GET)
  bzw. `POST` anonym ⇒ **401**, nie 500
- die öffentlichen Lesewege bleiben 200: `GET /api/app/citymaps.php`, `GET /api/app/map-features.php`
  (ETag unverändert — die Übernahme lief ja nicht)
- die zwei neuen Dateien sind da und tragen einen Hash:
  `GET /css/components/sync-plan-sheet.css` ⇒ 200, `GET /js/review/sync-plan-sheet.js` ⇒ 200
- **Kein** `sync_citymaps`, **kein** „Dump holen", **kein** `apply` wird ausgelöst.

---

## Self-Review gegen den Entwurf

| Entwurf | Task |
|---|---|
| §2 drei Kategorien, Vorhäkeln, zweite Bestätigung | 1 (Regel), 6 (Riegel), 5 (Riegel serverseitig) |
| §2 abgehäkelte Änderung kommt wieder, mit Zähler | 4 (`RecordSkip`), 1 (`DefaultSelected`), 6 (Merkmal) |
| §2 abgehäkelte Löschung = behalten, dauerhaft, **nicht** `manual` | 3 (Test), 4 (`RecordDecline`) |
| §2 „Später" schreibt nichts, Häkchen bleiben | 5 (`select` schreibt sofort), 6 (Knopf schließt nur) |
| §4a Plan veraltet ⇒ Nachprüfung beim Übernehmen | 1 (`IsStale`), 4 (Schritt 2) |
| §4b zwei Arten zu behalten trennen | 3 (Test: `origin` bleibt `wiki`) |
| §4c leerer Katalog ⇒ nichts löschen | 3 (Riegel wandert mit + Test) |
| §4d Wiederaufnahme bleibt | 2, 4 (beide Hälften gebündelt, Cursor) |
| §4e **eine** Protokollzeile je Lauf | 4 |
| §4f STRATO: ein Abruf, serverseitig begrenzt | 5 (`get`, Limit 200) |
| §5 drei Tabellen | 1 |
| §6 zweiter Lauf ersetzt den offenen Plan | 1 (`StartRun` ⇒ `superseded`) |
| §7 „Fertig heißt" | 3+4 zusammen |
| §8 alle fünf Zusicherungen | 1, 2, 3, 4 |
| §9 kein Rückgängig | 4 (`avesmapsCanUndoAuditAction === false`) |
| §10 beide Antworten | Global Constraints |
