// Was die Spotlight-Suche sagt, wenn sie NICHTS gefunden hat.
//
// Bis zum 02.09.2026 sagte sie gar nichts: bei null Treffern wurde die Liste ausgeblendet und das
// Statusfeld geleert -- das Fenster stand leer da, und "nicht gefunden" war von "ich habe noch
// nicht geantwortet" nicht zu unterscheiden.
//
// Zwei Haelften, und die NAHT dazwischen wird hier mitgefahren:
//   A) die reine Regel  spotlightSearchStatusText()
//   B) die Verdrahtung  renderSpotlightSearchResults() / updateSpotlightSearchResults(),
//      wirklich AUSGEFUEHRT mit gefaelschten Nachbarn -- nicht per includes() behauptet.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/spotlight-leere-suche.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(REPO, ...teile), "utf8").replace(/\r\n/g, "\n");

const quelle = lies("js", "ui", "spotlight-search.js");

// Eine Funktion aus der AUSGELIEFERTEN Datei, per Name. Die Deklarationen stehen in Spalte 0, also
// beendet eine schliessende Klammer in Spalte 0 die Funktion.
const schneide = (name) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, `function ${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return treffer[0];
};

// ---- A) Die Regel -----------------------------------------------------------------------------

// `tr(schluessel, rueckfall)` gibt ohne geladene Sprachtafel den Rueckfall zurueck -- also genau
// das, was ein deutscher Besucher sieht. Die englische Seite wird in Abschnitt C gefahren.
const regelKontext = { String, Number, Boolean, tr: (schluessel, rueckfall) => rueckfall };
vm.runInNewContext(schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText"), regelKontext);
const satz = regelKontext.spotlightSearchStatusText;

// Kein Suchwort -> kein Wort. Das leere Fenster beim Aufziehen ist kein Befund.
assert.strictEqual(satz({ query: "", resultCount: 0 }), null, "leere Eingabe schweigt");
assert.strictEqual(satz({ query: "   ", resultCount: 0 }), null, "nur Leerzeichen schweigt");
// Ein Suchwort, das sich zu nichts normalisiert (`???`), ist genauso kein Suchwort -- gemessen
// wird das NORMALISIERTE Wort, sonst meldet ein Fragezeichen "nicht gefunden".
assert.strictEqual(satz({ query: "???", resultCount: 0 }), null, "unnormalisierbare Eingabe schweigt");

// Treffer -> kein Wort, auch waehrend der Server noch laeuft.
assert.strictEqual(satz({ query: "gareth", resultCount: 3 }), null, "Treffer schweigen");
assert.strictEqual(satz({ query: "gareth", resultCount: 3, backendPending: true }), null);

// DIE TRAGENDE ZUSICHERUNG: null Treffer, waehrend der Server noch antwortet -> SCHWEIGEN.
// Die Suche ist zweistufig (erst lokal aus den Kartendaten, dann schiebt der Server Literatur,
// Kartensammlung, Vorkommen und Off-Map-Treffer nach). Wer hier meldet, laesst "Nicht auf Avesmaps
// gefunden" bei JEDEM Tastendruck aufblinken und eine Sekunde spaeter von echten Treffern ersetzen.
assert.strictEqual(satz({ query: "bjaldorn", resultCount: 0, backendPending: true }), null, "wartender Server schweigt");

// Endzustand: null Treffer und niemand antwortet mehr.
assert.strictEqual(
	satz({ query: "xyzq", resultCount: 0 }),
	"Nicht auf Avesmaps gefunden.",
	"null Treffer ohne laufenden Server melden"
);

// Ein AUSGEFALLENER Abruf ist kein leeres Ergebnis. "Nicht auf Avesmaps gefunden" hiesse dort
// "das gibt es nicht", obwohl niemand nachgesehen hat.
assert.strictEqual(
	satz({ query: "xyzq", resultCount: 0, backendFailed: true }),
	"Die Suche ist gerade nicht erreichbar.",
	"Fehlschlag bekommt seinen eigenen Satz"
);
// Und der Fehlschlag schlaegt das Warten: wer gescheitert ist, wartet nicht mehr.
assert.strictEqual(
	satz({ query: "xyzq", resultCount: 0, backendPending: true, backendFailed: true }),
	"Die Suche ist gerade nicht erreichbar."
);
// Ein Fehlschlag MIT lokalen Treffern schweigt: der Benutzer sieht eine Liste, und ein Fehlersatz
// darunter liesse sie unvollstaendig aussehen, ohne dass er etwas tun koennte.
assert.strictEqual(satz({ query: "gareth", resultCount: 2, backendFailed: true }), null);

// ---- B) Die Naht: die Saetze erreichen wirklich das DOM ----------------------------------------

// Ein Statusfeld, wie es in index.html steht.
const machStatus = () => ({ textContent: "", hidden: true });

const bauKontext = (statusFeld, eingabewert) => {
	const kontext = {
		String, Number, Boolean, Array, Set, Map, Object, JSON, Math, Infinity,
		console: { warn() {} },
		clearTimeout() {}, setTimeout() {},
		// Der Zustand, den die echte Datei auf Dateiebene haelt.
		spotlightRenderedEntries: null,
		spotlightSearchRenderToken: 0,
		spotlightBackendAbortController: null,
		// Die Nachbarn, gefaelscht -- geprueft wird die Statuszeile, nicht das Trefferbild.
		SPOTLIGHT_SEARCH_SECTIONS: [],
		getSpotlightSearchElements: () => ({
			input: { value: eingabewert, setAttribute() {} },
			results: { innerHTML: "", hidden: true },
			status: statusFeld,
		}),
		spotlightResultMarkup: () => "",
		setSpotlightActiveResultIndex() {},
		tr: (schluessel, rueckfall) => rueckfall,
		escapeHtml: (wert) => String(wert),
	};
	kontext.globalThis = kontext;
	return kontext;
};

// -- renderSpotlightSearchResults schreibt den Satz ins Feld und blendet es ein/aus.
{
	const feld = machStatus();
	const kontext = bauKontext(feld, "xyzq");
	vm.runInNewContext(
		schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText") + schneide("renderSpotlightSearchResults"),
		kontext
	);

	kontext.renderSpotlightSearchResults([], { query: "xyzq" });
	assert.strictEqual(feld.textContent, "Nicht auf Avesmaps gefunden.", "der Satz steht wirklich im Feld");
	assert.strictEqual(feld.hidden, false, "und das Feld ist sichtbar");

	// Der naechste Durchgang mit Treffern raeumt ihn wieder weg -- sonst bleibt er stehen.
	kontext.renderSpotlightSearchResults([{ kind: "location" }], { query: "gareth" });
	assert.strictEqual(feld.textContent, "", "Treffer raeumen den Satz weg");
	assert.strictEqual(feld.hidden, true);

	// Ohne Angaben (der dritte Aufrufer) darf nichts stehenbleiben.
	kontext.renderSpotlightSearchResults([]);
	assert.strictEqual(feld.hidden, true, "ohne Suchwort bleibt das Feld leer");
}

// -- updateSpotlightSearchResults: der lokale Durchgang meldet NICHT, solange der Server laeuft.
const fahreDurchlauf = async ({ lokal, serverAntwort, serverFehler, backendAn = true }) => {
	const feld = machStatus();
	const kontext = bauKontext(feld, "bjaldorn");
	const zwischenstaende = [];
	kontext.searchSpotlightEntries = () => lokal;
	kontext.shouldUseBackendSpotlightSearch = () => backendAn;
	kontext.fetchBackendSpotlightResults = () => (serverFehler
		? Promise.reject(serverFehler)
		: Promise.resolve(serverAntwort || []));
	kontext.resolveBackendSpotlightEntries = (roh, lokaleTreffer) => (roh.length ? roh : lokaleTreffer);
	vm.runInNewContext(
		schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText")
			+ schneide("renderSpotlightSearchResults") + schneide("updateSpotlightSearchResults"),
		kontext
	);
	// Jeder Aufruf des Zeichners wird protokolliert, damit der ZWISCHENstand sichtbar bleibt.
	const echterZeichner = kontext.renderSpotlightSearchResults;
	kontext.renderSpotlightSearchResults = (eintraege, hinweis) => {
		echterZeichner(eintraege, hinweis);
		zwischenstaende.push({ text: feld.textContent, hidden: feld.hidden });
	};

	kontext.updateSpotlightSearchResults();
	// Zwei Runden Mikrotasks: fetch -> then -> render.
	await new Promise((fertig) => setImmediate(fertig));
	await new Promise((fertig) => setImmediate(fertig));
	return { feld, zwischenstaende };
};

(async () => {
	// 1) Lokal nichts, Server liefert nichts -> am Ende steht der Satz, ZWISCHENDURCH nicht.
	{
		const { feld, zwischenstaende } = await fahreDurchlauf({ lokal: [], serverAntwort: [] });
		assert.strictEqual(zwischenstaende[0].text, "", "der lokale Durchgang schweigt noch");
		assert.strictEqual(feld.textContent, "Nicht auf Avesmaps gefunden.", "nach der Serverantwort steht der Satz");
		assert.strictEqual(feld.hidden, false);
	}

	// 2) Lokal nichts, aber der Server FINDET etwas -> nie ein Wort. Das ist der Alltagsfall
	//    (Literatur, Kartensammlung, Vorkommen und Off-Map-Treffer kennt nur der Server).
	{
		const { feld, zwischenstaende } = await fahreDurchlauf({ lokal: [], serverAntwort: [{ kind: "adventure" }] });
		assert.ok(
			zwischenstaende.every((stand) => stand.text === ""),
			"kein Aufblinken: " + JSON.stringify(zwischenstaende)
		);
		assert.strictEqual(feld.hidden, true);
	}

	// 3) Der Abruf scheitert -> der andere Satz.
	{
		const { feld } = await fahreDurchlauf({ lokal: [], serverFehler: new Error("HTTP 503") });
		assert.strictEqual(feld.textContent, "Die Suche ist gerade nicht erreichbar.");
		assert.strictEqual(feld.hidden, false);
	}

	// 4) Ein ABBRUCH ist kein Fehlschlag: er heisst, dass schon die naechste Suche laeuft, und die
	//    setzt ihren eigenen Stand. Ein Fehlersatz waere hier bei jedem Tastendruck zu sehen.
	{
		const abbruch = new Error("aborted");
		abbruch.name = "AbortError";
		const { feld } = await fahreDurchlauf({ lokal: [], serverFehler: abbruch });
		assert.strictEqual(feld.textContent, "", "ein Abbruch meldet nichts");
		assert.strictEqual(feld.hidden, true);
	}

	// 5) Wird der Server gar nicht gefragt (unter 2 Zeichen, oder kein Endpunkt konfiguriert),
	//    steht der Satz sofort -- es kommt ja nichts mehr nach.
	{
		const { feld } = await fahreDurchlauf({ lokal: [], backendAn: false });
		assert.strictEqual(feld.textContent, "Nicht auf Avesmaps gefunden.");
	}

	// 6) Der WETTLAUF: waehrend der Benutzer weitertippt, scheitert der Abruf der VORIGEN Suche.
	//    Ohne den renderToken-Riegel legt dieser Fehlschlag "Die Suche ist gerade nicht erreichbar"
	//    ueber die Treffer, die gerade gefunden wurden -- und der Satz gehoert einer Anfrage, die
	//    niemanden mehr interessiert.
	{
		const feld = machStatus();
		const kontext = bauKontext(feld, "bjaldorn");
		let lokaleTreffer = [];
		let naechsterAbruf = null;
		kontext.searchSpotlightEntries = () => lokaleTreffer;
		kontext.shouldUseBackendSpotlightSearch = () => true;
		kontext.fetchBackendSpotlightResults = () => naechsterAbruf;
		kontext.resolveBackendSpotlightEntries = (roh, lokale) => (roh.length ? roh : lokale);
		vm.runInNewContext(
			schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText")
				+ schneide("renderSpotlightSearchResults") + schneide("updateSpotlightSearchResults"),
			kontext
		);

		// Lauf 1: nichts gefunden, der Abruf haengt noch.
		let lauf1Ablehnen;
		naechsterAbruf = new Promise((_, ablehnen) => { lauf1Ablehnen = ablehnen; });
		kontext.updateSpotlightSearchResults();

		// Lauf 2: der Benutzer hat weitergetippt und trifft etwas.
		lokaleTreffer = [{ kind: "location" }];
		naechsterAbruf = Promise.resolve([]);
		kontext.updateSpotlightSearchResults();
		await new Promise((fertig) => setImmediate(fertig));
		await new Promise((fertig) => setImmediate(fertig));
		assert.strictEqual(feld.hidden, true, "Lauf 2 hat Treffer und schweigt");

		// Jetzt erst faellt Lauf 1 um -- er darf nichts mehr sagen.
		lauf1Ablehnen(new Error("HTTP 503"));
		await new Promise((fertig) => setImmediate(fertig));
		await new Promise((fertig) => setImmediate(fertig));
		assert.strictEqual(feld.textContent, "", "der veraltete Fehlschlag schreibt nichts mehr");
		assert.strictEqual(feld.hidden, true);
	}

	// ---- C) Die englische Fassung ---------------------------------------------------------------
	// Eine fehlende Zeile ist lautlos: `tr(key, deutsch)` faellt auf das deutsche Wort zurueck, und
	// unter ?lang=en steht dann Deutsch da -- von einer Entscheidung nicht zu unterscheiden.
	const i18nKontext = { window: {} };
	vm.runInNewContext(lies("js", "app", "i18n-en.js"), i18nKontext);
	const englisch = i18nKontext.window.AVESMAPS_I18N_EN;
	["spotlight.noResults", "spotlight.searchFailed"].forEach((schluessel) => {
		assert.ok(englisch[schluessel], `${schluessel} fehlt in js/app/i18n-en.js`);
	});

	// Und die Saetze kommen wirklich aus tr() -- der Test oben hat die deutschen Rueckfaelle
	// gemessen, weil sein `tr` den Rueckfall zurueckgibt. Hier wird die andere Seite gefahren.
	const enKontext = { String, Number, Boolean };
	vm.runInNewContext(schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText"), enKontext);
	enKontext.tr = (schluessel) => englisch[schluessel];
	assert.strictEqual(
		enKontext.spotlightSearchStatusText({ query: "xyzq", resultCount: 0 }),
		englisch["spotlight.noResults"],
		"der Satz geht durch tr(), nicht am i18n vorbei"
	);

	console.log("spotlight-leere-suche: OK");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
