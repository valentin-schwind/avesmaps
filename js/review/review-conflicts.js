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
let conflictFilter = { type: "", severity: "", status: "open", query: "" };
let conflictLoading = false;
// Loaded once per page, not once per open: reopening the dialog must not re-walk the table, but an
// editor should never have to press a button to see anything at all. "Neu prüfen" forces a refresh.
let conflictsLoadedOnce = false;
// Welche Regelgruppen der Editor aufgeklappt hat. Die Liste wird bei jeder Entscheidung und
// jedem Filterklick neu gebaut -- ohne diesen Merkzettel klappte alles wieder auf und man
// verlor bei jedem Klick die Stelle, an der man war. Standard: alles zu.
const conflictOpenGroups = new Set();

// Owner 2026-07-21: aus "Fehler" wurde "Wichtig". Der Fund ist hier zwar hart -- zwei Objekte
// beanspruchen denselben Artikel --, aber ob das falsch IST, entscheidet der Mensch: der
// Maraskansund besteht nun einmal aus zwei Buchten. "Fehler" behauptete ein Urteil, das dem
// Erkenner nicht zusteht. Der Maschinenwert bleibt 'error'.
const CONFLICT_SEVERITY_LABELS = {
	error: "Wichtig",
	divergence: "Abweichung",
	unverified: "Ungeprüft",
};
const CONFLICT_STATUS_LABELS = {
	open: "Offen",
	deferred: "Zurückgestellt",
	approved: "Genehmigt",
	archived: "Archiviert",
	done: "Erledigt",
};
// The four statuses in the owner's own words (§5a) -- shown as the filter's sub-line so nobody has
// to remember which of "archiviert" and "erledigt" means the conflict still stands.
const CONFLICT_STATUS_HINTS = {
	open: "sollte gemacht werden",
	deferred: "zu wenig Information",
	approved: "stimmt so, kein Fehler",
	archived: "bewusst so gelassen — Konflikt besteht weiter",
	done: "Daten repariert, Fall bleibt als Historie",
};

// Verkleinert statt geschlossen: der Dialog schrumpft auf seine Kopfzeile und die Karte dahinter
// wird wieder sicht- UND bedienbar. Ein Editor bat darum, weil man beim Entscheiden oft nachsehen
// will, wo das Objekt eigentlich liegt (2026-07-21).
let conflictMinimized = false;

function setConflictDialogMinimized(isMinimized) {
	conflictMinimized = isMinimized;
	document.getElementById("wiki-sync-conflicts-overlay")?.classList.toggle("is-minimized", isMinimized);
	const button = document.getElementById("conflict-minimize");
	if (button) {
		button.textContent = isMinimized ? "▢" : "–";
		button.setAttribute("aria-label", isMinimized ? "Fenster wiederherstellen" : "Fenster verkleinern");
		button.title = isMinimized
			? "Zurück zur vollen Liste."
			: "Verkleinert das Fenster, damit die Karte dahinter sichtbar und bedienbar wird.";
	}
}

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

// --- the 11 legacy WikiSync case types, folded into the same list -----------------------------
// They keep their own storage, their own producers and their own resolve flows (which write real
// data through forms this renderer has no business duplicating). What is unified is the SURFACE:
// one list, one filter rail, one set of statuses. Each case is still drawn by its own renderer
// (createWikiSyncCaseElement), so nothing about them is lost or reimplemented.
//
// The data is already in the browser -- loadWikiSyncCases() fills wikiSyncCases for the WikiSync
// tab -- so this costs no extra request.
const LEGACY_CASE_SEVERITY = {
	duplicate_wiki_title: "error",
	duplicate_avesmaps_name: "error",
	coordinate_drift: "error",
	canonical_name_difference: "divergence",
	type_conflict: "divergence",
	field_divergence: "divergence",
	missing_capital: "divergence",
	probable_match: "unverified",
	unresolved_without_candidate: "unverified",
	missing_wiki_with_coordinates: "unverified",
	missing_wiki_without_coordinates: "unverified",
	coat_available: "unverified",
};

// Was jede eingegliederte WikiSync-Fallart bedeutet und was ihre Knoepfe tun. Owner 2026-07-21:
// die ausfuehrliche Erklaerung an der Regel hat sich bewaehrt, also bekommt sie JEDE Kategorie --
// "damit jeder Blödmann versteht, welche Art von Konflikten behandelt werden und was die Buttons
// tun". Wer eine Zeile aendert, aendert damit, was Editoren fuer richtig halten: bitte nur
// beschreiben, was der Knopf WIRKLICH tut.
const LEGACY_COMMON_VERBS = [
	{ label: "Anzeigen", effect: "Springt auf der Karte zu dem Objekt. Ändert nichts." },
	{ label: "Lösen", effect: "Öffnet den Bearbeiten-Dialog, vorbelegt mit den Wiki-Werten. Erst das Speichern dort schreibt etwas — bis dahin ist nichts verändert." },
	{ label: "Zurückstellen", effect: "Nimmt den Fall aus „Offen“, ohne Daten zu ändern. Er kommt zurück, sobald sich am Objekt oder im Wiki etwas ändert." },
	{ label: "Archivieren", effect: "Bewusst so gelassen. Ändert keine Daten und bleibt unter „Archiviert“ auffindbar und umkehrbar." },
];

const LEGACY_RULE_INFO = {
	duplicate_wiki_title: {
		hint: "Mehrere Orte auf der Karte wurden beim Sync demselben Wiki-Artikel zugeordnet. Nur einer kann gemeint sein — die übrigen brauchen einen eigenen Artikel oder gar keinen.",
		verbs: [
			{ label: "Akzeptieren", effect: "Erklärt DIESEN Ort zum richtigen Träger des Artikels. Die anderen bleiben, bis du sie einzeln entscheidest." },
			...LEGACY_COMMON_VERBS.filter((verb) => verb.label !== "Lösen"),
		],
	},
	duplicate_avesmaps_name: {
		hint: "Zwei oder mehr Orte auf der Karte heißen gleich. Das ist nicht automatisch falsch — es macht aber jede Zuordnung über den Namen unzuverlässig, weil niemand weiß, welcher gemeint ist.",
		verbs: [
			{ label: "Anzeigen", effect: "Springt zu dem Ort, damit du siehst, ob es wirklich zwei verschiedene sind." },
			{ label: "Zurückstellen / Archivieren", effect: "Ändern keine Daten. Sind es tatsächlich zwei verschiedene Orte, ist Archivieren die richtige Antwort — dann sollte einer der beiden einen unterscheidenden Zusatz bekommen." },
		],
	},
	canonical_name_difference: {
		hint: "Der Ort wurde einem Wiki-Artikel zugeordnet, dessen Titel anders lautet als der Kartenname — etwa „Burg Wolfenstein“ gegenüber „Festung Wolfenstein“. Meistens richtig, gelegentlich ein Fehlgriff.",
		verbs: LEGACY_COMMON_VERBS,
	},
	type_conflict: {
		hint: "Karte und Wiki sind sich über die Ortsgröße uneinig — die Karte sagt etwa Dorf, das Wiki Kleinstadt. Die Größe bestimmt Symbol und ab welchem Zoom der Ort erscheint.",
		verbs: LEGACY_COMMON_VERBS,
	},
	field_divergence: {
		hint: "Ein oder mehrere Felder weichen vom Wiki ab (Einwohner, Region, Ruine …). Der Fall sagt nicht, wer recht hat — eigene Angaben sind oft bewusst gesetzt.",
		verbs: LEGACY_COMMON_VERBS,
	},
	coordinate_drift: {
		hint: "Der Marker steht weit von der Position, die das Wiki angibt. Das ist entweder ein verrutschter Marker oder eine ungenaue Wiki-Koordinate — die Wiki-Positionen sind ausdrücklich gröber als die Karte.",
		verbs: [
			{ label: "Wiki-Position übernehmen", effect: "Verschiebt den Marker auf die Wiki-Koordinate. Das ist eine echte Kartenänderung, im Änderungsverlauf umkehrbar." },
			{ label: "Karte behalten", effect: "Unsere Position bleibt. Archiviert den Fall, ohne etwas zu verschieben." },
			...LEGACY_COMMON_VERBS.filter((verb) => verb.label === "Anzeigen" || verb.label === "Zurückstellen"),
		],
	},
	probable_match: {
		hint: "Der Sync hat einen wahrscheinlichen, aber nicht sicheren Wiki-Artikel gefunden. Verknüpft ist noch nichts — das ist ein Vorschlag, keine Feststellung.",
		verbs: LEGACY_COMMON_VERBS,
	},
	unresolved_without_candidate: {
		hint: "Zu diesem Ort wurde im Wiki nichts Passendes gefunden. Das ist oft völlig in Ordnung: nicht jeder Ort auf der Karte hat einen Artikel.",
		verbs: [
			{ label: "Anzeigen", effect: "Springt zu dem Ort. Ändert nichts." },
			{ label: "Zurückstellen / Archivieren", effect: "Ändern keine Daten. Archivieren heißt hier sinngemäß „hat eben keinen Artikel“ — der Fall bleibt auffindbar, falls später doch einer entsteht." },
		],
	},
	missing_wiki_with_coordinates: {
		hint: "Das Wiki kennt einen Ort, den unsere Karte nicht hat — und liefert Koordinaten dazu. Er ließe sich also direkt anlegen.",
		verbs: [
			{ label: "Lösen", effect: "Öffnet den Anlegen-Dialog mit der Wiki-Position und den Wiki-Werten. Erst das Speichern dort legt den Ort wirklich an." },
			...LEGACY_COMMON_VERBS.filter((verb) => verb.label === "Zurückstellen" || verb.label === "Archivieren"),
		],
	},
	missing_wiki_without_coordinates: {
		hint: "Das Wiki kennt einen Ort, den unsere Karte nicht hat — aber ohne Koordinaten. Wo er hingehört, muss von Hand bestimmt werden.",
		verbs: [
			{ label: "Auf der Karte setzen", effect: "Du klickst die Stelle auf der Karte an, danach öffnet sich der Anlegen-Dialog. Erst das Speichern legt den Ort an." },
			...LEGACY_COMMON_VERBS.filter((verb) => verb.label === "Zurückstellen" || verb.label === "Archivieren"),
		],
	},
	coat_available: {
		hint: "Das Wiki hat ein Wappen, das bei uns fehlt. Achtung: öffentlich gezeigt werden nur gemeinfreie Wappen — ein vorhandenes Wappen heißt nicht automatisch, dass wir es zeigen dürfen.",
		verbs: LEGACY_COMMON_VERBS,
	},
	missing_capital: {
		hint: "Ein Herrschaftsgebiet nennt im Wiki eine Hauptstadt, die bei uns nicht zugeordnet ist. Betrifft Territorien, nicht Orte.",
		verbs: [
			{ label: "Hauptstadt zuweisen", effect: "Verknüpft das Gebiet mit dem gewählten Ort. Echte Änderung, im Editor umkehrbar." },
			{ label: "Zurückstellen / Archivieren", effect: "Ändern keine Daten. Archivieren passt, wenn das Gebiet schlicht keine Hauptstadt hat." },
		],
	},
};

function getLegacyConflicts() {
	if (typeof wikiSyncCases === "undefined" || !Array.isArray(wikiSyncCases)) {
		return [];
	}
	return wikiSyncCases.map((caseEntry) => {
		const type = caseEntry.case_type === "missing_capital" ? "territory" : "location";
		const label = caseEntry.payload?.map?.name || caseEntry.wiki_title || caseEntry.payload?.name || "";
		return {
			rule_id: `wikisync.${caseEntry.case_type || "unknown"}`,
			fingerprint: `legacy-${caseEntry.id}`,
			// Eigene Form: ein WikiSync-Fall HAT bereits eine echte, stabile Nummer -- die ist
			// nuetzlicher als eine abgeleitete, und das Praefix sagt, wo der Fall herkommt.
			short_id: `WS${caseEntry.id}`,
			severity: LEGACY_CASE_SEVERITY[caseEntry.case_type] || "unverified",
			title: typeof getWikiSyncCaseTitle === "function" ? getWikiSyncCaseTitle(caseEntry) : label,
			status: caseEntry.status === "resolved" ? "done" : (caseEntry.status || "open"),
			parties: [{ type, type_label: conflictData.typeLabels[type] || type, label, id: caseEntry.map_public_id || "" }],
			legacy: caseEntry,
		};
	});
}

// Rule entries for whichever legacy types are actually present, so they appear as normal groups.
function getLegacyRules(conflicts) {
	const seen = new Map();
	conflicts.forEach((conflict) => {
		if (!conflict.legacy || seen.has(conflict.rule_id)) {
			return;
		}
		const caseType = conflict.legacy.case_type || "unknown";
		const info = LEGACY_RULE_INFO[caseType] || {};
		seen.set(conflict.rule_id, {
			id: conflict.rule_id,
			label: conflict.legacy.case_label
				|| (typeof getWikiSyncCaseTypeLabel === "function" ? getWikiSyncCaseTypeLabel(caseType) : caseType),
			hint: info.hint || "Aus dem WikiSync-Lauf.",
			verbs: info.verbs || LEGACY_COMMON_VERBS,
			severity: conflict.severity,
		});
	});

	return Array.from(seen.values());
}

// A conflict belongs to EVERY party's type, not just its subject -- a place-and-territory case has
// to be reachable from both filters (§4.3).
function conflictHasType(conflict, type) {
	if (!type) {
		return true;
	}
	return (conflict.parties || []).some((party) => party.type === type);
}

// Alle Faelle in EINER Liste: die berechneten und die aus dem WikiSync-Lauf.
function getAllConflicts() {
	return conflictData.conflicts.concat(getLegacyConflicts());
}

// Sucht ueber die Fallnummer UND den Text -- ein Editor tippt mal "K7M2QX", mal "Fasar".
// Das "#" darf mitgetippt werden, weil es in der Anzeige davorsteht.
function conflictMatchesQuery(conflict, query) {
	if (!query) {
		return true;
	}
	const needle = query.replace(/^#/, "").toLowerCase();
	const haystack = [
		conflict.short_id || "",
		conflict.title || "",
		...(conflict.parties || []).map((party) => `${party.label || ""} ${party.type_label || ""}`),
	].join(" ").toLowerCase();

	return haystack.includes(needle);
}

function getFilteredConflicts() {
	return getAllConflicts().filter((conflict) => {
		if (!conflictMatchesQuery(conflict, conflictFilter.query)) {
			return false;
		}
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
	// Aus der VOLLEN Menge gezaehlt statt aus der Server-Zusammenfassung: sonst zeigt die Leiste
	// andere Zahlen als die Liste, sobald die WikiSync-Faelle dazukommen.
	const all = getAllConflicts();
	const summary = { by_type: {}, by_severity: {}, by_status: {} };
	all.forEach((conflict) => {
		summary.by_severity[conflict.severity] = (summary.by_severity[conflict.severity] || 0) + 1;
		summary.by_status[conflict.status] = (summary.by_status[conflict.status] || 0) + 1;
		const seen = {};
		(conflict.parties || []).forEach((party) => {
			if (!party.type || seen[party.type]) { return; }
			seen[party.type] = true;
			summary.by_type[party.type] = (summary.by_type[party.type] || 0) + 1;
		});
	});

	const section = (title) => {
		const heading = document.createElement("h4");
		heading.textContent = title;
		rail.appendChild(heading);
	};

	section("Objektart");
	rail.appendChild(createConflictFilterButton("Alle", all.length, conflictFilter.type === "", () => {
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

// Where is this party on the map?
//
// The backend delivers a position for the rules it computes, but the merged WikiSync cases bring
// none -- and they do not need to: the object is already on the map, so looking it up by its
// public id is enough. Owner: "du musst doch nur das ding suchen". Tried in order, each step
// guarded so a missing helper never throws:
//   1. the delivered coordinate
//   2. the location marker
//   3. the path's own geometry
function resolveConflictPartyLatLng(party) {
	const lat = Number(party?.position?.lat);
	const lng = Number(party?.position?.lng);
	if (Number.isFinite(lat) && Number.isFinite(lng)) {
		return L.latLng(lat, lng);
	}

	const publicId = String(party?.id || "").trim();
	if (!publicId) {
		return null;
	}

	if (typeof findLocationMarkerByPublicId === "function") {
		const markerEntry = findLocationMarkerByPublicId(publicId);
		if (markerEntry?.marker) {
			return markerEntry.marker.getLatLng();
		}
	}

	if (typeof findPathByPublicId === "function") {
		// The raw first vertex is enough to fly there -- no need for the smoothed visual geometry.
		// GeoJSON stores [x, y] = [lng, lat], Leaflet wants [lat, lng] (AGENTS.md §5).
		const first = findPathByPublicId(publicId)?.geometry?.coordinates?.[0];
		if (Array.isArray(first) && Number.isFinite(Number(first[0])) && Number.isFinite(Number(first[1]))) {
			return L.latLng(Number(first[1]), Number(first[0]));
		}
	}

	return null;
}

// Fly to a party and get the dialog out of the way. Without closing it the map is behind a
// near-fullscreen overlay and "Anzeigen" would do nothing visible.
function focusConflictParty(party) {
	const latlng = resolveConflictPartyLatLng(party);
	if (!latlng) {
		return;
	}
	// Verkleinern statt schliessen: die Liste bleibt erhalten, samt Filter und aufgeklappter Gruppe.
	setConflictDialogMinimized(true);
	map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
}

// One party = one column of evidence. The conflict alone ("two things share an article") is not
// decidable; what decides it is whether THIS object has an article of its own and where it sits.
// Owner on the live list: "ist Jergan im Wiki? ist Jergan auf der Karte? ... dann kann ich
// entscheiden."
function createConflictPartyElement(party, conflict = null) {
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
	// Bei einem Fall OHNE gespeicherte Verknuepfung heisst ein Treffer etwas anderes als bei einer
	// Kollision: dort belegt er, wem der Artikel gehoert, hier ist er ein Vorschlag.
	const unlinked = conflict?.rule_id === "wiki.missing_key";
	if (party.own_wiki?.url) {
		const link = document.createElement("a");
		link.className = "conflict-party__wiki";
		link.href = party.own_wiki.url;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = unlinked
			? `passender Artikel gefunden: ${party.own_wiki.title} ↗`
			: `eigener Artikel: ${party.own_wiki.title} ↗`;
		evidence.appendChild(link);
	} else {
		const none = document.createElement("span");
		none.className = "conflict-party__none";
		none.textContent = unlinked ? "im Wiki nichts gefunden" : "kein eigener Wiki-Artikel";
		evidence.appendChild(none);
	}

	// "Auf der Karte?" -- asked of the resolver, not of the payload, so a case that brought no
	// coordinate (every merged WikiSync case) still gets the button as long as the object is findable.
	if (resolveConflictPartyLatLng(party)) {
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
	if (conflict.short_id) {
		const id = document.createElement("button");
		id.type = "button";
		id.className = "conflict-case__id";
		id.textContent = `#${conflict.short_id}`;
		id.title = "Fallnummer — klicken zum Kopieren. Damit kann man im Team ueber genau diesen Fall reden.";
		id.addEventListener("click", () => {
			navigator.clipboard?.writeText(`#${conflict.short_id}`);
			id.textContent = "kopiert";
			window.setTimeout(() => { id.textContent = `#${conflict.short_id}`; }, 1200);
		});
		head.appendChild(id);
	}
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
			const partyElement = createConflictPartyElement(party, conflict);
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
		// "Genehmigt" statt "Archivieren", wenn die Lage richtig ist: der Fund war korrekt, das
		// Ergebnis ist es auch. Archivieren bleibt fuer "weiterhin falsch, aber hingenommen".
		actions.appendChild(createConflictActionButton("Genehmigt", conflict, "approved"));
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

function renderConflictFootSummary(all) {
	const element = document.getElementById("conflict-foot-summary");
	if (!element) {
		return;
	}
	const counts = {};
	all.forEach((conflict) => { counts[conflict.status] = (counts[conflict.status] || 0) + 1; });
	const parts = ["open", "deferred", "approved", "archived", "done"]
		.filter((key) => counts[key])
		.map((key) => `${counts[key]} ${CONFLICT_STATUS_LABELS[key].toLowerCase()}`);
	element.textContent = parts.length ? parts.join(" · ") : "";
}

function renderConflicts() {
	renderConflictRail();
	renderConflictFootSummary(getAllConflicts());
	const list = getConflictListElement();
	if (!list) {
		return;
	}
	list.textContent = "";

	const filtered = getFilteredConflicts();
	if (filtered.length < 1) {
		const empty = document.createElement("p");
		empty.className = "conflict-empty";
		empty.textContent = getAllConflicts().length < 1
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

	const rules = conflictData.rules.concat(getLegacyRules(filtered));
	rules.forEach((rule) => {
		const cases = byRule.get(rule.id);
		if (!cases || cases.length < 1) {
			return;
		}
		const group = document.createElement("details");
		group.className = "conflict-group";
		group.open = conflictOpenGroups.has(rule.id);
		group.addEventListener("toggle", () => {
			if (group.open) {
				conflictOpenGroups.add(rule.id);
			} else {
				conflictOpenGroups.delete(rule.id);
			}
		});
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
		cases.forEach((conflict) => {
			if (conflict.legacy && typeof createWikiSyncCaseElement === "function") {
				group.appendChild(createWikiSyncCaseElement(conflict.legacy));
				return;
			}
			group.appendChild(createConflictElement(conflict));
		});
		list.appendChild(group);
	});
}
