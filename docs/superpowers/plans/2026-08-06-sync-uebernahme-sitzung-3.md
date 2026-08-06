# Sitzung 3 — Orte, Wege, Regionen: eine Formensprache, zwei Quellen

> **Für agentische Bearbeiter:** Schritte sind Checkboxen. Vollständige Testsuite vor dem ersten Griff
> und nach jeder Aufgabe. Nur eigene Pfade stagen (AGENTS.md §9 — geteilter Arbeitsbaum).

**Ziel:** Die Falllisten von Orten, Wegen und Regionen bekommen die Formensprache der Übernahme-Vorschau,
und das Bauteil der Vorschau wird für eine zweite Zeilenquelle geöffnet (Abnehmer: Sitzung 4).

**Bauart:** Zwei getrennte Hälften, die nichts voneinander wissen. (1) `openSyncPlanSheet` bekommt einen
austauschbaren Transport statt eines fest verdrahteten Endpunkts. (2) Die Fall-Oberflächen behalten ihre
eigene Speicherung, ihre Verben und ihre Fall-Typologie — nur ihr Aussehen wird das des Blattes.

**Werkzeug:** Klassische `<script>`-Dateien ohne Bundler, CSS mit Tokens aus `css/base/tokens.css`,
Tests mit `node` (JS) bzw. `php -d zend.assertions=1 …` (PHP).

## Der Befund, der diesen Bauplan von §7 unterscheidet

Der Entwurf verlangt in §7, „die heutige Fall-Typologie an der Oberfläche durch die drei Kategorien
Neu/Geändert/Gelöscht zu ersetzen". **Das wird hier NICHT getan, und das ist kein Versehen.** Nachgezählt
am 06.08.2026, alle 16 Falltypen:

| | Zahl | welche |
|---|---|---|
| **Neu** ehrlich | 2 | `missing_wiki_with_coordinates`, `missing_wiki_without_coordinates` |
| **Geändert** ehrlich | 7 | `canonical_name_difference`, `type_conflict`, `probable_match`, `coordinate_drift`, `field_divergence`, `coat_available`, `verlauf_changed` |
| **Gelöscht** | **0** | keiner der drei Abgleiche löscht je etwas |
| **kein Zuhause** | 7 | `unresolved_without_candidate`, `duplicate_avesmaps_name`, `duplicate_wiki_title`, `missing_capital`, `course_conflict`, `station_missing`, `hops_unroutable` |

Und ein Häkchen ist bei genau **2 von 16** die richtige Form. Bei allen übrigen ist die Antwort nicht „ja",
sondern *„welcher von diesen"* und danach *„und so soll er heißen"*: „Lösen" öffnet ein **Formular** mit den
Voreinstellungen Karte/Wiki, das ein Mensch ausfüllt und abschickt (`openWikiSyncResolveDialogForCase`,
`js/review/review-wiki-sync-resolve.js:390`; der Server nimmt `name`/`feature_subtype`/`description`/
`wiki_url`/`is_nodix`/`is_ruined` entgegen, `api/_internal/wiki/locations.php:761`). „Position wählen" wartet
auf einen Kartenklick. „Hauptstadt zuweisen" ist ein Suchfeld.

💣 **Und die teuerste Stelle:** unter „Geändert" stünden die geänderten Wegverläufe vorangehäkelt, mit einem
„alle"-Knopf darüber. Genau dieser Sammelknopf wurde am **22.07.2026 ausgebaut**
(`js/review/review-path-sync.js:842`), nachdem er an echten Daten gemessen 70 Straßensegmente gelöst hätte —
jedes ein zusammenhängendes Stück seiner *eigenen* Straße. Vorangehäkelt wäre er schlimmer als vorher.

Owner-Entscheid 06.08.2026 nach Mockup (`docs/sync-uebernahme-fallliste-mockup.html`, Fassung B):
**gleiche Formensprache, die Knöpfe bleiben Knöpfe.**

## Globale Vorgaben

- **Keine Farbe, kein Radius, kein Abstand von Hand** — nur Tokens aus `css/base/tokens.css` (AGENTS.md §12).
- **Deutsch bleibt Deutsch** an der Oberfläche; Kommentare und Commit-Nachrichten Englisch oder Deutsch
  nach Dateikonvention, aber **ohne Umlaute in Commit-Nachrichten** (Hausstil).
- **Kein Dump, kein Sync, kein Massenlauf.** Keine Endpunkt-Schleife gegen STRATO.
- **Nur eigene Pfade stagen.** `git status` vor jedem Commit; fremde geänderte Dateien in Ruhe lassen.
- Editor-sichtbare Änderung ⇒ die Wirkung steht in der **Commit-Betreffzeile**; das Handbuch wird
  **nicht** angefasst (AGENTS.md §9).
- Ausgangslage: **114 PHP-Testdateien grün, 90 JS grün** (89 unter `js/`, 1 unter `tools/`).

---

### Aufgabe 0: Ausgangslage messen

- [ ] **Schritt 1: Volle Suite laufen lassen**

```bash
for f in $(find api -path "*__tests__*" -name "*.php" | sort); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll -d extension=php_openssl.dll "$f" >/dev/null 2>&1 || echo "ROT: $f"; done; for f in $(find js tools -path "*__tests__*" -name "*.test.js" | sort); do node "$f" >/dev/null 2>&1 || echo "ROT: $f"; done; echo fertig
```

Erwartet: keine einzige `ROT:`-Zeile.

---

### Aufgabe 1: Die Hülle öffnen — der Transport wird austauschbar

**Dateien:**
- Ändern: `js/review/sync-plan-sheet.js` (Zeile 502–517 `syncPlanPost`, 524–552 `openSyncPlanSheet`, 567–736 `syncPlanBindSheet`)
- Test: `js/review/__tests__/sync-plan-sheet.test.js` (anhängen)

**Schnittstellen:**
- Erzeugt: `syncPlanDefaultPost(body) → Promise<payload>` — der heutige Endpunkt-Aufruf, unverändert.
- Erzeugt: `syncPlanResolvePost(options) → function` — rein, wählt `options.post` oder den Standard.
- Ändert: `syncPlanPost(post, body)` — nimmt den Sender jetzt als **erstes** Argument.
- `openSyncPlanSheet({kind, mount, post?, onApplied?, onClose?})` — `post` ist neu und freiwillig.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `js/review/__tests__/sync-plan-sheet.test.js` anhängen:

```js
// ---- Der austauschbare Transport ---------------------------------------------------------------
//
// 🔴 Das Bauteil darf seine Zeilen aus einer ZWEITEN Quelle beziehen (Sitzung 4: die Territorien
// rechnen ihre Unterschiede längst als neu/verschwunden/geändert). Geprüft wird beides: dass die
// reine Wahl den eingereichten Sender nimmt, UND dass im ganzen Rumpf niemand am Sender vorbei
// direkt den Standard ruft -- sonst ist die Hülle offen und die Naht trotzdem festgeschweißt.
const resolvePost = sandbox.syncPlanResolvePost;
assert.strictEqual(typeof resolvePost, "function", "die reine Wahl ist geladen");
assert.strictEqual(typeof sandbox.syncPlanDefaultPost, "function");

const ownPost = async () => ({ ok: true });
assert.strictEqual(resolvePost({ post: ownPost }), ownPost, "ein eingereichter Sender gewinnt");
assert.strictEqual(resolvePost({}), sandbox.syncPlanDefaultPost, "ohne Angabe der Standard");
assert.strictEqual(resolvePost(null), sandbox.syncPlanDefaultPost, "und auch ohne options");
assert.strictEqual(resolvePost({ post: "nein" }), sandbox.syncPlanDefaultPost,
	"was keine Funktion ist, ist kein Sender");

// 💣 Presence is not execution: Kommentare erst weg, sonst zertifiziert der Test die Doku.
const body = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
const defaultMentions = (body.match(/syncPlanDefaultPost/g) || []).length;
assert.strictEqual(defaultMentions, 2,
	"genau zwei: die Definition und der EINE Rückfall in syncPlanResolvePost. Jede weitere Nennung "
	+ "ist ein Aufruf am eingereichten Sender vorbei.");
// Und jeder Sendeaufruf trägt seinen Sender als erstes Argument.
(body.match(/syncPlanPost\([^)]*/g) || []).forEach((call) => {
	assert.ok(/syncPlanPost\((post|options\.post|syncPlanDefaultPost|post,)/.test(call + ")"),
		`syncPlanPost ohne Sender: ${call}`);
});
```

- [ ] **Schritt 2: Test laufen lassen, Rot sehen**

Run: `node js/review/__tests__/sync-plan-sheet.test.js`
Erwartet: FAIL — `die reine Wahl ist geladen` (`syncPlanResolvePost` ist undefined).

- [ ] **Schritt 3: Umbauen**

In `js/review/sync-plan-sheet.js` `syncPlanPost` ersetzen durch:

```js
/**
 * Der Standardsender: der Endpunkt, den die Abgleiche der Sitzungen 1 und 2 benutzen.
 *
 * ⚠️ Er wird an genau EINER Stelle genannt (syncPlanResolvePost). Wer ihn irgendwo sonst direkt
 * ruft, hängt diese Stelle wieder fest -- der Test zählt die Nennungen.
 */
async function syncPlanDefaultPost(body) {
	const response = await fetch("/api/edit/wiki/sync-plan.php", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload || payload.ok !== true) {
		const error = new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
		error.code = payload && payload.error && payload.error.code;
		throw error;
	}

	return payload;
}

/**
 * Welcher Sender gilt. REIN.
 *
 * 🔴 Die eine Naht, an der eine zweite Quelle andockt (Entwurf §7, Sitzung 4). Das Blatt selbst weiß
 * nicht, woher seine Zeilen kommen -- der reine Markup-Teil wusste das noch nie, nur die DOM-Hälfte
 * war festgeschweißt.
 */
function syncPlanResolvePost(options) {
	const own = options && options.post;

	return typeof own === "function" ? own : syncPlanDefaultPost;
}

/** Einen Schritt schicken. Der Sender kommt zuerst, damit kein Aufruf ihn vergessen kann. */
function syncPlanPost(post, body) {
	return post(body);
}
```

In `openSyncPlanSheet` direkt nach der `mount`-Prüfung:

```js
	const post = syncPlanResolvePost(options);
```

und die drei Aufrufe darin bzw. in `syncPlanBindSheet` auf `syncPlanPost(post, {...})` umstellen.
`syncPlanBindSheet(mount, plan, options)` holt sich seinen Sender in der ersten Zeile ebenso:

```js
	const post = syncPlanResolvePost(options);
```

⚠️ `openSyncPlanSheet(options)` wird im Fehlerfall der Sammelknöpfe erneut gerufen (Zeile 644) — weil
der Sender in `options` steht, überlebt er das ohne Zutun.

- [ ] **Schritt 4: Test laufen lassen, Grün sehen**

Run: `node js/review/__tests__/sync-plan-sheet.test.js`
Erwartet: PASS.

- [ ] **Schritt 5: Der Test muss beißen**

Eine Kopie anlegen, in ihr `syncPlanResolvePost` so verfälschen, dass es immer den Standard liefert,
und den Test gegen die Kopie laufen lassen — er MUSS rot werden. Danach die Kopie löschen.

- [ ] **Schritt 6: Volle JS-Suite + Commit**

```bash
for f in $(find js tools -path "*__tests__*" -name "*.test.js" | sort); do node "$f" >/dev/null 2>&1 || echo "ROT: $f"; done; echo fertig
```

```bash
git add js/review/sync-plan-sheet.js js/review/__tests__/sync-plan-sheet.test.js && git commit -F .git/COMMIT_SITZUNG3_1
```

Betreff: `refactor(sync): die Uebernahme-Vorschau nimmt ihre Zeilen jetzt auch aus einer zweiten Quelle`

---

### Aufgabe 2: Die Prüfseite — die Falllisten ohne Anmeldung sichtbar machen

**Dateien:**
- Anlegen: `verify-fallliste.html` (Repo-Wurzel, wie die übrigen `verify-*.html`; **nicht** committen)

**Warum zuerst:** Die Falllisten sind datengetrieben und ohne Editor-Anmeldung leer. Die Prüfseite lädt
die **echte** `css/features/review-panel.css` samt Token-Kette und stellt repräsentatives Markup hinein —
in **beiden** Umgebungen, denn `createWikiSyncCaseElement` rendert auch ins Konfliktzentrum
(`js/review/review-conflicts.js:987`), und die Kästen sehen dort in einem anderen Elternteil.

- [ ] **Schritt 1: Seite anlegen**

Aufbau: `<link rel="stylesheet" href="/css/styles.css">` (zieht die Token-Kette), dann zwei Abschnitte:

```html
<h2>1 · Im WikiSync-Panel</h2>
<div class="review-panel"><div id="wiki-sync-case-list" class="review-panel__list--cases">
  <section class="wiki-sync-case-section">
    <h3 class="wiki-sync-case-section__title">Offen</h3>
    <div class="wiki-sync-case-section__body">
      <details class="wiki-sync-case-group" open>
        <summary class="wiki-sync-case-group__summary">
          <span class="wiki-sync-case-group__title">Abweichende Benennung</span>
          <span class="wiki-sync-case-group__count">12</span>
        </summary>
        <div class="wiki-sync-case-group__body">
          <details class="wiki-sync-case" open>
            <summary class="wiki-sync-case__summary">
              <span class="wiki-sync-case__title">Ferdok</span>
              <span class="wiki-sync-case__status wiki-sync-case__status--open">offen</span>
            </summary>
            <div class="wiki-sync-case__body">
              <p class="wiki-sync-case__row"><span class="wiki-sync-case__row-label">Karte</span><span class="wiki-sync-case__row-value">Ferdok &#183; Stadt</span></p>
              <p class="wiki-sync-case__row"><span class="wiki-sync-case__row-label">Wiki</span><span class="wiki-sync-case__row-value">Ferdok (Stadt)</span></p>
              <div class="wiki-sync-case__actions">
                <button class="wiki-sync-case__action wiki-sync-case__action--primary">L&#246;sen</button>
                <button class="wiki-sync-case__action wiki-sync-case__action--primary">Anzeigen</button>
                <button class="wiki-sync-case__action wiki-sync-case__action--danger">Zur&#252;ckstellen</button>
                <button class="wiki-sync-case__action wiki-sync-case__action--danger">Archivieren</button>
              </div>
            </div>
          </details>
        </div>
      </details>
    </div>
  </section>
</div></div>

<h2>2 · Im Konfliktzentrum (dasselbe Bauteil, anderer Elternteil)</h2>
<div id="conflict-list"><!-- dieselbe details.wiki-sync-case, ohne Gruppe darum --></div>
```

Dazu je ein Beispiel mit `wiki-sync-case__choices--duplicate` (nummerierte Orte, „Anzeigen"/
„Akzeptieren") und eines aus der Wege-Liste (`tree-item region-sync__item` mit
`wiki-sync-case__actions` darin), weil beide dieselben Knopfklassen tragen.

- [ ] **Schritt 2: Ansehen und den Ausgangszustand festhalten**

Im Browser-Pane öffnen, Bildschirmfoto machen. Das ist das „Vorher".

---

### Aufgabe 3: Die Knopf-Optik — die Ausnahme des Konfliktzentrums wird zur Regel

**Dateien:**
- Ändern: `css/features/review-panel.css:413-421` (die beiden Varianten) und `:1624-1660` (der `#conflict-list`-Block)

**Warum:** Der Block bei `:1624` sagt seit dem 21.07.2026 dasselbe, was diese Aufgabe verallgemeinert:
grün/rot „liest sich wie zwei verschiedene Programme", und „Rot war ausserdem irreführend: *Archivieren*
ändert gar keine Daten". Er ist bewusst nur auf `#conflict-list` gelegt worden — jetzt gilt er überall,
und die Kopie fällt weg.

- [ ] **Schritt 1: Die Varianten umschreiben**

```css
/* Eine Haupthandlung gefüllt, alles Weitere weich, das Lebenszyklus-Paar still (Designsprache §12).
   Diese Regel stand seit 2026-07-21 schon einmal da -- unter #conflict-list, weil dort auffiel, dass
   grün/rot neben den warmen Knöpfen wie zwei Programme aussieht und „Archivieren" gar nichts ändert.
   Sie gilt jetzt für beide Oberflächen; die Kopie unten ist deshalb entfallen. */
.wiki-sync-case__action {
	border: 1px solid var(--color-button-soft-border);
	background: var(--color-button-soft);
	color: var(--color-button-soft-text);
}

.wiki-sync-case__action:hover {
	background: var(--color-button-soft-hover);
}

.wiki-sync-case__action--primary {
	border-color: var(--color-button-border);
	background: var(--color-button);
	color: var(--color-button-text);
}

.wiki-sync-case__action--primary:hover {
	background: var(--color-button-hover);
}

/* „Zurückstellen" und „Archivieren" ändern KEINE Daten -- sie sind das Gegenteil einer Warnung.
   Der Klassenname bleibt `--danger`, weil ihn drei Dateien schreiben; die Bedeutung ist „still". */
.wiki-sync-case__action--danger {
	border-color: var(--color-divider);
	background: none;
	color: var(--color-text-muted);
}

.wiki-sync-case__action--danger:hover {
	background: var(--color-button-soft);
	color: var(--color-button-soft-text);
}
```

- [ ] **Schritt 2: Den `#conflict-list`-Block auf das eindampfen, was er noch beiträgt**

Die Regeln für `.wiki-sync-case__action*` dort ersatzlos streichen (sie stehen jetzt in der Grundform).
Behalten und behalten kommentieren: die `.wiki-sync-case__choice`-Regeln, falls sie sich von der
Grundform unterscheiden — sonst ebenfalls hochziehen.

- [ ] **Schritt 3: Prüfen**

`verify-fallliste.html` neu laden. Erwartet: in **beiden** Abschnitten dieselbe Knopfleiste — eine
gefüllte Haupthandlung, „Anzeigen" weich, „Zurückstellen"/„Archivieren" still. Bildschirmfoto.

- [ ] **Schritt 4: Commit**

Betreff: `ui(wikisync): die Fallknoepfe sehen ueberall gleich aus -- "Archivieren" ist nicht mehr rot`

---

### Aufgabe 4: Rahmen werden Trennlinien

**Dateien:**
- Ändern: `css/features/review-panel.css:1165-1270` (Gruppe, Fall, Zeilen)
- Ändern: `js/review/review-wiki-sync-cases.js` (`appendWikiSyncInfoRow` / `appendWikiSyncLinkRow`, Zeile 744–770)

**Warum die JS-Änderung:** Die Auskunftszeilen eines Falls sind heute lose `<p>` im Rumpf. Für das
ruhige Feld des Blattes (`.diff`) brauchen sie einen gemeinsamen Behälter. Ein Helfer legt ihn bei
Bedarf an — damit erben ihn alle vier Rumpfbauer (allgemein, Hauptstadt, Abweichung, Dubletten), ohne
dass einer von ihnen davon wissen muss.

- [ ] **Schritt 1: Den Behälter einziehen**

```js
/**
 * Der gemeinsame Kasten der Auskunftszeilen — angelegt beim ersten Aufruf, danach wiederverwendet.
 *
 * Ohne ihn wären es lose Absätze, und das ruhige Feld des Blattes (die Formensprache der
 * Übernahme-Vorschau) ließe sich nur durch eine Regel je Absatz nachbauen, die bei drei Zeilen drei
 * Ränder zieht. Ein Behälter ist die kleinere Änderung -- und alle vier Rumpfbauer erben ihn.
 */
function wikiSyncCaseFacts(bodyElement) {
	const existing = bodyElement.querySelector(":scope > .wiki-sync-case__facts");
	if (existing) {
		return existing;
	}

	const facts = document.createElement("div");
	facts.className = "wiki-sync-case__facts";
	bodyElement.appendChild(facts);

	return facts;
}
```

In `appendWikiSyncInfoRow` und `appendWikiSyncLinkRow` das abschließende
`bodyElement.appendChild(rowElement)` ersetzen durch `wikiSyncCaseFacts(bodyElement).appendChild(rowElement)`.

⚠️ `:scope >` ist wichtig: ein Fall im Konfliktzentrum kann einen zweiten Rumpf in sich tragen; ohne
`:scope` griffe der Helfer in den fremden.

- [ ] **Schritt 2: Die CSS-Umschrift**

```css
/* Gruppieren durch Trennlinie, nicht durch gerahmte Kästen (AGENTS.md §12). Diese Liste ist älter als
   die Regel und stand als Kasten-im-Kasten-im-Kasten neben der Übernahme-Vorschau, die es richtig
   macht -- in derselben Seite, in zwei Handschriften. */
.wiki-sync-case-group {
	overflow: hidden;
	border: 0;
	border-bottom: 1px solid var(--color-divider);
	border-radius: 0;
	background: none;
}

.wiki-sync-case-group:last-of-type {
	border-bottom: 0;
}

.wiki-sync-case-group__summary {
	list-style: none;
	justify-content: flex-start;
	gap: 10px;
	padding: 11px 2px;
}

.wiki-sync-case-group__summary::-webkit-details-marker {
	display: none;
}

/* Das Dreieck übernimmt die Rolle des Rahmens: es sagt, dass hier etwas aufgeht. */
.wiki-sync-case-group__summary::before {
	content: "\25B8";
	flex: none;
	width: 10px;
	color: var(--color-text-muted);
	font-size: var(--font-size-caption);
	transition: transform 0.12s;
}

.wiki-sync-case-group[open] > .wiki-sync-case-group__summary::before {
	transform: rotate(90deg);
}

.wiki-sync-case-group__count {
	border: 1px solid var(--color-pill-border);
}

/* Der erklärende Satz steht rechts und weicht als Erstes, wenn es eng wird. */
.wiki-sync-case-group__hint {
	margin-left: auto;
	color: var(--color-text-muted);
	font-size: var(--font-size-small);
	text-align: right;
}

.wiki-sync-case-group__body {
	gap: 0;
	padding: 0 0 8px 12px;
}

.wiki-sync-case {
	overflow: visible;
	border: 0;
	border-top: 1px solid var(--color-divider);
	border-radius: 0;
	background: none;
}

.wiki-sync-case:first-child {
	border-top: 0;
}

.wiki-sync-case__summary {
	list-style: none;
	padding: 9px 2px;
}

.wiki-sync-case__summary::-webkit-details-marker {
	display: none;
}

/* „offen" an jeder Zeile eines Abschnitts, der „Offen" heißt, ist keine Auskunft. Die beiden anderen
   Zustände bleiben sichtbar -- sie sagen etwas. */
.wiki-sync-case__status--open {
	display: none;
}

.wiki-sync-case__body {
	padding: 0 2px 9px;
}

/* Das ruhige Feld: dieselbe Rolle wie `.diff` im Blatt. */
.wiki-sync-case__facts {
	display: grid;
	gap: 2px;
	padding: 8px 10px;
	border-radius: var(--radius-md);
	background: var(--color-panel-muted);
}

.wiki-sync-case__row {
	font-size: var(--font-size-small);
}
```

⚠️ `.wiki-sync-case-group` und `.wiki-sync-case` sind `<details>`; `overflow: hidden` auf dem Fall
verhindert, dass ein Formular darin herausragt — deshalb steht dort jetzt `visible`, beim Gruppenkasten
bleibt `hidden` wirkungslos, aber harmlos.

- [ ] **Schritt 3: Prüfen — und zwar in BEIDEN Umgebungen**

`verify-fallliste.html` neu laden. Erwartet: keine Rahmen mehr, Trennlinien statt Kästen, das
Auskunftsfeld ruhig hinterlegt, Dreiecke drehen beim Aufklappen, „offen"-Pillen weg. **Abschnitt 2
(Konfliktzentrum) mitprüfen** — dort steht der Fall ohne Gruppe darum. Zwei Bildschirmfotos.

- [ ] **Schritt 4: Volle JS-Suite + Commit**

Betreff: `ui(wikisync): die Falllisten gruppieren durch Trennlinien statt durch Kaesten`

---

### Aufgabe 5: Der erklärende Satz in der Gruppenüberschrift

**Dateien:**
- Ändern: `js/review/review-conflicts.js` (`LEGACY_RULE_INFO`, ab Zeile 167 — je Eintrag ein `short`)
- Ändern: `js/review/review-wiki-sync-cases.js` (`createWikiSyncCaseGroupElement`, Zeile 389)

**Warum dort:** `LEGACY_RULE_INFO` ist bereits der Katalog, der je Falltyp erklärt, was er bedeutet und
was seine Knöpfe tun. Eine zweite Tabelle mit denselben Schlüsseln daneben wäre die Divergenz, die die
Token-Regel für Farben verbietet — hier für Wörter.

- [ ] **Schritt 1: Die kurzen Sätze eintragen**

Je Eintrag in `LEGACY_RULE_INFO` ein `short` von höchstens ~60 Zeichen, z. B.:

```js
	canonical_name_difference: {
		short: "Ort und Artikel gehören zusammen, heißen aber verschieden",
		hint: "…", // unverändert
```

Für alle zwölf: `duplicate_wiki_title` „mehrere unserer Orte, ein Artikel" · `duplicate_avesmaps_name`
„zwei unserer Orte tragen denselben Namen" · `type_conflict` „Karte und Wiki uneins über die Ortsgröße" ·
`field_divergence` „einzelne Felder weichen ab — wer recht hat, sagt der Fall nicht" · `coordinate_drift`
„verrutschter Marker oder grobe Wiki-Koordinate" · `probable_match` „ein Vorschlag, keine Feststellung" ·
`unresolved_without_candidate` „im Wiki nichts Passendes gefunden — oft völlig in Ordnung" ·
`missing_wiki_with_coordinates` „das Wiki kennt ihn samt Position, wir nicht" ·
`missing_wiki_without_coordinates` „wo er hingehört, muss von Hand bestimmt werden" · `coat_available`
„ein Wappen im Wiki, das bei uns fehlt" · `missing_capital` „ein Gebiet nennt eine Hauptstadt ohne
Zuordnung".

- [ ] **Schritt 2: Den Satz in die Überschrift hängen**

In `createWikiSyncCaseGroupElement`, nach `countElement`:

```js
	// Der Satz kommt aus dem EINEN Katalog, der ohnehin je Falltyp erklärt, was er bedeutet
	// (LEGACY_RULE_INFO in review-conflicts.js). Eine zweite Tabelle mit denselben Schlüsseln wäre
	// zwei Wahrheiten über dasselbe Ding. Fehlt der Satz, bleibt die Zeile leer -- eine Gruppe ohne
	// Erklärung ist besser als eine mit der falschen.
	const hint = getWikiSyncCaseTypeHint(group.caseType);
	if (hint) {
		const hintElement = document.createElement("span");
		hintElement.className = "wiki-sync-case-group__hint";
		hintElement.textContent = hint;
		summaryElement.appendChild(hintElement);
	}
```

und dazu, in derselben Datei:

```js
/**
 * Der kurze Satz einer Fallart. Liest den Katalog des Konfliktzentrums.
 *
 * 💣 try/catch statt `typeof`: `LEGACY_RULE_INFO` ist ein `const` auf oberster Ebene einer klassischen
 * Skriptdatei. Ist review-conflicts.js noch nicht so weit, steht der Name in der Todeszone, und dort
 * WIRFT schon `typeof` -- was diese ganze Datei mitreißen würde.
 */
function getWikiSyncCaseTypeHint(caseType) {
	try {
		return (LEGACY_RULE_INFO[caseType] || {}).short || "";
	} catch (error) {
		return "";
	}
}
```

- [ ] **Schritt 3: Prüfen**

In `verify-fallliste.html` beide Skripte laden und `createWikiSyncCaseGroupElement` mit einer
Beispielgruppe rufen; der Satz muss rechts in der Überschrift stehen und bei schmalem Fenster als
Erstes umbrechen, nicht die Zahl verdrängen. Bildschirmfoto bei 380 px Breite.

- [ ] **Schritt 4: Volle JS-Suite + Commit**

Betreff: `ui(wikisync): jede Fallgruppe sagt in einem Satz, worum es geht`

---

### Aufgabe 6: Entwurf und Brief nachführen

**Dateien:**
- Ändern: `docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md` (§7, Abschnitt „Sitzung 3")
- Ändern: `AGENTS.md` §11 (der Absatz „Die Übernahme-Vorschau")
- Hinzufügen: `docs/sync-uebernahme-fallliste-mockup.html` (das Mockup, auf das §7 verweist)

- [ ] **Schritt 1: §7 auf den gebauten Stand bringen**

Der heutige Text verlangt die Ersetzung der Fall-Typologie durch die drei Kategorien. Er wird ersetzt
durch den Befund oben (die Zähltabelle, die zwei echten Ja/Nein-Fälle, der am 22.07. ausgebaute
Sammelknopf) und den Owner-Entscheid vom 06.08.: gleiche Formensprache, Knöpfe bleiben Knöpfe. Mit
Verweis auf das Mockup.

- [ ] **Schritt 2: AGENTS.md §11 um zwei Sätze ergänzen**

In den vorhandenen Absatz zur Übernahme-Vorschau: Sitzung 3 ist gebaut; sie hat **keine**
`sync_plan_item`-Zeilen erzeugt, sondern nur die Formensprache vereinheitlicht, weil 385 von 563 Fällen
unter keine der drei Kategorien passen und ein Häkchen bei 2 von 16 Falltypen die richtige Form ist.
Dazu die neue Naht `syncPlanResolvePost` als Andockpunkt für Sitzung 4.

- [ ] **Schritt 3: Commit**

Betreff: `docs(sync): Sitzung 3 gleicht die Falllisten optisch an -- die drei Kategorien passen dort nicht`

---

### Aufgabe 7: Ausliefern und live gegenprüfen

- [ ] **Schritt 1: Volle Suite ein letztes Mal**

Erwartet: 114 PHP grün, 90 JS grün, keine `ROT:`-Zeile.

- [ ] **Schritt 2: `git status` lesen und NUR eigene Pfade prüfen**

Erwartet als geändert: `js/review/sync-plan-sheet.js`, `js/review/__tests__/sync-plan-sheet.test.js`,
`js/review/review-wiki-sync-cases.js`, `js/review/review-conflicts.js`,
`css/features/review-panel.css`, `docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`,
`AGENTS.md`, dazu neu `docs/sync-uebernahme-fallliste-mockup.html` und
`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-3.md`.
`verify-fallliste.html` bleibt **ungetrackt**. Alles andere gehört anderen Sitzungen.

- [ ] **Schritt 3: Push und die entfernte SHA prüfen**

```bash
git push origin master && git rev-parse HEAD && git rev-parse origin/master
```

- [ ] **Schritt 4: 2–4 Minuten warten, dann live gegenprüfen**

Auf `https://avesmaps.de/?edit=1` (das Editorpanel rendert ohne Anmeldung, `IS_EDIT_MODE` hängt nur am
Parameter): prüfen, dass `css/features/review-panel.css` die neuen Regeln ausliefert, und dass die
Seite fehlerfrei lädt. Die Fall-**Inhalte** bleiben ohne Anmeldung leer — das ist erwartet und kein
Befund. Geprüft wird also: kommt das Stylesheet frisch an (`?cb=`-Vergleich gegen den normalen Abruf,
`docs/asset-caching-and-versioning.md`), und steht in der Konsole nichts Neues.

- [ ] **Schritt 5: Was offen bleibt, benennen**

Die Falllisten **mit echten Daten** sieht nur eine angemeldete Editorin. Der Bericht sagt das
ausdrücklich, statt „geprüft" zu behaupten.

---

## Selbstprüfung des Plans

- **Deckung:** Aufgabe 1 deckt „das Bauteil für eine zweite Quelle öffnen" (§7 Satz 1). Aufgaben 3–5
  decken „das Aussehen wird einheitlich" (§7 Satz 2). Der dritte Teil von §7 — die Ersetzung der
  Typologie — wird ausdrücklich **nicht** gebaut und in Aufgabe 6 im Entwurf begründet.
- **Keine Platzhalter:** jeder Codeschritt trägt seinen Code; die zwölf kurzen Sätze stehen ausgeschrieben.
- **Namensgleichheit:** `syncPlanDefaultPost` / `syncPlanResolvePost` / `syncPlanPost(post, body)` /
  `wikiSyncCaseFacts` / `getWikiSyncCaseTypeHint` / `.wiki-sync-case__facts` /
  `.wiki-sync-case-group__hint` — in allen Aufgaben gleich geschrieben.
- **Was NICHT dazugehört:** keine vierte Kategorie, keine Änderung an den Auflöse-Wegen, keine Änderung
  an `wiki_sync_cases`, kein neuer Schreiber für `field_divergence`, keine Sammelübernahme bei den Wegen.
