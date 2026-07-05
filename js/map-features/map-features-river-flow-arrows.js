// Flow-direction arrows on rivers, EDIT MODE ONLY (Flussrichtung spec §5). One canvas pane;
// arrows are placed at a fixed SCREEN spacing along every Flussweg with a valid flow.dir
// (screen spacing = zoom-dependent density for free). Segments without a dir stay arrow-less
// on purpose: editors see immediately where the direction is unknown. `map` is created LAST
// in bootstrap.js -- poll until it exists (same pattern as the label canvas overlay).
(function initRiverFlowArrowOverlay() {
	"use strict";

	const PANE_NAME = "avesmapsRiverFlowArrowPane";
	const ARROW_SPACING_PX = 56;
	const ARROW_MIN_ZOOM = 1;

	function ready() {
		return typeof map !== "undefined" && map && typeof L !== "undefined"
			&& typeof IS_EDIT_MODE !== "undefined" && typeof pathData !== "undefined";
	}

	function start() {
		if (!ready()) {
			window.setTimeout(start, 100);
			return;
		}
		if (!IS_EDIT_MODE) {
			return;
		}

		if (!map.getPane(PANE_NAME)) {
			map.createPane(PANE_NAME);
			const pane = map.getPane(PANE_NAME);
			pane.style.zIndex = 639;
			pane.style.pointerEvents = "none";
		}
		const canvas = document.createElement("canvas");
		canvas.style.position = "absolute";
		canvas.style.top = "0";
		canvas.style.left = "0";
		canvas.style.pointerEvents = "none";
		canvas.style.transformOrigin = "0 0";
		canvas.classList.add("leaflet-zoom-animated");
		map.getPane(PANE_NAME).appendChild(canvas);
		const ctx = canvas.getContext("2d");
		let canvasTopLeftLatLng = null;

		function riverFlowDir(properties) {
			const dir = properties?.flow?.dir;
			return dir === "forward" || dir === "reverse" ? dir : null;
		}

		function drawArrow(x, y, angle, viewWidth, viewHeight) {
			if (x < -20 || y < -20 || x > viewWidth + 20 || y > viewHeight + 20) {
				return;
			}
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(angle);
			ctx.beginPath();
			ctx.moveTo(5, 0);
			ctx.lineTo(-3, -3.5);
			ctx.lineTo(-3, 3.5);
			ctx.closePath();
			ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
			ctx.strokeStyle = "rgba(15, 60, 110, 0.9)";
			ctx.lineWidth = 1;
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}

		function redraw() {
			const size = map.getSize();
			const topLeft = map.containerPointToLayerPoint([0, 0]);
			L.DomUtil.setPosition(canvas, topLeft);
			canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
			const dpr = window.devicePixelRatio || 1;
			const pixelWidth = Math.round(size.x * dpr);
			const pixelHeight = Math.round(size.y * dpr);
			if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
			if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
			if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
			if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			if (!Array.isArray(pathData) || map.getZoom() < ARROW_MIN_ZOOM) {
				return;
			}

			pathData.forEach((path) => {
				if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
					return;
				}
				const dir = riverFlowDir(path.properties);
				if (!dir) {
					return;
				}
				const rawCoordinates = path.geometry?.coordinates;
				if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
					return;
				}
				// Walk in FLOW direction: reverse-drawn rivers are walked back-to-front.
				const coordinates = dir === "forward" ? rawCoordinates : [...rawCoordinates].reverse();
				let carried = 0;
				let previousPoint = map.latLngToContainerPoint(L.latLng(coordinates[0][1], coordinates[0][0]));
				for (let i = 1; i < coordinates.length; i++) {
					const point = map.latLngToContainerPoint(L.latLng(coordinates[i][1], coordinates[i][0]));
					const dx = point.x - previousPoint.x;
					const dy = point.y - previousPoint.y;
					const length = Math.hypot(dx, dy);
					if (length > 0) {
						const angle = Math.atan2(dy, dx);
						let offset = ARROW_SPACING_PX - carried;
						while (offset <= length) {
							const t = offset / length;
							drawArrow(previousPoint.x + dx * t, previousPoint.y + dy * t, angle, size.x, size.y);
							offset += ARROW_SPACING_PX;
						}
						carried = (carried + length) % ARROW_SPACING_PX;
					}
					previousPoint = point;
				}
			});
		}

		map.on("moveend zoomend viewreset resize", () => {
			canvas.style.transition = "";
			redraw();
		});
		map.on("zoomanim", (event) => {
			if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
				return;
			}
			canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
			const scale = map.getZoomScale(event.zoom);
			const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
			L.DomUtil.setTransform(canvas, offset, scale);
		});

		window.avesmapsRedrawRiverFlowArrows = redraw;
		[200, 800, 2000].forEach((delay) => window.setTimeout(redraw, delay));
	}

	start();
})();
