// Das Nachschlagen der Farb-Token ohne DOM. Lauf:
//   node tools/svg-export/__tests__/tokens-tafel.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../tokens-tafel.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const TOKENS = path.join(WURZEL, "css", "base", "tokens.css");

// ---- 1. Der Block wird ueber die Klammern gezaehlt, nicht bis zum ersten `}` -----------
// 💣 In :root stehen @media-Schachtelungen. Wer bis zum ersten `}` liest, bekommt einen
// Bruchteil der Tafel -- und alles danach faellt still auf den Rueckfallbeige zurueck.
const kuenstlich = `
/* Kopf */
:root {
	--a: #111;
	@media (min-width: 40em) {
		--b: #222;
	}
	--c: #333;
}
:root[data-theme="dark"] {
	--a: #999;
}
`;
const tafel = T.svgxTokenTafelAusCss(kuenstlich);
assert.strictEqual(tafel["--a"], "#111");
assert.strictEqual(tafel["--c"], "#333", "was NACH der Schachtelung steht, gehoert noch dazu");
assert.strictEqual(tafel["--b"], "#222", "und was darin steht, ebenfalls");

// ---- 2. Kommentare sind keine Token ----------------------------------------------------
const mitKommentar = ':root {\n\t/* --color-tot: #000; */\n\t--color-echt: #abc; /* Notiz */\n}';
const tafel2 = T.svgxTokenTafelAusCss(mitKommentar);
assert.strictEqual(tafel2["--color-echt"], "#abc", "der Wert endet vor dem Kommentar");
assert.ok(!("--color-tot" in tafel2), "ein auskommentierter Token ist keiner");

// ---- 3. Ein fehlender Token gibt "" zurueck, wie getComputedStyle ----------------------
// 🔴 Nicht undefined: svgxFarbeVorgabe verkettet mit `||`, und `undefined` verhielte sich
// zufaellig gleich -- bis jemand `?? ` schreibt. Der leere String ist die Zusage.
const leser = T.svgxTokenLeser(TOKENS);
assert.strictEqual(leser("--gibt-es-ganz-sicher-nicht"), "");
assert.strictEqual(typeof leser("--gibt-es-ganz-sicher-nicht"), "string");

// ---- 4. Die echten Token der Karte -----------------------------------------------------
assert.ok(/^#[0-9a-f]{3,8}$/i.test(leser("--color-ecosystem-vegetation-wald")),
	"der Waldton ist ein Farbwert");
assert.ok(/^#[0-9a-f]{3,8}$/i.test(leser("--color-marker-waypoint")));

// ---- 5. 💣 DIE ZUSICHERUNG, AUF DER DER GANZE LAEUFER STEHT ----------------------------
// Der Laeufer liest NUR den Basis-Block. Das ist genau so lange richtig, wie kein Token, den
// der Export nachschlaegt, im dunklen Thema einen anderen Wert bekommt -- sonst haengt die
// Farbe des naechtlichen Abzugs an einer Themenwahl, die es dort gar nicht gibt, und der
// Browserabzug eines Admins im Dunkelmodus saehe anders aus. Am 23.08.2026 gemessen: keiner
// der Export-Token steht im Dunkelblock. Diese Zeile haelt das fest.
const css = fs.readFileSync(TOKENS, "utf8");
// 💣 UEBER DEN GEPARSTEN BLOCK, NICHT UEBER EINEN TEXTAUSSCHNITT. Die erste Fassung schnitt
// ab `indexOf(':root[data-theme="dark"]')` -- und landete im KOPFKOMMENTAR von tokens.css
// (Zeile 9 erklaert dort genau diesen Selektor). Der "Dunkelblock" war damit die halbe Datei,
// und der Test meldete alle 51 Token als uebersteuert. Ein Test, der Prosa liest, misst Prosa.
const dunkel = T.svgxDarkBlock(css);
assert.ok(dunkel.length > 100, "es gibt einen Dunkelblock -- sonst prueft das hier nichts");
assert.ok(!dunkel.includes(":root"), "und er ist der BLOCK, nicht der Rest der Datei");
const exportToken = Object.keys(leser.tafel)
	.filter((name) => name.startsWith("--color-ecosystem-") || name === "--color-marker-waypoint");
assert.ok(exportToken.length > 40,
	`die Tafel traegt die Ökosystem-Token, gefunden: ${exportToken.length}`);
// 💣 `"\\s"` mit zwei Backslashes. In einem JS-String ist `"\s"` schlicht `"s"` -- das Muster
// hiesse dann `--color-…s*:` und traefe NIE etwas. Der Test waere gruen, ohne je zu pruefen.
const ueberschrieben = exportToken.filter((name) =>
	new RegExp("(^|[^a-z0-9-])" + name + "\\s*:").test(dunkel));
// Und der Beweis, dass das Muster ueberhaupt trifft: gegen den Basis-Block muessen ALLE
// Export-Token anschlagen. Ohne diese Gegenprobe belegt die leere Liste oben gar nichts.
const basis = T.svgxRootBlock(css);
const imBasisGefunden = exportToken.filter((name) =>
	new RegExp("(^|[^a-z0-9-])" + name + "\\s*:").test(basis));
assert.strictEqual(imBasisGefunden.length, exportToken.length,
	"dasselbe Muster findet im Basis-Block jeden Token -- es ist also scharf");
assert.deepStrictEqual(ueberschrieben, [],
	"kein Export-Token wird im dunklen Thema uebersteuert -- sonst haengt der Abzug an einer "
	+ "Themenwahl, die es im naechtlichen Lauf gar nicht gibt");
// Gegenprobe, damit die leere Liste nicht bloss heisst „der Block ist leer": im Dunkelblock
// stehen sehr wohl Token, nur eben keiner von unseren.
assert.ok(/--color-[a-z0-9-]+\s*:/.test(dunkel), "der Dunkelblock traegt ueberhaupt Token");

// ---- 6. Kaputte Eingabe sagt es laut ---------------------------------------------------
assert.throws(() => T.svgxRootBlock("body { color: red; }"), /kein :root/);
// 💣 Ein `:root` im KOMMENTAR ist kein Block. Genau daran ist die erste Fassung des Lesers
// vorbeigelaufen -- sie kam nur deshalb aufs richtige Ergebnis, weil die naechste `{`
// zufaellig die des echten Blocks war.
const mitFalle = '/* siehe :root[data-theme="dark"] */\n:root { --echt: #123; }';
assert.strictEqual(T.svgxTokenTafelAusCss(mitFalle)["--echt"], "#123",
	"der Selektor im Kommentar wird nicht fuer den Block gehalten");
// Und der Dunkelblock wird ebenso wenig aus dem Fliesstext geholt.
assert.throws(() => T.svgxDarkBlock('/* :root[data-theme="dark"] erklaert */\n:root{--a:#1;}'),
	/kein dunkel-Block/);
assert.throws(() => T.svgxRootBlock(":root { --a: #111;"), /nie geschlossen/);

console.log("tokens-tafel: ok");
