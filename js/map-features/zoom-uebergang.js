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

const AVESMAPS_ZOOM_DAUER_MS = 250;
const AVESMAPS_ZOOM_KURVE_PUNKTE = [0.42, 0, 0.58, 1];
const AVESMAPS_ZOOM_KURVE = "cubic-bezier(0.42, 0, 0.58, 1)";

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
