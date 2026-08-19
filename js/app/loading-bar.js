// Top-of-viewport loading progress bar (Google/YouTube-style), driver for css/features/loading-bar.css.
// Covers two cases with one mechanism (a small set of pending "jobs"):
//   B) initial page load: a "boot" job, active from the moment this script runs until the map data is
//      applied (the "avesmaps:map-ready" event, dispatched at the end of the route-data .then in routing.js).
//   A) base-map tiles: a "tiles" job, driven by Leaflet's tile-layer "loading"/"load" events (wired via
//      AvesmapsLoadingBar.attachTiles, called from createBaseTileLayer in bootstrap.js).
// The bar trickles toward 90% while anything is pending and snaps to 100% + fades out when the last job
// finishes. Tile jobs only show the bar after a short delay so fast (warm-cache) loads don't flash it; the
// boot job shows immediately. Purely cosmetic -- it does not make anything faster, it removes the
// "is it frozen?" feeling during the cold first load and tile fetches. Load this EARLY (before the heavy
// map scripts) so it appears during the initial load; it creates its own DOM and needs only document.body.
(function initLoadingBar() {
	if (typeof document === "undefined" || window.AvesmapsLoadingBar) {
		return;
	}
	const host = document.body || document.documentElement;
	if (!host) {
		return;
	}

	const bar = document.createElement("div");
	bar.id = "avesmaps-loading-bar";
	bar.className = "avesmaps-loading-bar";
	bar.setAttribute("aria-hidden", "true");
	const fill = document.createElement("div");
	fill.className = "avesmaps-loading-bar__fill";
	bar.appendChild(fill);
	host.appendChild(bar);

	// Der Startschleier. Dieselbe Frage („laeuft der Start noch?"), also dieselbe Datei -- er haengt
	// an derselben `avesmaps-booting`-Klasse wie der Knopfbund und der Planer und bekommt damit auch
	// deren 20-Sekunden-Netz geschenkt. Wie er aussieht, steht in css/features/loading-bar.css.
	// ⚠️ Der Satz steht DEUTSCH im Knoten und traegt `data-i18n`. `window.tr` gibt es hier NICHT:
	// diese Datei laeuft in index.html Zeile 247, js/app/i18n.js erst in Zeile 3003. Der Uebersetzer
	// laeuft dann einmal ueber das Dokument und zieht den Satz nach -- unter ?lang=en steht er auf
	// einem kalten Ladevorgang also kurz deutsch da. Eine zweite Spracherkennung hier waere der
	// teurere Fehler; dass es davon nur EINE gibt, wiegt die Sekunde auf.
	// 💣 `data-i18n` gehoert an ein Element, das NUR den Text enthaelt: der Uebersetzer setzt
	// `el.textContent = v` und raeumte eine SVG im selben Knoten mit weg (die Falle steht zweimal
	// in index.html vermerkt). Die Windrose ist deshalb ein GESCHWISTER, kein Kind.
	const veil = document.createElement("div");
	veil.className = "avesmaps-boot-veil";
	const veilText = document.createElement("div");
	veilText.className = "avesmaps-boot-veil__text";
	veilText.setAttribute("data-i18n", "boot.loading");
	veilText.setAttribute("role", "status");
	veilText.textContent = "Karte wird geladen …";
	veil.appendChild(veilText);

	// Die Windrose -- das Wappen der alten Karten, gewaehlt aus vier vorgelegten Fassungen
	// (Owner 19.08.2026: „die windrose ist schön").
	// 🔴 Sie STEHT. Bewegt wird allein das goldene Stueck auf dem Aussenring, wie ein
	// Sonnenschatten: eine kreiselnde Kompassrose liest sich als „verirrt", nicht als „laedt".
	// 💣 Kein Farbwert im Markup -- die Farben haengen an Klassen und kommen aus dem Stylesheet
	// (AGENTS.md §12). Ein Literal hier faende kein CSS-Sweep je, und im dunklen Thema stuende es
	// als schwarzer Fleck da.
	// Die acht Zacken entstehen in zwei Schleifen, damit die Drehwinkel nicht achtmal von Hand
	// dastehen. Gezeichnet wird in einem 0..100-Feld um den Mittelpunkt 50,50.
	function windroseMarkup() {
		let zacken = "";
		// vier LANGE Zacken (N/O/S/W), je zwei Haelften hell/dunkel -- die Seekarten-Optik
		[0, 90, 180, 270].forEach(function (grad) {
			zacken += '<g transform="rotate(' + grad + ' 50 50)">'
				+ '<path class="avesmaps-boot-veil__pale" d="M50 15 L43.5 43.5 L50 50 Z"/>'
				+ '<path class="avesmaps-boot-veil__ink" d="M50 15 L56.5 43.5 L50 50 Z"/>'
				+ "</g>";
		});
		// vier KURZE Zacken (NO/SO/SW/NW)
		[45, 135, 225, 315].forEach(function (grad) {
			zacken += '<g transform="rotate(' + grad + ' 50 50)">'
				+ '<path class="avesmaps-boot-veil__pale" d="M50 27 L46 46 L50 50 Z"/>'
				+ '<path class="avesmaps-boot-veil__ink" d="M50 27 L54 46 L50 50 Z"/>'
				+ "</g>";
		});
		return '<svg class="avesmaps-boot-veil__rose" viewBox="0 0 100 100" aria-hidden="true">'
			+ '<circle class="avesmaps-boot-veil__track" cx="50" cy="50" r="46" fill="none"'
			+ ' stroke-width="1.5"/>'
			// 💣 Die Luecke ist AUS DEM UMFANG gerechnet: 24 Striche auf r=40, Umfang 2*PI*40 =
			// 251,33, davon ein Vierundzwanzigstel = 10,47, minus 1,6 Strichlaenge = 8,87. Eine
			// geratene Zahl laesst den Kranz sichtbar auslaufen -- der letzte Strich trifft den
			// ersten nicht. Der Test rechnet es nach.
			+ '<circle class="avesmaps-boot-veil__track" cx="50" cy="50" r="40" fill="none"'
			+ ' stroke-width="4" stroke-dasharray="1.6 8.87"/>'
			+ zacken
			+ '<circle class="avesmaps-boot-veil__hub" cx="50" cy="50" r="2.6"/>'
			// Das laufende Stueck: 48 von 289,03 Umfang (2*PI*46), also rund ein Sechstel des
			// Kreises -- gross genug, um es zu sehen, klein genug, um nicht als Ring zu lesen.
			+ '<circle class="avesmaps-boot-veil__sweep" cx="50" cy="50" r="46" fill="none"'
			+ ' stroke-width="3" stroke-linecap="round" stroke-dasharray="48 241"/>'
			+ "</svg>";
	}

	const rose = document.createElement("div");
	rose.className = "avesmaps-boot-veil__ring";
	rose.innerHTML = windroseMarkup();
	veil.insertBefore(rose, veilText);
	host.appendChild(veil);

	const pending = new Set();
	let progress = 0;
	let visible = false;
	let trickleTimer = null;
	let hideTimer = null;
	let showDelayTimer = null;
	let completeTimer = null;
	let shownAt = 0;
	const MIN_VISIBLE_MS = 450;

	function paint() {
		fill.style.width = (progress * 100).toFixed(2) + "%";
	}

	function trickle() {
		if (progress < 0.9) {
			progress += (0.9 - progress) * 0.08 + 0.004;
			paint();
		}
	}

	function show() {
		if (visible) {
			return;
		}
		visible = true;
		shownAt = Date.now();
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		progress = Math.max(progress, 0.08);
		bar.classList.add("avesmaps-loading-bar--active");
		paint();
		if (!trickleTimer) {
			trickleTimer = setInterval(trickle, 240);
		}
	}

	function finishComplete() {
		if (trickleTimer) {
			clearInterval(trickleTimer);
			trickleTimer = null;
		}
		progress = 1;
		paint();
		hideTimer = setTimeout(() => {
			bar.classList.remove("avesmaps-loading-bar--active");
			visible = false;
			progress = 0;
			// Snap the fill back to empty without animating the rewind (would look like a bounce).
			fill.style.transition = "none";
			paint();
			window.requestAnimationFrame(() => {
				fill.style.transition = "";
			});
		}, 360);
	}

	function complete() {
		if (completeTimer) {
			return;
		}
		// Mindest-Sichtbarkeit: bei warmem Cache ist der Job in ~200ms durch -> ohne dies blitzt der Balken
		// unsichtbar vorbei. Ab dem Erscheinen halten wir ihn mindestens MIN_VISIBLE_MS, dann sauber abschliessen.
		const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt);
		if (remaining > 0) {
			completeTimer = setTimeout(() => {
				completeTimer = null;
				finishComplete();
			}, remaining);
			return;
		}
		finishComplete();
	}

	function refresh() {
		if (pending.size > 0) {
			if (completeTimer) {
				clearTimeout(completeTimer);
				completeTimer = null;
			}
			if (visible) {
				return;
			}
			if (pending.has("boot")) {
				show(); // initial load: show immediately, no flash concern
			} else if (!showDelayTimer) {
				// tile loads: only show if still pending after a beat -> warm/fast loads don't flash the bar
				showDelayTimer = setTimeout(() => {
					showDelayTimer = null;
					if (pending.size > 0) {
						show();
					}
				}, 160);
			}
		} else {
			if (showDelayTimer) {
				clearTimeout(showDelayTimer);
				showDelayTimer = null;
			}
			if (visible) {
				complete();
			}
		}
	}

	function inc(key) {
		pending.add(key);
		refresh();
	}

	function dec(key) {
		pending.delete(key);
		refresh();
	}

	// Der Startlauf hat genau EINEN Anfang und EIN Ende, und beides weiss nur diese Datei. Deshalb
	// haengt hier neben dem Balken auch die Klasse `avesmaps-booting` auf <html>: die Kartenknoepfe
	// warten darunter, bis es etwas zu bedienen gibt (Owner 12.08.2026 -- „kann man nicht buttons
	// anzeigen nachdem alles geladen hat?"). Welche Knoepfe das sind, steht im Stylesheet
	// (css/features/loading-bar.css); hier steht nur, WANN.
	// 💣 Ein zweiter Zuhoerer auf `avesmaps:map-ready` waere die falsche Loesung gewesen: das Event
	// kann feuern, BEVOR ein spaeter geladenes Skript ueberhaupt parst (siehe den Vermerk in
	// map-features-infopanel.js) -- der zweite Zuhoerer haette es verpasst und die Knoepfe fuer
	// immer versteckt. Diese Datei laedt frueh und traegt das Sicherheitsnetz schon.
	function bootBeenden() {
		document.documentElement.classList.remove("avesmaps-booting");
		dec("boot");
	}

	// Boot job (B): active until the map data is applied.
	inc("boot");
	document.documentElement.classList.add("avesmaps-booting");
	document.addEventListener("avesmaps:map-ready", function onReady() {
		document.removeEventListener("avesmaps:map-ready", onReady);
		bootBeenden();
	});
	// Safety net: never let the boot bar hang forever (e.g. if the data load errors before dispatching ready).
	// 🔴 Es traegt jetzt mehr als den Balken: laeuft es nicht, blieben die Knoepfe unerreichbar. Der
	// Datenload feuert `map-ready` zwar im `.finally()`, also auch bei einem Fehler -- aber ein Skript,
	// das vorher stirbt, kommt dort nie an.
	window.setTimeout(bootBeenden, 20000);

	// Tile job (A): wire a Leaflet tile layer's loading/load events. "load" fires when ALL current tiles are
	// loaded, so clearing on it is correct regardless of how many "loading" events fired.
	function attachTiles(layer) {
		if (!layer || typeof layer.on !== "function" || layer.__avesmapsLoadingBarBound) {
			return;
		}
		layer.__avesmapsLoadingBarBound = true;
		layer.on("loading", () => inc("tiles"));
		layer.on("load", () => dec("tiles"));
	}

	window.AvesmapsLoadingBar = { inc, dec, attachTiles };
})();
