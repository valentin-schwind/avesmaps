// Unit test (Node, no build): der Kartenpayload darf nur ausliefern, was die Karte auch liest.
//
// Zwei Sparmassnahmen werden hier festgenagelt, weil beide still kaputtgehen wuerden --
// niemand bemerkt fehlende Quellen in einer Infobox, die er gerade nicht offen hat:
//   1. feature_sources traegt NUR entity_type, die renderFeatureSourceLine wirklich aufloest.
//   2. svg_id wird entfernt (wertgleicher Zwilling von id); `id` MUSS bleiben (Routing-Graph).
//
// Run: node tools/paths/test-map-features-payload-scope.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const php = readFileSync(path.join(repoRoot, "api", "app", "map-features.php"), "utf8");
// 🔴 Seit 30.08.2026 stehen die zwei Sammler und ihre Positivliste in der geteilten Bibliothek,
// nicht mehr im Endpunkt: eine Endpunktdatei laesst sich nicht einbinden, ohne die ganze
// Kartenantwort auszufuehren -- der einzige Erzeuger der oeffentlichen Quellenliste war damit der
// einzige, den kein Test je AUSGEFUEHRT hat, und genau dort fehlte die Lizenzangabe unbemerkt.
const lib = readFileSync(path.join(repoRoot, "api", "_internal", "app", "feature-sources.php"), "utf8");

// --- 1. Welche entity_type liefert der Server aus? ---------------------------------------
const listMatch = /const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES = \[([^\]]+)\]/.exec(lib);
assert.ok(listMatch, "die Positivliste der entity_type muss in api/_internal/app/feature-sources.php stehen");
const serverTypes = new Set([...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

// 🪤 HIER STAND EINE ZUSICHERUNG, DIE MIT DEM UMZUG IHREN GEGENSTAND VERLOREN HAT: die const
// musste im ENDPUNKT vor ihrem ersten Aufrufer stehen, weil PHP Funktionen hoistet, aber keine
// const auf Dateiebene -- und der Bootstrap darueber endet in avesmapsMapFeaturesRespond() +
// exit, sodass eine spaetere Zeile nie erreicht wird (HTTP 500 am 2026-07-28, `php -l` sieht es
// nicht). In einer require_once-Bibliothek gibt es diese Reihenfolge nicht: sie wird ganz
// ausgefuehrt, bevor der Endpunkt seine erste Zeile tut. Was BLEIBT, ist die eine Frage, die der
// Umzug wirklich stellen kann -- steht die Liste in derselben Datei wie ihr Leser, und ruft der
// Endpunkt den Sammler ueberhaupt noch?
assert.ok(lib.indexOf("const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES") > -1
	&& lib.indexOf("function avesmapsLoadFeatureSourceRefs") > -1,
	"Liste und Leser gehoeren in DIESELBE Datei -- getrennt ist die Liste zur Laufzeit undefiniert");
assert.ok(php.indexOf("avesmapsLoadFeatureSourceRefs($pdo)") > -1
	&& php.indexOf("avesmapsLoadFeatureSourceCatalog($pdo)") > -1,
	"der Endpunkt muss beide Sammler weiterhin rufen -- ein Umzug ohne Aufrufer waere lautlos");
assert.ok(php.indexOf("function avesmapsLoadFeatureSourceRefs") === -1,
	"und er darf sie nicht ein zweites Mal definieren (Redeklaration = Fatal mit leerem Rumpf)");

// --- 2. Welche fragt das Frontend nach? --------------------------------------------------
// Jeder Aufruf von renderFeatureSourceLine("<typ>", …) im ausgelieferten JS.
const jsDirs = ["js/map-features", "js/ui", "js/review", "js/routing", "js/app"];
const { readdirSync, statSync } = await import("node:fs");
const alleJs = [];
const sammle = (dir) => {
	for (const e of readdirSync(dir)) {
		const p = path.join(dir, e);
		if (statSync(p).isDirectory()) {
			if (!p.includes("__tests__")) sammle(p);
		} else if (p.endsWith(".js") && !p.includes("third-party")) {
			alleJs.push(p);
		}
	}
};
jsDirs.forEach((d) => sammle(path.join(repoRoot, d)));
const jsKorpus = alleJs.map((f) => readFileSync(f, "utf8")).join("\n");

const clientTypes = new Set(
	[...jsKorpus.matchAll(/renderFeatureSourceLine\(\s*"([^"]+)"/g)].map((m) => m[1]),
);
assert.ok(clientTypes.size >= 4, `zu wenige Aufrufer gefunden (${clientTypes.size}) -- Suche kaputt?`);

// 💣 Jeder Typ, den die Karte aufloest, MUSS geliefert werden. Fehlt einer, bleibt seine
// Quellenzeile still leer -- kein Fehler, keine Meldung, nur fehlende Angaben.
for (const t of clientTypes) {
	assert.ok(serverTypes.has(t), `renderFeatureSourceLine("${t}") wird aufgerufen, aber der Server liefert '${t}' nicht mit`);
}

// Umgekehrt: 'lore' darf NICHT mitreisen. Vorkommen sind keine Kartenobjekte und haben ihren
// eigenen, seitenweise ladenden Endpunkt -- ihre Quellen waren 3,03 MB von 8,2 MB.
assert.ok(!serverTypes.has("lore"), "'lore' gehoert nicht in den Kartenpayload (eigener Endpunkt, 3 MB)");
console.log(`source-entity-types ok  (Server: ${[...serverTypes].join(", ")} | Karte fragt: ${[...clientTypes].join(", ")})`);

// --- 3. svg_id raus, id bleibt -----------------------------------------------------------
assert.match(php, /unset\(\$properties\['svg_id'\]\);/, "svg_id muss aus dem Payload entfernt werden");
assert.ok(
	!/unset\(\$properties\['id'\]\)/.test(php),
	"`id` darf NIE entfernt werden -- der Routing-Graph nutzt sie als Kantenkennung",
);
// Gegenprobe, dass die Behauptung ueber das Routing stimmt: es liest properties.id wirklich.
const routing = readFileSync(path.join(repoRoot, "js", "routing", "route-graph-routing.js"), "utf8");
assert.match(routing, /properties\.id/, "route-graph-routing.js muss properties.id lesen (sonst ist die Begruendung falsch)");
console.log("svg-id-twin ok");

console.log("\nALL PAYLOAD-SCOPE TESTS PASSED");
