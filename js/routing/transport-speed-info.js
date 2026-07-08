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
		{ key: "caravan", label: "Karawane" },
		{ key: "groupFoot", label: "Gruppe zu Fuß" },
		{ key: "lightWalker", label: "Zu Fuß leicht" },
		{ key: "horseCarriage", label: "Kutsche" },
		{ key: "groupHorse", label: "Gruppe beritten" },
		{ key: "lightRider", label: "Reiter leicht" },
	];
	const LAND_PATHS = [
		{ key: "Reichsstrasse", label: "Reichsstraße" },
		{ key: "Strasse", label: "Straße" },
		{ key: "Weg", label: "Weg" },
		{ key: "Pfad", label: "Pfad" },
		{ key: "Gebirgspass", label: "Gebirgspass" },
		{ key: "Wuestenpfad", label: "Wüstenpfad" },
		{ key: "Querfeldein", label: "Querfeldein" },
	];
	const RIVER_MODES = [
		{ key: "riverSailer", label: "Flusssegler" },
		{ key: "riverBarge", label: "Flusskahn" },
	];
	const SEA_MODES = [
		{ key: "cargoShip", label: "Lastensegler" },
		{ key: "fastShip", label: "Schnellsegler" },
		{ key: "galley", label: "Galeere" },
	];

	const CSS = `
#transport-options{position:relative;}
.tsi-info-btn{position:absolute;top:4px;right:6px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0;padding:0;border:0;background:transparent;color:#9c8570;cursor:pointer;line-height:0;}
.tsi-info-btn:hover{color:#6a5543;}
.tsi-overlay{position:fixed;inset:0;z-index:5000;background:rgba(38,28,16,.5);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;}
.tsi-overlay[hidden]{display:none;}
.tsi-dialog{width:100%;max-width:600px;background:#fff9f4;border:1px solid #d1bda3;border-radius:12px;color:#3f3428;box-shadow:0 12px 44px rgba(0,0,0,.32);}
.tsi-head{display:flex;align-items:center;gap:9px;padding:13px 18px;border-bottom:1px solid #e6d8c6;}
.tsi-head .tsi-i{font-size:19px;color:#0078a8;line-height:1;}
.tsi-head h2{margin:0;font-size:18px;font-weight:600;color:#3f3428;}
.tsi-close{margin-left:auto;border:0;background:transparent;color:#6c5a49;font-size:18px;line-height:1;cursor:pointer;padding:3px 6px;border-radius:6px;}
.tsi-close:hover{background:#efe3d4;color:#3f3428;}
.tsi-body{padding:14px 18px 16px;}
.tsi-intro{margin:0 0 12px;font-size:13px;color:#6c5a49;line-height:1.5;}
.tsi-section{font-size:12px;font-weight:500;color:#8a5a2b;letter-spacing:.02em;margin:0 0 6px;}
.tsi-scroll{overflow-x:auto;}
.tsi-matrix{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;min-width:520px;}
.tsi-matrix th{padding:4px 3px 7px;font-weight:500;color:#6c5a49;font-size:10.5px;line-height:1.15;vertical-align:bottom;text-align:center;}
.tsi-matrix th.tsi-corner{text-align:left;color:#8a5a2b;font-size:11px;width:104px;padding-left:6px;}
.tsi-modehead{display:flex;flex-direction:column;align-items:center;gap:3px;}
.tsi-matrix td{padding:5px 3px;text-align:center;border-top:2px solid #fff9f4;border-left:2px solid #fff9f4;font-variant-numeric:tabular-nums;}
.tsi-matrix td.tsi-rowcell{text-align:left;border-top:1px solid #efe3d4;border-left:0;padding:5px 6px;}
.tsi-rowhead{display:flex;align-items:center;gap:6px;color:#3f3428;font-size:11.5px;}
.tsi-ic{width:16px;height:16px;object-fit:contain;flex:0 0 16px;}
.tsi-fast{background:#e2edcf;color:#27500A;}
.tsi-mid{background:#f6e6c9;color:#6b3d07;}
.tsi-slow{background:#f6dede;color:#791F1F;}
.tsi-na{color:#b9ac9c;}
.tsi-legend{display:flex;gap:14px;margin:8px 0 0;font-size:11px;color:#6c5a49;}
.tsi-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:middle;margin-right:4px;}
.tsi-water{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;}
.tsi-wcard{flex:1;min-width:230px;background:#fffaf5;border:1px solid #e6d8c6;border-radius:8px;padding:9px 11px;}
.tsi-wtitle{font-size:12px;font-weight:500;color:#0078a8;margin-bottom:4px;}
.tsi-wmodes{font-size:12.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.tsi-m{display:inline-flex;align-items:center;gap:5px;}
.tsi-dot{color:#c3b299;}
.tsi-wnote{font-size:11.5px;color:#6c5a49;margin-top:6px;line-height:1.5;}
.tsi-rules{margin-top:15px;border-top:1px solid #e6d8c6;padding-top:12px;display:flex;flex-direction:column;gap:10px;font-size:12px;color:#5f5045;line-height:1.5;}
.tsi-rules b{color:#3f3428;font-weight:500;}
@media (max-width:520px){.tsi-water{flex-direction:column;}}
`;

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
		let h = '<div class="tsi-scroll"><table class="tsi-matrix"><thead><tr><th class="tsi-corner">Wegtyp</th>';
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
			'<h2 id="tsi-title">Reisegeschwindigkeiten und Wegtypen</h2>' +
			'<button type="button" class="tsi-close" aria-label="Schließen">✕</button></div>' +
			'<div class="tsi-body">' +
			'<p class="tsi-intro">Wie schnell du vorankommst, hängt vom gewählten Transportmittel <em>und</em> vom Wegtyp ab. Eine gute Reichsstraße trägt dich doppelt so schnell wie ein Gebirgspfad. Alle Werte in Meilen pro Stunde (1 Meile = 1&nbsp;km).</p>' +
			'<div class="tsi-section">Landreise</div>' +
			landTable() +
			'<div class="tsi-legend"><span><i style="background:#e2edcf"></i>schnell</span><span><i style="background:#f6e6c9"></i>mittel</span><span><i style="background:#f6dede"></i>langsam</span></div>' +
			'<div class="tsi-water">' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">Flussreise</div><div class="tsi-wmodes">' +
			waterModes(RIVER_MODES, "riverTransport", "Flussweg") +
			'</div><div class="tsi-wnote">Flussabwärts, mit der Strömung, geht es mit voller Geschwindigkeit. Flussaufwärts, gegen die Strömung, dauert dieselbe Strecke länger — je nach Fluss das 1,5-fache, bei starker Strömung bis zum 3-fachen der Zeit.</div></div>' +
			'<div class="tsi-wcard"><div class="tsi-wtitle">Meerreise</div><div class="tsi-wmodes">' +
			waterModes(SEA_MODES, "seaTransport", "Seeweg") +
			'</div><div class="tsi-wnote">Auf offener See wird Tag und Nacht durchgesegelt — hier fällt keine Rastzeit an.</div></div>' +
			"</div>" +
			'<div class="tsi-rules">' +
			"<div><b>Rast.</b> Standardmäßig reist du 12 Stunden am Tag und rastest 12 Stunden (im Planer einstellbar). Das gilt nur an Land — auf dem Wasser wird durchgefahren.</div>" +
			"<div><b>Querfeldein.</b> Fehlt zwischen zwei Orten ein echter Weg, schlägt sich die Route per Luftlinie durchs Gelände. Das ist zäh (1,25–2,5&nbsp;Meilen/h), darum bevorzugt die Berechnung selbst große Umwege über richtige Straßen und Pfade.</div>" +
			"</div></div></div>"
		);
	}

	let overlay = null;
	let lastFocus = null;

	function ensureStyle() {
		if (document.getElementById("tsi-style")) {
			return;
		}
		const s = document.createElement("style");
		s.id = "tsi-style";
		s.textContent = CSS;
		(document.head || document.documentElement).appendChild(s);
	}

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
		ensureStyle();
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
		ensureStyle(); // Button-Styles sofort verfuegbar, nicht erst beim ersten Oeffnen.
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
