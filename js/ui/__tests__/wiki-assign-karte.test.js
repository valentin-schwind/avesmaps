// Die KARTE (Stadtplan) als Objektart (Aufgabe 9, Entwurf §8) -- die letzte der Reihe.
//
// 🔴 Was hier festgenagelt wird, und jedes davon ist gemessen, nicht vermutet:
//   1. 💣 DREI DINGE HEISSEN „wiki", UND DIE ZUWEISUNG IST DAS DRITTE. `citymap.wiki_key` ist ein
//      BAUSCHLÜSSEL (`index:stadt:quelle:variante`), `citymap.map_url` zeigt auf die PUBLIKATION.
//      Der eigene Artikel heißt `article_url`/`article_key`/`article_title` — und die Probe zählt
//      am Dokument nach, dass die Zuweisung KEINEN der beiden alten Namen benutzt.
//   2. `laden` LEHNT AB, wenn der Registry-Satz nicht zu holen war. Diese Oberfläche schreibt erst
//      beim „Speichern"; ein aufgelöstes Leeres löschte die Zuweisung.
//   3. DIE ZUWEISUNG REIST BEIM SPEICHERN MIT — und beim Fehlschlag reisen die Schlüssel GAR NICHT
//      mit, statt einen alten Stand zurückzuschicken.
//   4. 🔴 DER DRITTE ZUSTAND, hier Owner-Wunsch („gibt natürlich auch welche von uns"). Er reist nur
//      mit, wenn das Häkchen SEIT DEM LADEN umgelegt wurde — BEIDE Richtungen, je eigene Fixture.
//   5. KEIN Sync-Knopf: die Erklärung `karte` hat kein einziges Kartenziel.
//   6. KEIN `haengtAn`: der Suchendpunkt liest die Wiki-Registry, nicht `citymap` — er kann gar
//      nicht wissen, ob eine Karte den Artikel schon beansprucht.
//
// ⭐ Die Lehre aus den Aufgaben 3-8 steht über allem: eine Textprobe misst die FORM des Codes, nicht
// sein Verhalten. Ab Teil 3 läuft die ECHTE Oberfläche in einem vm-Sandkasten — und weil sie inline
// in html/citymap-editor.html steht, wird genau dieser Block herausgeschnitten und ausgeführt.
// Geklickt wird über die Zuhörer, die `mount` selbst angehängt hat.
//
// Run: node js/ui/__tests__/wiki-assign-karte.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	avesmapsWikiAssignKarteWerte,
	avesmapsWikiAssignKarteTreffer,
	avesmapsWikiAssignKarteArtikel,
	avesmapsWikiAssignKarteZustand,
} = require("../wiki-assign-karte.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prüft BEIDE.
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/citymap-editor.html";
let checks = 0;
function zaehl() { checks++; }

// ── Die Fixture: eine Zeile, wie sie der Suchendpunkt liefert ─────────────────────────────────
// 🔴 Die Schlüssel sind die von avesmapsWikiCitymapArticleSearch (api/_internal/wiki/citymap-sync.php)
// -- `settlement_label` und `continent` sind die Spaltennamen von `wiki_sync_pages`, nicht hübschere.
const SEITE_GARETH = {
	name: "Gareth",
	title: "Gareth",
	wiki_key: "gareth",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Gareth",
	settlement_label: "Metropole",
	continent: "Aventurien",
};
const SEITE_TOR = {
	name: "Gareths Tor",
	title: "Gareths Tor",
	wiki_key: "gareths-tor",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Gareths_Tor",
	settlement_label: "Gebäude",
	continent: "Aventurien",
};

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DIE WERTE ──────────────────────────────────────────────────────────────────────────────
const WERTE = avesmapsWikiAssignKarteWerte(SEITE_GARETH);
assert.strictEqual(WERTE.settlement_label, "Metropole");
assert.strictEqual(WERTE.continent, "Aventurien");
zaehl(); zaehl();

// ⚠️ Eine Registry-Zeile ohne Kontinent (Altbestand vor der nachgezogenen Spalte) darf nichts brechen.
const WERTE_OHNE = avesmapsWikiAssignKarteWerte({ name: "X" });
assert.strictEqual(WERTE_OHNE.continent, "");
assert.strictEqual(WERTE_OHNE.settlement_label, "");
zaehl(); zaehl();

// 🔴 JEDES Wiki-Feld der Erklärung hat einen Wert -- sonst fällt eine Zeile im Kasten stumm weg.
avesmapsWikiAssignSubject("karte").felder.forEach((feld) => {
	assert.ok(Object.prototype.hasOwnProperty.call(WERTE, feld.wiki),
		'die Erklaerung nennt das Wiki-Feld "' + feld.wiki + '", der Datenweg liefert es nicht');
});
zaehl();

// ── 2) DER TREFFER ────────────────────────────────────────────────────────────────────────────
const TREFFER = avesmapsWikiAssignKarteTreffer(SEITE_GARETH);
assert.strictEqual(TREFFER.name, "Gareth");
assert.strictEqual(TREFFER.wiki_key, "gareth");
assert.strictEqual(TREFFER.werte.settlement_label, "Metropole");
// 🔴 KEIN `haengtAn` -- der Suchendpunkt liest die Wiki-Registry, nicht `citymap`. Eine erfundene
// Belegt-Anzeige wäre schlimmer als keine (Kopf von js/ui/wiki-assign.js).
assert.strictEqual(TREFFER.haengtAn, undefined,
	"der Datenweg erfindet eine Belegt-Warnung, die kein Endpunkt liefert");
// ⚠️ Fehlt `name`, zieht `title` nach: der `entry`-Arm und die Suche liefern beide, ein künftiger
// dritter Aufrufer vielleicht nur einen.
assert.strictEqual(avesmapsWikiAssignKarteTreffer({ title: "Nur Titel" }).name, "Nur Titel");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) DER ARTIKEL ────────────────────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignKarteArtikel({}, null), null,
	"ohne Adresse und Schluessel ist NICHTS zugewiesen -- das ist ein gueltiger Zustand");
// 💣 UND DIE ALTEN NAMEN ZAEHLEN NICHT. Eine Karte trägt IMMER einen `wiki_key` (den Bauschlüssel)
// und fast immer eine `map_url` (die Publikation) -- läse der Datenweg die, gälte jede Wiki-Karte
// als zugewiesen, ohne dass je ein Editor einen Artikel gewählt hätte.
assert.strictEqual(
	avesmapsWikiAssignKarteArtikel({
		wiki_key: "stadtplan:gareth:der-fluch-des-hexers:farbe",
		map_url: "https://de.wiki-aventurica.de/wiki/Der_Fluch_des_Hexers",
		wiki_url: "https://de.wiki-aventurica.de/wiki/Der_Fluch_des_Hexers",
	}, null),
	null,
	"der Bauschluessel oder die Publikation gelten als Artikel-Zuweisung");
const ARTIKEL = avesmapsWikiAssignKarteArtikel(
	{ article_url: SEITE_GARETH.wiki_url, article_key: "gareth", article_title: "Gareth" },
	SEITE_GARETH
);
assert.strictEqual(ARTIKEL.name, "Gareth");
assert.strictEqual(ARTIKEL.wiki_url, SEITE_GARETH.wiki_url);
assert.strictEqual(ARTIKEL.werte.settlement_label, "Metropole");
// ⚠️ Ein verwaister Titel (kein Registry-Satz mehr) ist kein Fehler -- Name, Adresse und Schlüssel
// stehen weiter da, die zwei Anzeige-Zeilen fallen weg.
const WAISE = avesmapsWikiAssignKarteArtikel(
	{ article_url: "https://w/x", article_key: "x", article_title: "Rest" }, null
);
assert.ok(WAISE !== null);
assert.strictEqual(WAISE.name, "Rest");
assert.strictEqual(WAISE.werte.continent, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 4) DER ZUSTAND ────────────────────────────────────────────────────────────────────────────
// 💣 WIRFT, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
assert.throws(() => avesmapsWikiAssignKarteZustand(null), /keine Karte/);
assert.throws(() => avesmapsWikiAssignKarteZustand([]), /keine Karte/);
zaehl(); zaehl();

const ZUSTAND = avesmapsWikiAssignKarteZustand({
	article_url: SEITE_GARETH.wiki_url, article_key: "gareth", article_title: "Gareth",
	no_article: false, kandidat: SEITE_GARETH,
});
assert.strictEqual(ZUSTAND.artikel.name, "Gareth");
assert.strictEqual(ZUSTAND.keinArtikel, false);
// 🔴 DER DRITTE ZUSTAND WIRD GETRAGEN -- anders als bei Territorium und Literatur.
assert.strictEqual(avesmapsWikiAssignKarteZustand({ no_article: true }).keinArtikel, true);
// ⚠️ Und NUR ein echtes `true` -- das ist eine KOPPLUNG an den Leseweg, keine Pedanterie:
// avesmapsCitymapDetailForEdit gibt `(int) … === 1` heraus, also einen echten Wahrheitswert, und das
// Bauteil prüft seinerseits `=== true` (js/ui/wiki-assign.js). Ein nachgiebiges `!!` hier machte aus
// der Zeichenkette `"0"` ein gesetztes Häkchen; ein Leseweg, der plötzlich `1` liefert, fällt dafür
// hier auf und nicht erst daran, dass der Merker im Kasten stumm verschwindet.
// 💣 Die Zahl 1 gehört zu dieser Zusicherung dazu: mit nur der 0 blieb die Mutation „=== true" ->
// „!!" grün (gemessen 16.08.2026), weil beide Formen für 0 dasselbe sagen.
assert.strictEqual(avesmapsWikiAssignKarteZustand({ no_article: 0 }).keinArtikel, false);
assert.strictEqual(avesmapsWikiAssignKarteZustand({ no_article: 1 }).keinArtikel, false,
	"eine Zahl gilt als gesetzter Merker -- der Leseweg liefert einen Wahrheitswert, und nur der zaehlt");
assert.strictEqual(avesmapsWikiAssignKarteZustand({ no_article: "0" }).keinArtikel, false,
	"die Zeichenkette \"0\" gilt als gesetzter Merker");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 5) DIE GEGENPROBE ZUM FELDREGISTER ────────────────────────────────────────────────────────
// 🔴 KEIN Kartenziel, also KEIN Sync-Knopf. Die beiden hängen zusammen und werden hier gemeinsam
// festgenagelt: ein `sync: true` ohne Ziel zeigte einen Knopf, der nichts füllen kann.
const KARTE = AVESMAPS_WIKI_ASSIGN_REGISTRY.karte;
assert.deepStrictEqual(KARTE.felder.map((feld) => feld.karte), ["", ""],
	"die Erklaerung `karte` beansprucht ein Kartenfeld -- dann braucht sie auch einen Sync-Knopf");
assert.strictEqual(KARTE.sync, false, "die Erklaerung `karte` bietet einen Sync-Knopf ohne Ziel an");
// 🔴 KEIN Bedienelement für den dritten Zustand -- gefallen am 16.08.2026 (Owner-Entscheid nach dem
// Durchklicken: „passt, aber ‚Kein Wiki-Artikel vorhanden‘ brauchen wir nicht explizit"). Hier stand
// bis dahin `true` mit Entwurf §2.5 als Beleg; derselbe Owner, späterer Blick auf die gebaute
// Oberfläche. Die SPALTE `citymap.no_article` bleibt -- entschieden wird im Konfliktzentrum.
assert.strictEqual(KARTE.extra.keinArtikelHaken, false,
	"das Haekchen ist zurueck -- der Owner hat es am 16.08.2026 abgewaehlt, die Begruendung steht "
	+ "im Feldregister. Wer es wieder einbaut, braucht einen neuen Entscheid.");
zaehl(); zaehl(); zaehl();

// ══ TEIL 2: DAS DOKUMENT ══════════════════════════════════════════════════════════════════════

const editorQuelle = fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8");

// ── 6) DIE SKRIPTLISTE STEHT IM DOKUMENT, IN DER RICHTIGEN REIHENFOLGE ────────────────────────
// 💣 Sonst prüft der Sandkasten nur sich selbst: eine im Dokument VERGESSENE `<script>`-Zeile bliebe
// unsichtbar, und live gäbe `mount` einen Blindgänger.
const skripte = (editorQuelle.match(/<script[^>]+src="([^"]+)"/g) || [])
	.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
	.map((src) => src.replace(/^\//, "").split("?")[0]);
["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
	"js/ui/wiki-assign-karte.js"].forEach((datei) => {
	assert.ok(skripte.indexOf(datei) !== -1, EDITOR_HTML + " bindet " + datei + " nicht: " + skripte.join(" "));
	assert.ok(fs.existsSync(path.join(wurzel, datei)), datei + " ist gebunden, existiert aber nicht");
});
assert.ok(skripte.indexOf("js/ui/wiki-assign-registry.js") < skripte.indexOf("js/ui/wiki-assign.js"),
	"das Feldregister steht NACH dem Bauteil: " + skripte.join(" "));
assert.ok(skripte.indexOf("js/ui/wiki-assign-diff.js") < skripte.indexOf("js/ui/wiki-assign.js"),
	"die Diff-Rechnung steht NACH dem Bauteil: " + skripte.join(" "));
assert.ok(skripte.indexOf("js/ui/wiki-assign.js") < skripte.indexOf("js/ui/wiki-assign-karte.js"),
	"das Bauteil steht NACH dem Datenweg: " + skripte.join(" "));
// Und der Behälter des Bauteils steht da -- zweimal, denn eine NEUE Karte bekommt ihn auch.
assert.ok((editorQuelle.match(/id="ceWikiAssign"/g) || []).length === 2,
	"der Behaelter der Wiki-Zuweisung fehlt in einem der zwei Zweige von renderDetail");
zaehl(); zaehl(); zaehl(); zaehl();

// ── 7) 💣 KEIN FREITEXTFELD UND KEINE UMDEUTUNG DER ALTEN NAMEN ───────────────────────────────
// `gatherStamm` sammelt ALLE `[data-cm-field]` aus #ceStammBody ein. Stünde die Zuweisung dort, ließe
// sich die Adresse tippen (Entwurf §5) -- und ein `data-cm-field="wiki_url"` oder `"wiki_key"` würde
// obendrein den Bauschlüssel bzw. die Publikation überschreiben, an denen der Karten-Abgleich hängt.
["article_url", "article_key", "article_title", "wiki_url", "wiki_key", "no_article"].forEach((feld) => {
	assert.ok(editorQuelle.indexOf('data-cm-field="' + feld + '"') === -1,
		'die Karten-Oberflaeche traegt ein Formularfeld "' + feld + '" -- die Zuweisung gehoert in das Bauteil');
});
zaehl();

// ══ TEIL 3: DIE ECHTE OBERFLÄCHE IM SANDKASTEN ════════════════════════════════════════════════

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

// Der EINE inline-Block der Seite -- der größte `<script>` ohne `src` (der kleine oben setzt nur das
// Farbschema).
function oberflaechenQuelle() {
	const bloecke = editorQuelle.match(/<script>([\s\S]*?)<\/script>/g) || [];
	assert.ok(bloecke.length > 0, "in " + EDITOR_HTML + " steht kein inline-Skriptblock");
	const groesster = bloecke.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, ""))
		.sort((a, b) => b.length - a.length)[0];
	assert.ok(groesster.indexOf("function mountCeWikiAssign") !== -1,
		"der herausgeschnittene Block ist nicht der der Oberflaeche");
	return groesster;
}

// Die Antwort von `detail`, in genau der Form, die avesmapsCitymapDetailForEdit liefert.
function detailAntwort(ueberschreibungen) {
	return {
		ok: true,
		citymap: Object.assign({
			public_id: "C-GARETH",
			title: "Stadtplan von Gareth (Der Fluch des Hexers)",
			parent_public_id: "",
			map_url: "https://de.wiki-aventurica.de/wiki/Der_Fluch_des_Hexers",
			map_url_label: "", map_local_url: "", map_license: "unknown_other", map_license_note: "",
			thumb_url: "", thumb_local_url: "", thumb_auto_url: "", thumb_license: "unknown_other",
			thumb_license_note: "", thumb_origin: "manual", thumb_auto_state: "",
			art: "stadtplan", is_color: true, is_multilevel: null, is_labeled: null,
			is_official: true, is_spoiler: null, is_paid: null, has_scale: null,
			width_px: null, height_px: null, format: "", valid_from_bf: null, valid_to_bf: null,
			author: "", publisher: "Ulisses Spiele", note: "", status: "approved", origin: "wiki",
			// 🔴 DIE ZUWEISUNG -- und daneben, in derselben Zeile, der BAUSCHLÜSSEL und die
			// PUBLIKATION. Genau so kommt es live an, und genau deshalb steht es hier: ein Datenweg,
			// der die falsche Spalte liest, fällt an dieser Fixture auf.
			article_url: SEITE_GARETH.wiki_url,
			article_key: "gareth",
			article_title: "Gareth",
			no_article: false,
		}, ueberschreibungen || {}),
		types: ["stadtplan"], related: [], places: [], links: [], foreign_links: [],
	};
}

/**
 * Baut den Sandkasten samt DOM-Attrappe. Die FORMULARFELDER sind echt genug: `renderDetail` setzt
 * nur `innerHTML` auf einer Attrappe, also entstehen sie dort nicht -- sie werden hier angelegt, und
 * `document.querySelectorAll('#ceStammBody [data-cm-field]')` findet genau sie.
 */
function sandkastenBauen(optionen) {
	const opt = optionen || {};
	const felder = {};
	["title", "map_url", "author", "publisher", "note", "art", "format", "status"].forEach((name) => {
		felder[name] = scheinFeld(name === "title" ? "Stadtplan von Gareth (Der Fluch des Hexers)" : "");
		felder[name].getAttribute = (merkmal) => (merkmal === "data-cm-field" ? name : null);
	});
	const elemente = {};
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (id === "ceWikiAssign") {
				elemente[id] = elemente[id] || scheinBehaelter(id);
				return elemente[id];
			}
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return null; },
		querySelectorAll(selektor) {
			if (/\[data-cm-field\]/.test(String(selektor || ""))) { return Object.values(felder); }
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
		FormData: function () { this.append = function () {}; },
		document: dokument,
		location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" },
		confirm: () => true,
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
	// Der Lizenz-Katalog und sein Markup-Bauer (Phase 4, Aufgabe 2): ceImageGroup ruft seit
	// Aufgabe 2 avesmapsMediaLicenseNormalize/...IsPublic/...Label und
	// avesmapsMediaLicenseFieldsMarkup auf. Im Dokument stehen sie VOR dem inline-Block
	// (html/citymap-editor.html), also laden sie hier ebenso vor der Wiki-Zuweisung.
	["js/app/media-licenses.js", "js/ui/media-license-fields.js",
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-karte.js"].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext(oberflaechenQuelle(), kasten, { filename: EDITOR_HTML });
	return { kasten: kasten, elemente: elemente, felder: felder, gesendet: gesendet };
}

/** Die Standard-Antworten: Liste, Detail, Registry-Satz, Suchtreffer. */
function standardAntwort(detail) {
	return (adresse, rumpf) => {
		if (/wiki\/citymaps\.php\?action=entry/.test(adresse)) {
			return { ok: true, query: "Gareth", rows: [SEITE_GARETH] };
		}
		if (/wiki\/citymaps\.php\?action=search/.test(adresse)) {
			return { ok: true, query: "", rows: [SEITE_TOR, SEITE_GARETH] };
		}
		if (rumpf && rumpf.action === "detail") { return detail; }
		if (rumpf && rumpf.action === "list") { return { ok: true, citymaps: [], citymaps_enabled: true, citymap_previews_enabled: true }; }
		if (rumpf && rumpf.action === "upsert_citymap") { return { ok: true, public_id: "C-GARETH" }; }
		return { ok: true };
	};
}

(async () => {
	// ── A) DER KASTEN STEHT UND ZEIGT DIE GESPEICHERTE ZUWEISUNG ─────────────────────────────
	const s = sandkastenBauen({ antwort: standardAntwort(detailAntwort()) });
	await vm.runInContext('selectCitymap("C-GARETH")', s.kasten);
	await ruhe();
	const host = s.elemente["ceWikiAssign"];
	assert.ok(host && host.hatZuhoerer("click"), "das Bauteil wurde gar nicht angehaengt");
	assert.ok(/Gareth/.test(host.innerHTML), "der Kasten zeigt den zugewiesenen Artikel nicht: " + host.innerHTML);
	// 💣 DER REGISTRY-SATZ WURDE GEHOLT -- und zwar über den TITEL. Ohne ihn stünden im Kasten nur
	// Adresse und Schlüssel, und Seitenart wie Kontinent verschwänden beim nächsten Öffnen.
	assert.ok(s.gesendet.some((a) => /wiki\/citymaps\.php\?action=entry&title=Gareth/.test(a.url)),
		"der Registry-Satz wurde nie geholt: " + s.gesendet.map((a) => a.url).join(" | "));
	assert.ok(/Metropole/.test(host.innerHTML) && /Aventurien/.test(host.innerHTML),
		"Seitenart und Kontinent erreichen den Kasten nicht: " + host.innerHTML);
	// 🔴 KEIN Sync-Knopf: die Erklärung hat kein Kartenziel.
	assert.ok(!/data-wa-aktion="sync"/.test(host.innerHTML),
		"der Kasten zeigt einen Sync-Knopf, obwohl es kein Kartenziel gibt: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── B) 🔴 DAS SPEICHERN TRÄGT DIE DREI `article_*` -- UND KEINEN DER ALTEN NAMEN ─────────
	// 💣 DIE ZENTRALE ZUSICHERUNG DIESER AUFGABE. `gatherStamm` liest nur `[data-cm-field]`, und die
	// Zuweisung ist keins -- ohne die Zeilen in saveStamm wäre sie überhaupt nicht speicherbar. Und
	// stünde sie unter `wiki_url`/`wiki_key`, überschriebe sie den Bauschlüssel des Abgleichs.
	s.gesendet.length = 0;
	await vm.runInContext("saveStamm()", s.kasten);
	await ruhe();
	const gespeichert = s.gesendet.filter((a) => a.aktion === "upsert_citymap")[0];
	assert.ok(gespeichert, "das Speichern hat nichts geschickt: " + JSON.stringify(s.gesendet));
	assert.strictEqual(gespeichert.rumpf.citymap.article_url, SEITE_GARETH.wiki_url,
		"die Adresse des Artikels reist beim Speichern nicht mit");
	assert.strictEqual(gespeichert.rumpf.citymap.article_key, "gareth",
		"der Schluessel des Artikels reist beim Speichern nicht mit");
	assert.strictEqual(gespeichert.rumpf.citymap.article_title, "Gareth",
		"der Name des Artikels reist beim Speichern nicht mit");
	// 🔴 UND DIE ALTEN NAMEN BLEIBEN AUSSEN VOR. `wiki_key` ist der Bauschlüssel des Abgleichs,
	// `map_url` die Publikation -- beide würde `upsert_citymap` schreiben, stünden sie in der Nutzlast.
	assert.strictEqual(gespeichert.rumpf.citymap.wiki_key, undefined,
		"das Speichern schickt einen wiki_key -- das ist der BAUSCHLUESSEL des Abgleichs");
	assert.strictEqual(gespeichert.rumpf.citymap.wiki_url, undefined,
		"das Speichern schickt ein wiki_url -- diese Spalte gibt es gar nicht");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── C) 🔴 DER MERKER REIST GAR NICHT MEHR MIT ───────────────────────────────────────────
	// 💣 UNANGETASTET heißt WEGGELASSEN. `avesmapsUpsertCitymap` fasst nur mitgeschickte Felder an;
	// ein bedingungslos gesendetes `no_article: 0` nähme einem zweiten Editor die Entscheidung ab,
	// die er im Konfliktzentrum gerade getroffen hat.
	assert.strictEqual(gespeichert.rumpf.citymap.no_article, undefined,
		"der Merker reist mit, obwohl niemand die Zuweisung angefasst hat");
	zaehl();

	// 🔴 UND DAS BEDIENELEMENT IST WEG (16.08.2026). Hier stand bis dahin ein `feuere("change", …)`
	// auf `data-wa-kein-artikel` samt der Gegenprobe „abhaken schickt 0". Beide sind gefallen, weil
	// es das Kästchen nicht mehr gibt -- an ihre Stelle tritt die Zusicherung, dass es NICHT DA IST.
	assert.strictEqual(host.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"der Karten-Editor zeichnet das Haekchen „Kein Wiki-Artikel vorhanden\" weiter: " + host.innerHTML);
	assert.strictEqual(host.innerHTML.indexOf("Kein Wiki-Artikel vorhanden"), -1,
		"der Wortlaut des Haekchens steht weiter im Kasten: " + host.innerHTML);
	zaehl(); zaehl();

	// ── D) 🔴 DER ABLAUF, DER DATEN ZERSTÖREN KÖNNTE: SPEICHERN HÄLT DEN FREMDEN MERKER ──────
	// 💣 DAS IST DIE ZUSICHERUNG ZUM WEGFALL DES HÄKCHENS, und sie wird über den ECHTEN Ablauf
	// gefahren, nicht am Payload-Bauer: eine Karte, der das Konfliktzentrum `no_article = 1` gesetzt
	// hat, wird im Editor geöffnet und gespeichert -- der Merker darf im Rumpf NICHT auftauchen, denn
	// jeder Wert dort (auch `1`) wäre ein Schreibvorgang auf eine Entscheidung, die woanders getroffen
	// wurde. Nur die ABWESENHEIT des Schlüssels lässt die Spalte in Ruhe.
	// ⚠️ EIGENE FIXTURE, nicht der Sandkasten von oben: nur an einer Karte, die den Merker WIRKLICH
	// trägt, ist „nicht geschrieben" von „es war ohnehin 0" zu unterscheiden.
	const gehakt = sandkastenBauen({ antwort: standardAntwort(detailAntwort({ no_article: true, article_url: "", article_key: "", article_title: "" })) });
	await vm.runInContext('selectCitymap("C-EIGEN")', gehakt.kasten);
	await ruhe();
	const gehaktHost = gehakt.elemente["ceWikiAssign"];
	// Der Kasten zeigt auch bei GESETZTEM Merker kein Kästchen -- das ist der schärfere Zweig
	// (`hakenZeigen` im Bauteil hat für den gesetzten Merker eine eigene Ausnahme).
	assert.strictEqual(gehaktHost.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"ein GESETZTER Merker zeichnet das Haekchen doch: " + gehaktHost.innerHTML);
	gehakt.gesendet.length = 0;
	await vm.runInContext("saveStamm()", gehakt.kasten);
	await ruhe();
	assert.strictEqual(gehakt.gesendet.filter((a) => a.aktion === "upsert_citymap")[0].rumpf.citymap.no_article, undefined,
		"der gespeicherte Merker wird ueberschrieben -- die Entscheidung des Konfliktzentrums geht verloren");
	zaehl(); zaehl();

	// ── D2) 🔴 UND DIE EINE AUSNAHME: EINE ZUWEISUNG BEANTWORTET DEN MERKER ──────────────────
	// 💣 DESHALB SIND DIE DREI ZEILEN IN html/citymap-editor.html STEHENGEBLIEBEN, als einzige der
	// vier Oberflächen: `upsert_citymap` hat weder einen Widerspruchsriegel noch die Regel „eine
	// Zuweisung beantwortet den Merker" (die Landschaft hat sie serverseitig, der Weg in `assign_to`).
	// Ohne diese Zeilen stünde die Karte hinterher mit `article_url` UND `no_article = 1` da.
	gehaktHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	gehakt.gesendet.length = 0;
	gehaktHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	await vm.runInContext("saveStamm()", gehakt.kasten);
	await ruhe();
	const nachZuweisung = gehakt.gesendet.filter((a) => a.aktion === "upsert_citymap")[0];
	assert.ok(String(nachZuweisung.rumpf.citymap.article_url || "") !== "",
		"die Zuweisung ist gar nicht im Rumpf angekommen: " + JSON.stringify(nachZuweisung.rumpf.citymap));
	assert.strictEqual(nachZuweisung.rumpf.citymap.no_article, 0,
		"eine Zuweisung beantwortet den Merker nicht -- die Karte behielte Artikel UND `no_article = 1`");
	zaehl(); zaehl();

	// ── E) ZUWEISEN UND ENTFERNEN IM ABLAUF ──────────────────────────────────────────────────
	const frei = sandkastenBauen({ antwort: standardAntwort(detailAntwort({ article_url: "", article_key: "", article_title: "" })) });
	await vm.runInContext('selectCitymap("C-FREI")', frei.kasten);
	await ruhe();
	const freiHost = frei.elemente["ceWikiAssign"];
	assert.ok(/— keine —/.test(freiHost.innerHTML),
		"eine Karte ohne Artikel zeigt den offenen Zustand nicht: " + freiHost.innerHTML);
	// ⚠️ Und sie fragt gar nicht erst nach einem Registry-Satz.
	assert.ok(!frei.gesendet.some((a) => /action=entry/.test(a.url)),
		"fuer eine Karte ohne Artikel wurde ein Registry-Satz geholt");
	freiHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(/Gareths Tor/.test(freiHost.innerHTML),
		"die Trefferliste kommt nicht im Kasten an: " + freiHost.innerHTML);
	// 🔴 DIE SEITENART STEHT IM TREFFER -- sie ist der Hinweis, dass hier gerade die Seite eines
	// ORTES gewählt wird, und genau das ist hinterher ein Fall im Konfliktzentrum.
	assert.ok(/Gebäude/.test(freiHost.innerHTML),
		"die Seitenart fehlt in der Trefferzeile: " + freiHost.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	frei.gesendet.length = 0;
	freiHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	await vm.runInContext("saveStamm()", frei.kasten);
	await ruhe();
	const nachWahl = frei.gesendet.filter((a) => a.aktion === "upsert_citymap")[0];
	assert.strictEqual(nachWahl.rumpf.citymap.article_key, "gareths-tor");
	assert.strictEqual(nachWahl.rumpf.citymap.article_url, SEITE_TOR.wiki_url);
	assert.strictEqual(nachWahl.rumpf.citymap.article_title, "Gareths Tor");
	zaehl(); zaehl(); zaehl();

	// „Entfernen" -> alle drei Werte werden LEER geschickt, nicht weggelassen.
	frei.gesendet.length = 0;
	freiHost.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.ok(/— keine —/.test(freiHost.innerHTML), "„Entfernen“ hat den Kasten nicht geleert: " + freiHost.innerHTML);
	await vm.runInContext("saveStamm()", frei.kasten);
	await ruhe();
	const nachLoesen = frei.gesendet.filter((a) => a.aktion === "upsert_citymap")[0];
	assert.strictEqual(nachLoesen.rumpf.citymap.article_url, "",
		"nach „Entfernen“ reist die alte Adresse weiter mit");
	assert.strictEqual(nachLoesen.rumpf.citymap.article_key, "",
		"nach „Entfernen“ reist der alte Schluessel weiter mit");
	zaehl(); zaehl(); zaehl();

	// ── F) 🔴 `laden` LEHNT AB, WENN DER REGISTRY-SATZ NICHT KOMMT ───────────────────────────
	// KEINE Textprobe: der Rückruf wird WIRKLICH gefahren.
	const kaputt = sandkastenBauen({
		antwort: (adresse, rumpf) => (/action=entry/.test(adresse)
			? { httpOk: false, status: 500, ok: false }
			: standardAntwort(detailAntwort())(adresse, rumpf)),
	});
	await vm.runInContext('selectCitymap("C-GARETH")', kaputt.kasten);
	await ruhe();
	const kaputtHost = kaputt.elemente["ceWikiAssign"];
	assert.ok(/nicht gelesen werden/.test(kaputtHost.textContent + kaputtHost.innerHTML),
		"der Kasten sagt nicht, dass der Stand nicht gelesen werden konnte: "
		+ kaputtHost.textContent + kaputtHost.innerHTML);
	const steuerung = vm.runInContext("ceWikiAssign", kaputt.kasten);
	assert.strictEqual(steuerung.bereit, false, "ein gescheitertes `laden` laesst `bereit` auf true");
	assert.strictEqual(steuerung.lies(), null, "`lies()` liefert nach einem Fehlschlag einen Schreibwert");
	zaehl(); zaehl(); zaehl();

	// 💣 UND DIE SCHLÜSSEL BLEIBEN GANZ WEG -- genau hier hätte ein „Speichern" die Zuweisung stumm
	// gelöscht (AGENTS.md §10). Weggelassen heißt bei `avesmapsUpsertCitymap` „nicht anfassen".
	kaputt.gesendet.length = 0;
	await vm.runInContext("saveStamm()", kaputt.kasten);
	await ruhe();
	const trotzFehler = kaputt.gesendet.filter((a) => a.aktion === "upsert_citymap")[0];
	assert.ok(trotzFehler, "das Speichern hat nach dem Fehlschlag gar nichts geschickt");
	assert.strictEqual(trotzFehler.rumpf.citymap.article_url, undefined,
		"nach einem gescheiterten Ladelauf wird die Zuweisung stumm ueberschrieben");
	assert.strictEqual(trotzFehler.rumpf.citymap.article_key, undefined,
		"nach einem gescheiterten Ladelauf wird der Schluessel stumm ueberschrieben");
	assert.strictEqual(trotzFehler.rumpf.citymap.no_article, undefined,
		"nach einem gescheiterten Ladelauf wird der dritte Zustand stumm ueberschrieben");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ── G) EINE NEUE KARTE: OFFENER ZUSTAND, KEIN REGISTRY-ABRUF ─────────────────────────────
	const frisch = sandkastenBauen({ antwort: standardAntwort(detailAntwort()) });
	frisch.gesendet.length = 0;
	vm.runInContext("newCitymap()", frisch.kasten);
	await ruhe();
	const frischHost = frisch.elemente["ceWikiAssign"];
	assert.ok(/— keine —/.test(frischHost.innerHTML),
		"eine neue Karte zeigt den offenen Zustand nicht: " + frischHost.innerHTML);
	assert.ok(!frisch.gesendet.some((a) => /action=entry/.test(a.url)),
		"fuer eine neue Karte wurde ein Registry-Satz geholt");
	// 🔴 UND DAS HÄKCHEN STEHT NICHT DA (16.08.2026). Hier stand die umgekehrte Zusicherung mit
	// „Owner-Wunsch" als Beleg; derselbe Owner hat es nach dem Durchklicken wieder abgewählt.
	assert.strictEqual(frischHost.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"eine neue Karte zeigt das Haekchen „Kein Wiki-Artikel vorhanden“ weiter: " + frischHost.innerHTML);
	zaehl(); zaehl(); zaehl();

	console.log("wiki-assign-karte: " + checks + " Zusicherungen erfuellt");
})();
