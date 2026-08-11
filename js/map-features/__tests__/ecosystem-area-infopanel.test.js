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

// ⚠️ NUR wenn sie etwas Neues sagt. Eine Fläche ohne Art trägt die Ebene bereits ALS Art -- sonst
// stünde dort „Klimazonen · Klimazonen", das Ergebnis einer Ableitung, die sich selbst nicht erkennt.
context.ecosystemAreaInfoMarkup(context.ecosystemAreaInfoSource({ region_name: "Gemäßigte Zone", kind: "klima" }, []));
assert(letzterKopf.subtitle === "Klimazonen" && letzterKopf.suffix === "",
	"⚠️ die Ebene wiederholt sich nicht, wenn sie schon die Art ist: " + JSON.stringify(letzterKopf));

// ---- Der Riegel: Leser ja, Editor nein --------------------------------------------------------------
// 🔴 EINE Frage für Leuchten UND Panel. Beide hängen an `isEcosystemReaderClick` -- an zwei getrennten
// Bedingungen liessen sie sich auseinander pflegen, und der Klick täte danach die Hälfte.
const gezeigt = [];
context.window.avesmapsShowInfopanel = (html, activeName) => gezeigt.push(activeName + "::" + html);
context.IS_INFOPANEL_MODE = true;
context.labelData = REGISTER;

context.canOperateEcosystemLayers = () => true; // Editor
assert(context.isEcosystemReaderClick() === false, "wer die Werkzeuge hat, ist kein Leser");
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === false,
	"🔴 im Editor geht KEIN Panel auf -- dort heisst der Klick: daran arbeite ich");
assert(gezeigt.length === 0, "und es wurde auch wirklich nichts gezeigt");

context.canOperateEcosystemLayers = () => false; // Frontend
assert(context.isEcosystemReaderClick() === true, "ohne Werkzeuge ist es ein Leserklick");
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === true,
	"im Frontend geht das Panel auf");
assert(gezeigt.length === 1 && gezeigt[0] === "Eisenwald::<label-panel>Eisenwald</label-panel>",
	"mit dem Label-Markup und dem Namen als aktivem Reiter: " + gezeigt[0]);

// Die Fläche ohne Label zeigt ihr eigenes Panel -- der Klick bleibt in JEDEM Fall beantwortet.
assert(context.showEcosystemAreaInfopanel(flaeche()) === true, "auch die Fläche ohne Label zeigt etwas");
assert(gezeigt[1] === "Eisenwald::<area-panel>Eisenwald|Gebirge</area-panel>", "nämlich ihr eigenes: " + gezeigt[1]);

// ⚠️ Ohne Panel-Modus bleibt alles, wie es war -- so hält es der Label-Klick auch.
context.IS_INFOPANEL_MODE = false;
assert(context.showEcosystemAreaInfopanel(flaeche({ label_public_id: "l-eisen" })) === false,
	"⚠️ ohne Panel-Modus gibt es kein Ziel, und dann geschieht nichts");
context.IS_INFOPANEL_MODE = true;

// 💣 Fehlt der Nachbar, der nach den Werkzeugen fragt, geschieht NICHTS -- wortgleich zu der Lesart,
// die die Hervorhebung seit 2026-08-04 trägt. Ein Riegel, der bei fehlendem Nachbarn aufgeht, wäre
// hier zwar harmlos, aber er widerspräche der Zeile daneben, und genau das ist die Divergenz.
context.canOperateEcosystemLayers = undefined;
assert(context.isEcosystemReaderClick() === false,
	"💣 ohne canOperateEcosystemLayers dieselbe Antwort wie die Hervorhebung: nein");

if (failures > 0) {
	console.error(`ecosystem-area-infopanel.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-area-infopanel.test: OK -- Label wenn da, Fläche sonst, Editor schweigt");
