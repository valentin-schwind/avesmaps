// Die geteilte Wappen-Weiche (js/ui/wappen-quelle.js) und ihre VERDRAHTUNG.
//
// 🔴 Anlass (20.08.2026): Wiki Aventurica sperrte unsere Ausgangs-IP. Ursache war NICHT der Server --
// es waren die Browser der Editoren. `avesmapsCoatSrc` lag in einer Datei, die nur index.html laedt,
// und SIEBEN von elf Wappen-Ausgaben schrieben die Wiki-Adresse direkt ins src. Zwei davon sind
// WikiSync-Listen mit EINEM Wappen JE ZEILE: ein Listenaufbau = hunderte Anfragen auf
// de.wiki-aventurica.de/wiki/Spezial:Dateipfad/…, an unserem Cache vorbei, der die ganze Zeit dastand.
//
// 💣 ZWEI HALBZEITEN, und die zweite ist die wichtigere. Ein Aufruf der Weiche nuetzt nichts, wenn
// das Dokument die Datei nicht laedt -- im Browser ist das ein ReferenceError, und in einem reinen
// Textmuster-Test faellt es NIE auf. Genau diese Luecke hat am 20.08.2026 in einem anderen Umbau
// einen toten Fangzweig hinterlassen.
//
// Run (aus dem Repo-Wurzelverzeichnis):  node js/ui/__tests__/wappen-quelle.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
const { avesmapsCoatSrc, AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT, AVESMAPS_WAPPEN_PLATZHALTER } = require("../wappen-quelle.js");
let checks = 0;

// ── 1. Die Weiche selbst ────────────────────────────────────────────────────────────────────────
const wikiUrl = "https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Ferdok.webp";

// 🔴 23.08.2026: ZU. Eine Wiki-Adresse wird gar nicht mehr angefragt -- auch nicht ueber den
// eigenen Cache. Der Server weist sie ohnehin ab (datei-riegel.php), und der Browser sparte sich
// die Anfrage nicht: eine Ortsliste waren 3.538 Anfragen an uns selbst, alle mit 503.
assert.strictEqual(AVESMAPS_WAPPEN_VOM_WIKI_ERLAUBT, false,
	"Der Schalter ist zu. 💣 Gekoppelt mit AVESMAPS_WIKI_DATEI_ABRUF_ERLAUBT in "
	+ "api/_internal/wiki/datei-riegel.php -- beide zusammen umlegen.");
assert.strictEqual(avesmapsCoatSrc(wikiUrl), AVESMAPS_WAPPEN_PLATZHALTER,
	"DER KERN: eine Wiki-Adresse wird NICHT angefragt, sondern durch den leeren Schild ersetzt.");

// 💣 Der Platzhalter darf NIE "" sein -- ein leeres src laesst den Browser die SEITE als Bild laden.
assert.ok(AVESMAPS_WAPPEN_PLATZHALTER.length > 0 && AVESMAPS_WAPPEN_PLATZHALTER.charAt(0) === "/",
	"Der Platzhalter ist eine eigene, lokale Adresse -- nicht leer und nicht extern.");
assert.strictEqual(avesmapsCoatSrc("/uploads/wappen/grafschaft-ferdok.svg"),
	"/uploads/wappen/grafschaft-ferdok.svg",
	"Eigene Uploads bleiben unberuehrt -- coat.php lehnt eine relative Adresse mit 400 ab.");
assert.strictEqual(avesmapsCoatSrc(""), "", "Leer bleibt leer.");
assert.strictEqual(avesmapsCoatSrc(null), "", "null bleibt leer, statt 'null' zu senden.");
assert.strictEqual(avesmapsCoatSrc("https://example.org/x.png"), "https://example.org/x.png",
	"Ein fremder Host bleibt unveraendert -- coat.php hat eine Host-Allowlist gegen SSRF.");
checks += 5;

// 💣 IDEMPOTENT: mehrere Oberflaechen reichen eine schon geleitete Adresse weiter (etwa der
// Siedlungseditor, der erst `settlementCoatImageSrc` fragt). Ein zweiter Aufruf darf sie nicht
// erneut einwickeln, sonst entsteht coat.php?u=coat.php?u=…
const einmal = avesmapsCoatSrc("/api/app/coat.php?u=" + encodeURIComponent(wikiUrl));
assert.strictEqual(avesmapsCoatSrc(einmal), einmal, "Zweiter Aufruf darf nichts mehr aendern.");
checks++;

// Auch die Subdomain des Dumps gehoert dazu -- sie liegt auf derselben IP und derselben Sperre.
assert.strictEqual(avesmapsCoatSrc("https://offline.wiki-aventurica.de/x.png"), AVESMAPS_WAPPEN_PLATZHALTER,
	"Auch Subdomains von wiki-aventurica.de werden erfasst -- sie liegen auf derselben IP und Sperre.");
checks++;

// ── 2. Keine Wappen-Ausgabe ohne die Weiche ─────────────────────────────────────────────────────
// Helfer, die selbst leiten. Jeder wird unten NACHGEWIESEN -- eine blosse Namensliste waere eine
// Behauptung.
const HELFER = ["avesmapsCoatSrc", "settlementCoatImageSrc", "settlementTerritoryCoatThumbMarkup"];
// 🔴 Begruendete Ausnahme: ein fest verdrahteter Screenshot im Handbuch, keine Wiki-Adresse.
const AUSNAHMEN = ["html/editor-handbuch.html"];

const dateien = [];
const sammle = (rel) => {
	for (const eintrag of fs.readdirSync(path.join(wurzel, rel), { withFileTypes: true })) {
		const kind = rel + "/" + eintrag.name;
		if (eintrag.isDirectory()) {
			if (eintrag.name !== "third-party" && eintrag.name !== "__tests__") {
				sammle(kind);
			}
		} else if (/\.(js|html)$/.test(eintrag.name)) {
			dateien.push(kind);
		}
	}
};
sammle("js");
sammle("html");
dateien.push("index.html");

const umgeht = [];
for (const rel of dateien) {
	if (AUSNAHMEN.includes(rel)) {
		continue;
	}
	const zeilen = lies(rel).split(/\r?\n/);
	zeilen.forEach((zeile, i) => {
		const istBild = /<img\b/i.test(zeile) || /\.src\s*=/.test(zeile);
		if (!istBild || !/(coat|wappen)/i.test(zeile)) {
			return;
		}
		// Eine Zeile ohne Adressausdruck (nur eine Klasse o. ae.) interessiert nicht.
		if (!/src/i.test(zeile)) {
			return;
		}
		// ⚠️ Ein Fenster zurueck, nicht nur die Zeile: mehrere Oberflaechen rechnen die Adresse eine
		// Zeile vorher aus (`const src = avesmapsCoatSrc(…)`) und setzen sie erst dann ins Markup.
		const fenster = zeilen.slice(Math.max(0, i - 6), i + 1).join(" ");
		if (HELFER.some((h) => fenster.includes(h)) || fenster.includes("coat.php")) {
			return;
		}
		umgeht.push(`${rel}:${i + 1}  ${zeile.trim().slice(0, 120)}`);
	});
}
assert.deepStrictEqual(umgeht, [],
	"Diese Wappen-Ausgaben gehen an der Weiche vorbei und laden direkt vom Wiki -- genau das hat am "
	+ "20.08.2026 die IP-Sperre ausgeloest:\n  " + umgeht.join("\n  "));
checks++;

// Die Helfer sind keine Behauptung: jeder leitet nachweislich.
for (const [helfer, datei] of [
	["settlementCoatImageSrc", "js/review/review-locations.js"],
	["settlementTerritoryCoatThumbMarkup", "js/ui/popups.js"],
]) {
	const quelle = lies(datei);
	const start = quelle.indexOf("function " + helfer);
	assert.ok(start >= 0, `${helfer} steht in ${datei}.`);
	const rumpf = quelle.slice(start, start + 900);
	assert.ok(rumpf.includes("coat.php") || rumpf.includes("avesmapsCoatSrc"),
		`${helfer} steht auf der Helferliste, leitet aber gar nicht ueber den Cache.`);
	checks += 2;
}

// ── 3. Die Verdrahtung: wer sie ruft, muss sie auch laden ───────────────────────────────────────
const dokumente = ["index.html", ...fs.readdirSync(path.join(wurzel, "html"))
	.filter((n) => n.endsWith(".html")).map((n) => "html/" + n)];
const dokInhalt = new Map(dokumente.map((d) => [d, lies(d)]));
const laedtWeiche = (inhalt) => inhalt.includes("js/ui/wappen-quelle.js");

// 3a. Ein Dokument mit eigenem Aufruf im Inline-Skript.
for (const [dok, inhalt] of dokInhalt) {
	if (inhalt.includes("avesmapsCoatSrc(")) {
		assert.ok(laedtWeiche(inhalt),
			`${dok} ruft avesmapsCoatSrc, laedt js/ui/wappen-quelle.js aber nicht -- im Browser ist `
			+ "das ein ReferenceError, und das Wappen fehlt komplett.");
		checks++;
	}
}

// 3b. Jede JS-Datei, die sie ruft, muss in JEDEM Dokument, das sie einbindet, versorgt sein.
const rufer = dateien.filter((rel) => rel.endsWith(".js") && rel !== "js/ui/wappen-quelle.js"
	&& lies(rel).includes("avesmapsCoatSrc("));
assert.ok(rufer.length >= 5, `Es sollten mehrere Rufer sein, gefunden: ${rufer.length}`);
checks++;

for (const rel of rufer) {
	const wirte = [...dokInhalt].filter(([, inhalt]) => inhalt.includes(rel.replace(/^js\//, "js/")));
	assert.ok(wirte.length > 0, `${rel} wird von keinem Dokument geladen -- toter Code?`);
	for (const [dok, inhalt] of wirte) {
		assert.ok(laedtWeiche(inhalt),
			`${dok} laedt ${rel} (das avesmapsCoatSrc ruft), aber nicht js/ui/wappen-quelle.js.`);
		checks++;
	}
}

// 💣 Und sie darf nur EINMAL definiert sein: eine zweite Fassung wuerde je nach Ladereihenfolge die
// geteilte ueberschreiben (AGENTS.md §3 -- spaeter geladene Dateien beschatten fruehere Globals).
const definitionen = dateien.filter((rel) => /function\s+avesmapsCoatSrc\s*\(/.test(lies(rel)));
assert.deepStrictEqual(definitionen, ["js/ui/wappen-quelle.js"],
	"avesmapsCoatSrc darf genau EINMAL definiert sein. Gefunden: " + definitionen.join(", "));
checks++;

console.log(`OK  wappen-quelle: ${checks} Zusicherungen -- kein Wappen laedt mehr direkt vom Wiki.`);
