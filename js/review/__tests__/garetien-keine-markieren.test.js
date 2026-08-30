// Owner-Auftrag B (30.08.2026): „Neben 'Alle markieren (500)' braucht es auch noch
// 'Keines markieren'." Leert `zustand.markiert`, weich (`.btn`), gesperrt mit sichtbarem Grund,
// wenn nichts markiert ist.
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
// 1. garetienKeineMarkierenZustand -- REIN: Beschriftung, Sperre, sichtbarer Grund
// =================================================================================================
const leer = modul.garetienKeineMarkierenZustand(0);
gleich(leer.beschriftung, "Keines markieren", "die Beschriftung traegt keine Zahl -- anders als „Alle markieren\"");
gleich(leer.gesperrt, true, "ohne eine einzige Markierung ist nichts zu leeren");
wahr(leer.hinweis.length > 0, "und der Grund steht SICHTBAR daneben, nie nur im `title`");

const voll = modul.garetienKeineMarkierenZustand(3);
gleich(voll.gesperrt, false, "mit mindestens einer Markierung ist der Knopf bedienbar");
gleich(voll.hinweis, "", "und dann ohne Hinweis");
gleich(voll.beschriftung, "Keines markieren", "die Beschriftung bleibt gleich -- sie zeigt keine Zahl");

gleich(modul.garetienKeineMarkierenZustand().gesperrt, true, "ganz ohne Argument gilt dasselbe wie 0");

// =================================================================================================
// 2. avesmapsGaretienKeineMarkieren -- leert WIRKLICH, ergaenzt nichts, ersetzt nichts
// =================================================================================================
modul.avesmapsGaretienMarkierungUmschalten("a1");
modul.avesmapsGaretienMarkierungUmschalten("a2");
modul.avesmapsGaretienMarkierungUmschalten("a3");
gleich(modul.avesmapsGaretienMarkierungHat("a2"), true, "die Fixture steht wirklich markiert da");

const neueGroesse = modul.avesmapsGaretienKeineMarkieren();
gleich(neueGroesse, 0, "die Rueckgabe ist die NEUE (immer leere) Groesse, wie bei avesmapsGaretienAnzeigeLeeren");
gleich(modul.avesmapsGaretienMarkierungHat("a1"), false, "a1 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienMarkierungHat("a2"), false, "a2 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienMarkierungHat("a3"), false, "a3 ist nicht mehr markiert");

// =================================================================================================
// 3. Miss die DIFFERENZ: „Keines markieren" leert NUR die Markierung, nie die Anzeige-Menge --
//    zwei verschiedene Mengen mit unterschiedlichem Zweck (Auftrag, „Anzeige leeren" bleibt
//    eigenstaendig).
// =================================================================================================
modul.avesmapsGaretienAnzeigeLeeren();
modul.avesmapsGaretienAnzeigeHinzufuegen([{ key: "b1", name: "B1" }]);
modul.avesmapsGaretienMarkierungUmschalten("b1");
modul.avesmapsGaretienKeineMarkieren();
gleich(modul.avesmapsGaretienMarkierungHat("b1"), false, "b1 ist nicht mehr markiert");
gleich(modul.avesmapsGaretienAnzeigeHat("b1"), true, "aber b1 liegt weiterhin in der Anzeige -- „Keines markieren\" ruehrt sie nicht an");

console.log(`garetien-keine-markieren: ${checks} Pruefungen bestanden.`);
