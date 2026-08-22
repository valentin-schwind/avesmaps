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

	// 🔴 pathLabelBendSettings ist am 22.08.2026 mit nach curved-label-layout.js gezogen -- NICHT
	// aus Ordnungsliebe, sondern weil findFreePlacement sie ruft und dort steht. Siehe die
	// Begruendung an ihrer neuen Stelle.

	// Die fertig gerechneten Glyphen malen. textAlign/textBaseline werden in redraw() gesetzt;
	// Halo = weicher Schatten + scharfe Kontur.
	function paintGlyphs(glyphs, chars, halo, fillColor) {
		for (let i = 0; i < chars.length; i += 1) {
			const p = glyphs[i];
			if (!p) {
				continue;
			}
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
		return glyphs;
	}

	// Rechnen und malen in einem Zug -- der Weg fuer Aufrufer ohne Ausweichpruefung (Kraftlinien).
	function drawGlyphsAlong(pts, chars, widths, ls, halo, fillColor, perpOffset, fontSize) {
		const glyphs = layoutGlyphsAlong(pts, chars, widths, ls, perpOffset, fontSize);
		if (!glyphs) {
			return;
		}
		return paintGlyphs(glyphs, chars, halo, fillColor);
	}

	// KANAL C -- Landschaftsnamen auf ihrer Kurve (Entwurf §7.3): Schriftfamilie/-schnitt 1:1 aus dem
	// vorhandenen Label-Stil (getMapLabelTypeStyle, wie renderMapLabelToImage sie zusammensetzt).
	// Keine neue Schrift: zwei Schriftbilder nebeneinander wuerden auffallen -- genau deshalb wird
	// ueberhaupt auf Canvas gezeichnet, statt eine zweite Optik zu erfinden (AGENTS.md §12).
	function kurvenlabelFont(label, fontSize) {
		const typeStyle = getMapLabelTypeStyle(label.labelType);
		const fontStylePrefix = typeStyle.fontStyle ? `${typeStyle.fontStyle} ` : "";
		return `${fontStylePrefix}${typeStyle.fontWeight} ${fontSize}px ${typeStyle.fontFamily}`;
	}

	// Fuellfarbe, ebenfalls aus dem vorhandenen Label-Stil -- keine hartkodierte Farbe (AGENTS.md §12).
	function kurvenlabelFarbe(label) {
		return getMapLabelTypeStyle(label.labelType).color;
	}

	// Halo wie am Marker-Label selbst: createLabelIcon baut seinen Schein aus genau denselben zwei
	// Werten (REGION_LABEL_HALO_STRENGTH/-SHARPNESS) -- hier nur in die {glow, blur, strokeW}-Form
	// gebracht, die paintGlyphs schon fuer die Kanaele A/B erwartet. Bezugsgroesse ist die
	// EINGESTELLTE Schriftgroesse des Labels (getScaledLabelSize), nicht ein ggf. verkleinertes
	// Fenster -- derselbe Bezug, mit dem der Marker seinen Halo baut.
	function kurvenlabelHalo(label) {
		const kein = { glow: null, blur: 0, strokeW: 0 };
		if (typeof getLabelHaloParams !== "function") {
			return kein;
		}
		const hp = getLabelHaloParams(REGION_LABEL_HALO_STRENGTH, REGION_LABEL_HALO_SHARPNESS);
		if (!hp.glow) {
			return kein;
		}
		const fontSize = getScaledLabelSize(label);
		return { glow: hp.glow, blur: fontSize * (hp.glowBlurRatio || 0), strokeW: fontSize * (hp.strokeRatio || 0) };
	}

	// --- Die Ablage: was zuletzt gerechnet wurde, und fuer WELCHE Ansicht ---------------------------
	// 💣 Eine Glyphenreihe ist in CONTAINER-Pixeln notiert und nach einem Schwenk nicht bloss alt,
	// sondern falsch. redraw() kommt naemlich nicht nur vom Kollisionsdurchgang, sondern auch aus
	// map-features-path-rendering.js, map-features-powerlines.js und map-features-display-mode.js --
	// und die rufen, ohne dass vorher jemand gerechnet haette. Deshalb traegt die Ablage einen Stempel
	// der Ansicht (Zoomstufe + linke obere Ecke als LatLng); passt er nicht, wird neu gerechnet statt
	// falsch gemalt.
	let kurvenlabelAblage = { zoom: null, topLeft: null, eintraege: [], gemalt: new Set() };

	// Die Schrittweite des Ausweichens. Die REICHWEITE gehoert der Tafel in curve-label-fit.js
	// (`dodgePx`, Entwurf §7.2 -- dort haengt Plan 4 seinen Regler an); wie fein dazwischen abgetastet
	// wird, ist eine Aufloesung und keine Gestaltungsfrage: 2 px sind bei 6 px Reichweite drei Stellen
	// je Richtung.
	const KURVENLABEL_AUSWEICH_SCHRITT_PX = 2;

	function kurvenlabelAnsichtsStempel() {
		return { zoom: map.getZoom(), topLeft: map.containerPointToLatLng([0, 0]) };
	}

	// Gilt die Ablage noch fuer die Ansicht, die gerade gemalt werden soll?
	function kurvenlabelAblageGilt() {
		const jetzt = kurvenlabelAnsichtsStempel();
		return kurvenlabelAblage.zoom === jetzt.zoom
			&& Boolean(kurvenlabelAblage.topLeft)
			&& kurvenlabelAblage.topLeft.equals(jetzt.topLeft);
	}

	// Entwurf §7.2 Punkt 1: ein Kurvenlabel belegt MEHRERE kleine Kaesten entlang seiner Grundlinie,
	// nicht eine Huellbox. Ein um 297° gedrehter Name liefert als achsenparallele Huelle ein
	// Vielfaches seiner Tinte; je Buchstabe ein Kasten aus dessen GEDREHTEN Ecken (labelGlyphCorners
	// -- dieselbe Rechnung, mit der die Wegnamen gegen die Belegung geprueft werden) ist die genauere
	// Aussage. Container-Pixel.
	// ⚠️ Das Polster ist der GETEILTE Regler „Repel" (Fenster „Zoombänder"), keine neue Zahl: die
	// Glyphenhoehe ist die Tintenhoehe (0,72 x Schriftgrad), ohne Polster stiessen fremde Namen bis an
	// die Buchstaben heran.
	function kurvenlabelKaesten(glyphs) {
		const polster = typeof avesmapsLocationLabelSpacing === "function"
			? Number(avesmapsLocationLabelSpacing("repel")) || 0
			: 0;
		return glyphs.map((glyph) => {
			const ecken = typeof labelGlyphCorners === "function"
				? labelGlyphCorners(glyph)
				: [{ x: glyph.x, y: glyph.y }];
			let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
			for (const ecke of ecken) {
				if (ecke.x < left) left = ecke.x;
				if (ecke.x > right) right = ecke.x;
				if (ecke.y < top) top = ecke.y;
				if (ecke.y > bottom) bottom = ecke.y;
			}
			return { left: left - polster, top: top - polster, right: right + polster, bottom: bottom + polster };
		});
	}

	// Entwurf §7.2 Punkt 2: ein Kurvenlabel darf ein PAAR PIXEL entlang der eigenen Kurve ausweichen.
	//
	// ⚠️ findFreePlacement (curved-label-layout.js) waere der naheliegende Weg und ist der falsche:
	// sie ruft pathLabelBendSettings() und rechnete damit mit den Stellgroessen des WEGE-Kanals
	// (?pathtune=1). Gebaut ist das Ausweichen deshalb aus denselben Bausteinen, aber mit der Tafel
	// der Kurvenbeschriftung.
	//
	// 💣 Die Passung hat die Grundlinie auf den NAMEN zugeschnitten -- auf ihr ist unter Umstaenden
	// gar kein Platz zum Schieben. Sie wird deshalb an beiden Enden um den Ausweichweg tangential
	// verlaengert (curveLabelExtend, dasselbe Mittel wie in der Passung selbst) und daraus ein
	// textbreites Fenster ausgeschnitten. Bei Versatz 0 kommt Zeichen fuer Zeichen dieselbe Lage
	// heraus wie ohne diesen Schritt: das Ausweichen aendert nichts, solange nichts im Weg steht.
	//
	// 🔴 Bringt es nichts, weicht das Kurvenlabel NICHT weiter aus (Entwurf §7.2 Punkt 3). Es sitzt
	// auf seiner Flaeche; das fremde Label muss ausweichen oder verschwinden -- wie heute bei den
	// Gebietsnamen. Also kein „dann eben ausblenden": ein Landschaftsname, der wegen eines Dorfnamens
	// verschwindet, waere genau die Rangaenderung, die dieser Plan vermeidet. Der Rueckfall ist die
	// erste geometrisch gueltige Lage, und das ist der Versatz 0.
	function platziereKurvenfenster(fenster) {
		const weite = Math.max(0, Number(AVESMAPS_CURVE_LABEL_DEFAULTS.dodgePx) || 0);
		const textLaenge = fenster.widths.reduce((summe, w) => summe + w + fenster.ls, 0) - fenster.ls;
		// 💣 AUSGESCHNITTEN WIRD IN DER LAENGE DES PASSUNGSFENSTERS, nicht in der des Textes. Die
		// Passung laesst bewusst einen Vorhalt (§4.4) -- schnitte man auf die Textbreite zu, faellt
		// der weg, der Kruemmungsausgleich in layoutGlyphsAlong hat keinen Platz mehr, und bei
		// Versatz 0 kaeme etwas anderes heraus als vor dieser Aufgabe. Ausserdem waere ein Fenster
		// von exakt Textbreite ein Rundungsrest davon entfernt, gar nichts mehr zu liefern
		// (layoutGlyphsAlong gibt null, sobald der Text laenger ist als das Stueck).
		const laenge = curveLabelLineLength(fenster.pts);
		const bahn = weite > 0 ? curveLabelExtend(fenster.pts, laenge + 2 * weite) : fenster.pts;
		const cum = cumulativeLengths(bahn);
		const gesamt = cum[cum.length - 1];
		const mitte = gesamt / 2;
		// Ohne Richtungsprofil (null): auf 6 px unterscheiden sich die Stellen in ihrer Kruemmung
		// nicht, eine Ruhe-Rangfolge waere Rauschen. orderDodgeOffsets liefert dann die alte Ordnung
		// 0, +2, -2, +4, -4, +6, -6 -- und die Null bleibt vorn.
		const versaetze = orderDodgeOffsets(weite, KURVENLABEL_AUSWEICH_SCHRITT_PX, null, mitte, textLaenge, 0);
		let rueckfall = null;
		for (const versatz of versaetze) {
			const teil = sliceLabelWindowAt(bahn, cum, gesamt, mitte + versatz, laenge / 2);
			if (teil.length < 2) {
				continue;
			}
			const glyphs = layoutGlyphsAlong(teil, fenster.chars, fenster.widths, fenster.ls, 0, fenster.fontSize);
			if (!glyphs || glyphs.length === 0) {
				continue;
			}
			// 💣 DIE PROBE DES OWNERS, am fertig gesetzten Text (Entwurf §4.1, §7.3): steht die
			// erste Glyphe weiter links als die letzte? Im Prototyp beantwortete der Browser das
			// (getStartPositionOfChar); auf dem Canvas fragt niemand, also wird gerechnet.
			// Sie steht HIER und nicht nur in der Passung, weil zwischen beidem noch geglaettet
			// und verlaengert wird -- und weil genau diese Zusicherung beim Entwerfen zweimal
			// danebengegangen ist. Ein Toleranzband gibt es nicht: -1 px ist die Grenze, und
			// ein Band um die verbotene Lage LAESST DIE VERBOTENE LAGE ZU.
			if (glyphs[glyphs.length - 1].x - glyphs[0].x < -1) {
				continue;
			}
			if (!rueckfall) {
				rueckfall = glyphs;
			}
			const huelle = glyphsHullBox(glyphs, fenster.fontSize);
			if (typeof labelOccupancyBlocksGlyphs === "function"
				&& typeof avesmapsLabelOccupancy !== "undefined"
				&& labelOccupancyBlocksGlyphs(avesmapsLabelOccupancy, huelle, glyphs)) {
				continue;
			}
			return glyphs;
		}
		return rueckfall;
	}

	// DIE RECHNUNG. Sie laeuft im Kollisionsdurchgang zwischen den Gebietsnamen und den Orts-/
	// Freilabels (map-features-label-collisions.js) -- nicht beim Zeichnen. Der Ablauf ist kurz, weil
	// die Arbeit woanders liegt: curve-label-fit.js passt, curved-label-layout.js setzt die Glyphen.
	function berechneKurvenlabels() {
		kurvenlabelAblage = Object.assign(kurvenlabelAnsichtsStempel(), { eintraege: [], gemalt: new Set() });
		if (typeof avesmapsKurvenlabelKandidaten !== "function" || typeof avesmapsCurveLabelFit !== "function") {
			return kurvenlabelAblage;
		}
		const kandidaten = avesmapsKurvenlabelKandidaten();
		if (!Array.isArray(kandidaten) || kandidaten.length === 0) {
			return kurvenlabelAblage;
		}
		for (const label of kandidaten) {
			// 1. Die Kurve in Bildschirmpunkte. label.curveLine ist [lat, lng] -- der Tausch ist
			//    schon in normalizeLabelFeature passiert und passiert hier NICHT noch einmal.
			const pts = label.curveLine.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));

			// 2. Schrift und Zeichenbreiten messen. ⚠️ ctx.font MUSS vor dem Messen stehen --
			//    measureText misst gegen die zuletzt gesetzte Schrift, nicht gegen die gewuenschte.
			const fontSize = getScaledLabelSize(label);
			ctx.font = kurvenlabelFont(label, fontSize);
			// Dieselbe Gross-/Kleinschreibung wie am Marker-Label (renderMapLabelToImage liest
			// typeStyle.uppercase aus dem echten CSS): Gebirge/Region/Kontinent erscheinen dort
			// GROSSGESCHRIEBEN. Ohne diesen Schritt stuende auf der Kurve "Drachensteine", am Marker
			// daneben "DRACHENSTEINE" -- genau die zwei Schriftbilder, die dieses Overlay vermeiden soll.
			const typeStyle = getMapLabelTypeStyle(label.labelType);
			const anzeigeText = typeStyle.uppercase ? String(label.text).toUpperCase() : String(label.text);
			const chars = Array.from(anzeigeText);
			const widths = chars.map((c) => ctx.measureText(c).width);

			// 3. Passen lassen.
			const passung = avesmapsCurveLabelFit(pts, chars, widths, fontSize, label.curveMax);
			if (!passung) {
				continue;
			}

			// 4. Platzieren -- je Fenster einmal.
			const fenster = [];
			for (const f of passung.fenster) {
				const glyphs = platziereKurvenfenster(f);
				if (!glyphs) {
					continue;
				}
				fenster.push({ glyphs, chars: f.chars, fontSize: f.fontSize, kaesten: kurvenlabelKaesten(glyphs) });
			}
			// 💣 Kein einziges gesetztes Fenster heisst: dieser Name wird NICHT als Kurve gemalt -- und
			// dann muss sein alter Marker stehenbleiben. Er kommt deshalb gar nicht erst in die Ablage;
			// avesmapsLabelWirdAlsKurveGemalt liest genau sie.
			if (fenster.length === 0) {
				continue;
			}
			kurvenlabelAblage.eintraege.push({
				label,
				fenster,
				halo: kurvenlabelHalo(label),
				fill: kurvenlabelFarbe(label),
			});
			kurvenlabelAblage.gemalt.add(label);
		}
		return kurvenlabelAblage;
	}

	// DER MALER. Er rechnet nicht mehr -- ausser die Ablage gilt einer anderen Ansicht als der, die
	// gerade gemalt wird (siehe kurvenlabelAblageGilt): dann lieber neu rechnen als falsch malen.
	function zeichneKurvenlabels() {
		if (!kurvenlabelAblageGilt()) {
			berechneKurvenlabels();
		}
		for (const eintrag of kurvenlabelAblage.eintraege) {
			for (const f of eintrag.fenster) {
				// ⚠️ ctx.font wird JE FENSTER gesetzt, nicht nur wenn es vom Ausgangswert abweicht: bei
				// mehreren Fenstern (curveMax > 1) schrumpft `fensterFuer` jedes Fenster UNABHAENGIG --
				// ein Vergleich nur gegen die urspruengliche `fontSize` liesse ein spaeteres, NICHT
				// verkleinertes Fenster in der Schriftgroesse des vorigen (verkleinerten) Fensters
				// zeichnen. Sonst malt der Canvas in der falschen Groesse an Positionen, die fuer eine
				// andere gerechnet wurden.
				ctx.font = kurvenlabelFont(eintrag.label, f.fontSize);
				paintGlyphs(f.glyphs, f.chars, eintrag.halo, eintrag.fill);
			}
		}
	}

	// 🔴 DIE SCHNITTSTELLE ZUR KASKADE (Entwurf §7.2). Der Kollisionsdurchgang ruft sie ZWISCHEN den
	// Gebietsnamen und den Orts-/Freilabels und bekommt zurueck, was die Kurvenlabels belegen.
	//
	// 💣 ZWEI KOORDINATENSYSTEME, DIE GLEICH AUSSEHEN. Gerechnet wird hier in CONTAINER-Pixeln
	// (map.latLngToContainerPoint). resolveLabelCollisions vergleicht dagegen gegen Rechtecke aus
	// getBoundingClientRect, also VIEWPORT-Pixel -- abgeschrieben von resolveRegionLabelCollisions,
	// das ihm seine bisherige Vorbelegung liefert. Umgerechnet wird deshalb HIER, ein einziges Mal,
	// durch ADDIEREN des Container-Ursprungs; publishLabelOccupancy zieht ihn hinterher wieder ab und
	// bekommt so seine Container-Pixel zurueck (map-features-label-occupancy.js). Wer das vergisst,
	// laesst die Kurvenlabels an der falschen Stelle blockieren -- kein Absturz, nur „hier fehlt
	// komisch oft ein Ortsname".
	window.avesmapsKurvenlabelPlatzierungen = function (containerOrigin) {
		const ablage = berechneKurvenlabels();
		const links = Number(containerOrigin && containerOrigin.left) || 0;
		const oben = Number(containerOrigin && containerOrigin.top) || 0;
		const rechtecke = [];
		for (const eintrag of ablage.eintraege) {
			for (const f of eintrag.fenster) {
				for (const kasten of f.kaesten) {
					rechtecke.push({
						left: kasten.left + links,
						right: kasten.right + links,
						top: kasten.top + oben,
						bottom: kasten.bottom + oben,
						width: kasten.right - kasten.left,
						height: kasten.bottom - kasten.top,
					});
				}
			}
		}
		return rechtecke;
	};

	// 💣 Sie fragt das ERGEBNIS der Platzierung ab, nie die Eingabe. `Boolean(label.curveLine)` waere
	// falsch: eine Kurve am Label heisst „der Server hat eine geliefert", nicht „sie wurde auch
	// gezeichnet". Findet die Passung kein Fenster oder scheitert die Leserichtungsprobe, wird nichts
	// gemalt -- und dann muss der Marker stehenbleiben, sonst verschwindet der Name GANZ. Das ist
	// derselbe Fehler wie eine Absage, die stumm als Erfolg durchgeht: aus „ich konnte nicht" wird
	// „es gibt nichts".
	window.avesmapsLabelWirdAlsKurveGemalt = function (label) {
		return Boolean(label) && kurvenlabelAblage.gemalt.has(label);
	};

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

		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		// 💣 KANAL C HAENGT NICHT AN DEN WEGEN, und seit Aufgabe 6 haengt der ALTE MARKER am Ergebnis
		// seiner Rechnung: ein frueher Ausstieg hier liesse den Landschaftsnamen ganz verschwinden --
		// die Kurve ungemalt, der Marker schon abgemeldet. Dieselbe Fehlerklasse wie eine Absage, die
		// stumm als Erfolg durchgeht. Deshalb malt Kanal C auch dann, wenn es keine Wege gibt.
		if (typeof pathData === "undefined" || !Array.isArray(pathData) || !pathData.length
			|| typeof isPathLabelVisibleAtCurrentZoom !== "function"
			|| typeof getPathLabelVisualLatLngCoordinates !== "function") {
			zeichneKurvenlabels();
			return;
		}
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
			// Den senkrechten Versatz (dy-Slider, ?pathtune=1) setzt findFreePlacement selbst -- er muss
			// schon in den Kandidaten stecken, sonst pruefte das Ausweichen eine andere Lage als die,
			// die spaeter gemalt wird.
			// A (#18): frueher bekam drawGlyphsAlong die GANZE Segment-Polylinie und setzte den Namen auf
			// deren Mitte -- lag dort eine Schlinge, wurde eben dort beschriftet. Jetzt suchen wir das
			// ruhigste Stueck und schneiden das Fenster dort aus. Bei Suchradius 0 faellt die Wahl auf
			// dieselbe Mitte wie bisher.
			const bend = pathLabelBendSettings();
			const cum = cumulativeLengths(pts);
			const total = cum[cum.length - 1];
			const textLen = widths.reduce((sum, w) => sum + w + ls, 0) - ls;
			let wish = total / 2;
			// Dasselbe Profil beantwortet beide Fragen: WO ist es am ruhigsten (hier) und, falls dort
			// etwas im Weg steht, WOHIN darf der Name ausweichen (findFreePlacement).
			let turningProfile = null;
			if (bend.searchPx > 0) {
				turningProfile = buildLabelTurningProfile(pts, LABEL_TURN_PROFILE_STEP_PX);
				wish = findCalmLabelCenter(turningProfile, turningProfile.total / 2, textLen, bend.searchPx, bend.anchor);
			}
			// Ausweichen (2026-08-05): die Sollstelle ist nur der Wunsch -- liegt dort ein Orts-,
			// Landschafts- oder Gebietsname, rutscht der Name an der eigenen Linie weiter. Findet sich
			// nichts, wird hier nichts gezeichnet.
			const found = findFreePlacement(pts, cum, total, wish, chars, widths, ls, fontSize, null, turningProfile);
			if (!found) {
				return;
			}
			paintGlyphs(found.glyphs, chars, halo, style.fill);
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
					// Fenster-Ausschnitt und Kollisions-Kasten kommen jetzt beide aus findFreePlacement /
					// sliceLabelWindowAt (die dieselbe kumulierte Laenge cumAtPts nutzen) -- der eigene
					// Interpolierer hier waere ihre zweite Fassung.

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
						// Ausweichen (2026-08-05): rutscht an der eigenen Kette weiter, bis die Stelle frei
						// ist -- frei heisst hier BEIDES: kein anderer Wegname (Selbstkollision, wie bisher
						// nur Kanal A) und kein Orts-/Landschafts-/Gebietsname (gemeinsame Belegungskarte,
						// map-features-label-occupancy.js). Findet sich nichts, faellt diese Platzierung aus;
						// der naechste Name derselben Kette steht ~WAY_LABEL_SCREEN_INTERVAL_PX weiter.
						const found = findFreePlacement(
							pts, cumAtPts, totalLen, centerOffset, chars, widths, ls, fontSize,
							(hull) => acceptedWayLabelBoxes.some((accepted) => boxesOverlap(accepted, {
								x1: hull.left, y1: hull.top, x2: hull.right, y2: hull.bottom,
							})),
							turningProfile
						);
						if (!found) {
							return;
						}
						// Selbstkollisions-Kasten = die tatsaechlichen Buchstabenlagen + eine Schriftgroesse
						// (frueher aus Spannenanfang/-mitte/-ende geschaetzt; jetzt liegen die Glyphen ohnehin
						// schon vor, weil die Ausweichpruefung sie braucht).
						acceptedWayLabelBoxes.push({
							x1: found.hull.left, y1: found.hull.top, x2: found.hull.right, y2: found.hull.bottom,
						});
						paintGlyphs(found.glyphs, chars, halo, style.fill);
						// Klick-Register (Task 16): eigene, etwas grosszuegigere Trefferflaeche als die reine
						// Selbstkollisions-Box (WAY_LABEL_CLICK_PAD statt fontSize) -- Textbreite bleibt gleich,
						// nur ein bisschen mehr "Fingerspielraum" ums Label. Anker = Bildschirmmitte der
						// Platzierung, zurueckprojiziert auf eine LatLng (ueberlebt den naechsten redraw/pan).
						const middleGlyph = found.glyphs[Math.floor(found.glyphs.length / 2)];
						const spanPad = WAY_LABEL_CLICK_PAD - fontSize; // hull traegt bereits fontSize Polster
						wayLabelClickRegister.push({
							left: found.hull.left - spanPad,
							top: found.hull.top - spanPad,
							right: found.hull.right + spanPad,
							bottom: found.hull.bottom + spanPad,
							wikiKey,
							name: group.name,
							wikiUrl: group.wikiUrl,
							subtype,
							anchorLatLng: map.containerPointToLatLng([middleGlyph.x, middleGlyph.y]),
						});
					});
				});
			});
		}

		// KANAL C: die Namen der Landschaftsflaechen auf ihrer Kurve (Entwurf §7.3).
		// 🔴 Die Kurve kommt vom SERVER und liegt fertig am Label (label.curveLine, Leaflet-Ordnung).
		// 🔴 Und GERECHNET wird hier nichts mehr: die Platzierung faellt eine Stufe frueher, im
		// Kollisionsdurchgang zwischen Gebiets- und Ortsnamen (avesmapsKurvenlabelPlatzierungen,
		// map-features-label-collisions.js). Hier wird nur noch die Ablage gemalt -- und nur dann neu
		// gerechnet, wenn sie einer anderen Ansicht gilt.
		zeichneKurvenlabels();

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
		// Steht fuer dieses Bild schon ein Kollisionspass an, zeichnet DER am Ende (siehe
		// scheduleLabelCollisionResolution). Selbst zu zeichnen hiesse: zweimal pro Bild, und der erste
		// Lauf mit den Label-Rechtecken des VORIGEN Bildes. js/app/bootstrap.js meldet seine
		// moveend/zoomend-Zuhoerer vor diesem hier an, der Pass ist also bereits angemeldet.
		if (typeof labelCollisionFrameId !== "undefined" && labelCollisionFrameId !== null) {
			return;
		}
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
