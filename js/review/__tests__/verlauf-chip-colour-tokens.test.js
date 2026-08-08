// 🔴 Die „+/−"-Chips des Verlaufsvergleichs holen ihre Farbe aus Tokens, nie aus einem Inline-Style.
//
// Bis 2026-08-08 schrieb renderVerlaufCase zwei rohe Hex-Werte direkt ins Markup
// (`style="color:#2f6b3a;border-color:#8fa46d;"` und das rote Gegenstueck). Das war doppelt falsch:
// AGENTS.md §12 verbietet die hartkodierte Farbe ueberhaupt, und praktisch hat ein Inline-Style keine
// data-theme-Variante — im Dunkelmodus stand Dunkelgruen/Dunkelrot auf dunklem Grund. Seit der
// Umstellung von .region-sync__cand auf die Pill-Tokens (101c00bc, 07.08.) ueberschrieben die beiden
// Zeilen ausserdem genau die Farbgebung, die dort gerade geordnet worden war.
//
// 💣 WARUM ALS QUELLTEXT-PRUEFUNG: review-path-sync.js ist ein Browser-Global-Skript, das beim Laden
// `document.addEventListener` und `attachFilterMenu(...)` ruft — renderVerlaufCase ist ohne DOM und
// angemeldeten Editor nicht aufrufbar. Und es ist die Sorte Regel, die beim naechsten „schnell mal
// einfaerben" lautlos zurueckfaellt, weil ein Inline-Style sofort wirkt und erst im Dunkelmodus auffaellt.
//
// 💣 Kommentare werden VOR jeder Zaehlung entfernt: diese Datei und die geprueften Dateien nennen die
// alten Hex-Werte selbst. Ohne den Schnitt zertifiziert der Test die Prosa statt des Codes — die Falle,
// die in api/_internal/app/changelog.php dreimal hintereinander zugeschnappt ist (AGENTS.md §11).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/verlauf-chip-colour-tokens.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** Blockkommentare und ganze Kommentarzeilen raus — nur ausfuehrbarer Code bleibt uebrig. */
function code(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
}

const jsSource = code(read("js", "review", "review-path-sync.js"));
const cssSource = code(read("css", "components", "region-sync.css"));

// ---------------------------------------------------------------------------
// 1. Kein Inline-Style im Markup dieser Datei — nicht nur „keiner mit einer Farbe".
//    Ein `style="..."` ist hier immer der falsche Ort: die Datei baut ausschliesslich Markup fuer
//    Klassen, die in region-sync.css / review-panel.css stehen.
// ---------------------------------------------------------------------------
const inlineStyles = jsSource.match(/style\s*=\s*\\?["'][^"'`]*/g) || [];
assert.deepStrictEqual(
	inlineStyles,
	[],
	`review-path-sync.js darf kein Inline-style im Markup tragen, gefunden: ${inlineStyles.join(" | ")}`
);

// Und generell keine Hex-Farbe irgendwo im Code der Datei (auch nicht in einem Objekt-Literal).
const hexColours = jsSource.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
assert.deepStrictEqual(
	hexColours,
	[],
	`review-path-sync.js darf keine Hex-Farbe hartkodieren (AGENTS.md §12), gefunden: ${hexColours.join(", ")}`
);

// ---------------------------------------------------------------------------
// 2. Die Chips benutzen die Modifier — sonst waeren die CSS-Regeln tot.
// ---------------------------------------------------------------------------
assert.ok(
	/class="region-sync__cand region-sync__cand--add"/.test(jsSource),
	"der Hinzugefuegt-Chip muss region-sync__cand--add tragen"
);
assert.ok(
	/class="region-sync__cand region-sync__cand--remove"/.test(jsSource),
	"der Entfernt-Chip muss region-sync__cand--remove tragen"
);

// ---------------------------------------------------------------------------
// 3. …und die Modifier existieren im Stylesheet, mit Tokens statt Literalen.
//    Die :hover-Regel gehoert dazu: `.region-sync__cand:hover` (0,2,0) schlaegt einen Modifier
//    allein (0,1,0) und faerbte den Chip beim Ueberfahren sonst braun um.
// ---------------------------------------------------------------------------
function ruleBody(selector) {
	const match = new RegExp(`${selector.replace(/[.:]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(cssSource);
	assert.ok(match, `Regel ${selector} fehlt in css/components/region-sync.css`);
	return match[1];
}

[
	[".region-sync__cand--add", "success"],
	[".region-sync__cand--remove", "danger"],
].forEach(([selector, family]) => {
	[selector, `${selector}:hover`].forEach((rule) => {
		const body = ruleBody(rule);
		const literals = body.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) || [];
		assert.deepStrictEqual(
			literals,
			[],
			`${rule} muss Tokens benutzen, keine Literale: ${literals.join(", ")}`
		);
		assert.ok(
			new RegExp(`var\\(--color-${family}`).test(body),
			`${rule} muss aus der ${family}-Tokenfamilie kommen`
		);
	});
	// Der Modifier steht NACH der Grundregel — sonst gewaenne .region-sync__cand bei gleicher
	// Spezifitaet (beide 0,1,0) und der Chip bliebe in der Pill-Farbe.
	assert.ok(
		cssSource.indexOf(".region-sync__cand {") < cssSource.indexOf(`${selector} {`),
		`${selector} muss nach der Grundregel .region-sync__cand stehen`
	);
});

// ---------------------------------------------------------------------------
// 4. Die benutzten Tokens haben eine Dunkelmodus-Fassung — das war ja der ganze Punkt.
// ---------------------------------------------------------------------------
// 💣 Erst Kommentare weg, dann suchen — und auf die REGEL ankern, nicht auf eine Erwaehnung.
// Die erste Fassung nahm `tokens.search(/\[data-theme="dark"\]/)` auf dem Rohtext und traf damit
// tokens.css:9, einen Kommentar 470 Zeilen VOR dem Block. „darkBlock" war dann die ganze Datei
// samt Hellwerten, und das Entfernen eines Dunkel-Tokens blieb gruen. Genau die Falle aus AGENTS.md
// §11 („beim Quelltext-Test ist die Prosa Teil des Suchraums") — hier von der Mutationsprobe gefangen.
const tokens = code(read("css", "base", "tokens.css"));
const darkRule = /:root\[data-theme\s*=\s*["']dark["']\]\s*\{/.exec(tokens);
assert.ok(darkRule, "tokens.css hat keine :root[data-theme=\"dark\"]-Regel (mehr)?");
const darkBlock = tokens.slice(darkRule.index + darkRule[0].length);
[
	"--color-success-soft",
	"--color-success-soft-border",
	"--color-success-soft-text",
	"--color-danger-soft",
	"--color-danger-soft-border",
	"--color-danger-soft-text",
].forEach((token) => {
	assert.ok(
		new RegExp(`${token}\\s*:`).test(darkBlock),
		`${token} braucht eine Dunkelmodus-Fassung, sonst ist der Umbau wirkungslos`
	);
});

console.log("verlauf-chip-colour-tokens: alle Zusicherungen gruen");
