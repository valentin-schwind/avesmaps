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

// 🔴 Strichstärken, HERGELEITET statt geschätzt (15.08.2026, nachdem der erste Satz 7,2×
// zu dick war und der Owner es sah).
//
// Die Rechnung: die Karte zieht ihre Wege mit PATH_CENTER_WEIGHTS (js/config.js) in
// BILDPUNKTEN bei voller Zoomstufe -- Reichsstrasse 4, Strasse/Weg 2,5, Pfad/Gebirgspass/
// Wuestenpfad 1,5, Flussweg/Seeweg 3. Volle Zoomstufe ist 1024 × 2⁵ = 32.768 px, also genau
// die Standardgröße dieses Exports. Ein Bildpunkt dort ist damit 1/32 Einheit hier:
//
//     Einheit = PATH_CENTER_WEIGHTS[art] / 32
//
// ⚠️ Die 32 sind SVGX_DEFAULT_SIZE_PX / SVGX_VIEWBOX_SIZE und nichts anderes. Wer die
// Standardgröße ändert, ändert damit auch, worauf sich diese Zahlen beziehen -- die
// Strichstärke bleibt in Einheiten, skaliert also mit, aber der VERGLEICH mit der Karte
// gilt dann für die neue Größe.
const SVGX_WAY_WIDTHS = {
	Reichsstrasse: 0.125,   // 4    px
	Strasse: 0.078,         // 2,5  px
	Weg: 0.078,             // 2,5  px
	Pfad: 0.047,            // 1,5  px
	Gebirgspass: 0.047,     // 1,5  px
	Wuestenpfad: 0.047,     // 1,5  px
	Flussweg: 0.094,        // 3    px
	Seeweg: 0.094,          // 3    px
};

// Konturbreiten, nach derselben Rechnung aus PATH_OUTLINE_WEIGHTS (js/config.js):
// Reichsstrasse 6,5 px, Strasse/Weg 4, Pfad/Gebirgspass/Wuestenpfad 3, Fluss-/Seeweg 5.
// ⚠️ Eine Kontur wird nur gezeichnet, wenn für ihre Wegart eine FARBE gesetzt ist. Ohne
// Farbe keine Kontur -- sonst verdoppelt sich stillschweigend die Zahl der Pfade.
const SVGX_WAY_OUTLINE_WIDTHS = {
	Reichsstrasse: 0.203, Strasse: 0.125, Weg: 0.125, Pfad: 0.094,
	Gebirgspass: 0.094, Wuestenpfad: 0.094, Flussweg: 0.156, Seeweg: 0.156,
};

// Die Ortsfarbe: der Ton der Kartenmarkierung (--color-marker-waypoint in tokens.css).
const SVGX_PLACE_COLOR = "#e33b35";

const SVGX_POWERLINE_WIDTH = 0.078;   // wie eine Straße

// Gebietsgrenzen. Die Karte staffelt sie nach Hierarchiestufe (map-features-boundary-style.js:
// Reich 4 px, 2. Ebene 3, Grafschaft 2, tiefer 1) -- aber der Payload liefert alle 166 Gebiete
// mit demselben `type` und OHNE Stufe. Eine Stärke muss also reichen, und das ist die mittlere.
// ⚠️ Stand hier bis 15.08.2026 als 0,4 = 12,8 px, viermal zu dick; derselbe Schätzfehler wie
// bei den Wegen, nur eine Zeile weiter unten und deshalb beim ersten Mal übersehen.
const SVGX_BOUNDARY_WIDTH = 0.094;    // 3 px

// Der Regler auf der Seite: 100 % = die Stärken oben, also der Kartenzustand.
function svgxStrokeScale(scale) {
	const wert = Number(scale);
	return Number.isFinite(wert) && wert > 0 ? wert : 1;
}

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

// 🔴 PASSMARKEN -- gegen das Photoshop-Problem, und es ist ein echtes.
//
// Photoshop beschneidet eine rasterisierte Ebene auf ihren INHALT. Sobald man die Ebenen
// einzeln rastert, hat jede eine andere Ausdehnung, und danach weiß niemand mehr, wo die
// Flüsse hingehören: der Bezug zur Leinwand ist weg. (Owner 15.08.2026.)
//
// Vier deckende Quadrate, exakt in den vier Ecken der Leinwand, in JEDER Ebene. Damit
// misst jede rasterisierte Ebene genau 32768 × 32768 und fällt bei 0,0 an ihren Platz.
//
// 💣 DECKEND, nicht halbdurchsichtig. Der naheliegende Gedanke ist ein Alpha von 1/255 --
// aber beim Rastern kann das Antialiasing es auf 0 runden, und dann ist die Marke fort,
// ohne dass es jemand bemerkt, bis die Ebene falsch sitzt. Eine Marke, die manchmal
// verschwindet, ist schlimmer als keine.
//
// 💣 VIER, nicht zwei. Zwei gegenüberliegende Ecken legen die Ausdehnung fest -- vier
// verraten zusätzlich, ob eine Ebene gespiegelt hereinkam, und kosten nichts.
//
// ⚠️ Sie liegen in einer eigenen Untergruppe „Passmarken" je Ebene, damit man sie nach dem
// Ausrichten in einem Rutsch löscht. Magenta, weil die Farbe auf dieser Karte sonst nirgends
// vorkommt und sich damit per „Ähnliche auswählen" in einem Griff erwischen lässt.
const SVGX_REGMARK_COLOR = "#ff00ff";

function svgxRegistrationMarks(dialect, sizePx) {
	// Kantenlänge = 1 Bildpunkt bei der gewählten Ausgabegröße. Kleiner wäre nicht mehr
	// zuverlässig, größer unnötig auffällig.
	const groesse = SVGX_VIEWBOX_SIZE / Math.max(1, Number(sizePx) || SVGX_DEFAULT_SIZE_PX);
	const k = SVGX_VIEWBOX_SIZE - groesse;
	const ecken = [[0, 0], [k, 0], [0, k], [k, k]];
	const stuecke = [svgxGroupOpen({
		name: "Passmarken", id: "passmarken", dialect: dialect,
		attrs: { fill: SVGX_REGMARK_COLOR, stroke: "none" },
	})];
	ecken.forEach(([x, y], i) => {
		stuecke.push(`<rect id="passmarke-${i + 1}" x="${svgxRund(x)}" y="${svgxRund(y)}"`
			+ ` width="${groesse}" height="${groesse}"/>\n`);
	});
	stuecke.push(svgxGroupClose());
	return stuecke;
}

// Die Ausgabegröße in Bildpunkten. 32768 ist der Standard -- bei 1024 Einheiten Kantenlänge
// sind das 32 Punkte je Einheit, genug für großen Druck.
const SVGX_DEFAULT_SIZE_PX = 32768;

// 💣 Die GRÖSSE steht in width/height, der Zeichenraum bleibt IMMER 0…1024 im viewBox.
// Nur so skaliert alles mit: Koordinaten, Strichstärken, Schriftgrößen. Wer stattdessen die
// Koordinaten multiplizierte, müsste jede Strichstärke und jede Schrift einzeln mitrechnen --
// und ein Vergessener fiele erst im Druck auf.
function svgxDocumentOpen(dialect, sizePx) {
	const groesse = Math.max(1, Math.round(Number(sizePx) || SVGX_DEFAULT_SIZE_PX));
	const inkscapeNs = dialect === SVGX_DIALECTS.INKSCAPE
		? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
		: "";
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<svg xmlns="http://www.w3.org/2000/svg"'
		+ ' xmlns:xlink="http://www.w3.org/1999/xlink"'
		+ inkscapeNs
		+ ` viewBox="0 0 ${SVGX_VIEWBOX_SIZE} ${SVGX_VIEWBOX_SIZE}"`
		+ ` width="${groesse}" height="${groesse}">\n`
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

// Die Spannung der Kurve. 0,5 ist AVESMAPS_CATMULL_DEFAULTS.tension aus
// js/map-features/map-features-line-catmull.js -- dem EINEN Catmull-Rom des Projekts.
// Hier steht die Zahl, nicht das Modul, weil dieser Bauer nichts lädt; der Test
// (svg-export-build.test.js) lädt beide und beweist, dass die Kurven identisch sind.
const SVGX_CATMULL_TENSION = 0.5;

function svgxRund(n) {
	return Math.round(Number(n) * 100) / 100;
}

// 🔴 CATMULL-ROM ALS BÉZIER, nicht als Punktwolke.
//
// SVG kennt keinen Catmull-Rom-Befehl -- aber ein Catmull-Rom-Segment IST eine kubische
// Bézierkurve, exakt, ohne Näherung. Die Karte tastet die Kurve mit 8 Punkten je Segment ab
// (getCatmullRomSplineCoordinates); dieselbe Kurve als `C` zu schreiben ist nicht nur achtmal
// kürzer, sondern auch GENAUER -- und in einem Grafikprogramm bekommt man eine echte Kurve mit
// Anfassern statt eines Polygonzugs aus 47.000 Stützpunkten.
//
// Die Umrechnung (Hermite -> Bézier), mit der Tangente, die das Modul benutzt
// (m = (nächster − vorheriger) × Spannung):
//     C1 = P1 + m1/3      C2 = P2 − m2/3
//
// ⚠️ Der erste und der letzte Punkt behalten ihren Nachbarn als eigenen Nachbarn -- genau wie
// im Modul (Math.max(0, i-1) / Math.min(len-1, i+2)). Sonst wandern die Endpunkte.
function svgxSmoothPathData(punkte, tension) {
	if (punkte.length < 2) { return ""; }
	const s = Number.isFinite(Number(tension)) ? Number(tension) : SVGX_CATMULL_TENSION;
	const at = (i) => punkte[Math.max(0, Math.min(punkte.length - 1, i))];
	const stuecke = [`M${punkte[0].x} ${punkte[0].y}`];

	for (let i = 0; i < punkte.length - 1; i += 1) {
		const p0 = at(i - 1);
		const p1 = punkte[i];
		const p2 = punkte[i + 1];
		const p3 = at(i + 2);
		const c1x = p1.x + ((p2.x - p0.x) * s) / 3;
		const c1y = p1.y + ((p2.y - p0.y) * s) / 3;
		const c2x = p2.x - ((p3.x - p1.x) * s) / 3;
		const c2y = p2.y - ((p3.y - p1.y) * s) / 3;
		stuecke.push(`C${svgxRund(c1x)} ${svgxRund(c1y)} ${svgxRund(c2x)} ${svgxRund(c2y)} ${p2.x} ${p2.y}`);
	}
	return stuecke.join("");
}

function svgxPathData(coordinates, options) {
	const o = options || {};
	const punkte = (coordinates || []).map(([x, y]) => svgxPoint(x, y));
	if (punkte.length === 0) { return ""; }
	if (o.smooth && punkte.length >= 2) {
		return svgxSmoothPathData(punkte, o.tension);
	}
	return punkte.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join("");
}

// 🔴 EIN RING IST GESCHLOSSEN, und deshalb ist er NICHT einfach eine geglättete Linie.
//
// Bei einer offenen Linie ist der Nachbar des ersten Punktes er selbst (so macht es auch
// das Catmull-Rom der Karte). Bei einem Ring ist der Nachbar des ersten Punktes der
// LETZTE -- rechnet man hier mit der offenen Regel, bekommt die Fläche an ihrem
// Startpunkt eine Ecke, und zwar an einer beliebigen Stelle des Umrisses, weil der
// Startpunkt willkürlich ist. Genau daran erkennt man geglättete Flächen, die jemand
// wie Linien behandelt hat.
//
// GeoJSON-Ringe wiederholen den ersten Punkt am Ende; der wird vorher entfernt, sonst
// entsteht dort ein Nullsegment und mit ihm eine Delle.
function svgxSmoothRingData(punkte, tension) {
	let p = punkte;
	if (p.length > 1) {
		const a = p[0];
		const z = p[p.length - 1];
		if (a.x === z.x && a.y === z.y) { p = p.slice(0, -1); }
	}
	if (p.length < 3) { return ""; }
	const s = Number.isFinite(Number(tension)) ? Number(tension) : SVGX_CATMULL_TENSION;
	const um = (i) => p[((i % p.length) + p.length) % p.length];   // umlaufend, kein Rand
	const stuecke = [`M${p[0].x} ${p[0].y}`];

	for (let i = 0; i < p.length; i += 1) {
		const p0 = um(i - 1), p1 = um(i), p2 = um(i + 1), p3 = um(i + 2);
		const c1x = p1.x + ((p2.x - p0.x) * s) / 3;
		const c1y = p1.y + ((p2.y - p0.y) * s) / 3;
		const c2x = p2.x - ((p3.x - p1.x) * s) / 3;
		const c2y = p2.y - ((p3.y - p1.y) * s) / 3;
		stuecke.push(`C${svgxRund(c1x)} ${svgxRund(c1y)} ${svgxRund(c2x)} ${svgxRund(c2y)} ${p2.x} ${p2.y}`);
	}
	return `${stuecke.join("")}Z`;
}

function svgxRingData(ring, options) {
	const o = options || {};
	if (o.smooth) {
		const punkte = (ring || []).map(([x, y]) => svgxPoint(x, y));
		const d = svgxSmoothRingData(punkte, o.tension);
		if (d) { return d; }
	}
	const d = svgxPathData(ring);
	return d ? `${d}Z` : "";
}

// 💣 coordinates[0] ist der Außenring, JEDER WEITERE Eintrag ist ein LOCH. Wer nur den
// ersten zeichnet, füllt Binnenseen zu -- und die Karte sieht dabei richtig aus.
// fill-rule="evenodd" an der Gruppe macht aus dem zweiten Ring das Loch.
function svgxPolygonData(geometry, options) {
	const typ = geometry && geometry.type;
	const coords = (geometry && geometry.coordinates) || [];
	const polygone = typ === "MultiPolygon" ? coords : (typ === "Polygon" ? [coords] : []);
	return polygone
		.map((polygon) => (polygon || []).map((ring) => svgxRingData(ring, options)).filter(Boolean).join(""))
		.filter(Boolean)
		.join("");
}

// Die Endpunkte kommen aus verschiedenen Zeitaltern dieses Projekts und verpacken ihre
// Features verschieden. Statt zu raten, welcher gerade welche Hülle benutzt, packen wir
// tolerant aus -- und die Seite meldet die gefundene Anzahl, damit eine leere Ebene
// sichtbar wird statt still zu bleiben.
// 💣 Nicht jede Quelle verpackt ihre Felder in `properties`. Gemessen am 14.08.2026:
// map-features.php liefert echte GeoJSON-Features (`properties` da), ecosystem-areas.php
// liefert FLACHE Objekte (`region_name`, `region_type`, `geometry` direkt am Objekt).
// Wer nur `f.properties.name` liest, bekommt dort still `undefined` -- die Flächen wären
// gezeichnet, aber alle namenlos und in einer einzigen Gruppe.
function svgxProps(feature) {
	if (!feature) { return {}; }
	return feature.properties || feature;
}

// Der Anzeigename, quer über die Quellen. Erste nicht-leere Angabe gewinnt.
function svgxNameOf(feature) {
	const p = svgxProps(feature);
	return p.name || p.display_name || p.region_name || p.label_name || "";
}

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

// Ist diese Unterart angehakt? ⚠️ Nur ein ausdrückliches `false` schließt aus. Ein
// unbekannter Schlüssel ist damit IMMER dabei -- in den Live-Daten sitzt z. B. ein Ort
// mit der Ortsart `crossing` (Datenleiche, 1 von 2.800). Wer "nicht in der Liste" als
// "nicht gewollt" liest, lässt solche Fälle lautlos verschwinden.
function svgxSubgroupEnabled(enabled, key) {
	return !enabled || enabled[key] !== false;
}

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

	// `bare` lässt die Ebenenhülle weg: dann sind die Gruppen einzeln verwendbar -- so
	// wandern die Flüsse in die Landschaften-Ebene, ohne dass ihr Code ein zweites Mal
	// geschrieben wird. `only` beschränkt auf bestimmte Wegarten.
	const stuecke = o.bare
		? []
		: [svgxLayerOpen({ name: "Wege", id: "layer-wege", dialect: o.dialect })];
	let anzahl = 0;
	const gruppen = {};
	const alleArten = SVGX_WAY_SUBTYPES.concat([...nachArt.keys()].filter((a) => !SVGX_WAY_SUBTYPES.includes(a)));
	const arten = o.only ? alleArten.filter((a) => o.only.includes(a)) : alleArten;
	arten.forEach((art) => {
		const wege = nachArt.get(art);
		// Eine leere Untergruppe wird gar nicht geschrieben: leere Ordner im Ebenenfenster
		// lesen sich wie ein Fehler, obwohl nur nichts da war.
		if (!wege || wege.length === 0) { return; }
		if (!svgxSubgroupEnabled(o.enabled, art)) { return; }
		const basis = `wege-${svgxFoldAscii(art).toLowerCase()}`;
		const skala = svgxStrokeScale(o.strokeScale);
		const linienFarbe = (o.colors || {})[art] || SVGX_WAY_COLORS[art] || "#888888";
		const konturFarbe = (o.outlines || {})[art] || "";
		const zeichnen = { smooth: o.smooth, tension: o.tension };

		stuecke.push(svgxGroupOpen({ name: art, id: basis, dialect: o.dialect,
			attrs: { fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" } }));

		// ⚠️ Die Kontur zuerst und in EINER eigenen Gruppe: in SVG liegt das Erste unten, und
		// eine Kontur unter der Linie ist genau der Sinn. Sie wird nur gezeichnet, wenn eine
		// Farbe dafür gesetzt ist -- sonst verdoppelte sich die Zahl der Pfade stillschweigend.
		if (konturFarbe) {
			stuecke.push(svgxGroupOpen({ name: `${art} Kontur`, id: `${basis}-kontur`, dialect: o.dialect,
				attrs: {
					stroke: konturFarbe,
					"stroke-width": String((SVGX_WAY_OUTLINE_WIDTHS[art] || 0.125) * skala),
				} }));
			wege.forEach((f) => {
				const name = (f.properties && f.properties.name) || art;
				// 🔴 Die Kontur bekommt eine EIGENE id mit Endung -- sonst gäbe es jede id
				// zweimal, und der <textPath href> der Beschriftung träfe die falsche.
				const id = svgxIdFor(`${name}-Kontur`, f.properties && f.properties.public_id, o.dialect, o.seen);
				stuecke.push(`<path id="${svgxEscapeText(id)}" d="${svgxPathData(f.geometry.coordinates, zeichnen)}"/>\n`);
			});
			stuecke.push(svgxGroupClose());
		}

		stuecke.push(svgxGroupOpen({ name: `${art} Linie`, id: `${basis}-linie`, dialect: o.dialect,
			attrs: {
				stroke: linienFarbe,
				"stroke-width": String((SVGX_WAY_WIDTHS[art] || 0.078) * skala),
			} }));
		wege.forEach((f) => {
			const name = (f.properties && f.properties.name) || art;
			const id = svgxIdFor(name, f.properties && f.properties.public_id, o.dialect, o.seen);
			// 🔴 NUR die Linie kommt in die Merkliste, nie die Kontur: die Beschriftung soll
			// auf der Mitte des Weges laufen, nicht auf seinem Rand.
			if (o.wayIds && f.properties && f.properties.public_id) {
				o.wayIds.set(f.properties.public_id, id);
			}
			stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
				+ ` d="${svgxPathData(f.geometry.coordinates, zeichnen)}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
			anzahl += 1;
		});
		stuecke.push(svgxGroupClose());

		gruppen[art] = wege.length;
		stuecke.push(svgxGroupClose());
	});
	if (!o.bare) { stuecke.push(svgxGroupClose()); }
	return { parts: stuecke, count: anzahl, groups: gruppen };
}

function svgxPowerlineLayer(options) {
	const o = options || {};
	const linien = svgxAsFeatures(o.features).filter(
		(f) => f && f.properties && f.properties.feature_type === "powerline"
			&& f.geometry && f.geometry.type === "LineString");
	const stuecke = [svgxLayerOpen({
		name: "Kraftlinien", id: "layer-kraftlinien", dialect: o.dialect,
		attrs: {
			fill: "none", stroke: o.color || "#7a5ea8", "stroke-linejoin": "round",
			"stroke-width": String(SVGX_POWERLINE_WIDTH * svgxStrokeScale(o.strokeScale)),
		},
	})];
	linien.forEach((f) => {
		const name = f.properties.name || "Kraftlinie";
		const id = svgxIdFor(name, f.properties.public_id, o.dialect, o.seen);
		stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
			+ ` d="${svgxPathData(f.geometry.coordinates)}">`
			+ `<title>${svgxEscapeText(name)}</title></path>\n`);
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: linien.length, groups: {} };
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
	const zaehler = {};

	// 🔴 WASSER ZULETZT, und dazwischen passt etwas hinein.
	//
	// „Flüsse unter Seen" geht nicht durch Umsortieren der Ebenen: die Wege sind Ebene 4,
	// die Landschaften Ebene 1, also liegt ALLES aus dem Wege-Bund zwangsläufig über jedem
	// See. Entweder die Flüsse verlassen die Wege oder die Seen die Landschaften -- und
	// Letzteres legte auch Straßen unter Seen, was niemand will.
	//
	// Also ziehen die Flüsse hierher: die Wasserflächen werden ans ENDE dieser Ebene
	// sortiert, und unmittelbar davor wird eingehängt, was `injectBeforeWater` mitbringt.
	// Ergebnis: Fluss über Wald und Land, aber unter See und Meer.
	const wasser = o.waterKeys || [];
	const schluesselAlle = [...gruppen.keys()];
	const reihenfolge = schluesselAlle.filter((k) => !wasser.includes(k))
		.concat(schluesselAlle.filter((k) => wasser.includes(k)));
	let eingehaengt = false;

	reihenfolge.forEach((schluessel) => {
		const flaechen = gruppen.get(schluessel);
		if (!eingehaengt && wasser.includes(schluessel)) {
			(o.injectBeforeWater || []).forEach((teil) => stuecke.push(teil));
			eingehaengt = true;
		}
		if (!svgxSubgroupEnabled(o.enabled, schluessel)) { return; }
		stuecke.push(svgxGroupOpen({
			name: schluessel || o.layerName,
			id: `${o.layerId}-${svgxFoldAscii(schluessel).toLowerCase() || "ohne"}`,
			dialect: o.dialect,
			attrs: {
				fill: (o.colors && o.colors[schluessel]) || o.defaultFill || "none",
				"fill-rule": "evenodd",
				// Eine Kontur nur, wenn fuer diese Gruppe eine Farbe gesetzt ist. Standard: keine.
				// (Die Karte haelt es genauso -- eine Kontur gehoert dem Bearbeiten, nicht dem
				// Ansehen, AGENTS.md §12.) Die Herrschaftsgebiete reichen ihre ueber o.stroke.
				stroke: (o.outlines && o.outlines[schluessel]) || o.stroke || "none",
				// ⚠️ Dieselbe Bedingung wie oben bei `stroke`. Stand hier nur `o.stroke`, bekam
				// eine Landschaftskontur ihre Farbe, aber keine Breite -- und war damit unsichtbar.
				"stroke-width": ((o.outlines && o.outlines[schluessel]) || o.stroke)
					? String(SVGX_BOUNDARY_WIDTH * svgxStrokeScale(o.strokeScale))
					: "",
			},
		}));
		flaechen.forEach((f) => {
			const d = svgxPolygonData(f.geometry, { smooth: o.smooth, tension: o.tension });
			if (!d) { return; }
			const name = svgxNameOf(f) || schluessel || o.layerName;
			const id = svgxIdFor(name, svgxProps(f).public_id, o.dialect, o.seen);
			stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)} d="${d}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
			anzahl += 1;
			// ⚠️ `zaehler`, NICHT `gruppen` -- letzteres ist die Map der Flächen. Eine Zahl
			// dort abzulegen wirft keinen Fehler, sie ist nur für immer unauffindbar.
			zaehler[schluessel || o.layerName] = (zaehler[schluessel || o.layerName] || 0) + 1;
		});
		stuecke.push(svgxGroupClose());
	});
	// Gab es gar kein Wasser, kommen die Flüsse trotzdem in die Datei -- am Ende der Ebene.
	if (!eingehaengt) { (o.injectBeforeWater || []).forEach((teil) => stuecke.push(teil)); }
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl, groups: zaehler };
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
	const gruppen = {};
	const arten = kinds.map((k) => k.slug)
		.concat([...nachArt.keys()].filter((a) => !kinds.some((k) => k.slug === a)));
	arten.forEach((slug) => {
		const orte = nachArt.get(slug);
		if (!orte || orte.length === 0) { return; }
		if (!svgxSubgroupEnabled(o.enabled, slug)) { return; }
		const kind = kinds.find((k) => k.slug === slug) || { slug: slug, label: slug || "Ort", r: 0.8 };
		stuecke.push(svgxGroupOpen({
			name: kind.label || slug, id: `orte-${svgxFoldAscii(slug).toLowerCase() || "ohne"}`,
			dialect: o.dialect,
			// 🔴 Der Ton der Kartenmarkierung (--color-marker-waypoint, "heraldic red"),
			// nicht das Braun der Schrift. Owner 16.08.2026: "gib orten die farben aus der
			// markierung (rot)".
			attrs: { fill: (o.colors || {})[slug] || o.color || SVGX_PLACE_COLOR, stroke: "none" },
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
		gruppen[kind.label || slug] = orte.length;
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl, groups: gruppen };
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
	return { parts: stuecke, count: anzahl, groups: {} };
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
	const parts = [svgxDocumentOpen(dialect, o.sizePx)];
	const stats = {};

	const detail = [];
	const nimm = (name, ergebnis) => {
		stats[name] = ergebnis.count;
		// Die Passmarken kommen INNEN, kurz vor dem Schließen der Ebene -- außen läge
		// eine Ebene neben der Ebene, und genau die würde beim Rastern nicht mitkommen.
		// ⚠️ Setzt voraus, dass das letzte Stück jeder Ebene ihr eigenes </g> ist. Das gilt
		// für alle Ebenenbauer hier; ein neuer, der anders endet, bräche es lautlos.
		if (o.registrationMarks) {
			const marken = svgxRegistrationMarks(dialect, o.sizePx);
			ergebnis.parts.splice(Math.max(0, ergebnis.parts.length - 1), 0, ...marken);
		}
		// Die Untergruppen mit ihren Zahlen -- die Seite zeigt sie eingerueckt an, damit
		// sichtbar ist, was die Datei WIRKLICH enthaelt statt nur, was angehakt war.
		Object.entries(ergebnis.groups || {}).forEach(([gruppe, anzahl]) => {
			detail.push({ layer: name, group: gruppe, count: anzahl });
		});
		ergebnis.parts.forEach((p) => parts.push(p));
	};

	// 🔴 „Flüsse unter Seen" (Owner 15.08.2026). Die Flüsse werden HIER gebaut -- vor den
	// Landschaften -- und in deren Ebene eingehängt, direkt vor den Wasserflächen. Sie
	// verlassen damit den Wege-Bund; anders geht es nicht, denn Ebene 4 liegt immer über
	// Ebene 1. Ihre ids landen trotzdem in `wayIds`, also findet die Beschriftung sie.
	// ⚠️ Reihenfolge im Code = Reihenfolge der id-Vergabe. Die Flüsse bekommen ihre ids
	// zuerst; eindeutig bleibt alles, weil `seen` geteilt ist.
	let flussTeile = [];
	const fluesseUnten = o.riversUnderWater !== false && an.landschaften !== false && an.wege !== false;
	if (fluesseUnten) {
		const fl = svgxWayLayer({
			features: o.mapFeatures, dialect: dialect, seen: seen, wayIds: wayIds,
			enabled: (o.subgroups || {}).wege, strokeScale: o.strokeScale,
			colors: o.wayColors, outlines: o.wayOutlines, smooth: o.smooth, tension: o.tension,
			only: ["Flussweg"], bare: true,
		});
		flussTeile = fl.parts;
		if (fl.count) { detail.push({ layer: "Landschaften", group: "Flusswege", count: fl.count }); }
	}

	// Reihenfolge = Zeichenreihenfolge. In SVG liegt das Erste unten.
	// ⚠️ Es gibt KEINE Ebene "Regionen": im Payload existiert kein feature_type 'region'
	// (gemessen 14.08.2026 an 11.810 Features -- location, crossing, path, junction, label,
	// powerline). Die Flächen, die man dafür hielte, sind die Landschaften-Ebene.
	if (an.landschaften !== false) {
		nimm("Landschaften", svgxAreaLayer({
			features: o.ecosystems, layerName: "Landschaften", layerId: "layer-landschaften",
			// 💣 Der Rückfall heißt `ohne_typ` und NICHT etwa der Name der Art. 49 Flächen
			// tragen keinen region_type; fielen sie auf "topographie"/"derographisch"
			// zurück, hätten sie einen Gruppennamen, den kein Kästchen kennt -- sie
			// rutschten an jedem Filter vorbei und wären nie abwählbar.
			groupBy: (f) => svgxProps(f).region_type || "ohne_typ",
			// Die dritte Auswahlstufe: Geländetyp (wald, see, insel, gebirge …). Sie sitzt
			// eine Ebene TIEFER als die vier Landschafts-Arten, weil die Arten den ABRUF
			// steuern und die Typen das ZEICHNEN -- zwei verschiedene Fragen.
			enabled: (o.subgroups || {}).landschaftstypen,
			outlines: o.areaOutlines,
			// Was als WASSER gilt und deshalb zuletzt gezeichnet wird. Gemessen an den
			// Live-Daten: Seen, Meere, Küsten und Flussdeltas sind Wasserflächen; `wadi`
			// ist ein trockenes Bett und `flussland_flusstal` Bewuchs -- beide gehören
			// NICHT dazu, sonst verschwänden Flüsse unter ihrem eigenen Flusstal.
			waterKeys: ["see", "meer", "kueste", "flussdelta"],
			injectBeforeWater: flussTeile,
			// Flächen haben ihren EIGENEN Schalter: die Karte zeichnet sie aus
			// Leistungsgründen eckig, aber organisch sind sie (Owner 15.08.2026).
			// ⚠️ Ein Ring wird umlaufend geglättet, nicht wie eine offene Linie --
			// siehe svgxSmoothRingData.
			smooth: o.smoothAreas === true,
			// Die Farbe je Geländetyp, gelesen aus denselben Token wie die Karte
			// (--color-ecosystem-<art>-<typ>). Der Kitt reicht sie herein, weil
			// getComputedStyle ein DOM braucht und dieser Bauer keins hat.
			colors: o.areaColors,
			// 🔴 KEINE Deckkraft. Die Karte füllt mit 0,72 (--eco-fill), weil dort die
			// Kacheln durchscheinen sollen -- hier nicht (Owner 15.08.2026). Eine
			// halbdurchsichtige Fläche in einer Bearbeitungsdatei ist ein Ärgernis: sie
			// mischt sich mit allem darunter, und wer sie sauber haben will, muss den Wert
			// an jeder Gruppe einzeln zurücksetzen. Volle Deckung, Transparenz vergibt der
			// Gestalter selbst.
			defaultFill: "#dfd6bd", dialect: dialect, seen: seen,
		}));
	}
	if (an.gebiete !== false) {
		nimm("Herrschaftsgebiete", svgxAreaLayer({
			features: o.territories, layerName: "Herrschaftsgebiete", layerId: "layer-gebiete",
			groupBy: (f) => svgxProps(f).rank || svgxProps(f).type || "Gebiet",
			defaultFill: "none", stroke: o.boundaryColor || "#8a6a3f", strokeScale: o.strokeScale,
			// 🔴 HERRSCHAFTSGEBIETE WERDEN NIE GEGLÄTTET (Owner 15.08.2026: "auf keinen
			// Fall"). Eine politische Grenze ist eine Behauptung über einen Verlauf, keine
			// organische Form -- eine gerundete Grenze verschiebt Land zwischen Reichen und
			// sieht dabei aus wie eine Verbesserung. Hier steht `false` ausgeschrieben und
			// nicht etwa `o.smoothAreas`: wer den Schalter durchreichen will, muss diese
			// Zeile löschen und stolpert dabei über die Begründung.
			smooth: false,
			dialect: dialect, seen: seen,
		}));
	}
	if (an.wege !== false) {
		// Liegen die Flüsse unten, dürfen sie hier NICHT noch einmal kommen -- sonst
		// stünde jeder Fluss zweimal in der Datei, einmal unter und einmal über dem See.
		const wegeAus = fluesseUnten
			? Object.assign({}, (o.subgroups || {}).wege, { Flussweg: false })
			: (o.subgroups || {}).wege;
		nimm("Wege", svgxWayLayer({ features: o.mapFeatures, dialect: dialect, seen: seen,
			wayIds: wayIds, enabled: wegeAus, strokeScale: o.strokeScale,
			colors: o.wayColors, outlines: o.wayOutlines, smooth: o.smooth, tension: o.tension }));
	}
	if (an.kraftlinien !== false) {
		nimm("Kraftlinien", svgxPowerlineLayer({ features: o.mapFeatures, dialect: dialect, seen: seen,
			strokeScale: o.strokeScale, color: o.powerlineColor, smooth: o.smooth, tension: o.tension }));
	}
	if (an.orte !== false) {
		nimm("Orte", svgxPlaceLayer({ features: o.mapFeatures, kinds: o.placeKinds, dialect: dialect,
			seen: seen, enabled: (o.subgroups || {}).orte, colors: o.placeColors }));
	}
	if (an.beschriftungen !== false) {
		nimm("Beschriftungen", svgxLabelLayer({
			features: o.mapFeatures, wayIds: wayIds, dialect: dialect, seen: seen, color: o.labelColor,
		}));
	}

	parts.push(svgxDocumentClose());
	return { parts: parts, stats: stats, detail: detail };
}

// Browserseite: EIN benannter Zugang für den Kitt. Die flachen Funktionen bleiben
// zusätzlich global (Projektstandard ohne Build), aber der Kitt greift über diesen
// Namen zu, damit man in einer Datei sieht, was die öffentliche Fläche ist.
if (typeof window !== "undefined") {
	window.AvesmapsSvgExport = {
		build: svgxBuildDocument,
		asFeatures: svgxAsFeatures,
		DIALECTS: SVGX_DIALECTS,
		PLACE_COLOR: SVGX_PLACE_COLOR,
		WAY_COLORS: SVGX_WAY_COLORS,
		WAY_SUBTYPES: SVGX_WAY_SUBTYPES,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SVGX_VIEWBOX_SIZE: SVGX_VIEWBOX_SIZE,
		SVGX_DIALECTS: SVGX_DIALECTS,
		SVGX_WAY_SUBTYPES: SVGX_WAY_SUBTYPES,
		SVGX_WAY_COLORS: SVGX_WAY_COLORS,
		SVGX_WAY_WIDTHS: SVGX_WAY_WIDTHS,
		SVGX_BOUNDARY_WIDTH: SVGX_BOUNDARY_WIDTH,
		SVGX_PLACE_KINDS: SVGX_PLACE_KINDS,
		SVGX_PLACE_COLOR: SVGX_PLACE_COLOR,
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
		svgxSmoothPathData: svgxSmoothPathData,
		SVGX_CATMULL_TENSION: SVGX_CATMULL_TENSION,
		SVGX_WAY_OUTLINE_WIDTHS: SVGX_WAY_OUTLINE_WIDTHS,
		svgxPolygonData: svgxPolygonData,
		svgxSmoothRingData: svgxSmoothRingData,
		svgxRegistrationMarks: svgxRegistrationMarks,
		SVGX_REGMARK_COLOR: SVGX_REGMARK_COLOR,
		svgxAsFeatures: svgxAsFeatures,
		svgxProps: svgxProps,
		svgxNameOf: svgxNameOf,
		svgxSubgroupEnabled: svgxSubgroupEnabled,
		svgxWayLayer: svgxWayLayer,
		svgxPowerlineLayer: svgxPowerlineLayer,
		svgxAreaLayer: svgxAreaLayer,
		svgxPlaceLayer: svgxPlaceLayer,
		svgxLabelLayer: svgxLabelLayer,
		svgxBuildDocument: svgxBuildDocument,
	};
}
