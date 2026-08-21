"use strict";

/*
 * Inline-Host für den politischen Herrschaftsgebiet-Editor.
 *
 * Loest den frueheren <iframe> auf: das Editor-Markup, die scoped CSS und die
 * Editor-Skripte werden EINMALIG in #political-territory-editor-host (in der
 * Hauptseite) geladen. Eingabeparameter kommen über das Kontext-Objekt
 * window.AvesmapsPoliticalTerritoryEditorContext (gelesen via
 * AvesmapsEditorContext.param), nicht mehr über eine iframe-URL. Die Karten-
 * Callbacks laufen direkt im selben window (AvesmapsEditorContext.host()).
 *
 * Nur im Edit-Modus aktiv. Die Editor-Skripte sind alle IIFE-gekapselt und
 * exportieren ausschließlich window.Avesmaps*-Objekte, daher ist das Laden in
 * den Hauptseiten-Scope kollisionsfrei (vorab verifiziert).
 */
(function initPoliticalTerritoryEditorInlineHost() {
	const EDITOR_HTML_URL = "/html/political-territory-editor.html";
	const SCOPED_CSS_URL = "/css/pages/political-territory-editor-inline.css";
	const HOST_ID = "political-territory-editor-host";
	// Cache-Buster für die dynamisch geladenen Editor-Assets: bei jeder Änderung
	// an Editor-JS/CSS hochzählen, damit Deploys sofort greifen (kein Hard-Reload).
	const ASSET_VERSION = "20260821a";
	function withVersion(url) {
		return url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + ASSET_VERSION;
	}

	// Reihenfolge wie im bisherigen iframe-HTML (Abhängigkeiten beachtet).
	// filter-menu.js VOR embedded.js: dieses verdrahtet den geteilten Zeitfilter-Trichter beim
	// Auswerten (avmFilterMenuAttach). Ohne Abhängigkeiten, daher ganz vorn.
	const EDITOR_SCRIPTS = [
		"/js/ui/filter-menu.js",
		"/js/territory/territory-editor-context.js",
		"/js/territory/territory-editor-active-node.js",
		"/js/territory/territory-wiki-tree.js",
		"/js/territory/territory-editor-embedded.js",
		"/js/territory/territory-editor-drop-compat.js",
		"/js/territory/territory-editor-save.js",
		"/js/territory/territory-editor-display-state.js",
		"/js/territory/territory-editor-form.js",
		"/js/territory/territory-editor-api.js",
		"/js/territory/territory-subtree-display-tools.js",
		"/js/territory/territory-editor-color-utils.js",
		"/js/territory/territory-editor-inheritance.js",
		"/js/territory/territory-editor-coat-restore.js",
		"/js/territory/territory-boundary-debug-tools.js",
		"/js/territory/territory-editor-ui-hints.js",
		"/js/territory/territory-editor-panel-columns.js",
	];

	let loadPromise = null;

	function isEditMode() {
		return typeof IS_EDIT_MODE !== "undefined" ? Boolean(IS_EDIT_MODE) : false;
	}

	function ensureScopedCss() {
		if (document.querySelector(`link[data-avesmaps-editor-inline-css]`)) return;
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = withVersion(SCOPED_CSS_URL);
		link.setAttribute("data-avesmaps-editor-inline-css", "1");
		document.head.appendChild(link);

		// Additive Layout-Ergaenzung (volle Breite + zweispaltige Panels) NACH dem
		// generierten Scoped-Sheet laden, damit sie bei gleicher Spezifitaet gewinnt.
		if (!document.querySelector("link[data-avesmaps-editor-columns-css]")) {
			const columnsLink = document.createElement("link");
			columnsLink.rel = "stylesheet";
			columnsLink.href = withVersion("/css/components/political-territory-editor-columns.css");
			columnsLink.setAttribute("data-avesmaps-editor-columns-css", "1");
			document.head.appendChild(columnsLink);
		}
	}

	// Liegt das Skript schon im Dokument, weil die SEITE es geladen hat (index.html)?
	// 🔴 Verglichen wird der PFAD, nicht die Adresse: der Stempel unterscheidet sich immer
	// (?v=<hash> gegen ?v=ASSET_VERSION), und index.html schreibt relativ, der Host absolut.
	// ⚠️ Eigene Skripte (Marker) sind hier ausgenommen -- die koennen noch LADEN und werden im
	// Zweig darueber am load-Ereignis abgewartet. Wer sie mitnaehme, loeste das Versprechen auf,
	// bevor das Skript ausgefuehrt ist.
	function avesmapsEditorHostScriptAlreadyPresent(scripts, src, baseUri) {
		if (!Array.isArray(scripts) && !(scripts && typeof scripts.length === "number")) return false;
		const pfadVon = (wert) => {
			try { return new URL(String(wert), baseUri).pathname; } catch (fehler) { return ""; }
		};
		const ziel = src ? pfadVon(src) : "";
		if (!ziel) return false;
		return Array.prototype.some.call(scripts, (node) => {
			if (!node || !node.src) return false;
			if (node.dataset && node.dataset.avesmapsEditorSrc) return false;
			return pfadVon(node.src) === ziel;
		});
	}

	function loadScriptOnce(src) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(`script[data-avesmaps-editor-src="${src}"]`);
			if (existing) {
				if (existing.dataset.loaded === "1") resolve();
				else existing.addEventListener("load", () => resolve(), { once: true });
				return;
			}
			// 💣 Die Seite hat manche dieser Dateien schon (filter-menu.js, dialog-drag.js stehen in
			// index.html). Ein zweites Laden fuehrt sie ein zweites Mal aus, und ein `const` auf
			// oberster Ebene bricht dabei mit "already been declared" ab -- folgenlos, weil die erste
			// Ausfuehrung alles definiert hat, aber ein roter Konsolenfehler bei jedem Oeffnen.
			// ⚠️ Sofort aufloesen ist hier richtig: index.html laedt diese Skripte klassisch (ohne
			// defer/async), sie sind also laengst ausgefuehrt, wenn jemand den Editor oeffnet.
			if (avesmapsEditorHostScriptAlreadyPresent(document.scripts, src, document.baseURI)) {
				resolve();
				return;
			}
			const script = document.createElement("script");
			script.src = withVersion(src);
			script.setAttribute("data-avesmaps-editor-src", src);
			script.addEventListener("load", () => { script.dataset.loaded = "1"; resolve(); }, { once: true });
			script.addEventListener("error", () => reject(new Error(`Editor-Skript konnte nicht geladen werden: ${src}`)), { once: true });
			document.body.appendChild(script);
		});
	}

	// Extrahiert den Inhalt von .app-container aus dem Editor-HTML (ohne <script>).
	function extractEditorMarkup(html) {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const container = doc.querySelector(".app-container") || doc.body;
		container.querySelectorAll("script").forEach((node) => node.remove());
		return container.outerHTML;
	}

	async function loadInlineEditorOnce() {
		if (loadPromise) return loadPromise;
		loadPromise = (async () => {
			ensureScopedCss();
			const host = document.getElementById(HOST_ID);
			if (!host) throw new Error("Editor-Host-Container fehlt.");

			const response = await fetch(withVersion(EDITOR_HTML_URL), { credentials: "same-origin" });
			if (!response.ok) throw new Error(`Editor-Markup konnte nicht geladen werden: HTTP ${response.status}`);
			const html = await response.text();
			host.innerHTML = extractEditorMarkup(html);
			host.classList.add("is-embedded");

			// Skripte streng sequenziell laden, damit Abhängigkeiten (z. B.
			// Kontext vor embedded, embedded vor save) wie im iframe gelten.
			for (const src of EDITOR_SCRIPTS) {
				await loadScriptOnce(src);
			}
			return true;
		})().catch((error) => {
			loadPromise = null; // erneuter Versuch beim nächsten Öffnen
			throw error;
		});
		return loadPromise;
	}

	window.AvesmapsPoliticalTerritoryEditorInlineHost = {
		isEditMode,
		load: loadInlineEditorOnce,
		hostId: HOST_ID,
		assetVersion: ASSET_VERSION,
	};
	// Nur fuer den Test: die Entscheidung "liegt schon im Dokument" ohne DOM pruefbar machen.
	globalThis.avesmapsEditorHostScriptAlreadyPresent = avesmapsEditorHostScriptAlreadyPresent;
})();
