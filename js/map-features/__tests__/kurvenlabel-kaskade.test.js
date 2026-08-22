// Aufgabe 6: die Einreihung des Kurvenlabels in die Beschriftungsordnung -- und das Verschwinden
// des alten Marker-Labels.
//
// 🔴 Jede Zusicherung hier RUFT etwas und prueft ein Ergebnis. Wo das nicht geht (die Stellung des
// Riegels innerhalb von shouldShowLabelMarker), steht es ausdruecklich als Quelltext-Zusicherung da
// und ist als solche benannt -- nicht als Verhaltensprobe getarnt.
//
// Drei Stuecke, drei Abschnitte:
//   1. Kanal C im Overlay          -- Rechnung, Kaesten, Ausweichen, Ablage, Ansichts-Stempel
//   2. map-features-labels.js      -- der Riegel und die Ausnahme, die die Rueckkopplung bricht
//   3. map-features-label-collisions.js -- die Reihenfolge der Kaskade
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/kurvenlabel-kaskade.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const hier = (n) => path.join(__dirname, "..", n);
// Die drei reinen Module echt laden -- geprueft wird gegen die WIRKLICHE Passung, das WIRKLICHE
// Setzen der Glyphen und die WIRKLICHE Belegungskarte, nicht gegen Attrappen davon.
vm.runInThisContext(fs.readFileSync(hier("curved-label-layout.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(hier("curve-label-fit.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(hier("map-features-label-occupancy.js"), "utf8"));

const nahe = (a, b, was, toleranz = 1e-6) => assert.ok(Math.abs(a - b) <= toleranz, `${was}: ${a} statt ${b}`);

// =================================================================================================
// 1. Kanal C -- die Rechnung im Overlay
// =================================================================================================
// Die IIFE des Overlays laesst sich nicht laden (sie fasst beim Laden map/L/document an). Geschnitten
// wird deshalb das Stueck von kurvenlabelFont bis vor redraw() -- genau der Kanal C. Was darin frei
// steht, kommt entweder als Parameter herein (die Karte, der Canvas, der Label-Stil) oder aus den
// drei oben geladenen Modulen.
const overlayQuelle = fs.readFileSync(hier("map-features-path-label-canvas-overlay.js"), "utf8");
const kanalVon = overlayQuelle.indexOf("function kurvenlabelFont(");
const kanalBis = overlayQuelle.indexOf("function redraw()");
assert.ok(kanalVon > 0 && kanalBis > kanalVon, "Kanal C steht zwischen kurvenlabelFont und redraw");
const kanalC = overlayQuelle.slice(kanalVon, kanalBis);

// `passungsStub` ist normalerweise leer -- dann rechnet die ECHTE Passung aus curve-label-fit.js.
// Sie wird nur dort untergeschoben, wo eine Lage geprueft wird, die die echte Passung gar nicht
// erzeugen kann (siehe 1g).
function baueKanalC(stempel, kandidatenListe, passungsStub) {
	const gemessen = { kandidatenAufrufe: 0, gemalt: [] };
	const map = {
		getZoom: () => stempel.zoom,
		containerPointToLatLng: () => ({
			lat: stempel.lat,
			lng: stempel.lng,
			equals(anderer) { return Boolean(anderer) && anderer.lat === this.lat && anderer.lng === this.lng; },
		}),
		// x = lng, y = lat -- der Tausch, den die Karte macht; hier ohne Projektion, damit die
		// Pruefzahlen von Hand nachvollziehbar bleiben.
		latLngToContainerPoint: (ll) => ({ x: ll.lng, y: ll.lat }),
	};
	const L = { latLng: (lat, lng) => ({ lat, lng }) };
	const ctx = { font: "", measureText: () => ({ width: 8 }) };
	const fenster = {};
	const api = new Function(
		"window", "map", "L", "ctx", "paintGlyphs", "getMapLabelTypeStyle", "getScaledLabelSize",
		"getLabelHaloParams", "REGION_LABEL_HALO_STRENGTH", "REGION_LABEL_HALO_SHARPNESS",
		"avesmapsKurvenlabelKandidaten", "avesmapsLocationLabelSpacing", "avesmapsCurveLabelFit",
		kanalC + "; return { berechneKurvenlabels, zeichneKurvenlabels, platziereKurvenfenster, kurvenlabelKaesten };"
	)(
		fenster, map, L, ctx,
		(glyphs, chars) => { gemessen.gemalt.push({ glyphs, chars }); },
		() => ({ fontFamily: "serif", fontWeight: "400", fontStyle: "", color: "#4a3728", uppercase: false }),
		() => 12,
		() => ({ glow: null }),
		2, 2,
		() => { gemessen.kandidatenAufrufe += 1; return kandidatenListe(); },
		(schluessel) => (schluessel === "repel" ? 2 : 0),
		passungsStub || avesmapsCurveLabelFit
	);
	return { api, fenster, gemessen, ctx };
}

// Eine waagerechte Kurve, 600 px lang: [lat, lng] -> {x: lng, y: lat}.
const waagerecht = () => ({ text: "DRACHENSTEINE", labelType: "gebirge", curveMax: 1, curveLine: [[100, 0], [100, 600]] });
// Dieselbe Laenge unter 45° -- fuer die Frage „mehrere Kaesten oder eine Huelle".
const schraeg = () => ({ text: "DRACHENSTEINE", labelType: "gebirge", curveMax: 1, curveLine: [[0, 0], [600, 600]] });

// --- 1a) Die Vorbelegung kommt in VIEWPORT-Koordinaten heraus ------------------------------------
// 💣 Die wahrscheinlichste Falle dieser Aufgabe (Bauplan, Schritt 1): gerechnet wird in
// CONTAINER-Pixeln, resolveLabelCollisions vergleicht in VIEWPORT-Pixeln. Der Container-Ursprung
// muss also ADDIERT werden -- publishLabelOccupancy zieht ihn hinterher wieder ab.
{
	const label = waagerecht();
	const { api, fenster } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	api.berechneKurvenlabels();
	const ohne = fenster.avesmapsKurvenlabelPlatzierungen({ left: 0, top: 0 });
	const mit = fenster.avesmapsKurvenlabelPlatzierungen({ left: 40, top: 25 });
	assert.ok(ohne.length > 0, "die waagerechte Kurve liefert ueberhaupt Rechtecke");
	assert.strictEqual(mit.length, ohne.length, "derselbe Bestand, nur verschoben");
	for (let i = 0; i < ohne.length; i += 1) {
		nahe(mit[i].left - ohne[i].left, 40, `Kasten ${i}: links`);
		nahe(mit[i].right - ohne[i].right, 40, `Kasten ${i}: rechts`);
		nahe(mit[i].top - ohne[i].top, 25, `Kasten ${i}: oben`);
		nahe(mit[i].bottom - ohne[i].bottom, 25, `Kasten ${i}: unten`);
		// Die Form darf sich dabei nicht aendern -- und width/height muessen zur Box passen
		// (avesmapsResolveLabelPlacements verwirft ein Rechteck mit width <= 0 stillschweigend).
		nahe(mit[i].width, mit[i].right - mit[i].left, `Kasten ${i}: Breite`);
		nahe(mit[i].height, mit[i].bottom - mit[i].top, `Kasten ${i}: Hoehe`);
		assert.ok(mit[i].width > 0 && mit[i].height > 0, `Kasten ${i} hat eine Flaeche`);
	}
	// Ohne Ursprung darf nichts anderes herauskommen als mit {left: 0, top: 0}.
	const nichts = fenster.avesmapsKurvenlabelPlatzierungen(null);
	assert.deepStrictEqual(nichts, ohne, "fehlender Ursprung == Ursprung (0, 0), kein NaN");
	assert.ok(ohne.every((r) => Number.isFinite(r.left) && Number.isFinite(r.top)), "keine NaN-Kaesten");
}

// --- 1b) MEHRERE kleine Kaesten entlang der Grundlinie, nicht eine Huellbox -----------------------
// Entwurf §7.2 Punkt 1. Bei einem schraeg laufenden Namen ist der Unterschied messbar: die Summe der
// Kastenflaechen bleibt deutlich unter der Flaeche ihrer gemeinsamen Huelle.
{
	const label = schraeg();
	const { api, fenster } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	const ablage = api.berechneKurvenlabels();
	const glyphs = ablage.eintraege[0].fenster[0].glyphs;
	const kaesten = fenster.avesmapsKurvenlabelPlatzierungen({ left: 0, top: 0 });
	assert.strictEqual(kaesten.length, glyphs.length, "ein Kasten JE BUCHSTABE, nicht einer fuer alles");
	assert.ok(glyphs.length >= 10, "und der Name hat mehr als zehn Buchstaben (sonst sagt der Vergleich nichts)");
	const summe = kaesten.reduce((s, k) => s + (k.right - k.left) * (k.bottom - k.top), 0);
	const huelle = kaesten.reduce((h, k) => ({
		left: Math.min(h.left, k.left), top: Math.min(h.top, k.top),
		right: Math.max(h.right, k.right), bottom: Math.max(h.bottom, k.bottom),
	}), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
	const huellFlaeche = (huelle.right - huelle.left) * (huelle.bottom - huelle.top);
	assert.ok(summe < huellFlaeche * 0.75,
		`die Kaesten belegen ${Math.round(summe)} px², ihre gemeinsame Huelle ${Math.round(huellFlaeche)} px² -- `
		+ "eine einzige Huellbox waere die deutlich groebere Aussage");
}

// --- 1c) Der Riegel fragt das ERGEBNIS, nicht die Eingabe -----------------------------------------
// 💣 `Boolean(label.curveLine)` waere falsch: eine gelieferte Kurve heisst nicht, dass gezeichnet
// wurde. Scheitert die Passung, muss der Marker stehenbleiben -- sonst verschwindet der Name GANZ.
{
	// Eine Kurve mit zwei DECKUNGSGLEICHEN Punkten: der Server hat eine geliefert, sie taugt nichts.
	const kaputt = { text: "KOSCHBERGE", labelType: "gebirge", curveMax: 1, curveLine: [[100, 300], [100, 300]] };
	const heil = waagerecht();
	const { api, fenster } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [kaputt, heil]);
	avesmapsLabelOccupancy.reset();
	api.berechneKurvenlabels();
	assert.ok(Array.isArray(kaputt.curveLine) && kaputt.curveLine.length >= 2,
		"Vorbedingung: das kaputte Label TRAEGT eine Kurve -- daran wuerde Boolean(curveLine) haengenbleiben");
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt(kaputt), false,
		"nicht gemalt -> der Marker bleibt stehen");
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt(heil), true,
		"gemalt -> der Marker geht");
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt(null), false, "kein Label -> false, kein Wurf");
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt({ text: "fremd" }), false, "fremdes Objekt -> false");
	// Und das kaputte Label belegt auch keinen Platz.
	const kaesten = fenster.avesmapsKurvenlabelPlatzierungen({ left: 0, top: 0 });
	assert.strictEqual(kaesten.length, Array.from(heil.text).length,
		"nur der gemalte Name belegt -- der gescheiterte belegt nichts");
}

// --- 1d) Ausweichen entlang der eigenen Kurve ------------------------------------------------------
// Entwurf §7.2 Punkt 2: bis zu `dodgePx` (6) entlang der Kurve, in kleinen Schritten.
{
	const label = waagerecht();
	const { api } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	const frei = api.berechneKurvenlabels().eintraege[0].fenster[0].glyphs;
	const x0 = frei[0].x;
	const y0 = frei[0].y;

	// Ein Hindernis, das die erste Glyphe bei Versatz 0 beruehrt und bei +2 nicht mehr: die Glyphe ist
	// 8 px breit, ihre linke Kante liegt bei x0 - 4 (Versatz 0) bzw. x0 - 2 (Versatz +2).
	avesmapsLabelOccupancy.reset();
	avesmapsLabelOccupancy.add({ left: x0 - 30, top: y0 - 6, right: x0 - 3, bottom: y0 + 6 });
	const gewichen = api.berechneKurvenlabels().eintraege[0].fenster[0].glyphs;
	nahe(gewichen[0].x - x0, 2, "die erste Glyphe rutscht genau einen Schritt (2 px) weiter");
	nahe(gewichen[0].y, y0, "und bleibt dabei auf ihrer Linie");
	assert.strictEqual(gewichen.length, frei.length, "kein Buchstabe geht dabei verloren");

	// 🔴 §7.2 Punkt 3: bringt das Ausweichen nichts, weicht das Kurvenlabel NICHT weiter aus -- es
	// bleibt, wo es sitzt, und wird gemalt. Kein „dann eben ausblenden".
	avesmapsLabelOccupancy.reset();
	avesmapsLabelOccupancy.add({ left: x0 - 200, top: y0 - 40, right: x0 + 400, bottom: y0 + 40 });
	const eingekesselt = api.berechneKurvenlabels();
	assert.strictEqual(eingekesselt.eintraege.length, 1, "es wird trotzdem gemalt");
	assert.strictEqual(eingekesselt.gemalt.has(label), true, "und gilt als gemalt");
	nahe(eingekesselt.eintraege[0].fenster[0].glyphs[0].x, x0, "und zwar an der urspruenglichen Stelle (Versatz 0)");
	avesmapsLabelOccupancy.reset();
}

// --- 1e) Freie Lage == unveraenderte Lage ---------------------------------------------------------
// Das Ausweichen darf nichts verschieben, solange nichts im Weg steht: bei Versatz 0 muss Zeichen
// fuer Zeichen dasselbe herauskommen wie beim blanken layoutGlyphsAlong auf dem Passungsfenster.
{
	const label = waagerecht();
	const { api, ctx } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	const gesetzt = api.berechneKurvenlabels().eintraege[0].fenster[0];
	const chars = Array.from(label.text);
	const breiten = chars.map(() => ctx.measureText().width);
	const passung = avesmapsCurveLabelFit(
		label.curveLine.map(([lat, lng]) => ({ x: lng, y: lat })), chars, breiten, 12, 1
	);
	const roh = layoutGlyphsAlong(passung.fenster[0].pts, passung.fenster[0].chars,
		passung.fenster[0].widths, passung.fenster[0].ls, 0, passung.fenster[0].fontSize);
	assert.strictEqual(gesetzt.glyphs.length, roh.length, "gleich viele Glyphen");
	for (let i = 0; i < roh.length; i += 1) {
		nahe(gesetzt.glyphs[i].x, roh[i].x, `Glyphe ${i}: x`, 1e-9);
		nahe(gesetzt.glyphs[i].y, roh[i].y, `Glyphe ${i}: y`, 1e-9);
	}
}

// --- 1f) Der Stempel der Ansicht -------------------------------------------------------------------
// 💣 redraw() kommt auch aus path-rendering, powerlines und display-mode -- ohne dass jemand vorher
// gerechnet haette. Eine Glyphenreihe in Container-Pixeln ist nach einem Schwenk nicht alt, sondern
// falsch: dann wird neu gerechnet statt falsch gemalt.
{
	const stempel = { zoom: 4, lat: 500, lng: 100 };
	const label = waagerecht();
	const { api, gemessen } = baueKanalC(stempel, () => [label]);
	avesmapsLabelOccupancy.reset();
	api.berechneKurvenlabels();
	const nachRechnung = gemessen.kandidatenAufrufe;

	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.kandidatenAufrufe, nachRechnung, "gleiche Ansicht -> NICHT neu gerechnet");
	assert.strictEqual(gemessen.gemalt.length, 1, "gemalt wird trotzdem, aus der Ablage");
	assert.strictEqual(gemessen.gemalt[0].chars.length, Array.from(label.text).length, "und zwar der ganze Name");

	stempel.lng = 140;                                  // geschwenkt
	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.kandidatenAufrufe, nachRechnung + 1, "nach dem Schwenk -> neu gerechnet");

	stempel.zoom = 5;                                   // gezoomt
	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.kandidatenAufrufe, nachRechnung + 2, "nach dem Zoom -> neu gerechnet");

	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.kandidatenAufrufe, nachRechnung + 2, "und danach wieder nicht");
}

// --- 1g) Passung ja, Platzierung nein -> NICHT als gemalt gemeldet ---------------------------------
// Die zweite Haelfte des 💣 aus 1c: nicht nur eine gescheiterte PASSUNG, auch ein Fenster, das sich
// nicht setzen laesst, muss den Marker stehenlassen. Sonst verschwindet der Name ganz.
//
// 🪤 Diese Lage kann die ECHTE Passung heute nicht erzeugen -- an 20 000 zufaelligen Polylinien
// gemessen (22.08.2026): 20 000 Passungen, 0 ohne Platzierung. Der Grund steht in curve-label-fit.js:
// die Passung VERLAENGERT zuletzt bedingungslos, bis der gesperrte Text in seinen Bogen passt, und
// die Leserichtung ist da schon je Fenster entschieden. Damit die Zusicherung trotzdem nicht bloss
// behauptet ist, wird hier die Passung untergeschoben -- der einzige Weg an eine Lage heran, die der
// naechste Umbau an der Sperrung oder an der Beruhigung sehr wohl herstellen kann.
{
	const chars = Array.from("DRACHENSTEINE");
	const widths = chars.map(() => 8);
	const label = waagerecht();
	// Eine Grundlinie von 20 px fuer 104 px Text: layoutGlyphsAlong liefert null, an jedem Versatz.
	const zuKurz = () => ({ fenster: [{ pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }], ls: 0, fontSize: 12, chars, widths }], hinweise: [] });
	const { api, fenster } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label], zuKurz);
	avesmapsLabelOccupancy.reset();
	// Erst die Zusicherung an platziereKurvenfenster selbst -- sie traegt den Fall.
	assert.strictEqual(api.platziereKurvenfenster(zuKurz().fenster[0]), null,
		"eine Grundlinie, die kuerzer ist als der Text, ergibt KEINE Platzierung");
	const ablage = api.berechneKurvenlabels();
	assert.strictEqual(ablage.eintraege.length, 0, "und damit kommt das Label gar nicht erst in die Ablage");
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt(label), false,
		"nicht platziert -> nicht gemalt -> der Marker bleibt stehen");
	assert.ok(ablage.eintraege.every((e) => e.fenster.length > 0), "kein Eintrag ohne gesetztes Fenster");
}

// --- 1h) Quelltext-Zusicherung: Kanal C malt auch, wenn es keine Wege gibt -------------------------
// ⚠️ redraw() laesst sich ohne echte Leaflet-Karte nicht ausfuehren, deshalb hier eine Aussage ueber
// den Quelltext -- und sie ist als solche benannt. Der Grund ist derselbe 💣 wie in 1c und 1g: seit
// dem Riegel haengt der alte Marker am Ergebnis der Kurvenrechnung. Steigt redraw() vor Kanal C aus,
// weil gerade keine Wegdaten da sind, waere die Kurve ungemalt UND der Marker abgemeldet -- der Name
// verschwindet ganz.
{
	const redrawVon = overlayQuelle.indexOf("function redraw()");
	const wegeWache = overlayQuelle.indexOf("if (typeof pathData === \"undefined\"", redrawVon);
	const wacheEnde = overlayQuelle.indexOf("\t\t}", wegeWache);
	assert.ok(wegeWache > redrawVon && wacheEnde > wegeWache, "redraw() hat eine Wache gegen fehlende Wegdaten");
	assert.ok(overlayQuelle.slice(wegeWache, wacheEnde).includes("zeichneKurvenlabels();"),
		"und sie malt Kanal C, bevor sie aussteigt");
}

// =================================================================================================
// 2. Der Riegel in map-features-labels.js -- und die Ausnahme, die die Rueckkopplung bricht
// =================================================================================================
const labelsQuelle = fs.readFileSync(hier("map-features-labels.js"), "utf8");

function schneide(quelle, kopf) {
	const von = quelle.indexOf(kopf);
	assert.ok(von >= 0, `${kopf} steht in der Datei`);
	const bis = quelle.indexOf("\n}", von);
	assert.ok(bis > von, `${kopf} hat ein Ende`);
	return { von, rumpf: quelle.slice(von, bis + 2) };
}

const rumpfRiegel = schneide(labelsQuelle, "function shouldShowLabelMarker(");
const rumpfLeser = schneide(labelsQuelle, "function avesmapsKurvenlabelKandidaten(");

// --- 2a) Quelltext-Zusicherung: der Riegel steht ZULETZT --------------------------------------------
// ⚠️ Das ist bewusst eine Aussage ueber den QUELLTEXT und keine getarnte Verhaltensprobe: alle fuenf
// Riegel liefern `false`, ihre Reihenfolge ist am Ergebnis nicht messbar. Der Bauplan verlangt die
// Stellung trotzdem (Schritt 3) -- „Kurvenbeschriftung an" darf kein Weg an der Ebenenwahl vorbei
// werden, wenn spaeter jemand aus einem der Riegel eine wahrheitswertige Bedingung macht.
{
	const ebene = rumpfRiegel.rumpf.indexOf("isLabelOfActiveEcosystemLayer(");
	const kurve = rumpfRiegel.rumpf.indexOf("avesmapsLabelWirdAlsKurveGemalt(entry.label)");
	const schluss = rumpfRiegel.rumpf.indexOf("return (MAP_LABEL_MODES");
	assert.ok(ebene > 0 && kurve > 0 && schluss > 0, "alle drei Stellen stehen in shouldShowLabelMarker");
	assert.ok(kurve > ebene, "der Kurvenriegel steht NACH dem Ebenenfilter");
	assert.ok(kurve < schluss, "und vor dem abschliessenden return");
	assert.ok(/typeof avesmapsLabelWirdAlsKurveGemalt === "function"/.test(rumpfRiegel.rumpf),
		"und er ist mit typeof abgesichert -- mit ?canvaspathlabels=0 gibt es die Funktion gar nicht");
}

// --- 2b) Verhalten: der Riegel verbirgt, der Kandidatenleser umgeht ihn ------------------------------
// 💣 DIE RUECKKOPPLUNG. Wuerde avesmapsKurvenlabelKandidaten den Riegel MITfragen, fiele jedes einmal
// gemalte Kurvenlabel im naechsten Durchgang aus seiner eigenen Kandidatenliste: nicht mehr gemalt ->
// Marker zurueck -> wieder gemalt. Ein Flackern im Wechsel, Bild fuer Bild.
function baueRiegel({ gemalt, ebeneGilt = true }) {
	const map = { getZoom: () => 4 };
	return new Function(
		"map", "getMapRenderBounds", "isMapLabelEditorOverrideActive", "isLabelsWithRegionFilterActive",
		"ecosystemRegionOfLabel", "isLabelOfActiveEcosystemLayer", "MAP_LABEL_MODES",
		"getSelectedMapLayerMode", "isLatLngInRenderBounds", "avesmapsLabelWirdAlsKurveGemalt", "labelMarkers",
		rumpfRiegel.rumpf + "\n" + rumpfLeser.rumpf
		+ "; return { shouldShowLabelMarker, avesmapsKurvenlabelKandidaten };"
	);
}
{
	const label = { publicId: "drachensteine", text: "DRACHENSTEINE", curveLine: [[100, 0], [100, 600]] };
	const entry = { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } };
	const gemalt = new Set();
	const bau = baueRiegel({});
	const api = bau(
		{ getZoom: () => 4 },
		() => "BOUNDS",
		() => null,
		() => false,
		() => null,
		() => true,
		["standard"],
		() => "standard",
		() => true,
		(l) => gemalt.has(l),
		[entry]
	);

	assert.strictEqual(api.shouldShowLabelMarker(entry), true, "ohne Kurvenzeichnung steht der Marker");
	assert.strictEqual(api.avesmapsKurvenlabelKandidaten().length, 1, "und ist Kandidat");

	gemalt.add(label);                                  // jetzt wird er als Kurve gemalt
	assert.strictEqual(api.shouldShowLabelMarker(entry), false, "der alte Marker geht weg");
	assert.strictEqual(api.avesmapsKurvenlabelKandidaten().length, 1,
		"DER KANDIDAT BLEIBT -- sonst hoerte das Malen im naechsten Durchgang auf und es flackerte");
	assert.strictEqual(api.avesmapsKurvenlabelKandidaten()[0], label, "und es ist dasselbe Label");

	// Und der Riegel darf nur VERBERGEN: er hebt keinen der Filter ueber sich auf.
	assert.strictEqual(api.shouldShowLabelMarker(entry, 4, "BOUNDS", false), false,
		"Haken aus bleibt aus, auch wenn die Kurve gemalt wird");
}
{
	// ?canvaspathlabels=0: das Overlay steigt aus, bevor es die Funktion setzt. Kein Wurf, kein
	// verschwundener Name -- der Marker bleibt.
	const label = { publicId: "koschberge", text: "KOSCHBERGE", curveLine: [[1, 2], [3, 4]] };
	const entry = { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } };
	const api = baueRiegel({})(
		{ getZoom: () => 4 }, () => "B", () => null, () => false, () => null, () => true,
		["standard"], () => "standard", () => true, undefined, [entry]
	);
	assert.strictEqual(api.shouldShowLabelMarker(entry), true, "ohne das Overlay steht der Marker weiter");
}

// --- 2c) avesmapsSyncKurvenlabelMarker zieht genau die Kurvenlabels nach ----------------------------
// Ohne diesen Aufruf stuende der Name nach dem Laden DOPPELT -- der Riegel haengt an einem Zustand,
// den erst der Kollisionsdurchgang setzt, und syncLabelVisibility laeuft nur bei Zoom und Schwenk.
{
	const rumpfSync = schneide(labelsQuelle, "function avesmapsSyncKurvenlabelMarker(");
	const gesehen = [];
	const mitKurve = { label: { publicId: "mitKurve", curveLine: [[1, 2], [3, 4]] } };
	const ohneKurve = { label: { publicId: "ohneKurve", curveLine: null } };
	const zuKurz = { label: { publicId: "zuKurz", curveLine: [[1, 2]] } };
	const api = new Function(
		"labelMarkers", "map", "getMapRenderBounds", "isMapLabelEditorOverrideActive", "syncLabelMarkerVisibility",
		rumpfSync.rumpf + "; return avesmapsSyncKurvenlabelMarker;"
	)(
		[mitKurve, ohneKurve, zuKurz],
		{ getZoom: () => 6 },
		() => "BOUNDS",
		() => null,
		(entry, zoomLevel, renderBounds, editorOverride) => gesehen.push({
			publicId: entry.label.publicId, zoomLevel, renderBounds, editorOverride,
		})
	);
	api();
	assert.deepStrictEqual(gesehen, [{ publicId: "mitKurve", zoomLevel: 6, renderBounds: "BOUNDS", editorOverride: null }],
		"nur Labels MIT brauchbarer Kurve werden nachgezogen, und die Ansicht reist mit");
	// Kein Bestand -> kein Wurf.
	const leer = new Function(
		"labelMarkers", "map", "getMapRenderBounds", "isMapLabelEditorOverrideActive", "syncLabelMarkerVisibility",
		rumpfSync.rumpf + "; return avesmapsSyncKurvenlabelMarker;"
	)(undefined, { getZoom: () => 6 }, () => "B", () => null, () => { throw new Error("darf nicht gerufen werden"); });
	leer();
}

// =================================================================================================
// 3. Die Kaskade -- Reihenfolge und Zusammensetzung der Vorbelegung
// =================================================================================================
// 🔴 Die Kurvenlabels werden VOR den Orts- und Freilabels platziert. Ans Ende gehaengt waere es eine
// RANGaenderung, getarnt als Zeichenaenderung (Entwurf §7.2). Gemessen wird die Reihenfolge der
// Aufrufe, nicht die Reihenfolge der Zeilen.
{
	const kollisionsQuelle = fs.readFileSync(hier("map-features-label-collisions.js"), "utf8");
	const rumpfPass = schneide(kollisionsQuelle, "function scheduleLabelCollisionResolution(");
	const ablauf = [];
	const ursprung = { left: 40, top: 25 };
	const gebietsRects = [{ wer: "gebiet" }];
	const kurvenRects = [{ wer: "kurve1" }, { wer: "kurve2" }];
	const ortsRects = [{ wer: "orte" }];
	let gesehenerUrsprungKurven = "nie gerufen";
	let gesehenerSeed = null;
	let gesehenePublish = null;

	const fenster = {
		requestAnimationFrame: (fn) => { fn(); return 1; },
		AvesmapsPathLabelCanvasOverlay: { redraw: () => ablauf.push("redraw") },
	};
	new Function(
		"window", "readLabelOccupancyOrigin", "resolveRegionLabelCollisions", "resolveLabelCollisions",
		"publishLabelOccupancy", "avesmapsKurvenlabelPlatzierungen", "avesmapsSyncKurvenlabelMarker",
		// labelCollisionFrameId ist in der echten Datei eine Modulglobale aus map-features.js.
		"let labelCollisionFrameId = null;\n" + rumpfPass.rumpf + "; return scheduleLabelCollisionResolution;"
	)(
		fenster,
		() => { ablauf.push("ursprung"); return ursprung; },
		() => { ablauf.push("gebiete"); return gebietsRects; },
		(seed) => { ablauf.push("orte"); gesehenerSeed = seed; return ortsRects; },
		(rects, origin) => { ablauf.push("publish"); gesehenePublish = { rects, origin }; },
		(origin) => { ablauf.push("kurven"); gesehenerUrsprungKurven = origin; return kurvenRects; },
		() => { ablauf.push("markerSync"); }
	)();

	assert.deepStrictEqual(ablauf, ["ursprung", "gebiete", "kurven", "markerSync", "orte", "publish", "redraw"],
		"die Kurvenlabels stehen ZWISCHEN Gebiets- und Ortsnamen, und der alte Marker geht VOR dem Ortspass");
	assert.strictEqual(gesehenerUrsprungKurven, ursprung,
		"die Platzierung bekommt DENSELBEN Container-Ursprung, den auch publishLabelOccupancy benutzt");
	assert.deepStrictEqual(gesehenerSeed, [{ wer: "gebiet" }, { wer: "kurve1" }, { wer: "kurve2" }],
		"die Vorbelegung des Ortspasses ist Gebietsnamen PLUS Kurvenlabels -- nicht das eine ODER das andere");
	assert.strictEqual(gesehenePublish.rects, ortsRects, "veroeffentlicht wird die Endlage des Ortspasses");
	assert.strictEqual(gesehenePublish.origin, ursprung, "mit demselben Ursprung");
	assert.notStrictEqual(gesehenerSeed, gebietsRects, "concat statt push -- die Gebietsliste wird nicht veraendert");
	assert.strictEqual(gebietsRects.length, 1, "und bleibt einelementig");
}

console.log("kurvenlabel-kaskade: alle Zusicherungen erfuellt");
