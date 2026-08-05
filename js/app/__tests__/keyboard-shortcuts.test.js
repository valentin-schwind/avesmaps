// Die Tastaturbefehle der Karte (js/app/keyboard-shortcuts.js).
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox mit einem winzigen, aber ECHT reagierenden
// DOM -- nicht eine abgeschriebene Kopie der Regeln. Der Grund steht in
// [[vm-sandbox-stub-swallows-rule]]: wo ein Test die geprüfte Funktion wegstubbt, zertifiziert er
// die Notbremse statt der Regel und ist grün, während die Anzeige falsch ist. Deshalb kommen
// Riegel-Selektoren und Werkzeugklassen aus dem Modul selbst, und jede Wirkung wird an einer
// Aufzeichnung gemessen (welcher Knopf wurde geklickt, wie weit ist die Karte gesprungen).
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/keyboard-shortcuts.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const MODULE_PATH = path.join(ROOT, "js", "app", "keyboard-shortcuts.js");

// ---- Ein DOM, klein genug zum Lesen und echt genug zum Antworten ---------------------------------

// `closest()` entscheidet über den Riegel. Es bekommt die ECHTE Selektorliste aus dem Modul und
// vergleicht sie gegen die Marken, die der Test einem Element gibt. Wird der Selektor im Modul
// enger gefasst, passt die Marke nicht mehr und der Test fällt auf -- genau das ist gewollt.
function makeElement(selectors, extra) {
	const element = Object.assign({
		_selectors: selectors || [],
		classList: {
			_set: new Set(),
			contains(name) { return this._set.has(name); },
			add(name) { this._set.add(name); },
			remove(name) { this._set.delete(name); }
		},
		closest(selectorList) {
			const tokens = String(selectorList).split(",").map((token) => token.trim());
			return element._selectors.some((own) => tokens.includes(own)) ? element : null;
		},
		getClientRects() { return element._visible === false ? [] : [{}]; }
	}, extra || {});
	return element;
}

function makeCreatedElement(tagName) {
	const node = {
		tagName,
		children: [],
		attributes: {},
		textContent: "",
		className: "",
		append(...nodes) { node.children.push(...nodes); },
		replaceChildren(...nodes) { node.children = [...nodes]; },
		setAttribute(name, value) { node.attributes[name] = value; }
	};
	return node;
}

function loadModule({ mapContainerClasses = [], dialogs = [], picking = null } = {}) {
	const log = {
		keydownHandlers: [],
		panBy: [],
		zoomIn: 0,
		zoomOut: 0,
		keyboardDisabled: false,
		locationClicks: [],
		radioClicks: [],
		layerModeSets: [],
		spotlightOpened: 0,
		waypointsAppended: 0,
		waypointFocused: 0,
		i18nApplied: []
	};

	const mapContainer = makeElement([]);
	mapContainerClasses.forEach((name) => mapContainer.classList.add(name));

	const locationButtons = [0, 1, 2, 3, 4, 5].map((index) =>
		makeElement([], { click() { log.locationClicks.push(index); } }));

	const layerOptions = {
		none: { disabled: false },
		original: { disabled: false },
		political: { disabled: false },
		deregraphic: { disabled: false },
		powerlines: { disabled: false },
		// „ecosystem" ist NICHT gesperrt: die Ebene darf seit 2026-08-04 jeder ansehen, und seit
		// 2026-08-05 hat sie mit „L" eine eigene Taste (map-features-display-mode.js:176).
		ecosystem: { disabled: false }
	};
	const layerSelect = makeElement([], {
		value: "deregraphic",
		querySelector(selector) {
			const match = /option\[value="([^"]+)"\]/.exec(selector);
			return match ? (layerOptions[match[1]] || null) : null;
		}
	});

	const radios = {
		fastestPath: makeElement([], { checked: true, click() { log.radioClicks.push("fastestPath"); } }),
		shortestPath: makeElement([], { checked: false, click() { log.radioClicks.push("shortestPath"); } })
	};

	const mountNode = makeCreatedElement("div");

	const documentStub = {
		readyState: "complete",
		activeElement: makeElement([]),
		addEventListener(type, handler) {
			if (type === "keydown") { log.keydownHandlers.push(handler); }
		},
		createElement: makeCreatedElement,
		getElementById(id) {
			if (id === "legal-shortcuts") { return mountNode; }
			if (id === "mapLayerModeSelect") { return layerSelect; }
			return radios[id] || null;
		},
		querySelectorAll(selector) {
			if (selector.includes(".location-toggle")) { return locationButtons; }
			if (selector.includes("[role='dialog']")) { return dialogs; }
			return [];
		},
		querySelector(selector) {
			if (selector.includes("--picking")) { return picking; }
			return null;
		}
	};

	const mapStub = {
		keyboard: { disable() { log.keyboardDisabled = true; } },
		getContainer() { return mapContainer; },
		panBy(offset) { log.panBy.push(offset); },
		zoomIn() { log.zoomIn += 1; },
		zoomOut() { log.zoomOut += 1; }
	};

	const sandbox = {
		console,
		document: documentStub,
		map: mapStub,
		Math,
		// 💣 Die Wirkungen laufen ECHT durch, nicht gegen Stubs, die sie schlucken. Was hier fehlt,
		// wird im Modul zum stillen No-op -- deshalb steht jede aufgerufene Funktion hier drin.
		currentRoutePlanEntries: [{}, {}, {}],
		activeRoutePlanEntryIndex: null
	};
	sandbox.window = sandbox;
	sandbox.window.jQuery = function (element) {
		return {
			val(value) { log.layerModeSets.push(value); return this; },
			trigger() { return this; }
		};
	};
	sandbox.window.openSpotlightSearch = function () { log.spotlightOpened += 1; };
	sandbox.window.appendWaypointInput = function () {
		log.waypointsAppended += 1;
		return { focus() { log.waypointFocused += 1; } };
	};
	sandbox.window.scrollWaypointInputIntoView = function () {};
	sandbox.window.selectRoutePlanEntry = function (index, options) {
		sandbox.activeRoutePlanEntryIndex = index;
		log.legSelections = log.legSelections || [];
		log.legSelections.push({ index, options });
	};
	sandbox.window.applyI18nOverlay = function (node) { log.i18nApplied.push(node); };
	sandbox.window.tr = function (key, german) { return german; };

	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(MODULE_PATH, "utf8"), sandbox, { filename: MODULE_PATH });

	const api = sandbox.window.avesmapsKeyboardShortcuts;
	assert.ok(api, "das Modul muss window.avesmapsKeyboardShortcuts setzen");
	assert.strictEqual(log.keydownHandlers.length, 1, "genau ein keydown-Handler");

	function press(key, options = {}) {
		let prevented = 0;
		const event = Object.assign({
			key,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			target: sandbox.document.activeElement,
			preventDefault() { prevented += 1; }
		}, options);
		log.keydownHandlers[0](event);
		return prevented;
	}

	return { api, log, press, sandbox, mountNode, mapContainer, layerSelect, radios };
}

// ⚠️ Alles, was IM Sandkasten entstanden ist (die Sprungweite, die Optionen der Etappenwahl, jede
// Liste aus api.entries), traegt dort seinen eigenen Array/Object-Prototyp. `deepStrictEqual`
// vergleicht auch den und meldet sonst „same structure but not reference-equal". Ueber JSON in
// diese Welt heruebergeholt, vergleicht sich der INHALT -- und nur um den geht es hier.
function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

let failures = 0;
function check(name, run) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`  FAIL ${name}\n       ${error.message}`);
	}
}

// ---- Die Tabelle ist widerspruchsfrei ------------------------------------------------------------

const { api } = loadModule();

check("keine Taste ist doppelt belegt", () => {
	const seen = new Map();
	api.entries.forEach((entry) => {
		entry.keys.forEach((key) => {
			assert.ok(!seen.has(key),
				`"${key}" ist zweimal belegt: ${seen.get(key)} und ${entry.id}`);
			seen.set(key, entry.id);
		});
	});
	assert.ok(seen.size >= 25, `Gegenprobe: es sollten viele Tasten sein, gezaehlt ${seen.size}`);
});

check("jede Zeile hat Kappen und eine deutsche Erklaerung", () => {
	api.entries.forEach((entry) => {
		assert.ok(entry.caps.length > 0, `${entry.id}: keine Tastenkappe`);
		assert.ok(entry.de && entry.de.trim(), `${entry.id}: keine Erklaerung`);
		assert.ok(/^shortcuts\.row\./.test(entry.i18n), `${entry.id}: kein shortcuts.row.*-Schluessel`);
	});
});

check("nur Esc und der Umschalt-Hinweis sind reine Erklaerungszeilen", () => {
	const passive = plain(api.entries.filter((entry) => entry.passive).map((entry) => entry.id));
	assert.deepStrictEqual(passive.sort(), ["close", "panFast"]);
	api.entries.filter((entry) => entry.passive)
		.forEach((entry) => assert.deepStrictEqual(plain(entry.keys), [], `${entry.id} darf keine Taste beanspruchen`));
});

// ---- Der Owner-Entscheid: Strg/Alt/Meta gehoeren dem Browser ------------------------------------

check("kein einziger Befehl greift mit Strg, Alt oder Meta", () => {
	const claimed = [];
	api.entries.forEach((entry) => {
		entry.keys.forEach((key) => {
			["ctrlKey", "altKey", "metaKey"].forEach((modifier) => {
				const event = { key, ctrlKey: false, altKey: false, metaKey: false };
				event[modifier] = true;
				if (api.match(event)) { claimed.push(`${modifier}+${key}`); }
			});
		});
	});
	assert.deepStrictEqual(claimed, [],
		"Strg+R muss neu laden, Strg+P drucken, Strg+F suchen -- das war der Entscheid vom 2026-08-05");
});

check("Gross- und Kleinschreibung sind dieselbe Taste", () => {
	assert.strictEqual(api.match({ key: "O" }).id, "modeOriginal");
	assert.strictEqual(api.match({ key: "o" }).id, "modeOriginal");
	assert.strictEqual(api.match({ key: "ArrowLeft" }).id, "panLeft");
});

// ---- Die Wirkungen laufen wirklich --------------------------------------------------------------

check("F und Leertaste oeffnen die Suche", () => {
	const t = loadModule();
	assert.strictEqual(t.press("f"), 1, "der Tastendruck gehoert uns, also preventDefault");
	assert.strictEqual(t.log.spotlightOpened, 1);
	t.press(" ");
	assert.strictEqual(t.log.spotlightOpened, 2);
});

check("R legt ein Zielfeld an und setzt den Cursor hinein", () => {
	const t = loadModule();
	t.press("r");
	assert.strictEqual(t.log.waypointsAppended, 1);
	assert.strictEqual(t.log.waypointFocused, 1);
});

check("die Pfeiltasten schieben, Umschalt verdreifacht, Buchstaben schieben NICHT mehr", () => {
	const t = loadModule();
	t.press("ArrowUp");
	assert.deepStrictEqual(plain(t.log.panBy[0]), [0, -80]);
	t.press("ArrowRight");
	assert.deepStrictEqual(plain(t.log.panBy[1]), [80, 0]);
	t.press("ArrowLeft", { shiftKey: true });
	assert.deepStrictEqual(plain(t.log.panBy[2]), [-240, 0], "Umschalt verdreifacht den Schritt");
	t.press("ArrowDown");
	assert.deepStrictEqual(plain(t.log.panBy[3]), [0, 80]);
	// 🪤 W A S D schoben bis 2026-08-05 mit. „S" gehoert jetzt der Ansicht „Standard", und weil
	// matchShortcut die ERSTE Zeile mit der Taste nimmt und Schieben vor den Ansichten steht, waere
	// „S" nie dort angekommen. Drei Richtungen als Buchstabe zu behalten und eine nicht waere die
	// schlechteste Fassung gewesen -- also schiebt kein Buchstabe mehr.
	["w", "a", "s", "d"].forEach((key) => t.press(key));
	assert.strictEqual(t.log.panBy.length, 4, "kein Buchstabe darf die Karte noch schieben");
});

check("Leaflets eigene Tastatursteuerung wird abgeschaltet", () => {
	const t = loadModule();
	assert.strictEqual(t.log.keyboardDisabled, true,
		"sonst springt die Karte doppelt, sobald sie den Fokus hat");
});

check("+ und - zoomen", () => {
	const t = loadModule();
	t.press("+");
	t.press("=");
	t.press("-");
	assert.strictEqual(t.log.zoomIn, 2);
	assert.strictEqual(t.log.zoomOut, 1);
});

check("O P K S L I schalten die sechs Ansichten", () => {
	const t = loadModule();
	// Die Buchstaben sind Merkhilfen: Original, Politisch, Kraftlinien, Standard, Landschaften.
	// „I" fuer „Nur Karte" ist die Ausnahme -- N gehoerte schon niemandem, und I stand frei.
	["o", "p", "k", "s", "l", "i"].forEach((key) => {
		t.layerSelect.value = "__nichts__";
		t.press(key);
	});
	assert.deepStrictEqual(t.log.layerModeSets,
		["original", "political", "powerlines", "deregraphic", "ecosystem", "none"]);
});

check("eine gesperrte Ansicht bleibt gesperrt", () => {
	const t = loadModule();
	// Im Aufbau ist keine Ansicht gesperrt (alle sechs stehen jedem offen). Die Probe gilt dem
	// Riegel selbst: ein gesperrtes <option> darf nie geschaltet werden, egal welches.
	t.layerSelect.querySelector('option[value="political"]').disabled = true;
	t.press("p");
	assert.deepStrictEqual(t.log.layerModeSets, []);
});

check("die schon gewaehlte Ansicht loest nichts aus", () => {
	const t = loadModule();
	t.layerSelect.value = "deregraphic";
	t.press("s");
	assert.deepStrictEqual(t.log.layerModeSets, []);
});

check("1 bis 6 klicken den n-ten Ortsklassen-Knopf, 7 gehoert uns nicht", () => {
	const t = loadModule();
	["1", "2", "3", "4", "5", "6"].forEach((key) => t.press(key));
	assert.deepStrictEqual(t.log.locationClicks, [0, 1, 2, 3, 4, 5]);
	assert.strictEqual(t.press("7"), 0, "die 7 darf durchfallen -- es gibt nur sechs Klassen");
	assert.deepStrictEqual(t.log.locationClicks, [0, 1, 2, 3, 4, 5]);
});

check("Pos 1 und Ende waehlen schnellste und kuerzeste Route", () => {
	const t = loadModule();
	t.press("End");
	assert.deepStrictEqual(t.log.radioClicks, ["shortestPath"]);
	// "Schnellste" ist bereits gewaehlt -> kein Klick, denn ein gewaehltes Radio feuert kein change.
	t.press("Home");
	assert.deepStrictEqual(t.log.radioClicks, ["shortestPath"]);
	t.radios.fastestPath.checked = false;
	t.press("Home");
	assert.deepStrictEqual(t.log.radioClicks, ["shortestPath", "fastestPath"]);
});

check("Bild ab steigt bei der ersten Etappe ein, Bild auf bei der letzten", () => {
	const vorwaerts = loadModule();
	vorwaerts.press("PageDown");
	assert.strictEqual(vorwaerts.log.legSelections[0].index, 0);
	vorwaerts.press("PageDown");
	assert.strictEqual(vorwaerts.log.legSelections[1].index, 1);
	assert.deepStrictEqual(plain(vorwaerts.log.legSelections[1].options), { zoomToEntry: true, scrollPlan: true });

	const rueckwaerts = loadModule();
	rueckwaerts.press("PageUp");
	assert.strictEqual(rueckwaerts.log.legSelections[0].index, 2, "drei Etappen -> die letzte ist 2");
});

check("die Etappenwahl laeuft nicht ueber die Enden hinaus", () => {
	const t = loadModule();
	t.sandbox.activeRoutePlanEntryIndex = 2;
	t.press("PageDown");
	assert.strictEqual(t.log.legSelections[0].index, 2);
	t.sandbox.activeRoutePlanEntryIndex = 0;
	t.press("PageUp");
	assert.strictEqual(t.log.legSelections[1].index, 0);
});

check("ohne Route tut Bild auf/ab nichts", () => {
	const t = loadModule();
	t.sandbox.currentRoutePlanEntries = [];
	t.press("PageDown");
	assert.strictEqual(t.log.legSelections, undefined);
});

// ---- Der Riegel ---------------------------------------------------------------------------------

check("waehrend des Tippens wirkt keine Taste", () => {
	const t = loadModule();
	const feld = makeElement(["input"]);
	t.sandbox.document.activeElement = feld;
	assert.strictEqual(t.press("o", { target: feld }), 0);
	assert.deepStrictEqual(t.log.layerModeSets, []);
	// Gegenprobe: dieselbe Taste ausserhalb des Feldes wirkt.
	t.sandbox.document.activeElement = makeElement([]);
	t.layerSelect.value = "__nichts__";
	t.press("o", { target: makeElement([]) });
	assert.deepStrictEqual(t.log.layerModeSets, ["original"]);
});

check("bei offenem Fenster wirkt keine Taste", () => {
	const t = loadModule({ dialogs: [makeElement([])] });
	assert.strictEqual(t.press("f"), 0);
	assert.strictEqual(t.log.spotlightOpened, 0);
});

check("ein unsichtbares Fenster im Markup riegelt nicht", () => {
	const verborgen = makeElement([]);
	verborgen._visible = false;
	const t = loadModule({ dialogs: [verborgen] });
	t.press("f");
	assert.strictEqual(t.log.spotlightOpened, 1);
});

check("jedes laufende Werkzeug riegelt -- vor allem die Leertaste am Pinsel", () => {
	api.toolClasses.forEach((klasse) => {
		const t = loadModule({ mapContainerClasses: [klasse] });
		assert.strictEqual(t.press(" "), 0, `${klasse} muss die Leertaste durchlassen`);
		assert.strictEqual(t.log.spotlightOpened, 0, `${klasse}: die Suche darf nicht aufgehen`);
		assert.strictEqual(t.press("d"), 0, `${klasse} muss auch Buchstaben durchlassen`);
	});
	assert.ok(api.toolClasses.length >= 6, "Gegenprobe: die Werkzeugliste darf nicht leer sein");
});

check("ein Anklick-Modus an den Panes riegelt ebenfalls", () => {
	const t = loadModule({ picking: makeElement([]) });
	assert.strictEqual(t.press("f"), 0);
	assert.strictEqual(t.log.spotlightOpened, 0);
});

check("die Leertaste gehoert dem Knopf, der gerade den Fokus hat", () => {
	const t = loadModule();
	t.sandbox.document.activeElement = makeElement(["button"]);
	assert.strictEqual(t.press(" "), 0, "sonst oeffnet sich die Suche statt des Knopfes");
	assert.strictEqual(t.log.spotlightOpened, 0);
	// F ist davon NICHT betroffen: ein Knopf tut mit F nichts.
	t.press("f");
	assert.strictEqual(t.log.spotlightOpened, 1);
});

check("eine fokussierte Etappenzeile behaelt ihre Leertaste", () => {
	const t = loadModule();
	t.sandbox.document.activeElement = makeElement(["[role='button']"]);
	assert.strictEqual(t.press(" "), 0);
	assert.strictEqual(t.log.spotlightOpened, 0);
});

// ---- Die Tabelle in den Hinweisen ---------------------------------------------------------------

check("die Tabelle wird aus derselben Liste gebaut", () => {
	const t = loadModule();
	const table = t.mountNode.children[0];
	assert.ok(table, "es muss eine Tabelle im Kasten stehen");
	const body = table.children[1];
	assert.strictEqual(body.children.length, api.entries.length,
		"eine Zeile je Eintrag -- die Tabelle ist die Belegung, nicht ihre Abschrift");
	const ersteZeile = body.children[0];
	const ersteKappe = ersteZeile.children[0].children[0];
	assert.strictEqual(ersteKappe.textContent, "F");
	assert.strictEqual(ersteZeile.children[1].attributes["data-i18n"], "shortcuts.row.search");
	assert.deepStrictEqual(t.log.i18nApplied, [t.mountNode],
		"die frisch gebauten Knoten muessen den i18n-Durchlauf noch bekommen");
});

// ---- Was ausserhalb dieser Datei stimmen muss ---------------------------------------------------

const i18nSource = fs.readFileSync(path.join(ROOT, "js", "app", "i18n-en.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

check("jede Zeile und jede uebersetzte Kappe hat ihren englischen Schluessel", () => {
	const fehlend = [];
	const pruefe = (key) => {
		if (key && !i18nSource.includes(`"${key}":`)) { fehlend.push(key); }
	};
	api.entries.forEach((entry) => {
		pruefe(entry.i18n);
		entry.caps.forEach((cap) => pruefe(cap.i18n));
	});
	["shortcuts.heading", "shortcuts.intro", "shortcuts.col.keys", "shortcuts.col.action", "legal.group.usage"]
		.forEach(pruefe);
	assert.deepStrictEqual(fehlend, [], "ohne Schluessel faellt die englische Fassung auf Deutsch zurueck");
});

check("jede geschaltete Ansicht gibt es wirklich in der Auswahlbox", () => {
	const angeboten = new Set([...indexSource
		.match(/<select id="mapLayerModeSelect"[\s\S]*?<\/select>/)[0]
		.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]));
	api.entries.filter((entry) => entry.mode).forEach((entry) => {
		assert.ok(angeboten.has(entry.mode),
			`${entry.id} schaltet auf "${entry.mode}" -- das steht nicht in #mapLayerModeSelect`);
	});
	assert.strictEqual(api.entries.filter((entry) => entry.mode).length, 6, "sechs Ansichten haben eine Taste");
});

check("index.html laedt die Datei und haelt den Kasten fuer die Tabelle bereit", () => {
	assert.ok(indexSource.includes('src="js/app/keyboard-shortcuts.js"'), "das <script> fehlt");
	assert.ok(indexSource.includes('id="legal-shortcuts"'), "der Kasten in den Hinweisen fehlt");
	assert.ok(indexSource.includes('data-i18n="legal.group.usage"'), "die Gruppe Bedienung fehlt");
});

if (failures > 0) {
	console.error(`\nkeyboard-shortcuts.test: ${failures} Fehlschlag/Fehlschlaege`);
	process.exit(1);
}
console.log(`\nkeyboard-shortcuts.test: OK (${api.entries.length} Zeilen)`);
