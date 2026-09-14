// Liste und Leisten (Bauplan 2026-09-14, Aufgabe 12; Entwurf §7, Mockup §2 bis §4 und §7).
//
// 🔴 GEMESSEN AM ABLAUF: die Liste wird ueber die echte Tuer gezeichnet (avesmapsGaretienListeHolen),
// das Skelett dabei wirklich verdrahtet, und das Haekchen „alle n" ueber seinen echten `change`-Zuhoerer
// geschaltet. Eine Zusicherung, die nur `includes("garetien-alle")` am Quelltext fragte, bliebe gruen,
// wenn niemand den Zuhoerer anmeldet.
// 🔴 BESTAND (Owner 14.09.2026): „alle n" waehlt auf „Übernommen" und „Abgelehnt" genau das, was
// „Alle wählen" dort gewaehlt hat -- gemessen mit Objekten eines Laufs OHNE verbund-Felder.
//
// Ausführen: node js/review/__tests__/garetien-listkopf.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const { api, dom, ELEMENTE } = ladeImporter([
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-chips", "garetien-neutral-hinweis",
	"garetien-anzeige-hinweis", "garetien-detailcol", "garetien-auswahlleiste", "garetien-apply",
	"garetien-apply-hint", "garetien-zentrieren-alle", "garetien-anzeige-clear", "garetien-filter-toggle",
	"garetien-filter-menu", "garetien-alle", "garetien-alle-text", "garetien-alle-zahl",
]);
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function objekt(name, extra) {
	return Object.assign({
		key: "ggp:Waelder:Wald:Garetien:" + name + "!" + name, name: name, typ: "Wald", ebene: "Waelder",
		stand: "offen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		grund: "nichts in 2 Meilen", abschnitte: [], items: [{ id: 1, change_type: "new", anlass: "" }],
	}, extra || {});
}
// Die Liste ueber die echte Tuer -- `zustand.objekte` hat keinen Setter (Vorbild garetien-verbund-klick).
async function holen(stand, objekte, reiter) {
	api.garetienReiterSetzen(stand);
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({
			ok: true, objekte: objekte, plan_run_id: 7, reiter: reiter || {},
		}) });
	};
	try { await api.avesmapsGaretienListeHolen(); } finally { global.fetch = echterFetch; }
}
// Ein Klick, wie ihn der Browser zustellt: erst `checked`, dann `change`.
function schalte(an) {
	const haken = ELEMENTE["garetien-alle"];
	haken.checked = an;
	(haken._hoerer.change || []).forEach(function (fn) { fn({ target: haken }); });
}
function zeileVon(html, o) {
	const i = html.indexOf('data-key="' + esc(o.key) + '"');
	const j = html.indexOf('<div class="avm-row"', i + 1);
	return i === -1 ? "" : html.slice(i, j === -1 ? html.length : j);
}

(async function () {
	// ---- 1. Das Skelett: der Listenkopf steht zwischen Suche und Liste, „Alle wählen" nirgends mehr ----
	const skelett = api.garetienListeSkelettMarkup();
	const iKopf = skelett.indexOf('<div class="gi-listkopf" id="garetien-listkopf">');
	pruefe(iKopf !== -1, "der Listenkopf steht im Skelett");
	pruefe(skelett.indexOf('<input type="checkbox" id="garetien-alle"') > iKopf, "mit dem Haekchen „alle n\"");
	pruefe(iKopf > skelett.indexOf('class="gi-searchrow"') && iKopf < skelett.indexOf('id="garetien-list"'),
		"zwischen Suche und Liste");
	const html = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
	pruefe(!html.includes('id="garetien-mark-all"'), "💣 der Knopf „Alle wählen\" ist aus der Fussleiste gefallen");
	const quelle = fs.readFileSync(path.join(WURZEL, "js/review/review-garetien-importer.js"), "utf8");
	pruefe(!quelle.includes('getElementById("garetien-mark-all")'), "und niemand sucht ihn mehr");

	// ---- 2. Der Stand des Haekchens -----------------------------------------------------------------------
	const a = objekt("Silker Heide");
	const b = objekt("Silker Hain 3");
	const c = objekt("Weidicht");
	const keins = api.garetienAlleWaehlenZustand([a, b], "offen", () => false);
	gleich(keins.beschriftung, "alle 2", "die Beschriftung traegt die Zahl der Zeilen");
	gleich(keins.alleGewaehlt || keins.teilweise, false, "nichts gewaehlt: weder gesetzt noch halb");
	const halb = api.garetienAlleWaehlenZustand([a, b], "offen", (k) => k === a.key);
	gleich(halb.teilweise && !halb.alleGewaehlt, true, "eine von zwei: halb");
	const voll = api.garetienAlleWaehlenZustand([a, b], "offen", () => true);
	gleich(voll.alleGewaehlt && !voll.teilweise, true, "beide: gesetzt");
	gleich(api.garetienAlleWaehlenZustand([], "stage").gesperrt, true, "eine leere Liste sperrt");
	gleich(api.garetienAlleWaehlenZustand([a], "stage").gesperrt, false, "auf der Stage nicht gesperrt (Owner-Punkt 18)");

	// ---- 3. Die Zahl --------------------------------------------------------------------------------------
	gleich(api.garetienListkopfZahlText(5, 8237, "offen"), "5 von 8237", "Server-Reiter: n von m");
	gleich(api.garetienListkopfZahlText(3, 0, "abgelehnt"), "3 von 3", "ohne Reiterzahl nie „3 von 0\"");
	gleich(api.garetienListkopfZahlText(5, 5, "stage", 2), "5 auf der Stage · 2 Objekte", "Stage: Zeilen und Objekte");
	gleich(api.garetienListkopfZahlText(3, 5, "stage", 1), "3 von 5 auf der Stage · 1 Objekt", "gefilterte Stage");
	gleich(api.garetienListkopfZahlText(0, 0, "offen"), "", "ohne Zeilen keine Zahl");

	// ---- 4. Die Ziel-Marke --------------------------------------------------------------------------------
	gleich(api.garetienZeileZielMarke(a, "stage", true), api.garetienStageZeile2(a, true),
		"auf der Stage traegt die Zeile den Text von garetienStageZeile2");
	gleich(api.garetienZeileZielMarke(a, "offen", true), "auf der Stage", "auf „Offen\": liegt es dort?");
	gleich(api.garetienZeileZielMarke(a, "offen", false), "", "…und sonst nichts");
	gleich(api.garetienZeileZielMarke(a, "uebernommen", true) + api.garetienZeileZielMarke(a, "abgelehnt", true), "",
		"auf „Übernommen\" und „Abgelehnt\" keine Marke");
	const zeile = api.garetienZeileMarkup(a, false, "als <Fläche>");
	pruefe(zeile.includes('<span class="avm-row__l2"><span class="gi-ziel-marke">als &lt;Fläche&gt;</span> · <span class="u '),
		"die Marke steht VORN in der zweiten Zeile, escaped: " + zeile);
	pruefe(!api.garetienZeileMarkup(a, false).includes("gi-ziel-marke"), "ohne Marke keine leere Huelle");

	// ---- 5. ABLAUF auf der Stage ----------------------------------------------------------------------------
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([a, b]);
	await holen("stage", []);
	pruefe(zeileVon(dom.html("#garetien-list"), a)
		.includes('<span class="gi-ziel-marke">' + esc(api.garetienStageZeile2(a, true)) + "</span>"),
		"auf der Stage traegt jede Zeile ihr Ziel: " + dom.html("#garetien-list"));
	gleich(dom.text("#garetien-alle-text"), "alle 2", "der Listenkopf zaehlt die Zeilen");
	gleich(dom.text("#garetien-alle-zahl"), "2 auf der Stage · 2 Objekte", "…und die Objekte");
	const haken = ELEMENTE["garetien-alle"];
	gleich((haken._hoerer.change || []).length, 1,
		"💣 genau EIN change-Zuhoerer -- ein zweiter naehme im selben Klick zurueck, was der erste tat");
	gleich(haken.checked === true || haken.disabled === true, false, "vor dem Klick: frei und nicht gesetzt");
	api.avesmapsGaretienAuswahlUmschalten("ggp:fremd!fremd", null);
	schalte(true);
	pruefe(api.avesmapsGaretienAuswahlHat(a.key) && api.avesmapsGaretienAuswahlHat(b.key), "„alle 2\" waehlt beide");
	gleich(haken.checked && !haken.indeterminate, true, "…und steht danach gesetzt");
	api.avesmapsGaretienAuswahlUmschalten(b.key);
	gleich(!haken.checked && haken.indeterminate, true,
		"ein einzelner Zeilenhaken nimmt den Listenkopf mit auf „teilweise\" (garetienAuswahlleisteAuffrischen)");
	schalte(false);
	pruefe(!api.avesmapsGaretienAuswahlHat(a.key) && !api.avesmapsGaretienAuswahlHat(b.key),
		"abgewaehlt werden die Zeilen dieser Liste");
	pruefe(api.avesmapsGaretienAuswahlHat("ggp:fremd!fremd"), "⚠️ …und nur sie: was die Liste nicht zeigt, bleibt gewaehlt");

	// ---- 6. ABLAUF auf „Offen": die Marke „auf der Stage" und „n von m" --------------------------------------
	await holen("offen", [a, c], { offen: 57 });
	pruefe(zeileVon(dom.html("#garetien-list"), a).includes('<span class="gi-ziel-marke">auf der Stage</span>'),
		"die Zeile auf „Offen\" sagt, dass sie auf der Stage liegt");
	pruefe(!zeileVon(dom.html("#garetien-list"), c).includes("gi-ziel-marke"), "…eine andere nicht");
	gleich(dom.text("#garetien-alle-zahl"), "2 von 57", "n von m");

	// ---- 7. BESTAND: auf „Übernommen" und „Abgelehnt" waehlt „alle n", was „Alle wählen" dort waehlte ----
	const bestand = [
		["uebernommen", [objekt("Dunkelforst", { stand: "uebernommen" }), objekt("Eichengrund", { stand: "uebernommen" })]],
		["abgelehnt", [objekt("Moosgrund", { stand: "abgelehnt" })]],
	];
	for (const [stand, liste] of bestand) {
		await holen(stand, liste, { [stand]: liste.length });
		api.avesmapsGaretienAuswahlAufheben();
		api.avesmapsGaretienAlleWaehlen(liste);
		const messlatte = liste.filter((o) => api.avesmapsGaretienAuswahlHat(o.key)).map((o) => o.key).join("|");
		api.avesmapsGaretienAuswahlAufheben();
		schalte(true);
		gleich(liste.filter((o) => api.avesmapsGaretienAuswahlHat(o.key)).map((o) => o.key).join("|"), messlatte,
			"auf „" + stand + "\" waehlt „alle n\" dieselbe Menge wie avesmapsGaretienAlleWaehlen");
		gleich(dom.text("#garetien-alle-zahl"), liste.length + " von " + liste.length, "Zahl auf „" + stand + "\"");
		pruefe(!dom.html("#garetien-list").includes("gi-ziel-marke"), "keine Ziel-Marke auf „" + stand + "\"");
	}

	// ---- 8. Das CSS ---------------------------------------------------------------------------------------
	const css = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	pruefe(/\.gi-listkopf\s*\{[^}]*border-bottom:\s*1px solid var\(--color-divider\)/.test(css),
		"der Listenkopf setzt sich mit der Trennlinie ab, nicht mit einem Rahmen");
	pruefe(/\.gi-ziel-marke\s*\{[^}]*color:\s*var\(--color-accent-brown\)/.test(css), "die Marke traegt den Akzent");
	pruefe(/\.gi-listkopf input\[type="checkbox"\]\s*\{[^}]*width:\s*14px/.test(css),
		"das Haekchen traegt die Masse der Zeilenhaekchen");

	console.log("OK -- garetien-listkopf (" + n + " Zusicherungen)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
