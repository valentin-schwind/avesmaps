// „kannst du verhindern, dass die tooltips im landschaftsmodus mehrfach angezeigt werden"
// (Owner-Screenshot 24.08.2026: drei Zettel gleichzeitig -- Almada und Ragatien aus der Derographie,
// Caldaia aus der Topographie).
//
// 🔴 URSACHE, live gemessen (avesmaps.de, Zoom 3, Ansicht „Alle"): `applyEcosystemStackingOrder` rief
// `bringToFront()` auf JEDE Fläche, und Leaflets `toFront` hängt den Pfad ans Ende der Gruppe. Ein
// Schwenk, ein Lauf -- und **9 von 10 Pfaden** wurden aus dem DOM gelöst und wieder eingehängt,
// obwohl die Reihenfolge danach unverändert war (mit MutationObserver gezählt). Ein Element, das
// unter dem Zeiger aus dem DOM verschwindet, bekommt kein `mouseout` mehr, und ein Leaflet-Tooltip
// geht von selbst NUR bei `mouseout` zu.
//
// 💣 DAS IST DER DRITTE ERZEUGER DERSELBEN URSACHE: 2026-08-04 waren es die Panes auf
// `pointer-events: none`, 2026-08-23 das `display: none` der Isolation. Beide Male wurde der Erzeuger
// repariert, und beide Male kam der nächste -- css/features/ecosystem-layer.css:1358 hat ihn wörtlich
// vorhergesagt („a fifth will appear, and nobody will remember this file").
//
// ⭐ Deshalb prüft diese Datei ZWEI Dinge, nicht eins:
//   Teil 1+2 -- die Ursache: wer schon richtig liegt, wird nicht mehr angefasst.
//   Teil 3   -- den Riegel:  es gibt genau EINEN offenen Schwebezettel, egal welcher Erzeuger kommt.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.ecosystemGeometryArea = require("../map-features-ecosystem-geometry.js").ecosystemGeometryArea;
const { ecosystemPfadeEinsortieren } = require("../map-features-ecosystem-rendering.js");
assert.strictEqual(typeof ecosystemPfadeEinsortieren, "function",
	"ecosystemPfadeEinsortieren fehlt -- ohne sie prüft dieser Test nichts");

// ---- Die Bühne: eine SVG-Gruppe, die jeden Schreibzugriff mitzählt --------------------------------
//
// 🪤 `insertBefore` mit einem Bezugsknoten aus einer FREMDEN Gruppe wirft im echten DOM
// (NotFoundError). Der Nachbau wirft ebenfalls -- sonst wäre der Zwei-Panes-Fall unten grün, obwohl er
// live eine Ausnahme geworfen hätte.

function gruppe(name) {
	const kinder = [];
	const g = {
		name,
		kinder,
		schreibzugriffe: 0,
		get lastChild() {
			return kinder.length > 0 ? kinder[kinder.length - 1] : null;
		},
		appendChild(knoten) {
			loese(knoten);
			kinder.push(knoten);
			knoten.parentNode = g;
			g.schreibzugriffe += 1;
		},
		insertBefore(knoten, bezug) {
			if (!bezug || bezug.parentNode !== g) {
				throw new Error(`NotFoundError: Bezugsknoten liegt nicht in ${name}`);
			}
			loese(knoten);
			kinder.splice(kinder.indexOf(bezug), 0, knoten);
			knoten.parentNode = g;
			g.schreibzugriffe += 1;
		},
	};
	function loese(knoten) {
		const stelle = kinder.indexOf(knoten);
		if (stelle >= 0) {
			kinder.splice(stelle, 1);
		}
	}
	return g;
}

function knoten(name, g) {
	const k = {
		name,
		parentNode: g,
		get nextSibling() {
			const stelle = k.parentNode.kinder.indexOf(k);
			return stelle >= 0 && stelle + 1 < k.parentNode.kinder.length ? k.parentNode.kinder[stelle + 1] : null;
		},
	};
	g.kinder.push(k);
	return k;
}

const namen = (g) => g.kinder.map((k) => k.name).join(",");

// ---- Teil 1: Wer richtig liegt, wird NICHT angefasst ----------------------------------------------
//
// 💣 DIE ZUSICHERUNG, AN DER DER FEHLER HING. Die Vorgängerfassung hätte hier 3 Schreibzugriffe
// gemacht (jeder Pfad einmal ans Ende gehängt), obwohl die Reihenfolge davor wie danach a,b,c war --
// live 9 von 10 Pfaden bei jedem einzelnen Schwenk.

const ruhe = gruppe("derographisch");
const [rA, rB, rC] = [knoten("a", ruhe), knoten("b", ruhe), knoten("c", ruhe)];
assert.strictEqual(ecosystemPfadeEinsortieren([rA, rB, rC]), 0,
	"💣 steht die Reihenfolge schon, wird KEIN Knoten bewegt -- jede Bewegung kostet das mouseout "
		+ "der Fläche unter dem Zeiger und lässt ihren Schwebezettel für immer stehen");
assert.strictEqual(ruhe.schreibzugriffe, 0, "und das DOM wird dabei gar nicht erst berührt");
assert.strictEqual(namen(ruhe), "a,b,c", "die Reihenfolge bleibt, was sie war");

// ---- Teil 2: Wer falsch liegt, wird einsortiert -- und nur der --------------------------------------

const durcheinander = gruppe("vegetation");
const [dC, dA, dB] = [knoten("c", durcheinander), knoten("a", durcheinander), knoten("b", durcheinander)];
const bewegt = ecosystemPfadeEinsortieren([dA, dB, dC]);
assert.strictEqual(namen(durcheinander), "a,b,c",
	"die verlangte Reihenfolge steht -- der vorderste Pfad (letzter der Liste) liegt am Ende der Gruppe");
assert.strictEqual(bewegt, 1,
	"⭐ und es kostet EINE Bewegung, nicht drei: a und b lagen schon richtig zueinander");
assert.strictEqual(durcheinander.schreibzugriffe, 1, "genau ein Schreibzugriff aufs DOM");

// Und der zweite Lauf ist ein Nichts. Genau das ist der Alltag: der Loader ruft die Sortierung nach
// JEDEM Nachladen, also bei jedem Schwenk, meist ohne dass sich etwas geändert hat.
assert.strictEqual(ecosystemPfadeEinsortieren([dA, dB, dC]), 0,
	"💣 der zweite Lauf über dieselbe Reihenfolge fasst nichts an (idempotent)");

// 🪤 Ein FREMDER Knoten in der Gruppe darf kein Dauerrütteln auslösen. Er bleibt vorn liegen, und
// unsere Pfade bleiben, wo sie sind -- sonst würde bei jedem Schwenk wieder alles bewegt.
const fremd = gruppe("topographie");
const fX = knoten("x", fremd);
const fA = knoten("a", fremd);
const fB = knoten("b", fremd);
assert.strictEqual(ecosystemPfadeEinsortieren([fA, fB]), 0,
	"🪤 ein fremder Knoten vor unseren Pfaden ist kein Grund, irgendetwas zu bewegen");
assert.strictEqual(namen(fremd), "x,a,b", "und er bleibt, wo er lag");
assert.ok(fX.parentNode === fremd, "der fremde Knoten wurde nicht umgehängt");

// 🪤 ZWEI PANES IN EINEM AUFRUF. Jede Ebene liegt in ihrer eigenen Gruppe; ein `insertBefore` über die
// Grenze hinweg wäre im Browser eine Ausnahme. Der Nachbau oben wirft dann -- hier darf nichts fliegen.
const paneEins = gruppe("pane-1");
const paneZwei = gruppe("pane-2");
const p1b = knoten("1b", paneEins);
const p1a = knoten("1a", paneEins);
const p2b = knoten("2b", paneZwei);
const p2a = knoten("2a", paneZwei);
assert.doesNotThrow(() => ecosystemPfadeEinsortieren([p1a, p1b, p2a, p2b]),
	"🪤 Knoten aus zwei Panes werden je Gruppe einsortiert, nie über die Grenze hinweg");
assert.strictEqual(namen(paneEins), "1a,1b", "Gruppe 1 steht");
assert.strictEqual(namen(paneZwei), "2a,2b", "Gruppe 2 steht");

// Robustheit: nichts, kein Array, ein Knoten ohne Eltern -- alles ist ein Nichts, keine Ausnahme.
assert.strictEqual(ecosystemPfadeEinsortieren(undefined), 0, "undefined ist ein Nichts");
assert.strictEqual(ecosystemPfadeEinsortieren([null, { parentNode: null }]), 0,
	"ein Knoten ohne Eltern hängt nicht in der Karte und lässt sich nicht einsortieren");

// ---- Teil 3: Die Verdrahtung -- und der Riegel ------------------------------------------------------
//
// 💣 Ein grüner Test über eine reine Funktion beweist nichts über die Karte. Hier läuft deshalb die
// ECHTE Datei: `applyEcosystemStackingOrder` (der Erzeuger) und der `tooltipopen`-Handler (der Riegel).

const renderQuelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-rendering.js"), "utf8");

function welt() {
	const pane = gruppe("pane");
	const geschlossen = [];
	const gesten = new Map();

	function flaeche(publicId, kind, rang) {
		const pfad = knoten(publicId, pane);
		return {
			_ecosystemArea: { public_id: publicId, kind, stack_order: rang, region_name: publicId, region_type: "wald" },
			getElement: () => pfad,
			closeTooltip: () => geschlossen.push(publicId),
			on: (name, handler) => { gesten.set(`${publicId}:${name}`, handler); },
			bindTooltip: () => {},
			pfad,
		};
	}

	// 🔴 `ecosystemLayers` entsteht HIER, nicht im vm: closeAllEcosystemAreaTooltips prüft
	// `instanceof Map`, und ein Map aus einem anderen Realm bestünde diese Prüfung nicht. Deshalb
	// reist `Map` mit in den Kontext -- dieselbe Bauart wie in ecosystem-isolation-zettel.test.js.
	const layers = new Map();
	const context = {
		console,
		Map,
		window: {},
		document: {
			documentElement: {},
			getElementById: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		getComputedStyle: () => ({ getPropertyValue: () => "#654321" }),
		L: { polygon: () => null, DomEvent: { stop: () => {}, stopPropagation: () => {} } },
		ecosystemLayers: layers,
		canOperateEcosystemLayers: () => false,
		canEditEcosystemOnMap: () => false,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(renderQuelle, context);

	return { context, layers, pane, geschlossen, gesten, flaeche };
}

// -- 3a. Der Erzeuger sagt es, wenn er Pfade bewegt hat ... ------------------------------------------
const w = welt();
w.layers.set("hinten", w.flaeche("hinten", "vegetation", 1));
w.layers.set("vorn", w.flaeche("vorn", "vegetation", 9));
// Verkehrt herum eingehängt: der vordere Pfad liegt noch hinten.
w.pane.kinder.reverse();
assert.strictEqual(namen(w.pane), "vorn,hinten", "Vorbedingung: die Reihenfolge stimmt nicht");

w.context.applyEcosystemStackingOrder();
assert.strictEqual(namen(w.pane), "hinten,vorn",
	"die Sortierung greift auch über den echten Aufrufer (Verdrahtung)");
assert.deepStrictEqual(w.geschlossen.sort(), ["hinten", "vorn"],
	"🔴 wer Pfade bewegt, macht das Überfahren ungültig und schliesst die Schwebezettel -- sonst bleibt "
		+ "genau der Zettel stehen, dessen Fläche eben aus dem DOM war");

// -- 3b. ... und schweigt, wenn er nichts bewegt hat -------------------------------------------------
//
// ⚠️ DIE ANDERE HÄLFTE DER REGEL, dieselbe wie bei wendeIsolationAn: diese Funktion läuft nach jedem
// Nachladen. Wer blind schliesst, nimmt dem Leser bei jedem Schwenk den Zettel unter seinem Zeiger weg.
w.geschlossen.length = 0;
w.context.applyEcosystemStackingOrder();
assert.strictEqual(w.pane.schreibzugriffe, 1, "der zweite Lauf fasst das DOM nicht an");
assert.deepStrictEqual(w.geschlossen, [],
	"⚠️ ohne Bewegung bleibt der Zettel unter dem Zeiger stehen");

// -- 3c. Es gibt genau EINEN Schwebezettel ------------------------------------------------------------
//
// 🔴 Der Riegel, der auch den nächsten, noch unbekannten Erzeuger fängt: geht ein Zettel auf, gehen
// alle anderen zu. Ein Zeiger steht über EINER Fläche -- zwei offene Zettel sind immer ein Rest.
const r = welt();
const alt = r.flaeche("alt", "vegetation", 1);
const neu = r.flaeche("neu", "vegetation", 2);
r.layers.set("alt", alt);
r.layers.set("neu", neu);

// Der Handler hängt an der Fläche, die buildEcosystemAreaLayer baut -- also einmal echt bauen.
r.context.L.polygon = () => neu;
const gebaut = r.context.buildEcosystemAreaLayer({
	public_id: "neu",
	kind: "vegetation",
	region_name: "Testwald",
	region_type: "wald",
	geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
});
assert.strictEqual(gebaut, neu, "Vorbedingung: die Fläche wurde gebaut");
const oeffnet = r.gesten.get("neu:tooltipopen");
assert.strictEqual(typeof oeffnet, "function",
	"💣 ohne den tooltipopen-Handler prüft 3c nichts -- dann ist der Riegel gar nicht verdrahtet");

r.geschlossen.length = 0;
oeffnet();
assert.deepStrictEqual(r.geschlossen, ["alt"],
	"🔴 geht ein Zettel auf, geht jeder andere zu -- genau das war der Screenshot vom 24.08.2026");
assert.ok(!r.geschlossen.includes("neu"),
	"💣 und der soeben geöffnete bleibt offen: ohne das `ausser` schlösse der Riegel sich selbst mit, "
		+ "und über den Landschaften gäbe es überhaupt keinen Schwebezettel mehr");

console.log("ok - ecosystem-zettel-einzeln");
