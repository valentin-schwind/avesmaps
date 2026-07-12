// Abenteuer-Feature (Phase 2.3) -- der verschachtelte "Alle anzeigen"-Dialog fuer Territorien/Regionen.
//
// Umsetzung des vom Owner freigegebenen Entwurfs: echt VERSCHACHTELTE Rahmen (Box-in-Box, jede Ebene inkl.
// oberstem Reich gerahmt, Kind warm getoent + eingerueckt), Rang-Pill + "N direkt" je Knoten, Sortierzeile,
// beginnt/spielt-Umschalter (Fade wie im Streifen) und eine Filterleiste (Art als Chips [multi], Schwierigkeit
// + Genre als Selects, "nur offiziell" als Chip). Deepest-wins + Baum + Facetten kommen fertig aus dem
// Datenlayer (map-features-adventures.js): getAdventureTerritoryTree / avesmapsAdventureFacetOptions /
// avesmapsAdventureMatchesFilter. Die Karten-Optik teilt sich buildAdventureCardMarkup (place-extras.js) --
// im Nested-Dialog OHNE inline display:none (3. Arg), damit die CSS-Klassen (.is-play/.show-play/
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
			+ '<button type="button" class="avesmaps-adv-dialog__close" aria-label="Schließen">✕</button></div>'
			+ '<div class="avesmaps-adv-tree-dialog__controls"></div>'
			+ '<div class="avesmaps-adv-tree-dialog__body avesmaps-adv-tree-dialog__tree"></div></div>';
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
	// CSS (.is-play/.show-play/.is-filtered-out) Sichtbarkeit/Fade/Filter steuert.
	function cardMarkup(shape, isPlay) {
		return typeof buildAdventureCardMarkup === "function" ? buildAdventureCardMarkup(shape, isPlay, true) : "";
	}

	// Ein Territoriums-Rahmen, ECHT verschachtelt: Kopf (Rang-Pill + Name + "N direkt"), eigene Karten
	// (start + play), dann die Kind-Rahmen INNERHALB (Box-in-Box). deepest-wins ist bereits im Baum kodiert.
	function renderFrame(node) {
		if (!node) {
			return "";
		}
		var pill = node.rank ? '<span class="avesmaps-adv-tree__pill">' + esc(node.rank) + '</span>' : "";
		var startCards = (node.start || []).map(function (s) { return cardMarkup(s, false); }).join("");
		var playCards = (node.play || []).map(function (s) { return cardMarkup(s, true); }).join("");
		var kids = (node.children || []).map(renderFrame).join("");
		return '<div class="avesmaps-adv-tree__frame">'
			+ '<div class="avesmaps-adv-tree__fhead">' + pill
			+ '<span class="avesmaps-adv-tree__fname">' + esc(node.name) + '</span>'
			+ '<span class="avesmaps-adv-tree__direct" data-adv-direct>0 direkt</span></div>'
			+ '<div class="avesmaps-adv-tree__cards">' + startCards + playCards + '</div>'
			+ kids
			+ '</div>';
	}

	function sortsMarkup() {
		return '<div class="avesmaps-adv-tree__sorts">'
			+ '<span class="avesmaps-adv-tree__slabel">Sortierung:</span> '
			+ '<span class="avesmaps-adv-tree__sort is-active" data-adv-tree-sort="year">neueste zuerst</span>'
			+ '<span class="avesmaps-adv-tree__sortsep"> · </span>'
			+ '<span class="avesmaps-adv-tree__sort" data-adv-tree-sort="type">nach Art</span>'
			+ '<span class="avesmaps-adv-tree__sortsep"> · </span>'
			+ '<span class="avesmaps-adv-tree__sort" data-adv-tree-sort="alpha">alphabetisch</span>'
			+ '</div>';
	}
	function modesMarkup() {
		return '<div class="avesmaps-adv-tree__modes" role="tablist" aria-label="Beginnt hier oder Spielt hier">'
			+ '<button type="button" class="avesmaps-adv__mode is-active" data-adv-tree-mode="start">Beginnt hier <span class="avesmaps-adv__mode-count" data-adv-count="start"></span></button>'
			+ '<button type="button" class="avesmaps-adv__mode" data-adv-tree-mode="play">Spielt hier <span class="avesmaps-adv__mode-note">(Spoiler)</span> <span class="avesmaps-adv__mode-count" data-adv-count="play"></span></button>'
			+ '</div>';
	}
	// Filterleiste: "Filter"-Label + Art-Chips (multi) + Divider + Schwierigkeit-/Genre-Selects + Divider +
	// "nur offiziell"-Chip. Nur Dimensionen mit >=1 Facette.
	function filtersMarkup(facets) {
		var parts = ['<span class="avesmaps-adv-tree__flabel">Filter</span>'];
		var hasTypes = facets.types && facets.types.length;
		var hasSel = (facets.complexities && facets.complexities.length) || (facets.genres && facets.genres.length);
		if (hasTypes) {
			facets.types.forEach(function (t) {
				parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="type" data-adv-value="' + esc(t) + '">' + esc(t) + '</span>');
			});
		}
		if (hasTypes && hasSel) {
			parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
		}
		if (facets.complexities && facets.complexities.length) {
			parts.push('<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="complexity"><option value="">Schwierigkeit</option>'
				+ facets.complexities.map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('') + '</select></span>');
		}
		if (facets.genres && facets.genres.length) {
			parts.push('<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="genre"><option value="">Genre</option>'
				+ facets.genres.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('') + '</select></span>');
		}
		parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
		parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="official">nur offiziell</span>');
		return '<div class="avesmaps-adv-tree__filters">' + parts.join("") + '</div>';
	}

	// Pseudo-shape aus den Karten-data-Attributen -> avesmapsAdventureMatchesFilter (geteiltes Praedikat).
	function cardPasses(card, filter) {
		if (typeof avesmapsAdventureMatchesFilter !== "function") {
			return true;
		}
		return avesmapsAdventureMatchesFilter({
			type: card.getAttribute("data-type") || "",
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
			titleEl.textContent = head ? head.textContent.trim() : ("Abenteuer in " + (tree.name || ""));
		}

		var allShapes = [];
		collectShapes(tree, allShapes);
		var facets = (typeof avesmapsAdventureFacetOptions === "function")
			? avesmapsAdventureFacetOptions(allShapes)
			: { types: [], complexities: [], genres: [] };

		var state = { mode: "start", sort: "year", filter: { types: new Set(), complexity: "", genre: "", officialOnly: false } };
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
			return (Number(b.getAttribute("data-year")) || 0) - (Number(a.getAttribute("data-year")) || 0);
		}
		function sortCards() {
			var wraps = body.querySelectorAll(".avesmaps-adv-tree__cards");
			Array.prototype.forEach.call(wraps, function (wrap) {
				var all = Array.prototype.slice.call(wrap.children);
				var starts = all.filter(function (c) { return !c.classList.contains("is-play"); }).sort(compare);
				var plays = all.filter(function (c) { return c.classList.contains("is-play"); }).sort(compare);
				starts.concat(plays).forEach(function (c) { wrap.appendChild(c); });
			});
		}

		// Filter anwenden + Modus-Fade + leere Rahmen ausblenden + alle Zaehler ("N direkt" je Rahmen,
		// beginnt/spielt am Umschalter). Deepest-first, damit ein Elternteil die schon berechnete
		// Kind-Sichtbarkeit sieht.
		function apply() {
			Array.prototype.forEach.call(body.querySelectorAll(".avesmaps-adv__card"), function (c) {
				c.classList.toggle("is-filtered-out", !cardPasses(c, state.filter));
			});
			body.classList.toggle("show-play", state.mode === "play");

			var frames = Array.prototype.slice.call(body.querySelectorAll(".avesmaps-adv-tree__frame")).reverse();
			frames.forEach(function (f) {
				var wrap = f.querySelector(":scope > .avesmaps-adv-tree__cards");
				var visStart = wrap ? wrap.querySelectorAll(".avesmaps-adv__card:not(.is-play):not(.is-filtered-out)").length : 0;
				var visPlay = wrap ? wrap.querySelectorAll(".avesmaps-adv__card.is-play:not(.is-filtered-out)").length : 0;
				// Sichtbare Karten im aktuellen Modus: start-Modus nur start; play-Modus zeigt beide (Fade).
				var visInMode = state.mode === "play" ? (visStart + visPlay) : visStart;
				var hasKid = Array.prototype.some.call(f.querySelectorAll(":scope > .avesmaps-adv-tree__frame"), function (k) {
					return !k.classList.contains("is-hidden");
				});
				f.classList.toggle("is-hidden", visInMode === 0 && !hasKid);
				var direct = f.querySelector(":scope > .avesmaps-adv-tree__fhead > [data-adv-direct]");
				if (direct) {
					var n = state.mode === "play" ? visPlay : visStart;
					direct.textContent = n + " direkt";
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
				state.mode = modeBtn.getAttribute("data-adv-tree-mode") === "play" ? "play" : "start";
				Array.prototype.forEach.call(controls.querySelectorAll("[data-adv-tree-mode]"), function (b) {
					var on = b === modeBtn;
					b.classList.toggle("is-active", on);
					b.setAttribute("aria-selected", on ? "true" : "false");
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
			}
		};

		sortCards();
		apply();
		overlay.classList.add("is-open");
	};
})();
