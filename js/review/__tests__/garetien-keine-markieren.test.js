// Owner-Auftrag B (30.08.2026): „Neben 'Alle markieren (500)' braucht es auch noch
// 'Keines markieren'." Leert `zustand.auswahl`, weich (`.btn`), gesperrt mit sichtbarem Grund,
// wenn nichts ausgewaehlt ist.
//
// 🔴 Aufgabe 8: „Keines markieren" heisst seither „Auswahl aufheben"
// (garetienAuswahlAufhebenZustand/-KnopfSetzen) -- der Owner-Auftrag bleibt als woertliches
// Zitat stehen, die Beschriftung selbst hat sich geaendert.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-keine-markieren.test.js
"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

// =================================================================================================
// 1. garetienAuswahlAufhebenZustand -- REIN: Beschriftung, Sperre, sichtbarer Grund
// =================================================================================================
const leer = modul.garetienAuswahlAufhebenZustand(0);
gleich(leer.beschriftung, "Auswahl aufheben", "die Beschriftung traegt keine Zahl -- anders als „Alle wählen\"");
gleich(leer.gesperrt, true, "ohne eine einzige Auswahl ist nichts zu leeren");
// 🔴 OHNE Hinweistext (Owner 30.08.2026: „verbraucht nur platz") -- „Nichts markiert — nichts zu
// leeren." sagte nur, was der graue Knopf schon sagt.
gleich(leer.hinweis, undefined, "der Zustand traegt gar keinen Hinweistext mehr");

const voll = modul.garetienAuswahlAufhebenZustand(3);
gleich(voll.gesperrt, false, "mit mindestens einer Auswahl ist der Knopf bedienbar");
gleich(voll.beschriftung, "Auswahl aufheben", "die Beschriftung bleibt gleich -- sie zeigt keine Zahl");

gleich(modul.garetienAuswahlAufhebenZustand().gesperrt, true, "ganz ohne Argument gilt dasselbe wie 0");

// =================================================================================================
// 2. avesmapsGaretienAuswahlAufheben -- leert WIRKLICH, ergaenzt nichts, ersetzt nichts
// =================================================================================================
modul.avesmapsGaretienAuswahlUmschalten("a1");
modul.avesmapsGaretienAuswahlUmschalten("a2");
modul.avesmapsGaretienAuswahlUmschalten("a3");
gleich(modul.avesmapsGaretienAuswahlHat("a2"), true, "die Fixture steht wirklich markiert da");

const neueGroesse = modul.avesmapsGaretienAuswahlAufheben();
gleich(neueGroesse, 0, "die Rueckgabe ist die NEUE (immer leere) Groesse, wie bei avesmapsGaretienStageLeeren");
gleich(modul.avesmapsGaretienAuswahlHat("a1"), false, "a1 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienAuswahlHat("a2"), false, "a2 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienAuswahlHat("a3"), false, "a3 ist nicht mehr markiert");

// =================================================================================================
// 3. Miss die DIFFERENZ: „Auswahl aufheben" leert NUR die Auswahl, nie die Stage-Menge --
//    zwei verschiedene Mengen mit unterschiedlichem Zweck (Auftrag, „Stage leeren" bleibt
//    eigenstaendig).
// =================================================================================================
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienStageHinzufuegen([{ key: "b1", name: "B1" }]);
modul.avesmapsGaretienAuswahlUmschalten("b1");
modul.avesmapsGaretienAuswahlAufheben();
gleich(modul.avesmapsGaretienAuswahlHat("b1"), false, "b1 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienStageHat("b1"), true, "aber b1 liegt weiterhin auf der Stage -- „Auswahl aufheben\" ruehrt sie nicht an");

console.log(`garetien-keine-markieren: ${checks} Pruefungen bestanden.`);
