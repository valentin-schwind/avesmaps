// „Innerorts einfügen (Stadt)" -- der zweite Knopf neben „Neu einfügen" im Garetien Importer.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-innerorts-knopf.test.js
//
// 🔴 Geprueft werden die REINEN Haelften (Befund-Leser, Knopfleiste, Tooltip, Listenzeile, Hinweis)
// UND der Klickverteiler garetienNeuKlick mit einer fetch-Attrappe -- gemessen am ERGEBNIS, an der
// Folge der Anfragen, die wirklich hinausgehen (dieselbe Bauform wie garetien-handlungen.test.js).

"use strict";

const path = require("path");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

["garetienInnerortsOrt", "garetienHandlungen", "garetienHandlungTitel", "garetienNeuKlick",
	"garetienStageVorhaben", "garetienZeileMarkup", "garetienEingefuegtWirdUebernommenHinweis",
	"garetienInnerortsKandidatenVon", "garetienInnerortsKandidatText", "garetienInnerortsWahlZu",
	"garetienInnerortsWahlVergessen", "garetienInnerortsZeileMarkup", "garetienInnerortsZiel",
	"garetienEingabenFuerServer", "garetienEingabenAendern", "garetienDetailWaehlen",
].forEach((name) => wahr(typeof mod[name] === "function", name + " fehlt im Export"));

const namen = (objekt) => mod.garetienHandlungen(objekt).map((k) => k.name);
const knopf = (objekt, name) => mod.garetienHandlungen(objekt).filter((k) => k.name === name)[0];

// Ein Tempel, fuer den der Server beim „Holen & Rechnen" einen Befund mitgeschickt hat.
const mitBefund = {
	key: "ggp:Bauwerke:Tempel:Garetien:Wandlether Rondratempel", name: "Wandlether Rondratempel",
	typ: "Tempel", urteil: "neu", grund: 'nächstes "Wandleth" nur 0,1 Meilen entfernt, aber anderer Name',
	abschnitte: [], innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09 },
	items: [{ id: 41, change_type: "new", selected: 1 }],
};
// Derselbe Vorschlag ohne Befund -- die PHP-Leerform ist `[]`, kein `null`.
const ohneBefund = Object.assign({}, mitBefund, {
	key: "ggp:Bauwerke:Tempel:Garetien:Ferner Tempel", name: "Ferner Tempel", innerorts: [],
});
// Ein Lauf von vor dem 02.09.2026 kennt das Feld gar nicht.
const altLauf = Object.assign({}, mitBefund, { key: "alt", name: "Alt" });
delete altLauf.innerorts;

// =================================================================================================
// A. Der Befund-Leser -- gelesen, nicht gerechnet
// =================================================================================================
gleich(mod.garetienInnerortsOrt(mitBefund), "Wandleth", "der Ortsname kommt aus dem Befund");
gleich(mod.garetienInnerortsOrt(ohneBefund), "",
	"💣 die PHP-Leerform `[]` ist in JS ein Objekt ohne Namen -- kein Ort, kein Fehler");
gleich(mod.garetienInnerortsOrt(altLauf), "", "ein alter Lauf ohne das Feld: kein Ort");
gleich(mod.garetienInnerortsOrt(null), "", "nichts: kein Ort");
gleich(mod.garetienInnerortsOrt({ innerorts: { name: "  " } }), "", "ein leerer Name zaehlt nicht");

// =================================================================================================
// B. Die Knopfleiste
// =================================================================================================
// 🔴 Seit dem 07.09.2026 heisst der Nachbar „stage" statt „neu" -- „Neu einfügen" ist gefallen
// (Owner-Punkt 12), der Vorwaertsknopf legt jetzt erst auf die Stage.
// 💣 „Innerorts einfügen" ist NICHT mitgefallen, obwohl der Brief es streichen wollte: der
// Stage-Import schickt keine `einstellungen`, und `avesmapsGaretienInnerortsGewuenscht`
// (garetien-uebernahme.php) entscheidet ausschliesslich daraus -- gestrichen waere die Staette
// in einer Stadt UNERREICHBAR. Die Zeile bleibt, bis „Stätte in X" eine FORM im Kasten
// „Wird importiert als" ist (Entwurf §5.1).
tief(namen(mitBefund), ["stage", "innerorts", "ablehnen"],
	"🔴 direkt NEBEN dem Vorwaertsknopf, als dessen Alternative -- nicht am Ende der Leiste");
tief(namen(ohneBefund), ["stage", "ablehnen"],
	"🔴 ohne Befund steht der Knopf GAR NICHT da -- kein dauerhaft ausgegrauter Zwilling");
tief(namen(altLauf), ["stage", "ablehnen"], "ein alter Lauf: auch nicht");
const k = knopf(mitBefund, "innerorts");
wahr(k.beschriftung.startsWith("Innerorts einfügen (Wandleth)"),
	"der Ortsname steht IM Knopf, nicht im Hilfetext: " + k.beschriftung);
gleich(k.ton, "", "🔴 NEUTRAL -- gruen kodiert „legt etwas auf der Karte an\", und genau das tut er nicht");
gleich(knopf(mitBefund, "stage").ton, "accent",
	"(der Nachbar traegt seit dem 07.09.2026 den AKZENT -- gruen hiesse „legt auf der Karte an\")");
gleich(k.disabled, false, "und er ist scharf");
// ⚠️ Den Vergleichspartner „neu" gibt es nicht mehr; gemessen wird jetzt direkt gegen das
// new-Item -- dieselbe Aussage („ein anderer ZIELORT fuer denselben Vorschlag"), nur ohne den
// gefallenen Knopf als Zeugen.
tief(k.ids, mitBefund.items.filter((i) => i.change_type === "new").map((i) => i.id),
	"🔴 DIESELBE MENGE wie der Vorschlag „neu anlegen\" -- ein anderer ZIELORT, nicht ein anderer Vorschlag");
tief(k.ids, [41], "naemlich das new-Item");
const titel = mod.garetienHandlungTitel("innerorts", mitBefund);
wahr(titel.includes("Wandleth") && titel.includes("OHNE Position"),
	"der Tooltip nennt die Stadt und sagt, dass kein Kartenpunkt entsteht: " + titel);
// Ein Ergaenzungsfall traegt zwar „neu" (trotzdem anlegen), aber der Server schickt dort keinen Befund.
const ergaenzung = {
	key: "e", name: "Wandlether Rahjatempel", urteil: "ergaenzung", innerorts: [],
	abschnitte: [{ public_id: "g-1", name: "Wandlether Rahjatempel" }],
	items: [
		{ id: 50, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "g-1", name: "Wandlether Rahjatempel" } },
		{ id: 51, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
	],
};
wahr(namen(ergaenzung).includes("stage") && !namen(ergaenzung).includes("innerorts"),
	"ohne Befund kein Angebot, auch wenn ein Zusatz-Item (trotzdem anlegen) dasteht");

// =================================================================================================
// C. Der Klick: EIN Weg mit „neu", und genau EIN anderer Wert
// =================================================================================================
function kette(knoten) {
	const kandidaten = knoten.map((k2) => Object.assign({
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(k2.attribute || {}, name)
				? k2.attribute[name] : null;
		},
	}, k2));
	// Ehrlicher `closest`: eine Auswahl kann MEHRERE, kommagetrennte Alternativen tragen.
	kandidaten[0].closest = function (auswahl) {
		const teile = String(auswahl).split(",").map(function (t) { return t.trim(); });
		for (const kand of kandidaten) {
			for (const teil of teile) {
				if ((kand.passt || []).indexOf(teil) !== -1) { return kand; }
			}
		}
		return null;
	};
	return kandidaten[0];
}
function ziel(handlung, key, options) {
	return kette([Object.assign({
		passt: ['[data-handlung="' + handlung + '"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": handlung, "data-key": key },
	}, options || {})]);
}

async function pruefeKlick() {
	// 🔴 Aufgabe 6 (06.09.2026): der Nachlauf „garetienStageNachschlagen" fragt seither die STAGE
	// per `keys` ab, nicht mehr den Reiter „uebernommen" -- und die Stage bleibt in dieser Datei
	// leer, also bleibt der Nachlauf ganz aus (js/review/__tests__/garetien-stage-nachschlagen.test.js).
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		let roh;
		if (rumpf.action === "apply") {
			roh = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		} else {
			roh = { ok: true, plan_run_id: 7, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} };
		}
		return Promise.resolve({ json: () => Promise.resolve(roh) });
	};
	try {
		const gefragt = [];
		const nein = (text) => { gefragt.push(text); return false; };

		const knopfDom = ziel("innerorts", mitBefund.key);
		const lauf = mod.garetienNeuKlick({ target: knopfDom }, [mitBefund], 7, nein);
		wahr(lauf && typeof lauf.then === "function", "der Klick wird uebernommen und wirklich ausgefuehrt");
		gleich(knopfDom.disabled, true, "der Knopf sperrt sich sofort, synchron");
		await lauf;
		tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste"],
			"derselbe Ablauf wie „Neu einfuegen\": anhaken, uebernehmen, Liste (die Stage ist leer, "
			+ "der Stage-Nachlauf bleibt aus)");
		tief(gestellt[0].rumpf.ids, [41], "mit dem new-Item");
		tief(gestellt[1].rumpf.einstellungen,
			{ innerorts: true, innerorts_public_id: "stadt-wandleth" },
			"🔴 GENAU ZWEI Werte: „ja, innerorts\" und WELCHE Stadt -- nicht der Kasten „Eingefuegt wird\". "
			+ "Die public_id kommt aus demselben Leser wie die Beschriftung des Knopfes "
			+ "(garetienInnerortsZiel); ohne sie schickte der Knopf „(Wandleth)\" die Vorauswahl, "
			+ "waehrend im Feld darueber eine andere Stadt steht.");
		gleich(gefragt.length, 0, "und KEINE Rueckfrage");

		// Die Rueckfrage vor „trotzdem neu anlegen" gilt NUR „neu": eine Staette kollidiert mit keinem
		// Kartenobjekt, es gibt nichts, wovor zu warnen waere.
		gestellt.length = 0;
		const kollision = Object.assign({}, mitBefund, {
			key: "koll", urteil: "ergaenzung",
			abschnitte: [{ public_id: "g-2", name: "Nachbar" }],
			items: [
				{ id: 60, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0,
					abschnitt: { public_id: "g-2", name: "Nachbar" } },
				{ id: 61, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
			],
		});
		// 🔴 FIXRUNDE 1 (B3, 07.09.2026): `garetienNeuIstZusatz` gibt es nicht mehr. Die Frage
		// beantwortet `garetienStageVorhaben` — und sie ist ENGER: das Zusatz-Item zählt nur, wenn
		// das Objekt sonst NICHTS vorzuweisen hat. Diese Attrappe trägt daneben ein legitimes
		// Ergänzungs-Item, ist also „ergaenzung“ — genau die Lage, in der ein mitlaufendes Zusatz-Item
		// den Schadensfall vom 30.08.2026 wiederholte (Ergänzung UND Dublette in einem Import).
		gleich(mod.garetienStageVorhaben(kollision), "ergaenzung",
			"💣 das Zusatz-Item bleibt draußen, solange ein legitimes Item danebensteht");
		gleich(mod.garetienStageVorhaben({ items: [{ id: 61, anlass: "zusatz", change_type: "new" }] }),
			"zusatz", "(allein steht es sehr wohl für sich)");
		// 🔴 Seit dem 07.09.2026 gibt es den Knopf „neu" nicht mehr (Owner-Punkt 12) -- und die TUER
		// bleibt auch dann zu, wenn ein synthetisches Ereignis ihn von Hand anfliegt:
		// `garetienHandlungsRumpf` findet keinen Knopf dieses Namens mehr und liefert `null`.
		// ⚠️ Das ist die Zusicherung, die aus der alten wird („neu fragt und ein Nein zaehlt als
		// uebernommen") -- sie prueft dieselbe Naht, nur von der anderen Seite: nichts geht hinaus.
		gleich(mod.garetienNeuKlick({ target: ziel("neu", kollision.key) }, [kollision], 7, nein), null,
			"„neu\" gibt es nicht mehr -- der Klick wird nicht einmal uebernommen");
		gleich(gefragt.length, 0, "keine Rueckfrage, weil es nichts zu fragen gibt");
		gleich(gestellt.length, 0, "nichts hinausgeschickt");
		const laufI = mod.garetienNeuKlick({ target: ziel("innerorts", kollision.key) }, [kollision], 7, nein);
		wahr(laufI && typeof laufI.then === "function",
			"⚠️ „innerorts\" fragt NICHT -- es entsteht kein zweites Kartenobjekt, die Kollision kann es nicht geben");
		await laufI;
		gleich(gefragt.length, 0, "keine Rueckfrage -- „innerorts\" fragt ohnehin nie");
		tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste"], "und der Ablauf ist derselbe");
		gleich(gestellt[1].rumpf.einstellungen.innerorts, true, "mit innerorts");
	} finally {
		global.fetch = echtesFetch;
	}
}

// =================================================================================================
// D. „Uebernommen · innerorts" (Entwurf §4) -- die Zeile und der Hinweis sagen, WO das Objekt liegt
// =================================================================================================
function pruefeUebernommen() {
	const uebernommenKarte = Object.assign({}, mitBefund, {
		stand: "uebernommen", innerorts_uebernommen: false,
		items: [{ id: 41, change_type: "new", selected: 1, apply_state: "done" }],
	});
	const uebernommenStaette = Object.assign({}, uebernommenKarte, { innerorts_uebernommen: true });

	wahr(!mod.garetienZeileMarkup(uebernommenKarte).includes("innerorts"),
		"eine auf die KARTE uebernommene Zeile sagt nichts von innerorts");
	wahr(mod.garetienZeileMarkup(uebernommenStaette).includes("· innerorts"),
		"🔴 Entwurf §4: „Uebernommen · innerorts\" -- die Zeile sagt, wo das Objekt liegt");
	wahr(!mod.garetienZeileMarkup(Object.assign({}, mitBefund, { innerorts_uebernommen: true })).includes("· innerorts"),
		"...aber nur an einer UEBERNOMMENEN Zeile (das Feld allein, ohne Stand, ist keine Aussage)");

	const hinweisKarte = mod.garetienEingefuegtWirdUebernommenHinweis(uebernommenKarte);
	wahr(hinweisKarte.includes("Liegt bereits auf der Karte"), "auf der Karte: der bisherige Satz");
	const hinweisStaette = mod.garetienEingefuegtWirdUebernommenHinweis(uebernommenStaette);
	wahr(hinweisStaette.includes("Liegt als Stätte in „Wandleth\"") && !hinweisStaette.includes("Liegt bereits auf der Karte"),
		"als Staette: der Satz nennt die Stadt und behauptet keinen Kartenpunkt: " + hinweisStaette);
	wahr(hinweisStaette.includes("ohne Position auf der Karte"),
		"und er sagt ausdruecklich, dass es keine Position gibt -- sonst sucht ein Editor den Punkt vergebens");
	wahr(hinweisStaette.includes("Zurücknehmen"), "und die Ruecknahme wird weiter angeboten");
}

// =================================================================================================
// E. Das Auswahlfeld (Owner 07.09.2026) -- „sind in der Naehe mehrere soll ein dropdown Menue
//    sortiert nach entfernung zur auswahl stehen, fuer welches man sich innerorts entscheiden
//    moechte."
// =================================================================================================
// Derselbe Tempel, aber aus einem Lauf NACH dem 07.09.2026: der Befund traegt seine Kandidaten mit.
const mitListe = Object.assign({}, mitBefund, {
	key: "ggp:Bauwerke:Tempel:Garetien:Mit Liste", name: "Wandlether Rondratempel",
	ziel: "location", subtyp: "gebaeude", geometrie: [[100, 100]],
	innerorts: {
		public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09,
		kandidaten: [
			{ public_id: "dorf-aue", name: "Aue", meilen: 0.03, nennt_name: false },
			{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09, nennt_name: true },
		],
	},
});

function pruefeAuswahlfeld() {
	mod.garetienInnerortsWahlVergessen();

	// --- Die Liste -------------------------------------------------------------------------
	tief(mod.garetienInnerortsKandidatenVon(mitListe).map((k) => k.name), ["Aue", "Wandleth"],
		"🔴 GELESEN, NICHT SORTIERT: die Reihenfolge IST die Antwort des Servers (nach Entfernung). "
		+ "Im Browser nachzusortieren waere eine zweite Wahrheit -- und er kennt die Ortschaften der "
		+ "Karte gar nicht alle (Zoom und Ansicht entscheiden, was geladen ist)");
	tief(mod.garetienInnerortsKandidatenVon(mitBefund).map((k) => k.public_id), ["stadt-wandleth"],
		"🪤 ein Lauf VOR dem 07.09.2026 traegt keine `kandidaten` -- dann ist die Vorauswahl die "
		+ "einzige Stadt, die er kennt, und genau sie steht zur Wahl");
	tief(mod.garetienInnerortsKandidatenVon(ohneBefund), [], "ohne Befund keine Kandidaten");
	tief(mod.garetienInnerortsKandidatenVon(altLauf), [], "ein Lauf ohne das Feld: auch keine");

	// --- Die Zeile eines Kandidaten --------------------------------------------------------
	gleich(mod.garetienInnerortsKandidatText({ name: "Aue", meilen: 0.03, nennt_name: false }),
		"Aue · 0,03 Meilen", "Name und Entfernung, in der Hausform mit Komma");
	gleich(mod.garetienInnerortsKandidatText({ name: "Wandleth", meilen: 0.09, nennt_name: true }),
		"Wandleth · 0,09 Meilen · Name passt",
		"💣 die MARKE steht an der Zeile -- ohne sie saehe der Editor in einer nach blosser Naehe "
		+ "sortierten Liste nicht, warum die zweite Zeile die richtige ist");

	// --- Das Markup ------------------------------------------------------------------------
	gleich(mod.garetienInnerortsZeileMarkup(ohneBefund, false), "",
		"🔴 ohne Kandidaten steht die Zeile GAR NICHT da -- kein dauerhaft leeres Auswahlfeld");
	const zeile = mod.garetienInnerortsZeileMarkup(mitListe, false);
	wahr(zeile.includes('data-gi-feld="innerorts"'), "das Feld traegt seinen Namen: " + zeile);
	wahr(zeile.indexOf("— auf die Karte —") !== -1, "der erste Eintrag ist „auf die Karte\"");
	wahr(/<option value=""[^>]* selected/.test(zeile),
		"💣 UND ER IST VORAUSGEWAEHLT. Eine vorbelegte Stadt legte beim naechsten „Stage importieren\" "
		+ "fuer dreihundert Objekte stillschweigend Staetten an, statt Kartenpunkte: " + zeile);
	wahr(zeile.indexOf("Aue · 0,03 Meilen") < zeile.indexOf("Wandleth · 0,09 Meilen"),
		"beide Staedte stehen drin, in der Reihenfolge des Servers");
	wahr(!zeile.includes("Wird als Stätte in"),
		"...und solange nichts gewaehlt ist, behauptet nichts eine Staette");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, true).includes(" disabled"),
		"an einem uebernommenen Objekt ist das Feld gesperrt, wie jedes andere des Kastens");

	// --- Ohne Wahl: alles bleibt, wie es war -----------------------------------------------
	gleich(mod.garetienInnerortsWahlZu(mitListe), "", "die Vorgabe ist LEER");
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Wandleth",
		"...der Knopf nennt trotzdem die Vorauswahl des Servers -- der Vorschlag geht nicht verloren");
	const ohneWahl = mod.garetienEingabenFuerServer(mitListe);
	wahr(!("innerorts" in ohneWahl),
		"💣 UND DER STAGE-RUMPF SAGT NICHTS VON INNERORTS. Ohne diese Zeile legte „Stage importieren\" "
		+ "fuer jedes Objekt mit Befund eine Staette an: " + JSON.stringify(ohneWahl));
	gleich(ohneWahl.ziel, "location", "er beschreibt weiter das Kartenobjekt");

	// --- Mit Wahl: der ECHTE Weg, ueber garetienEingabenAendern ----------------------------
	// 🔴 AUSGEFUEHRT, NICHT GELESEN: ein Regex auf den Quelltext kennt keinen Geltungsbereich, und
	// genau daran ist am 03.09.2026 eine Regression zwei Stunden lang unbemerkt live gestanden
	// (AGENTS.md §11, „Die Landschaft traegt die Quellen").
	mod.garetienDetailWaehlen(mitListe.key, [mitListe]);
	mod.garetienEingabenAendern({
		target: {
			getAttribute: (name) => (name === "data-gi-feld" ? "innerorts" : null),
			hasAttribute: (name) => name === "data-gi-feld",
			value: "dorf-aue",
		},
	}, [mitListe]);
	gleich(mod.garetienInnerortsWahlZu(mitListe), "dorf-aue", "die Wahl liegt neben dem DOM und haelt");
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Aue",
		"🔴 und der Knopf nennt jetzt SIE, nicht mehr die Vorauswahl");
	// 💣 AM KNOPF SELBST GEMESSEN, nicht nur am Leser dahinter. `garetienInnerortsZiel` richtig zu
	// haben und ihn an der Beschriftung NICHT zu rufen ist genau der Fehler, den der Kommentar an
	// der Handlungsleiste beschreibt: der Knopf sagte „Innerorts einfügen (Wandleth)", die Anfrage
	// daneben schickte „dorf-aue". Eine Mutationsprobe (07.09.2026) hat diese Luecke gefunden --
	// die Zusicherung darueber allein hat sie ueberlebt.
	const knopfNachWahl = mod.garetienHandlungen(mitListe).filter((h) => h.name === "innerorts")[0];
	wahr(knopfNachWahl && knopfNachWahl.beschriftung.indexOf("(Aue)") !== -1,
		"der KNOPF traegt die gewaehlte Stadt: " + (knopfNachWahl && knopfNachWahl.beschriftung));
	wahr(mod.garetienHandlungTitel("innerorts", mitListe).includes("Aue"),
		"...und der Tooltip ebenso -- zwei Erzeuger, ein Leser");
	const mitWahl = mod.garetienEingabenFuerServer(mitListe);
	tief(mitWahl, { innerorts: true, innerorts_public_id: "dorf-aue" },
		"⭐ DADURCH WIRKT INNERORTS UEBER DIE STAGE -- bis zum 07.09.2026 legte „Stage importieren\" "
		+ "nie eine Staette an, und der Einzelknopf war der einzige Weg dorthin");
	wahr(!("ziel" in mitWahl),
		"💣 UND KEIN `ziel`: avesmapsGaretienZielUebersteuern laeuft serverseitig VOR der "
		+ "Innerorts-Weiche und formte die Geometrie fuer ein Ziel um, das nie gebaut wird");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, false).includes("OHNE Position auf der Karte"),
		"und die Zeile darunter sagt, was das heisst -- sonst behauptet der Kasten weiter „Form: Ort\"");

	// --- Eine Wahl, die es nicht (mehr) gibt -----------------------------------------------
	mod.garetienEingabenAendern({
		target: {
			getAttribute: (name) => (name === "data-gi-feld" ? "innerorts" : null),
			hasAttribute: (name) => name === "data-gi-feld",
			value: "stadt-erfunden",
		},
	}, [mitListe]);
	gleich(mod.garetienInnerortsWahlZu(mitListe), "",
		"💣 eine Stadt, die NICHT in den Kandidaten steht, zaehlt nicht -- der frische Nachschlag "
		+ "kann die Liste unter einer stehenden Wahl austauschen. Serverseitig faengt derselbe "
		+ "Riegel den Fall noch einmal (avesmapsGaretienInnerortsAusVorschlag)");
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Wandleth", "...und der Knopf faellt auf die Vorauswahl zurueck");
	mod.garetienDetailWaehlen(null, []);
	mod.garetienInnerortsWahlVergessen();
}

pruefeKlick().then(() => {
	pruefeUebernommen();
	pruefeAuswahlfeld();
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
