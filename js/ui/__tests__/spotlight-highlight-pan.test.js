// Die gelbe Hervorhebung eines Suchtreffers ueberlebt das SCHWENKEN und verschwindet erst beim
// ersten Klick auf eine leere Stelle.
//
// 💣 Der Grund, warum sie es nicht tat: `handleSpotlightDocumentClick` haengt als NATIVER Zuhoerer
// an `document` (spotlight-search.js), und der Browser feuert nach einem Ziehen sehr wohl ein
// `click` -- es geht an den gemeinsamen Vorfahren von mousedown und mouseup, also an den
// Kartencontainer, und blubbert von dort bis zum Dokument. Leaflets EIGENES `map.on("click")` sieht
// das nie, weil `_findEventTargets` click/preclick verwirft, solange `_draggableMoved()` gilt
// (js/third-party/leaflet.js). Genau diese Weiche fehlte dem Dokument-Zuhoerer -- deshalb loeschte
// jedes Schwenken die Hervorhebung, und `map.on("click")` daneben war unschuldig.
//
// ⚠️ `dragging.moved()` bleibt nach dem Loslassen wahr und wird erst beim naechsten `mousedown`
// zurueckgesetzt (`Draggable._onDown` setzt `_moved = !1`). Genau darum traegt der Klick NACH dem
// Schwenken die Antwort schon in sich, und der uebernaechste Klick auf eine leere Stelle loescht
// wieder normal -- kein Zustand, den wir selbst fuehren muessten.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

function createContext({ dragged }) {
	const documentListeners = {};
	const removedLayers = [];
	const element = (id) => ({
		id,
		hidden: true,
		isConnected: true,
		addEventListener() {},
		closest: () => null,
	});
	const elements = {
		"spotlight-search-overlay": element("spotlight-search-overlay"),
		"spotlight-search-dialog": element("spotlight-search-dialog"),
		"spotlight-search-input": element("spotlight-search-input"),
		"spotlight-search-results": element("spotlight-search-results"),
		"spotlight-search-status": element("spotlight-search-status"),
	};

	const context = { console };
	context.window = context;
	context.globalThis = context;
	context.Element = function Element() {};
	context.document = {
		getElementById: (id) => elements[id] || null,
		addEventListener: (type, handler) => {
			documentListeners[type] = documentListeners[type] || [];
			documentListeners[type].push(handler);
		},
	};
	context.map = {
		on() {},
		off() {},
		removeLayer: (layer) => removedLayers.push(layer),
		// Leaflets echte Weiche: nach einem Zug wahr, nach einem stehenden Klick falsch.
		dragging: { moved: () => dragged },
	};
	context.L = { layerGroup: () => ({ getLayers: () => [], addTo() {}, eachLayer() {} }) };

	vm.createContext(context);
	vm.runInContext(fs.readFileSync("js/ui/spotlight-search.js", "utf8"), context);
	vm.runInContext(fs.readFileSync("js/ui/spotlight-search-focus.js", "utf8"), context);
	context.initializeSpotlightSearch();

	return { context, documentListeners, removedLayers };
}

// Ein Klick, dessen Ziel im Dokument haengt und zu keiner der geschonten Flaechen gehoert --
// also "irgendwo auf die Karte".
function mapClickEvent(context) {
	const target = Object.create(context.Element.prototype);
	target.isConnected = true;
	target.closest = () => null;
	return { target };
}

function armHighlight(context) {
	vm.runInContext("spotlightActiveSelectionId = 'lore:alraune'; spotlightHighlightLayer = { marker: 'gelb' };", context);
}

function highlightIsGone(context) {
	return vm.runInContext("spotlightHighlightLayer === null", context);
}

// 1. Schwenken laesst sie stehen.
{
	const { context, documentListeners } = createContext({ dragged: true });
	armHighlight(context);
	documentListeners.click.forEach((handler) => handler(mapClickEvent(context)));
	assert.strictEqual(highlightIsGone(context), false, "nach dem Schwenken bleibt die Hervorhebung stehen");
	assert.strictEqual(
		vm.runInContext("spotlightActiveSelectionId", context),
		"lore:alraune",
		"und der Treffer bleibt der ausgewaehlte -- sonst raeumte die Escape-Taste ins Leere",
	);
}

// 2. Der erste Klick auf eine leere Stelle raeumt sie weg -- das ist der Zweck des Zuhoerers,
//    und ein zu breiter Riegel haette ihn stillgelegt.
{
	const { context, documentListeners, removedLayers } = createContext({ dragged: false });
	armHighlight(context);
	documentListeners.click.forEach((handler) => handler(mapClickEvent(context)));
	assert.strictEqual(highlightIsGone(context), true, "ein stehender Klick auf die leere Karte raeumt weg");
	assert.strictEqual(removedLayers.length, 1, "und die Ebene wird auch wirklich von der Karte genommen");
	assert.strictEqual(vm.runInContext("spotlightActiveSelectionId", context), "");
}

// 3. Ohne Ziehen-Handler (Karte ohne aktivierbares Schwenken) bleibt das alte Verhalten:
//    raeumen, nicht schonen. Ein fehlender Zustand ist kein "es wurde gezogen".
{
	const { context, documentListeners } = createContext({ dragged: false });
	context.map.dragging = null;
	armHighlight(context);
	documentListeners.click.forEach((handler) => handler(mapClickEvent(context)));
	assert.strictEqual(highlightIsGone(context), true, "ohne Ziehen-Handler wird wie bisher geraeumt");
}

console.log("spotlight-highlight-pan: OK");
