// Die NAHT der Staging-Aufraeumung: `plan.staging_aufgeraeumt` -> Modulzustand -> Lauf-Kachel.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-staging-aufraeumung-naht.test.js
//
// 🔴 WARUM EIN EIGENER TEST UND KEIN REGEX. `garetien-menueband.test.js` prueft die reine
// Kachelfunktion mit einem hereingereichten `aufgeraeumt`, und der PHP-Test prueft die Regel in der
// Datenbank -- beide waeren gruen, waehrend die Zahl den Browser nie erreicht. Genau diese Sorte
// Bruch hat dieses Vorhaben schon zweimal bezahlt: einmal reiste `applied` nie mit und der ganze
// Browser-Zweig war tot, einmal warf ein Endpunkt mit ausdruecklicher Feldliste `anzahl` weg und
// die Kachel „Angezeigte Zeilen" war seit ihrer Auslieferung wirkungslos. Beide Male waren die
// Haelften gruen.
//
// 💣 `global.document` MUSS VOR dem `require` stehen: das Modul wertet `hasDocument` beim Laden
// aus (Zeile 23), und `garetienLaufKachelAktualisieren` steigt bei `false` in der ERSTEN Zeile
// aus. Ein nachtraeglich gesetztes `document` liesse den Test gruen laufen, ohne dass die Kachel
// je geschrieben wurde -- das Vakuum, gegen das dieser Test gebaut ist.

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

// --- Das gefaelschte Dokument. Nur die zwei Knoten, die die Lauf-Kachel anfasst.
const laufZeile = { textContent: "" };
const laufKnopf = { disabled: false };
global.document = {
	getElementById: function (id) {
		if (id === "garetien-run-state") { return laufZeile; }
		if (id === "garetien-run-tile") { return laufKnopf; }
		return null;
	},
	addEventListener: function () {},
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	createElement: function () { return { style: {}, classList: { add: function () {} }, appendChild: function () {} }; },
};
// Ein Admin -- sonst schlaegt der Riegel „nur Administratoren" jede andere Auskunft der Kachel,
// und der Test waere aus dem falschen Grund rot.
// ⚠️ `load()` gehoert dazu: das Modul bootet beim Laden (Zeile 6550) und ruft sie. Sie fehlen zu
// lassen ist ein TypeError beim `require` -- kein Befund, nur eine unvollstaendige Attrappe.
global.window = {
	AvesmapsSession: {
		current: function () { return { capabilities: { admin: true } }; },
		load: function () { return Promise.resolve({ capabilities: { admin: true } }); },
	},
	addEventListener: function () {},
};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

wahr(typeof mod.garetienLaufKachelAktualisieren === "function",
	"garetienLaufKachelAktualisieren fehlt im Export -- ohne sie laesst sich die Naht nur behaupten");

// ⚠️ Die Kachel liest die gewaehlten Ebenen aus dem MODULZUSTAND, nicht aus dem Array, das
// `garetienLaufStarten` bekommt -- ohne eine Wahl schlaegt „keine Ebene gewaehlt" jede andere
// Auskunft, und der Test waere aus dem falschen Grund rot. (Genau dieser Vorrang ist in
// garetien-menueband.test.js §5 festgenagelt: der Grund der Sperre gilt JETZT.)
mod.garetienEbenenAuswahl.add("ggp:Gewaesser");

// --- Ein Spion, der den ganzen Ablauf beantwortet: fetch -> plan -> runs.
const LAUF = { id: 7, started_at: "2026-09-04 11:58:02", finished_at: "2026-09-04 12:04:11", status: "done", zeilen: 8348 };
function spion(planAntwort) {
	return function (adresse, rumpf) {
		const action = (rumpf && rumpf.action) || "";
		if (action === "fetch") {
			return Promise.resolve({ ok: true, run_id: 7, gestaget: [{ wiki: "ggp", ebene: "Gewaesser", zeilen: 8348 }], fehler: [] });
		}
		if (action === "plan") { return Promise.resolve(planAntwort); }
		if (action === "runs") { return Promise.resolve({ ok: true, runs: [LAUF] }); }
		return Promise.resolve({ ok: true });
	};
}

const listeHolen = function () { return Promise.resolve({ ok: true }); };

// ---------------------------------------------------------------------------
// 1. DIE ZAHL AUS DER ANTWORT ERREICHT DIE KACHEL.
// ---------------------------------------------------------------------------
function nahtProbe() {
	laufZeile.textContent = "";
	const antwort = {
		ok: true,
		plan_run_id: 42,
		vorschlaege: 12,
		artikel_nachgetragen: 0,
		staging_aufgeraeumt: { laeufe: 3, zeilen: 25044, waisen: 0, offen: 4 },
	};

	return mod.garetienLaufStarten(spion(antwort), ["ggp:Gewaesser"], mod.garetienLaufKachelAktualisieren, listeHolen)
		.then(function () {
			wahr(laufZeile.textContent.indexOf("3 alte Läufe weg") >= 0,
				"was der Server aufgeraeumt hat, steht in der Kachel -- gelesen wurde: „" + laufZeile.textContent + "\"");
			wahr(laufZeile.textContent.indexOf("4 offen") >= 0,
				"und was der Deckel liegen liess, ebenso");
		});
}

// ---------------------------------------------------------------------------
// 2. 💣 EIN FEHLSCHLAG WIRD GENANNT, NICHT VERSCHWIEGEN.
//
// Der Endpunkt faengt einen Abbruch der Aufraeumung, damit sie den fertigen Plan nicht kippt --
// und meldet `null`. Verschwiege die Kachel das, saehe ein dauerhaft scheiterndes Aufraeumen
// genauso aus wie „es war nichts zu tun", und die Tabelle wuechse weiter, waehrend alles gruen
// aussieht. Das ist derselbe inerte `catch`, der bei „Was ist hier?" einen HY093 monatelang als
// leeres Ergebnis getarnt hat.
// ---------------------------------------------------------------------------
function fehlschlagProbe() {
	laufZeile.textContent = "";
	const antwort = { ok: true, plan_run_id: 42, vorschlaege: 12, staging_aufgeraeumt: null };

	return mod.garetienLaufStarten(spion(antwort), ["ggp:Gewaesser"], mod.garetienLaufKachelAktualisieren, listeHolen)
		.then(function () {
			wahr(laufZeile.textContent.indexOf("Aufräumen fehlgeschlagen") >= 0,
				"der Fehlschlag steht da -- gelesen wurde: „" + laufZeile.textContent + "\"");
		});
}

// ---------------------------------------------------------------------------
// 3. 💣 DER STAND EINES ALTEN LAUFS BLEIBT NICHT STEHEN.
//
// Nach dem ersten Aufraeumen ist bei jedem weiteren Lauf hoechstens EINER faellig -- die Kachel
// muss dann schweigen, statt „3 alte Laeufe weg" des Vorlaufs weiterzubehaupten.
//
// ⚠️ Getragen wird das von der Zuweisung im `plan`-Zweig, die den Wert BEDINGUNGSLOS uebernimmt
// (auch `undefined`), NICHT von einem eigenen Ruecksetzer. Genau der stand hier zuerst, und die
// Mutationsprobe hat ihn als tot entlarvt: sein Entfernen liess jeden Test gruen. Jeder Pfad, der
// `plan` gar nicht erreicht, setzt `garetienLaufMeldung` -- und die schlaegt in der Kachel ohnehin
// jede andere Auskunft. Wer hier je einen Ruecksetzer nachruestet, ruestet toten Code nach.
// ---------------------------------------------------------------------------
function stehtNichtProbe() {
	const erst = { ok: true, plan_run_id: 1, staging_aufgeraeumt: { laeufe: 3, zeilen: 25044, waisen: 0, offen: 0 } };
	return mod.garetienLaufStarten(spion(erst), ["ggp:Gewaesser"], mod.garetienLaufKachelAktualisieren, listeHolen)
		.then(function () {
			wahr(laufZeile.textContent.indexOf("3 alte Läufe weg") >= 0, "erster Lauf: die Zahl steht da");
			const zweit = { ok: true, plan_run_id: 2, staging_aufgeraeumt: { laeufe: 0, zeilen: 0, waisen: 0, offen: 0 } };
			return mod.garetienLaufStarten(spion(zweit), ["ggp:Gewaesser"], mod.garetienLaufKachelAktualisieren, listeHolen);
		})
		.then(function () {
			gleich(laufZeile.textContent.indexOf("alte Läufe weg"), -1,
				"zweiter Lauf ohne Aufraeumung: die alte Zahl ist WEG -- gelesen wurde: „" + laufZeile.textContent + "\"");
		});
}

nahtProbe()
	.then(fehlschlagProbe)
	.then(stehtNichtProbe)
	.then(function () {
		console.log("garetien-staging-aufraeumung-naht: " + checks + " Pruefungen bestanden.");
	})
	.catch(function (fehler) {
		console.error(fehler && fehler.message ? fehler.message : fehler);
		process.exitCode = 1;
	});
