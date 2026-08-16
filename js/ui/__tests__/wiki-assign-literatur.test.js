// Die LITERATUR als Objektart (Aufgabe 8, Entwurf §8).
//
// 🔴 Was hier festgenagelt wird, und jedes davon ist gemessen, nicht vermutet:
//   1. DAS FREIE TEXTFELD IST WEG. „Wiki-URL" ist kein `[data-field]` mehr -- eine Adresse wird
//      gesucht, nicht getippt. F-Shop-Code und Cover-URL bleiben Textfelder.
//   2. `laden` LEHNT AB, wenn der Katalogsatz nicht zu holen war. Diese Oberfläche schreibt erst
//      beim „Speichern"; ein aufgelöstes Leeres löschte die Zuweisung samt `wiki_key`.
//   3. DIE ZUWEISUNG REIST BEIM SPEICHERN MIT -- `wiki_url` UND `wiki_key`. Ohne sie wäre die
//      Zuweisung nach dem Umbau gar nicht mehr speicherbar (`gatherStamm` liest nur `[data-field]`,
//      `upsert_adventure` fasst nur mitgeschickte Felder an).
//   4. `handgesetzt` KOMMT AUS `field_origins` -- die erste Objektart mit echter Feldherkunft. Eine
//      von Hand gesetzte Angabe steht in der Vorschau, ist aber NICHT vorangehakt.
//   5. `haengtAn` warnt VOR dem Klick, und zwar über die public_id, nie über den Titel.
//   6. KEIN dritter Zustand -- die Literatur kann den Merker nicht tragen (drei Gründe im Register).
//
// ⭐ Die Lehre aus den Aufgaben 3-7 steht über allem: eine Textprobe misst die FORM des Codes, nicht
// sein Verhalten. Ab Teil 3 läuft die ECHTE Oberfläche in einem vm-Sandkasten -- und weil sie inline
// in html/game-literature-editor.html steht, wird genau dieser Block herausgeschnitten und
// ausgeführt. Geklickt wird über die Zuhörer, die `mount` selbst angehängt hat.
//
// Run: node js/ui/__tests__/wiki-assign-literatur.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER,
	avesmapsWikiAssignLiteraturWerte,
	avesmapsWikiAssignLiteraturHandgesetzt,
	avesmapsWikiAssignLiteraturTreffer,
	avesmapsWikiAssignLiteraturArtikel,
	avesmapsWikiAssignLiteraturZustand,
	avesmapsWikiAssignLiteraturSyncWerte,
	avesmapsWikiAssignLiteraturSyncLeer,
} = require("../wiki-assign-literatur.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prüft BEIDE.
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/game-literature-editor.html";
let checks = 0;
function zaehl() { checks++; }

// ── Die Fixture: eine Zeile, wie sie der Suchendpunkt liefert ─────────────────────────────────
// 🔴 Die Schlüssel sind die von avesmapsWikiGameLiteratureSearchSelect
// (api/_internal/wiki/game-literature-sync.php) -- `art`, `isbn` und `publisher` kommen aus dem
// PUBLIKATIONS-Katalog, alles davor aus dem Literatur-Katalog, `belegt_*` aus der Kartenzeile.
const KATALOG_KELCH = {
	wiki_key: "madas-kelch",
	title: "Madas Kelch",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Madas_Kelch",
	product_type: "gruppenabenteuer",
	edition: "DSA4.1",
	genre: "Mystik",
	complexity_gm: "mittel",
	complexity_pl: "mittel",
	authors: "Anton Weste",
	series: "Splitterdämmerung",
	fshop_code: "US25001",
	cover_file: "Cover_Madas_Kelch.jpg",
	art: "Abenteuer",
	isbn: "978-3-95752-000-0",
	publisher: "Ulisses Spiele",
	belegt_public_id: "A-KELCH",
	belegt_titel: "Madas Kelch",
};
const KATALOG_FREMD = {
	wiki_key: "die-sieben-gezeichneten",
	title: "Die Sieben Gezeichneten",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Die_Sieben_Gezeichneten",
	product_type: "kampagne", edition: "DSA4", genre: "", complexity_gm: "", complexity_pl: "",
	authors: "Ina Kramer", series: "Borbarad-Kampagne", fshop_code: "", cover_file: "",
	art: "Kampagne", isbn: null, publisher: "Fantasy Productions",
	belegt_public_id: "A-ANDERER", belegt_titel: "Die 7 Gezeichneten",
};
const KATALOG_FREI = Object.assign({}, KATALOG_FREMD, {
	wiki_key: "der-goetzenpfad", title: "Der Götzenpfad", art: "Soloabenteuer",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Der_G%C3%B6tzenpfad",
	series: "", authors: "", product_type: "soloabenteuer",
	belegt_public_id: null, belegt_titel: null,
});

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DIE WERTE ──────────────────────────────────────────────────────────────────────────────
const WERTE = avesmapsWikiAssignLiteraturWerte(KATALOG_KELCH);
assert.strictEqual(WERTE.title, "Madas Kelch");
assert.strictEqual(WERTE.art, "Abenteuer");
assert.strictEqual(WERTE.product_type, "gruppenabenteuer");
assert.strictEqual(WERTE.isbn, "978-3-95752-000-0");
assert.strictEqual(WERTE.publisher, "Ulisses Spiele");
assert.strictEqual(WERTE.cover_file, "Cover_Madas_Kelch.jpg");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ⚠️ `art`/`isbn`/`publisher` kommen über einen LEFT JOIN und dürfen FEHLEN, ohne dass etwas bricht.
const WERTE_OHNE = avesmapsWikiAssignLiteraturWerte({ wiki_key: "x", title: "Y" });
assert.strictEqual(WERTE_OHNE.art, "");
assert.strictEqual(WERTE_OHNE.isbn, "");
zaehl(); zaehl();

// 🔴 JEDES Wiki-Feld der Erklärung hat einen Wert -- sonst fällt eine Zeile im Kasten stumm weg.
avesmapsWikiAssignSubject("literatur").felder.forEach((feld) => {
	assert.ok(Object.prototype.hasOwnProperty.call(WERTE, feld.wiki),
		'die Erklaerung nennt das Wiki-Feld "' + feld.wiki + '", der Datenweg liefert es nicht');
});
zaehl();

// ── 2) 🔴 DIE FELDHERKUNFT ────────────────────────────────────────────────────────────────────
// ⭐ Die erste Objektart, die `handgesetzt` wirklich füllen kann.
const HAND = avesmapsWikiAssignLiteraturHandgesetzt({
	title: "manual", edition: "wiki", genre: "manual",
	// 💣 Felder OHNE Sync-Ziel müssen herausfallen: die Diff-Rechnung schlägt einen Namen nur unter
	// `feld.karte` nach, ein Eintrag dafür wäre wirkungsloser Ballast in einer Liste, die „gesperrt"
	// bedeutet.
	bf_year: "manual", link_ulisses: "manual", wiki_url: "manual",
});
assert.deepStrictEqual(HAND.slice().sort(), ["genre", "title"],
	"die Feldherkunft liefert die falsche Liste: " + JSON.stringify(HAND));
// ⚠️ NUR `'manual'` zählt -- „wiki" heißt „zuletzt vom Abgleich gefüllt" und ist das Gegenteil.
assert.deepStrictEqual(avesmapsWikiAssignLiteraturHandgesetzt({ title: "wiki" }), []);
assert.deepStrictEqual(avesmapsWikiAssignLiteraturHandgesetzt(null), []);
assert.deepStrictEqual(avesmapsWikiAssignLiteraturHandgesetzt("kaputt"), []);
zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) 🔴 DIE BELEGT-WARNUNG ──────────────────────────────────────────────────────────────────
// 💣 `adventure.wiki_key` trägt einen UNIQUE-Key -- ohne die Warnung wäre die zweite Zuweisung ein
// 500er ohne Erklärung.
const TREFFER_FREMD = avesmapsWikiAssignLiteraturTreffer(KATALOG_FREMD, "A-KELCH");
assert.strictEqual(TREFFER_FREMD.haengtAn, "Die 7 Gezeichneten",
	"die Warnung nennt nicht den Titel des belegenden EINTRAGS");
// 🔴 DER EIGENE EINTRAG IST NIE „schon woanders". Sonst warnte der Kasten beim Öffnen der Suche vor
// der Zuweisung, die gerade dasteht.
const TREFFER_EIGEN = avesmapsWikiAssignLiteraturTreffer(KATALOG_KELCH, "A-KELCH");
assert.strictEqual(TREFFER_EIGEN.haengtAn, "", "der eigene Eintrag wird als Fremdbelegung gemeldet");
// 💣 UND DIE UNTERSCHEIDUNG LÄUFT ÜBER DIE KENNUNG, NICHT ÜBER DEN TITEL: hier heißen Artikel und
// belegender Eintrag GLEICH („Madas Kelch"), gehören aber verschiedenen Einträgen.
const TREFFER_GLEICHNAMIG = avesmapsWikiAssignLiteraturTreffer(KATALOG_KELCH, "A-EIN-ANDERER");
assert.strictEqual(TREFFER_GLEICHNAMIG.haengtAn, "Madas Kelch",
	"ein gleichnamiger, aber FREMDER Eintrag wird nicht gemeldet -- verglichen wird über den Titel statt über die Kennung");
// Ein freier Artikel warnt nicht.
assert.strictEqual(avesmapsWikiAssignLiteraturTreffer(KATALOG_FREI, "A-KELCH").haengtAn, "");
// `roh` reist mit -- die Oberfläche liest daraus nichts, aber der Vertrag des Bauteils sieht es vor.
assert.strictEqual(TREFFER_FREMD.wiki_key, "die-sieben-gezeichneten");
assert.strictEqual(TREFFER_FREMD.name, "Die Sieben Gezeichneten");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 4) DER ARTIKEL ────────────────────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignLiteraturArtikel({}, null), null,
	"ohne Schluessel und Adresse ist NICHTS zugewiesen -- das ist ein gueltiger Zustand");
const ARTIKEL = avesmapsWikiAssignLiteraturArtikel(
	{ wiki_key: "madas-kelch", wiki_url: KATALOG_KELCH.wiki_url }, KATALOG_KELCH
);
assert.strictEqual(ARTIKEL.name, "Madas Kelch");
assert.strictEqual(ARTIKEL.werte.edition, "DSA4.1");
// ⚠️ Ein verwaister Schlüssel (kein Katalogsatz mehr) ist kein Fehler.
const WAISE = avesmapsWikiAssignLiteraturArtikel({ wiki_key: "weg", wiki_url: "https://x/y", title: "Rest" }, null);
assert.ok(WAISE !== null);
assert.strictEqual(WAISE.name, "Rest");
assert.strictEqual(WAISE.werte.edition, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 5) DER ZUSTAND ────────────────────────────────────────────────────────────────────────────
// 💣 WIRFT, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
assert.throws(() => avesmapsWikiAssignLiteraturZustand(null), /kein Eintrag/);
assert.throws(() => avesmapsWikiAssignLiteraturZustand([]), /kein Eintrag/);
zaehl(); zaehl();

let getippterTitel = "Madas Kelch (Karte)";
const ZUSTAND = avesmapsWikiAssignLiteraturZustand({
	public_id: "A-KELCH", wiki_key: "madas-kelch", wiki_url: KATALOG_KELCH.wiki_url,
	kandidat: KATALOG_KELCH, field_origins: { genre: "manual" },
	title: () => getippterTitel, product_type: "gruppenabenteuer", edition: "", genre: "Krimi",
	complexity_gm: "", complexity_pl: "", authors: "", series: "", fshop_code: "", isbn: "",
});
assert.strictEqual(ZUSTAND.keinArtikel, false, "die Literatur kann den dritten Zustand nicht tragen");
assert.deepStrictEqual(ZUSTAND.handgesetzt, ["genre"]);
// 💣 LESEFUNKTIONEN, NICHT WERTE: `laden` läuft EINMAL, die Vorschau entsteht erst beim Druck auf
// „Sync" -- dazwischen kann getippt worden sein.
getippterTitel = "Ganz anders";
assert.strictEqual(ZUSTAND.kartenwerte.title, "Ganz anders",
	"die Kartenwerte wurden beim Laden eingefroren -- die Vorschau verglichen gegen einen alten Stand");
zaehl(); zaehl(); zaehl();

// ── 6) DIE GEGENPROBE ZUM FELDREGISTER ────────────────────────────────────────────────────────
const REGISTER_ZIELE = AVESMAPS_WIKI_ASSIGN_REGISTRY.literatur.felder
	.map((feld) => feld.karte).filter((karte) => karte !== "");
assert.deepStrictEqual(REGISTER_ZIELE.slice().sort(), AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER.slice().sort(),
	"Feldregister und Kartenfeld-Liste weichen voneinander ab");
zaehl();

// ── 7) 🔴 DIE VORSCHAU: HANDGESETZT STEHT DRIN, IST ABER NICHT GEHAKT ─────────────────────────
const ZEILEN = avesmapsWikiAssignDiff(
	AVESMAPS_WIKI_ASSIGN_REGISTRY.literatur.felder,
	// Karte: Titel weicht ab, Genre weicht ab (und ist handgesetzt), Regelsystem ist LEER (eine
	// Lücke -> vorangehakt), der Produkttyp stimmt bereits überein (fällt heraus).
	{ title: "Madas Kelch (Karte)", product_type: "gruppenabenteuer", edition: "", genre: "Krimi",
		complexity_gm: "mittel", complexity_pl: "mittel", authors: "Anton Weste",
		series: "Splitterdämmerung", fshop_code: "US25001", isbn: "978-3-95752-000-0" },
	WERTE,
	["genre"]
);
assert.deepStrictEqual(ZEILEN.map((z) => z.karte), ["title", "edition", "genre"],
	"die Vorschau zeigt andere Zeilen als erwartet: " + JSON.stringify(ZEILEN.map((z) => z.karte)));
// Die LÜCKE ist vorangehakt.
assert.strictEqual(ZEILEN.filter((z) => z.karte === "edition")[0].gehakt, true);
// Ein GEFÜLLTER Kartenwert nicht (Owner-Entscheid 16.08.2026).
assert.strictEqual(ZEILEN.filter((z) => z.karte === "title")[0].gehakt, false);
// 🔴 UND DIE HANDGESETZTE ZEILE NENNT IHREN EIGENEN GRUND -- nicht den allgemeinen.
const genreZeile = ZEILEN.filter((z) => z.karte === "genre")[0];
assert.strictEqual(genreZeile.gehakt, false);
assert.ok(/von Hand gesetzt/.test(genreZeile.grund),
	"die handgesetzte Zeile nennt den allgemeinen Grund statt ihres eigenen: " + genreZeile.grund);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 8) DIE SYNC-WERTE ─────────────────────────────────────────────────────────────────────────
const SYNC = avesmapsWikiAssignLiteraturSyncWerte(ZEILEN.filter((z) => z.gehakt));
assert.strictEqual(SYNC.edition, "DSA4.1");
assert.strictEqual(SYNC.title, null, "eine NICHT angehakte Zeile wurde trotzdem uebernommen");
assert.strictEqual(avesmapsWikiAssignLiteraturSyncLeer(SYNC), false);
assert.strictEqual(avesmapsWikiAssignLiteraturSyncLeer(avesmapsWikiAssignLiteraturSyncWerte([])), true);
// 💣 Eine Zeile, deren Kartenziel gar nicht in der Liste steht, wird verworfen statt durchgereicht.
assert.strictEqual(
	avesmapsWikiAssignLiteraturSyncWerte([{ karte: "gibtesnicht", neu: "x" }]).gibtesnicht,
	undefined
);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 2: DAS DOKUMENT ══════════════════════════════════════════════════════════════════════

const editorQuelle = fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8");

// ── 9) DIE SKRIPTLISTE STEHT IM DOKUMENT, IN DER RICHTIGEN REIHENFOLGE ────────────────────────
// 💣 Sonst prüft der Sandkasten nur sich selbst: eine im Dokument VERGESSENE `<script>`-Zeile bliebe
// unsichtbar, und live gäbe `mount` einen Blindgänger.
const skripte = (editorQuelle.match(/<script[^>]+src="([^"]+)"/g) || [])
	.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
	.map((src) => src.replace(/^\//, "").split("?")[0]);
["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
	"js/ui/wiki-assign-literatur.js"].forEach((datei) => {
	assert.ok(skripte.indexOf(datei) !== -1, EDITOR_HTML + " bindet " + datei + " nicht: " + skripte.join(" "));
	assert.ok(fs.existsSync(path.join(wurzel, datei)), datei + " ist gebunden, existiert aber nicht");
});
assert.ok(skripte.indexOf("js/ui/wiki-assign-registry.js") < skripte.indexOf("js/ui/wiki-assign.js"),
	"das Feldregister steht NACH dem Bauteil: " + skripte.join(" "));
assert.ok(skripte.indexOf("js/ui/wiki-assign-diff.js") < skripte.indexOf("js/ui/wiki-assign.js"),
	"die Diff-Rechnung steht NACH dem Bauteil: " + skripte.join(" "));
assert.ok(skripte.indexOf("js/ui/wiki-assign.js") < skripte.indexOf("js/ui/wiki-assign-literatur.js"),
	"das Bauteil steht NACH dem Datenweg: " + skripte.join(" "));
zaehl(); zaehl(); zaehl();

// ── 10) 🔴 DAS FREIE TEXTFELD IST WEG -- UND DIE ZWEI ANDEREN SIND GEBLIEBEN ──────────────────
// 💣 Gezählt am Dokument, nicht am Gedächtnis: `gatherStamm` sammelt ALLE `[data-field]`, und solange
// ein `data-field="wiki_url"` darin steht, lässt sich die Adresse weiter tippen -- der ganze Zweck
// des Umbaus wäre dahin (Entwurf §5).
assert.ok(!/data-field="wiki_url"/.test(editorQuelle) && !/"Wiki-URL", "wiki_url"/.test(editorQuelle),
	"das freie Adressfeld „Wiki-URL“ steht noch im Dokument");
// ⚠️ F-Shop-Code und Cover-URL sind KEINE Wiki-Zuweisung und bleiben Textfelder (Brief Schritt 3).
assert.ok(/"F-Shop-Code", "fshop_code"/.test(editorQuelle), "das Feld „F-Shop-Code“ ist verschwunden");
assert.ok(/"Cover-URL", "cover_url"/.test(editorQuelle), "das Feld „Cover-URL“ ist verschwunden");
// Und der Behälter des Bauteils steht da.
assert.ok(/id="aeWikiAssign"/.test(editorQuelle), "der Behaelter der Wiki-Zuweisung fehlt");
zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 3: DIE ECHTE OBERFLÄCHE IM SANDKASTEN ════════════════════════════════════════════════
// 🔴 Sie steht INLINE im Dokument, also wird genau dieser Block herausgeschnitten und ausgeführt --
// nicht nachgebaut. Nachgebaut geprüft hieße: die Probe prüft die Probe.

function scheinFeld(wert) {
	return {
		value: wert === undefined ? "" : wert,
		checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "", className: "",
		dataset: {}, style: {}, options: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
		replaceChildren() {}, append() {}, insertBefore() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, select() {}, click() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

function scheinBehaelter(id) {
	const zuhoerer = {};
	const element = Object.assign(scheinFeld(""), {
		id: id || "host",
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		contains() { return true; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
		hatZuhoerer(typ) { return typeof zuhoerer[typ] === "function"; },
	});
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

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

/** Die Häkchenzeilen aus dem gezeichneten Kasten -- Beschriftung, gesperrt?, gehakt?, Grund. */
function syncZeilenAus(innerHTML) {
	return String(innerHTML).split("</label>").slice(0, -1).map((stueck) => {
		const name = (/dt-sync-row__k[^>]*>([^<]*)</.exec(stueck) || [])[1] || "";
		const grund = (/dt-sync-row__grund[^>]*>([^<]*)</.exec(stueck) || [])[1] || "";
		return { label: name, gesperrt: / disabled/.test(stueck), gehakt: / checked/.test(stueck), grund: grund };
	}).filter((zeile) => zeile.label !== "");
}

// Der EINE inline-Block der Seite -- der letzte `<script>` ohne `src`.
function oberflaechenQuelle() {
	const bloecke = editorQuelle.match(/<script>([\s\S]*?)<\/script>/g) || [];
	assert.ok(bloecke.length > 0, "in " + EDITOR_HTML + " steht kein inline-Skriptblock");
	const groesster = bloecke.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, ""))
		.sort((a, b) => b.length - a.length)[0];
	assert.ok(groesster.indexOf("function mountAeWikiAssign") !== -1,
		"der herausgeschnittene Block ist nicht der der Oberflaeche");
	return groesster;
}

const DETAIL = {
	public_id: "A-KELCH",
	wiki_key: "madas-kelch",
	wiki_url: KATALOG_KELCH.wiki_url,
	title: "Madas Kelch (Karte)",
	product_type: "gruppenabenteuer",
	edition: "",
	genre: "Krimi",
	complexity_gm: "mittel", complexity_pl: "mittel",
	authors: "Anton Weste", series: "Splitterdämmerung", fshop_code: "US25001",
	isbn: "978-3-95752-000-0", cover_url: "", bf_year: null, bf_label: "", is_official: true,
	link_ulisses: "", link_fshop: "", contained_in: "",
	field_origins: { genre: "manual" },
	origin: "manual", status: "approved", places: [], extra_links: [],
};

/**
 * Baut den Sandkasten samt DOM-Attrappe. Die FORMULARFELDER sind echt genug: `renderDetail` setzt
 * nur `innerHTML` auf einer Attrappe, also entstehen sie dort nicht -- sie werden hier angelegt, und
 * `document.querySelector('#aeStammBody [data-field="X"]')` findet genau sie.
 */
function sandkastenBauen(optionen) {
	const opt = optionen || {};
	const felder = {};
	AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER.concat(["cover_url", "bf_year", "bf_label"])
		.forEach((name) => {
			felder[name] = scheinFeld(DETAIL[name] === null || DETAIL[name] === undefined ? "" : String(DETAIL[name]));
			felder[name].dataset = { field: name };
		});
	const elemente = {};
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (id === "aeWikiAssign") {
				elemente[id] = elemente[id] || scheinBehaelter(id);
				return elemente[id];
			}
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector(selektor) {
			const treffer = /\[data-field="([^"]+)"\]/.exec(String(selektor || ""));
			if (treffer && felder[treffer[1]]) { return felder[treffer[1]]; }
			return null;
		},
		querySelectorAll(selektor) {
			if (/\[data-field\]/.test(String(selektor || ""))) { return Object.values(felder); }
			return [];
		},
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
		location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" },
		confirm: () => true,
		// Der Block hängt am Ende einen `message`-Zuhörer an (die Vorauswahl aus dem Elternfenster).
		addEventListener() {},
		removeEventListener() {},
		parent: null,
		fetch(url, init) {
			const adresse = String(url);
			let rumpf = null;
			try { rumpf = init && init.body ? JSON.parse(init.body) : null; } catch (fehler) { rumpf = null; }
			gesendet.push({ url: adresse, aktion: (rumpf && rumpf.action) || "", rumpf: rumpf });
			const antwort = opt.antwort ? opt.antwort(adresse, rumpf) : null;
			if (antwort && antwort.wirf) { return Promise.reject(new Error("Netz")); }
			const nutzlast = antwort || { ok: true };
			return Promise.resolve({
				ok: nutzlast.httpOk !== false,
				status: nutzlast.status || 200,
				json: () => Promise.resolve(nutzlast),
			});
		},
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	kasten.self = kasten;
	vm.createContext(kasten);
	["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-literatur.js"].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext(oberflaechenQuelle(), kasten, { filename: EDITOR_HTML });
	return { kasten: kasten, elemente: elemente, felder: felder, gesendet: gesendet };
}

/** Die Standard-Antworten: Detail, Katalogsatz, Suchtreffer -- alles andere ist ein leeres ok. */
function standardAntwort(adresse, rumpf) {
	if (/game-literature\.php\?action=entry/.test(adresse)) {
		return { ok: true, count: 1, rows: [KATALOG_KELCH] };
	}
	if (/game-literature\.php\?action=search/.test(adresse)) {
		return { ok: true, count: 3, rows: [KATALOG_FREI, KATALOG_FREMD, KATALOG_KELCH] };
	}
	if (rumpf && rumpf.action === "detail") { return Object.assign({ ok: true }, DETAIL); }
	if (rumpf && rumpf.action === "list") { return { ok: true, adventures: [] }; }
	if (rumpf && rumpf.action === "upsert_adventure") { return { ok: true, public_id: "A-KELCH" }; }
	return { ok: true };
}

(async () => {
	// ── A) DER KASTEN STEHT UND ZEIGT DIE GESPEICHERTE ZUWEISUNG ─────────────────────────────
	const s = sandkastenBauen({ antwort: standardAntwort });
	await vm.runInContext('selectGameLiterature("A-KELCH")', s.kasten);
	await ruhe();
	const host = s.elemente["aeWikiAssign"];
	assert.ok(host && host.hatZuhoerer("click"), "das Bauteil wurde gar nicht angehaengt");
	assert.ok(/Madas Kelch/.test(host.innerHTML), "der Kasten zeigt den zugewiesenen Artikel nicht: " + host.innerHTML);
	// 💣 DER KATALOGSATZ WURDE GEHOLT. Ohne ihn stünden im Kasten nur Adresse und Schlüssel -- und die
	// Sync-Vorschau verglichen die Karte mit sich selbst.
	assert.ok(s.gesendet.some((a) => /action=entry&wiki_key=madas-kelch/.test(a.url)),
		"der Katalogsatz wurde nie geholt: " + s.gesendet.map((a) => a.url).join(" | "));
	// Und die Angaben aus dem PUBLIKATIONS-Katalog kommen im Kasten an (der LEFT JOIN wirkt bis hier).
	assert.ok(/Ulisses Spiele/.test(host.innerHTML), "der Verlag erreicht den Kasten nicht");
	assert.ok(/978-3-95752-000-0/.test(host.innerHTML), "die ISBN erreicht den Kasten nicht");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── A2) 🔴 DIE VORSCHAU LIEST DAS FORMULAR JETZT, NICHT BEIM LADEN ───────────────────────
	// 💣 SIE FEHLTE IM ERSTEN ANLAUF, UND DIE MUTATION „Lesefunktion -> eingefrorener Wert" LIEF
	// GRUEN DURCH: solange sich zwischen `laden` und dem Klick auf „Sync" kein Feld ändert, ist ein
	// eingefrorener Stand von einem frischen nicht zu unterscheiden. Also wird hier GETIPPT --
	// „Regelsystem" war beim Laden LEER (eine Lücke, vorangehakt) und trägt jetzt einen Wert, also
	// muss dieselbe Zeile ungehakt sein und den Grund „auf der Karte steht bereits ein Wert" nennen.
	s.felder.edition.value = "DSA5";
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	const gedriftet = syncZeilenAus(host.innerHTML).filter((z) => z.label === "Regelsystem")[0];
	assert.ok(gedriftet, "die Zeile „Regelsystem“ fehlt in der Vorschau");
	assert.strictEqual(gedriftet.gehakt, false,
		"die Vorschau haelt „Regelsystem“ fuer leer -- sie vergleicht gegen den Stand von vor dem Tippen");
	assert.ok(/bereits ein Wert/.test(gedriftet.grund),
		"die Vorschau nennt nicht den Grund eines gefuellten Kartenwerts: " + gedriftet.grund);
	host.feuere("click", scheinZiel("data-wa-aktion", "abbrechen"));
	s.felder.edition.value = "";
	zaehl(); zaehl(); zaehl();

	// ── B) 🔴 DIE VORSCHAU IM ABLAUF: LÜCKE GEHAKT, HANDGESETZT NICHT ────────────────────────
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	const vorschau = syncZeilenAus(host.innerHTML);
	assert.deepStrictEqual(vorschau.map((z) => z.label), ["Titel", "Regelsystem", "Genre"],
		"die Vorschau zeigt andere Zeilen als erwartet: " + JSON.stringify(vorschau));
	assert.strictEqual(vorschau.filter((z) => z.label === "Regelsystem")[0].gehakt, true,
		"die LUECKE „Regelsystem“ ist nicht vorangehakt");
	assert.strictEqual(vorschau.filter((z) => z.label === "Titel")[0].gehakt, false,
		"ein gefuellter Kartenwert startet gehakt");
	// 🔴 DIE FELDHERKUNFT WIRKT BIS IN DEN GEZEICHNETEN KASTEN -- nicht nur in der reinen Rechnung.
	const genreGezeichnet = vorschau.filter((z) => z.label === "Genre")[0];
	assert.strictEqual(genreGezeichnet.gehakt, false, "die handgesetzte Zeile ist vorangehakt");
	assert.ok(/von Hand gesetzt/.test(genreGezeichnet.grund),
		"die handgesetzte Zeile nennt ihren Grund nicht: " + genreGezeichnet.grund);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── C) ÜBERNEHMEN SCHREIBT INS FORMULAR, NICHT IN DIE DATENBANK ──────────────────────────
	s.gesendet.length = 0;
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-alle"));
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(s.felder.edition.value, "DSA4.1", "die Uebernahme hat das Regelsystem nicht gesetzt");
	assert.strictEqual(s.felder.title.value, "Madas Kelch", "die Uebernahme hat den Titel nicht gesetzt");
	// ⚠️ „Alle anhaken" nimmt auch die handgesetzte Zeile mit -- sie ist nicht GESPERRT, nur nicht
	// vorangehakt. Gesperrt ist beim Territorium die Eltern-Zeile, hier gibt es keine.
	assert.strictEqual(s.felder.genre.value, "Mystik", "„Alle anhaken“ hat die handgesetzte Zeile ausgelassen");
	assert.deepStrictEqual(s.gesendet.filter((a) => a.aktion === "upsert_adventure"), [],
		"die Uebernahme hat gespeichert -- sie soll nur das Formular fuellen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ── D) 🔴 DAS SPEICHERN TRÄGT `wiki_url` UND `wiki_key` ──────────────────────────────────
	// 💣 DIE ZENTRALE ZUSICHERUNG DES UMBAUS. `gatherStamm` liest nur `[data-field]`, und das
	// Adressfeld gibt es nicht mehr -- ohne die zwei Zeilen in saveStammdaten wäre die Zuweisung
	// nach dem Umbau überhaupt nicht mehr speicherbar.
	s.gesendet.length = 0;
	await vm.runInContext("saveStammdaten()", s.kasten);
	await ruhe();
	const gespeichert = s.gesendet.filter((a) => a.aktion === "upsert_adventure")[0];
	assert.ok(gespeichert, "das Speichern hat nichts geschickt: " + JSON.stringify(s.gesendet));
	assert.strictEqual(gespeichert.rumpf.adventure.wiki_url, KATALOG_KELCH.wiki_url,
		"die Adresse reist beim Speichern nicht mit");
	// 🔴 UND DER SCHLÜSSEL -- er ist neu, und er ist der, über den der Massenabgleich das Werk
	// wiederfindet (avesmapsGameLiteratureFindOrAdoptRow).
	assert.strictEqual(gespeichert.rumpf.adventure.wiki_key, "madas-kelch",
		"der wiki_key reist beim Speichern nicht mit -- der Massenabgleich findet das Werk dann nur ueber seinen exakten Titel");
	zaehl(); zaehl(); zaehl();

	// ── E) ZUWEISEN UND ENTFERNEN IM ABLAUF ──────────────────────────────────────────────────
	host.feuere("click", scheinZiel("data-wa-aktion", "aendern"));
	await ruhe();
	assert.ok(/Der Götzenpfad/.test(host.innerHTML), "die Trefferliste kommt nicht im Kasten an: " + host.innerHTML);
	// 🔴 DIE WARNUNG STEHT IM TREFFER, VOR DEM KLICK.
	assert.ok(/hängt schon an/.test(host.innerHTML) && /Die 7 Gezeichneten/.test(host.innerHTML),
		"die Belegt-Warnung erreicht die Trefferliste nicht: " + host.innerHTML);
	// ⚠️ Und der EIGENE Artikel trägt sie nicht -- sonst warnte der Kasten vor der Zuweisung, die
	// gerade dasteht. („Madas Kelch“ ist in der Fixture von A-KELCH selbst belegt.)
	const kelchStueck = host.innerHTML.split('data-wa-treffer=').filter((s2) => /Madas Kelch/.test(s2))[0] || "";
	assert.ok(!/hängt schon an/.test(kelchStueck),
		"der eigene Artikel wird als fremdbelegt gemeldet: " + kelchStueck);
	zaehl(); zaehl(); zaehl();

	// Einen FREMDEN Artikel wählen -> er steht im Kasten und im Schreibwert.
	s.gesendet.length = 0;
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.ok(/Der Götzenpfad/.test(host.innerHTML), "die Zuweisung wurde nicht uebernommen");
	await vm.runInContext("saveStammdaten()", s.kasten);
	await ruhe();
	const nachWahl = s.gesendet.filter((a) => a.aktion === "upsert_adventure")[0];
	assert.strictEqual(nachWahl.rumpf.adventure.wiki_key, "der-goetzenpfad");
	assert.strictEqual(nachWahl.rumpf.adventure.wiki_url, KATALOG_FREI.wiki_url);
	zaehl(); zaehl(); zaehl();

	// „Entfernen" -> beide Werte werden LEER geschickt, nicht weggelassen.
	s.gesendet.length = 0;
	host.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.ok(/— keine —/.test(host.innerHTML), "„Entfernen“ hat den Kasten nicht geleert: " + host.innerHTML);
	await vm.runInContext("saveStammdaten()", s.kasten);
	await ruhe();
	const nachLoesen = s.gesendet.filter((a) => a.aktion === "upsert_adventure")[0];
	assert.strictEqual(nachLoesen.rumpf.adventure.wiki_url, "",
		"nach „Entfernen“ reist die alte Adresse weiter mit");
	assert.strictEqual(nachLoesen.rumpf.adventure.wiki_key, "",
		"nach „Entfernen“ reist der alte Schluessel weiter mit");
	zaehl(); zaehl(); zaehl();

	// ── F) 🔴 `laden` LEHNT AB, WENN DER KATALOGSATZ NICHT KOMMT ─────────────────────────────
	// KEINE Textprobe: der Rückruf wird WIRKLICH gefahren. Ein `laden`, das im Fehlerfall auflöst,
	// malte den offenen Zustand -- und das nächste „Speichern" schickte `wiki_url: ""`.
	const kaputt = sandkastenBauen({
		antwort: (adresse, rumpf) => (/action=entry/.test(adresse)
			? { httpOk: false, status: 500, ok: false }
			: standardAntwort(adresse, rumpf)),
	});
	await vm.runInContext('selectGameLiterature("A-KELCH")', kaputt.kasten);
	await ruhe();
	const kaputtHost = kaputt.elemente["aeWikiAssign"];
	assert.ok(/nicht gelesen werden/.test(kaputtHost.textContent + kaputtHost.innerHTML),
		"der Kasten sagt nicht, dass der Stand nicht gelesen werden konnte: "
		+ kaputtHost.textContent + kaputtHost.innerHTML);
	// Und der Riegel WIRKT, nicht nur die Anzeige.
	const steuerung = vm.runInContext("aeWikiAssign", kaputt.kasten);
	assert.strictEqual(steuerung.bereit, false, "ein gescheitertes `laden` laesst `bereit` auf true");
	assert.strictEqual(steuerung.lies(), null, "`lies()` liefert nach einem Fehlschlag einen Schreibwert");
	zaehl(); zaehl(); zaehl();

	// 💣 UND DER RÜCKFALL IST DER GELADENE STAND, NICHT DER LEERE. Genau hier hätte ein „Speichern"
	// die Zuweisung stumm gelöscht -- die Fehlerklasse aus AGENTS.md §10.
	kaputt.gesendet.length = 0;
	await vm.runInContext("saveStammdaten()", kaputt.kasten);
	await ruhe();
	const trotzFehler = kaputt.gesendet.filter((a) => a.aktion === "upsert_adventure")[0];
	assert.ok(trotzFehler, "das Speichern hat nach dem Fehlschlag gar nichts geschickt");
	assert.strictEqual(trotzFehler.rumpf.adventure.wiki_url, KATALOG_KELCH.wiki_url,
		"nach einem gescheiterten Ladelauf wird die Zuweisung stumm geloescht");
	assert.strictEqual(trotzFehler.rumpf.adventure.wiki_key, "madas-kelch",
		"nach einem gescheiterten Ladelauf wird der Schluessel stumm geloescht");
	zaehl(); zaehl(); zaehl();

	// ── G) EIN NEUER EINTRAG: OFFENER ZUSTAND, KEIN KATALOGABRUF ─────────────────────────────
	const frisch = sandkastenBauen({ antwort: standardAntwort });
	frisch.gesendet.length = 0;
	vm.runInContext("newGameLiterature()", frisch.kasten);
	await ruhe();
	const frischHost = frisch.elemente["aeWikiAssign"];
	assert.ok(/— keine —/.test(frischHost.innerHTML),
		"ein neuer Eintrag zeigt den offenen Zustand nicht: " + frischHost.innerHTML);
	// ⚠️ Ohne Schlüssel wird gar nicht erst nachgefragt.
	assert.ok(!frisch.gesendet.some((a) => /action=entry/.test(a.url)),
		"fuer einen neuen Eintrag wurde ein Katalogsatz geholt");
	zaehl(); zaehl();

	// ── H) 🔴 KEIN DRITTER ZUSTAND -- IM GEZEICHNETEN KASTEN, NICHT NUR IM REGISTER ──────────
	assert.strictEqual(avesmapsWikiAssignSubject("literatur").extra.keinArtikelHaken, false,
		"die Erklaerung bietet den dritten Zustand an");
	assert.ok(!/data-wa-kein-artikel/.test(frischHost.innerHTML),
		"das Haekchen „Kein Wiki-Artikel vorhanden“ steht im Kasten, obwohl die Literatur es nicht tragen kann");
	zaehl(); zaehl();

	console.log("wiki-assign-literatur: " + checks + " Zusicherungen erfuellt");
})();
