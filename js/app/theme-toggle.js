/* Light/dark theme switch. The colour values for both themes live in
   css/base/tokens.css (:root vs :root[data-theme="dark"]). This module only
   toggles the data-theme attribute on <html> and remembers the choice.

   Dark is opt-in (never prefers-color-scheme) — the map tiles are light, so
   auto-dark panels would clash over them (see docs/design-language.md).

   NOTE: only token-based components follow the theme today (the anchor panels
   plus the few already-migrated surfaces); components that still hardcode
   colours stay light until they are migrated. */
(function () {
	"use strict";
	var STORAGE_KEY = "avesmaps-theme";

	/* Keyed by the CURRENT theme; the button shows the TARGET it switches to. */
	var FACE = {
		light: { icon: "🌙", label: "Auf dunkles Design umschalten" },
		dark: { icon: "☀️", label: "Auf helles Design umschalten" }
	};

	function applyTheme(theme) {
		var root = document.documentElement;
		if (theme === "dark") {
			root.setAttribute("data-theme", "dark");
		} else {
			root.removeAttribute("data-theme");
		}
		var btn = document.querySelector(".theme-toggle-btn");
		if (btn) {
			var face = FACE[theme] || FACE.light;
			btn.textContent = face.icon;
			btn.setAttribute("aria-label", face.label);
			btn.setAttribute("title", face.label);
		}
		// mobile browser chrome colour
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) {
			meta.setAttribute("content", theme === "dark" ? "#211f19" : "#565044");
		}
	}

	function currentTheme() {
		return document.documentElement.getAttribute("data-theme") === "dark"
			? "dark"
			: "light";
	}

	// Delegated click handler so it works no matter where the control sits.
	document.addEventListener("click", function (event) {
		var btn = event.target.closest && event.target.closest(".theme-toggle-btn");
		if (!btn) {
			return;
		}
		var next = currentTheme() === "dark" ? "light" : "dark";
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch (e) {
			/* private mode / storage disabled — theme still applies for this session */
		}
		applyTheme(next);
	});

	// The <head> guard already set data-theme from storage before first paint;
	// here we just sync the button's face once the DOM is ready.
	function init() {
		applyTheme(currentTheme());
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
