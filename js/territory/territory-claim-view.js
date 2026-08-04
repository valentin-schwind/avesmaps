// Wie sich der Territorien-Anspruch in der Oberfläche zeigt.
//
// Loaded by BOTH territory surfaces: the embedded editor (via index.html, alongside the presence
// panel) and the standalone page html/political-territory-editor.html, which loads none of the
// panel machinery. That is the whole reason this is its own file -- the alternative was the same
// eight lines living in two places, which is how rules drift apart here (AGENTS.md §5).
//
// 💣 Everything below is COURTESY. The real lock is the 409 from territories-endpoint.php, which
// no client can talk its way past. This only spares the second editor from typing into work that
// is going to be rejected.
//
// Only function declarations at top level, no const: this file is loaded from two documents and
// (in the embedded case) into a shared scope, where a duplicate const would be a hard error.

// Pure: may I write to the territory tree, and if not, who is holding it?
// Unknown or malformed input resolves to "may write" on purpose. The server is the authority;
// defaulting to "locked" here would turn a single bad response into an outage that looks exactly
// like the feature working correctly.
function avesmapsTerritoryWriteState(claim) {
	if (!claim || typeof claim !== "object" || claim.is_mine !== false) {
		return { canWrite: true, holderName: null, sinceSeconds: null };
	}
	return {
		canWrite: false,
		holderName: claim.username || "Ein anderer Editor",
		sinceSeconds: Number.isFinite(Number(claim.seconds_since_activity)) ? Number(claim.seconds_since_activity) : null,
	};
}

// "seit 14:20 Uhr" from an AGE, never from a server timestamp: activity_since is MySQL server
// time, and formatting that against a local clock is off by the timezone difference. Without the
// time the banner is a dead end -- you cannot tell someone working from someone who left a tab open.
function formatTerritoryClaimSince(sinceSeconds) {
	if (!Number.isFinite(sinceSeconds)) {
		return "";
	}
	const startedAt = new Date(Date.now() - sinceSeconds * 1000);
	return ` (seit ${startedAt.getHours()}:${String(startedAt.getMinutes()).padStart(2, "0")} Uhr)`;
}

function applyPoliticalTerritoryClaim(claim) {
	const state = avesmapsTerritoryWriteState(claim);
	const banner = document.getElementById("territoryClaimBanner");
	const saveButton = document.getElementById("saveButton");

	// "It is free now" is worth saying, but only on the transition -- and only to someone who was
	// actually blocked a moment ago, not to everyone who opens the editor.
	const wasBlocked = Boolean(banner) && !banner.hidden;
	if (wasBlocked && state.canWrite && typeof showFeedbackToast === "function") {
		showFeedbackToast("Die Territorien sind jetzt frei — du kannst speichern.", "success");
	}

	if (banner) {
		banner.hidden = state.canWrite;
		if (!state.canWrite) {
			banner.querySelector(".territory-claim-banner__text").textContent =
				`${state.holderName} bearbeitet gerade die Territorien${formatTerritoryClaimSince(state.sinceSeconds)}. `
				+ "Du kannst alles ansehen, aber nicht speichern.";
		}
	}

	if (saveButton) {
		saveButton.disabled = !state.canWrite;
		saveButton.title = state.canWrite ? "" : `${state.holderName} bearbeitet gerade die Territorien.`;
	}
}
