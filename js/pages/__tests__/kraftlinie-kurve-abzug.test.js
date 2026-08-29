// Der SVG-Abzug zeichnet die Kurvenform mit. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-abzug.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §9
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const laden = (...teile) => {
	const abs = path.join(__dirname, "..", "..", "..", ...teile);
	vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });
};
laden("js", "map-features", "powerline-topology.js");
laden("js", "pages", "svg-export-build.js");

const linie = (curve) => ({
	properties: { feature_type: "powerline", name: "Torweg", public_id: "pl-1", curve: curve },
	geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] },
});
// 💣 DER ABZUG SPIEGELT Y. GeoJSON zaehlt y nach Norden, SVG nach unten -- svgxPoint dreht das um
// (Scheitel 6 Einheiten ueber der Sehne steht im Abzug bei 1018, nicht bei 6). Gemessen wird
// deshalb der ABSTAND zur Sehne, nicht der absolute Wert; die Rohkoordinaten stehen hier nirgends.
const punkteAus = (ebene) => String(ebene.parts.join(""))
	.match(/ d="([^"]+)"/)[1]
	.split(/[ML]/)
	.map((s) => s.trim())
	.filter((s) => s !== "")
	.map((s) => s.split(/[ ,]+/).map(Number));

// ---- 1. Eine GERADE Linie bleibt Wort fuer Wort, was sie war --------------------------------
// 🔴 Die Nicht-Regression: alle Linien im Bestand sind gerade, der Abzug darf sich nicht aendern.
const gerade = svgxPowerlineLayer({ features: [linie(0)], seen: new Set(), dialect: null });
assert.strictEqual(gerade.count, 1);
assert.strictEqual(punkteAus(gerade).length, 2,
	"eine gerade Kraftlinie muss im Abzug zwei Punkte haben, nicht mehr");

// Und ohne das Feld ueberhaupt (der ganze Altbestand) genauso.
const ohneFeld = svgxPowerlineLayer({
	features: [{ properties: { feature_type: "powerline", name: "Alt", public_id: "pl-0" },
		geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] } }],
	seen: new Set(), dialect: null,
});
assert.strictEqual(punkteAus(ohneFeld).length, 2, "ohne curve-Feld bleibt die Linie eine Strecke");

// ---- 2. Eine gekruemmte Linie bekommt die Bahn ----------------------------------------------
const krumm = svgxPowerlineLayer({ features: [linie(30)], seen: new Set(), dialect: null });
const punkte = punkteAus(krumm);
assert.ok(punkte.length > 2, "die gekruemmte Kraftlinie steht im Abzug immer noch als Strecke");

// Der Scheitel steht rund 30 % von 20 = 6 Einheiten von der Sehne ab -- gemessen gegen den
// Endpunkt, damit die y-Spiegelung des Abzugs herausfaellt.
const mitte = punkte[Math.floor(punkte.length / 2)];
const sehneY = punkte[0][1];
assert.ok(Math.abs(Math.abs(mitte[1] - sehneY) - 6) < 0.5,
	`der Scheitel steht ${(mitte[1] - sehneY).toFixed(2)} von der Sehne ab, erwartet rund 6`);

// ---- 3. Die Endpunkte bleiben exakt die Nodices ---------------------------------------------
// Sie muessen dort liegen, wo die GERADE Fassung derselben Linie sie hinlegt -- das ist der
// Vergleich, der ohne Kenntnis der Spiegelung auskommt.
const geradePunkte = punkteAus(gerade);
const erster = punkte[0];
const letzter = punkte[punkte.length - 1];
assert.ok(Math.abs(erster[0] - geradePunkte[0][0]) < 1e-6 && Math.abs(erster[1] - geradePunkte[0][1]) < 1e-6,
	"der erste Punkt im Abzug ist nicht mehr der Nodix");
assert.ok(Math.abs(letzter[0] - geradePunkte[1][0]) < 1e-6 && Math.abs(letzter[1] - geradePunkte[1][1]) < 1e-6,
	"der letzte Punkt im Abzug ist nicht mehr der Nodix");

// ---- 4. Negativ kehrt die Seite um -----------------------------------------------------------
const negativ = punkteAus(svgxPowerlineLayer({ features: [linie(-30)], seen: new Set(), dialect: null }));
const mitteNeg = negativ[Math.floor(negativ.length / 2)];
assert.ok(Math.abs((mitteNeg[1] - sehneY) + (mitte[1] - sehneY)) < 1e-6,
	"im Abzug spiegelt -30 nicht exakt +30");

// ---- 5. Dieselbe Regel wie die Karte, keine zweite Wahrheit ----------------------------------
// ⚠️ Der Abzug rechnet NICHT selbst: er ruft denselben reinen Helfer wie der Kartenzeichner. Eine
// eigene Formel hier waere eine zweite Wahrheit ueber die Form der Linie.
const ausHelfer = avesmapsPowerlineCurvedPoints(0, 0, 20, 0, 30, avesmapsPowerlineCurveSteps(30, 8));
assert.strictEqual(punkte.length, ausHelfer.length,
	"der Abzug hat eine andere Stuetzpunktzahl als der geteilte Helfer -- rechnet er selbst?");
// ⚠️ Verglichen wird NACH derselben Umrechnung: svgxPoint spiegelt y UND skaliert x -- die
// Rohkoordinaten des Helfers direkt gegen die Abzugskoordinaten zu halten, misst die Umrechnung
// statt der Kurve. Also den Helfer durch dieselbe Funktion schicken.
punkte.forEach((p, i) => {
	const erwartet = svgxPoint(ausHelfer[i].x, ausHelfer[i].y);
	assert.ok(Math.abs(p[0] - Number(erwartet.x)) < 1e-6 && Math.abs(p[1] - Number(erwartet.y)) < 1e-6,
		`Punkt ${i} weicht vom geteilten Helfer ab -- der Abzug rechnet eine eigene Kurve`);
});

// ---- 6. BEIDE LADEWEGE -----------------------------------------------------------------------
// 💣 Die teuerste Luecke dieses Vorhabens, am 29.08.2026 GEMESSEN und nicht vermutet: die
// Zusicherungen oben laufen ueber vm.runInThisContext, wo powerline-topology.js im globalen Raum
// liegt. Der naechtliche Abzug-Laeufer (tools/svg-export/abzug-bauen.js) `require`t diese Datei
// aber ALLEIN -- dort gibt es keinen globalen Helfer, und der Abzug lieferte die Kraftlinien STILL
// gerade. Ein gruener Test ueber nur einen Ladeweg beweist fuer den anderen nichts.
//
// 🪤 UND DER ERSTE VERSUCH DIESER ZUSICHERUNG WAR VAKUUM: ein `require("../svg-export-build.js")`
// HIER holt das Modul aus dem Cache -- in DIESEM Prozess, wo runInThisContext den Helfer laengst
// global gelegt hat. Der erste Zweig griff, der require-Zweig lief nie, und das Entfernen des
// Node-Ladewegs blieb gruen. Nur ein FRISCHER Prozess misst den Weg des naechtlichen Laeufers.
{
	const { execFileSync } = require("child_process");
	const pfad = JSON.stringify(path.join(__dirname, "..", "svg-export-build.js"));
	// Ein EINZEILER ohne verschachtelte Anfuehrungszeichen: gezaehlt werden die L-Befehle des Pfades
	// plus das eine M -- das kommt ohne Regex auf die Stuetzpunktzahl.
	const skript = "const b = require(" + pfad + ");"
		+ " const f = { properties: { feature_type: 'powerline', name: 'Torweg', public_id: 'pl-n', curve: 30 },"
		+ " geometry: { type: 'LineString', coordinates: [[0,0],[20,0]] } };"
		+ " const e = b.svgxPowerlineLayer({ features: [f], seen: new Set(), dialect: null });"
		+ " const t = String(e.parts.join(''));"
		+ " process.stdout.write(String((t.match(/L/g) || []).length + 1));";
	const gezaehlt = Number(execFileSync(process.execPath, ["-e", skript], { encoding: "utf8" }));
	assert.ok(gezaehlt > 2,
		`der require-Weg (naechtlicher Laeufer) zeichnet die Kraftlinie gerade -- ${gezaehlt} Punkte`);
	assert.strictEqual(gezaehlt, punkte.length,
		"die zwei Ladewege liefern verschieden viele Stuetzpunkte");
}

// ---- 7. Und ohne den Helfer wird LAUT geworfen, nicht still gerade gezeichnet ----------------
// 🔴 Der stille Rueckfall auf „gerade" ist genau die Ausfallart, die Luecke 6 so lange unsichtbar
// gemacht haette: ein Abzug ohne Kurven sieht aus wie ein Abzug mit lauter geraden Linien.
{
	const gemerkt = globalThis.avesmapsPowerlineCurvedPoints;
	const pfad = require.resolve("../../map-features/powerline-topology.js");
	const gemerktesModul = require.cache[pfad];
	globalThis.avesmapsPowerlineCurvedPoints = undefined;
	require.cache[pfad] = { id: pfad, filename: pfad, loaded: true, exports: {} };
	assert.throws(
		() => svgxPowerlineCurvedCoordinates([[0, 0], [20, 0]], 30),
		/powerline-topology/,
		"ohne den geteilten Helfer zeichnet der Abzug still gerade, statt laut zu werfen"
	);
	// Eine GERADE Linie darf auch dann durchgehen -- sie braucht den Helfer gar nicht.
	assert.strictEqual(svgxPowerlineCurvedCoordinates([[0, 0], [20, 0]], 0).length, 2);
	globalThis.avesmapsPowerlineCurvedPoints = gemerkt;
	if (gemerktesModul) { require.cache[pfad] = gemerktesModul; } else { delete require.cache[pfad]; }
}

console.log("OK: SVG-Abzug -- gerade bleibt gerade, gekruemmt bekommt die Bahn, BEIDE Ladewege.");
