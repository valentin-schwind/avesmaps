// Die Verschmelzung: EINE Markierung, EIN Weg ins Panel, und der alte Kasten ist wirklich weg.
//
// Ausfuehren: node js/map-features/__tests__/was-ist-hier-verdrahtung.test.js
//
// 💣 Ohne Kommentare geprueft -- die Prosa nennt genau die Woerter, nach denen gesucht wird.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
	.replace(/<!--[\s\S]*?-->/g, "");
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(ROOT, ...t), "utf8"));

const html = lies("index.html");
const routing = lies("js", "routing", "routing.js");
const popups = lies("js", "ui", "popups.js");

// Der neue Eintrag steht im Kartenmenue, der alte nicht mehr.
assert.ok(/data-context-action="what-is-here"/.test(html), "„Was ist hier?\" steht im Menue");
assert.ok(!/data-context-action="share-map-link"/.test(html), "der Routen-Link-Eintrag ist weg");
assert.ok(/data-context-action="share-pin"/.test(html), "„Stelle markieren und teilen\" bleibt");

// 🔴 Der Verteiler kennt den neuen Zweig -- und den alten nicht mehr.
assert.ok(/action === "what-is-here"/.test(routing), "der Verteiler bedient ihn");
assert.ok(!/action === "share-map-link"/.test(routing), "der alte Zweig ist weg");

// 💣 Der schwebende Zwei-Kachel-Kasten der Markierung ist ERSATZLOS gefallen. Bleibt er stehen,
// gibt es zwei Orte fuer dieselben Befehle -- und der eine altert unbemerkt.
assert.ok(!/function sharePinMenuMarkup/.test(popups), "sharePinMenuMarkup ist geloescht");
assert.ok(!/sharePinMenuMarkup/.test(lies("js", "map-features", "map-features-share-pin.js")),
	"und wird nirgends mehr gebunden");

// 💣 Beim Ziehen darf NICHT setSharePin gerufen werden: das wirft den Marker weg und baut einen
// neuen -- genau den, an dem Leaflet gerade seinen Drag abschliesst (TypeError in finishDrag).
const pin = lies("js", "map-features", "map-features-share-pin.js");
const dragendStart = pin.indexOf('marker.on("dragend"');
// An den naechsten Funktionsanfang gebunden statt an eine feste Zeichenzahl -- eine feste Laenge
// reicht sonst in `function setSharePin` hinein, dessen eigener Name die gesuchte Zeichenkette
// selbst enthaelt (falsch-positiver Treffer). Dieselbe Bindungstechnik wie in
// js/ui/__tests__/share-pin-popup.test.js (dort an "function bindSharePinDragging" verankert).
const dragend = pin.slice(dragendStart, pin.indexOf("\nfunction ", dragendStart));
assert.ok(!/setSharePin/.test(dragend), "dragend baut den Marker nicht neu");
assert.ok(/avesmapsShowWhatIsHere/.test(dragend), "dragend rechnet die Auskunft neu");

// 🔴 „Entfernen" schliesst das Panel mit. Das Infopanel wird nie leer gezeigt.
assert.ok(/avesmapsShowInfopanel\(""\)|avesmapsShowInfopanel\(''\)/.test(pin),
	"clearSharePin leert das Panel");

// 🔴 Ein geteilter ?pin=-Link bringt die Auskunft mit.
assert.ok(/avesmapsShowWhatIsHere/.test(lies("js", "map-features", "map-features-layer-state.js")),
	"der Deep-Link oeffnet das Panel");

console.log("was-ist-hier-verdrahtung: alles gruen");
