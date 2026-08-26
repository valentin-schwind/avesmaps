// Die EINE Kurve und die EINE Dauer des Zoomschritts.
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE. Vorher stand dieselbe Zeichenkette an ACHT Stellen --
// sechsmal im JS (Grenzen, Wegenamen, Ortsmarker, Schraffur, Fluss- und Tempopfeile) und zweimal
// im CSS (leaflet.css, map-labels.css). Der Entwurf zaehlte fuenf und uebersah drei. Genau so
// laufen Werte auseinander: nicht weil jemand einen aendert, sondern weil niemand alle findet.
// Entwurf: docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md
//
// Owner 26.08.2026, woertlich: „alle sollen diesselbe kubische bezier ease-in-ease out animation
// von 250 ms bekommen. eine zahl fuer alle animationen."
//
// 💣 DIE 250 SIND NICHT FREI. Leaflet zaehlt sie selbst -- `setTimeout(a(this._onZoomTransitionEnd,
// this),250)` in js/third-party/leaflet.js (minifiziert, deshalb nicht auf den ersten Blick zu
// finden). Eine andere Dauer im CSS liefe an Leaflets eigenem Ende vorbei: die Flaechen saessen
// entweder zu frueh oder zu spaet auf ihrem Platz, und der Fehler saehe wie ein Ruckeln aus, nicht
// wie eine falsche Zahl. Wer sie aendern will, patcht Fremdcode.
//
// 🔴 Die Kurve ist ease-in-out und NICHT Leaflets cubic-bezier(0,0,0.25,1) (ein reines ease-out).
// Das ist eine bewusste Abkehr von Leaflets Vorgabe und gilt ausdruecklich AUCH FUER DIE KACHELN --
// sonst waere der Guss an der auffaelligsten Flaeche gebrochen. Ueberschrieben wird sie in
// css/features/zoom-uebergang.css.
//
// Geladen von index.html, VOR allen Zeichenflaechen und vor js/app/bootstrap.js.
// Bewacht von js/map-features/__tests__/zoom-uebergang.test.js.

const AVESMAPS_ZOOM_DAUER_BASIS_MS = 250;

// ⭐ DIE ZEITLUPE: ?zoomlupe=<faktor> dehnt den GANZEN Zoomschritt. Owner 26.08.2026, beim Suchen
// einer doppelten Beschriftung: „wenn du mir einen schalter gibst der die animation auf 5 sekunden
// streckt kann ichs dir genauer sagen". Ein Werkzeug zum Hinsehen, kein Kartenmerkmal.
//
// 💣 SIE MUSS AUCH LEAFLETS EIGENES ENDE DEHNEN, sonst ist sie wertlos. Leaflet zaehlt seine 250 ms
// selbst (`setTimeout(a(this._onZoomTransitionEnd,this),250)`, minifiziert) und raeumt danach auf:
// die Overlays loeschen ihre Transitions und setzen ihre Flaechen neu. Ohne Mitdehnen waere die
// Zeitlupe nach 250 ms abgeschnitten -- man saehe genau den Teil NICHT, den man sucht.
// Deshalb wird `_onZoomTransitionEnd` umwickelt und um die zusaetzliche Zeit verzoegert.
// ⚠️ ERWARTETE NEBENWIRKUNG, und sie ist der Preis des Werkzeugs: `_onZoomTransitionEnd`
// stoesst BEIDES an -- das Aufraeumen der Animation UND das Nachladen der Kacheln. Wer das
// eine dehnt, dehnt das andere mit; rund um die alte Ansicht steht dann ein grauer Rahmen,
// bis die gedehnte Zeit um ist (Owner 26.08.2026 als Fehler gemeldet, Gegenprobe ohne
// Parameter war sauber). 🔴 Hier wird KEINE Kachel-Logik nachgebaut: jede Zeile in einem
// Diagnosewerkzeug ist eine Zeile, die den echten Zoom brechen kann. Stattdessen sagt es die
// Konsolenmeldung, damit es niemand ein zweites Mal meldet.
// ⚠️ NUR mit gesetztem Parameter. Ohne ihn wird nichts umwickelt, nichts gesetzt, und
// AVESMAPS_ZOOM_DAUER_MS ist zifferngenau die Basis -- die Karte weiss nichts von diesem Block.
const AVESMAPS_ZOOM_LUPE = (() => {
	try {
		const roh = new URLSearchParams(window.location.search).get("zoomlupe");
		const wert = Number(roh);
		if (roh !== null && Number.isFinite(wert) && wert >= 1 && wert <= 60) { return wert; }
	} catch (e) { /* ohne Adresszeile keine Lupe */ }
	return 1;
})();

const AVESMAPS_ZOOM_DAUER_MS = Math.round(AVESMAPS_ZOOM_DAUER_BASIS_MS * AVESMAPS_ZOOM_LUPE);
const AVESMAPS_ZOOM_KURVE_PUNKTE = [0.42, 0, 0.58, 1];
const AVESMAPS_ZOOM_KURVE = "cubic-bezier(0.42, 0, 0.58, 1)";

if (AVESMAPS_ZOOM_LUPE > 1) {
	// Das CSS-Token nachziehen -- es faehrt Leaflets Kachel-/SVG-Transform und die Blenden im CSS.
	// Inline an :root gewinnt gegen die Regel aus css/features/zoom-uebergang.css.
	try {
		document.documentElement.style.setProperty("--avesmaps-zoom-dauer", AVESMAPS_ZOOM_DAUER_MS + "ms");
	} catch (e) { /* ohne Dokument keine Lupe */ }
	// Und Leaflets Aufraeumen um dieselbe Zeit verschieben.
	try {
		const echt = L.Map.prototype._onZoomTransitionEnd;
		const zusatz = AVESMAPS_ZOOM_DAUER_MS - AVESMAPS_ZOOM_DAUER_BASIS_MS;
		L.Map.prototype._onZoomTransitionEnd = function () {
			window.setTimeout(() => echt.call(this), zusatz);
		};
		// eslint-disable-next-line no-console
		console.info("[avesmaps] Zoom-Zeitlupe aktiv: Faktor " + AVESMAPS_ZOOM_LUPE
			+ " (" + AVESMAPS_ZOOM_DAUER_MS + " ms). ERWARTETE NEBENWIRKUNG: die Kacheln laden erst "
			+ "am Ende der gedehnten Zeit nach, deshalb steht rund um die alte Ansicht ein grauer "
			+ "Rahmen. Leaflets _onZoomTransitionEnd stoesst BEIDES an -- das Aufraeumen der "
			+ "Animation UND das Nachladen; wer das eine dehnt, dehnt das andere mit. Kein Fehler "
			+ "der Karte. ?zoomlupe weglassen fuer den Normalbetrieb.");
	} catch (e) { /* ohne Leaflet keine Lupe */ }
}

// 💣 DER STRING UND DIE PUNKTE SIND EIN GEKOPPELTER WERT: der String faehrt die CSS-Uebergaenge,
// die Punkte fahren die Gegenrechnung der Ortsmarker. Laufen sie auseinander, rechnet die Korrektur
// gegen eine Kurve, die gar nicht laeuft -- und der Fehler waere ein leichtes Zittern, das niemand
// einem Zahlenpaar zuordnet. Dasselbe gilt fuer die Token in css/features/zoom-uebergang.css.

/**
 * Ein fertiger Transition-String fuer eine Eigenschaft, auf der gemeinsamen Kurve und Dauer.
 *
 * ⚠️ Wer damit `transform` INLINE setzt, setzt eine Transition, die den Zoom UEBERLEBT -- und weil
 * L.DomUtil.setPosition per transform verschiebt, animiert danach jeder Pan die Position nach
 * (Owner: „wenn ich mit der maus panne, ziehen die 2x nach"). Sie gehoert ausschliesslich in den
 * zoomanim-Handler, und der moveend-Handler loescht sie wieder. Zweimal bezahlt: e85b31d1, ed1e2e93.
 *
 * @param {string} eigenschaft z.B. "transform" oder "opacity"
 * @returns {string}
 */
function avesmapsZoomTransition(eigenschaft) {
	return eigenschaft + " " + AVESMAPS_ZOOM_DAUER_MS + "ms " + AVESMAPS_ZOOM_KURVE;
}

/**
 * Der Wert der Zoomkurve zum Zeitpunkt t -- dieselbe Kurve, die der Compositor faehrt.
 *
 * 💣 EINE CUBIC-BEZIER-KURVE IST NACH DER ZEIT PARAMETRISIERT, NICHT NACH DEM KURVENPARAMETER.
 * Erst muss u gesucht werden mit X(u) = t, dann liefert Y(u) den Weg. Wer einfach Y(t) rechnet,
 * bekommt eine aehnlich aussehende, aber falsche Kurve -- bei ease-in-out weicht sie um bis zu
 * 8 Prozentpunkte ab, und alles, was damit gegengerechnet wird, liefe der Animation sichtbar
 * hinterher. Der Test misst genau diesen Unterschied bei t = 0,25.
 *
 * @param {number} t Zeitanteil 0..1 (ausserhalb wird geklemmt, nicht extrapoliert)
 * @returns {number} Weganteil 0..1
 */
function avesmapsZoomEasing(t) {
	const zeit = Number(t);
	if (!(zeit > 0)) { return 0; }   // faengt auch NaN und undefined -- beides heisst „noch nichts"
	if (zeit >= 1) { return 1; }
	const x1 = AVESMAPS_ZOOM_KURVE_PUNKTE[0], y1 = AVESMAPS_ZOOM_KURVE_PUNKTE[1];
	const x2 = AVESMAPS_ZOOM_KURVE_PUNKTE[2], y2 = AVESMAPS_ZOOM_KURVE_PUNKTE[3];
	const bez = (a, b, u) => { const v = 1 - u; return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u; };
	const abl = (a, b, u) => 3 * a * (1 - u) * (1 - 3 * u) + 3 * b * u * (2 - 3 * u) + 3 * u * u;
	let u = zeit;
	for (let i = 0; i < 8; i++) {
		const rest = bez(x1, x2, u) - zeit;
		if (Math.abs(rest) < 1e-7) { break; }
		const steigung = abl(x1, x2, u);
		if (Math.abs(steigung) < 1e-9) { break; }
		u -= rest / steigung;
	}
	// 💣 NEWTON DARF AUS [0,1] HINAUSLAUFEN -- dann beschreibt u keinen Zeitpunkt der Animation
	// mehr, und Y(u) gaebe einen Weganteil ausserhalb des Fensters zurueck. Bisektion ist
	// langsamer, aber sie kann es nicht. Der Rueckfall kostet nur dort, wo er noetig ist.
	if (!(u >= 0 && u <= 1)) {
		let lo = 0, hi = 1;
		for (let i = 0; i < 30; i++) {
			u = (lo + hi) / 2;
			if (bez(x1, x2, u) < zeit) { lo = u; } else { hi = u; }
		}
	}
	return bez(y1, y2, u);
}

/**
 * Wieviel kleiner (oder groesser) ein Ortsmarker WAEHREND der Zoom-Animation gezeichnet werden
 * muss, damit er auf seiner echten Zielgroesse LANDET statt zurueckzuschnappen.
 *
 * 💣 DAS PROBLEM, DAS SIE LOEST (Entwurf §3): der Canvas skaliert 250 ms lang um den vollen
 * Kartenfaktor (2 je Zoomstufe), aber keine Ortsklasse waechst wirklich um 2 -- Metropole 1,414,
 * Grossstadt 1,468, Stadt 1,698, Kleinstadt 1,796, Dorf 1,911, Gebaeude 2,106. Am zoomend schnappt
 * darum jede Klasse um einen ANDEREN Betrag zurueck (-29 % bis +5 %), und genau das liest sich als
 * „nicht synchron".
 *
 * 🔴 OWNER-ENTSCHEID 26.08.2026 (§3.1): die Zoombaender werden dafuer NICHT angefasst. Ein
 * gemeinsamer Wachstumsfaktor muesste 2,0 sein, und der ist mit dem heutigen Bild unvereinbar --
 * durchgerechnet mit je Klasse frei gewaehltem Anker (also der kleinstmoeglichen Bildaenderung):
 * Faktor 2,0 kostet 53 % RMS und +183 % groesste Einzelaenderung (Metropole bei z0 2,35 px statt
 * 6,65, bei z6 150 px statt 53,2); selbst das rechnerische Optimum 1,61 kostet 22 % RMS UND laesst
 * 19 % Sprung stehen. Strukturell: die Metropole spannt 8x ueber sechs Stufen, Faktor 2 verlangt
 * 64x. Deshalb bleibt die Tafel, und die Animation rechnet dagegen.
 *
 * Die Rechnung -- gewuenschte scheinbare Groesse geteilt durch den Massstab, den der Canvas gerade
 * traegt, beides relativ zur Ausgangsgroesse, damit der Rueckgabewert ein reiner Multiplikator auf
 * die bereits gezeichneten Werte ist:
 *     gewuenscht = 1 + e * (neu/alt - 1)      (linear entlang derselben Kurve wie die Transform)
 *     gezeichnet = 1 + e * (massstab - 1)     (was der Compositor in diesem Moment skaliert)
 * Bei e = 0 kommt 1 heraus (kein Sprung am Anfang), bei e = 1 genau neu/(alt*massstab) -- also
 * landet alt * faktor * massstab exakt auf neu (kein Sprung am Ende).
 *
 * ⚠️ DIE POSITIONEN BLEIBEN UNANGETASTET: sie muessen um den vollen Kartenfaktor skalieren und tun
 * das weiter ueber die Transform. Nur die Groessen werden gegengerechnet -- eine einzelne
 * Canvas-Transform kann Groesse und Lage nicht trennen, ein Zeichenvorgang schon. Das ist der ganze
 * Grund, warum diese Korrektur beim ZEICHNEN sitzt und nicht an der Transform, und zugleich der
 * Grund, warum sie nur dort geht, wo Neuzeichnen billig ist: 18 Neuzeichnungen des Marker-Canvas
 * ueber einen Zoomschritt kosten gemessen NICHTS (Median 16,7 ms je Bild -- identisch zu null
 * Neuzeichnungen; im zeichnenden Browser gemessen, 26.08.2026), der Grenzen-Canvas dagegen
 * 52-99 ms je redraw.
 *
 * 🔴 Ein unbrauchbarer Wert gibt 1 zurueck, nicht 0: ein Faktor 0 liesse den Marker verschwinden,
 * und „die ortsmarker sollen auch nicht ein- und ausblenden" ist ein Owner-Entscheid vom
 * 24.08.2026.
 *
 * @param {number} groesseAlt Markergroesse auf der Stufe, von der aus gezoomt wird
 * @param {number} groesseNeu Markergroesse auf der Zielstufe
 * @param {number} fortschritt Weganteil der Animation, 0..1 (aus avesmapsZoomEasing)
 * @param {number} massstab Kartenfaktor des Schritts (map.getZoomScale(zielZoom)), z.B. 2 oder 0,5
 * @returns {number} Multiplikator auf die gezeichneten Groessen
 */
/**
 * Eine Projektion, die fuer eine Zoomstufe rechnet, auf der die Karte NOCH NICHT steht.
 *
 * 💣 `latLngToContainerPoint` liest immer den aktuellen Stand. Wer im `zoomanim` das Bild fuer die
 * ZIELSTUFE zeichnen will -- die Voraussetzung dafuer, dass waehrend des Zooms ueberhaupt etwas
 * einblenden kann --, muss von Hand projizieren: Weltpunkt bei Zielzoom, minus Weltpunkt des
 * Zielzentrums, plus halbe Fenstergroesse. Genau die Rechnung, die Leaflet selbst fuer den
 * aktuellen Zoom macht.
 * ⚠️ Sie haengt NICHT am Zustand der Karte: einmal geholt, liefert sie dieselben Punkte, auch wenn
 * Leaflet seinen internen Zoom inzwischen umgestellt hat (und das tut es direkt nach dem
 * zoomanim-Ereignis -- siehe docs/kartenflaechen-und-zoomblenden.md §8a).
 *
 * @param {object} karte Leaflet-Karte
 * @param {number} zielZoom Zoomstufe, FUER DIE gezeichnet wird
 * @param {object} zielCenter Zugehoeriges Zentrum (event.center)
 * @returns {function(object): {x: number, y: number}} latLng -> Containerpunkt der Zielstufe
 */
function avesmapsZoomZielProjektion(karte, zielZoom, zielCenter) {
	const groesse = karte.getSize();
	const halbe = L.point(groesse.x / 2, groesse.y / 2);
	const zentrum = karte.project(zielCenter, zielZoom);
	return (latlng) => karte.project(latlng, zielZoom).subtract(zentrum).add(halbe);
}

/**
 * Die GEGENRECHNUNG fuer eine Flaeche, die schon fuer die Zielstufe gezeichnet wurde.
 *
 * 💣 DIE RISKANTESTE STELLE DES GANZEN VORHABENS, und der Grund, warum der Vorgaengerversuch
 * (ed1e2e93) zurueckgebaut wurde -- dort stand sie von Hand geschrieben und war nie gesehen worden.
 * Das Bild liegt in ZIEL-Koordinaten, die Karte steht aber noch auf der Quellstufe. Die Flaeche
 * muss deshalb DORT starten, wo die kuenftige linke obere Ecke JETZT liegt, auf `1/massstab`
 * geschrumpft, und von da auf ihren Platz nach dem Zoom animieren. Sitzt das falsch, gleiten die
 * Namen aus der falschen Richtung oder in falscher Groesse herein -- und das sieht nur ein Auge.
 *
 * ⭐ Deshalb steht sie hier EINMAL statt zweimal von Hand in den beiden Overlays, und
 * `__tests__/zoom-vorab-flaeche.test.js` rechnet sie an einem Leaflet-Ersatz nach -- einschliesslich
 * der Probe, dass ein Weltpunkt zu BEIDEN Zeitpunkten am selben sichtbaren Ort sitzt wie bei der
 * normalen Projektion. Genau die Probe faengt einen Vorzeichenfehler.
 *
 * 🔴 Fehlt Leaflets interne `_latLngToNewLayerPoint` (kuenftige Version), wird NICHT geraten,
 * sondern `null` geliefert: der Aufrufer faellt dann auf das Verhalten ohne Vorabzeichnen zurueck.
 *
 * @param {object} karte Leaflet-Karte
 * @param {number} zielZoom Zielstufe (event.zoom)
 * @param {object} zielCenter Zielzentrum (event.center)
 * @returns {?{zielEcke: object, start: object, ende: object, startMassstab: number, massstab: number}}
 */
function avesmapsZoomVorabFlaeche(karte, zielZoom, zielCenter) {
	if (!karte || !zielCenter || !Number.isFinite(Number(zielZoom))) { return null; }
	if (typeof karte._latLngToNewLayerPoint !== "function" || typeof karte.project !== "function") { return null; }
	const groesse = karte.getSize();
	const halbe = L.point(groesse.x / 2, groesse.y / 2);
	const zielEcke = karte.unproject(karte.project(zielCenter, zielZoom).subtract(halbe), zielZoom);
	const massstab = karte.getZoomScale(zielZoom);
	if (!(massstab > 0)) { return null; }
	return {
		zielEcke,
		start: karte.latLngToLayerPoint(zielEcke),
		ende: karte._latLngToNewLayerPoint(zielEcke, zielZoom, zielCenter),
		startMassstab: 1 / massstab,
		massstab,
	};
}

function avesmapsMarkerZoomSizeFactor(groesseAlt, groesseNeu, fortschritt, massstab) {
	const alt = Number(groesseAlt);
	const neu = Number(groesseNeu);
	const s = Number(massstab);
	if (!(alt > 0) || !(neu > 0) || !(s > 0)) { return 1; }
	const e = Math.min(1, Math.max(0, Number(fortschritt) || 0));
	const gezeichnet = 1 + e * (s - 1);
	if (!(gezeichnet > 0)) { return 1; }
	return (1 + e * (neu / alt - 1)) / gezeichnet;
}
