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
	// 🔴 SEIT 31.08.2026 AUCH FUER EDITOREN (Owner: „der button 'Garetien Importer' soll für alle
	// Editoren-Nutzer sichtbar werden"). Das war von Anfang an das Ziel — „ich baue das tool für die
	// editoren" —, und der Riegel war nur so lange eng, wie das Fenster noch niemand ausser dem
	// Owner sehen sollte.
	// ⚠️ „Holen & Rechnen" und „Ebenen" bleiben admin-only: das ist eine EIGENE Frage
	// (avesmapsGaretienDarfAdminHandlung unten), und sie war schon vor dieser Freigabe getrennt --
	// deshalb kostet die Freigabe hier genau eine Zeile und fasst dort nichts an.
	function avesmapsGaretienDarfOeffnen(sitzung) {
		const rechte = (sitzung && sitzung.capabilities) || null;
		if (!rechte) { return false; }

		return rechte.admin === true || rechte.edit === true;
	}

	// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 2: EINE EIGENE Frage, obwohl sie heute dieselbe
	// Antwort wie avesmapsGaretienDarfOeffnen gibt. „Darf ich das Fenster ueberhaupt oeffnen" und
	// „darf ich hier einen fremden Server abrufen bzw. den ganzen Bestand neu rechnen" sind zwei
	// verschiedene Fragen, die zufaellig denselben Riegel teilen -- das Fenster ist HEUTE ganz
	// admin-beschraenkt, soll aber kuenftig fuer Editoren offen sein (Owner: „ich baue das tool für
	// die editoren"). „Holen & Rechnen" und „Ebenen" bleiben admin-only, AUCH wenn das geschieht.
	// Faellt GESCHLOSSEN aus, wie avesmapsGaretienDarfOeffnen -- nur echtes `true` zaehlt.
	function avesmapsGaretienDarfAdminHandlung(sitzung) {
		return !!(sitzung && sitzung.capabilities && sitzung.capabilities.admin === true);
	}

	// ⚠️ Kein zweiter Rechteweg: dieselbe Auskunft, GEMESSEN bei jedem Kachel-Update, nicht
	// gemerkt -- ein Modulzustand koennte veralten, wenn sich die Sitzung nach dem ersten Aufbau
	// noch aendert. Dasselbe Muster wie `window.AvesmapsSession.current()` in `anwendeRechteRiegel`.
	function garetienDarfAdminHandlungJetzt() {
		const sitzung = (typeof window !== "undefined" && window.AvesmapsSession)
			? window.AvesmapsSession.current()
			: null;
		return avesmapsGaretienDarfAdminHandlung(sitzung);
	}

	// ---- Wie viele Zeilen die Liste hoechstens zeigt ---------------------------------------------
	//
	// 🔴 Owner 31.08.2026: „die 8000 objekte sind auf manchen pcs ein problem ... ein dropdown mit
	// 1000, 2000, 4000 und max ... bei dem die leute die maximale anzahl items selber einstellen
	// können". Der Deckel reist als `anzahl` im Listenrumpf mit; der Server klemmt ihn ohnehin auf
	// AVESMAPS_GARETIEN_LISTE_MAX (10000) herunter.
	//
	// 🔴 DIE VORGABE IST DIE KLEINSTE STUFE, und das ist eine Entscheidung: die Meldung lautete
	// „auf manchen pcs ein problem", und ein neuer Benutzer soll nicht erst hineinlaufen, um den
	// Regler zu finden. ⚠️ Verborgen wird dabei nichts — die Kachel nennt IMMER beide Zahlen
	// („1000 von 8213"), und der Reiterkopf trug die Gesamtzahl schon vorher.
	// ⭐ Er UEBERLEBT das Neuladen (localStorage): auf einem langsamen Rechner waere eine
	// Einstellung, die man nach jedem Laden neu treffen muss, keine.
	// ⚠️ `null` heisst „alle" -- dann reist gar kein `anzahl` mit, und es gilt der Server-Deckel.
	// Eine Zahl dafuer zu erfinden hiesse, die Gesamtzahl im Browser zu kennen; sie kommt aber vom
	// Server und aendert sich mit jedem Lauf.
	const GARETIEN_ZEILEN_STUFEN = [1000, 2000, 4000, null];
	const GARETIEN_ZEILEN_SCHLUESSEL = "avesmaps.garetien.zeilen";

	// REIN: die gespeicherte Stufe, oder die Vorgabe. Faellt bei jedem Zweifel auf die KLEINSTE
	// Stufe zurueck -- ein kaputter Wert darf nie „alle" bedeuten, sonst haengt genau der Rechner,
	// dem die Einstellung helfen soll.
	function garetienZeilenGrenzeLesen(speicher) {
		try {
			const roh = speicher ? speicher.getItem(GARETIEN_ZEILEN_SCHLUESSEL) : null;
			if (roh === "alle") { return null; }
			const zahl = parseInt(String(roh), 10);
			if (GARETIEN_ZEILEN_STUFEN.indexOf(zahl) !== -1) { return zahl; }
		} catch (fehler) {
			// Kein Speicher (privates Fenster, gesperrte Seitendaten) -- die Vorgabe gilt.
		}

		return GARETIEN_ZEILEN_STUFEN[0];
	}

	function garetienZeilenGrenzeMerken(speicher, grenze) {
		try {
			if (speicher) {
				speicher.setItem(GARETIEN_ZEILEN_SCHLUESSEL, grenze === null ? "alle" : String(grenze));
			}
		} catch (fehler) {
			// Volles Kontingent oder gesperrt -- die Einstellung gilt fuer diesen Besuch trotzdem.
		}
	}

	// ---- Zustand ---------------------------------------------------------------------------------
	//
	// Die volle Form ist die Schnittstelle für Aufgabe 11-16 (avesmapsGaretienFensterZustand()).
	const zustand = {
		offen: false,
		// Wie viele Zeilen die Liste hoechstens zeigt -- `null` heisst „alle" (Owner 31.08.2026).
		// ⚠️ Beim Laden des Moduls gelesen, nicht beim Oeffnen: der Wert entscheidet ueber den
		// ERSTEN Listenabruf, und der laeuft schon beim Aufmachen des Fensters.
		zeilenGrenze: garetienZeilenGrenzeLesen(
			typeof window !== "undefined" ? window.localStorage : null
		),
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
		// 🔴 Owner 30.08.2026: „der button sollte nur imports nicht unsere eigenen anzeigen".
		// Wer ueber „Imports in der Nähe anzeigen" hereinkommt, wird in SEINER Farbe gezeichnet --
		// unser magenta Gegenstueck bleibt weg, bis jemand das Objekt oeffnet oder es auf einem
		// anderen Weg in die Anzeige holt.
		// 💣 EINE MENGE NEBEN DER ANZEIGE, KEIN FELD DARIN. avesmapsGaretienAnzeigeAuffrischen
		// ersetzt nach jedem Schreibvorgang die gespeicherte Fassung durch die frische vom Server;
		// ein in das Objekt geschriebenes Feld waere danach still fort, und die magenta Formen
		// kaemen zurueck, ohne dass jemand etwas getan haette.
		nurIhre: new Set(),
	};

	/*
	 * Der Feldname, an dem der ZEICHNER erkennt, dass er von diesem Objekt nur ihre Seite malen
	 * soll.
	 *
	 * 💣 GEKOPPELTER WERT IN ZWEI DATEIEN, wie die zwei Parteinamen darunter -- und aus demselben
	 * Grund: dieses Fenster laeuft auch auf Seiten ohne Karte und darf den Zeichner nicht
	 * voraussetzen, der Zeichner wird im Test allein geladen und kann dieses Fenster nicht
	 * voraussetzen. Zusammengehalten werden sie von js/review/__tests__/garetien-karte.test.js,
	 * das beide Exporte gegeneinander haelt.
	 */
	const AVESMAPS_GARETIEN_FELD_NUR_IHRE = "nur_ihre";

	// Und dasselbe für „das ist die gerade GEWÄHLTE Zeile" (Owner 30.08.2026: „kannst du einer
	// selektierten Fläche einen durchgehende kontur geben"). 💣 Ebenfalls ein gekoppelter Wert in
	// ZWEI Dateien, aus derselben Begründung wie oben -- und von demselben Test zusammengehalten.
	const AVESMAPS_GARETIEN_FELD_GEWAEHLT = "gewaehlt";

	/*
	 * Der Name des globalen Hakens, ueber den der ZEICHNER einen Klick auf eine Form hierher meldet
	 * (Owner 30.08.2026: „wenn sie auf ein zu importierendes objekt klicken koennten").
	 *
	 * 💣 GEKOPPELTER WERT IN ZWEI DATEIEN, wie die zwei Feldnamen darueber -- und aus demselben
	 * Grund: der Zeichner darf dieses Fenster nicht voraussetzen, dieses Fenster nicht die Karte.
	 * Liefe der Name auseinander, riefe der Zeichner ins Leere, und zwar STILL. Zusammengehalten
	 * von js/review/__tests__/garetien-karte-klick.test.js.
	 */
	const AVESMAPS_GARETIEN_HAKEN_KLICK = "avesmapsGaretienKarteKlick";

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
			// 🔴 EIN GEWOEHNLICHER WEG IN DIE ANZEIGE HEBT DIE „nur ihre"-MARKE AUF. Wer denselben
			// Nachbarn ueber „Markierte anzeigen" oder einen Zeilenknopf hereinholt, will ihn ganz
			// sehen -- und der Naehe-Klick setzt seine Marke NACH diesem Aufruf wieder.
			zustand.nurIhre.delete(String(o.key));
		});
		return zustand.anzeige.size;
	}

	// Diese Objekte werden nur in IHRER Farbe gezeichnet (siehe `zustand.nurIhre`).
	function avesmapsGaretienNurIhreMerken(objekte) {
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			zustand.nurIhre.add(String(o.key));
		});
		return zustand.nurIhre.size;
	}

	function avesmapsGaretienAnzeigeLeeren() {
		zustand.anzeige.clear();
		// ⚠️ Die Marken gehen MIT. Sonst traegt ein spaeter wieder hereingeholtes Objekt eine
		// Entscheidung aus einer Sitzung, an die sich niemand mehr erinnert.
		zustand.nurIhre.clear();
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
	// (AVESMAPS_GARETIEN_LISTE_MAX). Ein zweiter Ruf mit `versatz` waere hier genau die
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

	// ---- Owner-Auftrag B (30.08.2026): „Keines markieren" -- leert die MARKIERUNG, nicht die
	// Anzeige. Dieselbe Trennung wie ueberall in diesem Abschnitt: „Anzeige leeren"
	// (avesmapsGaretienAnzeigeLeeren) und „Keines markieren" sind zwei verschiedene Mengen, und ein
	// Knopf, der beide zugleich leerte, verwischte genau die Trennung, die „Markieren aendert
	// nichts" ausdruecklich haelt. Dieselbe Rueckgabe-Form wie avesmapsGaretienAnzeigeLeeren --
	// die neue (immer leere) Groesse, nicht die vorherige.
	function avesmapsGaretienKeineMarkieren() {
		zustand.markiert.clear();
		return zustand.markiert.size;
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
	// wie Suche und Filtertrichter dort schon gesperrt sind (RULING R7).
	//
	// 🔴 OHNE HINWEISTEXT, seit dem 30.08.2026 (Owner: „kannst du so kommentare wie … entfernen?
	// verbraucht nur platz"). Beide Gründe, die hier standen, sagten nur „hier gibt es nichts zu
	// tun" -- und das sagt der graue Knopf mitsamt seiner Zahl „(0)" bereits. Der Reiter „Anzeigen"
	// trägt seinen eigenen Satz über der Liste.
	// ⚠️ Ein `title` wäre KEIN Ersatz: ein deaktivierter Knopf bekommt keine Zeigerereignisse, sein
	// Tooltip erscheint in Chrome also nie (gemessen, siehe der Kommentar an #garetien-apply-hint
	// in index.html). Wo ein Grund wirklich nötig ist, bleibt er sichtbar -- das ist er am
	// Hauptknopf und beim dritten Fall der Mengen-Rücknahme, die beide etwas Unerwartetes erklären.
	function garetienAlleMarkierenZustand(objekte, stand) {
		const liste = objekte || [];
		const aufAnzeigenReiter = stand === "anzeigen";
		return {
			anzahl: liste.length,
			beschriftung: "Alle markieren (" + liste.length + ")",
			gesperrt: aufAnzeigenReiter || liste.length === 0,
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
		return stand;
	}

	// ---- Owner-Auftrag B (30.08.2026): „Keines markieren" -- neben „Alle markieren", derselbe
	// Bau (REIN + DOM-Haelfte). 🔴 Gesperrt heisst hier NUR "nichts markiert" (Auftrag) -- anders
	// als „Alle markieren" haengt sie an KEINEM Reiter: die Markierung ist filter-/reiterunabhaengig
	// (dieselbe Menge, die „Markierte anzeigen" ueberall liest), also darf auch ihr Leeren auf
	// jedem Reiter moeglich sein.
	function garetienKeineMarkierenZustand(anzahlMarkiert) {
		const anzahl = Number(anzahlMarkiert) || 0;
		return {
			anzahl: anzahl,
			beschriftung: "Keines markieren",
			gesperrt: anzahl === 0,
		};
	}

	function garetienKeineMarkierenKnopfSetzen(anzahlMarkiert) {
		if (!hasDocument) { return null; }
		const stand = garetienKeineMarkierenZustand(anzahlMarkiert);
		const knopf = document.getElementById("garetien-mark-none");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
		}

		return stand;
	}

	// ---- Owner-Auftrag (30.08.2026): „Alle zentrieren" -----------------------------------------
	//
	// Wörtlich: „außerdem wär ein button mit 'Alle zentrieren' hilfreich, wo die ansicht auf alle
	// in 'Anzeigen' gelisteten objekte zoomt (gemeinsamer mittelpunkt und vermutlich herauszoomt)".
	//
	// 🔴 GEMESSEN WIRD DIE ANZEIGE-MENGE, NICHT DIE GERENDERTE LISTE -- anders als bei „Alle
	// markieren" daneben. Der Auftrag nennt „alle in 'Anzeigen' gelisteten", und das ist genau
	// diese Menge; sie liegt auf der Karte, egal auf welchem Reiter man gerade steht. Ein Knopf,
	// der die Zeilen des Reiters „Offen" anflöge, würde auf etwas zoomen, das gar nicht gezeichnet
	// ist.
	// ⚠️ Deshalb hängt er an KEINEM Reiter (wie „Keines markieren", anders als „Alle markieren").
	function garetienAlleZentrierenZustand(anzahlAngezeigt) {
		const anzahl = Number(anzahlAngezeigt) || 0;
		return {
			anzahl: anzahl,
			beschriftung: "Alle zentrieren",
			gesperrt: anzahl === 0,
		};
	}

	function garetienAlleZentrierenKnopfSetzen(anzahlAngezeigt) {
		if (!hasDocument) { return null; }
		const stand = garetienAlleZentrierenZustand(anzahlAngezeigt);
		const knopf = document.getElementById("garetien-zentrieren-alle");
		if (knopf) {
			knopf.textContent = stand.beschriftung;
			knopf.disabled = stand.gesperrt;
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
		// Die Zahl der Laufzeile gehört einem Lauf; ohne Lauf steht sie leer, statt eine Null zu
		// behaupten, die niemand gezählt hat.
		const laufzeileEl = document.getElementById("garetien-runline");
		if (laufzeileEl) { laufzeileEl.textContent = ""; }
		// Fuenf-Punkte-Brief 30.08.2026, Punkt 1: die alte Bilanzzeile ("N von M Objekten") ist
		// restlos entfernt -- was hier bleibt, ist NUR der Neutral-Hinweis (Sicht-Tafel, Aufgabe 3),
		// und der hat ohne Lauf nichts zu melden.
		const neutralHinweisEl = document.getElementById("garetien-neutral-hinweis");
		if (neutralHinweisEl) {
			neutralHinweisEl.textContent = "";
			neutralHinweisEl.hidden = true;
		}
		// Aufgabe 16/5: ohne Lauf gibt es keine Anzeige -- und damit nichts einzufuegen.
		garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
		// Aufgabe 10: ohne Lauf gibt es auch keine gerenderte Zeile -- und damit nichts zu markieren.
		garetienAlleMarkierenKnopfSetzen([]);
		// Owner-Auftrag B: „Keines markieren" haengt an KEINEM Lauf und KEINEM Reiter (siehe seine
		// eigene Begruendung) -- die echte Groesse der Markierung wird hier trotzdem gemessen, nicht
		// auf 0 gezwungen.
		garetienKeineMarkierenKnopfSetzen(zustand.markiert.size);
		// Owner 30.08.2026: „Alle zentrieren" misst die ANZEIGE-Menge -- ohne Lauf ist sie leer.
		garetienAlleZentrierenKnopfSetzen(avesmapsGaretienAnzeigeListe().length);
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

	// REIN GENUG: die zwei Panels beiseiteschieben, damit der Importer Platz hat.
	//
	// 🔴 Owner 31.08.2026: „Beim Drücken sollen sich die panels zur seite schieben (routerplaner
	// nach links, editor/info-panel nach rechts)". Gebaut wird das mit den EINKLAPP-MECHANISMEN, die
	// das Haus schon hat -- `window.avesmapsCollapseRoutePlanner` (js/ui/route-planner-toggle.js)
	// und `window.avesmapsInfopanelCollapse` (map-features-infopanel.js). Ein eigenes Schieben wäre
	// ein zweiter Zustand darüber, wo die Panels stehen, und die beiden vorhandenen wüssten nichts
	// davon: die Lasche zeigte weiter in die falsche Richtung, und der nächste Klick darauf brächte
	// den Planer über das Fenster zurück.
	// ⚠️ Beide Aufrufe sind OPTIONAL geprüft: der Importer läuft auch auf Seiten ohne Karte (dort
	// gibt es weder Planer noch Infopanel), und ein fehlender Aufruf darf das Fenster nicht
	// aufhalten.
	// 🔴 EINGEKLAPPT, NICHT ZUGEMACHT -- und beim Schliessen des Importers wird NICHTS
	// zurückgeklappt: wer den Planer wiederhaben will, hat seine Lasche, und ein Fenster, das
	// fremde Panels beim Schliessen wieder aufreisst, nähme dem Editor eine Entscheidung ab, die er
	// inzwischen selbst getroffen haben kann.
	function garetienPanelsBeiseite() {
		if (typeof window === "undefined") { return; }
		if (typeof window.avesmapsCollapseRoutePlanner === "function") {
			window.avesmapsCollapseRoutePlanner();
		}
		// 🔴 DER RECHTE RAND HAT ZWEI BEWOHNER UND EINEN KOORDINATOR (Owner-Meldung 31.08.2026:
		// „das editorpanel geht noch nicht nach rechts weg"). `avesmapsInfopanelCollapse` allein
		// traf nur die Infobox -- das EDITORPANEL (#review-panel) ist ein eigenes Element mit
		// eigenem Zustand, und beide teilen sich den rechten Slot ueber `avesmapsEdgePanels`
		// (js/config.js). Wer nur einen von beiden einklappt, laesst den anderen stehen.
		// ⭐ `deactivate` ist dafuer gebaut: es wirkt nur auf den, der GERADE aktiv ist, und beide
		// Panels haengen mit ihrem eigenen `onChange` daran. Zwei Aufrufe, weil der Koordinator
		// keinen kennt, der „egal welcher" bedeutet -- der zweite ist ein Leerlauf.
		// ⚠️ Der Koordinator wird nur im BEARBEITEN-Modus bestueckt (map-features-infopanel.js:211).
		// Deshalb bleibt `avesmapsInfopanelCollapse` daneben stehen: ausserhalb des Editors ist es
		// der einzige Weg, die Infobox wegzubekommen. Zwei Wege, jeder fuer seinen Fall -- keiner
		// davon ist der Rueckfall des anderen.
		if (window.avesmapsEdgePanels && typeof window.avesmapsEdgePanels.deactivate === "function") {
			window.avesmapsEdgePanels.deactivate("editor");
			window.avesmapsEdgePanels.deactivate("info");
		}
		if (typeof window.avesmapsInfopanelCollapse === "function") {
			window.avesmapsInfopanelCollapse();
		}
	}

	// ---- Die IMPORT-SICHT: was die Karte zeigt, waehrend importiert wird ------------------------
	//
	// Owner 31.08.2026: „da überwiegend landschaften importiert werden, sollte man beim öffnen des
	// importers automatisch 'Alle' von 'Landschaften' wechseln. Außerdem kannst du 'Wege', 'Labels',
	// 'Grenzen', 'Flüsse', 'Kreuzungen' und alle Ortstypen sichtbar machen, wenn man in den
	// import-modus geht."
	//
	// 🔴 DIE REIHENFOLGE IST TRAGEND, und sie ist der ganze Grund, warum das hier eine Funktion ist
	// und keine drei Zeilen: ZUERST die Ansicht, DANN die Ebene, ZULETZT die Sichtbarkeit. Die
	// Landschaften-Ebene setzt beim Betreten ihr eigenes Anzeige-Profil
	// (`syncEcosystemSettlementVisibility`, `syncEcosystemFrontendFeatures`) -- und fuer einen
	// EDITOR heisst dieses Profil „leere Zeichenflaeche": sie nimmt ihm ALLE Ortsklassen weg. Wer
	// die Sichtbarkeit vorher setzt, sieht sie eine Zehntelsekunde spaeter wieder verschwinden.
	//
	// 💣 UND DAS IST KEIN FEHLER DIESER EBENE, den man dort reparieren duerfte: die leere Flaeche
	// ist ihre Aufgabe, wenn jemand Landschaften ZEICHNET. Der Import ist eine andere Arbeit am
	// selben Ort -- hier will man sehen, was schon daliegt. Deshalb legt sich diese Sicht OBEN DRAUF,
	// statt das Profil umzuschreiben.
	// ⚠️ Sie wird beim Schliessen NICHT zurueckgenommen -- wie die beiseitegeschobenen Panels.
	// Die Ortsklassen kommen trotzdem von selbst zurueck: die Landschaften-Ebene hat sie sich nur
	// GELIEHEN und gibt beim Verlassen den Stand von vor dem Import zurueck.
	//
	// 🔴 KEINE ADRESSZEILE. `setAllLocationTypesVisible` schreibt bewusst kein
	// `syncPlannerStateToUrl` -- ein Klick auf die Ortsklassen-Kachel taete es, und damit stuende der
	// Teilen-Link des Editors hinter seinem Ruecken anders da. Genau aus diesem Grund verzichtet auch
	// die Landschaften-Ebene darauf (URL-Policy: die Adresszeile wird nie automatisch umgeschrieben).
	//
	// 💣 UND NUR SCHALTER, DIE DER BENUTZER AUCH ZURUECKSTELLEN KANN. Drei der genannten Zeilen im
	// Anzeige-Menue stehen `hidden`, solange die Seite nicht im Bearbeiten-Modus ist
	// (`toggleCrossingsControl` und Geschwister, js/app/bootstrap.js). Einen davon anzuschalten
	// erzeugte einen Zustand, den niemand mehr sieht und deshalb auch nicht mehr loswird.
	const GARETIEN_IMPORT_HAKEN = [
		// Owner-Reihenfolge; die Kreuzungen stehen nur im Bearbeiten-Modus zur Verfuegung.
		"togglePaths",            // Wege
		"toggleMapLabels",        // Labels
		"toggleTerritoryBorders", // Grenzen
		"toggleRivers",           // Fluesse
		"toggleCrossings",        // Kreuzungen
	];

	// REIN genug zum Pruefen: gibt zurueck, was sie wirklich angefasst hat.
	function garetienImportHakenSetzen(ids) {
		if (!hasDocument) { return []; }
		const gesetzt = [];
		(ids || []).forEach(function (id) {
			const haken = document.getElementById(id);
			if (!haken || haken.checked === true) { return; }
			// ⚠️ Die Zeile, nicht der Haken: das `hidden` sitzt am umschliessenden `<label>`
			// (`<id>Control`), der Haken selbst ist immer da.
			const zeile = document.getElementById(id + "Control");
			if (zeile && zeile.hidden) { return; }
			// 💣 Ein programmatisch gesetztes `checked` feuert KEIN `change` -- und daran haengen die
			// Zeichner (syncPathVisibility fuer die Wege, die Grenz-Leinwand fuer die Grenzen). Die
			// Hausfassung dieser Geste steht in map-features-ecosystem-layer-switch.js; sie hier
			// nachzubauen waere ihre zweite Fassung.
			if (typeof ecosystemSetzeAnzeigeHaken === "function") {
				ecosystemSetzeAnzeigeHaken(id, true);
			} else {
				haken.checked = true;
				haken.dispatchEvent(new Event("change", { bubbles: true }));
			}
			gesetzt.push(id);
		});
		return gesetzt;
	}

	function garetienKarteFuerImportRichten() {
		if (!hasDocument) { return; }
		// 1. Die Ansicht: „Landschaften". Ueber die Auswahlbox, denn SIE ist der Zustand -- derselbe
		//    Weg, den ein Klick im Kartenfaecher geht (js/app/keyboard-shortcuts.js macht es genauso).
		const ansicht = document.getElementById("mapLayerModeSelect");
		if (ansicht && ansicht.value !== "ecosystem"
			&& ansicht.querySelector('option[value="ecosystem"]')
			&& typeof window !== "undefined" && window.jQuery) {
			window.jQuery(ansicht).val("ecosystem").trigger("change");
		}
		// 2. Die Ebene: „Alle". ⚠️ Sie traegt BEWUSST kein `data-ecosystem-kind` (sie ist ein
		//    Anzeige-Flag neben dem Ebenen-Zustand, siehe index.html) -- gesucht wird deshalb ueber
		//    ihr eigenes Attribut, nicht ueber einen erfundenen Ebenennamen.
		const alle = document.querySelector("#ecosystem-layer-switch [data-ecosystem-show-all]");
		if (alle && alle.getAttribute("aria-selected") !== "true") {
			alle.click();
		}
		// 3. Erst jetzt die Sichtbarkeit -- siehe die Begruendung zur Reihenfolge oben.
		if (typeof setAllLocationTypesVisible === "function") {
			setAllLocationTypesVisible(true);
		}
		garetienImportHakenSetzen(GARETIEN_IMPORT_HAKEN);
	}

	function avesmapsGaretienFensterOeffnen() {
		const win = fensterElement();
		if (win) { win.hidden = false; }
		zustand.offen = true;
		garetienPanelsBeiseite();
		garetienKarteFuerImportRichten();
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
		// 🔴 MIT FRAGEZEICHEN seit 31.08.2026 (Owner): „Bei 'Ergänzung' kannst du gern 'Ergänzung?'
		// schreiben, dass man weiß, hier existiert schon was ABER ES WIRD DURCH DEN IMPORTER
		// NIEMALS ERSETZT." Das Wort ohne Fragezeichen las sich wie eine Zusage, dass hier etwas
		// ergänzt WIRD -- und genau das tut der Importer seit heute nicht mehr. Es sagt jetzt nur
		// noch: an dieser Stelle liegt schon etwas, sieh es dir an.
		ergaenzung: { klasse: "u--erg", beschriftung: "Ergänzung?" },
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

	// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 1: die Zeile UNTER der Suche ("N von M Objekten · ✦ K
	// leuchten") ist restlos entfernt (Owner: „weiß sowieso nicht was das bedeutet"). Ihr Erzeuger
	// hiess `avesmapsGaretienBalanceZeileText` und rief js/review/review-list-balance.js -- beides
	// ist weg, ohne Ersatz. Was von ihr blieb, ist NICHT ihr Nachfolger: der Neutral-Hinweis der
	// Sicht-Tafel (Aufgabe 3) hing DANEBEN an derselben Zeile und bekommt jetzt sein EIGENES,
	// ehrlich benanntes Element (garetien-neutral-hinweis, siehe garetienListeSkelettMarkup und
	// avesmapsGaretienListeRendern) -- kein leeres <p> bleibt zurueck, das nur noch selten etwas
	// zeigt.

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
			// Fuenf-Punkte-Brief 30.08.2026, Punkt 1: die alte Bilanzzeile ("N von M Objekten · ✦ K
			// leuchten") ist restlos entfernt. Was hier steht, ist NICHT ihr Nachfolger, sondern der
			// Neutral-Hinweis der Sicht-Tafel (Aufgabe 3, garetienNeutralHinweisMarkup) mit einem
			// EIGENEN, ehrlichen Namen -- dieselbe Hausform wie `garetien-anzeige-hinweis` darueber:
			// startet `hidden`, damit ohne etwas zu melden kein leeres Element sichtbaren Platz zieht.
			+ '<p class="gi-neutral-hinweis" id="garetien-neutral-hinweis" hidden></p>'
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

		// Fuenf-Punkte-Brief 30.08.2026, Punkt 1: die alte Bilanzzeile ("N von M Objekten · ✦ K
		// leuchten") ist restlos entfernt (Owner: „weiß sowieso nicht was das bedeutet"). Was
		// bleibt, ist NICHT ihr Nachfolger: der Neutral-Hinweis der Sicht-Tafel (Aufgabe 3) hing
		// DANEBEN an derselben Zeile und bekommt jetzt sein EIGENES Element, ehrlich benannt.
		const neutralHinweisEl = document.getElementById("garetien-neutral-hinweis");
		if (neutralHinweisEl) {
			// Fix-Runde 2 zu Aufgabe 3 gilt unveraendert: die Neutral-Meldung MUSS
			// `avesmapsGaretienAufDerKarte(objekte)` lesen, NICHT `avesmapsGaretienAnzeigeListe()` --
			// obwohl Letztere die naheliegendere Wahl scheint ("die Anzeige-Menge ist doch, was
			// angezeigt wird"). Sie ist es nicht mehr: seit `b45bc5cfa` (Owner-Beispiel „Perz")
			// zeichnet JEDER Kartenaufruf `avesmapsGaretienAufDerKarte()`, und die traegt zusaetzlich
			// das ANGEKLICKTE, aber noch nicht angezeigte Objekt (siehe deren Kommentar). Die zwei
			// Mengen unterscheiden sich also um genau EIN Objekt -- und das ist ausgerechnet das,
			// auf das der Editor gerade schaut. Mit `avesmapsGaretienAnzeigeListe()` liesse sich eine
			// Ebene Wege/Grenzen/Sonstiges anklicken (die per RULING R3/R9 immer neutral sind) und
			// die Meldung bliebe stumm, waehrend die Karte das Objekt sichtbar golden zeichnet --
			// dieselbe Menge wie in `garetienAnzeigeNeuZeichnen` (oben): DIE, die tatsaechlich
			// gezeichnet wird.
			// 🔴 `garetienNeutralHinweisMarkup` selbst bleibt UNVERAENDERT (ihre eigenen Tests bauen
			// weiterhin auf ihrem fuehrenden " · ", das an einen Satz DAVOR anschliesst) -- als
			// SOLOSATZ in seinem eigenen Element wird nur dieser Anschluss abgeschnitten, der Rest
			// ist zeichengleich.
			const neutralMarkup = garetienNeutralHinweisMarkup(avesmapsGaretienAufDerKarte(objekte));
			neutralHinweisEl.innerHTML = neutralMarkup === "" ? "" : neutralMarkup.replace(/^ · /, "");
			neutralHinweisEl.hidden = neutralMarkup === "";
		}

		// Aufgabe 5: der Fussknopf traegt „n von m" der ANZEIGE-MENGE, nicht mehr die Zahl der
		// angehakten Items -- „Nur angezeigte koennen uebernommen werden" (Owner). Die Anzeige ist
		// filterunabhaengig (Entwurf §3.1), deshalb wird hier NICHT `objekte` (die gefilterte Sicht)
		// gereicht, sondern dieselbe Menge, die auch auf der Karte liegt.
		garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
		// Aufgabe 10: „Alle markieren" traegt dagegen die Zahl der GERENDERTEN Zeilen -- `objekte`
		// ist genau die aktuelle (gefilterte, gedeckelte) Ansicht, nicht die Anzeige-Menge.
		garetienAlleMarkierenKnopfSetzen(objekte);
		// Owner-Auftrag B: „Keines markieren" -- die ECHTE Groesse von `zustand.markiert`, unabhaengig
		// vom Reiter (siehe ihre eigene Begruendung).
		garetienKeineMarkierenKnopfSetzen(zustand.markiert.size);
		// Owner 30.08.2026: „Alle zentrieren" misst die ANZEIGE-Menge (was wirklich gezeichnet ist),
		// nicht `objekte` -- siehe die Begründung an garetienAlleZentrierenZustand.
		garetienAlleZentrierenKnopfSetzen(avesmapsGaretienAnzeigeListe().length);
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
		const raus = avesmapsGaretienNurIhreStempeln(avesmapsGaretienAnzeigeListe());
		if (zustand.detailKey === null) { return raus; }
		const schonDrin = raus.some(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		});
		// 🔴 EIN Ausgang für den Gewählt-Stempel, nicht zwei. Der erste Bau setzte ihn an beide
		// `return`-Zeilen -- und eine Mutationsprobe zeigte sofort, dass ein Test, der nur den
		// einen Weg fährt, den anderen ungeprüft lässt. Dieselbe Lehre, die dieses Projekt schon
		// bei den Querfeldein-Kanten und der Verkehrsmittel-Sperre bezahlt hat: eine Regel, die
		// einen von zwei Erzeugern bindet, ist keine Regel. Also gibt es hier nur noch einen.
		let liegt = raus;
		if (!schonDrin) {
			const liste = objekte || zustand.objekte || [];
			const angeklickt = liste.filter(function (o) {
				return o && String(o.key) === String(zustand.detailKey);
			})[0];
			if (angeklickt) { liegt = raus.concat([angeklickt]); }
		}
		return garetienGewaehltStempeln(liegt);
	}

	/*
	 * Die Marke „das ist das gerade GEWÄHLTE Objekt" -- REIN. Owner 30.08.2026, an einem
	 * Bildschirmfoto: „kannst du einer selektierten Fläche einen durchgehende kontur geben
	 * (anstelle der gestrichelten)".
	 *
	 * 🔴 DIESELBE BAUFORM WIE `avesmapsGaretienNurIhreStempeln` darüber, und aus demselben Grund:
	 * ENTSCHIEDEN WIRD IM FENSTER, gezeichnet im Zeichner. Der Zeichner weiß nicht, welche Zeile
	 * offen ist, und soll es nicht wissen -- er liest nur ein Feld am Objekt.
	 * 🔴 GESTEMPELT WIRD EINE KOPIE. Die Anzeige-Menge hält die Objekte, wie der Server sie
	 * geliefert hat; sie zu verändern schriebe sich über `zustand.objekte` bis in die Listenzeile
	 * durch, denn beide halten dieselbe Referenz. (Genau daran ist der Nur-ihre-Stempel beinahe
	 * gescheitert -- deshalb steht der Satz dort ein zweites Mal.)
	 * ⚠️ Ohne offene Zeile passiert gar nichts: die Liste reist unverändert weiter, ohne Kopien.
	 */
	function garetienGewaehltStempeln(objekte) {
		if (zustand.detailKey === null) { return objekte; }
		const gewaehlt = String(zustand.detailKey);
		return (objekte || []).map(function (o) {
			if (!o || String(o.key) !== gewaehlt) { return o; }
			const kopie = Object.assign({}, o);
			kopie[AVESMAPS_GARETIEN_FELD_GEWAEHLT] = true;
			return kopie;
		});
	}

	/*
	 * Die Marke „nur ihre Seite" an die Objekte heften, die auf die Karte gehen. REIN.
	 *
	 * 🔴 HIER UND NUR HIER, weil avesmapsGaretienAufDerKarte der EINE Erzeuger der gezeichneten
	 * Menge ist -- jeder Aufruf von window.avesmapsGaretienKarteZeigen geht durch ihn, und
	 * garetienUnsereVorhanden (die Sperre des Knopfes „Avesmaps") misst dieselbe Menge. Eine Marke
	 * an den Aufrufstellen waere beim naechsten Zeichenweg vergessen.
	 * 🔴 GESTEMPELT WIRD EINE KOPIE. Die Anzeige-Menge haelt die Objekte, wie der Server sie
	 * geliefert hat; sie zu veraendern schriebe sich ueber `zustand.objekte` bis in die Listenzeile
	 * durch, denn beide halten dieselbe Referenz.
	 * 🔴 DAS GERADE GEOEFFNETE OBJEKT IST AUSGENOMMEN. Wer eine Zeile ansieht, will vergleichen --
	 * dafuer ist dieses Fenster da. Ohne die Ausnahme waere ein ueber den Naehe-Knopf hereingeholtes
	 * Objekt nie mehr mit unserem Bestand vergleichbar, und der Knopf „Avesmaps" haette keine
	 * Wirkung mehr, die ein Editor herstellen koennte.
	 */
	function avesmapsGaretienNurIhreStempeln(objekte) {
		if (zustand.nurIhre.size === 0) { return objekte; }
		return (objekte || []).map(function (o) {
			if (!o) { return o; }
			const schluessel = String(o.key);
			if (!zustand.nurIhre.has(schluessel)) { return o; }
			if (zustand.detailKey !== null && schluessel === String(zustand.detailKey)) { return o; }
			const kopie = Object.assign({}, o);
			kopie[AVESMAPS_GARETIEN_FELD_NUR_IHRE] = true;
			return kopie;
		});
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
			// `anzeigen` hier auf die eigene Groesse gesetzt -- die Anzeige filtert nicht, es gibt
			// also kein "von M" zu nennen. ⚠️ Die Bilanzzeile, die diesen Unterschied einst zeigte
			// (avesmapsGaretienBalanceZeileText), ist seit Punkt 1 des Fuenf-Punkte-Briefs
			// 30.08.2026 entfernt; das Feld selbst bleibt Teil der "Antwort"-Form dieser Funktion.
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
		// 🔴 NUR WENN GEDECKELT. Bei „alle" reist gar kein `anzahl` mit, und es gilt der
		// Server-Deckel (AVESMAPS_GARETIEN_LISTE_MAX) -- eine im Browser erfundene Zahl waere eine
		// zweite Wahrheit ueber die Obergrenze.
		if (zustand.zeilenGrenze !== null) {
			rumpf.anzahl = zustand.zeilenGrenze;
		}
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

	// REIN: Text + Sperre der Ebenen-Kachel in EINEM Zug -- derselbe Zug wie bei
	// garetienAlleMarkierenZustand/garetienUebernahmeKnopfZustand: Text und Sperre entstehen an
	// EINER Stelle, testbar ganz ohne DOM. Fuenf-Punkte-Brief 30.08.2026, Punkt 2: der Admin-Riegel
	// schlaegt JEDE andere Auskunft -- eine bestehende Auswahl bleibt erhalten, ist fuer einen
	// Nicht-Admin aber weder einsehbar noch aenderbar.
	function garetienEbenenKachelZustand(darfAdmin, bezeichner, alleEbenen) {
		if (!darfAdmin) {
			return { text: "nur Administratoren", disabled: true };
		}
		return { text: garetienEbenenKachelText(bezeichner, alleEbenen), disabled: false };
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

	// REIN: die zweite Zeile der Lauf-Kachel. FUENF Lagen, in dieser Reihenfolge -- der Admin-Riegel
	// (Fuenf-Punkte-Brief 30.08.2026, Punkt 2) · ein harter Fehler (steht bis zum nächsten Versuch)
	// · es läuft gerade · kein Lauf da · der geltende Lauf.
	// 🔴 `keinAdmin` steht ZUERST: er gilt UNABHAENGIG davon, ob Ebenen gewaehlt sind oder ein Lauf
	// gerade laeuft -- ein Nicht-Admin kann den Knopf nie druecken, unabhaengig vom uebrigen Stand.
	// 🔴 Die Rechendauer kennen wir NUR für einen Lauf dieser Sitzung: `action:'runs'` liefert
	// keine. Für einen älteren Lauf steht deshalb seine Zeilenzahl da -- auch eine Tatsache, nur
	// eine andere -- statt einer erfundenen Sekundenzahl. (Der Brief zeigt die Zeile im Zustand
	// direkt nach einem Lauf; „0,35 s" ist dort das Gemessene, nicht das Gespeicherte.)
	function garetienLaufKachelText(lage) {
		const l = lage || {};
		if (l.keinAdmin) { return "nur Administratoren"; }
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
	// REIN: die Optionen der Zeilen-Kachel. 🔴 „alle" traegt die ECHTE Gesamtzahl im Text, nicht
	// eine abgeschriebene 8213 -- die Zahl gehoert dem Lauf und aendert sich mit jedem Rechnen.
	function garetienZeilenOptionenMarkup(grenze, gesamt) {
		return GARETIEN_ZEILEN_STUFEN.map(function (stufe) {
			const wert = stufe === null ? "alle" : String(stufe);
			const text = stufe === null
				? (Number(gesamt) > 0 ? "alle (" + Number(gesamt) + ")" : "alle")
				: String(stufe);

			return '<option value="' + wert + '"' + (stufe === grenze ? " selected" : "") + ">"
				+ avesmapsGaretienEscape(text) + "</option>";
		}).join("");
	}

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
			+ "</div>"
			// 🔴 DIE DRITTE KACHEL, und sie ist die EINZIGE des Bandes OHNE Admin-Riegel (Owner
			// 31.08.2026: „einen dropdown button für alle verfügbar"). Sie holt nichts von aussen
			// und rechnet nichts neu -- sie sagt nur, wie viel dieser Browser zeichnen soll.
			// 💣 EIN NATIVES `<select>`, kein drittes Klappmenue. Das Band traegt schon zwei
			// Rezepturen (Kachel-Knopf und geteilter Trichter); eine dritte fuer eine
			// EINFACHauswahl waere Zierrat -- und ein `<select>` bringt Tastatur, Vorlesehilfe und
			// das Verhalten des Systems gratis mit. ⚠️ Es steht in einem `<label>`, nicht in einem
			// `<button>`: ein Auswahlfeld in einem Knopf ist ungueltiges Markup, und der Klick
			// darauf oeffnete zwei Dinge zugleich.
			// 🔴 KEINE ZWEITE ZEILE MIT DERSELBEN ZAHL (Owner 31.08.2026: „warum steht da
			// 2x 1000 btw. die dropdown reicht"). Die zwei Nachbarkacheln tragen unter ihrer
			// Beschriftung eine `t2`-Zeile mit ihrem Zustand -- diese hier hatte sie abgeschrieben,
			// und ihr Zustand ist die Auswahl selbst, die einen Zentimeter darueber steht.
			// ⚠️ Die Gesamtzahl geht dabei nicht verloren: sie steht in der Option „alle (8213)"
			// und in der Bilanzzeile ueber den Reitern.
			+ '<label class="avm-tile gi-tile--wahl" for="garetien-zeilen">'
			+ '<span class="t1">Angezeigte Zeilen</span>'
			+ '<select class="gi-zeilen" id="garetien-zeilen"></select>'
			+ "</label>";
	}

	// Die DOM-Haelfte -- dieselbe Aufteilung wie bei den zwei Nachbarkacheln: Beschriftung und
	// Zustand werden an EINER Stelle gesetzt, damit sie nie auseinanderlaufen.
	function garetienZeilenKachelAktualisieren() {
		if (!hasDocument) { return; }
		const gesamt = Number((zustand.letzteAntwort && zustand.letzteAntwort.gesamt) || 0);
		const feld = document.getElementById("garetien-zeilen");
		if (feld) {
			const markup = garetienZeilenOptionenMarkup(zustand.zeilenGrenze, gesamt);
			// ⚠️ Nur neu bauen, wenn sich wirklich etwas geaendert hat: ein `innerHTML` auf ein
			// offenes `<select>` schliesst es unter dem Finger.
			if (feld.innerHTML !== markup) { feld.innerHTML = markup; }
		}
	}

	function garetienLaufKachelAktualisieren() {
		if (!hasDocument) { return; }
		// Die Sperre hat ZWEI Gründe, und beide werden aus DERSELBEN Rechnung gelesen wie die
		// Nachbarkachel -- „was wird geholt" steht nur an einer Stelle.
		const ohneEbenen = garetienGewaehlteBezeichner(garetienEbenenAuswahl, garetienAlleEbenen).length === 0;
		// Fuenf-Punkte-Brief 30.08.2026, Punkt 2: EIN dritter Grund, GEMESSEN bei jedem Aufbau --
		// kein Modulzustand, der veralten koennte.
		const keinAdmin = !garetienDarfAdminHandlungJetzt();
		const zeile = document.getElementById("garetien-run-state");
		if (zeile) {
			zeile.textContent = garetienLaufKachelText({
				keinAdmin: keinAdmin,
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
		// (siehe dort), und der leere Zustand wird in garetienLaufStarten noch einmal geprüft. Der
		// Admin-Riegel dagegen hat KEINE zweite Pruefstelle im Browser -- er ist rein Anzeige, die
		// Wahrheit steht auf dem Server (api/edit/map/garetien-import.php).
		if (knopf) { knopf.disabled = keinAdmin || garetienLaufLaeuft || ohneEbenen; }
	}

	// Beide Kacheln in einem Zug -- die Auswahl steuert die eine und sperrt die andere.
	function garetienMenuebandKachelnAktualisieren() {
		garetienEbenenKachelAktualisieren();
		garetienLaufKachelAktualisieren();
		garetienZeilenKachelAktualisieren();
	}

	function garetienEbenenKachelAktualisieren() {
		if (!hasDocument) { return; }
		const stand = garetienEbenenKachelZustand(
			garetienDarfAdminHandlungJetzt(),
			garetienGewaehlteBezeichner(garetienEbenenAuswahl, garetienAlleEbenen),
			garetienAlleEbenen
		);
		const zeile = document.getElementById("garetien-ebenen-state");
		if (zeile) { zeile.textContent = stand.text; }
		// Fuenf-Punkte-Brief 30.08.2026, Punkt 2: die Kachel oeffnet ihr Menue nicht mehr, wenn sie
		// gesperrt ist -- ein `disabled`-Knopf feuert gar kein `click`, avmFilterMenuAttach bekommt
		// den Klick also nie zu sehen.
		const knopf = document.getElementById("garetien-ebenen-toggle");
		if (knopf) { knopf.disabled = stand.disabled; }
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
	// 🚪 DREI FELDER DES MOCKUPS FEHLEN IN DER ANTWORT VON action:'liste' und werden deshalb hier
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

	// REIN: übersetzt UNSEREN Schlüssel (`objekt.subtyp`) in seine deutsche Beschriftung -- Owner
	// 30.08.2026, wörtlich: „kannst du unsere bezeichnung für die Worte (z.B. suempfe_moore ->
	// Sümpfe und Moore) auflösen?" 🔴 KEINE NEUE TABELLE (AGENTS.md §5/§11): jede der vier Zielarten
	// hat schon eine Beschriftungsquelle im Haus -- dieselbe, aus der ihr eigener Editor/ihr eigenes
	// Dropdown schöpft. Eine fünfte Abschrift wäre genau die Divergenz, vor der AGENTS.md warnt.
	//   'location'          -> LOCATION_TYPE_CONFIG[subtyp].singularLabel (js/config.js, dieselbe
	//                          Tafel, die auch der Meldedialog liest, review-panels.js)
	//   'region' / 'label'  -> avesmapsLabelArtName(subtyp) (js/ui/label-arten.js -- „DAS
	//                          AUSWAHLFELD IST DIE QUELLE", dieselbe Tafel wie #label-edit-type)
	//   'path'              -> getPathTypeLabel(subtyp) (js/map-features/map-features-path-domain.js)
	// ⚠️ Findet sich keine Beschriftung (eine Quelle fehlt auf einer Seite ohne Karte, oder das
	// Vokabular kennt den Schlüssel nicht -- z. B. 'urwald' fehlt heute in label-arten.js, siehe
	// Bericht), steht der SCHLÜSSEL da, nie ein erfundener Name (Owner: „zeig den Schlüssel").
	// ⚠️ Ohne `ziel` (ältere Läufe, reine Fixtures) bleibt der Schlüssel unangetastet -- dieselbe
	// zurückhaltende Richtung.
	function garetienUnserBeschriftung(objekt) {
		// 🔴 Über die WAHL, nicht über den rohen Vorschlag (01.09.2026) -- solange niemand etwas
		// anderes gewählt hat, ist beides dasselbe.
		const wahl = garetienZielWahlZu(objekt);
		const subtyp = String(wahl.subtyp || "").trim();
		if (subtyp === "") { return subtyp; }
		const ziel = String(wahl.ziel || "").trim();
		if (ziel === "location") {
			const eintrag = (typeof LOCATION_TYPE_CONFIG !== "undefined") ? LOCATION_TYPE_CONFIG[subtyp] : null;
			return (eintrag && eintrag.singularLabel) || subtyp;
		}
		if (ziel === "region" || ziel === "label") {
			const name = (typeof avesmapsLabelArtName === "function") ? avesmapsLabelArtName(subtyp) : "";
			return name || subtyp;
		}
		if (ziel === "path") {
			const art = (typeof getPathTypeLabel === "function") ? getPathTypeLabel(subtyp) : subtyp;
			// 🔴 „Flussweg (Bach)" -- der Owner hat diese Schreibweise am 30.08.2026 wörtlich
			// bestellt, und sie sagt genau das Richtige: angelegt wird ein FLUSSWEG, und er trägt
			// das Häkchen „Bach". Nur „Bach" verschwiege den Wegtyp, unter dem das Objekt in der
			// Karte und im Wege-Editor auftaucht; nur „Flussweg" verschwiege das Häkchen, das ihm
			// jede Befahrbarkeit nimmt.
			return objekt && objekt.is_bach === true ? art + " (Bach)" : art;
		}
		return subtyp;
	}

	// REIN: der Kopf-Zusatz „Gebirge (garetien.de) → Gebirge (Avesmaps)" -- IHR Typ samt IHRER
	// Quelle, und die Art, als die WIR es anlegen würden, samt UNSEREM (aufgelösten) Namen. Ohne die
	// zwei Klammern sagt der Pfeil nicht, wessen Vokabular welche Seite spricht -- bei "Gebirge →
	// gebirge" unterschieden sich die beiden vor der Auflösung nur durch einen Großbuchstaben
	// (Owner-Meldung 30.08.2026).
	// ⚠️ Die Quelle ist NICHT immer "Garetien" -- die Objekte kommen aus ZWEI Wikis (`objekt.wiki`:
	// 'ggp'/'kosch'), und `garetienWikiLabel()` übersetzt das schon in "garetien.de"/"koschwiki.de".
	// Ein festgeschriebenes "Garetien" stünde bei jedem Kosch-Objekt falsch da.
	// ⚠️ Fehlt der Zielsubtyp (ein Objekt ohne Vorschlag, ein Lauf von vor dem Nachzug) oder deckt
	// sich die AUFGELÖSTE Beschriftung mit ihrem Typ, steht nur ihr Typ da -- UNBESCHRIFTET: ohne
	// Pfeil gibt es nichts zu unterscheiden, und ein leeres „(Avesmaps)" darf nie stehenbleiben.
	function garetienTypText(objekt) {
		const ihr = String((objekt && objekt.typ) || "").trim();
		// ⚠️ Die GEWÄHLTE Art, nicht die vorgeschlagene -- sonst sagte der Kopf „→ Sümpfe & Moore",
		// während die Felder darunter „Berggipfel" zeigen.
		const unser = garetienUnserBeschriftung(objekt);
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
		// 🔴 30.08.2026: unsere Geometrie reist MIT ihrer Ringstruktur, aber gedeckelt
		// (AVESMAPS_GARETIEN_ABSCHNITT_TEILE, api/_internal/import/garetien-abgleich.php) -- die
		// groesste Flaeche des Bestands hat 343 Teile. Was wegbleibt, wird GENANNT: AGENTS.md §9
		// verbietet die stille Kappung, weil sie sich wie „das ist alles" liest.
		// ⚠️ NUR ueber 0, und aus denselben zwei Gruenden wie beim Namensbefund darueber: 0 ist der
		// Normalfall und stuende sonst an fast jeder Zeile, und ein fehlendes Feld (Lauf vor dem
		// 30.08.2026) ist ueberhaupt keine Auskunft.
		const verworfen = Number(a.verworfene_teile) || 0;
		if (verworfen > 0) {
			kennung += " · " + verworfen + (verworfen === 1 ? " Teil" : " Teile") + " nicht gezeichnet";
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
	// 🔴 SEIT 31.08.2026 SIND ES ZWEI (Owner, nachdem er den Artikel zu Praioslob zufaellig
	// gefunden hatte: „kann man den artikel dann als zusaetzliche quelle angeben?"): die
	// Sammelquelle „Briefspiel (Garetien)" auf den Wirt UND der eigene Wiki-Artikel des Objekts.
	// ⚠️ Die zweite fehlt bei 42 % der Zeilen (vor allem Wege und Waelder) -- dann steht sie
	// schlicht nicht da. Eine Zeile „kein Artikel" waere eine Auskunft ueber eine Abwesenheit, die
	// niemanden interessiert.
	// 💣 Die Lizenzzeile steht EINMAL unter beiden, nicht an jeder: sie ist bei beiden dieselbe
	// (derselbe Wirt, derselbe Autor), und zweimal derselbe Satz liest sich wie ein Unterschied.
	function garetienQuellenMarkup(objekt) {
		const quelle = (objekt && objekt.quelle) || {};
		const artikel = (objekt && objekt.artikel_quelle) || {};
		const label = String(quelle.label || "").trim();
		const artikelLabel = String(artikel.label || "").trim();
		const artikelUrl = String(artikel.url || "").trim();
		const lizenz = garetienLizenzZeile(quelle);
		if (label === "" && artikelLabel === "" && lizenz.text === "") { return ""; }
		const teile = [];
		if (label !== "") { teile.push("„" + avesmapsGaretienEscape(label) + "\""); }
		if (artikelLabel !== "") {
			// Der Artikel wird VERLINKT -- er ist die einzige der beiden Quellen, die auf eine
			// konkrete Seite zeigt. ⚠️ Das ↗ kommt aus der CSS-Regel
			// `.gi-detail a[target="_blank"]::after`, nicht von Hand (wie in der Metazeile).
			teile.push(artikelUrl !== ""
				? '<a href="' + avesmapsGaretienEscape(artikelUrl) + '" target="_blank" rel="noopener">'
					+ "„" + avesmapsGaretienEscape(artikelLabel) + "\"</a>"
				: "„" + avesmapsGaretienEscape(artikelLabel) + "\"");
		}
		if (lizenz.text !== "") { teile.push(avesmapsGaretienEscape(lizenz.text)); }
		return '<p class="gi-sec">Die Quelle' + (artikelLabel !== "" ? "n" : "") + ', die mitreist' + '</p>'
			+ '<p class="gi-why">'
			+ teile.join(" · ")
			+ " — einmal an der Quelle, nicht an jedem Objekt.</p>";
	}

	// ---- „Eingefügt wird" -- alle Einstellungen, die die Fläche/der Ort/das Label bekäme -------
	//
	// Owner 30.08.2026, wörtlich: „ich hatte plötzlich 3000 labels da stehen ... die gi-sec
	// 'Eingefügt wird' soll alle einstellungen der fläche/des orts/des labels erhalten, die es
	// bekommen wird. alle werte mit den vorausgefüllten und default werden". Anlass war genau der
	// Fund: der Import setzte weder min_zoom/max_zoom noch Größe/Priorität, und
	// `avesmapsCreateLabelFeature` (api/_internal/map/features.php:3236) fiel dann auf
	// min_zoom=0/max_zoom=5/size=18/priority=3 zurück -- unabhängig von der Art.
	//
	// 🔴 KORREKTUR (Owner-Nachtrag 30.08.2026, wörtlich: „DOCH DER IMPORT SOLL SIE SETZEN!!!",
	// dann „WARUM DARF ICH DAS NICHT VERÄNDERN?"): diese Felder sind seither ECHTE Eingabefelder
	// (siehe unten) -- die Frage ist damit nicht mehr "was setzt der Import unsichtbar", sondern
	// "womit ist das Feld VORBELEGT". Das ändert, welche Tafel hier die richtige Quelle ist:
	//
	// 🔴 HIER GILT DIE VOLLE „VORGABE DER ART" (`avesmapsEcosystemDisplayVorgabe`/
	// `…BasisGroesse`), NICHT die schmale, admin-only Übersteuerung. Server-seitig
	// (avesmapsGaretienLabelVorgabeFuerArt) kennt der Import nur die ERSTE der drei Stufen (Admin-
	// Übersteuerung > gemessene Vorgabe der Art > Grundwert) -- die gemessene Tafel
	// `AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART` ist ein reiner Client-Schnappschuss ohne
	// PHP-Gegenstück (Grund: AGENTS.md §5, "eine Tafel, zwei Erzeuger, sie laufen auseinander" --
	// dort steht die Begründung für den SERVER). Für die VORBELEGUNG eines Eingabefelds gilt diese
	// Einschränkung NICHT: der Browser darf die volle, hilfreichere Empfehlung zeigen (z. B. Zoom 4
	// für einen See statt des uniformen Grundwerts 0), weil das Feld ohnehin editierbar ist UND
	// sein Inhalt -- gleich woher er stammt -- der Wert ist, der tatsächlich gesendet wird. Es gibt
	// dadurch keine zweite Wahrheit mehr, nur noch eine bessere Vorbelegung.
	//
	// ⚠️ DIESELBEN ZWEI WÄCHTER WIE BEIM SERVER bleiben trotzdem stehen: ein umgekehrtes Zoomband
	// ("aus", bis < ab, in der Darstellungstafel gültig) ist für ein neues Label keine gültige
	// Aussage und verwirft BEIDE Enden auf den Grundwert; eine Größe unter 10 pt (dem
	// Label-Minimum, unterhalb der 4..30-Schranke der Darstellungstafel) verwirft die Größe.
	function garetienEingabenVorbelegung(subtyp) {
		const grundwert = { minZoom: 0, maxZoom: 5, size: 18, prio: 3 };
		const vorbelegung = Object.assign({}, grundwert);
		if (typeof avesmapsEcosystemDisplayVorgabe === "function") {
			const vorgabe = avesmapsEcosystemDisplayVorgabe(subtyp);
			if (vorgabe && typeof vorgabe.ab === "number" && typeof vorgabe.bis === "number"
				&& vorgabe.bis >= vorgabe.ab) {
				vorbelegung.minZoom = vorgabe.ab;
				vorbelegung.maxZoom = vorgabe.bis;
			}
			if (vorgabe && typeof vorgabe.prio === "number") { vorbelegung.prio = vorgabe.prio; }
		}
		if (typeof avesmapsEcosystemDisplayBasisGroesse === "function") {
			const basis = avesmapsEcosystemDisplayBasisGroesse(subtyp);
			if (typeof basis === "number" && basis >= 10) { vorbelegung.size = basis; }
		}
		return vorbelegung;
	}

	// REIN: hat dieses Objekt überhaupt einen "neu anlegen"-Vorschlag? Dieselbe Frage wie
	// AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu (weiter unten), hier auf Objektebene gefragt: nur
	// wenn WENIGSTENS EIN Item change_type 'new' trägt, würde überhaupt etwas eingefügt -- eine
	// „Ergänzung" (Lücke füllen an einem VORHANDENEN Objekt) fügt nichts ein und bekommt diesen
	// Kasten deshalb zu Recht nicht.
	function garetienEingefuegtWirdHatVorschlag(objekt) {
		return ((objekt && objekt.items) || []).some(function (item) {
			return String((item && item.change_type) || "") === "new";
		});
	}

	// REIN: eine Datenzeile mit einem FREIEN Hinweistext statt einer Art-Empfehlung. Weg und Ort
	// haben keine Vorgabetafel wie die Landschaften (kein "Art X empfiehlt Zoom Y") -- ihre
	// Einstellungen sind Kartei-Felder ohne Art-Bezug (is_nodix, transport_seasons, …). Ein Hinweis
	// im Ton „Vorgabe der Art wäre …" wäre hier erfunden; diese Zeile nennt stattdessen die
	// Tatsache/Folge, ohne eine Tafel vorzutäuschen, die es nicht gibt.
	function garetienEingefuegtWirdZeileMitHinweis(beschriftung, echt, hinweisText) {
		const hinweis = hinweisText
			? '<span class="gi-insert__hint"> — ' + avesmapsGaretienEscape(hinweisText) + "</span>"
			: "";
		return '<p class="gi-insert__row">' + avesmapsGaretienEscape(beschriftung)
			+ ' <span class="gi-insert__val">(' + avesmapsGaretienEscape(String(echt)) + ")</span>"
			+ hinweis + "</p>";
	}

	function garetienEingefuegtWirdUeberschrift(text) {
		return '<p class="gi-insert__sub">' + avesmapsGaretienEscape(text) + "</p>";
	}

	// ---- Aufgabe „Eingefügt wird -> Eingabefelder" (Owner 30.08.2026, wörtlich: „ich hatte
	// plötzlich 3000 labels da stehen ... WARUM DARF ICH DAS NICHT VERÄNDERN?" -- „einstellbar"
	// heißt: hier, im Kasten, vor dem Einfügen). Die Werte der Fläche/Beschriftung werden
	// Eingabefelder, vorbelegt mit der Vorgabe der Art (bzw. dem Grundwert). Ort und Weg BLEIBEN
	// reine Anzeige (garetienEingefuegtWirdZeileMitHinweis, unverändert) -- die Recherche ergab,
	// dass dort nichts von alledem tatsächlich gespeichert wird (ein Ort trägt kein Zoomband).
	//
	// 🔴 DER SERVER BLEIBT DIE LETZTE INSTANZ. Ein Eingabefeld ist die Anzeige, nicht der Riegel --
	// avesmapsCreateLabelFeature/…EcosystemRegion prüfen jeden Wert selbst und lehnen einen
	// unsinnigen (z. B. `bis < ab`) ab, auch wenn der Browser ihn durchließe. Diese Datei validiert
	// hier bewusst NICHTS außer der reinen Zahlenform.
	//
	// 🔴 EIN GEÄNDERTER WERT GILT FÜR DIESES EINE OBJEKT -- er schreibt NIE in die Einstellungstafel
	// (`ecosystem_display`, die dem Landschaften-Editor gehört) und überlebt keinen Listenwechsel:
	// die Menge unten ist Modulzustand dieses FENSTERS, kein gespeicherter Zustand, kein
	// `localStorage`. Ein neu geöffneter Importer-Lauf startet wieder bei der Vorgabe der Art.
	//
	// 🔴 „ALLE ANGEZEIGTEN EINFÜGEN" NIMMT DIE VORGABEN, NIE DIE HANDEINGABEN. Die Massenübernahme
	// (garetienFussknopfKlick) ruft `garetienEingabenFuerServer` nirgends -- nur der Einzelknopf
	// „Neu einfügen" (garetienNeuKlick) tut das. Eine Massenhandlung, die die Einstellung EINES
	// zufällig zuletzt geöffneten Objekts auf alle übrigen anwendete, wäre genau die Falschaussage
	// über die nächste Handlung, die dem Owner am 30.08.2026 schon einmal 3007 Objekte gekostet hat.
	let _garetienEingabenZustand = {};

	// REIN: die Vorbelegung eines frisch geöffneten Objekts -- Vorgabe der Art (bzw. Grundwert) für
	// die vier Zahlenfelder, „aus"/„an" für die drei Haken. Liest dieselbe Tafel wie jede andere
	// Vorbelegung im Haus (avesmapsEcosystemDisplayVorgabe/…BasisGroesse), keine zweite.
	function garetienEingabenGrundwerte(objekt) {
		const vorbelegung = garetienEingabenVorbelegung(String((objekt && objekt.subtyp) || ""));
		return {
			size: vorbelegung.size, priority: vorbelegung.prio,
			minZoom: vorbelegung.minZoom, maxZoom: vorbelegung.maxZoom,
			showName: true, curveLabel: false, curveLabelMax: 1, isLocked: false,
			// 🔴 Nodix (Owner-Bestellung 30.08.2026, Bildschirmfoto „Beschriftung bearbeiten") --
			// KEINE Vorgabe der Art, genau wie isLocked/curveLabel: garetien.de liefert nie eine
			// Nodix-Aussage, der Grundwert ist immer „aus".
			isNodix: false,
			// 🔴 „Ort bearbeiten" (Owner 30.08.2026: „ja mach ort bearbeiten, dann weg bearbeiten").
			// Auch hier keine Vorgabe der Art: garetien.de trifft zu Ruine, Verborgenheit und
			// Ortsart keine Aussage. `placeKind` ist LEER und nicht etwa geraten -- eine erfundene
			// Art wäre eine Behauptung, die niemand getroffen hat, und der Anleger ließe den
			// Schlüssel bei "" ohnehin weg.
			isRuined: false, isHidden: false, placeKind: "",
			// 🔴 Die Hoehe eines Berggipfels -- LEER, und das ist die ganze Sicherung (Owner
			// 31.08.2026: „die berggipfel brauchen eine höhe als eigenschaft, gib ihnen das feld
			// mit"). Leer heisst „nicht erfasst"; avesmapsReadOptionalPeakHeight liefert dafuer
			// `null`, und der Anleger schreibt die Eigenschaft dann GAR NICHT. Ein Zahlenwert als
			// Vorgabe waere dagegen eine erfundene Hoehe an JEDEM importierten Gipfel.
			hoehe: "",
			// 🔴 „Weg bearbeiten" (Owner 30.08.2026). `showLabel` hat den Grundwert des Anlegers
			// (`show_label ?? false`).
			// 💣 `transports: null` heißt „UNANGETASTET", nicht „keines". Nur so bleibt der
			// Anlegeaufruf für einen nicht angefassten Weg zeichengleich zu dem von vorher: der
			// Client schickt dann gar kein `allowed_transports`, und avesmapsReadAllowedTransports
			// wählt dieselbe Vorauswahl der Wegart wie bisher. Eine leere LISTE ist dagegen eine
			// Aussage („kein Verkehrsmittel darf hier fahren") und reist mit.
			showLabel: false, transports: null,
		};
	}

	// REIN/ZUSTANDSHALTEND: der aktuelle Eingabestand eines Objekts -- angelegt beim ERSTEN Zugriff
	// (Vorbelegung), danach unverändert zurückgegeben, damit ein erneutes Rendern (z. B. nach einem
	// Listen-Refetch) eine bereits getippte Handeingabe nicht verwirft. Derselbe Bau wie
	// garetienWikiSucheZustandZu daneben.
	function garetienEingabenZustandZu(objekt) {
		const key = String((objekt && objekt.key) || "");
		if (!_garetienEingabenZustand[key]) {
			_garetienEingabenZustand[key] = garetienEingabenGrundwerte(objekt);
		}
		return _garetienEingabenZustand[key];
	}

	function garetienEingabeId(objekt, feld) {
		return "gi-feld-" + avesmapsGaretienEscape(String((objekt && objekt.key) || "")) + "-" + feld;
	}

	// REIN: dieselbe Umrechnung wie avesmapsLabelVorgabeMarkePosition (js/review/review-labels.js,
	// dort fuer den ECHTEN Beschriftungsdialog #label-edit-form) -- hier als EIGENE, kleine Kopie,
	// nicht als Aufruf dorthin. Grund: js/review/__tests__/label-vorgabemarke.test.js schneidet
	// jene Funktion TEXTUELL aus review-labels.js heraus und fuehrt sie ISOLIERT ueber `new
	// Function(...)` aus (kein globales Objekt, keine anderen Bezeichner erreichbar) -- eine
	// Umleitung von dort auf einen gemeinsamen Helfer wuerde GENAU DIESEN Quelltexttest brechen
	// (AGENTS.md: „ein Quelltexttest trifft die Definitionszeile mit"). Die Formel ist eine einzige
	// Zeile Mathematik ohne DOM-Bezug; sie hier zu wiederholen ist günstiger und sicherer als den
	// bestehenden, fragilen Test eines ausgelieferten Features anzufassen.
	//
	// 💣 Die 16px Knopfbreite sind dieselbe Zahl wie in review-labels.js und .label-edit-marke
	// (css/components/location-report-dialog.css) -- ein gekoppelter Wert in DREI Dateien.
	function garetienSliderMarkePosition(wert, min, max) {
		const spanne = Number(max) - Number(min);
		const anteil = spanne === 0 ? 0 : Math.max(0, Math.min(1, (Number(wert) - Number(min)) / spanne));
		return "calc(" + (anteil * 100) + "% + " + (8 - anteil * 16) + "px)";
	}

	// REIN: eine Zahlenzeile -- Beschriftung + Zahlenfeld + REGLER + VORGABE-MARKE, dieselbe
	// Bauform wie der echte Beschriftungsdialog (index.html #label-edit-form:
	// .location-report-form__field--zeile > .label-edit-sliderrow > [Zahl, .label-edit-markewrap
	// > [Regler, .label-edit-marke]]). Owner-Bestellung 30.08.2026: „ich will die ECHTEN
	// Steuerelemente dieser Dialoge im Importer — nicht eine Nachbildung mit Zahlenfeldern."
	//
	// 🔴 Die drei Klassen sind GLOBAL definiert (css/components/region-sync.css,
	// …/location-report-dialog.css) -- keine neue CSS-Regel noetig, keine zweite Bauform.
	// ⚠️ Und ABSICHTLICH nicht dieselbe JS-Verdrahtung: review-labels.js haengt einen document-weiten
	// `input`-Zuhoerer an `.label-edit-sliderrow`, der bei jeder Beruehrung (auch hier) mitlaeuft --
	// harmlos (sein `labelDisplayPreview` ist null, solange der echte Dialog nicht offen ist), aber
	// dieser Kasten verlaesst sich NICHT darauf: garetienEingabenAendern spiegelt Zahl<->Regler
	// selbst (siehe dort), damit dieses Fenster von jenem Modul unabhaengig bleibt.
	//
	// `grenzen` ist eine Anzeigehilfe (`min`/`max` an BEIDEN Feldern), KEIN Ersatz für die
	// Server-Prüfung -- ein Browser, der sie ignoriert, bekommt vom Server trotzdem eine Ablehnung.
	// `vorgabeWert` ist die Vorgabe der Art (nicht der aktuelle Wert!) -- die Marke bewegt sich beim
	// Ziehen NICHT mit, sie zeigt, wovon eine Handeingabe abweicht. `undefined`/`null`/`NaN`
	// unterdrückt die Marke (z. B. „Anzahl Beschriftungen", die keine Art-Vorgabe hat).
	function garetienEingefuegtWirdZahlZeile(objekt, beschriftung, feld, wert, einheit, grenzen, deaktiviert, vorgabeWert) {
		const id = garetienEingabeId(objekt, feld);
		const idRegler = id + "-range";
		const idMarke = id + "-marke";
		const marke = (typeof vorgabeWert === "number" && Number.isFinite(vorgabeWert))
			? '<i class="label-edit-marke" id="' + idMarke + '" style="left: '
				+ garetienSliderMarkePosition(vorgabeWert, grenzen.min, grenzen.max)
				+ ';" title="Vorgabe: ' + avesmapsGaretienEscape(String(vorgabeWert)) + '" aria-hidden="true"></i>'
			: "";
		return '<label class="location-report-form__field location-report-form__field--zeile gi-insert__row">'
			+ "<span>" + avesmapsGaretienEscape(beschriftung) + "</span>"
			+ '<div class="label-edit-sliderrow">'
			+ '<input type="number" class="gi-insert__input" id="' + id + '" data-gi-feld="' + feld + '" '
			+ 'min="' + grenzen.min + '" max="' + grenzen.max + '" value="' + Number(wert) + '"'
			+ (deaktiviert ? " disabled" : "") + ">"
			+ '<span class="label-edit-markewrap">'
			+ '<input type="range" id="' + idRegler + '" data-gi-feld="' + feld + '" '
			+ 'min="' + grenzen.min + '" max="' + grenzen.max + '" value="' + Number(wert) + '"'
			+ (deaktiviert ? " disabled" : "") + ' aria-label="' + avesmapsGaretienEscape(beschriftung) + '">'
			+ marke
			+ "</span>"
			+ (einheit ? ' <span class="gi-insert__unit">' + avesmapsGaretienEscape(einheit) + "</span>" : "")
			+ "</div></label>";
	}

	// REIN: eine Häkchenzeile -- dasselbe Muster, für die drei Ja/Nein-Einstellungen des Kastens.
	// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 6a: `deaktiviert` sperrt das Haekchen, wenn das
	// Objekt bereits UEBERNOMMEN ist -- hier gibt es dann nichts mehr zu entscheiden.
	function garetienEingefuegtWirdHakenZeile(objekt, beschriftung, feld, angehakt, deaktiviert) {
		const id = garetienEingabeId(objekt, feld);
		return '<p class="gi-insert__row gi-insert__row--edit">'
			+ '<label for="' + id + '"><input type="checkbox" id="' + id + '" data-gi-feld="' + feld + '"'
			+ (angehakt ? " checked" : "") + (deaktiviert ? " disabled" : "") + "> "
			+ avesmapsGaretienEscape(beschriftung) + "</label></p>";
	}

	// REIN: eine Textzeile -- Beschriftung + Freitextfeld. Bislang nur für die Ortsart
	// (`place_kind`) gebraucht, deshalb bewusst schlicht: der echte Dialog „Ort bearbeiten"
	// (index.html #location-edit-place-kind) hängt dort eine Vorschlagsliste mit Nutzungszahlen an
	// (js/ui/place-kind-autocomplete.js), die ihren Katalog über einen EIGENEN Endpunkt holt.
	//
	// 🔴 Die wird hier NICHT nachgebaut. Sie ist ein eigenständiges Bauteil mit eigenem Abruf, und
	// eine zweite, abgespeckte Fassung wäre genau die Doppelung, die dieses Fenster an den
	// Listenzeilen (sieben Rezepturen) und der Wiki-Zuweisung (sechs Fassungen) schon zweimal
	// bezahlt hat. Der Server rastet den getippten Wert ohnehin auf den Katalog ein
	// (avesmapsNormalizePlaceKind) -- ein Wort daneben wird verworfen, nicht falsch gespeichert.
	// 🔧 Wenn der Owner die Vorschlagsliste hier haben will, ist das der Ort, an dem das Bauteil
	// eingehängt wird -- nicht der Ort, an dem eine zweite entsteht.
	function garetienEingefuegtWirdTextZeile(objekt, beschriftung, feld, wert, platzhalter, deaktiviert) {
		const id = garetienEingabeId(objekt, feld);
		return '<label class="location-report-form__field location-report-form__field--zeile gi-insert__row" for="'
			+ id + '"><span>' + avesmapsGaretienEscape(beschriftung) + "</span>"
			+ '<input type="text" class="gi-insert__input gi-insert__input--text" id="' + id + '" '
			+ 'data-gi-feld="' + feld + '" maxlength="120" autocomplete="off" '
			+ 'value="' + avesmapsGaretienEscape(String(wert || "")) + '" '
			+ 'placeholder="' + avesmapsGaretienEscape(platzhalter || "") + '"'
			+ (deaktiviert ? " disabled" : "") + "></label>";
	}

	// REIN: die Hoehe eines Berggipfels -- Zahl + Regler wie im echten Dialog (index.html
	// #label-edit-height-row), aber mit einem Zustand, den ein Regler allein nicht ausdruecken kann:
	// LEER.
	//
	// 💣 UND GENAU DIESER LEERE ZUSTAND IST DIE SICHERUNG. Ein Berggipfel ist ein STUETZPUNKT DES
	// HOEHENFELDS -- terrain-store.php liest `is_active = 1` + `height_schritt`, und daraus entsteht
	// das Gelaende, ueber das der Router seine Steigungen rechnet. Volkers Daten tragen keine Hoehe;
	// eine Vorgabezahl hier schriebe an JEDEN importierten Gipfel denselben erfundenen Wert und
	// veraenderte das Gelaendemodell lautlos falsch. Deshalb hat die Uebernahme das Feld bis heute
	// ganz weggelassen (mit genau dieser Begruendung im Code) -- und deshalb ist es jetzt zwar da,
	// aber leer: geschrieben wird nur, was ein Mensch eingetippt hat.
	// ⚠️ `avesmapsReadOptionalPeakHeight` (features.php) macht aus leer `null`, und der Anleger
	// entfernt die Eigenschaft dann, statt eine 0 zu schreiben. NULL und 0 sind dort zwei
	// verschiedene Aussagen; diese Zeile darf sie nicht verwischen.
	// ⚠️ Der Regler steht bei leerem Feld auf 0 -- ihn zu bewegen IST eine Eingabe und fuellt die
	// Zahl. Die Grenzen (0..20000, Schritt 50) sind dieselben wie im echten Dialog.
	function garetienEingefuegtWirdHoeheZeile(objekt, wert, deaktiviert) {
		const id = garetienEingabeId(objekt, "hoehe");
		const roh = String(wert === null || wert === undefined ? "" : wert);
		return '<label class="location-report-form__field location-report-form__field--zeile gi-insert__row">'
			+ "<span>Höhe (Schritt)</span>"
			+ '<div class="label-edit-sliderrow">'
			+ '<input type="number" class="gi-insert__input" id="' + id + '" data-gi-feld="hoehe" '
			+ 'min="0" max="20000" step="1" inputmode="numeric" placeholder="nicht erfasst" '
			+ 'value="' + avesmapsGaretienEscape(roh) + '"' + (deaktiviert ? " disabled" : "") + ">"
			+ '<span class="label-edit-markewrap">'
			+ '<input type="range" id="' + id + '-range" data-gi-feld="hoehe" '
			+ 'min="0" max="20000" step="50" value="' + (roh === "" ? "0" : avesmapsGaretienEscape(roh)) + '"'
			+ (deaktiviert ? " disabled" : "") + ' aria-label="Höhe in Schritt">'
			+ "</span></div></label>"
			+ '<p class="gi-insert__row"><span class="gi-insert__hint">Leer heißt „nicht erfasst" — '
			+ "dann bekommt der Gipfel keine Höhe, und das Höhenfeld bleibt unberührt. Nachtragbar "
			+ "im Beschriftungsdialog.</span></p>";
	}

	// REIN: „Fläche" -- für Klicks gesperrt (is_locked). Kein Vergleichswert/keine Vorgabe der Art
	// nötig -- es gibt keine Art-Empfehlung für diese Spalte, sie ist eine reine
	// Karteneigenschaft je Region (AGENTS.md §11, „Stapelreihenfolge und Klick-Sperre der REGION"),
	// ihr Grundwert ist immer „aus".
	function garetienEingefuegtWirdFlaecheMarkup(objekt, deaktiviert) {
		const eingaben = garetienEingabenZustandZu(objekt);
		return garetienEingefuegtWirdUeberschrift("Fläche")
			+ garetienEingefuegtWirdHakenZeile(objekt, "für Klicks gesperrt", "isLocked", eingaben.isLocked,
				deaktiviert);
	}

	// REIN: derselbe Hinweistext wie im echten Beschriftungsdialog (index.html,
	// .landschaft-dialog__bindung, wortgleich) -- ein Editor, der beide Oberflächen kennt, lernt
	// keine zweite Aussage. Die Klasse ist global definiert (css/components/landschaft-dialog.css,
	// über styles.css geladen) -- keine neue CSS-Regel nötig.
	function garetienEingefuegtWirdBindungHinweis(curveLabel) {
		return curveLabel
			? '<p class="landschaft-dialog__bindung"><b>An die Fläche gebunden:</b> die Beschriftung '
				+ "läuft auf der Mittelachse der Fläche. Ihre eigene Position und Drehung wirken "
				+ "nicht mehr.</p>"
			: '<p class="landschaft-dialog__bindung">Die Beschriftung liegt frei auf der Karte und '
				+ "lässt sich unabhängig von der Fläche verschieben.</p>";
	}

	// REIN: „Beschriftung" -- Nodix/Größe/Priorität/Zoomband/[Kurvenbeschreibung]/Auf Karte
	// anzeigen, ALLE editierbar -- dieselben Felder und dieselbe Reihenfolge wie im echten Dialog
	// (index.html #label-edit-form: „Eigenschaften" vor „Darstellung"). `mitKurve` gilt nur bei
	// einer FLÄCHE -- ein Berggipfel-Label hängt an keiner `ecosystem_region` (siehe der
	// 'label'-Zweig in avesmapsGaretienUebernehmen) und kennt deshalb weder Kurvenbeschreibung noch
	// „für Klicks gesperrt".
	// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 6a: `deaktiviert` sperrt ALLE Felder dieses Kastens,
	// wenn das Objekt bereits UEBERNOMMEN ist (Owner: „die editoren sollen dann das objekt auf der
	// karte editieren"). Die „Anzahl Beschriftungen" bleibt zusaetzlich an ihre eigene Bedingung
	// gebunden (`!eingaben.curveLabel`) -- beide Gruende sperren unabhaengig voneinander.
	function garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, mitKurve, deaktiviert) {
		const eingaben = garetienEingabenZustandZu(objekt);
		// Die VIER Vorgabemarken -- dieselbe Tafel wie bei der Vorbelegung, hier ein zweites Mal
		// gelesen, weil sie sich NICHT mit der (ggf. schon geänderten) Handeingabe bewegen dürfen.
		const vorgabe = garetienEingabenVorbelegung(subtyp);
		// 🔴 NUR EIN BERGGIPFEL BEKOMMT DIE HOEHE, und gefragt wird mit DERSELBEN Funktion wie im
		// echten Dialog (`isEcosystemPeakSubtype`, map-features-ecosystem-height-field.js) -- eine
		// eigene Liste der Gipfel-Arten waere ihre zweite Fassung und liefe beim naechsten Eintrag
		// auseinander. ⚠️ Faellt sie aus (Seite ohne Kartenschicht), gibt es keine Zeile: lieber
		// ein fehlendes Feld als eines an einer Seebeschriftung.
		const istGipfel = typeof isEcosystemPeakSubtype === "function" && isEcosystemPeakSubtype(subtyp);
		let markup = garetienEingefuegtWirdUeberschrift("Beschriftung")
			+ (istGipfel ? garetienEingefuegtWirdHoeheZeile(objekt, eingaben.hoehe, deaktiviert) : "")
			+ garetienEingefuegtWirdHakenZeile(objekt, "Nodix", "isNodix", eingaben.isNodix, deaktiviert)
			+ garetienEingefuegtWirdZahlZeile(objekt, "Größe", "size", eingaben.size, "pt",
				{ min: 10, max: 56 }, deaktiviert, vorgabe.size)
			+ garetienEingefuegtWirdZahlZeile(objekt, "Priorität", "priority", eingaben.priority, "",
				{ min: 1, max: 5 }, deaktiviert, vorgabe.prio)
			+ garetienEingefuegtWirdZahlZeile(objekt, "Sichtbar ab Zoom", "minZoom", eingaben.minZoom, "",
				{ min: 0, max: 7 }, deaktiviert, vorgabe.minZoom)
			+ garetienEingefuegtWirdZahlZeile(objekt, "Sichtbar bis Zoom", "maxZoom", eingaben.maxZoom, "",
				{ min: 0, max: 7 }, deaktiviert, vorgabe.maxZoom);
		if (mitKurve) {
			// „mit Anzahl wenn an" (Auftrag): die Anzahl steht immer im Kasten, aber gesperrt, solange
			// die Kurvenbeschreibung selbst aus ist -- dieselbe Sperr-statt-Verstecken-Form wie bei
			// jedem anderen abhängigen Feld dieses Hauses (kein DOM-Umbau bei jedem Klick nötig).
			// Keine Vorgabemarke fuer die Anzahl -- es gibt dafuer keine Tafel der Art.
			markup += garetienEingefuegtWirdHakenZeile(objekt, "Kurvenbeschreibung", "curveLabel",
					eingaben.curveLabel, deaktiviert)
				+ garetienEingefuegtWirdZahlZeile(objekt, "Anzahl Beschriftungen", "curveLabelMax",
					eingaben.curveLabelMax, "", { min: 1, max: 3 }, deaktiviert || !eingaben.curveLabel)
				+ garetienEingefuegtWirdBindungHinweis(eingaben.curveLabel);
		}
		markup += garetienEingefuegtWirdHakenZeile(objekt, "Auf Karte anzeigen", "showName", eingaben.showName,
			deaktiviert);
		return markup;
	}

	// Ein Eingabefeld des Kastens hat sich geändert -- der Zustand liegt in
	// `_garetienEingabenZustand`, NICHT im DOM: die Detailspalte wird bei jedem Listen-Refetch neu
	// gebaut (garetienDetailRendern), ein Zustand nur am Feld wäre dabei verloren.
	//
	// 💣 `feld === "curveLabel"` schaltet zusätzlich das Nachbarfeld frei/gesperrt -- DIREKT am
	// DOM-Knoten, ohne die ganze Spalte neu zu rendern (das würde jede andere, gerade offene
	// Eingabe mit verwerfen).
	function garetienEingabenAendern(ereignis, objekte) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || !ziel.getAttribute || !ziel.hasAttribute("data-gi-feld")) { return; }
		if (zustand.detailKey === null) { return; }
		const objekt = (objekte || zustand.objekte || []).filter(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		})[0] || null;
		if (!objekt) { return; }
		const eingaben = garetienEingabenZustandZu(objekt);
		const feld = ziel.getAttribute("data-gi-feld");
		// 🔴 DIE ZIELWAHL STEHT VOR ALLEM ANDEREN -- sie ist kein Wert des Kastens, sie entscheidet,
		// WELCHE Felder der Kasten überhaupt hat. Deshalb baut sie die Detailspalte neu, statt nur
		// einen Wert abzulegen.
		// 💣 EIN FORMWECHSEL SETZT DIE ART MIT, und zwar auf die erste der neuen Form: die alte Art
		// gibt es in der neuen Form nicht (ein „Sumpf" ist kein Ortstyp), und ein stehengebliebener
		// Wert ginge als gültige Wahl an den Server.
		if (feld === "zielForm" || feld === "zielArt") {
			const wahl = garetienZielWahlZu(objekt);
			if (feld === "zielForm") {
				wahl.ziel = String(ziel.value || "");
				const ersteArt = garetienArtenFuerForm(wahl.ziel)[0] || null;
				wahl.subtyp = ersteArt ? ersteArt.key : "";
				wahl.kind = ersteArt ? String(ersteArt.kind || "") : "";
			} else {
				wahl.subtyp = String(ziel.value || "");
				const gewaehlt = garetienArtenFuerForm(wahl.ziel).filter(function (a) {
					return a.key === wahl.subtyp;
				})[0];
				wahl.kind = gewaehlt ? String(gewaehlt.kind || "") : "";
			}
			garetienDetailRendern(objekte || zustand.objekte || []);
			return;
		}
		// 🔴 EIN VERKEHRSMITTEL IST KEIN JA/NEIN-FELD, sondern ein Eintrag in einer LISTE -- dieser
		// Zweig muss deshalb VOR dem Häkchen-Zweig darunter stehen. Stünde er dahinter, machte
		// `eingaben["transports"] = Boolean(checked)` aus der Liste ein Bool, und der nächste Klick
		// läse `indexOf` auf `true`.
		// ⚠️ Der Riegel ist das FELD, nicht die blosse Anwesenheit von `data-gi-transport`: nur so
		// hängt er nicht davon ab, dass ein Aufrufer (oder eine Test-Attrappe) auf eine unbekannte
		// Attributfrage wirklich `null` antwortet.
		const vmSchluessel = feld === "transports" ? ziel.getAttribute("data-gi-transport") : "";
		if (vmSchluessel) {
			const jetzt = garetienWegTransporteZu(objekt, String(objekt.subtyp || "")).slice();
			const stelle = jetzt.indexOf(vmSchluessel);
			if (ziel.checked && stelle === -1) { jetzt.push(vmSchluessel); }
			if (!ziel.checked && stelle !== -1) { jetzt.splice(stelle, 1); }
			// Ab jetzt ist die Liste ANGETASTET und reist mit -- auch wenn sie zufällig wieder der
			// Vorauswahl entspricht. Wer ein Häkchen setzt und wieder entfernt, hat eine
			// Entscheidung getroffen; sie stillschweigend auf „unangetastet" zurückzudrehen wäre
			// eine andere Aussage als die getroffene.
			eingaben.transports = jetzt;
			return;
		}
		if (ziel.type === "checkbox") {
			eingaben[feld] = Boolean(ziel.checked);
			if (feld === "curveLabel" && hasDocument) {
				const maxFeld = document.getElementById(garetienEingabeId(objekt, "curveLabelMax"));
				if (maxFeld) { maxFeld.disabled = !eingaben.curveLabel; }
			}
			return;
		}
		// Ein FREITEXTFELD (heute nur die Ortsart) wird unverändert übernommen -- auch leer, denn
		// „keine Art" ist ein gültiger Zustand. 🔴 Hier wird NICHT auf den Ortsarten-Katalog
		// eingerastet: das tut avesmapsNormalizePlaceKind auf dem Server, und eine zweite
		// Normalisierung im Browser wäre die zweite Wahrheit über denselben Katalog.
		if (ziel.type === "text") {
			eingaben[feld] = String(ziel.value || "");
			return;
		}
		// 🔴 DIE HOEHE DARF LEER WERDEN, und das ist der Unterschied zu jedem anderen Zahlenfeld
		// hier: leer heisst „nicht erfasst", und der Anleger schreibt die Eigenschaft dann gar
		// nicht. Faenge sie der Riegel darunter ab („leeres Feld behält den letzten Stand"), liesse
		// sich eine einmal getippte Hoehe nie wieder loeschen -- und ein erfundener Wert bliebe am
		// Gipfel stehen, obwohl der Editor ihn ausdruecklich weggenommen hat.
		if (feld === "hoehe" && String(ziel.value || "").trim() === "") {
			eingaben.hoehe = "";
			if (hasDocument) {
				const reglerLeer = document.getElementById(garetienEingabeId(objekt, "hoehe") + "-range");
				if (reglerLeer && reglerLeer !== ziel) { reglerLeer.value = "0"; }
				const zahlLeer = document.getElementById(garetienEingabeId(objekt, "hoehe"));
				if (zahlLeer && zahlLeer !== ziel) { zahlLeer.value = ""; }
			}
			return;
		}
		// Ein leeres/kaputtes Feld behält den letzten gültigen Stand, statt `NaN` zu speichern --
		// der Server sähe dann die Zeichenkette "NaN" statt einer Zahl.
		const zahl = parseInt(ziel.value, 10);
		if (isNaN(zahl)) { return; }
		eingaben[feld] = zahl;
		// 🔴 ZAHL UND REGLER SPIEGELN SICH GEGENSEITIG -- unabhängig davon, welches der beiden Felder
		// die Eingabe ausgelöst hat. Dieselbe Bauform wie im echten Beschriftungsdialog
		// (review-labels.js), aber hier EIGENSTÄNDIG verdrahtet: jene Datei hängt zwar auch einen
		// document-weiten Zuhörer an dieselben CSS-Klassen (harmlos, siehe der Kommentar an
		// garetienEingefuegtWirdZahlZeile), aber dieser Kasten verlässt sich nicht auf ein fremdes
		// Modul -- er spiegelt selbst, damit er unabhängig bleibt.
		if (hasDocument) {
			const idNummer = garetienEingabeId(objekt, feld);
			const idRegler = idNummer + "-range";
			const nummerFeld = document.getElementById(idNummer);
			const reglerFeld = document.getElementById(idRegler);
			if (nummerFeld && nummerFeld !== ziel) { nummerFeld.value = String(zahl); }
			if (reglerFeld && reglerFeld !== ziel) { reglerFeld.value = String(zahl); }
		}
	}

	// REIN: was aus dem Kasten an den Server reist -- nur, was für DIESES Ziel wirklich gilt (ein
	// Ort/Weg speichert keines dieser Felder, siehe die Recherche am Auftrag). `null` heißt „keine
	// Handeingabe" -- der einzige Wert, den die Massenübernahme je sieht (sie ruft diese Funktion
	// nicht, aber ein `null` ist trotzdem die korrekte Antwort für ein Ziel ohne diese Felder).
	function garetienEingabenFuerServer(objekt) {
		// 🔴 DIE GEWÄHLTE Form entscheidet, WELCHE Felder mitreisen -- ein zum Gipfel gewechselter
		// Sumpf schickt die Label-Felder, nicht die der Fläche.
		const wahl = garetienZielWahlZu(objekt);
		const ziel = String(wahl.ziel || "");
		// 💣 UND DIE WAHL SELBST REIST IMMER MIT, auch wenn sie dem Vorschlag entspricht: der Server
		// vergleicht (avesmapsGaretienZielUebersteuern) und formt nur um, wenn sie abweicht. Sie
		// wegzulassen, solange nichts geändert wurde, hiesse zwei Wege durch dieselbe Tür.
		const zielRumpf = { ziel: ziel, subtyp: String(wahl.subtyp || ""), kind: String(wahl.kind || "") };
		// 🔴 Der ORT hat seit dem 30.08.2026 eigene Felder, und sie heißen ANDERS als im Browser:
		// hier `isNodix`, im Anfragerumpf `is_nodix` -- die Schlüssel des Anlegers
		// (avesmapsCreatePointFeature) sind der Vertrag, nicht die des Fensters.
		if (ziel === "location") {
			const ortEingaben = garetienEingabenZustandZu(objekt);
			return Object.assign({}, zielRumpf, {
				is_nodix: ortEingaben.isNodix, is_ruined: ortEingaben.isRuined,
				is_hidden: ortEingaben.isHidden, place_kind: ortEingaben.placeKind,
			});
		}
		// 🔴 Der WEG ebenso, seit dem 30.08.2026 -- und `allowed_transports` reist NUR mit, wenn
		// jemand die Auswahl wirklich angefasst hat (`transports !== null`). Sonst wählt der Server
		// dieselbe Vorauswahl der Wegart wie bisher, und der Anlegeaufruf bleibt zeichengleich zu
		// dem von vorher. Eine LEERE Liste ist dagegen eine Aussage und reist mit.
		if (ziel === "path") {
			const wegEingaben = garetienEingabenZustandZu(objekt);
			const rausWeg = Object.assign({}, zielRumpf, { show_label: wegEingaben.showLabel });
			if (wegEingaben.transports !== null) {
				rausWeg.allowed_transports = wegEingaben.transports;
			}
			return rausWeg;
		}
		if (ziel !== "region" && ziel !== "label") { return zielRumpf; }
		const eingaben = garetienEingabenZustandZu(objekt);
		const raus = Object.assign({}, zielRumpf, {
			size: eingaben.size, priority: eingaben.priority,
			min_zoom: eingaben.minZoom, max_zoom: eingaben.maxZoom,
			show_name: eingaben.showName, is_nodix: eingaben.isNodix,
		});
		// 🔴 NUR WENN WIRKLICH ETWAS DASTEHT. Ein leeres Feld schickt den Schluessel GAR NICHT --
		// avesmapsCreateLabelFeature schreibt `height_schritt` nur, wenn der Schluessel im Rumpf
		// steht und einen brauchbaren Wert traegt. Eine mitgeschickte "" waere zwar auch `null`,
		// aber der Rumpf behauptete damit, jemand habe ueber die Hoehe entschieden.
		if (String(eingaben.hoehe || "").trim() !== "") {
			raus.height_schritt = eingaben.hoehe;
		}
		if (ziel === "region") {
			raus.is_locked = eingaben.isLocked;
			raus.curve_label = eingaben.curveLabel;
			raus.curve_label_max = eingaben.curveLabelMax;
		}
		return raus;
	}

	// REIN: „Ort" -- die Zoomstufe kommt aus einer FESTEN Klassentafel
	// (js/map-features/location-zoom-bands.js), nicht aus dem Import: ein Ort trägt gar kein
	// min_zoom/max_zoom in seinen `properties_json` (avesmapsCreatePointFeature, features.php),
	// die Karte liest die Größe allein aus `settlement_class` beim Zeichnen. Es gibt hier also
	// nichts, das der Import „falsch" setzen könnte -- anders als bei Fläche/Label.
	//
	// Owner-Nachtrag 30.08.2026: „vergiss nicht die andern einstellungen aus 'Weg bearbeiten',
	// 'Ort bearbeiten' usw." -- Recherche gegen avesmapsCreatePointFeature (features.php:1595) und
	// den Ortsdialog (index.html #location-edit-*): der Import schickt NUR name/feature_subtype/
	// lat/lng. Sechs weitere Felder des Dialogs bekommen dabei ihren TABELLENDECKEL, nie eine vom
	// Import gesetzte Aussage -- dieselbe Lage wie „für Klicks gesperrt" bei der Fläche, deshalb
	// dieselbe Form: der echte Wert, keine „Vorgabe der Art" (es gibt dafür keine Tafel).
	// 🔴 SEIT DEM 30.08.2026 EINSTELLBAR (Owner: „ja mach ort bearbeiten, dann weg bearbeiten") --
	// aber NUR die vier Felder, hinter denen beim Anlegen wirklich ein Schreibweg steht:
	// `is_nodix`/`is_ruined`/`is_hidden` stehen fest im $properties-Rumpf von
	// avesmapsCreatePointFeature, `place_kind` nur, wenn es nach avesmapsNormalizePlaceKind nicht
	// leer ist. Serverseitig nimmt sie avesmapsGaretienOrtUebersteuerung entgegen.
	//
	// 🔴 ZWEI ZEILEN BLEIBEN ANZEIGE, UND DAS IST DIE EIGENTLICHE ENTSCHEIDUNG. Die Zoomstufe ist
	// eine feste Klassentafel (js/map-features/location-zoom-bands.js) und gar kein
	// properties_json-Feld; Einwohner/Lage/Herrscher entstehen aus der WIKI-Zuweisung
	// (avesmapsApplyPointWikiFields), nicht aus dem Anfragerumpf. Ein Eingabefeld darauf wäre ein
	// Bedienelement, das nichts tut — und von einem, das wirkt, von außen nicht zu unterscheiden.
	// Das ist teurer als eine fehlende Einstellmöglichkeit: es sieht wie eine getroffene
	// Entscheidung aus.
	function garetienEingefuegtWirdOrtMarkup(objekt, subtyp, deaktiviert) {
		const eingaben = garetienEingabenZustandZu(objekt);
		const abZoom = (typeof avesmapsLocationZoomBandMinZoom === "function")
			? avesmapsLocationZoomBandMinZoom("marker", subtyp)
			: null;
		const zeile = abZoom === null
			? "erscheint auf keiner Zoomstufe der heutigen Tafel"
			: "erscheint ab Zoom " + avesmapsGaretienEscape(String(abZoom));
		return garetienEingefuegtWirdUeberschrift("Ort")
			+ '<p class="gi-insert__row">Diese Ortsklasse ' + zeile
			+ ' <span class="gi-insert__hint">(feste Vorgabe der Klasse — kein Einstellwert '
			+ "dieses Imports)</span></p>"
			// Beschriftung und Platzhalter wortgleich zum echten Dialog (index.html
			// #location-edit-place-kind) -- ein Editor, der beide Oberflächen kennt, lernt keine
			// zweite Aussage.
			+ garetienEingefuegtWirdTextZeile(objekt, "Art", "placeKind", eingaben.placeKind,
				"z. B. Brücke – leer lassen, wenn unbekannt", deaktiviert)
			+ garetienEingefuegtWirdHakenZeile(objekt, "Ort ist ein Nodix", "isNodix",
				eingaben.isNodix, deaktiviert)
			+ garetienEingefuegtWirdHakenZeile(objekt, "Ruine/zerstört", "isRuined",
				eingaben.isRuined, deaktiviert)
			+ garetienEingefuegtWirdHakenZeile(objekt, "Verborgen", "isHidden",
				eingaben.isHidden, deaktiviert)
			+ garetienEingefuegtWirdZeileMitHinweis("Einwohner · Lage · Herrscher", "keine Angabe",
				"füllt sich nur über die Wiki-Zuweisung, nicht über diesen Import — hier nicht "
				+ "einstellbar, weil der Anleger diese drei gar nicht aus der Anfrage liest");
	}

	// REIN: „Weg" -- Name-Anzeige, Verkehrsmittel, Jahreszeiten und (nur bei einem Flussweg) die
	// Strömung. Der Wegtyp selbst steht schon im Kopf (garetienTypText); dies sind die übrigen
	// Einstellungen aus dem Dialog „Weg bearbeiten" (index.html #path-edit-*).
	//
	// Owner-Nachtrag 30.08.2026, wörtlich das Gegenstück zur Fläche: „vergiss nicht die andern
	// einstellungen aus 'Weg bearbeiten' … usw.". Recherche gegen avesmapsCreatePathFeature
	// (features.php:2446): der Import schickt NUR name/feature_subtype/coordinates.
	//
	// 🔴 KEINE eigene Verkehrsmittel-Tafel hier -- getDefaultTransportDomainForPathSubtype /
	// getDefaultAllowedTransportsForPathSubtype (js/map-features/map-features-path-domain.js) sind
	// dieselbe Regel, die der Server beim Anlegen anwendet: `avesmapsReadAllowedTransports($payload
	// ['allowed_transports'] ?? null, $domain, $subtype)` fällt GENAU auf ihre Vorauswahl zurück,
	// wenn -- wie beim Import -- nichts mitgeschickt wird. Es gibt hier also NIE eine Abweichung zu
	// melden; die Zeile nennt die echte Zahl trotzdem, weil ein Weg eine Kante im Routing-Graphen
	// ist und die Auswahl der Verkehrsmittel jede Route mitbestimmt.
	// ⚠️ Es gibt KEINE geteilte Beschriftungstafel für die elf Verkehrsmittel-Schlüssel (nur
	// literale Texte in index.html und wörtliche Kopien in wege-editor.js/transport-speed-info.js) --
	// eine vierte Kopie wird hier bewusst nicht angelegt, gezählt wird stattdessen.
	// REIN (liest das DOM): die Beschriftungen der Verkehrsmittel -- aus dem ECHTEN Dialog „Weg
	// bearbeiten" im SELBEN Dokument (`#path-edit-transport-options` in index.html).
	//
	// 🔴 KEINE VIERTE KOPIE. Es gibt im Haus keine geteilte Tafel für die elf Schlüssel: die Texte
	// stehen literal in index.html und wörtlich abgeschrieben in wege-editor.js und
	// transport-speed-info.js. Der alte Kommentar an dieser Stelle hat davor gewarnt und deshalb
	// nur GEZÄHLT statt benannt („2 von 2 möglichen"). Für Häkchen braucht es Namen — und die
	// billigste Quelle ist die, die ohnehin danebensteht: derselbe Dialog, dasselbe Dokument. Wer
	// dort ein Verkehrsmittel umbenennt oder ergänzt, ändert diesen Kasten mit, ohne davon zu wissen.
	// ⚠️ Fehlt das Element (kein DOM, anderes Dokument), fällt die Beschriftung auf den SCHLÜSSEL
	// zurück -- unschön, aber ehrlich. Ein erfundener Name wäre eine Behauptung.
	function garetienVerkehrsmittelNamen() {
		const raus = {};
		if (!hasDocument) { return raus; }
		const wirt = document.getElementById("path-edit-transport-options");
		if (!wirt || typeof wirt.querySelectorAll !== "function") { return raus; }
		Array.prototype.forEach.call(wirt.querySelectorAll('input[name="allowed_transport"]'), function (feld) {
			const wert = feld.getAttribute ? String(feld.getAttribute("value") || "") : "";
			const text = feld.parentNode ? String(feld.parentNode.textContent || "").trim() : "";
			if (wert && text) { raus[wert] = text; }
		});
		return raus;
	}

	// REIN: die aktuell gewählten Verkehrsmittel eines Weges. `null` im Zustand heißt
	// „unangetastet" und liefert die Vorauswahl der Wegart -- dieselbe Liste, die der Server
	// wählt, wenn nichts mitgeschickt wird. Siehe garetienEingabenGrundwerte.
	function garetienWegTransporteZu(objekt, subtyp) {
		// 🔴 EIN BACH IST NICHT BEFAHRBAR -- und zwar unabhaengig davon, was jemand angehakt hat.
		// Der Server nimmt ihm jedes Verkehrsmittel (avesmapsPathTransportRegel); zeigte der Kasten
		// hier trotzdem die zwei Fluss-Verkehrsmittel an, behauptete er das Gegenteil dessen, was
		// gleich gespeichert wird. Genau diese Falschaussage ueber die naechste Handlung ist der
		// Grund, warum es dieses Fenster gibt.
		if (objekt && objekt.is_bach === true) { return []; }
		const eingaben = garetienEingabenZustandZu(objekt);
		if (eingaben.transports !== null) { return eingaben.transports; }
		return (typeof getDefaultAllowedTransportsForPathSubtype === "function")
			? getDefaultAllowedTransportsForPathSubtype(subtyp)
			: [];
	}

	// 🔴 SEIT DEM 30.08.2026 EINSTELLBAR (Owner: „dann weg bearbeiten") -- aber NUR die zwei Felder,
	// die avesmapsCreatePathFeature beim Anlegen wirklich aus dem Anfragerumpf liest: `show_label`
	// und `allowed_transports`. Serverseitig nimmt sie avesmapsGaretienWegUebersteuerung entgegen.
	//
	// 🔴 JAHRESZEITEN UND STRÖMUNG BLEIBEN ANZEIGE, und auch das ist die eigentliche Entscheidung:
	// `transport_seasons` steht überhaupt nicht im $properties-Rumpf des Anlegers, und die
	// Flussrichtung hat ihren eigenen Schreibweg im Wege-Editor. Ein Bedienelement darauf wäre
	// eines, das nichts tut -- und sähe wie eine getroffene Entscheidung aus.
	function garetienEingefuegtWirdWegMarkup(objekt, subtyp, deaktiviert) {
		const eingaben = garetienEingabenZustandZu(objekt);
		const angeboten = (typeof getTransportOptionsForPathSubtype === "function")
			? getTransportOptionsForPathSubtype(subtyp)
			: null;
		let markup = garetienEingefuegtWirdUeberschrift("Weg")
			+ garetienEingefuegtWirdHakenZeile(objekt, "Weg anzeigen (Name auf der Karte)",
				"showLabel", eingaben.showLabel, deaktiviert)
			+ garetienEingefuegtWirdZeileMitHinweis("Jahreszeiten (Gangbarkeit)", "ganzjährig",
				"keine saisonale Einschränkung — der Anleger liest transport_seasons gar nicht, "
				+ "das setzt der Wege-Editor");
		const istBach = Boolean(objekt && objekt.is_bach === true);
		if (angeboten !== null && angeboten.length) {
			const gewaehlt = garetienWegTransporteZu(objekt, subtyp);
			const namen = garetienVerkehrsmittelNamen();
			markup += '<p class="gi-insert__row gi-insert__row--kopf">Verkehrsmittel'
				+ ' <span class="gi-insert__hint">— wirkt auf die Routenplanung</span></p>';
			angeboten.forEach(function (schluessel) {
				const id = garetienEingabeId(objekt, "vm-" + schluessel);
				markup += '<p class="gi-insert__row gi-insert__row--edit"><label for="' + id + '">'
					+ '<input type="checkbox" id="' + id + '" data-gi-feld="transports" '
					+ 'data-gi-transport="' + avesmapsGaretienEscape(schluessel) + '"'
					+ (gewaehlt.indexOf(schluessel) !== -1 ? " checked" : "")
					// ⚠️ Bei einem Bach bleiben die Zeilen SICHTBAR, aber gesperrt -- dieselbe Wahl
					// wie im echten Dialog "Weg bearbeiten". Sie zu verstecken saehe aus wie "diese
					// Wegart kennt keine Verkehrsmittel"; sichtbar und grau sagt, was gilt: es gaebe
					// welche, und das Haekchen nimmt sie weg.
					+ (deaktiviert || istBach ? " disabled" : "") + "> "
					+ avesmapsGaretienEscape(namen[schluessel] || schluessel) + "</label></p>";
			});
			// 🔴 Eine leere Auswahl ist ERLAUBT (avesmapsReadAllowedTransports nimmt `[]` an und
			// speichert es -- der echte Dialog lässt dasselbe zu), aber sie darf nicht still
			// passieren: ein Weg, den kein Verkehrsmittel befahren darf, ist eine Kante, die im
			// Routing niemand benutzen kann.
			// 🔴 ZWEI VERSCHIEDENE AUSSAGEN, und sie duerfen nicht denselben Kasten teilen: bei
			// einem Bach ist die leere Auswahl die REGEL (nichts ist schiefgegangen), sonst eine
			// Entscheidung mit Folgen. Ein Warnkasten am Bach liesse einen Editor nach einem Fehler
			// suchen, den es nicht gibt.
			if (istBach) {
				markup += '<p class="gi-insert__row"><span class="gi-insert__hint">Ein Bach ist '
					+ "nicht befahrbar — er wird gezeichnet und zählt im Gelände, aber keine Route "
					+ "führt auf ihm entlang.</span></p>";
			} else if (!gewaehlt.length) {
				markup += '<p class="gi-bomb">Ohne Häkchen darf hier <b>kein Verkehrsmittel</b> '
					+ "fahren — der Weg wird gezeichnet, aber keine Route führt über ihn.</p>";
			}
		}
		if (subtyp === "Flussweg") {
			markup += garetienEingefuegtWirdZeileMitHinweis("Strömung (Flussrichtung)", "unbekannt",
				"wirkt auf die Reisezeit (flussauf-/-abwärts) — hat einen eigenen Schreibweg und "
				+ "wird im Wege-Editor unter „Flussrichtung unbekannt\" festgelegt");
		}
		return markup;
	}

	function garetienWikiLandschaftPlatzhalterId(objekt) {
		return "gi-wiki-landschaft-" + avesmapsGaretienEscape(String((objekt && objekt.key) || ""));
	}

	// REIN: die Anzeigezeile aus der Server-Antwort (Aktion 'wiki_landschaft',
	// avesmapsGaretienWikiLandschaftVorschlag in api/_internal/import/garetien-wiki-landschaft.php).
	// 🔴 Das Urteil selbst wird HIER NICHT gerechnet -- der Server fragt dieselbe Faltung und
	// dieselbe Art-Tabelle wie der Rest des Hauses (avesmapsWikiSyncCreateMatchKey,
	// avesmapsWikiRegionArtToSubtype); eine zweite, ungenauere Fassung im Browser wäre die zweite
	// Wahrheit, vor der AGENTS.md §5 warnt.
	function garetienWikiLandschaftZeileText(urteil) {
		const u = urteil || {};
		const name = String(u.name || "").trim();
		const art = String(u.art || "").trim();
		if (name === "") {
			return u.status === "mehrdeutig"
				? "mehrere gleichnamige Wiki-Artikel — keine sichere Zuordnung"
				: "kein automatischer Treffer nach Namen";
		}
		const kennung = "„" + name + "\"" + (art === "" ? "" : " (" + art + ")");
		// Owner-Wortlaut: „wenn name und typ passen, passts, wenn name passt aber typ nicht
		// gefunden -> ausrufezeichen".
		return u.status === "passt" ? kennung + " — Name und Art passen" : "! " + kennung + " — Art passt nicht";
	}

	// Welches Objekt zuletzt gefragt wurde -- EIN Aufruf je Objektwechsel, kein Massenlauf. Ein
	// erneutes Rendern DESSELBEN Objekts (z. B. nach einem Listen-Refetch) löst keine zweite
	// Anfrage aus.
	let _garetienWikiLandschaftLetzterKey = null;

	// ---- KORREKTUR B (Owner-Nachtrag 30.08.2026, wörtlich: „kein automatischer Treffer nach
	// Namen -> TROTZDEM WILL ICH DIE WIKI-SYNC SUCHE!"). Ein Objekt ohne automatischen Treffer ist
	// GENAU der Fall, in dem ein Mensch suchen will -- die bisherige Zeile war eine Sackgasse.
	//
	// 🔴 ZWEI GEPRÜFTE UND VERWORFENE WEGE, BEIDE AN EINER ECHTEN, GEMESSENEN SCHRANKE GESCHEITERT:
	// (a) `avesmapsWikiAssignMount` (js/ui/wiki-assign.js), Erklärung „landschaft" bzw.
	//     „landschaftslabel" aus dem Feldregister (AGENTS.md §11, „Die Wiki-Zuweisung"). Die
	//     Prüfung im Ordner js/ui/__tests__ zur geteilten Merkliste verlangt von JEDER Datei, die
	//     eine dieser Erklärungen mit einem Kartenziel mountet, eine gefüllte UND ausgelieferte
	//     Herkunfts-Meldung an den Server -- diese Regel existiert, weil eine vergessene Meldung
	//     den nächsten Wiki-Abgleich echte Handarbeit überschreiben lässt (AGENTS.md §9/§11). Ein
	//     Garetien-Vorschlag hat aber noch KEINE `public_id` -- es gibt nichts, das „von uns" oder
	//     „vom Wiki" sein könnte, bevor „Neu einfügen" gedrückt wurde. Sie ehrlich zu erfüllen
	//     bräuchte eine neue Schreibstrecke UND die Owner-Entscheidung „wessen Name/Art gewinnt,
	//     wenn Garetien und Wiki sich widersprechen" -- ein neuer Schalter, den sich diese
	//     Korrektur nicht selbst geben darf (AGENTS.md §9 „Editor bekommt zwei Schalter, nicht die
	//     Werkstatt"). Siehe der Bericht dieser Aufgabe.
	// (b) eine eigene, freie Suche gegen `/api/edit/wiki/regions.php?action=search` mit einem
	//     eigenen `fetch(`-Aufruf. Diese DATEI prüft repoweit
	//     (garetien-filtertrichter.test.js), dass sie GENAU EINEN `fetch(`-Aufruf enthält --
	//     `avesmapsGaretienRufe` -- weil ein zweiter Netzweg an ihr vorbei genau die Divergenz
	//     wäre, die diese Zusicherung verhindern soll.
	//
	// ⭐ STATTDESSEN: DIESELBE Server-Aktion, die die automatische Zeile daneben schon befragt
	// (`wiki_landschaft`, avesmapsGaretienWikiLandschaftVorschlag) -- aber mit einem NAMEN, den
	// der Editor selbst einträgt, statt dem Namen des Vorschlags. Sie geht durch DIESELBE
	// `avesmapsGaretienRufe`, denselben Endpunkt und dieselbe Textbildung
	// (`garetienWikiLandschaftZeileText`) wie die automatische Zeile -- kein zweiter Netzweg,
	// keine zweite Formulierung, keine Behauptung, hier würde irgendetwas zugewiesen (die
	// automatische Zeile war schon rein informativ: avesmapsGaretienFlaecheAnlegen schickt nie
	// ein wiki_url mit).
	//
	// ⚠️ NUR FÜR `ziel==='region'` -- dieselbe Einschränkung wie bei der automatischen Zeile
	// daneben (ein Berggipfel bekommt „Wiki-Landschaft" schon heute nicht, siehe
	// garetien-eingefuegt-wird.test.js Abschnitt D).

	// Der Stand je geöffnetem Objekt (Schlüssel) -- der zuletzt versuchte Name und sein Ergebnis.
	// 🔴 ÖRTLICH, NICHT GESCHRIEBEN: ein Versuch ist eine Notiz für den Editor, keine Zuweisung
	// (siehe oben). Er überlebt ein erneutes Zeigen derselben Zeile in dieser Sitzung, ein
	// Fensterschließen/-neuöffnen verwirft ihn -- genau wie die automatische Zeile daneben, die
	// bei jedem Öffnen neu fragt.
	let _garetienWikiSucheZustand = {};

	function garetienWikiSucheHostId(objekt) {
		return "gi-wiki-suche-" + avesmapsGaretienEscape(String((objekt && objekt.key) || ""));
	}

	function garetienWikiSucheZustandZu(objekt) {
		const key = String((objekt && objekt.key) || "");
		if (!_garetienWikiSucheZustand[key]) {
			_garetienWikiSucheZustand[key] = { name: "", laufendeSuche: 0, ergebnis: null, fehler: "" };
		}
		return _garetienWikiSucheZustand[key];
	}

	function garetienWikiSucheMarkup(objekt) {
		const zustand = garetienWikiSucheZustandZu(objekt);
		const ergebnisMarkup = zustand.ergebnis
			? '<p class="gi-why">' + avesmapsGaretienEscape(garetienWikiLandschaftZeileText(zustand.ergebnis)) + "</p>"
			: (zustand.fehler !== "" ? '<p class="gi-insert__hint">' + avesmapsGaretienEscape(zustand.fehler) + "</p>" : "");
		return '<p class="gi-insert__hint">Ein abweichender Name kann trotzdem im Wiki stehen -- '
			+ "hier lässt sich das mit einem anderen Namen prüfen (dieselbe Suche, ein anderer Name).</p>"
			+ '<p class="gi-insert__row"><input type="search" class="gi-search" data-gws-suche '
			+ 'placeholder="Anderen Namen im Wiki suchen …" value="' + avesmapsGaretienEscape(zustand.name) + '">'
			+ ' <button type="button" class="btn" data-gws-suchen>Suchen</button></p>'
			+ ergebnisMarkup;
	}

	function garetienWikiSucheZeichnen(host, objekt) {
		host.innerHTML = garetienWikiSucheMarkup(objekt);
	}

	/**
	 * Fragt `wiki_landschaft` mit dem vom Editor eingetragenen Namen -- dieselbe Aktion, derselbe
	 * Netzweg (`avesmapsGaretienRufe`) wie die automatische Zeile, nur mit einem anderen Namen im
	 * Rumpf. ⚠️ WIRFT/LEHNT AB statt still ein leeres Ergebnis zu zeigen: ein Fehlschlag muss sich
	 * von „kein Treffer" unterscheiden (dieselbe Lehre wie am automatischen Aufruf daneben).
	 */
	function garetienWikiSucheAusfuehren(host, objekt, name) {
		const zustand = garetienWikiSucheZustandZu(objekt);
		zustand.name = name;
		const meine = ++zustand.laufendeSuche;
		avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "wiki_landschaft",
			name: name,
			subtyp: String((objekt && objekt.subtyp) || ""),
		}).then(function (antwort) {
			if (meine !== zustand.laufendeSuche) { return; }
			zustand.ergebnis = antwort.wiki_landschaft || null;
			zustand.fehler = "";
			garetienWikiSucheZeichnen(host, objekt);
		}, function (fehler) {
			if (meine !== zustand.laufendeSuche) { return; }
			zustand.ergebnis = null;
			zustand.fehler = "Suche fehlgeschlagen: " + String((fehler && fehler.message) || "Unbekannter Fehler.");
			garetienWikiSucheZeichnen(host, objekt);
		});
	}

	function garetienWikiSucheEinrichten(host, objekt) {
		host.addEventListener("input", function (ereignis) {
			const ziel = ereignis && ereignis.target;
			if (!ziel || !ziel.hasAttribute || !ziel.hasAttribute("data-gws-suche")) { return; }
			garetienWikiSucheZustandZu(objekt).name = ziel.value || "";
		});
		host.addEventListener("keydown", function (ereignis) {
			const ziel = ereignis && ereignis.target;
			if (!ziel || !ziel.hasAttribute || !ziel.hasAttribute("data-gws-suche")) { return; }
			if (ereignis.key === "Enter") {
				if (typeof ereignis.preventDefault === "function") { ereignis.preventDefault(); }
				garetienWikiSucheAusfuehren(host, objekt, garetienWikiSucheZustandZu(objekt).name);
			}
		});
		host.addEventListener("click", function (ereignis) {
			const ziel = ereignis && ereignis.target;
			if (!ziel || typeof ziel.closest !== "function") { return; }
			const knopf = ziel.closest("[data-gws-suchen]");
			if (knopf && host.contains(knopf)) {
				garetienWikiSucheAusfuehren(host, objekt, garetienWikiSucheZustandZu(objekt).name);
			}
		});
	}

	/**
	 * Zeigt die manuelle Suche NUR, wenn der automatische Treffer leer blieb (`kein_treffer`,
	 * `mehrdeutig`) ODER die automatische Suche selbst fehlschlug -- aus Sicht des Editors ist ein
	 * Fehlschlag ebenso „kein Treffer", und genau dann will er suchen können.
	 */
	function garetienWikiSucheBeiBedarfZeigen(objekt, status) {
		if (!hasDocument) { return; }
		const host = document.getElementById(garetienWikiSucheHostId(objekt));
		if (!host) { return; }
		if (status !== "kein_treffer" && status !== "mehrdeutig") {
			host.hidden = true;
			return;
		}
		host.hidden = false;
		garetienWikiSucheEinrichten(host, objekt);
		garetienWikiSucheZeichnen(host, objekt);
	}

	// Sucht bei Bedarf die Wiki-Landschaft für das GERADE GEÖFFNETE Objekt und trägt das Ergebnis
	// in den Platzhalter ein -- über denselben Sender wie jeder andere Aufruf dieser Datei
	// (avesmapsGaretienRufe, GARETIEN_ENDPUNKT) und dieselbe `.php`-Adresse, kein zweiter fetch(.
	function garetienWikiLandschaftBeiBedarfLaden(objekt) {
		if (!objekt) { _garetienWikiLandschaftLetzterKey = null; return; }
		const schluessel = String(objekt.key || "");
		if (schluessel === _garetienWikiLandschaftLetzterKey) { return; }
		_garetienWikiLandschaftLetzterKey = schluessel;
		if (!hasDocument || typeof fetch !== "function") { return; }
		avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "wiki_landschaft",
			name: String(objekt.name || ""),
			subtyp: String(objekt.subtyp || ""),
		}).then(function (antwort) {
			if (zustand.detailKey !== schluessel) { return; }
			const urteil = antwort.wiki_landschaft || {};
			const feld = document.getElementById(garetienWikiLandschaftPlatzhalterId(objekt));
			if (feld) { feld.textContent = garetienWikiLandschaftZeileText(urteil); }
			garetienWikiSucheBeiBedarfZeigen(objekt, String(urteil.status || ""));
		}).catch(function () {
			if (zustand.detailKey !== schluessel) { return; }
			const feld = document.getElementById(garetienWikiLandschaftPlatzhalterId(objekt));
			if (feld) { feld.textContent = "Suche fehlgeschlagen."; }
			garetienWikiSucheBeiBedarfZeigen(objekt, "kein_treffer");
		});
	}

	// REIN: der ganze Kasten. „Was mich beim Import erwartet" (Owner) -- nur wo tatsächlich etwas
	// eingefügt würde (garetienEingefuegtWirdHatVorschlag); eine Überschrift über nichts ist keine
	// Auskunft, dieselbe Regel wie bei garetienQuellenMarkup.
	// 🔴 „Die Quelle, die mitreist" zieht HIERHER, in „Wiki und Quellen" -- die leere Fläche
	// darunter war der vom Owner benannte Platz für diesen Kasten, und dieselbe Angabe zweimal
	// auf dem Bildschirm wäre die Duplikation, vor der AGENTS.md §5 warnt.
	// REIN: der Hinweis fuer ein bereits UEBERNOMMENES Objekt (Fuenf-Punkte-Brief 30.08.2026, Punkt
	// 6b) -- ob es sich zuruecknehmen laesst, und wenn nicht, warum. ⭐ Liest DIESELBE Regel wie der
	// Ruecknahme-Knopf am Fuss der Ansicht (garetienRuecknahmeBauen), formuliert sie nicht neu:
	// zwei Fassungen derselben Auskunft laufen auseinander, und genau das hat dieses Fenster laut
	// Auftrag schon mehrfach bezahlt.
	function garetienEingefuegtWirdUebernommenHinweis(objekt) {
		if (String((objekt && objekt.stand) || "") !== "uebernommen") { return ""; }
		const ruecknahme = garetienRuecknahmeBauen(objekt);
		const zusatz = ruecknahme.disabled
			? ruecknahme.grund
			: 'Kann mit „Zurücknehmen" wieder entfernt werden.';
		return '<p class="gi-why">Liegt bereits auf der Karte. ' + avesmapsGaretienEscape(zusatz) + "</p>";
	}

	/* =============================================================================================
	 * DIE ZIELWAHL -- zwei Auswahlfelder statt einer festen Zuordnung
	 * =============================================================================================
	 * Owner 01.09.2026: „die editoren wollen dass man bestimmen kann, welchen typ das ziel haben
	 * soll … auch von fläche auf berg … er soll den vorschlag nehmen, den er gerade hat, aber
	 * mann will auch ändern können." Dazu: „alle orte und weg-typen mit rein" und „bei Flächen, die
	 * sehr klein sind … sollen automatisch schon als Berge vorausgewählt werden".
	 *
	 * 🔴 ZWEI FELDER, NICHT EINE LISTE MIT 50 EINTRÄGEN. Die FORM (Fläche · freies Label ·
	 * Ort · Weg) entscheidet, WAS gebaut wird; die ART, als was. Ein Wechsel innerhalb einer Form
	 * ist ein Namenswechsel, ein Wechsel der Form ändert die Gestalt des Objekts -- in einer
	 * flachen Liste wäre genau diese Grenze unsichtbar.
	 */
	const AVESMAPS_GARETIEN_FORMEN = [
		{ key: "region", label: "Fläche", mindestPunkte: 3 },
		{ key: "label", label: "Freies Label", mindestPunkte: 1 },
		{ key: "location", label: "Ort", mindestPunkte: 1 },
		{ key: "path", label: "Weg", mindestPunkte: 2 },
	];

	// 🔴 DIE GEOMETRIE ENTSCHEIDET, WELCHE FORM ÜBERHAUPT ANGEBOTEN WIRD -- dieselbe Regel wie
	// avesmapsGaretienMoeglicheZiele auf dem Server, und sie steht dort wie hier, weil beide sie
	// brauchen: der Server lehnt ab, das Fenster bietet gar nicht erst an. ⚠️ Der SERVER ist die
	// Wahrheit; diese Liste erspart dem Editor nur eine Fehlermeldung.
	function garetienMoeglicheFormen(objekt) {
		const punkte = ((objekt && objekt.geometrie) || []).length;
		return AVESMAPS_GARETIEN_FORMEN.filter(function (form) {
			return punkte >= form.mindestPunkte;
		});
	}

	// REIN: die Fläche eines Rings in Quadratmeilen. 1 Karteneinheit = 3 Meilen, also 9 Meilen² je
	// Einheit² (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT).
	function garetienFlaecheMeilen2(punkte) {
		const p = punkte || [];
		if (p.length < 3) { return 0; }
		let summe = 0;
		for (let i = 0; i < p.length; i++) {
			const a = p[i];
			const b = p[(i + 1) % p.length];
			if (!a || !b) { return 0; }
			summe += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
		}
		return Math.abs(summe) / 2 * 9;
	}

	/*
	 * Die Vorbelegung der zwei Felder: der Vorschlag -- außer eine sehr kleine Bergfläche.
	 *
	 * 🔴 DIE REGEL GILT NUR DER BERGFAMILIE, und das ist gemessen, nicht gewählt. Über alle 18
	 * Ebenen: „klein" trennt nicht Berg von Fläche, sondern SEEN von allem anderen -- 59 von 96
	 * Seen liegen unter 5 Meilen², während der Median der `Berg`-Zeilen bei 136 Meilen² liegt.
	 * Eine globale Größenschwelle machte also die Mehrheit der Seen zu Beschriftungen und ließe
	 * die Hälfte der Berge trotzdem Fläche. Auf Gebirge und Hügel beschränkt trifft sie 8 Zeilen.
	 * ⚠️ `Berg` steht NICHT in der Liste: diese Zeilen werden ohnehin zu Gipfeln, unabhängig von
	 * ihrer Größe.
	 */
	const AVESMAPS_GARETIEN_BERGFAMILIE = ["Gebirge", "Huegel"];
	const AVESMAPS_GARETIEN_BERG_SCHWELLE_MEILEN2 = 5;

	function garetienZielVorbelegung(objekt) {
		const o = objekt || {};
		const vorschlag = {
			ziel: String(o.ziel || ""),
			subtyp: String(o.subtyp || ""),
			kind: String(o.kind || ""),
		};
		if (vorschlag.ziel !== "region") { return vorschlag; }
		if (AVESMAPS_GARETIEN_BERGFAMILIE.indexOf(String(o.typ || "")) === -1) { return vorschlag; }
		// 💣 EINE FEHLENDE GEOMETRIE IST NICHT „KLEIN". `garetienFlaecheMeilen2` liefert 0, wenn
		// keine oder weniger als drei Punkte da sind -- 0 heisst UNBEKANNT, nicht winzig. Ohne
		// diesen Riegel schlug die Regel bei jedem Objekt ohne mitgereiste Geometrie zu und machte
		// aus einem Hügelland stillschweigend einen Berggipfel. Gefangen hat das der bestehende
		// Test der Kopfzeile, nicht eine neue Zeile.
		const flaeche = garetienFlaecheMeilen2(o.geometrie);
		if (flaeche <= 0 || flaeche >= AVESMAPS_GARETIEN_BERG_SCHWELLE_MEILEN2) {
			return vorschlag;
		}
		return { ziel: "label", subtyp: "berggipfel", kind: "" };
	}

	// 💣 DER ZUSTAND LIEGT NEBEN DEM DOM, wie bei den übrigen Feldern des Kastens: die Detailspalte
	// wird bei jedem Listen-Refetch neu gebaut, eine Wahl am `<select>` wäre dabei verloren.
	let _garetienZielWahl = {};

	function garetienZielWahlZu(objekt) {
		const key = String((objekt && objekt.key) || "");
		// 💣 OHNE SCHLUESSEL WIRD NICHT ZWISCHENGESPEICHERT. Sonst teilten sich ALLE schluessellosen
		// Objekte den Eintrag unter "" -- die Wahl des ersten gaelte fuer jedes weitere. Das trifft
		// nicht nur Testattrappen: `garetienTypText` wird auch mit blossen {typ, subtyp}-Objekten
		// gerufen, und dann stuende im Kopf die Art eines ganz anderen Objekts.
		if (key === "") { return garetienZielVorbelegung(objekt); }
		if (!_garetienZielWahl[key]) {
			_garetienZielWahl[key] = garetienZielVorbelegung(objekt);
		}
		return _garetienZielWahl[key];
	}

	function garetienZielWahlVergessen() { _garetienZielWahl = {}; }

	// Das Flächen-Vokabular aus der Listenantwort (garetien-liste.php) -- 29 Arten, EINMAL je Abruf.
	function garetienFlaechenVokabular() {
		const antwort = zustand && zustand.letzteAntwort;
		return (antwort && Array.isArray(antwort.flaechen_arten)) ? antwort.flaechen_arten : [];
	}

	/*
	 * Die Arten EINER Form. 🔴 VIER VORHANDENE QUELLEN, KEIN NEUES VOKABULAR -- dasselbe, aus dem
	 * `garetienUnserBeschriftung` schon heute den angezeigten Namen holt.
	 *
	 * ⭐ Die FREIEN Label sind eine DIFFERENZ, keine gepflegte Liste: was eine Label-Art ist, aber
	 * keine Flächenart, ist ein freies Label. Eine handgeschriebene Aufzählung liefe beim nächsten
	 * neuen Typ auseinander -- genau das ist der Kartensuche passiert, die bis heute 18 Arten nicht
	 * kennt.
	 */
	function garetienArtenFuerForm(form) {
		if (form === "region") {
			return garetienFlaechenVokabular().map(function (art) {
				return { key: String(art.type_key || ""), label: String(art.label || art.type_key || ""),
					kind: String(art.kind || "") };
			});
		}
		if (form === "label") {
			const flaechen = {};
			garetienFlaechenVokabular().forEach(function (art) { flaechen[String(art.type_key || "")] = true; });
			const namen = (typeof AVESMAPS_LABEL_ART_NAMEN !== "undefined") ? AVESMAPS_LABEL_ART_NAMEN : {};
			return Object.keys(namen).filter(function (key) { return !flaechen[key]; })
				.map(function (key) { return { key: key, label: String(namen[key] || key), kind: "" }; });
		}
		if (form === "location") {
			const ordnung = (typeof LOCATION_TYPE_VISIBILITY_ORDER !== "undefined")
				? LOCATION_TYPE_VISIBILITY_ORDER : [];
			return ordnung.map(function (key) {
				const eintrag = (typeof LOCATION_TYPE_CONFIG !== "undefined") ? LOCATION_TYPE_CONFIG[key] : null;
				return { key: key, label: (eintrag && eintrag.singularLabel) || key, kind: "" };
			});
		}
		if (form === "path") {
			const keys = (typeof PATH_SUBTYPE_KEYS !== "undefined") ? PATH_SUBTYPE_KEYS : [];
			return keys.map(function (key) {
				const label = (typeof getPathTypeLabel === "function") ? getPathTypeLabel(key) : key;
				return { key: key, label: String(label || key), kind: "" };
			});
		}
		return [];
	}

	// REIN: die zwei Auswahlfelder. `deaktiviert` sperrt sie an einem bereits übernommenen Objekt --
	// dieselbe Regel wie für jedes andere Feld dieses Kastens (Owner 30.08.2026, Punkt 6a).
	function garetienZielWahlMarkup(objekt, deaktiviert) {
		const wahl = garetienZielWahlZu(objekt);
		const formen = garetienMoeglicheFormen(objekt);
		// ⚠️ Eine Form, die die Geometrie nicht hergibt, steht nicht in der Liste -- die gewählte
		// aber immer, sonst zeigte das Feld etwas anderes an als das, was gilt.
		const formListe = formen.some(function (f) { return f.key === wahl.ziel; })
			? formen
			: formen.concat([{ key: wahl.ziel, label: wahl.ziel }]);
		const arten = garetienArtenFuerForm(wahl.ziel);
		const artListe = arten.some(function (a) { return a.key === wahl.subtyp; })
			? arten
			: arten.concat([{ key: wahl.subtyp, label: wahl.subtyp, kind: wahl.kind }]);
		const gesperrt = deaktiviert ? " disabled" : "";
		const bauen = function (feld, liste, gewaehlt) {
			return '<select class="gi-insert__select" data-gi-feld="' + feld + '"'
				+ ' id="' + garetienEingabeId(objekt, feld) + '"' + gesperrt + ">"
				+ liste.map(function (e) {
					return '<option value="' + avesmapsGaretienEscape(e.key) + '"'
						+ (e.key === gewaehlt ? " selected" : "") + ">"
						+ avesmapsGaretienEscape(e.label) + "</option>";
				}).join("") + "</select>";
		};
		return '<p class="gi-insert__row">Form <span class="gi-insert__val">'
			+ bauen("zielForm", formListe, wahl.ziel) + "</span></p>"
			+ '<p class="gi-insert__row">Art <span class="gi-insert__val">'
			+ bauen("zielArt", artListe, wahl.subtyp) + "</span></p>";
	}

	function garetienEingefuegtWirdMarkup(objekt) {
		if (!objekt || !garetienEingefuegtWirdHatVorschlag(objekt)) { return ""; }
		// 🔴 SEIT 01.09.2026 ENTSCHEIDET DIE WAHL, NICHT DER VORSCHLAG. `garetienZielWahlZu` liefert
		// den Vorschlag, solange niemand etwas anderes gewählt hat -- der Kasten darunter zeigt
		// deshalb die Felder der GEWÄHLTEN Form (eine Fläche hat andere als ein Gipfel).
		const wahl = garetienZielWahlZu(objekt);
		const ziel = String(wahl.ziel || "");
		const subtyp = String(wahl.subtyp || "");
		// 🔴 Punkt 6a: ein bereits UEBERNOMMENES Objekt ist angelegt -- hier gibt es nichts mehr zu
		// entscheiden, und die Felder werden reine Anzeige (Owner: „die editoren sollen dann das
		// objekt auf der karte editieren").
		const uebernommen = String(objekt.stand || "") === "uebernommen";
		let markup = '<p class="gi-sec">Eingefügt wird</p>'
			+ '<p class="gi-why gi-insert__kopf">' + avesmapsGaretienEscape(garetienTypText(objekt)) + "</p>"
			+ garetienEingefuegtWirdUebernommenHinweis(objekt)
			+ garetienZielWahlMarkup(objekt, uebernommen);
		if (ziel === "region") {
			markup += garetienEingefuegtWirdFlaecheMarkup(objekt, uebernommen);
			markup += garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, true, uebernommen);
		} else if (ziel === "label") {
			markup += garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, false, uebernommen);
		} else if (ziel === "location") {
			markup += garetienEingefuegtWirdOrtMarkup(objekt, subtyp, uebernommen);
		} else if (ziel === "path") {
			markup += garetienEingefuegtWirdWegMarkup(objekt, subtyp, uebernommen);
		}
		markup += garetienEingefuegtWirdUeberschrift("Wiki und Quellen");
		markup += garetienQuellenMarkup(objekt);
		if (ziel === "region") {
			markup += '<p class="gi-insert__row" id="' + garetienWikiLandschaftPlatzhalterId(objekt) + '">'
				+ 'Wiki-Landschaft <span class="gi-insert__val">wird gesucht …</span></p>'
				// KORREKTUR B: die manuelle Suche -- verborgen, bis der automatische Treffer oben als
				// leer/mehrdeutig/fehlgeschlagen feststeht (garetienWikiSucheBeiBedarfZeigen).
				+ '<div id="' + garetienWikiSucheHostId(objekt) + '" hidden></div>';
		}
		return '<div class="gi-insert">' + markup + "</div>";
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
	 *
	 * 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 5: der sichtbare Grund WIEDERHOLT nur, was der
	 * Abschnitt darunter („Was bei uns an derselben Stelle liegt … Zu diesem Objekt steht kein
	 * Abschnitt von uns im Vorschlag.") schon sagt, wenn dieses Objekt GAR KEINE Abschnitte hat --
	 * `abschnitteLeer` unterdrückt ihn dann. Er bleibt stehen, wenn Abschnitte EXISTIEREN, aber
	 * keiner angehakt ist (`avesmapsGaretienUnsereIds` zählt nur ANGEHAKTE Items, nicht alle
	 * getroffenen) -- dort erklärt NUR er, warum der Knopf trotzdem grau ist; der Abschnitt darunter
	 * zeigt in diesem Fall echte Zeilen und sagt nichts über die Karten-Sperre.
	 */
	function garetienSichtLeisteMarkup(sicht, unsereVorhanden, abschnitteLeer) {
		const s = sicht || {};
		const unsereGesperrt = unsereVorhanden === false;
		const grundMarkup = (unsereGesperrt && abschnitteLeer !== true)
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

	// ---- Owner-Auftrag A (30.08.2026): „Imports in der Nähe anzeigen" ------------------------------
	//
	// 🔴 Der Knopf hieß bis zum 30.08.2026 „… markieren", und der Name war eine Lüge: der Klick
	// markiert NICHT nur, er legt die Treffer im selben Zug in die Anzeige (`garetienNaeheKlick`
	// ruft beides). Möglich wurde das, weil die Serverantwort die ganzen Objekte ohnehin mitbringt —
	// damit fällt die 500er-Grenze der geladenen Liste wirklich weg, statt nur benannt zu werden.
	// Owner dazu: „Du hast dich natürlich nicht daran gehalten nur zu markieren, sondern hast es
	// gleich auf anzeigen getan, aber das is in ordnung." Die Beschriftung nennt jetzt die SICHTBARE
	// Wirkung — dieselbe Lehre wie beim Knopf „✦ Zentrieren" ein Stück weiter unten, dessen Name
	// ebenfalls stehen blieb, nachdem sich seine Wirkung verschoben hatte.
	// ⚠️ Gewandert ist die BESCHRIFTUNG, nicht die Kennungen: `data-naehe`, `garetienNaeheKlick`,
	// `avesmapsGaretienNaehe` und `garetien-naehe-markieren.test.js` heißen weiter wie vorher —
	// dieselbe Trennung wie bei „Neuigkeiten"/`changelog` (AGENTS.md §11).
	//
	// Owner, wörtlich: „Im groben umkreis um ein objekt herum (5 karteneinheiten von zentrum,
	// entferntesten flächepunkt entfernt) sollen weitere objekte aus dem import markiert werden
	// können." Die Zahl selbst kommt vom SERVER (avesmapsGaretienNaehe,
	// api/_internal/import/garetien-liste.php) -- sie sucht über den GANZEN Lauf, eine Liste von
	// geladenen Zeilen fände nur, was gerade sichtbar ist, und der Knopf verspräche
	// dann eine Zahl, die von der Ansicht statt von der Karte abhängt.

	// REIN: Beschriftung + Sperre, aus der schon vom Server gelieferten Trefferliste.
	function garetienNaeheKnopfZustand(gefunden) {
		const anzahl = Array.isArray(gefunden) ? gefunden.length : 0;
		return {
			anzahl: anzahl,
			beschriftung: "Imports in der Nähe anzeigen (" + anzahl + ")",
			gesperrt: anzahl === 0,
			hinweis: anzahl === 0 ? "Kein weiteres Import-Objekt im Umkreis gefunden." : "",
		};
	}

	// Modulzustand: EIN Abruf je geöffneter Zeile (dieselbe Wache wie bei der Wiki-Landschaft-Suche,
	// `_garetienWikiLandschaftLetzterKey`). `_garetienNaeheGefunden` bleibt `null`, solange die
	// Antwort noch nicht da ist -- so unterscheidet `garetienNaeheMarkup` "wird noch gesucht" von
	// "gesucht, nichts gefunden" (leere Liste). ⚠️ Anders als der Wiki-Landschaft-Platzhalter MUSS
	// diese Markup-Funktion den geladenen Stand zeigen, nicht nur beim ersten Rendern: der Klick auf
	// diesen Knopf selbst löst `garetienAnzeigeNeuZeichnen()` aus, und `garetienDetailRendern` baut
	// dieselbe Spalte danach sofort neu -- eine Funktion, die immer nur den Platzhalter zöge, ließe
	// den gerade benutzten Knopf im selben Klick wieder auf "wird ermittelt" zurückfallen.
	let _garetienNaeheLetzterKey = null;
	let _garetienNaeheGefunden = null;

	// REIN: das Markup, aus dem schon geladenen (oder noch fehlenden) Stand für GENAU dieses Objekt.
	// 🔴 Erscheint nur, wo es überhaupt einen Mittelpunkt gibt -- dieselbe Bedingung wie beim Knopf
	// „✦ Zentrieren" darüber: ohne eigene Geometrie kein Umkreis, kein Knopf, der nichts täte.
	function garetienNaeheMarkup(objekt) {
		if (!objekt || !Array.isArray(objekt.geometrie) || objekt.geometrie.length === 0) { return ""; }
		const schluessel = String(objekt.key || "");
		const geladen = schluessel === _garetienNaeheLetzterKey ? _garetienNaeheGefunden : null;
		if (geladen === null) {
			return '<div class="gi-naehe"><button class="btn" type="button" id="garetien-naehe-btn" '
				+ "data-naehe disabled>Wird ermittelt …</button></div>";
		}
		const stand = garetienNaeheKnopfZustand(geladen);
		const hinweisMarkup = stand.hinweis === "" ? ""
			: '<span class="gi-foot__hint">' + avesmapsGaretienEscape(stand.hinweis) + "</span>";
		return '<div class="gi-naehe"><button class="btn" type="button" id="garetien-naehe-btn" data-naehe'
			+ (stand.gesperrt ? " disabled" : "") + ">" + avesmapsGaretienEscape(stand.beschriftung)
			+ "</button>" + hinweisMarkup + "</div>";
	}

	// Fragt bei Bedarf den Umkreis für das GERADE GEÖFFNETE Objekt ab -- über denselben Sender wie
	// jeder andere Aufruf dieser Datei (avesmapsGaretienRufe, GARETIEN_ENDPUNKT), EIN Abruf je
	// geöffneter Zeile (dieselbe Begründung wie bei der Wiki-Landschaft-Suche).
	function garetienNaeheBeiBedarfLaden(objekt) {
		if (!objekt || !Array.isArray(objekt.geometrie) || objekt.geometrie.length === 0) { return; }
		const schluessel = String(objekt.key || "");
		if (schluessel === _garetienNaeheLetzterKey) { return; }
		_garetienNaeheLetzterKey = schluessel;
		_garetienNaeheGefunden = null;
		if (!hasDocument || typeof fetch !== "function") { return; }
		avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "naehe",
			run_id: zustand.importRunId,
			ziel: schluessel,
		}).then(function (antwort) {
			// ⚠️ Gegen den EIGENEN Schlüssel geprüft, nicht gegen `zustand.detailKey`: nur so verwirft
			// eine überholte Antwort sich selbst, auch wenn der Editor zwischenzeitlich zu einem
			// dritten Objekt und wieder zurück geklickt hat (dieselbe Falle wie bei jeder anderen
			// Wache dieser Datei, die nur den AKTUELLEN Stand prüft).
			if (schluessel !== _garetienNaeheLetzterKey) { return; }
			_garetienNaeheGefunden = Array.isArray(antwort.gefunden) ? antwort.gefunden : [];
			if (zustand.detailKey === schluessel) { garetienDetailRendern(zustand.objekte); }
		}).catch(function () {
			if (schluessel !== _garetienNaeheLetzterKey) { return; }
			_garetienNaeheGefunden = [];
			if (zustand.detailKey === schluessel) { garetienDetailRendern(zustand.objekte); }
		});
	}

	// Der Klick: markiert UND zeigt die gefundenen Nachbarn. 🔴 ZWEI ZÜGE IN EINEM KLICK, ABSICHT --
	// der Server liefert bereits VOLLE Objekte (avesmapsGaretienArbeitslisteObjekte kennt sie
	// ohnehin für den ganzen Lauf), damit schließt sich die Lücke aus dem Auftrag ("markierte
	// Nachbarn, die nicht in der geladenen Liste stehen, lassen sich nicht anzeigen") VOLLSTÄNDIG,
	// statt sie nur zu benennen: ein gefundener Nachbar liegt sofort auf der Karte, unabhängig von
	// den Zeilen der gerade geladenen Seite. „Alle markieren" bleibt davon unberührt
	// -- ihr Vertrag „Markieren ändert nichts" gilt dort, wo `zustand.objekte` ohnehin schon die
	// richtige Antwort ist; hier ist sie es nicht, und der Server hat die richtige Antwort bereits
	// mitgeschickt.
	// 🔴 Der Klick LEERT NICHTS (Auftrag): `avesmapsGaretienAlleMarkieren`/`avesmapsGaretienAnzeige-
	// Hinzufuegen` ERGÄNZEN beide, wie überall in diesem Fenster.
	// 🔴 `eigenes` ist das GEOEFFNETE Objekt, und es geht mit in die Anzeige (Owner 30.08.2026,
	// zusammen mit dem Reiterwechsel unten). Zwei Gruende, und der zweite ist der wichtigere:
	//   · Es liegt ohnehin schon auf der Karte -- `avesmapsGaretienAufDerKarte` haengt die offene
	//     Zeile immer an. Ohne diese Zeile zeigte der Reiter „Anzeigen" 42 Nachbarn, waehrend 43
	//     Objekte gezeichnet sind: er waere nicht mehr die Liste dessen, was auf der Karte liegt,
	//     und genau das ist seine einzige Aufgabe.
	//   · Und die EINZELANSICHT LIEFE SONST LEER. `garetienDetailRendern` sucht `zustand.detailKey`
	//     in der gerade gerenderten Liste; steht das offene Objekt nicht darin, ist `gewaehlt` null
	//     und die rechte Spalte raeumt sich beim Reiterwechsel selbst ab -- gemessen, nicht vermutet.
	// ⚠️ Die ZAHL im Knopf bleibt die der NACHBARN (der Rueckgabewert). Sie beantwortet „wie viele
	// liegen in der Naehe", nicht „wie viele liegen jetzt auf der Karte" -- zwei verschiedene Fragen,
	// und die zweite steht im Reiterkopf.
	// ⚠️ Und es bekommt KEINE Nur-ihre-Marke: das geoeffnete Objekt ist von ihr ohnehin ausgenommen
	// (avesmapsGaretienNurIhreStempeln) -- wer eine Zeile ansieht, will beide Seiten vergleichen.
	function garetienNaeheKlick(ereignis, gefunden, eigenes) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest("[data-naehe]");
		if (!knopf || knopf.disabled) { return null; }
		const liste = Array.isArray(gefunden) ? gefunden : [];
		if (liste.length === 0) { return null; }
		avesmapsGaretienAlleMarkieren(liste);
		avesmapsGaretienAnzeigeHinzufuegen(liste);
		// 🔴 NACH dem Hinzufuegen (Owner 30.08.2026: „der button sollte nur imports nicht unsere
		// eigenen anzeigen"). Die Reihenfolge ist tragend: avesmapsGaretienAnzeigeHinzufuegen
		// LOESCHT die Marke, damit ein gewoehnlicher Weg sie aufhebt -- davor gesetzt waere sie im
		// selben Zug wieder fort.
		avesmapsGaretienNurIhreMerken(liste);
		if (eigenes && eigenes.key !== undefined && eigenes.key !== null) {
			avesmapsGaretienAnzeigeHinzufuegen([eigenes]);
		}
		return liste.length;
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

		// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 4: die Typ-Zuordnung („Fluss (garetien.de) →
		// Flussweg (Avesmaps)") steht seither NICHT mehr im Kopf -- sie steht weiterhin, wortgleich,
		// im Kasten „Eingefügt wird" (garetienEingefuegtWirdMarkup), und dieselbe Angabe zweimal auf
		// dem Bildschirm ist die Duplikation, vor der AGENTS.md §5 warnt. Der Kopf zeigt seither NUR
		// den Namen.
		let kopf = '<div class="gi-detail__head">'
			+ '<h4 class="gi-detail__name">' + avesmapsGaretienEscape(objekt.name || "") + "</h4>"
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
				: unsereVorhanden, abschnitte.length === 0);
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
			+ garetienEingefuegtWirdMarkup(objekt) + "</div>"
			+ garetienHandlungsMarkup(objekt)
			+ garetienNaeheMarkup(objekt);
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
	// 🔴 KEIN ERSETZEN MEHR (Owner 31.08.2026, woertlich: „ich will dass du alle
	// 'ersetzungsfunktionen' des importers augenblicklich deaktivierst. es gibt kein ersetzen. es
	// gibt neu oder nix - kein verändern, kein ersetzen").
	//
	// Gestrichen sind „name" (Namen ersetzen), „quelle" (Nur Quelle + Artikel) und „geometrie"
	// (Ausgewählte Segmente ersetzen) -- alle drei schreiben an einem BESTEHENDEN Objekt.
	// Geblieben sind „neu" und „ablehnen": neu oder nix.
	//
	// ⚠️ DAS HIER IST NUR DIE ANZEIGE. Der verbindliche Riegel steht im Server
	// (AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT, api/_internal/import/garetien-plan.php): der laufende
	// Lauf traegt bereits fertige Ergaenzungs-Items in der Datenbank, und ein Riegel nur im
	// Browser waere keiner.
	//
	// 💣 ANLASS: der Abgleich hatte ihre „Burg Gryffenwacht" mit unserem Dorf „Valpolust"
	// gleichgesetzt (1,90 Einheiten, Schwelle 2,0 = 6 Meilen) und dessen Namen ersetzt.
	// garetien.de fuehrt beide getrennt. Am Bestand gemessen haben 2041 von 2364 Punktobjekten
	// (86,3 %) einen anders benannten Nachbarn innerhalb dieser Schwelle.
	const AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL = {
		neu: ["neu", "ablehnen"],
		// Der Nachbar ist der Hauptfluss, ihr Objekt der Seitenarm: ein NEUES Objekt, kein Ersatz.
		zweifel: ["neu", "ablehnen"],
		// ⚠️ „neu" bleibt und ist der einzige Ausgang: eine Zeile mit erkanntem Treffer laesst
		// sich weiterhin als EIGENES Objekt anlegen (das `zusatz`-Item, garetien-plan.php).
		// 🔴 „Nur Quelle + Artikel" BLEIBT (Owner 31.08.2026: „Garetien.de als 'Quelle und Artikel
		// ergänzen' soll erlaubt sein, aber nicht den namen verändern") -- sie ist additiv,
		// überschreibt nichts und lässt sich exakt zurücknehmen; an ihr hängt die Rechtsfolge.
		ergaenzung: ["quelle", "neu", "ablehnen"],
		// 🔴 „widerspricht" bekommt „neu" (Owner: „widerspricht ist kein grund, dass es nicht
		// trotzdem eingefügt werden darf") -- der Artikel trifft, die Geometrie liegt weit weg.
		// Das ist ein Hinweis für den Editor, kein Verbot.
		widerspruch: ["quelle", "neu", "ablehnen"],
		deckt_sich: ["quelle", "neu", "ablehnen"],
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

	// 💣 „UEBERNOMMEN" HAT ZWEI QUELLEN, UND HIER STAND NUR EINE. `apply_state === "done"`
	// gilt nur fuer den GERADE laufenden Lauf; `applied` ist der dauerhafte Vermerk aus
	// `sync_decision`, der ein „Holen & Rechnen" ueberlebt. Nach einem frischen Lauf stand ein
	// Objekt damit in „Uebernommen" und trug KEINEN einzigen Knopf -- „Zuruecknehmen" und
	// „Ablehnen" scheiterten hier, „Zurueck nach Offen" bedient nur 'changed'-Items.
	// Owner 01.09.2026: „ich seh keine buttons, die so heissen."
	// ⚠️ Der Server kann das seit demselben Tag: die angelegte public_id steht im alten,
	// nur `superseded` gesetzten Lauf und wird von dort geholt (avesmapsGaretienRuecknahmeAusfuehren).
	// Ohne diese Zeile hier waere das gebaut und unerreichbar.
	function garetienRuecknahmeFaehig(item) {
		if (!item) { return false; }
		if (item.apply_state !== "done" && item.applied !== true) { return false; }
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

	// REIN: der ZWEITE Knopf eines uebernommenen Objekts -- „Ablehnen".
	//
	// Owner 31.08.2026: „Ich würde gern neben objekten die 'Übernommen' wurde und die Option
	// 'Zurücknehmen' anbieten auch gleichzeitig die Option 'Ablehnen' anbieten, wo sie
	// zurückgenommen und in die kategorie ablehnen gesteckt werden."
	//
	// 🔴 ER KANN GENAU DANN, WENN „Zurücknehmen" KANN -- und das ist keine Bequemlichkeit,
	// sondern die Sache selbst: abgelehnt werden kann nur, was vorher von der Karte kommt. Ein
	// Objekt, das sich nicht zurücknehmen laesst (es hat ein BESTEHENDES Objekt veraendert), darf
	// auch nicht in „Abgelehnt" wandern -- dort staende dann eine Aenderung, die weiterhin gilt.
	// Deshalb dieselbe Item-Menge, derselbe Riegel, derselbe Grund.
	//
	// ⚠️ DIE BESCHRIFTUNG IST DIE DES OWNERS („Ablehnen"), obwohl der Knopf ZWEI Dinge tut. Die
	// Folge steht dafuer vollstaendig in der Rueckfrage -- dieselbe Aufteilung wie bei
	// „Zurücknehmen" selbst, wo der Wortlaut der Rueckfrage die eigentliche Sicherung ist.
	// 🔴 UND ER ERSCHEINT GAR NICHT ERST, wenn er nicht kann -- kein ausgegrauter Zwilling
	// neben dem Grund. Owner-Entscheid 1 zu „Zurücknehmen" gilt hier unverändert: ein 'changed'-
	// Objekt bekommt „kein Knopf, sondern ein sichtbarer Grund an seiner Stelle". Ein zweiter,
	// gesperrter Knopf hätte diese Regel aufgehoben UND den Grund doppelt hingeschrieben
	// (garetienHandlungsMarkup sammelt ihn je gesperrtem Knopf) -- gemessen beim Bau.
	function garetienRuecknahmeAblehnenBauen(objekt) {
		const items = garetienRuecknahmeItems(objekt);
		if (items.length === 0) { return null; }
		// 💣 DIE ABLEHNUNG BRAUCHT ALLE ITEMS DES OBJEKTS, die Ruecknahme nur die
		// ruecknehmbaren. `avesmapsGaretienListeObjektStand` (garetien-liste.php) erklaert ein
		// Objekt erst dann „abgelehnt", wenn JEDES seiner Items abgelehnt ist -- mit nur den
		// zurueckgenommenen bliebe es in „Offen" stehen, und der Knopf haette sichtbar die halbe
		// Arbeit getan. Es ist dieselbe Menge, die der gewoehnliche „Ablehnen"-Knopf benutzt
		// (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.ablehnen: alle).
		const alle = ((objekt && objekt.items) || []).map(function (item) { return item.id; });
		return {
			name: "ruecknahme_ablehnen", beschriftung: "Ablehnen", ton: "danger",
			ids: items.map(function (item) { return item.id; }),
			ablehnenIds: alle,
			angehakt: 0, gesamt: items.length, erledigt: false, disabled: false, grund: "",
		};
	}

	// REIN: „Zurück nach Offen" -- nur die Buchführung, kein Kartenobjekt wird angefasst.
	//
	// Owner 31.08.2026: „ich glaube geometrien haben sich nicht verändert wir wollen aber
	// 'Übernommen' zurück nach 'Offen' verschieben können."
	//
	// 🔴 ER GILT FÜR ITEMS, DIE NICHTS ANGELEGT HABEN ('changed'). Ein 'new'-Item hat ein Objekt auf
	// die Karte gebracht; es einfach nach „Offen" zurückzuschieben ließe das Objekt dort und böte
	// an, es ein zweites Mal anzulegen -- eine Dublette, die niemand mehr als solche erkennt. Dafür
	// gibt es „Zurücknehmen", das beides zusammen tut.
	//
	// ⚠️ Genau deshalb steht er NEBEN „Zurücknehmen" und nicht an seiner Stelle: die zwei Knöpfe
	// bedienen zwei verschiedene Mengen desselben Objekts, und welcher davon etwas kann, sagt seine
	// Zahl. Bei einem Objekt, dessen Items ausschließlich ein bestehendes Objekt beschrieben haben,
	// ist „Zurücknehmen" leer und DIESER trägt alles -- genau der Fall des Owners.
	// 💣 „ÜBERNOMMEN" HAT ZWEI QUELLEN, UND BEIDE MÜSSEN HIER STEHEN. `apply_state === 'done'` gilt
	// nur für den GERADE laufenden Lauf; `applied` ist der dauerhafte Vermerk in `sync_decision`,
	// der einen „Holen & Rechnen"-Lauf überlebt. avesmapsGaretienListeObjektStand
	// (garetien-liste.php) liest beide -- genau dafür wurde der zweite am 30.08.2026 überhaupt
	// eingeführt, damit sich die Liste leer arbeiten lässt.
	//
	// 🔴 BEIM ERSTEN BAU STAND HIER NUR DIE ERSTE. Der Owner rechnete danach neu, die frischen
	// Items standen auf `apply_state = null`, der Vermerk blieb -- das Objekt zeigte „Übernommen"
	// und BEKAM KEINEN KNOPF. „wie nehm ich das zurück" war die Folge: es gab schlicht keinen Weg.
	// Dieselbe Falle wie überall in dieser Datei: eine Regel, die einen von zwei Erzeugern bindet,
	// ist keine Regel.
	function garetienZurueckOffenItems(objekt) {
		return ((objekt && objekt.items) || []).filter(function (item) {
			if (!item || String(item.change_type || "") !== "changed") { return false; }
			return item.apply_state === "done" || item.applied === true;
		});
	}

	function garetienZurueckOffenBauen(objekt) {
		const items = garetienZurueckOffenItems(objekt);
		if (items.length === 0) { return null; }
		return {
			name: "zurueck_offen", beschriftung: "Zurück nach Offen", ton: "soft",
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
			// ⚠️ `filter(Boolean)`: „Ablehnen" und „Zurück nach Offen" fallen ganz weg, wenn sie
			// nichts können -- kein ausgegrauter Knopf neben dem Grund (Owner-Entscheid 1).
			return [
				garetienRuecknahmeBauen(o),
				garetienRuecknahmeAblehnenBauen(o),
				garetienZurueckOffenBauen(o),
			].filter(Boolean);
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
		// 💣 DIE ZWEI RUECKNAHME-VERBEN GEHEN HIER NIE HINAUS. Sie haben ihre EIGENE Tuer
		// (GARETIEN_ENDPUNKT, `action:'ruecknahme'`) und ihren eigenen Verteiler; faenden sie hier
		// einen Rumpf, fiele der Klick bis zu `garetienHandlungKlick` durch und verschickte ein
		// sinnloses `select` an die GETEILTE Tuer -- zwei Erzeuger fuer denselben Knopf.
		// ⚠️ Bis zum 31.08.2026 hielt das allein die Reihenfolge der Verdrahtung
		// (garetienRuecknahmeKlick laeuft vorher und meldet, dass er uebernommen hat). Das war eine
		// Zusicherung ohne Riegel: sie faellt, sobald jemand die Reihenfolge aendert, und der
		// Fehler waere still.
		if (name === "ruecknahme" || name === "ruecknahme_ablehnen" || name === "zurueck_offen") {
			return null;
		}
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
		// „Eingefügt wird" > „Wiki-Landschaft" braucht den Server (Aktion 'wiki_landschaft') --
		// der Platzhalter steht schon im Markup, dies trägt ihn nach.
		garetienWikiLandschaftBeiBedarfLaden(gewaehlt);
		// Owner-Auftrag A: „Imports in der Nähe anzeigen" -- derselbe Zug, eigener Riegel gegen
		// doppelte Abrufe desselben Objekts (`_garetienNaeheLetzterKey`).
		garetienNaeheBeiBedarfLaden(gewaehlt);
		// Dreiwertig ist eine EIGENSCHAFT, kein Attribut -- erst nach dem Einfügen einlösen, genau
		// wie in avesmapsGaretienListeRendern.
		Array.prototype.forEach.call(spalte.querySelectorAll("input[data-part]"), function (feld) {
			feld.indeterminate = true;
		});
	}

	// REIN: ein `data-key` als CSS-Attributwert. Die Schlüssel tragen `:` und `!`
	// (`ggp:Gewaesser:Fluss:Garetien:Alling`) -- in Anführungszeichen ist das harmlos, nur
	// Anführungszeichen und Rückwärtsstriche im Wert selbst müssten entkommen. Sie kommen heute
	// nicht vor; die Funktion behandelt sie trotzdem, weil ein kaputter Selektor eine Ausnahme
	// wirft und damit die ganze Auswahl abbräche.
	function garetienKeySelektor(schluessel) {
		return '[data-key="' + String(schluessel).replace(/["\\]/g, "\\$&") + '"]';
	}

	// Die gewählte Zeile wird SICHTBAR markiert -- `.avm-row.is-selected` ist die Hausform
	// (editor-row.css), kein eigener Zustand daneben.
	//
	// 🔴 ZWEI ZUGRIFFE STATT EINER SCHLEIFE ÜBER ALLE ZEILEN. Seit die Seitengröße auf 10000 steht,
	// trägt die Liste den ganzen Lauf; die alte Fassung ging bei JEDER Auswahl über 8212 Zeilen und
	// rief 8212-mal `classList.toggle` -- für ein Ergebnis, das genau zwei Zeilen betrifft (die
	// alte und die neue). Jetzt wird die alte über ihre Klasse gefunden und die neue über ihren
	// Schlüssel.
	//
	// 🔴 UND DIE GEWÄHLTE ZEILE WIRD SICHTBAR GESCROLLT (Owner 30.08.2026: „ich will, dass die
	// liste auch zur auswahl hinscrollt"). Der Anlass ist die Karte: wer dort ein Objekt anklickt,
	// bekommt seine Einzelansicht -- und die zugehörige Zeile stand irgendwo unter 8000 anderen.
	// ⚠️ `block: "nearest"` und NICHT "center": eine Zeile, die ohnehin im Bild steht, darf sich
	// nicht bewegen. Sonst springt die Liste bei jedem Zeilenklick unter dem Finger weg.
	// ⚠️ `scrollIntoView` wirkt auch auf Zeilen, die `content-visibility: auto` gerade übersprungen
	// hat -- der Browser löst sie dafür auf. Genau deshalb ist dort `auto` und nicht `hidden`.
	function garetienAuswahlMarkieren() {
		if (!hasDocument) { return; }
		const listeEl = document.getElementById("garetien-list");
		if (!listeEl) { return; }
		const alt = listeEl.querySelector(".avm-row.is-selected");
		if (alt) { alt.classList.remove("is-selected"); }
		if (zustand.detailKey === null) { return; }
		const neu = listeEl.querySelector(".avm-row" + garetienKeySelektor(zustand.detailKey));
		if (!neu) { return; }
		neu.classList.add("is-selected");
		if (typeof neu.scrollIntoView === "function") {
			neu.scrollIntoView({ block: "nearest" });
		}
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

	/*
	 * Ein Klick auf ein Import-Objekt AUF DER KARTE (Owner 30.08.2026).
	 *
	 * 🔴 ER WAEHLT AUS, ER HAEKELT NICHT AN -- und der Owner hat ausdruecklich darum gebeten, das
	 * nicht zu verwechseln. Der Unterschied ist keine Wortklauberei, die zwei tun Verschiedenes:
	 *   · AUSGEWAEHLT (`detailKey`) ist reine Anzeige -- die Einzelansicht rechts, die durchgehende
	 *     Kontur auf der Karte. Sie aendert nichts und wird nirgends weiterverwendet.
	 *   · MARKIERT (`markiert`, das Haekchen) ist eine ENTSCHEIDUNG: sie speist „Markierte anzeigen"
	 *     und die Sammelhandlungen, und der Editor findet sie spaeter wieder.
	 * Ein Kartenklick, der nebenbei anhaekelt, macht aus einem BLICK eine Entscheidung, die niemand
	 * getroffen hat -- und sie taucht in einer Sammelhandlung wieder auf, wo sie Schaden anrichtet.
	 * Deshalb fasst diese Funktion `zustand.markiert` in KEINE Richtung an, auch nicht loeschend.
	 *
	 * ⭐ Sie ruft schlicht denselben Waehler wie ein Zeilenklick: Einzelansicht, `is-selected` an der
	 * Zeile und die frisch gezeichnete Karte fallen dort von selbst ab. Ein eigener Weg waere eine
	 * zweite Wahrheit darueber, was „gewaehlt" heisst.
	 *
	 * ⚠️ Ein unbekannter Schluessel faellt OFFEN aus: Anzeige-Menge und Kartendaten koennen
	 * auseinanderlaufen (ein Objekt wurde eingefuegt und ist fort), und ein Wurf hier risse Leaflets
	 * Ereigniskette fuer die ganze Karte mit -- nicht nur fuer diese eine Form.
	 */
	function avesmapsGaretienKarteKlickBehandeln(schluessel, objekte) {
		if (schluessel === undefined || schluessel === null || schluessel === "") { return null; }
		const liste = objekte || zustand.objekte || [];
		return garetienDetailWaehlen(String(schluessel), liste);
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

		// Der Kasten „Eingefügt wird" (Owner 30.08.2026) -- NUR dieser Einzelknopf liest ihn und
		// reicht ihn weiter; siehe die Begründung an garetienEinfuegenAusfuehren.
		const einstellungen = garetienEingabenFuerServer(objekt);

		// `rumpf.ids` ist bereits der VOLLE Umfang (garetienHandlungsRumpf/garetienHandlungBauen
		// filtern nie nach Tick-Zustand) -- Anhaken und Übernehmen decken hier dieselbe Menge ab.
		return garetienEinfuegenAusfuehren(rumpf.ids, rumpf.ids, runId, avesmapsGaretienRufe, null, einstellungen)
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
	function garetienRuecknahmeSenden(itemIdsOderId, runId, ablehnenIds) {
		const ids = [].concat(itemIdsOderId).map(Number).filter(function (id) { return id > 0; });
		const abzulehnen = (ablehnenIds || []).map(Number).filter(function (id) { return id > 0; });
		return avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "ruecknahme", run_id: runId, ids: ids,
		}).then(function () {
			// 🔴 ZUERST ZURUECKNEHMEN, DANN ABLEHNEN -- und diese Reihenfolge ist die sichere.
			// Bricht der zweite Schritt ab, ist das Objekt von der Karte und steht in „Offen": ein
			// Zustand, den der Editor sieht und mit einem Klick zu Ende bringt. Andersherum staende
			// es als „abgelehnt" da und laege weiter auf der Karte -- eine Ablehnung, die nichts
			// abgelehnt hat, und niemand saehe es.
			// ⚠️ Die Ablehnung geht durch die GETEILTE Tuer (dieselbe wie der gewoehnliche
			// „Ablehnen"-Knopf), nicht durch die des Importers: sie ist keine Loeschung, sondern
			// eine Entscheidung, und die fuehren alle acht Objektarten dort.
			if (abzulehnen.length === 0) { return null; }
			return avesmapsGaretienRufe(GARETIEN_PLAN_ENDPUNKT, {
				action: "decline", kind: GARETIEN_PLAN_ART, run_id: runId, ids: abzulehnen,
			});
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
	function garetienRuecknahmeRueckfrageText(objekt, auchAblehnen) {
		const o = objekt || {};
		const name = String(o.name || "").trim() || "(ohne Namen)";
		const items = garetienRuecknahmeItems(o);
		const nurQuelle = items.length > 0 && items.every(function (item) {
			return String((item && item.change_type) || "") === "changed";
		});

		if (nurQuelle) {
			return "Die Quellenangabe von garetien.de an „" + name + "“ wird entfernt — das Objekt "
				+ "selbst bleibt unverändert auf der Karte.\n\n"
				+ garetienRuecknahmeZielSatz(auchAblehnen) + " Fortfahren?";
		}

		const istFlaeche = String(o.geometrie_typ || "") === "Polygon";
		const was = istFlaeche
			? "die Beschriftung „" + name + "“, die Landschaftsregion „" + name + "“ und ihre gezeichnete Fläche"
			: "das Kartenobjekt „" + name + "“";

		return "„" + name + "“ wird aus unserer Karte entfernt — das nimmt " + was + " mit, "
			+ "einschließlich aller Änderungen, die seither daran vorgenommen wurden.\n\n"
			+ garetienRuecknahmeZielSatz(auchAblehnen) + " Fortfahren?";
	}

	// REIN: der eine Satz, in dem sich die zwei Knöpfe unterscheiden -- WOHIN das Objekt danach
	// fällt. Er steht separat, weil die Rückfrage darüber ZWEI Textvarianten hat (Karte bzw. nur
	// Quelle) und der Unterschied in beiden derselbe ist; in beide hineingeschrieben liefe er beim
	// nächsten Wortlaut auseinander.
	//
	// 🔴 „Ablehnen" tut ZWEI Dinge, und die Rückfrage ist die Stelle, an der das steht -- der
	// Knopf trägt den Wortlaut des Owners („Ablehnen"), nicht die Aufzählung seiner Folgen.
	function garetienRuecknahmeZielSatz(auchAblehnen) {
		return auchAblehnen
			? "Das Objekt wandert danach nach „Abgelehnt“ und wird nicht wieder vorgeschlagen — "
				+ "zurückholen lässt es sich dort mit „Wieder vorschlagen“."
			: "Das Objekt fällt danach zurück nach „Offen“.";
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
	// REIN: der Klick auf „Zurück nach Offen" -- derselbe Bau wie garetienRuecknahmeKlick nebenan,
	// aber eine EIGENE Funktion und eine EIGENE Tür.
	//
	// 🔴 KEIN GEMEINSAMER VERTEILER MIT DER RÜCKNAHME, obwohl beide dieselbe Form haben. Die eine
	// löscht ein Kartenobjekt, die andere fasst keines an -- ein gemeinsamer Eingang mit einem
	// Modus-Feld wäre genau die Stelle, an der ein falscher Vorgabewert einmal löscht. Dieselbe
	// Begründung wie für die eigene Server-Aktion.
	//
	// ⚠️ OHNE RÜCKFRAGE, und das ist Absicht: hier verschwindet nichts. Eine Rückfrage vor einer
	// folgenlosen Handlung lehrt, Rückfragen wegzuklicken -- und die eine, die zählt, steht direkt
	// daneben am „Zurücknehmen".
	function garetienZurueckOffenKlick(ereignis, objekte, runId, senden) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest('[data-handlung="zurueck_offen"]');
		if (!knopf || knopf.disabled) { return null; }
		const objekt = garetienObjektNach(knopf.getAttribute("data-key"), objekte);
		if (!objekt) { return null; }
		const items = garetienZurueckOffenItems(objekt);
		if (items.length === 0) { return null; }

		knopf.disabled = true;
		knopf.textContent = "Verschiebt …";
		return senden(items.map(function (item) { return item.id; }), runId);
	}

	// Der Sender dazu. 🔴 EIGENE Aktion am EIGENEN Endpunkt (`zurueck_offen`), nicht die geteilte
	// Übernahme-Vorschau: was die Staging-Tabellen dieses Imports kennt, bleibt im Importer
	// (Abbau-Bedingung §5.5).
	function garetienZurueckOffenSenden(itemIds, runId) {
		const ids = [].concat(itemIds).map(Number).filter(function (id) { return id > 0; });
		return avesmapsGaretienRufe(GARETIEN_ENDPUNKT, {
			action: "zurueck_offen", run_id: runId, ids: ids,
		}).then(function () { return avesmapsGaretienListeHolen(); })
			.catch(function (fehler) { garetienListeFehlerZeigen(fehler); return null; });
	}

	function garetienRuecknahmeKlick(ereignis, objekte, runId, senden, fragen) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		// 🔴 BEIDE RUECKNAHME-VERBEN, EIN VERTEILER (Owner 31.08.2026). Sie teilen alles --
		// dieselbe Item-Menge, dieselbe Rueckfrage-Form, denselben Sender; verschieden ist nur, ob
		// danach noch abgelehnt wird. Zwei Verteiler waeren zwei Erzeuger derselben Loeschung.
		const knopf = ziel.closest('[data-handlung="ruecknahme"], [data-handlung="ruecknahme_ablehnen"]');
		if (!knopf || knopf.disabled) { return null; }
		const auchAblehnen = knopf.getAttribute("data-handlung") === "ruecknahme_ablehnen";
		const objekt = garetienObjektNach(knopf.getAttribute("data-key"), objekte);
		if (!objekt) { return null; }
		const items = garetienRuecknahmeItems(objekt);
		if (items.length === 0) { return null; }
		if (!fragen(garetienRuecknahmeRueckfrageText(objekt, auchAblehnen))) { return true; }

		knopf.disabled = true;
		knopf.textContent = auchAblehnen ? "Lehnt ab …" : "Nimmt zurück …";
		// ⚠️ EIN einzelnes Item bleibt eine nackte Zahl (Rückwärtskompatibilität mit dem
		// bestehenden Sender/Test), MEHRERE gehen als Liste -- garetienRuecknahmeSenden
		// verpackt ohnehin beides gleich (siehe dort).
		const ids = items.map(function (item) { return item.id; });
		// 💣 ZWEI VERSCHIEDENE MENGEN, und das ist der Kern: zurueckgenommen werden die
		// ruecknehmbaren Items, ABGELEHNT werden ALLE (siehe garetienRuecknahmeAblehnenBauen).
		const ablehnenIds = auchAblehnen
			? ((objekt.items || []).map(function (item) { return item.id; }))
			: null;
		return senden(ids.length === 1 ? ids[0] : ids, runId, ablehnenIds);
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
		// 🔴 NUR NOCH DER DRITTE GRUND (Owner 30.08.2026). „Nur im Reiter Übernommen verfügbar."
		// und „Nichts markiert …" sagten beide nur „hier gibt es nichts zu tun" -- das sagt der
		// graue Knopf mit seinem „(0 von 0)" schon. Dieser hier bleibt, weil er das Gegenteil
		// erklärt: es IST etwas markiert, und trotzdem geht nichts -- ohne den Satz sucht ein
		// Editor den Fehler bei sich.
		let hinweis = "";
		if (!falscherReiter && markierte.length > 0 && paare.length === 0) {
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
	//
	// 🔴 `einstellungen` (Owner 30.08.2026, Kasten „Eingefügt wird"): NUR garetienNeuKlick reicht
	// hier je etwas herein -- der Fußknopf (garetienFussknopfKlick, „Alle angezeigten einfügen")
	// ruft diese Funktion ohne den sechsten Parameter, `undefined` bleibt also `undefined` und wird
	// unten NIE in den `apply`-Rumpf gehängt. Genau DAS ist die Umsetzung der Regel „die
	// Massenübernahme nimmt die Vorgaben, nie die Handeingaben" -- strukturell, nicht per Vereinbarung.
	// Die Quellen der eben angelegten Objekte in den Kartenspeicher der GELADENEN Seite nachtragen.
	//
	// Owner-Meldung 31.08.2026, woertlich: „ich hab ein moor importiert, aber es fehlt die 'quelle,
	// die mitreist', erst wenn ich die seite komplett neulade stehts glaub dran".
	//
	// 🔴 DER KARTENSTEMPEL HEILT DAS NICHT, und das ist der ganze Grund fuer diese Funktion. Die
	// Uebernahme hebt `map_revision` (siehe avesmapsGaretienUebernehmen) -- aber die geladene Seite
	// fragt die Kartendaten danach nicht noch einmal ab. `window.__sourceCatalog` und
	// `window.__featureSourceRefs` sind eine EINMALIGE Aufnahme vom Seitenstart; die Infobox liest
	// synchron aus ihnen (AGENTS.md §11: „rendered synchronously -- no lazy per-popup fetch"). Ein
	// frisch importiertes Objekt steht darin gar nicht, seine Quelle also auch nicht.
	//
	// 🔴 DIE FUNKTION IST GETEILT, NICHT NACHGEBAUT. `syncFeatureSourcesToClientCache`
	// (js/review/review-feature-sources.js) tut dasselbe schon fuer die angenommene
	// Gemeinschaftsmeldung -- samt der beiden Feinheiten, an denen eine zweite Fassung scheitern
	// wuerde: sie schreibt in das Fenster, das die Globals wirklich FUEHRT (Editorseiten sind
	// iframes und tragen sie nicht), und sie fuellt den Katalog samt Lizenz und Namensnennung.
	// ⚠️ Kein stiller Rueckfall: fehlt sie, ist die Datei nicht geladen -- dann wird nichts
	// nachgetragen, aber es bricht auch nichts (der naechste vollstaendige Ladevorgang bringt den
	// Stand ohnehin). Eine Ersatzfassung waere die zweite Wahrheit, die dieser Absatz vermeidet.
	//
	// 💣 DER SERVER SCHICKT DIE VOLLE LISTE, NICHT NUR UNSERE QUELLE -- und das muss er, weil
	// `syncFeatureSourcesToClientCache` die Quellenliste einer Entitaet UEBERSCHREIBT. Bei einer
	// Ergaenzung (eine Quelle an ein BESTEHENDES Objekt, der Fall „Eupelmunder Moor") verschwaenden
	// sonst dessen andere Quellen aus der Anzeige -- derselbe Fehler wie der gemeldete, nur
	// andersherum.
	function garetienQuellenNachtragen(antwort) {
		const liste = (antwort && antwort.quellen_neu) || [];
		if (!Array.isArray(liste) || liste.length === 0) { return 0; }
		const abgleich = (typeof module !== "undefined" && module.exports)
			? require("./review-feature-sources.js").syncFeatureSourcesToClientCache
			: (typeof window !== "undefined" ? window.syncFeatureSourcesToClientCache : null);
		if (typeof abgleich !== "function") { return 0; }
		let getragen = 0;
		liste.forEach(function (eintrag) {
			if (!eintrag || !eintrag.entity_type || !eintrag.public_id) { return; }
			abgleich(eintrag.entity_type, eintrag.public_id, eintrag.sources || []);
			getragen++;
		});
		return getragen;
	}

	function garetienEinfuegenAusfuehren(idsZumAnhaken, idsZumUebernehmen, runId, rufe, fortschritt, einstellungen) {
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
					const rumpfApply = {
						// 🔴 SCHADENSFALL 30.08.2026: `ids` beschränkt `apply` auf GENAU dieses
						// Häppchen -- ohne dieses Feld übernähme der Server ALLES `selected=1` im
						// Lauf, Altbestand eingeschlossen (siehe avesmapsGaretienApplyStep).
						action: "apply", kind: GARETIEN_PLAN_ART, run_id: runId, ids: teil,
					};
					// Nur, wenn der Aufrufer wirklich eine Handeingabe mitgibt (siehe oben) -- sonst
					// bliebe der Schlüssel `undefined` im JSON-Rumpf ohnehin weg, aber explizit ist
					// hier klarer als implizit.
					if (einstellungen) { rumpfApply.einstellungen = einstellungen; }
					return rufe(GARETIEN_PLAN_ENDPUNKT, rumpfApply).then(function (antwort) {
						["applied", "deleted", "stale", "skipped", "declined"].forEach(function (feld) {
							summe[feld] += Number((antwort && antwort[feld]) || 0);
						});
						// 💣 HIER, im EINEN Trichter -- nicht an den zwei Klickverteilern. Jede
						// Antwort von `apply` kommt hier vorbei, auch die zweite und dritte eines
						// laengeren Laufs; an den Aufrufstellen waere es beim naechsten Knopf
						// vergessen.
						garetienQuellenNachtragen(antwort);
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
				// Owner 31.08.2026: „wir wollen aber 'Übernommen' zurück nach 'Offen' verschieben
				// können." Eigener Verteiler, eigene Tür -- siehe die Begründung an seiner
				// Definition.
				if (garetienZurueckOffenKlick(ereignis, zustand.objekte, zustand.planRunId,
					garetienZurueckOffenSenden)) { return; }
				// Owner-Auftrag A: „Imports in der Nähe anzeigen" -- derselbe Zug wie die drei
				// Verteiler darüber, mit der schon geladenen Trefferliste dieses Objekts.
				// Owner 30.08.2026: „soll auch automatisch ins tab 'Anzeigen' wechseln" --
				// derselbe Zug wie bei „Markierte anzeigen" im Fussknopf-Bund, und aus demselben
				// Grund: der Knopf legt Objekte in die Anzeige-Menge, und genau die zeigt jener
				// Reiter. Wer ihn drueckt und auf „Offen" stehen bleibt, sieht von seiner Handlung
				// nur eine Zahl im Reiterkopf.
				const naeheOffen = (zustand.objekte || []).filter(function (o) {
					return o && String(o.key) === String(zustand.detailKey);
				})[0] || null;
				if (garetienNaeheKlick(ereignis, _garetienNaeheGefunden, naeheOffen)) {
					zustand.stand = "anzeigen";
					garetienAnzeigeNeuZeichnen();
					return;
				}
				garetienHandlungKlick(ereignis, zustand.objekte, zustand.planRunId,
					avesmapsGaretienHandlungSenden, garetienFragen);
			});
			// Der Kasten „Eingefügt wird" (Owner 30.08.2026): ein EIGENER Zuhörer, weil Zahlenfelder
			// per "input" tippen, nicht klicken -- derselbe Delegationsgriff wie beim Klick-Zuhörer
			// oben, einmal beim Start, überlebt jeden Lauf von garetienDetailRendern.
			detailEl.addEventListener("input", function (ereignis) {
				garetienEingabenAendern(ereignis, zustand.objekte);
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
		// Owner-Auftrag B (30.08.2026): „Keines markieren" -- derselbe Zug, nur leerend statt
		// hinzufuegend. `garetienAnzeigeNeuZeichnen` zeichnet danach die Listenzeilen (ihr
		// Markiert-Zustand) und die zwei Fussknoepfe neu, wie bei „Alle markieren".
		const markKeinerBtn = hasDocument ? document.getElementById("garetien-mark-none") : null;
		if (markKeinerBtn) {
			markKeinerBtn.addEventListener("click", function () {
				if (markKeinerBtn.disabled) { return; }
				avesmapsGaretienKeineMarkieren();
				garetienAnzeigeNeuZeichnen();
			});
		}
		// Owner 31.08.2026: die Zeilen-Kachel. 🔴 Sie holt die Liste NEU -- der Deckel ist ein
		// Server-Parameter, kein Zuschnitt im Browser; ihn hier zu beschneiden hiesse, eine zweite
		// Wahrheit ueber „was steht in der Liste" zu fuehren.
		// ⚠️ Der Zuhoerer haengt am FENSTER-Bund, nicht am Feld: das Menueband wird neu gebaut
		// (garetienMenuebandSicherstellen), und ein Zuhoerer am Feld waere danach fort. Delegiert
		// ueber `change`, das in modernen Browsern blubbert.
		const bandEl = hasDocument ? document.getElementById("garetien-importer") : null;
		if (bandEl) {
			bandEl.addEventListener("change", function (ereignis) {
				const ziel = ereignis && ereignis.target;
				if (!ziel || ziel.id !== "garetien-zeilen") { return; }
				const roh = String(ziel.value || "");
				zustand.zeilenGrenze = roh === "alle" ? null : (parseInt(roh, 10) || null);
				garetienZeilenGrenzeMerken(
					typeof window !== "undefined" ? window.localStorage : null,
					zustand.zeilenGrenze
				);
				avesmapsGaretienListeHolen();
			});
		}
		const markZeigenBtn = hasDocument ? document.getElementById("garetien-mark-show") : null;
		if (markZeigenBtn) {
			markZeigenBtn.addEventListener("click", function () {
				avesmapsGaretienMarkierteAnzeigen(zustand.objekte);
				// 🔴 UND DER REITER WECHSELT MIT (Owner 30.08.2026: „Beim Klick auf 'Markierte
				// anzeigen' kannst du auf das 'Anzeigen'-Tab gehen"). Der Knopf legt Objekte in die
				// Anzeige-Menge, und genau die zeigt jener Reiter -- wer ihn drückt und auf „Offen"
				// stehen bleibt, sieht von seiner Handlung nur eine Zahl im Reiterkopf.
				// ⚠️ Der Wechsel geht über `zustand.stand` und dann durch denselben Trichter wie ein
				// Reiterklick (garetienAnzeigeNeuZeichnen ruft auf „anzeigen" avesmapsGaretienListeHolen).
				// Ein eigener Renderweg hier wäre der zweite Erzeuger derselben Ansicht.
				zustand.stand = "anzeigen";
				garetienAnzeigeNeuZeichnen();
			});
		}
		// Owner 30.08.2026: „Alle zentrieren" -- die Ansicht zoomt auf ALLE angezeigten Objekte.
		// 🔴 Gereicht wird dieselbe Menge, die auch gezeichnet ist (avesmapsGaretienAufDerKarte),
		// nicht die rohe Anzeige-Liste: die zwei laufen genau dann auseinander, wenn ein Objekt
		// gerade geöffnet ist und nur deswegen mit auf der Karte liegt. Auf etwas zu zoomen, das
		// nicht gezeichnet ist, wäre die zweite Wahrheit darüber, was auf der Karte liegt.
		const zentrierenAlleBtn = hasDocument
			? document.getElementById("garetien-zentrieren-alle") : null;
		if (zentrierenAlleBtn) {
			zentrierenAlleBtn.addEventListener("click", function () {
				if (zentrierenAlleBtn.disabled) { return; }
				if (typeof window !== "undefined"
					&& typeof window.avesmapsGaretienKarteAlleZentrieren === "function") {
					window.avesmapsGaretienKarteAlleZentrieren(avesmapsGaretienAufDerKarte());
				}
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
		// 🔴 Der Haken, ueber den der ZEICHNER einen Klick auf eine Form hierher meldet
		// (Owner 30.08.2026). Er wird beim Laden gesetzt und nie wieder abgemeldet: der Zeichner
		// ruft ihn nur, wenn ueberhaupt Formen liegen, und die liegen nur, solange das Fenster sie
		// zeigt. Ein An- und Abmelden je Fensteroeffnung waere ein zweiter Zustand, der mit dem
		// ersten auseinanderlaufen kann.
		// ⚠️ `||` statt harter Zuweisung: laedt diese Datei zweimal, bliebe sonst der zweite Haken
		// stehen und der erste waere still fort -- dieselbe Doppelanmeldungs-Falle wie beim
		// Sammelmenue im Menueband.
		window[AVESMAPS_GARETIEN_HAKEN_KLICK] = window[AVESMAPS_GARETIEN_HAKEN_KLICK]
			|| function (schluessel) { avesmapsGaretienKarteKlickBehandeln(schluessel, null); };
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
			garetienPanelsBeiseite,
			// Owner-Meldung 31.08.2026: die mitgereiste Quelle ohne Neuladen sichtbar machen.
			garetienQuellenNachtragen,
			// Owner 31.08.2026: „Ablehnen" neben „Zuruecknehmen" am uebernommenen Objekt.
			garetienRuecknahmeAblehnenBauen,
			// Owner 31.08.2026: „Uebernommen" zurueck nach „Offen" verschieben.
			garetienZurueckOffenBauen,
			garetienZurueckOffenItems,
			garetienZurueckOffenKlick,
			garetienRuecknahmeZielSatz,
			// Owner 31.08.2026: die Karte wird beim Oeffnen auf Import-Sicht gestellt.
			garetienKarteFuerImportRichten,
			garetienImportHakenSetzen,
			GARETIEN_IMPORT_HAKEN,
			// Fuenf-Punkte-Brief 30.08.2026, Punkt 2
			avesmapsGaretienDarfAdminHandlung,
			avesmapsGaretienFensterZustand,
			avesmapsGaretienRufe,
			// Aufgabe 1: die Anzeige-Menge -- gehoert dem Fenster, nicht dem Vorschlag (Entwurf §3).
			avesmapsGaretienAnzeigeHinzufuegen,
			avesmapsGaretienNurIhreMerken,
			AVESMAPS_GARETIEN_FELD_NUR_IHRE,
			AVESMAPS_GARETIEN_FELD_GEWAEHLT,
			AVESMAPS_GARETIEN_HAKEN_KLICK,
			// Owner 30.08.2026: Klick auf der Karte -> Einzelansicht. Waehlt AUS, haekelt NICHT an.
			avesmapsGaretienKarteKlickBehandeln,
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
			garetienEbenenKachelZustand,
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
			// Fuenf-Punkte-Brief 30.08.2026, Punkt 3: unsere Bezeichnung aufloesen
			garetienUnserBeschriftung,
			garetienPunkteText,
			garetienQuellenMarkup,
			// Aufgabe „Eingefügt wird" (30.08.2026)
			garetienEingefuegtWirdHatVorschlag,
			garetienEingefuegtWirdMarkup,
			garetienZielVorbelegung,
			garetienZielWahlZu,
			garetienZielWahlVergessen,
			garetienMoeglicheFormen,
			garetienArtenFuerForm,
			garetienFlaecheMeilen2,
			garetienZielWahlMarkup,
			// Fuenf-Punkte-Brief 30.08.2026, Punkt 6b
			garetienEingefuegtWirdUebernommenHinweis,
			// Owner-Nachtrag 30.08.2026: die Weg-/Ort-Einstellungen ("vergiss nicht die andern
			// einstellungen aus 'Weg bearbeiten', 'Ort bearbeiten' usw.")
			garetienEingefuegtWirdZeileMitHinweis,
			garetienEingefuegtWirdOrtMarkup,
			garetienEingefuegtWirdWegMarkup,
			// Aufgabe „Eingefügt wird -> Eingabefelder" (30.08.2026, „warum darf ich das nicht
			// verändern?"): die Handeingabe des Kastens, ihr Zustand und was daraus an den Server reist.
			garetienEingabenZustandZu,
			garetienEingabenGrundwerte,
			garetienEingabenAendern,
			garetienEingabenFuerServer,
			garetienEingabeId,
			// Aufgabe „die ECHTEN Steuerelemente" (30.08.2026): Regler + Vorgabe-Marke wie im echten
			// Beschriftungsdialog (index.html #label-edit-form).
			garetienSliderMarkePosition,
			garetienWikiLandschaftZeileText,
			garetienWikiLandschaftPlatzhalterId,
			garetienWikiLandschaftBeiBedarfLaden,
			// Owner-Auftrag A (30.08.2026): „Imports in der Nähe anzeigen"
			garetienNaeheKnopfZustand,
			garetienNaeheMarkup,
			garetienNaeheBeiBedarfLaden,
			garetienNaeheKlick,
			// KORREKTUR B (30.08.2026): die manuelle Wiki-Suche, wenn der automatische Treffer leer bleibt
			garetienWikiSucheHostId,
			garetienWikiSucheBeiBedarfZeigen,
			garetienWikiSucheMarkup,
			garetienWikiSucheZustandZu,
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
			// Owner-Auftrag B (30.08.2026): „Keines markieren"
			avesmapsGaretienKeineMarkieren,
			garetienKeineMarkierenZustand,
			garetienAlleZentrierenZustand,
			garetienKeySelektor,
			GARETIEN_ZEILEN_STUFEN,
			garetienZeilenGrenzeLesen,
			garetienZeilenGrenzeMerken,
			garetienZeilenOptionenMarkup,
			garetienAuswahlMarkieren,
			garetienAlleZentrierenKnopfSetzen,
			garetienKeineMarkierenKnopfSetzen,
			// Meldung C (30.08.2026): „Markierte zurücknehmen" -- die Menge, symmetrisch zum
			// Fußknopf „Einfügen".
			garetienKetteAbarbeiten,
			garetienRuecknahmeMengeZustand,
			garetienRuecknahmeMengeKnopfSetzen,
			garetienRuecknahmeMengeRueckfrageText,
			garetienRuecknahmeMengeAusfuehren,
			garetienRuecknahmeMengeKlick,
		};
	}
})();
