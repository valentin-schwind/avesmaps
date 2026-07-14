/*
 * i18n overlay engine. German is the default; English (?lang=en) is an additive,
 * keyed override. Inert under German. See docs/i18n-overlay-design.md.
 */
(function () {
	"use strict";

	function detectLang() {
		try {
			var param = (typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search)).get("lang");
			if (param === "en") {
				return "en";
			}
			if (param === "de") {
				return "de";
			}
			// No explicit ?lang: a stored choice (the DE|EN toggle, key "avesmaps-lang") wins over the
			// browser language; otherwise follow the browser's primary language (English -> en, else German).
			var stored = null;
			try { stored = window.localStorage.getItem("avesmaps-lang"); } catch (e) { stored = null; }
			if (stored === "en" || stored === "de") {
				return stored;
			}
			// German is the default; English is opt-in ONLY via ?lang=en or the DE|EN toggle (AGENTS.md §8) --
			// no longer auto-derived from the browser language, which showed German users with an English browser
			// a broken DE/EN mix (incomplete EN coverage falls back to German per key).
			return "de";
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
