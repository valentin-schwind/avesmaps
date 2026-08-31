// Die englische Fassung eines VOKABULARS -- zwei Familien, eine Regel.
// ====================================================================
// 💣 EINE FEHLENDE ZEILE IST LAUTLOS. Jeder dieser Leser baut den i18n-Schluessel aus einem Slug
// zusammen und gibt das deutsche Wort als Rueckfall mit (`tr(key, deutsch)`). Fehlt die Zeile in
// js/app/i18n-en.js, steht unter ?lang=en das DEUTSCHE Wort da: kein Fehler, keine Meldung, und von
// einer bewussten Entscheidung nicht zu unterscheiden. Genau so ist `urwald` am 30.08.2026 halb
// angekommen -- der Seed und die Speicher-Erlaubnis kannten die Art, das Vokabular nicht.
//
// Zwei Familien, ZWEI QUELLEN -- und die Quelle bestimmt die Form der Pruefung:
//   report.typeOption.*  ->  das Auswahlfeld #location-report-type in index.html. Der Schluessel
//                            steht dort als `data-i18n` AM MARKUP; eine Tabelle daneben gibt es nicht.
//   cityMaps.type.*      ->  AVESMAPS_CITYMAP_TYPE_LABELS (js/map-features/map-features-citymaps.js),
//                            eine Tabelle wie die der Label-Arten.
//
// 🔴 Die dritte Familie, `spotlight.labelType.*`, wird NICHT hier gewacht, sondern in
// js/ui/__tests__/label-arten.test.js: dort traegt dieselbe Datei drei weitere Zusicherungen ueber
// dieselbe Tabelle (Auswahlfeld, Laufzeit-Leser, Landschafts-Seed), und die gehoeren zusammen.
//
// 🔧 Zwei Nachbarn haben dieselbe Form und waeren je EIN Aufruf von `pruefeFamilie`:
// `report.sizeOption.*` (7 Zeilen, dasselbe Fenster) und `cityMaps.art.*` (4 Zeilen, die Tabelle
// daneben). Gemessen 01.09.2026 sind beide vollstaendig -- sie stehen hier noch nicht, weil sie
// nicht Gegenstand dieses Auftrags waren, nicht weil etwas gegen sie spraeche.
//
// ⚠️ Und was hier ausdruecklich NICHT geprueft wird: ob JEDES `data-i18n` in index.html eine
// englische Zeile hat. Gemessen 01.09.2026 haben 20 von 353 keine -- darunter der ganze
// Quellen-Abschnitt des Meldedialogs und das Stapel-Fenster der Landschaften. Das ist ein eigener
// Befund, der je Zeile eine Entscheidung braucht; ein Test, der ab morgen rot steht, waere hier das
// Gegenteil einer Wache -- er lehrt, das Testfeld zu ignorieren.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/i18n-vokabular-abdeckung.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(REPO, ...teile), "utf8").replace(/\r\n/g, "\n");

// ---- Die englische Tafel ----------------------------------------------------------------------
// 🔴 GELADEN, nicht per Muster gelesen: i18n-en.js ist ein Objektliteral (window.AVESMAPS_I18N_EN),
// und der Parser wirft die Kommentare von selbst weg. Ein Muster ueber den Quelltext traefe die
// Beispiele in den Kommentaren mit -- die Falle "Quelltexttest darf Kommentare nicht mitlesen".
const i18nKontext = { window: {} };
vm.createContext(i18nKontext);
vm.runInContext(lies("js", "app", "i18n-en.js"), i18nKontext);
const ENGLISCH = i18nKontext.window.AVESMAPS_I18N_EN;
assert.ok(ENGLISCH && typeof ENGLISCH === "object",
	"js/app/i18n-en.js muss window.AVESMAPS_I18N_EN setzen");
assert.ok(Object.keys(ENGLISCH).length >= 500,
	"die englische Tafel muss wirklich geladen worden sein, gefunden: " + Object.keys(ENGLISCH).length);

// 🔴 BLEIBT_DEUTSCH startet LEER, und das ist kein Platzhalter, den man beim ersten Widerstand
// fuellt. Hier hinein gehoert allein ein Begriff, dessen Name DOMAENENINHALT ist (AGENTS.md §2:
// aventurische Begriffe werden nie uebersetzt) -- mit seinem Grund in derselben Zeile. "Heisst auf
// Englisch genauso" ist KEIN Grund: dann steht die Zeile eben zweimal gleich da und sagt
// "nachgesehen". Der Schluessel steht VOLL drin, nie nur der Slug -- die Familien teilen sich
// Woerter (`region` gibt es in beiden), und eine Ausnahme gilt immer nur EINER von ihnen.
const BLEIBT_DEUTSCH = new Map([
	// ["<voller i18n-Schluessel>", "<Grund, warum dieses Wort auch auf Englisch deutsch bleibt>"],
]);

// ---- Die eine Regel, zwei Aufrufer ------------------------------------------------------------
// Beide Richtungen, und die zweite ist nicht dekorativ: der Namensraum einer Familie gehoert
// AUSSCHLIESSLICH ihrem Vokabular (jeder Leser setzt den Schluessel aus einem Slug zusammen, es kann
// dort gar nichts anderes ankommen). Eine Zeile ohne Slug ist deshalb die zurueckgebliebene Haelfte
// einer Entfernung, die niemand zu Ende gefuehrt hat.
function pruefeFamilie({ name, praefix, slugs, quelle, mindestens }) {
	assert.ok(slugs.length >= mindestens,
		name + ": die Quelle (" + quelle + ") muss wirklich gelesen worden sein, gefunden: " + slugs.length);

	for (const slug of slugs) {
		const voll = praefix + slug;
		if (BLEIBT_DEUTSCH.has(voll)) { continue; }
		const englisch = ENGLISCH[voll];
		assert.ok(typeof englisch === "string" && englisch.trim() !== "",
			name + ": \"" + slug + "\" steht in " + quelle + ", aber \"" + voll + "\" fehlt in "
			+ "js/app/i18n-en.js -- unter ?lang=en stuende dort still das deutsche Wort. Entweder die "
			+ "Zeile nachtragen (auch wenn das Wort gleich lautet), oder den Schluessel mit Grund in "
			+ "BLEIBT_DEUTSCH eintragen");
	}

	for (const voll of Object.keys(ENGLISCH)) {
		if (!voll.startsWith(praefix)) { continue; }
		const slug = voll.slice(praefix.length);
		assert.ok(slugs.includes(slug),
			name + ": js/app/i18n-en.js kennt \"" + voll + "\", aber " + quelle + " kennt \"" + slug
			+ "\" nicht -- entweder ist der Eintrag nur halb entfernt worden, oder der Namensraum wurde "
			+ "fuer etwas benutzt, das nicht zu dieser Familie gehoert");
	}
}

// ---- 1. Die Arten des Meldedialogs ------------------------------------------------------------
const indexHtml = lies("index.html");
const selectStart = indexHtml.indexOf("<select id=\"location-report-type\"");
assert.ok(selectStart >= 0, "#location-report-type muss in index.html stehen");
const selectHtml = indexHtml.slice(selectStart, indexHtml.indexOf("</select>", selectStart));

const meldeArten = [];
for (const treffer of selectHtml.matchAll(/<option value="([^"]*)"([^>]*)>/g)) {
	const wert = treffer[1];
	const schluessel = (treffer[2].match(/data-i18n="([^"]+)"/) || [])[1];
	// 💣 Ein <option> GANZ OHNE data-i18n ist die stillste Form dieses Fehlers: es fehlt kein
	// Schluessel in der englischen Tafel, es fragt nur niemand nach ihm. Beide Richtungen der
	// Familienpruefung unten blieben gruen, und die Zeile bliebe trotzdem fuer immer deutsch.
	assert.ok(schluessel,
		"die Melde-Art \"" + wert + "\" hat kein data-i18n am <option> -- sie wird unter ?lang=en "
		+ "nie uebersetzt, und keine Schluesselpruefung kann das sehen");
	// 💣 Und ein ABGESCHRIEBENER Nachbarschluessel ist die teuerste Form: die Zeile ist da, die
	// Uebersetzung greift, und das Auswahlfeld sagt auf Englisch etwas anderes als auf Deutsch --
	// falsch statt unuebersetzt, und das faellt niemandem auf, der die Sprache nicht wechselt.
	assert.strictEqual(schluessel, "report.typeOption." + wert,
		"die Melde-Art \"" + wert + "\" traegt den Schluessel \"" + schluessel + "\" -- er muss "
		+ "\"report.typeOption." + wert + "\" heissen, sonst uebersetzt sie sich in ein fremdes Wort");
	meldeArten.push(wert);
}
assert.ok(meldeArten.includes("location") && meldeArten.includes("comment"),
	"das gelesene Auswahlfeld muss das echte sein (\"location\" und \"comment\" stehen darin)");

pruefeFamilie({
	name: "Meldedialog",
	praefix: "report.typeOption.",
	slugs: meldeArten,
	quelle: "#location-report-type in index.html",
	mindestens: 20,
});

// ---- 2. Die Arten der Kartensammlung ----------------------------------------------------------
// 🪤 Die Tabelle steht NICHT in `module.exports` von map-features-citymaps.js (dort liegen nur die
// Funktionen). Deshalb die ganze Datei im vm laufen lassen und den Wert als AUSDRUCK holen -- und
// nicht ueber `avesmapsCitymapTypeLabel` gehen: die Funktion beantwortet einen Slug, sie kann die
// Slugs nicht aufzaehlen, und ohne `tr` liefert sie ohnehin nur den deutschen Rueckfall.
const citymapKontext = { console };
vm.createContext(citymapKontext);
vm.runInContext(lies("js", "map-features", "map-features-citymaps.js"), citymapKontext);
const CITYMAP_ARTEN = vm.runInContext("AVESMAPS_CITYMAP_TYPE_LABELS", citymapKontext);
assert.ok(CITYMAP_ARTEN && typeof CITYMAP_ARTEN === "object",
	"AVESMAPS_CITYMAP_TYPE_LABELS muss aus map-features-citymaps.js zu holen sein");
assert.strictEqual(CITYMAP_ARTEN.ortsplan, "Ortsplan",
	"die gelesene Tabelle muss die echte sein");

pruefeFamilie({
	name: "Kartensammlung",
	praefix: "cityMaps.type.",
	slugs: Object.keys(CITYMAP_ARTEN),
	quelle: "AVESMAPS_CITYMAP_TYPE_LABELS in js/map-features/map-features-citymaps.js",
	mindestens: 10,
});

console.log("i18n-vokabular-abdeckung.test.js: alle Zusicherungen erfuellt");
