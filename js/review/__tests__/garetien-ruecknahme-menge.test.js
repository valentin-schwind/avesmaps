// Meldung C (30.08.2026, Owner): „zurücknehmen ist da, aber nicht 'Alle markieren zurücknehmen'".
// Der Fußknopf „Markierte zurücknehmen (n von m)" -- das Gegenstück zu „Alle angezeigten einfügen"
// auf der ANDEREN Seite des Fensters, fuer den DRINGENDEN Rueckbau der 3007 versehentlich
// uebernommenen Objekte.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-ruecknahme-menge.test.js
//
// 🔴 Geprueft werden die vier Zusicherungen des Auftrags, an den REINEN Bausteinen UND am
// End-zu-End-Klick (mit gefaelschtem `document` + `fetch`, wie garetien-fussknopf-dom.test.js
// nebenan es fuer den Fussknopf „Einfuegen" vormacht):
//   1. Drei markierte, zwei ruecknehmbar => "2 von 3", und GENAU zwei werden zurueckgenommen.
//   2. Sequenziell -- ein Spion protokolliert Start UND Ende jedes Schritts.
//   3. Ohne Bestaetigung passiert NICHTS -- kein einziger Netzruf.
//   4. Ein Fehler beim zweiten von drei haelt die Kette an und nennt die Zahl der schon
//      zurueckgenommenen -- der Server antwortet dabei mit HTTP 200 und einem `fehler`-Eintrag
//      (avesmapsGaretienRuecknahmeAusfuehren), nicht mit einem Wurf.
//
// 💣 `zustand.objekte`/`zustand.stand` sind MODULINTERN und haben keinen Test-Setter -- der
// einzige Weg, sie auf einen bestimmten Wert zu bringen, ist derselbe, den ein echter Klick nimmt:
// den Reiter „Übernommen" ueber den verdrahteten Tab-Klick anfahren (aufReiterUebernommenWechseln).
// Das ist bewusst KEIN Test-Hintertuerchen -- es ist die einzige Wahrheit ueber diesen Zustand.
"use strict";

const path = require("path");
const assert = require("assert");

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }

function tick() {
	return new Promise(function (resolve) { setImmediate(resolve); });
}

// ---- Das gefaelschte `document` -- dieselbe magere Form wie garetien-fussknopf-dom.test.js -----

function macheElement(id) {
	return {
		id: id,
		hidden: false,
		disabled: false,
		textContent: "",
		innerHTML: "",
		value: "",
		dataset: {},
		_hoerer: {},
		addEventListener(art, fn) {
			this._hoerer[art] = this._hoerer[art] || [];
			this._hoerer[art].push(fn);
		},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}

const ELEMENTE = {};
// 🔴 „garetien-tabs" MUSS dabei sein: nur so wird beim ersten Listenlauf ein Reiterwechsel auf
// „Übernommen" moeglich -- genau der Weg, auf dem `zustand.stand`/`zustand.objekte` in Wahrheit
// entstehen (kein Test-Hintertuerchen, dieselbe Funktion, die auch ein echter Klick nimmt).
["garetien-listcol", "garetien-list", "garetien-tabs",
	"garetien-ruecknahme-markierte", "garetien-ruecknahme-markierte-hint"]
	.forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: {},
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienKetteAbarbeiten,
	garetienRuecknahmeMengeZustand,
	garetienRuecknahmeMengeKnopfSetzen,
	garetienRuecknahmeMengeRueckfrageText,
	garetienRuecknahmeMengeAusfuehren,
	garetienRuecknahmeMengeKlick,
	avesmapsGaretienMarkierungUmschalten,
	avesmapsGaretienMarkierungHat,
	avesmapsGaretienListeRendern,
} = mod;

// ⚠️ Die Markierung ist ein TOGGLE und ueberlebt Abschnitte hinweg (genau wie in der echten
// Sitzung) -- diese zwei Helfer setzen einen bestimmten Zielzustand, statt blind umzuschalten,
// damit die Reihenfolge der Abschnitte hier keine Rolle spielt.
function markieren(key) { if (!avesmapsGaretienMarkierungHat(key)) { avesmapsGaretienMarkierungUmschalten(key); } }
function entmarkieren(key) { if (avesmapsGaretienMarkierungHat(key)) { avesmapsGaretienMarkierungUmschalten(key); } }

["garetienKetteAbarbeiten", "garetienRuecknahmeMengeZustand", "garetienRuecknahmeMengeKnopfSetzen",
	"garetienRuecknahmeMengeRueckfrageText", "garetienRuecknahmeMengeAusfuehren",
	"garetienRuecknahmeMengeKlick"].forEach(function (name) {
	wahr(typeof mod[name] === "function", name + " fehlt im Export");
});

const KNOPF = ELEMENTE["garetien-ruecknahme-markierte"];
const HINWEIS = ELEMENTE["garetien-ruecknahme-markierte-hint"];
const TABS = ELEMENTE["garetien-tabs"];
const LISTE_EL = ELEMENTE["garetien-list"];

/** Ein gefaelschtes `fetch`, das jede Anfrage protokolliert und `antworten(pfad,rumpf)` befragt. */
function machFetch(antworten) {
	const angefragt = [];
	return {
		angefragt: angefragt,
		fn: function (pfad, optionen) {
			const rumpf = JSON.parse((optionen && optionen.body) || "{}");
			angefragt.push({ pfad: String(pfad), rumpf: rumpf });
			return Promise.resolve({ json: function () { return Promise.resolve(antworten(pfad, rumpf)); } });
		},
	};
}

/**
 * Den Reiter „Übernommen" ueber einen ECHTEN Tab-Klick anfahren -- der einzige Weg, auf dem
 * `zustand.stand`/`zustand.objekte` in Wahrheit entstehen (keine Testabkuerzung).
 */
async function aufReiterUebernommenWechseln(objekte) {
	// Den Skelettbau (und damit die Verdrahtung von #garetien-tabs) einmal ausloesen, wie es jeder
	// echte Listenlauf tut.
	avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
	wahr((TABS._hoerer.click || []).length >= 1, "die Reiter-Leiste traegt ihren Klick-Zuhoerer");

	const d = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			return { ok: true, objekte: objekte, gesamt: objekte.length, bilanz: {},
				reiter: { uebernommen: objekte.length }, facetten: {} };
		}
		return { ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} };
	});
	const echt = global.fetch;
	global.fetch = d.fn;
	// Derselbe Aufruf, den `ereignis.target.closest(".avm-tab")` liefern wuerde.
	TABS._hoerer.click[0]({ target: { closest: () => ({ getAttribute: () => "uebernommen" }) } });
	await tick();
	global.fetch = echt;
}

// ---- Die Fixture: zwei ruecknehmbare ('new'+'done'), eines nicht ('changed', veraendert ein
// bestehendes Objekt -- Owner-Entscheid 1) ------------------------------------------------------
const objA = { key: "a", stand: "uebernommen", items: [{ id: 101, change_type: "new", apply_state: "done" }] };
const objB = { key: "b", stand: "uebernommen", items: [{ id: 102, change_type: "new", apply_state: "done" }] };
const objC = { key: "c", stand: "uebernommen", items: [{ id: 103, change_type: "changed", apply_state: "done" }] };

(async function () {
	// =============================================================================================
	// 1. garetienRuecknahmeMengeZustand -- REIN: "n von m", nur 'new'+'done' zaehlt zu n
	// =============================================================================================
	markieren("a");
	markieren("b");
	markieren("c");

	const zustand1 = garetienRuecknahmeMengeZustand([objA, objB, objC], "uebernommen");
	gleich(zustand1.markiert, 3, "alle drei sind markiert");
	gleich(zustand1.ruecknehmbar, 2, "nur A und B tragen ein 'new'+'done'-Item");
	tief(zustand1.ids, [101, 102], "…und genau deren Item-ids");
	gleich(zustand1.beschriftung, "Markierte zurücknehmen (2 von 3)",
		"💣 Zusicherung 1 des Auftrags: „2 von 3\"");
	gleich(zustand1.gesperrt, false, "2 ruecknehmbare -> offen");

	// Nur auf dem Reiter „Übernommen" bedienbar -- sonst gesperrt.
	// 🔴 OHNE Hinweistext seit dem 30.08.2026 (Owner: „verbraucht nur platz"): „Nur im Reiter
	// Übernommen verfügbar." sagte nur, dass hier nichts zu tun ist -- das sagt der graue Knopf
	// samt seinem „(0 von 0)". Der DRITTE Grund weiter unten bleibt, weil er das Gegenteil
	// erklärt.
	const zustandFalscherReiter = garetienRuecknahmeMengeZustand([objA, objB, objC], "offen");
	gleich(zustandFalscherReiter.gesperrt, true, "auf jedem anderen Reiter gesperrt");
	gleich(zustandFalscherReiter.hinweis, "", "und ohne Hinweistext");

	// Nichts markiert -> gesperrt, eigener Grund.
	entmarkieren("a");
	entmarkieren("b");
	entmarkieren("c");
	const zustandLeer = garetienRuecknahmeMengeZustand([objA, objB, objC], "uebernommen");
	gleich(zustandLeer.markiert, 0, "keine Markierung mehr");
	gleich(zustandLeer.gesperrt, true);
	gleich(zustandLeer.hinweis, "", "ebenfalls ohne Hinweistext -- die Zahl im Knopf sagt es");

	// Nur ein 'changed'-Objekt markiert -> markiert>0, aber ruecknehmbar=0, eigener Grund.
	markieren("c");
	const zustandNurChanged = garetienRuecknahmeMengeZustand([objA, objB, objC], "uebernommen");
	gleich(zustandNurChanged.markiert, 1);
	gleich(zustandNurChanged.ruecknehmbar, 0);
	gleich(zustandNurChanged.gesperrt, true);
	wahr(zustandNurChanged.hinweis.indexOf("bestehendes Objekt") !== -1,
		"der Grund nennt, WARUM: veraendert ein bestehendes Objekt");
	entmarkieren("c"); // wieder abwaehlen

	// =============================================================================================
	// 2. Die DOM-Haelfte -- garetienRuecknahmeMengeKnopfSetzen, ECHT auf dem Reiter „Übernommen"
	// =============================================================================================
	await aufReiterUebernommenWechseln([objA, objB, objC]);

	markieren("a");
	markieren("b");
	markieren("c");
	garetienRuecknahmeMengeKnopfSetzen([objA, objB, objC]);
	gleich(KNOPF.textContent, "Markierte zurücknehmen (2 von 3)");
	gleich(KNOPF.disabled, false);
	gleich(HINWEIS.hidden, true, "kein Grund noetig, solange der Knopf offen ist");

	// =============================================================================================
	// 3. garetienRuecknahmeMengeRueckfrageText -- REIN: nennt die Zahl
	// =============================================================================================
	const rueckfrage = garetienRuecknahmeMengeRueckfrageText([objA, objB]);
	wahr(rueckfrage.indexOf("2 Kartenobjekte") !== -1, "die Rueckfrage nennt die Zahl der Objekte");
	wahr(rueckfrage.indexOf("Fortfahren?") !== -1, "…und fragt wirklich");

	// =============================================================================================
	// 4. garetienRuecknahmeMengeAusfuehren -- REIN, SEQUENZIELL, und zaehlt genau richtig
	// =============================================================================================
	{
		const gestellt = [];
		const rufe = function (pfad, rumpf) {
			gestellt.push({ pfad: pfad, rumpf: rumpf });
			return Promise.resolve({ ok: true, zurueckgenommen: 1, fehler: [] });
		};
		const fortschrittLog = [];
		const summe = await garetienRuecknahmeMengeAusfuehren([101, 102], 4711, rufe,
			function (fertig, gesamt) { fortschrittLog.push([fertig, gesamt]); });

		gleich(summe, 2, "💣 Zusicherung 1: GENAU zwei werden zurueckgenommen");
		gleich(gestellt.length, 2, "ein Ruf JE id -- nie ein Sammelruf");
		gleich(gestellt[0].pfad, "/api/edit/map/garetien-import.php", "durch den EINEN Loeschweg");
		tief(gestellt[0].rumpf, { action: "ruecknahme", run_id: 4711, ids: [101] });
		tief(gestellt[1].rumpf, { action: "ruecknahme", run_id: 4711, ids: [102] });
		tief(fortschrittLog[0], [0, 2], "der Fortschritt beginnt bei 0 von 2");
		tief(fortschrittLog[fortschrittLog.length - 1], [2, 2], "…und endet bei 2 von 2");
	}

	// 💣 Zusicherung 2: SEQUENZIELL, nie parallel -- ein Spion protokolliert Start UND Ende.
	{
		const sequenz = [];
		let gleichzeitig = 0;
		const rufe = function (pfad, rumpf) {
			gleichzeitig++;
			wahr(gleichzeitig === 1, "zwei GLEICHZEITIGE Ruecknahme-Aufrufe waeren eine parallele Kette");
			sequenz.push("start:" + rumpf.ids[0]);
			return new Promise(function (resolve) {
				setTimeout(function () {
					sequenz.push("ende:" + rumpf.ids[0]);
					gleichzeitig--;
					resolve({ ok: true, zurueckgenommen: 1, fehler: [] });
				}, 0);
			});
		};
		const summe = await garetienRuecknahmeMengeAusfuehren([201, 202, 203], 1, rufe);
		tief(sequenz, ["start:201", "ende:201", "start:202", "ende:202", "start:203", "ende:203"],
			"jeder Schritt startet erst NACH dem Ende des vorigen");
		gleich(summe, 3);
	}

	gleich(await garetienKetteAbarbeiten([], function () { throw new Error("nie gerufen"); }), undefined,
		"eine leere Kette ruft ihren Schritt nie");

	// =============================================================================================
	// 5. Ein Fehler beim ZWEITEN von drei haelt die Kette an -- und nennt die schon Fertigen
	// =============================================================================================
	{
		// Der Server antwortet mit HTTP 200 und einem `fehler`-Eintrag -- KEIN Wurf
		// (avesmapsGaretienRuecknahmeAusfuehren meldet einen Fehlschlag genau so).
		const gestellt = [];
		const rufe = function (pfad, rumpf) {
			gestellt.push(rumpf.ids[0]);
			if (rumpf.ids[0] === 302) {
				return Promise.resolve({
					ok: true, zurueckgenommen: 0,
					fehler: [{ item: 302, grund: "veraendert ein bestehendes Objekt -- nicht ruecknehmbar" }],
				});
			}
			return Promise.resolve({ ok: true, zurueckgenommen: 1, fehler: [] });
		};

		let fehler = null;
		try {
			await garetienRuecknahmeMengeAusfuehren([301, 302, 303], 1, rufe);
		} catch (e) {
			fehler = e;
		}
		wahr(fehler !== null, "💣 ein Fehlschlag mittendrin wird NICHT verschluckt -- er wirft");
		wahr(fehler.message.indexOf("1 von 3") !== -1,
			"💣 die Meldung nennt, wie viele SCHON zurueckgenommen sind, bevor der Fehler kam: "
			+ JSON.stringify(fehler.message));
		wahr(fehler.message.indexOf("veraendert ein bestehendes Objekt") !== -1,
			"…und nennt den GRUND aus der Serverantwort");
		tief(gestellt, [301, 302], "🔴 der DRITTE Ruf (303) geht NIE hinaus -- die Kette haelt genau dort an");
	}

	// =============================================================================================
	// 6. „Ohne Bestätigung passiert nichts" -- End-zu-Ende ueber garetienRuecknahmeMengeKlick
	// =============================================================================================
	{
		const echt = global.fetch;
		global.fetch = function () { throw new Error("💣 OHNE Bestaetigung darf KEIN Netzruf stattfinden"); };
		const ergebnis = await garetienRuecknahmeMengeKlick(1, function () { return false; });
		global.fetch = echt;

		gleich(ergebnis, null, "der Klick loest ohne Bestaetigung nichts aus");

		// Ein zweiter Klick funktioniert weiterhin -- der Riegel `garetienRuecknahmeMengeLaeuft`
		// blieb NICHT haengen, obwohl kein einziger Netzruf stattfand.
		const d = machFetch(function (pfad, rumpf) {
			if (rumpf.action === "ruecknahme") { return { ok: true, zurueckgenommen: 1, fehler: [] }; }
			return { ok: true, objekte: [objA, objB, objC], gesamt: 3, bilanz: {},
				reiter: { uebernommen: 3 }, facetten: {} };
		});
		global.fetch = d.fn;
		await garetienRuecknahmeMengeKlick(1, function () { return true; });
		global.fetch = echt;
		wahr(d.angefragt.some((a) => a.rumpf.action === "ruecknahme"),
			"…und ein NAECHSTER Klick (mit Bestaetigung) funktioniert wieder normal");
	}

	// =============================================================================================
	// 7. Fehler mittendrin ueber den ECHTEN Klick: haelt an, entsperrt den Knopf, zeigt den Grund
	// =============================================================================================
	{
		markieren("a");
		markieren("b");
		await aufReiterUebernommenWechseln([objA, objB]);
		garetienRuecknahmeMengeKnopfSetzen([objA, objB]);
		gleich(KNOPF.textContent, "Markierte zurücknehmen (2 von 2)");

		const d = machFetch(function (pfad, rumpf) {
			if (rumpf.action === "ruecknahme" && rumpf.ids[0] === 101) {
				return { ok: true, zurueckgenommen: 1, fehler: [] };
			}
			if (rumpf.action === "ruecknahme" && rumpf.ids[0] === 102) {
				return { ok: true, zurueckgenommen: 0, fehler: [{ item: 102, grund: "server_kaputt" }] };
			}
			throw new Error("nach dem Fehlschlag darf nichts weiter gesendet werden");
		});
		const echt = global.fetch;
		global.fetch = d.fn;
		await garetienRuecknahmeMengeKlick(1, function () { return true; });
		global.fetch = echt;

		tief(d.angefragt.filter((a) => a.rumpf.action === "ruecknahme").map((a) => a.rumpf.ids[0]),
			[101, 102], "🔴 die Kette haelt NACH dem Fehlschlag an -- kein dritter Ruf, keine Liste danach");
		wahr(LISTE_EL.innerHTML.indexOf("1 von 2") !== -1,
			"💣 die Fehlermeldung steht IN der Liste und nennt die ZAHL der schon zurueckgenommenen: "
			+ LISTE_EL.innerHTML);
		wahr(LISTE_EL.innerHTML.indexOf("server_kaputt") !== -1, "…und den GRUND aus der Serverantwort");
		gleich(KNOPF.disabled, false, "der Knopf entsperrt sich wieder -- kein haengender Riegel");
	}

	console.log("garetien-ruecknahme-menge.test.js: " + checks + " Zusicherungen OK");
})().catch(function (fehler) {
	console.error(fehler);
	process.exit(1);
});
