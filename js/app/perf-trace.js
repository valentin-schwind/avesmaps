// Gated zoom performance tracer -- ONLY active with ?perftrace=1 in the URL (zero overhead otherwise).
// Wraps the heavy functions that run synchronously on every zoom and logs a per-zoom breakdown to the
// console, so we can see WHICH function blocks the main thread instead of guessing. Diagnostic only: no UI
// change, no behaviour change. Reusable for future perf work.
//
// What it measures per zoom cycle (zoomstart -> settled):
//   - wall time of the cycle
//   - the longest "longtask" (>50ms main-thread block) during the cycle = the actual hang
//   - ms spent in each wrapped function (sorted), with call counts
//
// Targets are (re)wrapped on every zoomstart, which heals the political-layer override that replaces
// window.syncRegionVisibility at runtime (see the "DOPPELTE syncRegionVisibility" history). Nested calls
// (e.g. syncRegionVisibility -> *.redraw) overlap, so the per-function sum can exceed wall time -- read the
// single biggest row, not the sum.
(function initPerfTrace() {
	let enabled = false;
	try {
		enabled = new URLSearchParams(window.location.search).has("perftrace");
	} catch (error) {
		enabled = false;
	}
	if (!enabled) {
		return;
	}
	if (typeof map === "undefined" || !map || typeof map.on !== "function") {
		// Loaded before the map exists -> can't bind. (Place the <script> after bootstrap.js.)
		console.warn("[perftrace] map nicht verfuegbar -- Tracer inaktiv. perf-trace.js muss nach bootstrap.js geladen werden.");
		return;
	}

	const stats = Object.create(null); // label -> { ms, calls }
	const installed = Object.create(null); // label -> the wrapper function we installed
	let cycleActive = false;
	let cycleStartMs = 0;
	let longestTaskMs = 0;

	function record(label, durationMs) {
		const entry = stats[label] || (stats[label] = { ms: 0, calls: 0 });
		entry.ms += durationMs;
		entry.calls += 1;
	}

	function timed(label, fn) {
		const wrapper = function perfTraced() {
			const start = performance.now();
			try {
				return fn.apply(this, arguments);
			} finally {
				record(label, performance.now() - start);
			}
		};
		wrapper.__perfOrig = fn;
		installed[label] = wrapper;
		return wrapper;
	}

	// (Re)wrap a window-global function by name. Self-healing: if something replaced our wrapper (e.g. the
	// political loader reassigning window.syncRegionVisibility), wrap the new underlying function instead.
	function ensureWrappedGlobal(name) {
		const current = window[name];
		if (typeof current !== "function" || current === installed[name]) {
			return;
		}
		window[name] = timed(name, current);
	}

	// (Re)wrap obj[method] under a friendly label. Same self-healing check.
	function ensureWrappedMethod(obj, method, label) {
		if (!obj || typeof obj[method] !== "function" || obj[method] === installed[label]) {
			return;
		}
		obj[method] = timed(label, obj[method]);
	}

	const GLOBAL_TARGETS = [
		"syncRegionVisibility",         // political/region redraw (overridden at runtime -> heaviest suspect in Politik mode)
		"syncLocationMarkerVisibility", // which markers are visible at the new zoom (+ canvas entries)
		"syncPathRendering",            // re-style all paths for the new zoom
		"syncPathViewportCulling",      // add/remove paths by viewport
	];

	function installAll() {
		GLOBAL_TARGETS.forEach(ensureWrappedGlobal);
		ensureWrappedMethod(window.AvesmapsBoundaryCanvasOverlay, "redraw", "boundary.redraw");
		ensureWrappedMethod(window.AvesmapsContestedHatchOverlay, "redraw", "contested.redraw");
		ensureWrappedMethod(window.AvesmapsPathLabelCanvasOverlay, "redraw", "pathLabel.redraw");
		// locationCanvasLayer is a top-level const (global lexical scope, reachable from this classic script).
		// _reset is bound into Leaflet by reference (can't intercept), but _reset calls this._redraw() via lookup,
		// so wrapping _redraw captures the marker drawing cost.
		if (typeof locationCanvasLayer !== "undefined" && locationCanvasLayer) {
			ensureWrappedMethod(locationCanvasLayer, "_redraw", "markerCanvas.redraw");
		}
		// Leaflet-interne SVG-Pfad-Reprojektion -- laeuft NICHT in unseren Funktionen, ist aber der Hauptverdacht
		// fuer den z2->z3-Haenger: jedes sichtbare SVG-<path> (roads/rivers/regions, keine preferCanvas) wird bei
		// jedem Zoom neu projiziert (_project) und sein 'd'-String neu gebaut + ins DOM geschrieben (_updatePoly).
		// Bei tausenden punktreichen (Catmull-geglaetteten) Pfaden summiert sich das zur unsichtbaren langen Task.
		if (typeof L !== "undefined" && L) {
			if (L.SVG && L.SVG.prototype) {
				ensureWrappedMethod(L.SVG.prototype, "_updatePoly", "svg._updatePoly");
			}
			if (L.Polyline && L.Polyline.prototype) {
				ensureWrappedMethod(L.Polyline.prototype, "_project", "path._project");
			}
		}
	}

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (cycleActive && entry.duration > longestTaskMs) {
					longestTaskMs = entry.duration;
				}
			}
		}).observe({ entryTypes: ["longtask"] });
	} catch (error) {
		// longtask unsupported (e.g. Firefox) -> wall time + per-function breakdown still work.
	}

	map.on("zoomstart", () => {
		installAll(); // (re)wrap now -- heals any runtime override before the heavy handlers run
		for (const key in stats) {
			delete stats[key];
		}
		longestTaskMs = 0;
		cycleActive = true;
		cycleStartMs = performance.now();
	});

	map.on("zoomend", () => {
		const zoom = map.getZoom();
		// Defer past the synchronous zoomend + moveend handlers (two frames) so every wrapped function has run.
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
			cycleActive = false;
			const wallMs = performance.now() - cycleStartMs;
			const rows = Object.keys(stats)
				.map((label) => ({ fn: label, ms: Math.round(stats[label].ms * 10) / 10, calls: stats[label].calls }))
				.sort((a, b) => b.ms - a.ms);
			console.log(
				`%c[perftrace] zoom -> ${zoom} | wall ${wallMs.toFixed(0)}ms | laengste Task ${longestTaskMs.toFixed(0)}ms`,
				"color:#ff5f82;font-weight:bold"
			);
			if (rows.length) {
				console.table(rows);
			} else {
				console.log("[perftrace] keine erfassten Funktionsaufrufe in diesem Zoom.");
			}
		}));
	});

	// ---- Startlauf (Owner 12.08.2026) --------------------------------------------------------------
	//
	// Gemessen wurde am 12.08.2026 EIN Block von 13,8 s Hauptfaden waehrend des Starts -- aber nicht,
	// WORIN. Der Datenabruf selbst ist es nicht (18,4 MB, davon 2,1 s Server, 0,33 s Leitung, 0,07 s
	// JSON.parse), also liegt die Zeit im Aufbau. Dieselbe Wrap-Technik wie oben, nur an der anderen
	// Klammer: der Zoom hat `zoomstart`/`zoomend`, der Start hat „ab jetzt" bis `avesmaps:map-ready`.
	//
	// 💣 Die Bauer laufen in der `.then`-Kette von routeDataRequest (js/routing/routing.js), also
	// ASYNCHRON und erst nach dem Abruf. Diese Datei laeuft direkt nach bootstrap.js, lange davor --
	// das Wrappen kommt also rechtzeitig. Waere es andersherum, saehe die Tabelle einfach leer aus.
	// ⚠️ Eigener Zaehlspeicher: `stats` gehoert dem Zoom und wird bei jedem `zoomstart` geleert.
	const bootStats = Object.create(null);
	const BOOT_TARGETS = [
		"updateMapDataStatus",
		"prepareLocationData",   // ~2.800 Marker, baut jedes Popup-Markup vorab
		"preparePowerlineData",
		"prepareLabelData",
		"preparePathData",       // ~4.900 Wege, baut jedes Weg-Popup vorab
		"prepareRegionData",
		"applyPlannerStateFromUrl",
		"applyDisplayOptions",
		"focusMapOnActiveTargets",
		"updateMapView",
		"startLiveMapUpdates",
		"loadPoliticalTerritoryLayer", // laeuft in `deregraphic` mit -- die Grenzen der Standardansicht
	];
	const bootStartMs = performance.now();
	let bootLongestTaskMs = 0;
	let bootActive = true;

	// 💣 Was hier NICHT gewrappt werden konnte, wird GEMELDET, nicht verschwiegen. Eine Funktion, die
	// als `const` im lexikalischen Modulscope steht, ist keine window-Eigenschaft und laesst sich so
	// nicht abfangen -- ihre Zeile fehlte dann einfach in der Tabelle, und die fehlende Zeile sieht
	// aus wie „kostet nichts". Genau die Zeile waere aber der Verdaechtige.
	const nichtGewrappt = [];
	const bootTimeline = [];
	BOOT_TARGETS.forEach((name) => {
		const current = window[name];
		if (typeof current !== "function") {
			nichtGewrappt.push(name);
			return;
		}
		window[name] = function perfTracedBoot() {
			const start = performance.now();
			try {
				return current.apply(this, arguments);
			} finally {
				const ende = performance.now();
				const entry = bootStats[name] || (bootStats[name] = { ms: 0, calls: 0 });
				entry.ms += ende - start;
				entry.calls += 1;
				bootTimeline.push({ name, start, ende });
			}
		};
	});

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (bootActive && entry.duration > bootLongestTaskMs) {
					bootLongestTaskMs = entry.duration;
				}
			}
		}).observe({ entryTypes: ["longtask"] });
	} catch (error) {
		/* longtask unsupported -> Wandzeit und Aufschluesselung tragen allein */
	}

	document.addEventListener("avesmaps:map-ready", function onBootReady() {
		document.removeEventListener("avesmaps:map-ready", onBootReady);
		bootActive = false;
		const wallMs = performance.now() - bootStartMs;
		const rows = Object.keys(bootStats)
			.map((label) => ({ fn: label, ms: Math.round(bootStats[label].ms * 10) / 10, calls: bootStats[label].calls }))
			.sort((a, b) => b.ms - a.ms);
		const erfasst = rows.reduce((summe, zeile) => summe + zeile.ms, 0);
		console.log(
			`%c[perftrace] START | wall ${wallMs.toFixed(0)}ms | laengste Task ${bootLongestTaskMs.toFixed(0)}ms`
			+ ` | erfasst ${erfasst.toFixed(0)}ms (Rest: Abruf, Leaflet, Rendern)`,
			"color:#ff5f82;font-weight:bold"
		);
		if (rows.length) {
			console.table(rows);
		} else {
			console.log("[perftrace] keine erfassten Startfunktionen -- lief perf-trace.js zu spaet?");
		}
		// 💣 Die LUECKEN sind der eigentliche Fund. Die drei schwersten Bauer -- prepareLocationData,
		// preparePowerlineData, preparePathData -- sind `const` im globalen LEXIKALISCHEN Scope und
		// damit keine window-Eigenschaften: sie lassen sich nicht abfangen (gemessen 12.08.2026).
		// Ihre Zeit steht deshalb nicht in der Tabelle, sondern zwischen zwei Zeilen davon. Die
		// Reihenfolge in der `.then`-Kette von routing.js ist fest, also ist jede Luecke zuordenbar:
		// updateMapDataStatus -> [prepareLocationData, preparePowerlineData] -> prepareLabelData ->
		// [preparePathData] -> prepareRegionData -> ...
		const nachStart = bootTimeline.slice().sort((a, b) => a.start - b.start);
		const luecken = [];
		for (let i = 1; i < nachStart.length; i += 1) {
			const luecke = nachStart[i].start - nachStart[i - 1].ende;
			if (luecke > 50) {
				luecken.push({ zwischen: `${nachStart[i - 1].name} -> ${nachStart[i].name}`, ms: Math.round(luecke) });
			}
		}
		if (luecken.length) {
			console.log("%c[perftrace] Luecken > 50ms (hier laufen die nicht abfangbaren Bauer):", "color:#ff5f82;font-weight:bold");
			console.table(luecken.sort((a, b) => b.ms - a.ms));
		}
		if (nichtGewrappt.length) {
			console.warn("[perftrace] nicht direkt messbar (kein window-Eintrag) -- ihre Zeit steckt in den"
				+ " Luecken oben:", nichtGewrappt.join(", "));
		}
	});

	window.__perftrace = { stats, bootStats, bootTimeline, installAll, targets: GLOBAL_TARGETS, bootTargets: BOOT_TARGETS };
	console.log(
		"%c[perftrace] aktiv -- die START-Tabelle kommt von selbst, sobald die Karte fertig ist."
		+ " Fuer den Zoom: einmal an der ruckelnden Stelle reinzoomen (groesste 'ms'-Zeile = Verursacher).",
		"color:#ff5f82;font-weight:bold"
	);
})();
