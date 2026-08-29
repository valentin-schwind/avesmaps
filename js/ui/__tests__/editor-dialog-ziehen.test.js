// Einen Editor-Dialog am Kopf verschieben -- mit einem gefaelschten DOM wirklich AUSGEFUEHRT.
// Lauf: node js/ui/__tests__/editor-dialog-ziehen.test.js
//
// 🔴 Owner 29.08.2026 zum Kraftlinien-Editor: „der editor muss zur seite geschoben werden koennen".
const assert = require("assert");

function macheElement() {
	return {
		style: {}, _handler: {},
		addEventListener(name, fn) { (this._handler[name] = this._handler[name] || []).push(fn); },
		removeEventListener(name, fn) { this._handler[name] = (this._handler[name] || []).filter((f) => f !== fn); },
		feuere(name, ereignis) { (this._handler[name] || []).slice().forEach((fn) => fn(ereignis || {})); },
		anzahl(name) { return (this._handler[name] || []).length; },
	};
}
const dok = macheElement();
global.document = {
	addEventListener: (n, f) => dok.addEventListener(n, f),
	removeEventListener: (n, f) => dok.removeEventListener(n, f),
	feuere: (n, e) => dok.feuere(n, e),
	anzahl: (n) => dok.anzahl(n),
};

const { avesmapsEditorDialogZiehbar } = require("../editor-dialog-ziehen.js");

const griff = macheElement();
const dialog = macheElement();
const steuerung = avesmapsEditorDialogZiehbar(griff, dialog);
assert.ok(steuerung, "kein Steuerungsobjekt");

// ---- 1. Ein Zug verschiebt per transform -----------------------------------------------------
// 💣 Per `transform`, NICHT ueber left/top: der Dialog sitzt in einem Flex-Overlay, das ihn
// zentriert -- ein `left` arbeitete gegen die Zentrierung und spraenge beim Fenstergroessen-Wechsel.
griff.feuere("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100, target: null });
document.feuere("pointermove", { pointerId: 1, clientX: 160, clientY: 130 });
assert.strictEqual(dialog.style.transform, "translate(60px, 30px)",
	"der Dialog folgt dem Zeiger nicht");
document.feuere("pointermove", { pointerId: 1, clientX: 100, clientY: 100 });
assert.strictEqual(dialog.style.transform, "", "zurueck am Ausgangspunkt muss die Transform leer sein");

// ---- 2. Nach dem Loslassen bewegt sich nichts mehr -------------------------------------------
// 💣 Die Handler haengen am DOKUMENT (wer schnell zieht, ist mit dem Zeiger laengst neben dem Kopf).
// Genau deshalb MUESSEN sie beim Loslassen wieder ab -- sonst klebte der Dialog fuer immer am
// Zeiger, und das faellt erst auf, wenn jemand die Karte bewegen will.
document.feuere("pointermove", { pointerId: 1, clientX: 200, clientY: 200 });
const vorLoslassen = dialog.style.transform;
document.feuere("pointerup", { pointerId: 1 });
assert.strictEqual(document.anzahl("pointermove"), 0, "der Bewegungs-Handler bleibt am Dokument haengen");
assert.strictEqual(document.anzahl("pointerup"), 0, "der Loslass-Handler bleibt haengen");
document.feuere("pointermove", { pointerId: 1, clientX: 900, clientY: 900 });
assert.strictEqual(dialog.style.transform, vorLoslassen, "der Dialog bewegt sich nach dem Loslassen weiter");

// ---- 3. Der zweite Zug setzt dort an, wo der erste aufhoerte --------------------------------
// ⚠️ Sonst spraenge der Dialog beim zweiten Anfassen zurueck in die Mitte.
const standVorher = steuerung.stand();
griff.feuere("pointerdown", { button: 0, pointerId: 2, clientX: 0, clientY: 0, target: null });
document.feuere("pointermove", { pointerId: 2, clientX: 10, clientY: 10 });
assert.strictEqual(dialog.style.transform,
	"translate(" + (standVorher.x + 10) + "px, " + (standVorher.y + 10) + "px)",
	"der zweite Zug setzt nicht am bisherigen Stand an");
document.feuere("pointerup", { pointerId: 2 });

// ---- 4. Ein Klick auf ein Bedienelement im Kopf zieht NICHT ---------------------------------
// 💣 Sonst verschiebt sich der Dialog, waehrend man auf „Schliessen" drueckt.
steuerung.zuruecksetzen();
const knopf = { closest: (sel) => (/button/.test(sel) ? knopf : null) };
griff.feuere("pointerdown", { button: 0, pointerId: 3, clientX: 50, clientY: 50, target: knopf });
document.feuere("pointermove", { pointerId: 3, clientX: 150, clientY: 150 });
assert.strictEqual(dialog.style.transform, "", "ein Klick auf einen Knopf im Kopf hat gezogen");

// ---- 5. Nur die linke Taste ------------------------------------------------------------------
griff.feuere("pointerdown", { button: 2, pointerId: 4, clientX: 50, clientY: 50, target: null });
document.feuere("pointermove", { pointerId: 4, clientX: 150, clientY: 150 });
assert.strictEqual(dialog.style.transform, "", "die rechte Maustaste zieht den Dialog");

// ---- 6. Ein fremder Zeiger stoert den laufenden Zug nicht -----------------------------------
// ⚠️ Am Touchgeraet liegen leicht zwei Finger auf; der zweite darf den Dialog nicht mitreissen.
griff.feuere("pointerdown", { button: 0, pointerId: 5, clientX: 0, clientY: 0, target: null });
document.feuere("pointermove", { pointerId: 99, clientX: 500, clientY: 500 });
assert.strictEqual(dialog.style.transform, "", "ein fremder Zeiger hat den Dialog verschoben");
document.feuere("pointerup", { pointerId: 5 });

// ---- 7. Zweimal anmelden stapelt nicht ------------------------------------------------------
// 💣 Die Doppelanmeldung, die das Sammelmenue im Menueband schon gekostet hat -- hier bewegte sich
// der Dialog doppelt so weit wie der Zeiger.
const nochmal = avesmapsEditorDialogZiehbar(griff, dialog);
assert.strictEqual(nochmal, steuerung, "ein zweiter Aufruf liefert eine ZWEITE Steuerung");
assert.strictEqual(griff.anzahl("pointerdown"), 1, "der Griff traegt zwei Aufnahme-Handler");

// ---- 8. Ohne Griff oder Dialog faellt es offen aus ------------------------------------------
assert.strictEqual(avesmapsEditorDialogZiehbar(null, dialog), null);
assert.strictEqual(avesmapsEditorDialogZiehbar(griff, null), steuerung,
	"ein Aufruf ohne Dialog darf die vorhandene Steuerung nicht zerstoeren");

console.log("OK: Editor-Dialog ziehen -- transform, Loslassen, zweiter Zug, Knopf, Tasten, kein Stapeln.");
