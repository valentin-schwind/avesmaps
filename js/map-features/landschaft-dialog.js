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
		const aktiv = knopf.dataset.landschaftReiter === ziel;
		// 💣 BEIDE, in einem Zug. Die Knoepfe tragen `.ecosystem-layer-switch__tab`, die Reiterform
		// des Hauses -- und deren aktiver Zustand haengt an `.is-active`. Mit `aria-selected` allein
		// war der „gehighlightete" Reiter in Wahrheit immer nur der ueberfahrene (`:hover`), und
		// sobald die Maus wegging, sah das Fenster aus, als sei kein Reiter gewaehlt (Owner
		// 26.08.2026). Die Ebenenleiste desselben Bauteils setzt seit jeher beides nebeneinander
		// (map-features-ecosystem-layer-switch.js) -- hier stand nur die Haelfte davon.
		knopf.classList.toggle("is-active", aktiv);
		knopf.setAttribute("aria-selected", String(aktiv));
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
	if (offen) {
		// 🔴 HIER, nicht im Oeffner der Huelle: die zwei Modul-Oeffner rufen nur diese Funktion.
		// Der Aufruf ist idempotent -- ein zweites Oeffnen haengt keinen zweiten Zuhoerer an.
		avesmapsLandschaftDialogVerdrahten();
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
	// ⚠️ Verdrahtet wird in `…Sichtbar` -- dem einen Trichter, durch den auch die zwei Module gehen.
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
 *
 * 💣 UND ER BRAUCHT EINEN GEGENSTAND, nicht nur einen Bezug. Der Reiter sagt, WAS gelöscht würde;
 * der Stand sagt, ob es das überhaupt gibt. Live gemessen am 26.08.2026: bei einer Fläche ohne
 * Beschriftung stand „Beschriftung löschen" da und tat auf den Klick lautlos gar nichts -- keine
 * Rückfrage, keine Anfrage, keine Meldung. Dieselbe Regel wie im dritten Reiter, nur war sie hier
 * nicht angewandt.
 *
 * 🔴 Ohne Stand gilt die sichere Richtung: KEIN Knopf. Ein Aufrufer, der ihn vergisst, soll nichts
 * anbieten -- nicht auf gut Glück etwas, das es vielleicht nicht gibt.
 *
 * @param {string} reiter "flaeche" | "beschriftung" | "wiki"
 * @param {{hatFlaeche: boolean, hatLabel: boolean}} stand
 */
function avesmapsLandschaftDialogLoeschText(reiter, stand) {
	const s = stand || {};
	if (reiter === "flaeche") {
		return s.hatFlaeche ? "Fläche löschen" : "";
	}
	if (reiter === "beschriftung") {
		return s.hatLabel ? "Beschriftung löschen" : "";
	}
	return "";
}

/** Den Löschknopf an den offenen Reiter UND den Stand der Hälften hängen. */
function avesmapsLandschaftDialogLoeschKnopf(reiter) {
	if (typeof document === "undefined") {
		return "";
	}
	const knopf = document.getElementById("landschaft-dialog-delete");
	const text = avesmapsLandschaftDialogLoeschText(reiter, avesmapsLandschaftDialogStand());
	if (knopf) {
		knopf.hidden = text === "";
		if (text !== "") {
			knopf.textContent = text;
		}
	}
	return text;
}

/**
 * Der Satz, den ein Reiter zeigt, dessen Hälfte fehlt. REIN — kein DOM.
 *
 * 🔴 EIN Satz, keine Statistik (Owner 25.08.2026: „Reicht"). Live betrifft das ein Drittel jeder
 * Seite — 334 Flächen ohne Beschriftung, 254 Beschriftungen ohne Fläche (ein Berggipfel ist ein
 * Punkt und bekommt nie eine). Die Zahlen stehen im Entwurf, nicht im Fenster.
 *
 * ⚠️ Der Reiter wird deshalb NIE gesperrt: dort steht das Angebot. Ein gesperrter Reiter verbärge
 * genau die Handlung, die gerade fehlt.
 */
function avesmapsLandschaftDialogLeertext(reiter, stand) {
	const s = stand || {};
	if (reiter === "flaeche" && !s.hatFlaeche) {
		return "Diese Beschriftung liegt auf keiner Fläche.";
	}
	if (reiter === "beschriftung" && !s.hatLabel) {
		return "Diese Fläche trägt keine Beschriftung.";
	}
	return "";
}

/**
 * Die leeren Zustände beider Reiter nachziehen.
 *
 * 💣 Der Inhalt der Hälfte wird VERBORGEN, nicht geleert: seine Felder gehören den zwei Modulen,
 * und ein geleertes Formular sähe aus wie ein Objekt ohne Werte. Verborgen heißt „gibt es nicht",
 * leer hieße „ist leer" — das ist ein Unterschied, den ein Editor sofort sieht.
 */
function avesmapsLandschaftDialogLagen() {
	if (typeof document === "undefined") {
		return {};
	}
	const stand = avesmapsLandschaftDialogStand();
	const gezeigt = {};
	["flaeche", "beschriftung"].forEach((reiter) => {
		const bereich = document.querySelector('[data-landschaft-bereich="' + reiter + '"]');
		if (!bereich) {
			return;
		}
		const text = avesmapsLandschaftDialogLeertext(reiter, stand);
		const kasten = bereich.querySelector("[data-landschaft-leer]");
		if (kasten) {
			kasten.hidden = text === "";
			const satz = kasten.querySelector("[data-landschaft-leertext]");
			if (satz && text !== "") {
				satz.textContent = text;
			}
		}
		bereich.querySelectorAll("[data-landschaft-inhalt]").forEach((teil) => {
			teil.hidden = text !== "";
		});
		gezeigt[reiter] = text;
	});
	// 🔴 Der Löschknopf zieht MIT. Eine Hälfte kann sich waehrend eines offenen Fensters an- und
	// abmelden („Beschriftung anlegen"), und dann muss der Knopf mitziehen, ohne dass jemand daran
	// denkt -- derselbe Grund, aus dem die leeren Zustaende an dieser Stelle haengen und nicht an
	// den Aufrufern. Der offene Reiter wird aus dem DOM gelesen, nie aus einem Merker daneben.
	avesmapsLandschaftDialogLoeschKnopf(avesmapsLandschaftDialogReiterName());
	// 🔴 Und der dritte Reiter zeigt genau EINEN Zuweisungskasten -- aus demselben Grund an
	// derselben Stelle: die Haelften melden sich hier an und ab, also entscheidet sich hier, wessen
	// Kasten gilt.
	avesmapsLandschaftDialogWikiKasten(stand);
	// 🔴 Und der Titel sagt, WAS das Fenster bearbeitet -- dasselbe Praedikat, dieselbe Stelle.
	avesmapsLandschaftDialogTitel(stand);
	return gezeigt;
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
	// ⚠️ Die leeren Zustaende haengen an DIESER Stelle, nicht an den Aufrufern: eine Haelfte kann
	// sich waehrend eines offenen Fensters an- und abmelden (Beschriftung anlegen), und dann muss
	// der andere Reiter mitziehen, ohne dass jemand daran denkt.
	avesmapsLandschaftDialogLagen();
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
 * In welcher Reihenfolge die zwei Haelften GELADEN werden. REIN -- kein DOM.
 *
 * 🔴 DIE BESCHRIFTUNG ZUERST, DIE FLAECHE ZULETZT -- die exakte Umkehrung des Speicherns, und aus
 * demselben Grund. Der gemeinsame Kopf (Name, Art) und die zwei uebrigen Zwillinge (Nodix,
 * Kurvenbeschriftung) gehoeren der REGION; beim Laden schreiben beide Haelften in dieselben Felder,
 * und wer zuletzt schreibt, gewinnt. Lueden wir die Flaeche zuerst, ueberschriebe
 * `populateLabelEditForm` den Regionsnamen mit dem Labeltext -- bei den 679 gleichnamigen Paaren
 * faellt das nicht auf, bei einem abweichenden Paar lautlos schon.
 *
 * ⚠️ Geladen wird immer, was DA ist -- unabhaengig davon, durch welche Tuer man hereinkam. Der
 * Einstieg bestimmt nur noch den offenen REITER, nichts sonst.
 *
 * @param {{hatFlaeche: boolean, hatLabel: boolean}} vorhanden
 * @returns {string[]} die Haelften, in Ladereihenfolge
 */
function avesmapsLandschaftDialogLadeAuftraege(vorhanden) {
	const v = vorhanden || {};
	const auftraege = [];
	if (v.hatLabel) {
		auftraege.push("beschriftung");
	}
	if (v.hatFlaeche) {
		auftraege.push("flaeche");
	}
	return auftraege;
}

/**
 * Welcher Wiki-Zuweisungskasten im dritten Reiter steht. REIN -- gibt nur zurueck, was gelten soll.
 *
 * 💣 Der Reiter traegt ZWEI Behaelter: `#label-wiki-assign-host` (Zuweisung der Beschriftung) und
 * `#ecosystem-properties-wiki-host` (die der Flaeche). Solange nur eine Haelfte lud, stand dort
 * immer genau einer. Mit beiden Haelften stuenden zwei gleich aussehende Kaesten uebereinander,
 * und niemand koennte sagen, welcher zaehlt.
 *
 * 🔴 ES GEWINNT DIE FLAECHE. `wiki_region_key` liegt an der Region, und die Propagation traegt ihn
 * an ihre Beschriftungen ABWAERTS (`applyRegionToLabels`) -- die Zuweisung der Beschriftung ist eine
 * Kopie davon. Ohne Flaeche (live 254 Beschriftungen) ist ihr eigener Kasten der einzige und bleibt.
 *
 * @returns {boolean} true, wenn der Kasten der Beschriftung gezeigt wird
 */
function avesmapsLandschaftDialogWikiKasten(stand) {
	const s = stand || {};
	const zeigeLabelKasten = !s.hatFlaeche;
	if (typeof document !== "undefined") {
		const kasten = document.getElementById("label-wiki-assign-host");
		if (kasten) {
			kasten.hidden = !zeigeLabelKasten;
		}
	}
	return zeigeLabelKasten;
}

/**
 * Warum diese Flaeche gerade keine Beschriftung bekommen darf. "" heisst „sie darf". REIN.
 *
 * 🔴 Owner 26.08.2026: „landschaften die autonamen haben, duerfen keine beschriftung bekommen … bis
 * auto-name wieder aus ist." Die Begruendung steht seit jeher im Namensmodul: „Ein Auto-Name ist
 * interne Buchfuehrung und darf nie nach aussen dringen" (`ecosystemRegionDisplayName`) -- und die
 * Beschriftung IST das Nachaussendringen, sie schreibt den Namen auf die Karte.
 *
 * 💣 GESPERRT HEISST: EIN SATZ, nicht bloss ein toter Knopf. Ein ausgegrauter Knopf ohne Grund ist
 * die Sorte Sackgasse, an der ein Editor raetselt, was er falsch macht -- dieselbe Regel wie beim
 * Loeschknopf nebenan, der lieber verschwindet, als bezuglos dazustehen.
 *
 * ⚠️ Ohne Angabe wird NICHT gesperrt: im Zweifel bleibt die Handlung erreichbar. Eine Sperre, die
 * aus Unwissen zuschlaegt, nimmt dem Editor eine Moeglichkeit, die er hat.
 */
function avesmapsLandschaftDialogAnlegenSperre(autoName) {
	return autoName === true
		? "Solange „Auto-Name“ gesetzt ist, bekommt diese Fläche keine Beschriftung — ein Griff wie "
			+ "„Wald-001“ gehört nicht auf die Karte. Haken entfernen und einen Namen vergeben."
		: "";
}

/**
 * Den Knopf „Beschriftung anlegen" an die Sperre haengen -- Knopf tot, Grund sichtbar.
 *
 * @param {boolean} autoName ob der Haken „Auto-Name" gerade gesetzt ist
 * @returns {string} der gezeigte Satz, "" wenn nichts gesperrt ist
 */
function avesmapsLandschaftDialogAnlegenKnopf(autoName) {
	const satz = avesmapsLandschaftDialogAnlegenSperre(autoName);
	if (typeof document === "undefined") {
		return satz;
	}
	const knopf = document.getElementById("landschaft-dialog-label-anlegen");
	if (knopf) {
		knopf.disabled = satz !== "";
	}
	const hinweis = document.querySelector("[data-landschaft-anlegen-hinweis]");
	if (hinweis) {
		hinweis.hidden = satz === "";
		hinweis.textContent = satz;
	}
	return satz;
}

/**
 * Wie das Fenster heisst. Gibt zurueck, was gesetzt wurde -- "" heisst „nicht angefasst".
 *
 * 🪤 `#ecosystem-properties-title` gibt es im vereinigten Fenster NICHT mehr; der Schreibversuch des
 * Flaechen-Oeffners laeuft ins Leere, und sichtbar ist allein `#label-edit-title`. Solange die
 * Beschriftungs-Haelfte beim Flaechen-Einstieg nicht lud, blieb dort die Aufschrift aus dem Markup
 * stehen. Seit sie IMMER laedt, schriebe `setLabelEditDialogTitle` dort „Topographie-Label
 * bearbeiten" -- fuer ein Fenster, das BEIDE Haelften bearbeitet, eine falsche Auskunft.
 *
 * 🔴 Dasselbe Praedikat wie beim Wiki-Kasten: liegt eine FLAECHE vor, ist es eine Landschaft. Ohne
 * Flaeche behaelt die Beschriftung ihren eigenen, genaueren Titel -- „Freies Label bearbeiten" ist
 * eine Aussage ueber die Zugehoerigkeit, die nicht verlorengehen darf.
 */
function avesmapsLandschaftDialogTitel(stand) {
	const s = stand || {};
	if (!s.hatFlaeche) {
		return "";
	}
	// 🔴 „Region bearbeiten" (Owner 26.08.2026) -- und es ist auch das Wort, das der
	// Landschaften-Editor daneben benutzt („2854 Regionen · 1027 gezeichnet").
	const titel = "Region bearbeiten";
	if (typeof document !== "undefined") {
		const kopf = document.getElementById("label-edit-title");
		if (kopf) {
			kopf.textContent = titel;
		}
	}
	return titel;
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
		avesmapsLandschaftDialogLadeAuftraege: avesmapsLandschaftDialogLadeAuftraege,
		avesmapsLandschaftDialogWikiKasten: avesmapsLandschaftDialogWikiKasten,
		avesmapsLandschaftDialogTitel: avesmapsLandschaftDialogTitel,
		avesmapsLandschaftDialogAnlegenSperre: avesmapsLandschaftDialogAnlegenSperre,
		avesmapsLandschaftDialogAnlegenKnopf: avesmapsLandschaftDialogAnlegenKnopf,
		avesmapsLandschaftDialogSpeichernAuftraege: avesmapsLandschaftDialogSpeichernAuftraege,
		avesmapsLandschaftDialogSpeichern: avesmapsLandschaftDialogSpeichern,
		avesmapsLandschaftDialogLoeschText: avesmapsLandschaftDialogLoeschText,
		avesmapsLandschaftDialogLoeschKnopf: avesmapsLandschaftDialogLoeschKnopf,
		avesmapsLandschaftDialogLeertext: avesmapsLandschaftDialogLeertext,
		avesmapsLandschaftDialogLagen: avesmapsLandschaftDialogLagen,
	};
}
