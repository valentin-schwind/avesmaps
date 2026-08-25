// Die API-Nutzungstafel im Reiter Status.
// Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md
//
// ⚠️ Kein Modul, kein Build -- die Datei laeuft im selben Dokument wie
// review-visitor-analytics.js und benutzt deren vaBars/vaDonut/vaHeatmap/vaBytes mit. Sie wird in
// index.html NACH jener Datei geladen; die Reihenfolge ist ein Vertrag und im Test festgehalten.

const API_METRICS_URL = "api/app/api-metrics.php";
let apiDashboardTage = 7;

function apiEscape(wert) {
	const halter = document.createElement("div");
	halter.textContent = String(wert === null || wert === undefined ? "" : wert);
	return halter.innerHTML;
}

// Die Farben der fuenf Klassen.
// 🔴 „leer" ist die wichtigste und bekommt den neutralen, kraeftigen Ton -- sie ist kein
// Fehlerzustand des Servers, sondern ein Ausfall VOR jeder Antwort, und sie soll sich von 5xx
// unterscheiden lassen.
// 🪤 `--color-warning`, NICHT `--color-warn`. Eine undefinierte CSS-Variable macht die ganze
// Deklaration ungueltig -- der Balken waere durchsichtig gewesen und haette wie ein fehlender Wert
// ausgesehen. Das Mockup hatte den Fehler nicht gefunden, weil es seine Tokens selbst definierte.
const API_KLASSEN_FARBEN = {
	"2xx": "var(--color-success)",
	"3xx": "var(--color-text-muted)",
	"4xx": "var(--color-warning)",
	"5xx": "var(--color-danger)",
	leer: "var(--color-button)",
};

function apiKlassenBalken(klassen) {
	const zeilen = (klassen || []).filter((z) => Number(z.c) > 0);
	if (zeilen.length === 0) {
		// 💣 Ein Satz, KEINE Nullbalken. „Zahl da, Balken leer" liest sich wie „Wert ist 0" --
		// genau daran standen im Besucher-Dashboard acht Balkenlisten monatelang unbemerkt.
		return '<div class="va-storage">noch keine Daten</div>';
	}
	const summe = zeilen.reduce((a, z) => a + Number(z.c), 0);
	const stapel = zeilen.map((z) => {
		const anteil = (Number(z.c) / summe) * 100;
		const farbe = API_KLASSEN_FARBEN[z.dimension] || "var(--color-text-muted)";
		return '<i style="width:' + (Math.round(anteil * 10) / 10) + "%;background:" + farbe + '"></i>';
	}).join("");
	const legende = zeilen.map((z) => {
		const farbe = API_KLASSEN_FARBEN[z.dimension] || "var(--color-text-muted)";
		return '<span><i style="background:' + farbe + '"></i>' + apiEscape(z.dimension)
			+ "&nbsp;" + Number(z.c).toLocaleString("de-DE") + "</span>";
	}).join("");
	return '<div class="va-stack">' + stapel + '</div><div class="va-legend">' + legende + "</div>";
}

// 🪤 Ein stummer Zaehler sieht aus wie Ruhe. Entzieht STRATO bei voller Quote die Schreibrechte,
// verschluckt der Schreiber den Fehler pflichtgemaess -- und leere Balken sind von „keine
// Anfragen" nicht zu unterscheiden. Diese Zeile ist der Unterschied. Dieselbe Klasse wie die
// stille app_setting-Kuerzung, die den Tempowerte-Knopf wochenlang wirkungslos machte.
function apiZaehlstandSatz(letzteZaehlung) {
	if (!letzteZaehlung) {
		return "Es wurde noch nichts gezählt.";
	}
	const heute = new Date().toISOString().slice(0, 10);
	if (String(letzteZaehlung) === heute) {
		return "";
	}
	return "Zuletzt gezählt am " + apiEscape(letzteZaehlung)
		+ " — seither nichts gezählt. Zählt der Server noch?";
}

// Die Endpunkte, die von SELBST im Takt fragen -- ohne dass jemand etwas tut.
//
// 🔴 HERGELEITET, NICHT GERATEN. Jeder Eintrag steht fuer ein setInterval im Frontend; die
// Sekundenzahl ist die dort gesetzte. Ein Editor mit offenem Panel erzeugt damit rund 180
// Anfragen je Stunde, ein blosser Besucher-Tab 60 -- diese fuehren jede Rangliste an und sind
// trotzdem kaum echte Arbeit.
//
// 💣 `app/map-features` gehoert AUSDRUECKLICH NICHT dazu, obwohl der Live-Abgleich alle 15 s
// laeuft: er fragt zuerst `app/map-revision` (die billige Sonde) und holt die Nutzlast NUR, wenn
// sich die Revision bewegt hat (`pollLiveMapUpdates`, js/routing/routing.js). Wer map-features
// mitzaehlte, erklaerte jede echte Kartenladung zum Takt.
const API_TAKT_ENDPUNKTE = {
	"app/heartbeat": 60,          // js/app/visitor-tracking.js -- jeder offene Besucher-Tab
	"app/map-revision": 15,       // js/routing/routing.js -- Live-Abgleich, nur im Editiermodus
	"edit/map/presence": 30,      // js/review/review-panels.js -- jeder offene Editor
	"edit/reports/locations": 45, // js/review/review-panels.js -- Meldungen-Abfrage
};

/**
 * Anteil der Takt-Anfragen an allen gezaehlten, in Prozent -- oder null, wenn nichts gezaehlt ist.
 *
 * ⚠️ Gerechnet wird ueber die ENDPUNKTliste, nicht ueber eine eigene Metrik: die Namen stehen
 * ohnehin da, es kostet keine Spalte und keine Schemaaenderung.
 */
function apiTaktAnteil(endpunkte) {
	const zeilen = endpunkte || [];
	let gesamt = 0;
	let takt = 0;
	zeilen.forEach((z) => {
		const anzahl = Number(z.c) || 0;
		gesamt += anzahl;
		if (Object.prototype.hasOwnProperty.call(API_TAKT_ENDPUNKTE, z.dimension)) {
			takt += anzahl;
		}
	});
	if (gesamt === 0) {
		return null;
	}
	return (takt / gesamt) * 100;
}

function apiEndpunktKarte(endpunkte) {
	const zeilen = (endpunkte || []).slice(0, 10);
	if (zeilen.length === 0) {
		return '<div class="va-card"><p class="va-card__label">Meistgerufene Endpunkte</p>'
			+ '<div class="va-storage">noch keine Daten</div></div>';
	}
	return '<div class="va-card"><p class="va-card__label">Meistgerufene Endpunkte</p>'
		+ vaBars(zeilen, "var(--color-accent-brown)") + "</div>";
}

function apiFehlerKarte(fehler) {
	const zeilen = fehler || [];
	if (zeilen.length === 0) {
		return '<div class="va-card"><p class="va-card__label">Häufigste Fehler</p>'
			+ '<div class="va-storage">keine Fehler im Zeitraum</div></div>';
	}
	const liste = zeilen.slice(0, 8).map((z) => {
		const teile = String(z.dimension).split("|");
		const code = teile.length > 1 ? teile.pop() : "";
		const endpunkt = teile.join("|");
		// „fatal" ist der Fatal-Error-Fall: er traegt die neutrale Plakette und heisst im Bild
		// „leer" -- dasselbe Wort wie in der Klassenlegende, damit man beides zusammenbringt.
		const art = code === "fatal" ? "neutral" : "warn";
		return '<div class="va-feed"><span class="va-feed__tag va-feed__tag--' + art + '">'
			+ apiEscape(code === "fatal" ? "leer" : code) + "</span>"
			+ '<span class="va-feed__label">' + apiEscape(endpunkt) + "</span>"
			+ '<span class="va-feed__meta">' + Number(z.c).toLocaleString("de-DE") + "×</span></div>";
	}).join("");
	return '<div class="va-card"><p class="va-card__label">Häufigste Fehler</p>' + liste + "</div>";
}

// ⭐ Der Ring wird NICHT nachgebaut: vaDonut(rows, cols) steht bereits in
// review-visitor-analytics.js und zeichnet genau diese Form samt Legende. Eine zweite Fassung
// liefe beim ersten Nachbessern auseinander.
//
// 🔴 Genau vier Farben, weil es genau vier Zonen sind -- vier Reihen ist die gerechnete Grenze der
// Projektpalette. vaDonut wiederholt sie sonst still (`cols[i % cols.length]`), und Segment 5
// saehe aus wie Segment 1.
const API_ZONEN_FARBEN = ["#2a78d6", "#1baf7a", "#b8792c", "#7c4fa6"];
const API_ZONEN_NAMEN = {
	app: "eigene Karte",
	edit: "Editoren",
	offen: "offene API",
	sonstige: "übrige",
};

function apiZonenKarte(zonen) {
	const zeilen = (zonen || []).filter((z) => Number(z.c) > 0);
	if (zeilen.length === 0) {
		return '<div class="va-card"><p class="va-card__label">Wer ruft an</p>'
			+ '<div class="va-storage">noch keine Daten</div></div>';
	}
	// vaDonut liest `r.dimension` als Beschriftung -- die Klarnamen also VOR der Uebergabe setzen,
	// nicht danach im Markup suchen.
	const benannt = zeilen.map((z) => ({
		dimension: API_ZONEN_NAMEN[z.dimension] || z.dimension,
		c: Number(z.c),
	}));
	return '<div class="va-card"><p class="va-card__label">Wer ruft an</p>'
		+ vaDonut(benannt, API_ZONEN_FARBEN) + "</div>";
}

function apiSpeicherKarte(storage) {
	const tabelle = ((storage && storage.tables) || [])[0];
	const text = tabelle
		? "api_metric · " + Number(tabelle.rows || 0).toLocaleString("de-DE") + " Zeilen · "
			+ vaBytes(tabelle.bytes)
		: "keine Angabe";
	return '<div class="va-card"><p class="va-card__label">Die Tafel selbst</p>'
		+ '<p class="va-storage">' + apiEscape(text) + "<br>Älter als 400 Tage wird beim Schreiben "
		+ "still weggeräumt.</p></div>";
}

function renderApiDashboard(mount, data) {
	const m = (data && data.metrics) || {};
	const gesamt = (m.klassen || []).reduce((a, z) => a + Number(z.c), 0);
	const schlecht = (m.klassen || [])
		.filter((z) => z.dimension === "4xx" || z.dimension === "5xx" || z.dimension === "leer")
		.reduce((a, z) => a + Number(z.c), 0);
	const quote = gesamt > 0 ? ((schlecht / gesamt) * 100).toFixed(1).replace(".", ",") : "0,0";

	const hinweis = apiZaehlstandSatz(data && data.letzte_zaehlung);

	// „davon Takt": die Endpunkte, die von selbst fragen. Ohne diese Zeile liest man die
	// Gesamtzahl als Nutzung, obwohl ein guter Teil davon ein Ping ist.
	const taktAnteil = apiTaktAnteil(m.endpunkte);
	const taktZeile = taktAnteil === null
		? ""
		: '<div class="va-kpi__trend flat" title="' + apiEscape(Object.keys(API_TAKT_ENDPUNKTE).join(" · "))
			+ '">davon Takt: ' + taktAnteil.toFixed(taktAnteil < 10 ? 1 : 0).replace(".", ",") + " %</div>";

	mount.innerHTML =
		(hinweis ? '<div class="va-card"><p class="va-storage">⚠️ ' + hinweis + "</p></div>" : "")
		+ '<div class="va-kpis">'
		+ '<div class="va-kpi"><div class="va-kpi__label">Anfragen</div><div class="va-kpi__value">'
		+ gesamt.toLocaleString("de-DE") + "</div>" + taktZeile + "</div>"
		+ '<div class="va-kpi"><div class="va-kpi__label">Fehlerquote</div><div class="va-kpi__value">'
		+ quote + " %</div></div>"
		+ '<div class="va-kpi"><div class="va-kpi__label">Zeitraum</div><div class="va-kpi__value">'
		+ apiEscape(data && data.days) + '<span style="font-size:12px"> Tage</span></div></div>'
		+ "</div>"
		+ apiEndpunktKarte(m.endpunkte)
		+ '<div class="va-card"><p class="va-card__label">Wie geantwortet wurde</p>'
		+ apiKlassenBalken(m.klassen)
		+ '<p class="va-storage" style="margin-top:9px">„leer" = die Antwort ging nie durch den '
		+ "Trichter. Ein Fatal Error sieht im Browser aus wie ein Netzfehler.</p></div>"
		+ apiFehlerKarte(m.fehler)
		+ apiZonenKarte(m.zonen)
		+ '<div class="va-card"><p class="va-card__label">Wann die Last liegt (Ortszeit)</p>'
		+ vaHeatmap(m.stunden || []) + "</div>"
		+ apiSpeicherKarte(data && data.storage);
}

async function loadApiDashboard() {
	const mount = document.getElementById("api-dashboard");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	mount.innerHTML = '<div class="va-off">Wird geladen ...</div>';
	let data;
	try {
		const response = await fetch(API_METRICS_URL + "?days=" + apiDashboardTage + "&_=" + Date.now(), {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		data = await response.json();
	} catch (error) {
		mount.innerHTML = '<div class="va-off">Konnte die API-Statistik nicht laden.</div>';
		return;
	}
	if (!data || data.ok !== true) {
		mount.innerHTML = '<div class="va-off">Konnte die API-Statistik nicht laden.</div>';
		return;
	}
	if (data.enabled === false) {
		mount.innerHTML = '<div class="va-off">Die API-Zählung ist ausgeschaltet.</div>';
		return;
	}
	renderApiDashboard(mount, data);
}
