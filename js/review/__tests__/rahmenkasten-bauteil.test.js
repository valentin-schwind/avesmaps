// DER RAHMENKASTEN als geteiltes Bauteil -- haengt er wirklich dran, und ist die Kopplung benannt?
//
// Owner 04.09.2026: „alle varianten aus 'Vorschlag' ok". Regelwerk docs/design-language.md
// §Rahmenkasten, Vertrag docs/rahmenkasten-mockup.html -> css/components/rahmenkasten.css.
//
// 💣 WOGEGEN DIESER TEST STEHT. Der Vertrag prueft, dass die DEKLARATIONEN im Blatt stehen -- er
//   sieht nicht, ob irgendjemand sie benutzt. Ein Markup ohne `.avm-rahmen` liesse ihn gruen und
//   den Kasten unformatiert; ein zweiter `.fs-scope { border … }` daneben ebenso, und der waere
//   genau die Divergenz, gegen die das Bauteil gebaut wurde.
// 🔴 Und die zwei Stellschrauben muessen GELESEN werden: steht im Rand des Kopfes eine feste
//   Pixelzahl statt `var(--avm-rahmen-pad)`, rutscht die Aufschrift von der Linie, sobald jemand
//   das Polster aendert -- lautlos. Genau so ist die geerbte `-17px` entstanden.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/rahmenkasten-bauteil.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// ---- 1. Der Bauer wird AUSGEFUEHRT, nicht gelesen ---------------------------------------------
// Ein Regex kennt keinen Geltungsbereich; gemessen wird, was wirklich herauskommt.
{
	const kontext = { window: {}, document: undefined };
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(lies("js/ui/feature-source-markup.js"), kontext);
	vm.runInContext(lies("js/review/review-feature-sources.js"), kontext);

	const rahmen = kontext.avesmapsSourceScopeFrame({
		titel: "Gilt für den ganzen Korpus",
		reichweite: "— welcher, sagt die Adresse",
		felder: "<div>x</div>",
	});

	assert.ok(/class="fs-scope avm-rahmen"/.test(rahmen), "die Huelle traegt das Bauteil");
	assert.ok(/class="fs-scope__head avm-rahmen__kopf"/.test(rahmen), "der Kopf traegt das Bauteil");
	assert.ok(/class="avm-rahmen__schrift"/.test(rahmen),
		"der inline-Lauf ist da -- ohne ihn loescht eine zweite Titelzeile die Oberkante");
	assert.ok(/class="fs-scope__title avm-rahmen__titel"/.test(rahmen), "der Titel traegt das Bauteil");
	assert.ok(/class="fs-scope__reach avm-rahmen__zusatz"/.test(rahmen), "der Zusatz traegt das Bauteil");

	// Der Lauf muss den Titel UMSCHLIESSEN, nicht danebenstehen: nur dann traegt sein Grund ihn.
	const aufLauf = rahmen.indexOf('class="avm-rahmen__schrift"');
	const aufTitel = rahmen.indexOf('class="fs-scope__title');
	const zuLauf = rahmen.indexOf("</span></div>", aufLauf);
	assert.ok(aufLauf >= 0 && aufTitel > aufLauf && zuLauf > aufTitel,
		"der Titel liegt IM Lauf");

	// Ohne Reichweite darf kein leerer Zusatz entstehen.
	const schmal = kontext.avesmapsSourceScopeFrame({ titel: "Gelände", felder: "" });
	assert.ok(!/avm-rahmen__zusatz/.test(schmal), "ohne Reichweite kein Zusatz");
}

// ---- 2. Die zwei Stellschrauben werden GELESEN, nicht abgeschrieben ----------------------------
{
	const css = ohneKommentare(lies("css/components/rahmenkasten.css"));

	const kopf = css.match(/\.avm-rahmen__kopf\s*\{([^}]*)\}/);
	assert.ok(kopf, ".avm-rahmen__kopf steht im Blatt");
	assert.ok(/margin:\s*calc\(-1 \* var\(--avm-rahmen-pad\) - 0\.5lh\)/.test(kopf[1]),
		"der negative Rand ist gerechnet (-Polster - 0.5lh), keine feste Zahl: " + kopf[1].trim());
	assert.ok(!/margin:\s*-?\d+px/.test(kopf[1]),
		"und ausdruecklich KEINE Pixelzahl -- genau so ist die geerbte -17px entstanden");
	// `lh` luegt, sobald ein inline-Kind eine groessere eigene Zeilenhoehe hat.
	assert.ok(/font-size:/.test(kopf[1]) && /line-height:/.test(kopf[1]),
		"der Kopf setzt Schriftgroesse UND Zeilenhoehe selbst -- sonst misst `lh` etwas anderes");

	const schrift = css.match(/\.avm-rahmen__schrift\s*\{([^}]*)\}/);
	assert.ok(schrift, ".avm-rahmen__schrift steht im Blatt");
	assert.ok(/background:\s*var\(--avm-rahmen-grund\)/.test(schrift[1]),
		"der Grund der Aufschrift kommt aus der Stellschraube, nicht als Farbe abgeschrieben");
	assert.ok(/display:\s*inline\s*;/.test(schrift[1]) && /box-decoration-break:\s*clone/.test(schrift[1]),
		"inline + box-decoration-break -- der Grund folgt jeder Zeile EINZELN");

	const huelle = css.match(/\.avm-rahmen\s*\{([^}]*)\}/);
	assert.ok(/padding:\s*var\(--avm-rahmen-pad\)/.test(huelle[1]),
		"der Kasten polstert ueber dieselbe Stellschraube, die der Kopf liest");
}

// ---- 3. KEINE zweite Rezeptur daneben ---------------------------------------------------------
// Die Divergenz kommt nicht durch eine falsche Regel, sondern durch eine zusaetzliche.
{
	const css = ohneKommentare(lies("css/features/feature-sources.css"));
	const eigen = css.match(/(^|\})\s*\.fs-scope\s*\{([^}]*)\}/);
	if (eigen) {
		["border", "border-radius", "padding", "position"].forEach((p) => {
			assert.ok(!new RegExp("(^|;)\s*" + p + "\s*:").test(eigen[2]),
				"feature-sources.css setzt `" + p + "` an .fs-scope zum zweiten Mal: " + eigen[2].trim());
		});
	}
	assert.ok(!/\.fs-scope__head\s*\{/.test(css),
		"kein zweiter .fs-scope__head -- der Kopf gehoert dem Bauteil");
	assert.ok(!/\.fs-scope__title\s*\{/.test(css),
		"kein zweiter .fs-scope__title -- die Aufschrift gehoert dem Bauteil");
}

// ---- 4. Jede Seite, die den Quellen-Kasten montiert, laedt auch das Bauteil --------------------
// 💣 Sonst steht der Kasten dort UNFORMATIERT, und zwar nur dort -- der Fehler, den man beim
//    Bauen nie sieht, weil man auf einer der anderen sieben Seiten arbeitet.
{
	const seiten = ["index.html"].concat(
		fs.readdirSync(path.join(WURZEL, "html")).filter((n) => n.endsWith(".html")).map((n) => "html/" + n));
	const fehlt = [];
	seiten.forEach((p) => {
		const html = lies(p);
		if (!/css\/features\/feature-sources\.css/.test(html)) { return; }
		if (!/css\/components\/rahmenkasten\.css/.test(html)) { fehlt.push(p); }
	});
	assert.deepStrictEqual(fehlt, [],
		"diese Seiten laden das Quellen-Blatt ohne den Rahmenkasten: " + fehlt.join(", "));
}

// ---- 5. Das Meldeformular: drei Abschnitte, EIN Bauteil -------------------------------------
{
	const html = lies("index.html");
	const huellen = html.match(/class="report-section avm-rahmen"/g) || [];
	assert.strictEqual(huellen.length, 3, "alle drei Abschnitte tragen das Bauteil");
	const laeufe = html.match(/class="report-section__head avm-rahmen__kopf"><span class="avm-rahmen__schrift">/g) || [];
	assert.strictEqual(laeufe.length, 3, "und jeder seinen inline-Lauf");
	assert.ok(!/<div class="report-section__title"/.test(html),
		"kein Titel mehr ausserhalb des Laufs -- dort traegt ihn der Grund nicht");
}

// ---- 6. Die Stellschraube des Wirts darf NICHT an der Ladereihenfolge haengen ----------------
// 💣 Bauteil und Wirt setzen dieselbe Variable am DEMSELBEN Element. Auf gleicher Spezifitaet
//    entscheidet allein, welches Blatt spaeter laedt -- heute geht es gut, und ein Umsortieren
//    der <link>-Zeilen kippt es lautlos (sichtbar als heller Streifen quer durch die Linie).
{
	const css = ohneKommentare(lies("css/components/location-report-dialog.css"));
	const treffer = css.match(/([^{}]*)\{[^}]*--avm-rahmen-grund[^}]*\}/);
	assert.ok(treffer, "der Meldedialog setzt --avm-rahmen-grund");
	const sel = treffer[1].trim();
	assert.ok(/\.report-section\.avm-rahmen/.test(sel),
		"und zwar auf (0,2,0) statt (0,1,0), damit die Ladereihenfolge nichts entscheidet: " + sel);
	assert.ok(/--avm-rahmen-grund:\s*var\(--color-panel\)/.test(treffer[0]),
		"mit dem Grund des Fensterrumpfs -- live gemessen, hell wie dunkel zeichengleich");
}

console.log("OK -- der Rahmenkasten haengt dran, die Kopplungen sind benannt, keine zweite Rezeptur.");
