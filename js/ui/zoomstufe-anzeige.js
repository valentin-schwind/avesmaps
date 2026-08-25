/*
 * Die Zoomstufe an der Karte -- nur im Editormodus.
 *
 * Fall #100 (Thomas, 25.08.2026): "Aktuelle Zoomstufe sollte zumindest im Editorenmodus
 * angezeigt werden." Editoren brauchen sie, weil an der Stufe Zoombaender haengen: welche
 * Ortsklasse erscheint, welches Territorium traegt seinen Namen, ab wann eine Flaeche zeichnet.
 * Ohne Anzeige muss man raten, auf welcher Stufe man gerade einstellt.
 *
 * Entwurf: docs/zoomstufe-mockup.html (Owner-Abnahme 25.08.2026).
 *
 * 🔴 Weisse Schrift, KEIN Kaestchen (Owner: "mach weiße schrift auf transparentem untergrund").
 * Der Rueckhalt darunter ist woertlich der Schatten der Ortsnamen (`.location-name-label span` in
 * css/features/map-labels.css) -- dieselbe Aufgabe, dieselbe Rezeptur, keine zweite erfinden.
 * 💣 Nicht bei `.map-label span` nachsehen: dort steht der Schatten in derselben Sammelregel, wird
 * aber zwei Regeln spaeter auf `none` zurueckgenommen, weil jene Labels Canvas-<img> sind.
 *
 * 💣 Diese Datei enthaelt NUR Funktionsdeklarationen, keine Ausfuehrung auf oberster Ebene: sie
 * wird vor js/app/bootstrap.js geladen, und dort gibt es `map` noch gar nicht.
 */

/**
 * Haengt die Anzeige IN den Behaelter der +/- Knoepfe und verdrahtet sie mit der Karte.
 *
 * 💣 Sie ist bewusst KEIN eigenes Leaflet-Control neben dem Zoom-Control, obwohl das der
 * naheliegende Weg waere. Der Grund ist gemessen, nicht vermutet (25.08.2026, im Browser):
 * `.avesmaps-infopanel-mode .leaflet-control-zoom` (css/features/infopanel.css) reisst die
 * Knoepfe per `position: fixed` aus Leaflets Ecke und legt sie unten rechts ueber den Knopfbund --
 * und bei offenem Panel noch einmal um die Panelbreite nach links. Als Nachbar-Control blieb die
 * Zahl oben rechts stehen (gemessen: Anzeige top 10, Knoepfe top 977), also quer ueber den
 * Bildschirm von dem entfernt, wozu sie gehoert. Und genau im Editormodus ist sie ja sichtbar.
 *
 * 🔴 Deshalb die Verschachtelung: als Kind des Zoom-Behaelters folgt sie JEDER Verlegung von
 * selbst, ohne dass irgendwo eine zweite Regel nachgezogen wird. Die Alternative waere gewesen,
 * die drei Positionsregeln aus infopanel.css hier zu spiegeln -- also zwei Antworten auf dieselbe
 * Frage, die beim naechsten Verschieben auseinanderlaufen (AGENTS.md §12).
 * ⚠️ `.leaflet-control` bringt `position: relative` mit, im verlegten Fall ist es `fixed`: beides
 * ist ein Bezugsrahmen, das `position: absolute` der Anzeige greift also in beiden Lagen.
 */
function avesmapsZoomstufeAnhaengen(map, behaelter) {
	if (!behaelter || typeof map?.on !== "function" || typeof document === "undefined") {
		return null;
	}

	const wurzel = document.createElement("div");
	wurzel.className = "zoomstufe-anzeige";
	// Vorlesen bringt hier nichts: die Zahl ist eine Ablesehilfe zu den Knoepfen daneben, und der
	// Zoom wird ueber sie bedient, nicht ueber diese Anzeige.
	wurzel.setAttribute("aria-hidden", "true");

	const zahl = document.createElement("span");
	zahl.className = "zoomstufe-anzeige__zahl";
	const wort = document.createElement("span");
	wort.className = "zoomstufe-anzeige__wort";
	wort.textContent = "Zoom";
	wurzel.appendChild(zahl);
	wurzel.appendChild(wort);
	behaelter.appendChild(wurzel);

	const schreiben = () => avesmapsZoomstufeSchreiben(zahl, map);
	schreiben();

	// "zoom" waehrend der Bewegung, "zoomend" am Ziel: beim Ziehen am Rad soll die Zahl mitlaufen
	// und nicht erst am Ende springen.
	map.on("zoom", schreiben);
	map.on("zoomend", schreiben);

	return wurzel;
}

/**
 * Schreibt die gerundete Stufe in das Element.
 *
 * 💣 Der NaN-Riegel ist nicht schmueckend: ein nicht-endlicher Zoom hat hier schon einmal eine
 * ganze Kette vergiftet (der NaN-Schwenk, der die Routenfindung mitriss). Ist der Wert unbrauchbar,
 * bleibt die zuletzt geschriebene Zahl stehen -- eine alte Zahl ist besser als "NaN" auf der Karte.
 *
 * ⚠️ Gerundet, nicht abgeschnitten: am Trackpad ist der Zoom stufenlos, und `Math.trunc` zeigte
 * auf halbem Weg nach oben noch die untere Stufe an.
 */
function avesmapsZoomstufeSchreiben(element, map) {
	if (!element || typeof map?.getZoom !== "function") {
		return;
	}

	const stufe = Number(map.getZoom());
	if (!Number.isFinite(stufe)) {
		return;
	}

	const text = String(Math.round(stufe));
	if (element.textContent !== text) {
		element.textContent = text;
	}
}
