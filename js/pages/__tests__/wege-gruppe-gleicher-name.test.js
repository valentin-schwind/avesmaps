"use strict";
// „Ganze Straße" heisst GLEICHER NAME (Owner 15.09.2026: „die selektion soll ausdrücklich über den namen - nicht über die
// wiki-zuweisung erfolgen"). AUSGEFUEHRT: die Regel im Modell (wpGroupKeyOf/wpGroupWays), der Gruppenschluessel der Karte
// (path-einschraenkung.js mit dem ECHTEN getPathTitleName und shouldShowRoutePathDisplayName), die Gruppen der Karte
// (weg-abschnitte.js) -- und die Spiegelung des echten Namens zum Server (avesmapsWikiPathEchterName,
// api/_internal/wiki/path-naming.php), aus der die Wege-Editor-Liste ihren Schluessel bekommt.
// Aus der Wurzel: node js/pages/__tests__/wege-gruppe-gleicher-name.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));

// ---- 1. Die Regel im Modell -------------------------------------------------------------------------------------
const zeile = (id, echt, extra) => Object.assign({
	public_id: id, name: echt || "Strasse-" + id, echter_name: echt, feature_subtype: "Reichsstrasse",
	wiki_path: null, bbox: [Number(id.replace(/\D/g, "")) || 0, 0, 0, 0],
}, extra || {});
const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };

// Gemischte Wiki-Zuweisung, gleicher Name: EINE Gruppe (live: 49 mit, 18 ohne Zuweisung waren zwei Gruppen)
const gemischt = M.wpGroupWays([zeile("a1", "Reichsstraße 2"), zeile("a2", "Reichsstraße 2", { wiki_path: RS2 }), zeile("a3", "Reichsstraße 2")]);
assert.strictEqual(gemischt.length, 1, "gemischte Wiki-Zuweisung, gleicher Name: eine Gruppe");
assert.strictEqual(gemischt[0].key, "name:Reichsstraße 2");
assert.strictEqual(gemischt[0].name, "Reichsstraße 2");
assert.deepStrictEqual(gemischt[0].segments.map((s) => s.public_id), ["a1", "a2", "a3"]);
assert.strictEqual(gemischt[0].wiki_path, RS2, "die Gruppe nennt die Zuweisung, die in ihr steht -- auch wenn der erste Abschnitt keine traegt");
assert.deepStrictEqual([...M.wpGruppeHauptzuweisungen(gemischt[0].segments)], ["", "reichsstrasse-2"],
	"die Hauptzuweisungen der Gruppe, „keine“ als leerer Schluessel, in Abschnittsreihenfolge");
assert.deepStrictEqual([...M.wpGruppeHauptzuweisungen([zeile("x1", "A", { wiki_path: RS2 }), zeile("x2", "A", { wiki_path: RS2 })])], ["reichsstrasse-2"]);
assert.deepStrictEqual([...M.wpGruppeHauptzuweisungen([])], []);

// Die Gruppe heisst nach dem echten Namen, nicht nach dem ersten Abschnitt: ein Altsegment traegt noch „Reichsstrasse-16"
const alt = M.wpGroupWays([
	zeile("f1", "Reichsstraße 2", { name: "Reichsstrasse-16", wiki_path: RS2 }),
	zeile("f2", "Reichsstraße 2"),
]);
assert.strictEqual(alt.length, 1);
assert.strictEqual(alt[0].segments[0].name, "Reichsstrasse-16", "Voraussetzung: der erste Abschnitt heisst anders");
assert.strictEqual(alt[0].name, "Reichsstraße 2", "der Gruppenkopf zeigt den echten Namen");

// Verschiedene Wegart, gleicher Name: EINE Gruppe (gewollt: Fluss und Strasse gleichen Namens)
const arten = M.wpGroupWays([zeile("b1", "Inoscha", { feature_subtype: "Flussweg" }), zeile("b2", "Inoscha", { feature_subtype: "Strasse" })]);
assert.strictEqual(arten.length, 1, "verschiedene Wegart, gleicher Name: eine Gruppe");

// Maschinenname oder gar keiner: jeder Abschnitt seine eigene Gruppe
const maschinell = M.wpGroupWays([
	{ public_id: "c1", name: "Strasse-17", echter_name: "", feature_subtype: "Strasse" },
	{ public_id: "c2", name: "Flussweg", echter_name: "", feature_subtype: "Flussweg" },
	{ public_id: "c3", name: "Flussweg", echter_name: "", feature_subtype: "Flussweg" },
]);
assert.deepStrictEqual(maschinell.map((g) => g.key), ["abschnitt:c1", "abschnitt:c2", "abschnitt:c3"], "ohne echten Namen keine Strasse");
// 💣 Kein Rueckfall auf `name`: der traegt fuer die Karte den Maschinennamen, und zwei nackte „Flussweg“ waeren sonst EIN Weg.
assert.strictEqual(M.wpGroupWays([{ public_id: "d1", name: "Flussweg" }, { public_id: "d2", name: "Flussweg" }]).length, 2,
	"fehlt der echte Name, faellt die Regel NICHT auf `name` zurueck");

// Zwei verschiedene echte Namen: zwei Gruppen
assert.strictEqual(M.wpGroupWays([zeile("e1", "Alte Straße"), zeile("e2", "Neue Straße")]).length, 2);

// Verglichen wird exakt nach trim(): Gross-/Kleinschreibung und Umlaute zaehlen
assert.strictEqual(M.wpGroupKeyOf({ echter_name: "  Reichsstraße 2 " }), "name:Reichsstraße 2");
assert.notStrictEqual(M.wpGroupKeyOf({ echter_name: "reichsstraße 2" }), M.wpGroupKeyOf({ echter_name: "Reichsstraße 2" }));
assert.notStrictEqual(M.wpGroupKeyOf({ echter_name: "Reichsstrasse 2" }), M.wpGroupKeyOf({ echter_name: "Reichsstraße 2" }));
assert.strictEqual(M.wpGroupKeyOf({ public_id: "p", echter_name: "   " }), "abschnitt:p");

// ---- 2. Der Gruppenschluessel der Karte: dieselbe Regel, der echte Name aus getPathTitleName ------------------------
const ctx = { console, module: undefined };
vm.createContext(ctx);
const config = lies("js/config.js");
const stueck = (marke) => {
	const rest = config.slice(config.indexOf(marke));
	const ende = rest.indexOf("\n};");
	return (ende >= 0 && ende < 4000) ? rest.slice(0, ende + 3) : rest.slice(0, rest.indexOf("\n"));
};
const schneideFunktion = (quelle, name) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, "function " + name + " nicht gefunden -- umbenannt?");
	return treffer[0] + "\n";
};
vm.runInContext(stueck("const PATH_SUBTYPE_KEYS"), ctx);
vm.runInContext(stueck("const TRANSPORT_DOMAIN_OPTIONS"), ctx);
vm.runInContext('const SYNTHETIC_ROUTE_TYPE = "Querfeldein";', ctx);
vm.runInContext(lies("js/map-features/map-features-path-domain.js"), ctx);
const route = lies("js/routing/route-node.js");
["getRoutePathDisplayName", "escapeRouteDisplayRegex", "shouldShowRoutePathDisplayName"].forEach((name) => vm.runInContext(schneideFunktion(route, name), ctx));
vm.runInContext(schneideFunktion(lies("js/map-features/map-features-path-prepare.js"), "normalizeRoutePathFeature"), ctx);
vm.runInContext(lies("js/pages/wege-editor-model.js"), ctx);
vm.runInContext(lies("js/map-features/path-einschraenkung.js"), ctx);
ctx.__arg = null;
const rufe = (ausdruck, arg) => { ctx.__arg = arg; return vm.runInContext(ausdruck, ctx); };

// Ein Kartenweg, wie ihn der Browser nach dem Laden haelt (normalizeRoutePathFeature schreibt `<Wegart>-<n>` nach name).
let laufendeNummer = 0;
const kartenweg = (id, properties) => {
	laufendeNummer += 1;
	return rufe("normalizeRoutePathFeature(__arg, " + laufendeNummer + ")", {
		properties: Object.assign({ public_id: id }, properties), geometry: { coordinates: [[0, 0], [1, 1]] },
	});
};
const schluessel = (weg) => rufe("avesmapsWegGruppenSchluessel(__arg)", weg);

const mitWiki = kartenweg("k1", { name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", wiki_path: RS2 });
const ohneWiki = kartenweg("k2", { name: "Reichsstraße 2", feature_subtype: "Reichsstrasse" });
assert.ok(/^Reichsstrasse-\d+$/.test(mitWiki.properties.name), "Voraussetzung: properties.name traegt im Browser den Maschinennamen");
assert.strictEqual(schluessel(mitWiki), "name:Reichsstraße 2");
assert.strictEqual(schluessel(ohneWiki), schluessel(mitWiki), "Karte: mit und ohne Wiki-Zuweisung derselbe Weg");
assert.strictEqual(schluessel(kartenweg("k3", { name: "Inoscha", feature_subtype: "Flussweg" })),
	schluessel(kartenweg("k4", { name: "Inoscha", feature_subtype: "Strasse" })), "Karte: Fluss und Strasse gleichen Namens");
assert.strictEqual(schluessel(kartenweg("k5", { name: "Strasse-17", feature_subtype: "Strasse" })), "abschnitt:k5", "Karte: Maschinenname");
assert.strictEqual(schluessel(kartenweg("k6", { feature_subtype: "Flussweg" })), "abschnitt:k6", "Karte: gar kein Name (display_name faellt auf die Wegart)");
assert.strictEqual(schluessel(kartenweg("k7", { name: "Reichsstrasse-16", feature_subtype: "Reichsstrasse", wiki_path: RS2 })), "name:Reichsstraße 2",
	"Karte: ein Altsegment mit Maschinennamen trotz Zuweisung heisst so, wie die Infobox es nennt (getPathTitleName: Rueckfall auf den Wiki-Namen)");
// 🔴 Seit 15.09.2026 gehoert der Wegname dem Editor (R1 umgekehrt): ein UMBENANNTER zugewiesener Abschnitt verlaesst die Strasse seines
// Artikels und gehoert zu seinem neuen Namen -- genau die Regel „ganze Straße = gleicher Name".
assert.strictEqual(schluessel(kartenweg("k8", { name: "Alter Bärenpfad", feature_subtype: "Pfad", wiki_path: RS2 })), "name:Alter Bärenpfad",
	"Karte: der eigene Name eines zugewiesenen Abschnitts bildet den Schluessel, nicht der Artikel");
assert.strictEqual(schluessel(mitWiki), M.wpGroupKeyOf({ public_id: "k1", echter_name: "Reichsstraße 2" }),
	"Karte und Wege-Editor-Liste bilden DENSELBEN Schluessel");

// ---- 3. Die Gruppen der Karte (weg-abschnitte.js) ------------------------------------------------------------------
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	getPathTitleName: (p) => rufe("getPathTitleName(__arg)", p),
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01, isCrossingLocation: () => false, mapDataSourceStatus: { revision: 1 }, locationData: [],
});
const W = require(path.join(WURZEL, "js/map-features/weg-abschnitte.js"));
const mitGeometrie = (weg, von, bis) => Object.assign(weg, { geometry: { coordinates: [von, bis] } });
global.pathData = [
	mitGeometrie(kartenweg("r1", { name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", wiki_path: RS2 }), [0, 0], [1, 0]),
	mitGeometrie(kartenweg("r2", { name: "Reichsstraße 2", feature_subtype: "Reichsstrasse" }), [1, 0], [2, 0]),
	mitGeometrie(kartenweg("r3", { name: "Reichsstraße 2", feature_subtype: "Strasse", wiki_path: RS2 }), [2, 0], [3, 0]),
	mitGeometrie(kartenweg("m1", { name: "Strasse-9", feature_subtype: "Strasse" }), [2, 0], [2, 5]),
];
assert.strictEqual(W.avesmapsWegAlsWay(global.pathData[1]).echter_name, "Reichsstraße 2", "der Kartenleser traegt den echten Namen");
assert.strictEqual(W.avesmapsWegAlsWay(global.pathData[3]).echter_name, "", "... und fuer einen Maschinennamen keinen");
assert.deepStrictEqual(W.avesmapsWegGruppeAufKarte(global.pathData[1]).map((w) => w.public_id), ["r1", "r2", "r3"],
	"der erste Klick markiert alles, was den Namen traegt -- gleich welche Zuweisung und Wegart");
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[2]), "Abschnitt 3: Wegende – Wegende", "die Nummer zaehlt ueber die ganze Namensgruppe");
assert.deepStrictEqual(W.avesmapsWegGruppeAufKarte(global.pathData[3]).map((w) => w.public_id), ["m1"], "ein maschinell benannter Abschnitt bleibt allein");

// ---- 4. Die Spiegelung zum Server: derselbe echte Name fuer dieselbe Zeile ------------------------------------------
// Die Wege-Editor-Liste (paths-editor.php) bekommt ihn vom Server, die Karte rechnet ihn im Browser. Laufen die zwei
// auseinander, traegt derselbe Abschnitt auf der Karte eine andere Nummer als im Editor -- still.
const tafel = [
	// [properties_json, Spalte name, Wegart, echter Name]
	[{ wiki_path: { name: "Reichsstraße 2" }, display_name: "Reichsstrasse-16" }, "Reichsstrasse-16", "Reichsstrasse", "Reichsstraße 2"],
	[{ display_name: "Reichsstraße 2" }, "Reichsstraße 2", "Reichsstrasse", "Reichsstraße 2"],
	[{}, "Goblinpfad", "Pfad", "Goblinpfad"],
	[{}, "Strasse-17", "Strasse", ""],
	[{ display_name: "Flussweg" }, "Flussweg", "Flussweg", ""],
	[{}, "", "Weg", ""],
	[{ display_name: "Meer-835" }, "Meer-835", "Seeweg", ""],
	[{ original_name: "Alte Straße" }, "Strasse-4", "Strasse", "Alte Straße"],
	[{ display_name: "Weg" }, "Weg", "Pfad", "Weg"],
	[{ wiki_path: { name: "  " }, display_name: "Yasamirer Stieg" }, "Pfad-3", "Pfad", "Yasamirer Stieg"],
	[{ display_name: " Reichsstraße 2 " }, "Reichsstrasse-8", "Reichsstrasse", "Reichsstraße 2"],
	[{ display_name: "Weg-17 nach Gareth" }, "Weg-17 nach Gareth", "Weg", "Weg-17 nach Gareth"],
	// 🔴 Seit 15.09.2026 (R1 umgekehrt, der Wegname gehoert dem Editor): der eigene echte Name schlaegt den Artikelnamen ...
	[{ wiki_path: { name: "Reichsstraße 2" }, display_name: "Alte Reichsstraße" }, "Alte Reichsstraße", "Reichsstrasse", "Alte Reichsstraße"],
	[{ wiki_path: { name: "Reichsstraße 2" }, display_name: "Reichsstrasse 2" }, "Reichsstrasse 2", "Reichsstrasse", "Reichsstrasse 2"],
	[{ wiki_path: { name: "Bärenpfad" }, original_name: "Oberer Bärenpfad" }, "Pfad-9", "Pfad", "Oberer Bärenpfad"],
	// ... der nackte Wegtyp und <wort>-<zahl> sind keiner, dann gilt der Artikel
	[{ wiki_path: { name: "Bärenpfad" }, display_name: "Pfad" }, "Pfad", "Pfad", "Bärenpfad"],
	[{ wiki_path: { name: "Inoscha" }, display_name: "Meer-12" }, "Meer-12", "Flussweg", "Inoscha"],
];
const jsUrteil = tafel.map(([properties, spalte, wegart]) => rufe("getPathTitleName(__arg)",
	kartenweg("t", Object.assign({}, properties, { name: spalte, feature_subtype: wegart }))));
const phpSkript = "<?php\nrequire __DIR__ . '/api/_internal/wiki/path-naming.php';\n"
	+ "$faelle = json_decode(file_get_contents('php://stdin'), true);\n"
	+ "echo json_encode(array_map(fn(array $f) => avesmapsWikiPathEchterName((array) $f[0], (string) $f[1], (string) $f[2]), $faelle));";
const skriptPfad = path.join(WURZEL, ".weg-echter-name-probe.php");
let phpUrteil;
try {
	fs.writeFileSync(skriptPfad, phpSkript, "utf8");
	phpUrteil = JSON.parse(execFileSync("php", [skriptPfad], {
		cwd: WURZEL, encoding: "utf8",
		input: JSON.stringify(tafel.map(([properties, spalte, wegart]) => [properties, spalte, wegart])),
	}));
} finally {
	fs.rmSync(skriptPfad, { force: true });
}
tafel.forEach(([properties, spalte, wegart, erwartet], i) => {
	assert.strictEqual(jsUrteil[i], erwartet, "Browser: " + JSON.stringify([properties, spalte, wegart]));
	assert.strictEqual(phpUrteil[i], erwartet, "Server: " + JSON.stringify([properties, spalte, wegart]));
});

// ---- 5. Die Liste schickt ihn ----------------------------------------------------------------------------------------
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const liste = ohneKommentare(lies("api/edit/map/paths-editor.php"));
assert.ok(/'echter_name'\s*=>\s*avesmapsWikiPathEchterName\(\$properties,\s*\(string\) \(\$row\['name'\] \?\? ''\),\s*\$subtype\)/.test(liste),
	"paths-editor.php schickt je Zeile den echten Namen ueber DENSELBEN Helfer");

console.log("wege-gruppe-gleicher-name.test.js: ok");
