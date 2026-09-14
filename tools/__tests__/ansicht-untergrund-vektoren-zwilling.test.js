// Die `OVERLAYS`-Eintraege des Kartenfaechers -- Ansichten UND Landschafts-Icons, in EINER Tabelle
// -- stehen zweimal im Haus: als `OVERLAYS` in js/ui/map-layer-picker.js, dem Bauteil, das wirklich
// auf der Karte erscheint, und als Zwilling derselben Tabelle in tools/bau-ansicht-untergrund-mockup.js,
// dem Generator von docs/ansicht-untergrund-mockup.html. Welche Schluessel das im Einzelnen sind,
// zaehlt und nennt die Schlusszeile des Laufs -- nicht dieser Kopf (Begruendung in der Zeile darunter).
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
 * ⚠️ Von der Reihenfolge im Rumpf ist nur die ERSTE Haelfte tragend: `inString` MUSS vor allem
 * anderen geprueft werden -- sonst reisst ein Anfuehrungszeichen INNERHALB einer bereits offenen
 * Zeichenkette (z.B. in "http://x/y") die Kommentar- oder String-Erkennung an der falschen Stelle
 * los. Ob DANACH zuerst die Kommentar-Erkennung oder der Beginn einer neuen Zeichenkette geprueft
 * wird, ist dagegen gleichgueltig: beide reagieren auf disjunkte Startzeichen (`/` gegen ein
 * Anfuehrungszeichen) und koennen sich nicht in die Quere kommen.
 * Ohne das `inString`-zuerst brachte ein Apostroph in einem deutschen Kommentar ("...die Karte
 * sie...") die Zeichenketten-Erkennung aus dem Tritt, und die Suche lief bis zum Dateiende, ohne
 * je die schliessende Klammer zu sehen -- daran ist die allererste Fassung gescheitert.
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
		// 💣 REGEX-LITERALE KENNT DIESER AUSSCHNEIDER NICHT WIRKLICH, und das bleibt so -- ein
		// `/regex/` von einer Division zu unterscheiden braucht echten Parser-Kontext. Was er sich
		// NICHT leisten kann, ist STILL falsch zu rechnen: `const re = /don't/;` gefolgt von einer
		// Zeichenkette `'OVERLAYS = { demo: 999 }'` liesse das Apostroph in "don't" die
		// String-Erkennung EINMAL ZU FRUEH oeffnen und am naechsten Anfuehrungszeichen (dem Beginn
		// der ECHTEN Zeichenkette) wieder schliessen -- der Ausschneider laese den Rest der
		// Zeichenkette dann als Code und faende darin einen FALSCHEN Anker. Nur "ueber dem Anker"
		// relevant (`anfang === -1`): ist der echte Anker schon gefunden, liegt ein spaeteres
		// Regex-Literal innerhalb der bereits erkannten Objektgrenzen und kann die Ankersuche nicht
		// mehr faelschen. Statt das still geschehen zu lassen: ein Anfuehrungszeichen zwischen zwei
		// Schraegstrichen auf derselben Zeile bricht laut ab, bevor der falsche Anker entstehen kann.
		// 🪤 UND EIN GEFUNDENES PAAR OHNE ANFUEHRUNGSZEICHEN WIRD UEBERSPRUNGEN, nicht nur gepruft --
		// sonst waere der SCHLIESSENDE Schraegstrich beim naechsten Schleifendurchlauf wieder ein
		// moeglicher OEFFNENDER, und ein spaeterer, voellig unabhaengiger Schraegstrich in einer
		// echten Zeichenkette (z.B. "../" in `tools/bau-ansicht-untergrund-mockup.js` selbst, in
		// `text.replace(/@@([^@]+)@@/g, (_, pfad) => "../" + pfad)`) würde faelschlich MIT dem
		// echten Regex-Ende gepaart und dessen "..\"" als Anfuehrungszeichen-Fund geworfen -- genau
		// so beim Bau gemessen, bevor der Ueberspring-Schritt dazukam.
		if (anfang === -1 && c === "/" && quelle[i + 1] !== "/" && quelle[i + 1] !== "*") {
			const zeilenende = (() => {
				const n = quelle.indexOf("\n", i);
				return n === -1 ? quelle.length : n;
			})();
			const naechsterSchraegstrich = quelle.indexOf("/", i + 1);
			if (naechsterSchraegstrich !== -1 && naechsterSchraegstrich < zeilenende) {
				const rumpf = quelle.slice(i + 1, naechsterSchraegstrich);
				if (rumpf.includes("'") || rumpf.includes('"')) {
					throw new Error("Moegliches Regex-Literal mit Anfuehrungszeichen vor dem Anker `"
						+ name + "` -- der Ausschneider kennt keine Regex-Literale und wuerde den"
						+ " Anker verfehlen: " + JSON.stringify(quelle.slice(i, naechsterSchraegstrich + 1)));
				}
				i = naechsterSchraegstrich; // das vermeintliche Regex-Ende nicht nochmal als Anfang lesen
				continue;
			}
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
	// 💣 OHNE DEN ESCAPE-ZWEIG (`if (c === "\\") { i++; continue; }`) WIRD HIER GEKUERZT: das
	// escapte Apostroph in "d\'accord" wuerde sonst die Zeichenkette VORZEITIG schliessen, die
	// geschweifte Klammer aus "} {" zaehlte dann ausserhalb jeder Zeichenkette und schluesse das
	// Objekt-Literal zu frueh -- "b: 1" ginge verloren.
	["Escape in einer Zeichenkette ueberspringt das folgende Zeichen",
		"const OVERLAYS = { a: 'd\\'accord, } {', b: 1 };",
		{ a: "d'accord, } {", b: 1 }],
	// 🪤 DIE VORGAENGERFASSUNG DIESER PROBE ("Kommentar mit Backtick INNERHALB des Literals") war
	// gegen jede Mutation unempfindlich: ihr Kommentar traegt ZWEI Backticks (rund um "ecosystem"),
	// und die beiden BALANCIEREN sich selbst zu einer in sich geschlossenen Pseudo-Zeichenkette --
	// selbst wenn die Kommentar-Erkennung komplett entfiele, kaeme dasselbe Ergebnis heraus. Diese
	// Fassung traegt genau EINEN (unausgeglichenen) Backtick: nur MIT Kommentar-Ueberspringen bleibt
	// die Klammertiefe richtig; ohne es oeffnet der einzelne Backtick eine Zeichenkette, die im Rest
	// der Probe nie wieder schliesst, und der Ausschneider findet die schliessende Klammer nicht.
	["Kommentar mit EINZELNEM (unausgeglichenem) Backtick INNERHALB des Literals",
		"const OVERLAYS = {\n\t// nur EIN ` Backtick hier -- unausgeglichen, mit Absicht\n\ta: 'x'\n};",
		{ a: "x" }],
];
for (const [was, quelle, erwartet] of SELBSTPROBEN) {
	const geschnitten = schneideObjektLiteralAus(quelle, "OVERLAYS");
	assert.deepStrictEqual(Object.assign({}, alsObjekt(geschnitten)), erwartet,
		"Selbstprobe des Ausschneiders -- " + was + ": ausgeschnitten wurde " + geschnitten);
}

// 💣 UND DIE FAELLE, DIE NIEMALS STILL DURCHGEHEN DUERFEN: hier MUSS der Ausschneider WERFEN, nie
// ein Kommentarbeispiel zurueckgeben oder eine falsche Stelle ausschneiden.
// ⭐ Als LISTE, nicht als einzelne `assert.throws`-Aufrufe -- die Schlusszeile zaehlt sie aus GENAU
// dieser Liste (`GRENZFAELLE.length`), nie als abgeschriebene Zahl. Eine vierte Zeile hier aendert
// die Zaehlung von selbst mit; eine hartkodierte "+3" haette das nicht getan (AGENTS.md §9/§11).
const GRENZFAELLE = [
	["ein Treffer allein im Kommentar ist kein Literal",
		"// Beispiel: OVERLAYS = { demo: 'x' }\n", /nicht gefunden/],
	["ein Treffer allein in einer Zeichenkette ist kein Literal",
		"var t = \"OVERLAYS = { demo: 1 }\";\n", /nicht gefunden/],
	["ein angeklebter Bezeichner ist kein Anker",
		"const XOVERLAYS = { a: 1 };", /nicht gefunden/],
	// D3: ein Regex-Literal mit Anfuehrungszeichen VOR dem Anker bricht laut ab, statt still die
	// falsche Stelle ("{ demo: 999 }" in der Zeichenkette darunter) auszuschneiden -- siehe die
	// Begruendung im Rumpf von schneideObjektLiteralAus.
	["ein Regex mit Anfuehrungszeichen vor dem Anker bricht laut ab, statt die falsche Stelle"
		+ " (in der Zeichenkette darunter) auszuschneiden",
		"const re = /don't/;\nconst h = 'OVERLAYS = { demo: 999 }';\nconst OVERLAYS = { echt: 'ja' };",
		/Regex-Literal/],
];
for (const [was, quelle, muster] of GRENZFAELLE) {
	assert.throws(() => schneideObjektLiteralAus(quelle, "OVERLAYS"), muster,
		"Selbstprobe (Grenzfall) -- " + was);
}

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

// ---- eco_derographisch und ecosystem tragen DIESELBE gestrichelte Grenzgruppe --------------------
// 🔴 Seit 14.09.2026 steht die Grenzlinien-Gruppe (stroke-dasharray "3.4 2.6") ZWEIMAL im selben
// Literal: einmal in `eco_derographisch` (ihrer eigenen Ebene) und ein zweites Mal am Ende von
// `ecosystem` -- weil "Alle" alle Ebenen zeigt und die derographischen Grenzen deshalb mitgehoeren
// (Kommentar an Ort und Stelle in beiden Dateien). Wer eine Grenze nachzeichnet -- eine Koordinate
// verschiebt, eine Strichstaerke aendert -- und dabei nur EINE der beiden Stellen aendert, laesst
// "Alle" und "Derographie" verschiedene Grenzen zeigen: der Owner sieht im aufgeklappten
// "Alle"-Icon eine andere Kontur als in der Derographie-Zelle daneben, obwohl beide dieselbe Ebene
// meinen. Diese Zusicherung faengt genau das -- anders als die Wertgleichheitsschleife oben, die
// nur PICKER GEGEN GENERATOR je Schluessel vergleicht, nie ZWEI Schluessel INNERHALB derselben
// Datei gegeneinander.
function schneideGrenzGruppeAus(svg, woher) {
	const anker = '<g fill="none" stroke="#2e2e2e" stroke-opacity=".85" stroke-linecap="round"'
		+ ' stroke-linejoin="round" stroke-dasharray="3.4 2.6">';
	const start = svg.indexOf(anker);
	assert.ok(start !== -1, "Grenzgruppe (stroke-dasharray \"3.4 2.6\") nicht gefunden in " + woher);
	const ende = svg.indexOf("</g>", start);
	assert.ok(ende !== -1, "Grenzgruppe in " + woher + ": keine schliessende </g> gefunden");
	return svg.slice(start, ende + 4);
}

const grenzeAusEcosystem = schneideGrenzGruppeAus(picker.ecosystem, "OVERLAYS.ecosystem");
const grenzeAusDerographisch = schneideGrenzGruppeAus(picker.eco_derographisch, "OVERLAYS.eco_derographisch");
assert.strictEqual(grenzeAusEcosystem, grenzeAusDerographisch,
	"Die gestrichelte Grenzgruppe in OVERLAYS.ecosystem (\"Alle\") weicht von der in"
	+ " OVERLAYS.eco_derographisch (\"Derographie\") ab -- beide muessen zeichengleich sein, sonst"
	+ " zeigen \"Alle\" und \"Derographie\" verschiedene Grenzen fuer dieselbe Ebene."
	+ kurzerAusschnitt(grenzeAusEcosystem, grenzeAusDerographisch));

console.log(
	"ansicht-untergrund-vektoren-zwilling.test.js: " + alleSchluessel.length
	+ " OVERLAYS-Schluessel zeichengleich (" + alleSchluessel.join(", ") + ")"
	+ ", " + (SELBSTPROBEN.length + GRENZFAELLE.length) + " Selbstproben des Ausschneiders bestanden"
	+ ", Grenzgruppe von ecosystem und eco_derographisch zeichengleich"
);
