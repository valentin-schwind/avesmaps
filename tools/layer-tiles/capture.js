/*
 * Nimmt die sechs Ansichts-Icons (icons/layer-tiles/) aus der laufenden Karte auf.
 *
 * Benutzung: avesmaps.de oeffnen, diese Datei komplett in die Browser-Konsole einfuegen,
 * dann `avesLayerTiles.alle()` aufrufen. Die sechs Bilder landen als Download.
 * Einzeln: `avesLayerTiles.eine("political")`.
 *
 * Warum ueberhaupt ein Werkzeug: die Icons sind STATISCHE Bilder. Aendert sich der Kartenstil,
 * zeigen sie weiter die alte Karte, und niemand bemerkt es. Dann wird das hier neu ausgefuehrt.
 *
 * 💣 DREI FALLEN, alle einmal getreten:
 *
 * (1) ANONYM IST EINE FRAGE DER EBENEN, NICHT DES ORTES. Aufgenommen wird eine ALLOWLIST von
 *     Panes -- was nicht drinsteht, kann keinen Namen ins Bild tragen. `regionLabels`, `labels`,
 *     `pathLabelCanvas` und `mapDecorations` fehlen absichtlich.
 *
 * (2) DIE GEBIETSNAMEN SIND BILDER. In der regionLabels-Pane liegen die Namen als `data:`-PNG
 *     (gerasterter Text), die Wappen dagegen als Datei unter /uploads/wappen/. Ein "alle Bilder
 *     dieser Pane zeichnen" holt jeden Namen zurueck. Deshalb der Filter auf die Bildquelle.
 *
 * (3) JEDE DATENEBENE BAUT SICH STUFENWEISE AUF -- die politische Aussengrenze steht ZULETZT
 *     (AGENTS.md §10, "VIELE Features je Gebiet"). Eine Aufnahme nach fester Wartezeit mischt
 *     neue Farben mit alten Grenzen: die weissen Konturen laufen quer durch die Flaechen. Es wird
 *     gewartet, BIS SICH NICHTS MEHR AENDERT, nicht "lange genug".
 *
 * ⚠️ Und zwei kleinere: eine serialisierte SVG-Ebene traegt ihre CSS-Regeln nicht mit (die
 *    Landschaften stehen auf fill-opacity="0.2" im Attribut, waehrend CSS 0.72 durchsetzt), und
 *    ohne viewBox zeichnet sie in ihre eigenen, weit ausserhalb liegenden Koordinaten.
 */
(function () {
	"use strict";

	var MALSTIL = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity",
		"stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity"];

	// Die Aufnahmen. Ort und Zoom sind bewusst je Ansicht verschieden: jede zeigt sich dort, wo
	// sie etwas zu zeigen hat (Owner 11.08.2026).
	var ANSICHTEN = {
		none:        { modus: "none",        mitte: [628, 628],         zoom: 5, feld: 320,
			panes: ["leaflet-tile-pane"] },
		original:    { modus: "original",    mitte: [660, 476],         zoom: 5, feld: 320,
			panes: ["leaflet-tile-pane"] },
		political:   { modus: "political",   mitte: [570.786, 454.813], zoom: 5, feld: 460,
			panes: ["leaflet-tile-pane", "leaflet-regions-pane",
				"leaflet-avesmapsContestedHatch-pane", "leaflet-avesmapsBoundaryCanvas-pane"] },
		deregraphic: { modus: "deregraphic", mitte: [533.7, 555.3],     zoom: 5, feld: 320,
			panes: ["leaflet-tile-pane", "leaflet-roadsOutline-pane", "leaflet-roads-pane",
				"leaflet-locationCanvas-pane", "leaflet-locations-pane"] },
		// Die Entsaettigung ist NICHT erfunden: syncPowerlineMapTint faerbt die Grundkarte in
		// dieser Ansicht mit genau diesen Werten (js/map-features/map-features-display-mode.js).
		powerlines:  { modus: "powerlines",  mitte: [533.7, 555.3],     zoom: 5, feld: 320,
			ton: "saturate(0.1) brightness(0.6)",
			panes: ["leaflet-tile-pane", "leaflet-powerlines-pane",
				"leaflet-locationCanvas-pane", "leaflet-locations-pane"] },
		ecosystem:   { modus: "ecosystem",   mitte: [595.7, 504.8],     zoom: 3, feld: 320,
			unterebene: "vegetation",
			panes: ["leaflet-tile-pane", "leaflet-ecosystem-pane", "ecosystem-pane"] }
	};

	// 🔴 political und ecosystem liegen als vom Owner gestaltete Bilder im Repo
	// (img/politisches_icon.png, img/landschaften_icon.png) und werden NICHT ueberschrieben.
	// Ihre Eintraege oben stehen trotzdem hier: sie sagen, welcher Ausschnitt gemeint war.
	var VOM_OWNER = ["political", "ecosystem"];

	function warte(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

	function svgZuBild(svgEl, w, h) {
		return new Promise(function (fertig) {
			try {
				var klon = svgEl.cloneNode(true);
				klon.setAttribute("width", w);
				klon.setAttribute("height", h);
				if (!klon.getAttribute("viewBox")) {
					var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
					if (vb && vb.width) {
						klon.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.width + " " + vb.height);
					}
				}
				var orig = svgEl.querySelectorAll("*");
				var kop = klon.querySelectorAll("*");
				var n = Math.min(orig.length, kop.length);
				for (var i = 0; i < n; i++) {
					var cs = getComputedStyle(orig[i]);
					for (var p = 0; p < MALSTIL.length; p++) {
						var v = cs.getPropertyValue(MALSTIL[p]);
						if (v) { try { kop[i].setAttribute(MALSTIL[p], v); } catch (e) { /* egal */ } }
					}
				}
				var img = new Image();
				img.onload = function () { fertig(img); };
				img.onerror = function () { fertig(null); };
				img.src = "data:image/svg+xml;charset=utf-8," +
					encodeURIComponent(new XMLSerializer().serializeToString(klon));
			} catch (e) { fertig(null); }
		});
	}

	// Falle (3): warten, bis sich die aufzunehmenden Ebenen drei Messungen lang nicht mehr aendern.
	function ruhe(panes, maxMs) {
		return new Promise(function (fertig) {
			var cont = map.getContainer();
			var mini = document.createElement("canvas");
			mini.width = 40; mini.height = 40;
			var mctx = mini.getContext("2d");
			var wunsch = panes.map(function (p) { return typeof p === "string" ? p : p.cls; });
			function fingerabdruck() {
				var s = "";
				cont.querySelectorAll(".leaflet-pane").forEach(function (pane) {
					var cls = String(pane.className);
					if (cls.indexOf("leaflet-map-pane") >= 0) { return; }
					if (!wunsch.some(function (f) { return cls.indexOf(f) >= 0; })) { return; }
					s += pane.querySelectorAll("img,canvas,svg").length + ":" +
						pane.querySelectorAll("path").length + ";";
					pane.querySelectorAll("canvas").forEach(function (cv) {
						mctx.clearRect(0, 0, 40, 40);
						try { mctx.drawImage(cv, 0, 0, 40, 40); } catch (e) { s += "x"; return; }
						var d = mctx.getImageData(0, 0, 40, 40).data, h = 0;
						for (var i = 0; i < d.length; i += 5) { h = (h * 33 + d[i]) | 0; }
						s += h + ",";
					});
				});
				return s + "|" + cont.querySelectorAll(".leaflet-tile:not(.leaflet-tile-loaded)").length;
			}
			var start = Date.now(), letzter = null, gleich = 0;
			(function tick() {
				var f = fingerabdruck();
				if (f === letzter) { gleich++; } else { gleich = 0; letzter = f; }
				if (gleich >= 3 || Date.now() - start > maxMs) {
					fertig({ ms: Date.now() - start, ruhig: gleich >= 3 });
					return;
				}
				setTimeout(tick, 350);
			})();
		});
	}

	async function zusammensetzen(opt) {
		var cont = map.getContainer();
		var cr = cont.getBoundingClientRect();
		var voll = document.createElement("canvas");
		voll.width = Math.round(cr.width);
		voll.height = Math.round(cr.height);
		var ctx = voll.getContext("2d");
		ctx.fillStyle = getComputedStyle(cont).backgroundColor || "#7fb2d6";
		ctx.fillRect(0, 0, voll.width, voll.height);

		var wunsch = opt.panes.map(function (p) {
			return typeof p === "string" ? { cls: p, nur: null } : p;
		});
		var liste = [];
		cont.querySelectorAll(".leaflet-pane").forEach(function (p) {
			var cls = String(p.className);
			if (cls.indexOf("leaflet-map-pane") >= 0) { return; }
			var w = wunsch.find(function (x) { return cls.indexOf(x.cls) >= 0; });
			if (!w) { return; }
			liste.push({ el: p, z: parseInt(getComputedStyle(p).zIndex || "0", 10) || 0, cls: cls, nur: w.nur });
		});
		liste.sort(function (a, b) { return a.z - b.z; });

		for (var i = 0; i < liste.length; i++) {
			var eintrag = liste[i];
			var istKachel = eintrag.cls.indexOf("tile-pane") >= 0;
			var re = eintrag.nur ? new RegExp(eintrag.nur) : null;
			ctx.save();
			if (istKachel && opt.ton) { ctx.filter = opt.ton; }
			var els = eintrag.el.querySelectorAll("img, canvas, svg");
			for (var k = 0; k < els.length; k++) {
				var el = els[k];
				var tag = el.tagName.toLowerCase();
				if (tag === "img") {
					if (re && !re.test(el.src)) { continue; }               // Falle (2)
					var ok = el.src.indexOf("data:") === 0;
					try { ok = ok || new URL(el.src, location.href).origin === location.origin; }
					catch (e) { ok = false; }
					if (!ok) { continue; }   // fremde Herkunft vergiftet die Leinwand -> toDataURL waere hin
				}
				var r = el.getBoundingClientRect();
				if (r.width < 1 || r.height < 1) { continue; }
				var x = r.x - cr.x, y = r.y - cr.y;
				if (x > voll.width || y > voll.height || x + r.width < 0 || y + r.height < 0) { continue; }
				if (tag === "svg") {
					var bild = await svgZuBild(el, r.width, r.height);
					if (bild) { ctx.drawImage(bild, x, y, r.width, r.height); }
				} else {
					try { ctx.drawImage(el, x, y, r.width, r.height); } catch (e) { /* getaintet */ }
				}
			}
			ctx.restore();
		}

		var aus = document.createElement("canvas");
		aus.width = 128; aus.height = 128;
		var actx = aus.getContext("2d");
		actx.imageSmoothingQuality = "high";
		actx.drawImage(voll,
			Math.round((voll.width - opt.feld) / 2), Math.round((voll.height - opt.feld) / 2),
			opt.feld, opt.feld, 0, 0, 128, 128);
		return aus.toDataURL("image/webp", 0.92);
	}

	async function eine(schluessel) {
		var a = ANSICHTEN[schluessel];
		if (!a) { throw new Error("Unbekannte Ansicht: " + schluessel); }
		setSelectedMapLayerMode(a.modus);
		try { applyFrontendLayerModeDefaults(a.modus); } catch (e) { /* egal */ }
		if (a.unterebene) {
			var tab = Array.from(document.querySelectorAll(".ecosystem-layer-switch__tab"))
				.find(function (b) { return b.dataset.ecosystemKind === a.unterebene; });
			if (tab) { tab.click(); await warte(500); }
		}
		map.setView(a.mitte, a.zoom, { animate: false });
		var r = await ruhe(a.panes, 25000);
		if (!r.ruhig) { console.warn("[layer-tiles] " + schluessel + ": nach " + r.ms + " ms noch unruhig -- Bild pruefen!"); }
		var datenUrl = await zusammensetzen(a);
		var link = document.createElement("a");
		link.href = datenUrl;
		link.download = schluessel + ".webp";
		link.click();
		console.log("[layer-tiles] " + schluessel + " (Ruhe nach " + r.ms + " ms)");
		return datenUrl;
	}

	async function alle() {
		for (var k in ANSICHTEN) {
			if (VOM_OWNER.indexOf(k) >= 0) {
				console.log("[layer-tiles] " + k + " uebersprungen -- gestaltet vom Owner, siehe README");
				continue;
			}
			await eine(k);
			await warte(600);
		}
		console.log("[layer-tiles] fertig. Dateien nach icons/layer-tiles/ legen.");
	}

	window.avesLayerTiles = { eine: eine, alle: alle, ansichten: ANSICHTEN };
	console.log("[layer-tiles] bereit. avesLayerTiles.alle() oder .eine(\"powerlines\")");
})();
