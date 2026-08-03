/*
 * Die Gangbarkeit je Fahrtyp im Karten-Dialog „Weg bearbeiten".
 *
 * ⭐ ERLAUBT UND WANN SIND EINE FRAGE, UND SIE STEHT IN EINER ZEILE. Der Haken sagt, OB dieses Mittel
 * hier fahren darf; die Felder dahinter sagen, WANN. Drei Zustaende, mehr kennt die Geographia nicht:
 *
 *   kein Haken              -> nie          („nicht fuer Karren", Raschtulsweg)
 *   Haken + „ganzjaehrig"   -> immer        (der gewoehnliche Weg, und heute jeder)
 *   Haken + Monat           -> Fenster      („gangbar Anfang Peraine bis Ende Boron")
 *
 * 💣 KEINE KOPFZEILE, DIE ALLE SETZT. Bis 2026-08-03 schrieb dieser Dialog EIN Fenster auf ALLE
 * angehakten Mittel -- daraus folgte zwangslaeufig eine Kopfzeile, die alle setzt, und aus der eine
 * Meldung „zwei Zeilen weichen ab". Der Server konnte je Mittel immer schon; nur die Oberflaeche
 * quetschte es zusammen. Owner 2026-08-03: „ich will keine sonderfaelle, sondern ein generelles
 * modell der befahrbarkeit von strecken." Entwurf:
 * docs/superpowers/specs/2026-08-03-gangbarkeit-je-fahrtyp-design.md
 *
 * 💣 EINE REGEL FUERS AUSGRAUEN: ein Feld ist grau und tot, wenn es nichts bedeuten kann. Ohne Haken
 * sind alle vier grau, bei „ganzjaehrig" die hinteren drei. Die WERTE bleiben dabei stehen -- wer
 * einen Haken versehentlich entfernt und wieder setzt, findet sein Fenster vor.
 *
 * 💣 Das Fenster gehoert dem WIKI-WEG, nicht diesem einen Segment. Der Server traegt es beim
 * Speichern auf alle Segmente desselben `wiki_path.wiki_key` (avesmapsApplyTransportSeasonsToWikiSiblings)
 * -- ein Pass ist bei uns eine Kette aus bis zu zwoelf Stuecken, und ein Fenster an nur einem davon
 * waere ein Loch, durch das der Router faehrt.
 */

// Ohne gewaehlten Monat zeigt das „bis"-Feld irgendetwas Totes an; Praios ist der erste Monat des
// Jahres und damit die harmloseste Vorbelegung.
const PATH_SEASON_DEFAULT_TO_MONTH = "praios";

/**
 * Die zwoelf Monate als <option>-Liste, geklont aus dem Reisebeginn des Routenplaners.
 *
 * 💣 Bewusst geklont statt hier aufgeschrieben: die Namen sind Domaeneninhalt und stehen im Markup
 * des Planers (index.html). Eine zweite Liste hier waere eine zweite Wahrheit -- und sie waere die,
 * die beim naechsten Umbenennen vergessen wird. Fehlt der Planer, bleibt der Schluessel stehen;
 * das ist haesslich, aber nie falsch.
 */
function pathSeasonMonthOptions(includeAllYear) {
	const source = document.getElementById("travelStartMonth");
	const options = [];
	if (includeAllYear) {
		options.push({ value: "", label: "ganzjährig" });
	}
	if (source) {
		Array.from(source.options).forEach((option) => {
			if (!option.value) {
				return;
			}
			// „Firun (Winter)" -> „Firun": die Jahreszeit hilft beim Reiseplanen, hier ist sie Ballast.
			options.push({ value: option.value, label: String(option.textContent || "").replace(/\s*\([^)]*\)\s*$/, "").trim() });
		});
	}
	return options;
}

function pathSeasonCreateMonthSelect(className, includeAllYear, ariaLabel) {
	const select = document.createElement("select");
	select.className = "path-season__field " + className;
	select.setAttribute("aria-label", ariaLabel);
	pathSeasonMonthOptions(includeAllYear).forEach((entry) => {
		const option = document.createElement("option");
		option.value = entry.value;
		option.textContent = entry.label;
		select.appendChild(option);
	});
	return select;
}

function pathSeasonCreateDayInput(className, value, ariaLabel) {
	const input = document.createElement("input");
	input.type = "number";
	input.min = "1";
	input.max = "30";
	input.step = "1";
	input.value = String(value);
	input.className = "path-season__field path-season__day " + className;
	input.setAttribute("aria-label", ariaLabel);
	return input;
}

/** Der Name des Fahrtyps, damit jedes Feld einen eigenen, sprechenden Vorlesenamen bekommt. */
function pathSeasonRowLabel(row) {
	const label = row.querySelector("label");
	return label ? String(label.textContent || "").trim() : "";
}

/** Baut die vier Zeitfelder einmal je Zeile; spaetere Aufrufe finden sie vor. */
function pathSeasonEnsureControls(row) {
	const existing = row.querySelector(".path-season");
	if (existing) {
		return existing;
	}
	const name = pathSeasonRowLabel(row);
	const controls = document.createElement("span");
	controls.className = "path-season";
	controls.appendChild(pathSeasonCreateMonthSelect("path-season__from-month", true, name + ": gangbar ab Monat"));
	controls.appendChild(pathSeasonCreateDayInput("path-season__from-day path-season__window", 1, name + ": gangbar ab Tag"));
	const bis = document.createElement("span");
	bis.className = "path-season__bis";
	bis.textContent = "bis";
	controls.appendChild(bis);
	controls.appendChild(pathSeasonCreateMonthSelect("path-season__to-month path-season__window", false, name + ": gangbar bis Monat"));
	controls.appendChild(pathSeasonCreateDayInput("path-season__to-day path-season__window", 30, name + ": gangbar bis Tag"));
	row.appendChild(controls);
	return controls;
}

/** Die eine Ausgrauregel: was nichts bedeuten kann, ist tot. */
function pathSeasonApplyRowState(row) {
	const checkbox = row.querySelector('input[name="allowed_transport"]');
	const controls = pathSeasonEnsureControls(row);
	const fromMonth = controls.querySelector(".path-season__from-month");
	const isAllowed = Boolean(checkbox && checkbox.checked && !checkbox.disabled);
	const hasWindow = isAllowed && fromMonth.value !== "";
	fromMonth.disabled = !isAllowed;
	controls.querySelectorAll(".path-season__window").forEach((field) => {
		field.disabled = !hasWindow;
	});
	// Das Woertchen „bis" ist kein Formularfeld und graut deshalb nicht von selbst.
	controls.classList.toggle("path-season--open", hasWindow);
}

function pathSeasonRows() {
	return Array.from(document.querySelectorAll("#path-edit-transport-options .path-transport-row"));
}

/** Schreibt die gespeicherten Fenster in die Zeilen -- eines je Fahrtyp, keins ist der Normalfall. */
function renderPathTransportSeasons(path) {
	const stored = path && path.properties && path.properties.transport_seasons;
	const seasons = stored && typeof stored === "object" ? stored : {};
	pathSeasonRows().forEach((row) => {
		const checkbox = row.querySelector('input[name="allowed_transport"]');
		if (!checkbox) {
			return;
		}
		const controls = pathSeasonEnsureControls(row);
		const window = seasons[checkbox.value] || null;
		controls.querySelector(".path-season__from-month").value = window ? String(window.from_month || "") : "";
		controls.querySelector(".path-season__from-day").value = window ? String(window.from_day || 1) : "1";
		controls.querySelector(".path-season__to-month").value = window ? String(window.to_month || PATH_SEASON_DEFAULT_TO_MONTH) : PATH_SEASON_DEFAULT_TO_MONTH;
		controls.querySelector(".path-season__to-day").value = window ? String(window.to_day || 30) : "30";
		pathSeasonApplyRowState(row);
	});
}

/**
 * Was gespeichert wird: je angehakter Zeile ihr eigenes Fenster, sofern sie eins traegt.
 *
 * Eine Zeile ohne Monat liefert nichts -- „ganzjaehrig" ist die ABWESENHEIT eines Fensters, nicht
 * ein Fenster ueber zwoelf Monate. Der Server verwirft ausserdem, was auf einem nicht angehakten
 * Mittel steht (avesmapsReadTransportSeasons); hier wird es gar nicht erst gelesen.
 */
function readPathSeasonsFromForm(allowedTransports) {
	const allowed = Array.isArray(allowedTransports) ? allowedTransports : [];
	const seasons = {};
	pathSeasonRows().forEach((row) => {
		const checkbox = row.querySelector('input[name="allowed_transport"]');
		const controls = row.querySelector(".path-season");
		if (!checkbox || !controls || allowed.indexOf(checkbox.value) === -1) {
			return;
		}
		const fromMonth = controls.querySelector(".path-season__from-month");
		if (!fromMonth || !fromMonth.value) {
			return;
		}
		seasons[checkbox.value] = {
			from_month: fromMonth.value,
			from_day: Number(controls.querySelector(".path-season__from-day").value) || 1,
			to_month: controls.querySelector(".path-season__to-month").value || PATH_SEASON_DEFAULT_TO_MONTH,
			to_day: Number(controls.querySelector(".path-season__to-day").value) || 30,
		};
	});
	return seasons;
}

document.addEventListener("DOMContentLoaded", () => {
	const container = document.getElementById("path-edit-transport-options");
	if (!container) {
		return;
	}
	// Ein Haken oder ein Monat aendert, was in DIESER Zeile noch etwas bedeuten kann.
	container.addEventListener("change", (event) => {
		const row = event.target && event.target.closest ? event.target.closest(".path-transport-row") : null;
		if (row) {
			pathSeasonApplyRowState(row);
		}
	});
});
