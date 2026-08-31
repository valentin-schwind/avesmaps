
// Initialisierung der Karte 
// Seed the initial view from a persisted edit-mode frame (avesmaps.edit.mapView) so a reload lands on the
// same center + zoom WITHOUT a visible jump. config.js loads before this file, so IS_EDIT_MODE, the storage
// key and MAP_BOUNDS are ready here. Seeding (instead of flying there after load) also sidesteps the entire
// precedence question: everything that navigates on start -- ?s= share links, wiki deep-links, ?place=,
// ?route=, spotlight focus -- runs AFTER map creation and overrides this seed exactly as it overrides the
// hardcoded default. Not edit mode, no stored frame, or a corrupt / out-of-bounds one -> the default, quietly.
// The default frame is the "Aventurien" continent label, and it must stay BIT-IDENTICAL to what the search
// does: picking "Aventurien" in the spotlight runs focusSpotlightLabel -> flyTo(label marker, zoom band cap)
// = [497.28, 520.5] @ 3 (measured off the live click on 2026-08-05). Owner 2026-08-05, after seeing the
// start view drift 175px away from that: "vergleich mal die jetzige map mitte mit dem zustand, wenn ich auf
// Aventurien klicke -- eigentlich will ich genau das".
// 💣 So do NOT re-introduce an optical offset here. Half a route-planner width to the west looks better
// centred in the map area #search leaves free -- but then arriving on the site and searching for the
// continent put the map in two different places, and that difference is what got noticed. If the offset
// is ever wanted, it belongs in spotlightFlyTo (both paths at once), not in this seed alone.
// 💣 THE ZOOM IS A COPY OF THE LABEL'S ZOOM BAND, and the only one that cannot follow it by itself: the
// search reads max_zoom off the loaded label (min(max_zoom, VISUAL_MAX_ZOOM_LEVEL)), while this seed runs
// before a single feature is fetched. The band was 0..2 and the owner widened it to 0..3 on 2026-08-05 --
// at which point the search flew to 3 and only the start view stayed on 2. Whoever moves "Sichtbar bis
// Zoom" on the continent label again moves this line with it, or the two drift apart silently.
const AVESMAPS_DEFAULT_MAP_CENTER = [497.28, 520.5]; // [lat, lng] = [y, x], the label's map_features row
const AVESMAPS_DEFAULT_MAP_ZOOM = 3;
/**
 * Am Telefon eine Stufe weiter heraus (Owner 12.08.2026: „kannst du die standardzoomstufe für mobil
 * geräte eins runtersetzen? dann sieht man bisschen mehr"). Auf einem Schirm von 375px zeigt Zoom 3
 * einen Ausschnitt, der am Zeiger dreimal so breit ist -- dieselbe Zahl bedeutet dort schlicht
 * weniger Karte.
 * ⚠️ DAMIT WEICHT DER START AM TELEFON BEWUSST VON DER SUCHE AB. Der Absatz darüber haelt fest,
 * warum beide bisher gleich waren: wer ankommt und dann „Aventurien" sucht, landete sonst an zwei
 * verschiedenen Stellen, und genau das war 2026-08-05 die Meldung. Am Telefon fliegt die Suche
 * weiterhin auf 3, dieser Start auf 2 -- der Unterschied ist eine Zoomstufe auf demselben
 * Mittelpunkt, nicht ein anderer Ort. Wer die Meldung wiederkommen sieht, dreht ZUERST hier zurueck.
 * ⚠️ avesmapsIsPhoneViewport() steht in js/app/runtime-state.js und ist hier verfuegbar: index.html
 * laedt sie lange vor bootstrap.js. Der typeof-Riegel faengt trotzdem den Fall, dass jemand die
 * Reihenfolge aendert -- dann gilt der Zeiger-Wert, und das ist der harmlosere Ausgang.
 */
function avesmapsDefaultMapZoom() {
    const istTelefon = typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport();
    return istTelefon ? Math.max(0, AVESMAPS_DEFAULT_MAP_ZOOM - 1) : AVESMAPS_DEFAULT_MAP_ZOOM;
}
function getInitialEditMapView() {
    if (!IS_EDIT_MODE) {
        return { center: AVESMAPS_DEFAULT_MAP_CENTER, zoom: avesmapsDefaultMapZoom() };
    }
    try {
        const raw = window.localStorage?.getItem(EDIT_MODE_MAP_VIEW_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const lat = Number(parsed?.lat);
            const lng = Number(parsed?.lng);
            const zoom = Number(parsed?.zoom);
            const centerOk = Number.isFinite(lat) && Number.isFinite(lng)
                && L.latLngBounds(MAP_BOUNDS).contains([lat, lng]);
            const zoomOk = Number.isFinite(zoom) && zoom >= 0 && zoom <= 7; // maxZoom is 7 (see the L.map options below)
            if (centerOk && zoomOk) {
                return { center: [lat, lng], zoom };
            }
        }
    } catch (error) {
        // Corrupt JSON or blocked storage -> fall through to the default, no console noise.
    }
    // ⚠️ Derselbe Rueckfall wie im Frontend, inklusive der Telefon-Stufe: der Editor hat sonst beim
    // allerersten Aufruf (noch kein gespeicherter Ausschnitt) einen anderen Start als die Karte
    // daneben -- ein Unterschied, den niemand erklaeren koennte.
    return { center: AVESMAPS_DEFAULT_MAP_CENTER, zoom: avesmapsDefaultMapZoom() };
}
/**
 * Ein geteilter `?pin=`-Link SÄT seinen Punkt als Startansicht -- die Karte geht dort auf, statt
 * später hinzuspringen (Owner 24.08.2026: „pin setzt übrigens ein pin aber fliegt nicht hin").
 *
 * 🪤 Gesprungen wurde durchaus, nur zu spät und unsichtbar: `focusMapOnActiveTargets()` zentriert
 * den Pin schon immer -- aber erst im `.then()` des Karten-Abrufs, und der lädt rund 20 MB. Bis
 * dahin steht die Startansicht, und wer den Link öffnet und hinsieht, sieht den Kontinent. Genau
 * dieselbe Überlegung steht oben schon für den Editor-Ausschnitt: säen statt hinfliegen.
 *
 * 💣 DIE ZOOMSTUFE IST MIT `focusMapOnActiveTargets()` GEKOPPELT (map-features.js): jenes rechnet
 * `max(map.getZoom(), DEFAULT_SHARE_PIN_ZOOM)` und läuft nach dem Abruf über dieselbe Lage. Weil
 * hier schon mindestens `DEFAULT_SHARE_PIN_ZOOM` steht, ist sein Aufruf dann ein No-op -- die Karte
 * ruckt nicht nach. Wer eine der beiden Zahlen ändert, ändert die andere mit, sonst kommt der
 * Sprung zurück, den diese Funktion beseitigt.
 *
 * ⚠️ Nur der direkte `?pin=`-Parameter. Ein `?s=`-Kurzlink löst seine Parameter erst später
 * asynchron auf; dort bleibt es beim bisherigen Weg über `focusMapOnActiveTargets()`.
 *
 * 🪤 Diese Datei musste ein zweites Mal angefasst werden, um überhaupt live zu gehen: der Deploy
 * ihres ersten Commits (`c8238381`) wurde 60 Sekunden später von einem fremden Push ABGEBROCHEN,
 * und der nachfolgende Lauf lädt nur SEINE geänderten Dateien hoch (`git diff before..sha`).
 * Ergebnis: der Commit stand in `master`, die Datei auf dem Server war die alte, und `index.html`
 * forderte weiterhin deren alten `?v=`-Stempel an -- ein in sich stimmiger, aber veralteter Stand,
 * an dem kein Test und keine SHA-Prüfung etwas gemerkt hätte. Nur eine INHALTSÄNDERUNG heilt das
 * (AGENTS.md §9). Gemessen wurde es am ausgelieferten Stempel, nicht am Repo.
 */
function avesmapsInitialViewFromSharePin() {
    try {
        const searchParams = typeof window.avesmapsSearchParams === "function"
            ? window.avesmapsSearchParams()
            : new URLSearchParams(window.location.search);
        const pinLatLng = typeof readSharePinFromUrl === "function" ? readSharePinFromUrl(searchParams) : null;
        if (!pinLatLng) {
            return null;
        }
        return {
            center: [pinLatLng.lat, pinLatLng.lng],
            zoom: Math.max(avesmapsDefaultMapZoom(), DEFAULT_SHARE_PIN_ZOOM),
        };
    } catch (error) {
        // Kaputter Parameter, fehlende Vorbedingung -> die normale Startansicht, ohne Konsolenlärm.
        return null;
    }
}
// 🔴 Der Pin schlägt den gespeicherten Editor-Ausschnitt: er steht ausdrücklich in der Adresse,
// der Ausschnitt ist nur der letzte Stand.
const avesmapsInitialMapView = avesmapsInitialViewFromSharePin() || getInitialEditMapView();

const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: 0,
    // One level above the native tile zoom (z5, see maxNativeZoom) so the route fit can zoom in far
    // enough to let short routes fill the frame. Tiles above z5 are upscaled (slightly softer).
    maxZoom: 7,
    bounds: MAP_BOUNDS,
    continuousWorld: false,
    noWrap: true,
    zoomControl: false,
}).setView(avesmapsInitialMapView.center, avesmapsInitialMapView.zoom);

// Rendering-Reihenfolge
map.createPane("regionsPane");
map.createPane("ecosystemPane");
map.createPane("ecosystemPaneDerographisch");
map.createPane("ecosystemPaneVegetation");
map.createPane("ecosystemPaneTopographie");
// 💣 DIESE ZWEI ZEILEN SIND PFLICHT, NICHT KOSMETIK. `getPane` weiter unten LEGT NICHTS AN -- es liefert
// `undefined` fuer eine Pane, die hier fehlt, und das folgende `.style.zIndex` wirft. bootstrap.js ist
// ein flaches Skript ohne try/catch, also ist ab dieser Zeile ALLES tot: Zoom-Control, setMaxBounds,
// die Zoom-Handler -- und der Editor. Am 2026-08-03 genau so passiert; das gemeldete Symptom war „das
// Editorpanel ist verschwunden", also fuenfzig Zeilen weiter unten. Bewacht von
// js/app/__tests__/bootstrap-panes.test.js.
map.createPane("ecosystemPaneKlima");
map.createPane("ecosystemPaneKlimaLines");
map.createPane("mapDecorationsPane");
map.createPane("roadsOutlinePane");
map.createPane("roadsPane");
map.createPane("powerlinesPane");
map.createPane("routeOutlinePane");
map.createPane("routePane");
map.createPane("measurementPane");
map.createPane("measurementHandlesPane");
map.createPane("regionLabelsPane");
map.createPane("locationsPane");
map.createPane("labelsPane");
map.createPane("sharePinPane");

map.getPane("regionsPane").style.zIndex = 200;
// Landschaften (Erprobung): eigene Pane, ueber den politischen Fuellungen (regionsPane 200) und unter
// der Schraffur (300) / den Grenzen (350) / den Labels (475). 201-299 ist sonst unbelegt -- geprueft.
map.getPane("ecosystemPane").style.zIndex = 250;
// V3.0: EINE Pane je `kind`, nicht eine Layergruppe je `kind` in der Pane oben. Alle drei Ebenen sind
// gleichzeitig sichtbar; nur die aktive nimmt Klicks -- und `pointer-events` ist eine Eigenschaft der
// PANE, nicht des Layers. Mit einer gemeinsamen Pane liesse sich "aktiv voll, ruhend blass UND
// klickdurchlaessig" nur ueber ein Neuaufbauen aller Layer bei jedem Umschalten loesen.
// ecosystemPane (250) bleibt als reservierter Bandanfang aus V1.3 bestehen und traegt selbst nichts.
// 🔴 DIE REIHENFOLGE IST EINE OWNER-ENTSCHEIDUNG (27.08.2026), von oben nach unten:
//     Beschriftungen (labelsPane, 650)  >  Derographie  >  Vegetation  >  Topographie
// Sie stand bis dahin genau andersherum. Der Grund für die Umkehr ist die Hervorhebung: ein Klick
// auf ein Label hebt seine Fläche hervor, und ein hervorgehobener BEHÄLTER (Kontinent, Provinz)
// muss über den Landschaften liegen, sonst liegt seine Füllung unter zwei weiteren und ist keine
// Antwort mehr.
// 💣 Die Reihenfolge entscheidet auch, WELCHE Fläche einen Klick bekommt -- die oberste. Deshalb
// ist die Derographie in „Alle" klickdurchlässig gestellt (css/features/ecosystem-layer.css):
// oben liegen, ohne die Klicks der Landschaften darunter abzufangen. Wer die Zahlen hier ändert,
// prüft jene Regel mit.
map.getPane("ecosystemPaneDerographisch").style.zIndex = 252;
map.getPane("ecosystemPaneVegetation").style.zIndex = 251;
map.getPane("ecosystemPaneTopographie").style.zIndex = 250;
// V-Klima (2026-08-03): die Baender liegen UEBER den drei gezeichneten Ebenen -- sie decken die Karte
// in voller Breite, unter Vegetation und Topographie waeren sie nicht zu sehen. Ihre Fuellung ist dafuer
// sehr leicht (css/features/ecosystem-layer.css).
map.getPane("ecosystemPaneKlima").style.zIndex = 253;
// Die Trennlinien und die Zonennamen. EIGENE Pane, und zwar aus zwei Gruenden: sie duerfen die
// Zustandsklassen der ecosystem-panes (blass/ruhend) NICHT tragen -- sie sind Bedienelemente, keine
// Daten --, und sie muessen ueber den Wegen liegen (400) und der Route (450), sonst zieht man eine
// Linie, die unter einer Reichsstrasse verschwindet.
map.getPane("ecosystemPaneKlimaLines").style.zIndex = 455;
// Beide Klassen sind tragend: `ecosystem-pane` traegt den gemeinsamen Zustand, der `--<kind>`-Modifier
// die Deckkraft-Matrix (Owner 2026-07-26 -- derographische Flaechen fuellen anders als Vegetation und
// Topographie). Siehe css/features/ecosystem-layer.css.
[["ecosystemPaneDerographisch", "derographisch"], ["ecosystemPaneVegetation", "vegetation"],
    ["ecosystemPaneTopographie", "topographie"], ["ecosystemPaneKlima", "klima"]]
    .forEach(([paneName, kind]) => {
        map.getPane(paneName).classList.add("ecosystem-pane", `ecosystem-pane--${kind}`);
    });
map.getPane("mapDecorationsPane").style.zIndex = 480;
map.getPane("roadsOutlinePane").style.zIndex = 350;
map.getPane("roadsPane").style.zIndex = 400;
map.getPane("powerlinesPane").style.zIndex = 430;
map.getPane("routeOutlinePane").style.zIndex = 445; // white casing, just below the route line
map.getPane("routePane").style.zIndex = 450;
map.getPane("measurementPane").style.zIndex = 460;
map.getPane("measurementHandlesPane").style.zIndex = 520;
map.getPane("regionLabelsPane").style.zIndex = 475;
map.getPane("regionLabelsPane").classList.add("region-labels-pane");
map.getPane("locationsPane").style.zIndex = 500;
map.getPane("labelsPane").style.zIndex = 650;
map.getPane("labelsPane").classList.add("map-labels-pane");

// 🔴 UEBERBLENDUNG FUER DIE SIEDLUNGS- UND LANDSCHAFTSLABELS (Owner 24.08.2026: „mach den rest auch
// so ... Flusslabels, Wegelabels, Siedlungslabels, Landschaftslabels“). Die ersten beiden liegen auf
// Canvas und haben ihre zwei Flaechen schon; diese hier sind DOM-Marker mit gerenderten Bild-Icons
// und lassen sich nicht „tauschen“.
//
// 💣 GENAU EINE EIGENSCHAFT MACHT ES TROTZDEM EINFACH: die Label-Panes tragen KEINE eigene
// Transform. Der Zoom haengt am `_mapPane`, und die Panes sind dessen Kinder. Ein KLON des Panes,
// als Geschwister danebengelegt, skaliert deshalb waehrend der Zoom-Animation gratis mit -- ohne
// dass irgendetwas nachgerechnet oder synchron gehalten werden muesste. Der Klon haelt das alte
// Schriftbild, waehrend das echte Pane neu bestueckt wird; danach blenden beide gegeneinander.
//
// ⚠️ NUR `labelsPane`. `regionLabelsPane` (Territoriumsnamen in der politischen Ansicht) bleibt bei
// der CSS-Blende -- der Owner hat sie ausdruecklich als richtig bezeichnet, und sie stand nicht auf
// seiner Liste.
(function ueberblendungDerLabelPane() {
	const AN = (() => {
		try { return new URLSearchParams(window.location.search).get("crossfade") !== "0"; }
		catch (e) { return true; }
	})();
	if (!AN) { return; }   // ?crossfade=0 -> die CSS-Blende von frueher, erst aus, dann ein
	const pane = map.getPane("labelsPane");
	if (!pane || !pane.parentNode) { return; }
	// 🔴 EINE Kurve, EINE Dauer -- aus js/map-features/zoom-uebergang.js. Hier stand bis zum
	// 26.08.2026 eine eigene 350, und sie war die letzte Blendendauer ohne Anschluss an die
	// gemeinsame Kurve (docs/kartenflaechen-und-zoomblenden.md §7).
	const DAUER_MS = AVESMAPS_ZOOM_DAUER_MS;
	// 🔴 Owner 26.08.2026, woertlich: „koennen wir die stadtlabels nicht ausblenden im moment wo der
	// zoom beginnt (nicht erst danach)". Ja -- das AUSblenden geht ab t = 0, und genau das tut der
	// zoomanim-Handler unten.
	// ⚠️ NUR DAS AUSBLENDEN. Das EINblenden der neuen Namen kann NICHT mitwandern: Leaflet setzt
	// seinen internen Zustand direkt nach dem zoomanim-Ereignis auf die Zielstufe
	// (docs/kartenflaechen-und-zoomblenden.md §8a), und ein Leaflet-Marker setzt beim `setIcon`
	// seine Position ueber genau diese Projektion neu -- waehrend das Pane die
	// Quelle-auf-Ziel-Transform seines Elternteils traegt. Die neuen Namen wuerden doppelt
	// transformiert, derselbe Fehler, der am 26.08.2026 die Marker-Gegenrechnung gekostet hat.
	// Dafuer braeuchte es ein ZWEITES, gegengerechnetes Pane -- ein Umbau, keine Stellschraube.
	// ⭐ ?labelparallel=0 stellt den Stand von vorher her: der Klon bleibt waehrend des ganzen Zooms
	// stehen und blendet erst danach. Damit laesst sich am Bild vergleichen, ohne etwas hochzuladen.
	const AUSBLENDEN_AB_ZOOMSTART = (() => {
		try { return new URLSearchParams(window.location.search).get("labelparallel") !== "0"; }
		catch (e) { return true; }
	})();
	let klon = null;
	let aufraeumer = null;

	function klonWeg() {
		if (aufraeumer) { clearTimeout(aufraeumer); aufraeumer = null; }
		if (klon && klon.parentNode) { klon.parentNode.removeChild(klon); }
		klon = null;
	}

	map.on("zoomanim", (ereignis) => {
		klonWeg();   // 💣 immer nur EIN Klon -- zwei uebereinander waeren doppelte Schrift
		klon = pane.cloneNode(true);
		klon.classList.remove("map-labels-pane");   // sonst greift die CSS-Blende auch auf ihm
		klon.style.pointerEvents = "none";          // rein bildlich, faengt keine Klicks
		klon.style.transition = "";
		klon.style.opacity = "1";
		pane.parentNode.insertBefore(klon, pane);   // unter dem echten Pane -> neue Schrift kommt darueber
		// 💣 HART AUF 0, NICHT UEBERBLENDET -- die Ursache der doppelten Schrift vom 26.08.2026.
		// `style.transition = ""` heisst NICHT „kein Uebergang", sondern „nimm wieder die
		// CSS-Regel" -- und die steht seit der Vereinheitlichung auf der vollen Zoomdauer
		// (vorher 100 ms, weshalb es jahrelang niemand sah). Das Pane blendete dadurch im
		// GLEICHSCHRITT mit dem Klon, und weil Leaflet seine Marker im zoomanim schon auf die
		// ZIELpositionen setzt (§8a), zeigten beide dieselben Namen an zwei Stellen: eines
		// stabil, eines driftend. Vom Owner per Messprotokoll belegt (Klon 1.00 | Pane 1.00).
		// ⚠️ Der erzwungene Zwischenstand ist tragend, sonst fasst der Browser Setzen und
		// Ruecknahme zusammen und `none` wirkt nicht.
		pane.style.transition = "none";
		pane.style.opacity = "0";                   // unsichtbar, aber der Klon zeigt dasselbe Bild
		void pane.offsetWidth;
		pane.style.transition = "";

		// 🔴 UND HIER BEGINNT DAS AUSBLENDEN -- bei t = 0, nicht erst nach dem Zoom.
		// 🔴 UND DER KLON SKALIERT DABEI MIT. Owner 26.08.2026: „es wird das ausgeblendet, was
		// nicht auf der KARTE stabil war, sondern im screen" -- die ausblendende Schrift stand
		// still, waehrend die Karte unter ihr skalierte.
		// 💣 HIER STAND „skaliert gratis mit (er ist ein Kind des _mapPane)". DAS IST FALSCH und
		// am 26.08.2026 nachgemessen: `_mapPane` traegt waehrend des Zooms `translate3d(0,0,0)`,
		// es skaliert ueberhaupt nicht. Leaflet zoomt ueber einen leaflet-proxy und ueber die
		// Transform der einzelnen `leaflet-zoom-animated`-Ebenen -- ein Pane traegt die Klasse
		// nicht und bekommt nichts davon ab. Genau deshalb hiess es frueher „ortslabels ziehen
		// ueberhaupt nicht nach": sie taten es nie.
		if (AUSBLENDEN_AB_ZOOMSTART) {
			// 💣 OHNE ERZWUNGENEN ZWISCHENSTAND GIBT ES KEINEN UEBERGANG: der Browser fasst
			// „opacity 1" und „opacity 0" im selben Tick zusammen, und der Klon verschwindet HART.
			void klon.offsetWidth;
			// 💣 TRANSFORM UND DECKKRAFT IN EINER DEKLARATION -- `transition` ist EINE Eigenschaft,
			// zwei Zuweisungen loeschen einander aus und eines von beidem spraenge hart.
			klon.style.transition = avesmapsZoomTransition("transform")
				+ `, opacity ${AVESMAPS_ZOOM_DAUER_MS}ms ${AVESMAPS_ZOOM_KURVE}`;
			// 💣 `transform-origin: 0 0`, sonst skaliert der Klon um seine MITTE. Leaflet setzt das
			// sonst ueber die Klasse `leaflet-zoom-animated`, die ein Pane nicht traegt.
			klon.style.transformOrigin = "0 0";
			// ⚠️ Bezugspunkt ist der URSPRUNG des Layer-Koordinatensystems: die Kinder des Klons
			// stehen in Layer-Punkten der QUELLstufe, und nur ueber deren Nullpunkt stimmt die
			// Abbildung auf die Zielstufe.
			// 🔴 Fehlt Leaflets interne Methode (kuenftige Version), bleibt es beim reinen
			// Ausblenden statt falsch zu verschieben -- die sichere Richtung.
			if (ereignis && typeof map._latLngToNewLayerPoint === "function") {
				const massstab = map.getZoomScale(ereignis.zoom);
				const versatz = map._latLngToNewLayerPoint(
					map.layerPointToLatLng([0, 0]), ereignis.zoom, ereignis.center);
				L.DomUtil.setTransform(klon, versatz, massstab);
			}
			klon.style.opacity = "0";
		}
		// 💣 HARTES NETZ, SCHON HIER GESPANNT. Die Blende unten haengt an requestAnimationFrame; feuert
		// das nie (angehaltene Darstellung), bliebe der Klon fuer immer stehen -- doppelte Schrift auf
		// der Karte. Nach 2 s verschwindet er in jedem Fall.
		// ⚠️ Das Netz waechst mit der Zoomdauer: unter ?zoomlupe feuerte eine feste 2000 mitten in
		// die laufende Bewegung und machte das Pane sichtbar, waehrend der Klon noch stand.
		aufraeumer = setTimeout(() => { pane.style.opacity = "1"; klonWeg(); }, AVESMAPS_ZOOM_DAUER_MS + 1750);
	});

	map.on("zoomend", () => {
		if (!klon) { return; }
		// 💣 Zwei Bilder warten, wie bei den Canvas-Ebenen: am zoomend blockiert der Hauptthread
		// 215-836 ms (live gemessen). Ein dort gestarteter Uebergang verstreicht, ohne dass ein Bild
		// davon gezeichnet wird, und sieht aus wie ein Sprung.
		requestAnimationFrame(() => requestAnimationFrame(() => {
			if (aufraeumer) { clearTimeout(aufraeumer); }
			// 💣 DER KLON MUSS WEG, BEVOR DAS ECHTE PANE EINBLENDET -- die Reparatur der doppelten
			// Schrift vom 26.08.2026 (Owner, per Aufzeichnung belegt: „AVENTURIEN" zweimal, senkrecht
			// versetzt). Er hat seine Blende beim ZOOMSTART bekommen; laeuft sie dort noch
			// (verzoegerter Start durch Hauptthread-Last), ueberlappt sein Rest mit der neuen Schrift.
			// Und weil er die ALTE Beschriftungslage haelt und das Pane die NEUE, sieht man beide.
			// ⚠️ Nur im parallelen Pfad. Bei ?labelparallel=0 IST die Ueberblendung das Gewollte --
			// dort faengt das Ausblenden ja erst jetzt an.
			if (AUSBLENDEN_AB_ZOOMSTART) { klonWeg(); }
			pane.style.transition = `opacity ${DAUER_MS}ms ${AVESMAPS_ZOOM_KURVE}`;
			pane.style.opacity = "1";
			if (klon) {
				// ⚠️ Bei AUSBLENDEN_AB_ZOOMSTART ist der Klon hier laengst auf 0 -- die Zuweisung
				// kostet dann nichts. Sie bleibt stehen, weil ?labelparallel=0 genau diesen Pfad
				// braucht: dort faengt das Ausblenden erst jetzt an.
				klon.style.transition = `opacity ${DAUER_MS}ms ${AVESMAPS_ZOOM_KURVE}`;
				klon.style.opacity = "0";
			}
			aufraeumer = setTimeout(klonWeg, DAUER_MS + 250);
		}));
	});
})();
// 🔴 Owner-Befund 15.08.2026 (fuenfter Befund, per Bildschirmabzug gemeldet): die gesetzte
// Markierung (setSharePin, map-features-share-pin.js) landete ohne eigene `pane`-Angabe in
// Leaflets STANDARD-`markerPane` (600) -- UNTER labelsPane (650). Das Faehnchen verschwand halb
// hinter Kartenlabeln wie „AVENTURIEN". War schon immer so; aufgefallen ist es erst, seit die
// Markierung durch die Verschmelzung (Aufgabe 4) die Hauptsache auf der Karte ist.
// Geprueft (nicht angenommen): `sharePinPane` ist die EINZIGE Stelle im Haus, die je einen
// L.marker() OHNE eigene pane-Angabe erzeugte -- jeder andere Marker-Aufruf (Wegpunkte,
// Ortschaften, Bearbeitungsgriffe, Regions-Tooltip-Klon, …) nennt seine Pane explizit. Die
// Markierung war also das einzige Kind von markerPane; kein fremder Layer wandert mit dieser
// Aenderung um.
// ⚠️ DIE ZAHL: 700, ueber labelsPane (650, der Anlass dieses Fixes) und unter tooltipPane (875)
// UND popupPane (900) -- die Markierung darf einen Hover-Tooltip oder ein offenes Popup nicht
// verdecken, beide sind vorrangig vor einem Kartenobjekt. 700 liegt mittig im freien Band
// zwischen 650 und 875 (150 Abstand nach unten, 175 nach oben) -- derselbe Grosszuegigkeits-Stil
// wie bei den Nachbar-Panes oben (z. B. ecosystemPaneKlimaLines bei 455, mit Luft zu routePane
// 450 und measurementPane 460).
// ⚠️ KEIN eigenes `pointer-events` noetig: weder labelsPane noch locationsPane noch tooltipPane
// noch popupPane setzen das auf PANE-Ebene (geprueft in css/) -- nur die ecosystem-Editier-Panes
// tun das, aus Gruenden, die hier nicht gelten. Die Markierung ist heute schon zieh- und
// anklickbar (Owner-Messtabelle), rein ueber die Marker-eigenen Optionen (draggable, keyboard);
// eine neue Pane ohne Sperre aendert daran nichts.
map.getPane("sharePinPane").style.zIndex = 700;
map.getPane("tooltipPane").style.zIndex = 875;
map.getPane("popupPane").style.zIndex = 900;

initializeMapDecorations();
const avesmapsZoomControl = L.control.zoom({ position: "topright" }).addTo(map);
// Die Zoomstufe (Fall #100) -- nur im Editormodus, und IN den Behaelter der +/- Knoepfe gehaengt,
// nicht als Control daneben: im Editormodus reisst infopanel.css die Knoepfe per `position: fixed`
// aus Leaflets Ecke und legt sie unten rechts ab. Als Kind folgt die Zahl dieser Verlegung von
// selbst; als Nachbar bliebe sie oben stehen (gemessen 25.08.2026: 967px Abstand). Begruendung im
// Kopf von js/ui/zoomstufe-anzeige.js.
if (IS_EDIT_MODE) {
    avesmapsZoomstufeAnhaengen(map, avesmapsZoomControl.getContainer());
}
map.setMaxBounds(MAP_BOUNDS);

// Die Suchkachel im Knopfbund an der Karte. Sichtbar ist sie nur am groben Zeiger
// (css/components/legal-dialog.css) -- dort, wo der Zoom raeumt und wo es sonst keinen sichtbaren
// Weg in die Suche gibt: sie haengt ansonsten am Tastenkuerzel und am Langdruck-Kontextmenue.
// ⚠️ Sie oeffnet die VORHANDENE Spotlight-Suche. Kein zweites Feld daneben -- das waere eine zweite
// Trefferlogik ueber demselben Bestand.
(function wireMapSearchButton() {
    const button = document.getElementById("map-search-button");
    if (!button) {
        return;
    }
    button.addEventListener("click", () => {
        if (typeof openSpotlightSearch === "function") {
            openSpotlightSearch();
        }
    });
})();

map.on("zoomend", () => {
    const zoom = map.getZoom();
    const size = 9 + zoom * 3;

    document.querySelectorAll(".region-label").forEach(e => {
        e.style.fontSize = size + "px";
    });
    syncLabelIcons();
    syncPathRendering();
    syncPathLabels();
    syncPowerlineLabels();
    schedulePoliticalTerritoryLayerReload();
});
map.attributionControl.setPrefix(false);
map.on("moveend", () => {
    syncLocationMarkerVisibility();
    syncLabelVisibility();
    schedulePoliticalTerritoryLayerReload();
});

// Persist the edit-mode map view (center + zoom) so a reload restores the same frame (read back by
// getInitialEditMapView above). Throttled ~400ms, mirroring syncPlannerStateToUrl; wired only in edit
// mode. NaN-guarded before every write: a NaN pan once crashed the routing path, so a non-finite center
// or zoom must never reach storage. The address bar is intentionally untouched -- this is storage only.
let avesmapsMapViewPersistTimer = null;
function persistEditMapView() {
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !Number.isFinite(zoom)) {
        return;
    }
    try {
        window.localStorage?.setItem(
            EDIT_MODE_MAP_VIEW_STORAGE_KEY,
            JSON.stringify({ lat: center.lat, lng: center.lng, zoom })
        );
    } catch (error) {
        // storage blocked/full -> the view simply won't persist this time.
    }
}
function scheduleEditMapViewPersist() {
    if (avesmapsMapViewPersistTimer) {
        window.clearTimeout(avesmapsMapViewPersistTimer);
    }
    avesmapsMapViewPersistTimer = window.setTimeout(persistEditMapView, 400);
}
if (IS_EDIT_MODE) {
    map.on("moveend", scheduleEditMapViewPersist);
    map.on("zoomend", scheduleEditMapViewPersist);
}
map.on("click", () => {
    closeRegionCompactTooltip();
    if (IS_EDIT_MODE && !pendingRegionOperation && !pendingRegionMoveState) {
        clearRegionGeometryEdit();
    }
});

// Keep marker/label/region infoboxes readable at the image edge. Leaflet's popup autoPan pans the
// map to reveal a popup that would otherwise open off-screen, but setMaxBounds() binds
// _panInsideMaxBounds to every moveend, which snaps the map back inside the image bounds and thereby
// cancels that autoPan -- the popup visibly slides up, then the map slides back down and hides it.
// autoPan pans by an offset that fits inside the viewport, so Leaflet applies it *animated*: its
// moveend (which would clamp back) fires only after this popupopen handler has run. So while a popup
// is open we drop maxBounds -> the autoPan is no longer reverted, and we restore the bound as soon
// as the user moves the map themselves (their move then clamps back naturally) or the popup closes.
// 💣 WEITE GRENZEN, NIEMALS `null`. `setMaxBounds()` ist die EINZIGE Stelle, die Leaflets moveend-
// Listener `_panInsideMaxBounds` an- und abhaengt -- wer `options.maxBounds` direkt nullt, laesst den
// Listener stehen. Der laeuft dann in `panInsideBounds(null)`, und dort faengt ihn nichts:
// `toLatLngBounds(null)` liefert ein LEERES, aber truthy `LatLngBounds` (der Konstruktor steigt bei
// falsy Argument aus, ohne `_southWest`/`_northEast` zu setzen), der Guard `if (!bounds)` in
// `_limitCenter` laesst es durch, und `_getBoundsOffset` projiziert `getNorthEast()` -> `undefined.lng`.
// Genau das stand hier vom 07.07. bis 25.08.2026 und warf bei JEDEM Popup-autoPan
// "Cannot read properties of undefined (reading 'lng')".
// ⚠️ Die Konsolenzeile war dabei der harmlose Teil: Leaflets `fire()` hat kein try/catch, die
// Listener-Kette bricht am Werfer ab. `_panInsideMaxBounds` steht an Position 3 von 12 -- live
// gemessen fielen die NEUN dahinter aus, darunter das Kachel-Nachladen (`TileLayer._onMoveEnd`),
// `syncLocationMarkerVisibility`/`syncLabelVisibility`/`schedulePoliticalTerritoryLayerReload`,
// `syncPathViewportCulling` und die `redraw`s der Overlays. Der Handler wirkte also nur, WEIL die
// Exception den Clamp abbrach.
// ⭐ Weite Grenzen leisten dasselbe ohne Wurf: `_getBoundsOffset` rechnet daraus einen Versatz von 0
// (`_rebound` gibt bei beidseitig negativem Ergebnis 0), `panInsideBounds` pannt nicht, und der
// Listener bleibt an seiner Stelle in der Kette. Die Box muss MAP_BOUNDS (0..1024) weit umschliessen --
// eine knappe Box waere wieder ein Clamp und naehme den autoPan zurueck.
const POPUP_CLAMP_DISABLED_BOUNDS = L.latLngBounds([-1e6, -1e6], [1e6, 1e6]);
function keepPopupReadableDespiteMaxBounds(event) {
    const popup = event.popup;
    if (!popup || !popup.options || popup.options.autoPan === false) {
        return;
    }
    const savedMaxBounds = map.options.maxBounds;
    if (!savedMaxBounds) {
        return;
    }
    map.options.maxBounds = POPUP_CLAMP_DISABLED_BOUNDS;

    const detach = () => {
        map.off("dragstart", onUserMove);
        map.off("zoomstart", onUserMove);
        map.off("popupclose", onPopupClose);
    };
    const onUserMove = () => {
        map.options.maxBounds = savedMaxBounds;
        detach();
    };
    const onPopupClose = (closeEvent) => {
        if (closeEvent.popup !== popup) {
            return;
        }
        map.options.maxBounds = savedMaxBounds;
        map.panInsideBounds(savedMaxBounds, { animate: true });
        detach();
    };
    map.on("dragstart", onUserMove);
    map.on("zoomstart", onUserMove);
    map.on("popupclose", onPopupClose);
}
map.on("popupopen", keepPopupReadableDespiteMaxBounds);

// Multi-source system: popups/infoboxes render their sources synchronously from the map-features
// payload (renderFeatureSourceLine in js/ui/popups.js), so no popupopen/tooltipopen wiring is needed.

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        ensurePowerlineAnimationLoop();
        return;
    }
    stopPowerlineAnimationLoop();
});

function createBaseTileLayer(mapStyle) {
    const tileStyle = MAP_TILE_STYLES[mapStyle] || MAP_TILE_STYLES.stylized;
    const baseLayer = L.tileLayer(tileStyle.url, {
        tileSize: TILE_SIZE,
        maxNativeZoom: tileStyle.maxNativeZoom ?? 5,
        noWrap: true,
        // ⚠️ Der Platzhalter liegt in `img/`, NICHT in `tiles/`: der Deploy hat `paths-ignore: tiles/**`
        // und traegt `tiles` nicht in seiner Allowlist -- die Datei lag ab 17.05.2026 im Repo und kam nie
        // auf den Server. Jede fehlgeschlagene Kachel erzeugte damit einen ZWEITEN Fehler (404) statt
        // eines Platzhalters.
        errorTileUrl: "img/tile-loading.jpg",
        bounds: MAP_BOUNDS,
        continuousWorld: false,
        // Tile smoothness: do not fetch new tiles DURING the zoom animation (the existing tiles scale and
        // sharpen at zoomend) -> smoother zoom; keep a wider ring of tiles around the viewport so panning
        // back does not refetch. Targets perceived zoom/pan sluggishness; the vector pipeline is untouched.
        updateWhenZooming: false,
        keepBuffer: 4,
    });
    if (window.AvesmapsLoadingBar) {
        window.AvesmapsLoadingBar.attachTiles(baseLayer);
    }
    return baseLayer;
}

function getInitialMapStyle() {
    const queryStyle = INITIAL_SEARCH_PARAMS.get("mapstyle");
    if (queryStyle && MAP_TILE_STYLES[queryStyle]) {
        return queryStyle;
    }

    if (!IS_EDIT_MODE) {
        return "stylized";
    }

    try {
        const storedStyle = window.localStorage?.getItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY);
        if (storedStyle && MAP_TILE_STYLES[storedStyle]) {
            return storedStyle;
        }
    } catch (error) {
        console.warn("Mapstyle konnte nicht wiederhergestellt werden:", error);
    }

    return "stylized";
}

// NOTE: js/ui/route-planner-toggle.js (loaded later) intentionally wraps window.setMapStyle as
// setMapStyleWithBlankOption to add the "none" blank-background map style, delegating here for every other
// style. Changes to the public setMapStyle behavior may need mirroring there. See docs/cleanup-audit-2026-06-27.md (A2).
function setMapStyle(mapStyle, { persist = false } = {}) {
    if (!MAP_TILE_STYLES[mapStyle] || mapStyle === activeMapStyle && baseTileLayer) {
        return;
    }

    if (baseTileLayer) {
        map.removeLayer(baseTileLayer);
    }

    activeMapStyle = mapStyle;
    baseTileLayer = createBaseTileLayer(activeMapStyle).addTo(map);
    baseTileLayer.bringToBack();
    document.getElementById("mapStyleSelect").value = activeMapStyle;
    syncLocationNameLabelVisibility();
    // Neu erstellte Basis-Kacheln -> ggf. die "Magiersicht"-Entsättigung erneut anwenden (Kraftlinien-Modus).
    if (typeof syncPowerlineMapTint === "function") {
        syncPowerlineMapTint();
    }

    if (persist && IS_EDIT_MODE) {
        try {
            window.localStorage?.setItem(EDIT_MODE_MAP_STYLE_STORAGE_KEY, activeMapStyle);
        } catch (error) {
            console.warn("Mapstyle konnte nicht gespeichert werden:", error);
        }
        syncPlannerStateToUrl();
    }
}

// Da liegen die Map-Tiles
activeMapStyle = getInitialMapStyle();
baseTileLayer = createBaseTileLayer(activeMapStyle).addTo(map);

if (IS_EDIT_MODE) {
    // ⚠️ Diese Datei stand am 12.08.2026 in ihrer ALTEN Fassung auf dem Server (fuenf gescheiterte
    // Deploys), die Editor-Gruppen im Anzeige-Menue blieben also verborgen. Nur eine
    // Inhaltsaenderung heilt einen vergifteten Asset-Stempel.
    // 🔴 Beide Gruppen stehen seit dem 12.08.2026 im Anzeige-Menue an der Karte
    // (#map-display-menu), nicht mehr im Routenplaner. Aufgedeckt wird die GRUPPE, nicht nur ihr
    // Inhalt: sonst stuende im Frontend eine goldene Ueberschrift ueber einer Trennlinie ueber
    // nichts. Die Haken darin behalten ihr eigenes `hidden` -- „nur Labels mit Region" haengt
    // zusaetzlich am Landschaftsmodul und wird weiter unten nachgereicht.
    document.getElementById("display-group-mapstyle")?.removeAttribute("hidden");
    document.getElementById("mapStyleSelect").value = activeMapStyle;
    document.querySelector('.map-context-menu__group[data-context-action="add-here"]')?.removeAttribute("hidden");
    document.getElementById("display-group-checks")?.removeAttribute("hidden");
    document.getElementById("toggleCrossingsControl")?.removeAttribute("hidden");
    document.getElementById("toggleCrossings")?.removeAttribute("disabled");
    document.getElementById("toggleUnconnectedControl")?.removeAttribute("hidden");
    document.getElementById("toggleUnconnected")?.removeAttribute("disabled");
    document.getElementById("toggleSparseCrossingsControl")?.removeAttribute("hidden");
    document.getElementById("toggleSparseCrossings")?.removeAttribute("disabled");
    document.getElementById("toggleOpenPathEndsControl")?.removeAttribute("hidden");
    document.getElementById("toggleOpenPathEnds")?.removeAttribute("disabled");
    document.getElementById("toggleNodixControl")?.removeAttribute("hidden");
    document.getElementById("toggleNodix")?.removeAttribute("disabled");
    document.getElementById("toggleHiddenControl")?.removeAttribute("hidden");
    document.getElementById("toggleHidden")?.removeAttribute("disabled");
    // 🪤 Nur mit eingeschaltetem Landschaftsmodul. Ohne es gibt es keine Regionen, und der Filter
    // wuerde jede Beschriftung der Karte verbergen -- ein Haken, der alles ausblendet, liest sich
    // wie ein Fehler, nicht wie ein Filter.
    // 💣 Hier ist IS_ECOSYSTEM_ENABLED fast immer noch false -- die Rechteauskunft laeuft. Das ist kein
    // Fehler: applyEcosystemAccess() (js/config.js) holt genau diese beiden Zeilen nach, sobald die
    // Antwort da ist. Wer diese Bedingung "reparieren" will, baut den Riegel auf.
    if (IS_ECOSYSTEM_ENABLED) {
        document.getElementById("toggleLabelsWithRegionControl")?.removeAttribute("hidden");
        document.getElementById("toggleLabelsWithRegion")?.removeAttribute("disabled");
    }
    document.getElementById("review-panel")?.removeAttribute("hidden");
    document.getElementById("review-panel-toggle")?.removeAttribute("hidden");
    restoreReviewPanelState();
    void loadReviewReports();
    void loadWikiSyncCases();
    void loadChangeLog();
    void sendEditorPresenceHeartbeat();
    startEditorPresenceHeartbeat();
    startReviewReportsPolling();
} else {
    document.getElementById("toggleCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleUnconnected")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleSparseCrossings")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleOpenPathEnds")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleNodix")?.setAttribute("disabled", "disabled");
    document.getElementById("toggleLabelsWithRegion")?.setAttribute("disabled", "disabled");
}

// UI-Interaktionen und Events

$("#review-panel-toggle").on("click", toggleReviewPanel);
window.addEventListener("beforeunload", () => {
    activeFeatureLocks.forEach((timerId) => window.clearInterval(timerId));
    if (editorPresenceTimerId) {
        window.clearInterval(editorPresenceTimerId);
    }
    if (reviewReportsPollTimerId) {
        window.clearInterval(reviewReportsPollTimerId);
    }
});
$("#review-panel-refresh").on("click", () => refreshActiveEditorPanel());
$("#presence-force-claim").on("click", () => void avesmapsForceTerritoryClaim());
$("#review-report-refresh").on("click", () => loadReviewReports());
$(".review-panel__tab").on("click", function () {
    setEditorPanelTab(this.dataset.editorPanelTab || "review");
});

function setLegalDialogOpen(isOpen) {
    $("#legal-overlay").prop("hidden", !isOpen);
    $("#legal-button").attr("aria-expanded", isOpen ? "true" : "false");
    syncModalDialogBodyState();

    if (isOpen) {
        $("#legal-dialog").trigger("focus");
    } else {
        $("#legal-button").trigger("focus");
    }
}

// 💣 #legal-button ist ein <a href="/html/impressum.html">, kein <button>. Die Regel dazu -- Fenster
// oeffnen UND die Navigation anhalten -- steht in js/app/legal-anchor.js, weil sie dort gegen ein
// mitzaehlendes Ereignis laeuft statt gegen ihren Quelltext.
// ⚠️ HIER ABSICHTLICH OHNE try/catch, anders als beim Hash weiter oben. Faellt legal-anchor.js aus,
// wirft dieser Handler, die Navigation wird NICHT angehalten -- und der Browser folgt dem Link auf
// html/impressum.html. Das ist genau der Rueckfall, den dieses Markup vorsieht; ein catch, das
// still schluckt, haette stattdessen einen toten Knopf hinterlassen.
$("#legal-button").on("click", (event) => avesmapsHandleLegalButtonClick(event, setLegalDialogOpen));

// 💣 Das Impressum war nur anklickbar, nicht adressierbar (Befund A24). Die Regel dazu steht in
// js/app/legal-anchor.js -- eigene Datei, weil sie dort in einer vm-Sandbox mit echtem DOM
// pruefbar ist und hier nur ueber ihren Quelltext waere.
// 💣 try/catch, nicht `typeof`. Faellt js/app/legal-anchor.js aus (404 waehrend eines Deploys, ein
// Parsefehler), reisst ein ungeschuetzter Aufruf hier die restlichen ~420 Zeilen dieser Datei mit --
// vom Schliessen-Knopf ueber saemtliche Editor-Oeffner bis zum Escape-Riegel. Ein Anker fuer das
// Impressum darf nicht die halbe Bedienung kosten. `typeof` waere die naheliegende Wahl und ist die
// falsche: eine halb geladene Datei kann ihre `const` in der Todeszone stehen lassen, und dann wirft
// schon die Pruefung (siehe [[typeof-wirft-in-der-todeszone]]).
function openLegalSectionFromHash() {
    try {
        return avesmapsOpenLegalSectionFromHash(document, window.location.hash, setLegalDialogOpen);
    } catch (error) {
        return false;
    }
}

openLegalSectionFromHash();
// Auch wenn jemand den Link einfuegt, waehrend die Karte schon offen ist.
$(window).on("hashchange", () => openLegalSectionFromHash());

// Die E-Mail-Adresse des Impressums anklickbar machen (Befund A24, zweite Haelfte). Sie STEHT schon
// im HTML -- ohne diesen Aufruf bleibt sie lesbar, nur nicht klickbar. Deshalb derselbe try/catch
// wie oben: ein ausgefallenes Blattmodul darf nicht die halbe Bedienung kosten.
try {
    avesmapsActivateLegalMail(document);
} catch (error) {
    // Die Adresse bleibt als Text stehen -- genau das ist der Rueckfall, den dieses Markup vorsieht.
}
$("#legal-close").on("click", () => setLegalDialogOpen(false));
$("#legal-overlay").on("click", function (event) {
    if (event.target === this) {
        setLegalDialogOpen(false);
    }
});
$("#location-report-close, #location-report-cancel").on("click", () => setLocationReportDialogOpen(false, { resetForm: true }));
$("#location-edit-close, #location-edit-cancel").on("click", () => setLocationEditDialogOpen(false, { resetForm: true }));
// Ortsgroesse geaendert -> das Feld „Art" auf-/zusperren. Deckt den NUTZERweg ab; die drei
// programmatischen Schreiber gehen ueber setLocationEditSize(), weil `select.value = x` kein
// change-Ereignis feuert.
$("#location-edit-type").on("change", () => syncLocationEditPlaceKindAvailability());
$("#wiki-sync-territories").on("click", () => startWikiSyncTerritoryRun());
$("#settlement-editor-open").on("click", () => openAvesmapsSettlementEditorOverlay());
$("#game-literature-editor-open").on("click", () => openAvesmapsGameLiteratureEditorOverlay());
$("#citymaps-editor-open").on("click", () => openAvesmapsCitymapEditorOverlay());
$("#powerline-editor-open").on("click", () => openAvesmapsPowerlineEditorOverlay());
$("#ecosystem-editor-open").on("click", () => openAvesmapsEcosystemEditorOverlay());
$("#path-editor-open").on("click", () => openAvesmapsPathEditorOverlay());
// WikiDump hybrid read (H4c-f): sandbox read loop + inline cred-prompt.
$("#wiki-sync-dump-read").on("click", () => startWikiSyncDumpRead());
// Per-kind "Syncen" (Wave 2): one button per tab drives sync_kind for that kind.
$("#wiki-sync-sync-settlement").on("click", () => startWikiSyncKindSync("settlement"));
$("#wiki-sync-sync-path").on("click", () => startWikiSyncKindSync("path"));
$("#wiki-sync-sync-region").on("click", () => startWikiSyncKindSync("region"));
// Abenteuer (Phase 4): eigene Aktion (sync_adventures), kein sync_kind -- also eigener Handler. Seit
// 2026-08-06 rechnet der Lauf einen Plan und oeffnet die Uebernahme-Vorschau. Das .catch steht da, weil
// die Funktion fuer ihren ANDEREN Aufrufer weiterwirft (der Editor-iframe zeigt den Fehlschlag in
// seiner eigenen Kopfzeile) -- eine unbehandelte Zurueckweisung waere hier nur Konsolenlaerm, den
// niemand liest: Statuszeile und Hinweisfenster haben es schon gesagt.
$("#wiki-sync-sync-game-literature").on("click", () => { void startWikiSyncGameLiteratureSync().catch(() => {}); });
// Karten hat hier bewusst keine Bindung: sein Sync (sync_citymaps, startWikiSyncCitymapsSync)
// wird ausschliesslich aus dem Karteneditor heraus angestossen, nicht aus dem Panel.
// Natur & Waren (Flora/Fauna/Spezies/Handelswaren): likewise its OWN reconcile action
// (sync_lore), driven in ~35 bounded steps -- see runWikiSyncLoreSyncLoop.
// Der Sync bleibt an DIESE id gebunden. Der Knopf zieht beim ersten Oeffnen mit ins
// Fenster um; die Bindung haengt am ELEMENT und ueberlebt den Umzug deshalb.
$("#wiki-sync-sync-lore").on("click", () => startWikiSyncLoreSync());
// Der Knopf im Reiter OEFFNET nur -- er traegt bewusst eine andere id, damit an ihm
// nichts haengen KANN, was synct. Das ist die Garantie: nicht "wir rufen den Sync nicht
// auf", sondern "der Sync ist an eine id gebunden, die dieser Knopf nicht hat".
$("#wiki-sync-lore-open").on("click", () => setWikiSyncLoreDialogOpen(true));
$("#wiki-sync-lore-close").on("click", () => setWikiSyncLoreDialogOpen(false));
// Linkchecker: no binding here on purpose. The "Links prüfen" buttons live in the editor DIALOGS
// (adventure-editor / wiki-sync-settlement-editor / wiki-sync-monitor), each scoped to its own entity
// type; they call window.parent.startLinkCheck(scope, onProgress) from their iframe, exactly like the
// "Syncen" buttons already delegate to startWikiSyncKindSync.
$("#wiki-sync-dump-credentials-form").on("submit", (event) => {
    event.preventDefault();
    void submitWikiSyncDumpCredentials();
});
$("#wiki-sync-dump-credentials-close, #wiki-sync-dump-credentials-cancel").on("click", () => closeWikiSyncDumpCredentialsPrompt(false));
$("[data-wiki-sync-panel-tab]").on("click", function () {
    setWikiSyncPanelTab(this.dataset.wikiSyncPanelTab || "locations");
});
// Sub-Pills im "Meldungen"-Reiter (Community Meldungen / Bewertungen) — wie die WikiSync-Pills.
$(document).on("click", "[data-review-subtab]", function () {
    const sub = this.dataset.reviewSubtab || "reports";
    document.querySelectorAll("[data-review-subtab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.reviewSubtab === sub);
    });
    document.querySelectorAll("[data-review-subtab-section]").forEach((section) => {
        section.classList.toggle("is-active", section.dataset.reviewSubtabSection === sub);
    });
});
// Sub-Pills im "Materialien"-Reiter (Abenteuer / Karten) — dasselbe Muster wie oben.
// The citymap list loads LAZILY on first open, like the adventure list: it is an editor catalog fetch
// that nobody waiting on the Siedlungen tab should pay for.
// The level-3 "Materialien" pills used to be handled here. That level is gone (2026-07-22):
// Abenteuer, Karten and Vorkommen are top-level subjects, and setWikiSyncPanelTab does the
// switching and the lazy list load for all eight in one table. This handler was delegated on
// document, so with no such element left it did not error -- it simply never fired again.
$("#wiki-sync-filter").on("input search", function () {
    setWikiSyncFilterQuery(this.value || "");
});
$("#wiki-sync-territory-filter").on("input search", function () {
    setWikiSyncTerritoryFilterQuery(this.value || "");
});
// Delegated from the SHARED view-tab strip. It used to hang on #wiki-sync-territory-tabs, which
// no longer exists -- and because jQuery binds the host element itself at load time, a stale id
// here does not error, it just silently stops responding to clicks.
$("#wiki-sync-view-tabs").on("click", "[data-territory-mapstatus]", function () {
    setWikiSyncTerritoryMapStatus(this.dataset.territoryMapstatus || "all");
});
// Zeitraum + „nur Flächenländer" hängen seit 2026-07-23 im gemeinsamen Trichter
// (js/ui/filter-menu.js, verdrahtet in review-wiki-sync.js); die alten Einzel-Handler auf
// #wiki-sync-territory-time-from/-to/-today/-flaechenland sind mit ihren Eingaben entfallen.
// Auf `document`, NICHT auf einen Container. Die WikiSync-Faelle wurden ins Konfliktfenster
// verlegt; ihr alter Wirt #wiki-sync-case-list ist seitdem ein verstecktes Ankerelement, und weil
// die Delegation daran hing, war JEDER Knopf JEDER eingegliederten Fallart tot -- gezeichnet,
// anklickbar, ohne Wirkung. Aufgefallen ist es dem Owner an "Anzeigen"/"Position waehlen"
// (2026-07-21); betroffen waren alle zwoelf Fallarten. Ein Container-Wirt macht die Bindung von
// der DOM-Lage abhaengig, und die aendert sich wieder -- der Selektor ist eindeutig genug.
$(document).on("click", "[data-wiki-sync-action]", handleWikiSyncCaseActionClick);
$("#wiki-sync-conflicts-open").on("click", () => setWikiSyncConflictsDialogOpen(true));
$("#wiki-sync-powerlines-sync").on("click", () => startWikiSyncPowerlines());
$("#conflict-rescan").on("click", () => loadConflicts({ rescan: true }));
$("#conflict-minimize").on("click", () => setConflictDialogMinimized(!conflictMinimized));
$("#conflict-search").on("input search", function () {
    conflictFilter.query = String($(this).val() || "").trim();
    renderConflicts();
});
$("#wiki-sync-conflicts-close").on("click", () => setWikiSyncConflictsDialogOpen(false));
$("#wiki-sync-resolve-close, #wiki-sync-resolve-cancel").on("click", () => setWikiSyncResolveDialogOpen(false, { resetForm: true }));
$("#wiki-sync-preset-wiki").on("click", () => applyWikiSyncResolvePreset("wiki"));
$("#wiki-sync-preset-avesmap").on("click", () => applyWikiSyncResolvePreset("avesmap"));
$("#wiki-sync-resolve-wiki-open").on("click", () => openWikiSyncResolveWikiLink());
$("#wiki-sync-resolve-wiki-url").on("input", () => syncWikiSyncResolveLinkButton());
$("#location-report-type").on("change", syncLocationReportTypeFields);
$("#location-report-form").on("submit", handleLocationReportFormSubmit);
// Multi-source #3: dynamic source list in the community report form (add / remove / Enter-to-add).
$("#report-source-add-btn").on("click", addLocationReportSourceFromInputs);
// Instruction 5a: suggest existing catalog sources on the name field. MUST be wired before the
// Enter binding below -- both listen on #report-source-label, native listeners fire in registration
// order, and the autocomplete has to be able to swallow Enter (stopImmediatePropagation) when it is
// picking a suggestion instead of letting "Enter adds the source" run with half-filled fields.
initLocationReportSourceAutocomplete();
$("#location-report-pick-position").on("click", startChangePositionPick);
$("#location-report-sources-list").on("click", (event) => {
	const removeButton = event.target.closest("[data-remove-report-source]");
	if (removeButton) {
		removeLocationReportSource(Number(removeButton.getAttribute("data-remove-report-source")));
	}
});
$("#report-source-label, #report-source-url, #report-source-pages").on("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		addLocationReportSourceFromInputs();
	}
});
$("#location-edit-form").on("submit", handleLocationEditFormSubmit);
$("#wiki-sync-resolve-form").on("submit", handleWikiSyncResolveFormSubmit);
$("#path-edit-form").on("submit", handlePathEditFormSubmit);
$("#powerline-edit-form").on("submit", handlePowerlineEditFormSubmit);
$("#label-edit-form").on("submit", handleLabelEditFormSubmit);
$("#powerline-edit-delete").on("click", () => void deletePowerlineFeature(powerlineEditFeature));
$("#label-edit-delete").on("click", () => deleteActiveLabel());
$("#label-edit-min-zoom, #label-edit-max-zoom").on("input", syncLabelZoomRangeOutputs);
$("#label-edit-min-zoom-num, #label-edit-max-zoom-num").on("input", syncLabelZoomNumberInputs);
$("#label-edit-priority").on("input", syncLabelPriorityOutput);
$("#region-edit-form").on("submit", handleRegionEditFormSubmit);
$("#region-edit-delete").on("click", () => deleteActiveRegion());
$("#region-edit-opacity").on("input", syncRegionOpacityOutput);
$("#region-edit-coat-url").on("input", syncRegionCoatPreview);
$("#region-edit-valid-open").on("change", syncRegionValidToControls);
$("#region-edit-parent-filter").on("input search", function () {
    updateRegionParentFilter(this.value || "");
});
$("#region-edit-parent-filter-clear").on("click", () => {
    $("#region-edit-parent-filter").val("");
    updateRegionParentFilter("");
});
// 🔴 Hier standen fuenf Zuhoerer fuer das eigene Fenster „Wiki-Referenz aendern"
// (#region-wiki-picker-overlay). Seit dem 16.08.2026 traegt das geteilte Bauteil die Suche IM Kasten
// (js/review/review-region-wiki-picker.js) und braucht keinen einzigen -- es haengt seine Zuhoerer
// selbst an seinen Behaelter und nimmt sie in `zerstoeren()` wieder ab.
$("#region-operation-cancel").on("click", cancelPendingRegionOperation);
$("#political-timeline-range, #political-timeline-year").on("input change", function () {
    setPoliticalTimelineYear(this.value);
});
$("#path-edit-autoname").on("change", syncPathAutoNameControls);
$("#path-edit-type").on("change", () => {
    syncPathAutoNameControls({ forceName: true });
    // 🔴 syncPathTransportOptions zieht das Bach-Häkchen mit (syncPathBachHaken) -- Wegtypwechsel
    // und Häkchen laufen deshalb durch DENSELBEN Weg. Ein zweiter Aufruf hier wäre der zweite
    // Erzeuger derselben Anzeige.
    syncPathTransportOptions({ resetToDefault: true });
});
// Owner 30.08.2026: das Häkchen „Bach" nimmt die Verkehrsmittel weg, sobald es fällt.
// ⚠️ `resetToDefault: true` -- beim Abwählen sollen die Verkehrsmittel der Wegart zurückkommen,
// nicht die leere Liste, die der Bach hinterlassen hat.
$("#path-edit-is-bach").on("change", () => {
    syncPathTransportOptions({ resetToDefault: true });
});
$("#path-edit-close, #path-edit-cancel").on("click", () => setPathEditDialogOpen(false, { resetForm: true }));
$("#powerline-edit-close, #powerline-edit-cancel").on("click", () => setPowerlineEditDialogOpen(false, { resetForm: true }));
$("#label-edit-close, #label-edit-cancel").on("click", () => setLabelEditDialogOpen(false, { resetForm: true }));
$("#region-edit-close, #region-edit-cancel").on("click", () => setRegionEditDialogOpen(false, { resetForm: true }));
// 🔴 Ctrl+Z IS NOT AN AUDIT SHORTCUT (Owner 2026-07-26). It used to call
// handleChangeLogUndoShortcut here, which reverted the newest still-undoable change-log entry --
// server-side, without a dialog, whoever had made it. Repeated presses walked DOWN the history,
// because "the newest undoable entry" moves on as soon as the previous one is marked undone; three
// strokes ate three entries, two of them another editor's. The audit log is undone by the deliberate
// "Rückgängig" button on the named entry and by nothing else. Ctrl+Z now belongs exclusively to local
// geometry editing (js/map-features/map-features-ecosystem-edit.js), where a miss costs nothing.
$(document).on("keydown", (event) => {
    if (event.key === "Escape" && isLocationReportDialogOpen()) {
        setLocationReportDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && window.AvesmapsPoliticalTerritoryEditorLink?.isOpen?.()) {
        window.AvesmapsPoliticalTerritoryEditorLink.close();
        return;
    }

    if (event.key === "Escape" && isPathEditDialogOpen()) {
        setPathEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isPowerlineEditDialogOpen()) {
        setPowerlineEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isLabelEditDialogOpen()) {
        setLabelEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isRegionEditDialogOpen()) {
        setRegionEditDialogOpen(false, { resetForm: true });
        return;
    }

    if (event.key === "Escape" && isWikiSyncConflictsDialogOpen()) {
        setWikiSyncConflictsDialogOpen(false);
        return;
    }

    if (event.key === "Escape" && !$("#legal-overlay").prop("hidden")) {
        setLegalDialogOpen(false);
        return;
    }

    if (event.key === "Escape") {
        if (pendingRegionOperation) {
            cancelPendingRegionOperation();
            return;
        }

        if (clearChangeLogFocusMarker()) {
            return;
        }

        clearPendingPathCreation();
        clearPathGeometryEdit();
        clearRegionGeometryEdit();
        closeMapContextMenu();
        closeRegionContextMenu();
    }
});

function getMapContextMenuElement() {
    return document.getElementById("map-context-menu");
}

function createMapContextMenuAnchorIcon() {
    return L.divIcon({
        className: "map-context-anchor-marker",
        html: '<span class="map-context-anchor-marker__dot" aria-hidden="true"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
}

function clearMapContextMenuAnchor() {
    if (!contextMenuAnchorMarker) {
        return;
    }

    map.removeLayer(contextMenuAnchorMarker);
    contextMenuAnchorMarker = null;
}

function setMapContextMenuAnchor(latlng) {
    clearMapContextMenuAnchor();
    contextMenuAnchorMarker = L.marker(L.latLng(latlng), {
        icon: createMapContextMenuAnchorIcon(),
        keyboard: false,
        interactive: false,
        pane: "measurementHandlesPane",
        zIndexOffset: 1200,
    }).addTo(map);
}

function closeMapContextMenu() {
    const menuElement = getMapContextMenuElement();
    if (!menuElement) {
        return;
    }

    menuElement.hidden = true;
    pendingContextMenuLatLng = null;
    pendingPathSplit = null;
    clearMapContextMenuAnchor();
}

function syncPathSplitContextMenuAction() {
    const splitActionElement = document.querySelector('[data-context-action="split-path-at-node"]');
    if (!splitActionElement) {
        return;
    }

    splitActionElement.hidden = !pendingPathSplit;
}

function openMapContextMenu(latlng, clientX, clientY) {
    const menuElement = getMapContextMenuElement();
    if (!menuElement) {
        return;
    }

    // 💣 Wer ein Menue oeffnet, schliesst die anderen. Die beiden Nachbarn taten das laengst
    // (openRegionContextMenu ruft closeMapContextMenu, das Flaechenmenue ebenso) -- nur hier fehlte
    // die Gegenrichtung, und genau die ist der Weg, den Strg+Rechtsklick nimmt: das Flaechen- bzw.
    // Gebietsmenue steigt ohne `stop` aus, dieses hier geht auf, und das andere blieb daneben stehen.
    // Owner-Screenshot vom 14.08.2026 zeigt beide uebereinander.
    // ⚠️ Ueber die oeffentliche Schnittstelle des Flaechenmenues, nicht an seinem DOM vorbei -- es
    // raeumt beim Schliessen mehr auf als nur `hidden` (Auswahl, Zettel).
    if (typeof closeRegionContextMenu === "function") {
        closeRegionContextMenu();
    }
    window.AvesmapsEcosystemAreaMenu?.close?.();

    pendingContextMenuLatLng = L.latLng(latlng);
    setMapContextMenuAnchor(pendingContextMenuLatLng);
    syncDistanceMeasurementContextMenuAction();
    syncPathSplitContextMenuAction();
    // 💣 ZULETZT, und ausdruecklich NACH syncPathSplitContextMenuAction. Welche Anlege-Eintraege die
    // aktuelle Ansicht ueberhaupt zeigt, entscheidet die Tabelle in
    // js/map-features/map-features-ecosystem-context-action.js -- die schaltet auch „Neue Kreuzung und
    // Weg teilen" weg, wenn die Ansicht keine Wege zeigt. Liefe sie vorher, machte die Zeile darueber
    // den Eintrag gleich wieder sichtbar. Und immer noch VOR dem `hidden = false` darunter: erst danach
    // wird die Hoehe gemessen und ins Sichtfenster geklemmt.
    window.avesmapsSyncAddHereMenu?.();
    menuElement.hidden = false;
    menuElement.style.left = `${clientX + MAP_CONTEXT_MENU_OFFSET_X}px`;
    menuElement.style.top = `${clientY + MAP_CONTEXT_MENU_OFFSET_Y}px`;

    const menuWidth = menuElement.offsetWidth;
    const menuHeight = menuElement.offsetHeight;
    const preferredLeft = clientX + MAP_CONTEXT_MENU_OFFSET_X;
    const preferredTop = clientY + MAP_CONTEXT_MENU_OFFSET_Y;
    const left = Math.max(
        MAP_CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(preferredLeft, window.innerWidth - menuWidth - MAP_CONTEXT_MENU_VIEWPORT_PADDING)
    );
    const top = Math.max(
        MAP_CONTEXT_MENU_VIEWPORT_PADDING,
        Math.min(preferredTop, window.innerHeight - menuHeight - MAP_CONTEXT_MENU_VIEWPORT_PADDING)
    );

    menuElement.style.left = `${left}px`;
    menuElement.style.top = `${top}px`;
}

function shouldIgnoreDistanceMeasurementClickTarget(target) {
    const targetElement = target instanceof Element ? target : null;
    if (!targetElement) {
        return false;
    }

    return Boolean(targetElement.closest(
        ".leaflet-control, .leaflet-popup, .location-tooltip, .map-context-menu, .measurement-handle-marker, #search, #toggle-button, #review-panel, #review-panel-toggle, #spotlight-search-overlay, #political-territory-editor-overlay, #location-report-overlay, #location-edit-overlay, #wiki-sync-resolve-overlay, #path-edit-overlay, #landschaft-dialog-overlay, #label-edit-overlay, #region-edit-overlay"
    ));
}

function handleDistanceMeasurementContainerClick(event) {
    if (!isAwaitingDistanceMeasurementEnd || event.button !== 0) {
        return;
    }

    if (shouldIgnoreDistanceMeasurementClickTarget(event.target)) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    completeDistanceMeasurementAt(map.mouseEventToLatLng(event));
}

map.on("contextmenu", (event) => {
    event.originalEvent?.preventDefault();
    openMapContextMenu(
        event.latlng,
        event.originalEvent?.clientX ?? 0,
        event.originalEvent?.clientY ?? 0
    );
});
map.on("click", closeMapContextMenu);
map.on("click", closeRegionContextMenu);
map.on("click", clearChangeLogFocusMarker);
map.on("movestart", closeMapContextMenu);
window.addEventListener("resize", closeMapContextMenu);
map.getContainer().addEventListener("click", handleDistanceMeasurementContainerClick, true);
// „Verschieben" an einem freien Kartenpunkt wartet auf denselben Klick und auf demselben Weg
// (Capture auf dem Container, weil eine getroffene Ebene das Karten-click sonst anhaelt).
map.getContainer().addEventListener("click", handleMapPointRelocationContainerClick, true);
initializeSpotlightSearch();
syncDistanceMeasurementContextMenuAction();
updateLocationReportDialogAvailability();
preloadPoliticalTerritoryOptions();

// 🔴 Eine Ortsklasse ohne eigenen Knopf folgt dem einer anderen (`folgtSchalter` in js/config.js).
// Heute betrifft das `stadtviertel`, das sich wie „Besondere Bauwerke/Stätten" verhalten soll.
// 💣 Die Auflösung gehört HIERHIN und nirgendwo sonst: sechs Stellen fragen über
// isLocationTypeVisible() nach der Sichtbarkeit, und ein leeres jQuery-Ergebnis sagt `false` --
// die Klasse wäre lautlos unsichtbar statt „wie ein Bauwerk".
function resolveLocationToggleType(locationType) {
    const config = LOCATION_TYPE_CONFIG[locationType];
    return (config && config.folgtSchalter) || locationType;
}

function getLocationToggleButton(locationType) {
    return $(`.location-toggle[data-location-type="${resolveLocationToggleType(locationType)}"]`);
}

function isLocationTypeVisible(locationType) {
    return getLocationToggleButton(locationType).hasClass("is-active");
}

function getVisibleLocationTypeIndex() {
    return LOCATION_TYPE_VISIBILITY_ORDER.reduce((lastVisibleIndex, locationType, index) => {
        return isLocationTypeVisible(locationType) ? index : lastVisibleIndex;
    }, -1);
}

function setVisibleLocationTypesThrough(targetLocationType, { syncUrl = true } = {}) {
    const targetIndex = LOCATION_TYPE_VISIBILITY_ORDER.indexOf(targetLocationType);
    const activeTargetIndex = targetIndex === getVisibleLocationTypeIndex() ? -1 : targetIndex;
    LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
        getLocationToggleButton(locationType).toggleClass("is-active", activeTargetIndex >= 0 && index <= activeTargetIndex);
    });
    syncLocationMarkerVisibility();
    if (syncUrl) {
        syncPlannerStateToUrl();
    }
}

function previewVisibleLocationTypesThrough(targetLocationType = null) {
    const targetIndex = targetLocationType ? LOCATION_TYPE_VISIBILITY_ORDER.indexOf(targetLocationType) : -1;
    LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
        getLocationToggleButton(locationType).toggleClass("is-hover-preview", targetIndex >= 0 && index <= targetIndex);
    });
}

function syncLocationToggleButtons() {
    LOCATION_TYPE_KEYS.forEach((locationType) => {
        const $button = getLocationToggleButton(locationType);
        const isActive = $button.hasClass("is-active");
        $button
            .toggleClass("is-inactive", !isActive)
            .attr("aria-pressed", isActive ? "true" : "false");
    });
}




