// Wer darf die Landschaften ANSEHEN, und wer darf sie BEDIENEN? Zwei Fragen, seit dem 2026-08-04.
//
// 🔴 WARUM DAS EIN TEST IST UND KEIN KOMMENTAR. Bis heute war es EINE Frage, und beide Antworten hingen
// an derselben Variablen. Wer sie wieder zusammenzieht, nimmt entweder jedem Besucher die Ansicht --
// oder er gibt jedem Besucher die Werkzeuge. Das erste fällt beim Bauen auf, das zweite nicht: die
// Kacheln erscheinen, der Untergrund blasst aus, und der Editor-Endpunkt antwortet mit 403, während
// alles danach aussieht, als funktioniere es.
//
// js/map-features/ wird als blankes <script> geladen; deshalb dieselbe vm-Bauart wie die Nachbartests.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"), "utf8");

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

// Eine frische Welt je Fall: der gemerkte „Alle"-Wert wird im Modul zwischengespeichert, und zwei Fälle
// im selben Kontext würden sich gegenseitig die Antwort vorgeben.
function welt({ modus = "ecosystem", recht = false, editor = true, gemerktAlle = "0" } = {}) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		// Steht sonst in js/app/runtime-state.js bzw. weiter oben im Modul; hier nur so viel, dass
		// getActiveEcosystemLayerKind() eine Antwort geben kann.
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: "vegetation",
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return context;
}

// ---- ANSEHEN: jeder, sobald der Modus gewählt ist --------------------------------------------------
const besucher = welt({ recht: false, editor: false });
assert(besucher.isEcosystemLayerModeActive(),
	"🔴 der gewöhnliche Besucher SIEHT die Ebene -- das ist die Freischaltung vom 2026-08-04");
assert(!besucher.canOperateEcosystemLayers(), "bedienen darf er sie nicht");

const daneben = welt({ modus: "political", recht: true, editor: true });
assert(!daneben.isEcosystemLayerModeActive(), "in einem anderen Kartenmodus ist die Ebene aus");
assert(daneben.canOperateEcosystemLayers(),
	"das Bedienrecht haengt nicht am Kartenmodus -- es gilt auch daneben");

// ---- BEDIENEN braucht ZWEI Dinge: den Editor-Kontext UND das Recht ----------------------------------
// 💣 DER FALL, DER GEMELDET WURDE (Owner 2026-08-04, auf avesmaps.de stehend): angemeldet, alle Rechte,
// aber auf der ÖFFENTLICHEN Karte -- und die Leiste stand trotzdem da. Das Recht allein genügt nicht.
// Die Werkzeuge gehören dem Editor, nicht dem Konto.
const angemeldetImFrontend = welt({ recht: true, editor: false });
assert(angemeldetImFrontend.isEcosystemLayerModeActive(), "er sieht die Ebene wie jeder andere");
assert(!angemeldetImFrontend.canOperateEcosystemLayers(),
	"💣 aber KEINE Werkzeuge auf der oeffentlichen Karte -- egal welches Recht im Hintergrund liegt");

const imEditorOhneRecht = welt({ recht: false, editor: true });
assert(!imEditorOhneRecht.canOperateEcosystemLayers(),
	"umgekehrt oeffnet `?edit=1` allein gar nichts -- der Parameter ist ungeprueft und war nie der Riegel");

const imEditor = welt({ recht: true, editor: true });
assert(imEditor.canOperateEcosystemLayers(), "erst beides zusammen gibt die Werkzeuge frei");

// ---- die VORGABE haengt am Recht, die WAHL an niemandem ---------------------------------------------
// Seit der Besucher die Kacheln bekommt (Owner 2026-08-04), waehlt er selbst. Nur wer noch nie gewaehlt
// hat, faellt in eine Vorgabe -- und die ist fuer ihn die Uebersicht, fuer den Editor seine Arbeitsebene.
const besucherOhneWahl = welt({ recht: false, editor: false, gemerktAlle: null });
assert(besucherOhneWahl.isEcosystemShowAllLayers(),
	"ohne eigene Wahl sieht der Besucher die Uebersicht");
const editorOhneWahl = welt({ recht: true, editor: true, gemerktAlle: null });
assert(!editorOhneWahl.isEcosystemShowAllLayers(),
	"der Editor faengt dagegen in seiner Arbeitsebene an");

// 🔴 Eine getroffene Wahl schlaegt die Vorgabe -- bei beiden.
const besucherMitWahl = welt({ recht: false, editor: false, gemerktAlle: "0" });
assert(!besucherMitWahl.isEcosystemShowAllLayers(),
	"🔴 der Besucher, der eine Ebene gewaehlt hat, behaelt sie");
const editorAlle = welt({ recht: true, editor: true, gemerktAlle: "1" });
assert(editorAlle.isEcosystemShowAllLayers(), "und der Editor, der Alle gewaehlt hat, behaelt Alle");

// 💣 EIN LEERER SPEICHERWERT IST KEINE WAHL. Waere die Vorgabe wie ein gewaehlter Wert gemerkt, entschiede
// der Zufall: die Rechteauskunft ist beim ersten Lesen fast immer noch unterwegs, und ein Editor bliebe
// die ganze Sitzung in Alle haengen, ohne je etwas gewaehlt zu haben.
const kaputterSpeicher = welt({ recht: true, editor: true, gemerktAlle: "vielleicht" });
assert(!kaputterSpeicher.isEcosystemShowAllLayers(),
	"ein unbrauchbarer Speicherwert zaehlt nicht als Wahl");

// Und in „Alle" ist jede Ebene sichtbar -- das ist, was es bedeutet.
const sichtbar = welt({ recht: false, editor: false, gemerktAlle: null });
["derographisch", "vegetation", "topographie", "klima"].forEach((kind) => {
	assert(sichtbar.isEcosystemKindVisible(kind), `in Alle ist ${kind} sichtbar`);
});
// Waehlt er eine, ist auch nur die eine sichtbar.
const eineEbene = welt({ recht: false, editor: false, gemerktAlle: "0" });
assert(eineEbene.isEcosystemKindVisible("vegetation"), "die gewaehlte Ebene ist sichtbar");
assert(!eineEbene.isEcosystemKindVisible("klima"), "die anderen nicht");

// ---- was vom Bedienfeld wer zu sehen bekommt --------------------------------------------------------
// 🔴 Owner 2026-08-04: „einfach die Toggle-Buttons anzeigen, die wir auch im Edit-Modus sehen." Die
// Ebenen-Kacheln sind keine Werkzeuge, sondern die Frage „welche Ebene schaue ich an". Der
// Untergrund-REGLER bleibt dagegen dem Editor -- er ist eine Zeichenhilfe.
function feldWelt({ recht, editor, modus = "ecosystem" }) {
	const untergrund = { hidden: false };
	const felder = { "ecosystem-controls": { hidden: true, querySelector: () => untergrund } };
	const context = {
		console,
		window: { localStorage: { getItem: () => null, setItem: () => {} } },
		document: {
			getElementById: (id) => felder[id] || null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: "vegetation",
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	context.syncEcosystemControlsVisibility();
	return { feld: felder["ecosystem-controls"], untergrund };
}

const beimBesucher = feldWelt({ recht: false, editor: false });
assert(beimBesucher.feld.hidden === false, "🔴 der Besucher SIEHT die Ebenen-Kacheln");
assert(beimBesucher.untergrund.hidden === true, "🪤 aber nicht den Untergrund-Regler");

const beimEditor = feldWelt({ recht: true, editor: true });
assert(beimEditor.feld.hidden === false, "der Editor sieht das Feld");
assert(beimEditor.untergrund.hidden === false, "und seinen Regler dazu");

const daneben2 = feldWelt({ recht: true, editor: true, modus: "political" });
assert(daneben2.feld.hidden === true, "ausserhalb des Landschaftsmodus ist das Feld weg");

// ---- eine gewaehlte Ebene zeigt nur ihre eigenen Beschriftungen -------------------------------------
// 🔴 Owner 2026-08-04: „Waelder bei Vegetation, Namen der Klimazonen, etc. -- bei Alle darf alles
// dranstehen." Die Regel wohnt in map-features-labels.js, wird aber von DIESEM Modul beantwortet
// (welche Ebene ist gewaehlt, und ist es Alle) -- deshalb steht sie hier mit.
const labelQuelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
function labelWelt({ recht, editor, gemerktAlle, ebene = "vegetation", modus = "ecosystem" }) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	// Nur die eine reine Funktion aus der Label-Datei nachziehen -- der Rest von ihr braucht Leaflet.
	const anfang = labelQuelle.indexOf("function isLabelOfActiveEcosystemLayer");
	const ende = labelQuelle.indexOf("\n}", anfang) + 2;
	vm.runInContext(labelQuelle.slice(anfang, ende), context);
	return context;
}

const inVegetation = labelWelt({ recht: false, editor: false, gemerktAlle: "0", ebene: "vegetation" });
assert(inVegetation.isLabelOfActiveEcosystemLayer({ ecosystemRegionKind: "vegetation" }),
	"in Vegetation steht der Wald dran");
assert(!inVegetation.isLabelOfActiveEcosystemLayer({ ecosystemRegionKind: "topographie" }),
	"🔴 das Gebirge nicht");
assert(!inVegetation.isLabelOfActiveEcosystemLayer({}),
	"🪤 und eine Beschriftung ohne Flaeche auch nicht -- nur die, die fuer die Zone gelten");

const inAlle = labelWelt({ recht: false, editor: false, gemerktAlle: "1" });
["vegetation", "topographie", "klima", "derographisch"].forEach((kind) => {
	assert(inAlle.isLabelOfActiveEcosystemLayer({ ecosystemRegionKind: kind }), `in Alle steht ${kind} dran`);
});
assert(inAlle.isLabelOfActiveEcosystemLayer({}), "in Alle steht auch das Ortsschild dran");

// Ausserhalb des Landschaftsmodus gilt die Regel gar nicht -- sonst waere die normale Karte leer.
const normaleKarte = labelWelt({ recht: false, editor: false, gemerktAlle: "0", modus: "deregraphic" });
assert(normaleKarte.isLabelOfActiveEcosystemLayer({}),
    "💣 ohne Landschaftsmodus bleibt jede Beschriftung stehen");

// ---- der Untergrund: 25 % fuer den Besucher, sein Regler fuer den Editor ----------------------------
// 💣 Der Besucher bekommt einen FESTEN Wert, nicht den gespeicherten. Der liegt je Browser, und wer
// irgendwann einmal auf 0 gezogen hat, saehe eine leere weisse Karte -- ohne Regler, mit dem er wieder
// herauskaeme. Ein fester Wert ist hier das Gegenteil einer Einschraenkung.
function untergrundWelt({ recht, editor, gespeichert }) {
	const pane = { style: {} };
	const container = { style: {} };
	const context = {
		console,
		window: { localStorage: { getItem: () => gespeichert, setItem: () => {} },
			getComputedStyle: () => ({ getPropertyValue: () => "#ffffff" }) },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {},
			documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "#ffffff" }),
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		map: { getPane: (name) => (name === "tilePane" ? pane : null), getContainer: () => container },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return { context, pane };
}

const besucherUntergrund = untergrundWelt({ recht: false, editor: false, gespeichert: "0" });
besucherUntergrund.context.applyEcosystemUndergroundOpacity(true);
assert(besucherUntergrund.pane.style.opacity === "0.25",
	"💣 der Besucher bekommt die festen 25 % -- nicht die 0, die in seinem Browser steht: " + besucherUntergrund.pane.style.opacity);

const editorUntergrund = untergrundWelt({ recht: true, editor: true, gespeichert: "40" });
editorUntergrund.context.applyEcosystemUndergroundOpacity(true);
assert(editorUntergrund.pane.style.opacity === "0.4",
	"der Editor bekommt seinen Regler: " + editorUntergrund.pane.style.opacity);

const verlassen = untergrundWelt({ recht: false, editor: false, gespeichert: "0" });
verlassen.context.applyEcosystemUndergroundOpacity(false);
assert(verlassen.pane.style.opacity === "",
	"beim Verlassen ist die Karte wieder ganz da -- sonst bliebe sie in jedem anderen Modus blass");

// ---- Orte treten im Landschaftsmodus zurück -- und kommen zurück ------------------------------------
// 🔴 Der zweite Teil ist der, der weh tut, wenn er fehlt: ohne ihn nähme ein Besuch der Landschaften dem
// Nutzer seine Ortsauswahl DAUERHAFT weg. Er kommt zurück nach „Politisch", seine Metropolen sind fort,
// und nichts sagt ihm, wer sie ausgeschaltet hat.
function schalterWelt() {
	const zustand = { metropole: true, grossstadt: true, stadt: false, kleinstadt: false, dorf: false, gebaeude: false };
	const knopf = (typ) => ({
		hasClass: () => zustand[typ],
		removeClass: () => { zustand[typ] = false; },
		toggleClass: (_klasse, an) => { zustand[typ] = Boolean(an); },
	});
	const context = {
		console,
		window: { localStorage: { getItem: () => "0", setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: false,
		IS_EDIT_MODE: false,
		LOCATION_TYPE_VISIBILITY_ORDER: ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"],
		getLocationToggleButton: knopf,
		syncLocationMarkerVisibility: () => {},
		syncLocationToggleButtons: () => {},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return { context, zustand };
}

const s = schalterWelt();
const sichtbareOrte = () => Object.values(s.zustand).filter(Boolean).length;
assert(sichtbareOrte() === 2, "vorher stehen zwei Ortsstufen auf sichtbar");

s.context.syncEcosystemSettlementVisibility(true);
assert(sichtbareOrte() === 0, "im Landschaftsmodus treten sie zurück");

// 💣 Ein zweiter Durchlauf MITTEN im Modus (die Rechteauskunft trifft ein, der Nutzer wechselt die
// Ebene) darf die inzwischen leere Lage nicht als „das war schon immer so" festschreiben.
s.context.syncEcosystemSettlementVisibility(true);
s.context.syncEcosystemSettlementVisibility(false);
assert(s.zustand.metropole === true && s.zustand.grossstadt === true,
	"💣 beim Verlassen steht die Auswahl von vorher wieder da -- auch nach mehrfachem Eintreten");
assert(s.zustand.stadt === false, "und was aus war, bleibt aus");

// Ausserhalb des Modus zu 'verlassen' ist ein No-op und darf nichts anfassen.
s.zustand.dorf = true;
s.context.syncEcosystemSettlementVisibility(false);
assert(s.zustand.dorf === true, "ohne vorheriges Eintreten wird nichts zurückgesetzt");

// ---- DIE ZWEI GESTEN AN DER FLÄCHE SELBST ----------------------------------------------------------
// 💣 DER GEMELDETE FALL (Owner 2026-08-05): „ich kann überall auf avesmaps, wenn ich nicht im Edit-Modus
// bin, Dinge verändern -- Rechtsklick auf irgendeine Fläche und Eigenschaften ändern."
//
// 🔴 WARUM ES DIESE ZWEI SIND. Bis zum 2026-08-04 war der MODUS der Riegel: in die Landschaften-Ebene kam
// nur, wer das Recht hatte, also brauchte keine einzelne Geste einen eigenen. Seit die Ebene jedem
// Besucher offensteht, trägt jede Geste ihre Frage selbst -- und diese beiden hatten sie nicht:
//
//   Rechtsklick   -> das Flächenmenü mit „Eigenschaften …", „Fläche löschen", malen, radieren,
//                    vereinfachen, verschmelzen, zerschneiden, verschieben
//   Doppelklick   -> der Ecken-Editor mit ziehbaren Griffen
//
// 💣 Für einen ANGEMELDETEN Editor auf der öffentlichen Karte gingen diese Schreibvorgänge WIRKLICH durch:
// api/edit/map/ecosystem.php fragt das Sitzungs-Cookie, nicht ob jemand in /edit/ steht.
//
// 🪤 Ohne `stop` aussteigen, nicht mit -- sonst verlöre der Besucher an jeder Fläche das Kartenmenü
// („Hierher reisen", „Entfernung messen") und seinen Doppelklick-Zoom. Genau das prüfen die zwei
// gestoppt-Zusicherungen unten mit.
const renderQuelle = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-rendering.js"), "utf8");

function flaechenWelt({ bedienen }) {
	const gezaehlt = { menu: 0, ecken: 0, gestoppt: 0 };
	const gesten = new Map();
	const flaeche = {
		on: (name, handler) => { gesten.set(name, handler); },
		bindTooltip: () => {},
		closeTooltip: () => {},
		getElement: () => null,
	};
	const context = {
		console,
		window: {
			AvesmapsEcosystemAreaMenu: { open: () => { gezaehlt.menu += 1; } },
		},
		document: {
			documentElement: {},
			getElementById: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getComputedStyle: () => ({ getPropertyValue: () => "#654321" }),
		L: {
			polygon: () => flaeche,
			DomEvent: {
				stop: () => { gezaehlt.gestoppt += 1; },
				stopPropagation: () => {},
			},
		},
		canOperateEcosystemLayers: () => bedienen,
		openEcosystemGeometryEdit: () => { gezaehlt.ecken += 1; },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(renderQuelle, context);

	// 💣 GEGENPROBE ZUR SANDKASTEN-FALLE: die geprüften Handler sind gegen fehlende Globals gehärtet
	// (`typeof … === "function" && …`). Fehlte die Rechtefrage hier, liefen sie in ihre Notbremse und
	// dieser Test wäre grün, ohne die Regel je ausgeführt zu haben.
	assert(typeof context.canOperateEcosystemLayers === "function",
		"die Rechtefrage muss im Sandkasten stehen, sonst prueft dieser Test die Notbremse");

	const gebaut = context.buildEcosystemAreaLayer({
		public_id: "eco-1",
		kind: "vegetation",
		region_name: "Testwald",
		region_type: "wald",
		geometry_revision: 3,
		geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
	});
	assert(gebaut === flaeche, "die Flaeche wurde gebaut");
	return { gesten, gezaehlt };
}

const ereignis = () => ({ originalEvent: { ctrlKey: false, metaKey: false, clientX: 5, clientY: 5 }, latlng: { lat: 1, lng: 1 } });

const besucherFlaeche = flaechenWelt({ bedienen: false });
besucherFlaeche.gesten.get("contextmenu")(ereignis());
assert(besucherFlaeche.gezaehlt.menu === 0,
	"💣 KEIN Flaechenmenue ohne Bedienrecht -- es traegt Eigenschaften, Loeschen, Malen, Vereinfachen");
assert(besucherFlaeche.gezaehlt.gestoppt === 0,
	"🪤 und das Ereignis laeuft weiter zum Kartenmenue, statt verschluckt zu werden");

besucherFlaeche.gesten.get("dblclick")(ereignis());
assert(besucherFlaeche.gezaehlt.ecken === 0, "💣 und keine Eckengriffe ohne Bedienrecht");
assert(besucherFlaeche.gezaehlt.gestoppt === 0,
	"🪤 der Doppelklick bleibt beim Besucher der Zoom, den er ueberall sonst auch ist");

const editorFlaeche = flaechenWelt({ bedienen: true });
editorFlaeche.gesten.get("contextmenu")(ereignis());
assert(editorFlaeche.gezaehlt.menu === 1, "der Editor bekommt sein Flaechenmenue");
editorFlaeche.gesten.get("dblclick")(ereignis());
assert(editorFlaeche.gezaehlt.ecken === 1, "und seine Eckengriffe");

// ---- der Gipfel ist ein ARBEITSPUNKT, kein Ortsschild -----------------------------------------------
// 💣 Dieselbe Wurzel wie die zwei Gesten oben, nur unauffälliger: `map-label--eco-peak` gibt dem Label
// `cursor: grab`, und syncEcosystemPeakDragging schaltet daraufhin sein Ziehen frei. Beides hing allein
// an „Ebene sichtbar + Topographie" -- also bekam es auch der gewöhnliche Besucher.
//
// 🪤 `draggable: false` beim Anlegen schützt NICHT: Leaflet 1.9.4 legt `marker.dragging` an jedem
// anklickbaren Marker an (`this.dragging = new pi(this)` in `_initInteraction`) und lässt es nur
// abgeschaltet. Ein späteres enable() greift deshalb sofort. Genau das ist hier nachgebaut.
function gipfelWelt({ recht, editor }) {
	const gezogen = { ein: 0, aus: 0 };
	const marker = {
		dragging: { enable: () => { gezogen.ein += 1; }, disable: () => { gezogen.aus += 1; } },
		getElement: () => null,
	};
	const context = {
		console,
		window: { localStorage: { getItem: () => "0", setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: "topographie",
		// Die echten Nachbarn der Frage: ohne sie fiele isEcosystemPeakLabel in seine Notbremse und
		// „kein Gipfel" käme aus dem falschen Grund heraus.
		isEcosystemPeakSubtype: (typ) => typ === "berggipfel",
		labelData: [{ publicId: "lbl-1", labelType: "berggipfel" }],
		labelMarkers: [{ label: { publicId: "lbl-1" }, marker }],
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	assert(context.isEcosystemPeakLabel("lbl-1"), "der Nachbar erkennt den Gipfel wirklich als Gipfel");
	return { context, gezogen };
}

const gipfelBesucher = gipfelWelt({ recht: false, editor: false });
assert(!gipfelBesucher.context.isEcosystemPeakActive("lbl-1"),
	"💣 fuer den Besucher ist ein Gipfel kein Arbeitspunkt -- kein Greifzeiger, keine Ausnahme");
gipfelBesucher.context.syncEcosystemPeakDragging();
assert(gipfelBesucher.gezogen.ein === 0 && gipfelBesucher.gezogen.aus === 1,
	"💣 und sein Ziehen wird ausdruecklich ABGESCHALTET, nicht bloss nicht eingeschaltet");

const gipfelEditor = gipfelWelt({ recht: true, editor: true });
assert(gipfelEditor.context.isEcosystemPeakActive("lbl-1"), "der Editor behaelt seinen Arbeitspunkt");
gipfelEditor.context.syncEcosystemPeakDragging();
assert(gipfelEditor.gezogen.ein === 1, "und zieht ihn ohne Zwischenschritt (V8)");

// ---- die Naht zwischen Server und Karte: was der SCHREIBWEG antwortet -------------------------------
//
// 🔴 Ein frisch dupliziertes, verschobenes oder gespeichertes Label kommt NICHT aus dem Kartenpayload,
// sondern aus der Antwort von api/edit/map/features.php -- und der Client baut daraus dasselbe Objekt
// (normalizeLabelFeature). Fehlt darin `ecosystem_region_kind`, faellt das Label aus seiner eigenen
// Ebene und steht nur noch unter „Alle" (Owner 2026-08-05, dupliziertes Label). Der Server fuellt das
// Feld seit avesmapsEcosystemEnrichEditLabelFeature; DIESER Test haelt fest, dass der Schluessel auf
// beiden Seiten derselbe ist -- ein Tippfehler im PHP-Feldnamen ist auf keiner Seite allein zu sehen.
function antwortWelt({ ebene = "vegetation", gemerktAlle = "0" } = {}) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: true,
		IS_EDIT_MODE: true,
		isKnownEcosystemKind: () => true,
		activeEcosystemLayerKind: ebene,
		// Rand, nicht Regel: die Quellenuebernahme hat mit der Ebenenfrage nichts zu tun.
		readFeatureOtherSource: () => null,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	// Die drei ECHTEN Funktionen aus der Label-Datei -- die Umwandlung, ihre Hoehenhilfe und die Regel.
	// Nachgebaut waere genau der Feldname weg, um den es hier geht.
	["function readLabelHeightSchritt", "function normalizeLabelFeature", "function isLabelOfActiveEcosystemLayer"]
		.forEach((kopf) => {
			const anfang = labelQuelle.indexOf(kopf);
			vm.runInContext(labelQuelle.slice(anfang, labelQuelle.indexOf("\n}", anfang) + 2), context);
		});
	return context;
}

// Die Antwort, wie der Schreibweg sie seit dem Fix baut: der eigene Zeiger UND die aufgeloeste Ebene.
const klonAntwort = {
	type: "Feature",
	id: "l-klon",
	geometry: { type: "Point", coordinates: [12, 34] },
	properties: {
		feature_type: "label", public_id: "l-klon", text: "Finsterkamm", feature_subtype: "wald",
		ecosystem_region_public_id: "r-wald", ecosystem_region_kind: "vegetation",
	},
};

const inVeg = antwortWelt({ ebene: "vegetation" });
const klonLabel = inVeg.normalizeLabelFeature(klonAntwort);
assert(klonLabel.ecosystemRegionKind === "vegetation",
	"💣 normalizeLabelFeature muss genau `ecosystem_region_kind` lesen -- den Namen, den der Server schreibt");
assert(inVeg.isLabelOfActiveEcosystemLayer(klonLabel),
	"💣 der Klon steht in seiner eigenen Ebene auf der Karte, nicht erst unter Alle");

const inTopo = antwortWelt({ ebene: "topographie" });
assert(!inTopo.isLabelOfActiveEcosystemLayer(inTopo.normalizeLabelFeature(klonAntwort)),
	"und in der Topographie eben nicht -- die Regel bleibt scharf");

// Der gemeldete Fehler selbst, festgenagelt: dieselbe Antwort OHNE das Feld verschwindet aus der Ebene.
const ohneEbene = JSON.parse(JSON.stringify(klonAntwort));
delete ohneEbene.properties.ecosystem_region_kind;
assert(!inVeg.isLabelOfActiveEcosystemLayer(inVeg.normalizeLabelFeature(ohneEbene)),
	"🪤 ohne das Feld faellt das Label aus seiner Ebene -- genau der gemeldete Fehler");

if (failures > 0) {
	console.error(`ecosystem-access.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-access.test: OK -- ansehen darf jeder, bedienen nur der Editor mit Recht");
