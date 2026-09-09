"use strict";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// AUTOMATISCHE SILBENTRENNUNG GEHOERT DEM FLIESSTEXT, NIE EINEM NAMEN.
//
// Fall #119 (Discord, 09.09.2026, Martin Wr, mit Bild): „mit der deutschen Rechtschreibung
// (Trennungen) haben´s die Herrschaften nicht so, oder? 🙂 (Blu-totter, Boron-säffchen, etc)".
//
// 💣 DER BROWSER TRENNT NACH MUSTERN, NICHT NACH WORTBILDUNG. „Blutotter" ist Blut+Otter und
//    wurde „Blu-totter", „Boronsäffchen" ist Borons+Äffchen und wurde „Boron-säffchen". Beides
//    sind erfundene Komposita -- kein Trennwoerterbuch kennt ihre Fuge, also ist JEDE Trennung an
//    einem Aventurien-Namen geraten. `lang="de"` (ueberall gesetzt) macht sie nicht richtiger,
//    sondern erst moeglich.
//
// 🔴 UND EIN FALSCHER STRICH IN EINEM NAMEN IST KEINE SCHOENHEITSFRAGE -- er macht daraus ein
//    anderes Wort. Deshalb ist die Grenze nicht „Fliesstext gegen Liste", sondern „unsere eigenen
//    deutschen Saetze gegen Aventurien-Namen": eine Flaeche, die Namen zeigt, trennt gar nicht.
//
// ⭐ WAS DIESER TEST WIRKLICH FAENGT: nicht die eine Regel, die heute repariert wurde, sondern die
//    NAECHSTE. Er zaehlt `hyphens: auto` REPOWEIT und haelt den Fund gegen eine ausgeschriebene
//    Liste -- wer die Zeile an eine neue Flaeche schreibt, muss sie hier eintragen und dabei
//    begruenden, dass dort keine Namen stehen.
//
// 🪤 KOMMENTARE RAUS, BEVOR IRGENDETWAS GESUCHT WIRD. Genau die zwei Blaetter, die die Falle
//    erklaeren, schreiben `hyphens: auto` im Klartext in ihren Kommentar -- ein Test, der den
//    Quelltext ungefiltert liest, schlaegt an der Warnung an, die vor dem Muster warnt.
//
// 🪤 HIER NICHT MESSBAR: dieses Chrome bringt kein deutsches Trennwoerterbuch mit (gemessen
//    09.09.2026 -- „Blutotter" in einem 78px-Kasten bricht mit `hyphens: auto` zeichengleich wie
//    mit `manual`). Ein Ablauf-Test im Browser kann den Fall auf diesem Rechner also gar nicht
//    zeigen; deshalb wird die REGEL am Blatt festgenagelt, nicht ihr Bild.
//
// Lauf: node js/ui/__tests__/keine-auto-silbentrennung.test.js
// ═══════════════════════════════════════════════════════════════════════════════════════════

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");

// ⚠️ Zeilenendenneutral: die Arbeitskopie kann CRLF tragen, das Deploy-Tor legt LF hin.
const lies = (datei) => fs.readFileSync(datei, "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function alleBlaetter(verzeichnis) {
	const gefunden = [];
	for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			gefunden.push(...alleBlaetter(voll));
		} else if (eintrag.name.endsWith(".css")) {
			gefunden.push(voll);
		}
	}
	return gefunden;
}

/** Selektor + Rumpf jeder Regel eines Blatts (Kommentare sind vorher gefallen). */
function regeln(css) {
	const gefunden = [];
	const muster = /([^{}]+)\{([^{}]*)\}/g;
	let treffer;
	while ((treffer = muster.exec(css)) !== null) {
		gefunden.push({
			selektor: treffer[1].replace(/\s+/g, " ").trim(),
			rumpf: treffer[2],
		});
	}
	return gefunden;
}

const blaetter = alleBlaetter(path.join(WURZEL, "css"));
assert.ok(blaetter.length > 30, "die Blattsuche findet das Verzeichnis css/ nicht");

// ---- 1. Wer trennt automatisch? Repoweit gezaehlt --------------------------------------------
//
// 🔴 DIE LISTE IST DIE ENTSCHEIDUNG, NICHT DER BEFUND. Hier stehen die Flaechen, auf denen
//    UNSERE EIGENEN deutschen Saetze stehen -- keine Ortsnamen, keine Vorkommen, keine
//    Wiki-Titel. Dort ist die Trennung richtig und hilft dem Umbruch.
const ERLAUBT = new Map([
	[".location-popup__description",
		"Die Beschreibung eines Ortes -- der einzige echte Fliesstext der Kartenflaeche. "
		+ "Entscheid von `72028e8` am selben Tag, hier uebernommen."],
	[".changelog-entry__text",
		"„Neuigkeiten\": unsere eigenen Meilenstein-Saetze. Gewoehnliches Deutsch, kein Bestiarium."],
	[".ecosystem-transfer-dialog__source",
		"Erklaerzeile im Uebertragen-Dialog (Editor)."],
	[".ecosystem-transfer-dialog__note",
		"Erklaer- und Warnzeile im Uebertragen-Dialog (Editor)."],
]);

const trennen = [];
for (const datei of blaetter) {
	for (const regel of regeln(ohneKommentare(lies(datei)))) {
		if (/(^|[^-\w])(?:-webkit-)?hyphens\s*:\s*auto/.test(regel.rumpf)) {
			for (const einzeln of regel.selektor.split(",").map((s) => s.trim()).filter(Boolean)) {
				trennen.push({ selektor: einzeln, datei: path.relative(WURZEL, datei) });
			}
		}
	}
}

for (const fund of trennen) {
	assert.ok(
		ERLAUBT.has(fund.selektor),
		"Neue automatische Silbentrennung an `" + fund.selektor + "` (" + fund.datei + "). "
		+ "Zeigt diese Flaeche einen Aventurien-Namen, gehoert dort `hyphens: manual` hin "
		+ "(Fall #119). Ist es wirklich unser eigener deutscher Fliesstext, trag den Selektor "
		+ "oben in ERLAUBT ein -- mit Begruendung."
	);
}

// Die Gegenrichtung: ein Eintrag, den niemand mehr benutzt, verschweigt eine Aufraeumung.
for (const selektor of ERLAUBT.keys()) {
	assert.ok(
		trennen.some((f) => f.selektor === selektor),
		"`" + selektor + "` steht in ERLAUBT, trennt aber nirgends mehr -- Eintrag entfernen."
	);
}

// ---- 2. Die gemeldete Flaeche: Popup, Infopanel und schlanke Box -----------------------------
//
// 💣 `.region-info-box__row dd` IST DAS HAUSFORMAT JEDER INFOBOX-WERTZEILE -- Vorkommen,
//    „Fuehrt durch", Kraftlinien, „Was ist hier?", Reiseplan. Ueber diese eine Zeile lief die
//    Meldung, und ueber sie laufen alle Geschwister mit.
const popupCss = ohneKommentare(lies(path.join(WURZEL, "css/features/location-popups-markers.css")));
const popupRegel = regeln(popupCss).find((r) => r.selektor.includes(".region-info-box__row dd"));
assert.ok(popupRegel, "die geteilte Umbruch-Regel der Infobox-Flaeche fehlt");

for (const muss of [
	".location-popup__name",
	".location-popup__type",
	".location-popup__breadcrumb-link",
	".region-info-box__title",
	".region-info-box__subtitle",
	".region-info-box__row dd",
]) {
	assert.ok(
		popupRegel.selektor.includes(muss),
		"`" + muss + "` faellt aus der geteilten Umbruch-Regel heraus -- dann trennt es wieder "
		+ "nach der Vorgabe seines Elternteils."
	);
}

assert.ok(
	/(^|[^-\w])hyphens\s*:\s*manual/.test(popupRegel.rumpf),
	"🔴 `hyphens: manual` steht ausgeschrieben, statt die Zeile nur zu loeschen: `hyphens` vererbt "
	+ "sich, und der geschriebene Wert sagt der naechsten Aenderung, dass hier entschieden wurde."
);
assert.ok(
	/(^|[^-\w])-webkit-hyphens\s*:\s*manual/.test(popupRegel.rumpf),
	"das `-webkit-`-Geschwister fehlt -- aeltere Safari lesen nur dieses."
);

// ⭐ DAS NETZ MUSS BLEIBEN. `overflow-wrap: break-word` bricht nur ein Wort, das BREITER ist als
//    sein Kasten, und setzt dabei keinen Strich -- es behauptet also nie eine Silbengrenze. Faellt
//    es mit der Trennung zusammen weg, laeuft ein langer Name aus der Box statt falsch zu trennen:
//    ein zweiter Fehler als Antwort auf den ersten.
assert.ok(
	/overflow-wrap\s*:\s*break-word/.test(popupRegel.rumpf),
	"das Netz `overflow-wrap: break-word` ist mit der Trennung verschwunden"
);

// ---- 3. Der Garetien-Importer: derselbe Fehler an einem NAMEN --------------------------------
//
// 💣 EINE REGEL, DIE EINEN VON ZWEI ERZEUGERN BINDET, IST KEINE REGEL. `.gi-detail__name` zeigt
//    den Wiki-Seitennamen eines Importobjekts („Zwergenbinge Xorlosch") und trennte automatisch.
const importerCss = ohneKommentare(lies(path.join(WURZEL, "css/components/garetien-importer.css")));
const nameRegel = regeln(importerCss).find((r) => r.selektor === ".gi-detail__name");
assert.ok(nameRegel, ".gi-detail__name fehlt");
assert.ok(
	/(^|[^-\w])hyphens\s*:\s*manual/.test(nameRegel.rumpf),
	"der Name des Garetien-Importers trennt wieder automatisch (Fall #119)"
);
// ⚠️ Getragen hat den Umbruch dort ohnehin `min-width: 0`, nicht die Trennung -- die Zeile ist die
//    tragende und darf beim Aufraeumen nicht mit verschwinden.
assert.ok(/min-width\s*:\s*0/.test(nameRegel.rumpf), "`min-width: 0` traegt den Umbruch dort");
assert.ok(/overflow-wrap\s*:\s*break-word/.test(nameRegel.rumpf), "das Netz fehlt");

console.log("keine-auto-silbentrennung: ok (" + trennen.length + " erlaubte Trennstellen, "
	+ blaetter.length + " Blaetter geprueft)");
