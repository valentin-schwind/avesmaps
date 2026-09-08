"use strict";
/**
 * „KEIN ETIKETT" IST EIN EIGENER ZUSTAND -- und er darf nicht als „inoffiziell" ankommen.
 *
 * 🚩 DER BEFUND (Owner 08.09.2026, eine Stunde nach dem Kanon-Umbau): „hm warte mal, Dommel ist
 * nicht zugewiesen, aber es steht offiziell dran." Der Server hatte fuer Dommel richtig KEIN
 * Etikett abgeleitet -- seine einzige Quelle ist eine Publikation, und die machen seit dem
 * 08.09.2026 keinen Kanon mehr. Nur erreichte diese Auskunft den Browser nie: `resolveFeatureKanon`
 * faellt fuer ein Objekt MIT Verweisen auf die Vorgabe „offiziell" zurueck, und ein FEHLENDER
 * Abweichungseintrag heisst dort deshalb „offiziell", nicht „nichts". 113 Objekte betroffen.
 *
 * Die Nutzlast schickt seither `{kanon: ''}` fuer solche Objekte. Dieser Test haelt die zwei
 * Stellen fest, die daraus etwas Falsches machen koennten.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(wurzel, "js", "ui", "feature-source-markup.js"));

let bestanden = 0;
const pruefe = (bedingung, was) => {
    assert.ok(bedingung, was);
    bestanden++;
};

// ---- A. Der Badge-Bauer schweigt bei leerem Zustand -------------------------------------------
// ⚠️ Er kann das laengst -- `!kanon.kanon` faengt den leeren String. Die Zusicherung steht hier,
// weil der ganze Umbau darauf aufbaut: waere `''` ein sichtbarer Zustand, truege Dommel eine
// Pille ohne Wort darin.
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const L = { official: "Offiziell", unofficial: "Inoffiziell" };
pruefe(markup.featureKanonBadgeMarkup({ kanon: "" }, esc, L, {}) === "",
    "ein leerer Zustand ergibt gar kein Etikett");
pruefe(markup.featureKanonBadgeMarkup({ kanon: "offiziell" }, esc, L, {}).includes("fs-kanon--off"),
    "und die Gegenprobe: ein echter Zustand ergibt sehr wohl eines");

// ---- B. Die WIKI-ZEILE macht aus „nichts" kein „inoffiziell" ----------------------------------
// 💣 DIE EIGENTLICHE FALLE DIESES FIXES. `wikiOfficial: kanon ? kanon.kanon === "offiziell" : …`
// ist fuer `{kanon: ''}` WAHR im Test und liefert damit `false` -- also „inoffiziell". Die
// Wiki-Zeile haette Dommel ein „INOFFIZIELL │ Wiki-Artikel" angehaengt: eine Behauptung ueber
// einen Artikel, ueber den niemand etwas gesagt hat. Richtig ist `undefined` = „kein Stempel".
// 🔴 AUSGESCHNITTEN UND AUSGEFUEHRT, nicht gelesen: ein Regex ueber den Quelltext haette hier
// beide Fassungen durchgelassen -- sie unterscheiden sich nur im Wahrheitswert einer leeren
// Zeichenkette. (AGENTS.md: „ein Regex kennt keinen Geltungsbereich, also wird ein Bauer
// AUSGEFUEHRT, nicht gelesen.")
const popups = fs.readFileSync(path.join(wurzel, "js", "ui", "popups.js"), "utf8");
const zeile = popups.match(/wikiOfficial:\s*(.+?),\s*$/m);
pruefe(zeile !== null, "die Zeile `wikiOfficial:` steht in popups.js");
const ausdruck = zeile[1];

const werte = (kanon) => vm.runInNewContext("(" + ausdruck + ")", { kanon });
pruefe(werte({ kanon: "" }) === undefined,
    "leerer Zustand -> undefined, damit die Wiki-Zeile GAR KEINE Pille bekommt");
pruefe(werte(null) === undefined, "gar kein Kanon -> ebenfalls undefined");
pruefe(werte({ kanon: "offiziell" }) === true, "offiziell bleibt true");
pruefe(werte({ kanon: "inoffiziell" }) === false, "inoffiziell bleibt false");

// ---- C. Und die Zeile selbst zeigt dann nichts ------------------------------------------------
const ohneStempel = markup.buildSourceListMarkup("https://de.wiki-aventurica.de/wiki/Dommel", [], {
    escape: esc, kanonLabels: L, wikiLabel: "Wiki Aventurica", wikiOfficial: werte({ kanon: "" }),
});
pruefe(!ohneStempel.includes("fs-kanon"),
    "die Wiki-Zeile eines Objekts ohne Etikett traegt keine Pille");
pruefe(!/<dt>Kanon<\/dt>/.test(ohneStempel),
    "und in ihrer Tafel steht auch keine Kanon-Zeile");
// ⚠️ Das ⓘ bleibt trotzdem -- es traegt den Lizenzhinweis der Wiki-Texte, nicht den Kanon.
pruefe(ohneStempel.includes("fs-src-info"),
    "das Info-Zeichen bleibt: es haelt die Lizenz, nicht das Etikett");

console.log("kanon-ohne-etikett.test.js: " + bestanden + " Zusicherungen erfuellt");
