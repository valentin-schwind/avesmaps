// Aufgabe 3 des Garetien-Importer-Stage-Umbaus, PRÜFRUNDE 06.09.2026, Befund 1 (kritisch).
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-3-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-import-verdrahtung.test.js
//
// 🔴 WARUM ES DIESE DATEI GIBT. garetien-import-meldung.test.js prüft nur die REINE Rechnung
// (garetienImportMeldung, garetienAnzeigeNeuIds, garetienOhneFehlgeschlagene je für sich) -- und
// hätte VIER echte Verdrahtungsfehler grün durchgelassen: die Meldung landet VOR statt NACH
// avesmapsGaretienListeHolen() (genau die Falle, die beim Bau gefunden und "behoben" wurde, aber
// nie an der ECHTEN Kette geprüft war), die Meldung wird gar nicht gesetzt, der `change_type`-Filter
// fehlt, oder der Fehlschlag-Filter fehlt. Diese Datei führt BEIDE Klickverteiler
// (garetienFussknopfEinfuegenKlick, garetienNeuKlick) mit einer `fetch`-Attrappe wirklich aus, wie
// js/review/__tests__/garetien-fussknopf-dom.test.js es für den reinen Schreibweg schon tut.
//
// ⭐ Gemessen wird an der ECHTEN Kette: eine Fixture mit einem neu angelegten Objekt (801), einem
// GESCHEITERTEN neuen Objekt (802) und einer ERGÄNZUNG an einem bestehenden Objekt (803, `changed`)
// -- der Mischlauf, den der Fußknopf im Alltag erzeugt. Der "Rückgängig"-Link darf danach NUR [801]
// tragen: 802 wurde nie angelegt, 803 ist kein neues Objekt.

"use strict";

const path = require("path");
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

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

function tick() {
	return new Promise(function (resolve) { setImmediate(resolve); });
}

// Dieselben ELEMENTE, mit denen garetien-fussknopf-dom.test.js schon die ECHTE Kette
// (avesmapsGaretienListeRendern samt garetienListeSkelettSicherstellen) fährt -- ohne
// "garetien-listcol" bricht avesmapsGaretienListeRendern VOR garetienStatusRuhe ab, und genau DAS
// wollen wir hier scharf haben: die Falle entsteht nur, wenn die Ruhe-Bilanz wirklich läuft.
const EXTRA_IDS = ["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-sheet"];

const objNeu = { key: "n:801", items: [{ id: 801, change_type: "new", selected: 0 }] };
const objNeuScheitert = { key: "n:802", items: [{ id: 802, change_type: "new", selected: 0 }] };
const objErgaenzung = {
	key: "c:803",
	items: [{ id: 803, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0 }],
};

/** Die `apply`-Antwort des Mischlaufs: 801 angelegt, 802 gescheitert, 803 nur ergänzt. */
function applyAntwortMischlauf() {
	return {
		ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 3, remaining: 0,
		skipped: 1, declined: 0,
		fehler: [{ item: 802, grund: 'Aus 1 Punkten laesst sich kein Ziel der Art "path" bauen.' }],
		angelegt_je_form: { path: 1, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 1 },
	};
}

/** Eine `liste`-Antwort mit einer Ruhe-Bilanz, die sich TEXTLICH klar von der Import-Meldung
 * unterscheidet ("… mit Vorschlag …") -- nur so beweist die Zusicherung wirklich, dass die
 * Meldung NACH der Ruhe-Bilanz steht und nicht zufällig gleich aussieht. */
function listeAntwortMitRuheBilanz() {
	return {
		ok: true, plan_run_id: 4711, gesamt: 0, objekte: [], reiter: {}, facetten: {},
		bilanz: { neu: 9, ergaenzung: 0, zweifel: 0, widerspruch: 0, deckt_sich: 0, uebersprungen: 0 },
	};
}

function machFetch(antworten) {
	const angefragt = [];
	return {
		angefragt: angefragt,
		fn: function (pfad, optionen) {
			const rumpf = JSON.parse((optionen && optionen.body) || "{}");
			angefragt.push({ pfad: String(pfad), rumpf: rumpf });
			return Promise.resolve({ json: function () { return Promise.resolve(antworten(rumpf)); } });
		},
	};
}

function fetchDesMischlaufs() {
	return machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") { return applyAntwortMischlauf(); }
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return listeAntwortMitRuheBilanz(); }
		if (rumpf.action === "ruecknahme") { return { ok: true, zurueckgenommen: 1, fehler: [] }; }
		throw new Error("unerwartete Aktion in dieser Fixture: " + rumpf.action);
	});
}

// =================================================================================================
// A. Fußknopf „Alle angezeigten einfügen": Mischlauf, Meldung, „Rückgängig"
// =================================================================================================

async function pruefeFussknopf() {
	const { api, dom, ELEMENTE } = ladeImporter(EXTRA_IDS);
	api.avesmapsGaretienAnzeigeLeeren();
	api.avesmapsGaretienAnzeigeHinzufuegen([objNeu, objNeuScheitert, objErgaenzung]);

	const gefragt = [];
	const fragen = function (text) { gefragt.push(text); return true; };

	const f = fetchDesMischlaufs();
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienFussknopfEinfuegenKlick(4711, fragen);

	// 1. Die STATUSZEILE zeigt die Import-Meldung -- NICHT die Ruhe-Bilanz von
	// avesmapsGaretienListeHolen (die läuft danach trotzdem, siehe die Fixture-Begründung).
	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("1 Objekt importiert"), "die Import-Meldung steht: " + text1);
	wahr(text1.includes("1 Quelle ergänzt"), "…samt der Ergänzung (803, nicht als Objekt): " + text1);
	wahr(text1.includes("1 von 3 nicht importiert"),
		"🔴 Befund 2: der Nenner zählt angelegt(1) + quellen(1) + fehler(1) = 3: " + text1);
	wahr(!text1.includes("mit Vorschlag"),
		"🔴 Befund 1 (kritisch): NICHT die Ruhe-Bilanz -- die Meldung muss NACH ihr stehen: " + text1);
	wahr(dom.klassen("#garetien-status-text").includes("bad"), "Ton bad wegen des Fehlschlags");

	// 2. Der "Rückgängig"-Link steht da.
	gleich(dom.text("#garetien-status-aktion"), "Rückgängig", "der Link ist sichtbar");
	gleich(ELEMENTE["garetien-status-aktion"].hidden, false, "…und nicht verborgen");

	// 3. Klick auf den Link: Rückfrage, dann GENAU die überlebende 'new'-id -- nie 802 (gescheitert)
	// und nie 803 (kein neues Objekt, sondern eine Ergänzung).
	f.angefragt.length = 0;
	dom.klick("#garetien-status-aktion");
	await tick(); await tick(); await tick();

	wahr(gefragt.length >= 2, "die zweite Rückfrage (vor der Rücknahme) wurde gestellt: " + gefragt.length);
	const letzteFrage = gefragt[gefragt.length - 1];
	wahr(letzteFrage.includes("1 gerade angelegtes Objekt"), "…mit der ECHTEN Zahl: " + letzteFrage);

	const ruecknahmeAnfragen = f.angefragt.filter(function (a) { return a.rumpf.action === "ruecknahme"; });
	gleich(ruecknahmeAnfragen.length, 1, "genau EIN 'ruecknahme'-Aufruf");
	tief(ruecknahmeAnfragen[0].rumpf.ids, [801],
		"🔴 Befund 3: NUR die überlebende 'new'-id -- nie die gescheiterte (802) oder die "
		+ "Ergänzung (803)");

	global.fetch = echtesFetch;
}

// =================================================================================================
// B. „Neu einfügen": derselbe Mechanismus am ANDEREN Klickverteiler
// =================================================================================================

function kette(knoten) {
	const kandidaten = knoten.map(function (k2) {
		return Object.assign({
			getAttribute(name) {
				return Object.prototype.hasOwnProperty.call(k2.attribute || {}, name)
					? k2.attribute[name] : null;
			},
		}, k2);
	});
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
function neuZiel(key) {
	return kette([{
		passt: ['[data-handlung="neu"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": "neu", "data-key": key }, disabled: false, textContent: "",
	}]);
}

async function pruefeNeuKlickErfolg() {
	const { api, dom } = ladeImporter(EXTRA_IDS);
	const objekt = {
		key: "neu:1", urteil: "neu", abschnitte: [],
		items: [{ id: 901, change_type: "new", selected: 0 }],
	};

	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [],
				angelegt_je_form: { path: 1, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return listeAntwortMitRuheBilanz(); }
		if (rumpf.action === "ruecknahme") { return { ok: true, zurueckgenommen: 1, fehler: [] }; }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienNeuKlick({ target: neuZiel(objekt.key) }, [objekt], 4711, function () { return true; });

	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("1 Objekt importiert"), 'auch „Neu einfügen" meldet ueber garetienImportMeldung: ' + text1);
	wahr(!text1.includes("mit Vorschlag"), "…und nicht die Ruhe-Bilanz: " + text1);
	gleich(dom.text("#garetien-status-aktion"), "Rückgängig", "und bietet Rückgängig an");

	f.angefragt.length = 0;
	dom.klick("#garetien-status-aktion");
	await tick(); await tick(); await tick();
	const ruecknahme = f.angefragt.filter(function (a) { return a.rumpf.action === "ruecknahme"; });
	gleich(ruecknahme.length, 1, "ein Ruecknahme-Aufruf");
	tief(ruecknahme[0].rumpf.ids, [901], "mit der einen new-id dieses Objekts");

	global.fetch = echtesFetch;
}

async function pruefeNeuKlickScheitert() {
	const { api, dom, ELEMENTE } = ladeImporter(EXTRA_IDS);
	const objekt = {
		key: "neu:2", urteil: "neu", abschnitte: [],
		items: [{ id: 902, change_type: "new", selected: 0 }],
	};

	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 0, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 1, declined: 0, fehler: [{ item: 902, grund: "Y" }],
				angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return listeAntwortMitRuheBilanz(); }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienNeuKlick({ target: neuZiel(objekt.key) }, [objekt], 4711, function () { return true; });

	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("0 von 1 nicht importiert") || text1.includes("nicht importiert"),
		"der Fehlschlag steht in der Meldung: " + text1);
	// 🔴 Befund 3: das EINZIGE Item ist gescheitert -- KEIN "Rückgängig" anbieten (es gibt nichts
	// zurückzunehmen).
	gleich(ELEMENTE["garetien-status-aktion"].hidden, true, "kein Link, wenn alles gescheitert ist");
	gleich(dom.text("#garetien-status-aktion"), "", "…und ohne Beschriftung");

	global.fetch = echtesFetch;
}

// =================================================================================================
// C. Prüfrunde 06.09.2026, Befund 5: Import gelingt, der FOLGENDE Listenabruf lehnt ab -- die
// Meldung darf NICHT verschluckt werden. Beide Klickverteiler, sonst bindet die Regel nur einen
// von zwei Erzeugern.
// =================================================================================================

async function pruefeFussknopfListenfehler() {
	const { api, dom, ELEMENTE } = ladeImporter(EXTRA_IDS);
	const objekt = { key: "n:lf", items: [{ id: 811, change_type: "new", selected: 0 }] };
	api.avesmapsGaretienAnzeigeLeeren();
	api.avesmapsGaretienAnzeigeHinzufuegen([objekt]);

	const fragen = function () { return true; };
	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [],
				angelegt_je_form: { path: 1, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		// 🔴 GENAU DIESER Listenabruf lehnt ab -- avesmapsGaretienRufe wirft, weil ok !== true.
		if (rumpf.action === "liste") { return { ok: false, error: { message: "dump_locked" } }; }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienFussknopfEinfuegenKlick(4711, fragen);

	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("1 Objekt importiert"),
		"🔴 Befund 5: was angelegt wurde bleibt sichtbar, TROTZ Listenfehler: " + text1);
	wahr(text1.includes("dump_locked"), "…und der Listenfehler hängt an: " + text1);
	wahr(dom.klassen("#garetien-status-text").includes("bad"), "Ton bad wegen des Listenfehlers");
	gleich(dom.text("#garetien-status-aktion"), "Rückgängig",
		"🔴 der Rückgängig-Link bleibt angeboten -- GENAU HIER am wichtigsten, weil das Objekt auf "
		+ "der Karte liegt und der Editor sonst nichts davon erfährt");
	gleich(ELEMENTE["garetien-status-aktion"].hidden, false, "…und ist sichtbar");

	global.fetch = echtesFetch;
}

async function pruefeNeuKlickListenfehler() {
	const { api, dom, ELEMENTE } = ladeImporter(EXTRA_IDS);
	const objekt = {
		key: "neu:lf", urteil: "neu", abschnitte: [],
		items: [{ id: 912, change_type: "new", selected: 0 }],
	};

	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [],
				angelegt_je_form: { path: 1, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return { ok: false, error: { message: "dump_locked" } }; }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienNeuKlick({ target: neuZiel(objekt.key) }, [objekt], 4711, function () { return true; });

	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("1 Objekt importiert"), "auch hier bleibt sichtbar, was angelegt wurde: " + text1);
	wahr(text1.includes("dump_locked"), "…mit dem Listenfehler: " + text1);
	wahr(dom.klassen("#garetien-status-text").includes("bad"), "Ton bad");
	gleich(dom.text("#garetien-status-aktion"), "Rückgängig", "Rückgängig bleibt angeboten");
	gleich(ELEMENTE["garetien-status-aktion"].hidden, false, "…sichtbar");

	global.fetch = echtesFetch;
}

pruefeFussknopf()
	.then(pruefeNeuKlickErfolg)
	.then(pruefeNeuKlickScheitert)
	.then(pruefeFussknopfListenfehler)
	.then(pruefeNeuKlickListenfehler)
	.then(function () {
		console.log(`garetien-import-verdrahtung ok -- ${checks} Zusicherungen`);
	})
	.catch(function (fehler) {
		console.error(fehler);
		process.exitCode = 1;
	});
