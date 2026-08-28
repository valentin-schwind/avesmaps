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
			listeEl.innerHTML = '<p class="avm-empty">Noch kein Import-Lauf. „Holen &amp; Rechnen“ '
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
		};
	}
})();
