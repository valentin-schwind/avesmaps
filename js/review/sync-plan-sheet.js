// Das Bauteil der Übernahme-Vorschau: EIN Blatt für jeden Wiki-Abgleich.
// Entwurf: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md, Mockup:
// docs/sync-uebernahme-mockup.html. Sitzung 1 füllt es mit Stadtkarten; die Sitzungen 2–4 hängen ihre
// Abgleiche daran, ohne diese Datei zu ändern — die Zeilen kommen fertig vom Server.
//
// Drei Kategorien, immer dieselben: Neu · Geändert · Gelöscht. Neu und Geändert kommen vorangehäkelt,
// Gelöscht nie — und Löschen braucht eine zweite, ausdrückliche Bestätigung.
//
// 🔴 KEIN DOM AUF OBERSTER EBENE. Die reinen Bauer stehen oben und sind in einer vm-Sandbox prüfbar
// (js/review/__tests__/sync-plan-sheet.test.js); alles, was ein `document` anfasst, steht unten und
// läuft erst auf Klick. Eine Datei, die beim Laden schon ein Fenster braucht, lässt sich erst prüfen,
// wenn sie im Browser steht — also nie vor dem Deploy.
//
// Geladen von html/citymap-editor.html (Sitzung 1). Das `?v=` stempelt der Deploy (AGENTS.md §7).

/** Was der Abgleich zählt — Ein-/Mehrzahl für die zweite Bestätigung. */
const SYNC_PLAN_KIND_NOUNS = {
	citymap: { one: "Karte", many: "Karten" },
	adventure: { one: "Abenteuer", many: "Abenteuer" },
};

const SYNC_PLAN_KIND_TITLES = {
	citymap: "Stadtkarten aus dem Wiki übernehmen",
	adventure: "Abenteuer aus dem Wiki übernehmen",
};

/**
 * Was die dritte Gruppe je Art bedeutet — und `null` heißt: diese Art löscht nichts.
 *
 * 🔴 Nicht kosmetisch. Eine rote, immer leere Löschgruppe bringt einem Editor bei, sie zu
 * überblättern; und dann überblättert er sie auch dort, wo wirklich etwas verschwindet. Die dritte
 * Kategorie gehört dem Verschwinden einer ganzen Einheit — verliert eine lebende Einheit nur
 * Kindzeilen, die das Wiki nicht mehr auflistet, steht das benannt in ihrer Geändert-Zeile
 * (SYNC_PLAN_LOSS_FIELDS). Bauplan Sitzung 2, Entscheidung 1.
 */
const SYNC_PLAN_KIND_DELETION = {
	citymap: {
		hint: "im Wiki nicht mehr da · <b>nichts vorangehäkelt</b>",
		lead: "Was du <b>nicht</b> anhäkelst, <b>bleibt</b> — dauerhaft, es wird nicht wieder gefragt. "
			+ "Es bleibt trotzdem ein Wiki-Eintrag: kommt der Artikel zurück, läuft er wieder mit.",
	},
	// Ein Abenteuer wird nie gelöscht, auch dann nicht, wenn sein Artikel im Wiki verschwindet: der
	// Abgleich hat dafür keinen Weg und hatte nie einen.
	adventure: null,
};

/**
 * Felder, die einen VERLUST nennen. Sie werden gezeichnet, wo sie stehen — aber in Warnfarbe und ohne
 * Pfeil, weil „— → 3" bei einem Verlust nichts erklärt.
 *
 * 💣 Diese Zeilen kommen vorangehäkelt an (Geändert tut das immer), also muss das eine, was sich nicht
 * zurückholen lässt, das eine sein, das man nicht übersieht.
 */
const SYNC_PLAN_LOSS_FIELDS = ["places_removed", "occurrences_removed", "sources_removed"];

/** Die drei Kategorien und wie sie sich erklären. Reihenfolge = Anzeigereihenfolge. */
const SYNC_PLAN_GROUPS = [
	{ key: "new", name: "Neu", hint: "im Wiki dazugekommen · alle vorangehäkelt" },
	{ key: "changed", name: "Geändert", hint: "Wiki weicht von uns ab · alle vorangehäkelt" },
	{ key: "deleted", name: "Gelöscht", hint: "im Wiki nicht mehr da · <b>nichts vorangehäkelt</b>" },
];

/**
 * Alles, was eine Art über sich sagt, an EINER Stelle abgefragt.
 *
 * ⚠️ Eine unbekannte Art bekommt die strengste Fassung (die der Karten): eine Warnung, die zu viel
 * behauptet, ist unangenehm — eine, die fehlt, ist ein Datenverlust. `known` sagt, dass geraten wurde.
 */
function syncPlanKindMeta(kind) {
	const key = String(kind || "");
	const known = Object.prototype.hasOwnProperty.call(SYNC_PLAN_KIND_TITLES, key);

	return {
		known: known,
		title: SYNC_PLAN_KIND_TITLES[key] || "Aus dem Wiki übernehmen",
		nouns: SYNC_PLAN_KIND_NOUNS[key] || { one: "Eintrag", many: "Einträge" },
		deletion: Object.prototype.hasOwnProperty.call(SYNC_PLAN_KIND_DELETION, key)
			? SYNC_PLAN_KIND_DELETION[key]
			: SYNC_PLAN_KIND_DELETION.citymap,
	};
}

/**
 * HTML-Escaper, sicher für Text UND (in Anführungszeichen stehende) Attribute.
 *
 * Eigene Kopie statt `escapeHtml` aus js/app/utils.js: dieses Bauteil läuft in einer eigenständigen
 * Editor-Seite (iframe) ohne die App-Globals — und im Test ganz ohne Browser.
 */
function syncPlanEscape(value) {
	return (value == null ? "" : String(value))
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/`/g, "&#96;");
}

/**
 * Der deutsche Name eines Feldes. Unbekanntes wird durchgereicht, nicht verschluckt: ein roher
 * Spaltenname ist hässlich, ein fehlendes Feld ist ein Rätsel.
 */
function syncPlanFieldLabel(field) {
	const labels = {
		title: "Titel",
		map_url: "Wiki-Link",
		art: "Art",
		is_color: "Farbe",
		is_labeled: "Beschriftet",
		format: "Format",
		has_scale: "Maßstab",
		author: "Urheber",
		publisher: "Verlag",
		note: "Anmerkung",
		// Die drei, die kein Feld der Zeile sind, sondern eine Nachbartabelle (Entwurf §7).
		place: "Ort",
		source: "Quelle",
		links: "Fundstellen",
		// --- Abenteuer (Sitzung 2). Dieselben deutschen Wörter, die der Abenteuereditor benutzt
		// (html/adventure-editor.html): zwei Beschriftungen für dasselbe Ding wären genau die
		// Divergenz, die die Token-Regel für Farben verbietet -- hier gilt sie für Wörter.
		product_type: "Produkttyp",
		edition: "Regelsystem",
		// Auch wenn es gleich aussieht: die Tabelle ist die Liste dessen, was benannt IST -- ein Feld,
		// das nur zufällig deutsch heißt, wäre morgen das eine ohne Beschriftung.
		genre: "Genre",
		complexity_gm: "Komplexität (SL)",
		complexity_pl: "Komplexität (Spieler)",
		authors: "Autoren",
		series: "Serie / Reihe",
		fshop_code: "F-Shop-Code",
		cover_url: "Cover-URL",
		wiki_url: "Wiki-URL",
		cover: "Titelbild",
		adopt: "Übernahme",
		places: "Orte",
		places_removed: "Orte entfallen",
	};

	return labels[field] || field;
}

/** Ein Wert, wie er in der Vorschau steht. Dreiwertige Häkchen bleiben dreiwertig: null ≠ nein. */
function syncPlanFieldValue(field, value) {
	if (value === null || value === undefined || value === "") {
		return "—";
	}
	if (field === "is_color" || field === "is_labeled" || field === "has_scale") {
		return String(value) === "1" ? "ja" : "nein";
	}

	return String(value);
}

/** „2026-07-28 10:00:00" → „28.07." — kurz, weil es an einer Zeile klebt. */
function syncPlanShortDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));

	return match ? `${match[3]}.${match[2]}.` : "";
}

/** Tausenderpunkte, wie überall sonst in der Oberfläche. */
function syncPlanNumber(value) {
	return Number(value || 0).toLocaleString("de-DE");
}

/**
 * Was die Fußzeile sagt und ob „Übernehmen" geht.
 *
 * 🔴 DER RIEGEL: solange eine Löschung angehäkelt und nicht bestätigt ist, geht GAR NICHTS — auch die
 * harmlosen Übernahmen nicht. Sonst wäre die zweite Bestätigung eine Empfehlung, an der man vorbeikommt,
 * indem man erst den Rest übernimmt und die Löschungen danach allein stehen lässt.
 *
 * ⚠️ `hidden` sind die serverseitig abgeschnittenen Zeilen (200 je Kategorie). Sie stehen mit ihrem
 * Häkchen in der Datenbank und werden mit übernommen — die Fußzeile muss sie also mitzählen, sonst
 * behauptet sie „200 von 5.012".
 */
function syncPlanFooterState(state) {
	const options = state || {};
	const hidden = Number(options.hidden || 0);
	const selected = Number(options.selected || 0);
	const deletions = Number(options.deletions || 0);
	const confirmed = options.confirmed === true;
	const nouns = syncPlanKindMeta(options.kind).nouns;
	const selectedTotal = selected + hidden;

	return {
		selectedTotal: selectedTotal,
		deletions: deletions,
		gateVisible: deletions > 0,
		gateText: `Ja, ${syncPlanNumber(deletions)} ${deletions === 1 ? nouns.one : nouns.many} wirklich `
			+ "löschen. Das lässt sich nicht rückgängig machen.",
		applyDisabled: (deletions > 0 && !confirmed) || selectedTotal < 1,
		applyLabel: deletions > 0 ? `Übernehmen und ${syncPlanNumber(deletions)} löschen` : "Übernehmen",
	};
}

/**
 * Eine neue Zeile beschreibt sich, sie vergleicht nicht.
 *
 * ⚠️ Für „Neu" wäre die Pfeilliste unten irreführend: „Titel — → Elenvina" behauptet ein Vorher, das
 * es nie gab, und füllt die Zeile mit Gedankenstrichen. Was zählt, ist, WAS da ankommt.
 */
function syncPlanNewSummary(item) {
	const after = item.after || {};
	const parts = Object.keys(after).map((field) =>
		`${syncPlanEscape(syncPlanFieldLabel(field))}: ${syncPlanEscape(syncPlanFieldValue(field, after[field]))}`);

	return parts.length > 0 ? `<span class="row__sub">${parts.join(" · ")}</span>` : "";
}

/** Die Unterschiedsliste einer Zeile: alt → neu, und was von Hand festgehalten ist. */
function syncPlanDiffMarkup(item) {
	const after = item.change_type === "new" ? {} : (item.after || {});
	const before = item.before || {};
	const override = item.override || {};
	const rows = [];

	Object.keys(after).forEach((field) => {
		// Ein Verlust ist kein „alt → neu": es gibt kein Nachher, es gibt weniger. Eigene Farbe, eigene
		// Form -- und damit die eine Zeile, die man in einer vorangehäkelten Liste nicht überliest.
		if (SYNC_PLAN_LOSS_FIELDS.indexOf(field) >= 0) {
			rows.push(`<dt>${syncPlanEscape(syncPlanFieldLabel(field))}</dt>`
				+ `<dd class="diff__loss">${syncPlanEscape(syncPlanFieldValue(field, after[field]))}</dd>`);
			return;
		}
		const oldValue = syncPlanEscape(syncPlanFieldValue(field, before[field]));
		const newValue = syncPlanEscape(syncPlanFieldValue(field, after[field]));
		rows.push(`<dt>${syncPlanEscape(syncPlanFieldLabel(field))}</dt><dd>`
			+ `<span class="old">${oldValue}</span><span class="arrow">→</span>`
			+ `<span class="new">${newValue}</span></dd>`);
	});
	Object.keys(override).forEach((field) => {
		// „bleibt …" statt „alt → neu": hier passiert nichts, und das ist der Punkt.
		rows.push(`<dt>${syncPlanEscape(syncPlanFieldLabel(field))}</dt><dd>`
			+ `<span class="kept">bleibt „${syncPlanEscape(override[field])}"</span>`
			+ `<span class="row__sub">von Hand gesetzt — der Abgleich fasst es nicht an</span></dd>`);
	});

	return rows.length > 0 ? `<dl class="diff">${rows.join("")}</dl>` : "";
}

/** Was mit einer Karte verschwände. Genannt wird nur, was es wirklich gibt. */
function syncPlanLossMarkup(item) {
	const before = item.before || {};
	const parts = [];
	const named = [
		["place_count", "Fundort", "Fundorte"],
		["link_count", "Fundstelle", "Fundstellen"],
		["related_count", "Verweis", "Verweise"],
		["source_count", "Quellenverweis", "Quellenverweise"],
	];
	named.forEach(([key, one, many]) => {
		const count = Number(before[key] || 0);
		if (count > 0) {
			parts.push(`${count} ${count === 1 ? one : many}`);
		}
	});

	const lead = "Im aktuellen Dump nicht mehr enthalten.";
	if (parts.length < 1) {
		return lead;
	}
	// Ein einzelner Fundort „gehen" nicht — und diese Zeile wird in einem Moment gelesen, in dem
	// Sorgfalt zählt.
	const single = parts.length === 1 && /^1 /.test(parts[0]);

	return `${lead} Mit ihr ${single ? "verschwindet" : "verschwinden"} ${parts.join(", ")}.`;
}

/** Eine Zeile. */
function syncPlanRowMarkup(item) {
	const skipped = Number(item.skipped_count || 0);
	const tags = [];
	if (skipped > 0 && item.change_type === "changed") {
		const when = syncPlanShortDate(item.last_skipped_at);
		tags.push(`<span class="tag tag--skip">⤴ <b>${skipped}×</b> übersprungen`
			+ `${when ? `, zuletzt ${syncPlanEscape(when)}` : ""}</span>`);
	}
	if (Object.keys(item.override || {}).length > 0) {
		tags.push('<span class="tag tag--own">eigener Wert</span>');
	}

	const why = item.change_type === "deleted"
		? `<span class="row__why">${syncPlanEscape(syncPlanLossMarkup(item))}</span>`
		: "";

	const body = item.change_type === "new" ? syncPlanNewSummary(item) : syncPlanDiffMarkup(item);

	return `<label class="row"><input type="checkbox" data-item-id="${Number(item.id)}"`
		+ ` data-change-type="${syncPlanEscape(item.change_type)}"${item.selected ? " checked" : ""}>`
		+ `<span><span class="row__name">${syncPlanEscape(item.label)}</span> ${tags.join(" ")}`
		+ `${body}${why}</span></label>`;
}

/** Eine Gruppe. Zugeklappt ist sie ihre Überschrift, aufgeklappt ihr Inhalt. */
function syncPlanGroupMarkup(group, items, total, hiddenCount, kind) {
	const meta = syncPlanKindMeta(kind);

	// Eine Art, die nichts löscht, sagt genau das -- und behält die Gruppe, damit die drei Kategorien
	// überall dieselben drei sind (Entwurf §2) und niemand sich fragt, wo die dritte hin ist.
	if (group.key === "deleted" && meta.deletion === null) {
		return `<details class="grp" data-group="deleted"><summary>`
			+ `<span class="grp__name">${group.name}</span>`
			+ `<span class="grp__count">0</span>`
			+ `<span class="grp__hint">dieser Abgleich löscht nichts</span>`
			+ `</summary><div class="rows"><div class="row"><span></span><span class="row__sub">`
			+ `Dieser Abgleich löscht nichts. Was das Wiki nicht mehr auflistet, steht als Verlust in der `
			+ `Zeile des Eintrags, zu dem es gehört — dort, wo es sich abhäkeln lässt.`
			+ `</span></div></div></details>`;
	}

	const rows = (items || []).map(syncPlanRowMarkup);
	if (hiddenCount > 0) {
		rows.push(`<div class="row"><span></span><span class="row__sub">… und `
			+ `${syncPlanNumber(hiddenCount)} weitere (sie sind mit ihrem Häkchen gespeichert und werden `
			+ `mit übernommen)</span></div>`);
	}
	if (rows.length < 1) {
		rows.push('<div class="row"><span></span><span class="row__sub">Nichts.</span></div>');
	}

	// Der Vorspann der Löschgruppe gehört der ART, nicht dieser Datei: bei den Karten verschwindet
	// wirklich etwas, bei den Vorkommen wird stillgelegt. Ein Satz für beide wäre für den einen zu
	// schwach und für den anderen zu stark — und eine zu starke Warnung wird weggeklickt (Entwurf §7).
	const lead = group.key === "deleted" && total > 0 && meta.deletion
		? `<p class="row__sub" style="margin:0 0 8px">${meta.deletion.lead}</p>`
		: "";

	// 🔴 KEIN „alle" ÜBER DEN LÖSCHUNGEN. Bei 168 neuen Zeilen ist Einzelklicken keine Bedienung — bei
	// Löschungen ist es genau das, was der Entwurf will: jede einzeln, mit Blick auf das, was mit ihr
	// verschwände. Ein Knopf, der 37 Löschungen auf einmal anhäkelt, macht die zweite Bestätigung zur
	// einzigen Hürde und die erste zur Formsache.
	const bulk = group.key === "deleted"
		? ""
		: `<span class="grp__bulk"><button type="button" data-bulk="on" data-group="${group.key}">alle</button>`
			+ `<button type="button" data-bulk="off" data-group="${group.key}">keine</button></span>`;

	// 💣 <details>/<summary>, nichts Selbstgebautes: nur damit findet Strg+F Text in einem ZUgeklappten
	// Abschnitt und klappt ihn selbst auf. Fokus, Enter/Leertaste und aria-expanded kommen ebenfalls
	// vom Element — hier gehört kein JS hin.
	const hint = group.key === "deleted" && meta.deletion ? meta.deletion.hint : group.hint;

	return `<details class="grp${group.key === "deleted" ? " grp--del" : ""}"${total > 0 ? " open" : ""}`
		+ ` data-group="${group.key}"><summary>`
		+ `<span class="grp__name">${group.name}</span>`
		+ `<span class="grp__count">${syncPlanNumber(total)}</span>`
		+ `<span class="grp__hint">${hint}</span>${bulk}`
		+ `</summary><div class="rows">${lead}${rows.join("")}</div></details>`;
}

/**
 * Das ganze Blatt.
 *
 * @param {{kind:string, run:object, items:object, truncated:object, declined_count:number}} plan
 */
function syncPlanSheetMarkup(plan) {
	const run = (plan && plan.run) || {};
	const counts = run.counts || {};
	const items = (plan && plan.items) || {};
	const truncated = (plan && plan.truncated) || {};
	const kind = (plan && plan.kind) || "";

	const groups = SYNC_PLAN_GROUPS
		.map((group) => syncPlanGroupMarkup(
			group,
			items[group.key] || [],
			Number(counts[group.key] || 0),
			Number(truncated[group.key] || 0),
			kind
		))
		.join("");

	const declined = Number((plan && plan.declined_count) || 0);
	const declinedLink = declined > 0
		? `<button type="button" class="linkish" data-declined>${syncPlanNumber(declined)} früher `
			+ `abgelehnte Löschungen anzeigen</button>`
		: "";

	const total = Number(counts.total || 0);
	const meta = `Abgleich vom ${syncPlanEscape(run.created_at || "")}`
		+ ` · ${syncPlanNumber(total)} Unterschied${total === 1 ? "" : "e"}`
		+ (run.source_stamp ? ` · Dump vom ${syncPlanEscape(run.source_stamp)}` : "");

	return `<div class="sheet" data-sync-plan data-kind="${syncPlanEscape(kind)}" data-run="${Number(run.id || 0)}">
	<div class="sheet__head">
		<p class="sheet__title">${syncPlanEscape(syncPlanKindMeta(kind).title)}</p>
		<div class="sheet__meta">${meta}</div>
	</div>
	<div class="sheet__body">${groups}</div>
	<p class="gate" data-gate hidden><label><input type="checkbox" data-gate-cb>
		<span data-gate-text></span></label></p>
	<div class="foot">
		<span class="foot__count" data-foot></span>
		${declinedLink}
		<button type="button" class="btn" data-later title="Es wird nichts geschrieben. Die Liste bleibt liegen — samt deiner Häkchen.">Später</button>
		<button type="button" class="btn btn--main" data-apply></button>
	</div>
	<div class="sheet__declined" data-declined-list hidden></div>
</div>`;
}

/** Der leere Fall — kein Fehler, sondern die beste Nachricht des Tages. */
function syncPlanEmptyMarkup(message) {
	return `<div class="sheet"><div class="sheet__head">
		<p class="sheet__title">Übernahme-Vorschau</p>
		<div class="sheet__meta">${syncPlanEscape(message)}</div>
	</div>
	<div class="foot"><span class="foot__count"></span>
		<button type="button" class="btn" data-later>Schließen</button></div></div>`;
}

// =================================================================================================
// Ab hier DOM. Nichts davon läuft beim Laden.
// =================================================================================================

async function syncPlanPost(body) {
	const response = await fetch("/api/edit/wiki/sync-plan.php", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload || payload.ok !== true) {
		const error = new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
		error.code = payload && payload.error && payload.error.code;
		throw error;
	}

	return payload;
}

/**
 * Öffnet die Vorschau in `mount`.
 *
 * @param {{kind:string, mount:HTMLElement, onApplied?:function, onClose?:function}} options
 */
async function openSyncPlanSheet(options) {
	const mount = options && options.mount;
	const kind = (options && options.kind) || "";
	if (!mount) {
		return;
	}

	mount.hidden = false;
	mount.innerHTML = syncPlanEmptyMarkup("Vorschau wird geladen …");

	let plan;
	try {
		plan = await syncPlanPost({ action: "get", kind: kind });
	} catch (error) {
		mount.innerHTML = syncPlanEmptyMarkup(error.message || "Die Vorschau konnte nicht geladen werden.");
		syncPlanBindClose(mount, options);
		return;
	}

	if (!plan.run) {
		mount.innerHTML = syncPlanEmptyMarkup('Es liegt keine Vorschau vor. Erst „Karten syncen" ausführen.');
		syncPlanBindClose(mount, options);
		return;
	}

	plan.kind = kind;
	mount.innerHTML = syncPlanSheetMarkup(plan);
	syncPlanBindSheet(mount, plan, options);
}

function syncPlanBindClose(mount, options) {
	const later = mount.querySelector("[data-later]");
	if (later) {
		later.addEventListener("click", () => {
			mount.hidden = true;
			mount.innerHTML = "";
			if (options && typeof options.onClose === "function") {
				options.onClose();
			}
		});
	}
}

function syncPlanBindSheet(mount, plan, options) {
	const sheet = mount.querySelector("[data-sync-plan]");
	const runId = Number(plan.run.id);
	const kind = plan.kind;
	const counts = plan.run.counts || {};
	const truncated = plan.truncated || {};
	const gate = sheet.querySelector("[data-gate]");
	const gateCb = sheet.querySelector("[data-gate-cb]");
	const gateText = sheet.querySelector("[data-gate-text]");
	const footElement = sheet.querySelector("[data-foot]");
	const applyButton = sheet.querySelector("[data-apply]");

	function boxes() {
		return Array.prototype.slice.call(sheet.querySelectorAll("[data-item-id]"));
	}

	// Die ausgeblendeten Zeilen: was der Server abgeschnitten hat und was davon angehäkelt ist, weiß
	// nur er. Angenommen wird die Voreinstellung — Neu/Geändert angehäkelt, Gelöscht nicht —, und das
	// ist keine Schätzung: genau so hat der Rechen-Schritt sie geschrieben.
	const hiddenSelected = Number(truncated.new || 0) + Number(truncated.changed || 0);

	function refresh() {
		const checked = boxes().filter((box) => box.checked);
		const deletions = checked.filter((box) => box.dataset.changeType === "deleted").length;
		const state = syncPlanFooterState({
			kind: kind,
			selected: checked.length,
			hidden: hiddenSelected,
			deletions: deletions,
			confirmed: gateCb.checked,
		});

		gate.hidden = !state.gateVisible;
		if (!state.gateVisible) {
			gateCb.checked = false;
		}
		gateText.textContent = state.gateText;
		applyButton.disabled = state.applyDisabled;
		applyButton.textContent = state.applyLabel;
		footElement.innerHTML = `<b>${syncPlanNumber(state.selectedTotal)}</b> von `
			+ `${syncPlanNumber(counts.total || 0)} werden übernommen`;
	}

	sheet.addEventListener("change", async (event) => {
		const box = event.target;
		if (box && box.dataset && box.dataset.itemId) {
			refresh();
			try {
				await syncPlanPost({
					action: "select", kind: kind, run_id: runId,
					ids: [Number(box.dataset.itemId)], selected: box.checked,
				});
			} catch (error) {
				// Das Häkchen ist gespeicherter Zustand, kein Anzeigezustand: schlägt das Schreiben
				// fehl, muss es zurückspringen, sonst glaubt der Editor an ein Häkchen, das es nicht gibt.
				box.checked = !box.checked;
				refresh();
			}
			return;
		}
		refresh();
	});

	sheet.querySelectorAll("[data-bulk]").forEach((button) => {
		button.addEventListener("click", async (event) => {
			event.preventDefault();
			const on = button.dataset.bulk === "on";
			const group = button.dataset.group;
			sheet.querySelectorAll(`[data-change-type="${group}"]`).forEach((box) => {
				box.checked = on;
			});
			refresh();
			try {
				await syncPlanPost({
					action: "select", kind: kind, run_id: runId, change_type: group, selected: on,
				});
			} catch (error) {
				await openSyncPlanSheet(options); // neu laden ist ehrlicher als raten
			}
		});
	});

	const declinedButton = sheet.querySelector("[data-declined]");
	if (declinedButton) {
		declinedButton.addEventListener("click", async () => {
			const list = sheet.querySelector("[data-declined-list]");
			list.hidden = false;
			list.innerHTML = '<p class="row__sub">Lade …</p>';
			try {
				const answer = await syncPlanPost({ action: "declined", kind: kind });
				const rows = (answer.declined || []).map((row) =>
					`<label class="row"><input type="checkbox" data-undecline="${syncPlanEscape(row.entity_key)}">`
					+ `<span><span class="row__name">${syncPlanEscape(row.entity_key)}</span>`
					+ `<span class="row__sub">abgelehnt am ${syncPlanEscape(row.declined_at || "")}</span></span></label>`
				);
				list.innerHTML = `<p class="row__sub">Diese Löschungen wurden abgelehnt und werden nicht `
					+ `mehr vorgeschlagen. Angehäkelt und bestätigt, fragt der nächste Abgleich wieder.</p>`
					+ (rows.join("") || '<p class="row__sub">Keine.</p>')
					+ `<button type="button" class="btn" data-undecline-go>Wieder vorschlagen</button>`;
				const go = list.querySelector("[data-undecline-go]");
				if (go) {
					go.addEventListener("click", async () => {
						const keys = Array.prototype.slice.call(list.querySelectorAll("[data-undecline]"))
							.filter((box) => box.checked)
							.map((box) => box.dataset.undecline);
						if (keys.length < 1) {
							return;
						}
						await syncPlanPost({ action: "undecline", kind: kind, entity_keys: keys });
						list.innerHTML = '<p class="row__sub">Erledigt. Der nächste Abgleich fragt wieder.</p>';
					});
				}
			} catch (error) {
				list.innerHTML = `<p class="row__sub">${syncPlanEscape(error.message || "Fehler")}</p>`;
			}
		});
	}

	syncPlanBindClose(mount, options);

	applyButton.addEventListener("click", async () => {
		applyButton.disabled = true;
		const totals = { applied: 0, deleted: 0, stale: 0, skipped: 0, declined: 0 };
		let guard = 0;
		try {
			let done = false;
			while (!done) {
				guard += 1;
				if (guard > 4000) {
					throw new Error("Die Übernahme wurde nach zu vielen Teilschritten angehalten.");
				}
				const step = await syncPlanPost({
					action: "apply", kind: kind, run_id: runId, confirm_delete: gateCb.checked === true,
				});
				["applied", "deleted", "stale", "skipped", "declined"].forEach((key) => {
					totals[key] += Number(step[key] || 0);
				});
				done = step.done === true;
				footElement.innerHTML = `Übernahme läuft … <b>${syncPlanNumber(totals.applied)}</b> geschrieben`;
			}
		} catch (error) {
			footElement.textContent = error.message || "Die Übernahme ist fehlgeschlagen.";
			applyButton.disabled = false;
			return;
		}

		// ⚠️ Was NICHT lief, wird genannt statt verschwiegen: eine veraltete Zeile ist der Preis von
		// „Später", und wer sie nicht liest, hält den Plan für abgearbeitet.
		const parts = [`${syncPlanNumber(totals.applied)} übernommen`];
		if (totals.deleted > 0) {
			parts.push(`${syncPlanNumber(totals.deleted)} gelöscht`);
		}
		if (totals.stale > 0) {
			parts.push(`${syncPlanNumber(totals.stale)} übersprungen, weil sich der Stand geändert hat`);
		}
		if (totals.skipped > 0) {
			parts.push(`${syncPlanNumber(totals.skipped)} bleiben liegen`);
		}
		if (totals.declined > 0) {
			parts.push(`${syncPlanNumber(totals.declined)} behalten`);
		}
		mount.innerHTML = syncPlanEmptyMarkup(parts.join(" · "));
		syncPlanBindClose(mount, options);
		if (options && typeof options.onApplied === "function") {
			options.onApplied(totals);
		}
	});

	refresh();
}
