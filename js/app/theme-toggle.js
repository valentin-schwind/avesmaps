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

	function applyTheme(theme) {
		var root = document.documentElement;
		if (theme === "dark") {
			root.setAttribute("data-theme", "dark");
		} else {
			root.removeAttribute("data-theme");
		}
		// keep the segmented control in sync
		var buttons = document.querySelectorAll(".theme-toggle__btn");
		for (var i = 0; i < buttons.length; i++) {
			buttons[i].setAttribute(
				"aria-pressed",
				buttons[i].getAttribute("data-theme-choice") === theme ? "true" : "false"
			);
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
		var btn = event.target.closest && event.target.closest(".theme-toggle__btn");
		if (!btn) {
			return;
		}
		var theme = btn.getAttribute("data-theme-choice") === "dark" ? "dark" : "light";
		try {
			localStorage.setItem(STORAGE_KEY, theme);
		} catch (e) {
			/* private mode / storage disabled — theme still applies for this session */
		}
		applyTheme(theme);
	});

	// The <head> guard already set data-theme from storage before first paint;
	// here we just sync the control's pressed state once the DOM is ready.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () {
			applyTheme(currentTheme());
		});
	} else {
		applyTheme(currentTheme());
	}
})();
