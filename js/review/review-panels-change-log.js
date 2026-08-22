// Change-log / audit feed: load + render the edit history, focus an audited
// feature on the map (path/label markers), and undo audit changes (incl. the
// undo keyboard shortcut). Split out of review-panels.js (M5 god-file split).
// Plain classic script: global functions called at runtime.

// How many merged entries the "Änderungen" feed shows. Must match the SQL LIMIT of BOTH sources
// (see the comment in loadChangeLog) — a smaller server limit silently drops entries that are newer
// than ones still on screen.
const CHANGE_LOG_FEED_LIMIT = 200;

async function loadChangeLog() {
	if (!IS_EDIT_MODE) {
		return;
	}

	try {
		// 🔴 DIE AUSWAHL REIST MIT: ohne Haken die jüngsten 200 von allen, mit Haken die jüngsten 200
		// VON DEN ANGEHAKTEN. Die Ablage behält seit dem 22.08.2026 je Person 200 Zeilen
		// (api/_internal/audit-prune.php) -- erst dadurch ist beim Server überhaupt etwas zu holen.
		const gewaehlt = [...changeLogEditorFilter];
		const response = await fetch(changeLogRequestUrl(MAP_AUDIT_LOG_API_URL, gewaehlt), {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(apiErrorMessage(data, `Änderungs-API antwortet mit HTTP ${response.status}.`));
		}

		let politicalChanges = [];
		let politicalActors = [];
		try {
			const politicalChangeLog = await fetchPoliticalChangeLog(gewaehlt);
			politicalChanges = Array.isArray(politicalChangeLog?.changes) ? politicalChangeLog.changes : [];
			politicalActors = Array.isArray(politicalChangeLog?.actors) ? politicalChangeLog.actors : [];
		} catch (error) {
			console.warn("Politischer Änderungsverlauf konnte nicht geladen werden:", error);
		}

		// Both sources deliver up to CHANGE_LOG_FEED_LIMIT rows (map_audit_log + political change_log) and
		// the merged feed keeps the newest CHANGE_LOG_FEED_LIMIT. The map side used to be capped at 50
		// server-side while the merge sliced at 100, so in a map-heavy period entries 51+ were dropped even
		// though they were NEWER than political entries that did make the cut — the feed was not "the newest
		// N changes" it claimed to be. The two SQL limits and this slice MUST stay in sync:
		//   api/edit/map/audit-log.php            → LIMIT 200
		//   api/_internal/political/territories-audit.php (change_log) → LIMIT 200
		// Dritte Quelle seit 2026-07-29: die Landschaften. Sie protokollieren seit V2.3 in ihre EIGENE
		// Tabelle (ecosystem_geometry_audit_log) und waren deshalb hier unsichtbar -- man konnte eine
		// Fläche löschen und fand die Änderung nirgends wieder.
		//
		// ⚠️ Eigener try: Die Landschaften-Ebene ist eine Erprobung und kann serverseitig ausgeschaltet
		// sein. Ein Fehler dort darf den Verlauf von Karte und Politik nicht mit ins Leere ziehen --
		// dieselbe Vorsicht, die der politische Abruf oben schon nimmt.
		let ecosystemChanges = [];
		let ecosystemActors = [];
		if (typeof postEcosystemEdit === "function") {
			try {
				const ecosystemChangeLog = await postEcosystemEdit(
					"list_changes",
					gewaehlt.length > 0 ? { editors: gewaehlt } : {}
				);
				ecosystemChanges = Array.isArray(ecosystemChangeLog?.changes) ? ecosystemChangeLog.changes : [];
				ecosystemActors = Array.isArray(ecosystemChangeLog?.actors) ? ecosystemChangeLog.actors : [];
			} catch (error) {
				console.warn("Landschafts-Änderungsverlauf konnte nicht geladen werden:", error);
			}
		}

		changeLogMergeActors(data.actors, politicalActors, ecosystemActors);

		const mapChanges = Array.isArray(data.changes)
			? data.changes.map((entry) => ({ ...entry, audit_source: "map_feature" }))
			: [];
		const politicalChangeEntries = politicalChanges.map((entry) => ({ ...entry, audit_source: "political_territory" }));
		const ecosystemChangeEntries = ecosystemChanges.map((entry) => ({ ...entry, audit_source: "ecosystem" }));
		changeLogEntries = [...mapChanges, ...politicalChangeEntries, ...ecosystemChangeEntries]
			.sort((left, right) => {
				const leftTime = Date.parse(String(left?.created_at || ""));
				const rightTime = Date.parse(String(right?.created_at || ""));
				if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
					return rightTime - leftTime;
				}
				return Number(right?.id || 0) - Number(left?.id || 0);
			})
			.slice(0, CHANGE_LOG_FEED_LIMIT);
		renderChangeLog();
	} catch (error) {
		console.error("Änderungsverlauf konnte nicht geladen werden:", error);
		// 🔴 In die Einblendung, nicht in ein Statusfeld: die überlagert, statt die Liste nach unten zu
		// schieben -- dieselbe Regel wie im WikiSync-Panel. ⚠️ Und sie muss bleiben: ein Fehler, der nur
		// in der Konsole steht, ist für einen Editor kein Fehler, sondern eine leere Liste.
		showFeedbackToast(error.message || "Änderungsverlauf konnte nicht geladen werden.", "warning");
		changeLogRenderNotice("Änderungsverlauf konnte nicht geladen werden.");
	}
}

// Wer die Änderung gemacht hat. 💣 Nicht jede Zeile stammt von einem Menschen: die Import-Tür
// (`api/import/location-reports/update-status.php`) moderiert mit einem Token, und dort steht keine
// `username` — sie stand deshalb bis zum 06.08.2026 als „unbekannt" da, also als Behauptung über
// einen Menschen, den es nie gab (Befund A39).
//
// ⚠️ Die Rangfolge ist Absicht: eine echte `username` gewinnt IMMER. Wäre es andersherum, könnte ein
// mitgeschriebener Vermerk den Namen einer Person überdecken — und der Herkunftsvermerk kommt aus dem
// `after_json` und ist damit die weichere der beiden Quellen.
const CHANGE_LOG_ACTOR_LABELS = {
	import: "Import",
};

function changeLogEntryActor(entry) {
	if (entry?.username) {
		return entry.username;
	}

	const source = String(entry?.actor_source || "");
	return CHANGE_LOG_ACTOR_LABELS[source] || (source !== "" ? source : "unbekannt");
}

// Was in der Zeile steht. Die Landschaften liefern eine fertige Beschriftung mit -- sie kennen die
// GESTE („Mit anderer vereinigen"), während die Aktion nur den letzten Schreibvorgang benennen könnte.
// Bestand ohne `label` läuft unverändert über die Aktionstabelle.
//
// Bei mehr als einem Schritt sagt die Zeile das dazu: Wer „Rückgängig" drückt, soll vorher sehen, dass
// zwei Dinge zurückgehen, nicht eines.
function changeLogEntryLabel(entry) {
	const label = String(entry?.label || "").trim() || formatChangeAction(entry?.action);
	const steps = Number(entry?.steps || 0);

	return steps > 1 ? `${label} (${steps} Schritte)` : label;
}

// 💣 EINE TECHNISCHE KENNUNG IST KEIN NAME. Bis zum 22.08.2026 endete die Rueckfallkette der
// Zielspalte auf `entry.public_id` -- und der politische Lesepfad schrieb seine Geometrie-Kennung
// sogar in `name`. In der Liste stand dann `f74ea2ed-29a9-460d-8d3f-3832e4fbc86b`, wo ein Editor
// „Baronie Hügelsee" erwartet. Der Server nennt das Gebiet inzwischen beim Namen; dieser Riegel
// hier ist der zweite Gurt: er faengt JEDE Quelle, die je wieder eine Kennung durchreicht.
//
// 🔴 `public_id` faellt aus der Kette ganz heraus. Sie bleibt am Datensatz (das Hinspringen und das
// Zuruecknehmen brauchen sie) -- sie ist nur nichts, was jemand LESEN soll.
const CHANGE_LOG_TECHNICAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function changeLogEntryTarget(entry) {
	for (const candidate of [entry?.name, entry?.feature_subtype]) {
		const text = String(candidate ?? "").trim();
		if (text !== "" && !CHANGE_LOG_TECHNICAL_ID_PATTERN.test(text)) {
			return text;
		}
	}

	return "Unbenannt";
}

// Was der Schritt getan hat -- „Name, Einwohner geändert", „um 3,2 Meilen verschoben",
// „1 Fläche → 2 Flächen". Der Server leitet das aus dem Vorher-/Nachher-Stand ab, und zwar aus
// genau den Spalten, die „Rückgängig" zurückschreibt. Leer heisst: dazu laesst sich nichts
// Belastbares sagen -- dann steht die Zeile gar nicht erst da, statt „geändert" zu behaupten.
function changeLogEntryDetail(entry) {
	return String(entry?.detail ?? "").trim();
}

// Der Filter nach Editor. ⚠️ ER SIEBT AUS DEN GELADENEN 200 ZEILEN, er holt nichts nach: ein Haken
// zeigt „die Zeilen dieses Editors unter den letzten 200 insgesamt", nicht „seine letzten 200".
// Owner-Entscheid 22.08.2026 (Fassung A) -- der Reiter beantwortet „was ist gerade passiert und wer
// war's", und dafuer reicht das. Serverseitig zu filtern hiesse, drei getrennte Protokolle einzeln
// zu erweitern.
const changeLogEditorFilter = new Set();
let changeLogFilterRebuild = () => {};
// 💣 DIE NAMENSLISTE DES TRICHTERS KOMMT VOM SERVER, NICHT AUS DEN GELADENEN ZEILEN. Sobald ein
// Haken gesetzt ist, liefert der Lesepfad nur noch die Zeilen dieser Person -- aus der Antwort
// abgeleitet enthielte die Liste dann NUR NOCH SIE, und niemand käme je wieder zu den anderen
// zurück. Ein Trichter, der sich beim ersten Haken selbst zusperrt, ist schlimmer als keiner.
// Der Server zählt deshalb über die ganze Tabelle (avesmapsAuditActorRoster).
// Name -> Anzahl; `null` heißt „bekannt, aber ohne ehrliche Zahl" (die maschinellen Schreiber).
const changeLogActorRoster = new Map();
let changeLogNachladen = null;

// Ein Haken löst ein Nachladen aus -- kurz gebremst, damit drei Klicks hintereinander nicht drei
// Runden über drei Endpunkte auslösen. Neu gezeichnet wird SOFORT aus dem, was schon da ist:
// Rückmeldung jetzt, verbindliche Menge in einem Augenblick.
const CHANGE_LOG_FILTER_RELOAD_DELAY_MS = 250;
// 💣 Solange nachgeladen wird, darf NICHT „Keine Änderungen von dieser Auswahl" dastehen. Genau das
// tat es für einen Wimpernschlag: das Sieben im Browser findet die Zeilen der Angehakten nicht, weil
// sie noch gar nicht geladen sind -- der richtige Satz zum falschen Zeitpunkt liest sich wie ein
// Ergebnis. Gemessen am 22.08.2026 im Ablauf, nicht im Test.
let changeLogFilterWartet = false;

// Die zwei Reiter spiegeln die Auswahl, sie führen keinen eigenen Zustand. ⚠️ Ohne Sitzung gibt es
// den Umschalter GAR NICHT: „Meine" ohne bekannten Namen wäre ein Knopf, der nichts tun kann.
function changeLogSyncScopeButtons() {
	const huelle = document.getElementById("change-log-scope");
	if (!huelle) {
		return;
	}
	const meinName = changeLogCurrentUsername();
	huelle.hidden = meinName === null;
	const zustand = changeLogScopeState(changeLogEditorFilter, meinName);
	huelle.querySelectorAll("[data-change-log-scope]").forEach((knopf) => {
		knopf.classList.toggle("is-active", knopf.dataset.changeLogScope === zustand);
	});
}

function changeLogFilterChanged() {
	changeLogFilterWartet = true;
	renderChangeLog();
	if (changeLogNachladen !== null) {
		window.clearTimeout(changeLogNachladen);
	}
	changeLogNachladen = window.setTimeout(() => {
		changeLogNachladen = null;
		changeLogFilterWartet = false;
		void loadChangeLog();
	}, CHANGE_LOG_FILTER_RELOAD_DELAY_MS);
}

// Die Namen aus den drei Antworten in EINE Liste. ⚠️ Die Anzahlen werden ADDIERT: dieselbe Person
// steht in allen drei Protokollen, und der Trichter zeigt einen Haken je Person, nicht je Protokoll.
function changeLogMergeActors(...listen) {
	changeLogActorRoster.clear();
	listen.forEach((liste) => {
		(Array.isArray(liste) ? liste : []).forEach((eintrag) => {
			const name = String(eintrag?.name ?? "").trim();
			if (name === "") {
				return;
			}
			const bisher = changeLogActorRoster.get(name);
			changeLogActorRoster.set(name, Number(bisher || 0) + Number(eintrag?.count || 0));
		});
	});
}

// PUR: die Adresse mit der Auswahl. Leere Auswahl heisst „alle" und schickt gar kein Feld mit --
// der Server unterscheidet „nichts ausgewählt" von „eine Auswahl, die niemanden trifft".
function changeLogRequestUrl(basis, editorNames) {
	const namen = (Array.isArray(editorNames) ? editorNames : []).filter((name) => String(name || "").trim() !== "");
	if (namen.length < 1) {
		return basis;
	}

	return `${basis}${String(basis).includes("?") ? "&" : "?"}editors=${encodeURIComponent(namen.join(","))}`;
}

// PUR: die Namen im Trichter, mit ihrer Anzahl. Die Reihenfolge ist „wer am meisten getan hat
// zuerst" -- die Liste ist kurz, und danach sucht man.
//
// DREI QUELLEN, in dieser Rangfolge:
//   1. `roster` -- die Konten, vom Server über die GANZE Tabelle gezählt. Die tragende Quelle.
//   2. die geladenen Zeilen -- für die maschinellen Schreiber („Import"), die kein Konto haben und
//      deshalb in keinem Roster stehen können. Sie tragen KEINE Anzahl: der Server kann keine
//      ehrliche nennen, und die aus den geladenen Zeilen wäre nur die der aktuellen Ansicht.
//   3. die Auswahl selbst.
//
// 💣 EIN ANGEHAKTER NAME BLEIBT IN DER LISTE, AUCH WENN ER GERADE NICHT VORKOMMT -- sonst
// verschwände sein Haken aus dem Menü, wäre aber weiter WIRKSAM: die Liste stünde leer da, und
// niemand könnte den Haken finden, um ihn zu lösen. Genau der unsichtbare Lügner, den der Trichter
// vermeiden soll (siehe js/ui/filter-menu.js).
function changeLogEditorOptions(entries, selected, roster) {
	const counts = new Map();
	if (roster && typeof roster.forEach === "function") {
		roster.forEach((anzahl, name) => {
			counts.set(name, Number(anzahl || 0));
		});
	}
	(Array.isArray(entries) ? entries : []).forEach((entry) => {
		const actor = changeLogEntryActor(entry);
		if (!counts.has(actor)) {
			counts.set(actor, null);
		}
	});
	// ⚠️ Gefragt wird nach der FAEHIGKEIT, nicht nach `instanceof Set`: ein Set aus einem anderen
	// Realm (der vm-Sandbox des Tests) besteht die Prueffrage nicht, kann aber alles, was hier
	// gebraucht wird. Ein Riegel, der am Pruefstand anders urteilt als live, ist keiner.
	if (selected && typeof selected.forEach === "function") {
		selected.forEach((actor) => {
			if (!counts.has(actor)) {
				counts.set(actor, null);
			}
		});
	}

	// ⚠️ `null` heißt „keine ehrliche Zahl" und wird beim Sortieren wie 0 behandelt, aber NICHT
	// angezeigt -- avmRenderCheckboxSection lässt die Anzahl bei `null` weg. Eine erfundene 0 stünde
	// dort als Aussage („der hat nichts gemacht"), und das wäre falsch.
	return [...counts.entries()]
		.map(([value, count]) => ({ value, label: value, count }))
		.sort((left, right) => Number(right.count || 0) - Number(left.count || 0)
			|| left.label.localeCompare(right.label, "de"));
}

// Der eigene Name. ⚠️ Er kommt aus der Sitzung, nicht aus den Zeilen: wer heute noch nichts geändert
// hat, steht in keiner Zeile und soll „Meine" trotzdem drücken können (die Antwort ist dann leer, und
// das ist die richtige Antwort). Fehlt die Sitzung, gibt es keinen Umschalter -- siehe unten.
function changeLogCurrentUsername() {
	const sitzung = typeof window !== "undefined" && window.AvesmapsSession
		&& typeof window.AvesmapsSession.current === "function"
		? window.AvesmapsSession.current()
		: null;
	const name = String(sitzung?.username ?? "").trim();

	return name === "" ? null : name;
}

// PUR: welcher der beiden Reiter ist aktiv?
//
// 🔴 ES GIBT EINEN DRITTEN ZUSTAND, UND ER IST KEINER VON BEIDEN. Der Umschalter und der Trichter
// schreiben in DIESELBE Auswahl: „Alle" ist die leere Auswahl, „Meine" ist der eigene Name allein.
// Steht im Trichter jemand anderes (oder mehrere), trifft keiner der beiden Reiter zu -- dann ist
// auch keiner hervorgehoben. Einen davon trotzdem zu markieren wäre eine Behauptung über den
// Zustand, die nicht stimmt; der Zähler am Trichter sagt derweil, was wirklich gilt.
function changeLogScopeState(selected, meinName) {
	if (!selected || typeof selected.has !== "function" || Number(selected.size || 0) < 1) {
		return "all";
	}
	if (meinName && Number(selected.size) === 1 && selected.has(meinName)) {
		return "mine";
	}

	return "";
}

// PUR: leere Auswahl heisst ALLE -- dieselbe Regel wie in jedem anderen Trichter des Hauses.
function changeLogFilterEntries(entries, selected) {
	const list = Array.isArray(entries) ? entries : [];
	if (!selected || typeof selected.has !== "function" || Number(selected.size || 0) < 1) {
		return list;
	}

	return list.filter((entry) => selected.has(changeLogEntryActor(entry)));
}

function formatChangeAction(action) {
	if (String(action || "").startsWith("undo_")) {
		return `Rückgängig: ${formatChangeAction(String(action).replace(/^undo_/, ""))}`;
	}

	const labels = {
		move_point: "Ort verschoben",
		update_point: "Ort geändert",
		create_point: "Ort erstellt",
		wiki_sync_update_point: "WikiSync: Ort geändert",
		wiki_sync_create_point: "WikiSync: Ort erstellt",
		create_crossing: "Kreuzung erstellt",
		create_powerline: "Kraftlinie erstellt",
		update_powerline_details: "Kraftlinie geändert",
		create_path: "Weg erstellt",
		update_path_details: "Weg geändert",
		update_path_geometry: "Wegverlauf geändert",
		create_label: "Label erstellt",
		update_label: "Label geändert",
		move_label: "Label verschoben",
		create_region: "Region erstellt",
		update_region: "Region geändert",
		update_region_geometry: "Regionsgrenze geändert",
		delete_feature: "Objekt gelöscht",
		update_geometry: "Herrschaftsgebiet-Geometrie geändert",
		split_geometry: "Herrschaftsgebiet zerschnitten",
		delete_geometry: "Herrschaftsgebiet-Geometrie gelöscht",
		delete_geometry_part: "Polygon aus Herrschaftsgebiet entfernt",
		// Seit 16.08.2026: eine Aussenhuelle ohne Quellflaeche mehr wird hart geloescht statt nur
		// deaktiviert. Kein Kartenobjekt (derived_geometries, nicht geometries) und kein Weg zurueck --
		// bewusst nicht in avesmapsPoliticalCanUndoGeometryAuditAction, siehe die Schreibstelle dort.
		hard_delete_derived_geometry: "Abgeleitete Außengrenze endgültig gelöscht",
		geometry_operation_union: "Herrschaftsgebiete vereinigt",
		geometry_operation_difference: "Herrschaftsgebiet ausgeschnitten",
		geometry_operation_intersection: "Schnittmenge als Herrschaftsgebiet erstellt",
		// A4: Moderation einer Community-Meldung. Diese Zeilen haben kein Kartenobjekt (feature_id NULL)
		// und sind nicht rückgängig zu machen -- was eine Annahme ERZEUGT hat, steht mit eigener Zeile da.
		report_approved: "Meldung angenommen",
		report_rejected: "Meldung verworfen",
		report_in_review: "Meldung zurückgestellt",
		// A16: die drei harten Löschungen in Kartensammlung, Abenteuern und Natur & Waren. Auch diese
		// Zeilen haben kein Kartenobjekt (feature_id NULL) und sind nicht rückgängig zu machen -- diese
		// Tabellen kennen kein weiches Löschen, ein Knopf würde also etwas versprechen, das kein Code
		// einlösen kann.
		//
		// 💣 Die beiden Vorkommen-Zeilen dürfen NICHT gleich heißen: ein Wiki-Ort wird zum Grabstein und
		// lässt sich mit „Ort wieder aufnehmen" zurückholen, ein manueller ist weg. Ob es einen Weg
		// zurück gibt, ist genau die Frage, für die A16 existiert -- steht sie nur im JSON, beantwortet
		// die Liste sie nie.
		delete_citymap: "Kartensammlung: Karte gelöscht",
		delete_adventure: "Literatur-Eintrag gelöscht",
		delete_lore_place: "Natur & Waren: Ort gelöscht",
		suppress_lore_place: "Natur & Waren: Ort ausgeblendet",
		// Die Lebensraum-Regel (2026-08-13): auch sie hat kein Kartenobjekt und keinen Weg zurück.
		lore_rule_save: "Natur & Waren: Lebensraum-Regel gespeichert",
		lore_rule_delete: "Natur & Waren: Lebensraum-Regel gelöscht",
		// Eine bestätigte Übernahme-Vorschau: EINE Zeile je Lauf, nicht eine je Eintrag (Entwurf
		// 2026-08-06 §4e) -- 46 Löschungen einzeln zu protokollieren würde dieses Protokoll, das nur
		// 200 Zeilen behält, mit einem Klick leerräumen. Welcher Abgleich und mit welchem Ergebnis,
		// steht im Ziel der Zeile („Stadtkarten · 42 übernommen, 3 gelöscht").
		apply_sync_plan: "Wiki-Abgleich: Übernahme",
	};

	return labels[action] || action;
}

// ---- Bündeln und Datum ---------------------------------------------------------------------------
// Owner 22.08.2026: „mach die items etwas kompakter, da geht viel platz verloren, fass die items
// besser zusammen". Entwurf 2 von dreien.

/** Ab so vielen Zeilen wird gebündelt. Eine einzelne bleibt eine normale Zeile, nie ein Bündel mit „1". */
const CHANGE_LOG_GROUP_MIN = 2;

/** Welche Bündel gerade offen sind. Überlebt ein Neuzeichnen, damit ein Nachladen nicht zuklappt. */
const changeLogOpenGroups = new Set();

/** Heute, als `YYYY-MM-DD`. Ausgelagert, damit die Datumsformung rein und prüfbar bleibt. */
function changeLogHeute() {
	const jetzt = new Date();
	const zwei = (zahl) => String(zahl).padStart(2, "0");

	return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
}

// PUR: aus `2026-08-22 18:52:58.708` wird `18:52` -- und `20.08. 18:52`, wenn es nicht heute war.
//
// 💣 Die Millisekunden waren Maschinenausgabe. In einer 400px schmalen Spalte hat
// `2026-08-22 18:52:58.708` mehr Platz gebraucht als der Name des Objekts, um das es ging.
// ⚠️ Nicht `new Date(...)` zum Zerlegen: der Zeitstempel kommt ohne Zeitzone, und Safari liest
// `2026-08-22 18:52` gar nicht als Datum. Zerlegt wird der TEXT, den der Server geschickt hat.
function changeLogFormatTime(createdAt, heute) {
	const text = String(createdAt || "").trim();
	if (text === "") {
		return "";
	}
	const teile = text.split(" ");
	const datum = teile[0] || "";
	const uhrzeit = (teile[1] || "").slice(0, 5);
	if (uhrzeit === "") {
		return text;
	}
	if (datum === heute) {
		return uhrzeit;
	}
	const stuecke = datum.split("-");

	return stuecke.length === 3 ? `${stuecke[2]}.${stuecke[1]}. ${uhrzeit}` : uhrzeit;
}

// PUR: die Zeitspanne eines Bündels. Gleiche Minute -> eine Angabe, sonst von–bis.
// ⚠️ Die Liste ist absteigend sortiert: die LETZTE Zeile ist die älteste.
function changeLogGroupTimeLabel(entries, heute) {
	const liste = Array.isArray(entries) ? entries : [];
	if (liste.length < 1) {
		return "";
	}
	const neueste = changeLogFormatTime(liste[0]?.created_at, heute);
	const aelteste = changeLogFormatTime(liste[liste.length - 1]?.created_at, heute);

	return neueste === aelteste ? neueste : `${aelteste}–${neueste}`;
}

// PUR: aufeinanderfolgende Zeilen desselben Objekts durch dieselbe Person werden ein Bündel.
//
// 🔴 NUR AUFEINANDERFOLGENDE. Über die Zeit hinweg zusammengezogen würde eine Änderung von 15 Uhr
// nach oben zu einer von 18 Uhr wandern, und die Liste beantwortete „was ist gerade passiert" nicht
// mehr -- das ist neben „wer war das" ihre zweite Aufgabe. Die Reihenfolge bleibt unangetastet.
//
// ⚠️ Gebündelt wird nach dem, was in der Zeile STEHT (Ziel und Urheber), nicht nach `public_id`:
// die drei Protokolle vergeben ihre Kennungen unabhängig, und zwei Zeilen desselben Namens aus
// verschiedenen Protokollen gehören für den Leser trotzdem zusammen. „Unbenannt" bündelt damit
// nicht -- richtig so, das ist kein gemeinsames Objekt, sondern ein fehlender Name.
function changeLogGroupEntries(entries) {
	const liste = Array.isArray(entries) ? entries : [];
	const gruppen = [];
	liste.forEach((entry) => {
		const target = changeLogEntryTarget(entry);
		const actor = changeLogEntryActor(entry);
		const letzte = gruppen[gruppen.length - 1];
		if (letzte && letzte.target === target && letzte.actor === actor && target !== "Unbenannt") {
			letzte.entries.push(entry);

			return;
		}
		gruppen.push({
			// Der Schlüssel muss ein Neuzeichnen überleben, aber zwei gleichnamige Bündel an
			// verschiedenen Stellen der Liste unterscheiden -- deshalb die id der ersten Zeile.
			key: `${target}|${actor}|${entry?.id ?? ""}`,
			target,
			actor,
			entries: [entry],
		});
	});

	return gruppen;
}

function renderChangeLog() {
	const listElement = document.getElementById("change-log-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	changeLogSyncScopeButtons();
	// ⚠️ Die Reihenfolge der zwei leeren Zustaende ist Absicht: „noch nichts da" kommt VOR „nichts
	// passt", sonst behauptet ein frisches Protokoll, der Filter haette etwas weggenommen.
	if (changeLogEntries.length < 1) {
		changeLogRenderNotice("Noch keine Änderungen.");
		changeLogFilterRebuild();
		return;
	}

	const sichtbar = changeLogFilterEntries(changeLogEntries, changeLogEditorFilter);
	if (sichtbar.length < 1) {
		changeLogRenderNotice(
			changeLogFilterWartet ? "Änderungen werden geladen ..." : "Keine Änderungen von dieser Auswahl."
		);
		changeLogFilterRebuild();
		return;
	}

	changeLogFilterRebuild();

	changeLogGroupEntries(sichtbar).forEach((gruppe) => {
		if (gruppe.entries.length < CHANGE_LOG_GROUP_MIN) {
			listElement.appendChild(changeLogEntryRow(gruppe.entries[0], false));

			return;
		}

		listElement.appendChild(changeLogGroupHeader(gruppe));
		if (changeLogOpenGroups.has(gruppe.key)) {
			gruppe.entries.forEach((entry) => {
				listElement.appendChild(changeLogEntryRow(entry, true));
			});
		}
	});
}

// 🔴 KEIN STATUSFELD ÜBER DER LISTE (Owner 22.08.2026: „das komische Statusfeld zum Laden raus,
// braucht niemand") -- dieselbe Entscheidung wie am 19.07.2026 im WikiSync-Panel („es braucht kein
// statusfeld -- nirgends"). Ein leerer Zustand steht deshalb IN der Liste: eine leere Fläche ohne
// jedes Wort liest sich wie ein Fehler, und ein Feld darüber schiebt die Liste die übrige Zeit nur
// nach unten. Fehler gehen zusätzlich in die Einblendung, die überlagert statt zu schieben.
function changeLogRenderNotice(text) {
	const listElement = document.getElementById("change-log-list");
	if (!listElement) {
		return;
	}
	// 💣 SETZEN, nicht anhängen. Der Fehlerpfad ruft diese Stelle, ohne dass davor jemand die Liste
	// geleert hat -- angehängt stünden dann „Noch keine Änderungen." und „konnte nicht geladen
	// werden." untereinander, zwei Aussagen über denselben Zustand. Im Browser gemessen, nicht im Test.
	listElement.innerHTML = "";
	const hinweis = document.createElement("p");
	hinweis.className = "change-log-notice";
	hinweis.setAttribute("role", "status");
	hinweis.textContent = text;
	listElement.appendChild(hinweis);
}

// Die Kopfzeile eines Bündels. ⚠️ Sie trägt bewusst KEIN „Rückgängig": ein Knopf, der drei Schritte
// auf einmal zurücknimmt, verspräche etwas, das kein Protokoll einlöst -- die drei Schritte sind
// einzeln aufgezeichnet und werden einzeln zurückgenommen. Aufklappen, dann zurücknehmen.
function changeLogGroupHeader(gruppe) {
	const offen = changeLogOpenGroups.has(gruppe.key);
	const element = document.createElement("div");
	element.className = "change-log-group";
	element.classList.toggle("is-open", offen);
	element.dataset.groupKey = gruppe.key;
	element.tabIndex = 0;
	element.setAttribute("role", "button");
	element.setAttribute("aria-expanded", offen ? "true" : "false");
	element.innerHTML = `
		<span class="change-log-group__caret" aria-hidden="true"></span>
		<span class="change-log-group__name"></span>
		<span class="change-log-group__actor"></span>
		<span class="change-log-group__count"></span>
	`;
	element.querySelector(".change-log-group__caret").textContent = offen ? "▾" : "▸";
	element.querySelector(".change-log-group__name").textContent = gruppe.target;
	// ⚠️ Der Urheber gehört in die Kopfzeile, nicht in die Zeilen darunter: ein Bündel ist per
	// Konstruktion EINE Person, und zugeklappt stünde sonst nirgends, wer es war.
	element.querySelector(".change-log-group__actor").textContent = gruppe.actor;
	element.querySelector(".change-log-group__count").textContent =
		`${gruppe.entries.length} Änderungen · ${changeLogGroupTimeLabel(gruppe.entries, changeLogHeute())}`;

	return element;
}

// Eine Zeile. 🔴 Klasse und `data-change-id` bleiben, wie sie waren -- die Klick- und Rückgängig-
// Zuhörer hängen in js/routing/routing.js am Dokument und suchen genau danach.
function changeLogEntryRow(entry, imBuendel) {
	const itemElement = document.createElement("article");
	itemElement.className = "change-log-entry";
	itemElement.classList.toggle("change-log-entry--grouped", Boolean(imBuendel));
	// 💣 Nur was sich zeigen lässt, ist ein Knopf. Eine Moderationszeile hat kein Kartenobjekt --
	// als Knopf angeboten, antwortet sie beim Klick „Dieses Objekt kann nicht lokalisiert werden.",
	// was nach einem Fehler aussieht und keiner ist. Gilt allgemein: weder public_id noch focus =
	// nichts zum Hinspringen.
	const canFocusEntry = Boolean(entry.public_id) || Boolean(entry.focus);
	itemElement.classList.toggle("change-log-entry--static", !canFocusEntry);
	if (canFocusEntry) {
		itemElement.tabIndex = 0;
		itemElement.setAttribute("role", "button");
	}
	itemElement.dataset.changeId = String(entry.id || "");
	itemElement.dataset.publicId = entry.public_id || "";
	itemElement.dataset.featureType = entry.feature_type || "";
	itemElement.dataset.action = entry.action || "";
	itemElement.classList.toggle("is-undone", Boolean(entry.undone));
	itemElement.innerHTML = `
		<span class="change-log-entry__body">
			<span class="change-log-entry__l1">
				<span class="change-log-entry__target"></span>
				<span class="change-log-entry__action"></span>
			</span>
			<span class="change-log-entry__l2"></span>
		</span>
		<span class="change-log-entry__time"></span>
		<span class="change-log-entry__actions"></span>
	`;
	// ⚠️ Im Bündel steht der Name schon in der Kopfzeile -- ihn je Zeile zu wiederholen war der
	// halbe Grund, warum die Liste so viel Platz brauchte.
	const targetElement = itemElement.querySelector(".change-log-entry__target");
	if (imBuendel) {
		targetElement.hidden = true;
	} else {
		targetElement.textContent = changeLogEntryTarget(entry);
	}
	itemElement.querySelector(".change-log-entry__action").textContent = changeLogEntryLabel(entry);

	// Zweite Zeile: was der Schritt getan hat, wer es war, und ob es schon zurückgenommen wurde.
	// ⚠️ Der Urheber entfällt im Bündel (er steht in der Kopfzeile) -- gebündelt wird nur, was
	// derselbe Mensch am selben Objekt hintereinander getan hat.
	const zweiteZeile = [changeLogEntryDetail(entry)];
	if (!imBuendel) {
		zweiteZeile.push(changeLogEntryActor(entry));
	}
	if (entry.undone) {
		zweiteZeile.push(`zurückgenommen${entry.undone_username ? ` von ${entry.undone_username}` : ""}`);
	}
	const l2 = itemElement.querySelector(".change-log-entry__l2");
	const l2Text = zweiteZeile.filter((teil) => String(teil || "").trim() !== "").join(" · ");
	if (l2Text === "") {
		l2.hidden = true;
	} else {
		l2.textContent = l2Text;
	}

	itemElement.querySelector(".change-log-entry__time").textContent =
		changeLogFormatTime(entry.created_at, changeLogHeute());

	const actionsElement = itemElement.querySelector(".change-log-entry__actions");
	if (entry.can_undo) {
		const undoButtonElement = document.createElement("button");
		undoButtonElement.type = "button";
		undoButtonElement.className = "change-log-entry__undo";
		// On a "Rückgängig: …" entry the same action is a REDO, so it says what it does. Calling it
		// "Rückgängig" there would read as "undo the undo of …" and leave the editor guessing which
		// direction they are about to move -- exactly the moment somebody is already unsure.
		//
		// ⚠️ Das Zeichen allein trägt die Bedeutung nicht -- der Name steht im `title` UND im
		// `aria-label`, sonst ist der Knopf für eine Vorlesehilfe ein „Pfeil nach links".
		const istWiederherstellen = isUndoChangeLogEntry(entry);
		undoButtonElement.textContent = istWiederherstellen ? "↷" : "↶";
		undoButtonElement.title = istWiederherstellen ? "Wiederherstellen" : "Rückgängig";
		undoButtonElement.setAttribute("aria-label", undoButtonElement.title);
		actionsElement.appendChild(undoButtonElement);
	} else {
		actionsElement.hidden = true;
	}

	return itemElement;
}

// Den Trichter verdrahten. Einmal beim Auswerten -- die Huelle steht statisch in index.html, wie
// beim Territorien-Trichter nebenan (review-wiki-sync.js).
if (typeof avmFilterMenuAttach === "function" && typeof document !== "undefined") {
	changeLogFilterRebuild = avmFilterMenuAttach(
		"change-log-filter-toggle",
		"change-log-filter-menu",
		[{
			menuId: "change-log-editor-menu",
			kind: "multi",
			state: changeLogEditorFilter,
			getOptions: () => changeLogEditorOptions(changeLogEntries, changeLogEditorFilter, changeLogActorRoster),
			label: "Editor",
		}],
		() => changeLogFilterChanged(),
		"Filter"
	);
}

// Ein Bündel auf- und zuklappen. ⚠️ Der Zuhörer hängt an der LISTE, nicht am Dokument: die Zeilen
// selbst werden in js/routing/routing.js über einen Dokument-Zuhörer bedient, und ein zweiter, der
// dieselbe Fläche beansprucht, wäre die Sorte Doppelung, die man erst bei der ersten Kollision merkt.
if (typeof document !== "undefined") {
	const listenHuelle = document.getElementById("change-log-list");
	if (listenHuelle) {
		const umschalten = (ziel) => {
			const kopf = ziel instanceof Element ? ziel.closest(".change-log-group") : null;
			if (!kopf) {
				return false;
			}
			const schluessel = kopf.dataset.groupKey || "";
			if (changeLogOpenGroups.has(schluessel)) {
				changeLogOpenGroups.delete(schluessel);
			} else {
				changeLogOpenGroups.add(schluessel);
			}
			renderChangeLog();

			return true;
		};
		listenHuelle.addEventListener("click", (event) => {
			umschalten(event.target);
		});
		listenHuelle.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			if (umschalten(event.target)) {
				event.preventDefault();
			}
		});
	}
}

// Die zwei Reiter. Sie setzen dieselbe Auswahl, die der Trichter füllt -- ein Zustand, zwei
// Bedienwege. Zwei getrennte Zustände wären der sichere Weg in einen Widerspruch.
if (typeof document !== "undefined") {
	const scopeHuelle = document.getElementById("change-log-scope");
	if (scopeHuelle) {
		scopeHuelle.addEventListener("click", (event) => {
			const knopf = event.target instanceof Element ? event.target.closest("[data-change-log-scope]") : null;
			if (!knopf) {
				return;
			}
			const meinName = changeLogCurrentUsername();
			changeLogEditorFilter.clear();
			if (knopf.dataset.changeLogScope === "mine" && meinName !== null) {
				changeLogEditorFilter.add(meinName);
			}
			changeLogFilterChanged();
		});
		changeLogSyncScopeButtons();
	}
}

function findLabelMarkerByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function focusPathFeature(path) {
	if (!path?._pathLines?.length) {
		return false;
	}

	const latLngs = pathCoordinatesToLatLngs(path);
	if (latLngs.length < 1) {
		return false;
	}

	map.fitBounds(L.latLngBounds(latLngs), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
	// Weg-Popups sind nicht mehr per bindPopup gebunden (Klick-Schiedsrichter, siehe path-rendering.js) ->
	// hier manuell in der Weg-Mitte oeffnen. refreshPathLayerPopup hat _popupMarkup bereits gesetzt.
	if (path._popupMarkup) {
		L.popup(path._popupOptions || {})
			.setLatLng(latLngs[Math.floor(latLngs.length / 2)])
			.setContent(path._popupMarkup)
			.openOn(map);
	}
	return true;
}

function focusLabelFeature(labelEntry) {
	if (!labelEntry) {
		return false;
	}

	const latlng = labelEntry.marker.getLatLng();
	if (!map.hasLayer(labelEntry.marker)) {
		map.setZoom(Math.max(map.getZoom(), labelEntry.label.minZoom || 0));
		syncLabelVisibility();
	}
	map.panTo(latlng);
	openLabelEditDialog({ labelEntry });
	return true;
}

function clearChangeLogFocusMarker() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
		changeLogFocusMarkerTimeout = null;
	}
	if (!changeLogFocusMarker) {
		return false;
	}

	map.removeLayer(changeLogFocusMarker);
	changeLogFocusMarker = null;
	return true;
}

function scheduleChangeLogFocusMarkerRemoval() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
	}

	changeLogFocusMarkerTimeout = window.setTimeout(() => {
		clearChangeLogFocusMarker();
	}, CHANGE_LOG_FOCUS_MARKER_TTL_MS);
}

// Derselbe Erzeuger wie in der Liste -- sonst steht auf der Karte eine Kennung, die die Zeile
// daneben gerade vermeidet.
function getChangeLogFocusTooltip(entry) {
	return `${formatChangeAction(entry.action)} · ${changeLogEntryTarget(entry)}`;
}

function focusAuditChangeTarget(entry) {
	const focus = entry?.focus || null;
	if (!focus) {
		return false;
	}

	const latlng = L.latLng(Number(focus.lat), Number(focus.lng));
	if (!isWithinMapBounds(latlng)) {
		return false;
	}

	clearChangeLogFocusMarker();
	if (focus.type === "bounds" && Array.isArray(focus.bounds) && focus.bounds.length === 2) {
		const bounds = L.latLngBounds(focus.bounds.map((coordinate) => L.latLng(Number(coordinate[0]), Number(coordinate[1]))));
		changeLogFocusMarker = L.rectangle(bounds, {
			pane: "measurementPane",
			color: "#31536f",
			weight: 3,
			fillColor: "#ffffff",
			fillOpacity: 0.08,
			interactive: false,
		}).addTo(map);
		changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
			permanent: true,
			direction: "center",
			className: "change-log-focus-tooltip",
		}).openTooltip();
		scheduleChangeLogFocusMarkerRemoval();
		map.fitBounds(bounds, { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
		return true;
	}

	changeLogFocusMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 9,
		color: "#31536f",
		weight: 3,
		fillColor: "#ffffff",
		fillOpacity: 0.95,
	}).addTo(map);
	changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
		permanent: true,
		direction: "top",
		className: "change-log-focus-tooltip",
		offset: [0, -10],
	}).openTooltip();
	changeLogFocusMarker.on("click", clearChangeLogFocusMarker);
	scheduleChangeLogFocusMarkerRemoval();
	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
	return true;
}

function focusChangeLogEntry(entry) {
	if (focusAuditChangeTarget(entry)) {
		return;
	}

	if (!entry?.public_id) {
		showFeedbackToast("Dieses Objekt kann nicht lokalisiert werden.", "warning");
		return;
	}

	const locationEntry = findLocationMarkerByPublicId(entry.public_id);
	if (locationEntry) {
		map.panTo(locationEntry.marker.getLatLng());
		locationEntry.marker.openPopup();
		return;
	}

	const path = findPathByPublicId(entry.public_id);
	if (path && focusPathFeature(path)) {
		return;
	}

	const labelEntry = findLabelMarkerByPublicId(entry.public_id);
	if (labelEntry && focusLabelFeature(labelEntry)) {
		return;
	}

	showFeedbackToast("Objekt ist nicht mehr aktiv oder wurde noch nicht neu geladen.", "warning");
}

function isUndoChangeLogEntry(entry) {
	return String(entry?.action || "").startsWith("undo_");
}

// 🔴 THERE IS NO KEYBOARD PATH INTO THE AUDIT LOG (Owner 2026-07-26). getLatestUndoableChangeLogEntry,
// undoLastChangeLogEntry and handleChangeLogUndoShortcut used to sit here and were bound to Ctrl+Z in
// bootstrap.js. "The newest still-undoable entry" moves on as soon as one is marked undone, so repeated
// presses walked DOWN the history and across users -- three strokes reverted three edits, two of them
// another editor's, server-side and without a dialog. The audit log records the central steps (created,
// edited, deleted, moved), anyone may undo them, but only by clicking "Rückgängig" on the named entry.
// Ctrl+Z belongs to local geometry editing only, where a miss costs nothing.
async function undoChangeLogEntry(entry) {
	if (isChangeUndoPending) {
		return;
	}
	if (!entry?.can_undo) {
		showFeedbackToast("Diese Änderung kann nicht rückgängig gemacht werden.", "warning");
		return;
	}

	isChangeUndoPending = true;
	// Undoing an "undo_X" entry moves the other way, so every line the editor reads has to say so --
	// otherwise the confirmation for a restore reads "Rückgängig: Ort geändert rückgängig gemacht".
	const isRedo = isUndoChangeLogEntry(entry);
	const undoneLabel = isRedo ? formatChangeAction(String(entry.action).replace(/^undo_/, "")) : formatChangeAction(entry.action);

	try {
		const auditSource = String(entry.audit_source || "map_feature");
		if (auditSource === "political_territory") {
			await undoPoliticalAuditChange(Number(entry.id));
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		} else if (auditSource === "ecosystem") {
			// Der Server nimmt die ganze GESTE zurück, nicht nur diese Zeile (operation_id) -- deshalb
			// reicht die id des Eintrags, den das Fenster zeigt.
			await postEcosystemEdit("undo_change", { audit_id: Number(entry.id) });
			// Über den Lesepfad zurück auf die Karte, wie jeder andere Landschafts-Schreibvorgang auch.
			scheduleEcosystemAreaReload?.({ immediate: true });
		} else {
			const result = await undoMapAuditChange(Number(entry.id));
			applyMapFeatureEditResult(result);
			updateRevisionFromEditResponse(result);
		}
		await loadChangeLog();
		void loadReviewReports();
		void loadWikiSyncCases();
		showFeedbackToast(`${undoneLabel} ${isRedo ? "wiederhergestellt" : "rückgängig gemacht"}.`, "success");
	} catch (error) {
		console.error("Änderung konnte nicht rückgängig gemacht werden:", error);
		showFeedbackToast(error.message || "Änderung konnte nicht rückgängig gemacht werden.", "warning");
		await loadChangeLog();
	} finally {
		isChangeUndoPending = false;
	}
}

// Kept although the audit shortcut is gone: the landscape vertex editor's own Ctrl+Z asks this before
// it claims the key, so typing an undo inside a name field stays an undo of the TEXT
// (map-features-ecosystem-edit.js). One definition, so both readings of "is the caret in a field?"
// cannot drift.
function isTextEditingShortcutTarget(target) {
	const element = target instanceof Element ? target : null;
	if (!element) {
		return false;
	}

	return Boolean(element.isContentEditable || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}
