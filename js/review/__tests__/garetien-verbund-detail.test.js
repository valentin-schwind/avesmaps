// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Block „Verbund" in der Einzelansicht.
// Auftrag: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §9 (Block B)
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-detail.test.js
//
// 🔴 UMGEBAUT AM 14.09.2026 (Garetien-Importer vereint, Aufgabe 7): der Bauer liest seither die STAGE
// (✕ nur an Fragmenten, die dort liegen; der Knopf erst ab zwei) -- ein `vm`-Schnitt ohne Modulzustand
// kann ihn nicht mehr fahren. Er ist exportiert und wird am echten Modul AUSGEFUEHRT, nicht per Regex
// gelesen.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
const block = api.garetienVerbundBlockMarkup;

const objekte = [1, 2, 3, 4].map((i) => ({
	key: "k" + i, name: "Silker Hain " + i, ebene: "Waelder", typ: "Wald", ziel: "region", subtyp: "wald",
	verbund_stamm: "Silker Hain", verbund_n: 4, geometrie: new Array(10 + i).fill([0, 0]),
}));

api.avesmapsGaretienStageLeeren();

// Ohne Verbund: kein Block.
assert.strictEqual(block({ key: "x", name: "Weidicht" }, []), "");

// Mit Verbund, nichts auf der Stage: vier Zeilen, KEIN ✕ (auf „Offen" ist Block B reine Anzeige).
const offen = block(objekte[0], objekte);
assert.ok(offen.indexOf("Silker Hain 1") > -1);
assert.ok(offen.indexOf("Silker Hain 4") > -1);
assert.strictEqual((offen.match(/gi-seg__weg/g) || []).length, 0, "ohne Stage kein ✕");
assert.strictEqual((offen.match(/class="gi-seg gi-seg--verbund"><span><\/span>/g) || []).length, 4,
	"vier Zeilen mit leerer erster Zelle");

// Alle vier auf der Stage: jede Zeile traegt ihren ✕.
api.avesmapsGaretienStageHinzufuegen(objekte);
const m = block(objekte[0], objekte);
assert.strictEqual((m.match(/gi-seg__weg/g) || []).length, 4, "es fehlt ein ✕");

// 💣 Die Punktzahl steht IM Namen, nicht in einer eigenen Rasterzelle -- sonst braucht die Zeile
// mit Knopf eine zweite Rasterreihe und wird doppelt so hoch (gemessen 46 statt 28 px).
assert.ok(m.indexOf("gi-seg__zahl") > -1, "die Punktzahl steht in einer eigenen Zelle");
assert.strictEqual((m.match(/gi-seg__gap/g) || []).length, 0, "eine vierte Rasterzelle bricht die Zeile um");

// ⚠️ Ein Verbund mit nur EINEM Mitglied ist keiner mehr -- dieselbe Regel wie bei
// garetienVerbundMarkeMarkup (`n < 2`).
api.avesmapsGaretienStageLeeren();
assert.strictEqual(block(objekte[0], [objekte[0]]), "", "ein einzelnes Fragment ist kein Verbund mehr");

// Der ✕ traegt den SCHLUESSEL des Fragments, nicht seinen Namen.
api.avesmapsGaretienStageHinzufuegen(objekte);
assert.ok(m.indexOf('data-verbund-weg="k1"') > -1, "der erste Knopf traegt den Schluessel k1");
assert.ok(m.indexOf('data-verbund-weg="k4"') > -1, "der vierte Knopf traegt den Schluessel k4");

// Escaping: der Name geht durch den ECHTEN Escaper des Moduls.
const boese = objekte.map((o, i) => (i === 0 ? Object.assign({}, o, { name: "<Silker> Hain 1" }) : o));
const mBoese = block(boese[0], boese);
assert.ok(!mBoese.includes("<Silker>"), "der Fragmentname wird escaped: " + mBoese);
assert.ok(mBoese.includes("&lt;Silker"), "und escaped landet er auch wirklich im Markup: " + mBoese);

// =====================================================================================================
// SCHLUSSPRÜFUNG, BEFUND G1: Block B ist NUR Anzeige, solange das ANGEZEIGTE Objekt selbst nicht auf
// der Stage liegt -- auch wenn zwei seiner Geschwister schon dort liegen. `aufDerStage` zählte bisher
// nur die Geschwister und zeigte „Zusammenlegen (2)" samt ✕ an Geschwistern, obwohl das angezeigte
// Objekt (objekte[0]) auf „Offen" stand (Entwurf §3: auf „Offen" trägt Block B keine Bedienung).
// =====================================================================================================
api.avesmapsGaretienStageLeeren();
api.avesmapsGaretienStageHinzufuegen([objekte[1], objekte[2]]);
const geschwisterAufStage = block(objekte[0], objekte);
assert.strictEqual(geschwisterAufStage.indexOf('data-handlung="verbund"'), -1,
	"🔴 G1: das angezeigte Objekt liegt selbst NICHT auf der Stage -> kein Knopf, auch wenn zwei "
	+ "Geschwister dort liegen: " + geschwisterAufStage);
assert.strictEqual((geschwisterAufStage.match(/gi-seg__weg/g) || []).length, 0,
	"🔴 G1: und kein ✕ -- auf „Offen“ ist Block B reine Anzeige, auch für Geschwister auf der Stage: "
	+ geschwisterAufStage);
assert.ok(geschwisterAufStage.indexOf("Silker Hain 1") > -1 && geschwisterAufStage.indexOf("Silker Hain 3") > -1,
	"die Fragmente selbst bleiben sichtbar -- nur die Bedienung fehlt: " + geschwisterAufStage);

// Gegenprobe: auf der Stage bleibt es UNVERÄNDERT -- dasselbe Objekt, jetzt selbst mit aufgelegt.
api.avesmapsGaretienStageHinzufuegen([objekte[0]]);
const selbstAufStage = block(objekte[0], objekte);
assert.ok(selbstAufStage.indexOf('data-handlung="verbund"') > -1,
	"auf der Stage unverändert: mit sich selbst dazu sind es drei Geschwister -> der Knopf steht: "
	+ selbstAufStage);
assert.strictEqual((selbstAufStage.match(/gi-seg__weg/g) || []).length, 3,
	"und alle drei aufgelegten Fragmente tragen ihr ✕: " + selbstAufStage);

api.avesmapsGaretienStageLeeren();
console.log("OK -- garetien-verbund-detail");
