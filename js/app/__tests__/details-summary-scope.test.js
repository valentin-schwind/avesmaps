// Kein klassenloses <details>/<summary> in der CSS-Kette der Karte.
//
// 💣 Der Anlass: `css/pages/political-territory-wiki-tree.css` setzte
// `details > summary { display: flex; ...; list-style: none }` OHNE Klasse. Die Datei ist in
// `index.html` direkt verlinkt (Z. 51), die Regel galt also fuer jedes <details> der ganzen Seite --
// obwohl sie dem Wiki-Baum des Territorien-Editors gehoert. Am 11.08.2026 hat sie den gesendeten
// Mails im Postfach Adressat, Betreff, Datum und Vorschau NEBENeinander in eine Zeile gelegt; die
// erste Behebung war eine Gegenregel im Postfach (`b57210e0`), die Ursache blieb stehen.
//
// 🔴 Der Test misst die AUSGELIEFERTE Kette, nicht eine Datei: er liest die <link>-Tags aus
// `index.html` und folgt der @import-Kette von `styles.css` bis in jede Tiefe. Genau diese
// Unterscheidung hat frueher schon eine Pruefseite blind gemacht ("/css/styles.css ist nicht die
// ganze Kette"): mehrere Blaetter haengen einzeln am HTML und nicht am @import.
//
// ⚠️ Mitgeprueft wird `css/pages/political-territory-editor-inline.css`. Das Blatt haengt NICHT am
// HTML -- `js/territory/territory-editor-inline-host.js` laedt es zur Laufzeit nach --, liegt dann
// aber ebenfalls ueber `index.html`. Sein `#political-territory-editor-host`-Praefix zaehlt hier
// ausdruecklich NICHT als Bindung: der Wirt umfasst den ganzen eingebetteten Editor.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/details-summary-scope.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// Der Wirt des eingebetteten Editors umfasst den GANZEN Editor. Eine Regel, die ausser ihm nichts
// nennt, ist dort genauso pauschal wie eine klassenlose Regel auf der Seite.
const HOST_ID = "#political-territory-editor-host";

// Zusaetzlich geprueft, obwohl nicht im HTML verlinkt: zur Laufzeit nachgeladenes Bauprodukt.
const EXTRA_SHEETS = ["css/pages/political-territory-editor-inline.css"];

// ---- Kommentare entfernen, Zeilennummern behalten -------------------------------------------------
//
// Ohne das Entfernen zaehlt ein auskommentiertes Beispiel als Regel -- und in genau diesen Dateien
// stehen die abschreckenden Beispiele als Kommentar. Ersetzt wird durch ebenso viele Zeilenumbrueche,
// damit die gemeldete Fundstelle noch stimmt.
function stripComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, (block) => "\n".repeat((block.match(/\n/g) || []).length));
}

// ---- Die Kette einsammeln -------------------------------------------------------------------------

function collectSheet(relativeHref, seen, out) {
	const clean = relativeHref.replace(/^\//, "").split(/[?#]/)[0];
	const filePath = path.join(ROOT, clean);
	if (seen.has(filePath)) return;
	seen.add(filePath);
	assert.ok(fs.existsSync(filePath), `verlinktes Blatt fehlt: ${clean}`);
	const css = stripComments(fs.readFileSync(filePath, "utf8"));
	out.push({ href: clean, css });
	const importPattern = /@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/g;
	let match;
	while ((match = importPattern.exec(css))) {
		const target = path.posix.join(path.posix.dirname(clean), match[1].split(/[?#]/)[0]);
		collectSheet(target, seen, out);
	}
}

function collectIndexChain() {
	const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
	const sheets = [];
	const seen = new Set();
	const linkPattern = /<link\b[^>]*>/g;
	let tag;
	while ((tag = linkPattern.exec(html))) {
		if (!/rel\s*=\s*"stylesheet"/i.test(tag[0])) continue;
		const href = /href\s*=\s*"([^"]+)"/i.exec(tag[0]);
		if (href) collectSheet(href[1], seen, sheets);
	}
	for (const extra of EXTRA_SHEETS) collectSheet(extra, seen, sheets);
	return sheets;
}

// ---- Die Selektoren einer Datei -------------------------------------------------------------------
//
// Ein winziger Parser statt einer Zeilen-Regex: `@media`-Bloecke enthalten weitere Regeln, und eine
// Regex ueber Zeilen wuerde sie entweder verschlucken oder ihren Rumpf fuer Selektoren halten.
const GROUP_AT_RULE = /^@(media|supports|container|layer|scope|document)\b/i;

function eachStyleRule(css, visit) {
	let index = 0;
	let line = 1;
	let prelude = "";
	let preludeLine = 1;

	function skipString(quote) {
		index++;
		while (index < css.length) {
			const char = css[index];
			if (char === "\\") { index += 2; continue; }
			if (char === "\n") line++;
			if (char === quote) { index++; return; }
			index++;
		}
	}

	while (index < css.length) {
		const char = css[index];
		if (char === '"' || char === "'") { skipString(char); continue; }
		if (char === "\n") { line++; prelude += char; index++; continue; }
		if (char === ";" || char === "}") { prelude = ""; preludeLine = line; index++; continue; }
		if (char === "{") {
			const selector = prelude.trim();
			index++;
			if (GROUP_AT_RULE.test(selector)) { prelude = ""; preludeLine = line; continue; }
			let depth = 1;
			while (index < css.length && depth > 0) {
				const inner = css[index];
				if (inner === '"' || inner === "'") { skipString(inner); continue; }
				if (inner === "\n") line++;
				else if (inner === "{") depth++;
				else if (inner === "}") depth--;
				index++;
			}
			if (selector && !selector.startsWith("@")) visit(selector, preludeLine);
			prelude = "";
			preludeLine = line;
			continue;
		}
		if (!prelude.trim() && char.trim()) preludeLine = line;
		prelude += char;
		index++;
	}
}

// ---- Die Zusicherung ------------------------------------------------------------------------------
//
// Gebunden heisst: irgendwo im Selektor steht eine Klasse oder eine ID. `[open]` bindet NICHT (jedes
// aufgeklappte <details> der Seite traegt es), `:hover`/`::before` binden nicht, und der Wirt des
// eingebetteten Editors zaehlt nicht mit.
function mentionsDetailsOrSummary(part) {
	return /(^|[^\w-])(details|summary)([^\w-]|$)/.test(part);
}

function isBound(part) {
	return /[.#]/.test(part.split(HOST_ID).join(""));
}

function findPageWideRules(sheets) {
	const offenders = [];
	for (const sheet of sheets) {
		eachStyleRule(sheet.css, (selector, line) => {
			for (const part of selector.split(",")) {
				const trimmed = part.trim();
				if (!trimmed) continue;
				if (!mentionsDetailsOrSummary(trimmed)) continue;
				if (isBound(trimmed)) continue;
				offenders.push(`${sheet.href}:${line}  ${trimmed}`);
			}
		});
	}
	return offenders;
}

// ---- A: der Parser sieht ueberhaupt etwas ---------------------------------------------------------
//
// 💣 Ohne diese Zusicherung besteht der Test auch dann, wenn `eachStyleRule` gar nichts findet --
// null Selektoren ergeben null Verstoesse. Genau so wird ein gruener Punkt wertlos.
{
	const sheets = collectIndexChain();
	assert.ok(sheets.length >= 10, `zu wenige Blaetter eingesammelt: ${sheets.length}`);

	let seenSelectors = 0;
	let seenDetailsSelectors = 0;
	for (const sheet of sheets) {
		eachStyleRule(sheet.css, (selector) => {
			seenSelectors++;
			for (const part of selector.split(",")) {
				if (mentionsDetailsOrSummary(part.trim())) seenDetailsSelectors++;
			}
		});
	}
	assert.ok(seenSelectors > 2000, `der Parser findet zu wenige Regeln: ${seenSelectors}`);
	assert.ok(
		seenDetailsSelectors >= 10,
		`der Parser findet zu wenige <details>/<summary>-Regeln: ${seenDetailsSelectors}`,
	);
	console.log(`  ${sheets.length} Blaetter, ${seenSelectors} Regeln, davon ${seenDetailsSelectors} an <details>/<summary>`);
}

// ---- B: keine davon gilt der ganzen Seite ---------------------------------------------------------
{
	const offenders = findPageWideRules(collectIndexChain());
	assert.deepStrictEqual(
		offenders,
		[],
		"klassenlose <details>/<summary>-Regel in der CSS-Kette von index.html -- sie gilt fuer JEDES "
			+ "<details> der Seite (Hinweise-Fenster, Social-Hub, WikiSync-Listen, Postfach). Binde sie an "
			+ `ihren Bauteil-Selektor:\n    ${offenders.join("\n    ")}`,
	);
}

// ---- C: der Wirt allein bindet nicht --------------------------------------------------------------
//
// Nachgestellt statt geglaubt: ein `#political-territory-editor-host details > summary` -- der Zustand
// des Bauprodukts vor dem 12.08.2026 -- muss auffallen, sonst prueft B das Blatt nur zum Schein.
{
	const faked = [{ href: "<nachgestellt>", css: `${HOST_ID} details > summary { display: flex; }` }];
	assert.strictEqual(
		findPageWideRules(faked).length,
		1,
		"der Wirt des eingebetteten Editors darf nicht als Bindung durchgehen",
	);

	const bound = [{ href: "<nachgestellt>", css: `${HOST_ID} .tree-node details > summary { display: flex; }` }];
	assert.strictEqual(findPageWideRules(bound).length, 0, "eine gebundene Regel darf nicht anschlagen");

	// `[open]` ist keine Bindung -- jedes aufgeklappte <details> der Seite traegt es.
	const attributeOnly = [{ href: "<nachgestellt>", css: "details[open] > summary { color: red; }" }];
	assert.strictEqual(findPageWideRules(attributeOnly).length, 1, "[open] darf nicht als Bindung durchgehen");

	// Eine Klasse, die auf „summary" endet, ist kein <summary>-Element.
	const classNamedSummary = [{ href: "<nachgestellt>", css: ".wiki-sync-panel__summary { color: red; }" }];
	assert.strictEqual(findPageWideRules(classNamedSummary).length, 0, "eine Klasse namens …summary ist kein Element");

	// Ein auskommentiertes Beispiel ist keine Regel -- in genau diesen Dateien steht es als Warnung.
	const inComment = [{ href: "<nachgestellt>", css: stripComments("/* details > summary { display: flex } */\n.a { color: red; }") }];
	assert.strictEqual(findPageWideRules(inComment).length, 0, "ein Kommentar ist keine Regel");

	// In einem @media-Block versteckt zaehlt genauso.
	const inMedia = [{ href: "<nachgestellt>", css: "@media (max-width: 700px) { details > summary { display: flex; } }" }];
	assert.strictEqual(findPageWideRules(inMedia).length, 1, "ein @media-Block darf nichts verbergen");
}

console.log("details-summary-scope: alle Zusicherungen erfuellt");
