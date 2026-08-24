const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 Die Karte fragt die Darstellungstafel, nicht mehr nur den Token. OHNE Uebersteuerung kommt
// derselbe Wert heraus wie heute -- das ist die Zusicherung, die „beim Ausliefern aendert sich
// nichts" traegt (Entwurf §5.1, §8).
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-flaeche.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

const lies = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const rendering = lies("map-features-ecosystem-rendering.js");
const loader = lies("map-features-ecosystem-loader.js");
const css = fs.readFileSync(path.join(__dirname, "../../../css/features/ecosystem-layer.css"), "utf8");

// ---- A. ecosystemAreaColor reicht den Token durch die Tafel ------------------------------------
const vonFarbe = rendering.indexOf("function ecosystemAreaColor(");
const bisFarbe = rendering.indexOf("\n}", vonFarbe);
const rumpfFarbe = rendering.slice(vonFarbe, bisFarbe);
assert.ok(/avesmapsEcosystemDisplayFlaechenTon/.test(rumpfFarbe),
	"ecosystemAreaColor reicht den Token durch die Tafel");
// 💣 Und der Token wird weiterhin GELESEN -- die Tafel kennt keine Farbe (AGENTS.md §12).
assert.ok(/readEcosystemColorToken/.test(rumpfFarbe), "der Token bleibt die Vorgabequelle");

// ---- B. Die Deckkraft steht als Variable an der FLAECHE ----------------------------------------
// 💣 Nicht als Leaflet-Stil: Leaflet schreibt fill-opacity als SVG-PRAESENTATIONSATTRIBUT, und CSS
// ueberstimmt das. Die Zustandslogik (ruhend/aktiv/Kontur) bleibt an der Pane; nur der aktive
// Fuellwert kommt jetzt je Pfad.
assert.ok(/--eco-fill-art/.test(css), "die Flaeche traegt ihren eigenen Fuellwert im Stylesheet");
assert.ok(/--eco-fill-art/.test(rendering), "und jemand setzt ihn am Pfad");
assert.ok(/avesmapsEcosystemDisplayDeckkraft/.test(rendering), "aus der Tafel");

// 🔴 „Ruhend = unsichtbar" ist UNANGETASTET -- sonst laege ueber „Alle" wieder das Farbnetz,
// das AGENTS.md §12 ausdruecklich abgeschafft hat.
const flach = css.replace(/\s+/g, " ");
assert.ok(/\.ecosystem-pane \{ --eco-fill: 0; --eco-contour: 0; \}/.test(flach),
	"die ruhende Pane steht weiter auf 0/0");
// ⚠️ Der Rueckfall im var() ist tragend: eine Flaeche OHNE eigenen Wert muss den Panewert erben,
// sonst waere sie im ruhenden Zustand sichtbar.
assert.ok(/var\(--eco-fill-art, var\(--eco-fill\)\)/.test(flach),
	"ohne eigenen Wert erbt die Flaeche den Zustandswert der Pane");

// ---- C. Der Wert wird gesetzt, WO der Pfad entsteht -------------------------------------------
// 💣 Ein gruener Test beweist nichts ohne Verdrahtung. Der <path> existiert erst NACH addTo(map) --
// genau deshalb steht die Selektionsklasse dort und nicht im Baubauteil.
assert.ok(/applyEcosystemAreaDeckkraft/.test(loader),
	"der Loader setzt die Deckkraft, nachdem die Flaeche auf der Karte ist");
const posAdd = loader.indexOf("layer.addTo(map);");
const posDeck = loader.indexOf("applyEcosystemAreaDeckkraft", posAdd);
assert.ok(posAdd >= 0 && posDeck > posAdd, "und zwar NACH addTo(map) -- vorher gibt es kein Element");

// ⚠️ Auch beim Umtypisieren einer vorhandenen Flaeche: `setStyle` faerbt neu, aber die Deckkraft
// haengt an der ART, und die hat sich gerade geaendert.
const posSetStyle = loader.indexOf("existingLayer.setStyle(");
const posDeckStyle = loader.indexOf("applyEcosystemAreaDeckkraft", posSetStyle);
assert.ok(posSetStyle >= 0 && posDeckStyle > posSetStyle && posDeckStyle < posAdd,
	"und beim Umtypisieren einer vorhandenen Flaeche ebenfalls");

// ---- D. Ohne Uebersteuerung ist der Wert der heutige ------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("derographisch", "region"), 0.16);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("vegetation", "wald"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("topographie", "gebirge"), 0.72);
assert.strictEqual(avesmapsEcosystemDisplayDeckkraft("klima", "polar"), 0.30);

// ---- E. Die Tafel wird geholt, und ein Ausfall haelt die Karte NICHT auf ----------------------
// ⭐ Laderoutine im MODUL, Aufruf in js/config.js -- woertlich die Arbeitsteilung von
// avesmapsLoadLocationZoomBands. Ein Aufruf beim Laden der Datei loeste im Landschaften-Editor,
// der sie ebenfalls laedt, eine zweite nutzlose Anfrage aus.
const modul = lies("ecosystem-display.js");
assert.ok(/ecosystem-display\.php/.test(modul), "das Modul kennt seinen Endpunkt");
assert.ok(/function avesmapsLoadEcosystemDisplay/.test(modul), "und hat eine Laderoutine");
// ⚠️ Faellt STILL aus: kein Netz, kein Endpunkt, kaputte Antwort -> die Vorgaben gelten.
assert.ok(/\.catch\(\(\) => false\)/.test(modul),
	"sie faengt jeden Fehler -- ein Ausfall darf die Karte nicht aufhalten");

const config = fs.readFileSync(path.join(__dirname, "../../config.js"), "utf8");
assert.ok(/avesmapsLoadEcosystemDisplay\(\)/.test(config), "js/config.js ruft sie");
// 💣 Und zieht BEIDE Zwischenspeicher nach: der Typ-Stil je Labelart haelt die Farbe fest, die
// Flaechen ihre Deckkraft als CSS-Variable. Ohne beides wirkt eine geladene Tafel erst nach dem
// naechsten Neuladen -- und das sieht aus wie „Speichern tut nichts".
assert.ok(/avesmapsLeereLabelTypStil/.test(config), "und leert den Label-Typstil");
assert.ok(/avesmapsRefreshEcosystemDisplay/.test(config), "und zieht die Flaechen nach");
assert.ok(/function avesmapsRefreshEcosystemDisplay/.test(rendering),
	"den Nachzieher gibt es auch wirklich");

console.log("ecosystem-display-flaeche: alle Zusicherungen gruen");
