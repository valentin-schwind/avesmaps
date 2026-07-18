// Kartensammlung: "Karte vorschlagen" — der Community-Vorschlag (Spec §3.8).
//
// EIGENER Dialog, nicht "Änderung vorschlagen" (Owner-Vorgabe): das Meldeformular in der index.html ist auf
// Orte zugeschnitten (Ortsgröße, Position, Wiki-Link), eine Karte hat davon kein einziges Feld. Konzeptionell
// folgt es aber openChangeSuggestionDialog (js/review/review-locations.js:275) und teilt sich dessen
// Transport: derselbe Endpoint, derselbe Honeypot, dasselbe elapsed_ms, dasselbe Rate-Limit.
//
// LIZENZFELDER GIBT ES HIER NICHT (Owner-Entscheidung 2026-07-16). Das ist kein vergessenes Feld:
// thumb_url IST gegated (avesmapsCitymapPublicThumbUrl) und Uploads brauchen Capability `edit` — ein
// externes Vorschaubild ist damit die einzige Bildfläche, die ein Fremder überhaupt anfassen kann. Dürfte er
// die Lizenz dazu behaupten, würde ein "CC0" auf einer Verlagsvorschau uns dazu bringen, sie zu hotlinken.
// Das Gate glaubt der SPALTE, nicht dem Absender: der Server nimmt gar keine Lizenz an
// (avesmapsNormalizeCitymapReportPayload), die Spalte bleibt auf ihrem DEFAULT 'unknown_other', und ein
// Prüfer klassifiziert sie im Editor. Ein vorgeschlagenes Vorschaubild ist deshalb gespeichert, aber
// unsichtbar — bis ein Mensch die Lizenz beurteilt hat. Wer eine Lizenz WIRKLICH kennt ("ist meine eigene
// Karte, CC0"), schreibt das in "Notiz", wo es sich liest wie das, was es ist: eine Aussage an einen Menschen.
//
// QUELLE, genau eine: §3.1 macht "Titel und Quelle" zur Pflicht (Singular) — eine Karte stammt aus einer
// Publikation. Die Mehrquellen-Liste des Ortsformulars (Multi-Source #3) existiert, weil eine SIEDLUNG über
// viele Bände verstreut beschrieben wird; sie hier nachzubauen hieße, ~80 Zeilen Listen-UI zu duplizieren,
// damit das Community-Formular mehr kann als der Karten-Editor (der gar keine Quellen-UI hat). Der Draht ist
// trotzdem identisch: `sources` reist als Array mit genau einem Eintrag.

(function initCitymapSuggestDialog() {
	// Node (Unit-Tests): hier gibt es nichts zu binden. Gleicher Riegel wie map-features-citymaps-dialog.js.
	if (typeof window === "undefined" || typeof document === "undefined") {
		return;
	}
	if (typeof window.__avesmapsCitymapSuggestBound !== "undefined") {
		return;
	}
	window.__avesmapsCitymapSuggestBound = true;
	if (typeof $ === "undefined") {
		return;
	}

	function esc(value) {
		return typeof escapeHtml === "function" ? escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
	}
	function t(key, fallback, vars) {
		return typeof tr === "function" ? tr(key, fallback, vars) : fallback;
	}

	// Spiegel der EINEN serverseitigen Definition (api/_internal/app/citymaps.php) — Slugs sind
	// Domäneninhalt und müssen Byte für Byte passen, die Labels sind deutsche UI. Identisch zum
	// Karten-Editor (html/citymap-editor.html:397), aus demselben Grund: ohne Extra-Endpoint gibt es keinen
	// Weg, das eine zur Laufzeit aus dem anderen abzuleiten.
	var TYPE_KEYS = [
		["ortsplan", "Ortsplan"], ["stadtplan", "Stadtplan"], ["bezirk", "Bezirk"], ["viertel", "Viertel"],
		["lageplan", "Lageplan"], ["uebersicht", "Übersicht"], ["schauplatz", "Schauplatz"], ["grundriss", "Grundriss"],
		["befestigungen", "Befestigungen"], ["dungeon", "Dungeon"], ["hoehlen", "Höhlen"], ["krypten", "Krypten"],
		["katakomben", "Katakomben"], ["schatzkarte", "Schatzkarte"], ["region", "Region"], ["sonstige", "Sonstige"],
	];
	var ARTS = [["politisch", "Politisch"], ["derographisch", "Derographisch"], ["topologisch", "Topologisch"], ["skizze", "Skizze"]];
	var SOURCE_TYPES = [
		["regionalspielhilfe", "Regionalspielhilfe"], ["abenteuer", "Abenteuer"], ["aventurischer_bote", "Aventurischer Bote"],
		["quellenband", "Quellenband"], ["roman", "Roman"], ["briefspiel", "Briefspiel"], ["regelbuch", "Regelbuch"],
		["sonstiges", "Sonstiges"],
	];
	// Die drei Eigenschafts-Antworten. "" = unbekannt und ist die VORAUSWAHL: §3.1 sagt, unbekannt ist eine
	// gültige Antwort, keine Lücke — und ein Melder, der "mehrstöckig" nicht beurteilen kann, soll nichts
	// behaupten müssen. Ein Default "nein" würde genau die erfundenen Fakten erzeugen, die §3.1 verbietet.
	var TRI = [["", "unbekannt"], ["1", "ja"], ["0", "nein"]];
	var PROPS = [
		["is_color", "farbig"], ["is_multilevel", "mehrstöckig"], ["is_labeled", "beschriftet (Legende)"],
		["is_official", "offiziell"], ["is_spoiler", "Spoiler (Spielinhalte)"],
		// "kostenpflichtig" darf der Melder mitschicken -- anders als eine Lizenz schaltet es nichts frei,
		// es ist eine schlichte Beobachtung ("das kostet was"), die er beim Blick auf die Shop-Seite hat.
		["is_paid", "kostenpflichtig"],
	];

	// placeholder ist ein eigenes Argument, nicht Teil von `extra` (Owner 2026-07-17: "in den ganzen
	// Platzhalter Beispiele"). Als Pflichtstelle in der Signatur, damit ein neues Feld ohne Beispiel
	// auffaellt statt still zu entstehen. Die Beispiele sind ECHT: "Hannah Möllmann" hat die Gareth-Karte
	// wirklich gezeichnet -- ein erfundenes Beispiel lehrt den Melder das falsche Format.
	function fieldMarkup(id, label, type, maxLength, placeholder, extra) {
		return '<label class="citymap-suggest__field"><span>' + esc(label) + '</span>'
			+ '<input id="' + esc(id) + '" type="' + esc(type || "text") + '"'
			+ (maxLength ? ' maxlength="' + esc(maxLength) + '"' : "")
			+ (placeholder ? ' placeholder="' + esc(placeholder) + '"' : "")
			+ (extra || "") + ' /></label>';
	}

	// Eine eingeklappte Gruppe (Owner 2026-07-17): das Eingeklapptsein IST die Aussage "das ist optional" --
	// deutlicher als jedes "(optional)" hinter jedem Label. <details> statt selbstgebauter Umschalter: es
	// klappt ohne JS auf, ist per Tastatur bedienbar und der Screenreader kennt es.
	//
	// WICHTIG: kein Pflichtfeld darf hier hinein. Die eigene Pruefung in submitSuggestion fokussiert das
	// erste fehlende Pflichtfeld -- in einer zugeklappten Gruppe liefe das ins Leere und der Melder saehe
	// eine Fehlermeldung ohne Feld dazu. Alle drei Pflichtfelder stehen deshalb oben, offen.
	function detailsGroup(title, why, content) {
		return '<details class="citymap-suggest__group citymap-suggest__group--fold">'
			+ '<summary class="citymap-suggest__summary">' + esc(title)
			+ ' <span class="citymap-suggest__optional">' + esc(t("cityMaps.suggestOptional", "optional")) + '</span></summary>'
			+ '<p class="citymap-suggest__why">' + esc(why) + '</p>'
			+ content + '</details>';
	}
	// selected: ohne Angabe gewinnt die erste Option. Fuer Art und die Eigenschaften ist das genau richtig
	// (dort steht "unbekannt" vorn); die Quellenart braucht es explizit, sonst stuende dort geraten
	// "Regionalspielhilfe" -- eine Vermutung, die der Melder womoeglich nicht korrigiert.
	function selectMarkup(id, label, options, selected) {
		return '<label class="citymap-suggest__field"><span>' + esc(label) + '</span><select id="' + esc(id) + '">'
			+ options.map(function (o) {
				return '<option value="' + esc(o[0]) + '"' + (o[0] === selected ? " selected" : "") + '>' + esc(o[1]) + '</option>';
			}).join("")
			+ '</select></label>';
	}

	function ensureDialog() {
		var overlay = document.getElementById("avesmaps-citymap-suggest");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-citymap-suggest";
		overlay.className = "avesmaps-adv-dialog citymap-suggest";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true" aria-labelledby="citymap-suggest-title">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title" id="citymap-suggest-title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" data-citymap-suggest-close aria-label="' + esc(t("cityMaps.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<form class="citymap-suggest__body" novalidate>'
			// Das Hinweisfeld (Owner 2026-07-17). Sagt beides ausdruecklich: du musst nicht, aber es hilft.
			// Der letzte Satz ist der wichtige -- er nimmt die Sorge, ein halb ausgefuellter Vorschlag sei
			// wertlos, und genau diese Sorge fuellt sonst Felder mit Geraten. Das Formular macht die Zusage
			// sichtbar wahr: beim Oeffnen stehen genau die drei Pflichtfelder da, alles andere ist zu.
			+ '<p class="citymap-suggest__notice">' + esc(t("cityMaps.suggestNotice",
				"Du musst nicht alles ausfüllen. Pflicht sind nur Titel, Link und Quelle. Alles Weitere ist freiwillig — es erspart uns aber das Nachschlagen, und deine Karte erscheint schneller. Was du offen lässt, tragen wir nach oder lassen es weg.")) + '</p>'

			+ '<div class="citymap-suggest__group"><p class="citymap-suggest__grouptitle">' + esc(t("cityMaps.suggestGroupNeed", "Das brauchen wir")) + '</p>'
			+ '<p class="citymap-suggest__why">' + esc(t("cityMaps.suggestWhyNeed",
				"Ohne diese drei können wir die Karte weder finden noch prüfen.")) + '</p>'
			+ fieldMarkup("citymap-suggest-title-input", t("cityMaps.suggestTitle", "Titel *"), "text", 300,
				t("cityMaps.suggestTitlePh", "Gareth — Gesamtplan"), ' required')
			+ fieldMarkup("citymap-suggest-map-url", t("cityMaps.suggestMapUrl", "Karten-Link (extern) *"), "url", 500,
				t("cityMaps.suggestMapUrlPh", "https://www.ulisses-ebooks.de/de/product/120516/…"), ' inputmode="url" required')
			+ fieldMarkup("citymap-suggest-source-label", t("cityMaps.suggestSourceName", "Quelle *"), "text", 200,
				t("cityMaps.suggestSourcePh", "Herz des Reiches"), ' required')
			// Quelle vs. Urheber (Owner-Verdacht 2026-07-17, berechtigt): die beiden beissen sich, solange
			// nichts den Unterschied sagt. Er steht deshalb AM Pflichtfeld und nicht in einer Fussnote --
			// und der Urheber liegt eingeklappt weit darunter, stoesst also gar nicht mehr damit zusammen.
			+ '<p class="citymap-suggest__hint">' + esc(t("cityMaps.suggestSourceVsAuthor",
				"Wo die Karte erschienen ist — Buch, Bote, Website. Nicht, wer sie gezeichnet hat: das ist der Urheber, unter „Mehr zur Karte“.")) + '</p>'
			+ '</div>'

			+ detailsGroup(t("cityMaps.suggestGroupSourceMore", "Mehr zur Quelle"),
				t("cityMaps.suggestWhySource", "Seite und Link ersparen uns das Blättern."),
				fieldMarkup("citymap-suggest-source-url", t("cityMaps.suggestSourceUrl", "Link zur Quelle (F-Shop / Wiki)"), "url", 500,
					t("cityMaps.suggestSourceUrlPh", "https://www.ulisses-ebooks.de/de/product/…"), ' inputmode="url"')
				+ fieldMarkup("citymap-suggest-source-pages", t("cityMaps.suggestSourcePages", "Seite(n)"), "text", 120,
					t("cityMaps.suggestPagesPh", "S. 42–43"))
				+ selectMarkup("citymap-suggest-source-type", t("cityMaps.suggestSourceType", "Art der Quelle"), SOURCE_TYPES, "sonstiges")
				+ '<label class="citymap-suggest__check"><input id="citymap-suggest-source-official" type="checkbox" /> <span>'
				+ esc(t("cityMaps.suggestSourceOfficial", "offizielle Quelle")) + '</span></label>')

			+ detailsGroup(t("cityMaps.suggestGroupMapMore", "Mehr zur Karte"),
				t("cityMaps.suggestWhyMap", "Je mehr hier steht, desto weniger müssen wir nachschlagen."),
				fieldMarkup("citymap-suggest-thumb-url", t("cityMaps.suggestThumbUrl", "Vorschau-Link (extern)"), "url", 500,
					t("cityMaps.suggestThumbPh", "https://www.ulisses-ebooks.de/images/…"), ' inputmode="url"')
				+ fieldMarkup("citymap-suggest-author", t("cityMaps.suggestAuthor", "Urheber"), "text", 300,
					t("cityMaps.suggestAuthorPh", "Hannah Möllmann"))
				+ fieldMarkup("citymap-suggest-note", t("cityMaps.suggestNote", "Notiz"), "text", 2000,
					t("cityMaps.suggestNotePh", "Beilage der Box, unbeschriftete Variante dabei"))
				// Der einzige Ort, an dem eine Lizenz-Kenntnis landen kann — als Prosa an einen Menschen,
				// nicht als Formularfeld, das aussieht, als setze es eine Spalte.
				+ '<p class="citymap-suggest__hint">' + esc(t("cityMaps.suggestLicenceHint",
					"Ein Vorschaubild zeigen wir erst, wenn wir die Lizenz geprüft haben. Weißt du etwas dazu (z. B. „ist meine eigene Karte“), schreib es bitte in die Notiz.")) + '</p>'
				+ selectMarkup("citymap-suggest-art", t("cityMaps.suggestArt", "Art"), [["", t("cityMaps.suggestUnknownOption", "— unbekannt —")]].concat(ARTS))
				+ fieldMarkup("citymap-suggest-from", t("cityMaps.suggestFrom", "Gültig ab (BF)"), "number", 0, t("cityMaps.suggestFromPh", "1027"))
				+ fieldMarkup("citymap-suggest-to", t("cityMaps.suggestTo", "Gültig bis (BF)"), "number", 0, t("cityMaps.suggestToPh", "1045"))
				+ fieldMarkup("citymap-suggest-width", t("cityMaps.suggestWidth", "Breite (px)"), "number", 0, t("cityMaps.suggestWidthPh", "2000"))
				+ fieldMarkup("citymap-suggest-height", t("cityMaps.suggestHeight", "Höhe (px)"), "number", 0, t("cityMaps.suggestHeightPh", "1500")))

			+ detailsGroup(t("cityMaps.suggestGroupPropsTypes", "Eigenschaften und Typ"),
				// Keine Floskel, sondern woertlich die §3.1/§3.7-Regel: unbekannt matcht keinen Filter ausser
				// "alle". Der Melder erfaehrt damit die echte Folge des Weglassens statt eines Appells.
				t("cityMaps.suggestWhyProps", "Danach filtern die Leser. Was hier fehlt, taucht in keinem Filter auf."),
				PROPS.map(function (p) { return selectMarkup("citymap-suggest-" + p[0], t("cityMaps.prop." + p[0], p[1]), TRI); }).join("")
				+ '<p class="citymap-suggest__hint">' + esc(t("cityMaps.suggestUnknownHint",
					"„unbekannt“ ist eine gültige Antwort: die Eigenschaft wird dann gar nicht gezeigt, statt ein erfundenes „nein“.")) + '</p>'
				+ '<div class="citymap-suggest__types">' + TYPE_KEYS.map(function (k) {
					return '<label><input type="checkbox" data-citymap-suggest-type="' + esc(k[0]) + '" /> ' + esc(t("cityMaps.type." + k[0], k[1])) + '</label>';
				}).join("") + '</div>')

			+ detailsGroup(t("cityMaps.suggestGroupYou", "Dein Name"),
				t("cityMaps.suggestWhyYou", "Nur, falls du genannt werden willst."),
				fieldMarkup("citymap-suggest-reporter", t("cityMaps.suggestReporter", "Dein Name/Pseudonym"), "text", 80,
					t("cityMaps.suggestReporterPh", "Alrik aus Gareth"), ' autocomplete="nickname"'))

			// Honeypot: unsichtbar, tabindex -1 — füllt ihn etwas aus, war es kein Mensch. Gleiche Mechanik
			// wie das Ortsformular (index.html:654); der Server verwirft still (avesmapsValidateMapReport).
			+ '<input class="location-report-form__honeypot" data-citymap-suggest-hp type="text" tabindex="-1" autocomplete="off" aria-hidden="true" />'
			+ '<p class="citymap-suggest__status" role="status" aria-live="polite"></p>'
			+ '<div class="citymap-suggest__actions">'
			+ '<button type="submit" class="citymap-suggest__submit">' + esc(t("cityMaps.suggestSubmit", "Vorschlag senden")) + '</button>'
			+ '<button type="button" class="citymap-suggest__cancel" data-citymap-suggest-close>' + esc(t("cityMaps.suggestCancel", "Abbrechen")) + '</button>'
			+ '</div></form></div>';
		document.body.appendChild(overlay);

		overlay.addEventListener("click", function (e) {
			if (e.target === overlay || (e.target.closest && e.target.closest("[data-citymap-suggest-close]"))) {
				close(overlay);
			}
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && overlay.classList.contains("is-open")) {
				close(overlay);
			}
		});
		overlay.querySelector("form").addEventListener("submit", function (e) {
			e.preventDefault();
			void submitSuggestion(overlay);
		});
		return overlay;
	}

	function close(overlay) {
		overlay.classList.remove("is-open");
	}

	function setStatus(overlay, message, state) {
		var el = overlay.querySelector(".citymap-suggest__status");
		if (el) {
			el.textContent = message || "";
			el.setAttribute("data-state", state || "");
		}
	}

	function val(overlay, id) {
		var el = overlay.querySelector("#" + id);
		return el ? String(el.value || "").trim() : "";
	}

	// Rohtext -> Zahl oder "". "" heißt unbekannt (§3.1) und darf NICHT zu 0 werden: Number("") ist 0, und
	// ein Ort ohne BF-Angabe wäre damit plötzlich "gültig ab 0 BF".
	function numOrEmpty(overlay, id) {
		var raw = val(overlay, id);
		return raw === "" ? "" : Number(raw);
	}

	function openSuggestDialog(place) {
		var overlay = ensureDialog();
		var form = overlay.querySelector("form");
		form.reset();
		// reset() setzt Checkboxen/Selects auf ihren MARKUP-Default zurück, nicht auf leer — die Typ-Haken
		// stehen im Markup ungehakt und die Tri-Selects auf "unbekannt", das passt also. Der Status ist kein
		// Formularfeld und muss von Hand weg, sonst klebt "Vorschlag gesendet." am nächsten Vorschlag.
		setStatus(overlay, "");
		// Ebenso wenig ist `open` ein Formularfeld: eine einmal aufgeklappte Gruppe bliebe über reset()
		// hinweg offen, und der nächste Melder saehe ein Formular, dessen "das ist optional"-Aussage schon
		// wieder aufgehoben ist. Die Zusage im Hinweisfeld gilt bei JEDEM Öffnen.
		Array.prototype.forEach.call(overlay.querySelectorAll("details"), function (d) { d.open = false; });
		overlay.querySelector(".avesmaps-adv-dialog__title").textContent = place.name
			? t("cityMaps.suggestTitleFor", "Karte vorschlagen – {place}", { place: place.name })
			: t("cityMaps.suggest", "Karte vorschlagen");
		overlay.dataset.placeKind = place.kind || "";
		overlay.dataset.placeName = place.name || "";
		overlay.dataset.placeId = place.publicId || "";
		overlay.dataset.placeKey = place.wikiKey || "";
		overlay.dataset.openedAt = String(Date.now());
		overlay.classList.add("is-open");
		var first = overlay.querySelector("#citymap-suggest-title-input");
		if (first) {
			first.focus();
		}
	}

	function buildPayload(overlay) {
		var types = Array.prototype.slice
			.call(overlay.querySelectorAll("[data-citymap-suggest-type]:checked"))
			.map(function (el) { return el.getAttribute("data-citymap-suggest-type"); });

		var citymap = {
			title: val(overlay, "citymap-suggest-title-input"),
			map_url: val(overlay, "citymap-suggest-map-url"),
			thumb_url: val(overlay, "citymap-suggest-thumb-url"),
			author: val(overlay, "citymap-suggest-author"),
			note: val(overlay, "citymap-suggest-note"),
			art: val(overlay, "citymap-suggest-art"),
			valid_from_bf: numOrEmpty(overlay, "citymap-suggest-from"),
			valid_to_bf: numOrEmpty(overlay, "citymap-suggest-to"),
			width_px: numOrEmpty(overlay, "citymap-suggest-width"),
			height_px: numOrEmpty(overlay, "citymap-suggest-height"),
			types: types,
			place: {
				raw_name: overlay.dataset.placeName || "",
				target_kind: overlay.dataset.placeKind || "",
				target_public_id: overlay.dataset.placeId || "",
				target_wiki_key: overlay.dataset.placeKey || "",
			},
		};
		PROPS.forEach(function (p) {
			citymap[p[0]] = val(overlay, "citymap-suggest-" + p[0]);
		});

		var hp = overlay.querySelector("[data-citymap-suggest-hp]");
		// Die Position ist für eine Karte nur ein grober Anker — verbindlich ist place.target_public_id.
		// Deshalb die Kartenmitte statt einer Ortskoordinate: der Leser hat den Ort gerade offen, und
		// report-location.php verlangt lat/lng in 0..1024 für JEDE Meldung. Gleiche Haltung wie der
		// Änderungsmodus, der sie ebenfalls nur als "rough locator" führt (review-locations.js:273).
		var centre = (typeof map !== "undefined" && map && typeof map.getCenter === "function")
			? map.getCenter()
			: { lat: 512, lng: 512 };
		var clamp = function (n) { return Math.min(1024, Math.max(0, Number.isFinite(n) ? n : 512)); };

		return {
			report_type: "karte",
			report_mode: "new",
			// `name` ist die Meldungs-Überschrift (Spalte 80 Zeichen) und trägt hier den Kartentitel. Der
			// VOLLE Titel (bis 300) reist in citymap.title — daraus wird die Karte gebaut, nicht aus `name`.
			name: citymap.title.slice(0, 80),
			reporter_name: val(overlay, "citymap-suggest-reporter"),
			sources: [{
				label: val(overlay, "citymap-suggest-source-label"),
				url: val(overlay, "citymap-suggest-source-url"),
				pages: val(overlay, "citymap-suggest-source-pages"),
				type: val(overlay, "citymap-suggest-source-type") || "sonstiges",
				official: Boolean(overlay.querySelector("#citymap-suggest-source-official")?.checked),
			}],
			comment: "",
			wiki_url: "",
			lat: clamp(centre.lat),
			lng: clamp(centre.lng),
			page_url: window.location.href,
			client_version: typeof ICON_ASSET_VERSION === "string" ? ICON_ASSET_VERSION : "",
			elapsed_ms: Math.max(0, Date.now() - Number.parseInt(overlay.dataset.openedAt || "0", 10)),
			website: hp ? String(hp.value || "").trim() : "",
			citymap: citymap,
		};
	}

	async function submitSuggestion(overlay) {
		if (typeof isLocationReportServiceConfigured === "function" && !isLocationReportServiceConfigured()) {
			setStatus(overlay, t("report.statusNotConfigured", "Das Meldeformular ist noch nicht mit dem Avesmaps-Server verbunden."), "error");
			return;
		}
		var payload = buildPayload(overlay);
		// Clientseitig prüfen, was der Server ohnehin prüft — aber hier mit einem Fokus auf dem Feld statt
		// einer Fehlermeldung über einem ausgefüllten Formular. novalidate + eigene Prüfung, weil der
		// Browser sonst ein verstecktes Feld bemängeln würde, das niemand sieht.
		var required = [
			["citymap-suggest-title-input", t("cityMaps.suggestNeedTitle", "Bitte einen Titel angeben.")],
			["citymap-suggest-map-url", t("cityMaps.suggestNeedMapUrl", "Bitte einen Karten-Link angeben.")],
			["citymap-suggest-source-label", t("cityMaps.suggestNeedSource", "Bitte eine Quelle angeben (Name genügt).")],
		];
		for (var i = 0; i < required.length; i++) {
			if (!val(overlay, required[i][0])) {
				setStatus(overlay, required[i][1], "error");
				overlay.querySelector("#" + required[i][0])?.focus();
				return;
			}
		}

		setStatus(overlay, t("cityMaps.suggestSending", "Vorschlag wird gesendet..."), "pending");
		var submit = overlay.querySelector(".citymap-suggest__submit");
		if (submit) {
			submit.disabled = true;
		}
		var result = { ok: false, message: "" };
		try {
			result = await submitLocationReportRequest(payload);
		} catch (error) {
			result = { ok: false, message: (error && error.message) || "" };
		}
		if (submit) {
			submit.disabled = false;
		}
		if (result.ok) {
			close(overlay);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(t("cityMaps.suggestThanks", "Danke! Dein Kartenvorschlag wurde gesendet."), "success");
			}
			return;
		}
		setStatus(overlay, result.message || t("cityMaps.suggestFailed", "Der Vorschlag konnte nicht gesendet werden."), "error");
	}

	// EIN Handler für beide Vorkommen: in der Sektion neben "Alle anzeigen" und unten in der Fußzeile des
	// Kartensammlungs-Dialogs. Möglich, weil der Button die Ortsreferenz immer SELBST trägt und der Handler
	// deshalb nicht wissen muss, wo er sitzt. Für die Fußzeile ist das keine Bequemlichkeit, sondern
	// notwendig: die Dialoghülle wird wiederverwendet und zeigt beim nächsten Öffnen einen anderen Ort.
	$(document).on("click", ".avesmaps-citymaps__suggest", function () {
		openSuggestDialog({
			kind: this.getAttribute("data-citymap-place-kind") || "",
			name: this.getAttribute("data-citymap-place-name") || "",
			publicId: this.getAttribute("data-citymap-place-id") || "",
			wikiKey: this.getAttribute("data-citymap-place-key") || "",
		});
	});

	window.openCitymapSuggestDialog = openSuggestDialog;

	// =====================================================================================================
	// „Neuer Fundort" (Spec 2026-07-17-community-fundorte) — ein weiterer Ort, an dem es eine BESTEHENDE
	// Karte gibt. Wohnt in dieser Datei statt in einer eigenen, weil er sich alles teilt, was zaehlt: die
	// Dialoghuelle, esc/t/val/close/setStatus, den Honeypot, elapsed_ms und den Transport. Was ihn vom
	// Formular oben unterscheidet, sind genau seine drei Felder.
	//
	// KEIN Zeilen-State (anders als im Editor): ohne ▲▼ wird nichts neu gezeichnet, „+ weiterer Fundort"
	// haengt bloss eine Zeile an. Getipptes kann also gar nicht erst verlorengehen.
	//
	// FUNDORT ist nicht QUELLE: hier steht, WO es die Karte gibt (ein Link), nicht, aus welchem WERK sie
	// stammt. Deshalb hat dieser Dialog kein Quellenfeld -- und der Server nimmt fuer 'fundort' auch keins
	// an: die URL ist ihr eigener Beleg.
	function fundortRowMarkup() {
		return '<div class="citymap-fundort__row">'
			+ '<input class="citymap-fundort__input" data-fundort-field="label" type="text" maxlength="200"'
			+ ' placeholder="' + esc(t("cityMaps.fundortLabelPh", "Wiki-Aventurica")) + '" />'
			+ '<input class="citymap-fundort__input" data-fundort-field="url" type="url" maxlength="500" inputmode="url"'
			+ ' placeholder="' + esc(t("cityMaps.fundortUrlPh", "https://de.wiki-aventurica.de/wiki/…")) + '" />'
			+ '<select class="citymap-fundort__input" data-fundort-field="is_paid">'
			+ TRI.map(function (o) {
				return '<option value="' + esc(o[0]) + '">' + esc(t("cityMaps.tri." + (o[0] || "unknown"), o[1])) + '</option>';
			}).join("")
			+ '</select></div>';
	}

	function ensureFundortDialog() {
		var overlay = document.getElementById("avesmaps-citymap-fundort");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-citymap-fundort";
		overlay.className = "avesmaps-adv-dialog citymap-suggest citymap-fundort";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true" aria-labelledby="citymap-fundort-title">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title" id="citymap-fundort-title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" data-fundort-close aria-label="' + esc(t("cityMaps.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<form class="citymap-suggest__body" novalidate>'
			+ '<p class="citymap-suggest__notice">' + esc(t("cityMaps.fundortNotice",
				"Kennst du eine weitere Stelle, an der es diese Karte gibt? Bezeichnung und Link genügen — die Bezeichnung ist das, was der Leser anklickt, also die Fundstelle selbst („Wiki-Aventurica“), nicht die Karte.")) + '</p>'
			+ '<div class="citymap-suggest__group">'
			+ '<div class="citymap-fundort__head"><span>' + esc(t("cityMaps.fundortLabel", "Bezeichnung *")) + '</span>'
			+ '<span>' + esc(t("cityMaps.fundortUrl", "Link *")) + '</span>'
			+ '<span>' + esc(t("cityMaps.fundortPaid", "kostenpflichtig")) + '</span></div>'
			+ '<div data-fundort-rows>' + fundortRowMarkup() + '</div>'
			+ '<div class="ce-xlink__add"><button type="button" class="citymap-suggest__cancel" data-fundort-add>'
			+ esc(t("cityMaps.fundortAdd", "+ weiterer Fundort")) + '</button></div>'
			// Woertlich die §3.1-Regel: „unbekannt" ist eine gueltige Antwort. Ein Melder, der den Preis nicht
			// kennt, soll nichts behaupten muessen -- und „kostenlos" ist die Behauptung, deren Widerlegung
			// einen Leser Geld kostet.
			+ '<p class="citymap-suggest__hint">' + esc(t("cityMaps.fundortPaidHint",
				"„kostenpflichtig“ hängt am Link, nicht an der Karte: derselbe Band ist im Shop bezahlt und auf seiner Wiki-Seite frei. Weißt du es nicht, lass „unbekannt“ stehen — wir raten nicht über fremdes Geld.")) + '</p>'
			+ '</div>'
			+ detailsGroup(t("cityMaps.fundortGroupMore", "Notiz und Name"),
				t("cityMaps.fundortWhyMore", "Nur, falls du uns etwas mitgeben oder genannt werden willst."),
				fieldMarkup("citymap-fundort-note", t("cityMaps.fundortNote", "Notiz an die Redaktion"), "text", 2000,
					t("cityMaps.fundortNotePh", "Dort liegt die Karte frei einsehbar."))
				+ fieldMarkup("citymap-fundort-reporter", t("cityMaps.suggestReporter", "Dein Name/Pseudonym"), "text", 80,
					t("cityMaps.suggestReporterPh", "Alrik aus Gareth"), ' autocomplete="nickname"'))
			+ '<input class="location-report-form__honeypot" data-fundort-hp type="text" tabindex="-1" autocomplete="off" aria-hidden="true" />'
			+ '<p class="citymap-suggest__status" role="status" aria-live="polite"></p>'
			+ '<div class="citymap-suggest__actions">'
			+ '<button type="submit" class="citymap-suggest__submit">' + esc(t("cityMaps.suggestSubmit", "Vorschlag senden")) + '</button>'
			+ '<button type="button" class="citymap-suggest__cancel" data-fundort-close>' + esc(t("cityMaps.suggestCancel", "Abbrechen")) + '</button>'
			+ '</div></form></div>';
		document.body.appendChild(overlay);

		overlay.addEventListener("click", function (e) {
			if (e.target === overlay || (e.target.closest && e.target.closest("[data-fundort-close]"))) {
				close(overlay);
				return;
			}
			if (e.target.closest && e.target.closest("[data-fundort-add]")) {
				var rows = overlay.querySelector("[data-fundort-rows]");
				if (rows) {
					rows.insertAdjacentHTML("beforeend", fundortRowMarkup());
				}
			}
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && overlay.classList.contains("is-open")) {
				close(overlay);
			}
		});
		overlay.querySelector("form").addEventListener("submit", function (e) {
			e.preventDefault();
			void submitFundort(overlay);
		});
		return overlay;
	}

	// Die Zeilen aus dem DOM. Voellig leere fallen raus (eine angehaengte, nie ausgefuellte Zeile ist kein
	// Fehler); halb gefuellte reisen mit, damit der SERVER sie beanstandet -- er ist die eine Instanz, die
	// diese Regel kennt (avesmapsNormalizeCitymapLinkRows), und zwei Kopien davon liefen auseinander.
	function fundortRows(overlay) {
		var out = [];
		overlay.querySelectorAll(".citymap-fundort__row").forEach(function (row) {
			var get = function (field) {
				var el = row.querySelector('[data-fundort-field="' + field + '"]');
				return el ? String(el.value || "").trim() : "";
			};
			var label = get("label");
			var url = get("url");
			if (label === "" && url === "") {
				return;
			}
			out.push({ label: label, url: url, is_paid: get("is_paid") });
		});
		return out;
	}

	function openFundortDialog(citymap) {
		var overlay = ensureFundortDialog();
		overlay.dataset.citymapId = citymap.publicId || "";
		// Der Titel reist als Datensatz mit, weil submitFundort ihn als Meldungs-Ueberschrift braucht --
		// ihn aus der Dialog-Ueberschrift zurueckzulesen holte "Neuer Fundort – " gleich mit.
		overlay.dataset.citymapTitle = citymap.title || "";
		overlay.dataset.openedAt = String(Date.now());
		overlay.querySelector("#citymap-fundort-title").textContent = citymap.title
			? t("cityMaps.fundortTitleFor", "Neuer Fundort – {title}", { title: citymap.title })
			: t("cityMaps.fundortTitle", "Neuer Fundort");
		// Frisches Formular: die Huelle wird wiederverwendet und zeigte sonst die Eingaben zur zuletzt
		// gemeldeten Karte -- beim zweiten Melden genau einmal falsch.
		overlay.querySelector("[data-fundort-rows]").innerHTML = fundortRowMarkup();
		overlay.querySelector("#citymap-fundort-note").value = "";
		setStatus(overlay, "", "");
		overlay.classList.add("is-open");
		overlay.querySelector('[data-fundort-field="label"]')?.focus();
	}

	async function submitFundort(overlay) {
		if (typeof isLocationReportServiceConfigured === "function" && !isLocationReportServiceConfigured()) {
			setStatus(overlay, t("report.statusNotConfigured", "Das Meldeformular ist noch nicht mit dem Avesmaps-Server verbunden."), "error");
			return;
		}
		var rows = fundortRows(overlay);
		if (rows.length === 0) {
			setStatus(overlay, t("cityMaps.fundortNeedOne", "Bitte mindestens einen Fundort angeben."), "error");
			overlay.querySelector('[data-fundort-field="label"]')?.focus();
			return;
		}

		var hp = overlay.querySelector("[data-fundort-hp]");
		// Position: wie beim Kartenvorschlag nur ein grober Anker -- report-location.php verlangt lat/lng
		// fuer JEDE Meldung, verbindlich ist hier aber die citymap_public_id.
		var centre = (typeof map !== "undefined" && map && typeof map.getCenter === "function")
			? map.getCenter()
			: { lat: 512, lng: 512 };
		var clamp = function (n) { return Math.min(1024, Math.max(0, Number.isFinite(n) ? n : 512)); };
		var title = overlay.dataset.citymapTitle || "";

		var payload = {
			report_type: "fundort",
			report_mode: "new",
			// `name` ist die Ueberschrift der Meldung im Reiter (Spalte 80 Zeichen) und traegt den
			// Kartentitel -- verbindlich ist citymap_public_id darunter, nicht dieser Text.
			name: (title || t("cityMaps.fundortTitle", "Neuer Fundort")).slice(0, 80),
			reporter_name: val(overlay, "citymap-fundort-reporter"),
			// KEINE `sources`: ein Fundort IST ein Link, die URL ist ihr eigener Beleg. Der Server nimmt
			// 'fundort' deshalb von der Quellenpflicht aus.
			comment: "",
			wiki_url: "",
			lat: clamp(centre.lat),
			lng: clamp(centre.lng),
			page_url: window.location.href,
			client_version: typeof ICON_ASSET_VERSION === "string" ? ICON_ASSET_VERSION : "",
			elapsed_ms: Math.max(0, Date.now() - Number.parseInt(overlay.dataset.openedAt || "0", 10)),
			website: hp ? String(hp.value || "").trim() : "",
			citymap_link: {
				citymap_public_id: overlay.dataset.citymapId || "",
				links: rows,
				note: val(overlay, "citymap-fundort-note"),
			},
		};

		setStatus(overlay, t("cityMaps.suggestSending", "Vorschlag wird gesendet..."), "pending");
		var submit = overlay.querySelector(".citymap-suggest__submit");
		if (submit) {
			submit.disabled = true;
		}
		var result = { ok: false, message: "" };
		try {
			result = await submitLocationReportRequest(payload);
		} catch (error) {
			result = { ok: false, message: (error && error.message) || "" };
		}
		if (submit) {
			submit.disabled = false;
		}
		if (result.ok) {
			close(overlay);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(t("cityMaps.fundortThanks", "Danke! Dein Fundort wurde gesendet."), "success");
			}
			return;
		}
		setStatus(overlay, result.message || t("cityMaps.suggestFailed", "Der Vorschlag konnte nicht gesendet werden."), "error");
	}

	// Der Knopf sitzt in der aufgeklappten Karten-Zeile und traegt seine Karte selbst -- wie der
	// Vorschlag-Knopf oben seinen Ort. Der Dialog wird wiederverwendet, eine gemerkte Referenz waere beim
	// zweiten Melden falsch.
	$(document).on("click", ".avesmaps-citymap-row__addlink", function (e) {
		e.preventDefault();
		e.stopPropagation(); // sonst klappt derselbe Klick die Zeile zu
		openFundortDialog({
			publicId: this.getAttribute("data-citymap-id") || "",
			title: this.getAttribute("data-citymap-title") || "",
		});
	});

	window.openCitymapFundortDialog = openFundortDialog;
})();
