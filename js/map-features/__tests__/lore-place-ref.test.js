// Der Abrufschluessel des Lore-Panels. 💣 Er muss die IDENTITAET mittragen: zwei Objekte koennen
// denselben Ortsschluessel haben und trotzdem verschiedene Regeln treffen -- eine Siedlung und
// die Flaeche, in der sie liegt, sind der Normalfall davon.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {}, document: undefined, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/map-features/map-features-lore.js", "utf8"), context);

const key = context.avesmapsLoreRequestKey;
assert.strictEqual(typeof key, "function", "der Schluesselbauer ist ansprechbar");

assert.notStrictEqual(
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	key({ key: "finsterkamm", titles: "", location: "p1" }),
	"Flaeche und Siedlung darin duerfen sich denselben Speicherplatz NICHT teilen"
);
assert.strictEqual(
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	"derselbe Bezug ergibt denselben Schluessel"
);
assert.strictEqual(
	key({ key: "finsterkamm", titles: "" }),
	key({ key: "finsterkamm", titles: "" }),
	"ohne Identitaet bleibt es beim alten Verhalten"
);

// Der Zwischenspeicher-Schluessel ist nicht die ganze Strecke: die Identitaet muss von
// buildLoreMarkup (schreibt data-lore-*) ueber avesmapsLoreLoadPendingContainers (liest sie
// zurueck) bis zu avesmapsLoreFetch reisen. Stationen 1+2 sind eine eigene Falle -- ein
// Schluessel, der die Identitaet kennt, mit einem Wert, der nie ankommt, sieht wie ein
// bestandener Test aus, ist es aber nicht.
const buildLoreMarkup = context.buildLoreMarkup;
assert.strictEqual(typeof buildLoreMarkup, "function", "buildLoreMarkup ist ansprechbar");

const areaMarkup = buildLoreMarkup({ key: "finsterkamm", name: "Flaeche", area: "a2" });
assert.ok(areaMarkup.indexOf('data-lore-area="a2"') >= 0,
	"buildLoreMarkup muss die Flaechen-Identitaet als Attribut schreiben, sonst kommt sie nie beim Abruf an");

const locationMarkup = buildLoreMarkup({ key: "finsterkamm", name: "Siedlung", location: "p1" });
assert.ok(locationMarkup.indexOf('data-lore-location="p1"') >= 0,
	"dasselbe fuer die Siedlungs-Identitaet");

// Der Container-Schluessel (data-lore-place) ist eine ZWEITE Kollisionsstelle derselben Art:
// avesmapsLoreFillContainers sucht ueber [data-lore-place="…"], und ohne Identitaet darin
// treffen sich Flaeche und Siedlung mit gleichem Ortsschluessel im selben Container.
const placeOf = (markup) => (markup.match(/data-lore-place="([^"]*)"/) || [])[1];
const noIdentityMarkup = buildLoreMarkup({ key: "finsterkamm", name: "Ohne Identitaet" });
assert.notStrictEqual(
	placeOf(areaMarkup),
	placeOf(locationMarkup),
	"Flaeche und Siedlung mit demselben Ortsschluessel duerfen sich nicht denselben Container teilen"
);
assert.notStrictEqual(
	placeOf(areaMarkup),
	placeOf(noIdentityMarkup),
	"und auch nicht mit dem Aufrufer ohne Identitaet"
);
assert.strictEqual(
	placeOf(noIdentityMarkup),
	"finsterkamm",
	"ohne Identitaet bleibt der Container-Schluessel exakt wie vor dieser Aenderung"
);

// avesmapsLorePlaceRefFromLocation muss die public_id der SIEDLUNG als location-Feld mitgeben --
// ohne das haette buildLoreMarkup nie eine Identitaet zum Weiterreichen.
const placeRefFromLocation = context.avesmapsLorePlaceRefFromLocation;
assert.strictEqual(typeof placeRefFromLocation, "function", "avesmapsLorePlaceRefFromLocation ist ansprechbar");
const locationRef = placeRefFromLocation({ publicId: "settlement-1", territoryWikiKey: "darpatien", name: "Punin" });
assert.strictEqual(locationRef && locationRef.location, "settlement-1",
	"die Siedlungs-public_id muss als location-Feld mitreisen");

console.log("lore-place-ref: OK");
