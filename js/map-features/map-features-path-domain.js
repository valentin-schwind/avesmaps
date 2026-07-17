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
