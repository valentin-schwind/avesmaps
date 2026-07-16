// Linkchecker editor UI (Spec §1.7): the "Links prüfen" button in the WikiSync "Abenteuer" tab.
//
// STRATO has no cron, and looping a heavy endpoint here once saturated the PHP workers and looked like a
// DB outage (AGENTS.md §9). So the server does ONE bounded step per request and the CLIENT drives the
// repetition -- the same shape as runWikiSyncDumpLoop (review-wiki-sync.js). Two phases per run:
//   1. sync       -- rebuild the registry, one provider per call, until done.
//   2. check_step -- probe due links in batches until nothing is due.
// For the full backlog without the ~28s request ceiling there is scripts/check-links.php.

let isLinkCheckRunning = false;

// Both loops are bounded so a backend bug can never spin forever. The sync has a handful of providers;
// the check needs one step per batch of due links, so allow generously more.
const LINK_CHECK_MAX_SYNC_STEPS = 50;
const LINK_CHECK_MAX_CHECK_STEPS = 2000;

function setLinkCheckSummary(text) {
	const summary = document.getElementById("link-check-summary");
	if (!summary) {
		return;
	}
	summary.textContent = text;
	summary.hidden = text === "";
}

// "42 Links · 30 online · 2 tot · 10 ungeprüft" -- the counters the owner reads after a run.
function formatLinkCheckStatus(status) {
	if (!status) {
		return "";
	}
	const parts = [
		`${Number(status.total ?? 0)} Links`,
		`${Number(status.online ?? 0)} online`,
		`${Number(status.dead ?? 0)} tot`,
		`${Number(status.unchecked ?? 0)} ungeprüft`,
	];
	const due = Number(status.due ?? 0);
	if (due > 0) {
		parts.push(`${due} fällig`);
	}
	return parts.join(" · ");
}

// Phase 1: rebuild the registry. One provider per request; the server returns the next cursor.
async function runLinkCheckSyncLoop() {
	let cursor = "";
	let done = false;
	let steps = 0;
	const totals = { seen: 0, created: 0, removed: 0, pruned: 0 };

	while (!done) {
		if (steps > LINK_CHECK_MAX_SYNC_STEPS) {
			throw new Error("Link-Registry wurde nach zu vielen Teilschritten angehalten.");
		}
		steps += 1;

		const step = await submitLinkCheckAction("sync", { cursor });
		totals.seen += Number(step.seen ?? 0);
		totals.created += Number(step.created ?? 0);
		totals.removed += Number(step.removed ?? 0);
		totals.pruned += Number(step.pruned ?? 0);
		cursor = String(step.cursor ?? "");
		done = step.done === true;

		setWikiSyncStatus(`Link-Registry wird aufgebaut … (${totals.seen} Links)`, "pending");
	}
	return totals;
}

// Phase 2: probe due links until none are due. Each step is server-bounded (batch size + time budget),
// so the number of steps depends on the backlog.
async function runLinkCheckProbeLoop() {
	let done = false;
	let steps = 0;
	const totals = { checked: 0, online: 0, dead: 0 };

	while (!done) {
		if (steps > LINK_CHECK_MAX_CHECK_STEPS) {
			throw new Error("Linkprüfung wurde nach zu vielen Teilschritten angehalten.");
		}
		steps += 1;

		const step = await submitLinkCheckAction("check_step");
		totals.checked += Number(step.checked ?? 0);
		totals.online += Number(step.online ?? 0);
		totals.dead += Number(step.dead ?? 0);
		done = step.done === true;

		// Watch `processed`, not `checked`: a step consisting only of refused URLs (private address, bad
		// scheme) checks nothing but does write progress -- reading `checked` here would abort a run that
		// is working fine. Genuinely zero processed while links remain due means another editor's run
		// holds the leases. Stop rather than spin -- they expire on their own.
		if (!done && Number(step.processed ?? 0) === 0) {
			setWikiSyncStatus("Andere Prüfung läuft bereits – die restlichen Links werden dort geprüft.", "pending");
			break;
		}

		setWikiSyncStatus(
			`Links werden geprüft … ${totals.checked} geprüft, ${Number(step.remaining ?? 0)} offen`,
			"pending"
		);
	}
	return totals;
}

// The button handler: sync, then probe, then show the counters. Re-entrancy guard + disabled button, so
// an impatient double-click cannot start two loops (pattern: startWikiSyncAdventuresSync).
async function startLinkCheck() {
	if (isLinkCheckRunning) {
		return;
	}
	const button = document.getElementById("link-check-start");
	isLinkCheckRunning = true;
	if (button) {
		button.disabled = true;
	}

	try {
		setWikiSyncStatus("Link-Registry wird aufgebaut …", "pending");
		const syncTotals = await runLinkCheckSyncLoop();

		const probeTotals = await runLinkCheckProbeLoop();
		const status = await submitLinkCheckAction("status");

		setLinkCheckSummary(formatLinkCheckStatus(status.status));
		setWikiSyncStatus(
			`Linkprüfung fertig: ${probeTotals.checked} geprüft, ${probeTotals.online} online, `
			+ `${probeTotals.dead} tot (${syncTotals.created} neu registriert).`,
			"success"
		);
		showFeedbackToast(`Linkprüfung fertig – ${probeTotals.dead} tote Links.`);
	} catch (error) {
		setWikiSyncStatus(error?.message || "Die Linkprüfung ist fehlgeschlagen.", "error");
	} finally {
		isLinkCheckRunning = false;
		if (button) {
			button.disabled = false;
		}
	}
}
