"use strict";

/**
 * Die Gliederung des Gebirgsabschnitts: drei Gruppen, EIN gefüllter Knopf.
 *
 * 🔴 Owner 05.09.2026: „mach die knopf-rangfolge und die gruppen".
 *
 * 💣 DER FEHLER, DEN DER ERSTE TEIL FESTNAGELT: `ecosystem-properties-dialog__button--main` stand
 * an zwei Knöpfen im Markup und existierte in KEINER CSS-Datei des Projekts. „Höhenfeld erzeugen"
 * sah deshalb aus wie „Auf Automatik zurück" -- drei gleich aussehende Knöpfe, und der Editor
 * musste raten, welcher die Haupthandlung ist. Eine Klasse, die es nicht gibt, wirft keinen Fehler:
 * sie tut einfach nichts, und das sieht man nur, wenn man es weiss. Gefunden von einem Prüfagenten,
 * nicht von einem Test -- deshalb dieser hier.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

let gehalten = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

const markup = lies("index.html");
// Alle Blätter einlesen, nicht nur das eine: eine Knopfregel darf auch woanders stehen.
function allesCss(verzeichnis) {
	let text = "";
	for (const eintrag of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) {
			text += allesCss(rel);
		} else if (eintrag.name.endsWith(".css")) {
			text += lies(rel);
		}
	}

	return text;
}
const css = allesCss("css");

/* ── 1. Keine Knopfklasse, die es gar nicht gibt ─────────────────────────────────────────────── */

pruefe("jeder Knopf-Modifier im Markup hat auch eine Regel im CSS", () => {
	// 🔴 DIE FAMILIE, NICHT NUR DER EINE FALL: geprüft werden ALLE `…__button--x` aus `index.html`.
	// Ein Wächter, der nur `--main` verbietet, fängt den nächsten Tippfehler nicht.
	// ⚠️ Aus dem Markup, nicht aus dem JS: eine Klasse, die erst zur Laufzeit gesetzt wird, steht
	// hier nicht drin und würde fälschlich als tot gelten.
	const modifier = new Set(
		[...markup.matchAll(/class="[^"]*?([a-z-]+__button--[a-z-]+)/g)].map((m) => m[1]));
	assert.ok(modifier.size >= 3, "im Markup stehen kaum Knopf-Modifier -- der Test prüft nichts");
	const tot = [...modifier].filter((klasse) => !css.includes("." + klasse));
	assert.deepStrictEqual(tot, [],
		"diese Klassen stehen am Knopf und in keiner CSS-Regel -- sie tun nichts, ohne dass es "
		+ "irgendwo auffällt: " + tot.join(", "));
});

/* ── 2. Genau EINE Haupthandlung ist gefüllt ─────────────────────────────────────────────────── */

const abschnitt = markup.slice(
	markup.indexOf('id="ecosystem-properties-terrain"'),
	markup.indexOf('id="ecosystem-properties-heightscale"'));

pruefe("im Geländeabschnitt ist genau ein Knopf gefüllt -- und es ist der richtige", () => {
	// 🔴 §12: „the main action is filled, everything else is soft/outline". Zwei gefüllte Knöpfe
	// nebeneinander sind keine Rangfolge, sondern zwei Angebote.
	const gefuellt = [...abschnitt.matchAll(
		/<button id="ecosystem-properties-(terrain-[a-z]+)"[^>]*button--primary/g)].map((m) => m[1]);
	assert.deepStrictEqual(gefuellt, ["terrain-build"],
		"gefüllt sind: " + (gefuellt.join(", ") || "keiner")
		+ " -- gefüllt gehört „Höhenfeld erzeugen\", und sonst nichts");
	// ⚠️ „Gebirgszug ermitteln" ist eine VORBEREITUNG, keine Haupthandlung -- auch wenn er nur
	// erscheint, wenn die Fläche keinen Anhalt hat. Er steht dann NEBEN dem gefüllten Knopf, und
	// zwei gefüllte nebeneinander wären genau der Zustand, den dieser Umbau beseitigt.
	// 🔴 UND ER STEHT ZULETZT. Das Haus ordnet in ZWOELF Aktionsleisten gleich: sekundaer zuerst,
	// gefuellt ganz rechts (`…-cancel` -> `*…-save`, zweimal allein in diesem Fenster). Der erste Bau
	// hatte die Fuellung richtig und die Stelle falsch -- der Knopf stand in der Mitte, und die
	// Position sagte weiter „ich bin es nicht". Gefunden von einem Pruefagenten, nicht von diesem
	// Test.
	const leiste = abschnitt.slice(abschnitt.indexOf('__terrainactions'));
	const reihenfolge = [...leiste.slice(0, leiste.indexOf("</div>")).matchAll(
		/id="ecosystem-properties-(terrain-[a-z]+)"/g)].map((m) => m[1]);
	assert.strictEqual(reihenfolge[reihenfolge.length - 1], "terrain-build",
		"der gefuellte Knopf steht nicht zuletzt, sondern hier: " + reihenfolge.join(" -> "));
	const ridge = abschnitt.slice(abschnitt.indexOf('id="ecosystem-properties-terrain-ridge"'));
	assert.ok(!ridge.slice(0, ridge.indexOf(">")).includes("--primary"),
		"„Gebirgszug ermitteln\" ist gefüllt -- dann stehen zwei Haupthandlungen nebeneinander");
});

/* ── 3. Drei Gruppen, und jeder Regler in genau einer ────────────────────────────────────────── */

const GRUPPEN = {
	"Kamm und Form": ["sattel", "avgheight", "plateau", "bergform", "hypsometrie"],
	"K&ouml;rnung": ["rauschen", "grain", "levels"],
	"Wasser und Erosion": ["talbreite", "einschnitt", "erosion"],
};

pruefe("die elf Regler stehen in drei benannten Gruppen", () => {
	// 💣 GELESEN, NICHT GEZÄHLT: die Reihenfolge im Markup ist die, die der Editor sieht. Eine
	// Gruppierung per CSS `order` wäre für die Tastatur eine andere Reihenfolge als für das Auge.
	const ohneKommentare = abschnitt.replace(/<!--[\s\S]*?-->/g, "");
	const folge = [...ohneKommentare.matchAll(
		/terraingroup">([^<]+)<\/p>|id="ecosystem-properties-([a-z]+)" type="range"/g)];
	const gebaut = {};
	let aktuell = null;
	for (const m of folge) {
		if (m[1]) { aktuell = m[1]; gebaut[aktuell] = []; continue; }
		assert.ok(aktuell, "der Regler `" + m[2] + "` steht vor der ersten Gruppenüberschrift");
		gebaut[aktuell].push(m[2]);
	}
	assert.deepStrictEqual(gebaut, GRUPPEN,
		"die Gruppen weichen von der Bestellung ab (Owner 05.09.2026)");
});

pruefe("die Gruppen trennen mit einer LINIE, nicht mit einem Kasten", () => {
	// 🔴 §12 der Designsprache, wörtlich: „Group by divider (--color-divider line + heading), not by
	// framed boxes". Ein Kasten um jede Gruppe wäre dreimal Rahmen in einem Fenster, das ohnehin
	// schon einen hat.
	const blatt = lies("css/features/ecosystem-layer.css");
	const i = blatt.indexOf(".ecosystem-properties-dialog__terraingroup {");
	assert.ok(i > 0, "die Gruppenüberschrift hat keine Regel");
	const regel = blatt.slice(i, blatt.indexOf("}", i));
	assert.ok(/border-top:\s*1px solid var\(--color-divider\)/.test(regel),
		"die Trennlinie fehlt oder nimmt nicht das Token");
	assert.ok(!/border:\s/.test(regel) && !/border-radius/.test(regel),
		"die Gruppe ist als Kasten gebaut statt als Linie");
	// ⚠️ Und die Aufschrift nimmt dieselben Werte wie jede andere im Haus -- keine vierte Rezeptur.
	// 🔴 `--color-accent-strong`, NICHT `--color-accent-brown`: §12 nennt es fuer „section / card
	// headings", und der Rahmenkasten wurde am 04.09.2026 genau davon korrigiert. Der erste Bau
	// hier hat den Fehler wiederholt, weil sein Kommentar sich auf den Rahmenkasten berief und
	// dessen ALTEN Wert abschrieb. Ebenso die Laufweite: `--letter-spacing-caps` statt einer
	// gegriffenen Zahl.
	assert.ok(/var\(--color-accent-strong\)/.test(regel) && /var\(--font-size-caption\)/.test(regel),
		"die Aufschrift weicht von der Hausform ab (Versalien, caption, accent-strong)");
	assert.ok(/letter-spacing:\s*var\(--letter-spacing-caps\)/.test(regel),
		"die Laufweite ist eine gegriffene Zahl statt des Tokens -- die naechste Variante derselben Rolle");
});

pruefe("die erste Gruppe trägt KEINE Linie", () => {
	// ⚠️ Sie steht direkt unter dem `summary`, und das trägt seine eigene: zwei Linien übereinander
	// lesen sich wie ein leerer Abschnitt dazwischen.
	const blatt = lies("css/features/ecosystem-layer.css");
	const i = blatt.indexOf(".ecosystem-properties-dialog__terraingroup:first-of-type");
	assert.ok(i > 0, "die erste Gruppe bekommt keine Ausnahme -- sie steht mit doppelter Linie da");
	const regel = blatt.slice(i, blatt.indexOf("}", i));
	assert.ok(/border-top:\s*0/.test(regel), "die Ausnahme nimmt die Linie nicht weg");
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
