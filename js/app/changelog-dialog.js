"use strict";

/*
 * Der Änderungsverlauf — die Meilensteine des Projekts, aufgerufen aus dem Hinweise-Dialog.
 *
 * Markup: index.html (#changelog-overlay), Gestalt: css/components/changelog-dialog.css,
 * Daten: GET /api/app/changelog.php (Startbestand + Logik: api/_internal/app/changelog.php).
 *
 * LAZY: geladen wird beim ERSTEN Öffnen, nicht beim Seitenstart. Der Verlauf ist eine Seltenheit,
 * die kaum jemand aufschlägt — er hat auf dem kritischen Pfad der Karte nichts zu suchen. Danach
 * bleibt die Liste im Speicher; ein zweites Öffnen kostet nichts.
 *
 * Gebaut wird per textContent, nie per innerHTML: die Einträge sind Datenbankinhalt, und der geht
 * grundsätzlich nicht als Markup ins DOM.
 */

var AVESMAPS_CHANGELOG_API_URL = "api/app/changelog.php";

// Die Rubrik-Marke unter jedem Eintrag. Die Schlüssel sind DATEN (sie stehen so in der Tabelle und
// in AVESMAPS_CHANGELOG_CATEGORIES); nur ihre Beschriftung ist Oberfläche und darf übersetzt werden.
var AVESMAPS_CHANGELOG_CATEGORY_LABELS = {
	karte: "Karte",
	routenplaner: "Routenplaner",
	inhalte: "Inhalte",
	community: "Community",
};

(function () {
	var overlay = null;
	var listHost = null;
	var openButton = null;
	var entriesCache = null;
	var isLoading = false;

	function el() {
		// Erst beim Bedarf gesucht: dieses Modul wird vor dem Ende des <body> geladen, aber ein
		// später verschobenes Fenster (wie beim Konfliktzentrum geschehen) soll es nicht abhängen.
		overlay = overlay || document.getElementById("changelog-overlay");
		listHost = listHost || document.getElementById("changelog-list");
		openButton = openButton || document.getElementById("changelog-open");
		return overlay && listHost;
	}

	function lang() {
		return window.avesmapsActiveLang === "en" ? "en" : "de";
	}

	/** Übersetzt, wenn die Engine da ist — sonst der deutsche Text. tr() ist unter Deutsch inert. */
	function t(key, fallback) {
		if (typeof window.tr === "function") {
			var translated = window.tr(key, fallback);
			if (typeof translated === "string" && translated !== "") {
				return translated;
			}
		}
		return fallback;
	}

	/** "2026-08-03" -> "August 2026" / "August 2026". Sprachabhängig über Intl, ohne eigene Tabelle. */
	function monthLabel(isoDate) {
		var date = new Date(isoDate + "T12:00:00");
		if (isNaN(date.getTime())) {
			return isoDate;
		}
		try {
			return new Intl.DateTimeFormat(lang(), { month: "long", year: "numeric" }).format(date);
		} catch (error) {
			return isoDate.slice(0, 7);
		}
	}

	/** "2026-08-03" -> "3. August" / "August 3". Das Jahr steht schon im Monatsband darüber. */
	function dayLabel(isoDate) {
		var date = new Date(isoDate + "T12:00:00");
		if (isNaN(date.getTime())) {
			return isoDate;
		}
		try {
			return new Intl.DateTimeFormat(lang(), { day: "numeric", month: "long" }).format(date);
		} catch (error) {
			return isoDate;
		}
	}

	function categoryLabel(key) {
		var german = AVESMAPS_CHANGELOG_CATEGORY_LABELS[key];
		if (!german) {
			return "";
		}
		return t("changelog.category." + key, german);
	}

	function showStatus(message) {
		listHost.textContent = "";
		var status = document.createElement("p");
		status.className = "changelog-dialog__status";
		status.textContent = message;
		listHost.appendChild(status);
	}

	function renderEntries(entries) {
		listHost.textContent = "";

		if (!entries || entries.length === 0) {
			// Ein leeres Fenster behauptete, es sei nie etwas passiert. Lieber der ehrliche Satz.
			showStatus(t("changelog.empty", "Hier steht noch nichts."));
			return;
		}

		var currentMonth = "";
		entries.forEach(function (entry) {
			var month = String(entry.date || "").slice(0, 7);
			if (month !== currentMonth) {
				currentMonth = month;
				var heading = document.createElement("h3");
				heading.className = "changelog-month";
				heading.textContent = monthLabel(entry.date);
				listHost.appendChild(heading);
			}

			var row = document.createElement("div");
			row.className = "changelog-entry";

			var date = document.createElement("div");
			date.className = "changelog-entry__date";
			date.textContent = dayLabel(entry.date);
			row.appendChild(date);

			var body = document.createElement("div");
			body.className = "changelog-entry__body";

			var title = document.createElement("p");
			title.className = "changelog-entry__title";
			title.textContent = String(entry.title || "");
			body.appendChild(title);

			if (entry.body) {
				var text = document.createElement("p");
				text.className = "changelog-entry__text";
				text.textContent = String(entry.body);
				body.appendChild(text);
			}

			var label = categoryLabel(String(entry.category || ""));
			if (label) {
				var tag = document.createElement("span");
				tag.className = "changelog-entry__tag";
				tag.textContent = label;
				body.appendChild(tag);
			}

			row.appendChild(body);
			listHost.appendChild(row);
		});

		// Immer beim jüngsten Eintrag anfangen -- das ist der Sinn von "neueste zuerst". Nötig, weil
		// das Füllen der Liste den Kasten sonst verschiebt (siehe overflow-anchor in der CSS), und
		// richtig auch beim zweiten Öffnen: wer den Verlauf aufschlägt, will das Neue sehen.
		listHost.scrollTop = 0;
	}

	function loadEntries() {
		if (entriesCache) {
			renderEntries(entriesCache);
			return;
		}
		if (isLoading) {
			return;
		}

		isLoading = true;
		showStatus(t("changelog.loading", "Lade …"));

		fetch(AVESMAPS_CHANGELOG_API_URL, { headers: { Accept: "application/json" } })
			.then(function (response) {
				if (!response.ok) {
					throw new Error("HTTP " + response.status);
				}
				return response.json();
			})
			.then(function (payload) {
				if (!payload || payload.ok !== true || !Array.isArray(payload.entries)) {
					throw new Error("unerwartete Antwort");
				}
				entriesCache = payload.entries;
				renderEntries(entriesCache);
			})
			.catch(function () {
				// Kein Wiederholungsknopf: ein erneutes Öffnen versucht es ohnehin neu, weil der
				// Cache nur bei Erfolg gefüllt wird.
				showStatus(t("changelog.error", "Der Änderungsverlauf konnte nicht geladen werden."));
			})
			.then(function () {
				isLoading = false;
			});
	}

	function isOpen() {
		return Boolean(overlay) && !overlay.hasAttribute("hidden");
	}

	function setOpen(open) {
		if (!el()) {
			return;
		}

		if (open) {
			overlay.removeAttribute("hidden");
			loadEntries();
			var dialog = document.getElementById("changelog-dialog");
			if (dialog) {
				// preventScroll: der Fokus soll die Tastatur ins Fenster holen, nicht die Liste
				// darin bewegen. Ältere Browser ignorieren die Option, deshalb hängt die
				// Anfangsposition nicht daran (renderEntries setzt scrollTop selbst).
				try {
					dialog.focus({ preventScroll: true });
				} catch (error) {
					dialog.focus();
				}
			}
		} else {
			overlay.setAttribute("hidden", "hidden");
			if (openButton) {
				openButton.focus();
			}
		}
	}

	if (!el()) {
		return;
	}

	if (openButton) {
		openButton.addEventListener("click", function () {
			setOpen(true);
		});
	}

	var closeButton = document.getElementById("changelog-close");
	if (closeButton) {
		closeButton.addEventListener("click", function () {
			setOpen(false);
		});
	}

	// Klick auf den Schleier schliesst -- wie bei jedem Fenster im Haus.
	overlay.addEventListener("click", function (event) {
		if (event.target === overlay) {
			setOpen(false);
		}
	});

	// 💣 capture:true ist hier tragend, nicht Geschmack: bootstrap.js hört Escape am document ab und
	// schliesst damit die HINWEISE. Ohne diesen Vorlauf verschwände auf einen Druck das Fenster
	// dahinter, während der Verlauf offen stehenbliebe. stopPropagation haelt das Ereignis von dort
	// fern, solange der Verlauf oben liegt.
	document.addEventListener("keydown", function (event) {
		if (event.key === "Escape" && isOpen()) {
			event.stopPropagation();
			setOpen(false);
		}
	}, true);

	// Für Konsole und künftige Aufrufer (etwa ein Deep-Link auf den Verlauf).
	window.avesmapsSetChangelogDialogOpen = setOpen;
})();
