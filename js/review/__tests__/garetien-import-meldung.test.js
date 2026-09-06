// Aufgabe 3 des Garetien-Importer-Stage-Umbaus: das Import-Ergebnis in der Statuszeile.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-3-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-import-meldung.test.js
//
// Geprueft werden zwei REINE Funktionen (kein DOM, kein Modulzustand) ueber den Weg, den der
// Brief vorschreibt: `require(...).__test`, nicht die flachen Exporte -- beide stehen im Modul,
// dieser Test haelt sich an den ersten.
//
// 🔴 VIER Zusicherungen (voller Erfolg, Teilerfolg, kein Erfolg, reine Quellen-Ergaenzung), gegen
// VIER Mutationen gefahren, alle gefangen: (1) `ton` ignoriert `fehler` -> Szenario 2 rot; (2)
// `bach` als EIGENER Posten statt in Klammern beim Weg -> Szenario 1 rot (dieselbe Zusicherung
// faengt zwei verschiedene Mutationen dieser Regel); (3) `if (n === 0) { return; }` gestrichen ->
// Szenario 1 rot ("eine Form mit null wird gar nicht genannt"); (4) der `ton`-Riegel komplett
// entfernt (immer "ok") -> Szenario 2 rot. Alle vier manuell gefahren und wieder zurueckgenommen.

"use strict";

const path = require("path");
const assert = require("assert");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienImportMeldung } = mod.__test;

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

wahr(typeof garetienImportMeldung === "function", "garetienImportMeldung fehlt in __test");
wahr(typeof mod.__test.garetienImportFormenText === "function",
	"garetienImportFormenText fehlt in __test -- Aufgabe 3 exportiert beide REINEN Funktionen");

// =================================================================================================
// 1. Voller Erfolg: die Formen stehen da, nicht nur eine Zahl.
// =================================================================================================

let m = garetienImportMeldung({
	applied: 5, fehler: [],
	angelegt_je_form: { path: 3, bach: 2, region: 1, label: 0, location: 0, settlement_place: 1, quelle: 0 },
});
gleich(m.ton, "ok", "voller Erfolg -> Ton ok");
wahr(m.text.includes("5 Objekte importiert"), "die Gesamtzahl steht da: " + m.text);
wahr(m.text.includes("3 Wege (2 Bäche)"), "die Bach-Zahl steht in Klammern beim Weg: " + m.text);
// 🪤 Mutationsprobe 4 (Auftrag): `bach` zusätzlich als eigener Wortschlüssel in die Formtafel
// aufgenommen (die inline-Klammer bleibt daneben stehen) überlebt die Zusicherung darüber, weil
// „3 Wege (2 Bäche)" als TEILSTRING weiter vorkommt -- „Bäche" darf deshalb nur EINMAL im Satz
// stehen, nie ein zweites Mal als eigener, zusätzlicher Posten.
gleich((m.text.match(/Bäche/g) || []).length, 1,
	"„Bäche\" kommt genau einmal vor -- nie ein zweites Mal als eigener Posten neben der Klammer: " + m.text);
wahr(m.text.includes("1 Fläche"), "die Fläche steht da: " + m.text);
wahr(m.text.includes("1 Stätte"), "die Stätte steht da: " + m.text);
wahr(!m.text.includes("0 "), "eine Form mit null wird gar nicht genannt: " + m.text);

// =================================================================================================
// 2. Teilerfolg: der GRUND steht da, nicht nur die Zahl -- und es ist eine WARNUNG.
// =================================================================================================

m = garetienImportMeldung({
	applied: 4,
	fehler: [{ item: 9, grund: 'Aus 1 Punkten laesst sich kein Ziel der Art "path" bauen.' }],
	angelegt_je_form: { path: 4, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
});
gleich(m.ton, "bad", "ein Teilerfolg ist eine Warnung, keine Erfolgsmeldung");
wahr(m.text.includes("1 von 5 nicht importiert"), "genannt wird n von GESAMT: " + m.text);
wahr(m.text.includes("kein Ziel der Art"), "der Servergrund reist mit, nicht nachgebaut: " + m.text);

// =================================================================================================
// 3. Nichts durchgekommen: keine Erfolgsliste, trotzdem ein Ton.
// =================================================================================================

m = garetienImportMeldung({
	applied: 0, fehler: [{ item: 9, grund: "X" }],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
});
gleich(m.ton, "bad", "nichts angelegt, aber ein Fehlschlag -> bad");
wahr(!m.text.includes("importiert —"), "ohne Erfolg keine Erfolgsliste: " + m.text);

// =================================================================================================
// 4. Eine reine Quellen-Ergänzung ist KEIN angelegtes Objekt und wird EIGENS genannt.
// =================================================================================================

m = garetienImportMeldung({
	applied: 0, fehler: [],
	angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 3 },
});
gleich(m.ton, "ok", "eine reine Ergänzung ohne Fehler bleibt ein Erfolg");
wahr(m.text.includes("3 Quellen ergänzt"), "die Quellen-Ergänzung steht für sich: " + m.text);
wahr(!m.text.includes("Objekte importiert"),
	"🔴 KEIN erfundenes Kartenobjekt -- eine reine Ergänzung zählt nicht in `applied`: " + m.text);

// =================================================================================================
// 5. Rand: gar nichts zu tun -- weder Erfolg noch Fehlschlag.
// =================================================================================================

m = garetienImportMeldung({ applied: 0, fehler: [], angelegt_je_form: {} });
gleich(m.ton, "", "kein Erfolg, kein Fehler -> neutraler Ton, keine gruene ODER rote Faerbung");
gleich(m.text, "Es war nichts zu importieren.", "der leere Rand bekommt einen eigenen Satz");

console.log(`garetien-import-meldung ok -- ${checks} Zusicherungen`);
