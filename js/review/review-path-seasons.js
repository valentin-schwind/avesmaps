/*
 * Die saisonale Gangbarkeit im Karten-Dialog „Weg bearbeiten".
 *
 * ⭐ ERLAUBT UND WANN SIND EINE FRAGE. Die Haken oben sagen, WAS hier fahren darf; diese Zeile sagt,
 * WANN. Drei Zustaende, mehr kennt die Geographia nicht: kein Haken = nie · Haken ohne Fenster =
 * ganzjaehrig · Haken mit Fenster = saisonal. Das Fenster gilt fuer alle angehakten Mittel zugleich
 * -- abweichende Zeiten je Fortbewegungsart traegt das Datenmodell bereits, aber die Quelle belegt
 * bisher keine, und eine Oberflaeche fuer einen unbelegten Fall waere Ballast.
 *
 * 💣 Gespeichert wird die GANGBARKEIT, nicht die Sperre: „gangbar Anfang Peraine bis Ende Boron"
 * steht so in der Quelle, und wer abschreibt macht keinen Uebersetzungsfehler. Der Preis ist der
 * Jahreswechsel -- Peraine bis Boron laeuft ueber ihn, und das ist erlaubt.
 *
 * 💣 Das Fenster gehoert dem WIKI-WEG, nicht diesem einen Segment. Der Server traegt es beim
 * Speichern auf alle Segmente desselben `wiki_path.wiki_key` (siehe
 * avesmapsApplyTransportSeasonsToWikiSiblings) -- ein Pass ist bei uns eine Kette aus bis zu zwoelf
 * Stuecken, und ein Fenster an nur einem davon waere ein Loch, durch das der Router faehrt.
 */

// Wasserwege tragen ihre eigenen Sperrzeiten (Eisgang, Wintersturm), Paesse ihre Schneefenster.
const PATH_SEASON_WATER_SUBTYPES = ["Flussweg", "Seeweg"];

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

function pathSeasonFillSelect(selectElement, includeAllYear) {
	if (!selectElement || selectElement.dataset.filled === "1") {
		return;
	}
	pathSeasonMonthOptions(includeAllYear).forEach((entry) => {
		const option = document.createElement("option");
		option.value = entry.value;
		option.textContent = entry.label;
		selectElement.appendChild(option);
	});
	selectElement.dataset.filled = "1";
}

/** Traegt dieser Weg ueberhaupt eine Jahreszeit? */
function pathSeasonAppliesTo(path, subtype) {
	if (PATH_SEASON_WATER_SUBTYPES.includes(subtype)) {
		return true;
	}
	// 💣 NICHT `subtype === "Gebirgspass"`. Gemessen am Bestand: der Raschtulsweg ist als Strasse und
	// Weg erfasst, der Arvepass als Strasse -- beide nennt die Quelle namentlich mit einem Fenster.
	// Der Wiki-Weg weiss es besser, dort steht `art: "Pass"`.
	const wikiPath = path && path.properties ? path.properties.wiki_path : null;
	const art = wikiPath && typeof wikiPath === "object" ? String(wikiPath.art || "").trim().toLowerCase() : "";
	return art === "pass";
}

/** Das gespeicherte Fenster eines Weges -- irgendeines, sie sind fuer alle Mittel gleich gesetzt. */
function pathSeasonStoredWindow(path) {
	const seasons = path && path.properties ? path.properties.transport_seasons : null;
	if (!seasons || typeof seasons !== "object") {
		return null;
	}
	const first = Object.keys(seasons)[0];
	return first ? seasons[first] : null;
}

function renderPathSeasonSection(path, subtype) {
	const section = document.getElementById("path-edit-season");
	if (!section) {
		return;
	}
	const fromMonth = document.getElementById("path-edit-season-from-month");
	const toMonth = document.getElementById("path-edit-season-to-month");
	pathSeasonFillSelect(fromMonth, true);
	pathSeasonFillSelect(toMonth, false);

	const applies = pathSeasonAppliesTo(path, subtype);
	section.hidden = !applies;
	if (!applies) {
		return;
	}

	const stored = pathSeasonStoredWindow(path);
	if (fromMonth) {
		fromMonth.value = stored ? String(stored.from_month || "") : "";
	}
	if (toMonth) {
		toMonth.value = stored ? String(stored.to_month || "praios") : "praios";
	}
	document.getElementById("path-edit-season-from-day").value = stored ? String(stored.from_day || 1) : "1";
	document.getElementById("path-edit-season-to-day").value = stored ? String(stored.to_day || 30) : "30";
	refreshPathSeasonHint();
}

/** Sagt in Worten, was eingestellt ist -- vor allem, was daraus GESPERRT folgt. */
function refreshPathSeasonHint() {
	const hint = document.getElementById("path-edit-season-hint");
	if (!hint) {
		return;
	}
	const fromMonth = document.getElementById("path-edit-season-from-month");
	if (!fromMonth || !fromMonth.value) {
		hint.textContent = "Ohne Fenster ist der Weg ganzjährig gangbar — für jedes Mittel, das oben angehakt ist.";
		return;
	}
	const toMonth = document.getElementById("path-edit-season-to-month");
	const label = (select) => {
		const option = select.options[select.selectedIndex];
		return option ? option.textContent : "";
	};
	const fromDay = document.getElementById("path-edit-season-from-day").value;
	const toDay = document.getElementById("path-edit-season-to-day").value;
	hint.textContent = "Gangbar " + fromDay + ". " + label(fromMonth) + " bis " + toDay + ". " + label(toMonth)
		+ " — außerhalb gesperrt. Gilt für alle Segmente desselben Wiki-Weges.";
}

/**
 * Was gespeichert wird: das eine Fenster, auf jedes angehakte Mittel geschrieben.
 *
 * Ohne Monat kommt ein leeres Objekt zurueck, und der Server entfernt das Feld dann ganz --
 * „ganzjaehrig" ist die Abwesenheit eines Fensters, nicht ein Fenster ueber zwoelf Monate.
 */
function readPathSeasonsFromForm(allowedTransports) {
	const section = document.getElementById("path-edit-season");
	const fromMonth = document.getElementById("path-edit-season-from-month");
	if (!section || section.hidden || !fromMonth || !fromMonth.value) {
		return {};
	}
	const window = {
		from_month: fromMonth.value,
		from_day: Number(document.getElementById("path-edit-season-from-day").value) || 1,
		to_month: document.getElementById("path-edit-season-to-month").value || "praios",
		to_day: Number(document.getElementById("path-edit-season-to-day").value) || 30,
	};
	const seasons = {};
	(Array.isArray(allowedTransports) ? allowedTransports : []).forEach((transport) => {
		seasons[transport] = window;
	});
	return seasons;
}

document.addEventListener("DOMContentLoaded", () => {
	const section = document.getElementById("path-edit-season");
	if (section) {
		section.addEventListener("change", refreshPathSeasonHint);
		section.addEventListener("input", refreshPathSeasonHint);
	}
});
