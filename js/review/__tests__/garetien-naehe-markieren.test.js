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
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
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
// 🔴 Seit dem 15.09.2026 wechselt der Klick auf „Offen" (Nähe-Ansicht) -- ein ECHTER Wechsel leert die
// Auswahl. Wer die Ergänzung messen will, steht deshalb schon dort.
modul.garetienReiterSetzen("offen");
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
// C2. DIE NÄHE-ANSICHT (Owner 15.09.2026): „ich will die trotzdem wählen (und dass die Treffer markiert
//     werden und die ansicht ‚offen' diese zeigt und die option sie auf die stage zu holen angezeigt wird)"
// =================================================================================================
{
	modul.avesmapsGaretienStageLeeren();
	modul.avesmapsGaretienAuswahlAufheben();
	modul.garetienReiterSetzen("stage");
	gleich(modul.avesmapsGaretienFensterZustand().stand, "stage", "Zeuge: der Klick beginnt auf der Stage");
	const anker = { key: "anker-1", name: "Silker Hain 1", geometrie: [[0, 0]] };
	const treffer = [{ key: "t1", name: "T1", stand: "offen", geometrie: [[1, 1]] }];
	gleich(garetienNaeheKlick({ target: scheinKnopf(false) }, treffer, anker), 1, "der Klick meldet die Zahl");
	gleich(modul.avesmapsGaretienFensterZustand().stand, "offen", "🔴 der Klick wechselt auf „Offen\"");
	gleich(modul.avesmapsGaretienAuswahlHat("t1"), true,
		"💣 der Treffer ist NACH dem Wechsel gewählt -- andersherum nähme der Wechsel die Auswahl wieder weg");
	gleich(modul.avesmapsGaretienAuswahlHat("anker-1"), false, "das Ausgangsobjekt wird NICHT gewählt");
	tief([...modul.garetienNaeheAnsichtKeys()], ["anker-1", "t1"],
		"„Offen\" zeigt genau Ausgangsobjekt und Treffer");
	const ansicht = modul.avesmapsGaretienFensterZustand().naeheAnsicht;
	const chips = modul.garetienChipsMarkup({}, ansicht);
	wahr(chips.includes("In der Nähe von „Silker Hain 1“ (1)"), "der Chip nennt Ausgangsobjekt und Zahl: " + chips);
	wahr(chips.includes('data-chip-feld="naehe"'), "und sein ✕ ist adressierbar");
	gleich(modul.garetienChipsMarkup({}, null), "", "ohne Nähe-Ansicht kein Chip");
	// Ein echter Reiterwechsel beendet die Ansicht.
	modul.garetienReiterSetzen("uebernommen");
	gleich(modul.garetienNaeheAnsichtKeys().length, 0, "🔴 ein Reiterwechsel beendet die Nähe-Ansicht");
	modul.garetienReiterSetzen("offen");
	modul.avesmapsGaretienAuswahlAufheben();
}

// =================================================================================================
// D. Die Ordnung im Markup: der Knopf steht UNTER den vorhandenen Knöpfen (.gi-acts), nicht davor
//    -- Auftrag: "in der Einzelansicht, unter den vorhandenen Knöpfen".
// =================================================================================================
const objektMitHandlungen = {
	key: "gi:ord:1", name: "Ordnungstest", urteil: "neu", abschnitte: [], items: [],
	geometrie: [[5, 5]],
};
const ganzesMarkup = garetienDetailMarkup(objektMitHandlungen, null, true);
const posActs = ganzesMarkup.indexOf('class="gi-block gi-acts"');
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
					// ⚠️ `stand` gehoert seit Befund C (07.09.2026) zu jedem Treffer: der Knopf
					// waehlt nur, was auf dem AKTUELLEN Reiter liegt, und der ist hier „offen".
					gefunden: [{ key: "server-nachbar", name: "Servernachbar", stand: "offen",
						geometrie: [[0, 0]] }],
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
//
// 🪤 SAMMELFIXRUNDE 07.09.2026 (Befund C): DIESE ZUSICHERUNG WAR VAKUUM. Sie prueft das Feld an den
//    ROHEN Eingabeobjekten -- gesetzt wird es aber NIE dort, sondern nur auf KOPIEN beim Zeichnen
//    (`avesmapsGaretienNurIhreStempeln`, „GESTEMPELT WIRD EINE KOPIE"). Der Setzer liess sich
//    wieder einbauen, ohne dass ein Test rot wurde. Gemessen wird jetzt `zustand.nurIhre` selbst --
//    ueber die einzige Stelle, an der die Marke sichtbar wird: die gezeichnete Menge.
// =================================================================================================
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienAuswahlAufheben();
const naeheOhneMarke = [
	{ key: "naeh-1", name: "Nachbar A", stand: "offen", geometrie: [[1, 1]] },
	{ key: "naeh-2", name: "Nachbar B", stand: "offen", geometrie: [[2, 2]] },
];
// 🔴 ERST AUF DIE STAGE, DANN KLICKEN. Nur was gezeichnet wird, kann die Marke ueberhaupt tragen --
// und die Reihenfolge ist zwingend: `avesmapsGaretienStageHinzufuegen` LOESCHT die Marke („ein
// gewoehnlicher Weg in die Anzeige hebt sie auf"). Umgekehrt herum waere die Probe wieder Vakuum.
modul.avesmapsGaretienStageHinzufuegen(naeheOhneMarke);
garetienNaeheKlick({ target: scheinKnopf(false) }, naeheOhneMarke);
modul.avesmapsGaretienAufDerKarte([]).forEach(function (o) {
	wahr(!o[modul.AVESMAPS_GARETIEN_FELD_NUR_IHRE],
		"der Klick darf die 'nur ihre'-Marke nicht mehr setzen -- er zeichnet nichts mehr: "
		+ JSON.stringify(o));
});
// 💣 DIE GEGENPROBE, ohne die alles darueber Vakuum bleibt: der Mechanismus IST heil -- wer die
// Marke setzt, sieht sie auch an der gezeichneten Menge.
modul.avesmapsGaretienNurIhreMerken(naeheOhneMarke);
const mitMarke = modul.avesmapsGaretienAufDerKarte([])
	.filter(function (o) { return o[modul.AVESMAPS_GARETIEN_FELD_NUR_IHRE] === true; });
gleich(mitMarke.length, 2,
	"💣 Gegenprobe: von Hand gesetzt TRAEGT die gezeichnete Kopie die Marke -- sonst misst die "
	+ "Zusicherung darueber nichts");
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienAuswahlAufheben();

// =================================================================================================
// F2. DIE WÄHLBARKEIT (Owner 15.09.2026) -- wählbar ist, was auf die Stage kann; der Rest wird BENANNT.
//     Bis zum 15.09.2026 stand hier die Reitergrenze aus Befund C (07.09.2026).
// =================================================================================================
{
	const { garetienNaeheWaehlbarTeilung, garetienNaeheFremdSatz, garetienNaeheFremdSumme } = modul;
	wahr(typeof garetienNaeheWaehlbarTeilung === "function", "garetienNaeheWaehlbarTeilung fehlt im Export");
	wahr(modul.garetienNaeheReiterTeilung === undefined, "die alte Reitergrenze ist fort, nicht nur umgangen");
	const fund = [
		{ key: "o1", stand: "offen" }, { key: "o2", stand: "offen" },
		{ key: "s1", stand: "offen" }, { key: "u1", stand: "uebernommen" },
		{ key: "x1", stand: "abgelehnt" }, { key: "n1" },
	];
	const teil = garetienNaeheWaehlbarTeilung(fund, function (key) { return key === "s1"; });
	tief(teil.waehlbar.map((o) => o.key), ["o1", "o2"], "wählbar: offen UND nicht schon auf der Stage");
	tief(teil.fremd.map((o) => o.key), ["s1", "u1", "x1", "n1"], "🔴 der Rest bleibt GEFUNDEN");
	tief(teil.nach, { stage: 1, uebernommen: 1, abgelehnt: 1, sonst: 1 }, "…und nach Grund gezählt");
	gleich(garetienNaeheWaehlbarTeilung(null, null).waehlbar.length, 0, "keine Liste bricht nichts");
	gleich(garetienNaeheWaehlbarTeilung([{ key: "", stand: "offen" }], null).waehlbar.length, 0,
		"⚠️ ohne Schlüssel nicht wählbar");
	gleich(garetienNaeheFremdSatz(teil.nach),
		"Nicht wählbar: 1 schon auf der Stage, 1 übernommen, 1 abgelehnt, 1 ohne Stand.", "der Satz nennt die Gründe");
	gleich(garetienNaeheFremdSatz({ uebernommen: 2 }), "Nicht wählbar: 2 übernommen.", "nur, was es gibt");
	gleich(garetienNaeheFremdSatz({}), "", "ohne Rest kein Satz");
	gleich(garetienNaeheFremdSumme(teil.nach), 4, "die Summe");
}

// =================================================================================================
// G. DER KLICKVERTEILER -- gemessen am Quelltext, weil der Knopf in der DETAILSPALTE steht und ueber
//    einen delegierten Zuhoerer laeuft, den dieser Test nicht aufbaut.
// =================================================================================================
// ⚠️ Kommentare werden vorher entfernt: der Test schluege sonst an der Erklaerung an, die den
// Mechanismus beschreibt -- und der naechste Leser loescht dann den Kommentar (AGENTS.md-Falle).
const quelleOhneKommentare = require("fs")
	.readFileSync(require("path").resolve(__dirname, "..", "review-garetien-importer.js"), "utf8")
	.replace(/\r\n/g, "\n")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");

// 🔴 Der Klick reicht die vom Typenfilter GEWAEHLTE Menge herein UND das Ausgangsobjekt (15.09.2026:
// es bleibt in der Nähe-Ansicht sichtbar).
wahr(/garetienNaeheKlick\(ereignis, garetienNaeheAktuelleMenge\(naeheOffen\), naeheOffen\)/
	.test(quelleOhneKommentare),
	"der Klickverteiler muss die gewaehlte Menge UND das Ausgangsobjekt uebergeben");

const naeheBlock = quelleOhneKommentare.match(
	/if \(naeheGewaehlt\) \{[\s\S]*?\n\t{4}\}/
);
wahr(naeheBlock !== null, "der Klickblock des Naehe-Knopfs muss auffindbar sein");
// 🔴 Seit dem 15.09.2026 wird die Liste neu GEHOLT: der Klick hat den Reiter gewechselt, ein Neuzeichnen
// aus der letzten Antwort zeigte den alten.
wahr(/avesmapsGaretienListeHolen\(\)/.test(naeheBlock[0]),
	"nach dem Klick muss die Liste neu geholt werden -- sie zeigt jetzt die Nähe-Ansicht");
wahr(!/garetienStageNeuZeichnen/.test(naeheBlock[0]),
	"…und nicht aus der alten Antwort neu gezeichnet werden");
wahr(!/avesmapsGaretienStageHinzufuegen/.test(naeheBlock[0]),
	"der Klick legt weiterhin nichts auf die Stage -- das tut „Auswahl auf die Stage\"");
// 💣 Die Zahl der NICHT waehlbaren Treffer wird VOR dem Klick gelesen -- er wechselt Reiter und Auswahl.
const posFremd = quelleOhneKommentare.indexOf("const naeheFremd = garetienNaeheFremdAnzahl(naeheOffen);");
const posKlick = quelleOhneKommentare.indexOf("const naeheGewaehlt = garetienNaeheKlick(");
wahr(posFremd !== -1 && posKlick !== -1, "beide Zeilen muessen im Verteiler stehen");
wahr(posFremd < posKlick, "💣 die Fremd-Zahl wird VOR dem Klick gelesen, nicht danach");

console.log(`garetien-naehe-markieren: ${checks} Pruefungen bestanden.`);

pruefeAbruf().then(function () {
	console.log(`garetien-naehe-markieren (Abruf): ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
