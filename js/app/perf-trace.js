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

	window.__perftrace = { stats, installAll, targets: GLOBAL_TARGETS };
	console.log(
		"%c[perftrace] aktiv -- einmal an der ruckelnden Stelle reinzoomen, dann die Tabelle ablesen (groesste 'ms'-Zeile = Verursacher).",
		"color:#ff5f82;font-weight:bold"
	);
})();
