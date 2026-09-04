"use strict";

/*
 * JEDE KOPFZEILE HAT EINE REGEL -- entweder das Bauteil oder ihre eigene, nie keine.
 *
 * 💣 WARUM ES DIESEN TEST GIBT. Beim Umbau am 04.09.2026 wurden die Kopfzeilen-Regeln von vier
 *    umgestellten Fenstern aus geteilten Komma-Listen entfernt. Der Entferner hatte einen
 *    Rueckfall: war das letzte Listenglied dran, wandert die oeffnende Klammer auf die vorige
 *    Zeile mit Komma. 🪤 DIESE SUCHE KENNT IHRE EIGENE REGELGRENZE NICHT -- sie laeuft ueber das
 *    `}` hinweg in die VORIGE Regel und setzt die Klammer dort. Zwei Regeln verschmelzen zu einer,
 *    und die Deklarationen der ersten sind weg.
 *
 *    Das ist zweimal passiert, an zwei Dateien, und beide Male traf es Fenster, die GAR NICHT
 *    umgebaut werden sollten: drei Karten-Werkzeuge (Flaeche vereinfachen, Grenze aus Territorien,
 *    Reihenfolge und Sperren) und den statischen Territoriumseditor. Deren Kopfzeile stand danach
 *    ohne jede Regel da -- Titel und ✕ untereinander, nackter Browser-Knopf.
 *
 * 🔴 DIE INVARIANTE IST EIN ENTWEDER-ODER, keine Heuristik: ein Fenster mit einer Kopfzeilen-Klasse
 *    traegt entweder `avm-fenster__kopf` (dann gilt das Bauteil) ODER hat eine eigene Regel unter
 *    seinem Namen. "Weder noch" ist genau der kaputte Zustand und sonst nichts.
 *
 * ⚠️ Der Test sagt NICHT, ob die Regel gut ist -- nur, dass ueberhaupt eine da ist. Er ersetzt
 *    keinen Blick, er faengt das lautlose Verschwinden.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");

function alleCss(verzeichnis, sammler) {
	for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
		const p = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			// third-party gehoert uns nicht.
			if (eintrag.name !== "third-party") alleCss(p, sammler);
		} else if (eintrag.name.endsWith(".css")) {
			sammler.push(p);
		}
	}
	return sammler;
}

const css = alleCss(path.join(WURZEL, "css"), [])
	.map((p) => fs.readFileSync(p, "utf8"))
	.join("\n")
	// ⚠️ Kommentare raus: ein Kommentar, der eine gefallene Regel ERWAEHNT, wuerde sie hier
	//    als vorhanden ausweisen -- die Falle, an der schon andere Quelltexttests gescheitert sind.
	.replace(/\/\*[\s\S]*?\*\//g, "");

const seiten = ["index.html"].concat(
	fs.readdirSync(path.join(WURZEL, "html"))
		.filter((f) => f.endsWith(".html"))
		.map((f) => "html/" + f)
);

const familien = new Map();
for (const seite of seiten) {
	const txt = fs.readFileSync(path.join(WURZEL, seite), "utf8");
	const re = /class="([^"]*)"/g;
	let m;
	while ((m = re.exec(txt))) {
		const klassen = m[1].split(/\s+/);
		const kopf = klassen.find(
			(k) => k !== "avm-fenster__kopf" && (/__header$/.test(k) || /__kopf$/.test(k))
		);
		if (!kopf) continue;
		const familie = kopf.replace(/__(header|kopf)$/, "");
		if (!familien.has(familie)) familien.set(familie, { bauteil: false, wo: seite });
		if (klassen.includes("avm-fenster__kopf")) familien.get(familie).bauteil = true;
	}
}

assert.ok(familien.size >= 10,
	"Der Sucher findet keine Kopfzeilen mehr (" + familien.size + ") -- er misst sich selbst kaputt");

const ohne = [];
for (const [familie, info] of familien) {
	// Eine eigene Regel: der Selektor steht in einer Liste, mit Nachfahre oder direkt vor der Klammer.
	const eigen = ["__header", "__kopf"].some((teil) =>
		css.includes("." + familie + teil + ",") ||
		css.includes("." + familie + teil + " ") ||
		css.includes("." + familie + teil + "{"));
	if (!info.bauteil && !eigen) ohne.push(familie + " (" + info.wo + ")");
}

assert.deepStrictEqual(ohne, [],
	"Kopfzeilen ohne jede Regel -- weder Bauteil noch eigene:\n   " + ohne.join("\n   "));

console.log("OK -- alle " + familien.size + " Kopfzeilen-Familien haben eine Regel");

// ---- 2) Dieselbe Rezeptur in zwei Dateien muss ZEICHENGLEICH sein -----------------------------
// 💣 `.modal-box`/`.modal-title`/`.modal-sub`/`.modal-actions` stehen ZWEIMAL, je einmal im
//    <style> von wiki-sync-monitor.html und wiki-sync-settlement-editor.html -- derselbe Bauer,
//    dieselben sechs Fenster, zwei Kopien. Am 04.09.2026 wichen sie in FUENF Werten voneinander ab:
//    Titel 15px gegen --font-size-subhead (und 15 steht nicht einmal auf der Schriftskala),
//    Untertitel 12px gegen --font-size-small, Kastenbreite 360 gegen 390, dazu zwei hartkodierte
//    Werte fuer Radius und Schatten. Genau das hat der Owner gemeldet: „titelleisten anders
//    aussehen … unterschiedlich gross".
// 🔴 Der Test verlangt GLEICHHEIT, nicht bestimmte Werte -- wer beide zusammen aendert, darf das.
//    Er faellt nur, wenn eine Kopie allein wandert, und das ist die Divergenz selbst.
const REZEPTUR = /^\s*\.modal-(box|title|sub|actions) \{/;
const kopien = ["html/wiki-sync-monitor.html", "html/wiki-sync-settlement-editor.html"]
	.map((datei) => ({
		datei,
		regeln: fs.readFileSync(path.join(WURZEL, datei), "utf8")
			.split(/\r?\n/)
			.filter((l) => REZEPTUR.test(l))
			.map((l) => l.trim())
			.sort(),
	}));

assert.ok(kopien[0].regeln.length >= 4,
	"Der Sucher findet die Rezeptur nicht mehr -- er misst sich selbst kaputt");

for (const regel of kopien[0].regeln) {
	assert.ok(kopien[1].regeln.includes(regel),
		"Die zwei Kopien der modal-box-Rezeptur laufen auseinander.\n"
		+ "   nur in " + kopien[0].datei + ":\n   " + regel);
}
for (const regel of kopien[1].regeln) {
	assert.ok(kopien[0].regeln.includes(regel),
		"Die zwei Kopien der modal-box-Rezeptur laufen auseinander.\n"
		+ "   nur in " + kopien[1].datei + ":\n   " + regel);
}
console.log("OK -- die modal-box-Rezeptur steht in beiden Dateien zeichengleich (" +
	kopien[0].regeln.length + " Regeln)");
