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
	tief(leer, { gefunden: 0, verschwunden: [] });

	// 5. 💣 EIN FEHLSCHLAG LAESST DIE STAGE STEHEN -- lieber eine veraltete Stage als eine
	//    geleerte. Eine geleerte Stage nach einem Netzfehler waere der teurere Ausgang: die
	//    Arbeit einer halben Stunde.
	api.avesmapsGaretienStageHinzufuegen([{ key: "a", items: [{ id: 1 }] }]);
	const kaputterRuf = function () { return Promise.reject(new Error("Netz")); };
	const nachFehlschlag = await api.garetienStageNachschlagen(kaputterRuf);
	gleich(api.avesmapsGaretienStageHat("a"), true, "die Stage bleibt nach einem Fehlschlag stehen");
	tief(nachFehlschlag, { gefunden: 0, verschwunden: [] }, "und faellt OFFEN aus, statt zu werfen");

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
}

// ---------------------------------------------------------------------------------------------

const { api, dom } = ladeImporter(["garetien-run-state", "garetien-run-tile"]);

pruefeReineMechanik(api)
	.then(function () { pruefeAlteBereinigungWeg(); })
	.then(function () { return pruefeAnschlussLaufStarten(api, dom); })
	.then(function () {
		console.log("garetien-stage-nachschlagen: " + checks + " Pruefungen bestanden.");
	})
	.catch(function (fehler) {
		console.error(fehler && fehler.stack ? fehler.stack : fehler);
		process.exitCode = 1;
	});
