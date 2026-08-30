// Aufraeumen nach einem Fehlimport (30.08.2026) -- der Knopf, der die feature_sources-
// Verknuepfungen mit origin='garetien' zaehlt und -- nach Bestaetigung -- entfernt.
// Owner, wörtlich: „entferne die quellen, sonst stehen sie irgendwann noch doppelt drin, weil du
// nix checkst".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-quellen-abbau.test.js
//
// 🔴 Geprueft werden hier die REINE Rechnung (garetienQuellenAbbauZustand, …RueckfrageText) UND
// die DOM-/Netz-Haelfte (garetienQuellenAbbauZaehlungHolen, …Klick) mit einem eingebauten
// Spion-`rufe` statt einem gefaelschten `global.fetch` -- beide Funktionen nehmen ihren Sender
// als optionalen zweiten Parameter herein, genau damit sich Netzverhalten ohne Browser messen
// laesst (dasselbe Muster wie garetienRuecknahmeMengeAusfuehren).
//
// 🔴 „OHNE BESTAETIGUNG PASSIERT NICHTS" ist die tragendste Zusicherung dieser Datei (Auftrag):
// Abschnitt C misst das als DIFFERENZ -- der Spion-`rufe` bleibt bei einer verweigerten
// Rueckfrage komplett unberuehrt, nicht nur „hat nicht geloescht".

"use strict";

const path = require("path");
const assert = require("assert");

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

// ---- Das gefaelschte `document` -- absichtlich MAGER (Vorbild: garetien-fussknopf-dom.test.js):
// nur die zwei Elemente, um die es hier geht; `null` fuer alles andere, jede beruehrte Stelle ist
// dagegen abgesichert.
function macheElement(id) {
	return {
		id: id,
		hidden: false,
		disabled: false,
		textContent: "",
		dataset: {},
		_hoerer: {},
		addEventListener(art, fn) {
			this._hoerer[art] = this._hoerer[art] || [];
			this._hoerer[art].push(fn);
		},
		klick() {
			(this._hoerer.click || []).forEach((fn) => fn({ target: this }));
			return (this._hoerer.click || []).length;
		},
	};
}

const ELEMENTE = {};
["garetien-quellen-abbau", "garetien-quellen-abbau-hint"].forEach((id) => {
	ELEMENTE[id] = macheElement(id);
});

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
	garetienQuellenAbbauZustand,
	garetienQuellenAbbauKnopfSetzen,
	garetienQuellenAbbauRueckfrageText,
	garetienQuellenAbbauZaehlungHolen,
	garetienQuellenAbbauKlick,
} = mod;

[["garetienQuellenAbbauZustand", garetienQuellenAbbauZustand],
	["garetienQuellenAbbauKnopfSetzen", garetienQuellenAbbauKnopfSetzen],
	["garetienQuellenAbbauRueckfrageText", garetienQuellenAbbauRueckfrageText],
	["garetienQuellenAbbauZaehlungHolen", garetienQuellenAbbauZaehlungHolen],
	["garetienQuellenAbbauKlick", garetienQuellenAbbauKlick],
].forEach(([name, fn]) => wahr(typeof fn === "function", name + " fehlt im Export"));

const KNOPF = ELEMENTE["garetien-quellen-abbau"];
const HINWEIS = ELEMENTE["garetien-quellen-abbau-hint"];

// =================================================================================================
// A. Die REINE Rechnung -- garetienQuellenAbbauZustand
// =================================================================================================

// Noch nie gezaehlt: gesperrt, mit einem Grund -- kein stiller, ungeklaerter Zustand.
tief(garetienQuellenAbbauZustand(null, false, ""),
	{ beschriftung: "Fehlimport-Quellen entfernen", gesperrt: true, hinweis: "Zählung noch nicht geladen." },
	"vor der ersten Zaehlung: gesperrt, mit Standardgrund");

// Ein gescheiterter Zaehlversuch traegt SEINEN Grund, nicht den Standardsatz.
tief(garetienQuellenAbbauZustand(null, false, "Netzwerkfehler beim Zaehlen."),
	{ beschriftung: "Fehlimport-Quellen entfernen", gesperrt: true, hinweis: "Netzwerkfehler beim Zaehlen." },
	"ein Fehler beim Zaehlen zeigt SEINEN Text, nicht \"noch nicht geladen\"");

// Null Treffer: die Zahl steht in der Beschriftung, gesperrt, MIT einem anderen Grund als oben --
// "nichts gezaehlt" und "null gezaehlt" sind zwei verschiedene Tatsachen.
tief(garetienQuellenAbbauZustand({ verknuepfungen: 0, objekte: 0 }, false, ""),
	{ beschriftung: "Fehlimport-Quellen entfernen (0)", gesperrt: true, hinweis: "Keine Fehlimport-Quellen gefunden." },
	"0 gezaehlt: die Null steht IM Knopf, gesperrt, mit einem eigenen Grund");

// Der Normalfall aus dem Auftrag: 372 Verknuepfungen -- die Zahl in der Beschriftung, offen, ohne
// Hinweis (die Rueckfrage traegt die zweite Zahl, siehe Abschnitt B).
tief(garetienQuellenAbbauZustand({ verknuepfungen: 372, objekte: 312 }, false, ""),
	{ beschriftung: "Fehlimport-Quellen entfernen (372)", gesperrt: false, hinweis: "" },
	"372 gezaehlt: die Zahl im Knopf, offen, kein Hinweis");

// 🔴 "laeuft" schlaegt JEDE Zaehlung -- auch eine mit Treffern. Ein Klick waehrend des Laufs darf
// den Knopf nicht wieder aufmachen, egal was die letzte Zaehlung sagte.
tief(garetienQuellenAbbauZustand({ verknuepfungen: 372, objekte: 312 }, true, ""),
	{ beschriftung: "Entfernt …", gesperrt: true, hinweis: "" },
	"waehrend des Laufs: eigene Beschriftung, gesperrt, kein Hinweis");

// =================================================================================================
// B. Die Rueckfrage -- BEIDE Zahlen, UND die Zusicherung, was bestehen bleibt
// =================================================================================================

const rueckfrage = garetienQuellenAbbauRueckfrageText({ verknuepfungen: 372, objekte: 312 });
wahr(rueckfrage.indexOf("372 Verknüpfungen") !== -1, "die Rueckfrage nennt die Verknuepfungszahl");
wahr(rueckfrage.indexOf("312 Objekten") !== -1, "…und die Objektzahl -- Auftrag: \"372 Verknüpfungen an 312 Objekten\"");
wahr(rueckfrage.indexOf("Katalogeinträge") !== -1,
	"🔴 sagt AUSDRUECKLICH, dass die Kataloganeintraege bestehen bleiben -- nicht nur, was verschwindet");
wahr(rueckfrage.indexOf("Fortfahren?") !== -1, "endet mit der Rueckfrage, wie jede andere Loeschhandlung im Fenster");

const einzahl = garetienQuellenAbbauRueckfrageText({ verknuepfungen: 1, objekte: 1 });
wahr(einzahl.indexOf("1 Verknüpfung ") !== -1, "Einzahl bei genau einer Verknuepfung (kein \"1 Verknüpfungen\")");
wahr(einzahl.indexOf("1 Objekt ") !== -1, "…und Einzahl beim Objekt");

// =================================================================================================
// C. Die DOM-/Netz-Haelfte -- Zaehlen und Entfernen wirklich ausgefuehrt, mit einem Spion statt
//    echtem `fetch`.
// =================================================================================================

async function pruefeQuellenAbbau() {
	// Ausgangslage: noch nie gezaehlt (die pure Rechnung aus Abschnitt A, jetzt am echten Knopf).
	const anfang = garetienQuellenAbbauKnopfSetzen();
	gleich(KNOPF.textContent, "Fehlimport-Quellen entfernen", "Ausgangsbeschriftung ohne Zahl");
	gleich(KNOPF.disabled, true, "und gesperrt, bevor ueberhaupt gezaehlt wurde");
	gleich(HINWEIS.hidden, false, "der Grund ist SICHTBAR -- ein `title` erschiene an einem gesperrten Knopf nie");
	gleich(HINWEIS.textContent, "Zählung noch nicht geladen.", "…mit dem Standardgrund");
	wahr(anfang && anfang.gesperrt === true, "die Funktion gibt den gesetzten Stand zurueck");

	// --- C1: die Zaehlung holen -- EIN Ruf, GENAU diese Aktion.
	const zaehlAufrufe = [];
	function rufeZaehlen(pfad, rumpf) {
		zaehlAufrufe.push({ pfad, rumpf });
		return Promise.resolve({ ok: true, verknuepfungen: 372, objekte: 312,
			nach_typ: { settlement: 200, path: 140, region: 32 } });
	}
	await garetienQuellenAbbauZaehlungHolen(rufeZaehlen);
	gleich(zaehlAufrufe.length, 1, "genau EIN Ruf fuers Zaehlen");
	gleich(zaehlAufrufe[0].pfad, "/api/edit/map/garetien-import.php", "…an den Importer-Endpunkt");
	tief(zaehlAufrufe[0].rumpf, { action: "quellen_zaehlen" }, "…mit GENAU dieser Aktion, ohne run_id");
	gleich(KNOPF.textContent, "Fehlimport-Quellen entfernen (372)", "der Knopf traegt die Zahl aus der Antwort");
	gleich(KNOPF.disabled, false, "…und ist jetzt offen");
	gleich(HINWEIS.hidden, true, "…kein Hinweis mehr noetig");

	// --- C2: OHNE BESTAETIGUNG PASSIERT NICHTS -- die tragendste Zusicherung des Auftrags.
	const bereinigungsAufrufeOhneBestaetigung = [];
	function rufeSollNieAnkommen(pfad, rumpf) {
		bereinigungsAufrufeOhneBestaetigung.push({ pfad, rumpf });
		return Promise.reject(new Error("darf nie gerufen werden"));
	}
	const ohneBestaetigung = await garetienQuellenAbbauKlick(function () { return false; }, rufeSollNieAnkommen);
	gleich(ohneBestaetigung, null, "eine verweigerte Rueckfrage liefert null zurueck");
	gleich(bereinigungsAufrufeOhneBestaetigung.length, 0,
		"🔴 der Spion wurde KEIN EINZIGES MAL gerufen -- nicht nur \"hat nicht geloescht\", sondern "
		+ "\"hat den Server nie erreicht\"");
	gleich(KNOPF.disabled, false, "und der Knopf bleibt unveraendert offen -- kein Seiteneffekt");

	// --- C3: gesperrt bei Null -- ein Klick auf einen bereits leeren Bestand ruft gar nicht erst,
	// selbst wenn (fehlerhaft) bestaetigt wuerde.
	await garetienQuellenAbbauZaehlungHolen(function () {
		return Promise.resolve({ ok: true, verknuepfungen: 0, objekte: 0, nach_typ: {} });
	});
	gleich(KNOPF.disabled, true, "0 Verknuepfungen -> gesperrt");
	const beiNull = await garetienQuellenAbbauKlick(function () { return true; }, rufeSollNieAnkommen);
	gleich(beiNull, null, "ein Klick auf 0 tut nichts");
	gleich(bereinigungsAufrufeOhneBestaetigung.length, 0, "…und ruft weiterhin nicht");

	// Zaehlung fuer den naechsten Abschnitt wiederherstellen.
	await garetienQuellenAbbauZaehlungHolen(rufeZaehlen);
	gleich(KNOPF.disabled, false, "wieder offen, fuer den bestaetigten Klick unten");

	// --- C4: BESTAETIGT -- entfernen, DANACH neu zaehlen (nicht der blossen Serverzahl vertrauen).
	const aufrufe = [];
	function rufeBestaetigt(pfad, rumpf) {
		aufrufe.push({ pfad, rumpf });
		if (rumpf.action === "quellen_bereinigen") {
			return Promise.resolve({ ok: true, entfernt: 372 });
		}
		if (rumpf.action === "quellen_zaehlen") {
			// Nach dem Entfernen: der Bestand ist jetzt leer.
			return Promise.resolve({ ok: true, verknuepfungen: 0, objekte: 0, nach_typ: {} });
		}
		return Promise.reject(new Error("unerwartete Aktion: " + rumpf.action));
	}
	let gefragtMit = null;
	const nachBestaetigung = await garetienQuellenAbbauKlick(function (text) {
		gefragtMit = text;
		return true;
	}, rufeBestaetigt);
	wahr(gefragtMit !== null && gefragtMit.indexOf("372 Verknüpfungen") !== -1,
		"die Rueckfrage wurde WIRKLICH mit dem Text aus Abschnitt B gestellt");
	gleich(aufrufe.length, 2, "GENAU zwei Rufe: erst loeschen, dann neu zaehlen");
	gleich(aufrufe[0].rumpf.action, "quellen_bereinigen", "der erste Ruf loescht");
	gleich(aufrufe[1].rumpf.action, "quellen_zaehlen", "der zweite zaehlt NEU -- er vertraut nicht blind der Serverzahl");
	wahr(nachBestaetigung && nachBestaetigung.entfernt === 372, "die Antwort des Loeschrufs kommt durch");
	gleich(KNOPF.textContent, "Fehlimport-Quellen entfernen (0)", "nach dem Entfernen: der Knopf zeigt die NEUE Zaehlung");
	gleich(KNOPF.disabled, true, "…und ist wieder gesperrt, weil nichts mehr uebrig ist");
	gleich(HINWEIS.textContent, "Keine Fehlimport-Quellen gefunden.", "…mit dem Grund dafuer");

	// --- C5: ein Fehlschlag beim Loeschen setzt den Laufriegel zurueck, statt den Knopf fuer immer
	// auf "Entfernt …" haengen zu lassen.
	await garetienQuellenAbbauZaehlungHolen(rufeZaehlen); // wieder auf 372 bringen
	gleich(KNOPF.disabled, false, "Ausgangslage fuer den Fehlerfall: wieder offen");
	const fehlgeschlagen = await garetienQuellenAbbauKlick(function () { return true; }, function (pfad, rumpf) {
		if (rumpf.action === "quellen_bereinigen") { return Promise.reject(new Error("Server antwortet nicht")); }
		return Promise.resolve({ ok: true, verknuepfungen: 372, objekte: 312, nach_typ: {} });
	});
	gleich(fehlgeschlagen, null, "ein gescheiterter Loeschversuch liefert null, statt zu werfen");
	gleich(KNOPF.textContent, "Fehlimport-Quellen entfernen (372)",
		"🔴 der Riegel wird zurueckgesetzt -- der Knopf haengt NICHT fuer immer auf \"Entfernt …\"");
	gleich(KNOPF.disabled, false, "…und ist wieder bedienbar, mit der letzten bekannten Zaehlung");

	// --- C6: die Klick-Verdrahtung selbst -- ein echter Klick auf den Knopf loest denselben Ablauf
	// aus (ueber bindFenster(), das beim Laden schon lief, readyState "complete").
	const drahtAufrufe = [];
	// garetienFragen() im Produktivcode fragt window.confirm -- fuer den reinen Verdrahtungstest
	// wird NICHT window.confirm gefaelscht (das ist Sache der Rueckfrage-Funktion selbst, Abschnitt
	// B), sondern direkt geprueft, dass ein Klick ueberhaupt beim Sender ankommt: window.confirm
	// wird auf "true" gestellt, echtes `fetch` gefaelscht.
	const echtesConfirm = global.window.confirm;
	const echtesFetch = global.fetch;
	global.window.confirm = function () { return true; };
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse(optionen.body);
		drahtAufrufe.push(rumpf);
		const antwort = rumpf.action === "quellen_zaehlen"
			? { ok: true, verknuepfungen: 372, objekte: 312, nach_typ: {} }
			: { ok: true, entfernt: 372 };
		return Promise.resolve({ json: () => Promise.resolve(antwort) });
	};
	KNOPF.klick();
	await tick();
	await tick();
	await tick();
	global.window.confirm = echtesConfirm;
	global.fetch = echtesFetch;
	wahr(drahtAufrufe.some((r) => r.action === "quellen_bereinigen"),
		"🔴 der ECHTE Knopf ist wirklich verdrahtet -- ein Klick loest ueber bindFenster() denselben "
		+ "Ablauf aus wie der direkte Funktionsaufruf oben");
}

pruefeQuellenAbbau().then(function () {
	console.log(`garetien-quellen-abbau ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
