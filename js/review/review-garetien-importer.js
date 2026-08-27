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

	function avesmapsGaretienFensterOeffnen() {
		const win = fensterElement();
		if (win) { win.hidden = false; }
		zustand.offen = true;
		// 🔧 Offener Punkt (siehe Bericht): welche Kachel im Menueband `zustand.importRunId` setzt,
		// ist nicht Teil dieser Aufgabe (9/10 bauten nur die leere Huelle). Ohne einen Lauf antwortet
		// der Endpunkt mit dem Fehler `no_run` -- abgefangen, damit das Fenster trotzdem eine leere,
		// erklaerte Liste zeigt statt einer unbehandelten Ablehnung in der Konsole.
		avesmapsGaretienListeHolen().catch(function (fehler) {
			garetienListeSkelettSicherstellen();
			const listeEl = hasDocument ? document.getElementById("garetien-list") : null;
			if (listeEl) {
				listeEl.innerHTML = '<p class="avm-error">'
					+ avesmapsGaretienEscape((fehler && fehler.message) || "Die Liste konnte nicht geladen werden.")
					+ "</p>";
			}
		});
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
		if (fussEl) {
			const angehaktGesamt = avesmapsGaretienAngehaktAus(a, "new") + avesmapsGaretienAngehaktAus(a, "changed");
			fussEl.textContent = angehaktGesamt + " angehakt · " + Number(a.gesamt || 0) + " im Lauf";
		}

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
		return avesmapsGaretienRufe("/api/edit/map/garetien-import.php", rumpf).then(function (antwort) {
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
			// Aufgabe 11: fuer die Konsolen-Bedienung waehrend der Importer noch kein eigenes
			// Menueband hat (siehe Bericht) -- derselbe Griff, mit dem Stufe 1 heute schon lebt.
			listeHolen: avesmapsGaretienListeHolen,
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
			avesmapsGaretienAngehakt,
			avesmapsGaretienAngehaktAus,
			avesmapsGaretienListeHolen,
			avesmapsGaretienListeRendern,
			garetienListeSkelettMarkup,
		};
	}
})();
