/*
 * Die Kurven des Reisemodells: acht Kacheln — sieben Wegarten als „Meilen pro Stunde über der
 * Neigung" und der Zeitfaktor selbst.
 *
 * 🔴 EIN ZEICHNER FÜR ZWEI ORTE. Das Bild hing bis 2026-08-03 nur im Wege-Editor
 * (js/pages/wege-editor.js, „Funktionen anzeigen"); seither zeigt es auch der öffentliche
 * ⓘ-Dialog „Transportmittel". Zwei Zeichner wären zwei Bilder, die sich nach dem zweiten
 * Feinschliff unterscheiden — genau die Divergenz, vor der AGENTS.md §12 warnt.
 *
 * 🔴 UND EIN RECHNER: `wpFactorForGradientPercent` aus js/pages/wege-editor-model.js, dem
 * unit-getesteten Spiegel von api/_internal/routing/terrain-factor.php. Hier steht KEINE eigene
 * Formel — was die Kurve zeigt, ist das, was die Route rechnet. Das war die Bedingung des Owners
 * für diesen Dialog.
 *
 * ⚠️ Die Kalibrierung gehört NICHT hierher. Sie ist ein Schreibvorgang über alle Wegprofile und
 * bleibt beim Editor; das Frontend zeigt nur das Modell (Owner 2026-08-03: „ohne die kalibrierung,
 * die dürfen frontendnutzer nicht machen").
 *
 * Die Geschwindigkeitstabelle kommt als Parameter, damit jede Seite ihre eigene Wahrheit reicht --
 * geprüft am 2026-08-03: WP_SPEEDS und SPEED_TABLE stimmen in allen 42 Werten überein.
 */

"use strict";

/* 🔴 EINE Geometrie für ALLE acht Kacheln. Die sieben Geschwindigkeitsbilder und die Faktorkurve
   teilen sich viewBox und Achsenlage, sonst hätte eine Zelle ein anderes Seitenverhältnis und die
   Reihe stünde schief. */
var AVESMAPS_TMC_X0 = 32, AVESMAPS_TMC_X1 = 228, AVESMAPS_TMC_Y0 = 12, AVESMAPS_TMC_Y1 = 100, AVESMAPS_TMC_VMAX = 9;
/* 💣 DER UNTERSTE WERT DER y-ACHSE STEHT ÜBER DER ACHSE, nicht darunter. Darunter stiess seine
   Textbox mit dem „−45" der x-Achse zusammen -- in allen acht Bildern, gemessen an den gerenderten
   getBBox()-Rechtecken, nicht beim Lesen des Codes zu sehen. */
var AVESMAPS_TMC_BASE_TICK_Y = AVESMAPS_TMC_Y1 - 2;
/* Und die Achsenbeschriftung oben braucht y = 10: bei 9 ragte ihre Box 0,5 px über die
   viewBox-Oberkante hinaus und wurde dort beschnitten. */
var AVESMAPS_TMC_LABEL_Y = 10;

function avesmapsTmcX(gradientPercent) {
	return AVESMAPS_TMC_X0 + ((gradientPercent + 45) / 90) * (AVESMAPS_TMC_X1 - AVESMAPS_TMC_X0);
}

function avesmapsTmcY(milesPerHour) {
	return AVESMAPS_TMC_Y1 - (milesPerHour / AVESMAPS_TMC_VMAX) * (AVESMAPS_TMC_Y1 - AVESMAPS_TMC_Y0);
}

function avesmapsTmcSeriesLine(index) {
	return "wp-line wp-line--" + (index + 1);
}

function avesmapsTmcEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ⚠️ Der Rückfall schreibt das KOMMA, nicht den Punkt. Im Frontend übernimmt
   formatDecimalNumber() und kennt dazu die aktive Sprache; der Wege-Editor hat diese Funktion
   nicht, und ohne den Rückfall stand dort „5.4 Meilen/h" statt „5,4" -- gleich beim ersten
   Testlauf nach dem Umzug sichtbar. */
function avesmapsTmcNumber(value, digits) {
	if (typeof window !== "undefined" && typeof window.formatDecimalNumber === "function") {
		return window.formatDecimalNumber(value, digits);
	}
	var n = Number(value);
	return isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits).replace(".", ",") : "—";
}

/**
 * Die Faktorkurve als ACHTE Kachel (Owner 2026-08-02) -- sieben Wegtypen plus diese ergeben
 * genau 4 × 2.
 *
 * 🔴 GLEICHE viewBox-GEOMETRIE wie die sieben Geschwindigkeitsbilder. Ein anderes Seitenverhältnis
 * in einer Zelle würde die Reihe brechen. Beschriftet wird deshalb sparsam: 4 / 2 / 1 und die drei
 * Eckwerte der x-Achse.
 */
function avesmapsTmcFactorChart(factorFor) {
	function py(f) { return AVESMAPS_TMC_Y1 - ((f - 1) / 3) * (AVESMAPS_TMC_Y1 - AVESMAPS_TMC_Y0); }
	var edge = avesmapsTmcX(-20);
	var top = py(factorFor(-20.001));
	return '<div class="wp-chart wp-chart--factor">'
		+ '<div class="wp-chart__title"><b>Zeitfaktor</b> · die Grundlage aller Bilder daneben</div>'
		+ '<svg viewBox="0 0 240 118" role="img" aria-label="Zeitfaktor über der Neigung">'
		+ '<line class="wp-grid" x1="' + AVESMAPS_TMC_X0 + '" y1="' + py(4) + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + py(4) + '"></line>'
		+ '<line class="wp-grid" x1="' + AVESMAPS_TMC_X0 + '" y1="' + py(2) + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + py(2) + '"></line>'
		+ '<line class="wp-cap" x1="' + avesmapsTmcX(0).toFixed(1) + '" y1="' + AVESMAPS_TMC_Y0 + '" x2="' + avesmapsTmcX(0).toFixed(1) + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
		// Gefälle: Gerade von −45 % bis zur Schwelle
		+ '<polyline class="wp-line wp-line--1" points="' + avesmapsTmcX(-45).toFixed(1) + "," + py(factorFor(-45)).toFixed(1)
		+ " " + edge.toFixed(1) + "," + top.toFixed(1) + '"></polyline>'
		// 💣 Die Kante bei 20 % Gefälle ist ein echter SPRUNG, keine Rampe -- die Schwelle
		// entscheidet je Abtastschritt, und darüber zählt der ganze Abstieg des Schritts.
		+ '<line class="wp-edge" x1="' + edge.toFixed(1) + '" y1="' + top.toFixed(1)
		+ '" x2="' + edge.toFixed(1) + '" y2="' + py(1).toFixed(1) + '"></line>'
		// Flach bis 0, dann Steigung bis zum Deckel
		+ '<polyline class="wp-line wp-line--1" points="' + edge.toFixed(1) + "," + py(1).toFixed(1)
		+ " " + avesmapsTmcX(0).toFixed(1) + "," + py(1).toFixed(1)
		+ " " + avesmapsTmcX(30).toFixed(1) + "," + py(4).toFixed(1)
		+ " " + avesmapsTmcX(45).toFixed(1) + "," + py(4).toFixed(1) + '"></polyline>'
		+ '<line class="wp-axis" x1="' + AVESMAPS_TMC_X0 + '" y1="' + AVESMAPS_TMC_Y1 + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
		+ '<line class="wp-axis" x1="' + AVESMAPS_TMC_X0 + '" y1="' + AVESMAPS_TMC_Y0 + '" x2="' + AVESMAPS_TMC_X0 + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
		+ '<text class="wp-tick" x="16" y="' + (py(4) + 3).toFixed(1) + '">4</text>'
		+ '<text class="wp-tick" x="16" y="' + (py(2) + 3).toFixed(1) + '">2</text>'
		+ '<text class="wp-tick" x="16" y="' + AVESMAPS_TMC_BASE_TICK_Y + '">1</text>'
		+ '<text class="wp-tick" x="20" y="112">−45</text>'
		+ '<text class="wp-tick" x="' + (avesmapsTmcX(0) - 4).toFixed(1) + '" y="112">0</text>'
		+ '<text class="wp-tick" x="212" y="112">+45</text>'
		+ '<text class="wp-note" x="' + (edge + 3).toFixed(1) + '" y="' + (py(1) - 4).toFixed(1) + '">Kante 20 %</text>'
		+ '<text class="wp-axis-label" x="' + AVESMAPS_TMC_X0 + '" y="' + AVESMAPS_TMC_LABEL_Y + '">Faktor</text>'
		+ "</svg></div>";
}

/**
 * Zeichnet die acht Kacheln in einen Wirt und verdrahtet die Transportmittel-Auswahl.
 *
 * @param {HTMLElement} host Zielknoten; sein Inhalt wird ersetzt
 * @param {object} [options]
 * @param {object} [options.speeds] Geschwindigkeitstabelle (Vorgabe: WP_SPEEDS)
 * @param {string[]} [options.series] anfangs gewählte Transportmittel
 * @param {function} [options.onSeriesChange] bekommt die neue Auswahl -- der Wege-Editor merkt sie
 *        sich damit über ein Neuzeichnen hinweg (nach einem Kalibrierlauf baut er den Dialog neu)
 */
function avesmapsRenderTravelModelCurves(host, options) {
	if (!host) {
		return;
	}
	var settings = options || {};
	var speeds = settings.speeds || (typeof WP_SPEEDS !== "undefined" ? WP_SPEEDS : null);
	var landTypes = typeof WP_LAND_TYPES !== "undefined" ? WP_LAND_TYPES : null;
	var maxSeries = typeof WP_MAX_SERIES !== "undefined" ? WP_MAX_SERIES : 4;
	var factorFor = typeof wpFactorForGradientPercent === "function" ? wpFactorForGradientPercent : null;
	if (!speeds || !landTypes || !factorFor) {
		// Ohne das Modell wird nichts gezeichnet -- lieber gar kein Bild als ein erfundenes.
		host.innerHTML = "";
		return;
	}

	var series = (settings.series || ["lightRider", "horseCarriage", "lightWalker"]).filter(function (key) {
		return Object.prototype.hasOwnProperty.call(speeds, key);
	});

	host.innerHTML = '<div class="wp-controls" data-tmc-controls><span class="wp-controls__label">Transportmittel</span></div>'
		+ '<div class="wp-controls__note" data-tmc-note role="status" aria-live="polite" hidden></div>'
		+ '<div class="wp-legend" data-tmc-legend></div>'
		+ '<div class="wp-small" data-tmc-small></div>'
		+ '<p class="wp-fnnote">⚠️ <b>Alle sieben Geschwindigkeitsbilder haben dieselbe Form</b> — das ist die Aussage, '
		+ "nicht ein Zeichenfehler: der Zeitfaktor kennt heute <b>kein Transportmittel</b>, nur Land "
		+ "gegen Wasser. Eine Kutsche und ein Fußgänger bekommen bei 30 % Steigung beide den Faktor "
		+ "4,0; unterschiedlich ist allein die Grundgeschwindigkeit, also die Höhe der Kurve. Die "
		+ "<b>achte Kachel</b> zeigt genau diesen gemeinsamen Faktor.<br>"
		+ "<b>Fluss- und Seewege fehlen mit Absicht:</b> für sie gilt der Steigungsfaktor gar nicht.</p>"
		+ '<p class="wp-fnnote">Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg über 20 % Gefälle/150; Faktor = '
		+ "Leistungsmeilen ÷ Meilen. Deckel 4,0, kein Boden — das Modell addiert nur nicht-negative "
		+ "Terme, unter 1,0 kann es nicht fallen. Die senkrechte rote Linie bei −20 % ist ein "
		+ "<b>echter Sprung</b>: die Schwelle entscheidet je Abtastschritt, und darüber zählt der "
		+ "ganze Abstieg des Schritts.</p>";

	var controls = host.querySelector("[data-tmc-controls]");
	var note = host.querySelector("[data-tmc-note]");
	var legend = host.querySelector("[data-tmc-legend]");
	var small = host.querySelector("[data-tmc-small]");

	function showNote(text) {
		note.textContent = text;
		note.hidden = text === "";
	}

	function draw() {
		legend.innerHTML = series.map(function (key, index) {
			return '<span><svg viewBox="0 0 22 8" aria-hidden="true"><line class="' + avesmapsTmcSeriesLine(index)
				+ '" x1="1" y1="4" x2="21" y2="4"></line></svg>' + avesmapsTmcEscape(speeds[key].label) + "</span>";
		}).join("");

		// −20 kommt ZWEIMAL vor: die Kante an der Gefälleschwelle ist echt und darf nicht
		// weggeglättet werden.
		var stops = [-45, -35, -25, -20.001, -20, -10, 0, 5, 10, 15, 20, 25, 30, 37, 45];

		var pictures = landTypes.map(function (type) {
			var lines = series.map(function (key, index) {
				var v0 = speeds[key][type.key];
				var points = stops.map(function (s) {
					return avesmapsTmcX(s).toFixed(1) + "," + avesmapsTmcY(v0 / factorFor(s)).toFixed(1);
				}).join(" ");
				return '<polyline class="' + avesmapsTmcSeriesLine(index) + '" points="' + points + '"></polyline>';
			}).join("");
			var level = series.map(function (key) {
				return avesmapsTmcNumber(speeds[key][type.key], 1);
			}).join(" · ");
			return '<div class="wp-chart"><div class="wp-chart__title"><b>' + avesmapsTmcEscape(type.label)
				+ "</b> · eben " + level + " Meilen/h</div>"
				+ '<svg viewBox="0 0 240 118" role="img" aria-label="Meilen pro Stunde über der Neigung, '
				+ avesmapsTmcEscape(type.label) + '">'
				+ '<line class="wp-grid" x1="' + AVESMAPS_TMC_X0 + '" y1="' + avesmapsTmcY(8) + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + avesmapsTmcY(8) + '"></line>'
				+ '<line class="wp-grid" x1="' + AVESMAPS_TMC_X0 + '" y1="' + avesmapsTmcY(4) + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + avesmapsTmcY(4) + '"></line>'
				+ '<line class="wp-cap" x1="' + avesmapsTmcX(0).toFixed(1) + '" y1="' + AVESMAPS_TMC_Y0 + '" x2="' + avesmapsTmcX(0).toFixed(1) + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
				+ lines
				+ '<line class="wp-axis" x1="' + AVESMAPS_TMC_X0 + '" y1="' + AVESMAPS_TMC_Y1 + '" x2="' + AVESMAPS_TMC_X1 + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
				+ '<line class="wp-axis" x1="' + AVESMAPS_TMC_X0 + '" y1="' + AVESMAPS_TMC_Y0 + '" x2="' + AVESMAPS_TMC_X0 + '" y2="' + AVESMAPS_TMC_Y1 + '"></line>'
				+ '<text class="wp-tick" x="16" y="' + (avesmapsTmcY(8) + 3) + '">8</text>'
				+ '<text class="wp-tick" x="16" y="' + (avesmapsTmcY(4) + 3) + '">4</text>'
				+ '<text class="wp-tick" x="16" y="' + AVESMAPS_TMC_BASE_TICK_Y + '">0</text>'
				+ '<text class="wp-tick" x="20" y="112">−45</text>'
				+ '<text class="wp-tick" x="' + (avesmapsTmcX(0) - 4).toFixed(1) + '" y="112">0</text>'
				+ '<text class="wp-tick" x="212" y="112">+45</text>'
				+ '<text class="wp-axis-label" x="' + AVESMAPS_TMC_X0 + '" y="' + AVESMAPS_TMC_LABEL_Y + '">Meilen/h</text>'
				+ "</svg></div>";
		});

		// Die achte Kachel: sieben Wegtypen + der Faktor selbst füllen das 4er-Raster genau aus.
		pictures.push(avesmapsTmcFactorChart(factorFor));
		small.innerHTML = pictures.join("");
	}

	Object.keys(speeds).forEach(function (key) {
		var label = document.createElement("label");
		var input = document.createElement("input");
		input.type = "checkbox";
		input.value = key;
		input.checked = series.indexOf(key) !== -1;
		input.addEventListener("change", function () {
			var chosen = Array.prototype.slice
				.call(controls.querySelectorAll("input:checked"))
				.map(function (i) { return i.value; });
			if (chosen.length > maxSeries) {
				input.checked = false;
				showNote("Vier Reihen sind das Maximum — eine fünfte bekäme keinen eigenen Farbton, "
					+ "sondern einen erfundenen. Erst eine abwählen.");
				return;
			}
			showNote("");
			series = chosen;
			if (typeof settings.onSeriesChange === "function") {
				settings.onSeriesChange(chosen.slice());
			}
			draw();
		});
		label.appendChild(input);
		label.appendChild(document.createTextNode(" " + speeds[key].label));
		controls.appendChild(label);
	});

	draw();
}

// Node-Export (im Browser wirkungslos).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsTmcX: avesmapsTmcX,
		avesmapsTmcY: avesmapsTmcY,
		avesmapsTmcFactorChart: avesmapsTmcFactorChart,
		avesmapsRenderTravelModelCurves: avesmapsRenderTravelModelCurves,
	};
}
