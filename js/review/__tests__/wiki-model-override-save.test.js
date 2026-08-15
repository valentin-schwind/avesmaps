// Fall #72 — „Territoriumsname geht verloren".
//
// 💣 DIE TRAGENDE ENTDECKUNG: der Server faltet den Override BEREITS in `name` hinein
// (api/_internal/wiki/sync-monitor-tree.php: Staging-Name, sonst Override-Name, sonst wiki_key).
// Die Maske hielt dieses Feld fuer den WIKI-Stand und verglich den Override damit — also mit
// sich selbst. Ein eigener Knoten hat keinen Staging-Namen, deshalb war der Vergleich immer
// gleich, und der Zweig „gleich -> Override loeschen" loeschte den Namen bei JEDEM Speichern.
// Niemand hatte das Feld angefasst. Gemeldet von Nottel am 15.08.2026 („passiert zuverlaessig
// immer. Nicht beim neu anlegen!"), samt Workaround „Namen nochmal eintragen und speichern" —
// der wirkte und hielt trotzdem nicht, weil der naechste Speichervorgang ihn wieder frass.
//
// Zwei Riegel, und BEIDE werden gebraucht:
//   1. Ein unveraendertes Feld loest gar keinen Aufruf aus (heilt alle Felder auf einmal).
//   2. Der rohe Wiki-Stand kommt aus wiki_name/wiki_continent, nie aus dem gefalteten Feld.
// ⚠️ Riegel 2 allein reichte nicht: wer den Namen von Hand auf den Wiki-Stand zuruecksetzt,
// soll den Override weiterhin loeschen koennen. Riegel 1 allein reichte auch nicht: dann
// bliebe „Wiki-Stand" fuer eigene Knoten weiter der Override selbst, und das ↺ loge.
//
// Run: node js/review/__tests__/wiki-model-override-save.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const {
	avesmapsWikiModelRawValue,
	avesmapsWikiModelPlanOverrideSaves,
} = require(path.resolve(__dirname, "..", "wiki-model-override-save.js"));

let checks = 0;
function gleich(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

// Ein eigener Knoten, wie ihn avesmapsWikiSyncMonitorCreateCustomNode anlegt: kein Staging-
// Datensatz, der Name lebt AUSSCHLIESSLICH im Override. `name` traegt die Server-Faltung.
const eigenerKnoten = {
	wiki_key: "eigener-knoten:knoten092",
	name: "Sarslund",     // gefaltet: Staging (leer) -> Override -> wiki_key
	wiki_name: "",        // der rohe Staging-Stand: es gibt keinen
	type: "",
	continent: "Aventurien", // gefaltet: eigene Knoten bekommen den Default
	wiki_continent: "",
	overrides: { name: "Sarslund" },
};

// ---- Riegel 2: der rohe Wiki-Stand ist leer, nicht der Override -------------------------------
gleich(avesmapsWikiModelRawValue(eigenerKnoten, "name"), "",
	"Der Wiki-Stand eines eigenen Knotens ist leer — nicht sein eigener Override.");
gleich(avesmapsWikiModelRawValue(eigenerKnoten, "continent"), "",
	"Der Kontinent-Default 'Aventurien' ist Anzeige, kein Wiki-Stand.");
gleich(avesmapsWikiModelRawValue(eigenerKnoten, "type"), "",
	"Nicht gefaltete Felder kommen unveraendert durch.");

// 💣 Fehlt das rohe Feld im Payload (alte Antwort im Cache), gilt LEER — niemals der Rueckfall
// auf das gefaltete Feld. Der Unterschied ist nicht kosmetisch: leer fuehrt in den harmlosen
// „setzen"-Zweig, der Rueckfall fuehrte in den loeschenden.
gleich(avesmapsWikiModelRawValue({ name: "Sarslund", overrides: {} }, "name"), "",
	"Ohne wiki_name gilt leer, nie das gefaltete name.");

// ---- Riegel 1: Fall #72, wortwoertlich ---------------------------------------------------------
// Nottel traegt die Staatsform ein und ruehrt den Anzeigenamen nicht an.
gleich(
	avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, [
		{ key: "name", value: "Sarslund", initialValue: "Sarslund" },
		{ key: "type", value: "Tá'akîb", initialValue: "" },
	]),
	[{ action: "set_field_override", fieldKey: "type", value: "Tá'akîb" }],
	"Der unangetastete Anzeigename darf KEINEN Aufruf ausloesen — das war Fall #72.",
);

// Und der Name haelt auch beim naechsten Speichern. Der Workaround musste frueher nach jedem
// Speichervorgang wiederholt werden; genau das ist hier vorbei.
gleich(
	avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, [
		{ key: "name", value: "Sarslund", initialValue: "Sarslund" },
		{ key: "status", value: "Baronie", initialValue: "" },
	]),
	[{ action: "set_field_override", fieldKey: "status", value: "Baronie" }],
	"Auch der zweite Speichervorgang laesst den Namen stehen.",
);

// ---- Der Name laesst sich weiterhin aendern ----------------------------------------------------
gleich(
	avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, [
		{ key: "name", value: "Sarslund-West", initialValue: "Sarslund" },
	]),
	[{ action: "set_field_override", fieldKey: "name", value: "Sarslund-West" }],
	"Ein geaenderter Name wird gesetzt.",
);

// ---- Zuruecksetzen von Hand bleibt moeglich (Riegel 1 allein wuerde das verlieren) -------------
const wikiKnoten = {
	wiki_key: "wiki:baronie-sarslund",
	name: "Sarslund (Wiki)",
	wiki_name: "Sarslund (Wiki)",
	type: "Baronie",
	overrides: { name: "Sarslund" },
};
gleich(
	avesmapsWikiModelPlanOverrideSaves(wikiKnoten, [
		{ key: "name", value: "Sarslund (Wiki)", initialValue: "Sarslund" },
	]),
	[{ action: "clear_field_override", fieldKey: "name" }],
	"Wer den Wiki-Stand von Hand eintraegt, loescht den Override wie bisher.",
);

// ⚠️ Ohne bestehenden Override gibt es nichts zu loeschen — kein Leer-Aufruf.
gleich(
	avesmapsWikiModelPlanOverrideSaves(
		{ name: "Baronie", wiki_name: "Baronie", type: "Baronie", overrides: {} },
		[{ key: "type", value: "Baronie", initialValue: "" }],
	),
	[],
	"Gleich wie der Wiki-Stand und kein Override vorhanden -> gar kein Aufruf.",
);

// ---- Der Kontinent-Sonderfall bleibt erhalten --------------------------------------------------
// „— (Wiki)" heisst KEIN Override. Ein leerer Wert darf nie als Override geschrieben werden,
// auch dann nicht, wenn der rohe Wiki-Stand gefuellt ist.
gleich(
	avesmapsWikiModelPlanOverrideSaves(
		{ continent: "Myranor", wiki_continent: "Myranor", overrides: { continent: "Aventurien" } },
		[{ key: "continent", value: "", initialValue: "Aventurien", clearWhenEmpty: true }],
	),
	[{ action: "clear_field_override", fieldKey: "continent" }],
	"Leere Kontinentwahl loescht den Override, statt '' zu schreiben.",
);
gleich(
	avesmapsWikiModelPlanOverrideSaves(
		{ continent: "Myranor", wiki_continent: "Myranor", overrides: {} },
		[{ key: "continent", value: "", initialValue: "Myranor", clearWhenEmpty: true }],
	),
	[],
	"Leere Kontinentwahl ohne Override -> kein Aufruf.",
);

// ---- Ein bewusst geleertes Textfeld bleibt ein Loeschen ----------------------------------------
gleich(
	avesmapsWikiModelPlanOverrideSaves(
		{ ruler: "", wiki_name: "", overrides: { ruler: "Nottel" } },
		[{ key: "ruler", value: "", initialValue: "Nottel" }],
	),
	[{ action: "clear_field_override", fieldKey: "ruler" }],
	"Ein geleertes Feld faellt auf den (leeren) Wiki-Stand zurueck.",
);

// ---- Robustheit --------------------------------------------------------------------------------
gleich(avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, []), [], "Keine Felder -> kein Aufruf.");
gleich(avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, null), [], "Kein Array -> kein Aufruf.");
gleich(
	avesmapsWikiModelPlanOverrideSaves(eigenerKnoten, [{ key: "", value: "x", initialValue: "" }]),
	[],
	"Feld ohne Schluessel wird uebergangen.",
);

console.log(`wiki-model-override-save: ${checks} Zusicherungen gruen.`);
