// Der Dialog „Weg bearbeiten" fuer die ganze Strasse (handlePathGroupEditSubmit, review-editor-submit.js):
// ein unveraenderter Gruppenentwurf lieferte bisher nur "Nichts geändert." in der Statuszeile des Dialogs --
// die liegt unterhalb des sichtbaren Fensterbereichs (gemessen: top 917 bei innerHeight 900), der Dialog
// blieb offen. Fuer den Editor sah "Speichern für N Abschnitte" wie ein toter Knopf aus, obwohl Wiki-
// Zuweisungen und Quellen im Kasten daneben ohnehin schon sofort geschrieben hatten.
//
// AUSGEFUEHRT: handlePathGroupEditSubmit laeuft echt, mit wpGroupRumpf als Attrappe, die "nichts
// angefasst" simuliert (die echte Rechnung dazu ist rein und in weg-dialog-gruppe.test.js geprueft).
//
// Aus der Wurzel: node js/review/__tests__/weg-dialog-gruppe-nichts-geaendert.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	const a = text.indexOf("function " + name + "(");
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	// handlePathGroupEditSubmit ist `async function ...` -- das "async " liegt VOR dem Fund und
	// muss mit, sonst bricht das enthaltene `await` unten mit einem SyntaxError ab.
	const vorsatz = text.slice(Math.max(0, a - 6), a) === "async " ? "async " : "";
	return vorsatz + text.slice(a, e + 3);
};

const submitQuelle = lies("js/review/review-editor-submit.js");
const handlePathGroupEditSubmit = funktion(submitQuelle, "handlePathGroupEditSubmit");

const aufrufe = { dialogGeschlossen: [], toast: [], server: 0, status: [], pending: [] };
const kontext = vm.createContext({
	console,
	pathEditGruppe: { stand: { name: { gleich: true, wert: "Reichsstraße 2" } }, pfade: [{ public_id: "rs-6" }, { public_id: "rs-7" }, { public_id: "rs-8" }] },
	getPathPublicId: (p) => p.public_id,
	// Die reine Rechnung selbst ist anderswo geprueft (weg-dialog-gruppe.test.js, Abschnitt 1+4) --
	// hier zaehlt nur, WAS handlePathGroupEditSubmit tut, wenn sie "nichts angefasst" meldet.
	wpGroupRumpf: () => null,
	readPathGruppeEntwurf: () => ({}),
	setPathEditStatus: (message, type) => { aufrufe.status.push([message, type]); },
	setPathEditSubmitPending: (isPending) => { aufrufe.pending.push(isPending); },
	// 🪤 `opts` entsteht als Objektliteral IM vm-Kontext und traegt damit einen fremden Object.prototype --
	// gegen ein Host-Literal verglichen faellt deepStrictEqual trotz zeichengleichem Inhalt. `{ ...opts }`
	// kopiert es in den Host-Realm, bevor es abgelegt wird.
	setPathEditDialogOpen: (isOpen, opts) => { aufrufe.dialogGeschlossen.push([isOpen, { ...opts }]); },
	showFeedbackToast: (message, type) => { aufrufe.toast.push([message, type]); },
	submitMapFeatureEdit: () => { aufrufe.server += 1; return Promise.resolve({ written: 3 }); },
	pollLiveMapUpdates: () => Promise.resolve(),
	loadChangeLog: () => Promise.resolve(),
});

vm.runInContext(handlePathGroupEditSubmit, kontext);
const lauf = vm.runInContext("handlePathGroupEditSubmit()", kontext);

Promise.resolve(lauf).then(() => {
	assert.strictEqual(aufrufe.server, 0, "kein Serveraufruf, wenn nichts angefasst wurde");
	assert.deepStrictEqual(aufrufe.dialogGeschlossen, [[false, { resetForm: true }]],
		"der Dialog schliesst wie nach einem erfolgreichen Speichern");
	assert.strictEqual(aufrufe.toast.length, 1, "genau ein Toast");
	assert.deepStrictEqual(aufrufe.toast[0],
		["Nichts zu speichern — Wiki-Zuweisungen und Quellen wirken sofort.", "success"]);
	assert.strictEqual(aufrufe.status.length, 0, "die (unsichtbare) Statuszeile wird nicht mehr benutzt");

	console.log("weg-dialog-gruppe-nichts-geaendert.test.js: ok");
}).catch((fehler) => {
	console.error("weg-dialog-gruppe-nichts-geaendert.test.js: FEHLER", fehler);
	process.exitCode = 1;
});
