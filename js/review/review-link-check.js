// Linkchecker editor UI (Spec §1.7): the shared engine behind the per-editor "Links prüfen" buttons.
//
// STRATO has no cron, and looping a heavy endpoint here once saturated the PHP workers and looked like a
// DB outage (AGENTS.md §9). So the server does ONE bounded step per request and the CLIENT drives the
// repetition -- the same shape as runWikiSyncDumpLoop (review-wiki-sync.js). Two phases per run:
//   1. sync       -- rebuild the registry for the scope.
//   2. check_step -- probe that scope's due links in batches until none are due.
//
// The buttons themselves live in the editor DIALOGS and call in from their iframe via
// window.parent.startLinkCheck(scope, onProgress) -- the same way their "Syncen" buttons already
// delegate. EACH IS SCOPED to one entity type, so the work splits into portions someone can sit through
// instead of one ~2851-link, 15-30 min run:
//   adventure-editor.html          -> 'adventure'          (shop + wiki links of the adventures)
//   wiki-sync-settlement-editor    -> 'source_settlement'  (source catalogue links of settlements)
//   wiki-sync-monitor.html         -> 'source_territory'   (   "        "        of territories)
//   citymap-editor.html (phase 3)  -> 'citymap'
// region/path source links have no dialog of their own -- they are the CLI's job
// (scripts/check-links.php --confirm runs unscoped and has no request ceiling).

let isLinkCheckRunning = false;

// Both loops are bounded so a backend bug can never spin forever. The sync has a handful of providers;
// the check needs one step per batch of due links, so allow generously more.
const LINK_CHECK_MAX_SYNC_STEPS = 50;
const LINK_CHECK_MAX_CHECK_STEPS = 2000;

// Phase 1: rebuild the registry for this scope. A scoped sync finishes in one call; the loop stays
// because the server owns the done-flag and an unscoped run would walk the cursor.
async function runLinkCheckSyncLoop(scope) {
	let cursor = "";
	let done = false;
	let steps = 0;
	const totals = { seen: 0, created: 0, removed: 0, pruned: 0 };

	while (!done) {
		if (steps > LINK_CHECK_MAX_SYNC_STEPS) {
			throw new Error("Link-Registry wurde nach zu vielen Teilschritten angehalten.");
		}
		steps += 1;

		const step = await submitLinkCheckAction("sync", { cursor, entity_type: scope });
		totals.seen += Number(step.seen ?? 0);
		totals.created += Number(step.created ?? 0);
		totals.removed += Number(step.removed ?? 0);
		totals.pruned += Number(step.pruned ?? 0);
		cursor = String(step.cursor ?? "");
		done = step.done === true;

		reportLinkCheckProgress(`Link-Registry wird aufgebaut … (${totals.seen} Links)`, "pending");
	}
	return totals;
}

// Phase 2: probe due links until none are due. Each step is server-bounded (batch size + time budget),
// so the number of steps depends on the backlog.
async function runLinkCheckProbeLoop(scope) {
	let done = false;
	let steps = 0;
	const totals = { checked: 0, online: 0, dead: 0 };

	while (!done) {
		if (steps > LINK_CHECK_MAX_CHECK_STEPS) {
			throw new Error("Linkprüfung wurde nach zu vielen Teilschritten angehalten.");
		}
		steps += 1;

		const step = await submitLinkCheckAction("check_step", { entity_type: scope });
		totals.checked += Number(step.checked ?? 0);
		totals.online += Number(step.online ?? 0);
		totals.dead += Number(step.dead ?? 0);
		done = step.done === true;

		// Watch `processed`, not `checked`: a step consisting only of refused URLs (private address, bad
		// scheme) checks nothing but does write progress -- reading `checked` here would abort a run that
		// is working fine. Genuinely zero processed while links remain due means another editor's run
		// holds the leases. Stop rather than spin -- they expire on their own.
		if (!done && Number(step.processed ?? 0) === 0) {
			reportLinkCheckProgress("Andere Prüfung läuft bereits – die restlichen Links werden dort geprüft.", "pending");
			break;
		}

		reportLinkCheckProgress(
			`Links werden geprüft … ${totals.checked} geprüft, ${Number(step.remaining ?? 0)} offen`,
			"pending"
		);
	}
	return totals;
}

// Where a run reports progress. The editors are iframes whose own status line the loop cannot reach, so
// they hand in a callback rather than polling: a poll would be a second editor request queueing behind
// the 25s check_step that is already running (measured: a plain `status` call took 21s mid-step).
// Callers outside an iframe pass nothing and the ribbon's status line is used.
let linkCheckProgressSink = null;

function reportLinkCheckProgress(text, tone) {
	setWikiSyncStatus(text, tone);
	if (typeof linkCheckProgressSink === "function") {
		try {
			linkCheckProgressSink(text, tone);
		} catch (error) {
			// A dead iframe (editor closed mid-run) must never abort the run.
			linkCheckProgressSink = null;
		}
	}
}

// The handler for ONE scope: sync, then probe, then report that scope's counters. Returns the totals so
// an embedded editor can show its own summary. The re-entrancy guard is global on purpose -- two scopes
// at once would only fight over PHP workers and the per-host throttle, and STRATO has punished exactly
// that before.
async function startLinkCheck(scope, onProgress) {
	if (isLinkCheckRunning) {
		return null;
	}
	isLinkCheckRunning = true;
	linkCheckProgressSink = typeof onProgress === "function" ? onProgress : null;

	try {
		reportLinkCheckProgress("Link-Registry wird aufgebaut …", "pending");
		const syncTotals = await runLinkCheckSyncLoop(scope);

		const probeTotals = await runLinkCheckProbeLoop(scope);
		const status = await submitLinkCheckAction("status", { entity_type: scope });

		reportLinkCheckProgress(
			`Linkprüfung fertig: ${probeTotals.checked} geprüft, ${probeTotals.online} online, `
			+ `${probeTotals.dead} tot (${syncTotals.created} neu registriert).`,
			"success"
		);
		showFeedbackToast(`Linkprüfung fertig – ${probeTotals.dead} tote Links.`);
		return { ...probeTotals, status: status.status };
	} catch (error) {
		reportLinkCheckProgress(error?.message || "Die Linkprüfung ist fehlgeschlagen.", "error");
		throw error;
	} finally {
		isLinkCheckRunning = false;
		linkCheckProgressSink = null;
	}
}
