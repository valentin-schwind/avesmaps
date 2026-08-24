const assert = require("assert");
const fs = require("fs");
const path = require("path");

// 🔴 Die Namensfarbe kommt aus der Darstellungstafel, ihre VORGABE weiter aus map-labels.css
// (Entwurf §8). Eine Farbe je ART, nicht je Zoomstufe.
//
// 💣 Und der Typ-Zwischenspeicher muss sich leeren lassen -- sonst wirkt eine geaenderte Tafel erst
// nach einem Neuladen, und das sieht aus wie „Speichern tut nichts".
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-namensfarbe.test.js

const quelle = fs.readFileSync(path.join(__dirname, "../map-features-labels.js"), "utf8");
// 💣 In dieser Datei erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im Kommentar
// ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt.
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

// ---- A. getMapLabelTypeStyle fragt die Tafel ---------------------------------------------------
const von = ohneKommentare.indexOf("function getMapLabelTypeStyle(");
const bis = ohneKommentare.indexOf("\n}", von);
const rumpf = ohneKommentare.slice(von, bis);
assert.ok(von >= 0, "getMapLabelTypeStyle steht in der Datei");
assert.ok(/avesmapsEcosystemDisplayFarbe/.test(rumpf), "sie reicht den CSS-Ton durch die Tafel");
// Die Sonde bleibt: sie liest die Vorgabe aus dem ECHTEN Stylesheet.
assert.ok(/getComputedStyle\(span\)/.test(rumpf), "die CSS-Sonde bleibt die Vorgabequelle");
// ⚠️ Und der Rueckfall bleibt stehen -- ohne geladenes Modul zeichnet die Karte wie bisher.
assert.ok(/typeof avesmapsEcosystemDisplayFarbe === "function"/.test(rumpf),
	"ohne das Modul gilt weiter der CSS-Ton");

// ---- B. Ein Leerer fuer den Typ-Zwischenspeicher existiert -------------------------------------
assert.ok(/function\s+avesmapsLeereLabelTypStil/.test(ohneKommentare),
	"es gibt einen Leerer fuer _mapLabelTypeStyleCache");
const vonLeer = ohneKommentare.indexOf("function avesmapsLeereLabelTypStil");
const bisLeer = ohneKommentare.indexOf("\n}", vonLeer);
assert.ok(/_mapLabelTypeStyleCache/.test(ohneKommentare.slice(vonLeer, bisLeer)),
	"und er fasst wirklich den Typ-Zwischenspeicher an");

// ---- C. 🪤 KEIN zweiter Leerer fuer den Bild-Zwischenspeicher ----------------------------------
// Sein Schluessel enthaelt typeStyle.color, ein neuer Ton ergibt also von selbst einen neuen
// Schluessel. Wer hier einen zweiten Leerer ergaenzt, raeumt jedes Labelbild der Karte fuer nichts
// weg. Diese Zusicherung haelt das fest, damit es niemand „vervollstaendigt".
assert.ok(/cacheKey = `\$\{displayText\}\|\$\{font\}\|\$\{typeStyle\.color\}/.test(ohneKommentare),
	"der Bildschluessel enthaelt die Farbe und heilt sich damit selbst");

console.log("ecosystem-display-namensfarbe: alle Zusicherungen gruen");
