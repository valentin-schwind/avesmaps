// Unit test (Node, no build) for buildRouteLegPopupHtml / routeLegTypeLabel in js/routing/route-plan.js --
// the infobox a route leg shows in the panel (Owner 2026-07-17).
//
// Loaded into a vm context with stubbed globals. pathHeaderImageBasename is pulled in for REAL from
// js/ui/popups.js together with its lookup table: the claim "a sea leg is the only place seeweg.webp ever
// appears" only means something against the real mapping. locationPopupMarkup/infoHeaderImageMarkup are
// stubbed to expose their arguments -- what matters here is WHICH title/subtitle/basename we pass, not how
// the shared popup shell renders them (that is covered where it lives).
//
// Run: node tools/paths/test-route-leg-popup.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");

function extractFunction(source, name) {
	const start = source.indexOf(`function ${name}(`);
	if (start === -1) throw new Error(`function ${name} not found`);
	let i = source.indexOf("{", start);
	let depth = 0;
	for (; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces in ${name}`);
}
function extractConst(source, name) {
	const start = source.indexOf(`const ${name} = {`);
	if (start === -1) throw new Error(`const ${name} not found`);
	const end = source.indexOf("};", start);
	return source.slice(start, end + 2);
}

const planSource = read("js", "routing", "route-plan.js");
const popupsSource = read("js", "ui", "popups.js");

const calls = { header: [], popup: [] };
const sandbox = {
	SYNTHETIC_ROUTE_TYPE: "Querfeldein",
	tr: (key, fallback) => fallback,
	escapeHtml: (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	infoHeaderImageMarkup: (basename, title, subtitle) => {
		calls.header.push({ basename, title, subtitle });
		return `<header data-img="${basename}">${title}</header>`;
	},
	locationPopupMarkup: (opts) => {
		calls.popup.push(opts);
		return `<box>${opts.headerImageMarkup}${opts.actionsMarkup}</box>`;
	},
};
vm.createContext(sandbox);
// Real: the subtype -> header-image table and its lookup.
vm.runInContext(extractConst(popupsSource, "INFO_HEADER_IMAGE_BY_PATH"), sandbox);
vm.runInContext(extractFunction(popupsSource, "pathHeaderImageBasename"), sandbox);
vm.runInContext(extractFunction(planSource, "routeLegTypeLabel"), sandbox);
vm.runInContext(extractFunction(planSource, "buildRouteLegPopupHtml"), sandbox);

const leg = (over) => ({ type: "Reichsstrasse", segmentLabel: "", startName: "A", endName: "B", distance: 10, travelTime: 5, flowState: null, ...over });
const lastHeader = () => calls.header[calls.header.length - 1];
const lastPopup = () => calls.popup[calls.popup.length - 1];

// --- Title rule (Owner: "name if there, else type") --------------------------------------------------------

// A named way: title is the NAME, the type drops to the subtitle -- exactly like the way infobox.
sandbox.buildRouteLegPopupHtml(leg({ segmentLabel: "Reichsstraße 3" }));
assert.strictEqual(lastHeader().title, "Reichsstraße 3", "named leg is titled by its way");
assert.strictEqual(lastHeader().subtitle, "Reichsstrasse", "the type becomes the subtitle");
assert.strictEqual(lastPopup().showType, true, "a subtitle exists -> show it");

// No name: the type takes the title slot and the subtitle goes away -- otherwise it would read twice.
sandbox.buildRouteLegPopupHtml(leg({ type: "Seeweg", segmentLabel: "" }));
assert.strictEqual(lastHeader().title, "Seeweg", "an unnamed leg is titled by its type");
assert.strictEqual(lastHeader().subtitle, "", "no subtitle when the type is already the title");
assert.strictEqual(lastPopup().showType, false, "nothing to show -> no type line");

// Querfeldein is a straight line, not a way -- its own word, and no way graphic exists for it.
sandbox.buildRouteLegPopupHtml(leg({ type: "Querfeldein", segmentLabel: "" }));
assert.strictEqual(lastHeader().title, "Unwegsames Gelände", "synthetic legs get their own word");
assert.strictEqual(lastHeader().basename, "region", "Querfeldein has no way graphic -> generic header");

// --- The header image comes from the REAL subtype table ----------------------------------------------------

// The whole point of the sea leg: it is the only surface that ever shows seeweg.webp, because sea ways carry
// no wiki article and are therefore never clickable.
sandbox.buildRouteLegPopupHtml(leg({ type: "Seeweg" }));
assert.strictEqual(lastHeader().basename, "seeweg", "a sea leg shows the sea-route graphic");
sandbox.buildRouteLegPopupHtml(leg({ type: "Flussweg" }));
assert.strictEqual(lastHeader().basename, "flussweg", "a river leg shows the river-route graphic, not the landscape one");
sandbox.buildRouteLegPopupHtml(leg({ type: "Reichsstrasse" }));
assert.strictEqual(lastHeader().basename, "reichsstrasse", "each way type brings its own");

// --- Leg data ---------------------------------------------------------------------------------------------

const html = sandbox.buildRouteLegPopupHtml(leg({ startName: "Elenvina", endName: "Gareth", distance: 42.812, travelTime: 3.456 }));
assert.ok(html.includes("<dt>von</dt><dd>Elenvina</dd>"), "start is shown");
assert.ok(html.includes("<dt>bis</dt><dd>Gareth</dd>"), "end is shown");
assert.ok(html.includes("42.81 Meilen"), "distance is rounded like the planner row");
assert.ok(html.includes("3.46 Stunden (0.14 Tage)"), "travel time carries hours and days");

// River flow is noted in the distance, same wording as the planner row.
const upstream = sandbox.buildRouteLegPopupHtml(leg({ type: "Flussweg", flowState: "upstream" }));
assert.ok(upstream.includes("flussaufwärts"), "upstream legs say so");
const downstream = sandbox.buildRouteLegPopupHtml(leg({ type: "Flussweg", flowState: "downstream" }));
assert.ok(downstream.includes("flussabwärts"), "downstream legs say so");
// Only rivers have a flow -- a road must never claim one.
assert.ok(!sandbox.buildRouteLegPopupHtml(leg({ type: "Strasse", flowState: "upstream" })).includes("fluss"), "a road never shows a flow note");

// Empty endpoints drop their row instead of rendering an empty one.
const noNames = sandbox.buildRouteLegPopupHtml(leg({ startName: "", endName: "" }));
assert.ok(!noNames.includes("<dt>von</dt>"), "an unnamed endpoint drops its row");
assert.ok(noNames.includes("Meilen"), "but the leg data survives");

// Untrusted names are escaped.
assert.ok(sandbox.buildRouteLegPopupHtml(leg({ startName: '<img src=x onerror=alert(1)>' })).includes("&lt;img"), "endpoint names are escaped");

// No entry -> "" so the caller leaves the panel alone.
assert.strictEqual(sandbox.buildRouteLegPopupHtml(null), "", "no entry yields no markup");

console.log("route-leg-popup tests passed");
