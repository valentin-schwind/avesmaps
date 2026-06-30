// Top-of-viewport loading progress bar (Google/YouTube-style), driver for css/features/loading-bar.css.
// Covers two cases with one mechanism (a small set of pending "jobs"):
//   B) initial page load: a "boot" job, active from the moment this script runs until the map data is
//      applied (the "avesmaps:map-ready" event, dispatched at the end of the route-data .then in routing.js).
//   A) base-map tiles: a "tiles" job, driven by Leaflet's tile-layer "loading"/"load" events (wired via
//      AvesmapsLoadingBar.attachTiles, called from createBaseTileLayer in bootstrap.js).
// The bar trickles toward 90% while anything is pending and snaps to 100% + fades out when the last job
// finishes. Tile jobs only show the bar after a short delay so fast (warm-cache) loads don't flash it; the
// boot job shows immediately. Purely cosmetic -- it does not make anything faster, it removes the
// "is it frozen?" feeling during the cold first load and tile fetches. Load this EARLY (before the heavy
// map scripts) so it appears during the initial load; it creates its own DOM and needs only document.body.
(function initLoadingBar() {
	if (typeof document === "undefined" || window.AvesmapsLoadingBar) {
		return;
	}
	const host = document.body || document.documentElement;
	if (!host) {
		return;
	}

	const bar = document.createElement("div");
	bar.id = "avesmaps-loading-bar";
	bar.className = "avesmaps-loading-bar";
	bar.setAttribute("aria-hidden", "true");
	const fill = document.createElement("div");
	fill.className = "avesmaps-loading-bar__fill";
	bar.appendChild(fill);
	host.appendChild(bar);

	const pending = new Set();
	let progress = 0;
	let visible = false;
	let trickleTimer = null;
	let hideTimer = null;
	let showDelayTimer = null;

	function paint() {
		fill.style.transform = "scaleX(" + progress.toFixed(4) + ")";
	}

	function trickle() {
		if (progress < 0.9) {
			progress += (0.9 - progress) * 0.08 + 0.004;
			paint();
		}
	}

	function show() {
		if (visible) {
			return;
		}
		visible = true;
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		progress = Math.max(progress, 0.08);
		bar.classList.add("avesmaps-loading-bar--active");
		paint();
		if (!trickleTimer) {
			trickleTimer = setInterval(trickle, 240);
		}
	}

	function complete() {
		if (trickleTimer) {
			clearInterval(trickleTimer);
			trickleTimer = null;
		}
		progress = 1;
		paint();
		hideTimer = setTimeout(() => {
			bar.classList.remove("avesmaps-loading-bar--active");
			visible = false;
			progress = 0;
			// Snap the fill back to empty without animating the rewind (would look like a bounce).
			fill.style.transition = "none";
			paint();
			window.requestAnimationFrame(() => {
				fill.style.transition = "";
			});
		}, 360);
	}

	function refresh() {
		if (pending.size > 0) {
			if (visible) {
				return;
			}
			if (pending.has("boot")) {
				show(); // initial load: show immediately, no flash concern
			} else if (!showDelayTimer) {
				// tile loads: only show if still pending after a beat -> warm/fast loads don't flash the bar
				showDelayTimer = setTimeout(() => {
					showDelayTimer = null;
					if (pending.size > 0) {
						show();
					}
				}, 160);
			}
		} else {
			if (showDelayTimer) {
				clearTimeout(showDelayTimer);
				showDelayTimer = null;
			}
			if (visible) {
				complete();
			}
		}
	}

	function inc(key) {
		pending.add(key);
		refresh();
	}

	function dec(key) {
		pending.delete(key);
		refresh();
	}

	// Boot job (B): active until the map data is applied.
	inc("boot");
	document.addEventListener("avesmaps:map-ready", function onReady() {
		document.removeEventListener("avesmaps:map-ready", onReady);
		dec("boot");
	});
	// Safety net: never let the boot bar hang forever (e.g. if the data load errors before dispatching ready).
	window.setTimeout(() => dec("boot"), 20000);

	// Tile job (A): wire a Leaflet tile layer's loading/load events. "load" fires when ALL current tiles are
	// loaded, so clearing on it is correct regardless of how many "loading" events fired.
	function attachTiles(layer) {
		if (!layer || typeof layer.on !== "function" || layer.__avesmapsLoadingBarBound) {
			return;
		}
		layer.__avesmapsLoadingBarBound = true;
		layer.on("loading", () => inc("tiles"));
		layer.on("load", () => dec("tiles"));
	}

	window.AvesmapsLoadingBar = { inc, dec, attachTiles };
})();
