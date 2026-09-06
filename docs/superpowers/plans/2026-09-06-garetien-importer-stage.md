# Garetien Importer — Import-Stage: Bauplan

> **Für agentische Ausführung:** ERFORDERLICHES SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Aus dem heutigen „Anzeigen" wird eine **Import-Stage**: ein Objekt wird erst dorthin
gelegt, liegt sichtbar auf der Karte mit genau den Einstellungen, die rechts stehen, und wird erst
danach mit EINEM Knopf importiert — samt Statuszeile, die sagt, was geschehen ist.

**Architektur:** Kein neuer Endpunkt, keine neue Tabelle. Die Stage IST die vorhandene
Anzeige-Menge (`zustand.anzeige` → `zustand.stage`, eine `Map` im Browser); die Einstellungen je
Objekt gibt es schon (`_garetienEingabenZustand`, `_garetienZielWahl`) und erreichen künftig den
Import (`einstellungen_je_item`) und den Zeichner (Stempel). Der Server bekommt vier eng
begrenzte Erweiterungen: Fehlergründe in der Antwort, Einstellungen je Item, ein `keys`-Filter der
Arbeitsliste, `is_bach` als Handeingabe.

**Tech Stack:** Vanilla JS ohne Build (`js/review/review-garetien-*.js`), PHP 8 strict types
(`api/_internal/import/`), CSS mit Tokens aus `css/base/tokens.css`, Tests: `node <datei>.test.js`
und `php -d zend.assertions=1 …-test.php`.

**Spec:** `docs/superpowers/specs/2026-09-06-garetien-importer-stage-design.md`
**Mockup:** `docs/garetien-importer-stage-mockup.html` (freigegeben 06.09.2026)

---

## Globale Zusicherungen

Sie gelten für JEDE Aufgabe, ohne dass sie dort wiederholt werden:

- **Deutsch.** Kommentare, Commit-Betreffs und Oberflächentexte sind deutsch (AGENTS.md §8).
  `error.code`-Werte bleiben englisch.
- **Geteilter Arbeitsbaum.** NIE `git add -A`/`git add .`/`git commit -a`. Vor jedem Commit
  `git status`, dann NUR die selbst berührten Pfade einzeln stagen. Fremde `M`/`??`-Zeilen
  bleiben liegen (AGENTS.md §9).
- **Commit-Nachricht immer per DATEI** (`git commit -F <datei>`), nie per `-m`: Backticks in `-m`
  sind Kommando-Substitution und fressen den Wert still.
- **Attribution:** jede Commit-Nachricht endet mit
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Vor JEDEM Push das GANZE Testfeld**, parallel, mit den Mustern des Workflows:
  ```bash
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 \
    | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-js
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 \
    | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-php
  ```
  💣 KEIN `2>&1` auf die Ergebnisdatei. 💣 Die äußere Klammer um beide Gruppen ist tragend — ohne
  sie läuft nur die zweite Gruppe und der Lauf meldet fälschlich „null rot". Gegenprobe:
  `… -print0 | tr -dc '\0' | wc -c` muss die Zahl des Workflows ergeben.
  Vorbestehend rot ist genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Vor dem Push `gh run list --limit 3`.** Bei `in_progress` ODER `pending` warten — auch bei
  einem Lauf einer fremden Sitzung; ein Push ersetzt den wartenden Lauf, und dessen Dateien lädt
  dann nie jemand.
- **Push aus einem Wegwerf-Worktree**, nie per Rebase im geteilten Baum:
  ```bash
  git worktree add --detach "$SCRATCH/pushwt" origin/master
  git -C "$SCRATCH/pushwt" cherry-pick <sha>
  git -C "$SCRATCH/pushwt" push origin HEAD:master
  git worktree remove --force "$SCRATCH/pushwt" && git worktree prune
  ```
  Danach `git fetch` + `git log --oneline -1 origin/master` gegenprüfen.
- **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9): ein Commit, ein Push, der Blick des
  Owners, dann die nächste. Die Aufgaben unten sind so geschnitten, dass jede für sich live gehen
  kann. Unsichtbare (reiner Server, reine Tests) dürfen zusammen reisen.
- **Nach jedem Push, der die Karte berührt:** die Live-Seite als BESUCHER laden (ohne `edit=1`)
  und `read_console_messages` lesen — die Regression vom 03.09.2026 (zwei Stunden ohne
  Beschriftungen) hat kein Test gefunden, nur dieser Blick.
- **Keine `?v=`-Stempel von Hand.** `index.html` wird vom Deploy gestempelt.
- **Vor dem Commit** `usability-konsistenz` (Entwurf gegen Diff), **vor dem Push**
  `usability-design` (Mockup gegen Bau, hell UND dunkel) — für jede Aufgabe mit sichtbarer
  Wirkung. Der Prüfagent darf `git checkout/stash/restore/reset` NICHT benutzen.
- **Mutationsprobe.** Jede neue Zusicherung wird gegen mindestens eine Mutation gefahren, die sie
  fangen MUSS. Eine Zusicherung, die eine Mutation überlebt, ist Vakuum und wird ersetzt.
- **Quelltexttests lesen kommentarfrei** (`token_get_all` bzw. Kommentare strippen) und
  zeilenendenneutral (`\r\n` → `\n`): hier ist CRLF, im Deploy-Tor LF.

**Namen, die in mehreren Aufgaben vorkommen** (einmal vergeben, nie umbenannt):

| Name | Ort | Bedeutung |
|---|---|---|
| `zustand.stage` | JS, `review-garetien-importer.js` | `Map` Schlüssel → Objekt; die heutige `zustand.anzeige` |
| `zustand.auswahl` | JS | `Set` von Schlüsseln; die heutige `zustand.markiert` |
| `garetienStatusSetzen(text, ton, aktion)` | JS | schreibt die Statuszeile; `ton` ∈ `""｜"ok"｜"bad"` |
| `garetienStageEinstellungenJeItem(objekte)` | JS | `{ "<item_id>": <rumpf> }` für `apply` |
| `garetienStageNachschlagen(rufe)` | JS | holt die Stage-Objekte per `keys` neu |
| `avesmapsGaretienEinstellungenJeItemAusRumpf($payload)` | PHP, `garetien-uebernahme.php` | `?array<int,array>` |
| `keys` | PHP-Filter, `garetien-liste.php` | `list<string>` Objektschlüssel, über ALLE Stände |
| `angelegt_je_form` | PHP-Antwort | `array{path:int,bach:int,region:int,label:int,location:int,settlement_place:int,quelle:int}` |

---

## Dateiplan

| Datei | Verantwortung | Aufgaben |
|---|---|---|
| `css/components/editor-body.css` | **neu hier:** `.avm-status` (aus `editor-page.css` hierher, mit echten Tokens) | 1 |
| `css/components/editor-page.css` | verliert `.avm-status` (bekommt es per `@import` zurück) | 1 |
| `css/components/garetien-importer.css` | Fensterbreite 1000, Knopfreihen, `.avm-tile`-Modifier, Stage-Marke | 1, 9, 10, 12 |
| `index.html` | Statuszeile, Fußleiste, tote Tooltips | 1, 12 |
| `js/review/review-garetien-importer.js` | der ganze Client-Umbau | 1, 3, 6, 7, 8, 9, 10, 11, 13 |
| `js/review/review-garetien-karte.js` | Namensvorschau, Bach-Signatur | 14 |
| `api/_internal/import/garetien-uebernahme.php` | Gründe, Formen, Einstellungen je Item, `is_bach` | 2, 4, 7 |
| `api/_internal/import/garetien-liste.php` | `keys`-Filter | 5 |
| `api/_internal/import/garetien-plan.php` | `is_bach` beim Zielwechsel | 7 |
| `api/_internal/import/garetien-abgleich.php` | Stadtviertel, Reichsstadt, Punktregel | 15, 16 |
| `api/_internal/wiki/place-kinds.php` | fünf Ortsarten | 15 |
| `api/edit/wiki/sync-plan.php` | reicht `einstellungen_je_item` durch | 4 |

---

## Aufgabe 1: Die Statuszeile

**Warum zuerst:** jede folgende Aufgabe will etwas melden. Ohne sie bleibt jede Rückmeldung
stumm, und jeder Fehler löscht weiterhin die Liste.

**Dateien:**
- Ändern: `css/components/editor-page.css` (Block `.avm-status`, heute ab Zeile 402)
- Ändern: `css/components/editor-body.css` (der Block zieht hierher)
- Ändern: `index.html` (`#garetien-runline` → Statuszeile)
- Ändern: `js/review/review-garetien-importer.js`
- Test: `js/review/__tests__/garetien-statuszeile.test.js` (neu)
- Test: `js/app/__tests__/statuszeile-geteilt.test.js` (neu)

**Schnittstellen:**
- Erzeugt: `garetienStatusSetzen(text, ton, aktion)` — `aktion` ist `null` oder
  `{ text: string, ruf: () => void }`; sie schreibt `#garetien-status-text` und den Link
  `#garetien-status-aktion`.
- Erzeugt: `garetienStatusRuhe()` — schreibt die Bilanz des Laufs (ersetzt
  `avesmapsGaretienRunlineMarkup`).

- [ ] **Schritt 1: Den Wanderungs-Test schreiben (er MUSS zuerst rot sein)**

`js/app/__tests__/statuszeile-geteilt.test.js`:

```js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8").replace(/\r\n/g, "\n");

// 🔴 .avm-status gehoert BEIDEN Welten: den sechs Editor-SEITEN (iframes, editor-page.css) und
// der App (index.html, styles.css). Sie steht deshalb in editor-body.css -- der Datei, die BEIDE
// laden. Dieselbe Reise wie editor-row.css, map-status-circle.css und wiki-override.css.
const body = lies("css/components/editor-body.css");
const page = lies("css/components/editor-page.css");

assert.ok(/^\.avm-status \{/m.test(body), ".avm-status muss in editor-body.css stehen");
assert.ok(!/^\.avm-status \{/m.test(page), ".avm-status darf nicht mehr in editor-page.css stehen");
assert.ok(page.includes('@import url("editor-body.css")'), "editor-page.css bindet editor-body.css");
assert.ok(lies("css/styles.css").includes('@import url("components/editor-body.css")'),
	"styles.css bindet editor-body.css");

// 💣 SIE DARF DIE KURZ-ALIASE NICHT MEHR LESEN. --soft/--line/--mut/--ok/--bad stehen im :root
// von editor-page.css; in index.html sind sie UNDEFINIERT, und `color: var(--mut)` ohne Rueckfall
// ist dann ungueltig. Der Block muss die echten Tokens nennen.
const block = body.slice(body.indexOf("\n.avm-status {"));
const bisEnde = block.slice(0, block.indexOf("\n.avm-tabs") === -1 ? block.length : block.indexOf("\n.avm-tabs"));
["--mut", "--soft", "--line", "--ok", "--bad"].forEach((alias) => {
	assert.ok(!new RegExp("var\\(" + alias + "\\)").test(bisEnde),
		"Alias " + alias + " erreicht index.html nicht -- echtes Token nennen");
});
["--color-text-muted", "--color-panel-soft", "--color-divider"].forEach((token) => {
	assert.ok(bisEnde.includes(token), token + " fehlt in .avm-status");
});
console.log("OK -- 9 Zusicherungen");
```

- [ ] **Schritt 2: Rot laufen lassen**

Run: `node js/app/__tests__/statuszeile-geteilt.test.js`
Erwartet: FAIL, „.avm-status muss in editor-body.css stehen"

- [ ] **Schritt 3: Den Block umziehen**

Aus `css/components/editor-page.css` den Abschnitt `.avm-status` / `.avm-status__text` /
`.avm-status__text.ok` / `.avm-status__text.bad` ENTFERNEN und an das Ende des Reiter-Abschnitts
von `css/components/editor-body.css` setzen, mit echten Tokens:

```css
/* ---- Die Statuszeile ------------------------------------------------------------------------
 * Eine eigene Reihe unter dem Menüband, volle Breite, EINZEILIG und ellipsiert: eine lange
 * Meldung darf die Spalten nie nach unten drücken.
 *
 * 🔴 SIE STAND BIS ZUM 06.09.2026 IN editor-page.css und war damit den Editor-SEITEN vorbehalten.
 * Das Fenster „Garetien Importer" lebt aber in index.html und lädt jene Datei nie — dieselbe
 * Reise wie editor-row.css, map-status-circle.css und wiki-override.css, und aus demselben
 * Grund: eine Regel, zwei Welten, EINE Datei, die beide laden.
 * 💣 UND DESHALB DIE ECHTEN TOKENS, NICHT DIE KURZ-ALIASE. `--soft`/`--line`/`--mut`/`--ok`/
 *    `--bad` stehen im `:root` von editor-page.css; in index.html sind sie undefiniert, und
 *    `color: var(--mut)` ohne Rückfall ist dann ungültig — die Zeile erbte still die Textfarbe.
 *    Der Kommentar an jenem `:root` sagt es selbst: neue Regeln greifen zum echten Token.
 * ⚠️ Die vier Editor-SEITEN mit einer INLINE abgeschriebenen Fassung (#status im Sync-Monitor,
 *    #plStatus, #settlementStatus, dazu citymap- und literatur-Editor) bleiben unangetastet —
 *    sie hierher zu ziehen ist ein eigener Auftrag, nicht dieser.
 */
.avm-status {
	display: flex;
	align-items: center;
	gap: var(--space-12);
	padding: var(--avm-status-pad);
	min-height: var(--avm-status-min-h);
	color: var(--color-text-muted);
	background: var(--color-panel-soft);
	border-bottom: 1px solid var(--color-divider);
	white-space: nowrap;
}

.avm-status__text {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.avm-status__text.ok { color: var(--color-success-soft-text); }
.avm-status__text.bad { color: var(--color-danger-soft-text); }
```

💣 `--color-success-soft-text`/`--color-danger-soft-text` statt `--color-success`/`--color-danger`:
auf `--color-panel-soft` misst `--color-danger` im dunklen Thema unter 4,5 — dieselbe Messung, die
`.gi-win .btn--danger` schon trägt.

- [ ] **Schritt 4: Grün laufen lassen**

Run: `node js/app/__tests__/statuszeile-geteilt.test.js` → PASS
Run: `node js/pages/__tests__/*.test.js` (die Editorseiten-Tests) → unverändert grün

- [ ] **Schritt 5: Markup in `index.html`**

`<p class="gi-runline" id="garetien-runline"></p>` ersetzen durch:

```html
			<!-- 🔴 DIE STATUSZEILE (06.09.2026). Sie ersetzt die stille Laufzeile: in Ruhe die
			     Bilanz des Laufs, nach jeder Handlung deren Ergebnis, bei einem Fehler den Grund
			     in Rot — und die Liste bleibt dabei stehen. Bis dahin ersetzte ein Fehler die
			     ganze Liste durch einen Satz, und eine gelungene Übernahme meldete gar nichts.
			     ⚠️ `.avm-status` ist die Hausform (css/components/editor-body.css) — dieselbe
			     Zeile wie im Wege- und Landschaften-Editor, kein eigenes Aussehen.
			     ⚠️ role="status" + aria-live="polite": die Meldung erscheint ohne Fokuswechsel. -->
			<div class="avm-status" role="status" aria-live="polite">
				<span class="avm-status__text" id="garetien-status-text"></span>
				<button class="gi-status__aktion" type="button" id="garetien-status-aktion" hidden></button>
			</div>
```

- [ ] **Schritt 6: Den Verhaltens-Test schreiben**

`js/review/__tests__/garetien-statuszeile.test.js` — er FÜHRT die Funktionen aus, statt Quelltext
zu lesen:

```js
"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter();   // baut ein Fake-DOM mit den drei Status-Elementen

// 1. Ruhe: die Bilanz des Laufs
api.garetienStatusSetzen("Lauf 05.09. 14:02 · 8 213 Objekte", "", null);
assert.strictEqual(dom.text("#garetien-status-text"), "Lauf 05.09. 14:02 · 8 213 Objekte");
assert.strictEqual(dom.klassen("#garetien-status-text").includes("ok"), false);
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, true);

// 2. Erfolg mit Handlung
let gerufen = 0;
api.garetienStatusSetzen("✓ 5 Objekte importiert", "ok", { text: "Rückgängig", ruf: () => { gerufen++; } });
assert.ok(dom.klassen("#garetien-status-text").includes("ok"));
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, false);
assert.strictEqual(dom.text("#garetien-status-aktion"), "Rückgängig");
dom.klick("#garetien-status-aktion");
assert.strictEqual(gerufen, 1, "der Link ruft seine Handlung");

// 3. Ein zweiter Aufruf OHNE Handlung nimmt den alten Link weg -- sonst zeigt „Rückgängig" auf
//    eine Übernahme, die zwei Handlungen her ist.
api.garetienStatusSetzen("Stage geleert", "", null);
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, true);
assert.strictEqual(dom.klassen("#garetien-status-text").includes("ok"), false, "der Ton geht mit");

// 4. 💣 EIN FEHLER ERSETZT DIE LISTE NICHT MEHR.
dom.setze("#garetien-list", "<div class='avm-row'>Zeile</div>");
api.garetienListeFehlerZeigen(new Error("Dieser Lauf laesst sich nicht mehr aendern."));
assert.ok(dom.html("#garetien-list").includes("avm-row"), "die Liste bleibt stehen");
assert.ok(dom.klassen("#garetien-status-text").includes("bad"));
assert.ok(dom.text("#garetien-status-text").includes("Dieser Lauf laesst sich nicht mehr aendern."));
assert.ok(dom.text("#garetien-status-text").includes("die Liste ist unverändert"),
	"der Satz sagt, dass nichts verloren ist");
console.log("OK -- 12 Zusicherungen");
```

⚠️ Die Testumgebung `js/review/__tests__/helfer/garetien-testumgebung.js` wird in diesem Schritt
angelegt: sie baut ein minimales Fake-`document` mit `getElementById`, `classList`,
`addEventListener`, setzt `global.document`/`global.window` und lädt das Modul per `require`.
Vorbild: die bestehenden Garetien-Tests, die schon ein Fake-DOM bauen — der Helfer sammelt es an
EINER Stelle, statt es zum 35. Mal abzuschreiben.

- [ ] **Schritt 7: Rot laufen lassen**

Run: `node js/review/__tests__/garetien-statuszeile.test.js`
Erwartet: FAIL, „garetienStatusSetzen is not a function"

- [ ] **Schritt 8: Implementieren**

In `review-garetien-importer.js`, neben den übrigen reinen Anzeige-Funktionen:

```js
	/*
	 * DIE STATUSZEILE — der EINE Erzeuger jeder Rückmeldung dieses Fensters (06.09.2026).
	 *
	 * 🔴 EINE FUNKTION, KEIN ZWEITER WEG. Bis heute hatte das Fenster drei Halbwege: ein
	 * Fehlersatz ERSETZTE die Liste, ein Fortschritt stand flüchtig IM Knopf, und ein Erfolg
	 * meldete GAR NICHTS (`garetienEinfuegenAusfuehren` summierte `applied/skipped` und warf die
	 * Summe weg). Wer eine vierte Meldung anbaut, ruft diese Funktion.
	 *
	 * 🔴 DER TON GEHT MIT. `ton: ""` nimmt `ok`/`bad` wieder ab — sonst bliebe eine grüne
	 * Erfolgsmeldung farbig unter einem Satz, der nur noch „Stage geleert" sagt.
	 * 🔴 UND DIE HANDLUNG GEHT MIT. `aktion: null` versteckt den Link; „Rückgängig" darf nie auf
	 * eine Übernahme zeigen, die zwei Handlungen zurückliegt.
	 */
	function garetienStatusSetzen(text, ton, aktion) {
		if (!hasDocument) { return null; }
		const textEl = document.getElementById("garetien-status-text");
		if (textEl) {
			textEl.textContent = String(text || "");
			textEl.classList.remove("ok", "bad");
			if (ton === "ok" || ton === "bad") { textEl.classList.add(ton); }
		}
		const knopf = document.getElementById("garetien-status-aktion");
		if (knopf) {
			// ⚠️ Der Zuhörer wird ERSETZT, nicht ergänzt: der Knopf steht statisch im Markup und
			// überlebt jede Handlung -- ein `addEventListener` je Meldung liefe hoch.
			knopf.onclick = (aktion && typeof aktion.ruf === "function") ? aktion.ruf : null;
			knopf.textContent = aktion ? String(aktion.text || "") : "";
			knopf.hidden = !aktion;
		}
		return { text: String(text || ""), ton: ton || "" };
	}

	// Der Ruhezustand: die Bilanz des LAUFS. Sie ersetzt avesmapsGaretienRunlineMarkup —
	// dieselben Zahlen, nur ohne eigene Zeile. ⚠️ Die Stage-Zahl kommt aus der MENGE, der Server
	// kennt sie nicht.
	function garetienStatusRuhe(antwort) {
		const a = antwort || zustand.letzteAntwort || {};
		const b = a.bilanz || {};
		const zahl = (feld) => Number(b[feld] || 0);
		const gesamt = zahl("neu") + zahl("ergaenzung") + zahl("zweifel")
			+ zahl("widerspruch") + zahl("deckt_sich") + zahl("uebersprungen");
		const mitVorschlag = zahl("neu") + zahl("ergaenzung") + zahl("zweifel") + zahl("widerspruch");
		const lauf = garetienLetzterLauf ? "Lauf " + garetienLaufStempel(garetienLetzterLauf) : "Noch kein Lauf";
		return garetienStatusSetzen(
			lauf + " · " + gesamt + " Objekte · " + mitVorschlag + " mit Vorschlag · "
				+ zustand.stage.size + " auf der Stage",
			"", null
		);
	}
```

Und `garetienListeFehlerZeigen` umbauen — sie schreibt NICHT mehr in die Liste:

```js
	/*
	 * Ein Fehler steht in der STATUSZEILE, nicht in der Liste (06.09.2026).
	 *
	 * 💣 BIS HEUTE ERSETZTE ER `#garetien-list` durch einen Satz. Der Editor verlor damit 1000
	 * Zeilen wegen einer Anfrage, die vielleicht nur eine Rückfrage betraf — und erfuhr nicht,
	 * dass ein Reiterklick sie zurückholt. Die Liste ist nach einem gescheiterten Schreibvorgang
	 * ohnehin nicht falsch: es wurde ja nichts geschrieben.
	 */
	function garetienListeFehlerZeigen(fehler) {
		const satz = (fehler && fehler.message) || "Die Anfrage ist fehlgeschlagen.";
		return garetienStatusSetzen("✕ " + satz + " — die Liste ist unverändert.", "bad", null);
	}
```

`avesmapsGaretienRunlineMarkup` und ihre Aufrufstelle in `avesmapsGaretienListeRendern` entfallen;
dort steht künftig `garetienStatusRuhe(a)`. In `garetienLeeresFensterZeigen` ebenso.

- [ ] **Schritt 9: Grün laufen lassen**

Run: `node js/review/__tests__/garetien-statuszeile.test.js` → PASS
Run: die übrigen `garetien-*.test.js` → die Tests, die `gi-runline` erwarten, werden nachgezogen
(erwartet betroffen: `garetien-zentrieren-und-reiter.test.js`, `garetien-fenster-huelle.test.js`).

- [ ] **Schritt 10: Mutationsprobe**

Vier Mutationen, jede MUSS gefangen werden:
1. `textEl.classList.remove("ok", "bad")` löschen → Test 3 rot
2. `knopf.hidden = !aktion` → `knopf.hidden = false` → Test 1 rot
3. in `garetienListeFehlerZeigen` wieder `listeEl.innerHTML = …` → Test 4 rot
4. in `.avm-status` `var(--color-text-muted)` → `var(--mut)` → Wanderungs-Test rot

- [ ] **Schritt 11: CSS für den Link**

In `css/components/garetien-importer.css`:

```css
/* Der Handlungs-Link der Statuszeile („Rückgängig", „Zur Zeile"). Ein LINK, kein Knopf: er ist
   der Nebenausgang einer Meldung, nicht ihre Handlung — dieselbe Rangfolge wie überall in diesem
   Fenster (AGENTS.md §12: die eine gefüllte Handlung steht im Fuß). */
.gi-status__aktion {
	flex: none;
	padding: 0;
	border: 0;
	background: none;
	color: var(--color-link);
	font: inherit;
	font-size: var(--font-size-caption);
	text-decoration: underline;
	cursor: pointer;
}
.gi-status__aktion:hover { color: var(--color-link-hover); }
.gi-status__aktion[hidden] { display: none; }
```

- [ ] **Schritt 12: Im Browser abnehmen**

`preview_start` auf die lokale `index.html`, Fenster öffnen, Statuszeile in HELL und DUNKEL
ansehen; `usability-design` gegen `docs/garetien-importer-stage-mockup.html` §3 laufen lassen.

- [ ] **Schritt 13: Commit**

```bash
git status --short
git add css/components/editor-body.css css/components/editor-page.css \
        css/components/garetien-importer.css index.html \
        js/review/review-garetien-importer.js \
        js/review/__tests__/garetien-statuszeile.test.js \
        js/review/__tests__/helfer/garetien-testumgebung.js \
        js/app/__tests__/statuszeile-geteilt.test.js
git commit -F <nachricht.txt>
```

Betreff: `ui(garetien-importer): eine Statuszeile -- und ein Fehler loescht nicht mehr die Liste`

---

## Aufgabe 2: Der Server meldet Gründe und Formen

**Warum:** die Statuszeile kann nur sagen, was sie erfährt. Heute gibt `apply` die Fehlerzahl
zurück und wirft die Gründe weg.

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`avesmapsGaretienUebernehmen`,
  `avesmapsGaretienApplyStep`)
- Test: `api/_internal/import/__tests__/garetien-uebernahme-meldet-test.php` (neu)

**Schnittstellen:**
- Erzeugt: `avesmapsGaretienApplyStep(...)` liefert zusätzlich
  `fehler: list<array{item:int, grund:string}>` und
  `angelegt_je_form: array{path:int,bach:int,region:int,label:int,location:int,settlement_place:int,quelle:int}`.
  `bach` zählt die Teilmenge von `path` — ein Bach zählt in BEIDEN.

- [ ] **Schritt 1: Test schreiben**

```php
<?php
declare(strict_types=1);
require_once __DIR__ . '/../garetien-uebernahme.php';

// … Fixture wie in garetien-uebernahme-test.php (SQLite, zwei Items: ein gueltiger Weg mit
// is_bach, ein Item, dessen Geometrie kein gueltiges Ziel hergibt) …

$ergebnis = avesmapsGaretienApplyStep($pdo, $runId, 1, ['id' => 1], null, [$idWeg, $idKaputt]);

// 🔴 DIE GRUENDE REISEN MIT. Bis zum 06.09.2026 gab es nur `skipped: 2` -- eine Zahl, aus der
// niemand ablesen konnte, WAS schiefging; der Text stand in `apply_note` und wurde nie gelesen.
assert(is_array($ergebnis['fehler']), 'fehler ist eine Liste');
assert(count($ergebnis['fehler']) === 1, 'genau ein Fehlschlag');
assert($ergebnis['fehler'][0]['item'] === $idKaputt, 'die Item-Nummer steht dabei');
assert(str_contains($ergebnis['fehler'][0]['grund'], 'Punkt'), 'der Grund ist der echte Text');
// ⚠️ Die DIFFERENZ ist die Zusicherung: das gelungene Item darf NICHT in `fehler` stehen.
assert(count(array_filter($ergebnis['fehler'], fn($f) => $f['item'] === $idWeg)) === 0);

// 🔴 UND DIE FORMEN. „5 importiert" sagt nichts; „3 Wege (2 Baeche), 1 Flaeche" sagt, was auf der
// Karte steht. `bach` ist die TEILMENGE von `path` -- ein Bach zaehlt in beiden, sonst ergaeben
// die Formzahlen zusammen nicht die Gesamtzahl.
assert($ergebnis['angelegt_je_form']['path'] === 1, 'ein Weg');
assert($ergebnis['angelegt_je_form']['bach'] === 1, 'und er ist ein Bach');
assert($ergebnis['angelegt_je_form']['region'] === 0, 'keine Flaeche');
assert(array_sum([$ergebnis['angelegt_je_form']['path'], $ergebnis['angelegt_je_form']['region'],
	$ergebnis['angelegt_je_form']['label'], $ergebnis['angelegt_je_form']['location'],
	$ergebnis['angelegt_je_form']['settlement_place']]) === $ergebnis['applied'],
	'die Formen ohne `bach` und `quelle` ergeben zusammen die Gesamtzahl');
echo "OK\n";
```

- [ ] **Schritt 2: Rot laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-uebernahme-meldet-test.php`
Erwartet: FAIL, „Undefined array key ‚fehler'" bzw. „angelegt_je_form"

- [ ] **Schritt 3: Implementieren**

In `avesmapsGaretienUebernehmen` einen Zähler führen und zurückgeben:

```php
    $jeForm = ['path' => 0, 'bach' => 0, 'region' => 0, 'label' => 0,
        'location' => 0, 'settlement_place' => 0, 'quelle' => 0];
```

Im `path`-Zweig nach dem Anlegen:

```php
                $jeForm['path']++;
                // 🔴 `bach` ist die TEILMENGE von `path`, kein eigener Topf: ein Bach IST ein
                // Flussweg mit Haekchen (AVESMAPS_GARETIEN_TYP_MAP). Zaehlte er nur hier, ergaeben
                // die Formzahlen zusammen weniger als `applied`, und die Statuszeile behauptete,
                // ein Objekt sei verschwunden.
                if (avesmapsGaretienNachIstBach($nach)) {
                    $jeForm['bach']++;
                }
```

In den übrigen Zweigen `$jeForm['region']++` / `['label']` / `['location']` /
`['settlement_place']`, und im Ergänzungszweig `$jeForm['quelle']++`.

Rückgabe von `avesmapsGaretienUebernehmen` um `'angelegt_je_form' => $jeForm` erweitern;
`avesmapsGaretienApplyStep` reicht durch:

```php
        // 🔴 DIE GRUENDE, NICHT NUR IHRE ZAHL (06.09.2026). `skipped` sagt „zwei sind nicht
        // durchgekommen"; welche und warum, stand bisher ausschliesslich in `apply_note` in der
        // Datenbank und erreichte keinen Browser. Die Statuszeile des Fensters nennt sie jetzt
        // beim Namen — dieselbe Regel wie ueberall im Haus: eine stille Ausnahme ist von „hat
        // funktioniert" nicht zu unterscheiden.
        'fehler' => $ergebnis['fehler'],
        'angelegt_je_form' => $ergebnis['angelegt_je_form'],
```

- [ ] **Schritt 4: Grün laufen lassen** → PASS; dazu `garetien-uebernahme-test.php` unverändert grün

- [ ] **Schritt 5: Mutationsprobe**
1. `if (avesmapsGaretienNachIstBach(...))` entfernen → „und er ist ein Bach" rot
2. `'fehler' => []` fest → „genau ein Fehlschlag" rot
3. `$jeForm['path']++` im Bach-Zweig weglassen → die Summenzusicherung rot

- [ ] **Schritt 6: Commit** (unsichtbar, darf mit Aufgabe 3 reisen)

Betreff: `feat(garetien-import): die Uebernahme meldet ihre Gruende und die angelegten Formen`

---

## Aufgabe 3: Das Import-Ergebnis in der Statuszeile

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js`
- Test: `js/review/__tests__/garetien-import-meldung.test.js` (neu)

**Schnittstellen:**
- Konsumiert: `garetienStatusSetzen` (Aufgabe 1), `fehler`/`angelegt_je_form` (Aufgabe 2)
- Erzeugt: `garetienImportMeldung(summe)` — REIN, gibt `{ text, ton }` zurück; und
  `garetienImportFormenText(jeForm)`.

- [ ] **Schritt 1: Test schreiben**

```js
const { garetienImportMeldung } = require("../review-garetien-importer.js").__test;

// 1. Voller Erfolg: die Formen stehen da, nicht nur eine Zahl.
let m = garetienImportMeldung({ applied: 5, fehler: [],
	angelegt_je_form: { path: 3, bach: 2, region: 1, label: 0, location: 0, settlement_place: 1, quelle: 0 } });
assert.strictEqual(m.ton, "ok");
assert.ok(m.text.includes("5 Objekte importiert"));
assert.ok(m.text.includes("3 Wege (2 Bäche)"), "die Bach-Zahl steht in Klammern beim Weg");
assert.ok(m.text.includes("1 Fläche"));
assert.ok(m.text.includes("1 Stätte"));
assert.ok(!m.text.includes("0 "), "eine Form mit null wird gar nicht genannt");

// 2. Teilerfolg: der GRUND steht da, nicht nur die Zahl.
m = garetienImportMeldung({ applied: 4, fehler: [{ item: 9, grund: "Aus 1 Punkten laesst sich kein Ziel der Art \"path\" bauen." }],
	angelegt_je_form: { path: 4, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 } });
assert.strictEqual(m.ton, "bad", "ein Teilerfolg ist eine Warnung, keine Erfolgsmeldung");
assert.ok(m.text.includes("1 von 5 nicht importiert"), "genannt wird n von GESAMT");
assert.ok(m.text.includes("kein Ziel der Art"), "der Servergrund reist mit");

// 3. Nichts durchgekommen.
m = garetienImportMeldung({ applied: 0, fehler: [{ item: 9, grund: "X" }],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 } });
assert.strictEqual(m.ton, "bad");
assert.ok(!m.text.includes("importiert —"), "ohne Erfolg keine Erfolgsliste");

// 4. Eine reine Quellen-Ergänzung ist KEIN angelegtes Objekt und wird eigens genannt.
m = garetienImportMeldung({ applied: 0, fehler: [],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 3 } });
assert.strictEqual(m.ton, "ok");
assert.ok(m.text.includes("3 Quellen ergänzt"));
```

- [ ] **Schritt 2: Rot laufen lassen** → FAIL, „garetienImportMeldung is not a function"

- [ ] **Schritt 3: Implementieren**

```js
	// REIN: die Formen eines Import-Laufs als Satzteil. Eine Form mit 0 wird NICHT genannt —
	// „0 Flächen" ist keine Auskunft, sondern Rauschen.
	// 🔴 `bach` steht in KLAMMERN beim Weg, weil er dessen Teilmenge ist (siehe die Zählung in
	// garetien-uebernahme.php). Als eigener Posten gezählt ergäbe die Aufzählung mehr Objekte,
	// als angelegt wurden.
	const AVESMAPS_GARETIEN_FORM_WORT = {
		path: ["Weg", "Wege"], region: ["Fläche", "Flächen"], label: ["Beschriftung", "Beschriftungen"],
		location: ["Ort", "Orte"], settlement_place: ["Stätte", "Stätten"],
	};

	function garetienImportFormenText(jeForm) {
		const f = jeForm || {};
		const teile = [];
		Object.keys(AVESMAPS_GARETIEN_FORM_WORT).forEach(function (schluessel) {
			const n = Number(f[schluessel] || 0);
			if (n === 0) { return; }
			const wort = AVESMAPS_GARETIEN_FORM_WORT[schluessel][n === 1 ? 0 : 1];
			let stueck = n + " " + wort;
			if (schluessel === "path" && Number(f.bach || 0) > 0) {
				stueck += " (" + Number(f.bach) + (Number(f.bach) === 1 ? " Bach)" : " Bäche)");
			}
			teile.push(stueck);
		});
		return teile.join(", ");
	}

	/*
	 * REIN: was nach einem Import in der Statuszeile steht.
	 *
	 * 🔴 EIN TEILERFOLG IST EINE WARNUNG, KEINE ERFOLGSMELDUNG. Vier von fünf angelegt heißt: eines
	 * liegt NICHT auf der Karte, und der Editor muss es wissen — grün gemeldet sucht er es nie.
	 * 🔴 DER GRUND KOMMT VOM SERVER und wird nicht nachgebaut: „aus 1 Punkten lässt sich kein Ziel
	 * der Art path bauen" entsteht in avesmapsGaretienZielUebersteuern, und eine zweite Fassung im
	 * Browser liefe beim ersten neuen Fehlerfall auseinander.
	 */
	function garetienImportMeldung(summe) {
		const s = summe || {};
		const angelegt = Number(s.applied || 0);
		const fehler = Array.isArray(s.fehler) ? s.fehler : [];
		const quellen = Number((s.angelegt_je_form || {}).quelle || 0);
		const formen = garetienImportFormenText(s.angelegt_je_form);
		const teile = [];
		if (angelegt > 0) {
			teile.push("✓ " + angelegt + (angelegt === 1 ? " Objekt importiert" : " Objekte importiert")
				+ (formen === "" ? "" : " — " + formen));
		}
		if (quellen > 0) {
			teile.push((angelegt > 0 ? "" : "✓ ") + quellen
				+ (quellen === 1 ? " Quelle ergänzt" : " Quellen ergänzt"));
		}
		if (fehler.length > 0) {
			const gesamt = angelegt + fehler.length;
			// ⚠️ Genannt wird der Grund des ERSTEN Fehlschlags samt Zahl der übrigen — eine Zeile
			// trägt keine fünf Sätze, und die übrigen stehen in ihren Zeilen.
			const rest = fehler.length > 1 ? " (und " + (fehler.length - 1) + " weitere)" : "";
			teile.push("✕ " + fehler.length + " von " + gesamt + " nicht importiert: "
				+ String(fehler[0].grund || "unbekannter Grund") + rest);
		}
		if (teile.length === 0) { teile.push("Es war nichts zu importieren."); }
		return { text: teile.join(" · "), ton: fehler.length > 0 ? "bad" : (angelegt + quellen > 0 ? "ok" : "") };
	}
```

`garetienEinfuegenAusfuehren` sammelt `fehler` und `angelegt_je_form` mit in `summe`;
`garetienFussknopfEinfuegenKlick` und `garetienNeuKlick` melden nach dem Lauf:

```js
			.then(function (summe) {
				const m = garetienImportMeldung(summe);
				garetienStatusSetzen(m.text, m.ton, letzteNeuenIds.length
					? { text: "Rückgängig", ruf: function () { garetienRuecknahmeMengeAusfuehren(letzteNeuenIds, …); } }
					: null);
				return summe;
			})
```

- [ ] **Schritt 4: Grün laufen lassen** → PASS
- [ ] **Schritt 5: Mutationsprobe** — (1) `ton: "ok"` bei Fehlern → Test 2 rot; (2) `bach` als
  eigener Posten → Test 1 rot; (3) `if (n === 0) return;` streichen → „eine Form mit null" rot
- [ ] **Schritt 6: Commit**

Betreff: `feat(garetien-importer): der Import sagt, was er angelegt hat -- und was nicht, mit Grund`

---

## Aufgabe 4: `einstellungen_je_item`

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php`
- Ändern: `api/edit/wiki/sync-plan.php` (der `garetien`-Zweig, heute Zeile ~256-305)
- Test: `api/_internal/import/__tests__/garetien-einstellungen-je-item-test.php` (neu)

**Schnittstellen:**
- Erzeugt: `avesmapsGaretienEinstellungenJeItemAusRumpf(array $payload): ?array` —
  `?array<int, array>`, Schlüssel = Item-Nummer.
- Ändert: `avesmapsGaretienUebernehmen($pdo, $runId, $itemIds, $user, $einstellungen, ?array $jeItem = null)`.

- [ ] **Schritt 1: Test schreiben**

```php
// 🔴 ZWEI ITEMS, ZWEI RUEMPFE. Bis zum 06.09.2026 nahm `apply` GENAU EINEN Einstellungs-Rumpf
// fuer alle Items eines Aufrufs -- unbedenklich nur, solange der einzige Aufrufer mit Handeingabe
// auf EIN Objekt skopiert war. Die Stage schickt viele Objekte auf einmal, jedes mit seiner
// eigenen Wahl; ein gemeinsamer Rumpf haette die Wahl des zuletzt geoeffneten auf alle gelegt.
$jeItem = [
    $idA => ['ziel' => 'path', 'subtyp' => 'Flussweg', 'is_bach' => true],
    $idB => ['ziel' => 'label', 'subtyp' => 'berggipfel'],
];
$ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$idA, $idB], ['id' => 1], null, $jeItem);
assert($ergebnis['angelegt'] === 2);
assert($ergebnis['angelegt_je_form']['bach'] === 1, 'A wurde ein Bach');
assert($ergebnis['angelegt_je_form']['label'] === 1, 'B wurde ein Gipfel');

// ⚠️ RUECKFALL: ohne `jeItem` gilt der gemeinsame Rumpf wie bisher -- die bestehenden Aufrufer
// und alle heutigen Tests bleiben unveraendert gueltig.
$ergebnis2 = avesmapsGaretienUebernehmen($pdo, $runId2, [$idC], ['id' => 1], ['ziel' => 'label', 'subtyp' => 'berggipfel']);
assert($ergebnis2['angelegt_je_form']['label'] === 1);

// 💣 EIN ITEM OHNE EINTRAG BEKOMMT KEINE FREMDE EINSTELLUNG. Fiele es auf den gemeinsamen Rumpf
// zurueck, truege ein Objekt die Wahl eines anderen -- genau der Fehler, den diese Aufgabe behebt.
$ergebnis3 = avesmapsGaretienUebernehmen($pdo, $runId3, [$idD, $idE], ['id' => 1], null, [$idD => ['ziel' => 'label', 'subtyp' => 'berggipfel']]);
assert($ergebnis3['angelegt_je_form']['label'] === 1, 'nur D ist ein Gipfel');
assert($ergebnis3['angelegt_je_form']['label'] !== 2, 'E behielt seinen Vorschlag');

// Form-Riegel: was kein Array ist, wird verworfen, nicht geraten.
assert(avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => 'x']) === null);
assert(avesmapsGaretienEinstellungenJeItemAusRumpf([]) === null);
$gelesen = avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => ['7' => ['ziel' => 'path']]]);
assert(array_key_exists(7, $gelesen), 'der Schluessel wird zur ZAHL -- JSON-Objektschluessel sind Zeichenketten');
```

- [ ] **Schritt 2: Rot laufen lassen**

- [ ] **Schritt 3: Implementieren**

```php
/**
 * Die Handeingaben JE ITEM aus dem Anfragerumpf (06.09.2026, Import-Stage).
 *
 * 🔴 EIN RUMPF JE ITEM, NICHT EINER FUER ALLE. Der alte Schluessel `einstellungen` galt fuer
 * saemtliche Items eines Aufrufs; das war unbedenklich, solange der einzige Aufrufer mit
 * Handeingabe („Neu einfuegen") auf GENAU EIN Objekt skopiert war. Die Stage schickt viele
 * Objekte auf einmal, jedes mit eigener Zielwahl — ein gemeinsamer Rumpf legte die Wahl des
 * zuletzt geoeffneten auf alle uebrigen.
 *
 * 💣 DIE SCHLUESSEL KOMMEN ALS ZEICHENKETTEN AN. JSON kennt keine Zahlen als Objektschluessel;
 * `json_decode(..., true)` liefert `"7" => [...]`. PHP wandelt numerische Zeichenketten beim
 * Array-Zugriff still um — aber `array_key_exists(7, $roh)` waere `false`, wenn wir es nicht
 * ausdruecklich normalisierten. Genau daran scheitert sonst der Abgleich mit `(int) $item['id']`.
 *
 * ⚠️ KEINE VALIDIERUNG DER WERTE, nur der Form — wie beim Geschwister
 * avesmapsGaretienEinstellungenAusRumpf. Der Server bleibt an seiner gewohnten Stelle die letzte
 * Instanz (avesmapsGaretienZielUebersteuern wirft bei einem unmoeglichen Ziel).
 *
 * @return ?array<int, array>
 */
function avesmapsGaretienEinstellungenJeItemAusRumpf(array $payload): ?array
{
    $roh = $payload['einstellungen_je_item'] ?? null;
    if (!is_array($roh) || $roh === []) {
        return null;
    }
    $raus = [];
    foreach ($roh as $schluessel => $rumpf) {
        $id = (int) $schluessel;
        if ($id > 0 && is_array($rumpf)) {
            $raus[$id] = $rumpf;
        }
    }

    return $raus === [] ? null : $raus;
}
```

In `avesmapsGaretienUebernehmen` den sechsten Parameter ergänzen und je Zeile wählen:

```php
        // 🔴 DIE WAHL DIESES EINEN ITEMS SCHLAEGT DEN GEMEINSAMEN RUMPF -- und ein Item OHNE
        // Eintrag bekommt KEINEN: `null` heisst „keine Handeingabe", nicht „nimm die des
        // Nachbarn". Fiele es auf `$einstellungen` zurueck, truege ein Objekt die Wahl eines
        // anderen, und das ist genau der Fehler, den diese Erweiterung behebt.
        $rumpfDesItems = ($jeItem !== null && array_key_exists((int) $item['id'], $jeItem))
            ? $jeItem[(int) $item['id']]
            : ($jeItem === null ? $einstellungen : null);
```

und weiter unten überall `$einstellungen` durch `$rumpfDesItems` ersetzen (die Aufrufe
`avesmapsGaretienZielUebersteuern`, `…WegUebersteuerung`, `…OrtUebersteuerung`,
`…LabelUebersteuerung`, `…RegionUebersteuerung`, `…FlussrichtungAus`, `…SetztEndkreuzungen`,
`…InnerortsGewuenscht`, `…FlaecheAnlegen`).

`avesmapsGaretienApplyStep` bekommt denselben Parameter und reicht ihn durch; in
`api/edit/wiki/sync-plan.php` im `garetien`-Zweig:

```php
                $garetienEinstellungen = avesmapsGaretienEinstellungenAusRumpf($payload);
                // 🔴 Und die Handeingaben JE ITEM (06.09.2026, Import-Stage). Beide werden
                // gelesen: `einstellungen` bleibt der Rueckfall fuer jeden Aufrufer, der nur ein
                // Objekt schickt.
                $garetienJeItem = avesmapsGaretienEinstellungenJeItemAusRumpf($payload);
```

- [ ] **Schritt 4: Grün laufen lassen** — dazu `garetien-uebernahme-test.php` und
  `garetien-endpunkt-test.php` unverändert grün (der Rückfall trägt sie)

- [ ] **Schritt 5: Mutationsprobe**
1. Rückfall auf `$einstellungen` auch bei gesetztem `$jeItem` → „E behielt seinen Vorschlag" rot
2. `(int) $schluessel` weglassen → `array_key_exists(7, …)` rot
3. `$raus === [] ? null : $raus` → `$raus` → der Form-Riegel-Test rot

- [ ] **Schritt 6: Commit**

Betreff: `feat(garetien-import): jedes Item bringt seine eigene Handeingabe mit`

---

## Aufgabe 5: `liste` mit `keys`

**Dateien:**
- Ändern: `api/_internal/import/garetien-liste.php` (`avesmapsGaretienListeObjektPasstFilter`,
  `avesmapsGaretienArbeitsliste`)
- Ändern: `api/edit/map/garetien-import.php` (Filterfeld `keys`)
- Test: `api/_internal/import/__tests__/garetien-liste-keys-test.php` (neu)

**Schnittstellen:**
- Erzeugt: Filterfeld `keys: list<string>` — liefert genau diese Objekte, **über alle Stände**.

- [ ] **Schritt 1: Test schreiben**

```php
// 🔴 UEBER ALLE STAENDE. Die Stage haelt Objekte, die inzwischen uebernommen ODER abgelehnt sein
// koennen; wer sie nur im Reiter „offen" nachschluege, verloere genau die, deren Zustand sich
// geaendert hat -- und das ist die Auskunft, um derentwillen nachgeschlagen wird.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyOffen, $keyUebernommen]]);
assert(count($antwort['objekte']) === 2, 'beide, unabhaengig vom Stand');
$staende = array_column($antwort['objekte'], 'stand');
sort($staende);
assert($staende === ['offen', 'uebernommen']);

// Ein unbekannter Schluessel faellt still heraus -- der Aufrufer sieht an der fehlenden Zeile,
// dass es das Objekt im neuen Lauf nicht mehr gibt.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyOffen, 'gibt:es:nicht!X']]);
assert(count($antwort['objekte']) === 1);

// 💣 `keys` SCHLAEGT `stand`. Steht beides im Filter, gewinnt `keys` -- sonst laege der Aufrufer
// mit einem geerbten `stand: "offen"` genau die Haelfte seiner Stage zurueck.
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => [$keyUebernommen], 'stand' => 'offen']);
assert(count($antwort['objekte']) === 1, 'keys gewinnt gegen stand');

// Deckel: mehr als AVESMAPS_GARETIEN_LISTE_MAX Schluessel werden gekappt, nicht abgelehnt.
$viele = array_fill(0, AVESMAPS_GARETIEN_LISTE_MAX + 5, $keyOffen);
$antwort = avesmapsGaretienArbeitsliste($pdo, $runId, ['keys' => $viele]);
assert(count($antwort['objekte']) <= AVESMAPS_GARETIEN_LISTE_MAX);
```

- [ ] **Schritt 2: Rot laufen lassen**

- [ ] **Schritt 3: Implementieren**

In `avesmapsGaretienListeObjektPasstFilter`, ganz am ANFANG:

```php
    // 🔴 `keys` IST EIN NACHSCHLAG, KEIN FILTER -- und deshalb steht er VOR allem anderen und
    // schlaegt insbesondere `stand`. Die Stage des Fensters haelt Objekte ueber alle Staende
    // hinweg; nach einem „Holen & Rechnen" fragt sie „gibt es diese sieben noch, und wie stehen
    // sie jetzt". Ein zusaetzlich geerbtes `stand: "offen"` liesse dabei genau die heraus, deren
    // Zustand sich geaendert hat -- also die einzige Auskunft, um die es geht.
    if (isset($filter['keys']) && is_array($filter['keys']) && $filter['keys'] !== []) {
        return in_array((string) $objekt['key'], array_map('strval', $filter['keys']), true);
    }
```

Im Endpunkt `api/edit/map/garetien-import.php` das Filterfeld ergänzen:

```php
            // 🔴 Der Nachschlag der Import-Stage (06.09.2026). Er MUSS in dieser ausdruecklichen
            // Liste stehen -- der Endpunkt baut sein Filterfeld aus genau ihr, und ein fehlender
            // Schluessel wird still verworfen. Genau so war die Kachel „Angezeigte Zeilen" von
            // ihrer Auslieferung bis zum 31.08.2026 wirkungslos.
            'keys' => array_slice((array) ($payload['keys'] ?? []), 0, AVESMAPS_GARETIEN_LISTE_MAX),
```

- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) den Block hinter die `stand`-Prüfung schieben →
  „keys gewinnt gegen stand" rot; (2) `array_slice` entfernen → Deckel-Test rot
- [ ] **Schritt 6: Commit**

Betreff: `feat(garetien-import): die Arbeitsliste laesst sich nach Objektschluesseln nachschlagen`

---

## Aufgabe 6: Die Stage überlebt einen Lauf

**Warum:** der stille Fehler. Nach „Holen & Rechnen" tragen die Kopien in der Anzeige-Menge die
Item-Nummern des ÜBERHOLTEN Laufs; `select`/`apply` treffen damit null Zeilen, melden `done: true`
und schreiben nichts.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js`
- Test: `js/review/__tests__/garetien-stage-nachschlagen.test.js` (neu)

**Schnittstellen:**
- Konsumiert: `keys` (Aufgabe 5), `garetienStatusSetzen` (Aufgabe 1)
- Erzeugt: `garetienStageNachschlagen(rufe)` → `Promise<{ gefunden:number, verschwunden:string[] }>`

- [ ] **Schritt 1: Test schreiben**

```js
// 1. Nach einem Lauf wird die Stage per `keys` nachgeschlagen -- EIN Ruf, nicht einer je Objekt.
api.stageSetzen([{ key: "a", items: [{ id: 1 }] }, { key: "b", items: [{ id: 2 }] }]);
const rufe = spion({ objekte: [{ key: "a", items: [{ id: 77 }], stand: "offen" }] });
const ergebnis = await api.garetienStageNachschlagen(rufe);
assert.strictEqual(rufe.anzahl, 1, "genau ein Ruf");
assert.deepStrictEqual([...rufe.letzterRumpf.keys], ["a", "b"]);
assert.strictEqual(rufe.letzterRumpf.action, "liste");

// 2. 💣 DIE FRISCHEN ITEM-NUMMERN ERSETZEN DIE ALTEN. Ohne das schickte der naechste Import die
//    Nummern des ueberholten Laufs -- `WHERE run_id = ? AND id IN (...)` trifft null Zeilen,
//    meldet `done: true` und schreibt nichts. Ein stiller Leerlauf.
assert.deepStrictEqual(api.stageObjekt("a").items.map((i) => i.id), [77]);

// 3. Was es nicht mehr gibt, verlaesst die Stage UND wird genannt.
assert.deepStrictEqual(ergebnis.verschwunden, ["b"]);
assert.strictEqual(api.stageHat("b"), false);
assert.ok(api.letzteStatusMeldung().text.includes("gibt es im neuen Lauf nicht mehr"));

// 4. Eine LEERE Stage ruft gar nicht.
api.stageLeeren();
const rufe2 = spion({ objekte: [] });
await api.garetienStageNachschlagen(rufe2);
assert.strictEqual(rufe2.anzahl, 0, "ohne Stage kein Ruf");

// 5. Ein Fehlschlag laesst die Stage STEHEN -- lieber eine veraltete Stage als eine geleerte.
api.stageSetzen([{ key: "a", items: [{ id: 1 }] }]);
await api.garetienStageNachschlagen(() => Promise.reject(new Error("Netz")));
assert.strictEqual(api.stageHat("a"), true);
```

- [ ] **Schritt 2: Rot laufen lassen**

- [ ] **Schritt 3: Implementieren**

```js
	/*
	 * DIE STAGE AM GELTENDEN LAUF NACHSCHLAGEN (06.09.2026).
	 *
	 * 💣 DER STILLE FEHLER, DEN DAS BEHEBT. Die Stage hält KOPIEN der Serverobjekte, samt ihrer
	 * `items[].id`. Nach einem „Holen & Rechnen" gehören diese Nummern einem ÜBERHOLTEN Lauf;
	 * `avesmapsSyncPlanSetSelection` und `apply` filtern auf `run_id = ? AND id IN (...)`, treffen
	 * null Zeilen, melden `done: true` — und schreiben nichts. Kein Fehler, keine Meldung, der
	 * Knopf sieht aus, als hätte er gearbeitet.
	 * 🔴 EIN RUF FÜR DIE GANZE STAGE (`keys`), nicht einer je Objekt: bei 200 gestagten Objekten
	 * wären das 200 Anfragen an einen Endpunkt, der jedes Mal das ganze Laufinventar liest —
	 * genau die Schleife, vor der AGENTS.md für STRATO warnt.
	 * 🔴 ER ERSETZT `avesmapsGaretienAnzeigeNachEinfuegenBereinigen`: jene fragte den Reiter
	 * „uebernommen" ab und sah damit nur EINE Sorte Veränderung. Dieser Weg sieht alle.
	 * ⚠️ Fällt OFFEN aus: scheitert der Ruf, bleibt die Stage stehen. Eine geleerte Stage nach
	 * einem Netzfehler wäre der teurere Ausgang — die Arbeit einer halben Stunde.
	 */
	function garetienStageNachschlagen(rufe) {
		const schluessel = Array.from(zustand.stage.keys());
		if (schluessel.length === 0) {
			return Promise.resolve({ gefunden: 0, verschwunden: [] });
		}
		return rufe(GARETIEN_ENDPUNKT, {
			action: "liste", run_id: zustand.importRunId, keys: schluessel,
			ebene: [], typ: [], urteil: [], wiki: [], suche: "",
			nur_ungehakt: false, nur_mehrteilig: false,
		}).then(function (antwort) {
			const frisch = {};
			((antwort && antwort.objekte) || []).forEach(function (o) {
				if (o && o.key !== undefined && o.key !== null) { frisch[String(o.key)] = o; }
			});
			const verschwunden = [];
			schluessel.forEach(function (s) {
				if (frisch[s]) {
					// 🔴 ERSETZEN, nicht ergänzen: es geht um die frischen Item-Nummern.
					zustand.stage.set(s, frisch[s]);
					return;
				}
				zustand.stage.delete(s);
				zustand.nurIhre.delete(s);
				verschwunden.push(s);
			});
			return { gefunden: Object.keys(frisch).length, verschwunden: verschwunden };
		}).catch(function () {
			return { gefunden: 0, verschwunden: [] };
		});
	}
```

Aufgerufen an ZWEI Stellen: am Ende von `garetienLaufStarten` (nach `plan`, vor `listeHolen`) und
am Ende jeder Import-Kette (statt `avesmapsGaretienAnzeigeNachEinfuegenBereinigen`). Beide melden
Verschwundene über `garetienStatusSetzen`.

- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) `zustand.stage.set(s, frisch[s])` weglassen → Test 2 rot;
  (2) `catch` leert die Stage → Test 5 rot; (3) je Objekt ein Ruf → Test 1 rot
- [ ] **Schritt 6: Commit**

Betreff: `fix(garetien-importer): die Stage wird nach jedem Lauf nachgeschlagen -- alte Item-Nummern liefen still ins Leere`

---

## Aufgabe 7: Bach als Art

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienArtenFuerForm`,
  `garetienEingabenFuerServer`, `garetienZielWahlZu`, `garetienWegTransporteZu`)
- Ändern: `api/_internal/import/garetien-plan.php` (`avesmapsGaretienZielUebersteuern`)
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`avesmapsGaretienWegUebersteuerung`)
- Test: `js/review/__tests__/garetien-zielwahl-bach.test.js` (neu)
- Test: `api/_internal/import/__tests__/garetien-bach-wahl-test.php` (neu)

**Schnittstellen:**
- Der Client schickt in `einstellungen` zusätzlich `is_bach: boolean`, aber NUR bei
  `subtyp === "Flussweg"`.
- Art-Schlüssel im `<select>`: `"Flussweg"` und `"Flussweg:bach"` — der zweite ist ein
  ANZEIGE-Schlüssel und wird beim Senden in `{subtyp: "Flussweg", is_bach: true}` zerlegt.

- [ ] **Schritt 1: JS-Test schreiben**

```js
// 1. „Bach" steht NUR unter der Form „Weg", und nur einmal.
const arten = api.garetienArtenFuerForm("path").map((a) => a.key);
assert.ok(arten.includes("Flussweg"));
assert.ok(arten.includes("Flussweg:bach"));
assert.strictEqual(arten.filter((k) => k.startsWith("Flussweg")).length, 2);
assert.strictEqual(api.garetienArtenFuerForm("region").some((a) => /bach/i.test(a.key)), false);

// 2. 🔴 DER ANZEIGE-SCHLUESSEL WIRD BEIM SENDEN ZERLEGT. `Flussweg:bach` ist kein Wegtyp -- der
//    Schreib-Riegel des Hauses lehnt ihn ab (AVESMAPS_GARETIEN_TYP_MAP: „Bach bleibt ANZEIGE-
//    Schluessel, nie Speicher-Schluessel").
api.zielWahlSetzen("k1", { ziel: "path", subtyp: "Flussweg:bach" });
let rumpf = api.garetienEingabenFuerServer({ key: "k1", geometrie: [[0, 0], [1, 1]] });
assert.strictEqual(rumpf.subtyp, "Flussweg", "gespeichert wird der Flussweg");
assert.strictEqual(rumpf.is_bach, true);

// 3. Eine andere Wegart schickt `is_bach: false` -- AUSDRUECKLICH, nicht weggelassen: der Server
//    muss ein abgewaehltes Haekchen von „nicht gesagt" unterscheiden koennen.
api.zielWahlSetzen("k1", { ziel: "path", subtyp: "Pfad" });
rumpf = api.garetienEingabenFuerServer({ key: "k1", geometrie: [[0, 0], [1, 1]] });
assert.strictEqual(rumpf.subtyp, "Pfad");
assert.strictEqual(rumpf.is_bach, false);

// 4. Bei einer NICHT-Weg-Form reist `is_bach` gar nicht -- eine Flaeche hat keine Befahrbarkeit.
api.zielWahlSetzen("k1", { ziel: "region", subtyp: "see", kind: "topographie" });
rumpf = api.garetienEingabenFuerServer({ key: "k1", geometrie: [[0,0],[1,1],[2,2]] });
assert.strictEqual("is_bach" in rumpf, false);

// 5. Die Vorbelegung kommt vom SERVER (`objekt.is_bach`), nicht aus dem Typnamen.
api.zielWahlVergessen();
const wahl = api.garetienZielWahlZu({ key: "k2", ziel: "path", subtyp: "Flussweg", is_bach: true });
assert.strictEqual(wahl.subtyp, "Flussweg:bach");

// 6. Die Verkehrsmittel haengen an der WAHL, nicht mehr am Serverwert: ein zum Bach gemachter
//    Fluss zeigt sofort keine Verkehrsmittel.
api.zielWahlSetzen("k3", { ziel: "path", subtyp: "Flussweg:bach" });
assert.deepStrictEqual(api.garetienWegTransporteZu({ key: "k3", is_bach: false }, "Flussweg"), []);
```

- [ ] **Schritt 2: Rot laufen lassen**

- [ ] **Schritt 3: Client implementieren**

```js
	// 🔴 „Bach" IST EINE ART UNTER WEG, KEIN WEGTYP (Owner 06.09.2026: „dass ein fluss ein bach
	// werden kann, fehlt"). Gespeichert wird `feature_subtype: "Flussweg"` plus
	// `properties.is_bach` — so entschied der Owner am 30.08.2026, und der Schreib-Riegel lehnt
	// „Bach" als Wegtyp ausdrücklich ab. Hier braucht die AUSWAHL trotzdem zwei Einträge, also
	// bekommt der zweite einen zusammengesetzten ANZEIGE-Schlüssel, den
	// `garetienEingabenFuerServer` wieder zerlegt.
	const AVESMAPS_GARETIEN_ART_BACH = "Flussweg:bach";

	function garetienArtBachZerlegen(schluessel) {
		return String(schluessel) === AVESMAPS_GARETIEN_ART_BACH
			? { subtyp: "Flussweg", bach: true }
			: { subtyp: String(schluessel || ""), bach: false };
	}
```

In `garetienArtenFuerForm("path")` hinter dem `Flussweg`-Eintrag:

```js
			// ⚠️ Direkt HINTER seinem Flussweg, nicht am Ende: die zwei gehören zusammen, und ein
			// Editor sucht den Bach beim Fluss.
			liste.splice(liste.findIndex((e) => e.key === "Flussweg") + 1, 0,
				{ key: AVESMAPS_GARETIEN_ART_BACH, label: "Bach (nicht befahrbar)", kind: "" });
```

In `garetienZielVorbelegung` (der Server sagt es):

```js
		// 🔴 DIE VORBELEGUNG KOMMT VOM SERVER, nicht aus dem Typnamen: `objekt.is_bach` ist die
		// Auskunft von avesmapsGaretienNachIstBach, und die liest die Zuordnungstabelle. Ein
		// Vergleich auf `typ === "Bach"` wäre ihre zweite Fassung.
		if (vorschlag.ziel === "path" && o.is_bach === true) {
			vorschlag.subtyp = AVESMAPS_GARETIEN_ART_BACH;
		}
```

In `garetienEingabenFuerServer`, `path`-Zweig:

```js
			const bachWahl = garetienArtBachZerlegen(wahl.subtyp);
			rausWeg.subtyp = bachWahl.subtyp;
			// 🔴 IMMER MITSCHICKEN, auch als `false`. Der Server fällt ohne das Feld auf die
			// ZUORDNUNGSTABELLE zurück (avesmapsGaretienNachIstBach) — ein abgewähltes Häkchen
			// wäre dann wirkungslos, und aus einem zum Fluss gemachten Bach würde wieder ein Bach.
			rausWeg.is_bach = bachWahl.bach;
			if (bachWahl.subtyp === "Flussweg") { rausWeg.flow_dir = …; }
```

`garetienWegTransporteZu` liest die WAHL statt `objekt.is_bach`; `garetienEingefuegtWirdWegMarkup`
ebenso (`istBach` aus `garetienArtBachZerlegen(garetienZielWahlZu(objekt).subtyp).bach`).

- [ ] **Schritt 4: PHP-Test schreiben**

```php
// 1. Fluss -> Bach OHNE Artwechsel. 💣 DIE FALLE: `avesmapsGaretienZielUebersteuern` steigt frueh
//    aus, wenn Ziel UND Subtyp dem Vorschlag entsprechen -- bei Fluss->Bach ist genau das der
//    Fall, und ohne `is_bach` im Vergleich waere die Wahl still verschluckt.
$nach = ['ziel' => 'path', 'subtyp' => 'Flussweg', 'herkunft' => 'garetien',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[0,0],[1,1]]]];
$raus = avesmapsGaretienZielUebersteuern($nach, ['ziel' => 'path', 'subtyp' => 'Flussweg', 'is_bach' => true]);
assert(($raus['is_bach'] ?? false) === true, 'Fluss wird Bach');

// 2. Bach -> Strasse loescht das Haekchen. Ein `is_bach` an einer Strasse waere eine Aussage ueber
//    eine Befahrbarkeit, die es dort gar nicht gibt.
$nachBach = $nach + ['is_bach' => true];
$raus = avesmapsGaretienZielUebersteuern($nachBach, ['ziel' => 'path', 'subtyp' => 'Strasse', 'is_bach' => false]);
assert(!array_key_exists('is_bach', $raus) || $raus['is_bach'] === false);

// 3. Bach -> Flaeche loescht es ebenso.
$raus = avesmapsGaretienZielUebersteuern($nachBach, ['ziel' => 'region', 'subtyp' => 'see', 'kind' => 'topographie']);
assert(!array_key_exists('is_bach', $raus) || $raus['is_bach'] === false);

// 4. OHNE Handeingabe entscheidet weiter die Zuordnungstabelle -- „Alle importieren" ohne
//    Einstellungen legt Baeche an wie bisher.
$raus = avesmapsGaretienZielUebersteuern($nachBach, null);
assert(($raus['is_bach'] ?? false) === true);
```

- [ ] **Schritt 5: Server implementieren**

In `avesmapsGaretienZielUebersteuern`, VOR dem frühen Ausstieg:

```php
    // 🔴 `is_bach` IST TEIL DER WAHL, und deshalb steht es VOR dem Gleichheits-Ausstieg darunter.
    // Fluss -> Bach ändert WEDER Ziel NOCH Subtyp (beides bleibt `path`/`Flussweg`) -- der
    // Ausstieg „Wahl == Vorschlag, nichts zu tun" hätte die Entscheidung des Editors sonst still
    // verschluckt, und zwar genau in dem Fall, für den der Owner das Feld bestellt hat.
    // ⚠️ Nur bei einem Flussweg: an einer Straße ist der Satz bedeutungslos, und
    // avesmapsPathIstBach würde ihn ohnehin fallen lassen -- er soll aber gar nicht erst
    // mitreisen, sonst behauptet die Planzeile etwas über ein Feld, das nichts bewirkt.
    if (is_array($einstellungen) && array_key_exists('is_bach', $einstellungen)) {
        $zielArt = trim((string) ($einstellungen['subtyp'] ?? ($nach['subtyp'] ?? '')));
        if ((string) ($einstellungen['ziel'] ?? $nach['ziel'] ?? '') === 'path' && $zielArt === 'Flussweg') {
            $nach['is_bach'] = (bool) $einstellungen['is_bach'];
        } else {
            unset($nach['is_bach']);
        }
    }
```

- [ ] **Schritt 6: Beide grün laufen lassen**
- [ ] **Schritt 7: Mutationsprobe** — (1) den Block hinter den Gleichheits-Ausstieg schieben →
  PHP-Test 1 rot; (2) `rausWeg.is_bach` nur bei `true` senden → JS-Test 3 rot; (3) `unset` weglassen
  → PHP-Test 2 rot
- [ ] **Schritt 8: Im Browser abnehmen** — einen Fluss auf „Bach" stellen, Kasten prüfen
  (Verkehrsmittel gesperrt, Hinweissatz), `usability-design`
- [ ] **Schritt 9: Commit**

Betreff: `feat(garetien-importer): ein Fluss laesst sich als Bach importieren`

---

## Aufgabe 8: Umbenennung — Anzeige wird Stage, Markierung wird Auswahl

**Warum:** sieben Auswahlbegriffe in einem Fenster sind der Kern der Verwirrung. Diese Aufgabe
ändert NUR Namen und Texte, kein Verhalten.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js`, `index.html`
- Ändern: die betroffenen Tests (rund 20 von 34)
- Test: `js/review/__tests__/garetien-vokabular.test.js` (neu)

- [ ] **Schritt 1: Wächter-Test schreiben**

```js
// 🔴 ZWEI BEGRIFFE, NICHT SIEBEN (Entwurf §2). Die Oberfläche kennt „Auswahl" (das Häkchen) und
// „Stage" (was auf der Karte liegt und importiert wird). Alles andere war Systemvokabular, das
// der Editor nie zuordnen konnte.
const quelle = lies("js/review/review-garetien-importer.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const html = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");

["Markierte anzeigen", "Anzeige leeren", "Alle markieren", "Keines markieren",
 "Alle angezeigten einfügen", "Angehakte übernehmen", "vorgemerkt"].forEach((wort) => {
	assert.ok(!quelle.includes(wort), "Alttext im JS: " + wort);
	assert.ok(!html.includes(wort), "Alttext im Markup: " + wort);
});
// ⚠️ Die KENNUNGEN wandern NICHT mit -- dieselbe Trennung wie bei „Neuigkeiten"/`changelog`
// (AGENTS.md §11): eine umgetaufte ID liesse eine gecachte Seite ins Leere greifen.
assert.ok(html.includes('id="garetien-mark-show"') === false, "der Knopf ist weg, nicht umbenannt");
assert.ok(quelle.includes("zustand.stage"), "die Menge heisst stage");
assert.ok(quelle.includes("zustand.auswahl"), "das Haekchen heisst auswahl");
assert.ok(!/zustand\.anzeige\b/.test(quelle) && !/zustand\.markiert\b/.test(quelle));
```

- [ ] **Schritt 2: Rot laufen lassen**

- [ ] **Schritt 3: Umbenennen**

| alt | neu |
|---|---|
| `zustand.anzeige` | `zustand.stage` |
| `zustand.markiert` | `zustand.auswahl` |
| `avesmapsGaretienAnzeigeHinzufuegen` | `avesmapsGaretienStageHinzufuegen` |
| `avesmapsGaretienAnzeigeLeeren` | `avesmapsGaretienStageLeeren` |
| `avesmapsGaretienAnzeigeListe` | `avesmapsGaretienStageListe` |
| `avesmapsGaretienAnzeigeHat` | `avesmapsGaretienStageHat` |
| `avesmapsGaretienAnzeigeAuffrischen` | `avesmapsGaretienStageAuffrischen` |
| `avesmapsGaretienMarkierungUmschalten` | `avesmapsGaretienAuswahlUmschalten` |
| `avesmapsGaretienMarkierungHat` | `avesmapsGaretienAuswahlHat` |
| `avesmapsGaretienAlleMarkieren` | `avesmapsGaretienAlleWaehlen` |
| `avesmapsGaretienKeineMarkieren` | `avesmapsGaretienAuswahlAufheben` |
| Reiter `anzeigen` | Reiter `stage` (Beschriftung „Stage") |

Die Beschriftung des Reiters wird „Stage", der Hinweis darunter: „Was hier steht, liegt auf der
Karte und wird mit „Stage importieren" angelegt — gefiltert wird nach Name und Typ."

Tote Texte: der Tooltip in `index.html` („Angehakte übernehmen" → „Stage importieren"),
`garetienZusatzRueckfrageText` („Jetzt wird nur vorgemerkt…" → „Das Objekt kommt auf die Stage und
wird mit „Stage importieren" angelegt."), `garetienEinfuegenRueckfrageText` (der Satz über Name
und Geometrie entfällt), die Abschnittsbeschriftungen („nichts zu ersetzen" → „bleibt unberührt",
„⚠ Name weicht ab" → „anderer Name"), der Fußhinweis mit dem Wort „Stufen" → „…sie haben in
diesem Lauf keinen Vorschlag."

Ebenfalls entfernt: das ✦ (`.lit-dot`) in der Listenzeile und der Filtereintrag „nur ungehakte"
(beide zeigen die Server-Vormerkung, die der Editor nicht mehr in der Hand hat).

- [ ] **Schritt 4: Alle Garetien-Tests nachziehen und grün laufen lassen**

Run: `for t in js/review/__tests__/garetien-*.test.js; do node "$t" || echo "ROT: $t"; done`

- [ ] **Schritt 5: Im Browser abnehmen** (nur Namen, aber sichtbar) + `usability-konsistenz`
- [ ] **Schritt 6: Commit**

Betreff: `ui(garetien-importer): zwei Begriffe statt sieben -- „Auswahl" und „Stage"`

---

## Aufgabe 9: Listenkopf und Auswahlleiste

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js`, `css/components/garetien-importer.css`
- Ändern: `index.html` (die alten Fußknöpfe fallen)
- Test: `js/review/__tests__/garetien-auswahlleiste.test.js` (neu)

**Schnittstellen:**
- Erzeugt: `garetienAuswahlleisteZustand(stand, anzahlGewaehlt, objekte)` → REIN,
  `{ sichtbar: boolean, knoepfe: Array<{name, t1, t2, ton, gesperrt}> }`

- [ ] **Schritt 1: Test schreiben**

```js
// 1. Ohne Auswahl KEINE Leiste -- sie ist der Kontext der Auswahl, keine Dauereinrichtung.
assert.strictEqual(api.garetienAuswahlleisteZustand("offen", 0, []).sichtbar, false);

// 2. Je Reiter andere Knöpfe. 🔴 Die Menge ist dieselbe, die Handlungen sind es nicht.
const namen = (stand, n) => api.garetienAuswahlleisteZustand(stand, n, []).knoepfe.map((k) => k.name);
assert.deepStrictEqual(namen("offen", 2), ["stage", "ablehnen", "aufheben"]);
assert.deepStrictEqual(namen("stage", 2), ["entstagen", "ablehnen", "aufheben"]);
assert.deepStrictEqual(namen("uebernommen", 2), ["ruecknahme", "zurueck_offen", "aufheben"]);
assert.deepStrictEqual(namen("abgelehnt", 2), ["wieder", "aufheben"]);

// 3. Die ZAHL steht in der zweiten Zeile, nicht im Namen.
const k = api.garetienAuswahlleisteZustand("offen", 3, []).knoepfe[0];
assert.strictEqual(k.t1, "Auf die Stage");
assert.ok(k.t2.includes("3"));

// 4. „Ablehnen" trägt den roten Ton, „Auf die Stage" den Akzent -- und NIE eine Füllung: die eine
//    gefüllte Handlung des Fensters steht im Fuß (AGENTS.md §12).
assert.strictEqual(namenTon("offen", "ablehnen"), "danger");
assert.strictEqual(namenTon("offen", "stage"), "stage");
assert.ok(api.garetienAuswahlleisteZustand("offen", 3, []).knoepfe.every((b) => b.ton !== "primary"));
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — reine Tafel je Stand, DOM-Hälfte daneben (dieselbe Trennung
  wie bei `garetienAlleMarkierenZustand`/`…KnopfSetzen`). Der Listenkopf bekommt das Häkchen
  „alle n" (wählt die gerenderten Zeilen) und rechts den Zähler.
- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) Leiste immer sichtbar → Test 1 rot; (2) gleiche Knöpfe
  je Reiter → Test 2 rot; (3) Zahl in `t1` → Test 3 rot
- [ ] **Schritt 6: Browser + `usability-design`**
- [ ] **Schritt 7: Commit**

Betreff: `feat(garetien-importer): eine Auswahlleiste je Reiter -- die Mehrfachauswahl bekommt ihre Handlungen`

---

## Aufgabe 10: Ein Vorwärtsknopf je Zustand

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL`,
  `garetienHandlungen`, `garetienArtenFuerForm`, `garetienEingefuegtWirdMarkup`)
- Test: `js/review/__tests__/garetien-handlungen.test.js` (bestehend, erweitert)
- Test: `js/review/__tests__/garetien-formen.test.js` (neu)

- [ ] **Schritt 1: Test schreiben**

```js
// 1. Ein offenes Objekt mit Vorschlag hat GENAU EINEN Vorwärtsknopf.
const k = api.garetienHandlungen({ stand: "offen", urteil: "neu", items: [{ id: 1, change_type: "new" }] });
assert.deepStrictEqual(k.map((b) => b.name), ["stage", "ablehnen"]);

// 2. 🔴 „Stätte" und „Nur Quelle + Artikel" sind FORMEN, keine Knöpfe (Owner 06.09.2026).
const formen = api.garetienMoeglicheFormen({
	geometrie: [[0, 0]], innerorts: { name: "Wandleth" },
	items: [{ id: 1, change_type: "new" }, { id: 2, change_type: "changed", felder: ["quelle"], abschnitt: { public_id: "Flussweg-1" } }],
}).map((f) => f.key);
assert.ok(formen.includes("settlement_place"), "Stätte ist eine Form");
assert.ok(formen.includes("quelle"), "Nur Quelle + Artikel ist eine Form");
assert.strictEqual(api.garetienHandlungen({ stand: "offen", urteil: "neu", items: [] })
	.some((b) => b.name === "innerorts" || b.name === "quelle"), false, "und keine Knöpfe mehr");

// 3. Ohne Innerorts-Befund gibt es die Form nicht -- sie behauptete sonst eine Stadt, die
//    niemand gemessen hat.
assert.strictEqual(api.garetienMoeglicheFormen({ geometrie: [[0, 0]], items: [{ id: 1, change_type: "new" }] })
	.some((f) => f.key === "settlement_place"), false);

// 4. Ein gestagtes Objekt zeigt den Rückweg, kein zweites „Auf die Stage".
api.stageSetzen([{ key: "k", items: [{ id: 1, change_type: "new" }] }]);
assert.deepStrictEqual(
	api.garetienHandlungen({ key: "k", stand: "offen", urteil: "neu", items: [{ id: 1, change_type: "new" }] }).map((b) => b.name),
	["entstagen", "ablehnen"]);
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — `AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL` wird auf
  `["stage", "ablehnen"]` bzw. `["ablehnen"]` reduziert; `garetienMoeglicheFormen` bekommt die
  zwei zusätzlichen Formen (an Befund und Items gebunden); `garetienEingabenFuerServer` liefert
  für `settlement_place` den Rumpf `{ innerorts: true }` und für `quelle` die Item-Auswahl.
- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) „Stätte" ohne Befund anbieten → Test 3 rot;
  (2) `stage`-Knopf auch am gestagten Objekt → Test 4 rot
- [ ] **Schritt 6: Browser + `usability-design`**
- [ ] **Schritt 7: Commit**

Betreff: `ui(garetien-importer): ein Vorwaertsknopf je Zustand -- Staette und Quelle werden Formen`

---

## Aufgabe 11: Der Import nimmt die Einstellungen der Stage

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienEinfuegenAusfuehren`,
  `garetienFussknopfEinfuegenKlick`, `garetienUebernahmeKnopfZustand`)
- Test: `js/review/__tests__/garetien-stage-import-rumpf.test.js` (neu)

**Schnittstellen:**
- Erzeugt: `garetienStageEinstellungenJeItem(objekte)` → `{ "<item_id>": <rumpf> }`

- [ ] **Schritt 1: Test schreiben**

```js
// 1. 💣 JEDES ITEM BEKOMMT DEN RUMPF SEINES OBJEKTS. Bis zum 06.09.2026 schickte die
//    Massenübernahme GAR KEINE Einstellungen -- wer 40 Bäche auf Zoom 5 gestellt hatte, verlor
//    alle 40 Eingaben beim Fußknopf, ohne Hinweis.
api.stageSetzen([
	{ key: "a", items: [{ id: 1, change_type: "new" }] },
	{ key: "b", items: [{ id: 2, change_type: "new" }] },
]);
api.zielWahlSetzen("a", { ziel: "path", subtyp: "Flussweg:bach" });
api.zielWahlSetzen("b", { ziel: "label", subtyp: "berggipfel" });
const jeItem = api.garetienStageEinstellungenJeItem(api.stageListe());
assert.strictEqual(jeItem["1"].is_bach, true);
assert.strictEqual(jeItem["2"].subtyp, "berggipfel");
// ⚠️ Die DIFFERENZ ist die Zusicherung: b darf NICHT die Wahl von a tragen.
assert.notStrictEqual(jeItem["2"].ziel, jeItem["1"].ziel);

// 2. Der Rumpf reist wirklich hinaus.
const rufe = spionApply();
await api.garetienFussknopfImportieren(api.stageListe(), 9, rufe, null, () => true);
const applyRumpf = rufe.rufe.find((r) => r.action === "apply");
assert.ok(applyRumpf.einstellungen_je_item, "einstellungen_je_item steht im Rumpf");
assert.deepStrictEqual(Object.keys(applyRumpf.einstellungen_je_item).sort(), ["1", "2"]);

// 3. Ein Objekt OHNE Vorschlag ist nicht dabei -- es bleibt auf der Stage liegen.
api.stageSetzen([{ key: "c", items: [] }]);
assert.deepStrictEqual(Object.keys(api.garetienStageEinstellungenJeItem(api.stageListe())), []);

// 4. Die Rückfrage nennt die Formen, nicht nur eine Zahl.
const text = api.garetienImportRueckfrageText(api.stageListe());
assert.ok(/\d+ (Objekt|Objekte)/.test(text));
assert.ok(text.includes("Weg") || text.includes("Fläche") || text.includes("Beschriftung"));
assert.ok(!text.includes("Geometrie"), "der Satz über Name/Geometrie-Ersetzen ist weg");
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — `garetienEinfuegenAusfuehren` bekommt statt
  `einstellungen` das Wörterbuch und legt es je Häppchen in den `apply`-Rumpf (nur die Items
  DIESES Häppchens, damit der Rumpf nicht wächst).
- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) einen gemeinsamen Rumpf schicken → Test 1 rot;
  (2) das Wörterbuch ungefiltert je Häppchen → eine neue Zusicherung „nur die Items des Häppchens"
- [ ] **Schritt 6: Browser abnehmen** — zwei Objekte mit verschiedenen Zielen stagen, importieren,
  auf der Karte beide Formen nachsehen
- [ ] **Schritt 7: Commit**

Betreff: `fix(garetien-importer): der Sammel-Import nimmt die Einstellungen JEDES Objekts mit`

---

## Aufgabe 12: Zweizeilige Kacheln und 1000 px

**Dateien:**
- Ändern: `css/components/garetien-importer.css`, `index.html`,
  `js/review/review-garetien-importer.js` (Knopf-Markup)
- Test: `js/review/__tests__/garetien-knopfreihe.test.js` (neu)

- [ ] **Schritt 1: Test schreiben**

```js
const css = lies("css/components/garetien-importer.css");
// 🔴 1000px an ZWEI Stellen (offener und eingeklappter Planer), und die alten Zahlen dürfen
// nirgends stehengeblieben sein.
assert.strictEqual((css.match(/min\(1000px,/g) || []).length, 2);
["855px", "835px", "745px", "800px"].forEach((alt) => {
	assert.ok(!css.includes(alt), "abgeloeste Breite steht noch da: " + alt);
});
// 💣 ES IST `.avm-tile`, KEINE NEUE KLASSE. `.btn2` ist im Haus besetzt (Modalknopf im
// Landschaften-Editor, inline abgeschriebene Kachel in drei Sync-Editoren).
const js = lies("js/review/review-garetien-importer.js");
assert.ok(!/class="[^"]*\bbtn2\b/.test(js), "keine btn2-Knoepfe");
assert.ok(js.includes('class="avm-tile'), "die Reihen nutzen die Kachel des Menuebands");
// 🔴 Die drei Reihen brechen NICHT um.
["\\.gi-acts", "\\.gi-auswahl", "\\.gi-foot"].forEach((sel) => {
	const block = css.slice(css.search(new RegExp("^" + sel + " \\{", "m")));
	assert.ok(/flex-wrap:\s*nowrap/.test(block.slice(0, 400)), sel + " muss nowrap tragen");
});
// ⚠️ Die gemessene Fortschritts-Sperre (gestrichelte Goldkante, cursor: progress) gehört dem
// MENUEBAND. In einer Knopfreihe heisst gesperrt „geht gerade nicht", nicht „laeuft".
assert.ok(css.includes(".gi-win .avm-ribbon-bar .avm-tile:disabled"),
	"die Fortschritts-Sperre ist auf das Menueband gescopt");
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — Breite auf `min(1000px, …)` an beiden Stellen; die drei
  Reihen bekommen `--avm-ribbon-pad`, `flex-wrap: nowrap`, `gap: var(--avm-ribbon-gap)` und ihre
  Kinder `flex: 1 1 0; min-width: 0`; die bestehende `:disabled`-Regel wird auf
  `.gi-win .avm-ribbon-bar .avm-tile:disabled` gescopt; die Reihen bekommen ihre eigene:

```css
/* Gesperrt in einer KNOPFREIHE heißt „geht gerade nicht" — nicht „läuft". Die gemessene
   Fortschritts-Sperre (gestrichelte Goldkante, cursor: progress) bleibt dem Menüband.
   ⚠️ BEIDE Zeilen stehen auf --color-text-muted: auf --color-disabled-bg misst der 4,62 (hell)
   und 5,71 (dunkel) — die Messtabelle an der Menüband-Regel führt beide Werte. --color-disabled-text
   ergäbe für die fette Überschrift 2,12 und wäre unlesbar. */
.gi-win .gi-acts .avm-tile:disabled,
.gi-win .gi-auswahl .avm-tile:disabled,
.gi-win .gi-foot .avm-tile:disabled {
	background: var(--color-disabled-bg);
	border: 1px solid var(--color-disabled-border);
	cursor: not-allowed;
}
.gi-win .gi-acts .avm-tile:disabled .t1, .gi-win .gi-acts .avm-tile:disabled .t2,
.gi-win .gi-auswahl .avm-tile:disabled .t1, .gi-win .gi-auswahl .avm-tile:disabled .t2,
.gi-win .gi-foot .avm-tile:disabled .t1, .gi-win .gi-foot .avm-tile:disabled .t2 {
	color: var(--color-text-muted);
}
```

- [ ] **Schritt 4: Grün laufen lassen**; dazu `garetien-freischalten.test.js` (zählt die Breite)
- [ ] **Schritt 5: Browser, HELL und DUNKEL**, dann `usability-design` gegen das Mockup §1/§2
- [ ] **Schritt 6: Commit**

Betreff: `ui(garetien-importer): 1000px breit, zweizeilige Kacheln in einer Reihe`

---

## Aufgabe 13: Nähe mit Typenfilter

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienNaeheMarkup`, `garetienNaeheKlick`)
- Test: `js/review/__tests__/garetien-naehe-typfilter.test.js` (neu)

- [ ] **Schritt 1: Test schreiben**

```js
const gefunden = [
	{ key: "a", typ: "Fluss" }, { key: "b", typ: "Fluss" }, { key: "c", typ: "Bach" }, { key: "d", typ: "See" },
];
// 1. Vorgabe ist der EIGENE Typ, und er steht oben.
const g = api.garetienNaeheGruppen(gefunden, "Fluss");
assert.strictEqual(g[0].key, "gleich");
assert.strictEqual(g[0].label, "gleicher Typ · Fluss (2)");
// 2. Dann jeder gefundene Typ mit seiner Zahl, zuletzt „alle".
assert.deepStrictEqual(g.slice(1).map((e) => e.label), ["Bach (1)", "Fluss (2)", "See (1)", "alle Typen (4)"]);
// 3. Die Auswahl bestimmt, was gestagt wird -- und die Zahl im Knopf.
assert.deepStrictEqual(api.garetienNaeheMenge(gefunden, "Fluss", "Bach").map((o) => o.key), ["c"]);
assert.deepStrictEqual(api.garetienNaeheMenge(gefunden, "Fluss", "gleich").map((o) => o.key), ["a", "b"]);
assert.strictEqual(api.garetienNaeheMenge(gefunden, "Fluss", "alle").length, 4);
// 4. Ohne eigenen Typ (ein Objekt ohne `typ`) faellt die Gruppe „gleich" weg statt leer dazustehen.
assert.strictEqual(api.garetienNaeheGruppen(gefunden, "").some((e) => e.key === "gleich"), false);
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — REIN, aus der schon geladenen Trefferliste; der Zustand der
  Auswahl steht neben dem DOM (wie `_garetienNaeheGefunden`), damit ein Neuzeichnen ihn nicht
  verliert.
- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) „gleich" nicht zuerst → Test 1 rot; (2) „alle" nicht
  zuletzt → Test 2 rot
- [ ] **Schritt 6: Browser + `usability-design`**
- [ ] **Schritt 7: Commit**

Betreff: `feat(garetien-importer): „In der Naehe" bekommt einen Typenfilter und staged`

---

## Aufgabe 14: Die Vorschau auf der Karte

**Dateien:**
- Ändern: `js/review/review-garetien-karte.js`, `js/review/review-garetien-importer.js` (Stempel)
- Test: `js/review/__tests__/garetien-karte-vorschau.test.js` (neu)

- [ ] **Schritt 1: Test schreiben**

```js
// 1. Ein Bach zeichnet in seinem eigenen Ton und dünner. Das Token gibt es seit jeher und hatte
//    bis heute KEINEN Leser.
const sichtBach = api.avesmapsGaretienSichtFuer({ ziel: "path", subtyp: "Flussweg", is_bach: true });
assert.strictEqual(sichtBach.token, "--color-path-bach");
assert.ok(sichtBach.breite < api.avesmapsGaretienSichtFuer({ ziel: "path", subtyp: "Flussweg" }).breite);

// 2. Der Name erscheint NUR im Zoomband.
const imBand = api.garetienVorschauLabel({ name: "Alke", einstellungen: { showName: true, minZoom: 3, maxZoom: 5, size: 14 } }, 4);
assert.ok(imBand, "im Band wird gezeichnet");
assert.strictEqual(api.garetienVorschauLabel({ name: "Alke", einstellungen: { showName: true, minZoom: 3, maxZoom: 5 } }, 6), null);

// 3. Ohne „Name anzeigen" gar nicht.
assert.strictEqual(api.garetienVorschauLabel({ name: "Alke", einstellungen: { showName: false, minZoom: 0, maxZoom: 7 } }, 4), null);

// 4. 💣 EIN OBJEKT OHNE VORSCHLAG BEKOMMT KEINE VORSCHAU -- es hat keine Zielform, also keine
//    Größe und kein Band. Eine erfundene Größe wäre eine Behauptung.
assert.strictEqual(api.garetienVorschauLabel({ name: "Blutmoor", einstellungen: null }, 4), null);

// 5. Der `zoomend`-Zuhörer hängt GENAU EINMAL -- ein zweiter Aufruf von KarteZeigen hängt keinen
//    zweiten an, sonst zeichnete die Karte nach zehn Listenläufen zehnmal.
const karte = fakeKarte();
api.avesmapsGaretienKarteZeigen([], karte);
api.avesmapsGaretienKarteZeigen([], karte);
assert.strictEqual(karte.zuhoerer("zoomend").length, 1);
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren** — der Stempel `garetienEinstellungenStempeln` über die GANZE
  Stage-Menge (wie `garetienEndkreuzungStempeln`), der Zeichner liest ihn; das Namensbild entsteht
  über `renderMapLabelToImage` mit `getMapLabelTypeStyle(art)`, Rückfall ein `<span>`.
- [ ] **Schritt 4: Grün laufen lassen**
- [ ] **Schritt 5: Mutationsprobe** — (1) Bandprüfung entfernen → Test 2 rot; (2) Zuhörer je
  Aufruf → Test 5 rot; (3) Vorschau ohne Einstellungen → Test 4 rot
- [ ] **Schritt 6: Browser** — Zoomen, Zoomband im Kasten ändern, Bach umstellen; HELL und DUNKEL
- [ ] **Schritt 7: Commit**

Betreff: `feat(garetien-importer): die Stage zeigt Name, Groesse und Bach schon auf der Karte`

---

## Aufgabe 15: Stadtviertel, fünf Ortsarten, Reichsstadt

**Dateien:**
- Ändern: `api/_internal/import/garetien-abgleich.php` (`AVESMAPS_GARETIEN_TYP_MAP`,
  `AVESMAPS_GARETIEN_OHNE_GEGENSTUECK`)
- Ändern: `api/_internal/wiki/place-kinds.php`
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`place_kind` vorbelegen)
- Test: `api/_internal/import/__tests__/garetien-ortsarten-test.php` (neu)

- [ ] **Schritt 1: Test schreiben**

```php
// 1. Stadtviertel wird zugeordnet statt uebersprungen (Owner 27.08.2026: „fuehre sie als
//    kategorie ein"; im Abgleich war der Entscheid nie angekommen, 22 Zeilen fielen heraus).
assert(!in_array('Stadtviertel', AVESMAPS_GARETIEN_OHNE_GEGENSTUECK, true));
$z = avesmapsGaretienMappeTyp('Stadtviertel');
assert($z['ziel'] === 'location' && $z['subtyp'] === 'stadtviertel');

// 2. Reichsstadt und Koenigsstadt sind `stadt`, nicht `grossstadt` (Owner 06.09.2026):
//    Reichsunmittelbarkeit ist ein Rechtsstatus, keine Groesse.
assert(avesmapsGaretienMappeTyp('Reichsstadt')['subtyp'] === 'stadt');
assert(avesmapsGaretienMappeTyp('Koenigsstadt')['subtyp'] === 'stadt');

// 3. Die fuenf Ortsarten stehen im Katalog -- ein getippter Wert wurde bis heute STILL verworfen.
foreach (['Burg', 'Gasthaus', 'Pfalz', 'Magierturm', 'Stadtviertel'] as $art) {
    assert(avesmapsNormalizePlaceKind($art) === $art, $art . ' fehlt im Katalog');
}

// 4. Die Ortsart wird aus dem QUELLTYP vorbelegt -- beim Kartenimport ging sie bisher verloren
//    (nur der Innerorts-Zweig uebernahm sie).
assert(avesmapsGaretienOrtsartAusTyp('Tempel') === 'Tempel');
assert(avesmapsGaretienOrtsartAusTyp('Burg') === 'Burg');
// ⚠️ Ein Typ, den der Katalog nicht kennt, ergibt LEER -- nie einen geratenen Wert.
assert(avesmapsGaretienOrtsartAusTyp('Dorf') === '');
assert(avesmapsGaretienOrtsartAusTyp('') === '');

// 5. Und die Handeingabe schlaegt die Vorbelegung.
$raus = avesmapsGaretienOrtUebersteuerung(['place_kind' => 'Kloster']);
assert($raus['place_kind'] === 'Kloster');
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren**
- [ ] **Schritt 4: Grün laufen lassen** — dazu `garetien-abgleich-test.php` und die
  WikiSync-Tests, die den Ortsarten-Katalog lesen
- [ ] **Schritt 5: Mutationsprobe** — (1) `avesmapsGaretienOrtsartAusTyp` rät bei unbekanntem Typ
  → Test 4 rot; (2) Reichsstadt zurück auf `grossstadt` → Test 2 rot
- [ ] **Schritt 6: Commit**

Betreff: `feat(garetien-import): Stadtviertel, fuenf Ortsarten -- und eine Reichsstadt ist eine Stadt`

---

## Aufgabe 16: Die Punktregel

**Dateien:**
- Ändern: `api/_internal/import/garetien-abgleich.php`
  (`avesmapsGaretienTrefferSchwelle`, `avesmapsGaretienPunktTrefferGilt`, `avesmapsGaretienKandidaten`)
- Test: `api/_internal/import/__tests__/garetien-punktregel-test.php` (neu)

**Owner-Entscheid 06.09.2026:** gleicher Name deckt sich bis 2,0 Einheiten (6 Meilen), anderer
Name nur bei 0,0 Einheiten (dieselbe Koordinate).

- [ ] **Schritt 1: Test schreiben**

```php
// 1. GLEICHER NAME bis 2,0 Einheiten = deckt sich. 🔴 Grund: die Koordinatentransformation hat
//    einen Restfehler von Median 1,24 / p90 3,5 Meilen (Entwurf §2.1) -- bei der alten Schwelle
//    von 0,3 Einheiten (0,9 Meilen) fiel mehr als die Haelfte der ECHTEN Paare heraus und kam als
//    „neu" zurueck, vorangehakt. Das ist die Dublette, die der Import am wenigsten machen darf.
$urteil = pruefePunkt(abstand: 1.9, gleicherName: true);
assert($urteil['status'] === 'deckt_sich');

// 2. Knapp darueber ist es „neu" -- die Schwelle ist scharf.
assert(pruefePunkt(abstand: 2.1, gleicherName: true)['status'] === 'neu');

// 3. ANDERER NAME: nur bei 0,0. 💣 Das ist woertlich der Owner-Entscheid („anderer name 0
//    meilen") und hat eine gemessene Folge: das 10. Perzentil des Nachbarabstands ist 0,000 --
//    Burg und Dorf teilen sich regelmaessig die Koordinate. Genau diese Paare gelten weiter als
//    Treffer, und das ist gewollt.
assert(pruefePunkt(abstand: 0.0, gleicherName: false)['status'] === 'deckt_sich');
assert(pruefePunkt(abstand: 0.1, gleicherName: false)['status'] === 'neu');

// 4. Der Grund nennt den Nachbarn weiter beim Namen -- sonst stuende „neu" ohne Anhalt da.
$u = pruefePunkt(abstand: 0.3, gleicherName: false);
assert(str_contains($u['grund'], 'Meilen von'));
assert(str_contains($u['grund'], 'anderer Name'));

// 5. LINIEN und FLAECHEN sind unberuehrt (Paket 2): 2,0 wie bisher, unabhaengig vom Namen.
assert(avesmapsGaretienTrefferSchwelle(['ziel' => 'path'], true) === 2.0);
assert(avesmapsGaretienTrefferSchwelle(['ziel' => 'path'], false) === 2.0);

// 6. 💣 DER SUCHRAUM MUSS 2,0 ABDECKEN. Die Kandidatensuche zog fuer Punkte bisher einen engen
//    Kasten; bliebe er eng, faende der Abgleich den gleichnamigen Nachbarn bei 1,9 gar nicht
//    erst, und Zusicherung 1 waere gruen, ohne je einen Treffer geprueft zu haben.
assert(avesmapsGaretienKandidatenRadius(['ziel' => 'location']) >= 2.0);
```

- [ ] **Schritt 2: Rot laufen lassen**
- [ ] **Schritt 3: Implementieren**

```php
/**
 * Die Trefferschwelle EINES Ziels -- seit dem 06.09.2026 mit dem Namensbefund.
 *
 * 🔴 ZWEI RADIEN BEI PUNKTEN (Owner-Entscheid 06.09.2026):
 *   gleicher Name -> 2,0 Einheiten (6 Meilen). Die Koordinatentransformation traegt einen
 *     Restfehler von Median 1,24 und p90 3,5 Meilen; die alte Schwelle von 0,3 (0,9 Meilen) warf
 *     deshalb mehr als die Haelfte der ECHTEN Paare als „neu" zurueck -- vorangehakt, also als
 *     Dublette in die Karte.
 *   anderer Name -> 0,0. Nur dieselbe Koordinate zaehlt. Woertlich der Owner („anderer name 0
 *     meilen"), und die Folge ist gemessen: das 10. Perzentil des Nachbarabstands ist 0,000, Burg
 *     und Dorf teilen sich also regelmaessig den Punkt -- diese Paare gelten weiter als Treffer.
 *
 * ⚠️ LINIEN UND FLAECHEN sind unberuehrt. Ihre 2,0 ist am Gewaessernetz geeicht; ob sie fuer das
 * dichtere Wegenetz taugt, ist eine offene Messung (Entwurf §12, Paket 2) und keine Aenderung,
 * die man nebenbei mitnimmt.
 */
function avesmapsGaretienTrefferSchwelle(array $ziel, bool $gleicherName = false): float
{
    if (!in_array($ziel['ziel'] ?? '', ['location', 'label'], true)) {
        return AVESMAPS_GARETIEN_TREFFER_EINHEITEN;
    }

    return $gleicherName
        ? AVESMAPS_GARETIEN_TREFFER_EINHEITEN
        : AVESMAPS_GARETIEN_TREFFER_EINHEITEN_PUNKT_FREMD;
}
```

💣 **Die Reihenfolge in `avesmapsGaretienFindeBestand` dreht sich damit um:** heute wird die
Schwelle VOR dem Namensvergleich geprüft. Künftig muss der Name zuerst feststehen — also den
`$gleicherName`-Aufruf vor die Schwellenprüfung ziehen und `avesmapsGaretienPunktTrefferGilt`
entfernen (die Schwelle sagt es jetzt selbst).

- [ ] **Schritt 4: Grün laufen lassen** — dazu `garetien-abgleich-test.php`,
  `garetien-naehe-test.php`, `garetien-innerorts-test.php`
- [ ] **Schritt 5: Mutationsprobe** — (1) `0.0` → `0.3` → Test 3b rot; (2) Namensvergleich wieder
  nach der Schwelle → Test 1 rot; (3) Suchraum eng lassen → Test 6 rot
- [ ] **Schritt 6: Commit**

Betreff: `fix(garetien-import): ein gleichnamiger Ort deckt sich bis 6 Meilen -- ein fremder nur auf dem Punkt`

---

## Abschluss

- [ ] **Die Abnahmeliste des Entwurfs (§11) Zeile für Zeile abhaken** — erfüllt oder ausdrücklich
  verworfen mit Grund. Der eigene Entwurf IST die Abnahmeliste (AGENTS.md §9).
- [ ] **Der Ablauf mit angemeldeter Sitzung**, von Hand, an EINEM Objekt: Lauf holen · Zeile
  öffnen · als Bach einstellen · auf die Stage · auf der Karte den Namen und die Bach-Signatur
  sehen · Stage importieren · Statuszeile lesen · auf der Karte nachsehen, ob die Quelle mit
  Lizenz dransteht. **Das ist der einzige Schritt mit Rechtsfolge.**
- [ ] **Gedächtnis nachziehen:** `garetien-import-projekt.md` bekommt einen Abschnitt „live",
  `MEMORY.md` seine Zeile.
- [ ] **Paket 2 bleibt offen** (Entwurf §12) und wird NICHT nebenbei mitgenommen.

## Selbstprüfung dieses Plans

**Spec-Abdeckung.** §0 Entscheide 1–7 → Aufgaben 6/8/9/10 (1), 10 (2), 16 (3), keine (4, bewusst
nichts zu tun), 15 (5), Reihenfolge des Plans (6), 12 (7). §2 Begriffe → 8. §3 Zonen → 1, 12.
§4 Liste → 8, 9. §5 Einzelansicht → 7, 10, 13. §6 Karte → 14. §7 Import → 11. §8 Statuszeile →
1, 3. §9 Server → 2, 4, 5, 7, 15, 16. §10 Tests → in jeder Aufgabe. §11 Abnahmeliste → Abschluss.
§12 Paket 2 → ausdrücklich ausgenommen.

**Ohne Aufgabe geblieben und begründet:** das Abschnittshäkchen als Client-Zustand (§2, letzter
Absatz) wandert in Aufgabe 10 mit den Formen — es ist die Auswahl der Form „Nur Quelle + Artikel"
und hat dort seinen Ort.

**Namen gegengelesen:** `zustand.stage`, `zustand.auswahl`, `garetienStatusSetzen`,
`garetienStageNachschlagen`, `garetienStageEinstellungenJeItem`,
`avesmapsGaretienEinstellungenJeItemAusRumpf`, `angelegt_je_form`, `keys`,
`AVESMAPS_GARETIEN_ART_BACH` — jeder wird in genau der Aufgabe erzeugt, in der er zuerst
vorkommt, und danach unverändert benutzt.
