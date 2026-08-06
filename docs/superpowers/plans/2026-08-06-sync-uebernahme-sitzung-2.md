# Sync-Übernahme — Sitzung 2: Abenteuer, Publikationen, Vorkommen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Entwurf:** [`docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`](../specs/2026-08-06-sync-uebernahme-design.md) ·
**Vorlage:** [`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-1.md`](2026-08-06-sync-uebernahme-sitzung-1.md)
(live seit 2026-08-06) · **Stand:** 2026-08-06

**Goal:** Auch der Abgleich der **Abenteuer**, der **Publikationsquellen** und der **Vorkommen**
schreibt nichts mehr ohne Häkchen: jeder rechnet erst einen Plan, zeigt ihn in denselben drei
Kategorien im selben Bauteil, und erst „Übernehmen" schreibt — mit genau EINER Protokollzeile je Lauf.

**Architecture:** Dreimal dasselbe Schnittmuster wie bei den Karten. Je Abgleich eine
**Rechen-Hälfte** (`avesmaps{Adventure,Publication,Lore}PlanStep`), die die Cursor-Bauart des heutigen
Reconcile-Schritts behält, dieselben **reinen** Plan-Funktionen ruft und Zeilen nach `sync_plan_item`
schreibt statt in die Nutztabellen; und eine **Ausführ-Hälfte** in eigener Datei
(`*-plan-apply.php`), die die angehäkelten Zeilen abarbeitet und dafür den **unveränderten**
vorhandenen Schreiber ruft. Das Fundament (`api/_internal/wiki/sync-plan.php`, die drei Tabellen, die
Entscheidungen) wird **nur benutzt, nicht geändert**. Am Bauteil und am Endpunkt wachsen die vier
Listen um je drei Einträge.

**Tech Stack:** PHP 8 strict types + PDO/MySQL (self-healing Inline-DDL), vanilla JS ohne Build,
Tokens aus `css/base/tokens.css`. Tests: `assert()`-Skripte unter `__tests__/` (PHP), `node …test.js`
mit `vm`-Sandbox (JS).

---

## Global Constraints

- **Drei Commits, einer je Abgleich**, in dieser Reihenfolge (die Reihenfolge ist eine
  Abhängigkeit, keine Vorliebe — siehe „Warum diese Reihenfolge" unten):
  **A Abenteuer → B Publikationen → C Vorkommen.**
- **Vor jedem Commit die volle Suite grün** (139 PHP + 90 JS heute). Kein einziger darf rot werden.
- **Geteilter Arbeitsbaum:** unmittelbar vor jedem Commit `git status` lesen und **nur selbst
  berührte Pfade** einzeln mit `git add <pfad>` stagen. Niemals `git add -A`/`.`/`commit -a`
  (AGENTS.md §9) — andere Sitzungen legen Dateien im Index ab.
- **Commit-Nachricht per `-F <datei>`**, nie `-m` mit mehrzeiligem Text. Betreff nennt die für
  Editoren sichtbare Wirkung (AGENTS.md §9); das Handbuch wird **nicht** angefasst (die Nachtroutine
  liest den Commit).
- **Nach jedem Push 2–4 Minuten warten** (STRATO-OPcache), dann live mit Zahlen gegenprüfen.
- **KEIN Dump, KEIN Sync, KEIN Massenlauf.** Live geprüft wird ausschließlich read-only +
  Statuscodes.
- **Fundament unverändert:** `api/_internal/wiki/sync-plan.php` bekommt in dieser Sitzung **keine**
  Änderung — kein neues Feld, keine neue Spalte, keine neue Regel. Fällt etwas auf, was dort fehlt:
  erst hier notieren, nicht einbauen.
- **DDL nur im Schreibpfad.** Die Rechen- und die Ausführ-Hälfte rufen ihre `*EnsureTables` **einmal,
  ganz oben, vor jeder Transaktion**; der `get` des Endpunkts fängt `42S02` ab und antwortet „kein
  Plan". (MySQL committet eine offene Transaktion beim Anblick von DDL.)
- **KEIN try/catch in der Ausführschleife** (A21). Bricht eine Zeile ab, hört der Lauf auf; der Client
  meldet den Fehlschlag, und jede erledigte Zeile trägt `apply_state='applied'`, also nimmt ein
  zweiter Klick genau dort wieder auf.
- **EINE Protokollzeile je Lauf**, nie eine je Eintrag (`map_audit_log` behält 200 Zeilen).
- **Der Löschriegel steht serverseitig** in `apply` (`delete_not_confirmed`), nicht nur am Knopf.
- **Neue Libs in die require-Ketten** der Endpunkte eintragen, sonst fällt der Abhängigkeits-Assert
  (`citymap-sync-test.php` „Not in the dump endpoint require chain") bzw. der neue
  `sync-plan-endpoint-chain-test.php`.
- **Sprache:** neue Oberflächentexte deutsch, Kommentare/Doku englisch (AGENTS.md §8) — **außer** wo
  die Nachbarschaft schon deutsch kommentiert (`lore-sync.php` ist durchgehend deutsch); dann in der
  Nachbarsprache bleiben.
- **Kein hartkodierter Farbwert / Radius / Trenner** — alles aus `css/base/tokens.css` (AGENTS.md §12).
- **`?v=` nie von Hand.** Neue CSS/JS-Verweise in `index.html` und `html/adventure-editor.html`
  stempelt der Deploy. `ASSET_VERSION` wird **nicht** angefasst: beide Editorseiten werden mit
  `?v=Date.now()` geladen (`js/review/review-settlement-list.js:837` und `:907`).
- **STRATO:** nichts in einer Schleife abfragen; die Entscheidungstabelle einmal je Schritt lesen.
- **Testbefehl PHP** (Extensions sind Pflicht, sonst falsche Rot-Meldungen):
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll <test>`
- **Testbefehl JS:** `node <pfad>.test.js`
- **Jede neue Zusicherung wird durch Mutation belegt** (Entwurf §8): den Fehler in einer Sandkopie
  wiederherstellen, Rot verlangen, zurücknehmen.

### Warum diese Reihenfolge

Der Vorkommen-Abgleich ruft je Eintrag `avesmapsPublicationReconcileEntity` (die Quellen der Lore
liegen seit 2026-07-22 im geteilten System, AGENTS.md §5). Seine Vorschau muss also sagen können, was
mit den Quellenverweisen passiert — und dafür braucht sie die **read-only-Sonde** aus Commit B
(`avesmapsPublicationLinkDiffForPlan`). Publikationen vor Vorkommen zu bauen erspart eine
Wegwerf-Fassung.

---

## 🔧 DU: die drei Entscheidungen dieses Bauplans

Alles andere folgt Sitzung 1. Diese drei sind Auslegungen, die ich nicht aus dem Entwurf ablesen
konnte — sie stehen hier, damit du sie vor dem ersten Code umwerfen kannst.

### 1. Was „Gelöscht" bei diesen drei Abgleichen heißt

**Vorschlag: die dritte Kategorie gehört dem Verschwinden einer ganzen Einheit. Kindzeilen, die das
Wiki nur nicht mehr auflistet, stehen als benannter Verlust in der `Geändert`-Zeile ihrer Einheit.**

| Abgleich | Gelöscht (Riegel + zweite Bestätigung) | in der Zeile benannt, unter Geändert |
|---|---|---|
| Karten (Sitzung 1, live) | die ganze Karte samt Kindern | „Fundstellen: 1 entfällt" (`citymap_link`) |
| **Abenteuer** | **nichts** — ein Abenteuer wird nie gelöscht, auch wenn sein Artikel verschwindet | „Orte entfallen: 3" |
| **Publikationen** | **nichts** — die Einheit ist ein Ort/eine Region/ein Weg und bleibt | „Quellenverweise entfallen: 2" |
| **Vorkommen** | der **Eintrag** wird stillgelegt (`status='retired'`) — ein **Grabstein** | „Vorkommen entfallen: 4" |

Zwei Gründe:

1. **Der Zwang.** Die Ausführ-Hälfte ruft den *unveränderten* Schreiber, und der schreibt eine Einheit
   **ganz**: Felder *und* Kinder. Zwei Zeilen je Einheit — eine „geändert", eine „gelöscht" — wären
   also eine Lüge: wer die eine anhäkelt und die andere abhäkelt, bekommt trotzdem beides. Genau die
   nicht angehäkelte Löschung, gegen die dieses Vorhaben gebaut wird. Also: **eine Zeile je Einheit.**
2. **Die Vorlage sagt es schon.** Sitzung 1 löscht `citymap_link`-Zeilen in einer `Geändert`-Zeile
   (`after['links'] = "1 entfällt"`) und riegelt nur die ganze Karte. Das ist kein Versehen, sondern
   der Unterschied: eine Kindzeile, die das Wiki nicht mehr nennt, **ist** der aktuelle Wiki-Stand;
   eine verschwundene Einheit nimmt Handarbeit mit (zugeordnete Fundorte, Quellenverweise, Verweise).

Damit der Verlust in einer vorangehäkelten Zeile nicht untergeht, bekommt er ein **eigenes Feld mit
eigener Beschriftung und Warnfarbe** (`places_removed` → „Orte entfallen", `occurrences_removed`,
`sources_removed`) statt einer Schrägstrich-Notation. Und die `Gelöscht`-Gruppe sagt bei Abenteuer und
Publikationen ausdrücklich **„Dieser Abgleich löscht nichts"** statt einer leeren Warnung.

Bei den Vorkommen sagt die Löschzeile, was sie ist (Entwurf §7): *„Wird stillgelegt, nicht gelöscht.
Der Eintrag bleibt samt seiner N Vorkommen erhalten; nennt das Wiki ihn wieder, wird er ohne Zutun
wieder aktiv."* Das ist keine Beschönigung — der Reconcile hebt `status='retired'` beim nächsten Lauf
selbst wieder auf (`lore-sync.php`: `status = CASE WHEN status='retired' THEN 'active' …`).

*Verworfene Alternative:* alle Kindzeilen-Verluste in `Gelöscht`. Dann müsste eine abgehäkelte
Löschung **dauerhaft** sein (§2), und weil sie an der Einheit klebt, hieße „diese 3 Orte nicht
löschen" zwangsläufig „dieses Abenteuer nie wieder aktualisieren" — die `origin='manual'`-Verwechslung,
die §2 ausdrücklich verbietet, nur mit anderem Namen.

### 2. Wo die Publikations-Vorschau auftaucht

`sync_publications` ist **Schritt 4/4 von „Dump holen"** (`review-wiki-sync.js:998`), kein eigener
Knopf. Nach dem Umbau endet „Dump holen" also nicht mehr mit „Publikationsquellen übernommen
(+12/~3/−1)", sondern mit **„Dump geholt · 137 Quellen-Unterschiede — Vorschau offen"**, und die
Vorschau öffnet sich direkt danach (vor dem Dump-Report-Fenster, damit sie nicht dahinter liegt).
Der Dump-Report bekommt in derselben Zeile die Planzahlen statt der Schreibzahlen.

⚠️ Die **zweite** Tür zum Publikations-Reconcile bleibt, wie sie ist: die `reconcile`-Unterstufe von
`avesmapsPublicationSyncPhaseStep` (`dump-hybrid-driver.php`, nur auf dem scharfen Apply-Pfad, nicht
bei „Dump holen"). Die gehört zur Apply-Pipeline der Orte/Wege/Regionen und damit zu **Sitzung 3** —
sie hier mitzunehmen hieße, zwei Sitzungen in einem Commit anzufangen.

### 3. Der Wirt für das Blatt

`index.html` bekommt **einen** Wirt `#wikiSyncPlanHost` (für Vorkommen und Publikationen, deren
Auslöser im Panel bzw. im Vorkommen-Fenster sitzen); `html/adventure-editor.html` bekommt seinen
eigenen `#aeSyncPlanHost` (wie der Karteneditor), weil die Editor-Überlagerung das Panel verdeckt.
Dabei wird `z-index: 40` in `css/components/sync-plan-sheet.css` durch
`z-index: var(--z-modal)` ersetzt — in `index.html` liegt das Blatt sonst unter dem
Vorkommen-Fenster (`--z-editor-overlay: 1500`), und ein hartkodierter Zahlenwert ist ohnehin ein
Verstoß gegen AGENTS.md §12.

---

## File Structure

| Datei | Verantwortung | Commit |
|---|---|---|
| **ändern** `api/_internal/wiki/adventure-sync.php` | + Rechen-Hälfte (`avesmapsAdventurePlanStep`, `…PlanForCatalogRow`, `…PlanItem`, `…PlanFindRow`, `…LastStaged`). `avesmapsAdventureReconcileStep` entfällt. `…FieldPlan`, `…PlacePlan`, `…ReconcileEntity`, `…FindOrAdoptRow`, `…SaveCoverLocal` bleiben **unverändert**. | A |
| **neu** `api/_internal/wiki/adventure-plan-apply.php` | Ausführ-Hälfte Abenteuer: `avesmapsAdventureApplyStep`, `…ApplyFinish`. Eigene Datei, damit die Rechen-Hälfte nachweisbar keinen Schreiber und keinen Bild-Download sieht. | A |
| **ändern** `api/_internal/wiki/publication-sync.php` | + Rechen-Hälfte (`avesmapsPublicationPlanStep`, `…PlanForEntity`, `…PlanItem`, `…LinkDiffForPlan`, `…SourceIdForPlan`, `…LastStaged`). `avesmapsPublicationReconcileStep` **bleibt** (Sitzung 3 fährt sie noch über die Phase). | B |
| **neu** `api/_internal/wiki/publication-plan-apply.php` | Ausführ-Hälfte Publikationen: `avesmapsPublicationApplyStep`, `…ApplyFinish`. | B |
| **ändern** `api/_internal/wiki/lore-sync.php` | + Rechen-Hälfte (`avesmapsLorePlanStep`, `…PlanForCatalogRow`, `…PlanItem`, `…RetirableRows`, `…LastStaged`); der Schreibrumpf der alten Schleife wandert **wörtlich** nach `lore-plan-apply.php`. `avesmapsLoreReconcileStep` entfällt (samt totem `$dryRun`). `…FieldPlan`, `…ChildPlan`, `…PlaceKey` bleiben unverändert. | C |
| **neu** `api/_internal/wiki/lore-plan-apply.php` | Ausführ-Hälfte Vorkommen: `avesmapsLoreApplyStep`, `…ApplyEntity` (der verschobene Rumpf), `…ApplyStatements`, `…RetireWikiEntry`, `…ApplyFinish`. | C |
| **ändern** `api/edit/wiki/sync-plan.php` | `AVESMAPS_SYNC_PLAN_KINDS` + je ein `match`-Arm + die require-Kette je Commit. | A·B·C |
| **ändern** `api/edit/wiki/dump.php` | `sync_adventures` / `sync_publications` / `sync_lore` treiben die **Rechen**-Hälfte und antworten mit `run_id` + `counts`. | A·B·C |
| **ändern** `api/_internal/map/collection-audit.php` | `AVESMAPS_COLLECTION_AUDIT_KIND_LABELS` += 3; neu `AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB` (Vorkommen werden „stillgelegt", nicht „gelöscht"). | A·C |
| **ändern** `js/review/sync-plan-sheet.js` | `SYNC_PLAN_KIND_NOUNS` / `…TITLES` += 3, neu `SYNC_PLAN_KIND_DELETION` (was die Löschgruppe je Art sagt) und `SYNC_PLAN_LOSS_FIELDS` (Verlustfelder in Warnfarbe), Feldbeschriftungen der drei Arten. | A·B·C |
| **ändern** `css/components/sync-plan-sheet.css` | `z-index: var(--z-modal)`; ein Wähler für das Verlustfeld. | A |
| **ändern** `js/review/review-wiki-sync.js` | Die drei Schleifen summieren `planned`, die Statuszeilen sagen „N Unterschiede — Vorschau offen", `startWikiSync*` gibt `{run_id, counts}` zurück und öffnet das Blatt im Wirt von `index.html`. | A·B·C |
| **ändern** `index.html` | Verlinkt CSS+JS, Wirt `#wikiSyncPlanHost`. | A |
| **ändern** `html/adventure-editor.html` | Verlinkt CSS+JS, Wirt `#aeSyncPlanHost`, öffnet die Vorschau nach dem Rechnen. | A |
| **ändern** `js/review/review-panels-change-log.js` | nichts Neues (`apply_sync_plan` ist schon beschriftet) — nur prüfen. | — |
| **neu** `api/_internal/wiki/__tests__/adventure-plan-test.php` | Zeilenbildung, Übernahme-Erkennung ohne Schreiben, Cover-Sonde, Feld-Override. | A |
| **neu** `api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php` | 💣 Jede fremde Funktion der vier `*-plan-apply.php` ist in der require-Kette von `api/edit/wiki/sync-plan.php`. | A |
| **neu** `api/_internal/wiki/__tests__/publication-plan-test.php` | Read-only-Sonde legt keine Quelle an, Diff-Zahlen, Staging-Riegel je Typ. | B |
| **neu** `api/_internal/wiki/__tests__/lore-plan-test.php` | Zeilenbildung, Leerkatalog-Riegel (kein Lauf wird geöffnet!), Behalten-Riegel, Grabstein-Text. | C |
| **neu** `api/_internal/wiki/__tests__/lore-retire-parity-test.php` | Der Einzel-Stilleger trägt dieselben Riegel wie der alte Sammel-Sweep. | C |
| **ändern** `api/_internal/wiki/__tests__/sync-plan-purity-test.php` | Drei neue Wurzeln + drei Gegenproben. | A·B·C |
| **ändern** `api/_internal/wiki/__tests__/reconcile-transaction-test.php` | Die drei neuen `*-plan-apply.php` in `$callerFiles`. | A·B·C |
| **ändern** `api/_internal/map/__tests__/collection-audit-test.php` | Die drei Arten + der Löschverb-Satz. | A·C |
| **ändern** `js/review/__tests__/sync-plan-sheet.test.js` | Feldbeschriftungen, Löschgruppe ohne Löschungen, Verlustfeld. | A·B·C |

---

# COMMIT A — Abenteuer

## Task 1 — Die Rechen-Hälfte für Abenteuer

**Files:**
- Modify: `api/_internal/wiki/adventure-sync.php`
- Test: `api/_internal/wiki/__tests__/adventure-plan-test.php`

**Interfaces:**
- Consumes (Fundament, unverändert): `avesmapsEnsureSyncPlanTables`, `avesmapsSyncPlanStartRun`,
  `avesmapsSyncPlanBuildingRun`, `avesmapsSyncPlanAddItem`, `avesmapsSyncPlanFinishBuild`,
  `avesmapsSyncPlanDecisions`, `avesmapsSyncPlanDecisionKey`, `avesmapsSyncPlanDefaultSelected`.
- Consumes (unverändert aus dieser Datei): `avesmapsAdventureFieldPlan`, `avesmapsAdventurePlacePlan`,
  `avesmapsAdventureDesiredFromStaging`, `avesmapsAdventureDecodeOrigins`,
  `avesmapsAdventureLoadPlacesForReconcile`, `avesmapsAdventureDesiredPlaces`.
- Produces:
  - `avesmapsAdventurePlanItem(?array $current, array $desired, array $fieldOrigins, array $placePlan, bool $coverPending, bool $adopting): ?array` *(PURE)*
    → `null | ['change_type'=>'new'|'changed', 'after'=>[], 'before'=>[], 'override'=>[]]`
  - `avesmapsAdventurePlanFindRow(PDO $pdo, array $catalog): array` *(READ-ONLY)*
    → `['current'=>?array, 'field_origins'=>array, 'adopting'=>bool, 'clears_places'=>bool]`
  - `avesmapsAdventurePlanForCatalogRow(PDO $pdo, array $catalog): array`
    → `['item'=>?array, 'current'=>?array, 'desired'=>array]`
  - `avesmapsAdventureLastStaged(PDO $pdo): ?string`
  - `avesmapsAdventurePlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array`
    → `{done, nextCursor, run_id, planned, processed, counts}`

- [ ] **Step 1: Den Test für die reine Zeilenbildung schreiben**

`api/_internal/wiki/__tests__/adventure-plan-test.php`, Teil 1 (rein, ohne DB):

```php
<?php
declare(strict_types=1);
/**
 * Die Zeilenbildung der Abenteuer-Vorschau (Entwurf §2/§7, Bauplan Sitzung 2 Task 1).
 * Run: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *      -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/adventure-plan-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../adventure-sync.php';

$desired = [
    'title' => 'Die Sieben Gezeichneten', 'product_type' => 'gruppenabenteuer', 'edition' => 'DSA5',
    'genre' => 'Intrige', 'complexity_gm' => 'hoch', 'complexity_pl' => 'mittel',
    'authors' => 'Ina Kramer', 'series' => 'Sieben Gezeichnete', 'fshop_code' => 'US25001',
    'wiki_url' => 'https://wiki/DSG',
];
$noPlaces = ['add' => [], 'update' => [], 'remove' => []];

// --- Neu ---------------------------------------------------------------------------------------
$item = avesmapsAdventurePlanItem(null, $desired, [], ['add' => [
    ['sort_order' => 0, 'raw_name' => 'Havena', 'role' => 'start'],
], 'update' => [], 'remove' => []], false, false);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['title'] === 'Die Sieben Gezeichneten');
assert($item['before'] === [], 'ein neues Abenteuer hat kein Vorher');
assert($item['after']['places'] === '1 neu', 'die Orte stehen als kurzer Text in der Zeile');

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
$gleich = $desired + ['cover_url' => '', 'cover_source' => ''];
assert(avesmapsAdventurePlanItem($gleich, $desired, [], $noPlaces, false, false) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile');

// --- Geändert: nur die abweichenden Felder ------------------------------------------------------
$alt = $gleich;
$alt['genre'] = 'Reise';
$item = avesmapsAdventurePlanItem($alt, $desired, [], $noPlaces, false, false);
assert($item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['genre'], 'nur das abweichende Feld, keine ganze Zeile');
assert($item['before']['genre'] === 'Reise');

// --- 💣 Ein Feld-Override ist ein „bleibt", keine Änderung ---------------------------------------
// Abenteuer sind die erste Art mit Overrides JE FELD (field_origins_json) -- bei den Karten ist der
// Override die ganze Karte. Genau dafür steht override_json im Entwurf §5.
$item = avesmapsAdventurePlanItem($alt, $desired, ['genre' => 'manual'], $noPlaces, false, false);
assert($item === null, 'ist das einzige abweichende Feld von Hand gesetzt, gibt es nichts zu fragen');
$alt2 = $alt;
$alt2['authors'] = 'Unbekannt';
$item = avesmapsAdventurePlanItem($alt2, $desired, ['genre' => 'manual'], $noPlaces, false, false);
assert(isset($item['override']['genre']) && $item['override']['genre'] === 'Reise');
assert(!isset($item['after']['genre']), 'und wird NICHT als Änderung vorgeschlagen');
assert(isset($item['after']['authors']), 'die andere Änderung steht sehr wohl da');

// --- Das Titelbild: die Zeile sagt es, der Rechenlauf lädt es NICHT ------------------------------
// 💣 avesmapsAdventureSaveCoverLocal holt das Bild über HTTP und schreibt es nach
// /uploads/questcovers. In der Rechen-Hälfte hat es nichts zu suchen -- die Zeile trägt deshalb
// einen Satz statt einer URL, die es noch nicht gibt.
$item = avesmapsAdventurePlanItem($gleich, $desired, [], $noPlaces, true, false);
assert($item !== null && $item['after']['cover'] === 'wird neu geladen');

// --- Die Übernahme eines Platzhalters steht in der Zeile ----------------------------------------
$item = avesmapsAdventurePlanItem($gleich, $desired, [], $noPlaces, false, true);
assert($item !== null && isset($item['after']['adopt']),
    'dass ein von Hand angelegter Platzhalter zum Wiki-Abenteuer wird, ist der Rede wert');

// --- 🔴 Der Verlust hat ein EIGENES Feld --------------------------------------------------------
// Nicht "Orte: 3 entfällt" mitten in einer Aufzählung: das Feld heisst „Orte entfallen" und wird
// vom Bauteil in Warnfarbe gezeichnet (SYNC_PLAN_LOSS_FIELDS). Sonst geht der Verlust in einer
// vorangehäkelten Zeile unter -- die Entscheidung 1 dieses Bauplans.
$item = avesmapsAdventurePlanItem($gleich, $desired, [], [
    'add' => [], 'update' => [], 'remove' => [['id' => 5], ['id' => 6], ['id' => 7]],
], false, false);
assert($item !== null && $item['after']['places_removed'] === 3);
assert(!isset($item['after']['places']), 'kein zweites Feld für dasselbe');
```

- [ ] **Step 2: Rot sehen**

Run: den Testbefehl aus den Global Constraints mit dieser Datei.
Expected: FAIL — `Call to undefined function avesmapsAdventurePlanItem()`.

- [ ] **Step 3: `avesmapsAdventurePlanItem` schreiben (rein)**

Ans Ende von Abschnitt 1 („PURE diff core") in `adventure-sync.php`, mit einem Kopfkommentar, der
sagt, warum die Sonden als Argumente kommen (die reine Funktion darf nichts lesen). Regeln in dieser
Reihenfolge:

1. `$plan = avesmapsAdventureFieldPlan($current ?? [], $desired, $fieldOrigins)`.
2. `after = $plan['set']`; bei `$current === null` (neu) Felder mit leerem Wert **weglassen** (ein
   „Serie: —" auf einem Abenteuer, das noch nie existiert hat, ist keine Nachricht);
   sonst `before[$field] = $current[$field] ?? null`.
3. `override`: je Feld aus `AVESMAPS_ADVENTURE_WIKI_FIELDS`, für das
   `$fieldOrigins[$field] === 'manual'` **und** `avesmapsAdventureNormalizeField($current[$field] ?? null)
   !== avesmapsAdventureNormalizeField($desired[$field] ?? null)` und das im `$desired` überhaupt
   vorkommt → `override[$field] = (string) ($current[$field] ?? '')`.
4. `$coverPending` → `after['cover'] = 'wird neu geladen'`.
5. `$adopting` → `after['adopt'] = 'Platzhalter wird zum Wiki-Abenteuer'`.
6. Orte: `add`/`update` → `after['places']` als kurzer deutscher Text (`'2 neu, 1 geändert'`, gebaut
   wie `avesmapsCitymapPlanItem` es für die Fundstellen tut); `remove` **getrennt** →
   `after['places_removed'] = count($placePlan['remove'])`.
7. `after === [] && override === []` → **`null`**. Ein Override allein ist keine Zeile (dieselbe
   Regel wie bei den Karten: es gibt nichts anzuwenden, also nichts zu fragen).
8. `change_type = $current === null ? 'new' : 'changed'`; bei `new` ist `before` leer.

- [ ] **Step 4: Grün sehen** — der Test aus Step 1 läuft durch.

- [ ] **Step 5: Den Test für die read-only-Suche schreiben (Teil 2, sqlite)**

An dieselbe Datei anhängen:

```php
// ================= Teil 2: die read-only-Suche (sqlite) ==========================================
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE adventure (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT,
    wiki_key TEXT, title TEXT, product_type TEXT, origin TEXT, status TEXT,
    field_origins_json TEXT, cover_url TEXT, cover_source TEXT, edition TEXT, genre TEXT,
    complexity_gm TEXT, complexity_pl TEXT, authors TEXT, series TEXT, fshop_code TEXT, wiki_url TEXT)');
$pdo->exec('CREATE TABLE adventure_place (id INTEGER PRIMARY KEY AUTOINCREMENT, adventure_id INT,
    sort_order INT, raw_name TEXT, role TEXT, origin TEXT, status TEXT)');
$pdo->exec("INSERT INTO adventure (public_id, wiki_key, title, origin, status, field_origins_json)
    VALUES ('p1', 'die-sieben-gezeichneten', 'Die Sieben Gezeichneten', 'wiki', 'approved', '{}')");
$pdo->exec("INSERT INTO adventure (public_id, wiki_key, title, origin, status, field_origins_json)
    VALUES ('p2', NULL, 'Der Platzhalter', 'manual', 'approved', '{}')");
$pdo->exec("INSERT INTO adventure_place (adventure_id, sort_order, raw_name, role, origin, status)
    VALUES (2, 0, 'Irgendwo', 'start', 'wiki', 'approved')");

// Über den wiki_key gefunden -> keine Übernahme.
$found = avesmapsAdventurePlanFindRow($pdo, ['wiki_key' => 'die-sieben-gezeichneten', 'title' => 'Die Sieben Gezeichneten']);
assert($found['current'] !== null && $found['adopting'] === false);

// Über den Titel gefunden -> Übernahme, und weil nichts von Hand gesetzt ist, verliert der
// Platzhalter seine Orte (genau das tut avesmapsAdventureFindOrAdoptRow).
$found = avesmapsAdventurePlanFindRow($pdo, ['wiki_key' => 'der-platzhalter', 'title' => 'Der Platzhalter']);
assert($found['adopting'] === true && $found['clears_places'] === true);

// 🔴 UND SIE HAT NICHTS GESCHRIEBEN. Das ist die eigentliche Zusicherung: die Vorlage
// (avesmapsAdventureFindOrAdoptRow) ANTWORTET durch Schreiben -- sie setzt wiki_key, dreht origin
// auf 'wiki' und löscht die Platzhalter-Orte. Eine Vorschau, die das täte, hätte die Übernahme
// schon vollzogen, bevor jemand ein Häkchen gesehen hat.
assert((string) $pdo->query("SELECT origin FROM adventure WHERE public_id='p2'")->fetchColumn() === 'manual');
assert($pdo->query("SELECT wiki_key FROM adventure WHERE public_id='p2'")->fetchColumn() === null);
assert((int) $pdo->query('SELECT COUNT(*) FROM adventure_place')->fetchColumn() === 1);

// Ein von Hand bearbeiteter Platzhalter behält seine Orte.
$pdo->exec("UPDATE adventure SET field_origins_json='{\"genre\":\"manual\"}' WHERE public_id='p2'");
$found = avesmapsAdventurePlanFindRow($pdo, ['wiki_key' => 'der-platzhalter', 'title' => 'Der Platzhalter']);
assert($found['adopting'] === true && $found['clears_places'] === false);

// Nichts gefunden -> neu.
$found = avesmapsAdventurePlanFindRow($pdo, ['wiki_key' => 'unbekannt', 'title' => 'Unbekannt']);
assert($found['current'] === null && $found['adopting'] === false);

echo "adventure-plan ok\n";
```

- [ ] **Step 6: Rot sehen, dann `avesmapsAdventurePlanFindRow` schreiben**

Der Rumpf ist `avesmapsAdventureFindOrAdoptRow` **ohne seine drei Schreiber**: `SELECT` per
`wiki_key`; sonst `SELECT … WHERE wiki_key IS NULL AND origin='manual' AND title=:title`; `adopting`
= über den Titel gefunden; `clears_places` = `adopting && kein Feld === 'manual'`. Kopfkommentar
nennt die Zwillingsfunktion und dass jede Änderung dort hier mitgezogen werden muss.

- [ ] **Step 7: `avesmapsAdventurePlanForCatalogRow` + `avesmapsAdventureLastStaged` schreiben**

`PlanForCatalogRow` ist der Zwilling von `avesmapsCitymapPlanForCatalogRow` und wird von **beiden**
Hälften gerufen (die Ausführ-Hälfte rechnet damit die Nachprüfung):

```php
/**
 * The difference row for ONE staged adventure, reads included. READ-ONLY.
 *
 * 💣 BOTH HALVES CALL THIS ONE FUNCTION -- the compute half to build the plan, the apply half to
 * recompute it right before writing and see whether the world moved on (design §4a). Two copies of
 * "what would this adventure need" would drift, and the drift would show up as a plan that can never
 * be applied: every row would look stale forever and nobody would know why.
 */
function avesmapsAdventurePlanForCatalogRow(PDO $pdo, array $catalog): array
```

Rumpf: `avesmapsAdventurePlanFindRow` → `avesmapsAdventureDesiredFromStaging($catalog)` →
Cover-Sonde (siehe unten) → Orte: `avesmapsAdventurePlacePlan($current === null || $clearsPlaces ? [] :
avesmapsAdventureLoadPlacesForReconcile($pdo, (int) $current['id']), avesmapsAdventureDesiredPlaces($pdo, $wikiKey))`
→ `avesmapsAdventurePlanItem(...)`.

Die **Cover-Sonde**, wörtlich nach der Bedingung im Schreiber (`adventure-sync.php:583–598`):

```php
// Read-only twin of the cover branch in avesmapsAdventureReconcileEntity. Three cases, and only the
// first one is news:
//   file changed  -> the writer would FETCH it (HTTP + a file in /uploads/questcovers). The plan can
//                    only announce that; the URL does not exist yet.
//   file unchanged -> the writer re-uses the stored local URL, so nothing differs.
//   no file        -> the writer leaves cover_url out of $desired entirely, so the field plan skips it.
// The last two are therefore deliberately absent from $desired here as well -- same input, same plan.
$coverPending = (string) ($fieldOrigins['cover_url'] ?? '') !== 'manual'
    && trim((string) ($catalog['cover_file'] ?? '')) !== ''
    && trim((string) ($catalog['cover_file'] ?? '')) !== trim((string) ($current['cover_source'] ?? ''));
```

`avesmapsAdventureLastStaged`: `SELECT MAX(synced_at) FROM wiki_adventure_catalog` in `try/catch`
(fehlende Tabelle → `null`), wörtlich wie `avesmapsCitymapLastStaged`.

- [ ] **Step 8: `avesmapsAdventurePlanStep` schreiben**

Rumpf Zeile für Zeile aus `avesmapsAdventureReconcileStep`, mit getauschtem Innenleben:

```php
function avesmapsAdventurePlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_ADVENTURE_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ Both DDL calls up here, once: MySQL commits an open transaction the moment it sees DDL.
    avesmapsEnsureAdventureStagingTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    // The run is derived from the cursor, never named by the client (same reasoning as
    // avesmapsCitymapPlanStep): an empty cursor means "from the top" and opens a fresh run.
    if ($cursor === '') {
        $runId = avesmapsSyncPlanStartRun($pdo, 'adventure', $userId, avesmapsAdventureLastStaged($pdo));
    } else {
        $runId = (int) (avesmapsSyncPlanBuildingRun($pdo, 'adventure')['id'] ?? 0);
    }
    if ($runId <= 0) {
        throw new RuntimeException('Der Abgleich wurde von einem zweiten Lauf abgeloest. Bitte neu starten.');
    }
    $decisions = avesmapsSyncPlanDecisions($pdo, 'adventure'); // ONE read per step, never per row
    …
}
```

Je Katalogzeile: `avesmapsAdventurePlanForCatalogRow` → bei `item !== null`
`avesmapsSyncPlanAddItem` mit `entity_key = wiki_key`, `entity_public_id = $current['public_id'] ?? null`,
`label = desired['title']`, `selected = avesmapsSyncPlanDefaultSelected($type, (int) ($decisions[key]['skipped_count'] ?? 0))`.
`$done = !$timedOut && count($catalogRows) < $budget`; bei `$done` **keine** Löschzeilen (Entscheidung 1:
Abenteuer verschwinden nicht) und dann `avesmapsSyncPlanFinishBuild`.

**Nicht** mehr hier: `avesmapsAppSettingSet(AVESMAPS_ADVENTURE_LAST_SYNCED_SETTING)`,
`avesmapsAdventureResolveAll`, `avesmapsWikiSyncNextMapRevision` — die wandern in die Ausführ-Hälfte
(Task 2), weil sie „es wurde geschrieben" bedeuten.

- [ ] **Step 9: `avesmapsAdventureReconcileStep` löschen**

Sie hat nach Task 3 keinen Aufrufer mehr. Der Kopfkommentar der neuen Rechen-Hälfte übernimmt ihre
Erklärung zum Cursor und zum `done`.

- [ ] **Step 10: Testen** — `adventure-plan-test.php`, `adventure-sync-test.php` (muss grün bleiben:
er prüft nur die reinen Funktionen) und `php -l api/_internal/wiki/adventure-sync.php`.

- [ ] **Step 11: Mutation** — in `avesmapsAdventurePlanItem` Regel 3 (`override`) auskommentieren →
der Test MUSS rot werden („bleibt"). Zurücknehmen. Dann `places_removed` in `places` umbenennen → rot.
Zurücknehmen.

---

## Task 2 — Die Ausführ-Hälfte für Abenteuer

**Files:**
- Create: `api/_internal/wiki/adventure-plan-apply.php`
- Modify: `api/_internal/map/collection-audit.php`
- Modify: `api/_internal/map/__tests__/collection-audit-test.php`
- Modify: `api/_internal/wiki/__tests__/sync-plan-purity-test.php`
- Modify: `api/_internal/wiki/__tests__/reconcile-transaction-test.php`

**Interfaces:**
- Consumes: `avesmapsAdventureReconcileEntity` (**unverändert**), `avesmapsAdventurePlanForCatalogRow`,
  `avesmapsSyncPlanPendingItems`, `…MarkItem`, `…PendingCount`, `…IsStale`, `…RecordSkip`,
  `…ClearSkip`, `…MarkApplied`, `…RunById`, `avesmapsLogSyncPlanApply`.
- Produces:
  - `avesmapsAdventureApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array`
    → `{done, applied, deleted, stale, processed, remaining, skipped, declined}`
  - `avesmapsAdventureApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array`

- [ ] **Step 1: Die Reinheits-Zusicherung erweitern (das Herzstück)**

In `api/_internal/wiki/__tests__/sync-plan-purity-test.php`, nach dem Karten-Block:

```php
// ============================== ABENTEUER (Sitzung 2) =============================================
$adventureCompute = $reachFrom($bodies, ['avesmapsAdventurePlanStep']);
assert(count($adventureCompute) >= 8, 'der Lauf erreicht die aufgerufenen Funktionen (sonst beweist er nichts)');
foreach (['avesmapsAdventurePlanForCatalogRow', 'avesmapsAdventurePlanItem', 'avesmapsAdventurePlanFindRow',
    'avesmapsAdventureFieldPlan', 'avesmapsAdventurePlacePlan', 'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($adventureCompute[$expected]), "the walk reaches {$expected}");
}
foreach (['adventure', 'adventure_place', 'wiki_adventure_catalog', 'wiki_adventure_place_staging',
    'map_features', 'map_audit_log'] as $table) {
    foreach ($forbiddenStatements($table) as $statement) {
        foreach ($adventureCompute as $name => $body) {
            assert(!str_contains($body, $statement), "{$name} runs in the COMPUTE half and writes: {$statement}");
        }
    }
}
// 🔴 Und die zwei Wege, auf denen diese Hälfte hier besonders leicht schreiben würde.
assert(!isset($adventureCompute['avesmapsAdventureFindOrAdoptRow']),
    'the compute half must use the read-only twin, not the finder that ANSWERS by adopting');
assert(!isset($adventureCompute['avesmapsAdventureReconcileEntity']),
    'the compute half must never reach the entity writer');
// 💣 KEIN BILD-DOWNLOAD. avesmapsAdventureSaveCoverLocal holt über HTTP und schreibt eine Datei --
// in einem Lauf, der nur rechnet, ist das ein Seiteneffekt, den kein Häkchen erlaubt hat.
assert(!isset($adventureCompute['avesmapsAdventureSaveCoverLocal']),
    'the compute half must not fetch a cover -- it announces the fetch, it does not perform it');
foreach ($adventureCompute as $name => $body) {
    assert(!str_contains($body, 'file_put_contents('), "{$name} writes a file in the compute half");
}

// 💣 UND DER LAUF MUSS BEISSEN: dieselbe Prüfung von der AUSFÜHR-Hälfte aus MUSS die Schreiber finden.
$adventureApply = $reachFrom($bodies, ['avesmapsAdventureApplyStep']);
assert(isset($adventureApply['avesmapsAdventureReconcileEntity']), 'die Ausführ-Hälfte ruft den Schreiber');
assert(isset($adventureApply['avesmapsAdventureSaveCoverLocal']), 'und dort DARF das Cover geholt werden');
$adventureWriters = array_filter($adventureApply, static fn(string $b): bool
    => str_contains($b, 'INSERT INTO adventure ') || str_contains($b, 'UPDATE adventure SET '));
assert($adventureWriters !== [], 'die Ausführ-Hälfte enthält die Schreiber -- sonst prüft der Lauf oben nichts');
```

- [ ] **Step 2: Rot sehen** — `avesmapsAdventureApplyStep` gibt es noch nicht, also schlägt die
Gegenprobe fehl (`die Ausführ-Hälfte ruft den Schreiber`).

- [ ] **Step 3: `api/_internal/wiki/adventure-plan-apply.php` schreiben**

Kopf wörtlich nach `citymap-plan-apply.php` (englisch), mit dem
`require_once __DIR__ . '/../map/collection-audit.php'` und derselben Begründung. Dann:

```php
/**
 * ONE bounded apply step. Resumable: every handled row carries its apply_state, so the next call
 * simply picks up the ones that have none.
 *
 * 💣 NO try/catch AROUND THE ROW (finding A21) -- see citymap-plan-apply.php for the full argument.
 *
 * ⚠️ NO deletion branch, and that is not an omission: an adventure is never deleted by the sync, not
 * even when its wiki article disappears (there is no removal sweep in adventure-sync.php and never
 * was). A shrinking "Ort" list is a change to a LIVING adventure and rides in its own row, named as
 * "Orte entfallen" -- Entscheidung 1 of the session-2 plan.
 */
function avesmapsAdventureApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
```

Ablauf je Zeile (Budget `AVESMAPS_ADVENTURE_RECONCILE_STEP_BUDGET`, dieselbe Zeitschranke):

1. `avesmapsSyncPlanPendingItems($pdo, $runId, $budget)`.
2. Katalogzeile per `entity_key` lesen (`SELECT * FROM wiki_adventure_catalog WHERE wiki_key = :wk`).
   Weg ⇒ `apply_state='stale'`, `apply_note='Im Dump nicht mehr enthalten.'`.
3. Sonst **neu rechnen** mit `avesmapsAdventurePlanForCatalogRow` und gegen `after_json` halten
   (`avesmapsSyncPlanIsStale`) ⇒ abweichend `stale`,
   `apply_note='Der Stand hat sich seit der Vorschau geaendert.'`.
   ⚠️ Für den Vergleich wird `after['cover']` **mitgenommen** (der Satz „wird neu geladen" ist ein
   Wert wie jeder andere): ändert das Wiki inzwischen sein Titelbild, ist die Zeile veraltet, und das
   ist richtig — die Zahl neben „Titelbild" wäre sonst eine andere Datei.
4. Sonst `avesmapsAdventureReconcileEntity($pdo, $catalog, $userId)` (unverändert, kein
   `beginTransaction` darum — die dokumentierte Ausnahme, `reconcile-transaction-test.php`) und
   `apply_state='applied'`.
5. Keine offenen Zeilen mehr ⇒ `avesmapsAdventureApplyFinish`.

`avesmapsAdventureApplyFinish` wörtlich nach `avesmapsCitymapApplyFinish`, mit diesen Unterschieden:
- kein `deleted`-Zweig (keine Löschzeilen), also `declined` immer 0 — aber der Zweig
  `!$isSelected && $type === 'changed'` → `avesmapsSyncPlanRecordSkip($pdo, 'adventure', …)` und
  `applied && changed` → `avesmapsSyncPlanClearSkip` bleiben wörtlich.
- Abschlussarbeiten: `avesmapsAppSettingSet($pdo, AVESMAPS_ADVENTURE_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'))`
  (best-effort, `function_exists` + `try`), `avesmapsAdventureResolveAll($pdo)` (**nicht** best-effort
  — ein still übersprungener Resolver sieht wie eine erfolgreiche Übernahme aus, während jeder neue
  Ort unaufgelöst bleibt), `avesmapsWikiSyncNextMapRevision($pdo)`.
- `avesmapsLogSyncPlanApply($pdo, 'adventure', $planned, [… 'deleted_titles' => []], $user)`.

- [ ] **Step 4: Die Protokoll-Beschriftung**

`api/_internal/map/collection-audit.php`:

```php
/** What the Übernahme row calls the sync it belongs to. Grows with session 2-4 (design §7). */
const AVESMAPS_COLLECTION_AUDIT_KIND_LABELS = [
    'citymap' => 'Stadtkarten',
    'adventure' => 'Abenteuer',
    'publication' => 'Publikationsquellen',
    'lore' => 'Vorkommen',
];

/**
 * ⚠️ What the deletions of THIS sync are called. Not decoration: for the Vorkommen a "deletion" sets
 * status='retired' and the next sync can revive it, so calling it "gelöscht" in the log would be the
 * single most misleading word available -- the log is read months later, by somebody deciding whether
 * something is recoverable. Default 'gelöscht' for anything not listed.
 */
const AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB = [
    'lore' => 'stillgelegt',
];
```

In `avesmapsLogSyncPlanApply` die Zeile
`$name .= ', ' . count($titles) . ' gelöscht';` durch
`$name .= ', ' . count($titles) . ' ' . (AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB[$kind] ?? 'gelöscht');`
ersetzen.

In `api/_internal/map/__tests__/collection-audit-test.php` ergänzen:

```php
// Jede Art, die eine Vorschau hat, hat auch einen Namen im Protokoll -- sonst steht dort ihr
// Maschinenwort ("lore"), und das liest niemand als „Vorkommen".
foreach (['citymap', 'adventure', 'publication', 'lore'] as $kind) {
    assert(isset(AVESMAPS_COLLECTION_AUDIT_KIND_LABELS[$kind]), "{$kind} hat eine Beschriftung");
}
// 💣 Und die Vorkommen werden STILLGELEGT, nicht gelöscht (siehe den Kommentar an der Konstante).
assert((AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB['lore'] ?? '') === 'stillgelegt');
assert(!isset(AVESMAPS_COLLECTION_AUDIT_KIND_DELETION_VERB['citymap']), 'eine gelöschte Karte ist gelöscht');
```

- [ ] **Step 5: `reconcile-transaction-test.php` nachziehen**

`$callerFiles` um `'api/_internal/wiki/adventure-plan-apply.php'` erweitern und den
Kommentar darüber um einen Satz ergänzen: die Abenteuer-Schleife steht jetzt dort, mit derselben
Regel (keine Transaktion um die Schleife, kein `try {` um die Zeile) — und die dokumentierte
**Ausnahme** bleibt unangetastet: `avesmapsAdventureReconcileEntity` ist bewusst **nicht** in eine
Transaktion gewickelt, weil es mitten im Schreiben ein Bild über HTTP holt und in eine Datei
schreibt. Das ist keine Baustelle.

- [ ] **Step 6: Alle vier Tests grün** — `sync-plan-purity-test.php`,
`reconcile-transaction-test.php`, `collection-audit-test.php`, `adventure-plan-test.php`.

- [ ] **Step 7: Mutation** — `avesmapsAdventureSaveCoverLocal($wikiKey, $coverFile)` versuchsweise
als erste Zeile in `avesmapsAdventurePlanForCatalogRow` einsetzen (der realistische Rückfall) →
`sync-plan-purity-test.php` MUSS rot werden. Zurücknehmen. Dann
`avesmapsAdventureFindOrAdoptRow` statt des Zwillings rufen → rot. Zurücknehmen.

---

## Task 3 — Endpunkt, Kette und der Wirt

**Files:**
- Modify: `api/edit/wiki/sync-plan.php`, `api/edit/wiki/dump.php`
- Modify: `css/components/sync-plan-sheet.css`, `js/review/sync-plan-sheet.js`
- Modify: `js/review/__tests__/sync-plan-sheet.test.js`
- Modify: `index.html`, `html/adventure-editor.html`, `js/review/review-wiki-sync.js`
- Test: `api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php`

- [ ] **Step 1: Die Ketten-Zusicherung schreiben (neu, und sie fehlt seit Sitzung 1)**

`api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php`:

```php
<?php
declare(strict_types=1);
/**
 * 💣 Jede fremde Funktion, die eine Ausführ-Hälfte ruft, ist in der require-Kette von
 * api/edit/wiki/sync-plan.php. Dieselbe Falle, für die citymap-sync-test.php ihren
 * „Not in the dump endpoint require chain"-Assert hat: der Karten-Sync starb beim ersten echten
 * Lauf mit einem 500, weil eine Funktion aus einer Datei kam, die der Endpunkt nicht lädt -- und
 * jeder Unit-Test war grün, weil ein Unit-Test die Kette des Endpunkts nie lädt.
 *
 * Der Endpunkt hat seine EIGENE Kette (er ist nicht dump.php), also braucht er seine eigene Probe.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1'.\n");
    exit(2);
}
$root = dirname(__DIR__, 3);
$endpoint = (string) file_get_contents($root . '/edit/wiki/sync-plan.php');
assert($endpoint !== '', 'der Endpunkt ist lesbar');

// Die Kette, wie der Endpunkt sie selbst schreibt -- abgelesen, nicht abgeschrieben: eine
// abgeschriebene Liste bleibt grün, wenn im Endpunkt eine Zeile fehlt.
preg_match_all("/^require(?:_once)? __DIR__ \. '([^']+)';/m", $endpoint, $matches);
$chain = array_values(array_filter($matches[1], static fn(string $p): bool
    => !str_contains($p, 'bootstrap.php') && !str_contains($p, '/auth.php')));
assert(count($chain) >= 10, 'die Kette wurde gefunden (' . count($chain) . ')');
foreach ($chain as $relative) {
    require_once $root . '/edit/wiki' . $relative;
}

// Die Ausführ-Hälften. Wächst mit jeder Sitzung um eine Datei.
$applyFiles = ['citymap-plan-apply.php', 'adventure-plan-apply.php'];
$missing = [];
foreach ($applyFiles as $file) {
    $source = (string) file_get_contents($root . '/_internal/wiki/' . $file);
    assert($source !== '', "{$file} ist lesbar");
    preg_match_all('/\b(avesmaps[A-Za-z0-9_]*)\s*\(/', $source, $called);
    foreach (array_unique($called[1]) as $function) {
        if (!function_exists($function)) {
            $missing[] = $file . ': ' . $function;
        }
    }
}
assert($missing === [], 'Not in the sync-plan endpoint require chain: ' . implode(', ', $missing));

echo 'sync-plan-endpoint-chain ok (' . count($chain) . " Dateien)\n";
```

⚠️ Erwartung beim ersten Lauf: **rot**, und zwar echt — `adventure-plan-apply.php` ruft
`avesmapsAdventureReconcileEntity` und `avesmapsAdventuresEnsureTables`, die der Endpunkt heute nicht
lädt. Genau dafür ist die Probe da.

- [ ] **Step 2: Den Endpunkt erweitern**

`api/edit/wiki/sync-plan.php`:
- `const AVESMAPS_SYNC_PLAN_KINDS = ['citymap', 'adventure'];`
- require-Kette: `_internal/app/adventures.php` und `_internal/wiki/adventure-sync.php` +
  `_internal/wiki/adventure-plan-apply.php` (die Reihenfolge von `dump.php` übernehmen:
  `adventures.php` vor `adventure-resolve.php`).
- `match`-Arm: `'adventure' => avesmapsAdventureApplyStep($pdo, $runId, $userId, $currentUser),`

Danach Step 1 grün.

- [ ] **Step 3: `sync_adventures` umhängen**

`api/edit/wiki/dump.php`: `avesmapsAdventureReconcileStep(...)` → `avesmapsAdventurePlanStep(...)`.
Die Antwort verliert die Schreibzähler (`adv_created/adv_updated/places_*/covers_fetched`) und trägt
`'stage' => 'plan'`, `run_id`, `planned`, `counts`, `processed`, `progress`, `cursor`, `done` — genau
wie `sync_citymaps`. Der Kommentarblock darüber wird umgeschrieben: **dieser Knopf schreibt nicht
mehr** (Entwurf §6). Pipeline-Riegel und Fähigkeit `edit` bleiben unverändert; der Riegel bleibt auch
ohne Schreiben, weil der Lauf den offenen Plan **ersetzt** (§6).

- [ ] **Step 4: Das Bauteil erweitern — erst der Test**

In `js/review/__tests__/sync-plan-sheet.test.js` ergänzen:

```js
// ---- Die Arten ---------------------------------------------------------------------------------
// Jede Art, die eine Vorschau hat, hat einen Titel und ein Wort für ihre Einträge; sonst steht im
// Kopf „Aus dem Wiki übernehmen" und in der Bestätigung „3 Einträge" -- richtig, aber blind.
["citymap", "adventure"].forEach((kind) => {
	assert.ok(sandbox.SYNC_PLAN_KIND_TITLES[kind], `${kind} hat einen Titel`);
	assert.ok(sandbox.SYNC_PLAN_KIND_NOUNS[kind], `${kind} hat ein Hauptwort`);
});

// 🔴 Eine Art, die NICHTS löscht, sagt das -- statt einer leeren Warnung. Eine Löschgruppe, die bei
// jedem Abgleich rot und leer dasteht, bringt einem Editor bei, sie zu überblättern; und dann
// überblättert er sie auch bei den Karten.
const advPlan = planWith({ kind: "adventure", items: { new: [], changed: [], deleted: [] },
	run: { id: 9, state: "open", created_at: "", source_stamp: "", counts: { new: 0, changed: 0, deleted: 0, total: 0 } } });
const advHtml = markup(advPlan);
assert.ok(advHtml.includes("löscht keine Abenteuer") || advHtml.includes("löscht nichts"),
	"die Löschgruppe sagt, dass dieser Abgleich nicht löscht");

// Die Felder der Abenteuer sind deutsch beschriftet, samt der drei, die kein Feld sind.
["title", "product_type", "edition", "genre", "complexity_gm", "complexity_pl", "authors", "series",
	"fshop_code", "cover_url", "wiki_url", "cover", "adopt", "places", "places_removed"].forEach((field) => {
	assert.notStrictEqual(fieldLabel(field), field, `${field} hat eine deutsche Beschriftung`);
});

// 💣 Ein Verlust in einer VORANGEHÄKELTEN Zeile braucht seine eigene Farbe. „Orte entfallen: 3"
// zwischen sechs harmlosen Zeilen ist genau die Zeile, die man überliest -- und der Grund, warum
// Entscheidung 1 dieses Bauplans überhaupt vertretbar ist.
const loss = planWith({ kind: "adventure" });
loss.items.changed[0].after = { genre: "Intrige", places_removed: 3 };
const lossHtml = markup(loss);
assert.ok(lossHtml.includes("diff__loss"), "das Verlustfeld ist als solches gekennzeichnet");
```

- [ ] **Step 5: Rot sehen, dann `js/review/sync-plan-sheet.js` erweitern**

```js
/** Was der Abgleich zählt — Ein-/Mehrzahl für die zweite Bestätigung. */
const SYNC_PLAN_KIND_NOUNS = {
	citymap: { one: "Karte", many: "Karten" },
	adventure: { one: "Abenteuer", many: "Abenteuer" },
};

const SYNC_PLAN_KIND_TITLES = {
	citymap: "Stadtkarten aus dem Wiki übernehmen",
	adventure: "Abenteuer aus dem Wiki übernehmen",
};

/**
 * Was die Löschgruppe je Art bedeutet — und `null` heißt: diese Art löscht nichts.
 *
 * 🔴 Nicht kosmetisch. Eine rote, immer leere Löschgruppe bringt einem Editor bei, sie zu
 * überblättern; und dann überblättert er sie auch dort, wo wirklich etwas verschwindet. Und der
 * umgekehrte Fehler ist genauso teuer: bei den Vorkommen wird nichts gelöscht, sondern stillgelegt
 * — steht darüber „lässt sich nicht rückgängig machen", wirkt die Warnung übertrieben, und eine
 * übertriebene Warnung wird weggeklickt (Entwurf §7).
 */
const SYNC_PLAN_KIND_DELETION = {
	citymap: {
		hint: "im Wiki nicht mehr da · <b>nichts vorangehäkelt</b>",
		lead: 'Was du <b>nicht</b> anhäkelst, <b>bleibt</b> — dauerhaft, es wird nicht wieder gefragt. '
			+ 'Es bleibt trotzdem ein Wiki-Eintrag: kommt der Artikel zurück, läuft er wieder mit.',
	},
	adventure: null,
};

/** Felder, die einen Verlust nennen. Sie werden in Warnfarbe gezeichnet, wo sie stehen. */
const SYNC_PLAN_LOSS_FIELDS = ["places_removed", "occurrences_removed", "sources_removed"];
```

- `syncPlanFieldLabel` bekommt die Abenteuer-Felder mit **denselben deutschen Wörtern, die der
  Abenteuereditor benutzt** (`html/adventure-editor.html:816–833`): `product_type` → „Produkttyp",
  `edition` → „Regelsystem", `complexity_gm` → „Komplexität (SL)", `complexity_pl` → „Komplexität
  (Spieler)", `authors` → „Autoren", `series` → „Serie / Reihe", `fshop_code` → „F-Shop-Code",
  `cover_url` → „Cover-URL", `wiki_url` → „Wiki-URL", `cover` → „Titelbild", `adopt` → „Übernahme",
  `places` → „Orte", `places_removed` → „Orte entfallen". *(Zwei Beschriftungen für dasselbe Ding
  wären genau die Divergenz, die AGENTS.md §12 für Farben verbietet — hier gilt sie für Wörter.)*
- `syncPlanDiffMarkup`: steht ein Feld in `SYNC_PLAN_LOSS_FIELDS`, bekommt sein `<dd>` die Klasse
  `diff__loss` und den Text „**3** entfallen" statt „— → 3".
- `syncPlanGroupMarkup(group, items, total, hiddenCount, kind)`: für `group.key === 'deleted'` und
  `SYNC_PLAN_KIND_DELETION[kind] == null` → Überschrift „Gelöscht", Hinweis
  „dieser Abgleich löscht nichts", Rumpf ein Satz („Ein Abenteuer wird nie gelöscht — auch dann
  nicht, wenn sein Artikel im Wiki verschwindet."), Gruppe **zu**. Sonst wie heute, mit `hint`/`lead`
  aus der Tabelle.
- `syncPlanFooterState`: unverändert (bei 0 Löschungen erscheint der Riegel schon heute nicht).

- [ ] **Step 6: CSS** — `z-index: 40` → `z-index: var(--z-modal)` mit einem Kommentar (in
`index.html` liegt das Blatt sonst unter dem Vorkommen-Fenster, `--z-editor-overlay: 1500`), und ein
Wähler `.sync-plan-host .diff__loss { color: var(--color-danger-soft-text); font-weight: 700; }`.
Vor dem Schreiben prüfen, dass `--z-modal` in `css/base/tokens.css:474` steht (ja) und dass die
Karteneditorseite (`html/citymap-editor.html`) kein Element mit einem höheren z-index über dem Blatt
haben will (`grep -n "z-index" html/citymap-editor.html`).

- [ ] **Step 7: Grün sehen** — `node js/review/__tests__/sync-plan-sheet.test.js`.

- [ ] **Step 8: Verdrahten**

`index.html`:
- `<link rel="stylesheet" href="css/components/sync-plan-sheet.css">` neben den anderen
  Komponenten-Stylesheets (die Pfadform der Nachbarn übernehmen — `index.html` verlinkt ohne
  führenden Schrägstrich).
- `<script src="js/review/sync-plan-sheet.js"></script>` **vor** `js/review/review-wiki-sync.js`
  (Zeile 2576).
- `<div class="sync-plan-host" id="wikiSyncPlanHost" hidden></div>` als letztes Kind von `<body>`.
  ⚠️ Vorher `grep -n "syncPlan\|SYNC_PLAN" index.html js/**/*.js` — die Datei ist ein einziger
  globaler Namensraum, und eine Kollision ist hier lautlos (Merksatz „`<script>`-Kollision").

`html/adventure-editor.html`: wie `html/citymap-editor.html` — CSS-Link, Script, Wirt
`<div class="sync-plan-host" id="aeSyncPlanHost" hidden></div>`, und im Handler von `#aeSyncBtn` nach
dem Rechnen:

```js
const result = await window.parent.startWikiSyncAdventuresSync({ openSheet: false });
if (result && result.run_id) {
  openSyncPlanSheet({ kind: "adventure", mount: document.getElementById("aeSyncPlanHost"),
    onApplied: () => { aeLoadList(); } });
}
```

`js/review/review-wiki-sync.js`:
- `runWikiSyncAdventuresSyncLoop` summiert `planned`/`processed` statt der sechs Schreibzähler; die
  Fortschrittszeile sagt „Abenteuer werden verglichen … N/M geprüft".
- `startWikiSyncAdventuresSync(options)` schließt mit
  „`${total} Unterschiede — Vorschau offen (…)`" bzw. „Keine Unterschiede: der Bestand entspricht dem
  Dump.", gibt `{run_id, counts}` zurück und öffnet — **wenn `options?.openSheet !== false`** — das
  Blatt in `#wikiSyncPlanHost`. Der Kommentarblock darüber wird auf den neuen Zustand umgeschrieben
  (er behauptet heute, der Lauf schreibe).

- [ ] **Step 9: Ohne Anmeldung im Browser prüfen**

`verify-sync-plan-sheet.html` (unverfolgte Sonde aus Sitzung 1, wird **nicht** committet) um einen
Abenteuer-Plan erweitern: Feld-Override, `places_removed`, leere Löschgruppe — hell **und** dunkel.

---

## Task 4 — Abschluss Commit A

- [ ] **Step 1: Die volle Suite, wie die CI sie fährt**

```bash
for t in $(find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) | sort); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll "$t" >/dev/null || echo "RED $t"; done
```
```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js' | sort); do node "$t" >/dev/null || echo "RED $t"; done
```
⚠️ Bei Rot **einen** roten Test einzeln laufen lassen und die Fehlerzeile lesen — fehlende Extensions
melden falsch rot.

- [ ] **Step 2: Nur eigene Pfade stagen** — `git status` lesen, fremde Dateien stehen lassen, die
Pfade aus „File Structure" Commit A einzeln mit `git add <pfad>` stagen (samt diesem Bauplan).

- [ ] **Step 3: Commit** (`git commit -F <datei>`), Betreff:

```
feat(sync): der Abenteuer-Abgleich zeigt erst, was er tun wuerde -- geschrieben wird nur, was angehaekelt ist
```

- [ ] **Step 4: Push, 2–4 Minuten warten, live gegenprüfen**

- Remote-SHA gegen lokal.
- `POST /api/edit/wiki/sync-plan.php` **anonym** ⇒ **401**, nie 500; `GET` ⇒ **405**.
- Die öffentlichen Lesewege bleiben 200: `GET /api/app/adventures.php`, `GET /api/app/map-features.php`
  (ETag unverändert — es lief ja keine Übernahme).
- `GET /js/review/sync-plan-sheet.js` ⇒ 200, `GET /css/components/sync-plan-sheet.css` ⇒ 200.
- **Kein** `sync_adventures`, **kein** „Dump holen", **kein** `apply`.

---

# COMMIT B — Publikationen

## Task 5 — Die read-only-Sonde für Quellenverweise

**Files:**
- Modify: `api/_internal/wiki/publication-sync.php`
- Test: `api/_internal/wiki/__tests__/publication-plan-test.php`

**Interfaces:**
- Consumes (unverändert): `avesmapsPublicationDiffLinks`, `avesmapsPublicationStagingHasEntityType`,
  `avesmapsPublicationReconcileSegmentOrder`, `avesmapsPublicationFetchLiveEntityBatch`.
- Produces:
  - `avesmapsPublicationSourceIdForPlan(PDO $pdo, string $url, string $wikiKey): int` *(READ-ONLY, 0 = gibt es noch nicht)*
  - `avesmapsPublicationLinkDiffForPlan(PDO $pdo, string $entityType, string $entityPublicId, string $entityWikiKey): array`
    → `['add'=>int, 'update'=>int, 'remove'=>int, 'add_titles'=>list<string>, 'remove_titles'=>list<string>]`
  - `avesmapsPublicationPlanItem(array $diff): ?array` *(PURE)*
  - `avesmapsPublicationPlanForEntity(PDO $pdo, string $entityType, array $entity): array`
  - `avesmapsPublicationPlanEntityKey(string $entityType, string $entityWikiKey): string` *(PURE)*
  - `avesmapsPublicationLastStaged(PDO $pdo): ?string`
  - `avesmapsPublicationPlanStep(PDO $pdo, int $segment, int $lastId, int $userId, ?int $budget = null): array`
    → `{done, nextSegment, nextLastId, run_id, planned, processed, counts, skipped_types}`

- [ ] **Step 1: Den Test schreiben**

`api/_internal/wiki/__tests__/publication-plan-test.php`:

```php
<?php
declare(strict_types=1);
/** Die Vorschau der Publikationsquellen: die Sonde liest, sie legt nichts an. */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1'.\n");
    exit(2);
}
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../publication-sync.php';

// --- Der Schlüssel trägt den Typ ----------------------------------------------------------------
// 💣 Ein gleichnamiger Ort und eine gleichnamige Region teilen denselben schlichten Slug (der Grund,
// warum wiki_entity_publication seit Fix 2 auf (entity_type, entity_wiki_key) eindeutig ist). Ohne
// den Typ im Schlüssel teilten sie sich auch ihre Planzeile und ihre Entscheidung.
assert(avesmapsPublicationPlanEntityKey('settlement', 'havena') !== avesmapsPublicationPlanEntityKey('region', 'havena'));
assert(str_starts_with(avesmapsPublicationPlanEntityKey('settlement', 'havena'), 'settlement|'));

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
assert(avesmapsPublicationPlanItem(['add' => 0, 'update' => 0, 'remove' => 0,
    'add_titles' => [], 'remove_titles' => []]) === null);

// --- Zugewinn und Verlust stehen getrennt in der Zeile -------------------------------------------
$item = avesmapsPublicationPlanItem(['add' => 2, 'update' => 1, 'remove' => 3,
    'add_titles' => ['Havena – Stadt der Diebe', 'Aventurischer Bote 42'], 'remove_titles' => ['Alt']]);
assert($item['change_type'] === 'changed', 'die Einheit existiert -- es gibt nichts anzulegen');
assert($item['after']['sources_removed'] === 3, 'der Verlust hat sein eigenes Feld');
assert(str_contains((string) $item['after']['sources'], '2 neu'));
assert(str_contains((string) $item['after']['sources'], 'Havena'), 'und die Titel stehen dabei');

// --- 🔴 Die Sonde legt keine Quelle an ----------------------------------------------------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT,
    wiki_key TEXT, label TEXT, source_type TEXT, is_official INT, created_by INT)');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT,
    entity_public_id TEXT, source_id INT, origin TEXT, status TEXT, reference_kind TEXT, pages TEXT, note TEXT)');
$pdo->exec('CREATE TABLE wiki_entity_publication (id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_wiki_key TEXT, entity_type TEXT, publication_wiki_key TEXT, reference_kind TEXT, pages TEXT, note TEXT)');
$pdo->exec('CREATE TABLE wiki_publication_catalog (wiki_key TEXT PRIMARY KEY, title TEXT,
    source_type TEXT, chosen_url TEXT, has_link INT, synced_at TEXT)');
$pdo->exec("INSERT INTO wiki_publication_catalog VALUES ('havena-stadt', 'Havena – Stadt der Diebe',
    'quellenband', 'https://f-shop/1', 1, '2026-08-06 10:00:00')");
$pdo->exec("INSERT INTO wiki_entity_publication (entity_wiki_key, entity_type, publication_wiki_key)
    VALUES ('havena', 'settlement', 'havena-stadt')");

$before = (int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn();
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['add'] === 1, 'eine Quelle, die es noch nicht gibt, ist ein Zugewinn');
assert($diff['add_titles'] === ['Havena – Stadt der Diebe']);
// 💣 DIE ZUSICHERUNG. avesmapsPublicationDesiredLinksForEntity ANTWORTET, indem es die Quelle in
// `sources` anlegt (avesmapsFeatureSourceUpsert) -- eine Vorschau, die das tut, hat den Katalog
// schon verändert, bevor jemand ein Häkchen gesehen hat. Und niemand würde es merken: die Zeilen
// sind unschädlich, sie stehen nur da.
assert((int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn() === $before,
    'die Sonde hat keine Quelle angelegt');

// Existiert die Quelle schon und ist verknüpft, gibt es nichts zu tun.
$hash = hash('sha256', 'https://f-shop/1');
$pdo->prepare('INSERT INTO sources (url, url_hash, label) VALUES (?, ?, ?)')
    ->execute(['https://f-shop/1', $hash, 'Havena – Stadt der Diebe']);
$sourceId = (int) $pdo->query('SELECT id FROM sources')->fetchColumn();
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('settlement', 'PID-1', ?, 'wiki_publication', 'approved')")->execute([$sourceId]);
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff === ['add' => 0, 'update' => 0, 'remove' => 0, 'add_titles' => [], 'remove_titles' => []]);
assert(avesmapsPublicationPlanItem($diff) === null, 'ein zweiter Lauf erzeugt KEINE Zeile');

// Ein manueller Verweis wird nie entfernt (der Diff schließt ihn aus -- hier nur die Gegenprobe,
// dass die Sonde denselben Diff benutzt und nicht ihren eigenen).
$pdo->exec("INSERT INTO sources (url, url_hash, label) VALUES ('https://eigen', '"
    . hash('sha256', 'https://eigen') . "', 'Eigene Quelle')");
$manualId = (int) $pdo->query("SELECT id FROM sources WHERE url='https://eigen'")->fetchColumn();
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('settlement', 'PID-1', ?, 'manual', 'approved')")->execute([$manualId]);
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['remove'] === 0, 'eine manuelle Quelle taucht in keiner Vorschau auf');

echo "publication-plan ok\n";
```

- [ ] **Step 2: Rot sehen**

- [ ] **Step 3: Die Sonde schreiben**

```php
/**
 * The id of an existing shared source, or 0. READ-ONLY twin of avesmapsFeatureSourceUpsert.
 *
 * 💣 The writer ANSWERS BY INSERTING: it upserts into `sources` and returns the id it just made
 * sure of. That is the right shape for a reconcile and the wrong one for a preview -- a plan that
 * creates catalogue rows has already changed the database it claims to be describing, and nobody
 * would notice, because the rows are harmless on their own.
 *
 * The hash is built by the SAME rule (url, or 'wikipub:' + wiki_key for a publication without a shop
 * link) -- if that rule ever changes, both functions change or the preview quietly says "new" about
 * everything.
 */
function avesmapsPublicationSourceIdForPlan(PDO $pdo, string $url, string $wikiKey): int
```

`avesmapsPublicationLinkDiffForPlan`: liest die aktuellen `feature_sources`-Zeilen (dieselbe Abfrage
wie `avesmapsPublicationReconcileEntityWrites`), liest die Wunschliste (dieselbe `JOIN`-Abfrage wie
`avesmapsPublicationDesiredLinksForEntity`, **ohne** den Upsert), teilt sie in *auflösbar* (id > 0)
und *neu* (id === 0), ruft `avesmapsPublicationDiffLinks($current, $auflösbar)` und addiert die neuen
zu `add`. Kopfkommentar: warum `remove` davon unberührt bleibt (eine Quelle, die es nicht gibt, kann
in keiner bestehenden Verknüpfung stecken). Fehlende Tabellen (`42S02`) ⇒ leerer Diff.
Titel: aus `wiki_publication_catalog.title` (für `add_titles`) bzw. `sources.label` (für
`remove_titles`), je Liste höchstens 5, danach „… und N weitere".

`avesmapsPublicationPlanItem(array $diff): ?array` *(PURE)*: alles 0 ⇒ `null`; sonst
`change_type='changed'`, `after['sources'] = "2 neu, 1 geändert (Havena – Stadt der Diebe, …)"`,
`after['sources_removed'] = $diff['remove']` mit den Titeln, `before = []`, `override = []`.
Kopfkommentar: warum es kein `'new'` gibt (die Einheit existiert immer; nur ihre Quellen ändern sich)
und kein `'deleted'` (Entscheidung 1).

`avesmapsPublicationPlanEntityKey`: `$entityType . '|' . $entityWikiKey`, plus der Riegel im
Aufrufer — siehe Step 4.

- [ ] **Step 4: `avesmapsPublicationPlanStep` schreiben**

Rumpf aus `avesmapsPublicationReconcileStep`, mit drei Änderungen:

1. Lauf: `if ($segment <= 0 && $lastId <= 0) { StartRun } else { BuildingRun }` — der 2D-Cursor am
   Anfang ist das „von vorn" dieses Abgleichs.
2. Je Einheit `avesmapsPublicationPlanForEntity` statt `avesmapsPublicationReconcileEntity`; bei
   `item !== null` `avesmapsSyncPlanAddItem` mit
   `entity_key = avesmapsPublicationPlanEntityKey($type, $wikiKey)`,
   `entity_public_id = $publicId`, `label = "<Name> (<Typwort>)"`.
   Das **Typwort** ist deutsch: `settlement`→Ort, `region`→Region, `path`→Weg,
   `territory`→Herrschaftsgebiet, `lore`→Vorkommen. Der Name kommt aus der bereits gelesenen Zeile
   (bei `map_features` der Name aus `properties_json`, bei `political_territory` der Name, bei `lore`
   der `wiki_key`) — **kein** zusätzlicher `SELECT` je Einheit (STRATO).
   💣 **Längenriegel:** ist `mb_strlen($entityKey) > 190`, wird die Einheit **übersprungen** und in
   `skipped_long_key` gezählt (die Spalte ist 190 lang; ein abgeschnittener Schlüssel fände beim
   Übernehmen die falsche oder keine Einheit). In der Praxis nie, im Zweifel sichtbar.
3. `avesmapsPublicationStagingHasEntityType` bleibt **wörtlich** an derselben Stelle und mit
   demselben Kommentar — er ist der Riegel, der einen nie gestagten Typ vor der Totallöschung
   bewahrt. Die übersprungenen Typen werden zusätzlich als `skipped_types` gemeldet, damit die
   Vorschau sagen kann, dass sie über einen Typ nichts weiß.
   `$done` ⇒ `avesmapsSyncPlanFinishBuild`, **keine** Löschzeilen. Kein
   `avesmapsWikiSyncNextMapRevision` (es wurde nichts geschrieben).

`avesmapsPublicationReconcileStep` **bleibt unverändert stehen** — die Phase
`avesmapsPublicationSyncPhaseStep` fährt sie weiter (Entscheidung 2). Ein Kommentar an beiden nennt
die zwei Türen und die Sitzung, in der die zweite nachzieht.

- [ ] **Step 5: Grün sehen** — `publication-plan-test.php` und `publication-sync-test.php`.

- [ ] **Step 6: Mutation** — in der Sonde `avesmapsFeatureSourceUpsert` statt der Lesefrage benutzen
→ der Test MUSS rot werden („die Sonde hat keine Quelle angelegt"). Zurücknehmen.

---

## Task 6 — Die Ausführ-Hälfte für Publikationen

**Files:**
- Create: `api/_internal/wiki/publication-plan-apply.php`
- Modify: `api/_internal/wiki/__tests__/sync-plan-purity-test.php`,
  `api/_internal/wiki/__tests__/reconcile-transaction-test.php`,
  `api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php`
- Modify: `api/edit/wiki/sync-plan.php`

**Interfaces:**
- Produces: `avesmapsPublicationApplyStep(PDO, int $runId, int $userId, ?array $user, ?int $budget = null): array`,
  `avesmapsPublicationApplyFinish(PDO, int $runId, int $userId, ?array $user): array`

- [ ] **Step 1: Die Reinheits-Zusicherung erweitern**

Wie in Task 2, mit diesen Wurzeln und Gegenproben:

```php
// ============================== PUBLIKATIONEN (Sitzung 2) =========================================
$pubCompute = $reachFrom($bodies, ['avesmapsPublicationPlanStep']);
assert(count($pubCompute) >= 8, 'der Lauf erreicht die aufgerufenen Funktionen');
foreach (['avesmapsPublicationPlanForEntity', 'avesmapsPublicationLinkDiffForPlan',
    'avesmapsPublicationSourceIdForPlan', 'avesmapsPublicationDiffLinks',
    'avesmapsPublicationStagingHasEntityType', 'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($pubCompute[$expected]), "the walk reaches {$expected}");
}
foreach (['sources', 'feature_sources', 'map_features', 'political_territory', 'lore_entry',
    'wiki_entity_publication', 'wiki_publication_catalog', 'map_audit_log'] as $table) {
    foreach ($forbiddenStatements($table) as $statement) {
        foreach ($pubCompute as $name => $body) {
            assert(!str_contains($body, $statement), "{$name} runs in the COMPUTE half and writes: {$statement}");
        }
    }
}
// 🔴 Die eine Falle dieses Abgleichs: die Wunschliste des Schreibers ANTWORTET, indem sie den
// Quellenkatalog füllt.
assert(!isset($pubCompute['avesmapsPublicationDesiredLinksForEntity']),
    'the compute half must use the read-only probe, not the desired-list that upserts into `sources`');
assert(!isset($pubCompute['avesmapsFeatureSourceUpsert']));
assert(!isset($pubCompute['avesmapsFeatureSourceLink']));
assert(!isset($pubCompute['avesmapsPublicationReconcileEntity']));

$pubApply = $reachFrom($bodies, ['avesmapsPublicationApplyStep']);
assert(isset($pubApply['avesmapsPublicationReconcileEntityWrites']), 'die Ausführ-Hälfte ruft den Schreiber');
assert(array_filter($pubApply, static fn(string $b): bool
    => str_contains($b, 'DELETE FROM feature_sources')) !== [],
    'und sie enthält den Löscher -- sonst prüft der Lauf oben nichts');
```

- [ ] **Step 2: Rot sehen**

- [ ] **Step 3: `api/_internal/wiki/publication-plan-apply.php` schreiben**

Aufbau wie `citymap-plan-apply.php`. Je Zeile:
1. `entity_key` in `(type, wikiKey)` zerlegen (`explode('|', $key, 2)`), `entity_public_id` aus der
   Zeile.
2. 💣 **Der Staging-Riegel wird noch einmal gefragt** (`avesmapsPublicationStagingHasEntityType`):
   wurde das Staging zwischen Vorschau und Übernahme geleert („Dump holen" neu gestartet), heißt
   „keine Wunschliste" wieder „ich weiß nichts", nicht „es gibt nichts" — ⇒ `stale`,
   `apply_note='Der Zwischenspeicher kennt diesen Typ gerade nicht.'`. Ohne diese zweite Frage wäre
   die Vorschau der Weg, auf dem die Totallöschung doch noch passiert.
3. Neu rechnen (`avesmapsPublicationPlanForEntity`) und gegen `after_json` halten ⇒ abweichend
   `stale`.
4. Sonst `avesmapsPublicationReconcileEntity($pdo, $type, $publicId, $wikiKey, $userId)`
   (unverändert, eigene Transaktion je Einheit) ⇒ `applied`.

`avesmapsPublicationApplyFinish`: Skip/ClearSkip wie gehabt, `avesmapsSyncPlanMarkApplied`,
`avesmapsWikiSyncNextMapRevision($pdo)` (die Quellen reisen im Kartenpayload — **hier** gehört der
ETag-Sprung hin, denn hier wurde geschrieben), eine Protokollzeile
`avesmapsLogSyncPlanApply($pdo, 'publication', …)`.

Budget: `AVESMAPS_PUBLICATION_RECONCILE_STEP_BUDGET` (150) statt der 40 des Fundaments — dieselbe
Zahl, mit der dieser Abgleich heute schon läuft.

- [ ] **Step 4: Endpunkt + Ketten-Test**

`api/edit/wiki/sync-plan.php`: `AVESMAPS_SYNC_PLAN_KINDS` += `'publication'`, `match`-Arm,
`require_once …/publication-plan-apply.php`. In `sync-plan-endpoint-chain-test.php` die Datei in
`$applyFiles` aufnehmen.

- [ ] **Step 5: `reconcile-transaction-test.php`** — `$callerFiles` += `publication-plan-apply.php`.

- [ ] **Step 6: Alle Tests grün.**

- [ ] **Step 7: Mutation** — den zweiten Staging-Riegel aus der Ausführ-Hälfte entfernen und einen
Test dafür schreiben, der ihn verlangt (leeres `wiki_entity_publication` ⇒ die Zeile wird `stale`,
nicht ausgeführt). Erst rot, dann grün, dann Riegel zurück.

---

## Task 7 — „Dump holen" endet in einer Vorschau

**Files:**
- Modify: `api/edit/wiki/dump.php` (`sync_publications`)
- Modify: `js/review/review-wiki-sync.js` (`runWikiSyncPublicationsSyncLoop`,
  `renderWikiSyncPublicationsProgress`, `startWikiSyncDumpRead`, der Dump-Report-Abschnitt)
- Modify: `js/review/sync-plan-sheet.js`, `js/review/__tests__/sync-plan-sheet.test.js`

- [ ] **Step 1: `sync_publications` umhängen**

`avesmapsPublicationReconcileStep` → `avesmapsPublicationPlanStep`. Antwort: `'stage' => 'plan'`,
`segment`, `cursor`, `done`, `run_id`, `planned`, `counts`, `processed`, `skipped_types`, `no_link`,
`progress`. Die drei `links_*`-Zähler entfallen. Kommentarblock umschreiben: **dieser Schritt schreibt
nicht mehr**, und die zweite Tür (die Phase) bleibt scharf — mit Verweis auf Sitzung 3.

- [ ] **Step 2: Das Bauteil um die Art erweitern**

`SYNC_PLAN_KIND_TITLES.publication = "Publikationsquellen aus dem Wiki übernehmen"`,
`SYNC_PLAN_KIND_NOUNS.publication = { one: "Quellenverweis", many: "Quellenverweise" }`,
`SYNC_PLAN_KIND_DELETION.publication = null`, Feldbeschriftungen `sources` → „Quellenverweise",
`sources_removed` → „Quellenverweise entfallen". Test in `sync-plan-sheet.test.js` um `"publication"`
in der Arten-Schleife erweitern.

- [ ] **Step 3: Die Schleife und der Abschluss von „Dump holen"**

`runWikiSyncPublicationsSyncLoop` summiert `planned`/`processed` statt `links_*`;
`renderWikiSyncPublicationsProgress` sagt „Quellen werden verglichen … Segment 3/5 (N geprüft)".
In `startWikiSyncDumpRead` wird Schritt 4/4 zu:

```js
// Step 4/4: rechnen, was die Publikationsquellen dieses Dumps ändern würden. 🔴 SEIT 2026-08-06
// SCHREIBT DIESER SCHRITT NICHTS: er legt einen Plan ab, und die Vorschau darunter entscheidet.
setWikiSyncDumpButtonsDisabled(true, "Vergleicht Publikationsquellen...");
```

und der Abschlusstext zu „`Dump geholt · ${total} Quellen-Unterschiede — Vorschau offen`" bzw.
„Dump geholt · keine Unterschiede bei den Quellen." Der `window.confirm`-Text am Anfang verliert sein
Versprechen „übernimmt danach die Publikationsquellen scharf" und sagt stattdessen: „… und zeigt
danach, was sich bei den Quellen ändern würde."
`dumpReportDraft.steps.sync_publications` trägt `planned`/`counts` statt `added/updated/removed`; die
Stelle, die das rendert (`review-wiki-sync.js:1266`), wird mitgezogen und sagt „N Unterschiede
(x neu, y geändert)".
⚠️ Die Vorschau wird **vor** dem Dump-Report-Fenster geöffnet, sonst liegt sie dahinter — und wenn
`counts.total === 0`, wird sie **nicht** geöffnet (ein leeres Blatt nach zehn Minuten Arbeit ist
Lärm; die Statuszeile sagt es).

- [ ] **Step 4: `dump-report-test.php` prüfen** — er darf nicht auf `links_added` in
`steps.sync_publications` bestehen. Falls doch: die Erwartung auf die neuen Schlüssel umstellen (und
den Grund in einem Kommentar nennen).

- [ ] **Step 5: Alle Tests grün + die Sonde erweitern** (`verify-sync-plan-sheet.html`, nicht
committen).

---

## Task 8 — Abschluss Commit B

- [ ] **Step 1: Volle Suite** (die zwei Befehle aus Task 4 Step 1).
- [ ] **Step 2: `git status`, nur eigene Pfade stagen.**
- [ ] **Step 3: Commit** (`-F`), Betreff:

```
feat(sync): der Publikationsquellen-Abgleich zeigt erst, was er tun wuerde -- "Dump holen" endet in der Vorschau
```

- [ ] **Step 4: Push, 2–4 Minuten, live gegenprüfen**
- Remote-SHA; `POST /api/edit/wiki/sync-plan.php` anonym ⇒ 401; `GET` ⇒ 405.
- `GET /api/app/feature-sources.php?entity_type=settlement&entity_public_id=…` ⇒ 200 (ein
  read-only-Beleg, dass die Quellen unangetastet sind), `GET /api/app/map-features.php` ⇒ 200 mit
  **unverändertem** ETag.
- **Kein** „Dump holen".

---

# COMMIT C — Vorkommen

## Task 9 — Den Schreiber aus der Schleife heben

**Files:**
- Create: `api/_internal/wiki/lore-plan-apply.php`
- Modify: `api/_internal/wiki/lore-sync.php`
- Test: `api/_internal/wiki/__tests__/lore-retire-parity-test.php`

**Interfaces:**
- Produces:
  - `avesmapsLoreApplyStatements(PDO $pdo): array` (die je Schritt **einmal** vorbereiteten Statements)
  - `avesmapsLoreApplyEntity(PDO $pdo, array $staged, array $statements, bool $sourceStagingReady, int $userId): array`
  - `avesmapsLoreRetireWikiEntry(PDO $pdo, string $wikiKey): bool`

- [ ] **Step 1: Den Paritäts-Test schreiben**

`api/_internal/wiki/__tests__/lore-retire-parity-test.php`:

```php
<?php
declare(strict_types=1);
/**
 * Der Einzel-Stilleger trägt dieselben Riegel wie der Sammel-Sweep, den er ersetzt.
 *
 * Der alte Abschluss-Sweep war EINE mengenbasierte Anweisung mit drei Bedingungen:
 *   origin='wiki' AND status='active' AND wiki_key NOT IN (<Katalog>)
 * Aus der Menge wird jetzt eine Auswahl, die ein Mensch trifft -- die drei Bedingungen bleiben,
 * nur die letzte wandert in die Vorschau (avesmapsLoreRetirableRows). Fällt eine der beiden
 * anderen weg, legt eine Übernahme eine von Hand angelegte oder längst stillgelegte Zeile still.
 */
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL\n"); exit(2); }
$source = (string) file_get_contents(__DIR__ . '/../lore-plan-apply.php');
assert(preg_match('/function avesmapsLoreRetireWikiEntry\(PDO \$pdo, string \$wikiKey\): bool/', $source) === 1);
$body = substr($source, (int) strpos($source, 'function avesmapsLoreRetireWikiEntry'));
$body = substr($body, 0, (int) strpos($body, "\n}\n") + 2);

assert(str_contains($body, "status = 'retired'"), 'es wird stillgelegt');
assert(!str_contains($body, 'DELETE'), '🔴 und NICHT gelöscht -- ein Eintrag kann in Ortslisten stecken');
assert(str_contains($body, "origin = 'wiki'"), 'nur Wiki-Zeilen');
assert(str_contains($body, "status = 'active'"), 'und nur aktive');
assert(str_contains($body, 'rowCount()'), 'und der Riegel wird ausgewertet, nicht nur geschrieben');

// Gegenprobe: die Rechen-Hälfte legt nichts still.
$plan = (string) file_get_contents(__DIR__ . '/../lore-sync.php');
assert(!str_contains($plan, "SET status = 'retired'"), 'die Rechen-Hälfte legt nichts still');

echo "lore-retire-parity ok\n";
```

- [ ] **Step 2: Rot sehen** (die Datei fehlt).

- [ ] **Step 3: Den Schreibrumpf verschieben — wörtlich**

`api/_internal/wiki/lore-plan-apply.php` anlegen. Der Rumpf von `avesmapsLoreApplyEntity` ist der
Schleifenkörper von `avesmapsLoreReconcileStep` (`lore-sync.php:634–744`) **wörtlich**, mit genau
diesen Eingriffen:
- die `if (!$dryRun)`-Schalen fallen weg (der Probelauf war die arme Fassung genau dieser Vorschau;
  `avesmapsLoreReconcileStep` war sein einziger Aufrufer, und die Rechen-Hälfte ersetzt ihn),
- die vier vorbereiteten Statements kommen als `$statements` herein, nicht aus dem Verschluss.
  💣 Sie werden weiterhin **einmal je Schritt** vorbereitet (`avesmapsLoreApplyStatements`), nicht je
  Eintrag: der Kommentar an ihrer alten Stelle nennt den Grund (bei ~7.750 Orten ist ein `prepare()`
  in der Schleife ein spürbares Eigentor), und der gilt unverändert,
- die deutschen Kommentare ziehen **mit um** (AGENTS.md §8: in der Nachbarsprache bleiben),
- `$stats` wird ein Rückgabewert je Eintrag statt eines Akkumulators.

`avesmapsLoreRetireWikiEntry`:

```php
/**
 * Retire ONE wiki entry the wiki no longer lists. Returns false when the guard refused.
 *
 * 💣 A TOMBSTONE, NOT A DELETION, and the preview says so: the entry keeps its places, its sources
 * and its wiki_key, and the very next sync revives it (avesmapsLoreApplyEntity writes
 * status = CASE WHEN status='retired' THEN 'active' ELSE status END). An entry can be referenced
 * from place and source lists, and a silent total loss would be worse than a dead file card.
 */
function avesmapsLoreRetireWikiEntry(PDO $pdo, string $wikiKey): bool
{
    $stmt = $pdo->prepare(
        'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . " SET status = 'retired'
          WHERE wiki_key = :wk AND origin = 'wiki' AND status = 'active'"
    );
    $stmt->execute(['wk' => $wikiKey]);

    return $stmt->rowCount() > 0;
}
```

- [ ] **Step 4: Grün sehen** — `lore-retire-parity-test.php`, `lore-sync-test.php` (prüft nur die
reinen Funktionen und muss grün bleiben), `php -l` auf beide Dateien.

- [ ] **Step 5: Mutation** — im Einzel-Stilleger `AND origin = 'wiki'` entfernen → der Paritäts-Test
MUSS rot werden. Zurücknehmen.

---

## Task 10 — Die Rechen-Hälfte für Vorkommen

**Files:**
- Modify: `api/_internal/wiki/lore-sync.php`
- Test: `api/_internal/wiki/__tests__/lore-plan-test.php`

**Interfaces:**
- Produces:
  - `avesmapsLorePlanItem(?array $current, array $desired, array $fieldOrigins, array $placePlan, array $sourceDiff): ?array` *(PURE)*
  - `avesmapsLorePlanStagingEmpty(array $stagedRows, string $cursor): bool` *(PURE)* — der Leerkatalog-Riegel als eigene Entscheidung, damit er prüfbar ist
  - `avesmapsLorePlanForCatalogRow(PDO $pdo, array $staged, bool $sourceStagingReady): array`
  - `avesmapsLoreRetirableRows(PDO $pdo, array $declinedKeys): array` — je Zeile
    `['wiki_key','name','kind','place_count','source_count']`
  - `avesmapsLoreLastStaged(PDO $pdo): ?string`
  - `avesmapsLorePlanStep(PDO $pdo, string $cursor, int $userId): array`
    → `{done, nextCursor, run_id, planned, processed, counts, staging_empty, sources_staging_empty}`

- [ ] **Step 1: Den Test schreiben**

`api/_internal/wiki/__tests__/lore-plan-test.php`, Teil 1 (rein):

```php
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../lore-sync.php';

$desired = ['kind' => 'flora', 'wiki_title' => 'Wirselkraut', 'wiki_url' => 'https://wiki/W',
    'name' => 'Wirselkraut', 'gruppe' => 'Heilpflanze', 'typ' => 'Kraut',
    'lebensraum' => 'Wälder', 'synonyme' => '', 'merkmale_json' => '{"a":1}', 'continent' => 'Aventurien'];
$leerePlaetze = ['add' => [], 'remove' => [], 'kept' => 0, 'suppressed' => 0];
$leereQuellen = ['add' => 0, 'update' => 0, 'remove' => 0, 'add_titles' => [], 'remove_titles' => []];

// Neu / nichts zu tun / geändert -- wie bei den Abenteuern.
$item = avesmapsLorePlanItem(null, $desired, [], ['add' => [1, 2], 'remove' => [], 'kept' => 0, 'suppressed' => 0], $leereQuellen);
assert($item['change_type'] === 'new' && $item['after']['occurrences'] === '2 neu');
assert(avesmapsLorePlanItem($desired, $desired, [], $leerePlaetze, $leereQuellen) === null);

// 💣 merkmale_json ist ein JSON-Klumpen und gehört nicht in eine Zeile: die Vorschau sagt, DASS es
// sich ändert, nicht wie. Sonst ist die Zeile 800 Zeichen breit und niemand liest die daneben.
$alt = $desired;
$alt['merkmale_json'] = '{"a":2}';
$item = avesmapsLorePlanItem($alt, $desired, [], $leerePlaetze, $leereQuellen);
assert($item['after']['merkmale_json'] === 'geändert' && $item['before']['merkmale_json'] === 'anders');

// Der Verlust hat sein eigenes Feld, getrennt vom Zugewinn.
$item = avesmapsLorePlanItem($desired, $desired, [], ['add' => [], 'remove' => [1, 2, 3, 4], 'kept' => 1, 'suppressed' => 0], $leereQuellen);
assert($item['after']['occurrences_removed'] === 4 && !isset($item['after']['occurrences']));

// Die Quellen reisen mit (der Reconcile ruft je Eintrag den geteilten Publikations-Abgleich).
$item = avesmapsLorePlanItem($desired, $desired, [], $leerePlaetze,
    ['add' => 2, 'update' => 0, 'remove' => 1, 'add_titles' => ['Bote 42'], 'remove_titles' => ['Alt']]);
assert(str_contains((string) $item['after']['sources'], '2 neu') && $item['after']['sources_removed'] === 1);
```

Teil 2 — der Leerkatalog-Riegel. ⚠️ **Nicht** über `avesmapsLorePlanStep` unter sqlite: der Schritt
ruft als erstes `avesmapsEnsureSyncPlanTables`, und dessen MySQL-DDL (`INT AUTO_INCREMENT`,
`ENGINE=InnoDB`) wirft unter sqlite. Genau deshalb prüft auch Sitzung 1 ihren Schritt nicht direkt.
Also: die **Entscheidung** als reine Funktion, plus eine Zusicherung über die **Reihenfolge** im
Rumpf — „vorhanden" ist nicht „läuft vorher" (die Lehre aus `1b450f70`).

```php
// --- 💣 Leerer Katalog, cursor am Anfang: aussteigen, und zwar VOR dem Lauf -----------------------
// Der alte Schritt stieg bei leerem Staging aus, bevor er den Abschluss-Sweep erreichte
// (lore-sync.php: `$staged === [] && $cursor === ''` -> `done=true, staging_empty=true`). Dieselbe
// Stelle, ein zweiter Grund: eröffnete die Rechen-Hälfte hier einen Lauf, setzte StartRun den offenen
// Plan auf 'superseded' -- die Arbeit eines anderen Editors, weggeräumt von einem Klick, der nichts
// finden konnte. Und ein Katalog ist leer, weil „Dump holen" nicht lief, nie weil das Wiki alles
// vergessen hat.
assert(avesmapsLorePlanStagingEmpty([], '') === true);
assert(avesmapsLorePlanStagingEmpty([], 'wirselkraut') === false,
    'mitten im Lauf ist ein leeres Fenster das ENDE des Katalogs, nicht ein leerer Katalog');
assert(avesmapsLorePlanStagingEmpty([['wiki_key' => 'w']], '') === false);

// Und der Ausstieg steht im Rumpf VOR dem Eröffnen des Laufs. Ohne diese Zusicherung wäre die reine
// Funktion oben grün und der Plan trotzdem gelöscht.
$stepBody = (string) file_get_contents(__DIR__ . '/../lore-sync.php');
$stepAt = (int) strpos($stepBody, 'function avesmapsLorePlanStep');
$guardAt = (int) strpos($stepBody, 'avesmapsLorePlanStagingEmpty(', $stepAt);
$startAt = (int) strpos($stepBody, 'avesmapsSyncPlanStartRun(', $stepAt);
assert($guardAt > 0 && $startAt > 0 && $guardAt < $startAt,
    '🔴 der Leerkatalog-Riegel steht vor avesmapsSyncPlanStartRun');
```

Teil 3 (sqlite) — die Stilllegungszeilen. `avesmapsLoreRetirableRows` ruft **keine** DDL (Bedingung
für diesen Test — und ohnehin richtig: es ist eine Lesefunktion):

```php
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE wiki_lore_catalog (wiki_key TEXT PRIMARY KEY, name TEXT)');
$pdo->exec('CREATE TABLE lore_entry (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, kind TEXT,
    name TEXT, origin TEXT, status TEXT)');
$pdo->exec('CREATE TABLE lore_place (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_wiki_key TEXT,
    place_wiki_key TEXT, relation TEXT, origin TEXT, status TEXT)');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT,
    entity_public_id TEXT, source_id INT, origin TEXT, status TEXT)');
foreach (['wirselkraut', 'donf', 'tarnele'] as $key) {
    $pdo->prepare("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
        VALUES (?, 'flora', ?, 'wiki', 'active')")->execute([$key, ucfirst($key)]);
}
// Handarbeit und eine längst stillgelegte Zeile: keine von beiden darf je auftauchen.
$pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
    VALUES ('eigenes-kraut', 'flora', 'Eigenes Kraut', 'manual', 'active')");
$pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, origin, status)
    VALUES ('altes-kraut', 'flora', 'Altes Kraut', 'wiki', 'retired')");
$pdo->exec("INSERT INTO lore_place (entry_wiki_key, place_wiki_key, relation, origin, status)
    VALUES ('donf', 'weiden', 'verbreitung', 'wiki', 'active')");
// Der Katalog kennt nur noch eines der drei.
$pdo->exec("INSERT INTO wiki_lore_catalog (wiki_key, name) VALUES ('tarnele', 'Tarnele')");

$zeilen = avesmapsLoreRetirableRows($pdo, []);
assert(count($zeilen) === 2, 'zwei verschwundene Wiki-Einträge -- und nur die');
$keys = array_map(static fn(array $r): string => $r['wiki_key'], $zeilen);
assert(!in_array('eigenes-kraut', $keys, true), 'Handarbeit wird nie stillgelegt');
assert(!in_array('altes-kraut', $keys, true), 'und was schon liegt, wird nicht zweimal gefragt');

// --- 💣 Der Behalten-Riegel (Entwurf §2/§8) ------------------------------------------------------
$zeilen = avesmapsLoreRetirableRows($pdo, ['wirselkraut']);
assert(count($zeilen) === 1 && $zeilen[0]['wiki_key'] === 'donf');
// ... und der behaltene Eintrag bleibt ein WIKI-Eintrag und läuft weiter mit: kein origin='manual'.
assert((string) $pdo->query("SELECT origin FROM lore_entry WHERE wiki_key='wirselkraut'")->fetchColumn() === 'wiki');
assert((string) $pdo->query("SELECT status FROM lore_entry WHERE wiki_key='wirselkraut'")->fetchColumn() === 'active');

// --- Die Zahlen an der Zeile sagen, was ERHALTEN bleibt ------------------------------------------
// Bei einer Löschung nennt die Zeile den Verlust; hier nennt sie das Gegenteil, und das ist der
// ganze Unterschied zwischen einem Grabstein und einer Löschung.
assert($zeilen[0]['place_count'] === 1 && $zeilen[0]['source_count'] === 0);

echo "lore-plan ok\n";
```

- [ ] **Step 2: Rot sehen.**

- [ ] **Step 3: `avesmapsLorePlanItem` schreiben (rein)**, Regeln wie bei den Abenteuern, plus:
`merkmale_json` wird nie im Klartext gezeigt (`after` → `'geändert'`, `before` → `'anders'`);
`occurrences`/`occurrences_removed` aus `avesmapsLoreChildPlan`; `sources`/`sources_removed` aus dem
Diff der Sonde aus Commit B; `suppressed > 0` → `override['occurrences'] = "N unterdrückte bleiben unterdrückt"`
(ein Grabstein ist genau der Fall, in dem eine Vorschau sonst behauptet, das Wiki würde etwas
anlegen, was es nie tun wird).

- [ ] **Step 4: `avesmapsLorePlanForCatalogRow` schreiben** — liest den Eintrag, die Orte, das
Orts-Staging, ruft `avesmapsLoreFieldPlan` + `avesmapsLoreChildPlan` + (nur wenn
`$sourceStagingReady`) `avesmapsPublicationLinkDiffForPlan($pdo, 'lore', $wikiKey, $wikiKey)`.
⚠️ Der Eintragsschlüssel ist zugleich die public id — genau wie im Schreiber.

- [ ] **Step 5: `avesmapsLoreRetirableRows` + `avesmapsLoreLastStaged` schreiben.**
`RetirableRows`: dieselben drei Bedingungen wie der alte Sweep, plus `$declinedKeys` heraus, plus die
Kinderzahlen in **zwei** gruppierten Abfragen über die `IN (…)`-Menge (nicht einer je Eintrag).
Fehlende Tabellen ⇒ leere Zahlen, nie ein Fehlschlag.

- [ ] **Step 6: `avesmapsLorePlanStep` schreiben** — Rumpf aus `avesmapsLoreReconcileStep`, mit:
- dem **Leerkatalog-Ausstieg VOR** `avesmapsSyncPlanStartRun` (Step 1 Teil 2), formuliert als
  `if (avesmapsLorePlanStagingEmpty($staged, $cursor)) { return [… 'done' => true, 'staging_empty' => true,
  'run_id' => 0, 'planned' => 0, 'counts' => ['new'=>0,'changed'=>0,'deleted'=>0,'total'=>0]]; }`
  — die reine Funktion ist `$stagedRows === [] && $cursor === ''`, wörtlich die Bedingung von heute,
- `avesmapsSyncPlanDecisions($pdo, 'lore')` einmal je Schritt,
- `sourceStagingReady` einmal je Schritt (wörtlich mit dem alten Kommentar),
- Stilllegungszeilen bei `$done` (`change_type='deleted'`, `before` = `place_count`/`source_count`),
- `avesmapsSyncPlanFinishBuild`.

`avesmapsLoreReconcileStep` **löschen**.

- [ ] **Step 7: Grün sehen** (`lore-plan-test.php`, `lore-sync-test.php`, `php -l`).

- [ ] **Step 8: Mutation** — den Leerkatalog-Ausstieg **nach** `avesmapsSyncPlanStartRun` verschieben
→ der Test MUSS rot werden („der Leerkatalog-Riegel steht vor avesmapsSyncPlanStartRun"). Zurücknehmen.
Dann in `avesmapsLoreRetirableRows` die Bedingung `status = 'active'` entfernen → rot („was schon
liegt, wird nicht zweimal gefragt"). Zurücknehmen.

---

## Task 11 — Ausführ-Hälfte, Endpunkt, Oberfläche für Vorkommen

**Files:**
- Modify: `api/_internal/wiki/lore-plan-apply.php`, `api/edit/wiki/sync-plan.php`,
  `api/edit/wiki/dump.php`
- Modify: `js/review/sync-plan-sheet.js`, `js/review/review-wiki-sync.js`
- Modify: `api/_internal/wiki/__tests__/sync-plan-purity-test.php`,
  `…/reconcile-transaction-test.php`, `…/sync-plan-endpoint-chain-test.php`,
  `js/review/__tests__/sync-plan-sheet.test.js`

- [ ] **Step 1: Die Reinheits-Zusicherung erweitern**

```php
// ============================== VORKOMMEN (Sitzung 2) =============================================
$loreCompute = $reachFrom($bodies, ['avesmapsLorePlanStep']);
assert(count($loreCompute) >= 8, 'der Lauf erreicht die aufgerufenen Funktionen');
foreach (['avesmapsLorePlanForCatalogRow', 'avesmapsLorePlanItem', 'avesmapsLoreRetirableRows',
    'avesmapsLoreFieldPlan', 'avesmapsLoreChildPlan', 'avesmapsPublicationLinkDiffForPlan'] as $expected) {
    assert(isset($loreCompute[$expected]), "the walk reaches {$expected}");
}
foreach (['lore_entry', 'lore_place', 'feature_sources', 'sources', 'wiki_lore_catalog',
    'wiki_lore_place_staging', 'map_audit_log'] as $table) {
    foreach ($forbiddenStatements($table) as $statement) {
        foreach ($loreCompute as $name => $body) {
            assert(!str_contains($body, $statement), "{$name} runs in the COMPUTE half and writes: {$statement}");
        }
    }
}
// 🔴 Der Stilleger ist eine Handlung, kein Nebeneffekt des Rechnens -- und die Quellen erst recht.
assert(!isset($loreCompute['avesmapsLoreRetireWikiEntry']),
    'the compute half only PROPOSES the tombstone');
assert(!isset($loreCompute['avesmapsLoreApplyEntity']));
assert(!isset($loreCompute['avesmapsPublicationReconcileEntity']));
foreach ($loreCompute as $name => $body) {
    assert(!str_contains($body, "SET status = 'retired'"), "{$name} retires an entry in the compute half");
}

$loreApply = $reachFrom($bodies, ['avesmapsLoreApplyStep']);
assert(isset($loreApply['avesmapsLoreApplyEntity']) && isset($loreApply['avesmapsLoreRetireWikiEntry']));
assert(array_filter($loreApply, static fn(string $b): bool
    => str_contains($b, "SET status = 'retired'")) !== [],
    'die Ausführ-Hälfte enthält den Stilleger -- sonst prüft der Lauf oben nichts');
```

- [ ] **Step 2: Rot sehen, dann `avesmapsLoreApplyStep` + `…ApplyFinish` schreiben**

Wie `citymap-plan-apply.php`, Budget `AVESMAPS_LORE_RECONCILE_BATCH` (150):
- `change_type='deleted'`: prüfen, dass der `wiki_key` weiterhin **nicht** im Staging steht, der
  Eintrag weiterhin `origin='wiki' AND status='active'` ist und die Stilllegung nicht inzwischen
  abgelehnt wurde — sonst `stale` mit deutschem Grund. Dann `avesmapsLoreRetireWikiEntry`.
- `new`/`changed`: Staging-Zeile per `wiki_key` lesen (weg ⇒ `stale`), neu rechnen und gegen
  `after_json` halten (⇒ `stale`), sonst `avesmapsLoreApplyEntity(...)`.
  ⚠️ `sourceStagingReady` wird **hier erneut** gefragt (derselbe Grund wie bei den Publikationen).
- `ApplyFinish`: Skip/Decline/ClearSkip, `MarkApplied`,
  `avesmapsAppSettingSet(AVESMAPS_LORE_LAST_SYNCED_SETTING, …)` — **erst hier**, denn erst hier wurde
  geschrieben; der alte Kommentar sagt genau das („ein Zeitstempel nach einem Probelauf wäre eine
  stille Lüge") —, `avesmapsWikiSyncNextMapRevision`, **eine** Protokollzeile mit
  `deleted_titles` = den stillgelegten Namen (Verb „stillgelegt", Task 2 Step 4).

- [ ] **Step 3: Endpunkt** — `AVESMAPS_SYNC_PLAN_KINDS` += `'lore'`, `match`-Arm,
require-Kette (`_internal/wiki/lore-sync.php`, `_internal/wiki/lore-plan-apply.php`; `sync-monitor.php`
für `avesmapsLoreWikiKeyForTitle` prüfen — der Ketten-Test sagt es), `$applyFiles` und
`$callerFiles` erweitern.

- [ ] **Step 4: `sync_lore` umhängen** — `avesmapsLoreReconcileStep($pdo, $cursor, false, $uid)` →
`avesmapsLorePlanStep($pdo, $cursor, $uid)`; Antwort `'stage' => 'plan'` + `run_id`/`planned`/`counts`
+ `staging_empty` + `sources_staging_empty` (die zwei Zustände bleiben, der Client nennt sie).
Kommentarblock umschreiben.

- [ ] **Step 5: Bauteil + Test**

`SYNC_PLAN_KIND_TITLES.lore = "Vorkommen aus dem Wiki übernehmen"`,
`SYNC_PLAN_KIND_NOUNS.lore = { one: "Eintrag", many: "Einträge" }`, und:

```js
	// 💣 Der Grabstein sagt, was er ist. „Löschen" wäre hier falsch und teuer falsch: der Eintrag
	// bleibt samt Vorkommen und Quellen stehen, und nennt das Wiki ihn wieder, wird er von selbst
	// wieder aktiv. Eine Warnung, die mehr behauptet, als passiert, wird beim zweiten Mal weggeklickt
	// — und dann auch bei den Karten, wo sie stimmt (Entwurf §7).
	lore: {
		hint: "im Wiki nicht mehr da · wird <b>stillgelegt</b>, nicht gelöscht",
		lead: 'Angehäkelt wird der Eintrag <b>stillgelegt</b>: er verschwindet aus den Listen, bleibt '
			+ 'aber samt seiner Vorkommen und Quellen erhalten — und nennt das Wiki ihn wieder, wird er '
			+ 'ohne Zutun wieder aktiv. Was du <b>nicht</b> anhäkelst, bleibt aktiv; es wird nicht wieder gefragt.',
		verb: "stilllegen",
	},
```

`syncPlanFooterState` bekommt aus derselben Tabelle das **Verb**: `gateText` und `applyLabel` sagen
bei `lore` „stilllegen" statt „löschen" (`Ja, 46 Einträge wirklich stilllegen.` /
`Übernehmen und 46 stilllegen`) — und ohne `verb` bleibt es bei „löschen".
Feldbeschriftungen: `kind`→Art, `wiki_title`→Wiki-Titel, `wiki_url`→Wiki-URL, `name`→Name,
`gruppe`→Gruppe, `typ`→Typ, `lebensraum`→Lebensraum, `synonyme`→Synonyme, `merkmale_json`→Merkmale,
`continent`→Kontinent, `occurrences`→Vorkommen, `occurrences_removed`→Vorkommen entfallen.

Test in `sync-plan-sheet.test.js`:

```js
// 💣 Bei den Vorkommen wird stillgelegt, nicht gelöscht — und die zweite Bestätigung sagt genau das.
const loreGate = footer({ selected: 47, deletions: 46, confirmed: false, kind: "lore" });
assert.ok(loreGate.gateText.includes("stilllegen"), "die Bestätigung nennt die Handlung richtig");
assert.ok(!loreGate.gateText.includes("löschen"), "und nicht die falsche");
assert.strictEqual(loreGate.applyDisabled, true, "der Riegel gilt trotzdem: es ist eine Handlung");
assert.ok(footer({ selected: 2, deletions: 1, confirmed: true, kind: "citymap" }).gateText.includes("löschen"),
	"bei den Karten bleibt es beim Löschen");
```

- [ ] **Step 6: Die Schleife und der Auslöser**

`runWikiSyncLoreSyncLoop` summiert `planned`; `startWikiSyncLoreSync` sagt „N Unterschiede — Vorschau
offen" und öffnet das Blatt in `#wikiSyncPlanHost`. ⚠️ Der Auslöser `#wiki-sync-sync-lore` zieht beim
ersten Öffnen ins Menüband des Vorkommen-Fensters um (`moveLoreSectionIntoDialog`) — das Fenster liegt
in `index.html`, der Wirt also auch, und `--z-modal` bringt das Blatt darüber (Entscheidung 3). Der
`build_lore_staging`-Vorlauf bleibt unverändert.

- [ ] **Step 7: Alle Tests grün + Sonde erweitern** (hell/dunkel, mit Stilllegungsgruppe).

---

## Task 12 — Abschluss Commit C

- [ ] **Step 1: Volle Suite** (beide Befehle).
- [ ] **Step 2: `git status`, nur eigene Pfade stagen.**
- [ ] **Step 3: Commit** (`-F`), Betreff:

```
feat(sync): der Vorkommen-Abgleich zeigt erst, was er tun wuerde -- stillgelegt wird nur, was angehaekelt ist
```

- [ ] **Step 4: Push, 2–4 Minuten, live gegenprüfen**
- Remote-SHA; `POST /api/edit/wiki/sync-plan.php` anonym ⇒ 401 (mit `kind=lore` im Rumpf ⇒ trotzdem
  401, das Gate steht vor dem Rumpf); `GET` ⇒ 405.
- `GET /api/app/lore.php?limit=1` ⇒ 200 und **dieselbe** Anzahl aktiver Einträge wie vor dem Deploy
  (die Zahl vor dem Push notieren — das ist der Zahlenbeleg, dass keine Übernahme lief).
- `GET /api/app/map-features.php` ⇒ 200, ETag unverändert.
- **Kein** `sync_lore`, **kein** „Dump holen", **kein** `apply`.

- [ ] **Step 5: Den Entwurf und AGENTS.md nachziehen** (im letzten Commit, eine Zeile je Stelle):
`docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md` §7 — Sitzung 2 als **gebaut** markieren,
mit Datum und dem Verweis auf diesen Bauplan; AGENTS.md §11 — im Absatz „Die Übernahme-Vorschau" die
Aufzählung „Live seit 2026-08-06 für Stadtkarten (Sitzung 1); Abenteuer/Publikationen/Vorkommen (2)"
auf den neuen Stand bringen und Entscheidung 1 in einem Satz festhalten (💣 die dritte Kategorie
gehört dem Verschwinden einer Einheit; ein Kindzeilen-Verlust steht benannt in der Geändert-Zeile).

---

## Self-Review gegen den Entwurf

| Entwurf | Task |
|---|---|
| §2 drei Kategorien, Vorhäkeln, zweite Bestätigung | Fundament unverändert (Sitzung 1); 3/7/11 (je Art die Löschgruppe + das Verb) |
| §2 abgehäkelte Änderung kommt wieder, mit Zähler | 2/6/11 (`RecordSkip`/`ClearSkip` je Art) |
| §2 abgehäkelte Löschung = behalten, dauerhaft, **nicht** `manual` | 10 (Behalten-Riegel-Test: `origin` bleibt `wiki`, `status` bleibt `active`) |
| §2 „Später" schreibt nichts, Häkchen bleiben | Endpunkt unverändert (`select` schreibt sofort) |
| §4a Plan veraltet ⇒ Nachprüfung beim Übernehmen | 2/6/11 (je Ausführ-Hälfte, mit `PlanForCatalogRow` als gemeinsamer Rechnung) |
| §4b zwei Arten zu behalten trennen | 10 (Test), 3 (Grabstein-Text statt „gelöscht") |
| §4c ein leerer Katalog heißt nie „alles löschen" | 10 (Leerkatalog-Ausstieg **vor** dem Lauf), 5/6 (Staging-Riegel je Typ, zweimal gefragt) |
| §4d Wiederaufnahme bleibt | 1/5/10 (Cursor-Bauart wörtlich übernommen), 2/6/11 (`apply_state`) |
| §4e **eine** Protokollzeile je Lauf | 2 (Beschriftungen + Löschverb), je `ApplyFinish` |
| §4f STRATO: ein Abruf, serverseitig begrenzt | Endpunkt unverändert (200 je Kategorie); Entscheidungen + Staging-Frage einmal je Schritt |
| §5 `override_json` je Feld — „da, wo es Feld-Overrides gibt" | 1 (Abenteuer: `field_origins_json`), 10 (Vorkommen) |
| §6 zweiter Lauf ersetzt den offenen Plan | 1/5/10 (`StartRun` aus dem Cursor abgeleitet) |
| §7 Sitzung 2: dieselbe Mechanik, drei Mal nachgezogen | Commits A/B/C |
| §7 ⚠️ Vorkommen: die Löschung ist ein **Grabstein**, die Zeile sagt das | 3 (`SYNC_PLAN_KIND_DELETION.lore`), 9 (Kommentar am Stilleger), 11 (Verb + Test) |
| §8 die reinen Plan-Funktionen werden mit echten Zeilen geprüft | 1/5/10 |
| §8 in der Rechen-Hälfte kein Schreiben — am Quelltext geprüft | 2/6/11 (drei Wurzeln + drei Gegenproben in `sync-plan-purity-test.php`) |
| §8 jede Zusicherung durch Mutation belegt | 1·11, 2·7, 5·6, 9·5, 10·8 |
| §8 live nur read-only + Statuscodes | 4/8/12 |
| §9 kein Rückgängig, keine Häkchen je Feld, keine Sperre | nichts davon wird gebaut; `apply_sync_plan` bleibt nicht rückgängigfähig (Test aus Sitzung 1) |
| §10 200 je Kategorie, `edit` reicht | Endpunkt unverändert |
