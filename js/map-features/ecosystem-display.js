// Die Darstellungstafel der Landschaften: Ton und Deckkraft der Flaechen, Farbe, Schriftgroesse
// und Zoomband der Namen. Entwurf: docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE DER ZAHLEN-VORGABEN. Der Server kennt sie nicht -- er
// speichert nur die Uebersteuerung und gibt sie zurueck. Laege dieselbe Tafel auch dort, gaebe es
// sie zweimal und sie liefen auseinander. Dieselbe Arbeitsteilung wie bei den Zoombaendern
// (js/map-features/location-zoom-bands.js).
//
// 🔴 UND SIE ENTHAELT KEINE FARBE. Die rund 20 Namenstoene stehen in css/features/map-labels.css,
// die 33 Flaechentoene in css/base/tokens.css -- der Aufrufer liest den Token und reicht ihn
// herein; dieses Modul entscheidet nur, ob eine Uebersteuerung ihn schlaegt. Eine Farbe zweimal
// aufzuschreiben ist Divergenz mit Anlauf (AGENTS.md §12).
//
// Geladen von index.html (die Karte, VOR map-features-labels.js) UND von
// html/landschaften-editor.html (das Fenster, das die Tafel anzeigt und schreibt).

// ---- Die Deckkraft je EBENE ------------------------------------------------------------------
// 🔴 ZIFFER FUER ZIFFER aus css/features/ecosystem-layer.css, Stand 24.08.2026. Sie ist NICHT eine
// Zahl fuer alle: ein derographischer Behaelter steht bei 0,16, weil er ein Behaelter ist und die
// Karte darunter tragen soll; Vegetation und Topographie bei 0,72 (Owner 2026-08-04: „die Farben
// kraeftiger"), die Klimabaender bei 0,30.
// 💣 Wer daraus eine einzige Zahl macht, zieht die vier zusammen -- und drei der vier Aussagen sind
// dann falsch.
const AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT = {
	derographisch: 0.16,
	vegetation: 0.72,
	topographie: 0.72,
	klima: 0.30,
};

// ---- Die Schriftgroesse ----------------------------------------------------------------------
// 🔴 GERECHNET, NICHT ABGESCHRIEBEN: dieselbe Formel wie getScaledLabelSize in
// map-features-labels.js, mit der Grundgroesse 18 aus index.html.
//   zoomRatio   = min(1, z / 5)                    VISUAL_MAX_ZOOM_LEVEL
//   ueberVisual = clamp(z - 5, 0, 2)               seit 23.08.2026, „nach unten hin groesser"
//   groesse     = round(18 * (0.5 + zoomRatio*0.5) * (1 + ueberVisual*0.08))
//
// ⚠️ DIE EINE STELLE, an der die Zoombaender-Regel „die Vorgabe reproduziert das heutige Bild
// Ziffer fuer Ziffer" nicht ganz gelten kann: heute traegt JEDES Label seine eigene Grundgroesse
// (12-50). Es gibt keine Kurve je Art, die man abschreiben koennte. Jedes Label, das nicht auf 18
// steht, aendert beim Ausliefern sichtbar seine Groesse -- der Preis dafuer, dass die Groesse
// global wird (Entwurf §5.5).
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_BASIS = 18;
const AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX = 5;
const AVESMAPS_ECOSYSTEM_DISPLAY_TIEF_SCHRITT = 0.08;
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS = { min: 4, max: 30 };

// ---- Die Vorgaben je Art ----------------------------------------------------------------------
// 🔴 NICHT BINDEND (Entwurf §6). Der Editor stellt weiter jedes Label einzeln; diese vier Werte
// erscheinen bei ihm nur als MARKE auf dem Reglerbalken. Die Zahlen sind die heutigen Vorgaben aus
// index.html (min_zoom 0, max_zoom 7, curve_label_max 1, priority 3).
// ⚠️ Bewusst UNIFORM ueber alle Arten: eine Staffelung je Art hat nie jemand entschieden, und eine
// geratene Vorgabe saehe aus wie eine getroffene.
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE = { ab: 0, bis: 7, curveMax: 1, prio: 3 };

// 🔴 Die Karte kennt Stufe 8 nicht (maxZoom: 7 in js/app/bootstrap.js). z8 erbt z7 -- dieselbe
// Regel wie bei den Zoombaendern.
const AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX = 7;

// Die geladene Uebersteuerung. Leer heisst: die Vorgabe gilt.
let _avesmapsEcosystemDisplayUeber = {};

/**
 * Die geladene Tafel ablegen. ⚠️ Alles, was keine Tafel ist (null, ein String, kaputtes JSON),
 * gilt als „nichts uebersteuert" -- die Karte darf an einem kaputten Einstellungswert nicht
 * haengenbleiben.
 */
function avesmapsEcosystemDisplayInstall(stored) {
	_avesmapsEcosystemDisplayUeber = (stored && typeof stored === "object" && !Array.isArray(stored))
		? stored
		: {};
}

/** Ein Abschnitt der Tafel, immer als Objekt. */
function avesmapsEcosystemDisplayTeil(name) {
	const teil = _avesmapsEcosystemDisplayUeber[name];
	return (teil && typeof teil === "object" && !Array.isArray(teil)) ? teil : {};
}

/** Der Schluessel einer Flaechenart: Ebene UND Art, weil `insel` in zweien vorkommt. */
function avesmapsEcosystemDisplayFlaechenKey(kind, typeKey) {
	return String(kind || "") + ":" + String(typeKey || "");
}

/**
 * Der Ton einer FLAECHE. `tokenTon` ist die Vorgabe, die der Aufrufer aus tokens.css gelesen hat --
 * dieses Modul kennt keine Farbe.
 */
function avesmapsEcosystemDisplayFlaechenTon(kind, typeKey, tokenTon) {
	const eigen = avesmapsEcosystemDisplayTeil("flaeche")[avesmapsEcosystemDisplayFlaechenKey(kind, typeKey)];
	return typeof eigen === "string" && eigen !== "" ? eigen : tokenTon;
}

/**
 * Der Ton eines NAMENS. `tokenTon` kommt aus der CSS-Sonde in getMapLabelTypeStyle.
 * 🔴 Eine Farbe je ART, nicht je Zoomstufe (Owner 23.08.2026: „die farben bleiben gleich").
 */
function avesmapsEcosystemDisplayFarbe(subtype, tokenTon) {
	const eigen = avesmapsEcosystemDisplayTeil("farbe")[String(subtype || "")];
	return typeof eigen === "string" && eigen !== "" ? eigen : tokenTon;
}

/**
 * Die Deckkraft, die WIRKT.
 *
 * 💣 Der globale Wert einer Ebene ueberschreibt den Zeilenwert, er LOESCHT ihn nicht. Ein Haekchen
 * ist keine Datenaenderung -- wer es abnimmt, bekommt seine Arbeit zurueck (Entwurf §5.2).
 * 🔴 „Global" heisst FUER DIESE EBENE, nie fuer alle vier.
 */
function avesmapsEcosystemDisplayDeckkraft(kind, typeKey) {
	const global = avesmapsEcosystemDisplayTeil("global")[String(kind || "")];
	if (global && global.an === true && typeof global.wert === "number") {
		return global.wert;
	}
	const eigen = avesmapsEcosystemDisplayTeil("deckkraft")[avesmapsEcosystemDisplayFlaechenKey(kind, typeKey)];
	if (typeof eigen === "number") {
		return eigen;
	}
	const vorgabe = AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT[String(kind || "")];
	return typeof vorgabe === "number" ? vorgabe : 0.72;
}

/** Die Vorgabegroesse auf einer Zoomstufe -- die echte Formel bei Grundgroesse 18. */
function avesmapsEcosystemDisplayVorgabeGroesse(zoom) {
	const z = Math.max(0, Number(zoom) || 0);
	const ratio = Math.max(0, Math.min(1, z / AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX));
	const ueber = Math.max(0, Math.min(2, z - AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX));
	return Math.round(
		AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_BASIS
		* (0.5 + ratio * 0.5)
		* (1 + ueber * AVESMAPS_ECOSYSTEM_DISPLAY_TIEF_SCHRITT)
	);
}

/**
 * Die Schriftgroesse einer Art auf einer Zoomstufe, in pt.
 * ⚠️ Eine Zeile mit einer LUECKE an dieser Stufe faellt fuer diese Stufe auf die Vorgabe zurueck --
 * nicht die ganze Zeile. „nichts gespeichert" und „hier steht null" sind verschiedene Aussagen.
 */
function avesmapsEcosystemDisplayGroesse(subtype, zoom) {
	const zeile = avesmapsEcosystemDisplayTeil("groesse")[String(subtype || "")];
	const z = Math.max(0, Math.round(Number(zoom) || 0));
	if (Array.isArray(zeile)) {
		const wert = zeile[z];
		if (typeof wert === "number"
			&& wert >= AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS.min
			&& wert <= AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS.max) {
			return wert;
		}
	}
	return avesmapsEcosystemDisplayVorgabeGroesse(z);
}

/**
 * Die vier Vorgaben einer Art: Zoomband, max. Namen, Prioritaet.
 * 🔴 Sie sind eine EMPFEHLUNG, kein Riegel -- der Editor darf abweichen und sieht nur die Marke.
 */
function avesmapsEcosystemDisplayVorgabe(subtype) {
	const eigen = avesmapsEcosystemDisplayTeil("vorgabe")[String(subtype || "")];
	const raus = {};
	Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE).forEach((feld) => {
		const wert = eigen && typeof eigen[feld] === "number" ? eigen[feld] : AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE[feld];
		raus[feld] = wert;
	});
	return raus;
}

/** Nur die zwei Enden des Zoombands. */
function avesmapsEcosystemDisplayBand(subtype) {
	const v = avesmapsEcosystemDisplayVorgabe(subtype);
	return { ab: v.ab, bis: v.bis };
}

/**
 * Traegt diese Art auf dieser Zoomstufe einen Namen?
 *
 * 🔴 z8 faellt auf z7 zurueck -- die Karte kommt dort nie hin, und ohne den Rueckfall waere die
 * letzte Spalte jeder Tafel per Bauart leer.
 * 💣 „aus" ist als bis < ab kodiert und ergibt hier auf JEDER Stufe false -- ein eigener Schalter
 * daneben waere eine dritte Wahrheit ueber dieselbe Sache (Entwurf §5.3).
 */
function avesmapsEcosystemDisplaySichtbar(subtype, zoom) {
	const b = avesmapsEcosystemDisplayBand(subtype);
	const z = Math.min(Math.max(0, Math.round(Number(zoom) || 0)), AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX);
	return z >= b.ab && z <= b.bis;
}

const AVESMAPS_ECOSYSTEM_DISPLAY_ENDPOINT = "api/app/ecosystem-display.php";

/**
 * Die Tafel holen und einsetzen. Liefert true, wenn danach etwas anderes gilt als die Vorgabe.
 *
 * ⚠️ Wird NICHT beim Laden dieser Datei gerufen -- der Landschaften-Editor laedt sie ebenfalls und
 * holt seine Werte ueber seinen eigenen, angemeldeten Endpunkt; ein Aufruf hier loeste dort eine
 * zweite, nutzlose Anfrage aus. Der Aufruf steht in js/config.js. Dieselbe Arbeitsteilung wie bei
 * avesmapsLoadLocationZoomBands.
 *
 * 🔴 FAELLT STILL AUS: kein Netz, kein Endpunkt, kaputte Antwort -> die Vorgaben bleiben, und die
 * Karte zeichnet wie bisher. Ein Ausfall hier darf sie nicht aufhalten.
 */
function avesmapsLoadEcosystemDisplay() {
	return fetch(AVESMAPS_ECOSYSTEM_DISPLAY_ENDPOINT, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((payload) => {
			if (!payload || payload.ok !== true || !payload.display) {
				return false;
			}
			avesmapsEcosystemDisplayInstall(payload.display);
			return true;
		})
		.catch(() => false);
}

// ⚠️ NUR FUER DIE NODE-TESTS. Im Browser teilen klassische <script>-Bausteine ihre obersten `const`
// ueber die globale lexikalische Umgebung; `vm.runInThisContext` tut das NICHT -- dieselbe
// Begruendung wie in location-zoom-bands.js.
if (typeof globalThis !== "undefined") {
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT = AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX = AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX;
}
