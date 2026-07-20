const visitorEventQueue = [];
let visitorTrackingFlushTimer = null;

// Presence state. Declared up here on purpose: installVisitorTrackingHooks() runs at
// the bottom of this file and reaches trackVisitorEvent(), which stamps the timestamp
// below -- a `let` further down would still be in its temporal dead zone by then.
let visitorLastInteractionAt = Date.now();
let visitorPresenceTimer = null;
const VISITOR_PRESENCE_PING_MS = 60000;
const VISITOR_PRESENCE_ACTIVE_MS = 120000;
// A tab left open overnight should stop pinging rather than report a phantom reader
// until morning. Any interaction (or coming back to the tab) revives it.
const VISITOR_PRESENCE_IDLE_STOP_MS = 900000;

function visitorTrackingEnabled() {
	return window.AVESMAPS_VISITOR_ANALYTICS_ENABLED !== false && typeof VISITOR_TRACK_API_URL === "string" && VISITOR_TRACK_API_URL !== "";
}

function trackVisitorEvent(metric, dimension = "") {
	if (!visitorTrackingEnabled() || typeof metric !== "string" || metric === "") {
		return;
	}
	visitorLastInteractionAt = Date.now();
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

function installVisitorTrackingHooks() {
	if (!visitorTrackingEnabled()) {
		return;
	}
	trackVisitorEvent("pageview");

	// The app switches the map mode and display toggles through jQuery -- the custom transport control does
	// $select.val(value).trigger("change"), and jQuery's synthetic trigger does NOT reach native
	// addEventListener("change") listeners. Bind with jQuery so we catch both real user changes and
	// jQuery-triggered ones (otherwise map_mode / display_toggle are never recorded).
	const jq = window.jQuery;
	if (jq) {
		jq("#mapLayerModeSelect").on("change", function () {
			trackVisitorEvent("map_mode", String(jq(this).val() || ""));
		});
		jq(".display-options").on("change", "input[type=checkbox]", function () {
			trackVisitorEvent("display_toggle", (this.id || this.name || "toggle") + ":" + (this.checked ? "on" : "off"));
		});
		// The settlement-class toggles are <button class="location-toggle">, not checkboxes; the app sets the
		// "is-active" class on click, so read the resulting state on the next tick.
		jq(".display-options").on("click", ".location-toggle", function () {
			const button = this;
			const type = button.dataset.locationType || "ort";
			window.setTimeout(function () {
				trackVisitorEvent("display_toggle", type + ":" + (button.classList.contains("is-active") ? "on" : "off"));
			}, 0);
		});
	}
}

// --- Presence ---------------------------------------------------------------
// Answers "who is on the site right now" for the Status panel. The event beacon
// above cannot: a visitor who just reads the map sends one pageview and is then
// invisible to the server for as long as they stay.

function visitorPresenceEnabled() {
	return visitorTrackingEnabled() && typeof VISITOR_HEARTBEAT_API_URL === "string" && VISITOR_HEARTBEAT_API_URL !== "";
}

function sendVisitorPresence(state) {
	if (!visitorPresenceEnabled()) {
		return;
	}
	const body = JSON.stringify({ state });
	try {
		const blob = new Blob([body], { type: "application/json" });
		// sendBeacon carries same-origin cookies, so a signed-in editor is recognised
		// as one and kept out of the visitor count.
		if (!navigator.sendBeacon || !navigator.sendBeacon(VISITOR_HEARTBEAT_API_URL, blob)) {
			void fetch(VISITOR_HEARTBEAT_API_URL, { method: "POST", body, headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true });
		}
	} catch (error) {
		/* presence is best-effort; never disturb the page */
	}
}

function visitorPresenceTick() {
	// Hidden tabs stay quiet -- browsers throttle their timers anyway, so a ping from
	// one would be neither reliable nor honest. The "hidden" state is announced once,
	// on the way out, and expires with the window.
	if (document.visibilityState !== "visible") {
		return;
	}
	if (Date.now() - visitorLastInteractionAt > VISITOR_PRESENCE_IDLE_STOP_MS) {
		return;
	}
	sendVisitorPresence(Date.now() - visitorLastInteractionAt <= VISITOR_PRESENCE_ACTIVE_MS ? "active" : "reading");
}

function installVisitorPresence() {
	if (!visitorPresenceEnabled() || visitorPresenceTimer !== null) {
		return;
	}
	// Panning and zooming the map is real presence but produces no tracked event, so
	// the raw input events feed the "active" state alongside trackVisitorEvent().
	document.addEventListener("pointerdown", () => { visitorLastInteractionAt = Date.now(); }, { passive: true, capture: true });
	document.addEventListener("keydown", () => { visitorLastInteractionAt = Date.now(); }, { passive: true, capture: true });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			sendVisitorPresence("hidden");
			return;
		}
		// Returning to the tab is itself a deliberate act -- count it and report at once.
		visitorLastInteractionAt = Date.now();
		sendVisitorPresence("active");
	});
	// Closing the tab drops the row immediately instead of leaving a ghost for the
	// length of the window.
	window.addEventListener("pagehide", () => sendVisitorPresence("gone"));

	sendVisitorPresence("active");
	visitorPresenceTimer = window.setInterval(visitorPresenceTick, VISITOR_PRESENCE_PING_MS);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", installVisitorTrackingHooks, { once: true });
	document.addEventListener("DOMContentLoaded", installVisitorPresence, { once: true });
} else {
	installVisitorTrackingHooks();
	installVisitorPresence();
}
