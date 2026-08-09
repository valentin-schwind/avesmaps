// Der Knopfbund unten rechts an der Karte: der Verlaufsknopf "Neuigkeiten" + "Hinweise".
//
// Geprueft wird, was hier NICHT selbsterklaerend ist und beim naechsten Anfassen lautlos kippt: die
// Reihenfolge der beiden im Markup, die eine Zahl, aus der sich der Zoom seinen Abstand rechnet,
// und dass der zweite Oeffner am Fenster wirklich verdrahtet ist.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/map-corner-actions.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const indexHtml = read("index.html");
const infopanelCss = read("css", "features", "infopanel.css");
const legalCss = read("css", "components", "legal-dialog.css");
const dialogJs = read("js", "app", "changelog-dialog.js");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der
 *  nichts haelt. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ---- Markup: EIN Bund, und die Reihenfolge darin ist die Anzeige ---------------------------------
//
// 💣 Faengt: die beiden werden vertauscht. Die DOM-Reihenfolge ist hier keine Formsache -- sie
// bestimmt in der Zeile, wer links steht, und im gestapelten Fall, wer oben steht. Der
// Hinweise-Knopf gehoert an den Rand (unten/rechts), der Verlaufsknopf davor. Ein Tausch sieht im
// Quelltext harmlos aus.
const bund = indexHtml.match(/<div id="map-corner-actions">([\s\S]*?)\r?\n\t\t<\/div>/);
assert.ok(bund, "index.html traegt den Bund #map-corner-actions");
const newsAt = bund[1].indexOf('id="news-button"');
const legalAt = bund[1].indexOf('id="legal-button"');
assert.ok(newsAt > -1, "der Verlaufsknopf steht im Bund");
assert.ok(legalAt > -1, "der Hinweise-Knopf steht im Bund");
assert.ok(newsAt < legalAt, "und der Verlaufsknopf VOR ihm -- links in der Zeile, oben im Stapel");

// 💣 Faengt: der Verlaufsknopf wird zu einem <a href>. Sein Ziel liegt auf DIESER Seite; ein Link
// verliesse die Karte mitsamt der geplanten Route. (Beim Hinweise-Knopf ist es genau umgekehrt --
// das haelt js/app/__tests__/impressum-page.test.js fest.)
const newsTag = indexHtml.match(/<button type="button" id="news-button"[^>]*>/);
assert.ok(newsTag, "der Verlaufsknopf ist ein <button>, kein <a>");
assert.ok(/aria-controls="changelog-dialog"/.test(newsTag[0]), "und benennt das Fenster, das er oeffnet");
assert.ok(/data-i18n="legal\.news"/.test(newsTag[0]), "und traegt seinen i18n-Schluessel");
assert.ok(/"legal\.news":/.test(read("js", "app", "i18n-en.js")), "den es auf Englisch auch gibt");

// ---- Das Positionieren gehoert dem Bund, nicht den Knoepfen --------------------------------------
//
// 💣 Faengt: jemand gibt einem der beiden wieder eigene Koordinaten. Dann wandert nur einer, wenn
// die Infobox aufgeht -- und der andere bleibt unter dem Panel liegen.
const knopfRegel = withoutComments(legalCss).match(/#legal-button,\s*\r?\n#news-button \{([\s\S]*?)\r?\n\}/);
assert.ok(knopfRegel, "beide Knoepfe teilen sich EINE Aussehen-Regel");
["position:", "right:", "bottom:", "z-index:"].forEach((prop) => {
	assert.ok(
		!knopfRegel[1].includes(prop),
		`die Knopf-Regel setzt kein ${prop} -- das gehoert #map-corner-actions`
	);
});

// ---- EINE Zahl fuer Stapelhoehe und Zoom-Abstand --------------------------------------------------
//
// 💣 Faengt den Rueckfall auf `bottom: 52px`. Die 52 war eine stille Kopie der Knopfhoehe: sie sieht
// nie falsch aus, aber eine zweite Knopfreihe laeuft dem Zoom in den Ruecken.
const cssOhneKommentar = withoutComments(infopanelCss);
const zoomRegel = cssOhneKommentar.match(/\.avesmaps-infopanel-mode \.leaflet-control-zoom \{([\s\S]*?)\r?\n\}/);
assert.ok(zoomRegel, "der Zoom wird in infopanel.css platziert");
assert.ok(
	/bottom:\s*calc\(12px \+ var\(--avesmaps-corner-stack\)\)/.test(zoomRegel[1]),
	"und rechnet seinen Abstand aus --avesmaps-corner-stack, statt eine Zahl zu kennen"
);

// 💣 Faengt den gemessenen Fehlgriff vom 09.08.2026: die Modus-Klasse haengt an <html> UND <body>.
// Ohne :root schreibt <body> die Zahl ein zweites Mal auf den Grundwert und uebersteuert damit den
// schmalen Fall -- der Zoom bleibt sitzen, der gestapelte Bund laeuft in ihn hinein.
assert.ok(
	/:root\.avesmaps-infopanel-mode \{\s*--avesmaps-corner-stack:/.test(cssOhneKommentar),
	"der Grundwert haengt an :root, nicht an der Modus-Klasse allein"
);

// 💣 Faengt: Stapel und Zoom laufen auseinander. Beide muessen an DERSELBEN Bedingung haengen --
// stapelt der Bund, ohne dass die Zahl mitwaechst, ueberdeckt der Zoom die obere Reihe.
const engerFall = cssOhneKommentar.match(/@media \(max-width: 599px\) \{([\s\S]*?)\r?\n\}\s*$/);
assert.ok(engerFall, "es gibt den engen Fall");
assert.ok(/--avesmaps-corner-stack:\s*78px/.test(engerFall[1]), "er hebt die Zahl");
assert.ok(/flex-direction:\s*column/.test(engerFall[1]), "und stapelt den Bund");
assert.ok(
	!/flex-wrap/.test(cssOhneKommentar),
	"und zwar ohne flex-wrap -- ein Umbruch entschiede die Hoehe allein, und der Zoom erfuehre es nie"
);

// ---- Der zweite Oeffner ist wirklich verdrahtet ---------------------------------------------------
//
// 💣 Faengt: der Knopf steht da und tut nichts. Gesucht wird in der Liste der Oeffner, nicht
// irgendwo im Text -- die id kommt in den Kommentaren jener Datei sonst mehrfach vor.
const jsOhneKommentar = withoutComments(dialogJs);
const oeffnerListe = jsOhneKommentar.match(/OPEN_BUTTON_IDS = \[([^\]]*)\]/);
assert.ok(oeffnerListe, "changelog-dialog.js fuehrt seine Oeffner als Liste");
assert.ok(/"changelog-open"/.test(oeffnerListe[1]), "die Kachel in den Hinweisen oeffnet");
assert.ok(/"news-button"/.test(oeffnerListe[1]), "und der Knopf an der Karte ebenso");

// 💣 Faengt: die Liste wird gebaut, aber niemand haengt einen Klick daran (genau so war die alte
// Fassung an EINEN Knopf gebunden). Und der Fokus muss zu DEM zurueck, der geoeffnet hat.
assert.ok(
	/openButtons\.forEach\(function \(button\) \{\s*button\.addEventListener\("click"/.test(jsOhneKommentar),
	"jeder Oeffner bekommt seinen Klick"
);
assert.ok(/lastOpener = button;/.test(jsOhneKommentar), "der zuletzt benutzte Oeffner wird gemerkt");
assert.ok(/lastOpener\.focus\(\);/.test(jsOhneKommentar), "und bekommt den Fokus beim Schliessen zurueck");

console.log("map-corner-actions ok");
