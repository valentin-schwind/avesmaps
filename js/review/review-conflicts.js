// Konfliktzentrum (P1) -- renders the computed conflicts into #wiki-sync-conflicts-overlay.
// Design: docs/konfliktmanagement-design.md. Plain classic script, no module (load order free).
//
// Two things this file must never do, because both were measured mistakes in the design phase:
//  - it must not run the scan on dialog open. The detector walks every active map feature and reads
//    an unindexed JSON path, so it is an explicit "Neu pruefen" action with progress in its own
//    button (AGENTS.md §9, STRATO).
//  - it must not offer a bulk decision. Owner ruling: every case is decided individually; only
//    runs WITHOUT decision content (e.g. the ways' "alle sauberen anwenden") may batch.

let conflictData = { rules: [], conflicts: [], summary: null, typeLabels: {} };
let conflictFilter = { type: "", severity: "", status: "open" };
let conflictLoading = false;
// Loaded once per page, not once per open: reopening the dialog must not re-walk the table, but an
// editor should never have to press a button to see anything at all. "Neu prüfen" forces a refresh.
let conflictsLoadedOnce = false;

const CONFLICT_SEVERITY_LABELS = {
	error: "Fehler",
	divergence: "Abweichung",
	unverified: "Ungeprüft",
};
const CONFLICT_STATUS_LABELS = {
	open: "Offen",
	deferred: "Zurückgestellt",
	archived: "Archiviert",
	done: "Erledigt",
};
// The four statuses in the owner's own words (§5a) -- shown as the filter's sub-line so nobody has
// to remember which of "archiviert" and "erledigt" means the conflict still stands.
const CONFLICT_STATUS_HINTS = {
	open: "sollte gemacht werden",
	deferred: "zu wenig Information",
	archived: "bewusst so gelassen — Konflikt besteht weiter",
	done: "Daten repariert, Fall bleibt als Historie",
};

function getConflictListElement() {
	return document.getElementById("conflict-list");
}

async function loadConflicts({ rescan = false } = {}) {
	if (conflictLoading) {
		return;
	}
	const button = document.getElementById("conflict-rescan");
	conflictLoading = true;
	conflictsLoadedOnce = true;
	if (button) {
		setWikiSyncButtonState(button, { label: "Prüft …", running: true });
	}
	// An empty list would read as "no conflicts", which is the wrong answer to show while still
	// counting. Short and centred -- the button already carries the running state.
	const listElement = getConflictListElement();
	if (listElement && conflictData.conflicts.length < 1) {
		listElement.textContent = "";
		const busy = document.createElement("p");
		busy.className = "conflict-loading";
		busy.textContent = "Lade …";
		listElement.appendChild(busy);
	}
	try {
		const data = await submitConflictAction("list");
		conflictData = {
			rules: Array.isArray(data.rules) ? data.rules : [],
			conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
			summary: data.summary || null,
			typeLabels: data.type_labels || {},
		};
		renderConflicts();
	} catch (error) {
		const list = getConflictListElement();
		if (list) {
			list.textContent = "";
			const message = document.createElement("p");
			message.className = "conflict-empty";
			message.textContent = `Konflikte konnten nicht geladen werden: ${error.message}`;
			list.appendChild(message);
		}
	} finally {
		conflictLoading = false;
		if (button) {
			setWikiSyncButtonState(button, { running: false });
		}
	}
	void rescan;
}

// A conflict belongs to EVERY party's type, not just its subject -- a place-and-territory case has
// to be reachable from both filters (§4.3).
function conflictHasType(conflict, type) {
	if (!type) {
		return true;
	}
	return (conflict.parties || []).some((party) => party.type === type);
}

function getFilteredConflicts() {
	return conflictData.conflicts.filter((conflict) => {
		if (conflictFilter.status && conflict.status !== conflictFilter.status) {
			return false;
		}
		if (conflictFilter.severity && conflict.severity !== conflictFilter.severity) {
			return false;
		}
		return conflictHasType(conflict, conflictFilter.type);
	});
}

function createConflictFilterButton(label, count, isActive, onPick, hint = "") {
	const element = document.createElement("button");
	element.type = "button";
	element.className = `conflict-filter${isActive ? " is-active" : ""}`;
	const text = document.createElement("span");
	text.className = "conflict-filter__label";
	text.textContent = label;
	element.appendChild(text);
	const number = document.createElement("span");
	number.className = "conflict-filter__count";
	number.textContent = count === null ? "" : String(count);
	element.appendChild(number);
	if (hint) {
		const sub = document.createElement("small");
		sub.textContent = hint;
		element.appendChild(sub);
	}
	element.addEventListener("click", () => {
		onPick();
		renderConflicts();
	});

	return element;
}

function renderConflictRail() {
	const rail = document.getElementById("conflict-rail");
	if (!rail) {
		return;
	}
	rail.textContent = "";
	const summary = conflictData.summary || { by_type: {}, by_severity: {}, by_status: {} };

	const section = (title) => {
		const heading = document.createElement("h4");
		heading.textContent = title;
		rail.appendChild(heading);
	};

	section("Objektart");
	rail.appendChild(createConflictFilterButton("Alle", conflictData.conflicts.length, conflictFilter.type === "", () => {
		conflictFilter.type = "";
	}));
	Object.entries(summary.by_type || {}).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
		const label = conflictData.typeLabels[type] || type;
		rail.appendChild(createConflictFilterButton(label, count, conflictFilter.type === type, () => {
			conflictFilter.type = type;
		}));
	});

	section("Schweregrad");
	Object.entries(CONFLICT_SEVERITY_LABELS).forEach(([key, label]) => {
		const count = (summary.by_severity || {})[key] || 0;
		rail.appendChild(createConflictFilterButton(label, count, conflictFilter.severity === key, () => {
			conflictFilter.severity = conflictFilter.severity === key ? "" : key;
		}));
	});

	section("Status");
	Object.entries(CONFLICT_STATUS_LABELS).forEach(([key, label]) => {
		const count = (summary.by_status || {})[key] || 0;
		rail.appendChild(createConflictFilterButton(label, count, conflictFilter.status === key, () => {
			conflictFilter.status = conflictFilter.status === key ? "" : key;
		}, CONFLICT_STATUS_HINTS[key] || ""));
	});
}

// Fly to a party and get the dialog out of the way. Without closing it the map is behind a
// near-fullscreen overlay and "Anzeigen" would do nothing visible.
function focusConflictParty(party) {
	const lat = Number(party?.position?.lat);
	const lng = Number(party?.position?.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return;
	}
	setWikiSyncConflictsDialogOpen(false);
	map.flyTo(L.latLng(lat, lng), Math.max(map.getZoom(), 4), { duration: 0.8 });
}

// One party = one column of evidence. The conflict alone ("two things share an article") is not
// decidable; what decides it is whether THIS object has an article of its own and where it sits.
// Owner on the live list: "ist Jergan im Wiki? ist Jergan auf der Karte? ... dann kann ich
// entscheiden."
function createConflictPartyElement(party) {
	const element = document.createElement("div");
	element.className = "conflict-party";

	const head = document.createElement("div");
	head.className = "conflict-party__head";
	const type = document.createElement("span");
	type.className = "conflict-party__type";
	type.textContent = party.type_label || party.type || "";
	head.appendChild(type);
	const label = document.createElement("span");
	label.className = "conflict-party__label";
	label.textContent = party.label || "(ohne Namen)";
	head.appendChild(label);
	element.appendChild(head);

	const evidence = document.createElement("div");
	evidence.className = "conflict-party__evidence";

	// "Im Wiki?" -- an article under this object's OWN exact name, not the shared one.
	if (party.own_wiki?.url) {
		const link = document.createElement("a");
		link.className = "conflict-party__wiki";
		link.href = party.own_wiki.url;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = `eigener Artikel: ${party.own_wiki.title} ↗`;
		evidence.appendChild(link);
	} else {
		const none = document.createElement("span");
		none.className = "conflict-party__none";
		none.textContent = "kein eigener Wiki-Artikel";
		evidence.appendChild(none);
	}

	// "Auf der Karte?"
	if (party.position) {
		const show = document.createElement("button");
		show.type = "button";
		show.className = "conflict-party__show";
		show.textContent = "Auf der Karte zeigen";
		show.addEventListener("click", () => focusConflictParty(party));
		evidence.appendChild(show);
	}

	element.appendChild(evidence);

	return element;
}

// Repair verbs sit ON the party, because that is where the decision lives: this one keeps the
// article, that one does not. "Behält den Link" is expressed as "unlink all the others" -- the
// keeper is never written to, which is the safest possible way to say "leave it alone".
function createConflictPartyActions(conflict, party) {
	const bar = document.createElement("div");
	bar.className = "conflict-party__actions";

	const others = (conflict.parties || []).filter((other) => other.id !== party.id || other.type !== party.type);
	const run = async (button, mode, targets) => {
		button.disabled = true;
		try {
			const result = await submitConflictAction("resolve", {
				mode,
				targets: targets.map((target) => ({ type: target.type, id: target.id })),
				wiki_url: conflict.wiki_url || "",
				rule_id: conflict.rule_id,
				fingerprint: conflict.fingerprint,
				subject_type: party.type,
				subject_id: party.id,
				acted_type: party.type,
				acted_id: party.id,
				title: conflict.title || "",
				severity: conflict.severity || "",
				parties: (conflict.parties || []).map((entry) => ({
					type: entry.type, type_label: entry.type_label, label: entry.label,
				})),
			});
			// The server refuses a party whose claim sits inside a wiki block -- surface that instead
			// of pretending it worked.
			const refused = (result.results || []).filter((entry) => entry.ok === false);
			if (refused.length > 0) {
				window.alert(refused.map((entry) => entry.reason).join("\n"));
			}
			await loadConflicts();
		} catch (error) {
			button.disabled = false;
			window.alert(`Konnte nicht angewendet werden: ${error.message}`);
		}
	};

	if (others.length > 0) {
		const keep = document.createElement("button");
		keep.type = "button";
		keep.className = "conflict-action conflict-action--main";
		keep.textContent = "Behält den Link";
		keep.title = `Trennt die ${others.length} andere${others.length === 1 ? "n" : "n"} Objekte von diesem Artikel.`;
		keep.addEventListener("click", () => run(keep, "unlink", others));
		bar.appendChild(keep);
	}

	const unlink = document.createElement("button");
	unlink.type = "button";
	unlink.className = "conflict-action";
	unlink.textContent = "Trennen";
	unlink.addEventListener("click", () => run(unlink, "unlink", [party]));
	bar.appendChild(unlink);

	const none = document.createElement("button");
	none.type = "button";
	none.className = "conflict-action";
	none.textContent = "Kein Wiki-Eintrag";
	none.title = "Trennt und hält fest, dass es im Wiki nichts dazu gibt — sonst rät der Server den Link wieder herein.";
	none.addEventListener("click", () => run(none, "no_wiki", [party]));
	bar.appendChild(none);

	if (party.unlinkable === false) {
		const hint = document.createElement("span");
		hint.className = "conflict-party__locked";
		hint.textContent = "aus der Wiki-Zuordnung";
		hint.title = "Diese Verknüpfung hängt an der Infobox und wird im zuständigen Editor gelöst.";
		bar.appendChild(hint);
	}

	return bar;
}

function createConflictActionButton(label, conflict, decision, variant = "") {
	const button = document.createElement("button");
	button.type = "button";
	button.className = `conflict-action${variant ? ` conflict-action--${variant}` : ""}`;
	button.textContent = label;
	button.addEventListener("click", async () => {
		button.disabled = true;
		try {
			if (decision === null) {
				await submitConflictAction("reopen", { rule_id: conflict.rule_id, fingerprint: conflict.fingerprint });
			} else {
				await submitConflictAction("decide", {
					rule_id: conflict.rule_id,
					fingerprint: conflict.fingerprint,
					decision,
					subject_type: conflict.subject_type || "",
					subject_id: conflict.subject_id || "",
					title: conflict.title || "",
					wiki_url: conflict.wiki_url || "",
					severity: conflict.severity || "",
					parties: (conflict.parties || []).map((entry) => ({
						type: entry.type, type_label: entry.type_label, label: entry.label,
					})),
				});
			}
			await loadConflicts();
		} catch (error) {
			button.disabled = false;
			window.alert(`Konnte nicht gespeichert werden: ${error.message}`);
		}
	});

	return button;
}

function createConflictElement(conflict) {
	const element = document.createElement("div");
	element.className = "conflict-case";

	const head = document.createElement("div");
	head.className = "conflict-case__head";
	const title = document.createElement("span");
	title.className = "conflict-case__title";
	title.textContent = conflict.title || "(ohne Titel)";
	head.appendChild(title);
	if (conflict.segments > 1) {
		const segments = document.createElement("span");
		segments.className = "conflict-case__meta";
		segments.textContent = `${conflict.segments} Segmente`;
		head.appendChild(segments);
	}
	element.appendChild(head);

	// A shared article is repaired per party; the watchlist rule has nothing to repair, so it only
	// offers the bookkeeping verbs below.
	const isRepairable = Boolean(conflict.wiki_url) && (conflict.parties || []).length > 1;
	if ((conflict.parties || []).length > 0) {
		const parties = document.createElement("div");
		parties.className = "conflict-case__parties";
		conflict.parties.forEach((party) => {
			const partyElement = createConflictPartyElement(party);
			if (isRepairable && conflict.status === "open") {
				partyElement.appendChild(createConflictPartyActions(conflict, party));
			}
			parties.appendChild(partyElement);
		});
		element.appendChild(parties);
	}

	const actions = document.createElement("div");
	actions.className = "conflict-case__actions";
	if (conflict.status === "open") {
		// No case-level "Erledigt": it would archive the case while the wrong link stays, i.e. claim
		// a repair that never happened. Repair lives on the party; these two only record a verdict.
		actions.appendChild(createConflictActionButton("Zurückstellen", conflict, "deferred"));
		actions.appendChild(createConflictActionButton("Archivieren", conflict, "ignored"));
	} else {
		actions.appendChild(createConflictActionButton("Wieder öffnen", conflict, null));
	}
	if (conflict.wiki_url) {
		const link = document.createElement("a");
		link.className = "conflict-case__link";
		link.href = conflict.wiki_url;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "Wiki-Artikel ↗";
		actions.appendChild(link);
	}
	element.appendChild(actions);

	// Who decided, and when (owner request 2026-07-20). Only on decided cases -- on an open one
	// there is nobody to name.
	if (conflict.reviewed_at) {
		const by = document.createElement("div");
		by.className = "conflict-case__by";
		const status = CONFLICT_STATUS_LABELS[conflict.status] || conflict.status;
		const when = String(conflict.reviewed_at).replace("T", " ").slice(0, 16);
		by.textContent = `${status} von ${conflict.reviewed_by || "unbekannt"} · ${when}`;
		element.appendChild(by);
	}

	return element;
}

function renderConflicts() {
	renderConflictRail();
	const list = getConflictListElement();
	if (!list) {
		return;
	}
	list.textContent = "";

	const filtered = getFilteredConflicts();
	if (filtered.length < 1) {
		const empty = document.createElement("p");
		empty.className = "conflict-empty";
		empty.textContent = conflictData.conflicts.length < 1
			? "Noch nicht geprüft. „Neu prüfen“ startet den Durchlauf."
			: "Keine Konflikte in dieser Auswahl.";
		list.appendChild(empty);
		return;
	}

	// Grouped by RULE, never by object type -- one rule spans object types, and splitting it by type
	// would scatter the same decision across several places (owner ruling 2026-07-20).
	const byRule = new Map();
	filtered.forEach((conflict) => {
		if (!byRule.has(conflict.rule_id)) {
			byRule.set(conflict.rule_id, []);
		}
		byRule.get(conflict.rule_id).push(conflict);
	});

	conflictData.rules.forEach((rule) => {
		const cases = byRule.get(rule.id);
		if (!cases || cases.length < 1) {
			return;
		}
		const group = document.createElement("details");
		group.className = "conflict-group";
		group.open = true;
		const summary = document.createElement("summary");
		const dot = document.createElement("span");
		dot.className = `conflict-dot conflict-dot--${rule.severity}`;
		summary.appendChild(dot);
		const label = document.createElement("span");
		label.className = "conflict-group__label";
		label.textContent = rule.label;
		summary.appendChild(label);
		const count = document.createElement("span");
		count.className = "conflict-group__count";
		count.textContent = String(cases.length);
		summary.appendChild(count);
		group.appendChild(summary);

		if (rule.hint) {
			const hint = document.createElement("p");
			hint.className = "conflict-group__hint";
			hint.textContent = rule.hint;
			group.appendChild(hint);
		}
		// What each button actually does. Spelled out at the group, not hidden in tooltips: the
		// difference between "Trennen" and "Kein Wiki-Eintrag" decides whether the removal sticks.
		if (Array.isArray(rule.verbs) && rule.verbs.length > 0) {
			const legend = document.createElement("dl");
			legend.className = "conflict-verbs";
			rule.verbs.forEach((verb) => {
				const term = document.createElement("dt");
				term.textContent = verb.label;
				legend.appendChild(term);
				const description = document.createElement("dd");
				description.textContent = verb.effect;
				legend.appendChild(description);
			});
			group.appendChild(legend);
		}
		cases.forEach((conflict) => group.appendChild(createConflictElement(conflict)));
		list.appendChild(group);
	});
}
