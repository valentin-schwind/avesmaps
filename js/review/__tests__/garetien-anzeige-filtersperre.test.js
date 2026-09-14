// Aufgabe 5 (Garetien-Importer vereint, 14.09.2026): Suche und Filter WIRKEN auf der Stage.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 7, §7
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-anzeige-filtersperre.test.js
//
// 🔴 DIESE DATEI PRUEFTE BIS ZUM 14.09.2026 DAS GEGENTEIL: RULING R7 sperrte Suchfeld und
// Filterknopf auf dem Reiter „Stage" und schrieb „Suche und Filter wirken hier nicht" daneben.
// Der Owner-Entscheid (Workflow, Usability) hat das umgedreht; der Dateiname bleibt, damit die
// Geschichte an EINER Stelle steht.
// 💣 DIE SPERRE FALLEN ZU LASSEN GENUEGT NICHT (Entwurf §7): gefiltert wurde nur auf dem Server,
// die Stage-Antwort entsteht im Browser (garetienStageAntwortBauen) und las keinen Filter. Ohne
// Filter im Browser waeren Suchfeld und Knopf bedienbar und wirkungslos -- deshalb misst dieser
// Test die gerenderten ZEILEN, nicht nur `disabled`.
// ⚠️ Gefahren wird der ECHTE Weg: der Reiterklick, der `input`-Zuhoerer des Suchfelds und der
// `applyFilter`-Ruf, den avmFilterMenuAttach bekommt -- nie ein direkter Aufruf der Renderfunktion.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

// Der geteilte Trichter (js/ui/filter-menu.js) laeuft unter Node nicht -- seine Attrappe merkt sich
// genau das, was der Importer ihm uebergibt: die Abschnitte und den applyFilter-Ruf.
let angemeldeterFilterRuf = null;
let angemeldeteAbschnitte = null;
global.avmFilterMenuAttach = function (toggleId, menuId, abschnitte, applyFilter) {
	angemeldeteAbschnitte = abschnitte;
	angemeldeterFilterRuf = applyFilter;
	return function () {};
};

const { api, dom, ELEMENTE } = ladeImporter([
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-filter-toggle",
	"garetien-filter-menu", "garetien-anzeige-hinweis", "garetien-neutral-hinweis",
	"garetien-detailcol", "garetien-chips",
]);

const SUCHE = ELEMENTE["garetien-search"];
const FILTER_TOGGLE = ELEMENTE["garetien-filter-toggle"];
const HINWEIS = ELEMENTE["garetien-anzeige-hinweis"];
const TABS = ELEMENTE["garetien-tabs"];

function klickTab(stand) {
	const knopf = { getAttribute: (n) => (n === "data-stand" ? stand : null) };
	const ziel = { closest: (sel) => (sel === ".avm-tab" ? knopf : null) };
	(TABS._hoerer.click || []).forEach((fn) => fn({ target: ziel }));
}
function zeilenSchluessel() {
	const treffer = dom.html("#garetien-list").match(/data-key="[^"]*"/g) || [];
	return treffer.map((t) => t.slice('data-key="'.length, -1)).join(",");
}
function warten(ms) { return new Promise((r) => setTimeout(r, ms)); }

// =================================================================================================
// A. Die REINE Regel -- dieselbe Semantik wie avesmapsGaretienListeObjektPasstFilter (Server).
// =================================================================================================
wahr(typeof api.garetienStageFilterAnwenden === "function", "garetienStageFilterAnwenden fehlt im Export");

const hain1 = { key: "h1", name: "Silker Hain 1", typ: "Wald", ebene: "Waelder", urteil: "neu",
	wiki: "ggp", abschnitte: [], verbund_stamm: "Silker Hain", verbund_n: 2 };
const hain2 = { key: "h2", name: "Silker Hain 2", typ: "Wald", ebene: "Waelder", urteil: "widerspruch",
	wiki: "ggp", abschnitte: [], verbund_stamm: "Silker Hain", verbund_n: 2 };
const heide = { key: "hd", name: "Silker Heide", typ: "Heide", ebene: "Waelder", urteil: "neu",
	wiki: "ggp", abschnitte: [{ public_id: "a" }, { public_id: "b" }] };
const natter = { key: "n", name: "Natter", typ: "Fluss", ebene: "Gewaesser", urteil: "deckt_sich",
	wiki: "kosch", abschnitte: [] };
const alle = [hain1, hain2, heide, natter];
const schluessel = (liste) => liste.map((o) => o.key).join(",");

gleich(schluessel(api.garetienStageFilterAnwenden(alle, {})), "h1,h2,hd,n", "ohne Filter bleibt alles");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { suche: "  HEIDE " })), "hd",
	"Suche: Teiltreffer im Namen, Gross/klein egal, Leerraum getrimmt");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { typ: ["Wald"] })), "h1,h2", "Objekttyp");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { typ: [] })), "h1,h2,hd,n",
	"eine LEERE Liste heisst „kein Filter\", nicht „nichts passt\" -- wie am Server");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { nurVerbuende: true })), "h1,h2",
	"nur Verbuende: verbund_n >= 2");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { ebene: ["Gewaesser"] })), "n",
	"🔴 auch Ebene wirkt -- ein sichtbarer Chip, der nichts tut, waere derselbe Fehler wie die Sperre");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { urteil: ["widerspruch"] })), "h2", "Urteil");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { wiki: ["kosch"] })), "n", "Wiki");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { nur_mehrteilig: true })), "hd", "nur mehrteilig");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { suche: "silker", typ: ["Wald"], nurVerbuende: true })),
	"h1,h2", "die Bedingungen gelten zugleich");

// =================================================================================================
// B. Der echte Weg auf dem Reiter „Stage".
// =================================================================================================
(async function () {
	// Erster Aufbau (Reiter „offen"): das Skelett wird verdrahtet, der Trichter angemeldet.
	api.avesmapsGaretienListeRendern({ objekte: [], reiter: {}, bilanz: {}, gesamt: 0, facetten: {} });
	wahr(typeof angemeldeterFilterRuf === "function", "der Filtertrichter wurde angemeldet");

	api.avesmapsGaretienStageHinzufuegen(alle);
	klickTab("stage");
	gleich(SUCHE.disabled, false, "🔴 auf dem Reiter Stage ist die Suche bedienbar");
	gleich(FILTER_TOGGLE.disabled, false, "und der Filterknopf ebenso");
	gleich(zeilenSchluessel(), "h1,h2,hd,n", "ohne Filter stehen alle vier Stage-Objekte da");
	wahr(!api.garetienListeSkelettMarkup().includes("wirken hier nicht"),
		"der Satz „Suche und Filter wirken hier nicht\" ist gefallen");
	gleich(HINWEIS.hidden, false, "der Hinweis der Stage steht weiter da -- nur ohne den falschen Satz");

	// Die Suche: der ECHTE `input`-Zuhoerer, entprellt.
	SUCHE.value = "hain";
	(SUCHE._hoerer.input || []).forEach((fn) => fn());
	await warten(300);
	gleich(zeilenSchluessel(), "h1,h2", "💣 die Suche WIRKT auf der Stage -- nicht nur bedienbar");
	gleich(api.avesmapsGaretienStageListe().length, 4, "und die Stage selbst bleibt unangetastet");

	// Objekttyp ueber den applyFilter-Ruf des Trichters.
	SUCHE.value = "";
	(SUCHE._hoerer.input || []).forEach((fn) => fn());
	await warten(300);
	api.garetienFilterState.typ.add("Heide");
	angemeldeterFilterRuf();
	gleich(zeilenSchluessel(), "hd", "der Objekttyp-Filter WIRKT auf der Stage");
	api.garetienFilterState.typ.clear();

	// „nur Verbuende": die Option steht im Abschnitt „Nur zeigen" und wirkt.
	const nurAbschnitt = angemeldeteAbschnitte.filter((a) => a.menuId === "garetien-filter-nur-menu")[0];
	const nurOptionen = nurAbschnitt.getOptions();
	wahr(nurOptionen.some((o) => o.value === "verbuende" && o.label === "nur Verbünde"),
		"„nur Verbünde\" steht unter „Nur zeigen\": " + JSON.stringify(nurOptionen));
	api.garetienFilterState.nur.add("verbuende");
	angemeldeterFilterRuf();
	gleich(zeilenSchluessel(), "h1,h2", "„nur Verbünde\" wirkt auf der Stage");
	wahr(api.garetienChipsMarkup(api.garetienFilterState).includes("nur Verbünde"),
		"und der Chip nennt ihn beim Namen");

	// Auf einem Server-Reiter reist er im Rumpf mit -- als `nur_verbuende: 1`.
	let rumpf = null;
	global.fetch = function (adresse, optionen) {
		rumpf = JSON.parse(optionen.body);
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [], reiter: {}, bilanz: {}, facetten: {} }) });
	};
	klickTab("offen");
	await warten(0);
	wahr(rumpf !== null, "der Server-Reiter fragt den Server");
	gleich(rumpf.nur_verbuende, 1, "🔴 der liste-Rumpf traegt `nur_verbuende: 1`");

	// 💣 BESTAND: ein Lauf von vor der Verbund-Erkennung traegt keine Verbund-Felder -- „nur Verbünde"
	// ist dort IMMER leer. Der Editor muss lesen, warum, nicht „Keine Objekte in dieser Ansicht.".
	// Die Antwort oben nennt `verbund_objekte` gar nicht (wie eine Antwort von vor diesem Umbau).
	wahr(dom.html("#garetien-list").includes("In diesem Lauf ist kein Verbund erkannt."),
		"leere „nur Verbünde\"-Liste auf einem Lauf ohne Verbuende sagt, dass erst „Holen & Rechnen\" sie erkennt: "
		+ dom.html("#garetien-list"));
	wahr(dom.html("#garetien-list").includes("Holen &amp; Rechnen"), "und nennt den Knopf beim Namen (escaped)");
	global.fetch = function (adresse, optionen) {
		rumpf = JSON.parse(optionen.body);
		return Promise.resolve({ json: () => Promise.resolve({
			ok: true, objekte: [], reiter: {}, bilanz: {}, facetten: {}, verbund_objekte: 3 }) });
	};
	angemeldeterFilterRuf();
	await warten(0);
	wahr(dom.html("#garetien-list").includes("Kein Verbund in dieser Ansicht"),
		"kennt der Lauf Verbuende, sagt die leere Liste, dass ein Filter oder Reiter sie ausblendet: "
		+ dom.html("#garetien-list"));

	api.garetienFilterState.nur.clear();
	angemeldeterFilterRuf();
	await warten(0);
	wahr(dom.html("#garetien-list").includes("Keine Objekte in dieser Ansicht."),
		"ohne „nur Verbünde\" bleibt der gewohnte Satz");
	gleich(rumpf.nur_verbuende, 0, "ohne den Haken reist `nur_verbuende: 0` -- der Endpunkt liest daraus „kein Filter\"");

	console.log(`garetien-anzeige-filtersperre: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exitCode = 1; });
