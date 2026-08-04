// Pfad-Namen (Flüsse/Straßen) auf einem Canvas-Overlay zeichnen — wie die übrigen Karten-/Grenz-Namen, statt
// als SVG-<textPath>. Glyph-für-Glyph entlang der (geglätteten) Label-Linie, tangential rotiert; Halo per
// Stärke/Schärfe (weicher Canvas-Schatten <-> scharfe Kontur), identisch zur Siedlungs-/Regionen-Label-Optik.
// Sicherheitsnetz: ?canvaspathlabels=0 schaltet zurück auf die alte SVG-Variante (dann ist dieses Overlay aus).
(function initPathLabelCanvasOverlay() {
	const PANE = "avesmapsPathLabelCanvasPane";

	function canvasEnabled() {
		return typeof PATH_LABELS_ON_CANVAS === "undefined" ? true : !!PATH_LABELS_ON_CANVAS;
	}
	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}
	if (!ready()) {
		window.setTimeout(initPathLabelCanvasOverlay, 50);
		return;
	}
	if (!canvasEnabled()) {
		return; // SVG-Fallback aktiv -> kein Canvas-Overlay
	}

	// Kanal A (Way-Labels): wiki-zugewiesene Wege werden als Ganzes beschriftet (Endpunkt-Verkettung
	// über Segmente, Label alle ~WAY_LABEL_SCREEN_INTERVAL_PX Bildschirm-Pixel) statt pro Segment.
	// Escape-Hatch: ?waylabels=0 schaltet zurück auf reines Kanal-B-Verhalten (auch für zugewiesene
	// Wege -- alte per-Segment/show_label-Logik, wie vor diesem Feature).
	const wayLabelsEnabled = (() => {
		try { return new URLSearchParams(window.location.search).get("waylabels") !== "0"; } catch (e) { return true; }
	})();
	// Ziel-Bildschirm-Abstand (px) zwischen zwei Way-Label-Wiederholungen entlang einer Kette; tunbar
	// via ?waylabelinterval=NNN für Live-Vergleich ohne Deploy.
	const WAY_LABEL_SCREEN_INTERVAL_PX = (() => {
		try {
			const raw = new URLSearchParams(window.location.search).get("waylabelinterval");
			const parsed = Number(raw);
			return Number.isFinite(parsed) && parsed > 0 ? parsed : 600;
		} catch (e) { return 600; }
	})();
	// Klickbare Way-Labels (Task 16): Polster (Container-px) um die reine Textbreite fuer die
	// Klick-/Hover-Trefferflaeche -- etwas grosszuegiger als die Selbstkollisions-BBox (die nur
	// fontSize polstert), damit ein Fluss-/Strassenname auch knapp daneben noch trifft.
	const WAY_LABEL_CLICK_PAD = 6;

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const pane = map.getPane(PANE);
		pane.style.zIndex = 470;           // unter Wappen/Territoriumslabels (regionLabelsPane 475), noch über Wegen/Route -- politische Labels verdecken die (unwichtigen) Wegnamen
		pane.style.pointerEvents = "none"; // nicht-interaktiv
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0";
	canvas.classList.add("leaflet-zoom-animated"); // weiches Mitskalieren während der CSS-Zoom-Animation
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");
	let canvasTopLeftLatLng = null;
	// Klickbare Way-Labels (Task 16): Platzierungs-Register fuer Kanal A, bei JEDEM redraw() neu
	// aufgebaut (siehe dort) -- ein Eintrag pro tatsaechlich gezeichneter Label-Platzierung. Bleibt
	// leer, wenn Way-Labels aus (?waylabels=0) oder das Canvas-Overlay selbst aus ist (dann läuft
	// redraw() gar nicht/early-returnt). Reiner Treffer-Test: wayLabelHitTest in
	// map-features-way-labels.js (extractFunction-getestet, tools/paths/test-way-labels.mjs).
	let wayLabelClickRegister = [];

	// Läuft der Abschnitt, den der Text TATSÄCHLICH belegt (drawGlyphsAlong zentriert ihn immer auf
	// dem übergebenen Punkte-Array), netto nach links? Die Aufrufer drehen nur die GANZE Polyline
	// links->rechts -- eine Serpentine kann in ihrer Mitte trotzdem zurücklaufen, und genau dort stand
	// die Schrift auf dem Kopf (Discord #34). Gleiche Konvention wie dort, nur auf dem Teilstück.
	function labelSpanRunsLeftward(pts, textLen) {
		const cum = [0];
		for (let i = 1; i < pts.length; i += 1) {
			cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
		}
		const total = cum[cum.length - 1];
		if (!(total > 0) || textLen > total) {
			return false;
		}
		const xAt = (d) => {
			for (let i = 1; i < pts.length; i += 1) {
				if (d <= cum[i]) {
					const segLen = cum[i] - cum[i - 1];
					const t = segLen > 0 ? (d - cum[i - 1]) / segLen : 0;
					return pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
				}
			}
			return pts[pts.length - 1].x;
		};
		const spanStart = (total - textLen) / 2;
		return xAt(spanStart + textLen) < xAt(spanStart);
	}

	// --- Discord #18: "Beschriftung legt sich an Flussbiegung an" -------------------------------
	// Zwei getrennte Hebel, beide lassen die Leitlinie unangetastet (der Name bleibt EXAKT auf der
	// sichtbaren Linie -- die 2026-06-10 verworfene Glaettung kommt NICHT zurueck):
	//
	//   A  WO steht der Name? Nicht mehr stur auf der Mitte des angebotenen Stuecks, sondern auf dem
	//      ruhigsten Abschnitt in Reichweite. Das entscheiden die AUFRUFER, bevor sie ihr Fenster
	//      ausschneiden -- drawGlyphsAlong beschriftet weiter genau das Stueck, das es bekommt, und
	//      Fall #34 pinnt per Test, dass es dabei nichts verschiebt.
	//   B  WIE dicht stehen die Buchstaben? Siehe drawGlyphsAlong.
	//
	// Gemessen ueber alle 320 beschrifteten Fluss-Einheiten (Zoom 4, echte Geometrie): 2151 ueberlappende
	// Glyphen in 286 Fluessen vorher, 447 in 127 nachher.
	const LABEL_TURN_PROFILE_STEP_PX = 5;

	// Richtungsprofil einer Bildschirm-Polylinie: Kurs alle LABEL_TURN_PROFILE_STEP_PX Pixel, dazu die
	// aufsummierte |Richtungsaenderung| als Praefixsumme. EIN Vorwaertslauf (O(n+m)); danach kostet jede
	// Spannen-Frage zwei Array-Zugriffe. Ohne das liefe die Suche unten pro Kandidat neu ueber die ganze
	// Kette -- bei ~50 Kandidaten je Platzierung waere das pro Redraw spuerbar. Pur.
	function buildLabelTurningProfile(pts, stepPx) {
		const step = Number(stepPx) > 0 ? Number(stepPx) : 5;
		if (!Array.isArray(pts) || pts.length < 2) {
			return { step, total: 0, prefix: [0] };
		}
		const cum = [0];
		for (let i = 1; i < pts.length; i += 1) {
			cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
		}
		const total = cum[cum.length - 1];
		const headings = [];
		let i = 1;
		for (let d = 0; d <= total; d += step) {
			while (i < pts.length - 1 && cum[i] < d) i += 1;
			headings.push(Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x));
		}
		const prefix = [0];
		for (let k = 1; k < headings.length; k += 1) {
			const raw = headings[k] - headings[k - 1];
			prefix.push(prefix[k - 1] + Math.abs(Math.atan2(Math.sin(raw), Math.cos(raw))));
		}
		return { step, total, prefix };
	}

	// Gesamte Richtungsaenderung (Radiant) ueber [fromDist, fromDist + spanLen]. Pur.
	function labelSpanTurning(profile, fromDist, spanLen) {
		if (!profile || !profile.prefix || profile.prefix.length < 2) {
			return 0;
		}
		const last = profile.prefix.length - 1;
		const a = Math.max(0, Math.min(last, Math.round(fromDist / profile.step)));
		const b = Math.max(0, Math.min(last, Math.round((fromDist + spanLen) / profile.step)));
		return Math.max(0, profile.prefix[b] - profile.prefix[a]);
	}

	// A: die ruhigste Mitte in Reichweite. `anchorWeight` haelt den Namen in der Naehe seiner Sollstelle,
	// damit die Wiederholungen entlang einer Kette nicht zusammenklumpen; die Strafe ist relativ zur
	// Krummheit der Sollstelle, sonst wuerde sie auf geraden Ketten (base ~ 0) alles dominieren. Pur.
	function findCalmLabelCenter(profile, center, textLen, searchPx, anchorWeight) {
		const reach = Number(searchPx) || 0;
		if (!(reach > 0) || !profile || profile.total <= 0) {
			return center;
		}
		const half = textLen / 2;
		const low = Math.max(half + 8, center - reach);
		const high = Math.min(profile.total - half - 8, center + reach);
		if (!(high > low)) {
			return center;
		}
		const base = labelSpanTurning(profile, center - half, textLen);
		const weight = Number(anchorWeight) || 0;
		let best = center;
		let bestCost = base;
		for (let c = low; c <= high; c += profile.step) {
			const cost = labelSpanTurning(profile, c - half, textLen)
				+ weight * (Math.abs(c - center) / reach) * Math.max(base, 0.35);
			if (cost < bestCost) {
				bestCost = cost;
				best = c;
			}
		}
		return best;
	}

	// Teilstueck von `pts` um `center` (+/- `half`), Enden interpoliert. drawGlyphsAlong zentriert immer
	// auf dem, was es bekommt -- die AUSWAHL der Stelle passiert hier. Pur.
	function sliceLabelWindow(pts, center, half) {
		const cum = [0];
		for (let i = 1; i < pts.length; i += 1) {
			cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
		}
		const total = cum[cum.length - 1];
		const start = Math.max(0, center - half);
		const end = Math.min(total, center + half);
		const at = (d) => {
			for (let i = 1; i < pts.length; i += 1) {
				if (d <= cum[i]) {
					const segLen = cum[i] - cum[i - 1];
					const t = segLen > 0 ? (d - cum[i - 1]) / segLen : 0;
					return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
				}
			}
			return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
		};
		const out = [at(start)];
		for (let i = 0; i < pts.length; i += 1) {
			if (cum[i] > start && cum[i] < end) out.push(pts[i]);
		}
		out.push(at(end));
		return out;
	}

	// Halbe Fensterbreite fuer eine Platzierung: Textbreite plus etwas Luft, und mit Kruemmungs-Ausgleich
	// zusaetzlich eine Schrifthoehe -- der Zuschlag verlaengert den Namen, und laeuft er ueber das Fenster
	// hinaus, staut at() die letzten Buchstaben am Fensterende.
	function labelWindowHalf(textLen, fontSize, relief) {
		return textLen / 2 + 4 + (relief > 0 ? Math.max(0, Number(fontSize) || 0) : 0);
	}

	// Aktueller Wert der drei #18-Stellgroessen (map-features-path-labels.js, live per ?pathtune=1).
	function pathLabelBendSettings() {
		return {
			searchPx: typeof PATH_LABEL_CALM_SEARCH_PX !== "undefined" ? Number(PATH_LABEL_CALM_SEARCH_PX) || 0 : 0,
			anchor: typeof PATH_LABEL_CALM_ANCHOR !== "undefined" ? Number(PATH_LABEL_CALM_ANCHOR) || 0 : 0,
			relief: typeof PATH_LABEL_CURVATURE_RELIEF !== "undefined" ? Number(PATH_LABEL_CURVATURE_RELIEF) || 0 : 0,
		};
	}

	// Glyphen einzeln entlang der Pixel-Polyline platzieren (zentriert auf dem jeweiligen Slot, tangential
	// rotiert). textAlign/textBaseline werden in redraw() gesetzt; Halo = weicher Schatten + scharfe Kontur.
	function drawGlyphsAlong(pts, chars, widths, ls, halo, fillColor, perpOffset, fontSize) {
		const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;
		// Vor dem perpOffset-Shift umdrehen, damit „positiv = oben" für den gedrehten Lauf gilt.
		if (labelSpanRunsLeftward(pts, textLen)) {
			pts = pts.slice().reverse();
		}
		if (perpOffset) {
			// Alle Punkte senkrecht zur Linie verschieben (positiv = „oben"/über der Linie für links->rechts).
			const shifted = [];
			for (let i = 0; i < pts.length; i += 1) {
				const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
				let tx = b.x - a.x, ty = b.y - a.y; const tm = Math.hypot(tx, ty) || 1; tx /= tm; ty /= tm;
				shifted.push({ x: pts[i].x + ty * perpOffset, y: pts[i].y - tx * perpOffset });
			}
			pts = shifted;
		}
		const seg = [];
		let total = 0;
		for (let i = 1; i < pts.length; i += 1) {
			const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			seg.push({ cum: total, len: d, a: pts[i - 1], b: pts[i] });
			total += d;
		}
		if (!seg.length) {
			return;
		}
		if (textLen > total) {
			return; // Linie zu kurz für den Namen
		}
		const at = (d) => {
			for (const s of seg) {
				if (d <= s.cum + s.len) {
					const t = (d - s.cum) / (s.len || 1);
					return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) };
				}
			}
			const l = seg[seg.length - 1];
			return { x: l.b.x, y: l.b.y, ang: Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) };
		};

		// B (Discord #18): Auf einem Bogen dreht jeder Buchstabe gegen seinen Nachbarn. Weil ein Glyph ein
		// starrer Kasten ist, stossen die Kaesten an der INNENSEITE zusammen -- genau das ist das
		// "zusammengedrueckt" der Meldung. Der Zuschlag (Hoehe/2)*|dTheta| auf den Vorschub ist der Betrag,
		// den die Drehung der Innenkante wegnimmt. Ohne fontSize (Altaufruf) oder mit relief = 0 laeuft
		// alles wie zuvor -- darauf steht der #34-Test.
		const relief = typeof PATH_LABEL_CURVATURE_RELIEF !== "undefined" ? Number(PATH_LABEL_CURVATURE_RELIEF) || 0 : 0;
		const halfHeight = (Number(fontSize) > 0 ? Number(fontSize) : 0) * 0.72 / 2;
		const place = (startDist, strength) => {
			const glyphs = [];
			let dist = startDist;
			let previousAngle = null;
			for (let i = 0; i < chars.length; i += 1) {
				const w = widths[i];
				let p = at(dist + w / 2);
				if (strength > 0 && halfHeight > 0 && previousAngle !== null) {
					const raw = p.ang - previousAngle;
					const turn = Math.abs(Math.atan2(Math.sin(raw), Math.cos(raw)));
					if (turn > 0) {
						dist += halfHeight * turn * strength;
						p = at(dist + w / 2);
					}
				}
				glyphs.push(p);
				previousAngle = p.ang;
				dist += w + ls;
			}
			return { glyphs, consumed: dist - ls - startDist };
		};

		// ⚠ DER ZUSCHLAG DARF DEN NAMEN NIE UEBER SEIN STUECK HINAUS SCHIEBEN. at() klemmt jenseits des
		// Endes auf den letzten Punkt -- die ueberstehenden Buchstaben laegen dann exakt aufeinander, und
		// der Name verlaere sichtbar sein letztes Zeichen ("Der Grosse Fluss" -> "Der Grosse Flus").
		// Passt er nicht, wird der Ausgleich halbiert, bis er passt; im letzten Schritt auf 0. Mit 0 ist
		// consumed == textLen, und textLen > total ist oben schon abgefangen -> die Schleife endet immer.
		let strength = relief;
		let run = place((total - textLen) / 2, strength);
		for (let guard = 0; guard < 4 && run.consumed > total; guard += 1) {
			strength = guard === 3 ? 0 : strength / 2;
			run = place((total - textLen) / 2, strength);
		}
		// Mittig nachziehen: sonst waechst der laengere Name nur nach RECHTS aus seinem Fenster.
		if (run.consumed > textLen) {
			run = place((total - run.consumed) / 2, strength);
		}

		for (let i = 0; i < chars.length; i += 1) {
			const p = run.glyphs[i];
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.ang);
			if (halo.glow && halo.blur > 0.01) {
				ctx.save();
				ctx.shadowColor = halo.glow;
				ctx.shadowBlur = halo.blur * (window.devicePixelRatio || 1); // shadowBlur zaehlt in Geraete-Pixeln -> mit dpr nachziehen

				ctx.fillStyle = halo.glow;
				ctx.fillText(chars[i], 0, 0);
				ctx.restore();
			}
			if (halo.glow && halo.strokeW > 0.01) {
				ctx.lineJoin = "round";
				ctx.lineCap = "round";
				ctx.strokeStyle = halo.glow;
				ctx.lineWidth = halo.strokeW;
				ctx.strokeText(chars[i], 0, 0);
			}
			ctx.fillStyle = fillColor;
			ctx.fillText(chars[i], 0, 0);
			ctx.restore();
		}
		return run.glyphs;
	}

	function redraw() {
		// Klickbare Way-Labels (Task 16): Register IMMER zuerst leeren -- auch wenn redraw() gleich
		// darunter frueh returnt (Canvas aus, mitten in der CSS-Zoom-Animation, keine pathData). So
		// bleibt nie eine Klickflaeche eines VORHERIGEN Frames stehen, wenn in diesem Frame gar nichts
		// (neu) gezeichnet wird.
		wayLabelClickRegister = [];
		if (!canvasEnabled() || !map.getPane(PANE) || cssZoomActive) {
			return;
		}
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft);
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln -> scharf auf Retina/Mobile (dpr 2–3),
		// unverändert auf Standard-Desktop (dpr 1). Gezeichnet wird weiter in CSS-px (ctx ist mit dpr skaliert).
		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(size.x * dpr), ph = Math.round(size.y * dpr);
		if (canvas.width !== pw) canvas.width = pw;
		if (canvas.height !== ph) canvas.height = ph;
		if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
		if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (typeof pathData === "undefined" || !Array.isArray(pathData) || !pathData.length) {
			return;
		}
		if (typeof isPathLabelVisibleAtCurrentZoom !== "function" || typeof getPathLabelVisualLatLngCoordinates !== "function") {
			return;
		}
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		pathData.forEach((path) => {
			// Kanal B: wiki-zugewiesene Wege werden jetzt als Ganzes über Kanal A beschriftet (unten) --
			// show_label wird für sie ignoriert (kein Doppel-Label). Unzugewiesene Segmente bleiben
			// unverändert beim bisherigen per-Segment-Verhalten.
			if (wayLabelsEnabled && path?.properties?.wiki_path?.wiki_key) {
				return;
			}
			if (!isPathLabelVisibleAtCurrentZoom(path)) {
				return;
			}
			const name = getPathDisplayName(path);
			if (!name) {
				return;
			}
			const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
			const isRiver = subtype === "Flussweg" || subtype === "Seeweg";
			const style = getPathLabelStyle(path);
			const fontSize = parseFloat(style.fontSize) || 11;
			const ls = parseFloat(style.letterSpacing) || 0;

			const latlngs = getPathLabelVisualLatLngCoordinates(path.geometry.coordinates);
			if (!Array.isArray(latlngs) || latlngs.length < 2) {
				return;
			}
			let pts = latlngs.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));
			// Off-Screen-Cull über die Bounding-Box der projizierten Punkte (mit Halo-/Schrift-Reserve).
			let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
			for (let i = 0; i < pts.length; i += 1) {
				if (pts[i].x < bx1) bx1 = pts[i].x;
				if (pts[i].x > bx2) bx2 = pts[i].x;
				if (pts[i].y < by1) by1 = pts[i].y;
				if (pts[i].y > by2) by2 = pts[i].y;
			}
			const m = fontSize + 8;
			if (bx2 < -m || bx1 > size.x + m || by2 < -m || by1 > size.y + m) {
				return;
			}
			// Lesbarkeit: Text immer links -> rechts.
			if (pts[pts.length - 1].x < pts[0].x) {
				pts = pts.slice().reverse();
			}
			ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily}`;
			const chars = [...name];
			const widths = chars.map((c) => ctx.measureText(c).width);
			let halo = { glow: null, blur: 0, strokeW: 0 };
			if (typeof getLabelHaloParams === "function") {
				const hp = getLabelHaloParams(
					isRiver ? PATH_LABEL_RIVER_HALO_STRENGTH : PATH_LABEL_ROAD_HALO_STRENGTH,
					isRiver ? PATH_LABEL_RIVER_HALO_SHARPNESS : PATH_LABEL_ROAD_HALO_SHARPNESS
				);
				if (hp.glow) {
					halo = { glow: hp.glow, blur: fontSize * (hp.glowBlurRatio || 0), strokeW: fontSize * (hp.strokeRatio || 0) };
				}
			}
			// dy-Slider (?pathtune=1): senkrechter Versatz; SVG-dy negativ = oben -> perpOffset = -dy.
			const perp = -(typeof PATH_LABEL_DY !== "undefined" ? PATH_LABEL_DY : 0);
			// A (#18): frueher bekam drawGlyphsAlong die GANZE Segment-Polylinie und setzte den Namen auf
			// deren Mitte -- lag dort eine Schlinge, wurde eben dort beschriftet. Jetzt suchen wir das
			// ruhigste Stueck und schneiden das Fenster dort aus. Bei Suchradius 0 faellt die Wahl auf
			// dieselbe Mitte wie bisher.
			const bend = pathLabelBendSettings();
			let labelPts = pts;
			if (bend.searchPx > 0) {
				const textLen = widths.reduce((sum, w) => sum + w + ls, 0) - ls;
				const profile = buildLabelTurningProfile(pts, LABEL_TURN_PROFILE_STEP_PX);
				const center = findCalmLabelCenter(profile, profile.total / 2, textLen, bend.searchPx, bend.anchor);
				const windowPts = sliceLabelWindow(pts, center, labelWindowHalf(textLen, fontSize, bend.relief));
				if (windowPts.length >= 2) {
					labelPts = windowPts;
				}
			}
			drawGlyphsAlong(labelPts, chars, widths, ls, halo, style.fill, perp, fontSize);
		});

		// Kanal A: wiki-zugewiesene Wege als GANZES beschriften (Endpunkt-Verkettung über Segmente,
		// Label alle ~WAY_LABEL_SCREEN_INTERVAL_PX Bildschirm-Pixel entlang jeder Kette). show_label wird
		// hier bewusst ignoriert (siehe Kanal-B-Skip oben). Escape: ?waylabels=0.
		if (wayLabelsEnabled
			&& typeof isWayLabelEligible === "function"
			&& typeof buildWayLabelChains === "function"
			&& typeof computeWayLabelIntervalOffsets === "function"
			&& typeof getPathGeomBounds === "function") {
			const viewportBounds = map.getBounds().pad(0.25); // gleiches Polster wie currentPathVisibilityContext()
			// PERF: einmal pro Redraw statt einmal pro Pfad (siehe buildWayLabelEligibilityContext).
			const wayLabelEligibilityCtx = typeof buildWayLabelEligibilityContext === "function"
				? buildWayLabelEligibilityContext()
				: {};
			const wayGroups = new Map(); // wiki_key -> { name, wikiUrl, pathsById: Map<public_id, path> }
			pathData.forEach((path) => {
				if (!isWayLabelEligible(path, wayLabelEligibilityCtx)) {
					return;
				}
				const geomBounds = getPathGeomBounds(path);
				if (!geomBounds || !viewportBounds.intersects(geomBounds)) {
					return;
				}
				const wikiKey = path.properties.wiki_path.wiki_key;
				if (!wayGroups.has(wikiKey)) {
					const wikiName = String(path.properties.wiki_path.name || "").trim();
					// wiki_url kommt vom ERSTEN Segment der Gruppe (alle Segmente DESSELBEN Wegs teilen
					// denselben wiki_path -> beliebiges Segment reicht) -- Grundlage fuer den Klick-Popup-
					// Link (Task 16, "Link teilen" + "Wiki ↗").
					wayGroups.set(wikiKey, {
						name: wikiName || getPathDisplayName(path),
						wikiUrl: String(path.properties.wiki_path.wiki_url || "").trim(),
						pathsById: new Map(),
					});
				}
				const publicId = path.properties?.public_id || path.id;
				wayGroups.get(wikiKey).pathsById.set(publicId, path);
			});

			const acceptedWayLabelBoxes = []; // Selbstkollision: {x1,y1,x2,y2} bereits platzierter Way-Labels
			const boxesOverlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

			wayGroups.forEach((group, wikiKey) => {
				const segments = Array.from(group.pathsById.values()).map((p) => ({
					id: p.properties?.public_id || p.id,
					coordinates: p.geometry.coordinates,
				}));
				const chains = buildWayLabelChains(segments);
				chains.forEach((chain) => {
					// Kette zur geglätteten Bildschirm-Polyline zusammensetzen: pro Eintrag die (geglättete)
					// Label-Leitlinie desselben Helfers wie Kanal B, bei reversed umgedreht, dieselbe
					// Projektion (map.latLngToContainerPoint) wie im per-Segment-Zweig oben; doppelte
					// Gelenkpunkte zwischen Segmenten werden übersprungen.
					let pts = [];
					chain.forEach((entry) => {
						const path = group.pathsById.get(entry.id);
						let latlngs = getPathLabelVisualLatLngCoordinates(path.geometry.coordinates);
						if (!Array.isArray(latlngs) || latlngs.length < 2) {
							return;
						}
						if (entry.reversed) {
							latlngs = latlngs.slice().reverse();
						}
						const segPts = latlngs.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));
						if (pts.length && segPts.length) {
							// Ersten Punkt nur dann überspringen, wenn er den vorigen Kettenpunkt WIRKLICH
							// dupliziert (exakt/gerundet geteilter Gelenkpunkt, <= 1.5px). An Phase-2-
							// verbrückten Ortsstoß-Lücken (bis ~7 Karteneinheiten ≈ ~112px bei Zoom 4) ist
							// er ein echter Stützpunkt und muss erhalten bleiben.
							const prevPt = pts[pts.length - 1];
							const firstPt = segPts[0];
							const isDuplicateJoint = Math.hypot(firstPt.x - prevPt.x, firstPt.y - prevPt.y) <= 1.5;
							pts.push(...(isDuplicateJoint ? segPts.slice(1) : segPts));
						} else {
							pts.push(...segPts);
						}
					});
					if (pts.length < 2) {
						return;
					}
					// Lesbarkeit: ganze Kette links -> rechts (wie beim per-Segment-Zweig, nur auf Kettenebene).
					if (pts[pts.length - 1].x < pts[0].x) {
						pts = pts.slice().reverse();
					}

					const firstPath = group.pathsById.get(chain[0].id);
					const subtype = normalizePathSubtype(firstPath.properties?.feature_subtype || firstPath.properties?.name);
					const isRiver = subtype === "Flussweg" || subtype === "Seeweg";
					const style = getPathLabelStyle(firstPath);
					const fontSize = parseFloat(style.fontSize) || 11;
					const ls = parseFloat(style.letterSpacing) || 0;

					const cumAtPts = [0]; // kumulierte Distanz je Punkt in pts (einmal pro Kette berechnet)
					for (let i = 1; i < pts.length; i += 1) {
						cumAtPts.push(cumAtPts[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
					}
					const totalLen = cumAtPts[cumAtPts.length - 1];
					if (totalLen < 1) {
						return;
					}

					ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily}`;
					const chars = [...group.name];
					const widths = chars.map((c) => ctx.measureText(c).width);
					const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;

					let halo = { glow: null, blur: 0, strokeW: 0 };
					if (typeof getLabelHaloParams === "function") {
						const hp = getLabelHaloParams(
							isRiver ? PATH_LABEL_RIVER_HALO_STRENGTH : PATH_LABEL_ROAD_HALO_STRENGTH,
							isRiver ? PATH_LABEL_RIVER_HALO_SHARPNESS : PATH_LABEL_ROAD_HALO_SHARPNESS
						);
						if (hp.glow) {
							halo = { glow: hp.glow, blur: fontSize * (hp.glowBlurRatio || 0), strokeW: fontSize * (hp.strokeRatio || 0) };
						}
					}
					const perp = -(typeof PATH_LABEL_DY !== "undefined" ? PATH_LABEL_DY : 0);

					// Punkt bei kumulierter Distanz `d` entlang der (bereits projizierten) Kettenpunkte pts
					// interpolieren -- Grundlage sowohl fürs Fenster-Slicing als auch die Kollisions-BBox.
					const sampleAt = (d) => {
						let remaining = Math.max(0, Math.min(d, totalLen));
						for (let i = 1; i < pts.length; i += 1) {
							const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
							if (remaining <= segLen || i === pts.length - 1) {
								const t = segLen > 0 ? remaining / (segLen || 1) : 0;
								return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
							}
							remaining -= segLen;
						}
						return pts[0];
					};

					// A (#18): Richtungsprofil EINMAL je Kette -- die Suche unten fragt es nur noch ab. Erst
					// bauen, wenn diese Kette wirklich beschriftet wird und die Suche eingeschaltet ist: der
					// Aufbau laeuft ueber die ganze Kette, und der haeufigste Fall ist "kein Label" (zu kurz).
					const bend = pathLabelBendSettings();
					const offsets = computeWayLabelIntervalOffsets(totalLen, WAY_LABEL_SCREEN_INTERVAL_PX, textLen);
					const turningProfile = (offsets.length && bend.searchPx > 0)
						? buildLabelTurningProfile(pts, LABEL_TURN_PROFILE_STEP_PX)
						: null;
					offsets.forEach((intervalOffset) => {
						// Die Intervall-Mitte ist nur noch der VORSCHLAG; gesetzt wird auf dem ruhigsten
						// Stueck in Reichweite (Suchradius 0 -> exakt das alte Verhalten).
						const centerOffset = findCalmLabelCenter(turningProfile, intervalOffset, textLen, bend.searchPx, bend.anchor);
						const halfWindow = labelWindowHalf(textLen, fontSize, bend.relief);
						const windowStart = Math.max(0, centerOffset - halfWindow);
						const windowEnd = Math.min(totalLen, centerOffset + halfWindow);
						// drawGlyphsAlong zentriert IMMER auf dem übergebenen Punkte-Array (dist = (total-textLen)/2)
						// -- für mehrere Platzierungen entlang derselben Kette wird deshalb, wie beim per-Segment-
						// Zweig, ein Fenster (Sub-Polyline) um den Ziel-Offset ausgeschnitten und UNVERÄNDERT mit
						// derselben Signatur an drawGlyphsAlong übergeben (kein neuer Parameter erfunden).
						const windowPts = [sampleAt(windowStart)];
						for (let i = 0; i < pts.length; i += 1) {
							// Zwischenpunkte der Original-Polyline im Fenster mit übernehmen, damit Kurven
							// (nicht nur Start/Ende) erhalten bleiben.
							if (cumAtPts[i] > windowStart && cumAtPts[i] < windowEnd) {
								windowPts.push(pts[i]);
							}
						}
						windowPts.push(sampleAt(windowEnd));
						if (windowPts.length < 2) {
							return;
						}
						// Selbstkollision: BBox aus Fenster-Start/-Mitte/-Ende ± Schriftgröße (nur Kanal-A-Labels
						// nehmen daran teil).
						const mid = sampleAt(centerOffset);
						// Kasten auf die TEXTSPANNE, nicht auf die Fensterenden: das Fenster traegt jetzt
						// Luft fuer den Kruemmungs-Ausgleich und waere als Klickflaeche zu grosszuegig.
						const spanFrom = sampleAt(Math.max(0, centerOffset - textLen / 2));
						const spanTo = sampleAt(Math.min(totalLen, centerOffset + textLen / 2));
						const pad = fontSize;
						const xs = [spanFrom.x, mid.x, spanTo.x];
						const ys = [spanFrom.y, mid.y, spanTo.y];
						const box = {
							x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad,
							x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad,
						};
						if (acceptedWayLabelBoxes.some((accepted) => boxesOverlap(accepted, box))) {
							return;
						}
						acceptedWayLabelBoxes.push(box);
						drawGlyphsAlong(windowPts, chars, widths, ls, halo, style.fill, perp, fontSize);
						// Klick-Register (Task 16): eigene, etwas grosszuegigere Trefferflaeche als die reine
						// Selbstkollisions-Box (WAY_LABEL_CLICK_PAD statt fontSize) -- Textbreite bleibt gleich,
						// nur ein bisschen mehr "Fingerspielraum" ums Label. Anker = Bildschirmmitte der
						// Platzierung, zurueckprojiziert auf eine LatLng (ueberlebt den naechsten redraw/pan).
						wayLabelClickRegister.push({
							left: Math.min(...xs) - WAY_LABEL_CLICK_PAD,
							top: Math.min(...ys) - WAY_LABEL_CLICK_PAD,
							right: Math.max(...xs) + WAY_LABEL_CLICK_PAD,
							bottom: Math.max(...ys) + WAY_LABEL_CLICK_PAD,
							wikiKey,
							name: group.name,
							wikiUrl: group.wikiUrl,
							subtype,
							anchorLatLng: map.containerPointToLatLng([mid.x, mid.y]),
						});
					});
				});
			});
		}

		// Kraftlinien-Namen -- nur im Modus „Kraftlinien". Text liegt auf der (geraden) Mittellinie, leicht
		// darüber versetzt (wie früher SVG-dy -10), mit dezentem weichem Halo für Lesbarkeit.
		if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines"
			&& typeof powerlineData !== "undefined" && Array.isArray(powerlineData) && powerlineData.length
			&& typeof isPowerlineLabelVisibleAtCurrentZoom === "function" && typeof getPowerlineLatLngs === "function") {
			powerlineData.forEach((powerline) => {
				if (!isPowerlineLabelVisibleAtCurrentZoom(powerline)) {
					return;
				}
				const name = typeof getPowerlineDisplayName === "function" ? getPowerlineDisplayName(powerline) : "";
				if (!name) {
					return;
				}
				const style = typeof getPowerlineLabelStyle === "function" ? getPowerlineLabelStyle() : null;
				const fontSize = style ? (parseFloat(style.fontSize) || 18) : 18;
				const ls = style ? (parseFloat(style.letterSpacing) || 0) : 0;
				const ll = getPowerlineLatLngs(powerline);
				if (!Array.isArray(ll) || ll.length < 2) {
					return;
				}
				let pts = ll.map((p) => map.latLngToContainerPoint(p));
				let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
				for (let i = 0; i < pts.length; i += 1) {
					if (pts[i].x < bx1) bx1 = pts[i].x;
					if (pts[i].x > bx2) bx2 = pts[i].x;
					if (pts[i].y < by1) by1 = pts[i].y;
					if (pts[i].y > by2) by2 = pts[i].y;
				}
				const mm = fontSize + 16;
				if (bx2 < -mm || bx1 > size.x + mm || by2 < -mm || by1 > size.y + mm) {
					return;
				}
				if (pts[pts.length - 1].x < pts[0].x) {
					pts = pts.slice().reverse();
				}
				ctx.font = `${(style && style.fontWeight) || "500"} ${fontSize}px ${(style && style.fontFamily) || '"Faculty Glyphic", Georgia, serif'}`;
				const chars = [...name];
				const widths = chars.map((c) => ctx.measureText(c).width);
				const halo = { glow: "rgba(0, 0, 0, 0.5)", blur: fontSize * 0.14, strokeW: 0 };
				drawGlyphsAlong(pts, chars, widths, ls, halo, (style && style.fill) || "rgba(255, 196, 214, 0.98)", 10, fontSize);
			});
		}
	}

	// Klickbare Way-Labels (Task 16): Popup-Markup fuer einen Register-Treffer -- Wegname, "Wiki ↗"
	// (falls verlinkt) und die "Link teilen"-Leiste (Task-13-Bausteine, wie Orts-/Wege-Popups).
	// Gleiche Bausteine/Klassen wie pathWikiInfoboxMarkup (map-features-path-rendering.js) und
	// createRegionWikiInfoBoxMarkup (map-features-region-info-markup.js) -> geerbte
	// .settlement-popup/.region-info-box-Optik ohne eigenes CSS. wikiParam nach Subtyp: Flussweg/
	// Seeweg -> "fluss", sonst "strasse" (js/app/wiki-deeplink.js). KEIN ?place=-Fallback: eine
	// Way-Label-Kette hat keine eigene public_id (applyPlaceFocusFromUrl kennt ohnehin keine Wege,
	// siehe pathWikiInfoboxMarkup) -> ohne wikiUrl kein Teilen-Button, aber der Popup-Kopf bleibt.
	function wayLabelPopupMarkup(entry) {
		const name = String(entry.name || "").trim() || "Weg";
		const wikiUrl = String(entry.wikiUrl || "").trim();
		// Standard-Quellenzeile („Informationen aus dem Wiki Aventurica. Mehr hier ↗") wie in den
		// Siedlungs-/Wege-Popups; „Link teilen" sitzt IMMER darunter (Owner-Vorgabe 2026-07-06).
		const wikiLink = wikiUrl && typeof wikiSourceCreditMarkup === "function"
			? wikiSourceCreditMarkup(wikiUrl)
			: (wikiUrl ? `<a class="region-info-box__link" href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener">${escapeHtml(name)} im Wiki-Aventurica ↗</a>` : "");
		const wikiParam = (entry.subtype === "Flussweg" || entry.subtype === "Seeweg") ? "fluss" : "strasse";
		const shareButton = wikiUrl && typeof sharePlaceActionButtonMarkup === "function"
			? sharePlaceActionButtonMarkup(entry.wikiKey, { wikiUrl, wikiParam })
			: "";
		const shareMarkup = shareButton && typeof locationPopupActionsMarkup === "function"
			? locationPopupActionsMarkup([shareButton])
			: "";
		if (typeof locationPopupMarkup !== "function") {
			// Sollte nie passieren (js/ui/popups.js laedt vor diesem Overlay) -- minimaler Fallback ohne
			// die geteilten Popup-Klassen, damit ein Klick nie in einer stillen Exception endet.
			return `<div class="location-popup"><div class="location-popup__name">${escapeHtml(name)}</div>${wikiLink}${shareMarkup}</div>`;
		}
		return locationPopupMarkup({
			name,
			// Praezises Wegtyp-Label wie die Weg-Infobox (path.type.*), nicht das grobe Suchlabel.
			locationTypeLabel: typeof getPathTypeLabel === "function"
				? getPathTypeLabel(entry.subtype)
				: tr("spotlight.pathType." + entry.subtype, wikiParam === "fluss" ? "Fluss" : "Straße"),
			showHeaderIcon: false,
			showDescription: false,
			showWikiLink: false,
			showType: true,
			// "Link teilen" (Owner) direkt unter dem Kopf, die Wiki-Quellenzeile darunter.
			actionsMarkup: shareMarkup + wikiLink,
		});
	}

	// Findet ein repraesentatives Pfad-Segment zu einem Way-Label-Treffer. Das Klick-Register nimmt nur
	// wiki-verlinkte Wege auf (Gate: wiki_path.wiki_key), und alle Segmente eines Wegs teilen denselben
	// wiki_path -> ein beliebiges Segment mit passendem wiki_key liefert dieselbe Infobox wie der Linien-Klick.
	// null (kein Match / pathData nicht da) -> der Aufrufer faellt auf die Kurzfassung zurueck.
	function findPathForWayLabelEntry(entry) {
		const wikiKey = entry && entry.wikiKey;
		if (!wikiKey || typeof pathData === "undefined" || !Array.isArray(pathData)) {
			return null;
		}
		return pathData.find((path) => path?.properties?.wiki_path?.wiki_key === wikiKey) || null;
	}

	// Klick-Schiedsrichter (docs/click-arbiter-coordination.md): Way-Labels sind die NIEDRIGSTPRIORE
	// Klickflaeche (unter Siedlung/Region/Gebiet -- ein Weg-Name-Label liegt nie ÜBER einem
	// interaktiven Vektor-Layer, weil das Label-Pane pointer-events:none ist). Der Map-Klick feuert
	// deshalb NUR, wenn kein interaktiver Layer (Strasse/Fluss-Linie mit bubblingMouseEvents:false,
	// Region mit L.DomEvent.stop) den Klick vorher abgefangen hat -- siehe Verifikation im Report.
	// Trotzdem zuerst den Siedlungs-Arbiter fragen: eine Siedlung kann RÄUMLICH auf/neben einem
	// Way-Label-Text liegen (beide sind reine Karten-Klicks, keine DOM-Ueberlappung im Sinne von
	// Leaflets Ziel-Kette), und Siedlung gewinnt per Prioritaet immer.
	map.on("click", (event) => {
		// Im Karten-Editor (?edit=1) sind Weg-/Fluss-Labels bewusst NICHT klickbar: ein Klick oder
		// Doppelklick am Label soll den Pfad DARUNTER treffen (Stuetzpunkt setzen), nicht das
		// Label-Popup oeffnen. Das Label-Pane ist ohnehin pointer-events:none -- dieser Map-Klick-
		// Schiedsrichter ist der einzige interaktive Rest, also im Edit-Mode still.
		if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
			return;
		}
		if (cssZoomActive) {
			return; // Register haelt waehrend der CSS-Zoom-Animation veraltete Vor-Zoom-Container-px (redraw pausiert)
		}
		if (!wayLabelsEnabled || !wayLabelClickRegister.length) {
			return;
		}
		if (typeof window.avesmapsTryOpenLocationAtContainerPoint === "function"
				&& window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
			return; // Siedlung gewinnt (Prioritaet Siedlung > Strasse/Fluss > Region > Gebiet)
		}
		const hit = wayLabelHitTest(wayLabelClickRegister, event.containerPoint);
		if (!hit) {
			return;
		}
		// Konsistenz (Owner 2026-07-07): ein Klick auf den WEG-NAMEN oeffnet EXAKT denselben Popup wie ein Klick
		// auf die Weg-/Fluss-Linie -- also die volle Wiki-Infobox (Lage/Laenge/Verlauf/Beschreibung + Quellenzeile
		// + "Link teilen"), nicht die frueher hier gebaute Kurzfassung. Wir wiederverwenden das vorgefertigte
		// _popupMarkup/_popupOptions des repraesentativen Segments (identisch zum Linien-Klick in createPathLayer,
		// map-features-path-rendering.js).
		const labeledPath = findPathForWayLabelEntry(hit);
		const markup = labeledPath
			? (labeledPath._popupMarkup || (typeof createPathPopupMarkup === "function" ? createPathPopupMarkup(labeledPath) : null))
			: null;
		// Infopanel (?infopanel=true): Weg-Info ins rechte Panel statt ins schwebende Popup
		// (markup, sonst die Kurzfassung).
		if (typeof window.avesmapsShowInfopanel === "function") {
			window.avesmapsShowInfopanel(markup || wayLabelPopupMarkup(hit));
			return;
		}
		if (markup) {
			const options = labeledPath._popupOptions
				|| (typeof pathHasWiki === "function" && pathHasWiki(labeledPath)
					? { className: "settlement-popup", minWidth: 320, maxWidth: 400 }
					: {});
			L.popup(options)
				.setLatLng(hit.anchorLatLng)
				.setContent(markup)
				.openOn(map);
			return;
		}
		// Fallback (sollte nicht eintreten: jedes klickbare Label ist ein wiki-verlinkter Weg in pathData) --
		// Kurz-Popup, damit ein Klick nie ins Leere laeuft.
		L.popup({ className: "settlement-popup", minWidth: 260, maxWidth: 360 })
			.setLatLng(hit.anchorLatLng)
			.setContent(wayLabelPopupMarkup(hit))
			.openOn(map);
	});

	// Cursor-Feedback (billig, throttled): Way-Label-Text signalisiert per Finger-Cursor, dass er
	// klickbar ist -- gleiches Muster wie locationCanvasLayer._onMouseMove. Kein Redraw, keine
	// Neuberechnung pro Frame: nur ein Treffer-Test auf dem ohnehin vorhandenen Register, hoechstens
	// alle 100ms (Perf-Grundsatz: nichts Teures pro Frame).
	let wayLabelCursorActive = false;
	let wayLabelLastCursorCheck = 0;
	map.on("mousemove", (event) => {
		// Kein „klickbares Label"-Cursor-Feedback im Karten-Editor (siehe click-Handler oben).
		if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
			return;
		}
		if (cssZoomActive) {
			return; // Register haelt waehrend der CSS-Zoom-Animation veraltete Vor-Zoom-Container-px (redraw pausiert)
		}
		if (!wayLabelsEnabled) {
			return;
		}
		if (!wayLabelClickRegister.length) {
			// Leeres Register (Zoom unter minZoom, Toggle aus, keine Daten): einen noch aktiven
			// pointer-Cursor SOFORT zuruecksetzen statt nur frueh rauszuspringen -- sonst klebt der
			// Finger-Cursor bis zum naechsten Treffer-Test mit wieder gefuelltem Register.
			if (wayLabelCursorActive) {
				wayLabelCursorActive = false;
				if (map.getContainer().style.cursor === "pointer") {
					map.getContainer().style.cursor = "";
				}
			}
			return;
		}
		const now = Date.now();
		if (now - wayLabelLastCursorCheck < 100) {
			return;
		}
		wayLabelLastCursorCheck = now;
		const over = Boolean(wayLabelHitTest(wayLabelClickRegister, event.containerPoint));
		if (over === wayLabelCursorActive) {
			return;
		}
		wayLabelCursorActive = over;
		// Nur setzen/zuruecksetzen, wenn NICHTS anderes gerade den Cursor beansprucht (z. B. Leaflets
		// grab/grabbing beim Draggen) -- auf "" zuruecksetzen wuerde einen aktiven Griff-Cursor sonst
		// mitten im Drag ueberschreiben.
		if (over) {
			map.getContainer().style.cursor = "pointer";
		} else if (map.getContainer().style.cursor === "pointer") {
			map.getContainer().style.cursor = "";
		}
	});

	// Zoom-Animation wie beim Grenzen-Overlay: CSS-Zoom -> Canvas weich mitskalieren (nicht neu zeichnen);
	// flyTo/setView (kein zoomanim) -> pro Frame neu zeichnen.
	let cssZoomActive = false;
	map.on("moveend zoomend viewreset resize", () => {
		cssZoomActive = false;
		canvas.style.transition = "";
		redraw();
	});
	map.on("zoomanim", function (event) {
		if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
			return;
		}
		cssZoomActive = true;
		canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
		const scale = map.getZoomScale(event.zoom);
		const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(canvas, offset, scale);
	});
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	window.AvesmapsPathLabelCanvasOverlay = { redraw, paneName: PANE };
	// Erst-/Nachzieh-Redraws, falls die Pfad-Daten erst nach Overlay-Init geladen werden.
	[120, 400, 1000].forEach((delay) => window.setTimeout(redraw, delay));
	// Sobald die App-Schrift (Faculty Glyphic) geladen ist, neu zeichnen -> kein Fallback-Font beim Erst-Paint.
	if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
		document.fonts.ready.then(redraw).catch(() => { /* noop */ });
	}
})();
