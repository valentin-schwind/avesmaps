// KORREKTUR B (Owner-Nachtrag 30.08.2026, wörtlich: „kein automatischer Treffer nach Namen ->
// TROTZDEM WILL ICH DIE WIKI-SYNC SUCHE!") -- ohne automatischen Treffer erscheint jetzt eine
// bedienbare Suche statt nur eines Satzes.
//
// 🔴 WARUM WEDER js/ui/wiki-assign.js NOCH ein eigener `fetch(`: siehe den Kopfkommentar an
// garetienWikiSucheBeiBedarfZeigen (review-garetien-importer.js) und den Aufgabenbericht. Diese
// Suche geht durch DIESELBE `avesmapsGaretienRufe` und dieselbe Server-Aktion ('wiki_landschaft')
// wie die automatische Zeile daneben -- nur mit einem vom Editor eingetragenen Namen statt dem
// Namen des Vorschlags.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-wiki-suche.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet
// (`typeof document !== "undefined"`) -- `global.document` muss deshalb VOR dem `require` stehen
// (Vorbild: garetien-fussknopf-dom.test.js, garetien-eingefuegt-wird.test.js).

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
const ruhe = () => new Promise((fertig) => setTimeout(fertig, 0));

// ---- Das gefälschte `document`/`window` -- VOR jedem require, aus demselben Grund wie im Vorbild.
function macheElement(id) {
	return {
		id: id, hidden: true, innerHTML: "", textContent: "",
		addEventListener() {}, removeEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		contains() { return true; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienWikiSucheHostId,
	garetienWikiSucheBeiBedarfZeigen,
	garetienWikiSucheMarkup,
	garetienWikiSucheZustandZu,
	garetienWikiLandschaftBeiBedarfLaden,
	garetienEingefuegtWirdMarkup,
	garetienWikiLandschaftPlatzhalterId,
} = mod;

wahr(typeof garetienWikiSucheHostId === "function", "garetienWikiSucheHostId fehlt im Export");
wahr(typeof garetienWikiSucheBeiBedarfZeigen === "function", "garetienWikiSucheBeiBedarfZeigen fehlt im Export");
wahr(typeof garetienWikiSucheMarkup === "function", "garetienWikiSucheMarkup fehlt im Export");
wahr(typeof garetienWikiSucheZustandZu === "function", "garetienWikiSucheZustandZu fehlt im Export");

const huegel = {
	key: "ggp:Berge:Huegel:Garetien:Testhuegel", name: "Testhuegel", typ: "Huegel",
	subtyp: "huegelland", kind: "topographie", ziel: "region", wiki: "ggp",
	quelle: { label: "Briefspiel (Garetien)" },
	abschnitte: [],
	items: [{ id: 1, change_type: "new", anlass: null }],
};

// =================================================================================================
// A. garetienWikiSucheHostId -- die Id, eine reine Funktion
// =================================================================================================

gleich(garetienWikiSucheHostId(huegel), "gi-wiki-suche-" + huegel.key, "die Id traegt den Objektschluessel");
gleich(garetienWikiSucheHostId(null), "gi-wiki-suche-", "ohne Objekt ein leerer, aber gueltiger Suffix");

// =================================================================================================
// B. garetienEingefuegtWirdMarkup -- der versteckte Host steht NUR bei ziel='region'
// =================================================================================================

const mHuegel = garetienEingefuegtWirdMarkup(huegel);
wahr(mHuegel.includes('id="' + garetienWikiSucheHostId(huegel) + '"'),
	"der Host fuer die manuelle Suche fehlt im Markup einer Flaeche");
wahr(/id="gi-wiki-suche-[^"]*"\s+hidden/.test(mHuegel),
	"der Host muss VERSTECKT starten -- er erscheint erst, wenn der automatische Treffer leer bleibt");

const gipfel = {
	key: "ggp:Berge:Berg:Garetien:Testgipfel", name: "Testgipfel", typ: "Berg",
	subtyp: "berggipfel", kind: "", ziel: "label", wiki: "ggp", abschnitte: [],
	items: [{ id: 2, change_type: "new" }],
};
wahr(!garetienEingefuegtWirdMarkup(gipfel).includes("gi-wiki-suche-"),
	"ein Berggipfel bekommt keinen Suche-Host -- er bekam auch die automatische Zeile nie "
	+ "(garetien-eingefuegt-wird.test.js, Abschnitt D)");

// =================================================================================================
// C. garetienWikiSucheBeiBedarfZeigen -- zeigt NUR bei kein_treffer/mehrdeutig
// =================================================================================================

function machHost() {
	const zuhoerer = {};
	return {
		hidden: true, textContent: "", innerHTML: "",
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		contains() { return true; },
		feuere(typ, ziel, ereignisExtra) {
			if (zuhoerer[typ]) {
				zuhoerer[typ](Object.assign({ target: ziel, preventDefault() {} }, ereignisExtra || {}));
			}
		},
	};
}
function scheinZiel(merkmal, wert, extra) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, extra || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

["passt", "warnung", "", undefined].forEach((status) => {
	const host = machHost();
	host.hidden = false; // absichtlich sichtbar vorbelegt -- die Funktion muss es AKTIV verstecken
	ELEMENTE[garetienWikiSucheHostId(huegel)] = host;
	garetienWikiSucheBeiBedarfZeigen(huegel, status);
	gleich(host.hidden, true, "Status " + JSON.stringify(status) + " darf die Suche nicht zeigen");
});

["kein_treffer", "mehrdeutig"].forEach((status) => {
	const host = machHost();
	ELEMENTE[garetienWikiSucheHostId(huegel)] = host;
	garetienWikiSucheBeiBedarfZeigen(huegel, status);
	gleich(host.hidden, false, "Status " + status + " MUSS die Suche zeigen");
	wahr(host.innerHTML.includes("gi-search") && host.innerHTML.includes("data-gws-suchen"),
		"die Suche wurde nicht wirklich gezeichnet (kein Eingabefeld/Knopf): " + host.innerHTML);
});

// Ohne Host im DOM (z. B. ein Ort/Weg ohne diese Zeile) darf nichts geworfen werden.
delete ELEMENTE[garetienWikiSucheHostId(huegel)];
garetienWikiSucheBeiBedarfZeigen(huegel, "kein_treffer");
checks++;

// =================================================================================================
// D. Die Suche selbst -- ECHT gefahren, mit untergeschobenem `fetch` (avesmapsGaretienRufe ruft es)
// =================================================================================================

async function pruefeSuche() {
	const echtesFetch = global.fetch;
	const gesendet = [];
	global.fetch = function (url, optionen) {
		gesendet.push({ url: String(url), rumpf: JSON.parse((optionen && optionen.body) || "{}") });
		return Promise.resolve({
			json: () => Promise.resolve({
				ok: true,
				wiki_landschaft: { status: "passt", name: "Farindeltal", art: "Tal" },
			}),
		});
	};
	try {
		const host = machHost();
		ELEMENTE[garetienWikiSucheHostId(huegel)] = host;
		garetienWikiSucheBeiBedarfZeigen(huegel, "kein_treffer");

		// ---- Tippen (ohne Enter/Knopf) loest NICHTS aus -- nur der Knopf/Enter tut das.
		host.feuere("input", scheinZiel("data-gws-suche", "", { value: "Farindeltal" }));
		await ruhe();
		gleich(gesendet.length, 0, "blosses Tippen darf noch keine Anfrage ausloesen");
		checks++;

		// ---- "Suchen" fragt DIESELBE Aktion wie die automatische Zeile, mit dem eingetragenen Namen.
		host.feuere("click", scheinZiel("data-gws-suchen", ""));
		await ruhe();
		gleich(gesendet.length, 1, "der Knopf muss GENAU EINE Anfrage ausloesen: " + JSON.stringify(gesendet));
		wahr(gesendet[0].url.indexOf("garetien-import.php") !== -1,
			"die manuelle Suche muss ueber denselben Endpunkt laufen wie die automatische Zeile: "
			+ JSON.stringify(gesendet));
		gleich(gesendet[0].rumpf.action, "wiki_landschaft", "dieselbe Aktion wie die automatische Zeile");
		gleich(gesendet[0].rumpf.name, "Farindeltal", "der EDITOR-eingetragene Name wird gesendet, nicht der Vorschlagsname");
		gleich(gesendet[0].rumpf.subtyp, "huegelland", "der Zielsubtyp des Vorschlags reist mit");
		checks += 5;

		wahr(host.innerHTML.includes("Farindeltal") && host.innerHTML.includes("Name und Art passen"),
			"das Ergebnis muss mit derselben Textbildung wie die automatische Zeile erscheinen: " + host.innerHTML);
		checks++;

		// ---- Ein ANDERES Objekt kennt den Versuch des ersten nicht.
		const see = Object.assign({}, huegel, { key: "ggp:Gewaesser:See:Garetien:Testsee", subtyp: "see" });
		const hostSee = machHost();
		ELEMENTE[garetienWikiSucheHostId(see)] = hostSee;
		garetienWikiSucheBeiBedarfZeigen(see, "kein_treffer");
		wahr(!hostSee.innerHTML.includes("Farindeltal") && hostSee.innerHTML.includes("gi-search"),
			"ein anderes Objekt darf den Versuch des ersten nicht zeigen: " + hostSee.innerHTML);
		checks++;

		// ---- Enter loest dieselbe Suche aus wie der Knopf.
		global.fetch = function (url, optionen) {
			gesendet.push({ url: String(url), rumpf: JSON.parse((optionen && optionen.body) || "{}") });
			return Promise.resolve({
				json: () => Promise.resolve({ ok: true, wiki_landschaft: { status: "kein_treffer", name: "", art: "" } }),
			});
		};
		const vorher = gesendet.length;
		host.feuere("input", scheinZiel("data-gws-suche", "", { value: "Ganz anderer Name" }));
		host.feuere("keydown", scheinZiel("data-gws-suche", ""), { key: "Enter" });
		await ruhe();
		gleich(gesendet.length, vorher + 1, "Enter muss dieselbe Suche wie der Knopf ausloesen");
		gleich(gesendet[gesendet.length - 1].rumpf.name, "Ganz anderer Name",
			"Enter muss den zuletzt getippten Namen senden");
		checks += 2;

		// ---- Ein Fehlschlag der Suche wird BENANNT, nicht verschluckt.
		global.fetch = function () { return Promise.reject(new Error("Netzwerk aus")); };
		const anderesObjekt = Object.assign({}, huegel, { key: "ggp:Fehler:Testobjekt" });
		const hostFehler = machHost();
		ELEMENTE[garetienWikiSucheHostId(anderesObjekt)] = hostFehler;
		garetienWikiSucheBeiBedarfZeigen(anderesObjekt, "kein_treffer");
		hostFehler.feuere("input", scheinZiel("data-gws-suche", "", { value: "x" }));
		hostFehler.feuere("click", scheinZiel("data-gws-suchen", ""));
		await ruhe();
		wahr(hostFehler.innerHTML.includes("Suche fehlgeschlagen"),
			"ein Fehlschlag der Suche muss benannt werden, nicht als „kein Treffer” erscheinen: "
			+ hostFehler.innerHTML);
		checks++;
	} finally {
		if (echtesFetch) { global.fetch = echtesFetch; } else { delete global.fetch; }
	}
}

// =================================================================================================
// E. Integration: garetienWikiLandschaftBeiBedarfLaden zeigt die Suche automatisch bei kein_treffer
// =================================================================================================

async function pruefeIntegration() {
	global.fetch = function (url, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		if (rumpf.name === huegel.name) {
			// Der AUTOMATISCHE Aufruf (mit dem eigenen Namen des Vorschlags) findet nichts.
			return Promise.resolve({
				json: () => Promise.resolve({ ok: true, wiki_landschaft: { status: "kein_treffer", name: "", art: "" } }),
			});
		}
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, wiki_landschaft: { status: "passt", name: rumpf.name, art: "Tal" } }),
		});
	};
	try {
		const integrationsObjekt = Object.assign({}, huegel, { key: "ggp:Integration:Testflaeche" });
		const platzhalter = macheElement(garetienWikiLandschaftPlatzhalterId(integrationsObjekt));
		ELEMENTE[platzhalter.id] = platzhalter;
		const host = machHost();
		ELEMENTE[garetienWikiSucheHostId(integrationsObjekt)] = host;

		mod.garetienDetailWaehlen(integrationsObjekt.key, [integrationsObjekt]);
		await ruhe();
		await ruhe();

		gleich(platzhalter.textContent, "kein automatischer Treffer nach Namen",
			"die automatische Zeile muss weiterhin den Text der Server-Antwort tragen");
		gleich(host.hidden, false,
			"ohne automatischen Treffer MUSS die manuelle Suche automatisch erscheinen -- keine "
			+ "Sackgasse mehr (Owner: „kein automatischer Treffer nach Namen -> TROTZDEM WILL ICH "
			+ "DIE WIKI-SYNC SUCHE!\")");
		checks += 2;

		// Und die manuelle Suche mit einem anderen Namen findet tatsaechlich etwas.
		host.feuere("input", scheinZiel("data-gws-suche", "", { value: "Farindeltal (alt)" }));
		host.feuere("click", scheinZiel("data-gws-suchen", ""));
		await ruhe();
		wahr(host.innerHTML.includes("Farindeltal (alt)") && host.innerHTML.includes("Name und Art passen"),
			"die manuelle Suche mit einem abweichenden Namen muss ihr Ergebnis zeigen: " + host.innerHTML);
		checks++;
	} finally {
		delete global.fetch;
	}
}

pruefeSuche()
	.then(pruefeIntegration)
	.then(function () {
		console.log("garetien-wiki-suche: " + checks + " Pruefungen bestanden.");
	})
	.catch(function (fehler) {
		console.error(fehler);
		process.exitCode = 1;
	});
