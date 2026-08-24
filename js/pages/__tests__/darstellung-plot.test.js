const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Der Groessenplot im Fenster „Darstellung" (Entwurf §5.5).
//
// 💣 In der Vorgabestellung sind ALLE Kurven deckungsgleich -- ein Dutzend Punkte konkurriert um
// denselben Klick. Owner 24.08.2026: „man muss erst alle darueberliegenden wegschaufeln". Die
// Loesung ist KEIN groesserer Klickradius (das macht die Ueberdeckung nur breiter), sondern ein
// Riegel: eine gewaehlte Art ist die einzige, die man noch anfassen kann.
//
// 🪤 Und die Namen am Rand duerfen nicht aufeinanderliegen. Ein Diagramm, dessen Beschriftung genau
// dann versagt, wenn noch niemand etwas verstellt hat, versagt beim ERSTEN Blick.
//
// Geschnitten und AUSGEFUEHRT, nicht gelesen.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-plot.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");

function schneide(name) {
	const von = editor.indexOf("function " + name + "(");
	assert.ok(von >= 0, name + " steht im Fenster");
	const bis = editor.indexOf("\n}", von);
	return editor.slice(von, bis + 2);
}

// ---- A. Der Auswahl-Riegel -----------------------------------------------------------------------
const ecoDisplayPlotAnfassbar = new Function(
	schneide("ecoDisplayPlotAnfassbar") + "; return ecoDisplayPlotAnfassbar;"
)();
assert.strictEqual(ecoDisplayPlotAnfassbar("wald", null), true, "ohne Auswahl ist alles anfassbar");
assert.strictEqual(ecoDisplayPlotAnfassbar("wald", "tundra"), false, "mit Auswahl NICHT die anderen");
assert.strictEqual(ecoDisplayPlotAnfassbar("tundra", "tundra"), true, "mit Auswahl nur die eine");
// ⚠️ Eine leere Zeichenkette ist keine Auswahl -- sonst sperrte ein zuruecknehmender Klick alles.
assert.strictEqual(ecoDisplayPlotAnfassbar("wald", ""), true, "die leere Auswahl sperrt nichts");

// ---- B. Das Auffaechern der Namen ----------------------------------------------------------------
// 🪤 Die Funktion braucht ECO_DISPLAY_PLOT fuer das Zurueckfalten am unteren Rand -- sie wird ihr
// hereingereicht, statt sie im Test nachzubauen.
const vonK = editor.indexOf("const ECO_DISPLAY_PLOT = {");
const ECO_DISPLAY_PLOT = new Function(
	editor.slice(vonK, editor.indexOf("\n", vonK)) + " return ECO_DISPLAY_PLOT;"
)();
const ecoDisplayPlotFaechere = new Function(
	"ECO_DISPLAY_PLOT",
	schneide("ecoDisplayPlotFaechere") + "; return ecoDisplayPlotFaechere;"
)(ECO_DISPLAY_PLOT);

const gleich = ecoDisplayPlotFaechere([100, 100, 100, 100], 13);
assert.strictEqual(gleich.length, 4, "es kommen so viele Werte zurueck wie hinein");
const sortiert = gleich.slice().sort((a, b) => a - b);
sortiert.forEach((y, i) => {
	if (i > 0) {
		assert.ok(y - sortiert[i - 1] >= 13 - 1e-9,
			"kein Ueberlapp bei vier gleichen Werten: " + sortiert.join(", "));
	}
});

// 🔴 Die REIHENFOLGE bleibt: raus[i] gehoert zu rein[i]. Wer hier die sortierte Liste zurueckgibt,
// haengt jeden Namen an die falsche Kurve -- und es sieht trotzdem ordentlich aus.
const gemischt = ecoDisplayPlotFaechere([300, 100, 200], 13);
assert.ok(gemischt[1] < gemischt[2] && gemischt[2] < gemischt[0],
	"die Ordnung der EINGABE bleibt erhalten: " + gemischt.join(", "));

// Wer schon weit genug auseinanderliegt, wird nicht bewegt.
assert.deepStrictEqual(ecoDisplayPlotFaechere([40, 90, 140], 13), [40, 90, 140],
	"weit auseinander liegende Namen bleiben, wo sie sind");

// ⚠️ Und keiner darf unten hinauslaufen -- sonst stehen die letzten Namen ausserhalb des Kastens.
const unten = ECO_DISPLAY_PLOT.h - ECO_DISPLAY_PLOT.b;
const viele = ecoDisplayPlotFaechere(new Array(30).fill(unten - 4), 13);
assert.ok(Math.max.apply(null, viele) <= unten + 1e-9,
	"dreissig Namen auf derselben Hoehe bleiben im Kasten (hoechster: " + Math.max.apply(null, viele) + ")");

// ---- C. Die Kurve laeuft NUR durch ihr Band -------------------------------------------------------
// 🔴 Eine Art, die bei z3 verschwindet, hat bei z4 keine Schriftgroesse. Eine durchgezogene Linie
// dorthin behauptete einen Wert, den es nicht gibt -- dieselbe Regel wie `null` in den Zoombaendern.
const ecoDisplayPlotSichtbar = new Function(
	"ecoDisplayVorgabe", "ECO_DISPLAY_BAND_MAX",
	schneide("ecoDisplayPlotSichtbar") + "; return ecoDisplayPlotSichtbar;"
)((art) => (art === "aus" ? { ab: 0, bis: -1 } : { ab: 2, bis: 4 }), 7);
assert.strictEqual(ecoDisplayPlotSichtbar("wald", 1), false, "unter dem Band: kein Wert");
assert.strictEqual(ecoDisplayPlotSichtbar("wald", 3), true, "im Band: ein Wert");
assert.strictEqual(ecoDisplayPlotSichtbar("wald", 5), false, "ueber dem Band: kein Wert");
assert.strictEqual(ecoDisplayPlotSichtbar("aus", 3), false, "eine abgeschaltete Art hat nirgends einen");
// 🔴 z8 erbt z7 -- die Karte kennt Stufe 8 nicht, das Band endet bei 7. Ohne diese Kappung faellt
// z8 aus JEDEM Band heraus und die letzte Stufe waere immer leer.
const ecoDisplayPlotSichtbarBis7 = new Function(
	"ecoDisplayVorgabe", "ECO_DISPLAY_BAND_MAX",
	schneide("ecoDisplayPlotSichtbar") + "; return ecoDisplayPlotSichtbar;"
)(() => ({ ab: 0, bis: 7 }), 7);
assert.strictEqual(ecoDisplayPlotSichtbarBis7("wald", 8), true, "z8 erbt z7, es faellt nicht heraus");

// ---- D. Die Tastatur bedient ihn auch --------------------------------------------------------------
// ⚠️ Ein Punkt, den man nur ziehen kann, ist fuer den nicht bedienbar, der nicht ziehen kann -- und
// der Plot ist die EINZIGE Stelle im Fenster, an der die Schriftgroesse gesetzt wird.
const vonT = editor.indexOf("function ecoDisplayPlotTaste");
assert.ok(vonT >= 0, "es gibt eine Tastenbehandlung");
const rumpfT = editor.slice(vonT, editor.indexOf("\nfunction ", vonT + 10));
assert.ok(/ArrowLeft/.test(rumpfT) && /ArrowRight/.test(rumpfT), "← → wechseln die Zoomstufe");
assert.ok(/ArrowUp/.test(rumpfT) && /ArrowDown/.test(rumpfT), "↑ ↓ aendern den Wert");

// 🪤 UND SIE MUSS VERDRAHTET SEIN. Beim Bau hing sie zuerst an nichts -- eine tote Funktion, die
// jede Quelltext-Zusicherung ueber „ArrowLeft steht da" gruen laesst. Am 24.08.2026 gemessen.
assert.ok(/addEventListener\("keydown", ecoDisplayPlotTaste\)/.test(editor),
	"ecoDisplayPlotTaste haengt an einem keydown-Zuhoerer");
// ⚠️ Und zwar am SVG, nicht am Dokument: global fraesse sie die Pfeiltasten der ganzen Seite.
assert.ok(/\$\("ecoDisplayPlot"\)\.addEventListener\("keydown"/.test(editor),
	"der Zuhoerer sitzt am Plot selbst");
assert.ok(/id="ecoDisplayPlot"[\s\S]{0,200}tabindex="0"/.test(editor),
	"und der Plot kann den Fokus ueberhaupt bekommen");

// ---- E. Klimazonen tragen den Plot nicht ----------------------------------------------------------
// 🔴 Owner 24.08.2026: Klimabaender haben keine Beschriftung auf der Karte, also weder Zoomband
// noch Schriftgroesse noch Vorschau noch Kurvenfeinheiten.
const vonZ = editor.indexOf("function ecoDisplayZeichnePlot");
const rumpfZ = editor.slice(vonZ, editor.indexOf("\nfunction ", vonZ + 10));
assert.ok(/kind !== "klima"/.test(rumpfZ), "der Plot blendet sich bei Klimazonen aus");

console.log("darstellung-plot: alle Zusicherungen gruen");
