# Refactoring-Routine v2 — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die tägliche Routine `avesmaps-refactoring` bekommt ein Arbeitspaket-Rückgrat im Repo, ihre vier gelernten Vorprüfungen als Skript mit Tests, drei Rollen-Agenten vor jedem Commit, einen Perf-Riegel und einen Überwachungsmodus — und ihre Anweisung (`SKILL.md`) trägt ab jetzt die Lehren selbst.

**Architecture:** Alles Prüfende ist ein lesendes Node-Skript unter `tools/refactoring/` (ESM, ohne Abhängigkeiten), gefahren von drei Nutzern: der Analyse jetzt, der Routine täglich, den Agenten beim Prüfen. Die Pakete liegen als Markdown im Repo (`docs/refactoring-arbeitspakete.md`), jedes an SHA und Blob-Hash seiner Zieldatei gebunden; ein Parser-Modul liest sie für den Wächter-Test und den Frischelauf. Die Anweisung der Routine lebt außerhalb des Repos (`~/.claude/scheduled-tasks/avesmaps-refactoring/SKILL.md`) und ruft die Skripte.

**Tech Stack:** Node ≥ 18 (ESM-Skripte `.mjs`, CJS-Tests `.test.js` mit `assert`, Ausführung `node <datei>`), git, `gh`. Kein npm-Paket.

**Spec:** `docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`

## Global Constraints

- **Sprache:** Code-Kommentare, Tests, Doku, Commit-Betreff auf Deutsch (AGENTS.md §8). Kopfkommentar einer Geschwisterdatei folgt der Sprache der Zieldatei.
- **Tests am Deploy-Tor:** nur unter `js`/`tools` (`__tests__/*.test.js` oder `tools/**/test-*.mjs`); ein Test unter `docs/` läuft nie. Perf-Messskripte heißen deshalb nie `test-*.mjs`.
- **Geteilter Baum:** `git status` zuerst, nur eigene Pfade stagen, `git add` und `git commit` in EINEM Zug; nie `git add -A`/`.`/`-a`; kein `git stash drop`.
- **Deploy-Riegel vor jedem Push:** `gh run list --workflow=deploy-avesmaps-strato.yml --limit 3` — ein `in_progress` UND ein `queued`/`pending` heißen warten.
- **Push:** `git push origin master`; bei Reject `git fetch` + `git reset --hard origin/master` + `git cherry-pick <eigener commit>`; kein `rebase --autostash`, kein force-push; Remote-SHA prüfen.
- **Volles Testfeld vor jedem Push** mit dem Muster des Workflows (äußere Klammer!) und selbstprüfender Zählung:
  ```
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 > js0
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 > php0
  find js tools \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) | wc -l   # muss == tr -dc '\0' < js0 | wc -c
  xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' < js0 > rot-js
  xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' < php0 > rot-php
  ```
  Vorbestehend rot: nur `linkcheck/link-url-test.php`.
- **Live-Server:** nie in Schleifen anfragen; je Datei/Endpunkt EINE Anfrage.
- **Werkzeugfallen, die jedes Skript hier respektiert:** kein `\b` in RegExp (Wort-Token per `split(/[^A-Za-z0-9_$]+/)`), jede Datei einzeln lesen (NUL-Bytes in `powerline-topology.js`), Deklarationsmuster `^(async\s+)?function\s+`, Kommentare nie per `sed 's://.*::'` strippen.
- **Commit-Trailer:**
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF
  ```

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `tools/refactoring/vorpruefung.mjs` | Die vier Vorprüfungen + Prüfung 0 als Modul und CLI. Reine Funktionen über Text; Dateisystem nur in `finde*`-Funktionen und im Orchestrator. |
| `tools/refactoring/__tests__/vorpruefung.test.js` | Vier historische Fixtures (in Temp-Verzeichnissen gebaut) + Mutationsproben. |
| `tools/refactoring/arbeitspakete.mjs` | Parser des Rückgrats (`docs/refactoring-arbeitspakete.md`) → Paketobjekte; Sperrzeile. |
| `tools/refactoring/__tests__/arbeitspakete.test.js` | Wächter-Test: Form jedes Pakets, gültige Zustände, `erledigt` hat seine Geschwisterdatei. Läuft gegen das ECHTE Dokument. |
| `tools/refactoring/frischelauf.mjs` | Blob-Vergleich je offenem Paket gegen `origin/master`; Ausgabe: gilt / überholt (mit Grund). |
| `tools/refactoring/__tests__/frischelauf.test.js` | Vergleichslogik mit eingespritztem Blob-Leser. |
| `tools/refactoring/rangliste.mjs` | Rangwert = Zeilen × Commits (180 Tage), Alter, globale Funktionen, IIFE-Kennung. |
| `tools/refactoring/doppelungen.mjs` | Normalisierte Funktionsrümpfe über Dateien hinweg; Kandidatenpaare. |
| `tools/refactoring/__tests__/doppelungen.test.js` | Normalisierung und Paarbildung. |
| `tools/refactoring/perf-gerueche.mjs` | Abfragen in Schleifen, DDL auf Lesepfaden, DOM-Abfragen in Schleifen. |
| `tools/refactoring/__tests__/perf-gerueche.test.js` | Je Geruch ein Treffer und ein Nicht-Treffer. |
| `docs/refactoring-arbeitspakete.md` | Das Rückgrat: Kopf (Sperrzeile-Regel, Zustände), dann Pakete. |
| `.claude/agents/refactoring-widerleger.md` | Der Prüfagent mit drei Rollen (Widerleger · Testbindung · Behauptung) + Historiker. |
| `~/.claude/scheduled-tasks/avesmaps-refactoring/SKILL.md` | Anweisung v2 (außerhalb des Repos). |
| `~/.claude/scheduled-tasks/avesmaps-refactoring/state.md`, `liste.md` | `zeilen_ueber_1000`; Lehren raus, nur Negatives bleibt. |

---

### Task 1: Vorprüfung — Funktionen finden, Rümpfe ausblenden, Zustand und Ladezeit-Bezug (Prüfung 0 + 1)

**Files:**
- Create: `tools/refactoring/vorpruefung.mjs`
- Test: `tools/refactoring/__tests__/vorpruefung.test.js`

**Interfaces:**
- Produces (alle `export`):
  - `findeFunktionen(text, sprache)` → `[{ name, von, bis, start, ende, async }]` — `sprache` ∈ `"js" | "php"`; `von`/`bis` 1-basierte Zeilen der Deklaration und der schließenden Klammer; `start`/`ende` Zeichenoffsets (`ende` exklusiv, hinter der `}`).
  - `blendeRuempfeAus(text, funktionen)` → String gleicher Länge, in dem jede Funktion (vom `function`-Wort bis `}`) durch Leerzeichen ersetzt ist, Zeilenumbrüche bleiben.
  - `wortTokens(text)` → `Set<string>` (Token per `split(/[^A-Za-z0-9_$]+/)`).
  - `pruefeZustand(oberste)` → `[{ zeile, text }]` — Zeilen auf oberster Ebene mit Zustand oder Ladezeit-Code.
  - `pruefeLadezeit(oberste, namen)` → `Map<name, zeile[]>` — Blocknamen, die auf oberster Ebene als Wort-Token vorkommen.

- [ ] **Step 1: Test schreiben (Fixture „Dump-Bericht“ vom 01.09.2026)**

```js
// tools/refactoring/__tests__/vorpruefung.test.js
// Die Vorpruefung der Refactoring-Routine -- vier historische Fixtures.
//
// 💣 Der Anlass: vier Laeufe der Routine (01.-04.09.2026) haben vier Lehren gelernt, und alle vier
// standen nur als Prosa in liste.md. Jede Fixture hier baut den Fall nach, an dem eine Lehre
// entstanden ist, und jede traegt eine Mutationsprobe: Bindung weg -> Befund weg; Bindung
// woanders -> Befund da. Ein Pruefer, der nur gruen kann, ist keiner.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/vorpruefung.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const MODUL = pathToFileURL(path.join(__dirname, "..", "vorpruefung.mjs")).href;

function tempRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vorpruefung-"));
	return {
		dir,
		schreibe(rel, text) {
			const p = path.join(dir, rel);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, text, "utf8");
			return p;
		},
	};
}

// -- A: Dump-Bericht (01.09.2026) -- ein Ladezeit-Export auf einen Blocknamen -------------
const DUMP = [
	"// Kopf",
	"let avesmapsDumpReportStylesInjected = false;",
	"function avesmapsOpenDumpReport(runId) {",
	"\tif (!avesmapsDumpReportStylesInjected) { injectStyles(); }",
	"\treturn renderDumpReport({ runId });",
	"}",
	"function renderDumpReport(opts) {",
	"\tconst re = /\\{[^}]*\\}/g; // Regex mit Klammern -- darf die Klammerzaehlung nicht kippen",
	"\treturn String(opts.runId).replace(re, \"}\");",
	"}",
	"function injectStyles() { avesmapsDumpReportStylesInjected = true; }",
	"window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;",
	"",
].join("\n");

(async () => {
	const v = await import(MODUL);

	// A1: drei Funktionen, richtige Zeilen -- trotz Regex mit Klammern und String mit "}"
	const fns = v.findeFunktionen(DUMP, "js");
	assert.deepStrictEqual(fns.map((f) => [f.name, f.von, f.bis]),
		[["avesmapsOpenDumpReport", 3, 6], ["renderDumpReport", 7, 10], ["injectStyles", 11, 11]]);

	// A2: oberste Ebene = Kopf + let + window-Export; Ruempfe sind Leerzeichen, Zeilenzahl gleich
	const oben = v.blendeRuempfeAus(DUMP, fns);
	assert.strictEqual(oben.split("\n").length, DUMP.split("\n").length);
	assert.ok(!oben.includes("renderDumpReport({ runId })"), "Rumpf muss ausgeblendet sein");

	// A3: Pruefung 0 -- Zustand und Ladezeit-Code auf oberster Ebene, mit Zeilen
	const zustand = v.pruefeZustand(oben);
	assert.deepStrictEqual(zustand.map((z) => z.zeile), [2, 12]);

	// A4: Pruefung 1 -- avesmapsOpenDumpReport ist per window-Export gebunden, die anderen nicht
	const lade = v.pruefeLadezeit(oben, fns.map((f) => f.name));
	assert.deepStrictEqual([...lade.keys()], ["avesmapsOpenDumpReport"]);
	assert.deepStrictEqual(lade.get("avesmapsOpenDumpReport"), [12]);

	// A5: Mutationsprobe -- Export weg -> kein Ladezeit-Befund; Export auf injectStyles -> dort
	const ohne = DUMP.replace("window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;", "");
	assert.strictEqual(v.pruefeLadezeit(v.blendeRuempfeAus(ohne, v.findeFunktionen(ohne, "js")),
		fns.map((f) => f.name)).size, 0);
	const anders = DUMP.replace("window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;",
		"window.injectStyles = injectStyles;");
	assert.deepStrictEqual([...v.pruefeLadezeit(v.blendeRuempfeAus(anders,
		v.findeFunktionen(anders, "js")), fns.map((f) => f.name)).keys()], ["injectStyles"]);

	// A6: async function wird gefunden (Falle vom 02.09.2026)
	const mitAsync = "async function ladeX() {\n\treturn 1;\n}\nfunction y() {}\n";
	assert.deepStrictEqual(v.findeFunktionen(mitAsync, "js").map((f) => f.name), ["ladeX", "y"]);

	console.log("vorpruefung A: ok");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `node tools/refactoring/__tests__/vorpruefung.test.js`
Expected: FAIL mit `Cannot find module` / `ERR_MODULE_NOT_FOUND` für `vorpruefung.mjs`.

- [ ] **Step 3: Modul schreiben — Scanner, Funktionen, Ausblenden, Prüfung 0 und 1**

```js
// tools/refactoring/vorpruefung.mjs
// Die Vorpruefung der Refactoring-Routine: darf dieser Lauf globaler Funktionen in eine
// Geschwisterdatei ziehen, ohne dass sich etwas aendert?
//
// Vier Pruefungen, jede an einem Lauf der Routine gelernt (Entwurf §5):
//   1 Ladezeit-Bezug      (Dump-Bericht, 01.09.2026)
//   2 Dateiregister       (loadLoreList, 02.09.2026)
//   3 Quelltext-Tests     (route-plan.js, 03.09.2026)
//   4 vm-Bindung, transitiv (review-path-sync.js, 04.09.2026)
// dazu Pruefung 0: kein Zustand, kein Ladezeit-Code im Block.
//
// 💣 Werkzeugfallen, die hier festgeschrieben sind: kein `\b` in RegExp (Wort-Token per split),
// jede Datei einzeln lesen (NUL-Bytes), `^(async\s+)?function\s+` als Deklarationsmuster,
// Kommentare werden NICHT gestrippt (sed 's://.*::' frisst https://).
//
// Aufruf: node tools/refactoring/vorpruefung.mjs <datei> [--wurzel <repo>] [--von <name> --bis <name>] [--min 150]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// -- Scanner: geht ueber den Text und liefert je Zeichen, ob es Code ist (nicht String, nicht Kommentar).
// Regex-Literale werden heuristisch erkannt: ein `/` nach ( , = : [ ! & | ? { } ; oder `return`.
export function codeMaske(text, sprache) {
	const n = text.length;
	const maske = new Uint8Array(n); // 1 = Code
	let i = 0;
	const vorher = (pos) => {
		let j = pos - 1;
		while (j >= 0 && /\s/.test(text[j])) j--;
		if (j < 0) return "";
		const wort = text.slice(Math.max(0, j - 5), j + 1);
		return /return$/.test(wort) ? "return" : text[j];
	};
	while (i < n) {
		const c = text[i];
		const c2 = text[i + 1];
		if (c === "/" && c2 === "/") { while (i < n && text[i] !== "\n") i++; continue; }
		if (sprache === "php" && c === "#") { while (i < n && text[i] !== "\n") i++; continue; }
		if (c === "/" && c2 === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
		if (c === "\"" || c === "'" || (sprache === "js" && c === "`")) {
			const q = c; i++;
			while (i < n && text[i] !== q) { if (text[i] === "\\") i++; i++; }
			i++; continue;
		}
		if (sprache === "js" && c === "/" && /[(,=:\[!&|?{};]|return|^$/.test(vorher(i))) {
			i++; let klasse = false;
			while (i < n && (klasse || text[i] !== "/") && text[i] !== "\n") {
				if (text[i] === "\\") i++;
				else if (text[i] === "[") klasse = true;
				else if (text[i] === "]") klasse = false;
				i++;
			}
			i++; continue;
		}
		maske[i] = 1; i++;
	}
	return maske;
}

const DEKLARATION = /^[ \t]*(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;

// Globale Funktionsdeklarationen in Spalte 0 (mit Einrueckung im Inline-Script eines HTML) samt Rumpf.
export function findeFunktionen(text, sprache) {
	const maske = codeMaske(text, sprache);
	const ergebnis = [];
	for (const m of text.matchAll(DEKLARATION)) {
		const start = m.index + m[0].search(/\S/);
		if (!maske[start]) continue; // steht in einem Kommentar oder String
		let i = m.index + m[0].length;
		while (i < text.length && text[i] !== "{") i++; // Parameterliste ueberspringen
		let tiefe = 0; let ende = -1;
		for (; i < text.length; i++) {
			if (!maske[i]) continue;
			if (text[i] === "{") tiefe++;
			else if (text[i] === "}") { tiefe--; if (tiefe === 0) { ende = i + 1; break; } }
		}
		if (ende < 0) continue;
		const zeile = (pos) => text.slice(0, pos).split("\n").length;
		ergebnis.push({ name: m[2], async: Boolean(m[1]), start, ende, von: zeile(start), bis: zeile(ende - 1) });
	}
	return ergebnis;
}

// Ruempfe (und Koepfe) durch Leerzeichen ersetzen -- Zeilen bleiben, damit Zeilenangaben stimmen.
export function blendeRuempfeAus(text, funktionen) {
	const teile = text.split("");
	for (const f of funktionen) {
		for (let i = f.start; i < f.ende; i++) if (teile[i] !== "\n") teile[i] = " ";
	}
	return teile.join("");
}

export function wortTokens(text) {
	return new Set(text.split(/[^A-Za-z0-9_$]+/).filter(Boolean));
}

// Kommentare aus einem Text der obersten Ebene entfernen (nur fuer die Zustandspruefung; sonst nie).
function ohneKommentare(text, sprache) {
	const maske = codeMaske(text, sprache);
	return text.split("").map((c, i) => (maske[i] || c === "\n" || /["'`]/.test(c) ? c : (/\s/.test(c) ? c : " "))).join("");
}

const ZUSTAND = /^\s*(var|let|const|window\.|document\.|\$\(|\(\s*function|\(\s*\(|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\b|[A-Za-z_$][\w$.\[\]"']*\s*\(|[A-Za-z_$][\w$.\[\]"']*\s*=[^=])/;

// Pruefung 0: Zeilen auf oberster Ebene, die Zustand halten oder beim Laden etwas tun.
export function pruefeZustand(oberste, sprache = "js") {
	const zeilen = ohneKommentare(oberste, sprache).split("\n");
	const funde = [];
	zeilen.forEach((z, idx) => {
		if (!z.trim()) return;
		if (/^\s*(["'`]use strict["'`];?|\}|\);?|\]);?)\s*$/.test(z)) return;
		if (ZUSTAND.test(z)) funde.push({ zeile: idx + 1, text: z.trim() });
	});
	return funde;
}

// Pruefung 1: welche Blocknamen kommen auf oberster Ebene als Wort vor (window.x = f, f(), [f, g] ...)?
export function pruefeLadezeit(oberste, namen, sprache = "js") {
	const treffer = new Map();
	const zeilen = ohneKommentare(oberste, sprache).split("\n");
	zeilen.forEach((z, idx) => {
		const tokens = wortTokens(z);
		for (const name of namen) {
			if (tokens.has(name)) {
				if (!treffer.has(name)) treffer.set(name, []);
				treffer.get(name).push(idx + 1);
			}
		}
	});
	return treffer;
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `node tools/refactoring/__tests__/vorpruefung.test.js`
Expected: `vorpruefung A: ok`

⚠️ Fällt A1 an der Regex-Zeile (Zeile 8 der Fixture), ist die `vorher()`-Heuristik zu eng: die Zuweisung `const re = /…/` endet auf `=`, das steht in der Liste. Fällt A3 mit Zeile 8 oder 9 zusätzlich, blendet `blendeRuempfeAus` nicht ab `f.start` aus — dann `start` prüfen (er zeigt auf das `function`/`async`-Wort, nicht auf den Zeilenanfang).

- [ ] **Step 5: Commit**

```bash
git status --porcelain -- tools/refactoring
git add tools/refactoring/vorpruefung.mjs tools/refactoring/__tests__/vorpruefung.test.js && git commit -m "tool(refactoring): Vorpruefung -- Funktionen finden, Ruempfe ausblenden, Zustand und Ladezeit-Bezug (Pruefung 0+1)

Erste Haelfte des Skripts aus dem Entwurf 2026-09-05 §5. Fixture A baut den
Dump-Bericht-Fall vom 01.09.2026 nach (window-Export auf einen Blocknamen) samt
Mutationsprobe.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---

### Task 2: Vorprüfung — Dateiregister und quelltext-lesende Tests (Prüfung 2 + 3)

**Files:**
- Modify: `tools/refactoring/vorpruefung.mjs` (anhängen)
- Test: `tools/refactoring/__tests__/vorpruefung.test.js` (Abschnitte B, C anhängen, vor `console.log`)

**Interfaces:**
- Consumes: `wortTokens` aus Task 1.
- Produces:
  - `findeRegister(zielpfad, wurzel)` → `[{ datei, zeile }]` — Dateien unter `<wurzel>/js` und `<wurzel>/tools` (`.js`/`.mjs`), die den Zielpfad **in Anführungszeichen** enthalten (`"js/review/x.js"` oder `'…'`).
  - `findeQuelltextTests(zielpfad, wurzel)` → `[{ datei, namen: string[] }]` — Tests (`*.test.js`, `test-*.mjs`), die den Basisnamen der Zieldatei nennen UND Funktionen beim Namen herausschneiden. Erkannte Muster: `extract…(quelle, "NAME"`, `extract…("NAME"`, `indexOf("function NAME"` (auch `'async function NAME'`), Regex-Literal `/function\s+NAME\b/` bzw. `/function NAME\(/`.
  - `alleDateien(wurzel, unterordner, endungen)` → `string[]` (relative Pfade, jede Datei einzeln lesbar; überspringt `third-party`).

- [ ] **Step 1: Tests B und C anhängen**

```js
	// -- B: Dateiregister (02.09.2026) -- ein Test fuehrt eine Dateiliste von Hand ----------------
	{
		const r = tempRepo();
		r.schreibe("js/review/review-wiki-sync.js", "function loadLoreList() {}\nfunction b() {}\n");
		r.schreibe("tools/paths/test-wiki-sync-panel-tab.mjs",
			'const searched = ["js/review/review-wiki-sync.js", "js/review/review-wiki-sync-cases.js"]\n' +
			'\t.map((file) => readFileSync(path.join(repoRoot, file), "utf8")).join("\\n");\n');
		r.schreibe("js/ui/egal.js", "// erwaehnt js/review/review-wiki-sync.js nur im Kommentar, ohne Anfuehrungszeichen\n");
		const reg = v.findeRegister("js/review/review-wiki-sync.js", r.dir);
		assert.deepStrictEqual(reg, [{ datei: "tools/paths/test-wiki-sync-panel-tab.mjs", zeile: 1 }]);
		// Mutationsprobe: Register auf eine andere Datei -> kein Treffer
		r.schreibe("tools/paths/test-wiki-sync-panel-tab.mjs", 'const searched = ["js/review/review-settlement-list.js"];\n');
		assert.deepStrictEqual(v.findeRegister("js/review/review-wiki-sync.js", r.dir), []);
	}

	// -- C: Quelltext-lesende Tests (03.09.2026) -- extractFunction(quelle, "name") -------------
	{
		const r = tempRepo();
		r.schreibe("js/routing/route-plan.js", "function isRoutePlanMarkerName() {}\nfunction routeAirLegsNote() {}\nfunction fitRoute() {}\n");
		r.schreibe("js/routing/__tests__/air-distance.test.js",
			'const planSource = fs.readFileSync(path.join(ROOT, "js", "routing", "route-plan.js"), "utf8");\n' +
			'const a = extractFunction(planSource, "routeAirLegsNote", "route-plan.js");\n' +
			'const i = planSource.indexOf("function isRoutePlanMarkerName");\n' +
			'const m = planSource.match(/function\\s+fitRoute\\b/);\n');
		r.schreibe("js/routing/__tests__/anderes.test.js", 'extractFunction(src, "fitRoute"); // liest NICHT route-plan.js\n');
		const qt = v.findeQuelltextTests("js/routing/route-plan.js", r.dir);
		assert.strictEqual(qt.length, 1);
		assert.strictEqual(qt[0].datei, "js/routing/__tests__/air-distance.test.js");
		assert.deepStrictEqual([...qt[0].namen].sort(), ["fitRoute", "isRoutePlanMarkerName", "routeAirLegsNote"]);
		// Mutationsprobe: der Test schneidet nichts mehr heraus -> keine Namen, kein Eintrag
		r.schreibe("js/routing/__tests__/air-distance.test.js",
			'const planSource = fs.readFileSync(path.join(ROOT, "js", "routing", "route-plan.js"), "utf8");\nassert.ok(planSource.length > 0);\n');
		assert.deepStrictEqual(v.findeQuelltextTests("js/routing/route-plan.js", r.dir), []);
	}
	console.log("vorpruefung B, C: ok");
```

- [ ] **Step 2: Laufen lassen — muss fehlschlagen** (`v.findeRegister is not a function`)

- [ ] **Step 3: Funktionen anhängen**

```js
// -- Dateisystem: jede Datei einzeln lesen (kein grep-Strom -- NUL-Bytes in powerline-topology.js).
export function alleDateien(wurzel, unterordner, endungen) {
	const aus = [];
	const gehe = (dir) => {
		let eintraege = [];
		try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of eintraege) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { if (e.name !== "third-party" && e.name !== "node_modules") gehe(p); }
			else if (endungen.some((x) => e.name.endsWith(x))) aus.push(path.relative(wurzel, p).split(path.sep).join("/"));
		}
	};
	for (const u of unterordner) gehe(path.join(wurzel, u));
	return aus.sort();
}

function lies(wurzel, rel) { return fs.readFileSync(path.join(wurzel, rel), "utf8"); }

// Pruefung 2: handgepflegte Dateiregister -- der Zielpfad steht in Anfuehrungszeichen in js/ oder tools/.
export function findeRegister(zielpfad, wurzel) {
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (rel === zielpfad) continue;
		const zeilen = lies(wurzel, rel).split("\n");
		zeilen.forEach((z, idx) => {
			if (z.includes(`"${zielpfad}"`) || z.includes(`'${zielpfad}'`)) funde.push({ datei: rel, zeile: idx + 1 });
		});
	}
	return funde;
}

const IST_TEST = (rel) => /__tests__\/[^/]+\.test\.js$/.test(rel) || /(^|\/)test-[^/]+\.mjs$/.test(rel);

// Pruefung 3: Tests, die die Zieldatei als Text lesen und Funktionen beim Namen herausschneiden.
export function findeQuelltextTests(zielpfad, wurzel) {
	const basis = path.posix.basename(zielpfad);
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (!IST_TEST(rel)) continue;
		const text = lies(wurzel, rel);
		if (!text.includes(basis)) continue;
		const namen = new Set();
		for (const m of text.matchAll(/extract\w*\(\s*[^,()]*,\s*["']([A-Za-z_$][\w$]*)["']/g)) namen.add(m[1]);
		for (const m of text.matchAll(/extract\w*\(\s*["']([A-Za-z_$][\w$]*)["']/g)) namen.add(m[1]);
		for (const m of text.matchAll(/indexOf\(\s*["'](?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) namen.add(m[1]);
		for (const m of text.matchAll(/\/function(?:\\s\+|\s+)([A-Za-z_$][\w$]*)(?:\\b|\\\(|\()/g)) namen.add(m[1]);
		if (namen.size) funde.push({ datei: rel, namen: [...namen] });
	}
	return funde;
}
```

- [ ] **Step 4: Laufen lassen — muss bestehen** (`vorpruefung A: ok`, `vorpruefung B, C: ok`)

- [ ] **Step 5: Commit**

```bash
git add tools/refactoring/vorpruefung.mjs tools/refactoring/__tests__/vorpruefung.test.js && git commit -m "tool(refactoring): Vorpruefung -- Dateiregister und quelltext-lesende Tests (Pruefung 2+3)

Fixture B baut das Register aus tools/paths/test-wiki-sync-panel-tab.mjs nach
(loadLoreList, 02.09.2026), Fixture C den extractFunction-Fall aus route-plan.js
(03.09.2026). Jede mit Mutationsprobe.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---

### Task 3: Vorprüfung — vm-Testbindung, transitiv (Prüfung 4)

**Files:**
- Modify: `tools/refactoring/vorpruefung.mjs` (anhängen)
- Test: `tools/refactoring/__tests__/vorpruefung.test.js` (Abschnitt D anhängen)

**Interfaces:**
- Consumes: `findeFunktionen`, `wortTokens`, `alleDateien`, `IST_TEST`.
- Produces:
  - `findeVmTests(zielpfad, wurzel, funktionsnamen)` → `[{ datei, genannt: string[] }]` — Tests, die `vm.runInContext`/`runInNewContext`/`vm.Script` benutzen UND den Basisnamen der Zieldatei nennen; `genannt` = Funktionsnamen der Zieldatei, die im Test als Wort-Token vorkommen (konservativ: genannt = gerufen).
  - `aufrufgraph(text, funktionen)` → `Map<name, Set<name>>` — je Funktion die Blocknamen, die in ihrem Rumpf als Wort-Token stehen.
  - `fixpunkt(startnamen, graph)` → `Set<name>` — transitiver Abschluss.

- [ ] **Step 1: Test D anhängen**

```js
	// -- D: vm-Bindung, transitiv (04.09.2026) -- der Test ruft eine, gebunden sind drei --------
	{
		const r = tempRepo();
		r.schreibe("js/review/review-path-sync.js", [
			"function loadVerlaufCases() { return renderVerlaufCaseList(findVerlaufCase(1)); }",
			"function renderVerlaufCaseList(list) { return verlaufOpenCleanTotal(list); }",
			"function findVerlaufCase(id) { return id; }",
			"function verlaufOpenCleanTotal(l) { return l; }",
			"function handlePathWikiAssignmentPick() { return 21; }",
			"",
		].join("\n"));
		r.schreibe("js/review/__tests__/ausreisser-loesen.test.js",
			'const quelle = fs.readFileSync(path.join(ROOT, "js", "review", "review-path-sync.js"), "utf8");\n' +
			"vm.createContext(sandbox);\n" +
			'vm.runInContext(quelle, sandbox, { filename: "review-path-sync.js" });\n' +
			"sandbox.loadVerlaufCases();\n");
		const text = fs.readFileSync(path.join(r.dir, "js/review/review-path-sync.js"), "utf8");
		const fns = v.findeFunktionen(text, "js");
		const namen = fns.map((f) => f.name);
		const vm = v.findeVmTests("js/review/review-path-sync.js", r.dir, namen);
		assert.deepStrictEqual(vm, [{ datei: "js/review/__tests__/ausreisser-loesen.test.js", genannt: ["loadVerlaufCases"] }]);
		const graph = v.aufrufgraph(text, fns);
		assert.deepStrictEqual([...graph.get("loadVerlaufCases")].sort(), ["findVerlaufCase", "renderVerlaufCaseList"]);
		const gebunden = v.fixpunkt(["loadVerlaufCases"], graph);
		assert.deepStrictEqual([...gebunden].sort(),
			["findVerlaufCase", "loadVerlaufCases", "renderVerlaufCaseList", "verlaufOpenCleanTotal"]);
		assert.ok(!gebunden.has("handlePathWikiAssignmentPick"), "frei bleibt genau eine");
		// Mutationsprobe 1: der Test laedt die Datei nicht mehr per vm -> keine Bindung
		r.schreibe("js/review/__tests__/ausreisser-loesen.test.js", 'require("../review-path-sync.js"); loadVerlaufCases();\n');
		assert.deepStrictEqual(v.findeVmTests("js/review/review-path-sync.js", r.dir, namen), []);
		// Mutationsprobe 2: eine Kante weniger im Graphen -> der Abschluss schrumpft
		const graph2 = new Map(graph); graph2.set("renderVerlaufCaseList", new Set());
		assert.ok(!v.fixpunkt(["loadVerlaufCases"], graph2).has("verlaufOpenCleanTotal"));
	}
	console.log("vorpruefung D: ok");
```

- [ ] **Step 2: Laufen lassen — muss fehlschlagen** (`v.findeVmTests is not a function`)

- [ ] **Step 3: Funktionen anhängen**

```js
// Pruefung 4a: Tests, die die Zieldatei ALLEIN in einen vm-Kontext laden -- ein Aufruf in eine
// Geschwisterdatei ist dort ein ReferenceError. Genannt gilt als gerufen (konservativ).
export function findeVmTests(zielpfad, wurzel, funktionsnamen) {
	const basis = path.posix.basename(zielpfad);
	const funde = [];
	for (const rel of alleDateien(wurzel, ["js", "tools"], [".js", ".mjs"])) {
		if (!IST_TEST(rel)) continue;
		const text = lies(wurzel, rel);
		if (!text.includes(basis)) continue;
		if (!/runInContext|runInNewContext|runInThisContext|vm\.Script|new Script\(/.test(text)) continue;
		const tokens = wortTokens(text);
		const genannt = funktionsnamen.filter((n) => tokens.has(n));
		funde.push({ datei: rel, genannt });
	}
	return funde;
}

// Pruefung 4b: Aufrufgraph innerhalb der Datei -- welche Blocknamen stehen im Rumpf welcher Funktion?
export function aufrufgraph(text, funktionen) {
	const namen = new Set(funktionen.map((f) => f.name));
	const graph = new Map();
	for (const f of funktionen) {
		const rumpf = text.slice(f.start, f.ende);
		const tokens = wortTokens(rumpf);
		const ziele = new Set();
		for (const n of namen) if (n !== f.name && tokens.has(n)) ziele.add(n);
		graph.set(f.name, ziele);
	}
	return graph;
}

// Pruefung 4c: transitiver Abschluss -- alles, was ein gebundener Name ruft, ist gebunden.
export function fixpunkt(startnamen, graph) {
	const aus = new Set(startnamen);
	const stapel = [...startnamen];
	while (stapel.length) {
		const n = stapel.pop();
		for (const z of graph.get(n) || []) if (!aus.has(z)) { aus.add(z); stapel.push(z); }
	}
	return aus;
}
```

- [ ] **Step 4: Laufen lassen — muss bestehen** (A, B/C, D: ok)

- [ ] **Step 5: Commit**

```bash
git add tools/refactoring/vorpruefung.mjs tools/refactoring/__tests__/vorpruefung.test.js && git commit -m "tool(refactoring): Vorpruefung -- vm-Testbindung, transitiv (Pruefung 4)

Fixture D baut review-path-sync.js vom 04.09.2026 nach: der Test ruft EINE
Funktion, gebunden sind vier, frei bleibt eine. Der Fixpunkt ueber den
Aufrufgraphen ist die Lehre; zwei Mutationsproben.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---
### Task 4: Vorprüfung — PHP-Konstanten, HTML-Inline-Script, freie Blöcke, Orchestrator und CLI

**Files:**
- Modify: `tools/refactoring/vorpruefung.mjs` (anhängen)
- Test: `tools/refactoring/__tests__/vorpruefung.test.js` (Abschnitte E, F anhängen)

**Interfaces:**
- Consumes: alles aus Task 1–3.
- Produces:
  - `konstantenImBlock(text, funktionen, von, bis)` (PHP) → `[{ name, definiertVor: boolean, zeile|null }]` — Großbuchstaben-Bezeichner (`[A-Z][A-Z0-9_]{3,}`) in den Rümpfen des Blocks, gegen `define('NAME'` / `const NAME` VOR `funktionen[von].start` geprüft. Bezeichner, die weder definiert noch in der Datei vorkommen (PHP-Kernkonstanten wie `PHP_EOL`, `JSON_THROW_ON_ERROR`), werden **weggelassen**.
  - `inlineScript(html)` → `{ text, zeilenVersatz }` — der **größte** `<script>`-Block ohne `src`; `zeilenVersatz` = Zeilennummer der `<script>`-Zeile (damit `von`/`bis` auf die HTML-Datei zeigen).
  - `freieBloecke(text, funktionen, gebunden, minZeilen)` → `[{ von, bis, namen, zeilen }]` — zusammenhängende Läufe ungebundener Funktionen, zwischen denen auf oberster Ebene nichts als Leerraum/Kommentar steht; nur Läufe ≥ `minZeilen`.
  - `vorpruefung({ datei, wurzel, von, bis, min })` → JSON-Objekt (Form unten).
  - CLI: `node tools/refactoring/vorpruefung.mjs <datei> [--wurzel .] [--von N --bis M] [--min 150]` → JSON auf stdout, Exit 0; Exit 2 bei unbekannter Endung.

**JSON-Form (Vertrag für Routine und Agenten):**
```json
{
  "datei": "js/review/review-path-sync.js", "sprache": "js", "blob": "<git hash-object>",
  "funktionen": [{ "name": "loadVerlaufCases", "von": 12, "bis": 40, "gebunden": ["vm: js/review/__tests__/ausreisser-loesen.test.js"] }],
  "zustand": [{ "zeile": 3, "text": "let x = 1;" }],
  "register": [{ "datei": "tools/paths/test-wiki-sync-panel-tab.mjs", "zeile": 115 }],
  "quelltextTests": [{ "datei": "...", "namen": ["..."] }],
  "vmTests": [{ "datei": "...", "genannt": ["..."] }],
  "konstanten": [{ "name": "AVESMAPS_X", "definiertVor": true, "zeile": 40 }],
  "freieBloecke": [{ "von": 300, "bis": 520, "namen": ["a", "b"], "zeilen": 221 }],
  "block": { "von": "a", "bis": "b", "frei": true, "gruende": [] },
  "nichtGesehen": ["Closures in IIFE-Modulen", "dynamisch zusammengesetzte Namen (window[\"avesmaps\" + x])", "Aufrufe aus .php-Seiten, die JS inline erzeugen"]
}
```
`gebunden`-Gründe: `"ladezeit: Z. 12"`, `"quelltext: <test>"`, `"vm: <test>"`, `"vm-transitiv: über <name>"`, `"konstante: <NAME> nicht vor der Blockstelle"`. `nichtGesehen` steht **immer** drin (Entwurf §5, „als Satz, nicht als Schweigen“).

- [ ] **Step 1: Tests E (PHP) und F (HTML + Blöcke + CLI) anhängen**

```js
	// -- E: PHP -- Konstanten muessen VOR der require_once-Stelle definiert sein (citymaps.php, 04.09.) --
	{
		const php = [
			"<?php",
			"declare(strict_types=1);",
			"const AVESMAPS_CITYMAP_WIKI_API = 'x';",
			"define('AVESMAPS_CITYMAP_LIMIT', 5);",
			"function a(): int { return AVESMAPS_CITYMAP_LIMIT + strlen(AVESMAPS_CITYMAP_WIKI_API) + JSON_THROW_ON_ERROR; }",
			"function b(): string { return AVESMAPS_SPAETER; }",
			"const AVESMAPS_SPAETER = 'zu spaet';",
			"function c(): int { return 1; }",
			"",
		].join("\n");
		const fns = v.findeFunktionen(php, "php");
		assert.deepStrictEqual(fns.map((f) => f.name), ["a", "b", "c"]);
		const k = v.konstantenImBlock(php, fns, 0, 1); // Block a..b
		assert.deepStrictEqual(k.map((x) => [x.name, x.definiertVor]).sort(),
			[["AVESMAPS_CITYMAP_LIMIT", true], ["AVESMAPS_CITYMAP_WIKI_API", true], ["AVESMAPS_SPAETER", false]]);
		// JSON_THROW_ON_ERROR (Kernkonstante, nirgends definiert) darf NICHT auftauchen
		assert.ok(!k.some((x) => x.name === "JSON_THROW_ON_ERROR"));
	}

	// -- F: HTML-Inline-Script, freie Bloecke, Orchestrator, CLI ---------------------------------
	{
		const r = tempRepo();
		const html = [
			"<!doctype html>",
			"<script src=\"/js/ui/x.js\"></script>",
			"<script>",
			"function eins() { return 1; }",
			"function zwei() { return eins(); }",
			"",
			"let zustandDazwischen = 0;",
			"function drei() { return 3; }",
			"function vier() { return 4; }",
			"window.vier = vier;",
			"</script>",
			"",
		].join("\n");
		r.schreibe("html/seite.html", html);
		const inl = v.inlineScript(html);
		assert.strictEqual(inl.zeilenVersatz, 3);
		const erg = v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, min: 1 });
		assert.strictEqual(erg.sprache, "js");
		assert.deepStrictEqual(erg.funktionen.map((f) => [f.name, f.von]), [["eins", 4], ["zwei", 5], ["drei", 8], ["vier", 9]]);
		assert.deepStrictEqual(erg.funktionen.find((f) => f.name === "vier").gebunden, ["ladezeit: Z. 10"]);
		// eins+zwei ein Block; drei allein (dazwischen Zustand); vier gebunden
		assert.deepStrictEqual(erg.freieBloecke.map((b) => b.namen), [["eins", "zwei"], ["drei"]]);
		assert.ok(Array.isArray(erg.nichtGesehen) && erg.nichtGesehen.length >= 3);
		// Blockvorschlag: eins..drei ist NICHT frei (Zustand dazwischen), eins..zwei ist frei
		assert.strictEqual(v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, von: "eins", bis: "drei" }).block.frei, false);
		assert.strictEqual(v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, von: "eins", bis: "zwei" }).block.frei, true);
		// CLI
		const { execFileSync } = require("child_process");
		const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "..", "vorpruefung.mjs"),
			"html/seite.html", "--wurzel", r.dir, "--min", "1"], { encoding: "utf8" }));
		assert.strictEqual(out.datei, "html/seite.html");
		assert.strictEqual(typeof out.blob, "string");
	}
	console.log("vorpruefung E, F: ok");
```

- [ ] **Step 2: Laufen lassen — muss fehlschlagen** (`v.konstantenImBlock is not a function`)

- [ ] **Step 3: Funktionen und CLI anhängen**

```js
// -- PHP: Konstanten, die der Block liest, muessen VOR der Blockstelle definiert sein (Entwurf §3 C).
export function konstantenImBlock(text, funktionen, von, bis) {
	const start = funktionen[von].start;
	const rumpf = funktionen.slice(von, bis + 1).map((f) => text.slice(f.start, f.ende)).join("\n");
	const namen = new Set([...rumpf.matchAll(/(?<![\w$])([A-Z][A-Z0-9_]{3,})(?![\w$])/g)].map((m) => m[1]));
	const aus = [];
	for (const name of namen) {
		const def = new RegExp("(define\\(\\s*['\"]" + name + "['\"]|const\\s+" + name + "\\s*=)", "g");
		let zeile = null; let definiertVor = false; let irgendwo = false;
		for (const m of text.matchAll(def)) {
			irgendwo = true;
			if (m.index < start) { definiertVor = true; zeile = text.slice(0, m.index).split("\n").length; break; }
		}
		if (!irgendwo) continue; // Kernkonstante (PHP_EOL, JSON_*) -- keine Aussage
		aus.push({ name, definiertVor, zeile });
	}
	return aus;
}

// -- HTML: der groesste Inline-<script>-Block; Zeilenversatz auf die HTML-Datei.
export function inlineScript(html) {
	let best = null;
	for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
		if (!best || m[1].length > best.text.length) {
			best = { text: m[1], zeilenVersatz: html.slice(0, m.index).split("\n").length };
		}
	}
	return best || { text: "", zeilenVersatz: 0 };
}

// -- Freie Bloecke: Laeufe ungebundener Funktionen ohne Zustand/Code dazwischen.
export function freieBloecke(text, funktionen, gebunden, minZeilen, sprache = "js") {
	const aus = [];
	let lauf = [];
	const schliesse = () => {
		if (lauf.length) {
			const zeilen = lauf[lauf.length - 1].bis - lauf[0].von + 1;
			if (zeilen >= minZeilen) aus.push({ von: lauf[0].von, bis: lauf[lauf.length - 1].bis, namen: lauf.map((f) => f.name), zeilen });
		}
		lauf = [];
	};
	funktionen.forEach((f, i) => {
		if (gebunden.has(f.name)) { schliesse(); return; }
		if (lauf.length) {
			const zwischen = text.slice(lauf[lauf.length - 1].ende, f.start);
			if (/\S/.test(ohneKommentare(zwischen, sprache))) schliesse();
		}
		lauf.push(f);
	});
	schliesse();
	return aus;
}

function gitBlob(wurzel, rel) {
	try {
		const { execFileSync } = require_child();
		return execFileSync("git", ["-C", wurzel, "hash-object", rel], { encoding: "utf8" }).trim();
	} catch { return null; }
}
function require_child() { return { execFileSync: (...a) => childProcess.execFileSync(...a) }; }
import childProcess from "node:child_process";

const NICHT_GESEHEN = [
	"Closures in IIFE-Modulen (der Scan sieht nur globale Deklarationen)",
	"dynamisch zusammengesetzte Namen (window[\"avesmaps\" + x], new Function)",
	"Aufrufe aus .php-Seiten, die JS inline erzeugen (edit/*.php)",
	"CSS-Klassen und data-Attribute, die ein Block per String erzeugt",
];

// -- Der Orchestrator: eine Datei, alle Pruefungen, ein JSON.
export function vorpruefung({ datei, wurzel = ".", von = null, bis = null, min = 150 }) {
	const endung = path.posix.extname(datei);
	const roh = lies(wurzel, datei);
	let sprache; let text; let versatz = 0;
	if (endung === ".php") { sprache = "php"; text = roh; }
	else if (endung === ".js" || endung === ".mjs") { sprache = "js"; text = roh; }
	else if (endung === ".html") { sprache = "js"; const inl = inlineScript(roh); text = inl.text; versatz = inl.zeilenVersatz; }
	else throw new Error("unbekannte Endung: " + endung);

	const fns = findeFunktionen(text, sprache).map((f) => ({ ...f, von: f.von + versatz, bis: f.bis + versatz }));
	const namen = fns.map((f) => f.name);
	const oberste = blendeRuempfeAus(text, fns);
	const zustand = pruefeZustand(oberste, sprache).map((z) => ({ zeile: z.zeile + versatz, text: z.text }));
	const gruende = new Map(namen.map((n) => [n, []]));
	const merke = (n, g) => { if (gruende.has(n)) gruende.get(n).push(g); };

	const lade = pruefeLadezeit(oberste, namen, sprache);
	for (const [n, zeilen] of lade) merke(n, "ladezeit: Z. " + zeilen.map((z) => z + versatz).join(", "));

	const register = findeRegister(datei, wurzel);
	const quelltextTests = findeQuelltextTests(datei, wurzel);
	for (const t of quelltextTests) for (const n of t.namen) merke(n, "quelltext: " + t.datei);

	let vmTests = [];
	if (sprache === "js") {
		vmTests = findeVmTests(datei, wurzel, namen);
		const graph = aufrufgraph(text, fns);
		const start = new Set([...vmTests.flatMap((t) => t.genannt), ...lade.keys()]);
		for (const t of vmTests) for (const n of t.genannt) merke(n, "vm: " + t.datei);
		for (const n of fixpunkt([...start], graph)) if (!start.has(n)) merke(n, "vm-transitiv: über " + [...start].find((s) => fixpunkt([s], graph).has(n)));
	}

	let konstanten = [];
	if (sprache === "php" && fns.length) {
		const i0 = von ? Math.max(0, namen.indexOf(von)) : 0;
		const i1 = bis ? Math.max(i0, namen.indexOf(bis)) : fns.length - 1;
		konstanten = konstantenImBlock(text, fns, i0, i1);
		for (const k of konstanten) if (!k.definiertVor) for (const f of fns.slice(i0, i1 + 1)) merke(f.name, "konstante: " + k.name + " nicht vor der Blockstelle");
	}

	const gebunden = new Set([...gruende].filter(([, g]) => g.length).map(([n]) => n));
	const bloecke = freieBloecke(text, fns.map((f) => ({ ...f, von: f.von, bis: f.bis })), gebunden, min, sprache);

	let block = null;
	if (von && bis) {
		const i0 = namen.indexOf(von); const i1 = namen.indexOf(bis);
		const bg = [];
		if (i0 < 0 || i1 < 0 || i1 < i0) bg.push("Blockgrenzen nicht gefunden oder verkehrt");
		else {
			for (const f of fns.slice(i0, i1 + 1)) for (const g of gruende.get(f.name)) bg.push(f.name + " — " + g);
			const dazwischen = ohneKommentare(text.slice(fns[i0].start, fns[i1].ende), sprache);
			const nurRuempfe = blendeRuempfeAus(dazwischen, findeFunktionen(dazwischen, sprache));
			if (/\S/.test(nurRuempfe)) bg.push("Zustand oder Ladezeit-Code zwischen den Funktionen des Blocks");
		}
		block = { von, bis, frei: bg.length === 0, gruende: bg };
	}

	return {
		datei, sprache, blob: gitBlob(wurzel, datei),
		funktionen: fns.map((f) => ({ name: f.name, von: f.von, bis: f.bis, gebunden: gruende.get(f.name) })),
		zustand, register, quelltextTests, vmTests, konstanten, freieBloecke: bloecke, block, nichtGesehen: NICHT_GESEHEN,
	};
}

// -- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
	const datei = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
	try {
		const erg = vorpruefung({ datei, wurzel: opt("--wurzel", "."), von: opt("--von", null), bis: opt("--bis", null), min: Number(opt("--min", 150)) });
		process.stdout.write(JSON.stringify(erg, null, 2) + "\n");
	} catch (e) { process.stderr.write(String(e.message) + "\n"); process.exit(2); }
}
```

⚠️ Beim Anhängen: `import childProcess from "node:child_process";` gehört **an den Dateikopf** zu den anderen Imports, und `gitBlob` ruft direkt `childProcess.execFileSync` — der Umweg `require_child` oben ist nur Platzhalter der Skizze und wird NICHT übernommen. Die Fixture F nutzt `git hash-object` in einem Temp-Verzeichnis ohne Repo: `git -C <dir> hash-object <datei>` funktioniert auch außerhalb eines Repos (es hasht nur), deshalb ist `blob` dort ein String.

- [ ] **Step 4: Laufen lassen — muss bestehen** (A … F: ok)

- [ ] **Step 5: Gegenprobe an den vier ECHTEN Dateien (keine Zusicherung, eine Messung)**

```
node tools/refactoring/vorpruefung.mjs js/review/review-path-sync.js | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.funktionen.length, "fn,", j.funktionen.filter(f=>f.gebunden.length).length, "gebunden,", j.freieBloecke.length, "freie Bloecke")'
node tools/refactoring/vorpruefung.mjs js/routing/route-plan.js | node -e '…dasselbe…'
node tools/refactoring/vorpruefung.mjs api/_internal/app/citymaps.php | node -e '…dasselbe…'
node tools/refactoring/vorpruefung.mjs html/wiki-sync-settlement-editor.html | node -e '…dasselbe…'
```
Erwartung (Stand 04.09.2026, `liste.md`): `review-path-sync.js` **51 von 52 gebunden** (weicht die Zahl stark ab, ist der Fixpunkt oder `findeVmTests` zu eng/weit — erst das Skript prüfen, dann die Datei). `route-plan.js`: die fünf Namen `isRoutePlanMarkerName`, `routeAirLegsNote`, `routeAirNoteMarkup`, `buildRouteLegPopupHtml`, `routeLegTypeLabel` tragen `quelltext:`. `citymaps.php`: `avesmapsCitymapPickWikiImages` u. a. frei. Settlement-Editor: > 100 Funktionen, `zeilenVersatz` 865.

- [ ] **Step 6: Commit**

```bash
git add tools/refactoring/vorpruefung.mjs tools/refactoring/__tests__/vorpruefung.test.js && git commit -m "tool(refactoring): Vorpruefung -- PHP-Konstanten, HTML-Inline-Script, freie Bloecke, CLI

Das Skript ist vollstaendig (Entwurf §5): JSON je Datei mit Bindungsgruenden je
Funktion, freien Bloecken ab 150 Zeilen und der Liste dessen, was es NICHT sieht.
Gegenprobe an den vier historischen Dateien im Commit-Text: <Zahlen eintragen>.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---

### Task 5: Das Rückgrat — Parser, Dokument-Skelett, Wächter-Test

**Files:**
- Create: `tools/refactoring/arbeitspakete.mjs`
- Create: `docs/refactoring-arbeitspakete.md`
- Test: `tools/refactoring/__tests__/arbeitspakete.test.js`

**Interfaces:**
- Produces:
  - `parseArbeitspakete(markdown)` → `{ sperre: null | { datum, grund }, pakete: Paket[] }` mit `Paket = { id, datei, verfahren, status, statusRoh, stand, blob, block, ziel, verlauf: string[], zeile }`.
  - `STATUS = ["offen", "GO nötig", "in Arbeit", "erledigt", "verworfen"]`; `status` ist der normalisierte Kopf (`"erledigt (1d163b75b)"` → `"erledigt"`), `statusRoh` die ganze Zeile.
  - `ladeArbeitspakete(wurzel)` → dasselbe, gelesen aus `<wurzel>/docs/refactoring-arbeitspakete.md`.

**Dokument-Skelett** (`docs/refactoring-arbeitspakete.md`, wird in Task 8 gefüllt):

```markdown
# Refactoring-Arbeitspakete

**Was das ist:** das Rückgrat der Routine `avesmaps-refactoring` (Entwurf
`docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`). Jedes Paket ist eine
**Momentaufnahme** gegen `Stand`/`Blob`; die Routine prüft es bei jedem Lauf gegen `origin/master`
nach und zieht nach oder verwirft. Zeilennummern sind Orientierung, die Identität eines Blocks sind
seine Funktionsnamen.

**Zustände:** `offen` · `GO nötig` · `in Arbeit (<datum>)` · `erledigt (<sha>)` · `verworfen (<grund>)`.
Nur der Owner setzt `GO nötig` → `offen`. Nur die Routine setzt die übrigen drei.

**Sperre:** steht unter dieser Zeile `Sperre: <datum> <grund>`, analysiert die Routine nur und pusht nichts.

<!-- Sperre: -->

**Verfahren:** A JS-Schnitt · B Inline-Script einer Editorseite · C PHP-Lib per require_once · D Perf-Umbau (Messbeleg, erste drei mit GO).

**Perf-Probe:** `perf_probe: offen` — der Owner setzt `bestanden`, wenn drei Perf-Pakete mit GO ohne Zwischenfall durch sind.

---

## Pakete

(werden von der Analyse und vom Überwachungsmodus gefüllt)
```

- [ ] **Step 1: Test schreiben**

```js
// tools/refactoring/__tests__/arbeitspakete.test.js
// Der Waechter des Rueckgrats: das Dokument darf nicht zur Luege werden.
// 💣 Liegt bewusst unter tools/, nicht unter docs/ -- das Deploy-Tor faehrt nur js und tools.
// Ausfuehren: node tools/refactoring/__tests__/arbeitspakete.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const ROOT = path.join(__dirname, "..", "..", "..");

const BEISPIEL = `# Refactoring-Arbeitspakete

<!-- Sperre: -->

## Pakete

### P-001 · js/review/review-wiki-sync.js · Verfahren A
- Status: offen
- Stand: 70beda3bf · Blob: 0a4d6b2601234567890abcdef1234567890abcde
- Block: „Lore-Liste“ — loadLoreList … renderLoreDetail (6 Funktionen, ~220 Zeilen ab Z. 3169)
- Ziel: js/review/review-wiki-sync-lore-list.js
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 (nachziehen) · Quelltext-Tests 0 · vm-Bindung 0
- Fallen: keine bekannt
- Verlauf: 05.09. angelegt (Analyse)

### P-002 · api/_internal/app/citymaps.php · Verfahren C
- Status: erledigt (1d163b75b)
- Stand: 266cde7ae · Blob: 1234567890abcdef1234567890abcdef12345678
- Block: „Autoget“ — avesmapsCitymapAutogetResolveUrl … avesmapsCitymapParsePlainPage
- Ziel: api/_internal/app/citymaps-autoget.php
- Verlauf: 04.09. angelegt · 04.09. erledigt (1d163b75b)
`;

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "arbeitspakete.mjs")).href);

	// 1) Parser: zwei Pakete, Felder richtig, Sperre leer
	const p = m.parseArbeitspakete(BEISPIEL);
	assert.strictEqual(p.sperre, null);
	assert.strictEqual(p.pakete.length, 2);
	assert.deepStrictEqual([p.pakete[0].id, p.pakete[0].datei, p.pakete[0].verfahren, p.pakete[0].status, p.pakete[0].stand],
		["P-001", "js/review/review-wiki-sync.js", "A", "offen", "70beda3bf"]);
	assert.strictEqual(p.pakete[1].status, "erledigt");
	assert.strictEqual(p.pakete[1].statusRoh, "erledigt (1d163b75b)");
	assert.strictEqual(p.pakete[0].ziel, "js/review/review-wiki-sync-lore-list.js");

	// 2) Sperre wird gelesen
	const mitSperre = BEISPIEL.replace("<!-- Sperre: -->", "Sperre: 2026-09-05 Deploy-Sturm");
	assert.deepStrictEqual(m.parseArbeitspakete(mitSperre).sperre, { datum: "2026-09-05", grund: "Deploy-Sturm" });

	// 3) Das ECHTE Dokument: jede Form stimmt
	const echt = m.ladeArbeitspakete(ROOT);
	const ids = new Set();
	for (const pk of echt.pakete) {
		assert.ok(/^P-\d{3}$/.test(pk.id), pk.id + ": Kennung");
		assert.ok(!ids.has(pk.id), pk.id + ": doppelt"); ids.add(pk.id);
		assert.ok(m.STATUS.includes(pk.status), pk.id + ": Status '" + pk.statusRoh + "'");
		assert.ok(/^[0-9a-f]{7,40}$/.test(pk.stand), pk.id + ": Stand fehlt");
		assert.ok(/^[0-9a-f]{40}$/.test(pk.blob), pk.id + ": Blob fehlt");
		assert.ok(["A", "B", "C", "D"].includes(pk.verfahren), pk.id + ": Verfahren");
		if (pk.status === "erledigt") {
			assert.ok(/\([0-9a-f]{7,}\)/.test(pk.statusRoh), pk.id + ": erledigt ohne SHA");
			if (pk.verfahren !== "D") assert.ok(fs.existsSync(path.join(ROOT, pk.ziel)), pk.id + ": Geschwisterdatei " + pk.ziel + " fehlt");
		}
		if (pk.verfahren === "D") assert.ok(/tools\/perf\//.test(pk.messskript || ""), pk.id + ": Perf-Paket ohne Messskript");
	}
	console.log("arbeitspakete: ok (" + echt.pakete.length + " Pakete)");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Laufen lassen — muss fehlschlagen** (Modul fehlt)

- [ ] **Step 3: Parser schreiben und Skelett anlegen**

```js
// tools/refactoring/arbeitspakete.mjs
// Parser des Rueckgrats docs/refactoring-arbeitspakete.md -- ein Leser fuer Waechter-Test,
// Frischelauf und Routine. Die Identitaet eines Pakets ist seine Kennung P-NNN; die seiner
// Zieldatei der Blob-Hash (Entwurf §4).

import fs from "node:fs";
import path from "node:path";

export const STATUS = ["offen", "GO nötig", "in Arbeit", "erledigt", "verworfen"];

export function parseArbeitspakete(markdown) {
	const zeilen = markdown.split(/\r?\n/);
	let sperre = null;
	const pakete = [];
	let akt = null;
	zeilen.forEach((z, idx) => {
		const sp = z.match(/^Sperre:\s*(\S+)\s*(.*)$/);
		if (sp) { sperre = { datum: sp[1], grund: sp[2].trim() }; return; }
		const kopf = z.match(/^###\s+(P-\d{3})\s+·\s+(\S+)\s+·\s+Verfahren\s+([A-D])\s*$/);
		if (kopf) { akt = { id: kopf[1], datei: kopf[2], verfahren: kopf[3], status: "", statusRoh: "", stand: "", blob: "", block: "", ziel: "", messskript: "", verlauf: [], zeile: idx + 1 }; pakete.push(akt); return; }
		if (!akt) return;
		const feld = z.match(/^-\s+([A-Za-zÄÖÜäöüß\-]+)(?:\s*\([^)]*\))?:\s*(.*)$/);
		if (!feld) return;
		const [, k, w] = feld;
		if (k === "Status") { akt.statusRoh = w.trim(); akt.status = STATUS.find((s) => w.trim().startsWith(s)) || w.trim(); }
		else if (k === "Stand") { const m = w.match(/^([0-9a-f]+)\s*·\s*Blob:\s*([0-9a-f]+)/); if (m) { akt.stand = m[1]; akt.blob = m[2]; } }
		else if (k === "Block") akt.block = w.trim();
		else if (k === "Ziel") akt.ziel = w.trim().split(/[,\s]/)[0];
		else if (k === "Messskript") akt.messskript = w.trim();
		else if (k === "Verlauf") akt.verlauf = w.split(" · ").map((s) => s.trim());
	});
	return { sperre, pakete };
}

export function ladeArbeitspakete(wurzel) {
	return parseArbeitspakete(fs.readFileSync(path.join(wurzel, "docs", "refactoring-arbeitspakete.md"), "utf8"));
}
```

Dann das Skelett aus dem Interfaces-Block als `docs/refactoring-arbeitspakete.md` anlegen (Inhalt wörtlich von oben).

- [ ] **Step 4: Laufen lassen — muss bestehen** (`arbeitspakete: ok (0 Pakete)`)

- [ ] **Step 5: Commit**

```bash
git add tools/refactoring/arbeitspakete.mjs tools/refactoring/__tests__/arbeitspakete.test.js docs/refactoring-arbeitspakete.md && git commit -m "tool(refactoring): das Rueckgrat -- Parser, Dokument-Skelett und Waechter-Test

docs/refactoring-arbeitspakete.md ist die Paketliste der Routine (Entwurf §2);
der Waechter unter tools/refactoring/__tests__ haelt Form, Zustaende und
Geschwisterdateien fest -- am Deploy-Tor, nicht unter docs/.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---

### Task 6: Der Frischelauf

**Files:**
- Create: `tools/refactoring/frischelauf.mjs`
- Test: `tools/refactoring/__tests__/frischelauf.test.js`

**Interfaces:**
- Consumes: `ladeArbeitspakete`, `STATUS` (Task 5); `vorpruefung` (Task 4).
- Produces:
  - `pruefeFrische(pakete, liesBlob)` → `[{ id, datei, ergebnis: "gilt" | "überholt" | "datei-weg" | "nicht-offen", blobJetzt }]` — `liesBlob(datei)` liefert den Blob-Hash auf `origin/master` oder `null`. Geprüft werden nur `offen`, `GO nötig`, `in Arbeit`.
  - `blobAufOrigin(wurzel, datei)` → `git -C <wurzel> rev-parse origin/master:<datei>` oder `null`.
  - CLI: `node tools/refactoring/frischelauf.mjs [--wurzel .]` → JSON-Liste; für jedes `überholt` zusätzlich die frische `vorpruefung` mit `--von/--bis` aus dem `Block`-Feld (erster und letzter Name vor/nach dem `…`), damit die Routine nachziehen oder verwerfen kann.

- [ ] **Step 1: Test schreiben**

```js
// tools/refactoring/__tests__/frischelauf.test.js
// Ein Paket gilt, weil es HEUTE nachgeprueft wurde (Entwurf §4). Blob gleich -> gilt; anders -> ueberholt.
// Ausfuehren: node tools/refactoring/__tests__/frischelauf.test.js
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "frischelauf.mjs")).href);
	const pakete = [
		{ id: "P-001", datei: "a.js", status: "offen", blob: "aaaa" },
		{ id: "P-002", datei: "b.js", status: "offen", blob: "bbbb" },
		{ id: "P-003", datei: "c.js", status: "GO nötig", blob: "cccc" },
		{ id: "P-004", datei: "d.js", status: "erledigt", blob: "dddd" },
	];
	const blobs = { "a.js": "aaaa", "b.js": "b2b2", "c.js": null };
	const erg = m.pruefeFrische(pakete, (d) => blobs[d] ?? null);
	assert.deepStrictEqual(erg.map((e) => [e.id, e.ergebnis]),
		[["P-001", "gilt"], ["P-002", "überholt"], ["P-003", "datei-weg"], ["P-004", "nicht-offen"]]);
	assert.strictEqual(erg[1].blobJetzt, "b2b2");
	// Blockgrenzen aus dem Block-Feld lesen
	assert.deepStrictEqual(m.blockGrenzen("„Lore-Liste“ — loadLoreList … renderLoreDetail (6 Funktionen, ~220 Zeilen ab Z. 3169)"),
		{ von: "loadLoreList", bis: "renderLoreDetail" });
	assert.strictEqual(m.blockGrenzen("irgendwas ohne Namen"), null);
	console.log("frischelauf: ok");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Laufen lassen — muss fehlschlagen**

- [ ] **Step 3: Modul schreiben**

```js
// tools/refactoring/frischelauf.mjs
// Der Frischelauf der Routine: jedes offene Paket gegen origin/master (Entwurf §4).
// Aufruf: node tools/refactoring/frischelauf.mjs [--wurzel .]
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { ladeArbeitspakete } from "./arbeitspakete.mjs";
import { vorpruefung } from "./vorpruefung.mjs";

const OFFEN = new Set(["offen", "GO nötig", "in Arbeit"]);

export function pruefeFrische(pakete, liesBlob) {
	return pakete.map((p) => {
		if (!OFFEN.has(p.status)) return { id: p.id, datei: p.datei, ergebnis: "nicht-offen", blobJetzt: null };
		const jetzt = liesBlob(p.datei);
		if (jetzt === null) return { id: p.id, datei: p.datei, ergebnis: "datei-weg", blobJetzt: null };
		return { id: p.id, datei: p.datei, ergebnis: jetzt === p.blob ? "gilt" : "überholt", blobJetzt: jetzt };
	});
}

export function blockGrenzen(blockFeld) {
	const m = blockFeld.match(/—\s*([A-Za-z_$][\w$]*)\s*…\s*([A-Za-z_$][\w$]*)/);
	return m ? { von: m[1], bis: m[2] } : null;
}

export function blobAufOrigin(wurzel, datei) {
	try { return childProcess.execFileSync("git", ["-C", wurzel, "rev-parse", "origin/master:" + datei], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
	catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf("--wurzel");
	const wurzel = i >= 0 ? process.argv[i + 1] : ".";
	const { pakete } = ladeArbeitspakete(wurzel);
	const erg = pruefeFrische(pakete, (d) => blobAufOrigin(wurzel, d));
	for (const e of erg) {
		if (e.ergebnis !== "überholt") continue;
		const p = pakete.find((x) => x.id === e.id);
		const g = blockGrenzen(p.block || "");
		try { e.vorpruefung = vorpruefung({ datei: p.datei, wurzel, von: g?.von ?? null, bis: g?.bis ?? null }); }
		catch (err) { e.vorpruefung = { fehler: String(err.message) }; }
	}
	process.stdout.write(JSON.stringify(erg, null, 2) + "\n");
}
```

⚠️ Der CLI-Zweig liest die Datei aus dem **Arbeitsbaum** (`vorpruefung` liest per `fs`), vergleicht aber gegen `origin/master`. Die Routine ruft ihn deshalb **im Wegwerf-Worktree**, der auf `origin/master` steht — dort ist beides dasselbe. Der Kopfkommentar sagt das.

- [ ] **Step 4: Laufen lassen — muss bestehen**; danach die CLI einmal echt: `node tools/refactoring/frischelauf.mjs` → `[]` (noch keine Pakete).

- [ ] **Step 5: Commit**

```bash
git add tools/refactoring/frischelauf.mjs tools/refactoring/__tests__/frischelauf.test.js && git commit -m "tool(refactoring): der Frischelauf -- jedes offene Paket gegen origin/master

Blob gleich -> gilt, anders -> ueberholt (mit frischer Vorpruefung an den
Blocknamen), Datei weg -> datei-weg. Entwurf §4.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

---

### Task 7: Die Analyse-Skripte — Rangliste, Doppelungen, Perf-Gerüche

**Files:**
- Create: `tools/refactoring/rangliste.mjs`, `tools/refactoring/doppelungen.mjs`, `tools/refactoring/perf-gerueche.mjs`
- Test: `tools/refactoring/__tests__/doppelungen.test.js`, `tools/refactoring/__tests__/perf-gerueche.test.js`

**Interfaces:**
- Consumes: `alleDateien`, `findeFunktionen`, `codeMaske` (Task 1/2).
- Produces:
  - `rangliste.mjs` CLI → JSON `[{ datei, zeilen, commits, alterTage, rang, globaleFunktionen, iife }]`, sortiert nach `rang`; Produktivdateien = getrackte `.js .php .css .html` ohne `third-party/`, `__tests__`, `test-*`, `tools/`, `docs/`. Optionen `--tage 180`, `--abgekuehlt 5` (filtert), `--min-zeilen 1000`.
  - `normalisiereRumpf(text)` → String: Kommentare raus, Whitespace auf ein Leerzeichen, jeder Bezeichner (außer JS/PHP-Schlüsselwörtern) auf `$N` in Reihenfolge des ersten Auftretens.
  - `findeDoppelungen(dateien, liesText, minZeilen = 8)` → `[{ a: {datei, name}, b: {datei, name}, gleichheit }]` mit `gleichheit` 1.0 bei identischem normalisierten Rumpf, sonst Jaccard über 3-Gramme der Tokenfolge (nur Paare ≥ 0.9, verschiedene Dateien).
  - `findePerfGerueche(text, sprache)` → `[{ geruch, zeile, text }]` mit `geruch` ∈ `abfrage-in-schleife` (PHP: `->query(`/`->prepare(`/`->execute(` innerhalb eines `foreach|for|while`-Rumpfs), `ddl-in-funktion` (`CREATE TABLE`/`ALTER TABLE`/`SHOW COLUMNS` in einer Funktion, deren Name nicht mit `Ensure`/`ensure` beginnt), `dom-abfrage-in-schleife` (JS: `querySelectorAll(`/`getComputedStyle(` in einer `for|while|forEach`-Schleife), `tiefe-kopie` (`JSON.parse(JSON.stringify(`).

- [ ] **Step 1: Tests schreiben**

```js
// tools/refactoring/__tests__/doppelungen.test.js
// Ausfuehren: node tools/refactoring/__tests__/doppelungen.test.js
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "doppelungen.mjs")).href);
	const a = "function summe(liste) {\n\t// addiert\n\tlet s = 0;\n\tfor (const x of liste) s += x;\n\treturn s;\n}";
	const b = "function total(items) {\n\tlet acc = 0;\n\tfor (const it of items) acc += it;\n\treturn acc;\n}";
	assert.strictEqual(m.normalisiereRumpf(a), m.normalisiereRumpf(b), "umbenannt und kommentiert ist dieselbe Funktion");
	const c = "function anders(l) {\n\tlet s = 1;\n\tfor (const x of l) s *= x;\n\treturn s;\n}";
	assert.notStrictEqual(m.normalisiereRumpf(a), m.normalisiereRumpf(c));
	const texte = { "x.js": a + "\n" + "function klein() { return 1; }\n", "y.js": b + "\n", "z.js": c + "\n" };
	const d = m.findeDoppelungen(Object.keys(texte), (f) => texte[f], 3);
	assert.strictEqual(d.length, 1);
	assert.deepStrictEqual([d[0].a.name, d[0].b.name, d[0].gleichheit], ["summe", "total", 1]);
	// Mutationsprobe: gleiche Datei zaehlt nicht
	assert.strictEqual(m.findeDoppelungen(["x.js"], () => a + "\n" + b + "\n", 3).length, 0);
	console.log("doppelungen: ok");
})().catch((e) => { console.error(e); process.exit(1); });
```

```js
// tools/refactoring/__tests__/perf-gerueche.test.js
// Ausfuehren: node tools/refactoring/__tests__/perf-gerueche.test.js
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
(async () => {
	const m = await import(pathToFileURL(path.join(__dirname, "..", "perf-gerueche.mjs")).href);
	const php = [
		"<?php", "function liesAlle(PDO $pdo, array $ids): array {",
		"\tforeach ($ids as $id) {", "\t\t$st = $pdo->prepare('SELECT 1');", "\t\t$st->execute([$id]);", "\t}",
		"\t$pdo->query('SHOW COLUMNS FROM x');", "\treturn [];", "}",
		"function avesmapsEnsureTabelle(PDO $pdo): void { $pdo->exec('CREATE TABLE IF NOT EXISTS t (id INT)'); }",
		"function einmal(PDO $pdo): void { $pdo->query('SELECT 2'); }", "",
	].join("\n");
	const g = m.findePerfGerueche(php, "php");
	assert.deepStrictEqual(g.map((x) => [x.geruch, x.zeile]).sort(),
		[["abfrage-in-schleife", 4], ["abfrage-in-schleife", 5], ["ddl-in-funktion", 7]]);
	const js = "function f(){\n\tfor (const el of els) { const w = getComputedStyle(el).width; }\n\tconst k = JSON.parse(JSON.stringify(o));\n\tconst einmal = document.querySelectorAll('.x');\n}\n";
	assert.deepStrictEqual(m.findePerfGerueche(js, "js").map((x) => [x.geruch, x.zeile]).sort(),
		[["dom-abfrage-in-schleife", 2], ["tiefe-kopie", 3]]);
	console.log("perf-gerueche: ok");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Laufen lassen — beide müssen fehlschlagen** (Module fehlen)

- [ ] **Step 3: Die drei Skripte schreiben**

`rangliste.mjs` (Port des Python-Laufs vom 05.09.2026):

```js
// tools/refactoring/rangliste.mjs -- Rangwert = Zeilen x Commits (180 Tage), Alter, globale Funktionen.
// Aufruf: node tools/refactoring/rangliste.mjs [--wurzel .] [--tage 180] [--abgekuehlt N] [--min-zeilen N]
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { findeFunktionen } from "./vorpruefung.mjs";

export function rangliste({ wurzel = ".", tage = 180, abgekuehlt = 0, minZeilen = 0, heute = new Date() } = {}) {
	const git = (...a) => childProcess.execFileSync("git", ["-C", wurzel, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
	const log = git("log", `--since=${tage} days ago`, "--date=short", "--pretty=format:@%ad", "--name-only");
	const commits = new Map(); const zuletzt = new Map(); let d = null;
	for (const z of log.split("\n")) {
		if (z.startsWith("@")) { d = z.slice(1); continue; }
		if (!z.trim()) continue;
		commits.set(z, (commits.get(z) || 0) + 1);
		if (!zuletzt.has(z)) zuletzt.set(z, d);
	}
	const aus = [];
	for (const f of git("ls-files").split("\n")) {
		if (!/\.(js|php|css|html)$/.test(f)) continue;
		if (/(^|\/)(third-party|__tests__|tools|docs)\//.test(f) || /(^|\/)test-[^/]*$/.test(f)) continue;
		if (!commits.has(f)) continue;
		let text; try { text = fs.readFileSync(path.join(wurzel, f), "utf8"); } catch { continue; }
		const zeilen = text.split("\n").length;
		const c = commits.get(f);
		const alterTage = Math.floor((heute - new Date(zuletzt.get(f))) / 86400000);
		const sprache = f.endsWith(".php") ? "php" : "js";
		const gf = /\.(js|php|html)$/.test(f) ? findeFunktionen(text, sprache).length : 0;
		const iife = f.endsWith(".js") && gf === 0;
		if (zeilen < minZeilen || alterTage < abgekuehlt) continue;
		aus.push({ datei: f, zeilen, commits: c, alterTage, rang: zeilen * c, globaleFunktionen: gf, iife });
	}
	return aus.sort((a, b) => b.rang - a.rang);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const a = process.argv; const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
	process.stdout.write(JSON.stringify(rangliste({ wurzel: opt("--wurzel", "."), tage: +opt("--tage", 180), abgekuehlt: +opt("--abgekuehlt", 0), minZeilen: +opt("--min-zeilen", 0) }), null, 1) + "\n");
}
```

`doppelungen.mjs`:

```js
// tools/refactoring/doppelungen.mjs -- normalisierte Funktionsruempfe ueber Dateien hinweg.
// Aufruf: node tools/refactoring/doppelungen.mjs [--wurzel .] [--min 8]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findeFunktionen, codeMaske, alleDateien } from "./vorpruefung.mjs";

const SCHLUESSEL = new Set(("function return if else for while do switch case break continue const let var new this true false null undefined typeof instanceof in of try catch finally throw class extends super import export default async await yield delete void foreach as array string int float bool echo isset empty unset static public private protected fn match use namespace declare require include").split(" "));

export function normalisiereRumpf(text, sprache = "js") {
	const maske = codeMaske(text, sprache);
	let code = ""; for (let i = 0; i < text.length; i++) code += maske[i] || /["'`]/.test(text[i]) ? text[i] : (text[i] === "\n" ? "\n" : " ");
	// Rumpf = ab erster { ; Kopf (Name, Parameter) faellt weg
	code = code.slice(code.indexOf("{"));
	const namen = new Map(); let n = 0;
	code = code.replace(/[A-Za-z_$][\w$]*/g, (w) => SCHLUESSEL.has(w) ? w : (namen.has(w) ? namen.get(w) : (namen.set(w, "$" + (n++)), namen.get(w))));
	return code.replace(/\s+/g, " ").trim();
}

function dreiGramme(s) { const t = s.split(" "); const g = new Set(); for (let i = 0; i + 2 < t.length; i++) g.add(t.slice(i, i + 3).join("")); return g; }
function jaccard(a, b) { let s = 0; for (const x of a) if (b.has(x)) s++; return s / (a.size + b.size - s || 1); }

export function findeDoppelungen(dateien, liesText, minZeilen = 8) {
	const eintraege = [];
	for (const datei of dateien) {
		const text = liesText(datei); const sprache = datei.endsWith(".php") ? "php" : "js";
		for (const f of findeFunktionen(text, sprache)) {
			if (f.bis - f.von + 1 < minZeilen) continue;
			const norm = normalisiereRumpf(text.slice(f.start, f.ende), sprache);
			eintraege.push({ datei, name: f.name, norm, gramme: null });
		}
	}
	const aus = [];
	const nachNorm = new Map();
	for (const e of eintraege) { if (!nachNorm.has(e.norm)) nachNorm.set(e.norm, []); nachNorm.get(e.norm).push(e); }
	for (const gruppe of nachNorm.values()) for (let i = 0; i < gruppe.length; i++) for (let j = i + 1; j < gruppe.length; j++)
		if (gruppe[i].datei !== gruppe[j].datei) aus.push({ a: { datei: gruppe[i].datei, name: gruppe[i].name }, b: { datei: gruppe[j].datei, name: gruppe[j].name }, gleichheit: 1 });
	// Naehe ueber 3-Gramme nur fuer Ruempfe aehnlicher Laenge (Aufwand begrenzen)
	for (let i = 0; i < eintraege.length; i++) for (let j = i + 1; j < eintraege.length; j++) {
		const a = eintraege[i], b = eintraege[j];
		if (a.datei === b.datei || a.norm === b.norm) continue;
		if (Math.abs(a.norm.length - b.norm.length) > a.norm.length * 0.15) continue;
		a.gramme ||= dreiGramme(a.norm); b.gramme ||= dreiGramme(b.norm);
		const g = jaccard(a.gramme, b.gramme);
		if (g >= 0.9) aus.push({ a: { datei: a.datei, name: a.name }, b: { datei: b.datei, name: b.name }, gleichheit: Math.round(g * 100) / 100 });
	}
	return aus;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const a = process.argv; const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
	const wurzel = opt("--wurzel", ".");
	const dateien = alleDateien(wurzel, ["js", "api", "html"], [".js", ".php", ".html"]).filter((f) => !/__tests__|(^|\/)test-/.test(f));
	const erg = findeDoppelungen(dateien, (f) => { const t = fs.readFileSync(path.join(wurzel, f), "utf8"); return f.endsWith(".html") ? t : t; }, +opt("--min", 8));
	process.stdout.write(JSON.stringify(erg, null, 1) + "\n");
}
```

⚠️ Bei `.html` läuft `findeFunktionen` über die ganze Datei; das trifft die Inline-Deklarationen (Spalte 0 oder eingerückt) und ist für den Zweck genau richtig — Markup enthält kein `function`.

`perf-gerueche.mjs`:

```js
// tools/refactoring/perf-gerueche.mjs -- vier Gerueche, jeder mit Zeile (Entwurf §9.1).
// Aufruf: node tools/refactoring/perf-gerueche.mjs [--wurzel .]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findeFunktionen, codeMaske, alleDateien } from "./vorpruefung.mjs";

const SCHLEIFE = /\b(foreach|for|while)\s*\(|\.forEach\s*\(/;

// Zeilen, die in einem Schleifenrumpf liegen: Klammertiefe ab der Schleifenzeile verfolgen.
function schleifenZeilen(text, sprache) {
	const maske = codeMaske(text, sprache);
	const zeilen = text.split("\n");
	const drin = new Set();
	let offset = 0; const stapel = []; // Tiefen, bei denen eine Schleife begann
	let tiefe = 0;
	zeilen.forEach((z, idx) => {
		if (SCHLEIFE.test(z)) stapel.push(tiefe);
		for (let i = 0; i < z.length; i++) {
			if (!maske[offset + i]) continue;
			if (z[i] === "{") tiefe++;
			else if (z[i] === "}") { tiefe--; while (stapel.length && tiefe <= stapel[stapel.length - 1]) stapel.pop(); }
		}
		if (stapel.length && !SCHLEIFE.test(z)) drin.add(idx + 1);
		offset += z.length + 1;
	});
	return drin;
}

export function findePerfGerueche(text, sprache) {
	const aus = [];
	const zeilen = text.split("\n");
	const drin = schleifenZeilen(text, sprache);
	const fns = findeFunktionen(text, sprache);
	zeilen.forEach((z, idx) => {
		const nr = idx + 1;
		if (sprache === "php" && drin.has(nr) && /->(query|prepare|execute|exec)\s*\(/.test(z)) aus.push({ geruch: "abfrage-in-schleife", zeile: nr, text: z.trim() });
		if (sprache === "php" && /CREATE TABLE|ALTER TABLE|SHOW COLUMNS|SHOW INDEX/i.test(z)) {
			const f = fns.find((x) => nr >= x.von && nr <= x.bis);
			if (f && !/ensure/i.test(f.name)) aus.push({ geruch: "ddl-in-funktion", zeile: nr, text: z.trim() });
		}
		if (sprache === "js" && drin.has(nr) && /querySelectorAll\s*\(|getComputedStyle\s*\(/.test(z)) aus.push({ geruch: "dom-abfrage-in-schleife", zeile: nr, text: z.trim() });
		if (sprache === "js" && /JSON\.parse\(\s*JSON\.stringify\(/.test(z)) aus.push({ geruch: "tiefe-kopie", zeile: nr, text: z.trim() });
	});
	return aus;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf("--wurzel"); const wurzel = i >= 0 ? process.argv[i + 1] : ".";
	const aus = [];
	for (const f of alleDateien(wurzel, ["js", "api"], [".js", ".php"]).filter((f) => !/__tests__|(^|\/)test-/.test(f))) {
		const g = findePerfGerueche(fs.readFileSync(path.join(wurzel, f), "utf8"), f.endsWith(".php") ? "php" : "js");
		for (const x of g) aus.push({ datei: f, ...x });
	}
	process.stdout.write(JSON.stringify(aus, null, 1) + "\n");
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**; dann die drei CLIs einmal echt fahren und die Laufzeit notieren (Rangliste ~2 s; Doppelungen über ~7000 Funktionen: paarweise Nähe ist O(n²) mit Längenfilter — bleibt sie über 60 s, `--min` auf 12 heben und das im Kopfkommentar festhalten).

- [ ] **Step 5: Volles Testfeld (Global Constraints), dann Commit**

```bash
git add tools/refactoring/rangliste.mjs tools/refactoring/doppelungen.mjs tools/refactoring/perf-gerueche.mjs tools/refactoring/__tests__/doppelungen.test.js tools/refactoring/__tests__/perf-gerueche.test.js && git commit -m "tool(refactoring): Rangliste, Doppelungs-Scan und Perf-Gerueche fuer den Ueberwachungsmodus

Drei lesende Skripte (Entwurf §9.1). Die Rangliste ist der Port des Laufs vom
05.09.2026; Doppelungen ueber normalisierte Ruempfe (Bezeichner -> $N), Naehe
per 3-Gramm-Jaccard >= 0,9; vier Perf-Gerueche mit Zeile.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
```

Dann Deploy-Riegel und **ein** Push für Task 1–7 (`git push origin master`, Remote-SHA, eigenen Lauf beobachten).

---
### Task 8: Die große Analyse und die Erstfüllung des Rückgrats

**Files:**
- Modify: `docs/refactoring-arbeitspakete.md` (Pakete anhängen)
- Modify: `~/.claude/scheduled-tasks/avesmaps-refactoring/liste.md` (Befunde für den Owner: IIFE/CSS/index.html, Totfund unverändert)
- Scratch: `<scratchpad>/analyse/*.json` (Rohdaten, nicht ins Repo)

**Interfaces:**
- Consumes: alle CLIs aus Task 4–7.
- Produces: gefülltes Rückgrat; jedes Paket in der Form aus Task 5 mit `Stand`/`Blob` von `origin/master`.

- [ ] **Step 1: Rohdaten rechnen (im geteilten Checkout lesend, Stand `origin/master` — vorher `git fetch`)**

```bash
cd C:/GIT/avesmaps && git fetch -q origin && S=<scratchpad>/analyse && mkdir -p "$S"
git worktree add --detach "$S/wt" origin/master            # Analyse auf origin/master, nicht auf dem veralteten Arbeitsbaum
cd "$S/wt"
node tools/refactoring/rangliste.mjs --abgekuehlt 5 --min-zeilen 600 > "$S/rangliste.json"
node -e 'for (const r of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) if (r.globaleFunktionen>0) console.log(r.datei)' "$S/rangliste.json" > "$S/kandidaten.txt"
while read f; do node tools/refactoring/vorpruefung.mjs "$f" > "$S/vp-$(echo "$f" | tr '/' '_').json"; done < "$S/kandidaten.txt"
node tools/refactoring/doppelungen.mjs --min 10 > "$S/doppelungen.json"
node tools/refactoring/perf-gerueche.mjs > "$S/perf-gerueche.json"
git rev-parse origin/master > "$S/stand.txt"
```

Dazu die **heißen** großen Dateien ohne Abkühlung ebenfalls durch die Vorprüfung (`--abgekuehlt 0 --min-zeilen 2000`): sie bekommen Pakete mit dem Vermerk „heiß, wartet auf Abkühlung“ — die Routine prüft die Frist ohnehin selbst (§6 Schritt 4), und ein vorbereitetes Paket liegt am ersten ruhigen Tag bereit.

- [ ] **Step 2: Pakete ableiten (Regeln)**

Für jede Datei mit `freieBloecke` ≥ 150 Zeilen: **ein Paket je Block**, Verfahren nach Endung (A `.js`, B `.html`, C `.php`), Ziel nach Bestand (`<basename>-<thema>.js|php` bzw. `js/pages/<seite>-<thema>.js`), `Block` = `„<Thema>“ — <erster> … <letzter> (<n> Funktionen, ~<zeilen> Zeilen ab Z. <von>)`. Das **Thema** liest der Bearbeiter aus den Funktionsnamen und dem Kopfkommentar des Blocks (z. B. alle `avesmapsClimate*` → „Klimabänder“) — nie „Block 3“. `Vorprüfung (<datum>)` fasst die JSON-Zähler zusammen; `Fallen` nennt, was `nichtGesehen` für DIESE Datei bedeutet (hat sie eine `.php`-Seite als Wirt? erzeugt sie CSS-Klassen per String?). `Stand: <stand.txt> · Blob: $(git rev-parse origin/master:<pfad>)`.

Perf-Gerüche: je Fundstelle mit **mehr als einer** Abfrage in einer Schleife oder DDL auf einem Lesepfad ein Paket **D** mit Status `GO nötig` (Probe, Entwurf §7), Feld `- Messskript: tools/perf/<paket>.mjs|php (zu schreiben)` und der zu zählenden Größe. ⚠️ Vor dem Anlegen gegen AGENTS.md §10/§11 halten: was dort als ✅ erledigt steht (DDL-Riegel `avesmapsSchemaEnsureOnce`, Derived-N+1, Delta-Abruf) ist KEIN Paket; was dort als offen steht (die drei korrelierten Wappen-Unterabfragen je Layer-Zeile, die PHP-seitige Geometrie- und JSON-Arbeit, `ground_penalties` ungelesen) ist einer.

Doppelungen: **noch keine Pakete** — erst Step 4 (Historiker).

IIFE-/CSS-/`index.html`-Funde: in `liste.md` unter `## Für den Owner` als Befund mit Zahlen (Zeilen, Commits, was ein Muster bräuchte) — kein Paket.

- [ ] **Step 3: Drei Rollen-Agenten widerlegen die Paketliste (BEVOR sie ins Repo geht)**

Die Liste liegt als Entwurf im Scratchpad (`$S/arbeitspakete-entwurf.md`). Drei Agenten (`general-purpose`, parallel, jeder bekommt Pfad des Entwurfs + Spec-Pfad + die JSON-Rohdaten; Verbot: Dateien ändern, `git checkout/stash/restore`, Live-Server anfragen):

1. **Backend/STRATO:** „Du hältst STRATO am Leben. Welches Paket würde unter Last oder beim Deploy etwas ändern? Rechne: `require_once` an der Blockstelle — gibt es eine Auswertung auf Dateiebene, die davon abhängt? Welche `.php`-Seite lädt ein Asset aus einem B-Paket und braucht einen Hand-Stempel (`grep -n '?v=' edit/*.php`)?“
2. **Der Skeptiker mit den Narben:** „Such in AGENTS.md und in den Zieldateien nach 💣 🪤 ⚠️ 🔴 und ‚lautlos', ‚still'. Jede Stelle ist ein Fehler, der schon passiert ist. Welches Paket läuft in eine davon? Nenne Paket und Zeile.“
3. **Der Behauptungsprüfer:** „Prüfe jedes Paket: existieren die genannten Funktionen in dieser Reihenfolge in der Datei auf `origin/master`? Stimmt die Zeilenzahl auf ±10 %? Trägt das Paket `Stand`/`Blob`, die zu `origin/master` passen (`git rev-parse origin/master:<pfad>`)? Welches `Fallen`-Feld ist leer, obwohl `nichtGesehen` für diese Datei greift?“

Jeder Fund wird **eingearbeitet oder mit Beleg entkräftet**; die Entkräftung steht im Paket unter `Verlauf`. Eigene Fehler zuerst berichten (Memory `multi-agent-adversarial-review`).

- [ ] **Step 4: Historiker-Läufe für Doppelungen**

Für jedes Paar aus `doppelungen.json` mit `gleichheit ≥ 0.9` und beiden Rümpfen ≥ 10 Zeilen (Erwartung: eine Handvoll bis ein Dutzend; mehr → nur die zehn größten) **ein** Agent (Rolle „Der Historiker“): „`git blame -w` je abweichender Zeile beider Fassungen, Commit-Betreff und ggf. Entwurf dazu, alle Aufrufer beider, Tests, die die Abweichung festhalten. Antworte: Unterschied (wörtlich) · Warum (Commit, Datum, Grund) · Empfehlung: zusammenlegen mit Vereinigung / beide behalten (gewollt, Beleg) / eine ist tot.“ Daraus je Paar ein Paket `GO nötig` mit den vier Zeilen `Unterschied`, `Warum`, `Empfehlung`, `Beleg` — Verfahren `A` (JS) oder `C` (PHP), Ziel „Zusammenlegung nach Owner-Entscheid“.

- [ ] **Step 5: Rückgrat schreiben, Wächter-Test, Testfeld, Commit, Push**

Pakete nach Rangwert der Zieldatei sortiert, Kennungen `P-001` aufwärts, in `docs/refactoring-arbeitspakete.md` unter `## Pakete`. Dann:

```bash
node tools/refactoring/__tests__/arbeitspakete.test.js      # muss "ok (N Pakete)" melden
node tools/refactoring/frischelauf.mjs --wurzel .            # alle "gilt" (Stand = origin/master)
```
Volles Testfeld, Deploy-Riegel, dann:
```bash
git add docs/refactoring-arbeitspakete.md && git commit -m "docs(refactoring): Erstfuellung des Rueckgrats -- <N> Pakete aus der Analyse vom 05.09.2026

<n_A> A (JS-Schnitt), <n_B> B (Inline-Script), <n_C> C (PHP-Lib), <n_D> D (Perf, GO noetig),
<n_dup> Doppelungen mit Historiker-Beleg (GO noetig). Drei Rollen-Agenten haben die Liste
widerlegt: <k> Funde eingearbeitet, <m> entkraeftet (Verlauf je Paket).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
git push origin master
git worktree remove --force "$S/wt" && git worktree prune
```

---

### Task 9: Der Prüfagent `refactoring-widerleger`

**Files:**
- Create: `.claude/agents/refactoring-widerleger.md`

**Interfaces:**
- Produces: einen Agenten, den die Routine (und jede Sitzung) mit `subagent_type: "refactoring-widerleger"` startet; die **Rolle** steht im Aufruf-Prompt (`Rolle: Widerleger | Testbindung | Behauptung | Historiker`).

- [ ] **Step 1: Agentendatei schreiben**

```markdown
---
name: refactoring-widerleger
description: Widerlegt VOR dem Commit einen Innenumbau der Refactoring-Routine — findet den Aufrufpfad, der danach anders läuft, die Testbindung, die das Skript nicht sah, und den Satz in der Commit-Nachricht, der nicht stimmt. Verwende ihn dreimal je Schritt (Rollen Widerleger · Testbindung · Behauptung) und einmal je Doppelung (Historiker).
tools: Read, Grep, Glob, Bash
model: sonnet
---

Du bist der Widerleger der Refactoring-Routine von Avesmaps. Du baust nichts, du änderst nichts,
du fragst den Live-Server nie an, und du führst kein `git checkout`, `git stash` oder `git restore`
aus — der Baum, den du liest, darf sich nicht bewegen. Dein Auftrag ist, den Umbau zu Fall zu
bringen. Findest du nichts, sagst du, WARUM es nichts gibt — nicht „sieht gut aus“.

## Warum es dich gibt

Vier Läufe der Routine, vier Fallen, jede erst NACH dem Bauen gefunden: ein `window`-Export beim
Laden auf einen verschobenen Namen (01.09.2026), ein handgepflegtes Dateiregister in einem Test
(02.09.), Tests, die Funktionen per Namen aus dem Quelltext schneiden (03.09.), und drei Tests, die
eine Datei allein in einen `vm`-Kontext laden und quer durch alle Blöcke rufen — transitiv, 51 von
52 Funktionen gebunden (04.09.). `tools/refactoring/vorpruefung.mjs` prüft diese vier heute
maschinell. **Du suchst, was es laut seiner eigenen Liste `nichtGesehen` nicht sieht.**

## Was du bekommst

Der Aufrufer nennt dir: die **Rolle**, das Diff (oder den Commit im Worktree), den Paket-Eintrag
aus `docs/refactoring-arbeitspakete.md`, die JSON-Ausgabe der Vorprüfung, den Entwurf
`docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`.

## Die Rollen

**Widerleger** — „Es gibt einen Aufrufpfad, der nach diesem Schnitt anders läuft. Such ihn.“
Sieh in: `edit/*.php` und `api/**/*.php`, die JS-Namen als String ausgeben; dynamische Namen
(`window["…" + x]`, `new Function`, `eval`); Inline-Handler in `html/*.html` (`onclick="name("`);
Tests, die die Seite oder Datei allein laden; die Ladereihenfolge in `index.html` und der Editorseite
(steht das neue `<script>` VOR dem ersten Ladezeit-Bezug?). Antworte mit Fundstelle (Datei:Zeile) oder
„widerlegt: <warum es keinen gibt>“ — mit den Suchbefehlen, die du gefahren hast.

**Testbindung** — Fahre `node tools/refactoring/vorpruefung.mjs <zieldatei> --von <a> --bis <b>`
gegen den Stand VOR dem Schnitt (`git show origin/master:<pfad>` in eine Temp-Datei) und gegen den
Worktree. Prüfe jedes Register aus `register`: wurde es nachgezogen (Diff)? Prüfe jeden Test aus
`quelltextTests`/`vmTests`: läuft er im Worktree grün (`node <test>`)? Such nach Tests, die das
Skript nicht sieht: `grep -rn "<basename>" js tools --include=*.js --include=*.mjs`.

**Behauptung** — Lies die Commit-Nachricht und den Paket-Eintrag Satz für Satz. Für jeden Satz:
stimmt er gegen den Diff? Welche Zusicherung (Test, Fingerabdruck, Zeilenzahl) würde eine
Rücknahme des Umbaus NICHT brechen? Bei einem Perf-Paket zusätzlich: ist die Fixture
repräsentativ gegen die Live-Größen in AGENTS.md (12.216 Features, 1.438 Katalogzeilen, 908
Geometriezeilen)? Ist `ausgabe_sha256` vorher/nachher gleich? Ist Arbeit verschwunden oder nur
verschoben (in einen Cache, der bei jedem Schreiben fällt)?

**Historiker** — Zwei Fassungen derselben Funktion: `git blame -w` je abweichender Zeile,
Commit-Betreff, Entwurf unter `docs/superpowers/specs/`, alle Aufrufer beider, Tests, die den
Unterschied festhalten. Antworte in vier Zeilen: Unterschied (wörtlich) · Warum (Commit, Datum,
Grund) · Empfehlung (zusammenlegen mit Vereinigung / beide behalten, gewollt / eine ist tot) · Beleg.

## Wie du antwortest

Zuerst der schwerste Fund, mit Datei:Zeile und dem Befehl, der ihn zeigt. Dann die Liste. Zum
Schluss ein Satz: **„Blockt“** oder **„Blockt nicht, weil …“**. Kein Lob, keine Zusammenfassung
des Diffs. Ein Fund, den die Routine nicht mit Beleg entkräftet, blockt den Commit (Entwurf §8).
```

- [ ] **Step 2: Probe — den Agenten einmal gegen den letzten Routine-Commit fahren**

In dieser Sitzung: `Agent(subagent_type: "refactoring-widerleger", prompt: "Rolle: Widerleger. Commit 1d163b75b (citymaps-autoget). Paket: <Eintrag aus dem Rückgrat, falls angelegt>. Vorprüfung: node tools/refactoring/vorpruefung.mjs api/_internal/app/citymaps.php")`. Erwartung: „Blockt nicht, weil …“ mit gefahrenen Suchbefehlen. Antwortet er ohne Befehle oder mit „sieht gut aus“, ist der Prompt zu weich — nachschärfen, bevor er ins Repo geht.

- [ ] **Step 3: Commit + Push** (Deploy-Riegel)

```bash
git add .claude/agents/refactoring-widerleger.md && git commit -m "agent(refactoring): refactoring-widerleger -- drei Rollen vor dem Commit, Historiker je Doppelung

Entwurf 2026-09-05 §8/§9.3. Der Agent baut nichts, aendert nichts, fragt den
Live-Server nie; ein nicht entkraefteter Fund blockt.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NLEdrARTxAjZvTmEYHBGRF"
git push origin master
```

---

### Task 10: `SKILL.md` v2, `state.md`, `liste.md`

**Files:**
- Modify: `~/.claude/scheduled-tasks/avesmaps-refactoring/SKILL.md` (ganz ersetzen)
- Modify: `~/.claude/scheduled-tasks/avesmaps-refactoring/state.md` (Zeile `zeilen_ueber_1000`, `perf_probe`)
- Modify: `~/.claude/scheduled-tasks/avesmaps-refactoring/liste.md` (Lehren raus, Negatives bleibt)

Außerhalb des Repos — kein Commit. Vorher `cp SKILL.md SKILL.v1.md` daneben (die v1 bleibt lesbar).

- [ ] **Step 1: SKILL.md v2 schreiben** (vollständiger Text; Frontmatter bleibt, `description` neu)

```markdown
---
name: avesmaps-refactoring
description: Täglich 08:00 – EIN Innenumbau aus dem Arbeitspaket-Rückgrat (verhaltensgleich, oder Perf mit Messbeleg); sonst Überwachungsmodus. Still außer bei einem Schritt.
---

Du bist die tägliche **Refactoring-Routine** für Avesmaps (avesmaps.de). Repo: `C:\GIT\avesmaps`.
Entwurf v2 mit allen Begründungen: `docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`
(v1: `…/2026-08-31-refactoring-routine-design.md`). Diese Anweisung ist die Kurzfassung; im Zweifel gilt der Entwurf.

**Der Normalfall ist, dass du nichts baust. Das ist ein gutes Ergebnis.**

## SPRACHE
Deutsch (Kommentare, Rückmeldung). Commit-Betreff Deutsch mit Präfix `refactor(<scope>):` (AGENTS.md §8; die
englischen Betreffs der v1-Läufe waren die Ausnahme). Kopfkommentar einer Geschwisterdatei in der Sprache der Zieldatei.

## SCOPE — was du NIE tust
- **Nichts Sichtbares**, keine Verhaltensänderung außer Verfahren D (Perf: gleiche Ausgabe, weniger Arbeit).
- Keine Bugs (`avesmaps-daily-fixes`), keine Features, kein Datenmodell, kein API-Vertrag, nichts Löschendes.
- **Nie:** IIFE-Module (0 globale Funktionen), CSS-Blätter, `index.html` (nur additiv ein `<script>`), Build-Produkte
  (`css/pages/political-territory-editor-inline.css`), `js/app/i18n-en.js`, `*/third-party/`, `html/editor-handbuch.html`.
- Fällt dir etwas anderes auf: **nicht anfassen** — `liste.md` unter `## Für den Owner`, eine Zeile im Bericht.

## Die vier Verfahren
- **A** JS: Lauf globaler Funktionsdeklarationen → `<name>-<thema>.js` daneben, EIN `<script>` direkt neben dem Original.
- **B** Editorseite: Lauf aus dem Inline-`<script>` von `html/<seite>.html` → `js/pages/<seite>-<thema>.js`, `<script src>`
  **direkt VOR** dem Inline-Block. Kein Hand-`?v=` (der Stempler läuft über `html/*.html`).
- **C** PHP-Lib: Lauf reiner Funktionen → `<name>-<thema>.php`, `require_once __DIR__ . '/<name>-<thema>.php';` **an der
  Blockstelle** (die Konstanten, die der Block liest, stehen davor — die Vorprüfung zählt sie).
- **D** Perf: siehe Riegel D. Nur mit `perf_probe: bestanden` in `state.md` ohne GO.
Grenzen für A/B/C: kein Zustand auf oberster Ebene im Block, kein Ladezeit-Code, thematisch zusammenhängend, geteilter
Zustand bleibt drüben. Kopfkommentar bei Blöcken unter ~250 Zeilen auf 8 Zeilen anlegen (Fingerabdruck!).

## Schritt 0 — Gedächtnis und Rückgrat
`C:\Users\mail\.claude\scheduled-tasks\avesmaps-refactoring\`: `state.md` (`last_run`, `last_commit`, `runs`,
`zeilen_ueber_1000`, `perf_probe`), `liste.md` (nur `## Verworfen` und `## Für den Owner`).
Das Rückgrat ist `docs/refactoring-arbeitspakete.md` im Repo (lesen erst im Worktree, Schritt 2). Steht dort eine
Zeile `Sperre: …`, analysierst du nur und pushst nichts.

## Schritt 1 — Nachprüfung des Vorlaufs
Für jede Datei aus `last_commit` (`git show --stat --format= <sha>`), die unter `js/`, `css/`, `html/` liegt:
`curl -s "https://avesmaps.de/<pfad>?cb=$(date +%s)" | sha256sum` gegen `git show <sha>:<pfad> | sha256sum`.
EINE Anfrage je Datei. `api/_internal/` ist nicht abrufbar — dort gilt ein späterer grüner Deploy-Lauf eines fremden
Commits als Beleg. Abweichung → im Bericht nennen, **nicht selbst heilen** (heilt nur eine Inhaltsänderung, AGENTS.md §9).

## Schritt 2 — Wegwerf-Worktree (NIE im geteilten Checkout arbeiten)
```
git -C C:/GIT/avesmaps fetch --quiet origin
git -C C:/GIT/avesmaps worktree add --detach C:/Users/mail/.claude/scheduled-tasks/avesmaps-refactoring/wt origin/master
```
Ab hier läuft ALLES in `$WT`. Am Ende — auch bei Abbruch, auch bei Fehler:
```
git -C C:/GIT/avesmaps worktree remove --force C:/Users/mail/.claude/scheduled-tasks/avesmaps-refactoring/wt
git -C C:/GIT/avesmaps worktree prune
```

## Schritt 3 — Frischelauf (JEDER Lauf, ALLE offenen Pakete)
`node tools/refactoring/frischelauf.mjs --wurzel $WT`. Je Paket: `gilt` → nichts · `überholt` → die mitgelieferte
Vorprüfung lesen: Block an den Namen noch zusammenhängend und frei → Paket **nachziehen** (`Stand`/`Blob` neu, Verlaufszeile
„<datum> nachgezogen: <was sich bewegt hat>“); sonst `verworfen (überholt: <grund>)` · `datei-weg` → `verworfen`.
`erledigt` nie glauben: steht die Geschwisterdatei und ist der Block weg? Sonst Widerspruch in den Bericht.
Die Änderungen am Rückgrat gehen mit dem Commit des Tages mit, oder — ohne Schritt — als eigener `docs(refactoring):`-Commit.

## Schritt 4 — Kandidat
Oberstes `offen`-Paket nach Rangwert (`node tools/refactoring/rangliste.mjs --wurzel $WT`), dessen Datei
**≥ 5 Tage** unberührt ist (`alterTage`) und im geteilten Baum sauber: `git -C C:/GIT/avesmaps status --porcelain -- <ziel>`
muss LEER sein. `GO nötig` überspringst du. Keins → **Überwachungsmodus** (Schritt 9), still enden.
Vor dem Bauen: `node tools/refactoring/vorpruefung.mjs <datei> --wurzel $WT --von <a> --bis <b>` → `block.frei` muss
`true` sein, sonst `verworfen (Vorprüfung: <gruende>)`.

## Schritt 5 — Bauen
Nach Verfahren. Bei B: `file <neue datei>` muss CRLF melden, wenn die Quelle CRLF hat (sed -n strippt CR — per Node
schneiden). Register aus `register` nachziehen (eine Zeile, wie das `<script>`-Tag). Paketzeile: `Status: in Arbeit (<datum>)`.

## Schritt 6 — Riegel (alle, in dieser Reihenfolge)
1. **Fingerabdruck**: `git diff --stat -- . ':!docs' ':!*.md'` — Differenz Einfügungen/Löschungen ≤ 20 Zeilen UND ≤ 5 %.
2. **Vorprüfung** noch einmal gegen den Worktree (`block.frei`).
3. **Volles Testfeld** (Muster des Workflows, äußere Klammer, selbstprüfende Zählung, parallel):
   ```
   find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 > js0
   find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 > php0
   test "$(find js tools \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) | wc -l)" = "$(tr -dc '\0' < js0 | wc -c)" || echo "ZAEHLUNG WEICHT AB"
   xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' < js0 > rot-js
   xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' < php0 > rot-php
   ```
   Kein `2>&1` auf die Ergebnisdatei. Vorbestehend rot nur `linkcheck/link-url-test.php`. Unerwartet rot → seriell nachfahren.
4. **Agenten** (drei Aufrufe `refactoring-widerleger`, Rollen Widerleger · Testbindung · Behauptung; jeder bekommt Diff, Paket,
   Vorprüfungs-JSON, Entwurf). Ein Fund blockt, bis du ihn mit Beleg entkräftet hast (Beleg in den Verlauf des Pakets). Zwei
   Funde in Folge an derselben Datei → `verworfen (Agentenfund)`. **Kannst du keine Agenten starten:** Schritt trotzdem
   möglich für A/B/C, Bericht sagt „ohne Agenten geprüft“; ein D-Paket baust du dann NICHT.
5. **Im Zweifel nichts.** `git restore`, Paket zurück auf `offen` oder `verworfen`, Grund in den Verlauf.

## Riegel D — Perf
Gleiche Ausgabe, weniger Arbeit. Ändert sich Ausgabe oder Frische (Cache-Frist, Takt) → `GO nötig`, nie selbst.
Messskript `tools/perf/<paket>.(mjs|php)` (nie `test-*`), Ausgabe `{ gezaehlt, ms_median, ausgabe_sha256 }`:
Basis gegen HEAD messen → bauen → dieselbe Messung. `ausgabe_sha256` gleich, gezählte Größe um den Schwellwert des Pakets
gesunken, `ms_median` (3 Läufe) nicht schlechter. Nach dem Deploy **EINE** Live-Anfrage als Gegenprobe; fällt sie durch →
eigenen Commit revertieren (mit Deploy-Riegel) und melden. Solange `perf_probe: offen`: D nur mit GO.

## Schritt 7 — Deploy-Riegel, Commit, Push
```
gh run list --workflow=deploy-avesmaps-strato.yml --limit 3 --json status --jq '[.[] | select(.status != "completed")] | length'
```
Nicht `0` → warten (auch `queued`/`pending` — ein Push ersetzt den WARTENDEN Lauf, und dessen Dateien lädt nie jemand hoch).
Nach zwei Versuchen belegt → heute nicht pushen, Paket zurück auf `offen`, Grund in `liste.md` (laufbezogen, verfällt nach 14 Tagen).
- `git status` zuerst; NUR eigene Pfade, `git add <pfade> && git commit` in EINEM Zug. Nie `-A`/`.`/`-a`.
- Betreff: `refactor(<scope>): <thema> aus <datei> herausgezogen (<vorher>→<nachher> Zeilen)`, Rumpf nennt Paket-Kennung und
  Agenten-Ergebnis. Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `git push origin master`. Reject → `git fetch`, `git reset --hard origin/master`, `git cherry-pick <sha>`,
  `git merge-base --is-ancestor origin/master HEAD`. **Kein `rebase --autostash`, kein `stash drop`, kein force-push.**
  Hat sich die **Zieldatei** auf origin bewegt → verwerfen statt cherry-picken.
- Remote-SHA prüfen; eigenen Lauf bis zum Ende beobachten (`gh run watch`). Abgebrochen → „nicht ausgeliefert“ melden.
- Live-Gegenprobe: EINE Anfrage auf die neue Datei (`?cb=`), HTTP 200 und Hash = Commit.

## Schritt 8 — Gedächtnis
`state.md`: `last_run`, `last_commit`, `runs`+1, `zeilen_ueber_1000` (Summe der Zeilen aller Produktivdateien ≥ 1000 aus der
Rangliste, `--abgekuehlt 0`). `liste.md`: nur Verworfenes und Owner-Befunde. **Lehren → `## Lehren` in DIESER Datei**
(datiert, ≤ 5 Zeilen, mit dem Satz, was du jetzt anders tust). Über 300 Zeilen → `## Lehren` verdichten, nie eine Regel streichen.

## Schritt 9 — Überwachungsmodus (wenn kein Paket ausführbar ist)
Im Worktree: `rangliste.mjs --abgekuehlt 5 --min-zeilen 600` → für jede Datei mit globalen Funktionen `vorpruefung.mjs` → freie
Blöcke ≥ 150 Zeilen werden Pakete `offen` (A/B/C, Thema aus den Namen, `Stand`/`Blob` von origin/master).
`doppelungen.mjs --min 10` → je Paar ≥ 0,9 EIN Historiker-Lauf (`refactoring-widerleger`, Rolle Historiker) → Paket `GO nötig`
mit Unterschied · Warum · Empfehlung · Beleg. **Ohne Warum kein Paket.** `perf-gerueche.mjs` → Paket D (`GO nötig` bis zur
Probe), vorher gegen AGENTS.md §10/§11 halten (was ✅ ist, ist keins). IIFE/CSS/index.html → Befund in `liste.md`, kein Paket.
Totfund wie bisher (melden, nie löschen). Neue Pakete als `docs(refactoring):`-Commit (Deploy-Riegel, nur die eine Datei).
Am 1. des Monats: die Reihe `zeilen_ueber_1000` aus `state.md` als Bilanz; zwei Monate steigend → „es braucht eine Kampagne“.

## Schritt 10 — Rückmeldung
Still außer bei einem Schritt; kein Discord. Schritt: Datei, vorher→nachher, Block, SHA, Testfeld, Agenten, Deploy, Live.
Kein Schritt: ein Satz. Dazu, nur wenn zutreffend: Abweichung der Nachprüfung · „ohne Agenten geprüft“ · Frischelauf in EINER
Zeile (n nachgezogen, m verworfen) · neue `GO nötig`-Pakete namentlich.

## Lehren
- **01.09.2026 — Ladezeit-Bezug.** Ein `window.x = f` auf oberster Ebene bindet `f`: nach dem Schnitt kennt das Skript den Namen beim Laden nicht mehr. → Vorprüfung 1; ein Block mit Ladezeit-Bezug ist keiner.
- **02.09.2026 — Dateiregister.** `tools/paths/test-wiki-sync-panel-tab.mjs` führt Dateien von Hand; ein Lader in einer neuen Datei ist dort „defined nowhere“. → Vorprüfung 2; das Register nachziehen gehört ZUM Schnitt.
- **03.09.2026 — Quelltext-Tests und der eigene Kopf.** Tests schneiden Funktionen per Namen aus `route-plan.js`; und ein 10-Zeilen-Kopf kippt den 5-%-Fingerabdruck bei 177 Zeilen. → Vorprüfung 3; Kopf unter 250 Zeilen auf 8 Zeilen.
- **04.09.2026 — vm-Bindung ist transitiv.** Drei Tests laden `review-path-sync.js` allein; alles, was eine gerufene Funktion ruft, ist gebunden — 51 von 52. → Vorprüfung 4 mit Fixpunkt; die Datei ist strukturell kein Ziel.
- **04.09.2026 — PHP ist sicherer.** `require_once` an der Blockstelle: alle Aufrufer und Tests sehen die Geschwisterdatei transparent. → Verfahren C bevorzugen, wenn A und C gleich hoch stehen.
- **04.09.2026 — Roter Smoke-Test ≠ Codebefund.** Zwei curl-Timeouts und ein 404 bei kerngesundem Code (gesättigte Worker). → Erst einen unbeteiligten Endpunkt gegenmessen; nie in Schleife.
- **04.09.2026 — Rebase scheitert hier.** `.gitattributes` normalisiert beim Checkout, der Autostash kollidiert, der Rebase bleibt still ungetan; der Stash-Stack ist geteilt. → `reset --hard origin/master` + `cherry-pick`; nie `stash drop`.
- **04.09.2026 — Werkzeugfallen.** `\b` wird im Skript zum Backspace (Wort-Token statt RegExp) · NUL-Bytes in `powerline-topology.js` vergiften jeden grep-Strom (Dateien einzeln lesen) · `^function ` verfehlt `async function`. → Eine bekannt LEBENDE Probe mitführen; eine viel zu lange Kandidatenliste ist das Werkzeug, nicht der Bestand.
- **05.09.2026 — Ein Paket ist eine Momentaufnahme.** Gültig ist es nur gegen den heutigen Blob. → Frischelauf jeden Tag, Identität sind Namen, nie Zeilen.

Umgebung: Windows + PowerShell (Bash-Tool ebenfalls verfügbar). `gh` und `node` sind vorhanden.
```

- [ ] **Step 2: `state.md` ergänzen**

```
last_run: 2026-09-04
last_commit: 1d163b75b
runs: 4
zeilen_ueber_1000: <Summe aus rangliste.mjs --abgekuehlt 0 --min-zeilen 1000, am 05.09.2026>
perf_probe: offen
```

- [ ] **Step 3: `liste.md` bereinigen** — die vier Verworfen-Einträge auf je 3–5 Zeilen kürzen (Datei, Block, Datum, Grund, Verweis „Lehre → SKILL.md“); den Abschnitt `## Werkzeugfallen des Scans` streichen (steht in `## Lehren`); `## Für den Owner` unverändert lassen, plus die neuen IIFE/CSS/index.html-Befunde aus Task 8; den veralteten Satz zu `otherSourceCreditMarkup` („fehlender Aufruf“) berichtigen: seit 03.09.2026 sind die Altquellen-Leser laut AGENTS.md §11 tot → „Leiche, wartet auf Ausbau“.

- [ ] **Step 4: Gegenprobe** — `wc -l SKILL.md` (≤ 300), und die Kommandos aus Schritt 3, 4, 6.3 und 7 einmal von Hand im Worktree fahren (Frischelauf gegen das echte Rückgrat: alle `gilt`; Rangliste; Testfeld-Zählung; Deploy-Riegel-Abfrage liefert eine Zahl).

---

### Task 11: Memory, Abnahmeliste, Bericht

**Files:**
- Modify: `C:\Users\mail\.claude\projects\C--GIT-avesmaps\memory\routinen-liegen-in-scheduled-tasks.md` (v2-Stand, Skriptpfade)
- Modify: `…\memory\MEMORY.md` (Zeile nachziehen)

- [ ] **Step 1: Abnahmeliste — jede 💣/⚠️/🔴-Zeile der Spec einzeln abhaken** (AGENTS.md §9 „Der eigene Entwurf ist die Abnahmeliste“): Spec lesen, je Marker „erfüllt (Task N)“ oder „verworfen, weil …“ — als Tabelle in den Bericht. Dazu den Agenten `usability-konsistenz` einmal mit Diff (alle Commits dieser Sitzung) + Spec fahren; seine Funde einarbeiten oder entkräften.

- [ ] **Step 2: Memory nachziehen** — in `routinen-liegen-in-scheduled-tasks.md`: „v2 seit 05.09.2026: Rückgrat `docs/refactoring-arbeitspakete.md`, Skripte `tools/refactoring/{vorpruefung,frischelauf,rangliste,doppelungen,perf-gerueche}.mjs`, Agent `refactoring-widerleger`; `perf_probe` in state.md ist der Owner-Schalter“. `MEMORY.md`-Zeile entsprechend.

- [ ] **Step 3: Bericht an den Owner** — was gebaut, was gemessen (Vorrat: Zahl der Pakete je Verfahren; Gegenprobe der Vorprüfung an den vier historischen Dateien), was offen (Agenten in der Routine-Sitzung erst nach dem ersten Lauf belegt; die drei Perf-Pakete auf Probe; IIFE/CSS/index.html ohne Plan), und **🔧 DU:** die `GO nötig`-Pakete durchsehen; am 06.09. 08:00 läuft der erste v2-Lauf — sein Bericht ist ausführlich (`runs` wird dafür nicht zurückgesetzt, aber der erste v2-Lauf meldet wie ein erster Lauf: die Anweisung sagt das in Schritt 10 nicht — ergänzen: „der erste Lauf nach einer Fassungsänderung der SKILL.md meldet ausführlich“).

---

## Selbstprüfung des Plans (gegen die Spec)

| Spec | Task |
|---|---|
| §2 Rückgrat, Zustände, Sperrzeile, Fingerabdruck nur Code, Wächter-Test unter `tools/` | 5, 8, 10 (Schritt 6.1) |
| §3 Verfahren A/B/C/D, Grenzen, B `<script>` davor, C Konstanten, Sprache des Kopfs | 4 (Konstanten), 10 (Verfahren) |
| §4 Stand/Blob, Namen als Identität, Frischelauf jeden Lauf, Perf-Basis gegen HEAD, `erledigt` nie glauben, keine Zeilen in der Anweisung | 6, 10 (Schritt 3, Riegel D) |
| §5 Skript, vier Prüfungen + 0, PHP-Konstanten, HTML, Werkzeugfallen, Test mit vier Fixtures + Mutationsproben, `nichtGesehen` | 1–4 |
| §6 Schrittfolge | 10 |
| §7 Perf-Riegel, Messbeleg, Probe, Live-Gegenprobe, Revert | 10 (Riegel D), 8 (D-Pakete `GO nötig`) |
| §8 Agent, drei Rollen, blockt, Rückfall, kein checkout/stash | 9, 10 (Schritt 6.4) |
| §9 Überwachungsmodus, Doppelungen mit Historiker, Bilanz als Reihe | 7, 8, 10 (Schritt 9) |
| §10 Lehren → SKILL.md, Deckel 300 | 10 |
| §11 Nachprüfung des Vorlaufs | 10 (Schritt 1) |
| §12 Deploy-Riegel v2, reset+cherry-pick | 10 (Schritt 7) |
| §13 Rückmeldung | 10 (Schritt 10) |
| §14 Reihenfolge | Tasks 1–11 |
| §15 außerhalb | 8 (Befunde in `liste.md`), 11 (Bericht) |

Namen quer über Tasks: `findeFunktionen`/`blendeRuempfeAus`/`wortTokens`/`pruefeZustand`/`pruefeLadezeit` (1) · `alleDateien`/`findeRegister`/`findeQuelltextTests` (2) · `findeVmTests`/`aufrufgraph`/`fixpunkt` (3) · `konstantenImBlock`/`inlineScript`/`freieBloecke`/`vorpruefung`/`codeMaske` (4, `codeMaske` in 7 importiert) · `parseArbeitspakete`/`ladeArbeitspakete`/`STATUS` (5, in 6 importiert) · `pruefeFrische`/`blockGrenzen`/`blobAufOrigin` (6) · `rangliste`/`normalisiereRumpf`/`findeDoppelungen`/`findePerfGerueche` (7). Das Feld `messskript` des Pakets wird in 5 geparst und in 8/10 geschrieben.
