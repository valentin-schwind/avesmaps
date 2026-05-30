"use strict";

/*
 * Editor-Kontext-/Host-Abstraktion.
 *
 * Entkoppelt die Editor-Skripte von den iframe-Annahmen
 * (window.location.search fuer Eingabeparameter, window.parent fuer Callbacks),
 * damit der Editor sowohl im aktuellen iframe als auch spaeter inline in der
 * Hauptseite laufen kann.
 *
 * Rueckwaertskompatibel: Solange kein Kontext-Objekt gesetzt ist und der Editor
 * im iframe laeuft, verhaelt sich alles wie bisher.
 *
 * - param(key):    liest aus window.AvesmapsPoliticalTerritoryEditorContext,
 *                  sonst aus der URL-Query (iframe-Altpfad).
 * - host():        Fenster, an dem die Karten-Callbacks haengen
 *                  (drawDerivedGeometryPreview, schedulePoliticalTerritoryLayerReload, ...).
 *                  Im iframe = window.parent, inline = window.
 * - isEmbedded():  true, wenn der Editor in einem iframe laeuft.
 */
(function initAvesmapsEditorContext() {
	function getContextObject() {
		const context = window.AvesmapsPoliticalTerritoryEditorContext;
		return context && typeof context === "object" ? context : null;
	}

	function isEmbedded() {
		try {
			return Boolean(window.parent) && window.parent !== window;
		} catch (error) {
			// Cross-origin parent access wirft -> dann sind wir definitiv eingebettet.
			return true;
		}
	}

	function param(key, fallback = null) {
		const context = getContextObject();
		if (context && Object.prototype.hasOwnProperty.call(context, key)) {
			const value = context[key];
			return value === undefined || value === null ? fallback : String(value);
		}
		try {
			const value = new URLSearchParams(window.location.search).get(key);
			return value === null ? fallback : value;
		} catch (error) {
			return fallback;
		}
	}

	function host() {
		// Inline (kein iframe) -> eigenes Fenster traegt die Karten-Callbacks.
		if (!isEmbedded()) {
			return window;
		}
		try {
			return window.parent || window;
		} catch (error) {
			return window;
		}
	}

	window.AvesmapsEditorContext = {
		param,
		host,
		isEmbedded,
		getContextObject,
	};
})();
