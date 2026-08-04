// Die Hervorhebung: welche REGION der Leser gerade meint, und was davon leuchtet bzw. eine Kontur
// bekommt. Gewachsen in drei Schritten (Owner 2026-08-04): Klick auf einen Zonennamen, dann Überfahren,
// dann „ein Klick auf die Labels sollte immer auch die entsprechende Fläche markieren".
//
// 🔴 WARUM DAS EIN EIGENER TEST IST. Der Zustand ist winzig -- zwei Zeichenketten -- und trotzdem der
// Teil, der beim Bauen dreimal falsch war: einmal ging der angeklickte beim ersten Zeigen auf einen
// fremden Namen verloren, einmal blieb die Kontur bei einer Fläche liegen, die gar nicht mehr leuchtete,
// und einmal erschien sie nach dem Klick überhaupt nicht. Keiner der drei Fälle faellt auf, wenn man
// immer nur EIN Label anfasst.
//
// js/map-features/ wird als blankes <script> geladen; deshalb dieselbe vm-Bauart wie die Nachbartests.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-rendering.js"), "utf8");
const context = {
	console,
	window: {},
	// addEventListener nur, damit die Datei laedt: sie haengt beim Laden EINEN Zuhoerer ans Dokument
	// (der Klick, der die Hervorhebung wieder loescht). Der Zuhoerer selbst ist DOM-Verdrahtung und wird
	// hier nicht geprueft -- geprueft wird die Regel, die er aufruft.
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

// ---- welche Flaeche leuchtet? ----------------------------------------------------------------------
// 🔴 Gemerkt wird die REGION, nicht die Flaeche und nicht das Label. Eine Region kann mehrere Flaechen
// haben, und ein Label zeigt auf die REGION (properties.ecosystem_region_public_id). Ueber den Namen zu
// vergleichen liesse bei zwei gleichnamigen die falsche leuchten -- der Name ist im Editor frei.
const flaeche = (regionId, kind = "klima") => ({ kind, region_public_id: regionId, region_name: "Gemäßigte Zone" });

assert(context.shouldHighlightEcosystemArea(flaeche("r-gemaessigt"), "r-gemaessigt"),
	"die Flaeche der gemeinten Region leuchtet");
assert(!context.shouldHighlightEcosystemArea(flaeche("r-tropisch"), "r-gemaessigt"),
	"die Nachbarregion nicht -- auch wenn sie genauso heisst");
assert(!context.shouldHighlightEcosystemArea(flaeche("r-gemaessigt"), ""),
	"ohne Auswahl leuchtet gar nichts (der Zustand nach einem Klick woanders hin)");
assert(!context.shouldHighlightEcosystemArea(null, "r-gemaessigt"), "keine Flaeche, kein Leuchten");
assert(!context.shouldHighlightEcosystemArea(flaeche(""), ""), "und eine Flaeche ohne Region auch nicht");

// 🔴 JEDE Ebene, nicht nur klima (Owner 2026-08-04: „in allen Landschaftsmodi ... ein Klick auf
// Aventurien soll auch die aventurische Flaeche highlighten"). Aventurien ist ein Kontinent-Label und
// haengt an einer derographischen Flaeche -- die Regel darf also nicht nach der Ebene fragen.
assert(context.shouldHighlightEcosystemArea(flaeche("r-aventurien", "derographisch"), "r-aventurien"),
	"🔴 eine derographische Flaeche genauso -- Aventurien ist keine Klimazone");
assert(context.shouldHighlightEcosystemArea(flaeche("r-wald", "vegetation"), "r-wald"), "Vegetation auch");
assert(context.shouldHighlightEcosystemArea(flaeche("r-gebirge", "topographie"), "r-gebirge"), "Topographie auch");

// ---- angeklickt und ueberfahren sind ZWEI Zustaende -------------------------------------------------
// 🔴 Der ueberfahrene ist geliehen: er gewinnt, solange die Maus liegt, und gibt danach an den
// angeklickten zurueck. Mit einer einzigen Variablen ginge der angeklickte beim ersten Zeigen auf ein
// fremdes Label verloren, und das Loslassen liesse die Karte leer zurueck.
context.setHighlightedEcosystemRegion("");
assert(context.effectiveEcosystemRegionId() === "", "am Anfang leuchtet nichts");

context.setHoveredEcosystemRegion("r-boreal");
assert(context.effectiveEcosystemRegionId() === "r-boreal", "Ueberfahren allein laesst die Flaeche leuchten");
context.setHoveredEcosystemRegion("");
assert(context.effectiveEcosystemRegionId() === "", "und Loslassen nimmt es wieder zurueck");

context.setHighlightedEcosystemRegion("r-gemaessigt");
assert(context.effectiveEcosystemRegionId() === "r-gemaessigt", "ein Klick bleibt stehen");
context.setHoveredEcosystemRegion("r-tropisch");
assert(context.effectiveEcosystemRegionId() === "r-tropisch", "der ueberfahrene uebernimmt die Vorschau");
context.setHoveredEcosystemRegion("");
assert(context.effectiveEcosystemRegionId() === "r-gemaessigt",
	"🔴 und danach steht der ANGEKLICKTE wieder da -- er war nie weg");

// Ein Klick woanders hin loescht beides -- sonst kaeme die alte Region beim naechsten Verlassen zurueck.
context.setHoveredEcosystemRegion("r-boreal");
context.setHighlightedEcosystemRegion("");
context.setHoveredEcosystemRegion("");
assert(context.effectiveEcosystemRegionId() === "", "ein Klick woanders hin raeumt beide Zustaende");

// ---- die Kontur gehoert der ANGEKLICKTEN Region -----------------------------------------------------
// 🔴 Ueberfahren fuellt, Anklicken fuellt UND umreisst -- daran unterscheidet man Vorschau und Wahl.
context.setHighlightedEcosystemRegion("");
context.setHoveredEcosystemRegion("r-boreal");
assert(context.contouredEcosystemRegionId() === "", "eine bloss ueberfahrene Region bekommt KEINE Kontur");
context.setHoveredEcosystemRegion("");

context.setHighlightedEcosystemRegion("r-gemaessigt");
assert(context.contouredEcosystemRegionId() === "r-gemaessigt", "die angeklickte bekommt sie");

// 💣 Und sie bleibt nicht liegen: zeigt die Maus woanders hin, wandert sie mit der Fuellung mit. Sonst
// staende eine umrandete Flaeche ohne Fuellung neben einer gefuellten ohne Rand.
context.setHoveredEcosystemRegion("r-tropisch");
assert(context.effectiveEcosystemRegionId() === "r-tropisch", "die Vorschau leuchtet");
assert(context.contouredEcosystemRegionId() === "", "💣 und die Kontur bleibt nicht bei der angeklickten liegen");

context.setHoveredEcosystemRegion("");
assert(context.contouredEcosystemRegionId() === "r-gemaessigt", "zurueck bei der angeklickten, samt Kontur");

// Die Maus auf dem, was ohnehin angeklickt ist, aendert nichts.
context.setHoveredEcosystemRegion("r-gemaessigt");
assert(context.contouredEcosystemRegionId() === "r-gemaessigt",
	"auf der eigenen Flaeche zu stehen nimmt ihr die Kontur nicht");
context.setHighlightedEcosystemRegion("");
context.setHoveredEcosystemRegion("");
assert(context.contouredEcosystemRegionId() === "", "und ein Klick woanders hin raeumt auch sie");

// ---- der Schwebezettel, der stehen blieb (Owner 2026-08-04) ----------------------------------------
// 🔴 URSACHE, nachgemessen im Browser: ein Leaflet-Tooltip geht von selbst nur bei `mouseout` zu -- und
// ein Element, das unter dem Zeiger `pointer-events: none` bekommt, sieht NIE wieder ein Ereignis. Diese
// App schaltet bei jedem Ebenenwechsel ganze Panes so um. Der Zettel bleibt also stehen, und zwar genau
// dann, wenn der Zeiger im Augenblick des Wechsels zufaellig auf einer Flaeche lag -- das „manchmal".
//
// 🪤 Geprueft wird ALLE, nicht „die eine unter dem Zeiger": welche das war, weiss niemand mehr, und zwei
// standen im Fehlerbericht gleichzeitig auf der Karte.
const geschlossen = [];
const ebene = (id, kannSchliessen = true) => ({
	_ecosystemArea: { public_id: id },
	closeTooltip: kannSchliessen ? () => geschlossen.push(id) : undefined,
});
// 🪤 Die Map muss IM vm-Kontext entstehen. `instanceof Map` vergleicht gegen den Konstruktor DIESES
// Realms; eine hier draussen gebaute Map faellt durch die Pruefung im Modul und der Test bewiese nichts.
context.ecosystemLayers = new (vm.runInContext("Map", context))([
	["a-1", ebene("a-1")],
	["a-2", ebene("a-2")],
	["a-3", ebene("a-3", false)],   // eine ohne Tooltip-Bindung -- darf nicht werfen
]);
context.closeAllEcosystemAreaTooltips();
assert(geschlossen.length === 2 && geschlossen.includes("a-1") && geschlossen.includes("a-2"),
	"🔴 ALLE offenen Zettel werden geschlossen, nicht nur einer: " + geschlossen.join(","));

// Ohne Flaechenregister passiert nichts -- und vor allem faellt nichts um.
context.ecosystemLayers = undefined;
context.closeAllEcosystemAreaTooltips();
assert(true, "ohne Register laeuft es durch");

if (failures > 0) {
	console.error(`ecosystem-highlight.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-highlight.test: OK -- eine Region, zwei Zustaende, jede Landschaftsebene");
