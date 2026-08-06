# Übernahme-Vorschau, Sitzung 4 (Herrschaftsgebiete) — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Territorien-Abgleich schreibt nichts mehr ohne Häkchen — die Wiki-Kopie bekommt an
„🚨 Syncen" eine Vorschau, die Karte an „3 · Übernehmen", und aus „Daten übernehmen" + „Modell
übernehmen" wird ein Knopf.

**Architecture:** Zwei neue Arten (`territory_wiki`, `territory`) am vorhandenen Vorschau-Endpunkt
`api/edit/wiki/sync-plan.php`. Je Art eine **Rechen-Hälfte**, die in keine Nutztabelle schreibt, und
eine **Ausführ-Hälfte**, die die *unveränderten* Schreiber ruft. Die Oberfläche ist das vorhandene
Bauteil `js/review/sync-plan-sheet.js`, in `html/wiki-sync-monitor.html` als gewöhnliches
`<script src>` geladen.

**Tech Stack:** PHP 8 (strict types) + PDO/MySQL, Vanilla-JS ohne Build, `assert()`-Tests unter
`__tests__/`, sqlite für die SQL-Riegel.

**Entwurf:** [`docs/superpowers/specs/2026-08-06-sync-uebernahme-territorien-design.md`](../specs/2026-08-06-sync-uebernahme-territorien-design.md) ·
**Mockup:** [`docs/sync-uebernahme-territorien-mockup.html`](../../sync-uebernahme-territorien-mockup.html) ·
**Übergeordnet:** [`2026-08-06-sync-uebernahme-design.md`](../specs/2026-08-06-sync-uebernahme-design.md)

## Global Constraints

- **Kein Dump, kein Sync, kein Massenlauf.** Auf STRATO nichts in einer Schleife abfragen; eine Sonde
  ist eine Sonde. Live geprüft wird nur: Endpunkt antwortet **401** statt 500, öffentliche Lesewege 200.
- **Oberflächentexte deutsch, Kommentare/Commits englisch** (AGENTS.md §8/§9). Die `error.code`-Werte
  bleiben englisch.
- **Keine hartkodierten Farben/Radien/Trenner** — nur Tokens aus `css/base/tokens.css` (AGENTS.md §12).
- **Gemeinsamer Arbeitsbaum: nie `git add -A`.** Nur die in der Aufgabe genannten Pfade einzeln stagen.
- **Testbefehl PHP:** `php -d zend.assertions=1 -d assert.exception=1 <datei>` — ohne das Flag ist
  `assert()` ein No-op und der Test beweist nichts.
- **Testbefehl JS:** `node <datei>`.
- 🔴 **Die Rechen-Hälften schreiben in KEINE Nutztabelle** (`political_territory`,
  `political_territory_wiki`, `political_territory_geometry`, `wiki_territory_model`). Nur
  `sync_plan_run` / `sync_plan_item` / `sync_decision`.
- 🔴 **Kein Aufruf ins Außengrenzen-System.** Die Übernahme setzt `parent_id` und Datenfelder, sonst
  nichts. Der Hinweis in der Zeile ist Text.
- **Kein DDL auf einem Lesepfad.** `get` darf keine Tabelle anlegen; eine fehlende Tabelle heißt
  „noch kein Plan".
- **`ASSET_VERSION` ist NICHT betroffen** — das gehört dem eingebetteten Politik-Editor.
  `html/wiki-sync-monitor.html` wird per `?v=Date.now()` geladen, seine `<script src>` stempelt der Deploy.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `js/review/sync-plan-sheet.js` (ändern) | zwei Arten anmelden, Warnblock, „Werte festhalten"-Naht |
| `css/components/sync-plan-sheet.css` (ändern) | eine Regel für den Warnblock |
| `api/_internal/wiki/sync-monitor-model.php` (ändern) | positive Auswahl (`only`) an den zwei Bulk-Schreibern |
| `api/_internal/wiki/territory-wiki-plan.php` (neu) | Rechen-Hälfte der Wiki-Kopie |
| `api/_internal/wiki/territory-wiki-plan-apply.php` (neu) | Ausführ-Hälfte der Wiki-Kopie |
| `api/_internal/wiki/territory-plan.php` (neu) | Rechen-Hälfte der Karte |
| `api/_internal/wiki/territory-plan-apply.php` (neu) | Ausführ-Hälfte der Karte |
| `api/edit/wiki/sync-plan.php` (ändern) | zwei Arten, zwei Ausführ-Arme, require-Kette |
| `api/edit/wiki/sync-monitor.php` (ändern) | zwei Rechen-Aktionen |
| `api/_internal/map/collection-audit.php` (ändern) | zwei Protokoll-Beschriftungen |
| `html/wiki-sync-monitor.html` (ändern) | Menüband, Statuszeile, Aufhänger, Verdrahtung |

---

## Task 1: Das Bauteil kennt die zwei neuen Arten

**Files:**
- Modify: `js/review/sync-plan-sheet.js`
- Modify: `css/components/sync-plan-sheet.css`
- Test: `js/review/__tests__/sync-plan-sheet.test.js`

**Interfaces:**
- Consumes: nichts (erste Aufgabe).
- Produces: die Zeilen-Nutzlast, die alle späteren Rechen-Hälften liefern müssen —
  `after.boundary_note` (Zeichenkette, wird als Warnblock gezeichnet, nie als „alt → neu"),
  `after.pin_fields` (Komma-Liste von Feldschlüsseln, zeichnet den Knopf „Werte festhalten", nie eine
  Zeile), `after.fields_more` (Zahl als Zeichenkette, „+ N weitere Felder").
  Neue Optionen von `openSyncPlanSheet`: `onPin({ id, fields }) => Promise<boolean>`.
  Neuer Server-Schlüssel: `run.counts.protected_note` (Zeichenkette) — ein zweiter Satz im Vorspann der
  Löschgruppe, den nur der Server formulieren kann. Wird escaped gezeichnet.

- [ ] **Step 1: Die fehlschlagenden Zusicherungen schreiben**

An das Ende von `js/review/__tests__/sync-plan-sheet.test.js`, **vor** die `console.log`-Zeile:

```js
// --- Sitzung 4: die zwei Territorien-Arten ---------------------------------------------------------

assert.equal(sandbox.syncPlanKindMeta("territory_wiki").title, "Die Wiki-Kopie der Herrschaftsgebiete nachführen");
assert.equal(sandbox.syncPlanKindMeta("territory").deletion, null, "die Karte löscht nie");
assert.equal(sandbox.syncPlanKindMeta("territory_wiki").nouns.many, "Kopien");

// 💣 Der Satz der leeren Löschgruppe gehört der ART. Der fest verdrahtete Satz („steht als Verlust in
// der Zeile des Eintrags") stimmt für die Karte nicht -- dort steht es in der Vorschau von „Syncen".
const emptyDeleted = sandbox.syncPlanGroupMarkup({ key: "deleted", name: "Gelöscht", hint: "x" }, [], 0, 0, "territory");
assert.ok(emptyDeleted.includes("Verwaiste Kopien"), "die Karte sagt, wo die verschwundenen stehen");
assert.ok(!emptyDeleted.includes("in der Zeile des Eintrags"), "und nicht den Satz der anderen Arten");

assert.equal(sandbox.syncPlanFieldLabel("valid_to_bf"), "Aufgelöst");
assert.equal(sandbox.syncPlanFieldLabel("parent"), "Eltern");
assert.equal(sandbox.syncPlanFieldLabel("ruler"), "Oberhaupt");

// Der Warnblock ist keine Änderung: kein „alt → neu", eigene Form.
const noted = sandbox.syncPlanDiffMarkup({
    change_type: "changed",
    before: { parent: "Grafschaft Ragath" },
    after: { parent: "Fürstentum Almada", boundary_note: "Grafschaft Ragath verliert ihr letztes Kind." },
});
assert.ok(noted.includes("diff__note"), "der Hinweis bekommt seine eigene Form");
assert.ok(noted.includes("Grafschaft Ragath verliert ihr letztes Kind."));
assert.ok(!noted.includes("<dt>Außengrenzen</dt>"), "und steht nicht als Feldname in der Pfeilliste");

// pin_fields informiert die Zeile und erscheint nie als Unterschied.
const pinned = sandbox.syncPlanRowMarkup({
    id: 7, label: "Baronie Hügelsee", change_type: "changed",
    before: { name: "Baronie Hügelsee am Großen Fluss" },
    after: { name: "Baronie Hügelsee", pin_fields: "name" },
}, "territory");
assert.ok(pinned.includes('data-pin="7"'), "die Zeile bietet „Werte festhalten"");
assert.ok(!pinned.includes("<dt>weitere Felder</dt>") && !pinned.includes("pin_fields"), "aber nennt das Pseudo-Feld nie");

const unpinned = sandbox.syncPlanRowMarkup({
    id: 8, label: "Mark Ragathsquell", change_type: "changed",
    before: { parent: "A" }, after: { parent: "B" },
}, "territory");
assert.ok(!unpinned.includes("data-pin"), "eine reine Eltern-Zeile hat nichts festzuhalten");

// 💣 Die Löschgruppe muss sagen, was sie NICHT anbietet. Bei den Kopien sind das die, an denen ein
// Kartengebiet hängt -- eine Zahl, die man nicht sieht, liest sich als „alles erledigt".
const withProtected = sandbox.syncPlanGroupMarkup(
    { key: "deleted", name: "Gelöscht", hint: "x" },
    [{ id: 1, label: "Baronie Alt-Gareth", change_type: "deleted", before: {}, after: {} }],
    1, 0, "territory_wiki",
    "Fünf weitere Kopien hängen an einem Gebiet (Grafschaft Wehrsold, …) und werden nicht angeboten."
);
assert.ok(withProtected.includes("Grafschaft Wehrsold"), "die geschützten stehen im Vorspann, mit Namen");
assert.ok(withProtected.includes("kein</b> Gebiet auf der Karte"), "und der feste Satz der Art auch");
const withoutProtected = sandbox.syncPlanGroupMarkup(
    { key: "deleted", name: "Gelöscht", hint: "x" },
    [{ id: 1, label: "X", change_type: "deleted", before: {}, after: {} }],
    1, 0, "territory_wiki", ""
);
assert.ok(!withoutProtected.includes("werden nicht angeboten"), "ohne geschützte kein leerer Satz");
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `node js/review/__tests__/sync-plan-sheet.test.js`
Expected: FAIL — `syncPlanKindMeta("territory_wiki").title` ist noch `"Aus dem Wiki übernehmen"`.

- [ ] **Step 3: Die zwei Arten anmelden**

In `js/review/sync-plan-sheet.js`, in `SYNC_PLAN_KIND_NOUNS` ergänzen:

```js
	territory_wiki: { one: "Kopie", many: "Kopien" },
	territory: { one: "Herrschaftsgebiet", many: "Herrschaftsgebiete" },
```

In `SYNC_PLAN_KIND_TITLES` ergänzen:

```js
	territory_wiki: "Die Wiki-Kopie der Herrschaftsgebiete nachführen",
	territory: "Herrschaftsgebiete in die Karte übernehmen",
```

In `SYNC_PLAN_KIND_DELETION` ergänzen:

```js
	// Die Kopie einer Wiki-Seite, auf die KEIN Gebiet der Karte zeigt. Hängt eins daran, kommt die
	// Zeile gar nicht erst her -- der Vorspann nennt sie trotzdem, sonst sähe es nach „alles erledigt" aus.
	territory_wiki: {
		hint: "im Wiki nicht mehr da · <b>nichts vorangehäkelt</b>",
		lead: "Nur Kopien, auf die <b>kein</b> Gebiet auf der Karte zeigt. Was du <b>nicht</b> anhäkelst, "
			+ "bleibt — dauerhaft, es wird nicht wieder gefragt.",
		loss: {
			lead: "Kein Wiki-Artikel mehr, und kein Gebiet auf der Karte zeigt darauf.",
			counts: [],
			sentence: (list, single) => "",
		},
		actPlural: "Löschungen",
	},
	// 💣 Ein Herrschaftsgebiet wird nie gelöscht -- der Abgleich hat dafür keinen Weg und hatte nie
	// einen. Der Satz dazu steht in SYNC_PLAN_KIND_NO_DELETION_NOTE, weil der eingebaute für diese Art
	// falsch wäre: hier steht das Verschwundene nicht in der Zeile des Eintrags, sondern in der
	// anderen Vorschau.
	territory: null,
```

Direkt unter `SYNC_PLAN_KIND_DELETION` neu:

```js
/**
 * Was eine Art, die nichts löscht, an dieser Stelle sagt. Ohne Eintrag gilt der eingebaute Satz.
 *
 * ⚠️ Nicht kosmetisch: „steht als Verlust in der Zeile des Eintrags" schickt einen Editor bei den
 * Herrschaftsgebieten an eine Stelle, an der nichts steht.
 */
const SYNC_PLAN_KIND_NO_DELETION_NOTE = {
	territory: "Ein Herrschaftsgebiet wird nie gelöscht. Der Abgleich hat dafür keinen Weg und hatte nie "
		+ "einen — auch dann nicht, wenn sein Wiki-Artikel verschwindet. Verwaiste Kopien stehen in der "
		+ "Vorschau von „🚨 Syncen".",
};
```

- [ ] **Step 4: Den Satz der leeren Gruppe je Art nehmen**

In `syncPlanGroupMarkup`, im `meta.deletion === null`-Zweig, die fest verdrahtete Zeichenkette ersetzen:

```js
	if (group.key === "deleted" && meta.deletion === null) {
		const note = SYNC_PLAN_KIND_NO_DELETION_NOTE[kind]
			|| "Dieser Abgleich löscht nichts. Was das Wiki nicht mehr auflistet, steht als Verlust in der "
				+ "Zeile des Eintrags, zu dem es gehört — dort, wo es sich abhäkeln lässt.";
		return `<details class="grp" data-group="deleted"><summary>`
			+ `<span class="grp__name">${group.name}</span>`
			+ `<span class="grp__count">0</span>`
			+ `<span class="grp__hint">dieser Abgleich löscht nichts</span>`
			+ `</summary><div class="rows"><div class="row"><span></span><span class="row__sub">`
			+ `${note}`
			+ `</span></div></div></details>`;
	}
```

Und im selben Aufruf ein sechstes Argument: der Vorspann, den nur der Server kennt. Signatur:

```js
function syncPlanGroupMarkup(group, items, total, hiddenCount, kind, extraLead) {
```

…und die `lead`-Bildung weiter unten:

```js
	// Der Vorspann der Löschgruppe gehört der ART -- und ein zweiter Satz dem LAUF: bei den Wiki-Kopien
	// steht dort, welche NICHT angeboten werden, weil ein Kartengebiet an ihnen hängt. Der weiß nur der
	// Server, und ohne ihn liest sich die Gruppe als „mehr ist nicht verschwunden".
	const leadText = group.key === "deleted" && total > 0 && meta.deletion
		? meta.deletion.lead + (extraLead ? `<br>${syncPlanEscape(extraLead)}` : "")
		: "";
	const lead = leadText === "" ? "" : `<p class="row__sub" style="margin:0 0 8px">${leadText}</p>`;
```

In `syncPlanSheetMarkup` das Argument durchreichen — dort liegt der Plan:

```js
	const groups = SYNC_PLAN_GROUPS
		.map((group) => syncPlanGroupMarkup(
			group,
			items[group.key] || [],
			Number(counts[group.key] || 0),
			Number(truncated[group.key] || 0),
			kind,
			group.key === "deleted" ? String(counts.protected_note || "") : ""
		))
		.join("");
```

💣 **`extraLead` WIRD escaped, `meta.deletion.lead` daneben nicht** — und der Unterschied ist kein
Versehen: der feste Satz ist eine Zeichenkette im Quelltext und trägt absichtlich `<b>`; `extraLead`
trägt **Gebietsnamen aus dem Wiki**. Ein Artikel namens `<img onerror=…>` ist im Wiki Aventurica
unwahrscheinlich, aber nichts hindert ihn daran, und dies ist die einzige Stelle des Blattes, an der
Wiki-Text ohne Escape in die Seite käme. Alle anderen Zeileninhalte laufen bereits durch
`syncPlanEscape`.

- [ ] **Step 5: Die Feldnamen der Herrschaftsgebiete**

In `syncPlanFieldLabel`, in das `labels`-Objekt ergänzen (nur was noch fehlt — `name`, `continent`
und `kind` stehen schon dort):

```js
		// --- Herrschaftsgebiete (Sitzung 4). Dieselben deutschen Wörter, die der Territorien-Dialog
		// und die Infobox benutzen -- zwei Beschriftungen für dasselbe Feld wären die Divergenz, die
		// die Token-Regel für Farben verbietet.
		type: "Staatsform",
		status: "Status",
		valid_from_bf: "Gegründet",
		valid_to_bf: "Aufgelöst",
		parent: "Eltern",
		ruler: "Oberhaupt",
		capital_name: "Hauptstadt",
		seat_name: "Herrschaftssitz",
		form_of_government: "Herrschaftsform",
		language: "Sprache",
		currency: "Währung",
		trade_goods: "Handelswaren",
		population: "Einwohnerzahl",
		blazon: "Blasonierung",
		founder: "Gründer",
		founded_text: "Gründungsdatum",
		dissolved_text: "Auflösung",
		affiliation_root: "Zugehörigkeit",
		affiliation_raw: "Zugehörigkeit (roh)",
		trade_zone: "Handelszone",
		geographic: "Geographisch",
		political: "Politisch",
		coat_of_arms_url: "Wappen",
		fields_more: "weitere Felder",
```

- [ ] **Step 6: Warnblock und stille Felder**

Direkt unter `SYNC_PLAN_LOSS_DETAIL` neu:

```js
/**
 * Pseudo-Felder, die keine Änderung sind, sondern eine Warnung ZU einer. Eigene Form, eigene Farbe —
 * damit sie in einer vorangehäkelten Liste nicht als weitere Zeile „alt → neu" untergehen.
 */
const SYNC_PLAN_NOTE_FIELDS = ["boundary_note"];

/** Felder, die nur die ZEILE informieren und nie selbst erscheinen. */
const SYNC_PLAN_SILENT_FIELDS = ["pin_fields"];
```

In `syncPlanDiffMarkup`, als **erste** beiden Prüfungen in der `Object.keys(after).forEach`-Schleife
(vor dem Verlustfeld-Zweig):

```js
		if (SYNC_PLAN_SILENT_FIELDS.indexOf(field) >= 0) {
			return;
		}
		if (SYNC_PLAN_NOTE_FIELDS.indexOf(field) >= 0) {
			rows.push(`<dd class="diff__note">⚠ ${syncPlanEscape(after[field])}</dd>`);
			return;
		}
```

In `css/components/sync-plan-sheet.css`, neben die vorhandene `.diff__loss`-Regel:

```css
/* Ein Hinweis zu einer Änderung, kein „alt → neu": volle Breite, Warnton, eigene Kante. Er sagt, was
   die Zeile NEBENBEI bewirkt -- bei den Herrschaftsgebieten die Außengrenzen-Rolle. */
.sync-plan-host .diff__note {
	grid-column: 1 / -1;
	color: var(--color-warning);
	background: var(--color-warning-soft);
	border-left: 3px solid var(--color-warning-soft-border);
	border-radius: var(--radius-sm);
	padding: 6px 9px;
	margin: 2px 0;
}
```

- [ ] **Step 7: Der Knopf „Werte festhalten"**

In `syncPlanRowMarkup`, nach dem `why`-Block:

```js
	// „Werte festhalten" schreibt den vorhandenen Override und beendet die Frage dauerhaft, OHNE das
	// Gebiet aus der Pflege zu nehmen. Häkchen weg heißt weiterhin nur „diesmal nicht" (Entwurf §5).
	const pinFields = String((item.after || {}).pin_fields || "");
	const pin = pinFields === ""
		? ""
		: ` <button type="button" class="linkish" data-pin="${Number(item.id)}"`
			+ ` data-pin-fields="${syncPlanEscape(pinFields)}">Werte festhalten</button>`;
```

…und `${pin}` hinter `${body}${why}` in die zurückgegebene Zeichenkette setzen.

- [ ] **Step 8: Den Klick binden**

In `syncPlanBindSheet`, neben die vorhandenen Bindungen:

```js
	// 💣 Die Zeile IST ein <label>. Ohne preventDefault UND stopPropagation schaltet dieser Klick das
	// Häkchen der Zeile um -- der Editor hält einen Wert fest und häkelt dabei die Zeile ab.
	sheet.querySelectorAll("[data-pin]").forEach((button) => {
		button.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (!options || typeof options.onPin !== "function") {
				return;
			}
			button.disabled = true;
			const fields = String(button.dataset.pinFields || "").split(",").filter(Boolean);
			const ok = await options.onPin({ id: Number(button.dataset.pin), fields: fields });
			button.textContent = ok === true ? "festgehalten" : "ging nicht — bitte erneut";
			button.disabled = ok !== true;
		});
	});
```

Und den Kopfkommentar von `openSyncPlanSheet` um `onPin` erweitern:

```js
 * @param {{kind:string, mount:HTMLElement, post?:function, onApplied?:function, onClose?:function,
 *          onPin?:function}} options
```

- [ ] **Step 9: Tests grün**

Run: `node js/review/__tests__/sync-plan-sheet.test.js`
Expected: PASS, `sync-plan-sheet ok`

- [ ] **Step 10: Beißprobe**

Entferne `territory` aus `SYNC_PLAN_KIND_NO_DELETION_NOTE`, führe den Test erneut aus.
Expected: FAIL bei „die Karte sagt, wo die verschwundenen stehen". Danach zurücknehmen.
Dasselbe mit `SYNC_PLAN_SILENT_FIELDS = []`: Expected FAIL bei „nennt das Pseudo-Feld nie".

- [ ] **Step 11: Commit**

```bash
git add js/review/sync-plan-sheet.js css/components/sync-plan-sheet.css js/review/__tests__/sync-plan-sheet.test.js && git commit -m "feat(sync): das Vorschau-Blatt kennt die zwei Territorien-Arten"
```

---

## Task 2: Die positive Auswahl an den zwei Bulk-Schreibern

**Files:**
- Modify: `api/_internal/wiki/sync-monitor-model.php:609-667` (`avesmapsWikiSyncMonitorApplyParentCache`), `:803-929` (`avesmapsWikiSyncMonitorApplyCustomNodes`)
- Modify: `api/edit/wiki/sync-monitor.php:62-67`, `:94-98`
- Test: `api/_internal/wiki/__tests__/territory-selection-test.php` (neu)

**Interfaces:**
- Consumes: nichts.
- Produces:
  `avesmapsWikiSyncMonitorSelectionClause(string $column, ?array $only, array $skip): array{sql:string, params:list<string>}`
  `avesmapsWikiSyncMonitorApplyParentCache(PDO $pdo, array $skipKeys, bool $dryRun, ?array $onlyKeys = null): array`
  `avesmapsWikiSyncMonitorApplyCustomNodes(PDO $pdo, bool $dryRun, ?array $onlyKeys = null): array`
  In beiden gilt: `$onlyKeys === null` → keine Einschränkung (der alte Aufrufweg), `[]` → **nichts**.

- [ ] **Step 1: Den Test schreiben**

Neu, `api/_internal/wiki/__tests__/territory-selection-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * 💣 Die Auswahl eines Bulk-Schreibers ist POSITIV. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-selection-test.php
 *
 * Warum das ein eigener Test ist: "alles Divergente AUSSER diesen" schreibt jede Divergenz mit, die
 * zwischen Vorschau und Übernahme entstanden ist -- ungesehen, ohne Zeile, ohne Häkchen. Genau das
 * kann eine Vorschau nicht überleben, und genau so war der Schreiber gebaut (Entwurf §6a).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';       // Konstanten
require_once __DIR__ . '/../sync-monitor-model.php'; // nur Funktionsdefinitionen

// --- Ohne Einschränkung: der alte Aufrufweg --------------------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', null, []);
assert($clause['sql'] === '' && $clause['params'] === [], 'null = alles, wie bisher');

// --- Nur die Übersprungenen (alter Weg, bleibt erhalten) -------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', null, ['wiki:a', 'wiki:b']);
assert($clause['sql'] === ' AND child.wiki_key NOT IN (?,?)');
assert($clause['params'] === ['wiki:a', 'wiki:b']);

// --- Die Auswahl der Vorschau ----------------------------------------------------------------------
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', ['wiki:a'], ['wiki:b']);
assert($clause['sql'] === ' AND child.wiki_key IN (?)', 'only gewinnt über skip');
assert($clause['params'] === ['wiki:a']);

// --- 💣 Die leere Auswahl heißt NICHTS, nicht ALLES ------------------------------------------------
//
// Der Unfall, den diese Zeile verhindert: eine Übernahme, bei der nichts angehäkelt war, schreibt
// jede Divergenz der Datenbank. `[]` und `null` sehen in PHP zu ähnlich aus, um darauf zu vertrauen.
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', [], []);
assert($clause['sql'] === ' AND 1 = 0' && $clause['params'] === [], '💣 leere Auswahl = keine Zeile');

// Leerzeichen und Dubletten fallen raus, die Reihenfolge bleibt.
$clause = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', [' wiki:a ', 'wiki:a', '', 'wiki:c'], []);
assert($clause['params'] === ['wiki:a', 'wiki:c']);

// --- Und die zwei Schreiber bauen ihre Bedingung nicht mehr selbst ---------------------------------
$source = (string) file_get_contents(__DIR__ . '/../sync-monitor-model.php');
assert(!str_contains($source, "NOT IN ('"), 'keine handgebaute Bedingung mehr');
assert(!str_contains($source, '$skipClause = ' . "' AND child.wiki_key NOT IN"), 'der alte Bau ist weg');
assert(substr_count($source, 'avesmapsWikiSyncMonitorSelectionClause(') >= 3, 'beide Schreiber rufen sie');

echo "territory-selection ok\n";
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-selection-test.php`
Expected: FATAL `Call to undefined function avesmapsWikiSyncMonitorSelectionClause()`

- [ ] **Step 3: Die reine Funktion schreiben**

In `api/_internal/wiki/sync-monitor-model.php`, direkt **über** `avesmapsWikiSyncMonitorApplyParentCache`:

```php
/**
 * Die Auswahl eines Bulk-Schreibers als SQL-Bedingung. REIN.
 *
 * 💣 POSITIV, nicht negativ. „Alles Divergente ausser diesen" (der alte `skip`-Weg) schreibt jede
 * Divergenz mit, die zwischen Vorschau und Uebernahme entstanden ist -- ungesehen, ohne Zeile, ohne
 * Haekchen. Eine Vorschau, die das zulaesst, ist keine.
 *
 * 💣 `null` und `[]` sind NICHT dasselbe: `null` heisst „keine Einschraenkung" (der alte Aufrufweg),
 * `[]` heisst „nichts" -- und ergibt deshalb `1 = 0`, nicht die leere Bedingung.
 *
 * @param list<string>|null $only
 * @param list<string> $skip
 * @return array{sql:string, params:list<string>}
 */
function avesmapsWikiSyncMonitorSelectionClause(string $column, ?array $only, array $skip): array {
    $clean = static fn(array $values): array => array_values(array_unique(array_filter(
        array_map(static fn($value): string => trim((string) $value), $values),
        static fn(string $value): bool => $value !== ''
    )));

    if ($only !== null) {
        $only = $clean($only);
        if ($only === []) {
            return ['sql' => ' AND 1 = 0', 'params' => []];
        }

        return [
            'sql' => ' AND ' . $column . ' IN (' . implode(',', array_fill(0, count($only), '?')) . ')',
            'params' => $only,
        ];
    }

    $skip = $clean($skip);
    if ($skip === []) {
        return ['sql' => '', 'params' => []];
    }

    return [
        'sql' => ' AND ' . $column . ' NOT IN (' . implode(',', array_fill(0, count($skip), '?')) . ')',
        'params' => $skip,
    ];
}
```

- [ ] **Step 4: `avesmapsWikiSyncMonitorApplyParentCache` umstellen**

Signatur: `function avesmapsWikiSyncMonitorApplyParentCache(PDO $pdo, array $skipKeys, bool $dryRun, ?array $onlyKeys = null): array {`

Die ersten Zeilen des Rumpfs (bis einschließlich der alten `$skipClause`-Bildung) ersetzen durch:

```php
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $selection = avesmapsWikiSyncMonitorSelectionClause('child.wiki_key', $onlyKeys, $skipKeys);
    $skipClause = $selection['sql'];
    $skipKeys = $selection['params'];
```

Der Rest der Funktion bleibt **unverändert** — `$skipClause` und `$skipKeys` heißen weiter so und
werden an denselben drei Stellen benutzt (Zähl-, Beispiel- und `unresolved`-Abfrage) sowie im
`UPDATE`. `'skipped_keys' => $skipKeys` im Rückgabewert bleibt ebenfalls stehen.

- [ ] **Step 5: `avesmapsWikiSyncMonitorApplyCustomNodes` umstellen**

Signatur: `function avesmapsWikiSyncMonitorApplyCustomNodes(PDO $pdo, bool $dryRun, ?array $onlyKeys = null): array {`

Die Kandidatenabfrage bekommt die Bedingung:

```php
    $selection = avesmapsWikiSyncMonitorSelectionClause('wiki_key', $onlyKeys, []);
    $statement = $pdo->prepare(
        "SELECT wiki_key, parent_wiki_key, metadata_overrides_json
         FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . "
         WHERE wiki_key LIKE 'eigener-knoten:%' AND excluded = 0" . $selection['sql'] . "
         ORDER BY wiki_key ASC"
    );
    $statement->execute($selection['params']);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
```

⚠️ Damit ist auch die **zweite** Schleife der Funktion (die `parent_id` aller platzierten eigenen
Knoten setzt) auf die Auswahl beschränkt — sie läuft über dasselbe `$rows`. Das ist richtig und der
Grund, warum die Einschränkung in die Abfrage gehört und nicht in die erste Schleife.

- [ ] **Step 6: Den Endpunkt durchreichen**

In `api/edit/wiki/sync-monitor.php`, im `apply_parent_cache`-Arm nach dem `dryRun`-Ausdruck ergänzen:

```php
                is_array($payload['only'] ?? null) ? $payload['only'] : null
```

…und im `apply_custom_nodes`-Arm ebenso. Beide behalten ihre `dry_run`/`confirm`-Riegel unverändert.

- [ ] **Step 7: Tests grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-selection-test.php`
Expected: PASS, `territory-selection ok`
Run: `php -l api/_internal/wiki/sync-monitor-model.php && php -l api/edit/wiki/sync-monitor.php`
Expected: `No syntax errors detected` (2×)

- [ ] **Step 8: Beißprobe**

Ändere in der reinen Funktion `' AND 1 = 0'` zu `''`, Test erneut.
Expected: FAIL bei „💣 leere Auswahl = keine Zeile". Danach zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add api/_internal/wiki/sync-monitor-model.php api/edit/wiki/sync-monitor.php api/_internal/wiki/__tests__/territory-selection-test.php && git commit -m "feat(sync): the territory bulk writers take a positive selection, not just a skip list"
```

---

## Task 3: Die Rechen-Hälfte der Wiki-Kopie

**Files:**
- Create: `api/_internal/wiki/territory-wiki-plan.php`
- Test: `api/_internal/wiki/__tests__/territory-wiki-plan-test.php` (neu)

**Interfaces:**
- Consumes: `avesmapsSyncPlanStartRun`, `…BuildingRun`, `…AddItem`, `…Decisions`, `…DecisionKey`,
  `…DefaultSelected`, `…FinishBuild`, `avesmapsEnsureSyncPlanTables` (alle aus `sync-plan.php`);
  `AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE`.
- Produces:
  `AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS` (list<string>), `AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT` (int)
  `avesmapsTerritoryWikiPlanItem(?array $mirror, array $staging): ?array{change_type,before,after,override}`
  `avesmapsTerritoryWikiVanishedRows(PDO $pdo, array $declinedKeys): array{orphans:list<array>, in_use:list<array>}`
  `avesmapsTerritoryWikiPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array{done:bool,nextCursor:string,run_id:int,planned:int,processed:int,counts:array,in_use:list<array>}`
  — `counts['protected_note']` trägt den Satz über die nicht angebotenen Kopien (Task 1),
  `in_use` dieselben Zeilen als Rohdaten für die Statuszeile.

- [ ] **Step 1: Den Test schreiben**

Neu, `api/_internal/wiki/__tests__/territory-wiki-plan-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Die COMPUTE-Haelfte der Wiki-Kopie: wie eine Unterschiedszeile aussieht, und welche Zeilen nie eine
 * werden duerfen. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-plan-test.php
 *
 * Teil 1 ist rein (ohne Datenbank). Teil 2 nutzt sqlite fuer die zwei Riegel, die von Natur aus SQL
 * sind: der Leer-Riegel und die Trennung Waise / benutzt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-wiki-plan.php';

// =================================================================================================
// TEIL 1 -- avesmapsTerritoryWikiPlanItem, rein
// =================================================================================================

$staging = [
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'type' => 'Fürstentum',
    'ruler' => 'Growin Sohn des Grimbrand',
    'population' => '181.000',
    'currency' => '',
];

// --- Neu ------------------------------------------------------------------------------------------
$item = avesmapsTerritoryWikiPlanItem(null, $staging);
assert($item !== null && $item['change_type'] === 'new');
assert($item['after']['name'] === 'Fürstentum Kosch');
assert($item['before'] === [], 'eine neue Kopie hat kein Vorher');
assert(!array_key_exists('currency', $item['after']), 'leere Felder stehen nicht in der Zeile');

// --- Nichts zu tun = keine Zeile --------------------------------------------------------------------
$same = ['name' => 'Fürstentum Kosch', 'type' => 'Fürstentum', 'ruler' => 'Growin Sohn des Grimbrand',
    'population' => '181.000', 'currency' => 'Kosch-Taler'];
assert(
    avesmapsTerritoryWikiPlanItem($same, $staging) === null,
    'ein zweiter Lauf ohne Unterschied erzeugt KEINE Zeile -- sonst stuende die Vorschau jedes Mal voll'
);

// --- 💣 Ein leerer frischer Wert ueberschreibt nie einen guten -------------------------------------
//
// Der Dump liefert zur Waehrung nichts, in der Kopie steht "Kosch-Taler". Das ist keine Aenderung --
// und darf auch keine Zeile werden, sonst haekelt jemand sie an und loescht damit einen guten Wert.
// Genau diese Falle ist beim Kontinent schon einmal zugeschnappt (sync-monitor-identity.php, COALESCE).
$mirror = $same;
$mirror['ruler'] = 'Blasius von Eberstamm';
$item = avesmapsTerritoryWikiPlanItem($mirror, $staging);
assert($item !== null && $item['change_type'] === 'changed');
assert(array_keys($item['after']) === ['ruler'], '💣 nur das Oberhaupt, NICHT die Waehrung');
assert($item['before']['ruler'] === 'Blasius von Eberstamm');

// --- Der Feld-Deckel --------------------------------------------------------------------------------
$manyStaging = [];
$manyMirror = [];
foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $index => $field) {
    $manyStaging[$field] = 'neu-' . $index;
    $manyMirror[$field] = 'alt-' . $index;
}
$item = avesmapsTerritoryWikiPlanItem($manyMirror, $manyStaging);
$limit = AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT;
assert(count($item['after']) === $limit + 1, 'gedeckelt, plus die Zahl der uebrigen');
assert(
    (int) $item['after']['fields_more'] === count(AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS) - $limit,
    'und die Zahl stimmt -- sie ist zugleich das, was eine Veraltung verraet'
);
assert(count($item['before']) === $limit, 'das Vorher zeigt dieselben Felder');

// =================================================================================================
// TEIL 2 -- die zwei Riegel, auf sqlite
// =================================================================================================

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE political_territory_wiki (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT)');
$pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_id INTEGER,
    wiki_key TEXT, name TEXT, is_active INTEGER DEFAULT 1)');

$addMirror = static function (PDO $pdo, string $key, string $name): int {
    $pdo->prepare('INSERT INTO political_territory_wiki (wiki_key, name) VALUES (:k, :n)')
        ->execute(['k' => $key, 'n' => $name]);
    return (int) $pdo->lastInsertId();
};

$koschId = $addMirror($pdo, 'wiki:f-rstentum-kosch', 'Fürstentum Kosch');   // lebt, ist im Staging
$wehrsoldId = $addMirror($pdo, 'wiki:grafschaft-wehrsold', 'Grafschaft Wehrsold'); // benutzt, Artikel weg
$altGarethId = $addMirror($pdo, 'wiki:baronie-alt-gareth', 'Baronie Alt-Gareth'); // Waise
$addMirror($pdo, 'wiki:koenigreich-thorwal-alt', 'Königreich Thorwal (alt)');     // Waise

// Ein Kartengebiet zeigt auf Wehrsold -- ueber wiki_id. Ein zweites auf Kosch ueber den Schluessel.
$pdo->prepare('INSERT INTO political_territory (wiki_id, wiki_key, name) VALUES (:w, :k, :n)')
    ->execute(['w' => $wehrsoldId, 'k' => 'wiki:grafschaft-wehrsold', 'n' => 'Grafschaft Wehrsold']);
$pdo->prepare('INSERT INTO political_territory (wiki_id, wiki_key, name) VALUES (NULL, :k, :n)')
    ->execute(['k' => 'wiki:f-rstentum-kosch', 'n' => 'Fürstentum Kosch']);

// --- 💣 Der Leer-Riegel (Entwurf §6c) --------------------------------------------------------------
//
// Leeres Staging heisst "Syncen lief nicht", NICHT "das Wiki hat alles geloescht". Der Schaden waere
// eine Vorschau, die jede Kopie zum Loeschen anbietet -- und irgendwann klickt jemand.
$result = avesmapsTerritoryWikiVanishedRows($pdo, []);
assert($result['orphans'] === [] && $result['in_use'] === [], '💣 leeres Staging => keine einzige Zeile');

$pdo->exec("INSERT INTO political_territory_wiki_test (wiki_key, name) VALUES ('wiki:f-rstentum-kosch', 'Fürstentum Kosch')");

$result = avesmapsTerritoryWikiVanishedRows($pdo, []);
$orphanKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['orphans']);
sort($orphanKeys);
assert($orphanKeys === ['wiki:baronie-alt-gareth', 'wiki:koenigreich-thorwal-alt'], 'genau die zwei Waisen');

// --- 💣 Eine benutzte Kopie wird NIE angeboten -----------------------------------------------------
//
// An ihr haengen sechs Zeilen der Infobox eines echten Gebiets, und es gibt keinen Wiki-Artikel mehr,
// aus dem sie zurueckkaemen. Genannt wird sie trotzdem -- sonst sieht die Gruppe nach "alles erledigt" aus.
assert(!in_array('wiki:grafschaft-wehrsold', $orphanKeys, true), '💣 benutzte Kopie: keine Loeschzeile');
$inUseKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['in_use']);
assert($inUseKeys === ['wiki:grafschaft-wehrsold'], 'aber im Vorspann genannt');
assert($result['in_use'][0]['name'] === 'Grafschaft Wehrsold', 'mit Namen, nicht als Zahl');

// --- Der Behalten-Riegel ---------------------------------------------------------------------------
$result = avesmapsTerritoryWikiVanishedRows($pdo, ['wiki:baronie-alt-gareth']);
$orphanKeys = array_map(static fn(array $r): string => $r['wiki_key'], $result['orphans']);
assert($orphanKeys === ['wiki:koenigreich-thorwal-alt'], 'abgelehnte Loeschung wird nie wieder gefragt');

echo "territory-wiki-plan ok\n";
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-plan-test.php`
Expected: FATAL — `territory-wiki-plan.php` gibt es noch nicht.

- [ ] **Step 3: Die Datei anlegen, Konstanten und die reine Funktion**

Neu, `api/_internal/wiki/territory-wiki-plan.php`:

```php
<?php

declare(strict_types=1);

// The COMPUTE half of the territory WIKI COPY sync: it says what political_territory_wiki would get
// from the freshly staged dump, and writes nothing but plan rows. Design:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-territorien-design.md §4, session 4.
//
// 💣 WHY THIS SYNC EXISTS AT ALL: political_territory_wiki lost its writer when sync_territories was
// retired (review-wiki-sync.js:3516 ff.) -- but it is still read live: Hauptstadt, Oberhaupt, Sprache,
// Währung, Handelswaren, Blasonierung and the "Liegt in" resolver all come from it. The old
// "Unterschiede" button counted a gap no button could close.
//
// Side-effect-free on include: function definitions only.

/**
 * What is compared. Without id/synced_at: the first is identity, the second a clock. Without raw_json:
 * it is the RAW wikitext, it differs after every dump, and it would put every single territory into
 * the "Geändert" group forever. The WRITE still carries it -- only the comparison ignores it.
 */
const AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS = [
    'name', 'type', 'continent', 'affiliation_raw', 'affiliation_key', 'affiliation_root',
    'affiliation_path_json', 'affiliation_json', 'status', 'form_of_government', 'capital_name',
    'seat_name', 'ruler', 'language', 'currency', 'trade_goods', 'population', 'founded_text',
    'founded_type', 'founded_start_bf', 'founded_end_bf', 'founded_display_bf', 'founded_json',
    'founder', 'dissolved_text', 'dissolved_type', 'dissolved_start_bf', 'dissolved_end_bf',
    'dissolved_display_bf', 'dissolved_json', 'geographic', 'political', 'trade_zone', 'blazon',
    'wiki_url', 'coat_of_arms_url',
];

/** How many changed fields a row names before it says "+ N weitere Felder". */
const AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT = 6;

/**
 * One row of the copy preview. PURE.
 *
 * 💣 AN EMPTY FRESH VALUE IS NOT A CHANGE. If the dump has nothing for a field and the copy holds a
 * value, the value stays and the field is not named at all. Anything else offers an editor a tick that
 * throws away good data -- the trap that already sprang once on `continent`, where the apply UPDATE
 * still carries a COALESCE because of it (sync-monitor-identity.php).
 *
 * @param array<string,mixed>|null $mirror the political_territory_wiki row, NULL if there is none yet
 * @param array<string,mixed> $staging the political_territory_wiki_test row
 * @return array{change_type:string, before:array<string,string>, after:array<string,string>,
 *               override:array<string,string>}|null NULL = nothing to do
 */
function avesmapsTerritoryWikiPlanItem(?array $mirror, array $staging): ?array {
    $text = static fn($value): string => $value === null ? '' : trim((string) $value);

    if ($mirror === null) {
        $after = [];
        foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $field) {
            $fresh = $text($staging[$field] ?? null);
            if ($fresh !== '') {
                $after[$field] = $fresh;
            }
        }

        return ['change_type' => 'new', 'before' => [], 'after' => $after, 'override' => []];
    }

    $before = [];
    $after = [];
    foreach (AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS as $field) {
        $fresh = $text($staging[$field] ?? null);
        if ($fresh === '' || $fresh === $text($mirror[$field] ?? null)) {
            continue;
        }
        $before[$field] = $text($mirror[$field] ?? null);
        $after[$field] = $fresh;
    }

    if ($after === []) {
        return null;
    }

    $total = count($after);
    if ($total > AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT) {
        $after = array_slice($after, 0, AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT, true);
        $before = array_intersect_key($before, $after);
        // ⚠️ The counter is not decoration: the apply half compares this very array against a fresh
        // one, so a change in a field BEYOND the limit still shows up -- as a different count.
        $after['fields_more'] = (string) ($total - AVESMAPS_TERRITORY_WIKI_PLAN_FIELD_LIMIT);
    }

    return ['change_type' => 'changed', 'before' => $before, 'after' => $after, 'override' => []];
}
```

- [ ] **Step 4: Die verschwundenen Kopien**

Weiter in derselben Datei:

```php
/**
 * The copies whose wiki article is gone, split into "may be removed" and "a territory hangs off it".
 *
 * 💣 AN EMPTY STAGING TABLE NEVER MEANS "DELETE EVERYTHING". It means the sync did not run. The same
 * gate the citymaps carry (avesmapsCitymapRemovableKeys) -- there the damage would have been a preview
 * proposing 457 deletions, here it would be every territory copy we have.
 *
 * 💣 A COPY A TERRITORY POINTS AT IS NEVER OFFERED. Six infobox lines hang off it and there is no wiki
 * article left to restore them from. It is still NAMED, in the group's lead: a number nobody can see
 * reads as "all done".
 *
 * @param list<string> $declinedKeys deletions an editor already refused, permanently
 * @return array{orphans:list<array{id:int,wiki_key:string,name:string}>,
 *               in_use:list<array{id:int,wiki_key:string,name:string}>}
 */
function avesmapsTerritoryWikiVanishedRows(PDO $pdo, array $declinedKeys): array {
    $staged = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
        ->fetchColumn() ?: 0);
    if ($staged === 0) {
        return ['orphans' => [], 'in_use' => []];
    }

    $declined = array_flip(array_map('strval', $declinedKeys));
    $rows = $pdo->query(
        'SELECT w.id, w.wiki_key, w.name,
                (SELECT COUNT(*) FROM political_territory t
                  WHERE t.is_active = 1 AND (t.wiki_id = w.id OR t.wiki_key = w.wiki_key)) AS map_count
           FROM political_territory_wiki w
          WHERE NOT EXISTS (SELECT 1 FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s
                             WHERE s.wiki_key = w.wiki_key)
          ORDER BY w.name ASC, w.id ASC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $orphans = [];
    $inUse = [];
    foreach ($rows as $row) {
        $entry = ['id' => (int) $row['id'], 'wiki_key' => (string) $row['wiki_key'], 'name' => (string) $row['name']];
        if ((int) $row['map_count'] > 0) {
            $inUse[] = $entry;
            continue;
        }
        if (isset($declined[$entry['wiki_key']])) {
            continue;
        }
        $orphans[] = $entry;
    }

    return ['orphans' => $orphans, 'in_use' => $inUse];
}
```

- [ ] **Step 5: Der Rechen-Schritt**

Weiter in derselben Datei:

```php
/**
 * ONE bounded COMPUTE step over the staging table, resumable via a wiki_key high-water cursor.
 *
 * 🔴 THE HALF THAT DOES NOT WRITE. Plan rows only; sync-plan-purity-test.php walks everything this
 * reaches, at any depth, and asserts no live table is touched.
 *
 * The vanished rows are added in the FIRST step (empty cursor): they are one query over the whole
 * mirror, not a per-entity job, and doing them once keeps them out of every later step.
 *
 * @return array{done:bool, nextCursor:string, run_id:int, planned:int, processed:int,
 *               counts:array{new:int,changed:int,deleted:int,total:int}, in_use:list<array>}
 */
function avesmapsTerritoryWikiPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array {
    $budget = $budget ?? 200;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ DDL first and once: MySQL commits an open transaction implicitly when it sees DDL.
    avesmapsEnsureSyncPlanTables($pdo);

    // The run is derived from the cursor, never named by the client -- a run id off the wire would let
    // one editor write into another's plan.
    if ($cursor === '') {
        $stamp = (string) ($pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
            ->fetchColumn() ?: '');
        $runId = avesmapsSyncPlanStartRun($pdo, 'territory_wiki', $userId, $stamp === '' ? null : $stamp);
    } else {
        $runId = (int) (avesmapsSyncPlanBuildingRun($pdo, 'territory_wiki')['id'] ?? 0);
    }
    if ($runId <= 0) {
        throw new RuntimeException('Der Abgleich wurde von einem zweiten Lauf abgeloest. Bitte neu starten.');
    }

    // ONE read of the decision table per step, not one per row: the loop STRATO cannot take.
    $decisions = avesmapsSyncPlanDecisions($pdo, 'territory_wiki');
    $inUse = [];

    if ($cursor === '') {
        $vanished = avesmapsTerritoryWikiVanishedRows($pdo, avesmapsSyncPlanDeclinedKeys($pdo, 'territory_wiki'));
        $inUse = $vanished['in_use'];
        foreach ($vanished['orphans'] as $orphan) {
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $orphan['wiki_key'],
                'entity_public_id' => null,
                'change_type' => 'deleted',
                'label' => $orphan['name'],
                'before' => [],
                'after' => [],
                'override' => [],
                'selected' => avesmapsSyncPlanDefaultSelected('deleted', 0),
            ]);
        }
    }

    $select = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
        . ' WHERE wiki_key > :cur ORDER BY wiki_key ASC LIMIT :lim'
    );
    $select->bindValue(':cur', $cursor, PDO::PARAM_STR);
    $select->bindValue(':lim', max(1, $budget), PDO::PARAM_INT);
    $select->execute();
    $stagingRows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $mirrorFind = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE wiki_key = :wk LIMIT 1');
    $planned = 0;
    $processed = 0;
    $nextCursor = $cursor;
    $timedOut = false;

    foreach ($stagingRows as $staging) {
        $nextCursor = (string) $staging['wiki_key'];
        $processed++;

        $mirrorFind->execute(['wk' => $nextCursor]);
        $mirror = $mirrorFind->fetch(PDO::FETCH_ASSOC) ?: null;
        $item = avesmapsTerritoryWikiPlanItem($mirror, $staging);

        if ($item !== null) {
            $decision = $decisions[avesmapsSyncPlanDecisionKey($nextCursor, $item['change_type'])] ?? null;
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $nextCursor,
                'entity_public_id' => null,
                'change_type' => $item['change_type'],
                'label' => (string) ($staging['name'] ?? $nextCursor),
                'before' => $item['before'],
                'after' => $item['after'],
                'override' => $item['override'],
                'selected' => avesmapsSyncPlanDefaultSelected($item['change_type'], (int) ($decision['skipped_count'] ?? 0)),
            ]);
            $planned++;
        }

        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }

    $done = !$timedOut && count($stagingRows) < max(1, $budget);
    $counts = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    if ($done) {
        $counts = avesmapsSyncPlanFinishBuild($pdo, $runId);
        // 💣 Der Satz über die NICHT angebotenen Kopien reist in counts_json mit -- er ist das einzige
        // Stück der Vorschau, das der Server formulieren muss, weil nur er weiss, welche Kopie ein
        // Kartengebiet benutzt. Neu gerechnet statt über die Schritte getragen: dieselbe eine Abfrage,
        // einmal am Ende, und kein Zustand, der zwischen Requests verlorengehen kann.
        $protected = avesmapsTerritoryWikiVanishedRows($pdo, [])['in_use'];
        if ($protected !== []) {
            $names = array_map(static fn(array $r): string => $r['name'], array_slice($protected, 0, 10));
            $counts['protected_note'] = sprintf(
                '%d weitere %s ebenfalls keinen Artikel mehr, hängen aber an einem Gebiet auf der Karte '
                . '(%s%s). Sie bleiben stehen und werden hier nicht angeboten.',
                count($protected),
                count($protected) === 1 ? 'Kopie hat' : 'Kopien haben',
                implode(', ', $names),
                count($protected) > 10 ? ', …' : ''
            );
            $pdo->prepare('UPDATE sync_plan_run SET counts_json = :c WHERE id = :id')->execute([
                'c' => json_encode($counts, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'id' => $runId,
            ]);
        }
    }

    return [
        'done' => $done,
        'nextCursor' => $nextCursor,
        'run_id' => $runId,
        'planned' => $planned,
        'processed' => $processed,
        'counts' => $counts,
        'in_use' => $inUse,
    ];
}
```

⚠️ `AVESMAPS_WIKI_DUMP_STEP_SECONDS` kommt aus `sync-constants.php`; die Datei wird von
`sync-monitor.php` bereits geladen. Falls `php -l` das nicht abfängt, prüft Step 7 es.

- [ ] **Step 6: Tests grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-plan-test.php`
Expected: PASS, `territory-wiki-plan ok`

- [ ] **Step 7: Beißprobe**

Entferne in `avesmapsTerritoryWikiPlanItem` die Bedingung `$fresh === '' ||`, Test erneut.
Expected: FAIL bei „💣 nur das Oberhaupt, NICHT die Waehrung". Danach zurücknehmen.
Entferne den `$staged === 0`-Riegel: Expected FAIL bei „💣 leeres Staging => keine einzige Zeile".

- [ ] **Step 8: Commit**

```bash
git add api/_internal/wiki/territory-wiki-plan.php api/_internal/wiki/__tests__/territory-wiki-plan-test.php && git commit -m "feat(sync): the compute half of the territory wiki-copy preview"
```

---

## Task 4: Die Ausführ-Hälfte der Wiki-Kopie

**Files:**
- Create: `api/_internal/wiki/territory-wiki-plan-apply.php`
- Modify: `api/_internal/map/collection-audit.php` (`AVESMAPS_COLLECTION_AUDIT_KIND_LABELS`)
- Test: `api/_internal/wiki/__tests__/territory-wiki-apply-test.php` (neu)

**Interfaces:**
- Consumes: `avesmapsTerritoryWikiPlanItem`, `avesmapsTerritoryWikiVanishedRows` (Task 3);
  `avesmapsPoliticalUpsertWikiRecord`, `avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey`;
  `avesmapsSyncPlanPendingItems`, `…MarkItem`, `…IsStale`, `…RecordSkip`, `…RecordDecline`,
  `…ClearSkip`, `…MarkApplied`, `avesmapsLogSyncPlanApply`.
- Produces:
  `avesmapsTerritoryWikiRecordFromStagingRow(array $row): array`
  `avesmapsTerritoryWikiApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array{done,applied,deleted,stale,processed,remaining,skipped,declined}`

- [ ] **Step 1: Den Test für den Adapter schreiben**

Neu, `api/_internal/wiki/__tests__/territory-wiki-apply-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * 💣 Die Staging-Zeile ist NICHT der Datensatz, den der Upsert erwartet. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-apply-test.php
 *
 * avesmapsPoliticalUpsertWikiRecord schickt jedes *_json-Feld durch avesmapsPoliticalEncodeJsonOrNull,
 * und das ruft json_encode. Die Staging-Spalte ist aber bereits eine JSON-ZEICHENKETTE -- unveraendert
 * durchgereicht landet in der Kopie ein doppelt kodierter String ("\"{...}\""), den jeder Leser als
 * Text statt als Struktur bekommt. Der Fehler waere lautlos: das Feld ist gefuellt, die Zeile sieht
 * richtig aus, und erst die Infobox zeigt Anfuehrungszeichen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-wiki-plan.php';
require_once __DIR__ . '/../territory-wiki-plan-apply.php';

$row = [
    'id' => 42,
    'synced_at' => '2026-08-06 22:03:00',
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'affiliation_path_json' => '["Kaiserreich Mittelreich","Fürstentum Kosch"]',
    'affiliation_json' => '{"root":"Kaiserreich Mittelreich"}',
    'founded_json' => '',
    'dissolved_json' => null,
    'raw_json' => '{"Name":"Fürstentum Kosch"}',
];

$record = avesmapsTerritoryWikiRecordFromStagingRow($row);

assert(is_array($record['affiliation_path_json']), '💣 JSON-Spalten kommen als STRUKTUR zurueck');
assert($record['affiliation_path_json'][0] === 'Kaiserreich Mittelreich');
assert(is_array($record['affiliation_json']) && $record['affiliation_json']['root'] === 'Kaiserreich Mittelreich');
assert($record['founded_json'] === [], 'leer bleibt leer, nicht [""]');
assert($record['dissolved_json'] === []);
assert(is_array($record['raw_json']) && $record['raw_json']['Name'] === 'Fürstentum Kosch');
assert($record['name'] === 'Fürstentum Kosch', 'Textspalten bleiben Text');
assert(!array_key_exists('id', $record), 'die Staging-id gehoert nicht in die Kopie');
assert(!array_key_exists('synced_at', $record), 'und die Staging-Uhr auch nicht');

// Gegenprobe: was der Upsert daraus macht, ist wieder eine EINFACH kodierte Zeichenkette.
require_once __DIR__ . '/../../political/territory.php';
assert(
    avesmapsPoliticalEncodeJsonOrNull($record['affiliation_json']) === '{"root":"Kaiserreich Mittelreich"}',
    '💣 einfach kodiert -- genau das war die Falle'
);

echo "territory-wiki-apply ok\n";
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-apply-test.php`
Expected: FATAL — die Datei gibt es noch nicht.

- [ ] **Step 3: Datei anlegen, Adapter schreiben**

Neu, `api/_internal/wiki/territory-wiki-plan-apply.php`:

```php
<?php

declare(strict_types=1);

// The APPLY half of the territory WIKI COPY sync: it works through the rows an editor ticked and
// writes exactly those. Design: …/2026-08-06-sync-uebernahme-territorien-design.md §4, session 4.
//
// 💣 IT WRITES BY CALLING THE UNCHANGED avesmapsPoliticalUpsertWikiRecord -- the same function that
// filled political_territory_wiki for as long as it had a writer. The only thing this change moves is
// WHO decides that it runs: the crawler before, a tick now.
//
// It lives in its own file so the compute half can be shown not to reach a writer
// (__tests__/sync-plan-purity-test.php walks the call graph from avesmapsTerritoryWikiPlanStep).
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * A staging row, shaped into the record avesmapsPoliticalUpsertWikiRecord expects. PURE.
 *
 * 💣 THE JSON COLUMNS MUST BE DECODED FIRST. The upsert pushes every *_json value through
 * avesmapsPoliticalEncodeJsonOrNull, which calls json_encode -- hand it the staging column verbatim
 * and the copy stores a DOUBLE-encoded string. Silent: the field is filled, the preview row looked
 * right, and only the infobox shows the quotes.
 *
 * id and synced_at are dropped: the first is the staging table's own identity, the second its clock.
 *
 * @param array<string,mixed> $row
 * @return array<string,mixed>
 */
function avesmapsTerritoryWikiRecordFromStagingRow(array $row): array {
    $jsonColumns = ['affiliation_path_json', 'affiliation_json', 'founded_json', 'dissolved_json', 'raw_json'];
    $record = $row;
    unset($record['id'], $record['synced_at']);

    foreach ($jsonColumns as $column) {
        $value = $record[$column] ?? null;
        if (is_array($value)) {
            continue;
        }
        $decoded = ($value === null || $value === '') ? null : json_decode((string) $value, true);
        $record[$column] = is_array($decoded) ? $decoded : [];
    }

    // The upsert reads 'slug' for nothing on this path, but avesmapsPoliticalNormalizeWikiRecord's
    // consumers expect the key to exist. Derive it the same way the normaliser does.
    if (!isset($record['slug']) || (string) $record['slug'] === '') {
        $record['slug'] = avesmapsPoliticalSlug((string) ($record['name'] ?? ''));
    }

    return $record;
}
```

- [ ] **Step 4: Test grün (nur der Adapter)**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-apply-test.php`
Expected: PASS, `territory-wiki-apply ok`

- [ ] **Step 5: Den Ausführ-Schritt schreiben**

Weiter in `territory-wiki-plan-apply.php`:

```php
/**
 * ONE bounded apply step. Resumable: every handled row carries its apply_state.
 *
 * 💣 NO try/catch AROUND THE ROW. A "this one is broken, carry on" catch would move the run past a
 * row that was rolled back; here an exception leaves the loop, the client reports it, and a second
 * click resumes exactly there.
 *
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsTerritoryWikiApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array {
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    avesmapsEnsureSyncPlanTables($pdo);

    $totals = ['applied' => 0, 'deleted' => 0, 'stale' => 0, 'processed' => 0];
    $stagingFind = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
        . ' WHERE wiki_key = :wk LIMIT 1');
    $mirrorFind = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE wiki_key = :wk LIMIT 1');
    $usedBy = $pdo->prepare('SELECT COUNT(*) FROM political_territory t
        JOIN political_territory_wiki w ON w.wiki_key = :wk
        WHERE t.is_active = 1 AND (t.wiki_id = w.id OR t.wiki_key = :wk2)');
    $deleteMirror = $pdo->prepare('DELETE FROM political_territory_wiki WHERE wiki_key = :wk');
    $declined = array_flip(avesmapsSyncPlanDeclinedKeys($pdo, 'territory_wiki'));

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $wikiKey = (string) $row['entity_key'];
        $changeType = (string) $row['change_type'];

        $stagingFind->execute(['wk' => $wikiKey]);
        $staging = $stagingFind->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($changeType === 'deleted') {
            $usedBy->execute(['wk' => $wikiKey, 'wk2' => $wikiKey]);
            $refusal = '';
            if ($staging !== null) {
                $refusal = 'Der Artikel steht wieder im Wiki.';
            } elseif (isset($declined[$wikiKey])) {
                $refusal = 'Die Loeschung wurde inzwischen abgelehnt.';
            } elseif ((int) $usedBy->fetchColumn() > 0) {
                // 💣 The re-check that matters most: a territory was linked to this copy since the
                // preview was computed. Deleting now would strip six infobox lines off a live object.
                $refusal = 'Inzwischen haengt ein Gebiet der Karte an dieser Kopie.';
            }
            if ($refusal !== '') {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', $refusal);
                $totals['stale']++;
            } else {
                $deleteMirror->execute(['wk' => $wikiKey]);
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['deleted']++;
            }
        } elseif ($staging === null) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Im Staging nicht mehr enthalten.');
            $totals['stale']++;
        } else {
            // 💣 THE RE-CHECK (design §6f), recomputed with the SAME function that built the row.
            $mirrorFind->execute(['wk' => $wikiKey]);
            $mirror = $mirrorFind->fetch(PDO::FETCH_ASSOC) ?: null;
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsTerritoryWikiPlanItem($mirror, $staging);
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $fresh['after'] ?? null)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                avesmapsPoliticalUpsertWikiRecord($pdo, avesmapsTerritoryWikiRecordFromStagingRow($staging));
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['applied']++;
            }
        }

        if (microtime(true) >= $deadline) {
            break;
        }
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];
    if ($done) {
        $closing = avesmapsTerritoryWikiApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        'deleted' => $totals['deleted'],
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}
```

- [ ] **Step 6: Der Abschluss**

Weiter in derselben Datei — struktur- und wortgleich zu `avesmapsCitymapApplyFinish`
(`citymap-plan-apply.php:145-234`), mit drei Unterschieden:

```php
/**
 * Everything that happens ONCE, after the last ticked row.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsTerritoryWikiApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array {
```

1. `'citymap'` → `'territory_wiki'` in den drei `avesmapsSyncPlan{RecordSkip,RecordDecline,ClearSkip}`-Aufrufen
   und im `avesmapsLogSyncPlanApply`-Aufruf.
2. Statt `avesmapsResolvePlacesInTable` / `avesmapsAppSettingSet`:

```php
    // Freshly created copies get their territory link. The same relink the old crawl ended with -- a
    // copy nobody points at is invisible to territory-detail, and that is where the infobox reads.
    avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey($pdo);
```

3. Beide Zwischenspeicher leeren, nicht nur einer:

```php
    // 💣 BOTH caches. political_territory_wiki is LEFT JOINed by map-features (the "Liegt in" resolver,
    // map-features.php:589) AND by the political layer, which keeps a 300 s file cache of its own. A
    // revision bump alone would leave the layer serving the pre-Übernahme payload for five minutes.
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }
    if (function_exists('avesmapsPoliticalInvalidateLayerCache')) {
        avesmapsPoliticalInvalidateLayerCache();
    }
```

- [ ] **Step 7: Die Protokoll-Beschriftung**

In `api/_internal/map/collection-audit.php`, `AVESMAPS_COLLECTION_AUDIT_KIND_LABELS` ergänzen:

```php
    'territory_wiki' => 'Wiki-Kopie der Herrschaftsgebiete',
    'territory' => 'Herrschaftsgebiete',
```

- [ ] **Step 8: Syntax + Test**

Run: `php -l api/_internal/wiki/territory-wiki-plan-apply.php && php -l api/_internal/map/collection-audit.php`
Expected: `No syntax errors detected` (2×)
Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-apply-test.php`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add api/_internal/wiki/territory-wiki-plan-apply.php api/_internal/wiki/__tests__/territory-wiki-apply-test.php api/_internal/map/collection-audit.php && git commit -m "feat(sync): the apply half of the territory wiki-copy preview"
```

---

## Task 5: Die Rechen-Hälfte der Karte

**Files:**
- Create: `api/_internal/wiki/territory-plan.php`
- Test: `api/_internal/wiki/__tests__/territory-plan-test.php` (neu)

**Interfaces:**
- Consumes: `avesmapsWikiSyncMonitorApplyIdentityPreview` (rein, liefert `changed[]` mit
  `id`, `wiki_key`, `name`, `changes[feld][from|to]`, `eff[]`),
  `avesmapsWikiSyncMonitorApplyParentCache($pdo, [], true)` (Trockenlauf),
  `avesmapsWikiSyncMonitorApplyCustomNodes($pdo, true)` (Trockenlauf).
- Produces:
  `avesmapsTerritoryPlanRoleShift(array $counts, string $child, ?string $oldParent, ?string $newParent): string`
  `avesmapsTerritoryPlanNodeCounts(PDO $pdo): array<string,array{name:string,own_geometry:int,children:int}>`
  `avesmapsTerritoryPlanParentMoves(PDO $pdo): array<string,array{name:string,old_key:?string,old_name:string,new_key:string,new_name:string}>`
  `avesmapsTerritoryPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array{done,nextCursor,run_id,planned,processed,counts}`

- [ ] **Step 1: Den Test der Rollen-Verschiebung schreiben**

Neu, `api/_internal/wiki/__tests__/territory-plan-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * 💣 Der Aussengrenzen-Hinweis: WAS ein Eltern-Umzug nebenbei bewirkt. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php
 *
 * Die abgeleitete Aussengrenze gehoert nur einem REINEN BEHAELTER (kein eigenes Polygon, aggregiert
 * Kinder) oder einer Wurzel. An genau diesem Praedikat hingen nacheinander vier Fehler. Diese Funktion
 * RECHNET NICHTS NACH und ruft NICHTS aus dem Aussengrenzen-System -- sie sagt einen Satz. Der Test
 * haelt beides fest: dass der Satz stimmt, und dass er ein Satz bleibt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-plan.php';

// counts[wiki_key] = ['name' => …, 'own_geometry' => int, 'children' => int]
$counts = [
    'wiki:grafschaft-ragath' => ['name' => 'Grafschaft Ragath', 'own_geometry' => 0, 'children' => 1],
    'wiki:f-rstentum-almada' => ['name' => 'Fürstentum Almada', 'own_geometry' => 0, 'children' => 4],
    'wiki:mark-ragathsquell' => ['name' => 'Mark Ragathsquell', 'own_geometry' => 1, 'children' => 1],
    'wiki:baronie-schwarztannen' => ['name' => 'Baronie Schwarztannen', 'own_geometry' => 1, 'children' => 0],
];

// --- Der alte Elternteil verliert sein letztes Kind ------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note !== '', 'ein Umzug, der eine Rolle kippt, sagt es');
assert(str_contains($note, 'Grafschaft Ragath'), 'der alte Elternteil wird benannt');
assert(str_contains($note, 'kein Behälter mehr'), 'und was mit ihm passiert');

// --- Der neue Elternteil wird zum Behaelter ---------------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:baronie-schwarztannen');
assert($note === '', 'ein Umzug auf sich selbst ist keiner');

$counts['wiki:neue-mark'] = ['name' => 'Neue Mark', 'own_geometry' => 0, 'children' => 0];
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:neue-mark');
assert(str_contains($note, 'Neue Mark'), 'der neue Elternteil wird benannt');
assert(str_contains($note, 'wird zum Behälter'));

// --- Ein Umzug ohne Rollenwechsel sagt nichts -------------------------------------------------------
//
// Almada hat vier Kinder und behaelt drei; Ragathsquell traegt ein eigenes Polygon und bleibt so oder
// so gesperrt. Ein Hinweis, der bei jeder Zeile steht, wird nicht gelesen.
$counts['wiki:grafschaft-ragath']['children'] = 5;
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note === '', 'kein Rollenwechsel => kein Hinweis');

// --- 💣 Und die Datei ruft nichts aus dem Aussengrenzen-System -------------------------------------
$source = (string) file_get_contents(__DIR__ . '/../territory-plan.php');
foreach (['DerivedGeometry', 'derived_geometry', 'GenerateOrUpdate', 'RecomputeDerived'] as $forbidden) {
    assert(!str_contains($source, $forbidden), "💣 die Rechen-Haelfte fasst {$forbidden} nicht an");
}

echo "territory-plan ok\n";
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: FATAL — die Datei gibt es noch nicht.

- [ ] **Step 3: Die Datei anlegen und die Rollen-Verschiebung schreiben**

Neu, `api/_internal/wiki/territory-plan.php`:

```php
<?php

declare(strict_types=1);

// The COMPUTE half of the territory MAP sync: what "3 · Übernehmen" would write into
// political_territory. Design: …/2026-08-06-sync-uebernahme-territorien-design.md §5, session 4.
//
// 🔴 IT CALLS NOTHING FROM THE DERIVED-BOUNDARY SYSTEM. A parent move changes which nodes may own an
// outer boundary -- four bugs hung on that one predicate, the last of them fail-OPEN, and since
// 6e8fcccc the recomputation hangs in the save path as a before-save transform WITHOUT try/catch, so a
// throw there takes the whole save with it. This file NAMES the consequence in a sentence and stops.
//
// Side-effect-free on include: function definitions only.

/**
 * What a parent move does to the outer-boundary ROLE of up to three nodes. PURE, and a sentence.
 *
 * The rule (territory-derived-geometry-editor.js, isOwnDerivedBoundaryForbidden): a node owns a
 * derived outer boundary only if it is a pure container -- no own polygon AND it aggregates children --
 * or a root. So a move can flip two neighbours: the OLD parent losing its last child stops being a
 * container, and the NEW parent gaining its first one becomes one.
 *
 * Returns '' when nothing flips. 💣 That matters: a note on every row is a note nobody reads.
 *
 * @param array<string,array{name:string,own_geometry:int,children:int}> $counts keyed by wiki_key
 */
function avesmapsTerritoryPlanRoleShift(array $counts, string $child, ?string $oldParent, ?string $newParent): string {
    if ($oldParent === $newParent || $newParent === $child) {
        return '';
    }

    $isContainer = static fn(array $node): bool => (int) $node['own_geometry'] === 0 && (int) $node['children'] > 0;
    $parts = [];

    if ($oldParent !== null && isset($counts[$oldParent])) {
        $before = $counts[$oldParent];
        $after = $before;
        $after['children'] = max(0, (int) $before['children'] - 1);
        if ($isContainer($before) && !$isContainer($after)) {
            $parts[] = sprintf(
                '%s verliert sein letztes Kind und ist danach kein Behälter mehr — eine bestehende '
                . 'Außengrenze wird dadurch überflüssig.',
                $before['name']
            );
        }
    }

    if ($newParent !== null && isset($counts[$newParent])) {
        $before = $counts[$newParent];
        $after = $before;
        $after['children'] = (int) $before['children'] + 1;
        if (!$isContainer($before) && $isContainer($after)) {
            $parts[] = sprintf('%s wird zum Behälter und darf danach eine eigene Außengrenze haben.', $before['name']);
        }
    }

    if ($parts === []) {
        return '';
    }

    return 'Ändert die Außengrenzen-Rolle: ' . implode(' ', $parts)
        . ' Die Übernahme rechnet nichts nach und löscht nichts — sie setzt den Elternteil.';
}
```

- [ ] **Step 4: Die Zählungen holen**

Weiter in derselben Datei:

```php
/**
 * Own polygons and child count per territory, keyed by wiki_key. TWO aggregate queries, no N+1 --
 * this runs on STRATO, and the derived layer next door is already a known hotspot (AGENTS.md §10).
 *
 * @return array<string,array{name:string,own_geometry:int,children:int}>
 */
function avesmapsTerritoryPlanNodeCounts(PDO $pdo): array {
    $counts = [];
    $rows = $pdo->query(
        "SELECT t.wiki_key, t.name,
                (SELECT COUNT(*) FROM political_territory_geometry g
                  WHERE g.territory_id = t.id AND g.is_active = 1) AS own_geometry,
                (SELECT COUNT(*) FROM political_territory c
                  WHERE c.parent_id = t.id AND c.is_active = 1) AS children
           FROM political_territory t
          WHERE t.is_active = 1 AND t.wiki_key IS NOT NULL AND t.wiki_key <> ''"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    foreach ($rows as $row) {
        $counts[(string) $row['wiki_key']] = [
            'name' => (string) $row['name'],
            'own_geometry' => (int) $row['own_geometry'],
            'children' => (int) $row['children'],
        ];
    }

    return $counts;
}
```

- [ ] **Step 5: Der Rechen-Schritt**

Weiter in derselben Datei. Er läuft in **einem** Schritt: die drei Quellen sind je eine Abfrage über
den ganzen Bestand, kein Cursor.

```php
/**
 * The map plan, in ONE step: the three sources are each a single pass over the whole set, so there is
 * nothing to resume. ONE ROW PER TERRITORY (design §5) -- data fields and the parent move travel
 * together, because the entity is the territory.
 *
 * 🔴 Writes plan rows only.
 *
 * @return array{done:bool, nextCursor:string, run_id:int, planned:int, processed:int, counts:array}
 */
function avesmapsTerritoryPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array {
    unset($cursor, $budget); // one pass; the signature matches its neighbours on purpose
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    avesmapsEnsureSyncPlanTables($pdo);

    $stamp = (string) ($pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)
        ->fetchColumn() ?: '');
    $runId = avesmapsSyncPlanStartRun($pdo, 'territory', $userId, $stamp === '' ? null : $stamp);
    $decisions = avesmapsSyncPlanDecisions($pdo, 'territory');
    $nodeCounts = avesmapsTerritoryPlanNodeCounts($pdo);

    // --- the three read-only sources -------------------------------------------------------------
    $identity = avesmapsWikiSyncMonitorApplyIdentityPreview($pdo);
    $parents = avesmapsWikiSyncMonitorApplyParentCache($pdo, [], true);
    $custom = avesmapsWikiSyncMonitorApplyCustomNodes($pdo, true);

    // --- Geändert: one row per territory ----------------------------------------------------------
    $rows = [];
    foreach (($identity['changed'] ?? []) as $entry) {
        $wikiKey = (string) $entry['wiki_key'];
        $before = [];
        $after = [];
        foreach (($entry['changes'] ?? []) as $field => $change) {
            $before[$field] = $change['from'] === null ? '' : (string) $change['from'];
            $after[$field] = $change['to'] === null ? '' : (string) $change['to'];
        }
        $rows[$wikiKey] = [
            'label' => (string) $entry['name'],
            'public_id' => null,
            'before' => $before,
            'after' => $after,
            // Every named data field can be pinned at its CURRENT live value. ⚠️ No claim about where
            // that value came from: political_territory carries no "edited by hand" mark, so a tag
            // saying so would be a guess (design §5).
            'pin_fields' => array_keys($before),
        ];
    }

    $parentMoves = avesmapsTerritoryPlanParentMoves($pdo);
    foreach ($parentMoves as $wikiKey => $move) {
        if (!isset($rows[$wikiKey])) {
            $rows[$wikiKey] = ['label' => $move['name'], 'public_id' => null,
                'before' => [], 'after' => [], 'pin_fields' => []];
        }
        $rows[$wikiKey]['before']['parent'] = $move['old_name'];
        $rows[$wikiKey]['after']['parent'] = $move['new_name'];
        $note = avesmapsTerritoryPlanRoleShift($nodeCounts, $wikiKey, $move['old_key'], $move['new_key']);
        if ($note !== '') {
            $rows[$wikiKey]['after']['boundary_note'] = $note;
        }
    }

    $planned = 0;
    foreach ($rows as $wikiKey => $row) {
        $after = $row['after'];
        if ($row['pin_fields'] !== []) {
            $after['pin_fields'] = implode(',', $row['pin_fields']);
        }
        $decision = $decisions[avesmapsSyncPlanDecisionKey((string) $wikiKey, 'changed')] ?? null;
        avesmapsSyncPlanAddItem($pdo, $runId, [
            'entity_key' => (string) $wikiKey,
            'entity_public_id' => $row['public_id'],
            'change_type' => 'changed',
            'label' => $row['label'],
            'before' => $row['before'],
            'after' => $after,
            'override' => [],
            'selected' => avesmapsSyncPlanDefaultSelected('changed', (int) ($decision['skipped_count'] ?? 0)),
        ]);
        $planned++;
    }

    // --- Neu: the own nodes that do not exist on the map yet --------------------------------------
    foreach (($custom['to_create'] ?? []) as $node) {
        $parentKey = $node['parent_wiki_key'] === null ? '' : (string) $node['parent_wiki_key'];
        avesmapsSyncPlanAddItem($pdo, $runId, [
            'entity_key' => (string) $node['wiki_key'],
            'entity_public_id' => null,
            'change_type' => 'new',
            'label' => (string) $node['name'],
            'before' => [],
            'after' => ['parent' => $parentKey === ''
                ? '(Wurzel)'
                : (string) ($nodeCounts[$parentKey]['name'] ?? $parentKey)],
            'override' => [],
            'selected' => avesmapsSyncPlanDefaultSelected('new', 0),
        ]);
        $planned++;
    }

    // 💣 NO deleted rows, ever. A territory is never deleted by this sync -- the group says so itself
    // (SYNC_PLAN_KIND_NO_DELETION_NOTE.territory).
    $counts = avesmapsSyncPlanFinishBuild($pdo, $runId);

    return [
        'done' => true,
        'nextCursor' => '',
        'run_id' => $runId,
        'planned' => $planned,
        'processed' => count($rows) + count($custom['to_create'] ?? []),
        'counts' => $counts,
    ];
}

/**
 * The parent moves the model would apply, with both names. Read-only; the same join the dry-run of
 * avesmapsWikiSyncMonitorApplyParentCache counts, plus the CURRENT parent's name for the "alt → neu".
 *
 * @return array<string,array{name:string,old_key:?string,old_name:string,new_key:string,new_name:string}>
 */
function avesmapsTerritoryPlanParentMoves(PDO $pdo): array {
    $rows = $pdo->query(
        'SELECT child.wiki_key AS child_key, child.name AS child_name,
                oldp.wiki_key AS old_key, oldp.name AS old_name,
                parent.wiki_key AS new_key, parent.name AS new_name
           FROM political_territory child
           JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
           JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key
                AND parent.is_active = 1 AND parent.id <> child.id
           LEFT JOIN political_territory oldp ON oldp.id = child.parent_id
          WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL
            AND (child.parent_id IS NULL OR child.parent_id <> parent.id)
          ORDER BY child.name ASC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $moves = [];
    foreach ($rows as $row) {
        $moves[(string) $row['child_key']] = [
            'name' => (string) $row['child_name'],
            'old_key' => $row['old_key'] === null ? null : (string) $row['old_key'],
            'old_name' => $row['old_name'] === null ? '(keiner)' : (string) $row['old_name'],
            'new_key' => (string) $row['new_key'],
            'new_name' => (string) $row['new_name'],
        ];
    }

    return $moves;
}
```

- [ ] **Step 6: Test grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: PASS, `territory-plan ok`
Run: `php -l api/_internal/wiki/territory-plan.php`
Expected: `No syntax errors detected`

- [ ] **Step 7: Beißprobe**

Entferne in `avesmapsTerritoryPlanRoleShift` die Bedingung `&& !$isContainer($after)`, Test erneut.
Expected: FAIL bei „kein Rollenwechsel => kein Hinweis". Danach zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add api/_internal/wiki/territory-plan.php api/_internal/wiki/__tests__/territory-plan-test.php && git commit -m "feat(sync): the compute half of the territory map preview, with the boundary-role note"
```

---

## Task 6: Die Ausführ-Hälfte der Karte

**Files:**
- Create: `api/_internal/wiki/territory-plan-apply.php`
- Test: erweitert `api/_internal/wiki/__tests__/territory-plan-test.php`

**Interfaces:**
- Consumes: `avesmapsWikiSyncMonitorApplyParentCache(…, ?array $only)`,
  `avesmapsWikiSyncMonitorApplyCustomNodes(…, ?array $only)`,
  `avesmapsWikiSyncMonitorApplyIdentity($pdo, [], $only, 0, false)` (Task 2 + vorhanden).
- Produces: `avesmapsTerritoryApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array{…}`

- [ ] **Step 1: Die Zusicherung zur Reihenfolge schreiben**

An `territory-plan-test.php` anhängen, vor `echo`:

```php
// --- 💣 Die Reihenfolge der drei Schreiber ist tragend ----------------------------------------------
//
// Eltern zuerst (Wiki-Knoten), dann die eigenen Knoten (die legen an UND haengen ein), dann die Daten.
// Umgekehrt zeigte eine Eltern-Zuweisung auf einen eigenen Knoten, den es noch nicht gibt -- sie
// landete stillschweigend in `unresolved` statt zu wirken.
$apply = (string) file_get_contents(__DIR__ . '/../territory-plan-apply.php');
$order = [];
foreach (['ApplyParentCache', 'ApplyCustomNodes', 'ApplyIdentity'] as $writer) {
    $position = strpos($apply, 'avesmapsWikiSyncMonitor' . $writer . '(');
    assert($position !== false, "die Ausfuehr-Haelfte ruft {$writer}");
    $order[] = $position;
}
assert($order === array_values(array_filter($order)) && $order[0] < $order[1] && $order[1] < $order[2],
    '💣 Eltern -> eigene Knoten -> Daten');

// Und sie ruft sie POSITIV: kein Aufruf ohne only-Liste.
assert(!preg_match('/ApplyParentCache\(\s*\$pdo\s*,\s*\[\]\s*,\s*false\s*\)/', $apply),
    '💣 kein Aufruf ohne only -- das schriebe jede Divergenz mit');
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: FAIL/FATAL — `territory-plan-apply.php` gibt es noch nicht.

- [ ] **Step 3: Die Datei schreiben**

Neu, `api/_internal/wiki/territory-plan-apply.php`:

```php
<?php

declare(strict_types=1);

// The APPLY half of the territory MAP sync. Design: …-territorien-design.md §5, session 4.
//
// 💣 IT WRITES BY CALLING THE THREE UNCHANGED WRITERS -- avesmapsWikiSyncMonitorApplyParentCache,
// …ApplyCustomNodes, …ApplyIdentity. Not copies of them: the same functions, with a POSITIVE selection
// (design §6a). Every guarantee they carry -- the override precedence, the identity backup, the
// excluded-node skip -- therefore holds unchanged and needed no re-proving.
//
// 🔴 IT CALLS NOTHING FROM THE DERIVED-BOUNDARY SYSTEM. See territory-plan.php for why.
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * ONE bounded apply step: it takes up to $budget ticked rows and hands their keys to the three
 * writers as an `only` list. Bulk writers, bounded by the subset -- not by a cursor.
 *
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsTerritoryApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array {
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    avesmapsEnsureSyncPlanTables($pdo);

    $pending = avesmapsSyncPlanPendingItems($pdo, $runId, $budget);
    $changedKeys = [];
    $newKeys = [];
    foreach ($pending as $row) {
        $key = (string) $row['entity_key'];
        if ((string) $row['change_type'] === 'new') {
            $newKeys[] = $key;
            continue;
        }
        $changedKeys[] = $key;
    }

    $applied = 0;
    if ($newKeys !== [] || $changedKeys !== []) {
        // 💣 THE ORDER IS LOAD-BEARING. Parents first, then the own nodes (they create AND link), then
        // the data fields. The other way round, a parent assignment pointing at an own node that does
        // not exist yet lands in `unresolved` instead of taking effect.
        avesmapsWikiSyncMonitorApplyParentCache($pdo, [], false, $changedKeys);
        if ($newKeys !== []) {
            avesmapsWikiSyncMonitorApplyCustomNodes($pdo, false, $newKeys);
        }
        // ⚠️ ApplyIdentity recomputes its own preview and filters by `only`. That IS the re-check
        // (design §6f): a key whose change has vanished since the plan was built simply produces no
        // target, so it is never written -- and shows up below as `stale`.
        if ($changedKeys !== []) {
            avesmapsWikiSyncMonitorApplyIdentity($pdo, [], $changedKeys, 0, false);
        }
    }

    // What actually happened, read back per row rather than assumed: the writers are bulk, so the only
    // honest per-row answer comes from the current state.
    $stale = 0;
    $parentStill = $pdo->prepare(
        'SELECT COUNT(*) FROM political_territory child
           JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
           JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key
                AND parent.is_active = 1 AND parent.id <> child.id
          WHERE child.is_active = 1 AND child.wiki_key = :wk AND m.parent_wiki_key IS NOT NULL
            AND (child.parent_id IS NULL OR child.parent_id <> parent.id)'
    );
    $exists = $pdo->prepare('SELECT COUNT(*) FROM political_territory WHERE wiki_key = :wk AND is_active = 1');

    foreach ($pending as $row) {
        $key = (string) $row['entity_key'];
        $itemId = (int) $row['id'];
        if ((string) $row['change_type'] === 'new') {
            $exists->execute(['wk' => $key]);
            if ((int) $exists->fetchColumn() > 0) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $applied++;
            } else {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der eigene Knoten liess sich nicht anlegen.');
                $stale++;
            }
            continue;
        }
        $parentStill->execute(['wk' => $key]);
        if ((int) $parentStill->fetchColumn() > 0) {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Elternteil war nicht aufloesbar.');
            $stale++;
            continue;
        }
        avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
        $applied++;
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];
    if ($done) {
        $closing = avesmapsTerritoryApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $applied,
        'deleted' => 0,
        'stale' => $stale,
        'processed' => count($pending),
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}
```

- [ ] **Step 4: Der Abschluss**

Weiter in derselben Datei — wie `avesmapsTerritoryWikiApplyFinish` (Task 4, Step 6), mit `'territory'`
statt `'territory_wiki'` und ohne den Relink; stattdessen:

```php
    // The map payload carries name, type, validity and the parent backbone -- all three writers changed
    // them, so both caches have to be told (the political layer keeps its own 300 s file cache).
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }
    if (function_exists('avesmapsPoliticalInvalidateLayerCache')) {
        avesmapsPoliticalInvalidateLayerCache();
    }
    if (function_exists('avesmapsWikiSyncMonitorInvalidateModelTreeCache')) {
        avesmapsWikiSyncMonitorInvalidateModelTreeCache($pdo);
    }
    if (function_exists('avesmapsWikiSyncMonitorRecordEditorAction')) {
        avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
    }
```

⚠️ Es gibt **keine** `deleted_titles` — die Karte löscht nichts. Der `avesmapsLogSyncPlanApply`-Aufruf
bekommt `'deleted_titles' => []`.

- [ ] **Step 5: Tests grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: PASS
Run: `php -l api/_internal/wiki/territory-plan-apply.php`
Expected: `No syntax errors detected`

- [ ] **Step 6: Beißprobe**

Tausche in der Ausführ-Hälfte die Aufrufe von `ApplyParentCache` und `ApplyIdentity`, Test erneut.
Expected: FAIL bei „💣 Eltern -> eigene Knoten -> Daten". Danach zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add api/_internal/wiki/territory-plan-apply.php api/_internal/wiki/__tests__/territory-plan-test.php && git commit -m "feat(sync): the apply half of the territory map preview"
```

---

## Task 7: Endpunkt, require-Kette und Reinheit

**Files:**
- Modify: `api/edit/wiki/sync-plan.php:28-57` (requires + `AVESMAPS_SYNC_PLAN_KINDS`), `:230-235` (Ausführ-Arme)
- Modify: `api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php` (`$applyFiles`)
- Modify: `api/_internal/wiki/__tests__/sync-plan-purity-test.php` (die Wurzeln)

**Interfaces:**
- Consumes: `avesmapsTerritoryWikiApplyStep`, `avesmapsTerritoryApplyStep` (Tasks 4 + 6),
  `avesmapsTerritoryWikiPlanStep`, `avesmapsTerritoryPlanStep` (Tasks 3 + 5).
- Produces: die Arten `'territory_wiki'` und `'territory'` an `api/edit/wiki/sync-plan.php`.

- [ ] **Step 1: Die zwei Tests scharf stellen**

In `sync-plan-endpoint-chain-test.php`, `$applyFiles` ergänzen:

```php
    'territory-wiki-plan-apply.php',
    'territory-plan-apply.php',
```

In `sync-plan-purity-test.php` die Liste der Wurzeln (die Rechen-Hälften) um die zwei neuen erweitern —
sie steht unter dem Kommentar, der die vier vorhandenen nennt:

```php
    'avesmapsTerritoryWikiPlanStep',
    'avesmapsTerritoryPlanStep',
```

…und in der Liste der Nutztabellen, die keine Rechen-Hälfte anfassen darf, sicherstellen, dass
`political_territory`, `political_territory_wiki`, `political_territory_geometry` und
`wiki_territory_model` stehen. Fehlt eine, ergänzen.

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run:
```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-purity-test.php
```
Expected: FAIL — die Wurzeln sind unbekannt bzw. die Kette lädt die Dateien nicht.

- [ ] **Step 3: Den Endpunkt erweitern**

In `api/edit/wiki/sync-plan.php`, ans Ende des require-Blocks:

```php
// Session 4, territories: the model + identity libraries the two compute halves read, then the two
// apply halves. sync-monitor.php carries the table constants and is already in the chain via
// lore-sync.php -- required again here, explicitly, because "somebody else pulls it in" is exactly the
// assumption sync-plan-endpoint-chain-test.php exists to stop being true silently.
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-model.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-identity.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor-tree.php';
require_once __DIR__ . '/../../_internal/wiki/territory-wiki-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-wiki-plan-apply.php';
require_once __DIR__ . '/../../_internal/wiki/territory-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-plan-apply.php';
```

Die Artenliste:

```php
const AVESMAPS_SYNC_PLAN_KINDS = ['citymap', 'adventure', 'publication', 'lore', 'territory_wiki', 'territory'];
```

Die zwei Ausführ-Arme im `match ($kind)`:

```php
                'territory_wiki' => avesmapsTerritoryWikiApplyStep($pdo, $runId, $userId, $currentUser),
                'territory' => avesmapsTerritoryApplyStep($pdo, $runId, $userId, $currentUser),
```

- [ ] **Step 4: Tests grün**

Run:
```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php
```
Expected: PASS, `sync-plan-endpoint-chain ok (N Dateien, M Aufrufe)`
Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-purity-test.php`
Expected: PASS

- [ ] **Step 5: Beißprobe**

Schreibe in `avesmapsTerritoryWikiPlanStep` versuchsweise
`$pdo->exec("UPDATE political_territory_wiki SET name = name");` und führe den Reinheits-Test aus.
Expected: FAIL, mit genau dieser Funktion im Text. Danach entfernen.

- [ ] **Step 6: Commit**

```bash
git add api/edit/wiki/sync-plan.php api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php api/_internal/wiki/__tests__/sync-plan-purity-test.php && git commit -m "feat(sync): the preview endpoint accepts the two territory kinds"
```

---

## Task 8: Die zwei Rechen-Aktionen am Monitor-Endpunkt

**Files:**
- Modify: `api/edit/wiki/sync-monitor.php` (POST-`match`, requires)
- Test: erweitert `api/_internal/wiki/__tests__/territory-plan-test.php`

**Interfaces:**
- Consumes: `avesmapsTerritoryWikiPlanStep`, `avesmapsTerritoryPlanStep`.
- Produces: die POST-Aktionen `build_territory_wiki_plan` (mit `cursor`) und `build_territory_plan`.

- [ ] **Step 1: Die Zusicherung schreiben**

An `territory-plan-test.php` anhängen:

```php
// --- Die zwei Rechen-Aktionen haengen am Monitor-Endpunkt, nicht am Vorschau-Endpunkt --------------
//
// Gerechnet wird an Schritt 1 und Schritt 3 des Menuebands; der Vorschau-Endpunkt liest, haekelt und
// uebernimmt. Zwei Tueren fuer dasselbe waeren zwei Stellen, an denen ein Lauf beginnen kann.
$monitor = (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-monitor.php');
assert(str_contains($monitor, "'build_territory_wiki_plan' =>"), 'die Kopie rechnet hier');
assert(str_contains($monitor, "'build_territory_plan' =>"), 'die Karte auch');
assert(str_contains($monitor, 'territory-wiki-plan.php'), 'und die Datei ist geladen');
assert(str_contains($monitor, 'territory-plan.php'), 'die zweite ebenso');
```

- [ ] **Step 2: Zum Fehlschlagen bringen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: FAIL bei „die Kopie rechnet hier".

- [ ] **Step 3: Die Aktionen einbauen**

In `api/edit/wiki/sync-monitor.php` bei den übrigen `require_once`:

```php
require_once __DIR__ . '/../../_internal/wiki/sync-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-wiki-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-plan.php';
```

In den POST-`match ($action)`:

```php
            // Die Rechen-Haelften. Sie schreiben Planzeilen, keine Nutzdaten -- deshalb ohne den
            // dry_run/confirm-Riegel der Schreiber daneben, und deshalb ist ein zweiter Aufruf
            // ungefaehrlich: er loest den offenen Plan ab (Entwurf §6b).
            'build_territory_wiki_plan' => avesmapsTerritoryWikiPlanStep(
                $pdo,
                (string) ($payload['cursor'] ?? ''),
                (int) ($currentUser['id'] ?? 0)
            ),
            'build_territory_plan' => avesmapsTerritoryPlanStep(
                $pdo,
                '',
                (int) ($currentUser['id'] ?? 0)
            ),
```

⚠️ `$currentUser` muss im POST-Zweig vorhanden sein. Steht dort bislang nur
`avesmapsRequireUserWithCapability('edit')` ohne Zuweisung, das Ergebnis in `$currentUser` fangen und
den vorhandenen Aufruf ersetzen — nicht einen zweiten daneben stellen.

- [ ] **Step 4: Tests grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php`
Expected: PASS
Run: `php -l api/edit/wiki/sync-monitor.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```bash
git add api/edit/wiki/sync-monitor.php api/_internal/wiki/__tests__/territory-plan-test.php && git commit -m "feat(sync): the territory monitor computes the two preview plans"
```

---

## Task 9: Die Oberfläche — Menüband, Statuszeile, Blatt

**Files:**
- Modify: `html/wiki-sync-monitor.html` (Kopfzeile `:272-281`, Statuszeile `:283-290`, Skript-Ende, Handler `:1233-1340`)
- Prüfseite: `verify-sync-plan-territorien.html` (neu, **nicht** committen — der Baum trägt schon 40 davon unversioniert)

**Interfaces:**
- Consumes: `openSyncPlanSheet({ kind, mount, onApplied, onClose, onPin })` (Task 1),
  die Aktionen aus Task 8, `api/edit/wiki/sync-plan.php` (Task 7).
- Produces: nichts für spätere Aufgaben.

- [ ] **Step 1: Das Bauteil laden**

In `html/wiki-sync-monitor.html` im `<head>`, neben die vorhandenen `<link>`:

```html
<link rel="stylesheet" href="/css/components/sync-plan-sheet.css">
```

…und bei den Skripten am Ende, neben `/js/ui/dialog-drag.js`:

```html
<!-- Die Übernahme-Vorschau. Gewöhnliches Skript ohne App-Globals und ohne Griff ins Elternfenster --
     deshalb funktioniert diese Seite auch, wenn sie per window.open in einem eigenen Fenster steht. -->
<script src="/js/review/sync-plan-sheet.js"></script>
```

- [ ] **Step 2: Das Menüband umbauen**

Die Kacheln `btnCrawl`, `btnModel`, `btnDiff`, `btnCache`, `btnIdentPreview`, `btnApply` ersetzen durch
drei. Die Beschriftungen wörtlich:

```html
    <button class="btn2 primary" id="btnCrawl" title="Liest die Herrschaftsgebiete aus dem geholten Offline-Dump ins Staging, rechnet die Hierarchie neu und zeigt danach, was die Wiki-Kopie bekäme. Geschrieben wird erst, was du anhäkelst."><span class="t1">1 · 🚨 Syncen</span><span class="t2" id="stSync">—</span></button>
    <button class="btn2" id="btnModel" title="Berechnet die Hierarchie aus dem Staging neu (Locks + Aussortiert bleiben erhalten)"><span class="t1">2 · Hierarchie rechnen</span><span class="t2" id="stModel">—</span></button>
    <button class="btn2 primary" id="btnApply" title="Zeigt, was in die Karte geschrieben würde – Daten, Eltern-Zuweisungen und neue eigene Knoten. Geschrieben wird nur, was angehäkelt ist; Geometrien bleiben unberührt."><span class="t1">3 · Übernehmen</span><span class="t2" id="stApply">—</span></button>
```

Die Kacheln `btnLocalizeCoats`, `btnCoatsToggle`, `btnLinkCheck` bleiben unverändert stehen.

💣 **Vier Stellen im Skript zeigen sonst auf Kacheln, die es nicht mehr gibt** — `$('…')` liefert dann
`null`, und der Zugriff auf `.textContent` reißt die ganze Funktion mit. Die Seite lädt danach nicht
mehr, und zwar an einer Stelle, die mit dem Umbau nichts zu tun hat. Alle vier gehören in **diesen**
Schritt:

1. `loadEditorState()`, Zeilen 532–533: `$('stDiff').textContent = …` und `$('stTest').textContent = …`
   löschen. Die zwei Zeilen darüber (`stSync`, `stModel`) bleiben.
2. Zeile 1463: `$('stIdent').textContent = …` löschen.
3. Der ganze Block der alten Daten-Vorschau: das Markup `#identModal` (Zeilen 364–378), seine CSS-Regeln
   (`.ident-chip*`, `#identSearch`, `.ident-table`, `.ident-row`, `.ident-name`, `.ident-wk`,
   `.ident-changes`, `.ident-fld`, `.ident-old`, `.ident-arrow`, `.ident-new`, Zeilen ~250–266) und
   seine Handler (`identClose`, `identApply`, `identChips`, `identSearch`, `renderIdentChips`,
   `renderIdentRows`, `identFieldFilter`, Zeilen ~1455–1516).
   ⚠️ **`.ident-table` steht auch am `#geomModal`** (Zeile 384, „🗑 Nicht zugewiesene Geometrie") —
   diese eine Regel bleibt, sonst verliert ein Fenster seinen Rahmen, das mit alldem nichts zu tun hat.
4. Nach dem Löschen: `grep -n "ident" html/wiki-sync-monitor.html` darf nur noch die Treffer des
   Geometrie-Fensters zeigen.

- [ ] **Step 3: Statuszeile und Aufhänger**

In `<div id="status">` hinter `<span id="busy">`:

```html
  <span id="planOpen" class="muted" style="margin-left:8px"></span>
```

⚠️ `style="margin-left:8px"` folgt hier bewusst der Nachbarzeile `#busy` derselben Datei — eine neue
Regel für 8 px wäre eine zweite Wahrheit über denselben Abstand.

Unter `<div class="cols">` … `</div>` ein Aufhänger:

```html
<div id="planSheet" class="sync-plan-host" hidden></div>
```

- [ ] **Step 4: Die drei Handler schreiben**

Im Skriptteil, an die Stelle der alten `btnDiff`/`btnCache`/`btnIdentPreview`/`btnApply`-Handler:

💣 `onPin` braucht den `wiki_key` und den **alten** Wert der Zeile — beides steht in der Antwort von
`get` und nirgends sonst. Deshalb merkt sich der eigene Sender genau das, statt einen zweiten Zustand
zu führen.

```js
// --- Übernahme-Vorschau ---------------------------------------------------------------------------
// Zwei Arten, zwei Schritte: die Wiki-Kopie hängt an „1 · 🚨 Syncen", die Karte an „3 · Übernehmen".
// Eine offene Liste wird GEZEIGT, nicht neu gerechnet -- „Später" wäre sonst wertlos.
const PLAN_API = '/api/edit/wiki/sync-plan.php';
let planRows = {};   // id -> {entity_key, before}

async function planPost(body){
  const response = await fetch(PLAN_API, {method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const payload = await response.json().catch(()=>null);
  if(!response.ok || !payload || payload.ok !== true){
    const error = new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
    error.code = payload && payload.error && payload.error.code;
    throw error;
  }
  if(body.action === 'get' && payload.items){
    planRows = {};
    ['new','changed','deleted'].forEach(group => (payload.items[group]||[]).forEach(row => {
      planRows[row.id] = {entity_key: row.entity_key, before: row.before || {}};
    }));
  }
  return payload;
}

async function pinValues({id, fields}){
  const row = planRows[id];
  if(!row) return false;
  for(const field of fields){
    const value = row.before[field];
    // Der Live-Wert wird zum eigenen Wert. Ein leerer Live-Wert ist dabei ein gültiger eigener Wert:
    // „hier steht absichtlich nichts" ist eine Aussage, „" ist nur ihre Schreibweise.
    const result = await api('set_field_override', {method:'POST',
      body:{wiki_key: row.entity_key, field_key: field, value: value === undefined ? '' : String(value)}});
    if(!result || result.ok === false) return false;
  }
  await loadModel();
  return true;
}

async function openPlan(kind){
  await openSyncPlanSheet({
    kind: kind,
    mount: $('planSheet'),
    post: planPost,
    onApplied: async ()=>{ await loadModel(); await loadEditorState(); await refreshPlanStatus(); },
    onClose: ()=>{ refreshPlanStatus(); },
    onPin: pinValues,
  });
}

// Die Statuszeile nennt jede offene Liste mit ihrer Zahl. Ohne sie wäre eine liegengebliebene
// Vorschau unerreichbar -- es gibt keine Kachel mehr, die sie öffnet.
async function refreshPlanStatus(){
  const parts = [];
  for(const [kind, label] of [['territory_wiki','Wiki-Kopie'], ['territory','Karte']]){
    try{
      const plan = await planPost({action:'get', kind: kind});
      if(plan.run){
        const total = (plan.run.counts && plan.run.counts.total) || 0;
        parts.push(`<b>${label}</b> — ${total} Unterschiede <a href="#" data-open-plan="${kind}">öffnen</a>`);
      }
    }catch(e){ /* keine Liste ist kein Fehler */ }
  }
  $('planOpen').innerHTML = parts.length ? 'Vorschau offen: ' + parts.join(' · ') : '';
}

$('planOpen').addEventListener('click', (event)=>{
  const link = event.target.closest('[data-open-plan]');
  if(!link) return;
  event.preventDefault();
  openPlan(link.dataset.openPlan);
});
```

- [ ] **Step 5: Die zwei Kacheln verdrahten**

`btnCrawl`: nach dem Ende von `runCrawl()` (dort, wo heute „Syncen fertig …" gesetzt wird) den
Rechen-Schritt in der Cursor-Schleife anschließen und die Vorschau öffnen:

```js
  // Schritt 4/4: rechnen, was die Wiki-Kopie bekäme. Geschrieben wird nichts.
  setStatus('Vergleiche die Wiki-Kopie …');
  let cursor = '';
  for(let round = 0; round < 200; round++){
    const step = await api('build_territory_wiki_plan', {method:'POST', body:{cursor: cursor}});
    cursor = step.nextCursor || '';
    setStatus(`Vergleiche die Wiki-Kopie … ${step.planned} Unterschiede bisher.`);
    if(step.done) break;
  }
  await refreshPlanStatus();
  await openPlan('territory_wiki');
```

`btnApply`: der ganze alte Handler (`dry`/`dryOwn`/`ident` + `confirm()` + drei Schreib-Aufrufe) wird
ersetzt durch:

```js
$('btnApply').onclick = async()=>{
  busy(true);
  try{
    // Eine offene Liste wird gezeigt, nicht neu gerechnet -- sonst wären die Häkchen von gestern weg.
    const open = await planPost({action:'get', kind:'territory'});
    if(!open.run){
      setStatus('Rechne, was in die Karte ginge …');
      const step = await api('build_territory_plan', {method:'POST', body:{}});
      setStatus(`${step.counts.total} Unterschiede — Vorschau offen.`);
    }
    await openPlan('territory');
    await refreshPlanStatus();
  }catch(e){ setStatus('Fehler: '+e.message); }
  busy(false);
};
```

`btnModel`: an das Ende des vorhandenen Handlers anfügen:

```js
  // Die Eltern haben sich gerade geändert: eine offene Karten-Vorschau zählt nicht mehr.
  await refreshPlanStatus();
```

⚠️ Das **Zurückziehen** selbst passiert serverseitig — `avesmapsTerritoryPlanStep` ruft
`avesmapsSyncPlanStartRun`, und das setzt offene Läufe derselben Art auf `superseded`. Hier wird nur
die Anzeige aufgefrischt.

Und `refreshPlanStatus()` einmal beim Laden aufrufen, dort wo `loadEditorState()` beim Start steht.

- [ ] **Step 6: Prüfseite bauen und ansehen**

Neu, `verify-sync-plan-territorien.html` (nicht committen), nach dem Muster von
`verify-sync-plan-sheet.html`: echte CSS-Kette (`tokens.css`, `base.css`,
`components/sync-plan-sheet.css`), echtes `sync-plan-sheet.js`, ein `post`-Doppelgänger, der die
zwei Arten mit erfundenen Zeilen beantwortet — je eine mit `boundary_note`, eine mit `pin_fields`,
eine mit `fields_more`, dazu die leere Löschgruppe der Art `territory`.

Run: `preview_start` mit dieser Datei, dann Screenshot in **beiden** Themes
(`resize_window` mit `colorScheme: "light"` und `"dark"`).
Expected: der Warnblock hat Warnfarbe und volle Breite, „Werte festhalten" schaltet **nicht** das
Häkchen der Zeile um (anklicken und prüfen), die Gruppe „Gelöscht 0" trägt den Territorien-Satz.

- [ ] **Step 7: Alle Tests**

Run:
```bash
node js/review/__tests__/sync-plan-sheet.test.js
```
Run:
```bash
for t in territory-selection territory-wiki-plan territory-wiki-apply territory-plan sync-plan-purity; do php -d zend.assertions=1 -d assert.exception=1 "api/_internal/wiki/__tests__/$t-test.php"; done
```
Expected: jede Zeile endet mit `ok`.

- [ ] **Step 8: Commit**

```bash
git add html/wiki-sync-monitor.html && git commit -m "ui(sync): drei nummerierte Kacheln, zwei Vorschauen -- die Territorien schreiben nicht mehr ohne Haekchen"
```

---

## Nach dem letzten Task

- **Nicht deployen, ohne es zu sagen.** Der erste echte Lauf gehört beobachtet (siehe unten) — ein
  Push löst 1–2 Minuten später den Deploy aus.
- **Live prüfbar ohne Anmeldung:** `POST /api/edit/wiki/sync-plan.php` mit
  `{"action":"get","kind":"territory"}` muss **401** antworten, nicht 500; `GET /api/app/map-features.php`
  bleibt 200.
- 🔧 **DU, beim ersten echten Lauf:**
  1. **Die Zahl der Löschvorschläge in der Kopie-Vorschau.** Erwartung: klein (einstellig bis niedrig
     zweistellig). Kommen hunderte, hat „Syncen" nicht durchgelaufen — der Leer-Riegel kennt nur
     „leer", nicht „halb gefüllt".
  2. **Die Zahl unter „Geändert" beim ZWEITEN Lauf.** Sie muss deutlich kleiner sein als beim ersten.
     Ist sie es nicht, vergleicht ein Feld etwas, das sich bei jedem Dump ändert — dann gehört es aus
     `AVESMAPS_TERRITORY_WIKI_PLAN_FIELDS` heraus, so wie `raw_json` schon draußen ist.
  3. **Die Karten-Vorschau:** stehen dort Eltern-Umzüge, die niemand im Baum gemacht hat? Dann rechnet
     „2 · Hierarchie rechnen" anders als erwartet — das ist ein Baum-Problem, kein Vorschau-Problem.
  4. **Genau eine Zeile im Änderungsverlauf** je Übernahme, mit „Wiki-Kopie der Herrschaftsgebiete · N
     übernommen" bzw. „Herrschaftsgebiete · N übernommen".
- **Handbuch nicht anfassen** (AGENTS.md §9): die Commit-Betreffs nennen die sichtbare Wirkung, die
  nächtliche Routine `avesmaps-handbuch-pflege` schreibt den Rest.
