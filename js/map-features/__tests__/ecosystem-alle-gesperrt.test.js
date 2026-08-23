// „Alle“ ist eine ANSICHT, kein Arbeitsplatz (Owner 23.08.2026).
//
// 🔴 DER ANLASS. In „Alle“ antworten alle drei Ebenen — sichtbar und anklickbar —, aber die gemerkte
// ARBEITSEBENE läuft darunter unverändert weiter, und keine Kachel ist hervorgehoben. Jede Geste
// arbeitete deshalb in einer Ebene, die niemand mehr im Blick hatte. Am 23.08.2026 bekam so die
// Weiden-Region den Namen „Harpyienbuckel“ und dazu eine Fläche im Süden der Heldentrutz; auf der
// Karte hiess danach ganz Weiden „Harpyienbuckel“. Owner: „anklicken (auch die flächen) ist ok, aber
// nix bearbeiten.“
//
// 💣 ZUR LAUFZEIT GEZÄHLT, NICHT PER GREP — dieselbe Bauart wie ecosystem-sperre-eingaenge.test.js.
// Ein Suchmuster findet, was jemand hingeschrieben hat; dieser Test findet, was wirklich läuft. Und
// die Falle, gegen die er steht, ist die vom 14.08.2026: eine Regel, die einen von vier Erzeugern
// bindet, ist keine Regel.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const geometrie = require("../map-features-ecosystem-geometry.js");

const schalterQuelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-layer-switch.js"), "utf8");
const rendererQuelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-rendering.js"), "utf8");

// ---- 1. Die Frage selbst ---------------------------------------------------------------------------
//
// Zwei Fragen waren es seit dem 04.08.2026 (ansehen / bedienen), jetzt sind es drei: bedienen heisst
// „ich habe die Werkzeuge überhaupt“, bearbeiten heisst „ich darf sie HIER benutzen“.

function schalterWelt({ recht = true, editor = true, gemerktAlle = "0", ebene = "vegetation" } = {}) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(schalterQuelle, context);
	return context;
}

const inEbene = schalterWelt({ gemerktAlle: "0" });
assert.ok(inEbene.canOperateEcosystemLayers(), "Vorbedingung: der Editor hat die Werkzeuge");
assert.ok(inEbene.canEditEcosystemOnMap(),
	"in einer GEWÄHLTEN Ebene darf der Editor auf der Karte arbeiten");

const inAlle = schalterWelt({ gemerktAlle: "1" });
assert.ok(inAlle.canOperateEcosystemLayers(),
	"🔴 „Alle“ nimmt dem Editor NICHT sein Recht — die Werkzeugfrage bleibt unberührt");
assert.ok(!inAlle.canEditEcosystemOnMap(),
	'💣 aber in „Alle“ wird auf der Karte nicht bearbeitet — das ist die ganze Regel');

const besucher = schalterWelt({ recht: false, editor: false, gemerktAlle: "0" });
assert.ok(!besucher.canEditEcosystemOnMap(),
	"und wer die Werkzeuge gar nicht hat, bearbeitet auch in einer gewählten Ebene nichts");

// ---- 2. Der Gipfel ---------------------------------------------------------------------------------
//
// 🪤 Die gemerkte Ebene sagt in „Alle“ weiterhin „topographie“. Ohne die dritte Frage bliebe der
// Gipfel dort ziehbar — die Beschriftung wäre unter der Maus weggerutscht.

const gipfelWelt = ({ gemerktAlle }) => {
	const context = schalterWelt({ gemerktAlle, ebene: "topographie" });
	context.labelData = [{ publicId: "gipfel-1", labelType: "berg" }];
	context.isEcosystemPeakSubtype = (typ) => typ === "berg";
	return context;
};

assert.ok(gipfelWelt({ gemerktAlle: "0" }).isEcosystemPeakActive("gipfel-1"),
	"in der Topographie ist der Gipfel der Arbeitspunkt");
assert.ok(!gipfelWelt({ gemerktAlle: "1" }).isEcosystemPeakActive("gipfel-1"),
	'💣 in „Alle“ nicht — sonst ist er ziehbar in einer Ansicht, die nichts bearbeitet');

// ---- 3. Die Gesten auf der Fläche ------------------------------------------------------------------
//
// Die Bühne: gerade so viel Leaflet, dass eine Fläche entsteht und ihre Handler aufrufbar sind.

function flaechenWelt({ darfBearbeiten }) {
	const gestenHandler = new Map();
	const getan = [];
	const layerAttrappe = {
		_ecosystemArea: null,
		_path: { style: {} },
		on(typ, handler) { gestenHandler.set(typ, handler); return this; },
		bindTooltip() { return this; },
		closeTooltip() { return this; },
		setStyle() { return this; },
		bringToFront() { return this; },
		getElement() { return this._path; },
	};

	const context = {
		console,
		Map,
		Array,
		Number,
		String,
		Boolean,
		Object,
		JSON,
		Math,
		module: { exports: {} },
		document: { getElementById: () => null, addEventListener: () => {}, documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		L: {
			polygon: () => layerAttrappe,
			DomEvent: { stop: () => {}, stopPropagation: () => {} },
		},
		ecosystemGeometryParts: geometrie.ecosystemGeometryParts,
		ecosystemGeometryRings: geometrie.ecosystemGeometryRings,
		ecosystemGeometryArea: geometrie.ecosystemGeometryArea,
		ecosystemLayers: new Map(),
		// 🔴 Das Recht ist DA (der Editor verliert es in „Alle“ nicht) — nur das Bearbeiten auf der
		// Karte ist zu. Genau diese Trennung soll der Test messen.
		canOperateEcosystemLayers: () => true,
		canEditEcosystemOnMap: () => darfBearbeiten,
		isEcosystemShowAllLayers: () => !darfBearbeiten,
		isEcosystemDrawing: () => false,
		isEcosystemEditingInProgress: () => false,
		isEcosystemGeometryEditOpen: () => false,
		openEcosystemGeometryEdit: () => { getan.push("ECKEN-EDITOR"); },
		handleEcosystemEditEdgeDoubleClick: () => false,
		showFeedbackToast: () => {},
		setActiveEcosystemLayerKind: () => {},
	};
	context.window = {
		avesmapsEcosystemReichtWeiter: () => false,
		AvesmapsEcosystemAreaMenu: { open: () => { getan.push("FLÄCHENMENÜ"); } },
		AvesmapsEcosystemGeometryOps: { claimsMapClick: () => false, handleAreaClick: () => false },
		AvesmapsEcosystemTerritoryImport: { claimsMapClick: () => false },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(rendererQuelle, context);

	const flaeche = {
		public_id: "f-1",
		region_public_id: "r-1",
		region_name: "Harpyienbuckel",
		kind: "derographisch",
		geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
	};
	const layer = context.buildEcosystemAreaLayer(flaeche);
	assert.ok(layer, "buildEcosystemAreaLayer hat keine Fläche gebaut");
	layerAttrappe._ecosystemArea = flaeche;

	const feuere = (geste) => gestenHandler.get(geste)({
		originalEvent: { clientX: 5, clientY: 5, type: geste, target: layerAttrappe._path },
		latlng: { lat: 5, lng: 5 },
	});
	return { context, getan, feuere };
}

// In einer gewählten Ebene arbeiten beide Gesten wie bisher.
const arbeitend = flaechenWelt({ darfBearbeiten: true });
arbeitend.feuere("dblclick");
assert.ok(arbeitend.getan.includes("ECKEN-EDITOR"),
	"in einer gewählten Ebene öffnet der Doppelklick weiterhin die Ecken");
arbeitend.feuere("contextmenu");
assert.ok(arbeitend.getan.includes("FLÄCHENMENÜ"),
	"und der Rechtsklick weiterhin das Flächenmenü");

// In „Alle“ tut keine von beiden etwas.
const schauend = flaechenWelt({ darfBearbeiten: false });
schauend.feuere("dblclick");
assert.ok(!schauend.getan.includes("ECKEN-EDITOR"),
	'💣 in „Alle“ öffnet der Doppelklick KEINEN Ecken-Editor');
schauend.feuere("contextmenu");
assert.ok(!schauend.getan.includes("FLÄCHENMENÜ"),
	'💣 und der Rechtsklick KEIN Flächenmenü — dort hängen Löschen, Pinsel, Verschmelzen, '
		+ "Zerschneiden, Verschieben und die Eigenschaften");

// ---- 4. Aber der Klick bleibt ----------------------------------------------------------------------
//
// 🔴 Owner: „Alle“ soll das sein, was der gewöhnliche Besucher im Landschaftsmodus bekommt. Also
// dieselbe Antwort auf denselben Klick — Fläche leuchtet, Infopanel geht auf.

schauend.getan.length = 0;
schauend.feuere("click");
assert.strictEqual(schauend.context.getSelectedEcosystemAreaPublicId(), "f-1",
	'🔴 in „Alle“ wählt ein Klick die Fläche weiterhin aus — das ist der Sinn dieser Ansicht');
assert.strictEqual(schauend.context.effectiveEcosystemRegionId(), "r-1",
	"🔴 und er antwortet wie im Frontend: die Region leuchtet auf — und damit geht auch das Infopanel auf, "
		+ "beide hängen an DERSELBEN Frage (isEcosystemReaderClick)");

const arbeitendGeklickt = flaechenWelt({ darfBearbeiten: true });
arbeitendGeklickt.feuere("click");
assert.strictEqual(arbeitendGeklickt.context.effectiveEcosystemRegionId(), "",
	"in einer gewählten Ebene bleibt der Klick der Arbeits-Klick: Auswahl statt Leuchten");
assert.strictEqual(arbeitendGeklickt.context.getSelectedEcosystemAreaPublicId(), "f-1",
	"…und die Auswahl steht dort wie bisher");

assert.ok(schauend.context.isEcosystemReaderClick(),
	'in „Alle“ ist der Klick ein LESE-Klick — dieselbe Frage, die auch das Infopanel öffnet');
assert.ok(!arbeitend.context.isEcosystemReaderClick(),
	"in einer gewählten Ebene bleibt er der Arbeits-Klick des Editors");

// ---- 5. „Hier hinzufügen“ --------------------------------------------------------------------------

const menue = require("../map-features-ecosystem-context-action.js");
const anlegenInAlle = menue.addHereMenuVisibility({
	mode: "ecosystem", isEditMode: true, isEcosystemEnabled: true, activeKind: "topographie", showAll: true,
});
assert.ok(!anlegenInAlle.newArea, '💣 in „Alle“ gibt es kein „Neue Fläche“');
assert.ok(!anlegenInAlle.newPeak, '💣 und keinen „Höhenpunkt setzen“');
assert.ok(!anlegenInAlle.importTerritory, '💣 und kein „Territorium importieren“');

const anlegenInEbene = menue.addHereMenuVisibility({
	mode: "ecosystem", isEditMode: true, isEcosystemEnabled: true, activeKind: "topographie", showAll: false,
});
assert.ok(anlegenInEbene.newArea && anlegenInEbene.newPeak && anlegenInEbene.importTerritory,
	"in einer gewählten Ebene stehen alle drei Einträge");

// 🪤 Ein FEHLENDES `showAll` darf nicht heimlich „Alle“ heissen — die Tabelle wird auch von der
// Nachbardatei für den Territorien-Import gefragt.
const ohneAngabe = menue.addHereMenuVisibility({
	mode: "ecosystem", isEditMode: true, isEcosystemEnabled: true, activeKind: "topographie",
});
assert.ok(ohneAngabe.newArea, "ohne Angabe gilt „nicht Alle“ — die sichere Richtung für den Aufrufer");

// ---- 6. Ein laufendes Werkzeug überlebt den Wechsel nach „Alle“ NICHT -------------------------------
//
// 💣 Sonst zeichnet jemand weiter in einer Ansicht, die nicht mehr zeichnet — der Umriss klebte am
// Zeiger, und der abschliessende Doppelklick hätte trotzdem geschrieben.

const beendet = [];
const wechsel = schalterWelt({ gemerktAlle: "0" });
wechsel.isEcosystemDrawing = () => true;
wechsel.cancelEcosystemAreaDrawing = (text) => beendet.push(["zeichnen", text]);
wechsel.activeEcosystemGeometryEdit = { publicId: "f-1" };
wechsel.closeEcosystemGeometryEdit = () => beendet.push(["ecken"]);
wechsel.window.AvesmapsEcosystemBrush = { isActive: () => true, stop: () => beendet.push(["pinsel"]) };
wechsel.window.AvesmapsEcosystemGeometryOps = { isPending: () => true, cancel: () => beendet.push(["operation"]) };
wechsel.setEcosystemShowAllLayers(true);

["zeichnen", "ecken", "pinsel", "operation"].forEach((werkzeug) => {
	assert.ok(beendet.some((eintrag) => eintrag[0] === werkzeug),
		`💣 der Wechsel nach „Alle“ beendet das Werkzeug „${werkzeug}“ nicht`);
});

// Und der Wechsel ZURÜCK in eine Ebene beendet nichts — dort darf weitergearbeitet werden.
beendet.length = 0;
wechsel.setEcosystemShowAllLayers(false);
assert.deepStrictEqual(beendet, [],
	"⚠️ der Weg zurück in eine Ebene räumt keine Arbeit weg — er gibt sie frei");

// ---- 7. Die Regel steht nur EINMAL -----------------------------------------------------------------
//
// 💣 Die Hervorhebung beim Klick auf ein LABEL trug dieselbe Frage ein zweites Mal ausgeschrieben, und
// der Renderer nannte sie daneben „wortgleich". Genau solche Abschriften bleiben stumm zurück: wäre sie
// stehen geblieben, hätte in „Alle" der Klick auf die FLÄCHE hervorgehoben und der auf ihr LABEL nicht.
// ⚠️ Ausnahmsweise am Quelltext geprüft und nicht zur Laufzeit — es ist eine Frage nach einer KOPIE,
// und eine Kopie erkennt man nur am Text. Was die Regel TUT, messen die Fälle darüber.
const labelQuelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-labels.js"), "utf8");
const hervorhebung = labelQuelle.slice(labelQuelle.indexOf("const hebtFlaecheHervor"),
	labelQuelle.indexOf(";", labelQuelle.indexOf("const hebtFlaecheHervor")));
assert.ok(hervorhebung.includes("isEcosystemReaderClick"),
	"die Hervorhebung beim Label-Klick muss die EINE Definition fragen (isEcosystemReaderClick)");
assert.ok(!hervorhebung.includes("canOperateEcosystemLayers"),
	"💣 und die Regel nicht ein zweites Mal ausschreiben — genau so laufen die beiden Klicks auseinander");

console.log("ok - ecosystem-alle-gesperrt");
