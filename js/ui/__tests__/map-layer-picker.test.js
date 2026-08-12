// Die Ansichts-Kachel in der Kartenecke (?layerPanelActive=1).
//
// Geprueft wird, was hier NICHT selbsterklaerend ist und beim naechsten Anfassen lautlos kippt --
// alle vier Punkte sind beim Bauen mindestens einmal danebengegangen und vom Owner gesehen worden,
// nicht vom Werkzeug:
//
//   1. Kachel und Raster tragen dieselbe Polsterung. Nur deshalb faellt die aktive Zelle auf den
//      Fleck der zugeklappten Kachel, ohne dass ein Versatz gerechnet wird.
//   2. Das Raster steht IM FLUSS. Schwebend legte es sich ueber die Zoom-Knoepfe.
//   3. Die aktive Zelle traegt KEINE Bewegung -- sonst wackelt der Knopf beim Aufklappen.
//   4. Die sechs Ansichten stehen nur EINMAL im Haus, naemlich in den <option> der Auswahlbox.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/map-layer-picker.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

/** 💣 Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const css = ohneKommentare(read("css", "components", "map-layer-picker.css"));
const js = ohneKommentare(read("js", "ui", "map-layer-picker.js"));
const html = read("index.html");

function regel(selektor) {
	const treffer = css.match(new RegExp(selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
	assert.ok(treffer, `die Regel fuer \`${selektor}\` ist auffindbar`);
	return treffer[1];
}

// ---- 1. Dieselbe Polsterung, sonst verrutscht die Kachel beim Aufklappen -------------------------
const kachel = regel("#map-layer-button");
const raster = regel(".map-layer-picker__menu");
const polsterung = (block) => (block.match(/padding:\s*([^;]+);/) || [])[1];
assert.ok(polsterung(kachel), "die Kachel setzt eine Polsterung");
assert.strictEqual(polsterung(kachel).trim(), polsterung(raster).trim(),
	"Kachel und Raster tragen DIESELBE Polsterung -- daran haengt, dass die eingestellte Ansicht"
	+ " beim Aufklappen auf ihrem Fleck bleibt. Zwei verschiedene Werte verschieben sie.");

// ---- 2. Im Fluss, nicht schwebend ----------------------------------------------------------------
assert.ok(!/position:\s*(absolute|fixed)/.test(raster),
	"das Raster steht IM FLUSS -- schwebend legte es sich ueber die Zoom-Knoepfe, die dahinter"
	+ " verschwanden (Owner 11.08.2026). Im Fluss waechst der Bund, und der Zoom liest dessen"
	+ " gemessene Hoehe.");
assert.ok(/syncMapCornerStack/.test(js),
	"...und der Picker misst den Bund beim Auf- und Zuklappen selbst nach -- der ResizeObserver"
	+ " wird erst zum naechsten Bild zugestellt, die Hoehe aendert sich aber JETZT");

// ---- 3. `hidden` muss beide wirklich verschwinden lassen ------------------------------------------
// 💣 `display: block`/`grid` sind AUTOREN-Regeln und schlagen die `[hidden]`-Regel des Browsers,
// egal wie spezifisch. In dieser Anwendung rettet css/base/reset.css das mit `!important` -- eine
// Vorfuehrseite ohne diese Datei zeigte prompt ein Menue, das ueber der Kachel klebte.
assert.ok(/\[hidden\]\s*\{[^}]*display:\s*none/.test(css),
	"das Raster hat eine eigene [hidden]-Regel -- sein `display: grid` wuerde sonst gewinnen");
const reset = read("css", "base", "reset.css");
assert.ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(reset),
	"und reset.css setzt [hidden] global mit !important durch -- daran haengt, dass die zugeklappte"
	+ " Kachel beim Aufklappen wirklich aus dem Fluss geht");

// ---- 4. Die aktive Zelle steht still -- in BEIDEN Eigenschaften ----------------------------------
//
// 💣 Diesen Fehler hat es zweimal gegeben, und beide Male hat ihn der Owner gesehen, nicht das
// Werkzeug: erst als Bewegung an der Huelle (der Knopf „wackelte" beim Aufklappen), dann als
// Blende an der Huelle (er blinkte weg und wieder her -- gemessen war die Kachel `display: none`
// UND das Raster `opacity: 0` im selben Augenblick, der Fleck also leer). Beides trifft
// unweigerlich die aktive Zelle, weil sie ein KIND der Huelle ist. Deshalb wird an der Huelle
// nichts animiert.
const aktiveZelle = regel(".map-layer-picker__menu .map-layer-picker__cell.is-active");
["transform", "opacity"].forEach((eigenschaft) => {
	const erwartet = eigenschaft === "transform" ? "none" : "1";
	assert.ok(new RegExp(eigenschaft + ":\\s*" + erwartet).test(aktiveZelle),
		`die aktive Zelle steht bei \`${eigenschaft}\` fest -- sie sitzt auf dem Fleck der`
		+ " zugeklappten Kachel: was sich dort bewegt, liest sich als wackelnder Knopf, und was dort"
		+ " verschwindet, als Flackern (Owner 12.08.2026, beide Male)");
	assert.ok(!new RegExp(eigenschaft + ":").test(raster),
		`...und die Huelle setzt \`${eigenschaft}\` NICHT -- als Elternteil zoege sie die aktive`
		+ " Zelle sonst wieder mit");
});
assert.ok(/transition:\s*none/.test(aktiveZelle),
	"und sie hat gar keinen Uebergang -- ein spaeter hinzugefuegter faende sonst wieder etwas zum"
	+ " Animieren");
const bewegteZelle = regel(".map-layer-picker__menu .map-layer-picker__cell");
assert.ok(/opacity:\s*0/.test(bewegteZelle) && /transform:\s*translateY/.test(bewegteZelle),
	"die uebrigen fuenf blenden auf und schieben sich herein -- sie kommen aus dem Nichts, sie"
	+ " duerfen es");
const sparsam = css.match(/@media\s*\(prefers-reduced-motion[^)]*\)\s*\{([\s\S]*?)\n\}/);
assert.ok(sparsam, "es gibt einen Block fuer prefers-reduced-motion");
assert.ok(/map-layer-picker__cell/.test(sparsam[1]),
	"der Sparsam-Block nennt die ZELLEN -- dort sitzen Blende und Bewegung, seit die Huelle nichts"
	+ " mehr animiert");

// ---- 5. Die aktive Ansicht wird ZULETZT gezeichnet ------------------------------------------------
const zeichnen = js.slice(js.indexOf("function zeichne"), js.indexOf("function offen"));
const posAndere = zeichnen.indexOf("a.wert !== aktuelle.wert");
const posAktive = zeichnen.lastIndexOf("menue.appendChild(zelle(aktuelle");
assert.ok(posAndere > 0 && posAktive > posAndere,
	"die aktive Ansicht wird ZULETZT ans Raster gehaengt -- nur dadurch faellt sie auf den Fleck"
	+ " der zugeklappten Kachel. Wer hier sortiert, verschiebt die Kachel beim Aufklappen.");

// ---- 6. Die sechs Ansichten stehen nur EINMAL im Haus ---------------------------------------------
assert.ok(/mapLayerModeSelect/.test(js) && /\.options/.test(js),
	"die Zellen entstehen aus den <option> der Auswahlbox");
["Nur Karte", "Kraftlinien", "Landschaften", "Politisch"].forEach((wort) => {
	assert.ok(!js.includes(wort),
		`\`${wort}\` steht NICHT im Picker -- eine zweite Liste der Ansichten waere die Divergenz,`
		+ " die beim naechsten neuen Modus zuschlaegt");
});
assert.ok(!/(powerlines|ecosystem|deregraphic)\s*:/.test(js),
	"...und auch keine zweite Tabelle der Modus-Schluessel");

// ---- 6b. Sie laeuft von sich aus, der Parameter ist der NOTAUSGANG -------------------------------
//
// 🔴 Seit dem 12.08.2026 sieht JEDER Besucher die Kachel (Owner: „geh live mit dem jetzigen"), und
// mit ihr verschwindet die Zeile „Derographie" aus dem Routenplaner. `?layerPanelActive=0` holt
// beides zurueck, ohne dass jemand deployen muss. Wer die Bedingung wieder umdreht, nimmt allen
// Besuchern die Kachel und merkt es nicht -- die Seite sieht ohne sie voellig normal aus.
assert.ok(/function abgeschaltet/.test(js) && !/function anEinschalter/.test(js),
	"der Parameter ist der Ausschalter, nicht der Einschalter");
const riegel = js.slice(js.indexOf("function abgeschaltet"), js.indexOf("function ansichten"));
assert.ok(/wert === null[\s\S]{0,120}return false/.test(riegel),
	"ohne Parameter laeuft die Kachel -- fehlt er, ist die Antwort `nicht abgeschaltet`");
assert.ok(/if \(abgeschaltet\(\)\)/.test(js),
	"...und der Aufruf fragt entsprechend auf ABGESCHALTET ab, nicht auf eingeschaltet");

// ---- 7. Der Zustand bleibt das <select> -----------------------------------------------------------
assert.ok(/dispatchEvent\(new Event\("change"/.test(js),
	"ein Klick geht ueber das change-Ereignis der Auswahlbox -- derselbe Weg, den auch sie nimmt");
assert.ok(/display-options__select-row/.test(js) && /zeile\.hidden\s*=\s*true/.test(js),
	"ausgeblendet wird die ZEILE im Planer");
assert.ok(!/select\.remove|removeChild\(select|select\.hidden\s*=\s*true/.test(js),
	"...nie das <select> selbst -- es IST der Zustand, den getSelectedMapLayerMode liest und ueber"
	+ " den der geteilte Link ankommt");

// ---- 8. Das Markup traegt keine zweite Liste ------------------------------------------------------
const bund = html.match(/<div id="map-corner-actions">([\s\S]*?)\n\t\t<\/div>/);
assert.ok(bund, "der Knopfbund ist auffindbar");
assert.ok(bund[1].indexOf("map-search-button") < bund[1].indexOf("map-layer-picker"),
	"die Ansichts-Kachel steht UNTER dem Suchknopf (Owner 11.08.2026) -- die Reihenfolge im Markup"
	+ " IST die Reihenfolge auf dem Schirm");
assert.ok(!/map-layer-menu[^>]*>\s*<button/.test(html),
	"das Raster ist im Markup LEER -- seine Zellen baut das Skript aus den <option>, sonst gaebe es"
	+ " die sechs Ansichten zweimal");

console.log("map-layer-picker tests passed");
