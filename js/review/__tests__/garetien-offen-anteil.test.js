// Der Fortschritt in der Statuszeile des Garetien-Importers (Owner 15.09.2026).
//
// Owner, woertlich: „wär cool, wenn in der statusleiste sowas drinsteht wie
// Lauf 15.09., 06:39 · 9192 Objekte · 4048 mit Vorschlag · 0 auf der Stage · Noch 8587 von 9192
// Objekten (93,4%) offen".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-offen-anteil.test.js
//
// 🔴 Gemessen wird die REINE Haelfte (garetienOffenAnteilText) UND das Ergebnis in der echten
// Statuszeile (garetienStatusRuhe) -- eine Formel, die niemand in die Zeile schreibt, waere Vakuum.

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter();
const { garetienOffenAnteilText, garetienStatusRuhe } = api;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };

wahr(typeof garetienOffenAnteilText === "function", "garetienOffenAnteilText fehlt im Export");
wahr(typeof garetienStatusRuhe === "function", "garetienStatusRuhe fehlt im Export");

// =================================================================================================
// 1. Der Owner-Wortlaut, Zeichen fuer Zeichen.
// =================================================================================================
gleich(garetienOffenAnteilText(8587, 9192), "Noch 8587 von 9192 Objekten (93,4%) offen",
	"der Satz aus der Owner-Meldung");
gleich(garetienOffenAnteilText(4596, 9192), "Noch 4596 von 9192 Objekten (50,0%) offen",
	"eine glatte Zahl traegt trotzdem ihre Nachkommastelle");
gleich(garetienOffenAnteilText(1, 1), "Noch 1 von 1 Objekt (100,0%) offen", "Einzahl im Nenner");

// =================================================================================================
// 2. 💣 NIE AUF DEN RAND GERUNDET -- ein einziges verbliebenes Objekt ist nicht „fertig".
// =================================================================================================
gleich(garetienOffenAnteilText(9192, 9192), "Noch 9192 von 9192 Objekten (100,0%) offen",
	"100,0% nur, wenn wirklich alles offen ist");
gleich(garetienOffenAnteilText(9191, 9192), "Noch 9191 von 9192 Objekten (99,9%) offen",
	"💣 9191/9192 waere gerundet 100,0% -- das behauptete, es sei noch nichts bearbeitet");
gleich(garetienOffenAnteilText(0, 9192), "Noch 0 von 9192 Objekten (0,0%) offen",
	"0,0% nur, wenn nichts mehr offen ist");
gleich(garetienOffenAnteilText(1, 9192), "Noch 1 von 9192 Objekten (0,1%) offen",
	"💣 1/9192 waere gerundet 0,0% -- das behauptete, die Liste sei leer");

// =================================================================================================
// 3. Ohne verlaessliche Zahlen steht GAR NICHTS da.
// =================================================================================================
gleich(garetienOffenAnteilText(undefined, 9192), "", "ohne `reiter.offen` keine Aussage");
gleich(garetienOffenAnteilText(null, 9192), "", "…auch nicht bei null");
gleich(garetienOffenAnteilText("", 9192), "", "…und nicht bei einer leeren Zeichenkette (Number(\"\") ist 0)");
gleich(garetienOffenAnteilText(3, 0), "", "ohne Lauf (0 Objekte) kein Fortschritt");
gleich(garetienOffenAnteilText(10, 5), "", "zwei Zahlen, die sich widersprechen, ergeben keinen Fortschritt");
gleich(garetienOffenAnteilText("abc", 9192), "", "und keine Zahl ist keine Zahl");

// =================================================================================================
// 4. IN DER ECHTEN STATUSZEILE -- hinten angehaengt, mit dem Trenner der Zeile.
// =================================================================================================
const bilanz = { neu: 3000, ergaenzung: 1000, zweifel: 40, widerspruch: 8, deckt_sich: 1000, uebersprungen: 4144 };
garetienStatusRuhe({ bilanz: bilanz, reiter: { offen: 8587, abgelehnt: 415, uebernommen: 190 } });
const mitReiter = dom.text("#garetien-status-text");
wahr(mitReiter.endsWith("9192 Objekte · 4048 mit Vorschlag · 0 auf der Stage · Noch 8587 von 9192 Objekten (93,4%) offen"),
	"die Zeile endet mit dem Fortschritt, im Wortlaut des Owners: " + mitReiter);

// Eine Antwort OHNE Reiter (alte Antwort, Test-Attrappe) sagt nichts ueber den Fortschritt.
garetienStatusRuhe({ bilanz: bilanz });
const ohneReiter = dom.text("#garetien-status-text");
wahr(ohneReiter.endsWith("0 auf der Stage"), "ohne `reiter` bleibt die Zeile, wie sie war: " + ohneReiter);
wahr(ohneReiter.indexOf(" offen") === -1, "…und behauptet keinen Fortschritt: " + ohneReiter);

// Ohne Lauf erst recht nicht.
garetienStatusRuhe({});
const leer = dom.text("#garetien-status-text");
wahr(leer.indexOf(" offen") === -1, "ohne Lauf kein Fortschritt: " + leer);

console.log("garetien-offen-anteil: " + checks + " Pruefungen bestanden.");
