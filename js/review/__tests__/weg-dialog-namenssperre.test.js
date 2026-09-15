"use strict";
// Die Namenssperre im Kartendialog „Weg bearbeiten" fuer die GANZE Strasse gehoert der STRASSE, nicht dem angeklickten Abschnitt.
// Befund der Pruefung zu Lieferung 1 (15.09.2026): seit die Strasse der Name ist, kann sie gemischte Hauptzuweisungen tragen.
// Klick auf einen der 18 unzugewiesenen Abschnitte der Reichsstraße 2, dann „Weg bearbeiten" -- das Namensfeld stand offen, ein
// Umbenennen haette nur die 18 umbenannt (die 49 zugewiesenen behaelt der Server nach R1), und die Strasse waere zerfallen.
// Dieselbe Regel wie auf der Weg-Ebene des Wege-Editors: gesperrt, sobald IRGENDEIN Abschnitt eine Hauptzuweisung traegt.
// AUSGEFUEHRT: syncPathAutoNameControls (review-paths.js) und pathWikiCurrentAssignment/pathWikiCanonicalName
// (review-path-wiki.js) aus dem Quelltext geschnitten und gegen eine Formular-Attrappe gefahren.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-namenssperre.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	const a = text.indexOf("\nfunction " + name + "(");
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const W = require(path.join(WURZEL, "js/ui/wiki-assign-weg.js"));

const feld = (werte) => Object.assign({ value: "", readOnly: false, disabled: false, checked: false }, werte || {});
const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };
const pfad = (id, wiki) => ({ properties: { public_id: id, display_name: "Reichsstraße 2", wiki_path: wiki } });
const rs6 = pfad("rs-6", RS2);
const rs7 = pfad("rs-7", null);
const rs8 = pfad("rs-8", RS2);

function lauf(stand) {
	const elemente = {
		"path-edit-name": feld({ value: stand.name }),
		"path-edit-type": feld({ value: "Reichsstrasse" }),
		"path-edit-autoname": feld({ checked: stand.autoname === true }),
	};
	const kontext = vm.createContext({
		document: { getElementById: (id) => elemente[id] || null },
		pathEditFeature: stand.feature,
		pathEditGruppe: stand.gruppe,
		wpGruppeHauptzuweisungen: M.wpGruppeHauptzuweisungen,
		avesmapsWikiAssignWegKanonischerName: W.avesmapsWikiAssignWegKanonischerName,
		normalizePathSubtype: (wert) => String(wert || "Weg"),
		getNextPathDisplayName: () => "Reichsstrasse-99",
	});
	vm.runInContext(funktion(lies("js/review/review-path-wiki.js"), "pathWikiCurrentAssignment")
		+ funktion(lies("js/review/review-path-wiki.js"), "pathWikiCanonicalName")
		+ funktion(lies("js/review/review-paths.js"), "syncPathAutoNameControls"), kontext);
	vm.runInContext("syncPathAutoNameControls()", kontext);
	return { name: elemente["path-edit-name"], autoname: elemente["path-edit-autoname"] };
}

// 1. Der Befund: ganze Strasse, angeklickt ist ein Abschnitt OHNE Zuweisung, seine Nachbarn tragen eine.
const befund = lauf({ feature: rs7, gruppe: { pfade: [rs6, rs7, rs8] }, name: "Reichsstraße 2" });
assert.strictEqual(befund.name.readOnly, true, "das Namensfeld ist gesperrt, obwohl der angeklickte Abschnitt keine Zuweisung traegt");
assert.strictEqual(befund.autoname.disabled, true, "und der Auto-Name ebenso");
assert.strictEqual(befund.name.value, "Reichsstraße 2", "der Wert bleibt, was der Dialog hineinschrieb");

// 2. Eine uneinige Strasse bleibt „gemischt": die Sperre schreibt keinen Artikelnamen hinein -- sonst schriebe das naechste
// „Speichern fuer N Abschnitte" einen Namen, den niemand angefasst hat.
const uneins = lauf({ feature: rs6, gruppe: { pfade: [rs6, rs7, rs8] }, name: "" });
assert.strictEqual(uneins.name.readOnly, true);
assert.strictEqual(uneins.name.value, "", "gemischt bleibt gemischt");

// 3. Traegt KEIN Abschnitt eine Zuweisung, ist nichts gesperrt.
const frei = lauf({ feature: rs7, gruppe: { pfade: [pfad("a", null), rs7] }, name: "Reichsstraße 2" });
assert.strictEqual(frei.name.readOnly, false, "ohne Zuweisung in der Strasse ist der Name frei");
assert.strictEqual(frei.autoname.disabled, false);

// 4. Am einzelnen Abschnitt unveraendert: der eigene Artikel sperrt und nennt den Namen, ohne Artikel ist das Feld frei.
const eigener = lauf({ feature: rs6, gruppe: null, name: "Reichsstrasse-16" });
assert.strictEqual(eigener.name.readOnly, true);
assert.strictEqual(eigener.name.value, "Reichsstraße 2", "am Abschnitt setzt R1 den Artikelnamen wie bisher");
const ohne = lauf({ feature: rs7, gruppe: null, name: "Reichsstraße 2", autoname: false });
assert.strictEqual(ohne.name.readOnly, false, "am Abschnitt ohne Zuweisung zaehlen die Nachbarn nicht");

console.log("weg-dialog-namenssperre.test.js: ok");
