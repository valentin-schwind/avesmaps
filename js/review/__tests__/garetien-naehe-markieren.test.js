// Owner-Auftrag A (30.08.2026): „Imports in der Naehe markieren (15)" -- ein Knopf in der
// Einzelansicht, unter den vorhandenen Knoepfen. Im groben Umkreis um ein Objekt (5 Karteneinheiten
// ueber die eigene Ausdehnung hinaus) werden weitere Objekte aus dem Import markiert -- der Klick
// leert keine Auswahl, die Zahl kommt vom SERVER (er sucht ueber den GANZEN Lauf, nicht ueber die
// hoechstens 500 geladenen Zeilen).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-naehe-markieren.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen (Vorbild: garetien-wiki-suche.test.js).

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
const ruhe = () => new Promise((fertig) => setTimeout(fertig, 0));

// ---- Das gefälschte `document`/`window` -- VOR jedem require. ---------------------------------
function macheElement(id) {
	return {
		id: id, hidden: true, disabled: false, innerHTML: "", textContent: "",
		addEventListener() {}, removeEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		contains() { return true; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienNaeheKnopfZustand,
	garetienNaeheMarkup,
	garetienNaeheBeiBedarfLaden,
	garetienNaeheKlick,
	garetienDetailMarkup,
	garetienHandlungsMarkup,
} = modul;

wahr(typeof garetienNaeheKnopfZustand === "function", "garetienNaeheKnopfZustand fehlt im Export");
wahr(typeof garetienNaeheMarkup === "function", "garetienNaeheMarkup fehlt im Export");
wahr(typeof garetienNaeheBeiBedarfLaden === "function", "garetienNaeheBeiBedarfLaden fehlt im Export");
wahr(typeof garetienNaeheKlick === "function", "garetienNaeheKlick fehlt im Export");

// =================================================================================================
// A. garetienNaeheKnopfZustand -- REIN: Beschriftung traegt die Zahl, Sperre + Grund bei null
// =================================================================================================
const leer = garetienNaeheKnopfZustand([]);
gleich(leer.beschriftung, "Imports in der Nähe markieren (0)", "auch ohne Treffer nennt der Knopf die Zahl");
gleich(leer.gesperrt, true, "ohne Treffer ist nichts zu markieren");
wahr(leer.hinweis.length > 0, "und der Grund steht sichtbar da");

const voll = garetienNaeheKnopfZustand([{ key: "a" }, { key: "b" }, { key: "c" }]);
gleich(voll.beschriftung, "Imports in der Nähe markieren (3)", "die Beschriftung nennt die genaue Zahl -- Beispiel des Auftrags: (15)");
gleich(voll.gesperrt, false, "mit Treffern ist der Knopf bedienbar");
gleich(voll.hinweis, "", "und ohne Hinweis");

// =================================================================================================
// B. garetienNaeheMarkup -- kein Knopf ohne eigene Geometrie, sonst Platzhalter bzw. geladener Stand
// =================================================================================================
gleich(garetienNaeheMarkup(null), "", "ohne Objekt kein Knopf");
gleich(garetienNaeheMarkup({ key: "x", geometrie: [] }), "", "ohne eigene Geometrie kein Umkreis, also kein Knopf");

const platzhalter = garetienNaeheMarkup({ key: "gi:test:1", geometrie: [[10, 20]] });
wahr(platzhalter.includes("Wird ermittelt"), "vor dem ersten Laden zeigt der Knopf einen Platzhalter: " + platzhalter);
wahr(platzhalter.includes("disabled"), "der Platzhalter ist gesperrt, es gibt noch nichts zu markieren");
wahr(platzhalter.includes("data-naehe"), "der Knopf traegt sein Erkennungsmerkmal fuer den Klick-Verteiler");

// =================================================================================================
// C. garetienNaeheKlick -- markiert UND zeigt an, leert nichts, verlangt einen echten Treffer
// =================================================================================================
function scheinKnopf(disabled, passtSelektor) {
	return {
		disabled: !!disabled,
		closest(sel) { return (passtSelektor !== false && sel === "[data-naehe]") ? this : null; },
	};
}

gleich(garetienNaeheKlick({ target: scheinKnopf(false, false) }, [{ key: "a", geometrie: [[0, 0]] }]), null,
	"ein Klick ausserhalb des Knopfes tut nichts");
gleich(garetienNaeheKlick({ target: scheinKnopf(true) }, [{ key: "a", geometrie: [[0, 0]] }]), null,
	"ein gesperrter Knopf tut nichts, auch wenn `gefunden` etwas enthaelt");
gleich(garetienNaeheKlick({ target: scheinKnopf(false) }, []), null,
	"ohne einen einzigen Treffer passiert nichts");
gleich(garetienNaeheKlick({ target: scheinKnopf(false) }, null), null,
	"eine fehlende Liste bricht nichts");

// ---- Miss die DIFFERENZ: eine vorher bestehende Markierung/Anzeige bleibt -- der Klick ERGAENZT.
modul.avesmapsGaretienAnzeigeLeeren();
modul.avesmapsGaretienMarkierungUmschalten("vorher-markiert");
modul.avesmapsGaretienAnzeigeHinzufuegen([{ key: "vorher-angezeigt", name: "V" }]);

const nachbarn = [
	{ key: "nachbar-1", name: "Nachbar 1", geometrie: [[1, 1]] },
	{ key: "nachbar-2", name: "Nachbar 2", geometrie: [[2, 2]] },
];
const ergebnis = garetienNaeheKlick({ target: scheinKnopf(false) }, nachbarn);
gleich(ergebnis, 2, "der Klick meldet die Zahl der markierten/angezeigten Nachbarn");
gleich(modul.avesmapsGaretienMarkierungHat("nachbar-1"), true, "Nachbar 1 ist jetzt markiert");
gleich(modul.avesmapsGaretienMarkierungHat("nachbar-2"), true, "Nachbar 2 ist jetzt markiert");
gleich(modul.avesmapsGaretienAnzeigeHat("nachbar-1"), true, "Nachbar 1 liegt jetzt auf der Karte (Anzeige-Menge)");
gleich(modul.avesmapsGaretienAnzeigeHat("nachbar-2"), true, "Nachbar 2 liegt jetzt auf der Karte (Anzeige-Menge)");
gleich(modul.avesmapsGaretienMarkierungHat("vorher-markiert"), true,
	"eine vorher bestehende Markierung bleibt -- der Klick LEERT KEINE Auswahl (Auftrag)");
gleich(modul.avesmapsGaretienAnzeigeHat("vorher-angezeigt"), true,
	"und ein vorher angezeigtes Objekt bleibt ebenfalls liegen");

// =================================================================================================
// D. Die Ordnung im Markup: der Knopf steht UNTER den vorhandenen Knöpfen (.gi-acts), nicht davor
//    -- Auftrag: "in der Einzelansicht, unter den vorhandenen Knöpfen".
// =================================================================================================
const objektMitHandlungen = {
	key: "gi:ord:1", name: "Ordnungstest", urteil: "neu", abschnitte: [], items: [],
	geometrie: [[5, 5]],
};
const ganzesMarkup = garetienDetailMarkup(objektMitHandlungen, null, true);
const posActs = ganzesMarkup.indexOf('class="gi-acts"');
const posNaehe = ganzesMarkup.indexOf('class="gi-naehe"');
wahr(posActs !== -1 && posNaehe !== -1, "beide Bloecke muessen im Markup vorkommen: " + ganzesMarkup);
wahr(posNaehe > posActs, "der Naehe-Knopf steht NACH (unter) der Handlungsleiste, nicht davor");
gleich(garetienHandlungsMarkup(objektMitHandlungen) !== "", true,
	"Gegenprobe: dieses Objekt hat wirklich eine Handlungsleiste, sonst waere die Reihenfolge trivial");

// =================================================================================================
// E. Der Abruf -- ECHT gefahren, mit untergeschobenem `fetch` (avesmapsGaretienRufe ruft es)
// =================================================================================================
async function pruefeAbruf() {
	const echtesFetch = global.fetch;
	const gesendet = [];
	try {
		global.fetch = function (url, optionen) {
			gesendet.push({ url: String(url), rumpf: JSON.parse((optionen && optionen.body) || "{}") });
			return Promise.resolve({
				json: () => Promise.resolve({
					ok: true,
					gefunden: [{ key: "server-nachbar", name: "Servernachbar", geometrie: [[0, 0]] }],
					radius: 12.5,
				}),
			});
		};

		const objekt = { key: "gi:abruf:1", geometrie: [[7, 7]] };
		garetienNaeheBeiBedarfLaden(objekt);
		await ruhe();

		gleich(gesendet.length, 1, "GENAU EIN Abruf je geöffneter Zeile: " + JSON.stringify(gesendet));
		wahr(gesendet[0].url.indexOf("garetien-import.php") !== -1,
			"der Abruf geht ueber denselben Endpunkt wie jede andere Aktion dieses Fensters");
		gleich(gesendet[0].rumpf.action, "naehe", "die Aktion heisst 'naehe'");
		gleich(gesendet[0].rumpf.ziel, "gi:abruf:1", "der Schluessel des geoeffneten Objekts reist mit");

		// Nach dem Laden zeigt garetienNaeheMarkup den GELADENEN Stand fuer GENAU dieses Objekt.
		const geladenesMarkup = garetienNaeheMarkup(objekt);
		wahr(geladenesMarkup.includes("Imports in der Nähe markieren (1)"),
			"nach der Antwort zeigt der Knopf die echte Zahl: " + geladenesMarkup);
		wahr(!geladenesMarkup.includes("disabled"), "und ist bedienbar, weil ein Treffer da ist");

		// Ein ANDERES, noch nicht geladenes Objekt zeigt weiterhin den Platzhalter.
		const anderesObjekt = { key: "gi:abruf:2", geometrie: [[9, 9]] };
		const platzhalterAnderes = garetienNaeheMarkup(anderesObjekt);
		wahr(platzhalterAnderes.includes("Wird ermittelt"),
			"ein anderes Objekt kennt den Treffer des ersten nicht: " + platzhalterAnderes);

		// Dasselbe Objekt ERNEUT geoeffnet (z. B. nach einem Listen-Refetch) loest KEINEN zweiten
		// Abruf aus -- derselbe Riegel wie bei der Wiki-Landschaft-Suche.
		garetienNaeheBeiBedarfLaden(objekt);
		await ruhe();
		gleich(gesendet.length, 1, "ein erneutes Laden DESSELBEN Objekts sendet keine zweite Anfrage");

		// ---- Ein Fehlschlag wird BENANNT, nicht verschluckt -- der Knopf bleibt gesperrt.
		global.fetch = function () { return Promise.reject(new Error("Netzwerk aus")); };
		const fehlerObjekt = { key: "gi:abruf:fehler", geometrie: [[1, 1]] };
		garetienNaeheBeiBedarfLaden(fehlerObjekt);
		await ruhe();
		const fehlerMarkup = garetienNaeheMarkup(fehlerObjekt);
		wahr(fehlerMarkup.includes("(0)") && fehlerMarkup.includes("disabled"),
			"ein Fehlschlag zeigt (0) und bleibt gesperrt, statt eine erfundene Zahl zu behaupten: " + fehlerMarkup);
	} finally {
		if (echtesFetch) { global.fetch = echtesFetch; } else { delete global.fetch; }
	}
}

pruefeAbruf().then(function () {
	console.log(`garetien-naehe-markieren: ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
