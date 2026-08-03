/*
 * Einklappbare Einstellgruppen im Routenplaner: „Transportmittel" und „Routenoptionen".
 *
 * Warum es das gibt (Owner 2026-08-02, „mehr Platz fuer die Etappen"): am 1280x800-Fenster
 * mass die Oberflaeche ueber dem Reiseplan 754 px von 760 px Panelhoehe -- dem Reiseplan
 * blieben 6 px, er lebte komplett im Scrollbalken. Beide Gruppen eingeklappt geben rund
 * 190 px zurueck; jede schrumpft dabei auf ihre Kopfzeile.
 *
 * ⭐ Eingeklappt verschwindet NICHTS: die Kopfzeile zeigt dann, was gerade eingestellt ist.
 *
 * Der Zustand haengt an der ROUTE (Owner 2026-08-02): steht eine, klappen beide Gruppen zu und
 * machen dem Reiseplan Platz; steht keine, sind sie offen und man kann einstellen. Dazwischen
 * gilt immer der Klick -- wer aufklappt, bleibt aufgeklappt.
 *
 * 💣 Nur der WECHSEL zaehlt, nicht der Zustand. Sonst waere genau der Einwand des Owners gegen
 * „bei fertiger Route ausblenden" wieder da: jede Aenderung an einer bestehenden Route laesst den
 * Reiseplan neu rechnen, und die Gruppe waere dem Nutzer unter den Fingern zugeklappt. Und weil
 * die Engine waehrend des Rechnens „Route wird berechnet..." in dieselbe Flaeche schreibt, sieht
 * es fuer einen Wimpernschlag nach „keine Route" aus -- das Aufklappen wartet deshalb ab
 * (ROUTE_SETTLE_MS), das Zuklappen nicht.
 *
 * 💣 Die Zusammenfassung wird aus dem GERENDERTEN Markup gelesen (Combobox-Beschriftung,
 * Radio-Label, Zahlenfeld), nicht aus einer eigenen Textliste. Damit stimmt sie unter ?lang=en
 * automatisch und kann nicht auseinanderlaufen, wenn jemand ein Transportmittel umbenennt.
 */
(function () {
	"use strict";

	// So lange muss „keine Route" anhalten, bevor die Gruppen wieder aufgehen. Deckt die Luecke
	// zwischen „Route wird berechnet..." und dem fertigen Plan ab.
	var ROUTE_SETTLE_MS = 700;

	var groups = [];

	function translate(key, germanDefault, params) {
		return typeof window.tr === "function" ? window.tr(key, germanDefault, params) : germanDefault;
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
		// Reisebeginn -- nur wenn einer gesetzt ist; „Ohne Jahreszeit" ist der leere Wert und hat in
		// der Kopfzeile nichts verloren.
		// 💣 Der Monatsname kommt aus der GEWAEHLTEN OPTION, nicht aus einer Liste hier drin: sonst
		// haette die Kopfzeile eine zweite Wahrheit ueber die zwoelf Namen. `withoutParenthetical`
		// wirft die Jahreszeit ab -- „Firun (Winter)" ist im Aufklapper hilfreich, in der Zeile Ballast.
		var startMonth = document.getElementById("travelStartMonth");
		var startDay = document.getElementById("travelStartDay");
		if (startMonth && startMonth.value) {
			var monthOption = startMonth.options[startMonth.selectedIndex];
			var monthText = withoutParenthetical(monthOption ? monthOption.textContent : "");
			var dayNumber = parseInt(startDay ? startDay.value : "", 10);
			if (monthText) {
				parts.push(summaryPart("", translate("planner.options.summary.travelStart", "ab {day}. {month}", {
					day: Number.isFinite(dayNumber) ? dayNumber : 1,
					month: monthText,
				})));
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
	function setupGroup(group, buildSummary) {
		var toggle = group.querySelector(".planner-group__toggle");
		var body = group.querySelector(".planner-group__body");
		var summary = group.querySelector(".planner-group__summary");
		if (!toggle || !body || !summary) {
			return;
		}

		// Ohne Route offen -- der Routenzustand meldet sich gleich und korrigiert das, falls beim
		// Laden schon eine Route steht (geteilter Link).
		var collapsed = false;

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
			apply(true);
		});

		// Der Routenzustand darf die Gruppe umschalten -- aber nur, wenn sie nicht ohnehin schon
		// so steht. Sonst liefe die Ueberblendung ohne Anlass noch einmal los.
		groups.push(function (nextCollapsed, animate) {
			if (nextCollapsed === collapsed) {
				return;
			}
			collapsed = nextCollapsed;
			apply(animate);
		});

		// Live nachziehen, solange die Gruppe offen ist -- sonst zeigt die Kopfzeile beim
		// Zuklappen den Stand von vorhin. `change` deckt Haken, Auswahl und Zahlenfeld ab,
		// `input` zusaetzlich das Tippen im Zahlenfeld.
		body.addEventListener("change", refreshSummary);
		body.addEventListener("input", refreshSummary);

		// 💣 Ein geteilter Link setzt die Felder per .val() -- ohne `change`, und ohne dass sich am
		// Markup etwas aendert, das der Beobachter unten sehen koennte. applyPlannerStateFromUrl()
		// sagt deshalb ausdruecklich Bescheid, wenn es fertig ist. Ohne diese Zeile zeigt die
		// Kopfzeile beim Empfaenger eines Links die Voreinstellungen statt dessen, was im Link steht.
		document.addEventListener("avesmaps:planner-state-applied", refreshSummary);

		// 💣 Die eigene Transport-Combobox schreibt Beschriftung und Bild direkt in die Spans --
		// ein `change` des nativen <select> allein ist kein verlaesslicher Ausloeser dafuer.
		// Deshalb zusaetzlich am Markup horchen, gebuendelt auf den naechsten Frame.
		if (typeof window.MutationObserver === "function") {
			// 💣 Buendeln per Timer, NICHT per requestAnimationFrame: rAF steht still, solange der
			// Reiter nicht sichtbar ist. Im Hintergrund gerechnete Routen wuerden sonst erst beim
			// Zurueckschalten ankommen.
			var pending = false;
			var observer = new MutationObserver(function () {
				if (pending) {
					return;
				}
				pending = true;
				window.setTimeout(function () {
					pending = false;
					refreshSummary();
				}, 0);
			});
			observer.observe(body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src"] });
		}

		apply(false);
	}

	// --- Routenzustand -----------------------------------------------------------------------
	// Eine Route steht, sobald der Plan Etappen zeigt. Die Zwischentexte der Engine („Route wird
	// berechnet...", „Keine Route gefunden") sind blanker Text in derselben Flaeche und zaehlen
	// damit von selbst als „keine Route" -- ohne dass hier ein Satz mitgepflegt werden muesste.
	function routeIsShown(overview) {
		return !!overview.querySelector(".route-plan-entry--chained");
	}

	function watchRoute() {
		var overview = document.getElementById("overview");
		if (!overview) {
			return;
		}

		var applied = routeIsShown(overview);
		groups.forEach(function (setGroup) {
			setGroup(applied, false);
		});

		if (typeof window.MutationObserver !== "function") {
			return;
		}

		var settleTimer = null;
		var pending = false;

		function commit(next) {
			if (next === applied) {
				return;
			}
			applied = next;
			groups.forEach(function (setGroup) {
				setGroup(next, true);
			});
		}

		// 💣 Auch hier ein Timer statt requestAnimationFrame -- im unsichtbaren Reiter feuert rAF
		// nicht, und dann bliebe die Automatik bei einer im Hintergrund fertig gerechneten Route aus.
		new MutationObserver(function () {
			if (pending) {
				return;
			}
			pending = true;
			window.setTimeout(function () {
				pending = false;
				var next = routeIsShown(overview);
				window.clearTimeout(settleTimer);
				if (next) {
					// Route da: sofort zuklappen, der Plan will den Platz jetzt.
					commit(true);
					return;
				}
				// 💣 Nicht sofort aufklappen: waehrend einer Neuberechnung steht hier kurz nur
				// „Route wird berechnet...", und ein Aufklappen mit anschliessendem Zuklappen
				// waere ein Zucken unter den Fingern des Nutzers.
				settleTimer = window.setTimeout(function () {
					commit(routeIsShown(overview));
				}, ROUTE_SETTLE_MS);
			}, 0);
		}).observe(overview, { childList: true, subtree: true });
	}

	function setup() {
		var transport = document.getElementById("transport-options");
		if (transport) {
			setupGroup(transport, transportSummary);
		}
		// Die Gruppe „Routenoptionen" baut enhanceRoutePlannerOptionPanel() erst zur Laufzeit
		// (map-features-waypoints.js) -- diese Datei wird danach geladen, ihr DOMContentLoaded
		// laeuft also spaeter. Fehlt sie trotzdem, bleibt der Rest unberuehrt.
		var options = document.querySelector(".route-planner-options-panel");
		if (options) {
			setupGroup(options, routeOptionsSummary);
		}
		watchRoute();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", setup, { once: true });
	} else {
		setup();
	}
})();
