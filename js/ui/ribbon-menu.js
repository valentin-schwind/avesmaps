/**
 * Das Sammelmenü im Menüband (`.rb-menu`) — Auf- und Zuklappen, EINMAL.
 *
 * Ein Knopf im Menüband, unter dem ein Panel hängt: „Wappen & Bilder ▾" im Ortseditor, „Wappen ▾"
 * im Territorien-Editor, „Rechnen ▾" im Landschaften-Editor. Die Optik steht in
 * `css/components/editor-page.css` (`.rb-menu*`); hier steht nur das Verhalten.
 *
 * 💣 WARUM ES DIESE DATEI GIBT. Das Verhalten stand am 24.08.2026 ZWEIMAL wörtlich gleich inline —
 * in `html/wiki-sync-settlement-editor.html` und `html/wiki-sync-monitor.html`, Zeile für Zeile
 * dasselbe unter zwei Präfixen (`se…`/`btn…`). Der dritte Editor hätte die dritte Kopie bekommen.
 * Genau diesen Weg beschreibt AGENTS.md §11 für die Listenzeilen (sieben Rezepturen für eine
 * Zeile) und für die Wiki-Zuweisung (sechs Fassungen über ~1400 Zeilen) — beide mussten teuer
 * wieder eingesammelt werden. Hier wurde vor der dritten Kopie eingesammelt.
 *
 * 🔴 ABHÄNGIGKEITSFREI, und das ist Absicht: die Editoren sind eigenständige Dokumente in einem
 * iframe und laden das Hauptfenster-Rüstzeug nicht. Dieselbe Entscheidung wie bei
 * `js/ui/filter-menu.js`, dessen Kopf es ebenso begründet. Kein `escapeHtml`, kein `$`, keine
 * Globalen — nur DOM.
 *
 * 💣 DER ZUSTAND IST DAS `hidden`-ATTRIBUT DES PANELS UND SONST NICHTS. Kein Modulzustand daneben,
 * der auseinanderlaufen kann. (Beim Anzeige-Menü der Karte und bei den Ansichts-Kacheln ist genau
 * das schiefgegangen — dort wurde der Zustand an einer Klasse gelesen, die erst im nächsten Bild
 * gesetzt wird, siehe AGENTS.md §11.) Wer den Stand wissen will, fragt `istOffen()`.
 *
 * 🪤 UND DIE FALLE, DIE DAS MENÜ SCHON EINMAL LIVE UNBRAUCHBAR GEMACHT HAT (23.08.2026, vom Owner
 * gemeldet): beim Umbau blieb der alte Klapp-Block stehen und der neue kam dazu. Zwei
 * `function setCoatsMenuOpen` sind gültiges JavaScript — die zweite gewinnt —, aber der
 * Klick-Handler war damit ZWEIMAL registriert: der erste öffnete, der zweite schloss im selben
 * Klick. Für den Benutzer passiert nichts, und jede einzelne Zeile sieht richtig aus. Deshalb ist
 * `avesmapsRibbonMenuAttach` gegen Doppelanmeldung gesichert (`__avmRibbonMenu` am Knopf) — ein
 * zweiter Aufruf auf demselben Knopf liefert die vorhandene Steuerung zurück, statt einen zweiten
 * Satz Handler zu legen.
 */

(function () {
	"use strict";

	/**
	 * Hängt das Auf-/Zuklappen an ein `.rb-menu`-Paar.
	 *
	 * @param {HTMLElement} knopf  Der Kachel-Knopf mit `aria-haspopup="true"`.
	 * @param {HTMLElement} panel  Das Panel darunter (`.rb-menu__panel`), im Ruhezustand `hidden`.
	 * @returns {{oeffne: Function, schliesse: Function, umschalten: Function, istOffen: Function}|null}
	 *          `null`, wenn eines der beiden Elemente fehlt — ein fehlendes Menü ist kein Fehler,
	 *          aber auch keine Steuerung, die man aufrufen könnte.
	 */
	function avesmapsRibbonMenuAttach(knopf, panel) {
		if (!knopf || !panel) return null;
		// Zweiter Aufruf auf demselben Knopf: die vorhandene Steuerung, kein zweiter Handlersatz.
		if (knopf.__avmRibbonMenu) return knopf.__avmRibbonMenu;

		function setzeOffen(offen) {
			panel.hidden = !offen;
			knopf.setAttribute("aria-expanded", offen ? "true" : "false");
		}
		function istOffen() {
			return panel.hidden === false;
		}

		knopf.addEventListener("click", function (ereignis) {
			// Ohne das schlägt der Klick sofort auf `document` durch und schließt, was er öffnet.
			ereignis.stopPropagation();
			setzeOffen(!istOffen());
		});
		// ⚠️ Der Klick INS Menü darf es nicht zuklappen — sonst schließt jeder Schalterdruck das
		// Menü, und man kann nicht zwei Dinge hintereinander tun.
		panel.addEventListener("click", function (ereignis) { ereignis.stopPropagation(); });
		document.addEventListener("click", function () { setzeOffen(false); });
		document.addEventListener("keydown", function (ereignis) {
			if (ereignis.key === "Escape") setzeOffen(false);
		});

		// Der Ruhezustand steht im Markup (`hidden`); hier wird er nur gespiegelt, nicht gesetzt —
		// ein Menü, das sich beim Anhängen selbst schließt, überschriebe ein bewusst offenes.
		knopf.setAttribute("aria-expanded", istOffen() ? "true" : "false");

		const steuerung = {
			oeffne: function () { setzeOffen(true); },
			schliesse: function () { setzeOffen(false); },
			umschalten: function () { setzeOffen(!istOffen()); },
			istOffen: istOffen,
		};
		knopf.__avmRibbonMenu = steuerung;
		return steuerung;
	}

	/** Bequemlichkeit für die Editorseiten, die ihre Elemente über IDs kennen. */
	function avesmapsRibbonMenuAttachById(knopfId, panelId) {
		return avesmapsRibbonMenuAttach(document.getElementById(knopfId), document.getElementById(panelId));
	}

	if (typeof window !== "undefined") {
		window.avesmapsRibbonMenuAttach = avesmapsRibbonMenuAttach;
		window.avesmapsRibbonMenuAttachById = avesmapsRibbonMenuAttachById;
	}
	// Für den Unit-Test (node) — im Browser ist `module` nicht definiert.
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { avesmapsRibbonMenuAttach, avesmapsRibbonMenuAttachById };
	}
})();
