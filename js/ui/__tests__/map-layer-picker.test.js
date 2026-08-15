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

// ---- 6c. Das Aufklappen beim Ueberfahren gilt NUR am Zeiger ---------------------------------------
//
// 💣 Die Bedingung ist `hover: hover` UND `pointer: fine`. Ein Touchgeraet meldet beim Tippen oft
// ein synthetisches Hover: das Menue ginge beim ersten Antippen auf, und derselbe Tipp liefe in
// die Zelle, die dann zufaellig unter dem Finger liegt. `pointer: fine` allein trifft den Stift
// mit, `hover: hover` allein manche Touch-Browser.
const schwebe = js.slice(js.indexOf("var amZeiger"), js.indexOf("document.addEventListener"));
assert.ok(/hover:\s*hover/.test(schwebe) && /pointer:\s*fine/.test(schwebe),
	"das Ueberfahren haengt an BEIDEN Merkmalen -- sonst klappt es am Finger beim Tippen auf");
assert.ok(/mouseenter/.test(schwebe) && /mouseleave/.test(schwebe),
	"es reagiert auf Betreten UND Verlassen der Huelle");
assert.ok(/setTimeout[\s\S]{0,200}\d{2,4}\)/.test(schwebe),
	"mit Verzoegerungen -- sofort waere es ein Aufklappen im Vorbeifahren zum Zoom");

// 💣 Beim Ueberfahren wird NICHT fokussiert: ein Fokus ohne Zutun springt mit der Seite zum
// Element und nimmt der Tastatur ihre Stelle. Nur Klick und Tastatur fokussieren.
assert.ok(/function oeffne\(mitFokus\)/.test(js) && /if \(!mitFokus\) \{[\s\S]{0,40}return;/.test(js),
	"oeffne() fokussiert nur auf Verlangen");
assert.ok(/oeffne\(false\)/.test(schwebe),
	"...und das Ueberfahren verlangt es nicht");
assert.ok(/oeffne\(true\)/.test(js),
	"...der Klick dagegen schon");

// 💣 Nach einer Auswahl steht der Zeiger noch ueber dem Bund. Ohne Riegel klappte das Menue
// sofort wieder auf -- er faellt erst beim Verlassen.
//
// ⚠️ Beide Ausschnitte sind ENG gefasst. Weiter gefasst fand die erste Zusicherung den Riegel im
// Klick-Handler und die zweite die Deklaration `var schwebeGesperrt = false` -- beide waren dann
// gruen, obwohl die geprueften Zeilen entfernt waren (gemessen per Mutation).
const waehlen = js.slice(js.indexOf("function waehle"), js.indexOf("knopf.addEventListener"));
assert.ok(/schwebeGesperrt = true/.test(waehlen),
	"eine Auswahl verriegelt das Ueberfahren -- sonst klappt das Menue sofort wieder auf, weil der"
	+ " Zeiger noch ueber dem Bund steht");
const verlassen = js.slice(js.indexOf('huelle.addEventListener("mouseleave"'));
assert.ok(/schwebeGesperrt = false/.test(verlassen.slice(0, 400)),
	"...und das Verlassen der Huelle loest den Riegel wieder -- sonst bliebe er bis zum naechsten"
	+ " Klick liegen und das Ueberfahren waere tot");

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

// ---- 9. Das Aufrollen -- die EINE erlaubte Ausnahme an der Huelle --------------------------------
//
// 🔴 Punkt 4 oben sichert weiter zu, dass `opacity` und `transform` an der Huelle FEHLEN. Das
// Aufrollen ist erlaubt, weil `clip-path` keins von beiden ist: es verschiebt nichts und blendet
// nichts, es gibt frei -- und die aktive Zelle liegt im Teil, der nie beschnitten ist. Diese
// Zusicherungen kommen dazu, sie ersetzen keine.
const rasterAuf = regel(".map-layer-picker__menu.is-open");
assert.ok(/clip-path:\s*inset\(/.test(raster) && /clip-path:\s*inset\(/.test(rasterAuf),
	"die Huelle traegt in BEIDEN Zustaenden einen Beschnitt -- fehlt einer, gibt es keine Bewegung,"
	+ " sondern einen Sprung in die eine Richtung");

// 💣 Der Startwert ist die Silhouette der zugeklappten Kachel. Abgeschrieben als Zahl waechst er
// beim naechsten laengeren Wort nicht mit, und der Wisch beginnt neben der Kachel statt auf ihr.
assert.ok(/var\(--map-layer-tile\)/.test(raster),
	"der Startwert des Wisches liest `--map-layer-tile`, statt eine Zahl abzuschreiben");
const huelleRegel = regel(".map-layer-picker");
assert.ok(/--map-layer-tile:\s*calc\(\s*var\(--map-layer-cell\)/.test(huelleRegel),
	"...und `--map-layer-tile` ist aus `--map-layer-cell` GERECHNET -- eine zweite feste Zahl liefe"
	+ " beim ersten breiteren Wort auseinander, sichtbar nur waehrend der Bewegung");
const zelleRegel = (css.match(/\n\.map-layer-picker__cell\s*\{([^}]*)\}/) || [])[1] || "";
assert.ok(/width:\s*var\(--map-layer-cell\)/.test(zelleRegel),
	"...und die Zelle liest DASSELBE Mass, statt ihre Breite ein zweites Mal hinzuschreiben");

// ---- 10. Zuklapp-Dauer und Aufraeum-Frist sind EIN Wert in ZWEI Dateien -------------------------
//
// 💣 Der klassische gekoppelte Wert: das Raster wird per setTimeout versteckt, eingerollt wird es
// per CSS. Wer nur eine der beiden Zahlen anfasst, bekommt entweder einen Kasten, der mitten in
// der Bewegung verschwindet, oder einen fertig eingerollten, der noch herumsteht.
const zuMs = Number((raster.match(/transition:\s*clip-path\s+(\d+)ms/) || [])[1]);
const aufMs = Number((rasterAuf.match(/transition:\s*clip-path\s+(\d+)ms/) || [])[1]);
const zellenMs = Number((bewegteZelle.match(/transition:\s*opacity\s+(\d+)ms/) || [])[1]);
const fristMs = Number((js.match(/BLENDE_ZU_MS\s*=\s*(\d+)/) || [])[1]);
assert.ok(zuMs && aufMs && zellenMs && fristMs, "beide Dauern, die Zellenblende und die Frist sind ablesbar");
assert.ok(fristMs >= zuMs && fristMs >= zellenMs,
	`die Frist bis zum Verstecken (${fristMs}ms) deckt das Zuklappen ab (Huelle ${zuMs}ms, Zellen `
	+ `${zellenMs}ms) -- ist sie kuerzer, verschwindet der Kasten mitten in der Bewegung`);
assert.ok(/}, BLENDE_ZU_MS\)/.test(js),
	"...und die Frist wird wirklich aus der Konstante gelesen, nicht als Zahl danebengeschrieben");
assert.ok(aufMs > zuMs,
	`Zuklappen ist kuerzer als Aufklappen (${zuMs} gegen ${aufMs}ms) -- deshalb steht der Uebergang`
	+ " zweimal da. Steht er nur an der Grundregel, sind beide Richtungen gleich lang");

// ---- 11. Die Staffelung zaehlt von HINTEN --------------------------------------------------------
//
// 💣 Die aktive Ansicht ist immer die LETZTE Zelle, ihre Stelle in der Reihe wechselt aber mit
// jeder Auswahl. Von vorn gezaehlt liefe die Staffelung bei „Nur Karte" von der Kachel nach aussen
// und bei „Landschaften" genau andersherum.
const staffelZeilen = css.split(/\r?\n/).filter((z) => /nth-last-child\(\d\)/.test(z));
assert.strictEqual(staffelZeilen.length, 5,
	"fuenf Verzoegerungen -- eine je Zelle, die nicht die aktive ist");
assert.ok(!/nth-child\(\d\)[^}]*transition-delay/.test(css),
	"...und KEINE von vorn gezaehlt");
assert.ok(staffelZeilen.every((z) => z.includes(".is-open")),
	"jede Verzoegerung haengt am `.is-open`-Zweig -- am Grundzustand bremste sie auch das Zuklappen,"
	+ " und die letzte Zelle haenge der Kachel hinterher, die laengst wieder da ist");

// ---- 11b. Ohne Bewegung faellt der Beschnitt GANZ weg --------------------------------------------
assert.ok(/clip-path:\s*none/.test(sparsam[1]),
	"der Sparsam-Block nimmt den Beschnitt ganz weg -- ihn bloss nicht zu animieren liesse den"
	+ " Startwert stehen, und das Raster zeigte fuer immer nur seine rechte Kachelbreite");
const telefon = css.match(/@media\s*\(max-width:\s*560px\)\s*\{([\s\S]*?)\n\}/);
assert.ok(telefon && /clip-path:\s*none/.test(telefon[1]),
	"am Telefon rollt nichts auf -- der Wisch gibt eine SENKRECHTE Kante frei, und die ist bei 2x3"
	+ " ein Streifen ueber die volle Hoehe statt der Kachelsilhouette. Die Staffelung traegt dort allein");

// ---- 12. Der Zustand ist eine VARIABLE, nicht die Klasse und nicht `hidden` ----------------------
//
// 💣 Gemessen am 15.08.2026: an `is-open` gelesen kam das Zuklappen beim Verlassen nicht zustande.
// `mouseleave` fragte `offen()`, bekam `false`, weil die Klasse erst im naechsten Bild gesetzt wird
// -- und stieg aus. Das Menue blieb offen stehen. `hidden` taugt aus dem Gegengrund nicht: es
// springt erst NACH dem Zuklappen um. Denselben Fehler hatte das Anzeige-Menue nebenan am
// 12.08.2026 (js/ui/map-display-menu.js), dort verschluckte er den zweiten schnellen Klick.
assert.ok(/var zustandOffen = false/.test(js) && /function offen\(\)\s*\{\s*return zustandOffen;/.test(js),
	"der Zustand steht in einer eigenen Variablen, und `offen()` liest genau sie");
assert.ok(!/classList\.contains\("is-open"\)/.test(js),
	"...und NICHT mehr die Klasse -- sie wird erst im naechsten Bild gesetzt, damit die Bewegung"
	+ " ueberhaupt anlaeuft; wer sie als Zustand liest, bekommt genau in diesem Bild `false`");
const schliessen = js.slice(js.indexOf("function schliesse"), js.indexOf("function oeffne"));
assert.ok(/if \(!zustandOffen\)/.test(schliessen),
	"schliesse() steigt am ZUSTAND aus, nicht an `menue.hidden` -- waehrend des Zuklappens ist"
	+ " `hidden` noch false, ein zweiter Aufruf liefe sonst ein zweites Mal durch");
assert.ok(/zustandOffen = false/.test(schliessen),
	"...und setzt ihn SOFORT, nicht erst wenn die Frist abgelaufen ist");

console.log("map-layer-picker tests passed");
