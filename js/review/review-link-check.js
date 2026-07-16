// Linkchecker editor UI (Spec §1.7): a "Links prüfen" button per WikiSync tab.
//
// STRATO has no cron, and looping a heavy endpoint here once saturated the PHP workers and looked like a
// DB outage (AGENTS.md §9). So the server does ONE bounded step per request and the CLIENT drives the
// repetition -- the same shape as runWikiSyncDumpLoop (review-wiki-sync.js). Two phases per run:
//   1. sync       -- rebuild the registry for the scope.
//   2. check_step -- probe that scope's due links in batches until none are due.
//
// EACH BUTTON IS SCOPED to its tab's entity type, carried in data-link-check-scope: the Abenteuer tab
// checks adventure links only, the Karten tab only maps. Without that, every button would work through
// the whole registry (~2851 links, 15-30 min) no matter which tab it sits in. Adding the Karten button
// is therefore markup plus one bootstrap line -- no change in here.
// The registry also holds source-catalog links, which no tab owns; those are the CLI's job
// (scripts/check-links.php --confirm, which runs unscoped and has no request ceiling).

let isLinkCheckRunning = false;

// Both loops are bounded so a backend bug can never spin forever. The sync has a handful of providers;
// the check needs one step per batch of due links, so allow generously more.
const LINK_CHECK_MAX_SYNC_STEPS = 50;
const LINK_CHECK_MAX_CHECK_STEPS = 2000;

// Each scope has its own button + summary span, paired by the scope name so a second tab needs no JS.
function linkCheckButton(scope) {
	return document.querySelector('[data-link-check-scope="' + scope + '"]');
}

function setLinkCheckSummary(scope, text) {
	const summary = document.querySelector('[data-link-check-summary="' + scope + '"]');
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

		setWikiSyncStatus(`Link-Registry wird aufgebaut … (${totals.seen} Links)`, "pending");
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

// The button handler for ONE scope: sync, then probe, then show that scope's counters. The re-entrancy
// guard is global on purpose -- two scopes running at once would only fight over PHP workers and the
// per-host throttle, and STRATO has punished exactly that before.
async function startLinkCheck(scope) {
	if (isLinkCheckRunning) {
		return;
	}
	const button = linkCheckButton(scope);
	isLinkCheckRunning = true;
	if (button) {
		button.disabled = true;
	}

	try {
		setWikiSyncStatus("Link-Registry wird aufgebaut …", "pending");
		const syncTotals = await runLinkCheckSyncLoop(scope);

		const probeTotals = await runLinkCheckProbeLoop(scope);
		const status = await submitLinkCheckAction("status", { entity_type: scope });

		setLinkCheckSummary(scope, formatLinkCheckStatus(status.status));
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
