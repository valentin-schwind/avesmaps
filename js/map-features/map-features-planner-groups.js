/*
 * Einklappbare Einstellgruppen im Routenplaner: „Transportmittel" und „Routenoptionen".
 *
 * Warum es das gibt (Owner 2026-08-02, „mehr Platz fuer die Etappen"): am 1280x800-Fenster
 * misst die Oberflaeche ueber dem Reiseplan 754 px von 760 px Panelhoehe -- dem Reiseplan
 * bleiben 6 px, er lebt komplett im Scrollbalken. Beide Gruppen eingeklappt sparen 187 px
 * (Transport 152 -> 28, Routenoptionen 92 -> 28).
 *
 * ⭐ Eingeklappt verschwindet NICHTS: die Kopfzeile zeigt dann, was gerade eingestellt ist.
 * Und es klappt nichts von allein -- der Zustand haengt nur am Klick und wird gemerkt. Genau
 * das war der Einwand gegen „bei fertiger Route automatisch ausblenden".
 *
 * 💣 Die Zusammenfassung wird aus dem GERENDERTEN Markup gelesen (Combobox-Beschriftung,
 * Radio-Label, Zahlenfeld), nicht aus einer eigenen Textliste. Damit stimmt sie unter ?lang=en
 * automatisch und kann nicht auseinanderlaufen, wenn jemand ein Transportmittel umbenennt.
 */
(function () {
	"use strict";

	var STORAGE_KEY = "avesmaps-planner-groups";

	// Eingeklappt ist der Auslieferungszustand: der Reiseplan ist das Ergebnis, die Einstellungen
	// sind der Weg dorthin, und die Kopfzeile sagt ja, was eingestellt ist. Wer aufklappt, bleibt
	// aufgeklappt (gemerkt pro Browser).
	var DEFAULT_COLLAPSED = true;

	function translate(key, germanDefault, params) {
		return typeof window.tr === "function" ? window.tr(key, germanDefault, params) : germanDefault;
	}

	function readState() {
		try {
			var raw = window.localStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : {};
		} catch (error) {
			return {};
		}
	}

	function writeState(state) {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (error) {
			/* Privater Modus o. ae. -- der Schalter funktioniert weiter, er merkt sich nur nichts. */
		}
	}

	// „Reisegruppe zu Fuss (4 Meilen/h)" -> „Reisegruppe zu Fuss". In der Kopfzeile ist die
	// Geschwindigkeit Beiwerk und kostet die Haelfte der Breite.
	function withoutParenthetical(text) {
		return String(text || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
	}

	function summaryPart(iconSrc, text) {
		return { icon: iconSrc || "", text: text || "" };
	}

	// --- Zusammenfassung: Transportmittel ------------------------------------------------
	// Ein Teil je ERLAUBTEM Medium, mit dem Bild des gewaehlten Fahrzeugs davor.
	function transportSummary() {
		var media = [
			{ allow: "allowLand", icon: "landTransportIcon", label: "landTransportLabel" },
			{ allow: "allowRiver", icon: "riverTransportIcon", label: "riverTransportLabel" },
			{ allow: "allowSea", icon: "seaTransportIcon", label: "seaTransportLabel" },
		];
		var parts = [];
		media.forEach(function (medium) {
			var allow = document.getElementById(medium.allow);
			if (!allow || !allow.checked) {
				return;
			}
			var icon = document.getElementById(medium.icon);
			var label = document.getElementById(medium.label);
			parts.push(summaryPart(icon ? icon.getAttribute("src") : "", withoutParenthetical(label ? label.textContent : "")));
		});
		if (!parts.length) {
			return [summaryPart("", translate("planner.transport.summary.none", "kein Transportmittel erlaubt"))];
		}
		return parts;
	}

	// --- Zusammenfassung: Routenoptionen -------------------------------------------------
	function routeOptionsSummary() {
		var parts = [];
		var checkedType = document.querySelector('#search input[name="pathType"]:checked');
		if (checkedType) {
			var typeLabel = checkedType.closest("label");
			if (typeLabel) {
				parts.push(summaryPart("", typeLabel.textContent.trim()));
			}
		}
		var hours = document.getElementById("travelHoursPerDay");
		if (hours && hours.value !== "") {
			// 💣 Ueber formatDecimalNumber, nicht roh: das Feld liefert "12.0", und im deutschen
			// Panel gehoert dort ein Komma hin. Der Helfer kennt dazu die aktive Sprache.
			var hoursText = typeof window.formatDecimalNumber === "function"
				? window.formatDecimalNumber(hours.value, 1)
				: hours.value;
			parts.push(summaryPart("", translate("planner.options.summary.hoursPerDay", "{n} h/Tag", { n: hoursText })));
		}
		var minimize = document.getElementById("minimizeTransfers");
		if (minimize && minimize.checked) {
			var minimizeLabel = minimize.closest("label");
			if (minimizeLabel) {
				parts.push(summaryPart("", minimizeLabel.textContent.trim()));
			}
		}
		return parts;
	}

	function renderSummary(target, parts) {
		target.textContent = "";
		parts.forEach(function (part, index) {
			if (index > 0) {
				target.appendChild(document.createTextNode(" · "));
			}
			if (part.icon) {
				var img = document.createElement("img");
				img.className = "planner-group__summary-icon";
				img.src = part.icon;
				img.alt = "";
				target.appendChild(img);
			}
			target.appendChild(document.createTextNode(part.text));
		});
		return parts
			.map(function (part) {
				return part.text;
			})
			.join(" · ");
	}

	// --- Verdrahtung ----------------------------------------------------------------------
	function setupGroup(group, key, buildSummary) {
		var toggle = group.querySelector(".planner-group__toggle");
		var body = group.querySelector(".planner-group__body");
		var summary = group.querySelector(".planner-group__summary");
		if (!toggle || !body || !summary) {
			return;
		}

		var state = readState();
		var collapsed = typeof state[key] === "boolean" ? state[key] : DEFAULT_COLLAPSED;

		function refreshSummary() {
			var plain = renderSummary(summary, buildSummary());
			// Der volle Wortlaut in den Tooltip: in 350 px Panelbreite schneidet die Ellipse ab.
			toggle.setAttribute("title", plain);
		}

		var reducedMotion = typeof window.matchMedia === "function"
			&& window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		var animationToken = 0;

		// Nach der Ueberblendung aufraeumen. Der Merker faengt schnelles Hin- und Herklicken ab:
		// laeuft schon eine neuere Bewegung, macht die aeltere nichts mehr. Der Wecker ist das
		// Sicherheitsnetz, falls `transitionend` ausbleibt (Reiter im Hintergrund).
		function afterTransition(token, done) {
			var finish = function () {
				if (token === animationToken) {
					done();
				}
			};
			body.addEventListener("transitionend", function handler(event) {
				if (event.target !== body || event.propertyName !== "max-height") {
					return;
				}
				body.removeEventListener("transitionend", handler);
				finish();
			});
			window.setTimeout(finish, 400);
		}

		// 💣 Ueber max-height, nicht height: `auto` ist nicht animierbar. Der Zielwert wird
		// GEMESSEN, nie geraten -- und danach wieder freigegeben, sonst deckelte er den Koerper,
		// sobald dort spaeter eine Zeile dazukommt.
		//
		// 💣 `overflow: hidden` gilt NUR waehrend der Bewegung und wird danach abgeraeumt. Steht es
		// dauerhaft im Stylesheet, beschneidet es das Menue der Transport-Combobox -- das haengt
		// `position: absolute` im Koerper und ragt bewusst darueber hinaus.
		function releaseBody() {
			body.style.maxHeight = "";
			body.style.overflow = "";
		}

		function setBodyState(animate) {
			animationToken += 1;
			var token = animationToken;

			if (!animate || reducedMotion) {
				body.hidden = collapsed;
				releaseBody();
				return;
			}

			body.style.overflow = "hidden";

			if (collapsed) {
				body.style.maxHeight = body.scrollHeight + "px";
				void body.offsetHeight; // Zwischenstand erzwingen, sonst springt es direkt auf 0
				body.style.maxHeight = "0px";
				afterTransition(token, function () {
					body.hidden = true;
					releaseBody();
				});
				return;
			}

			body.hidden = false;
			body.style.maxHeight = "0px";
			void body.offsetHeight;
			body.style.maxHeight = body.scrollHeight + "px";
			afterTransition(token, releaseBody);
		}

		function apply(animate) {
			group.classList.toggle("planner-group--collapsed", collapsed);
			group.classList.toggle("planner-group--open", !collapsed);
			toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
			refreshSummary();
			setBodyState(animate);
		}

		toggle.addEventListener("click", function () {
			collapsed = !collapsed;
			var next = readState();
			next[key] = collapsed;
			writeState(next);
			apply(true);
		});

		// Live nachziehen, solange die Gruppe offen ist -- sonst zeigt die Kopfzeile beim
		// Zuklappen den Stand von vorhin. `change` deckt Haken, Auswahl und Zahlenfeld ab,
		// `input` zusaetzlich das Tippen im Zahlenfeld.
		body.addEventListener("change", refreshSummary);
		body.addEventListener("input", refreshSummary);

		// 💣 Die eigene Transport-Combobox schreibt Beschriftung und Bild direkt in die Spans --
		// ein `change` des nativen <select> allein ist kein verlaesslicher Ausloeser dafuer.
		// Deshalb zusaetzlich am Markup horchen, gebuendelt auf den naechsten Frame.
		if (typeof window.MutationObserver === "function") {
			var pending = false;
			var observer = new MutationObserver(function () {
				if (pending) {
					return;
				}
				pending = true;
				window.requestAnimationFrame(function () {
					pending = false;
					refreshSummary();
				});
			});
			observer.observe(body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src"] });
		}

		apply(false);
	}

	function setup() {
		var transport = document.getElementById("transport-options");
		if (transport) {
			setupGroup(transport, "transport", transportSummary);
		}
		// Die Gruppe „Routenoptionen" baut enhanceRoutePlannerOptionPanel() erst zur Laufzeit
		// (map-features-waypoints.js) -- diese Datei wird danach geladen, ihr DOMContentLoaded
		// laeuft also spaeter. Fehlt sie trotzdem, bleibt der Rest unberuehrt.
		var options = document.querySelector(".route-planner-options-panel");
		if (options) {
			setupGroup(options, "options", routeOptionsSummary);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", setup, { once: true });
	} else {
		setup();
	}
})();
