// Der reine Bauer des SVG-Exports: Payload rein, Textstücke raus.
//
// 🔴 KEIN DOM, KEIN fetch, KEIN document. Das ist der Vertrag, und er ist der Grund,
// warum diese Datei testbar ist. Der Kitt (svg-export-page.js) holt die Daten und
// reicht sie herein; hier wird nichts geladen.
//
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
"use strict";

const SVGX_VIEWBOX_SIZE = 1024;

// 🔴 DER API-ABZUG. Diese Einstellungen gelten fuer die Datei, die GET /api/svg-export.php
// ausliefert -- und zwar EGAL, wer sie erzeugt: die naechtliche Routine unter Node und der
// Knopf „Abzug hinterlegen" im Browser bauen damit dasselbe.
//
// 🔴 DIE HAEKCHEN AUF DER SEITE GELTEN NUR FUER DEN DOWNLOAD (Owner-Entscheid 23.08.2026:
// „die häkchen soll nur für den SVG export sein, der abzug für die API soll automatisch immer
// alles speichern"). Der API-Abzug ist eine DATENQUELLE, kein Gestaltungsstueck -- er muss
// vollstaendig und in einer festen Schreibweise kommen, sonst weiss ein Auswerter nie, was er
// bekommt.
// 💣 Genau das ist einmal passiert: die Seite hat `illustrator` vorangehaekelt, die Routine
// baut `inkscape`, und Inkscape schreibt an JEDES Element zusaetzlich `inkscape:label`. Ein
// hinterlegter Handabzug war deshalb 7,4 statt 9,0 MB -- bei identischem Inhalt. Das sah aus
// wie fehlende Ebenen und war eine andere Schreibweise.
// 💣 `layers: {}` und `subgroups: {}` heissen ALLES: svgxSubgroupEnabled schliesst nur bei
// ausdruecklichem `false` aus. Eine Aufzaehlung waere eine Liste, die niemand nachfuehrt.
const SVGX_ABZUG_EINSTELLUNGEN = {
	dialect: "inkscape",
	sizePx: 32768,
	strokeScale: 1,
	smooth: false,
	smoothAreas: false,
	tension: 0.5,
	registrationMarks: false,
	semantics: true,
	layers: {},
	subgroups: {},
};

const SVGX_DIALECTS = {
	ILLUSTRATOR: "illustrator",
	INKSCAPE: "inkscape",
};

// Die acht Wegarten in der Reihenfolge von PATH_SUBTYPE_KEYS (js/config.js), plus „Bach".
// Hier noch einmal aufgeführt, weil dieser Bauer ohne die Karte laufen können muss.
// 🔴 „Bach" STEHT IN PATH_SUBTYPE_KEYS AUSDRÜCKLICH NICHT und in keiner Datenbankzeile: er
// ist ein `Flussweg` mit `properties.is_bach` (Owner 30.08.2026). Diese Liste führt aber
// die ANZEIGE-Arten -- das, wonach der Export gruppiert und was ein Leser der Datei sieht.
// ⚠️ Sie ist damit auch die Liste, aus der die Farbtafel des Abzugs entsteht
// (svgxVorgabeFarben). Wer hier etwas einträgt, braucht drüben einen Farbwert, sonst zeichnet
// der Export es im Rückfall-Grau.
const SVGX_WAY_SUBTYPES = ["Reichsstrasse", "Strasse", "Weg", "Pfad",
	"Gebirgspass", "Wuestenpfad", "Flussweg", "Bach", "Seeweg"];

// 🔴 DIE ANZEIGE-WEGART EINES FEATURES, nicht die gespeicherte. ABSCHRIFT aus pathIstBach
// (js/map-features/map-features-path-domain.js) -- bewusst, wie SVGX_WAY_COLORS darunter:
// dieser Bauer läuft nachts unter Node und darf die Karte nicht laden.
// ⚠️ Gelesen wird STRIKT `=== true` und nur an einem `Flussweg`, genau wie dort, serverseitig
// in avesmapsPathIstBach und im Router. Eine großzügigere Lesart machte aus einem Fluss mit
// krummem Feld einen Bach -- und der Export behauptete etwas, das die Karte nicht zeigt.
function svgxWaySubtype(feature) {
	const p = (feature && feature.properties) || {};
	const art = p.feature_subtype || "Weg";
	return art === "Flussweg" && p.is_bach === true ? "Bach" : art;
}

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
	// Ein Bach ist Wasser wie der Fluss -- unterschieden wird er über die BREITE, nicht über
	// die Farbe. Zwei Blautöne nebeneinander läsen sich als zwei Gewässerarten.
	Bach: "#6ec6ff",
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
	// Bach: siehe SVGX_BACH_FAKTOR unter der Konturtabelle -- er wird GERECHNET.
};

// Konturbreiten, nach derselben Rechnung aus PATH_OUTLINE_WEIGHTS (js/config.js):
// Reichsstrasse 6,5 px, Strasse/Weg 4, Pfad/Gebirgspass/Wuestenpfad 3, Fluss-/Seeweg 5.
// ⚠️ Eine Kontur wird nur gezeichnet, wenn für ihre Wegart eine FARBE gesetzt ist. Ohne
// Farbe keine Kontur -- sonst verdoppelt sich stillschweigend die Zahl der Pfade.
const SVGX_WAY_OUTLINE_WIDTHS = {
	Reichsstrasse: 0.203, Strasse: 0.125, Weg: 0.125, Pfad: 0.094,
	Gebirgspass: 0.094, Wuestenpfad: 0.094, Flussweg: 0.156, Seeweg: 0.156,
};

// 🔴 EIN BACH IST EIN HALBER FLUSS -- Owner 31.08.2026, wörtlich: „bach is halb so breit wie
// n fluss". Die Zahl steht in der KARTE (`PATH_WIDTH_SCALE.Bach`, js/config.js: 0,5 ab Zoom 3)
// und halbiert dort Kontur UND Füllung; aus 5/3 px werden 2,5/1,5.
// ⭐ Hier wird sie GERECHNET und nicht abgeschrieben: zwei Zahlen für „die Hälfte des Flusses"
// laufen beim ersten Mal auseinander, an dem jemand die Flussbreite anfasst -- und dann zeigt
// der Abzug einen anderen Bach als die Karte, ohne dass etwas rot wird.
// ⚠️ Der Faktor der Karte hängt am Zoom; dieser Export IST die volle Zoomstufe (32.768 px =
// 1024 × 2⁵, siehe oben), also gilt der Wert von z5. Unter Zoom 3 nimmt die Karte den Bach
// ganz von der Karte -- das ist eine Frage der Kartenansicht, nicht des Abzugs.
// 💣 Die Halbierung trifft BEIDE Breiten. Bliebe der Kern bei 3 px und nur die Kontur ginge
// herunter, wäre vom Saum ein halber Pixel je Seite übrig -- der Bach hätte dann faktisch
// gar keine Kontur mehr. So bleibt das Verhältnis Mantel:Kern das des Flusses.
const SVGX_BACH_FAKTOR = 0.5;
SVGX_WAY_WIDTHS.Bach = SVGX_WAY_WIDTHS.Flussweg * SVGX_BACH_FAKTOR;              // 1,5 px
SVGX_WAY_OUTLINE_WIDTHS.Bach = SVGX_WAY_OUTLINE_WIDTHS.Flussweg * SVGX_BACH_FAKTOR;  // 2,5 px

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
// 🔴 DER MASSSTAB DER ORTSZIRKEL: die Zoomstufe, auf der gemessen wird. Ein Ort ist im Abzug so
// groß, wie die Karte ihn auf ihrer HÖCHSTEN Stufe zeichnet -- dort ist der Marker im Verhältnis
// zur Karte am kleinsten und kommt einer Ortsausdehnung am nächsten.
// ⚠️ Eine Kopie von `maxZoom` aus js/app/bootstrap.js; einen geteilten Export dafür gibt es nicht
// (dieselbe Lage wie ZOOM_BAND_MAP_MAX_ZOOM im Ortseditor, der es genauso hält). Ändert sich
// maxZoom, muss diese Zahl mit -- __tests__/svg-export-ortsgroessen.test.js vergleicht alle drei.
// 💣 NICHT AVESMAPS_ZOOM_BAND_MAX_ZOOM (8): die Datenschicht trägt eine Stufe, die die Karte nie
// zeigt, und eine Übersteuerung darf dort etwas anderes stehen haben als bei z7.
const SVGX_PLACE_SIZE_ZOOM = 7;

// Bei L.CRS.Simple ist der Maßstab 2^zoom -- eine Karteneinheit misst auf Stufe z genau 2^z
// Bildpunkte. Der Bandwert ist ein DURCHMESSER (Außendurchmesser samt der weißen Kontur, die die
// Karte um jeden Punkt zieht), gebraucht wird ein Radius: daher die 2.
// Vier Nachkommastellen, weil die Zahlen klein sind -- bei 1024 Einheiten Kantenlänge wäre die
// sonst übliche zweite Stelle für ein Gebäude (0,0485) bereits eine Stufe von 20 %.
function svgxPlaceRadiusFromDiameter(diameterPx) {
	return Math.round((diameterPx / 2 / Math.pow(2, SVGX_PLACE_SIZE_ZOOM)) * 10000) / 10000;
}

// Die Ortsklassen und ihre Zirkelradien in Karteneinheiten (1 Einheit = 3 Meilen).
// 🔴 DIE ZAHLEN SIND GERECHNET, NICHT GEGRIFFEN: es ist AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS
// .marker bei z7, durch svgxPlaceRadiusFromDiameter geschickt. Sie stehen hier als Literale, weil
// dieser Bauer rein bleibt und die Zoombänder-Datei nicht lädt; der Wächter gegen ihr
// Auseinanderlaufen ist __tests__/svg-export-ortsgroessen.test.js, der beide zusammenbringt.
// ⚠️ Das ist die VORGABE. Verstellt ein Admin die Tafel, reicht die Seite die daraus gerechnete
// Liste als `placeKinds` durch (svgxPlaceKindsFromBands).
// 🪤 Davor standen hier sechs frei gegriffene Zahlen (2,2 … 0,6): eine Metropole maß damit 13,2
// Meilen, ein Dorf 4,2 -- rund zehnmal zu groß. Die Verhältnisse untereinander stimmten schon,
// nur der Maßstab fehlte (Owner 22.08.2026: "die zirkel sind aktuell viel zu groß").
const SVGX_PLACE_KINDS = [
	{ slug: "metropole", label: "Metropole", r: 0.2078 },
	{ slug: "grossstadt", label: "Großstadt", r: 0.1559 },
	{ slug: "stadt", label: "Stadt", r: 0.1247 },
	{ slug: "kleinstadt", label: "Kleinstadt", r: 0.097 },
	{ slug: "dorf", label: "Dorf", r: 0.0693 },
	{ slug: "gebaeude", label: "Gebäude", r: 0.0485 },
	// Dieselbe Größe wie das Gebäude -- beide teilen sich das Zoomband (siehe location-zoom-bands.js).
	{ slug: "stadtviertel", label: "Stadtviertel", r: 0.0485 },
];

// 💣 Der Radius einer Ortsklasse, die diese Liste NICHT kennt (der Abzug zeichnet auch solche --
// svgxPlaceLayer hängt sie hinten an). Er muss im selben Maßstab liegen wie die Liste darüber:
// bis 22.08.2026 stand hier 0,8 und blieb beim Umbau fast liegen -- eine unbekannte Klasse wäre
// 4,8 Meilen breit geworden, während die Metropole daneben 1,25 misst. 0,08 hält denselben Platz
// in der Reihe wie die alte 0,8: zwischen Dorf und Kleinstadt.
const SVGX_PLACE_FALLBACK_R = 0.08;

// Die Ortsklassen mit den Radien, die aus einer Zoombänder-Tafel folgen -- übergeben wird der
// `marker`-Teil von avesmapsResolveLocationZoomBands (Vorgabe + Übersteuerung, schon
// zusammengeführt). Rein: eine Tafel kommt herein, eine Liste geht hinaus.
//
// 💣 UNBRAUCHBAR IST EIN NICHTWISSEN, KEIN RADIUS NULL. Eine fehlende Zeile, ein `null` auf allen
// Stufen oder ein kaputter Wert fällt auf die Vorgabe zurück. Ein Kreis mit r=0 wäre gezeichnet
// und unsichtbar zugleich -- und der Abzug ist eine Datenquelle, kein Kartenbild: er zeichnet
// eine Ortsklasse, wenn ihr Häkchen gesetzt ist, auch wenn die Karte sie nie zeigt.
//
// ⚠️ Gelaufen wird über SVGX_PLACE_KINDS, nicht über die Schlüssel der Tafel: die Liste der
// Ortsklassen führt der Browser, nicht der Server (dieselbe Regel wie in
// avesmapsResolveLocationZoomBands).
function svgxPlaceKindsFromBands(markerBands) {
	const tafel = (markerBands && typeof markerBands === "object" && !Array.isArray(markerBands))
		? markerBands
		: {};
	return SVGX_PLACE_KINDS.map((kind) => {
		const zeile = tafel[kind.slug];
		const wert = Array.isArray(zeile) ? zeile[SVGX_PLACE_SIZE_ZOOM] : undefined;
		if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
			return Object.assign({}, kind);
		}
		return Object.assign({}, kind, { r: svgxPlaceRadiusFromDiameter(wert) });
	});
}

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


// ---------------------------------------------------------------------------------------
// 🔴 SEMANTIK -- die Datei soll als QUELLE für eine Bildgenerierung taugen (Owner 16.08.2026),
// also muss ein Leser Wüste von Wald von Gebirge unterscheiden können, OHNE die Karte zu
// kennen und ohne Slugs aus ids zu parsen.
//
// Drei Dinge tut der Export dafür:
//   1. jedes Element trägt `avm:kind` und `avm:type` -- am ELEMENT, nicht nur an der Gruppe.
//      Wer die Datei flach ausliest (und das tut eine Bild-Pipeline), hätte sonst nichts.
//   2. der Kopf führt ein VOKABULAR der tatsächlich vorkommenden Typen, mit deutschem und
//      englischem Begriff -- damit die Datei sich selbst erklärt.
//   3. beides in beiden Dialekten; `inkscape:label` gibt es im Illustrator-Zweig nicht.
//
// ⚠️ Die englischen Begriffe sind ABGESCHRIEBEN aus den Kommentaren in css/base/tokens.css
// ("dense forest", "swamp and moor", "wadi, sand with an olive cast" …) -- eine echte Quelle,
// keine Erfindung. Sie müssen hier stehen, weil CSS-KOMMENTARE zur Laufzeit nicht lesbar
// sind: getComputedStyle liefert den Wert, nie den Kommentar daneben. Ändert dort jemand
// einen Begriff, folgt diese Tabelle NICHT von selbst.
const SVGX_NS_AVM = "https://avesmaps.de/ns/export/1";

const SVGX_TYPE_VOCAB = {
	// Vegetation
	wald: { de: "Wald", en: "dense forest" },
	suempfe_moore: { de: "Sümpfe & Moore", en: "swamp and moor" },
	steppe: { de: "Steppe", en: "steppe" },
	tundra: { de: "Tundra", en: "tundra" },
	auenlandschaft: { de: "Auenlandschaft", en: "floodplain" },
	wueste: { de: "Wüste", en: "desert" },
	graslandschaft: { de: "Graslandschaft", en: "grassland" },
	flussland_flusstal: { de: "Flussland & Flusstal", en: "river land and valley" },
	dschungel: { de: "Dschungel", en: "jungle" },
	wuestenoase: { de: "Wüstenoase", en: "desert oasis" },
	kulturlandschaft: { de: "Kulturlandschaft", en: "cultivated land" },
	// Topographie
	gebirge: { de: "Gebirge", en: "mountains" },
	huegelland: { de: "Hügelland", en: "hills" },
	see: { de: "See", en: "lake" },
	meer: { de: "Meer", en: "sea" },
	kueste: { de: "Küste", en: "coast" },
	wadi: { de: "Wadi", en: "wadi, dry river bed" },
	schlucht: { de: "Schlucht", en: "gorge" },
	hochebene: { de: "Hochebene", en: "plateau" },
	tiefebene: { de: "Tiefebene", en: "lowland" },
	tal: { de: "Tal", en: "valley" },
	flussdelta: { de: "Flussdelta", en: "river delta" },
	insel: { de: "Insel", en: "island" },
	// Klima
	polar: { de: "Polar", en: "polar" },
	subpolar: { de: "Subpolar", en: "subpolar" },
	boreal: { de: "Boreal", en: "boreal" },
	gemaessigt: { de: "Gemäßigt", en: "temperate" },
	subtropen_winterfeucht: { de: "Subtropen, winterfeucht", en: "winter-wet subtropics" },
	trockene_subtropen: { de: "Trockene Subtropen", en: "dry subtropics" },
	subtropisch: { de: "Subtropisch", en: "subtropical" },
	tropisch: { de: "Tropisch", en: "tropical" },
	// Derographische Behälter
	kontinent: { de: "Kontinent", en: "continent" },
	inselgruppe: { de: "Inselgruppe", en: "archipelago" },
	region: { de: "Region", en: "region" },
	ohne_typ: { de: "ohne Typ", en: "untyped area" },
	// Wegarten
	Reichsstrasse: { de: "Reichsstraße", en: "imperial road" },
	Strasse: { de: "Straße", en: "road" },
	Weg: { de: "Weg", en: "track" },
	Pfad: { de: "Pfad", en: "footpath" },
	Gebirgspass: { de: "Gebirgspass", en: "mountain pass" },
	Wuestenpfad: { de: "Wüstenpfad", en: "desert trail" },
	Flussweg: { de: "Flussweg", en: "river" },
	Bach: { de: "Bach", en: "brook" },
	Seeweg: { de: "Seeweg", en: "sea route" },
	// Ortsarten
	metropole: { de: "Metropole", en: "metropolis" },
	grossstadt: { de: "Großstadt", en: "large city" },
	stadt: { de: "Stadt", en: "city" },
	kleinstadt: { de: "Kleinstadt", en: "small town" },
	dorf: { de: "Dorf", en: "village" },
	gebaeude: { de: "Gebäude", en: "building" },
	stadtviertel: { de: "Stadtviertel", en: "city quarter" },
};

// Die Semantik-Attribute eines Elements. Leer, wenn niemand sie bestellt hat -- niemand
// bekommt 20.000-mal drei Attribute ungefragt in die Datei.
// Bequemere Reihenfolge für die Aufrufstellen: (an, zaehler, felder).
function svgxSem2(an, gesehen, felder) {
	return svgxSem(an, felder, gesehen);
}

// Die avm:-Attribute eines Elements.
// 🔴 avm:id ist die DAUERHAFTE Kennung (public_id der Datenbank), NICHT die XML-id.
// Die XML-id traegt den Namen, damit Illustrator und Inkscape etwas Lesbares zeigen --
// sie aendert sich also, sobald jemand umbenennt. Wer zwei Abzuege vergleichen will (etwa
// um nur die geaenderten Kacheln neu zu rechnen), muss avm:id nehmen. Die Bild-Pipeline
// hat am 18.08.2026 genau danach gefragt; es ist ihr groesster Rechenzeit-Hebel.
function svgxSem(an, felder, gesehen) {
	if (!an) { return ""; }
	// 💣 Das Vokabular MUSS aus den wirklich geschriebenen Werten entstehen, nicht aus dem
	// Zählwerk: dort stehen Anzeige-Labels ("Metropole", "Flusswege"), an den Elementen aber
	// Schlüssel ("metropole", "Flussweg"). Der erste Anlauf baute es aus dem Zählwerk -- die
	// Datei erklärte 39 Typen und benutzte 47. Eine Datei, die sich selbst erklären soll,
	// darf keine Vokabel benutzen, die sie nicht führt.
	if (gesehen && felder && felder.type) {
		gesehen.set(felder.type, (gesehen.get(felder.type) || 0) + 1);
	}
	return Object.entries(felder || {})
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => ` avm:${k}="${svgxEscapeText(v)}"`)
		.join("");
}



// ---------------------------------------------------------------------------------------
// 🔴 DER KONTEXT -- das eigentliche Ziel der Semantik (Owner 16.08.2026).
//
// Ein Waldpolygon allein sagt nur "Wald". Was daraus im Bild wird, entscheidet die
// ÜBERLAGERUNG: Wald x tropisch ist Dschungel und Palmen, Wald x boreal ist Nadelwald,
// Gebirge x polar ist schneebedeckt. Also trägt jedes Element neben seinem Typ auch, in
// welcher Klimazone und über welchem Relief es liegt.
//
// 🔴 NUR FAKTEN, keine Deutung (Owner-Entscheid). Was "Wald x tropisch" BEDEUTET, steht
// nicht in der Datei -- das entscheidet der Prompt-Bauer. Sonst wäre die SVG ein
// Art-Direction-Dokument, und jede Änderung an der Bildsprache verlangte einen Neuexport.
//
// ⚠️ Gerechnet wird in KARTENkoordinaten (y wächst nach Norden), nicht in SVG-Koordinaten.
// Die Landschaftsgeometrien kommen so herein; einmal spiegeln reicht, und das passiert
// erst beim Zeichnen. Wer hier spiegelte, bekäme die Klimazonen von Nord nach Süd vertauscht.
const SVGX_RELIEF_TYPES = ["gebirge", "huegelland", "hochebene", "tiefebene", "tal", "schlucht", "wadi"];

// Strahlensatz-Test, die Standardform. Punkte sind [x, y] in Kartenkoordinaten.
function svgxPointInRing(x, y, ring) {
	let drin = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
		const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
		if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
			drin = !drin;
		}
	}
	return drin;
}

// 💣 Löcher zählen. Ein Punkt im Binnensee eines Kontinents liegt NICHT im Kontinent --
// wer nur den Außenring prüft, ordnet jede Insel im See der Landmasse zu.
function svgxPointInPolygon(x, y, geometry) {
	const typ = geometry && geometry.type;
	const coords = (geometry && geometry.coordinates) || [];
	const teile = typ === "MultiPolygon" ? coords : (typ === "Polygon" ? [coords] : []);
	for (const teil of teile) {
		if (!teil || !teil.length || !svgxPointInRing(x, y, teil[0])) { continue; }
		let imLoch = false;
		for (let r = 1; r < teil.length; r += 1) {
			if (svgxPointInRing(x, y, teil[r])) { imLoch = true; break; }
		}
		if (!imLoch) { return true; }
	}
	return false;
}

// Ein Punkt, der das Element vertritt. Für eine Fläche die Mitte ihrer Hüllbox -- nicht der
// echte Schwerpunkt, aber für "in welchem Band liegt das" genau genug und in einem Durchgang.
// ⚠️ Für eine Linie die MITTE, nicht der Anfang: ein Fluss beginnt im Gebirge und endet im
// Meer, und sein Anfang beantwortet die Frage nach seiner Umgebung falsch.
function svgxRepPoint(geometry) {
	const typ = geometry && geometry.type;
	const c = (geometry && geometry.coordinates) || [];
	if (typ === "Point") { return [Number(c[0]), Number(c[1])]; }
	if (typ === "LineString") {
		if (!c.length) { return null; }
		const m = c[Math.floor(c.length / 2)];
		return [Number(m[0]), Number(m[1])];
	}
	const teile = typ === "MultiPolygon" ? c : (typ === "Polygon" ? [c] : []);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, gesehen = false;
	teile.forEach((teil) => (teil && teil[0] ? teil[0] : []).forEach(([x, y]) => {
		gesehen = true;
		if (x < minX) { minX = x; } if (x > maxX) { maxX = x; }
		if (y < minY) { minY = y; } if (y > maxY) { maxY = y; }
	}));
	return gesehen ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

// Die Nachschlagewerke: Klimabänder und Reliefflächen, je mit Hüllbox als Vorfilter.
// ⚠️ Die Hüllbox ist ein VORfilter, kein Treffer -- danach entscheidet der Punkttest.
// (Am Seepunkt lagen 9 Gebiete in der Box und 0 bestanden den Test; dieselbe Falle wie
// bei "Was ist hier?".)
// 🔴 Die Gipfel. Das HÖHENFELD der Karte (map-features-ecosystem-height-field.js) wird im
// Browser aus benannten Gipfeln plus Rauschen gerechnet und hat KEINEN Endpunkt -- also wird
// hier nicht das Feld nachgebaut, sondern seine Quelle benutzt: die Gipfel selbst.
// Jede Reliefﬂäche bekommt die höchste Gipfelhöhe in ihr; ein Wald darin erbt sie.
// ⚠️ Die Höhe steht in `height_schritt` (Meter), NICHT in `height`. Live tragen 35 von 74
// Gipfeln eine -- die übrigen liefern schlicht keine Angabe, und das ist ehrlicher als 0.
const SVGX_PEAK_SUBTYPES = ["berggipfel", "vulkan"];

function svgxPeaks(mapFeatures) {
	return svgxAsFeatures(mapFeatures)
		.filter((f) => f && f.properties && f.properties.feature_type === "label"
			&& SVGX_PEAK_SUBTYPES.includes(f.properties.feature_subtype)
			&& f.geometry && f.geometry.type === "Point"
			&& Number(f.properties.height_schritt) > 0)
		.map((f) => ({
			x: Number(f.geometry.coordinates[0]),
			y: Number(f.geometry.coordinates[1]),
			hoehe: Number(f.properties.height_schritt),
		}));
}

function svgxBuildContextIndex(ecosystems, mapFeatures) {
	const bauen = (pruef) => svgxAsFeatures(ecosystems)
		.filter((f) => f && f.geometry && pruef(svgxProps(f)))
		.map((f) => {
			const g = f.geometry;
			const c = g.coordinates || [];
			const teile = g.type === "MultiPolygon" ? c : [c];
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			teile.forEach((teil) => (teil && teil[0] ? teil[0] : []).forEach(([x, y]) => {
				if (x < minX) { minX = x; } if (x > maxX) { maxX = x; }
				if (y < minY) { minY = y; } if (y > maxY) { maxY = y; }
			}));
			return { typ: svgxProps(f).region_type || "", geometry: g, minX, minY, maxX, maxY };
		});

	const relief = bauen((pr) => SVGX_RELIEF_TYPES.includes(pr.region_type));

	// Gipfel den Reliefflächen zuordnen, EINMAL -- nicht je Element neu.
	svgxPeaks(mapFeatures).forEach((g) => {
		for (const e of relief) {
			if (g.x < e.minX || g.x > e.maxX || g.y < e.minY || g.y > e.maxY) { continue; }
			if (!svgxPointInPolygon(g.x, g.y, e.geometry)) { continue; }
			if (!(e.hoehe >= g.hoehe)) { e.hoehe = g.hoehe; }
			break;
		}
	});

	return { klima: bauen((pr) => pr.kind === "klima"), relief: relief };
}

function svgxLookupEintrag(liste, punkt) {
	if (!punkt) { return null; }
	const [x, y] = punkt;
	for (const e of liste) {
		if (x < e.minX || x > e.maxX || y < e.minY || y > e.maxY) { continue; }
		if (svgxPointInPolygon(x, y, e.geometry)) { return e; }
	}
	return null;
}

function svgxLookup(liste, punkt) {
	const e = svgxLookupEintrag(liste, punkt);
	return e ? e.typ : "";
}

// Klimazone und Relief eines Elements. Leer, wenn nichts zutrifft -- eine leere Angabe ist
// ehrlicher als eine geratene.
// Flächeninhalt in viewBox-Einheiten². 🔴 Für die Matrix wichtiger als die ANZAHL:
// 500 Waldflecken und 3 Waldmeere zählen gleich, wirken im Bild aber gar nicht gleich.
// Gaußsche Trapezformel über die Außenringe, Löcher abgezogen.
function svgxPolygonArea(geometry) {
	const typ = geometry && geometry.type;
	const c = (geometry && geometry.coordinates) || [];
	const teile = typ === "MultiPolygon" ? c : (typ === "Polygon" ? [c] : []);
	let summe = 0;
	teile.forEach((teil) => (teil || []).forEach((ring, i) => {
		let a = 0;
		for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
			a += (ring[j][0] * ring[k][1]) - (ring[k][0] * ring[j][1]);
		}
		summe += (i === 0 ? 1 : -1) * Math.abs(a / 2);
	}));
	return summe;
}

function svgxContextFor(geometry, index, zaehler, typ) {
	if (!index) { return {}; }
	const punkt = svgxRepPoint(geometry);
	if (!punkt) { return {}; }
	const relief = svgxLookupEintrag(index.relief || [], punkt);
	if (zaehler && typ) {
		const k = [typ, relief ? relief.typ : "-", svgxLookup(index.klima || [], punkt) || "-",
			relief && relief.hoehe ? relief.hoehe : "-"].join("|");
		const alt = zaehler.get(k) || { anzahl: 0, flaeche: 0 };
		zaehler.set(k, { anzahl: alt.anzahl + 1, flaeche: alt.flaeche + svgxPolygonArea(geometry) });
	}
	return {
		klima: svgxLookup(index.klima || [], punkt),
		relief: relief ? relief.typ : "",
		// Leer, wenn das Relief keinen benannten Gipfel mit Höhe trägt -- eine fehlende
		// Angabe ist ehrlicher als eine gerundete Null.
		hoehe: relief && relief.hoehe ? String(relief.hoehe) : "",
	};
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

// 💣 Die ids MÜSSEN je Ebene verschieden sein. Der erste Bau vergab in jeder Ebene
// dieselben vier -- bei sechs Ebenen also 24 <rect> mit vier ids. Doppelte ids sind gegen
// die SVG-Spec, und Inkscape schreibt sie beim Speichern stillschweigend um; wer danach
// über die id sucht, findet die Marke nicht mehr. Gefunden hat es die Bild-Pipeline
// (18.08.2026), nicht der Test: der prüfte die Eindeutigkeit an einem Dokument OHNE
// Passmarken. Ein Test, der den Schalter nicht setzt, prüft den Schalter nicht.
function svgxRegistrationMarks(dialect, sizePx, ebeneId) {
	// Kantenlänge = 1 Bildpunkt bei der gewählten Ausgabegröße. Kleiner wäre nicht mehr
	// zuverlässig, größer unnötig auffällig.
	const groesse = SVGX_VIEWBOX_SIZE / Math.max(1, Number(sizePx) || SVGX_DEFAULT_SIZE_PX);
	const k = SVGX_VIEWBOX_SIZE - groesse;
	const ecken = [[0, 0], [k, 0], [0, k], [k, k]];
	const stuecke = [svgxGroupOpen({
		name: "Passmarken", id: ebeneId ? `${ebeneId}-passmarken` : "passmarken", dialect: dialect,
		attrs: { fill: SVGX_REGMARK_COLOR, stroke: "none" },
	})];
	ecken.forEach(([x, y], i) => {
		const kennung = ebeneId ? `${ebeneId}-passmarke-${i + 1}` : `passmarke-${i + 1}`;
		stuecke.push(`<rect id="${svgxEscapeText(kennung)}" x="${svgxRund(x)}" y="${svgxRund(y)}"`
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
function svgxDocumentOpen(dialect, sizePx, vokabular, stempel) {
	const groesse = Math.max(1, Math.round(Number(sizePx) || SVGX_DEFAULT_SIZE_PX));
	const inkscapeNs = dialect === SVGX_DIALECTS.INKSCAPE
		? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
		: "";
	const avmNs = vokabular ? ` xmlns:avm="${SVGX_NS_AVM}"` : "";
	// 🔴 DER FASSUNGSSTEMPEL. Ohne ihn laesst sich nicht beweisen, dass dieser Vektorabzug
	// und ein danebenliegender Rasterabzug DIESELBE Welt zeigen -- und genau daran ist im
	// Projekt schon einmal etwas gescheitert (zwei Staende gegeneinander, 22 % widerspruechliche
	// Kacheln). Die Revisionen kommen aus den Endpunkten selbst, nicht aus einer Uhr.
	const st = stempel || {};
	const stempelAttrs = vokabular ? svgxAttrs({
		"avm:kartenfassung": st.mapRevision, "avm:landschaftsfassung": st.ecoRevision,
		"avm:exportiert": st.zeit, "avm:einheit_px": st.einheitPx,
		"avm:geglaettet": st.geglaettet, "avm:flaechen_geglaettet": st.flaechenGeglaettet,
	}) : "";
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<svg xmlns="http://www.w3.org/2000/svg"'
		+ ' xmlns:xlink="http://www.w3.org/1999/xlink"'
		+ inkscapeNs
		+ avmNs
		+ ` viewBox="0 0 ${SVGX_VIEWBOX_SIZE} ${SVGX_VIEWBOX_SIZE}"`
		+ ` width="${groesse}" height="${groesse}"`
		+ stempelAttrs + ">\n"
		// Die Lizenz reist mit: eine SVG geht nach draußen und muss ohne die Website
		// erklären können, woher sie kommt und was erlaubt ist (wie fb763021).
		+ "<metadata>\n"
		+ "  Avesmaps — https://avesmaps.de\n"
		+ "  Nicht-kommerzielles Fanprojekt zu Das Schwarze Auge / Aventurien.\n"
		+ "  Lizenz und Hinweise: https://avesmaps.de/NOTICE.md\n"
		// Das Vokabular macht die Datei SELBSTERKLÄREND: wer sie als semantische Quelle liest,
		// muss weder Avesmaps kennen noch Slugs aus ids parsen. JSON in einem <desc>, weil das
		// überall durchkommt und nichts zeichnet.
		+ (vokabular ? `  <desc id="avm-vokabular">${svgxEscapeText(JSON.stringify(vokabular))}</desc>\n` : "")
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
		const art = svgxWaySubtype(f);
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
				stuecke.push(`<path id="${svgxEscapeText(id)}"`
					+ svgxSem2(o.semantics, o.typen, { kind: "weg", type: art, rolle: "kontur" })
					+ ` d="${svgxPathData(f.geometry.coordinates, zeichnen)}"/>\n`);
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
				+ svgxSem2(o.semantics, o.typen, Object.assign({ kind: "weg", type: art, name: name,
					id: (f.properties && f.properties.public_id) || "",
					// Die GEZEICHNETE Breite in viewBox-Einheiten. Der Renderer der PNG zieht
					// Fluesse mit einem helleren Mantel von rund dreifacher Breite; wer Label
					// und Bild zur Deckung bringen will, braucht die Breite als Zahl und nicht
					// nur die Achse.
					breite: String((SVGX_WAY_WIDTHS[art] || 0.078) * skala),
					// Die Mantelbreite der KARTE (PATH_OUTLINE_WEIGHTS), immer angegeben -- auch
					// wenn hier keine Kontur gezeichnet wird. Ein Verbraucher, der Label und
					// Rasterbild zur Deckung bringen will, braucht sie, denn der Kern allein ist
					// nur ein Drittel des Flusses.
					// 💣 Es ist die Breite der LEAFLET-Karte, NICHT die des Kachel-Renderers. Die
					// Bild-Pipeline hat am 18.08.2026 an zwoelf Flussstellen 8 px gemessen, diese
					// Zahl ergibt 5 px. Zwei Renderer, zwei Breiten -- wer sie gleichsetzt, irrt.
					mantel_breite: String((SVGX_WAY_OUTLINE_WIDTHS[art] || 0.125) * skala),
					kontur_breite: konturFarbe
						? String((SVGX_WAY_OUTLINE_WIDTHS[art] || 0.125) * skala) : "" },
					svgxContextFor(f.geometry, o.context)))
				+ ` d="${svgxPathData(f.geometry.coordinates, zeichnen)}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
			anzahl += 1;
		});
		stuecke.push(svgxGroupClose());

		gruppen[art] = wege.length;
		stuecke.push(svgxGroupClose());
	});
	if (!o.bare) { stuecke.push(svgxGroupClose()); }
	return { parts: stuecke, count: anzahl, layerId: "layer-wege", groups: gruppen };
}

// Die gekruemmte Bahn einer Kraftlinie in GeoJSON-Koordinaten ([x, y]) -- fuer den Abzug.
// ⭐ Rechnet NICHT selbst: dieselbe Regel wie auf der Karte (js/map-features/powerline-topology.js),
// sonst waere der Abzug eine zweite Wahrheit ueber die Form der Linie.
// ⚠️ Wie der Kartenzeichner spannen erster und letzter Punkt die Sehne, alles dazwischen faellt
// weg -- createPowerlineStrandLatLngs tut genau das, und ein Abzug, der mehr zeigt als die Karte,
// waere kein Abzug.
// 🔴 Faellt der geteilte Helfer aus (nicht geladen), kommt die Linie GERADE heraus statt gar nicht:
// ein Abzug ohne Kraftlinien waere der schlechtere Fehler.
// 💣 ZWEI LADEWEGE, und der zweite ist beim Bau fast durchgerutscht. Im Browser teilen sich beide
// Dateien den globalen Raum; unter NODE wird diese Datei allein `require`t (der naechtliche
// Abzug-Laeufer, tools/svg-export/abzug-bauen.js), und dort gibt es keinen globalen Helfer.
// Gemessen am 29.08.2026: der Node-Weg lieferte die Kraftlinien STILL gerade -- der Routine-Abzug
// haette nie eine Kurve gezeigt, und niemand haette es bemerkt.
// 🔴 KEIN stiller Rueckfall auf „gerade": das ist genau die Ausfallart, die diese Luecke so lange
// unsichtbar gemacht haette. Fehlt der Helfer, wird laut geworfen.
// ⚠️ Nachgeschlagen wird bei JEDEM Aufruf, nicht einmal beim Laden -- sonst haelt diese Datei eine
// Fassung fest, und ein Test, der die geteilte ersetzt, misst weiter die alte.
function svgxPowerlineCurveHelfer() {
	if (typeof avesmapsPowerlineCurvedPoints === "function" && typeof avesmapsPowerlineCurveSteps === "function") {
		return { punkte: avesmapsPowerlineCurvedPoints, schritte: avesmapsPowerlineCurveSteps };
	}
	if (typeof require === "function") {
		const geteilt = require("../map-features/powerline-topology.js");
		if (typeof geteilt.avesmapsPowerlineCurvedPoints === "function") {
			return { punkte: geteilt.avesmapsPowerlineCurvedPoints, schritte: geteilt.avesmapsPowerlineCurveSteps };
		}
	}
	throw new Error("js/map-features/powerline-topology.js fehlt -- ohne sie kann der Abzug die "
		+ "Kurvenform der Kraftlinien nicht zeichnen.");
}

function svgxPowerlineCurvedCoordinates(coordinates, curve) {
	const roh = Array.isArray(coordinates) ? coordinates : [];
	if (!curve || roh.length < 2) {
		return roh;
	}
	const helfer = svgxPowerlineCurveHelfer();
	const a = roh[0];
	const b = roh[roh.length - 1];
	return helfer.punkte(a[0], a[1], b[0], b[1], curve, helfer.schritte(curve, 8))
		.map((punkt) => [punkt.x, punkt.y]);
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
			+ svgxSem2(o.semantics, o.typen, Object.assign({ kind: "kraftlinie", name: name,
			id: (f.properties && f.properties.public_id) || "" },
			svgxContextFor(f.geometry, o.context)))
			+ ` d="${svgxPathData(svgxPowerlineCurvedCoordinates(f.geometry.coordinates, Number(f.properties.curve) || 0))}">`
			+ `<title>${svgxEscapeText(name)}</title></path>\n`);
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: linien.length, layerId: "layer-kraftlinien", groups: {} };
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
			stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
				+ svgxSem2(o.semantics, o.typen, Object.assign({ kind: o.semKind || "flaeche", type: schluessel,
					id: svgxProps(f).public_id || "",
					ebene: svgxProps(f).kind, name: name }, svgxContextFor(f.geometry, o.context, o.kombi, schluessel)))
				+ ` d="${d}">`
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
	return { parts: stuecke, count: anzahl, layerId: o.layerId, groups: zaehler };
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
		const kind = kinds.find((k) => k.slug === slug) || { slug: slug, label: slug || "Ort", r: SVGX_PLACE_FALLBACK_R };
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
				+ svgxSem2(o.semantics, o.typen, Object.assign({ kind: "ort", type: slug, name: name,
					id: f.properties.public_id || "",
					// ⚠️ DARSTELLUNGSradius, keine Stadtausdehnung. Avesmaps speichert Orte als
					// Punkte; diese Zahl sagt, wie gross der Punkt gezeichnet wird.
					radius: String(kind.r || SVGX_PLACE_FALLBACK_R) },
				svgxContextFor(f.geometry, o.context)))
				+ ` cx="${p.x}" cy="${p.y}" r="${kind.r || SVGX_PLACE_FALLBACK_R}">`
				+ `<title>${svgxEscapeText(name)}</title></circle>\n`);
			anzahl += 1;
		});
		gruppen[kind.label || slug] = orte.length;
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return { parts: stuecke, count: anzahl, layerId: "layer-orte", groups: gruppen };
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
	return { parts: stuecke, count: anzahl, layerId: "layer-beschriftungen", groups: {} };
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
	// 🔴 Der Kopf wird ZULETZT gesetzt: das Vokabular kennt erst, wer die Ebenen gebaut hat.
	const koerper = [];
	const kontext = o.semantics ? svgxBuildContextIndex(o.ecosystems, o.mapFeatures) : null;
	const semAn = o.semantics === true;

	// 🔴 DIE MATRIX ENTSTEHT BEIM EXPORT, sie wird nirgends abgeschrieben.
	// Owner 16.08.2026: „die editoren ändern ständig was, es wird nicht bei 37 bleiben."
	// Eine Matrix in einer Datei wäre am nächsten Tag falsch, ohne dass es jemandem auffällt.
	// Also zählt der Bauer die Kombinationen mit, während er sie ohnehin ausrechnet -- Kosten:
	// eine Zeile je Element, kein zweiter Durchgang, keine zweite Wahrheit.
	const kombi = new Map();
	const typenGesehen = new Map();
	const stats = {};

	const detail = [];
	const parts = koerper;
	const nimm = (name, ergebnis) => {
		stats[name] = ergebnis.count;
		// Die Passmarken kommen INNEN, kurz vor dem Schließen der Ebene -- außen läge
		// eine Ebene neben der Ebene, und genau die würde beim Rastern nicht mitkommen.
		// ⚠️ Setzt voraus, dass das letzte Stück jeder Ebene ihr eigenes </g> ist. Das gilt
		// für alle Ebenenbauer hier; ein neuer, der anders endet, bräche es lautlos.
		if (o.registrationMarks) {
			const marken = svgxRegistrationMarks(dialect, o.sizePx, ergebnis.layerId);
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
			// 💣 DER BACH GEHÖRT HIER MIT HINEIN. Er ist ein Flussweg mit Häkchen -- fiele er
			// aus dieser Liste, wäre er die einzige Gewässerlinie, die ÜBER dem See läuft.
			only: ["Flussweg", "Bach"], bare: true, semantics: semAn, context: kontext, typen: typenGesehen,
		});
		flussTeile = fl.parts;
		// Jede Art mit ihrer eigenen Zahl -- eine Summe „Flusswege" verschwiege die Bäche.
		Object.entries(fl.groups || {}).forEach(([art, anzahl]) => {
			if (!anzahl) { return; }
			detail.push({ layer: "Landschaften", group: art === "Bach" ? "Bäche" : "Flusswege", count: anzahl });
		});
	}

	// Reihenfolge = Zeichenreihenfolge. In SVG liegt das Erste unten.
	// ⚠️ Es gibt KEINE Ebene "Regionen": im Payload existiert kein feature_type 'region'
	// (gemessen 14.08.2026 an 11.810 Features -- location, crossing, path, junction, label,
	// powerline). Die Flächen, die man dafür hielte, sind die Landschaften-Ebene.
	if (an.landschaften !== false) {
		nimm("Landschaften", svgxAreaLayer({ semantics: semAn, context: kontext, semKind: "landschaft", kombi: kombi, typen: typenGesehen,
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
		nimm("Herrschaftsgebiete", svgxAreaLayer({ semantics: semAn, context: kontext, semKind: "herrschaftsgebiet", typen: typenGesehen,
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
		// 💣 Und der Bach ist einer von ihnen: die beiden Listen -- hier und `only` oben --
		// müssen dieselben Arten nennen, sonst fehlt er entweder oder steht doppelt.
		const wegeAus = fluesseUnten
			? Object.assign({}, (o.subgroups || {}).wege, { Flussweg: false, Bach: false })
			: (o.subgroups || {}).wege;
		nimm("Wege", svgxWayLayer({ semantics: semAn, context: kontext, typen: typenGesehen, features: o.mapFeatures, dialect: dialect, seen: seen,
			wayIds: wayIds, enabled: wegeAus, strokeScale: o.strokeScale,
			colors: o.wayColors, outlines: o.wayOutlines, smooth: o.smooth, tension: o.tension }));
	}
	if (an.kraftlinien !== false) {
		nimm("Kraftlinien", svgxPowerlineLayer({ semantics: semAn, context: kontext, typen: typenGesehen, features: o.mapFeatures, dialect: dialect, seen: seen,
			strokeScale: o.strokeScale, color: o.powerlineColor, smooth: o.smooth, tension: o.tension }));
	}
	if (an.orte !== false) {
		nimm("Orte", svgxPlaceLayer({ semantics: semAn, context: kontext, typen: typenGesehen, features: o.mapFeatures, kinds: o.placeKinds, dialect: dialect,
			seen: seen, enabled: (o.subgroups || {}).orte, colors: o.placeColors }));
	}
	if (an.beschriftungen !== false) {
		nimm("Beschriftungen", svgxLabelLayer({
			features: o.mapFeatures, wayIds: wayIds, dialect: dialect, seen: seen, color: o.labelColor,
		}));
	}

	koerper.push(svgxDocumentClose());

	// Das Vokabular führt NUR, was wirklich in der Datei steht -- eine Liste aller
	// denkbaren Typen wäre eine Behauptung über eine Datei, die es nicht gibt.
	let vokabular = null;
	if (semAn) {
		const typen = {};
		typenGesehen.forEach((anzahl, schluessel) => {
			const v = SVGX_TYPE_VOCAB[schluessel];
			// ⚠️ Ein Typ ohne Eintrag wird TROTZDEM geführt -- mit dem rohen Schlüssel und dem
			// Vermerk, dass er unbeschrieben ist. Ihn wegzulassen hieße, eine Vokabel zu benutzen
			// und zu verschweigen; live betrifft das die Datenleiche `crossing`.
			typen[schluessel] = v
				? { de: v.de, en: v.en, anzahl: anzahl }
				: { de: schluessel, en: "", anzahl: anzahl, unbeschrieben: true };
		});
		// Die Klimabänder als y-Bereiche, in SVG-y (nach unten wachsend) wie alles hier.
		// 💣 DAS SIND HÜLLBOXEN, KEINE SCHNITTE -- und sie ÜBERLAPPEN SICH kräftig
		// (gemessen 18.08.2026: polar 0…141, subpolar 102…290, boreal 145…408). Die
		// Trennlinien der Karte dürfen zurücklaufen, also ist ein Band kein Streifen mit
		// zwei Kanten. Wer allein aus y auf die Zone schließt, ordnet im Überlappungsbereich
		// falsch ein.
		// ⭐ Sie taugen als VORFILTER. Für die exakte Einordnung liegen die Bandpolygone
		// selbst in der Datei (Ebene Landschaften, avm:ebene="klima") -- der Verbraucher
		// kann punktgenau verschneiden, ohne etwas nachzubauen.
		const baender = (kontext && kontext.klima ? kontext.klima : []).map((e) => ({
			typ: e.typ,
			y_von: Math.round((SVGX_VIEWBOX_SIZE - e.maxY) * 100) / 100,
			y_bis: Math.round((SVGX_VIEWBOX_SIZE - e.minY) * 100) / 100,
		})).sort((a, b) => a.y_von - b.y_von);

		vokabular = {
			hinweis: "avm:kind/type/klima/relief an jedem Element. Nur Fakten, keine Deutung.",
			quelle: "https://avesmaps.de",
			felder: { kind: "Objektart", type: "Gelaende- bzw. Wegart", klima: "Klimazone am Ort",
				relief: "Relief am Ort", ebene: "Landschaftsebene", name: "Eigenname" },
			typen: typen,
			klimabaender_hinweis: "Huellboxen, ueberlappend -- Vorfilter. Exakt: die Bandpolygone in der Ebene Landschaften (avm:ebene=klima).",
			klimabaender: baender,
			// 🔴 Zusicherung: die Malreihenfolge IST die Dokumentordnung. Was später im
			// Dokument steht, liegt oben -- so wie SVG es ohnehin vorschreibt. Es gibt
			// keine z-Angabe und keine Sortierung, die das überstimmt.
			reihenfolge: "Dokumentordnung: was spaeter steht, liegt oben.",
			// Die tatsächlich vorkommenden Kombinationen aus DIESEM Export, absteigend.
			// Wer die Datei liest, sieht damit ohne Vorwissen, welche Fälle es gibt --
			// und beim nächsten Export stehen die aktuellen darin.
			kombinationen: [...kombi.entries()]
				.map(([k, w]) => {
					const [typ, relief, klima, hoehe] = k.split("|");
					return { typ: typ, relief: relief === "-" ? "" : relief,
						klima: klima === "-" ? "" : klima,
						gipfelhoehe: hoehe === "-" ? "" : Number(hoehe),
						anzahl: w.anzahl, flaeche: Math.round(w.flaeche * 100) / 100 };
				})
				// Nach FLÄCHE sortiert, nicht nach Anzahl -- was gross ist, praegt das Bild.
				.sort((a, b) => b.flaeche - a.flaeche),
		};
	}

	const stempel = {
		mapRevision: o.mapFeatures && (o.mapFeatures.revision || (o.mapFeatures.data || {}).revision),
		ecoRevision: o.ecoRevision,
		zeit: o.exportedAt,
		einheitPx: String(Math.round(((Number(o.sizePx) || SVGX_DEFAULT_SIZE_PX) / SVGX_VIEWBOX_SIZE) * 1000) / 1000),
		geglaettet: o.smooth ? "ja" : "nein",
		flaechenGeglaettet: o.smoothAreas ? "ja" : "nein",
	};

	return { parts: [svgxDocumentOpen(dialect, o.sizePx, vokabular, stempel)].concat(koerper),
		stats: stats, detail: detail };
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
		// Die Seite holt die Zoombänder und reicht das Ergebnis als `placeKinds` in build()
		// zurück -- so bleibt dieser Bauer ohne fetch und ohne DOM.
		placeKindsFromBands: svgxPlaceKindsFromBands,
		WAY_COLORS: SVGX_WAY_COLORS,
		WAY_SUBTYPES: SVGX_WAY_SUBTYPES,
		ABZUG_EINSTELLUNGEN: SVGX_ABZUG_EINSTELLUNGEN,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SVGX_VIEWBOX_SIZE: SVGX_VIEWBOX_SIZE,
		SVGX_DIALECTS: SVGX_DIALECTS,
		SVGX_WAY_SUBTYPES: SVGX_WAY_SUBTYPES,
		SVGX_ABZUG_EINSTELLUNGEN: SVGX_ABZUG_EINSTELLUNGEN,
		SVGX_WAY_COLORS: SVGX_WAY_COLORS,
		SVGX_WAY_WIDTHS: SVGX_WAY_WIDTHS,
		SVGX_BOUNDARY_WIDTH: SVGX_BOUNDARY_WIDTH,
		SVGX_PLACE_KINDS: SVGX_PLACE_KINDS,
		SVGX_PLACE_COLOR: SVGX_PLACE_COLOR,
		SVGX_PLACE_SIZE_ZOOM: SVGX_PLACE_SIZE_ZOOM,
		SVGX_PLACE_FALLBACK_R: SVGX_PLACE_FALLBACK_R,
		svgxPlaceRadiusFromDiameter: svgxPlaceRadiusFromDiameter,
		svgxPlaceKindsFromBands: svgxPlaceKindsFromBands,
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
		SVGX_BACH_FAKTOR: SVGX_BACH_FAKTOR,
		svgxPolygonData: svgxPolygonData,
		svgxSmoothRingData: svgxSmoothRingData,
		svgxRegistrationMarks: svgxRegistrationMarks,
		svgxBuildContextIndex: svgxBuildContextIndex,
		svgxPeaks: svgxPeaks,
		svgxContextFor: svgxContextFor,
		svgxPointInPolygon: svgxPointInPolygon,
		svgxRepPoint: svgxRepPoint,
		SVGX_TYPE_VOCAB: SVGX_TYPE_VOCAB,
		SVGX_RELIEF_TYPES: SVGX_RELIEF_TYPES,
		SVGX_REGMARK_COLOR: SVGX_REGMARK_COLOR,
		svgxAsFeatures: svgxAsFeatures,
		svgxProps: svgxProps,
		svgxNameOf: svgxNameOf,
		svgxSubgroupEnabled: svgxSubgroupEnabled,
		svgxWaySubtype: svgxWaySubtype,
		svgxWayLayer: svgxWayLayer,
		svgxPowerlineLayer: svgxPowerlineLayer,
		svgxAreaLayer: svgxAreaLayer,
		svgxPlaceLayer: svgxPlaceLayer,
		svgxLabelLayer: svgxLabelLayer,
		svgxBuildDocument: svgxBuildDocument,
	};
}
