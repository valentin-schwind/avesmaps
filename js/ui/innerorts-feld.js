// Das Feld "Innerorts" -- EIN Bauteil fuer beide Editoren (Entwurf
// docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §5, Mockup
// docs/innerorts-mockup.html Szenen 1-2, Plan docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md
// Task 3).
//
// Dieses Bauteil zeigt/aendert NUR die Stadt-Zuordnung eines Punktes (gebaeude/stadtviertel) --
// den Wert-Kasten "Gareth · ⇄ · ✕" bzw. das Suchfeld, wenn (noch) keine Stadt gesetzt ist oder der
// Editor eine andere waehlen will. Der Wiki-Override an der BESCHRIFTUNG (braun, wenn wir den Wert
// gesetzt haben; durchgestrichener Wiki-Stand + ↺, wenn er abweicht) ist bereits geteiltes Muster
// (css/components/wiki-override.css, "Bauform 1" -- Ortseditor, links -- und "Bauform 2" --
// Kartendialog, oben) und wird hier NICHT nachgebaut; dieses Bauteil liefert dafuer nur die reine
// Vergleichsrechnung (avesmapsInnerortsFeldStand) und die fertige Markup-Zeile
// (avesmapsInnerortsAltMarkup), die beide Aufrufer rufen -- keine zweite Abschrift der Regel.
//
// 🔴 DIE HERKUNFT ('manual'/'wiki') GEHOERT NICHT ZUM ZUSTAND DIESES BAUTEILS. Es kennt nur "die
// Stadt oder keine". Jede Aenderung durch den Menschen (Auswahl aus der Suche, ✕) IST ein manuelles
// Override -- der Aufrufer setzt daraus die Herkunft und traegt sie beim Speichern in
// `innerorts_ort` ein. `setzeOrt()` (von aussen, nach ↺ an der Beschriftung) setzt still, OHNE
// `onChange` zu feuern: der Aufrufer hat die Aenderung selbst ausgeloest und kennt die Folge
// bereits -- eine Rueckkopplung wuerde dieselbe Herkunft doppelt verwalten.
//
// ⭐ DIE ORTSSUCHE TEILT SICH MIT DEM KASTEN "STAETTEN" (js/ui/staetten-kasten.js): derselbe
// Endpunkt (`action: "orte"`), derselbe Trefferlisten-Bauer (staettenKastenTrefferListeHtml) und
// dieselbe Ortsklassen-Beschriftung (staettenKastenOrtsklassenLabel) -- wiederverwendet, nicht
// abgeschrieben. staetten-kasten.js muss deshalb VOR dieser Datei geladen sein (index.html,
// html/wiki-sync-settlement-editor.html); ohne sie faellt die Suche auf eine einfache Liste ohne
// Ortsklassen-Spalte zurueck (kein Fatal -- ein Editorfenster ohne Ortssuche ist besser als ein
// Fenster, das gar nicht aufgeht).
//
// Root-absolut: das Bauteil haengt auch im Ortseditor-iframe (html/wiki-sync-settlement-editor.html),
// wo ein relativer Pfad unter html/ aufgeloest wuerde -- derselbe Grund wie bei
// STAETTEN_KASTEN_API_URL/SOURCE_AUTOCOMPLETE_API_URL.
const INNERORTS_FELD_API_URL = "/api/edit/map/settlement-places.php";

// I2: die EINZIGE Maskierung, die dieses Bauteil benutzt -- vollstaendig (& < > " '), weil sie auch
// in Attributen landet (title, data-*), nicht nur in Textknoten. Dieselbe Rezeptur wie
// staettenKastenDefaultEscape/sourceAutocompleteDefaultEscape -- eine eigene Kopie, weil ein
// Bauteil, das in Attribute schreibt, seine Sicherheit nicht vom Wirt leiht.
function innerortsFeldDefaultEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// Uebersetzung: opts.tr, sonst ein globales tr/window.tr (falls die Seite eine i18n-Schicht hat),
// sonst der deutsche Fallback-Text. Schluessel tragen das Praefix "innerorts." (dieselbe Regel wie
// bei den "staetten."-Schluesseln des Nachbarn).
function innerortsFeldTr(options, key, fallback) {
	if (options && typeof options.tr === "function") {
		return options.tr(key, fallback);
	}
	if (typeof window !== "undefined" && typeof window.tr === "function") {
		return window.tr(key, fallback);
	}
	if (typeof tr === "function") {
		return tr(key, fallback);
	}
	return fallback;
}

/**
 * REIN: was die Beschriftung ueber ihr Verhaeltnis zum Wiki-Stand zu sagen hat -- dieselbe Regel
 * wie avesmapsWikiFeldStand (js/ui/wiki-feld-herkunft.js), hier fuer EIN Feld mit
 * {public_id,name}-Werten statt Zeichenketten: verglichen wird die public_id, angezeigt der Name.
 *
 * ⚠️ Ein LEERER Wiki-Wert (keine Stadt im Wiki bekannt) ist KEINE Abweichung -- wortgleich zur
 * allgemeinen Regel: das ↺ wuerde sonst anbieten, eine Angabe zu loeschen, die es nirgends gibt.
 *
 * @param {{public_id:string,name:string}|null} wikiStand
 * @param {{public_id:string,name:string}|null} ort  der gespeicherte/aktuelle Wert
 * @param {string} herkunft  "manual"|"wiki"|"" -- alles andere gilt als unbekannt
 * @returns {{wikiName:string, abweicht:boolean, vonUns:boolean}}
 */
function avesmapsInnerortsFeldStand(wikiStand, ort, herkunft) {
	const wikiId = wikiStand ? String(wikiStand.public_id || "").trim() : "";
	const wikiName = wikiStand ? String(wikiStand.name || "").trim() : "";
	const ortId = ort ? String(ort.public_id || "").trim() : "";
	const woher = herkunft === "manual" || herkunft === "wiki" ? herkunft : "";
	return {
		wikiName: wikiName,
		abweicht: wikiId !== "" && ortId !== wikiId,
		vonUns: woher === "manual",
	};
}

/**
 * REIN: die Beschriftungszeile eines Wiki-Override -- durchgestrichener Wiki-Stand + ↺, oder "",
 * wenn nichts abweicht. Der Knopf traegt `data-innerorts-reset` (nie `data-wiki-reset` -- das
 * generische Zeichnen der fuenf Kartenfelder in review-locations.js liest genau dieses Attribut
 * und wuerde unsere Zeile sonst bei jedem Tastendruck in einem ANDEREN Feld leerraeumen, siehe
 * settlementWikiZeichneAbweichungen).
 */
function avesmapsInnerortsAltMarkup(stand, opts) {
	const options = opts || {};
	const escape = options.escape || innerortsFeldDefaultEscape;
	const tr = (k, f) => innerortsFeldTr(options, k, f);
	if (!stand || !stand.abweicht) {
		return "";
	}
	const titel = (stand.vonUns
		? tr("innerorts.override.title", "Von uns gesetzt. ")
		: tr("innerorts.diff.title", "Weicht vom Wiki ab. "))
		+ tr("innerorts.wikistand.title", "Wiki-Stand: ") + stand.wikiName;
	return '<span class="wiki-alt"><span class="dt-old" title="' + escape(titel) + '">'
		+ escape(stand.wikiName) + "</span>"
		+ '<button type="button" class="dt-reset" data-innerorts-reset title="'
		+ escape(tr("innerorts.reset.title", "Auf Wiki-Stand zurücksetzen")) + '">↺</button></span>';
}

/**
 * REIN: das Innere von `.innerorts-feld` -- gewaehlter Wert (Name + ⇄ + ✕) oder Suchfeld.
 * state = { ort: {public_id,name}|null, suche: boolean }.
 */
function innerortsFeldWertHtml(state, opts) {
	const options = opts || {};
	const escape = options.escape || innerortsFeldDefaultEscape;
	const tr = (k, f) => innerortsFeldTr(options, k, f);
	const s = state || {};
	const ort = s.ort || null;

	if (ort && !s.suche) {
		return (
			'<div class="innerorts-feld__gewaehlt">'
			+ "<span><b>" + escape(ort.name) + "</b></span>"
			+ '<button type="button" class="fs-row__edit" data-io-aendern aria-label="'
			+ escape(tr("innerorts.change", "Stadt ändern")) + '" title="'
			+ escape(tr("innerorts.change.title", "Andere Stadt")) + '">⇄</button>'
			+ '<button type="button" class="fs-row__remove" data-io-loesen aria-label="'
			+ escape(tr("innerorts.clear", "Zugehörigkeit lösen")) + '" title="'
			+ escape(tr("innerorts.clear.title", "Gehört zu keinem Ort")) + '">✕</button>'
			+ "</div>"
		);
	}

	// Ein "Abbrechen" gibt es nur, wenn ⇄ eine vorhandene Auswahl unterbricht -- beim allerersten
	// Zuweisen (ort === null) gibt es nichts, wohin man zurueckkehren koennte.
	const abbrechen = ort
		? '<button type="button" class="innerorts-feld__abbrechen" data-io-abbrechen>'
			+ escape(tr("innerorts.cancel", "Abbrechen")) + "</button>"
		: "";
	return (
		'<div class="innerorts-feld__suche">'
		+ '<input type="search" class="innerorts-feld__input" data-io-input autocomplete="off" placeholder="'
		+ escape(tr("innerorts.search.placeholder", "Stadt suchen …")) + '" />'
		+ abbrechen
		+ "</div>"
	);
}

/** REIN: die ganze `.innerorts-feld`-Huelle (Vertrag, siehe css/components/staetten-kasten.css). */
function innerortsFeldHtml(state, opts) {
	return '<div class="innerorts-feld">' + innerortsFeldWertHtml(state, opts) + "</div>";
}

async function innerortsFeldPost(fetchImpl, body, signal) {
	const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
	if (!f) {
		throw new Error("kein fetch verfügbar");
	}
	const antwort = await f(INNERORTS_FELD_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: signal,
	});
	return await antwort.json();
}

/** Dieselbe Ortssuche wie der Kasten "Staetten" (staettenKastenSuche) -- eigene, kleine Kopie
 *  (ein Fetch-Aufruf), damit diese Datei staetten-kasten.js nicht fuer eine Zeile importieren muss;
 *  wiederverwendet wird die TREFFERLISTE (staettenKastenTrefferListeHtml), nicht der Fetch. */
async function innerortsFeldSuche(fetchImpl, term, signal) {
	const daten = await innerortsFeldPost(fetchImpl, { action: "orte", q: term }, signal);
	return daten && daten.ok === true && Array.isArray(daten.orte) ? daten.orte : [];
}

/**
 * Montiert das Wert-Feld in `host` (ein leeres Element, direkt neben/unter der Beschriftung
 * "Innerorts" -- die Beschriftung samt Wiki-Override zeichnet der Aufrufer, siehe Kopf der Datei).
 *
 * opts: { ort: {public_id,name}|null, escape?, tr?, fetchImpl?, attachTypeaheadImpl?, suche?,
 *   renderHtml?, itemId?, onChange?({ort}) }
 *
 * `onChange` feuert NUR bei einer echten Nutzerhandlung (Auswahl aus der Suche, ✕) -- nicht bei
 * `setzeOrt()`, siehe Kopf der Datei.
 *
 * @returns {{ wert(): {ort:{public_id,name}|null}, setzeOrt(ort): void, zerstoeren(): void }}
 */
function mountInnerortsFeld(host, opts) {
	if (!host) {
		return { wert: () => ({ ort: null }), setzeOrt() {}, zerstoeren() {} };
	}
	const options = opts || {};
	const escape = options.escape || innerortsFeldDefaultEscape;
	const trFn = (k, f) => innerortsFeldTr(options, k, f);
	const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
	const attachFn = options.attachTypeaheadImpl
		|| (typeof attachTypeahead === "function" ? attachTypeahead : null);

	// Wiedermontage: eine vorige Montage auf demselben Host wird zuerst geloest (dasselbe Muster
	// wie host.__staettenAbbau in staetten-kasten.js).
	if (typeof host.__innerortsAbbau === "function") {
		host.__innerortsAbbau();
		host.__innerortsAbbau = null;
	}

	const state = {
		ort: options.ort || null,
		suche: false,
	};
	let abgebaut = false;
	let detachTypeahead = null;

	function detachAlleZuhoerer() {
		if (detachTypeahead) {
			detachTypeahead();
			detachTypeahead = null;
		}
	}

	function verdrahteSuche() {
		// Die Suche steht auf dem Bildschirm, sobald es (noch) keine Auswahl gibt ODER ⇄ sie gerade
		// unterbricht -- dieselbe Bedingung wie in innerortsFeldWertHtml (state.ort && !state.suche
		// ist der einzige Zustand OHNE Suchfeld).
		if ((state.ort && !state.suche) || !attachFn) {
			return;
		}
		const eingabe = host.querySelector(".innerorts-feld__input");
		if (!eingabe) {
			return;
		}
		detachTypeahead = attachFn(eingabe, {
			minChars: 2,
			escape: escape,
			tr: trFn,
			renderHtml: options.renderHtml
				|| (typeof staettenKastenTrefferListeHtml === "function" ? staettenKastenTrefferListeHtml : undefined),
			itemId: options.itemId
				|| (typeof staettenKastenTrefferId === "function"
					? staettenKastenTrefferId
					: (item, index) => "io-treffer-" + index),
			search(term, signal) {
				return typeof options.suche === "function"
					? options.suche(term, signal)
					: innerortsFeldSuche(fetchImpl, term, signal);
			},
			onPick(item) {
				state.ort = { public_id: String(item.public_id || ""), name: String(item.name || "") };
				state.suche = false;
				render();
				if (typeof options.onChange === "function") {
					options.onChange({ ort: state.ort });
				}
			},
		});
	}

	function render() {
		if (abgebaut) {
			return; // eine spaetere Antwort/Wiedermontage hat diese Montage schon abgebaut
		}
		detachAlleZuhoerer();
		host.innerHTML = innerortsFeldHtml(state, { escape: escape, tr: trFn });
		verdrahteSuche();
	}

	host.addEventListener("click", (ereignis) => {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") {
			return;
		}
		if (ziel.closest("[data-io-aendern]")) {
			ereignis.preventDefault();
			state.suche = true;
			render();
			return;
		}
		if (ziel.closest("[data-io-loesen]")) {
			ereignis.preventDefault();
			state.ort = null;
			state.suche = false;
			render();
			if (typeof options.onChange === "function") {
				options.onChange({ ort: null });
			}
			return;
		}
		if (ziel.closest("[data-io-abbrechen]")) {
			ereignis.preventDefault();
			state.suche = false;
			render();
		}
	});

	render();

	host.__innerortsAbbau = function () {
		abgebaut = true;
		detachAlleZuhoerer();
	};

	return {
		wert() {
			return { ort: state.ort };
		},
		// Von aussen setzen (↺ an der Beschriftung) -- OHNE onChange, siehe Kopf der Datei.
		setzeOrt(ort) {
			state.ort = ort || null;
			state.suche = false;
			render();
		},
		zerstoeren() {
			if (typeof host.__innerortsAbbau === "function") {
				host.__innerortsAbbau();
				host.__innerortsAbbau = null;
			}
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsInnerortsFeldStand: avesmapsInnerortsFeldStand,
		avesmapsInnerortsAltMarkup: avesmapsInnerortsAltMarkup,
		innerortsFeldWertHtml: innerortsFeldWertHtml,
		innerortsFeldHtml: innerortsFeldHtml,
		innerortsFeldSuche: innerortsFeldSuche,
		mountInnerortsFeld: mountInnerortsFeld,
	};
}
