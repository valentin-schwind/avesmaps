// Aufgabe 4 des Fragmente-Verbunds -- „Der Verbund auf der Stage".
// Brief: .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-4-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-stage.test.js
//
// Abschnitt 1 ist wortwoertlich der Test aus dem Brief (Schritt 1) -- er schneidet die beiden
// REINEN Funktionen aus dem Quelltext und fuehrt sie isoliert in einem `vm`-Kontext aus, weil sie
// keinen Modulzustand beruehren.
//
// Abschnitt 2 ist eine Ergaenzung dieser Sitzung: die Zustandsmenge (`garetienVerbundZusammenlegen`,
// `garetienVerbundAufloesen`, `garetienVerbundIstZusammen`, `garetienVerbundVergessen`) haengt an
// `zustand.stage` und `_garetienVerbundZusammen`, beides Modulzustand -- eine `schneide`-Extraktion
// wie in Abschnitt 1 kann sie nicht pruefen (sie braucht `zustand`, das ausserhalb der geschnittenen
// Funktion liegt). Geprueft wird deshalb ueber das ECHTE Modul, per `require`, genau wie
// js/review/__tests__/garetien-anzeige-menge.test.js es fuer die uebrige Stage tut. Der Brief nennt
// diese Funktionen ausdruecklich als Teil des Auftrags ("Liefert: ..."), und die Aufgabe beschreibt
// sich selbst als „die Zustandsmenge, aus der Aufgaben 5, 6, 8 und 9 spaeter lesen" -- ungeprueften
// Modulzustand auszuliefern waere das Gegenteil von test-first.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

// =================================================================================================
// 1. Die reinen Funktionen, isoliert aus dem Quelltext geschnitten (Brief, Schritt 1)
// =================================================================================================

const quelle = fs.readFileSync(
    path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");

function schneide(name) {
    const a = quelle.indexOf("function " + name);
    assert.ok(a > -1, name + " fehlt");
    return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
}

const kontext = {};
vm.createContext(kontext);
vm.runInContext(
    schneide("garetienVerbundSchluessel") + "\n"
    + schneide("garetienVerbundMitglieder") + "\n"
    + "this.schluessel = garetienVerbundSchluessel; this.mitglieder = garetienVerbundMitglieder;",
    kontext);

const o1 = { key: "a", name: "Silker Hain 1", ebene: "Waelder", typ: "Wald",
             verbund_stamm: "Silker Hain", verbund_n: 4 };
const o2 = { key: "b", name: "Silker Hain 2", ebene: "Waelder", typ: "Wald",
             verbund_stamm: "Silker Hain", verbund_n: 4 };
const fremd = { key: "c", name: "Weidicht", ebene: "Waelder", typ: "Wald" };

assert.strictEqual(kontext.schluessel(o1), "verbund:Waelder|Wald|Silker Hain");
checks++;
assert.strictEqual(kontext.schluessel(fremd), "", "ein Einzelobjekt hat keinen Verbundschluessel");
checks++;

// 💣 Der Schluessel traegt Ebene UND Typ -- ein Wald und ein Huegel gleichen Stammes sind zwei
// Verbuende, und ohne beide fielen sie zu einem zusammen.
const huegel = Object.assign({}, o1, { key: "d", ebene: "Berge", typ: "Huegel" });
assert.notStrictEqual(kontext.schluessel(huegel), kontext.schluessel(o1));
checks++;

const m = kontext.mitglieder("verbund:Waelder|Wald|Silker Hain", [o1, o2, fremd]);
assert.deepStrictEqual([...m].map((x) => x.key), ["a", "b"]);
checks++;

// ⚠️ Ergaenzung dieser Sitzung: `n < 2` ist kein Verbund, auch wenn der Stamm gesetzt ist (der
// Kommentar an `garetienVerbundMarkeMarkup` warnt sinngemaess vor genau diesem Fall -- ein
// zwischengespeicherter Lauf kann `verbund_stamm` fuehren, obwohl nach einer Entdopplung nur noch
// ein einziges Fragment uebrig ist).
const einzelMitStamm = { key: "e", verbund_stamm: "Silker Hain", verbund_n: 1,
                          ebene: "Waelder", typ: "Wald" };
assert.strictEqual(kontext.schluessel(einzelMitStamm), "",
    "verbund_n unter 2 ist kein Verbund, obwohl verbund_stamm gesetzt ist");
checks++;

// =================================================================================================
// 2. Die Zustandsmenge -- ueber das ECHTE Modul (Ergaenzung dieser Sitzung, siehe Kopf der Datei)
// =================================================================================================

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

const VERBUND = "verbund:Waelder|Wald|Silker Hain";

modul.avesmapsGaretienStageLeeren();

// ---- 2a. Anfangs ist kein Verbund zusammengelegt ------------------------------------------------
gleich(modul.garetienVerbundIstZusammen(VERBUND), false,
    "vor jedem Zusammenlegen gilt kein Verbund als zusammengelegt");

// ---- 2b. Zusammenlegen legt GENAU die Mitglieder auf die Stage, das fremde Objekt nicht ---------
const n = modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2, fremd]);
gleich(n, 2, "zwei Mitglieder -- 'c' gehoert nicht zum Verbund");
gleich(modul.avesmapsGaretienStageHat("a"), true, "erstes Mitglied liegt jetzt auf der Stage");
gleich(modul.avesmapsGaretienStageHat("b"), true, "zweites Mitglied liegt jetzt auf der Stage");
gleich(modul.avesmapsGaretienStageHat("c"), false,
    "das fremde Objekt (kein Mitglied des Verbunds) bleibt draussen");
gleich(modul.garetienVerbundIstZusammen(VERBUND), true,
    "nach dem Zusammenlegen gilt der Verbund als zusammengelegt");

// ---- 2c. Ein leerer Schluessel legt nichts zusammen und merkt nichts ----------------------------
modul.avesmapsGaretienStageLeeren();
gleich(modul.garetienVerbundZusammenlegen("", [o1, o2]), 0,
    "ein leerer Schluessel (z. B. von einem Einzelobjekt) legt nichts zusammen");
gleich(modul.avesmapsGaretienStageHat("a"), false, "…und legt entsprechend auch nichts auf die Stage");
gleich(modul.garetienVerbundIstZusammen(""), false,
    "…und der leere Schluessel selbst gilt auch nicht als zusammengelegter Verbund");

// ---- 2d. Aufloesen nimmt NUR die Merkung zurueck -- die Objekte bleiben auf der Stage ------------
modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2, fremd]);
gleich(modul.garetienVerbundAufloesen(VERBUND), true,
    "Aufloesen eines wirklich zusammengelegten Verbunds meldet true");
gleich(modul.garetienVerbundIstZusammen(VERBUND), false,
    "…und danach gilt der Verbund nicht mehr als zusammengelegt");
gleich(modul.avesmapsGaretienStageHat("a"), true,
    "die Objekte bleiben trotzdem auf der Stage -- 'Verbund aufloesen' nimmt nur die Merkung "
    + "zurueck, keine Rueckgaengig-Handlung der Stage");
gleich(modul.avesmapsGaretienStageHat("b"), true, "…beide Mitglieder");

// ---- 2e. Ein nie zusammengelegter Verbund meldet false beim Aufloesen ---------------------------
gleich(modul.garetienVerbundAufloesen("verbund:nie-zusammengelegt"), false,
    "Aufloesen eines Verbunds, der nie zusammengelegt wurde, meldet false");

// ---- 2f. garetienVerbundVergessen leert die GANZE Merkung, nicht nur einen Verbund --------------
modul.avesmapsGaretienStageLeeren();
modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2]);
const zweiterVerbund = "verbund:Berge|Huegel|Silker Hain";
modul.garetienVerbundZusammenlegen(zweiterVerbund, [huegel]);
gleich(modul.garetienVerbundIstZusammen(VERBUND), true, "erster Verbund steht vor dem Vergessen");
gleich(modul.garetienVerbundIstZusammen(zweiterVerbund), true,
    "zweiter Verbund steht ebenfalls vor dem Vergessen");
modul.garetienVerbundVergessen();
gleich(modul.garetienVerbundIstZusammen(VERBUND), false, "…und nach Vergessen keiner der beiden mehr");
gleich(modul.garetienVerbundIstZusammen(zweiterVerbund), false, "…auch der zweite nicht");

modul.avesmapsGaretienStageLeeren();

console.log(`garetien-verbund-stage: ${checks} Pruefungen bestanden.`);
