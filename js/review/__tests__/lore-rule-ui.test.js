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

// Der Landschaftsart-Katalog kommt seit Fix-Runde 1 vom Server (api/edit/map/ecosystem.php, Aktion
// "region_types" -> avesmapsListEcosystemRegionTypes()) und liegt im Modulzustand
// avesmapsLoreRuleTypeLabels, geschluesselt "<kind>|<type_key>". Hier direkt gesetzt, wie
// avesmapsLoreRuleLoadTypeLabels() ihn nach einem echten Abruf ablegen wuerde -- ohne echten Fetch
// im vm-Sandkasten. "auenlandschaft" bleibt absichtlich DRAUSSEN: der Fall dafuer steht weiter unten.
context.avesmapsLoreRuleTypeLabels = {
	"vegetation|wald": "Wald",
	"vegetation|suempfe_moore": "Sümpfe und Moore",
	"topographie|gebirge": "Gebirge",
};

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

// 💣 Befund 1 (Fix-Runde 1): eine Art im Katalog erscheint mit ihrer ECHTEN Beschriftung; eine, die
// der Katalog nicht kennt, erscheint als ROHER SCHLUESSEL -- nie als Vermutung. Bewusst
// "auenlandschaft": der verworfene erste Textumbau (ue -> ü, angewandt auf den ganzen Schluessel)
// traf mitten im Wort ("a-U-E-nlandschaft") und schrieb "Aünlandschaft" -- sichtbar falsches
// Deutsch, das aussah, als waere es richtig. Kein Textumbau mehr: ein unbekannter Schluessel bleibt
// unbekannt und sichtbar roh, statt geraten und falsch.
const bekannteUndUnbekannteArt = { id: 7, relation: "verbreitung", terms: [term({
	types: [
		{ kind: "vegetation", region_type: "wald" },
		{ kind: "vegetation", region_type: "auenlandschaft" },
	],
})] };
const satzArten = context.avesmapsLoreRuleSentence(bekannteUndUnbekannteArt, zoneLabels);
assert.ok(satzArten.includes("Wald"), "die bekannte Art zeigt ihre Katalog-Beschriftung");
assert.ok(satzArten.includes("auenlandschaft"), "die unbekannte Art zeigt den rohen Schluessel");
assert.ok(!satzArten.includes("Aünlandschaft") && !satzArten.includes("Auenlandschaft"),
	"kein geratener Textumbau -- weder das kaputte noch ein zufaellig richtig aussehendes Ergebnis");

// 💣 ZWEI Faltungen, nicht eine. NFD-Strippen macht aus „Wüste" ein „wuste", getippt wird aber
// „wueste" -- beide Seiten muessen zusaetzlich durch ue/oe/ae -> u/o/a, sonst findet „wueste"
// die Wueste NICHT. Im Mockup gemessen, nicht vermutet.
const key = context.avesmapsLoreRuleSearchKey;
assert.strictEqual(key("Wüste"), key("wueste"), "beide Schreibweisen treffen sich");
assert.strictEqual(key("Sümpfe und Moore"), key("suempfe und moore"));
assert.strictEqual(key("Große Fluss"), key("grosse fluss"), "das scharfe S faellt auf ss");
assert.notStrictEqual(key("Wald"), key("Steppe"), "verschiedene Arten bleiben verschieden");

// Arten an- und abwaehlen, ohne die uebrige Bedingung anzufassen.
let t = term({ climate_from: "boreal", climate_to: "gemaessigt" });
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1);
assert.strictEqual(t.types[0].kind, "vegetation");
assert.strictEqual(t.types[0].region_type, "wald");
assert.strictEqual(t.climate_from, "boreal", "das Klima bleibt unberuehrt");

t = context.avesmapsLoreRuleTermToggleType(t, "topographie/gebirge");
assert.strictEqual(t.types.length, 2);
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1, "dieselbe Art nochmal waehlt sie ab");
assert.strictEqual(t.types[0].region_type, "gebirge", "und zwar die richtige");

// 💣 Die vorigen Asserts biessen NICHT gegen `splice(0, 1)` statt `splice(at, 1)`: die abgewaehlte
// Art (Wald) stand zufaellig an Index 0, ein falscher, fest auf 0 verdrahteter Index traf also
// dieselbe. Erst eine Kette, in der die abgewaehlte Art NICHT die erste ist, zeigt, ob wirklich der
// gefundene Index geloescht wird -- hier: Wald UND Gebirge stehen, ab-gewaehlt wird Gebirge (Index 1).
let t2 = term({});
t2 = context.avesmapsLoreRuleTermToggleType(t2, "vegetation/wald");
t2 = context.avesmapsLoreRuleTermToggleType(t2, "topographie/gebirge");
t2 = context.avesmapsLoreRuleTermToggleType(t2, "topographie/gebirge");
assert.strictEqual(t2.types.length, 1, "die abgewaehlte Art (nicht die erste) ist weg");
assert.strictEqual(t2.types[0].region_type, "wald", "die STEHENGEBLIEBENE Art ist die richtige");

// 💣 Toggle gibt eine NEUE Bedingung zurueck und aendert das Original NICHT -- sonst haette eine
// Karte, die dieselbe Bedingung noch zeigt, waehrend der Editor sie schon bearbeitet, den falschen
// Stand. Das Original bleibt bei EINEM Eintrag (Wald), obwohl `t` inzwischen bei „Gebirge" steht.
const original = term({ types: [{ kind: "vegetation", region_type: "wald" }] });
const toggled = context.avesmapsLoreRuleTermToggleType(original, "topographie/gebirge");
assert.strictEqual(original.types.length, 1, "das Original behaelt seine eine Art");
assert.strictEqual(original.types[0].region_type, "wald", "und zwar die urspruengliche");
assert.strictEqual(toggled.types.length, 2, "die Kopie traegt beide");

console.log("lore-rule-ui: OK");
