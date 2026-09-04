// Aufgabe 12b des Garetien Importers -- das Menueband: die zwei Kacheln, der geltende Lauf und
// der Riegel gegen den zweiten Lauf.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-12b-brief.md
// Mockup:  docs/garetien-importer-mockup.html §1
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-menueband.test.js
//
// 🔴 Der teuerste Teil dieser Aufgabe ist NICHT, dass zwei Knoepfe dastehen, sondern dass ein
// zweiter Klick waehrend des Laufs keinen ZWEITEN Import-Lauf startet -- danach weiss der Abgleich
// nicht mehr, was zusammengehoert, und das ist Datenschaden, kein Anzeigefehler. Diese Zusicherung
// haengt deshalb am ERGEBNIS (wie oft ging `action:'fetch'` wirklich hinaus?), nie an der blossen
// Anwesenheit eines `if` im Quelltext.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}

// Die 18 Ebenen in der Reihenfolge, in der AVESMAPS_GARETIEN_EBENEN sie liefert (gekuerzt auf die,
// die hier gebraucht werden -- die Zahl 18 wird trotzdem echt aus der Liste gezaehlt).
const EBENEN = [
	{ wiki: "ggp", ebene: "Gewaesser" }, { wiki: "ggp", ebene: "Berge" },
	{ wiki: "ggp", ebene: "Grenzen" }, { wiki: "ggp", ebene: "Sonstiges" },
	{ wiki: "ggp", ebene: "Waelder" }, { wiki: "ggp", ebene: "Wege" },
	{ wiki: "ggp", ebene: "Ortschaften_1" }, { wiki: "ggp", ebene: "Ortschaften_2" },
	{ wiki: "ggp", ebene: "Ortschaften_3" }, { wiki: "ggp", ebene: "Ortschaften_4" },
	{ wiki: "ggp", ebene: "Detail_1" }, { wiki: "ggp", ebene: "Detail_2" },
	{ wiki: "kosch", ebene: "Gewaesser" }, { wiki: "kosch", ebene: "Berge" },
	{ wiki: "kosch", ebene: "Grenzen" }, { wiki: "kosch", ebene: "Waelder" },
	{ wiki: "kosch", ebene: "Wege" }, { wiki: "kosch", ebene: "Ortschaften_1" },
];
gleich(EBENEN.length, 18, "die Vorlage muss die 18 Ebenen des Endpunkts abbilden");

// ---- 1. Die DREI Kacheln stehen im Menueband, in der Hausform ----------------------------------
//
// 🔴 DREI SEIT 31.08.2026, nicht mehr zwei (Mockup §1). Der Owner: „die 8000 objekte sind auf
// manchen pcs ein problem. kannst du oben einen dropdown button für alle verfügbar machen".
// ⚠️ Die dritte ist die EINZIGE ohne Admin-Riegel -- sie holt nichts von aussen und rechnet nichts
// neu, sie sagt nur, wie viel dieser Browser zeichnen soll.

wahr(typeof mod.garetienMenuebandMarkup === "function", "garetienMenuebandMarkup fehlt im Export");
const band = mod.garetienMenuebandMarkup();

gleich((band.match(/class="avm-tile[^"]*"/g) || []).length, 3,
	"das Menueband traegt GENAU drei Kacheln");
wahr(band.includes('<span class="t1">Holen &amp; Rechnen</span>'),
	"die erste Kachel heisst wortgleich zum Mockup „Holen & Rechnen\"");
wahr(band.includes('<span class="t1">Ebenen</span>'), "die zweite Kachel heisst „Ebenen\"");
wahr(band.includes('<span class="t1">Angezeigte Zeilen</span>'), "die dritte „Angezeigte Zeilen\"");
// 💣 Sie ist ein `<label>` mit einem nativen `<select>`, KEIN dritter Klappmechanismus: das Band
// traegt schon zwei Rezepturen (Kachel-Knopf und geteilter Trichter), und ein Auswahlfeld in einem
// `<button>` waere ungueltiges Markup -- der Klick oeffnete zwei Dinge zugleich.
wahr(/<label class="avm-tile gi-tile--wahl"/.test(band), "die dritte Kachel ist ein <label>");
wahr(/<select class="gi-zeilen" id="garetien-zeilen">/.test(band), "und traegt ein natives <select>");
// 🔴 ZWEI Zustandszeilen, nicht drei (Owner 31.08.2026: „warum steht da 2x 1000 btw. die dropdown
// reicht"). Bei den ersten beiden Kacheln sagt die `t2`-Zeile etwas, das sonst nirgends steht --
// „Lauf 30.08., 23:18 · 8348 Zeilen" und „18 von 18 · alle". Die dritte hatte sie abgeschrieben
// und wiederholte damit die Auswahl einen Zentimeter unter der Auswahl.
// ⚠️ Der Text der Zusicherung sagte schon vorher „BEIDE Kacheln" und zaehlte drei -- er stammte
// aus der Zeit vor der dritten Kachel und war beim Anbau nicht mitgewandert.
gleich((band.match(/class="t2"/g) || []).length, 2,
	"die zwei Kacheln MIT eigenem Zustand tragen ihre zweite Zeile -- die Auswahl-Kachel nicht");
const dritte = band.slice(band.indexOf("gi-tile--wahl"));
wahr(!/class="t2"/.test(dritte.slice(0, dritte.indexOf("</label>"))),
	"und zwar ist es die dritte, die keine hat: " + dritte.slice(0, dritte.indexOf("</label>")));
wahr(band.includes('id="garetien-run-state"') && band.includes('id="garetien-ebenen-state"'),
	"die zwei Zustandszeilen brauchen je eine Kennung, damit sie sich einzeln schreiben lassen");

// ⚠️ KEIN Sammelmenue: avesmapsRibbonMenuAttach ist das Klappmenue fuer Kacheln, und seine
// Hausregel lautet „nichts unter drei Eintraegen" (AGENTS.md §11). Zwei Kacheln stehen nebeneinander.
wahr(!band.includes("rb-menu"), "zwei Kacheln gehoeren NICHT in ein Sammelmenue");

// Die Klappflaeche ist die Hausform des Trichters und startet zu -- ihr `hidden` ist der GANZE
// Zustand (dieselbe Begruendung wie beim Filtertrichter aus Aufgabe 12).
wahr(band.includes('class="type-filter"'), "die Ebenen-Kachel braucht die .type-filter-Huelle (position: relative)");
wahr(band.includes('class="type-filter__menu"'), "die Klappflaeche muss die Hausklasse tragen");
wahr(/id="garetien-ebenen-menu" hidden/.test(band), "die Klappflaeche startet zu");
wahr(band.includes('id="garetien-ebenen-optionen"'),
	"avmFilterMenuAttach braucht einen eigenen Behaelter fuer seine Optionsliste");

// ---- 2. Die Kachel behaelt ihre zwei Zeilen, wenn der geteilte Trichter sie uebernimmt ----------
//
// 💣 DIE KOPPLUNG, um die es hier geht: avmFilterMenuAttach schreibt sonst bei JEDEM rebuild()
// `toggle.innerHTML = "<Trichtersymbol> Ebenen ▾"` -- und der erste rebuild() laeuft schon beim
// Verdrahten. Ohne `data-avm-eigene-beschriftung` waere die zweizeilige Kachelform beim ersten
// Bild lautlos weg, und der Zustand („2 von 18 · …") stuende nirgends mehr.
// ⭐ Gemessen wird die DIFFERENZ: dasselbe Element einmal MIT und einmal OHNE das Attribut. Eine
// Zusicherung, die nur „mit Attribut bleibt es stehen" prueft, hielte auch dann, wenn
// avmFilterMenuAttach die Beschriftung ueberhaupt nie schriebe.

wahr(/data-avm-eigene-beschriftung/.test(band),
	"die Ebenen-Kachel muss dem geteilten Trichter sagen, dass sie ihre Beschriftung selbst traegt");

function macheElement(id, attribute) {
	return {
		id: id,
		innerHTML: "",
		title: "",
		hidden: true,
		dataset: {},
		_attr: Object.assign({}, attribute || {}),
		hasAttribute: function (name) { return Object.prototype.hasOwnProperty.call(this._attr, name); },
		setAttribute: function (name, wert) { this._attr[name] = wert; },
		addEventListener: function () {},
		contains: function () { return false; },
	};
}

// Der geteilte Trichter ist eine schlichte Skriptdatei ohne Export von avmFilterMenuAttach (nur
// seine REINEN Teile reisen ueber module.exports). Er wird deshalb im Node-Prozess mit einem
// DOM-Ersatz ausgefuehrt -- das ist der Punkt: der echte Code laeuft, nicht seine Beschreibung.
const trichterQuelle = fs.readFileSync(path.resolve(__dirname, "..", "..", "ui", "filter-menu.js"), "utf8");
function trichterVerdrahten(toggle) {
	const panel = macheElement("p");
	panel.hidden = true;
	const optionen = macheElement("o");
	const knoten = { t: toggle, p: panel, o: optionen };
	const dokument = {
		getElementById: function (id) { return knoten[id] || null; },
		addEventListener: function () {},
	};
	const fabrik = new Function("document", trichterQuelle + "\nreturn avmFilterMenuAttach;");
	fabrik(dokument)("t", "p", [{ menuId: "o", kind: "multi", state: new Set(), options: [] }],
		function () {}, "Ebenen");
	return toggle;
}

const KACHEL_INHALT = '<span class="t1">Ebenen</span><span class="t2">2 von 18</span>';

const mitAttribut = macheElement("t", { "data-avm-eigene-beschriftung": "" });
mitAttribut.innerHTML = KACHEL_INHALT;
trichterVerdrahten(mitAttribut);
gleich(mitAttribut.innerHTML, KACHEL_INHALT,
	"mit dem Attribut muss die zweizeilige Kachel den Verdrahten UNVERAENDERT ueberstehen");
gleich(mitAttribut.title, "",
	"ein Wirt mit eigener Beschriftung behaelt auch Titel und aria-label -- seine zweite Zeile "
	+ "(„2 von 18 · …\") IST der bessere Name, und zwei Angaben nebeneinander liefen auseinander");
gleich(mitAttribut.hasAttribute("aria-label"), false);

const ohneAttribut = macheElement("t", {});
ohneAttribut.innerHTML = KACHEL_INHALT;
trichterVerdrahten(ohneAttribut);
wahr(ohneAttribut.innerHTML !== KACHEL_INHALT && ohneAttribut.innerHTML.indexOf('class="t1"') === -1,
	"GEGENPROBE: ohne das Attribut schreibt der Trichter die Beschriftung wie bisher -- die "
	+ "Zusicherung darueber misst also wirklich etwas");

// ---- 3. Die zweite Zeile der Ebenen-Kachel ------------------------------------------------------

wahr(typeof mod.garetienEbenenKachelText === "function", "garetienEbenenKachelText fehlt im Export");
const zweiGewaesser = ["ggp:Gewaesser", "kosch:Gewaesser"];
gleich(mod.garetienEbenenKachelText(zweiGewaesser, EBENEN), "2 von 18 · Gewässer ggp + kosch",
	"die Vorgabe muss wortgleich zum Mockup §1 dastehen");

// Alle 18 -> „alle". Eine Aufzaehlung von 18 Namen in einer 11px-Zeile ist keine Auskunft.
gleich(mod.garetienEbenenKachelText(EBENEN.map(mod.garetienEbenenBezeichner), EBENEN), "18 von 18 · alle");

// Mehrere Ebenen: gruppiert nach EBENE, in der Reihenfolge der Serverliste (nicht der Anklickerei).
gleich(mod.garetienEbenenKachelText(["kosch:Waelder", "ggp:Waelder", "ggp:Berge"], EBENEN),
	"3 von 18 · Berge ggp · Wälder ggp + kosch",
	"gruppiert nach Ebene, und die Reihenfolge ist die der festen Serverliste");

// Solange die Ebenenliste nicht da ist, wird nicht „wird geladen …" behauptet, sondern gesagt, was
// wahr ist -- die Auswahl steht ja schon fest.
gleich(mod.garetienEbenenKachelText(zweiGewaesser, []), "2 gewählt");

// 🔴 LEER HEISST ALLE (Owner 29.08.2026). Hier stand die Gegenregel, und sie war ein
// Fehlentscheid des Auftraggebers: weil der geteilte Trichter mit seinem „Alle\"-Haken die
// Menge LEERT, hiess ein Klick auf „Alle\" in Wahrheit „keine einzige\" -- und der
// Nachbarknopf war danach gesperrt. Alle 18 waren nur durch achtzehn einzelne Haken erreichbar.
gleich(mod.garetienEbenenKachelText([], EBENEN), "18 von 18 · alle",
	"die Kachel muss den leeren Zustand als ALLE benennen -- „0 von 18\" liest sich wie ein toter Knopf");

// Der Ebenen-Schluessel ist eine stabile Kennung, die Beschriftung ist es nicht.
gleich(mod.garetienEbeneLabel("Gewaesser"), "Gewässer");
gleich(mod.garetienEbeneLabel("Waelder"), "Wälder");
gleich(mod.garetienEbeneLabel("Ortschaften_1"), "Ortschaften 1", "der Unterstrich ist Kennung, kein Text");
gleich(mod.garetienEbenenBezeichner({ wiki: "ggp", ebene: "Gewaesser" }), "ggp:Gewaesser",
	"der Bezeichner ist genau die Form, die action:'fetch' entgegennimmt");

// ---- 4. Leer heisst ALLE -- dieselbe Rechnung fuettert Abruf UND Kachel -------------------------

wahr(typeof mod.garetienGewaehlteBezeichner === "function", "garetienGewaehlteBezeichner fehlt im Export");
// 🔴 LEER HEISST ALLE -- die Hausform des geteilten Trichters, ohne Sonderfall.
// ⚠️ Das Tor gegen falsche Objektarten (Wege-Subtyp `Bach`, die fuenf neuen Ortsarten) haengt
// am UEBERNEHMEN, nicht am Holen: Staging und Plan schreiben in keine Nutztabelle.
gleich(mod.garetienGewaehlteBezeichner(new Set(), EBENEN).length, EBENEN.length,
	"eine leere Auswahl holt ALLE -- sonst waere der „Alle\"-Haken des Trichters ein Abwaehlen");
assert.deepStrictEqual(mod.garetienGewaehlteBezeichner(new Set(["kosch:Gewaesser", "ggp:Gewaesser"]), EBENEN),
	["ggp:Gewaesser", "kosch:Gewaesser"],
	"die Reihenfolge ist die der Serverliste, nicht die der Anklickerei");
checks++;
assert.deepStrictEqual(mod.garetienGewaehlteBezeichner(new Set(["ggp:Gewaesser"]), []), ["ggp:Gewaesser"],
	"ohne geladene Ebenenliste gilt die Auswahl unveraendert -- sonst holte ein Klick in dieser Luecke nichts");
checks++;

// 🔴 Die Vorgabe des Moduls ist LEER -- und leer heisst ALLE. Vorher standen hier die zwei
// Gewaesserseiten; das hiess, dass ein Editor jede weitere Ebene einzeln anhaken und erneut
// „Holen & Rechnen\" druecken musste (Owner-Meldung 29.08.2026).
gleich(mod.garetienEbenenAuswahl.size, 0,
	"die Vorgabe ist die leere Menge -- garetienGewaehlteBezeichner macht daraus alle 18");
checks++;

// Im Menue ist Platz fuer die lange Wiki-Form -- und es ist DIESELBE wie im Filtertrichter.
const ebenenOptionen = mod.garetienEbenenOptionenAus(EBENEN);
gleich(ebenenOptionen.length, 18);
gleich(ebenenOptionen[0].value, "ggp:Gewaesser");
gleich(ebenenOptionen[0].label, "Gewässer · garetien.de");

// 🔴 Und der Filtertrichter im selben Fenster beschriftet die Ebene GENAUSO. Zwei Schreibweisen
// fuer denselben Schluessel in EINEM Fenster waeren die Divergenz, vor der AGENTS.md §11 warnt.
// Gemessen am ERGEBNIS der Abschnitts-Optionen, nicht am Quelltext.
mod.avesmapsGaretienFilterFacettenAktualisieren({ ebene: { Gewaesser: 289 }, typ: {}, urteil: {}, wiki: {} });
const ebeneAbschnitt = mod.garetienFilterSections().filter((a) => a.menuId === "garetien-filter-ebene-menu")[0];
wahr(!!ebeneAbschnitt, "der Ebene-Abschnitt des Trichters fehlt");
gleich(ebeneAbschnitt.getOptions()[0].label, "Gewässer",
	"Trichter und Kachel muessen dieselbe Ebenen-Beschriftung tragen");
gleich(ebeneAbschnitt.getOptions()[0].value, "Gewaesser",
	"der WERT bleibt der stabile Schluessel -- nur die Beschriftung wird lesbar gemacht");

// ---- 5. Die zweite Zeile der Lauf-Kachel --------------------------------------------------------

wahr(typeof mod.garetienLaufKachelText === "function", "garetienLaufKachelText fehlt im Export");
const LAUF = { id: 7, started_at: "2026-08-27 11:58:02", finished_at: "2026-08-27 12:04:11", zeilen: 289 };

gleich(mod.garetienLaufStempel(LAUF), "27.08., 12:04", "der Stempel ist der des Mockups");
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350 }), "Lauf 27.08., 12:04 · 0,35 s",
	"direkt nach einem eigenen Lauf steht die GEMESSENE Rechendauer da (Mockup §1)");
gleich(mod.garetienLaufKachelText({ lauf: LAUF }), "Lauf 27.08., 12:04 · 289 Zeilen",
	"fuer einen aelteren Lauf liefert action:'runs' KEINE Rechendauer -- dann steht seine "
	+ "Zeilenzahl da, nicht eine erfundene Sekundenzahl");
gleich(mod.garetienLaufKachelText({ lauf: null }), "noch kein Lauf");
gleich(mod.garetienLaufKachelText({ laeuft: true, schritt: "holt 2 Ebenen …", lauf: LAUF }), "holt 2 Ebenen …",
	"waehrend es laeuft, gehoert der Fortschritt in die zweite Zeile (dieselbe Form wie „Kurven rechnet …\")");
gleich(mod.garetienLaufKachelText({ meldung: "Netzwerkfehler", lauf: LAUF }), "Netzwerkfehler",
	"ein harter Fehler bleibt bis zum naechsten Versuch stehen");
gleich(mod.garetienLaufKachelText({ ohneEbenen: true, lauf: LAUF }), "keine Ebene gewählt",
	"der Grund der Sperre steht IN der Kachel -- sonst waere der graue Knopf eine Stilllegung");
// 🔴 Und er schlaegt eine stehengebliebene Fehlermeldung: die berichtet vom LETZTEN Versuch,
// die Sperre gilt JETZT und sagt, was zu tun ist.
gleich(mod.garetienLaufKachelText({ ohneEbenen: true, meldung: "Netzwerkfehler", lauf: LAUF }),
	"keine Ebene gewählt", "der Grund der Sperre schlaegt die alte Fehlermeldung");
// ⚠️ Aber NICHT den laufenden Fortschritt (der Fall kann nicht eintreten, und die Reihenfolge
// soll auch dann stimmen, wenn ihn jemand herbeifuehrt).
gleich(mod.garetienLaufKachelText({ laeuft: true, schritt: "rechnet …", ohneEbenen: true }), "rechnet …");
gleich(mod.garetienLaufKachelText({ lauf: LAUF, fehler: [{ ebene: "kosch:Wege" }] }),
	"Lauf 27.08., 12:04 · 289 Zeilen · 1 Ebene ohne Antwort",
	"eine Ebene ohne Antwort bricht den Lauf nicht ab, muss aber dastehen");
gleich(mod.garetienLaufKachelText({ lauf: LAUF, fehler: [{}, {}] }),
	"Lauf 27.08., 12:04 · 289 Zeilen · 2 Ebenen ohne Antwort");
// Ein unfertiger Lauf hat kein finished_at -- dann gilt sein Beginn, statt „unbekannt" zu melden.
gleich(mod.garetienLaufStempel({ started_at: "2026-08-27 11:58:02", finished_at: null }), "27.08., 11:58");

// ---- 5c. Die Aufraeumung alter Import-Laeufe (04.09.2026) ---------------------------------------
//
// 🔴 Anlass: das Import-Staging kannte nur INSERT/UPDATE, jedes „Holen & Rechnen" legte einen
// vollstaendigen weiteren Lauf daneben -- gemessen 99.280 Zeilen bei 8.348 je Lauf. Seither raeumt
// der `plan`-Zweig auf und MELDET es: eine stille Loeschung ist von „nichts passiert" nicht zu
// unterscheiden (dieselbe Regel wie beim Artikelquellen-Nachzug im selben Endpunktzweig).
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350, aufgeraeumt: { laeufe: 3, zeilen: 25044, waisen: 0, offen: 0 } }),
	"Lauf 27.08., 12:04 · 0,35 s · 3 alte Läufe weg",
	"was weggeraeumt wurde, steht in der Kachel");
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350, aufgeraeumt: { laeufe: 1, zeilen: 8348, waisen: 0, offen: 0 } }),
	"Lauf 27.08., 12:04 · 0,35 s · 1 alter Lauf weg");
// 🔴 DER NORMALFALL SCHWEIGT. Nach dem ersten Aufraeumen ist bei jedem weiteren Lauf genau EINER
// faellig -- stuende dort dauerhaft „0 alte Laeufe weg", waere die Kachel um eine Zeile laenger,
// die nie etwas sagt.
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350, aufgeraeumt: { laeufe: 0, zeilen: 0, waisen: 0, offen: 0 } }),
	"Lauf 27.08., 12:04 · 0,35 s", "nichts aufgeraeumt heisst: nichts dazuschreiben");
// ⚠️ Der Deckel stueckelt (der erste scharfe Lauf hat rund elf faellige) -- bliebe der Rest
// unerwaehnt, wunderte sich der Owner, warum die Tabelle noch gross ist.
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350, aufgeraeumt: { laeufe: 3, zeilen: 25044, waisen: 0, offen: 4 } }),
	"Lauf 27.08., 12:04 · 0,35 s · 3 alte Läufe weg, 4 offen",
	"was der Deckel liegen liess, wird genannt");
// 💣 `null` ist der FEHLSCHLAG und muss von der ehrlichen 0 unterscheidbar bleiben: der Endpunkt
// faengt den Abbruch, damit er den fertigen Plan nicht kippt -- verschwiege die Kachel ihn, sae he
// ein dauerhaft scheiterndes Aufraeumen genauso aus wie „es war nichts zu tun".
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350, aufgeraeumt: null }),
	"Lauf 27.08., 12:04 · 0,35 s · Aufräumen fehlgeschlagen");
// ⚠️ Und ein Lauf VOR dieser Aenderung (oder ein aelterer aus `action:'runs'`) nennt das Feld gar
// nicht -- `undefined` schweigt wie die 0, es ist keine Aussage.
gleich(mod.garetienLaufKachelText({ lauf: LAUF, dauerMs: 350 }), "Lauf 27.08., 12:04 · 0,35 s",
	"ein fehlendes Feld ist kein Fehlschlag");
// Die Reihenfolge: erst was den LAUF betrifft (Ebenen ohne Antwort), dann die Nebenarbeit.
gleich(mod.garetienLaufKachelText({ lauf: LAUF, fehler: [{}], aufgeraeumt: { laeufe: 2, zeilen: 9, waisen: 0, offen: 0 } }),
	"Lauf 27.08., 12:04 · 289 Zeilen · 1 Ebene ohne Antwort · 2 alte Läufe weg");

// ---- 5b. Fuenf-Punkte-Brief 30.08.2026, Punkt 2: „Holen & Rechnen"/„Ebenen" bleiben admin-only --

wahr(typeof mod.avesmapsGaretienDarfAdminHandlung === "function",
	"avesmapsGaretienDarfAdminHandlung fehlt im Export");
// 🔴 Faellt GESCHLOSSEN aus, wie avesmapsGaretienDarfOeffnen -- nur echtes `true` zaehlt (eine als
// JSON geparste Fehlerseite, eine 1 statt true, ein Proxy mit "0" sind alle truthy).
gleich(mod.avesmapsGaretienDarfAdminHandlung({ capabilities: { admin: true } }), true);
gleich(mod.avesmapsGaretienDarfAdminHandlung({ capabilities: { admin: 1 } }), false,
	"eine 1 statt `true` darf nicht durchrutschen");
gleich(mod.avesmapsGaretienDarfAdminHandlung({ capabilities: { admin: "1" } }), false);
gleich(mod.avesmapsGaretienDarfAdminHandlung({ capabilities: { edit: true } }), false,
	"'edit' allein genuegt NICHT -- genau das ist der Sinn dieser Aufgabe: das Fenster darf kuenftig "
	+ "fuer Editoren aufgehen, ohne dass diese zwei Kacheln mitaufgehen");
gleich(mod.avesmapsGaretienDarfAdminHandlung(null), false);
gleich(mod.avesmapsGaretienDarfAdminHandlung(undefined), false);

// Der Admin-Riegel schlaegt JEDE andere Auskunft der Lauf-Kachel -- unabhaengig davon, ob Ebenen
// gewaehlt sind oder ein Lauf gerade laeuft.
gleich(mod.garetienLaufKachelText({ keinAdmin: true, lauf: LAUF, dauerMs: 350 }), "nur Administratoren",
	"der Admin-Riegel schlaegt einen bestehenden Lauf");
gleich(mod.garetienLaufKachelText({ keinAdmin: true, laeuft: true, schritt: "holt 2 Ebenen …" }),
	"nur Administratoren", "und auch den laufenden Fortschritt (der Fall kann nicht eintreten, aber "
	+ "die Reihenfolge soll stimmen, falls doch)");
gleich(mod.garetienLaufKachelText({ keinAdmin: true, ohneEbenen: true }), "nur Administratoren",
	"und die fehlende Ebenenauswahl");
gleich(mod.garetienLaufKachelText({ keinAdmin: false, lauf: LAUF, dauerMs: 350 }),
	"Lauf 27.08., 12:04 · 0,35 s", "DIE DIFFERENZ: `keinAdmin: false` aendert nichts an der bisherigen Kette");

wahr(typeof mod.garetienEbenenKachelZustand === "function", "garetienEbenenKachelZustand fehlt im Export");
assert.deepStrictEqual(mod.garetienEbenenKachelZustand(false, zweiGewaesser, EBENEN),
	{ text: "nur Administratoren", disabled: true }, "ohne Admin ist die Kachel gesperrt");
checks++;
assert.deepStrictEqual(mod.garetienEbenenKachelZustand(true, zweiGewaesser, EBENEN),
	{ text: "2 von 18 · Gewässer ggp + kosch", disabled: false },
	"DIE DIFFERENZ: mit Admin steht die gewohnte Zeile da, bedienbar");
checks++;

// ---- 6. Beim Oeffnen gilt der juengste Lauf -- und ohne Lauf geht KEINE Listenanfrage hinaus ----

function spion(antworten) {
	const rufe = [];
	const fn = function (pfad, rumpf) {
		rufe.push(rumpf);
		const antwort = antworten[rumpf.action];
		if (typeof antwort === "function") { return antwort(rumpf); }
		if (antwort === undefined) { return Promise.reject(new Error("unerwartete Aktion " + rumpf.action)); }
		return Promise.resolve(antwort);
	};
	fn.rufe = rufe;
	fn.zaehle = function (action) {
		return rufe.filter(function (r) { return r.action === action; }).length;
	};
	return fn;
}

const LAEUFE = [
	{ id: 9, started_at: "2026-08-27 12:00:00", finished_at: "2026-08-27 12:04:11", status: "done", zeilen: 289 },
	{ id: 8, started_at: "2026-08-26 09:00:00", finished_at: "2026-08-26 09:03:00", status: "done", zeilen: 41 },
];

const mitLauf = spion({ runs: { ok: true, runs: LAEUFE } });
let listeGeholt = 0;
mod.garetienFensterFuellen(mitLauf, function () { listeGeholt++; return Promise.resolve({ ok: true }); })
	.then(function () {
		// 🔴 `runs` kommt absteigend nach id -- runs[0] IST der juengste, ohne eine zweite Sortierung.
		gleich(mod.avesmapsGaretienFensterZustand().importRunId, 9,
			"der juengste Lauf wird beim Oeffnen uebernommen");
		gleich(listeGeholt, 1, "mit einem Lauf wird die Liste genau einmal geholt");

		const ohneLauf = spion({ runs: { ok: true, runs: [] } });
		let listeOhne = 0;
		return mod.garetienFensterFuellen(ohneLauf, function () { listeOhne++; return Promise.resolve({}); })
			.then(function () {
				gleich(mod.avesmapsGaretienFensterZustand().importRunId, null,
					"ohne Lauf bleibt importRunId null");
				// 💣 Der eigentliche Befund von Aufgabe 12b: bis hierher lief JEDES Oeffnen in eine
				// 400 `no_run`. Eine 400 im Netz-Protokoll ist kein leerer Zustand, sie sieht wie
				// ein Defekt aus.
				gleich(listeOhne, 0, "ohne Lauf darf action:'liste' GAR NICHT erst gerufen werden");
				gleich(ohneLauf.zaehle("liste"), 0, "und auch nicht ueber einen anderen Weg");
			});
	})
	.then(leereAuswahlProbe)
	.then(riegelProbe)
	.then(function () {
		console.log(`garetien-menueband: ${checks} Pruefungen bestanden.`);
	})
	.catch(function (fehler) {
		console.error(fehler && fehler.stack ? fehler.stack : fehler);
		process.exitCode = 1;
	});

// ---- 6b. Der zweite Riegel: OHNE gewaehlte Ebene wird NICHTS geholt ---------------------------
//
// 🔴 Owner-Entscheid 28.08.2026. Gemessen am ERGEBNIS: es geht KEIN `action:'fetch'` hinaus.
// Der Riegel sitzt in garetienLaufStarten, nicht nur am `disabled` des Knopfes -- `disabled` ist
// die Anzeige, und der Endpunkt beantwortete eine leere Liste sonst mit 400 `no_layers`.
function leereAuswahlProbe() {
	const leer = spion({
		fetch: { ok: true, run_id: 99, gestaget: [], fehler: [] },
		plan: { ok: true, plan_run_id: 99 },
		runs: { ok: true, runs: LAEUFE },
	});
	let gemalt = 0;
	return mod.garetienLaufStarten(leer, [], function () { gemalt++; }, function () {
		throw new Error("ohne Ebene darf auch die Liste nicht geholt werden");
	}).then(function (ergebnis) {
		gleich(leer.zaehle("fetch"), 0, "ohne gewaehlte Ebene geht KEIN action:'fetch' hinaus");
		gleich(leer.rufe.length, 0, "und ueberhaupt kein Ruf");
		gleich(ergebnis, null);
		wahr(gemalt > 0, "die Kachel wird trotzdem neu geschrieben -- sie muss den Grund nennen");
		// ⚠️ Er nimmt den Doppelklick-Riegel NICHT: es gibt nichts freizugeben. Ohne diese
		// Gegenprobe waere ein Riegel, der den Lauf danach fuer immer blockiert, gruen.
		const danach = spion({
			fetch: { ok: true, run_id: 9, gestaget: [], fehler: [] },
			plan: { ok: true, plan_run_id: 5 },
			runs: { ok: true, runs: LAEUFE },
		});
		return mod.garetienLaufStarten(danach, ["ggp:Gewaesser"], function () {}, function () {
			return Promise.resolve({});
		}).then(function () {
			gleich(danach.zaehle("fetch"), 1,
				"nach einem abgelehnten leeren Lauf muss ein gefuellter sofort gehen");
		});
	});
}

// ---- 7. DER RIEGEL: zwei Klicks waehrend des Laufs -> EIN Import-Lauf ---------------------------
//
// 💣 Gemessen am ERGEBNIS: wie oft ging `action:'fetch'` wirklich hinaus? Ein `fetch` haelt bis zu
// 18 fremde Seiten samt Hoeflichkeitspause auf, `plan` rechnet 0,35 s je 289 Zeilen -- ein zweiter
// Lauf daneben laesst den Abgleich nicht mehr wissen, was zusammengehoert.
// ⭐ Gegenprobe von Hand gefahren (Bericht): mit herausgenommenem Riegel zaehlt derselbe Spion 2.
function riegelProbe() {
	// ⚠️ SEIT DEM REIHUM-ABRUF (29.08.2026) haengt nicht EIN `fetch`, sondern je Ebene einer --
	// und der zweite startet erst, wenn der erste aufgeloest ist. Die Probe sammelt deshalb die
	// Aufloeser und gibt sie der Reihe nach frei.
	const wartende = [];
	// ⚠️ Die Laufliste traegt hier einen FREMDEN, juengeren Lauf an erster Stelle -- ein zweiter
	// Admin kann waehrend eines Abrufs ueber 18 Seiten einen anlegen. Uebernommen werden muss
	// trotzdem der eigene (id 9): sonst zeigte die Liste hinterher einen anderen Import an als den,
	// den dieser Klick gerechnet hat. Ohne diesen fremden Lauf in der Vorlage waere die Suche nach
	// der eigenen id eine Zusicherung ueber einen Zweig, den die Vorlage nie erreicht.
	const FREMDER = { id: 12, started_at: "2026-08-27 12:05:00", finished_at: "2026-08-27 12:05:30", status: "done", zeilen: 3 };
	const langsam = spion({
		fetch: function () { return new Promise(function (aufloesen) { wartende.push(aufloesen); }); },
		plan: { ok: true, plan_run_id: 5, vorschlaege: 199 },
		runs: { ok: true, runs: [FREMDER].concat(LAEUFE) },
	});
	let listeGeholtImLauf = 0;
	const listeHolen = function () { listeGeholtImLauf++; return Promise.resolve({ ok: true }); };
	const malen = function () {};

	const ersterKlick = mod.garetienLaufStarten(langsam, ["ggp:Gewaesser", "kosch:Gewaesser"], malen, listeHolen);
	// Der zweite Klick faellt mitten in den laufenden Abruf -- genau der Doppelklick, um den es geht.
	const zweiterKlick = mod.garetienLaufStarten(langsam, ["ggp:Gewaesser", "kosch:Gewaesser"], malen, listeHolen);

	// 💣 Gemessen wird NACH einem Tick: der erste Ruf geht seit dem Reihum-Abruf aus einem `.then`
	// hinaus, ist also nicht mehr synchron da. Die Aussage bleibt dieselbe -- zwei Klicks, EIN Ruf.
	const pumpe = function () { return new Promise(function (a) { setTimeout(a, 0); }); };
	return pumpe().then(function () {
		gleich(langsam.zaehle("fetch"), 1,
			"ZWEI Klicks waehrend des Laufs duerfen GENAU EINEN action:'fetch' ausloesen");
		// Jetzt die Ebenen der Reihe nach freigeben, bis der Lauf durch ist.
		const weiter = function (rest) {
			if (rest <= 0) { return Promise.resolve(); }
			while (wartende.length) {
				wartende.shift()({ ok: true, run_id: 9, gestaget: [{ wiki: "ggp", ebene: "Gewaesser", zeilen: 246 }], fehler: [] });
			}
			return pumpe().then(function () { return weiter(rest - 1); });
		};
		return weiter(8);
	}).then(function () {
		return Promise.all([ersterKlick, zweiterKlick]);
	}).then(function () {
		gleich(langsam.zaehle("fetch"), 2,
			"zwei gewaehlte Ebenen ergeben ZWEI Abrufe -- aber nur EINEN Lauf, siehe die run_id unten");
		gleich(langsam.zaehle("plan"), 1, "und bei EINEM Rechenlauf");
		gleich(listeGeholtImLauf, 1, "die Liste wird nach dem Lauf genau einmal neu geholt");
		gleich(mod.avesmapsGaretienFensterZustand().importRunId, 9,
			"der EIGENE Lauf wird uebernommen, nicht der juengste fremde -- sonst zeigte die Liste "
			+ "einen anderen Import als den gerade gerechneten");
		gleich(mod.avesmapsGaretienFensterZustand().planRunId, 5);
		// 🔴 KEIN run_id an `fetch`: der Endpunkt SETZT einen genannten Lauf fort, ein neues
		// „Holen & Rechnen" ist ein neuer Lauf. Sonst waechst der alte weiter und der Abgleich
		// mischt zwei Importe.
		// 🔴 EINE EBENE JE ANFRAGE (Owner 29.08.2026). Der Abrufer haelt eine Sekunde Pause je
		// Seite -- alle 18 in EINEM Ruf waeren ueber 18 s und liefen auf STRATO in
		// `max_execution_time`. Es bleibt trotzdem EIN Lauf: der ERSTE Ruf nennt keinen,
		// jeder weitere nennt den zurueckgegebenen.
		const fetchRufe = langsam.rufe.filter(function (r) { return r.action === "fetch"; });
		gleich(fetchRufe.length, 2, "zwei gewaehlte Ebenen ergeben ZWEI Abrufe, nicht einen");
		gleich(fetchRufe[0].run_id, undefined, "der erste Ruf legt den Lauf an und nennt keinen");
		assert.deepStrictEqual(fetchRufe.map(function (r) { return r.ebenen; }),
			[["ggp:Gewaesser"], ["kosch:Gewaesser"]],
			"jeder Ruf traegt GENAU EINE Ebene, in der Reihenfolge der Serverliste");
		wahr(fetchRufe[1].run_id > 0,
			"der zweite Ruf SETZT den Lauf fort -- ohne `run_id` waeren aus 18 Seiten 18 Laeufe, "
			+ "und der Abgleich wuesste nicht mehr, was zusammengehoert");
		checks++;

		// 🔴 Und der Riegel geht wieder auf: der naechste Klick muss laufen. Ohne diese Zusicherung
		// waere ein Riegel, der fuer immer schliesst, gruen -- und ein toter Knopf ist schlimmer
		// als ein doppelter Lauf.
		const danach = spion({
			fetch: { ok: true, run_id: 10, gestaget: [], fehler: [] },
			plan: { ok: true, plan_run_id: 6 },
			runs: { ok: true, runs: LAEUFE },
		});
		return mod.garetienLaufStarten(danach, ["ggp:Berge"], malen, listeHolen).then(function () {
			gleich(danach.zaehle("fetch"), 1, "nach einem beendeten Lauf laesst sich wieder starten");
			return riegelNachFehlerProbe();
		});
	});
}

// Und derselbe Riegel nach einem FEHLGESCHLAGENEN Lauf -- `finally`, nicht `then`.
function riegelNachFehlerProbe() {
	const kaputt = spion({ fetch: function () { return Promise.reject(new Error("Netz weg")); } });
	return mod.garetienLaufStarten(kaputt, ["ggp:Berge"], function () {}, function () {
		throw new Error("nach einem Fehlschlag darf die Liste nicht geholt werden");
	}).then(function () {
		const wieder = spion({
			fetch: { ok: true, run_id: 11, gestaget: [], fehler: [] },
			plan: { ok: true, plan_run_id: 7 },
			runs: { ok: true, runs: LAEUFE },
		});
		return mod.garetienLaufStarten(wieder, ["ggp:Berge"], function () {}, function () {
			return Promise.resolve({});
		}).then(function () {
			gleich(wieder.zaehle("fetch"), 1,
				"nach einem Netzfehler muss der Knopf wieder gehen -- ein fuer immer toter Knopf "
				+ "ist schlimmer als ein doppelter Lauf");
		});
	});
}
