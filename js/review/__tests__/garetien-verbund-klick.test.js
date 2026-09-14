// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Verbund-Knopf, samt seinem EIGENEN
// Klick-Verteiler (garetienVerbundKlick).
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-8-brief.md
//
// 🔴 UMGEBAUT AM 14.09.2026 (Garetien-Importer vereint, Aufgaben 6 und 7): der Knopf heisst
// „Zusammenlegen (n)" / „Verbund auflösen (n)", steht NICHT mehr in der Handlungsleiste, sondern in
// Block B (garetienVerbundBlockMarkup), und erst, wenn mindestens zwei Fragmente auf der Stage liegen.
// Zusammenlegen LEGT NICHT MEHR AUF -- es markiert die Stage-Eintraege.
//
// 🔴 EIGENE ERGAENZUNG DER URSPRUENGLICHEN SITZUNG: JEDES `data-handlung`-Ziel laeuft am Ende durch
// `garetienHandlungKlick`; `garetienHandlungsRumpf` schliesst "verbund" ausdruecklich aus. Ohne den
// EIGENEN Verteiler bliebe der Klick wortlos. Dieser Test faehrt deshalb GENAU DEN Verteiler, den die
// Verdrahtung im Fenster zuerst ruft: `garetienVerbundKlick`.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-klick.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

// Eine winzige DOM-Attrappe: `closest` sucht sich selbst gegen den einen Selektor dieses Knopfs.
function ziel(attribute, optionen) {
	const knoten = Object.assign({
		disabled: false,
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(attribute, name) ? attribute[name] : null;
		},
	}, optionen || {});
	knoten.closest = function (auswahl) {
		if (auswahl === '[data-handlung="verbund"]'
			&& attribute["data-handlung"] === "verbund") { return knoten; }
		return null;
	};
	return knoten;
}

function fragmente(n) {
	// Aufgabe 6: Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	// 🔴 Aufgabe 9: und ein 'new'-Item, sonst ist die Zielwahl-Vorbelegung "nichts" statt "karte"
	// (Ruling R-a) und garetienVerbundZusammenlegbar sperrt.
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n,
		ziel: "region", subtyp: "wald", urteil: "neu", stand: "offen" };
	return Array.from({ length: n }, (_, i) => Object.assign(
		{ key: "ggp:silkerhain:" + i, name: "Silker Hain " + (i + 1),
			items: [{ id: 300 + i, change_type: "new" }] }, basis));
}

function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
}

// REIN: `zustand.objekte` per die ECHTE Tuer setzen -- die Liste entsteht ausschliesslich in
// `avesmapsGaretienListeHolen`, also wird `global.fetch` einmal ersetzt und zurueckgesetzt.
async function mitObjekten(objekte, tun) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7 }),
		});
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	tun();
}

(async function () {
	// =============================================================================================
	// A. 🔴 Aufgabe 7: der Knopf steht NICHT in garetienHandlungen, sondern in Block B -- und erst mit
	// zwei Fragmenten auf der Stage.
	// =============================================================================================
	zuruecksetzen();
	const [m1, m2] = fragmente(2);
	await mitObjekten([m1, m2], function () {
		gleich(api.garetienHandlungen(m1).filter((k) => k.name === "verbund").length, 0,
			"die Handlungsleiste traegt keinen Verbund-Knopf mehr");
		gleich(api.garetienVerbundBlockMarkup(m1, [m1, m2]).indexOf('data-handlung="verbund"'), -1,
			"ohne Fragment auf der Stage steht auch in Block B keiner");

		api.avesmapsGaretienStageHinzufuegen([m1, m2]);
		const block = api.garetienVerbundBlockMarkup(m1, [m1, m2]);
		wahr(block.indexOf('<button class="btn btn--accent" type="button" data-handlung="verbund" data-key="ggp:silkerhain:0">Zusammenlegen (2)</button>') !== -1,
			"zwei auf der Stage: „Zusammenlegen (2)“, Akzentrahmen, bedienbar: " + block);

		api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), [m1, m2]);
		wahr(api.garetienVerbundBlockMarkup(m1, [m1, m2]).indexOf(">Verbund auflösen (2)</button>") !== -1,
			"zusammengelegt: „Verbund auflösen (n)“");
	});
	zuruecksetzen();

	// Ein Verbund mit nur EINEM Mitglied auf der Stage zeigt keinen Knopf -- „Zusammenlegen" ohne
	// einen zweiten Partner ist keins.
	const [nurEines, zweites] = fragmente(2);
	await mitObjekten([nurEines, zweites], function () {
		api.avesmapsGaretienStageHinzufuegen([nurEines]);
		gleich(api.garetienVerbundBlockMarkup(nurEines, [nurEines, zweites]).indexOf('data-handlung="verbund"'), -1,
			"ein einzelnes Fragment auf der Stage: kein Knopf");
	});
	zuruecksetzen();

	// Ein Objekt ohne Verbund bekommt GAR KEINEN Verbund-Knopf.
	const einzeln = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([einzeln], function () {
		const namen = api.garetienHandlungen(einzeln).map((k) => k.name);
		wahr(!namen.includes("verbund"), "kein Verbund -> kein Knopf: " + namen.join(", "));
		gleich(api.garetienVerbundBlockMarkup(einzeln, [einzeln]), "", "und kein Block");
	});
	zuruecksetzen();

	// =============================================================================================
	// B. garetienHandlungsRumpf schliesst "verbund" aus -- er geht NIE durch die geteilte Tuer
	// =============================================================================================

	const [b1] = fragmente(2);
	gleich(api.garetienHandlungsRumpf("verbund", b1, 7), null,
		"🔴 „verbund“ schickt nichts an die geteilte Uebernahme-Vorschau -- eigene Tuer, "
		+ "garetienVerbundKlick");
	zuruecksetzen();

	// =============================================================================================
	// C. Der Klick-Verteiler garetienVerbundKlick -- gemessen am ERGEBNIS.
	// =============================================================================================

	const [c1, c2] = fragmente(2);
	const schluesselC = api.garetienVerbundSchluessel(c1);

	gleich(api.garetienVerbundKlick({ target: ziel({}) }, [c1, c2]), null,
		"ein Klick neben den Knopf loest nichts aus");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "und aendert auch nichts");

	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }, { disabled: true }) },
		[c1, c2]), null, "ein gesperrtes Element schickt nichts -- die Anzeige-Sperre gilt auch hier");

	// 🔴 Aufgabe 6: der Klick LEGT NICHT AUF. Mit nur einem Fragment auf der Stage ist nichts
	// zusammenzulegen -- das „Nein" zaehlt als gefunden und nennt den Grund.
	api.avesmapsGaretienStageHinzufuegen([c1]);
	const gesperrt = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(gesperrt.handlung, "verbund_gesperrt", "ein Fragment auf der Stage: gesperrt, kein Auflegen");
	gleich(api.avesmapsGaretienStageHat(c2.key), false, "💣 und das zweite Fragment bleibt, wo es war");

	api.avesmapsGaretienStageHinzufuegen([c2]);
	const ergebnis1 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(ergebnis1.handlung, "verbund_zusammengelegt", "der Klick legt zusammen und benennt die Richtung");
	gleich(api.garetienVerbundIstZusammen(schluesselC), true, "der Verbund gilt jetzt als zusammengelegt");

	const ergebnis2 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(ergebnis2.handlung, "verbund_aufgeloest", "der zweite Klick loest auf");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "die Entscheidung ist zurueckgenommen");
	gleich(api.avesmapsGaretienStageHat(c1.key) && api.avesmapsGaretienStageHat(c2.key), true,
		"💣 die Objekte bleiben auf der Stage -- „Aufloesen“ nimmt nur die Entscheidung");
	zuruecksetzen();

	const [d1, d2] = fragmente(2);
	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": "gibtesnicht" }) }, [d1, d2]),
		null, "ein unbekannter Schluessel trifft kein Objekt");
	gleich(api.garetienVerbundKlick({}, []), null, "ein Ereignis ohne Ziel schickt nichts");
	gleich(api.garetienVerbundKlick({ target: {} }, []), null, "ein Ziel ohne `closest` schickt nichts");

	// =============================================================================================
	// D. Die VERDRAHTUNG in garetienDetailMarkup: Block und Knopf stehen in der echten Spalte.
	// =============================================================================================

	const [e1, e2] = fragmente(2);
	await mitObjekten([e1, e2], function () {
		api.avesmapsGaretienStageHinzufuegen([e1, e2]);
		const spalte = api.garetienDetailMarkup(e1, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') > -1,
			"der Verbund-Block steht in der echten Detailspalte: " + spalte.slice(0, 400));
		wahr(spalte.indexOf('data-handlung="verbund"') > -1, "und der Knopf „Zusammenlegen“ darin");
		const iVerbund = spalte.indexOf('<p class="gi-sec">Verbund');
		const iWasBeiUns = spalte.indexOf("Was bei uns an derselben Stelle liegt");
		wahr(iVerbund > -1 && iWasBeiUns > -1 && iVerbund < iWasBeiUns,
			"der Verbund-Block steht VOR „Was bei uns an derselben Stelle liegt“");
	});
	zuruecksetzen();

	const solo = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([solo], function () {
		const spalte = api.garetienDetailMarkup(solo, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') === -1, "ohne Verbund erscheint kein Verbund-Block");
	});
	zuruecksetzen();

	console.log(`garetien-verbund-klick: ${checks} Pruefungen bestanden.`);
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
