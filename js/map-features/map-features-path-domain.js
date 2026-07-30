// Normalisiert den Pfadnamen
const normalizePathName = (name) => {
	if (typeof name === "string") {
		if (name.startsWith("Reichsstrasse")) return "Reichsstrasse";
		if (name.startsWith("Strasse")) return "Strasse";
		if (name.startsWith("Gebirgspass") || name.startsWith("Gebirgspfad")) return "Gebirgspass";
		if (name.startsWith("Wueste") || name.startsWith("Wuestenpfad") || name.startsWith("Wüstenpfad")) return "Wuestenpfad";
		if (name.startsWith("Pfad")) return "Pfad";
		if (name.startsWith("Flussweg")) return "Flussweg";
		if (name.startsWith("Meer") || name.startsWith("Seeweg")) return "Seeweg";
		if (name.startsWith(SYNTHETIC_ROUTE_TYPE)) return SYNTHETIC_ROUTE_TYPE;
	}
	return "Weg";
};

function normalizePathSubtype(value) {
	const pathSubtype = normalizePathName(value);
	return PATH_SUBTYPE_KEYS.includes(pathSubtype) ? pathSubtype : "Weg";
}

function getPathDisplayName(path) {
	return path?.properties?.display_name || path?.properties?.original_name || path?.properties?.name?.replace(/-\d+$/, "") || "Weg";
}

// Titel eines Wegs, wie ihn ein Mensch lesen soll -- "" wenn der Weg schlicht keinen Namen hat.
//
// Zwei Kanäle, in DIESER Reihenfolge:
//  1. wiki_path.name -- die Weg-Identität. Genau das tut die Spotlight-Suche seit jeher
//     (buildSpotlightPathEntries: "mit dem Wiki-Namen als Anzeige, Altbestaende koennen noch
//     Random-Segmentnamen tragen"), und darum sieht die Suche richtig aus, während die Infobox
//     "Reichsstrasse-16" zeigte: sie war die EINZIGE Stelle, die roh auf display_name griff.
//     Regel R1 (zugewiesen ⇒ kanonischer Name) ist auf 12 Altsegmenten verletzt; über den
//     Wiki-Namen zu gehen heilt die Anzeige, ohne die Daten anzufassen.
//  2. display_name -- aber nur, wenn es ein ECHTER Name ist. shouldShowRoutePathDisplayName
//     (js/routing/route-node.js) ist der erprobte Test dafür und kennt alle Müll-Muster: den
//     nackten Subtyp, "<Subtyp>-<n>" und generisch "<wort>-<zahl>" ("Meer-835").
function getPathTitleName(path) {
	const wikiName = String(path?.properties?.wiki_path?.name || "").trim();
	if (wikiName !== "") {
		return wikiName;
	}
	if (typeof shouldShowRoutePathDisplayName === "function" && !shouldShowRoutePathDisplayName(path)) {
		return "";
	}
	return String(path?.properties?.display_name || path?.properties?.original_name || "").trim();
}

// Wegtyp, ausgeschrieben für Menschen. EIGENER Schlüsselraum `path.type.*`, NICHT `spotlight.pathType.*`:
// der gehört der Trefferliste und vergröbert ABSICHTLICH (getSpotlightPathTypeLabel wirft Reichsstrasse/
// Strasse/Weg/Pfad alle auf "Weg" -- in einer Suchliste richtig, im Untertitel falsch). Die Infobox hatte
// sich dort bedient und zeigte deshalb (Owner 2026-07-17): auf Deutsch "Reichsstrasse" (= der rohe Schlüssel,
// weil Deutsch keine Tabelle hat und der Fallback der Schlüssel selbst ist) und auf Englisch "Path" (= das
// grobe Suchlabel). Beides falsch, nur verschieden.
// Unsere Subtyp-SCHLÜSSEL tragen "ss" (Reichsstrasse/Strasse/Wuestenpfad) -- das sind Join-Keys, keine Prosa.
const PATH_TYPE_LABEL = {
	Reichsstrasse: "Reichsstraße",
	Strasse: "Straße",
	Weg: "Weg",
	Pfad: "Pfad",
	Gebirgspass: "Gebirgspass",
	Wuestenpfad: "Wüstenpfad",
	Flussweg: "Flussweg",
	Seeweg: "Seeweg",
};

function getPathTypeLabel(subtype) {
	const fallback = PATH_TYPE_LABEL[subtype] || String(subtype || "");
	return typeof tr === "function" ? tr("path.type." + subtype, fallback) : fallback;
}

// Titel für einen Weg OHNE Namen (Owner 2026-07-17): "Straße" allein liest sich wie ein Name --
// "Unbenannte Straße" ist erkennbar eine Beschreibung. Ausgeschriebene Strings statt zusammengesetzter,
// weil das Deutsche das Adjektiv beugt: DIE Straße -> "Unbenannte", DER Pfad -> "Unbenannter".
// Seeweg fehlt ABSICHTLICH: das offene Meer trägt von Natur aus keine Namen, "unbenannt" behauptete
// dort einen Mangel. Es fällt (wie Querfeldein) auf den blanken Typ zurück.
const UNNAMED_PATH_TITLE = {
	Reichsstrasse: "Unbenannte Reichsstraße",
	Strasse: "Unbenannte Straße",
	Weg: "Unbenannter Weg",
	Pfad: "Unbenannter Pfad",
	Gebirgspass: "Unbenannter Gebirgspass",
	Wuestenpfad: "Unbenannter Wüstenpfad",
	Flussweg: "Unbenannter Flussweg",
};

function getUnnamedPathTitle(subtype) {
	const key = "path.unnamed." + subtype;
	const fallback = UNNAMED_PATH_TITLE[subtype];
	if (!fallback) {
		// Seeweg/Querfeldein/Unbekanntes: der Typ selbst ist die ehrlichste Bezeichnung.
		return getPathTypeLabel(subtype);
	}
	return typeof tr === "function" ? tr(key, fallback) : fallback;
}

function getNextPathDisplayName(subtype, { excludePath = null } = {}) {
	const normalizedSubtype = normalizePathSubtype(subtype);
	const namePattern = new RegExp(`^${escapeRegExp(normalizedSubtype)}-(\\d+)$`);
	let highestNumber = 0;

	pathData
		.filter((path) => path !== excludePath)
		.map((path) => String(path?.properties?.name || path?.properties?.display_name || "").trim())
		.forEach((pathName) => {
			const match = namePattern.exec(pathName);
			if (!match) {
				return;
			}

			highestNumber = Math.max(highestNumber, Number.parseInt(match[1], 10) || 0);
		});

	return `${normalizedSubtype}-${highestNumber + 1}`;
}

function getPathDisplayNameOrGenerated(name, subtype, { excludePath = null } = {}) {
	const trimmedName = String(name || "").trim();
	if (trimmedName !== "") {
		return trimmedName;
	}

	return getNextPathDisplayName(subtype, { excludePath });
}

function getNextLocalPathId() {
	const highestPathId = pathData.reduce((highestId, path) => {
		const match = /^path-(\d+)$/.exec(String(path?.properties?.id || ""));
		if (!match) {
			return highestId;
		}

		return Math.max(highestId, Number.parseInt(match[1], 10) || 0);
	}, 0);

	return highestPathId + 1;
}

function getPathPublicId(path) {
	return path?.properties?.public_id || path?.id || "";
}

// --- Wegtyp -> Transportmittel -----------------------------------------------------------------
//
// Two DIFFERENT lists, and the difference is the point:
//   getTransportOptionsForPathSubtype         -- what the editor OFFERS (visible, enabled checkbox)
//   getDefaultAllowedTransportsForPathSubtype -- what it PRE-SELECTS (checked)
//
// They coincide for every subtype but two, for opposite reasons:
//   Wuestenpfad -- the carriage is not offered at all, so it can never be stored either
//                  (avesmapsReadAllowedTransports filters it out server-side).
//   Pfad        -- the carriage IS offered but starts unchecked (Owner, 2026-07-30). A carriage
//                  does get through a handful of paths and nobody knows which yet, so the editors
//                  must be able to switch it back on; a hard ban would take that away.
//
// The rule lives here, not in js/review/, because the client route graph needs it too and must not
// depend on the editor cluster. Mirrored server-side in api/_internal/map/features.php (saving) and
// api/_internal/routing/client-graph.php (the primary route graph).
function getDefaultTransportDomainForPathSubtype(pathSubtype) {
	if (pathSubtype === "Flussweg") return "river";
	if (pathSubtype === "Seeweg") return "sea";
	return "land";
}

function getTransportOptionsForPathSubtype(pathSubtype) {
	const normalizedSubtype = normalizePathSubtype(pathSubtype);
	const domain = getDefaultTransportDomainForPathSubtype(normalizedSubtype);
	const options = TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	if (normalizedSubtype === "Wuestenpfad") {
		return options.filter((option) => option !== "horseCarriage");
	}

	return options;
}

function getDefaultAllowedTransportsForPathSubtype(pathSubtype) {
	const offered = getTransportOptionsForPathSubtype(pathSubtype);
	if (normalizePathSubtype(pathSubtype) === "Pfad") {
		return offered.filter((option) => option !== "horseCarriage");
	}

	return offered;
}

// What the client route graph asks per path (route-graph-routing.js). Lives next to the rule it
// applies so both stay in step -- the graph and the editor dialog must never disagree about a way.
function isTransportAllowedForPath(pathProperties, transportOption) {
	if (!transportOption) {
		return false;
	}

	// No separate Wuestenpfad clause any more: resolvePathAllowedTransports filters a stored list
	// down to what the subtype OFFERS, which drops a carriage stored on a desert path by itself.
	return resolvePathAllowedTransports(pathProperties).includes(transportOption);
}

// The one place "a stored list beats the default" is written down on the client, shared by the
// editor dialog (getPathAllowedTransports) and the route graph (isTransportAllowedForPath).
//
// A stored list -- an empty one INCLUDED -- is what the path allows: empty means no transport at
// all gets through, e.g. the upper Raller where no boat passes the source. An empty list WITHOUT a
// stored transport_domain is NOT a decision: the dialog always saves the pair, and a one-off admin
// repair (2026-05-11) wrote [] on 26 Wuestenpfade that had no list yet, where it meant "every land
// transport but the carriage". Those fall back to the default, and saving the path heals the row.
//
// A stored list is filtered down to what the subtype OFFERS, never to what it pre-selects -- that
// is what lets a Pfad keep a carriage an editor ticked while a Wuestenpfad can never keep one.
// Mirrored server-side by avesmapsResolveClientRoutePathAllowedTransports in
// api/_internal/routing/client-graph.php.
function resolvePathAllowedTransports(properties) {
	const subtype = normalizePathSubtype(properties?.feature_subtype || properties?.name);
	const stored = Array.isArray(properties?.allowed_transports) ? properties.allowed_transports : null;
	const hasRestriction = stored !== null
		&& (stored.length > 0 || String(properties?.transport_domain || "").trim() !== "");
	if (!hasRestriction) {
		return getDefaultAllowedTransportsForPathSubtype(subtype);
	}

	const offered = getTransportOptionsForPathSubtype(subtype);
	return stored.filter((option) => offered.includes(option));
}
