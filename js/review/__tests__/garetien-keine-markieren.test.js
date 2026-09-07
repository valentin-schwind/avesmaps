// Owner-Auftrag B (30.08.2026): „Neben 'Alle markieren (500)' braucht es auch noch
// 'Keines markieren'." Leert `zustand.auswahl`, weich (`.btn`), gesperrt mit sichtbarem Grund,
// wenn nichts ausgewaehlt ist.
//
// 🔴 Aufgabe 8: „Keines markieren" heisst seither „Auswahl aufheben".
// 🔴 FIXRUNDE 1 (D2, 07.09.2026): der Knopf hat den FUSS VERLASSEN und steht in der Auswahlleiste --
// eine Handlung, die der AUSWAHL gilt, gehoert dorthin, wo die Auswahl ihre Zahl hat. Damit sind
// `garetienAuswahlAufhebenZustand`/`-KnopfSetzen` ersatzlos gefallen; Beschriftung und Sperre kommen
// aus `garetienAuswahlleisteZustand`. Der REINE Zug `avesmapsGaretienAuswahlAufheben` ist
// unveraendert, und er ist der Gegenstand dieser Datei.
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
// 1. Beschriftung und Sperre kommen aus der AUSWAHLLEISTE -- REIN
// =================================================================================================
// ⚠️ „Auswahl aufheben" ist der einzige Knopf der Leiste OHNE Eintrag in der Zaehler-Tafel: er
// raeumt die GANZE Auswahl ab, auch die Zeilen, die ein Filter gerade ausblendet, und kann deshalb
// immer. Gemessen wird genau das.
const knopfAufheben = (anzahl, objekte) => modul.garetienAuswahlleisteZustand("offen", anzahl, objekte)
	.knoepfe.filter((k) => k.name === "auswahl_aufheben")[0];

gleich(modul.garetienAuswahlleisteZustand("offen", 0, []).sichtbar, false,
	"ohne eine einzige Auswahl gibt es die Leiste gar nicht -- das ist die neue „Sperre\"");
const voll = knopfAufheben(3, []);
gleich(voll.t1, "Auswahl aufheben", "die Beschriftung traegt keine Zahl im Namen");
gleich(voll.t2, "3 Objekte", "die Zahl steht in Zeile 2");
gleich(voll.gesperrt, false, "mit mindestens einer Auswahl ist der Knopf bedienbar");
gleich(voll.grund, "", "und er nennt keinen Grund -- er kann ja");
// 💣 Auch wenn KEINES der gewaehlten Objekte in der Ansicht steht (Filterwechsel), bleibt er offen:
// er raeumt die Auswahl ab, nicht die Zeilen.
gleich(knopfAufheben(3, []).gesperrt, false,
	"💣 er zaehlt die GANZE Auswahl, nicht die sichtbaren Objekte");
gleich(modul.garetienAuswahlAufhebenZustand, undefined,
	"🔴 die alte Fuss-Fassung ist ersatzlos gefallen -- zwei Erzeuger derselben Beschriftung "
	+ "liefen beim naechsten Umbau auseinander");

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
