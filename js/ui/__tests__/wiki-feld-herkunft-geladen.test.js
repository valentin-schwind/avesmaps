// Wer den Wiki-Override ZEICHNET, muss js/ui/wiki-feld-herkunft.js auch LADEN.
//
// 💣 DIE FALLE, GEGEN DIE DAS STEHT, HAT DAS HAUS SCHON EINMAL TEUER BEZAHLT. Jeder Zeichner
// beginnt mit `if (typeof avesmapsWikiFeldStand !== "function") { return; }` -- ein Riegel, der
// richtig ist (die Datei kann in einem Dokument fehlen) und der bei fehlender Skriptzeile LAUTLOS
// greift: die Feldzeilen saehen dann aus, als gaebe es keine Abweichung. Kein Fehler in der
// Konsole, kein roter Test, nichts.
// Genau diese Bauform war `avesmapsCoatSrc`: eine geteilte Datei, die nur EIN Dokument lud --
// 8 von 12 Wappen-Ausgaben hotlinkten daraufhin das Wiki, und es kostete die IP-Sperre.
//
// Gefunden statt gepflegt: der Test sucht die AUFRUFER von `avesmapsWikiFeldStand` und verlangt fuer
// jeden das Dokument, das ihn laedt. Eine neue Oberflaeche meldet sich damit von selbst.
//
// Run: node js/ui/__tests__/wiki-feld-herkunft-geladen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const HELFER = "js/ui/wiki-feld-herkunft.js";
let checks = 0;

function alleQuellen(verzeichnis, treffer) {
	for (const eintrag of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		if (eintrag.name === "__tests__" || eintrag.name === "third-party") { continue; }
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { alleQuellen(rel, treffer); }
		else if (/\.(js|html)$/.test(eintrag.name)) { treffer.push(rel); }
	}
	return treffer;
}

const quellen = alleQuellen("js", []).concat(alleQuellen("html", [])).concat(["index.html"]);
const inhalt = new Map(quellen.map((datei) => [datei, lies(datei)]));

// ---- Wer ruft ihn? ---------------------------------------------------------------------------

const aufrufer = quellen.filter((datei) =>
	datei !== HELFER && /avesmapsWikiFeldStand\s*\(/.test(inhalt.get(datei)));

assert.ok(aufrufer.length >= 3,
	"weniger als drei Aufrufer von avesmapsWikiFeldStand gefunden -- das Muster greift vermutlich "
	+ "nicht mehr: " + JSON.stringify(aufrufer));
checks++;

// ---- Und wer laedt ihn? ----------------------------------------------------------------------
// Ein Aufrufer ist entweder selbst ein Dokument (dann muss ER die Zeile tragen) oder ein Skript,
// das ein Dokument einbindet -- dann muss JEDES Dokument, das es einbindet, den Helfer ebenfalls
// laden. ⚠️ Ein Skript, das kein Dokument einbindet, ist tot und faellt hier ebenfalls auf.

const dokumente = quellen.filter((datei) => /\.html$/.test(datei));

for (const datei of aufrufer) {
	if (/\.html$/.test(datei)) {
		assert.ok(new RegExp(HELFER.replace(/\//g, "\\/")).test(inhalt.get(datei)),
			`${datei} ruft avesmapsWikiFeldStand, laedt aber ${HELFER} nicht. Der Zeichner gibt dann `
			+ "LAUTLOS auf (`typeof … !== \"function\"`), und die Feldzeilen sehen aus, als gaebe es "
			+ "keine Abweichung -- ohne Fehler, ohne Konsole, ohne roten Test.");
		checks++;
		continue;
	}

	// ⚠️ Nur ein echtes <script src=…> zaehlt, nicht die blosse Erwaehnung: die Dateien dieses
	// Projekts nennen einander staendig im Kommentar, und ein Kommentar laedt nichts. Der erste
	// Entwurf zaehlte jede Erwaehnung und meldete den Landschafts-Editor als Wirt des Kartendialogs.
	const wirte = dokumente.filter((dok) => {
		const muster = new RegExp("<script[^>]+src=[\"'][^\"']*"
			+ datei.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		return muster.test(inhalt.get(dok));
	});
	assert.ok(wirte.length > 0,
		`${datei} ruft avesmapsWikiFeldStand, wird aber von KEINEM Dokument eingebunden -- entweder `
		+ "tot oder eine vergessene Skriptzeile.");
	checks++;

	for (const dok of wirte) {
		assert.ok(inhalt.get(dok).includes(HELFER),
			`${dok} bindet ${datei} ein, laedt aber ${HELFER} nicht. Der Zeichner gibt dort LAUTLOS `
			+ "auf und die Zeilen sehen aus wie „keine Abweichung\". Dieselbe Bauform wie "
			+ "avesmapsCoatSrc, wo eine geteilte Datei nur EIN Dokument band.");
		checks++;
	}
}

// ---- 💣 Und die Zelle darf nicht vom Uebersetzer ausgeraeumt werden --------------------------
// js/app/i18n.js setzt fuer `data-i18n` `el.textContent = v`. Eine `.wiki-alt`, die IN einem
// solchen Element steckt, ist beim ersten Sprachlauf spurlos weg -- und zwar erst dann, also nicht
// beim Bauen sichtbar. Sie gehoert deshalb NEBEN das uebersetzte Element, nie hinein.

for (const dok of dokumente) {
	const quelle = inhalt.get(dok);
	const treffer = quelle.match(/<[^>]*\bdata-i18n\b[^>]*>[^<]*<span[^>]*\bclass="wiki-alt"/g) || [];
	assert.deepStrictEqual(treffer, [],
		`${dok} schachtelt eine .wiki-alt IN ein Element mit data-i18n. js/app/i18n.js setzt dort `
		+ "`el.textContent = v` und raeumt die Zelle beim ersten Sprachlauf spurlos aus. Die Zelle "
		+ "gehoert NEBEN das uebersetzte Element: <span><span data-i18n=…>Name</span><span "
		+ "class=\"wiki-alt\"…></span></span>. Gefunden: " + treffer.join(" | "));
	checks++;
}

console.log(`OK — jeder Zeichner des Wiki-Overrides bekommt seinen Helfer, und keine Zelle steckt `
	+ `im Uebersetzer (${checks} Zusicherungen; Aufrufer: ${aufrufer.join(", ")}).`);
