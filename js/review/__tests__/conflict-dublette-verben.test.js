// Welche Knöpfe ein Dubletten-Fall im Konfliktzentrum anbietet — und welche NICHT.
//
// 🔴 Der Knopf ist der ganze Sinn der Liste. Eine Beschriftung, die die Label-Kollision verliert,
// wird nicht gezeichnet, und was nicht gezeichnet ist, lässt sich auf der Karte nicht anklicken:
// kein Klick, kein Rechtsklick, kein Löschen. Der Löschweg muss also AUS DER LISTE HERAUS gehen.
//
// 💣 Und er darf nicht überall stehen: an einer Beschriftung, an der eine Landschaftsfläche hängt,
// nimmt ein Löschvorgang womöglich die ganze Fläche mit (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED). Der
// Server lehnt das ohnehin ab — aber ein Knopf, der immer nur eine Fehlermeldung erzeugt, ist eine
// Falle, kein Angebot. Deshalb steht dort der GRUND statt des Knopfes.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox mit einem DOM-Schein (Hausform wie
// conflict-resolve-complaints.test.js und ort-wiki-override-form.test.js): ein Nachbau
// zertifizierte nur den Nachbau.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/conflict-dublette-verben.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-conflicts.js"), "utf8");

// Ein Knoten, der sich seine Kinder merkt — nur so lässt sich hinterher fragen, was gebaut wurde.
function knoten(tagName) {
	return {
		tagName,
		children: [],
		className: "",
		textContent: "",
		title: "",
		type: "",
		href: "",
		rel: "",
		target: "",
		hidden: false,
		disabled: false,
		style: { setProperty() {} },
		dataset: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		appendChild(kind) { this.children.push(kind); return kind; },
		addEventListener() {},
		setAttribute() {},
		removeAttribute() {},
		getAttribute() { return null; },
	};
}

const sandbox = {
	console, JSON, Math, Date, Number, String, Array, Object, Boolean, Map, Set, Promise,
	setTimeout, clearTimeout,
	fetch: () => {},
	window: { alert() {}, setTimeout() {} },
	navigator: {},
	document: {
		createElement: (tag) => knoten(tag),
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener() {},
	},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-conflicts.js" });

const createConflictElement = sandbox.createConflictElement;
assert.strictEqual(typeof createConflictElement, "function", "die echte Funktion ist geladen");

/** Alle Knöpfe eines gebauten Falls, flach, mit ihrer Beschriftung. */
function knopfTexte(wurzel) {
	const gefunden = [];
	(function lauf(el) {
		if (el.tagName === "button") { gefunden.push(String(el.textContent)); }
		(el.children || []).forEach(lauf);
	})(wurzel);
	return gefunden;
}

/** Der gesamte sichtbare Text eines gebauten Falls. */
function ganzerText(wurzel) {
	const teile = [];
	(function lauf(el) {
		if (String(el.textContent) !== "") { teile.push(String(el.textContent)); }
		(el.children || []).forEach(lauf);
	})(wurzel);
	return teile.join(" | ");
}

const DUBLETTE = {
	rule_id: "label.duplicate",
	fingerprint: "abc",
	short_id: "K7M2QX",
	severity: "error",
	status: "open",
	title: "Drei Schwestern",
	wiki_url: "",
	subject_type: "label",
	subject_id: "frei-1",
	parties: [
		{ type: "label", id: "frei-1", label: "Drei Schwestern", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-20 12:38:09" },
		{ type: "label", id: "frei-2", label: "Drei Schwestern", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true, updated_at: "2026-08-07 09:50:13" },
	],
};

// ---- Der gemeldete Fall: zwei freie Beschriftungen, beide löschbar -----------------------------
const beide = createConflictElement(DUBLETTE);
const knoepfeBeide = knopfTexte(beide);
const loeschKnoepfe = knoepfeBeide.filter((t) => t.includes("löschen"));
assert.strictEqual(loeschKnoepfe.length, 2, "je Partei ein Löschknopf, nicht einer für den Fall: " + JSON.stringify(knoepfeBeide));
assert.ok(loeschKnoepfe[0].includes("Beschriftung"), "der Knopf sagt, WAS er löscht: " + loeschKnoepfe[0]);

// 🔴 DIE ZWEI ZEILEN MÜSSEN UNTERSCHEIDBAR SEIN. Beide heißen „Drei Schwestern", beide sind
// `berggipfel`, beide zeigen auf denselben Artikel — vor zwei identischen Zeilen mit je einem
// Löschknopf kann niemand entscheiden, welche die überzählige ist. „Zuletzt geändert" ist das
// Merkmal, das ohnehin in der Zeile liegt.
const textBeide = ganzerText(beide);
assert.ok(textBeide.includes("2026-08-20"), "der Stand der einen steht da: " + textBeide);
assert.ok(textBeide.includes("2026-08-07"), "und der der anderen auch: " + textBeide);

// ⚠️ Und die irreführende Zeile der Artikel-Regel steht NICHT da: beide tragen sehr wohl einen
// Wiki-Artikel — dass es derselbe ist, IST der Fall.
assert.ok(!textBeide.includes("kein eigener Wiki-Artikel"), "keine Falschaussage über den Artikel: " + textBeide);

// 💣 DIE VERBEN DER ARTIKEL-REGEL GEHÖREN HIER NICHT HIN. „Trennen" nimmt der Beschriftung nur den
// Wiki-Link — der Name stünde danach immer noch zweimal auf der Karte. Der Fall sähe erledigt aus
// und wäre es nicht.
["Trennen", "Kein Wiki-Eintrag", "Behält den Link", "Artikel übernehmen"].forEach((verb) => {
	assert.ok(!knoepfeBeide.includes(verb), "„" + verb + "\" darf an einer Dublette nicht stehen");
});

// Die Buchführung bleibt: der Fall lässt sich auch ohne Datenänderung entscheiden.
["Genehmigt", "Zurückstellen", "Archivieren"].forEach((verb) => {
	assert.ok(knoepfeBeide.includes(verb), "„" + verb + "\" fehlt: " + JSON.stringify(knoepfeBeide));
});

// ---- 💣 Flächengebunden: KEIN Knopf, sondern der Grund -----------------------------------------
const gemischt = createConflictElement(Object.assign({}, DUBLETTE, {
	title: "Schwarzer See",
	parties: [
		{ type: "label", id: "frei-1", label: "Schwarzer See", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "", deletable: true },
		{ type: "label", id: "gebunden-1", label: "Schwarzer See", type_label: "Region/Landschaft", position: null, ecosystem_region_public_id: "r-see", deletable: false },
	],
}));
const knoepfeGemischt = knopfTexte(gemischt);
assert.strictEqual(
	knoepfeGemischt.filter((t) => t.includes("löschen")).length,
	1,
	"nur die freie Beschriftung bekommt den Knopf: " + JSON.stringify(knoepfeGemischt)
);
assert.ok(
	ganzerText(gemischt).includes("Landschaftsfläche"),
	"und die gebundene sagt, warum sie keinen bekommt: " + ganzerText(gemischt)
);

// ---- Ein entschiedener Fall bietet nichts mehr an ----------------------------------------------
const archiviert = createConflictElement(Object.assign({}, DUBLETTE, { status: "archived" }));
assert.strictEqual(
	knopfTexte(archiviert).filter((t) => t.includes("löschen")).length,
	0,
	"ein archivierter Fall löscht nichts"
);

// ---- ⚠️ Die Artikel-Regel bleibt unangetastet ---------------------------------------------------
// Sie trägt weiter ihre eigenen Verben; die Weiche darf ihr nichts wegnehmen.
const geteilt = createConflictElement({
	rule_id: "wiki.shared_article",
	fingerprint: "def",
	severity: "error",
	status: "open",
	title: "Jergan",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Jergan",
	parties: [
		{ type: "location", id: "o-1", label: "Jergan", type_label: "Ort", position: null, unlinkable: true },
		{ type: "label", id: "l-1", label: "Jergan (Wasserfall)", type_label: "Region/Landschaft", position: null, unlinkable: true },
	],
});
const knoepfeGeteilt = knopfTexte(geteilt);
assert.ok(knoepfeGeteilt.includes("Trennen"), "die Artikel-Regel behält ihre Verben: " + JSON.stringify(knoepfeGeteilt));
assert.strictEqual(
	knoepfeGeteilt.filter((t) => t.includes("löschen")).length,
	0,
	"und bekommt KEINEN Löschknopf — dort ist Löschen nie die Reparatur"
);

console.log("conflict-dublette-verben.test.js: OK");
