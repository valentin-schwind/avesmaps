// Der Editor-Kasten in der Infobox einer Beschriftung/Landschaftsflaeche.
//
// Owner 10.09.2026, mit Bild vom Telefon (Moosgrunder Tann, angemeldet als „valentin | admin"):
// „ich kann Moosgrunder Tann ueberhaupt nicht bearbeiten - die symbole fehlen" -- und auf die
// Rueckfrage: „nein ich will ueber die infobox rein editieren".
//
// 💣 DIE URSACHE WAR EINE ARBEITSTEILUNG, DIE AM TELEFON NICHT AUFGEHT: der Editor-Zweig in
// map-features-labels.js haengt die Bearbeiten-Kacheln ans SCHWEBENDE Karten-Popup und fuellt das
// rechte Panel ausdruecklich mit der LESE-Ansicht (buildRegionLabelViewPopupHtml). Am Zeiger liegt
// beides nebeneinander; am Telefon deckt das Panel die Karte, das schwebende Menue ist unerreichbar,
// und ein Admin sah in seiner Infobox nur „Link teilen" und „Aenderungen vorschlagen" -- die Kacheln
// eines BESUCHERS.
//
// ⭐ Gebaut wurde nichts Neues: `labelActionsMarkup` gab es, `.location-popup__editor-band` im
// Infopanel-Blatt gab es (die Ortschaften nutzen es dort laengst, samt einer Regel fuer
// „Besucherzeile GEFOLGT von Editor-Kasten"), und die Klicks haengen ohnehin am DOKUMENT. Gefehlt hat
// nur der Aufruf.
//
// 🔴 DIESER TEST FUEHRT DIE BAUER AUS, er liest sie nicht. Die Lehre vom 03.09.2026 (AGENTS.md §11):
// ein Regex kennt keinen Geltungsbereich -- damals war ein Quelltext-Test gruen, waehrend die
// oeffentliche Karte zwei Stunden lang keine Beschriftungen zeichnete. Attrappen sind AUSDRUECKLICH,
// kein Proxy: ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau diesen Fehler.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");
// ⚠️ Zeilenendenneutral (AGENTS.md §9): die Arbeitskopie kann CRLF tragen, das Deploy-Tor sieht LF.
const ohneKommentare = (js) => js
	.replace(/\r\n/g, "\n")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[\t ]*\/\/.*$/gm, "");

function funktionAus(quelle, kopf) {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, kopf + " gibt es");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start + kopf.length - 1); i < quelle.length; i += 1) {
		if (quelle[i] === "{") tiefe += 1;
		else if (quelle[i] === "}") { tiefe -= 1; if (tiefe === 0) return quelle.slice(start, i + 1); }
	}
	throw new Error("Klammern gehen nicht auf: " + kopf);
}

const popupsRoh = lies("js/ui/popups.js");
const popups = ohneKommentare(popupsRoh);
const labelsRoh = lies("js/map-features/map-features-labels.js");
const labels = ohneKommentare(labelsRoh);

// ---------------------------------------------------------------------------
// 1. Der geteilte Bauer laeuft -- und schweigt fuer den Besucher.
// ---------------------------------------------------------------------------
function bandSandkasten(editModus, { mitFlaeche = true, gipfel = false } = {}) {
	const sandbox = {
		IS_EDIT_MODE: editModus,
		ecosystemRegionOfLabel: (l) => (mitFlaeche && l && l.publicId === "l-1" ? { public_id: "f-1" } : null),
		isEcosystemPeakSubtype: (art) => gipfel && art === "berggipfel",
		isEligiblePowerlineEndpoint: () => false,
		getPowerlineEndpointByPublicId: () => null,
		pendingPowerlineCreationStart: null,
		escapeHtml: (s) => String(s),
		tr: (_k, f) => f,
		popupActionGlyphMarkup: (n) => "<i>" + n + "</i>",
		popupActionButtonMarkup: (spec) => '<button class="location-popup__action-button"'
			+ ' data-popup-action="' + String((spec.attributes || {})["data-popup-action"] || "") + '">'
			+ String(spec.label || "") + "</button>",
	};
	const code = funktionAus(popups, "function locationPopupActionsMarkup(actionButtons = []) {") + "\n"
		+ funktionAus(popups, "function locationPopupEditorBandMarkup(actionButtons = [], noteMarkup = \"\") {") + "\n"
		+ funktionAus(popups, "function labelActionsMarkup(publicId, noteMarkup = \"\", { hatFlaeche = false } = {}) {") + "\n"
		+ funktionAus(popups, "function labelEditorBandMarkup(label) {") + "\n";
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox);
	return sandbox;
}

{
	const s = bandSandkasten(true);
	const band = vm.runInContext('labelEditorBandMarkup({ publicId: "l-1", labelType: "wald" })', s);
	assert.ok(typeof band === "string" && band !== "", "der Bauer laeuft durch und liefert Markup");
	assert.ok(band.includes("location-popup__editor-band"), "… im Editor-Kasten des Hauses");
	assert.ok(band.includes('data-popup-action="label-area-properties"'),
		"… und traegt „Eigenschaften“ -- die Kachel, die den Flaechendialog mit der Wiki-Zuweisung oeffnet");
	assert.ok(band.includes('data-popup-action="edit-label-details"'), "… sowie „Bearbeiten“");
	assert.ok(band.includes('data-popup-action="label-area-geometry"'), "… und „Flaeche bearbeiten“");
}

{
	// 🔴 DER RIEGEL LIEGT IN labelActionsMarkup, nicht im neuen Bauer -- eine zweite Rechteabfrage waere
	// die zweite Wahrheit. Gemessen wird deshalb die WIRKUNG: fuer einen Besucher kommt nichts heraus.
	const s = bandSandkasten(false);
	const band = vm.runInContext('labelEditorBandMarkup({ publicId: "l-1", labelType: "wald" })', s);
	assert.strictEqual(band, "", "ein Besucher bekommt keinen Editor-Kasten");
}

{
	// Die Warnung „Durch Flaeche ersetzen" gehoert weiterhin nur den Beschriftungen OHNE Flaeche --
	// und nie einem Gipfel (Owner 2026-07-28). Der Umzug in den geteilten Bauer darf das nicht drehen.
	const ohne = bandSandkasten(true, { mitFlaeche: false });
	const bandOhne = vm.runInContext('labelEditorBandMarkup({ publicId: "l-9", labelType: "wald" })', ohne);
	assert.ok(bandOhne.includes("Durch Fläche ersetzen"), "ohne Flaeche steht die Aufforderung");
	assert.ok(!bandOhne.includes('data-popup-action="label-area-properties"'),
		"… und ohne Flaeche gibt es auch keine Flaechen-Kacheln");

	const gipfel = bandSandkasten(true, { mitFlaeche: false, gipfel: true });
	const bandGipfel = vm.runInContext('labelEditorBandMarkup({ publicId: "l-8", labelType: "berggipfel" })', gipfel);
	assert.ok(!bandGipfel.includes("Durch Fläche ersetzen"), "ein Gipfel bekommt sie nie");
}

// ---------------------------------------------------------------------------
// 2. EIN Bauer, zwei Flaechen -- das schwebende Menue geht durch dieselbe Funktion.
// ---------------------------------------------------------------------------
{
	const rumpf = funktionAus(popups, "function labelPopupMarkup(entry) {");
	assert.ok(rumpf.includes("labelEditorBandMarkup(entry.label)"),
		"das schwebende Label-Menue baut seinen Kasten mit DEMSELBEN Bauer");
	assert.ok(!rumpf.includes("labelActionsMarkup("),
		"… und nicht mehr mit einer eigenen Fassung daneben -- eine Regel, die einen von zwei Erzeugern bindet, ist keine");
}

// ---------------------------------------------------------------------------
// 3. Die Infobox: Kachelzeile, dann Editor-Kasten, dann die Wiki-Infobox.
// ---------------------------------------------------------------------------
function infoboxSandkasten(mitBand) {
	const sandbox = {
		avesmapsLabelQuellenSchluessel: () => ({ typ: "ecosystem", id: "f-1" }),
		labelWikiArtPrimary: () => "",
		avesmapsLabelArtName: () => "Wald",
		tr: (_k, f) => f,
		renderFeatureKanonBadge: () => "<kanon>",
		infoHeaderImageMarkup: () => "<img>",
		regionHeaderImageBasename: () => "wald",
		locationPopupMarkup: (o) => "<popup>" + String(o.actionsMarkup || "") + "</popup>",
		locationPopupActionsMarkup: (list) => '<div class="location-popup__actions">' + list.join("") + "</div>",
		sharePlaceActionButtonMarkup: () => "<share>",
		popupActionButtonMarkup: () => "<btn>",
		labelWikiInfoboxMarkup: () => "<wikibox>",
	};
	if (mitBand) {
		sandbox.labelEditorBandMarkup = () => '<div class="location-popup__editor-band">BAND</div>';
	}
	const code = funktionAus(labels, "function regionLabelQuellenSchluessel(label) {") + "\n"
		+ funktionAus(labels, "function buildRegionLabelViewPopupHtml(label) {") + "\n";
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox);
	return sandbox;
}

{
	const s = infoboxSandkasten(true);
	const html = vm.runInContext(
		'buildRegionLabelViewPopupHtml({ publicId: "l-1", ecosystemRegionPublicId: "f-1", text: "Moosgrunder Tann", labelType: "wald", coordinates: [1, 2] })',
		s
	);
	assert.ok(html.includes("BAND"), "die Infobox traegt den Editor-Kasten");

	const kacheln = html.indexOf('class="location-popup__actions"');
	const band = html.indexOf('class="location-popup__editor-band"');
	const wiki = html.indexOf("<wikibox>");
	assert.ok(kacheln >= 0 && band >= 0 && wiki >= 0, "alle drei Stuecke sind da");
	// 💣 Die REIHENFOLGE ist eine Zusicherung ans Blatt: css/features/infopanel.css traegt eine Regel
	// fuer „.location-popup__actions:has(+ .location-popup__editor-band)". Steht der Kasten woanders,
	// greift sie nicht -- und hinter der Wiki-Infobox stuende er hinter „Quelle:", entgegen der
	// Owner-Regel „Quellen immer unten" (§11).
	assert.ok(kacheln < band, "die Besucher-Kachelzeile steht VOR dem Editor-Kasten");
	assert.ok(band < wiki, "und der Editor-Kasten VOR der Wiki-Infobox mit der Quellenzeile");
}

{
	// ⚠️ Der typeof-Riegel wird wirklich gefahren: ohne popups.js im Sandkasten baut die Infobox weiter,
	// nur ohne Kasten. Ein nackter Aufruf risse hier mit einem ReferenceError den ganzen Bauer mit -- und
	// dann saehe JEDER Besucher keine Beschriftungen mehr (die Regression vom 03.09.2026).
	const s = infoboxSandkasten(false);
	const html = vm.runInContext(
		'buildRegionLabelViewPopupHtml({ publicId: "l-2", ecosystemRegionPublicId: "", text: "Rakulahoehen", labelType: "gebirge", coordinates: [3, 4] })',
		s
	);
	assert.ok(typeof html === "string" && html.includes("<popup>"), "ohne den Bauer laeuft die Infobox trotzdem durch");
	assert.ok(!html.includes("location-popup__editor-band"), "… und traegt dann keinen Kasten");
}

// ---------------------------------------------------------------------------
// 4. Warum die Kacheln im Panel ueberhaupt wirken: die Klicks haengen am DOKUMENT.
// ---------------------------------------------------------------------------
{
	// 🔴 Ohne diese Zeile waere der ganze Umbau eine Attrappe: Kacheln, die dastehen und nichts tun,
	// sind schlimmer als keine. Sie haengt in routing.js und nicht am Karten-Popup -- deshalb wirkt
	// dieselbe Kachel im Infopanel.
	const routing = ohneKommentare(lies("js/routing/routing.js"));
	assert.ok(routing.includes('$(document).on("click", ".location-popup__action-button"'),
		"die Kachel-Klicks sind am Dokument delegiert, nicht am Karten-Popup");
}

// ---------------------------------------------------------------------------
// 5. Das Blatt kennt den Kasten im Panel bereits -- nachgezaehlt, nicht angenommen.
// ---------------------------------------------------------------------------
{
	const css = lies("css/features/infopanel.css").replace(/\r\n/g, "\n");
	assert.ok(css.includes(".location-popup__editor-band"),
		"css/features/infopanel.css kennt den Editor-Kasten");
	const popupsCss = lies("css/features/location-popups-markers.css").replace(/\r\n/g, "\n");
	assert.ok(popupsCss.includes(".avesmaps-infopanel .location-popup__editor-band > .location-popup__actions"),
		"… und seine Kachelzeile ist fuer das Panel ausdruecklich gestaltet");
}

console.log("landschaft-infobox-editor-kasten.test.js: alle Zusicherungen gruen");
