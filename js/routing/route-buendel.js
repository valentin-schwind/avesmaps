// Wegpunkte zu Anfragen mit `via` buendeln (Entwurf 2026-09-14 §5.3).
// 💣 LAST AUF STRATO: je Wegpunktpaar eine Anfrage hiesse bei „Weg als Route" auf der Reichsstrasse 2 neununddreissig
// schwere Anfragen am Stueck. Der Server faehrt `via` Etappe fuer Etappe auf EINEM Graphen
// (avesmapsFindClientCompatibleRouteLegs, api/_internal/routing/client-graph.php).
// ⚠️ ZWILLING: AVESMAPS_ROUTE_MAX_VIA in api/_internal/routing/request.php -- mehr Zwischenhalte lehnt der Server ab.
// route-buendel.test.js haelt beide Werte gegeneinander.
const AVESMAPS_ROUTE_MAX_VIA = 10;

/**
 * REIN: die Buendel als Indexbereiche {von, bis}, beide einschliesslich; das Ende eines Buendels ist der Anfang des
 * naechsten. 🔴 Ein Kartenpunkt („Hierher reisen") steht nie in `via` -- der Server nimmt ihn nur als from_point/to_point.
 */
function avesmapsRouteBuendel(stationen, maxVia) {
	const liste = Array.isArray(stationen) ? stationen : [];
	const roh = Number(maxVia);
	const deckel = Math.max(0, Math.floor(Number.isFinite(roh) ? roh : AVESMAPS_ROUTE_MAX_VIA));
	const buendel = [];
	let von = 0;
	while (von < liste.length - 1) {
		let bis = von + 1;
		while (bis < liste.length - 1 && bis - von < deckel + 1 && !(liste[bis] && liste[bis].isMapPoint)) {
			bis += 1;
		}
		buendel.push({ von, bis });
		von = bis;
	}
	return buendel;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_ROUTE_MAX_VIA, avesmapsRouteBuendel };
}
