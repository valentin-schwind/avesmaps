// Zwei Zusagen der Spotlight-Suche, beide vom Owner am 14.09.2026 bestellt (Paket 4 der
// Performance-Analyse vom 26.08.2026, „UI-Gefuehl"):
//
//   A) Braucht der Server laenger als 300 ms und wurde lokal NICHTS gefunden, steht „Suche läuft …“ da.
//      Live gemessen stand das Fenster bis dahin 1,8 s stumm -- von einem kaputten Feld nicht zu
//      unterscheiden.
//   B) Hat der Besucher selbst einen Treffer markiert (Pfeiltaste oder Maus), bleibt ER markiert,
//      wenn die Serverantwort die Liste umstellt. Live belegt am 26.08.2026: die Plaetze 3-5 wurden
//      ersetzt, und wer auf Platz 3 stand, waehlte mit Enter etwas anderes.
//
// Gefahren wird der ECHTE Ablauf -- updateSpotlightSearchResults -> Wecker -> Serverantwort ->
// Zeichner -> Tastatur --, mit Funktionen, die aus der ausgelieferten Datei geschnitten werden, einer
// gefaelschten Uhr und einem gefaelschten Serverabruf, den der Test selbst aufloest.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/spotlight-wartezeit-und-auswahl.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(REPO, ...teile), "utf8").replace(/\r\n/g, "\n");
const quelle = lies("js", "ui", "spotlight-search.js");

// Deklarationen stehen in Spalte 0 -- eine schliessende Klammer in Spalte 0 beendet die Funktion.
const schneide = (name) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, `function ${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return treffer[0];
};
const konstantenZeile = (name) => {
	const treffer = quelle.match(new RegExp("\\nconst " + name + " = [^;]+;"));
	assert.ok(treffer, `const ${name} nicht in js/ui/spotlight-search.js gefunden`);
	return treffer[0];
};

// ---- Die Uhr ----------------------------------------------------------------------------------

const machUhr = () => {
	let jetzt = 0;
	let naechsteId = 1;
	const wecker = new Map();
	return {
		setTimeout(fn, ms) {
			const id = naechsteId++;
			wecker.set(id, { fn, faellig: jetzt + (Number(ms) || 0) });
			return id;
		},
		clearTimeout(id) {
			wecker.delete(id);
		},
		// Laesst die Zeit laufen und feuert faellige Wecker in ihrer Reihenfolge.
		vor(ms) {
			const ziel = jetzt + ms;
			for (;;) {
				let fruehester = null;
				for (const [id, eintrag] of wecker) {
					if (eintrag.faellig <= ziel && (!fruehester || eintrag.faellig < fruehester[1].faellig)) {
						fruehester = [id, eintrag];
					}
				}
				if (!fruehester) {
					break;
				}
				wecker.delete(fruehester[0]);
				jetzt = fruehester[1].faellig;
				fruehester[1].fn();
			}
			jetzt = ziel;
		},
		offen: () => wecker.size,
	};
};

// ---- Die Buehne -------------------------------------------------------------------------------

const eintrag = (name) => ({ id: `location:${name}`, kind: "location", name });

const machBuehne = () => {
	const uhr = machUhr();
	const status = { textContent: "", hidden: true };
	const knoepfe = { liste: [] };
	const eingabe = { value: "bjaldorn", attribute: {}, setAttribute(k, v) { this.attribute[k] = v; }, removeAttribute(k) { delete this.attribute[k]; } };
	const server = { aufloesen: null, ablehnen: null, antwortListe: null };
	const gewaehlt = [];
	class Element {}

	const kontext = {
		String, Number, Boolean, Array, Set, Map, Object, JSON, Math, Promise,
		console: { warn() {}, log() {} },
		setTimeout: uhr.setTimeout,
		clearTimeout: uhr.clearTimeout,
		Element,
		window: { clearInterval() {} },
		// Der Zustand, den die echte Datei auf Dateiebene haelt.
		spotlightRenderedEntries: [],
		spotlightActiveResultIndex: -1,
		spotlightSearchRenderToken: 0,
		spotlightBackendAbortController: null,
		spotlightSearchInputTimeout: null,
		spotlightSearchPendingHintTimeout: null,
		spotlightUserChosenEntryId: "",
		spotlightRegionInfoboxPollTimer: null,
		SPOTLIGHT_SEARCH_SECTIONS: [],
		getSpotlightSearchElements: () => ({
			overlay: { hidden: false },
			input: eingabe,
			results: {
				innerHTML: "",
				hidden: true,
				// Ein Knopf je gezeichnetem Treffer, wie spotlightResultMarkup ihn baut.
				querySelectorAll() {
					knoepfe.liste = kontext.spotlightRenderedEntries.map((_, index) => ({
						id: `spotlight-result-${index}`,
						aktiv: false,
						attribute: {},
						classList: { toggle(klasse, an) { if (klasse === "is-active") knoepfe.liste[index].aktiv = an; } },
						setAttribute(k, v) { this.attribute[k] = v; },
						scrollIntoView() {},
					}));
					return knoepfe.liste;
				},
			},
			status,
		}),
		spotlightResultMarkup: () => "",
		tr: (schluessel, rueckfall) => rueckfall,
		escapeHtml: (wert) => String(wert),
		syncModalDialogBodyState() {},
		// Der lokale Durchgang und der Server -- vom Test gesteuert.
		lokaleTreffer: [],
		searchSpotlightEntries: () => kontext.lokaleTreffer,
		shouldUseBackendSpotlightSearch: () => true,
		fetchBackendSpotlightResults: () => new Promise((aufloesen, ablehnen) => {
			server.aufloesen = aufloesen;
			server.ablehnen = ablehnen;
		}),
		// Die echte Zusammenfuehrung haengt an Kartendaten; hier liefert der Server die fertige Liste.
		resolveBackendSpotlightEntries: (roh, lokale) => (roh.length ? roh : lokale),
		selectSpotlightSearchEntry: (treffer) => gewaehlt.push(treffer),
	};
	kontext.globalThis = kontext;

	vm.runInNewContext(
		konstantenZeile("SPOTLIGHT_SEARCH_PENDING_HINT_DELAY_MS")
			+ ["normalizeSpotlightSearchText", "spotlightSearchStatusText", "renderSpotlightSearchResults",
				"updateSpotlightSearchResults", "setSpotlightActiveResultIndex", "chooseSpotlightResultIndex",
				"handleSpotlightInputKeydown", "handleSpotlightResultMouseMove", "closeSpotlightSearch"]
				.map(schneide).join("\n"),
		kontext
	);

	const taste = (key) => kontext.handleSpotlightInputKeydown({ key, preventDefault() {} });
	const mausUeber = (index) => {
		const ziel = new Element();
		ziel.closest = () => ({ dataset: { spotlightResultIndex: String(index) } });
		kontext.handleSpotlightResultMouseMove({ target: ziel });
	};
	const mikrotasks = async () => {
		await new Promise((fertig) => setImmediate(fertig));
		await new Promise((fertig) => setImmediate(fertig));
	};
	return { kontext, uhr, status, knoepfe, server, gewaehlt, taste, mausUeber, mikrotasks };
};

const SUCHE = "Suche läuft …";
const NICHTS = "Nicht auf Avesmaps gefunden.";
const FEHLER = "Die Suche ist gerade nicht erreichbar.";

(async () => {
	// Die Wartezeit ist ein Owner-Wert, keine freie Zahl.
	{
		const kontext = {};
		vm.runInNewContext(konstantenZeile("SPOTLIGHT_SEARCH_PENDING_HINT_DELAY_MS"), kontext);
		const wert = vm.runInNewContext("SPOTLIGHT_SEARCH_PENDING_HINT_DELAY_MS", kontext);
		assert.strictEqual(wert, 300, "Owner 14.09.2026: „Suche läuft …“ erscheint nach 300 ms");
	}

	// ---- A) Die Wartezeit ---------------------------------------------------------------------

	// A1) Lokal nichts, der Server braucht lange -> erst Schweigen, ab 300 ms „Suche läuft …“, dann die Liste.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		assert.strictEqual(b.status.hidden, true, "A1: der erste Durchgang schweigt");
		b.uhr.vor(299);
		assert.strictEqual(b.status.hidden, true, "A1: nach 299 ms schweigt er noch -- kein Aufblinken beim Tippen");
		b.uhr.vor(1);
		assert.strictEqual(b.status.textContent, SUCHE, "A1: nach 300 ms steht „Suche läuft …“");
		assert.strictEqual(b.status.hidden, false, "A1: und das Feld ist sichtbar");
		b.server.aufloesen([{ id: "adventure:1", kind: "adventure", name: "Werk" }]);
		await b.mikrotasks();
		assert.strictEqual(b.status.hidden, true, "A1: die Serverliste raeumt „Suche läuft …“ weg");
		assert.strictEqual(b.status.textContent, "");
		assert.strictEqual(b.uhr.offen(), 0, "A1: kein Wecker bleibt stehen");
	}

	// A2) DER WETTLAUF: der Server antwortet VOR Ablauf mit nichts. Der Token ist dabei noch derselbe --
	//     ohne geloeschten Wecker ueberschriebe „Suche läuft …“ das Endergebnis, und „Nicht auf Avesmaps
	//     gefunden" stuende nie mehr da.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		b.uhr.vor(100);
		b.server.aufloesen([]);
		await b.mikrotasks();
		assert.strictEqual(b.status.textContent, NICHTS, "A2: nach der leeren Antwort steht der Endsatz");
		assert.strictEqual(b.uhr.offen(), 0, "A2: der Wecker ist geloescht");
		b.uhr.vor(1000);
		assert.strictEqual(b.status.textContent, NICHTS, "A2: und kein spaeter Wecker ueberschreibt ihn");
	}

	// A3) Lokal gibt es Treffer -> kein „Suche läuft …“: der Besucher sieht eine Liste.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [eintrag("a")];
		b.kontext.updateSpotlightSearchResults();
		assert.strictEqual(b.uhr.offen(), 0, "A3: mit lokalen Treffern wird gar kein Wecker gestellt");
		b.uhr.vor(1000);
		assert.strictEqual(b.status.hidden, true, "A3: das Statusfeld bleibt zu");
	}

	// A4) Weitertippen vor Ablauf -> der Wecker der alten Suche feuert NICHT, der der neuen schon.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		b.uhr.vor(200);
		b.kontext.updateSpotlightSearchResults();
		assert.strictEqual(b.uhr.offen(), 1, "A4: es steht genau EIN Wecker -- der alte ist geloescht");
		b.uhr.vor(150);
		assert.strictEqual(b.status.hidden, true, "A4: 350 ms nach der ersten, 150 ms nach der zweiten Suche -- noch still");
		b.uhr.vor(150);
		assert.strictEqual(b.status.textContent, SUCHE, "A4: 300 ms nach der zweiten Suche steht „Suche läuft …“");
	}

	// A5) Schliessen vor Ablauf -> kein Wecker ueberlebt das Fenster.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		b.kontext.closeSpotlightSearch();
		assert.strictEqual(b.uhr.offen(), 0, "A5: das Schliessen loescht den Wecker");
		b.uhr.vor(1000);
		assert.strictEqual(b.status.hidden, true, "A5: das geschlossene Fenster bekommt keinen Satz mehr");
	}

	// A6) Der Abruf scheitert VOR Ablauf -> der Fehlersatz bleibt stehen.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		b.server.ablehnen(new Error("HTTP 503"));
		await b.mikrotasks();
		assert.strictEqual(b.status.textContent, FEHLER, "A6: der Fehlersatz steht");
		b.uhr.vor(1000);
		assert.strictEqual(b.status.textContent, FEHLER, "A6: und „Suche läuft …“ ueberschreibt ihn nicht");
	}

	// A7) Der Abruf scheitert NACH Ablauf -> aus „Suche läuft …“ wird der Fehlersatz.
	{
		const b = machBuehne();
		b.kontext.updateSpotlightSearchResults();
		b.uhr.vor(400);
		assert.strictEqual(b.status.textContent, SUCHE);
		b.server.ablehnen(new Error("HTTP 503"));
		await b.mikrotasks();
		assert.strictEqual(b.status.textContent, FEHLER, "A7: der Fehlschlag loest „Suche läuft …“ ab");
	}

	// ---- B) Die Auswahl -----------------------------------------------------------------------

	const a = eintrag("a"), bb = eintrag("b"), c = eintrag("c"), x = eintrag("x"), y = eintrag("y");

	// B1) Pfeiltaste waehlt c, der Server stellt um -> c bleibt markiert, und Enter nimmt c.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 0, "B1: vorgabe ist der erste Treffer");
		b.taste("ArrowDown");
		b.taste("ArrowDown");
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 2);
		b.server.aufloesen([x, y, a, c, bb]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 3, "B1: c steht jetzt an Platz 4 und ist dort markiert");
		assert.strictEqual(b.knoepfe.liste[3].aktiv, true, "B1: der Knopf traegt die Markierung");
		assert.strictEqual(b.knoepfe.liste[3].attribute["aria-selected"], "true");
		assert.strictEqual(b.knoepfe.liste[2].aktiv, false, "B1: der alte Index ist NICHT mehr markiert");
		b.taste("Enter");
		assert.deepStrictEqual(b.gewaehlt.map((t) => t.id), [c.id], "B1: Enter waehlt, was markiert war");
	}

	// B2) Ohne eigene Wahl rueckt die Markierung wie bisher auf den neuen ersten Treffer.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.server.aufloesen([x, a, bb]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 0, "B2: ohne Wahl gilt der erste Treffer");
		assert.strictEqual(b.kontext.spotlightRenderedEntries[0].id, x.id);
	}

	// B3) Der gewaehlte Treffer faellt aus der Liste -> zurueck auf den ersten, und die Wahl ist vergessen.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.taste("ArrowDown");
		b.server.aufloesen([x, a, c]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 0, "B3: verschwundene Wahl -> erster Treffer");
		assert.strictEqual(b.kontext.spotlightUserChosenEntryId, "", "B3: und die Wahl ist vergessen");
	}

	// B4) Eine NEUE Suche verwirft die Wahl -- auch wenn derselbe Treffer wieder vorkommt.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.taste("ArrowDown");
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 1);
		b.kontext.updateSpotlightSearchResults();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 0, "B4: die neue Suche beginnt oben");
	}

	// B5) Die Maus waehlt genauso wie die Pfeiltaste.
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.mausUeber(2);
		// 💣 c darf NICHT an Platz 1 landen: dort stuende es auch ohne Wahl, und der Fall pruefte nichts.
		b.server.aufloesen([x, c, a]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 1, "B5: c ist an Platz 2 gerueckt und bleibt markiert");
		assert.strictEqual(b.kontext.spotlightRenderedEntries[1].id, c.id);
	}
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.mausUeber(2);
		b.server.aufloesen([x, y, a, bb, c]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 4, "B5: die Mauswahl wandert mit an Platz 5");
	}

	// B6) ArrowUp waehlt ebenfalls (vom ersten Treffer auf den letzten).
	{
		const b = machBuehne();
		b.kontext.lokaleTreffer = [a, bb, c];
		b.kontext.updateSpotlightSearchResults();
		b.taste("ArrowUp");
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 2);
		// Wieder NICHT an Platz 1 -- sonst saehe die verlorene Wahl genauso aus wie die gehaltene.
		b.server.aufloesen([x, c, y]);
		await b.mikrotasks();
		assert.strictEqual(b.kontext.spotlightActiveResultIndex, 1, "B6: ArrowUp-Wahl ueberlebt die Umstellung");
	}

	// ---- C) Die englische Fassung -----------------------------------------------------------------
	// Eine fehlende Zeile ist lautlos: tr() faellt auf das deutsche Wort zurueck.
	{
		const i18nKontext = { window: {} };
		vm.runInNewContext(lies("js", "app", "i18n-en.js"), i18nKontext);
		const englisch = i18nKontext.window.AVESMAPS_I18N_EN;
		assert.ok(englisch["spotlight.searching"], "spotlight.searching fehlt in js/app/i18n-en.js");
		const enKontext = { String, Number, Boolean, tr: (schluessel) => englisch[schluessel] };
		vm.runInNewContext(schneide("normalizeSpotlightSearchText") + schneide("spotlightSearchStatusText"), enKontext);
		assert.strictEqual(
			enKontext.spotlightSearchStatusText({ query: "xyzq", resultCount: 0, backendPending: true, backendSlow: true }),
			englisch["spotlight.searching"],
			"„Suche läuft …“ geht durch tr()"
		);
	}

	console.log("spotlight-wartezeit-und-auswahl: OK");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
