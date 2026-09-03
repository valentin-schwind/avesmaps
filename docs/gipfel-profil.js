// Die Steigungsfunktion eines GIPFELS, als PROTOTYP -- wie steil faellt ein Berg von seiner Spitze ab?
//
// 🔴 WAS HEUTE GILT. `sampleEcosystemHeightFieldRaw` rechnet je Gipfelbuckel
//     q = d² / r²    und    h = a · (1 − q)³
// Das ist eine KUPPE, keine Spitze: die Ableitung ist im Zentrum exakt null, das Feld liegt dort also
// auf einem flachen Plateau. Im Bild wird daraus ein diffuser heller Hof statt eines Gipfels -- und
// genau darauf hat der Owner am 03.09.2026 gezeigt („kannst du die spitzer machen, idealerweise sind
// die gipfelspitzen voll weiss").
//
// 🔴 DIE VERALLGEMEINERUNG, mit der sich beides aus EINER Formel ergibt:
//     h = a · (1 − (d/r)^e)^k
//   e = 2, k = 3  ->  die heutige Kuppe, Zeichen fuer Zeichen
//   e = 1, k = 1  ->  ein Kegel: lineare Flanke, echte Spitze
//   e < 1         ->  konkave Flanke, noch spitzer (ein Horn)
// Ein Regler faehrt zwischen beiden Enden; bei Schaerfe 0 kommt exakt das heutige Feld heraus, und das
// ist die Bedingung dafuer, dass man die Aenderung ueberhaupt beurteilen kann.
//
// 💣 DIE ZWEI INVARIANTEN BLEIBEN, und zwar fuer JEDE Wahl von e und k:
//   - f(0) = 1  ->  am Gipfel liest man exakt seine eingetragene Hoehe. Sie haengt nur daran, dass die
//     Formel im Zentrum 1 ergibt, nicht an ihrer Steigung.
//   - f(1) = 0  ->  der Buckel hat kompakten Traeger, endet also am Radius. Daran haengt die
//     Fusshoehe-0-Invariante und mit ihr die Verschmelzung zweier ueberlappender Flaechen.
// ⚠️ Die Radiusklemme (r ≤ 0,72 × Abstand zum naechsten Gipfel) bleibt unberuehrt -- sie sorgt dafuer,
// dass kein Buckel bis zu einem anderen Gipfel reicht, und sie ist von der Profilform unabhaengig.
//
// 🪤 UND EIN SPITZERES PROFIL IST FUER DAS GIPFELFENSTER SOGAR BESSER. Bei der Kuppe ist die Ableitung
// im Zentrum null, der Hochpunkt kann also durch das Rauschen daneben wandern -- deshalb daempft
// `buildEcosystemPeakWindow` das Rauschen dort ausdruecklich mit Steigung null. Beim Kegel ist die
// Flanke im Zentrum am steilsten; der Gipfel ist damit von sich aus der Hochpunkt.
//
// Alles in KARTENkoordinaten. Kein DOM, kein Leaflet, kein Modulzustand.

// Die Vorgabe ist das HEUTIGE Feld: e = 2, k = 3.
const GIPFEL_PROFIL_HEUTE = { e: 2, k: 3 };
// Das andere Ende des Reglers: e = 1 (linear im Abstand statt quadratisch), k = 2.
//
// 🪤 GEMESSEN, NICHT GERATEN -- der erste Versuch (e = 0,75, k = 1) war falsch herum. Er machte die
// Flanke zwar an der Spitze steiler, liess den Berg aber am FUSS weiter hinausreichen: bei d/r = 0,9
// stand er auf 7,6 % statt 0,7 % der Hoehe. Ein Berg, der unten breiter wird, sieht nicht spitzer aus,
// sondern groesser. Mit e = 1, k = 2 faellt er an BEIDEN Enden schaerfer:
//   d/r =   0,05   0,20   0,50   0,90
//   heute   99,3   88,5   42,2    0,7 %
//   spitz   90,3   64,0   25,0    1,0 %
// 🔴 Die Ableitung im Zentrum ist −2 statt 0 -- das ist die eigentliche Spitze. Bei der heutigen Kuppe
// ist sie exakt null, deshalb liegt dort ein Plateau und im Bild ein diffuser Hof.
const GIPFEL_PROFIL_SPITZ = { e: 1, k: 2 };

// Die Exponenten zu einer Schaerfe 0..1. 🔴 Bei 0 exakt die heutigen Werte -- das ist die Bedingung
// dafuer, dass „aus" wirklich „unveraendert" heisst und nicht „fast wie vorher".
function gipfelProfilExponenten(schaerfe) {
	const t = Math.min(1, Math.max(0, Number(schaerfe) || 0));

	return {
		e: GIPFEL_PROFIL_HEUTE.e + (GIPFEL_PROFIL_SPITZ.e - GIPFEL_PROFIL_HEUTE.e) * t,
		k: GIPFEL_PROFIL_HEUTE.k + (GIPFEL_PROFIL_SPITZ.k - GIPFEL_PROFIL_HEUTE.k) * t,
	};
}

// Der Formfaktor 0..1 an einem Punkt im Abstand `d` von einem Gipfel mit Radius `r`.
// 💣 Ausserhalb des Radius exakt 0 -- kompakter Traeger, siehe Kopf.
function gipfelProfilFaktor(d, r, exponenten) {
	if (!(r > 0)) {
		return 0;
	}
	const t = d / r;
	if (t >= 1) {
		return 0;
	}
	if (t <= 0) {
		return 1;
	}
	const e = exponenten && Number(exponenten.e) > 0 ? Number(exponenten.e) : GIPFEL_PROFIL_HEUTE.e;
	const k = exponenten && Number(exponenten.k) > 0 ? Number(exponenten.k) : GIPFEL_PROFIL_HEUTE.k;
	// 🪤 `Math.pow(t, 2)` ist messbar langsamer als `t * t`, und dieser Zweig laeuft je Rasterpunkt je
	// Gipfel. Die beiden haeufigen Faelle deshalb ausgeschrieben.
	const u = 1 - (e === 2 ? t * t : (e === 1 ? t : Math.pow(t, e)));
	if (u <= 0) {
		return 0;
	}

	return k === 3 ? u * u * u : (k === 1 ? u : Math.pow(u, k));
}

// Die Gipfelhoehe an einer Stelle, aus den Buckeln EINES Feldes.
//
// 💣 `bumps` sind die `peakBumps` des echten Feldbaus -- {x, y, a, i} mit `i = 1 / r²`. Radius und
// Amplitude werden also NICHT neu erfunden: die Radiusklemme, die den Sattel zwischen zwei Gipfeln
// erzwingt, und die Amplitude, die die eingetragene Hoehe IST, kommen unveraendert von dort. Neu ist
// hier ausschliesslich die FORM der Flanke.
function gipfelProfilHoehe(bumps, x, y, exponenten) {
	let hoehe = 0;
	for (let n = 0; n < bumps.length; n++) {
		const b = bumps[n];
		const dx = x - b.x;
		const dy = y - b.y;
		const q = (dx * dx + dy * dy) * b.i;
		if (q >= 1) {
			continue;
		}
		hoehe += b.a * gipfelProfilFaktor(Math.sqrt(q), 1, exponenten);
	}

	return hoehe;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		GIPFEL_PROFIL_HEUTE, GIPFEL_PROFIL_SPITZ,
		gipfelProfilExponenten, gipfelProfilFaktor, gipfelProfilHoehe,
	};
}
