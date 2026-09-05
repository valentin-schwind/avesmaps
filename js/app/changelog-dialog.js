/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
"use strict";

/*
 * Das Fenster „Neuigkeiten" — die Meilensteine des Projekts, aufgerufen aus dem Hinweise-Dialog
 * und vom Eckknopf unten rechts an der Karte.
 *
 * ⚠️ Bis zum 09.08.2026 hiess es „Änderungsverlauf". Umbenannt wurde nur die BESCHRIFTUNG: Datei,
 * ids, CSS-Klassen, i18n-Schlüssel (`changelog.*`), Endpunkt und Tabelle heissen weiter changelog.
 * Das ist Absicht — der Deploy löscht nie (AGENTS.md §10), und eine umgetaufte Tabelle oder ein
 * umgetaufter Endpunkt liesse eine noch gecachte index.html ins Leere greifen.
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

// Zerlegt einen Eintragstext in Text- und Link-Stuecke: [{ art: "text", wert }] bzw.
// [{ art: "link", wert, adresse }]. Rein -- kein DOM, kein Modulzustand, kein `document`.
//
// 🔴 SIE GIBT ES, WEIL DIESE DATEI NICHT MIT innerHTML BAUEN DARF (siehe Dateikopf): die
//    Eintraege sind Datenbankinhalt. Der Renderer haengt aus den Stuecken Textknoten und <a>
//    ans DOM, und damit kann ein Eintragstext nie zur Skriptquelle werden.
// 🔴 Erkannt wird AUSSCHLIESSLICH http:// und https://. Das ist zugleich der Riegel gegen
//    `javascript:` und der Grund, warum ein nacktes „www.example.de" nicht verlinkt wird: ob
//    eine Zeichenkette mit Punkt eine Adresse ist, kann man nur raten -- und ein geratener Link
//    im Fliesstext ist schlimmer als gar keiner.
// 💣 DAS NACHLAUFENDE SATZZEICHEN GEHOERT DEM SATZ. Der Eintrag vom 04.09.2026 endet auf
//    „…watch?v=gBJn-d_B3w4." -- wer den Punkt mitnimmt, baut einen Link auf eine Videokennung,
//    die es nicht gibt. Es faellt niemandem auf: der Link sieht richtig aus, YouTube antwortet
//    mit seiner eigenen Fehlerseite, und niemand sucht die Ursache im Changelog.
// ⚠️ Bei der Klammer wird GEZAEHLT, nicht abgeschnitten: Wikipedia-Adressen tragen Klammern im
//    Pfad (`…/Aventurien_(Welt)`). Wer stumpf jede schliessende Klammer wegnimmt, zerlegt genau
//    die Adressen, die eine brauchen; wer keine wegnimmt, schluckt die Klammer eines
//    eingeklammerten Satzes.
function avesmapsChangelogTextSegmente(roh) {
	var text = roh == null ? "" : String(roh);
	var stuecke = [];
	if (!text) return stuecke;

	var NACHLAUF = ".,;:!?\u2026\"'\u00bb\u00ab\u201c\u201e\u2019\u201a";
	var zaehle = function (s, z) {
		var n = 0;
		for (var i = 0; i < s.length; i++) { if (s.charAt(i) === z) n++; }
		return n;
	};
	var schneide = function (adresse) {
		var a = adresse;
		while (a.length) {
			var letztes = a.charAt(a.length - 1);
			if (NACHLAUF.indexOf(letztes) > -1) { a = a.slice(0, -1); continue; }
			if (letztes === ")" && zaehle(a, "(") < zaehle(a, ")")) { a = a.slice(0, -1); continue; }
			if (letztes === "]" && zaehle(a, "[") < zaehle(a, "]")) { a = a.slice(0, -1); continue; }
			break;
		}
		return a;
	};
	var schiebeText = function (wert) {
		if (!wert) return;
		var letztes = stuecke[stuecke.length - 1];
		// Zwei Textstuecke hintereinander werden EINES -- sonst haengt der Renderer zwei
		// Textknoten nebeneinander, und ein Test auf die Stueckzahl misst etwas anderes als das
		// sichtbare Ergebnis.
		if (letztes && letztes.art === "text") { letztes.wert += wert; return; }
		stuecke.push({ art: "text", wert: wert });
	};

	var muster = /https?:\/\/[^\s]+/gi;
	var gelesen = 0;
	var treffer;
	while ((treffer = muster.exec(text)) !== null) {
		var roher = treffer[0];
		var adresse = schneide(roher);
		// Nach dem Schnitt muss hinter dem Schema noch etwas stehen -- „https://." ist keine Adresse.
		if (!/^https?:\/\/[^\/].*/i.test(adresse)) { continue; }
		schiebeText(text.slice(gelesen, treffer.index));
		stuecke.push({ art: "link", wert: adresse, adresse: adresse });
		gelesen = treffer.index + adresse.length;
	}
	schiebeText(text.slice(gelesen));
	return stuecke;
}

(function () {
	// ZWEI Öffner: die Kachel „Was ist neu?" in den Hinweisen und der Knopf „Neuigkeiten" unten
	// rechts an der Karte. Wohin der Fokus beim Schliessen zurückkehrt, entscheidet nicht die Liste,
	// sondern wer tatsächlich geöffnet hat -- sonst landet er nach einem Klick auf „Neuigkeiten"
	// hinter einem geschlossenen Fenster in den Hinweisen.
	var OPEN_BUTTON_IDS = ["changelog-open", "news-button"];

	var overlay = null;
	var listHost = null;
	var openButtons = null;
	var lastOpener = null;
	var entriesCache = null;
	var isLoading = false;

	function el() {
		// Erst beim Bedarf gesucht: dieses Modul wird vor dem Ende des <body> geladen, aber ein
		// später verschobenes Fenster (wie beim Konfliktzentrum geschehen) soll es nicht abhängen.
		overlay = overlay || document.getElementById("changelog-overlay");
		listHost = listHost || document.getElementById("changelog-list");
		openButtons = openButtons || OPEN_BUTTON_IDS.map(function (id) {
			return document.getElementById(id);
		}).filter(Boolean);
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
				// 🔴 Die Adressen im Text werden echte Links -- per DOM, nie per innerHTML
				//    (Dateikopf). Extern heisst hier: IMMER, denn erkannt wird nur http/https auf
				//    einen fremden Wirt; deshalb traegt jeder gebaute Link target=_blank und damit
				//    das ↗ aus dem Blatt.
				// 💣 rel="noopener noreferrer" ist Pflicht neben target=_blank: ohne noopener
				//    bekommt die fremde Seite ueber window.opener einen Griff auf unseren Tab.
				avesmapsChangelogTextSegmente(String(entry.body)).forEach(function (stueck) {
					if (stueck.art === "link") {
						var verweis = document.createElement("a");
						verweis.href = stueck.adresse;
						verweis.textContent = stueck.wert;
						verweis.target = "_blank";
						verweis.rel = "noopener noreferrer";
						text.appendChild(verweis);
						return;
					}
					text.appendChild(document.createTextNode(stueck.wert));
				});
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
				showStatus(t("changelog.error", "Die Neuigkeiten konnten nicht geladen werden."));
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
			if (lastOpener) {
				lastOpener.focus();
			}
		}
	}

	if (!el()) {
		return;
	}

	openButtons.forEach(function (button) {
		button.addEventListener("click", function () {
			lastOpener = button;
			setOpen(true);
		});
	});

	var closeButton = document.getElementById("changelog-close");
	if (closeButton) {
		closeButton.addEventListener("click", function () {
			setOpen(false);
		});
	}

	// 🔴 DAS GETEILTE BAUTEIL, nicht die eigene Abschrift (js/ui/dialog-hintergrund-schliessen.js).
	//    Der Unterschied ist DRUCK UND LOSLASSEN: `click` feuert am naechsten gemeinsamen VORFAHREN,
	//    also schliesst ein blosses `event.target === overlay` auch dann, wenn jemand IM Fenster
	//    Text markiert und dabei ueber den Rand hinauszieht -- der Vorfahre IST dann die Huelle.
	//    Bei einem Anzeigefenster faellt das nie auf; deshalb kamen die rund 25 aelteren
	//    Abschriften im Haus damit durch. Wer eine anfasst, holt sie hierher (AGENTS.md §11).
	avesmapsDialogHintergrundSchliessen(overlay, function () { setOpen(false); });

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
