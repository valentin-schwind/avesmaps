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

// ---- 1. Er zeigt das erste Stueck und dessen Wert ------------------------------------------
const SEG = [
	{ public_id: "s1", curve: 26, label: "Kreuzung-4 — Nadoret" },
	{ public_id: "s2", curve: -30, label: "Kreuzung-4 — Mendena" },
	{ public_id: "s3", curve: 0, label: "Kreuzung-4 — Riva" },
];
const gesehen = [];
const gewaehlt = [];
let fertigWerte = null;
const regler = avesmapsKurveReglerZeigen({
	name: "Fächer der Macht",
	segmente: SEG,
	aufAenderung: (pid, w) => gesehen.push([pid, w]),
	aufWahl: (pid) => gewaehlt.push(pid),
	aufFertig: (w) => { fertigWerte = w; },
});
const eingabe = document.getElementById("avm-kurve-regler-eingabe");
assert.ok(eingabe, "der Regler hat kein Eingabeelement gebaut");
assert.strictEqual(eingabe.type, "range");
assert.strictEqual(String(eingabe.value), "26", "der Wert des ERSTEN Stuecks steht nicht im Schieber");
assert.strictEqual(eingabe.getAttribute("min"), "-45");
assert.strictEqual(eingabe.getAttribute("max"), "45");

// ---- 2. Linie UND Stueck stehen dran --------------------------------------------------------
// ⚠️ Ohne den Namen des STUECKS weiss man bei vier gleich aussehenden Kanten nicht, welche man biegt.
const alleTexte = sucheAlle(body, "DIV").map((e) => e.textContent).join(" | ");
assert.ok(alleTexte.includes("Fächer der Macht"), "der Regler nennt die Linie nicht");
assert.ok(alleTexte.includes("Nadoret"), "der Regler nennt das gewaehlte Stueck nicht");

// ---- 3. Jeder Zug meldet sich MIT der Kennung des Stuecks -----------------------------------
eingabe.value = "-12";
eingabe.feuere("input", {});
assert.deepStrictEqual(gesehen, [["s1", -12]], "aufAenderung meldet nicht (public_id, Zahl)");
assert.strictEqual(typeof gesehen[0][1], "number", "aufAenderung liefert keine Zahl");

// ---- 4. Die Anzeige wandert mit --------------------------------------------------------------
const wertFeld = sucheAlle(body, ".avm-kurve-regler__wert")[0];
assert.strictEqual(wertFeld.textContent, "-12 %", "die Anzeige folgt dem Zug nicht");

// ---- 5. Ein anderes Stueck waehlen -----------------------------------------------------------
// 💣 Der Schieber muss auf DESSEN Wert springen. Bliebe er stehen, verstellte der naechste Zug das
// neue Stueck auf den Wert des alten -- und niemand haette das angeordnet.
const stuecke = sucheAlle(body, ".avm-kurve-regler__stueck");
assert.strictEqual(stuecke.length, 3, "es gibt keine Wahl zwischen den Stuecken");
stuecke[1].feuere("click", {});
assert.deepStrictEqual(gewaehlt, ["s2"], "die Wahl wird nicht gemeldet");
assert.strictEqual(String(document.getElementById("avm-kurve-regler-eingabe").value), "-30",
	"der Schieber springt nicht auf den Wert des neu gewaehlten Stuecks");
assert.ok(sucheAlle(body, "DIV").map((e) => e.textContent).join(" | ").includes("Mendena"),
	"der Kopf nennt weiter das alte Stueck");

// ---- 6. Der Zug am ERSTEN Stueck ist nicht verloren -----------------------------------------
// 💣 Der Regler haelt die Werte selbst; wer zwischen Stuecken hin und her wechselt, darf nichts
// verlieren. Ohne das waere die Wahl eine Falle statt einer Hilfe.
stuecke[0].feuere("click", {});
assert.strictEqual(String(document.getElementById("avm-kurve-regler-eingabe").value), "-12",
	"der zuvor eingestellte Wert des ersten Stuecks ist verloren");

// ---- 7. „Fertig" meldet ALLE Werte auf einmal und raeumt auf ---------------------------------
const fertig = document.getElementById("avm-kurve-regler-fertig");
assert.ok(fertig, "es gibt keinen Fertig-Knopf");
fertig.feuere("click", {});
assert.deepStrictEqual(fertigWerte, { s1: -12, s2: -30, s3: 0 },
	"aufFertig meldet nicht den Stand ALLER Stuecke");
assert.strictEqual(document.getElementById("avm-kurve-regler-eingabe"), null,
	"der Regler raeumt sich beim Fertig nicht ab");
// Ein zweiter Klick darf NICHT ein zweites Mal melden.
fertigWerte = null;
fertig.feuere("click", {});
assert.strictEqual(fertigWerte, null, "aufFertig feuert ein zweites Mal -- der Editor kaeme doppelt zurueck");

// ---- 8. zerstoeren() ist mehrfach gefahrlos --------------------------------------------------
regler.zerstoeren();
regler.zerstoeren();

// ---- 9. Ein zweiter Aufruf ersetzt den ersten, statt zwei Regler zu stapeln -----------------
// 💣 Die Doppelanmeldung, die das Sammelmenue im Menueband schon einmal gekostet hat.
const a = [];
const b = [];
avesmapsKurveReglerZeigen({ name: "A", segmente: [{ public_id: "a1", curve: 0, label: "A" }],
	aufAenderung: (p, w) => a.push(w), aufFertig() {} });
avesmapsKurveReglerZeigen({ name: "B", segmente: [{ public_id: "b1", curve: 0, label: "B" }],
	aufAenderung: (p, w) => b.push(w), aufFertig() {} });
assert.strictEqual(document.querySelectorAll("#avm-kurve-regler-eingabe").length, 1,
	"ein zweiter Aufruf hat einen ZWEITEN Regler gestapelt");
const zweite = document.getElementById("avm-kurve-regler-eingabe");
zweite.value = "7";
zweite.feuere("input", {});
assert.deepStrictEqual(b, [7], "der zweite Regler meldet nicht");
assert.deepStrictEqual(a, [], "der ERSTE Regler schreibt noch mit -- er wurde nicht abgeraeumt");

// ---- 10. Ein EINZIGES Stueck bekommt keine Wahlliste ----------------------------------------
// ⚠️ Ein Waehler fuer eine einzige Moeglichkeit ist ein Klick fuer nichts -- und die meisten
// Kraftlinien sind einsegmentig.
assert.strictEqual(sucheAlle(body, ".avm-kurve-regler__stueck").length, 0,
	"bei einem einzigen Stueck steht trotzdem eine Wahlliste da");

// ---- 11. Ohne Stuecke faellt er offen aus ---------------------------------------------------
// 🔴 Kein Wurf: eine Linie ohne lesbare Segmente ist ein Datenproblem, kein Grund, die Karte
// stehenzulassen -- der Schieber ist dann schlicht gesperrt.
const leer = avesmapsKurveReglerZeigen({ name: "Leer", segmente: [], aufFertig() {} });
assert.strictEqual(document.getElementById("avm-kurve-regler-eingabe").disabled, true,
	"ohne Stuecke muss der Schieber gesperrt sein");
document.getElementById("avm-kurve-regler-eingabe").feuere("input", {});
leer.zerstoeren();

console.log("OK: Kurven-Regler -- Stueckwahl, Wert je Stueck, Fertig meldet alle, kein Stapeln.");
