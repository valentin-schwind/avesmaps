"use strict";

/*
 * Verschiebbare Dialogfenster -- die Titelzeile ist der Griff (Owner-Wunsch 2026-07-28).
 *
 * EIN Mechanismus fuer alle Fenster, delegiert am document: kein Dialog wird einzeln verdrahtet, und
 * die erst beim Oeffnen gebauten Fenster (Abenteuer, Kartensammlung, Natur & Waren, Karte
 * vorschlagen ...) sind ohne Zutun dabei. Ein neues Fenster ist automatisch verschiebbar, sobald es
 * dem Hausmuster folgt: eine Kopfzeile aus HANDLE_SELECTORS in einem Kasten mit role="dialog".
 * Wer ein Fenster baut, das dem Muster nicht folgt, setzt data-avesmaps-drag-handle auf die
 * Kopfzeile -- eine eigene Verdrahtung braucht es nie.
 *
 * Verschoben wird ueber die CSS-Eigenschaft `translate`, NICHT ueber `transform` und nicht ueber
 * position/left/top:
 *  - Die Fenster sitzen per Flex-Zentrierung in ihrem Overlay. Ein Wechsel auf position:absolute
 *    wuerde Breite, Hoehe und jedes Media-Query-Layout mitreissen.
 *  - `translate` ist eine eigene Eigenschaft und ueberschreibt kein `transform` aus dem Stylesheet
 *    (heute hat kein Dialogkasten eins -- morgen vielleicht eine Einblend-Animation).
 *
 * Nur Maus und Stift: am Handy fuellen die Fenster ohnehin den Schirm, und ein Wischen auf der
 * Kopfzeile waere dort eher ein Fehlgriff als eine Geste.
 */

// Kopfzeilen, die als Griff gelten.
//
// 💣 Nach der FORM gesucht, nicht nach einer Namensliste: die Kopfzeile eines Fensters heisst im Haus
// immer "…__header", "…__head" oder "…-head" und ist direktes Kind des Kastens. Eine Liste konkreter
// Klassennamen veraltet lautlos -- beim Bau dieser Datei standen sechs Fenster (Landschaften,
// Label-Zuweisung) schon im Repo, die keine solche Liste gekannt haette, und das naechste kommt
// bestimmt. Ein nicht verschiebbares Fenster faellt niemandem auf, bis es stoert.
var AVESMAPS_DIALOG_DRAG_HANDLES = [
	'[role="dialog"] > [class*="__head"]',
	'[role="dialog"] > [class*="-head"]',
	".modal-box > .modal-title",
	"[data-avesmaps-drag-handle]",
].join(", ");

// Das Fenster selbst. role="dialog" traegt im Haus immer der Kasten, nie das Overlay; .modal-box ist
// die Bauart der Editor-iframes (wiki-sync-monitor.html, wiki-sync-settlement-editor.html).
var AVESMAPS_DIALOG_DRAG_WINDOWS = '[role="dialog"], .modal-box';

// Bedienelemente in der Kopfzeile bleiben Bedienelemente: Schliessen/Verkleinern und das Suchfeld im
// Konflikte-Fenster duerfen kein Ziehen ausloesen.
var AVESMAPS_DIALOG_DRAG_IGNORE = "button, a, input, select, textarea, summary, [role='button'], [contenteditable=''], [contenteditable='true']";

// So viel Fenster bleibt beim Ziehen mindestens im Bild -- genug, um es wieder zu fassen zu kriegen.
var AVESMAPS_DIALOG_DRAG_MIN_VISIBLE_X = 120;
var AVESMAPS_DIALOG_DRAG_MIN_VISIBLE_Y = 24;

/*
 * Haelt das Fenster am Bildschirm. `box` ist seine Lage OHNE Verschiebung, `offsetX/offsetY` die
 * gewuenschte Gesamtverschiebung; zurueck kommt die erlaubte.
 *
 * Invariante: die unverschobene Lage ist IMMER erlaubt. Sonst wuerde ein Fenster, das von Haus aus
 * ueber den Rand ragt (ein hoher Dialog haengt bei Flex-Zentrierung oben und unten heraus), beim
 * ersten Anfassen einen Sprung machen -- die Begrenzung soll bremsen, nicht schubsen.
 */
function avesmapsClampDialogOffset(box, offsetX, offsetY, viewport) {
	var minVisibleX = Math.min(AVESMAPS_DIALOG_DRAG_MIN_VISIBLE_X, box.width);
	var minLeft = Math.min(minVisibleX - box.width, box.left);
	var maxLeft = Math.max(viewport.width - minVisibleX, box.left);
	var left = Math.min(Math.max(box.left + offsetX, minLeft), maxLeft);

	// Nach oben ist bei der Kopfzeile Schluss: waere sie weg, gaebe es keinen Griff mehr.
	var visibleY = Math.min(Math.max(box.handleHeight || 0, AVESMAPS_DIALOG_DRAG_MIN_VISIBLE_Y), box.height);
	var minTop = Math.min(0, box.top);
	var maxTop = Math.max(viewport.height - visibleY, box.top);
	var top = Math.min(Math.max(box.top + offsetY, minTop), maxTop);

	return { x: left - box.left, y: top - box.top };
}

function avesmapsInitDialogDrag(doc) {
	var offsets = new WeakMap();
	// Verschobene Fenster zusaetzlich in einem Set: die WeakMap laesst sich nicht durchlaufen, beim
	// Groessenwechsel des Browserfensters muessen aber alle nachgerueckt werden. Eintraege, deren
	// Fenster aus dem DOM verschwunden sind (die Vorkommen-/Natur-Fenster werden beim Schliessen
	// weggeworfen), fliegen dabei raus.
	var moved = new Set();
	var drag = null;

	function viewport() {
		var view = doc.defaultView;
		return {
			width: view ? view.innerWidth : 0,
			height: view ? view.innerHeight : 0,
		};
	}

	function offsetOf(win) {
		return offsets.get(win) || { x: 0, y: 0 };
	}

	// Ein verschobenes Fenster, das SEINE EIGENE Groesse aendert (das Konflikte-Fenster tut genau das),
	// wuerde sonst unbemerkt aus dem Bild wandern -- ein resize-Ereignis am Browserfenster gibt es
	// dabei nicht.
	var sizeWatch = typeof ResizeObserver !== "undefined"
		? new ResizeObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!drag || drag.win !== entry.target) {
					reclamp(entry.target);
				}
			});
		})
		: null;

	function observe(win) {
		if (sizeWatch && !moved.has(win)) {
			sizeWatch.observe(win);
		}
	}

	function unobserve(win) {
		if (sizeWatch) {
			sizeWatch.unobserve(win);
		}
	}

	function applyOffset(win, offset) {
		if (!offset.x && !offset.y) {
			win.style.removeProperty("translate");
			offsets.delete(win);
			moved.delete(win);
			unobserve(win);
			return;
		}
		observe(win);
		win.style.translate = Math.round(offset.x) + "px " + Math.round(offset.y) + "px";
		offsets.set(win, offset);
		moved.add(win);
	}

	// Die Lage des Fensters, als waere es nie verschoben worden -- Bezugspunkt fuer die Begrenzung.
	//
	// Frisch gemessen, nicht beim Anfassen gemerkt: Fenster aendern ihre Groesse, waehrend sie offen
	// sind. Das Konflikte-Fenster wurde beim Nachmessen 200px schmaler, nachdem es geoeffnet war --
	// gegen das alte Mass gerechnet landete seine Kopfzeile UNTER dem Bildschirmrand und war damit
	// nicht mehr zu fassen. Genau das soll die Begrenzung ja verhindern.
	function baseBox(win, offset, handleHeight) {
		var rect = win.getBoundingClientRect();
		return {
			left: rect.left - offset.x,
			top: rect.top - offset.y,
			width: rect.width,
			height: rect.height,
			handleHeight: handleHeight || 0,
		};
	}

	// Holt ein Fenster zurueck ins Bild, ohne dass jemand zieht -- nach einer Groessenaenderung des
	// Browserfensters oder des Fensters selbst.
	function reclamp(win) {
		if (!win.isConnected) {
			offsets.delete(win);
			moved.delete(win);
			unobserve(win);
			return;
		}
		var offset = offsetOf(win);
		var handle = win.querySelector(AVESMAPS_DIALOG_DRAG_HANDLES);
		var base = baseBox(win, offset, handle ? handle.getBoundingClientRect().height : 0);
		// Ein geschlossenes Fenster misst 0x0 -- daran laesst sich nichts ausrechnen.
		if (base.width <= 0 || base.height <= 0) {
			return;
		}
		applyOffset(win, avesmapsClampDialogOffset(base, offset.x, offset.y, viewport()));
	}

	function handleFor(target) {
		if (!target || typeof target.closest !== "function") {
			return null;
		}
		var handle = target.closest(AVESMAPS_DIALOG_DRAG_HANDLES);
		if (!handle || target.closest(AVESMAPS_DIALOG_DRAG_IGNORE)) {
			return null;
		}
		return handle;
	}

	function endDrag() {
		if (!drag) {
			return;
		}
		drag.win.classList.remove("is-avesmaps-dragging");
		try {
			drag.handle.releasePointerCapture(drag.pointerId);
		} catch (error) {
			// Der Zeiger kann laengst freigegeben sein (Fenster verloren den Fokus) -- kein Fehlerfall.
		}
		drag = null;
	}

	doc.addEventListener("pointerdown", function (event) {
		// Sicherheitsnetz vor allem anderen: verschobene Fenster zurueck ins Bild holen, falls sich
		// eins seit dem letzten Zug selbst vergroessert hat. Der ResizeObserver oben ist der schnellere
		// Weg, haengt aber an der Renderschleife des Browsers; dieser Sweep haengt an nichts. Bei
		// keinem verschobenen Fenster (der Normalfall) kostet er nichts.
		if (moved.size) {
			Array.from(moved).forEach(reclamp);
		}
		if (event.button !== 0 || event.pointerType === "touch") {
			return;
		}
		var handle = handleFor(event.target);
		if (!handle) {
			return;
		}
		var win = handle.closest(AVESMAPS_DIALOG_DRAG_WINDOWS);
		if (!win) {
			return;
		}
		// Der Sweep oben hat das Fenster bereits zurechtgerueckt, falls noetig -- der Versatz wird
		// deshalb JETZT gelesen, nicht vorher.
		drag = {
			win: win,
			handle: handle,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			offset: offsetOf(win),
			handleHeight: handle.getBoundingClientRect().height,
		};
		win.classList.add("is-avesmaps-dragging");
		// Zeigerfang: sonst reisst der Zeiger ab, sobald er ueber einen Editor-iframe im Fenster laeuft.
		try {
			handle.setPointerCapture(event.pointerId);
		} catch (error) {
			// Ohne Fang laeuft es weiter, nur eben nicht ueber iframes hinweg.
		}
		// Ohne das markiert das Ziehen die Ueberschrift blau.
		event.preventDefault();
	});

	doc.addEventListener("pointermove", function (event) {
		if (!drag || event.pointerId !== drag.pointerId) {
			return;
		}
		applyOffset(drag.win, avesmapsClampDialogOffset(
			baseBox(drag.win, offsetOf(drag.win), drag.handleHeight),
			drag.offset.x + (event.clientX - drag.startX),
			drag.offset.y + (event.clientY - drag.startY),
			viewport()
		));
	});

	doc.addEventListener("pointerup", endDrag);
	doc.addEventListener("pointercancel", endDrag);

	// Doppelklick auf den Titel holt das Fenster zurueck in die Mitte.
	doc.addEventListener("dblclick", function (event) {
		var handle = handleFor(event.target);
		if (!handle) {
			return;
		}
		var win = handle.closest(AVESMAPS_DIALOG_DRAG_WINDOWS);
		if (win) {
			applyOffset(win, { x: 0, y: 0 });
		}
	});

	if (doc.defaultView) {
		doc.defaultView.addEventListener("resize", function () {
			// Kopie, weil reclamp() Eintraege aus dem Set nimmt.
			Array.from(moved).forEach(reclamp);
		});
	}
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
	avesmapsInitDialogDrag(document);
}

// Node-Export der reinen Begrenzungsrechnung (im Browser wirkungslos, dort ist alles oben global).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsClampDialogOffset: avesmapsClampDialogOffset,
	};
}
