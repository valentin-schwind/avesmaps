// Aufgabe 6 des Garetien Importers (06.09.2026) -- die Stage überlebt einen Lauf.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-6-brief.md
//
// 🔴 DER STILLE FEHLER, DEN DAS BEHEBT: die Stage hält KOPIEN der Serverobjekte, samt ihrer
// `items[].id`. Nach einem „Holen & Rechnen" gehören diese Nummern einem ÜBERHOLTEN Lauf;
// `select`/`apply` filtern serverseitig auf `run_id = ? AND id IN (...)`, treffen null Zeilen,
// melden `done: true` -- und schreiben nichts. Kein Fehler, keine Meldung, der Knopf sieht aus,
// als hätte er gearbeitet. `garetienStageNachschlagen` schlägt die ganze Stage in EINEM Ruf am
// geltenden Lauf nach, ersetzt veraltete Item-Nummern und entfernt, was es dort nicht mehr gibt.
//
// Fixrunde 1 (06.09.2026): Brief .superpowers/sdd/2026-09-06-garetien-importer-stage/task-6-fix-1.md
//
// 🔴 DIE REGRESSION, DIE DIESE RUNDE BEHEBT: der Nachschlag oben fragt per `keys` nach, und `keys`
// schlägt serverseitig JEDEN Filter -- auch `stand`. Ein Objekt, das der Fussknopf gerade
// übernommen hat, findet der Server also weiterhin (nur mit `stand: "uebernommen"`), und die alte
// Regel "gefunden -> bleibt liegen" legte es zurück auf die Stage. Der Weg durchs Fenster ist aber
// Offen -> Stage -> „Stage importieren" -> Übernommen: was übernommen ist, hat die Stage
// verlassen. Bliebe es liegen, zählte der Fussknopf beim nächsten Klick Objekte mit, die schon auf
// der Karte stehen. `garetienStageNachschlagen` liest jetzt zusätzlich den frischen `stand`:
// „uebernommen"/„abgelehnt" nehmen das Objekt von der Stage, in ein EIGENES Feld (`fertig`) --
// nicht in `verschwunden`, denn das Objekt gibt es weiterhin, es ist nur fertig.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-stage-nachschlagen.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

// Ein Spion, der jede Anfrage zaehlt und die letzte Anfrage aufhebt -- reicht fuer alle reinen
// Zusicherungen unten, die alle mit GENAU EINEM Ruf auskommen.
function spion(antwort) {
	const rufe = function (adresse, rumpf) {
		rufe.anzahl++;
		rufe.adressen.push(adresse);
		rufe.letzterRumpf = rumpf;
		return Promise.resolve(antwort);
	};
	rufe.anzahl = 0;
	rufe.adressen = [];
	rufe.letzterRumpf = null;
	return rufe;
}

// ---------------------------------------------------------------------------------------------
// A. Die reine Mechanik von `garetienStageNachschlagen` selbst.
// ---------------------------------------------------------------------------------------------
async function pruefeReineMechanik(api) {
	// 1. Nach einem Lauf wird die Stage per `keys` nachgeschlagen -- EIN Ruf, nicht einer je
	//    Objekt (bei 200 gestagten Objekten waeren 200 Anfragen genau die Endpunktschleife, vor
	//    der AGENTS.md fuer STRATO warnt).
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([
		{ key: "a", items: [{ id: 1 }] },
		{ key: "b", items: [{ id: 2 }] },
	]);
	const rufe = spion({ objekte: [{ key: "a", items: [{ id: 77 }], stand: "offen" }] });
	const ergebnis = await api.garetienStageNachschlagen(rufe);
	gleich(rufe.anzahl, 1, "genau ein Ruf, nicht einer je gestagtem Objekt");
	gleich(rufe.adressen[0], "/api/edit/map/garetien-import.php", "gegen die lesende Adresse");
	tief(rufe.letzterRumpf.keys, ["a", "b"], "beide Stage-Schluessel im Rumpf, in Einfuege-Reihenfolge");
	gleich(rufe.letzterRumpf.action, "liste");

	// 2. 💣 DIE FRISCHEN ITEM-NUMMERN ERSETZEN DIE ALTEN -- der ganze Zweck dieser Aufgabe. Ohne
	//    das schickte der naechste Import die Nummern des UEBERHOLTEN Laufs weiter -- ein
	//    stiller Leerlauf, der `done: true` meldet und nichts schreibt.
	const objektA = api.avesmapsGaretienStageListe().find(function (o) { return o.key === "a"; });
	tief(objektA.items.map(function (i) { return i.id; }), [77]);

	// 3. Was es im neuen Lauf nicht mehr gibt, verlaesst die Stage.
	tief(ergebnis.verschwunden, ["b"]);
	gleich(api.avesmapsGaretienStageHat("b"), false);
	gleich(ergebnis.gefunden, 1, "`gefunden` zaehlt, was der Server wirklich zurueckgegeben hat");

	// 4. Eine LEERE Stage ruft gar nicht -- kein Endpunkt-Aufruf fuer nichts.
	api.avesmapsGaretienStageLeeren();
	const rufe2 = spion({ objekte: [] });
	const leer = await api.garetienStageNachschlagen(rufe2);
	gleich(rufe2.anzahl, 0, "ohne Stage kein Ruf");
	tief(leer, { gefunden: 0, verschwunden: [], fertig: [] });

	// 5. 💣 EIN FEHLSCHLAG LAESST DIE STAGE STEHEN -- lieber eine veraltete Stage als eine
	//    geleerte. Eine geleerte Stage nach einem Netzfehler waere der teurere Ausgang: die
	//    Arbeit einer halben Stunde.
	api.avesmapsGaretienStageHinzufuegen([{ key: "a", items: [{ id: 1 }] }]);
	const kaputterRuf = function () { return Promise.reject(new Error("Netz")); };
	const nachFehlschlag = await api.garetienStageNachschlagen(kaputterRuf);
	gleich(api.avesmapsGaretienStageHat("a"), true, "die Stage bleibt nach einem Fehlschlag stehen");
	tief(nachFehlschlag, { gefunden: 0, verschwunden: [], fertig: [] }, "und faellt OFFEN aus, statt zu werfen");

	// 6. 💣 DER RUMPF TRAEGT KEINEN FILTER. `keys` schlaegt serverseitig jeden Filter UND die
	//    Seitenaufteilung (avesmapsGaretienListeFilterHatKeys); ein zweites Klarsetzen im Client
	//    waere eine zweite Wahrheit ueber dieselbe Regel, und die zweite veraltet.
	api.avesmapsGaretienStageHinzufuegen([{ key: "c", items: [{ id: 3 }] }]);
	const rufe3 = spion({ objekte: [{ key: "c", items: [{ id: 3 }], stand: "offen" }] });
	await api.garetienStageNachschlagen(rufe3);
	["ebene", "typ", "urteil", "wiki", "suche", "stand", "versatz", "anzahl", "nur_ungehakt"]
		.forEach(function (feld) {
			wahr(!(feld in rufe3.letzterRumpf), "kein Filterfeld im Rumpf: " + feld);
		});
}

// ---------------------------------------------------------------------------------------------
// A2. Fixrunde 1 (06.09.2026): „uebernommen"/„abgelehnt" verlassen die Stage, ohne als
//     „verschwunden" zu gelten -- die vier Zusicherungen des Fix-Briefs.
// ---------------------------------------------------------------------------------------------
async function pruefeFertigeStaende(api) {
	// Zusicherung 1: ein Objekt, dessen frischer Stand "uebernommen" ist, liegt danach NICHT mehr
	// auf der Stage und steht im neuen Feld `fertig` -- NICHT in `verschwunden`.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "u", items: [{ id: 1 }] }]);
	const rufeU = spion({ objekte: [{ key: "u", items: [{ id: 1 }], stand: "uebernommen" }] });
	const ergebnisU = await api.garetienStageNachschlagen(rufeU);
	gleich(api.avesmapsGaretienStageHat("u"), false, "ein uebernommenes Objekt verlaesst die Stage");
	tief(ergebnisU.fertig, ["u"], "…und steht im Feld `fertig`");
	tief(ergebnisU.verschwunden, [], "…NICHT im Feld `verschwunden` -- es gibt es ja noch");

	// Zusicherung 2: dasselbe fuer "abgelehnt".
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "a", items: [{ id: 2 }] }]);
	const rufeA = spion({ objekte: [{ key: "a", items: [{ id: 2 }], stand: "abgelehnt" }] });
	const ergebnisA = await api.garetienStageNachschlagen(rufeA);
	gleich(api.avesmapsGaretienStageHat("a"), false, "ein abgelehntes Objekt verlaesst die Stage");
	tief(ergebnisA.fertig, ["a"], "…und steht im Feld `fertig`");
	tief(ergebnisA.verschwunden, [], "…NICHT im Feld `verschwunden`");

	// Zusicherung 3 (= Zusicherung 2 der Aufgabe 6, muss weiter halten): ein Objekt mit Stand
	// "offen" bleibt liegen und behaelt seine frischen Item-Nummern.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "o", items: [{ id: 3 }] }]);
	const rufeO = spion({ objekte: [{ key: "o", items: [{ id: 33 }], stand: "offen" }] });
	const ergebnisO = await api.garetienStageNachschlagen(rufeO);
	gleich(api.avesmapsGaretienStageHat("o"), true, "ein offenes Objekt bleibt auf der Stage");
	tief(ergebnisO.fertig, [], "…und zaehlt nicht als fertig");
	const objektO = api.avesmapsGaretienStageListe().find(function (o) { return o.key === "o"; });
	tief(objektO.items.map(function (i) { return i.id; }), [33], "…mit den frischen Item-Nummern");

	// Zusicherung 4: ein UNBEKANNTER Stand laesst das Objekt liegen -- die sichere Richtung,
	// ausdruecklich geprueft. "Alles ausser offen" waere eine Aussage ueber einen Stand, den es
	// heute noch nicht gibt; die Liste ist benannt, kein `!== "offen"`.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "x", items: [{ id: 4 }] }]);
	const rufeX = spion({ objekte: [{ key: "x", items: [{ id: 44 }], stand: "nagelneu_und_unbekannt" }] });
	const ergebnisX = await api.garetienStageNachschlagen(rufeX);
	gleich(api.avesmapsGaretienStageHat("x"), true,
		"ein unbekannter Stand laesst das Objekt liegen, statt es fuer 'fertig' zu halten");
	tief(ergebnisX.fertig, [], "…und zaehlt nicht als fertig");
	tief(ergebnisX.verschwunden, [], "…und auch nicht als verschwunden -- der Server kennt es ja");

	// Und dasselbe fuer ein Objekt OHNE jeden `stand` (undefined) -- derselbe sichere Fall.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "y", items: [{ id: 5 }] }]);
	const rufeY = spion({ objekte: [{ key: "y", items: [{ id: 55 }] }] });
	await api.garetienStageNachschlagen(rufeY);
	gleich(api.avesmapsGaretienStageHat("y"), true, "…auch ganz ohne `stand`-Feld");

	// Ein gemischter Lauf: verschwunden, fertig und offen kommen zusammen vor und werden nicht
	// vermischt.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([
		{ key: "v", items: [{ id: 10 }] },   // verschwindet (kommt in der Antwort nicht vor)
		{ key: "f", items: [{ id: 11 }] },   // wird fertig (uebernommen)
		{ key: "b", items: [{ id: 12 }] },   // bleibt offen
	]);
	const rufeGemischt = spion({
		objekte: [
			{ key: "f", items: [{ id: 111 }], stand: "uebernommen" },
			{ key: "b", items: [{ id: 122 }], stand: "offen" },
		],
	});
	const gemischt = await api.garetienStageNachschlagen(rufeGemischt);
	tief(gemischt.verschwunden, ["v"]);
	tief(gemischt.fertig, ["f"]);
	gleich(api.avesmapsGaretienStageHat("v"), false);
	gleich(api.avesmapsGaretienStageHat("f"), false);
	gleich(api.avesmapsGaretienStageHat("b"), true);

	// Zusicherung 5 (Teil 1, reine Funktion): der kombinierte Satz nennt BEIDE Faelle getrennt,
	// mit ihren eigenen Zahlen -- kein gemeinsamer Topf.
	const satzBeide = api.garetienStageNachschlagSatz({ verschwunden: ["v"], fertig: ["f", "g"] });
	wahr(satzBeide.includes("1 Objekt") && satzBeide.includes("im neuen Lauf nicht mehr"),
		"…nennt die verschwundenen (1) -- gelesen: " + satzBeide);
	wahr(satzBeide.includes("2 Objekte") && satzBeide.includes("uebernommen oder abgelehnt"),
		"…UND die fertigen (2), als eigenen Satz -- gelesen: " + satzBeide);
	gleich(api.garetienStageNachschlagSatz({ verschwunden: [], fertig: [] }), "",
		"ohne jeden Fund bleibt der Satz leer -- ein Aufrufer darf ihn dann ignorieren");
	gleich(api.garetienStageNachschlagSatz({ verschwunden: [], fertig: ["f"] }),
		api.garetienStageFertigSatz(1), "nur fertig -- derselbe Satz wie der eigene Bauer, ohne Anhaengsel");

	// -----------------------------------------------------------------------------------------
	// Fixrunde 2 (07.09.2026), D1: „haten" ist kein Wort. Der Bericht der Fixrunde 1 behauptete
	// die richtige Beugung -- geprueft hatten das bis hierher nur `includes`-Teilstuecke
	// (Zeile 190 oben: "uebernommen oder abgelehnt" UND "2 Objekte", nie der ANSCHLUSS
	// dazwischen). Eine Behauptung ueber einen erzeugten Satz ist keine Messung, solange der
	// Satz nicht erzeugt wurde -- hier steht deshalb der VOLLSTAENDIGE Satz, zeichengleich.
	// -----------------------------------------------------------------------------------------
	gleich(api.garetienStageFertigSatz(1),
		"1 Objekt auf der Stage ist bereits uebernommen oder abgelehnt und hat die Stage verlassen.",
		"der volle Satz fuer n=1, zeichengleich -- nicht nur ein Teilstueck");
	gleich(api.garetienStageFertigSatz(2),
		"2 Objekte auf der Stage sind bereits uebernommen oder abgelehnt und haben die Stage verlassen.",
		"der volle Satz fuer n=2, zeichengleich -- \"haben\", nicht die alte Verstuemmelung \"haten\"");

	// -----------------------------------------------------------------------------------------
	// Fixrunde 2 (07.09.2026), D2 (reine Haelfte): `garetienStageNachschlagOhneEigene` rechnet
	// GENAU die genannten Schluessel aus `fertig` heraus, laesst `verschwunden` unberuehrt und
	// tut bei einer leeren Menge nichts.
	// -----------------------------------------------------------------------------------------
	tief(
		api.garetienStageNachschlagOhneEigene({ verschwunden: ["v"], fertig: ["a", "b", "c"] }, ["b"]),
		{ verschwunden: ["v"], fertig: ["a", "c"] },
		"genau der genannte Schluessel verschwindet aus `fertig`, `verschwunden` bleibt unberuehrt"
	);
	tief(
		api.garetienStageNachschlagOhneEigene({ verschwunden: [], fertig: ["a", "b"] }, ["a", "b"]),
		{ verschwunden: [], fertig: [] },
		"ALLE genannten Schluessel koennen `fertig` restlos leeren"
	);
	const ungefiltert = { verschwunden: ["v"], fertig: ["a"] };
	gleich(api.garetienStageNachschlagOhneEigene(ungefiltert, []), ungefiltert,
		"eine LEERE Schluesselmenge liefert dasselbe Objekt zurueck -- keine unnoetige Kopie");
	gleich(api.garetienStageNachschlagOhneEigene(ungefiltert, undefined), ungefiltert,
		"…und dasselbe gilt ganz ohne zweites Argument");
	tief(
		api.garetienStageNachschlagOhneEigene({ fertig: ["a"] }, ["fremd"]),
		{ fertig: ["a"] },
		"ein Schluessel, der gar nicht in `fertig` steht, aendert nichts"
	);
}

// ---------------------------------------------------------------------------------------------
// B. 🔴 ZUSICHERUNG 7: alle drei Aufrufstellen der abgeloesten Bereinigung gehen auf den neuen
//    Weg -- im KOMMENTARFREIEN Quelltext kommt `avesmapsGaretienStageNachEinfuegenBereinigen`
//    nicht mehr vor. Eine Regel, die einen von drei Erzeugern bindet, ist keine Regel.
//
// 🔴 ZEILENENDENNEUTRAL: die Arbeitskopie traegt CRLF, `actions/checkout` legt LF hin (AGENTS.md
// §9) -- deshalb zuerst vereinheitlichen, dann erst kommentarfrei machen (Vorbild:
// garetien-vokabular.test.js, das denselben Griff gegen dieselbe Datei fährt).
// ---------------------------------------------------------------------------------------------
function liesKommentarfrei(relPfad) {
	const wurzel = path.resolve(__dirname, "..", "..", "..");
	return fs.readFileSync(path.join(wurzel, relPfad), "utf8")
		.replace(/\r\n/g, "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
}

function pruefeAlteBereinigungWeg() {
	const quelle = liesKommentarfrei("js/review/review-garetien-importer.js");
	gleich(quelle.includes("avesmapsGaretienStageNachEinfuegenBereinigen"), false,
		"die abgeloeste Bereinigung darf im kommentarfreien Quelltext nicht mehr vorkommen -- "
		+ "weder als Definition noch an einer ihrer drei Stellen (zwei Import-Ketten, ein Export)");
	// Und die Nachfolgerin steht wirklich an allen fuenf erwarteten Stellen: Definition, Export,
	// und den drei Aufrufen (garetienLaufStarten, garetienNeuKlick, garetienFussknopfEinfuegenKlick).
	// Faellt eine davon auf die alte Bereinigung zurueck, sinkt die Zaehlung unter 5.
	const vorkommen = quelle.split("garetienStageNachschlagen").length - 1;
	wahr(vorkommen >= 5,
		"garetienStageNachschlagen sollte an mindestens 5 Stellen stehen (Definition, Export, "
		+ "drei Aufrufe) -- gefunden: " + vorkommen);
}

// ---------------------------------------------------------------------------------------------
// C. 🔴 DIE ANSCHLUSSSTELLE `garetienLaufStarten` -- „Beide melden Verschwundene über
//    `garetienStatusSetzen`" (Brief). Die reine Funktion selbst setzt keinen Status (Schritt 3
//    des Briefs zeigt das explizit); das Melden ist Sache der Anschlussstellen. Diese Probe
//    fährt die ECHTE Verdrahtung, nicht eine Behauptung über sie -- eine Zusicherung, die nur
//    den Rueckgabewert von `garetienStageNachschlagen` liest, saehe eine vergessene Anbindung
//    nie.
// ---------------------------------------------------------------------------------------------
function spionLauf(nachschlagAntwort) {
	return function (adresse, rumpf) {
		const action = (rumpf && rumpf.action) || "";
		if (action === "fetch") { return Promise.resolve({ ok: true, run_id: 7, fehler: [] }); }
		if (action === "plan") {
			return Promise.resolve({
				ok: true, plan_run_id: 42,
				staging_aufgeraeumt: { laeufe: 0, zeilen: 0, waisen: 0, offen: 0 },
			});
		}
		if (action === "runs") {
			return Promise.resolve({
				ok: true,
				runs: [{ id: 7, started_at: "2026-09-06 10:00:00", finished_at: "2026-09-06 10:05:00", status: "done", zeilen: 1 }],
			});
		}
		if (action === "liste") { return Promise.resolve(nachschlagAntwort); }
		return Promise.resolve({ ok: true });
	};
}

async function pruefeAnschlussLaufStarten(api, dom) {
	const listeHolen = function () { return Promise.resolve({ ok: true }); };

	// 1. Ein Objekt, das im frischen Lauf nicht mehr auftaucht: verlaesst die Stage UND wird in
	//    der Statuszeile genannt -- nichts anderes in `garetienLaufStarten` schreibt danach
	//    dorthin, also ueberlebt die Meldung den restlichen Ablauf.
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "weg:1", items: [{ id: 9 }] }]);
	await api.garetienLaufStarten(
		spionLauf({ objekte: [] }), ["ggp:Gewaesser"], api.garetienLaufKachelAktualisieren, listeHolen
	);
	gleich(api.avesmapsGaretienStageHat("weg:1"), false, "die ausgeschiedene Zeile verlaesst die Stage");
	wahr(dom.text("#garetien-status-text").includes("gibt es im neuen Lauf nicht mehr"),
		'und wird genannt -- gelesen wurde: "' + dom.text("#garetien-status-text") + '"');

	// 2. ⚠️ OHNE Verschwundene bleibt eine bestehende Statuszeile UNANGETASTET -- ein Aufruf mit
	//    `anzahl === 0` ueberschriebe sonst grundlos eine aeltere, vielleicht wichtigere Meldung
	//    (etwa den Erfolg des letzten Einfuegens).
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "weg:2", items: [{ id: 11 }] }]);
	dom.el("#garetien-status-text").textContent = "Vorherige Meldung";
	await api.garetienLaufStarten(
		spionLauf({ objekte: [{ key: "weg:2", items: [{ id: 12 }], stand: "offen" }] }),
		["ggp:Gewaesser"], api.garetienLaufKachelAktualisieren, listeHolen
	);
	gleich(dom.text("#garetien-status-text"), "Vorherige Meldung",
		"ohne Verschwundene bleibt eine bestehende Statusmeldung unangetastet");
	gleich(api.avesmapsGaretienStageHat("weg:2"), true, "das Objekt bleibt auf der Stage");
	const stageObjekt = api.avesmapsGaretienStageListe().find(function (o) { return o.key === "weg:2"; });
	tief(stageObjekt.items.map(function (i) { return i.id; }), [12], "und seine Item-Nummer ist frisch");

	// 3. Fixrunde 1, Zusicherung 5 END-TO-END: verschwunden UND fertig treten in DEMSELBEN Lauf
	//    auf und werden in der Statuszeile GETRENNT genannt, mit ihren eigenen Zahlen -- nicht als
	//    ein gemeinsames "3 Objekte ...".
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([
		{ key: "weg:3", items: [{ id: 20 }] },   // verschwindet
		{ key: "weg:4", items: [{ id: 21 }] },   // wird uebernommen
	]);
	await api.garetienLaufStarten(
		spionLauf({ objekte: [{ key: "weg:4", items: [{ id: 210 }], stand: "uebernommen" }] }),
		["ggp:Gewaesser"], api.garetienLaufKachelAktualisieren, listeHolen
	);
	const statusText3 = dom.text("#garetien-status-text");
	gleich(api.avesmapsGaretienStageHat("weg:3"), false, "die verschwundene Zeile ist weg");
	gleich(api.avesmapsGaretienStageHat("weg:4"), false, "die uebernommene Zeile ist ebenfalls weg");
	wahr(statusText3.includes("1 Objekt") && statusText3.includes("im neuen Lauf nicht mehr"),
		'nennt "verschwunden" -- gelesen: "' + statusText3 + '"');
	wahr(statusText3.includes("1 Objekt") && statusText3.includes("uebernommen oder abgelehnt"),
		'UND nennt "fertig", als eigenen Satz -- gelesen: "' + statusText3 + '"');
}

// ---------------------------------------------------------------------------------------------
// D. Fixrunde 2 (07.09.2026), D2+D3: dieselbe Endezu-Ende-Probe wie Abschnitt C, jetzt an den
//    ZWEI EINFUEGE-Aufrufstellen (garetienNeuKlick/„innerorts", garetienFussknopfEinfuegenKlick).
//    Vorher hatte NUR garetienLaufStarten (Abschnitt C) eine Zusicherung auf den resultierenden
//    Statustext -- ein vertauschtes Trennzeichen oder eine falsche Variable an den anderen beiden
//    fiel keinem Test auf (D3). Zugleich die END-TO-END-Probe des D2-Fixes: eine erfolgreiche
//    Einfuege-Handlung darf sich nicht selbst als „bereits uebernommen oder abgelehnt" melden --
//    der HAEUFIGSTE Fall, gemessen am ausgefuehrten Modul (D2-Brief).
//
// ⚠️ ABWEICHUNG, GEMESSEN: Zusicherung 2 des Briefs ("ein FREMDES Objekt bleibt gemeldet") wird
//    hier nur an EINER Stelle (garetienNeuKlick/„innerorts") end-to-end nachgestellt. Am
//    Fussknopf verarbeitet `garetienFussknopfEinfuegenKlick` per Definition die GANZE aktuelle
//    Stage (`avesmapsGaretienStageListe()`) -- ein "fremdes" Objekt DANEBEN gaebe es dort nur
//    ueber eine Wettlaufbedingung (die Stage aendert sich WAEHREND der laufenden Kette), und das
//    waere ein Test einer anderen, ungebauten Sache. Die Filterung selbst ist an beliebigen
//    Schluesselmengen bereits rein getestet (Abschnitt A2); hier zaehlt fuer den Fussknopf nur
//    Zusicherung 1.
// ---------------------------------------------------------------------------------------------

/** Ein `fetch`, das select/apply/liste(+keys)/liste unterscheidet -- dieselbe Form wie `machFetch`
 *  in garetien-fussknopf-dom.test.js, hier lokal nachgebaut, weil diese Datei ihre Anfragen sonst
 *  ueber `spion`/`spionLauf` faengt, die kein `select`/`apply` kennen. */
function fetchFuerEinfuegen(nachschlagAntwort) {
	return function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		let daten;
		if (rumpf.action === "select") {
			daten = { ok: true };
		} else if (rumpf.action === "apply") {
			daten = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		} else if (rumpf.action === "liste" && Array.isArray(rumpf.keys)) {
			daten = Object.assign({ ok: true }, nachschlagAntwort);
		} else {
			daten = { ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} };
		}
		return Promise.resolve({ json: function () { return Promise.resolve(daten); } });
	};
}

// Ein Klick-Ereignis fuer garetienNeuKlick("innerorts") -- derselbe minimalistische Aufbau wie in
// garetien-innerorts-knopf.test.js, hier nur fuer den EINEN gebrauchten Knopfnamen.
function ereignisInnerorts(schluessel) {
	const knopf = {
		disabled: false,
		textContent: "",
		getAttribute: function (name) {
			if (name === "data-handlung") { return "innerorts"; }
			if (name === "data-key") { return schluessel; }
			return null;
		},
		closest: function (auswahl) {
			return auswahl === '[data-handlung="innerorts"]' ? knopf : null;
		},
	};
	return { target: knopf };
}

const OBJEKT_INNERORTS = {
	key: "ggp:Bauwerke:Tempel:1", name: "Wandlether Tempel", urteil: "neu",
	innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09 },
	items: [{ id: 900, change_type: "new" }],
};

async function pruefeAnschlussNeuKlick(api, dom) {
	const echtesFetch = global.fetch;
	try {
		// 1. Der NORMALFALL: „Innerorts einfügen" bearbeitet GENAU dieses eine Objekt -- der
		//    Nachschlag findet es folgerichtig als „fertig" wieder, und die Meldung darf das
		//    NICHT ein zweites Mal aussprechen.
		api.avesmapsGaretienStageLeeren();
		api.avesmapsGaretienStageHinzufuegen([OBJEKT_INNERORTS]);
		global.fetch = fetchFuerEinfuegen({
			objekte: [Object.assign({}, OBJEKT_INNERORTS, { stand: "uebernommen" })],
		});
		await api.garetienNeuKlick(ereignisInnerorts(OBJEKT_INNERORTS.key), [OBJEKT_INNERORTS], 7, null);
		const text1 = dom.text("#garetien-status-text");
		wahr(text1.indexOf("importiert") !== -1, "die Erfolgsmeldung steht -- gelesen: " + text1);
		gleich(text1.indexOf("bereits uebernommen oder abgelehnt"), -1,
			'🔴 D2: das soeben eingefuegte Objekt darf sich nicht selbst als "fertig" melden -- gelesen: "'
			+ text1 + '"');

		// 2. Liegt DANEBEN ein FREMDES Objekt, das der Nachschlag ALS FERTIG meldet, bleibt es
		//    genannt -- der Filter trifft nur den einen soeben bearbeiteten Schluessel.
		api.avesmapsGaretienStageLeeren();
		api.avesmapsGaretienStageHinzufuegen([OBJEKT_INNERORTS, { key: "fremd:1", items: [{ id: 1 }] }]);
		global.fetch = fetchFuerEinfuegen({
			objekte: [
				Object.assign({}, OBJEKT_INNERORTS, { stand: "uebernommen" }),
				{ key: "fremd:1", items: [{ id: 1 }], stand: "abgelehnt" },
			],
		});
		await api.garetienNeuKlick(ereignisInnerorts(OBJEKT_INNERORTS.key), [OBJEKT_INNERORTS], 7, null);
		const text2 = dom.text("#garetien-status-text");
		wahr(text2.indexOf("1 Objekt") !== -1 && text2.indexOf("bereits uebernommen oder abgelehnt") !== -1,
			'ein FREMDES fertiges Objekt bleibt genannt -- gelesen: "' + text2 + '"');
	} finally {
		global.fetch = echtesFetch;
	}
}

async function pruefeAnschlussFussknopf(api, dom) {
	const echtesFetch = global.fetch;
	try {
		const stageObjekt = { key: "ggp:Gewaesser:9", items: [{ id: 501, selected: 0 }] };

		// Der Regelfall aus dem D2-Brief: der Fussknopf verarbeitet PER DEFINITION genau die
		// Stage -- nach erfolgreichem `apply` findet der Nachschlag GENAU dieses Objekt als
		// „fertig", und die Meldung darf das nicht ein zweites Mal aussprechen. Das ist die
		// Verdopplung, die vor dieser Fixrunde JEDEM erfolgreichen Import widerfuhr.
		api.avesmapsGaretienStageLeeren();
		api.avesmapsGaretienStageHinzufuegen([stageObjekt]);
		global.fetch = fetchFuerEinfuegen({
			objekte: [Object.assign({}, stageObjekt, { stand: "uebernommen" })],
		});
		await api.garetienFussknopfEinfuegenKlick(7, function () { return true; });
		const text1 = dom.text("#garetien-status-text");
		wahr(text1.indexOf("importiert") !== -1, "die Erfolgsmeldung steht -- gelesen: " + text1);
		gleich(text1.indexOf("bereits uebernommen oder abgelehnt"), -1,
			'🔴 D2: „Stage importieren" meldet die soeben eingefuegten Objekte nicht ein zweites Mal '
			+ 'als "fertig" -- gelesen: "' + text1 + '"');
	} finally {
		global.fetch = echtesFetch;
	}
}

// ---------------------------------------------------------------------------------------------
// E. Fixrunde 2 (07.09.2026), D4: der Nachschlag fragt am LAUF (`zustand.importRunId`) nach,
//    nicht am PLAN (`zustand.planRunId`) -- beide leben im selben Modul und werden fuer
//    select/apply gebraucht (der Rumpf trennt sie: `run_id: runId` dort, `run_id:
//    zustand.importRunId` im Nachschlag). Die alte Zusicherung dafuer ist beim Umbau
//    weggefallen.
// ---------------------------------------------------------------------------------------------
async function pruefeRunIdImRumpf(api) {
	const listeHolen = function () { return Promise.resolve({ ok: true }); };
	const gesehen = { rumpf: null };
	const rufe = function (adresse, rumpf) {
		if (rumpf && rumpf.action === "fetch") { return Promise.resolve({ ok: true, run_id: 1234, fehler: [] }); }
		if (rumpf && rumpf.action === "plan") {
			return Promise.resolve({
				ok: true, plan_run_id: 9999,
				staging_aufgeraeumt: { laeufe: 0, zeilen: 0, waisen: 0, offen: 0 },
			});
		}
		if (rumpf && rumpf.action === "runs") {
			return Promise.resolve({
				ok: true,
				runs: [{ id: 1234, started_at: "2026-09-07 10:00:00", finished_at: "2026-09-07 10:05:00", status: "done", zeilen: 1 }],
			});
		}
		if (rumpf && rumpf.action === "liste") {
			gesehen.rumpf = rumpf;
			return Promise.resolve({ objekte: [] });
		}
		return Promise.resolve({ ok: true });
	};

	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([{ key: "z", items: [{ id: 1 }] }]);
	await api.garetienLaufStarten(rufe, ["ggp:Gewaesser"], api.garetienLaufKachelAktualisieren, listeHolen);

	wahr(gesehen.rumpf !== null, "der Stage-Nachschlag hat wirklich einen `liste`-Ruf ausgeloest");
	gleich(gesehen.rumpf.run_id, 1234,
		"🔴 D4: `run_id` im Rumpf ist `zustand.importRunId` (der LAUF aus `action:'fetch'`, hier 1234)");
	gleich(gesehen.rumpf.run_id === 9999, false,
		"…und NICHT `zustand.planRunId` (der PLAN aus `action:'plan'`, hier 9999) -- die alte "
		+ "Zusicherung dafuer fiel beim Umbau weg");
}

// ---------------------------------------------------------------------------------------------

const { api, dom } = ladeImporter(["garetien-run-state", "garetien-run-tile"]);

pruefeReineMechanik(api)
	.then(function () { return pruefeFertigeStaende(api); })
	.then(function () { pruefeAlteBereinigungWeg(); })
	.then(function () { return pruefeAnschlussLaufStarten(api, dom); })
	.then(function () { return pruefeAnschlussNeuKlick(api, dom); })
	.then(function () { return pruefeAnschlussFussknopf(api, dom); })
	.then(function () { return pruefeRunIdImRumpf(api); })
	.then(function () {
		console.log("garetien-stage-nachschlagen: " + checks + " Pruefungen bestanden.");
	})
	.catch(function (fehler) {
		console.error(fehler && fehler.stack ? fehler.stack : fehler);
		process.exitCode = 1;
	});
