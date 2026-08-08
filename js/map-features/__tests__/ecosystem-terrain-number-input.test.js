// 🔴 Das Zahlenfeld der Geländeregler darf sich beim Tippen NICHT selbst überschreiben.
//
// Fall #65 (Thomas, 07.08.2026): „Bei der Maximalhöhe lässt sich händisch keine Zahl eintragen, es
// geht nur über die Pfeiltasten." An der Live-Seite nachgestellt: wer „3500" tippte, hatte danach
// „000" im Feld und 0 im Regler.
//
// 💣 DIE URSACHE IST DER UMWEG ÜBER DEN REGLER. Das Zahlenfeld schreibt seinen Wert in den
// `input[type=range]` daneben -- und ein Range-Element RUNDET seinen `value` sofort auf seine
// Schrittweite (bei beiden Höhen 50). Dessen `input`-Handler ruft `syncTerrainOutput`, und das schrieb
// die gerundete Zahl zurück in genau das Feld, in dem gerade getippt wurde: aus „3" wurde „0", aus
// „35" wurde „50". Die Pfeiltasten treffen die Schrittweite immer -- deshalb ging nur der eine Weg.
//
// Der Vergleich „nur schreiben, wenn der Wert sich unterscheidet" stand schon da und war als genau
// dieser Schutz gemeint. Er trägt nur, solange der Rückweg verlustfrei ist; mit einem Schrittraster
// unterscheidet er sich fast immer. Deshalb prüft dieser Test den Riegel, der wirklich trägt: das
// Feld mit dem Fokus wird nie beschrieben, und die Schrittweite wird beim Verlassen nachgeholt.
//
// 💣 WARUM ALS QUELLTEXT-PRÜFUNG: `map-features-ecosystem-properties.js` ist ein Browser-Global-Skript
// ohne Export; `syncTerrainOutput` und die Verdrahtung leben in einer IIFE und brauchen ein `document`
// samt Dialog-Markup. Es gibt hier weder jsdom noch einen Runner. Bewiesen wurde der Fix am echten
// Modul im Browser (tippen → 3500, blur → 3501 wird 3500); dieser Test hält die zwei Zeilen fest,
// die es tragen.
//
// 🪤 Kommentare werden VORHER entfernt: diese Regel wird im Modul selbst ausführlich begründet, und
// eine Prüfung auf den blossen Bezeichner schlüge auf die Prosa an statt auf den Code.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/ecosystem-terrain-number-input.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const QUELLE = path.join(__dirname, "..", "map-features-ecosystem-properties.js");

function code(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
}

/**
 * Die `if`-Bedingung, die unmittelbar vor `stelle` geöffnet wird. Klammern werden ausgezählt, weil
 * die echte Bedingung selbst welche enthält (`Number(feldnummer.value) !== Number(zahl)`) -- ein
 * `[^)]*`-Ausdruck bräche mitten drin ab und prüfte danach die falsche Zeichenkette.
 */
function bedingungVor(body, stelle) {
	const beginn = body.lastIndexOf("if (", stelle);
	if (beginn === -1) {
		return null;
	}
	let tiefe = 0;
	for (let i = beginn + 3; i < stelle; i += 1) {
		if (body[i] === "(") {
			tiefe += 1;
		} else if (body[i] === ")") {
			tiefe -= 1;
			if (tiefe === 0) {
				return body.slice(beginn + 4, i);
			}
		}
	}
	return null;
}

function befunde(quelltext) {
	const body = code(quelltext);
	const probleme = [];

	// 1. Das Rückschreiben ins Zahlenfeld -- genau eine Stelle, sonst ist die Regel schon geteilt.
	const treffer = [...body.matchAll(/feldnummer\.value = zahl;/g)];
	if (treffer.length !== 1) {
		probleme.push(`Rueckschreiben ${treffer.length}x statt 1x`);
	} else {
		const bedingung = bedingungVor(body, treffer[0].index);
		if (!bedingung) {
			probleme.push("Rueckschreiben steht in keiner if-Bedingung");
		} else if (!/feldnummer\s*!==\s*document\.activeElement/.test(bedingung)) {
			probleme.push("Riegel fehlt: das Feld mit dem Fokus wird beschrieben");
		}
	}

	// 2. Der Nachhol-Griff beim Verlassen. Ohne ihn bliebe eine getippte 3501 stehen, während Regler,
	//    Vorschau und Speicherung 3500 meinen -- zwei sichtbare Wahrheiten.
	const blur = body.indexOf('addEventListener("blur"');
	if (blur === -1) {
		probleme.push("kein blur-Handler am Zahlenfeld");
	} else {
		const rumpf = body.slice(blur, blur + 500);
		if (!/feldnummer\.value = Number\(regler\.value\)\.toFixed\(feld\.decimals\)/.test(rumpf)) {
			probleme.push("blur-Handler holt die geltende Zahl nicht aus dem Regler");
		}
	}
	return probleme;
}

const quelltext = fs.readFileSync(QUELLE, "utf8");

// --- Der Ist-Zustand ------------------------------------------------------------------------------
assert.deepStrictEqual(befunde(quelltext), [], "Der Riegel gegen das Selbstueberschreiben fehlt");

// --- 🪤 Und der Test muss beissen -----------------------------------------------------------------
// Beide Zeilen sehen wie eine Aufraeumung aus ("der Vergleich reicht doch", "wozu ein blur-Handler").
// Ohne diese Gegenprobe waere nicht belegt, dass der Test ihr Verschwinden ueberhaupt bemerkt.
const mutationen = [
	{
		name: "Riegel entfernt",
		text: quelltext.replace("feldnummer !== document.activeElement && ", ""),
	},
	{
		name: "blur-Handler entfernt",
		text: quelltext.replace('propertiesElement(feld.element + "-num")?.addEventListener("blur"', "const tot = ((x) => x)"),
	},
	{
		name: "Riegel nur noch im Kommentar",
		text: quelltext.replace(
			"feldnummer !== document.activeElement &&",
			"/* feldnummer !== document.activeElement && */"),
	},
];

mutationen.forEach((mutation) => {
	assert.notStrictEqual(mutation.text, quelltext, `Mutation "${mutation.name}" hat nichts veraendert`);
	assert.ok(
		befunde(mutation.text).length > 0,
		`Mutation "${mutation.name}" blieb gruen -- der Test prueft sie nicht`);
});

console.log("ok - ecosystem-terrain-number-input (" + mutationen.length + " Mutationen rot)");
