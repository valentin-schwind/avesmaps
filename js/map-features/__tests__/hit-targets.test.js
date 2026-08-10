// Treffer- und Antwortflaechen: was ein Finger anfassen kann, und wo genau EINE Flaeche antwortet
// statt zweier.
//
// Geprueft wird, was hier lautlos kippt: dass der Riegel fuer die schwebende Box an genau EINER
// der beiden Aufrufstellen haengt, dass Name und Punkt eines Ortes DASSELBE oeffnen, dass der
// Trefferradius nur einmal gerechnet wird -- und dass Flaechen niemals eine Zugabe bekommen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/hit-targets.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const markerEntry = withoutComments(read("js", "map-features", "map-features-location-marker-entry.js"));
const lookup = withoutComments(read("js", "map-features", "map-features-location-lookup.js"));

// ---- Die schwebende Box hat ZWEI Aufrufer, und nur einer wird still ------------------------------
//
// 🔴 Der Riegel gehoert AUSSCHLIESSLICH in marker-entry: dort ist die Box ein Doppel zum
// Infopanel -- gemessen auf 360x640 liegen 283 ihrer 334px dahinter. In location-lookup
// ("naechster Ort") ist dieselbe Box die EINZIGE Antwortflaeche; ein Riegel dort naehme dem
// Werkzeug seine Ausgabe.
assert.ok(/avesmapsIsPhoneViewport\s*\(\s*\)/.test(markerEntry),
	"marker-entry fragt avesmapsIsPhoneViewport, bevor es die schwebende Box oeffnet");
assert.ok(!/avesmapsIsPhoneViewport/.test(lookup),
	"location-lookup fragt NICHT -- dort ist die schwebende Box die einzige Antwortflaeche"
	+ " (\"naechster Ort\"), und ein Riegel naehme dem Werkzeug seine Ausgabe");
assert.ok(/floating:\s*true/.test(lookup),
	"und location-lookup oeffnet sie weiterhin");

// Die Entscheidung faellt EINMAL und wird dann benutzt -- nicht zweimal derselbe Ausdruck.
const bindPopupBlock = markerEntry.match(/markerEntry\.marker\.bindPopup\(([\s\S]*?)\n\t\);/);
assert.ok(bindPopupBlock, "der bindPopup-Aufruf ist auffindbar");
assert.ok(!/infopanelMode\s*\?\s*\{\s*floating/.test(bindPopupBlock[1]),
	"der bindPopup-Aufruf entscheidet nicht mehr selbst ueber die Box -- er liest das Ergebnis");

// ---- Name und Punkt oeffnen DASSELBE --------------------------------------------------------------
//
// Das ist die Zusicherung, die klickbare Ortsnamen ueberhaupt vertretbar macht. Bis 2026-08-10 war
// das Label bewusst inert, mit der Begruendung, Marker und Name waeren "zwei Treffer
// uebereinander". Das gilt fuer zwei ZIELE -- Punkt und Name eines Ortes sind aber EIN Ziel mit
// zwei Teilen, und der Name ist der breitere. Bedingung: beide muessen denselben Einspeiser rufen;
// ein zweiter Popup-Bauer im Label-Pfad liesse zwei Auskuenfte ueber denselben Ort auseinanderlaufen.
const nameLabels = withoutComments(read("js", "map-features", "map-features-location-name-labels.js"));
assert.ok(/interactive:\s*true/.test(nameLabels),
	"der Label-Marker ist interaktiv -- vorher stand hier `interactive: false`");
assert.ok(/avesmapsShowLocationInInfopanel\s*\(/.test(nameLabels),
	"und sein Klick ruft DENSELBEN Einspeiser wie der Marker (marker-entry.js, popupopen)");
assert.ok(!/buildLocationMarkerPopupHtml/.test(nameLabels),
	"der Label-Pfad baut KEIN eigenes Popup -- sonst gaebe es zwei Auskuenfte ueber einen Ort");

const labelCss = withoutComments(read("css", "features", "map-labels.css"));
// 💣 Nicht "kommt `pointer-events: none` vor" pruefen -- das taete es weiterhin und zu Recht: die
// Basisregel ganz oben stellt ALLE Label inert, und die Freigabe steht spaeter in der Datei. Eine
// solche Zusicherung koennte "inert" nicht von "inert, aber ueberschrieben" unterscheiden und
// waere rot, obwohl der Code stimmt. Geprueft wird deshalb die LETZTE Regel, die beides nennt.
const peRegeln = (labelCss.match(/[^}]*\.location-name-label[^{]*\{[^}]*pointer-events:\s*\w+[^}]*\}/g) || []);
assert.ok(peRegeln.length > 0, "es gibt Regeln, die pointer-events am Ortslabel setzen");
assert.ok(/pointer-events:\s*auto/.test(peRegeln[peRegeln.length - 1]),
	"die LETZTE davon gibt es frei (pointer-events: auto) -- eine fruehere Freigabe wuerde von der"
	+ " Basisregel oben wieder zugedeckt");
assert.ok(/\.location-name-label span/.test(peRegeln[peRegeln.length - 1])
	&& /\.location-name-label img/.test(peRegeln[peRegeln.length - 1]),
	"und sie nennt span UND img -- der sichtbare Text ist ein Canvas-gerastertes <img> mit <span>"
	+ " als Alt-Pfad; nur eines freizugeben laesst die Haelfte der Label inert");
assert.ok(/\.location-name-label\.is-colliding[\s\S]{0,200}?display:\s*none/.test(labelCss),
	"ein weggekollidiertes Label ist display:none und faengt deshalb keinen Klick"
	+ " -- mit opacity:0 gaebe es Geisterklicks auf unsichtbaren Namen");

console.log("hit-targets tests passed");
