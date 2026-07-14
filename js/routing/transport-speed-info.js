// Info-Dialog "Reisegeschwindigkeiten und Wegtypen": ein i-Button neben der Transportmittel-Ueberschrift
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
			'<h2 id="tsi-title">' + esc(tr("transport.speedInfo.title", "Reisegeschwindigkeiten und Wegtypen")) + "</h2>" +
			'<button type="button" class="tsi-close" aria-label="' + esc(tr("transport.speedInfo.closeAria", "Schließen")) + '">✕</button></div>' +
			'<div class="tsi-body">' +
			'<p class="tsi-intro">' + tr("transport.speedInfo.intro", "Wie schnell du vorankommst, hängt vom gewählten Transportmittel <em>und</em> vom Wegtyp ab. Eine gute Reichsstraße trägt dich doppelt so schnell wie ein Gebirgspfad. Alle Werte in Meilen pro Stunde (1 Meile = 1&nbsp;km).") + "</p>" +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/landweg.webp") + esc(tr("transport.speedInfo.landTravel", "Landreise")) + '</div>' +
			landTable() +
			'<div class="tsi-legend"><span><i class="tsi-fast"></i>' + esc(tr("transport.speedInfo.legend.fast", "schnell")) + '</span><span><i class="tsi-mid"></i>' + esc(tr("transport.speedInfo.legend.mid", "mittel")) + '</span><span><i class="tsi-slow"></i>' + esc(tr("transport.speedInfo.legend.slow", "langsam")) + '</span></div></div>' +
			'<div class="tsi-water">' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/flussweg.webp") + esc(tr("transport.speedInfo.riverTravel", "Flussreise")) + '</div><div class="tsi-wmodes">' +
			waterModes(RIVER_MODES, "riverTransport", "Flussweg") +
			'</div><div class="tsi-wnote">' + tr("transport.speedInfo.riverNote", "Flussabwärts, mit der Strömung, geht es mit voller Geschwindigkeit. Flussaufwärts, gegen die Strömung, dauert dieselbe Strecke länger — je nach Fluss das 1,5-fache, bei starker Strömung bis zum 3-fachen der Zeit.") + '</div></div>' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">' + iconImg("icons/meerweg.webp") + esc(tr("transport.speedInfo.seaTravel", "Meerreise")) + '</div><div class="tsi-wmodes">' +
			waterModes(SEA_MODES, "seaTransport", "Seeweg") +
			'</div><div class="tsi-wnote">' + tr("transport.speedInfo.seaNote", "Auf offener See wird Tag und Nacht durchgesegelt — hier fällt keine Rastzeit an.") + '</div></div>' +
			"</div>" +
			'<div class="tsi-rules">' +
			'<div class="tsi-rule">' + iconImg("icons/Rast.webp") + "<div>" + tr("transport.speedInfo.restRule", "<b>Rast.</b> Standardmäßig reist du 12 Stunden am Tag und rastest 12 Stunden (im Planer einstellbar). Das gilt nur an Land — auf dem Wasser wird durchgefahren.") + "</div></div>" +
			'<div class="tsi-rule">' + iconImg("icons/Querfeldein.webp") + "<div>" + tr("transport.speedInfo.crossCountryRule", "<b>Querfeldein.</b> Fehlt zwischen zwei Orten ein echter Weg, schlägt sich die Route per Luftlinie durchs Gelände. Das ist zäh (1,25–2,5&nbsp;Meilen/h), darum bevorzugt die Berechnung selbst große Umwege über richtige Straßen und Pfade.") + "</div></div>" +
			"</div></div></div>"
		);
	}

	let overlay = null;
	let lastFocus = null;

	function onKey(e) {
		if (e.key === "Escape") {
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
