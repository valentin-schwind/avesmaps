// Der schwebende Kurven-Regler als Bauteil -- mit einem gefaelschten DOM wirklich AUSGEFUEHRT,
// nicht am Quelltext abgelesen. Lauf:
//   node js/ui/__tests__/kraftlinie-kurve-regler.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §8
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Ein DOM, das gerade so viel kann, wie das Bauteil anfasst.
function macheElement(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		children: [], attributes: {}, style: {}, dataset: {},
		className: "", textContent: "", value: "", type: "", hidden: false,
		parentNode: null,
		_handler: {},
		appendChild(k) { this.children.push(k); k.parentNode = this; return k; },
		removeChild(k) { this.children = this.children.filter((x) => x !== k); k.parentNode = null; return k; },
		remove() { if (this.parentNode) { this.parentNode.removeChild(this); } },
		setAttribute(k, v) { this.attributes[k] = String(v); if (k === "type") { this.type = String(v); } },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
		addEventListener(name, fn) { (this._handler[name] = this._handler[name] || []).push(fn); },
		removeEventListener(name, fn) { this._handler[name] = (this._handler[name] || []).filter((f) => f !== fn); },
		feuere(name, ereignis) { (this._handler[name] || []).slice().forEach((fn) => fn(ereignis || {})); },
		querySelector(sel) { return sucheAlle(this, sel)[0] || null; },
		querySelectorAll(sel) { return sucheAlle(this, sel); },
	};
	return el;
}
function sucheAlle(wurzel, sel) {
	const treffer = [];
	const passt = (el) => (sel.startsWith("#") ? el.attributes.id === sel.slice(1)
		: sel.startsWith(".") ? String(el.className).split(/\s+/).includes(sel.slice(1))
		: el.tagName === sel.toUpperCase());
	(function lauf(el) {
		el.children.forEach((k) => { if (passt(k)) { treffer.push(k); } lauf(k); });
	})(wurzel);
	return treffer;
}
const body = macheElement("body");
global.document = {
	body: body,
	createElement: macheElement,
	getElementById: (id) => sucheAlle(body, "#" + id)[0] || null,
	querySelectorAll: (sel) => sucheAlle(body, sel),
	addEventListener() {}, removeEventListener() {},
};
global.window = { addEventListener() {}, removeEventListener() {} };

const abs = path.join(__dirname, "..", "kraftlinie-kurve-regler.js");
vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });

// ---- 1. Er zeigt den uebergebenen Wert ------------------------------------------------------
const gesehen = [];
let fertigWert = null;
const regler = avesmapsKurveReglerZeigen({
	name: "Torweg",
	curve: 26,
	aufAenderung: (w) => gesehen.push(w),
	aufFertig: (w) => { fertigWert = w; },
});
const eingabe = document.getElementById("avm-kurve-regler-eingabe");
assert.ok(eingabe, "der Regler hat kein Eingabeelement gebaut");
assert.strictEqual(eingabe.type, "range");
assert.strictEqual(String(eingabe.value), "26", "der uebergebene Wert steht nicht im Schieber");
assert.strictEqual(eingabe.getAttribute("min"), "-45");
assert.strictEqual(eingabe.getAttribute("max"), "45");

// ---- 2. Der Name der Linie steht dran -------------------------------------------------------
// ⚠️ Ohne ihn weiss der Owner bei 62 Linien nicht, welche er gerade biegt.
const alleTexte = sucheAlle(body, "DIV").map((e) => e.textContent).join(" | ");
assert.ok(alleTexte.includes("Torweg"), "der Regler nennt die Linie nicht");

// ---- 3. Jeder Zug meldet sich ---------------------------------------------------------------
eingabe.value = "-12";
eingabe.feuere("input", {});
assert.deepStrictEqual(gesehen, [-12], "aufAenderung feuert nicht oder liefert keine ZAHL");
eingabe.value = "40";
eingabe.feuere("input", {});
assert.deepStrictEqual(gesehen, [-12, 40]);
// 💣 Eine ZAHL, keine Zeichenkette: der Empfaenger rechnet damit, und "40" + 1 waere "401".
gesehen.forEach((w) => assert.strictEqual(typeof w, "number", "aufAenderung liefert keine Zahl"));

// ---- 4. Die Anzeige wandert mit --------------------------------------------------------------
const wertFeld = sucheAlle(body, ".avm-kurve-regler__wert")[0];
assert.ok(wertFeld, "es gibt keine Wertanzeige");
assert.strictEqual(wertFeld.textContent, "+40 %", "die Anzeige folgt dem Zug nicht (Vorzeichen/Einheit)");

// ---- 5. „Fertig" meldet EINMAL und raeumt auf ------------------------------------------------
const fertig = document.getElementById("avm-kurve-regler-fertig");
assert.ok(fertig, "es gibt keinen Fertig-Knopf");
fertig.feuere("click", {});
assert.strictEqual(fertigWert, 40, "aufFertig bekommt nicht den zuletzt eingestellten Wert");
assert.strictEqual(document.getElementById("avm-kurve-regler-eingabe"), null,
	"der Regler raeumt sich beim Fertig nicht ab");
// Ein zweiter Klick auf denselben (schon entfernten) Knopf darf NICHT ein zweites Mal melden.
fertigWert = null;
fertig.feuere("click", {});
assert.strictEqual(fertigWert, null, "aufFertig feuert ein zweites Mal -- der Editor kaeme doppelt zurueck");

// ---- 6. zerstoeren() ist mehrfach gefahrlos --------------------------------------------------
// 💣 Sonst wirft ein zweiter Aufruf (Fertig + Escape kurz hintereinander) und laesst den Editor
// weggeblendet zurueck -- der Owner saehe eine leere Karte und haette keinen Weg zurueck.
regler.zerstoeren();
regler.zerstoeren();

// ---- 7. Ein zweiter Aufruf ersetzt den ersten, statt zwei Regler zu stapeln -----------------
// 💣 Die Doppelanmeldung, die das Sammelmenue im Menueband schon einmal gekostet hat: zwei Regler
// uebereinander, der obere sichtbar, der untere schreibt weiter mit.
const a = [];
const b = [];
avesmapsKurveReglerZeigen({ name: "A", curve: 0, aufAenderung: (w) => a.push(w), aufFertig() {} });
avesmapsKurveReglerZeigen({ name: "B", curve: 0, aufAenderung: (w) => b.push(w), aufFertig() {} });
assert.strictEqual(document.querySelectorAll("#avm-kurve-regler-eingabe").length, 1,
	"ein zweiter Aufruf hat einen ZWEITEN Regler gestapelt");
const zweite = document.getElementById("avm-kurve-regler-eingabe");
zweite.value = "7";
zweite.feuere("input", {});
assert.deepStrictEqual(b, [7], "der zweite Regler meldet nicht");
assert.deepStrictEqual(a, [], "der ERSTE Regler schreibt noch mit -- er wurde nicht abgeraeumt");

// ---- 8. Unbrauchbare Werte fallen offen aus --------------------------------------------------
avesmapsKurveReglerZeigen({ name: "C", curve: undefined, aufAenderung() {}, aufFertig() {} });
assert.strictEqual(document.getElementById("avm-kurve-regler-eingabe").value, "0",
	"ohne Wert muss der Regler auf 0 stehen, nicht auf NaN");
// Und ohne Rueckrufe darf er nicht werfen (ein Aufrufer, der nur zeigen will).
const stumm = avesmapsKurveReglerZeigen({ name: "D", curve: 10 });
document.getElementById("avm-kurve-regler-eingabe").feuere("input", {});
document.getElementById("avm-kurve-regler-fertig").feuere("click", {});
stumm.zerstoeren();

console.log("OK: Kurven-Regler -- Wert, Meldung je Zug, Anzeige, Fertig, Zerstoeren, kein Stapeln.");
