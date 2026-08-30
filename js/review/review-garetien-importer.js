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

	// Die SCHREIBENDE Adresse (Aufgabe 15/16) -- die vorhandene Übernahme-Tür, mit `kind:'garetien'`.
	// 🔴 EINE TÜR. `api/edit/map/garetien-import.php` hat bewusst kein `apply`; an dieser hier hängen
	// Rechteriegel, Einzelflug-Sperre, zweite Bestätigung, Häppchen und Protokoll. Ein zweiter
	// Schreibweg wäre die zweite Fassung von all dem.
	const GARETIEN_PLAN_ENDPUNKT = "/api/edit/wiki/sync-plan.php";

	// Die `kind`-Kennung dieses Imports in sync_plan_run/-item/sync_decision. Sie steht hier EINMAL;
	// serverseitig heißt sie AVESMAPS_GARETIEN_PLAN_KIND.
	const GARETIEN_PLAN_ART = "garetien";

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
		// 🔴 DIE ANZEIGE-MENGE GEHOERT DEM FENSTER, NICHT DEM VORSCHLAG (Entwurf §3).
		// Bis zum 29.08.2026 hing „liegt auf der Karte" an `items[].selected` -- und 7930 der 8213
		// Objekte haben ueberhaupt kein Item. Sie konnten damit NIE angezeigt werden; kein
		// Umbenennen einer Beschriftung haette das geaendert.
		// ⚠️ Gemerkt wird das OBJEKT, nicht sein Schluessel: der Server liefert je Abruf nur die
		// gefilterte Seite, ein Schluessel allein waere nach dem naechsten Filterwechsel nicht mehr
		// aufloesbar.
		// 🔴 Eine `Map` und nicht ein Objekt: sie haelt die Einfuegereihenfolge zu, und ein
		// Objektschluessel wie „constructor" kann ihr nichts anhaben.
		anzeige: new Map(),
		// 🔴 Aufgabe 2: die Markierung ist CLIENT-SEITIG und schreibt nichts (Owner 29.08.2026:
		// „Markieren aendert nichts"). Sie hat genau einen Zweck: der Knopf „Markierte anzeigen".
		markiert: new Set(),
	};

	// ---- Die Anzeige-Menge ------------------------------------------------------------------------
	//
	// 🔴 CLIENT-SEITIG, und das ist eine Bedingung, keine Bequemlichkeit: eine Server-Tabelle dafuer
	// waere eine dritte Import-Tabelle und verstiesse gegen die Abbau-Regel (Auftrag §5.5).
	// Sie ist ein Arbeitsmittel der Sitzung und ueberlebt das Schliessen des Fensters nicht --
	// gewollt.

	function avesmapsGaretienAnzeigeHinzufuegen(objekte) {
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			// ⚠️ Ein bereits liegendes Objekt wird ERSETZT, nicht uebersprungen: die frischere
			// Fassung kommt aus der letzten Serverantwort und kann ein geaendertes Urteil tragen.
			// Die Reihenfolge bleibt trotzdem die des ERSTEN Einfuegens -- `Map.set` auf einen
			// vorhandenen Schluessel sortiert nicht um.
			zustand.anzeige.set(String(o.key), o);
		});
		return zustand.anzeige.size;
	}

	function avesmapsGaretienAnzeigeLeeren() {
		zustand.anzeige.clear();
		return zustand.anzeige.size;
	}

	function avesmapsGaretienAnzeigeListe() {
		return Array.from(zustand.anzeige.values());
	}

	function avesmapsGaretienAnzeigeHat(schluessel) {
		return zustand.anzeige.has(String(schluessel));
	}

	// ---- Regression 29.08.2026 (Owner-Meldung): die Anzeige-Menge nach einem Schreibvorgang AUFFRISCHEN
	//
	// 🔴 BIS DAHIN GAB ES DAFUER GAR KEINEN ERZEUGER. `zustand.anzeige.set(...)` wurde
	// ausschliesslich aus avesmapsGaretienAnzeigeHinzufuegen gerufen -- eine Handlung ("Neu
	// einfuegen", "Namen ersetzen", ein Abschnittshaekchen) ging an den Server,
	// avesmapsGaretienHandlungSenden holte die Liste neu, aber die KOPIEN in zustand.anzeige blieben
	// auf dem alten Stand. Weder das ✦ noch der ✓ am Handlungsknopf noch die Einzelansicht aenderten
	// sich -- der Knopf tat scheinbar nichts.
	//
	// 🔴 AUFGEFRISCHT, NIE ENTFERNT. Die Serverantwort ist gefiltert und seitenweise
	// (AVESMAPS_GARETIEN_LISTE_MAX); die Anzeige-Menge ist ausdruecklich filter- und
	// seitenunabhaengig (Entwurf §3, §3.1). Ein Objekt, das in einer Antwort nicht vorkommt, faellt
	// deshalb NICHT heraus -- nur wer WIRKLICH in der Antwort steht, bekommt seine frische Fassung.
	// Wer die Menge an der Antwort ausrichtete, leerte dem Editor beim naechsten Filterklick die Karte.
	//
	// REIN: kein DOM. Deshalb ruft avesmapsGaretienListeRendern diese Funktion VOR seiner
	// hasDocument-Weiche auf -- sonst liefe die ganze Regel unter Node (also im Testfeld) nie, und
	// sie deckte auch nur einen von zwei Renderwegen ab, wenn sie irgendwo dahinter stuende.
	function avesmapsGaretienAnzeigeAuffrischen(objekte) {
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			const schluessel = String(o.key);
			if (zustand.anzeige.has(schluessel)) { zustand.anzeige.set(schluessel, o); }
		});
	}

	// ---- Aufgabe 8: nach dem Einfuegen -- nur was WIRKLICH uebernommen wurde, verlaesst die Anzeige
	//
	// ⚠️ „Nur was uebernommen wurde, verlaesst die Anzeige" (Brief) -- die uebrigen (ohne Vorschlag,
	// oder deren Uebernahme scheiterte: `stale`/`failed`) bleiben liegen, sonst verschwindet dem
	// Editor die Karte unter der Hand, ohne dass etwas passiert waere.
	//
	// 🔴 GEPRUEFT WIRD GEGEN DEN SERVER, NIE VERMUTET: `apply` meldet nur AGGREGIERTE Zahlen (wie
	// viele insgesamt geschrieben wurden), nie WELCHE Objekte es waren -- und ein anderswo bereits
	// vorgemerktes Item koennte mitgelaufen sein. Ob EIN bestimmtes Objekt jetzt „uebernommen"
	// steht, sagt deshalb nur der Server.
	//
	// 🔴 EIN GEZIELTER, EINMALIGER Nachlese-Ruf auf den Server-Reiter „uebernommen" -- unabhaengig
	// vom gerade aktiven UI-Reiter, damit ein Editor auf „Offen" nicht deshalb die Karte verliert.
	// ⚠️ Und OHNE Schleife: fuer diesen Import passen alle moeglichen Uebernahmen (heute hoechstens
	// 283 -- nur ein Objekt MIT Vorschlag kann je uebernommen werden) in eine einzige Seite
	// (AVESMAPS_GARETIEN_LISTE_MAX = 500). Ein zweiter Ruf mit `versatz` waere hier genau die
	// Endpunktschleife, vor der AGENTS.md warnt (der Endpunkt liest das GANZE Laufinventar neu ein).
	function avesmapsGaretienAnzeigeNachEinfuegenBereinigen(rufe, runId) {
		return rufe(GARETIEN_ENDPUNKT, {
			action: "liste", run_id: runId, stand: "uebernommen",
			ebene: [], typ: [], urteil: [], wiki: [], suche: "",
			nur_ungehakt: false, nur_mehrteilig: false,
		}).then(function (antwort) {
			avesmapsGaretienAnzeigeAuffrischen((antwort && antwort.objekte) || []);
			let entfernt = 0;
			Array.from(zustand.anzeige.entries()).forEach(function (eintrag) {
				const schluessel = eintrag[0];
				const objekt = eintrag[1];
				if (objekt && objekt.stand === "uebernommen") {
					zustand.anzeige.delete(schluessel);
					entfernt++;
				}
			});
			return entfernt;
		});
	}

	// ---- Die Markierung: ein reiner MARKER, kein Schreibweg (Aufgabe 2, Entwurf §3.2) --------------
	//
	// 🔴 „Markieren aendert nichts" (Owner 29.08.2026). Sie schreibt nicht, sie verschiebt keine
	// Zeile -- ihr einziger Zweck ist der Knopf „Markierte anzeigen".

	function avesmapsGaretienMarkierungUmschalten(schluessel) {
		const s = String(schluessel);
		if (zustand.markiert.has(s)) { zustand.markiert.delete(s); return false; }
		zustand.markiert.add(s);
		return true;
	}

	function avesmapsGaretienMarkierungHat(schluessel) {
		return zustand.markiert.has(String(schluessel));
	}

	// „Markierte anzeigen": sie kommen ZUSAETZLICH in die Anzeige und BLEIBEN markiert und offen.
	// ⚠️ Die Liste kommt HEREIN (Hausform in dieser Datei), damit sich am Ergebnis messen laesst,
	// welche Objekte wirklich uebernommen wurden.
	function avesmapsGaretienMarkierteAnzeigen(objekte) {
		const liste = (objekte || zustand.objekte || []).filter(function (o) {
			return o && zustand.markiert.has(String(o.key));
		});
		avesmapsGaretienAnzeigeHinzufuegen(liste);
		return liste.length;
	}

	// ---- Aufgabe 10: „Alle markieren" -- markiert ALLE Zeilen der AKTUELLEN (gerenderten) Liste ---
	// Owner 29.08.2026: „einen button, namens 'Alle markieren', der alle in der aktuellen liste
	// markiert". „Aktuelle Liste" heißt: was WIRKLICH gerendert ist -- gedeckelt auf
	// AVESMAPS_GARETIEN_LISTE_MAX und gefiltert (Brief) --, nicht der ganze Lauf.
	//
	// 🔴 ER ERGÄNZT, ER ERSETZT NICHT (Brief): schon markierte Zeilen anderer Filteransichten
	// bleiben markiert -- derselbe Zug wie avesmapsGaretienAnzeigeHinzufuegen, nur auf dem anderen
	// Set. Ein `zustand.markiert = new Set(...)` verlöre beim Filterwechsel die Auswahl.
	function avesmapsGaretienAlleMarkieren(objekte) {
		let markiert = 0;
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			const s = String(o.key);
			if (!zustand.markiert.has(s)) { markiert++; }
			zustand.markiert.add(s);
		});
		return markiert;
	}

	// REIN: Beschriftung + Sperre des Knopfes „Alle markieren" -- er trägt die Zahl der GERENDERTEN
	// Zeilen (Brief: „trägt seine Zahl, wie der Fußknopf sein 'n von m'"), nie die des ganzen Laufs.
	// 🔴 Im Reiter „Anzeigen" ist er sinnlos (dort liegt ohnehin alles auf der Karte) -- gesperrt,
	// mit sichtbarem Grund, wie Suche und Filtertrichter dort schon gesperrt sind (RULING R7).
	function garetienAlleMarkierenZustand(objekte, stand) {
		const liste = objekte || [];
		const aufAnzeigenReiter = stand === "anzeigen";
		let hinweis = "";
		if (aufAnzeigenReiter) {
			hinweis = "Der Reiter zeigt, was schon auf der Karte liegt — hier gibt es nichts zu markieren.";
		} else if (liste.length === 0) {
			hinweis = "Keine Zeile in dieser Ansicht.";
		}
		return {
			anzahl: liste.length,
			beschriftung: "Alle markieren (" + liste.length + ")",
			gesperrt: aufAnzeigenReiter || liste.length === 0,
			hinweis: hinweis,
		};
	}

	// Die DOM-Hälfte dazu -- dieselbe Aufteilung wie beim Fußknopf (garetienUebernahmeKnopfSetzen):
	// Knopf und Hinweis werden an EINER Stelle gesetzt, damit sie nie auseinanderlaufen.
	function garetienAlleMarkierenKnopfSetzen(objekte) {
		if (!hasDocument) { return null; }
		const stand = garetienAlleMarkierenZustand(objekte, zustand.stand);
		const knopf = document.getElementById("garetien-mark-all");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
		}
		const hinweisEl = document.getElementById("garetien-mark-all-hint");
		if (hinweisEl) {
			hinweisEl.textContent = stand.hinweis;
			hinweisEl.hidden = stand.hinweis === "";
		}
		return stand;
	}

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
			// Aufgabe 1: eine frische Liste aus der Anzeige-Menge, kein Griff auf die Map selbst --
			// dieselbe Kopie-Zusage wie bei `objekte`/`auswahl` oben.
			anzeige: avesmapsGaretienAnzeigeListe(),
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
		// Die Zahlen der zwei Bilanzflächen gehören einem Lauf; ohne Lauf stehen sie leer, statt
		// eine Null zu behaupten, die niemand gezählt hat.
		["garetien-runline", "garetien-balance"].forEach(function (id) {
			const el = document.getElementById(id);
			if (el) { el.textContent = ""; }
		});
		// Aufgabe 16/5: ohne Lauf gibt es keine Anzeige -- und damit nichts einzufuegen.
		garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
		// Aufgabe 10: ohne Lauf gibt es auch keine gerenderte Zeile -- und damit nichts zu markieren.
		garetienAlleMarkierenKnopfSetzen([]);
		// Meldung C (30.08.2026): ohne Lauf gibt es auch nichts Markiertes zurückzunehmen.
		garetienRuecknahmeMengeKnopfSetzen([]);
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
		// Aufraeumen nach einem Fehlimport: die Zaehlung ist unabhaengig vom Lauf/der Liste --
		// eigener, paralleler Abruf, kein Anhaengsel an garetienFensterFuellen.
		garetienQuellenAbbauZaehlungHolen();
		return garetienFensterFuellen(avesmapsGaretienRufe, avesmapsGaretienListeHolen);
	}

	// 💣 BEIM SCHLIESSEN WIRD DIE KARTE ABGERAEUMT (Aufgabe 14). Ein zurueckgelassener goldener
	// Strich auf der oeffentlichen Karte waere der schlimmste Ausfall dieser Ansichtsschicht: der
	// Besucher saehe goldene Striche ohne jede Erklaerung, und nichts auf der Seite erklaerte sie.
	// ⚠️ Defensiv wie der Aufruf im Listenlauf -- diese Datei bleibt ohne den Zeichner lauffaehig.
	function avesmapsGaretienFensterSchliessen() {
		const win = fensterElement();
		if (win) { win.hidden = true; }
		zustand.offen = false;
		if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteAus === "function") {
			window.avesmapsGaretienKarteAus();
		}
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
	//
	// 🔴 Aufgabe 2 (Entwurf §3.2): das Haekchen ist ein reiner MARKER und zeigt `zustand.markiert`,
	// nicht mehr den Item-Zustand -- „Markieren aendert nichts" (Owner 29.08.2026). Es gibt darum
	// auch KEIN `disabled` mehr: ein Objekt OHNE jedes Item (7930 von 8213) muss sich genauso
	// markieren lassen wie eines mit Vorschlag, sonst waere „Markierte anzeigen" fuer sie tot.
	// ⚠️ REIN: der Markierungsstand kommt als zweites Argument HEREIN, nicht aus dem Modulzustand
	// -- sonst liesse sich diese Funktion nicht ohne DOM pruefen.
	function garetienZeileMarkup(objekt, istMarkiert) {
		const o = objekt || {};
		// ⚠️ Das Leuchten (✦) zaehlt weiter ALLE Items -- avesmapsGaretienHatAuswahl ist unberuehrt
		// und unabhaengig von der Markierung: ein vorgemerkter Geometrie-Ersatz IST eine Vormerkung
		// und gehoert auf die Karte, markiert oder nicht.
		const leuchtet = avesmapsGaretienHatAuswahl(o);
		const urteilInfo = avesmapsGaretienUrteilInfo(o.urteil);

		const checkboxAttribute = istMarkiert ? " checked" : "";

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

	// 🔴 Die Reiter zeigen den BEARBEITUNGSSTAND, nicht das Urteil: Offen · Anzeigen · Abgelehnt ·
	// Uebernommen. .avm-tabs/.avm-tab sind Hausform (editor-body.css) -- die aktive Unterstreichung
	// ist dort --color-text-strong; das Mockup zeichnet golden, aber die Hausform gewinnt.
	//
	// 🔴 VIER REITER, ABER NUR DREI SERVERSTAENDE. „Anzeigen" ist die client-seitige Menge
	// (Entwurf §3.1) -- der Server kennt den Wert nicht und wird danach nie gefragt.
	// 🔴 `vorgemerkt` ist aus der Leiter heraus (29.08.2026): es war ein SERVERstand, abgeleitet
	// aus `selected`, und deshalb sprang eine Zeile beim Anhaken aus „Offen" heraus und war dort
	// nicht mehr abhakbar. Owner: „Markieren aendert nichts."
	// 🔴 Die ZAHL „14 vorgemerkt" stand danach noch in der Fusszeile, obwohl sie dort niemand mehr
	// abbilden konnte -- Owner (30.08.2026): sie ist „inkonsistent mit allen anderen Zahlen" und
	// ist mit `avesmapsGaretienFussZeileMarkup` restlos entfernt (kein Reiter, keine Fusszeile mehr).
	const AVESMAPS_GARETIEN_SERVER_STAENDE = ["offen", "abgelehnt", "uebernommen"];

	const AVESMAPS_GARETIEN_REITER = [
		["offen", "Offen"],
		["anzeigen", "Anzeigen"],
		["abgelehnt", "Abgelehnt"],
		["uebernommen", "Übernommen"],
	];

	function avesmapsGaretienTabsMarkup(reiter, aktiverStand) {
		const r = reiter || {};
		return AVESMAPS_GARETIEN_REITER.map(([schluessel, beschriftung]) => {
			const klasse = "avm-tab" + (schluessel === aktiverStand ? " is-active" : "");
			// 🔴 Die Zahl des Reiters „Anzeigen" kommt aus der MENGE. Sie aus `reiter.anzeigen` zu
			// lesen waere eine zweite Wahrheit ueber etwas, das der Server gar nicht kennt.
			const zahl = schluessel === "anzeigen"
				? zustand.anzeige.size
				: Number(r[schluessel] || 0);
			return '<button class="' + klasse + '" type="button" data-stand="' + schluessel + '">'
				+ avesmapsGaretienEscape(beschriftung) + " (" + zahl + ")</button>";
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
			+ "</div>"   // .type-filter
			// 💣 UND DIESES HIER SCHLIESST DIE `.gi-searchrow`. Es fehlte bis zum 29.08.2026, und der
			// Browser hat den Rest der Spalte deshalb IN die Suchzeile gehaengt -- die ist
			// `display: flex` (eine Reihe), also standen Chips, Bilanz und die ganze Liste
			// NEBENEINANDER statt untereinander. Owner-Meldung: „irgendwas ist komisch/verrutscht".
			// 🪤 Kein Test hat es gesehen: alle pruefen den Skelett-STRING (`includes`) oder bauen sich
			// ihr eigenes Markup -- niemand hat ihn GEPARST und die Kinder gezaehlt. Genau dafuer gibt
			// es jetzt die Zusicherung in garetien-liste-zeile.test.js.
			+ "</div>"   // .gi-searchrow
			// RULING R7 (Fix-Runde 1): auf dem Reiter „Anzeigen" wirken Suche und Filtertrichter
			// NICHT (Entwurf §3.1) -- das muss ERKENNBAR sein, nicht nur wahr. Steht standardmaessig
			// `hidden`; garetienAnzeigeFilterSperreSetzen() schaltet Text UND die `disabled`-Sperre
			// von Suchfeld/Filterknopf gemeinsam (siehe dort).
			+ '<p class="gi-anzeigehinweis" id="garetien-anzeige-hinweis" hidden>Der Reiter zeigt, '
			+ "was auf der Karte liegt — hier wird nicht gefiltert.</p>"
			// 🔴 Die zwei Anzeige-Knoepfe („Markierte anzeigen", „Anzeige leeren") stehen seit
			// 29.08.2026 NICHT mehr hier -- Owner-Meldung: sie gehoeren in die Fusszeile, links von
			// „Alle angezeigten einfuegen". Sie stehen jetzt STATISCH in index.html (.gi-foot, vor
			// #garetien-apply) und werden in bindFenster() verdrahtet (dieselbe Stelle wie der
			// Fussknopf selbst) -- nicht mehr hier, wo nur einmalig gebautes, dynamisches Skelett
			// entsteht. Die IDs (garetien-mark-show, garetien-anzeige-clear) sind unveraendert.
			+ '<div class="gi-chips" id="garetien-chips"></div>'
			+ '<p class="gi-balance" id="garetien-balance"></p>'
			+ '<div class="avm-scroll gi-list" id="garetien-list"></div>';
	}

	// Nach den zwei Anzeige-Knoepfen (Aufgabe 2) UND nach jeder Handlung, die die Anzeige aendert
	// (Aufgabe 5), muss die Spalte neu gezeichnet werden. 🔴 Steht der Reiter gerade auf „Anzeigen",
	// ist ein Neuzeichnen aus der letzten SERVER-Antwort falsch -- diese Ansicht IST die
	// Anzeige-Menge, also wird sie ueber denselben Weg wie ein Reiterwechsel neu gebaut
	// (avesmapsGaretienListeHolen, RULING R5). Auf jedem anderen Reiter reicht ein Neuzeichnen aus
	// der zuletzt geholten Antwort -- ein Markieren/Leeren aendert an IHR nichts, nur an der
	// Reiterzahl „Anzeigen (n)" und an der Karte.
	function garetienAnzeigeNeuZeichnen() {
		if (zustand.stand === "anzeigen") {
			avesmapsGaretienListeHolen();
			return;
		}
		avesmapsGaretienListeRendern(zustand.letzteAntwort);
		if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteZeigen === "function") {
			window.avesmapsGaretienKarteZeigen(avesmapsGaretienAufDerKarte());
		}
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
				// Aufgabe 15: das HÄKCHEN zuerst -- garetienListeKlick steigt bei einem Häkchen
				// ohnehin aus (die Zeile öffnet die Ansicht, das Häkchen nicht), aber die
				// Reihenfolge sagt, welcher der beiden den Klick beanspruchen darf.
				garetienHakenKlick(ereignis, zustand.objekte, zustand.planRunId,
					avesmapsGaretienHandlungSenden);
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
		// 🔴 Die zwei Anzeige-Knoepfe werden NICHT MEHR hier verdrahtet -- sie stehen seit
		// 29.08.2026 statisch in index.html (.gi-foot) und nicht mehr in diesem dynamisch gebauten
		// Skelett. Ihre Verdrahtung steht jetzt in bindFenster(), zusammen mit den uebrigen
		// statischen Fussknoepfen (derselbe Grund: ein Element, das schon beim Laden im DOM steht,
		// wird beim BOOT verdrahtet, nicht bei jedem Aufbau dieser Spalte).
	}

	// RULING R7 (Fix-Runde 1): auf dem Reiter „Anzeigen" wirken Suche und Filtertrichter nicht
	// (Entwurf §3.1) -- das muss ERKENNBAR sein. Gesperrt werden Suchfeld UND Filterknopf per
	// `disabled` (nicht nur ein `title`: ein deaktiviertes Element bekommt in Chrome keine
	// Zeigerereignisse und zeigt seinen `title` nie -- dasselbe Mittel wie beim gesperrten
	// Fussknopf), der Grund steht SICHTBAR daneben (`.gi-anzeigehinweis`).
	// ⚠️ Aufgerufen bei JEDEM Render, nicht nur beim Reiterwechsel: beide Renderwege (der echte
	// Serverabruf UND der „Anzeigen"-Zweig aus avesmapsGaretienListeHolen, RULING R5) muenden in
	// avesmapsGaretienListeRendern -- eine Regel, die nur einen von beiden bindet, ist keine Regel.
	// Damit ist auch der Rueckweg gesichert: ein Reiterwechsel ZURUECK auf einen Server-Reiter
	// rendert erneut und gibt beide Elemente sicher wieder frei.
	function garetienAnzeigeFilterSperreSetzen() {
		if (!hasDocument) { return; }
		const gesperrt = zustand.stand === "anzeigen";
		const sucheEl = document.getElementById("garetien-search");
		if (sucheEl) { sucheEl.disabled = gesperrt; }
		const filterToggleEl = document.getElementById("garetien-filter-toggle");
		if (filterToggleEl) { filterToggleEl.disabled = gesperrt; }
		// Der Zustand des Trichter-Panels ist ausschliesslich sein `hidden` (kein zweiter
		// Modulzustand daneben, s.o. bei Aufgabe 12) -- ein zufaellig offenes Panel schliesst also
		// mit, sobald gesperrt wird.
		if (gesperrt) {
			const filterMenuEl = document.getElementById("garetien-filter-menu");
			if (filterMenuEl) { filterMenuEl.hidden = true; }
		}
		const hinweisEl = document.getElementById("garetien-anzeige-hinweis");
		if (hinweisEl) { hinweisEl.hidden = !gesperrt; }
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

	/*
	 * Aufgabe 3 (Sicht-Tafel, Entwurf §4.1): welche Objekte der Anzeige-Menge OHNE eigene Sicht-Regel
	 * gezeichnet werden. REIN -- kein DOM.
	 *
	 * 🔴 `avesmapsGaretienSichtFuer` kommt aus dem globalen Raum (review-garetien-karte.js), genauso
	 * wie die uebrigen Kartenfunktionen, die diese Datei aufruft (`avesmapsGaretienKarteZeigen` &co.):
	 * diese Datei laeuft auch auf Seiten ohne Karte und darf die andere nicht voraussetzen. Fehlt sie,
	 * kommt eine leere Liste heraus statt eines Wurfs.
	 */
	function garetienNeutraleObjekte(liste) {
		if (typeof window === "undefined" || typeof window.avesmapsGaretienSichtFuer !== "function") {
			return [];
		}
		return (liste || []).filter(function (o) {
			return o && window.avesmapsGaretienSichtFuer(o).neutral;
		});
	}

	/*
	 * Die Neutral-Meldung der Bilanzzeile. REIN -- kein DOM.
	 *
	 * ⭐ Der Rueckfall wird GEMELDET, nicht verschwiegen (Entwurf §4.1). Ein stiller Rueckfall saehe
	 * aus wie „so sieht das Objekt eben aus"; genannt ist er die Arbeitsliste fuer die Sicht-Tafel.
	 * Dieselbe Regel wie „ein Pruefhaken zeigt seine Funde".
	 * ⚠️ Die Ebenen werden ENTDOPPELT (`Set`) und zusammen genannt -- eine Zeile je Ebene würde die
	 * Bilanz sprengen, sobald mehr als eine Ebene ohne Regel auf der Karte liegt.
	 */
	function garetienNeutralHinweisMarkup(liste) {
		const neutrale = garetienNeutraleObjekte(liste);
		if (neutrale.length === 0) { return ""; }
		const ebenen = Array.from(new Set(neutrale.map(function (o) {
			return String((o && o.ebene) || "?");
		})));
		return ' · <span class="gi-neutral">' + neutrale.length + " neutral gezeichnet · Ebene "
			+ avesmapsGaretienEscape(ebenen.join(", ")) + " hat keine Sicht-Regel</span>";
	}

	// Schreibt Liste, (Filter-)Bilanz, Reiterzahlen und Fusszeile aus einer frischen
	// action:'liste'-Antwort. 🔴 Rechnet nichts nach -- Urteil/Grund/Geometrie stehen schon fertig
	// in der Antwort.
	function avesmapsGaretienListeRendern(antwort) {
		const a = antwort || {};
		const objekte = a.objekte || [];

		// Regression 29.08.2026: JEDE frische Antwort frischt passende Eintraege der Anzeige-Menge
		// auf -- VOR der hasDocument-Weiche, damit BEIDE Renderwege sie bekommen: der echte
		// Serverabruf (avesmapsGaretienListeHolen, `stand !== "anzeigen"`) UND der „Anzeigen"-Zweig
		// (garetienAnzeigenAntwortBauen baut seine "Antwort" aus derselben Menge nach -- dort ist der
		// Aufruf ein wirkungsloser, aber unschaedlicher Nachschlag auf sich selbst). Eine Regel, die
		// nur einen von zwei Erzeugern bindet, ist keine Regel; genau das ist in diesem Umbau heute
		// schon zweimal passiert (RULING R2, R7).
		avesmapsGaretienAnzeigeAuffrischen(objekte);

		if (!hasDocument) { return; }
		const listcol = garetienListeSkelettSicherstellen();
		if (!listcol) { return; }

		const runlineEl = document.getElementById("garetien-runline");
		if (runlineEl) { runlineEl.innerHTML = avesmapsGaretienRunlineMarkup(a.bilanz); }

		const tabsEl = document.getElementById("garetien-tabs");
		if (tabsEl) { tabsEl.innerHTML = avesmapsGaretienTabsMarkup(a.reiter, zustand.stand); }

		// RULING R7: Suche/Filtertrichter sperren + sichtbar begruenden, wenn der Reiter
		// „Anzeigen" aktiv ist -- und bei jedem anderen Reiter wieder freigeben.
		garetienAnzeigeFilterSperreSetzen();

		const listeEl = document.getElementById("garetien-list");
		if (listeEl) {
			listeEl.innerHTML = objekte.length
				? objekte.map(function (o) {
					return garetienZeileMarkup(o, avesmapsGaretienMarkierungHat(o && o.key));
				}).join("")
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
			// Fix-Runde 2 zu Aufgabe 3: die Neutral-Meldung MUSS `avesmapsGaretienAufDerKarte(objekte)`
			// lesen, NICHT `avesmapsGaretienAnzeigeListe()` -- obwohl Letztere die naheliegendere
			// Wahl scheint ("die Anzeige-Menge ist doch, was angezeigt wird"). Sie ist es nicht mehr:
			// seit `b45bc5cfa` (Owner-Beispiel „Perz") zeichnet JEDER Kartenaufruf
			// `avesmapsGaretienAufDerKarte()`, und die traegt zusaetzlich das ANGEKLICKTE, aber noch
			// nicht angezeigte Objekt (siehe deren Kommentar). Die zwei Mengen unterscheiden sich also
			// um genau EIN Objekt -- und das ist ausgerechnet das, auf das der Editor gerade schaut.
			// Mit `avesmapsGaretienAnzeigeListe()` liesse sich eine Ebene Wege/Grenzen/Sonstiges
			// anklicken (die per RULING R3/R9 immer neutral sind) und die Bilanzzeile bliebe stumm,
			// waehrend die Karte das Objekt sichtbar golden zeichnet -- die Meldung behauptete "nichts
			// ist neutral", genau waehrend der Editor auf ein neutrales Objekt blickt. Derselbe Zug
			// wie in `garetienAnzeigeNeuZeichnen` (oben): DIE Menge, die tatsaechlich gezeichnet wird.
			balanceEl.innerHTML = avesmapsGaretienBalanceZeileText(a.gesamt, basisDesReiters)
				+ (leuchtenAnzahl > 0
					? ' · <span class="lit">✦ ' + leuchtenAnzahl + " leuchten</span>"
					: "")
				+ garetienNeutralHinweisMarkup(avesmapsGaretienAufDerKarte(objekte));
		}

		// Aufgabe 5: der Fussknopf traegt „n von m" der ANZEIGE-MENGE, nicht mehr die Zahl der
		// angehakten Items -- „Nur angezeigte koennen uebernommen werden" (Owner). Die Anzeige ist
		// filterunabhaengig (Entwurf §3.1), deshalb wird hier NICHT `objekte` (die gefilterte Sicht)
		// gereicht, sondern dieselbe Menge, die auch auf der Karte liegt.
		garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
		// Aufgabe 10: „Alle markieren" traegt dagegen die Zahl der GERENDERTEN Zeilen -- `objekte`
		// ist genau die aktuelle (gefilterte, gedeckelte) Ansicht, nicht die Anzeige-Menge.
		garetienAlleMarkierenKnopfSetzen(objekte);
		// Meldung C (30.08.2026): „Markierte zurücknehmen" -- dieselbe gerenderte Liste, gefiltert
		// auf `zustand.markiert` UND den Reiter „Übernommen" (innerhalb der Funktion selbst).
		garetienRuecknahmeMengeKnopfSetzen(objekte);

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

	/*
	 * Was auf der Karte liegt: DIE ANZEIGE-MENGE -- und das ANGEKLICKTE dazu.
	 *
	 * 🔴 HIER STAND BIS ZUM 29.08.2026 `liste.filter(avesmapsGaretienHatAuswahl)`, also
	 * `items[].selected`. Ein Objekt OHNE Item hat kein Haekchen und war damit auf KEINE Weise
	 * sichtbar zu machen -- und das sind 7930 von 8213. Owner: „ich will, dass alles was
	 * importiert werden kann angezeigt werden kann."
	 *
	 * ⚠️ Entdoppelt ueber den Schluessel: das angeklickte Objekt liegt oft schon in der Anzeige,
	 * und zweimal gezeichnet ergaebe einen doppelt so kraeftigen Strich.
	 * ⚠️ Das ANGEKLICKTE kommt weiterhin dazu, ohne in die Menge zu wandern: eine Zeile ansehen
	 * soll die Anzeige nicht heimlich fuellen (dann waere „Anzeige leeren" nie wirksam).
	 */
	function avesmapsGaretienAufDerKarte(objekte) {
		const raus = avesmapsGaretienAnzeigeListe();
		if (zustand.detailKey === null) { return raus; }
		const schonDrin = raus.some(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		});
		if (schonDrin) { return raus; }
		const liste = objekte || zustand.objekte || [];
		const angeklickt = liste.filter(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		})[0];
		return angeklickt ? raus.concat([angeklickt]) : raus;
	}

	// 🔴 RULING R5 (Aufgabe 2, Luecke im Plan): der Reiter „Anzeigen" ist die CLIENT-Menge und wird
	// NIE beim Server erfragt -- `stand: "anzeigen"` steht nicht in AVESMAPS_GARETIEN_SERVER_STAENDE,
	// ein `stand: "anzeigen"` im Rumpf waere ein Filter auf einen Wert, den
	// `avesmapsGaretienListeObjektStand` nie liefert, und die Liste bliebe fuer immer leer.
	// Diese reine Funktion baut die "Antwort" aus der Anzeige-Menge nach, damit
	// avesmapsGaretienListeRendern denselben Weg nimmt wie nach einem echten Abruf -- kein
	// zweiter Rendercode fuer einen vierten Reiter.
	// 🔴 „Anzeigen" FILTERT NICHT (Entwurf §3.1): Suche und Filtertrichter wirken nur auf die drei
	// Server-Reiter, sonst laeuft die Liste der Karte auseinander -- deshalb liest diese Funktion
	// weder `zustand.filter` noch sonst einen Server-Wert.
	// ⚠️ Die uebrigen drei Reiterzahlen (offen/abgelehnt/uebernommen) und die Bilanz des LAUFS
	// kommen unveraendert aus der letzten echten Serverantwort -- „Anzeigen" hat davon keine
	// eigene Fassung, sie ist die einzige Zahl, die hier ueberschrieben wird.
	function garetienAnzeigenAntwortBauen(letzteAntwort) {
		const objekte = avesmapsGaretienAnzeigeListe();
		const vorher = letzteAntwort || {};
		return {
			objekte: objekte,
			gesamt: objekte.length,
			bilanz: vorher.bilanz || {},
			// `anzeigen` hier auf die eigene Groesse gesetzt: avesmapsGaretienBalanceZeileText
			// zeigt bei sichtbar >= gesamt nur "N Objekte", nie "N von M" -- die Anzeige filtert
			// nicht, also gibt es kein "von M" zu nennen.
			reiter: Object.assign({}, vorher.reiter || {}, { anzeigen: objekte.length }),
			facetten: vorher.facetten || {},
			angehakt: vorher.angehakt || {},
		};
	}

	// Der EINE Weg, auf dem die Liste sich aendert (Brief). Holt action:'liste' mit dem aktuellen
	// Filter und dem aktuellen Reiter, schreibt Liste/Bilanz/Reiter/Fusszeile neu und ruft
	// avesmapsGaretienKarteZeigen (Aufgabe 14) mit den angehakten Objekten. 🔴 Der Server ist die
	// Wahrheit ueber `selected` -- jede Handlung endet HIERMIT statt mit einer Rechnung im Browser.
	function avesmapsGaretienListeHolen() {
		const filter = zustand.filter || {};
		const stand = zustand.stand || "offen";
		zustand.stand = stand;

		if (stand === "anzeigen") {
			const antwort = garetienAnzeigenAntwortBauen(zustand.letzteAntwort);
			zustand.objekte = antwort.objekte;
			avesmapsGaretienListeRendern(antwort);
			if (typeof window !== "undefined"
				&& typeof window.avesmapsGaretienKarteZeigen === "function") {
				window.avesmapsGaretienKarteZeigen(avesmapsGaretienAufDerKarte());
			}
			return Promise.resolve(antwort);
		}

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
			// 💣 HIER, nicht nur in garetienLaufStarten (Aufgabe 12b). Wer das Fenster auf einem
			// BESTEHENDEN Lauf öffnet, hat nie „Holen & Rechnen" gedrückt -- `planRunId` bliebe
			// `null`, und jede Handlung aus Aufgabe 15 ginge mit `run_id: null` hinaus und käme als
			// 404 `not_found` zurück. Die Zahl steht in JEDER Listenantwort (`plan_run_id`,
			// api/_internal/import/garetien-liste.php); sie hier zu übernehmen kostet eine Zeile.
			// ⚠️ Der SERVER ist die Wahrheit, auch nach unten: eine zurückbehaltene alte Lauf-Nummer
			// zeigte nach einem neuen „Holen & Rechnen" auf einen zurückgezogenen Lauf, und der
			// antwortet mit 409 `plan_not_open` -- eine Fehlermeldung für einen Knopf, der richtig
			// gedrückt wurde.
			zustand.planRunId = Number(antwort.plan_run_id) || null;
			avesmapsGaretienListeRendern(antwort);
			// Fenster liest §14 defensiv: verschwindet, sobald KarteZeigen (Aufgabe 14) existiert.
			if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteZeigen === "function") {
				window.avesmapsGaretienKarteZeigen(avesmapsGaretienAufDerKarte());
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

	// Owner-Meldung 29.08.2026: Typen, aus denen wir ohnehin nichts holen (Beispiel "BurgKlein" --
	// Entscheidung "raus damit"), werden im Filter-Trichter blasser dargestellt, damit ein Editor
	// sieht, dass er dort nichts findet. ZWEI Kategorien, servergeliefert aus derselben Stelle wie
	// der Zeilen-Riegel (avesmapsGaretienTypKategorie in api/_internal/import/garetien-abgleich.php,
	// als facetten.typ_kategorie in garetien-liste.php) -- der Browser baut die Liste
	// (AVESMAPS_GARETIEN_OHNE_GEGENSTUECK) NICHT nach (AGENTS.md §5).
	// 🔴 Bis zum 29.08.2026 gab es eine dritte, 'spaetere_stufe' -- ENTFERNT, seit die Mapping-
	// Tabelle vollstaendig ist (Owner: „Stufen werden weder erklaert noch will ich, dass sie
	// verhindern, dass ich objekte importieren kann"). 'unbekannt' ist seither der einzige
	// Auffangfall und bekommt eine Erklaerung, die auch WAHR bleibt, wenn die Zuordnung waechst.
	const AVESMAPS_GARETIEN_TYP_KATEGORIE_TITEL = {
		ohne_gegenstueck: "Kein Gegenstück bei uns -- wird nicht importiert",
		unbekannt: "Für diesen Typ gibt es bei uns noch keine Zuordnung",
	};

	// REIN: aus den servergelieferten Facetten (Aufgabe 8, VOR dem Filtern gezaehlt) eine
	// Optionsliste fuer avmFilterMenuAttach bauen. 💣 Nimmt NUR das entgegen, was uebergeben wird
	// -- eine Auswahl im Trichter aendert die FACETTEN nicht, sonst faellt nach dem ersten Klick
	// jeder andere Wert auf 0 und der Trichter laesst sich nicht mehr oeffnen.
	function garetienFacettenOptionen(facetten, feld, labelFn) {
		const werte = (facetten && facetten[feld]) || {};
		// Nur der Objekttyp-Abschnitt kennt eine Kategorie -- Ebene/Urteil/Wiki bleiben unberuehrt.
		const kategorien = feld === "typ" ? ((facetten && facetten.typ_kategorie) || {}) : {};
		return Object.keys(werte).sort().map(function (wert) {
			const option = { value: wert, label: labelFn ? labelFn(wert) : wert, count: werte[wert] };
			const kategorie = kategorien[wert] || "";
			if (kategorie !== "") {
				option.muted = true;
				option.title = AVESMAPS_GARETIEN_TYP_KATEGORIE_TITEL[kategorie]
					|| "Wird nicht importiert";
			}
			return option;
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

	let garetienLetzteFacetten = { ebene: {}, typ: {}, urteil: {}, wiki: {}, typ_kategorie: {} };
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
		garetienLetzteFacetten = facetten || { ebene: {}, typ: {}, urteil: {}, wiki: {}, typ_kategorie: {} };
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
	// 🔴 LEER = ALLE 18 (Owner 29.08.2026). Vorher standen hier die zwei Gewaesserseiten, weil
	// Stufe 1 die einzige gemessene war -- das hiess aber, dass ein Editor jede weitere Ebene
	// einzeln anhaken und erneut „Holen & Rechnen" druecken musste.
	const garetienEbenenAuswahl = new Set();

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
		// 🔴 LEER HEISST ALLE (Owner 29.08.2026: „Waere es nicht praktischer 'Alle' zu holen
		// und immer anzuzeigen?"). Hier stand das Gegenteil, und es war MEIN Fehlentscheid:
		// „leer heisst nichts" sperrte den Nachbarknopf -- und weil der geteilte Trichter mit
		// seinem „Alle"-Haken die Menge LEERT, hiess ein Klick auf „Alle" in Wahrheit „keine
		// einzige". Alle 18 waren nur durch achtzehn einzelne Haken erreichbar.
		// ⭐ Mit der Hausform des Trichters (leer = kein Filter = alles) verschwindet der
		// Sonderfall ganz: der Knopf ist nie gesperrt, und „Alle" tut, was draufsteht.
		// ⚠️ Das Tor gegen falsche Objektarten (Wege-Subtyp `Bach`, die fuenf neuen Ortsarten)
		// haengt am UEBERNEHMEN, nicht am Holen: Staging und Plan schreiben in keine Nutztabelle.
		if (gewaehlt.length === 0) { return alle; }
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
		// 🔴 Leer heisst ALLE (siehe garetienGewaehlteBezeichner) -- die Kachel sagt es auch so,
		// sonst laese man „0 von 18" und hielte den Knopf fuer tot.
		if (gewaehlt.length === 0) { return alle.length + " von " + alle.length + " · alle"; }
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
		// 🔴 EINE EBENE JE ANFRAGE, nicht alle in einer. Der Abrufer haelt eine Hoeflichkeitspause
		// von einer Sekunde je Seite (AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN) -- alle 18 in EINEM
		// Ruf waeren rund 18 s Pause plus Abruf plus Rechnen und liefen auf STRATO in
		// `max_execution_time`. Der Endpunkt SETZT einen genannten Lauf fort (`run_id` im Rumpf),
		// die 18 Seiten werden also trotzdem EIN Lauf.
		// ⚠️ Der erste Ruf geht OHNE `run_id` -- er legt den Lauf an. Jeder weitere nennt ihn.
		// 💣 Ein Fehlschlag einer Ebene haelt die uebrigen NICHT auf: der Server macht es innerhalb
		// einer Anfrage genauso (`$fehler[]` statt Abbruch), und ein Lauf, der an Seite 7 von 18
		// stirbt, waere schlechter als einer mit sieben Meldungen.
		// 💣 EIGENE Variable, NICHT `zustand.importRunId`. Die traegt noch den Lauf des letzten
		// Klicks -- laese der erste Ruf daraus, setzte ein neues „Holen & Rechnen" den ALTEN Lauf
		// fort, und der Abgleich mischte zwei Importe. Genau davor warnte der Kommentar, der hier
		// vor dem Reihum-Umbau stand; der Test hat es gefangen (`9 !== undefined`).
		let laufId = null;
		return ebenen.reduce(function (kette, bezeichner, nr) {
			return kette.then(function () {
				garetienLaufSchritt = "holt " + (nr + 1) + " von " + ebenen.length + " …";
				malen();
				const rumpf = { action: "fetch", ebenen: [bezeichner] };
				if (laufId) { rumpf.run_id = laufId; }
				return rufe(GARETIEN_ENDPUNKT, rumpf)
					.then(function (antwort) {
						laufId = Number(antwort.run_id) || laufId;
						zustand.importRunId = laufId;
						garetienEbenenFehler = garetienEbenenFehler.concat(antwort.fehler || []);
					})
					.catch(function (fehler) {
						garetienEbenenFehler = garetienEbenenFehler.concat([
							{ ebene: bezeichner, grund: (fehler && fehler.message) || "Abruf fehlgeschlagen" },
						]);
					});
			});
		}, Promise.resolve())
			.then(function () {
				// 🔴 Kein einziger Lauf zustande gekommen -> nicht weiterrechnen. `plan` ohne
				// `run_id` antwortet mit 400 `no_run`, und das saehe im Netz-Protokoll wie ein
				// Defekt aus statt wie „alle 18 Seiten waren nicht erreichbar".
				if (!laufId) {
					garetienLaufMeldung = "Keine einzige Ebene konnte geholt werden.";
					return null;
				}
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
	// 💣 Das Geometrie-Item gehört NICHT dazu. Es hat seinen eigenen Knopf („Ausgewählte Segmente
	// ersetzen …", Aufgabe 15, umbenannt in Meldung A 30.08.2026) und startet immer ungehakt;
	// zählte es mit, stünde die Alke des Mockups (§6a) DREIWERTIG da, obwohl an ihr nichts halb
	// ist -- sie ist ein einzelner namenloser Abschnitt, und garetien-plan.php legt für jeden
	// LEGITIMEN Abschnitt ein eigenes Geometrie-Item an. Das Häkchen des Abschnitts ist das aus
	// Auftrag §5.3.3: „je Abschnitt ein Häkchen für ‚Namen übernehmen'" -- UND es ist seit
	// Meldung A zugleich die Auswahl für „Ausgewählte Segmente ersetzen"
	// (garetienAngehakteAbschnittIds liest dieselbe Menge).
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
	// ⚠️ Die 294 stammt aus dem Kopf von `avesmapsGaretienDeckung` (api/_internal/import/
	// garetien-abgleich.php, live gemessen 27.08.2026) und ist hier eine ABSCHRIFT. Sie steht
	// inzwischen an drei Stellen; nachgeprüft wird sie an der Quelle, nicht an einer Kopie.
	// ⚠️ 0 heißt „nicht gemessen" (ein Lauf von vor dem Nachzug), nicht „null Punkte": dann fällt
	// die Angabe weg, statt eine erfundene Zahl zu behaupten.
	function garetienPunkteText(punkte, nenner) {
		const gesamt = Number(nenner || 0);
		return gesamt > 0
			? String(Number(punkte || 0)) + " von " + gesamt + " Punkten"
			: garetienAnzahlText(Number(punkte || 0), "Punkt", "Punkte");
	}

	// REIN: der Kopf-Zusatz „Gebirge (garetien.de) → gebirge (Avesmaps)" -- IHR Typ samt IHRER
	// Quelle, und die Art, als die WIR es anlegen würden, samt UNSEREM Namen. Ohne die zwei
	// Klammern sagt der Pfeil nicht, wessen Vokabular welche Seite spricht -- bei "Gebirge →
	// gebirge" unterscheiden sich die beiden nur durch einen Großbuchstaben (Owner-Meldung
	// 30.08.2026).
	// ⚠️ Die Quelle ist NICHT immer "Garetien" -- die Objekte kommen aus ZWEI Wikis (`objekt.wiki`:
	// 'ggp'/'kosch'), und `garetienWikiLabel()` übersetzt das schon in "garetien.de"/"koschwiki.de".
	// Ein festgeschriebenes "Garetien" stünde bei jedem Kosch-Objekt falsch da.
	// ⚠️ Fehlt der Zielsubtyp (ein Objekt ohne Vorschlag, ein Lauf von vor dem Nachzug) oder ist er
	// mit ihrem Typ identisch, steht nur ihr Typ da -- UNBESCHRIFTET: ohne Pfeil gibt es nichts zu
	// unterscheiden, und ein leeres „(Avesmaps)" darf nie stehenbleiben.
	function garetienTypText(objekt) {
		const ihr = String((objekt && objekt.typ) || "").trim();
		const unser = String((objekt && objekt.subtyp) || "").trim();
		if (unser === "" || unser === ihr) { return ihr; }
		if (ihr === "") { return unser; }
		const quelle = garetienWikiLabel(String((objekt && objekt.wiki) || ""));
		const ihrBeschriftet = quelle === "" ? ihr : ihr + " (" + quelle + ")";
		return ihrBeschriftet + " → " + unser + " (" + AVESMAPS_GARETIEN_PARTEI_UNSERE + ")";
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
		// 🔴 Die Zeile trägt ihren `data-key` SELBST (Aufgabe 15) -- dieselbe Bauform wie „✦ Auf der
		// Karte zeigen". Der Klickverteiler des Häkchens findet sein Objekt damit ohne
		// `zustand.detailKey`, also ohne eine zweite Buchführung darüber, welche Ansicht offen ist.
		return "<" + tag + ' class="' + klassen + '" data-seg="' + avesmapsGaretienEscape(publicId) + '"'
			+ ' data-key="' + avesmapsGaretienEscape((objekt && objekt.key) || "") + '">'
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

	/*
	 * Die zwei Parteinamen auf den Sicht-Knöpfen.
	 *
	 * 💣 SIE STEHEN EIN ZWEITES MAL IN js/review/review-garetien-karte.js, in jedem Tooltip. Das ist
	 * ein GEKOPPELTER WERT in zwei Dateien und kein Versehen: dieses Fenster läuft auch auf Seiten
	 * ohne Karte (die Editorfenster laden den Zeichner nicht) und darf ihn nicht voraussetzen, und
	 * der Zeichner wird im Test allein geladen und kann dieses Fenster nicht voraussetzen. Ein
	 * Rückfall in eine der beiden Richtungen wäre genau die stille Divergenz, die ein gekoppelter
	 * Wert vermeiden soll — der Knopf hieße „Garetien" und der Tooltip etwas anderes, und der ganze
	 * Zweck dieser Aufgabe („welche Form gehört wem") wäre wieder offen. Zusammengehalten werden sie
	 * von js/review/__tests__/garetien-karte.test.js, das beide Exporte gegeneinander hält.
	 */
	const AVESMAPS_GARETIEN_PARTEI_IHRE = "Garetien";
	const AVESMAPS_GARETIEN_PARTEI_UNSERE = "Avesmaps";

	// Owner-Meldung 29.08.2026: „Avesmaps soll aber nur aktiviert sein, wenn was in der Naehe
	// desselben Typs gefunden wurde." -- der sichtbare Grund fuer den gesperrten Knopf. Sitzt neben
	// dem Knopf (`.gi-sicht__grund`), nicht nur im `title`: ein `disabled`-Element bekommt in Chrome
	// keine Zeigerereignisse mehr und zeigt seinen `title` deshalb nie -- dasselbe Mittel wie beim
	// gesperrten Fussknopf (`garetienUebernahmeKnopfZustand`) und der Filtersperre im Reiter
	// „Anzeigen" (`garetienAnzeigeFilterSperreSetzen`).
	const AVESMAPS_GARETIEN_SICHT_GESPERRT_GRUND = "Hier liegt nichts von uns.";

	/*
	 * Liegt in der uebergebenen Menge IRGENDWO unsere Geometrie? REIN -- kein DOM, keine Karte.
	 *
	 * 🔴 GEMESSEN WIRD AN DERSELBEN RECHNUNG, AUS DER DIE MAGENTA GEOMETRIE ENTSTEHT -- nicht an
	 * einer zweiten. `window.avesmapsGaretienUnsereIds` (review-garetien-karte.js) ist die Funktion,
	 * die auch beim Zeichnen entscheidet, welche unserer Abschnitte auf die Karte kommen; eine
	 * eigene Rechnung ueber `objekt.abschnitte` oder das Urteil liefe beim naechsten Sonderfall
	 * auseinander -- genau die Fehlerklasse, die dieses Vorhaben laut Auftrag heute schon zweimal
	 * gekostet hat (RULING R2/R7, task-6-report.md).
	 * ⚠️ Fehlt der Zeichner (Editorseiten ohne Karte), gibt es keine Auskunft ueber „gezeichnet" --
	 * dann bleibt der Knopf gesperrt, statt eine unbelegte Behauptung aufzustellen. Dieselbe
	 * zurueckhaltende Richtung wie bei `garetienNeutraleObjekte` nebenan.
	 */
	function garetienUnsereVorhanden(liste) {
		if (typeof window === "undefined" || typeof window.avesmapsGaretienUnsereIds !== "function") {
			return false;
		}
		return (liste || []).some(function (o) {
			return o && window.avesmapsGaretienUnsereIds(o).length > 0;
		});
	}

	/*
	 * REIN: die zwei farbigen Sicht-Knöpfe (Owner 29.08.2026: „mach zwei farbige knöpfe und jeder
	 * der knöpfe zeigt in seiner farbe seine fläche an oder blendet sie aus. Dann kann man direkt
	 * vergleichen was besser ist").
	 *
	 * 🔴 BEIDE STARTEN AN. `sicht` ist die GEMESSENE Auskunft des Zeichners (`display` der zwei
	 * Panes); fehlt sie — kein Zeichner, keine Karte —, gilt „an". `!== false` und nicht `=== true`:
	 * ein fehlendes Feld darf nicht als „aus" gelesen werden.
	 * 🔴 DER ZUSTAND STEHT NUR IN `aria-pressed`, in keiner zweiten Klasse. Der Klickverteiler setzt
	 * genau dieses eine Attribut nach, das CSS liest genau dieses eine — zwei Knöpfe für einen
	 * Zustand wären die Divergenz, an der im Haus schon das Anzeige-Menü der Karte gescheitert ist.
	 * ⚠️ Die Farbe sitzt auf dem FLECK, nicht auf der Schrift: farbige Schrift auf dem weichen
	 * Knopfgrund erreicht bei Gold (#f0b429) im hellen Thema keinen lesbaren Kontrast, ein 10px
	 * großer Fleck daneben braucht keinen.
	 * 🔴 NEU seit der Owner-Meldung 29.08.2026: `gesperrt` ist UNABHÄNGIG von `an` -- eine Sperre ist
	 * keine Abschaltung. `aria-pressed` bleibt der gemessene An/Aus-Stand der Pane und wird von der
	 * Sperre nicht berührt; ein gesperrter und wieder freigegebener Knopf hat seinen Stand deshalb
	 * automatisch behalten, ohne dass hier etwas dafür gemerkt werden muss.
	 */
	function garetienSichtKnopfMarkup(seite, text, an, gesperrt) {
		const deaktiviert = gesperrt === true;
		const titel = deaktiviert
			? AVESMAPS_GARETIEN_SICHT_GESPERRT_GRUND
			: (text + "-Geometrie auf der Karte ein- oder ausblenden");
		return '<button class="gi-sicht__knopf gi-sicht__knopf--' + seite + '" type="button"'
			+ ' data-sicht="' + seite + '" aria-pressed="' + (an ? "true" : "false") + '"'
			+ (deaktiviert ? " disabled" : "")
			+ ' title="' + avesmapsGaretienEscape(titel) + '">'
			+ '<span class="gi-sicht__fleck" aria-hidden="true"></span>'
			+ avesmapsGaretienEscape(text) + "</button>";
	}

	/*
	 * 🔴 „GARETIEN" BLEIBT UNBERÜHRT (Owner-Meldung 29.08.2026, Auftrag §„Was heute ist"): in der
	 * Anzeige liegt ihre Geometrie immer, sonst stünde die Zeile gar nicht in der Anzeige-Menge --
	 * nur „Avesmaps" bekommt die Sperre.
	 */
	function garetienSichtLeisteMarkup(sicht, unsereVorhanden) {
		const s = sicht || {};
		const unsereGesperrt = unsereVorhanden === false;
		const grundMarkup = unsereGesperrt
			? '<p class="gi-sicht__grund">' + avesmapsGaretienEscape(AVESMAPS_GARETIEN_SICHT_GESPERRT_GRUND)
				+ "</p>"
			: "";
		return '<div class="gi-sicht">'
			+ garetienSichtKnopfMarkup("ihre", AVESMAPS_GARETIEN_PARTEI_IHRE, s.ihre !== false, false)
			+ garetienSichtKnopfMarkup("unsere", AVESMAPS_GARETIEN_PARTEI_UNSERE, s.unsere !== false,
				unsereGesperrt)
			+ grundMarkup
			+ "</div>";
	}

	// REIN: die ganze rechte Spalte.
	//
	// 🔴 Der Knopf „✦ Zentrieren" (Aufgabe 14) trägt seinen `data-key` selbst. Er ist
	// damit ohne Modulzustand lesbar -- der Klickverteiler braucht weder `zustand.detailKey` noch
	// eine zweite Buchführung darüber, welche Ansicht gerade offen ist.
	// 🔴 Er hieß bis zum 29.08.2026 „✦ Auf der Karte zeigen — Ansicht folgt". Der Name war eine
	// Lüge geworden: seit `avesmapsGaretienAufDerKarte` das ANGEKLICKTE Objekt mitzeichnet, LIEGT es
	// schon auf der Karte, wenn dieser Knopf sichtbar ist — er bewegt nur noch die Ansicht dorthin.
	// Genau das verlangt der Owner („Dann darf die Kamera zu dem Objekt fliegen, das Objekt muss
	// leuchten"), und genau das leistet er zusammen mit jener Zeile. Ein zweiter Zeichenbefehl hier
	// wäre die zweite Regel darüber, was auf der Karte liegt.
	// 🔴 `unsereVorhanden` fehlt in den meisten bestehenden Aufrufen (Tests, die nur EIN Objekt
	// kennen) -- ohne Angabe fällt diese Funktion auf `garetienUnsereVorhanden([objekt])` zurück,
	// dieselbe Regel, nur ohne die übrige Anzeige-Menge. Der echte Aufrufer (`garetienDetailRendern`)
	// übergibt stattdessen IMMER die tatsächlich gezeichnete Menge (`avesmapsGaretienAufDerKarte`),
	// weil genau die -- und nicht das einzelne geöffnete Objekt -- entscheidet, was auf der Karte
	// liegt (Owner-Meldung 29.08.2026: „nur aktiviert, wenn was in der Nähe … gefunden wurde").
	function garetienDetailMarkup(objekt, sicht, unsereVorhanden) {
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
		// ⚠️ Ohne Geometrie gäbe es nichts anzufliegen -- dann steht der Knopf auch nicht da. Ein
		// Knopf, der nichts tut, ist eine sichtbare Störung (dieselbe Begründung, aus der er bis
		// Aufgabe 14 ganz fehlte).
		// 🔴 Und die zwei Sicht-Knöpfe stehen unter DERSELBEN Bedingung: sie schalten, was auf der
		// Karte liegt, und ohne Geometrie liegt von diesem Objekt nichts dort. Ein Bedienelement,
		// das an der geöffneten Zeile nichts bewirkt, ist genau die sichtbare Störung, aus der der
		// Knopf darüber schon einmal weggelassen wurde.
		if (Array.isArray(objekt.geometrie) && objekt.geometrie.length > 0) {
			kopf += '<button class="gi-show" type="button" data-key="'
				+ avesmapsGaretienEscape(objekt.key || "") + '">'
				+ "✦ Zentrieren</button>";
			kopf += garetienSichtLeisteMarkup(sicht, unsereVorhanden === undefined
				? garetienUnsereVorhanden([objekt])
				: unsereVorhanden);
		}

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

		// 🔴 Die Handlungsleiste ist ein GESCHWISTER der rollenden Ansicht, kein Kind (Aufgabe 15,
		// Mockup §3): `.avm-col` ist eine Flexspalte, `.gi-detail` rollt darin, und `.gi-acts`
		// steht als `flex: none` darunter fest. Läge sie IM Rollkasten, stünde die Entscheidung bei
		// 13 Abschnitten hinter der Bildlaufleiste.
		return '<div class="gi-detail">' + kopf + mitte + warum
			+ garetienQuellenMarkup(objekt) + "</div>"
			+ garetienHandlungsMarkup(objekt);
	}

	// ---- Aufgabe 15: die vier Handlungen ----------------------------------------------------------
	//
	// 🔴 „NEU EINFÜGEN" ERSCHEINT NUR, WO BEI UNS NICHTS LIEGT -- UND DAS URTEIL ENTSCHEIDET, NICHT
	// DIE NACHBARSCHAFT. Der Zufluss liegt auf seinem Hauptfluss und ist trotzdem `new`; 34 der 37
	// Widersprüche sind genau dieser Fall. Wer statt des Urteils fragt „liegt was in der Nähe",
	// bietet dort „Ersetzen" an -- und ein pauschales Ersetzen ersetzte die Natter durch ihren
	// Seitenarm: mit gültiger id und ohne Fehlermeldung.
	//
	// 🔴 REIN GERECHNET, DANN VERDRAHTET. garetienHandlungen(objekt) baut die Knopfleiste aus einer
	// Tafel, garetienHandlungsRumpf den Rumpf, der an die eine Tür geht -- beide ohne DOM und ohne
	// fetch. Nur so lässt sich am ERGEBNIS messen, welcher Knopf welche Items anhakt; eine
	// Zusicherung, die bloß behauptet, im Quelltext stehe ein `if`, wäre Vakuum.
	//
	// 🔴 ES WIRD NICHTS GESCHRIEBEN. Jede dieser Handlungen setzt ein Häkchen oder einen
	// Ablehnungsvermerk. In die Karte kommt erst „Angehakte übernehmen" (Aufgabe 16).

	// 🔴 Die Tafel aus dem Brief, Zeile für Zeile. Ein UNBEKANNTES Urteil bekommt nur „Ablehnen" --
	// die zurückhaltende Richtung: für ein Urteil, das dieser Code nicht kennt, wird keine
	// schreibende Handlung angeboten.
	// 🔴 Meldung B (30.08.2026, Owner): „ergaenzung" bekommt jetzt AUCH „neu" -- „bei bestehenden
	// Fläche, wo er Kollisionen erkannt hat ... kann ich Quelle + Artikel und Geometrie ersetzen
	// aber die Region nicht 'neu hinzufügen'". garetien-plan.php legt seither IMMER ein
	// Zusatz-Item (`anlass:'zusatz'`, `change_type:'new'`) neben den Ergänzungs-/Geometrie-Items
	// an -- dieselbe Prädikat-Funktion (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu) findet es, ohne
	// dass die Prädikate selbst etwas wissen müssten. „neu" steht VOR „ablehnen", aber NACH den
	// übrigen drei: es ist die begründete AUSNAHME, nicht der Normalfall dieser Zeile.
	const AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL = {
		neu: ["neu", "ablehnen"],
		// Der Nachbar ist der Hauptfluss, ihr Objekt der Seitenarm: ein NEUES Objekt, kein Ersatz.
		zweifel: ["neu", "ablehnen"],
		ergaenzung: ["name", "quelle", "geometrie", "neu", "ablehnen"],
		// Ihr Artikel trifft, ihre Geometrie nicht -- die Geometriefrage steht vorn.
		widerspruch: ["geometrie", "name", "ablehnen"],
		deckt_sich: ["ablehnen"],
		uebersprungen: ["ablehnen"],
	};

	// 🔴 Meldung A (30.08.2026, Owner): „Ausgewählte Segmente ersetzen" statt „Geometrie ersetzen
	// …" -- Owner-Wortlaut. Die Auslassungspunkte, die die Rückfrage ankündigen, stehen seither
	// NICHT mehr in dieser Tafel (sie kämen sonst VOR der Zahl zu stehen, „…(3)" statt „(3) …"),
	// sondern in AVESMAPS_GARETIEN_HANDLUNG_MIT_RUECKFRAGE weiter unten, die sie ans Ende hängt --
	// NACH der Zahl.
	const AVESMAPS_GARETIEN_HANDLUNG_BESCHRIFTUNG = {
		neu: "Neu einfügen",
		name: "Namen ersetzen",
		quelle: "Nur Quelle + Artikel",
		geometrie: "Ausgewählte Segmente ersetzen",
		ablehnen: "Ablehnen",
		wieder: "Wieder vorschlagen",
	};

	// Die Knöpfe, die ihre Zahl im Namen tragen. 🔴 „(n)" ist die Zahl der schon ANGEHAKTEN
	// Items dieses Knopfes, nicht die der möglichen -- so das Mockup §6d, wo „Namen ersetzen (0)"
	// neben „Nur Quelle + Artikel (6) ✓" steht, obwohl beide dieselben sechs Abschnitte betreffen
	// (die Umbenennungen starten ungehakt, die Quellen vorangehakt). Der Zustand steht damit IM
	// Knopf und nicht daneben.
	// 🔴 Meldung A (30.08.2026): „geometrie" ist jetzt DABEI -- seit die Handlung auf beliebig
	// viele angehakte Abschnitte zugleich wirkt, ist „welche der Angebote sind schon vorgemerkt"
	// dieselbe Frage wie bei „Namen ersetzen"/„Nur Quelle + Artikel".
	const AVESMAPS_GARETIEN_HANDLUNG_MIT_ZAHL = { name: true, quelle: true, geometrie: true };

	// Handlungen, die vor dem Senden eine Rückfrage zeigen, tragen „…" als Ankündigung -- immer
	// GANZ am Ende des Knopftexts, also NACH einer eventuellen Zahl (AVESMAPS_GARETIEN_HANDLUNG_
	// MIT_ZAHL). Eine eigene Tafel, weil die Auslassungspunkte sonst Teil der Beschriftung selbst
	// sein müssten und dann vor der Zahl stünden.
	const AVESMAPS_GARETIEN_HANDLUNG_MIT_RUECKFRAGE = { geometrie: true };

	// 💣 Die Knöpfe, die ein HÄKCHEN setzen -- und nur die dürfen „erledigt" (grün + ✓) werden.
	// In der Abnahme im Browser trug „Ablehnen" ein ✓ und den grünen Grund, sobald zufällig alle
	// Items angehakt waren: es las sich als „schon abgelehnt", während in Wahrheit das Gegenteil
	// galt (alles vorgemerkt). „Erledigt" heißt hier ausschließlich „die Items DIESES Knopfes sind
	// vorgemerkt" -- eine Ablehnung merkt nichts vor, sie hat gar keinen erledigten Zustand.
	const AVESMAPS_GARETIEN_HANDLUNG_HAKT_AN = {
		neu: true, name: true, quelle: true, geometrie: true,
	};

	function garetienItemAnlass(item) {
		return String((item && item.anlass) || "");
	}

	function garetienItemSchreibt(item, feld) {
		return ((item && item.felder) || []).indexOf(feld) !== -1;
	}

	// REIN: ist DIESES Item das Zusatz-Item -- "trotzdem neu anlegen" TROTZ erkannter Kollision
	// (Meldung B, 30.08.2026; garetien-plan.php haengt es an jedes 'deckt_sich'-Objekt, IMMER
	// ungehakt, `change_type:'new'`, `anlass:'zusatz'`)?
	//
	// 🔴 DIE EINE STELLE FUER DIESE FRAGE (Schadensfall 30.08.2026, Aufgabe 19/20). Bis hierher
	// beantwortete NUR `garetienNeuIstZusatz` (weiter unten) sie -- objektweise, fuer EINEN
	// Aufrufer (die Rueckfrage vor „Neu einfuegen"). Jeder Pfad, der Items zum ANHAKEN oder
	// UEBERNEHMEN SAMMELT, muss dasselbe Praedikat fragen und das Zusatz-Item ausschliessen --
	// sonst hakt eine Massenhandlung es MIT an, und ein Klick aendert dann gleichzeitig das
	// GETROFFENE Objekt (das legitime Ergaenzungs-Item) UND legt daneben eine Dublette an (das
	// Zusatz-Item). Genau das ist am 30.08.2026 mit „Alle angezeigten einfuegen" passiert: 3007
	// Objekte, viele davon Dubletten, weil `garetienHakenItems` das Zusatz-Item nicht kannte.
	// ⚠️ Der EINE legitime Weg zu diesem Item bleibt der Einzelknopf „Neu einfuegen" (der bei einer
	// Kollision zu „trotzdem neu anlegen" wird, siehe garetienNeuKlick) -- er fragt bewusst NICHT
	// dieses Praedikat, sondern `AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu`
	// (`change_type === 'new'`), das das Zusatz-Item WEITERHIN findet.
	function garetienItemIstZusatz(item) {
		return Boolean(item) && String((item && item.change_type) || "") === "new"
			&& garetienItemAnlass(item) === "zusatz";
	}

	// REIN: welche Abschnitte sind angehakt -- ihr Häkchen (dieselbe Menge, die
	// garetienAbschnittsItems/avesmapsGaretienCheckboxZustand der Abschnittszeile zugrunde legen)
	// steht auf VOLL, nicht auf „halb" oder „aus". Ein Abschnitt OHNE Item (Lage „nichts", das
	// Häkchen ist dort disabled) zählt nie mit -- er kann gar nicht angehakt werden.
	//
	// 🔴 Meldung A (30.08.2026, Owner): „Ausgewählte Segmente ersetzen" (vormals „Geometrie
	// ersetzen …") wirkt auf GENAU diese Menge. Der Owner widerspricht damit der alten Regel
	// („bei mehreren getroffenen Abschnitten hat Ersetzen kein Ziel") ausdrücklich: die
	// Einzelansicht zeigt jeden Abschnitt einzeln mit Häkchen, und „die angehakten SIND das
	// Ziel" (Owner-Wortlaut). Keine zweite Auswahl daneben -- dieselbe Fläche, die der Editor
	// ohnehin schon als Häkchen vor sich sieht.
	function garetienAngehakteAbschnittIds(objekt) {
		const abschnitte = (objekt && objekt.abschnitte) || [];
		return abschnitte
			.filter(function (abschnitt) {
				const publicId = String((abschnitt && abschnitt.public_id) || "");
				const items = garetienAbschnittsItems(objekt, publicId);
				return items.length > 0 && items.every(avesmapsGaretienItemIstAngehakt);
			})
			.map(function (abschnitt) { return String((abschnitt && abschnitt.public_id) || ""); });
	}

	// REIN: die Items, die ein HÄKCHEN bewegen darf -- alles außer dem Geometrie-Item UND dem
	// Zusatz-Item.
	// 💣 Das Geometrie-Item hat seinen eigenen Knopf mit Rückfrage und darf nie über ein Häkchen
	// gesetzt werden: ein Klick auf eine Listenzeile merkte sonst lautlos einen Geometrie-Ersatz
	// vor. Dieselbe Grenze zieht garetienAbschnittsItems für die Abschnittszeile -- beide Häkchen
	// meinen also dieselbe Menge.
	// 🔴 SCHADENSFALL 30.08.2026: das Zusatz-Item (garetienItemIstZusatz) gehört aus demselben
	// Grund NICHT hierher -- diese Funktion speist sowohl das Zeilenhäkchen als auch
	// `garetienAnzeigeAnhakenIds` (die Massenübernahme „Alle angezeigten einfügen"). Ein
	// Zusatz-Item, das hier mitliefe, würde bei jedem Klick auf diesen Knopf zusätzlich zur
	// Änderung am getroffenen Objekt eine Dublette anlegen -- „trotzdem neu anlegen" ist die
	// begründete AUSNAHME und bleibt dem Einzelknopf „Neu einfügen" vorbehalten
	// (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu fragt bewusst NICHT dieses Praedikat).
	function garetienHakenItems(objekt) {
		return ((objekt && objekt.items) || []).filter(function (item) {
			return garetienItemAnlass(item) !== "geometrie" && !garetienItemIstZusatz(item);
		});
	}

	// Welche Items gehören zu welchem Knopf?
	//
	// 🔴 UNTERSCHIEDEN WIRD AN DER NAMENSSPALTE, nicht am Anlass: „Nur Quelle + Artikel" ist
	// „dieselbe Handlung wie Namen ersetzen, nur mit abgewählter Namensspalte" (Brief). Ein
	// Lücken-Item trägt bei uns `felder: ['name','quelle']` -- am Anlass ('ergaenzung') gemessen
	// landete es unter „Nur Quelle", und der Knopf schriebe den Namen mit, den sein eigener Name
	// ausschließt. Am `felder` gemessen kommen die zwei Beispiele des Mockups genau so heraus, wie
	// sie dort stehen: die Alke „Namen ersetzen (1) ✓", die Angbarer Reichsstraße
	// „Namen ersetzen (0)" + „Nur Quelle + Artikel (6) ✓".
	// ⚠️ `change_type` reist seit dem 28.08.2026 je Item mit (garetien-liste.php). Fehlt es (eine
	// ältere Antwort), findet „Neu einfügen" nichts und graut sich mit Grund aus -- die sichere
	// Richtung.
	const AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG = {
		neu: function (item) { return String((item && item.change_type) || "") === "new"; },
		name: function (item) { return garetienItemSchreibt(item, "name"); },
		quelle: function (item) {
			return garetienItemSchreibt(item, "quelle") && !garetienItemSchreibt(item, "name");
		},
		// 🔴 Meldung A (30.08.2026): NICHT mehr jedes Geometrie-Item des Objekts -- nur die, deren
		// EIGENER Abschnitt angehakt ist (garetienAngehakteAbschnittIds). Ein Abschnitt ohne
		// Häkchen darf seine Geometrie nicht verlieren, nur weil ein ANDERER Abschnitt desselben
		// Objekts angehakt wurde. ⚠️ Zweiter Parameter `objekt` -- garetienHandlungBauen reicht
		// ihn ausdrücklich durch, alle übrigen Prädikate ignorieren ihn einfach.
		geometrie: function (item, objekt) {
			if (garetienItemAnlass(item) !== "geometrie") { return false; }
			const angehakt = garetienAngehakteAbschnittIds(objekt);
			const publicId = String((item && item.abschnitt && item.abschnitt.public_id) || "");
			return angehakt.indexOf(publicId) !== -1;
		},
		ablehnen: function () { return true; },
		wieder: function () { return true; },
	};

	// REIN: warum ein Knopf ausgegraut ist -- "" heißt „er ist bedienbar".
	// 💣 Ein ausgegrauter Knopf muss sagen, warum. Ein Knopf ohne Grund ist von einem kaputten
	// Knopf nicht zu unterscheiden.
	function garetienHandlungGrund(name, objekt, items) {
		const abschnitte = (objekt && objekt.abschnitte) || [];
		if (name === "geometrie") {
			// 🔴 Meldung A (30.08.2026, Owner): NICHT MEHR DIE ZAHL DER GETROFFENEN ABSCHNITTE
			// ENTSCHEIDET -- OB WELCHE ANGEHAKT SIND. Bis dahin stand hier "die Zahl der Abschnitte
			// entscheidet", mit der Begründung, „ersetze die Geometrie" habe bei mehreren kein
			// wohldefiniertes Ziel. Der Owner widerspricht: die angehakten Abschnitte SIND das
			// Ziel, egal wie viele insgesamt getroffen wurden.
			if (abschnitte.length === 0) {
				return "der Abgleich hat keinen Abschnitt von uns getroffen — es gibt hier keine "
					+ "Geometrie zu ersetzen";
			}
			if (garetienAngehakteAbschnittIds(objekt).length === 0) {
				return "kein Abschnitt ist angehakt — „Ausgewählte Segmente ersetzen\" hätte dann "
					+ "kein Ziel";
			}
			return items.length === 0
				? "dieser Lauf trägt keinen Geometrie-Vorschlag für die angehakten Abschnitte"
				: "";
		}
		if (items.length > 0) { return ""; }
		if (name === "neu") {
			return "dieser Lauf trägt für dieses Objekt keinen Vorschlag „neu anlegen\"";
		}
		if (name === "name") {
			return "an keinem getroffenen Abschnitt würde ein Name geschrieben";
		}
		if (name === "quelle") {
			return "kein Abschnitt, an dem sich Quelle und Artikel OHNE den Namen ergänzen ließen";
		}
		// 🔧 „Ablehnen" ohne ein einziges Item: „deckt sich" und „übersprungen" erzeugen keinen
		// sync_plan_item, und ohne Item gibt es nichts, worauf eine Ablehnung zeigen könnte -- der
		// Bearbeitungsstand solcher Zeilen kommt gar nicht aus `sync_decision`
		// (garetien-liste.php gibt ihnen fest `'offen'`). Ein Knopf, der schreibt und nichts
		// bewirkt, ist schlimmer als ein ausgegrauter, der sagt warum. Das ist die andere Hälfte
		// von Ruling R10 („Offen kann nie 0 werden"); sie ist eine Entscheidung des Owners und
		// steht offen -- hier wird deshalb nichts erfunden, sondern benannt.
		return "dieses Objekt hat gar keinen Vorschlag — es steht in der Liste, damit die Zahl "
			+ "nachprüfbar bleibt";
	}

	// REIN: EIN Knopf, mit seinen Items, seiner Zahl und seinem Grund.
	function garetienHandlungBauen(name, objekt) {
		const passt = AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG[name]
			|| function () { return false; };
		// ⚠️ `objekt` reist als ZWEITES Argument mit -- nur „geometrie" braucht es (welche
		// Abschnitte sind angehakt), die übrigen Prädikate ignorieren es einfach.
		const items = ((objekt && objekt.items) || []).filter(function (item) {
			return passt(item, objekt);
		});
		const ids = items
			.map(function (item) { return Number(item && item.id); })
			.filter(function (id) { return id > 0; });
		const angehakt = items.filter(avesmapsGaretienItemIstAngehakt).length;
		const grund = garetienHandlungGrund(name, objekt, items);
		let beschriftung = AVESMAPS_GARETIEN_HANDLUNG_BESCHRIFTUNG[name] || name;
		if (AVESMAPS_GARETIEN_HANDLUNG_MIT_ZAHL[name]) {
			beschriftung += " (" + angehakt + ")";
		}
		if (AVESMAPS_GARETIEN_HANDLUNG_MIT_RUECKFRAGE[name]) {
			beschriftung += " …";
		}

		return {
			name: name,
			beschriftung: beschriftung,
			// 🔴 „Ablehnen" trägt --color-danger als SCHRIFT, nie als Füllung: die eine gefüllte
			// Handlung dieses Fensters heißt „Angehakte übernehmen" und steht im Fuß. Eine
			// Zeilenhandlung ist nie die Haupthandlung der Seite (AGENTS.md §12).
			ton: name === "ablehnen" ? "danger" : "",
			ids: ids,
			angehakt: angehakt,
			gesamt: items.length,
			erledigt: AVESMAPS_GARETIEN_HANDLUNG_HAKT_AN[name] === true
				&& items.length > 0 && angehakt === items.length,
			disabled: grund !== "",
			grund: grund,
		};
	}

	// ---- Aufgabe 9: „Zurücknehmen" -- der EINE Löschweg dieses Fensters ---------------------------
	// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md
	//
	// 🔴 NUR EIN 'new'-ITEM HAT WIRKLICH ETWAS ANGELEGT. Ein 'changed'-Item hat ein BESTEHENDES
	// Objekt verändert (Namen ersetzen/Geometrie ersetzen) -- das gehörte uns schon vor dem Import,
	// und sein Löschen wäre Datenverlust an fremder Arbeit (Owner-Entscheid 1). Der Server prüft
	// dasselbe ein zweites Mal (avesmapsGaretienRuecknahmeAusfuehren) -- eine Sperre nur im Browser
	// ist keine.
	//
	// 🔴 MELDUNG (30.08.2026): DIE ENGE AUSNAHME. Ein 'changed'-Item, dessen `felder` GENAU
	// `['quelle']` ist, hat NICHTS Unwiederbringliches verändert -- avesmapsGaretienErgaenzungAnwenden
	// tut in diesem Fall ausschließlich avesmapsGaretienQuelleAnlegen, keinen einzigen
	// Update-Aufruf an Name oder Geometrie (garetien-uebernahme.php). Der Riegel wird dadurch ENGER
	// formuliert, nicht aufgehoben: „hat nichts Unwiederbringliches verändert" statt „ist neu" --
	// sobald 'name' oder 'geometrie' mit in `felder` steht, gilt Owner-Entscheid 1 unverändert.
	function garetienItemIstQuelleNur(item) {
		const felder = (item && item.felder) || [];
		return felder.length === 1 && String(felder[0]) === "quelle";
	}

	function garetienRuecknahmeFaehig(item) {
		if (!item || item.apply_state !== "done") { return false; }
		const changeType = String(item.change_type || "");
		if (changeType === "new") { return true; }
		return changeType === "changed" && garetienItemIstQuelleNur(item);
	}

	// 🔴 PLURAL, NICHT NUR DAS ERSTE TREFFENDE ITEM. Ein Weg mit mehreren Abschnitten kann MEHRERE
	// eigenständige 'quelle'-Items tragen (je Abschnitt eines), alle am selben "Objekt" der Liste --
	// live gemessen an der Meldung selbst: 372 Items an 312 Objekten, also trägt ein Teil der
	// Objekte mehr als eines. `avesmapsGaretienListeObjektStand` erklärt das Objekt schon
	// "übernommen", sobald IRGENDEIN Item 'done' ist -- eine Rücknahme, die nur EINES davon
	// zurücksetzt, ließe das Objekt fälschlich in "Übernommen" stehen.
	function garetienRuecknahmeItems(objekt) {
		return ((objekt && objekt.items) || []).filter(garetienRuecknahmeFaehig);
	}

	function garetienRuecknahmeItem(objekt) {
		return garetienRuecknahmeItems(objekt)[0] || null;
	}

	// REIN: die EINE Rücknahme-Zeile eines übernommenen Objekts -- ein Knopf (mindestens ein
	// rücknehmbares Item ist da), oder ein Grund an seiner Stelle (Owner-Entscheid 1: „Kein Knopf,
	// sondern ein sichtbarer Grund" -- kein AUSGEGRAUTER Knopf, der eine grundsätzliche Möglichkeit
	// behauptete).
	function garetienRuecknahmeBauen(objekt) {
		const items = garetienRuecknahmeItems(objekt);
		if (items.length === 0) {
			return {
				name: "ruecknahme", beschriftung: "Zurücknehmen", ton: "danger",
				ids: [], angehakt: 0, gesamt: 0, erledigt: false, disabled: true,
				grund: "Verändert ein bestehendes Objekt — nicht rücknehmbar.",
			};
		}
		return {
			name: "ruecknahme", beschriftung: "Zurücknehmen", ton: "danger",
			ids: items.map(function (item) { return item.id; }),
			angehakt: 0, gesamt: items.length, erledigt: false, disabled: false, grund: "",
		};
	}

	// REIN: die ganze Knopfleiste EINES Objekts.
	function garetienHandlungen(objekt) {
		const o = objekt || {};
		// 🔴 Eine abgelehnte Zeile hat GENAU EINEN Ausgang zurück. Alles andere daneben zu zeigen
		// hieße, an einem Objekt weiterzuarbeiten, das aus dem Arbeitsvorrat heraus ist -- und eine
		// Ablehnung ohne Rückweg wäre ein schwarzes Loch (Entwurf §5).
		if (String(o.stand || "") === "abgelehnt") {
			return [garetienHandlungBauen("wieder", o)];
		}
		// Aufgabe 9: ein übernommenes Objekt bekommt STATT der urteilsabhängigen Knöpfe die eine
		// Rücknahme-Zeile -- ein 'changed'-Objekt (kein "neu"-Item) zeigt dabei gar keinen Knopf,
		// nur den Grund (garetienRuecknahmeBauen).
		if (String(o.stand || "") === "uebernommen") {
			return [garetienRuecknahmeBauen(o)];
		}
		const namen = AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL[String(o.urteil || "")] || ["ablehnen"];
		return namen.map(function (name) { return garetienHandlungBauen(name, o); });
	}

	// REIN: die Rückfrage vor „Ausgewählte Segmente ersetzen" -- sie NENNT DIE FOLGE BEIM NAMEN,
	// statt „Sind Sie sicher?" zu fragen. Was ersetzt würde, steht darin, und dass jetzt noch
	// nichts geschrieben wird, auch.
	//
	// 🔴 Meldung A (30.08.2026, Owner): SEIT MEHRERE ABSCHNITTE ZUGLEICH ANGEHAKT SEIN KÖNNEN,
	// NENNT SIE DEREN ZAHL -- „abschnitte[0]" war das ganze Bild nur, solange „ersetzen" auf
	// maximal einen Abschnitt wirken konnte. Betroffen sind GENAU die angehakten
	// (garetienAngehakteAbschnittIds), nicht alle getroffenen.
	function garetienGeometrieRueckfrageText(objekt) {
		const o = objekt || {};
		const angehaktIds = garetienAngehakteAbschnittIds(o);
		const betroffene = (o.abschnitte || []).filter(function (abschnitt) {
			return angehaktIds.indexOf(String((abschnitt && abschnitt.public_id) || "")) !== -1;
		});
		const punkte = Array.isArray(o.geometrie) ? o.geometrie.length : 0;
		const folge = "wird beim Übernehmen durch den aus " + garetienWikiLabel(String(o.wiki || ""))
			+ " ersetzt — " + garetienAnzahlText(punkte, "Stützpunkt", "Stützpunkte") + ".";

		// Der Regelfall: EIN angehakter Abschnitt -- derselbe Wortlaut wie vor Meldung A. Ein
		// leeres `betroffene` (sollte der Knopf gar nicht erst anbieten) fällt auf den ersten
		// getroffenen Abschnitt zurück, statt eine leere Rückfrage zu zeigen.
		if (betroffene.length <= 1) {
			const abschnitt = betroffene[0] || (o.abschnitte || [])[0] || {};
			const publicId = String(abschnitt.public_id || "");
			const unser = String(abschnitt.name || "").trim();
			return "Der Verlauf von "
				+ (unser === "" ? publicId + " (ohne Namen)" : "„" + unser + "\" (" + publicId + ")")
				+ " " + folge + "\n\n"
				+ "Jetzt wird nur vorgemerkt. Geschrieben wird erst mit „Angehakte übernehmen\".";
		}

		// 💣 MEHRERE Abschnitte bekommen DENSELBEN Verlauf -- avesmapsGaretienAbschnittsEintrag
		// ändert `after.geometry` nicht (garetien-plan.php). Genau deshalb nennt die Rückfrage
		// jeden betroffenen Abschnitt beim Namen, statt nur eine Zahl zu zeigen.
		const namen = betroffene.map(function (abschnitt) {
			const publicId = String((abschnitt && abschnitt.public_id) || "");
			const unser = String((abschnitt && abschnitt.name) || "").trim();
			return unser === "" ? publicId + " (ohne Namen)" : "„" + unser + "\" (" + publicId + ")";
		}).join(", ");

		return "Der Verlauf von " + garetienAnzahlText(betroffene.length, "Abschnitt", "Abschnitte")
			+ " (" + namen + ") " + folge + "\n\n"
			+ "Jetzt wird nur vorgemerkt. Geschrieben wird erst mit „Angehakte übernehmen\".";
	}

	// REIN: der Rumpf, den EIN Knopf an die eine Tür schickt -- oder `null`.
	function garetienHandlungsRumpf(name, objekt, runId) {
		const knopf = garetienHandlungen(objekt).filter(function (h) { return h.name === name; })[0];
		if (!knopf || knopf.disabled || knopf.ids.length === 0) { return null; }
		if (name === "ablehnen" || name === "wieder") {
			return {
				action: name === "ablehnen" ? "decline" : "undecline",
				kind: GARETIEN_PLAN_ART,
				run_id: runId,
				ids: knopf.ids,
			};
		}
		// 💣 NUR DIE GEOMETRIE SCHALTET UM. Sie ist die einzige Handlung ohne eigenes Häkchen --
		// ohne das Umschalten gäbe es keinen Rückweg, und der Ablauf (Mockup §8) sagt ausdrücklich
		// „rückgängig: ja". Die übrigen Knöpfe haken nur AN; zurückgenommen wird dort an der
		// Abschnittszeile, die direkt darüber steht.
		return {
			action: "select",
			kind: GARETIEN_PLAN_ART,
			run_id: runId,
			ids: knopf.ids,
			selected: name === "geometrie" ? !knopf.erledigt : true,
		};
	}

	// REIN: welche Items bewegt EIN Häkchen -- und in welche Richtung?
	// 🔴 Die Richtung kommt aus dem SERVERSTAND (`selected`), nie aus `feld.checked`: der Browser
	// hat das Kästchen beim Klick schon umgeschaltet, und zwei Buchhaltungen laufen beim ersten
	// Abbruch auseinander. Dreiwertig (halb angehakt) heißt „alle anhaken" -- die aufbauende
	// Richtung, wie bei jedem dreiwertigen Häkchen.
	function garetienHakenPlan(objekt, publicId) {
		const items = (publicId === null || publicId === undefined || publicId === "")
			? garetienHakenItems(objekt)
			: garetienAbschnittsItems(objekt, publicId);
		const ids = items
			.map(function (item) { return Number(item && item.id); })
			.filter(function (id) { return id > 0; });
		if (ids.length === 0) { return null; }

		return { ids: ids, selected: !items.every(avesmapsGaretienItemIstAngehakt) };
	}

	function garetienHakenRumpf(objekt, publicId, runId) {
		const plan = garetienHakenPlan(objekt, publicId);
		if (!plan) { return null; }

		return {
			action: "select",
			kind: GARETIEN_PLAN_ART,
			run_id: runId,
			ids: plan.ids,
			selected: plan.selected,
		};
	}

	// REIN: die Knopfleiste als Markup. Sie ist ein GESCHWISTER von `.gi-detail`, nicht ihr Kind --
	// so hängt sie als `flex: none` am Fuß der Spalte, während die Ansicht darüber rollt.
	// 🔴 ANGEHEFTET, NICHT IM FLUSS: bei 13 Abschnitten läge die Entscheidung sonst hinter der
	// Bildlaufleiste.
	function garetienHandlungsMarkup(objekt) {
		const knoepfe = garetienHandlungen(objekt);
		if (knoepfe.length === 0) { return ""; }
		const schluessel = avesmapsGaretienEscape((objekt && objekt.key) || "");
		const gruende = [];
		const knopfMarkup = knoepfe.map(function (k) {
			// Aufgabe 9 (Owner-Entscheid 1): ein 'changed'-Objekt bekommt an dieser Stelle GAR
			// KEINEN Knopf, nur den sichtbaren Grund -- anders als bei den übrigen Handlungen, deren
			// Sperre nur den AKTUELLEN Zustand betrifft (ein ausgegrauter Knopf würde hier eine
			// grundsätzliche Möglichkeit behaupten, die es für dieses Objekt nicht gibt).
			if (k.name === "ruecknahme" && k.disabled) {
				gruende.push(k.grund);
				return "";
			}
			let klasse = "btn";
			if (k.ton === "danger") { klasse += " btn--danger"; }
			if (k.erledigt) { klasse += " btn--done"; }
			let attribute = ' class="' + klasse + '" type="button"'
				+ ' data-handlung="' + avesmapsGaretienEscape(k.name) + '"'
				+ ' data-key="' + schluessel + '"';
			if (k.disabled) {
				attribute += ' disabled title="' + avesmapsGaretienEscape(k.grund) + '"';
				// ⚠️ Ohne die Auslassungspunkte: „Ausgewählte Segmente ersetzen (0) …: kein
				// Abschnitt ist angehakt …" liest sich wie ein abgebrochener Satz. Das „…" gehört
				// auf den Knopf (es kündigt die Rückfrage an), nicht in einen Satz über ihn.
				gruende.push(k.beschriftung.replace(/\s*…$/, "") + ": " + k.grund);
			}
			return "<button" + attribute + ">" + avesmapsGaretienEscape(k.beschriftung)
				+ (k.erledigt ? " ✓" : "") + "</button>";
		}).join("");
		// ⚠️ Der Grund steht AUCH sichtbar da, nicht nur im `title`: ein Tooltip erscheint nur, wer
		// mit dem Zeiger darauf verweilt -- und am Telefon gar nicht.
		const grundZeile = gruende.length === 0 ? ""
			: '<p class="gi-acts__grund">'
				+ gruende.map(function (text) {
					return "<span>" + avesmapsGaretienEscape(text) + "</span>";
				}).join("")
				+ "</p>";

		return '<div class="gi-acts">' + knopfMarkup + grundZeile + "</div>";
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
		// 🔴 Der Stand der zwei Sicht-Knöpfe wird beim Rendern GEMESSEN, nicht gemerkt: er steht im
		// `display` der zwei Karten-Panes, und diese Spalte wird bei jedem Zeilenklick neu gebaut.
		// Ein Modulzustand daneben liefe beim ersten Fenster-Schließen auseinander (dort setzt
		// `avesmapsGaretienKarteAus` beide wieder auf sichtbar).
		const sicht = (typeof window !== "undefined"
			&& typeof window.avesmapsGaretienKarteSicht === "function")
			? window.avesmapsGaretienKarteSicht()
			: null;
		// 🔴 Owner-Meldung 29.08.2026: „Avesmaps" ist nur bedienbar, wenn in der Menge, die
		// TATSÄCHLICH auf der Karte liegt, wirklich unsere Geometrie steckt -- DIESELBE Menge, die
		// `window.avesmapsGaretienKarteZeigen` bekommt (`avesmapsGaretienAufDerKarte`), nicht
		// `objekte` allein (der aktive Reiter) und nicht `avesmapsGaretienAnzeigeListe()` allein (die
		// vergisst das angeklickte, noch nicht angezeigte Objekt). Wird bei JEDEM Aufbau dieser
		// Spalte neu gemessen, nicht nur beim ersten Öffnen -- „Markierte anzeigen" und „Anzeige
		// leeren" ändern diese Menge, ohne das angeklickte Objekt zu wechseln.
		const unsereVorhanden = garetienUnsereVorhanden(avesmapsGaretienAufDerKarte(objekte));
		spalte.innerHTML = garetienDetailMarkup(gewaehlt, sicht, unsereVorhanden);
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
		// 🔴 UND DIE KARTE. Das angeklickte Objekt wird gezeichnet, nicht nur angeflogen -- ohne
		// diese Zeile ist ein UEBERSPRUNGENES Objekt auf keine Weise sichtbar zu machen, denn es
		// hat gar kein Haekchen (Owner-Meldung 29.08.2026, Beispiel „Perz").
		// ⚠️ Hier und nicht in `avesmapsGaretienListeHolen`: ein Zeilenklick fragt den Server
		// nicht, er ist reine Anzeige. Ohne den Ruf hier bliebe die Karte bis zur naechsten
		// Serverantwort auf dem vorigen Stand.
		if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteZeigen === "function") {
			window.avesmapsGaretienKarteZeigen(avesmapsGaretienAufDerKarte(objekte));
		}
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

	// 🔴 Derselbe Bau wie garetienListeKlick: Ereignis UND Objektliste kommen HEREIN, damit sich am
	// ERGEBNIS messen lässt, dass der Knopf GENAU sein Objekt anfliegt -- und dass ein Klick daneben
	// gar nichts auslöst. Eine Zusicherung, die bloß behauptet, im Quelltext stehe ein `if`, wäre
	// Vakuum.
	//
	// 💣 Er bewegt NUR die Ansicht. Der Glow hängt am Häkchen (Owner 27.08.2026) und wird hier
	// nicht angefasst -- weder gesetzt noch gelöscht.
	function garetienDetailKlick(ereignis, objekte) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		// Die zwei Sicht-Knöpfe. 🔴 `aria-pressed` wird aus dem ZURÜCKGEGEBENEN Stand nachgezogen,
		// nicht aus dem Klick: ohne Karte (Editorseiten) hat der Zeichner nichts umgeschaltet, und
		// dann darf der Knopf es auch nicht behaupten.
		const sichtKnopf = ziel.closest("[data-sicht]");
		if (sichtKnopf) {
			// ⚠️ `disabled` wird hier NOCH EINMAL geprüft: das Attribut ist die Anzeige, nicht der
			// Riegel -- dieselbe Trennung wie beim Handlungsknopf (`garetienHandlungKlick`) und beim
			// Häkchen (`garetienHakenKlick`). „Avesmaps" ohne unsere Geometrie in der Anzeige-Menge
			// darf auch dann nichts umschalten, wenn ihn ein Test oder ein synthetisches Ereignis
			// direkt anklickt, statt ihn dem echten Browser zu überlassen.
			if (sichtKnopf.disabled) { return null; }
			const seite = sichtKnopf.getAttribute("data-sicht");
			if (typeof window === "undefined"
				|| typeof window.avesmapsGaretienKarteUmschalten !== "function") {
				return null;
			}
			const stand = window.avesmapsGaretienKarteUmschalten(seite) || {};
			sichtKnopf.setAttribute("aria-pressed", stand[seite] === false ? "false" : "true");
			return stand;
		}
		const knopf = ziel.closest(".gi-show");
		if (!knopf) { return null; }
		const schluessel = knopf.getAttribute("data-key");
		if (!schluessel) { return null; }
		const objekt = (objekte || zustand.objekte || []).filter(function (o) {
			return o && String(o.key) === String(schluessel);
		})[0] || null;
		if (!objekt) { return null; }
		if (typeof window !== "undefined" && typeof window.avesmapsGaretienKarteFliegen === "function") {
			window.avesmapsGaretienKarteFliegen(objekt);
		}
		return objekt;
	}

	// ---- Aufgabe 15: die Verdrahtung --------------------------------------------------------------

	// REIN: das Objekt zu einem Schlüssel.
	function garetienObjektNach(schluessel, objekte) {
		if (schluessel === null || schluessel === undefined || schluessel === "") { return null; }
		return (objekte || []).filter(function (o) {
			return o && String(o.key) === String(schluessel);
		})[0] || null;
	}

	// 🔴 Ereignis, Objektliste, Lauf-Nummer UND die Werkzeuge kommen HEREIN -- derselbe Bau wie
	// garetienLaufStarten und garetienDetailKlick, aus demselben Grund: nur so lässt sich am
	// ERGEBNIS messen, WAS hinausgeht und WANN gar nichts hinausgeht.
	//
	// 💣 Die Rückfrage steht VOR dem Senden und nur beim ANHAKEN. Eine Vormerkung zurückzunehmen
	// ist die sichere Richtung und fragt niemanden.
	function garetienHandlungKlick(ereignis, objekte, runId, senden, fragen) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest("[data-handlung]");
		// ⚠️ `disabled` wird hier NOCH EINMAL geprüft: das Attribut ist die Anzeige, nicht der
		// Riegel -- dieselbe Trennung wie beim Ebenen-Riegel in garetienLaufStarten.
		if (!knopf || knopf.disabled) { return null; }
		const objekt = garetienObjektNach(knopf.getAttribute("data-key"), objekte);
		if (!objekt) { return null; }
		const name = knopf.getAttribute("data-handlung");
		const rumpf = garetienHandlungsRumpf(name, objekt, runId);
		if (!rumpf) { return null; }
		if (name === "geometrie" && rumpf.selected === true
			&& !fragen(garetienGeometrieRueckfrageText(objekt))) {
			return null;
		}
		return senden(rumpf);
	}

	// ---- Aufgabe 8: „Neu einfügen" ist ein Erzeuger der EINEN Einfüge-Funktion weiter unten --------
	// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-8-brief.md
	//
	// 🔴 EIN EIGENER VERTEILER, kein sechster Parameter an garetienHandlungKlick: die vier übrigen
	// Handlungen (Namen ersetzen/Nur Quelle/Geometrie ersetzen/Ablehnen/Wieder vorschlagen) bleiben
	// unverändert reines Vormerken -- der Brief nennt nur „Neu einfügen" und den Fußknopf als
	// Schreibwege, die WIRKLICH übernehmen. Er steht VOR garetienHandlungKlick in der Verdrahtung
	// (bindFenster) und meldet per Rückgabewert, ob er den Klick übernommen hat -- dann bleibt
	// garetienHandlungKlick für dasselbe Ereignis aus, sonst hätte derselbe Knopf zwei Erzeuger.
	//
	// 💣 DER RIEGEL IST EIN MODULZUSTAND (`garetienEinfuegenLaeuft`), nicht nur `knopf.disabled` --
	// dieselbe Regel wie bei `garetienLaufLaeuft` weiter oben: eine an einem Attribut gelesene
	// Weiche wirkt nicht, weil es erst im nächsten Bild steht (AGENTS.md §11). Er gilt für BEIDE
	// Einfüge-Knöpfe dieses Fensters -- „Neu einfügen" und „Alle angezeigten einfügen" schreiben
	// über dieselbe, einzeln vergebene Server-Sperre und dürfen sich deshalb nie überlappen.
	// 🔴 EIN FEHLER MITTENDRIN WIRFT UND WIRD BENANNT -- garetienEinfuegenAusfuehren gibt ihn nie
	// als Erfolg aus; der `catch` hier zeigt ihn IN der Liste (derselbe Fehlerweg wie überall sonst
	// in diesem Fenster) und zeichnet die Handlungsleiste neu, damit der Knopf nicht für immer
	// gesperrt mit „Fügt ein …" stehen bleibt.
	let garetienEinfuegenLaeuft = false;

	// ---- Meldung B (30.08.2026): "trotzdem neu anlegen" trotz erkannter Kollision -------------
	//
	// 🔴 Owner: „bei bestehenden Fläche, wo er Kollisionen erkannt hat ... kann ich Quelle +
	// Artikel und Geometrie ersetzen aber die Region nicht 'neu hinzufügen'". garetien-plan.php
	// legt seither IMMER ein Zusatz-Item an (`anlass:'zusatz'`, `change_type:'new'`,
	// `entity_public_id:null`) -- diese zwei Funktionen erkennen es und fragen nach, BEVOR
	// garetienNeuKlick es wie jeden anderen Neuzugang behandelt.

	// REIN: ist die "Neu einfügen"-Handlung hier die begründete AUSNAHME „trotzdem, trotz
	// Kollision", oder der normale Fall (kein Treffer)? Entscheidet das ITEM, nicht das URTEIL --
	// `anlass==='zusatz'` ist die einzige Quelle dieser Unterscheidung (garetien-plan.php,
	// avesmapsGaretienErgaenzungsEintraege). Ein urteilsbasierter Riegel liefe auseinander,
	// sobald ein Objekt trotz 'ergaenzung'-Urteil KEIN legitimes Ergänzungs-Item, aber ein
	// Zusatz-Item trägt (alle Abschnitte fremd benannt) -- der Riegel muss trotzdem greifen.
	// 🔴 Fragt seit Schadensfall 30.08.2026 dasselbe Praedikat wie `garetienHakenItems`
	// (garetienItemIstZusatz) -- EINE Stelle fuer „ist das ein Zusatz-Item", nicht zwei
	// wortgleiche Bedingungen, die auseinanderlaufen koennten.
	function garetienNeuIstZusatz(objekt) {
		return ((objekt && objekt.items) || []).some(garetienItemIstZusatz);
	}

	// REIN: die Rückfrage vor „trotzdem neu anlegen" -- sie NENNT, was daneben liegt (Owner:
	// „sonst legt jemand aus Versehen den zweiten Krähensee an"). Name und Abstand stehen in der
	// Einzelansicht bereits (`objekt.grund`, vom Abgleich gebaut) -- keine zweite Rechnung dafür.
	function garetienZusatzRueckfrageText(objekt) {
		const o = objekt || {};
		const name = String(o.name || "").trim() || "(ohne Namen)";
		const grund = String(o.grund || "").trim();

		return "„" + name + "“ wird ZUSÄTZLICH angelegt — der Abgleich hat eine Übereinstimmung "
			+ "gefunden" + (grund === "" ? "" : " (" + grund + ")") + ". Das bestehende Objekt "
			+ "bleibt dabei unberührt.\n\n"
			+ "Jetzt wird nur vorgemerkt. Geschrieben wird erst mit „Angehakte übernehmen“.";
	}

	function garetienNeuKlick(ereignis, objekte, runId, fragen) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest('[data-handlung="neu"]');
		if (!knopf || knopf.disabled) { return null; }
		const objekt = garetienObjektNach(knopf.getAttribute("data-key"), objekte);
		if (!objekt) { return null; }
		const rumpf = garetienHandlungsRumpf("neu", objekt, runId);
		if (!rumpf) { return null; }
		// 💣 Ein „Nein" zählt trotzdem als GEFUNDEN (`return true`) -- sonst fiele derselbe Klick
		// zu garetienHandlungKlick durch, das über die geteilte Tür (GARETIEN_PLAN_ENDPUNKT) ein
		// wirkungsloses, aber unnötiges `select` verschickte, OHNE die Rückfrage noch einmal zu
		// stellen. Dieselbe Falle wie bei garetienRuecknahmeKlick.
		if (garetienNeuIstZusatz(objekt)) {
			const ok = typeof fragen === "function" ? fragen(garetienZusatzRueckfrageText(objekt)) : false;
			if (!ok) { return true; }
		}
		if (garetienEinfuegenLaeuft) { return Promise.resolve(null); }

		garetienEinfuegenLaeuft = true;
		knopf.disabled = true;
		knopf.textContent = "Fügt ein …";

		// `rumpf.ids` ist bereits der VOLLE Umfang (garetienHandlungsRumpf/garetienHandlungBauen
		// filtern nie nach Tick-Zustand) -- Anhaken und Übernehmen decken hier dieselbe Menge ab.
		return garetienEinfuegenAusfuehren(rumpf.ids, rumpf.ids, runId, avesmapsGaretienRufe)
			.then(function () {
				return avesmapsGaretienAnzeigeNachEinfuegenBereinigen(avesmapsGaretienRufe, runId);
			})
			.then(function () { return avesmapsGaretienListeHolen(); })
			.then(function (ergebnis) {
				garetienEinfuegenLaeuft = false;
				return ergebnis;
			})
			.catch(function (fehler) {
				garetienEinfuegenLaeuft = false;
				garetienListeFehlerZeigen(fehler);
				garetienDetailRendern(zustand.objekte);
				return null;
			});
	}

	// ---- Aufgabe 9: „Zurücknehmen" -- der EINE Löschweg dieses Fensters, EINE eigene Tür ----------
	// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md
	//
	// 🔴 GEHT NICHT DURCH avesmapsGaretienHandlungSenden/GARETIEN_PLAN_ENDPUNKT. Jene Tür ist die
	// geteilte Übernahme-Vorschau für ACHT Objektarten (Auftrag §5.4) -- ein Löschweg DORT bliebe
	// nach dem Abbau dieses Fensters (§5.5) als Waise stehen, denn sync-plan.php kennt diesen Import
	// gar nicht und überlebt ihn. Die Rücknahme geht deshalb über die EIGENE Tür dieses Fensters
	// (GARETIEN_ENDPUNKT, `action: 'ruecknahme'`), deren Gegenstück ausschließlich innerhalb von
	// api/_internal/import/ liegt (avesmapsGaretienRuecknahmeAusfuehren, garetien-uebernahme.php)
	// und mit diesem Fenster verschwindet.
	// ⚠️ NIMMT EINE ID ODER EINE LISTE -- ein Zusatz-Item genauso wie mehrere 'quelle'-Items
	// desselben Objekts (Meldung 30.08.2026, siehe garetienRuecknahmeItems). `[].concat(...)`
	// verpackt beides gleich: eine einzelne Zahl bleibt ein Ein-Element-Array, ein Array bleibt
	// ein Array.
	function garetienRuecknahmeSenden(itemIdsOderId, runId) {
		const ids = [].concat(itemIdsOderId).map(Number).filter(function (id) { return id > 0; });
		return avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "ruecknahme", run_id: runId, ids: ids,
		}).then(function () { return avesmapsGaretienListeHolen(); })
			.catch(function (fehler) { garetienListeFehlerZeigen(fehler); return null; });
	}

	// REIN: die Rückfrage vor „Zurücknehmen" -- sie NENNT DIE FOLGE BEIM NAMEN (Owner-Entscheid 2):
	// was verschwindet (bei einer Fläche alle drei Zeilen namentlich), dass spätere Bearbeitungen
	// mitgehen, und dass das Objekt danach wieder offen ist. Der Wortlaut ist hier die eigentliche
	// Sicherung, kein Riegel im Code.
	//
	// 🔴 MELDUNG (30.08.2026): ZWEI GRUNDVERSCHIEDENE FOLGEN, ZWEI TEXTE. Ein 'new'-Item löscht das
	// angelegte Objekt wirklich von der Karte -- der alte Text stimmt weiter. Ein 'quelle'-only
	// 'changed'-Item löscht NICHTS vom Objekt, nur seine Quellenangabe -- der alte Text ("wird aus
	// unserer Karte entfernt") wäre hier schlicht FALSCH und eine unnötige Warnung vor etwas, das
	// gar nicht passiert.
	function garetienRuecknahmeRueckfrageText(objekt) {
		const o = objekt || {};
		const name = String(o.name || "").trim() || "(ohne Namen)";
		const items = garetienRuecknahmeItems(o);
		const nurQuelle = items.length > 0 && items.every(function (item) {
			return String((item && item.change_type) || "") === "changed";
		});

		if (nurQuelle) {
			return "Die Quellenangabe von garetien.de an „" + name + "“ wird entfernt — das Objekt "
				+ "selbst bleibt unverändert auf der Karte.\n\n"
				+ "Es fällt danach zurück nach „Offen“. Fortfahren?";
		}

		const istFlaeche = String(o.geometrie_typ || "") === "Polygon";
		const was = istFlaeche
			? "die Beschriftung „" + name + "“, die Landschaftsregion „" + name + "“ und ihre gezeichnete Fläche"
			: "das Kartenobjekt „" + name + "“";

		return "„" + name + "“ wird aus unserer Karte entfernt — das nimmt " + was + " mit, "
			+ "einschließlich aller Änderungen, die seither daran vorgenommen wurden.\n\n"
			+ "Das Objekt fällt danach zurück nach „Offen“. Fortfahren?";
	}

	// 🔴 Derselbe Bau wie garetienNeuKlick/garetienDetailKlick: Ereignis, Objektliste, Lauf-Nummer
	// UND die Werkzeuge kommen HEREIN, damit sich am ERGEBNIS messen lässt, WAS hinausgeht und WANN
	// gar nichts hinausgeht.
	//
	// 💣 OHNE BESTÄTIGUNG PASSIERT NICHTS (Brief) -- `fragen` liefert ohne `window.confirm` `false`
	// (garetienFragen), das ist Absicht. Ein „Nein“ zählt trotzdem als GEFUNDEN: sonst fiele
	// derselbe Klick weiter zu garetienHandlungKlick durch, das über die GETEILTE Tür
	// (GARETIEN_PLAN_ENDPUNKT) ein wirkungsloses, aber unnötiges `select` verschickte -- zwei
	// Erzeuger für denselben Knopf (AGENTS.md §11).
	function garetienRuecknahmeKlick(ereignis, objekte, runId, senden, fragen) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest('[data-handlung="ruecknahme"]');
		if (!knopf || knopf.disabled) { return null; }
		const objekt = garetienObjektNach(knopf.getAttribute("data-key"), objekte);
		if (!objekt) { return null; }
		const items = garetienRuecknahmeItems(objekt);
		if (items.length === 0) { return null; }
		if (!fragen(garetienRuecknahmeRueckfrageText(objekt))) { return true; }

		knopf.disabled = true;
		knopf.textContent = "Nimmt zurück …";
		// ⚠️ EIN einzelnes Item bleibt eine nackte Zahl (Rückwärtskompatibilität mit dem
		// bestehenden Sender/Test), MEHRERE gehen als Liste -- garetienRuecknahmeSenden
		// verpackt ohnehin beides gleich (siehe dort).
		const ids = items.map(function (item) { return item.id; });
		return senden(ids.length === 1 ? ids[0] : ids, runId);
	}

	// ---- Meldung C (30.08.2026): „Markierte zurücknehmen" -- das Gegenstück zu „Alle angezeigten
	// einfügen" auf der ANDEREN Seite des Fensters -----------------------------------------------
	//
	// 🔴 Owner: „zurücknehmen ist da, aber nicht 'Alle markieren zurücknehmen'". Die Menge fehlte --
	// nur die EINZELNE Rücknahme gab es (oben).
	//
	// 🔴 ER WIRKT AUF DIE MARKIERTEN, NICHT DIE ANZEIGE-MENGE -- symmetrisch zu „Markierte anzeigen"
	// (`avesmapsGaretienMarkierteAnzeigen`), das ebenfalls die gerenderte Liste gegen
	// `zustand.markiert` filtert. „Alle markieren" ist der vom Owner genannte Weg dorthin.
	// 🔴 UND ER STEHT NUR AUF DEM REITER „ÜBERNOMMEN": in den drei anderen gibt es nichts
	// zurückzunehmen (dort trägt ein Objekt gar kein 'new'+'done'-Item). Der Knopf bleibt trotzdem
	// immer gerendert -- dieselbe Hausform wie „Alle markieren" auf dem Reiter „Anzeigen": gesperrt,
	// mit einem sichtbaren Grund, NIE nur in einem `title` (ein deaktiviertes Element bekommt in
	// Chrome keine Zeigerereignisse, sein Tooltip erscheint also nie).
	//
	// ⚠️ `n von m`: m = markierte Objekte DIESES Reiters, n = davon wirklich rücknehmbar --
	// `garetienRuecknahmeItems` ist die EINZIGE Prüfung dafür (keine zweite Rechnung, dieselbe Regel
	// wie an der Einzelzeile, `garetienRuecknahmeBauen"). Ein Objekt ohne rücknehmbares Item (weiter
	// als 'quelle' verändert) zählt zu m, nie zu n -- Owner-Entscheid 1 aus Aufgabe 9.
	//
	// 🔴 EIN OBJEKT KANN MEHRERE ITEM-IDS BEISTEUERN (Meldung 30.08.2026, siehe garetienRuecknahmeItems)
	// -- `ids` wird deshalb ÜBER ALLE Objekte hinweg FLACH gesammelt, `ruecknehmbar` zählt trotzdem
	// OBJEKTE (die "n von m"-Anzeige bezieht sich auf Objekte, nicht auf Items).
	function garetienRuecknahmeMengeZustand(objekte, stand) {
		const falscherReiter = stand !== "uebernommen";
		const markierte = (objekte || []).filter(function (o) {
			return o && zustand.markiert.has(String(o.key));
		});
		const paare = [];
		markierte.forEach(function (o) {
			const items = garetienRuecknahmeItems(o);
			if (items.length > 0) { paare.push({ objekt: o, items: items }); }
		});
		let hinweis = "";
		if (falscherReiter) {
			hinweis = "Nur im Reiter „Übernommen“ verfügbar.";
		} else if (markierte.length === 0) {
			hinweis = "Nichts markiert — „Alle markieren“ markiert die Zeilen dieser Liste.";
		} else if (paare.length === 0) {
			hinweis = "Keines der markierten Objekte lässt sich zurücknehmen — sie haben ein "
				+ "bestehendes Objekt verändert.";
		}
		return {
			markiert: markierte.length,
			ruecknehmbar: paare.length,
			// Die OBJEKTE (nicht nur ihre Item-ids) -- die Rückfrage zählt daran Wege gegen Flächen.
			objekte: paare.map(function (p) { return p.objekt; }),
			ids: paare.reduce(function (acc, p) {
				return acc.concat(p.items.map(function (item) { return Number(item.id); }));
			}, []),
			beschriftung: "Markierte zurücknehmen (" + paare.length + " von " + markierte.length + ")",
			gesperrt: falscherReiter || paare.length === 0,
			hinweis: hinweis,
		};
	}

	// Die DOM-Hälfte dazu -- dieselbe Aufteilung wie beim Fußknopf (garetienUebernahmeKnopfSetzen)
	// und bei „Alle markieren" (garetienAlleMarkierenKnopfSetzen): Knopf und Hinweis werden an EINER
	// Stelle gesetzt, damit sie nie auseinanderlaufen.
	function garetienRuecknahmeMengeKnopfSetzen(objekte) {
		if (!hasDocument) { return null; }
		const stand = garetienRuecknahmeMengeZustand(objekte, zustand.stand);
		const knopf = document.getElementById("garetien-ruecknahme-markierte");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
		}
		const hinweisEl = document.getElementById("garetien-ruecknahme-markierte-hint");
		if (hinweisEl) {
			hinweisEl.textContent = stand.hinweis;
			hinweisEl.hidden = stand.hinweis === "";
		}
		return stand;
	}

	// REIN: die Rückfrage vor der MENGEN-Rücknahme -- sie nennt die Zahl und sagt, was verschwindet
	// (Auftrag), und dass spätere Bearbeitungen mitgehen (Owner-Entscheid 2 aus Aufgabe 9, gilt hier
	// unverändert). Bei einer Fläche verschwinden DREI Zeilen (Beschriftung, Landschaftsregion,
	// Fläche) -- derselbe Maßstab wie `garetienRuecknahmeRueckfrageText` für EIN Objekt, hier nur
	// GEZÄHLT statt benannt: bei Dutzenden Namen wäre ein Fließtext keine Warnung mehr, sondern eine
	// Wand.
	//
	// 🔴 MELDUNG (30.08.2026): EINE MARKIERTE MENGE KANN BEIDE ARTEN MISCHEN -- 'new'-Objekte
	// (werden wirklich gelöscht) UND 'quelle'-only 'changed'-Objekte (verlieren nur ihre
	// Quellenangabe). Derselbe Text für beide wäre für die zweite Sorte falsch (nichts wird von der
	// Karte entfernt) -- die zwei Sätze werden deshalb GETRENNT gezählt und genannt.
	function garetienRuecknahmeMengeRueckfrageText(objekte) {
		const liste = objekte || [];
		const loeschung = liste.filter(function (o) {
			const items = garetienRuecknahmeItems(o);
			return items.length > 0 && String((items[0] && items[0].change_type) || "") === "new";
		});
		const nurQuelle = liste.filter(function (o) {
			const items = garetienRuecknahmeItems(o);
			return items.length > 0 && String((items[0] && items[0].change_type) || "") === "changed";
		});

		const teile = [];
		if (loeschung.length > 0) {
			const flaechen = loeschung.filter(function (o) {
				return String((o && o.geometrie_typ) || "") === "Polygon";
			}).length;
			const wege = loeschung.length - flaechen;
			const stuecke = [];
			if (wege > 0) { stuecke.push(garetienAnzahlText(wege, "Kartenobjekt", "Kartenobjekte")); }
			if (flaechen > 0) {
				stuecke.push(garetienAnzahlText(flaechen, "Fläche", "Flächen")
					+ " (jeweils mit Beschriftung und Landschaftsregion)");
			}
			teile.push(stuecke.join(" und ") + " werden aus unserer Karte entfernt");
		}
		if (nurQuelle.length > 0) {
			teile.push("bei " + garetienAnzahlText(nurQuelle.length, "Objekt", "Objekten")
				+ " wird nur die Quellenangabe entfernt — die Objekte bleiben unverändert auf der Karte");
		}
		const was = teile.length > 0
			? teile.join("; ")
			: garetienAnzahlText(liste.length, "Objekt", "Objekte") + " werden zurückgenommen";

		return was + ", einschließlich aller Änderungen, die "
			+ "seither daran vorgenommen wurden.\n\n"
			+ "Sie fallen danach zurück nach „Offen“. Fortfahren?";
	}

	// REIN EIN SCHRITT: eine id zurücknehmen, und PRÜFEN statt VERTRAUEN.
	//
	// 💣 EIN FEHLSCHLAG STEHT IM `ok:true`-RUMPF, NICHT ALS WURF. Der Server
	// (avesmapsGaretienRuecknahmeAusfuehren) antwortet mit HTTP 200 und
	// `{zurueckgenommen:0, fehler:[{item,grund}]}`, wenn GENAU DIESES Item nicht zurückging (ein
	// zwischenzeitlich verändertes Item, ein von außen bereits gelöschtes Objekt) -- UND verarbeitet
	// dabei, anders als „Einfügen", nie mehr als die eine id, die wir schicken. `rufe()` wirft also
	// nicht von selbst; dieser Schritt prüft die Antwort und wirft MANUELL, mit der Zahl der SCHON
	// zurückgenommenen davor (Auftrag: „er muss sagen, wie viele schon zurückgenommen sind" -- ein
	// Fehler mittendrin darf nie als Erfolg durchgehen).
	function garetienRuecknahmeMengeSchritt(id, runId, rufe, zaehler, fortschritt) {
		return rufe(GARETIEN_ENDPUNKT, { action: "ruecknahme", run_id: runId, ids: [id] })
			.then(function (antwort) {
				const fehlerZeile = (antwort && antwort.fehler && antwort.fehler[0]) || null;
				if (!antwort || Number(antwort.zurueckgenommen) !== 1 || fehlerZeile) {
					throw new Error(
						"Zurücknehmen angehalten nach " + zaehler.fertig + " von " + zaehler.gesamt
						+ " — " + (fehlerZeile ? fehlerZeile.grund
							: "der Server meldet keinen Erfolg für dieses Objekt") + "."
					);
				}
				zaehler.fertig++;
				if (typeof fortschritt === "function") { fortschritt(zaehler.fertig, zaehler.gesamt); }
			});
	}

	// 🔴 GEHT PER ITEM, NIE ALS EIN SAMMELRUF. `avesmapsGaretienRuecknahmeAusfuehren` verarbeitet
	// eine ganze id-Liste in EINEM PHP-Lauf und läuft nach einem Fehlschlag bei EINEM Item WEITER
	// (eigener try/catch je Item dort) -- ein Sammelruf könnte den Lauf also nie „anhalten". Ein Ruf
	// je id, SEQUENZIELL über `garetienKetteAbarbeiten` (dasselbe Rückgrat wie die Häppchen-Kette
	// bei „Einfügen"), erfüllt „hält an" wirklich: die Kette wirft, sobald EIN Item scheitert, und
	// der nächste Ruf startet dann gar nicht erst.
	function garetienRuecknahmeMengeAusfuehren(ids, runId, rufe, fortschritt) {
		const sauber = (ids || []).map(Number).filter(function (id) { return id > 0; });
		const zaehler = { fertig: 0, gesamt: sauber.length };
		if (typeof fortschritt === "function") { fortschritt(0, zaehler.gesamt); }
		return garetienKetteAbarbeiten(sauber, function (id) {
			return garetienRuecknahmeMengeSchritt(id, runId, rufe, zaehler, fortschritt);
		}).then(function () { return zaehler.fertig; });
	}

	// 💣 DER RIEGEL IST EIN MODULZUSTAND, nicht nur `knopf.disabled` -- dieselbe Regel wie
	// `garetienEinfuegenLaeuft`: ein am Attribut gelesener Riegel wirkt nicht, weil das Attribut
	// erst im nächsten Bild steht (AGENTS.md §11).
	let garetienRuecknahmeMengeLaeuft = false;

	// Die DOM-Hälfte des Mengen-Knopfes -- dieselbe Form wie `garetienFussknopfEinfuegenKlick`
	// (das Vorbild, Auftrag): sperrt sich SOFORT, trägt ihren Fortschritt IM Knopf, holt die Liste
	// GENAU EINMAL neu, am Ende (nie in der Schleife -- AGENTS.md: STRATO nie mit einer Schleife auf
	// einen teuren Endpunkt treffen).
	//
	// 🔴 OHNE BESTÄTIGUNG PASSIERT NICHTS -- `fragen` liefert ohne `window.confirm` `false`
	// (`garetienFragen`), das ist Absicht (dieselbe Regel wie bei der Einzel-Rücknahme).
	function garetienRuecknahmeMengeKlick(runId, fragen) {
		if (garetienRuecknahmeMengeLaeuft) { return Promise.resolve(null); }
		const stand = garetienRuecknahmeMengeZustand(zustand.objekte, zustand.stand);
		if (stand.gesperrt) { return Promise.resolve(null); }
		if (typeof fragen === "function"
			&& !fragen(garetienRuecknahmeMengeRueckfrageText(stand.objekte))) {
			return Promise.resolve(null);
		}

		garetienRuecknahmeMengeLaeuft = true;
		const knopf = hasDocument ? document.getElementById("garetien-ruecknahme-markierte") : null;
		if (knopf) { knopf.disabled = true; }
		function fortschritt(fertig, gesamt) {
			if (!knopf) { return; }
			knopf.textContent = gesamt > 0
				? "Nimmt zurück … " + fertig + " von " + gesamt
				: "Nimmt zurück …";
		}
		return garetienRuecknahmeMengeAusfuehren(stand.ids, runId, avesmapsGaretienRufe, fortschritt)
			.then(function () { return avesmapsGaretienListeHolen(); })
			.then(function (ergebnis) {
				garetienRuecknahmeMengeLaeuft = false;
				return ergebnis;
			})
			.catch(function (fehler) {
				garetienRuecknahmeMengeLaeuft = false;
				garetienListeFehlerZeigen(fehler);
				garetienRuecknahmeMengeKnopfSetzen(zustand.objekte);
				return null;
			});
	}

	// Der Häkchen-Wechsel -- für die Listenzeile UND die Abschnittszeile. Beide tragen ihren
	// `data-key` selbst; die Abschnittszeile zusätzlich ihr `data-seg`.
	//
	// 🔴 RULING R6 (Fix-Runde 1, Aufgabe 2): ZWEI AUFRUFER, ZWEI VERSCHIEDENE FRAGEN -- diese
	// Funktion wird von BEIDEN Verdrahtungsstellen gerufen (dem Listenkasten in
	// `garetienListeSkelettVerdrahten` UND der Detailspalte in der Fensterverdrahtung weiter
	// unten), und die zwei Häkchen beantworten NICHT dieselbe Frage:
	//   - ZEILENHÄKCHEN (kein `data-seg`) = „markiere für die ANZEIGE" -- Entwurf §3.2 spricht
	//     AUSDRÜCKLICH nur von diesem Häkchen. Client-seitig, schreibt nichts (Owner: „Markieren
	//     ändert nichts").
	//   - ABSCHNITTSHÄKCHEN (trägt `data-seg`, aus `garetienAbschnittMarkup`) = „welche Items
	//     werden ÜBERNOMMEN" (Namen ersetzen / Geometrie ersetzen) -- UNVERÄNDERT ein Schreibweg:
	//     `selected` auf dem Server, danach die Liste neu holen (`avesmapsGaretienHandlungSenden`).
	// 💣 Diese Notiz existiert, weil ihr Fehlen den Fehler erzeugt hat: der erste Bau von Aufgabe 2
	// baute nur das Zeilenhäkchen um und traf damit -- ohne es zu bemerken -- auch den zweiten
	// Aufrufer, weil beide durch DIESELBE Funktion laufen. „Eine Regel, die einen von zwei
	// Erzeugern bindet, ist keine Regel" (AGENTS.md), hier zum wiederholten Mal.
	// Die Weiche ist `data-seg`: nur die Abschnittszeile trägt es.
	function garetienHakenKlick(ereignis, objekte, runId, senden) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const feld = ziel.closest('input[type="checkbox"]');
		if (!feld || feld.disabled) { return null; }
		const traeger = feld.closest("[data-key]");
		if (!traeger) { return null; }
		const segment = traeger.getAttribute("data-seg");
		if (segment !== null) {
			// Abschnittshäkchen: unverändert der alte Schreibweg -- `zustand.markiert` bleibt
			// unberührt.
			const objekt = garetienObjektNach(traeger.getAttribute("data-key"), objekte);
			if (!objekt) { return null; }
			const rumpf = garetienHakenRumpf(objekt, segment, runId);
			if (!rumpf) { return null; }
			return senden(rumpf);
		}
		const schluessel = traeger.getAttribute("data-key");
		if (!schluessel) { return null; }
		return avesmapsGaretienMarkierungUmschalten(schluessel);
	}

	// Der EINE Weg hinaus für jede Handlung: durch die Übernahme-Tür, danach die Liste NEU HOLEN.
	// 💣 IM BROWSER WIRD NICHTS NACHGERECHNET. Der Server ist die Wahrheit über `selected`; zwei
	// Buchhaltungen laufen beim ersten Abbruch auseinander, und dann zeigt die Zeile ein Häkchen,
	// das in der Datenbank nicht steht (oder umgekehrt).
	// ⚠️ Ein Fehlschlag steht IN der Liste, nicht in der Konsole -- und er ersetzt sie bewusst: nach
	// einem gescheiterten Schreibvorgang ist die Liste auf dem Schirm ohnehin nicht mehr die
	// Wahrheit, und der Grund gehört an die Stelle, auf die der Editor gerade sieht. Der nächste
	// Reiter- oder Filterklick holt sie zurück.
	function avesmapsGaretienHandlungSenden(rumpf) {
		return avesmapsGaretienRufe(GARETIEN_PLAN_ENDPUNKT, rumpf)
			.then(function () { return avesmapsGaretienListeHolen(); })
			.catch(function (fehler) { garetienListeFehlerZeigen(fehler); return null; });
	}

	function garetienFragen(text) {
		return typeof window !== "undefined" && typeof window.confirm === "function"
			? window.confirm(text)
			// 🔴 Ohne Rückfragemöglichkeit wird NICHT vorgemerkt. Im Zweifel geschieht nichts.
			: false;
	}

	// ---- Aufgabe 16: „Angehakte uebernehmen" -- durch das VORHANDENE Blatt -----------------------
	//
	// 🔴 SEIT AUFGABE 8 OEFFNET KEIN KNOPF DIESES FENSTERS DAS BLATT MEHR (Brief: „kommt eine neue
	// seite, anstatt alle angezeigten einzufuegen" -- genau das war der Fehler). „Neu einfuegen"
	// und der Fussknopf schreiben seither SELBST, ueber garetienNeuKlick/garetienFussknopfEinfuegenKlick
	// und die gemeinsame garetienEinfuegenAusfuehren. Die Funktionen unten (garetienBlattSender,
	// garetienUebernahmeOeffnen) UND der Wirt #garetien-sheet bleiben unangetastet im Code stehen --
	// Brief: „nicht loeschen, ohne dass jemand die Entscheidung dazu getroffen hat".
	//
	// 🔴 DIE UEBERNAHME IST js/review/sync-plan-sheet.js, UNVERAENDERT. Zweite Bestaetigung,
	// Haeppchen zu 40, Protokoll und Fortschritt haengen dort, und sieben andere Objektarten
	// benutzen dasselbe Blatt. Hier entsteht keine zweite Vorschau; hier wird dem vorhandenen Blatt
	// ein eigener `post` hereingereicht -- `syncPlanResolvePost` ist genau diese Naht („die eine
	// Stelle, an der eine zweite Zeilenquelle andockt").

	// REIN: was der Fussknopf sagt und ob er geht.
	//
	// 🔴 ER NIMMT DIE ANZEIGE-MENGE, NICHT MEHR EINE ZAHL (Aufgabe 5, 29.08.2026). „Nur angezeigte
	// koennen uebernommen werden" (Owner) -- Anzeige ist die Vorstufe, nicht der Ersatz.
	// 🔴 UND ER SAGT „n von m". Von 8213 Objekten haben 7930 keinen Vorschlag; sie duerfen
	// angezeigt werden (das ist der ganze Sinn dieses Werkzeugs), aber eingefuegt werden kann nur,
	// was ein Item hat. Ein Knopf, der „244 einfuegen" verspricht und 37 einfuegt, ist eine
	// Falschaussage ueber die naechste Handlung.
	// ⚠️ Der Grund fuer „gesperrt" steht SICHTBAR daneben, nie in einem `title`: ein deaktivierter
	// Knopf bekommt keine Zeigerereignisse, sein `title` erscheint in Chrome also nie. Dasselbe
	// Mittel wie im Blatt selbst, wo der Grund als Text in der Fusszeile steht.
	// 💣 FIX-RUNDE 1: `n` wird ueber `garetienHakenItems(o)` gezaehlt, NICHT ueber rohes
	// `o.items.length`. Ein Objekt, dessen EINZIGES Item ein Geometrie-Item ist (Urteil
	// `deckt_sich`, Name und Quelle stimmen schon -- `api/_internal/import/__tests__/
	// garetien-plan-test.php:339-345` baut genau so einen Fall), zaehlte sonst als „mit Vorschlag",
	// obwohl `garetienAnzeigeAnhakenIds` fuer es NIE eine id liefert: `garetienHakenItems` schliesst
	// das Geometrie-Item vom Haekchen-Pfad grundsaetzlich aus (eigener Knopf mit Rueckfrage). Die
	// ANZEIGE-Zahl und die ANHAK-Menge muessen ueber dieselbe Filterung laufen, sonst laufen sie
	// auseinander -- „beide Haekchen meinen also dieselbe Menge" steht schon als Regel an
	// `garetienHakenItems` selbst; hier ist die Doppelung zum zweiten Mal aufgetreten.
	function garetienUebernahmeKnopfZustand(angezeigte) {
		const liste = angezeigte || [];
		const mitVorschlag = liste.filter(function (o) {
			return o && garetienHakenItems(o).length > 0;
		}).length;
		return {
			anzahl: mitVorschlag,
			gesamt: liste.length,
			beschriftung: "Alle angezeigten einfügen (" + mitVorschlag + " von " + liste.length + ")",
			gesperrt: mitVorschlag < 1,
			hinweis: mitVorschlag > 0
				? ""
				: (liste.length === 0
					? "Nichts angezeigt — leg links etwas auf die Karte."
					: "Keines der angezeigten Objekte hat einen Vorschlag — sie gehören zu Stufen, "
						+ "für die es noch keine Zuordnung gibt."),
		};
	}

	// Die DOM-Haelfte dazu. Sie steht an EINER Stelle, damit Knopf und Hinweis nie auseinanderlaufen.
	function garetienUebernahmeKnopfSetzen(angezeigte) {
		if (!hasDocument) { return null; }
		const stand = garetienUebernahmeKnopfZustand(angezeigte);
		const knopf = document.getElementById("garetien-apply");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
		}
		const hinweisEl = document.getElementById("garetien-apply-hint");
		if (hinweisEl) {
			hinweisEl.textContent = stand.hinweis;
			hinweisEl.hidden = stand.hinweis === "";
		}
		return stand;
	}

	// ---- Der Fussknopf haengt an, in Haeppchen (Aufgabe 5, Nachtrag RULING R11) -------------------
	//
	// 🔴 DER ENDPUNKT KAPPT EINE LAENGERE id-LISTE STILLSCHWEIGEND. `api/edit/wiki/sync-plan.php:218`
	// macht `array_slice($payload['ids'], 0, AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT)` -- ohne Fehler, ohne
	// Hinweis. Bis zu diesem Knopf schickte die Oberflaeche je Klick GENAU EINE id (der Kommentar
	// daneben sagt das woertlich); dieser Fussknopf ist der ERSTE Aufrufer, der viele auf einmal
	// sendet, und muss deshalb selbst in Haeppchen zerlegen.
	// 💣 `changed` aus der Antwort ist KEIN Kappungs-Melder -- es ist ein `rowCount()` und zaehlt
	// Zeilen NICHT mit, die den Wert schon hatten. Der Riegel steht deshalb hier, nicht am Ergebnis.
	const GARETIEN_ANHAKEN_HAEPPCHEN = 200; // = AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT (sync-plan.php)

	// REIN: alle Item-IDs der angezeigten Objekte, die noch etwas zum Anhaken haben.
	//
	// ⭐ Wiederverwendet `garetienHakenPlan` (Aufgabe 2/15) je Objekt: sie liefert schon `ids` +
	// `selected` ueber die Toggle-Regel des Zeilenhaekchens. Ein Objekt, dessen Items schon
	// VOLLSTAENDIG angehakt sind, liefert dort `selected: false` (die Toggle-Richtung „alles ab") --
	// genau das ist der Grund, warum nur `plan.selected === true` uebernommen wird: dieser Knopf
	// haengt an, er nimmt nie etwas zurueck.
	function garetienAnzeigeAnhakenIds(angezeigte) {
		const ids = [];
		(angezeigte || []).forEach(function (objekt) {
			const plan = garetienHakenPlan(objekt, null);
			if (plan && plan.selected === true) {
				ids.push.apply(ids, plan.ids);
			}
		});
		return ids;
	}

	// REIN: ALLE Item-ids der angezeigten Objekte, die ueberhaupt einen Vorschlag tragen -- der
	// SCHREIBUMFANG von `apply` (Schadensfall 30.08.2026, Owner: „hat unsere ganze karte
	// zerstoert"). 🔴 ANDERS als `garetienAnzeigeAnhakenIds` darueber: jene geht ueber die
	// TOGGLE-Regel von `garetienHakenPlan` und laesst ein Objekt aus, dessen Items schon
	// VOLLSTAENDIG angehakt sind (ein Toggle wuerde es sonst ABHAKEN) -- richtig fuer „was muss
	// NEU angehakt werden", falsch fuer „was schreibt `apply` gerade". Ein Objekt, dessen Item
	// schon von einer FRUEHEREN Handlung (z.B. „Namen ersetzen") angehakt, aber noch nicht
	// uebernommen ist, braucht KEIN neues Anhaken -- `apply` MUSS es trotzdem erreichen, sonst
	// bliebe die Vormerkung fuer immer nur vorgemerkt. Diese Funktion filtert deshalb nicht nach
	// Tick-Zustand, nur nach `garetienHakenItems` (derselbe Ausschluss von Geometrie- und
	// Zusatz-Item wie beim Zeilenhaekchen).
	function garetienAnzeigeUebernahmeIds(angezeigte) {
		const ids = [];
		(angezeigte || []).forEach(function (objekt) {
			garetienHakenItems(objekt).forEach(function (item) {
				const id = Number(item && item.id);
				if (id > 0) { ids.push(id); }
			});
		});
		return ids;
	}

	// REIN: eine id-Liste in Haeppchen zu hoechstens GARETIEN_ANHAKEN_HAEPPCHEN.
	// 🪤 Gezaehlt werden hier die IDS, nicht die Objekte -- ein Objekt kann zwei Items tragen (eine
	// „Ergaenzung" mit Namens- UND Quellen-Item), und die Grenze von 200 gilt dem Endpunkt-Rumpf.
	function garetienIdsInHaeppchen(ids) {
		const haeppchen = [];
		for (let i = 0; i < ids.length; i += GARETIEN_ANHAKEN_HAEPPCHEN) {
			haeppchen.push(ids.slice(i, i + GARETIEN_ANHAKEN_HAEPPCHEN));
		}
		return haeppchen;
	}

	// REIN: eine Liste von „Einheiten" GENAU EINE NACH DER ANDEREN abarbeiten -- nie parallel
	// (AGENTS.md: STRATO nie mit mehreren gleichzeitigen Aufrufen treffen). Das gemeinsame
	// Rueckgrat von „Einfuegen" (Haeppchen zu 200 fuer `select`, weiter unten) und „Markierte
	// zuruecknehmen" (Meldung C, 30.08.2026: je EINE id, damit ein Fehlschlag die Kette dort
	// anhaelt, wo er auftritt).
	// ⚠️ Mehr laesst sich nicht teilen: die zwei Aufrufer haengen an VERSCHIEDENEN Endpunkten mit
	// VERSCHIEDENER Fehlererkennung -- „Einfuegen" laesst `rufe()` selbst werfen, „Zuruecknehmen"
	// bekommt einen Fehlschlag als `ok:true`-Rumpf zurueck und muss ihn selbst pruefen (siehe dort).
	// „eine Kette nie parallel abarbeiten" ist an beiden Stellen trotzdem wortgleich derselbe Code.
	function garetienKetteAbarbeiten(einheiten, schritt) {
		return (einheiten || []).reduce(function (kette, einheit) {
			return kette.then(function () { return schritt(einheit); });
		}, Promise.resolve());
	}

	// ---- Aufgabe 8: „Neu einfügen" und „Alle angezeigten einfügen" schreiben WIRKLICH --------------
	// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-8-brief.md
	//
	// 🔴 BEIDE KNÖPFE SIND ZWEI ERZEUGER DERSELBEN HANDLUNG (Brief) -- „ein Objekt einfügen" heißt
	// immer: seine Item-ids anhaken (`select`, in Häppchen), dann `apply` SEQUENZIELL rufen, bis der
	// Server `done` meldet. Beide gehen deshalb durch GENAU DIESE Funktion, nicht durch zwei
	// ähnliche -- „eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel" (AGENTS.md).
	//
	// 💣 KEIN `avesmapsGaretienHandlungSenden` HIER. Er hängt an JEDEN Ruf ein `action:'liste'` --
	// und dieser Endpunkt liest das GANZE Laufinventar (8213 Zeilen) neu ein (AGENTS.md: STRATO nie
	// mit einer Schleife auf einen teuren Endpunkt treffen). Bei bis zu `ids.length / 200` Häppchen
	// UND bis zu `remaining / 40` Übernahme-Schritten wäre das genau die verbotene Schleife. Der
	// Aufrufer holt die Liste stattdessen EINMAL, ganz am Ende (siehe die zwei Klickverteiler).
	//
	// 💣 `apply` nimmt die EINZELN VERGEBENE Pipeline-Sperre (avesmapsWikiDumpLockAcquireOrThrow) --
	// zwei gleichzeitige Aufrufe schlagen fehl. SEQUENZIELL, NIE PARALLEL, wie beim Anhaken.
	//
	// 🔴 EIN FEHLER MITTENDRIN WIRFT UND WIRD NICHT VERSCHLUCKT -- weder beim Anhaken noch beim
	// Übernehmen. `rufe(pfad, rumpf)` ist derselbe Vertrag wie `avesmapsGaretienRufe`: es löst mit
	// der geparsten Antwort auf, oder es wirft. Es gibt hier keinen eigenen try/catch, der einen
	// Fehlschlag in ein „false" übersetzen könnte -- die Kette bricht von selbst ab.
	//
	// 🔴 SCHADENSFALL 30.08.2026 (Owner: „hat unsere ganze karte zerstoert"): ZWEI id-LISTEN, NICHT
	// EINE. `idsZumAnhaken` sind die ids, die noch NEU angehakt werden müssen (leer, wenn ein
	// Objekt schon vollständig angehakt ist -- siehe garetienAnzeigeAnhakenIds);
	// `idsZumUebernehmen` ist der VOLLE Schreibumfang dieser Handlung (garetienAnzeigeUebernahmeIds)
	// und beschränkt JEDEN `apply`-Ruf. Ohne diese Skopierung liest `apply` sonst den GANZEN Lauf
	// (`selected = 1` quer durch frühere Klicks und die Vorbelegung) -- genau das hat „Alle
	// angezeigten einfügen" auf 3007 statt der angezeigten rund 100 Objekte gebracht. Bei „Neu
	// einfügen" sind beide Listen IDENTISCH (garetienHandlungsRumpf liefert schon den vollen
	// Umfang, ohne Toggle-Filterung).
	function garetienEinfuegenAusfuehren(idsZumAnhaken, idsZumUebernehmen, runId, rufe, fortschritt) {
		const sauber = (idsZumAnhaken || []).map(Number).filter(function (id) { return id > 0; });
		const uebernahmeIds = (idsZumUebernehmen || []).map(Number).filter(function (id) { return id > 0; });
		const gesamt = uebernahmeIds.length;
		function melden(fertig) {
			if (typeof fortschritt === "function") { fortschritt(fertig, gesamt); }
		}
		melden(0);

		// ⚠️ KEIN Rückfall auf "gesamt === 0 -> nichts tun" beim ANHAKEN: ein bereits VOLLSTÄNDIG
		// angehaktes Objekt braucht keine neue Markierung (`sauber` ist dann leer), steht aber
		// trotzdem als echter Vorschlag in der Datenbank und MUSS `apply` erreichen -- sonst bliebe
		// eine frühere Vormerkung (z.B. ein "Namen ersetzen"-Klick) für immer nur vorgemerkt.
		// `uebernahmeIds` bleibt in genau diesem Fall NICHT leer (siehe garetienAnzeigeUebernahmeIds)
		// und trägt die Handlung trotzdem zu Ende.
		const haeppchenAnhaken = garetienIdsInHaeppchen(sauber);
		const haeppchenUebernehmen = garetienIdsInHaeppchen(uebernahmeIds);
		const summe = { applied: 0, deleted: 0, stale: 0, skipped: 0, declined: 0 };
		let verarbeitet = 0;
		let iterationen = 0;
		// 💣 DER DECKEL gegen eine Endlosschleife bei einem Server, der nie `done` meldet --
		// dieselbe Größenordnung wie im vorhandenen Blatt (sync-plan-sheet.js, guard > 4000).
		const DECKEL = 4000;

		return garetienKetteAbarbeiten(haeppchenAnhaken, function (teil) {
			return rufe(GARETIEN_PLAN_ENDPUNKT, {
				action: "select", kind: GARETIEN_PLAN_ART, run_id: runId, ids: teil, selected: true,
			});
		}).then(function () {
			return garetienKetteAbarbeiten(haeppchenUebernehmen, function (teil) {
				function schritt() {
					iterationen++;
					if (iterationen > DECKEL) {
						throw new Error("Die Übernahme wurde nach zu vielen Teilschritten angehalten.");
					}
					return rufe(GARETIEN_PLAN_ENDPUNKT, {
						// 🔴 SCHADENSFALL 30.08.2026: `ids` beschränkt `apply` auf GENAU dieses
						// Häppchen -- ohne dieses Feld übernähme der Server ALLES `selected=1` im
						// Lauf, Altbestand eingeschlossen (siehe avesmapsGaretienApplyStep).
						action: "apply", kind: GARETIEN_PLAN_ART, run_id: runId, ids: teil,
					}).then(function (antwort) {
						["applied", "deleted", "stale", "skipped", "declined"].forEach(function (feld) {
							summe[feld] += Number((antwort && antwort[feld]) || 0);
						});
						verarbeitet = Math.min(gesamt, verarbeitet + Number((antwort && antwort.processed) || 0));
						melden(verarbeitet);
						if (antwort && antwort.done === true) { return; }
						return schritt();
					});
				}
				return schritt();
			});
		}).then(function () { return summe; });
	}

	// Der Fußknopf: dieselbe Funktion, mit der Anzeige-Menge als Item-Quelle (Aufgabe 5 lieferte
	// `garetienAnzeigeAnhakenIds`, Aufgabe 8 führt sie wirklich aus statt nur anzuhaken).
	//
	// 🔴 DER RÜCKFALL "nichts zu tun" GEHÖRT HIERHIN, NICHT IN garetienEinfuegenAusfuehren: er
	// fragt, ob IRGENDEIN angezeigtes Objekt überhaupt einen Vorschlag trägt (`garetienHakenItems`
	// -- dieselbe Zählung wie garetienUebernahmeKnopfZustand) -- nicht, ob `garetienAnzeigeAnhakenIds`
	// etwas NEUES anzuhaken hätte. Ein Objekt, dessen Items schon VOLLSTÄNDIG angehakt sind (z.B.
	// von einem früheren "Namen ersetzen"-Klick), liefert dort KEINE ids -- trägt aber trotzdem
	// einen echten, noch nicht übernommenen Vorschlag in der Datenbank.
	function garetienFussknopfKlick(angezeigte, runId, rufe, fortschritt) {
		const liste = angezeigte || [];
		const hatVorschlag = liste.some(function (o) { return o && garetienHakenItems(o).length > 0; });
		if (!hatVorschlag) {
			return Promise.resolve({ applied: 0, deleted: 0, stale: 0, skipped: 0, declined: 0 });
		}
		// 🔴 SCHADENSFALL 30.08.2026: ZWEI verschiedene Mengen -- `garetienAnzeigeAnhakenIds` sagt,
		// was NEU angehakt werden muss, `garetienAnzeigeUebernahmeIds` sagt, was `apply` schreiben
		// darf (der volle Umfang der ANGEZEIGTEN Objekte, nie mehr).
		return garetienEinfuegenAusfuehren(
			garetienAnzeigeAnhakenIds(liste), garetienAnzeigeUebernahmeIds(liste), runId, rufe, fortschritt
		);
	}

	// REIN: der Rückfragetext vor „Alle angezeigten einfügen" -- er NENNT die echte Zahl (Owner,
	// Schadensfall 30.08.2026: „Eine Warnung gabs nicht"). Dieselbe Zählung wie die Beschriftung
	// des Knopfs (garetienUebernahmeKnopfZustand) -- seit der Skopierung von `apply`
	// (garetienEinfuegenAusfuehren schickt seine ids jetzt mit) ist „n" hier auch wirklich die
	// geschriebene Menge, keine Schätzung mehr.
	function garetienEinfuegenRueckfrageText(anzahl) {
		return "Wirklich " + anzahl + (anzahl === 1 ? " Objekt" : " Objekte")
			+ " aus der Anzeige in die Karte einfügen?\n\n"
			+ "Neu angelegte Objekte lassen sich über „Zurücknehmen“ wieder entfernen. Für "
			+ "Änderungen an bestehenden Objekten (Name, Quelle, Geometrie) gibt es keinen Rückweg.";
	}

	// Die DOM-Hälfte des Fußknopfs: fragt nach, sperrt sich, trägt seinen Stand IN der
	// Beschriftung, und bereinigt danach die Anzeige (Aufgabe 8) -- außerhalb der reinen Kette
	// oben, weil sie echtes DOM und den Modulzustand (`zustand`, `garetienEinfuegenLaeuft`)
	// anfasst, derselbe Schnitt wie bei garetienLaufStarten/garetienLaufKachelAktualisieren.
	//
	// 🔴 SCHADENSFALL 30.08.2026: DIE RÜCKFRAGE, die es nicht gab. `fragen` ist derselbe Vertrag
	// wie bei garetienRuecknahmeMengeKlick daneben -- fehlt es (kein zweites Argument), wird NICHT
	// gefragt; die Verdrahtung unten reicht deshalb ausdrücklich `garetienFragen` herein. Sie steht
	// VOR dem Riegel `garetienEinfuegenLaeuft`, damit ein "Nein" den laufenden Zustand nie berührt.
	function garetienFussknopfEinfuegenKlick(runId, fragen) {
		if (garetienEinfuegenLaeuft) { return Promise.resolve(null); }
		const angezeigte = avesmapsGaretienAnzeigeListe();
		const stand = garetienUebernahmeKnopfZustand(angezeigte);
		if (stand.gesperrt) { return Promise.resolve(null); }
		if (typeof fragen === "function" && !fragen(garetienEinfuegenRueckfrageText(stand.anzahl))) {
			return Promise.resolve(null);
		}

		garetienEinfuegenLaeuft = true;
		const knopf = hasDocument ? document.getElementById("garetien-apply") : null;
		if (knopf) { knopf.disabled = true; }
		function fortschritt(fertig, gesamt) {
			if (!knopf) { return; }
			knopf.textContent = gesamt > 0
				? "Fügt ein … " + fertig + " von " + gesamt
				: "Fügt ein …";
		}
		return garetienFussknopfKlick(angezeigte, runId, avesmapsGaretienRufe, fortschritt)
			.then(function () {
				return avesmapsGaretienAnzeigeNachEinfuegenBereinigen(avesmapsGaretienRufe, runId);
			})
			.then(function () { return avesmapsGaretienListeHolen(); })
			.then(function (ergebnis) {
				garetienEinfuegenLaeuft = false;
				return ergebnis;
			})
			.catch(function (fehler) {
				garetienEinfuegenLaeuft = false;
				garetienListeFehlerZeigen(fehler);
				garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
				return null;
			});
	}

	// Der Sender fuer das Uebernahme-Blatt.
	//
	// ⭐ Beschnitten wird NUR die Antwort auf `get`: das Fenster hat 259 Objekte durchgearbeitet und
	// 14 angehakt; ein Blatt mit 259 Zeilen waere die Umkehrung des Auftrags („objekt fuer objekt
	// entscheiden", Mockup §4).
	//
	// 🔴 `apply`, `select` und `undecline` gehen UNVERAENDERT durch. Beschnitten wird ausschliesslich
	// die ANZEIGE -- was uebernommen wird, entscheidet weiterhin `selected` in der Datenbank.
	//
	// 💣 `counts` und `truncated` werden MITGEZOGEN. Liesse man die Serverzahlen stehen, meldete das
	// Blatt „und 245 weitere (sie sind mit ihrem Häkchen gespeichert und werden mit übernommen)" --
	// fuer 245 Zeilen, die gerade NICHT angehakt sind. Eine Falschaussage ueber eine Uebernahme.
	//
	// 💣 `counts[art]` ist die Zahl ALLER angehakten dieser Kategorie (sichtbare + abgeschnittene),
	// nicht nur der sichtbaren. Das Blatt rechnet seine Fusszeile als
	// `sichtbar angehakt + truncated.new + truncated.changed` gegen `counts.total`
	// (syncPlanFooterState, Feld `hidden`) -- mit der sichtbaren Zahl allein stuende dort bei einem
	// gedeckelten Lauf „223 von 180 werden übernommen". Fuer jeden ungedeckelten Lauf ist das
	// zeichengleich mit der sichtbaren Zahl; der Unterschied entsteht erst ueber 200 Zeilen je
	// Kategorie (AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT).
	//
	// 💣 Was der Server bei 200 abgeschnitten hat, KANN angehakt sein. Die Zahl kommt deshalb aus
	// avesmapsGaretienAngehakt() -- das liest die UNGEDECKELTE Arbeitsliste (garetien-liste.php
	// zaehlt `angehakt` ohne LIMIT ueber den ganzen Lauf) --, nie aus einer Schaetzung.
	//
	// ⚠️ `zeile.selected` ist hier ein echter Bool: api/edit/wiki/sync-plan.php baut ihn als
	// `(int) $row['selected'] === 1`. Die 0/1-ZAHL, gegen die avesmapsGaretienItemIstAngehakt
	// schuetzt, kommt aus der ANDEREN Antwort (action:'liste').
	function garetienBlattSender(rumpf) {
		return avesmapsGaretienRufe(GARETIEN_PLAN_ENDPUNKT, rumpf).then(function (antwort) {
			if (!rumpf || rumpf.action !== "get" || !antwort || !antwort.items || !antwort.run) {
				return antwort;
			}
			const counts = { new: 0, changed: 0, deleted: 0, total: 0 };
			const truncated = {};
			Object.keys(antwort.items).forEach(function (art) {
				const gehakt = (antwort.items[art] || []).filter(function (zeile) {
					return zeile && zeile.selected === true;
				});
				antwort.items[art] = gehakt;
				const imLauf = avesmapsGaretienAngehakt(art);
				// Nie weniger behaupten, als dasteht: waere die Arbeitsliste noch nicht geholt,
				// stuende `imLauf` auf 0 und das Blatt hielte sich fuer leer (kein Uebernehmen-Knopf).
				const gesamt = Math.max(gehakt.length, imLauf);
				counts[art] = gesamt;
				counts.total += gesamt;
				truncated[art] = gesamt - gehakt.length;
			});
			// ⚠️ `counts.protected_note` faellt dabei weg, und das ist folgenlos: es wird nur im
			// Loeschzweig von syncPlanGroupMarkup gelesen, und der ist fuer 'garetien' gar nicht
			// erreichbar (SYNC_PLAN_KIND_DELETIONS.garetien === null -- die Gruppe steigt vorher aus).
			antwort.run.counts = counts;
			antwort.truncated = truncated;
			return antwort;
		});
	}

	// Das Blatt aufmachen. Der Oeffner und sein Wirt kommen HEREIN -- derselbe Bau wie bei
	// garetienFensterFuellen und garetienHandlungKlick, aus demselben Grund: nur so laesst sich am
	// ERGEBNIS messen, WAS hineingereicht wird.
	//
	// 🔴 KEIN STILLER RUECKFALL. Fehlt das Blatt, wird das gesagt -- eine Ersatzfassung waere genau
	// die zweite Uebernahme-Vorschau, die dieses Vorhaben nicht bauen darf. Der Satz steht IN der
	// Liste, wie jeder andere Fehler dieses Fensters.
	function garetienUebernahmeOeffnen(oeffnen, wirt) {
		if (typeof oeffnen !== "function" || !wirt) {
			garetienListeFehlerZeigen(new Error(
				"Die Übernahme-Vorschau (js/review/sync-plan-sheet.js) ist nicht geladen. "
				+ "Es wurde nichts geschrieben."
			));
			return null;
		}

		return oeffnen({
			kind: GARETIEN_PLAN_ART,
			mount: wirt,
			post: garetienBlattSender,
			// ⚠️ Nach der Uebernahme MUSS die Arbeitsliste neu geholt werden: die uebernommenen
			// Zeilen tragen jetzt apply_state='done' und gehoeren in den Reiter „Uebernommen". Ohne
			// das steht die Liste auf dem Stand von vorher, und der naechste Klick hakt etwas an,
			// das schon geschrieben ist.
			onApplied: function () { avesmapsGaretienListeHolen(); },
			// ⚠️ UND beim blossen Schliessen ebenso -- im Blatt liegen „alle"/„keine" je Gruppe, und
			// wer dort abhakt und dann „Später" drueckt, hat den Serverstand veraendert, ohne etwas
			// zu uebernehmen. Nach einer Uebernahme laufen beide; der zweite Abruf ist der Preis
			// dafuer, dass der „Später"-Weg keinen eigenen Zustand braucht, der auseinanderlaufen kann.
			onClose: function () { avesmapsGaretienListeHolen(); },
		});
	}

	// ---- Aufraeumen nach einem Fehlimport --------------------------------------------------------
	//
	// Owner 30.08.2026, wörtlich: „entferne die quellen, sonst stehen sie irgendwann noch doppelt
	// drin, weil du nix checkst" -- der Schadensfall vom selben Tag (Aufgabe 21) hat an bestehenden
	// Kartenobjekten eine Quellenangabe hinterlassen, die niemand wollte. Diese Handlung ist GLOBAL
	// (kein `run_id`, kein Bezug auf `zustand.objekte`): die betroffenen Verknüpfungen stammen aus
	// mehreren Läufen, und die Reparatur soll ALLE erwischen, nicht nur die des offenen Laufs.
	//
	// 🔴 ZÄHLEN UND ENTFERNEN SIND ZWEI GETRENNTE SCHRITTE (Auftrag: „eine Löschung ohne Zahl ist
	// genau der Fehler, der diesen Schaden erzeugt hat"). Der Knopf trägt die Zahl aus dem Zählen
	// bereits IN seiner Beschriftung, bevor überhaupt geklickt wurde -- dieselbe Regel wie beim
	// Fußknopf „Angehakte übernehmen (n)".

	let garetienQuellenAbbauLaeuft = false;
	// `null` = noch nicht (oder nicht erfolgreich) gezählt -- UNTERSCHIEDEN von „0 gezählt", sonst
	// zeigte ein fehlgeschlagener Zählversuch denselben Knopf wie ein sauberer Bestand.
	let garetienQuellenAbbauZaehlung = null;
	let garetienQuellenAbbauMeldung = "";

	// REIN: was der Knopf sagt und ob er geht. Dieselbe Aufteilung wie bei den übrigen
	// Fuß-/Mengen-Knöpfen (garetienRuecknahmeMengeZustand & Co.): eine Rechnung, eine DOM-Hälfte.
	function garetienQuellenAbbauZustand(zaehlung, laeuft, meldung) {
		if (laeuft) {
			return { beschriftung: "Entfernt …", gesperrt: true, hinweis: "" };
		}
		if (zaehlung === null) {
			return {
				beschriftung: "Fehlimport-Quellen entfernen",
				gesperrt: true,
				hinweis: meldung || "Zählung noch nicht geladen.",
			};
		}
		const anzahl = Number(zaehlung.verknuepfungen || 0);
		return {
			beschriftung: "Fehlimport-Quellen entfernen (" + anzahl + ")",
			gesperrt: anzahl === 0,
			hinweis: anzahl === 0 ? "Keine Fehlimport-Quellen gefunden." : "",
		};
	}

	function garetienQuellenAbbauKnopfSetzen() {
		if (!hasDocument) { return null; }
		const stand = garetienQuellenAbbauZustand(
			garetienQuellenAbbauZaehlung, garetienQuellenAbbauLaeuft, garetienQuellenAbbauMeldung
		);
		const knopf = document.getElementById("garetien-quellen-abbau");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
		}
		const hinweisEl = document.getElementById("garetien-quellen-abbau-hint");
		if (hinweisEl) {
			hinweisEl.textContent = stand.hinweis;
			hinweisEl.hidden = stand.hinweis === "";
		}
		return stand;
	}

	// REIN: die Rückfrage -- nennt BEIDE Zahlen (Auftrag: „372 Verknüpfungen an 312 Objekten") und
	// sagt ausdrücklich, was NICHT verschwindet.
	function garetienQuellenAbbauRueckfrageText(zaehlung) {
		const z = zaehlung || { verknuepfungen: 0, objekte: 0 };
		return garetienAnzahlText(Number(z.verknuepfungen || 0), "Verknüpfung", "Verknüpfungen")
			+ " an " + garetienAnzahlText(Number(z.objekte || 0), "Objekt", "Objekten")
			+ " werden entfernt.\n\n"
			+ "Betroffen sind nur die Quellenangaben, die der Garetien-Import versehentlich "
			+ "angelegt hat. Die Quellen selbst (die Katalogeinträge) und alle anderen "
			+ "Verknüpfungen bleiben unverändert bestehen. Fortfahren?";
	}

	// Die Zählung holen und den Knopf danach setzen -- beim Öffnen des Fensters UND nach jedem
	// abgeschlossenen Entfernen (dann steht dort wieder „0").
	function garetienQuellenAbbauZaehlungHolen(rufe) {
		return (rufe || avesmapsGaretienRufe)(GARETIEN_ENDPUNKT, { action: "quellen_zaehlen" })
			.then(function (antwort) {
				garetienQuellenAbbauZaehlung = {
					verknuepfungen: Number((antwort && antwort.verknuepfungen) || 0),
					objekte: Number((antwort && antwort.objekte) || 0),
				};
				garetienQuellenAbbauMeldung = "";
				return garetienQuellenAbbauKnopfSetzen();
			})
			.catch(function (fehler) {
				garetienQuellenAbbauZaehlung = null;
				garetienQuellenAbbauMeldung = (fehler && fehler.message) || "Zählung fehlgeschlagen.";
				return garetienQuellenAbbauKnopfSetzen();
			});
	}

	// 🔴 OHNE BESTÄTIGUNG PASSIERT NICHTS -- `fragen` liefert ohne `window.confirm` `false`
	// (`garetienFragen`), dieselbe Regel wie bei jeder anderen Löschhandlung dieses Fensters.
	function garetienQuellenAbbauKlick(fragen, rufe) {
		if (garetienQuellenAbbauLaeuft) { return Promise.resolve(null); }
		const z = garetienQuellenAbbauZaehlung;
		if (!z || Number(z.verknuepfungen || 0) === 0) { return Promise.resolve(null); }
		if (typeof fragen === "function" && !fragen(garetienQuellenAbbauRueckfrageText(z))) {
			return Promise.resolve(null);
		}

		garetienQuellenAbbauLaeuft = true;
		garetienQuellenAbbauKnopfSetzen();
		const senden = rufe || avesmapsGaretienRufe;
		return senden(GARETIEN_ENDPUNKT, { action: "quellen_bereinigen" })
			.then(function (antwort) {
				garetienQuellenAbbauLaeuft = false;
				// Neu zählen statt dem `entfernt` aus der Antwort blind zu vertrauen -- derselbe
				// Bestand, den auch die nächste Rückfrage wieder anzeigen würde.
				return garetienQuellenAbbauZaehlungHolen(senden).then(function () { return antwort; });
			})
			.catch(function (fehler) {
				garetienQuellenAbbauLaeuft = false;
				garetienListeFehlerZeigen(fehler);
				garetienQuellenAbbauKnopfSetzen();
				return null;
			});
	}

	// ---- Verdrahtung + Rechte-Riegel ---------------------------------------------------------------

	function bindFenster() {
		const schliessenBtn = hasDocument ? document.getElementById("garetien-importer-close") : null;
		if (schliessenBtn) {
			schliessenBtn.addEventListener("click", avesmapsGaretienFensterSchliessen);
		}
		// EIN Zuhörer auf der Detailspalte, einmal beim Start. Die Spalte selbst steht statisch in
		// index.html und wird nie ersetzt (nur ihr innerHTML), die Delegation überlebt also jeden
		// Lauf von garetienDetailRendern -- dieselbe Begründung wie beim Listenkasten.
		const detailEl = hasDocument ? document.getElementById("garetien-detailcol") : null;
		if (detailEl) {
			detailEl.addEventListener("click", function (ereignis) {
				garetienDetailKlick(ereignis, zustand.objekte);
				// Aufgabe 15: die Abschnitts-Häkchen und die Knopfleiste. Alle drei Verteiler
				// steigen bei einem fremden Ziel sofort aus -- kein `else if`, das beim vierten
				// Bedienelement stillschweigend das dritte verdeckt.
				garetienHakenKlick(ereignis, zustand.objekte, zustand.planRunId,
					avesmapsGaretienHandlungSenden);
				// Aufgabe 8: „Neu einfügen“ schreibt wirklich (garetienNeuKlick). Er steht VOR
				// garetienHandlungKlick und meldet per Rückgabewert, ob er den Klick übernommen hat --
				// dann bleibt garetienHandlungKlick für dasselbe Ereignis aus, sonst hätte derselbe
				// Knopf zwei Erzeuger (AGENTS.md §11).
				// 🔴 Meldung B (30.08.2026): `garetienFragen` reist seither MIT -- „trotzdem neu
				// anlegen“ (Zusatz-Item) braucht eine Rückfrage, der normale Neuzugang weiterhin
				// keine.
				if (garetienNeuKlick(ereignis, zustand.objekte, zustand.planRunId, garetienFragen)) { return; }
				// Aufgabe 9: „Zurücknehmen“ -- derselbe Zug wie „Neu einfügen“ darüber, nur über die
				// EIGENE Tür dieses Fensters statt der geteilten Übernahme-Vorschau (siehe die
				// Begründung an garetienRuecknahmeSenden).
				if (garetienRuecknahmeKlick(ereignis, zustand.objekte, zustand.planRunId,
					garetienRuecknahmeSenden, garetienFragen)) { return; }
				garetienHandlungKlick(ereignis, zustand.objekte, zustand.planRunId,
					avesmapsGaretienHandlungSenden, garetienFragen);
			});
		}
		// 🔴 Die zwei Anzeige-Knoepfe -- seit 29.08.2026 hier statt in garetienListeSkelettVerdrahten,
		// weil sie seit derselben Meldung statisch im Fuss von index.html stehen (.gi-foot, links von
		// „Alle angezeigten einfuegen") statt im dynamisch gebauten Listen-Skelett. EIN Zuhoerer je
		// Knopf, einmal beim Start -- dieselbe Begruendung wie beim Fussknopf gleich darunter: ein
		// Element, das schon beim Laden im DOM steht, wird beim BOOT verdrahtet. Jeder Knopf ruft
		// seinen reinen Zug, danach zeichnet garetienAnzeigeNeuZeichnen Liste und Karte neu.
		// Aufgabe 10: „Alle markieren" -- derselbe Zug wie die zwei Knoepfe darunter (reine
		// Markierung, danach garetienAnzeigeNeuZeichnen), aber mit den GERENDERTEN Zeilen
		// (`zustand.objekte`) statt der Anzeige-Menge oder einer Item-Auswahl.
		const markAlleBtn = hasDocument ? document.getElementById("garetien-mark-all") : null;
		if (markAlleBtn) {
			markAlleBtn.addEventListener("click", function () {
				if (markAlleBtn.disabled) { return; }
				avesmapsGaretienAlleMarkieren(zustand.objekte);
				garetienAnzeigeNeuZeichnen();
			});
		}
		const markZeigenBtn = hasDocument ? document.getElementById("garetien-mark-show") : null;
		if (markZeigenBtn) {
			markZeigenBtn.addEventListener("click", function () {
				avesmapsGaretienMarkierteAnzeigen(zustand.objekte);
				garetienAnzeigeNeuZeichnen();
			});
		}
		const anzeigeLeerenBtn = hasDocument ? document.getElementById("garetien-anzeige-clear") : null;
		if (anzeigeLeerenBtn) {
			anzeigeLeerenBtn.addEventListener("click", function () {
				avesmapsGaretienAnzeigeLeeren();
				garetienAnzeigeNeuZeichnen();
			});
		}
		// Meldung C (30.08.2026): „Markierte zurücknehmen" -- der Löschweg der MENGE, derselbe
		// Riegel-Zug wie beim Fußknopf „Angehakte übernehmen" darunter (`disabled` NOCH EINMAL
		// geprüft, das Attribut ist die Anzeige, nicht der Riegel).
		const ruecknahmeMengeBtn = hasDocument
			? document.getElementById("garetien-ruecknahme-markierte") : null;
		if (ruecknahmeMengeBtn) {
			ruecknahmeMengeBtn.addEventListener("click", function () {
				if (ruecknahmeMengeBtn.disabled) { return; }
				garetienRuecknahmeMengeKlick(zustand.planRunId, garetienFragen);
			});
		}
		// Aufraeumen nach einem Fehlimport -- global, unabhaengig vom offenen Lauf.
		const quellenAbbauBtn = hasDocument ? document.getElementById("garetien-quellen-abbau") : null;
		if (quellenAbbauBtn) {
			quellenAbbauBtn.addEventListener("click", function () {
				if (quellenAbbauBtn.disabled) { return; }
				garetienQuellenAbbauKlick(garetienFragen);
			});
		}
		// Aufgabe 16: die EINE gefuellte Handlung des Fensters.
		// ⚠️ `disabled` wird hier NOCH EINMAL geprueft -- das Attribut ist die Anzeige, nicht der
		// Riegel; dieselbe Trennung wie bei garetienHandlungKlick und beim Ebenen-Riegel.
		const uebernehmenBtn = hasDocument ? document.getElementById("garetien-apply") : null;
		if (uebernehmenBtn) {
			// Aufgabe 8: der Fußknopf öffnet die Übernahme-Vorschau NICHT mehr -- er schreibt selbst,
			// über garetienFussknopfEinfuegenKlick (dieselbe Einfüge-Funktion wie „Neu einfügen“).
			// garetienUebernahmeOeffnen/#garetien-sheet bleiben unangetastet im Code stehen (Brief).
			// 🔴 SCHADENSFALL 30.08.2026: `garetienFragen` reist seither MIT -- derselbe Zug wie bei
			// „Markierte zurücknehmen" daneben.
			uebernehmenBtn.addEventListener("click", function () {
				if (uebernehmenBtn.disabled) { return; }
				garetienFussknopfEinfuegenKlick(zustand.planRunId, garetienFragen);
			});
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
			// Aufgabe 1: die Anzeige-Menge -- gehoert dem Fenster, nicht dem Vorschlag (Entwurf §3).
			avesmapsGaretienAnzeigeHinzufuegen,
			avesmapsGaretienAnzeigeLeeren,
			avesmapsGaretienAnzeigeListe,
			avesmapsGaretienAnzeigeHat,
			// Regression 29.08.2026: die Anzeige-Menge nach einem Schreibvorgang auffrischen, nie entfernen.
			avesmapsGaretienAnzeigeAuffrischen,
			AVESMAPS_GARETIEN_SERVER_STAENDE,
			// Aufgabe 2: das Haekchen ist ein reiner Marker (Entwurf §3.2)
			avesmapsGaretienMarkierungUmschalten,
			avesmapsGaretienMarkierungHat,
			avesmapsGaretienMarkierteAnzeigen,
			// RULING R5 (Aufgabe 2, Luecke im Plan): der Reiter „Anzeigen" baut seine Antwort selbst
			garetienAnzeigenAntwortBauen,
			// RULING R7 (Fix-Runde 1): Suche/Filtertrichter sperren + sichtbar begruenden
			garetienAnzeigeFilterSperreSetzen,
			// Aufgabe 11
			garetienZeileMarkup,
			avesmapsGaretienCheckboxZustand,
			avesmapsGaretienHatAuswahl,
			avesmapsGaretienAufDerKarte,
			avesmapsGaretienUrteilInfo,
			avesmapsGaretienBalanceZeileText,
			avesmapsGaretienRunlineMarkup,
			avesmapsGaretienTabsMarkup,
			avesmapsGaretienAngehakt,
			avesmapsGaretienAngehaktAus,
			avesmapsGaretienListeHolen,
			avesmapsGaretienListeRendern,
			garetienListeSkelettMarkup,
			// Aufgabe 3 (Sicht-Tafel): die Neutral-Meldung der Bilanzzeile
			garetienNeutraleObjekte,
			garetienNeutralHinweisMarkup,
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
			// Aufgabe 14
			avesmapsGaretienFensterSchliessen,
			garetienDetailKlick,
			// Aufgabe 14b: die zwei Sicht-Knoepfe. 🔴 Die zwei Parteinamen sind exportiert, damit
			// der Test sie gegen die Fassung in review-garetien-karte.js halten kann -- sie sind
			// ein gekoppelter Wert in zwei Dateien (Begruendung an ihrer Definition).
			garetienSichtLeisteMarkup,
			AVESMAPS_GARETIEN_PARTEI_IHRE,
			AVESMAPS_GARETIEN_PARTEI_UNSERE,
			// Owner-Meldung 29.08.2026: „Avesmaps" ist nur bedienbar, wenn unsere Geometrie in der
			// Anzeige-Menge liegt.
			garetienUnsereVorhanden,
			AVESMAPS_GARETIEN_SICHT_GESPERRT_GRUND,
			// Aufgabe 15
			garetienHandlungen,
			garetienHandlungsRumpf,
			garetienHandlungsMarkup,
			garetienHakenItems,
			garetienHakenPlan,
			garetienHakenRumpf,
			garetienGeometrieRueckfrageText,
			garetienHandlungKlick,
			garetienHakenKlick,
			// 🔴 Exportiert, damit die tragendste Regel dieser Aufgabe eine Zusicherung bekommt:
			// „nach jedem `select` wird die Liste NEU GEHOLT". Ohne den Export nannte sie keine
			// einzige Zeile des Testfelds -- eine Pruefung hat ihr `.then` durch `.then(() => null)`
			// ersetzt und das ganze Feld blieb gruen.
			avesmapsGaretienHandlungSenden,
			// Aufgabe 16
			garetienUebernahmeKnopfZustand,
			garetienUebernahmeKnopfSetzen,
			garetienBlattSender,
			garetienUebernahmeOeffnen,
			// Aufgabe 5: der Fussknopf haengt an, in Haeppchen -- Nachtrag RULING R11
			garetienAnzeigeAnhakenIds,
			garetienIdsInHaeppchen,
			garetienFussknopfKlick,
			// Aufgabe 8: „Neu einfügen“ und „Alle angezeigten einfügen“ schreiben wirklich
			avesmapsGaretienAnzeigeNachEinfuegenBereinigen,
			garetienEinfuegenAusfuehren,
			garetienNeuKlick,
			garetienFussknopfEinfuegenKlick,
			// Schadensfall 30.08.2026: der volle Schreibumfang fuer `apply`, ANDERS als
			// garetienAnzeigeAnhakenIds (siehe deren Kommentare)
			garetienAnzeigeUebernahmeIds,
			garetienEinfuegenRueckfrageText,
			// Meldung B (30.08.2026): „trotzdem neu anlegen“ trotz erkannter Kollision
			garetienItemIstZusatz,
			garetienNeuIstZusatz,
			garetienZusatzRueckfrageText,
			// Aufgabe 9: „Zurücknehmen" -- der eine Löschweg dieses Fensters
			// Meldung (30.08.2026): die enge Ausnahme für 'quelle'-only 'changed'-Items
			garetienItemIstQuelleNur,
			garetienRuecknahmeFaehig,
			garetienRuecknahmeItems,
			garetienRuecknahmeItem,
			garetienRuecknahmeBauen,
			garetienRuecknahmeRueckfrageText,
			garetienRuecknahmeKlick,
			garetienRuecknahmeSenden,
			// Aufgabe 10: „Alle markieren"
			avesmapsGaretienAlleMarkieren,
			garetienAlleMarkierenZustand,
			garetienAlleMarkierenKnopfSetzen,
			// Meldung C (30.08.2026): „Markierte zurücknehmen" -- die Menge, symmetrisch zum
			// Fußknopf „Einfügen".
			garetienKetteAbarbeiten,
			garetienRuecknahmeMengeZustand,
			garetienRuecknahmeMengeKnopfSetzen,
			garetienRuecknahmeMengeRueckfrageText,
			garetienRuecknahmeMengeAusfuehren,
			garetienRuecknahmeMengeKlick,
			// Aufraeumen nach einem Fehlimport (30.08.2026): die feature_sources-Verknuepfungen
			// mit origin='garetien' zaehlen und -- nach Bestaetigung -- entfernen.
			garetienQuellenAbbauZustand,
			garetienQuellenAbbauKnopfSetzen,
			garetienQuellenAbbauRueckfrageText,
			garetienQuellenAbbauZaehlungHolen,
			garetienQuellenAbbauKlick,
		};
	}
})();
