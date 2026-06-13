"use strict";

// Standalone editor page (html/political-territory-editor.html) does NOT load
// js/app/api-client.js, so it lacks the canonical apiErrorMessage helper. Define
// a guarded fallback here (this file loads first in that page). In the main
// window / inline-host flow api-client.js already provides it, so this is a no-op.
if (typeof window.apiErrorMessage !== "function") {
	window.apiErrorMessage = function (data, fallback) {
		const error = data && data.error;
		if (typeof error === "string") {
			return error || fallback;
		}
		return (error && error.message) || fallback;
	};
}

/*
 * Editor-Kontext-/Host-Abstraktion.
 *
 * Entkoppelt die Editor-Skripte von den iframe-Annahmen
 * (window.location.search für Eingabeparameter, window.parent für Callbacks),
 * damit der Editor sowohl im aktuellen iframe als auch später inline in der
 * Hauptseite laufen kann.
 *
 * Rueckwaertskompatibel: Solange kein Kontext-Objekt gesetzt ist und der Editor
 * im iframe läuft, verhaelt sich alles wie bisher.
 *
 * - param(key):    liest aus window.AvesmapsPoliticalTerritoryEditorContext,
 *                  sonst aus der URL-Query (iframe-Altpfad).
 * - host():        Fenster, an dem die Karten-Callbacks hängen
 *                  (drawDerivedGeometryPreview, schedulePoliticalTerritoryLayerReload, ...).
 *                  Im iframe = window.parent, inline = window.
 * - isEmbedded():  true, wenn der Editor in einem iframe läuft.
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
