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
// Der zugeklappte Teil ist alles VOR dem vollen Inhalt.
const zu = (markup) => markup.slice(0, markup.indexOf("infobox-lid__full"));

// ---- die Saetze -------------------------------------------------------------------------------
// 🔴 EIN Satz je Zeile, und er gilt in BEIDEN Zustaenden (Owner 2026-08-12: „11 Handelswaren
// gelistet sollte es auch heissen, wenn es zugeklappt is … und wenn es aufgeklappt ist"). Eine
// kurze Zwischenfassung hatte zwei Saetze und tauschte sie beim Aufklappen -- dieselbe Unruhe wie
// ein springender Satz, nur in Worten statt in Pixeln.
AVESMAPS_LORE_ROWS.forEach((row) => {
	assert.ok(row.singular && row.plural, row.kind + " braucht beide Zahlformen");
	assert.ok(!row.singularShut && !row.pluralShut,
		"💣 keine zweite Satzfassung fuer den offenen Zustand: " + row.kind);
	// Die Saetze sagen, was ERFASST ist -- kein ortsgebundenes Wort, denn dieselbe Zeile steht an
	// fuenf Oberflaechen (Ort, Region, Herrschaftsgebiet, Weg, Etappe).
	assert.ok(!/in der Nähe|auf dem Weg|\bhier\b/.test(row.plural),
		"kein Ortswort im Satz: " + row.plural);
});

// ---- wenig: klappt GENAUSO ein ----------------------------------------------------------------
// ⭐ Kein statischer Sonderfall mehr. Owner 2026-08-12 zu einer Fauna-Zeile mit zwei Namen: „auch
// 2 Tierarten leben hier / Bergloewe, Griswolf <- einklappen". Der Gewinn ist nicht der Platz bei
// zwei Namen, sondern dass alle Zeilen einer Box gleich aussehen und sich gleich verhalten.
const wenig = avesmapsLoreInfoRowMarkup(zeile("flora"), [ware("Espe"), ware("Weide")], 2, "punin", null);
assert.ok(wenig.indexOf("infobox-lid--static") < 0, "💣 kein statischer Deckel mehr: " + wenig);
assert.ok(wenig.indexOf("<details") >= 0, "auch zwei Pflanzen bekommen einen Oeffner");
assert.ok(wenig.indexOf("2") >= 0 && wenig.indexOf("Pflanzenarten gesehen") >= 0,
	"mit dem Satz: " + wenig);
assert.ok(wenig.indexOf("Espe") >= 0 && wenig.indexOf("Weide") >= 0, "die Namen im Aufgeklappten");
assert.ok(zu(wenig).indexOf("Espe") < 0, "aber nicht im zugeklappten Teil: " + zu(wenig));

// Einzahl
const eins = avesmapsLoreInfoRowMarkup(zeile("fauna"), [ware("Griswolf")], 1, "punin", null);
assert.ok(eins.indexOf("Tierart beobachtet") >= 0,
	"💣 Einzahl, nie „1 Tierarten beobachtet\": " + eins);

// ---- viel ------------------------------------------------------------------------------------
const viele = [];
for (let i = 0; i < 11; i++) { viele.push(ware("Ware" + i)); }
const lang = avesmapsLoreInfoRowMarkup(zeile("ware"), viele, 11, "punin", null);
assert.ok(lang.indexOf("<details") >= 0, "elf Waren bekommen einen Deckel");
assert.ok(lang.indexOf("Handelswaren gelistet") >= 0, "mit dem Satz");

// 💣 ZUGEKLAPPT STEHT KEIN EINZIGER NAME DA (Owner: „ohne weitere Angaben"). Die Zeile ist dann nur
// ihr Satz plus der Oeffner. Vorher acht Namen, dann drei, jetzt keine -- jeder Schritt machte den
// Oeffner sichtbarer, weil weniger daneben stand.
assert.ok(zu(lang).length > 0, "der zugeklappte Ausschnitt darf nicht leer sein");
assert.ok(zu(lang).indexOf("infobox-lid__preview") < 0, "keine Vorschau: " + zu(lang));
assert.strictEqual((zu(lang).match(/Ware\d/g) || []).length, 0, "kein Name: " + zu(lang));

// Der Satz steht GENAU EINMAL im Markup -- nicht je Zustand einmal.
assert.strictEqual((lang.match(/Handelswaren gelistet/g) || []).length, 1,
	"ein Satz, eine Stelle: " + lang);
assert.ok(lang.indexOf("werden hier gehandelt") < 0,
	"💣 keine zweite Fassung fuer den offenen Zustand: " + lang);

// ...aber ALLE elf stehen im Dokument, sonst faende die Seitensuche sie nicht.
assert.ok(lang.indexOf("Ware10") >= 0, "der volle Inhalt ist von Anfang an da");

// ---- die Gliederung nach Naehe ----------------------------------------------------------------
// 🔴 Gemessen am Live-Bestand: Herkunft gibt es NUR bei Waren (3 von 51); Fauna und Flora tragen im
// Wiki ausschliesslich Verbreitung. Deshalb ist „Von hier" ein Zusatz und der Rang die Regel.
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
assert.strictEqual((grp.match(/Garether Bier/g) || []).length, 1, "kein Doppeleintrag: " + grp);
assert.ok(zu(grp).length > 0 && zu(grp).indexOf("Garether Bier") < 0,
	"und zugeklappt steht ueberhaupt kein Name da: " + zu(grp));

// Eine EINZIGE Gruppe gliedert nichts -- dann steht auch ihre Ueberschrift nicht da.
const einfach = avesmapsLoreInfoRowMarkup(zeile("fauna"),
	[ware("A"), ware("B"), ware("C")], 3, "punin", null);
assert.ok(einfach.indexOf("Direkt hier") < 0,
	"eine einzige Gruppe bekommt keine Ueberschrift: " + einfach);

// ---- die Freitext-Handelswaren gehoeren in dieselbe Gruppe ------------------------------------
// Die Gattungen der Gegend („Vieh, Holz") und die Stuecke mit Namen („Braeubier") sind EINE Liste,
// nicht zwei (Owner 2026-07-22): getrennt lasen sie sich wie ein widersprüchlicher Doppeleintrag.
//
// 🪤 Ihre SONDERSTELLUNG VORNEWEG ist mit der Schwelle 0 entfallen, und zwar zwangslaeufig: wo
// Buchstabenmarken stehen, ist die Ordnung das Alphabet, und ein „vorne" gibt es darin nicht.
// Bis zum 12.08.2026 fiel das nicht auf, weil kurze Listen ohne Marken auskamen. Der Test behauptet
// deshalb jetzt, was gilt -- beide sind da, in einer Liste, alphabetisch.
const mitLead = avesmapsLoreInfoRowMarkup(zeile("ware"), [ware("Bräubier")], 1, "punin",
	[{ name: "Vieh", wiki_url: "" }, { name: "Holz", wiki_url: "" }]);
assert.ok(mitLead.indexOf("Vieh") >= 0 && mitLead.indexOf("Holz") >= 0 && mitLead.indexOf("Bräubier") >= 0,
	"Gattungen und benannte Stuecke stehen in derselben Liste: " + mitLead);
assert.ok(mitLead.indexOf("Bräubier") < mitLead.indexOf("Holz"),
	"und zwar alphabetisch, nicht nach Herkunft der Angabe: " + mitLead);
assert.ok(mitLead.indexOf("Handelswaren gelistet") >= 0, "und zaehlen mit: " + mitLead);
// Doppelungen: „Salz" kann in beiden Quellen stehen und darf nur einmal erscheinen.
const doppelt = avesmapsLoreInfoRowMarkup(zeile("ware"), [ware("Salz")], 1, "punin",
	[{ name: "Salz", wiki_url: "" }]);
assert.strictEqual((doppelt.match(/Salz/g) || []).length, 1, "Salz nur einmal: " + doppelt);
assert.ok(doppelt.indexOf("Handelsware gelistet") >= 0, "und einmal ist Einzahl: " + doppelt);

// ---- nichts zu sagen --------------------------------------------------------------------------
assert.strictEqual(avesmapsLoreInfoRowMarkup(zeile("ware"), [], 0, "punin", null), "",
	"ohne Eintraege keine Zeile -- kein leerer Deckel mit „0 Handelswaren gelistet\"");

// ---- lange Listen: Gruppen klappen, Namen bekommen Buchstabenmarken (Owner 12.08.2026) ---------
//
// Owner an der Reichsstrasse 2 mit 126 Handelswaren: „ich hab so lange listen wie hier ... Von hier
// und Direkt hier geht etwas unter". Zwei Schwellen, zwei verschiedene Fragen: die ZEILE ist zu langeZeile
// (dann klappen die Gruppen zu), die GRUPPE ist zu langeZeile zum Lesen (dann kommen Marken).
const reihe = (anzahl, praefix, opts) => Array.from({ length: anzahl }, (_, i) =>
	ware(praefix + " " + String.fromCharCode(65 + (i % 26)) + i, opts));

// 33 Eintraege in zwei Gruppen -> die Gruppen klappen, die erste steht offen.
const langeZeile = avesmapsLoreInfoRowMarkup(zeile("ware"),
	reihe(20, "Herkunft", { relations: ["herkunft"] }).concat(reihe(13, "Nahdran")), 33, "punin", null);
assert.ok(/<details class="avesmaps-lore__gruppe" open>/.test(langeZeile),
	"die erste Gruppe steht offen -- bei den Waren ist das „Von hier\", die staerkste Aussage");
assert.strictEqual((langeZeile.match(/<details class="avesmaps-lore__gruppe"/g) || []).length, 2,
	"beide Gruppen sind klappbar");
assert.strictEqual((langeZeile.match(/<details class="avesmaps-lore__gruppe" open>/g) || []).length, 1,
	"...aber nur EINE offen, sonst waere das Klappen wirkungslos");
// 💣 Die Anzahl gehoert in den Kopf: „Direkt hier 98" sagt vorher, was einen erwartet.
assert.ok(/avesmaps-lore__gruppe-zahl">20</.test(langeZeile) && /avesmaps-lore__gruppe-zahl">13</.test(langeZeile),
	"jede Gruppe nennt ihre Anzahl: " + langeZeile.slice(0, 300));

// Wenige Eintraege in zwei Gruppen -> Ueberschrift samt Anzahl, aber KEIN Klappen.
const kurz = avesmapsLoreInfoRowMarkup(zeile("ware"),
	reihe(3, "Herkunft", { relations: ["herkunft"] }).concat(reihe(4, "Nahdran")), 7, "punin", null);
assert.ok(kurz.indexOf("<details class=\"avesmaps-lore__gruppe\"") < 0,
	"bei sieben Eintraegen klappt nichts -- sonst verstecke ich vier Namen hinter einem Klick");
assert.ok(/avesmaps-lore__gruppe--fest/.test(kurz) && /avesmaps-lore__gruppe-zahl">3</.test(kurz),
	"...die Ueberschrift mit Anzahl steht trotzdem da: " + kurz.slice(0, 200));

// 🔴 Buchstabenmarken IMMER -- Schwelle 0 (Owner 12.08.2026: „es macht mein durchblättern keinen
// sinn dass in einem menü welche dranstehen und im andern nicht"). Der Weg war 30 → 10 → 0.
// ⭐ Eine Schwelle spart Platz im Einzelfall und kostet Verlaesslichkeit ueber die Flaeche.
assert.strictEqual(AVESMAPS_LORE_LETTER_MIN, 0, "die Schwelle steht auf 0, also immer");
assert.ok(/avesmaps-lore__buchstabe">/.test(
	avesmapsLoreInfoRowMarkup(zeile("ware"), reihe(40, "Ware"), 40, "punin", null)),
	"40 Eintraege in einer Gruppe bekommen Marken");
assert.ok(/avesmaps-lore__buchstabe">/.test(
	avesmapsLoreInfoRowMarkup(zeile("ware"), reihe(6, "Ware"), 6, "punin", null)),
	"💣 und sechs auch -- sonst haengt es vom Zufall ab, ob eine Infobox Marken zeigt");
// Bis hinunter zu EINEM Namen: genau der Fall, bei dem eine Schwelle am verlockendsten waere.
const eineMarke = avesmapsLoreInfoRowMarkup(zeile("fauna"), [ware("Griswolf")], 1, "punin", null);
assert.ok(/avesmaps-lore__buchstabe">G</.test(eineMarke),
	"💣 auch ein einziger Name bekommt seine Marke: " + eineMarke);
// 💣 Umlaute fallen auf ihren Grundbuchstaben, sonst stuende „Aelbler\" unter einer eigenen Marke
// hinter Z -- localeCompare sortiert ihn nach vorn, die Marke muesste also auch „A\" heissen.
assert.strictEqual(avesmapsLoreLetterOf("Älbler"), "A", "Ae faellt auf A");
assert.strictEqual(avesmapsLoreLetterOf("Über"), "U", "Ue faellt auf U");
assert.strictEqual(avesmapsLoreLetterOf("3-Zack"), "#", "was kein Buchstabe ist, sammelt sich unter #");
const sortiert = avesmapsLoreInfoRowMarkup(zeile("ware"),
	[ware("Zwerg")].concat(reihe(35, "Ware")).concat([ware("Älbler")]), 37, "punin", null);
assert.ok(sortiert.indexOf("Älbler") < sortiert.indexOf("Zwerg"),
	"sortiert wird deutsch: Aelbler vor Zwerg");

console.log("OK: die Lore-Zeilen sind Deckel -- EIN Satz, keine Namen zugeklappt, Gliederung nach Naehe");
