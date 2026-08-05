/*
 * Tastaturbefehle für die Karte (Owner-Auftrag 2026-08-05).
 *
 * 💣 DIE TABELLE UNTEN IST DIE EINZIGE QUELLE. Sie ist BEIDES: die Belegung, nach der die Tasten
 * wirken, und der Bauplan der Tabelle in den Hinweisen („Bedienung" → „Bedienhilfen"). Eine
 * geänderte Zeile ändert damit zwangsläufig auch ihre Erklärung. Wer eine Taste woanders verdrahtet
 * oder die Erklärung von Hand in index.html schreibt, baut genau die Divergenz ein, die diese Datei
 * verhindert.
 *
 * 💣 KEIN STRG, KEIN ALT, KEIN META (Owner-Entscheid 2026-08-05). Der erste Entwurf legte sieben
 * Befehle auf Strg — und die gehören dem Browser: Strg+R lädt neu, Strg+P druckt, Strg+F sucht im
 * Text, Strg+L/K springen in die Adresszeile. Abfangen ginge, hieße aber, dem Besucher diese
 * Befehle auf avesmaps.de wegzunehmen; bei Strg+L/K lässt es zudem nicht jeder Browser zu. Deshalb
 * dieselben Buchstaben OHNE Strg, und `matchShortcut` gibt bei jedem dieser Modifier sofort auf.
 * (Strg+1…8 wäre ohnehin unmöglich gewesen: das schaltet die Browser-Tabs und ist nicht abfangbar.)
 *
 * ⚠️ Leaflets eigene Tastatursteuerung wird abgeschaltet (`map.keyboard.disable()`), und das ist
 * Absicht: sie wirkt NUR, wenn die Karte vorher angeklickt wurde, und ihre Pfeiltasten würden sich
 * sonst mit den hiesigen zu doppelten Sprüngen addieren. Verschieben und Zoomen laufen deshalb
 * vollständig hier — dafür ab dem Laden, ohne dass man erst irgendwohin klicken muss.
 */
(function () {
	"use strict";

	// ---- Bausteine der Tabelle -------------------------------------------------------------------

	// Eine Tastenkappe. `i18n` nur, wo das Wort übersetzt werden muss: „F" heißt überall F,
	// „Leertaste" nicht.
	function cap(text, i18nKey) {
		return { text: text, i18n: i18nKey || "" };
	}

	// Leaflet-Vorgaben, damit sich Verschieben und Zoomen genau so anfühlen wie vorher.
	var PAN_STEP_PX = 80;
	var PAN_SHIFT_FACTOR = 3;

	// Die sechs Ortsklassen stehen in index.html in genau dieser Reihenfolge nebeneinander; die
	// Zifferntaste trifft die n-te davon. Gezählt wird, was der Besucher SIEHT, darum über die
	// DOM-Reihenfolge und nicht über LOCATION_TYPE_VISIBILITY_ORDER.
	var LOCATION_TIER_COUNT = 6;

	/*
	 * Eine Zeile:
	 *   id     — für die Wirkung (ACTIONS) und als Test-Anker
	 *   keys   — die `event.key`-Werte, die sie auslösen (Buchstaben klein, siehe normalizeKey)
	 *   caps   — wie sie in den Hinweisen aussieht
	 *   de     — die Erklärung auf Deutsch, i18n ihr englisches Gegenstück
	 *   passive — steht nur zur ERKLÄRUNG in der Tabelle; die Taste gehört jemand anderem (Esc)
	 */
	var SHORTCUTS = [
		{ id: "search", keys: ["f", " "], caps: [cap("F"), cap("Leertaste", "shortcuts.key.space")],
			i18n: "shortcuts.row.search", de: "Suche öffnen" },
		{ id: "addDestination", keys: ["r"], caps: [cap("R")],
			i18n: "shortcuts.row.addDestination", de: "Reiseziel hinzufügen" },
		// Geschoben wird mit den PFEILEN, nicht mehr mit W A S D (2026-08-05). Anlass war „S" für die
		// Ansicht „Standard": die Buchstaben gehören den Befehlen, und WASD saß mitten in ihrem Vorrat.
		// „S" allein herauszunehmen und W, A, D zu behalten wäre die schlechteste Fassung gewesen --
		// drei von vier Richtungen, die noch als Buchstabe gehen. `matchShortcut` nimmt ohnehin die
		// ERSTE Zeile mit der Taste, und Schieben steht vor den Ansichten: „S" wäre nie bei „Standard"
		// angekommen, solange es hier noch stand.
		{ id: "panUp", keys: ["arrowup"], caps: [cap("↑")],
			i18n: "shortcuts.row.panUp", de: "Karte nach oben schieben" },
		{ id: "panLeft", keys: ["arrowleft"], caps: [cap("←")],
			i18n: "shortcuts.row.panLeft", de: "Karte nach links schieben" },
		{ id: "panDown", keys: ["arrowdown"], caps: [cap("↓")],
			i18n: "shortcuts.row.panDown", de: "Karte nach unten schieben" },
		{ id: "panRight", keys: ["arrowright"], caps: [cap("→")],
			i18n: "shortcuts.row.panRight", de: "Karte nach rechts schieben" },
		{ id: "panFast", keys: [], passive: true, caps: [cap("Umschalt", "shortcuts.key.shift")],
			// Umschalt wirkt AUF DAS SCHIEBEN, nicht auf „die Tasten darüber": `panBy` ist die einzige
			// Stelle, die `event.shiftKey` liest (PAN_SHIFT_FACTOR), Zoom und Ansichten sehen es nicht.
			// Bis 2026-08-05 stand hier „eine der sechs Tasten darüber" — es sind vier Richtungen mit
			// acht Tasten (W A S D und die Pfeile), und die Zahl wäre bei jeder Umsortierung falsch.
			// Deshalb nennt die Zeile jetzt die WIRKUNG statt einer Position in der Tabelle.
			i18n: "shortcuts.row.panFast", de: "Beim Schieben der Karte gedrückt halten: dreifacher Schritt" },
		{ id: "zoomIn", keys: ["+", "="], caps: [cap("+")],
			i18n: "shortcuts.row.zoomIn", de: "Hineinzoomen" },
		{ id: "zoomOut", keys: ["-", "_"], caps: [cap("−")],
			i18n: "shortcuts.row.zoomOut", de: "Herauszoomen" },
		{ id: "modeOriginal", keys: ["o"], caps: [cap("O")], mode: "original",
			i18n: "shortcuts.row.modeOriginal", de: "Ansicht „Original“" },
		{ id: "modePolitical", keys: ["p"], caps: [cap("P")], mode: "political",
			i18n: "shortcuts.row.modePolitical", de: "Ansicht „Politisch“" },
		{ id: "modePowerlines", keys: ["k"], caps: [cap("K")], mode: "powerlines",
			i18n: "shortcuts.row.modePowerlines", de: "Ansicht „Kraftlinien“" },
		{ id: "modeStandard", keys: ["s"], caps: [cap("S")], mode: "deregraphic",
			i18n: "shortcuts.row.modeStandard", de: "Ansicht „Standard“" },
		// „L" wie Landschaften -- bis 2026-08-05 lag es auf „Standard". Die Ebene darf seit 2026-08-04
		// JEDER ansehen (nur das Bearbeiten haengt an einer Faehigkeit, siehe js/app/session.js), also
		// gehoert sie in die Tabelle wie die anderen fuenf.
		{ id: "modeEcosystem", keys: ["l"], caps: [cap("L")], mode: "ecosystem",
			i18n: "shortcuts.row.modeEcosystem", de: "Ansicht „Landschaften“" },
		{ id: "modeNone", keys: ["i"], caps: [cap("I")], mode: "none",
			i18n: "shortcuts.row.modeNone", de: "Ansicht „Nur Karte“" },
		{ id: "locationTier", keys: ["1", "2", "3", "4", "5", "6"],
			caps: [cap("1"), cap("…"), cap("6")],
			i18n: "shortcuts.row.locationTier",
			de: "Orte bis zur Stufe zeigen: 1 Metropolen, 2 auch Großstädte … 6 alles. Dieselbe Ziffer noch einmal blendet alle aus" },
		{ id: "routeFastest", keys: ["home"], caps: [cap("Pos 1", "shortcuts.key.home")],
			i18n: "shortcuts.row.routeFastest", de: "Schnellste Route" },
		{ id: "routeShortest", keys: ["end"], caps: [cap("Ende", "shortcuts.key.end")],
			i18n: "shortcuts.row.routeShortest", de: "Kürzeste Route" },
		{ id: "prevLeg", keys: ["pageup"], caps: [cap("Bild ↑", "shortcuts.key.pageUp")],
			i18n: "shortcuts.row.prevLeg", de: "Vorige Etappe im Reiseplan" },
		{ id: "nextLeg", keys: ["pagedown"], caps: [cap("Bild ↓", "shortcuts.key.pageDown")],
			i18n: "shortcuts.row.nextLeg", de: "Nächste Etappe im Reiseplan" },
		{ id: "close", keys: [], passive: true, caps: [cap("Esc")],
			i18n: "shortcuts.row.close", de: "Offenes Fenster schließen" }
	];

	// ---- Der reine Kern: welche Zeile gehört zu diesem Tastendruck? -------------------------------
	// Bewusst OHNE DOM und ohne Globals -- das ist der Teil, den der Test fassen kann.

	// „A" und „a" sind dieselbe Taste, „ArrowLeft" schreibt sich klein weiter. Ziffern, „+", „-" und
	// die Pfeilnamen kommen unverändert durch.
	function normalizeKey(key) {
		return typeof key === "string" ? key.toLowerCase() : "";
	}

	function matchShortcut(event) {
		if (!event) {
			return null;
		}
		// Strg/Alt/Meta gehören dem Browser -- siehe Kopfkommentar. AltGr ist unter Windows
		// Strg+Alt und fällt damit ebenfalls hier heraus.
		if (event.ctrlKey || event.altKey || event.metaKey) {
			return null;
		}
		var key = normalizeKey(event.key);
		if (!key) {
			return null;
		}
		for (var i = 0; i < SHORTCUTS.length; i += 1) {
			var entry = SHORTCUTS[i];
			if (!entry.passive && entry.keys.indexOf(key) >= 0) {
				return entry;
			}
		}
		return null;
	}

	// ---- Der Riegel: eine Regel, für alle ---------------------------------------------------------

	var TYPING_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

	// Alles, was Enter/Leertaste selbst braucht. Die Etappenzeilen des Reiseplans sind
	// role="button" tabindex="0" und hören dort auf beides -- die Leertaste darf ihnen nicht
	// weggenommen werden.
	var ACTIVATABLE_SELECTOR = "button, a[href], summary, [role='button'], [role='option'], [role='tab']";

	// Ein laufendes Werkzeug hat Vorrang: dort bedeuten dieselben Tasten etwas anderes (die
	// Leertaste parkt zum Beispiel den Pinsel). Erkannt an den Klassen, die die Werkzeuge ohnehin
	// schon an den Kartencontainer hängen -- kein zweiter Zustand, der veralten könnte.
	var TOOL_CLASSES = [
		"ecosystem-brush-cursor",     // Pinsel und Radiergummi
		"ecosystem-brush-pan",        // Pinsel, Karte gerade am Schieben
		"ecosystem-draw-cursor",      // Fläche zeichnen
		"ecosystem-geometry-editing", // Eckpunkte einer Fläche bearbeiten
		"path-creation-cursor",       // Weg anlegen
		"leaflet-crosshair",          // Kartenpunkt setzen/verschieben, Messen
		"region-vertex-detach-dragging"
	];

	// Zwei „Jetzt bitte etwas anklicken"-Modi hängen ihre Klasse nicht an den Container, sondern an
	// die Panes.
	var PICKING_SELECTOR = ".ecosystem-pane--picking, .regions-pane--pick-outline";

	// Offene Fenster generisch: alles mit role="dialog" plus die beiden Overlays, die ihre Rolle am
	// inneren Kasten tragen. getClientRects() statt offsetParent -- die Fenster liegen `fixed`, und
	// dafür ist offsetParent immer null.
	var DIALOG_SELECTOR = "[role='dialog'], .ui-dialog, .map-context-menu";

	function isVisible(element) {
		return Boolean(element && element.getClientRects && element.getClientRects().length > 0);
	}

	function anyDialogOpen() {
		var nodes = document.querySelectorAll(DIALOG_SELECTOR);
		for (var i = 0; i < nodes.length; i += 1) {
			if (isVisible(nodes[i])) {
				return true;
			}
		}
		return false;
	}

	function getMap() {
		// 💣 `map` ist ein `const` in bootstrap.js und steht deshalb NICHT auf window. Ein blosses
		// `typeof map` wirft, solange die Datei nur halb geladen ist (temporale Todeszone) -- und
		// riss damit schon einmal alles mit. Darum try/catch statt typeof-Prüfung.
		try {
			return (typeof map !== "undefined" && map) ? map : null;
		} catch (error) {
			return null;
		}
	}

	function getMapContainer() {
		var mapInstance = getMap();
		return mapInstance && typeof mapInstance.getContainer === "function" ? mapInstance.getContainer() : null;
	}

	function toolActive() {
		var container = getMapContainer();
		if (container) {
			for (var i = 0; i < TOOL_CLASSES.length; i += 1) {
				if (container.classList.contains(TOOL_CLASSES[i])) {
					return true;
				}
			}
		}
		return Boolean(document.querySelector(PICKING_SELECTOR));
	}

	function isTyping(event) {
		var target = event.target;
		if (target && typeof target.closest === "function" && target.closest(TYPING_SELECTOR)) {
			return true;
		}
		var active = document.activeElement;
		return Boolean(active && typeof active.closest === "function" && active.closest(TYPING_SELECTOR));
	}

	function shortcutsBlocked(event, entry) {
		if (isTyping(event) || anyDialogOpen() || toolActive()) {
			return true;
		}
		// Die Leertaste bedient einen Knopf, der gerade den Fokus hat. Wer eben „Hinweise"
		// geschlossen hat, steht mit dem Fokus auf diesem Knopf -- ein Druck auf die Leertaste
		// soll ihn wieder öffnen und nicht die Suche.
		if (entry.keys.indexOf(" ") >= 0 && normalizeKey(event.key) === " ") {
			var active = document.activeElement;
			if (active && typeof active.closest === "function" && active.closest(ACTIVATABLE_SELECTOR)) {
				return true;
			}
		}
		return false;
	}

	// ---- Die Wirkungen ----------------------------------------------------------------------------

	function call(name, args) {
		var fn = window[name];
		if (typeof fn === "function") {
			return fn.apply(null, args || []);
		}
		return undefined;
	}

	function panBy(dx, dy, event) {
		var mapInstance = getMap();
		if (!mapInstance || typeof mapInstance.panBy !== "function") {
			return;
		}
		var step = PAN_STEP_PX * (event && event.shiftKey ? PAN_SHIFT_FACTOR : 1);
		mapInstance.panBy([dx * step, dy * step]);
	}

	function zoomBy(direction) {
		var mapInstance = getMap();
		if (!mapInstance) {
			return;
		}
		if (direction > 0 && typeof mapInstance.zoomIn === "function") {
			mapInstance.zoomIn(1);
		} else if (direction < 0 && typeof mapInstance.zoomOut === "function") {
			mapInstance.zoomOut(1);
		}
	}

	// Genau der Weg, den ein Klick auf einen Eintrag der Auswahlbox geht (ui-controls.js): Wert
	// setzen, `change` auslösen. Gesperrte Einträge bleiben gesperrt -- die Wahrheit steht im
	// <option>, nicht hier.
	function selectMapLayerMode(mode) {
		var select = document.getElementById("mapLayerModeSelect");
		if (!select) {
			return;
		}
		var option = select.querySelector('option[value="' + mode + '"]');
		if (!option || option.disabled || select.value === mode) {
			return;
		}
		if (window.jQuery) {
			window.jQuery(select).val(mode).trigger("change");
		}
	}

	// Der n-te der sechs Ortsklassen-Knöpfe, per echtem Klick: so laufen Filterreset, URL-Abgleich
	// und Stufenlogik durch dieselbe Stelle wie beim Anklicken und können nicht auseinanderlaufen.
	function toggleLocationTier(tier) {
		var buttons = document.querySelectorAll(".location-toggle");
		var button = buttons[tier - 1];
		if (button && tier >= 1 && tier <= LOCATION_TIER_COUNT) {
			button.click();
		}
	}

	// Ein echter Klick auf das Radio: das setzt `checked` UND feuert das native `change`, an dem
	// die Neuberechnung der Route hängt (routing.js). Ein bereits gewähltes Radio löst kein
	// `change` aus -- richtig so, es gibt nichts zu tun.
	function selectPathType(inputId) {
		var input = document.getElementById(inputId);
		if (input && !input.checked) {
			input.click();
		}
	}

	function stepRouteLeg(direction) {
		var entries;
		var activeIndex;
		try {
			entries = (typeof currentRoutePlanEntries !== "undefined") ? currentRoutePlanEntries : null;
			activeIndex = (typeof activeRoutePlanEntryIndex !== "undefined") ? activeRoutePlanEntryIndex : null;
		} catch (error) {
			return;
		}
		if (!entries || !entries.length || typeof window.selectRoutePlanEntry !== "function") {
			return;
		}
		// Ohne Auswahl steigt „vorwärts" bei der ersten Etappe ein und „rückwärts" bei der letzten.
		var nextIndex;
		if (typeof activeIndex !== "number" || activeIndex < 0) {
			nextIndex = direction > 0 ? 0 : entries.length - 1;
		} else {
			nextIndex = Math.min(entries.length - 1, Math.max(0, activeIndex + direction));
		}
		window.selectRoutePlanEntry(nextIndex, { zoomToEntry: true, scrollPlan: true });
	}

	var ACTIONS = {
		search: function () {
			call("openSpotlightSearch");
		},
		addDestination: function () {
			var $input = call("appendWaypointInput");
			if ($input && typeof $input.focus === "function") {
				$input.focus();
				call("scrollWaypointInputIntoView", [$input]);
			}
		},
		panUp: function (event) { panBy(0, -1, event); },
		panDown: function (event) { panBy(0, 1, event); },
		panLeft: function (event) { panBy(-1, 0, event); },
		panRight: function (event) { panBy(1, 0, event); },
		zoomIn: function () { zoomBy(1); },
		zoomOut: function () { zoomBy(-1); },
		locationTier: function (event) { toggleLocationTier(Number(event.key)); },
		routeFastest: function () { selectPathType("fastestPath"); },
		routeShortest: function () { selectPathType("shortestPath"); },
		prevLeg: function () { stepRouteLeg(-1); },
		nextLeg: function () { stepRouteLeg(1); }
	};

	function runShortcut(entry, event) {
		if (entry.mode) {
			selectMapLayerMode(entry.mode);
			return;
		}
		var action = ACTIONS[entry.id];
		if (action) {
			action(event);
		}
	}

	// ---- Die Tabelle in den Hinweisen -------------------------------------------------------------

	function translate(key, german) {
		return typeof window.tr === "function" ? window.tr(key, german) : german;
	}

	function renderShortcutTable(mount) {
		var table = document.createElement("table");
		table.className = "shortcut-table";

		var head = document.createElement("thead");
		var headRow = document.createElement("tr");
		[["shortcuts.col.keys", "Taste"], ["shortcuts.col.action", "Wirkung"]].forEach(function (column) {
			var cell = document.createElement("th");
			cell.scope = "col";
			cell.setAttribute("data-i18n", column[0]);
			cell.textContent = column[1];
			headRow.append(cell);
		});
		head.append(headRow);
		table.append(head);

		var body = document.createElement("tbody");
		SHORTCUTS.forEach(function (entry) {
			var row = document.createElement("tr");
			var keyCell = document.createElement("th");
			keyCell.scope = "row";
			keyCell.className = "shortcut-table__keys";
			entry.caps.forEach(function (capEntry) {
				var kbd = document.createElement("kbd");
				kbd.className = "shortcut-key";
				if (capEntry.i18n) {
					kbd.setAttribute("data-i18n", capEntry.i18n);
				}
				kbd.textContent = capEntry.text;
				keyCell.append(kbd);
			});
			var textCell = document.createElement("td");
			textCell.setAttribute("data-i18n", entry.i18n);
			textCell.textContent = entry.de;
			row.append(keyCell, textCell);
			body.append(row);
		});
		table.append(body);

		mount.replaceChildren(table);
		// Das Fenster wird vom i18n-Durchlauf beim Laden erfasst -- diese Knoten entstehen aber
		// erst hier. Also den Durchlauf für genau diesen Ausschnitt nachholen; unter Deutsch tut
		// er nichts.
		if (typeof window.applyI18nOverlay === "function") {
			window.applyI18nOverlay(mount);
		}
	}

	// ---- Anschluss --------------------------------------------------------------------------------

	function handleKeydown(event) {
		var entry = matchShortcut(event);
		if (!entry || shortcutsBlocked(event, entry)) {
			return;
		}
		// Alle unsere Tasten scrollen sonst die Seite (Leertaste, Bild auf/ab, Pos 1/Ende, Pfeile)
		// oder tippen ins Nichts. Erst hier, nachdem feststeht, dass der Druck uns gehört.
		event.preventDefault();
		runShortcut(entry, event);
	}

	function initialize() {
		var mapInstance = getMap();
		// Leaflets eigene Tastatursteuerung abschalten, sonst springt die Karte doppelt, sobald sie
		// den Fokus hat (Kopfkommentar).
		if (mapInstance && mapInstance.keyboard && typeof mapInstance.keyboard.disable === "function") {
			mapInstance.keyboard.disable();
		}
		// Ohne capture: ein Werkzeug, das seinen Tastendruck im capture auf document abfängt (der
		// Pinsel tut das), kommt damit zuerst dran und wird nicht überstimmt.
		document.addEventListener("keydown", handleKeydown);

		var mount = document.getElementById("legal-shortcuts");
		if (mount) {
			renderShortcutTable(mount);
		}
	}

	// Für den Test und für die Selbstauskunft im Browser. Die beiden Selektoren stehen mit hier, damit
	// der Test gegen die ECHTE Regel prüft und nicht gegen eine abgeschriebene Kopie davon.
	window.avesmapsKeyboardShortcuts = {
		entries: SHORTCUTS,
		match: matchShortcut,
		normalizeKey: normalizeKey,
		typingSelector: TYPING_SELECTOR,
		activatableSelector: ACTIVATABLE_SELECTOR,
		toolClasses: TOOL_CLASSES
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initialize);
	} else {
		initialize();
	}
})();
