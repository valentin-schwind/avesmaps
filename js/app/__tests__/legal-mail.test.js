// Die E-Mail-Adresse des Impressums (js/app/legal-mail.js), Befund A24 zweite Haelfte.
//
// 🔴 Zwei Dinge muessen zugleich wahr bleiben, und sie ziehen in verschiedene Richtungen:
//   1. Die Adresse muss STIMMEN und ohne JavaScript LESBAR sein -- § 5 DDG, „unmittelbar
//      erreichbar". Eine falsche oder fehlende Adresse im Impressum ist schlimmer als keine.
//   2. Im ausgelieferten Quelltext darf sie NICHT im Klartext stehen und kein `mailto:` tragen.
// Deshalb prueft diese Datei beides: die Wirkung am DOM und die ausgelieferten Bytes selbst. Beim
// zweiten Punkt IST der Quelltext das Erzeugnis -- eine Zusicherung darauf misst hier die Wirkung,
// nicht die Schreibweise.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/legal-mail.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const {
	AVESMAPS_LEGAL_MAIL_ID,
	avesmapsIsLegalMailAddress,
	avesmapsActivateLegalMail,
} = require(path.join(ROOT, "js", "app", "legal-mail.js"));

const EXPECTED_ADDRESS = "info@avesmaps.de";

// ---- Was gilt als Adresse? ----------------------------------------------------------------------

assert.strictEqual(avesmapsIsLegalMailAddress(EXPECTED_ADDRESS), true, "die eigene Adresse gilt");
assert.strictEqual(avesmapsIsLegalMailAddress("  info@avesmaps.de  "), true, "Leerraum wird abgeschnitten");
assert.strictEqual(avesmapsIsLegalMailAddress("a.b+c@sub.example.co.uk"), true, "Punkte, Plus und Unterdomains gelten");

// 💣 Faengt: ein `mailto:` auf etwas, das keine Adresse ist. Das waere ein toter Knopf im Impressum.
assert.strictEqual(avesmapsIsLegalMailAddress(""), false, "leer ist keine Adresse");
assert.strictEqual(avesmapsIsLegalMailAddress("info"), false, "ohne @ nicht");
assert.strictEqual(avesmapsIsLegalMailAddress("info@avesmaps"), false, "ohne Punktdomain nicht");
assert.strictEqual(avesmapsIsLegalMailAddress("info@avesmaps."), false, "ein leerer Rest nach dem Punkt nicht");
assert.strictEqual(avesmapsIsLegalMailAddress("info@avesmaps.d"), false, "eine einbuchstabige Endung nicht");
assert.strictEqual(avesmapsIsLegalMailAddress("in fo@avesmaps.de"), false, "Leerraum mittendrin nicht");
assert.strictEqual(avesmapsIsLegalMailAddress("a@b@c.de"), false, "zwei @ nicht");
assert.strictEqual(avesmapsIsLegalMailAddress(null), false, "null nicht");

// ---- Ein DOM, klein genug zum Lesen und echt genug zum Antworten ---------------------------------

function makeElement(tagName) {
	return {
		tagName,
		children: [],
		attributes: {},
		textContent: "",
		setAttribute(name, value) { this.attributes[name] = value; },
		getAttribute(name) { return this.attributes[name]; },
		appendChild(child) { this.children.push(child); return child; },
		querySelector(selector) { return this.children.find((child) => child.tagName === selector) || null; },
	};
}

function makeDom(spanText, extraChildren) {
	const span = makeElement("span");
	span.textContent = spanText;
	(extraChildren || []).forEach((child) => span.children.push(child));
	const byId = { [AVESMAPS_LEGAL_MAIL_ID]: span };

	return {
		span,
		doc: {
			getElementById: (id) => byId[id] || null,
			createElement: (tagName) => makeElement(tagName),
		},
	};
}

// ⭐ Die Wirkung, um die es geht: aus Text wird ein Link, und zwar auf genau diese Adresse.
{
	const { doc, span } = makeDom(EXPECTED_ADDRESS);
	const linked = avesmapsActivateLegalMail(doc);
	const anchor = span.querySelector("a");
	assert.strictEqual(linked, EXPECTED_ADDRESS, "die verlinkte Adresse wird zurueckgemeldet");
	assert.ok(anchor, "es liegt jetzt ein Link darin");
	assert.strictEqual(anchor.getAttribute("href"), "mailto:" + EXPECTED_ADDRESS, "und er zeigt auf die Adresse");
	assert.strictEqual(anchor.textContent, EXPECTED_ADDRESS, "sichtbar bleibt die Adresse selbst");
}

// 💣 Faengt: ein zweiter Aufruf haengt einen zweiten Link hinein (Sprachwechsel, erneutes Oeffnen).
{
	const existing = makeElement("a");
	const { doc, span } = makeDom(EXPECTED_ADDRESS, [existing]);
	assert.strictEqual(avesmapsActivateLegalMail(doc), "", "ein vorhandener Link wird nicht ersetzt");
	assert.strictEqual(span.children.length, 1, "und kein zweiter angehaengt");
}

// 💣 Faengt: Muell wird verlinkt. Dann steht ein toter mailto-Knopf im Impressum.
{
	const { doc, span } = makeDom("bitte per Formular");
	assert.strictEqual(avesmapsActivateLegalMail(doc), "", "was keine Adresse ist, wird nicht verlinkt");
	assert.strictEqual(span.querySelector("a"), null, "und bleibt einfacher Text");
	assert.strictEqual(span.textContent, "bitte per Formular", "der Text bleibt unangetastet stehen");
}

// 💣 Faengt: die Funktion faellt ueber eine Seite ohne diesen Absatz.
assert.strictEqual(avesmapsActivateLegalMail(makeDom("x").doc.getElementById ? { getElementById: () => null } : null), "", "kein Absatz, kein Fehler");

// ---- Und jetzt die ausgelieferten Bytes ----------------------------------------------------------

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 🔴 DIE ADRESSE MUSS STIMMEN. Sie steht als Zeichen-Entitaeten da; hier wird genau das
// zurueckgerechnet, was der Browser daraus macht. Ein verrutschtes Zeichen faellt sonst niemandem
// auf -- die Seite sieht richtig aus und die Post kommt nie an.
const spanMatch = indexHtml.match(/<span id="legal-mail">([^<]*)<\/span>/);
assert.ok(spanMatch, "der Absatz mit der Adresse steht in index.html");
const decoded = spanMatch[1].replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
assert.strictEqual(decoded, EXPECTED_ADDRESS, "die Entitaeten ergeben genau die Impressums-Adresse");

// 💣 Faengt: jemand schreibt die Adresse „der Lesbarkeit halber" im Klartext daneben oder ersetzt die
// Entitaeten. Genau das ist der Zweck dieses Absatzes, und es fiele im Browser NICHT auf -- beide
// Fassungen sehen identisch aus.
assert.ok(!indexHtml.includes(EXPECTED_ADDRESS), "die Adresse steht nirgends im Klartext in index.html");
assert.ok(!/mailto:/i.test(indexHtml), "und kein mailto: -- danach suchen die Sammelprogramme zuerst");

// ⚠️ Auch die Sprachtabelle darf sie nicht tragen: sie wird mit ausgeliefert.
const i18nEn = fs.readFileSync(path.join(ROOT, "js", "app", "i18n-en.js"), "utf8");
assert.ok(!i18nEn.includes(EXPECTED_ADDRESS), "die Sprachtabelle traegt die Adresse nicht");

// 💣 UND ES MUSS SIE JEMAND RUFEN. Genau hier ist diese Sitzung schon einmal hereingefallen (A24,
// erste Haelfte): die Regel stand fertig da, und der Aufruf fehlte -- der Test blieb gruen.
const bootstrap = fs.readFileSync(path.join(ROOT, "js", "app", "bootstrap.js"), "utf8");
assert.ok(/avesmapsActivateLegalMail\(document\)/.test(bootstrap), "bootstrap.js ruft die Regel wirklich auf");
assert.ok(indexHtml.includes('src="js/app/legal-mail.js"'), "und index.html laedt die Datei");

// 💣 UND SIE MUSS VOR bootstrap.js STEHEN. Die Ladereihenfolge in index.html ist ein Vertrag
// (AGENTS.md § 3). Rutscht diese Zeile dahinter, ist die Funktion beim Aufruf nicht da -- der
// try/catch dort schluckt es, die Adresse bleibt als Text stehen, und NICHTS sieht kaputt aus. Genau
// diese Stille ist der Grund fuer die Zusicherung: ein nicht klickbares Impressum faellt niemandem
// auf, der die Seite nicht mit dieser Frage im Kopf oeffnet.
const mailScriptAt = indexHtml.indexOf('src="js/app/legal-mail.js"');
const bootstrapScriptAt = indexHtml.indexOf('src="js/app/bootstrap.js"');
assert.ok(bootstrapScriptAt > -1, "bootstrap.js wird geladen");
assert.ok(mailScriptAt < bootstrapScriptAt, "legal-mail.js steht VOR bootstrap.js, sonst ruft der Aufruf ins Leere");

console.log("legal-mail ok");
