// Die reinen Teile des Regeleditors. Sie bauen Text und Markup aus Daten -- genau das ist ohne
// Browser pruefbar, und genau daran ist im Haus schon Escaping danebengegangen.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// Die echten Globals installieren, keine Fakes: ein gestubbter Escaper wuerde die
// Escaping-Fehler verstecken, um die es hier geht.
const context = { window: {}, document: undefined, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/app/utils.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/review/review-lore-rule.js", "utf8"), context);

const zoneLabels = {
	polar: "Polare Zone", subpolar: "Subpolare Zone", boreal: "Boreale Zone",
	gemaessigt: "Gemäßigte Zone", subtropen_winterfeucht: "Winterfeuchte Subtropen",
	trockene_subtropen: "Subtropische Steppenzone", subtropisch: "Subtropische Wüstenzone",
	tropisch: "Tropische Zone",
};
const term = (over) => Object.assign(
	{ join_op: "und", area_public_id: null, area_name: "", climate_from: null, climate_to: null, types: [] },
	over
);

// Eine Bedingung, zwei Felder: Art UND Klima.
const einfach = { id: 1, relation: "verbreitung", terms: [term({
	types: [{ kind: "vegetation", region_type: "wald" }],
	climate_from: "boreal", climate_to: "gemaessigt",
})] };
const satz = context.avesmapsLoreRuleSentence(einfach, zoneLabels);
assert.ok(satz.includes("Wald"), "die Art steht im Satz");
assert.ok(satz.includes("Boreale Zone") && satz.includes("Gemäßigte Zone"), "beide Enden der Spanne");
assert.ok(satz.includes("zwischen"), "eine Spanne liest sich als Spanne");

// EINE Zone ist keine Spanne -- „zwischen X und X" waere Kauderwelsch.
const eine = { id: 2, relation: "verbreitung", terms: [term({ climate_from: "boreal", climate_to: "boreal" })] };
const satzEine = context.avesmapsLoreRuleSentence(eine, zoneLabels);
assert.ok(!satzEine.includes("zwischen"), "eine einzelne Zone ohne 'zwischen'");
assert.ok(satzEine.includes("Boreale Zone"));

// Mehrere Arten in EINER Bedingung sind ein ODER, zwei Bedingungen tragen ihr eigenes Wort.
const kette = { id: 3, relation: "verbreitung", terms: [
	term({ types: [{ kind: "vegetation", region_type: "wald" }, { kind: "vegetation", region_type: "suempfe_moore" }] }),
	term({ join_op: "oder", types: [{ kind: "topographie", region_type: "gebirge" }] }),
] };
const satzKette = context.avesmapsLoreRuleSentence(kette, zoneLabels);
assert.ok(satzKette.includes("Wald") && satzKette.includes("Sümpfe und Moore") && satzKette.includes("Gebirge"));
assert.ok(satzKette.includes("oder"), "die Verknuepfung der zweiten Bedingung steht da");

// 💣 Der Fund oben allein beisst nicht: mehrere Arten in EINER Bedingung schreiben ihr eigenes
// "oder" (types.join) -- das steht selbst dann noch da, wenn der join_op der ZWEITEN Bedingung
// ignoriert und immer "und" geschrieben wird. Erst eine Kette OHNE Mehrfach-Typen zeigt, ob
// join_op wirklich gelesen wird und nicht bloss zufaellig durchscheint.
const ketteOhneTypen = { id: 6, relation: "verbreitung", terms: [
	term({ area_public_id: "b1", area_name: "Erstgebiet" }),
	term({ join_op: "oder", area_public_id: "b2", area_name: "Zweitgebiet" }),
] };
const satzKetteOhneTypen = context.avesmapsLoreRuleSentence(ketteOhneTypen, zoneLabels);
assert.ok(satzKetteOhneTypen.includes("<b>oder</b>"), "join_op der zweiten Bedingung wird gelesen, nicht uebergangen");
assert.ok(!satzKetteOhneTypen.includes("<b>und</b>"), "kein festverdrahtetes 'und' zwischen den Bedingungen");

// 💣 Der Flaechenname kommt aus der Datenbank und wird ESCAPED. Ohne das traegt ein Name mit
// spitzer Klammer fremdes Markup in die Editorliste.
const boese = { id: 4, relation: "verbreitung", terms: [term({
	area_public_id: "a1", area_name: '<img src=x onerror="alert(1)">',
})] };
const markup = context.avesmapsLoreRuleCardMarkup(boese, zoneLabels);
assert.ok(!markup.includes("<img"), "der Name darf kein Markup einschleusen");
assert.ok(markup.includes("&lt;img"), "er steht escaped drin");

// Eine leere Regel gibt es nicht -- der Server laesst sie nicht zu. Der Satzbauer darf trotzdem
// nicht werfen, sonst reisst eine kaputte Datenzeile die ganze Liste ab.
assert.doesNotThrow(() => context.avesmapsLoreRuleSentence({ id: 5, relation: "", terms: [] }, zoneLabels));

console.log("lore-rule-ui: OK");
