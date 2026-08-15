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

// Der neue Eintrag steht im Kartenmenue, der alte (share-map-link) nicht mehr.
assert.ok(/data-context-action="what-is-here"/.test(html), "„Was ist hier?\" steht im Menue");
assert.ok(!/data-context-action="share-map-link"/.test(html), "der Routen-Link-Eintrag ist weg");

// 🔴 Owner-Entscheid 15.08.2026: „Stelle markieren und teilen hat durch 'Was ist hier?' keine
// richtige Funktion und kann weg" -- kehrt den frueheren Stand um (bis Fix-Runde 1 hiess es noch,
// der Eintrag bleibe als Schnellweg OHNE Panel). Menue-Eintrag UND Verteiler-Zweig sind jetzt
// ersatzlos geloescht, nicht bloss versteckt.
assert.ok(!/data-context-action="share-pin"/.test(html), "der Menue-Eintrag ist geloescht");
assert.ok(!/action === "share-pin"/.test(routing), "und sein Verteiler-Zweig mit ihm");
assert.ok(!/"ctxmenu\.sharePin"/.test(lies("js", "app", "i18n-en.js")), "auch seine i18n-Zeile");
assert.ok(!/share-pin/.test(lies("css", "components", "map-context-menu-icons.css")),
	"und sein Icon (federundpapier.webp) aus allen Selektorlisten der Menue-CSS");

// 🔴 Der Verteiler kennt den neuen Zweig -- und den fuer die Route mitgeteilten alten nicht mehr.
assert.ok(/action === "what-is-here"/.test(routing), "der Verteiler bedient ihn");
assert.ok(!/action === "share-map-link"/.test(routing), "der alte Zweig ist weg");

const whatIsHereZweigStart = routing.indexOf('action === "what-is-here"');
assert.ok(whatIsHereZweigStart > 0, "der what-is-here-Zweig steht da");
const whatIsHereZweig = routing.slice(whatIsHereZweigStart, routing.indexOf('action === "report-location"', whatIsHereZweigStart));
assert.ok(/avesmapsShowWhatIsHere/.test(whatIsHereZweig), "„Was ist hier?\" oeffnet das Panel weiterhin");
assert.ok(/setSharePin\(contextMenuLatLng\)/.test(whatIsHereZweig), "und setzt weiterhin die Markierung");

// 🔴 Fix-Runde 4: „Link teilen" im Panel-Aktionsband ist seit dem Wegfall der EINZIGE Weg, den
// ?pin=-Link zu kopieren -- copySharePinLinkWithFeedback bleibt dafuer.
const shareWhatIsHereZweigStart = routing.indexOf('action === "share-what-is-here"');
assert.ok(shareWhatIsHereZweigStart > 0, "die Kachel „Link teilen\" hat weiterhin ihren Zweig");
const shareWhatIsHereZweig = routing.slice(shareWhatIsHereZweigStart, routing.indexOf("\n\t}", shareWhatIsHereZweigStart));
assert.ok(/copySharePinLinkWithFeedback/.test(shareWhatIsHereZweig), "und ruft weiterhin copySharePinLinkWithFeedback");

// 🔴 Fix-Runde 1, Befund 1: die Option ist ganz aus der Signatur gefallen, nicht bloss ungenutzt --
// ein Name, der ein Popup verspricht, das es nicht mehr gibt, wird sonst vom naechsten Leser wieder
// mit Bedeutung gefuellt.
assert.ok(!/openPopup/.test(lies("js", "map-features", "map-features-share-pin.js")),
	"openPopup ist komplett aus setSharePin gefallen");

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

// 🔴 Fix-Runde 1, Befund 2: focusMapOnActiveTargets (map-features.js) rief sharePinMarker.openPopup()
// auf einem Marker ohne gebundenes Popup -- stiller No-op, uebersehen weil nur map-features-share-pin.js
// durchsucht wurde. Jeder Aufrufer dieser Funktion will nur die Ansicht einpassen, keiner die Auskunft
// oeffnen (sonst raesse Befund 1 durch die Hintertuer wieder herein, ueber „Stelle markieren und
// teilen" -> focusMapOnActiveTargets()).
assert.ok(!/sharePinMarker\.openPopup/.test(lies("js", "map-features", "map-features.js")),
	"focusMapOnActiveTargets oeffnet kein Popup mehr");

// 💣 Fix-Runde 1, Befund 3: mit dem Markup faellt auch sein Stylesheet -- ein geloeschtes Bauteil
// behaelt nicht seine toten Regeln. .share-pin-visual (das Fahnen-Symbol des Markers) ist ein
// ANDERES Bauteil und bleibt.
const markerCss = lies("css", "features", "location-popups-markers.css");
assert.ok(!/\.share-pin-menu/.test(markerCss), "die .share-pin-menu-Regeln sind mit dem Markup gefallen");
assert.ok(/\.share-pin-visual/.test(markerCss), "das Marker-Symbol .share-pin-visual bleibt");

// 🔴 Letzter Handgriff: „Was ist hier?" bekommt sein Icon (wegweiser.webp) -- und diese Zusicherung
// haelt kuenftig JEDEN Besucher-Eintrag des Kartenmenues gegen die Icon-CSS, statt nur diesen einen
// nachzutragen. Faellt so kuenftig auf, wenn ein neuer Eintrag ohne Bild dazukommt, statt dass es
// irgendwann im Menue auffaellt. Ausschliesslich die BESUCHER-Eintraege, direkte Kinder von
// #map-context-menu -- die Editor-Gruppe (data-context-action="add-here" und ihr Untermenue) hat ein
// eigenes Zeichensystem (docs/editor-kennzeichnung-mockup.html) und gehoert hier nicht dazu.
const menuBlock = html.match(/<div id="map-context-menu"[\s\S]*?(?=<div id="region-context-menu")/);
assert.ok(menuBlock, "index.html traegt das Kartenmenue");
const editorGroupStart = menuBlock[0].indexOf('class="map-context-menu__group map-context-menu__group--editor"');
assert.ok(editorGroupStart > -1, "die Editor-Gruppe steht im Menue");
const editorGroupMatch = menuBlock[0].slice(editorGroupStart).match(/[\s\S]*?<\/div>\s*<\/div>/);
assert.ok(editorGroupMatch, "die Editor-Gruppe laesst sich abgrenzen (dieselbe Technik wie in "
	+ "js/app/__tests__/map-context-menu-editor-group.test.js)");
const ohneEditorGruppe = menuBlock[0].slice(0, editorGroupStart)
	+ menuBlock[0].slice(editorGroupStart + editorGroupMatch[0].length);
const besucherAktionen = [...ohneEditorGruppe.matchAll(/data-context-action="([a-z-]+)"/g)].map((m) => m[1]);
assert.ok(besucherAktionen.length >= 7, "mindestens die sieben bekannten Besucher-Eintraege stehen da");

const menuIconsCss = lies("css", "components", "map-context-menu-icons.css");
besucherAktionen.forEach((aktion) => {
	const eigeneRegel = new RegExp(
		'\\.map-context-menu__item\\[data-context-action="' + aktion + '"\\]::before\\s*\\{[^}]*background-image:\\s*url\\('
	);
	assert.ok(eigeneRegel.test(menuIconsCss), '„' + aktion + '" hat eine eigene Icon-Regel in map-context-menu-icons.css');
});
assert.ok(/data-context-action="what-is-here"/.test(menuIconsCss) && /wegweiser\.webp/.test(menuIconsCss),
	'„Was ist hier?" traegt konkret den Wegweiser');

console.log("was-ist-hier-verdrahtung: alles gruen");
