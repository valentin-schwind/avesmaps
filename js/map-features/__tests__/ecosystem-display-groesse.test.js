const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DIE FEINSTE REGEL DES GANZEN UMBAUS, und sie ist zweigeteilt (Entwurf §5.5 und §6):
//
//   GROESSE: die Tafel GILT.  Der eigene Wert des Labels wird nicht mehr gelesen.
//   BAND:    die Tafel RAET.  Der eigene Wert des Labels gewinnt; die Vorgabe greift nur, wo keiner steht.
//
// 💣 Wer beides gleich behandelt, nimmt den Editoren entweder ihre Baender weg oder laesst die
// Groesse wirkungslos. Beides ist genau falsch herum, und beides faellt im Betrieb nicht sofort auf.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-groesse.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);

const quelle = fs.readFileSync(path.join(__dirname, "../map-features-labels.js"), "utf8");
// 💣 Die Prosa erklaert hier genau das Gesuchte -- ein Treffer im Kommentar ist kein Beweis.
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

// ---- A. GROESSE: die Tafel gilt ----------------------------------------------------------------
const vonG = ohneKommentare.indexOf("function getScaledLabelSize(");
const bisG = ohneKommentare.indexOf("\n}", vonG);
const rumpfG = ohneKommentare.slice(vonG, bisG);
assert.ok(vonG >= 0, "getScaledLabelSize steht in der Datei");
assert.ok(/avesmapsEcosystemDisplayGroesse\(label\.labelType/.test(rumpfG),
	"die Groesse kommt aus der Tafel, und zwar je ART");
// 🔴 Der Tafel-Zweig steht ZUERST -- sonst gewinnt die alte Rechnung und der Umbau ist wirkungslos.
const posTafel = rumpfG.indexOf("avesmapsEcosystemDisplayGroesse");
const posAlt = rumpfG.indexOf("Number(label.size)");
assert.ok(posAlt < 0 || posTafel < posAlt,
	"der Tafel-Zweig steht vor dem Rueckfall -- sonst liest weiter label.size");

// ---- B. 💣 DAS FELD `size` BLEIBT IM FORMULAR, als hidden --------------------------------------
// Der Payload liest formData.get("size"); OHNE das Feld schriebe jedes Speichern eine 0 ueber den
// gemerkten Wert. Genau dieselbe Falle steht zwei Zeilen darueber schon fuer `rotation`.
const seite = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(/id="label-edit-size"[^>]*type="hidden"/.test(seite),
	"das Groessenfeld steht als hidden im Formular");
assert.ok(/id="label-edit-size"[^>]*name="size"/.test(seite),
	"und traegt weiter seinen Namen -- sonst faellt es aus dem Payload");
assert.ok(!/id="label-edit-size-range"/.test(seite), "der Regler dazu ist weg");
// ⚠️ Und der Schreibweg liest es weiterhin, sonst waere das hidden Feld sinnlos.
const dialog = fs.readFileSync(path.join(__dirname, "../../review/review-labels.js"), "utf8");
assert.ok(/label-edit-size/.test(dialog), "der Dialog liest und schreibt den gemerkten Wert weiter");

// ---- C. BAND: die Tafel raet -- AUSGEFUEHRT, nicht gelesen ------------------------------------
// 🪤 Die erste Fassung dieses Abschnitts pruefte den QUELLTEXT (steht `hatEigenesBand` drin, steht
// es vor der Vorgabe). Eine Mutation, die den eigenen Wert ignoriert -- `hatEigenesBand` durch
// `false` ersetzt --, blieb dabei GRUEN: der Bezeichner stand ja weiter da. Am 24.08.2026 gemessen.
// Deshalb ist die Entscheidung jetzt eine reine Funktion, und der Test FUEHRT SIE AUS.
const vonB = quelle.indexOf("function avesmapsLabelImBand(");
const bisB = quelle.indexOf("\n}", vonB);
assert.ok(vonB >= 0, "avesmapsLabelImBand steht als eigene Funktion da");
const avesmapsLabelImBand = new Function(
	"avesmapsEcosystemDisplaySichtbar",
	quelle.slice(vonB, bisB + 2) + "; return avesmapsLabelImBand;"
)(avesmapsEcosystemDisplaySichtbar);

// Vorgabe der Tafel: nur z2 bis z4 sichtbar.
avesmapsEcosystemDisplayInstall({ vorgabe: { wald: { ab: 2, bis: 4 } } });

// 🔴 EIN LABEL MIT EIGENEM BAND GEWINNT -- die Tafel raet nur.
const mitEigenem = { labelType: "wald", minZoom: 0, maxZoom: 7 };
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 0), true, "eigenes Band z0-z7: z0 sichtbar");
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 6), true, "und z6 auch -- die Tafel saehe z6 nicht");
assert.strictEqual(avesmapsLabelImBand(mitEigenem, 8), false, "ausserhalb des eigenen Bandes nicht");

// Ohne eigenen Wert greift die Vorgabe.
const ohneEigenes = { labelType: "wald", minZoom: null, maxZoom: null };
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 1), false, "ohne eigenes Band gilt die Vorgabe: z1 nicht");
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 3), true, "z3 schon");
assert.strictEqual(avesmapsLabelImBand(ohneEigenes, 6), false, "z6 nicht");

// ⚠️ Und shouldShowLabelMarker benutzt sie auch wirklich -- sonst haette die Funktion keinen Wirt.
const vonS = ohneKommentare.indexOf("function shouldShowLabelMarker(");
const bisS = ohneKommentare.indexOf("\n}", vonS);
assert.ok(/avesmapsLabelImBand\(entry\.label/.test(ohneKommentare.slice(vonS, bisS)),
	"shouldShowLabelMarker fragt sie");

// ---- D. Ohne Uebersteuerung ist die Kurve die heutige ------------------------------------------
avesmapsEcosystemDisplayInstall(null);
assert.deepStrictEqual(
	[0, 1, 2, 3, 4, 5, 6, 7].map((z) => avesmapsEcosystemDisplayGroesse("wald", z)),
	[9, 11, 13, 14, 16, 18, 19, 21],
	"die Vorgabe ist die heutige Kurve bei Grundgroesse 18"
);

// ---- E. Die Tafel wirkt je ART ------------------------------------------------------------------
avesmapsEcosystemDisplayInstall({ groesse: { gebirge: [20, 20, 20, 20, 20, 20, 20, 20, 20] } });
assert.strictEqual(avesmapsEcosystemDisplayGroesse("gebirge", 3), 20, "die gesetzte Art folgt der Tafel");
assert.strictEqual(avesmapsEcosystemDisplayGroesse("wald", 3), 14, "eine andere Art bleibt bei der Vorgabe");

console.log("ecosystem-display-groesse: alle Zusicherungen gruen");
