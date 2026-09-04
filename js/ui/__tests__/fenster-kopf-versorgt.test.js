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
// 💣 `.modal-box`/`.modal-sub` stehen ZWEIMAL, je einmal im <style> von wiki-sync-monitor.html und
//    wiki-sync-settlement-editor.html -- derselbe Bauer, dieselben sechs Fenster, zwei Kopien. Am
//    04.09.2026 wichen sie in FUENF Werten voneinander ab: Titel 15px gegen --font-size-subhead
//    (und 15 steht nicht einmal auf der Schriftskala), Untertitel 12px gegen --font-size-small,
//    Kastenbreite 360 gegen 390, dazu zwei hartkodierte Werte fuer Radius und Schatten. Genau das
//    hat der Owner gemeldet: „titelleisten anders aussehen … unterschiedlich gross".
// ✅ Seit 05.09.2026 haengen die sechs am Fenster-Bauteil: `.modal-title` und `.modal-actions`
//    gibt es nicht mehr (Kopfzeile und Fussleiste kommen aus css/components/fenster.css), und
//    `.modal-box` traegt nur noch das MASS (Breite, max-height). Was bleibt, muss weiter gleich sein.
// 🔴 Der Test verlangt GLEICHHEIT, nicht bestimmte Werte -- wer beide zusammen aendert, darf das.
//    Er faellt nur, wenn eine Kopie allein wandert, und das ist die Divergenz selbst.
const REZEPTUR = /^\s*\.modal-(box|sub) \{/;
const kopien = ["html/wiki-sync-monitor.html", "html/wiki-sync-settlement-editor.html"]
	.map((datei) => ({
		datei,
		regeln: fs.readFileSync(path.join(WURZEL, datei), "utf8")
			.split(/\r?\n/)
			.filter((l) => REZEPTUR.test(l))
			.map((l) => l.trim())
			.sort(),
	}));

assert.ok(kopien[0].regeln.length >= 2,
	"Der Sucher findet die Rezeptur nicht mehr -- er misst sich selbst kaputt");
// 💣 Und die zwei gefallenen Regeln duerfen nicht ZURUECKKOMMEN -- eine `.modal-title`-Regel neben
//    dem Bauteil waere die 14. Kopfzeilen-Rezeptur, die dieser Umbau beendet hat.
// 🪤 NICHT ueber `kopien` pruefen -- die tragen nur die gefilterten box|sub-Zeilen, die Zusicherung
//    waere Vakuum. Die Datei wird dafuer noch einmal ungefiltert gelesen.
for (const kopie of kopien) {
	const roh = fs.readFileSync(path.join(WURZEL, kopie.datei), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(!/^\s*\.modal-(title|actions) \{/m.test(roh),
		kopie.datei + ": `.modal-title`/`.modal-actions` stehen wieder da -- Kopfzeile und "
		+ "Fussleiste kommen aus css/components/fenster.css, nicht aus einer zweiten Rezeptur");
}

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

// ---- 3) DAS INVENTAR -- jedes Fenster im Haus, und wer nicht am Bauteil haengt -----------------
// 💣 WARUM DIESER ABSCHNITT DER WICHTIGSTE IST. Auf die Frage „hast du alles?" habe ich am
//    04.09.2026 aus dem Gedaechtnis geantwortet und mich zweimal geirrt: der Dump-Bericht stand in
//    KEINER Zeile des Bauplans, und die drei Fenster der Reisegeschwindigkeiten hatte ich als
//    „Hinweisbanner, kein Fensterkopf" abgetan -- weil ihr Kopf ein ⓘ traegt. Beides fand erst das
//    systematische Nachzaehlen ALLER role="dialog"-Huellen.
// 🔴 Eine Huelle ist genau das: sie traegt `role="dialog"`. Innenteile (__frame, __row, __chip)
//    tun das nie -- der erste Sucher zaehlte sie mit und meldete 32 Luecken statt 9.
// ⚠️ Die Liste unten ist die AUSNAHME, nicht die Erlaubnis: wer ein Fenster hinzufuegt, das nicht
// 🪤 UND DAS IST ZUGLEICH DER BLINDE FLECK DIESER WACHE: ein Fenster OHNE `role="dialog"` sieht
//    sie NICHT. Genau so ist die Uebernahme-Vorschau durchgerutscht -- ein Kasten auf --z-modal
//    mit vollem Schleier, der eine Antwort verlangt, und ohne die Rolle. Ein Screenreader kannte
//    sie damit auch nicht als Fenster. Gefunden am 04.09.2026, indem ich die Wache GEGEN sich
//    selbst laufen liess: nicht „welche Fenster kenne ich", sondern „was SIEHT aus wie ein
//    Fenster und traegt die Rolle nicht".
// ⭐ Die Antwort war nicht, den Sucher unscharf zu machen, sondern dem Fenster die Rolle zu geben
//    -- sie stand ihm ohnehin zu. Wer das naechste Mal eines vermisst, faehrt dieselbe Gegenprobe.
//    am Bauteil haengt, muss es HIER eintragen und begruenden. Ein Fenster, das einfach so
//    danebensteht, faellt auf.
{
	const WURZEL2 = path.join(__dirname, "..", "..", "..");
	// ✅ 05.09.2026: `modal-box` stand hier als „eigener Durchgang" -- der ist gelaufen, die sechs
	//    Sync-Fenster haengen am Bauteil (js/pages/__tests__/sync-modale-am-bauteil.test.js).
	const AUSNAHMEN = {
		"spotlight-search": "Bauplan Abschnitt C -- Owner 04.09.2026: die Suche bleibt unberuehrt",
	};
	function alleJsDateien(verzeichnis, sammler) {
		for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
			const pfad = path.join(verzeichnis, eintrag.name);
			if (eintrag.isDirectory()) {
				if (eintrag.name !== "__tests__" && eintrag.name !== "third-party") alleJsDateien(pfad, sammler);
			} else if (eintrag.name.endsWith(".js")) { sammler.push(pfad); }
		}
		return sammler;
	}
	const quellen = [path.join(WURZEL2, "index.html")]
		.concat(fs.readdirSync(path.join(WURZEL2, "html")).filter((f) => f.endsWith(".html"))
			.map((f) => path.join(WURZEL2, "html", f)))
		.concat(alleJsDateien(path.join(WURZEL2, "js"), []));

	const huellen = [];
	for (const datei of quellen) {
		const txt = fs.readFileSync(datei, "utf8");
		let m;
		const reMarkup = /<(?:div|section)[^>]*role=["']dialog["'][^>]*>/g;
		while ((m = reMarkup.exec(txt))) {
			huellen.push({ klassen: (m[0].match(/class=["']([^"']+)["']/) || [])[1] || "", datei });
		}
		const reJs = /(\w+)\.className\s*=\s*["']([^"']+)["'];?[\s\S]{0,400}?\1\.setAttribute\(["']role["'],\s*["']dialog["']\)/g;
		while ((m = reJs.exec(txt))) { huellen.push({ klassen: m[2], datei }); }
		const reInner = /innerHTML\s*=\s*'<div class="([^"]+)" role="dialog"/g;
		while ((m = reInner.exec(txt))) { huellen.push({ klassen: m[1], datei }); }
	}

	assert.ok(huellen.length >= 40,
		"Der Sucher findet nur noch " + huellen.length + " Fensterhuellen -- er misst sich selbst kaputt");

	const unerklaert = [];
	for (const h of huellen) {
		if (/\bavm-fenster\b/.test(h.klassen)) continue;
		const klassen = h.klassen.split(/\s+/);
		if (klassen.some((k) => Object.prototype.hasOwnProperty.call(AUSNAHMEN, k))) continue;
		unerklaert.push(h.klassen.split(/\s+/).slice(0, 2).join(" ") + "   (" + h.datei.split(/[\/]/).pop() + ")");
	}
	assert.deepStrictEqual(unerklaert, [],
		"Fenster, die weder am Bauteil haengen noch als Ausnahme begruendet sind:\n   "
		+ unerklaert.join("\n   "));
	console.log("OK -- " + huellen.length + " Fensterhuellen, "
		+ (huellen.length - huellen.filter((h) => !/\bavm-fenster\b/.test(h.klassen)).length)
		+ " am Bauteil, " + huellen.filter((h) => !/\bavm-fenster\b/.test(h.klassen)).length + " begruendete Ausnahmen");
}
