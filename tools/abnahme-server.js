// Abnahme-Server fuer den Arbeitsbaum: liefert die EIGENEN Dateien aus (JS, CSS, HTML) und reicht
// nur /api/ und /tiles/ an die Live-Seite weiter.
//
// Warum: api/config.local.php ist gitignored und liegt nirgends lokal -- ein blosser `php -S` auf
// diesem Baum zeigt eine Karte ganz ohne Daten, und dann laesst sich weder ein Wegname noch ein
// Kurvenlabel ansehen. So sieht man den GEBAUTEN Code mit den ECHTEN Daten.
//
// ⚠️ Die Daten kommen aus der Produktion. Was hier zu sehen ist, ist der Live-Datenstand -- am
// 22.08.2026 also genau EINE Flaeche mit eingeschalteter Kurvenbeschriftung (die Drachensteine).
// ⚠️ Kein Schreibzugriff: alles ausser GET wird abgelehnt, damit eine Abnahme nie in der
// Produktionsdatenbank landet.
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

// 💣 Aus `__dirname` abgeleitet, NICHT aus `process.cwd()`. Der Vorschau-Dienst startet diesen
// Prozess im HAUPT-Baum, nicht dort, wo die Datei liegt -- mit cwd hat der Server am 22.08.2026
// klaglos den 150 Commits alten Hauptbaum ausgeliefert, und jede Messung daran galt dem falschen
// Code. Es sah nicht nach einem Fehler aus: die Karte lud, die Wegnamen standen, die Zahlen waren
// plausibel. Aufgeflogen ist es erst, weil eine Funktion in der Seite `undefined` war.
// ⚠️ Diese Datei liegt in tools/ -- die Wurzel ist also eine Ebene DARUEBER.
const WURZEL = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8845;
const LIVE = "avesmaps.de";

const TYPEN = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
	".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
};

function weiterreichen(req, res, pfad) {
	if (req.method !== "GET") {
		res.writeHead(405, { "content-type": "text/plain" });
		res.end("Nur GET -- eine Abnahme schreibt nicht in die Produktion.");
		return;
	}
	const anfrage = https.request({
		host: LIVE, path: pfad, method: "GET",
		headers: { "accept-encoding": "identity", "user-agent": "avesmaps-abnahme-lokal" },
	}, (antwort) => {
		const kopf = {};
		for (const k of ["content-type", "etag", "cache-control"]) {
			if (antwort.headers[k]) { kopf[k] = antwort.headers[k]; }
		}
		res.writeHead(antwort.statusCode || 502, kopf);
		antwort.pipe(res);
	});
	anfrage.on("error", (e) => {
		res.writeHead(502, { "content-type": "text/plain" });
		res.end("Live-Seite nicht erreichbar: " + e.message);
	});
	anfrage.end();
}

http.createServer((req, res) => {
	const zerlegt = url.parse(req.url);
	const pfad = decodeURIComponent(zerlegt.pathname || "/");

	if (pfad.startsWith("/api/") || pfad.startsWith("/tiles/") || pfad.startsWith("/uploads/")) {
		weiterreichen(req, res, req.url);
		return;
	}

	// 💣 Kein Ausbruch aus dem Arbeitsbaum: der aufgeloeste Pfad MUSS darunter liegen.
	const datei = path.resolve(WURZEL, "." + (pfad === "/" ? "/index.html" : pfad));
	if (!datei.startsWith(WURZEL)) {
		res.writeHead(403); res.end("ausserhalb"); return;
	}
	fs.readFile(datei, (fehler, inhalt) => {
		if (fehler) {
			// Was es lokal nicht gibt, holt die Live-Seite -- Bilder, Icons, alles Statische, das
			// nicht im Repo liegt (der Deploy loescht nie, AGENTS.md §10).
			weiterreichen(req, res, req.url);
			return;
		}
		let rumpf = inhalt;
		// 💣 js/config.js schaltet die Karten-API an einer HOSTLISTE frei (SQL_MAP_HOSTS: nur
		// avesmaps.de und der STRATO-Host). Auf localhost bleibt MAP_FEATURES_API_URL leer, und die
		// Karte laedt gar keine Daten ("Keine Map-Features-API fuer diese Umgebung konfiguriert").
		// Die Datei dafuer anzufassen waere ein Hack im Repo -- config.js sieht dafuer eine
		// Ueberschreibung vor, und die wird hier beim Ausliefern eingespritzt. Das Repo bleibt sauber.
		if (datei.toLowerCase().endsWith(".html")) {
			const einspritzung = "<script>window.AVESMAPS_MAP_FEATURES_ENDPOINT = \"api/app/map-features.php\";</script>";
			const text = inhalt.toString("utf8");
			const kopf = text.indexOf("<head>");
			if (kopf >= 0) {
				rumpf = Buffer.from(text.slice(0, kopf + 6) + einspritzung + text.slice(kopf + 6), "utf8");
			}
		}
		res.writeHead(200, {
			"content-type": TYPEN[path.extname(datei).toLowerCase()] || "application/octet-stream",
			"cache-control": "no-store",
		});
		res.end(rumpf);
	});
}).listen(PORT, "127.0.0.1", () => {
	console.log("Abnahme-Server auf http://127.0.0.1:" + PORT + " -- Dateien aus " + WURZEL + ", /api und /tiles von " + LIVE);
});
