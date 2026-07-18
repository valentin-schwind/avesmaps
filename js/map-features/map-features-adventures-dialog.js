// Abenteuer-Feature (Phase 2.3) -- der verschachtelte "Alle anzeigen"-Dialog fuer Territorien/Regionen.
//
// Umsetzung des vom Owner freigegebenen Entwurfs: echt VERSCHACHTELTE Rahmen (Box-in-Box, jede Ebene inkl.
// oberstem Reich gerahmt, Kind warm getoent + eingerueckt), Rang-Pill + "N direkt" je Knoten, Sortierzeile,
// beginnt/spielt-Umschalter (Fade wie im Streifen) und eine Filterleiste (Art als Chips [multi], Schwierigkeit
// + Genre als Selects, "nur offiziell" als Chip). Deepest-wins + Baum + Facetten kommen fertig aus dem
// Datenlayer (map-features-adventures.js): getAdventureTerritoryTree / avesmapsAdventureFacetOptions /
// avesmapsAdventureMatchesFilter. Die Karten-Optik teilt sich buildAdventureCardMarkup (place-extras.js) --
// im Nested-Dialog; Sichtbarkeit steuern die geteilten Klassen (.is-spoiler/.show-spoilers/
// .is-filtered-out) Sichtbarkeit + Fade + Filter steuern.
//
// Eigener Overlay (#avesmaps-adv-tree-dialog), damit der flache Siedlungs-Dialog (#avesmaps-adv-dialog)
// unberuehrt bleibt; eigene data-Attribute (data-adv-tree-*), damit dessen Document-Delegation nicht
// hineinfeuert. Aufgerufen aus dem "Alle anzeigen"-Handler in place-extras.js (Weiche auf data-adv-territory-key).
//
// Load order: nach map-features-adventures.js (Datenlayer) UND map-features-place-extras.js
// (buildAdventureCardMarkup). Alle Abhaengigkeiten werden beim Oeffnen aufgeloest + typeof-gegated.

(function initAdventuresNestedDialog() {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return;
	}
	if (window.__avesmapsAdvNestedDialogBound) {
		return;
	}
	window.__avesmapsAdvNestedDialogBound = true;

	function esc(value) {
		return typeof escapeHtml === "function"
			? escapeHtml(String(value == null ? "" : value))
			: String(value == null ? "" : value);
	}

	// Overlay lazy bauen + wiederverwenden (Scrim/Box/Head/Close-Optik aus place-extras.css geteilt).
	function ensureTreeDialog() {
		var overlay = document.getElementById("avesmaps-adv-tree-dialog");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-adv-tree-dialog";
		overlay.className = "avesmaps-adv-dialog avesmaps-adv-tree-dialog";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" aria-label="' + esc(tr("adventures.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<div class="avesmaps-adv-tree-dialog__controls"></div>'
			+ '<div class="avesmaps-adv-tree-dialog__body avesmaps-adv-tree-dialog__tree"></div>'
			+ '<div class="avesmaps-adv-dialog__credit"></div></div>';
		document.body.appendChild(overlay);
		var close = function () { overlay.classList.remove("is-open"); };
		overlay.addEventListener("click", function (e) { if (e.target === overlay) { close(); } });
		var closeBtn = overlay.querySelector(".avesmaps-adv-dialog__close");
		if (closeBtn) {
			closeBtn.addEventListener("click", close);
		}
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && overlay.classList.contains("is-open")) { close(); }
		});
		return overlay;
	}

	// Alle render-shapes des Baums (fuer die Facetten der Filterleiste).
	function collectShapes(node, out) {
		if (!node) {
			return;
		}
		(node.start || []).forEach(function (s) { out.push(s); });
		(node.play || []).forEach(function (s) { out.push(s); });
		(node.children || []).forEach(function (c) { collectShapes(c, out); });
	}

	// Eine Karte in Nested-Optik: buildAdventureCardMarkup (geteilte Optik) OHNE inline display:none, damit
	// Spoiler stehen da wie alle anderen, nur verschleiert; .is-filtered-out blendet aus.
	function cardMarkup(shape, isPlay) {
		return typeof buildAdventureCardMarkup === "function" ? buildAdventureCardMarkup(shape, isPlay) : "";
	}

	// Ein Territoriums-Rahmen, ECHT verschachtelt: Kopf (Rang-Pill + Name + "N direkt"), eigene Karten
	// (start + play), dann die Kind-Rahmen INNERHALB (Box-in-Box). deepest-wins ist bereits im Baum kodiert.
	function renderFrame(node) {
		if (!node) {
			return "";
		}
		var pill = node.rank ? '<span class="avesmaps-adv-tree__pill">' + esc(node.rank) + '</span>' : "";
		// Durchgehend sortiert wie Streifen und flacher Dialog (Owner 2026-07-18): ein Spoiler steht an
		// seinem Sortierplatz, nicht als Block hinter den spoilerfreien. Geteilte Hilfsfunktion aus
		// place-extras.js -- drei Listen, EINE Reihenfolge-Regel.
		var frameEntries = (node.start || []).map(function (s) { return { a: s, isPlay: false }; })
			.concat((node.play || []).map(function (s) { return { a: s, isPlay: true }; }));
		// Fehlt die geteilte Sortierung wider Erwarten, wird UNSORTIERT gerendert -- nie gar nicht. Eine
		// falsche Reihenfolge ist ein Schoenheitsfehler, ein leerer Rahmen waere Datenverlust vor dem Leser.
		if (typeof avesmapsSortAdventureEntries === "function") {
			frameEntries = avesmapsSortAdventureEntries(frameEntries);
		}
		var frameCards = frameEntries.map(function (e) { return cardMarkup(e.a, e.isPlay); }).join("");
		var kids = (node.children || []).map(renderFrame).join("");
		return '<div class="avesmaps-adv-tree__frame">'
			+ '<div class="avesmaps-adv-tree__fhead">' + pill
			+ '<span class="avesmaps-adv-tree__fname">' + esc(node.name) + '</span>'
			+ '<span class="avesmaps-adv-tree__direct" data-adv-direct>' + esc(tr("adventures.directCount", "{n} direkt", { n: 0 })) + '</span></div>'
			+ '<div class="avesmaps-adv-tree__cards">' + frameCards + '</div>'
			+ kids
			+ '</div>';
	}

	function sortsMarkup() {
		return '<div class="avesmaps-adv-tree__sorts">'
			+ '<span class="avesmaps-adv-tree__slabel">' + esc(tr("adventures.sortLabel", "Sortierung:")) + '</span> '
			+ '<span class="avesmaps-adv-tree__sort is-active" data-adv-tree-sort="year">' + esc(tr("adventures.sort.newest", "neueste zuerst")) + '</span>'
			+ '<span class="avesmaps-adv-tree__sortsep"> · </span>'
			+ '<span class="avesmaps-adv-tree__sort" data-adv-tree-sort="type">' + esc(tr("adventures.sort.byType", "nach Art")) + '</span>'
			+ '<span class="avesmaps-adv-tree__sortsep"> · </span>'
			+ '<span class="avesmaps-adv-tree__sort" data-adv-tree-sort="edition">' + esc(tr("adventures.sort.byEdition", "nach Edition")) + '</span>'
			+ '<span class="avesmaps-adv-tree__sortsep"> · </span>'
			+ '<span class="avesmaps-adv-tree__sort" data-adv-tree-sort="alpha">' + esc(tr("adventures.sort.alpha", "alphabetisch")) + '</span>'
			+ '</div>';
	}
	function modesMarkup() {
		return '<div class="avesmaps-adv-tree__modes" role="tablist" aria-label="' + esc(tr("adventures.modesAriaLabel", "Beginnt hier oder Spielt hier")) + '">'
			+ '<button type="button" class="avesmaps-adv__mode" data-adv-tree-mode="spoiler" aria-pressed="false">' + esc(tr("adventures.mode.play", "Spoiler")) + ' <span class="avesmaps-adv__mode-note">' + esc(tr("adventures.mode.playNote", "(spielt hier)")) + '</span> <span class="avesmaps-adv__mode-count" data-adv-count="play"></span></button>'
			+ '</div>';
	}
	// Filterleiste: geteilt mit dem flachen Dialog (advFiltersMarkup, place-extras.js -- laedt frueher in
	// index.html). Lag bis Aufgabe B hier als ~40 fast identische Zeilen neben dialogFiltersMarkup; die
	// Verdrahtung bleibt hier (box-lokal), nur das Markup ist gemeinsam (Spec §2.2).
	function filtersMarkup(facets) {
		return typeof advFiltersMarkup === "function" ? advFiltersMarkup(facets) : "";
	}

	// Pseudo-shape aus den Karten-data-Attributen -> avesmapsAdventureMatchesFilter (geteiltes Praedikat).
	function cardPasses(card, filter) {
		if (typeof avesmapsAdventureMatchesFilter !== "function") {
			return true;
		}
		return avesmapsAdventureMatchesFilter({
			type: card.getAttribute("data-type") || "",
			edition: card.getAttribute("data-edition") || "",
			year: Number(card.getAttribute("data-year")) || 0,
			complexity: card.getAttribute("data-complexity") || "",
			genre: card.getAttribute("data-genre") || "",
			official: card.getAttribute("data-official") === "1",
		}, filter);
	}

	window.openNestedAdventuresDialog = function (territoryKey, section) {
		if (typeof getAdventureTerritoryTree !== "function") {
			return;
		}
		var tree = getAdventureTerritoryTree(territoryKey);
		if (!tree) {
			return;
		}
		var overlay = ensureTreeDialog();
		var box = overlay.querySelector(".avesmaps-adv-dialog__box");
		var head = section ? section.querySelector(".avesmaps-adv__head") : null;
		var titleEl = overlay.querySelector(".avesmaps-adv-dialog__title");
		if (titleEl) {
			titleEl.textContent = head ? head.textContent.trim() : tr("adventures.heading", "Abenteuer in {place}", { place: tree.name || "" });
		}

		var allShapes = [];
		collectShapes(tree, allShapes);
		var facets = (typeof avesmapsAdventureFacetOptions === "function")
			? avesmapsAdventureFacetOptions(allShapes)
			: { types: [], complexities: [], genres: [] };

		var state = { revealSpoilers: false, sort: "year", filter: { types: new Set(), complexity: "", genre: "", edition: "", yearFrom: 0, yearTo: 0, officialOnly: false } };
		var controls = box.querySelector(".avesmaps-adv-tree-dialog__controls");
		var body = box.querySelector(".avesmaps-adv-tree-dialog__body");

		// Baum + Steuerung EINMAL bauen (Select-Werte/Chip-Zustand bleiben so ueber apply() erhalten).
		body.innerHTML = renderFrame(tree);
		// Reihenfolge (UI-Konvention, Design-Doc): Ansichts-Umschalter -> Filter -> Sortierung.
		// Filter stehen UEBER der Sortierung (Filter grenzt die Menge ein, Sortierung ordnet den Rest).
		controls.innerHTML = modesMarkup() + filtersMarkup(facets) + sortsMarkup();

		// Karten je Rahmen sortieren -- start bleibt VOR play (Rollen-Invariante), sortiert innerhalb der Rolle.
		function compare(a, b) {
			if (state.sort === "alpha") {
				return String(a.getAttribute("data-title")).localeCompare(String(b.getAttribute("data-title")), "de");
			}
			if (state.sort === "type") {
				return String(a.getAttribute("data-type")).localeCompare(String(b.getAttribute("data-type")), "de")
					|| ((Number(b.getAttribute("data-year")) || 0) - (Number(a.getAttribute("data-year")) || 0));
			}
			if (state.sort === "edition") {
				var ek = typeof avesmapsAdventureEditionSortKey === "function"
					? (avesmapsAdventureEditionSortKey(a.getAttribute("data-edition")) - avesmapsAdventureEditionSortKey(b.getAttribute("data-edition"))) : 0;
				return ek || String(a.getAttribute("data-title")).localeCompare(String(b.getAttribute("data-title")), "de");
			}
			return (Number(b.getAttribute("data-year")) || 0) - (Number(a.getAttribute("data-year")) || 0);
		}
		function sortCards() {
			var wraps = body.querySelectorAll(".avesmaps-adv-tree__cards");
			Array.prototype.forEach.call(wraps, function (wrap) {
				var all = Array.prototype.slice.call(wrap.children);
				all.sort(compare).forEach(function (c) { wrap.appendChild(c); });
			});
		}

		// Filter anwenden + Modus-Fade + leere Rahmen ausblenden + alle Zaehler ("N direkt" je Rahmen,
		// beginnt/spielt am Umschalter). Deepest-first, damit ein Elternteil die schon berechnete
		// Kind-Sichtbarkeit sieht.
		function apply() {
			Array.prototype.forEach.call(body.querySelectorAll(".avesmaps-adv__card"), function (c) {
				c.classList.toggle("is-filtered-out", !cardPasses(c, state.filter));
			});
			body.classList.toggle("show-spoilers", state.revealSpoilers);

			var frames = Array.prototype.slice.call(body.querySelectorAll(".avesmaps-adv-tree__frame")).reverse();
			frames.forEach(function (f) {
				var wrap = f.querySelector(":scope > .avesmaps-adv-tree__cards");
				var visStart = wrap ? wrap.querySelectorAll(".avesmaps-adv__card:not(.is-play):not(.is-filtered-out)").length : 0;
				var visPlay = wrap ? wrap.querySelectorAll(".avesmaps-adv__card.is-play:not(.is-filtered-out)").length : 0;
				// Sichtbare Karten im aktuellen Modus: start-Modus nur start; play-Modus zeigt beide (Fade).
				var visInMode = visStart + visPlay;
				var hasKid = Array.prototype.some.call(f.querySelectorAll(":scope > .avesmaps-adv-tree__frame"), function (k) {
					return !k.classList.contains("is-hidden");
				});
				f.classList.toggle("is-hidden", visInMode === 0 && !hasKid);
				var direct = f.querySelector(":scope > .avesmaps-adv-tree__fhead > [data-adv-direct]");
				if (direct) {
					var n = visStart + visPlay;
					direct.textContent = tr("adventures.directCount", "{n} direkt", { n: n });
				}
			});

			var totalStart = body.querySelectorAll(".avesmaps-adv__card:not(.is-play):not(.is-filtered-out)").length;
			var totalPlay = body.querySelectorAll(".avesmaps-adv__card.is-play:not(.is-filtered-out)").length;
			var cs = controls.querySelector('[data-adv-count="start"]');
			var cp = controls.querySelector('[data-adv-count="play"]');
			if (cs) { cs.textContent = "(" + totalStart + ")"; }
			if (cp) { cp.textContent = "(" + totalPlay + ")"; }
		}

		box.onclick = function (e) {
			var t = e.target;
			if (!t || !t.closest) {
				return;
			}
			var modeBtn = t.closest("[data-adv-tree-mode]");
			if (modeBtn) {
				state.revealSpoilers = !state.revealSpoilers;
				Array.prototype.forEach.call(controls.querySelectorAll("[data-adv-tree-mode]"), function (b) {
					var on = state.revealSpoilers;
					b.classList.toggle("is-active", on);
					b.setAttribute("aria-pressed", on ? "true" : "false");
				});
				apply();
				return;
			}
			var sortEl = t.closest("[data-adv-tree-sort]");
			if (sortEl) {
				state.sort = sortEl.getAttribute("data-adv-tree-sort");
				Array.prototype.forEach.call(controls.querySelectorAll("[data-adv-tree-sort]"), function (s) {
					s.classList.toggle("is-active", s === sortEl);
				});
				sortCards();
				return;
			}
			var chip = t.closest("[data-adv-filter]");
			if (chip && chip.classList.contains("avesmaps-adv-tree__chip")) {
				var kind = chip.getAttribute("data-adv-filter");
				if (kind === "official") {
					state.filter.officialOnly = !state.filter.officialOnly;
					chip.classList.toggle("is-active", state.filter.officialOnly);
				} else if (kind === "type") {
					var v = chip.getAttribute("data-adv-value");
					if (state.filter.types.has(v)) {
						state.filter.types.delete(v);
						chip.classList.remove("is-active");
					} else {
						state.filter.types.add(v);
						chip.classList.add("is-active");
					}
				}
				apply();
			}
		};
		box.onchange = function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "complexity") {
				state.filter.complexity = el.value || "";
				apply();
			} else if (kind === "genre") {
				state.filter.genre = el.value || "";
				apply();
			} else if (kind === "edition") {
				state.filter.edition = el.value || "";
				apply();
			}
		};
		// Year range filters live-update as you type (number inputs fire 'input', not 'change').
		box.oninput = function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "yearFrom") {
				state.filter.yearFrom = Number(el.value) || 0;
				apply();
			} else if (kind === "yearTo") {
				state.filter.yearTo = Number(el.value) || 0;
				apply();
			}
		};

		var creditEl = box.querySelector(".avesmaps-adv-dialog__credit");
		if (creditEl) {
			creditEl.innerHTML = (typeof avesmapsAdventureCreditMarkup === "function") ? avesmapsAdventureCreditMarkup() : "";
		}

		sortCards();
		apply();
		overlay.classList.add("is-open");
	};
})();
