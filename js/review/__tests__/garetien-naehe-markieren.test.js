// Owner-Auftrag A (30.08.2026): „Imports in der Naehe anzeigen (15)" -- ein Knopf in der
// Einzelansicht, unter den vorhandenen Knoepfen. Im groben Umkreis um ein Objekt (der Zuschlag
// ueber die eigene Ausdehnung hinaus steht als AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG in
// api/_internal/import/garetien-liste.php -- hier steht bewusst KEINE Zahl, sie ist am 30.08.2026
// schon einmal gewandert, von 5 auf 1) werden weitere Objekte aus dem Import gefunden.
//
// 🔴 Der Knopf hiess bis zum 30.08.2026 „… markieren", wurde dann „… anzeigen" (weil der Klick die
// Treffer im selben Zug auf die Stage legte) und seit Aufgabe 8 (Fixrunde 1) „… stagen".
//
// 🔴 AUFGABE 13 (07.09.2026): DER KNOPF STAGT NICHT MEHR. Owner, woertlich: „‚Import in der Naehe
// anzeigen' tut sie stagen. […] sollte eigentlich ‚Import in der Naehe markieren' heissen und
// noch nicht stagen. ERST wenn ich die objekte sehe, will ich sie aber stagen koennen. weil wir
// jetzt den button ‚Auf die Stage' haben, brauchen wir das aber nicht mehr." Der Klick legt die
// Treffer seither NUR in die AUSWAHL (`avesmapsGaretienAlleWaehlen`); auf die Stage kommen sie
// ueber „Auswahl auf die Stage" (eigene Tests: die Auswahlleiste). Der Knopf heisst jetzt
// „Imports in der Nähe wählen (n)" -- der Owner bot „markieren"/„anzeigen" an, beide Woerter sind
// gerade abgeschaffte Vokabeln.
// 🔴 Abschnitt C misst hier deshalb die neue Regel: der Klick WAEHLT, staged aber nicht mehr --
// der Typenfilter selbst (welche Teilmenge des Funds gewaehlt wird) ist eine eigene Datei,
// js/review/__tests__/garetien-naehe-typfilter.test.js.
// Der DATEINAME bleibt `garetien-naehe-markieren.test.js` -- eine Beschriftung wandert, eine
// Kennung nicht (AGENTS.md §11, „Neuigkeiten"/`changelog`).
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
gleich(leer.beschriftung, "Imports in der Nähe wählen (0)", "auch ohne Treffer nennt der Knopf die Zahl");
gleich(leer.gesperrt, true, "ohne Treffer ist nichts zu waehlen");
wahr(leer.hinweis.length > 0, "und der Grund steht sichtbar da");

const voll = garetienNaeheKnopfZustand([{ key: "a" }, { key: "b" }, { key: "c" }]);
gleich(voll.beschriftung, "Imports in der Nähe wählen (3)", "die Beschriftung nennt die genaue Zahl -- Beispiel des Auftrags: (15)");
gleich(voll.gesperrt, false, "mit Treffern ist der Knopf bedienbar");
gleich(voll.hinweis, "", "und ohne Hinweis");

// =================================================================================================
// B. garetienNaeheMarkup -- kein Knopf ohne eigene Geometrie, sonst Platzhalter bzw. geladener Stand
// =================================================================================================
gleich(garetienNaeheMarkup(null), "", "ohne Objekt kein Knopf");
gleich(garetienNaeheMarkup({ key: "x", geometrie: [] }), "", "ohne eigene Geometrie kein Umkreis, also kein Knopf");

const platzhalter = garetienNaeheMarkup({ key: "gi:test:1", geometrie: [[10, 20]] });
wahr(platzhalter.includes("Wird ermittelt"), "vor dem ersten Laden zeigt der Knopf einen Platzhalter: " + platzhalter);
wahr(platzhalter.includes("disabled"), "der Platzhalter ist gesperrt, es gibt noch nichts zu waehlen");
wahr(platzhalter.includes("data-naehe"), "der Knopf traegt sein Erkennungsmerkmal fuer den Klick-Verteiler");

// =================================================================================================
// C. garetienNaeheKlick -- WAEHLT, STAGT NICHTS MEHR (Aufgabe 13), leert nichts, verlangt einen
//    echten Treffer. Der zweite Parameter ist die bereits vom Typenfilter gewaehlte Menge --
//    diese Funktion selbst kennt keine Gruppen (die hat garetien-naehe-typfilter.test.js).
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
	"ein gesperrter Knopf tut nichts, auch wenn die Menge etwas enthaelt");
gleich(garetienNaeheKlick({ target: scheinKnopf(false) }, []), null,
	"ohne einen einzigen Treffer passiert nichts");
gleich(garetienNaeheKlick({ target: scheinKnopf(false) }, null), null,
	"eine fehlende Liste bricht nichts");

// ---- Miss die DIFFERENZ: eine vorher bestehende Auswahl/Stage bleibt -- der Klick ERGAENZT die
// Auswahl und ruehrt die Stage ueberhaupt nicht an.
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienAuswahlAufheben();
modul.avesmapsGaretienAuswahlUmschalten("vorher-markiert");
modul.avesmapsGaretienStageHinzufuegen([{ key: "vorher-angezeigt", name: "V" }]);

const nachbarn = [
	{ key: "nachbar-1", name: "Nachbar 1", geometrie: [[1, 1]] },
	{ key: "nachbar-2", name: "Nachbar 2", geometrie: [[2, 2]] },
];
const ergebnis = garetienNaeheKlick({ target: scheinKnopf(false) }, nachbarn);
gleich(ergebnis, 2, "der Klick meldet die Zahl der GEWAEHLTEN Objekte");
gleich(modul.avesmapsGaretienAuswahlHat("nachbar-1"), true, "Nachbar 1 ist jetzt ausgewaehlt");
gleich(modul.avesmapsGaretienAuswahlHat("nachbar-2"), true, "Nachbar 2 ist jetzt ausgewaehlt");
gleich(modul.avesmapsGaretienStageHat("nachbar-1"), false,
	"Nachbar 1 liegt NICHT auf der Stage -- der Knopf stagt seit Aufgabe 13 nicht mehr");
gleich(modul.avesmapsGaretienStageHat("nachbar-2"), false,
	"und Nachbar 2 ebenso wenig");
gleich(modul.avesmapsGaretienAuswahlHat("vorher-markiert"), true,
	"eine vorher bestehende Auswahl bleibt -- der Klick LEERT KEINE Auswahl (Auftrag)");
gleich(modul.avesmapsGaretienStageHat("vorher-angezeigt"), true,
	"und ein vorher gestagtes Objekt bleibt ebenfalls liegen -- der Klick ruehrt die Stage gar nicht an");
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienAuswahlAufheben();

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
		wahr(geladenesMarkup.includes("Imports in der Nähe wählen (1)"),
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

// =================================================================================================
// F. DIE „NUR IHRE"-MARKE FAELLT FUER DIESEN WEG (Aufgabe 13, 07.09.2026) -- GEGENPROBE zum
//    Verhalten bis zum 07.09.2026 (Owner 30.08.2026: „der button sollte nur imports nicht unsere
//    eigenen anzeigen"). Der Mechanismus selbst (Feld, Zeichner) bleibt unangetastet und wird
//    unabhaengig davon in js/review/__tests__/garetien-karte.test.js geprueft; hier steht nur die
//    Entscheidung, dass DIESER Klick sie nicht mehr setzt -- weil er nichts mehr zeichnet, hat die
//    Marke an dieser Stelle keine Aufgabe mehr.
// =================================================================================================
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienAuswahlAufheben();
const naeheOhneMarke = [
	{ key: "naeh-1", name: "Nachbar A", geometrie: [[1, 1]] },
	{ key: "naeh-2", name: "Nachbar B", geometrie: [[2, 2]] },
];
garetienNaeheKlick({ target: scheinKnopf(false) }, naeheOhneMarke);
naeheOhneMarke.forEach(function (o) {
	wahr(!o[modul.AVESMAPS_GARETIEN_FELD_NUR_IHRE],
		"der Klick darf die 'nur ihre'-Marke nicht mehr setzen -- er zeichnet nichts mehr: "
		+ JSON.stringify(o));
});
// Und ohnehin liegt keines der beiden auf der Karte (Stage) -- die Frage "wird nur ihre Seite
// gezeichnet" stellt sich fuer diesen Klick gar nicht mehr.
gleich(modul.avesmapsGaretienAufDerKarte([]).length, 0,
	"ohne Staging liegt nach dem Klick nichts auf der Karte");
modul.avesmapsGaretienAuswahlAufheben();

// =================================================================================================
// G. DER KLICKVERTEILER: kein Reiterwechsel mehr, kein `eigenes`, keine Stage -- gemessen am
//    Quelltext, weil der Knopf in der DETAILSPALTE steht und ueber einen delegierten Zuhoerer
//    laeuft, den dieser Test nicht aufbaut.
// =================================================================================================
// ⚠️ Kommentare werden vorher entfernt: der Test schluege sonst an der Erklaerung an, die den
// Mechanismus beschreibt -- und der naechste Leser loescht dann den Kommentar (AGENTS.md-Falle).
const quelleOhneKommentare = require("fs")
	.readFileSync(require("path").resolve(__dirname, "..", "review-garetien-importer.js"), "utf8")
	.replace(/\r\n/g, "\n")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");

// 🔴 Aufgabe 13: der Klick reicht die vom Typenfilter GEWAEHLTE Menge herein
// (`garetienNaeheAktuelleMenge`), nicht mehr die rohe Trefferliste und kein drittes `eigenes` mehr.
wahr(/garetienNaeheKlick\(ereignis, garetienNaeheAktuelleMenge\(naeheOffen\)\)\)/
	.test(quelleOhneKommentare),
	"der Klickverteiler muss die vom Typenfilter gewaehlte Menge uebergeben, nicht den rohen Fund");

// 🔴 UND NIRGENDS MEHR EIN REITERWECHSEL AUF „STAGE" NACH DIESEM KLICK -- der Knopf legt nichts
// mehr auf die Karte, es gibt also nichts mehr, das ein anderer Reiter zeigen muesste. Gesucht wird
// GEZIELT der Block dieses einen Verteilers: das Muster "Klick -> ... -> stage" existiert im Haus
// noch an einer ANDEREN Stelle (der Auswahlleisten-Knopf "Auswahl auf die Stage"), die bleibt
// unberuehrt und darf ihn weiterhin tragen.
const naeheBlock = quelleOhneKommentare.match(
	/if \(garetienNaeheKlick\(ereignis, garetienNaeheAktuelleMenge\(naeheOffen\)\)\) \{[\s\S]*?\n\t{4}\}/
);
wahr(naeheBlock !== null, "der Klickblock des Naehe-Knopfs muss auffindbar sein");
wahr(!/garetienReiterSetzen/.test(naeheBlock[0]),
	"der Naehe-Klickblock darf den Reiter nicht mehr wechseln -- nichts kommt mehr auf die Karte");
wahr(!/avesmapsGaretienStageHinzufuegen/.test(naeheBlock[0]),
	"und er darf nichts mehr auf die Stage legen");

console.log(`garetien-naehe-markieren: ${checks} Pruefungen bestanden.`);

pruefeAbruf().then(function () {
	console.log(`garetien-naehe-markieren (Abruf): ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
