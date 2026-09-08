// Der Umkreis-Spinner des Garetien-Importers -- ZWEI Umkreise, EIN Bauteil.
//
// Owner 08.09.2026, woertlich: „kannst du einen numerischen spinner einbauen, der zwischen 0 - 20
// die meilen eingrenzt?" -- auf die Rueckfrage, welcher der beiden Umkreise gemeint ist: „beide".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-umkreis-spinner.test.js
//
// 🔴 `document` steht VOR dem `require`, weil das Modul `hasDocument` beim Laden auswertet -- ohne
// das bliebe der Abrufzweig (und damit die Frage, ob `meilen` wirklich mitreist) unerreichbar.

"use strict";

const path = require("path");
const assert = require("assert");
const fs = require("fs");

const ELEMENTE = {};
global.document = {
	getElementById(id) { return ELEMENTE[id] || null; },
	createElement() { return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} }; },
	addEventListener() {},
};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }

["garetienUmkreisZu", "garetienUmkreisSetzen", "garetienUmkreisVergessen",
	"garetienUmkreisSpinnerMarkup", "garetienInnerortsMoeglich", "garetienInnerortsZeileMarkup",
	"garetienNaeheMarkup", "garetienEingabenAendern", "garetienDetailWaehlen",
].forEach((name) => wahr(typeof mod[name] === "function", name + " fehlt im Export"));

// =================================================================================================
// A. Die Grenzen -- und sie sind DIESELBEN wie serverseitig
// =================================================================================================
mod.garetienUmkreisVergessen();
gleich(mod.garetienUmkreisZu("innerorts"), 5, "Vorgabe Innerorts: 5 Meilen (AVESMAPS_GARETIEN_INNERORTS_MEILEN)");
gleich(mod.garetienUmkreisZu("naehe"), 3, "Vorgabe Naehe: 3 Meilen (1 Karteneinheit Zuschlag)");

const markup = mod.garetienUmkreisSpinnerMarkup("innerorts", "Umkreis");
wahr(/type="number"/.test(markup), "es ist ein numerischer Spinner: " + markup);
wahr(/min="0"/.test(markup) && /max="20"/.test(markup), '🔴 „zwischen 0 - 20": ' + markup);
wahr(/step="1"/.test(markup), "ganze Meilen -- eine Nachkommastelle geben die Daten nicht her");
wahr(/value="5"/.test(markup), "und er startet auf der Vorgabe");
wahr(markup.includes("gi-insert__input"),
	"🔴 DIE HAUSFORM: Hoehe, Rahmen und der gesperrte Zustand kommen von `.gi-insert__input`, "
	+ "nicht aus einer zweiten Feldrezeptur");
wahr(markup.includes("Meilen") && !/value="[^"]*Meilen/.test(markup),
	"⚠️ die Einheit steht NEBEN dem Feld, nie im `value` -- „5 Meilen\" ist kein gueltiger Zahlwert, "
	+ "und die Pfeile hoerten damit auf zu funktionieren");

// 💣 DIE GRENZEN STEHEN ZWEIMAL (Browser und Server) UND MUESSEN GLEICH SEIN. Der Server ist der
// verbindliche; `min`/`max` am `<input>` sind eine Bitte an den Browser.
const phpQuelle = fs.readFileSync(
	path.resolve(__dirname, "..", "..", "..", "api", "_internal", "import", "garetien-abgleich.php"),
	"utf8"
);
wahr(/AVESMAPS_GARETIEN_UMKREIS_MIN_MEILEN\s*=\s*0\.0;/.test(phpQuelle),
	"die Untergrenze steht serverseitig auf 0");
wahr(/AVESMAPS_GARETIEN_UMKREIS_MAX_MEILEN\s*=\s*20\.0;/.test(phpQuelle),
	"und die Obergrenze auf 20 -- sonst klemmt der Server anders, als das Feld anbietet");

// =================================================================================================
// B. Setzen und klemmen
// =================================================================================================
gleich(mod.garetienUmkreisSetzen("innerorts", 12), true, "eine echte Aenderung meldet sich");
gleich(mod.garetienUmkreisZu("innerorts"), 12, "und haelt");
gleich(mod.garetienUmkreisSetzen("innerorts", 12), false,
	"💣 derselbe Wert meldet KEINE Aenderung -- daran haengt, ob ein Neuabruf losgeht; ohne das "
	+ "loeste jeder Klick auf den Pfeil an der Grenze eine Anfrage aus");
gleich(mod.garetienUmkreisSetzen("innerorts", 99), true, "ueber der Grenze: geklemmt");
gleich(mod.garetienUmkreisZu("innerorts"), 20, "...auf 20");
mod.garetienUmkreisSetzen("innerorts", -3);
gleich(mod.garetienUmkreisZu("innerorts"), 0, "unter der Grenze: auf 0 -- und 0 ist ein gueltiger Wert");
gleich(mod.garetienUmkreisSetzen("innerorts", "abc"), false, "Unsinn aendert nichts");
gleich(mod.garetienUmkreisZu("innerorts"), 0, "...und laesst den alten Wert stehen");
gleich(mod.garetienUmkreisZu("naehe"), 3, "⚠️ die zwei Werte sind UNABHAENGIG -- sie steuern zwei Suchen");
mod.garetienUmkreisVergessen();

// =================================================================================================
// C. Die Innerorts-Zeile -- der Spinner steht da, AUCH wenn nichts gefunden wurde
// =================================================================================================
// 💣 DAS IST DIE TRAGENDE ZUSICHERUNG DIESES UMBAUS. Bis zum 08.09.2026 hing die ganze Zeile am
// Befund. Mit dem Spinner geht das nicht mehr: faende die Suche bei 5 Meilen nichts, waere auch das
// Feld weg, mit dem man sie auf 12 stellen wuerde -- ein Bedienelement, das nur erscheint, wenn man
// es nicht mehr braucht.
const bauwerkOhneTreffer = { key: "b:ohne", name: "Turm Dohlentrutz", ziel: "location",
	subtyp: "gebaeude", geometrie: [[100, 100]], innerorts: [] };
const zeileOhne = mod.garetienInnerortsZeileMarkup(bauwerkOhneTreffer, false);
wahr(zeileOhne.includes('data-gi-umkreis="innerorts"'),
	"💣 der Spinner steht auch OHNE Treffer da: " + zeileOhne);
wahr(zeileOhne.includes("keine Siedlung innerhalb von"),
	"...und sagt, dass nichts gefunden wurde, statt stumm zu bleiben");
wahr(!zeileOhne.includes("<select"), "ohne Treffer gibt es nichts zu waehlen");

const bauwerkMitTreffer = Object.assign({}, bauwerkOhneTreffer, {
	key: "b:mit",
	innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09,
		kandidaten: [{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09, nennt_name: true }] },
});
const zeileMit = mod.garetienInnerortsZeileMarkup(bauwerkMitTreffer, false);
wahr(zeileMit.includes("<select") && zeileMit.includes('data-gi-umkreis="innerorts"'),
	"mit Treffer: Auswahlfeld UND Spinner");

// 🔴 Und die Frage gibt es nur beim BAUWERK -- ein Dorf neben einer Stadt ist ein Nachbardorf.
gleich(mod.garetienInnerortsMoeglich({ key: "d", ziel: "location", subtyp: "dorf" }), false,
	"ein Dorf hat keine Innerorts-Frage");
gleich(mod.garetienInnerortsMoeglich({ key: "s", ziel: "location", subtyp: "stadtviertel" }), true,
	"💣 ein Stadtviertel schon -- gefragt wird das GETEILTE Merkmal avesmapsIstBauwerksklasse, nie "
	+ "`subtyp === \"gebaeude\"`: es gibt seit dem 31.08.2026 zwei Bauwerksklassen");
gleich(mod.garetienInnerortsMoeglich({ key: "f", ziel: "region", subtyp: "wald" }), false,
	"und eine Flaeche gar nicht");
gleich(mod.garetienInnerortsZeileMarkup({ key: "f2", ziel: "region", subtyp: "wald" }, false), "",
	"...deshalb steht dort auch keine Zeile");
wahr(!mod.garetienInnerortsZeileMarkup(bauwerkMitTreffer, true).includes("data-gi-umkreis"),
	"⚠️ an einem UEBERNOMMENEN Objekt ist nichts mehr zu suchen -- dort kein Spinner");

// =================================================================================================
// D. Die Naehe-Flaeche -- derselbe Spinner, in ALLEN drei Zustaenden
// =================================================================================================
const naeheObjekt = { key: "n:1", name: "Gardel", ziel: "path", subtyp: "Fluss",
	geometrie: [[100, 100], [101, 101]] };
const naeheMarkup = mod.garetienNaeheMarkup(naeheObjekt);
wahr(naeheMarkup.includes('data-gi-umkreis="naehe"'),
	"💣 auch im Wartezustand („Wird ermittelt …\") steht er da -- sonst kann man ihn genau dann "
	+ "nicht drehen, wenn die Suche nichts gefunden hat: " + naeheMarkup);
wahr(naeheMarkup.includes("Umkreis +"),
	"🔴 er heisst „Umkreis +\", weil er den ZUSCHLAG ueber die eigene Ausdehnung steuert, nicht den "
	+ "ganzen Radius -- als ganzer Radius faende eine grosse Flaeche mit 3 Meilen gar nichts mehr");
gleich(mod.garetienNaeheMarkup({ key: "n:2", geometrie: [] }), "",
	"ohne Geometrie gibt es keine Umkreissuche und damit auch keinen Spinner");

// =================================================================================================
// E. Der Klick auf den Spinner -- AUSGEFUEHRT, und `meilen` reist mit
// =================================================================================================
// 🔴 Gefahren, nicht gelesen: ein Regex auf den Quelltext kennt keinen Geltungsbereich, und genau
// daran ist am 03.09.2026 eine Regression zwei Stunden lang unbemerkt live gestanden (AGENTS.md §11).
function spinnerZiel(welcher, wert) {
	return {
		getAttribute(name) { return name === "data-gi-umkreis" ? welcher : null; },
		hasAttribute(name) { return name === "data-gi-umkreis"; },
		value: String(wert),
	};
}

async function pruefeAbruf() {
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		gestellt.push(JSON.parse((optionen && optionen.body) || "{}"));
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, kandidaten: [], gefunden: [] }) });
	};
	try {
		mod.garetienUmkreisVergessen();
		mod.garetienDetailWaehlen(bauwerkOhneTreffer.key, [bauwerkOhneTreffer]);

		gestellt.length = 0;
		mod.garetienEingabenAendern({ target: spinnerZiel("innerorts", 14) }, [bauwerkOhneTreffer]);
		await new Promise((f) => setImmediate(f));
		gleich(mod.garetienUmkreisZu("innerorts"), 14, "der Spinner setzt den Wert");
		const innerortsAnfragen = gestellt.filter((r) => r.action === "innerorts_kandidaten");
		wahr(innerortsAnfragen.length === 1,
			"💣 und stoesst GENAU EINEN Neuabruf an -- der Riegel gegen doppelte Abrufe muss dafuer "
			+ "mit verworfen werden, sonst kaeme gar keine Anfrage und die Liste bliebe leer: "
			+ JSON.stringify(gestellt.map((r) => r.action)));
		gleich(innerortsAnfragen[0].meilen, 14,
			"🔴 die eingestellten Meilen reisen MIT -- ohne sie rechnete der Server weiter mit 5, "
			+ "und der Spinner waere eine Anzeige ohne Wirkung");

		gestellt.length = 0;
		mod.garetienEingabenAendern({ target: spinnerZiel("innerorts", 14) }, [bauwerkOhneTreffer]);
		await new Promise((f) => setImmediate(f));
		gleich(gestellt.length, 0, "derselbe Wert loest KEINEN Abruf aus");

		// Der zweite Spinner, derselbe Weg -- mit einem Objekt, das eine Umkreissuche hat.
		mod.garetienDetailWaehlen(naeheObjekt.key, [naeheObjekt]);
		gestellt.length = 0;
		mod.garetienEingabenAendern({ target: spinnerZiel("naehe", 9) }, [naeheObjekt]);
		await new Promise((f) => setImmediate(f));
		const naeheAnfragen = gestellt.filter((r) => r.action === "naehe");
		wahr(naeheAnfragen.length === 1, "auch der Naehe-Spinner ruft genau einmal nach: "
			+ JSON.stringify(gestellt.map((r) => r.action)));
		gleich(naeheAnfragen[0].meilen, 9, "und schickt seine Meilen mit");
		gleich(mod.garetienUmkreisZu("innerorts"), 14,
			"⚠️ der andere Wert bleibt unberuehrt -- zwei Suchen, zwei Einstellungen");

		mod.garetienDetailWaehlen(null, []);
		mod.garetienUmkreisVergessen();
	} finally {
		global.fetch = echtesFetch;
	}
}

pruefeAbruf().then(() => {
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
