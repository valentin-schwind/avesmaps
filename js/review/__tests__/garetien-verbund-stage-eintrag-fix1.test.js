// Aufgabe 6, Nachbesserung Runde 1 (14.09.2026): vier wichtige Befunde des Pruefers (W1-W5, W2 in
// drei Teilen) plus zwei geringe (G6, G8 -- G8 ist eine Aenderung an garetien-verbund-stage-eintrag.test.js,
// keine eigene Zusicherung hier).
// Brief: .superpowers/sdd/2026-09-14-garetien-import-vereint/task-6-fix1-brief.md
// Basis: acd202fee (Aufgabe-6-Commit). Die Sonden des Pruefers liegen unter
// C:\Users\mail\AppData\Local\Temp\claude\C--GIT-avesmaps\dd64f0f4-dd26-4295-a12f-327a83766dfa\scratchpad\
// probe-a6.js / probe-a6b.js / probe-a6c.js.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
// node js/review/__tests__/garetien-verbund-stage-eintrag-fix1.test.js
//
// 🔴 Gemessen wird ueber das ECHTE Modul, nie am Quelltext.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

function fragment(nr, punkte, extra) {
	return Object.assign({
		key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, ebene: "Waelder", typ: "Wald",
		urteil: "neu", stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation",
		verbund_stamm: "Silker Hain", verbund_n: 4,
		geometrie: Array.from({ length: punkte }, (_, i) => [i, i]),
		items: [{ id: 100 + nr, change_type: "new" }],
	}, extra || {});
}
function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
	api.__test.garetienVerbundWegeFreiSetzen(api.__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI);
	api.__test.garetienFensterOffenSetzen(false);
}
// Dieselbe winzige DOM-Attrappe wie in garetien-verbund-stage-eintrag.test.js Abschnitt I.
function eingabeEreignis(feld, werte) {
	return { target: Object.assign({
		getAttribute: (n) => (n === "data-gi-feld" ? feld : null),
		hasAttribute: (n) => n === "data-gi-feld",
	}, werte) };
}

wahr(typeof api.__test.garetienFensterOffenSetzen === "function",
	"garetienFensterOffenSetzen (Testzugang fuer W3) fehlt im Export");

(async function () {

// =================================================================================================
// W1 -- Nachschlagen: waehrend der Abfrage wird ein Eintrag von der Stage genommen (Wettlauf). Der
// vorher geschluckte Fehler liess die Schleife an GENAU DIESEM Eintrag abbrechen und alle SPAETEREN
// Schluessel derselben Runde unaufgefrischt stehen (Sonde probe-a6b.js Abschnitt B).
// =================================================================================================
zuruecksetzen();
{
	const x = { key: "x", ebene: "Waelder", typ: "Wald", items: [{ id: 1, change_type: "new" }] };
	const y = { key: "y", ebene: "Waelder", typ: "Wald", items: [{ id: 2, change_type: "new" }] };
	const z = { key: "z", ebene: "Waelder", typ: "Wald", items: [{ id: 3, change_type: "new" }] };
	api.avesmapsGaretienStageHinzufuegen([x, y, z]);

	let loesen;
	const rufe = function () { return new Promise((r) => { loesen = r; }); };
	const laeuft = api.garetienStageNachschlagen(rufe);
	// Waehrend die Anfrage haengt: y wird von der Stage genommen -- der Wettlauf.
	api.avesmapsGaretienStageEntfernen(["y"]);
	loesen({ objekte: [
		Object.assign({}, x, { items: [{ id: 97, change_type: "new" }] }),
		Object.assign({}, y),
		Object.assign({}, z, { items: [{ id: 99, change_type: "new" }] }),
	] });
	const erg = await laeuft;

	gleich(erg.gefunden, 3, "💣 W1: der Ruf meldet alle drei Funde -- kein geschluckter Fehler mehr: " + JSON.stringify(erg));
	gleich(api.avesmapsGaretienStageHat("y"), false,
		"y bleibt weg -- waehrenddessen entfernt, NICHT wiederbelebt");
	const xNachher = api.avesmapsGaretienStageListe().filter((o) => o.key === "x")[0];
	const zNachher = api.avesmapsGaretienStageListe().filter((o) => o.key === "z")[0];
	gleich(xNachher.items[0].id, 97, "x traegt die FRISCHE Item-Nummer");
	gleich(zNachher.items[0].id, 99,
		"💣 W1: z traegt die FRISCHE Item-Nummer -- vor der Abhilfe brach die Schleife an y ab "
		+ "und liess z auf der ALTEN Nummer stehen");
}

// =================================================================================================
// W2(a) -- Ruling Punkt 2: der Riegel prueft JEDES Mitglied. Nur das groesste auf „region"
// umgestellt reicht nicht, solange ein anderes Mitglied als Punkt eingestellt bleibt -- der Grund
// nennt das ERSTE scheiternde Fragment beim Namen.
// =================================================================================================
zuruecksetzen();
{
	const klein = fragment(1, 3, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	const gross = fragment(2, 20, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	api.avesmapsGaretienStageHinzufuegen([klein, gross]);
	// Handwahl NUR am groessten -- klein bleibt unangetastet ein Punkt.
	api.garetienZielWahlZu(gross).ziel = "region";
	api.garetienZielWahlZu(gross).subtyp = "huegel";
	const s = api.garetienVerbundSchluessel(klein);

	const r = api.garetienVerbundZusammenlegbar(klein);
	gleich(r.ok, false,
		"💣 W2(a): das groesste Mitglied allein reicht nicht mehr -- jedes Mitglied wird geprueft");
	wahr(r.grund.indexOf("Silker Hain 1") !== -1,
		"der Grund nennt das ERSTE scheiternde Fragment beim Namen: " + r.grund);
	gleich(api.garetienVerbundZusammenlegen(s, []), 0, "und das Zusammenlegen selbst bleibt gesperrt");
}

// =================================================================================================
// W2(b) -- alle Mitglieder individuell auf „region" -- der Riegel laesst durch, die Vorbelegung des
// zusammengelegten Verbunds kommt weiterhin aus dem GROESSTEN (Fehler 6 bleibt unberuehrt).
// =================================================================================================
zuruecksetzen();
{
	const m1 = fragment(1, 3, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	const m2 = fragment(2, 20, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienZielWahlZu(m1).ziel = "region";
	api.garetienZielWahlZu(m1).subtyp = "wald";
	api.garetienZielWahlZu(m2).ziel = "region";
	api.garetienZielWahlZu(m2).subtyp = "huegel";
	const s = api.garetienVerbundSchluessel(m1);

	gleich(api.garetienVerbundZusammenlegbar(m1).ok, true, "beide individuell region: der Riegel laesst durch");
	gleich(api.garetienVerbundZusammenlegen(s, []), 2, "und wird zusammengelegt");
	gleich(api.garetienZielWahlZu(m1).ziel, "region", "die Verbund-Form ist region");
	gleich(api.garetienZielWahlZu(m1).subtyp, "huegel", "vorbelegt aus dem GROESSTEN (m2), nicht aus m1");
}

// =================================================================================================
// W2(c) -- Ruling Punkt 3: aendert der Editor Ziel/Form eines ZUSAMMENGELEGTEN Verbunds auf etwas,
// das den Riegel nicht mehr besteht, loest sich der Verbund auf. Getippt wird ueber den ECHTEN
// Zuhoerer garetienEingabenAendern.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const s = api.garetienVerbundSchluessel(m1);
	gleich(api.garetienVerbundZusammenlegen(s, []), 2, "Vorbedingung: zusammengelegt");

	api.garetienDetailWaehlen(m1.key, [m1, m2]);
	api.garetienEingabenAendern(eingabeEreignis("zielForm", { type: "text", value: "label" }), [m1, m2]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"💣 W2(c): Form auf label gestellt -- der Verbund loest sich auf, ueber DIESELBE Funktion wie der Knopf");
	const rumpf = api.garetienEingabenFuerServer(m2);
	gleich(rumpf && "verbund" in rumpf, false,
		"und der Rumpf traegt keinen verbund mehr, an keinem der beiden Mitglieder: " + JSON.stringify(rumpf));
	api.garetienDetailWaehlen(null, [m1, m2]);
}

// =================================================================================================
// W3 -- Entprellter Namens-Zeitgeber malt nach dem Schliessen NICHT mehr. Zwei isolierte Szenen
// (je EIN Riegel abgeschaltet) plus die Szene aus dem Brief woertlich (beide Riegel).
// =================================================================================================
async function w3Szene(mitEchtemSchliessen, beschreibung) {
	zuruecksetzen();
	api.__test.garetienFensterOffenSetzen(true);
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);
	let gezeichnet = 0;
	global.window.avesmapsGaretienKarteZeigen = function () { gezeichnet++; };
	global.window.avesmapsGaretienKarteAus = function () {};
	api.garetienDetailWaehlen(m1.key, [m1, m2]);
	const vorTippen = gezeichnet;
	api.garetienEingabenAendern(eingabeEreignis("einfuegeName", { type: "text", value: "Forst" }), [m1, m2]);
	if (mitEchtemSchliessen) {
		// Riegel 1 (Zeitgeber wird geloescht) UND danach wieder "offen" -- Riegel 2 kann also NICHT
		// mehr blocken. Nur wenn der Zeitgeber WIRKLICH geloescht wurde, bleibt es bei vorTippen.
		api.avesmapsGaretienFensterSchliessen();
		api.__test.garetienFensterOffenSetzen(true);
	} else {
		// Riegel 2 isoliert: das Fenster wird NUR als "zu" markiert (der Zeitgeber selbst laeuft
		// weiter, Riegel 1 kommt hier gar nicht zum Zug).
		api.__test.garetienFensterOffenSetzen(false);
	}
	await new Promise((r) => setTimeout(r, 300));
	gleich(gezeichnet, vorTippen, beschreibung);
	api.garetienDetailWaehlen(null, [m1, m2]);
	delete global.window.avesmapsGaretienKarteZeigen;
	delete global.window.avesmapsGaretienKarteAus;
	zuruecksetzen();
}
await w3Szene(false,
	"💣 W3 Riegel 2 isoliert: der entprellte Rueckruf prueft zustand.offen SELBST, auch wenn der "
	+ "Zeitgeber (Riegel 1) gar nicht geloescht wurde");
await w3Szene(true,
	"💣 W3 Riegel 1 isoliert: der Zeitgeber wird beim Schliessen WIRKLICH geloescht -- nicht nur "
	+ "durch Riegel 2 verdeckt, denn das Fenster ist hier beim Ablauf der Frist schon wieder offen");
// Die Szene woertlich aus dem Brief: tippen, schliessen, 300ms echte Zeit.
{
	zuruecksetzen();
	api.__test.garetienFensterOffenSetzen(true);
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);
	let gezeichnet = 0;
	global.window.avesmapsGaretienKarteZeigen = function () { gezeichnet++; };
	global.window.avesmapsGaretienKarteAus = function () {};
	api.garetienDetailWaehlen(m1.key, [m1, m2]);
	const vorTippen = gezeichnet;
	api.garetienEingabenAendern(eingabeEreignis("einfuegeName", { type: "text", value: "Forst" }), [m1, m2]);
	api.avesmapsGaretienFensterSchliessen();
	await new Promise((r) => setTimeout(r, 300));
	gleich(gezeichnet, vorTippen, "W3 (Brief woertlich): tippen, schliessen, 300ms -- kein weiterer Zeichenaufruf");
	api.garetienDetailWaehlen(null, [m1, m2]);
	delete global.window.avesmapsGaretienKarteZeigen;
	delete global.window.avesmapsGaretienKarteAus;
}

// =================================================================================================
// W4 -- „Eingaben" (Groesse, Prioritaet, Zoomband, …) an einem EINZELNEN Objekt fallen mit „Stage
// leeren" und mit einem neuen Lauf -- genau wie die uebrigen Objekt-Einstellungen.
// =================================================================================================
zuruecksetzen();
{
	const einzeln = { key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", ziel: "region",
		subtyp: "wald", items: [{ id: 1, change_type: "new" }] };
	api.avesmapsGaretienStageHinzufuegen([einzeln]);
	const vorgabe = api.garetienEingabenGrundwerte(einzeln).size;
	api.garetienEingabenZustandZu(einzeln).size = 99;
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([einzeln]);
	gleich(api.garetienEingabenZustandZu(einzeln).size, vorgabe,
		"💣 W4: „Stage leeren“ vergisst auch OBJEKT-Eingaben, nicht nur Verbund-Eingaben");
}
zuruecksetzen();
{
	const einzeln = { key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", ziel: "region",
		subtyp: "wald", items: [{ id: 1, change_type: "new" }] };
	api.avesmapsGaretienStageHinzufuegen([einzeln]);
	const vorgabe = api.garetienEingabenGrundwerte(einzeln).size;
	api.garetienEingabenZustandZu(einzeln).size = 77;
	await api.garetienLaufStarten(
		function () { return Promise.resolve({ run_id: 0, fehler: [] }); },
		["ggp:Gewaesser"], function () {}, function () { return Promise.resolve(null); }
	);
	gleich(api.garetienEingabenZustandZu(einzeln).size, vorgabe,
		"💣 W4: ein neuer Lauf vergisst die Objekt-Eingaben ebenso");
}
zuruecksetzen();

// =================================================================================================
// W5 -- Uebernimmt garetienFensterFuellen beim (Wieder-)Oeffnen einen ANDEREN Lauf als den, auf dem
// die Stage bisher stand, zaehlt das als neuer Lauf; dieselbe Kennung vergisst nichts.
// =================================================================================================
zuruecksetzen();
{
	function rufeMitLaeufen(laeufe) {
		return function (pfad, rumpf) {
			if (rumpf && rumpf.action === "runs") { return Promise.resolve({ runs: laeufe }); }
			return Promise.resolve({});
		};
	}
	const listeHolenLeer = function () { return Promise.resolve(null); };

	// Erster Fuellversuch dieser Sitzung: importRunId ist NULL, also gibt es nichts zu vergessen.
	await api.garetienFensterFuellen(rufeMitLaeufen([{ id: 5 }]), listeHolenLeer);

	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const s = api.garetienVerbundSchluessel(m1);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Testname");
	gleich(api.garetienVerbundIstZusammen(s), true, "Vorbedingung: zusammengelegt");

	// Wieder-Oeffnen mit GLEICHER Kennung (5).
	await api.garetienFensterFuellen(rufeMitLaeufen([{ id: 5 }]), listeHolenLeer);
	gleich(api.garetienVerbundIstZusammen(s), true,
		"W5: gleiche Lauf-Kennung beim Wiederoeffnen -- bleibt zusammengelegt");
	gleich(api.garetienNameWahlZu(m1), "Testname", "...und der Name bleibt");

	// Wieder-Oeffnen mit ANDERER Kennung (6) -- z. B. ein zweiter Admin hat inzwischen einen neuen
	// Lauf angelegt.
	await api.garetienFensterFuellen(rufeMitLaeufen([{ id: 6 }]), listeHolenLeer);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"💣 W5: andere Lauf-Kennung beim Wiederoeffnen -- zaehlt als neuer Lauf, Entscheidungen vergessen");
}
zuruecksetzen();

// =================================================================================================
// G6 -- bewusst UNGEAENDERTE Regel: ein nachtraeglich aufgelegtes Fragment hebt „zusammengelegt"
// auf (die zwei AELTEREN Eintraege behalten `zusammen=true`); wird es wieder heruntergenommen, ist
// der Verbund ohne Klick wieder zusammen (Sonde probe-a6.js Abschnitt 2b/2c).
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Hainforst");

	api.avesmapsGaretienStageHinzufuegen([m3]);
	gleich(api.garetienVerbundIstZusammen(s), false, "G6: ein neu aufgelegtes drittes Fragment hebt die Merkung auf");

	api.avesmapsGaretienStageEntfernen([m3.key]);
	gleich(api.garetienVerbundIstZusammen(s), true,
		"⚠️ G6 (bewusst UNGEAENDERTE Regel des Briefs): wird das dritte Fragment OHNE Klick wieder "
		+ "heruntergenommen, gilt der Verbund WIEDER als zusammengelegt -- die zwei aelteren "
		+ "Eintraege trugen `zusammen=true` unveraendert weiter");
	gleich(api.garetienNameWahlZu(m1), "Hainforst",
		"und der alte Handname taucht unveraendert wieder auf, ganz ohne neuen Klick");
}
zuruecksetzen();

console.log(`garetien-verbund-stage-eintrag-fix1: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
