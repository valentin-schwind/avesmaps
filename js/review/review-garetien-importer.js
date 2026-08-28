(function () {
	"use strict";

	/*
	 * Das Fenster „Garetien Importer" — Knopf, Hülle, Liste, Einzelansicht, Handlungen.
	 *
	 * 🔴 DIESE DATEI VERSCHWINDET BEIM ABBAU DES IMPORTERS (Auftrag §5.5). Sie kennt deshalb die
	 *    internen Speichertabellen des Importers nicht und darf sie nie kennen (der Wächtertest
	 *    api/_internal/import/__tests__/garetien-abbau-waechter-test.php prüft das): was diese
	 *    Tabellen kennt, steht ausschließlich innerhalb von api/_internal/import/. Der Griff für
	 *    „woher kam das" ist feature_sources.origin.
	 * 🔴 SIE RECHNET NICHTS NACH. Urteil, Grund, Geometrie (fertig in Karteneinheiten) und die
	 *    getroffenen Abschnitte kommen aus after_json. Der Browser wählt aus, blendet ein und
	 *    schickt Häkchen — er transformiert keine Koordinate und bildet kein Urteil.
	 * 🔴 UND ER SCHREIBT NUR DURCH EINE TÜR: api/edit/wiki/sync-plan.php mit kind:'garetien'.
	 *
	 * Aufgabe 10 baute Knopf, Hülle (dialog-drag.js erledigt das Ziehen ohne eine Zeile
	 * Verdrahtung -- sie sucht nach der FORM, nicht nach dieser Datei), Rechte-Riegel und den
	 * einen Sender. Aufgabe 11 füllt die linke Spalte: Zeilen, die zwei Bilanzzeilen, die vier
	 * Reiter. Filtertrichter, Einzelansicht, Handlungen, Karte und Übernahme sind Aufgabe 12 ff.
	 */

	const hasDocument = typeof document !== "undefined";

	// Die zwei erlaubten Adressen für avesmapsGaretienRufe() (Auftrag §5.4):
	//   lesend  -- /api/edit/map/garetien-import.php (Aufgabe 11: action:'liste')
	//   schreibend -- /api/edit/wiki/sync-plan.php (Aufgabe 15/16)
	// Kein Aufrufer baut sich eine eigene fetch()-Stelle; der Test aus Aufgabe 15 zählt die
	// fetch(-Vorkommen dieser Datei.
	//
	// Die lesende Adresse steht seit Aufgabe 12b EINMAL da: Menüband und Liste rufen denselben
	// Endpunkt mit verschiedenen `action`, und zwei Zeichenketten für eine Adresse laufen
	// auseinander, sobald sie jemand verschiebt.
	const GARETIEN_ENDPUNKT = "/api/edit/map/garetien-import.php";

	// ---- der Rechte-Riegel (unter Test in js/review/__tests__/garetien-fenster-huelle.test.js) ---
	//
	// 🔴 Fällt GESCHLOSSEN aus: bis die Auskunft da ist — und für immer, wenn sie nie kommt —
	// bleibt der Knopf verborgen. Nur echtes `true` zählt; eine als JSON geparste Fehlerseite,
	// eine 1 statt true, ein Proxy mit "0" sind alle truthy und würden den Knopf sonst freigeben.
	function avesmapsGaretienDarfOeffnen(sitzung) {
		return !!(sitzung && sitzung.capabilities && sitzung.capabilities.admin === true);
	}

	// ---- Zustand ---------------------------------------------------------------------------------
	//
	// Die volle Form ist die Schnittstelle für Aufgabe 11-16 (avesmapsGaretienFensterZustand()).
	const zustand = {
		offen: false,
		planRunId: null,
		importRunId: null,
		objekte: [],
		auswahl: [],
		stand: null,
		filter: {},
		// Aufgabe 13: der Schluessel des Objekts, dessen Einzelansicht rechts steht -- `null` heisst
		// „nichts gewaehlt", und dann steht dort der Hinweissatz, kein leerer Kasten.
		detailKey: null,
		// Die letzte Antwort von action:'liste' -- avesmapsGaretienAngehakt() liest daraus, denn
		// `angehakt` zaehlt den GANZEN Lauf (Aufgabe 8), unabhaengig vom aktiven Filter/Reiter.
		letzteAntwort: null,
	};

	function avesmapsGaretienFensterZustand() {
		// Eine Kopie -- Aufrufer sollen den internen Zustand nicht direkt mutieren können.
		return {
			offen: zustand.offen,
			planRunId: zustand.planRunId,
			importRunId: zustand.importRunId,
			objekte: zustand.objekte.slice(),
			auswahl: zustand.auswahl.slice(),
			stand: zustand.stand,
			filter: zustand.filter,
			detailKey: zustand.detailKey,
		};
	}

	// ---- die Hülle --------------------------------------------------------------------------------

	function fensterElement() {
		return hasDocument ? document.getElementById("garetien-importer") : null;
	}

	// Ein Fehler beim Laden der Liste steht IN der Liste, nicht in der Konsole.
	function garetienListeFehlerZeigen(fehler) {
		garetienListeSkelettSicherstellen();
		const listeEl = hasDocument ? document.getElementById("garetien-list") : null;
		if (listeEl) {
			listeEl.innerHTML = '<p class="avm-error">'
				+ avesmapsGaretienEscape((fehler && fehler.message) || "Die Liste konnte nicht geladen werden.")
				+ "</p>";
		}
	}

	// 🔴 EIN SATZ statt einer Fehlermeldung (Aufgabe 12b): „es gibt noch keinen Lauf" ist ein
	// leerer Zustand, kein Defekt. Die Kachel daneben sagt dasselbe in ihrer zweiten Zeile und
	// nennt zugleich den Weg heraus -- deshalb steht hier kein zweiter Knopf.
	function garetienLeeresFensterZeigen() {
		garetienListeSkelettSicherstellen();
		if (!hasDocument) { return; }
		const listeEl = document.getElementById("garetien-list");
		if (listeEl) {
			listeEl.innerHTML = '<p class="avm-empty">Noch kein Import-Lauf. „Holen &amp; Rechnen" '
				+ "im Menüband holt die gewählten Ebenen und rechnet den Abgleich.</p>";
		}
		// Die Zahlen der drei Bilanzflächen gehören einem Lauf; ohne Lauf stehen sie leer, statt
		// eine Null zu behaupten, die niemand gezählt hat.
		["garetien-runline", "garetien-balance", "garetien-foot-count"].forEach(function (id) {
			const el = document.getElementById(id);
			if (el) { el.textContent = ""; }
		});
	}

	// Der Füllvorgang beim Öffnen, mit seinen Werkzeugen herein -- aus demselben Grund wie bei
	// garetienLaufStarten weiter unten: nur so lässt sich am ERGEBNIS zusichern, dass OHNE Lauf
	// kein `action:'liste'` hinausgeht. Eine Zusicherung, die nur nachsähe, ob ein `if` im
	// Quelltext steht, wäre Vakuum.
	//
	// 🪤 WER MITTEN IN EINEM LAUF ZU- UND WIEDER AUFMACHT, löst hier eine überflüssige, rein
	// LESENDE Runde aus: `runs` liefert den ALTEN Lauf (der neue existiert noch nicht), `liste`
	// zeigt ihn, und `importRunId` steht kurz auf dem alten Wert. Das ist gewollt so stehen
	// gelassen und KEIN Fehler -- bitte nicht als einen „finden":
	//   · Der laufende `plan` bekommt trotzdem die richtige id. `zustand.importRunId = …` und der
	//     `plan`-Ruf liegen in DEMSELBEN synchronen Block von garetienLaufStarten; dazwischen kann
	//     nichts einer anderen Aufgabe dazwischenfahren.
	//   · Am Ende des Laufs setzt garetienLaufUebernehmen(rufe, eigeneId) den Wert ohnehin auf den
	//     eigenen Lauf zurück -- und zwar gesucht, nicht als „der jüngste".
	//   · Ein Riegel „während eines Laufs gar nicht füllen" wäre EINE Zeile, aber teurer als der
	//     Fehler: er ließe ein wiedergeöffnetes Fenster leer stehen, solange der Abruf über 18
	//     fremde Seiten läuft -- und eine leere Liste ohne Erklärung ist genau die Störung, die
	//     dieses Fenster vermeiden soll.
	function garetienFensterFuellen(rufe, listeHolen) {
		return garetienLaufUebernehmen(rufe, null).then(function (lauf) {
			garetienLaufKachelAktualisieren();
			if (!lauf) {
				// 🔴 OHNE Lauf wird `action:'liste'` GAR NICHT ERST gerufen. Der Endpunkt antwortet
				// darauf mit 400 `no_run` -- und eine 400 im Netz-Protokoll ist kein leerer
				// Zustand, sondern sieht wie ein Defekt aus. Genau das erzeugte der Fensteröffner
				// bis Aufgabe 12b bei JEDEM Öffnen, weil `importRunId` nie gesetzt wurde.
				garetienLeeresFensterZeigen();
				return null;
			}
			return listeHolen();
		}).catch(function (fehler) {
			garetienLaufKachelAktualisieren();
			garetienListeFehlerZeigen(fehler);
			return null;
		});
	}

	function avesmapsGaretienFensterOeffnen() {
		const win = fensterElement();
		if (win) { win.hidden = false; }
		zustand.offen = true;
		// Aufgabe 12b: erst das Menüband (es ist der Schalter des Fensters, nicht seine Zier),
		// dann die 18 Ebenen im Hintergrund, dann der geltende Lauf.
		garetienMenuebandSicherstellen();
		garetienEbenenListeSicherstellen();
		// Aufgabe 13: der Hinweissatz steht sofort da -- auch ohne Lauf, wo nie eine Liste kommt.
		// ⚠️ OHNE Argument: dann gilt die zuletzt geholte Liste, und eine Auswahl ueberlebt ein
		// Zu- und Wiederaufmachen -- genauso wie die Zeilen links stehen bleiben, bis die neue
		// Liste da ist.
		garetienDetailRendern();
		return garetienFensterFuellen(avesmapsGaretienRufe, avesmapsGaretienListeHolen);
	}

	function avesmapsGaretienFensterSchliessen() {
		const win = fensterElement();
		if (win) { win.hidden = true; }
		zustand.offen = false;
	}

	// ---- der eine Sender (Auftrag §5.4) -------------------------------------------------------
	//
	// POST, JSON, credentials same-origin, wirft bei ok !== true mit error.message. Alle
	// Aufrufer (Aufgabe 11-16) gehen hier durch, nie mit einem eigenen fetch().
	function avesmapsGaretienRufe(pfad, rumpf) {
		return fetch(pfad, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rumpf || {}),
		})
			.then(function (antwort) { return antwort.json(); })
			.then(function (daten) {
				if (!daten || daten.ok !== true) {
					const nachricht = (daten && daten.error && typeof daten.error.message === "string")
						? daten.error.message
						: "Unbekannter Fehler beim Garetien-Importer.";
					throw new Error(nachricht);
				}
				return daten;
			});
	}

	// ---- Aufgabe 11: die Arbeitsliste -- Zeilen, Bilanz, Reiter ------------------------------------
	//
	// 🔴 SIE RECHNET NICHTS NACH. Urteil, Grund und die Bearbeitungsstaende kommen aus der
	// Serverantwort von action:'liste' (api/_internal/import/garetien-liste.php, Aufgabe 8). Diese
	// Funktionen waehlen aus, formatieren und zeigen -- sie leiten kein Urteil her.

	// Ein selbstgenuegsamer Escaper (wie avmFilterEscape/syncPlanEscape) -- diese Datei verschwindet
	// beim Abbau (Auftrag §5.5) restlos und soll deshalb an nichts haengen, was das nicht auch tut.
	function avesmapsGaretienEscape(wert) {
		return String(wert === null || wert === undefined ? "" : wert)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#039;");
	}

	// Das Urteil ist FARBE ALS DATEN (Designsprache) -- Gruen/Gold/Bernstein/Rot/gedaempft, warme
	// Familie, kein Blau. deckt_sich und uebersprungen teilen sich die gedaempfte Klasse (Brief).
	const AVESMAPS_GARETIEN_URTEIL_ZEILE = {
		neu: { klasse: "u--neu", beschriftung: "neu" },
		ergaenzung: { klasse: "u--erg", beschriftung: "Ergänzung" },
		zweifel: { klasse: "u--zweif", beschriftung: "Zweifel" },
		widerspruch: { klasse: "u--wider", beschriftung: "widerspricht" },
		deckt_sich: { klasse: "u--deckt", beschriftung: "deckt sich" },
		uebersprungen: { klasse: "u--deckt", beschriftung: "übersprungen" },
	};

	function avesmapsGaretienUrteilInfo(urteil) {
		return AVESMAPS_GARETIEN_URTEIL_ZEILE[urteil]
			|| { klasse: "u--deckt", beschriftung: String(urteil || "") };
	}

	// Traegt ein Item wirklich ein Haekchen? Der Server schickt `selected` als 0/1-ZAHL
	// (`(int) $roh['selected']` in garetien-liste.php), nie als Bool -- `=== true` liest das live
	// als "nichts angehakt" und war schon einmal der Fehler, den die Wiki-Zuweisung bezahlt hat.
	function avesmapsGaretienItemIstAngehakt(item) {
		return Boolean(item && item.selected);
	}

	// Irgendein Item angehakt? Treibt das ✦ ("leuchtet") -- schon EIN angehaktes Item genuegt,
	// auch bei einem sonst dreiwertigen Objekt.
	function avesmapsGaretienHatAuswahl(objekt) {
		const items = (objekt && objekt.items) || [];
		return items.some(avesmapsGaretienItemIstAngehakt);
	}

	// 🔴 Das dreiwertige Haekchen (Brief, Fuenf Dinge #4). Ohne Items: deaktiviert -- "es gibt
	// nichts zu tun; die Zeile steht nur da, damit die Zahl nachpruefbar bleibt" (Mockup §5).
	function avesmapsGaretienCheckboxZustand(objekt) {
		const items = (objekt && objekt.items) || [];
		if (items.length === 0) {
			return { checked: false, dreiwertig: false, disabled: true };
		}
		const angehaktAnzahl = items.filter(avesmapsGaretienItemIstAngehakt).length;
		if (angehaktAnzahl === 0) {
			return { checked: false, dreiwertig: false, disabled: false };
		}
		if (angehaktAnzahl === items.length) {
			return { checked: true, dreiwertig: false, disabled: false };
		}
		return { checked: false, dreiwertig: true, disabled: false };
	}

	// 🔴 Die Zeile ist .avm-row, UNVERAENDERT (AGENTS.md §11 -- zwei Zeilenrezepturen sind die
	// Obergrenze, .avm-row ist eine davon). REIN: kein DOM-Zugriff, damit der Test sie ohne Browser
	// fahren kann. Name+Typ in __l1, Urteil+Grund in der gedaempften __l2, das Haekchen davor,
	// hinter dem Namen das ✦.
	//
	// 💣 `indeterminate` ist eine JS-EIGENSCHAFT, kein Attribut -- ein `indeterminate=""` im
	// Markup taete nichts. Dreiwertig wird deshalb ueber den Marker `data-part` transportiert (wie
	// im Mockup-Script vorgemacht); avesmapsGaretienListeRendern loest ihn NACH dem Einfuegen ins
	// DOM per `el.indeterminate = true` ein.
	//
	// 🔴 Review M3 (28.08.2026): das Wurzelelement ist bewusst ein `<div>`, kein `<label>` (das
	// Mockup zeigt `<label class="avm-row">`). Ein `<label>` wuerde einen Klick IRGENDWO in der
	// Zeile als Klick auf sein eingebettetes `<input>` behandeln -- native HTML-Semantik. Aufgabe
	// 13 soll aber genau das: eine Zeile anklicken oeffnet die Einzelansicht, OHNE dabei das
	// Haekchen mitzuschalten. Mit `<label>` koennte ein Editor keine Zeile ansehen, ohne sie im
	// selben Klick anzuhaken. Wer das zum Mockup "korrigiert", bricht Aufgabe 13 im selben Zug.
	function garetienZeileMarkup(objekt) {
		const o = objekt || {};
		const checkboxZustand = avesmapsGaretienCheckboxZustand(o);
		const leuchtet = avesmapsGaretienHatAuswahl(o);
		const urteilInfo = avesmapsGaretienUrteilInfo(o.urteil);

		let checkboxAttribute = "";
		if (checkboxZustand.checked) { checkboxAttribute += " checked"; }
		if (checkboxZustand.disabled) { checkboxAttribute += " disabled"; }
		if (checkboxZustand.dreiwertig) { checkboxAttribute += " data-part"; }

		let name = avesmapsGaretienEscape(o.name || "");
		if (leuchtet) {
			name += ' <span class="lit-dot">✦</span>';
		}

		let l2 = '<span class="u ' + urteilInfo.klasse + '">'
			+ avesmapsGaretienEscape(urteilInfo.beschriftung) + "</span>";
		const grund = String(o.grund || "").trim();
		if (grund !== "") {
			l2 += " · " + avesmapsGaretienEscape(grund);
		}

		return '<div class="avm-row" data-key="' + avesmapsGaretienEscape(o.key || "") + '">'
			+ '<input type="checkbox"' + checkboxAttribute + '>'
			+ '<span class="avm-row__text">'
			+ '<span class="avm-row__l1">'
			+ '<span class="avm-row__name">' + name + "</span>"
			+ '<span class="avm-row__kind">' + avesmapsGaretienEscape(o.typ || "") + "</span>"
			+ "</span>"
			+ '<span class="avm-row__l2">' + l2 + "</span>"
			+ "</span>"
			+ "</div>";
	}

	// ---- Zwei Bilanzzeilen, und sie sagen Verschiedenes (Owner 14.08.2026) -------------------------
	//
	// Die STILLE Zeile UEBER der Suche (.gi-runline) ist die Bilanz des LAUFS -- sie bewegt sich
	// beim Filtern nicht. Sie kommt direkt aus `bilanz` (Aufgabe 8), unabhaengig vom Filter/Reiter.
	function avesmapsGaretienRunlineMarkup(bilanz) {
		const b = bilanz || {};
		const zahl = (feld) => Number(b[feld] || 0);
		const gesamt = zahl("neu") + zahl("ergaenzung") + zahl("zweifel")
			+ zahl("widerspruch") + zahl("deckt_sich") + zahl("uebersprungen");
		return "<b>" + gesamt + "</b> Zeilen · "
			+ "<b>" + zahl("neu") + "</b> neu · "
			+ "<b>" + zahl("zweifel") + "</b> mit Zweifel · "
			+ "<b>" + zahl("widerspruch") + "</b> widersprüchlich · "
			+ "<b>" + zahl("ergaenzung") + "</b> Ergänzung · "
			+ "<b>" + zahl("deckt_sich") + "</b> deckt sich · "
			+ "<b>" + zahl("uebersprungen") + "</b> übersprungen";
	}

	// Die Zeile UNTER der Suche ist die des FILTERS -- js/review/review-list-balance.js ist der
	// EINE Erzeuger (acht Kopien derselben Formel liefen in drei Monaten wieder achtfach
	// auseinander). Nominativ Plural "Objekte" -- die Faustregel bildet daraus von selbst den
	// richtigen Dativ "Objekten"; trotzdem ausdruecklich mitgegeben (Brief nennt ihn wortgleich),
	// falls die Faustregel je umgebaut wird. Das ✦-Stueck wird DANEBEN gehaengt (Brief), nicht in
	// die geteilte Formel gerechnet.
	function avesmapsGaretienBalanceZeileText(sichtbar, gesamt) {
		return avesmapsListBalanceText("Objekte", sichtbar, gesamt, "Objekten");
	}

	// 🔴 Die Reiter zeigen den BEARBEITUNGSSTAND, nicht das Urteil: Offen · Vorgemerkt · Abgelehnt ·
	// Uebernommen. .avm-tabs/.avm-tab sind Hausform (editor-body.css) -- die aktive Unterstreichung
	// ist dort --color-text-strong; das Mockup zeichnet golden, aber die Hausform gewinnt.
	const AVESMAPS_GARETIEN_REITER = [
		["offen", "Offen"],
		["vorgemerkt", "Vorgemerkt"],
		["abgelehnt", "Abgelehnt"],
		["uebernommen", "Übernommen"],
	];

	function avesmapsGaretienTabsMarkup(reiter, aktiverStand) {
		const r = reiter || {};
		return AVESMAPS_GARETIEN_REITER.map(([schluessel, beschriftung]) => {
			const klasse = "avm-tab" + (schluessel === aktiverStand ? " is-active" : "");
			return '<button class="' + klasse + '" type="button" data-stand="' + schluessel + '">'
				+ avesmapsGaretienEscape(beschriftung) + " (" + Number(r[schluessel] || 0) + ")</button>";
		}).join("");
	}

	// 🔴 Review I1 (28.08.2026): die Fusszeile zeigt den BEARBEITUNGSSTAND (Mockup §1 --
	// "<b>14</b> vorgemerkt · <b>3</b> abgelehnt · <b>0</b> übernommen"), NICHT die Item-Ebene
	// aus `angehakt.*` -- die ist fuer Aufgabe 16 (die truncated-Angabe im Uebernahme-Blatt)
	// vorgesehen, nicht fuer dieses Element. `a.reiter` liegt hier schon vor (dieselbe Quelle
	// wie fuer die vier Reiter oben) -- keine zweite Rechnung noetig.
	function avesmapsGaretienFussZeileMarkup(reiter) {
		const r = reiter || {};
		const zahl = (feld) => Number(r[feld] || 0);
		return "<b>" + zahl("vorgemerkt") + "</b> vorgemerkt · "
			+ "<b>" + zahl("abgelehnt") + "</b> abgelehnt · "
			+ "<b>" + zahl("uebernommen") + "</b> übernommen";
	}

	// ---- avesmapsGaretienAngehakt (fuer Aufgabe 16) -------------------------------------------------
	//
	// Wie viele Items dieses change_type im GANZEN Lauf angehakt sind -- aus der letzten
	// liste-Antwort (`angehakt.new`/`angehakt.changed`, Aufgabe 8). Die Zahl gilt fuer den ganzen
	// Lauf, NIE fuer die gerade sichtbaren (gefilterten) Zeilen -- Aufgabe 16 braucht sie fuer eine
	// ehrliche `truncated`-Angabe im Uebernahme-Blatt.
	function avesmapsGaretienAngehaktAus(antwort, changeType) {
		return Number((antwort && antwort.angehakt && antwort.angehakt[changeType]) || 0);
	}

	function avesmapsGaretienAngehakt(changeType) {
		return avesmapsGaretienAngehaktAus(zustand.letzteAntwort, changeType);
	}

	// ---- Die linke Spalte: Skelett einmal bauen, danach nur noch abgleichen -----------------------
	//
	// 💣 Ein Neuaufbau der GANZEN Spalte bei jedem Listenlauf wuerde Aufgabe 12s Filtertrichter
	// (avmFilterMenuAttach haengt seine Listener an die Knopf-/Panel-ELEMENTE, einmalig) die
	// Verdrahtung unter dem Cursor wegreissen -- dieselbe Falle wie beim Zeitraum-Abschnitt in
	// js/ui/filter-menu.js ("wuerde ... sein innerHTML ersetzen ... verloere das Zahlenfeld beim
	// Tippen den Fokus"). Deshalb: Huelle EINMAL, danach werden nur Inhalte ausgetauscht.
	function garetienListeSkelettMarkup() {
		return '<div class="avm-tabs" id="garetien-tabs"></div>'
			+ '<div class="gi-searchrow">'
			+ '<input class="gi-search" type="search" id="garetien-search" placeholder="Namen suchen …">'
			+ '<div class="type-filter">'
			+ '<button class="type-filter__toggle" type="button" id="garetien-filter-toggle">Filter ▾</button>'
			+ '<div class="type-filter__menu" id="garetien-filter-menu" hidden>'
			+ '<p class="type-filter__section-title" id="garetien-filter-ebene-title">Ebene</p>'
			+ '<div id="garetien-filter-ebene-menu"></div>'
			+ '<p class="type-filter__section-title" id="garetien-filter-typ-title">Objekttyp</p>'
			+ '<div id="garetien-filter-typ-menu"></div>'
			+ '<p class="type-filter__section-title">Urteil</p>'
			+ '<div id="garetien-filter-urteil-menu"></div>'
			+ '<p class="type-filter__section-title">Wiki</p>'
			+ '<div id="garetien-filter-wiki-menu"></div>'
			+ '<p class="type-filter__section-title">Nur zeigen</p>'
			+ '<div id="garetien-filter-nur-menu"></div>'
			+ "</div>"
			+ "</div>"
			+ '<div class="gi-chips" id="garetien-chips"></div>'
			+ '<p class="gi-balance" id="garetien-balance"></p>'
			+ '<div class="avm-scroll gi-list" id="garetien-list"></div>';
	}

	function garetienListeSkelettVerdrahten() {
		const tabsEl = document.getElementById("garetien-tabs");
		if (tabsEl) {
			tabsEl.addEventListener("click", function (ereignis) {
				const knopf = ereignis.target.closest ? ereignis.target.closest(".avm-tab") : null;
				if (!knopf) { return; }
				const stand = knopf.getAttribute("data-stand");
				if (!stand || stand === zustand.stand) { return; }
				zustand.stand = stand;
				avesmapsGaretienListeHolen();
			});
		}
		// Aufgabe 13: EIN Zuhoerer auf dem Listenkasten. Er wird nie ersetzt (nur sein innerHTML),
		// die Delegation ueberlebt also jeden Listenlauf -- dieselbe Begruendung wie beim Chip-Kasten.
		const listeEl = document.getElementById("garetien-list");
		if (listeEl) {
			listeEl.addEventListener("click", function (ereignis) {
				garetienListeKlick(ereignis, zustand.objekte);
			});
		}
		const sucheEl = document.getElementById("garetien-search");
		if (sucheEl) {
			let entprellTimer = null;
			sucheEl.addEventListener("input", function () {
				zustand.filter = zustand.filter || {};
				zustand.filter.suche = sucheEl.value;
				if (entprellTimer) { clearTimeout(entprellTimer); }
				entprellTimer = setTimeout(function () { avesmapsGaretienListeHolen(); }, 250);
			});
		}
	}

	function garetienListeSkelettSicherstellen() {
		if (!hasDocument) { return null; }
		const listcol = document.getElementById("garetien-listcol");
		if (!listcol) { return null; }
		if (listcol.dataset.giSkelett !== "1") {
			listcol.innerHTML = garetienListeSkelettMarkup();
			listcol.dataset.giSkelett = "1";
			garetienListeSkelettVerdrahten();
		}
		return listcol;
	}

	// Schreibt Liste, (Filter-)Bilanz, Reiterzahlen und Fusszeile aus einer frischen
	// action:'liste'-Antwort. 🔴 Rechnet nichts nach -- Urteil/Grund/Geometrie stehen schon fertig
	// in der Antwort.
	function avesmapsGaretienListeRendern(antwort) {
		if (!hasDocument) { return; }
		const listcol = garetienListeSkelettSicherstellen();
		if (!listcol) { return; }
		const a = antwort || {};
		const objekte = a.objekte || [];

		const runlineEl = document.getElementById("garetien-runline");
		if (runlineEl) { runlineEl.innerHTML = avesmapsGaretienRunlineMarkup(a.bilanz); }

		const tabsEl = document.getElementById("garetien-tabs");
		if (tabsEl) { tabsEl.innerHTML = avesmapsGaretienTabsMarkup(a.reiter, zustand.stand); }

		const listeEl = document.getElementById("garetien-list");
		if (listeEl) {
			listeEl.innerHTML = objekte.length
				? objekte.map(garetienZeileMarkup).join("")
				: '<p class="avm-empty">Keine Objekte in dieser Ansicht.</p>';
			// Dreiwertig ist eine EIGENSCHAFT, kein Attribut -- erst jetzt, nach dem Einfuegen ins
			// DOM, per el.indeterminate = true einloesen (der Marker data-part kam aus dem Markup).
			Array.prototype.forEach.call(listeEl.querySelectorAll("input[data-part]"), function (feld) {
				feld.indeterminate = true;
			});
		}

		const balanceEl = document.getElementById("garetien-balance");
		if (balanceEl) {
			// "gesamt" der Bilanzzeile ist die Groesse der AKTIVEN ANSICHT (des Reiters) ohne
			// Suche/Filter -- reiter[stand] zaehlt genau das (Aufgabe 8, VOR dem Filtern gezaehlt).
			const basisDesReiters = (a.reiter && a.reiter[zustand.stand]) || 0;
			const leuchtenAnzahl = objekte.filter(avesmapsGaretienHatAuswahl).length;
			balanceEl.innerHTML = avesmapsGaretienBalanceZeileText(a.gesamt, basisDesReiters)
				+ (leuchtenAnzahl > 0
					? ' · <span class="lit">✦ ' + leuchtenAnzahl + " leuchten</span>"
					: "");
		}

		const fussEl = document.getElementById("garetien-foot-count");
		if (fussEl) { fussEl.innerHTML = avesmapsGaretienFussZeileMarkup(a.reiter); }

		// Aufgabe 13: die Auswahl ueberlebt einen Listenlauf -- aber nur, solange ihre Zeile in der
		// Ansicht steht. Faellt sie durch Filter oder Reiter heraus, faellt auch die Auswahl: eine
		// Einzelansicht neben einer Liste, in der ihre Zeile gar nicht vorkommt, ist ein Geist -- und
		// ihre Haekchen zeigten auf etwas, das der Editor nicht sehen kann.
		const nochDa = objekte.some(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		});
		if (zustand.detailKey !== null && !nochDa) { zustand.detailKey = null; }
		garetienDetailRendern(objekte);
		garetienAuswahlMarkieren();

		// Aufgabe 12 haengt sich hier ein (Facetten des Filtertrichters) -- optional, damit diese
		// Datei auch OHNE Aufgabe 12 lauffaehig bleibt (typeof wirft nie bei einem unbekannten Namen).
		if (typeof avesmapsGaretienFilterFacettenAktualisieren === "function") {
			avesmapsGaretienFilterFacettenAktualisieren(a.facetten || {});
		}
	}

	// Der EINE Weg, auf dem die Liste sich aendert (Brief). Holt action:'liste' mit dem aktuellen
	// Filter und dem aktuellen Reiter, schreibt Liste/Bilanz/Reiter/Fusszeile neu und ruft
	// avesmapsGaretienKarteZeigen (Aufgabe 14) mit den angehakten Objekten. 🔴 Der Server ist die
	// Wahrheit ueber `selected` -- jede Handlung endet HIERMIT statt mit einer Rechnung im Browser.
	function avesmapsGaretienListeHolen() {
		const filter = zustand.filter || {};
		const stand = zustand.stand || "offen";
		zustand.stand = stand;
		const rumpf = {
			action: "liste",
			run_id: zustand.importRunId,
			ebene: filter.ebene || [],
			typ: filter.typ || [],
			urteil: filter.urteil || [],
			wiki: filter.wiki || [],
			suche: filter.suche || "",
			nur_ungehakt: filter.nur_ungehakt === true,
			nur_mehrteilig: filter.nur_mehrteilig === true,
			stand: stand,
		};
		return avesmapsGaretienRufe(GARETIEN_ENDPUNKT, rumpf).then(function (antwort) {
			zustand.objekte = antwort.objekte || [];
			zustand.letzteAntwort = antwort;
			avesmapsGaretienListeRendern(antwort);
			// Fenster liest §14 defensiv: verschwindet, sobald KarteZeigen (Aufgabe 14) existiert.
			if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteZeigen === "function") {
				window.avesmapsGaretienKarteZeigen(zustand.objekte.filter(avesmapsGaretienHatAuswahl));
			}
			return antwort;
		});
	}

	// ---- Aufgabe 12: der Filtertrichter -------------------------------------------------------------
	//
	// 🔴 .type-filter ist die Hausform (css/features/review-panel.css), verdrahtet ueber den
	// GETEILTEN js/ui/filter-menu.js (avmFilterMenuAttach) -- dieselbe Datei, die auch den
	// "Vorkommen"-Trichter bedient (review-wiki-sync.js). Kein eigenes Menue, keine zweite
	// Menue-Rezeptur. Das Aufklappen ist KEIN neuer Mechanismus: dieselbe `hidden`-Umschaltung.
	// 💣 Der Zustand ist das `hidden` des Panels und SONST NICHTS -- avmFilterMenuAttach traegt
	// keinen zweiten Modulzustand, der auseinanderlaufen kann (dieselbe Lehre wie beim
	// Anzeige-Menue der Karte und den Ansichts-Kacheln).

	// Sechs Abschnitte (Auftrag §5.2): Ebene · Objekttyp · Urteil · Wiki · Nur zeigen (beides in
	// EINEM Mehrfachauswahl-Abschnitt, "ungehakt"/"mehrteilig") · Freitext (das Suchfeld aus
	// Aufgabe 11, ausserhalb der Klappflaeche -- fuer eine Textsuche gibt es keine Optionsliste).
	const garetienFilterState = {
		ebene: new Set(),
		typ: new Set(),
		urteil: new Set(),
		wiki: new Set(),
		nur: new Set(),
	};

	// Die LANGE Beschriftung des Filters ("Ergänzung — sie wissen mehr", Mockup §4) -- die kurze
	// Zeilen-Beschriftung aus Aufgabe 11 (AVESMAPS_GARETIEN_URTEIL_ZEILE) ist eine ANDERE Sache
	// (dort steht sie NEBEN dem Grund, hier steht sie ALLEIN im Trichter und darf erklaeren).
	const AVESMAPS_GARETIEN_URTEIL_FILTER_LABEL = {
		neu: "neu",
		ergaenzung: "Ergänzung — sie wissen mehr",
		zweifel: "Zweifel",
		widerspruch: "widerspricht",
		deckt_sich: "deckt sich",
		uebersprungen: "übersprungen",
	};

	function garetienUrteilFilterLabel(wert) {
		return AVESMAPS_GARETIEN_URTEIL_FILTER_LABEL[wert] || wert;
	}

	// wiki traegt in den Daten den Datenbank-Code ('ggp'/'kosch', s. garetien-plan.php); ein
	// Editor liest lieber den Wirt.
	const AVESMAPS_GARETIEN_WIKI_LABEL = { ggp: "garetien.de", kosch: "koschwiki.de" };

	function garetienWikiLabel(wert) {
		return AVESMAPS_GARETIEN_WIKI_LABEL[wert] || wert;
	}

	function garetienNurZeigenLabel(wert) {
		return wert === "mehrteilig" ? "nur mit mehreren Abschnitten" : "nur ungehakte";
	}

	// REIN: aus den servergelieferten Facetten (Aufgabe 8, VOR dem Filtern gezaehlt) eine
	// Optionsliste fuer avmFilterMenuAttach bauen. 💣 Nimmt NUR das entgegen, was uebergeben wird
	// -- eine Auswahl im Trichter aendert die FACETTEN nicht, sonst faellt nach dem ersten Klick
	// jeder andere Wert auf 0 und der Trichter laesst sich nicht mehr oeffnen.
	function garetienFacettenOptionen(facetten, feld, labelFn) {
		const werte = (facetten && facetten[feld]) || {};
		return Object.keys(werte).sort().map(function (wert) {
			return { value: wert, label: labelFn ? labelFn(wert) : wert, count: werte[wert] };
		});
	}

	// Die "Nur zeigen"-Optionen tragen KEINE Zahl: der Server liefert dafuer keine Facette
	// (garetien-liste.php kennt nur ebene/typ/urteil/wiki, Aufgabe 8) -- eine im Browser
	// nachgerechnete Zahl waere aus einer NUR TEILWEISE geladenen Sicht falsch und damit
	// schlimmer als gar keine (vgl. "keine zweite Rechnung im Browser", globale-vorgaben.md).
	function garetienNurZeigenOptionen() {
		return [
			{ value: "ungehakt", label: garetienNurZeigenLabel("ungehakt") },
			{ value: "mehrteilig", label: garetienNurZeigenLabel("mehrteilig") },
		];
	}

	let garetienLetzteFacetten = { ebene: {}, typ: {}, urteil: {}, wiki: {} };
	let garetienFilterRebuild = null; // die rebuild()-Funktion, die avmFilterMenuAttach zurueckgibt

	function garetienFilterSections() {
		return [
			{
				menuId: "garetien-filter-ebene-menu", kind: "multi", state: garetienFilterState.ebene,
				// 🔴 DIESELBE Beschriftung wie die Ebenen-Kachel im Menueband (Aufgabe 12b). Zwei
				// Schreibweisen fuer denselben Schluessel -- „Gewaesser" hier, „Gewässer" dort --
				// waeren in EINEM Fenster genau die Divergenz, vor der AGENTS.md §11 warnt.
				getOptions: () => garetienFacettenOptionen(garetienLetzteFacetten, "ebene", garetienEbeneLabel),
			},
			{
				menuId: "garetien-filter-typ-menu", kind: "multi", state: garetienFilterState.typ,
				getOptions: () => garetienFacettenOptionen(garetienLetzteFacetten, "typ"),
			},
			{
				menuId: "garetien-filter-urteil-menu", kind: "multi", state: garetienFilterState.urteil,
				getOptions: () => garetienFacettenOptionen(garetienLetzteFacetten, "urteil", garetienUrteilFilterLabel),
			},
			{
				menuId: "garetien-filter-wiki-menu", kind: "multi", state: garetienFilterState.wiki,
				getOptions: () => garetienFacettenOptionen(garetienLetzteFacetten, "wiki", garetienWikiLabel),
			},
			{
				menuId: "garetien-filter-nur-menu", kind: "multi", state: garetienFilterState.nur,
				getOptions: garetienNurZeigenOptionen,
			},
		];
	}

	// REIN: irgendein Abschnitt gewaehlt? Traegt die is-active-Klasse am Umschalt-Knopf (Mockup:
	// "Filter ▾ (2)" + is-active) -- die Zahl IM Knopf schreibt avmFilterMenuAttach schon selbst.
	function garetienFilterIstAktiv(zustandDerAbschnitte) {
		const z = zustandDerAbschnitte || {};
		return ["ebene", "typ", "urteil", "wiki", "nur"].some((feld) => z[feld] && z[feld].size > 0);
	}

	const AVESMAPS_GARETIEN_CHIP_TITEL = {
		ebene: "Ebene", typ: "Objekttyp", urteil: "Urteil", wiki: "Wiki", nur: "Nur zeigen",
	};

	function garetienChipBeschriftung(feld, wert) {
		if (feld === "ebene") { return garetienEbeneLabel(wert); }
		if (feld === "urteil") { return garetienUrteilFilterLabel(wert); }
		if (feld === "wiki") { return garetienWikiLabel(wert); }
		if (feld === "nur") { return garetienNurZeigenLabel(wert); }
		return wert;
	}

	// REIN: ein Chip je AKTIVEM Abschnitt (nicht je Wert -- "Urteil: neu + Ergänzung" ist EIN
	// Chip). Sein ✕ traegt `data-chip-feld`, damit es NUR seinen eigenen Abschnitt zurueeknimmt.
	function garetienChipsMarkup(zustandDerAbschnitte) {
		const z = zustandDerAbschnitte || {};
		return ["ebene", "typ", "urteil", "wiki", "nur"].map((feld) => {
			const menge = z[feld];
			if (!menge || menge.size === 0) { return ""; }
			const werte = Array.from(menge).map((wert) => garetienChipBeschriftung(feld, wert));
			return '<span class="gi-chip">' + avesmapsGaretienEscape(AVESMAPS_GARETIEN_CHIP_TITEL[feld])
				+ ": " + avesmapsGaretienEscape(werte.join(" + "))
				+ '<button type="button" data-chip-feld="' + feld + '" aria-label="Filter entfernen">✕</button></span>';
		}).join("");
	}

	function garetienChipsRendern() {
		if (!hasDocument) { return; }
		const el = document.getElementById("garetien-chips");
		if (el) { el.innerHTML = garetienChipsMarkup(garetienFilterState); }
	}

	function garetienFilterToggleAktivKlasse() {
		if (!hasDocument) { return; }
		const knopf = document.getElementById("garetien-filter-toggle");
		if (knopf) { knopf.classList.toggle("is-active", garetienFilterIstAktiv(garetienFilterState)); }
	}

	// Ein Chip nimmt NUR sein eigenes Feld zurueck (Brief). Einmal verdrahtet (Delegation auf den
	// nie ersetzten Container), egal wie oft garetienChipsRendern sein innerHTML danach ersetzt.
	function garetienChipsVerdrahten() {
		if (!hasDocument) { return; }
		const el = document.getElementById("garetien-chips");
		if (!el || el.dataset.giVerdrahtet === "1") { return; }
		el.dataset.giVerdrahtet = "1";
		el.addEventListener("click", function (ereignis) {
			const knopf = ereignis.target.closest ? ereignis.target.closest("[data-chip-feld]") : null;
			if (!knopf) { return; }
			const feld = knopf.getAttribute("data-chip-feld");
			if (garetienFilterState[feld]) { garetienFilterState[feld].clear(); }
			if (garetienFilterRebuild) { garetienFilterRebuild(); }
			garetienFilterAnwenden();
		});
	}

	// Der applyFilter-Ruf von avmFilterMenuAttach -- jede Aenderung im Trichter landet HIER: die
	// Sets werden zu den Arrays/Booleans, die action:'liste' erwartet, dann EIN frischer Listenlauf
	// (Aufgabe 11 ist der EINE Weg, auf dem die Liste sich aendert).
	function garetienFilterAnwenden() {
		zustand.filter = zustand.filter || {};
		zustand.filter.ebene = Array.from(garetienFilterState.ebene);
		zustand.filter.typ = Array.from(garetienFilterState.typ);
		zustand.filter.urteil = Array.from(garetienFilterState.urteil);
		zustand.filter.wiki = Array.from(garetienFilterState.wiki);
		zustand.filter.nur_ungehakt = garetienFilterState.nur.has("ungehakt");
		zustand.filter.nur_mehrteilig = garetienFilterState.nur.has("mehrteilig");
		garetienChipsRendern();
		garetienFilterToggleAktivKlasse();
		avesmapsGaretienListeHolen();
	}

	function garetienFilterMenuVerdrahten() {
		if (!hasDocument || typeof avmFilterMenuAttach !== "function") { return; }
		garetienFilterRebuild = avmFilterMenuAttach(
			"garetien-filter-toggle", "garetien-filter-menu",
			garetienFilterSections(), garetienFilterAnwenden, "Filter"
		);
		garetienChipsVerdrahten();
	}

	// Von Aufgabe 11 nach jeder frischen liste-Antwort gerufen (defensiv per typeof) -- aktualisiert
	// die Facetten, die zwei dynamischen Abschnittstitel ("Ebene · 18") und die Optionslisten.
	function avesmapsGaretienFilterFacettenAktualisieren(facetten) {
		garetienLetzteFacetten = facetten || { ebene: {}, typ: {}, urteil: {}, wiki: {} };
		if (!hasDocument) { return; }
		if (!garetienFilterRebuild) { garetienFilterMenuVerdrahten(); }
		const ebeneTitel = document.getElementById("garetien-filter-ebene-title");
		if (ebeneTitel) {
			ebeneTitel.textContent = "Ebene · " + Object.keys(garetienLetzteFacetten.ebene || {}).length;
		}
		const typTitel = document.getElementById("garetien-filter-typ-title");
		if (typTitel) {
			typTitel.textContent = "Objekttyp · " + Object.keys(garetienLetzteFacetten.typ || {}).length;
		}
		if (garetienFilterRebuild) { garetienFilterRebuild(); }
	}

	// ---- Aufgabe 12b: das Menüband -- die zwei Kacheln ---------------------------------------------
	//
	// Ohne diese Hälfte bliebe `zustand.importRunId` für immer `null`, `action:'liste'` liefe in
	// 400 `no_run`, und das Fenster könnte keine einzige Zeile zeigen. Das Menüband ist der
	// Schalter, der alles davor Gebaute in Gang setzt.
	//
	// 🔴 Der Zustand steht IN der Kachel (`.avm-tile` mit `.t1`/`.t2`, Hausform aus
	// css/components/editor-body.css) -- Vorbilder „Dump holen — Lauf: 15.08." und „Zugehörigkeit
	// rechnen". Ein Zustand, den man aufklappen muss, ist keiner.
	// ⚠️ KEIN `avesmapsRibbonMenuAttach` (js/ui/ribbon-menu.js): das ist das SAMMELmenü für
	// Kacheln, und seine Hausregel lautet ausdrücklich „nichts unter drei Einträgen" (AGENTS.md
	// §11). Zwei Kacheln stehen nebeneinander, sie klappen nicht auf.

	// Die 18 Ebenen aus `action:'ebenen'`. Der Bezeichner ist `wiki + ':' + ebene` -- genau die
	// Form, die `action:'fetch'` entgegennimmt.
	// ⚠️ Das `url`-Feld der Antwort reist bewusst NICHT mit: die Adresse wählt der Server aus
	// seiner festen Liste. Ein Endpunkt, der eine Adresse vom Aufrufer annähme, wäre ein
	// SSRF-Werkzeug -- garetien-import.php schreibt das an seiner `probe` ausdrücklich hin.
	let garetienAlleEbenen = [];
	let garetienEbenenGeholt = false;
	let garetienEbenenRebuild = null;

	// 🔴 LEER HEISST NICHTS -- nicht „alle", obwohl der geteilte Trichter genau das bedeutet
	// („leer = alle", sein „Alle"-Haken leert diese Menge). Das ist hier bewusst anders, weil das
	// Menü etwas anderes ist: eine AUSWAHL VON ARBEIT, kein Filter. Wer alles abwählt, sagt
	// „nichts" -- und „alle 18" zöge rund 8300 Zeilen über 18 Seiten ins Staging, darunter genau
	// die Objektarten, deren Übernahme-Tor noch gar nicht gebaut ist. Ein Klick, der ungeplant den
	// halben Bestand stagt, ist die teure Richtung (Owner-Entscheid 28.08.2026).
	// ⚠️ Der Preis: der „Alle"-Haken wird damit zum ABWÄHLEN. Deshalb ist ein leerer Zustand kein
	// stiller: „Holen & Rechnen" sperrt und sagt in seiner zweiten Zeile, warum -- ein gesperrter
	// Knopf MIT Begründung ist eine Auskunft, keine Stilllegung.
	// Die Vorgabe: die zwei Gewässerseiten, Stufe 1, das einzige gemessene und abgenommene Stück.
	const garetienEbenenAuswahl = new Set(["ggp:Gewaesser", "kosch:Gewaesser"]);

	// 💣 DER RIEGEL GEGEN DEN ZWEITEN LAUF, und er ist ein MODULZUSTAND -- keine CSS-Klasse und
	// nicht das `disabled` des Knopfes. Eine an der Klasse gelesene Weiche wirkt nicht, weil die
	// Klasse erst im nächsten Bild steht; daran sind in diesem Projekt schon das Anzeige-Menü und
	// die Ansichts-Kachel gescheitert (AGENTS.md §11). Das `disabled` unten ist die ANZEIGE des
	// Riegels, nie der Riegel.
	// ⚠️ Warum er zählt: `fetch` holt bis zu 18 fremde Seiten samt Höflichkeitspause, `plan`
	// rechnet 0,35 s je 289 Zeilen. Startet ein zweiter Klick einen zweiten Import-Lauf, weiß der
	// Abgleich hinterher nicht mehr, was zusammengehört -- Datenschaden, kein Anzeigefehler.
	let garetienLaufLaeuft = false;
	let garetienLetzterLauf = null;    // die Zeile aus `action:'runs'` (id, started_at, zeilen, …)
	let garetienLaufSchritt = "";      // „holt 2 Ebenen …" / „rechnet …", während es läuft
	let garetienLaufMeldung = "";      // ein harter Fehler; bleibt bis zum nächsten Versuch stehen
	let garetienRechenDauerMs = null;  // GEMESSEN, und nur für einen Lauf DIESER Sitzung
	let garetienEbenenFehler = [];     // `fehler[]` aus `action:'fetch'` -- Ebenen ohne Antwort

	// Die Ebenen-Schlüssel sind stabile Kennungen (`Gewaesser`, `Waelder`, `Ortschaften_1`) und
	// bleiben es -- sie stecken im Bezeichner `wiki:ebene`, den der Endpunkt entgegennimmt. Nur die
	// BESCHRIFTUNG wird lesbar gemacht (Mockup §1: „Gewässer ggp + kosch"). Dieselbe Trennung wie
	// bei ggp/garetien.de eine Ebene weiter oben.
	const AVESMAPS_GARETIEN_EBENE_LABEL = { Gewaesser: "Gewässer", Waelder: "Wälder" };

	function garetienEbeneLabel(ebene) {
		const wert = String(ebene === null || ebene === undefined ? "" : ebene);
		return AVESMAPS_GARETIEN_EBENE_LABEL[wert] || wert.replace(/_/g, " ");
	}

	function garetienEbenenBezeichner(eintrag) {
		return String((eintrag && eintrag.wiki) || "") + ":" + String((eintrag && eintrag.ebene) || "");
	}

	// REIN: welche Bezeichner gehen wirklich an `action:'fetch'`? Diese EINE Rechnung füttert den
	// Abruf UND die zweite Zeile der Kachel -- „was wird geholt" und „was steht da" dürfen nicht
	// zwei Rechnungen sein.
	// 🔴 Eine leere Auswahl ergibt eine LEERE Liste (siehe oben) -- kein „also alle".
	// ⚠️ Solange die Ebenenliste noch nicht da ist (oder ihr Abruf scheiterte), gilt die Auswahl
	// unverändert -- sonst holte ein Klick in dieser Lücke gar nichts und sähe wie ein toter Knopf aus.
	function garetienGewaehlteBezeichner(auswahl, alleEbenen) {
		const alle = (alleEbenen || []).map(garetienEbenenBezeichner);
		const gewaehlt = Array.from(auswahl || []);
		if (alle.length === 0) { return gewaehlt; }
		// Die Reihenfolge der festen Serverliste, nicht die der Anklickerei.
		return alle.filter(function (bezeichner) { return gewaehlt.indexOf(bezeichner) !== -1; });
	}

	// REIN: die zweite Zeile der Ebenen-Kachel. „2 von 18 · Gewässer ggp + kosch" (Mockup §1) --
	// gruppiert nach EBENE, weil dieselbe Ebene in beiden Wikis der Normalfall ist.
	// ⚠️ Die kurzen Codes ggp/kosch stehen hier mit Absicht (so das Mockup): in einer 11px-Zeile
	// ist kein Platz für „garetien.de + koschwiki.de", und der Trichter im Menü daneben trägt die
	// lange Form. Nicht zu garetienWikiLabel „korrigieren".
	function garetienEbenenKachelText(bezeichner, alleEbenen) {
		const alle = alleEbenen || [];
		const gewaehlt = bezeichner || [];
		if (alle.length === 0) { return gewaehlt.length + " gewählt"; }
		// 🔴 Der leere Zustand ist erlaubt und wird BENANNT -- er sperrt die Nachbarkachel.
		if (gewaehlt.length === 0) { return "0 von " + alle.length + " · keine gewählt"; }
		if (gewaehlt.length === alle.length) { return alle.length + " von " + alle.length + " · alle"; }
		const gruppen = [];
		alle.forEach(function (eintrag) {
			if (gewaehlt.indexOf(garetienEbenenBezeichner(eintrag)) === -1) { return; }
			const treffer = gruppen.filter(function (g) { return g.ebene === eintrag.ebene; })[0];
			if (treffer) { treffer.wikis.push(eintrag.wiki); }
			else { gruppen.push({ ebene: eintrag.ebene, wikis: [eintrag.wiki] }); }
		});
		return gewaehlt.length + " von " + alle.length + " · "
			+ gruppen.map(function (g) {
				return garetienEbeneLabel(g.ebene) + " " + g.wikis.join(" + ");
			}).join(" · ");
	}

	// REIN: die 18 Ebenen als Optionsliste für avmFilterMenuAttach. Wert = der Bezeichner, den der
	// Endpunkt erwartet; Beschriftung = „Gewässer · garetien.de" (im Menü ist Platz für die lange
	// Form, und dieselbe Wiki-Beschriftung trägt schon der Filtertrichter).
	function garetienEbenenOptionenAus(alleEbenen) {
		return (alleEbenen || []).map(function (eintrag) {
			return {
				value: garetienEbenenBezeichner(eintrag),
				label: garetienEbeneLabel(eintrag.ebene) + " · " + garetienWikiLabel(eintrag.wiki),
			};
		});
	}

	// REIN: der Zeitstempel eines Laufs, kurz. „27.08., 12:04" -- mit dem „Lauf " davor ergibt das
	// die Zeile des Mockups.
	// 🪤 `started_at`/`finished_at` sind MySQL-DATETIME ohne Zone; `new Date()` liest sie als
	// LOKALE Zeit. Dieselbe Ungenauigkeit wie bei „Dump holen — Lauf: 15.08." nebenan
	// (formatWikiSyncDumpRunStatusText) und bewusst gleich gehalten: zwei Angaben, die verschieden
	// rechnen, wären schlimmer als beide gleich ungenau.
	function garetienLaufStempel(lauf) {
		const roh = String((lauf && (lauf.finished_at || lauf.started_at)) || "");
		if (roh === "") { return "unbekannt"; }
		const datum = new Date(roh.replace(" ", "T"));
		if (Number.isNaN(datum.getTime())) { return roh; }
		return datum.toLocaleString("de-DE", {
			day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
		});
	}

	// REIN: die zweite Zeile der Lauf-Kachel. Vier Lagen, in dieser Reihenfolge -- ein harter
	// Fehler (steht bis zum nächsten Versuch) · es läuft gerade · kein Lauf da · der geltende Lauf.
	// 🔴 Die Rechendauer kennen wir NUR für einen Lauf dieser Sitzung: `action:'runs'` liefert
	// keine. Für einen älteren Lauf steht deshalb seine Zeilenzahl da -- auch eine Tatsache, nur
	// eine andere -- statt einer erfundenen Sekundenzahl. (Der Brief zeigt die Zeile im Zustand
	// direkt nach einem Lauf; „0,35 s" ist dort das Gemessene, nicht das Gespeicherte.)
	function garetienLaufKachelText(lage) {
		const l = lage || {};
		if (l.laeuft) { return l.schritt || "läuft …"; }
		// 🔴 Der Grund der Sperre schlägt eine stehengebliebene Fehlermeldung: sie berichtet vom
		// LETZTEN Versuch, die Sperre gilt JETZT und sagt, was zu tun ist. Ein gesperrter Knopf
		// ohne Begründung wäre eine Stilllegung -- mit ihr ist er eine Auskunft.
		if (l.ohneEbenen) { return "keine Ebene gewählt"; }
		if (l.meldung) { return String(l.meldung); }
		if (!l.lauf) { return "noch kein Lauf"; }
		const teile = ["Lauf " + garetienLaufStempel(l.lauf)];
		if (typeof l.dauerMs === "number" && isFinite(l.dauerMs)) {
			teile.push((l.dauerMs / 1000).toFixed(2).replace(".", ",") + " s");
		} else {
			teile.push(Number(l.lauf.zeilen || 0) + " Zeilen");
		}
		// Eine Ebene ohne Antwort bricht den Lauf NICHT ab (der Endpunkt sammelt sie in `fehler[]`
		// und stempelt den Lauf auf 'partial') -- aber sie muss dastehen, sonst hält der Editor
		// einen halben Lauf für einen ganzen.
		const fehler = (l.fehler || []).length;
		if (fehler > 0) {
			teile.push(fehler + (fehler === 1 ? " Ebene ohne Antwort" : " Ebenen ohne Antwort"));
		}
		return teile.join(" · ");
	}

	// REIN: das Menüband. Zwei Kacheln, gleich breit (`.avm-ribbon` ist ein Raster mit
	// `grid-auto-columns: minmax(0, 1fr)`).
	// 💣 Die zweite Kachel IST der Umschalter des geteilten Trichters und trägt deshalb
	// `data-avm-eigene-beschriftung`: ohne dieses Attribut überschreibt dessen `rebuild()` beim
	// ERSTEN Aufruf `.t1`/`.t2` mit einer einzeiligen Filterbeschriftung -- die zweizeilige
	// Kachelform wäre lautlos weg. Die Alternative wäre eine zweite Menü-Rezeptur gewesen.
	function garetienMenuebandMarkup() {
		return '<button class="avm-tile" type="button" id="garetien-run-tile">'
			+ '<span class="t1">Holen &amp; Rechnen</span>'
			+ '<span class="t2" id="garetien-run-state"></span>'
			+ "</button>"
			+ '<div class="type-filter">'
			+ '<button class="avm-tile type-filter__toggle" type="button" id="garetien-ebenen-toggle"'
			+ ' data-avm-eigene-beschriftung>'
			+ '<span class="t1">Ebenen</span>'
			+ '<span class="t2" id="garetien-ebenen-state"></span>'
			+ "</button>"
			+ '<div class="type-filter__menu" id="garetien-ebenen-menu" hidden>'
			+ '<div id="garetien-ebenen-optionen"></div>'
			+ "</div>"
			+ "</div>";
	}

	function garetienLaufKachelAktualisieren() {
		if (!hasDocument) { return; }
		// Die Sperre hat ZWEI Gründe, und beide werden aus DERSELBEN Rechnung gelesen wie die
		// Nachbarkachel -- „was wird geholt" steht nur an einer Stelle.
		const ohneEbenen = garetienGewaehlteBezeichner(garetienEbenenAuswahl, garetienAlleEbenen).length === 0;
		const zeile = document.getElementById("garetien-run-state");
		if (zeile) {
			zeile.textContent = garetienLaufKachelText({
				laeuft: garetienLaufLaeuft,
				schritt: garetienLaufSchritt,
				ohneEbenen: ohneEbenen,
				meldung: garetienLaufMeldung,
				lauf: garetienLetzterLauf,
				dauerMs: garetienRechenDauerMs,
				fehler: garetienEbenenFehler,
			});
		}
		const knopf = document.getElementById("garetien-run-tile");
		// Nur die ANZEIGE der Riegel -- der Doppelklick-Riegel selbst ist `garetienLaufLaeuft`
		// (siehe dort), und der leere Zustand wird in garetienLaufStarten noch einmal geprüft.
		if (knopf) { knopf.disabled = garetienLaufLaeuft || ohneEbenen; }
	}

	// Beide Kacheln in einem Zug -- die Auswahl steuert die eine und sperrt die andere.
	function garetienMenuebandKachelnAktualisieren() {
		garetienEbenenKachelAktualisieren();
		garetienLaufKachelAktualisieren();
	}

	function garetienEbenenKachelAktualisieren() {
		if (!hasDocument) { return; }
		const zeile = document.getElementById("garetien-ebenen-state");
		if (zeile) {
			zeile.textContent = garetienEbenenKachelText(
				garetienGewaehlteBezeichner(garetienEbenenAuswahl, garetienAlleEbenen),
				garetienAlleEbenen
			);
		}
	}

	// Die feste Ebenenliste, einmal je Sitzung. 🔴 Fällt OFFEN aus: scheitert der Abruf, bleibt die
	// Vorgabe stehen und „Holen & Rechnen" arbeitet weiter -- nur das Menü ist dann leer. Ein
	// geschlossener Ausfall hier hieße: der Importer lässt sich gar nicht mehr starten.
	function garetienEbenenListeSicherstellen() {
		if (garetienEbenenGeholt) { return Promise.resolve(garetienAlleEbenen); }
		garetienEbenenGeholt = true;
		return avesmapsGaretienRufe(GARETIEN_ENDPUNKT, { action: "ebenen" }).then(function (antwort) {
			garetienAlleEbenen = (antwort.ebenen || []).map(function (eintrag) {
				return { wiki: eintrag.wiki, ebene: eintrag.ebene };
			});
			if (garetienEbenenRebuild) { garetienEbenenRebuild(); }
			// Beide: mit der Liste entscheidet sich auch, ob die Auswahl überhaupt auf etwas zeigt.
			garetienMenuebandKachelnAktualisieren();
			return garetienAlleEbenen;
		}).catch(function () {
			garetienEbenenGeholt = false;   // ein späterer Versuch darf es noch einmal probieren
			return garetienAlleEbenen;
		});
	}

	// Die Laufliste holen und einen davon übernehmen. `bevorzugt` ist die id, die gerade entstanden
	// ist (nach „Holen & Rechnen"); ohne sie gilt der jüngste.
	function garetienLaufUebernehmen(rufe, bevorzugt) {
		return rufe(GARETIEN_ENDPUNKT, { action: "runs" }).then(function (antwort) {
			const laeufe = antwort.runs || [];
			// 🔴 `runs` kommt absteigend nach id (garetien-abruf.php: `ORDER BY r.id DESC`) --
			// laeufe[0] IST der jüngste. Keine eigene Sortierung im Browser.
			let gewaehlt = laeufe.length ? laeufe[0] : null;
			if (bevorzugt) {
				// ⚠️ Gesucht, nicht `laeufe[0]` geglaubt: ein Abruf über 18 Seiten dauert, und ein
				// zweiter Admin kann in dieser Zeit einen neueren Lauf angelegt haben. Dann gehörte
				// der jüngste nicht zu dem, was hier gerade gerechnet wurde.
				const treffer = laeufe.filter(function (l) {
					return Number(l.id) === Number(bevorzugt);
				})[0];
				if (treffer) { gewaehlt = treffer; }
			}
			garetienLetzterLauf = gewaehlt;
			zustand.importRunId = gewaehlt ? (Number(gewaehlt.id) || null) : null;
			return gewaehlt;
		});
	}

	// 🔴 Der Ablauf nimmt seine Werkzeuge HEREIN (Rufer, Kachelschreiber, Listenauffrischung).
	// Nicht der Eleganz wegen: nur so lässt sich der Riegel am ERGEBNIS messen -- der Test fährt
	// ihn mit einem Spion und zählt, wie oft `action:'fetch'` wirklich hinausging (zwei Klicks →
	// EINS). Eine Zusicherung, die bloß die Anwesenheit eines `if` im Quelltext behauptet, wäre
	// Vakuum; genau diese Fehlerklasse hat dieses Vorhaben mehrfach bezahlt.
	function garetienLaufStarten(rufe, ebenen, malen, listeHolen) {
		// 💣 DER RIEGEL, vor jedem anderen Schritt.
		if (garetienLaufLaeuft) { return Promise.resolve(null); }
		// 🔴 Und der zweite Riegel: OHNE gewählte Ebene wird nichts geholt. Er steht hier und nicht
		// nur am `disabled` des Knopfes -- `disabled` ist die Anzeige, nicht der Riegel, und der
		// Endpunkt beantwortete eine leere Liste sonst mit 400 `no_layers`, was im Netz-Protokoll
		// wie ein Defekt aussieht statt wie „du hast nichts angehakt".
		// ⚠️ Er nimmt den Doppelklick-Riegel NICHT: es gibt nichts freizugeben.
		if (!ebenen || ebenen.length === 0) { malen(); return Promise.resolve(null); }
		garetienLaufLaeuft = true;
		garetienLaufMeldung = "";
		garetienEbenenFehler = [];
		garetienRechenDauerMs = null;
		garetienLaufSchritt = "holt " + ebenen.length + (ebenen.length === 1 ? " Ebene …" : " Ebenen …");
		malen();
		// 🔴 KEIN `run_id` an `fetch`: der Endpunkt SETZT einen genannten Lauf FORT. Ein neues
		// „Holen & Rechnen" ist ein neuer Lauf, sonst wächst der alte weiter und der Abgleich
		// mischt zwei Importe. Die gewählten Ebenen werden trotzdem EIN Lauf, weil `fetch` die
		// ganze Liste in EINEM Ruf entgegennimmt und selbst darüber läuft -- 18 Seiten, ein Lauf.
		return rufe(GARETIEN_ENDPUNKT, { action: "fetch", ebenen: ebenen })
			.then(function (antwort) {
				zustand.importRunId = Number(antwort.run_id) || null;
				garetienEbenenFehler = antwort.fehler || [];
				garetienLaufSchritt = "rechnet …";
				malen();
				const begonnen = Date.now();
				return rufe(GARETIEN_ENDPUNKT, { action: "plan", run_id: zustand.importRunId })
					.then(function (plan) {
						garetienRechenDauerMs = Date.now() - begonnen;
						zustand.planRunId = Number(plan.plan_run_id) || null;
						// Zeitstempel und Zeilenzahl kommen vom SERVER, nicht aus der Browseruhr.
						return garetienLaufUebernehmen(rufe, zustand.importRunId);
					})
					.then(function () { return listeHolen(); });
			})
			.catch(function (fehler) {
				garetienLaufMeldung = (fehler && fehler.message) || "Der Lauf ist fehlgeschlagen.";
				return null;
			})
			// 🔴 Der Riegel geht IMMER wieder auf -- Erfolg wie Fehler, deshalb `finally` und nicht
			// `then`. Ein Knopf, der nach einem Netzfehler für immer tot ist, ist schlimmer als ein
			// doppelter Lauf.
			.finally(function () {
				garetienLaufLaeuft = false;
				garetienLaufSchritt = "";
				malen();
			});
	}

	function avesmapsGaretienHolenUndRechnen() {
		return garetienLaufStarten(
			avesmapsGaretienRufe,
			garetienGewaehlteBezeichner(garetienEbenenAuswahl, garetienAlleEbenen),
			garetienLaufKachelAktualisieren,
			avesmapsGaretienListeHolen
		);
	}

	// Einmalig: Kacheln bauen, Klick und Trichter verdrahten. 💣 Danach wird das `innerHTML` des
	// Menübands NIE wieder ersetzt -- avmFilterMenuAttach hängt seine Zuhörer an die Knopf- und
	// Panel-ELEMENTE, und ein Neuaufbau risse sie unter dem Zeiger weg (dieselbe Falle wie beim
	// Listenskelett aus Aufgabe 11).
	function garetienMenuebandSicherstellen() {
		if (!hasDocument) { return null; }
		const band = document.getElementById("garetien-ribbon");
		if (!band) { return null; }
		if (band.dataset.giBand === "1") { return band; }
		band.innerHTML = garetienMenuebandMarkup();
		band.dataset.giBand = "1";
		const laufKnopf = document.getElementById("garetien-run-tile");
		if (laufKnopf) {
			laufKnopf.addEventListener("click", function () { avesmapsGaretienHolenUndRechnen(); });
		}
		if (typeof avmFilterMenuAttach === "function") {
			garetienEbenenRebuild = avmFilterMenuAttach(
				"garetien-ebenen-toggle", "garetien-ebenen-menu",
				[{
					menuId: "garetien-ebenen-optionen", kind: "multi", state: garetienEbenenAuswahl,
					getOptions: function () { return garetienEbenenOptionenAus(garetienAlleEbenen); },
				}],
				// ⚠️ Eine Änderung an der Ebenenauswahl holt die LISTE NICHT neu: sie sagt, was der
				// NÄCHSTE Abruf holt, sie filtert nichts am geltenden Lauf. Wer hier
				// avesmapsGaretienListeHolen anhängt, baut einen Abruf ohne Wirkung ein.
				// 💣 Sie zieht aber BEIDE Kacheln nach: die Sperre der Nachbarkachel hängt an
				// derselben Auswahl, und ein Knopf, der erst beim nächsten Öffnen merkt, dass
				// nichts mehr angehakt ist, ist genau der Zustand, den dieser Riegel verhindert.
				garetienMenuebandKachelnAktualisieren, "Ebenen"
			);
		}
		garetienMenuebandKachelnAktualisieren();
		return band;
	}

	// ---- Aufgabe 13: die Einzelansicht -- das Herzstück ------------------------------------------
	//
	// Owner 27.08.2026, wörtlich: „wir wollen sehen welche Abschnitte das sind. Wir wollen DEREN
	// Objekt und UNSER Objekt SEHEN." Genau das steht hier: unsere Abschnitte an derselben Stelle,
	// jeder mit eigenem Häkchen, jeder mit dem, was an ihm geschähe.
	//
	// 🔴 SIE RECHNET NICHTS NACH (Auftrag §5.4). Urteil, Grund, Deckung und die getroffenen
	// Abschnitte kommen fertig aus action:'liste'; die Lage einer Abschnittszeile kommt aus
	// `after.felder` und `after.anlass` des Items, nicht aus einem Vergleich im Browser.
	// 🔴 UND SIE HOLT NICHTS NACH. Alles, was hier steht, steht schon im Objekt der Liste -- ein
	// zweiter Ruf je angeklickter Zeile wäre bei 289 Zeilen ein Abruf je Blick.
	//
	// 🚩 DREI FELDER DES MOCKUPS FEHLEN IN DER ANTWORT VON action:'liste' und werden deshalb hier
	//    NICHT gezeigt (Serverbefund an Aufgabe 8, nicht an dieser Datei -- der Bericht zu Aufgabe
	//    13 trägt die Einzelheiten):
	//      · `after.quelle` (label/attribution/license) -- der Abschnitt „Die Quelle, die mitreist"
	//        des Mockups. avesmapsGaretienArbeitsliste zieht daraus nur `.url` heraus.
	//      · `after.subtyp` -- der Kopf zeigt darum „Fluss" statt „Fluss → Flussweg".
	//      · `namensraum:artikel` -- der Wiki-Link trägt deshalb die feste Beschriftung
	//        „Wiki-Artikel" und die Adresse im `title`, statt „Garetien:Natter".
	//    Alle drei aus dem `after` nachzubilden wäre die zweite Wahrheit, die §5.4 verbietet: die
	//    Wirt-Literale und die `$namensraum:$artikel`-Bildung stehen bewusst an EINER Stelle
	//    (avesmapsGaretienSeitenUrlAusZeile, Review I2 der Aufgabe 3).

	// REIN: die Items, die zu EINEM Abschnitt gehören und sein Häkchen betreffen.
	//
	// 💣 Das Geometrie-Item gehört NICHT dazu. Es hat seinen eigenen Knopf („Geometrie ersetzen …",
	// Aufgabe 15) und startet immer ungehakt; zählte es mit, stünde die Alke des Mockups (§6a)
	// DREIWERTIG da, obwohl an ihr nichts halb ist -- sie ist ein einzelner namenloser Abschnitt,
	// und für jedes Objekt mit genau einem Abschnitt legt garetien-plan.php ein Geometrie-Item an.
	// Das Häkchen des Abschnitts ist das aus Auftrag §5.3.3: „je Abschnitt ein Häkchen für
	// ‚Namen übernehmen'".
	function garetienAbschnittsItems(objekt, publicId) {
		const items = (objekt && objekt.items) || [];
		return items.filter(function (item) {
			const abschnitt = item && item.abschnitt;
			if (!abschnitt || String(abschnitt.public_id || "") !== String(publicId)) { return false; }
			return item.anlass === "ergaenzung" || item.anlass === "umbenennung";
		});
	}

	// REIN: die Felder, die diese Items zusammen schreiben würden -- als Menge, nicht als Liste.
	function garetienAbschnittsFelder(items) {
		const felder = {};
		(items || []).forEach(function (item) {
			((item && item.felder) || []).forEach(function (feld) { felder[String(feld)] = true; });
		});
		return felder;
	}

	// REIN: die Lage einer Abschnittszeile -- „nichts" · „ueberschreiben" · „luecke".
	// 🔴 Sie kommt aus `after.anlass`, nicht aus einem Namensvergleich im Browser: WARUM etwas
	// überschrieben würde, hat der Abgleich entschieden (garetien-abgleich.php), und ein deutscher
	// Satz oder ein nachgebauter Namensvergleich wäre die zweite Fassung derselben Entscheidung.
	function garetienAbschnittsLage(items) {
		if (!items || items.length === 0) { return "nichts"; }
		return items.some(function (item) { return item.anlass === "umbenennung"; })
			? "ueberschreiben"
			: "luecke";
	}

	// REIN: was in der Zeile steht. Die vier Lagen aus dem Brief, jede an ihrer Beschriftung
	// erkennbar -- eine Klasse ohne Text sagt einem Editor nichts.
	function garetienAbschnittsBeschriftung(lage, felder) {
		if (lage === "nichts") { return "nichts zu ersetzen"; }
		if (lage === "ueberschreiben") { return "⚠ Name weicht ab"; }
		if (felder.name && felder.quelle) { return "Name + Quelle"; }
		if (felder.name) { return "Name fehlt"; }
		if (felder.quelle) { return "Quelle fehlt"; }
		return "offen";
	}

	// REIN: „1 Punkt" / „9 Punkte" -- und dieselbe Faustregel für die Abschnitte.
	function garetienAnzahlText(anzahl, einzahl, mehrzahl) {
		return String(anzahl) + " " + (Number(anzahl) === 1 ? einzahl : mehrzahl);
	}

	// REIN: eine Zahl in Hausform -- Komma statt Punkt, zwei Nachkommastellen (dieselbe Form wie
	// die Laufdauer im Menüband). Nichts wird gerechnet, nur geschrieben.
	function garetienZahlText(wert) {
		return Number(wert).toFixed(2).replace(".", ",");
	}

	// REIN: die Punktzahl EINES Abschnitts. Mit bekanntem Nenner „9 von 16 Punkten", ohne ihn
	// „9 Punkte" -- beide Formen stehen so im Mockup (§3 und §6a).
	// 🔴 Der Nenner kommt vom SERVER (`objekt.probepunkte`) und wird NICHT aus `objekt.geometrie`
	// abgelesen: der Abgleich dünnt ihre Stützpunkte auf höchstens AVESMAPS_GARETIEN_PROBEPUNKTE
	// aus, und ihr Großer Fluss trägt 294 davon -- „9 von 294" wäre schlicht falsch.
	// ⚠️ 0 heißt „nicht gemessen" (ein Lauf von vor dem Nachzug), nicht „null Punkte": dann fällt
	// die Angabe weg, statt eine erfundene Zahl zu behaupten.
	function garetienPunkteText(punkte, nenner) {
		const gesamt = Number(nenner || 0);
		return gesamt > 0
			? String(Number(punkte || 0)) + " von " + gesamt + " Punkten"
			: garetienAnzahlText(Number(punkte || 0), "Punkt", "Punkte");
	}

	// REIN: der Kopf-Zusatz „Fluss → Flussweg" -- IHR Typ und die Art, als die WIR es anlegen
	// würden. Ohne den zweiten Teil sagt der Kopf nicht, was beim Übernehmen entstünde.
	// ⚠️ Fehlt der Zielsubtyp (ein Objekt ohne Vorschlag, ein Lauf von vor dem Nachzug), steht nur
	// ihr Typ da -- die Zeile fällt weg, sie steht nicht mit einem leeren Pfeil da.
	function garetienTypText(objekt) {
		const ihr = String((objekt && objekt.typ) || "").trim();
		const unser = String((objekt && objekt.subtyp) || "").trim();
		if (unser === "" || unser === ihr) { return ihr; }
		return ihr === "" ? unser : ihr + " → " + unser;
	}

	// REIN: wie viele VERSCHIEDENE Objekte von uns liegen unter ihrem einen?
	//
	// 🔴 Gleiche Namen sind EIN Objekt (Barun-Ulah trägt seinen Namen siebenmal), ein NAMENLOSER
	// Abschnitt zählt für sich. Das zweite ist die vorsichtige Richtung und der Grund, warum es
	// die Einzelansicht gibt: der namenlose 6120 unter ihrer Natter liegt auf dem Darpat -- ihn
	// stillschweigend zur Natter zu zählen wäre genau der Fehler, den ein Editor hier sehen soll.
	// ⚠️ Verwandt mit avesmapsGaretienEinObjekt (garetien-plan.php), aber NICHT dieselbe Frage:
	// dort geht es um „darf umbenannt werden" (nur die benannten zählen), hier um „wie viele
	// Dinge liegen da" (die namenlosen zählen mit, denn sie sind Dinge).
	function garetienAbschnittsGruppen(abschnitte) {
		const namen = {};
		let ohneNamen = 0;
		(abschnitte || []).forEach(function (abschnitt) {
			const name = String((abschnitt && abschnitt.name) || "").trim();
			if (name === "") { ohneNamen++; } else { namen[name] = true; }
		});
		const benannt = Object.keys(namen).length;
		return { gesamt: benannt + ohneNamen, benannt: benannt, ohneNamen: ohneNamen };
	}

	// REIN: EINE Abschnittszeile. 🔴 `.gi-seg` ist KEINE dritte Listenrezeptur -- sie steht nicht
	// in einer Liste von Objekten, sondern INNERHALB der Einzelansicht EINES Objekts, so wie
	// `.diff` im Übernahme-Blatt innerhalb einer Zeile steht (Mockup §5).
	// 💣 Das Wurzelelement ist ein `<label>`, wenn etwas anzuhaken ist -- anders als die
	// Listenzeile, und mit Absicht: hier IST der Zeilenklick der Häkchenklick, es gibt keine
	// zweite Handlung, die er verdecken könnte.
	function garetienAbschnittMarkup(objekt, abschnitt) {
		const a = abschnitt || {};
		const publicId = String(a.public_id || "");
		const items = garetienAbschnittsItems(objekt, publicId);
		const lage = garetienAbschnittsLage(items);
		const felder = garetienAbschnittsFelder(items);
		// Dasselbe dreiwertige Häkchen wie in der Listenzeile -- avesmapsGaretienCheckboxZustand
		// ist die EINE Regel dafür; eine zweite Fassung liefe beim ersten halben Abschnitt
		// auseinander. `data-part` löst avesmapsGaretienListeRendern nach dem Einfügen ein.
		const haken = avesmapsGaretienCheckboxZustand({ items: items });

		let hakenAttribute = "";
		if (haken.checked) { hakenAttribute += " checked"; }
		if (haken.disabled) { hakenAttribute += " disabled"; }
		if (haken.dreiwertig) { hakenAttribute += " data-part"; }

		const unserName = String(a.name || "").trim();
		const nameMarkup = unserName === ""
			? '<span class="gi-seg__name is-empty">ohne Namen</span>'
			: '<span class="gi-seg__name">' + avesmapsGaretienEscape(unserName) + "</span>";

		// Der Pfeil steht NUR, wenn wirklich ein Name geschrieben würde. Ohne 'name' in `felder`
		// behauptete er eine Umbenennung, die gar nicht ausgeführt wird -- dieselbe Falle, die
		// garetien-plan.php mit `unset($eintrag['after']['name'])` schon einmal geschlossen hat.
		let kennung = avesmapsGaretienEscape(publicId)
			+ " · " + garetienPunkteText(a.punkte, objekt && objekt.probepunkte);
		if (felder.name) {
			kennung += ' · <span class="gi-seg__to">→ „'
				+ avesmapsGaretienEscape(String((objekt && objekt.name) || "")) + '"</span>';
		}
		// Der Vergleichsbefund des Abgleichs. 🔴 Er kommt fertig vom Server (`name_gleich` an der
		// gespeicherten Trefferliste) und wird hier NICHT nachgerechnet: ob zwei Namen „derselbe"
		// sind, entscheidet avesmapsGaretienNamenAehnlich -- dieselbe Regel, die über das
		// Umbenennungs-Item entscheidet. Ein zweiter Vergleich im Browser schriebe „Name gleich"
		// an eine Zeile, die trotzdem eine Umbenennung anbietet.
		// ⚠️ NUR bei `true`. `false` ist der Normalfall und stünde sonst an fast jeder Zeile; ein
		// fehlendes Feld (alter Lauf) ist gar keine Auskunft und darf keine erfinden.
		if (a.name_gleich === true) {
			kennung += " · Name gleich";
		}

		const klassen = "gi-seg" + (lage === "nichts" ? " is-full" : "")
			+ (lage === "ueberschreiben" ? " is-overwrite" : "");
		const tag = lage === "nichts" ? "span" : "label";
		return "<" + tag + ' class="' + klassen + '" data-seg="' + avesmapsGaretienEscape(publicId) + '">'
			+ '<input type="checkbox"' + hakenAttribute + ">"
			+ nameMarkup
			+ '<span class="gi-seg__gap">'
			+ avesmapsGaretienEscape(garetienAbschnittsBeschriftung(lage, felder)) + "</span>"
			+ '<span class="gi-seg__id">' + kennung + "</span>"
			+ "</" + tag + ">";
	}

	// REIN: die Metazeile. Wiki-Artikel (auswärts) · LOD · Wiki/Ebene · `extra`.
	// ⚠️ Das ↗ steht NICHT hier, sondern in der CSS-Regel `.gi-detail a[target="_blank"]::after`
	// -- dieselbe Bauform wie in den Fenstern „Hinweise" und „Neuigkeiten". Von Hand getippt
	// stünde es doppelt da, sobald jemand die Regel ergänzt.
	// ⚠️ Die kurzen Codes ggp/kosch stehen hier mit Absicht (so das Mockup): in einer 11px-Zeile
	// ist kein Platz für „garetien.de", und der Filtertrichter trägt die lange Form.
	function garetienDetailMetaMarkup(objekt) {
		const teile = [];
		const url = String(objekt.wiki_url || "").trim();
		if (url !== "") {
			// 🔴 Der Linktext ist der ARTIKELNAME („Garetien:Natter"), nicht das Wort
			// „Wiki-Artikel" -- so das Mockup §3. Er kommt fertig vom Server: die Bildung
			// `<Namensraum>:<Artikel>` steht dort an EINER Stelle
			// (avesmapsGaretienSeitenNameAusZeile), und ihn hier aus der Adresse
			// zurückzuparsen wäre ihre dritte Fassung.
			// ⚠️ Ohne Artikelnamen (Sammelquelle ohne Artikel, alter Lauf) bleibt das Wort stehen
			// -- ein Link ohne Beschriftung wäre schlechter als ein allgemeiner.
			const seite = String(objekt.seite || "").trim();
			teile.push('<a href="' + avesmapsGaretienEscape(url) + '" target="_blank" rel="noopener"'
				+ ' title="' + avesmapsGaretienEscape(url) + '">'
				+ avesmapsGaretienEscape(seite === "" ? "Wiki-Artikel" : seite) + "</a>");
		}
		const lodVon = String(objekt.lodmin || "").trim();
		const lodBis = String(objekt.lodmax || "").trim();
		if (lodVon !== "" || lodBis !== "") {
			teile.push("LOD " + avesmapsGaretienEscape(lodVon) + "–" + avesmapsGaretienEscape(lodBis));
		}
		const herkunft = [String(objekt.wiki || "").trim(), String(objekt.ebene || "").trim()]
			.filter(function (wert) { return wert !== ""; });
		if (herkunft.length > 0) {
			teile.push(avesmapsGaretienEscape(herkunft.join(" / ")));
		}
		// 🔴 Ein leeres `extra` wird BENANNT, nicht verschwiegen (so das Mockup): bei politischen
		// Flächen stehen dort `pop=` und `level=`, und „nichts da" ist dort eine Auskunft.
		teile.push(String(objekt.extra || "").trim() === ""
			? "ohne&nbsp;<code>extra</code>"
			: avesmapsGaretienEscape(String(objekt.extra).trim()));
		return '<p class="gi-detail__meta">' + teile.join(" · ") + "</p>";
	}

	// REIN: der 💣-Kasten. Er kommt bei MEHREREN und bei EINEM nicht -- ein Kasten, der immer da
	// ist, ist keine Warnung mehr, sondern Zier (dieselbe Lehre wie beim Statuskreis, der nur leer
	// sein kann, AGENTS.md §11).
	function garetienDetailBombeMarkup(objekt, gruppen) {
		if (gruppen.gesamt < 2) { return ""; }
		let text = "💣 Ihr <b>eines</b> Objekt liegt auf <b>" + gruppen.gesamt
			+ "</b> verschiedenen Objekten von uns — deshalb wird je <b>Abschnitt</b> gehakt, nie"
			+ " je Objekt.";
		if (gruppen.ohneNamen > 0) {
			text += " " + garetienAnzahlText(gruppen.ohneNamen, "davon trägt", "davon tragen")
				+ " keinen Namen: dass er darunter liegt, macht ihn noch nicht zu ihrem.";
		}
		return '<p class="gi-bomb">' + text + "</p>";
	}

	// Die Lizenzangabe kommt aus js/ui/feature-source-markup.js -- der EINEN Stelle, an der ein
	// Lizenzschlüssel zu seiner Beschriftung wird („cc-by-nc-sa-3.0" → „CC BY-NC-SA 3.0").
	// 🔴 KEINE eigene Tafel hier. Die Infobox, der Quellen-Editor und dieses Fenster zeigen
	// dieselbe Angabe derselben Quelle; eine Regel, die einen von drei Erzeugern bindet, ist keine
	// (AGENTS.md §11, Quellenliste). `index.html` lädt die Datei vor dieser -- dieselbe
	// Reihenfolgezusage wie bei den fünf Seiten mit dem Quellen-Editor.
	// ⚠️ Nachgeschlagen bei JEDEM Aufruf, nicht einmal beim Laden: sonst hält der Verweis eine
	// Fassung fest, und ein Test, der die geteilte Funktion ersetzt, misst weiter die alte.
	// 🔴 KEIN stiller Rückfall: fehlt die Datei, wird laut geworfen. Eine Ersatzfassung wäre genau
	// die zweite Wahrheit, die dieser Umweg vermeidet.
	// 🪤 Der Name ist ABSICHTLICH ein anderer als der der geteilten Funktion -- ein gleichnamiger
	// Weiterreicher im globalen Raum ruft sich selbst auf.
	function garetienLizenzZeile(quelle) {
		const geteilt = (typeof module !== "undefined" && module.exports)
			? require("../ui/feature-source-markup.js").featureSourceLicenseText
			: (typeof featureSourceLicenseText === "function" ? featureSourceLicenseText : null);
		if (typeof geteilt !== "function") {
			throw new Error("feature-source-markup.js fehlt -- sie traegt die Lizenzangabe");
		}
		return geteilt(quelle || {});
	}

	// REIN: der Abschnitt „Die Quelle, die mitreist" (Mockup §3).
	// 🔴 Er zeigt DATEN, keine abgeleitete Regel: Beschriftung, Namensnennung und Lizenzschlüssel
	// stehen im Vorschlag, weil sie eine Owner-Entscheidung sind. Sie im Browser aus dem
	// Wiki-Kürzel abzuleiten („kosch ? Briefspiel (Kosch) : …") wäre ihre zweite Fassung.
	// ⚠️ Fehlt die Quelle ganz (ein Objekt ohne Vorschlag, ein Lauf von vor dem Nachzug), fällt der
	// ganze Abschnitt WEG -- eine Überschrift über nichts ist keine Auskunft.
	function garetienQuellenMarkup(objekt) {
		const quelle = (objekt && objekt.quelle) || {};
		const label = String(quelle.label || "").trim();
		const lizenz = garetienLizenzZeile(quelle);
		if (label === "" && lizenz.text === "") { return ""; }
		const teile = [];
		if (label !== "") { teile.push("„" + avesmapsGaretienEscape(label) + "\""); }
		if (lizenz.text !== "") { teile.push(avesmapsGaretienEscape(lizenz.text)); }
		return '<p class="gi-sec">Die Quelle, die mitreist</p><p class="gi-why">'
			+ teile.join(" · ")
			+ " — einmal an der Quelle, nicht an jedem Objekt.</p>";
	}

	// REIN: die ganze rechte Spalte. `optionen` ist heute leer und bleibt der Griff, an dem
	// Aufgabe 14 ihren Knopf „✦ Auf der Karte zeigen" einhängt -- er steht bewusst noch NICHT hier:
	// ein Knopf, der nichts tut, ist eine sichtbare Störung, und diese Datei geht einzeln live.
	function garetienDetailMarkup(objekt) {
		if (!objekt) {
			return '<div class="gi-detail"><p class="avm-empty">Wähle links eine Zeile — hier steht'
				+ " dann, was bei uns an derselben Stelle liegt.</p></div>";
		}
		const abschnitte = objekt.abschnitte || [];
		const gruppen = garetienAbschnittsGruppen(abschnitte);

		let kopf = '<div class="gi-detail__head">'
			+ '<h4 class="gi-detail__name">' + avesmapsGaretienEscape(objekt.name || "") + "</h4>"
			+ '<span class="gi-detail__kind">' + avesmapsGaretienEscape(garetienTypText(objekt)) + "</span>"
			+ "</div>";
		kopf += garetienDetailMetaMarkup(objekt);

		let notiz = garetienAnzahlText(abschnitte.length, "Abschnitt", "Abschnitte");
		if (gruppen.gesamt >= 2) {
			notiz += " · " + gruppen.gesamt + " verschiedene Objekte";
		}
		// Der Deckungsgrad -- die Zahl, an der ein Editor abliest, wie sicher der Treffer ist.
		// 🔴 Er kommt vom SERVER: er IST das Ergebnis des Abgleichs (Median über die Probepunkte,
		// gemessen gegen die Schwelle von 2,0 Karteneinheiten). Im Browser nachgerechnet wäre er
		// die zweite Wahrheit über „wie gut deckt sich das".
		// ⚠️ `null` heißt „nicht gemessen" und ist nicht dasselbe wie 0 (= liegt genau darauf) --
		// deshalb ausdrücklich gegen `null` geprüft und nicht auf Wahrheitswert.
		if (typeof objekt.deckung === "number" && isFinite(objekt.deckung)) {
			notiz += " · Deckung Median " + garetienZahlText(objekt.deckung);
		}
		let mitte = '<p class="gi-sec">Was bei uns an derselben Stelle liegt'
			+ '<span class="gi-sec__note">' + notiz + "</span></p>";
		mitte += abschnitte.length === 0
			? '<p class="gi-why">Zu diesem Objekt steht kein Abschnitt von uns im Vorschlag.</p>'
			: abschnitte.map(function (abschnitt) {
				return garetienAbschnittMarkup(objekt, abschnitt);
			}).join("");
		mitte += garetienDetailBombeMarkup(objekt, gruppen);

		// Der Grund kommt fertig vom Server (garetien-abgleich.php baut den Satz). Ohne Grund
		// steht auch keine Überschrift da -- ein Abschnitt, der nur leer sein kann, lügt.
		const grund = String(objekt.grund || "").trim();
		const warum = grund === "" ? "" : '<p class="gi-sec">Der Grund</p><p class="gi-why">'
			+ avesmapsGaretienEscape(grund) + "</p>";

		return '<div class="gi-detail">' + kopf + mitte + warum
			+ garetienQuellenMarkup(objekt) + "</div>";
	}

	// ---- Die Auswahl: die ZEILE öffnet die Ansicht, das HÄKCHEN nicht ------------------------------

	function garetienDetailRendern(objekte) {
		if (!hasDocument) { return; }
		const spalte = document.getElementById("garetien-detailcol");
		if (!spalte) { return; }
		const liste = objekte || zustand.objekte || [];
		const gewaehlt = zustand.detailKey === null ? null : (liste.filter(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		})[0] || null);
		spalte.innerHTML = garetienDetailMarkup(gewaehlt);
		// Dreiwertig ist eine EIGENSCHAFT, kein Attribut -- erst nach dem Einfügen einlösen, genau
		// wie in avesmapsGaretienListeRendern.
		Array.prototype.forEach.call(spalte.querySelectorAll("input[data-part]"), function (feld) {
			feld.indeterminate = true;
		});
	}

	// Die gewählte Zeile wird SICHTBAR markiert -- `.avm-row.is-selected` ist die Hausform
	// (editor-row.css), kein eigener Zustand daneben.
	function garetienAuswahlMarkieren() {
		if (!hasDocument) { return; }
		const listeEl = document.getElementById("garetien-list");
		if (!listeEl) { return; }
		Array.prototype.forEach.call(listeEl.querySelectorAll(".avm-row"), function (zeile) {
			zeile.classList.toggle("is-selected",
				zustand.detailKey !== null && zeile.getAttribute("data-key") === zustand.detailKey);
		});
	}

	function garetienDetailWaehlen(schluessel, objekte) {
		zustand.detailKey = schluessel === undefined || schluessel === null || schluessel === ""
			? null
			: String(schluessel);
		garetienDetailRendern(objekte);
		garetienAuswahlMarkieren();
		return zustand.detailKey;
	}

	// 🔴 Der Verteiler nimmt Ereignis UND Objektliste HEREIN -- dieselbe Bauform wie
	// garetienLaufStarten (Aufgabe 12b), und aus demselben Grund: nur so lässt sich am ERGEBNIS
	// messen, dass ein Klick auf das Häkchen die Ansicht NICHT umschaltet. Eine Zusicherung, die
	// bloß behauptet, im Quelltext stehe ein `if`, wäre Vakuum.
	//
	// 💣 Das Häkchen gehört Aufgabe 15 und darf die Ansicht nicht mitnehmen. Genau dafür ist die
	// Listenzeile ein `<div>` und kein `<label>` (Aufgabe 11, Review M3): ein `<label>` machte aus
	// jedem Zeilenklick einen Häkchenklick, und ein Editor könnte keine Zeile ansehen, ohne sie
	// im selben Klick anzuhaken.
	function garetienListeKlick(ereignis, objekte) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		if (ziel.closest('input[type="checkbox"]')) { return null; }
		const zeile = ziel.closest(".avm-row");
		if (!zeile) { return null; }
		const schluessel = zeile.getAttribute("data-key");
		if (!schluessel) { return null; }
		return garetienDetailWaehlen(schluessel, objekte);
	}

	// ---- Verdrahtung + Rechte-Riegel ---------------------------------------------------------------

	function bindFenster() {
		const schliessenBtn = hasDocument ? document.getElementById("garetien-importer-close") : null;
		if (schliessenBtn) {
			schliessenBtn.addEventListener("click", avesmapsGaretienFensterSchliessen);
		}
	}

	function bindKnopf() {
		const oeffnenBtn = hasDocument ? document.getElementById("garetien-importer-open") : null;
		if (oeffnenBtn) {
			oeffnenBtn.addEventListener("click", avesmapsGaretienFensterOeffnen);
		}
	}

	// ⚠️ Kein zweiter Rechteweg: dieselbe Auskunft, die js/app/session.js ohnehin einmal holt
	// (window.AvesmapsSession.load() liefert ein geteiltes, gecachtes Versprechen zurück).
	function anwendeRechteRiegel() {
		const sitzung = (typeof window !== "undefined" && window.AvesmapsSession)
			? window.AvesmapsSession.current()
			: null;
		const darf = avesmapsGaretienDarfOeffnen(sitzung);
		const oeffnenBtn = hasDocument ? document.getElementById("garetien-importer-open") : null;
		if (oeffnenBtn) { oeffnenBtn.hidden = !darf; }
		return darf;
	}

	function boot() {
		bindFenster();
		bindKnopf();
		if (typeof window !== "undefined" && window.AvesmapsSession) {
			window.AvesmapsSession.load().then(function () {
				anwendeRechteRiegel();
			});
		}
	}

	if (hasDocument) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", boot);
		} else {
			boot();
		}
	}

	if (typeof window !== "undefined") {
		window.avesmapsGaretienImporter = {
			oeffnen: avesmapsGaretienFensterOeffnen,
			schliessen: avesmapsGaretienFensterSchliessen,
			zustand: avesmapsGaretienFensterZustand,
			rufe: avesmapsGaretienRufe,
			// Derselbe Griff, mit dem Stufe 1 vor dem Menueband ueber die Konsole bedient wurde --
			// seit Aufgabe 12b ist er nicht mehr der einzige Weg, aber Aufgabe 13 ff. ruft ihn
			// nach jeder Handlung (der EINE Weg, auf dem die Liste sich aendert).
			listeHolen: avesmapsGaretienListeHolen,
			// Aufgabe 12b: dieselbe Handlung wie die Kachel „Holen & Rechnen".
			holenUndRechnen: avesmapsGaretienHolenUndRechnen,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			avesmapsGaretienDarfOeffnen,
			avesmapsGaretienFensterZustand,
			avesmapsGaretienRufe,
			// Aufgabe 11
			garetienZeileMarkup,
			avesmapsGaretienCheckboxZustand,
			avesmapsGaretienHatAuswahl,
			avesmapsGaretienUrteilInfo,
			avesmapsGaretienBalanceZeileText,
			avesmapsGaretienRunlineMarkup,
			avesmapsGaretienTabsMarkup,
			avesmapsGaretienFussZeileMarkup,
			avesmapsGaretienAngehakt,
			avesmapsGaretienAngehaktAus,
			avesmapsGaretienListeHolen,
			avesmapsGaretienListeRendern,
			garetienListeSkelettMarkup,
			// Aufgabe 12
			garetienFilterState,
			garetienFacettenOptionen,
			garetienWikiLabel,
			garetienUrteilFilterLabel,
			garetienChipsMarkup,
			garetienFilterIstAktiv,
			avesmapsGaretienFilterFacettenAktualisieren,
			garetienFilterSections,
			// Aufgabe 12b
			garetienMenuebandMarkup,
			garetienEbeneLabel,
			garetienEbenenBezeichner,
			garetienGewaehlteBezeichner,
			garetienEbenenKachelText,
			garetienEbenenOptionenAus,
			garetienEbenenAuswahl,
			garetienLaufStempel,
			garetienLaufKachelText,
			garetienLaufUebernehmen,
			garetienFensterFuellen,
			garetienLaufStarten,
			// Aufgabe 13
			garetienDetailMarkup,
			// Aufgabe 13b
			garetienTypText,
			garetienPunkteText,
			garetienQuellenMarkup,
			garetienAbschnittsItems,
			garetienAbschnittsLage,
			garetienAbschnittsBeschriftung,
			garetienAbschnittsGruppen,
			garetienAbschnittMarkup,
			garetienDetailWaehlen,
			garetienListeKlick,
		};
	}
})();
