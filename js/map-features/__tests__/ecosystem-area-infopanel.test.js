// Der Klick auf eine Landschaftsfläche öffnet im Frontend dasselbe Infopanel wie ein Klick auf ihr
// Label (Owner 2026-08-12). Entwurf:
// docs/superpowers/specs/2026-08-12-landschaften-flaechenklick-infopanel-design.md
//
// 🔴 WARUM DIE WAHL GETRENNT VOM MARKUP GEPRÜFT WIRD. `ecosystemAreaInfoSource` entscheidet, WER
// antwortet -- das Label oder die Fläche --, und tut das ohne Leaflet, ohne DOM und ohne die
// Markup-Bauer. Genau deshalb beweist dieser Teil etwas: es gibt keinen Stub, dessen Rückgabe die
// Antwort schon enthielte. Der Markup-Teil darunter arbeitet mit Stubs, aber mit UNTERSCHEIDBAREN --
// geprüft wird, WELCHER Bauer lief, nicht ob überhaupt einer lief.
//
// js/map-features/ wird als blankes <script> geladen; deshalb dieselbe vm-Bauart wie die Nachbartests.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-rendering.js"), "utf8");
const context = {
	console,
	window: {},
	document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

// ---- Wer beantwortet den Klick? --------------------------------------------------------------------
const flaeche = (extra = {}) => ({
	public_id: "a-1",
	region_public_id: "r-eisenwald",
	region_name: "Eisenwald",
	region_type_label: "Gebirge",
	kind: "topographie",
	...extra,
});
const label = (publicId, text) => ({ publicId, text });

const REGISTER = [label("l-fremd", "Finsterkamm"), label("l-eisen", "Eisenwald"), label("l-spaet", "Nordmark")];

const mitLabel = context.ecosystemAreaInfoSource(flaeche({ label_public_id: "l-eisen" }), REGISTER);
assert(mitLabel && mitLabel.kind === "label", "die Fläche mit primärem Label antwortet über ihr Label");
// 💣 Und über das RICHTIGE. Ein Register mit nur einem Eintrag liesse „nimm das erste" durchgehen.
assert(mitLabel && mitLabel.label && mitLabel.label.publicId === "l-eisen",
	"💣 und zwar über ihr eigenes, nicht über das erste im Register: " + (mitLabel && mitLabel.label && mitLabel.label.publicId));

// 💣 EIN ZEIGER IST KEIN LABEL: `ecosystem_region.label_public_id` überlebt ein von Hand gelöschtes
// Label. Ohne den Rückfall bliebe genau diese Fläche stumm -- ein Klick, auf den nichts geschieht.
const toterZeiger = context.ecosystemAreaInfoSource(flaeche({ label_public_id: "l-geloescht" }), REGISTER);
assert(toterZeiger && toterZeiger.kind === "area", "💣 ein toter Zeiger fällt auf die Fläche zurück, statt zu schweigen");

const ohneLabel = context.ecosystemAreaInfoSource(flaeche(), REGISTER);
assert(ohneLabel && ohneLabel.kind === "area", "eine Fläche ohne primäres Label beantwortet sich selbst");

// Dasselbe, wenn der Bestand noch gar nicht geladen ist -- derselbe Zweig, keine eigene Frage.
assert(context.ecosystemAreaInfoSource(flaeche({ label_public_id: "l-eisen" }), []).kind === "area",
	"ein leeres Register ist der dritte Fall desselben Rückfalls");
assert(context.ecosystemAreaInfoSource(flaeche({ label_public_id: "l-eisen" }), null).kind === "area",
	"und ein fehlendes Register wirft nicht");

assert(context.ecosystemAreaInfoSource(null, REGISTER) === null, "keine Fläche, keine Quelle");

// ---- Welches Markup wird gebaut? -------------------------------------------------------------------
// 🪤 Die beiden Bauer geben UNTERSCHEIDBARE Zeichenketten zurück. Ein Stub, der für beide Zweige
// dasselbe liefert, liesse eine vertauschte Weiche unbemerkt durch.
context.buildRegionLabelViewPopupHtml = (row) => "<label-panel>" + row.text + "</label-panel>";
context.locationPopupMarkup = (spec) => "<area-panel>" + spec.name + "|" + spec.locationTypeLabel + "</area-panel>";
context.regionHeaderImageBasename = (art) => "bild-" + String(art).toLowerCase();
context.escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Der Kopf wird mitgeschrieben, damit die Ebene im Untertitel prüfbar ist -- sie geht als SUFFIX durch
// diesen Bauer, nicht durch locationPopupMarkup.
let letzterKopf = null;
context.infoHeaderImageMarkup = (basename, title, subtitle, coat, images, suffix) => {
	letzterKopf = { basename, title, subtitle, suffix };
	return "<header:" + basename + ">";
};

assert(context.ecosystemAreaInfoMarkup(mitLabel) === "<label-panel>Eisenwald</label-panel>",
	"der Label-Zweig ruft denselben Bauer wie der Label-Klick");
assert(context.ecosystemAreaInfoMarkup(ohneLabel) === "<area-panel>Eisenwald|Gebirge</area-panel>",
	"der Rückfall baut Name + Art in die gemeinsame Hülle");
assert(context.ecosystemAreaInfoMarkup(null) === "", "ohne Quelle kein Markup");

// Eine Fläche ohne alles bleibt ein gültiger Zustand -- der Dialog bietet „— keine Vegetation —" an.
const namenlos = context.ecosystemAreaInfoSource({ public_id: "a-2" }, REGISTER);
assert(context.ecosystemAreaInfoMarkup(namenlos) === "<area-panel>Ohne Namen|</area-panel>",
	"eine namen- und artlose Fläche nennt sich Ohne Namen, statt leer zu bleiben");

// ---- Die Ebene im Untertitel: „Gebirge · Topographie" ----------------------------------------------
context.ecosystemAreaInfoMarkup(ohneLabel);
assert(letzterKopf && letzterKopf.subtitle === "Gebirge" && letzterKopf.suffix === "Topographie",
	"die Ebene steht als zweites Wort neben der Art: " + JSON.stringify(letzterKopf));
assert(letzterKopf.basename === "bild-gebirge", "und das Kopfbild kommt aus der ART, nicht aus der Ebene");

// 💣 KEIN WORT ZWEIMAL, UND KEINES AUS DER ÜBERSCHRIFT. Beide Wiederholungen kommen in den echten
// Landschaftsdaten vor, und beide standen am 2026-08-12 live auf dem Schirm, während sämtliche
// Unit-Tests grün waren. Sie sind der Grund, warum aus zwei Sonderfragen eine Liste wurde.
context.ecosystemAreaInfoMarkup(context.ecosystemAreaInfoSource({ region_name: "Gemäßigte Zone", kind: "klima" }, []));
assert(letzterKopf.subtitle === "Klimazonen" && letzterKopf.suffix === "",
	"💣 die Ebene wiederholt sich nicht, wenn sie schon die Art ist: " + JSON.stringify(letzterKopf));

// Der live gefundene Fall: die Region HEISST wie ihre Art. Ungefiltert las sich das Panel
// „Gemäßigte Zone / Gemäßigte Zone · Klimazonen".
context.ecosystemAreaInfoMarkup(context.ecosystemAreaInfoSource(
	{ region_name: "Gemäßigte Zone", region_type_label: "Gemäßigte Zone", kind: "klima" }, []));
assert(letzterKopf.title === "Gemäßigte Zone" && letzterKopf.subtitle === "Klimazonen" && letzterKopf.suffix === "",
	"💣 die Art verschwindet, wenn sie den Namen wiederholt: " + JSON.stringify(letzterKopf));
// 🔴 Das Kopfbild kommt trotzdem aus der ART -- es bebildert, WAS die Fläche ist.
assert(letzterKopf.basename === "bild-gemäßigte zone", "und das Kopfbild bleibt an der Art: " + letzterKopf.basename);

// Und die Gegenprobe: sagen beide etwas Eigenes, stehen auch beide da.
context.ecosystemAreaInfoMarkup(context.ecosystemAreaInfoSource(
	{ region_name: "Caldaia", region_type_label: "Hochebene", kind: "topographie" }, []));
assert(letzterKopf.subtitle === "Hochebene" && letzterKopf.suffix === "Topographie",
	"zwei verschiedene Wörter bleiben beide stehen: " + JSON.stringify(letzterKopf));

// ---- Das Panel gilt ALLEN, das Leuchten nur dem Leser ----------------------------------------------
//
// 🔴 UMGEDREHT AM 09.09.2026 (Owner: „der linksklick auf ein gebirge löst im editor nicht die infobox
// aus"). Bis dahin hingen Leuchten UND Panel an `isEcosystemReaderClick`, mit der Begründung, es sei
// EINE Geste. Das Leuchten ist es -- eine Hervorhebung und die weisse Auswahlkontur auf derselben
// Fläche sagen nichts mehr. Das Panel ist es NICHT: es liegt rechts und ist keine Kontur.
//
// 💣 UND DIE ALTE REGEL WAR IM EDITOR OHNEHIN NUR HALB WAHR. Der Klick auf das LABEL füllt das Panel
// dort seit jeher (`popupopen` -> avesmapsShowInfopanel, map-features-labels.js) -- älter als der
// Entscheid vom 12.08.2026. Dasselbe Gebirge gab die Auskunft also über einen Weg und über den
// anderen nicht. Gemessen am Dump vom 08.09.2026: von 71 aktiven Gebirgsflächen tragen 47 einen
// Namen, der als KURVE gemalt wird -- und ein Kurvenname hat im Bearbeiten-Modus keinen Marker
// (Kurvenriegel in shouldShowLabelMarker) und keinen Canvas-Schiedsrichter (der steigt bei
// IS_EDIT_MODE aus, damit der Klick die FLÄCHE darunter trifft). Zwei weitere haben gar keinen Namen.
// Für 49 von 71 Gebirgen gab es im Editor damit KEINEN Linksklick, der die Infobox öffnet.
//
// ⭐ Deshalb hängt das Panel jetzt an der FLÄCHE und an nichts sonst: damit antwortet auch der Klick,
// der durch einen Kurvennamen hindurch auf ihr landet.
const gezeigt = [];
context.window.avesmapsShowInfopanel = (html, activeName) => gezeigt.push(activeName + "::" + html);
context.IS_INFOPANEL_MODE = true;
context.labelData = REGISTER;

context.canEditEcosystemOnMap = () => true; // Editor in einer gewählten Ebene
assert(context.isEcosystemReaderClick() === false, "wer hier arbeiten darf, ist kein Leser");
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === true,
	"🔴 im Editor geht das Panel AUCH auf -- die Auskunft steht der Arbeit nicht im Weg");
assert(gezeigt.length === 1 && gezeigt[0] === "Eisenwald::<label-panel>Eisenwald</label-panel>",
	"und zwar mit demselben Markup wie im Frontend: " + gezeigt[0]);

// 🔴 Zwei Fälle, EINE Antwort (23.08.2026): der Besucher ohne Werkzeuge -- und der Editor in „Alle",
// der dort dieselbe Karte sieht wie er. Beide fragen canEditEcosystemOnMap. Das gilt weiter fürs
// LEUCHTEN; das Panel fragt seit dem 09.09.2026 überhaupt nicht mehr danach.
context.canEditEcosystemOnMap = () => false; // Frontend, oder der Editor in „Alle"
assert(context.isEcosystemReaderClick() === true, "wer hier nicht arbeiten darf, klickt lesend");
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === true,
	"im Frontend geht das Panel auf");
assert(gezeigt.length === 2 && gezeigt[1] === "Eisenwald::<label-panel>Eisenwald</label-panel>",
	"mit dem Label-Markup und dem Namen als aktivem Reiter: " + gezeigt[1]);

// Die Fläche ohne Label zeigt ihr eigenes Panel -- der Klick bleibt in JEDEM Fall beantwortet.
assert(context.showEcosystemAreaInfopanel(flaeche()) === true, "auch die Fläche ohne Label zeigt etwas");
assert(gezeigt[2] === "Eisenwald::<area-panel>Eisenwald|Gebirge</area-panel>", "nämlich ihr eigenes: " + gezeigt[2]);

// ⚠️ Ohne Panel-Modus bleibt alles, wie es war -- so hält es der Label-Klick auch. Das ist der EINZIGE
// Riegel, der dem Panel geblieben ist: ohne Panel gibt es kein Ziel.
context.IS_INFOPANEL_MODE = false;
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === false,
	"⚠️ ohne Panel-Modus gibt es kein Ziel, und dann geschieht nichts");
context.IS_INFOPANEL_MODE = true;

// 💣 DER WÄCHTER GEGEN DIE RÜCKKEHR DES RIEGELS. Fehlt der Nachbar, der nach den Werkzeugen fragt,
// antwortet `isEcosystemReaderClick` mit `false` -- wortgleich zu der Lesart, die die Hervorhebung
// seit 2026-08-04 trägt. Das Panel geht trotzdem auf, und genau daran fällt jede „Vereinheitlichung",
// die den Riegel zurückholt: mit ihm wäre dieser Aufruf `false`.
context.canEditEcosystemOnMap = undefined;
assert(context.isEcosystemReaderClick() === false,
	"💣 ohne canEditEcosystemOnMap dieselbe Antwort wie die Hervorhebung: nein");
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === true,
	"💣 und das Panel geht auch dann auf -- es fragt den Riegel nicht mehr");

// ---- Die NAHT: der echte Klick-Handler, ausgeführt -------------------------------------------------
//
// 💣 DIE ZWEI HÄLFTEN OBEN WAREN GRÜN, WÄHREND DIE TRENNUNG UNGEPRÜFT WAR. Gemessen mit einer
// Mutationsprobe am 09.09.2026: nimmt man dem LEUCHTEN seinen `isEcosystemReaderClick`-Riegel, bleibt
// alles darüber grün -- und der Editor bekäme wieder zwei Konturen mit verschiedener Bedeutung auf
// derselben Fläche, also genau das, was die alte Regel verhindern sollte. Seit Leuchten und Panel
// getrennt sind, ist die Trennung selbst die Zusicherung, und sie steht nur im Handler.
//
// Die Bühne ist die von ecosystem-alle-gesperrt.test.js: gerade so viel Leaflet, dass eine Fläche
// entsteht und ihre Handler aufrufbar sind. ZUR LAUFZEIT gezählt, nicht per Grep -- ein Suchmuster
// findet, was jemand hingeschrieben hat, nicht was läuft.
const geometrie = require("../map-features-ecosystem-geometry.js");

function klickBuehne({ darfBearbeiten }) {
	const handler = new Map();
	const spur = { geleuchtet: "", panel: [], toast: [] };
	const layerAttrappe = {
		_ecosystemArea: null,
		_path: { style: {} },
		on(typ, fn) { handler.set(typ, fn); return this; },
		bindTooltip() { return this; },
		closeTooltip() { return this; },
		setStyle() { return this; },
		bringToFront() { return this; },
		getElement() { return this._path; },
	};
	const ctx = {
		console, Map, Array, Number, String, Boolean, Object, JSON, Math,
		module: { exports: {} },
		document: { getElementById: () => null, addEventListener: () => {}, documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		L: { polygon: () => layerAttrappe, DomEvent: { stop: () => {}, stopPropagation: () => {} } },
		ecosystemGeometryParts: geometrie.ecosystemGeometryParts,
		ecosystemGeometryRings: geometrie.ecosystemGeometryRings,
		ecosystemGeometryArea: geometrie.ecosystemGeometryArea,
		ecosystemLayers: new Map(),
		canOperateEcosystemLayers: () => true,
		canEditEcosystemOnMap: () => darfBearbeiten,
		isEcosystemShowAllLayers: () => !darfBearbeiten,
		isEcosystemDrawing: () => false,
		isEcosystemEditingInProgress: () => false,
		isEcosystemGeometryEditOpen: () => false,
		handleEcosystemEditEdgeDoubleClick: () => false,
		setActiveEcosystemLayerKind: () => {},
		// 🪤 KEINE ATTRAPPE FÜR setHighlightedEcosystemRegion -- die Datei DEKLARIERT sie selbst
		// (map-features-ecosystem-rendering.js), und eine Funktionsdeklaration überschreibt im
		// vm-Kontext lautlos, was hier steht. Der Test misst dann die echte Funktion und sieht nichts:
		// eine leere Spur, die wie „wurde nicht gerufen" aussieht. Gemessen wird deshalb ihre WIRKUNG
		// (`clickedEcosystemRegionId`, unten per runInContext gelesen) -- und das ist ohnehin die
		// bessere Zusicherung. Nur Nachbarn, die diese Datei NICHT selbst definiert, dürfen Attrappen
		// sein; so hält es auch ecosystem-alle-gesperrt.test.js.
		showFeedbackToast: (text) => spur.toast.push(text),
		// Die zwei Markup-Bauer wie oben -- unterscheidbar, damit ein vertauschter Zweig auffällt.
		buildRegionLabelViewPopupHtml: (row) => "<label-panel>" + row.text + "</label-panel>",
		locationPopupMarkup: (spec) => "<area-panel>" + spec.name + "</area-panel>",
		regionHeaderImageBasename: (art) => "bild-" + String(art).toLowerCase(),
		infoHeaderImageMarkup: () => "<header>",
		escapeHtml: (v) => String(v),
		IS_INFOPANEL_MODE: true,
		labelData: [label("l-eisen", "Eisenwald")],
	};
	ctx.window = {
		avesmapsEcosystemReichtWeiter: () => false,
		AvesmapsEcosystemAreaMenu: { open: () => {} },
		AvesmapsEcosystemGeometryOps: { claimsMapClick: () => false, handleAreaClick: () => false },
		AvesmapsEcosystemTerritoryImport: { claimsMapClick: () => false },
		avesmapsShowInfopanel: (html, name) => spur.panel.push(name + "::" + (typeof html === "function" ? html() : html)),
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	vm.runInContext(source, ctx);

	const flaeche = {
		public_id: "f-1",
		region_public_id: "r-eisenwald",
		region_name: "Eisenwald",
		region_type_label: "Gebirge",
		kind: "topographie",
		label_public_id: "l-eisen",
		geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
	};
	const gebaut = ctx.buildEcosystemAreaLayer(flaeche);
	assert(Boolean(gebaut), "Vorbedingung: buildEcosystemAreaLayer hat eine Fläche gebaut");
	layerAttrappe._ecosystemArea = flaeche;
	handler.get("click")({
		originalEvent: { clientX: 5, clientY: 5, type: "click", target: layerAttrappe._path },
		latlng: { lat: 5, lng: 5 },
	});
	spur.geleuchtet = String(vm.runInContext("clickedEcosystemRegionId", ctx) || "");
	return spur;
}

// 🔴 DER EDITOR: Auskunft ja, Leuchten nein.
const imEditor = klickBuehne({ darfBearbeiten: true });
assert(imEditor.panel.length === 1 && imEditor.panel[0] === "Eisenwald::<label-panel>Eisenwald</label-panel>",
	"🔴 der Klick im Editor öffnet das Panel: " + JSON.stringify(imEditor.panel));
assert(imEditor.geleuchtet === "",
	"💣 und leuchtet NICHT -- die weisse Auswahlkontur ist dort schon die Antwort: " + JSON.stringify(imEditor.geleuchtet));
assert(imEditor.toast.length === 0,
	"⚠️ der Schwebezettel entfällt, sobald das Panel den Satz trägt: " + JSON.stringify(imEditor.toast));

// 🔴 DER LESER: beides.
const imFrontend = klickBuehne({ darfBearbeiten: false });
assert(imFrontend.panel.length === 1, "im Frontend öffnet derselbe Klick dasselbe Panel");
assert(imFrontend.geleuchtet === "r-eisenwald",
	"🔴 und leuchtet zusätzlich die Fläche auf: " + JSON.stringify(imFrontend.geleuchtet));

if (failures > 0) {
	console.error(`ecosystem-area-infopanel.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-area-infopanel.test: OK -- Label wenn da, Fläche sonst, Panel für Leser UND Editor");
