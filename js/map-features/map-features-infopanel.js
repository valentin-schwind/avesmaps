// Infopanel (?infopanel=true) -- hosts the feature info that normally appears in
// floating map popups inside a collapsible right-edge panel (see
// docs/infopanel-instruction.md). Phase 0: scaffold only -- panel shell, edge tab
// and collapse mechanic; the public API is stubbed for later phases. Content
// wiring (settlements/ways/regions), the waypoint tabs and the zoom/hints
// relocation follow in later phases. Fully gated on the flag: without
// ?infopanel=true nothing is created and the live UI is unchanged.
(function initInfopanel() {
	if (typeof IS_INFOPANEL_MODE === "undefined" || !IS_INFOPANEL_MODE) {
		return;
	}
	if (document.querySelector(".avesmaps-infopanel")) {
		return; // schon gebaut
	}

	// Marker fuer flag-gebundene CSS (z. B. die Kontroll-Verschiebung in Phase 3).
	document.body.classList.add("avesmaps-infopanel-mode");

	var COLLAPSE_KEY = "avesmaps.infopanel.collapsed";
	function readCollapsed() {
		try {
			var stored = window.localStorage.getItem(COLLAPSE_KEY);
			return stored === null ? true : stored === "1"; // Default: eingeklappt
		} catch (error) {
			return true;
		}
	}
	function writeCollapsed(value) {
		try {
			window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
		} catch (error) {
			/* localStorage kann blockiert sein -> Zustand nur zur Laufzeit */
		}
	}

	var panel = document.createElement("aside");
	panel.className = "avesmaps-infopanel";
	panel.setAttribute("aria-label", "Info");

	// Wegpunkt-Tabs folgen in Phase 4; solange leer -> per CSS (:empty) ausgeblendet.
	var tabs = document.createElement("div");
	tabs.className = "avesmaps-infopanel__tabs";

	var body = document.createElement("div");
	body.className = "avesmaps-infopanel__body";
	body.innerHTML = '<div class="avesmaps-infopanel__empty">Klicke einen Ort, Weg oder ein Gebiet auf der Karte an, um die Details hier zu sehen.</div>';

	panel.appendChild(tabs);
	panel.appendChild(body);

	var handle = document.createElement("button");
	handle.type = "button";
	handle.className = "avesmaps-infopanel__handle";
	handle.textContent = "Info";
	handle.setAttribute("aria-label", "Infopanel ein- oder ausklappen");

	document.body.appendChild(panel);
	document.body.appendChild(handle);

	var collapsed = readCollapsed();
	function syncCollapsed() {
		panel.classList.toggle("is-hidden", collapsed);
		handle.classList.toggle("is-hidden", collapsed);
		handle.setAttribute("aria-expanded", collapsed ? "false" : "true");
	}
	syncCollapsed();

	handle.addEventListener("click", function () {
		collapsed = !collapsed;
		writeCollapsed(collapsed);
		syncCollapsed();
	});

	// ----- Oeffentliche API (ab Phase 1 vom Klick-Routing genutzt) -----
	window.avesmapsInfopanelExpand = function () {
		if (collapsed) {
			collapsed = false;
			writeCollapsed(false);
			syncCollapsed();
		}
	};
	window.avesmapsInfopanelCollapse = function () {
		if (!collapsed) {
			collapsed = true;
			writeCollapsed(true);
			syncCollapsed();
		}
	};
	// Setzt den Panel-Inhalt (HTML-String eines Feature-Builders) und klappt auf.
	// Gibt das Body-Element zurueck, damit der Aufrufer z. B. hydrateLocationReviews
	// darauf anwenden kann (Phase 1).
	window.avesmapsShowInfopanel = function (html) {
		if (typeof html === "string") {
			body.innerHTML = html;
			body.scrollTop = 0;
		}
		window.avesmapsInfopanelExpand();
		return body;
	};
	window.avesmapsInfopanelBody = function () {
		return body;
	};

	// Feature-Glue (Phase 1, Siedlungen): baut den UNVERAENDERTEN Siedlungs-Popup-HTML
	// (buildLocationMarkerPopupHtml) und zeigt ihn im Panel; laedt danach die Bewertungen in den
	// Panel-Slot nach. Wird vom Klick-Arbiter (Canvas) und vom programmatischen Oeffnen (Suche/
	// Deeplink) im Infopanel-Modus statt des schwebenden Popups aufgerufen. Existiert nur im
	// Infopanel-Modus -> die Aufrufer pruefen `typeof ... === "function"` und fallen sonst auf das
	// bisherige Popup-Verhalten zurueck.
	window.avesmapsShowLocationInInfopanel = function (markerEntry) {
		if (!markerEntry || typeof buildLocationMarkerPopupHtml !== "function") {
			return false;
		}
		var panelBody = window.avesmapsShowInfopanel(buildLocationMarkerPopupHtml(markerEntry));
		if (panelBody && typeof hydrateLocationReviews === "function") {
			hydrateLocationReviews(panelBody.querySelector(".location-reviews"));
		}
		return true;
	};
})();
