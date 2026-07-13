/* DE|EN language switch (sits next to the theme toggle). German is the default;
   English is an additive overlay applied at load by js/app/i18n.js. There is no
   live re-render path (data-i18n nodes + tr()-built popups are resolved once at
   load), so switching persists the choice in localStorage ("avesmaps-lang") and
   reloads -- i18n.js' detectLang() reads that key (priority: ?lang > stored > browser).

   Deliberately NOT touching the address bar (see the URL-sharing policy): the choice
   lives in storage, not in a ?lang query param. An explicit ?lang in a shared link
   still wins, as before. */
(function () {
	"use strict";
	var STORAGE_KEY = "avesmaps-lang";

	function currentLang() {
		return window.avesmapsActiveLang === "en" ? "en" : "de";
	}

	// Mark the active segment so the toggle reflects the language actually rendered.
	function markActive() {
		var active = currentLang();
		var opts = document.querySelectorAll(".lang-toggle__opt");
		Array.prototype.forEach.call(opts, function (el) {
			var on = el.getAttribute("data-lang") === active;
			el.classList.toggle("is-active", on);
			el.setAttribute("aria-pressed", on ? "true" : "false");
		});
	}

	// Delegated so it works regardless of where the control sits in the DOM.
	document.addEventListener("click", function (event) {
		var opt = event.target.closest && event.target.closest(".lang-toggle__opt");
		if (!opt) {
			return;
		}
		var lang = opt.getAttribute("data-lang");
		if (lang !== "en" && lang !== "de") {
			return;
		}
		if (lang === currentLang()) {
			return; // already active -> nothing to do
		}
		try {
			window.localStorage.setItem(STORAGE_KEY, lang);
		} catch (e) {
			/* private mode / storage disabled -- cannot persist, so a reload would not stick; bail out. */
			return;
		}
		window.location.reload();
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", markActive);
	} else {
		markActive();
	}
})();
