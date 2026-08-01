const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Der Editor-Code der Seiten unter html/ lebt NICHT in einer .js-Datei, sondern als ein einziger
// grosser <script>-Block in der HTML-Datei -- der Landschaften-Editor allein bringt ~96.000 Zeichen
// mit. Es gibt keinen Build und keinen Linter, also faellt ein Syntaxfehler dort durch jede Masche:
// der Browser verwirft den GANZEN Block still, boot() laeuft nie, und die Seite bleibt einfach auf
// "Wird geladen ..." stehen. Genau so ist es am 2026-08-01 passiert (606e40f9 loeschte einen
// addEventListener-Rumpf und liess dessen "});" stehen) -- das Fenster ging live kaputt, ohne dass
// irgendetwas rot wurde.
//
// Dieser Test ersetzt den fehlenden Build-Schritt fuer genau diese Stelle: jeder eingebettete
// JavaScript-Block jeder ausgelieferten Seite muss sich parsen lassen.
const ROOT = path.resolve(__dirname, "..", "..", "..");

function htmlPages() {
	const pages = fs.readdirSync(ROOT)
		.filter((name) => name.endsWith(".html") && !name.startsWith("verify-"))
		.map((name) => name);
	const htmlDir = path.join(ROOT, "html");
	for (const name of fs.readdirSync(htmlDir)) {
		if (name.endsWith(".html")) { pages.push(path.join("html", name)); }
	}
	return pages.sort();
}

// Ein <script> ohne src und ohne fremden type. type="application/ld+json" (die SEO-Daten in der
// index.html) ist JSON, kein JavaScript, und wuerde sonst falsch rot melden.
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

// HTML-Kommentare zuerst leeren, sonst zaehlt ein "<script>" IM Kommentar als Blockanfang --
// index.html:2194 erklaert in einem Kommentar die Reihenfolge der <script>-Tags und riss den Rest
// der Datei als vermeintlichen Block an sich. Die Zeilenumbrueche bleiben stehen, damit die
// Zeilennummern unten weiter auf die echte Datei zeigen.
function blankComments(html) {
	return html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}

function inlineScripts(html) {
	const blocks = [];
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
	let match;
	while ((match = pattern.exec(html)) !== null) {
		const attributes = match[1] || "";
		if (/\bsrc\s*=/i.test(attributes)) { continue; }
		const type = (/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attributes) || ["", ""])[1].toLowerCase();
		if (!JS_TYPES.has(type)) { continue; }
		const code = match[2];
		if (!code.trim()) { continue; }
		// Die Zeilennummer des Blockanfangs, damit eine Fundstelle direkt in der HTML-Datei
		// anspringbar ist statt "irgendwo im dritten Block".
		blocks.push({ code, startLine: html.slice(0, match.index).split("\n").length });
	}
	return blocks;
}

const failures = [];
let checked = 0;

for (const page of htmlPages()) {
	const html = blankComments(fs.readFileSync(path.join(ROOT, page), "utf8"));
	for (const block of inlineScripts(html)) {
		checked += 1;
		try {
			new vm.Script(block.code, { filename: page });
		} catch (error) {
			// V8 nennt die Zeile innerhalb des Blocks (dessen Zeile 1 der Rest der <script>-Zeile
			// ist); auf die Zeile der HTML-Datei umrechnen.
			const inner = /:(\d+)\n/.exec(error.stack || "");
			const line = inner ? block.startLine + Number(inner[1]) - 1 : block.startLine;
			failures.push(`${page}:${line} -- ${error.message}`);
		}
	}
}

assert.ok(checked > 0, "Kein eingebetteter Block gefunden -- der Test misst nichts mehr.");
assert.deepStrictEqual(failures, [], "Eingebettetes JavaScript laesst sich nicht parsen:\n  " + failures.join("\n  "));

console.log(`OK: ${checked} eingebettete <script>-Bloecke parsen sauber.`);
