"use strict";
// Der Kasten „Wiki-Weg" der GANZEN Strasse zeigt eine Zeile je Hauptzuweisung (Owner 15.09.2026: „bearbeiten der ganzen straße:
// zeigt mir wiki-zuweisungen per segmente an", gewaehlt „Gleiche zusammenfassen" + „Je Zeile bearbeitbar"). Hier die REINE Regel
// (wpGruppeZuweisungsZeilen) und die kompakte Nummernzeile (wpAbschnittNummernText) -- dieselben fuer Wege-Editor und Kartendialog.
// Aus der Wurzel: node js/pages/__tests__/wege-gruppe-zuweisungszeilen.test.js
const assert = require("assert");
const path = require("path");
const M = require(path.join(__dirname, "..", "wege-editor-model.js"));

assert.strictEqual(typeof M.wpGruppeZuweisungsZeilen, "function", "die Zeilenregel steht im Modell");
assert.strictEqual(typeof M.wpAbschnittNummernText, "function", "die Nummernzeile steht im Modell");

// ---- 1. Die kompakte Nummernzeile ----------------------------------------------------------------------------------
assert.strictEqual(M.wpAbschnittNummernText([]), "", "ohne Nummern keine Zeile");
assert.strictEqual(M.wpAbschnittNummernText(null), "");
assert.strictEqual(M.wpAbschnittNummernText([5]), "Abschnitt 5");
assert.strictEqual(M.wpAbschnittNummernText([3, 1, 2, 5, 7, 8, 9]), "Abschnitt 1–3, 5, 7–9", "Bereiche und Einzelne, aufsteigend");
assert.strictEqual(M.wpAbschnittNummernText([2, 2, "x", 0, -1, 1.5, 3]), "Abschnitt 2–3", "Dubletten und Unsinn fallen heraus");
assert.strictEqual(M.wpAbschnittNummernText([1, 3, 5, 7, 9, 11, 13, 15]), "Abschnitt 1, 3, 5, 7, 9, 11, 13, 15", "acht Bereiche stehen ganz da");
assert.strictEqual(M.wpAbschnittNummernText([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), "Abschnitt 1, 3, 5, 7, 9, 11, 13, 15, …",
	"ab dem neunten Bereich gekappt -- auch eine lange Strasse bleibt kurz");

// ---- 2. Reichsstraße 2 wie live: 49 Abschnitte mit Artikel, 18 ohne, dazwischen verteilt ----------------------------------
const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/RS2" };
const BAER = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const ohneNummern = new Set([2, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 63, 64, 65, 66, 67]);
const segmente = [];
for (let nr = 1; nr <= 67; nr++) {
	segmente.push({
		public_id: "rs-" + nr,
		wiki_path: ohneNummern.has(nr) ? null : RS2,
		// Die Abschnitte 3-5 (mit Artikel) und 2 (ohne) tragen den Bärenpfad als weitere Zuweisung; Abschnitt 4 zweimal (Dublette).
		wiki_path_weitere: nr === 4 ? [BAER, BAER] : ([2, 3, 5].includes(nr) ? [BAER] : []),
	});
}
const zeilen = M.wpGruppeZuweisungsZeilen(segmente);
assert.strictEqual(zeilen.length, 2, "gemischte Strasse: zwei Zeilen");
const [mit, keine] = zeilen;
assert.strictEqual(mit.wiki_key, "reichsstrasse-2");
assert.strictEqual(mit.name, "Reichsstraße 2");
assert.strictEqual(mit.wiki_url, "https://x/RS2");
assert.strictEqual(mit.public_ids.length, 49);
assert.strictEqual(mit.public_ids[0], "rs-1", "in der Reihenfolge der Strasse");
assert.deepStrictEqual([...mit.nummern].slice(0, 4), [1, 3, 4, 5]);
assert.strictEqual(M.wpAbschnittNummernText(mit.nummern), "Abschnitt 1, 3–17, 19, 31–62");
assert.deepStrictEqual(mit.weitere.map((w) => [w.wiki_key, w.name, w.anzahl, [...w.public_ids]]),
	[["b-renpfad", "Bärenpfad", 3, ["rs-3", "rs-4", "rs-5"]]], "weitere mit Anzahl -- eine Dublette am Abschnitt zaehlt einmal");
assert.strictEqual(mit.weitere[0].wiki_url, "https://x/B");
assert.strictEqual(keine.wiki_key, "", "die Zeile „keine“ zuletzt");
assert.strictEqual(keine.name, "");
assert.strictEqual(keine.public_ids.length, 18);
assert.strictEqual(M.wpAbschnittNummernText(keine.nummern), "Abschnitt 2, 18, 20–30, 63–67");
assert.deepStrictEqual(keine.weitere.map((w) => [w.wiki_key, w.anzahl]), [["b-renpfad", 1]], "auch ohne Hauptzuweisung stehen weitere da");

// ---- 3. Reihenfolge: nach Anzahl absteigend, dann alphabetisch, „keine" immer zuletzt ------------------------------------
const art = (key, name) => ({ wiki_key: key, name, wiki_url: "" });
const bunt = [
	{ public_id: "a", wiki_path: art("zeta", "Zeta") },
	{ public_id: "b", wiki_path: null },
	{ public_id: "c", wiki_path: art("beta", "Beta") },
	{ public_id: "d", wiki_path: art("alpha", "Alpha") },
	{ public_id: "e", wiki_path: null },
	{ public_id: "f", wiki_path: art("beta", "Beta") },
	{ public_id: "g", wiki_path: { wiki_key: "" } },
	{ public_id: "h", wiki_path: art("zeta", "Zeta") },
	{ public_id: "i", wiki_path: art("beta", "Beta") },
	{ public_id: "j", wiki_path: art("alpha", "Alpha") },
	{ public_id: "k", wiki_path: art("ohne-name", "") },
];
const reihe = M.wpGruppeZuweisungsZeilen(bunt);
assert.deepStrictEqual(reihe.map((z) => z.wiki_key), ["beta", "alpha", "zeta", "ohne-name", ""],
	"3× Beta, dann Alpha und Zeta (je 2) alphabetisch, dann die eine, „keine“ trotz drei Abschnitten zuletzt");
assert.strictEqual(reihe[3].name, "ohne-name", "ohne Artikelnamen steht der Schluessel da, nie eine leere Zeile");
assert.deepStrictEqual([...reihe[4].public_ids], ["b", "e", "g"], "ein leerer Schluessel ist „keine“");
assert.deepStrictEqual([...reihe[0].nummern], [3, 6, 9], "ohne Nummernleser: die Stelle in der Strasse");

// ---- 4. Die Nummern kann der Wirt liefern (Wege-Editor: gerechnet ueber ALLE Wege, nicht die gefilterte Liste) ----------
const gezaehlt = M.wpGruppeZuweisungsZeilen([{ public_id: "x", wiki_path: null }, { public_id: "y", wiki_path: null }],
	(segment, index) => (segment.public_id === "x" ? 7 : 12 + index));
assert.deepStrictEqual([...gezaehlt[0].nummern], [7, 13]);

// ---- 5. Randfaelle ------------------------------------------------------------------------------------------------------
assert.deepStrictEqual(M.wpGruppeZuweisungsZeilen([]), []);
assert.deepStrictEqual(M.wpGruppeZuweisungsZeilen(null), []);
const einig = M.wpGruppeZuweisungsZeilen([{ public_id: "p", wiki_path: RS2 }, null, { public_id: "q", wiki_path: RS2 }]);
assert.strictEqual(einig.length, 1, "eine einige Strasse: EINE Zeile");
assert.deepStrictEqual([...einig[0].nummern], [1, 3], "ein fehlender Eintrag verschiebt die Nummern nicht");

console.log("wege-gruppe-zuweisungszeilen.test.js: ok");
