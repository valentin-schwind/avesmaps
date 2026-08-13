// Das Popup der gesetzten Markierung (sharePinPopupMarkup in js/ui/popups.js).
//
// Es ist das einzige Popup mit GENAU EINER Aktion, und daran haengen zwei Dinge, die beim naechsten
// Anfassen lautlos kippen:
//
//   1. 💣 Die Kachelform ist hier falsch. Gemessen am 13.08.2026: der 90-px-Knopf liess 105 der 195 px
//      des Bands leer und war fuer einen einzigen Knopf 86 px hoch. Die Klasse
//      `location-popup--single-action` macht daraus eine Zeile ueber die volle Breite (38 px). Faellt
//      die Klasse weg, ist die tote Flaeche zurueck -- und niemand misst sie nach.
//   2. 💣 Die Reparatur muss GESCHRUMPFT bleiben. `.location-popup__actions` und
//      `.location-popup__action-button` gehoeren ALLEN Popups der Karte; wer die Zeilenfassung dort
//      hineinschreibt, macht aus jeder Kachel im Haus eine Zeile. Deshalb prueft dieser Test
//      ausdruecklich, dass die Basisregeln ihre Kachelwerte behalten.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/share-pin-popup.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const js = ohneKommentare(read("js", "ui", "popups.js"));
const css = ohneKommentare(read("css", "features", "location-popups-markers.css"));

// ---- Der Knopf ---------------------------------------------------------------------------------
const bauer = js.slice(js.indexOf("function sharePinPopupMarkup"), js.indexOf("function sharePinPopupMarkup") + 1600);
assert.ok(bauer.includes("sharePinPopupMarkup"), "der Bauer steht in popups.js");
assert.ok(/img\/menu\/papierkorb\.webp/.test(bauer), "die Aktion traegt den Papierkorb");
assert.ok(fs.existsSync(path.join(ROOT, "img", "menu", "papierkorb.webp")), "und das Bild liegt im Repo");
// 💣 Kein Emoji IM Text: es sah je nach Geraet anders aus und reiste durch die i18n-Tabelle mit.
assert.ok(!/\u{1F5D1}/u.test(bauer), "kein Papierkorb-Emoji mehr in der Beschriftung");
assert.ok(!/\u{1F5D1}/u.test(read("js", "app", "i18n-en.js")), "auch nicht in der englischen Tabelle");
assert.ok(/tr\("popup\.removeMarker", "Markierung entfernen"\)/.test(bauer), "die Beschriftung ist reiner Text");

// ---- Die Zeilenfassung ist gesetzt UND hat eine Regel -------------------------------------------
assert.ok(/extraClassName: "location-popup--single-action"/.test(bauer),
	"das Popup markiert sich als Ein-Aktions-Popup");
assert.ok(/extraClassName = ""/.test(js), "locationPopupMarkup nimmt die Zusatzklasse entgegen");
assert.ok(/extraClassName \? " " \+ extraClassName : ""/.test(js), "und haengt sie an die Huelle");
const zeilenRegel = (css.match(/\.location-popup--single-action > \.location-popup__actions > \.location-popup__action-button \{([^}]*)\}/) || [])[1];
assert.ok(zeilenRegel !== undefined, "es gibt eine Regel fuer den Ein-Aktions-Knopf");
assert.ok(/flex-direction:\s*row/.test(zeilenRegel), "er steht als ZEILE, nicht als Kachel");
assert.ok(/flex:\s*1 1 auto/.test(zeilenRegel), "und fuellt die Breite (sonst bleibt die tote Flaeche)");
assert.ok(/min-height:\s*0/.test(zeilenRegel), "die Kachel-Mindesthoehe ist aufgehoben");

// ---- 💣 Und die Basisregeln bleiben Kachel ------------------------------------------------------
const basisKnopf = (css.match(/\n\.floating-location-popup \.location-popup__action-button,\s*\n\.avesmaps-infopanel \.location-popup__action-button \{([^}]*)\}/) || [])[1];
assert.ok(basisKnopf !== undefined, "die Kachel-Basisregel steht noch da");
assert.ok(/flex-direction:\s*column/.test(basisKnopf), "sie ist weiterhin hochkant -- die Reparatur ist geschrumpft geblieben");
const basisBand = (css.match(/\n\.location-popup__actions \{([^}]*)\}/) || [])[1];
assert.ok(basisBand !== undefined, "die Band-Basisregel steht noch da");
assert.ok(!/flex-direction/.test(basisBand), "und wurde nicht umgebaut");

// ---- Die Abstaende des Ein-Aktions-Popups sind Token --------------------------------------------
const bandRegel = (css.match(/\.location-popup--single-action > \.location-popup__actions \{([^}]*)\}/) || [])[1];
assert.ok(bandRegel !== undefined, "das Band hat eine eigene Abstandsregel");
assert.ok(/margin:\s*var\(--space-/.test(bandRegel), "und zwar mit Token, nicht mit einer Zahl");

console.log("share-pin-popup: alle Zusicherungen gehalten");
