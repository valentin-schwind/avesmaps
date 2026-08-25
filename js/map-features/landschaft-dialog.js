// Landschaft bearbeiten — die HÜLLE des vereinigten Fensters (Stufe 1).
//
// 🔴 WARUM ES DAS GIBT. Fläche und Beschriftung sind zwei Zeilen in zwei Tabellen, gekoppelt über
// `ecosystem_region.label_public_id` — aber für einen Editor sind sie EINE Landschaft. Live am
// 25.08.2026 gemessen: von 679 Paaren tragen **679** denselben Namen, und vier Werte stehen heute
// in beiden Fenstern (Name, Kurvenbeschriftung, Nodix, plus zwei getrennte Quellenlisten). Der
// Flächendialog warnt an seiner Kurvenbeschriftung wörtlich davor, „zwei Wahrheiten über dieselbe
// Region" zu haben — dieses Fenster beseitigt die Gelegenheit dazu.
//
// 🔴 EIN FENSTER, ZWEI OBJEKTE. Zusammengelegt wird die Bedienung, NICHT die Ablage: 254 von 961
// Beschriftungen haben keine Fläche (ein Berggipfel ist ein Punkt und bekommt nie eine), 334 von
// 1026 Flächen keine Beschriftung, und 13 Flächen tragen zwei oder drei Beschriftungen
// (Owner-Entscheid 28.07.2026: der Finsterkamm will im Norden UND im Süden beschriftet werden).
// Ein zusammengelegter Datensatz wäre für 588 von 1281 Objekten halb leer.
//
// 🔴 DIE HÜLLE BESITZT NUR DIE HÜLLE. Öffnen, Schließen, die drei Reiter, den gemeinsamen Kopf und
// den einen Speichern-Knopf. Was IN den Reitern steht, gehört weiter `review-labels.js` und
// `map-features-ecosystem-properties.js` — deren Element-IDs sind beim Umzug unverändert
// mitgewandert, genau damit die zwei Steuerungen (950 und 2075 Zeilen) nicht angefasst werden
// müssen.
//
// Entwurf: docs/superpowers/specs/2026-08-25-landschaft-dialog-vereinigung-design.md
// Bauplan: docs/superpowers/plans/2026-08-25-landschaft-dialog-vereinigung.md

// Die drei Reiter. ⚠️ Die Reihenfolge ist die Anzeigereihenfolge; `flaeche` steht vorn, weil es der
// Reiter ist, der bei JEDER Datenlage etwas zeigt.
const AVESMAPS_LANDSCHAFT_DIALOG_REITER = ["flaeche", "beschriftung", "wiki"];

/**
 * Welcher Reiter beim Öffnen offen ist. REIN — kein DOM, kein Zustand.
 *
 * 🔴 Owner-Regel 25.08.2026: „Klick ich auf ein Label komm ich auf den neuen Dialog und automatisch
 * auf ‚Beschriftung', klick ich auf die Eigenschaften der Fläche, komm ich auf Fläche."
 *
 * 💣 DER EINSTIEG IST EIN PARAMETER DES ÖFFNERS, NIE EIN MODULZUSTAND. Ein gemerktes „welcher
 * Reiter war zuletzt offen" liefe beim zweiten Öffnen gegen die Regel — genau die Falle, an der das
 * Anzeige-Menü und die Ansichts-Kacheln schon gescheitert sind (AGENTS.md §11).
 *
 * 🔴 Kein Raten: ein unbekannter Einstieg fällt auf „flaeche". Das ist der Reiter, der bei jeder
 * Datenlage etwas zeigt — eine Beschriftung lässt sich immer einer Fläche zuordnen, umgekehrt kann
 * eine Fläche ohne Beschriftung dastehen.
 *
 * @param {string} einstieg "label" | "flaeche"
 * @returns {string} der Name des Reiters
 */
function avesmapsLandschaftDialogStartReiter(einstieg) {
	return einstieg === "label" ? "beschriftung" : "flaeche";
}

/**
 * Den Reiter umschalten. Gibt den tatsächlich gesetzten Namen zurück.
 *
 * ⚠️ EIN REITER WIRD NIE GESPERRT, auch wenn seine Hälfte fehlt. Dort steht das Angebot
 * („Diese Fläche trägt keine Beschriftung." samt Knopf); ein gesperrter Reiter verbärge genau die
 * Handlung, die gerade fehlt.
 *
 * 💣 Der Zustand ist das `hidden` der Bereiche und das `aria-selected` der Knöpfe — kein
 * Modulzustand daneben, der auseinanderlaufen kann. Dieselbe Haltung wie beim Sammelmenü des
 * Menübands (js/ui/ribbon-menu.js).
 */
function avesmapsLandschaftDialogReiter(name) {
	const ziel = AVESMAPS_LANDSCHAFT_DIALOG_REITER.indexOf(name) === -1 ? "flaeche" : name;
	if (typeof document === "undefined") {
		return ziel;
	}
	document.querySelectorAll("[data-landschaft-reiter]").forEach((knopf) => {
		knopf.setAttribute("aria-selected", String(knopf.dataset.landschaftReiter === ziel));
	});
	document.querySelectorAll("[data-landschaft-bereich]").forEach((feld) => {
		feld.hidden = feld.dataset.landschaftBereich !== ziel;
	});
	avesmapsLandschaftDialogLoeschKnopf(ziel);
	return ziel;
}

/** Welcher Reiter gerade offen ist — aus dem DOM gelesen, nie aus einem Merker. */
function avesmapsLandschaftDialogReiterName() {
	if (typeof document === "undefined") {
		return "";
	}
	const aktiv = document.querySelector("[data-landschaft-reiter][aria-selected=\"true\"]");
	return aktiv ? String(aktiv.dataset.landschaftReiter || "") : "";
}

/**
 * Das Fenster zeigen oder verbergen.
 *
 * 💣 `#landschaft-dialog-overlay` muss in SECHS Listen stehen, sonst ist es kein Fenster:
 * der Klick-Ausnahmeliste in js/app/bootstrap.js, den zwei „ist ein Fenster offen"-Abfragen in
 * js/review/review-core.js und den DREI Selektorlisten in css/components/dialog-overlays.css.
 * Ein Overlay-<div> erbt nichts.
 */
function avesmapsLandschaftDialogSichtbar(offen) {
	if (typeof document === "undefined") {
		return false;
	}
	const overlay = document.getElementById("landschaft-dialog-overlay");
	if (!overlay) {
		return false;
	}
	overlay.hidden = !offen;
	return Boolean(offen);
}

/** Ist das Fenster offen? */
function avesmapsLandschaftDialogOffen() {
	if (typeof document === "undefined") {
		return false;
	}
	const overlay = document.getElementById("landschaft-dialog-overlay");
	return Boolean(overlay) && overlay.hidden === false;
}

/**
 * Öffnen. Der Einstieg bestimmt den Reiter; alles Weitere machen die zwei Steuerungen, denen die
 * Felder gehören.
 *
 * @param {{einstieg?: string, reiter?: string}} optionen
 */
function avesmapsLandschaftDialogOeffnen(optionen) {
	const opt = optionen || {};
	const reiter = opt.reiter || avesmapsLandschaftDialogStartReiter(opt.einstieg);
	// 🔴 Verdrahtet wird beim OEFFNEN, nicht beim Laden: die Datei fuehrt auf oberster Ebene
	// nichts aus (zum Ladezeitpunkt gibt es weder `map` noch `L`), und der Aufruf ist
	// idempotent -- ein zweites Oeffnen haengt keinen zweiten Zuhoerer an.
	avesmapsLandschaftDialogVerdrahten();
	avesmapsLandschaftDialogSichtbar(true);
	return avesmapsLandschaftDialogReiter(reiter);
}

/**
 * Wie der gemeinsame Löschknopf im offenen Reiter heißt. REIN — kein DOM.
 *
 * 💣 „Löschen" bedeutet in den zwei alten Fenstern VERSCHIEDENES: im Flächendialog nimmt es die
 * Region SAMT ihren Flächen, im Beschriftungsdialog nur die eine Beschriftung. Ein gemeinsamer
 * Knopf ohne Bezug ist damit die gefährlichste Stelle des ganzen Umbaus — er sieht in beiden
 * Fällen gleich aus und tut Verschiedenes.
 *
 * ⚠️ Im Reiter „Wiki & Quellen" gibt es nichts zu löschen. Der Knopf ist dort VERBORGEN, nicht
 * gesperrt: ein Löschknopf ohne Bezug ist schlimmer als keiner.
 */
function avesmapsLandschaftDialogLoeschText(reiter) {
	if (reiter === "flaeche") {
		return "Fläche löschen";
	}
	if (reiter === "beschriftung") {
		return "Beschriftung löschen";
	}
	return "";
}

/** Den Löschknopf an den offenen Reiter hängen. */
function avesmapsLandschaftDialogLoeschKnopf(reiter) {
	if (typeof document === "undefined") {
		return "";
	}
	const knopf = document.getElementById("landschaft-dialog-delete");
	const text = avesmapsLandschaftDialogLoeschText(reiter);
	if (knopf) {
		knopf.hidden = text === "";
		if (text !== "") {
			knopf.textContent = text;
		}
	}
	return text;
}

/** Schließen. */
function avesmapsLandschaftDialogSchliessen() {
	return avesmapsLandschaftDialogSichtbar(false);
}

/**
 * Die Reiterknöpfe verdrahten. Ein zweiter Aufruf auf demselben Knopf tut nichts.
 *
 * 🔴 DIE DOPPELANMELDUNG IST DIE TEUERSTE FALLE, nicht „es klappt nicht auf": zwei registrierte
 * Klick-Handler öffnen und schließen im selben Klick, für den Benutzer passiert nichts, und jede
 * einzelne Zeile sieht richtig aus. Genau daran ist das Sammelmenü am 23.08.2026 gescheitert.
 */
function avesmapsLandschaftDialogVerdrahten() {
	if (typeof document === "undefined") {
		return 0;
	}
	let neu = 0;
	// 🔴 Die drei Knoepfe der gemeinsamen Leiste BESITZEN nichts -- sie geben an die Haelfte weiter,
	// der die Handlung gehoert. Ein eigener Schreibweg neben den zwei vorhandenen waere die dritte
	// Wahrheit ueber dasselbe Objekt.
	const einmal = (id, tu) => {
		const knopf = document.getElementById(id);
		if (!knopf || knopf.dataset.landschaftVerdrahtet === "1") {
			return;
		}
		knopf.dataset.landschaftVerdrahtet = "1";
		knopf.addEventListener("click", tu);
		neu++;
	};
	einmal("landschaft-dialog-save", () => { avesmapsLandschaftDialogSpeichern(); });
	// ⚠️ „Abbrechen" und „×" gehen ueber die ALTEN Knoepfe der geladenen Haelften: an ihnen haengt
	// mehr als ein Schliessen -- die Beschriftung nimmt dabei ihre Sofortvorschau auf der Karte
	// zurueck (revertLabelDisplayPreview).
	const abbrechen = () => {
		const stand = avesmapsLandschaftDialogStand();
		if (stand.hatLabel) { document.getElementById("label-edit-cancel")?.click(); }
		if (stand.hatFlaeche) { document.getElementById("ecosystem-properties-cancel")?.click(); }
		if (!stand.hatLabel && !stand.hatFlaeche) { avesmapsLandschaftDialogSchliessen(); }
	};
	einmal("landschaft-dialog-cancel", abbrechen);
	einmal("landschaft-dialog-close", abbrechen);
	einmal("landschaft-dialog-delete", () => {
		const reiter = avesmapsLandschaftDialogReiterName();
		if (reiter === "flaeche") { document.getElementById("ecosystem-properties-delete")?.click(); }
		if (reiter === "beschriftung") { document.getElementById("label-edit-delete")?.click(); }
	});
	document.querySelectorAll("[data-landschaft-reiter]").forEach((knopf) => {
		if (knopf.dataset.landschaftVerdrahtet === "1") {
			return;
		}
		knopf.dataset.landschaftVerdrahtet = "1";
		knopf.addEventListener("click", () => {
			avesmapsLandschaftDialogReiter(knopf.dataset.landschaftReiter);
		});
		neu++;
	});
	return neu;
}

/* ── Welche Haelfte ist geladen ──────────────────────────────────────────────────────────────
 *
 * 🔴 DIE FRAGE ENTSCHEIDET, WAS „Speichern" SCHREIBT -- und sie darf nicht geraten werden.
 * Beide <form> stehen IMMER im Markup; ob ein Objekt dahintersteht, weiss nur das Modul, dem die
 * Haelfte gehoert. Es meldet sich deshalb selbst an und ab.
 *
 * 💣 WUERDE MAN BEIDE FORMULARE BLIND ABSCHICKEN, legte jedes Speichern an einer Flaeche ohne
 * Beschriftung eine NEUE an: `buildLabelEditPayload` liest eine leere `public_id` als
 * `create_label`. Ein Knopf, der beim Speichern etwas anlegt, ist kein Speichern.
 */
const avesmapsLandschaftDialogGeladen = { flaeche: false, beschriftung: false };

/**
 * Eine Haelfte an- oder abmelden. Ruft das Modul, dem sie gehoert.
 *
 * @param {string} haelfte "flaeche" | "beschriftung"
 * @param {boolean} ja
 */
function avesmapsLandschaftDialogHaelfte(haelfte, ja) {
	if (haelfte !== "flaeche" && haelfte !== "beschriftung") {
		return false;
	}
	avesmapsLandschaftDialogGeladen[haelfte] = Boolean(ja);
	return avesmapsLandschaftDialogGeladen[haelfte];
}

/** Der Stand beider Haelften -- eine Kopie, damit ihn niemand von aussen verstellt. */
function avesmapsLandschaftDialogStand() {
	return {
		hatFlaeche: avesmapsLandschaftDialogGeladen.flaeche,
		hatLabel: avesmapsLandschaftDialogGeladen.beschriftung,
	};
}

/**
 * Welche Formulare „Speichern" abschickt. REIN -- kein DOM.
 *
 * 🔴 DIE FLAECHE ZUERST. Ihre Aenderung an Name und Art traegt der vorhandene Propagationsweg
 * ohnehin an die Beschriftung (`renameLinkedEcosystemLabel`); andersherum ueberschriebe die
 * Beschriftung den frisch gesetzten Regionsnamen wieder.
 *
 * ⚠️ Wer nur das Formular des OFFENEN Reiters abschickte, verloere die Aenderung im anderen --
 * lautlos, weil das Fenster danach zugeht.
 *
 * @param {{hatFlaeche: boolean, hatLabel: boolean}} stand
 * @returns {string[]} die IDs der Formulare, in Reihenfolge
 */
function avesmapsLandschaftDialogSpeichernAuftraege(stand) {
	const s = stand || {};
	const auftraege = [];
	if (s.hatFlaeche) {
		auftraege.push("ecosystem-properties-form");
	}
	if (s.hatLabel) {
		auftraege.push("label-edit-form");
	}
	return auftraege;
}

/** Speichern: die Formulare der geladenen Haelften abschicken, Flaeche zuerst. */
function avesmapsLandschaftDialogSpeichern() {
	if (typeof document === "undefined") {
		return [];
	}
	const getan = [];
	avesmapsLandschaftDialogSpeichernAuftraege(avesmapsLandschaftDialogStand()).forEach((id) => {
		const formular = document.getElementById(id);
		// ⚠️ `requestSubmit` und nicht `submit()`: nur ersteres loest das submit-EREIGNIS aus, an dem
		// beide Module haengen. `submit()` schickt am Zuhoerer vorbei -- und damit an der ganzen
		// Nutzlast vorbei, die er baut.
		if (formular && typeof formular.requestSubmit === "function") {
			formular.requestSubmit();
			getan.push(id);
		}
	});
	return getan;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_LANDSCHAFT_DIALOG_REITER: AVESMAPS_LANDSCHAFT_DIALOG_REITER,
		avesmapsLandschaftDialogStartReiter: avesmapsLandschaftDialogStartReiter,
		avesmapsLandschaftDialogReiter: avesmapsLandschaftDialogReiter,
		avesmapsLandschaftDialogReiterName: avesmapsLandschaftDialogReiterName,
		avesmapsLandschaftDialogSichtbar: avesmapsLandschaftDialogSichtbar,
		avesmapsLandschaftDialogOffen: avesmapsLandschaftDialogOffen,
		avesmapsLandschaftDialogOeffnen: avesmapsLandschaftDialogOeffnen,
		avesmapsLandschaftDialogSchliessen: avesmapsLandschaftDialogSchliessen,
		avesmapsLandschaftDialogVerdrahten: avesmapsLandschaftDialogVerdrahten,
		avesmapsLandschaftDialogHaelfte: avesmapsLandschaftDialogHaelfte,
		avesmapsLandschaftDialogStand: avesmapsLandschaftDialogStand,
		avesmapsLandschaftDialogSpeichernAuftraege: avesmapsLandschaftDialogSpeichernAuftraege,
		avesmapsLandschaftDialogSpeichern: avesmapsLandschaftDialogSpeichern,
		avesmapsLandschaftDialogLoeschText: avesmapsLandschaftDialogLoeschText,
		avesmapsLandschaftDialogLoeschKnopf: avesmapsLandschaftDialogLoeschKnopf,
	};
}
