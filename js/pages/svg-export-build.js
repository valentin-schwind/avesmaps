// Der reine Bauer des SVG-Exports: Payload rein, Textstücke raus.
//
// 🔴 KEIN DOM, KEIN fetch, KEIN document. Das ist der Vertrag, und er ist der Grund,
// warum diese Datei testbar ist. Der Kitt (svg-export-page.js) holt die Daten und
// reicht sie herein; hier wird nichts geladen.
//
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
"use strict";

const SVGX_VIEWBOX_SIZE = 1024;

const SVGX_DIALECTS = {
	ILLUSTRATOR: "illustrator",
	INKSCAPE: "inkscape",
};

// Die acht Wegarten in der Reihenfolge von PATH_SUBTYPE_KEYS (js/config.js).
// Hier noch einmal aufgeführt, weil dieser Bauer ohne die Karte laufen können muss.
const SVGX_WAY_SUBTYPES = ["Reichsstrasse", "Strasse", "Weg", "Pfad",
	"Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];

// Die Mittellinienfarbe je Wegart. 🔴 ABSCHRIFT aus getPathStyleColors()
// (js/map-features/map-features.js) -- bewusst, nicht aus Versehen: die Karte wird für
// dieses Werkzeug nicht angefasst (Owner 14.08.2026, revert 07bb4b37).
// ⚠️ Ändert jemand dort eine Farbe, folgt der Export ihr NICHT. Wer das bemerkt, gleicht
// hier von Hand ab -- und hebt nicht etwa die Tabelle drüben heraus.
const SVGX_WAY_COLORS = {
	Reichsstrasse: "#ffffff",
	Strasse: "#8b8b8b",
	Weg: "#cec4ae",
	Pfad: "#9b755a",
	Gebirgspass: "#a8695c",
	Wuestenpfad: "#bea470",
	Flussweg: "#6ec6ff",
	Seeweg: "#2f7dd3",
};

// Strichstärken für 1024 Einheiten Kantenlänge. Die echten Stärken der Karte kommen aus
// der Zoomstufe, und eine Vektordatei hat keine -- also ein fester Satz, an EINER Stelle.
const SVGX_WAY_WIDTHS = {
	Reichsstrasse: 0.9, Strasse: 0.7, Weg: 0.5, Pfad: 0.4,
	Gebirgspass: 0.5, Wuestenpfad: 0.5, Flussweg: 0.6, Seeweg: 0.5,
};

// Ortsarten in Katalogreihenfolge, mit Punktgröße. Der Kitt darf eine gemessene Liste
// hereinreichen; ohne sie gilt diese.
const SVGX_PLACE_KINDS = [
	{ slug: "metropole", label: "Metropole", r: 2.2 },
	{ slug: "grossstadt", label: "Großstadt", r: 1.7 },
	{ slug: "stadt", label: "Stadt", r: 1.3 },
	{ slug: "kleinstadt", label: "Kleinstadt", r: 1.0 },
	{ slug: "dorf", label: "Dorf", r: 0.7 },
	{ slug: "gebaeude", label: "Gebäude", r: 0.6 },
];

// 💣 GeoJSON speichert [x, y]; Leaflets L.CRS.Simple rechnet [lat, lng] = [y, x] und lässt
// lat NACH OBEN wachsen (deshalb tragen die Kacheldateien negative y). SVG lässt y nach
// UNTEN wachsen. Ohne diese Spiegelung steht die ganze Karte auf dem Kopf -- und das sieht
// man einer großen Datei nicht an, bevor sie in einem Programm offen ist.
// Zwei Nachkommastellen: bei 1024 Einheiten Kantenlänge ein Hundertstel Bildpunkt.
function svgxPoint(x, y) {
	return {
		x: Math.round(Number(x) * 100) / 100,
		y: Math.round((SVGX_VIEWBOX_SIZE - Number(y)) * 100) / 100,
	};
}

function svgxEscapeText(text) {
	return String(text == null ? "" : text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// 💣 DIESE FALTUNG IST NICHT DIE wiki_key-FALTUNG. avesmapsFoldToAscii()
// (api/_internal/text/ascii-fold.php) bildet den Server nach -- dort verlieren Umlaute
// ihren Grundbuchstaben ('Fürstentum Kosch' -> 'f-rstentum-kosch'), und sie darf laut
// AGENTS.md §5 nie "schöner" gemacht werden, weil jede Änderung eine Datenmigration über
// ~10 Tabellen ist. HIER entsteht ein neuer, eigener Namensraum: er joint nirgends und
// wird nie in eine Zeile geschrieben. Also normal falten.
const SVGX_FOLD = {
	"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss",
	"á": "a", "à": "a", "â": "a", "é": "e", "è": "e", "ê": "e",
	"í": "i", "ì": "i", "î": "i", "ó": "o", "ò": "o", "ô": "o",
	"ú": "u", "ù": "u", "û": "u", "ç": "c", "ñ": "n",
};

function svgxFoldAscii(text) {
	return String(text == null ? "" : text)
		// Alles AUSSERHALB des druckbaren ASCII durch die Tabelle; was dort fehlt, wird ein
		// Bindestrich. ⚠️ Nicht als /[^ -]/ schreiben -- das wäre die Klasse "weder
		// Leerzeichen noch Bindestrich" und schickte jeden Buchstaben durch die Faltung.
		.replace(/[^\x20-\x7E]/g, (ch) => (SVGX_FOLD[ch] !== undefined ? SVGX_FOLD[ch] : "-"))
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

// Illustrators eigene Maskierung: was in einem XML-Namen nicht erlaubt ist, wird _xHH_.
// ⚠️ Ob Illustrator das beim Import zurückverwandelt, ist noch NICHT gemessen (Sonde offen).
function svgxAdobeEscape(text) {
	return String(text == null ? "" : text).replace(/[^A-Za-z0-9À-ɏ_-]/g, (ch) => {
		const hex = ch.codePointAt(0).toString(16).toUpperCase();
		return `_x${hex}_`;
	});
}

// 🔴 DIE EINZIGE STELLE, AN DER EINE id ENTSTEHT. Die Beschriftungsebene ruft dieselbe
// Funktion für ihren <textPath href> -- ein zweiter Zusammenbau des Namens würde jeden
// Verweis ins Leere zeigen lassen und die ganze Beschriftungsebene unsichtbar machen,
// in einer Datei, die sonst tadellos aussieht.
function svgxIdFor(name, publicId, dialect, seen) {
	const kennung = String(publicId == null ? "" : publicId);
	let id = dialect === SVGX_DIALECTS.ILLUSTRATOR
		? svgxAdobeEscape(name)
		: [svgxFoldAscii(name), svgxFoldAscii(kennung)].filter(Boolean).join("-");

	if (!id) { id = "objekt"; }
	if (/^[^A-Za-z_]/.test(id)) { id = `x${id}`; }  // XML: ein Name beginnt nie mit einer Ziffer

	if (seen && seen.has(id)) {
		const trenner = dialect === SVGX_DIALECTS.ILLUSTRATOR ? "_x20_" : "-";
		const basis = kennung ? `${id}${trenner}${svgxFoldAscii(kennung)}` : id;
		id = basis;
		let n = 2;
		while (seen.has(id)) { id = `${basis}-${n}`; n += 1; }
	}
	if (seen) { seen.add(id); }
	return id;
}

function svgxAttrs(attrs) {
	return Object.entries(attrs || {})
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => ` ${k}="${svgxEscapeText(v)}"`)
		.join("");
}

function svgxLabelAttr(name, dialect) {
	return dialect === SVGX_DIALECTS.INKSCAPE
		? ` inkscape:label="${svgxEscapeText(name)}"`
		: "";
}

function svgxGroupOpen(options) {
	const o = options || {};
	return `<g id="${svgxEscapeText(o.id)}"${svgxLabelAttr(o.name, o.dialect)}${svgxAttrs(o.attrs)}>\n`;
}

function svgxLayerOpen(options) {
	const o = options || {};
	const modus = o.dialect === SVGX_DIALECTS.INKSCAPE ? ' inkscape:groupmode="layer"' : "";
	return `<g id="${svgxEscapeText(o.id)}"${modus}${svgxLabelAttr(o.name, o.dialect)}${svgxAttrs(o.attrs)}>\n`;
}

function svgxGroupClose() {
	return "</g>\n";
}

function svgxDocumentOpen(dialect) {
	const inkscapeNs = dialect === SVGX_DIALECTS.INKSCAPE
		? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
		: "";
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<svg xmlns="http://www.w3.org/2000/svg"'
		+ ' xmlns:xlink="http://www.w3.org/1999/xlink"'
		+ inkscapeNs
		+ ` viewBox="0 0 ${SVGX_VIEWBOX_SIZE} ${SVGX_VIEWBOX_SIZE}"`
		+ ` width="${SVGX_VIEWBOX_SIZE}" height="${SVGX_VIEWBOX_SIZE}">\n`
		// Die Lizenz reist mit: eine SVG geht nach draußen und muss ohne die Website
		// erklären können, woher sie kommt und was erlaubt ist (wie fb763021).
		+ "<metadata>\n"
		+ "  Avesmaps — https://avesmaps.de\n"
		+ "  Nicht-kommerzielles Fanprojekt zu Das Schwarze Auge / Aventurien.\n"
		+ "  Lizenz und Hinweise: https://avesmaps.de/NOTICE.md\n"
		+ "</metadata>\n";
}

function svgxDocumentClose() {
	return "</svg>\n";
}

// ---------------------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------------------

function svgxPathData(coordinates) {
	const punkte = (coordinates || []).map(([x, y]) => svgxPoint(x, y));
	if (punkte.length === 0) { return ""; }
	return punkte.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("");
}

function svgxRingData(ring) {
	const d = svgxPathData(ring);
	return d ? `${d}Z` : "";
}

// 💣 coordinates[0] ist der Außenring, JEDER WEITERE Eintrag ist ein LOCH. Wer nur den
// ersten zeichnet, füllt Binnenseen zu -- und die Karte sieht dabei richtig aus.
// fill-rule="evenodd" an der Gruppe macht aus dem zweiten Ring das Loch.
function svgxPolygonData(geometry) {
	const typ = geometry && geometry.type;
	const coords = (geometry && geometry.coordinates) || [];
	const polygone = typ === "MultiPolygon" ? coords : (typ === "Polygon" ? [coords] : []);
	return polygone
		.map((polygon) => (polygon || []).map(svgxRingData).filter(Boolean).join(""))
		.filter(Boolean)
		.join("");
}

// Die Endpunkte kommen aus verschiedenen Zeitaltern dieses Projekts und verpacken ihre
// Features verschieden. Statt zu raten, welcher gerade welche Hülle benutzt, packen wir
// tolerant aus -- und die Seite meldet die gefundene Anzahl, damit eine leere Ebene
// sichtbar wird statt still zu bleiben.
function svgxAsFeatures(payload) {
	if (!payload) { return []; }
	if (Array.isArray(payload)) { return payload; }
	const kandidaten = [payload.features, payload.areas, payload.territories, payload.items,
		payload.data && payload.data.features, payload.data];
	for (const k of kandidaten) {
		if (Array.isArray(k)) { return k; }
	}
	return [];
}

// ---------------------------------------------------------------------------------------
// Die Ebenen
// ---------------------------------------------------------------------------------------

function svgxWayLayer(options) {
	const o = options || {};
	const nachArt = new Map();
	svgxAsFeatures(o.features).forEach((f) => {
		if (!f || !f.geometry || f.geometry.type !== "LineString") { return; }
		if (f.properties && f.properties.feature_type === "powerline") { return; }
		const art = (f.properties && f.properties.feature_subtype) || "Weg";
		if (!nachArt.has(art)) { nachArt.set(art, []); }
		nachArt.get(art).push(f);
	});

	const stuecke = [svgxLayerOpen({ name: "Wege", id: "layer-wege", dialect: o.dialect })];
	let anzahl = 0;
	const arten = SVGX_WAY_SUBTYPES.concat([...nachArt.keys()].filter((a) => !SVGX_WAY_SUBTYPES.includes(a)));
	arten.forEach((art) => {
		const wege = nachArt.get(art);
		// Eine leere Untergruppe wird gar nicht geschrieben: leere Ordner im Ebenenfenster
		// lesen sich wie ein Fehler, obwohl nur nichts da war.
		if (!wege || wege.length === 0) { return; }
		stuecke.push(svgxGroupOpen({
			name: art, id: `wege-${svgxFoldAscii(art).toLowerCase()}`, dialect: o.dialect,
			attrs: {
				fill: "none",
				stroke: SVGX_WAY_COLORS[art] || "#888888",
				"stroke-width": String(SVGX_WAY_WIDTHS[art] || 0.5),
				"stroke-linejoin": "round",
				"stroke-linecap": "round",
			},
		}));
		wege.forEach((f) => {
			const name = (f.properties && f.properties.name) || art;
			const id = svgxIdFor(name, f.properties && f.properties.public_id, o.dialect, o.seen);
			if (o.wayIds && f.properties && f.properties.public_id) {
				o.wayIds.set(f.properties.public_id, id);
			}
			stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
				+ ` d="${svgxPathData(f.geometry.coordinates)}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
			anzahl += 1;
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl };
}

function svgxPowerlineLayer(options) {
	const o = options || {};
	const linien = svgxAsFeatures(o.features).filter(
		(f) => f && f.properties && f.properties.feature_type === "powerline"
			&& f.geometry && f.geometry.type === "LineString");
	const stuecke = [svgxLayerOpen({
		name: "Kraftlinien", id: "layer-kraftlinien", dialect: o.dialect,
		attrs: { fill: "none", stroke: "#7a5ea8", "stroke-width": "0.5", "stroke-linejoin": "round" },
	})];
	linien.forEach((f) => {
		const name = f.properties.name || "Kraftlinie";
		const id = svgxIdFor(name, f.properties.public_id, o.dialect, o.seen);
		stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
			+ ` d="${svgxPathData(f.geometry.coordinates)}">`
			+ `<title>${svgxEscapeText(name)}</title></path>\n`);
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: linien.length };
}

function svgxAreaLayer(options) {
	const o = options || {};
	const gruppen = new Map();
	svgxAsFeatures(o.features).forEach((f) => {
		if (!f || !f.geometry) { return; }
		if (typeof o.accept === "function" && !o.accept(f)) { return; }
		const schluessel = (typeof o.groupBy === "function" ? o.groupBy(f) : "") || "";
		if (!gruppen.has(schluessel)) { gruppen.set(schluessel, []); }
		gruppen.get(schluessel).push(f);
	});

	const stuecke = [svgxLayerOpen({ name: o.layerName, id: o.layerId, dialect: o.dialect })];
	let anzahl = 0;
	gruppen.forEach((flaechen, schluessel) => {
		stuecke.push(svgxGroupOpen({
			name: schluessel || o.layerName,
			id: `${o.layerId}-${svgxFoldAscii(schluessel).toLowerCase() || "ohne"}`,
			dialect: o.dialect,
			attrs: {
				fill: (o.colors && o.colors[schluessel]) || o.defaultFill || "none",
				"fill-rule": "evenodd",
				stroke: o.stroke || "none",
				"stroke-width": o.stroke ? "0.4" : "",
				"fill-opacity": o.fillOpacity || "",
			},
		}));
		flaechen.forEach((f) => {
			const d = svgxPolygonData(f.geometry);
			if (!d) { return; }
			const name = (f.properties && f.properties.name) || schluessel || o.layerName;
			const id = svgxIdFor(name, f.properties && f.properties.public_id, o.dialect, o.seen);
			stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)} d="${d}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
			anzahl += 1;
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl };
}

function svgxPlaceLayer(options) {
	const o = options || {};
	const kinds = (o.kinds && o.kinds.length ? o.kinds : SVGX_PLACE_KINDS);
	const nachArt = new Map();
	svgxAsFeatures(o.features).forEach((f) => {
		// 💣 Der Filter ist zweifach: feature_type UND geometry.type. Eine Kreuzung ist auch
		// ein Point -- Geometrie entscheidet die FORM, feature_type die ART (Discord #48).
		if (!f || !f.properties || f.properties.feature_type !== "location") { return; }
		if (!f.geometry || f.geometry.type !== "Point") { return; }
		const art = f.properties.feature_subtype || "";
		if (!nachArt.has(art)) { nachArt.set(art, []); }
		nachArt.get(art).push(f);
	});

	const stuecke = [svgxLayerOpen({ name: "Orte", id: "layer-orte", dialect: o.dialect })];
	let anzahl = 0;
	const arten = kinds.map((k) => k.slug)
		.concat([...nachArt.keys()].filter((a) => !kinds.some((k) => k.slug === a)));
	arten.forEach((slug) => {
		const orte = nachArt.get(slug);
		if (!orte || orte.length === 0) { return; }
		const kind = kinds.find((k) => k.slug === slug) || { slug: slug, label: slug || "Ort", r: 0.8 };
		stuecke.push(svgxGroupOpen({
			name: kind.label || slug, id: `orte-${svgxFoldAscii(slug).toLowerCase() || "ohne"}`,
			dialect: o.dialect, attrs: { fill: o.color || "#3b2a18", stroke: "none" },
		}));
		orte.forEach((f) => {
			const p = svgxPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
			const name = f.properties.name || kind.label || slug;
			const id = svgxIdFor(name, f.properties.public_id, o.dialect, o.seen);
			stuecke.push(`<circle id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
				+ ` cx="${p.x}" cy="${p.y}" r="${kind.r || 0.8}">`
				+ `<title>${svgxEscapeText(name)}</title></circle>\n`);
			anzahl += 1;
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl };
}

function svgxLabelLayer(options) {
	const o = options || {};
	const alle = svgxAsFeatures(o.features);
	const stuecke = [svgxLayerOpen({
		name: "Beschriftungen", id: "layer-beschriftungen", dialect: o.dialect,
		attrs: { "font-family": o.fontFamily || "Georgia, serif", fill: o.color || "#3b2a18" },
	})];
	let anzahl = 0;

	// --- Ortsnamen ---
	stuecke.push(svgxGroupOpen({
		name: "Orte", id: "beschriftung-orte", dialect: o.dialect,
		attrs: { "font-size": "1.6", "text-anchor": "middle" },
	}));
	alle.forEach((f) => {
		if (!f || !f.properties || f.properties.feature_type !== "location") { return; }
		if (!f.geometry || f.geometry.type !== "Point" || !f.properties.name) { return; }
		const p = svgxPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
		const name = f.properties.name;
		const id = svgxIdFor(`${name}-Beschriftung`, f.properties.public_id, o.dialect, o.seen);
		stuecke.push(`<text id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
			+ ` x="${p.x}" y="${p.y + 2.6}">${svgxEscapeText(name)}</text>\n`);
		anzahl += 1;
	});
	stuecke.push(svgxGroupClose());

	// --- Wegnamen entlang der Linie ---
	stuecke.push(svgxGroupOpen({
		name: "Wege", id: "beschriftung-wege", dialect: o.dialect, attrs: { "font-size": "1.3" },
	}));
	alle.forEach((f) => {
		if (!f || !f.geometry || f.geometry.type !== "LineString" || !f.properties) { return; }
		if (!f.properties.name) { return; }
		// 🔴 DIE KOPPLUNG. Die id wird NICHT neu gebaut, sondern aus der Merkliste gelesen,
		// die svgxWayLayer gefüllt hat. Ein selbst zusammengesetzter Name wäre ein href ins
		// Leere -- und diese ganze Gruppe bliebe unsichtbar.
		const wegId = o.wayIds && o.wayIds.get(f.properties.public_id);
		if (!wegId) { return; }
		const name = f.properties.name;
		const id = svgxIdFor(`${name}-Wegbeschriftung`, f.properties.public_id, o.dialect, o.seen);
		stuecke.push(`<text id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}>`
			+ `<textPath href="#${svgxEscapeText(wegId)}" startOffset="50%">`
			+ `${svgxEscapeText(name)}</textPath></text>\n`);
		anzahl += 1;
	});
	stuecke.push(svgxGroupClose());

	// --- freie Beschriftungen (Regionen, Gebiete) aus den label-Features ---
	stuecke.push(svgxGroupOpen({
		name: "Gebiete", id: "beschriftung-gebiete", dialect: o.dialect,
		attrs: { "font-size": "2.2", "text-anchor": "middle" },
	}));
	alle.forEach((f) => {
		if (!f || !f.properties || f.properties.feature_type !== "label") { return; }
		if (!f.geometry || f.geometry.type !== "Point") { return; }
		const text = f.properties.name || f.properties.text || "";
		if (!text) { return; }
		const p = svgxPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
		const id = svgxIdFor(`${text}-Gebietsname`, f.properties.public_id, o.dialect, o.seen);
		stuecke.push(`<text id="${svgxEscapeText(id)}"${svgxLabelAttr(text, o.dialect)}`
			+ ` x="${p.x}" y="${p.y}">${svgxEscapeText(text)}</text>\n`);
		anzahl += 1;
	});
	stuecke.push(svgxGroupClose());

	stuecke.push(svgxGroupClose());   // <- schließt die EBENE, nicht eine Untergruppe
	return { parts: stuecke, count: anzahl };
}

// ---------------------------------------------------------------------------------------
// Der ganze Dokumentbau. Gibt Textstücke UND ein Zählwerk zurück -- das Zählwerk ist die
// Selbstauskunft der Seite: eine Ebene mit 0 Objekten sieht man dort sofort, statt sie
// erst im Grafikprogramm zu vermissen.
// ---------------------------------------------------------------------------------------

function svgxBuildDocument(options) {
	const o = options || {};
	const dialect = o.dialect || SVGX_DIALECTS.INKSCAPE;
	const an = o.layers || {};
	const seen = new Set();
	const wayIds = new Map();
	const parts = [svgxDocumentOpen(dialect)];
	const stats = {};

	const nimm = (name, ergebnis) => {
		stats[name] = ergebnis.count;
		ergebnis.parts.forEach((p) => parts.push(p));
	};

	// Reihenfolge = Zeichenreihenfolge. In SVG liegt das Erste unten.
	if (an.landschaften !== false) {
		nimm("Landschaften", svgxAreaLayer({
			features: o.ecosystems, layerName: "Landschaften", layerId: "layer-landschaften",
			groupBy: (f) => (f.properties && (f.properties.region_type || f.properties.kind)) || "flaeche",
			defaultFill: "#dfd6bd", fillOpacity: "0.85", dialect: dialect, seen: seen,
		}));
	}
	if (an.regionen !== false) {
		nimm("Regionen", svgxAreaLayer({
			features: o.mapFeatures, layerName: "Regionen", layerId: "layer-regionen",
			accept: (f) => f.properties && f.properties.feature_type === "region",
			groupBy: () => "Region", defaultFill: "none", stroke: "#9a8a6a",
			dialect: dialect, seen: seen,
		}));
	}
	if (an.gebiete !== false) {
		nimm("Herrschaftsgebiete", svgxAreaLayer({
			features: o.territories, layerName: "Herrschaftsgebiete", layerId: "layer-gebiete",
			groupBy: (f) => (f.properties && (f.properties.rank || f.properties.type)) || "Gebiet",
			defaultFill: "none", stroke: "#8a6a3f", dialect: dialect, seen: seen,
		}));
	}
	if (an.wege !== false) {
		nimm("Wege", svgxWayLayer({ features: o.mapFeatures, dialect: dialect, seen: seen, wayIds: wayIds }));
	}
	if (an.kraftlinien !== false) {
		nimm("Kraftlinien", svgxPowerlineLayer({ features: o.mapFeatures, dialect: dialect, seen: seen }));
	}
	if (an.orte !== false) {
		nimm("Orte", svgxPlaceLayer({ features: o.mapFeatures, kinds: o.placeKinds, dialect: dialect, seen: seen }));
	}
	if (an.beschriftungen !== false) {
		nimm("Beschriftungen", svgxLabelLayer({
			features: o.mapFeatures, wayIds: wayIds, dialect: dialect, seen: seen,
		}));
	}

	parts.push(svgxDocumentClose());
	return { parts: parts, stats: stats };
}

// Browserseite: EIN benannter Zugang für den Kitt. Die flachen Funktionen bleiben
// zusätzlich global (Projektstandard ohne Build), aber der Kitt greift über diesen
// Namen zu, damit man in einer Datei sieht, was die öffentliche Fläche ist.
if (typeof window !== "undefined") {
	window.AvesmapsSvgExport = {
		build: svgxBuildDocument,
		asFeatures: svgxAsFeatures,
		DIALECTS: SVGX_DIALECTS,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SVGX_VIEWBOX_SIZE: SVGX_VIEWBOX_SIZE,
		SVGX_DIALECTS: SVGX_DIALECTS,
		SVGX_WAY_SUBTYPES: SVGX_WAY_SUBTYPES,
		SVGX_WAY_COLORS: SVGX_WAY_COLORS,
		SVGX_PLACE_KINDS: SVGX_PLACE_KINDS,
		svgxPoint: svgxPoint,
		svgxEscapeText: svgxEscapeText,
		svgxFoldAscii: svgxFoldAscii,
		svgxIdFor: svgxIdFor,
		svgxGroupOpen: svgxGroupOpen,
		svgxLayerOpen: svgxLayerOpen,
		svgxGroupClose: svgxGroupClose,
		svgxDocumentOpen: svgxDocumentOpen,
		svgxDocumentClose: svgxDocumentClose,
		svgxPathData: svgxPathData,
		svgxPolygonData: svgxPolygonData,
		svgxAsFeatures: svgxAsFeatures,
		svgxWayLayer: svgxWayLayer,
		svgxPowerlineLayer: svgxPowerlineLayer,
		svgxAreaLayer: svgxAreaLayer,
		svgxPlaceLayer: svgxPlaceLayer,
		svgxLabelLayer: svgxLabelLayer,
		svgxBuildDocument: svgxBuildDocument,
	};
}
