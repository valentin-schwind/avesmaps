// Der Wiki-Override im LANDSCHAFTS-EDITOR -- und dieser Test FUEHRT den Zeichner AUS, statt ihn zu
// lesen.
//
// 💣 WARUM ES IHN GIBT. Am 22.08.2026 ging der Zeichner live mit einem `abgeleitet`, das es in
// seiner Funktion gar nicht gab: die Variable gehoert `regionEditBlock` (dem Markup-Bauer), der
// Zeichner steht in `wireEditBlocks`. Ein ReferenceError -- der aus `laden` herausfiel und den
// Zuweisungskasten mit „der Stand konnte nicht gelesen werden" abwuergte.
//
// 🪤 UND ER WAR UNSICHTBAR, WEIL DIE ZEILE HINTER EINEM `return` LAG: `if (!s || !s.abweicht)
// { return; }`. Ein Gebiet, dessen Wert mit dem Wiki uebereinstimmt, erreichte sie nie -- und das
// sind fast alle. Der Owner fand ihn beim ERSTEN Gebiet mit echter Abweichung („Adrak", Schlucht
// gegen Insel), waehrend das ganze Testfeld gruen war.
//
// 🔴 DIE LEHRE, DIE DIESER TEST FESTHAELT: die vier Wachtests des Umbaus pruefen VERDRAHTUNG --
// laedt jemand die Datei, haengt der Zeichner an einem Zuhoerer, steht der Schluessel im Rumpf.
// Kein einziger hat den Zeichner je LAUFEN LASSEN, und schon gar nicht auf dem Zweig, um den es
// geht. Eine Verdrahtung zu pruefen ist billig; sie ersetzt das Ausfuehren nicht.
//
// Geprueft wird der ECHTE Quelltext aus html/landschaften-editor.html -- der inline-Skriptblock
// wird herausgeschnitten und in einem vm-Sandkasten ausgefuehrt (dieselbe Bauform wie
// js/pages/__tests__/ort-wiki-override-form.test.js). Nachgebaut hiesse: die Probe prueft die Probe.
//
// Run: node js/pages/__tests__/landschaft-wiki-override-zeichner.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR = "html/landschaften-editor.html";
const quelle = fs.readFileSync(path.join(wurzel, EDITOR), "utf8");

let checks = 0;

// ---- Den Zeichner aus der echten Datei schneiden ----------------------------------------------
// ⚠️ Von seiner Deklaration bis zu der des naechsten Geschwisters. Faellt der Schnitt aus, ist der
// Test rot -- lieber das, als stillschweigend nichts zu pruefen.

const von = quelle.indexOf("const zeichneWikiAbweichungen = () => {");
assert.ok(von !== -1, EDITOR + ": `zeichneWikiAbweichungen` steht nicht mehr da -- wurde der "
	+ "Zeichner umbenannt, gehoert dieser Test nachgezogen.");
checks++;
const bis = quelle.indexOf("const wikiFeldZuruecksetzen", von);
assert.ok(bis > von, EDITOR + ": das Ende des Zeichners ist nicht mehr zu finden.");
checks++;
const zeichnerQuelle = quelle.slice(von, bis);

// ---- Ein Sandkasten mit GENAU dem, was in `wireEditBlocks` wirklich in Reichweite ist ----------
// 🔴 DAS IST DER KERN DIESER PROBE: was hier nicht steht, steht dem Zeichner auch live nicht zur
// Verfuegung. Greift er auf etwas zu, das nur `regionEditBlock` kennt, wirft der Sandkasten
// denselben ReferenceError wie der Browser -- und genau der ist die Zusicherung.

function zelleSchein(feld) {
	const kinder = [];
	const klassen = new Set();
	const elternKlassen = new Set();
	return {
		kinder,
		klassen,
		elternKlassen,
		getAttribute: (name) => (name === "data-wiki-alt" ? feld : null),
		replaceChildren: () => { kinder.length = 0; },
		append: (...neue) => { kinder.push(...neue); },
		parentElement: {
			classList: {
				toggle: (name, an) => { if (an) { elternKlassen.add(name); } else { elternKlassen.delete(name); } },
			},
		},
	};
}

function lauf({ kartenName, kartenArt, wikiName, wikiArt, herkunft, kind }) {
	const zellen = [zelleSchein("name"), zelleSchein("region_type")];
	const felder = {
		name: { value: kartenName },
		type: { value: kartenArt, options: [{ value: "wald", textContent: "Wald" }, { value: "schlucht", textContent: "Schlucht" }] },
	};
	const kasten = {
		console,
		// Die echten reinen Rechner -- nicht gestubbt, sonst prueft die Probe ihre eigenen Stubs.
		document: { createElement: () => ({ classList: { toggle() {} }, addEventListener() {} }) },
		// Was `wireEditBlocks` seinem Zeichner wirklich bereitstellt:
		field: (name) => felder[name],
		block: { querySelectorAll: () => zellen },
		region: { kind: kind, field_origins: herkunft || null },
		wikiArtBeschriftungen: () => ({ wald: "Wald", schlucht: "Schlucht" }),
		// ⚠️ `landschaftsart` ist ein SCHLUESSEL („wald"), keine Beschriftung („Wald") -- so liefert es
		// avesmapsWikiAssignLandschaftWerte, und genau daran ist der erste Entwurf dieser Probe
		// gescheitert: mit der Beschriftung wich das gleiche Gebiet scheinbar ab.
		letzterWikiArtikel: { werte: { name: wikiName, landschaftsart: wikiArt } },
		wikiFeldZuruecksetzen: () => {},
	};
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	// Die reinen Bibliotheken echt hineinladen.
	for (const datei of ["js/ui/wiki-assign-registry.js", "js/ui/wiki-feld-herkunft.js", "js/ui/wiki-assign-landschaft.js"]) {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	}
	vm.runInContext(zeichnerQuelle + "\nzeichneWikiAbweichungen();", kasten, { filename: "zeichner" });

	return zellen;
}

// ---- 1) 💣 DER FALL, DER LIVE GEBROCHEN IST: ein Gebiet MIT Abweichung ------------------------
// „Adrak": auf der Karte eine Schlucht, im Wiki eine Insel. Genau hier lief der Zeichner in den
// ReferenceError -- und genau hier faellt jede kuenftige Variable auf, die er nicht kennt.
const abweichend = lauf({
	kartenName: "Adrak", kartenArt: "schlucht",
	wikiName: "Adrak", wikiArt: "wald",
	herkunft: null, kind: "topographie",
});
assert.strictEqual(abweichend[1].kinder.length, 2,
	"die Art-Zelle traegt nicht durchgestrichenen Wert PLUS ↺, sondern "
	+ abweichend[1].kinder.length + " Kind(er) -- der Zeichner ist bei der Abweichung ausgestiegen.");
checks++;
assert.strictEqual(abweichend[0].kinder.length, 0,
	"die Namenszelle traegt etwas, obwohl der Name mit dem Wiki uebereinstimmt.");
checks++;

// ---- 2) Der unauffaellige Fall bleibt still ---------------------------------------------------
// ⚠️ Diese Zusicherung allein war es, die den Fehler zugedeckt hat: sie erreicht die kaputte Zeile
// nie. Sie steht hier trotzdem -- aber NIE ALLEIN.
const gleich = lauf({
	kartenName: "Bärenforst", kartenArt: "wald",
	wikiName: "Bärenforst", wikiArt: "wald",
	herkunft: null, kind: "vegetation",
});
assert.strictEqual(gleich[0].kinder.length + gleich[1].kinder.length, 0,
	"ohne Abweichung darf nichts gezeichnet werden.");
checks++;

// ---- 3) „Von uns gesetzt" faerbt die Beschriftung, sonst nichts ------------------------------
// 🔴 ZWEI sichtbare Zustaende, nicht vier: braun heisst `herkunft === "manual"`, `wiki` wird
// mitgeschrieben und NICHT angezeigt.
const vonUns = lauf({
	kartenName: "Adrak", kartenArt: "schlucht",
	wikiName: "Adrak", wikiArt: "wald",
	herkunft: { region_type: "manual" }, kind: "topographie",
});
assert.ok(vonUns[1].elternKlassen.has("ovr"),
	"eine von uns gesetzte Art faerbt die Beschriftung nicht (Klasse `ovr` fehlt).");
checks++;
const ausWiki = lauf({
	kartenName: "Adrak", kartenArt: "schlucht",
	wikiName: "Adrak", wikiArt: "wald",
	herkunft: { region_type: "wiki" }, kind: "topographie",
});
assert.ok(!ausWiki[1].elternKlassen.has("ovr"),
	"`herkunft: wiki` faerbt die Beschriftung -- sie wird mitgeschrieben, aber nicht angezeigt.");
checks++;

// ---- 4) 🔴 KEIN ↺ AUF DER GESPERRTEN ART EINER KLIMAZONE --------------------------------------
// Der Server lehnt die Aenderung ab (avesmapsClimateAssertNotDerived); ein Knopf dorthin fuehrte in
// eine Ablehnung. Der durchgestrichene Stand bleibt -- er ist eine Auskunft, kein Angebot.
const klima = lauf({
	kartenName: "Gemäßigt", kartenArt: "schlucht",
	wikiName: "Gemäßigt", wikiArt: "wald",
	herkunft: null, kind: "klima",
});
assert.strictEqual(klima[1].kinder.length, 1,
	"bei einer Klimazone steht neben dem durchgestrichenen Wert ein ↺ -- der Server lehnt die "
	+ "Aenderung ab, der Knopf fuehrte also in eine Ablehnung.");
checks++;

console.log("OK — der Zeichner der Landschaft laeuft wirklich, auch auf dem Zweig mit Abweichung ("
	+ checks + " Zusicherungen).");
