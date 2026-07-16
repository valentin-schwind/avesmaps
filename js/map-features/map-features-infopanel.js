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

	// Wegpunkt-Breadcrumbs (Reiter-Leiste): die Reiter (tabs) plus "‹ ›"-Paginierpfeile in einer Leiste.
	var tabsbar = document.createElement("div");
	tabsbar.className = "avesmaps-infopanel__tabsbar";
	tabsbar.style.display = "none";
	var tabsPrev = document.createElement("button");
	tabsPrev.type = "button";
	tabsPrev.className = "avesmaps-infopanel__tabsnav avesmaps-infopanel__tabsnav--prev";
	tabsPrev.setAttribute("aria-label", "Vorherige Wegpunkte");
	tabsPrev.textContent = "‹";
	var tabs = document.createElement("div");
	tabs.className = "avesmaps-infopanel__tabs";
	var tabsNext = document.createElement("button");
	tabsNext.type = "button";
	tabsNext.className = "avesmaps-infopanel__tabsnav avesmaps-infopanel__tabsnav--next";
	tabsNext.setAttribute("aria-label", "Weitere Wegpunkte");
	tabsNext.textContent = "›";
	tabsbar.appendChild(tabsPrev);
	tabsbar.appendChild(tabs);
	tabsbar.appendChild(tabsNext);

	var body = document.createElement("div");
	body.className = "avesmaps-infopanel__body";

	panel.appendChild(tabsbar);
	panel.appendChild(body);

	// Lightbox: eigene Header-Bilder (mehrere) per < > durchblaettern. Delegation auf dem Panel-Body, damit
	// der Handler ueber alle kuenftigen Panel-Inhalte hinweg gilt (body.innerHTML wird je Feature neu gesetzt).
	body.addEventListener("click", function (event) {
		var nav = event.target && event.target.closest ? event.target.closest("[data-lb-nav]") : null;
		if (!nav) {
			return;
		}
		var header = nav.closest(".info-header");
		if (!header) {
			return;
		}
		var imgs = String(header.getAttribute("data-lb-images") || "").split("|").filter(Boolean);
		if (imgs.length < 2) {
			return;
		}
		var idx = parseInt(header.getAttribute("data-lb-index") || "0", 10) || 0;
		idx = (idx + (nav.getAttribute("data-lb-nav") === "next" ? 1 : -1) + imgs.length) % imgs.length;
		header.setAttribute("data-lb-index", String(idx));
		var img = header.querySelector(".info-header__img");
		if (img) {
			img.setAttribute("src", imgs[idx]);
		}
		var dots = header.querySelectorAll(".info-header__dot");
		for (var i = 0; i < dots.length; i += 1) {
			dots[i].classList.toggle("is-on", i === idx);
		}
	});

	// "‹ ›" scrollen die Reiter-Leiste; .has-overflow (JS) blendet die Pfeile nur bei Ueberlauf ein.
	function updateTabsNav() {
		var overflow = tabs.scrollWidth > tabs.clientWidth + 1;
		tabsbar.classList.toggle("has-overflow", overflow);
		tabsPrev.disabled = tabs.scrollLeft <= 0;
		tabsNext.disabled = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1;
	}
	tabsPrev.addEventListener("click", function () {
		tabs.scrollBy({ left: -Math.max(80, tabs.clientWidth * 0.7), behavior: "smooth" });
	});
	tabsNext.addEventListener("click", function () {
		tabs.scrollBy({ left: Math.max(80, tabs.clientWidth * 0.7), behavior: "smooth" });
	});
	tabs.addEventListener("scroll", updateTabsNav);
	window.addEventListener("resize", updateTabsNav);

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
	// Die zuletzt im Panel gezeigte Siedlung -- Anker fuer avesmapsRefreshInfopanelLocation (siehe dort).
	// null, sobald etwas anderes (Region/Weg/Route) im Panel steht.
	var lastLocationEntry = null;
	var locationRefreshQueued = false;
	// ResizeObserver, der den gemessenen Reise-Linien-SVG-Pfad bei Breitenaenderung des Panels neu zeichnet
	// (einmalig in renderTabs angehaengt).
	var routeLineObserver = null;
	// Zaehler, der bei JEDEM Feature-Anzeigen (avesmapsShowInfopanel mit Inhalt) steigt. Der Leerklick-
	// Detektor (unten) vergleicht ihn vor/nach einem Karten-Klick: bleibt er gleich, wurde nichts
	// getroffen -> Leerklick.
	var openSeq = 0;

	function sync() {
		var open = hasContent && !collapsed;
		panel.classList.toggle("is-hidden", !open);
		// Info-Tab NUR sichtbar, wenn tatsaechlich ein Element angeklickt wurde (Owner-Regel, dieselbe
		// wie im Nicht-Edit-Frontend) -- keine Ausnahme mehr fuer den Edit-Mode.
		handle.style.display = hasContent ? "" : "none";
		handle.classList.toggle("is-hidden", collapsed);
		handle.setAttribute("aria-expanded", open ? "true" : "false");
		// Zoom + "Hinweise" fahren mit der Panel-Kante mit (CSS an dieser Klasse): offen -> ans
		// Panel-Eck, zu -> unten rechts am Bildschirmrand. Im Edit-Mode belegt der Editor die rechte
		// Kante dauerhaft -> dann immer ans Panel-Eck, auch wenn das Info-Panel leer/verborgen ist.
		var editActive = (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE);
		document.documentElement.classList.toggle("avesmaps-infopanel-open", open || editActive);
		updateEdgeTabDock();
	}

	// Rand-Tabs (Info/Editor) docken an die rechte BILDSCHIRMkante, wenn KEIN Panel offen ist. Sonst
	// klebten sie an der linken Panel-Kante (right:var(--ip-w)) -- die in schmalen Fenstern weit links
	// liegt -> die Tabs wirkten dann losgeloest von den (verborgenen) Panels. Ist ein Panel offen, sitzen
	// sie an dessen linker Kante. Klasse `avesmaps-any-panel-open` auf <html>, CSS positioniert danach.
	function updateEdgeTabDock() {
		var infoOpen = hasContent && !collapsed;
		var editorActive = (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)
			&& !!(window.avesmapsEdgePanels && window.avesmapsEdgePanels.isActive("editor"));
		document.documentElement.classList.toggle("avesmaps-any-panel-open", infoOpen || editorActive);
	}
	sync();

	// Edit-Mode-Koexistenz: Info und Editor sind ECHTE, sich gegenseitig ausschliessende Tabs DESSELBEN
	// rechten Rand-Slots (avesmapsEdgePanels-Koordinator, js/config.js) statt zweier unabhaengig auf-
	// und zuklappender Panels. `hasContent`/der Panel-Inhalt bleiben dabei erhalten -- ein spaeterer
	// Klick auf "Info" zeigt wieder denselben Inhalt, ohne neu laden zu muessen.
	if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && window.avesmapsEdgePanels) {
		window.avesmapsEdgePanels.registerElement("info", panel);
		window.avesmapsEdgePanels.onChange(function (active) {
			collapsed = (active !== "info");
			sync();
		});
	}

	// Baut die Tab-Leiste aus den AKTUELLEN Wegpunkten (getWaypointInputValues, visuelle Reihenfolge).
	// Doppelte Namen (z. B. Rundreise A->B->A) werden zusammengefasst. Der Tab, dessen Name dem gerade
	// angezeigten Feature entspricht, ist aktiv.
	// Zeichnet den durchgehenden gepunkteten Reise-Pfad als SVG HINTER die Stationen: verbindet die
	// Perlen-Mitten in Reihenfolge -- waagerecht innerhalb einer Zeile, beim Zeilenwechsel ueber 2
	// rechtwinklige Ecken durch die Luecke (runter, quer, runter). Die opaken Perlen maskieren die Linie an
	// ihrer Stelle. Gemessen (statt CSS), weil der 2-Ecken-Umweg von den echten Perlen-Positionen abhaengt.
	function drawRouteLinePath() {
		var old = tabs.querySelector(".avesmaps-infopanel__routeline-svg");
		if (old && old.parentNode) {
			old.parentNode.removeChild(old);
		}
		var dots = tabs.querySelectorAll(".avesmaps-infopanel__station-dot");
		var width = tabs.clientWidth;
		var height = tabs.clientHeight;
		if (dots.length < 2 || width < 10) {
			return;
		}
		var base = tabs.getBoundingClientRect();
		var pts = [];
		for (var i = 0; i < dots.length; i += 1) {
			var r = dots[i].getBoundingClientRect();
			pts.push({ x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 });
		}
		var d = "M " + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
		for (var j = 1; j < pts.length; j += 1) {
			var a = pts[j - 1];
			var b = pts[j];
			if (Math.abs(a.y - b.y) < 4) {
				d += " H " + b.x.toFixed(1); // gleiche Zeile -> waagerecht
			} else {
				// Zeilenwechsel: Umweg ueber 2 Ecken -- die Querlinie auf die PERLEN-MITTE zwischen den beiden
				// Zeilen legen, damit Abstieg (von der oberen Perle) und Aufstieg (zur unteren Perle) GLEICH
				// LANG sind (Owner: "die vertikalen Verbindungen muessen gleich lang sein"). Genuegend
				// Zeilenabstand (CSS gap) haelt die Querlinie unter den Namen.
				var turnY = ((a.y + b.y) / 2).toFixed(1);
				d += " V " + turnY + " H " + b.x.toFixed(1) + " V " + b.y.toFixed(1);
			}
		}
		var NS = "http://www.w3.org/2000/svg";
		var svg = document.createElementNS(NS, "svg");
		svg.setAttribute("class", "avesmaps-infopanel__routeline-svg");
		svg.setAttribute("width", width);
		svg.setAttribute("height", height);
		svg.setAttribute("viewBox", "0 0 " + width + " " + height);
		svg.setAttribute("aria-hidden", "true");
		var path = document.createElementNS(NS, "path");
		path.setAttribute("d", d);
		svg.appendChild(path);
		tabs.insertBefore(svg, tabs.firstChild);
	}

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
		// Ausfaden (A, Owner): zeigt das Panel ein Feature, das KEIN Wegpunkt ist (keine aktive Station),
		// tritt die Reise-Linie zurueck (.is-dimmed) -> klar, dass das Angeschaute nicht zur Route gehoert.
		// Maus drueber holt sie voll zurueck (CSS); mit aktivem Wegpunkt ist sie ohnehin voll.
		tabs.classList.toggle("is-dimmed", unique.length > 0 && unique.indexOf(currentTabActive) < 0);
		tabs.innerHTML = "";
		// Reise-Linie: Stationen (hohle Perle + Name) auf einem DURCHGEHENDEN gepunkteten Pfad -- dieselbe
		// Symbolik wie die Wegpunkte im Routenplaner (#waypoints): gepunktete Linie, hohle Kreise, letzter
		// Wegpunkt = roter Ziel-Pin. Feste 3 pro Zeile (Owner "Umbruch bei 3", Grid mit gleich breiten
		// Spalten -> Perlen mittig + gleichmaessig verbunden); jede zweite Zeile laeuft per CSS umgekehrt
		// (direction:rtl), damit der Pfad ums Eck zur naechsten Zeile schlaengelt. Die GANZE Station ist
		// klickbar (oeffnet ihre Info) -- fruehere Version: nur der schmale Name war klickbar.
		var PER_ROW = 3;
		var destinationName = unique[unique.length - 1];
		function buildStation(name) {
			var station = document.createElement("div");
			station.className = "avesmaps-infopanel__station";
			if (name === currentTabActive) {
				station.classList.add("is-active");
			}
			if (name === destinationName) {
				station.classList.add("is-destination");
			}
			station.setAttribute("role", "button");
			station.setAttribute("tabindex", "0");
			station.title = name;
			station.addEventListener("click", function () {
				openWaypointInPanel(name);
			});
			station.addEventListener("keydown", function (event) {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openWaypointInPanel(name);
				}
			});
			var dot = document.createElement("span");
			dot.className = "avesmaps-infopanel__station-dot";
			dot.setAttribute("aria-hidden", "true");
			var labelrow = document.createElement("span");
			labelrow.className = "avesmaps-infopanel__station-labelrow";
			var label = document.createElement("span");
			label.className = "avesmaps-infopanel__station-label";
			label.textContent = name;
			// Kleines "x": entfernt diesen Wegpunkt (stopPropagation, sonst oeffnet der Stations-Klick).
			var remove = document.createElement("button");
			remove.type = "button";
			remove.className = "avesmaps-infopanel__station-remove";
			remove.setAttribute("aria-label", "Wegpunkt entfernen: " + name);
			remove.title = "Wegpunkt entfernen";
			remove.textContent = "✕";
			remove.addEventListener("click", function (event) {
				event.stopPropagation();
				removeWaypointByName(name);
			});
			labelrow.appendChild(label);
			labelrow.appendChild(remove);
			station.appendChild(dot);
			station.appendChild(labelrow);
			return station;
		}
		for (var rowStart = 0; rowStart < unique.length; rowStart += PER_ROW) {
			var rowNames = unique.slice(rowStart, rowStart + PER_ROW);
			var rowEl = document.createElement("div");
			rowEl.className = "avesmaps-infopanel__routeline-row";
			rowEl.style.setProperty("--cols", String(rowNames.length));
			rowNames.forEach(function (name) {
				rowEl.appendChild(buildStation(name));
			});
			tabs.appendChild(rowEl);
		}
		// Den durchgehenden gepunkteten Pfad NACH dem Layout zeichnen (Perlen-Mitten messen): in jeder Zeile
		// waagerecht, beim Zeilenwechsel ueber 2 rechtwinklige Ecken durch die Luecke (runter -> quer ->
		// runter). Jede Zeile laeuft L->R (Owner-Wahl gegen den Schlaengel). Neu bei Breitenaenderung.
		drawRouteLinePath();
		// Das Panel kann beim Oeffnen kurz 0 breit sein -> der synchrone Aufruf skippt dann (width<10);
		// nach dem naechsten Layout-Frame nochmal zeichnen. Der ResizeObserver faengt spaetere Aenderungen.
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(drawRouteLinePath);
		}
		if (!routeLineObserver && typeof ResizeObserver !== "undefined") {
			routeLineObserver = new ResizeObserver(function () { drawRouteLinePath(); });
			routeLineObserver.observe(tabs);
		}
		// Leiste nur zeigen, wenn es Wegpunkte gibt; ERST die Ueberlauf-Pfeile ein-/ausblenden (das aendert
		// die Breite der Reiter-Leiste), DANN den aktiven Reiter in den nun finalen Bereich scrollen.
		tabsbar.style.display = unique.length ? "" : "none";
		updateTabsNav();
		scrollActiveTabIntoView();
	}

	// Den aktiven Reiter in den sichtbaren Bereich der Leiste scrollen (Owner: beim "Reiseziel hinzufügen"
	// soll der neue, auto-gewaehlte Reiter sichtbar sein, auch wenn er weit rechts liegt).
	function scrollActiveTabIntoView() {
		var activeTab = tabs.querySelector(".avesmaps-infopanel__tab.is-active");
		if (!activeTab) {
			return;
		}
		var tabRect = activeTab.getBoundingClientRect();
		var barRect = tabs.getBoundingClientRect();
		if (tabRect.right > barRect.right) {
			tabs.scrollLeft += (tabRect.right - barRect.right) + 6;
		} else if (tabRect.left < barRect.left) {
			tabs.scrollLeft -= (barRect.left - tabRect.left) + 6;
		}
	}

	// Tab-Klick: den Wegpunkt (Name) als Ort aufloesen und seine Info ins Panel holen. Ist er kein
	// geladener Ort (z. B. ein reiner Kartenpunkt), passiert nichts (kein Inhalt zum Anzeigen).
	function openWaypointInPanel(name) {
		var entry = (typeof findLocationMarkerByName === "function") ? findLocationMarkerByName(name) : null;
		if (entry && typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
			focusWaypointOnMap(entry);
		}
	}

	// Tab-Klick zentriert die Karte auf die Stadt (hartes setView statt flyTo, Owner-Regel). Zoom-Regel:
	// gibt es bereits eine Route (>= 2 Wegpunkte), bleibt die aktuelle Zoomstufe erhalten (die
	// Route-Ansicht nicht stoeren); sonst immer Zoomstufe 5.
	function focusWaypointOnMap(entry) {
		if (typeof map === "undefined" || !map || typeof map.setView !== "function" || !entry || !entry.marker) {
			return;
		}
		var latlng = (typeof entry.marker.getLatLng === "function") ? entry.marker.getLatLng() : null;
		// Guard NON-FINITE coords too: a NaN latlng passes the truthy check, but setView(NaN) leaves the
		// map centre undefined so the NEXT moveend crashes in Leaflet's _panInsideMaxBounds (owner's bug).
		if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
			return;
		}
		var waypointCount = (typeof getWaypointInputValues === "function") ? getWaypointInputValues().length : 0;
		if (waypointCount >= 2) {
			map.setView(latlng, map.getZoom());
		} else {
			map.setView(latlng, 5);
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
			// Ohne Inhalt gibt es nichts zu zeigen -- dank der hasContent-Sichtbarkeitsregel (sync())
			// ist der Tab dann ohnehin ausgeblendet; dieser Zweig ist nur ein Sicherheitsnetz.
			if (!hasContent) {
				return;
			}
			if (window.avesmapsEdgePanels && window.avesmapsEdgePanels.isActive("info")) {
				window.avesmapsEdgePanels.deactivate("info");
			} else if (window.avesmapsEdgePanels) {
				window.avesmapsEdgePanels.activate("info");
			}
			return;
		}
		if (!hasContent) {
			return; // Nicht-Edit: ein leeres Panel wird nie geoeffnet
		}
		collapsed = !collapsed;
		sync();
	});

	// Leerklick auf die Karte (nichts getroffen) -> Infopanel einklappen. Im Edit-Mode stattdessen den
	// Editor wieder aktivieren (dort ist der Editor die Standardansicht). Erkennung ueber openSeq:
	// ein Feature-Klick ruft avesmapsShowInfopanel (openSeq steigt). Der Snapshot wird in der CAPTURE-
	// Phase genommen (vor Leaflets Klick-Handlern) und im setTimeout mit dem Endstand verglichen -> robust
	// gegen die Reihenfolge der Klick-Handler (Canvas-Arbiter registriert vor uns).
	var emptyClickBound = false;
	function bindEmptyMapClick() {
		if (emptyClickBound || typeof map === "undefined" || !map || typeof map.on !== "function") {
			return;
		}
		emptyClickBound = true;
		var seqBeforeClick = 0;
		var container = typeof map.getContainer === "function" ? map.getContainer() : null;
		if (container) {
			container.addEventListener("click", function () {
				seqBeforeClick = openSeq; // vor Leaflets Klick-Handlern (Capture-Phase)
			}, true);
		}
		map.on("click", function () {
			var snapshot = seqBeforeClick;
			window.setTimeout(function () {
				if (openSeq !== snapshot) {
					return; // ein Feature wurde durch diesen Klick geoeffnet -> kein Leerklick
				}
				// Empty click confirmed -> also drop the gold active-marker highlight (belt-and-braces for
				// non-canvas modes where the canvas _onClick deselect does not run).
				if (typeof window.avesmapsClearActiveLocation === "function") {
					window.avesmapsClearActiveLocation();
				}
				if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
					if (window.avesmapsEdgePanels) {
						window.avesmapsEdgePanels.activate("editor"); // Editor ist die Ruheansicht im Edit-Mode
					}
					return;
				}
				collapsed = true;
				sync();
			}, 0);
		});
	}
	// `map` entsteht erst spaet in bootstrap.js. Ueblicher Weg: avesmaps:map-ready. ABER dieses Event kann
	// bereits gefeuert haben, bevor dieses Script parst (z. B. sehr schneller/fehlgeschlagener Datenload
	// -> map-ready per Microtask vor dem Script) -> zusaetzlich pollen, bis `map` existiert, dann einmalig
	// binden (der emptyClickBound-Guard verhindert Doppelbindung).
	document.addEventListener("avesmaps:map-ready", bindEmptyMapClick);
	(function pollForMap(tries) {
		if (emptyClickBound) {
			return;
		}
		bindEmptyMapClick();
		if (!emptyClickBound && tries < 100) {
			window.setTimeout(function () { pollForMap(tries + 1); }, 120);
		}
	})(0);

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
		// Jeder Inhaltswechsel entwertet den Siedlungs-Anker; avesmapsShowLocationInInfopanel setzt ihn
		// direkt danach wieder. Hier zentral statt in jedem Aufrufer, damit Region/Weg/Route -- und alles,
		// was spaeter dazukommt -- nicht von einem verspaeteten Katalog-Refresh ueberschrieben werden.
		lastLocationEntry = null;
		if (typeof html === "string" && html.trim() !== "") {
			body.innerHTML = html;
			body.scrollTop = 0;
			hasContent = true;
			collapsed = false;
			openSeq += 1;
			currentTabActive = typeof activeName === "string" ? activeName : "";
			renderTabs();
			if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && window.avesmapsEdgePanels) {
				window.avesmapsEdgePanels.activate("info");
			}
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

	// Hebt die Wegpunkt-Markierung in der Reise-Linie auf. Gegenstueck zu clearActiveLocationMarker: die
	// Karte fuehrt ihre Auswahl ueber activeLocationPublicId, das Panel ueber den NAMEN -- ohne diesen
	// Aufruf blieb die goldene Perle stehen, nachdem ein Leerklick auf die Karte die Auswahl geloescht hat.
	window.avesmapsClearInfopanelActiveWaypoint = function () {
		if (!currentTabActive) {
			return;
		}
		currentTabActive = "";
		renderTabs();
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
		// The shown location is the active one -> gold marker fill (covers search / deeplink / breadcrumb
		// paths that don't go through the canvas click-arbiter). Idempotent if it's already active.
		if (typeof window.avesmapsSetActiveLocation === "function") {
			window.avesmapsSetActiveLocation(markerEntry);
		}
		var panelBody = window.avesmapsShowInfopanel(buildLocationMarkerPopupHtml(markerEntry), markerEntry.name);
		lastLocationEntry = markerEntry;
		if (panelBody && typeof hydrateLocationReviews === "function") {
			hydrateLocationReviews(panelBody.querySelector(".location-reviews"));
		}
		return true;
	};

	// Auto-Open bei geladener/geteilter Route: den ersten auf einen geladenen Ort aufloesbaren Wegpunkt
	// im Panel zeigen -> die Breadcrumb-Leiste (alle Wegpunkte) erscheint oben, dieser Wegpunkt aktiv.
	// Wird nach dem Routen-Laden aufgerufen (routing.js, hasSharedRoute), damit das Infopanel mit den
	// Wegpunkt-Breadcrumbs automatisch erscheint. Loest kein Wegpunkt auf, passiert nichts (Panel bleibt).
	// Baut das Siedlungs-Panel neu, wenn ein Katalog NACH dem Oeffnen fertig geworden ist.
	//
	// Warum das noetig ist: das Panel wird EINMAL gebaut, die Kataloge (Abenteuer, Kartensammlung) kommen
	// per fetch. Bei einem Deeplink/Sofort-Oeffnen ist das ein echtes Rennen -- die kleinen Katalog-Requests
	// haengen hinter der ~14 MB grossen map-features-Nutzlast in der Verbindungs-Queue. Wer verliert, sieht
	// das Ergebnis dauerhaft: die Kartensammlung fehlt komplett (kein Katalog -> kein Abschnitt) und der
	// Abenteuer-Kopf friert auf dem Platzhalterwert "(57)" ein. Beobachtet auf avesmaps.de mit
	// ?siedlung=Gareth, 2026-07-16.
	//
	// Einmal pro Tick zusammengefasst, damit zwei Kataloge nicht zweimal neu rendern; die Scrollposition
	// bleibt, weil showInfopanel sonst nach oben springt. Kein Loop-Risiko: ein Katalog laedt genau einmal.
	window.avesmapsRefreshInfopanelLocation = function () {
		if (!lastLocationEntry || !hasContent || locationRefreshQueued) {
			return;
		}
		locationRefreshQueued = true;
		setTimeout(function () {
			locationRefreshQueued = false;
			if (!lastLocationEntry || !hasContent) {
				return;
			}
			var scrollTop = body.scrollTop;
			window.avesmapsShowLocationInInfopanel(lastLocationEntry);
			body.scrollTop = scrollTop;
		}, 0);
	};

	window.avesmapsAutoOpenRouteInInfopanel = function () {
		var names = (typeof getWaypointInputValues === "function") ? getWaypointInputValues() : [];
		for (var i = 0; i < names.length; i += 1) {
			var entry = (typeof findLocationMarkerByName === "function") ? findLocationMarkerByName(names[i]) : null;
			if (entry) {
				return window.avesmapsShowLocationInInfopanel(entry);
			}
		}
		return false;
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
		// Phase 2 (Wege): the adventures assigned to this path, appended below the path infobox. Renders only
		// in infopanel mode (the catalog loads only there); "" until the catalog is ready or if none match.
		if (typeof buildPathCityMapsMarkup === "function") {
			markup += buildPathCityMapsMarkup(path);
		}
		if (typeof buildPathAdventuresMarkup === "function") {
			markup += buildPathAdventuresMarkup(path);
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
	// Regions-/Gebiets-Infobox + (Phase 2.2) angehaengter "Abenteuer in <Gebiet>"-Block. Der Block braucht den
	// SERVER-wiki_key, der erst mit regionEntry.detail (territory-detail.php) ankommt -> in der ersten (sync)
	// Runde liefert buildTerritoryAdventuresMarkup "" (kein detail), in der zweiten (nach dem Fetch) die ueber
	// den politischen Subtree aggregierten Abenteuer. buildTerritoryAdventuresMarkup lebt in place-extras.js
	// (nur im Infopanel-Modus relevant) -> per typeof-Guard optional.
	function regionMarkupWithAdventures(regionEntry) {
		var markup = createRegionCompactTooltipMarkup(regionEntry);
		if (typeof buildTerritoryCityMapsMarkup === "function") {
			markup += buildTerritoryCityMapsMarkup(regionEntry);
		}
		if (typeof buildTerritoryAdventuresMarkup === "function") {
			markup += buildTerritoryAdventuresMarkup(regionEntry);
		}
		// Wiki-Regionen/Territorien tragen den Button jetzt im Kopf-Band (region-info-markup.js). Nur die
		// kompakte Mini-Box (ohne Wiki, ohne Aktionsband) bekommt ihn hier unten angehaengt.
		if (typeof hasRegionWikiInfo === "function" && !hasRegionWikiInfo(regionEntry)) { markup += regionSuggestChangeBandMarkup(regionEntry); }
		return markup;
	}

	// Community "Änderung vorschlagen" for the region/territory shown in the infopanel. Political
	// territories (regionEntry.source === "political_territory") map to entity_type "territory" /
	// report_type "territorium"; geographic regions to "region" / "region". Infopanel-only -- NOT added to
	// the shared region markup, so the transient hover tooltip stays button-free.
	function regionSuggestChangeBandMarkup(regionEntry) {
		if (!regionEntry || typeof buildSuggestChangeButtonSpec !== "function"
			|| typeof popupActionButtonMarkup !== "function" || typeof locationPopupActionsMarkup !== "function") {
			return "";
		}
		var isTerritory = regionEntry.source === "political_territory";
		var rawName = regionEntry.displayName || regionEntry.name || "";
		var name = typeof normalizeRegionParentheticalSpacing === "function"
			? normalizeRegionParentheticalSpacing(rawName)
			: rawName;
		var spec = buildSuggestChangeButtonSpec({
			entityType: isTerritory ? "territory" : "region",
			entityId: regionEntry.territoryPublicId || regionEntry.publicId || "",
			name: name,
			reportType: isTerritory ? "territorium" : "region",
			label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderungen vorschlagen") : "Änderungen vorschlagen"),
		});
		return spec ? locationPopupActionsMarkup([popupActionButtonMarkup(spec)]) : "";
	}

	window.avesmapsShowRegionInInfopanel = function (regionEntry) {
		if (!regionEntry || typeof createRegionCompactTooltipMarkup !== "function") {
			return false;
		}
		window.avesmapsShowInfopanel(regionMarkupWithAdventures(regionEntry));
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
					window.avesmapsShowInfopanel(regionMarkupWithAdventures(regionEntry));
				})
				.catch(function () { /* noop */ });
		}
		return true;
	};

	// Deep-link/spotlight glue: open a territory in the panel BY public_id when no rendered polygon (and
	// thus no client regionEntry) exists -- e.g. a territory outside the current zoom band, or a claim-only
	// "Anspruchsgebiet" that never renders as its own polygon (its poll would never find one). Loads
	// territory-detail.php and feeds detail.fields into the FULL region infobox (hasRegionWikiInfo honours
	// .detail). Used by focusSpotlightRegion for backend/synthetic hits (js/ui/spotlight-search-focus.js).
	window.avesmapsShowRegionInfopanelById = function (territoryPublicId, name) {
		var id = String(territoryPublicId || "");
		if (!id || typeof createRegionCompactTooltipMarkup !== "function") {
			return false;
		}
		fetch("/api/app/territory-detail.php?territory=" + encodeURIComponent(id), { credentials: "same-origin" })
			.then(function (response) { return response.ok ? response.json() : null; })
			.then(function (data) {
				if (!data || data.ok === false) {
					return;
				}
				var resolvedName = name || (data.fields && data.fields.name) || "";
				var regionEntry = {
					territoryPublicId: id,
					publicId: id,
					name: resolvedName,
					displayName: resolvedName,
					source: "political_territory",
					detail: data,
				};
				window.avesmapsShowRegionInInfopanel(regionEntry);
			})
			.catch(function () { /* noop */ });
		return true;
	};
})();
