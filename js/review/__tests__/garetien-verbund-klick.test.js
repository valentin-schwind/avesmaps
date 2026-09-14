// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Knopf „Verbund auf die Stage" / „Verbund
// auflösen" in der Handlungsleiste, samt seinem EIGENEN Klick-Verteiler (garetienVerbundKlick).
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-8-brief.md
//
// 🔴 EIGENE ERGAENZUNG DIESER SITZUNG, NICHT WOERTLICH IM BRIEF. Der Brief nennt fuer die
// Klick-Verdrahtung „garetienDetailKlick" und eine lokale Variable `handlung" -- beide gibt es an
// dieser Stelle im echten Code nicht: `garetienDetailKlick` behandelt nur `[data-sicht]` und
// `.gi-show`, und JEDES `data-handlung`-Ziel laeuft am Ende durch `garetienHandlungKlick`
// (`.closest("[data-handlung]")`, keine Einschraenkung auf einen Wert). Ohne einen EIGENEN
// Verteiler -- nach dem Vorbild von `garetienStageKlick` fuer "stage"/"entstagen" -- liefe ein
// Klick auf den Verbund-Knopf am Ende durch `garetienHandlungKlick`, das aber `garetienHandlungsRumpf`
// fragt; die schliesst "verbund" ausdruecklich aus (wie "stage"/"entstagen"), der Klick bliebe also
// wortlos, ohne je zusammenzulegen oder aufzuloesen. Dieser Test faehrt deshalb GENAU DEN
// Verteiler, den die Verdrahtung im Fenster wirklich zuerst ruft: `garetienVerbundKlick`.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-klick.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

// Eine winzige DOM-Attrappe: `closest` sucht sich selbst gegen eine Liste von Selektoren, die der
// Knoten "passt" -- dasselbe Prinzip wie in garetien-handlungen.test.js, nur auf das eine Ziel
// dieses Knopfs verengt.
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
	// Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n,
		ziel: "region", subtyp: "wald" };
	return Array.from({ length: n }, (_, i) => Object.assign(
		{ key: "ggp:silkerhain:" + i, name: "Silker Hain " + (i + 1) }, basis));
}

function zuruecksetzen() {
	api.garetienVerbundVergessen();
	api.avesmapsGaretienStageLeeren();
}

// REIN: `zustand.objekte` per die ECHTE Tuer setzen. Es gibt keinen Setter dafuer -- die Liste
// entsteht ausschliesslich in `avesmapsGaretienListeHolen` (siehe garetien-auswahlleiste.test.js,
// Abschnitt 14, derselbe Griff), also wird `global.fetch` einmal ersetzt und zurueckgesetzt.
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
	// A. Der Knopf in garetienHandlungen -- Beschriftung, Ton, Sperre. Die Mitgliederzahl kommt
	// aus `zustand.objekte`, nicht aus einem Parameter (dieselbe Weiche wie garetienEinstellungs-
	// Schluessel) -- ohne die echte Tuer daruntergelegt zaehlte die Funktion an einer leeren Liste
	// und der Knopf zeigte immer „(0)“.
	// =============================================================================================

	zuruecksetzen();
	const [m1, m2] = fragmente(2);
	await mitObjekten([m1, m2], function () {
		const knoepfe = api.garetienHandlungen(m1);
		const knopf = knoepfe.filter((k) => k.name === "verbund")[0];
		wahr(Boolean(knopf), "der Verbund-Knopf steht in der Leiste");
		gleich(knopf.beschriftung, "Verbund auf die Stage (2)",
			"unzusammengelegt: „Verbund auf die Stage (n)“");
		gleich(knopf.ton, "accent", "🔴 Ton accent, nicht gefuellt -- die eine Fuellung ist der Fuss");
		gleich(knopf.disabled, false, "zwei Mitglieder: nicht gesperrt");
		gleich(knopf.ids.length, 0, "kein Rumpf -- die Handlung ist rein client-seitig");

		const schluessel = api.garetienVerbundSchluessel(m1);
		// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
		api.avesmapsGaretienStageHinzufuegen([m1, m2]);
		api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
		const knopfDanach = api.garetienHandlungen(m1).filter((k) => k.name === "verbund")[0];
		gleich(knopfDanach.beschriftung, "Verbund auflösen (2)",
			"zusammengelegt: „Verbund auflösen (n)“");
	});
	zuruecksetzen();

	// Ein Verbund mit nur EINEM verbliebenen Mitglied (die uebrigen bereits ✕ herausgenommen) zeigt
	// den Knopf gesperrt, mit Grund -- „Verbund" ohne einen zweiten Partner ist keiner mehr.
	const [nurEines] = fragmente(2);
	await mitObjekten([nurEines], function () {
		const knopf = api.garetienHandlungen(nurEines).filter((k) => k.name === "verbund")[0];
		gleich(knopf.disabled, true, "ein einzelnes verbliebenes Mitglied sperrt den Knopf");
		wahr(/nur ein Fragment/.test(knopf.grund), "und der Grund sagt, warum: " + knopf.grund);
	});
	zuruecksetzen();

	// Ein Objekt ohne Verbund bekommt GAR KEINEN Verbund-Knopf.
	const einzeln = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([einzeln], function () {
		const namen = api.garetienHandlungen(einzeln).map((k) => k.name);
		wahr(!namen.includes("verbund"), "kein Verbund -> kein Knopf: " + namen.join(", "));
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
	// C. Der Klick-Verteiler garetienVerbundKlick -- gemessen am ERGEBNIS. Er bekommt die
	// Objektliste als Parameter (wie garetienStageKlick daneben) -- `zustand.objekte` bleibt hier
	// bewusst aussen vor, dieselbe Bauform wie die Verteiler in garetien-handlungen.test.js.
	// =============================================================================================

	const [c1, c2] = fragmente(2);
	const schluesselC = api.garetienVerbundSchluessel(c1);

	// Ein Klick daneben tut nichts.
	gleich(api.garetienVerbundKlick({ target: ziel({}) }, [c1, c2]), null,
		"ein Klick neben den Knopf loest nichts aus");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "und aendert auch nichts");

	// Ein Klick auf den GESPERRTEN Knopf (kommt hier ueber `disabled` am Element) tut nichts.
	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }, { disabled: true }) },
		[c1, c2]), null, "ein gesperrtes Element schickt nichts -- die Anzeige-Sperre gilt auch hier");

	// 🔴 Aufgabe 6 (14.09.2026): der Klick LEGT NICHT AUF. Mit nur einem Fragment auf der Stage ist
	// nichts zusammenzulegen -- das „Nein" zaehlt als gefunden und nennt den Grund.
	api.avesmapsGaretienStageHinzufuegen([c1]);
	const gesperrt = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(gesperrt.handlung, "verbund_gesperrt", "ein Fragment auf der Stage: gesperrt, kein Auflegen");
	gleich(api.avesmapsGaretienStageHat(c2.key), false, "💣 und das zweite Fragment bleibt, wo es war");

	// Beide auf der Stage: der Klick legt zusammen.
	api.avesmapsGaretienStageHinzufuegen([c2]);
	const ergebnis1 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	wahr(Boolean(ergebnis1), "der erste Klick legt zusammen und meldet ein Ergebnis");
	gleich(ergebnis1.handlung, "verbund_zusammengelegt", "und benennt die Richtung");
	gleich(api.garetienVerbundIstZusammen(schluesselC), true,
		"der Verbund gilt jetzt als zusammengelegt");
	gleich(api.avesmapsGaretienStageHat(c1.key), true, "beide Mitglieder liegen weiter auf der Stage");
	gleich(api.avesmapsGaretienStageHat(c2.key), true, "auch das zweite");

	// Ein zweiter Klick auf DENSELBEN Knopf (jetzt "Verbund auflösen"): loest die Merkung, laesst
	// die Stage aber unberuehrt (garetienVerbundAufloesen nimmt NUR die Merkung zurueck).
	const ergebnis2 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(ergebnis2.handlung, "verbund_aufgeloest", "der zweite Klick loest auf");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "die Merkung ist zurueckgenommen");
	gleich(api.avesmapsGaretienStageHat(c1.key), true,
		"💣 die Objekte bleiben auf der Stage -- „Aufloesen“ nimmt nur die Merkung, keinen Import "
		+ "zurueck");
	gleich(api.avesmapsGaretienStageHat(c2.key), true, "…beide weiterhin");
	zuruecksetzen();

	// Ein unbekannter Schluessel (Objekt nicht in der hereingereichten Liste) schickt nichts.
	const [d1, d2] = fragmente(2);
	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": "gibtesnicht" }) }, [d1, d2]),
		null, "ein unbekannter Schluessel trifft kein Objekt");
	zuruecksetzen();

	// Ein Ereignis ohne Ziel bzw. ohne `closest` tut ebenfalls nichts.
	gleich(api.garetienVerbundKlick({}, []), null, "ein Ereignis ohne Ziel schickt nichts");
	gleich(api.garetienVerbundKlick({ target: {} }, []), null,
		"ein Ziel ohne `closest` schickt nichts");

	// =============================================================================================
	// D. Die VERDRAHTUNG in garetienDetailMarkup -- nicht nur der isolierte Bauer (den prueft
	// garetien-verbund-detail.test.js per `vm`), sondern die ECHTE Spalte, wie sie ein Editor
	// sieht: der Block steht drin, UND der Knopf „Verbund auf die Stage" liegt daneben in
	// derselben Spalte (garetienHandlungsMarkup).
	// =============================================================================================

	const [e1, e2] = fragmente(2);
	await mitObjekten([e1, e2], function () {
		const spalte = api.garetienDetailMarkup(e1, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') > -1,
			"der Verbund-Block steht in der echten Detailspalte: " + spalte.slice(0, 400));
		wahr(spalte.indexOf('data-handlung="verbund"') > -1,
			"und der Knopf „Verbund auf die Stage“ auch");
		// 🔴 Der Block steht ZWISCHEN Kopf und „Was bei uns an derselben Stelle liegt“ (Brief,
		// Schritt 3: „im return zwischen kopf und mitte“).
		const iVerbund = spalte.indexOf('<p class="gi-sec">Verbund');
		const iWasBeiUns = spalte.indexOf("Was bei uns an derselben Stelle liegt");
		wahr(iVerbund > -1 && iWasBeiUns > -1 && iVerbund < iWasBeiUns,
			"der Verbund-Block steht VOR „Was bei uns an derselben Stelle liegt“");
	});
	zuruecksetzen();

	// Ohne Verbund bleibt die Spalte, wie sie war -- kein leerer Rest, kein leerer Block.
	const solo = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([solo], function () {
		const spalte = api.garetienDetailMarkup(solo, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') === -1,
			"ohne Verbund erscheint kein Verbund-Block");
	});
	zuruecksetzen();

	console.log(`garetien-verbund-klick: ${checks} Pruefungen bestanden.`);
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
