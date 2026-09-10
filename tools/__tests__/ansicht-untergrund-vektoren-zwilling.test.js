// Die `OVERLAYS`-Eintraege des Kartenfaechers -- die Ansichten (deregraphic/political/powerlines/
// ecosystem/none) und die Landschafts-Icons (eco_derographisch/eco_vegetation/eco_topographie/
// eco_klima) -- stehen zweimal im Haus: als `OVERLAYS` in js/ui/map-layer-picker.js, dem Bauteil,
// das wirklich auf der Karte erscheint, und als Zwilling derselben Tabelle in
// tools/bau-ansicht-untergrund-mockup.js, dem Generator von docs/ansicht-untergrund-mockup.html.
//
// 🔴 HIER STAND "die NEUN Eintraege" -- in genau der Datei, die eine solche Zahl dreissig Zeilen
// weiter unten verbietet und die Menge zur Laufzeit selbst zaehlt. Ein zehntes Overlay haette die
// erste Zeile lautlos falsch gemacht. Deshalb keine Zahl mehr; wer sie wissen will, liest die
// Schlusszeile des Laufs.
//
// Der Zwilling ist kein Versehen: der Generator ist ABHAENGIGKEITSFREI und laeuft unter Node
// (`node tools/bau-ansicht-untergrund-mockup.js`, siehe dessen Dateikopf). Der Picker dagegen ist
// eine IIFE, die am Dateiende sofort `document` anspricht -- ihn im selben Node-Prozess zu
// `require`n braeuchte einen DOM-Stub, den der Generator ausdruecklich nicht haben soll. Deshalb
// zwei Dateien, nicht eine gemeinsame.
//
// 💣 GENAU DAS IST DIE LUECKE, DIE DIESER TEST SCHLIESST: der Owner nimmt die Icons im MOCKUP ab,
// ausgeliefert wird der PICKER. Laufen beide auseinander, gibt der Owner ein Icon frei, das nie
// auf der Karte erscheint -- und es faellt niemandem auf, weil jede Seite fuer sich richtig
// aussieht. tools/__tests__/ansicht-untergrund-mockup.test.js haelt nur die eine Haelfte
// (Generator-Ausgabe == docs/ansicht-untergrund-mockup.html); eine Aenderung ALLEIN im Picker
// faellt dort nie auf, weil dieser Test den Picker gar nicht liest.
//
// ⭐ Verglichen werden die WERTE, nicht der Quelltext: beide `OVERLAYS`-Literale werden aus ihrer
// Datei ausgeschnitten und unter `vm` als echtes JS-Objekt ausgefuehrt (im Haus ueblich, siehe
// z.B. js/app/__tests__/kartendaten-speicher.test.js). Ein Quelltextvergleich braeche an jedem
// Zeilenumbruch und jeder Einrueckung, die inhaltlich nichts bedeuten -- der Picker haengt an
// einer Tab-Einrueckung in einer IIFE, der Generator an keiner.
//
// ⚠️ Geprueft werden ALLE gemeinsamen Schluessel, nicht nur die vier neuen -- ecosystem,
// deregraphic, political, powerlines und none stehen ebenfalls doppelt, und der Wasserton hat den
// ecosystem-Vektor schon einmal in BEIDEN Dateien anfassen muessen (09.09.2026, Owner: der See
// traegt seither dieselbe Farbe wie der Fluss). Die Schluesselmenge wird zur LAUFZEIT gezaehlt,
// nie als Zahl im Kommentar behauptet -- eine Zahl liest sich wie eine vollstaendige Liste, und
// niemand zaehlt nach (AGENTS.md §9/§11).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

/**
 * Schneidet ein Objekt-Literal `name = { ... }` aus Quelltext aus -- durch Klammertiefe, nicht
 * durch ein gieriges Regex bis zum naechsten `};`.
 *
 * 💣 EIN EINZIGER DURCHGANG, UND ER SUCHT AUCH DEN ANKER NUR AUSSERHALB VON KOMMENTAR UND
 * ZEICHENKETTE. Die Vorgaengerfassung uebersprang Kommentare beim ZAEHLEN, setzte ihren Anker aber
 * mit einem blanken `anker.exec(quelle)` auf das erste TEXTUELLE `name = {` -- auch auf eines in
 * einem Kommentar oder in einer Zeichenkette. Das ist hier nicht graue Theorie: die
 * Kommentarbloecke ueber `eco_derographisch` sind in Picker und Generator nahezu wortgleiche
 * Zwillinge, ein erklaerendes Beispiel landet also in BEIDEN -- dieser Test haette dann zwei
 * KOMMENTARE miteinander verglichen, waere GRUEN geblieben und haette die Vektoren auseinander-
 * laufen lassen. Genau das, was er verhindern soll. Festgenagelt von der Selbstprobe unten.
 *
 * ⚠️ Die Reihenfolge im Rumpf ist tragend: erst `inString`, dann die Kommentar-Erkennung, dann der
 * BEGINN einer Zeichenkette. Umgekehrt brachte ein Apostroph in einem deutschen Kommentar
 * ("...die Karte sie...") die Zeichenketten-Erkennung aus dem Tritt, und die Suche lief bis zum
 * Dateiende, ohne je die schliessende Klammer zu sehen -- daran ist die allererste Fassung
 * gescheitert.
 */
function schneideObjektLiteralAus(quelle, name) {
	// Sticky (`y`): trifft nur, wenn das Muster GENAU an `lastIndex` beginnt. So laesst sich der
	// Anker Position fuer Position pruefen, ohne je vorwaerts in einen Kommentar zu springen --
	// ein `g`-Regex oder ein blankes `exec` tut genau das. `\b` sieht dabei weiterhin das Zeichen
	// VOR lastIndex, `XOVERLAYS = {` ist also kein Treffer (Selbstprobe unten).
	const anker = new RegExp("\\b" + name + "\\s*=\\s*\\{", "y");
	let anfang = -1; // Index der oeffnenden Klammer des gesuchten Literals
	let tiefe = 0;
	let inString = null;
	for (let i = 0; i < quelle.length; i++) {
		const c = quelle[i];
		if (inString) {
			if (c === "\\") { i++; continue; } // Escape ueberspringen, z.B. \' oder \"
			if (c === inString) { inString = null; }
			continue;
		}
		if (c === "/" && quelle[i + 1] === "/") {
			const zeilenende = quelle.indexOf("\n", i);
			i = zeilenende === -1 ? quelle.length : zeilenende;
			continue;
		}
		if (c === "/" && quelle[i + 1] === "*") {
			const blockende = quelle.indexOf("*/", i + 2);
			i = blockende === -1 ? quelle.length : blockende + 1;
			continue;
		}
		// Der Backtick zaehlt mit: beide Dateien tragen Template-Strings, und der Generator baut
		// sein ganzes Mockup in EINEM -- ein `name = {` darin ist Text, kein Literal.
		if (c === "'" || c === '"' || c === "`") { inString = c; continue; }
		if (anfang === -1) {
			if (c !== name[0]) { continue; }
			anker.lastIndex = i;
			if (!anker.exec(quelle)) { continue; }
			anfang = anker.lastIndex - 1; // die oeffnende Klammer ist das letzte Zeichen des Ankers
			i = anfang - 1;               // sie selbst zaehlt die Schleife im naechsten Schritt
			continue;
		}
		if (c === "{") { tiefe++; continue; }
		if (c === "}") {
			tiefe--;
			if (tiefe === 0) {
				return quelle.slice(anfang, i + 1);
			}
		}
	}
	assert.ok(anfang !== -1, "Anker `" + name + " = {` nicht gefunden -- ein Treffer in einem"
		+ " Kommentar oder in einer Zeichenkette zaehlt bewusst nicht.");
	throw new Error("`" + name + "`: keine schliessende Klammer gefunden");
}

/** Fuehrt ein ausgeschnittenes Objekt-Literal in einem frischen Kontext aus und gibt es zurueck. */
function alsObjekt(literalText) {
	return vm.runInNewContext("(" + literalText + ")", {}, { timeout: 2000 });
}

// ---- Selbstprobe des Ausschneiders ---------------------------------------------------------------
// 🔴 OHNE DIESEN BLOCK IST DER GANZE TEST EINE BEHAUPTUNG. Er faehrt genau die Eingaben, an denen
// die Vorgaengerfassung STILL das Falsche verglichen hat -- ein Muster im Kommentar oder in einer
// Zeichenkette muss uebergangen werden, nie uebernommen. Die vier Faelle darunter sind die, an
// denen die allererste Fassung des Zaehlers gescheitert ist; sie bleiben mitgeprueft, damit eine
// Reparatur der einen Haelfte nicht die andere aufgibt.
// ⚠️ `Object.assign({}, …)` ist Pflicht: ein Objekt aus einem `vm`-Kontext traegt einen FREMDEN
// Object.prototype, und `deepStrictEqual` vergleicht den mit -- es faellt sonst bei inhaltlich
// gleichem Ergebnis (Hausfalle, AGENTS.md §11).
const SELBSTPROBEN = [
	["Kommentarbeispiel (Zeile) VOR dem echten Literal",
		"// Beispiel: OVERLAYS = { demo: 'x' }\nconst OVERLAYS = { echt: 'ja' };",
		{ echt: "ja" }],
	// 💣 DIESER FALL UNTERSCHEIDET sticky VON global, und er ist der Grund fuer das "y": ein
	// Bezeichner, der mit demselben Buchstaben beginnt, bringt den Scanner an eine Stelle, an der
	// das Muster NICHT steht. Ein "g"-Regex springt von dort VORWAERTS -- und landet im Kommentar.
	// Ohne diesen Fall ueberlebt die Ein-Zeichen-Mutation y -> g (nachgemessen 10.09.2026).
	["Bezeichner mit demselben Anfangsbuchstaben vor einem Kommentarbeispiel",
		"Object.keys(x);\n// Beispiel: OVERLAYS = { demo: 'x' }\nconst OVERLAYS = { echt: 'ja' };",
		{ echt: "ja" }],
	["Kommentarbeispiel (Block) VOR dem echten Literal",
		"/* so nicht: OVERLAYS = { demo: 'x' } */\nconst OVERLAYS = { echt: 'ja' };",
		{ echt: "ja" }],
	["Beispiel in einer Zeichenkette VOR dem echten Literal",
		"var hinweis = \"OVERLAYS = { demo: 1 }\";\nconst OVERLAYS = { echt: 'ja' };",
		{ echt: "ja" }],
	["Beispiel in einem Template-String VOR dem echten Literal",
		"var t = `OVERLAYS = { demo: 1 }`;\nconst OVERLAYS = { echt: 'ja' };",
		{ echt: "ja" }],
	["Apostroph in einem deutschen Kommentar",
		"// ...wie die Karte sie zeichnet, d'accord\nconst OVERLAYS = { a: 'x' };",
		{ a: "x" }],
	["geschweifte Klammer in einer Zeichenkette",
		"const OVERLAYS = { a: '</g>}{' };",
		{ a: "</g>}{" }],
	["doppeltes Anfuehrungszeichen in einfachen Anfuehrungszeichen",
		"const OVERLAYS = { a: '<path d=\"M0 0\"/>' };",
		{ a: "<path d=\"M0 0\"/>" }],
	["zwei Schraegstriche in einer Zeichenkette",
		"const OVERLAYS = { a: 'http://x/y' };",
		{ a: "http://x/y" }],
	["Kommentar mit Backtick INNERHALB des Literals",
		"const OVERLAYS = {\n\t// es nimmt `ecosystem` oben\n\ta: 'x'\n};",
		{ a: "x" }],
];
for (const [was, quelle, erwartet] of SELBSTPROBEN) {
	const geschnitten = schneideObjektLiteralAus(quelle, "OVERLAYS");
	assert.deepStrictEqual(Object.assign({}, alsObjekt(geschnitten)), erwartet,
		"Selbstprobe des Ausschneiders -- " + was + ": ausgeschnitten wurde " + geschnitten);
}

// 💣 UND DER FALL, DER NIEMALS STILL DURCHGEHEN DARF: steht das Muster NUR in einem Kommentar,
// muss der Ausschneider WERFEN -- nie das Kommentarbeispiel zurueckgeben.
assert.throws(() => schneideObjektLiteralAus("// Beispiel: OVERLAYS = { demo: 'x' }\n", "OVERLAYS"),
	/nicht gefunden/, "Selbstprobe: ein Treffer allein im Kommentar ist kein Literal");
assert.throws(() => schneideObjektLiteralAus("var t = \"OVERLAYS = { demo: 1 }\";\n", "OVERLAYS"),
	/nicht gefunden/, "Selbstprobe: ein Treffer allein in einer Zeichenkette ist kein Literal");
assert.throws(() => schneideObjektLiteralAus("const XOVERLAYS = { a: 1 };", "OVERLAYS"),
	/nicht gefunden/, "Selbstprobe: ein angeklebter Bezeichner ist kein Anker");

// ---- Die beiden echten Tabellen ------------------------------------------------------------------
const pickerQuelle = lies("js", "ui", "map-layer-picker.js");
const generatorQuelle = lies("tools", "bau-ansicht-untergrund-mockup.js");

const picker = alsObjekt(schneideObjektLiteralAus(pickerQuelle, "OVERLAYS"));
const generator = alsObjekt(schneideObjektLiteralAus(generatorQuelle, "OVERLAYS"));

// ---- Schluesselmenge: BEIDE Seiten muessen dieselben Ebenen kennen -------------------------------
const alleSchluessel = Array.from(
	new Set(Object.keys(picker).concat(Object.keys(generator)))
).sort();

assert.ok(alleSchluessel.length > 0, "OVERLAYS ist in keiner der beiden Dateien leer");

const nurImPicker = alleSchluessel.filter((k) => !(k in generator));
const nurImGenerator = alleSchluessel.filter((k) => !(k in picker));

assert.deepStrictEqual(nurImPicker, [],
	"js/ui/map-layer-picker.js kennt Ebenen, die im Generator-Zwilling"
	+ " (tools/bau-ansicht-untergrund-mockup.js) fehlen: " + nurImPicker.join(", ")
	+ " -- der Owner sieht diese Icons im Mockup nie, obwohl sie auf der Karte erscheinen.");

assert.deepStrictEqual(nurImGenerator, [],
	"tools/bau-ansicht-untergrund-mockup.js kennt Ebenen, die es im ausgelieferten Picker"
	+ " (js/ui/map-layer-picker.js) nicht gibt: " + nurImGenerator.join(", ")
	+ " -- der Owner nimmt hier ein Icon ab, das nie auf der Karte erscheint.");

// ---- Wertgleichheit je gemeinsamem Schluessel ----------------------------------------------------
function kurzerAusschnitt(a, b) {
	let i = 0;
	const n = Math.min(a.length, b.length);
	while (i < n && a[i] === b[i]) { i++; }
	const spanne = 24;
	const schnitt = (t) => JSON.stringify(t.slice(Math.max(0, i - 8), i + spanne));
	return "\n  ab Zeichen " + i + " (Laenge " + a.length + " gegen " + b.length + "):"
		+ "\n  Picker:    " + schnitt(a)
		+ "\n  Generator: " + schnitt(b);
}

for (const schluessel of alleSchluessel) {
	const wertPicker = picker[schluessel];
	const wertGenerator = generator[schluessel];
	assert.strictEqual(typeof wertPicker, "string", "OVERLAYS." + schluessel + " ist im Picker ein String");
	assert.strictEqual(typeof wertGenerator, "string", "OVERLAYS." + schluessel + " ist im Generator ein String");
	assert.ok(wertPicker === wertGenerator,
		"OVERLAYS." + schluessel + " weicht zwischen js/ui/map-layer-picker.js und"
		+ " tools/bau-ansicht-untergrund-mockup.js ab -- der Owner nimmt im Mockup ein anderes"
		+ " Icon ab, als der Picker tatsaechlich zeichnet."
		+ kurzerAusschnitt(wertPicker, wertGenerator));
}

console.log(
	"ansicht-untergrund-vektoren-zwilling.test.js: " + alleSchluessel.length
	+ " OVERLAYS-Schluessel zeichengleich (" + alleSchluessel.join(", ") + ")"
	+ ", " + (SELBSTPROBEN.length + 3) + " Selbstproben des Ausschneiders bestanden"
);
