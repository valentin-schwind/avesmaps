// The client half of the citymap preview run. Mirrors review-link-check.js deliberately: STRATO has no
// cron, the server does ONE bounded step per request, and the client drives the repetition. Looping a
// heavy endpoint server-side once saturated the PHP workers and looked like a DB outage (AGENTS.md §9).
//
// The button lives in the citymap editor DIALOG, which is an iframe -- it calls in via
// window.parent.startCitymapAutoget(onProgress), exactly the way its "Links prüfen" and "Karten syncen"
// buttons already delegate. Progress arrives through the callback we are handed. NEVER poll: a poll only
// queues behind the running step (measured on the linkchecker: a plain status call took 21s mid-step).

const CITYMAP_AUTOGET_URL = "/api/edit/map/citymap-autoget.php";
// A backstop against an endless loop if a step ever reported done=false without making progress. Steps are
// now ~4s each (was ~15s), so a full run is many more, shorter steps: 133 sources at ~7/step is ~20 steps;
// 200 is far above any real run and far below "forever" (the sources_done===0 break is the real terminator).
const CITYMAP_AUTOGET_MAX_STEPS = 200;

let isCitymapAutogetRunning = false;
let citymapAutogetProgressSink = null;

function reportCitymapAutogetProgress(text) {
	if (typeof citymapAutogetProgressSink === "function") {
		citymapAutogetProgressSink(text);
	}
}

async function submitCitymapAutogetAction(action) {
	const res = await fetch(CITYMAP_AUTOGET_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ action: action }),
	});
	const payload = await res.json().catch(() => null);
	if (!res.ok || !payload || payload.ok !== true) {
		const message = (payload && payload.error && payload.error.message) || ("HTTP " + res.status);
		throw new Error(message);
	}
	return payload;
}

// Runs steps until the server says done. The re-entrancy guard is global on purpose -- two runs at once
// would only fight over PHP workers and the per-host throttle, and STRATO has punished exactly that.
// Returns null (does NOT throw) when a run is already in flight, so a caller can say so.
async function startCitymapAutoget(onProgress) {
	if (isCitymapAutogetRunning) {
		return null;
	}
	isCitymapAutogetRunning = true;
	citymapAutogetProgressSink = typeof onProgress === "function" ? onProgress : null;

	const totals = { sources: 0, ok: 0, no_image: 0, fetch_failed: 0, not_an_image: 0, skipped: 0 };
	try {
		reportCitymapAutogetProgress("Vorschauen werden geholt …");
		let steps = 0;
		let done = false;
		while (!done) {
			if (steps >= CITYMAP_AUTOGET_MAX_STEPS) {
				throw new Error("Der Durchlauf wurde nach zu vielen Teilschritten angehalten.");
			}
			steps += 1;

			const step = await submitCitymapAutogetAction("autoget_step");

			// Server single-flight lock: another run (other tab / reload / agent) holds it. Stop cleanly and
			// tell the caller -- the tab-local guard alone cannot see a second tab.
			if (step.busy === true) {
				totals.busy = true;
				break;
			}
			// DB kill-switch flipped mid-run: stop cleanly, tab-across emergency off.
			if (step.stopped === true) {
				totals.stopped = true;
				break;
			}

			totals.sources += Number(step.sources_done ?? 0);
			totals.ok += Number(step.maps_ok ?? 0);
			totals.no_image += Number(step.no_image ?? 0);
			totals.fetch_failed += Number(step.fetch_failed ?? 0);
			totals.not_an_image += Number(step.not_an_image ?? 0);
			totals.skipped += Number(step.skipped ?? 0);
			done = step.done === true;

			// A step that found nothing to do IS finished, whatever it claims. Without this a server that
			// keeps answering done=false would spin until the backstop and report an error for a run that
			// actually completed.
			if (!done && Number(step.sources_done ?? 0) === 0) {
				break;
			}

			reportCitymapAutogetProgress(
				`Vorschauen … ${totals.ok} geholt, ${Number(step.remaining ?? 0)} offen`
			);
		}
		return totals;
	} finally {
		isCitymapAutogetRunning = false;
		citymapAutogetProgressSink = null;
	}
}

window.startCitymapAutoget = startCitymapAutoget;
