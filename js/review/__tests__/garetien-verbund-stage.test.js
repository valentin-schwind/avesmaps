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

// 🔴 AUFGABE 6 (14.09.2026): Zusammenlegen LEGT NICHT MEHR AUF -- es markiert die Eintraege, die
// schon auf der Stage liegen, und verlangt die Form Flaeche oder Weg. Die Fixtures tragen dafuer
// `ziel`; die ausfuehrliche Pruefung der neuen Regel steht in garetien-verbund-stage-eintrag.test.js.
const f1 = Object.assign({}, o1, { ziel: "region", subtyp: "wald" });
const f2 = Object.assign({}, o2, { ziel: "region", subtyp: "wald" });

// ---- 2b. Zusammenlegen markiert GENAU die Mitglieder auf der Stage, das fremde Objekt nicht -----
modul.avesmapsGaretienStageHinzufuegen([f1, f2]);
const n = modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2, fremd]);
gleich(n, 2, "zwei Mitglieder auf der Stage -- 'c' gehoert nicht zum Verbund");
gleich(modul.avesmapsGaretienStageHat("c"), false,
    "das fremde Objekt (kein Mitglied des Verbunds) bleibt draussen");
gleich(modul.garetienVerbundIstZusammen(VERBUND), true,
    "nach dem Zusammenlegen gilt der Verbund als zusammengelegt");
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienStageHinzufuegen([f1]);
gleich(modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2]), 0,
    "💣 liegt nur EIN Mitglied auf der Stage, wird nichts zusammengelegt -- und nichts aufgelegt");
gleich(modul.avesmapsGaretienStageHat("b"), false, "das zweite Mitglied bleibt, wo es war");

// ---- 2c. Ein leerer Schluessel legt nichts zusammen und merkt nichts ----------------------------
modul.avesmapsGaretienStageLeeren();
gleich(modul.garetienVerbundZusammenlegen("", [o1, o2]), 0,
    "ein leerer Schluessel (z. B. von einem Einzelobjekt) legt nichts zusammen");
gleich(modul.avesmapsGaretienStageHat("a"), false, "…und legt entsprechend auch nichts auf die Stage");
gleich(modul.garetienVerbundIstZusammen(""), false,
    "…und der leere Schluessel selbst gilt auch nicht als zusammengelegter Verbund");

// ---- 2d. Aufloesen nimmt NUR die Entscheidung zurueck -- die Objekte bleiben auf der Stage -------
modul.avesmapsGaretienStageHinzufuegen([f1, f2]);
modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2, fremd]);
gleich(modul.garetienVerbundAufloesen(VERBUND), undefined,
    "Aufloesen gibt seit Aufgabe 6 nichts mehr zurueck (void)");
gleich(modul.garetienVerbundIstZusammen(VERBUND), false,
    "…und danach gilt der Verbund nicht mehr als zusammengelegt");
gleich(modul.avesmapsGaretienStageHat("a"), true,
    "die Objekte bleiben trotzdem auf der Stage -- 'Verbund aufloesen' nimmt nur die Merkung "
    + "zurueck, keine Rueckgaengig-Handlung der Stage");
gleich(modul.avesmapsGaretienStageHat("b"), true, "…beide Mitglieder");

// ---- 2e. Ein nie zusammengelegter Verbund laesst sich gefahrlos aufloesen ------------------------
gleich(modul.garetienVerbundAufloesen("verbund:nie-zusammengelegt"), undefined,
    "Aufloesen eines Verbunds, der nie zusammengelegt wurde, wirft nicht");

// ---- 2f. garetienVerbundVergessen leert die GANZE Merkung, nicht nur einen Verbund --------------
modul.avesmapsGaretienStageLeeren();
const zweiterVerbund = "verbund:Berge|Huegel|Silker Hain";
const h1 = Object.assign({}, huegel, { ziel: "region", subtyp: "huegel" });
const h2 = Object.assign({}, h1, { key: "d2" });
modul.avesmapsGaretienStageHinzufuegen([f1, f2, h1, h2]);
modul.garetienVerbundZusammenlegen(VERBUND, []);
modul.garetienVerbundZusammenlegen(zweiterVerbund, []);
gleich(modul.garetienVerbundIstZusammen(VERBUND), true, "erster Verbund steht vor dem Vergessen");
gleich(modul.garetienVerbundIstZusammen(zweiterVerbund), true,
    "zweiter Verbund steht ebenfalls vor dem Vergessen");
modul.garetienVerbundVergessen();
gleich(modul.garetienVerbundIstZusammen(VERBUND), false, "…und nach Vergessen keiner der beiden mehr");
gleich(modul.garetienVerbundIstZusammen(zweiterVerbund), false, "…auch der zweite nicht");

// ---- 2g. Fixrunde 1 (Pruefbefund): der Schreibweg ist avesmapsGaretienStageHinzufuegen, -------
//         nicht ein eigenes zustand.stage.set(...) -- ein Mitglied mit leerem Schluessel bleibt
//         deshalb draussen.
//
// 🔴 Vor der Reparatur schrieb garetienVerbundZusammenlegen mit
// `mitglieder.forEach(function (o) { zustand.stage.set(String(o.key), o); }); direkt auf die
// Stage -- AN avesmapsGaretienStageHinzufuegen VORBEI. Deren Rumpf traegt die Hausregel als
// 🔴-Kommentar ("EIN GEWOEHNLICHER WEG IN DIE ANZEIGE HEBT DIE 'nur ihre'-MARKE AUF"), und "Verbund
// auf die Stage" IST so ein Weg -- keine Ausnahme davon. Der eigene Schreibweg liess ausserdem die
// Leerschluessel-Wache aus (`o.key === undefined || null || ""`), die avesmapsGaretienStageHinzufuegen
// traegt. Zwei Erzeuger fuer "kommt auf die Stage" sind genau die Klasse Fehler, die AGENTS.md
// benennt: "eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel".
//
// ⚠️ Geprueft wird hier die LEERSCHLUESSEL-WACHE, nicht die "nur ihre"-Marke selbst: `zustand.nurIhre`
// ist von aussen nur ueber avesmapsGaretienAufDerKarte erreichbar, und die verkettet zusaetzlich
// garetienGewaehltStempeln/garetienEndkreuzungStempeln/garetienVorschauLabelStempeln sowie
// zustand.detailKey -- ein Umweg durch drei fremde Stempel-Funktionen fuer eine Zusicherung, die
// hier nicht ihr Ziel ist (Verrenkung). Die Leerschluessel-Wache ist direkt messbar, gehoert
// zum selben Schreibweg und zeigt denselben Befund: ein Aufruf, der an
// avesmapsGaretienStageHinzufuegen vorbeigeht, gewaehrt der Stage etwas, das die Tuer verweigert.
// 🔴 Aufgabe 6: die Rueckgabe zaehlt jetzt Stage-EINTRAEGE -- ein Mitglied mit leerem Schluessel
// erreicht die Stage nie (Wache in avesmapsGaretienStageHinzufuegen), also bleibt nur eins, und
// eins ist kein Verbund.
modul.avesmapsGaretienStageLeeren();
const leererSchluessel = Object.assign({}, f1, { key: "" });
modul.avesmapsGaretienStageHinzufuegen([leererSchluessel, f2]);
gleich(modul.avesmapsGaretienStageHat(""), false,
    "ein Mitglied mit leerem Schluessel landet NICHT auf der Stage");
gleich(modul.garetienVerbundZusammenlegen(VERBUND, [leererSchluessel, f2]), 0,
    "und mit dem einen gueltigen Mitglied allein ist nichts zusammenzulegen");

modul.avesmapsGaretienStageLeeren();

console.log(`garetien-verbund-stage: ${checks} Pruefungen bestanden.`);
