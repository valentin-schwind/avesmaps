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

// Aufgabe 6b: der Fingerspielraum des Klick-Registers ist DERSELBE wie bei den Wegnamen. Er wird
// hier aus der Quelle gelesen und nicht abgeschrieben -- eine abgeschriebene 6 im Test bewiese nur,
// dass zwei Stellen dieselbe Zahl tragen, und genau das soll sie ja nicht.
const padTreffer = overlayQuelle.match(/const WAY_LABEL_CLICK_PAD = (\d+(?:\.\d+)?);/);
assert.ok(padTreffer, "WAY_LABEL_CLICK_PAD steht als Konstante in der Datei");
const WAY_LABEL_CLICK_PAD = Number(padTreffer[1]);

// `passungsStub` ist normalerweise leer -- dann rechnet die ECHTE Passung aus curve-label-fit.js.
// Sie wird nur dort untergeschoben, wo eine Lage geprueft wird, die die echte Passung gar nicht
// erzeugen kann (siehe 1g).
function baueKanalC(stempel, kandidatenListe, passungsStub, optionen = {}) {
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
		// Aufgabe 6b: die drei stehen im Kanal-C-Stueck, seit der Maler das Klick-Register fuellt.
		"WAY_LABEL_CLICK_PAD", "setHighlightedEcosystemRegion", "canOperateEcosystemLayers",
		kanalC + "; return { berechneKurvenlabels, zeichneKurvenlabels, platziereKurvenfenster, kurvenlabelKaesten,"
		+ " klickRegister: () => kurvenlabelClickRegister };"
	)(
		fenster, map, L, ctx,
		(glyphs, chars) => { gemessen.gemalt.push({ glyphs, chars }); },
		() => ({ fontFamily: "serif", fontWeight: "400", fontStyle: "", color: "#4a3728", uppercase: false }),
		() => 12,
		() => ({ glow: null }),
		2, 2,
		() => { gemessen.kandidatenAufrufe += 1; return kandidatenListe(); },
		(schluessel) => (schluessel === "repel" ? 2 : 0),
		passungsStub || avesmapsCurveLabelFit,
		WAY_LABEL_CLICK_PAD,
		// Der Maler ruft sie nie -- er fragt nur, ob es sie gibt. Gerufen wird sie im Schiedsrichter
		// (Abschnitt 4), und dort mit einem eigenen Spion.
		() => { throw new Error("der Maler darf nicht hervorheben"); },
		() => Boolean(optionen.darfBearbeiten)
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
const rumpfBand = schneide(labelsQuelle, "function avesmapsLabelImBand(");

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
		// Aufgabe 6b: der Riegel fragt seit heute auch nach dem Bearbeiten-Modus.
		"IS_EDIT_MODE",
		// 💣 avesmapsLabelImBand MUSS MIT. Seit dem 24.08.2026 ruft der Riegel diese
		// Geschwisterfunktion (Groesse gilt, Band raet); ohne sie im Ausschnitt wirft er einen
		// ReferenceError -- die Falle, die am 22.08.2026 beinahe saemtliche Wegnamen gekostet
		// haette. Beim Herausloesen zaehlt nicht nur ZUSTAND, sondern auch der Aufruf eines Nachbarn.
		[rumpfBand.rumpf, rumpfRiegel.rumpf, rumpfLeser.rumpf].join("\n")
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
		[entry],
		false                                            // Ansichtsmodus
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
		["standard"], () => "standard", () => true, undefined, [entry], false
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

// =================================================================================================
// 4. Aufgabe 6b -- der gemalte Name bleibt anklickbar
// =================================================================================================
// 🔴 DIE REGRESSION, die diesen Abschnitt gibt: Aufgabe 6 nimmt den Marker nicht bloss die Sicht,
// sie meldet ihn von der Karte AB (syncLabelMarkerVisibility ruft map.removeLayer). Mit ihm ging der
// Klick, der die Landschaftsflaeche hervorhebt -- der gemalte Name war tot.
//
// Zwei Haelften, hier beide gemessen: (A) das Kurvenlabel traegt den Klick jetzt selbst,
// (B) im Bearbeiten-Modus bleibt der Marker stehen.

// Eine waagerechte Kurve MIT Flaeche daran -- das ist der Fall, um den es geht.
const REGION_ID = "991703a0-7543-4a74-b4c3-f407ea57b509";
const mitFlaeche = () => Object.assign(waagerecht(), { ecosystemRegionPublicId: REGION_ID });

// --- 4a) Der Maler fuellt das Klick-Register -------------------------------------------------------
{
	const label = mitFlaeche();
	const { api } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	const ablage = api.berechneKurvenlabels();
	assert.strictEqual(api.klickRegister().length, 0, "Vorbedingung: rechnen allein registriert nichts");

	api.zeichneKurvenlabels();
	const register = api.klickRegister();
	assert.strictEqual(register.length, 1, "ein Eintrag je GEMALTEM Namen");
	assert.strictEqual(register[0].regionPublicId, REGION_ID,
		"und er traegt DIE Flaeche des Labels -- genau die, die der Marker hervorgehoben haette");

	// Die Trefferflaeche ist die Huelle der Glyphen plus DERSELBE Fingerspielraum wie bei den Wegnamen.
	const glyphs = ablage.eintraege[0].fenster[0].glyphs;
	const roh = glyphsHullBox(glyphs, 0);
	nahe(register[0].left, roh.left - WAY_LABEL_CLICK_PAD, "Trefferflaeche links", 1e-9);
	nahe(register[0].right, roh.right + WAY_LABEL_CLICK_PAD, "Trefferflaeche rechts", 1e-9);
	nahe(register[0].top, roh.top - WAY_LABEL_CLICK_PAD, "Trefferflaeche oben", 1e-9);
	nahe(register[0].bottom, roh.bottom + WAY_LABEL_CLICK_PAD, "Trefferflaeche unten", 1e-9);
	assert.ok(register[0].right > register[0].left && register[0].bottom > register[0].top,
		"und sie hat eine Flaeche");
	// Quelltext-Zusicherung, als solche benannt: die Zahl steht NICHT zweimal da. Eine abgeschriebene 6
	// im Kanal C waere gegen die Rechnung oben nicht messbar -- gegen den Quelltext schon.
	assert.ok(kanalC.includes("WAY_LABEL_CLICK_PAD"),
		"Kanal C nimmt die Polsterung der Wegnamen, keine eigene Zahl");
}

// --- 4a2) Ein Name, der MEHRFACH steht, ist auch mehrfach anklickbar -------------------------------
// ⚠️ „je gezeichnetem Namen ein Eintrag" heisst je VORKOMMEN, nicht je Label: bei curveMax > 1 setzt
// die Passung denselben Namen mehrmals entlang seiner Kurve. Ein Eintrag fuer alle liesse zwei von
// drei gemalten Namen tot -- genau die Regression, gegen die dieser Abschnitt steht.
{
	const langeKurve = {
		text: "DRACHENSTEINE", labelType: "gebirge", curveMax: 3,
		curveLine: [[100, 0], [100, 1800]], ecosystemRegionPublicId: REGION_ID,
	};
	const { api, gemessen } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [langeKurve]);
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.gemalt.length, 3, "Vorbedingung: der Name steht dreimal auf der Kurve");
	const register = api.klickRegister();
	assert.strictEqual(register.length, 3, "und jedes Vorkommen bekommt seine eigene Klickflaeche");
	assert.ok(register.every((e) => e.regionPublicId === REGION_ID), "alle drei zeigen auf dieselbe Flaeche");
	// Und sie liegen wirklich woanders -- sonst waere die Zahl 3 ohne Aussage.
	const linkeKanten = new Set(register.map((e) => Math.round(e.left)));
	assert.strictEqual(linkeKanten.size, 3, "an drei verschiedenen Stellen");
}

// --- 4b) Registriert wird nur, was auch WIRKLICH etwas tut -----------------------------------------
{
	// Kein Flaechenbezug -> gemalt, aber keine Klickflaeche. Sonst zeigte der Zeiger eine Hand ueber
	// Text, der auf nichts antwortet.
	const ohneFlaeche = waagerecht();
	const { api, gemessen } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [ohneFlaeche]);
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(gemessen.gemalt.length, 1, "der Name wird gemalt");
	assert.strictEqual(api.klickRegister().length, 0, "aber er bekommt keine Klickflaeche");
}
{
	// 🔴 DIESELBE BEDINGUNG WIE AM MARKER: wer die Ebene bearbeiten kann, bekommt die Hervorhebung
	// nicht -- dort beantwortet derselbe Klick etwas Staerkeres.
	const label = mitFlaeche();
	const { api } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label], null, { darfBearbeiten: true });
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(api.klickRegister().length, 0,
		"canOperateEcosystemLayers() == true -> keine Klickflaeche, wie am Marker");
}
{
	// Nicht platziert -> nicht gemalt -> auch keine Klickflaeche. Die Kehrseite von 1g: sonst laege
	// eine Trefferflaeche ueber einem Namen, den niemand sieht.
	const chars = Array.from("DRACHENSTEINE");
	const zuKurz = () => ({ fenster: [{ pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }], ls: 0, fontSize: 12, chars, widths: chars.map(() => 8) }], hinweise: [] });
	const label = mitFlaeche();
	const { api } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label], zuKurz);
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(api.klickRegister().length, 0, "kein gesetztes Fenster -> keine Klickflaeche");
}

// --- 4c) Ein Bild ohne gezeichnete Kurvenlabels laesst das Register LEER ----------------------------
// 💣 Sonst bliebe die Klickflaeche des VORHERIGEN Bildes stehen -- ein Klick ins Leere hoebe eine
// Flaeche hervor, deren Name laengst woanders (oder gar nicht mehr) steht.
{
	const stempel = { zoom: 4, lat: 0, lng: 0 };
	let kandidaten = [mitFlaeche()];
	const { api } = baueKanalC(stempel, () => kandidaten);
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(api.klickRegister().length, 1, "Vorbedingung: erst steht eine Klickflaeche da");

	kandidaten = [];
	stempel.lng = 140;                                  // geschwenkt -> die Ablage wird neu gerechnet
	api.zeichneKurvenlabels();
	assert.strictEqual(api.klickRegister().length, 0,
		"ein Bild ohne gemalte Kurvenlabels laesst KEINE Klickflaeche zurueck");
}
{
	// ⚠️ Quelltext-Zusicherung, und als solche benannt: redraw() steigt vor dem Maler aus (CSS-Zoom,
	// Canvas aus, keine Pane) -- dann leert es das Register selbst, ganz oben. Ohne echte Leaflet-Karte
	// laesst sich redraw() nicht ausfuehren, die Stellung aber sehr wohl pruefen.
	const redrawVon = overlayQuelle.indexOf("function redraw()");
	const ersterReturn = overlayQuelle.indexOf("return;", redrawVon);
	const leeren = overlayQuelle.indexOf("kurvenlabelClickRegister = [];", redrawVon);
	assert.ok(redrawVon > 0 && ersterReturn > redrawVon, "redraw() hat einen ersten Ausstieg");
	assert.ok(leeren > redrawVon && leeren < ersterReturn,
		"redraw() leert das Kurvenlabel-Register VOR seinem ersten Ausstieg");
}

// --- 4d) Der Klick-Schiedsrichter ------------------------------------------------------------------
// Der Handler wird aus der Quelle geschnitten und mit einer Attrappen-Karte gebaut, die ihn beim
// `map.on("click", …)` einsammelt -- so laeuft die ECHTE Verzweigung, nicht ihr Nachbau.
const arbiterVon = overlayQuelle.indexOf("\tmap.on(\"click\", (event) => {");
const arbiterBis = overlayQuelle.indexOf("\t// Cursor-Feedback", arbiterVon);
assert.ok(arbiterVon > 0 && arbiterBis > arbiterVon, "der Klick-Schiedsrichter steht in der Datei");
const arbiterQuelle = overlayQuelle.slice(arbiterVon, arbiterBis);

function baueSchiedsrichter({
	kurvenRegister = [], wegRegister = [], editMode = false, cssZoom = false,
	wegLabelsAn = true, siedlungGewinnt = false,
} = {}) {
	const gemessen = { hervorgehoben: [], popups: 0, siedlungGefragt: 0 };
	let handler = null;
	const map = { on: (typ, fn) => { if (typ === "click") { handler = fn; } } };
	const popupKette = { setLatLng() { return this; }, setContent() { return this; }, openOn() { gemessen.popups += 1; return this; } };
	new Function(
		"map", "IS_EDIT_MODE", "cssZoomActive", "wayLabelsEnabled", "wayLabelClickRegister",
		"kurvenlabelClickRegister", "window", "wayLabelHitTest", "setHighlightedEcosystemRegion",
		"findPathForWayLabelEntry", "createPathPopupMarkup", "pathHasWiki", "L", "wayLabelPopupMarkup",
		arbiterQuelle
	)(
		map, editMode, cssZoom, wegLabelsAn, wegRegister, kurvenRegister,
		{
			avesmapsTryOpenLocationAtContainerPoint: () => {
				gemessen.siedlungGefragt += 1;
				return siedlungGewinnt;
			},
		},
		wayLabelHitTestEcht,
		(id) => gemessen.hervorgehoben.push(id),
		() => null,
		undefined,
		undefined,
		{ popup: () => popupKette },
		() => "<div>Weg</div>"
	);
	assert.ok(typeof handler === "function", "der Handler wurde am Klick angemeldet");
	return { klick: (x, y) => handler({ containerPoint: { x, y } }), gemessen };
}

// Der ECHTE Treffer-Test, aus map-features-way-labels.js -- beide Register werden von ihm gelesen,
// und ein Nachbau hier bewiese nur, dass der Nachbau stimmt.
const wayLabelsQuelle = fs.readFileSync(hier("map-features-way-labels.js"), "utf8");
const hitVon = wayLabelsQuelle.indexOf("function wayLabelHitTest(");
assert.ok(hitVon >= 0, "wayLabelHitTest steht in map-features-way-labels.js");
const hitBis = wayLabelsQuelle.indexOf("\n}", hitVon);
const wayLabelHitTestEcht = new Function(
	wayLabelsQuelle.slice(hitVon, hitBis + 2) + "; return wayLabelHitTest;"
)();

const kurvenKasten = (regionPublicId, links = 100, oben = 100) => ({
	left: links, top: oben, right: links + 80, bottom: oben + 20, regionPublicId, text: "DRACHENSTEINE",
});
const wegKasten = (links = 100, oben = 100) => ({
	left: links, top: oben, right: links + 80, bottom: oben + 20,
	wikiKey: "wiki:reichsstrasse-2", name: "Reichsstraße 2", wikiUrl: "", subtype: "Strasse",
	anchorLatLng: { lat: 1, lng: 2 },
});

{
	// DER FALL, UM DEN ES GEHT: nur ein Kurvenlabel im Bild, kein einziger Wegname.
	// 💣 Bis Aufgabe 6b stand hier `if (!wayLabelsEnabled || !wayLabelClickRegister.length) return;` --
	// ein leeres Wegregister haette den Kurvennamen mitgenommen, und das ist der HAEUFIGE Fall.
	const s = baueSchiedsrichter({ kurvenRegister: [kurvenKasten(REGION_ID)] });
	s.klick(140, 110);
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [REGION_ID],
		"ein Klick auf den gemalten Namen hebt SEINE Flaeche hervor");
	assert.strictEqual(s.gemessen.siedlungGefragt, 1, "und die Siedlung wurde vorher gefragt");
}
{
	// Danebengeklickt -> nichts.
	const s = baueSchiedsrichter({ kurvenRegister: [kurvenKasten(REGION_ID)] });
	s.klick(400, 400);
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [], "neben dem Namen passiert nichts");
}
{
	// 🔴 DIE RANGFOLGE: Siedlung > Strasse/Fluss > Region. Beide Register treffen an derselben Stelle --
	// der Wegname gewinnt, das Kurvenlabel schweigt.
	const s = baueSchiedsrichter({
		kurvenRegister: [kurvenKasten(REGION_ID)],
		wegRegister: [wegKasten()],
	});
	s.klick(140, 110);
	assert.strictEqual(s.gemessen.popups, 1, "der Wegname oeffnet sein Popup");
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [], "und das Kurvenlabel kommt NICHT auch noch dran");
}
{
	// Und die Siedlung gewinnt ueber beide.
	const s = baueSchiedsrichter({ kurvenRegister: [kurvenKasten(REGION_ID)], siedlungGewinnt: true });
	s.klick(140, 110);
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [], "die Siedlung gewinnt");
	assert.strictEqual(s.gemessen.popups, 0);
}
{
	// 🔴 Im Bearbeiten-Modus steigt der Schiedsrichter aus -- genau deshalb bleibt dort der Marker
	// stehen (Teil B, Abschnitt 4f).
	const s = baueSchiedsrichter({ kurvenRegister: [kurvenKasten(REGION_ID)], editMode: true });
	s.klick(140, 110);
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [], "im Bearbeiten-Modus hebt das Overlay nichts hervor");
	assert.strictEqual(s.gemessen.siedlungGefragt, 0, "und fragt gar nicht erst weiter");
}
{
	// Waehrend der CSS-Zoom-Animation haelt das Register Vor-Zoom-Container-Pixel -- dann schweigt er.
	const s = baueSchiedsrichter({ kurvenRegister: [kurvenKasten(REGION_ID)], cssZoom: true });
	s.klick(140, 110);
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [], "waehrend des Zooms nicht");
}
{
	// ?waylabels=0 schaltet die WEGnamen ab, nicht das Kurvenlabel.
	const s = baueSchiedsrichter({
		kurvenRegister: [kurvenKasten(REGION_ID)],
		wegRegister: [wegKasten()],
		wegLabelsAn: false,
	});
	s.klick(140, 110);
	assert.strictEqual(s.gemessen.popups, 0, "der abgeschaltete Wegname oeffnet nichts");
	assert.deepStrictEqual(s.gemessen.hervorgehoben, [REGION_ID], "und das Kurvenlabel antwortet trotzdem");
}
{
	// Beide Register leer -> gar nichts, auch keine Siedlungsabfrage (die Wache bleibt eine Wache).
	const s = baueSchiedsrichter({});
	s.klick(140, 110);
	assert.strictEqual(s.gemessen.siedlungGefragt, 0, "ohne jede Klickflaeche wird niemand gefragt");
	assert.deepStrictEqual(s.gemessen.hervorgehoben, []);
}

// --- 4e) Der Zeiger: ein anklickbarer Name sieht auch anklickbar aus -------------------------------
// ⚠️ Ein Name, der antwortet, aber aussieht wie unbeweglicher Text, ist eine halbe Reparatur. Der
// mousemove-Zuhoerer wird wie der Schiedsrichter aus der Quelle geschnitten -- mitsamt seinen beiden
// `let`-Zustaenden, die im Stueck stehen.
const zeigerVon = overlayQuelle.indexOf("\t// ⚠️ Der Zustand heisst seit Aufgabe 6b");
const zeigerBis = overlayQuelle.indexOf("\t// Zoom-Animation wie beim Grenzen-Overlay", zeigerVon);
assert.ok(zeigerVon > 0 && zeigerBis > zeigerVon, "der mousemove-Zuhoerer steht in der Datei");
const zeigerQuelle = overlayQuelle.slice(zeigerVon, zeigerBis);

function baueZeiger({ kurvenRegister = [], wegRegister = [], editMode = false, wegLabelsAn = true } = {}) {
	const container = { style: { cursor: "" } };
	let handler = null;
	const map = { on: (typ, fn) => { if (typ === "mousemove") { handler = fn; } }, getContainer: () => container };
	new Function(
		"map", "IS_EDIT_MODE", "cssZoomActive", "wayLabelsEnabled", "wayLabelClickRegister",
		"kurvenlabelClickRegister", "wayLabelHitTest",
		zeigerQuelle
	)(map, editMode, false, wegLabelsAn, wegRegister, kurvenRegister, wayLabelHitTestEcht);
	assert.ok(typeof handler === "function", "der Zuhoerer wurde am mousemove angemeldet");
	return { bewege: (x, y) => handler({ containerPoint: { x, y } }), container };
}
{
	const z = baueZeiger({ kurvenRegister: [kurvenKasten(REGION_ID)] });
	z.bewege(140, 110);
	assert.strictEqual(z.container.style.cursor, "pointer", "ueber dem gemalten Namen: Hand-Zeiger");
}
{
	const z = baueZeiger({ kurvenRegister: [kurvenKasten(REGION_ID)] });
	z.bewege(400, 400);
	assert.strictEqual(z.container.style.cursor, "", "daneben: kein Hand-Zeiger");
}
{
	// Im Bearbeiten-Modus gibt es den Klick nicht -- also auch nicht seinen Zeiger.
	const z = baueZeiger({ kurvenRegister: [kurvenKasten(REGION_ID)], editMode: true });
	z.bewege(140, 110);
	assert.strictEqual(z.container.style.cursor, "", "im Bearbeiten-Modus kein Hand-Zeiger");
}
{
	// ?waylabels=0 nimmt dem Kurvenlabel seinen Zeiger nicht -- und die WEGnamen bekommen ihn nicht
	// zurueck. Zwei Kaesten, weit auseinander: nur so sagt der Fall beides.
	const z = baueZeiger({
		kurvenRegister: [kurvenKasten(REGION_ID, 100, 100)],
		wegRegister: [wegKasten(300, 300)],
		wegLabelsAn: false,
	});
	z.bewege(140, 110);
	assert.strictEqual(z.container.style.cursor, "pointer", "?waylabels=0 betrifft nur die Wegnamen");

	const z2 = baueZeiger({
		kurvenRegister: [kurvenKasten(REGION_ID, 100, 100)],
		wegRegister: [wegKasten(300, 300)],
		wegLabelsAn: false,
	});
	z2.bewege(340, 310);
	assert.strictEqual(z2.container.style.cursor, "",
		"und der abgeschaltete Wegname bekommt auch keinen Zeiger");
}

// --- 4f) Teil B: der Marker geht AUCH im Bearbeiten-Modus ------------------------------------------
// 🔴 UMGEDREHT AM 23.08.2026 (Owner, an vier Screenshots: „jetzt muessen nur ihre vorgaenger weg“).
// Bis dahin stand hier das Gegenteil, mit dieser Begruendung: der Schiedsrichter des Overlays steigt
// bei IS_EDIT_MODE aus, ein Editor kaeme ueber die Kurve also nicht an sein Label. Die Begruendung
// war richtig -- deshalb ist sie nicht einfach gestrichen, sondern BEANTWORTET worden:
// „Beschriftung bearbeiten“ im Kontextmenue der Flaeche ist der Ersatzweg, und die Zusicherung
// darauf steht gleich unter diesem Block. Owner-Entscheid dazu: mit eingeschalteter Kurve laesst
// sich ein Label NICHT mehr verschieben (der Ziehgriff geht mit dem Marker), alle uebrigen
// Darstellungswerte bleiben ueber den Dialog bedienbar.
//
// ⭐ Verdrahtet, nicht behauptet: der Riegel bekommt das ECHTE
// avesmapsLabelWirdAlsKurveGemalt des Overlays, nicht eine Attrappe davon.
{
	const label = mitFlaeche();
	const { api, fenster } = baueKanalC({ zoom: 4, lat: 0, lng: 0 }, () => [label]);
	avesmapsLabelOccupancy.reset();
	api.zeichneKurvenlabels();
	assert.strictEqual(fenster.avesmapsLabelWirdAlsKurveGemalt(label), true,
		"Vorbedingung: dieser Name wird wirklich als Kurve gemalt");

	const entry = { label, marker: { getLatLng: () => ({ lat: 1, lng: 2 }) } };
	const bauRiegel = (editMode) => baueRiegel({})(
		{ getZoom: () => 4 }, () => "BOUNDS", () => null, () => false, () => null, () => true,
		["standard"], () => "standard", () => true,
		fenster.avesmapsLabelWirdAlsKurveGemalt, [entry], editMode
	);

	assert.strictEqual(bauRiegel(false).shouldShowLabelMarker(entry), false,
		"Ansichtsmodus: der Marker geht -- die gemalte Kurve traegt den Klick jetzt selbst");
	assert.strictEqual(bauRiegel(true).shouldShowLabelMarker(entry), false,
		"Bearbeiten-Modus: der Marker geht EBENFALLS -- der Name stand dort sonst doppelt");

	// 💣 UND DER ERSATZWEG MUSS DA SEIN. Der Marker war der EINZIGE Weg zu einem bestehenden Label --
	// das Flaechenmenue kannte nur `create-label`. Ihn zu entfernen, ohne einen Ersatz zu haben, macht
	// jede Beschriftung mit Kurve unerreichbar; das ist die Owner-Regel von den verwaisten
	// Aussenhuellen, zweite Auflage. Diese Zusicherung ist der Grund, warum die Umkehrung oben
	// ueberhaupt zulaessig war -- wer sie streicht, nimmt ihr die Grundlage.
	{
		const ctx = fs.readFileSync(hier("map-features-ecosystem-context-action.js"), "utf8");
		assert.ok(ctx.includes('action: "edit-label"'),
			"das Flaechenmenue hat keinen Eintrag fuer eine BESTEHENDE Beschriftung mehr");
		assert.ok(ctx.includes('{ typ: "aktion", id: "edit-label" }'),
			"der Eintrag steht in keiner festen Reihenfolge und landete damit an zufaelliger Stelle");
		// 🪤 NICHT `includes("registerAreaMenuEditLabelEntry()")` -- das trifft auch die DEFINITION,
		// und dann ueberlebt das Entfernen des AUFRUFS die Pruefung. Genau so bleibt eine Funktion
		// gebaut, getestet und ungerufen (avesmapsCurveLabelRolloutFor, 22.-23.08.2026).
		assert.ok((ctx.match(/registerAreaMenuEditLabelEntry\(\)/g) || []).length >= 2,
			"der Eintrag wird nirgends registriert -- gebaut, aber nie angehaengt");
		assert.ok(ctx.includes("openLabelEditDialog("),
			"der Eintrag oeffnet den Label-Dialog nicht");
		assert.ok(fs.readFileSync(hier("map-features-labels.js"), "utf8")
			.includes("function avesmapsLabelEntriesForEcosystemRegion("),
			"der Aufloeser Flaeche -> bestehende Beschriftung fehlt");
	}

	// ⚠️ Und der Riegel bleibt ein Riegel: der Bearbeiten-Modus hebt keinen der Filter ueber ihm auf.
	const mitHakenAus = baueRiegel({})(
		{ getZoom: () => 4 }, () => "BOUNDS", () => null, () => false, () => null, () => true,
		["standard"], () => "standard", () => true,
		fenster.avesmapsLabelWirdAlsKurveGemalt, [entry], true
	);
	assert.strictEqual(mitHakenAus.shouldShowLabelMarker(entry, 4, "BOUNDS", false), false,
		"Haken aus bleibt aus, auch im Bearbeiten-Modus");
	// Und im Bearbeiten-Modus bleibt der Name trotzdem Kandidat -- die Kurve wird dort weiter gemalt
	// (der Name steht dann doppelt; das ist die hingenommene Zwischenstufe).
	assert.strictEqual(bauRiegel(true).avesmapsKurvenlabelKandidaten().length, 1,
		"die Kurve wird im Bearbeiten-Modus weiter gemalt");
}

console.log("kurvenlabel-kaskade: alle Zusicherungen erfuellt");
