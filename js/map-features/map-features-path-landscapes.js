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
					wikiUrl: String(region.wiki_url || ""),
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
			wikiUrl: bucket.wikiUrl,
			// Capped: rounding on the server can push a full-length cover a hair past the length.
			share: Math.min(1, bucket.covered / totalLength),
		};
	}).filter(function (entry) {
		return entry.share >= AVESMAPS_LANDSCAPE_MIN_SHARE;
	}).sort(function (left, right) {
		return right.share - left.share || left.name.localeCompare(right.name, "de");
	});
}

// Only a Wiki-Aventurica address ever becomes an href. Same rule and same reason as
// avesmapsLoreSafeUrl (map-features-lore.js:125): escaping is NOT a URL check -- „javascript:alert(1)"
// carries no HTML metacharacter, sails through any escaper and fires on click. The names and urls
// here come from the wiki, i.e. from foreign content.
//
// The prefix is repeated rather than imported: index.html loads this file at 2173 and lore.js at
// 2288, so reaching into lore.js would make a three-line check depend on load order -- and this
// module has to stay loadable in node for its test.
var AVESMAPS_LANDSCAPE_WIKI_PREFIX = "https://de.wiki-aventurica.de/";

function landscapeWikiHref(entry) {
	var url = String((entry && entry.wikiUrl) || "").trim();
	return url.indexOf(AVESMAPS_LANDSCAPE_WIKI_PREFIX) === 0 ? url : "";
}

// One landscape name as markup -- a wiki link where there is one, plain text otherwise. Shared by
// both tones so a name never looks like a link in one place and not in the other.
// The trailing ↗ marks the off-site jump (AGENTS.md §12); it is written into the markup, as
// everywhere else in this house.
//
// 💣 The space before the ↗ is a NON-BREAKING one (Owner 2026-07-29). With an ordinary space the
// list wraps between the last word and the arrow, and a line then opens with a bare „↗," -- seen on
// „Streitende Königreiche ↗" in the route summary. The name itself may still break across its own
// words; only the arrow is nailed to the word it belongs to.
function landscapeNameMarkup(entry, escape) {
	var text = escape(entry.name);
	var href = landscapeWikiHref(entry);
	if (!href) {
		return text;
	}
	return '<a class="avesmaps-landscape__link" href="' + escape(href)
		+ '" target="_blank" rel="noopener">' + text + "&#160;↗</a>";
}

// Infobox tone: shares, „·" as the separator. The separator is not a comma on purpose -- these
// names are not the parts of one whole (a leg can be 100 % in Darpatien AND 68 % in the
// Reichsforst, they are overlapping layers), and a comma would sit too close to the bracket.
// Returns MARKUP; the caller assigns it, it does not escape it again.
function formatLandscapesForInfobox(list, escape) {
	var esc = escape || avesmapsPathLandscapesEscape;
	return (list || []).map(function (entry) {
		var name = landscapeNameMarkup(entry, esc);
		return entry.share >= AVESMAPS_LANDSCAPE_FULL_SHARE
			? name
			: name + " (" + Math.round(entry.share * 100) + " %)";
	}).join(" · ");
}

// Planner tone: bare names, comma separated, never a percentage.
// 💣 And never an article. „durch den Reichsforst" is what a German speaker would say, but gender is
// in no field -- das Herz des Kontinents, die Flusslande, der Farindelwald, and Weiden with none at
// all. A guessed article would be visibly WRONG on about a third of the names, and a missing one is
// merely clipped; that trade is deliberate. It is why the summary puts a colon after its label, where
// no article is expected at all. The leg row („… in 4.98 Stunden durch Weiden", Owner 2026-07-29) dropped
// its colon and therefore wears the clipped form openly -- accepted, not overlooked.
function formatLandscapesForPlanner(list, escape) {
	var esc = escape || avesmapsPathLandscapesEscape;
	return (list || []).map(function (entry) { return landscapeNameMarkup(entry, esc); }).join(", ");
}

// Leg-row tone: the same names, but the jump goes to OUR OWN map instead of the wiki (Owner
// 2026-07-29: „bei ‚durch …' nicht der Link zum Wiki sondern auf die Region auf unserer Karte").
// Hence NO ↗ -- the arrow announces leaving the house, and this link stays inside it. The route
// SUMMARY keeps its wiki links: it names what you travel through, the leg row takes you there.
//
// 💣 A name only becomes a button when `isLinkable` finds the area on the map. 412 of 589 live
// regions carry no label at all, and a label is what we fly to -- a button that leads nowhere is
// worse than plain text. The caller supplies the lookup, so this file stays loadable in node.
function formatLandscapesForMapLinks(list, escape, isLinkable) {
	var esc = escape || avesmapsPathLandscapesEscape;
	return (list || []).map(function (entry) {
		var text = esc(entry.name);
		if (typeof isLinkable !== "function" || !isLinkable(entry.key)) {
			return text;
		}
		return '<button type="button" class="avesmaps-landscape__maplink" data-landscape-region="'
			+ esc(entry.key) + '">' + text + "</button>";
	}).join(", ");
}

// There used to be a pickFreshLandscapes(list, previousList) here, which dropped from a leg row
// whatever the row above had already said (measured on Gareth -> Thorwal: 16 of 31 labelled rows were
// word for word their predecessor). Withdrawn by the owner on 2026-07-29 at the finished screen: an
// empty row under a named one does not read as „unchanged", it reads as „nothing is known about this
// stretch". Every leg now names its own landscapes in full -- see fillRoutePlanLandscapes in
// js/routing/route-plan.js. Do not reintroduce it without asking; the repetition is the point.

// The comma list api/app/lore.php takes for „give me the flora of all these places at once".
function landscapeWikiKeyList(list) {
	return (list || []).map(function (entry) { return entry.wikiKey; })
		.filter(Boolean).join(",");
}

// ---- the store ------------------------------------------------------------------------------
// Kept per WAY, not per route: two routes over the same Reichsstraße fetch it once. Thrown away
// when the stamp changes revision -- a stored answer is a SNAPSHOT of the last time the editor
// pressed „Zugehörigkeit rechnen", and a snapshot that quietly outlives its facts is worse than
// none. Memory only, no localStorage: the stock moves with every editor run, and 2 KB is cheaper
// to fetch again than a day-old answer is to trust.
var AVESMAPS_PATH_LANDSCAPES_URL = "api/app/path-landscapes.php";
var AVESMAPS_PATH_LANDSCAPES_TIMEOUT_MS = 8000;
var AVESMAPS_PATH_LANDSCAPES_CHUNK = 400;   // matches AVESMAPS_PATH_LANDSCAPES_MAX on the server

var avesmapsPathLandscapesStore = { landscapes: {}, paths: {}, stamp: null, pending: {} };

function avesmapsPathLandscapesPayload() {
	return avesmapsPathLandscapesStore;
}

function avesmapsPathLandscapesLineFor(pathIds) {
	return buildLandscapeLine(pathIds, avesmapsPathLandscapesStore);
}

function avesmapsPathLandscapesReset() {
	avesmapsPathLandscapesStore = { landscapes: {}, paths: {}, stamp: null, pending: {} };
}

function avesmapsPathLandscapesMerge(data) {
	if (!data || data.ok !== true) {
		return;
	}
	var stamp = data.stamp || null;
	var known = avesmapsPathLandscapesStore.stamp;
	// A new computation invalidates everything held so far -- keeping half of an old answer next
	// to half of a new one would be a line nobody could reproduce.
	if (known && stamp && (known.ecosystem_revision !== stamp.ecosystem_revision
		|| known.map_revision !== stamp.map_revision)) {
		var stillPending = avesmapsPathLandscapesStore.pending;
		avesmapsPathLandscapesReset();
		avesmapsPathLandscapesStore.pending = stillPending;   // requests in flight keep their marks
	}
	avesmapsPathLandscapesStore.stamp = stamp;
	var landscapes = data.landscapes || {};
	Object.keys(landscapes).forEach(function (key) {
		avesmapsPathLandscapesStore.landscapes[key] = landscapes[key];
	});
	var paths = data.paths || {};
	Object.keys(paths).forEach(function (key) {
		avesmapsPathLandscapesStore.paths[key] = paths[key];
	});
}

function avesmapsPathLandscapesPost(pathIds) {
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var timer = controller
		? window.setTimeout(function () { controller.abort(); }, AVESMAPS_PATH_LANDSCAPES_TIMEOUT_MS)
		: null;
	return fetch(AVESMAPS_PATH_LANDSCAPES_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ paths: pathIds }),
		signal: controller ? controller.signal : undefined,
	}).then(function (response) {
		if (timer) { window.clearTimeout(timer); }
		return response.ok ? response.json() : null;
	}).then(function (data) {
		avesmapsPathLandscapesMerge(data);
		return data;
	}).catch(function () {
		// A network error must not take the route plan with it: the line is a decoration on a
		// panel whose numbers are all computed locally. Same rule as the lore section.
		if (timer) { window.clearTimeout(timer); }
		return null;
	});
}

// Fetches only the ways not already held, in server-sized chunks. NEVER truncates: a shortened
// „Führt durch" looks exactly like a complete one.
function avesmapsPathLandscapesEnsure(pathIds) {
	var wanted = {};
	(pathIds || []).forEach(function (pathId) {
		if (pathId
			&& !avesmapsPathLandscapesStore.paths[pathId]
			&& !avesmapsPathLandscapesStore.pending[pathId]) {
			wanted[pathId] = true;   // the same way twice in one route is asked for once
		}
	});
	var missing = Object.keys(wanted);
	if (!missing.length) {
		return Promise.resolve(avesmapsPathLandscapesStore);
	}

	missing.forEach(function (pathId) { avesmapsPathLandscapesStore.pending[pathId] = true; });
	var chunks = [];
	for (var index = 0; index < missing.length; index += AVESMAPS_PATH_LANDSCAPES_CHUNK) {
		chunks.push(missing.slice(index, index + AVESMAPS_PATH_LANDSCAPES_CHUNK));
	}
	return Promise.all(chunks.map(avesmapsPathLandscapesPost)).then(function () {
		missing.forEach(function (pathId) {
			delete avesmapsPathLandscapesStore.pending[pathId];
			// A way the server did not answer for gets an empty record, so it is not asked for
			// again on every popup: „no landscapes here" is a valid answer, and 2.813 of 5.655
			// ways give it.
			if (!avesmapsPathLandscapesStore.paths[pathId]) {
				avesmapsPathLandscapesStore.paths[pathId] = { length: 0, in: [] };
			}
		});
		return avesmapsPathLandscapesStore;
	});
}

// ---- the infobox row ---------------------------------------------------------------------------
// ONE infobox row in the house format (.region-info-box__row + dt/dd), so it lines up with
// von/bis/Distanz/Reisezeit instead of standing beside them. The kind is the title tooltip:
// „Finsterkamm" then says „Gebirge" on hover, which answers „does this way run through a
// mountain range" without making the line longer.
//
// 💣 EVERY name here comes from Wiki Aventurica, i.e. from FOREIGN CONTENT -- a region is named by
// whoever edited its article. The fallback below therefore ESCAPES too; a fallback that merely
// stringified would turn „escapeHtml happens to be missing" into an injection, and that is the one
// failure mode a fallback must never introduce. Same reasoning as avesmapsLoreEscape.
function avesmapsPathLandscapesEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function avesmapsPathLandscapesRowMarkup(line) {
	var escape = typeof escapeHtml === "function" ? escapeHtml : avesmapsPathLandscapesEscape;
	var names = (line || []).map(function (entry) {
		var markup = formatLandscapesForInfobox([entry], escape);
		// Die Art als Titel-Tooltip: „Finsterkamm" sagt beim Draufzeigen „Gebirge". Der span umschließt
		// den fertigen Eintrag samt Link -- der Tooltip gehört zum Namen, nicht nur zum Text daneben.
		return entry.art ? '<span title="' + escape(entry.art) + '">' + markup + "</span>" : markup;
	}).join(" · ");
	return '<div class="region-info-box__row"><dt>Führt durch</dt><dd>' + names + "</dd></div>";
}

// ---- the observer ---------------------------------------------------------------------------
// 💣 THE FETCH DOES NOT START WHEN THE MARKUP IS BUILT. bindPopup gets finished HTML for every one
// of 5.655 ways while the map is still assembling -- a fetch at that point would be 5.655
// simultaneous requests, which is the 2026-07-21 pool incident word for word. A container is
// filled only once it actually stands in the DOM, i.e. once a popup was really opened.
//
// The route planner does NOT go through here: it fetches once when a route is drawn, which is a
// user action that happens exactly once and covers all its legs in one request.
function avesmapsPathLandscapesFillPending() {
	var pending = document.querySelectorAll("[data-path-landscapes]:not([data-path-landscapes-loaded])");
	for (var index = 0; index < pending.length; index++) {
		var element = pending[index];
		element.setAttribute("data-path-landscapes-loaded", "1");   // mark first: no double fetch
		(function (container) {
			var pathId = container.getAttribute("data-path-landscapes") || "";
			if (!pathId) {
				return;
			}
			avesmapsPathLandscapesEnsure([pathId]).then(function () {
				var line = avesmapsPathLandscapesLineFor([pathId]);
				if (!line.length) {
					return;   // nothing to say -- the row stays absent, no „keine Angabe"
				}
				container.innerHTML = avesmapsPathLandscapesRowMarkup(line);
			});
		})(element);
	}
}

if (typeof document !== "undefined" && !document.__avesmapsPathLandscapesObserverBound) {
	document.__avesmapsPathLandscapesObserverBound = true;
	var avesmapsPathLandscapesScanQueued = false;
	var avesmapsPathLandscapesScheduleScan = function () {
		if (avesmapsPathLandscapesScanQueued) {
			return;
		}
		avesmapsPathLandscapesScanQueued = true;
		window.setTimeout(function () {
			avesmapsPathLandscapesScanQueued = false;
			avesmapsPathLandscapesFillPending();
		}, 0);
	};
	if (typeof MutationObserver === "function") {
		new MutationObserver(avesmapsPathLandscapesScheduleScan)
			.observe(document.documentElement, { childList: true, subtree: true });
	}
	avesmapsPathLandscapesScheduleScan();
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_LANDSCAPE_MIN_SHARE,
		AVESMAPS_LANDSCAPE_FULL_SHARE,
		buildLandscapeLine,
		formatLandscapesForInfobox,
		formatLandscapesForPlanner,
		formatLandscapesForMapLinks,
		landscapeWikiKeyList,
	};
}
