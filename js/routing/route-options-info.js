/*
 * Info-Dialog „Reiseoptionen": ein ⓘ-Knopf neben der Ueberschrift der Optionsgruppe im
 * Routenplaner erklaert, was die fuenf Einstellungen tun -- und zwar so, wie sie gerechnet
 * sind. Reines Frontend, oeffentlich, kein Editmodus. Schwester von transport-speed-info.js:
 * dieselbe Huelle (.tsi-overlay/.tsi-dialog/.tsi-wcard), eigener Inhalt.
 *
 * ⭐ KEINE ZAHL STEHT HIER ALS TEXT. Geschwindigkeiten kommen aus SPEED_TABLE, der Aufschlag
 * fuers Umsteigen aus TRANSFER_PENALTY, die Bodentabelle aus SEASON_GROUND_TABLE samt ihren
 * Abzuegen, die Preise aus TRAVEL_COST_LODGING, die Reisestunden-Vorgabe aus
 * DEFAULT_PLANNER_STATE. Damit kann der Dialog nicht veralten, wenn jemand eine Zahl aendert --
 * genau wie die Matrix im Tempo-Dialog.
 *
 * 💣 DER EDITOR-HAKEN „GESCHWINDIGKEIT" WIRD BEWUSST NICHT ERKLAERT. Er existiert
 * (js/routing/route-speed-arrows.js), aber map-features.js blendet ihn nur im Editmodus ein;
 * ein oeffentlicher Dialog, der ihn beschreibt, erklaert etwas, das der Leser nicht hat.
 *
 * 💣 Das Markup entsteht beim ERSTEN OEFFNEN, nicht beim Laden. Diese Datei liest ein Dutzend
 * Tabellen aus anderen Dateien; zur Ladezeit waere jede davon eine Frage der Reihenfolge in
 * index.html, zur Klickzeit ist keine davon eine.
 */

/* Klimazonen von Nord nach Sued, benachbarte Zeilen mit gleichem Jahreslauf zusammengefasst.
 *
 * ⭐ Das ist keine Kosmetik, sondern die Aussage: „Subpolar und Boreal verhalten sich gleich"
 * ist genau das, was der Leser wissen will, und sieben Zeilen mit vier Wiederholungen sagen es
 * schlechter als fuenf. Zusammengefasst wird NUR, was aneinandergrenzt -- die Reihenfolge ist
 * die Erdkunde und darf nicht umsortiert werden, um mehr zusammenlegen zu koennen.
 *
 * 💣 DIE ZEILEN KOMMEN AUS DER KARTE, DIE WERTE AUS DER BODENTABELLE. Beide Listen sind
 * verschieden lang: die Landschaften-Ebene fuehrt heute acht Klimazonen, SEASON_GROUND_TABLE
 * sieben -- „trockene_subtropen" wurde am 2026-08-03 eingeschoben und dort nie nachgetragen.
 * Wer die Zeilen aus der Bodentabelle nimmt, druckt eine Tabelle, in der eine Zone der Karte
 * fehlt, ohne dass es auffaellt. Umgekehrt ist die fehlende Zeile eine Reihe Bindestriche --
 * und das ist die Wahrheit: dort wirkt kein Bodenabzug.
 *
 * Rein und ohne DOM, damit es geprueft werden kann (__tests__/route-options-info.test.js).
 *
 * @param {object} table SEASON_GROUND_TABLE
 * @param {string[]} [zoneOrder] Zonen der Karte; fehlt sie, gelten die der Bodentabelle
 * @returns {Array<{zoneKeys: string[], seasons: object}>}
 */
function avesmapsRouteOptionsClimateRows(table, zoneOrder) {
	var rows = [];
	var keys = Array.isArray(zoneOrder) && zoneOrder.length ? zoneOrder : Object.keys(table || {});

	// Die Jahreszeiten, die in der Bodentabelle ueberhaupt vorkommen -- Grundlage der Signatur.
	var seasonKeys = [];
	Object.keys(table || {}).forEach(function (zoneKey) {
		Object.keys(table[zoneKey] || {}).forEach(function (season) {
			if (seasonKeys.indexOf(season) === -1) {
				seasonKeys.push(season);
			}
		});
	});

	keys.forEach(function (zoneKey) {
		var seasons = (table && table[zoneKey]) || {};
		// 💣 Verglichen wird, was in der ZEILE STEHT, nicht wie das Objekt gebaut ist. Eine Zone
		// ganz ohne Eintrag und eine mit vier leeren Jahreszeiten sind zwei verschiedene Objekte
		// und dasselbe Ergebnis: kein Bodenabzug. Ueber JSON.stringify verglichen stuenden sie als
		// zwei Zeilen aus lauter Bindestrichen untereinander -- fuer den Leser ein Fehler in der
		// Tabelle, und keiner haette ihm sagen koennen, worin sie sich unterscheiden.
		var signature = seasonKeys.map(function (season) {
			return String(seasons[season] || "");
		}).join("|");
		var previous = rows[rows.length - 1];
		if (previous && previous.signature === signature) {
			previous.zoneKeys.push(zoneKey);
			return;
		}
		rows.push({ zoneKeys: [zoneKey], seasons: seasons, signature: signature });
	});
	return rows.map(function (row) {
		return { zoneKeys: row.zoneKeys, seasons: row.seasons };
	});
}

/* „subtropen_winterfeucht" -> „Subtropen winterfeucht". Nur der Rueckfall: den echten Namen
 * kennt avesmapsClimateZoneLabel() aus dem Kartenpayload. Der greift, solange die Karte noch
 * nicht geladen ist -- und zeigt dann den Schluessel lesbar an, statt ihn zu erfinden. */
function avesmapsRouteOptionsZoneFallbackLabel(zoneKey) {
	var text = String(zoneKey || "").replace(/_/g, " ").trim();
	return text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1);
}

(function () {
	"use strict";

	if (typeof document === "undefined") {
		return;
	}

	var SEASON_KEYS_FALLBACK = ["winter", "fruehling", "sommer", "herbst"];

	/* 💣 JEDER ZUGRIFF AUF EINE FREMDE TABELLE LAEUFT HIER DURCH -- und zwar mit try/catch, nicht
	   mit `typeof X !== "undefined"`. Der naheliegende typeof-Test schuetzt gegen eine FEHLENDE
	   Deklaration, aber nicht gegen eine, die es gibt und die noch nicht dran war: bei `const` in
	   der temporalen Todeszone WIRFT typeof selbst. Genau so gesehen am 2026-08-03 -- config.js
	   brach vorzeitig ab, `DEFAULT_PLANNER_STATE` (Zeile 624) lag in der Todeszone, und der
	   gesamte Dialog blieb leer, obwohl ihm nur eine einzige Zahl fehlte.
	   Ein Dialog, der ERKLAERT, darf nie an dem sterben, was er beschreibt. */
	function readGlobal(reader, fallback) {
		try {
			var value = reader();
			return value === undefined || value === null ? fallback : value;
		} catch (error) {
			return fallback;
		}
	}

	function tx(key, germanDefault, params) {
		return typeof window.tr === "function" ? window.tr(key, germanDefault, params) : germanDefault;
	}

	/* 💣 EINE REGEL, DURCHGEHEND: `tx()` liefert kuratiertes Markup und wird NIE escaped -- die
	   Saetze tragen absichtlich <b> und <br>. Alles, was aus DATEN kommt (Zonenname aus dem
	   Kartenpayload, Geldbetrag, Wegart), laeuft durch esc(). Wer beides vermischt, escapt
	   entweder sein eigenes Markup weg oder haengt Serverdaten ungefiltert ins Dokument. */
	function esc(value) {
		return String(value === null || value === undefined ? "" : value)
			.replace(/[&<>"]/g, function (character) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
			});
	}

	function num(value, digits) {
		return typeof window.formatDecimalNumber === "function"
			? window.formatDecimalNumber(value, digits)
			: Number(value).toFixed(digits);
	}

	function money(heller) {
		var format = readGlobal(function () { return formatAventurianMoney; }, null);
		return typeof format === "function" ? format(heller) : String(heller);
	}

	function icon(source) {
		return source ? '<img class="tsi-ic" src="' + esc(source) + '" alt="" loading="lazy" />' : "";
	}

	function pathIcon(key) {
		return readGlobal(function () { return ROUTE_ICON_PATHS; }, {})[key] || "";
	}

	function card(iconSource, title, tagText, tagIsSearch, body) {
		return '<div class="tsi-wcard"><div class="tsi-wtitle">' + icon(iconSource) + title
			+ '<span class="roi-tag' + (tagIsSearch ? " roi-tag--search" : "") + '">' + tagText + "</span></div>"
			+ body + "</div>";
	}

	// --- Zahlen aus den Rechentabellen ---------------------------------------------------

	/** Spanne der Tempi einer Wegart ueber alle Transportmittel, die sie ueberhaupt befahren. */
	function speedRange(pathKey) {
		var table = readGlobal(function () { return SPEED_TABLE; }, {});
		var values = Object.keys(table)
			.map(function (mode) { return Number(table[mode] && table[mode][pathKey]); })
			.filter(function (value) { return Number.isFinite(value) && value > 0; });
		if (!values.length) {
			return null;
		}
		return { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
	}

	function transferPenalty() {
		return readGlobal(function () { return TRANSFER_PENALTY; }, 100);
	}

	function defaultTravelHours() {
		var rest = Number(readGlobal(function () { return DEFAULT_PLANNER_STATE.restHours; }, 12));
		return 24 - (Number.isFinite(rest) ? rest : 12);
	}

	// --- Die einzelnen Karten -------------------------------------------------------------

	function optimizeCard() {
		var pass = speedRange("Gebirgspass");
		var road = speedRange("Reichsstrasse");
		var comparison = pass && road
			? tx("planner.optionsInfo.optimize.example",
				" Kürzer heißt darum oft langsamer: Gebirgspass {passMin}–{passMax} Meilen/h, Reichsstraße bis {roadMax}.", {
					passMin: num(pass.min, 2),
					passMax: num(pass.max, 2),
					roadMax: num(road.max, 2),
				})
			: "";
		return card("icons/compass.webp",
			tx("planner.optionsInfo.optimize.title", "Schnellste · Kürzeste"),
			tx("planner.optionsInfo.tag.search", "sucht neu"), true,
			'<p class="roi-text">' + tx("planner.optionsInfo.optimize.body",
				"Gleicher Wegegraph, gleiches Verfahren — anderes Kantengewicht: <b>Stunden</b> gegen <b>Meilen</b>.")
			+ comparison + "</p>");
	}

	function transfersCard() {
		return card("icons/waypoint.webp",
			tx("planner.optionsInfo.transfers.title", "Umsteigen minimieren"),
			tx("planner.optionsInfo.tag.search", "sucht neu"), true,
			'<p class="roi-text">' + tx("planner.optionsInfo.transfers.body",
				"Jeder Wechsel des Transportmittels kostet <b>+{penalty}</b> im Suchgewicht — {penalty} Stunden bei „Schnellste“, {penalty} Meilen bei „Kürzeste“.",
				{ penalty: num(transferPenalty(), 0) }) + "</p>"
			+ '<p class="roi-text">' + tx("planner.optionsInfo.transfers.note",
				"<b>Ein Suchgewicht, keine Wartezeit:</b> es lenkt die Suche und steht in keiner angezeigten Zahl.") + "</p>");
	}

	function lodgingCard() {
		var keys = readGlobal(function () { return TRAVEL_COST_LODGING_KEYS; }, []);
		var table = readGlobal(function () { return TRAVEL_COST_LODGING; }, {});
		var labels = readGlobal(function () { return TRAVEL_COST_LODGING_LABEL_DE; }, {});
		var upstream = readGlobal(function () { return TRAVEL_COST_RIVER_UPSTREAM_FACTOR; }, 3);

		var head = "<thead><tr><th>" + tx("planner.optionsInfo.lodging.level", "Stufe") + "</th>"
			+ "<th>" + tx("planner.optionsInfo.lodging.bed", "Bett") + "</th>"
			+ "<th>" + tx("planner.optionsInfo.lodging.food", "Essen") + "</th>"
			+ "<th>" + tx("planner.optionsInfo.lodging.stable", "Stall") + "</th>"
			+ "<th>" + tx("planner.optionsInfo.lodging.toll", "Zoll") + "</th>"
			+ "<th>" + tx("planner.optionsInfo.lodging.river", "Fluss<br>/100 M.") + "</th></tr></thead>";

		var body = keys.map(function (key) {
			var row = table[key] || {};
			// Wer im Freien schlaeft, zahlt keinen Stall, sondern Futter je Woche -- dieselbe Spalte,
			// eine andere Rechnung (route-costs.js). Das steht in der Zelle, nicht in einer Fussnote.
			var stable = row.stableNight !== null && row.stableNight !== undefined
				? esc(money(row.stableNight))
				: tx("planner.optionsInfo.lodging.perWeek", "{money}/Wo.", { money: esc(money(row.feedPerWeek)) });
			return "<tr><td>" + tx("planner.cost.lodging." + key, labels[key] || key) + "</td>"
				+ "<td>" + esc(money(row.bed)) + "</td>"
				+ "<td>" + esc(money(row.food)) + "</td>"
				+ "<td>" + stable + "</td>"
				+ "<td>" + esc(money(row.tollPerson)) + "</td>"
				+ "<td>" + esc(money(row.riverPer100)) + "</td></tr>";
		}).join("");

		return card("icons/dorf.webp",
			tx("planner.optionsInfo.lodging.title", "Unterbringung"),
			tx("planner.optionsInfo.tag.costs", "kostet"), false,
			'<p class="roi-text">' + tx("planner.optionsInfo.lodging.body",
				"Kostet keinen Meter Weg, sondern Geld — je Person:") + "</p>"
			+ '<div class="roi-scroll"><table class="roi-table">' + head + "<tbody>" + body + "</tbody></table></div>"
			+ '<p class="roi-text">' + tx("planner.optionsInfo.lodging.note",
				"Der Zöllner schätzt nach dem Auftreten, stromauf kostet die Passage das {factor}-fache. <b>Ein Dach gibt nur die Wegart her</b> — Reichsstraße und Straße; auf Pfad, Pass, Wüstenpfad und querfeldein wird immer im Freien geschlafen.",
				{ factor: num(upstream, 0) }) + "</p>");
	}

	function restCard() {
		var hours = defaultTravelHours();
		return card("icons/Rast.webp",
			tx("planner.optionsInfo.rest.title", "Reisestunden pro Tag"),
			tx("planner.optionsInfo.tag.computes", "rechnet"), false,
			'<p class="roi-text">' + tx("planner.optionsInfo.rest.body",
				"Der Rest des Tages ist Rast, und die Rast wächst mit: <b>Tage = Reisezeit ÷ Reisestunden</b>, <b>Dauer = Tage × 24 h</b>. Die voreingestellten {hours} h strecken die reine Reisezeit damit auf das {factor}-fache, 24 heißt durchreisen.",
				{ hours: num(hours, 0), factor: num(24 / hours, 1) }) + "</p>"
			+ '<p class="roi-text">' + tx("planner.optionsInfo.rest.note",
				"<b>Nur der Schnellsegler fährt durch</b> — Lastensegler und Galeere ankern nachts und rasten wie an Land.") + "</p>");
	}

	function climateTable() {
		var table = readGlobal(function () { return SEASON_GROUND_TABLE; }, null);
		if (!table || !Object.keys(table).length) {
			return "";
		}
		var zoneKeysReader = readGlobal(function () { return avesmapsClimateZoneKeys; }, null);
		var zoneOrder = typeof zoneKeysReader === "function" ? zoneKeysReader() : [];
		var rows = avesmapsRouteOptionsClimateRows(table, zoneOrder);
		if (!rows.length) {
			return "";
		}
		// Die Jahreszeiten in der Reihenfolge der DATEN, nicht in einer eigenen Liste hier. Die erste
		// Zeile kann eine Zone der Karte ohne Bodeneintrag sein -- dann traegt sie keine Jahreszeiten,
		// und die Reihenfolge kommt aus der Bodentabelle selbst.
		var firstZone = rows[0].seasons || {};
		if (!Object.keys(firstZone).length) {
			firstZone = table[Object.keys(table)[0]] || {};
		}
		var seasonKeys = Object.keys(firstZone).length ? Object.keys(firstZone) : SEASON_KEYS_FALLBACK;
		var seasonLabels = {
			winter: tx("planner.season.winter", "Winter"),
			fruehling: tx("planner.season.spring", "Frühling"),
			sommer: tx("planner.season.summer", "Sommer"),
			herbst: tx("planner.season.autumn", "Herbst"),
		};
		var groundLabels = readGlobal(function () { return ROUTE_PLAN_GROUND_LABELS; }, {});

		var head = "<thead><tr><th>" + tx("planner.optionsInfo.start.zone", "Klimazone") + "</th>"
			+ seasonKeys.map(function (season) {
				return "<th>" + (seasonLabels[season] || esc(season)) + "</th>";
			}).join("") + "</tr></thead>";

		var body = rows.map(function (row) {
			var labelReader = readGlobal(function () { return avesmapsClimateZoneLabel; }, null);
			var names = row.zoneKeys.map(function (zoneKey) {
				var label = typeof labelReader === "function" ? labelReader(zoneKey) : "";
				return label || avesmapsRouteOptionsZoneFallbackLabel(zoneKey);
			}).join(", ");
			var cells = seasonKeys.map(function (season) {
				var condition = row.seasons[season] || "";
				if (!condition || !groundLabels[condition]) {
					return '<td class="roi-none">–</td>';
				}
				return "<td>" + tx(groundLabels[condition][0], groundLabels[condition][1]) + "</td>";
			}).join("");
			return "<tr><td>" + esc(names) + "</td>" + cells + "</tr>";
		}).join("");

		return '<div class="roi-scroll"><table class="roi-table">' + head + "<tbody>" + body + "</tbody></table></div>";
	}

	/* „ein Weg (0,8) verliert bei Tiefschnee 25 % Tempo" -- beide Beispiele aus den echten
	   Tabellen gerechnet, damit sie stimmen, wenn jemand einen Abzug oder einen Gelaendewert
	   anfasst. Ohne die Tabellen faellt der Satz ganz weg. */
	function groundPenaltySentence() {
		var conditions = readGlobal(function () { return SEASON_GROUND_CONDITIONS; }, null);
		var factors = readGlobal(function () { return SEASON_GROUND_PATH_FACTORS; }, null);
		if (!conditions || !factors || !Object.keys(conditions).length) {
			return "";
		}
		var penalties = Object.keys(conditions).map(function (key) { return conditions[key].penalty; });
		var soft = Math.min.apply(null, penalties);
		var hard = Math.max.apply(null, penalties);
		var lossPercent = function (pathKey) {
			var base = Number(factors[pathKey]);
			if (!Number.isFinite(base) || base <= 0) {
				return null;
			}
			var floor = readGlobal(function () { return SEASON_GROUND_FLOOR; }, 0.05);
			return (1 - Math.max(floor, base - hard) / base) * 100;
		};
		var wayLoss = lossPercent("Weg");
		var passLoss = lossPercent("Gebirgspass");
		var example = wayLoss !== null && passLoss !== null
			? tx("planner.optionsInfo.start.example",
				" Ein Weg ({wayFactor}) verliert bei Tiefschnee {wayLoss} % Tempo, ein Gebirgspass ({passFactor}) {passLoss} %.", {
					wayFactor: num(factors.Weg, 1),
					wayLoss: num(wayLoss, 0),
					passFactor: num(factors.Gebirgspass, 1),
					passLoss: num(passLoss, 0),
				})
			: "";
		return '<p class="roi-text">' + tx("planner.optionsInfo.start.penalty",
			"Abzug vom Geländewert der Wegart: <b>−{soft}</b> feucht, <b>−{hard}</b> Schnee und Eis.", {
				soft: num(soft, 1),
				hard: num(hard, 1),
			}) + example + " "
			+ tx("planner.optionsInfo.start.exempt",
				"Straßen sind nur bei Nässe ausgenommen, Wasser immer.") + "</p>";
	}

	function startCard() {
		return card("icons/federundpapier.webp",
			tx("planner.optionsInfo.start.title", "Reisebeginn"),
			tx("planner.optionsInfo.tag.computes", "rechnet"), false,
			'<p class="roi-text">' + tx("planner.optionsInfo.start.body",
				"Der Kalender läuft mit — Etappendatum und Ankunftstag. Und die Jahreszeit greift auf den Boden:") + "</p>"
			+ climateTable()
			+ groundPenaltySentence()
			+ '<p class="roi-text">' + tx("planner.optionsInfo.start.note",
				"<b>Die Wegsuche kennt die Jahreszeit nicht:</b> Schnee bremst die Etappe, schickt dich aber nicht außen herum.") + "</p>");
	}

	function dialogHtml() {
		return '<div class="tsi-dialog roi-dialog" role="dialog" aria-modal="true" aria-labelledby="roi-title">'
			+ '<div class="tsi-head"><span class="tsi-i" aria-hidden="true">ⓘ</span>'
			+ '<h2 id="roi-title">' + tx("planner.optionsInfo.title", "Reiseoptionen") + "</h2>"
			+ '<button type="button" class="tsi-close" aria-label="' + esc(tx("planner.optionsInfo.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<div class="tsi-body">'
			+ '<p class="tsi-intro">' + tx("planner.optionsInfo.intro",
				"Was <b>sucht neu</b> trägt, ändert den Weg selbst. Alles Übrige ändert nur, wie die gefundene Route gerechnet und gezeichnet wird.") + "</p>"
			+ '<div class="roi-grid">'
			+ '<div class="roi-col">' + optimizeCard() + transfersCard() + lodgingCard() + "</div>"
			+ '<div class="roi-col">' + restCard() + startCard()
			+ '<div class="roi-foot">' + icon(pathIcon("Reichsstrasse")) + "<div>"
			+ tx("planner.optionsInfo.foot", "Wie schnell eine Wegart mit welchem Fahrzeug ist, steht im ⓘ neben „Transportmittel“.")
			+ "</div></div></div>"
			+ "</div></div></div>";
	}

	// --- Fenster ---------------------------------------------------------------------------

	var overlay = null;
	var lastFocus = null;

	function onKey(event) {
		if (event.key === "Escape") {
			close();
		}
	}

	function close() {
		if (!overlay) {
			return;
		}
		overlay.hidden = true;
		document.removeEventListener("keydown", onKey);
		if (lastFocus && typeof lastFocus.focus === "function") {
			lastFocus.focus();
		}
	}

	// 💣 `overlay` wird erst gesetzt, wenn der Knoten FERTIG UND im Dokument ist. Vorher stand die
	// Zuweisung am Anfang -- warf dialogHtml() dann, blieb ein halbfertiges Overlay in der Variablen
	// haengen, das nie angehaengt wurde, und jeder weitere Klick auf den ⓘ lief in den
	// „gibt's schon"-Zweig und tat sichtbar nichts. Ein Fehler beim ersten Oeffnen darf den Knopf
	// nicht fuer den Rest der Sitzung stilllegen.
	function open() {
		if (!overlay) {
			var node = document.createElement("div");
			node.className = "tsi-overlay";
			node.innerHTML = dialogHtml();
			node.addEventListener("click", function (event) {
				if (event.target === node) {
					close();
				}
			});
			var closeButton = node.querySelector(".tsi-close");
			if (closeButton) {
				closeButton.addEventListener("click", close);
			}
			document.body.appendChild(node);
			overlay = node;
		}
		lastFocus = document.activeElement;
		overlay.hidden = false;
		document.addEventListener("keydown", onKey);
		var focusTarget = overlay.querySelector(".tsi-close");
		if (focusTarget) {
			focusTarget.focus();
		}
	}

	window.avesmapsOpenRouteOptionsInfo = open;
})();

// Node-Export (im Browser wirkungslos).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsRouteOptionsClimateRows: avesmapsRouteOptionsClimateRows,
		avesmapsRouteOptionsZoneFallbackLabel: avesmapsRouteOptionsZoneFallbackLabel,
	};
}
