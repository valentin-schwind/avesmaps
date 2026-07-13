/* Light/dark theme switch. The colour values for both themes live in
   css/base/tokens.css (:root vs :root[data-theme="dark"]). This module only
   toggles the data-theme attribute on <html> and remembers the choice; the
   sun/moon rise-from-below animation is pure CSS keyed off data-theme.

   The default follows the browser/OS colour scheme (prefers-color-scheme); an
   explicit toggle choice is saved in localStorage and overrides it across sessions
   (Owner). NOTE: the map tiles are light, so dark panels sit over a light map — a
   known trade-off accepted when opting into browser-default dark (docs/design-language.md).

   NOTE: only token-based components follow the theme today (the anchor panels
   plus the few already-migrated surfaces); components that still hardcode
   colours stay light until they are migrated. */
(function () {
	"use strict";
	var STORAGE_KEY = "avesmaps-theme";
	var LABEL = {
		light: "Auf dunkles Design umschalten",
		dark: "Auf helles Design umschalten"
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
			btn.setAttribute("aria-label", LABEL[theme] || LABEL.light);
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
	// here we just sync the aria-label once the DOM is ready.
	function init() {
		applyTheme(currentTheme());
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

	// Follow the browser/OS colour scheme LIVE, but only while the user has NOT made an explicit choice
	// (Owner: default = browser mode; a saved choice persists across sessions and wins). A stored value
	// short-circuits this, so toggling once pins the theme until the user toggles again.
	if (window.matchMedia) {
		var mq = window.matchMedia("(prefers-color-scheme: dark)");
		var onSchemeChange = function () {
			var saved = null;
			try {
				saved = localStorage.getItem(STORAGE_KEY);
			} catch (e) {
				saved = null;
			}
			if (saved === "dark" || saved === "light") {
				return; // explicit choice -> ignore the browser scheme
			}
			applyTheme(mq.matches ? "dark" : "light");
		};
		if (mq.addEventListener) {
			mq.addEventListener("change", onSchemeChange);
		} else if (mq.addListener) {
			mq.addListener(onSchemeChange);
		}
	}
})();
