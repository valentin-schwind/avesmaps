// Innerorts im Garetien Importer -- Befund-Leser, Siedlungsfeld und der Weg einer Staette.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4
// 🔴 SEIT DEM 14.09.2026 OHNE DEN KNOPF „Innerorts einfügen (Stadt)": er schrieb ohne Rueckfrage in die
// Karte (Befund `innerorts-sofort`). Die Staette waehlt jetzt die Zielwahl („Stätte in X",
// docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-innerorts-knopf.test.js
//
// 🔴 Geprueft werden die REINEN Haelften (Befund-Leser, Knopfleiste, Tooltip, Listenzeile, Hinweis)
// UND der Weg der Wahl bis in den Anfragerumpf -- ausgefuehrt ueber garetienEingabenAendern, nicht
// am Quelltext gelesen. Den Ablauf ueber den Fussknopf faehrt garetien-import-verdrahtung.test.js (B).

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

["garetienInnerortsOrt", "garetienHandlungen", "garetienHandlungTitel", "garetienHandlungsRumpf",
	"garetienZielwahlSetzen", "garetienZielwahlMarkup", "avesmapsGaretienStageHinzufuegen",
	"avesmapsGaretienStageLeeren", "garetienZielwahlVergessen",
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
// B. Die Knopfleiste -- „Innerorts einfügen (X)" IST GEFALLEN (14.09.2026)
// =================================================================================================
// 🔴 Er war der einzige Knopf, der ohne Rueckfrage in die Karte schrieb -- schon auf „Offen", neben
// einem Tooltip, der verspricht, dass nichts geschrieben wird, bis „Stage importieren" gedrueckt ist.
// Was er konnte, kann die Zielwahl („Stätte in X"), und die geht ueber die Stage -- gefahren in
// garetien-zielwahl-ziele.test.js (C, E) und garetien-import-verdrahtung.test.js (B).
tief(namen(mitBefund), ["stage", "ablehnen"], "🔴 auch MIT Befund steht kein Innerorts-Knopf mehr da");
tief(namen(ohneBefund), ["stage", "ablehnen"], "ohne Befund ebenso");
tief(namen(altLauf), ["stage", "ablehnen"], "ein alter Lauf ebenso");
gleich(mod.garetienHandlungsRumpf("innerorts", mitBefund, 7), null,
	"💣 und die TUER bleibt zu, auch wenn jemand „innerorts\" von Hand schickt");
gleich(mod.garetienHandlungTitel("innerorts", mitBefund), "", "…und es gibt keinen Tooltip mehr dafuer");

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
	stand: "offen",
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
	gleich(zeile.indexOf("— auf die Karte —"), -1,
		"🔴 SEIT DEM 14.09.2026 KEIN „— auf die Karte —\": das entscheidet die Zielwahl, nicht dieses Feld");
	wahr(zeile.includes('class="gi-insert__row gi-insert__row--aus">Siedlung')
		&& /data-gi-feld="innerorts"[^>]* disabled/.test(zeile),
		"💣 solange die Zielwahl „Auf die Karte\" ist, ist die Siedlung ABGEBLENDET -- eine vorbelegte Stadt "
		+ "legte beim naechsten „Stage importieren\" sonst still Staetten an: " + zeile);
	wahr(zeile.indexOf("Aue · 0,03 Meilen") < zeile.indexOf("Wandleth · 0,09 Meilen"),
		"beide Staedte stehen drin, in der Reihenfolge des Servers");
	wahr(/<option value="stadt-wandleth" selected>/.test(zeile),
		"vorgewaehlt ist die Vorauswahl des Servers -- nicht die naechste Siedlung");
	wahr(!zeile.includes("Wird als Stätte in"),
		"...und das Feld behauptet keine Staette -- das sagt die Zielwahl selbst");
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
	// ⚠️ Das Objekt liegt dafuer auf der Stage: dort -- und nur dort -- ist die Einzelansicht einstellbar.
	mod.avesmapsGaretienStageHinzufuegen([mitListe]);
	mod.garetienDetailWaehlen(mitListe.key, [mitListe]);
	const feld = (name, wert) => ({ target: {
		getAttribute: (a) => (a === "data-gi-feld" ? name : null),
		hasAttribute: (a) => a === "data-gi-feld",
		value: wert,
	} });
	mod.garetienEingabenAendern(feld("innerorts", "dorf-aue"), [mitListe]);
	gleich(mod.garetienInnerortsWahlZu(mitListe), "dorf-aue", "die Wahl liegt neben dem DOM und haelt");
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Aue", "🔴 und der Leser nennt jetzt SIE");
	wahr(!("innerorts" in mod.garetienEingabenFuerServer(mitListe)),
		"💣 EINE GEWAEHLTE SIEDLUNG ALLEIN IST KEINE STAETTE -- das sagt erst die Zielwahl");
	mod.garetienEingabenAendern(feld("zielwahl", "staette"), [mitListe]);
	// 💣 AN DER ZIELWAHL SELBST GEMESSEN, nicht nur am Leser dahinter: sagte die Zeile „Stätte in
	// Wandleth", waehrend die Anfrage „dorf-aue" schickt, waere genau die Verwechslung zurueck, gegen die
	// der Ortsname ueberhaupt in der Zeile steht (Mutationsprobe 07.09.2026, damals am Knopf).
	wahr(mod.garetienZielwahlMarkup(mitListe).includes("Stätte in „Aue“"),
		"die Zielwahl traegt die gewaehlte Siedlung: " + mod.garetienZielwahlMarkup(mitListe));
	const mitWahl = mod.garetienEingabenFuerServer(mitListe);
	tief(mitWahl, { innerorts: true, innerorts_public_id: "dorf-aue" },
		"⭐ DADURCH WIRKT INNERORTS UEBER DIE STAGE: " + JSON.stringify(mitWahl));
	wahr(!("ziel" in mitWahl),
		"💣 UND KEIN `ziel`: avesmapsGaretienZielUebersteuern laeuft serverseitig VOR der "
		+ "Innerorts-Weiche und formte die Geometrie fuer ein Ziel um, das nie gebaut wird");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, false).includes('class="gi-insert__row">Siedlung'),
		"und mit „Stätte\" ist die Siedlung bedienbar");

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
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Wandleth", "...und der Leser faellt auf die Vorauswahl zurueck");
	mod.garetienDetailWaehlen(null, []);
	mod.garetienInnerortsWahlVergessen();
	mod.garetienZielwahlVergessen();
	mod.avesmapsGaretienStageLeeren();
}

Promise.resolve().then(() => {
	pruefeUebernommen();
	pruefeAuswahlfeld();
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
