/*
 * i18n overlay engine. German is the default; English (?lang=en) is an additive,
 * keyed override. Inert under German. See docs/i18n-overlay-design.md.
 */
(function () {
	"use strict";

	function detectLang() {
		try {
			var param = new URLSearchParams(window.location.search).get("lang");
			if (param === "en") {
				return "en";
			}
			if (param === "de") {
				return "de";
			}
			// No explicit ?lang: follow the browser's primary language (English -> en, otherwise German).
			var primary = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
			return primary.indexOf("en") === 0 ? "en" : "de";
		} catch (error) {
			return "de";
		}
	}

	var ACTIVE_LANG = detectLang();

	function table() {
		return window.AVESMAPS_I18N_EN || {};
	}

	function formatTemplate(template, params) {
		if (!params || template == null) {
			return template;
		}
		return String(template).replace(/\{(\w+)\}/g, function (match, key) {
			return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
		});
	}

	function warnMissing(key) {
		if (window.console && typeof console.warn === "function") {
			console.warn("[i18n] missing English key:", key);
		}
	}

	// tr(key, germanDefault, params?) -> string. German: returns germanDefault.
	function tr(key, germanDefault, params) {
		if (ACTIVE_LANG !== "en") {
			return formatTemplate(germanDefault, params);
		}
		var en = table();
		if (!Object.prototype.hasOwnProperty.call(en, key)) {
			warnMissing(key);
			return formatTemplate(germanDefault, params);
		}
		return formatTemplate(en[key], params);
	}

	var ATTR_TARGETS = [
		{ attr: "data-i18n", apply: function (el, v) { el.textContent = v; } },
		{ attr: "data-i18n-title", apply: function (el, v) { el.setAttribute("title", v); } },
		{ attr: "data-i18n-placeholder", apply: function (el, v) { el.setAttribute("placeholder", v); } },
		{ attr: "data-i18n-aria-label", apply: function (el, v) { el.setAttribute("aria-label", v); } },
		{ attr: "data-i18n-value", apply: function (el, v) { el.setAttribute("value", v); } },
	];

	// applyI18nOverlay(root=document): overwrite tagged nodes from the EN table. No-op under German.
	function applyI18nOverlay(root) {
		if (ACTIVE_LANG !== "en") {
			return;
		}
		var scope = root || document;
		var en = table();
		ATTR_TARGETS.forEach(function (target) {
			var nodes = scope.querySelectorAll("[" + target.attr + "]");
			Array.prototype.forEach.call(nodes, function (el) {
				var key = el.getAttribute(target.attr);
				if (!key) {
					return;
				}
				if (!Object.prototype.hasOwnProperty.call(en, key)) {
					warnMissing(key);
					return;
				}
				target.apply(el, en[key]);
			});
		});
	}

	window.tr = tr;
	window.applyI18nOverlay = applyI18nOverlay;
	window.avesmapsActiveLang = ACTIVE_LANG;

	if (ACTIVE_LANG === "en") {
		try {
			document.documentElement.lang = "en";
		} catch (error) {
			/* noop */
		}
		// Apply immediately so elements parsed before this script (the planner +
		// transport options) are translated BEFORE later top-level init code
		// (e.g. the transport combobox in map-features.js, which copies option
		// text) runs. The annotation is the scope, so this is safe to run early.
		applyI18nOverlay(document);
		// Re-apply on DOMContentLoaded to cover anything parsed after this script.
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", function () {
				applyI18nOverlay(document);
			});
		}
	}
})();
