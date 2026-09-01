// Ist der Prüfhaken „Keine Wiki-Zuweisung" WIRKLICH angeschlossen?
//
// 💣 DER TEST NEBENAN PRÜFT DIE REGEL, DIESER DIE LEITUNG. wiki-zuweisung.test.js kann tadellos grün
// sein, während auf der Karte nichts rot wird -- ein Prüfer, den niemand ruft, ist eine Funktion mit
// Testabdeckung und ohne Wirkung. Genau so ist der ns-222-Zweig der Kanon-Ableitung tot gewesen:
// die Ableitung stimmte, die Aufrufstelle las das falsche Feld.
// 🔴 UND ER PRÜFT NUR, WAS ER PRÜFEN KANN. Die vier Zeichner hängen an Leaflet, jQuery und `map` --
// hier läuft kein Browser. Gemessen wird deshalb der QUELLTEXT: steht der Aufruf in der Datei, und
// steht er an der richtigen Stelle. Was der Quelltext nicht beweist (dass es auch AUSSIEHT wie
// gedacht), gehört in den Browser und ist dort abgenommen worden.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wiki-zuweisung-verdrahtung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// 💣 KOMMENTARE RAUS, BEVOR IRGENDETWAS GEMESSEN WIRD. Zweimal hat sich in dieser Woche ein Test
// selbst bestätigt, weil das gesuchte Zeichen in der BEGRÜNDUNG darüber stand statt in der Regel.
// Ein Test, der seine eigene Dokumentation liest, ist grün und wertlos.
function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((zeile) => zeile.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}

const lies = (...teile) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...teile), "utf8"));

const ORT = lies("js", "map-features", "map-features-location-marker-rendering.js");
const WEG = lies("js", "map-features", "map-features.js");
const FLAECHE = lies("js", "map-features", "map-features-ecosystem-rendering.js");
const LABEL = lies("js", "map-features", "map-features-labels.js");
const KURVE = lies("js", "map-features", "map-features-path-label-canvas-overlay.js");
const HAKEN = lies("js", "map-features", "map-features-wiki-zuweisung-check.js");
const MARKUP = lies("index.html");

// ---- A. Alle vier Objektarten werden wirklich gefragt -----------------------------------------
pruefe(ORT.includes("resolveLocationWikiMark(entry, visibilityContext)"), "der Ort fragt");
pruefe(WEG.includes("avesmapsWikiZuweisungMarkeWeg(path)"), "der Weg fragt");
// 🔴 UND ER HOLT DIE NAMENSFRAGE BEI `getPathTitleName`. Der Pruefer beantwortet sie nicht selbst --
// eine Nachbildung las bis zum 01.09.2026 `properties.name`, und das traegt im Browser den
// MASCHINENnamen (normalizeRoutePathFeature schreibt ihn beim Laden um). Der Haken erklaerte damit
// ALLE 6041 Wege fuer „nicht gemeint“ und faerbte keinen einzigen -- waehrend beide Tests gruen
// waren, weil sie die rohe Nutzlast nachbauten. Im Browser gemessen, dort auch behoben.
pruefe(HAKEN.includes("getPathTitleName(path) !== \"\""),
	"der Weg-Aufrufer fragt getPathTitleName, statt die Namensregel nachzubauen");
pruefe(!HAKEN.includes("PATH_SUBTYPE_KEYS"),
	"und er reicht KEINE Wegartenliste mehr durch -- die brauchte nur die Nachbildung");
// Die Gegenprobe: die Funktion gibt es und sie liest die richtigen Felder.
const DOMAIN = lies("js", "map-features", "map-features-path-domain.js");
pruefe(DOMAIN.includes("function getPathTitleName"), "getPathTitleName existiert");
pruefe(DOMAIN.includes("display_name") && DOMAIN.includes("original_name"),
	"und sie liest display_name/original_name, nicht das umgeschriebene name");
pruefe(FLAECHE.includes("avesmapsWikiZuweisungMarkeFlaeche(area)"), "die Flaeche fragt");
pruefe(LABEL.includes("avesmapsWikiZuweisungMarkeLabel(label)"), "die Beschriftung fragt");
pruefe(KURVE.includes("avesmapsWikiZuweisungMarkeLabel(label)"), "und das KURVENLABEL auch");

// ---- B. 🔴 DIE TRAGENDE ZUSICHERUNG: der Haken blendet NICHTS ein ------------------------------
// Owner-Entscheid vom 14.08.2026 („ein Pruefhaken ZEIGT seine Funde") gilt fuer die vier Nachbarn.
// Dieser eine faerbt nur -- weil 983 von 2912 Orten betroffen sind, ein Drittel des Bestands.
// Wandert der Aufruf je in shouldShowLocationMarker, liegt genau dieses Drittel auf der Karte,
// an den Zoombaendern vorbei. Der Test schneidet die Funktion heraus und sieht nach.
const sichtbarkeitAb = ORT.indexOf("function shouldShowLocationMarker(");
const naechsteFunktion = ORT.indexOf("\nfunction ", sichtbarkeitAb + 1);
pruefe(sichtbarkeitAb > -1 && naechsteFunktion > sichtbarkeitAb, "shouldShowLocationMarker gefunden");
const sichtbarkeit = ORT.slice(sichtbarkeitAb, naechsteFunktion);
pruefe(!sichtbarkeit.includes("resolveLocationWikiMark"),
	"🔴 shouldShowLocationMarker darf die Wiki-Marke NICHT lesen -- sonst blendet der Haken 983 Orte ein");
pruefe(!sichtbarkeit.includes("WikiZuweisung"),
	"und auch sonst nichts aus dem Pruefer");
// Die Gegenprobe: der Befund der NACHBARN steht dort sehr wohl -- sonst misst der Riegel oben nichts.
pruefe(sichtbarkeit.includes("resolveLocationCheckFinding"),
	"resolveLocationCheckFinding steht weiterhin drin (sonst prueft der Riegel darueber eine leere Funktion)");

// ---- C. Die Rangfolge: ein echter Befund schlaegt die Marke ------------------------------------
// Ein Marker traegt hoechstens EINEN Ring. Pink („unverbunden") ist der gravierendere Befund.
const ringZeileAb = ORT.indexOf("const ringModifier =");
pruefe(ringZeileAb > -1, "die Ring-Entscheidung gefunden");
const ringZeile = ORT.slice(ringZeileAb, ORT.indexOf(";", ringZeileAb));
pruefe(ringZeile.indexOf("resolveLocationCheckFinding") < ringZeile.indexOf("resolveLocationWikiMark"),
	"der Befund steht VOR der Marke -- die Reihenfolge im `||` IST die Rangfolge");

// ---- D. Der Weg faerbt den SAUM, nicht die Mitte -----------------------------------------------
// 💣 Sonst schluegen sich die beiden Wege-Haken: „Offene Wegenden" faerbt style.center. Zwei
// Mitten-Faerbungen hiessen, dass stumm die untere Zeile gewinnt und ein Haken wirkungslos aussieht.
const wegBlockAb = WEG.indexOf("const wikiMarke =");
pruefe(wegBlockAb > -1, "der Wegblock steht in map-features.js");
const wegBlock = WEG.slice(wegBlockAb, wegBlockAb + 500);
pruefe(wegBlock.includes("style.outline ="), "der Weg faerbt die Kontur");
pruefe(!wegBlock.includes("style.center ="),
	"🔴 und NICHT die Mitte -- sonst ueberschreibt er den Befund von „Offene Wegenden“");
// Und er steht NACH jenem, sonst faerbt der andere ihn wieder zu.
pruefe(WEG.indexOf("avesmapsIsOpenPathEndCheckActive") < wegBlockAb,
	"der Wiki-Block steht NACH dem Block „Offene Wegenden“");

// ---- E. Zwei Toene, und sie sind wirklich verschieden ------------------------------------------
const TOKENS = lies("css", "base", "tokens.css");
const wert = (name) => {
	const treffer = TOKENS.match(new RegExp("\\" + name.replace(/[-]/g, "-") + ":\\s*([^;]+);"));
	return treffer ? treffer[1].trim() : "";
};
const tonWiki = wert("--color-check-no-wiki");
const tonOffen = wert("--color-path-open-end");
pruefe(tonWiki !== "", "--color-check-no-wiki ist gesetzt");
pruefe(tonOffen !== "", "--color-path-open-end ist gesetzt");
pruefe(tonWiki !== tonOffen,
	"🔴 die beiden Rottoene sind VERSCHIEDEN -- sie treffen sich auf demselben Weg (Mitte + Saum)");
pruefe(wert("--color-check-no-wiki-checked") !== "", "der blasse Ton ist gesetzt");

// ---- F. Der Ring hat eine Regel, und er teilt die Breite der Nachbarn --------------------------
const MARKER_CSS = lies("css", "features", "location-popups-markers.css");
for (const klasse of ["--no-wiki", "--no-wiki-checked"]) {
	pruefe(MARKER_CSS.includes(`.location-visual-marker__shape${klasse} {`), `Regel fuer ${klasse}`);
}
// ⚠️ DIE VIER PRUEFRINGE SOLLEN GLEICH DICK SEIN UND SICH NUR IM TON UNTERSCHEIDEN -- und geprueft
// wird das, indem die neue Regel gegen ihre NACHBARIN gestellt wird: nimmt man beiden ihren Farbton,
// muessen sie zeichengleich sein. Ein blosses `includes("--marker-check-ring-width")` reichte NICHT:
// die Regel nennt das Merkmal zweimal, und eine der beiden Zeilen liesse sich auf einen festen Wert
// setzen, ohne dass etwas auffiele (genau so gemessen, 01.09.2026).
const regelAb = (klasse) => {
	const start = MARKER_CSS.indexOf(`.location-visual-marker__shape--${klasse} {`);
	assert.ok(start > -1, `Regel fuer --${klasse} nicht gefunden`);
	return MARKER_CSS.slice(start, MARKER_CSS.indexOf("}", start));
};
// ⚠️ `split`/`join` und keine RegExp: `var(--x)` enthaelt Klammern, und die sind in einem Muster
// Gruppierung statt Zeichen. Genau daran ist die erste Fassung dieser Zeile gescheitert -- sie
// ersetzte nichts, verglich zwei Zeichenketten mit verschiedenen Tokens und fiel als „ungleich".
const ohneTon = (regel, token) => regel
	.split(`.location-visual-marker__shape--${token.rufname} {`).join("")
	.split(`var(${token.farbe})`).join("«TON»")
	.replace(/\s+/g, " ").trim();
const ringNeu = ohneTon(regelAb("no-wiki"), { rufname: "no-wiki", farbe: "--color-check-no-wiki" });
const ringAlt = ohneTon(regelAb("unconnected"), { rufname: "unconnected", farbe: "--color-marker-unconnected-ring" });
assert.strictEqual(ringNeu, ringAlt,
	"der neue Ring ist zeichengleich zu „Unverbunden“, sobald man beiden den Farbton nimmt");
pruefungen++;
pruefe(regelAb("no-wiki").includes("var(--color-check-no-wiki)"), "und er traegt seinen eigenen Ton");
// 🔴 Und er steht NACH den beiden anderen: bei zwei gesetzten Klassen gewinnt sonst die falsche.
pruefe(MARKER_CSS.indexOf(".location-visual-marker__shape--sparse-crossing {")
	< MARKER_CSS.indexOf(".location-visual-marker__shape--no-wiki {"),
	"die neue Regel steht NACH pink und tuerkis");

// ---- G. Der Schalter ist vollstaendig verdrahtet ----------------------------------------------
// 💣 SIEBEN STELLEN, UND JEDE EINZELNE IST SCHON EINMAL VERGESSEN WORDEN. Fehlt die Vorgabe, wirft
// der Link-Abgleich `undefined`; fehlt bootstrap, sieht kein Editor den Haken; fehlt der Handler,
// laesst er sich umlegen und tut nichts.
const stellen = [
	["index.html", MARKUP, 'id="toggleNoWikiAssignment"'],
	["index.html (Zeile)", MARKUP, 'id="toggleNoWikiAssignmentControl"'],
	["js/config.js", lies("js", "config.js"), "toggleNoWikiAssignment: false"],
	["js/app/bootstrap.js (an)", lies("js", "app", "bootstrap.js"), '"toggleNoWikiAssignmentControl"'],
	["js/app/bootstrap.js (aus)", lies("js", "app", "bootstrap.js"), '"toggleNoWikiAssignment")?.setAttribute'],
	["layer-state (lesen)", lies("js", "map-features", "map-features-layer-state.js"), 'searchParams.get("toggleNoWikiAssignment")'],
	["layer-state (schreiben)", lies("js", "map-features", "map-features-layer-state.js"), 'searchParams.set("toggleNoWikiAssignment"'],
	["map-features.js (Handler)", WEG, '$("#toggleNoWikiAssignment").change'],
];
for (const [wo, text, gesucht] of stellen) {
	pruefe(text.includes(gesucht), `verdrahtet in ${wo}`);
}

// ---- H. Der Riegel IS_EDIT_MODE sitzt im JS, nicht nur am Menue --------------------------------
// 💣 `?toggleNoWikiAssignment=1` im geteilten Link erreicht sonst auch einen Besucher. Genau diese
// Falle ist bei „Offene Wegenden" schon einmal zugeschnappt.
const aktivAb = HAKEN.indexOf("function avesmapsIstWikiZuweisungCheckAktiv");
const aktiv = HAKEN.slice(aktivAb, HAKEN.indexOf("};", aktivAb));
pruefe(aktiv.includes("istVerfuegbar()"), "der Haken prueft die Verfuegbarkeit");
pruefe(HAKEN.includes("IS_EDIT_MODE"), "und die haengt an IS_EDIT_MODE");

// ---- I. Alle vier Flaechen werden nachgezogen --------------------------------------------------
// 💣 Zoege nur eine nach, stuende nach dem Umlegen die halbe Karte im alten Zustand -- und beim
// AUSSCHALTEN bliebe sie rot. Genau das hat „Offene Wegenden" am 22.08.2026 gekostet.
const syncAb = HAKEN.indexOf("function avesmapsSyncWikiZuweisungCheck");
const sync = HAKEN.slice(syncAb);
for (const ruf of ["syncLocationMarkerVisibility", "updatePathLayerStyle",
	"avesmapsRefreshEcosystemDisplay", "avesmapsLabelIconsNeuBauen", "avesmapsKurvenlabelAblageVerwerfen"]) {
	pruefe(sync.includes(ruf), `das Nachziehen ruft ${ruf}`);
}
// Und die Gegenstuecke gibt es wirklich -- ein Aufruf ins Leere faellt nur durch den typeof-Riegel.
pruefe(LABEL.includes("window.avesmapsLabelIconsNeuBauen ="), "avesmapsLabelIconsNeuBauen existiert");
pruefe(KURVE.includes("window.avesmapsKurvenlabelAblageVerwerfen ="), "avesmapsKurvenlabelAblageVerwerfen existiert");
pruefe(FLAECHE.includes("function avesmapsRefreshEcosystemDisplay"), "avesmapsRefreshEcosystemDisplay existiert");

// ---- J. Die Ladereihenfolge --------------------------------------------------------------------
// 💣 `const` auf Dateiebene wird in einem klassischen Script NICHT gehoistet: der reine Pruefer muss
// vor jedem Zeichner stehen, der ihn liest.
const platz = (datei) => MARKUP.indexOf(`src="${datei}"`);
pruefe(platz("js/map-features/wiki-zuweisung.js") > -1, "der Pruefer ist eingebunden");
pruefe(platz("js/map-features/map-features-wiki-zuweisung-check.js") > -1, "der Haken ist eingebunden");
for (const zeichner of ["js/map-features/map-features-labels.js",
	"js/map-features/map-features-ecosystem-rendering.js",
	"js/map-features/map-features-location-marker-rendering.js",
	"js/map-features/map-features.js"]) {
	pruefe(platz("js/map-features/wiki-zuweisung.js") < platz(zeichner),
		`der Pruefer laedt vor ${zeichner}`);
}

console.log(`wiki-zuweisung-verdrahtung.test.js: ${pruefungen} Pruefungen erfuellt`);
