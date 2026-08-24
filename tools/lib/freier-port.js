// Einen wirklich freien Port besorgen, statt einen zu wuerfeln.
//
// 💣 WARUM. Die Ablaufproben starten einen eigenen `php -S`. Die erste Fassung nahm
// `8000 + Math.random()*900` -- und auf diesem Rechner horchen in genau diesem Bereich die
// Vorschauserver der parallelen Sitzungen: am 23.08.2026 gemessen **fuenf** belegte Ports.
// Trifft der Wuerfel einen davon, bindet `php -S` nicht, die Anfragen gehen an den FREMDEN
// Server, und der antwortet mit einer HTML-Seite. Der Fehler liest sich dann als
// „Unexpected token '<', "<!doctype "... is not valid JSON" -- also wie ein kaputter
// Endpunkt, nicht wie eine Portkollision. Genau das ist einmal passiert, mitten in einer
// Abnahme, und hat den Verdacht auf den falschen Code gelenkt.
//
// ⚠️ Ein Restrisiko bleibt (zwischen Freigeben und Binden kann jemand dazwischenkommen), aber
// es ist ein Rennen von Millisekunden statt einer Trefferquote von 5 zu 900.
"use strict";

const net = require("net");

/** Ein vom Betriebssystem vergebener freier Port. `anzahl` liefert entsprechend viele. */
function freierPort(anzahl) {
	const wieViele = Math.max(1, Number(anzahl) || 1);
	const server = [];

	return new Promise((fertig, fehler) => {
		const naechster = () => {
			if (server.length === wieViele) {
				// 🔴 ERST ALLE binden, DANN alle freigeben -- nacheinander binden und freigeben
				// koennte denselben Port zweimal liefern, und zwei `php -S` auf einem Port sind
				// genau die Kollision, die das hier verhindern soll.
				const ports = server.map((s) => s.address().port);
				let offen = server.length;
				server.forEach((s) => s.close(() => {
					offen -= 1;
					if (offen === 0) { fertig(ports); }
				}));
				return;
			}
			const s = net.createServer();
			s.once("error", fehler);
			s.listen(0, "127.0.0.1", () => { server.push(s); naechster(); });
		};
		naechster();
	});
}

module.exports = { freierPort: freierPort };
