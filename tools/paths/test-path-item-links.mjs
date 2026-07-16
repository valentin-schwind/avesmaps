// Unit test (Node, no build) for the item-link resolution in
// js/map-features/map-features-path-item-links.js -- the gold fly-to links in a way's infobox
// (spec: docs/superpowers/specs/2026-07-17-weg-infobox-item-links-design.md).
//
// The whole module is loaded into a vm context with stubbed browser globals. The two normalizers
// (normalizeWikiDeeplinkKey / wikiUrlToDeeplinkKey) and settlementTerritoryLinkMarkup are pulled in for REAL
// from their source files -- the piped-link rescue and the "Lage reuses the political link verbatim" claim
// are only meaningful against the real implementations. normalizePathSubtype is stubbed to identity on
// purpose: its own logic is tested elsewhere, the boundary here is only the "not a sea route" gate.
//
// Run: node tools/paths/test-path-item-links.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const read = (...parts) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const itemLinksSource = read("js", "map-features", "map-features-path-item-links.js");
const deeplinkSource = read("js", "app", "wiki-deeplink.js");
const utilsSource = read("js", "app", "utils.js");
const popupsSource = read("js", "ui", "popups.js");

// Same brace-matching extractor the sibling tests use (tools/paths/test-way-labels.mjs).
function extractFunction(source, name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in source`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) return source.slice(startIndex, i + 1);
	}
	throw new Error(`unbalanced braces while extracting ${name}`);
}

const realHelpers = [
	extractFunction(utilsSource, "escapeHtml"),
	extractFunction(deeplinkSource, "normalizeWikiDeeplinkKey"),
	extractFunction(deeplinkSource, "wikiUrlToDeeplinkKey"),
	extractFunction(popupsSource, "settlementTerritoryDisplayName"),
	extractFunction(popupsSource, "settlementTerritoryCoatThumbMarkup"),
	extractFunction(popupsSource, "settlementTerritoryLinkMarkup"),
].join("\n");

// A fresh context per case -- the index memoizes on array lengths, so reusing one context across fixtures
// could serve a stale index.
function makeSandbox(locationMarkers, locationData, pathData = [], labelMarkers = []) {
	const sandbox = {
		locationMarkers,
		locationData,
		pathData,
		labelMarkers,
		isCrossingLocation: (location) => String(location?.name || "").startsWith("Kreuzung"),
		normalizePathSubtype: (value) => value,
	};
	vm.createContext(sandbox);
	vm.runInContext(realHelpers, sandbox);
	vm.runInContext(itemLinksSource, sandbox);
	return sandbox;
}

const WIKI = "https://de.wiki-aventurica.de/wiki/";
const markers = [
	{ publicId: "loc-elenvina", name: "Elenvina", location: { name: "Elenvina", wikiUrl: `${WIKI}Elenvina` } },
	{ publicId: "loc-zinnen", name: "Zinnen am Ratsforst", location: { name: "Zinnen am Ratsforst", wikiUrl: `${WIKI}Zinnen_am_Ratsforst` } },
	// The piped-link case: the wiki writes {{Straße|[[Lyngwyn (Honingen)|Lyngwyn]]}}, the parser keeps the
	// LABEL, so the field says "Lyngwyn" while our wiki_url is /wiki/Lyngwyn_(Honingen).
	{ publicId: "loc-lyngwyn", name: "Lyngwyn", location: { name: "Lyngwyn", wikiUrl: `${WIKI}Lyngwyn_(Honingen)` } },
	{ publicId: "loc-perricum", name: "Perricum", location: { name: "Perricum", wikiUrl: `${WIKI}Perricum` } },
	// No publicId -> the click could never resolve it -> must NOT become a link.
	{ publicId: "", name: "Namenlos", location: { name: "Namenlos", wikiUrl: `${WIKI}Namenlos` } },
	// Crossings are internal graph nodes, never a station.
	{ publicId: "loc-kreuzung", name: "Kreuzung-7", location: { name: "Kreuzung-7", wikiUrl: "" } },
];
const locations = [
	{
		political: {
			hierarchy: [
				{ name: "Perricum", territory_public_id: "terr-perricum" },
				{ name: "Nordmarken", territory_public_id: "terr-nordmarken" },
				{ name: "Fürstentum Kosch", territory_public_id: "terr-kosch" },
				{ name: "Ohne Id", territory_public_id: "" },
			],
		},
	},
	{ political: null },
];
// A way's course legitimately names OTHER WAYS (junctions) and LANDSCAPES, not just settlements -- on
// production that is the difference between 57% and 88% of stations resolving.
const ways = [
	{ properties: { feature_subtype: "Reichsstrasse", wiki_path: { name: "Reichsstraße 1", wiki_url: `${WIKI}Reichsstraße_1` } } },
	// Same way, second segment: must not produce a second/other index entry.
	{ properties: { feature_subtype: "Reichsstrasse", wiki_path: { name: "Reichsstraße 1", wiki_url: `${WIKI}Reichsstraße_1` } } },
	// Not wiki-linked -> not an object we link to (Spotlight policy, Owner 2026-07-05).
	{ properties: { feature_subtype: "Strasse", display_name: "Knüppeldamm", wiki_path: null } },
];
const labels = [
	{ label: { text: "Trollzacken", publicId: "lbl-trollzacken" } },
	{ label: { text: "Ohne Id", publicId: "" } },
];
const box = makeSandbox(markers, locations, ways, labels);

// --- Verlauf ---------------------------------------------------------------------------------------------

// Plain hit through the wiki_url channel.
const verlauf = box.linkifyPathVerlauf("Elenvina → Zinnen am Ratsforst → Nirgendwo");
assert.ok(verlauf.includes('data-station-ref="loc-elenvina"'), "Elenvina resolves via wiki_url");
assert.ok(verlauf.includes('data-station-kind="location"'), "a settlement station is kind location");
assert.ok(verlauf.includes('data-station-ref="loc-zinnen"'), "multi-word station resolves");
assert.ok(verlauf.includes("class=\"location-popup__station-link\""), "station uses its own hook class");
// NOT the political class: that one carries a delegated handler aiming at territories.
assert.ok(!verlauf.includes("location-popup__political-link"), "station link must not fall into the political handler");

// A station we do not have stays plain text -- no dead links (Owner rule).
assert.ok(!verlauf.includes(">Nirgendwo<"), "unresolved station is not wrapped in a link");
assert.ok(verlauf.includes("Nirgendwo"), "unresolved station survives as text");

// The separator is preserved so the chain still reads as a chain.
assert.strictEqual((verlauf.match(/ → /g) || []).length, 2, "both separators kept");

// The piped-link rescue: the wiki_url channel cannot match "Lyngwyn", the name channel does.
const lyngwyn = box.linkifyPathVerlauf("Lyngwyn");
assert.ok(lyngwyn.includes('data-station-ref="loc-lyngwyn"'), "piped-link label resolves via the name channel");
assert.ok(lyngwyn.includes(">Lyngwyn<"), "the wiki's own token stays the visible text");

// Dead-link guards.
assert.ok(!box.linkifyPathVerlauf("Namenlos").includes("<button"), "a place without publicId is never linked");
assert.ok(!box.linkifyPathVerlauf("Kreuzung-7").includes("<button"), "crossings are not stations");

// Empty field -> "" so the caller drops the whole row.
assert.strictEqual(box.linkifyPathVerlauf(""), "", "empty verlauf yields no markup");
assert.strictEqual(box.linkifyPathVerlauf(null), "", "missing verlauf yields no markup");

// Wiki text is untrusted -> escaped in both channels.
const nasty = makeSandbox([{ publicId: "x\"><b>", name: "<img src=x onerror=alert(1)>", location: { name: "n", wikiUrl: "" } }], []);
const escaped = nasty.linkifyPathVerlauf("<img src=x onerror=alert(1)>");
assert.ok(!escaped.includes("<img"), "station token is escaped");
assert.ok(escaped.includes("&lt;img"), "station token is escaped, not dropped");
assert.ok(!escaped.includes('id="x"><b>'), "publicId is escaped inside the attribute");

// --- Stations that are NOT settlements ---------------------------------------------------------------------

// A junction to another road. ref is the WAY-IDENTITY key (not a publicId): focusWholeWikiDeeplinkPath marks
// the whole way, and its name channel compares a segment's RAW name, which is not the wiki name -- so the
// wiki_url key is the only reliable ref.
const junction = box.linkifyPathVerlauf("Reichsstraße 1");
assert.ok(junction.includes('data-station-kind="path"'), "a way station is kind path");
assert.ok(junction.includes('data-station-ref="reichsstrasse1"'), "a way station refs the wiki_url key, not a publicId");
// Number-sensitivity is the whole point of that key: "Reichsstraße 1" must never collect "Reichsstraße 2".
assert.ok(!box.linkifyPathVerlauf("Reichsstraße 2").includes("<button"), "a like-named way with another number does not resolve");

// A landscape.
const landscape = box.linkifyPathVerlauf("Trollzacken");
assert.ok(landscape.includes('data-station-kind="label"'), "a landscape station is kind label");
assert.ok(landscape.includes('data-station-ref="lbl-trollzacken"'), "a label station refs its publicId");
assert.ok(!box.linkifyPathVerlauf("Ohne Id").includes("<button"), "a label without publicId is never linked");

// Spotlight policy (Owner 2026-07-05): a way without a wiki_path is not a linkable object -- its generic
// name is no identity. Only 15 of 2946 production stations would be gained by relaxing this.
assert.ok(!box.linkifyPathVerlauf("Knüppeldamm").includes("<button"), "a way without a wiki_path is not linked");

// Precedence: a station is primarily a place, so a settlement beats a like-named way/landscape.
const clash = makeSandbox(
	[{ publicId: "loc-x", name: "Doppelname", location: { name: "Doppelname", wikiUrl: "" } }],
	[],
	[{ properties: { feature_subtype: "Strasse", wiki_path: { name: "Doppelname", wiki_url: `${WIKI}Doppelname` } } }],
	[{ label: { text: "Doppelname", publicId: "lbl-x" } }]
);
assert.ok(clash.linkifyPathVerlauf("Doppelname").includes('data-station-kind="location"'), "settlement wins over a like-named way and label");

// --- Lage ------------------------------------------------------------------------------------------------

const lage = box.linkifyPathLage("Nordmarken, Fürstentum Kosch, Unbekanntes Land");
assert.ok(lage.includes('data-political-territory="Nordmarken"'), "Lage reuses the political link contract");
assert.ok(lage.includes('data-political-public-id="terr-nordmarken"'), "Lage carries the territory publicId");
assert.ok(lage.includes("location-popup__political-link"), "Lage links reuse the existing class + handler");
assert.ok(lage.includes('data-political-public-id="terr-kosch"'), "umlaut territory resolves");
assert.ok(!lage.includes(">Unbekanntes Land<"), "unknown territory stays plain text");
// The field is wiki prose and must read EXACTLY as before -- trimming a token for the lookup must not eat the
// space after the comma ("Nordmarken, Kosch" -> "Nordmarken,Kosch"). Stripping the markup has to give the
// input back verbatim.
const stripTags = (html) => html.replace(/<[^>]*>/g, "");
assert.strictEqual(stripTags(lage), "Nordmarken, Fürstentum Kosch, Unbekanntes Land", "Lage reads exactly as it came in");
assert.strictEqual(stripTags(verlauf), "Elenvina → Zinnen am Ratsforst → Nirgendwo", "Verlauf reads exactly as it came in");
assert.strictEqual(stripTags(box.linkifyPathLage("Nordmarken,Perricum")), "Nordmarken,Perricum", "tight input stays tight -- no space invented");
// A hierarchy node without a publicId cannot be focused -> not indexed.
assert.ok(!box.linkifyPathLage("Ohne Id").includes("<button"), "territory without publicId is never linked");

// --- The reason for TWO indexes ---------------------------------------------------------------------------

// "Perricum" is a territory in Lage AND a city in Verlauf. Same name, different objects, different targets.
const perricumStation = box.linkifyPathVerlauf("Perricum");
const perricumLage = box.linkifyPathLage("Perricum");
assert.ok(perricumStation.includes('data-station-ref="loc-perricum"'), "Perricum as a station is the city");
assert.ok(perricumLage.includes('data-political-public-id="terr-perricum"'), "Perricum in Lage is the territory");
assert.ok(!perricumStation.includes("political"), "the station must not route to the territory handler");

// --- wiki_url beats a name coincidence --------------------------------------------------------------------

// Two places, one named like the other's wiki page. The wiki_url pass runs first and globally, so the token
// resolves to the object whose IDENTITY says so -- not to whoever happens to carry the name.
const rivals = makeSandbox([
	{ publicId: "loc-namensvetter", name: "Havena", location: { name: "Havena", wikiUrl: `${WIKI}Havena_(Dorf)` } },
	{ publicId: "loc-echt", name: "Havena am Meer", location: { name: "Havena am Meer", wikiUrl: `${WIKI}Havena` } },
], []);
assert.ok(rivals.linkifyPathVerlauf("Havena").includes('data-station-ref="loc-echt"'), "wiki_url channel wins over the name channel");

// --- Markup cache must not go stale ------------------------------------------------------------------------

// The markup cache exists so a way's Verlauf is linkified once per WAY, not once per segment. It embeds
// publicIds from the index, so it must die with it -- serving markup built against gone data is exactly the
// failure mode of the infopanel catalog race (a panel that renders once and never catches up).
const growing = makeSandbox(
	[{ publicId: "loc-a", name: "Astadt", location: { name: "Astadt", wikiUrl: `${WIKI}Astadt` } }],
	[]
);
assert.ok(!growing.linkifyPathVerlauf("Astadt → Bdorf").includes('data-station-ref="loc-b"'), "Bdorf unknown at first");
growing.locationMarkers.push({ publicId: "loc-b", name: "Bdorf", location: { name: "Bdorf", wikiUrl: `${WIKI}Bdorf` } });
const afterGrowth = growing.linkifyPathVerlauf("Astadt → Bdorf");
assert.ok(afterGrowth.includes('data-station-ref="loc-b"'), "the same field re-linkifies once the data changed");
assert.ok(afterGrowth.includes('data-station-ref="loc-a"'), "and the previously resolved station survives");

// --- Sea-route gate ---------------------------------------------------------------------------------------

const subtypeOf = (feature_subtype) => box.pathSupportsItemLinks({ properties: { feature_subtype } });
assert.strictEqual(subtypeOf("Seeweg"), false, "sea routes are excluded (Owner)");
assert.strictEqual(subtypeOf("Flussweg"), true, "rivers are included");
assert.strictEqual(subtypeOf("Reichsstrasse"), true, "roads are included");
assert.strictEqual(subtypeOf("Gebirgspass"), true, "every other way form is included");

console.log("path-item-links tests passed");
