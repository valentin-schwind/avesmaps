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
	// 🔴 Und der Quellenkasten aus demselben Grund an derselben Stelle -- siehe dort.
	avesmapsLandschaftDialogQuellenKasten(stand);
	// ⚠️ Den Titel setzt hier NIEMAND mehr: er braucht die EBENE, und die kennt nur die Haelfte, der
	// sie gehoert. Geschrieben wird er von `setLabelEditDialogTitle` (die traegt ihren `kind` ohnehin)
	// und vom Flaechen-Oeffner. Eine geratene Ebene ueber einem Fenster, in dem man Geometrie
	// bearbeitet, waere schlimmer als ein Platzhalter.
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
	einmal("landschaft-dialog-save", () => { void avesmapsLandschaftDialogSpeichern(); });
	// Wer den Kopf anfasst, wird gemerkt -- siehe avesmapsLandschaftDialogKopfMerken.
	avesmapsLandschaftDialogKopfVerdrahten();
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
 * Welcher Quellenkasten im dritten Reiter steht -- und ob der Abschnitt ueberhaupt dasteht.
 * REIN in seiner Entscheidung, schreibt nur `hidden`.
 *
 * 🔴 DER REITER HEISST „Wiki & Quellen", ALSO STEHEN DIE QUELLEN DARIN (Owner 03.09.2026). Bis
 * dahin lag der Kasten der Flaeche im Reiter „Fläche", und hier stand nur ein Verweis darauf. Der
 * Owner hat einen Import fuer leer gehalten, weil er dort nachsah, wo „Quellen" draufsteht -- und
 * die Quelle hing die ganze Zeit korrekt an der Flaeche. Die Beschriftung IST das Versprechen.
 *
 * 💣 DER REITER TRAEGT ZWEI BEHAELTER, GENAU WIE BEIM WIKI-KASTEN DARUEBER:
 * `#ecosystem-properties-sources` (Quellen der Flaeche) und `#label-edit-feature-sources` (die der
 * freien Beschriftung). Zwei gleich aussehende Kaesten uebereinander, und niemand koennte sagen,
 * welcher zaehlt -- deshalb entscheidet es sich HIER, wo die Haelften sich an- und abmelden, und
 * nicht bei den zwei Montierern.
 *
 * 🔴 ES GEWINNT DIE FLAECHE -- dieselbe Regel und derselbe Grund wie beim Wiki-Kasten: seit
 * Schritt 5 des Quellen-Umbaus (03.09.2026) traegt die Flaeche die Quellen, und die gebundene
 * Beschriftung LIEST sie nur (avesmapsEcosystemLabelSourceTarget). Ohne Flaeche ist der eigene
 * Kasten der Beschriftung der einzige und bleibt.
 *
 * 🔴 UND DER ABSCHNITT BLENDET SICH WEG, WENN KEINE HAELFTE GELADEN IST. Eine Ueberschrift
 * „Quellen" ueber dem Nichts liest sich wie ein Fehler -- dieselbe Regel wie beim Trenner der
 * Quellenzeile, der nur kommt, wenn oben wirklich etwas steht.
 * ⚠️ „Eine Haelfte geladen" genuegt als Bedingung: eine GEBUNDENE Beschriftung bringt ihre Flaeche
 * immer mit (der Beschriftungs-Oeffner ruft den Flaechen-Oeffner als Gegenpart), es kann also nie
 * der Fall eintreten, dass beide Behaelter leer bleiben, obwohl eine Haelfte geladen ist.
 *
 * @returns {boolean} true, wenn der Kasten der Beschriftung gezeigt wird
 */
function avesmapsLandschaftDialogQuellenKasten(stand) {
	const s = stand || {};
	const zeigeLabelKasten = !s.hatFlaeche;
	if (typeof document !== "undefined") {
		const flaeche = document.getElementById("ecosystem-properties-sources");
		if (flaeche) {
			flaeche.hidden = !s.hatFlaeche;
		}
		const label = document.getElementById("label-edit-feature-sources");
		if (label) {
			label.hidden = !zeigeLabelKasten;
		}
		const abschnitt = document.getElementById("landschaft-quellen-abschnitt");
		if (abschnitt) {
			abschnitt.hidden = !(s.hatFlaeche || s.hatLabel);
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
 * Die Ankuendigung am Haken „Auto-Name": was dieses Speichern kosten wird. REIN + DOM.
 *
 * 🔴 Wer anhakt, verliert beim Speichern die Beschriftung. Das gehoert AN DEN HAKEN und nicht in
 * eine Meldung hinterher -- eine stillschweigend geloeschte Beschriftung vermisst man erst Tage
 * spaeter auf der Karte. Dieselbe Haltung wie bei den Loeschrueckfragen, die ihre Kaskade nennen.
 *
 * ⚠️ Nur beim UEBERGANG. Stand der Haken beim Oeffnen schon, passiert nichts, und dann darf auch
 * nichts angekuendigt werden -- eine Warnung, die nicht eintritt, lehrt einen, Warnungen zu
 * uebersehen.
 *
 * @param {boolean} vorher der Stand beim Oeffnen
 * @param {boolean} jetzt  der Stand jetzt
 * @param {number}  anzahl wie viele Beschriftungen die Flaeche traegt
 * @returns {string} der gezeigte Satz, "" wenn nichts anzukuendigen ist
 */
function avesmapsLandschaftDialogAutoNameWarnung(vorher, jetzt, anzahl) {
	const zahl = Number(anzahl) || 0;
	const satz = (avesmapsLandschaftDialogAutoNameEntfernt(vorher, jetzt) && zahl > 0)
		? (zahl === 1
			? "Beim Speichern wird die Beschriftung dieser Fläche entfernt — ein Auto-Name gehört nicht auf die Karte."
			: "Beim Speichern werden " + zahl + " Beschriftungen dieser Fläche entfernt — ein Auto-Name gehört nicht auf die Karte.")
		: "";
	if (typeof document !== "undefined") {
		const kasten = document.querySelector("[data-landschaft-autoname-warnung]");
		if (kasten) {
			kasten.hidden = satz === "";
			kasten.textContent = satz;
		}
	}
	return satz;
}

/**
 * Muss dieses Speichern die vorhandenen Beschriftungen entfernen? REIN.
 *
 * 🔴 Owner 26.08.2026: „bestehende labels sollen entfernt werden, sofern ‚Auto-Name' angehaekelt
 * wird." Das ist ein ÜBERGANG, kein Zustand -- „wird angehaekelt" heisst aus→an in DIESEM Fenster.
 *
 * 💣 Der Unterschied ist nicht akademisch. Der Haken wird ABGELEITET (er steht genau dann, wenn der
 * Name die Form `<Art>-<Zahl>` hat), also ist er bei den Flaechen, die schon einen Auto-Namen
 * tragen, beim OEFFNEN bereits gesetzt. Als Zustand gelesen loeschte dort jedes beilaeufige
 * „Speichern" die Beschriftung, ohne dass jemand etwas angehakt haette -- eine Zerstoerung als
 * Nebenwirkung einer unbeteiligten Aenderung.
 *
 * @param {boolean} vorher der Stand beim Oeffnen
 * @param {boolean} jetzt der Stand beim Speichern
 */
function avesmapsLandschaftDialogAutoNameEntfernt(vorher, jetzt) {
	return jetzt === true && vorher !== true;
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
function avesmapsLandschaftDialogTitel(stand, kind) {
	const s = stand || {};
	if (!s.hatFlaeche) {
		return "";
	}
	// 🔴 DER TITEL NENNT DIE EBENE (Owner 26.08.2026, nach einem Tag mit „Region bearbeiten": „ich
	// will nicht ‚Region bearbeiten' sondern ‚Derographie/Vegetation/Topographie bearbeiten'").
	// ⭐ Mit dem Wort, das das Haus dafuer ohnehin fuehrt -- `ECOSYSTEM_KIND_LABELS`, dieselbe Vokabel
	// wie in der Ebenenleiste und in den Gruppenueberschriften der Flaechenauswahl. Eine eigene
	// Tabelle daneben waere die Divergenz, die §12 meint.
	// ⚠️ Ohne bekannte Ebene wird NICHT geraten: lieber der Platzhalter aus dem Markup als eine
	// falsche Ebene ueber einem Fenster, in dem man Geometrie bearbeitet.
	const ebene = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS)
		? String(ECOSYSTEM_KIND_LABELS[String(kind || "")] || "")
		: "";
	if (ebene === "") {
		return "";
	}
	const titel = ebene + " bearbeiten";
	if (typeof document !== "undefined") {
		const kopf = document.getElementById("label-edit-title");
		if (kopf) {
			kopf.textContent = titel;
		}
	}
	return titel;
}

/**
 * Welche Haelften „Speichern" schreibt, in welcher Reihenfolge -- benannt nach ihren Formularen. REIN.
 *
 * 🔴 DIE FLAECHE ZUERST. Sie schreibt die Region (und damit den Kopf: Name, Art, Wiki-Zuweisung), der
 * Server zieht dabei die Beschriftungen nach, und die Antwort bringt ihnen die frische Revision. Erst
 * danach schreibt die Beschriftung -- mit dieser Revision, also ohne 409. Seit dem 27.09.2026 laufen
 * die zwei NACHEINANDER (avesmapsLandschaftDialogSpeichern); vorher stand diese Reihenfolge nur im
 * Abschicken, und wer zuerst FERTIG war, entschied der Zufall.
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

/* ── Speichern: EIN Ablauf, die zwei Haelften NACHEINANDER ─────────────────────────────────────
 *
 * 💣 HIER STAND BIS ZUM 27.09.2026 `formular.requestSubmit()` FUER BEIDE FORMULARE -- zwei Ablaeufe,
 * die GLEICHZEITIG losliefen und einander in die Quere kamen, je nachdem, wer zuerst fertig war:
 *   - die Beschriftung schloss das Fenster und setzte den gemeinsamen Kopf zurueck (Name, Art,
 *     Anzeigehaken), waehrend die Flaeche ihn noch lesen wollte -- die Wiki-Zuweisung der Flaeche kam
 *     nie an („Hochmoor von Waskir", gemeldet 27.09.2026);
 *   - beide schrieben DIESELBE Beschriftung (die Flaeche ueber renameLinkedEcosystemLabel, die
 *     Beschriftung selbst) mit derselben `expected_revision` -- der Zweite bekam 409, und seine
 *     Aenderung war weg, oft in einem schon geschlossenen Fenster;
 *   - beide schrieben die Region (die Flaeche direkt, die Beschriftung ueber ihren Rueckweg
 *     ecosystemPushLabelChangesToRegion) und beide die Geschwister-Beschriftungen.
 * Jetzt gibt es EINEN Ablauf: erst liest jede Haelfte ihren Stand (synchron, im Augenblick des
 * Klicks -- danach darf sich das Formular aendern, wie es will), dann schreibt die Flaeche, dann die
 * Beschriftung, dann geht das Fenster EINMAL zu. Was eine Haelfte der anderen abnimmt, schreibt sie
 * im Verbund nicht doppelt (siehe `verbund` in beiden Auftraegen).
 *
 * 🔴 BEIDE submit-ZUHOERER LAUFEN HIERHER, solange es dieses Fenster gibt -- auch Enter in einem
 * Feld. Vorher speicherte Enter im Namensfeld NUR die Beschriftung (das Feld gehoert per `form=` ihr),
 * und eine offene Wiki-Zuweisung der Flaeche ging mit dem Schliessen verloren.
 *
 * ⚠️ Ein zweiter Klick waehrend des Laufs bekommt DIESELBE Zusage, keinen zweiten Lauf; die Knoepfe
 * der Leiste sind so lange gesperrt.
 */
let avesmapsLandschaftDialogLaufendesSpeichern = null;

const AVESMAPS_LANDSCHAFT_DIALOG_SPERRKNOEPFE = [
	"landschaft-dialog-save", "landschaft-dialog-cancel", "landschaft-dialog-delete", "landschaft-dialog-close",
];

/** Die gemeinsame Statuszeile -- sie steht unter allen drei Reitern, also sieht man sie immer. */
function avesmapsLandschaftDialogMeldung(text, art) {
	if (typeof document === "undefined") {
		return;
	}
	const zeile = document.getElementById("landschaft-dialog-status");
	if (!zeile) {
		return;
	}
	zeile.textContent = String(text || "");
	if (art) {
		zeile.dataset.status = art;
	} else {
		delete zeile.dataset.status;
	}
}

function avesmapsLandschaftDialogKnoepfeSperren(gesperrt, nur) {
	(Array.isArray(nur) ? nur : AVESMAPS_LANDSCHAFT_DIALOG_SPERRKNOEPFE).forEach((id) => {
		const knopf = document.getElementById(id);
		if (knopf) {
			knopf.disabled = Boolean(gesperrt);
		}
	});
}

/**
 * Die Auftraege der geladenen Haelften, in Speicher-Reihenfolge. Jeder ist schon VORBEREITET (sein
 * Stand gelesen, geprueft): `{ haelfte, fehler }` oder `{ haelfte, ausfuehren, abschliessen }`.
 *
 * 💣 BEIDE WERDEN VORBEREITET, BEVOR EINER SCHREIBT. Ist die Beschriftung ungueltig (leerer Name),
 * darf die Flaeche nicht schon gespeichert sein -- sonst stuende ein halbes Speichern da.
 * ⚠️ Fehlt die Vorbereitung einer geladenen Haelfte (ihr Skript ist nicht da), ist das ein Fehler,
 * kein stilles Weglassen -- ein Knopf, der die Haelfte uebergeht, sieht aus wie ein gelungenes Speichern.
 */
function avesmapsLandschaftDialogAuftraegeVorbereiten(stand) {
	const verbund = Boolean(stand.hatFlaeche && stand.hatLabel);
	return avesmapsLandschaftDialogSpeichernAuftraege(stand).map((id) => {
		if (id === "ecosystem-properties-form") {
			const vorbereiten = typeof window !== "undefined"
				&& window.AvesmapsEcosystemProperties
				&& typeof window.AvesmapsEcosystemProperties.speicherAuftrag === "function"
				? window.AvesmapsEcosystemProperties.speicherAuftrag
				: null;
			return Object.assign({ haelfte: "flaeche" }, vorbereiten
				? vorbereiten({ verbund })
				: { fehler: "Die Fläche kann hier nicht gespeichert werden (Modul fehlt)." });
		}
		const vorbereiten = typeof avesmapsBeschriftungSpeicherAuftrag === "function"
			? avesmapsBeschriftungSpeicherAuftrag
			: null;
		return Object.assign({ haelfte: "beschriftung" }, vorbereiten
			? vorbereiten({ formElement: document.getElementById(id), verbund })
			: { fehler: "Die Beschriftung kann hier nicht gespeichert werden (Modul fehlt)." });
	});
}

const AVESMAPS_LANDSCHAFT_DIALOG_HAELFTE_NAME = { flaeche: "Fläche", beschriftung: "Beschriftung" };

/** Speichern: beide Haelften, nacheinander, Flaeche zuerst. Gibt eine Zusage zurueck. */
function avesmapsLandschaftDialogSpeichern() {
	if (typeof document === "undefined") {
		return Promise.resolve({ gespeichert: false });
	}
	if (avesmapsLandschaftDialogLaufendesSpeichern) {
		return avesmapsLandschaftDialogLaufendesSpeichern;
	}
	const lauf = (async () => {
		const auftraege = avesmapsLandschaftDialogAuftraegeVorbereiten(avesmapsLandschaftDialogStand());
		if (auftraege.length === 0) {
			return { gespeichert: false };
		}
		const ungueltig = auftraege.find((auftrag) => auftrag.fehler);
		if (ungueltig) {
			// Nichts geschrieben -- das Fenster bleibt offen, und die Zeile sagt, woran es hing.
			avesmapsLandschaftDialogMeldung(
				AVESMAPS_LANDSCHAFT_DIALOG_HAELFTE_NAME[ungueltig.haelfte] + ": " + ungueltig.fehler, "error");
			return { gespeichert: false, fehler: ungueltig.fehler };
		}
		avesmapsLandschaftDialogKnoepfeSperren(true);
		avesmapsLandschaftDialogMeldung("Wird gespeichert …", "pending");
		const geschrieben = [];
		for (const auftrag of auftraege) {
			try {
				auftrag.ergebnis = await auftrag.ausfuehren();
				geschrieben.push(auftrag);
			} catch (fehler) {
				// 🔴 Die Folgehaelfte laeuft NICHT: sie baute auf einem Stand auf, den es nicht gibt. Das
				// Fenster bleibt offen, und die Zeile sagt, was schon steht -- ein erneutes Speichern
				// schreibt die gespeicherte Haelfte mit denselben Werten noch einmal, und das ist harmlos.
				const text = String(fehler?.message || "Speichern fehlgeschlagen.");
				const schon = geschrieben.map((g) => AVESMAPS_LANDSCHAFT_DIALOG_HAELFTE_NAME[g.haelfte]);
				avesmapsLandschaftDialogMeldung(
					(schon.length ? schon.join(" und ") + " gespeichert — " : "")
					+ AVESMAPS_LANDSCHAFT_DIALOG_HAELFTE_NAME[auftrag.haelfte] + " nicht: " + text, "error");
				if (typeof auftrag.fehlgeschlagen === "function") {
					auftrag.fehlgeschlagen(fehler);
				}
				return { gespeichert: false, fehler: text };
			}
		}
		// 🔴 DANN DIE NACHLÄUFE -- das Höhenraster eines Gebirges (bis zu fünf Minuten im Worker). Was der
		// Editor gemeint hat, steht jetzt schon (Region samt Wiki-Zuweisung, Gelände, Beschriftung); das
		// Raster darf deshalb nichts mehr davon aufhalten. Bis zum 27.09.2026 lief es VOR der Region, und
		// wer am Finsterkamm nicht wartete, verlor die Zuweisung.
		// ⚠️ Abbrechen und × sind währenddessen wieder frei: wer nicht warten will, schliesst -- das bricht
		// nur das Raster ab, und die Meldung am Ende sagt, dass es fehlt.
		const nachlaeufe = auftraege.filter((auftrag) => typeof auftrag.nachlauf === "function");
		if (nachlaeufe.length > 0) {
			avesmapsLandschaftDialogMeldung("Gespeichert — Höhenfeld wird berechnet und hochgeladen …", "pending");
			avesmapsLandschaftDialogKnoepfeSperren(false);
			avesmapsLandschaftDialogKnoepfeSperren(true, ["landschaft-dialog-save", "landschaft-dialog-delete"]);
			for (const auftrag of nachlaeufe) {
				try {
					await auftrag.nachlauf();
				} catch (fehler) {
					// Ein Nachlauf wirft nicht -- falls doch, ist gespeichert, was gespeichert ist.
					console.error("Nachlauf des Speicherns fehlgeschlagen:", fehler);
				}
			}
		}
		// 🔴 EINMAL schliessen, erst wenn ALLES steht -- die Beschriftung zuerst (sie nimmt beim Schliessen
		// ihre Sofortvorschau zurueck, die jetzt gespeichert ist), die Flaeche danach (sie laedt die
		// Flaechen neu, und das darf erst nach dem Schliessen passieren: ein offenes Fenster schuetzt
		// seine Flaeche vor frischen Serverwerten).
		avesmapsLandschaftDialogMeldung("");
		const leise = auftraege.length > 1;
		for (const auftrag of auftraege.slice().reverse()) {
			await auftrag.abschliessen({ leise });
		}
		if (leise && typeof showFeedbackToast === "function") {
			const name = auftraege.map((a) => a.name).find((n) => String(n || "") !== "") || "";
			showFeedbackToast(name ? "„" + name + "“ gespeichert." : "Gespeichert.", "success");
		}
		return { gespeichert: true };
	})().finally(() => {
		avesmapsLandschaftDialogLaufendesSpeichern = null;
		avesmapsLandschaftDialogKnoepfeSperren(false);
	});
	avesmapsLandschaftDialogLaufendesSpeichern = lauf;
	return lauf;
}

/**
 * Soll ein submit-Zuhoerer an den Ablauf abgeben? Ja, sobald es das vereinigte Fenster gibt --
 * dann ist JEDES Speichern ein Speichern beider Haelften.
 * ⚠️ Ohne das Fenster (eine Pruefseite, ein Test mit nur einem Modul) speichert jede Haelfte allein.
 */
function avesmapsLandschaftDialogUebernimmtSpeichern() {
	return typeof document !== "undefined" && Boolean(document.getElementById("landschaft-dialog-overlay"));
}

/* ── Der gemeinsame Kopf: was hat der EDITOR angefasst? ─────────────────────────────────────────
 *
 * 💣 ZWEI OEFFNER SCHREIBEN IN DENSELBEN KOPF, und der zweite kommt ASYNCHRON: wer eine Beschriftung
 * anklickt, bekommt ihre Flaeche erst nach einer Suche (avesmapsEcosystemAreaPublicIdOfLabel) --
 * dazwischen steht das Fenster offen und bedienbar. Wer in dieser Luecke den Namen tippte oder die Art
 * waehlte, verlor beides, sobald die Flaeche ankam und ihren Stand in den Kopf schrieb.
 * 🔴 Die Regel: ein Oeffner ueberschreibt nie, was der Editor seit dem Oeffnen angefasst hat.
 * Programmatische Schreiber loesen weder `input` noch `change` aus -- nur ein Mensch tut das, und
 * genau daran wird es erkannt, ohne einen zweiten Zustand neben dem Feld.
 */
const AVESMAPS_LANDSCHAFT_KOPF_FELDER = [
	"label-edit-text", "label-edit-type", "ecosystem-properties-showname", "label-edit-is-nodix",
];
let avesmapsLandschaftKopfBeruehrt = new Set();

/** Ein neues Oeffnen beginnt unberuehrt. Rufen nur die EINSTIEGE, nie ein Gegenpart. */
function avesmapsLandschaftDialogKopfNeu() {
	avesmapsLandschaftKopfBeruehrt = new Set();
}

/**
 * Den Stand der angefassten Kopffelder festhalten -- VOR dem Schreiben eines Oeffners.
 * @returns {Object} je angefasstem Feld `{ value, checked }`
 */
function avesmapsLandschaftDialogKopfMerken() {
	const merk = {};
	if (typeof document === "undefined") {
		return merk;
	}
	avesmapsLandschaftKopfBeruehrt.forEach((id) => {
		const feld = document.getElementById(id);
		if (feld) {
			merk[id] = { value: feld.value, checked: feld.checked };
		}
	});
	return merk;
}

/**
 * Das Festgehaltene zurueckschreiben -- NACH dem Schreiben eines Oeffners.
 * ⚠️ Eine Auswahl nur, wenn es den Wert dort (noch) gibt: ein anderes Vokabular kann ihn nicht kennen,
 * und ein gesetzter, aber fehlender Wert liesse das Feld leer stehen.
 * @param {Object} merk aus avesmapsLandschaftDialogKopfMerken
 * @param {Function} [uebersetzen] (id, wert) -> wert, fuer ein Vokabular mit anderem Leerwert
 */
function avesmapsLandschaftDialogKopfZurueck(merk, uebersetzen) {
	if (typeof document === "undefined" || !merk) {
		return;
	}
	Object.keys(merk).forEach((id) => {
		const feld = document.getElementById(id);
		if (!feld) {
			return;
		}
		if (feld.type === "checkbox") {
			feld.checked = Boolean(merk[id].checked);
			return;
		}
		const wert = typeof uebersetzen === "function" ? uebersetzen(id, merk[id].value) : merk[id].value;
		if (feld.tagName === "SELECT" && !Array.from(feld.options || []).some((option) => option.value === wert)) {
			return;
		}
		feld.value = wert;
	});
}

function avesmapsLandschaftDialogKopfVerdrahten() {
	AVESMAPS_LANDSCHAFT_KOPF_FELDER.forEach((id) => {
		const feld = document.getElementById(id);
		if (!feld || feld.dataset.landschaftKopf === "1") {
			return;
		}
		feld.dataset.landschaftKopf = "1";
		const merke = () => avesmapsLandschaftKopfBeruehrt.add(id);
		feld.addEventListener("input", merke);
		feld.addEventListener("change", merke);
	});
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
		avesmapsLandschaftDialogQuellenKasten: avesmapsLandschaftDialogQuellenKasten,
		avesmapsLandschaftDialogTitel: avesmapsLandschaftDialogTitel,
		avesmapsLandschaftDialogAnlegenSperre: avesmapsLandschaftDialogAnlegenSperre,
		avesmapsLandschaftDialogAutoNameEntfernt: avesmapsLandschaftDialogAutoNameEntfernt,
		avesmapsLandschaftDialogAutoNameWarnung: avesmapsLandschaftDialogAutoNameWarnung,
		avesmapsLandschaftDialogAnlegenKnopf: avesmapsLandschaftDialogAnlegenKnopf,
		avesmapsLandschaftDialogSpeichernAuftraege: avesmapsLandschaftDialogSpeichernAuftraege,
		avesmapsLandschaftDialogSpeichern: avesmapsLandschaftDialogSpeichern,
		avesmapsLandschaftDialogAuftraegeVorbereiten: avesmapsLandschaftDialogAuftraegeVorbereiten,
		avesmapsLandschaftDialogUebernimmtSpeichern: avesmapsLandschaftDialogUebernimmtSpeichern,
		avesmapsLandschaftDialogKopfNeu: avesmapsLandschaftDialogKopfNeu,
		avesmapsLandschaftDialogKopfMerken: avesmapsLandschaftDialogKopfMerken,
		avesmapsLandschaftDialogKopfZurueck: avesmapsLandschaftDialogKopfZurueck,
		AVESMAPS_LANDSCHAFT_KOPF_FELDER: AVESMAPS_LANDSCHAFT_KOPF_FELDER,
		avesmapsLandschaftDialogLoeschText: avesmapsLandschaftDialogLoeschText,
		avesmapsLandschaftDialogLoeschKnopf: avesmapsLandschaftDialogLoeschKnopf,
		avesmapsLandschaftDialogLeertext: avesmapsLandschaftDialogLeertext,
		avesmapsLandschaftDialogLagen: avesmapsLandschaftDialogLagen,
	};
}
