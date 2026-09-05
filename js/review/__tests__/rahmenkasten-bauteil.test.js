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

// ---- 7. Der Routenplaner: zwei klappbare Gruppen am Bauteil ----------------------------------
{
	const html = lies("index.html");
	assert.strictEqual((html.match(/class="planner-group avm-rahmen/g) || []).length, 1,
		"die Transportmittel-Gruppe traegt das Bauteil an der HUELLE");
	assert.strictEqual((html.match(/planner-group avm-rahmen planner-group--open/g) || []).length, 2,
		"beide Gruppen tragen es -- die Kopfklasse allein reicht nicht, dann fehlt der Rahmen ganz");
	assert.strictEqual((html.match(/class="planner-group__head avm-rahmen__kopf"><span class="avm-rahmen__schrift">/g) || []).length, 2,
		"und beide Koepfe ihren inline-Lauf");
	// 💣 Pfeil, Titel UND das ⓘ liegen IM Lauf -- nur dann traegt sein Grund sie mit, und nur dann
	//    wandern sie beim Klappen gemeinsam und ausschliesslich senkrecht.
	// 🪤 NICHT der erste Lauf im Dokument -- der gehoert dem Meldeformular. Angesetzt wird am
	//    Kopf DIESER Gruppe.
	["transport-options-body", "route-planner-options-body"].forEach((controls) => {
		const ab = html.indexOf('aria-controls="' + controls + '"');
		assert.ok(ab > 0, controls + " steht im Markup");
		const kopfAnfang = html.lastIndexOf('class="planner-group__head', ab);
		const lauf = html.slice(kopfAnfang, html.indexOf("</span></div>", ab));
		["avm-rahmen__schrift", "planner-group__caret", "avm-rahmen__titel", "tsi-info-btn",
			"planner-group__summary"]
			.forEach((k) => assert.ok(lauf.indexOf(k) >= 0, controls + ": " + k + " liegt im Lauf"));
		// Und die Reihenfolge: das ⓘ steht VOR der Zusammenfassung, sonst schoebe deren Breite
		// es beim Klappen seitlich.
		assert.ok(lauf.indexOf("tsi-info-btn") < lauf.indexOf("planner-group__summary"),
			controls + ": das ⓘ steht vor der Zusammenfassung");
	});
}

// ---- 8. `--avm-rahmen-pad` traegt IMMER eine Einheit -----------------------------------------
// 💣 Ein einheitenloses `0` ist eine ZAHL. `calc(-1 * 0 - 0.5lh)` mischt Zahl mit Laenge, ist
//    damit ungueltig, und die GANZE margin-Deklaration des Kopfes faellt weg -- die Aufschrift
//    rutscht von der Linie (gemessen 9,17px daneben), und nichts wird rot. Der einzige Hinweis
//    ist der Blick im Browser, und den hat man beim naechsten Mal nicht.
{
	const blaetter = ["css/components/rahmenkasten.css", "css/features/route-planner.css",
		"css/features/feature-sources.css", "css/components/location-report-dialog.css"];
	blaetter.forEach((f) => {
		const css = ohneKommentare(lies(f));
		const werte = Array.from(css.matchAll(/--avm-rahmen-pad:\s*([^;]+);/g)).map((m) => m[1].trim());
		werte.forEach((w) => assert.ok(/^var\(|[a-z%]$/.test(w),
			f + ": --avm-rahmen-pad ohne Einheit (`" + w + "`) -- `0` ist eine Zahl, nicht `0px`"));
	});
}

// ---- 9. Keine zweite Aufschriften-Rezeptur ueberstimmt die Planer-Titel ----------------------
// 💣 Sie standen in einer Regel mit `.route-plan-legs__title`, gedaempft und SPAETER in der Datei
//    -- gleiche Spezifitaet, und dann gewinnt die letzte. Der Titel war 11px/700 und trotzdem
//    grau statt goldbraun.
// 💣 Und die Fuellung der zugeklappten Leiste braucht die KENNUNG im Selektor: die Grundregel
//    spricht `#transport-options` an (1,0,0) und schlaegt jede reine Klasse.
{
	const css = ohneKommentare(lies("css/features/route-planner.css"));
	["transport-options__title", "route-planner-options-panel__title"].forEach((k) => {
		assert.ok(!new RegExp("\." + k + "\s*[,{]").test(css),
			"." + k + " hat keine eigene Aufschriften-Regel mehr -- die kommt vom Bauteil");
	});
	// 🪤 Die Hellung beim Ueberfahren traegt denselben Zustandsnamen und setzt ebenfalls
	//    `background` -- gesucht ist die Regel OHNE `:has(`.
	const fuellungen = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
		.filter((m) => /planner-group--collapsed/.test(m[1]) && /background:/.test(m[2])
			&& !/:has\(/.test(m[1]));
	assert.strictEqual(fuellungen.length, 1, "genau eine Regel fuellt die zugeklappte Leiste");
	assert.ok(/#transport-options\.planner-group--collapsed/.test(fuellungen[0][1]),
		"und zwar mit der Kennung im Selektor, sonst greift es nur bei einer der zwei Gruppen: "
		+ fuellungen[0][1].trim());
	// Die Grundregel der Anzeigeoptionen darf die zwei Gruppen NICHT mehr mitnehmen -- ihr
	// `border: 0` schlug den Rahmen des Bauteils restlos (drei Seiten 0px, oben Divider).
	const grund = css.match(/\.display-options\s*([,{])/);
	assert.ok(grund && grund[1] === "{",
		"`.display-options` steht allein -- mit `#transport-options` daneben nimmt ihr `border: 0` "
		+ "dem Rahmenkasten drei Seiten weg");
}

// ---- 10. K2: zugeklappt steht die Aufschrift IN der Leiste, nicht auf ihrem Rahmen -----------
// 💣 DER FEHLER, GEGEN DEN DAS HIER STEHT (04. -> 05.09.2026, live, vom Owner gemeldet). Das
//    Bauteil hebt den Kopf um `calc(-1 * pad - 0.5lh)` -- damit sitzt die Aufschrift AUF der
//    Rahmenlinie, und genau das ist aufgeklappt richtig. Zugeklappt ist der Kasten eine Leiste und
//    hat dort keine Linie mehr: der negative Rand liess die Aufschrift 0,92px ueber die Oberkante
//    ragen, wo ihr eigener Grund den Rahmen LOESCHTE (er sah zerschnitten aus, rechts blieb ein
//    Stummel), Titelmitte 7,19px in einer 28,58px hohen Leiste, darunter 13,28px Luft.
// 🪤 UND DIE LEISTE MASS DABEI DIE ZUGESAGTEN 28px: negativer Rand oben und `margin-bottom` unten
//    hoben sich in der HOEHE gerade auf. Die abgenommene Zahl war die Summe zweier Fehler --
//    deshalb prueft dieser Abschnitt die LAGE (kein negativer Rand mehr, kein maskierender Grund)
//    und nicht die Hoehe.
// 🔴 Der Mockup-Vertrag nennt die Lage: `margin: var(--space-4) 0 var(--space-4) 3px`
//    (docs/rahmenkasten-mockup.html, .k2). Gemessen nach der Korrektur: dx 0, dy 14,25 -- genau
//    die Zahl, die docs/design-language.md §Rahmenkasten seit dem 04.09.2026 zusagt.
{
	const css = ohneKommentare(lies("css/features/route-planner.css"));
	const regeln = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
		.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));

	const leiste = regeln.filter((r) => /\.planner-group--collapsed\s+\.planner-group__head\s*$/.test(r.sel));
	assert.strictEqual(leiste.length, 1, "genau eine Regel formt die zugeklappte Leiste");
	const rand = leiste[0].rumpf.match(/(?:^|;)\s*margin:\s*([^;]+)/);
	assert.ok(rand, "sie setzt einen eigenen `margin` -- ohne ihn gilt der NEGATIVE des Bauteils weiter");
	assert.ok(!/-|calc\(/.test(rand[1]),
		"und zwar ohne negativen Anteil: `" + rand[1].trim() + "` -- ein `calc(-…)` hier ist der Fehler von 04.09.2026");
	assert.ok(/cursor:\s*pointer/.test(leiste[0].rumpf),
		"die ganze Leiste traegt die Zeigerhand, nicht nur der Schalter darin");

	// Der Grund der Aufschrift maskiert eine LINIE. In der Leiste gibt es keine -- er ist dort ein Fleck.
	const gruende = regeln.filter((r) => /planner-group--collapsed/.test(r.sel) && /--avm-rahmen-grund/.test(r.rumpf));
	assert.strictEqual(gruende.length, 1, "genau eine Regel setzt den Grund der zugeklappten Aufschrift");
	assert.ok(/transparent/.test(gruende[0].rumpf),
		"und zwar auf `transparent`: " + gruende[0].rumpf.trim());
	assert.ok(/\.avm-rahmen\.planner-group--collapsed/.test(gruende[0].sel),
		"auf (0,2,0) wie beim offenen Zustand -- das Bauteil setzt den Vorgabewert am SELBEN Element, "
		+ "auf gleicher Spezifitaet entschiede die Ladereihenfolge: " + gruende[0].sel);
}

// ---- 11. Aufgeklappt ist nur die AUFSCHRIFT der Schalter -------------------------------------
// 💣 Der Kopf ist ein Block ueber die volle Breite, den der negative Rand ueber den Kasten hebt.
//    Gemessen 05.09.2026: 325px breit, 17,1px hoch, davon 7,4px AUSSERHALB des Rahmens -- ein
//    Klick in die Luecke ueber dem Kasten klappte die Gruppe zu, ohne Zeigerhand und ohne Hellung.
// 🔴 Zugeklappt gilt das Gegenteil und muss gelten: dort IST die Leiste der Knopf. Ihre Hellung
//    haengt deshalb am `:hover` DES KOPFES -- an `:has(.planner-group__toggle:hover)` hellte sie
//    nur ueber den Woertern, waehrend der Klick auf der ganzen Leiste wirkte. Rueckmeldung und
//    Klickflaeche sind dieselbe Flaeche.
{
	const css = ohneKommentare(lies("css/features/route-planner.css"));
	const regeln = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
		.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));

	const stumm = regeln.filter((r) => /\.planner-group--open\s+\.planner-group__head\s*$/.test(r.sel)
		&& /pointer-events:\s*none/.test(r.rumpf));
	assert.strictEqual(stumm.length, 1,
		"der aufgeklappte Kopf nimmt keine Zeiger an -- sonst ist der unsichtbare Streifen zurueck");
	const laut = regeln.filter((r) => /\.planner-group--open\s+\.planner-group__head\s+\.avm-rahmen__schrift/.test(r.sel)
		&& /pointer-events:\s*auto/.test(r.rumpf));
	assert.strictEqual(laut.length, 1,
		"…und der Lauf darin nimmt sie wieder an -- ohne diese Zeile klappt aufgeklappt GAR NICHTS mehr");

	const hellung = regeln.filter((r) => /planner-group--collapsed/.test(r.sel)
		&& /background:\s*var\(--color-hover-wash\)/.test(r.rumpf));
	assert.strictEqual(hellung.length, 1, "eine Regel hellt die zugeklappte Leiste");
	assert.ok(/\.planner-group__head:hover/.test(hellung[0].sel),
		"und zwar am Kopf selbst, nicht nur ueber den Woertern des Schalters: " + hellung[0].sel);
}

// ---- 12. Der Rhythmus des Panels gehoert #search, nicht dem Bauteil --------------------------
// 💣 `.avm-rahmen + .avm-rahmen` legt 14px Stapelrand auf, und in einer Flex-Spalte kommt der zum
//    `gap` HINZU. Gemessen 05.09.2026: 19px zwischen den zwei Einstellgruppen gegen 5px ueberall
//    sonst -- und zwar nur beim ZWEITEN Kasten, weil das `margin: 0` der Gruppenregel die Kennung
//    `#transport-options` (1,0,0) traegt und an `.route-planner-options-panel` (0,1,0) verlor.
{
	const css = ohneKommentare(lies("css/features/route-planner.css"));
	const regeln = Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))
		.map((m) => ({ sel: m[1].trim(), rumpf: m[2] }));
	const aufheber = regeln.filter((r) => /\.planner-group[^,{]*\+\s*\.planner-group/.test(r.sel)
		&& /margin-top:\s*0/.test(r.rumpf));
	assert.strictEqual(aufheber.length, 1,
		"eine Regel nimmt den Stapelrand des Bauteils zwischen den zwei Gruppen zurueck");
	assert.ok((aufheber[0].sel.match(/\.avm-rahmen/g) || []).length === 2,
		"auf (0,4,0), damit weder Kennung noch Ladereihenfolge entscheidet: " + aufheber[0].sel);

	// Und der Abstand selbst steht als Token an EINER Stelle -- eine nackte Zahl dort ist genau
	// die Skala, an der sich die Kaesten spaeter wieder vorbeimogeln.
	const layout = ohneKommentare(lies("css/layout/map-layout.css"));
	const suche = layout.match(/#search\s*\{([^}]*)\}/);
	assert.ok(suche, "#search steht in css/layout/map-layout.css");
	const gap = suche[1].match(/(?:^|;)\s*gap:\s*([^;]+)/);
	assert.ok(gap && /^var\(--space-/.test(gap[1].trim()),
		"der Abstand des Panels ist ein Token der Skala, keine gegriffene Zahl: " + (gap ? gap[1].trim() : "keiner"));
}

console.log("OK -- der Rahmenkasten haengt dran, die Kopplungen sind benannt, K2 steht IN der Leiste.");
