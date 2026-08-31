// Das HERRSCHAFTSGEBIET als Objektart -- und die ELTERN-SPERRE (Aufgabe 7, Entwurf §7).
//
// 🔴 Was hier festgenagelt wird, und jedes davon ist gemessen, nicht vermutet:
//   1. DIE SPERRE GEHOERT AN DIE FELDZEILE, NICHT AN DEN KNOPF. Bei `parent_locked = 1` kommt die
//      Zeile „Eltern" gesperrt zurueck, die uebrigen NICHT -- Name, Staatsform und Wappen bleiben
//      bedienbar. Die Fixture ist absichtlich so gebaut, dass die Eltern-Zeile OHNE Sperre
//      vorangehakt waere (der Kartenwert ist leer, das Wiki sagt etwas): wer den Riegel entfernt,
//      bekommt einen Haken, wo keiner sein darf -- und genau das faellt hier um.
//   2. NICHT NACHLESBAR SPERRT EBENSO. Ein Modellbaum, den man nicht holen konnte, ist KEIN leerer
//      Baum: leer hiesse „nirgends ist etwas gesperrt", und die Vorschau boete an, eine gesperrte
//      Hierarchie zu ueberschreiben.
//   3. DIE ELTERN-ZEILE WIRD NIE UEBER IHREN NAMEN AUFGELOEST. Sie zeigt einen Namen (eine public_id
//      liest niemand), geschrieben wird die Kennung aus dem Modellbaum -- ein Name ist keine Kennung.
//   4. `laden` LEHNT AB, statt etwas Leeres zu liefern. Das Formular schickt `wiki_id` und
//      `wiki_url` bei JEDEM Speichern mit; ein aufgeloestes Leeres loeschte die Zuweisung.
//   5. KEIN dritter Zustand -- das Gebiet kann den Merker nicht tragen (drei Gruende im Register).
//
// ⭐ Und die Lehre aus den Aufgaben 3-6 steht ueber allem: eine Textprobe misst die FORM des Codes,
// nicht sein Verhalten. Ab Teil 3 laeuft die ECHTE Oberflaeche in einem vm-Sandkasten mit
// untergeschobenem `fetch`; geklickt wird ueber die Zuhoerer, die `mount` selbst angehaengt hat.
//
// Run: node js/ui/__tests__/wiki-assign-territorium.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER,
	AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT,
	AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT,
	avesmapsWikiAssignTerritoriumZeitraum,
	avesmapsWikiAssignTerritoriumModell,
	avesmapsWikiAssignTerritoriumEltern,
	avesmapsWikiAssignTerritoriumWerte,
	avesmapsWikiAssignTerritoriumTreffer,
	avesmapsWikiAssignTerritoriumArtikel,
	avesmapsWikiAssignTerritoriumZustand,
	avesmapsWikiAssignTerritoriumSyncWerte,
	avesmapsWikiAssignTerritoriumSyncLeer,
} = require("../wiki-assign-territorium.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prueft BEIDE
// und liefert sonst nur einen Blindgaenger.
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
function zaehl() { checks++; }

// ── Die Fixture: der Modellbaum, wie ihn `?action=model_tree` liefert ─────────────────────────
// 🔴 Die Feldnamen sind die der Antwort (api/_internal/wiki/sync-monitor-tree.php:208-276):
// `wiki_key`, `name`, `parent_wiki_key`, `auto_parent_wiki_key`, `parent_locked`, `public_id`.
// `public_id` ist die des zugehoerigen HERRSCHAFTSGEBIETS, nicht des Wiki-Knotens (:274).
const MODELL_KNOTEN = [
	{
		wiki_key: "wiki:f-rstentum-kosch", name: "Fürstentum Kosch", public_id: "T-KOSCH",
		parent_wiki_key: null, auto_parent_wiki_key: "wiki:kaiserreich-mittelreich",
		// 🔴 DIE SPERRE. Im Modell steht KEIN Eltern (der Editor hat ihn herausgenommen), das Wiki
		// schlaegt weiterhin das Mittelreich vor -- genau die zwei Werte, die `parent_locked` trennt.
		parent_locked: true,
	},
	{
		wiki_key: "wiki:kaiserreich-mittelreich", name: "Kaiserreich Mittelreich", public_id: "T-MR",
		parent_wiki_key: null, auto_parent_wiki_key: null, parent_locked: false,
	},
	{
		wiki_key: "wiki:grafschaft-ferdok", name: "Grafschaft Ferdok", public_id: "T-FERDOK",
		parent_wiki_key: "wiki:f-rstentum-kosch", auto_parent_wiki_key: "wiki:f-rstentum-kosch",
		parent_locked: false,
	},
];

// ── Die Fixture: zwei Zeilen, wie `?action=wiki_list` sie liefert ─────────────────────────────
// 🔴 Die 16 Schluessel von avesmapsPoliticalWikiReferenceRowToPublic
// (api/_internal/political/territories-read.php) -- `affiliation_path` ist bereits DEKODIERT und
// damit eine Liste, kein JSON-Text.
const WIKI_LISTE = [
	{
		id: 7, wiki_key: "wiki:f-rstentum-kosch", name: "Fürstentum Kosch", type: "Fürstentum",
		continent: "Aventurien", affiliation_raw: "Kaiserreich Mittelreich",
		affiliation_root: "Mittelreich", affiliation_path: ["Mittelreich", "Kosch"],
		status: "bestehend", capital_name: "Angbar", seat_name: "Angbar",
		ruler: "Blasius von Eberstamm", founded_text: "um 500 BF", dissolved_text: "",
		wiki_url: "https://de.wiki-aventurica.de/wiki/F%C3%BCrstentum_Kosch",
		coat_of_arms_url: "https://de.wiki-aventurica.de/kosch.png",
	},
	{
		id: 9, wiki_key: "wiki:grafschaft-ferdok", name: "Grafschaft Ferdok", type: "Grafschaft",
		continent: "Aventurien", affiliation_raw: "Fürstentum Kosch",
		affiliation_root: "Mittelreich", affiliation_path: ["Mittelreich", "Kosch", "Ferdok"],
		status: "bestehend", capital_name: "Ferdok", seat_name: "", ruler: "Growin Sohn des Angrax",
		founded_text: "", dissolved_text: "", wiki_url: "https://de.wiki-aventurica.de/wiki/Ferdok",
		coat_of_arms_url: "",
	},
];

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DER ZEITRAUM ───────────────────────────────────────────────────────────────────────────
// Wortgleich zu `buildWikiReferencePeriod` (js/review/review-region-parent-tree.js): leere
// Haelften fallen weg, verbunden wird mit " - ".
assert.strictEqual(avesmapsWikiAssignTerritoriumZeitraum({ founded_text: "um 500 BF", dissolved_text: "" }), "um 500 BF");
assert.strictEqual(avesmapsWikiAssignTerritoriumZeitraum({ founded_text: "12 BF", dissolved_text: "980 BF" }), "12 BF - 980 BF");
assert.strictEqual(avesmapsWikiAssignTerritoriumZeitraum({}), "");
zaehl(); zaehl(); zaehl();

// ── 2) DER MODELLBAUM: GELESEN IST NICHT LEER ─────────────────────────────────────────────────
const MODELL = avesmapsWikiAssignTerritoriumModell(MODELL_KNOTEN, true);
const MODELL_UNGELESEN = avesmapsWikiAssignTerritoriumModell([], false);
assert.strictEqual(MODELL.gelesen, true);
assert.strictEqual(MODELL_UNGELESEN.gelesen, false);
assert.strictEqual(MODELL.knoten["wiki:f-rstentum-kosch"].name, "Fürstentum Kosch");
// 💣 Ein LEERER, aber gelesener Baum ist etwas anderes als ein nicht gelesener -- und nur der zweite
// sperrt. Ohne diese Trennung waere „der Server war nicht erreichbar" von „hier ist nichts gesperrt"
// nicht zu unterscheiden.
assert.strictEqual(avesmapsWikiAssignTerritoriumModell([], true).gelesen, true);
zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) 🔴 DIE ELTERN-SPERRE -- DER KERN DIESER AUFGABE ────────────────────────────────────────
const ELTERN_KOSCH = avesmapsWikiAssignTerritoriumEltern("wiki:f-rstentum-kosch", MODELL);
assert.strictEqual(ELTERN_KOSCH.gesperrt, true, "parent_locked=1 sperrt die Eltern-Zeile nicht");
assert.strictEqual(ELTERN_KOSCH.grund, AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT);
// ⚠️ Der Vorschlag steht TROTZ Sperre da -- gesperrt heisst „nicht uebernehmen", nicht „nicht zeigen".
// Ein Editor, der nicht sieht, WAS gesperrt ist, kann die Sperre nicht beurteilen.
assert.strictEqual(ELTERN_KOSCH.name, "Kaiserreich Mittelreich");
assert.strictEqual(ELTERN_KOSCH.public_id, "T-MR");
zaehl(); zaehl(); zaehl(); zaehl();

const ELTERN_FERDOK = avesmapsWikiAssignTerritoriumEltern("wiki:grafschaft-ferdok", MODELL);
assert.strictEqual(ELTERN_FERDOK.gesperrt, false, "ein ungesperrter Knoten wird faelschlich gesperrt");
assert.strictEqual(ELTERN_FERDOK.grund, "");
assert.strictEqual(ELTERN_FERDOK.name, "Fürstentum Kosch");
assert.strictEqual(ELTERN_FERDOK.public_id, "T-KOSCH");
zaehl(); zaehl(); zaehl(); zaehl();

// 💣 NICHT NACHLESBAR SPERRT. Der Baum ist leer, WEIL er nicht geholt werden konnte.
const ELTERN_BLIND = avesmapsWikiAssignTerritoriumEltern("wiki:grafschaft-ferdok", MODELL_UNGELESEN);
assert.strictEqual(ELTERN_BLIND.gesperrt, true,
	"ein nicht gelesener Modellbaum laesst die Eltern-Zeile offen -- die Vorschau boete an, eine gesperrte Hierarchie zu ueberschreiben");
assert.strictEqual(ELTERN_BLIND.grund, AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT);
assert.strictEqual(ELTERN_BLIND.public_id, "");
zaehl(); zaehl(); zaehl();

// ⚠️ Ein Gebiet, das der GELESENE Baum nicht kennt, ist nicht gesperrt -- es gibt dort schlicht
// nichts zu uebernehmen. Das ist die dritte Lage und darf nicht mit der zweiten zusammenfallen.
const ELTERN_UNBEKANNT = avesmapsWikiAssignTerritoriumEltern("wiki:gibtesnicht", MODELL);
assert.strictEqual(ELTERN_UNBEKANNT.gesperrt, false);
assert.strictEqual(ELTERN_UNBEKANNT.name, "");
zaehl(); zaehl();

// ── 4) DIE WERTE ──────────────────────────────────────────────────────────────────────────────
const WERTE_KOSCH = avesmapsWikiAssignTerritoriumWerte(WIKI_LISTE[0], ELTERN_KOSCH);
assert.strictEqual(WERTE_KOSCH.name, "Fürstentum Kosch");
assert.strictEqual(WERTE_KOSCH.type, "Fürstentum");
assert.strictEqual(WERTE_KOSCH.eltern, "Kaiserreich Mittelreich");
assert.strictEqual(WERTE_KOSCH.zeitraum, "um 500 BF");
// 💣 `affiliation_path` kommt als LISTE (avesmapsPoliticalDecodeJson) -- ungeformt staende
// „[object Object]" bzw. eine kommaverbundene Rohform im Kasten.
assert.strictEqual(WERTE_KOSCH.affiliation_path, "Mittelreich › Kosch");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 JEDES Wiki-Feld der Erklaerung hat einen Wert -- sonst faellt eine Zeile im Kasten stumm weg.
avesmapsWikiAssignSubject("territorium").felder.forEach((feld) => {
	assert.ok(Object.prototype.hasOwnProperty.call(WERTE_KOSCH, feld.wiki),
		'die Erklaerung nennt das Wiki-Feld "' + feld.wiki + '", der Datenweg liefert es nicht');
});
zaehl();

// ── 5) DER TREFFER ────────────────────────────────────────────────────────────────────────────
const TREFFER_KOSCH = avesmapsWikiAssignTerritoriumTreffer(WIKI_LISTE[0], MODELL);
assert.strictEqual(TREFFER_KOSCH.wiki_key, "wiki:f-rstentum-kosch");
// 💣 `roh.id` ist der SCHLUESSEL DER ZUWEISUNG (`update_territory` will `wiki_id`) -- ohne ihn ist
// der Treffer nicht zuweisbar, und das faellt erst beim Speichern auf.
assert.strictEqual(TREFFER_KOSCH.roh.id, 7);
// 🔴 Der Eltern-Vorschlag steckt SCHON im Treffer: `trefferWaehlen` uebernimmt `treffer.werte`
// unveraendert in den Artikel. Fehlte er, staende die Zeile nach jeder frischen Zuweisung als
// „das Wiki sagt nichts" da, obwohl das Wiki sehr wohl etwas sagt.
assert.strictEqual(TREFFER_KOSCH.werte.eltern, "Kaiserreich Mittelreich");
zaehl(); zaehl(); zaehl();

// ── 6) DER ARTIKEL ────────────────────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignTerritoriumArtikel({}, null, MODELL), null,
	"ohne Kennung, Schluessel und Adresse ist NICHTS zugewiesen -- das ist ein gueltiger Zustand");
const ARTIKEL = avesmapsWikiAssignTerritoriumArtikel(
	{ wiki_id: "7", wiki_key: "wiki:f-rstentum-kosch", wiki_url: WIKI_LISTE[0].wiki_url },
	WIKI_LISTE[0], MODELL
);
assert.strictEqual(ARTIKEL.name, "Fürstentum Kosch");
assert.strictEqual(ARTIKEL.werte.eltern, "Kaiserreich Mittelreich");
// ⚠️ Eine Kennung OHNE Kandidatenzeile (verwaister Schluessel) ist kein Fehler -- der Artikel steht
// mit Adresse da, die Anzeige-Zeilen fallen weg.
const ARTIKEL_WAISE = avesmapsWikiAssignTerritoriumArtikel({ wiki_id: "999", wiki_url: "https://x/y" }, null, MODELL);
assert.ok(ARTIKEL_WAISE !== null);
assert.strictEqual(ARTIKEL_WAISE.werte.type, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 7) DER ZUSTAND ────────────────────────────────────────────────────────────────────────────
// 💣 WIRFT, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
assert.throws(() => avesmapsWikiAssignTerritoriumZustand(null), /kein Gebiet/);
assert.throws(() => avesmapsWikiAssignTerritoriumZustand([]), /kein Gebiet/);
zaehl(); zaehl();

const ZUSTAND = avesmapsWikiAssignTerritoriumZustand({
	wiki_id: "7", wiki_key: "wiki:f-rstentum-kosch", wiki_url: WIKI_LISTE[0].wiki_url,
	kandidat: WIKI_LISTE[0], kandidaten: WIKI_LISTE, modell: MODELL,
	name: "Kosch", type: "Fürstentum", coat_of_arms_url: "", eltern: "",
});
assert.deepStrictEqual(ZUSTAND.gesperrt, { eltern: AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT },
	"der Zustand traegt die Sperre nicht an die Feldzeile");
// 🔴 NUR `eltern` -- kein anderes Kartenfeld ist mitgesperrt.
assert.deepStrictEqual(Object.keys(ZUSTAND.gesperrt), ["eltern"]);
assert.strictEqual(ZUSTAND.keinArtikel, false, "das Gebiet kann den dritten Zustand nicht tragen");
// 🔴 Die Kandidaten reisen FERTIG AUFBEREITET mit: die Listen-Suche reicht den Eintrag unveraendert
// als Treffer weiter -- eine rohe Zeile haette kein `werte`.
assert.strictEqual(ZUSTAND.listen.territorien.length, 2);
assert.strictEqual(ZUSTAND.listen.territorien[0].werte.type, "Fürstentum");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 💣 LESEFUNKTIONEN, NICHT WERTE: `laden` laeuft EINMAL, die Vorschau entsteht erst beim Druck auf
// „Sync" -- dazwischen kann getippt worden sein.
let getipptenName = "Kosch";
const ZUSTAND_LEBEND = avesmapsWikiAssignTerritoriumZustand({
	wiki_id: "7", wiki_key: "wiki:f-rstentum-kosch", kandidat: WIKI_LISTE[0], modell: MODELL,
	name: () => getipptenName, type: () => "", coat_of_arms_url: () => "", eltern: () => "",
});
getipptenName = "Kosch (getippt)";
assert.strictEqual(ZUSTAND_LEBEND.kartenwerte.name, "Kosch (getippt)",
	"die Kartenwerte wurden beim Laden eingefroren -- die Vorschau vergliche gegen einen alten Stand");
zaehl();

// ── 8) DIE GEGENPROBE ZUM FELDREGISTER ────────────────────────────────────────────────────────
// 🔴 Beide Listen muessen sich decken. Eine dritte Liste irgendwo waere die naechste Divergenz.
const REGISTER_ZIELE = AVESMAPS_WIKI_ASSIGN_REGISTRY.territorium.felder
	.map((feld) => feld.karte).filter((karte) => karte !== "");
assert.deepStrictEqual(REGISTER_ZIELE.slice().sort(), AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER.slice().sort(),
	"Feldregister und Kartenfeld-Liste weichen voneinander ab");
zaehl();

// ── 9) DIE SYNC-WERTE -- UND DIE ELTERN-KENNUNG ───────────────────────────────────────────────
const ZEILEN = avesmapsWikiAssignDiff(
	AVESMAPS_WIKI_ASSIGN_REGISTRY.territorium.felder,
	{ name: "Kosch", type: "Fürstentum", eltern: "", coat_of_arms_url: "" },
	ARTIKEL.werte,
	[]
);
// Gleich (type) faellt heraus; Name, Eltern und Wappen unterscheiden sich.
assert.deepStrictEqual(ZEILEN.map((z) => z.karte), ["name", "eltern", "coat_of_arms_url"]);
// 🔴 DIE FIXTURE IST ABSICHTLICH SO GEBAUT: der Kartenwert der Eltern ist LEER, das Wiki sagt etwas
// -- ohne Sperre waere diese Zeile VORANGEHAKT. Genau daran faellt eine entfernte Sperre auf.
assert.strictEqual(ZEILEN.filter((z) => z.karte === "eltern")[0].gehakt, true,
	"ohne Riegel muesste die Eltern-Zeile vorangehakt sein -- sonst prueft Teil 2 nichts");
zaehl(); zaehl();

const SYNC_WERTE = avesmapsWikiAssignTerritoriumSyncWerte(ZEILEN, ELTERN_KOSCH);
assert.strictEqual(SYNC_WERTE.name, "Fürstentum Kosch");
assert.strictEqual(SYNC_WERTE.eltern, "Kaiserreich Mittelreich");
// 🔴 GESCHRIEBEN WIRD DIE KENNUNG, NIE DER NAME.
assert.strictEqual(SYNC_WERTE.eltern_public_id, "T-MR");
zaehl(); zaehl(); zaehl();

// 💣 Passt der Name in der Zeile nicht mehr zu dem, was zuletzt geladen wurde, gibt es KEINE
// Kennung -- und dann wird an der Hierarchie nichts gesetzt. Aufgeloest wird nie ueber den Namen:
// im Politik-Layer hat ein `á` gegen ein `â` schon ein zweites Gebiet erzeugt.
const SYNC_VERALTET = avesmapsWikiAssignTerritoriumSyncWerte(ZEILEN, { name: "Etwas anderes", public_id: "T-XX" });
assert.strictEqual(SYNC_VERALTET.eltern, null);
assert.strictEqual(SYNC_VERALTET.eltern_public_id, null);
// ⚠️ Die uebrigen Angaben bleiben trotzdem uebernehmbar -- ein veralteter Eltern-Vorschlag darf den
// Namen nicht mitnehmen.
assert.strictEqual(SYNC_VERALTET.name, "Fürstentum Kosch");
assert.strictEqual(avesmapsWikiAssignTerritoriumSyncLeer(SYNC_VERALTET), false);
zaehl(); zaehl(); zaehl(); zaehl();

assert.strictEqual(avesmapsWikiAssignTerritoriumSyncLeer(avesmapsWikiAssignTerritoriumSyncWerte([], ELTERN_KOSCH)), true);
zaehl();

// ══ TEIL 2: DAS BAUTEIL -- die gesperrte Zeile im echten Ablauf ═══════════════════════════════
// 🔴 NICHT die reine Diff-Rechnung, sondern `mount` samt Klick auf „Sync": der Riegel sitzt in
// `syncOeffnen` (js/ui/wiki-assign.js), und nur ein Klick faehrt ihn wirklich.

function scheinBehaelter(id) {
	const zuhoerer = {};
	const element = {
		id: id || "host", textContent: "", innerHTML: "", className: "", value: "",
		dataset: {}, style: {}, options: [], hidden: false, disabled: false, checked: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains() { return true; },
		appendChild() {}, removeChild() {}, remove() {}, insertBefore() {}, replaceChildren() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, focus() {}, select() {}, dispatchEvent() { return true; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
		hatZuhoerer(typ) { return typeof zuhoerer[typ] === "function"; },
	};
	return element;
}

function scheinZiel(merkmal, wert, zusatz) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, zusatz || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

function scheinFeld(wert, optionen) {
	return {
		value: wert === undefined ? "" : wert,
		options: (optionen || []).map((v) => ({ value: v })),
		checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "", className: "",
		dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild(kind) { this.options.push(kind); },
		remove() {}, replaceChildren() {}, append(kind) { this.options.push(kind); },
		setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, select() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

/** Die Haekchenzeilen aus dem gezeichneten Kasten -- Beschriftung, gesperrt?, gehakt?, Grund. */
function syncZeilenAus(innerHTML) {
	return String(innerHTML).split("</label>").slice(0, -1).map((stueck) => {
		const name = (/wiki-sync-row__k[^>]*>([^<]*)</.exec(stueck) || [])[1] || "";
		const grund = (/wiki-sync-row__grund[^>]*>([^<]*)</.exec(stueck) || [])[1] || "";
		return {
			label: name,
			gesperrt: / disabled/.test(stueck),
			gehakt: / checked/.test(stueck),
			grund: grund,
		};
	}).filter((zeile) => zeile.label !== "");
}

function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	const treffer = inhalt.match(/<script[^>]+src="([^"]+)"/g) || [];
	return treffer
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => (muster ? muster.test(src) : true))
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

/** Ein Sandkasten mit Dokument-Attrappe und aufgezeichnetem `fetch`. */
function sandkastenBauen(dateien, felder, behaelterIds, fetchAntwort, zusatz) {
	const elemente = {};
	Object.keys(felder || {}).forEach((id) => { elemente[id] = felder[id]; });
	(behaelterIds || []).forEach((id) => { elemente[id] = scheinBehaelter(id); });
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return scheinFeld(""); },
		querySelectorAll() { return []; },
		createElement() { return scheinFeld(""); },
		addEventListener() {},
		body: scheinFeld(""), documentElement: scheinFeld(""),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
		isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
		Event: function () {}, Option: function (label, wert) { return { label: label, value: wert }; },
		document: dokument,
		location: { href: "http://pruefstand.local/", search: "" },
		fetch(url, opt) {
			gesendet.push({ url: String(url), methode: (opt && opt.method) || "GET" });
			const antwort = fetchAntwort(String(url));
			if (antwort && antwort.wirf) { return Promise.reject(new Error("Netz")); }
			return Promise.resolve({
				ok: antwort.httpOk !== false, status: antwort.status || 200,
				json: () => Promise.resolve(antwort),
			});
		},
	};
	Object.assign(kasten, zusatz || {});
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	return { kasten: kasten, elemente: elemente, gesendet: gesendet };
}

// Die Dateien der ECHTEN Oberflaeche, in der Reihenfolge, in der index.html sie bindet.
const OBERFLAECHE = [
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
	"js/ui/wiki-assign-territorium.js", "js/review/review-region-wiki-picker.js",
];

/**
 * Der Kartendialog „Herrschaftsgebiet bearbeiten" -- die Formularfelder, die der Datenweg liest,
 * mit ihren echten Kennungen aus index.html.
 */
function dialogFelder(elternBeschriftung) {
	const parentLabel = scheinFeld("");
	parentLabel.textContent = elternBeschriftung === undefined ? "Kein Parent" : elternBeschriftung;
	return {
		"region-edit-wiki-id": scheinFeld("7"),
		"region-edit-wiki-url": scheinFeld(WIKI_LISTE[0].wiki_url),
		"region-edit-name": scheinFeld("Kosch"),
		"region-edit-type": scheinFeld("Fürstentum", ["Fürstentum", "Grafschaft"]),
		"region-edit-coat-url": scheinFeld(""),
		"region-edit-parent-drop-label": parentLabel,
	};
}

function dialogBauen(modellAntwort, zusatz) {
	const gerufen = { parent: [], quelle: [], wikiListe: 0 };
	const kasten = sandkastenBauen(
		OBERFLAECHE,
		dialogFelder(),
		["territory-wiki-assign-host"],
		() => modellAntwort,
		Object.assign({
			politicalTerritoryWikiReferences: [],
			fetchPoliticalTerritories: () => { gerufen.wikiListe++; return Promise.resolve({ wiki: WIKI_LISTE }); },
			normalizeParentheticalSpacing: (wert) => String(wert || ""),
			syncRegionCoatPreview: () => {},
			toggleOtherSourceSection: (praefix, hatWiki) => { gerufen.quelle.push(hatWiki); },
			updateRegionParentDropTarget: (id) => { gerufen.parent.push(id); },
		}, zusatz || {})
	);
	return Object.assign(kasten, { gerufen: gerufen });
}

const MODELL_ANTWORT = { ok: true, nodes: MODELL_KNOTEN };

(async () => {
	// ── A) DIE SKRIPTLISTE STEHT IM DOKUMENT ─────────────────────────────────────────────────
	// 💣 Sonst prueft der Sandkasten nur sich selbst: eine im Dokument VERGESSENE `<script>`-Zeile
	// bliebe unsichtbar, und live gaebe `mount` einen Blindgaenger.
	const skripte = skripteAus("index.html", /wiki-assign|review-region-wiki-picker/);
	["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-territorium.js", "js/review/review-region-wiki-picker.js"].forEach((datei) => {
		assert.ok(skripte.indexOf(datei) !== -1, "index.html bindet " + datei + " nicht: " + skripte.join(" "));
	});
	assert.ok(skripte.indexOf("js/ui/wiki-assign-territorium.js") < skripte.indexOf("js/review/review-region-wiki-picker.js"),
		"der Datenweg des Gebiets steht NACH seiner Oberflaeche: " + skripte.join(" "));
	assert.ok(skripte.indexOf("js/ui/wiki-assign.js") < skripte.indexOf("js/ui/wiki-assign-territorium.js"),
		"das Bauteil steht NACH dem Datenweg: " + skripte.join(" "));
	zaehl(); zaehl(); zaehl();

	// ── B) 🔴 DIE ABNAHME: SPERRE GESETZT ⇒ „ELTERN" GESPERRT, DIE UEBRIGEN NICHT ────────────
	const dialog = dialogBauen(MODELL_ANTWORT);
	const host = dialog.elemente["territory-wiki-assign-host"];
	dialog.kasten.renderRegionWikiReference();
	await ruhe();
	assert.ok(/Fürstentum Kosch/.test(host.innerHTML), "der Kasten zeigt den zugewiesenen Artikel nicht");
	assert.ok(dialog.gesendet.some((a) => /action=model_tree/.test(a.url)), "der Modellbaum wurde nie geholt");
	zaehl(); zaehl();

	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	const vorschau = syncZeilenAus(host.innerHTML);
	assert.deepStrictEqual(vorschau.map((z) => z.label), ["Name", "Eltern", "Wappen"],
		"die Vorschau zeigt andere Zeilen als erwartet: " + host.innerHTML);
	const zeileEltern = vorschau.filter((z) => z.label === "Eltern")[0];
	assert.strictEqual(zeileEltern.gesperrt, true, "die Zeile „Eltern“ ist NICHT gesperrt");
	assert.strictEqual(zeileEltern.gehakt, false, "die gesperrte Zeile „Eltern“ ist angehakt");
	// 💣 NICHT STILL UEBERSPRUNGEN: der Grund steht daneben.
	assert.strictEqual(zeileEltern.grund, AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT,
		"die gesperrte Zeile nennt ihren Grund nicht");
	// 🔴 UND DIE UEBRIGEN BLEIBEN BEDIENBAR -- eine Entscheidung ueber die Hierarchie darf nicht
	// verhindern, dass jemand den Namen nachzieht.
	vorschau.filter((z) => z.label !== "Eltern").forEach((zeile) => {
		assert.strictEqual(zeile.gesperrt, false, 'die Zeile "' + zeile.label + '" ist mitgesperrt');
	});
	// Das Wappen ist auf der Karte leer -> die Luecke bleibt vorangehakt.
	assert.strictEqual(vorschau.filter((z) => z.label === "Wappen")[0].gehakt, true);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// „Alle anhaken" laesst die gesperrte Zeile in Ruhe.
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-alle"));
	const nachAllen = syncZeilenAus(host.innerHTML);
	assert.strictEqual(nachAllen.filter((z) => z.label === "Eltern")[0].gehakt, false,
		"„Alle anhaken“ hakt die gesperrte Zeile mit an");
	assert.strictEqual(nachAllen.filter((z) => z.label === "Name")[0].gehakt, true);
	zaehl(); zaehl();

	// Uebernehmen: Name und Wappen wandern ins Formular, die Hierarchie bleibt unangetastet.
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(dialog.elemente["region-edit-name"].value, "Fürstentum Kosch");
	assert.strictEqual(dialog.elemente["region-edit-coat-url"].value, WIKI_LISTE[0].coat_of_arms_url);
	assert.deepStrictEqual(dialog.gerufen.parent, [],
		"eine gesperrte Hierarchie wurde trotzdem geschrieben");
	zaehl(); zaehl(); zaehl();

	// ── C) OHNE SPERRE: DIE ZEILE IST BEDIENBAR UND SCHREIBT DIE KENNUNG ─────────────────────
	const offen = dialogBauen({
		ok: true,
		nodes: MODELL_KNOTEN.map((k) => Object.assign({}, k, { parent_locked: false })),
	});
	const offenHost = offen.elemente["territory-wiki-assign-host"];
	offen.kasten.renderRegionWikiReference();
	await ruhe();
	offenHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	const offeneZeile = syncZeilenAus(offenHost.innerHTML).filter((z) => z.label === "Eltern")[0];
	assert.strictEqual(offeneZeile.gesperrt, false, "ohne parent_locked wird trotzdem gesperrt");
	assert.strictEqual(offeneZeile.gehakt, true, "die freie Eltern-Zeile ist nicht vorangehakt");
	offenHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	// 🔴 DIE KENNUNG, NIE DER NAME.
	assert.deepStrictEqual(offen.gerufen.parent, ["T-MR"],
		"die Eltern-Uebernahme schrieb nicht die public_id des Wiki-Elternteils");
	zaehl(); zaehl(); zaehl();

	// ── D) DER MODELLBAUM FAELLT AUS: DER KASTEN LEBT, DIE ELTERN-ZEILE SPERRT ───────────────
	// ⚠️ Ein 403 auf den Modellbaum darf den Zuweisungskasten NICHT mitnehmen -- er traegt nur die
	// eine Zeile. Aber blind uebernehmen darf er sie auch nicht.
	const blind = dialogBauen({ httpOk: false, status: 403, ok: false });
	const blindHost = blind.elemente["territory-wiki-assign-host"];
	blind.kasten.renderRegionWikiReference();
	await ruhe();
	assert.ok(/Fürstentum Kosch/.test(blindHost.innerHTML),
		"ein Fehlschlag beim Modellbaum hat den ganzen Kasten mitgenommen");
	blindHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	const blindZeile = syncZeilenAus(blindHost.innerHTML).filter((z) => z.label === "Eltern")[0];
	// Ohne Modellbaum gibt es gar keinen Vorschlag -- die Zeile faellt aus dem Diff heraus, weil
	// Kartenwert und Wikiwert beide leer sind. Sie darf jedenfalls NICHT haakbar dastehen.
	assert.ok(!blindZeile || blindZeile.gesperrt === true,
		"ohne lesbaren Modellbaum steht die Eltern-Zeile bedienbar da");
	zaehl(); zaehl();

	// ── E) `laden` LEHNT AB, WENN DIE KANDIDATEN NICHT KOMMEN ────────────────────────────────
	// 🔴 KEINE TEXTPROBE: der Rueckruf wird WIRKLICH gefahren. Ein `laden`, das im Fehlerfall
	// aufloest, malte den offenen Zustand -- und das naechste „Speichern" schickte `wiki_id: ""`.
	const kaputt = dialogBauen(MODELL_ANTWORT, {
		fetchPoliticalTerritories: () => Promise.reject(new Error("HTTP 500")),
	});
	const kaputtHost = kaputt.elemente["territory-wiki-assign-host"];
	kaputt.kasten.renderRegionWikiReference();
	await ruhe();
	assert.ok(/nicht gelesen werden/.test(kaputtHost.textContent + kaputtHost.innerHTML),
		"der Kasten sagt nicht, dass der Stand nicht gelesen werden konnte");
	// Und der Riegel WIRKT, nicht nur die Anzeige: `bereit === false`.
	// ⚠️ `territoryWikiAssign` ist ein `let` auf oberster Ebene der Datei -- eine LEXIKALISCHE
	// Bindung, die NICHT als Eigenschaft am Sandkasten-Objekt landet. Sie lebt im globalen
	// lexikalischen Bereich des Kontexts, also wird sie dort gelesen, nicht ueber `kasten.x`.
	const steuerung = vm.runInContext("territoryWikiAssign", kaputt.kasten);
	assert.strictEqual(steuerung.bereit, false, "ein gescheitertes `laden` laesst `bereit` auf true");
	assert.strictEqual(steuerung.lies(), null, "`lies()` liefert nach einem Fehlschlag einen Schreibwert");
	zaehl(); zaehl(); zaehl();

	// ── F) ZUWEISEN UND ENTFERNEN ────────────────────────────────────────────────────────────
	const frisch = dialogBauen(MODELL_ANTWORT);
	frisch.elemente["region-edit-wiki-id"].value = "";
	frisch.elemente["region-edit-wiki-url"].value = "";
	const frischHost = frisch.elemente["territory-wiki-assign-host"];
	frisch.kasten.renderRegionWikiReference();
	await ruhe();
	assert.ok(/— keine —/.test(frischHost.innerHTML), "ein Gebiet ohne Zuweisung zeigt den offenen Zustand nicht");
	frischHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(/Grafschaft Ferdok/.test(frischHost.innerHTML), "die Kandidatenliste kommt nicht im Kasten an");
	frischHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.strictEqual(frisch.elemente["region-edit-wiki-id"].value, "7",
		"die Zuweisung schrieb die wiki_id nicht -- ohne sie speichert `update_territory` nichts");
	assert.strictEqual(frisch.elemente["region-edit-wiki-url"].value, WIKI_LISTE[0].wiki_url);
	assert.strictEqual(frisch.elemente["region-edit-coat-url"].value, WIKI_LISTE[0].coat_of_arms_url);
	assert.deepStrictEqual(frisch.gerufen.quelle, [], "kein Schalten von „Andere Quelle“ -- der Abschnitt steht seit dem 31.08.2026 immer");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── F2) 🔴 DIE SUCHBREITE: EIN GEBIET, DAS NUR UEBER EIN NICHT-NAMENSFELD ZU FINDEN IST ──
	// 💣 Der abgeloeste Picker durchsuchte ACHT Felder; das Bauteil filtert von Haus aus nur den
	// Namen. „Growin Sohn des Angrax" ist der OBERHAUPT der Grafschaft Ferdok und kommt in keinem
	// Namen vor -- ohne die Feldliste in der Erklaerung wäre dieses Gebiet nicht mehr auffindbar.
	// ⭐ ABLAUF, nicht Bauer: getippt wird ins echte Suchfeld des gemounteten Kastens.
	frischHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	frischHost.feuere("input", scheinZiel("data-wa-suche", "", { value: "Growin" }));
	await ruhe();
	assert.ok(/Grafschaft Ferdok/.test(frischHost.innerHTML),
		"die Suche über das Oberhaupt findet das Gebiet nicht mehr -- die Sucheinbusse ist zurück");
	assert.ok(!/Fürstentum Kosch/.test(frischHost.innerHTML),
		"die Suche filtert gar nicht -- dann beweist der Treffer oben nichts");
	// ⚠️ Und der NAME bleibt der erste Weg: die Feldliste ergänzt ihn, sie ersetzt ihn nicht.
	frischHost.feuere("input", scheinZiel("data-wa-suche", "", { value: "Kosch" }));
	await ruhe();
	assert.ok(/Fürstentum Kosch/.test(frischHost.innerHTML), "die Namenssuche ist abhanden gekommen");
	// 💣 Und die Faltung: ohne Umlaut muss derselbe Treffer kommen (der alte Picker faltete über
	// normalizeSearchText).
	frischHost.feuere("input", scheinZiel("data-wa-suche", "", { value: "furstentum" }));
	await ruhe();
	assert.ok(/Fürstentum Kosch/.test(frischHost.innerHTML),
		"„furstentum“ findet das „Fürstentum“ nicht mehr");
	frischHost.feuere("click", scheinZiel("data-wa-aktion", "abbrechen"));
	await ruhe();
	zaehl(); zaehl(); zaehl(); zaehl();

	// 🔴 DER DECKEL STEHT IN DER ERKLAERUNG UND IST 250, nicht die 40 der Server-Suchen -- der alte
	// Picker zeigte `.slice(0, 250)`. Bei rund 1.400 Wiki-Gebieten ist das kein Randfall.
	assert.strictEqual(avesmapsWikiAssignSubject("territorium").suche.limit, 250);

	// 💣 UND ER MUSS AUCH ANKOMMEN. Die Zahl im Register zu pruefen ist eine Textprobe: liest
	// `trefferHolen` sie nicht aus (`suche.limit`), bleibt die Kappung bei 40 und niemand merkt es.
	// ⭐ Also ABLAUF: 300 Kandidaten in den Kasten, Suche oeffnen, gezeichnete Zeilen zaehlen.
	const vieleKandidaten = Array.from({ length: 300 }, (_, i) => ({
		id: 1000 + i, wiki_key: "wiki:probe-" + i, name: "Probegebiet " + i, type: "Baronie",
		continent: "Aventurien", affiliation_raw: "", affiliation_root: "", affiliation_path: [],
		status: "", capital_name: "", seat_name: "", ruler: "", founded_text: "", dissolved_text: "",
		wiki_url: "https://x/" + i, coat_of_arms_url: "",
	}));
	const massen = dialogBauen(MODELL_ANTWORT, {
		fetchPoliticalTerritories: () => Promise.resolve({ wiki: vieleKandidaten }),
	});
	massen.elemente["region-edit-wiki-id"].value = "";
	massen.elemente["region-edit-wiki-url"].value = "";
	const massenHost = massen.elemente["territory-wiki-assign-host"];
	massen.kasten.renderRegionWikiReference();
	await ruhe();
	massenHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	const gezeichnet = (massenHost.innerHTML.match(/data-wa-treffer=/g) || []).length;
	assert.strictEqual(gezeichnet, 250,
		"der Deckel aus der Erklaerung kommt nicht an -- gezeichnet wurden " + gezeichnet + " statt 250");
	zaehl();
	// ⚠️ Gezaehlt, nicht geglaubt: JEDES erklaerte Suchfeld muss der Datenweg auch liefern -- was die
	// Suche nicht herausgibt, kann man nicht durchsuchen.
	avesmapsWikiAssignSubject("territorium").suche.felder.forEach((feld) => {
		assert.ok(Object.prototype.hasOwnProperty.call(WERTE_KOSCH, feld),
			'das Suchfeld "' + feld + '" wird erklaert, aber vom Datenweg nicht geliefert');
	});
	zaehl(); zaehl();

	frischHost.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.strictEqual(frisch.elemente["region-edit-wiki-id"].value, "");
	assert.strictEqual(frisch.elemente["region-edit-wiki-url"].value, "");
	assert.deepStrictEqual(frisch.gerufen.quelle, [], "auch das Entfernen der Zuweisung schaltet ihn nicht");
	zaehl(); zaehl(); zaehl();

	// ── G) DAS ABGELOESTE FENSTER IST WIRKLICH WEG -- GEZAEHLT, NICHT AUFGESCHRIEBEN ─────────
	// 💣 Eine aufgeschriebene Dateiliste liest sich wie eine vollstaendige Pruefung und ist keine.
	// Gezaehlt wird deshalb ueber den BAUM: keine ausgelieferte Quelle darf die Kennungen des alten
	// Auswahlfensters noch benutzen. Ein zurueckgebliebener Zuhoerer griffe ins Leere.
	const zuDurchsuchen = [];
	(function sammle(verzeichnis) {
		fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true }).forEach((eintrag) => {
			const relativ = verzeichnis + "/" + eintrag.name;
			if (eintrag.isDirectory()) {
				if (eintrag.name !== "third-party" && eintrag.name !== "__tests__") { sammle(relativ); }
				return;
			}
			if (/\.(js|css)$/.test(eintrag.name)) { zuDurchsuchen.push(relativ); }
		});
	})("js");
	["css"].forEach((verzeichnis) => (function sammle(v) {
		fs.readdirSync(path.join(wurzel, v), { withFileTypes: true }).forEach((eintrag) => {
			const relativ = v + "/" + eintrag.name;
			if (eintrag.isDirectory()) { sammle(relativ); return; }
			if (/\.css$/.test(eintrag.name)) { zuDurchsuchen.push(relativ); }
		});
	})(verzeichnis));
	zuDurchsuchen.push("index.html");
	const rueckstaende = zuDurchsuchen.filter((datei) => {
		const inhalt = fs.readFileSync(path.join(wurzel, datei), "utf8");
		// Kommentare zaehlen nicht: sie erklaeren den Wegfall. Gesucht wird die BENUTZUNG.
		const ohneKommentare = inhalt
			.replace(/\/\*[\s\S]*?\*\//g, "")       // /* … */ (CSS und JS, mehrzeilig)
			.replace(/<!--[\s\S]*?-->/g, "")        // <!-- … --> (HTML, mehrzeilig)
			.replace(/^\s*\/\/.*$/gm, "");          // // … (JS)
		return /[#"'.]region-wiki-picker/.test(ohneKommentare);
	});
	assert.deepStrictEqual(rueckstaende, [],
		"das abgeloeste Auswahlfenster wird noch benutzt in: " + rueckstaende.join(", "));
	assert.ok(zuDurchsuchen.length > 200, "die Zaehlung hat kaum Dateien gesehen (" + zuDurchsuchen.length + ") -- sie prueft nichts");
	zaehl(); zaehl();

	console.log("wiki-assign-territorium: " + checks + " Zusicherungen erfuellt");
})();
