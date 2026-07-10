// Infopanel (?infopanel=true) -- hosts the feature info that normally appears in floating map
// popups inside a collapsible right-edge panel (see docs/infopanel-instruction.md). The panel is
// NEVER shown empty (Owner-Vorgabe): it only opens once it has content, and otherwise collapses --
// with the edge tab hidden -- so there is no empty-open state. A feature click
// (avesmapsShowInfopanel) fills and opens it. Fully gated on the flag: without ?infopanel=true
// nothing is created and the live UI is unchanged.
(function initInfopanel() {
	if (typeof IS_INFOPANEL_MODE === "undefined" || !IS_INFOPANEL_MODE) {
		return;
	}
	if (document.querySelector(".avesmaps-infopanel")) {
		return; // schon gebaut
	}

	// Marker fuer flag-gebundene CSS (Panel-Optik + Zoom-/Hinweise-Verschiebung). Wird zusaetzlich
	// frueh in js/config.js auf <html> gesetzt (damit die Zoom-Position schon beim Anlegen stimmt);
	// hier als Sicherheitsnetz auf <body>.
	document.body.classList.add("avesmaps-infopanel-mode");

	var panel = document.createElement("aside");
	panel.className = "avesmaps-infopanel";
	panel.setAttribute("aria-label", "Info");

	// Wegpunkt-Tabs folgen in Phase 4; solange leer -> per CSS (:empty) ausgeblendet.
	var tabs = document.createElement("div");
	tabs.className = "avesmaps-infopanel__tabs";

	var body = document.createElement("div");
	body.className = "avesmaps-infopanel__body";

	panel.appendChild(tabs);
	panel.appendChild(body);

	var handle = document.createElement("button");
	handle.type = "button";
	handle.className = "avesmaps-infopanel__handle";
	handle.textContent = "Info";
	handle.setAttribute("aria-label", "Infopanel ein- oder ausklappen");

	document.body.appendChild(panel);
	document.body.appendChild(handle);

	// Kein Inhalt -> Panel eingeklappt UND Rand-Tab ausgeblendet (nie leer offen). `collapsed` gilt
	// nur, WENN Inhalt da ist. Der Zustand lebt bewusst nur zur Laufzeit: nach einem Reload ist das
	// Panel ohnehin leer (Inhalt wird nicht persistiert) -> es startet immer zu.
	var hasContent = false;
	var collapsed = false;

	function sync() {
		panel.classList.toggle("is-hidden", collapsed || !hasContent);
		handle.style.display = hasContent ? "" : "none";
		handle.classList.toggle("is-hidden", collapsed);
		handle.setAttribute("aria-expanded", (!collapsed && hasContent) ? "true" : "false");
	}
	sync();

	handle.addEventListener("click", function () {
		if (!hasContent) {
			return; // ein leeres Panel wird nie geoeffnet
		}
		collapsed = !collapsed;
		sync();
	});

	// ----- Oeffentliche API -----
	window.avesmapsInfopanelExpand = function () {
		if (!hasContent) {
			return; // nie leer oeffnen
		}
		collapsed = false;
		sync();
	};
	window.avesmapsInfopanelCollapse = function () {
		collapsed = true;
		sync();
	};
	// Setzt den Panel-Inhalt (HTML-String eines Feature-Builders) und oeffnet auf. Leerer/kein Inhalt
	// -> Panel leeren + einklappen (nie leer offen). Gibt das Body-Element zurueck, damit der Aufrufer
	// z. B. hydrateLocationReviews darauf anwenden kann.
	window.avesmapsShowInfopanel = function (html) {
		if (typeof html === "string" && html.trim() !== "") {
			body.innerHTML = html;
			body.scrollTop = 0;
			hasContent = true;
			collapsed = false;
		} else {
			body.innerHTML = "";
			hasContent = false;
		}
		sync();
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
