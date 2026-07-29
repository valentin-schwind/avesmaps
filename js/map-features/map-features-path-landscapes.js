// V10: „Führt durch" -- which landscapes a leg, a route or a single way runs through.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// 🔴 ONE calculation, three writers. The planner and the infobox say the same thing in two
// tones -- the planner narrates (bare names, no percentages, only what is new), the infobox
// proves (shares, „·"). Both read the SAME list out of buildLandscapeLine. A second calculation
// „for the planner" would drift from this one the first time a rule changes.
//
// ⚠️ Weighted by the `length` the endpoint ships, never by the planner's leg distance in miles.
// They are proportional -- until a water leg merges several ways into ONE entry with one distance
// and several lengths. Mixing them there would multiply miles by map units.

"use strict";

// Below this share a landscape is not named. Calibrated against the live stock (2026-07-29,
// ecosystem_revision 3890): 5 % drops 274 of 3.995 hits, 3 % would drop 167, 10 % would drop 426.
// The curve is flat here -- there is no edge the choice tips over, which is why it is a round number.
var AVESMAPS_LANDSCAPE_MIN_SHARE = 0.05;

// At or above this the share is not printed. The MEDIAN share is 100 % -- without this rule most
// lines would end in „(100 %)", and the number would stop carrying information.
var AVESMAPS_LANDSCAPE_FULL_SHARE = 0.9;

// The naming rule lives in map-features-ecosystem-naming.js and is NOT rebuilt here: an auto name
// („Wald-001") is internal bookkeeping and a reader gets the kind instead („Wald"). index.html
// loads that file before this one, so the browser branch always finds the globals.
function avesmapsLandscapeNaming() {
	if (typeof module !== "undefined" && module.exports) {
		return require("./map-features-ecosystem-naming.js");
	}
	return {
		isEcosystemRegionAutoName: typeof isEcosystemRegionAutoName === "function" ? isEcosystemRegionAutoName : null,
		ecosystemRegionDisplayName: typeof ecosystemRegionDisplayName === "function" ? ecosystemRegionDisplayName : null,
	};
}

// What a reader should see -- or "" when there is nothing to print. A region with neither a name
// nor a kind („Fläche-011") is the only case that vanishes: 395 of 3.995 measured hits, and none
// of them has anything to say.
function avesmapsLandscapeDisplayName(entry) {
	var naming = avesmapsLandscapeNaming();
	var name = String((entry && entry.name) || "").trim();
	var art = String((entry && entry.art) || "").trim();
	var isAuto = naming.isEcosystemRegionAutoName
		? naming.isEcosystemRegionAutoName(name, art)
		: false;
	if (art === "" && (name === "" || isAuto)) {
		return "";
	}
	return naming.ecosystemRegionDisplayName
		? naming.ecosystemRegionDisplayName(name, art)
		: (name || art);
}

// The one calculation. `pathIds` is a list of way public ids -- one for a leg or a way infobox,
// forty-five for a route. `payload` is exactly what api/app/path-landscapes.php answers.
function buildLandscapeLine(pathIds, payload) {
	var paths = (payload && payload.paths) || null;
	var landscapes = (payload && payload.landscapes) || null;
	if (!paths || !landscapes || !pathIds || !pathIds.length) {
		return [];
	}

	var totalLength = 0;
	var covered = {};   // display name -> { key, name, art, kind, wikiKey, covered }
	var order = [];     // insertion order, so the sort below is stable across engines
	pathIds.forEach(function (pathId) {
		var path = paths[pathId];
		if (!path || !(Number(path.length) > 0)) {
			return;
		}
		totalLength += Number(path.length);
		(path.in || []).forEach(function (pair) {
			var region = landscapes[pair && pair[0]];
			if (!region) {
				return;   // catalogue and assignment disagree -- skip, never guess a name
			}
			var name = avesmapsLandscapeDisplayName(region);
			if (name === "") {
				return;
			}
			// Two nameless lakes along one leg are ONE entry: „See", not „See · See".
			if (!Object.prototype.hasOwnProperty.call(covered, name)) {
				covered[name] = {
					key: String(pair[0]),
					name: name,
					art: String(region.art || ""),
					kind: String(region.kind || ""),
					wikiKey: String(region.wiki_key || ""),
					covered: 0,
				};
				order.push(name);
			}
			covered[name].covered += Math.max(0, Number(pair[1]) || 0);
		});
	});
	if (!(totalLength > 0)) {
		return [];
	}

	return order.map(function (name) {
		var bucket = covered[name];
		return {
			key: bucket.key,
			name: bucket.name,
			art: bucket.art,
			kind: bucket.kind,
			wikiKey: bucket.wikiKey,
			// Capped: rounding on the server can push a full-length cover a hair past the length.
			share: Math.min(1, bucket.covered / totalLength),
		};
	}).filter(function (entry) {
		return entry.share >= AVESMAPS_LANDSCAPE_MIN_SHARE;
	}).sort(function (left, right) {
		return right.share - left.share || left.name.localeCompare(right.name, "de");
	});
}

// Infobox tone: shares, „·" as the separator. The separator is not a comma on purpose -- these
// names are not the parts of one whole (a leg can be 100 % in Darpatien AND 68 % in the
// Reichsforst, they are overlapping layers), and a comma would sit too close to the bracket.
function formatLandscapesForInfobox(list) {
	return (list || []).map(function (entry) {
		return entry.share >= AVESMAPS_LANDSCAPE_FULL_SHARE
			? entry.name
			: entry.name + " (" + Math.round(entry.share * 100) + " %)";
	}).join(" · ");
}

// Planner tone: bare names, comma separated, never a percentage.
// 💣 And never an article. „durch den Reichsforst" is right, but gender is in no field -- das Herz
// des Kontinents, die Flusslande, der Farindelwald, and Weiden with none at all. A guessed article
// would be visibly wrong German on about a third of the names. The caller writes „durch: " in
// front, and a colon expects no article.
function formatLandscapesForPlanner(list) {
	return (list || []).map(function (entry) { return entry.name; }).join(", ");
}

// Only what the row above did not already say. Entering a landscape is announced, leaving it is
// not -- that is what makes the plan read like a journey instead of stuttering: measured on
// Gareth -> Thorwal, 16 of 31 labelled rows were word for word their predecessor.
function pickFreshLandscapes(list, previousList) {
	var seen = {};
	(previousList || []).forEach(function (entry) { seen[entry.name] = true; });
	return (list || []).filter(function (entry) {
		return !Object.prototype.hasOwnProperty.call(seen, entry.name);
	});
}

// The comma list api/app/lore.php takes for „give me the flora of all these places at once".
function landscapeWikiKeyList(list) {
	return (list || []).map(function (entry) { return entry.wikiKey; })
		.filter(Boolean).join(",");
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_LANDSCAPE_MIN_SHARE,
		AVESMAPS_LANDSCAPE_FULL_SHARE,
		buildLandscapeLine,
		formatLandscapesForInfobox,
		formatLandscapesForPlanner,
		pickFreshLandscapes,
		landscapeWikiKeyList,
	};
}
