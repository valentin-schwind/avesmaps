"use strict";

// Die Kette der Geländeregler: Markup ↔ TERRAIN_FIELDS ↔ Speichern ↔ Backend ↔ Nutzlast ↔ Rechnung.
//
// 🔴 SIE WIRD AN JEDEM GLIED EINZELN GEMESSEN, nicht an einem. Ein Regler kann im Markup stehen und
// in der Liste fehlen (dann ist er tot), in der Liste stehen und im Markup fehlen (dann wirft das
// Rendern), gespeichert werden und in der Nutzlast fehlen (dann ist er nach dem Neuladen weg), oder
// überall stehen und vom Loader nicht als Änderung erkannt werden (dann rechnet die Karte mit den
// alten Werten weiter). Jeder dieser vier Fälle ist in diesem Projekt schon vorgekommen; drei davon
// hat ein Prüfagent am 04.09.2026 an genau diesem Umbau gefunden, kein Test.
//
// ⚠️ Dieser Test liest Quelltext — er kann also nicht beweisen, dass die Kette LÄUFT. Was er
// beweist, ist das, woran sie bisher gebrochen ist: dass irgendwo ein Glied FEHLT. Die Rechnung
// selbst prüft `gebirgssimulation.test.js`, ausgeführt.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");
let gehalten = 0;

function pruefe(name, fn) {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (error) {
		console.error("  FEHLER  " + name);
		throw error;
	}
}

// 🔴 DIE ZWOELF. Wer einen dreizehnten Regler baut, trägt ihn HIER ein — und der Test sagt ihm dann, welche
// der sechs Stellen er vergessen hat.
// 💣 `terrain_levels` und `terrain_erosion` waren bis zum 04.09.2026 EINE Spalte, und `reglerFuer`
// gab denselben Wert als `stufen` UND als `erosion` weiter: wer die Erosion hochzog, verstellte
// lautlos die Detailtiefe des Rauschens mit. Owner: „terrain_levels trenn die beiden!"
const REGLER = [
	{ key: "terrain_grain", element: "grain" },
	{ key: "terrain_levels", element: "levels" },
	{ key: "terrain_erosion", element: "erosion" },
	{ key: "terrain_plateau", element: "plateau" },
	{ key: "terrain_hypsometrie", element: "hypsometrie" },
	{ key: "terrain_avg_height", element: "avgheight" },
	{ key: "terrain_mean_height", element: "meanheight" },
	{ key: "terrain_bergform", element: "bergform" },
	{ key: "terrain_rauschen", element: "rauschen" },
	{ key: "terrain_sattel", element: "sattel" },
	{ key: "terrain_talbreite", element: "talbreite" },
	{ key: "terrain_einschnitt", element: "einschnitt" },
];

const markup = lies("index.html");
const properties = lies("js/map-features/map-features-ecosystem-properties.js");
const render = lies("js/map-features/map-features-ecosystem-height-render.js");
const loader = lies("js/map-features/map-features-ecosystem-loader.js");
const hydro = lies("js/map-features/map-features-ecosystem-hydrologie.js");
const php = lies("api/_internal/app/ecosystem.php");

/* ── 1. Markup ─────────────────────────────────────────────────────────────────────────────── */

pruefe("jeder Regler hat einen Schieber UND ein Zahlenfeld im Markup", () => {
	for (const r of REGLER) {
		assert.ok(markup.includes('id="ecosystem-properties-' + r.element + '"'),
			"Schieber fehlt: " + r.element);
		assert.ok(markup.includes('id="ecosystem-properties-' + r.element + '-num"'),
			"Zahlenfeld fehlt: " + r.element);
	}
});

pruefe("kein Geländeregler ist in ein fremdes Fenster gerutscht", () => {
	// 💣 Genau das ist beim Bau passiert: ein Regex traf das erste `</details>` der Datei, und zwei
	// Regler landeten in der Falte des MELDEFORMULARS (`#report-source-mehr`). Im Markup sieht das
	// unauffällig aus, und die Regler funktionieren dort sogar -- nur sieht sie niemand.
	const start = markup.indexOf('id="ecosystem-properties-terrain"');
	assert.ok(start > 0, "der Gelände-Abschnitt fehlt");
	// Das Ende des Abschnitts: die Höhenskala steht laut Markup direkt dahinter.
	const ende = markup.indexOf('id="ecosystem-properties-heightscale"', start);
	assert.ok(ende > start, "die Höhenskala steht nicht mehr hinter dem Gelände");
	const abschnitt = markup.slice(start, ende);
	for (const r of REGLER) {
		assert.ok(abschnitt.includes('id="ecosystem-properties-' + r.element + '"'),
			r.element + " steht NICHT im Gelände-Abschnitt");
	}
});

/* ── 2. Die eine Liste ─────────────────────────────────────────────────────────────────────── */

pruefe("TERRAIN_FIELDS kennt jeden Regler -- und keinen, den es nicht gibt", () => {
	const block = properties.slice(properties.indexOf("const TERRAIN_FIELDS = ["),
		properties.indexOf("];", properties.indexOf("const TERRAIN_FIELDS = [")));
	for (const r of REGLER) {
		assert.ok(block.includes('key: "' + r.key + '"'), "fehlt in TERRAIN_FIELDS: " + r.key);
		assert.ok(block.includes('element: "' + r.element + '"'), "fehlt in TERRAIN_FIELDS: " + r.element);
	}
	// Die Gegenrichtung: kein Eintrag ohne Markup -- der würfe beim Rendern.
	const schluessel = [...block.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]);
	assert.strictEqual(schluessel.length, REGLER.length,
		"TERRAIN_FIELDS hat " + schluessel.length + " Einträge, erwartet " + REGLER.length);
});

/* ── 3. Backend: vier Stellen, jede einzeln ───────────────────────────────────────────────── */

pruefe("das Backend legt jede Spalte an, schreibt, liest zurück UND liefert sie aus", () => {
	// 💣 VIER Stellen, und ein Endpunkt mit ausdrücklicher Feldliste wirft weg, was nicht genannt
	// ist. Genau daran ist im Garetien-Importer ein Regler monatelang wirkungslos geblieben.
	const neu = REGLER.filter((r) => !["terrain_grain", "terrain_levels", "terrain_avg_height",
		"terrain_mean_height"].includes(r.key));
	for (const r of neu) {
		const treffer = php.split(r.key).length - 1;
		// DDL + Schreibpfad + Rücklesen(SELECT) + Rücklesen(Rückgabe) + Nutzlast(SELECT) + Nutzlast(Zeile)
		assert.ok(treffer >= 5,
			r.key + " kommt nur " + treffer + "-mal in ecosystem.php vor -- eine der Stellen fehlt");
	}
});

/* ── 4. Der Loader ─────────────────────────────────────────────────────────────────────────── */

pruefe("der Loader erkennt eine Änderung an JEDEM Regler", () => {
	// 💣 Die Liste dort ist eine ausdrückliche Aufzählung. Was darin fehlt, geht beim Nachladen
	// lautlos verloren: der Loader übernimmt den neuen Wert, der Höhenstapel rechnet mit dem alten.
	// Im eigenen Browser fällt das nicht auf -- wohl aber bei Pan/Zoom und bei einem zweiten Editor.
	const i = loader.indexOf("terrain_grain");
	assert.ok(i > 0, "die Feldliste des Loaders ist nicht auffindbar");
	const block = loader.slice(i - 400, i + 600);
	for (const r of REGLER) {
		assert.ok(block.includes('"' + r.key + '"'),
			r.key + " fehlt in der Änderungsprüfung des Loaders");
	}
});

/* ── 5. Rechnung ───────────────────────────────────────────────────────────────────────────── */

pruefe("der Zeichner reicht jeden Regler an den Trichter, und der nimmt ihn an", () => {
	const i = render.indexOf("function reglerFuer");
	assert.ok(i > 0, "reglerFuer fehlt");
	const block = render.slice(i, render.indexOf("\n\t}", i));
	const namen = {
		terrain_grain: "koernung", terrain_levels: "erosion", terrain_avg_height: "maximalhoehe",
		terrain_bergform: "bergform", terrain_rauschen: "rauschen", terrain_sattel: "sattel",
		terrain_talbreite: "talbreite", terrain_einschnitt: "einschnitt",
	};
	for (const [key, name] of Object.entries(namen)) {
		assert.ok(block.includes(key), key + " wird nicht aus der Fläche gelesen");
		assert.ok(hydro.includes("reg." + name),
			"der Trichter liest `reg." + name + "` nicht");
	}
});

/* ── 6. Die Vorgaben stehen an EINER Stelle ───────────────────────────────────────────────── */

pruefe("die Beschriftungen sagen, was der Regler TUT", () => {
	// 🔴 „Kammhoehe (ohne Einzelgipfel)" seit dem 04.09.2026 (Owner). Sie hiess „Maximalhoehe", und
	// das war seit V12 falsch: die Gipfel ueberragen sie, sie ist nicht das Maximum -- sie ist der
	// SOCKEL des Kamms.
	// 💣 Die KENNUNGEN bleiben (`terrain_avg_height`, `-avgheight`) -- dieselbe Trennung wie bei
	// „Neuigkeiten"/`changelog`: eine umgetaufte Kennung laesst eine gecachte Seite ins Leere greifen,
	// und der Deploy loescht nie.
	assert.ok(markup.includes("<span>Kammh&ouml;he (ohne Einzelgipfel)</span>"),
		"der Regler heisst nicht „Kammhoehe (ohne Einzelgipfel)\"");
	assert.ok(markup.includes('id="ecosystem-properties-avgheight"'),
		"die Kennung `-avgheight` wurde mit umbenannt -- eine gecachte Seite greift dann ins Leere");
	// ⚠️ Und der Nachbar darf nicht auf einen Namen verweisen, den es nicht mehr gibt.
	const nachbar = markup.slice(markup.indexOf("Mittlere H&ouml;he der Fl&auml;che"),
		markup.indexOf("Mittlere H&ouml;he der Fl&auml;che") + 600);
	assert.ok(!nachbar.includes("Maximalh&ouml;he"),
		"der Hinweistext der Durchschnittshoehe nennt noch die alte Beschriftung");
	// 🔴 Und er sagt, dass diese Zahl derzeit NICHT wirkt: `reglerFuer` reicht `terrain_mean_height`
	// nicht an den Trichter durch. Ein Regler, dessen Wert nirgends gilt, ist von einem kaputten
	// Formular nicht zu unterscheiden.
	assert.ok(nachbar.includes("NICHT"),
		"der Hinweistext verschweigt, dass die Durchschnittshoehe in der Simulation nicht wirkt");
	assert.ok(!/mean:\s*area\?\.terrain_mean_height/.test(render)
		&& !render.includes("terrain_mean_height"),
		"`reglerFuer` reicht `terrain_mean_height` inzwischen doch durch -- dann ist der Hinweistext "
		+ "falsch geworden und muss mit");
});

pruefe("terrainDefaults LIEST die Modulkonstanten, statt Zahlen abzuschreiben", () => {
	// Eine zweite Fassung liesse „(auto)" eine andere Zahl anzeigen als die, mit der gerechnet wird.
	for (const name of ["ECOSYSTEM_HYDRO_BERGFORM", "ECOSYSTEM_HYDRO_RAUSCHEN",
		"ECOSYSTEM_HYDRO_SATTEL", "ECOSYSTEM_HYDRO_TALBREITE", "ECOSYSTEM_HYDRO_EINSCHNITT"]) {
		assert.ok(hydro.includes("const " + name + " ="), name + " ist keine Modulkonstante");
		assert.ok(properties.includes(name), "terrainDefaults liest " + name + " nicht");
	}
});

pruefe("das Rechenmodul wird VOR dem geladen, der seine Konstanten liest", () => {
	// 🪤 Ohne Kommentare messen: ein Dateipfad in einem HTML-Kommentar ist für `indexOf` ein
	// früheres <script>-Tag. Genau daran ist am 02.09.2026 ein Ladereihenfolge-Test umgefallen.
	const ohneKommentar = markup.replace(/<!--[\s\S]*?-->/g, "");
	const modul = ohneKommentar.indexOf("map-features-ecosystem-hydrologie.js");
	const leser = ohneKommentar.indexOf("map-features-ecosystem-properties.js");
	const zeichner = ohneKommentar.indexOf("map-features-ecosystem-height-render.js");
	assert.ok(modul > 0 && leser > modul, "hydrologie.js steht nicht vor properties.js");
	assert.ok(zeichner > modul, "hydrologie.js steht nicht vor height-render.js");
});

/* ── 7. Die zwei Knöpfe ────────────────────────────────────────────────────────────────────── */

pruefe("Gebirgszug ermitteln kommt nur ohne Anhalt -- und rechnet die Kammlinie", () => {
	// 🔴 Owner 04.09.2026: wenn man die Kurve rechnen muss, soll zuerst der Knopf
	// "Gebirgszug ermitteln" angeboten werden, bevor man sich wundert. Anlass war eine Flaeche ohne Gipfel
	// und ohne Kammlinie: der Editor stellte zwoelf Regler ein und sah eine einfarbige Flaeche.
	assert.ok(markup.includes('id="ecosystem-properties-terrain-ridge"'), "der Knopf fehlt");
	assert.ok(markup.includes("Gebirgszug ermitteln"), "der Knopf traegt nicht die bestellte Beschriftung");
	assert.ok(markup.includes('id="ecosystem-properties-terrain-ridgehint"'),
		"der erklaerende Hinweis fehlt -- ein Knopf ohne Grund ist eine Ueberraschung");

	// 🔴 VERSTECKT im Markup: er darf nur kommen, wenn es nichts gibt, dem das Gelaende folgen
	// koennte. Ein Knopf, der immer dasteht, waere eine Einladung, eine gerechnete Kurve grundlos zu
	// ueberschreiben.
	const knopf = markup.slice(markup.indexOf('id="ecosystem-properties-terrain-ridge"'));
	assert.ok(knopf.slice(0, knopf.indexOf(">")).includes("hidden"),
		"der Knopf ist nicht versteckt -- er stuende auch bei einer Flaeche mit Kammlinie da");

	// Und er geht denselben Weg wie die Aktion "Labelkurve aktualisieren" im Kontextmenue.
	const start = properties.indexOf("async function ermittleGebirgszug(");
	assert.ok(start > 0, "die Funktion fehlt");
	// ⚠️ Ein fester Ausschnitt statt der Suche nach dem Funktionsende: ein Muster mit
	// Zeilenumbruch und Tabulator laesst sich durch drei Werkzeugebenen (Shell, Python, JS) nicht
	// zuverlaessig transportieren -- beim Bau hat es viermal einen echten Umbruch in den Quelltext
	// geschrieben. 2000 Zeichen decken die Funktion sicher ab.
	const rumpf = properties.slice(start, start + 2000);
	assert.ok(rumpf.includes('"refresh_curve"'), "er rechnet die Kurve gar nicht");
	// 💣 OHNE DIE SOFORTANWENDUNG SAEHE ER WIRKUNGSLOS AUS: der Kartenpayload wird nach einer Aktion
	// nicht neu geholt, die frisch gerechnete Kurve kaeme also erst beim naechsten vollen Laden an.
	assert.ok(rumpf.includes("avesmapsCurveSettingAufLabelsAnwenden"),
		"die gerechnete Kurve wird nicht sofort auf die Labels angewandt");
	assert.ok(rumpf.includes("invalidate") && rumpf.includes("redraw"),
		"das Hoehenfeld wird nach dem Rechnen nicht neu gezeichnet");
	assert.ok(properties.includes('propertiesElement("terrain-ridge")?.addEventListener'),
		"der Knopf ist nicht verdrahtet");
});

pruefe("›Höhenfeld erzeugen‹ steht neben ›Auf Automatik zurück‹ und ist verdrahtet", () => {
	assert.ok(markup.includes('id="ecosystem-properties-terrain-build"'), "der Knopf fehlt");
	assert.ok(markup.includes("H&ouml;henfeld erzeugen") || markup.includes("Höhenfeld erzeugen"),
		"die Beschriftung fehlt");
	const i = markup.indexOf("ecosystem-properties-terrain-build");
	const j = markup.indexOf("ecosystem-properties-terrain-auto");
	assert.ok(i > 0 && j > 0 && Math.abs(i - j) < 600, "die zwei Knöpfe stehen nicht beieinander");
	assert.ok(properties.includes('propertiesElement("terrain-build")'), "der Knopf ist nicht verdrahtet");
});

/* ── 8. Der Schleier ───────────────────────────────────────────────────────────────────────── */

pruefe("das Fenster dunkelt den Hintergrund NICHT ab, und die Karte bleibt bedienbar", () => {
	// 💣 Die Regel galt bis zum 04.09.2026 `#ecosystem-properties-overlay` -- ein Element, das es
	// seit dem 25.08.2026 nicht mehr gibt. Wer nur nach `background: transparent` greppt, liest eine
	// tote Regel und hält die Sache für erledigt.
	// 🪤 OHNE KOMMENTARE MESSEN. Die Warnung vor der toten Regel NENNT sie -- ein Quelltexttest, der
	// den Kommentar mitliest, schlägt an genau der Zeile an, die ihn schützen soll. Beim Bau dieses
	// Tests sofort passiert; dieselbe Klasse steht im Haus mehrfach dokumentiert.
	const cssRoh = lies("css/components/dialog-overlays.css");
	const css = cssRoh.replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(!/#ecosystem-properties-overlay\s*[,{]/.test(css),
		"die tote Regel für #ecosystem-properties-overlay steht wieder da");
	const i = css.indexOf("#landschaft-dialog-overlay {");
	assert.ok(i > 0, "es gibt keine eigene Regel für #landschaft-dialog-overlay");
	const block = css.slice(i, css.indexOf("}", i));
	assert.ok(/background:\s*transparent/.test(block), "das Overlay ist nicht transparent");
	assert.ok(/pointer-events:\s*none/.test(block), "das Overlay fängt weiter Zeiger ab");
	// Die Kinder müssen sie wieder annehmen, sonst ist das Fenster selbst unbedienbar.
	assert.ok(css.includes("#landschaft-dialog-overlay > *"), "die Kinder bekommen keine Zeiger zurück");
	// 🔴 Und die transparente Regel muss NACH der abdunkelnden stehen -- gleiche Spezifität,
	// die spätere gewinnt.
	const scrim = css.indexOf("#landschaft-dialog-overlay,");
	assert.ok(scrim > 0 && i > scrim, "die transparente Regel steht VOR der abdunkelnden");
});

/* ── 9. Die Falte ──────────────────────────────────────────────────────────────────────────── */

pruefe("die Falte ist nativ UND gestaltet", () => {
	assert.ok(markup.includes("ecosystem-properties-dialog__terrainfold"), "die Falte fehlt");
	assert.ok(/<details class="ecosystem-properties-dialog__terrainfold">/.test(markup),
		"die Falte ist kein natives <details> -- dann findet Strg+F ihren Inhalt nicht");
	const css = lies("css/features/ecosystem-layer.css");
	assert.ok(css.includes(".ecosystem-properties-dialog__terrainfold"),
		"die Falte hat keine einzige CSS-Regel");
	assert.ok(/terrainfold > summary\s*\{[^}]*cursor:\s*pointer/.test(css),
		"das summary trägt keinen Zeiger -- im Haus ist alles Anklickbare `pointer`");
});

console.log("\n" + gehalten + " Zusicherungen gehalten.");
