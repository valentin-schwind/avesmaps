// Wie viele Zeilen die Liste hoechstens zeigt -- Owner 31.08.2026: "die 8000 objekte sind auf
// manchen pcs ein problem. kannst du oben einen dropdown button für alle verfügbar machen und ein
// dropdown mit 1000, 2000, 4000 und max (8213) anzeigen".
//
// 🔴 DREI ENTSCHEIDUNGEN STECKEN DARIN, und alle drei sind hier festgenagelt:
//   1. Die VORGABE ist die kleinste Stufe. Die Meldung lautete "auf manchen pcs ein problem" --
//      ein neuer Benutzer soll nicht erst hineinlaufen, um den Regler zu finden.
//   2. 🔴 KORRIGIERT 31.08.2026 (Owner: "warum steht da 2x 1000 btw. die dropdown reicht"):
//      die Kachel trug unter der Auswahl eine zweite Zeile mit derselben Zahl. Sie ist weg. Die
//      Gesamtzahl geht dabei nicht verloren -- sie steht in der Option "alle (8213)" und in der
//      Bilanzzeile ueber den Reitern; verborgen wird also weiterhin nichts.
//   3. "alle" schickt GAR KEIN `anzahl` mit -- dann gilt der Server-Deckel. Eine im Browser
//      erfundene Obergrenze waere eine zweite Wahrheit darueber, wie viel es hoechstens gibt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-zeilengrenze.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const quelleRoh = lies("js", "review", "review-garetien-importer.js");
// 🩤 Kommentare weg, bevor am Quelltext geprueft wird -- eine Zusicherung, die an der ERKLAERUNG
// anschlaegt, ist gruen und prueft nichts.
const quelleOhneKommentare = quelleRoh
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	GARETIEN_ZEILEN_STUFEN,
	garetienZeilenGrenzeLesen,
	garetienZeilenGrenzeMerken,
	garetienZeilenOptionenMarkup,
} = mod;

// =================================================================================================
// 1. Die vier Stufen -- genau die des Auftrags
// =================================================================================================
assert.deepStrictEqual(GARETIEN_ZEILEN_STUFEN, [1000, 2000, 4000, null],
	"die vier Stufen des Auftrags: 1000, 2000, 4000 und alle");
checks++;

// =================================================================================================
// 2. 🔴 DIE VORGABE IST DIE KLEINSTE STUFE -- und jeder Zweifel faellt dorthin zurueck
// =================================================================================================
// 💣 Ein kaputter Wert darf NIE "alle" bedeuten: dann haengt genau der Rechner, dem die
// Einstellung helfen soll.
const speicherAus = null;
gleich(garetienZeilenGrenzeLesen(speicherAus), 1000, "ohne Speicher gilt die kleinste Stufe");

const macheSpeicher = (wert) => ({
	getItem: () => wert,
	setItem() {},
});
gleich(garetienZeilenGrenzeLesen(macheSpeicher(null)), 1000, "ohne gespeicherten Wert ebenso");
gleich(garetienZeilenGrenzeLesen(macheSpeicher("quatsch")), 1000, "ein unlesbarer Wert faellt zurueck");
gleich(garetienZeilenGrenzeLesen(macheSpeicher("999999")), 1000,
	"und eine Zahl, die keine Stufe ist, ebenso -- sonst schriebe sich ein Tippfehler als Deckel fest");
gleich(garetienZeilenGrenzeLesen(macheSpeicher("2000")), 2000, "eine echte Stufe kommt durch");
gleich(garetienZeilenGrenzeLesen(macheSpeicher("alle")), null, "und `alle` heisst null");

// ⚠️ Ein Speicher, der beim Lesen WIRFT (privates Fenster, gesperrte Seitendaten), darf das Fenster
// nicht aufhalten.
gleich(garetienZeilenGrenzeLesen({ getItem() { throw new Error("gesperrt"); } }), 1000,
	"ein werfender Speicher faellt auf die Vorgabe zurueck, statt das Fenster mitzureissen");
assert.doesNotThrow(() => garetienZeilenGrenzeMerken({ setItem() { throw new Error("voll"); } }, 2000),
	"und ein volles Kontingent beim Schreiben bricht nichts");
checks++;

// --- Was gemerkt wird, kommt zurueck.
let gemerkt = null;
const speicher = { getItem: () => gemerkt, setItem: (_k, v) => { gemerkt = v; } };
garetienZeilenGrenzeMerken(speicher, 4000);
gleich(gemerkt, "4000", "eine Stufe wird als Zahl gemerkt");
gleich(garetienZeilenGrenzeLesen(speicher), 4000, "und wieder gelesen");
garetienZeilenGrenzeMerken(speicher, null);
gleich(gemerkt, "alle", "`alle` wird als Wort gemerkt, nicht als Zahl");
gleich(garetienZeilenGrenzeLesen(speicher), null, "und kommt als null zurueck");

// =================================================================================================
// 3. 🔴 DIE ZAHL STEHT GENAU EINMAL IN DER KACHEL
// =================================================================================================
// Owner 31.08.2026: "warum steht da 2x 1000 btw. die dropdown reicht". Die Kachel hatte die
// `t2`-Zustandszeile ihrer zwei Nachbarn abgeschrieben -- bei denen sagt sie etwas, das sonst
// nirgends steht ("Lauf 30.08., 23:18", "18 von 18"), hier wiederholte sie die Auswahl einen
// Zentimeter unter der Auswahl.
const kachelAb = quelleRoh.slice(quelleRoh.indexOf("gi-tile--wahl"));
wahr(!/garetien-zeilen-state/.test(kachelAb.slice(0, kachelAb.indexOf("</label>"))),
	"die Kachel traegt keine zweite Zeile mit derselben Zahl mehr");
// 💣 UND DER SETZER MUSS MITGEHEN. Ein `getElementById` auf ein Element, das es nicht mehr
// gibt, ist stumm -- die Funktion bliebe stehen, und niemand merkte, dass sie nichts tut.
wahr(!/garetien-zeilen-state/.test(quelleOhneKommentare),
	"und der Setzer dazu ist mitgegangen, statt ins Leere zu greifen");
// ⚠️ Die Gesamtzahl bleibt sichtbar -- in der Option "alle (N)". Das ist die Zusicherung, die
// die alte Regel "immer beide Zahlen" ersetzt.
wahr(/alle \(8213\)/.test(garetienZeilenOptionenMarkup(1000, 8213)),
	"die Gesamtzahl steht weiterhin in der Auswahl selbst");

// =================================================================================================
// 4. Die Optionen -- „alle" traegt die ECHTE Zahl, keine abgeschriebene 8213
// =================================================================================================
const optionen = garetienZeilenOptionenMarkup(2000, 8213);
wahr(/<option value="1000">/.test(optionen), "1000 steht drin");
wahr(/<option value="2000" selected>/.test(optionen), "die gewaehlte Stufe ist vorausgewaehlt");
wahr(/<option value="alle">alle \(8213\)</.test(optionen),
	"und `alle` nennt die Gesamtzahl DES LAUFS: " + optionen);
// 💣 Die 8213 ist nirgends abgeschrieben -- sie gehoert dem Lauf und aendert sich mit jedem
// Rechnen. Der Zeuge: eine andere Gesamtzahl ergibt einen anderen Text.
wahr(/alle \(42\)</.test(garetienZeilenOptionenMarkup(1000, 42)),
	"eine andere Gesamtzahl schlaegt durch -- sonst stuende irgendwo eine feste 8213");
// 🪤 KOMMENTARE VORHER WEG. Beim ersten Bau las diese Zeile die ROHE Datei -- und schlug an den
// drei ERKLAERUNGEN an, die die 8213 als Beispiel nennen („1000 von 8213"). Ein Test, der an der
// Warnung anschlaegt, die vor dem Muster warnt, laesst den naechsten Leser den Kommentar loeschen.
wahr(!/8213/.test(lies("js", "review", "review-garetien-importer.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")),
	"und im ausgefuehrten CODE steht keine feste 8213 -- die Zahl gehoert dem Lauf");

// =================================================================================================
// 5. 🔴 „alle" SCHICKT KEIN `anzahl` MIT
// =================================================================================================
// Gemessen am Quelltext, weil der Rumpf in einem Netzaufruf entsteht.
// ⚠️ Kommentare vorher weg, sonst schlaegt der Test an der Erklaerung an.
const quelle = lies("js", "review", "review-garetien-importer.js")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
wahr(/if \(zustand\.zeilenGrenze !== null\) \{\s*rumpf\.anzahl = zustand\.zeilenGrenze;/.test(quelle),
	"der Deckel reist NUR mit, wenn einer gesetzt ist -- bei `alle` gilt der Server-Deckel");

// 💣 UND DIE KACHEL WIRD MIT DEN ANDEREN AKTUALISIERT. Ohne diese Zeile stuende die alte Zahl in
// der Beschriftung, waehrend die Liste schon die neue zeigt -- dieselbe Luecke (reine Funktion
// geprueft, Verdrahtung nicht), die an diesem Tag mehrfach aufgetreten ist.
wahr(/function garetienMenuebandKachelnAktualisieren\(\)[\s\S]{0,200}garetienZeilenKachelAktualisieren\(\);/
	.test(quelle), "die Zeilen-Kachel wird mit den zwei Nachbarn aktualisiert");

// 🔴 UND SIE TRAEGT KEINEN ADMIN-RIEGEL (Owner: „für alle verfügbar"). Die zwei Nachbarkacheln
// fragen `garetienDarfAdminHandlungJetzt`; diese darf es nicht -- sie holt nichts von aussen und
// rechnet nichts neu.
const kachel = quelle.slice(quelle.indexOf("function garetienZeilenKachelAktualisieren"));
wahr(!/garetienDarfAdminHandlungJetzt/.test(kachel.slice(0, kachel.indexOf("\n\t}"))),
	"die Zeilen-Kachel fragt NICHT nach Admin-Rechten");

console.log(`garetien-zeilengrenze: ${checks} Pruefungen bestanden.`);
