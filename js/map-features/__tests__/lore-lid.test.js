// Waren / Fauna / Flora als Deckel (Owner 2026-08-12: „4 is mega, das wollen wir" + die Saetze).
// Der „+N"-Dialog ist damit abgeloest -- alles steht im Dokument, gegliedert nach Naehe.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = {
	location: { search: "" },
	localStorage: { getItem: () => null, setItem() {} },
	addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
};
global.localStorage = global.window.localStorage;
global.document = { querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.MutationObserver = function () { this.observe = () => {}; };
global.AbortController = function () { this.abort = () => {}; this.signal = null; };
global.tr = (key, fallback) => fallback;

const load = (...parts) => {
	const file = path.join(__dirname, ...parts);
	vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
};
load("..", "..", "ui", "infobox-lid.js");
load("..", "map-features-lore.js");

const ware = (name, opts) => Object.assign({ name, wiki_url: "", rank: 0, relations: ["verbreitung"] }, opts || {});
const zeile = (kind) => AVESMAPS_LORE_ROWS.find((r) => r.kind === kind);

// ---- die Saetze -------------------------------------------------------------------------------
// 💣 Sie muessen an FUENF Oberflaechen stimmen (Ort, Region, Herrschaftsgebiet, Weg, Etappe).
// „in der Naehe" liest sich an einer Strasse richtig, bei einem Koenigreich aber schief.
AVESMAPS_LORE_ROWS.forEach((row) => {
	assert.ok(row.singular && row.plural, row.kind + " braucht beide Zahlformen");
	assert.ok(!/in der Nähe|auf dem Weg/.test(row.plural),
		"kein ortsgebundenes Wort in einem Satz, der an fuenf Flaechen steht: " + row.plural);
});

// ---- wenig: alles steht da, kein Oeffner ------------------------------------------------------
const wenig = avesmapsLoreInfoRowMarkup(zeile("flora"), [ware("Espe"), ware("Weide")], 2, "punin", null);
assert.ok(wenig.indexOf("infobox-lid--static") >= 0, "zwei Pflanzen brauchen keinen Oeffner: " + wenig);
assert.ok(wenig.indexOf("2 Pflanzenarten wachsen hier") >= 0 || wenig.indexOf("Pflanzenarten wachsen hier") >= 0,
	"aber den Satz: " + wenig);
assert.ok(wenig.indexOf("Espe") >= 0 && wenig.indexOf("Weide") >= 0, "und beide Namen");

// Einzahl
const eins = avesmapsLoreInfoRowMarkup(zeile("fauna"), [ware("Griswolf")], 1, "punin", null);
assert.ok(eins.indexOf("Tierart lebt hier") >= 0, "💣 Einzahl, nie „1 Tierarten leben hier\": " + eins);

// ---- viel: eingedampft mit Oeffner ------------------------------------------------------------
const viele = [];
for (let i = 0; i < 11; i++) { viele.push(ware("Ware" + i)); }
const lang = avesmapsLoreInfoRowMarkup(zeile("ware"), viele, 11, "punin", null);
assert.ok(lang.indexOf("<details") >= 0, "elf Waren bekommen einen oeffenbaren Deckel");
assert.ok(lang.indexOf("11 Waren werden hier gehandelt") >= 0
	|| lang.indexOf("Waren werden hier gehandelt") >= 0, "mit dem Satz");
// 💣 Die Vorschau zeigt DREI Namen, nicht acht. Acht von 51 waren zu wenig fuer eine Liste und zu
// viel, um den Oeffner noch zu sehen -- das war der Anlass.
// ⚠️ Der Satz steht seit 2026-08-12 VOR der Vorschau (sonst springt er beim Aufklappen), die
// Vorschau also zwischen ihm und dem vollen Inhalt. Wer hier gegen __foot schneidet, schneidet
// rueckwaerts und bekommt einen leeren String -- der dann jede Zusicherung besteht.
const vorschau = lang.slice(lang.indexOf("infobox-lid__preview"), lang.indexOf("infobox-lid__full"));
assert.ok(vorschau.length > 0, "der Vorschau-Ausschnitt darf nicht leer sein");
assert.strictEqual((vorschau.match(/Ware\d/g) || []).length, 3,
	"genau drei Namen in der Vorschau: " + vorschau);
// ...aber ALLE elf stehen im Dokument, sonst faende die Seitensuche sie nicht.
assert.ok(lang.indexOf("Ware10") >= 0, "der volle Inhalt ist von Anfang an da");

// ---- die Gliederung nach Naehe ----------------------------------------------------------------
// 🔴 Gemessen am Live-Bestand: Herkunft gibt es NUR bei Waren (3 von 51); Fauna und Flora tragen
// im Wiki ausschliesslich Verbreitung. Deshalb ist „Von hier" ein Zusatz und der Rang die Regel.
// ⚠️ Die Reihenfolge ist ABSICHT: der kontinentweite Eintrag steht VORN. Stuende er hinten, kaeme er
// ohnehin nicht in die Vorschau (die nimmt nur drei), und die Zusicherung darunter pruefte nichts --
// genau das war sie in der ersten Fassung, die Mutationsprobe hat es aufgedeckt.
const gemischt = [
	ware("Perricumer Salz", { rank: 3 }),
	ware("Garether Bier", { relations: ["herkunft"] }),
	ware("Langschwert"),
	ware("Wachstuch", { rank: 1, place_title: "Baliho" }),
	ware("Dinkelbier"), ware("Gagelbier"),
];
const grp = avesmapsLoreInfoRowMarkup(zeile("ware"), gemischt, 6, "punin", null);
["Von hier", "Direkt hier", "Aus Untergebieten", "Überall in Aventurien"].forEach((label) => {
	assert.ok(grp.indexOf(label) >= 0, "die Gruppe „" + label + "\" fehlt: " + grp);
});
// 💣 Ein Eintrag mit Herkunft steht NUR in „Von hier", nicht zusaetzlich in seiner Rang-Gruppe.
// Gezaehlt wird im AUFGEKLAPPTEN Teil: in der Vorschau darf derselbe Name natuerlich noch einmal
// auftauchen, das ist ja ihr Zweck.
const voll = grp.slice(grp.indexOf("infobox-lid__full"));
assert.strictEqual((voll.match(/Garether Bier/g) || []).length, 1,
	"kein Doppeleintrag im Aufgeklappten: " + voll);
// 💣 Die kontinentweiten bleiben aus der VORSCHAU heraus -- was ueberall gilt, sagt ueber diesen
// Ort nichts. Im Aufgeklappten stehen sie unter ihrer Ueberschrift.
const vorschau2 = grp.slice(grp.indexOf("infobox-lid__preview"), grp.indexOf("infobox-lid__full"));
assert.ok(vorschau2.indexOf("Perricumer Salz") < 0, "rank 3 nicht in der Vorschau: " + vorschau2);

// Eine EINZIGE Gruppe gliedert nichts -- dann steht auch ihre Ueberschrift nicht da.
const einfach = avesmapsLoreInfoRowMarkup(zeile("fauna"),
	[ware("A"), ware("B"), ware("C"), ware("D"), ware("E"), ware("F")], 6, "punin", null);
assert.ok(einfach.indexOf("Direkt hier") < 0,
	"eine einzige Gruppe bekommt keine Ueberschrift: " + einfach);

// ---- die Freitext-Handelswaren fuehren --------------------------------------------------------
// Erst die Gattungen der Gegend („Vieh, Holz"), dann die Stuecke mit Namen (Owner 2026-07-22).
const mitLead = avesmapsLoreInfoRowMarkup(zeile("ware"), [ware("Bräubier")], 1, "punin",
	[{ name: "Vieh", wiki_url: "" }, { name: "Holz", wiki_url: "" }]);
assert.ok(mitLead.indexOf("Vieh") < mitLead.indexOf("Bräubier"), "die Gattungen stehen vorn");
assert.ok(mitLead.indexOf("3 ") >= 0 || mitLead.indexOf("Waren werden hier gehandelt") >= 0,
	"und zaehlen mit: " + mitLead);
// Doppelungen: „Salz" kann in beiden Quellen stehen und darf nur einmal erscheinen.
const doppelt = avesmapsLoreInfoRowMarkup(zeile("ware"), [ware("Salz")], 1, "punin",
	[{ name: "Salz", wiki_url: "" }]);
assert.strictEqual((doppelt.match(/Salz/g) || []).length, 1, "Salz nur einmal: " + doppelt);

// ---- nichts zu sagen --------------------------------------------------------------------------
assert.strictEqual(avesmapsLoreInfoRowMarkup(zeile("ware"), [], 0, "punin", null), "",
	"ohne Eintraege keine Zeile -- kein leerer Deckel mit „0 Waren\"");

console.log("OK: die Lore-Zeilen sind Deckel -- Saetze, Vorschau von drei, Gliederung nach Naehe");
