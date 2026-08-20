/*
 * Landschaften: Reihenfolge und Sperren — die Bedienung (19.08.2026).
 *
 * Entwurf: docs/superpowers/specs/2026-08-19-landschaften-reihenfolge-und-sperren-design.md
 *
 * Hier stecken die drei Wege zu denselben ZWEI Karteneigenschaften einer Region:
 *   - das Untermenü „Reihenfolge und Sperren ▸" im Flächenmenü,
 *   - der Zähler in der Landschaften-Leiste,
 *   - das Fenster mit Suche und Liste.
 * Der vierte Weg — der Haken „Für Klicks gesperrt" — sitzt im Eigenschaften-Dialog und geht über
 * dessen eigene Speicherleiste (map-features-ecosystem-properties.js); er hat hier nichts zu suchen,
 * weil „Abbrechen" dort sonst für einen der beiden Werte wirkungslos wäre.
 *
 * 🔴 „REGION", NICHT „FLÄCHE". Die Nachbarn im Menü heissen „Fläche löschen", „Fläche malen" -- die
 * treffen EINE Teilfläche. Diese Verben treffen alles, was zur Region gehört, auch ihre weiteren
 * Teilflächen und Multipolygone (Owner: „genau alles was ich anklick wird gesperrt. auch multipolys
 * oder mehrere zusammenhängenden flächen einer region"). Der Unterschied gehört ins Wort.
 *
 * 🔴 „VORN"/„HINTEN" HEISST IMMER *GANZ* -- im Menü wie im Fenster. Eine Stufe im einen und „ganz"
 * im anderen wären zwei Bedeutungen für dasselbe Wort; jede Ordnung lässt sich durch wiederholtes
 * Nach-vorn-Holen herstellen.
 *
 * 💣 DIE BEWEGUNG RECHNET DER SERVER (`set_region_stack`). Der Browser kennt nur die Flächen seines
 * BILDAUSSCHNITTS -- der Loader lädt nach bbox. Ein hier gerechnetes „höchster Rang + 10" schöbe die
 * Region hinter jede, die gerade nicht geladen ist, und zwei gleichzeitig drückende Editoren bekämen
 * denselben Rang.
 */
(function initEcosystemStapel() {
	"use strict";

	const GRUPPE = "stapel";
	const AKTION_VORN = "stapel-vorn";
	const AKTION_HINTEN = "stapel-hinten";
	const AKTION_SPERRE = "stapel-sperre";
	const AKTION_FENSTER = "stapel-fenster";

	// Die drei BEARBEITBAREN Ebenen. Klimazonen fehlen mit Absicht: die Ebene wird abgeleitet, nicht
	// gezeichnet (avesmapsClimateAssertNotDerived), und ihre Bänder decken die Karte in voller Breite.
	const EBENEN = [
		{ kind: "derographisch", label: "Derographie" },
		{ kind: "vegetation", label: "Vegetation" },
		{ kind: "topographie", label: "Topographie" },
	];

	let fensterEbene = "";
	let fensterRegionen = [];
	let laeuft = false;

	function tr_(key, deutsch) {
		return typeof tr === "function" ? tr(key, deutsch) : deutsch;
	}

	function sag(text, ton) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(text, ton);
		}
	}

	function darfBedienen() {
		return typeof canOperateEcosystemLayers === "function" && canOperateEcosystemLayers();
	}

	// ---- Zugriff auf den geladenen Bestand ----------------------------------------------------------

	function flaechenDerRegion(regionPublicId) {
		const treffer = [];
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return treffer;
		}
		ecosystemLayers.forEach((layer) => {
			if (layer?._ecosystemArea?.region_public_id === regionPublicId) {
				treffer.push(layer);
			}
		});

		return treffer;
	}

	function flaecheZuId(publicId) {
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return null;
		}

		return ecosystemLayers.get(String(publicId || ""))?._ecosystemArea || null;
	}

	// Wie viele Regionen dieser Ebene sind gesperrt? Gezählt über die REGIONEN, nicht die Flächen --
	// eine Region mit sieben Flächen ist eine Sperre, nicht sieben.
	//
	// ⚠️ Gezählt wird im geladenen Bestand. Eine gesperrte Region ausserhalb des Bildausschnitts fehlt
	// in der Zahl; der Zähler ist ein Hinweis („hier ist etwas gesperrt"), keine Bilanz. Die
	// vollständige Liste holt das Fenster beim Öffnen vom Server.
	function gesperrteRegionen(kind) {
		const gesehen = new Set();
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return gesehen;
		}
		ecosystemLayers.forEach((layer) => {
			const area = layer?._ecosystemArea;
			if (area && area.is_locked === true && (!kind || String(area.kind) === String(kind))) {
				gesehen.add(String(area.region_public_id || ""));
			}
		});

		return gesehen;
	}

	// ---- Schreiben ----------------------------------------------------------------------------------

	// Den geladenen Bestand nachziehen, damit die Karte sofort stimmt statt erst nach dem Nachladen.
	function merkeAmBestand(regionPublicId, felder) {
		flaechenDerRegion(regionPublicId).forEach((layer) => {
			Object.assign(layer._ecosystemArea, felder);
		});
	}

	async function schiebe(regionPublicId, position) {
		if (laeuft || !regionPublicId) {
			return;
		}
		laeuft = true;
		try {
			const ergebnis = await postEcosystemEdit("set_region_stack", {
				public_id: regionPublicId,
				position,
			});
			merkeAmBestand(regionPublicId, { stack_order: Number(ergebnis?.stack_order) || 0 });
			if (typeof applyEcosystemStackingOrder === "function") {
				applyEcosystemStackingOrder();
			}
			sag(position === "front"
				? tr_("ecosystem.stapel.movedFront", "Region liegt jetzt ganz vorn.")
				: tr_("ecosystem.stapel.movedBack", "Region liegt jetzt ganz hinten."));
		} catch (fehler) {
			sag(fehler?.message || tr_("ecosystem.stapel.moveFailed", "Die Reihenfolge liess sich nicht ändern."), "warning");
		} finally {
			laeuft = false;
		}
	}

	async function sperre(regionPublicId, gesperrt) {
		if (laeuft || !regionPublicId) {
			return;
		}
		laeuft = true;
		try {
			await postEcosystemEdit("update_region", { public_id: regionPublicId, is_locked: gesperrt });
			merkeAmBestand(regionPublicId, { is_locked: gesperrt === true });
			zeichneZaehler();
			sag(gesperrt
				? tr_("ecosystem.stapel.locked", "Region gesperrt — Klicks gehen jetzt hindurch.")
				: tr_("ecosystem.stapel.unlocked", "Region entsperrt."));
		} catch (fehler) {
			sag(fehler?.message || tr_("ecosystem.stapel.lockFailed", "Die Sperre liess sich nicht ändern."), "warning");
		} finally {
			laeuft = false;
		}
	}

	// ---- Das Untermenü im Flächenmenü ---------------------------------------------------------------

	function regionAusMenue(publicId) {
		const area = flaecheZuId(publicId);
		return area ? String(area.region_public_id || "") : "";
	}

	function registriereMenue() {
		const menu = window.AvesmapsEcosystemAreaMenu;
		if (!menu?.addEntry) {
			return;
		}

		menu.addEntry({
			action: AKTION_VORN,
			label: tr_("ecosystem.ctxmenu.stapelFront", "Region in den Vordergrund"),
			group: GRUPPE,
			onClick: (publicId) => void schiebe(regionAusMenue(publicId), "front"),
		});
		menu.addEntry({
			action: AKTION_HINTEN,
			label: tr_("ecosystem.ctxmenu.stapelBack", "Region in den Hintergrund"),
			group: GRUPPE,
			onClick: (publicId) => void schiebe(regionAusMenue(publicId), "back"),
		});
		menu.addEntry({
			action: AKTION_SPERRE,
			label: tr_("ecosystem.ctxmenu.stapelLock", "Region sperren"),
			group: GRUPPE,
			onClick: (publicId) => {
				const area = flaecheZuId(publicId);
				void sperre(String(area?.region_public_id || ""), area?.is_locked !== true);
			},
			// 🔴 EIN Eintrag mit zwei Wörtern. Welches gilt, hängt an der angeklickten Fläche, also
			// wird es beim Öffnen gesetzt und nicht beim Registrieren.
			//
			// ⚠️ Eine gesperrte Region lässt sich normalerweise nicht mehr rechtsklicken — das IST
			// der Sinn. „Region entsperren" sieht man deshalb nur, wenn eine andere Fläche darüber
			// liegt und den Rechtsklick weiterreicht. Der gewöhnliche Weg zurück ist das Fenster,
			// und genau dafür gibt es das Fenster.
			refresh: (knopf, publicId) => {
				knopf.textContent = flaecheZuId(publicId)?.is_locked === true
					? tr_("ecosystem.ctxmenu.stapelUnlock", "Region entsperren")
					: tr_("ecosystem.ctxmenu.stapelLock", "Region sperren");
			},
		});
		menu.addEntry({
			action: AKTION_FENSTER,
			label: tr_("ecosystem.ctxmenu.stapelWindow", "Alle Regionen …"),
			group: GRUPPE,
			onClick: (publicId) => {
				const area = flaecheZuId(publicId);
				void oeffneFenster(String(area?.kind || ""));
			},
		});
	}

	// ---- Der Zähler in der Leiste -------------------------------------------------------------------

	function zaehlerKnopf() {
		return document.getElementById("ecosystem-stapel-open");
	}

	function zeichneZaehler() {
		const knopf = zaehlerKnopf();
		if (!knopf) {
			return;
		}
		if (!darfBedienen()) {
			knopf.hidden = true;
			return;
		}
		const kind = typeof getActiveEcosystemLayerKind === "function" ? getActiveEcosystemLayerKind() : "";
		const anzahl = gesperrteRegionen(kind).size;
		knopf.hidden = false;

		// 🔴 DAS ZEICHEN SAGT, WAS DER KNOPF TUT: ☰ öffnet eine Liste. Ein Schloss behauptete einen
		// ZUSTAND, und der Knopf öffnet ein Fenster (Owner 20.08.2026).
		knopf.textContent = "☰";

		// Die Zahl der gesperrten Regionen als eigenes Abzeichen daneben — und nur, wenn es welche
		// gibt. Sie ist die Auskunft, nicht die Handlung.
		// ⚠️ Bei 0 verschwindet das Abzeichen ganz, statt „0" zu zeigen: ein Zähler, der immer da ist,
		// sagt nichts mehr.
		if (anzahl > 0) {
			const abzeichen = document.createElement("span");
			abzeichen.className = "ecosystem-stapel-open__zahl";
			abzeichen.textContent = `🔒${anzahl}`;
			knopf.appendChild(abzeichen);
		}
		knopf.classList.toggle("ecosystem-stapel-open--aktiv", anzahl > 0);
		knopf.title = anzahl > 0
			? `Reihenfolge und Sperren — ${anzahl} ${anzahl === 1 ? "Region ist gesperrt" : "Regionen sind gesperrt"}`
			: tr_("ecosystem.stapel.openAria", "Reihenfolge und Sperren");
	}

	// ---- Das Fenster --------------------------------------------------------------------------------

	const el = (id) => document.getElementById(id);

	function schliesseFenster() {
		const overlay = el("ecosystem-stapel-overlay");
		if (overlay) {
			overlay.hidden = true;
		}
	}

	async function oeffneFenster(kind) {
		const overlay = el("ecosystem-stapel-overlay");
		if (!overlay || !darfBedienen()) {
			return;
		}
		const gewaehlt = EBENEN.some((eintrag) => eintrag.kind === kind)
			? kind
			: (typeof getActiveEcosystemLayerKind === "function" && EBENEN.some((e) => e.kind === getActiveEcosystemLayerKind())
				? getActiveEcosystemLayerKind()
				: "vegetation");
		overlay.hidden = false;
		zeichneEbenenKnoepfe();
		await ladeEbene(gewaehlt);
		el("ecosystem-stapel-filter")?.focus();
	}

	function zeichneEbenenKnoepfe() {
		const behaelter = el("ecosystem-stapel-kinds");
		if (!behaelter || behaelter.childElementCount > 0) {
			return;
		}
		EBENEN.forEach((eintrag) => {
			const knopf = document.createElement("button");
			knopf.type = "button";
			knopf.className = "ecosystem-stapel__kind";
			knopf.dataset.stapelKind = eintrag.kind;
			knopf.textContent = tr_(`ecosystem.kind.${eintrag.kind}`, eintrag.label);
			knopf.addEventListener("click", () => void ladeEbene(eintrag.kind));
			behaelter.appendChild(knopf);
		});
	}

	function markiereEbene() {
		el("ecosystem-stapel-kinds")?.querySelectorAll("[data-stapel-kind]").forEach((knopf) => {
			knopf.classList.toggle("ecosystem-stapel__kind--aktiv", knopf.dataset.stapelKind === fensterEbene);
		});
	}

	async function ladeEbene(kind) {
		fensterEbene = String(kind || "");
		markiereEbene();
		const liste = el("ecosystem-stapel-list");
		const fehler = el("ecosystem-stapel-error");
		if (fehler) {
			fehler.hidden = true;
		}
		if (liste) {
			liste.textContent = tr_("ecosystem.stapel.loading", "Wird geladen …");
		}
		try {
			const ergebnis = await postEcosystemEdit("list_regions", { kind: fensterEbene });
			// 🔴 Der Server liefert die Liste bereits in Stapelreihenfolge (stack_order DESC) -- oben
			// liegt vorn. Hier wird NICHT nachsortiert: zwei Sortierungen für dieselbe Liste laufen
			// beim nächsten Umbau auseinander.
			fensterRegionen = Array.isArray(ergebnis?.regions) ? ergebnis.regions : [];
			zeichneListe();
		} catch (ausnahme) {
			fensterRegionen = [];
			if (liste) {
				liste.textContent = "";
			}
			if (fehler) {
				fehler.hidden = false;
				fehler.textContent = ausnahme?.message || tr_("ecosystem.stapel.loadFailed", "Die Regionen liessen sich nicht laden.");
			}
		}
	}

	function sichtbareRegionen() {
		const suche = String(el("ecosystem-stapel-filter")?.value || "").trim().toLowerCase();
		if (suche === "") {
			return fensterRegionen;
		}

		return fensterRegionen.filter((region) => String(region?.name || "").toLowerCase().includes(suche));
	}

	function zeichneListe() {
		const liste = el("ecosystem-stapel-list");
		if (!liste) {
			return;
		}
		liste.textContent = "";
		const sichtbar = sichtbareRegionen();
		if (sichtbar.length === 0) {
			const leer = document.createElement("p");
			leer.className = "ecosystem-import-dialog__empty";
			leer.textContent = fensterRegionen.length === 0
				? tr_("ecosystem.stapel.emptyLayer", "Diese Ebene hat noch keine Region.")
				: tr_("ecosystem.stapel.emptyFilter", "Keine Region passt zu dieser Suche.");
			liste.appendChild(leer);
			zeichneBilanz(0);
			return;
		}

		sichtbar.forEach((region, index) => {
			liste.appendChild(baueZeile(region, index + 1));
		});
		zeichneBilanz(sichtbar.length);
	}

	// ---- Doppelklick: dorthin zoomen -----------------------------------------------------------------
	//
	// Owner 20.08.2026: „cool wärs wenn man im dialogfenster auf ein layer doppelklicken könnte und er
	// zoomt hin."
	//
	// 💣 KOORDINATENTAUSCH. Die Leitung führt GeoJSON — [x, y]. Leaflets `L.CRS.Simple` will
	// [lat, lng] = [y, x] (AGENTS.md §5). Ohne den Tausch landet man spiegelverkehrt irgendwo auf der
	// Karte, und weil beide Achsen 0..1024 laufen, sieht das Ergebnis plausibel aus.
	//
	// 🔴 Das Fenster bleibt OFFEN. Es verdunkelt die Karte nicht und lässt Zeiger durch — genau dafür
	// steht es in der Ausnahmeliste von `dialog-overlays.css` — man sieht den Zoom also, während die
	// Liste stehen bleibt. Bei 89 Regionen wäre „jedes Mal schliessen und neu suchen" die Zumutung.
	function zeigeAufKarte(region) {
		const ecken = region?.bounds;
		if (!ecken) {
			sag(tr_("ecosystem.stapel.noBounds", "Diese Region hat keine Fläche — es gibt nichts zu zeigen."), "warning");
			return;
		}
		if (typeof map === "undefined" || !map || typeof map.fitBounds !== "function") {
			return;
		}

		// Die Ebene mitziehen: eine Region der Topographie nützt nichts, wenn die Vegetation
		// eingeschaltet ist -- man zoomt dann auf eine Stelle, an der man sie nicht sieht.
		if (region.kind && typeof setActiveEcosystemLayerKind === "function"
			&& typeof getActiveEcosystemLayerKind === "function"
			&& getActiveEcosystemLayerKind() !== region.kind) {
			setActiveEcosystemLayerKind(region.kind);
		}

		map.fitBounds(
			[[ecken.min_y, ecken.min_x], [ecken.max_y, ecken.max_x]],
			// Luft ringsum, damit die Region nicht bündig am Rand klebt -- und damit eine winzige
			// Region nicht auf die höchste Zoomstufe springt, auf der man die Nachbarschaft verliert.
			{ padding: [40, 40], maxZoom: 5 }
		);

		// Und sagen, WELCHE es war: nach dem Zoom liegen oft mehrere nebeneinander.
		if (typeof setHighlightedEcosystemRegion === "function") {
			setHighlightedEcosystemRegion(region.public_id);
		}
	}

	// ---- „Nur diese Region zeigen" -------------------------------------------------------------------
	//
	// Owner 20.08.2026: „ein isolated modus, wo nur die region angezeigt wird … der modus soll keinen
	// dauerhaften effekt haben, es geht nur um die schnelle anzeige. bei nochmaligem klicken soll alles
	// wieder auftauchen."
	//
	// 🔴 REINE LAUFZEIT. Nichts davon geht zum Server, nichts in den Speicher des Browsers, nichts in
	// die Karteneigenschaften. Ein Neuladen der Seite hebt es auf -- das ist gewollt und der Unterschied
	// zur Sperre nebenan, die eine echte Eigenschaft der Region ist.
	//
	// 🔴 UND ER SAGT SICH AN. Wer isoliert und danach das Fenster schliesst, sässe sonst vor einer
	// Ebene, die leer aussieht, ohne den Grund zu finden -- dieselbe Falle wie eine gesperrte Fläche
	// ohne Zähler. Der Streifen in der Landschaften-Leiste nennt die Region und trägt den Ausweg.
	//
	// ⚠️ Er versteckt FLÄCHEN, keine Labels. Der Name einer Nachbarregion kann also stehen bleiben;
	// „nur die Region anzeigen" meint ihre Geometrie, und die Beschriftungen kommen aus der
	// Kartennutzlast, nicht aus dieser Ebene.
	let isolierteRegion = "";

	function kartenHuelle() {
		return typeof map !== "undefined" && map && typeof map.getContainer === "function"
			? map.getContainer()
			: null;
	}

	// Die Markierung neu setzen. MUSS nach jedem Nachladen laufen -- der Loader holt beim Schwenken
	// neue Flächen, und die kommen als frische Pfade ohne Markierung in die Pane.
	function wendeIsolationAn() {
		const huelle = kartenHuelle();
		if (huelle) {
			huelle.classList.toggle("ecosystem-isolation", isolierteRegion !== "");
		}
		if (typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map) {
			ecosystemLayers.forEach((layer) => {
				const pfad = layer?._path;
				if (pfad) {
					pfad.classList.toggle(
						"ecosystem-area--isoliert",
						isolierteRegion !== "" && layer._ecosystemArea?.region_public_id === isolierteRegion
					);
				}
			});
		}
		zeichneIsolationsStreifen();
	}

	function zeichneIsolationsStreifen() {
		const streifen = el("ecosystem-isolation-note");
		if (!streifen) {
			return;
		}
		streifen.hidden = isolierteRegion === "";
		if (isolierteRegion === "") {
			return;
		}
		// Der Name kommt aus dem geladenen Bestand oder aus der Fensterliste -- je nachdem, was da ist.
		const ausBestand = flaechenDerRegion(isolierteRegion)[0]?._ecosystemArea?.region_name;
		const ausListe = fensterRegionen.find((region) => region.public_id === isolierteRegion)?.name;
		const name = String(ausBestand || ausListe || "");
		const feld = el("ecosystem-isolation-name");
		if (feld) {
			feld.textContent = name === ""
				? tr_("ecosystem.isolation.noteUnnamed", "Nur eine Region wird gezeigt")
				: `Nur „${name}"`;
		}
	}

	// Umschalter: dieselbe Region noch einmal hebt die Isolation auf, eine andere übernimmt sie.
	function schalteIsolation(regionPublicId) {
		const gewaehlt = String(regionPublicId || "");
		isolierteRegion = isolierteRegion === gewaehlt ? "" : gewaehlt;
		wendeIsolationAn();
		zeichneListe();
	}

	// ---- Löschen -------------------------------------------------------------------------------------
	//
	// 🔴 DIE RÜCKFRAGE KOMMT AUS DEM EIGENSCHAFTEN-DIALOG, sie wird hier nicht nachgebaut. Sie sagt,
	// wie viele Flächen mitgehen, ob Labels mitgehen oder stehen bleiben, und dass auch verschwindet,
	// was gerade nicht im Bild ist. Zwei Sätze für dieselbe Geste wären zwei Vokabeln, und einer davon
	// würde beim nächsten Umbau vergessen.
	//
	// ⚠️ `ecosystemLabelCountOfRegion` zählt die GELADENEN Labels -- für eine Region ausserhalb des
	// Bildausschnitts kann die Zahl zu klein sein. Das ist im Eigenschaften-Dialog nicht anders, und
	// beide benutzen dieselbe Funktion: lieber dieselbe Unschärfe an beiden Stellen als zwei
	// verschiedene Aussagen über denselben Vorgang. Der Satz BEHAUPTET bei 0 auch nichts -- er
	// erwähnt Labels dann schlicht nicht.
	async function loescheRegion(region) {
		if (laeuft || !region?.public_id) {
			return;
		}
		const satz = window.AvesmapsEcosystemProperties?.formatDeleteConfirmation;
		if (typeof satz !== "function") {
			sag(tr_("ecosystem.stapel.deleteUnavailable", "Löschen ist gerade nicht verfügbar."), "warning");
			return;
		}
		const labels = typeof ecosystemLabelCountOfRegion === "function"
			? ecosystemLabelCountOfRegion(region.public_id)
			: 0;
		const kaskade = typeof isEcosystemCascadeEnabled === "function" ? isEcosystemCascadeEnabled() : false;
		if (!window.confirm(satz(region.name || "", region.area_count, labels, kaskade))) {
			return;
		}

		laeuft = true;
		try {
			const ergebnis = await postEcosystemEdit("delete_region", { public_id: region.public_id });
			// Die mitgelöschten Labels sofort von der Karte: sie kommen aus der Kartennutzlast, die der
			// Landschaften-Loader nicht neu holt.
			if (typeof removeEcosystemCascadedLabels === "function") {
				removeEcosystemCascadedLabels(ergebnis);
			}
			if (typeof scheduleEcosystemAreaReload === "function") {
				scheduleEcosystemAreaReload({ immediate: true });
			}
			const mitgegangen = Number(ergebnis?.labels_deleted) || 0;
			sag(mitgegangen > 0
				? `Region „${region.name}" gelöscht — mit ${mitgegangen === 1 ? "ihrem Label" : `ihren ${mitgegangen} Labels`}.`
				: `Region „${region.name}" gelöscht.`, "success");
		} catch (fehler) {
			sag(fehler?.message || tr_("ecosystem.stapel.deleteFailed", "Die Region liess sich nicht löschen."), "warning");
		} finally {
			laeuft = false;
		}
		// Immer neu laden -- auch nach einem Fehlschlag: nur so zeigt die Liste, was wirklich noch da ist.
		await ladeEbene(fensterEbene);
		zeichneZaehler();
	}

	// ---- Ziehen: die Reihenfolge von Hand legen ------------------------------------------------------
	//
	// Owner 20.08.2026: „über drag-n-drop die reihenfolge ändern."
	//
	// 🔴 GEZOGEN WIRD NUR OHNE FILTER. Wer bei aktiver Suche drei von 89 Zeilen sieht und eine davon
	// verschiebt, meint eine Reihenfolge, die er nicht sieht. Der eigentliche Riegel steht im Server
	// (`reorder_regions` lehnt eine unvollständige Liste ab) -- hier wird nur gar nicht erst gezogen,
	// damit niemand eine Geste macht, die danach abgewiesen wird.
	//
	// ⚠️ HTML5-Ziehen kennt kein Touch. Am Telefon bleiben ⤒ und ⤓, und die tun dasselbe in gröber.
	let ziehIndex = -1;

	// Wohin gehört die gezogene Zeile, wenn sie über `zeilenIndex` losgelassen wird?
	//
	// 💣 DER FEHLER UM EINS. Wird nach UNTEN gezogen, rutscht alles zwischen Start und Ziel um eine
	// Stelle hoch, sobald die gezogene Zeile herausgenommen ist -- ohne die Korrektur landet sie eine
	// Stelle zu weit. Nach oben gezogen passiert das nicht. Rein und einzeln geprüft, weil man den
	// Fehler beim Ausprobieren für „ungenaues Ziehen" hält und nicht für einen Rechenfehler.
	function avesmapsStapelZielIndex(vonIndex, zeilenIndex, obereHaelfte) {
		let ziel = obereHaelfte ? zeilenIndex : zeilenIndex + 1;
		if (vonIndex < ziel) {
			ziel -= 1;
		}

		return ziel;
	}

	// Die reine Umsortierung. Getrennt vom Server-Aufruf, damit die Reihenfolge prüfbar ist.
	function avesmapsStapelUmsortieren(liste, vonIndex, nachIndex) {
		const neu = Array.isArray(liste) ? liste.slice() : [];
		if (vonIndex < 0 || vonIndex >= neu.length || nachIndex < 0 || nachIndex >= neu.length) {
			return neu;
		}
		const [gezogen] = neu.splice(vonIndex, 1);
		neu.splice(nachIndex, 0, gezogen);

		return neu;
	}

	function darfZiehen() {
		return String(el("ecosystem-stapel-filter")?.value || "").trim() === "";
	}

	async function reiheNeu(vonIndex, nachIndex) {
		if (vonIndex === nachIndex || vonIndex < 0 || nachIndex < 0 || laeuft) {
			return;
		}
		const vorher = fensterRegionen.slice();
		const neu = avesmapsStapelUmsortieren(fensterRegionen, vonIndex, nachIndex);

		// Sofort neu zeichnen: das Ziehen soll sich anfühlen, als wäre es schon passiert.
		fensterRegionen = neu;
		zeichneListe();

		laeuft = true;
		try {
			await postEcosystemEdit("reorder_regions", {
				kind: fensterEbene,
				// In ANZEIGEreihenfolge: vorn zuerst. Der Server rechnet daraus die Ränge.
				public_ids: neu.map((region) => region.public_id),
			});
			// Den geladenen Bestand nachziehen, damit die Karte sofort stimmt.
			const anzahl = neu.length;
			neu.forEach((region, index) => {
				merkeAmBestand(region.public_id, { stack_order: (anzahl - index) * 10 });
			});
			if (typeof applyEcosystemStackingOrder === "function") {
				applyEcosystemStackingOrder();
			}
		} catch (fehler) {
			// 🔴 Zurück auf den Stand VOR dem Ziehen. Eine Liste, die eine Reihenfolge zeigt, die der
			// Server abgelehnt hat, ist schlimmer als eine Fehlermeldung: man sieht seine Änderung und
			// glaubt, sie sei da.
			fensterRegionen = vorher;
			zeichneListe();
			sag(fehler?.message || tr_("ecosystem.stapel.reorderFailed", "Die Reihenfolge liess sich nicht speichern."), "warning");
		} finally {
			laeuft = false;
		}
	}

	function baueZeile(region, platz) {
		const zeile = document.createElement("div");
		zeile.className = "ecosystem-stapel__row";
		if (region.is_locked === true) {
			zeile.classList.add("ecosystem-stapel__row--gesperrt");
		}
		// 🔴 Eine Geste, die man kennen muss, ist für den, der sie nicht kennt, keine -- deshalb steht
		// sie im Zettel der Zeile UND unten in der Bilanzzeile. Dieselbe Überlegung, die „Fläche
		// bearbeiten" als sichtbaren Zwilling des Doppelklicks ins Menü gebracht hat.
		zeile.title = darfZiehen()
			? tr_("ecosystem.stapel.rowHint", "Doppelklick: auf der Karte zeigen · Ziehen: Reihenfolge ändern")
			: tr_("ecosystem.stapel.showHint", "Doppelklick: auf der Karte zeigen");
		zeile.addEventListener("dblclick", (event) => {
			// 🪤 Nicht auf den Werkzeugen: zweimal schnell auf „ganz nach vorn" ist ein doppelter
			// Klick auf den Knopf, keine Zoom-Anforderung.
			if (event.target?.closest?.(".ecosystem-stapel__tools")) {
				return;
			}
			zeigeAufKarte(region);
		});

		// ---- Ziehen ---------------------------------------------------------------------------------
		const platzIndex = platz - 1;
		if (darfZiehen()) {
			zeile.draggable = true;
			zeile.addEventListener("dragstart", (event) => {
				ziehIndex = platzIndex;
				zeile.classList.add("ecosystem-stapel__row--zieht");
				// Firefox startet ohne gesetzte Daten gar kein Ziehen.
				event.dataTransfer?.setData?.("text/plain", region.public_id);
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = "move";
				}
			});
			zeile.addEventListener("dragend", () => {
				ziehIndex = -1;
				zeile.classList.remove("ecosystem-stapel__row--zieht");
				el("ecosystem-stapel-list")?.querySelectorAll(".ecosystem-stapel__row--ziel-oben, .ecosystem-stapel__row--ziel-unten")
					.forEach((andere) => andere.classList.remove("ecosystem-stapel__row--ziel-oben", "ecosystem-stapel__row--ziel-unten"));
			});
			zeile.addEventListener("dragover", (event) => {
				if (ziehIndex < 0) {
					return;
				}
				// 💣 Ohne preventDefault gibt es kein `drop` -- der Browser lehnt die Ablage sonst ab.
				event.preventDefault();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = "move";
				}
				// Über oder unter der Mitte? Danach richtet sich die Linie UND die Zielstelle.
				const kasten = zeile.getBoundingClientRect();
				const obereHaelfte = (event.clientY - kasten.top) < kasten.height / 2;
				zeile.classList.toggle("ecosystem-stapel__row--ziel-oben", obereHaelfte);
				zeile.classList.toggle("ecosystem-stapel__row--ziel-unten", !obereHaelfte);
			});
			zeile.addEventListener("dragleave", () => {
				zeile.classList.remove("ecosystem-stapel__row--ziel-oben", "ecosystem-stapel__row--ziel-unten");
			});
			zeile.addEventListener("drop", (event) => {
				event.preventDefault();
				if (ziehIndex < 0) {
					return;
				}
				const kasten = zeile.getBoundingClientRect();
				const obereHaelfte = (event.clientY - kasten.top) < kasten.height / 2;
				void reiheNeu(ziehIndex, avesmapsStapelZielIndex(ziehIndex, platzIndex, obereHaelfte));
			});
		}

		// ⠿ — die etablierte Vokabel für „das hier lässt sich ziehen" (Owner 20.08.2026).
		//
		// 🔴 NUR WENN WIRKLICH GEZOGEN WERDEN DARF. Bei aktiver Suche ist das Ziehen aus (siehe
		// darfZiehen), und ein Greifer über einer Zeile, die sich nicht bewegt, ist eine Lüge.
		// ⚠️ Die SPALTE bleibt trotzdem stehen, nur leer -- sonst rückt bei jedem Tippen ins Suchfeld
		// die ganze Liste um eine Spaltenbreite. Dieselbe Überlegung wie beim ausgegrauten Zahnrad.
		const greifer = document.createElement("span");
		greifer.className = "ecosystem-stapel__greifer";
		greifer.setAttribute("aria-hidden", "true");
		greifer.textContent = darfZiehen() ? "⠿" : "";
		zeile.appendChild(greifer);

		const nummer = document.createElement("span");
		nummer.className = "ecosystem-stapel__pos";
		nummer.textContent = String(platz);
		zeile.appendChild(nummer);

		const name = document.createElement("span");
		name.className = "ecosystem-stapel__name";
		name.textContent = region.name || tr_("ecosystem.stapel.unnamed", "(ohne Namen)");
		if (region.is_locked === true) {
			const marke = document.createElement("span");
			marke.className = "ecosystem-stapel__mark";
			marke.textContent = tr_("ecosystem.stapel.lockedMark", "gesperrt");
			name.appendChild(marke);
		}
		zeile.appendChild(name);

		const werkzeuge = document.createElement("span");
		werkzeuge.className = "ecosystem-stapel__tools";
		// ⚠️ Zeilenhandlungen sind NIE die Haupthandlung der Seite (AGENTS.md §12): weich/outline,
		// niemals gefüllt. Bei 777 Regionen multipliziert sich ein Akzentknopf mit der Zeilenzahl --
		// genau der Fehler, der 2026-08-07 in den WikiSync-Listen zurückgebaut wurde.
		werkzeuge.appendChild(baueWerkzeug("⤒", tr_("ecosystem.stapel.toFront", "ganz nach vorn"), async () => {
			await schiebe(region.public_id, "front");
			await ladeEbene(fensterEbene);
		}));
		werkzeuge.appendChild(baueWerkzeug("⤓", tr_("ecosystem.stapel.toBack", "ganz nach hinten"), async () => {
			await schiebe(region.public_id, "back");
			await ladeEbene(fensterEbene);
		}));
		// ⚙ Eigenschaften (Owner 20.08.2026). Der Dialog wird über eine FLÄCHE geöffnet, das Fenster
		// kennt aber nur Regionen -- deshalb reist die älteste Fläche der Region als
		// `first_area_public_id` im Payload mit.
		// ⚠️ Die Geländeregler in jenem Dialog gehören genau dieser einen Fläche, die Felder darüber
		// der Region. Das ist eine Eigenschaft des Dialogs und keine dieses Fensters.
		//
		// 💣 IMMER GEBAUT, NOTFALLS AUSGEGRAUT -- nie weggelassen. Bis zum 20.08.2026 fiel der Knopf
		// bei einer Region ohne Fläche ganz weg, und damit sprang die ganze Werkzeugspalte in genau
		// den Zeilen, die man sich ansehen will (Owner: „dass die button spalten konsistent bleiben").
		// Ein ausgegrauter Knopf sagt zudem, WARUM er nicht geht; eine Lücke sagt gar nichts.
		// 💣 ÜBER `AvesmapsEcosystemProperties.open`, NICHT über einen blanken Namen.
		// `openEcosystemPropertiesDialog` ist PRIVAT in seiner Datei (innerhalb der IIFE) -- von hier aus
		// existiert der Name nicht. Ein `typeof … === "function"` davor ist dann für immer falsch, und
		// der Knopf tut still gar nichts: kein Fehler, keine Meldung, nur ein Klick ins Leere.
		// Genau so ausgeliefert am 20.08.2026 und vom Owner gemeldet („das eigenschaftsfenster geht
		// nicht auf"). ⚠️ Und die Prüfseite war grün, weil sie den fehlenden Namen als globale Attrappe
		// selbst erfunden hatte -- eine Probe, die ihren Treffer vorbelegt, beweist nichts.
		const zahnrad = baueWerkzeug("⚙", tr_("ecosystem.stapel.properties", "Eigenschaften"), () => {
			if (!region.first_area_public_id) {
				return;
			}
			const oeffne = window.AvesmapsEcosystemProperties?.open;
			if (typeof oeffne !== "function") {
				sag(tr_("ecosystem.stapel.propertiesUnavailable",
					"Der Eigenschaften-Dialog ist gerade nicht erreichbar."), "warning");
				return;
			}
			void oeffne(region.first_area_public_id);
		});
		if (!region.first_area_public_id) {
			zahnrad.disabled = true;
			zahnrad.title = tr_("ecosystem.stapel.propertiesEmpty",
				"Diese Region hat keine Fläche — der Eigenschaften-Dialog wird über eine Fläche geöffnet.");
		}
		werkzeuge.appendChild(zahnrad);

		const schloss = baueWerkzeug(
			region.is_locked === true ? "🔒" : "🔓",
			region.is_locked === true
				? tr_("ecosystem.stapel.unlock", "entsperren")
				: tr_("ecosystem.stapel.lock", "sperren"),
			async () => {
				await sperre(region.public_id, region.is_locked !== true);
				await ladeEbene(fensterEbene);
			}
		);
		if (region.is_locked === true) {
			schloss.classList.add("ecosystem-stapel__tool--zu");
		}
		werkzeuge.appendChild(schloss);

		// 👁 „Nur diese Region zeigen" (Owner 20.08.2026). Reine Anzeige, kein gespeicherter Zustand --
		// derselbe Knopf noch einmal holt alles zurück.
		const solo = baueWerkzeug(
			"👁",
			isolierteRegion === region.public_id
				? tr_("ecosystem.isolation.off", "Wieder alles zeigen")
				: tr_("ecosystem.isolation.on", "Nur diese Region zeigen"),
			() => schalteIsolation(region.public_id)
		);
		if (isolierteRegion === region.public_id) {
			solo.classList.add("ecosystem-stapel__tool--solo");
		}
		werkzeuge.appendChild(solo);

		// 🗑 Löschen (Owner 20.08.2026, nachdem ihm in der Liste die Regionen OHNE Fläche aufgefallen
		// sind). Als Zerstörer zuletzt -- dieselbe Ordnung wie in jedem Menü dieses Hauses.
		//
		// ⚠️ Der Knopf gilt für ALLE Zeilen, nicht nur die leeren. Eine Region mit zwölf Flächen zu
		// löschen ist ein grosser Eingriff, und genau deshalb steht die Rückfrage davor -- eine Regel
		// „nur wenn leer" wäre bequem und liesse den Fall unerledigt, für den man den Knopf zuerst
		// gebraucht hat: die halb gefüllte Region.
		const loeschen = baueWerkzeug("🗑", tr_("ecosystem.stapel.delete", "Region löschen"),
			() => void loescheRegion(region));
		loeschen.classList.add("ecosystem-stapel__tool--gefahr");
		werkzeuge.appendChild(loeschen);

		zeile.appendChild(werkzeuge);

		const meta = document.createElement("span");
		meta.className = "ecosystem-stapel__meta";
		const teile = [];
		if (region.region_type) {
			teile.push(String(region.region_type));
		}
		const anzahl = Number(region.area_count) || 0;
		teile.push(anzahl === 1 ? "1 Fläche" : `${anzahl} Flächen`);
		meta.textContent = teile.join(" · ");
		zeile.appendChild(meta);

		return zeile;
	}

	function baueWerkzeug(zeichen, titel, aufKlick) {
		const knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "ecosystem-stapel__tool";
		knopf.textContent = zeichen;
		knopf.title = titel;
		knopf.setAttribute("aria-label", titel);
		knopf.addEventListener("click", () => void aufKlick());

		return knopf;
	}

	// Die Bilanzzeile trägt nur, was der Filter bewegt (Vorbild js/review/review-list-balance.js).
	function zeichneBilanz(sichtbar) {
		const zeile = el("ecosystem-stapel-balance");
		if (!zeile) {
			return;
		}
		const gesamt = fensterRegionen.length;
		const gesperrt = fensterRegionen.filter((region) => region.is_locked === true).length;
		const teile = [];
		teile.push(sichtbar === gesamt
			? `${gesamt} ${gesamt === 1 ? "Region" : "Regionen"}`
			: `${sichtbar} von ${gesamt} Regionen`);
		if (gesperrt > 0) {
			teile.push(`${gesperrt} gesperrt`);
		}
		// 🔴 Der Hinweis auf die zwei Gesten steht hier, weil eine Geste, die man kennen muss, für den,
		// der sie nicht kennt, keine ist. Bei aktiver Suche fällt das Ziehen aus dem Satz -- ein
		// Hinweis auf etwas, das gerade nicht geht, ist schlimmer als keiner.
		const gesten = darfZiehen()
			? tr_("ecosystem.stapel.rowHint", "Doppelklick: auf der Karte zeigen · Ziehen: Reihenfolge ändern")
			: tr_("ecosystem.stapel.showHint", "Doppelklick: auf der Karte zeigen");
		zeile.textContent = `${teile.join(" · ")}   ·   oben = vorn   ·   ${gesten}`;
	}

	// ---- Verdrahtung --------------------------------------------------------------------------------

	function verdrahte() {
		registriereMenue();

		el("ecosystem-stapel-close")?.addEventListener("click", schliesseFenster);
		el("ecosystem-stapel-done")?.addEventListener("click", schliesseFenster);
		el("ecosystem-stapel-filter")?.addEventListener("input", zeichneListe);
		el("ecosystem-stapel-open")?.addEventListener("click", () => void oeffneFenster(""));
		// Der Ausweg aus der Isolation, dort wo man den Zustand sieht -- ohne das Fenster zu öffnen.
		el("ecosystem-isolation-off")?.addEventListener("click", () => schalteIsolation(""));
		el("ecosystem-stapel-overlay")?.addEventListener("click", (event) => {
			if (event.target === el("ecosystem-stapel-overlay")) {
				schliesseFenster();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && el("ecosystem-stapel-overlay")?.hidden === false) {
				schliesseFenster();
			}
		});

		zeichneZaehler();
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", verdrahte, { once: true });
		} else {
			verdrahte();
		}
	}

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemStapel = {
			oeffne: oeffneFenster,
			zeichneZaehler,
			// 🔴 MUSS NACH JEDEM NACHLADEN LAUFEN. Der Loader holt beim Schwenken neue Flächen, und die
			// kommen als frische Pfade ohne Markierung in die Pane. Ohne diesen Aufruf zerfiele die
			// Isolation beim ersten Schwenk -- und zwar stückweise, was schlimmer aussieht als gar nicht
			// zu funktionieren.
			wendeIsolationAn,
			// Der Eigenschaften-Dialog meldet hierher, wenn sein Haken gespeichert wurde -- damit der
			// Zähler stimmt, ohne dass dieser Datei ein zweiter Schreibweg gehört.
			merkeSperre: (regionPublicId, gesperrt) => {
				merkeAmBestand(regionPublicId, { is_locked: gesperrt === true });
				zeichneZaehler();
			},
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { EBENEN, avesmapsStapelZielIndex, avesmapsStapelUmsortieren };
	}
})();
