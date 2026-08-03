// Info-Dialog "Transportmittel" (hiess bis 2026-08-03 "Reisegeschwindigkeiten und Wegtypen"):
// ein i-Button neben der Transportmittel-Ueberschrift
// im Routenplaner oeffnet eine Tabelle aller Geschwindigkeiten je Transportmittel x Wegtyp. Reines
// Frontend (kein Editmodus, oeffentlich). Alle Zahlen + Icons kommen LIVE aus config.js (SPEED_TABLE,
// TRANSPORT_ICON_PATHS, ROUTE_ICON_PATHS) -> der Dialog bleibt automatisch synchron mit dem Routing.
// Der versteckte TIME_SCALE_FACTOR wird bewusst NICHT gezeigt (interner Hebel; liegt im Routing auf der Zeit).
(function () {
	if (typeof document === "undefined" || typeof SPEED_TABLE === "undefined") {
		return;
	}

	const LAND_MODES = [
		{ key: "caravan", label: tr("transport.speedInfo.mode.caravan", "Karawane") },
		{ key: "groupFoot", label: tr("transport.speedInfo.mode.groupFoot", "Gruppe zu Fuß") },
		{ key: "lightWalker", label: tr("transport.speedInfo.mode.lightWalker", "Zu Fuß leicht") },
		{ key: "horseCarriage", label: tr("transport.speedInfo.mode.horseCarriage", "Kutsche") },
		{ key: "groupHorse", label: tr("transport.speedInfo.mode.groupHorse", "Gruppe beritten") },
		{ key: "lightRider", label: tr("transport.speedInfo.mode.lightRider", "Reiter leicht") },
	];
	const LAND_PATHS = [
		{ key: "Reichsstrasse", label: tr("transport.speedInfo.path.Reichsstrasse", "Reichsstraße") },
		{ key: "Strasse", label: tr("transport.speedInfo.path.Strasse", "Straße") },
		{ key: "Weg", label: tr("transport.speedInfo.path.Weg", "Weg") },
		{ key: "Pfad", label: tr("transport.speedInfo.path.Pfad", "Pfad") },
		{ key: "Gebirgspass", label: tr("transport.speedInfo.path.Gebirgspass", "Gebirgspass") },
		{ key: "Wuestenpfad", label: tr("transport.speedInfo.path.Wuestenpfad", "Wüstenpfad") },
		{ key: "Querfeldein", label: tr("transport.speedInfo.path.Querfeldein", "Querfeldein") },
	];
	const RIVER_MODES = [
		{ key: "riverSailer", label: tr("transport.speedInfo.mode.riverSailer", "Flusssegler") },
		{ key: "riverBarge", label: tr("transport.speedInfo.mode.riverBarge", "Flusskahn") },
	];
	const SEA_MODES = [
		{ key: "cargoShip", label: tr("transport.speedInfo.mode.cargoShip", "Lastensegler") },
		{ key: "fastShip", label: tr("transport.speedInfo.mode.fastShip", "Schnellsegler") },
		{ key: "galley", label: tr("transport.speedInfo.mode.galley", "Galeere") },
	];

	// Styles live in css/features/transport-speed-info.css (loaded via styles.css),
	// NOT injected here. No JS-applied <style> -> no design flash, and the dialog stays
	// on the shared design tokens instead of a private colour set.

	function num(v) {
		return Number(v).toLocaleString("de-DE");
	}
	function esc(s) {
		return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
	}
	function transportIcon(group, key) {
		const root = typeof TRANSPORT_ICON_PATHS !== "undefined" ? TRANSPORT_ICON_PATHS : {};
		return (root[group] && root[group][key]) || "";
	}
	function pathIcon(key) {
		const root = typeof ROUTE_ICON_PATHS !== "undefined" ? ROUTE_ICON_PATHS : {};
		return root[key] || "";
	}
	function iconImg(src) {
		return src ? `<img class="tsi-ic" src="${esc(src)}" alt="" loading="lazy" />` : "";
	}
	function tierClass(v) {
		return v >= 5.5 ? "tsi-fast" : v >= 3 ? "tsi-mid" : "tsi-slow";
	}

	function landTable() {
		let h = '<div class="tsi-scroll"><table class="tsi-matrix"><thead><tr><th class="tsi-corner">' + esc(tr("transport.speedInfo.pathTypeHeader", "Wegtyp")) + "</th>";
		LAND_MODES.forEach((m) => {
			h += `<th><span class="tsi-modehead">${iconImg(transportIcon("landTransport", m.key))}<span>${esc(m.label)}</span></span></th>`;
		});
		h += "</tr></thead><tbody>";
		LAND_PATHS.forEach((p) => {
			h += `<tr><td class="tsi-rowcell"><span class="tsi-rowhead">${iconImg(pathIcon(p.key))}<span>${esc(p.label)}</span></span></td>`;
			LAND_MODES.forEach((m) => {
				const row = SPEED_TABLE[m.key] || {};
				const v = row[p.key];
				h += v != null ? `<td class="${tierClass(v)}">${num(v)}</td>` : '<td class="tsi-na">–</td>';
			});
			h += "</tr>";
		});
		h += "</tbody></table></div>";
		return h;
	}

	function waterModes(modes, group, pathKey) {
		return modes
			.map((m) => {
				const row = SPEED_TABLE[m.key] || {};
				const v = row[pathKey];
				return `<span class="tsi-m">${iconImg(transportIcon(group, m.key))}<span>${esc(m.label)}${v != null ? " " + num(v) : ""}</span></span>`;
			})
			.join('<span class="tsi-dot">·</span>');
	}

	function dialogHtml() {
		return (
			'<div class="tsi-dialog" role="dialog" aria-modal="true" aria-labelledby="tsi-title">' +
			'<div class="tsi-head"><span class="tsi-i" aria-hidden="true">ⓘ</span>' +
			// Heisst seit 2026-08-03 wie die Gruppe, an der der ⓘ haengt (Owner). „Reisegeschwindigkeiten
			// und Wegtypen" beschrieb den Inhalt, nannte aber nicht den Ort -- und daneben steht jetzt ein
			// zweiter Dialog, der „Reiseoptionen" heisst wie SEINE Gruppe.
			'<h2 id="tsi-title">' + esc(tr("transport.speedInfo.title", "Transportmittel")) + "</h2>" +
			'<button type="button" class="tsi-close" aria-label="' + esc(tr("transport.speedInfo.closeAria", "Schließen")) + '">✕</button></div>' +
			'<div class="tsi-body">' +
			'<p class="tsi-intro">' + tr("transport.speedInfo.intro", "Wie schnell du vorankommst, hängt vom gewählten Transportmittel <em>und</em> vom Wegtyp ab. Eine gute Reichsstraße trägt dich doppelt so schnell wie ein Gebirgspfad. Alle Werte in Meilen pro Stunde (1 Meile = 1&nbsp;km).") + "</p>" +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/landweg.webp") + esc(tr("transport.speedInfo.landTravel", "Landreise")) + '</div>' +
			landTable() +
			'<div class="tsi-legend"><span><i class="tsi-fast"></i>' + esc(tr("transport.speedInfo.legend.fast", "schnell")) + '</span><span><i class="tsi-mid"></i>' + esc(tr("transport.speedInfo.legend.mid", "mittel")) + '</span><span><i class="tsi-slow"></i>' + esc(tr("transport.speedInfo.legend.slow", "langsam")) + '</span></div></div>' +
			'<div class="tsi-water">' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/flussweg.webp") + esc(tr("transport.speedInfo.riverTravel", "Flussreise")) + '</div><div class="tsi-wmodes">' +
			waterModes(RIVER_MODES, "riverTransport", "Flussweg") +
			'</div><div class="tsi-wnote">' + tr("transport.speedInfo.riverNote", "Flussabwärts, mit der Strömung, geht es mit voller Geschwindigkeit. Flussaufwärts, gegen die Strömung, dauert dieselbe Strecke länger — in der Regel das 2-fache, bei starker Strömung bis zum 3-fachen der Zeit.") + '</div></div>' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/meerweg.webp") + esc(tr("transport.speedInfo.seaTravel", "Meerreise")) + '</div><div class="tsi-wmodes">' +
			waterModes(SEA_MODES, "seaTransport", "Seeweg") +
			'</div><div class="tsi-wnote">' + tr("transport.speedInfo.seaNote", "Nur der Schnellsegler fährt bei bekannter Strecke Tag und Nacht durch — für ihn fällt keine Rastzeit an. Lastensegler und Galeere gehen nachts vor Anker und rasten wie an Land.") + '</div></div>' +
			"</div>" +
			'<div class="tsi-rules">' +
			'<div class="tsi-rule">' + iconImg("icons/Rast.webp") + "<div>" + tr("transport.speedInfo.restRule", "<b>Rast.</b> Standardmäßig reist du 12 Stunden am Tag und rastest 12 Stunden (im Planer einstellbar). Das gilt an Land, auf Flüssen und auch für Lastensegler und Galeere — <b>nur der Schnellsegler</b> fährt rund um die Uhr.") + "</div></div>" +
			'<div class="tsi-rule">' + iconImg("icons/Querfeldein.webp") + "<div>" + tr("transport.speedInfo.crossCountryRule", "<b>Querfeldein.</b> Fehlt zwischen zwei Orten ein echter Weg, schlägt sich die Route per Luftlinie durchs Gelände. Das ist zäh (1,25–2,5&nbsp;Meilen/h), darum bevorzugt die Berechnung selbst große Umwege über richtige Straßen und Pfade.") + "</div></div>" +
			// V11. Spans both columns (.tsi-rule--wide): it is the longest of the three, and letting it
			// run full width keeps the block at two rows instead of three.
			// ⚠️ Shown unconditionally. It describes the map while `terrain_travel_enabled` is on, and
			// this dialog has no route response to read the switch from -- it can be opened before the
			// first route exists. If terrain is ever switched off for good, this rule comes out.
			//
			// 💣 EVERY „Schritt pro Meile" NUMBER BELOW IS PER **DISPLAYED MILE**, AND A DISPLAYED MILE
			// IS 1.000 SCHRITT — not 3.000. The trap: the server's curve divides by
			// `distance_units * 3000` because ONE MAP UNIT is 3.000 Schritt, and a map unit is
			// DISTANCE_SCALING_FACTOR = **3** displayed miles (config.js:11; the scale bar proves it,
			// ui-controls.js:28 divides by it). So the curve's gradient already IS „Schritt of climb per
			// 1.000 Schritt travelled" — a plain gradient. Reading a map unit as one mile and writing
			// „300 Schritt pro Meile" makes every number here 3x too large, which is exactly what
			// shipped on 2026-07-30 and what a reader called out: 1.500 Schritt of climb per mile is a
			// 150 % slope, i.e. a cliff. The anchor to check any new number against is the sentence's
			// own first example, verified live: the Koschberge leg climbs 668,98 Schritt over 2,799
			// miles = 239 Schritt per mile = a 23,9 % gradient = factor 2,195 = „2 statt 4,5 Meilen/h".
			// factor = 1 + 5 * gradient, so: 100 Schritt/mile -> 1,5 · 200 -> 2,0 · 600 -> the 4,0 cap.
			// Der Knopf haengt HINTER dem Uebersetzungsstring, nicht darin: so bleibt der lange
			// Regeltext ein reiner Satz und die Beschriftung des Knopfes ein eigener Schluessel.
			'<div class="tsi-rule tsi-rule--wide">' + iconImg(pathIcon("Gebirgspass")) + "<div>" + tr("transport.speedInfo.slopeRule", "<b>Steigung.</b> Es zählt die <em>Steilheit in Prozent</em>, nicht der Höhenunterschied. Gerechnet wird in <b>Leistungskilometern</b>, wie es Wanderer für Bergtouren tun: je 100 Schritt Aufstieg kostet eine Meile zusätzlich, je 150 Schritt Abstieg ebenso — Gefälle unter 20 % aber gar nichts (diese Schwelle folgt Langmuirs Zusatz zu Naismiths Wanderregel), und <b>schneller als die Ebene wird es nie</b>. So dauert eine Etappe bei <b>5 % Steigung die Hälfte länger, bei 10 % doppelt so lang, bei 20 % dreifach, ab 30 % vierfach</b> — mehr nicht. Über den Koschberge-Pass (24 %) wird aus einer Reichsstraße rund 1,3 statt 4,5 Meilen/h. Auf Flüssen und Meeren zählt kein Gelände, dort entscheidet die Strömung; wo keine Höhen erfasst sind, allein der Wegtyp. ⚠️ Die 20-%-Schwelle gilt je Teilstück, nicht im Etappenmittel — echtes Gelände ist nicht glatt, eine Etappe kann darum etwas langsamer sein als die Faustregel vermuten lässt.")
			+ ' <button type="button" class="tsi-curveslink" id="tsi-curves-btn">'
			+ esc(tr("transport.speedInfo.curvesButton", "Die Kurven ansehen")) + "</button>"
			+ "</div></div>" +
			"</div>" +
			sourcesLine() +
			"</div></div>"
		);
	}

	/* Woher die Zahlen kommen. Schwester der Quellenzeile im Reiseoptionen-Dialog, gleiche Klassen.
	 *
	 * 💣 DIE STEIGUNGSREGEL IST KEIN DSA-KANON, und das steht ausdruecklich da. Die Geographia sagt
	 * selbst (§9, §27), dass sie weder Grenzsteigung noch eine stetige Kurve hergibt; gerechnet wird
	 * darum nach Naismith/Langmuir, einer Wanderregel fuer Bergtouren. Ohne den Satz liest sich eine
	 * Rechenweise wie eine Regelwerksangabe -- derselbe Fehler, den das Etikett „DIN 33466" hier
	 * schon einmal gemacht hat. */
	function sourcesLine() {
		return '<div class="tsi-sources">'
			+ "<b>" + tr("transport.speedInfo.sources.lead", "Grundlage") + "</b> "
			+ "Geographia Aventurica S. 113–141"
			// 💣 Verlinkt wird der ENGLISCHE Artikel, obwohl die Oberflaeche deutsch ist: einen
			// deutschen „Naismith-Regel" gibt es nicht (404, geprueft 2026-08-03). Der naheliegende
			// Ersatz waere „Marschzeitberechnung" -- und der ist eine FALLE: er rechnet nach
			// DIN 33466, also genau nach dem Etikett, das hier schon einmal faelschlich an dieser
			// Regel klebte. Wir rechnen nicht danach; der Link bliebe eine Verwechslung mit Ansage.
			+ '<div class="tsi-sourcenote">' + tr("transport.speedInfo.sources.note",
				'Tempi, Geländearten, Fluss- und Seereise stehen dort; die Steigungsregel nicht — sie folgt <a href="https://en.wikipedia.org/wiki/Naismith%27s_rule" target="_blank" rel="noopener noreferrer">Naismiths Wanderregel ↗</a> mit <a href="https://en.wikipedia.org/wiki/Naismith%27s_rule#Langmuir_corrections" target="_blank" rel="noopener noreferrer">Langmuirs Zusatz ↗</a>, einer Rechenweise für Bergtouren, weil die Geographia dazu ausdrücklich keine Werte führt.')
			+ "</div></div>";
	}

	let overlay = null;
	let lastFocus = null;
	let curvesOverlay = null;

	// 💣 EIN Escape-Handler fuer ZWEI Fenster. Das Kurvenfenster liegt ueber diesem hier; Escape
	// muss das oberste schliessen und das darunter stehen lassen. Zwei unabhaengige Handler haetten
	// beide zugleich geschlossen -- der Leser waere nach einem Blick auf die Kurven wieder auf der
	// Karte gelandet statt bei der Regel, von der er kam.
	function onKey(e) {
		if (e.key !== "Escape") {
			return;
		}
		if (curvesOverlay && !curvesOverlay.hidden) {
			closeCurves();
			return;
		}
		close();
	}

	/* Das Reisemodell als Kurven -- dasselbe Bild, das der Wege-Editor unter „Funktionen anzeigen"
	 * zeigt, gezeichnet von js/routing/travel-model-curves.js aus js/pages/wege-editor-model.js.
	 *
	 * ⚠️ OHNE den Kalibrierungsteil des Editors: der schreibt ueber alle Wegprofile und ist nichts,
	 * was ein Leser der Karte ausloesen darf (Owner 2026-08-03). Gezeigt wird das Modell, nicht der
	 * Hebel daran.
	 */
	function curvesHtml() {
		return '<div class="tsi-dialog tsi-curves-dialog" role="dialog" aria-modal="true" aria-labelledby="tsi-curves-title">'
			+ '<div class="tsi-head"><span class="tsi-i" aria-hidden="true">ⓘ</span>'
			+ '<h2 id="tsi-curves-title">' + esc(tr("transport.speedInfo.curvesTitle", "Das Reisemodell, wie es gerade rechnet")) + "</h2>"
			+ '<button type="button" class="tsi-close" aria-label="' + esc(tr("transport.speedInfo.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<div class="tsi-body"><div id="tsi-curves-host"></div></div></div>';
	}

	function closeCurves() {
		if (!curvesOverlay) {
			return;
		}
		curvesOverlay.hidden = true;
		const trigger = document.getElementById("tsi-curves-btn");
		if (trigger) {
			trigger.focus();
		}
	}

	function openCurves() {
		if (typeof avesmapsRenderTravelModelCurves !== "function") {
			return;
		}
		if (!curvesOverlay) {
			const node = document.createElement("div");
			node.className = "tsi-overlay tsi-overlay--curves";
			node.innerHTML = curvesHtml();
			node.addEventListener("click", function (event) {
				if (event.target === node) {
					closeCurves();
				}
			});
			const closeButton = node.querySelector(".tsi-close");
			if (closeButton) {
				closeButton.addEventListener("click", closeCurves);
			}
			document.body.appendChild(node);
			curvesOverlay = node;
		}
		curvesOverlay.hidden = false;
		// Bei jedem Oeffnen neu zeichnen: die Auswahl der Reihen soll frisch stehen, und das Bild
		// kostet nichts -- es ist reines SVG aus einer Tabelle, kein Abruf.
		avesmapsRenderTravelModelCurves(curvesOverlay.querySelector("#tsi-curves-host"));
		const focusTarget = curvesOverlay.querySelector(".tsi-close");
		if (focusTarget) {
			focusTarget.focus();
		}
	}

	function close() {
		if (!overlay) {
			return;
		}
		// Das Kurvenfenster liegt darueber und darf nicht allein zurueckbleiben.
		closeCurves();
		overlay.hidden = true;
		document.removeEventListener("keydown", onKey);
		if (lastFocus && typeof lastFocus.focus === "function") {
			lastFocus.focus();
		}
	}

	function open() {
		if (!overlay) {
			overlay = document.createElement("div");
			overlay.className = "tsi-overlay";
			overlay.innerHTML = dialogHtml();
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) {
					close();
				}
			});
			const closeBtn = overlay.querySelector(".tsi-close");
			if (closeBtn) {
				closeBtn.addEventListener("click", close);
			}
			const curvesBtn = overlay.querySelector("#tsi-curves-btn");
			if (curvesBtn) {
				curvesBtn.addEventListener("click", openCurves);
			}
			document.body.appendChild(overlay);
		}
		lastFocus = document.activeElement;
		overlay.hidden = false;
		document.addEventListener("keydown", onKey);
		const c = overlay.querySelector(".tsi-close");
		if (c) {
			c.focus();
		}
	}

	function wire() {
		const btn = document.getElementById("transport-info-btn");
		if (btn) {
			btn.addEventListener("click", open);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", wire);
	} else {
		wire();
	}
	window.avesmapsOpenTransportSpeedInfo = open;
})();
