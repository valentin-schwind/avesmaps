// Fixrunde 1, Befund F1 -- der ✕ einer einzelnen Fragmentzeile im Verbund-Block war GERENDERT,
// aber unverdrahtet: `data-verbund-weg` stand im Markup, aber kein Zuhoerer im Klick-Verteiler
// las das Attribut je aus. Dieser Test faehrt den neuen, eigenen Verteiler `garetienVerbundWegKlick`
// -- nach demselben Vorbild wie `garetienVerbundKlick` in garetien-verbund-klick.test.js.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-fragment-weg.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

// Dieselbe winzige DOM-Attrappe wie in garetien-verbund-klick.test.js, nur auf `data-verbund-weg`
// verengt statt auf `data-handlung`.
function ziel(attribute, optionen) {
	const knoten = Object.assign({
		disabled: false,
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(attribute, name) ? attribute[name] : null;
		},
	}, optionen || {});
	knoten.closest = function (auswahl) {
		if (auswahl === "[data-verbund-weg]"
			&& Object.prototype.hasOwnProperty.call(attribute, "data-verbund-weg")) { return knoten; }
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

// REIN: `zustand.objekte` per die ECHTE Tuer setzen -- dieselbe Attrappe wie in
// garetien-verbund-klick.test.js, Abschnitt D (garetienDetailMarkup liest den Verbund-Block
// ueber `zustand.objekte`, nicht ueber einen Parameter).
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
	// A. Ein Klick daneben oder auf ein fremdes Ziel tut nichts.
	// =============================================================================================
	gleich(api.garetienVerbundWegKlick({ target: ziel({}) }, []), null,
		"ein Klick neben den Knopf loest nichts aus");
	gleich(api.garetienVerbundWegKlick({}, []), null, "ein Ereignis ohne Ziel schickt nichts");
	gleich(api.garetienVerbundWegKlick({ target: {} }, []), null,
		"ein Ziel ohne `closest` schickt nichts");

	// Ein Klick auf den GESPERRTEN Knopf tut nichts -- dieselbe Anzeige-Sperre wie bei
	// garetienStageKlick/garetienVerbundKlick daneben.
	const [aSperr1] = fragmente(2);
	api.avesmapsGaretienStageHinzufuegen([aSperr1]);
	gleich(api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": aSperr1.key }, { disabled: true }) }, [aSperr1]), null,
		"ein gesperrtes Element schickt nichts");
	wahr(api.avesmapsGaretienStageHat(aSperr1.key),
		"und das Objekt bleibt deshalb auf der Stage liegen");
	zuruecksetzen();

	// =============================================================================================
	// B. Der Normalfall: vier Fragmente auf der Stage, eines wird herausgenommen -- NUR dieses eine
	// verschwindet von der Stage, die drei uebrigen bleiben, und die Merkung bleibt gesetzt (>= 2
	// Mitglieder verbleiben auf der Stage).
	// =============================================================================================
	const vier = fragmente(4);
	const schluessel = api.garetienVerbundSchluessel(vier[0]);
	// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
	api.avesmapsGaretienStageHinzufuegen(vier);
	api.garetienVerbundZusammenlegen(schluessel, vier);
	wahr(api.garetienVerbundIstZusammen(schluessel), "Vorbedingung: der Verbund liegt zusammen");
	vier.forEach((f) => wahr(api.avesmapsGaretienStageHat(f.key), "Vorbedingung: " + f.key + " liegt auf der Stage"));

	const ergebnis = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": vier[1].key }) }, vier);
	wahr(Boolean(ergebnis), "der Klick meldet ein Ergebnis");
	gleich(ergebnis.handlung, "verbund_fragment_entfernt", "und benennt sich als solches");
	gleich(ergebnis.key, vier[1].key, "das Ergebnis nennt den entfernten Schluessel");

	gleich(api.avesmapsGaretienStageHat(vier[1].key), false,
		"GENAU DIESES eine Fragment liegt nicht mehr auf der Stage");
	gleich(api.avesmapsGaretienStageHat(vier[0].key), true, "die uebrigen bleiben (0)");
	gleich(api.avesmapsGaretienStageHat(vier[2].key), true, "die uebrigen bleiben (2)");
	gleich(api.avesmapsGaretienStageHat(vier[3].key), true, "die uebrigen bleiben (3)");
	gleich(api.garetienVerbundIstZusammen(schluessel), true,
		"drei verbliebene Mitglieder auf der Stage sind immer noch ein Verbund -- die Merkung bleibt");
	zuruecksetzen();

	// =============================================================================================
	// C. Der Ein-Fragment-Fall (die eigentliche F1-Nachfrage): bleiben nach dem Klick WENIGER als
	// zwei Mitglieder auf der Stage, faellt die Merkung `_garetienVerbundZusammen` mit -- ein
	// Verbund aus einem Stueck ist keiner mehr (dieselbe Regel wie bei `n < 2` in
	// garetienVerbundMarkeMarkup/garetienVerbundBlockMarkup).
	// =============================================================================================
	const zwei = fragmente(2);
	const schluesselZwei = api.garetienVerbundSchluessel(zwei[0]);
	api.avesmapsGaretienStageHinzufuegen(zwei);
	api.garetienVerbundZusammenlegen(schluesselZwei, zwei);
	wahr(api.garetienVerbundIstZusammen(schluesselZwei), "Vorbedingung: zusammengelegt");

	const ergebnisZwei = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": zwei[0].key }) }, zwei);
	wahr(Boolean(ergebnisZwei), "auch dieser Klick meldet ein Ergebnis");
	gleich(ergebnisZwei.aufgeloest, true,
		"das Ergebnis sagt ausdruecklich, dass die Merkung mitgefallen ist");
	gleich(api.avesmapsGaretienStageHat(zwei[0].key), false, "das entfernte Fragment ist weg");
	gleich(api.avesmapsGaretienStageHat(zwei[1].key), true,
		"💣 das letzte verbliebene Mitglied bleibt auf der Stage -- nur die MERKUNG faellt, kein Import");
	gleich(api.garetienVerbundIstZusammen(schluesselZwei), false,
		"ein Verbund aus einem Stueck ist keiner mehr -- die Merkung ist zurueckgenommen");

	// Und die Auswirkung, die die F1-Nachfrage konkret benennt: `garetienEinstellungsSchluessel`
	// zeigt fuer das letzte Fragment jetzt wieder auf seinen EIGENEN Schluessel, nicht mehr auf
	// den (nicht mehr bestehenden) Verbund -- schneide die Funktion analog zu
	// garetien-verbund-detail.test.js aus dem Quelltext, da sie nicht exportiert ist.
	const fs = require("fs");
	const path = require("path");
	const quelle = fs.readFileSync(
		path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");
	function schneide(name) {
		const a = quelle.indexOf("function " + name);
		assert.ok(a > -1, name + " fehlt");
		return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
	}
	const vm = require("vm");
	const kontext = {
		garetienVerbundSchluessel: api.garetienVerbundSchluessel,
		garetienVerbundIstZusammen: api.garetienVerbundIstZusammen,
	};
	vm.createContext(kontext);
	vm.runInContext(schneide("garetienEinstellungsSchluessel")
		+ "\nthis.einstellungsSchluessel = garetienEinstellungsSchluessel;", kontext);
	gleich(kontext.einstellungsSchluessel(zwei[1]), String(zwei[1].key),
		"das letzte Fragment zeigt wieder auf seinen eigenen Einstellungs-Schluessel");
	zuruecksetzen();

	// =============================================================================================
	// D. 🔴 Aufgabe 6 (14.09.2026): das Aufloesen unter zwei steht in der TUER
	// (avesmapsGaretienStageEntfernen), nicht im ✕ -- auch „Von der Stage nehmen" und der Nachschlag
	// nach einem Lauf nehmen herunter. Faellt der Verbund dort, hat der spaetere ✕ nichts mehr aufzuloesen.
	// =============================================================================================
	const eins = fragmente(2);
	const schluesselEins = api.garetienVerbundSchluessel(eins[0]);
	api.avesmapsGaretienStageHinzufuegen(eins);
	api.garetienVerbundZusammenlegen(schluesselEins, eins);
	api.avesmapsGaretienStageEntfernen([eins[1].key]);
	gleich(api.garetienVerbundIstZusammen(schluesselEins), false,
		"„Von der Stage nehmen\" des vorletzten Fragments loest den Verbund schon in der Tuer auf");
	wahr(api.avesmapsGaretienStageHat(eins[0].key), "das letzte Mitglied bleibt auf der Stage");

	const ergebnisNull = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": eins[0].key }) }, eins);
	gleich(ergebnisNull.aufgeloest, false, "der ✕ danach hat nichts mehr aufzuloesen -- und meldet das ehrlich");
	gleich(api.avesmapsGaretienStageHat(eins[0].key), false, "das Fragment ist trotzdem herunter");
	zuruecksetzen();

	// =============================================================================================
	// E. Ein Objekt OHNE Verbund: das Entfernen von der Stage funktioniert trotzdem (die Tuer ist
	// dieselbe wie „Von der Stage nehmen"), es gibt nur nichts zum Aufloesen.
	// =============================================================================================
	const solo = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	api.avesmapsGaretienStageHinzufuegen([solo]);
	const ergebnisSolo = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": solo.key }) }, [solo]);
	gleich(ergebnisSolo.verbund, "", "kein Verbund -- leerer Verbund-Schluessel im Ergebnis");
	gleich(ergebnisSolo.aufgeloest, false, "nichts zum Aufloesen");
	gleich(api.avesmapsGaretienStageHat(solo.key), false, "das Objekt liegt trotzdem nicht mehr auf der Stage");
	zuruecksetzen();

	// =============================================================================================
	// F. Die VERDRAHTUNG in der echten Detailspalte: der gerenderte ✕ traegt wirklich
	// `data-verbund-weg`, UND ein Klick darauf ueber `garetienVerbundWegKlick` findet ihn.
	// =============================================================================================
	const [g1, g2] = fragmente(2);
	const schluesselG = api.garetienVerbundSchluessel(g1);
	api.avesmapsGaretienStageHinzufuegen([g1, g2]);
	api.garetienVerbundZusammenlegen(schluesselG, [g1, g2]);
	await mitObjekten([g1, g2], function () {
		const spalte = api.garetienDetailMarkup(g1, null, false);
		wahr(spalte.indexOf('data-verbund-weg="' + g1.key + '"') > -1,
			"der ✕ des ersten Fragments traegt seinen eigenen Schluessel im Markup: "
			+ spalte.slice(0, 400));
		// 💣 Befund F2, Gegenprobe hier mit: die Zeile traegt den Modifikator, der sie unklickbar
		// macht -- ohne ihn saehe die ganze Zeile trotzdem klickbar aus.
		wahr(spalte.indexOf('class="gi-seg gi-seg--verbund"') > -1,
			"die Verbund-Zeile traegt gi-seg--verbund, nicht die geteilte .gi-seg-Regel allein");
		const nachKlick = api.garetienVerbundWegKlick(
			{ target: ziel({ "data-verbund-weg": g1.key }) }, [g1, g2]);
		wahr(Boolean(nachKlick), "derselbe Verteiler findet den echten, gerenderten Knopf");
	});
	zuruecksetzen();

	console.log(`garetien-verbund-fragment-weg: ${checks} Pruefungen bestanden.`);
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
