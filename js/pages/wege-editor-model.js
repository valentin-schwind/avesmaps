// The travel model, browser side -- everything in the way editor that COMPUTES.
//
// 🔴 THIS FILE IS THE MIRROR OF api/_internal/routing/terrain-factor.php, and it must stay one.
// The server owns the rule; this is the second implementation that draws it. Both are unit-tested
// against the SAME reference points (5 % -> 1,5 · 10 % -> 2,0 · 20 % -> 3,0 · 30 % -> 4,0), so a
// change on one side that the other does not follow turns a test red instead of quietly drawing a
// curve that nothing computes.
//
// The rule, and it is the whole rule:
//     Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg auf Hängen über 20 % Gefälle/150
//     Faktor          = Leistungsmeilen / Meilen
//
// ⭐ 1 Schritt = 1 m and 1 Meile = 1.000 Schritt = 1 km, so the earthly constants ARE the
// aventurian ones -- that is why this model was chosen. Nothing to convert.
//
// No DOM, no fetch, no globals beyond the export shim at the bottom: this file is loadable by node
// (js/pages/__tests__/wege-editor-model.test.js) and by the editor page alike.

"use strict";

// Schritt of climb that cost one extra Leistungsmeile (AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT).
var WP_LKM_ASCENT_SCHRITT = 100.0;
// Schritt of descent that cost one extra Leistungsmeile -- only on stretches steeper than the
// threshold below. Gentle descent is free: neither a penalty nor a bonus.
var WP_LKM_DESCENT_SCHRITT = 150.0;
var WP_LKM_DESCENT_THRESHOLD = 0.20;
// 💣 The ceiling. There is NO floor and that is structural, not an omission: the model adds only
// non-negative terms to level ground, so the factor cannot fall below 1,0.
var WP_FACTOR_MAX = 4.0;
// 1 map unit = 3 displayed Meilen (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT / DISTANCE_SCALING_FACTOR).
var WP_MEILEN_PER_MAPUNIT = 3.0;

// The land speed table, verbatim from AVESMAPS_ROUTE_CLIENT_SPEED_TABLE
// (api/_internal/routing/client-graph.php). Water transports are deliberately absent: the slope
// factor is a LAND rule (avesmapsRouteTerrainAppliesTo) and a boat does not climb.
//
// ⚠️ 14.08.2026: auch diese Datei holt hier ihren Asset-Stempel nach -- ihr Deploy-Lauf wurde von einem
// nachfolgenden Push abgebrochen, der Hash landete in der Seite, die Datei nicht auf dem Server.
// Nur eine Inhaltsänderung heilt das; die ausführliche Begründung steht in js/config.js.
//
// 💣 `Querfeldein` steht seit dem 14.08.2026 auf 0,75 der Straße (GA S. 120-123, „offenes Gelände"),
// vorher 0,313 -- die eine Spalte, die die Tempowerte-Migration gezogen hat. Die übrigen sechs
// Wegtypen weichen weiterhin von der Quelle ab, und das bleibt so, bis der Owner sie im Fenster
// „Tempowerte" zurücksetzt.
var WP_SPEEDS = {
	lightRider:    { label: "Reiter",               Reichsstrasse: 8.16, Strasse: 7.68, Weg: 6.72, Pfad: 5.76, Gebirgspass: 2.88, Wuestenpfad: 3.84, Querfeldein: 5.76 },
	groupHorse:    { label: "Reisegruppe beritten", Reichsstrasse: 5.79, Strasse: 5.37, Weg: 4.55, Pfad: 3.72, Gebirgspass: 2.07, Wuestenpfad: 2.48, Querfeldein: 4.03 },
	// Weg and Gebirgspass carry the source's carriage rule („auf Karrenwegen und Pässen nur halbe
	// Geschwindigkeit", S. 123) and are therefore HALF of what the path-type factor alone would give.
	horseCarriage: { label: "Kutsche",              Reichsstrasse: 8.39, Strasse: 7.68, Weg: 3.14, Pfad: 4.19, Gebirgspass: 1.4, Wuestenpfad: 4.19, Querfeldein: 5.76 },
	lightWalker:   { label: "Zu Fuß",               Reichsstrasse: 6.75, Strasse: 6.14, Weg: 5.52, Pfad: 4.91, Gebirgspass: 2.46, Wuestenpfad: 4.29, Querfeldein: 4.61 },
	groupFoot:     { label: "Reisegruppe zu Fuß",   Reichsstrasse: 5.18, Strasse: 4.61, Weg: 4.04, Pfad: 3.45, Gebirgspass: 1.73, Wuestenpfad: 2.88, Querfeldein: 3.45 },
	caravan:       { label: "Karawane",             Reichsstrasse: 5.27, Strasse: 4.61, Weg: 3.95, Pfad: 3.29, Gebirgspass: 1.98, Wuestenpfad: 2.63, Querfeldein: 3.45 }
};

// The LAND way types, in the order the pictures are drawn.
var WP_LAND_TYPES = [
	{ key: "Reichsstrasse", label: "Reichsstraße" },
	{ key: "Strasse",       label: "Straße" },
	{ key: "Weg",           label: "Weg" },
	{ key: "Pfad",          label: "Pfad" },
	{ key: "Gebirgspass",   label: "Gebirgspass" },
	{ key: "Wuestenpfad",   label: "Wüstenpfad" },
	{ key: "Querfeldein",   label: "Querfeldein" }
];

// 🔴 FOUR SERIES, and the ceiling is a measured one -- see the note on --color-chart-* in
// css/base/tokens.css. A fifth series is refused, never given an invented fifth hue.
var WP_MAX_SERIES = 4;

/**
 * PURE: the time factor for a gradient given in PERCENT (positive = uphill, negative = downhill).
 *
 * Over one Meile (1.000 Schritt horizontal) a gradient s means 1.000·|s| Schritt of height, which
 * is what turns the two constants above into the short forms:
 *     uphill    F = 1 + 10 · s          (capped at 4,0, so the cap bites from 30 %)
 *     downhill  F = 1                   up to 20 %
 *               F = 1 + 6⅔ · |s|        beyond it (capped at 4,0, reached exactly at 45 %)
 *
 * 💣 THE STEP AT 20 % DESCENT IS REAL, not a rounding artefact. The threshold is decided per
 * sample step in the profile run (avesmapsTerrainDescentIsSteep), and above it the WHOLE descent
 * of that step counts -- so the factor jumps from 1,0 to 2⅓, it does not ramp. Two players
 * stumbled over exactly this in public; a curve that smooths it over would be lying.
 */
function wpFactorForGradientPercent(gradientPercent) {
	var s = Number(gradientPercent) / 100;
	if (!isFinite(s)) { return 1.0; }
	if (s >= 0) {
		return Math.min(WP_FACTOR_MAX, 1 + (1000 * s) / WP_LKM_ASCENT_SCHRITT);
	}
	var drop = -s;
	if (drop <= WP_LKM_DESCENT_THRESHOLD) { return 1.0; }
	return Math.min(WP_FACTOR_MAX, 1 + (1000 * drop) / WP_LKM_DESCENT_SCHRITT);
}

/**
 * PURE: the time factor of ONE traversal in ONE direction, from the stored sums.
 *
 * Mirrors avesmapsTerrainLeistungsFactor. `distanceMapunits` is the chord length in map units --
 * the same measure the graph and the speed table use, NOT the drawn Catmull-Rom curve.
 *
 * ⚠️ `capped: false` is what the CALIBRATION needs, and the difference is not cosmetic: without
 * the cap the model is additive, so a length-weighted mean over pieces is bit-identical with the
 * value of the whole way. min() breaks that. The profile run does not even know where the edges
 * are, so it must accumulate uncapped.
 */
function wpLeistungsFactor(ascentSchritt, steepDescentSchritt, distanceMapunits, options) {
	var capped = !options || options.capped !== false;
	if (ascentSchritt === null || ascentSchritt === undefined) { return 1.0; }
	if (steepDescentSchritt === null || steepDescentSchritt === undefined) { return 1.0; }
	if (!(distanceMapunits > 0)) { return 1.0; }
	var miles = distanceMapunits * WP_MEILEN_PER_MAPUNIT;
	if (!(miles > 0)) { return 1.0; }
	var extra = Math.max(0, ascentSchritt) / WP_LKM_ASCENT_SCHRITT
		+ Math.max(0, steepDescentSchritt) / WP_LKM_DESCENT_SCHRITT;
	if (!(extra > 0)) { return 1.0; }
	var factor = 1 + extra / miles;
	return capped ? Math.min(WP_FACTOR_MAX, factor) : factor;
}

/**
 * PURE: both directions of one way, from the ONE stored row.
 *
 * 💣 BOTH DIRECTIONS COME FROM THE SAME FOUR SUMS. Forwards pays `ascent` + `steep_descent`;
 * backwards the way's descent IS its climb, so it pays `descent` + `steep_ascent`. Getting this
 * pairing wrong prices a mountain pass as if it were flat in one direction -- and nothing looks
 * broken, the number is just wrong.
 *
 * `profile` is the stored profile_json: one [ascent, descent, steepAscent, steepDescent] per piece,
 * in STORED direction, in Schritt.
 */
function wpProfileSums(profile) {
	var sums = { ascent: 0, descent: 0, steepAscent: 0, steepDescent: 0 };
	if (!Array.isArray(profile)) { return null; }
	for (var i = 0; i < profile.length; i++) {
		var piece = profile[i];
		// 💣 THE LENGTH OF THIS ARRAY IS THE FORMAT GUARD. Rows written before 2026-07-30 hold
		// pairs of two; anything shorter than four is a pre-model row and must read as „no data",
		// never as a Leistungsmeilen sum.
		if (!Array.isArray(piece) || piece.length < 4) { return null; }
		sums.ascent += Number(piece[0]) || 0;
		sums.descent += Number(piece[1]) || 0;
		sums.steepAscent += Number(piece[2]) || 0;
		sums.steepDescent += Number(piece[3]) || 0;
	}
	return sums;
}

function wpBothDirectionFactors(profile, distanceMapunits, options) {
	var sums = wpProfileSums(profile);
	if (sums === null) { return null; }
	return {
		forward: wpLeistungsFactor(sums.ascent, sums.steepDescent, distanceMapunits, options),
		backward: wpLeistungsFactor(sums.descent, sums.steepAscent, distanceMapunits, options),
		sums: sums
	};
}

/**
 * PURE: the height curve of a way, by accumulating the per-piece differences.
 *
 * 💣 profile_json HOLDS NO ABSOLUTE HEIGHTS, only differences per piece. The curve therefore starts
 * wherever we choose -- here at 0 -- and the axis must be labelled RELATIVE. Anyone reading these
 * as „the pass is 900 Schritt high" is reading something that was never stored.
 *
 * 💣 AND IT IS A SIMPLIFICATION. `ascent` and `descent` are TOTAL VARIATIONS of the piece, so
 * `ascent - descent` is its net change -- correct for the curve, but blind to what goes up and down
 * INSIDE one piece. The sums know it, the line does not.
 *
 * `pieceLengths` (map units, one per piece) positions the points along x; without it the pieces are
 * spaced evenly, which is honest only when they are.
 */
function wpProfileCurve(profile, pieceLengths) {
	if (!Array.isArray(profile) || profile.length === 0) { return []; }
	var haveLengths = Array.isArray(pieceLengths) && pieceLengths.length === profile.length;
	var points = [{ x: 0, y: 0 }];
	var x = 0;
	var y = 0;
	for (var i = 0; i < profile.length; i++) {
		var piece = profile[i];
		if (!Array.isArray(piece) || piece.length < 4) { return []; }
		y += (Number(piece[0]) || 0) - (Number(piece[1]) || 0);
		x += haveLengths ? (Number(pieceLengths[i]) || 0) : 1;
		points.push({ x: x, y: y });
	}
	return points;
}

/**
 * PURE: group way SEGMENTS into WAYS.
 *
 * 💣 ONE WAY NAME STANDS FOR MANY SEGMENTS. „Reichsstraße 1" has 26 of them (measured,
 * docs/konfliktmanagement-design.md §6a: 215 groups holding 1547 objects between them). Listed
 * ungrouped they were 26 rows with the same name, the same type and the same second line -- there
 * was no way to tell which one you were editing. That is what this function exists to prevent.
 *
 * Grouped by the WIKI WAY where there is one, otherwise by name+subtype: two segments of the same
 * wiki way are certainly the same road, two same-named ways without a wiki link are not necessarily.
 *
 * ⭐ Segments are ordered GEOGRAPHICALLY (min_x, then min_y), not by whatever order the database
 * returned -- so „Abschnitt 3" lies between 2 and 4 and the number means something.
 */
function wpGroupWays(ways) {
	var groups = [];
	var byKey = {};
	(ways || []).forEach(function (way) {
		if (!way) { return; }
		var key = way.wiki_path && way.wiki_path.wiki_key
			? "wiki:" + way.wiki_path.wiki_key
			: "name:" + way.feature_subtype + ":" + way.name;
		if (!byKey[key]) {
			byKey[key] = {
				key: key,
				name: way.name,
				feature_subtype: way.feature_subtype,
				wiki_path: way.wiki_path || null,
				segments: []
			};
			groups.push(byKey[key]);
		}
		byKey[key].segments.push(way);
	});
	groups.forEach(function (group) {
		group.segments.sort(function (a, b) {
			var ax = a.bbox ? a.bbox[0] : 0;
			var bx = b.bbox ? b.bbox[0] : 0;
			if (ax !== bx) { return ax - bx; }
			var ay = a.bbox ? a.bbox[1] : 0;
			var by = b.bbox ? b.bbox[1] : 0;
			return ay - by;
		});
	});
	return groups;
}

/**
 * PURE: the rough extent of a segment in miles, from its bounding box.
 *
 * 💣 THIS IS NOT A LENGTH, it is a LOWER BOUND -- the diagonal of the box the way lies in. A
 * winding way is longer than its diagonal, never shorter. It exists to tell two sections APART in
 * the list and is therefore always shown with a „≈". The real length comes from the geometry
 * (wpPieceLengths), and column 3 uses that one.
 */
function wpRoughMiles(way) {
	if (!way || !way.bbox || way.bbox.length < 4) { return null; }
	var dx = Number(way.bbox[2]) - Number(way.bbox[0]);
	var dy = Number(way.bbox[3]) - Number(way.bbox[1]);
	if (!isFinite(dx) || !isFinite(dy)) { return null; }
	return Math.sqrt(dx * dx + dy * dy) * WP_MEILEN_PER_MAPUNIT;
}

/** PURE: chord lengths of a LineString's pieces, in map units. */
function wpPieceLengths(coordinates) {
	var lengths = [];
	if (!Array.isArray(coordinates)) { return lengths; }
	for (var i = 1; i < coordinates.length; i++) {
		var a = coordinates[i - 1];
		var b = coordinates[i];
		if (!Array.isArray(a) || !Array.isArray(b)) { return []; }
		lengths.push(Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1])));
	}
	return lengths;
}

// Node for the tests, plain globals for the editor page (no build step, AGENTS.md §3).
/* ---- Tempowerte: was hat sich beim Speichern oder Zurücksetzen bewegt? ------------------------
 *
 * 🔴 DER ABSCHNITTS-RÜCKSETZER SCHREIBT SOFORT und fasst dabei Dutzende Zellen an. Ohne einen
 * Vergleich vorher/nachher ist das ein Sprung ins Dunkle: die Zahlen stehen hinterher anders da,
 * aber welche sich bewegt haben, sieht man nicht -- und rückgängig machen kann man ihn auch nicht.
 * Owner-Befund vom 14.08.2026, wörtlich: „da standen 6 Werte weichen ab, jetzt hab ich rückgesetzt,
 * aber weiß nicht welche Werte sich verändert haben."
 *
 * ⭐ Sie stehen HIER und nicht im Fenster: `wege-editor.js` ist DOM-Code in einem IIFE und hat
 * deshalb keinen Verhaltenstest. Diese beiden sind reine Rechnung, also gehören sie in die Datei,
 * die geprüft wird.
 */

/** Alle vier Sorten Tempowert in EINER flachen Karte: Schlüssel -> Zahl. */
function wpTempoFlatValues(state) {
	var flat = {};
	if (!state) { return flat; }
	var values = state.values || {};

	var grid = values.grid || {};
	Object.keys(grid).forEach(function (transport) {
		var row = grid[transport] || {};
		Object.keys(row).forEach(function (pathType) {
			flat["grid:" + transport + ":" + pathType] = Number(row[pathType]);
		});
	});

	// 💣 Die EBENE gehört in den Schlüssel: `wald` gibt es in `vegetation`, und nichts verbietet
	// einer zweiten Ebene denselben Artnamen -- ohne sie verglichen sich zwei verschiedene Zeilen.
	(state.landscapes || []).forEach(function (row) {
		if (!row || row.factor === null || row.factor === undefined) { return; }
		flat["ls:" + row.kind + ":" + row.type_key] = Number(row.factor);
	});

	var ground = values.ground_penalties || {};
	Object.keys(ground).forEach(function (key) { flat["gr:" + key] = Number(ground[key]); });

	["river_ratio", "calibration_target_miles"].forEach(function (key) {
		if (values[key] === undefined || values[key] === null) { return; }
		flat["ms:" + key] = Number(values[key]);
	});

	var ramp = values.offroad_ramp || {};
	["per_mile", "max"].forEach(function (key) {
		if (ramp[key] === undefined || ramp[key] === null) { return; }
		flat["or:" + key] = Number(ramp[key]);
	});

	return flat;
}

/**
 * Was sich zwischen zwei flachen Karten bewegt hat -- mit dem ALTEN Wert, nicht nur der Tatsache.
 *
 * ⚠️ Ein Wert ohne Vorher-Zahl ist keine Änderung, sondern ein neuer Wert: „von — auf 0,50" hilft
 * niemandem, und beim ersten Laden wäre sonst jede Zelle eine Meldung.
 * ⚠️ Rundungsrauschen zählt nicht. Ohne diese Schranke meldete jedes Speichern Dutzende Bewegungen,
 * und die Anzeige wäre nach zwei Malen nur noch Rauschen, das man wegsieht.
 */
function wpTempoChanges(before, after) {
	var changes = [];
	if (!before || !after) { return changes; }
	Object.keys(after).forEach(function (key) {
		if (!(key in before)) { return; }
		var from = Number(before[key]);
		var to = Number(after[key]);
		if (!isFinite(from) || !isFinite(to)) { return; }
		if (Math.abs(from - to) < 0.0005) { return; }
		changes.push({ key: key, from: from, to: to });
	});

	return changes;
}

/**
 * REIN: was die Abschnitte EINES Weges gemeinsam haben -- und wo sie uneins sind.
 *
 * Die Weg-Ebene des Editors zeigt dieselben Felder wie die Abschnittsebene, nur fuer alle
 * Abschnitte zugleich. Damit gibt es je Feld einen dritten Zustand neben „an" und „aus":
 * GEMISCHT. Diese Funktion rechnet ihn aus, und zwar nur ihn -- was die Oberflaeche daraus
 * macht, entscheidet sie selbst.
 *
 * 💣 DER GEMISCHTE ZUSTAND IST EIN EIGENER WERT, KEIN „AUS". Wer ihn beim Speichern wie „aus"
 * behandelt, loescht genau die Ausnahmen, wegen derer die Abschnitte ueberhaupt auseinandergehen:
 * am Schattenbachpass haben 2 von 8 Abschnitten die Kutsche, und ein Sammel-Speichern, das den
 * halben Haken als leeren liest, nimmt sie ihnen stillschweigend weg.
 *
 * ⚠️ Die VERKEHRSDOMAENE (Land/Fluss/See) beantwortet diese Funktion NICHT. Sie liefert die
 * Verteilung der Wegtypen; welche Fahrtypen daraus folgen, weiss `wpVerkehrsdomaene` im Editor,
 * und eine zweite Wasserliste hier waere die zweite Wahrheit aus AGENTS.md §5.
 *
 * @param {Array} segmente  die Abschnitte einer Gruppe (Zeilen der Editorliste)
 * @param {Array<string>} transportSchluessel  alle Fahrtypen, in Anzeigereihenfolge
 */
function wpGroupFieldStates(segmente, transportSchluessel) {
	var liste = Array.isArray(segmente) ? segmente : [];
	var schluessel = Array.isArray(transportSchluessel) ? transportSchluessel : [];
	var gesamt = liste.length;

	// Ein einfaches Feld: alle gleich -> der Wert, sonst `gleich: false` und KEIN Wert. 💣 Kein
	// Rueckfall auf den Wert des ersten Abschnitts -- der saehe aus wie eine Aussage ueber alle.
	function einfach(lies) {
		if (gesamt === 0) { return { gleich: true, wert: null }; }
		var erster = lies(liste[0]);
		for (var i = 1; i < gesamt; i++) {
			if (lies(liste[i]) !== erster) { return { gleich: false, wert: null }; }
		}
		return { gleich: true, wert: erster };
	}

	// Die Verteilung der Wegtypen, haeufigster zuerst -- daraus wird der Satz „6× Gebirgspass,
	// 2× Pfad", den die Oberflaeche unter den Waehler schreibt.
	var zaehler = {};
	liste.forEach(function (segment) {
		var key = String((segment && segment.feature_subtype) || "");
		zaehler[key] = (zaehler[key] || 0) + 1;
	});
	var verteilung = Object.keys(zaehler).map(function (key) {
		return { wert: key, anzahl: zaehler[key] };
	}).sort(function (a, b) {
		if (a.anzahl !== b.anzahl) { return b.anzahl - a.anzahl; }
		return a.wert < b.wert ? -1 : (a.wert > b.wert ? 1 : 0);
	});

	// Je Fahrtyp: „an" (alle), „aus" (keiner), „teils" (dazwischen).
	var transports = {};
	schluessel.forEach(function (key) {
		var an = 0;
		liste.forEach(function (segment) {
			var erlaubt = segment && Array.isArray(segment.allowed_transports)
				? segment.allowed_transports : [];
			if (erlaubt.indexOf(key) !== -1) { an++; }
		});
		// ⚠️ Die leere Gruppe ist „aus", nicht „teils": 0 von 0 ist kein Widerspruch.
		var zustand = an === 0 ? "aus" : (an === gesamt ? "an" : "teils");
		transports[key] = { zustand: zustand, an: an, gesamt: gesamt };
	});

	return {
		gesamt: gesamt,
		name: einfach(function (s) { return String((s && s.name) || ""); }),
		show_label: einfach(function (s) { return (s && s.show_label) === true; }),
		feature_subtype: {
			gleich: verteilung.length <= 1,
			wert: verteilung.length === 1 ? verteilung[0].wert : null,
			verteilung: verteilung
		},
		// Die andere Quelle ist ein Paar; verglichen wird die Adresse SAMT Linktext -- zwei Zeilen
		// mit derselben Adresse und verschiedenem Text sind nicht dasselbe.
		other_source: einfach(function (s) {
			var quelle = s && s.other_source;
			if (!quelle || !quelle.url) { return ""; }
			return String(quelle.url) + "\u0000" + String(quelle.label || "");
		}),
		transports: transports
	};
}

/**
 * REIN: welche Felder ein Sammel-Speichern wirklich schreiben soll.
 *
 * 💣 DIE EINE REGEL DER WEG-EBENE. Geschrieben wird nur, was der Editor ANGEFASST hat -- ein
 * Sammel-Speichern, das alle Felder schickt, macht jede gewollte Ausnahme platt, und zwar
 * lautlos, weil ein Formular nun einmal alle Felder mitschickt. Genau dieser Fehler ist am
 * 17.08.2026 in `avesmapsUpsertGameLiterature` gemessen worden (dort stempelte er jedes Feld auf
 * `manual`, und die Spalte sah gepflegt aus, ohne etwas auszusagen).
 *
 * @param {Object} vorher  das Ergebnis von wpGroupFieldStates beim Oeffnen
 * @param {Object} entwurf  was in der Maske steht: {name, show_label, feature_subtype,
 *                          transports: {key: "an"|"aus"|"teils"}, other_source}
 * @return {Array<string>} die Feldnamen fuer `fields`
 */
function wpGroupChangedFields(vorher, entwurf) {
	var felder = [];
	if (!vorher || !entwurf) { return felder; }

	// Der Wegtyp: `null` im Entwurf heisst „gemischt lassen" und ist keine Aenderung.
	if (entwurf.feature_subtype !== null && entwurf.feature_subtype !== undefined
		&& entwurf.feature_subtype !== ""
		&& !(vorher.feature_subtype.gleich && vorher.feature_subtype.wert === entwurf.feature_subtype)) {
		felder.push("feature_subtype");
	}

	if (entwurf.name !== null && entwurf.name !== undefined
		&& !(vorher.name.gleich && vorher.name.wert === entwurf.name)) {
		felder.push("name");
	}

	if (entwurf.show_label !== null && entwurf.show_label !== undefined
		&& !(vorher.show_label.gleich && vorher.show_label.wert === entwurf.show_label)) {
		felder.push("show_label");
	}

	// 💣 Ein Fahrtyp, der auf „teils" STEHENGEBLIEBEN ist, gehoert nicht in die Liste. Nur wer
	// von „teils" auf „an"/„aus" gezogen wurde -- oder von „an" auf „aus" und umgekehrt --
	// wird geschrieben.
	var transporte = entwurf.transports || {};
	var geaendert = Object.keys(transporte).some(function (key) {
		var alt = vorher.transports[key];
		if (!alt) { return true; }
		if (transporte[key] === "teils") { return false; }
		return transporte[key] !== alt.zustand;
	});
	if (geaendert) { felder.push("allowed_transports"); }

	if (entwurf.other_source !== null && entwurf.other_source !== undefined) {
		var neu = entwurf.other_source && entwurf.other_source.url
			? String(entwurf.other_source.url) + "\u0000" + String(entwurf.other_source.label || "")
			: "";
		if (!(vorher.other_source.gleich && vorher.other_source.wert === neu)) {
			felder.push("other_source");
		}
	}

	return felder;
}

/**
 * REIN: die Fahrtypen-Liste, die ein Sammel-Speichern je Abschnitt schreiben muss.
 *
 * ⚠️ Sie ist NICHT fuer alle Abschnitte dieselbe. Ein Fahrtyp auf „teils" behaelt je Abschnitt
 * seinen eigenen Zustand -- nur die ausdruecklich gesetzten werden ueberall gleich gemacht.
 * Deshalb rechnet der Server das nicht: er bekommt je Fahrtyp eine ENTSCHEIDUNG, nicht eine
 * fertige Liste (`allowed_transports_set`).
 */
function wpGroupTransportDecisions(vorher, entwurf) {
	var entscheidungen = {};
	var transporte = (entwurf && entwurf.transports) || {};
	Object.keys(transporte).forEach(function (key) {
		if (transporte[key] === "teils") { return; }
		var alt = vorher && vorher.transports ? vorher.transports[key] : null;
		if (alt && alt.zustand === transporte[key]) { return; }
		entscheidungen[key] = transporte[key] === "an";
	});
	return entscheidungen;
}

/**
 * REIN: ein Wegstueck GEDREHT -- gelesen von seinem anderen Ende her.
 *
 * 💣 DAS IST MEHR ALS EINE UMGEKEHRTE LISTE. Die vier Zahlen je Wegstueck sind
 * `[Anstieg, Abstieg, steiler Anstieg, steiler Abstieg]` IN SPEICHERRICHTUNG
 * (avesmapsTerrainProfileForLine, api/_internal/app/terrain-store.php). Wer nur die Liste
 * umdreht, bekommt eine Kurve, die bergauf laeuft, wo der Weg bergab geht -- und die Summen
 * darunter stimmen trotzdem, weil sie sich beim Drehen nicht aendern. Es faellt also nicht auf.
 *
 * ⚠️ Ein Stueck mit weniger als vier Zahlen stammt aus der Zeit vor dem 30.07.2026 (Paare aus
 * zwei). Es wird UNVERAENDERT durchgereicht statt halb gedreht: der Router weist solche Zeilen
 * ohnehin ab („keine Hoehendaten"), und eine halbe Drehung waere eine erfundene Zahl.
 */
function wpReversePiece(stueck) {
	if (!Array.isArray(stueck) || stueck.length < 4) { return stueck; }
	return [stueck[1], stueck[0], stueck[3], stueck[2]];
}

/** REIN: das ganze Profil eines Abschnitts, von hinten gelesen. */
function wpReverseProfile(profil) {
	if (!Array.isArray(profil)) { return []; }
	return profil.slice().reverse().map(wpReversePiece);
}

// Wie nah zwei Endpunkte liegen muessen, um als DERSELBE Punkt zu gelten -- in Karteneinheiten
// (1 Einheit = 3 Meilen), also 0,001 = drei Meter.
//
// 💣 AM LIVEBESTAND GEMESSEN (19.08.2026, 5994 Wege, 416 mehrteilige Namensgruppen). Zwei freie
// Enden derselben Gruppe liegen entweder WINZIG auseinander oder WEIT; dazwischen ist fast
// nichts:
//
//     unter 0,001 Einheiten (3 Meter):  19 % der freien Enden
//     unter 0,01  Einheiten:            20 %
//     unter 0,1   Einheiten:            22 %
//     Median des Abstands:              4,12 Einheiten (12,4 Meilen)
//
// Die erste Gruppe ist Zeichenungenauigkeit (jemand hat zwei Linien „aneinander" gesetzt), die
// zweite sind echte Luecken. Die Schwelle gehoert in das leere Feld dazwischen.
//
// 💣 UND SIE IST EINE DISTANZ, KEINE RUNDUNG. Der erste Entwurf rundete beide Punkte auf drei
// Nachkommastellen und verglich die Ergebnisse -- das ist keine Toleranz, sondern ein Raster:
// 10,0 und 10,0005 fallen in verschiedene Zellen (10,000 gegen 10,001) und finden sich nicht,
// waehrend 10,0004 und 10,0006 sich finden. Ob zwei Enden zusammengehoeren, haengt dann davon
// ab, WO sie liegen, nicht wie weit sie auseinander sind. Der Test haelt genau diesen Fall fest.
//
// ⚠️ Das ist NICHT dieselbe Zahl wie in avesmapsAddClientCompatiblePathConnection
// (api/_internal/routing/client-graph.php), und das ist Absicht: dort wird ein Weg an einem
// ORT geteilt, dessen Koordinate gesetzt und exakt ist. Hier treffen zwei von Hand gezogene
// Linienenden aufeinander. Zwei verschiedene Fragen, zwei Toleranzen.
var WP_CHAIN_TOLERANZ = 0.001;

/**
 * REIN: Endpunkte zu KNOTEN zusammenfassen, die naeher als die Toleranz beieinanderliegen.
 *
 * ⭐ Ueber ein Gitter mit Maschenweite = Toleranz und eine 3x3-Sonde: jeder Punkt sieht nur
 * seine acht Nachbarzellen, und weiter als eine Masche kann ein Treffer nicht liegen. Dasselbe
 * Verfahren wie das Segment-Gitter des Kreuzungs-Pruefhakens (AGENTS.md §11) -- ohne es waere
 * die Suche quadratisch in der Zahl der Abschnitte.
 *
 * @return {function(Array): (string|null)} eine Nachschlagefunktion Punkt -> Knotenschluessel
 */
function wpChainNodeResolver(punkte) {
	var gitter = {};
	var zelle = function (x, y) { return Math.floor(x / WP_CHAIN_TOLERANZ) + ":" + Math.floor(y / WP_CHAIN_TOLERANZ); };

	function suche(punkt) {
		if (!Array.isArray(punkt) || punkt.length < 2) { return null; }
		var x = Number(punkt[0]);
		var y = Number(punkt[1]);
		if (!isFinite(x) || !isFinite(y)) { return null; }
		var cx = Math.floor(x / WP_CHAIN_TOLERANZ);
		var cy = Math.floor(y / WP_CHAIN_TOLERANZ);
		for (var dx = -1; dx <= 1; dx++) {
			for (var dy = -1; dy <= 1; dy++) {
				var eintraege = gitter[(cx + dx) + ":" + (cy + dy)];
				if (!eintraege) { continue; }
				for (var i = 0; i < eintraege.length; i++) {
					var kandidat = eintraege[i];
					if (Math.hypot(kandidat.x - x, kandidat.y - y) <= WP_CHAIN_TOLERANZ) {
						return kandidat.key;
					}
				}
			}
		}
		return null;
	}

	// Erst alle Punkte einmal registrieren -- der erste seiner Nachbarschaft gibt den Namen.
	// ⚠️ Die Reihenfolge entscheidet, WELCHER Punkt der kanonische wird; sie ist die Reihenfolge
	// der Abschnitte und damit stabil. Die Zugehoerigkeit selbst haengt nicht daran.
	(punkte || []).forEach(function (punkt) {
		if (suche(punkt) !== null) { return; }
		if (!Array.isArray(punkt) || punkt.length < 2) { return; }
		var x = Number(punkt[0]);
		var y = Number(punkt[1]);
		if (!isFinite(x) || !isFinite(y)) { return; }
		var key = x + "|" + y;
		var schluessel = zelle(x, y);
		if (!gitter[schluessel]) { gitter[schluessel] = []; }
		gitter[schluessel].push({ x: x, y: y, key: key });
	});

	return suche;
}

/**
 * REIN: die Abschnitte eines Weges zu KETTEN ordnen.
 *
 * Die Editorliste sortiert Abschnitte nach ihrer bbox-Ecke. Das ordnet sie UNGEFAEHR von West
 * nach Ost und reicht fuer eine durchgehende Hoehenkurve nicht -- die braucht die echte Abfolge
 * samt der Frage, welcher Abschnitt rueckwaerts darin liegt.
 *
 * Gebaut wird ein Graph: Knoten sind die (gerundeten) Endpunkte, Kanten die Abschnitte. Eine
 * Kette laeuft solange weiter, wie der naechste Knoten GENAU ZWEI Kanten hat. Ein Knoten mit
 * einer Kante ist ein Ende, einer mit drei oder mehr eine Verzweigung -- dort schliesst die
 * Kette.
 *
 * 🔴 EINE GEBROCHENE KETTE WIRD GEZEIGT, NICHT UEBERBRUECKT. Verzweigungen und Luecken sind der
 * Normalfall, nicht die Ausnahme („Reichsstrasse 1" traegt 26 Segmente ueber den halben
 * Kontinent). Eine erfundene Verbindung waere eine Kurve, die einen Weg behauptet, den es nicht
 * gibt.
 *
 * @param {Array} segmente  je Eintrag {public_id, ends: {from, to}, …}
 * @return {Array<Array<{index:number, gedreht:boolean}>>} Ketten, laengste zuerst
 */
function wpChainSegments(segmente) {
	var liste = Array.isArray(segmente) ? segmente : [];
	var knoten = {};   // knotenSchluessel -> [Segmentindex]
	var enden = [];    // Segmentindex -> [vonSchluessel, nachSchluessel]

	// Erst alle Endpunkte sammeln, dann zu Knoten zusammenfassen -- die Zusammenfassung braucht
	// die ganze Menge, ein Punkt allein kennt seine Nachbarn nicht.
	var alleEnden = [];
	liste.forEach(function (segment) {
		var ends = segment && segment.ends;
		if (!ends) { return; }
		alleEnden.push(ends.from);
		alleEnden.push(ends.to);
	});
	var knotenVon = wpChainNodeResolver(alleEnden);

	liste.forEach(function (segment, index) {
		var ends = segment && segment.ends;
		var von = ends ? knotenVon(ends.from) : null;
		var nach = ends ? knotenVon(ends.to) : null;
		enden[index] = [von, nach];
		[von, nach].forEach(function (schluessel) {
			if (schluessel === null) { return; }
			if (!knoten[schluessel]) { knoten[schluessel] = []; }
			knoten[schluessel].push(index);
		});
	});

	var benutzt = {};
	var ketten = [];

	// Von einem Ende aus weiterlaufen, solange der naechste Knoten genau zwei Kanten hat.
	function laufe(startIndex, startSchluessel) {
		var kette = [];
		var index = startIndex;
		var eingang = startSchluessel;
		while (index !== null && !benutzt[index]) {
			benutzt[index] = true;
			var paar = enden[index];
			// Betreten wir das Stueck an seinem `to`, liegt es rueckwaerts in der Kette.
			var gedreht = paar[0] !== eingang;
			kette.push({ index: index, gedreht: gedreht });
			var ausgang = gedreht ? paar[0] : paar[1];
			if (ausgang === null) { break; }
			var nachbarn = knoten[ausgang] || [];
			// 🔴 GENAU ZWEI. Bei einer Verzweigung (drei und mehr) schliesst die Kette hier --
			// welcher Arm der „richtige" waere, kann niemand wissen.
			if (nachbarn.length !== 2) { break; }
			var naechster = nachbarn[0] === index ? nachbarn[1] : nachbarn[0];
			if (benutzt[naechster]) { break; }
			index = naechster;
			eingang = ausgang;
		}
		return kette;
	}

	// Erst von echten ENDEN aus (Knoten mit einer Kante), dann der Rest. Ohne diese Reihenfolge
	// begaenne eine Kette womoeglich in ihrer Mitte und zerfiele in zwei Haelften.
	liste.forEach(function (segment, index) {
		if (benutzt[index]) { return; }
		var paar = enden[index];
		var vonGrad = paar[0] === null ? 0 : (knoten[paar[0]] || []).length;
		var nachGrad = paar[1] === null ? 0 : (knoten[paar[1]] || []).length;
		if (vonGrad === 1) { ketten.push(laufe(index, paar[0])); return; }
		if (nachGrad === 1) { ketten.push(laufe(index, paar[1])); }
	});
	liste.forEach(function (segment, index) {
		if (benutzt[index]) { return; }
		ketten.push(laufe(index, enden[index][0]));
	});

	ketten.sort(function (a, b) { return b.length - a.length; });
	return ketten.filter(function (kette) { return kette.length > 0; });
}

/**
 * REIN: die Hoehenkurve einer KETTE -- Stuetzpunkte {x: Meilen ab Anfang, y: Schritt ueber Start}.
 *
 * ⚠️ Abschnitte OHNE Profil unterbrechen die Kurve nicht, sie werden UEBERSPRUNGEN: ihre Laenge
 * zaehlt auf der x-Achse mit, ihre Hoehe bleibt stehen. „Kein Profil" heisst „unbekannt", nicht
 * „eben" -- deshalb sagt der Kasten daneben, wie viele es waren.
 */
function wpChainCurve(kette, segmente) {
	var punkte = [{ x: 0, y: 0 }];
	var x = 0;
	var y = 0;
	(Array.isArray(kette) ? kette : []).forEach(function (glied) {
		var segment = segmente[glied.index];
		if (!segment) { return; }
		var laengen = Array.isArray(segment.piece_lengths) ? segment.piece_lengths.slice() : [];
		var profil = segment.terrain && Array.isArray(segment.terrain.profile)
			? segment.terrain.profile.slice()
			: null;
		if (glied.gedreht) {
			laengen.reverse();
			profil = profil === null ? null : wpReverseProfile(profil);
		}
		if (profil === null) {
			x += Number(segment.length_units || 0) * WP_MEILEN_PER_MAPUNIT;
			punkte.push({ x: x, y: y });
			return;
		}
		profil.forEach(function (stueck, i) {
			x += Number(laengen[i] || 0) * WP_MEILEN_PER_MAPUNIT;
			y += Number(stueck[0] || 0) - Number(stueck[1] || 0);
			punkte.push({ x: x, y: y });
		});
	});
	return punkte;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		wpTempoFlatValues: wpTempoFlatValues,
		wpTempoChanges: wpTempoChanges,
		WP_LKM_ASCENT_SCHRITT: WP_LKM_ASCENT_SCHRITT,
		WP_LKM_DESCENT_SCHRITT: WP_LKM_DESCENT_SCHRITT,
		WP_LKM_DESCENT_THRESHOLD: WP_LKM_DESCENT_THRESHOLD,
		WP_FACTOR_MAX: WP_FACTOR_MAX,
		WP_MEILEN_PER_MAPUNIT: WP_MEILEN_PER_MAPUNIT,
		WP_SPEEDS: WP_SPEEDS,
		WP_LAND_TYPES: WP_LAND_TYPES,
		WP_MAX_SERIES: WP_MAX_SERIES,
		wpFactorForGradientPercent: wpFactorForGradientPercent,
		wpLeistungsFactor: wpLeistungsFactor,
		wpProfileSums: wpProfileSums,
		wpBothDirectionFactors: wpBothDirectionFactors,
		wpProfileCurve: wpProfileCurve,
		wpPieceLengths: wpPieceLengths,
		wpGroupWays: wpGroupWays,
		wpGroupFieldStates: wpGroupFieldStates,
		wpGroupChangedFields: wpGroupChangedFields,
		wpGroupTransportDecisions: wpGroupTransportDecisions,
		wpReversePiece: wpReversePiece,
		wpReverseProfile: wpReverseProfile,
		wpChainSegments: wpChainSegments,
		wpChainCurve: wpChainCurve,
		wpRoughMiles: wpRoughMiles
	};
}
