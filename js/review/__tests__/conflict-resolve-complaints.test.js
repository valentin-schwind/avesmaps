// Was der Editor nach einer Reparatur zu SEHEN bekommt — abgelehnte Ziele UND ausgelassene Zeilen.
//
// 🔴 Die zweite Hälfte fehlte, und daran ist der Fehler gefallen: seit ein Ziel bei Wegen und
// Kraftlinien den ganzen Namensverbund fasst, kann ein einzelnes Segment darin stehen bleiben
// (sein Anspruch steckt im Wiki-Nest, Sicherheitsregel 1). Der Aufruf meldet trotzdem `ok:true`,
// der Client filterte nur auf `ok === false` — und der Editor sah GAR NICHTS. Eine Antwort, die
// Vollzug meldet und dabei etwas verschweigt, ist schlimmer als eine Fehlermeldung.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox ohne DOM (Hausform wie sync-plan-sheet.test.js):
// ein Stub zertifizierte nur den Stub.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/conflict-resolve-complaints.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-conflicts.js"), "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-conflicts.js" });

const complaints = sandbox.conflictResolveComplaints;
assert.strictEqual(typeof complaints, "function", "die echte Funktion ist geladen");

// ⚠️ Die Sandbox hat ihr EIGENES Array-Prototyp — deepStrictEqual scheitert dort an der Identität
// der Prototypen, nicht am Inhalt ("Values have same structure but are not reference-equal").
// Deshalb wird über den Inhalt verglichen.
function gleicheListe(ist, soll, warum) {
	assert.strictEqual(JSON.stringify(Array.from(ist)), JSON.stringify(soll), warum || "");
}

// ---- Der glatte Fall schweigt ------------------------------------------------------------------
// ⚠️ Wichtig: sonst poppt nach jeder gelungenen Reparatur ein leerer Hinweis auf.
gleicheListe(complaints({ results: [{ ok: true, written: 6, skipped: [] }] }), []);
gleicheListe(complaints({}), []);
gleicheListe(complaints(null), []);

// ---- Ein abgelehntes Ziel: wie bisher -----------------------------------------------------------
gleicheListe(
	complaints({ results: [{ ok: false, reason: "Objekt nicht gefunden." }] }),
	["Objekt nicht gefunden."]
);

// ---- 💣 DER FALL, DER UNSICHTBAR WAR: ok:true, aber eine Zeile ausgelassen ----------------------
const einSegment = complaints({
	results: [{
		ok: true,
		written: 5,
		skipped: [{ public_id: "pl-3", reason: "Diese Verknüpfung stammt aus der Wiki-Zuordnung." }],
	}],
});
assert.strictEqual(einSegment.length, 1, "die ausgelassene Zeile wird gemeldet, obwohl ok:true");
assert.ok(einSegment[0].includes("Wiki-Zuordnung"), "und zwar mit dem Grund des Servers");
assert.ok(einSegment[0].includes("Ein Teil wurde"), "Singular, wenn es einer ist: " + einSegment[0]);

// ---- ⚠️ Nach Grund gebündelt: sechs Segmente mit demselben Grund sind EINE Aussage --------------
const sechs = complaints({
	results: [{
		ok: true,
		written: 0,
		skipped: [1, 2, 3, 4, 5, 6].map((i) => ({ public_id: "pl-" + i, reason: "Trägt bereits eine Verknüpfung." })),
	}],
});
assert.strictEqual(sechs.length, 1, "ein Grund, eine Zeile — nicht sechs gleiche Zeilen");
assert.ok(sechs[0].includes("6 Teile wurden"), "mit der Anzahl davor: " + sechs[0]);

// Zwei verschiedene Gründe bleiben zwei Aussagen.
const zweiGruende = complaints({
	results: [{
		ok: true,
		skipped: [
			{ public_id: "pl-1", reason: "Grund A" },
			{ public_id: "pl-2", reason: "Grund B" },
			{ public_id: "pl-3", reason: "Grund A" },
		],
	}],
});
assert.strictEqual(zweiGruende.length, 2);
assert.ok(zweiGruende.some((m) => m.includes("2 Teile wurden") && m.includes("Grund A")));
assert.ok(zweiGruende.some((m) => m.includes("Ein Teil wurde") && m.includes("Grund B")));

// ---- Beides zusammen, über mehrere Ziele hinweg -------------------------------------------------
const gemischt = complaints({
	results: [
		{ ok: false, reason: "Der Link hat sich inzwischen geändert — bitte neu prüfen." },
		{ ok: true, written: 5, skipped: [{ public_id: "pl-3", reason: "Grund X" }] },
	],
});
assert.strictEqual(gemischt.length, 2);
assert.ok(gemischt[0].includes("inzwischen geändert"), "die Ablehnung steht zuerst");

// ---- Kaputte Einträge dürfen nichts ausloesen ---------------------------------------------------
// ⚠️ Ein leerer Grund ergäbe eine Meldung, die nichts sagt — die ist schlimmer als keine.
gleicheListe(complaints({ results: [{ ok: true, skipped: [{ public_id: "x", reason: "" }] }] }), []);
gleicheListe(complaints({ results: [{ ok: true, skipped: [{}] }] }), []);
gleicheListe(complaints({ results: [null, undefined] }), []);
// Ein `ok:false` ohne Begründung darf keinen leeren Eintrag erzeugen.
gleicheListe(complaints({ results: [{ ok: false }] }), []);

console.log("conflict-resolve-complaints: alle Zusicherungen erfuellt");
