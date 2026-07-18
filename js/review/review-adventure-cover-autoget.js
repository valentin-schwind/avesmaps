// The client half of the adventure-cover preview run. Twin of review-citymap-autoget.js: STRATO has no
// cron, the server does ONE bounded, guarded step per request, and the client drives the repetition.
// Looping a heavy endpoint server-side once saturated the PHP workers (php-pool-hang-incident-2026-07-17).
//
// The button lives in the adventure editor DIALOG, which is an iframe -- it calls in via
// window.parent.startAdventureCoverAutoget(onProgress), the same way its "Abenteuer syncen" and "Links
// prüfen" buttons already delegate to the parent. Progress arrives through the callback. NEVER poll: a
// poll only queues behind the running step.

const ADVENTURE_COVER_AUTOGET_URL = "/api/edit/map/adventure-cover-autoget.php";
// Steps are ~4s each; a full run is many short steps. Far above any real run, far below "forever" (the
// adventures_done===0 break is the real terminator).
const ADVENTURE_COVER_AUTOGET_MAX_STEPS = 300;

let isAdventureCoverAutogetRunning = false;
let adventureCoverAutogetProgressSink = null;

function reportAdventureCoverAutogetProgress(text) {
	if (typeof adventureCoverAutogetProgressSink === "function") {
		adventureCoverAutogetProgressSink(text);
	}
}

async function submitAdventureCoverAutogetAction(action) {
	const res = await fetch(ADVENTURE_COVER_AUTOGET_URL, {
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
// would only fight over PHP workers, and STRATO has punished exactly that. Returns null (does NOT throw)
// when a run is already in flight in THIS tab; returns totals with .busy/.stopped when the SERVER stops it.
async function startAdventureCoverAutoget(onProgress) {
	if (isAdventureCoverAutogetRunning) {
		return null;
	}
	isAdventureCoverAutogetRunning = true;
	adventureCoverAutogetProgressSink = typeof onProgress === "function" ? onProgress : null;

	const totals = { adventures: 0, ok: 0, no_image: 0, fetch_failed: 0, skipped: 0 };
	try {
		reportAdventureCoverAutogetProgress("Cover werden geholt …");
		let steps = 0;
		let done = false;
		while (!done) {
			if (steps >= ADVENTURE_COVER_AUTOGET_MAX_STEPS) {
				throw new Error("Der Durchlauf wurde nach zu vielen Teilschritten angehalten.");
			}
			steps += 1;

			const step = await submitAdventureCoverAutogetAction("autoget_step");

			// Server single-flight lock: another run holds it (other tab/reload/agent, maps OR adventures --
			// it is ONE shared lock). Stop cleanly and tell the caller.
			if (step.busy === true) {
				totals.busy = true;
				break;
			}
			// DB kill-switch flipped mid-run: stop cleanly.
			if (step.stopped === true) {
				totals.stopped = true;
				break;
			}

			totals.adventures += Number(step.adventures_done ?? 0);
			totals.ok += Number(step.covers_ok ?? 0);
			totals.no_image += Number(step.no_image ?? 0);
			totals.fetch_failed += Number(step.fetch_failed ?? 0);
			totals.skipped += Number(step.skipped ?? 0);
			done = step.done === true;

			// A step that found nothing to do IS finished, whatever it claims.
			if (!done && Number(step.adventures_done ?? 0) === 0) {
				break;
			}

			reportAdventureCoverAutogetProgress(
				`Cover … ${totals.ok} geholt, ${Number(step.remaining ?? 0)} offen`
			);
		}
		return totals;
	} finally {
		isAdventureCoverAutogetRunning = false;
		adventureCoverAutogetProgressSink = null;
	}
}

window.startAdventureCoverAutoget = startAdventureCoverAutoget;
