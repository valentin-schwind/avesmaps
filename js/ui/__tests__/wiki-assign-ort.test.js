// Der ORT als Objektart mit ZWEI Oberflaechen und einer eigenen Falle (Aufgabe 5).
//
// 🔴 Vier Dinge werden hier festgenagelt, und jedes ist einmal danebengegangen oder haette es
// koennen:
//   1. `assign_to` adressiert den ORT ueber seinen TITEL, nicht ueber den `wiki_key` -- anders als
//      beim Weg. Wer den Rumpf des Wegs abschreibt, schickt einen Schluessel, den der Endpunkt nie
//      nachschlaegt, und bekommt „title/public_id fehlt".
//   2. Die SUCHE liefert KEINE Infoboxwerte. Sie kommen erst in der Antwort des Schreibvorgangs --
//      ohne Anreicherung staende der Zuweisungskasten nach der Wahl fast leer da.
//   3. Die Wiki-Ortsklasse ist ein Schluessel und darf NICHT geraten werden: die Hausfassung
//      `normalizeLocationType` faellt auf „dorf" zurueck, und das schriebe aus einer Metropole ein
//      Dorf.
//   4. `laden` LEHNT AB, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von
//      js/ui/wiki-assign.js, in BEIDEN Oberflaechen gefahren.
//
// ⭐ Und die Lehre aus den Aufgaben 3 und 4 steht ueber allem: eine Textprobe misst die FORM des
// Codes, nicht sein Verhalten. Ab Teil 3 laufen die ECHTEN Oberflaechen in einem vm-Sandkasten mit
// untergeschobenem `fetch`; geklickt wird ueber die Zuhoerer, die `mount` selbst angehaengt hat.
//
// Run: node js/ui/__tests__/wiki-assign-ort.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const { avesmapsWikiAssignMount } = require("../wiki-assign.js");
const {
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN,
	avesmapsWikiAssignOrtOrtsgroesse,
	avesmapsWikiAssignOrtWerte,
	avesmapsWikiAssignOrtTreffer,
	avesmapsWikiAssignOrtTitel,
	avesmapsWikiAssignOrtTrefferAnreichern,
	avesmapsWikiAssignOrtArtikel,
	avesmapsWikiAssignOrtZustand,
	avesmapsWikiAssignOrtZuweisungsKoerper,
	avesmapsWikiAssignOrtAntwortPruefen,
	avesmapsWikiAssignOrtSyncWerte,
} = require("../wiki-assign-ort.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prueft BEIDE
// und liefert sonst nur einen Blindgaenger.
global.avesmapsWikiAssignSubject = require("../wiki-assign-registry.js").avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
function zaehl() { checks++; }

// Eine Suchzeile, wie avesmapsWikiSettlementSearch sie WIRKLICH liefert
// (api/_internal/wiki/settlements.php:710-758) -- sechs Spalten, kein einziger Infoboxwert.
const SUCHZEILE = {
	title: "Havena",
	name: "Havena",
	wiki_key: "wiki:havena",
	settlement_class: "grossstadt",
	settlement_label: "Großstadt",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Havena",
};

// Das Objekt, das assign_to bzw. ?action=preview zurueckgibt (avesmapsWikiSettlementParseInfobox).
const SIEDLUNG = {
	title: "Havena",
	name: "Havena",
	wiki_key: "wiki:havena",
	match_key: "havena",
	settlement_class: "grossstadt",
	settlement_label: "Großstadt",
	art: "Hafenstadt",
	einwohner: "9.400",
	bevoelkerung: "Menschen",
	oberhaupt: "Gräfin Yppolita",
	region: "Albernia",
	staat: "Mittelreich",
	lage: "Albernia · Mittelreich",
	handelszone: "Westküste",
	verkehrswege: "Reichsstraße 5",
	tempel: "Efferd",
	description: "Die größte Stadt Alberniens.",
	wappen_url: "https://de.wiki-aventurica.de/img/havena.png",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Havena",
	synced_at: "2026-08-16T00:00:00Z",
};

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DIE ORTSGROESSE WIRD NICHT GERATEN ─────────────────────────────────────────────────────
// 💣 `normalizeLocationType` (js/routing/routing.js:37) gibt bei unbekanntem Wert „dorf" zurueck.
// Als Vorbelegung eines Auswahlfelds vertretbar, als SYNC-VORSCHLAG eine Vermutung, die echte
// Daten schreibt -- und hier entscheidet der Wert die DARSTELLUNG des Ortes.
AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.forEach((schluessel) => {
	assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse(schluessel), schluessel, schluessel + " faellt durch");
	zaehl();
});
["burg", "siedlung", "Handelsstadt", "", null, undefined, "Großstadt"].forEach((unbekannt) => {
	assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse(unbekannt), "",
		"eine unbekannte Ortsklasse (" + JSON.stringify(unbekannt) + ") faellt auf eine geratene Groesse zurueck");
	zaehl();
});
// Die sechs Schluessel sind genau die des Servers und der zwei Auswahlfelder -- keine Zahl im
// Kommentar, sondern die Liste selbst.
assert.deepStrictEqual(
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.slice().sort(),
	["dorf", "gebaeude", "grossstadt", "kleinstadt", "metropole", "stadt"],
	"die Ortsgroessen weichen von den stabilen Schluesseln ab (AGENTS.md §2)"
);
zaehl();

// ── 2) DIE SUCHZEILE TRAEGT NUR DIE ORTSGROESSE ───────────────────────────────────────────────
const trefferAusSuche = avesmapsWikiAssignOrtTreffer(SUCHZEILE);
assert.strictEqual(trefferAusSuche.wiki_key, "wiki:havena");
assert.strictEqual(trefferAusSuche.werte.settlement_label, "Großstadt");
assert.strictEqual(trefferAusSuche.werte.einwohner, "", "die Suche liefert keine Einwohnerzahl -- sie darf hier nicht erfunden werden");
assert.strictEqual(trefferAusSuche.werte.art, "");
assert.strictEqual(trefferAusSuche.werte.ortsgroesse, "grossstadt", "settlement_class steht in der Suchzeile und wird abgebildet");
// 🔴 Der TITEL ist die Adresse, nicht der Schluessel: assign_to schlaegt die Seite ueber `title`
// nach (settlements.php:807).
assert.strictEqual(avesmapsWikiAssignOrtTitel(trefferAusSuche), "Havena");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) DIE ANREICHERUNG NACH DEM SCHREIBEN ────────────────────────────────────────────────────
// 💣 `trefferWaehlen` uebernimmt `treffer.werte` NACH dem Aufloesen von `zuweisen` in den Artikel.
// Ohne diesen Schritt staende der Zuweisungskasten unmittelbar nach der Wahl fast leer da.
const angereichert = avesmapsWikiAssignOrtTrefferAnreichern(avesmapsWikiAssignOrtTreffer(SUCHZEILE), SIEDLUNG);
assert.strictEqual(angereichert.werte.einwohner, "9.400");
assert.strictEqual(angereichert.werte.oberhaupt, "Gräfin Yppolita");
assert.strictEqual(angereichert.werte.art, "Hafenstadt");
// 🪤 Diese Zusicherung war zuerst BLIND: sie fragte nur nach `roh.title`, und den traegt die
// Siedlung genauso -- die Mutation „roh = settlement" lief gruen durch. Jetzt wird die IDENTITAET
// geprueft, und das ist die einzige Form, die den Unterschied sieht.
assert.strictEqual(angereichert.roh, SUCHZEILE,
	"die rohe Suchzeile muss die Anreicherung ueberleben -- sie ist die Quelle des Titels");
assert.ok(!("einwohner" in angereichert.roh), "in `roh` steht die Siedlung, nicht die Suchzeile");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 4) DER ARTIKEL AUS DEM NEST ───────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignOrtArtikel(null), null);
assert.strictEqual(avesmapsWikiAssignOrtArtikel({}), null, "ein Nest ohne Titel ist keine Zuweisung");
assert.strictEqual(avesmapsWikiAssignOrtArtikel(SIEDLUNG).werte.region, "Albernia");
// ⚠️ Die beim ANLEGEN gemerkte Wahl kennt nur drei Felder und hat noch keinen Schluessel -- ein
// Riegel auf `wiki_key` liesse sie unsichtbar.
const gemerkt = avesmapsWikiAssignOrtArtikel({ title: "Gareth", name: "Gareth", wiki_url: "https://x/wiki/Gareth" });
assert.ok(gemerkt && gemerkt.name === "Gareth", "die gemerkte Wahl ohne wiki_key faellt durch");
assert.strictEqual(gemerkt.wiki_key, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 5) DER VERTRAG: `laden` LEHNT AB, STATT ETWAS LEERES ZU LIEFERN ───────────────────────────
[null, undefined, [], 5, "x"].forEach((kaputt) => {
	assert.throws(() => avesmapsWikiAssignOrtZustand(kaputt),
		"avesmapsWikiAssignOrtZustand(" + JSON.stringify(kaputt) + ") liefert einen Zustand, statt zu werfen");
	zaehl();
});
// Ohne Zuweisung ist `artikel` null -- ein GUELTIGER Zustand.
const ohne = avesmapsWikiAssignOrtZustand({ wiki_settlement: null, name: "Havena", feature_subtype: "dorf" });
assert.strictEqual(ohne.artikel, null);
assert.strictEqual(ohne.kartenwerte.name, "Havena");
assert.strictEqual(ohne.kartenwerte.feature_subtype, "dorf");
zaehl(); zaehl(); zaehl();

// 💣 LESEFUNKTIONEN: der Kartenwert wird beim LESEN geholt, nicht beim Laden eingefroren.
let formularName = "Havena (alt)";
const lebend = avesmapsWikiAssignOrtZustand({
	wiki_settlement: SIEDLUNG,
	name: () => formularName,
	feature_subtype: () => "dorf",
});
assert.strictEqual(lebend.kartenwerte.name, "Havena (alt)");
formularName = "Havena";
assert.strictEqual(lebend.kartenwerte.name, "Havena",
	"der Kartenwert ist eingefroren -- die Sync-Vorschau vergliche gegen einen Stand, den das Formular nicht mehr zeigt");
zaehl(); zaehl();

// ── 6) DIE HTTP-ANTWORT: WIRFT BEI JEDEM NEIN ─────────────────────────────────────────────────
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen({ ok: false, error: { message: "forbidden" } }), /forbidden/);
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen(null));
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen([]));
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen(undefined));
const gut = { ok: true, applied: 1 };
assert.strictEqual(avesmapsWikiAssignOrtAntwortPruefen(gut), gut);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 7) DER ZUWEISUNGSRUMPF ────────────────────────────────────────────────────────────────────
const koerper = avesmapsWikiAssignOrtZuweisungsKoerper("Havena", "loc-1");
assert.deepStrictEqual(koerper, { action: "assign_to", title: "Havena", public_id: "loc-1", dry_run: false, confirm: "apply" });
assert.ok(!("wiki_key" in koerper), "der Ort wird ueber den TITEL adressiert, nicht ueber den Schluessel");
zaehl(); zaehl();

// ── 8) DIE UEBERNAHME LIEST NUR ANGEHAKTE ZEILEN ──────────────────────────────────────────────
assert.deepStrictEqual(avesmapsWikiAssignOrtSyncWerte([]), { name: null, feature_subtype: null });
assert.deepStrictEqual(
	avesmapsWikiAssignOrtSyncWerte([{ karte: "name", neu: "Havena" }]),
	{ name: "Havena", feature_subtype: null }
);
assert.deepStrictEqual(
	avesmapsWikiAssignOrtSyncWerte([{ karte: "feature_subtype", neu: "grossstadt" }, { karte: "einwohner", neu: "9.400" }]),
	{ name: null, feature_subtype: "grossstadt" },
	"ein Feld ohne Kartenziel darf nicht in die Uebernahme rutschen"
);
zaehl(); zaehl(); zaehl();

// ══ TEIL 2: die Erklaerung `ort` im Register ══════════════════════════════════════════════════
const ort = AVESMAPS_WIKI_ASSIGN_REGISTRY.ort;
assert.ok(ort, "die Erklaerung `ort` fehlt im Register");
assert.strictEqual(ort.suche.art, "server");
assert.strictEqual(ort.suche.url, "/api/edit/wiki/settlements.php");
// 💣 Genau ZWEI Kartenziele. Waechst die Liste, ist ein Feld dazugekommen, das die Sync-Vorschau
// schreiben kann -- dann muss avesmapsWikiAssignOrtSyncWerte es kennen, sonst faellt es lautlos
// unter den Tisch (das Bauteil zeigt die Zeile, die Uebernahme ignoriert sie).
assert.deepStrictEqual(
	ort.felder.filter((feld) => feld.karte !== "").map((feld) => feld.karte),
	["name", "feature_subtype"],
	"die Kartenziele der Erklaerung `ort` und avesmapsWikiAssignOrtSyncWerte laufen auseinander"
);
// Die Anzeigefelder, die die Aufgabe nennt, sind da -- und Einwohner/Lage/Herrscher tragen
// ausdruecklich KEIN Kartenziel (es gibt keins).
["einwohner", "region", "staat", "oberhaupt"].forEach((wikiFeld) => {
	const zeile = ort.felder.filter((feld) => feld.wiki === wikiFeld)[0];
	assert.ok(zeile, "Feldzeile fuer „" + wikiFeld + "“ fehlt");
	assert.strictEqual(zeile.karte, "", wikiFeld + " hat plotzlich ein Kartenziel -- gibt es das Feld wirklich?");
	zaehl();
});
zaehl(); zaehl(); zaehl(); zaehl();

// ── Die Diff-Rechnung auf der ECHTEN Erklaerung ───────────────────────────────────────────────
// 💣 Die Sync-Vorschau kennt nur Zeilen MIT Kartenziel. Genau deshalb steht die Einwohnerzahl NIE
// darin -- sie ist Anzeige. Das ist die Antwort auf „syncen und die Einwohnerzahl ungehakt lassen":
// sie ist gar nicht erst anhakbar.
const diffZeilen = avesmapsWikiAssignDiff(
	ort.felder,
	{ name: "Havena (alt)", feature_subtype: "dorf" },
	avesmapsWikiAssignOrtWerte(SIEDLUNG),
	[]
);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.karte), ["name", "feature_subtype"]);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.neu), ["Havena", "grossstadt"]);
assert.ok(diffZeilen.every((zeile) => zeile.gehakt === true), "beide Aenderungen sind vorangehakt");
assert.ok(!diffZeilen.some((zeile) => zeile.karte === "einwohner"),
	"die Einwohnerzahl steht in der Sync-Vorschau -- sie hat kein Kartenziel und kann nichts uebernehmen");
zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 Sagt das Wiki zur Ortsgroesse nichts (unbekannte Klasse), steht die Zeile drin, aber NIE
// vorangehakt -- sonst leerte ein unbedachter Klick ein gepflegtes Feld.
const diffLeer = avesmapsWikiAssignDiff(
	ort.felder,
	{ name: "Havena", feature_subtype: "grossstadt" },
	avesmapsWikiAssignOrtWerte(Object.assign({}, SIEDLUNG, { settlement_class: "burg" })),
	[]
);
assert.strictEqual(diffLeer.length, 1);
assert.strictEqual(diffLeer[0].karte, "feature_subtype");
assert.strictEqual(diffLeer[0].gehakt, false);
assert.ok(/würde die Angabe leeren/.test(diffLeer[0].grund), diffLeer[0].grund);
zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 2b: WELCHES STYLESHEET ERREICHT WELCHES DOKUMENT ═════════════════════════════════════
// 💣 Genau daran ist Aufgabe 3 einmal gescheitert: die `.label-wiki-*`-Regeln stehen in
// region-sync.css und die laedt NUR index.html; die `.dt-*`-Regeln stehen in editor-page.css und
// die laedt nur das iframe. Eine Huelle im falschen Dokument ist nicht „etwas anders", sondern
// voellig ungestylt -- und keine Ablaufprobe der Welt sieht das, weil im Sandkasten kein CSS gilt.
// ⚠️ Das ist die eine Frage, die eine Textprobe WIRKLICH beantworten kann: welche Datei ein
// Dokument bindet. Ueber die Regeln selbst sagt sie nichts -- die zaehlt
// js/ui/__tests__/wiki-assign-weg.test.js je Rolle beider Huellen nach.
// 🪤 GEPRUEFT WIRD DIE `<link>`-ZEILE, NICHT DER DATEINAME. Die erste Fassung suchte schlicht nach
// „editor-page.css" -- und blieb gruen, als die Mutation die Zeile ENTFERNTE: der Name steht im
// selben Dokument noch viermal in KOMMENTAREN. Dieselbe Blindheit wie in Aufgabe 4, wo eine
// CSS-Kommentarzeile die Probe gefuettert hat.
function bindetStylesheet(inhalt, datei) {
	return new RegExp('<link[^>]+href="[^"]*' + datei.replace(/\./g, "\\.") + '[^"]*"').test(inhalt);
}
const indexHtml = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const editorHtmlRoh = fs.readFileSync(path.join(wurzel, "html/wiki-sync-settlement-editor.html"), "utf8");
assert.ok(bindetStylesheet(indexHtml, "components/region-sync.css"),
	"index.html bindet region-sync.css nicht -- die Huelle „label-wiki“ des Kartendialogs waere ungestylt");
assert.ok(bindetStylesheet(editorHtmlRoh, "components/editor-page.css"),
	"der Orte-Editor bindet editor-page.css nicht -- die Huelle „dt“ waere dort ungestylt");
// Und die Gegenrichtung: keins der zwei Dokumente bindet das Stylesheet des anderen, es gibt also
// keinen stillen Rueckfall, der eine falsche Huelle trotzdem passabel aussehen liesse.
assert.ok(!bindetStylesheet(editorHtmlRoh, "components/region-sync.css"), "der Orte-Editor bindet region-sync.css mit");
zaehl(); zaehl(); zaehl();

// ══ TEIL 3+4: die zwei Oberflaechen, WIRKLICH gefahren ════════════════════════════════════════

/** Ein Behaelter, der Klicks wirklich ausloest (Vorbild: js/ui/__tests__/wiki-assign-weg.test.js). */
function scheinBehaelter(id) {
	const zuhoerer = {};
	return {
		id: id || "host", textContent: "", innerHTML: "", className: "", value: "",
		dataset: {}, style: {}, options: [], hidden: false, disabled: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains() { return true; },
		// Der Orte-Editor baut seine Listen mit appendChild -- ohne diese Handvoll faellt sein
		// Selbststart um, bevor die Zuweisung ueberhaupt drankommt.
		appendChild() {}, removeChild() {}, remove() {}, insertBefore() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, focus() {}, dispatchEvent() { return true; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
	};
}

/** Ein Ereignisziel mit GENAU einem Merkmal -- `aufKlick` fragt nacheinander nach zwei Selektoren. */
function scheinZiel(merkmal, wert, zusatz) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, zusatz || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

/** Ein Formularfeld mit Wert (Namensfeld, Auswahlliste, verstecktes Feld). */
function scheinFeld(wert, optionen) {
	return {
		value: wert === undefined ? "" : wert,
		options: (optionen || []).map((v) => ({ value: v })),
		checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "", className: "",
		dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
		setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

/**
 * Ein Sandkasten mit Dokument-Attrappe und aufgezeichnetem `fetch`.
 * `behaelterIds` bekommen einen klickfaehigen Behaelter, alles andere ein Formularfeld.
 */
function sandkastenBauen(dateien, felder, behaelterIds, fetchAntwort) {
	const elemente = {};
	Object.keys(felder || {}).forEach((id) => { elemente[id] = felder[id]; });
	(behaelterIds || []).forEach((id) => { elemente[id] = scheinBehaelter(id); });
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		// ⚠️ `hasOwnProperty`, nicht `!elemente[id]`: ein ausdruecklich auf `null` gesetzter Eintrag
		// heisst „dieses Element gibt es NICHT" -- und genau damit wird der Fehlerpfad gefahren.
		// Mit der Wahrheitswert-Pruefung legte die Attrappe stattdessen ein neues Feld an, und der
		// Riegel, den die Probe darunter sucht, kaeme nie zum Zug.
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
		String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, Promise, isFinite, isNaN,
		parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Event: function () {},
		document: dokument,
		location: { href: "http://pruefstand.local/html/wiki-sync-settlement-editor.html" },
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: () => true,
		apiErrorMessage: (antwort, rueckfall) => rueckfall,
		showFeedbackToast: () => {},
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf: rumpf, methode: (opt && opt.method) || "GET" });
			const antwort = fetchAntwort(String(url), rumpf);
			return Promise.resolve({ ok: antwort.httpOk !== false, status: antwort.status || 200, json: () => Promise.resolve(antwort) });
		},
		gemounted: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	return { kasten: kasten, elemente: elemente, gesendet: gesendet };
}

/**
 * 🔴 DIE SKRIPTLISTE WIRD AUS DEM DOKUMENT GELESEN, NICHT HIER AUFGEZAEHLT.
 *
 * 💣 Sonst prueft der Sandkasten nur sich selbst: er laedt das Bauteil, weil er es aufzaehlt, und
 * eine im Dokument VERGESSENE `<script>`-Zeile bliebe unsichtbar -- live gaebe `mount` dann einen
 * Blindgaenger. Die Ladereihenfolge ist Vertrag (Register, Diff, Bauteil, Datenweg); dass sie
 * eingehalten wird, kann nur eine Probe sehen, die sie aus der Datei nimmt.
 * ⚠️ Nur Dateien, die es im Baum gibt -- index.html verweist auch auf Fremdes.
 */
function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	const treffer = inhalt.match(/<script[^>]+src="([^"]+)"/g) || [];
	return treffer
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => (muster ? muster.test(src) : true))
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

(async () => {
	// ══ TEIL 3: DER KARTENDIALOG („Ort bearbeiten") ═══════════════════════════════════════════
	const felder = {
		"location-edit-name": scheinFeld("Havena (alt)"),
		"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
		"location-edit-wiki-url": scheinFeld("https://de.wiki-aventurica.de/wiki/Havena_(Andergast)"),
		"location-edit-description": scheinFeld("Alte Beschreibung."),
	};
	// Die vier Zeilen aus index.html, in DEREN Reihenfolge -- fehlt eine, liefert `mount` unten
	// einen Blindgaenger und die erste Zusicherung faellt um.
	const dialogSkripte = skripteAus("index.html", /wiki-assign|review-settlement-wiki/);
	// ⚠️ `wiki-assign-weg.js` steht mit in der Liste -- es ist der Datenweg der NACHBAR-Objektart
	// und haengt von nichts ab; mitgeladen schadet es nicht und die Reihenfolge bleibt pruefbar.
	assert.deepStrictEqual(dialogSkripte, [
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js", "js/ui/wiki-assign-ort.js", "js/review/review-settlement-wiki.js",
	], "index.html bindet die Wiki-Zuweisung nicht (oder in der falschen Reihenfolge): " + dialogSkripte.join(" "));
	zaehl();

	const k = sandkastenBauen(dialogSkripte, felder,
		["settlement-wiki-assign-host"],
		(url, rumpf) => {
			if (rumpf && rumpf.action === "assign_to") {
				return { ok: true, wiki_name: "Havena", revision: 4711, settlement: SIEDLUNG };
			}
			if (rumpf && rumpf.action === "clear_assign") {
				return { ok: true, revision: 4712 };
			}
			return { ok: true, query: "", rows: [SUCHZEILE] };
		});
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-1', name: 'Havena (alt)',"
		+ " location: { name: 'Havena (alt)' } };"
		+ "var locationEditPendingWikiSettlement = null;"
		+ "var setLocationEditSizeAufrufe = [];"
		+ "function setLocationEditSize(wert) { setLocationEditSizeAufrufe.push(wert);"
		+ " document.getElementById('location-edit-type').value = wert; }", k.kasten);

	const host = k.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", k.kasten);
	await ruhe();
	assert.ok(host.innerHTML.indexOf("Wiki-Ort") !== -1, "der Kasten traegt die Ueberschrift der Erklaerung: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "ohne Zuweisung steht „— keine —“ da");
	// Die Huelle „label-wiki", nicht „dt" -- index.html laedt region-sync.css, nicht
	// editor-page.css; mit der falschen Huelle staende der Kasten voellig ungestylt im Dialog.
	assert.ok(host.innerHTML.indexOf("label-wiki-reference") !== -1 && host.innerHTML.indexOf("dt-grp") === -1,
		"der Kartendialog mountet die falsche Huelle: " + host.innerHTML);
	zaehl(); zaehl(); zaehl();

	// ---- Suchen -------------------------------------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	const suchAufruf = k.gesendet.filter((s) => s.url.indexOf("action=search") !== -1)[0];
	assert.ok(suchAufruf, "es wurde gar nicht gesucht: " + JSON.stringify(k.gesendet));
	assert.ok(/\/api\/edit\/wiki\/settlements\.php\?action=search&q=&limit=40$/.test(suchAufruf.url),
		"die Suche fragt nicht die gemessene Adresse ab: " + suchAufruf.url);
	// Die Trefferzeile: Name plus die EINZIGE Angabe, die die Suche liefert.
	assert.ok(host.innerHTML.indexOf("Havena") !== -1, host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Großstadt") !== -1,
		"die Meta-Zeile des Treffers ist leer -- die flachen Antwortzeilen kommen unaufbereitet an: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Waehlen: der Rumpf, und die Anreicherung ---------------------------------------------
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	const zuweisung = k.gesendet.filter((s) => s.rumpf && s.rumpf.action === "assign_to")[0];
	assert.ok(zuweisung, "es wurde nichts zugewiesen: " + JSON.stringify(k.gesendet.map((s) => s.rumpf)));
	// 🔴 DIE FALLE DES ORTS: der TITEL adressiert, nicht der Schluessel.
	assert.strictEqual(zuweisung.rumpf.title, "Havena",
		"der Ort wird nicht ueber seinen Titel adressiert -- assign_to schlaegt genau darueber nach");
	assert.ok(!("wiki_key" in zuweisung.rumpf), "ein wiki_key im Rumpf ist der abgeschriebene Weg-Rumpf");
	assert.strictEqual(zuweisung.rumpf.public_id, "loc-1");
	assert.strictEqual(zuweisung.rumpf.dry_run, false);
	assert.strictEqual(zuweisung.rumpf.confirm, "apply");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// 💣 Der Kasten zeigt die Infoboxwerte, obwohl die SUCHE keine geliefert hat.
	assert.ok(host.innerHTML.indexOf("Einwohner") !== -1 && host.innerHTML.indexOf("9.400") !== -1,
		"der Zuweisungskasten zeigt nach der Wahl keine Infoboxwerte -- die Anreicherung kam nicht an: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Gräfin Yppolita") !== -1, host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Hafenstadt") !== -1, host.innerHTML);
	// Leere Felder fallen weg -- SIEDLUNG traegt keine, also steht auch keine leere Zeile da.
	assert.ok(host.innerHTML.indexOf('data-wa-aktion="sync"') !== -1, "ohne Sync-Knopf gaebe es nichts ins Formular zu holen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// Das versteckte wiki_url-Feld wurde mitgezogen (Discord #38, unveraendert gueltig).
	assert.strictEqual(felder["location-edit-wiki-url"].value, SIEDLUNG.wiki_url,
		"das versteckte wiki_url-Feld traegt noch die alte Adresse -- das naechste Speichern schriebe sie zurueck");
	// 💣 assign_to loescht die Beschreibung serverseitig; bliebe sie im Feld, schriebe das naechste
	// Speichern sie zurueck.
	assert.strictEqual(felder["location-edit-description"].value, "",
		"die Beschreibung steht noch im Formular, obwohl der Server sie gerade geloescht hat");
	zaehl(); zaehl();

	// ---- Sync: EINE Zeile ungehakt lassen -----------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("2 von 2 Angaben würden sich ändern") !== -1,
		"die Sync-Vorschau zaehlt falsch: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Havena (alt)") !== -1 && host.innerHTML.indexOf("grossstadt") !== -1, host.innerHTML);
	zaehl(); zaehl();
	// Die zweite Zeile (Ortsgroesse) ausdruecklich ABhaken.
	host.feuere("change", scheinZiel("data-wa-sync-haken", "1", { checked: false }));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(felder["location-edit-name"].value, "Havena", "der angehakte Name wurde nicht uebernommen");
	assert.strictEqual(felder["location-edit-type"].value, "dorf",
		"die ABGEHAKTE Ortsgroesse wurde trotzdem uebernommen -- ein Haken, der nichts bedeutet");
	assert.strictEqual(vm.runInContext("setLocationEditSizeAufrufe.length", k.kasten), 0,
		"die Ortsgroesse wurde gesetzt, obwohl ihre Zeile abgehakt war");
	zaehl(); zaehl(); zaehl();

	// ---- Sync ein zweites Mal: jetzt bleibt genau die eine Zeile, und sie geht durch den Setzer -
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("1 von 2 Angaben würde sich ändern") !== -1,
		"die zweite Vorschau kennt den frisch uebernommenen Namen nicht -- der Kartenwert ist eingefroren: " + host.innerHTML);
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	// 🔴 setLocationEditSize, nicht `select.value = …`: an der Ortsgroesse haengt die Sperre des
	// Feldes „Art" (place_kind), und ein programmatisches Setzen feuert kein change-Ereignis.
	// ⚠️ Ueber JSON verglichen: eine Liste aus dem Sandkasten hat einen ANDEREN Array-Prototyp, und
	// deepStrictEqual faellt daran, nicht am Inhalt.
	assert.strictEqual(vm.runInContext("JSON.stringify(setLocationEditSizeAufrufe)", k.kasten), '["grossstadt"]',
		"die Ortsgroesse wurde am einzigen Setzer vorbei geschrieben -- die place_kind-Sperre bliebe falsch");
	assert.strictEqual(felder["location-edit-type"].value, "grossstadt");
	zaehl(); zaehl(); zaehl();

	// ---- Entfernen ----------------------------------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	const loesung = k.gesendet.filter((s) => s.rumpf && s.rumpf.action === "clear_assign")[0];
	assert.ok(loesung, "es wurde nichts geloest");
	assert.strictEqual(loesung.rumpf.public_id, "loc-1");
	assert.strictEqual(loesung.rumpf.confirm, "apply");
	assert.strictEqual(felder["location-edit-wiki-url"].value, "",
		"das versteckte wiki_url-Feld wurde nicht mitgeleert -- der Auto-Connect stellte die Verbindung beim naechsten Speichern wieder her");
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "nach dem Entfernen steht die Zuweisung noch da: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Ein NEIN des Servers laesst alles stehen ---------------------------------------------
	// 🔴 Ohne Ablehnungszweig malte das Bauteil eine Zuweisung, die es auf dem Server nicht gibt.
	const kNein = sandkastenBauen(dialogSkripte,
		{
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
			"location-edit-wiki-url": scheinFeld(""),
		},
		["settlement-wiki-assign-host"],
		(url, rumpf) => (rumpf ? { ok: false, error: { message: "Wiki-Seite nicht gefunden" } } : { ok: true, rows: [SUCHZEILE] }));
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-9', location: {} };"
		+ "var locationEditPendingWikiSettlement = null;", kNein.kasten);
	const hostNein = kNein.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kNein.kasten);
	await ruhe();
	hostNein.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	hostNein.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	// Der Knopf „Entfernen" gibt es NUR im Zustand „zugewiesen" -- er ist damit die genaueste Probe
	// darauf, ob das Bauteil eine Zuweisung gemalt hat, die es auf dem Server nicht gibt.
	assert.ok(hostNein.innerHTML.indexOf('data-wa-aktion="entfernen"') === -1,
		"nach einem abgelehnten Zuweisen steht eine Zuweisung im Kasten: " + hostNein.innerHTML);
	assert.ok(hostNein.innerHTML.indexOf("Schlüssel") === -1, hostNein.innerHTML);
	assert.strictEqual(kNein.elemente["location-edit-wiki-url"].value, "",
		"ein abgelehntes Zuweisen hat trotzdem ins versteckte Feld geschrieben");
	zaehl(); zaehl();

	// ---- Der Vertrag, durch die ECHTE Oberflaeche hindurch -------------------------------------
	// 💣 Nicht am Bauer geprueft, sondern an der VERDRAHTUNG: der geteilte Zustandsbauer wird zum
	// Werfen gebracht (das Formular fehlt), und der Fehler MUSS durch die Oberflaeche kommen. Ein
	// `try { … } catch { return {}; }` an JEDER Stelle von settlementWikiZustand faellt hier um.
	const kLeer = sandkastenBauen(dialogSkripte, {},
		["settlement-wiki-assign-host"], () => ({ ok: true, rows: [] }));
	vm.runInContext("var locationEditMarkerEntry = null; var locationEditPendingWikiSettlement = null;", kLeer.kasten);
	// Ohne Formularfelder: `document.getElementById` liefert Attrappen, deshalb werden die zwei
	// Pflichtfelder ausdruecklich auf `null` gesetzt.
	kLeer.elemente["location-edit-name"] = null;
	kLeer.elemente["location-edit-type"] = null;
	assert.throws(() => vm.runInContext("settlementWikiZustand()", kLeer.kasten),
		"der Kartendialog liefert ohne Formular einen Zustand, statt zu werfen -- das Bauteil hielte sich fuer geladen");
	zaehl();
	// 🪤 UND DIE SCHAERFERE FASSUNG, weil die obige NICHT reicht: sie erreicht nur die fruehe Wache
	// („kein Formular"), und ein `try { … } catch { return {}; }` um den UNTEREN Teil von
	// settlementWikiZustand blieb damit gruen -- genau die halbe Blindheit, die Aufgabe 4 in ihrer
	// Nachbesserung gemessen hat. Deshalb wird hier der GETEILTE Bauer zum Werfen gebracht: sein
	// Fehler muss durch die Oberflaeche hindurch, und das faengt ein `catch` an JEDER Stelle.
	vm.runInContext("var echterOrtZustand = avesmapsWikiAssignOrtZustand;"
		+ "avesmapsWikiAssignOrtZustand = function () { throw new Error('BAUER WIRFT'); };", k.kasten);
	assert.throws(() => vm.runInContext("settlementWikiZustand()", k.kasten), /BAUER WIRFT/,
		"der Kartendialog schluckt einen Fehler des geteilten Zustandsbauers");
	vm.runInContext("avesmapsWikiAssignOrtZustand = echterOrtZustand;", k.kasten);
	zaehl();
	// Und was daraus ueber `mount` folgt: nicht bereit, kein Schreibwert.
	const steuerung = avesmapsWikiAssignMount(scheinBehaelter("x"), {
		subject: "ort", skin: "label-wiki",
		laden: () => { throw new Error("kein Ort"); },
	});
	await steuerung.neuLaden();
	assert.strictEqual(steuerung.bereit, false);
	assert.strictEqual(steuerung.lies(), null);
	const steuerung2 = avesmapsWikiAssignMount(scheinBehaelter("y"), {
		subject: "ort", skin: "dt",
		laden: () => Promise.reject(new Error("HTTP 500")),
	});
	await steuerung2.neuLaden();
	assert.strictEqual(steuerung2.bereit, false);
	assert.strictEqual(steuerung2.lies(), null);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ══ TEIL 4: DER ORTE-EDITOR (html/wiki-sync-settlement-editor.html) ═══════════════════════
	// Das Fenster ist eine HTML-Seite mit EINEM grossen Inline-Skript; es wird hier unveraendert
	// aus der Datei geschnitten und im Sandkasten gefahren -- dieselbe Bauart wie beim Wege-Editor
	// (dort lag das Skript nur schon als eigene Datei vor).
	// ⚠️ `\r?\n`: die Datei liegt im Arbeitsbaum mit CRLF (git normalisiert erst beim Commit,
	// .gitattributes `* text=auto`). Ein Schnitt auf `<script>\n` findet auf einem Windows-Checkout
	// GAR NICHTS -- und ohne die Zusicherung darunter waere das ein leeres, gruen laufendes Skript.
	const editorHtml = fs.readFileSync(path.join(wurzel, "html/wiki-sync-settlement-editor.html"), "utf8");
	const skriptTeile = editorHtml.split(/<script>\r?\n/);
	const editorSkript = skriptTeile[skriptTeile.length - 1].split("</script>")[0];
	assert.ok(editorSkript.indexOf("function mountSettlementWikiAssign") !== -1,
		"der Schnitt hat das falsche Skript erwischt");
	zaehl();

	const eFelder = {
		dtEditName: scheinFeld("Havena (alt)"),
		dtEditType: scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
		dtEditMsg: scheinFeld(""),
	};
	// 🔴 Auch hier kommt die Skriptliste AUS DEM DOKUMENT, in dessen Reihenfolge -- fehlt eine der
	// vier Zeilen der Wiki-Zuweisung, liefert `mount` unten einen Blindgaenger.
	const editorSkripte = skripteAus("html/wiki-sync-settlement-editor.html");
	assert.deepStrictEqual(
		editorSkripte.filter((src) => /wiki-assign/.test(src)),
		["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"],
		"der Orte-Editor bindet die Wiki-Zuweisung nicht (oder in der falschen Reihenfolge)"
	);
	zaehl();
	const e = sandkastenBauen(
		editorSkripte,
		eFelder, ["dtWikiAssign", "seDetailBody", "seList", "seTree"],
		(url, rumpf) => {
			if (rumpf && rumpf.action === "assign_to") {
				return { ok: true, wiki_name: "Havena", revision: 4711, settlement: SIEDLUNG };
			}
			if (rumpf && rumpf.action === "clear_assign") {
				return { ok: true, revision: 4712 };
			}
			if (url.indexOf("action=settlement_detail") !== -1) {
				return { ok: true, detail: { public_id: "loc-1", name: "Havena (alt)", feature_subtype: "dorf", on_map: true, properties: {} } };
			}
			if (url.indexOf("action=search") !== -1) {
				return { ok: true, query: "", rows: [SUCHZEILE] };
			}
			return { ok: true, items: [], nodes: [], synced: {} };
		});
	vm.runInContext(editorSkript, e.kasten, { filename: "html/wiki-sync-settlement-editor.html" });
	await ruhe();

	// 🔴 Ueber den ECHTEN Weg, nicht per Direktaufruf: einen Ort auswaehlen laesst
	// renderSettlementDetail das Panel bauen UND das Bauteil einhaengen. Eine Probe, die
	// mountSettlementWikiAssign() selbst ruft, bliebe gruen, wenn die Verdrahtung fehlt -- gemessen
	// (Mutation „Editor mountet gar nicht" lief gegen die erste Fassung gruen durch).
	vm.runInContext("selectedPublicId = 'loc-1'; renderSettlementDetail('loc-1');", e.kasten);
	await ruhe();
	const eHost = e.elemente.dtWikiAssign;
	assert.ok(vm.runInContext("$('seDetailBody').innerHTML", e.kasten).indexOf('id="dtWikiAssign"') !== -1,
		"das Panel traegt den Behaelter der Zuweisung nicht");
	assert.ok(eHost.innerHTML.indexOf("avm-wiki-assign") !== -1,
		"renderSettlementDetail haengt das Bauteil nicht ein: " + eHost.innerHTML);
	// Die Huelle „dt", nicht „label-wiki" -- das Editorfenster laedt editor-page.css, nicht
	// region-sync.css; mit der falschen Huelle staende der Kasten voellig ungestylt da.
	assert.ok(eHost.innerHTML.indexOf("dt-grp") !== -1 && eHost.innerHTML.indexOf("label-wiki") === -1,
		"der Orte-Editor mountet die falsche Huelle: " + eHost.innerHTML);
	assert.ok(eHost.innerHTML.indexOf("— keine —") !== -1, eHost.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	eHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	const eZuweisung = e.gesendet.filter((s) => s.rumpf && s.rumpf.action === "assign_to")[0];
	assert.ok(eZuweisung, "der Orte-Editor hat nichts zugewiesen: " + JSON.stringify(e.gesendet.map((s) => s.rumpf)));
	assert.strictEqual(eZuweisung.rumpf.title, "Havena", "auch hier adressiert der TITEL");
	assert.ok(!("wiki_key" in eZuweisung.rumpf));
	assert.strictEqual(eZuweisung.rumpf.public_id, "loc-1");
	assert.strictEqual(eZuweisung.rumpf.confirm, "apply");
	// 💣 Danach wird das Panel neu geladen -- sonst stuende die serverseitig geloeschte Beschreibung
	// noch im Textfeld und das naechste Speichern schriebe sie zurueck.
	assert.ok(e.gesendet.some((s) => s.url.indexOf("action=settlement_detail") !== -1),
		"nach dem Zuweisen wird das Panel nicht neu geladen");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Sync im Editor: fuellt Namensfeld und Auswahl ----------------------------------------
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena (alt)', feature_subtype: 'dorf', on_map: true,"
		+ " properties: { wiki_settlement: " + JSON.stringify(SIEDLUNG) + " } } };"
		+ "mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("9.400") !== -1, "der Editor zeigt die Infoboxwerte nicht: " + eHost.innerHTML);
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("2 von 2 Angaben würden sich ändern") !== -1, eHost.innerHTML);
	eHost.feuere("change", scheinZiel("data-wa-sync-haken", "0", { checked: false }));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(eFelder.dtEditName.value, "Havena (alt)",
		"der ABGEHAKTE Name wurde trotzdem uebernommen");
	assert.strictEqual(eFelder.dtEditType.value, "grossstadt", "die angehakte Ortsgroesse wurde nicht uebernommen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Der Vertrag im Editor ----------------------------------------------------------------
	// 💣 Wieder an der VERDRAHTUNG: der Cache gehoert einem anderen Ort -- genau der Zustand nach
	// einem gescheiterten Detail-Abruf.
	vm.runInContext("settlementDetailCache = null;", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten),
		"der Orte-Editor liefert ohne geladenen Ort einen Zustand, statt zu werfen");
	vm.runInContext("settlementDetailCache = { publicId: 'ein-anderer', detail: { properties: {} } };", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten),
		"ein Cache fuer einen ANDEREN Ort gilt als Stand dieses Ortes");
	zaehl(); zaehl();
	// 🪤 Und dieselbe schaerfere Fassung wie oben: der GETEILTE Bauer wird zum Werfen gebracht, und
	// sein Fehler muss durch die Oberflaeche hindurch. Die zwei Proben darueber erreichen nur die
	// fruehe Wache; ein `catch` um den unteren Teil bliebe von ihnen ungesehen.
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena', feature_subtype: 'dorf', on_map: true, properties: {} } };"
		+ "var echterOrtZustandE = avesmapsWikiAssignOrtZustand;"
		+ "avesmapsWikiAssignOrtZustand = function () { throw new Error('BAUER WIRFT'); };", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten), /BAUER WIRFT/,
		"der Orte-Editor schluckt einen Fehler des geteilten Zustandsbauers");
	vm.runInContext("avesmapsWikiAssignOrtZustand = echterOrtZustandE;", e.kasten);
	zaehl();

	console.log("wiki-assign-ort: " + checks + " Zusicherungen erfuellt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
