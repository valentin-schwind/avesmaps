// Kartensammlung: der "Alle anzeigen"-Dialog (Spec §3.7) + der geteilte Spoiler-Reveal.
//
// Fensterstruktur wie "Abenteuer in …": Kopf, Filterleiste, Liste, Fußzeile. Teilt sich die Dialog-Huelle
// (.avesmaps-adv-dialog) und die Filterleisten-Klassen mit den beiden Abenteuerdialogen -- beide Namen
// sind historisch, beide Schalen sind generisch, und sie tragen bereits zwei Dialoge. Ein dritter
// Konsument ist Konsistenz, kein Klon. Eigene Optik haengt an .avesmaps-citymaps-dialog.
//
// SPOILER (§3.7), eine Entscheidung die die Spec offen laesst: der DECKEL ist der Schutz, ueberall --
// im Streifen wie im Dialog liegt ueber einer Spoilerkarte ein Overlay, das Bild UND Titel verdeckt (der
// Titel "Die Krypta des Verräters" spoilert genauso wie ihr Grundriss). Nichts wird ohne Klick
// aufgedeckt. Der Filter-Chip "Spoiler zeigen" startet deshalb AKTIV und regelt nur, ob Spoilerkarten
// ueberhaupt gelistet werden: startete er inaktiv, zeigte der Streifen drei Karten und der Dialog
// daneben zwei, und der Leser suchte den Unterschied.

(function initCitymapsDialog() {
	// Node (unit tests): nothing to bind, and touching `window` here would throw before the pure markup
	// builders in place-extras.js could ever be required. Same guard as map-features-adventures-dialog.js.
	if (typeof window === "undefined" || typeof document === "undefined") {
		return;
	}
	if (typeof window.__avesmapsCitymapsDialogBound !== "undefined") {
		return;
	}
	window.__avesmapsCitymapsDialogBound = true;
	if (typeof $ === "undefined") {
		return;
	}

	function esc(value) {
		return typeof escapeHtml === "function" ? escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
	}

	function ensureDialog() {
		var overlay = document.getElementById("avesmaps-citymaps-dialog");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-citymaps-dialog";
		overlay.className = "avesmaps-adv-dialog avesmaps-citymaps-dialog";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" aria-label="' + esc(tr("cityMaps.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<div class="avesmaps-citymaps-dialog__controls"></div>'
			+ '<div class="avesmaps-citymaps-dialog__grid"></div>'
			+ '<div class="avesmaps-citymaps-dialog__foot"></div></div>';
		document.body.appendChild(overlay);
		var close = function () { overlay.classList.remove("is-open"); };
		overlay.addEventListener("click", function (e) { if (e.target === overlay) { close(); } });
		var closeBtn = overlay.querySelector(".avesmaps-adv-dialog__close");
		if (closeBtn) {
			closeBtn.addEventListener("click", close);
		}
		document.addEventListener("keydown", function (e) {
			if (e.key !== "Escape" || !overlay.classList.contains("is-open")) { return; }
			// Der Vorschlags-Dialog (§3.8) liegt UEBER diesem und hoert auf denselben document-Escape. Ohne
			// diesen Riegel schloesse EIN Tastendruck beide -- der Leser will den Vorschlag abbrechen und
			// verlaere dabei die Kartenliste, aus der er ihn geoeffnet hat.
			if (document.querySelector("#avesmaps-citymap-suggest.is-open")) { return; }
			close();
		});
		return overlay;
	}

	// Die MAGERE Shape aus den data-Attributen: nur was am Element steht -- insbesondere KEINE Links und
	// keine Quellen-Objekte. Nur der Rueckfall fuer eine Box ohne Katalog (location.cityMaps-Payload).
	// Tri-State: "" heisst UNBEKANNT und muss null bleiben, nicht false werden (§3.1).
	function triFromAttr(value) {
		return (value === "" || value == null) ? null : value === "1";
	}
	function numFromAttr(value) {
		return (value === "" || value == null) ? null : Number(value);
	}
	function cardShapeFromEl(card) {
		var types = card.getAttribute("data-types") || "";
		var sources = card.getAttribute("data-sources") || "";
		return {
			public_id: card.getAttribute("data-public-id") || "",
			title: card.getAttribute("data-title") || "",
			types: types ? types.split(",") : [],
			art: card.getAttribute("data-art") || "",
			is_color: triFromAttr(card.getAttribute("data-color")),
			is_multilevel: triFromAttr(card.getAttribute("data-multilevel")),
			is_labeled: triFromAttr(card.getAttribute("data-labeled")),
			is_official: triFromAttr(card.getAttribute("data-official")),
			is_spoiler: triFromAttr(card.getAttribute("data-spoiler")),
			is_paid: triFromAttr(card.getAttribute("data-paid")),
			valid_from_bf: numFromAttr(card.getAttribute("data-from")),
			valid_to_bf: numFromAttr(card.getAttribute("data-to")),
			sources: sources ? sources.split("|").map(function (label) { return { label: label }; }) : [],
			links: [],
		};
	}

	// EINE Karte als VOLLE Katalog-Shape: den INHALT holt sie ueber ihre public_id frisch aus dem Katalog --
	// dort haengen Links samt geprueftem Status, die in keiner Streifenkarte im DOM stehen. Kein
	// Katalog-Treffer -> die magere DOM-Shape.
	//
	// Gerendert UND gefiltert wird aus derselben Quelle, und das ist keine Kosmetik: der "nur kostenlose"-
	// Filter fragt seit den Mehrfach-Links die LINKS (§4.1), und die magere DOM-Shape traegt keine. Wer hier
	// die DOM-Shape filtert, waehrend die Zeile daneben aus dem Katalog rendert, blendet stillschweigend
	// Karten aus, deren freien Link der Leser direkt daneben stehen sieht.
	function shapeFromCard(card) {
		var fromCatalog = (typeof getCityMapShape === "function")
			? getCityMapShape(card.getAttribute("data-public-id"))
			: null;
		return fromCatalog || cardShapeFromEl(card);
	}

	// Die Karten einer Streifen-Section. Der Streifen bleibt die Quelle der WELCHE-Frage (welche Karten),
	// damit Streifen und Dialog nie verschiedene Mengen zeigen.
	function shapesFromSection(section) {
		var cards = section.querySelectorAll(".avesmaps-citymaps__scroll .avesmaps-citymaps__card");
		return Array.prototype.map.call(cards, shapeFromCard);
	}

	function cardPasses(card, filter) {
		if (typeof avesmapsCitymapMatchesFilter !== "function") {
			return true;
		}
		return avesmapsCitymapMatchesFilter(shapeFromCard(card), filter);
	}

	function buildControls(overlay, shapes) {
		var existing = overlay.querySelector(".avesmaps-citymaps-dialog__controls");
		var grid = overlay.querySelector(".avesmaps-citymaps-dialog__grid");
		var facets = (typeof avesmapsCitymapFacetOptions === "function")
			? avesmapsCitymapFacetOptions(shapes)
			: { types: [], arts: [], sources: [], yearRange: { min: 0, max: 0 } };
		existing.innerHTML = (typeof citymapFiltersMarkup === "function") ? citymapFiltersMarkup(facets) : "";

		// showSpoiler startet true (siehe Kopfkommentar) -> der Chip startet aktiv, sonst luegt die Leiste
		// ueber ihren eigenen Zustand.
		var filterState = {
			types: new Set(), art: "", source: "",
			colorOnly: false, multilevelOnly: false, labeledOnly: false, officialOnly: false,
			freeOnly: false, paidOnly: false,
			showSpoiler: true, yearFrom: 0, yearTo: 0,
		};
		var spoilerChip = existing.querySelector('[data-adv-filter="spoiler"]');
		if (spoilerChip) {
			spoilerChip.classList.add("is-active");
		}

		var cards = Array.prototype.slice.call(grid.querySelectorAll(".avesmaps-citymaps__card"));
		var countEl = overlay.querySelector(".avesmaps-adv-dialog__title");
		var baseTitle = countEl ? countEl.getAttribute("data-base-title") || "" : "";

		function applyFilters() {
			var visible = 0;
			cards.forEach(function (card) {
				var passes = cardPasses(card, filterState);
				card.classList.toggle("is-filtered-out", !passes);
				if (passes) {
					visible += 1;
				}
			});
			if (countEl && baseTitle) {
				countEl.textContent = baseTitle + " (" + visible + ")";
			}
			var empty = overlay.querySelector("[data-citymaps-empty]");
			if (empty) {
				empty.style.display = visible ? "none" : "";
			}
		}

		// Chip-Toggles: der Chip-Guard ist noetig, weil [data-adv-filter] AUCH die Selects und die
		// Jahresfelder trifft -- ohne ihn fiele ein Select-Klick in den Chip-Zweig.
		var TOGGLES = { color: "colorOnly", multilevel: "multilevelOnly", labeled: "labeledOnly", official: "officialOnly", free: "freeOnly", paid: "paidOnly" };
		existing.addEventListener("click", function (e) {
			var chip = e.target.closest("[data-adv-filter]");
			if (!chip || !chip.classList.contains("avesmaps-adv-tree__chip")) {
				return;
			}
			var kind = chip.getAttribute("data-adv-filter");
			if (kind === "type") {
				var value = chip.getAttribute("data-adv-value");
				if (filterState.types.has(value)) {
					filterState.types.delete(value);
					chip.classList.remove("is-active");
				} else {
					filterState.types.add(value);
					chip.classList.add("is-active");
				}
			} else if (kind === "spoiler") {
				filterState.showSpoiler = !filterState.showSpoiler;
				chip.classList.toggle("is-active", filterState.showSpoiler);
			} else if (TOGGLES[kind]) {
				filterState[TOGGLES[kind]] = !filterState[TOGGLES[kind]];
				chip.classList.toggle("is-active", filterState[TOGGLES[kind]]);
			} else {
				return;
			}
			applyFilters();
		});
		existing.addEventListener("change", function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "art") { filterState.art = el.value || ""; applyFilters(); }
			else if (kind === "source") { filterState.source = el.value || ""; applyFilters(); }
		});
		// Zahlenfelder feuern 'input', nicht 'change' -> live mitfiltern.
		existing.addEventListener("input", function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "yearFrom") { filterState.yearFrom = Number(el.value) || 0; applyFilters(); }
			else if (kind === "yearTo") { filterState.yearTo = Number(el.value) || 0; applyFilters(); }
		});

		applyFilters();
	}

	// $focusPublicId (optional): die Karte, um die es dem Leser geht -- er hat sie im Streifen angeklickt.
	// Sie wird aufgeklappt und in den Blick gescrollt. Ohne sie oeffnet der Dialog wie eh und je oben.
	function openDialogForSection(section, focusPublicId) {
		if (!section) {
			return;
		}
		var overlay = ensureDialog();
		var head = section.querySelector(".avesmaps-citymaps__head");
		// Der Kopf traegt schon "(n)" aus dem Streifen -- fuer den Dialog den nackten Titel behalten, der
		// Zaehler wird dort vom Filter gesetzt.
		var baseTitle = head ? head.textContent.replace(/\s*\(\d+\)\s*$/, "").trim() : tr("cityMaps.heading", "Kartensammlung");
		var titleEl = overlay.querySelector(".avesmaps-adv-dialog__title");
		titleEl.setAttribute("data-base-title", baseTitle);
		titleEl.textContent = baseTitle;

		var shapes = shapesFromSection(section);
		var grid = overlay.querySelector(".avesmaps-citymaps-dialog__grid");
		grid.innerHTML = shapes.map(function (shape) {
			return (typeof buildCityMapRowMarkup === "function") ? buildCityMapRowMarkup(shape) : "";
		}).join("")
			+ '<div class="avesmaps-citymaps-dialog__empty" data-citymaps-empty style="display:none">'
			+ esc(tr("cityMaps.noneMatch", "Keine Karte passt zu diesen Filtern.")) + '</div>';

		var foot = overlay.querySelector(".avesmaps-citymaps-dialog__foot");
		if (foot) {
			// Fusszeile (§3.7): Hinweis + "Karte vorschlagen" (§3.8).
			//
			// Die Ortsreferenz reist als data-Attribute AM BUTTON mit, nicht in einer Modulvariablen: der
			// Dialog ist EINE wiederverwendete Huelle (ensureDialog), die beim naechsten Oeffnen einen
			// anderen Ort zeigt -- eine gemerkte Referenz waere genau einmal falsch, naemlich dann, wenn
			// jemand zwei Orte nacheinander ansieht und beim zweiten vorschlaegt.
			foot.innerHTML = '<span class="avesmaps-citymaps-dialog__hint">'
				+ esc(tr("cityMaps.footHint", "Karten sind externe Verweise. Vorschau nur bei freier Lizenz."))
				+ '</span>'
				+ '<button type="button" class="avesmaps-citymaps__suggest"'
				+ ' data-citymap-place-kind="' + esc(section.getAttribute("data-citymap-place-kind") || "") + '"'
				// KEIN Rueckfall auf baseTitle: das ist "Kartensammlung von Gareth", nicht "Gareth" -- als
				// raw_name entstuende ein Ort dieses Namens. Leer ist richtig: der Server legt dann gar
				// keinen Ort an, und eine Karte ohne Ort ist ein gueltiger Zustand (§3.1).
				+ ' data-citymap-place-name="' + esc(section.getAttribute("data-citymap-place-name") || "") + '"'
				+ ' data-citymap-place-id="' + esc(section.getAttribute("data-citymap-place-id") || "") + '"'
				+ ' data-citymap-place-key="' + esc(section.getAttribute("data-citymap-place-key") || "") + '"'
				+ '>' + esc(tr("cityMaps.suggest", "Karte vorschlagen")) + '</button>';
		}

		buildControls(overlay, shapes);
		overlay.classList.add("is-open");
		// ERST NACH is-open: vorher ist der Dialog nicht gelayoutet, und scrollIntoView auf einer Zeile
		// ohne Massen scrollt nirgendwohin.
		focusRow(grid, focusPublicId);
	}

	// Die angeklickte Karte aufklappen + in den Blick holen. Die public_id wird VERGLICHEN, nicht in einen
	// Selektor eingesetzt: sie kommt zwar aus unserem eigenen Payload, aber ein Attribut-Selektor mit
	// fremdem Inhalt ist genau die Stelle, an der sowas irgendwann kippt.
	function focusRow(grid, focusPublicId) {
		if (!grid || !focusPublicId) {
			return;
		}
		var rows = grid.querySelectorAll(".avesmaps-citymap-row");
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].getAttribute("data-public-id") === focusPublicId) {
				rows[i].classList.add("is-expanded");
				// "nearest": die Zeile soll sichtbar werden, nicht die Liste an den Anfang reissen.
				rows[i].scrollIntoView({ block: "nearest" });
				return;
			}
		}
	}

	// Eine Kachel im Streifen oeffnet die KARTENSAMMLUNG bei genau dieser Karte -- nicht mehr die Karte
	// selbst (Owner 2026-07-17: "nur der klick führt zu vergrößertten kachel in der kartensammlung"). Die
	// 116px-Kachel zeigt Bild + Titel und sonst nichts; alles andere -- Art, Typen, Gueltigkeit, Urheber,
	// Quelle, die Fundstellen -- steht im Dialog. Dorthin fuehrt jetzt der Klick.
	//
	// Der Selektor MUSS auf .avesmaps-citymaps__scroll gescopet sein: die Dialog-Zeilen tragen
	// .avesmaps-citymaps__card ebenfalls (die geteilten Filter-/Spoiler-Handler zielen darauf), und ohne
	// das Scope wuerde ein Klick im Dialog denselben Dialog neu bauen.
	//
	// Die Kachel bleibt ein <a target="_blank"> auf die Karte, und das ist Absicht: features/links.css
	// faerbt a[target="_blank"] per !important gold-braun -- als <button> verloere der Titel darunter
	// genau diese Farbe, und "Aussehen unveraendert" waere gebrochen. Nebeneffekt, akzeptiert: Strg-/
	// Mittelklick oeffnen die Karte weiterhin direkt (Browser-Default, den preventDefault nicht abfaengt).
	$(document).on("click", ".avesmaps-citymaps__scroll .avesmaps-citymaps__card", function (e) {
		e.preventDefault();
		openDialogForSection($(this).closest(".avesmaps-citymaps")[0], this.getAttribute("data-public-id"));
	});

	// "Alle anzeigen" -- Streifen im Panel wie im Popup.
	$(document).on("click", ".avesmaps-citymaps__all", function () {
		openDialogForSection($(this).closest(".avesmaps-citymaps")[0]);
	});

	// Floating-Box-Kachel "Kartensammlung": public_id -> markerEntry -> Ort -> Streifen (detached, nur als
	// Kartenquelle) -> Dialog. Eigener Selektor (data-citymaps-open-place, NICHT data-popup-action) -> der
	// zentrale routing.js-Actionhandler hat keinen Fall dafuer; da er nur stopPropagation (nicht
	// stopImmediatePropagation) nutzt, feuert dieser Handler trotzdem.
	$(document).on("click", "[data-citymaps-open-place]", function () {
		if (this.getAttribute("aria-disabled") === "true") {
			return; // deaktivierte Kachel (keine Karten / Katalog nicht geladen)
		}
		var publicId = this.getAttribute("data-citymaps-open-place");
		if (!publicId || typeof findLocationMarkerByPublicId !== "function") {
			return;
		}
		var entry = findLocationMarkerByPublicId(publicId);
		if (!entry || !entry.location || typeof buildPlaceCityMapsMarkup !== "function") {
			return;
		}
		var holder = document.createElement("div");
		holder.innerHTML = buildPlaceCityMapsMarkup(entry.location);
		var section = holder.querySelector(".avesmaps-citymaps");
		if (section) {
			openDialogForSection(section);
		}
	});

	// Zeile auf-/zuklappen. Der Klick auf eine Zeile war bisher unbelegt (nur Thumb + Titel oeffneten die
	// Karte); jetzt klappt er sie auf und zeigt das Vorschaubild gross.
	//
	// Delegiert auf `document` -- nicht am Element -- aus zwei Gruenden: die Zeilen entstehen bei jedem
	// Dialog-Bau neu, und der Spoiler-Deckel unten muss seinen stopPropagation-Vorrang behalten. Ein
	// Handler direkt am Element wuerde vor ihm feuern und ein Spoiler-Bild aufdecken, waehrend derselbe
	// Klick die Zeile aufklappt.
	$(document).on("click", ".avesmaps-citymaps-dialog__grid .avesmaps-citymap-row", function (e) {
		var row = this;
		// 1. Die Fundstellen rechts sind echte Links und bleiben es -- immer, in jedem Zustand.
		if (e.target.closest(".avesmaps-adv-row__links")) {
			return;
		}
		var expanded = row.classList.contains("is-expanded");
		// 2. Aufgeklappt oeffnen das grosse Bild und "Karte oeffnen" die Karte. Das Klickziel des Bildes
		// wechselt also mit dem Zustand (zu = aufklappen, offen = oeffnen). Das ist fehlklick-sicher, weil
		// man erst aufklappen MUSS -- und ein 280px-Kartenbild, das auf Klick nichts tut, laedt sonst
		// genau zu dem Fehlklick ein, den es hier nicht gibt.
		if (expanded && e.target.closest(".avesmaps-citymap-row__thumb, .avesmaps-citymap-row__open")) {
			return;
		}
		// 3. Alles andere klappt auf/zu. preventDefault, weil Thumb und Titel Anker auf die Karte sind:
		// ohne ihn oeffnet der Klick, der aufklappen soll, zusaetzlich einen Tab.
		e.preventDefault();
		if (!expanded) {
			// Akkordeon: immer nur EINE offen. Bei 20 Karten waere die Liste sonst nicht mehr zu ueberblicken,
			// und der Zweck ist Durchklicken, nicht Stapeln.
			var open = row.parentNode.querySelectorAll(".avesmaps-citymap-row.is-expanded");
			Array.prototype.forEach.call(open, function (other) {
				other.classList.remove("is-expanded");
			});
		}
		row.classList.toggle("is-expanded");
	});

	// Spoiler aufdecken -- Streifen UND Dialog, deshalb Document-Delegation. Das Overlay liegt IM Anker:
	// preventDefault + stopPropagation, sonst oeffnet derselbe Klick, der aufdeckt, schon die Karte.
	$(document).on("click", "[data-citymap-reveal]", function (e) {
		e.preventDefault();
		e.stopPropagation();
		var card = $(this).closest(".avesmaps-citymaps__card")[0];
		if (card) {
			card.classList.remove("is-spoiler");
		}
	});
})();
