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

// --- Task 4b: Siedlungen OHNE Wiki-Artikel erreichen die Regeln (2.885 von 4.883, gemessen) ---
// avesmapsLorePlaceRefFromLocation gab bisher null zurueck, sobald weder ein Wiki-Titel noch ein
// Territorium da war -- genau der Fall bei einem Ort ganz ohne Artikel. Die public_id allein muss
// reichen: sie ist es, die der Server (api/app/lore.php) gegen die Lebensraum-Regel prueft.
const bornwaldsteig = placeRefFromLocation({ publicId: "loc-1", name: "Bornwaldsteig" });
assert.notStrictEqual(bornwaldsteig, null,
	"ein Ort ganz ohne Wiki-Artikel/Territorium, aber MIT public_id, darf kein null mehr liefern");
assert.strictEqual(bornwaldsteig && bornwaldsteig.location, "loc-1",
	"die public_id muss als location-Feld mitreisen, auch ganz ohne Titel/Territorium");

assert.strictEqual(placeRefFromLocation({ name: "Namenlos" }), null,
	"ganz ohne publicId UND ohne Titel/Territorium bleibt es beim alten null");

// buildLoreMarkup muss dieselbe Identitaet auch OHNE key/titles annehmen -- sonst kommt die neue
// location aus avesmapsLorePlaceRefFromLocation nie im DOM/Abruf an.
const locationOnlyMarkup = buildLoreMarkup({ location: "loc-1" });
assert.ok(locationOnlyMarkup.indexOf('data-lore-location="loc-1"') >= 0,
	"buildLoreMarkup muss die Identitaet auch OHNE key/titles als Attribut schreiben");
assert.ok(placeOf(locationOnlyMarkup),
	"der Container-Schluessel darf dabei nicht leer bleiben (eindeutig/stabil aus der Identitaet allein)");

assert.strictEqual(buildLoreMarkup({}), "",
	"ganz ohne jede Identitaet/Schluessel/Titel bleibt buildLoreMarkup weiterhin leer");

const otherLocationOnlyMarkup = buildLoreMarkup({ location: "loc-2" });
assert.notStrictEqual(placeOf(locationOnlyMarkup), placeOf(otherLocationOnlyMarkup),
	"zwei Orte ohne Schluessel muessen trotzdem verschiedene Container treffen");

// Runde-1-Befund 2: containerKey war ASYMMETRISCH zu avesmapsLoreRequestKey -- ein
// Entweder-Oder (`area ? … : …`) statt zwei unabhaengiger Beitraege. Traegt ein placeRef
// kuenftig BEIDE Felder (Task 4 bringt drei weitere area-Aufrufstellen), fiel der
// Container-Schluessel bisher auf area allein zurueck und verschluckte location -- zwei
// Container mit gleichem key+area, aber verschiedener location, haetten sich wieder
// denselben Selektor geteilt.
const bothMarkup = buildLoreMarkup({ key: "finsterkamm", name: "Beides", area: "a2", location: "p1" });
assert.notStrictEqual(
	placeOf(bothMarkup),
	placeOf(areaMarkup),
	"area+location zusammen muessen einen ANDEREN Container treffen als area allein"
);
assert.notStrictEqual(
	placeOf(bothMarkup),
	placeOf(locationMarkup),
	"und auch einen anderen als location allein"
);

// Regression: buildLoreMarkup OHNE Identitaet -- ein gueltiger Fall fuer sich (ein Aufrufer, der
// kein area/location mitgibt), aber NICHT das, was der reale Aufrufer heute liefert: seit Task 3
// haengt avesmapsLorePlaceRefFromLocation IMMER `location` an, live also z. B.
// `gareth-l-80558060-…` statt `gareth` (Fix-Runde 1, Befund 2 -- der Kommentar hier hiess bisher
// faelschlich "im Review gemessen"). Die Werte unten pruefen nur buildLoreMarkup selbst, isoliert
// von seinem echten Aufrufer.
assert.strictEqual(placeOf(buildLoreMarkup({ key: "punin", name: "Punin" })), "punin",
	"Regression: einfache Siedlung unveraendert");
assert.strictEqual(
	placeOf(buildLoreMarkup({ key: "darpatien,reichsforst", name: "Etappe" })),
	"darpatien,reichsforst",
	"Regression: Kommaliste (Territorienkette) unveraendert"
);
assert.strictEqual(
	placeOf(buildLoreMarkup({ titles: "Thorwal (Siedlung)", name: "Thorwal" })),
	"thorwal-siedlung-",
	"Regression: reine Titel-Anfrage unveraendert"
);

// Runde-1-Befund 1: der Zwischenspeicher-Schluessel ist geprueft, aber nicht die URL -- die
// Haelfte, die die Identitaet tatsaechlich zum SERVER traegt. Ein eigener Sandbox-Kontext mit
// fetch-Stub, weil avesmapsLoreFetch `fetch()` bare (nicht window.fetch) aufruft. Asynchron --
// erst NACH dem .then() pruefen, sonst meldet der Test "OK", bevor er etwas gesehen hat.
let seenUrl = null;
const urlContext = {
	window: { setTimeout: (fn) => fn(), clearTimeout: () => {} },
	document: undefined,
	console,
	fetch: function (url) {
		seenUrl = url;
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, sections: {}, counts: {}, total: 0 }) });
	},
};
urlContext.globalThis = urlContext;
vm.createContext(urlContext);
vm.runInContext(fs.readFileSync("js/map-features/map-features-lore.js", "utf8"), urlContext);

Promise.resolve()
	.then(() => urlContext.avesmapsLoreFetch({ key: "punin", full: true, titles: "", goods: "", area: "reg 1" }))
	.then(() => {
		assert.ok(seenUrl.indexOf("&area=reg%201") >= 0,
			"area muss encodeURIComponent-behandelt an der URL landen");
		assert.strictEqual(seenUrl.indexOf("&location="), -1,
			"ohne location darf die URL kein &location= tragen");
	})
	.then(() => urlContext.avesmapsLoreFetch({ key: "thorwal", full: true, titles: "", goods: "", location: "settlement 1" }))
	.then(() => {
		assert.ok(seenUrl.indexOf("&location=settlement%201") >= 0,
			"location muss encodeURIComponent-behandelt an der URL landen");
		assert.strictEqual(seenUrl.indexOf("&area="), -1,
			"ohne area darf die URL kein &area= tragen");
	})
	.then(() => urlContext.avesmapsLoreFetch({ key: "punin", full: true, titles: "", goods: "" }))
	.then(() => {
		assert.strictEqual(seenUrl.indexOf("&area="), -1, "ganz ohne Identitaet: kein &area= an der URL");
		assert.strictEqual(seenUrl.indexOf("&location="), -1, "ganz ohne Identitaet: kein &location= an der URL");
	})
	// Task 4b: ein Ort ganz ohne Wiki-Artikel/Territorium hat leeren key -- die location muss
	// trotzdem an der URL landen, sonst bleibt der Server-Aufruf fuer genau diese Orte tot.
	.then(() => urlContext.avesmapsLoreFetch({ key: "", full: true, titles: "", goods: "", location: "loc-1" }))
	.then(() => {
		assert.ok(seenUrl.indexOf("&location=loc-1") >= 0,
			"leerer key darf &location= nicht verhindern");
	})
	.then(() => {
		console.log("lore-place-ref: OK");
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
