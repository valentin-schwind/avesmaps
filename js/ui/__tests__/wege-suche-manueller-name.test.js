const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

// Der Spotlight-Index vor den Wegen -- und die Spiegelung zum Server.
// =========================================================================
// Owner-Meldung 01.09.2026: „der goblinpfad ist ein manuell angelegter weg mit namen der aber
// nicht in der suche auftaucht ... auch fuer alle anderen manuell umbenannte objekte."
//
// 💣 DIESE SEITE IST DIE HAELFTE, DIE MAN VERGISST. Der Endpunkt entscheidet, WAS die Suche
// anbietet -- aber resolveBackendSpotlightEntries wirft jeden Servertreffer wortlos weg, den
// dieser Index nicht kennt (`if (!entry ...) return;`). Ein nur serverseitig geoeffneter Riegel
// haette also nichts geaendert und dabei ausgesehen, als sei die Suche kaputt statt die Regel.
//
// Die Bauteile werden namentlich aus den ausgelieferten Dateien geschnitten und ausgefuehrt --
// browserseitige <script>-Globals, kein module.exports; dasselbe Verfahren wie in
// spotlight-scoring.test.js nebenan. Damit laeuft hier der ECHTE Code, keine Abschrift.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/wege-suche-manueller-name.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

const spotlightQuelle = lies("js/ui/spotlight-search.js");
const wegeQuelle = lies("js/map-features/map-features-path-domain.js");
const routeQuelle = lies("js/routing/route-node.js");
const configQuelle = lies("js/config.js");

const schneideFunktion = (name, quelle, wo) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, `function ${name}() nicht in ${wo} gefunden -- umbenannt?`);
	return treffer[0] + "\n";
};

const schneideConst = (name, quelle, wo) => {
	const treffer = quelle.match(new RegExp("\\nconst " + name + " = [^\\n]*;"));
	assert.ok(treffer, `const ${name} nicht in ${wo} gefunden -- umbenannt?`);
	return treffer[0] + "\n";
};

// `const NAME = { ... };` -- die mehrzeilige Objektform, die PATH_TYPE_LABEL traegt.
const schneideObjekt = (name, quelle, wo) => {
	const treffer = quelle.match(new RegExp("\\nconst " + name + " = \\{[\\s\\S]*?\\n\\};"));
	assert.ok(treffer, `const ${name} = {…} nicht in ${wo} gefunden -- umbenannt?`);
	return treffer[0] + "\n";
};

// `const name = (arg) => { ... };` -- die Pfeilform, die normalizePathName traegt.
const schneidePfeil = (name, quelle, wo) => {
	const treffer = quelle.match(new RegExp("\\nconst " + name + " = \\([\\s\\S]*?\\n\\};"));
	assert.ok(treffer, `const ${name} = (…) => {…} nicht in ${wo} gefunden -- umbenannt?`);
	return treffer[0] + "\n";
};

const kontext = {
	Infinity, Math, String, Number, Boolean, Array, Map, RegExp, JSON,
	// Nicht Gegenstand dieses Tests: die Ausmasse holt Leaflet, das Label die i18n-Tabelle.
	// Attrappen, damit der Zweig darum herum echt laufen kann.
	extendSpotlightBounds: () => null,
	getSpotlightPathBounds: () => null,
	getPathPublicId: (p) => p?.properties?.public_id || p?.id || "",
	tr: (schluessel, rueckfall) => rueckfall,
	pathData: [],
};

vm.runInNewContext(
	schneideConst("PATH_SUBTYPE_KEYS", configQuelle, "js/config.js")
		+ schneideConst("SYNTHETIC_ROUTE_TYPE", configQuelle, "js/config.js")
		+ schneidePfeil("normalizePathName", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("normalizePathSubtype", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("getPathDisplayName", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("getPathTitleName", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideObjekt("PATH_TYPE_LABEL", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("getPathTypeLabel", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("pathIstBach", wegeQuelle, "js/map-features/map-features-path-domain.js")
		+ schneideFunktion("getRoutePathDisplayName", routeQuelle, "js/routing/route-node.js")
		+ schneideFunktion("escapeRouteDisplayRegex", routeQuelle, "js/routing/route-node.js")
		+ schneideFunktion("shouldShowRoutePathDisplayName", routeQuelle, "js/routing/route-node.js")
		+ schneideFunktion("normalizeSpotlightSearchText", spotlightQuelle, "js/ui/spotlight-search.js")
		+ schneideFunktion("getSpotlightPathGroupKey", spotlightQuelle, "js/ui/spotlight-search.js")
		+ schneideFunktion("getSpotlightPathGroupKeyForPath", spotlightQuelle, "js/ui/spotlight-search.js")
		+ schneideFunktion("getSpotlightPathTypeLabel", spotlightQuelle, "js/ui/spotlight-search.js")
		+ schneideFunktion("buildSpotlightPathEntries", spotlightQuelle, "js/ui/spotlight-search.js"),
	kontext
);

const weg = (properties, publicId = "weg-1") => ({
	id: publicId,
	properties: { feature_type: "path", public_id: publicId, ...properties },
});

// ⚠️ `Array.from` ist kein Zierrat: die Liste entsteht IM vm-Kontext und traegt dessen
// eigenes Array.prototype. assert.deepStrictEqual vergleicht den Prototyp mit und meldet sonst
// zwei sichtbar gleiche Listen als ungleich -- eine Viertelstunde Fehlersuche an der falschen Stelle.
const index = (wege) => {
	kontext.pathData = wege;
	return Array.from(kontext.buildSpotlightPathEntries());
};

// ---- 1. DER ANLASS -----------------------------------------------------------------------------
const goblin = index([weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Pfad" })]);
assert.strictEqual(goblin.length, 1, "der Goblinpfad fehlt im Spotlight-Index -- genau die Meldung");
assert.strictEqual(goblin[0].name, "Goblinpfad");
assert.strictEqual(goblin[0].kind, "path");
assert.deepStrictEqual(Array.from(goblin[0].publicIds), ["weg-1"], "ohne public_id findet der Servertreffer seinen Eintrag nicht");

// ---- 2. DER ALTE GRUND BLEIBT ------------------------------------------------------------------
// 💣 Faellt diese Haelfte, stehen 2448 maschinelle Wegenamen in der Suche (gemessen 2026-07-20).
["Reichsstrasse-4903", "Weg-17", "Gebirgspass-42", "Meer-835", "Pfad", ""].forEach((muell) => {
	const treffer = index([weg({ name: muell, display_name: muell, feature_subtype: "Pfad" })]);
	assert.strictEqual(treffer.length, 0, `maschineller Name im Index gelandet: ${JSON.stringify(muell)}`);
});

// ---- 3. Der Wiki-Weg bleibt unveraendert vorn ---------------------------------------------------
// R1: die Zuweisung benennt den Weg, auch wenn das Segment noch einen Alt-Namen traegt. Diese
// Zusicherung ist AELTER als die Oeffnung und darf von ihr nicht angefasst worden sein.
const wiki = index([weg({
	name: "Reichsstrasse-16",
	display_name: "Reichsstrasse-16",
	feature_subtype: "Reichsstrasse",
	wiki_path: { name: "Reichsstraße 2", wiki_key: "wiki:reichsstrasse-2", wiki_url: "https://w/Reichsstrasse_2" },
})]);
assert.strictEqual(wiki.length, 1, "ein wiki-zugewiesener Weg muss im Index bleiben");
assert.strictEqual(wiki[0].name, "Reichsstraße 2", "der Wiki-Name schlaegt den Alt-Namen des Segments");

// ---- 4. Alle Abschnitte eines Wegs bilden EINEN Eintrag -----------------------------------------
// Sonst steht der Goblinpfad so oft in der Liste, wie er Abschnitte hat -- und die Auswahl zoomt
// auf ein Teilstueck statt auf den Weg.
const zweiTeile = index([
	weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Pfad" }, "weg-1"),
	weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Pfad" }, "weg-2"),
]);
assert.strictEqual(zweiTeile.length, 1, "zwei Abschnitte desselben Wegs muessen EIN Eintrag sein");
assert.deepStrictEqual(Array.from(zweiTeile[0].publicIds), ["weg-1", "weg-2"]);

// ---- 5. Der Servertreffer findet seinen Eintrag WIRKLICH ----------------------------------------
// 💣 Das ist die Naht, an der ein halber Umbau still scheitert: resolveBackendSpotlightEntries
// sucht ueber `getSpotlightPathGroupKey(result.name, result.feature_subtype)`. Stimmt der Index
// dort nicht ueberein, verschwindet der Treffer wortlos.
assert.strictEqual(
	kontext.getSpotlightPathGroupKeyForPath(
		weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Pfad" }),
		"Pfad"
	),
	kontext.getSpotlightPathGroupKey("Goblinpfad", "Pfad"),
	"der Index-Schluessel und der Nachschlage-Schluessel des Servertreffers laufen auseinander"
);

// ---- 6. DIE SPIEGELUNG: derselbe Name, dasselbe Urteil auf beiden Seiten ------------------------
// 💣 Der Server (avesmapsWikiPathNameIsGeneric, api/_internal/wiki/path-naming.php) und der
// Browser (shouldShowRoutePathDisplayName, js/routing/route-node.js) muessen dieselben drei Muster
// kennen. Laufen sie auseinander, ist die Folge STILL: der Server bietet Treffer an, die dieser
// Index nicht kennt, und sie erscheinen nie -- oder der Index fuehrt Wege, die kein Server je
// meldet. Deshalb wird hier wirklich BEIDES gefahren, nicht zwei Tabellen verglichen.
//
// 🪤 DIE WEGART GEHOERT IN DIE TAFEL, und genau daran ist der erste Bau gescheitert: der nackte
// Wegtyp wird gegen die EIGENE Wegart des Wegs geprueft, nicht gegen alle acht. Ein Pfad namens
// „Weg" ist deshalb ein Name (die Karte zeichnet ihn), ein Weg namens „Weg" ist keiner. Eine
// Tafel ohne Wegart kann diesen Unterschied nicht ausdruecken und haette ihn zugedeckt.
// ⚠️ `php` ist vorausgesetzt: der Deploy-Workflow faehrt PHP- und JS-Testfeld im SELBEN Job.
const tafel = [
	// [Name, Wegart des Wegs, maschinell?]
	// Muster 1 -- der nackte Wegtyp, gegen die eigene Wegart.
	["Weg", "Weg", true],
	["Flussweg", "Flussweg", true],
	["Reichsstrasse", "Reichsstrasse", true],
	// ...und derselbe Name unter einer ANDEREN Wegart ist ein Name.
	["Weg", "Pfad", false],
	["Strasse", "Pfad", false],
	// Muster 2 -- was avesmapsWikiPathNextGenericName erzeugt.
	["Reichsstrasse-4903", "Reichsstrasse", true],
	["Weg-17", "Weg", true],
	["Gebirgspass-42", "Gebirgspass", true],
	// Muster 3 -- `<wort>-<zahl>` allgemein, Praefix ungleich Wegart. Der gemessene Fall aus
	// route-node.js: Seewege trugen die ganze „Meer-835, Meer-836, ..."-Kette.
	["Meer-835", "Seeweg", true],
	["Kreuzung-549", "Weg", true],
	// Gar kein Name.
	["", "Pfad", true],
	["   ", "Pfad", true],
	// 🔴 Der Anlass.
	["Goblinpfad", "Pfad", false],
	["Bernsteinroute", "Weg", false],
	["Yasamirer Stieg", "Pfad", false],
	["Reichslandstraße von Havena nach Abilacht", "Reichsstrasse", false],
	// Ein echter Name, der eine Wegart nur ENTHAELT.
	["Alter Weg nach Gareth", "Weg", false],
	// Die Zahl muss der GANZE Schwanz sein, nicht irgendwo stehen.
	["Weg-17 nach Gareth", "Weg", false],
	// Ein Bindestrich ohne Zahl dahinter ist ein Name -- und eine Zahl ohne Bindestrich auch.
	["Nord-Sued-Passage", "Weg", false],
	["Strasse 2", "Strasse", false],
];

// Browserseite: ein Weg, dessen Name nur im display_name steht, ist genau der Fall, den
// getPathTitleName beurteilt -- "" heisst „kein lesbarer Name", also maschinell.
const jsUrteil = tafel.map(([name, wegart]) => kontext.getPathTitleName(
	weg({ name, display_name: name, feature_subtype: wegart })
) === "");

// Serverseite: dieselbe Wegart-Wahl wie im Endpunkt (bekannte Wegart -> nur sie).
const phpSkript = `<?php
require __DIR__ . '/api/_internal/wiki/path-naming.php';
$faelle = json_decode(file_get_contents('php://stdin'), true);
echo json_encode(array_map(
    fn(array $f) => avesmapsWikiPathNameIsGeneric((string) $f[0], [(string) $f[1]]),
    $faelle
));`;
const skriptPfad = path.join(wurzel, ".wegname-spiegel-probe.php");
let phpUrteil;
try {
	fs.writeFileSync(skriptPfad, phpSkript, "utf8");
	phpUrteil = JSON.parse(execFileSync("php", [skriptPfad], {
		cwd: wurzel,
		input: JSON.stringify(tafel.map(([name, wegart]) => [name, wegart])),
		encoding: "utf8",
	}));
} finally {
	fs.rmSync(skriptPfad, { force: true });
}

tafel.forEach(([name, wegart, erwartet], i) => {
	assert.strictEqual(jsUrteil[i], erwartet, `Browser urteilt falsch ueber ${JSON.stringify(name)} (${wegart})`);
	assert.strictEqual(phpUrteil[i], erwartet, `Server urteilt falsch ueber ${JSON.stringify(name)} (${wegart})`);
});


// ---- 7. DIE WEGART STEHT IN DER ZEILE ------------------------------------------------------------
// 🔴 Owner 01.09.2026: „einfach wegarten anzeigen, dann is alles gut." Davor warf die Liste
// Reichsstrasse/Strasse/Weg/Pfad alle auf ein „Weg" -- und weil der Gruppenschluessel die Wegart
// SEHR WOHL unterscheidet, standen zwei verschiedene Wege als zwei zeichengleiche Zeilen da.
const wegart = (subtype, extra = {}) => index([
	weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: subtype, ...extra }),
])[0].typeLabel;

assert.strictEqual(wegart("Reichsstrasse"), "Reichsstraße");
assert.strictEqual(wegart("Strasse"), "Straße");
assert.strictEqual(wegart("Weg"), "Weg");
assert.strictEqual(wegart("Pfad"), "Pfad");
assert.strictEqual(wegart("Gebirgspass"), "Gebirgspass");
assert.strictEqual(wegart("Wuestenpfad"), "Wüstenpfad");
assert.strictEqual(wegart("Flussweg"), "Flussweg");
assert.strictEqual(wegart("Seeweg"), "Seeweg");

// 💣 Genau der gemeldete Fall: zwei Gruppen, ein Name -- die Zeilen muessen unterscheidbar sein.
const zweiArten = index([
	weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Pfad" }, "weg-1"),
	weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Weg" }, "weg-2"),
]);
assert.strictEqual(zweiArten.length, 2, "verschiedene Wegarten sind verschiedene Gruppen -- unveraendert");
assert.notStrictEqual(
	zweiArten[0].typeLabel, zweiArten[1].typeLabel,
	"zwei Zeilen mit demselben Namen muessen sich in der Wegart unterscheiden -- sonst sind sie zeichengleich"
);

// 💣 „Bach" ist ein ANZEIGE-Wegtyp: gespeichert ist Flussweg + is_bach. Der Leser sieht „Bach",
// der GRUPPENSCHLUESSEL bleibt der gespeicherte Wegtyp -- sonst faende der Servertreffer, der nur
// feature_subtype kennt, seinen Eintrag nicht mehr.
assert.strictEqual(wegart("Flussweg", { is_bach: true }), "Bach");
const bach = index([weg({ name: "Goblinpfad", display_name: "Goblinpfad", feature_subtype: "Flussweg", is_bach: true })]);
assert.strictEqual(
	bach[0].id,
	`path:${kontext.getSpotlightPathGroupKey("Goblinpfad", "Flussweg")}`,
	"der Gruppenschluessel eines Bachs bleibt auf Flussweg -- „Bach\" darf nie in den Schluessel"
);
// ...und ein Flussweg OHNE das Haekchen bleibt Flussweg (die Weiche haengt am Haekchen, nicht am Typ).
assert.strictEqual(wegart("Flussweg", { is_bach: false }), "Flussweg");

// ---- 8. DIE ZWILLINGSTABELLE AUF DEM SERVER SAGT DASSELBE ---------------------------------------
// 💣 avesmapsPathSearchTypeLabel (api/app/map-search.php) beschriftet dasselbe Objekt. Was die Liste
// zeigt, entscheidet zwar der Browser -- aber zwei Tabellen, die dieselbe Frage verschieden
// beantworten, sind genau der Fehler, den dieses Haus wiederholt bezahlt hat. Also wirklich BEIDE
// fahren, statt es zu behaupten. „Bach" ist ausgenommen und im Code begruendet: der Server sieht
// nur den gespeicherten Wegtyp.
const arten = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];
const phpLabelSkript = `<?php
require __DIR__ . '/api/_internal/bootstrap.php';
$q = file_get_contents(__DIR__ . '/api/app/map-search.php');
$i = strpos($q, 'function avesmapsPathSearchTypeLabel');
if ($i === false) { fwrite(STDERR, 'avesmapsPathSearchTypeLabel fehlt'); exit(1); }
eval(substr($q, $i));
$arten = json_decode(file_get_contents('php://stdin'), true);
echo json_encode(array_map(fn($a) => avesmapsPathSearchTypeLabel((string) $a), $arten), JSON_UNESCAPED_UNICODE);`;
const labelSkriptPfad = path.join(wurzel, ".wegart-label-probe.php");
let phpLabels;
try {
	fs.writeFileSync(labelSkriptPfad, phpLabelSkript, "utf8");
	phpLabels = JSON.parse(execFileSync("php", [labelSkriptPfad], {
		cwd: wurzel, input: JSON.stringify(arten), encoding: "utf8",
	}));
} finally {
	fs.rmSync(labelSkriptPfad, { force: true });
}
arten.forEach((art, i) => {
	assert.strictEqual(
		phpLabels[i], wegart(art),
		`Server und Browser beschriften ${art} verschieden: ${phpLabels[i]} gegen ${wegart(art)}`
	);
});

console.log("wege-suche-manueller-name: alle Zusicherungen gruen");
