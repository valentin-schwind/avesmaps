const visitorEventQueue = [];
let visitorTrackingFlushTimer = null;

function visitorTrackingEnabled() {
	return window.AVESMAPS_VISITOR_ANALYTICS_ENABLED !== false && typeof VISITOR_TRACK_API_URL === "string" && VISITOR_TRACK_API_URL !== "";
}

function trackVisitorEvent(metric, dimension = "") {
	if (!visitorTrackingEnabled() || typeof metric !== "string" || metric === "") {
		return;
	}
	visitorEventQueue.push({ metric, dimension: String(dimension || "").slice(0, 190) });
	if (visitorEventQueue.length >= 25) {
		flushVisitorEvents();
	} else if (visitorTrackingFlushTimer === null) {
		visitorTrackingFlushTimer = window.setTimeout(flushVisitorEvents, 15000);
	}
}

function flushVisitorEvents() {
	window.clearTimeout(visitorTrackingFlushTimer);
	visitorTrackingFlushTimer = null;
	if (!visitorTrackingEnabled() || visitorEventQueue.length === 0) {
		return;
	}
	const batch = visitorEventQueue.splice(0, visitorEventQueue.length);
	const body = JSON.stringify({ events: batch, referrer: document.referrer || "" });
	try {
		const blob = new Blob([body], { type: "application/json" });
		if (!navigator.sendBeacon || !navigator.sendBeacon(VISITOR_TRACK_API_URL, blob)) {
			void fetch(VISITOR_TRACK_API_URL, { method: "POST", body, headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true });
		}
	} catch (error) {
		/* tracking is best-effort; never disturb the page */
	}
}

window.addEventListener("pagehide", flushVisitorEvents);
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") {
		flushVisitorEvents();
	}
});
window.trackVisitorEvent = trackVisitorEvent;
