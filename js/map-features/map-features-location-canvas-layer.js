// Rendert ALLE Orts-Marker (alle sechs Typen) in EINEM Canvas-Pass statt als je ein DOM-Element ->
// umgeht Leaflets teure _onZoomTransitionEnd-Reprojektion pro Marker. GEMESSEN 2026-06-09: senkt den
// Zoom-Freeze bei Tiefzoom spuerbar (z.B. ~440-613ms -> ~346ms beim Umschalten von ~535 Markern auf Canvas;
// Marker-Reprojektion dominiert, NICHT die Labels [~3ms]). DEFAULT AN; per ?canvasmarkers=0 abschaltbar.
// Edit-Modus bleibt komplett DOM (syncLocationMarkerVisibility: canvasOn = ... && !IS_EDIT_MODE), ebenso
// temporaer angepinnte/Routen-Wegpunkt-Marker. Klick: getroffenen Marker zu DOM "promoten" + Popup oeffnen.
// Formen/Farben/Groessen aus DENSELBEN Funktionen wie die DOM-Marker (eine Quelle der Wahrheit):
// Kreis-Familie (#cc2f2a), Staette = violette Raute (#7a4fd0), Metropole = Gold-Akzentring (#e7b04a),
// weisse Kontur + 1px-Dunkel-Hairline rgba(0,0,0,.55) -- 1:1 zu css/features/location-popups-markers.css.
// 💣 DIESELBEN DREI TOENE STEHEN SEIT 26.08.2026 ALS TOKEN (--color-marker-settlement,
// --color-marker-settlement-site, --color-marker-settlement-contour in css/base/tokens.css) und werden
// von der Marker-CSS und von der Vorschau im Fenster „Zoombänder" von dort gelesen. Hier stehen sie
// als Zeichenkette, weil ein <canvas> keine CSS-Variable aufloest -- wer einen Ton aendert, aendert
// beide Stellen. Bewacht von js/map-features/__tests__/marker-konturbreite.test.js.

const LOCATION_CANVAS_MARKERS_ENABLED = (() => {
	try {
		return new URLSearchParams(window.location.search).get("canvasmarkers") !== "0";
	} catch (error) {
		return true;
	}
})();

// ⭐ NOTAUSGANG OHNE DEPLOY: ?markerscale=0 schaltet die Groessen-Gegenrechnung waehrend des Zooms
// ab und stellt das Verhalten von vor dem 26.08.2026 her -- alles waechst um den vollen
// Kartenfaktor und springt am zoomend auf seine echte Groesse zurueck. Dasselbe Mittel wie
// ?crossfade=0 bei den Beschriftungen: damit laesst sich am Bild vergleichen, ohne etwas
// hochzuladen, und ein Fehlgriff ist ohne Deploy abzustellen.
const LOCATION_MARKER_ZOOM_SCALE_ENABLED = (() => {
	try {
		return new URLSearchParams(window.location.search).get("markerscale") !== "0";
	} catch (error) {
		return true;
	}
})();

const LOCATION_CANVAS_TYPES = new Set(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"]);

// Active/clicked settlement highlight (Owner: the active location's marker fills gold-yellow). The
// active id lives in runtime-state (activeLocationPublicId). These helpers set/clear it, repaint the
// canvas, and toggle a DOM-marker class so BOTH render paths follow. Reading the token (not a hardcode)
// keeps it theme-correct.
function getLocationMarkerActiveColor() {
	try {
		return getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim() || "#f0b429";
	} catch (error) {
		return "#f0b429";
	}
}

// DOM markers (edit mode / promoted / temporarily pinned) turn gold via CSS; canvas dots are handled in
// _redraw. Move the class to the currently-active marker (or remove it everywhere when nothing active).
function applyActiveLocationMarkerClass() {
	document.querySelectorAll(".location-visual-marker--active")
		.forEach((el) => el.classList.remove("location-visual-marker--active"));
	if (!activeLocationPublicId || typeof locationMarkers === "undefined") {
		return;
	}
	const entry = locationMarkers.find((m) => m && m.publicId === activeLocationPublicId);
	const el = entry && entry.marker && typeof entry.marker.getElement === "function" ? entry.marker.getElement() : null;
	if (el) {
		el.classList.add("location-visual-marker--active");
	}
}

// Die Auswahl faerbt nicht nur den Siedlungs-Marker gold, sondern auch den Wegpunkt-Marker derselben
// Stadt (route-render.js) und die Perle im Infopanel -- alle drei haengen an activeLocationPublicId.
// typeof-Guard: route-render.js wird nach dieser Datei geladen.
function syncActiveLocationDependents() {
	applyActiveLocationMarkerClass();
	if (typeof applyActiveRouteWaypointMarkers === "function") {
		applyActiveRouteWaypointMarkers();
	}
	if (typeof applyActiveWaypointRow === "function") {
		applyActiveWaypointRow();
	}
}

function setActiveLocationMarker(entryOrId) {
	const publicId = typeof entryOrId === "string" ? entryOrId : (entryOrId && entryOrId.publicId) || "";
	if (!publicId || activeLocationPublicId === publicId) {
		return;
	}
	activeLocationPublicId = publicId;
	if (typeof locationCanvasLayer !== "undefined" && locationCanvasLayer._ready) {
		locationCanvasLayer._redraw();
	}
	syncActiveLocationDependents();
}

function clearActiveLocationMarker() {
	if (!activeLocationPublicId) {
		return;
	}
	activeLocationPublicId = "";
	if (typeof locationCanvasLayer !== "undefined" && locationCanvasLayer._ready) {
		locationCanvasLayer._redraw();
	}
	syncActiveLocationDependents();
	// Auch das Infopanel entmarkieren: sonst bliebe seine Perle golden stehen, waehrend die Karte ihre
	// Auswahl schon verloren hat (der Panel-Zustand haengt am Namen, nicht an der publicId).
	if (typeof window !== "undefined" && typeof window.avesmapsClearInfopanelActiveWaypoint === "function") {
		window.avesmapsClearInfopanelActiveWaypoint();
	}
}

if (typeof window !== "undefined") {
	window.avesmapsSetActiveLocation = setActiveLocationMarker;
	window.avesmapsClearActiveLocation = clearActiveLocationMarker;
}

const locationCanvasLayer = {
	_map: null,
	_canvas: null,
	_ctx: null,
	_entries: [],
	_ready: false,
	_cursorActive: false,
	// Liegt gerade eine CSS-Zoom-Animation? Waehrenddessen traegt der Canvas eine Transform, und
	// _onMove darf sie nicht mit einem setPosition ueberschreiben.
	_cssZoomActive: false,
	_topLeftLatLng: null,
	// Die je Ortsklasse gerechnete Groessenkorrektur waehrend der Zoom-Animation ({ typ: faktor }).
	// `null` heisst: keine Animation, zeichne normal.
	// 💣 Muss in _reset zurueckgesetzt werden, sonst zeichnet jeder spaetere Pan die Marker in einer
	// Zwischengroesse -- und zwar unauffaellig, weil sie dann einfach dauerhaft ein bisschen falsch
	// sind statt sichtbar zu springen.
	_zoomGroessenFaktoren: null,
	_zoomBildAnforderung: 0,
	// 💣 DIE EINGEFRORENE BILDSCHIRMLAGE JEDES MARKERS, in QUELL-Koordinaten, aufgenommen im
	// zoomanim. Ohne sie ist die ganze Gegenrechnung unbrauchbar -- siehe _friereLagenEin().
	_zoomLagen: null,

	init(map) {
		if (this._ready || !LOCATION_CANVAS_MARKERS_ENABLED) {
			return;
		}
		this._map = map;
		if (!map.getPane("locationCanvasPane")) {
			map.createPane("locationCanvasPane");
			const locationsPane = map.getPane("locationsPane");
			const baseZ = locationsPane ? (parseInt(window.getComputedStyle(locationsPane).zIndex, 10) || 600) : 600;
			const pane = map.getPane("locationCanvasPane");
			pane.style.zIndex = String(baseZ - 1); // DOM-Marker (Metropole etc.) liegen drueber
			pane.style.pointerEvents = "none";      // Klicks gehen an die Karte -> Hit-Test in _onClick
		}
		this._canvas = L.DomUtil.create("canvas", "location-canvas-layer", map.getPane("locationCanvasPane"));
		this._canvas.style.position = "absolute";
		this._canvas.style.top = "0";
		this._canvas.style.left = "0";
		// 🔴 MITSKALIEREN WAEHREND DES ZOOMS (Owner 24.08.2026: „mach den marker-canvas
		// mitskalieren“). Bis hierher tat dieser Canvas als EINZIGES Overlay nichts waehrend der
		// Zoom-Animation: die Markierungen standen ~250 ms still, waehrend Kacheln, Grenzen und
		// Wege unter ihnen skalierten, und sassen erst am zoomend wieder richtig. Eine Blende hat
		// das seit Juni VERDECKT; seit 5184484e gibt es sie nicht mehr, also wird es behoben statt
		// verdeckt. Die Klasse aktiviert unter `.leaflet-zoom-anim` Leaflets Transform-Easing.
		// ⚠️ Der Preis, und er ist der gleiche wie bei Kacheln und Grenzen: die Markierungen haben
		// feste Pixelgroessen und wachsen waehrend der Animation mit, bevor sie am zoomend auf ihre
		// Groesse fuer die neue Stufe zurueckspringen. Dafuer bleiben sie auf ihrem Fleck der Karte.
		this._canvas.classList.add("leaflet-zoom-animated");
		this._canvas.style.transformOrigin = "0 0";
		this._ctx = this._canvas.getContext("2d");
		map.on("moveend zoomend viewreset resize", this._reset, this);
		map.on("move", this._onMove, this);
		map.on("zoomstart", this._onZoomStart, this);
		map.on("zoomanim", this._onZoomAnim, this);
		map.on("click", this._onClick, this);
		map.on("mousemove", this._onMouseMove, this);
		this._reset();
		this._ready = true;
		// Click arbiter: roads/regions/territories call this first and defer to a settlement here.
		window.avesmapsTryOpenLocationAtContainerPoint = (containerPoint) => this._tryOpenAtContainerPoint(containerPoint);
	},

	setEntries(entries) {
		if (!this._ready) {
			return;
		}
		const zoomLevel = this._map.getZoom();
		const visualZoom = getVisualZoomLevel(zoomLevel);
		const inPowerlineMode = typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines";
		this._entries = entries.map((entry) => {
			const locationType = entry.locationType;
			const isSite = locationType === "gebaeude";
			const markerSize = getLocationMarkerSize(locationType, zoomLevel);
			const core = getLocationMarkerCoreRadius(locationType, zoomLevel);
			const contour = getLocationMarkerBorderWidth(locationType, zoomLevel);
			// Form/Sichtbarkeit der Sonderformen EXAKT wie createLocationMarkerIcon (eine Quelle der Wahrheit):
			const isDiamond = isSite && visualZoom >= 4;
			const isCapital = locationType === "metropole" && visualZoom >= 3 && markerSize >= 14;
			// Kraftlinien-Modus: Nodices als leuchtende „Ley-Knoten" zeichnen (heben sich von den Linien ab).
			const leyNode = inPowerlineMode && !!(entry.location && entry.location.isNodix);
			return {
				entry,
				// 💣 Die Ortsklasse muss MIT: die Groessenkorrektur waehrend der Zoom-Animation ist je
				// Klasse verschieden (Metropole waechst 1,414 je Stufe, Gebaeude 2,106), und _redraw
				// koennte sie sonst nicht auseinanderhalten. Ein gemeinsamer Faktor waere genau die
				// Tafel-Loesung, die der Owner am 26.08.2026 verworfen hat.
				typ: locationType,
				latLng: entry.marker.getLatLng(),
				core,
				contour,
				isDiamond,
				isCapital,
				accentRing: isCapital ? Math.round(markerSize * 0.12) : 0,
				fill: isSite ? "#7a4fd0" : "#cc2f2a",
				leyNode,
				leyR: leyNode ? Math.max(5, (core + contour) * 1.7) : 0,
			};
		});
		// Groesse/Position IMMER frisch aus dem aktuellen Kartenzustand ziehen (nicht nur neu zeichnen):
		// beim ersten -- kontaktlosen -- Datenload kann der Canvas aus init() noch mit falscher Groesse/
		// Position stehen (die Karte war beim init evtl. nicht final vermessen) -> Marker unsichtbar bis zum
		// ersten Pan. _reset() = setPosition + getSize + Opacity + Redraw, also erscheinen die Marker auch
		// ohne Interaktion. (_entries ist oben bereits gesetzt.)
		this._reset();
	},

	_reset() {
		if (!this._ready) {
			return;
		}
		// 💣 ERST DAS ZOOMFENSTER SCHLIESSEN UND DIE TRANSITION LOESCHEN. Bliebe die
		// Transform-Transition liegen, animierte jeder Pan die Position nach -- genau die Regression,
		// die am 24.08.2026 bei den Grenzlinien gemeldet wurde („ziehen 2x nach“). setPosition
		// direkt darunter setzt die Zoom-Skalierung zurueck.
		this._cssZoomActive = false;
		this._canvas.style.transition = "";
		// 💣 UND DIE GROESSENKORREKTUR MIT. Sie gilt nur waehrend der Animation; bliebe sie stehen,
		// zeichnete jeder spaetere Pan die Marker in einer Zwischengroesse -- unauffaellig, weil sie
		// dann dauerhaft ein bisschen falsch sind statt sichtbar zu springen. _reset laeuft an
		// moveend/zoomend/viewreset/resize und ist damit die einzige Stelle, die alle Ausgaenge deckt.
		if (this._zoomBildAnforderung) { cancelAnimationFrame(this._zoomBildAnforderung); }
		this._zoomBildAnforderung = 0;
		this._zoomGroessenFaktoren = null;
		this._zoomLagen = null;
		const size = this._map.getSize();
		const dpr = avesmapsCanvasDpr();   // Telefon-Deckel aus runtime-state.js
		L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]).round());
		this._canvas.width = Math.round(size.x * dpr);
		this._canvas.height = Math.round(size.y * dpr);
		this._canvas.style.width = `${size.x}px`;
		this._canvas.style.height = `${size.y}px`;
		// Bezugspunkt fuer die Zoom-Transform: die Weltkoordinate der linken oberen Canvas-Ecke.
		this._topLeftLatLng = this._map.containerPointToLatLng([0, 0]);
		this._redraw();
	},

	_onMove() {
		// ⚠️ Waehrend der CSS-Zoom-Animation NICHT eingreifen: setPosition wuerde die Transform
		// ueberschreiben, die das Mitskalieren traegt.
		if (this._cssZoomActive) { return; }
		if (!this._ready) {
			return;
		}
		L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]).round());
		this._redraw();
	},

	_onZoomStart() {
		// 🔴 HIER BLENDET NICHTS. Owner 24.08.2026: „die ortsmarker sollen auch nicht ein- und ausblenden,
		// weil die stabil erscheinen sollen ... nur labels sollen ein- und ausblenden“. Bis 5184484e stand
		// hier eine Ausblendung (100 ms), die den Sprung beim Zoom VERDECKT hat. Behoben wird er jetzt an
		// der Ursache -- der Canvas skaliert mit, siehe _onZoomAnim.
		// ⚠️ Der Handler bleibt als benannte Stelle stehen: er ist der Ort, an dem die naechste Person
		// nach der alten Blende sucht.
	},

	/**
	 * Das Mitskalieren waehrend der CSS-Zoom-Animation -- dieselbe Rechnung wie in den uebrigen
	 * Canvas-Overlays (boundary, contested-hatch, path-labels, river-arrows).
	 * 💣 `_latLngToNewLayerPoint` ist Leaflet-INTERN und in 1.9.4 vorhanden; ohne den Guard wirft ein
	 * kuenftiges Leaflet hier bei jedem Zoom, und die Markierungen blieben ganz weg. Ebenso ohne
	 * `_topLeftLatLng`: das steht erst nach dem ersten _reset, und der zoomanim davor waere ein
	 * Sprung ins Leere.
	 */
	_onZoomAnim(event) {
		if (!this._ready || !this._topLeftLatLng) { return; }
		if (typeof this._map._latLngToNewLayerPoint !== "function") { return; }
		this._cssZoomActive = true;
		this._canvas.style.transition = avesmapsZoomTransition("transform");
		const scale = this._map.getZoomScale(event.zoom);
		const offset = this._map._latLngToNewLayerPoint(this._topLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(this._canvas, offset, scale);
		this._starteGroessenGegenrechnung(event.zoom, scale);
	},

	/**
	 * 🔴 DIE GEGENRECHNUNG DER MARKERGROESSEN (Owner-Entscheid 26.08.2026, Entwurf §3.1).
	 *
	 * Waehrend der Animation wird der Canvas Bild fuer Bild mit korrigierten Groessen neu gezeichnet,
	 * damit jede Ortsklasse auf ihrer echten Zielgroesse LANDET statt zurueckzuschnappen. Vorher
	 * wuchs alles um den vollen Kartenfaktor 2 und sprang am zoomend zurueck -- die Metropole um
	 * -29 %, das Gebaeude um +5 %, und dazwischen jede Klasse um einen anderen Betrag.
	 *
	 * ⭐ Das Zeichnen darf hier stehen, weil der Zoom eine CSS-Transform-Transition ist und auf dem
	 * Compositor laeuft -- Arbeit auf dem Hauptthread haelt die Bewegung nicht an
	 * (docs/kartenflaechen-und-zoomblenden.md §5). Und es ist billig: gemessen 0,2 ms je redraw
	 * (Median ueber 25 Laeufe bei 326 Eintraegen, live 26.08.2026; p90 0,4 ms, max 1,2 ms). Der
	 * Grenzen-Canvas kostet an derselben Stelle 52-99 ms -- dort waere dasselbe Mittel unbezahlbar,
	 * und deshalb bleibt die Grenzlinien-Breite der eine ungeloeste Ausreisser.
	 *
	 * 💣 OHNE cancelAnimationFrame laeuft die Schleife nach einem abgebrochenen Zoom weiter und
	 * zeichnet gegen eine Animation, die es nicht mehr gibt. Ein zweiter Zoomschritt waehrend des
	 * ersten (Mausrad zweimal schnell) ist der Normalfall, nicht der Sonderfall.
	 *
	 * @param {number} zielZoom Zoomstufe, auf die animiert wird (event.zoom)
	 * @param {number} massstab map.getZoomScale(zielZoom) -- 2 je Stufe hinein, 0,5 hinaus
	 */
	/**
	 * 💣 DIE BILDSCHIRMLAGE JEDES MARKERS EINFRIEREN -- die Zeile, an der der erste Versuch
	 * gescheitert ist (Rueckbau b1bd8df7, Owner: „ortsmarkierungen springen wild umher").
	 *
	 * Leaflet setzt seinen internen Zustand UNMITTELBAR NACH dem zoomanim-Ereignis auf die
	 * Zielstufe (js/third-party/leaflet.js, minifiziert):
	 *     _animateZoom: … this.fire("zoomanim", …), … this._move(center, zoom, void 0, true)
	 * und `_move` setzt `this._zoom` UND `this._pixelOrigin`. Die 250 ms Animation laufen also mit
	 * map.getZoom() = ZIEL; nur das Bild interpoliert ueber die CSS-Transform.
	 *
	 * Wer waehrend der Animation `latLngToLayerPoint` ruft, bekommt damit ZIEL-Koordinaten --
	 * waehrend der Canvas die Transform traegt, die QUELL- auf Zielkoordinaten abbildet. Der Inhalt
	 * wird dann ZWEIMAL transformiert: die Marker fliegen auseinander, und solche, die ausserhalb
	 * der Zeichenflaeche lagen, werden hereingezogen. Live sah das aus wie „fremde Ortschaften, die
	 * es auf keiner der beiden Stufen gibt" -- es waren die richtigen an falschen Stellen.
	 *
	 * ⭐ Deshalb wird die Lage EINMAL hier genommen, solange die Karte noch auf der Quellstufe
	 * steht, und waehrend der Animation nur noch abgelesen. Nebenbei ist das billiger: pro Bild
	 * entfallen alle Projektionen.
	 * ⚠️ Dieser Aufruf MUSS im zoomanim-Handler stehen, nicht in der Bildschleife -- die laeuft ein
	 * Bild spaeter, und dann ist der Zustand schon umgestellt.
	 */
	_friereLagenEin() {
		const origin = this._map.containerPointToLayerPoint([0, 0]).round();
		this._zoomLagen = this._entries.map((item) => {
			const p = this._map.latLngToLayerPoint(item.latLng);
			return { x: p.x - origin.x, y: p.y - origin.y };
		});
	},

	_starteGroessenGegenrechnung(zielZoom, massstab) {
		if (!LOCATION_MARKER_ZOOM_SCALE_ENABLED) { return; }   // ?markerscale=0
		if (typeof avesmapsMarkerZoomSizeFactor !== "function" || typeof avesmapsZoomEasing !== "function") {
			return;   // zoom-uebergang.js nicht geladen -> Verhalten wie vorher, kein Absturz
		}
		if (this._zoomBildAnforderung) { cancelAnimationFrame(this._zoomBildAnforderung); }
		const vonZoom = this._map.getZoom();
		// 🔴 ZUERST DIE LAGEN EINFRIEREN, UND ZWAR HIER. Siehe _friereLagenEin() -- eine Zeile
		// spaeter ist es zu spaet.
		this._friereLagenEin();
		// ⚠️ Die Faktoren haengen nur an der Ortsklasse, nicht am einzelnen Marker -- einmal je Klasse
		// rechnen, nicht einmal je Eintrag. Live sind das sechs Klassen gegen mehrere hundert Marker.
		const klassen = [];
		for (const item of this._entries) {
			if (item.typ && klassen.indexOf(item.typ) === -1) { klassen.push(item.typ); }
		}
		const groessen = klassen.map((typ) => ({
			typ,
			alt: getLocationMarkerSize(typ, vonZoom),
			neu: getLocationMarkerSize(typ, zielZoom),
		}));
		if (!groessen.length) { return; }
		// ⚠️ Die groesste gezeichnete Markerhaelfte -- der Massstab dafuer, ob eine Faktoraenderung
		// ueberhaupt ein Pixel bewegt. Ohne ihn zeichnete die Schleife auch dort neu, wo die Kurve
		// flach laeuft (Anfang und Ende von ease-in-out) und sich nichts sichtbar aendert.
		let groesstesR = 0;
		for (const item of this._entries) {
			const r = (item.leyNode ? item.leyR : item.core + item.contour + item.accentRing) || 0;
			if (r > groesstesR) { groesstesR = r; }
		}
		const start = performance.now();
		let letzte = null;
		const schritt = () => {
			const t = (performance.now() - start) / AVESMAPS_ZOOM_DAUER_MS;
			const e = avesmapsZoomEasing(t);
			const faktoren = {};
			let groessteAenderung = 0;
			for (const g of groessen) {
				faktoren[g.typ] = avesmapsMarkerZoomSizeFactor(g.alt, g.neu, e, massstab);
				if (letzte) {
					const d = Math.abs(faktoren[g.typ] - letzte[g.typ]);
					if (d > groessteAenderung) { groessteAenderung = d; }
				}
			}
			// ⭐ SPARBREMSE: nur zeichnen, wenn sich dadurch mindestens ein halbes Pixel bewegt.
			// ⚠️ SIE IST VORSORGE, KEINE NOTWENDIGKEIT -- und das ist gemessen, nicht vermutet.
			// Am 26.08.2026 im zeichnenden Browser des Owners ueber einen echten Zoomschritt:
			//   ohne Neuzeichnen  Median 16,7 ms, schlechtestes Bild 149,2 ms,  0 Neuzeichnungen
			//   jedes 4. Bild     Median 16,6 ms, schlechtestes Bild 134,8 ms,  5 Neuzeichnungen
			//   jedes Bild        Median 16,7 ms, schlechtestes Bild 132,6 ms, 18 Neuzeichnungen
			// Alle drei sind 60 Bilder/s; das Zeichnen kostet nichts Messbares. Das schlechteste
			// Bild (~140 ms) ist die Hauptthread-Blockade am zoomend und liegt AUCH OHNE jede
			// Neuzeichnung an -- sie gehoert nicht hierher.
			// 🪤 Eine fruehere Messung ergab „0,2 ms je redraw" und war WERTLOS: sie lief in einem
			// Browsertab im Hintergrund, und der zeichnet nicht. Gemessen wurde damit der
			// JS-Anteil ohne jede Malarbeit. Wer Malkosten misst, braucht eine sichtbare Ansicht.
			// 🔴 Das LETZTE Bild wird IMMER gezeichnet (t >= 1): dort sitzt die Landung ohne
			// Sprung, und genau die ist der Sinn der ganzen Uebung.
			const letztesBild = t >= 1;
			if (letztesBild || !letzte || groessteAenderung * groesstesR >= 0.5) {
				this._zoomGroessenFaktoren = faktoren;
				this._redraw();
				letzte = faktoren;
			}
			// ⚠️ Der letzte Zustand bleibt STEHEN, bis _reset ihn am zoomend abraeumt. Wer hier auf
			// null zuruecksetzt, macht aus der beseitigten Landung wieder einen Sprung -- nur zwei
			// Bilder frueher, und dann sucht ihn niemand mehr hier.
			this._zoomBildAnforderung = t < 1 ? requestAnimationFrame(schritt) : 0;
		};
		this._zoomBildAnforderung = requestAnimationFrame(schritt);
	},

	_redraw() {
		if (!this._ready) {
			return;
		}
		const ctx = this._ctx;
		const dpr = avesmapsCanvasDpr();   // Telefon-Deckel aus runtime-state.js
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// Gerundeter Ursprung = exakt die (auf ganze Pixel gerundete) Canvas-Position -> kein Sub-Pixel-Versatz,
		// scharf auf Retina (fraktionales transform verwischt sonst).
		const origin = this._map.containerPointToLayerPoint([0, 0]).round();
		const TWO_PI = Math.PI * 2;
		const disc = (x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fillStyle = color; ctx.fill(); };
		// Active/clicked settlement -> gold-yellow core fill (Owner). Read the token ONCE per redraw (not
		// per marker) so it follows the theme without hardcoding a hex on the canvas; empty when nothing active.
		const activeId = typeof activeLocationPublicId !== "undefined" ? activeLocationPublicId : "";
		const activeGold = activeId ? getLocationMarkerActiveColor() : "";
		// 🔴 Die Groessenkorrektur der laufenden Zoom-Animation (siehe _starteGroessenGegenrechnung).
		// `null` ausserhalb einer Animation -> Faktor 1 -> exakt das Verhalten von vorher.
		const zoomFaktoren = this._zoomGroessenFaktoren;
		// 💣 WAEHREND DER ZOOM-ANIMATION WIRD NICHT PROJIZIERT, SONDERN ABGELESEN. Leaflets interner
		// Zustand steht dann schon auf der Zielstufe (siehe _friereLagenEin), eine Projektion gaebe
		// also Ziel-Koordinaten -- und der Canvas traegt die Transform, die Quell- auf
		// Zielkoordinaten abbildet. Das Ergebnis waere doppelt transformiert.
		// ⚠️ Laengenabgleich als Riegel: passt der Schnappschuss nicht zu den Eintraegen, wird lieber
		// gar nicht korrigiert als falsch gezeichnet (die sichere Richtung).
		const lagen = (this._zoomLagen && this._zoomLagen.length === this._entries.length)
			? this._zoomLagen : null;
		for (let i = 0; i < this._entries.length; i++) {
			const item = this._entries[i];
			if (item.entry._canvasPromoted) {
				continue;
			}
			let x, y;
			if (lagen) {
				x = lagen[i].x;
				y = lagen[i].y;
			} else {
				const layerPoint = this._map.latLngToLayerPoint(item.latLng);
				x = layerPoint.x - origin.x;
				y = layerPoint.y - origin.y;
			}
			const fill = (activeGold && item.entry.publicId && item.entry.publicId === activeId) ? activeGold : item.fill;
			// ⚠️ NUR DIE GROESSEN, NICHT DIE LAGE: x/y kommen unveraendert aus der Projektion und
			// werden von der Canvas-Transform mitskaliert -- das ist richtig so und darf nicht
			// gegengerechnet werden. Und NICHT die Formentscheidungen (isDiamond/isCapital): die
			// duerfen waehrend der Animation nicht umspringen.
			const k = (zoomFaktoren && zoomFaktoren[item.typ]) || 1;
			if (item.leyNode) {
				// Leuchtender Kraftlinien-Knoten: weicher Schein -> heller Kern -> pinker Punkt.
				const leyR = item.leyR * k;
				ctx.save();
				ctx.shadowColor = "#ff7da0";
				ctx.shadowBlur = 16;
				disc(x, y, leyR, "#fff3f7");
				ctx.shadowBlur = 8;
				disc(x, y, leyR * 0.92, "#ffd3e0");
				ctx.restore();
				disc(x, y, Math.max(1.5, leyR * 0.42), "#ff3d68");
				continue;
			}
			const core = item.core * k;
			const outer = core + item.contour * k; // = Aussenkante der weissen Kontur (markerSize/2)
			const accentRing = item.accentRing * k;
			if (item.isDiamond) {
				// Besondere Staette: gedrehtes Quadrat (Raute) -- Hairline -> weisse Kontur -> Fuellung.
				this._square(x, y, outer + 1, "rgba(0, 0, 0, 0.55)");
				this._square(x, y, outer, "#ffffff");
				this._square(x, y, core, fill);
				continue;
			}
			if (item.isCapital) {
				// Metropole: 1px-Dunkel -> Gold-Band -> 1px-Dunkel (1:1 zum --capital box-shadow-Stapel).
				disc(x, y, outer + accentRing + 1, "rgba(0, 0, 0, 0.35)");
				disc(x, y, outer + accentRing, "#e7b04a");
			}
			disc(x, y, outer + 1, "rgba(0, 0, 0, 0.55)");
			disc(x, y, outer, "#ffffff");
			disc(x, y, core, fill);
		}
	},

	_square(centerX, centerY, half, color) {
		const ctx = this._ctx;
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = color;
		ctx.fillRect(-half, -half, half * 2, half * 2);
		ctx.restore();
	},

	_onClick(event) {
		// A settlement hit sets the active gold marker (in _tryOpen). No settlement here -> deselect: this is
		// either an empty click or a lower-priority feature (road/region), neither of which is the active
		// location. (Road/region layers call _tryOpen themselves first, so a settlement still wins.)
		if (!this._tryOpenAtContainerPoint(event.containerPoint)) {
			clearActiveLocationMarker();
		}
	},

	// Shared settlement hit-test = the click "arbiter" (see docs/click-arbiter-coordination.md): opens
	// the settlement whose marker sits under `point` and returns TRUE, else FALSE. Lower-priority layers
	// (Strasse/Fluss, Region, Herrschaftsgebiet) call this FIRST via window.avesmapsTryOpenLocationAt-
	// ContainerPoint and defer when it wins. Priority: Siedlung > Strasse/Fluss > Region > Gebiet.
	_tryOpenAtContainerPoint(point) {
		if (!this._ready || !this._entries.length || !point) {
			return false;
		}
		let hit = null;
		let hitDistance = Infinity;
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const containerPoint = this._map.latLngToContainerPoint(item.latLng);
			const distance = Math.hypot(containerPoint.x - point.x, containerPoint.y - point.y);
			const hitRadius = item.core * (1 + LOCATION_MARKER_CONTOUR_RATIO) + 3;
			if (distance <= hitRadius && distance < hitDistance) {
				hit = item;
				hitDistance = distance;
			}
		}
		if (!hit) {
			return false;
		}
		const entry = hit.entry;

		// Owner: clicking a settlement makes it the active location -> gold marker fill. Set it here (before
		// the panel/popup branch) so it applies in BOTH modes; a click resolves to exactly one settlement.
		setActiveLocationMarker(entry);

		// Infopanel (?infopanel=true): Feature-Info ins rechte Panel statt ins schwebende Popup --
		// VOR dem DOM-Marker-Promote/openPopup abzweigen (sonst bleibt ein promoteter Marker oder ein
		// offenes Popup zurueck).
		if (typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
			// Floating box ALONGSIDE the panel (Owner: keep seeing WHERE the place is). Direct map click
			// only -- breadcrumb/deeplink/auto-open go through avesmapsShowLocationInInfopanel WITHOUT this
			// arbiter, so they open the panel only (§6 rule).
			if (typeof openFloatingLocationBoxForMarkerEntry === "function") {
				openFloatingLocationBoxForMarkerEntry(entry);
			}
			return true;
		}
		entry._canvasPromoted = true;
		this._redraw();
		// The DOM marker's icon may be stale -- it was set at the creation zoom and never updated while
		// the marker lived on the canvas overlay. Refresh it to the CURRENT zoom so the promoted marker
		// matches the canvas dot instead of rendering tiny.
		const promotedZoomLevel = this._map.getZoom();
		if (entry.iconZoomLevel !== promotedZoomLevel) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, promotedZoomLevel));
			entry.iconZoomLevel = promotedZoomLevel;
		}
		if (!this._map.hasLayer(entry.marker)) {
			this._map.addLayer(entry.marker);
		}
		entry.marker.once("popupclose", () => {
			entry._canvasPromoted = false;
			if (this._map.hasLayer(entry.marker)) {
				this._map.removeLayer(entry.marker);
			}
			this._redraw();
		});
		entry.marker.openPopup();
		return true;
	},

	// Hover-Cursor fuer die Canvas-Siedlungen: das Canvas-Pane ist pointer-events:none (Klicks laufen ueber den
	// Hit-Test in _onClick), daher gibt es ueber den gezeichneten Punkten sonst KEINEN Finger-Cursor wie bei
	// DOM-Markern. Wir setzen ihn hier per Hit-Test auf mousemove -> klickbare Orte signalisieren das wieder.
	// Nur Desktop (mousemove feuert nicht bei Touch); geschrieben wird nur beim Zustandswechsel (kein Thrashing),
	// und auf "" zuruecksetzen laesst Leaflets grab/grabbing-Cursor unangetastet. Gleiche Trefferflaeche wie _onClick.
	_onMouseMove(event) {
		if (!this._ready) {
			return;
		}
		let over = false;
		const point = event.containerPoint;
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const containerPoint = this._map.latLngToContainerPoint(item.latLng);
			const dx = containerPoint.x - point.x;
			const dy = containerPoint.y - point.y;
			const hitRadius = item.core * (1 + LOCATION_MARKER_CONTOUR_RATIO) + 3;
			if (dx * dx + dy * dy <= hitRadius * hitRadius) {
				over = true;
				break;
			}
		}
		if (over !== this._cursorActive) {
			this._map.getContainer().style.cursor = over ? "pointer" : "";
			this._cursorActive = over;
		}
	},
};
