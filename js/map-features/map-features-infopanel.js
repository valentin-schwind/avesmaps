// Infopanel (?infopanel=true) -- hosts the feature info that normally appears in floating map
// popups inside a collapsible right-edge panel (see docs/infopanel-instruction.md). The panel is
// NEVER shown empty (Owner-Vorgabe): it only opens once it has content, and otherwise collapses --
// with the edge tab hidden -- so there is no empty-open state. A feature click
// (avesmapsShowInfopanel) fills and opens it. The tab strip mirrors the current route waypoints
// (Phase 4); the tab of a clicked feature that IS a waypoint is highlighted, and clicking a tab
// opens that waypoint's info. Fully gated on the flag: without ?infopanel=true nothing is created
// and the live UI is unchanged.
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

	// Wegpunkt-Tabs (Phase 4): aus den aktuellen Wegpunkten gebaut; leer -> per CSS (:empty) aus.
	var tabs = document.createElement("div");
	tabs.className = "avesmaps-infopanel__tabs";

	var body = document.createElement("div");
	body.className = "avesmaps-infopanel__body";

	panel.appendChild(tabs);
	panel.appendChild(body);

	var handle = document.createElement("button");
	handle.type = "button";
	handle.className = "avesmaps-infopanel__handle";
	// "Info" um 180° gedreht (liest von unten nach oben, wie der Editor-Tab). Die Drehung sitzt auf dem
	// Label-Span, damit die Tab-Form (linke runde Ecken + Schatten) unveraendert bleibt.
	handle.innerHTML = '<span class="avesmaps-infopanel__handle-label">Info</span>';
	handle.setAttribute("aria-label", "Infopanel ein- oder ausklappen");

	document.body.appendChild(panel);
	document.body.appendChild(handle);

	// Kein Inhalt -> Panel eingeklappt UND Rand-Tab ausgeblendet (nie leer offen). `collapsed` gilt
	// nur, WENN Inhalt da ist. Der Zustand lebt bewusst nur zur Laufzeit: nach einem Reload ist das
	// Panel ohnehin leer (Inhalt wird nicht persistiert) -> es startet immer zu. Ausnahme: im
	// Edit-Mode ist der Info-Tab immer sichtbar (zweiter Tab neben "Editor").
	var hasContent = false;
	var collapsed = false;
	// Name des aktuell angezeigten Features -> markiert den passenden Wegpunkt-Tab als aktiv (leer,
	// wenn das Feature kein Wegpunkt ist -> transiente Ansicht ohne aktiven Tab).
	var currentTabActive = "";

	function sync() {
		var open = hasContent && !collapsed;
		panel.classList.toggle("is-hidden", !open);
		handle.style.display = (hasContent || (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)) ? "" : "none";
		handle.classList.toggle("is-hidden", collapsed);
		handle.setAttribute("aria-expanded", open ? "true" : "false");
		// Zoom + "Hinweise" fahren mit der Panel-Kante mit (CSS an dieser Klasse): offen -> ans
		// Panel-Eck, zu -> unten rechts am Bildschirmrand. Im Edit-Mode belegt der Editor die rechte
		// Kante dauerhaft -> dann immer ans Panel-Eck, auch wenn das Info-Panel leer/verborgen ist.
		var editActive = (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE);
		document.documentElement.classList.toggle("avesmaps-infopanel-open", open || editActive);
	}
	sync();

	// Edit-Mode-Koexistenz (Phase 5): Infopanel + Editor-Panel (#review-panel) teilen die rechte
	// Kante; zwei gestapelte Rand-Tabs (Info oben, "Editor" per CSS darunter). Ein Klick holt das
	// jeweilige Panel per z-index nach VORN. Das Infopanel bleibt dabei "offen" (nicht eingeklappt),
	// damit Zoom/Hinweise stabil am Panel-Eck bleiben.
	function bringInfopanelToFront() { panel.classList.add("avesmaps-infopanel--front"); }
	function sendInfopanelToBack() { panel.classList.remove("avesmaps-infopanel--front"); }
	if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
		var editorToggle = document.getElementById("review-panel-toggle");
		if (editorToggle) {
			// Klick auf "Editor" -> Editor nach vorn (Infopanel dahinter); der Editor-eigene Toggle
			// (toggleReviewPanel) laeuft unveraendert daneben.
			editorToggle.addEventListener("click", sendInfopanelToBack);
		}
	}

	// Baut die Tab-Leiste aus den AKTUELLEN Wegpunkten (getWaypointInputValues, visuelle Reihenfolge).
	// Doppelte Namen (z. B. Rundreise A->B->A) werden zusammengefasst. Der Tab, dessen Name dem gerade
	// angezeigten Feature entspricht, ist aktiv.
	function renderTabs() {
		var names = (typeof getWaypointInputValues === "function") ? getWaypointInputValues() : [];
		var seen = {};
		var unique = [];
		names.forEach(function (name) {
			var key = String(name || "").toLowerCase();
			if (!name || seen[key]) {
				return;
			}
			seen[key] = true;
			unique.push(name);
		});
		tabs.innerHTML = "";
		unique.forEach(function (name, idx) {
			// Trenner "›" zwischen den Pillen -> macht klar, dass es die Reiseroute ist.
			if (idx > 0) {
				var sep = document.createElement("span");
				sep.className = "avesmaps-infopanel__tab-sep";
				sep.setAttribute("aria-hidden", "true");
				sep.textContent = "›";
				tabs.appendChild(sep);
			}
			var pill = document.createElement("span");
			pill.className = "avesmaps-infopanel__tab";
			if (name === currentTabActive) {
				pill.classList.add("is-active");
			}
			var label = document.createElement("button");
			label.type = "button";
			label.className = "avesmaps-infopanel__tab-label";
			label.textContent = name;
			label.title = name;
			label.addEventListener("click", function () {
				openWaypointInPanel(name);
			});
			// Kleines "x": entfernt diesen Wegpunkt aus der Route.
			var remove = document.createElement("button");
			remove.type = "button";
			remove.className = "avesmaps-infopanel__tab-remove";
			remove.setAttribute("aria-label", "Wegpunkt entfernen");
			remove.title = "Wegpunkt entfernen";
			remove.textContent = "✕";
			remove.addEventListener("click", function (event) {
				event.stopPropagation();
				removeWaypointByName(name);
			});
			pill.appendChild(label);
			pill.appendChild(remove);
			tabs.appendChild(pill);
		});
	}

	// Tab-Klick: den Wegpunkt (Name) als Ort aufloesen und seine Info ins Panel holen. Ist er kein
	// geladener Ort (z. B. ein reiner Kartenpunkt), passiert nichts (kein Inhalt zum Anzeigen).
	function openWaypointInPanel(name) {
		var entry = (typeof findLocationMarkerByName === "function") ? findLocationMarkerByName(name) : null;
		if (entry && typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
		}
	}

	// "x" an einer Pille: den ersten Wegpunkt mit diesem Namen aus der Route entfernen (ueber die
	// bestehende Routenplaner-Logik). Danach die Tabs neu bauen (der #waypoints-Observer feuert zwar
	// meist selbst, aber beim Leeren des letzten Wegpunkts gibt es keine childList-Mutation).
	function removeWaypointByName(name) {
		if (typeof $ === "undefined" || typeof removeWaypointById !== "function") {
			return;
		}
		var waypointId = null;
		$(".waypoint-input").each(function () {
			if (waypointId) {
				return;
			}
			if (String($(this).val() || "").trim() === name) {
				waypointId = $(this).closest(".waypoint-container").attr("data-waypoint-id") || null;
			}
		});
		if (waypointId) {
			removeWaypointById(waypointId);
		}
		renderTabs();
	}

	// Tabs mitziehen, wenn sich die Wegpunkte aendern (hinzufuegen/entfernen/umsortieren -> childList;
	// Werte-Aenderung -> change). Nur neu bauen, wenn das Panel offen ist -- beim Oeffnen baut
	// avesmapsShowInfopanel die Tabs ohnehin frisch.
	var waypointsEl = document.getElementById("waypoints");
	if (waypointsEl) {
		var refreshTabsIfOpen = function () {
			if (hasContent) {
				renderTabs();
			}
		};
		if (typeof MutationObserver === "function") {
			new MutationObserver(refreshTabsIfOpen).observe(waypointsEl, { childList: true, subtree: true });
		}
		waypointsEl.addEventListener("change", refreshTabsIfOpen);
	}

	handle.addEventListener("click", function () {
		if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
			// Edit-Mode: "Info" ist ein DAUERHAFTER Tab (neben "Editor"). Ist noch kein Feature
			// angeklickt und kein Wegpunkt gelistet (kein Inhalt), darf das leere Info-Panel verborgen
			// BLEIBEN -- es wird nicht mit einem Platzhalter aufgezwungen, damit der Editor sicht- und
			// klickbar bleibt. Erst ein Feature-/Wegpunkt-Klick fuellt das Panel. Mit Inhalt: nach vorn.
			if (!hasContent) {
				sendInfopanelToBack();
				return;
			}
			collapsed = false;
			sync();
			bringInfopanelToFront();
			return;
		}
		if (!hasContent) {
			return; // Nicht-Edit: ein leeres Panel wird nie geoeffnet
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
	// Setzt den Panel-Inhalt (HTML-String eines Feature-Builders) und oeffnet auf. `activeName` = Name
	// des Features -> markiert den passenden Wegpunkt-Tab (leer/weggelassen -> kein aktiver Tab). Leerer/
	// kein Inhalt -> Panel leeren + einklappen (nie leer offen). Gibt das Body-Element zurueck, damit der
	// Aufrufer z. B. hydrateLocationReviews darauf anwenden kann.
	window.avesmapsShowInfopanel = function (html, activeName) {
		if (typeof html === "string" && html.trim() !== "") {
			body.innerHTML = html;
			body.scrollTop = 0;
			hasContent = true;
			collapsed = false;
			currentTabActive = typeof activeName === "string" ? activeName : "";
			renderTabs();
			bringInfopanelToFront();
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
	// bisherige Popup-Verhalten zurueck. Der Ortsname markiert ggf. seinen Wegpunkt-Tab.
	window.avesmapsShowLocationInInfopanel = function (markerEntry) {
		if (!markerEntry || typeof buildLocationMarkerPopupHtml !== "function") {
			return false;
		}
		var panelBody = window.avesmapsShowInfopanel(buildLocationMarkerPopupHtml(markerEntry), markerEntry.name);
		if (panelBody && typeof hydrateLocationReviews === "function") {
			hydrateLocationReviews(panelBody.querySelector(".location-reviews"));
		}
		return true;
	};

	// Feature-Glue (Phase 1b, Wege/Fluesse): zeigt das vorgefertigte Weg-Popup-Markup
	// (path._popupMarkup, sonst frisch gebaut) im Panel. Wege haben keine Bewertungen -> nur
	// anzeigen. false, wenn kein Markup da ist (dann faellt der Aufrufer auf das bisherige Popup
	// zurueck).
	window.avesmapsShowPathInInfopanel = function (path) {
		var markup = (path && path._popupMarkup)
			|| (path && typeof createPathPopupMarkup === "function" ? createPathPopupMarkup(path) : "");
		if (!markup) {
			return false;
		}
		window.avesmapsShowInfopanel(markup);
		return true;
	};

	// Feature-Glue (Phase 1c, Regionen/Territorien): zeigt die Regions-/Gebiets-Infobox
	// (createRegionCompactTooltipMarkup) im Panel und laedt -- wie enrichRegionTooltipWithWikiDetail
	// fuer den Hover-Tooltip (map-features-region-tooltip-lifecycle.js) -- die reichhaltigen
	// Wiki-Detailfelder (territory-detail.php) nach und aktualisiert das Panel. Eigener Staleness-
	// Token, damit ein spaeter geklicktes Gebiet eine noch laufende Antwort nicht ueberschreibt.
	var regionDetailToken = null;
	window.avesmapsShowRegionInInfopanel = function (regionEntry) {
		if (!regionEntry || typeof createRegionCompactTooltipMarkup !== "function") {
			return false;
		}
		window.avesmapsShowInfopanel(createRegionCompactTooltipMarkup(regionEntry));
		regionDetailToken = regionEntry;
		var needsDetail = typeof hasRegionWikiInfo === "function" && hasRegionWikiInfo(regionEntry)
			&& !regionEntry.detail && regionEntry.territoryPublicId;
		if (needsDetail) {
			var token = regionEntry;
			fetch("/api/app/territory-detail.php?territory=" + encodeURIComponent(regionEntry.territoryPublicId), { credentials: "same-origin" })
				.then(function (response) { return response.ok ? response.json() : null; })
				.then(function (data) {
					if (!data || data.ok === false || regionDetailToken !== token) {
						return; // anderes Gebiet inzwischen angezeigt -> veraltete Antwort verwerfen
					}
					regionEntry.detail = data;
					window.avesmapsShowInfopanel(createRegionCompactTooltipMarkup(regionEntry));
				})
				.catch(function () { /* noop */ });
		}
		return true;
	};
})();
