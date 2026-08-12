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
// ⚠️ Seit dem 11.08.2026 sind BEIDE Summanden Token. Die 12 stand vorher als Literal hier und ein
// zweites Mal am Knopfbund -- und ein drittes Mal als 14 am Infopanel, weshalb das Panel sichtbar
// 2px neben „Hinweise" endete (Owner-Meldung). Der Kartenrand heisst jetzt --avesmaps-edge-gap.
assert.ok(
	/bottom:\s*calc\(var\(--avesmaps-edge-gap\) \+ var\(--avesmaps-corner-stack\)\)/.test(zoomRegel[1]),
	"und rechnet seinen Abstand aus Kartenrand + --avesmaps-corner-stack, statt eine Zahl zu kennen"
);

// ---- Der Bund weicht einem Panel aus, das WIRKLICH da ist ----------------------------------------
//
// 💣 `avesmaps-infopanel-open` wird im Bearbeiten-Modus BEDINGUNGSLOS gesetzt (`open || editActive`
// in map-features-infopanel.js) -- die Annahme war „im Edit-Mode belegt der Editor die rechte Kante
// dauerhaft". Er tut es nicht: zugeklappt faehrt er hinaus, die Klasse bleibt, und der Knopfbund
// stand mitten auf der Karte neben einer Panelkante, die es nicht mehr gab (Owner-Foto 11.08.2026;
// gemessen bei 1393px: Bund 805..981, Panelkante 1393 -- 412px vom rechten Rand).
// `avesmaps-any-panel-open` beantwortet die Frage, die hier gestellt ist, und wird schon so
// gerechnet (infoOpen || editorActive). Die Rand-Laschen lesen sie seit jeher.
const verschiebung = cssOhneKommentar.match(
	/([^{}]*)\{\s*right:\s*calc\(var\(--avesmaps-ip-w\) \+ 12px\)/);
assert.ok(verschiebung, "die Regel, die Bund und Zoom neben die Panelkante setzt, ist auffindbar");
assert.ok(/avesmaps-any-panel-open/.test(verschiebung[1]),
	"sie haengt an `avesmaps-any-panel-open` -- der Klasse, die verschwindet, wenn das Panel zufaehrt");
assert.ok(!/avesmaps-infopanel-open/.test(verschiebung[1]),
	"und NICHT an `avesmaps-infopanel-open`: die steht im Bearbeiten-Modus immer, auch ohne Panel,"
	+ " und strandet den Bund dann mitten auf der Karte");
// Dieselbe Bedingung fuer das Stapeln: eng ist die Ecke, wenn ein Panel Platz nimmt -- nicht, wenn
// der Edit-Modus es bloss behauptet.
assert.ok(
	/\.avesmaps-any-panel-open #map-corner-actions \.map-corner-actions__row \{\s*flex-direction:\s*column/
		.test(cssOhneKommentar),
	"und das Stapeln haengt an derselben Klasse -- sonst stapelt der Bund fuer ein Panel, das fehlt"
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
assert.ok(/flex-direction:\s*column/.test(engerFall[1]), "und stapelt den Bund");
// 🔴 Hier stand `--avesmaps-corner-stack: 78px` -- eine ZWEITE Handzahl neben der 40 im Grundwert.
// Seit dem 11.08.2026 misst syncMapCornerStack (js/ui/ui-controls.js) den Bund und schreibt die
// Hoehe auf <html>; der Zoom erfaehrt das Stapeln also vom Bund selbst. Die Zusicherung dreht sich
// damit um: im engen Fall darf gar KEINE Zahl mehr stehen, sonst gibt es wieder zwei Wahrheiten.
assert.ok(
	!/--avesmaps-corner-stack:/.test(engerFall[1]),
	"und zwar OHNE eigene Zahl -- die Bundhoehe wird gemessen (syncMapCornerStack), nicht gepflegt."
	+ " Genau diese Zahl lag am 10.08.2026 um 8px daneben, als die Knoepfe wuchsen."
);
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

// ---- Am Telefon weicht der Bund AUCH dem Routenplaner ---------------------------------------------
//
// 💣 Faengt: die Regel faellt weg, und am Telefon steht der Knopfbund auf dem schmalen Streifen
// Karte neben dem offenen Planer -- derselbe Fall, den die Infobox-Regel in infopanel.css schon
// loest (Owner 12.08.2026: „ebenfalls wie beim ausklappen vom infopanel").
const layoutCssRoh = withoutComments(read("css", "layout", "map-layout.css"));
const plannerAusblenden = layoutCssRoh.match(/html\.avesmaps-phone\.avesmaps-planner-open #map-corner-actions \{[^}]*\}/);
assert.ok(plannerAusblenden,
	"am Telefon blendet der Bund aus, solange der Routenplaner offen ist");

// 💣 Faengt: jemand ersetzt es durch `display: none`. syncMapCornerStack misst den Bund mit
// getBoundingClientRect() und schreibt die Hoehe auf <html>; ein weggeschalteter Bund misst 0,
// der Guard `if (!hoehe) return` liesse die veraltete Zahl stehen, und der Zoom saesse falsch.
assert.ok(!/display:\s*none/.test(plannerAusblenden[0]),
	"und zwar verborgen-aber-gelayoutet (opacity/visibility), NIE per display: none");
assert.ok(/opacity:\s*0/.test(plannerAusblenden[0]) && /visibility:\s*hidden/.test(plannerAusblenden[0]),
	"mit beiden Eigenschaften -- opacity allein liesse ihn Tipper schlucken");
assert.ok(/pointer-events:\s*none/.test(plannerAusblenden[0]),
	"und ohne Zeigerfang");

// 💣 Faengt: die Regel haengt wieder an `:not(.avesmaps-planner-collapsed)`. Bis
// markRoutePlannerCollapsed() das erste Mal laeuft, traegt <html> KEINE der beiden Klassen -- eine
// :not()-Regel gaelte in diesem Fenster als „offen" und blendete den Bund beim Laden kurz weg.
assert.ok(!/:not\(\.avesmaps-planner-collapsed\)[^{]*#map-corner-actions/.test(layoutCssRoh),
	"der OFFEN-Zustand wird positiv angesprochen, nicht ueber :not()");
const plannerToggleJs = withoutComments(read("js", "ui", "route-planner-toggle.js"));
assert.ok(/classList\.toggle\("avesmaps-planner-open"/.test(plannerToggleJs),
	"und die Klasse wird an derselben Stelle gesetzt wie ihr Gegenstueck");

console.log("map-corner-actions ok");
