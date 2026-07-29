// Landschaften — das Höhenfeld EINER Fläche (V8).
//
// Portiert aus dem lauffähigen Prototyp `html/landschaften-modell.html`: cellHash :402, level :413,
// peakWindow :452, rawArea :464, buildArea :491. Die Rechnung ist bewusst wortgleich übernommen; was
// abweicht, steht unten je Stelle mit Begründung.
//
// 🔴 WAS DAS FELD IST. Eine Summe kompakter Buckel: benannte Gipfel tragen ihre eingetragene Höhe,
// dazwischen füllt stratifiziertes Rauschen auf. Am Rand der Fläche läuft alles auf null aus
// (Fußhöhe-0-Invariante) — daran hängt, dass sich zwei überlappende Gebirge zu einem Zug verschmelzen
// lassen, statt sich zu stapeln (map-features-ecosystem-height-combine.js).
//
// 🔴 KEIN Math.random(). Die Saat kommt aus `public_id` + Geometrie-Revision. Echter Zufall lieferte bei
// jedem Neuberechnen andere Reisezeiten und verschöbe Routen lautlos (oekosystem-instruction.md §4.2).
//
// 💣 sampleRoute() :637 des Prototyps ist NICHT portiert — feste Schrittweite, keine Klemmen. Das
// gehört zu V11 und wird dort neu geschrieben, nicht kopiert.
//
// Gerechnet wird durchgehend in KARTENkoordinaten 0..1024, nie in Bildschirmpunkten (AGENTS.md §5).
// Die Pixelmaske und das feste W/H des Prototyps entfallen deshalb ersatzlos.

// Wie viele Verfeinerungsstufen über der groben. Fest verdrahtet und dokumentiert, nicht nach Augenmaß:
// die Buckelzahl verzerrt das Ergebnis selbst -- der Reisezeit-Faktor steigt monoton mit ihr, und das
// Vorzeichen der Richtungs-Asymmetrie kippt zwischen 2 und 4 Buckeln (oekosystem-instruction.md §4.1).
// Welche Label-Subtypen sind für V8 ein Gipfel? 🔴 EINE Liste, von allen fünf Stellen gelesen
// (Ebenenumschaltung, Label-Dialog, Flächendialog, Zeichnen, Kontextmenü) -- eine zweite wäre die
// Sorte Doppelpflege, an der `vulkan` schon einmal durchgefallen ist.
//
// `vulkan` gehört dazu, seit er am 2026-07-27 ein eigener Subtyp wurde: er wird wie ein Berggipfel
// gezeichnet, ist ein topographischer PUNKT und hat eine Höhe. Ihn auszunehmen wäre der Sonderfall,
// nicht ihn aufzunehmen.
// ⚠️ Am 2026-07-28 gibt es live **kein einziges** `vulkan`-Label (Revision 45280). Die Regel greift
// also erst, wenn welche gesetzt werden -- sie ist Vorsorge, keine Reparatur.
const ECOSYSTEM_PEAK_SUBTYPES = ["berggipfel", "vulkan"];

function isEcosystemPeakSubtype(subtype) {
	return ECOSYSTEM_PEAK_SUBTYPES.includes(String(subtype || ""));
}

// 🔴 DREI DARSTELLUNGSVERFAHREN, gewählt nach der ART der Fläche (Owner-Entscheid 2026-07-28):
// Gebirge bekommt „Exponential Slope Weighting", Hügelland „Domain Warping", alles andere das
// additive Rauschen, das dieses Modul ohnehin baut.
//
// 🔴 ES GEHT UM DIE DARSTELLUNG. Alle drei verformen das FELD, nicht die Daten: `height_schritt` am
// Gipfel bleibt unangetastet, und alle drei lassen die zwei tragenden Invarianten stehen --
//   - am Gipfel liest man weiter genau seine Zahl -- bei Slope Weighting von selbst (dort ist die
//     Neigung null), beim Warping NICHT von selbst: dessen Versatz wird eigens mit dem Gipfelfenster
//     gedämpft, und ohne das las ein 3.000er 2.970 (vom Unit-Test gefangen), und
//   - am Rand bleibt die Höhe 0 (jedes Verfahren multipliziert oder verschiebt nur, es addiert nichts).
// Wer hier ein viertes ergänzt, muss beides nachweisen, sonst bricht die Verschmelzung zweier Flächen.
//
// ⚠️ V11 soll das später gegen echte Reisezeiten beurteilen und Verbesserungen vorschlagen; bis dahin
// sind die Parameter gewählt und nicht gemessen.
//
// 🔴 DAS VIERTE, „ridged" (2026-07-29): scharfe helle Grate, dunkle Täler -- das Bild, auf das der Owner
// gezeigt hat. Die drei darüber kommen dort nicht hin, und zwar grundsätzlich nicht: Warping verzieht
// Buckel zu welligen Buckeln, Slope Weighting flacht sie ab. **Grate entstehen in der BASIS, nicht in der
// Nachbearbeitung.** Deshalb `1 − |n|` über mehrere Oktaven statt eines vierten Nachbearbeitungsschritts.
const ECOSYSTEM_TERRAIN_METHODS = ["perlin", "warp", "slope", "ridged"];
// Wie viele Oktaven der Grat hat, und wie schnell sie leiser werden. Vier reichen: die fünfte liegt bei
// dieser Körnung unter einem Rasterpunkt der Malschleife (4 px) und wäre nur noch Rechenzeit.
const ECOSYSTEM_RIDGED_OCTAVES = 3;
const ECOSYSTEM_RIDGED_GAIN = 0.5;
// Wie scharf der Grat wird. `1 − |n|` allein gibt einen KNICK; die Potenz zieht die Flanken herunter und
// macht daraus einen schmalen hellen Kamm über breiten dunklen Tälern. 1 = weich, 3 = sehr schroff.
const ECOSYSTEM_RIDGED_SHARPNESS = 2;
// Die gröbste Gratweite, als Anteil der groben Buckelzelle. Kleiner = mehr Grate je Massiv.
const ECOSYSTEM_RIDGED_CELL_SHARE = 0.55;
// Wie stark „Exponential Slope Weighting" steile Flanken abflacht (α der Quelle). Klein = sanfte
// Hügel, gross = zerklüftet. Die Neigung wird auf 0..1 normiert, damit α unabhängig von der Höhe wirkt.
const ECOSYSTEM_TERRAIN_SLOPE_ALPHA = 0.35;
// Wie weit „Domain Warping" die Abfragestelle verschiebt, in Kartenkoordinaten. Zu viel macht aus
// Hügeln Schlieren; das hier verzieht sie sichtbar, ohne die Buckel zu zerreissen.
const ECOSYSTEM_TERRAIN_WARP_STRENGTH = 6;

const ECOSYSTEM_HEIGHT_LEVELS = 3;
// Körnung: Kantenlänge der groben Zelle = längste bbox-Seite / dieser Wert.
const ECOSYSTEM_HEIGHT_GRAIN = 3.2;
// Budget. Die Zellzahl einer Stufe wächst mit (Teiler × 2^k)² -- bei feiner Körnung UND hoher Stufe
// sind das Millionen Zellen. Deshalb wird VOR jeder Stufe geschätzt und notfalls abgebrochen; wo das
// Budget gegriffen hat, sagt es das Feld (`stoppedAtLevel`), statt still weniger zu liefern.
const ECOSYSTEM_HEIGHT_MAX_CELLS = 240000;
const ECOSYSTEM_HEIGHT_MAX_BUMPS = 14000;
// 🔴 STANDARDHÖHE eines Gipfels ohne erfassten Wert: 5.000 Schritt (Owner-Entscheid 2026-07-28). Der
// Prototyp setzte 1.000 als reinen NaN-Schutz (:509); hier ist es mehr als das -- es ist die Höhe, mit
// der die Karte einen noch unbearbeiteten Gipfel TATSÄCHLICH zeichnet. Live trägt heute kein einziges
// der 62 Gipfel-Labels eine Höhe, also hängt das ganze erste Kartenbild an dieser Zahl.
//
// Der Label-Dialog stellt seinen Regler auf denselben Wert (review-labels.js), damit die angezeigte
// Zahl und die gerechnete dieselbe sind statt zweier Wahrheiten nebeneinander.
const ECOSYSTEM_HEIGHT_DEFAULT = 5000;
// Alter Name, damit ein Aufrufer von aussen nicht bricht. Neue Stellen nehmen ECOSYSTEM_HEIGHT_DEFAULT.
const ECOSYSTEM_HEIGHT_PLACEHOLDER = ECOSYSTEM_HEIGHT_DEFAULT;
// Rauschpegel als Anteil des NIEDRIGSTEN Gipfels dieser Fläche. Der Prototyp zieht ihn aus einem Regler
// je Fläche (`a.avg`, :532); den gibt es hier nicht, weil die Höhe am Gipfel wohnt (Owner-Entscheid
// 2026-07-28). Damit überragt erfundenes Gelände nie einen benannten Gipfel -- dieselbe Absicht wie
// `avgMax = minG` im Prototyp, nur ohne Regler.
// ⚠️ Startwert, nach Augenmaß zu prüfen, keine gemessene Größe.
// ⚠️ ES IST DAS MAXIMUM DES RAUSCHENS, NICHT SEIN DURCHSCHNITT. Die Dämpfung unten rechnet
// `Ziel / lautester Punkt` -- getroffen wird also die HÖCHSTE erfundene Stelle. Der Regler hiess bis
// 2026-07-29 „Durchschnittshöhe" und log damit: wer 9.850 einstellte, bekam eine einzelne 9.850er
// Kuppe und viel niedrigeres Gelände darunter. Seit `3344e4bc` heisst er ehrlich „Maximalhöhe".
const ECOSYSTEM_HEIGHT_NOISE_SHARE = 0.4;
// 🔴 DER DURCHSCHNITT IST DIE ZWEITE ZAHL (Owner-Auftrag 2026-07-29). Zwei Zahlen beschreiben die FORM
// des Geländes, nicht nur seine Spitze -- ein Hochplateau (Ø 3.000 / max 3.500) ist etwas anderes als
// zerklüftetes Vorland (Ø 800 / max 4.000), und mit dem Maximum allein liessen die beiden sich nicht
// unterscheiden.
//
// Zwei Zwänge, zwei Freiheitsgrade: das Rauschen wird als `Faktor · Rohwert^Potenz` gelesen, und beide
// werden EINMAL beim Bauen so bestimmt, dass der lauteste Punkt auf die Maximalhöhe und der
// Flächenmittelwert auf die Durchschnittshöhe fällt. Potenz < 1 hebt das Mittelfeld an (Plateau),
// Potenz > 1 drückt es weg (zerklüftet).
//
// 💣 MULTIPLIKATIV, KEIN SOCKEL. `Faktor · x^Potenz` ist bei x = 0 exakt 0 -- die Fusshöhe-0-Invariante
// bleibt damit wortwörtlich stehen, und mit ihr die Verschmelzung zweier überlappender Flächen. Ein
// additiver Sockel („überall mindestens Ø") bräche beides, und zwar unsichtbar bis auf die Nahtstellen.
// Der Unit-Test prüft es für alle drei Verfahren.
//
// ⚠️ Die POTENZ wird beim Bauen gesucht, ANGEWANDT wird sie je Abfrage -- anders geht es nicht: das
// Rauschen ist eine SUMME von Buckeln, und eine nichtlineare Umformung dieser Summe lässt sich nicht in
// die einzelnen Amplituden zurückrechnen (eine reine Skalierung schon, und genau die wird weiter unten
// auch dorthin gefaltet). Ohne eingestellten Durchschnitt ist die Potenz exakt 1, und dann kostet die
// Malschleife keinen Takt mehr als vorher -- die Abfrage vergleicht nur eine Zahl.
// 💣 DIE UNTERE KLEMME IST KEINE GESCHMACKSFRAGE, SIE SCHÜTZT DIE NAHTSTELLEN. Die Felder zweier
// Flächen werden ADDIERT (map-features-ecosystem-height-combine.js:160) -- dass das keine Stufe gibt,
// hängt allein daran, dass jedes Feld zum Rand hin auf 0 ausläuft. Wie BREIT dieser Auslauf ist, bestimmt
// die Potenz: das Feld steht bei halber Höhe, wo der Rohwert 0,5^(1/p) erreicht -- bei p = 1 auf halbem
// Weg, bei p = 0,2 schon nach 3 % des Auslaufs. Darunter wird aus dem Auslauf eine Wand, und die Naht
// zweier überlappender Flächen ist als Kante sichtbar.
//
// ⚠️ FOLGE, gemessen: der Durchschnitt lässt sich höchstens auf rund 0,67 × Maximalhöhe ziehen. Wer mehr
// einstellt, bekommt 0,67 -- ein Hochplateau, dessen Mittel NÄHER am Maximum liegt, ist keine Fläche mehr,
// die zum Rand hin ausläuft. Der Regler nennt das in seinem Hinweistext, statt still zu sättigen.
const ECOSYSTEM_NOISE_EXPONENT_MIN = 0.2;
const ECOSYSTEM_NOISE_EXPONENT_MAX = 8;
// Wie viele Eimer das Histogramm hat, mit dem die Potenz gesucht wird. 💣 NICHT über die Rohwerte
// suchen: die Messschleife sammelt je nach Flächengröße einige zehntausend Abtastungen, und die Suche
// wertet den Mittelwert rund 40-mal aus -- das wären Millionen `Math.pow` bei jedem Reglerruck. Über 128
// Eimer sind es 5.120, und der Fehler bleibt unter einer halben Eimerbreite.
const ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS = 128;
// Wo der Mittelwert von selbst landet, als Anteil des Maximums. ⚠️ GEMESSEN, nicht geschätzt: an einem
// 100×100-Quadrat mit einem Gipfel sind es 0,205 bei 1 Stufe, 0,231 bei 3 (der Vorgabe) und 0,234 bei 4.
// Der Modulkopf behauptete bis 2026-07-29 „grob ein Drittel" -- das war zu hoch gegriffen.
// Rein für die „(auto)"-Anzeige im Dialog, damit dort eine plausible Zahl steht statt einer leeren
// Zeile; gerechnet wird ohne sie (Potenz = 1).
const ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO = 0.23;

// Saat aus der Identität der Fläche, nicht aus dem Zufall. Ändert sich die Geometrie, ändert sich die
// Revision und damit das Rauschen -- was richtig ist: eine neu gezogene Fläche ist ein anderes Gebirge.
function ecosystemHeightSeed(area) {
	const text = String(area?.public_id || "") + "#" + String(area?.geometry_revision ?? 0);
	let seed = 0;
	for (let i = 0; i < text.length; i++) {
		seed = (Math.imul(seed, 31) + text.charCodeAt(i)) | 0;
	}

	return seed;
}

// Per-CELL hash (Prototyp :402): die Lage eines Buckels hängt nur an (Saat, Stufe, Zellindex) -- nicht
// daran, wie viele Buckel vorher kamen, und nicht am Umriss. Deshalb bleibt beim Verfeinern alles stehen.
function ecosystemHeightCellHash(seed, level, ix, iy, salt) {
	let n = (seed ^ Math.imul(level + 1, 0x9E3779B1) ^ Math.imul(ix, 0x85EBCA6B)
		^ Math.imul(iy, 0xC2B2AE35) ^ Math.imul(salt, 0x27D4EB2F)) | 0;
	n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D); n ^= n >>> 12;
	n = Math.imul(n ^ (n >>> 15), 0x297A2D39); n ^= n >>> 15;

	return (n >>> 0) / 4294967296;
}

// 🔴 EIN Fenster über ALLE Gipfel ALLER Flächen (Portierung von peakWindow :452 und der sep-Schleife
// :500-502, beide im Prototyp an EINE Fläche gebunden).
//
// Es leistet zweierlei, und beides muss flächenübergreifend gelten:
//
//  - `sample(x, y)` zieht das Rauschen am Gipfel auf null -- UND ZWAR MIT STEIGUNG NULL. Der Buckel
//    (1-q²)³ hat in seinem Zentrum selbst Steigung null, dort zählt also allein das Gefälle des
//    Rauschens; blosses Abschwächen genügte nicht, der Hochpunkt wanderte trotzdem weg. t = d²/D² ist
//    quadratisch im Abstand, die Ableitung verschwindet am Gipfel.
//  - `separation` ist der kleinste Abstand zwischen zwei Gipfeln. Klemmt man jeden Gipfelradius auf
//    0,72 × diesen Wert, dann reicht KEIN Gipfelbuckel bis zu einem anderen Gipfel -- und damit liest
//    jeder Gipfel genau seine eigene Zahl, auch wenn sich dort mehrere Flächen überlagern.
function buildEcosystemPeakWindow(peaks) {
	const points = (Array.isArray(peaks) ? peaks : [])
		.filter((peak) => Number.isFinite(Number(peak?.x)) && Number.isFinite(Number(peak?.y)))
		.map((peak) => ({ x: Number(peak.x), y: Number(peak.y) }));

	// 💣 Abstand JE GIPFEL zu seinem nächsten Nachbarn -- nicht ein globales Minimum über alle.
	//
	// Der Prototyp nimmt das globale Minimum (:500-502), und in seiner Welt stimmt das: dort liegen ein
	// paar Gipfel in EINER Fläche. Über den Livebestand gezogen ist es falsch. Liegen irgendwo zwei
	// Gipfel dicht beieinander -- bei 62 Stück und zwei gleichnamigen Dubletten ist das der Normalfall --,
	// dann klemmt dieser eine kleine Abstand JEDEN Radius weltweit. Im Bild sah man es sofort: statt
	// Bergkuppen standen 9 helle Punkte in einer sonst flachen Fläche.
	//
	// Die Invariante bleibt: ist r(A) < 0,72 × dem Abstand von A zu SEINEM nächsten Nachbarn, dann ist
	// r(A) erst recht kleiner als der Abstand zu jedem anderen Gipfel -- kein Gipfelbuckel reicht also
	// bis zu einem anderen Gipfel, und jeder liest weiter genau seine eigene Zahl.
	const separations = new Map();
	for (let i = 0; i < points.length; i++) {
		let nearest = Infinity;
		for (let j = 0; j < points.length; j++) {
			if (i === j) {
				continue;
			}
			const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
			if (distance < nearest) {
				nearest = distance;
			}
		}
		separations.set(points[i], nearest);
	}
	// Für Aufrufer, die nur einen Wert wollen (und für die Erklärung): das kleinste Paar überhaupt.
	let separation = Infinity;
	separations.forEach((value) => { separation = Math.min(separation, value); });

	return {
		points,
		separation,
		separations,
		// Abstand dieses Gipfels zu seinem nächsten Nachbarn. Ein einzelner Gipfel weit und breit hat
		// keinen -- er bekommt Infinity und wird damit allein vom Randabstand und der 150er Obergrenze
		// geklemmt, was richtig ist: da ist nichts, wovon er sich absetzen müsste.
		separationAt(x, y) {
			for (let k = 0; k < this.points.length; k++) {
				if (this.points[k].x === x && this.points[k].y === y) {
					return this.separations.get(this.points[k]) ?? Infinity;
				}
			}

			return Infinity;
		},
		// Radien stehen erst beim Bauen der Felder fest, das Fenster braucht aber schon eine Breite.
		// Sie wird beim ersten Feldbau eingetragen (siehe buildEcosystemHeightField).
		radii: new Map(),
		// 🔴 PERF, gemessen: `sample()` läuft in der Malschleife rund 60.000-mal je Bild. Vor dieser
		// Verdichtung tastete es JEDEN Gipfel ab -- live 62 --, obwohl nur die einen Radius haben, die
		// in einer Fläche liegen und dort zum Buckel wurden; das waren 9. Gemessen: 24,1 ms je 60.000
		// Abfragen, der grösste Einzelposten im Bild.
		//
		// Ein Gipfel ohne Radius kann per Definition nichts fenstern. Nach dem Bau aller Felder wird die
		// Liste deshalb auf die wirksamen eingedampft. Vorher geht das nicht: die Radien entstehen erst
		// beim Feldbau, und der braucht das Fenster bereits.
		compact() {
			this.points = this.points.filter((point) => (this.radii.get(point) || 0) > 0);
		},
		sample(x, y) {
			let smallest = 1;
			for (let k = 0; k < this.points.length; k++) {
				const point = this.points[k];
				const radius = this.radii.get(point) || 0;
				if (radius <= 0) {
					continue;
				}
				const limit = radius * radius * 0.36;
				const dx = x - point.x;
				const dy = y - point.y;
				const squared = dx * dx + dy * dy;
				if (squared >= limit) {
					continue;
				}
				const t = squared / limit;
				const smoothed = t * t * (3 - 2 * t);
				if (smoothed < smallest) {
					smallest = smoothed;
				}
			}

			return smallest;
		},
	};
}

// Eine stratifizierte Stufe (Prototyp :413): Gitter der Zellgröße c in ABSOLUTEN Kartenkoordinaten, ein
// verwackelter Buckel je Zelle. Stratifiziert statt gleichverteilt, weil zufällige Punkte klumpen und
// Löcher lassen.
function ecosystemHeightLevel(field, level, cell, amplitude, out) {
	const bounds = field.bounds;
	for (let ix = Math.floor(bounds.min_x / cell) - 1; ix <= Math.ceil(bounds.max_x / cell) + 1; ix++) {
		for (let iy = Math.floor(bounds.min_y / cell) - 1; iy <= Math.ceil(bounds.max_y / cell) + 1; iy++) {
			const px = (ix + 0.15 + 0.7 * ecosystemHeightCellHash(field.seed, level, ix, iy, 1)) * cell;
			const py = (iy + 0.15 + 0.7 * ecosystemHeightCellHash(field.seed, level, ix, iy, 2)) * cell;
			if (!pointInGeometry([px, py], field.geometry)) {
				continue;
			}
			// 💣 distanceToEcosystemEdge, nicht der distEdge des Prototyps: der kennt nur EINEN Ring.
			// Eine Fläche mit Loch bekäme dort Buckel, die ins Loch ragen, und die Fußhöhe-0-Invariante
			// bricht -- sichtbar erst spät, weil das Loch meist weit vom nächsten Gipfel liegt.
			const radius = Math.min(cell * 0.85, distanceToEcosystemEdge([px, py], field.geometry));
			if (radius < cell * 0.3) {
				continue;
			}
			out.push({
				x: px, y: py, r: radius,
				a: amplitude * (0.55 + 0.9 * ecosystemHeightCellHash(field.seed, level, ix, iy, 3)),
			});
		}
	}
}

// Buckel haben kompakten Träger: ausserhalb ihres Radius EXAKT null. Jeder wird deshalb in die Zellen
// eingetragen, die sein Trägerquadrat berührt, und eine Abfrage liest nur ihre eigene Zelle. Weil der
// Radius dem Zellabstand folgt, decken überall etwa gleich viele -- die Auswertung wird damit unabhängig
// von der Buckelzahl (Prototyp :432).
function buildEcosystemHeightIndex(field, noise) {
	const radii = noise.map((bump) => bump.r);
	const largest = radii.length ? Math.max(...radii) : 32;
	const smallest = radii.length ? Math.min(...radii) : 32;
	const cell = Math.max(10, Math.min(largest, Math.max(smallest, 18)));
	const bounds = field.bounds;
	const originX = Math.floor(bounds.min_x) - cell;
	const originY = Math.floor(bounds.min_y) - cell;
	const width = Math.ceil((bounds.max_x - originX) / cell) + 2;
	const height = Math.ceil((bounds.max_y - originY) / cell) + 2;
	const grid = new Array(width * height);

	for (const bump of noise) {
		const i0 = Math.max(0, Math.floor((bump.x - bump.r - originX) / cell));
		const i1 = Math.min(width - 1, Math.floor((bump.x + bump.r - originX) / cell));
		const j0 = Math.max(0, Math.floor((bump.y - bump.r - originY) / cell));
		const j1 = Math.min(height - 1, Math.floor((bump.y + bump.r - originY) / cell));
		for (let j = j0; j <= j1; j++) {
			for (let i = i0; i <= i1; i++) {
				const key = j * width + i;
				(grid[key] || (grid[key] = [])).push(bump);
			}
		}
	}

	field.grid = grid;
	field.gridCell = cell;
	field.gridWidth = width;
	field.gridHeight = height;
	field.gridOriginX = originX;
	field.gridOriginY = originY;
}

// Die Potenz suchen, mit der aus dem gemessenen Rauschen der gewünschte Mittelwert wird.
//
// Nach der Skalierung gilt am lautesten Punkt genau die Maximalhöhe; für das Mittel bleibt damit ein
// einziger Zwang übrig. Mit u = Rohwert / lautester Punkt (also 0..1) ist der Mittelwert des fertigen
// Feldes `max · Mittel(u^p)`, gesucht ist also p mit `Mittel(u^p) = Ø / max`.
//
// `Mittel(u^p)` fällt in p streng monoton (jedes u liegt bei höchstens 1), deshalb genügt eine
// Intervallhalbierung -- kein Newton, keine Ableitung, keine Konvergenzsorgen. Liegt das Verhältnis
// ausserhalb dessen, was die Klemmen hergeben, wird geklemmt statt gerechnet: eine Fläche, deren
// Mittelwert nahe am Maximum liegen soll, ist ein Plateau, und flacher als p = 0,2 wird sie nicht.
function solveEcosystemNoiseExponent(samples, loudest, ratio) {
	if (!Array.isArray(samples) || samples.length === 0 || !(loudest > 0)) {
		return 1;
	}
	// Histogramm über u = Wert / lautester Punkt, die Eimermitte vertritt den Eimer.
	//
	// 💣 ECHTE NULLEN GEHÖREN IN KEINEN EIMER. `0^p` ist 0 für jedes p, aber die Mitte des ersten Eimers
	// ist es nicht -- bei kleiner Potenz liest sie sich als 0,78 statt 0. Mit den Nullen im ersten Eimer
	// hielte die Suche ein Plateau für erreichbar, das die Fläche gar nicht hergibt, und der eingestellte
	// Durchschnitt würde still verfehlt. Sie zählen deshalb nur im Nenner mit -- da gehören sie hin, es
	// sind Stellen der Fläche.
	const buckets = new Array(ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS).fill(0);
	for (let i = 0; i < samples.length; i++) {
		if (!(samples[i] > 0)) {
			continue;
		}
		let index = Math.floor((samples[i] / loudest) * ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS);
		if (index < 0) {
			index = 0;
		}
		if (index >= ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS) {
			index = ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS - 1;
		}
		buckets[index]++;
	}
	const centres = buckets.map((_, index) => (index + 0.5) / ECOSYSTEM_NOISE_HISTOGRAM_BUCKETS);
	const meanAt = (exponent) => {
		let sum = 0;
		for (let index = 0; index < buckets.length; index++) {
			if (buckets[index] > 0) {
				sum += buckets[index] * Math.pow(centres[index], exponent);
			}
		}

		return sum / samples.length;
	};

	let low = ECOSYSTEM_NOISE_EXPONENT_MIN;
	let high = ECOSYSTEM_NOISE_EXPONENT_MAX;
	if (meanAt(low) <= ratio) {
		return low;                            // flacher geht nicht -- das Ziel liegt zu nah am Maximum
	}
	if (meanAt(high) >= ratio) {
		return high;                           // zerklüfteter geht nicht -- das Ziel liegt zu tief
	}
	// 40 Halbierungen bringen das Intervall von rund 8 auf 1e-11; teuer ist daran nichts, weil jeder
	// Schritt nur über die 64 Eimer läuft.
	for (let step = 0; step < 40; step++) {
		const middle = (low + high) / 2;
		if (meanAt(middle) > ratio) {
			low = middle;
		} else {
			high = middle;
		}
	}

	return (low + high) / 2;
}

// Das Feld EINER Fläche.
//
// 💣 `peaks` ist die Liste ALLER Gipfel, nicht nur der eigenen. Zu BUCKELN werden nur die innerhalb der
// Fläche; klemmen und fenstern tun alle. Das ist der ganze Unterschied zum Prototyp, und er ist der
// Grund, warum das Zusammensetzen mehrerer Flächen (Aufgabe 7) so klein ausfällt.
//
// Eine Fläche OHNE eigenen Gipfel bekommt kein Feld und liefert überall 0: ein Gebirge ganz ohne
// Stützpunkt zu erfinden wäre genau das „erfundene Geländedetail", vor dem §4.1 warnt.
function buildEcosystemHeightField(area, peaks, peakWindow, options = {}) {
	const geometry = area?.geometry_geojson || area?.geometry || null;
	const bounds = geometry ? ecosystemGeometryBounds(geometry) : null;
	const field = {
		areaPublicId: String(area?.public_id || ""),
		geometry,
		bounds,
		seed: ecosystemHeightSeed(area),
		peakBumps: [],
		bumps: [],
		grid: null,
		hmax: 0,
		stoppedAtLevel: 0,
		// Die Umformung des Rauschens: `noiseScale · Rohwert^noiseExponent` (siehe Kopf). 1/1 heisst
		// „nichts tun" -- ohne eingestellte Durchschnittshöhe bleibt es dabei, und die Skalierung wandert
		// dann in die Buckelamplituden, wo sie seit V8 sitzt. Die Abfrage prüft nur `!== 1`.
		noiseScale: 1,
		noiseExponent: 1,
		// Gröbste Gratweite in KARTENkoordinaten. Steht erst fest, wenn die bbox bekannt ist (unten);
		// bis dahin ein Wert, mit dem eine Fläche ohne Geometrie nicht durch 0 teilt.
		ridgedCell: 1,
		// Ab welcher Buckelsumme die Hülle des Gratverfahrens auf 1 steht -- und zugleich die Einheit, in
		// der das Gratfeld rechnet, damit Dämpfung und Potenz danach dasselbe Maß vorfinden wie vorher.
		ridgedEnvelope: 0,
		ridgedUnit: 0,
		// Welches Darstellungsverfahren diese Fläche benutzt (siehe oben). Unbekannt -> additiv.
		method: ECOSYSTEM_TERRAIN_METHODS.includes(String(options.method || "")) ? String(options.method) : "perlin",
	};
	if (!geometry || !bounds) {
		return field;
	}

	const own = (Array.isArray(peaks) ? peaks : []).filter((peak) => {
		const x = Number(peak?.x);
		const y = Number(peak?.y);

		return Number.isFinite(x) && Number.isFinite(y) && pointInGeometry([x, y], geometry);
	});
	// 🔴 ZWEI HÖHENQUELLEN, NICHT MEHR NUR EINE (2026-07-29).
	//
	// Bis hierher galt: keine Gipfel in der Fläche -> flach, „statt ein Gebirge ohne Stützpunkt zu
	// erfinden". Diese Regel stammt aus der Zeit, als die Höhe AUSSCHLIESSLICH am Gipfel wohnte
	// (Owner-Entscheid 2026-07-28) und es je Fläche gar nichts einzustellen gab. Seit die Fläche ihre
	// eigene Maximalhöhe trägt, ist sie ein zweiter, gleichwertiger Stützpunkt -- und dann ist das
	// Gelände nicht mehr „erfunden", sondern genauso erfasst wie eine Gipfelhöhe, nur an der Fläche.
	// Live stand „Thasch" (Gebirge, 2.000/500 eingetragen, kein Gipfel) deshalb flach da, obwohl beide
	// Zahlen gesetzt waren -- vom Owner gemeldet.
	//
	// 💣 REIN ZUSÄTZLICH. Eine Fläche MIT Gipfel erreicht diesen Zweig nie und rechnet Zahl für Zahl
	// weiter wie vorher; der Test hält das ausdrücklich fest. Der Zweig kann nur Flächen treffen, die
	// heute überhaupt nichts zeichnen.
	//
	// 🪤 `> 0` und nicht „gesetzt": eine eingetragene 0 heisst in diesem Modul überall wörtlich flach.
	// Ohne Gipfel UND ohne Maximalhöhe bleibt es flach -- dann gäbe es wirklich nichts abzuleiten.
	const explicitTarget = Number.isFinite(Number(options.avgHeight)) && options.avgHeight !== null
		? Number(options.avgHeight)
		: null;
	if (own.length === 0 && !(explicitTarget > 0)) {
		return field;
	}

	// Gipfelbuckel. Amplitude = die Höhe des Gipfels IN SCHRITT, direkt: damit trägt sein Buckel im
	// Zentrum genau diesen Wert (das Fenster löscht dort das Rauschen), und es gibt nichts zu normieren.
	// Der Radius unter dem 0,72-fachen GLOBALEN Gipfelabstand erzwingt den Sattel (Prototyp :510).
	own.forEach((peak) => {
		const x = Number(peak.x);
		const y = Number(peak.y);
		const height = Number.isFinite(Number(peak.height)) && Number(peak.height) > 0
			? Number(peak.height)
			: ECOSYSTEM_HEIGHT_PLACEHOLDER;
		// Abstand zu SEINEM nächsten Nachbarn, nicht zum global engsten Paar (siehe buildEcosystemPeakWindow).
		const separation = peakWindow && typeof peakWindow.separationAt === "function"
			? peakWindow.separationAt(x, y)
			: Infinity;
		// 💣 EIN MINDESTRADIUS, sonst werden aus Bergen Stecknadelköpfe.
		//
		// Die Klemme `0,72 × Gipfelabstand` stammt aus dem Prototyp und erzwingt dort einen Sattel
		// zwischen zwei Gipfeln. Sie setzt voraus, was im Prototyp galt: wenige, weit auseinander
		// liegende Gipfel. Am Livebestand stehen sie dicht -- im Finsterkamm 2 bis 7 Einheiten
		// auseinander --, und dann klemmt jeder den anderen auf 1 bis 5 Einheiten Radius. Auf einer
		// 1024 Einheiten breiten Karte sind das Punkte. Genau so wurde es gemeldet: „sehn tu ich auch
		// nur weiße spots", gemessene Radien 2/1/5/2/0/3/1/3.
		//
		// 🔴 DER TAUSCH, BEWUSST: dicht stehende Gipfel VERSCHMELZEN jetzt zu einem Massiv, statt sich
		// gegenseitig kleinzuklemmen. Das ist physisch richtig -- zwei Kuppen drei Einheiten auseinander
		// SIND ein Massiv -- und kostet die Zusicherung „jeder Gipfel liest exakt seine Zahl" für genau
		// diesen Fall. Tragbar, seit das Feld ausdrücklich Darstellung ist: V11 rechnet aus
		// `height_schritt`, nicht aus dem Bild. Weit auseinander liegende Gipfel behalten die Zusicherung.
		const bounds = ecosystemGeometryBounds(geometry);
		const minRadius = bounds
			? 0.25 * Math.min(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y)
			: 0;
		const radius = Math.min(
			distanceToEcosystemEdge([x, y], geometry),
			Math.max(0.72 * separation, minRadius),
			150
		);
		if (!(radius > 0)) {
			return;                            // ein Gipfel genau auf dem Rand trägt keinen Buckel
		}
		field.peakBumps.push({ x, y, r: radius, a: height, i: 1 / (radius * radius) });
	});
	// Derselbe Riegel ein zweites Mal: Gipfel können hier noch wegfallen (einer genau auf dem Rand trägt
	// keinen Buckel). Ohne Buckel UND ohne eingetragene Maximalhöhe bleibt die Fläche flach.
	if (field.peakBumps.length === 0 && !(explicitTarget > 0)) {
		return field;
	}
	// 💣 `Math.max(...[])` ist -Infinity, nicht 0. Kein NaN -- nachgemessen: Warping und Slope klemmen
	// beide mit `Math.max(1, …)`, aus -Infinity würde also stillschweigend die 1. Genau das ist die
	// Falle: das Feld sähe heil aus und rechnete mit einem Bezug, als wäre der Berg 100 Schritt hoch.
	// Ohne Gipfel ist die eingetragene Maximalhöhe das richtige Mass -- sie ist dann der höchste Punkt,
	// den es gibt.
	field.hmax = field.peakBumps.length
		? Math.max(...field.peakBumps.map((bump) => bump.a))
		: explicitTarget;

	// Die Radien beim Fenster hinterlegen -- es kennt die Punkte, aber die Breite steht erst hier fest.
	if (peakWindow && peakWindow.radii instanceof Map && Array.isArray(peakWindow.points)) {
		field.peakBumps.forEach((bump) => {
			const point = peakWindow.points.find((candidate) => candidate.x === bump.x && candidate.y === bump.y);
			if (point) {
				const previous = peakWindow.radii.get(point) || 0;
				peakWindow.radii.set(point, Math.max(previous, bump.r));
			}
		});
	}

	// Alle Stufen in RELATIVEN Einheiten bauen, erst danach EINMAL dämpfen.
	//
	// 🔴 ABWEICHUNG VOM PROTOTYP, und zwar eine bewusste. Dort wird die Dämpfung allein aus der GROBEN
	// Stufe bestimmt (:521-533) und danach auf die feinen mit angewandt -- die feinen kommen also
	// obendrauf. Der Prototyp weiß das und mildert es mit ×0,35 statt ×0,5 (:535-538), behebt es aber
	// nicht: hier nachgemessen wuchs derselbe Berg beim Verfeinern von 1 auf 3 Stufen um **85 %**.
	//
	// Das ist genau der Fehler, vor dem oekosystem-instruction.md §4.1 warnt: „wie fein modelliere ich"
	// darf das Ergebnis nicht verändern, sonst verzerrt die Modellierungstiefe selbst die Reisezeiten.
	// Wird über ALLE Stufen gemessen und einmal gedämpft, ist `levels` ein reiner Detailregler -- und
	// der Rauschpegel trifft den Zielwert wirklich, statt ihn um die halbe Reihe zu überschiessen.
	const levels = Number.isInteger(options.levels) ? options.levels : ECOSYSTEM_HEIGHT_LEVELS;
	const grain = Number(options.grain) > 0 ? Number(options.grain) : ECOSYSTEM_HEIGHT_GRAIN;
	const spanX = bounds.max_x - bounds.min_x;
	const spanY = bounds.max_y - bounds.min_y;
	const coarseCell = Math.max(spanX, spanY) / grain;
	// Die Gratweite folgt der Körnung der Fläche, nicht einer festen Zahl: sonst hätte ein 40 Einheiten
	// breites Gebirge dieselbe Gratdichte wie ein 400 Einheiten breites und sähe daneben glatt aus.
	field.ridgedCell = coarseCell * ECOSYSTEM_RIDGED_CELL_SHARE;

	const noiseBumps = [];
	ecosystemHeightLevel(field, 0, coarseCell, 0.85, noiseBumps);
	// Feinere Stufen: halber Zellabstand, Amplitude ×0,35 je Stufe -- NICHT ×0,5. Bei halbem Abstand
	// liegen viermal so viele Buckel im Gebiet und ihre Radien halbieren sich mit, an jedem Punkt decken
	// also gleich viele wie zuvor. Bei ×0,5 trüge das Feine fast so viel wie das Grobe (Prototyp :535).
	let cells = 0;
	for (let k = 1; k <= levels; k++) {
		const cell = coarseCell / Math.pow(2, k);
		const estimate = (Math.ceil(spanX / cell) + 3) * (Math.ceil(spanY / cell) + 3);
		if (cells + estimate > ECOSYSTEM_HEIGHT_MAX_CELLS || noiseBumps.length > ECOSYSTEM_HEIGHT_MAX_BUMPS) {
			field.stoppedAtLevel = k;
			break;
		}
		cells += estimate;
		ecosystemHeightLevel(field, k, cell, 0.85 * Math.pow(0.35, k), noiseBumps);
	}
	noiseBumps.forEach((bump) => { bump.i = 1 / (bump.r * bump.r); });
	// Bezugswert der GratHülle, NOCH IN RELATIVEN EINHEITEN -- die Messschleife unten läuft ebenfalls
	// undedämpft, beide passen also zusammen. Die Hälfte des stärksten Buckels: darüber liegt praktisch
	// das ganze Innere (die groben Buckel überlappen), sodass die Hülle nur am Rand wirklich abfällt.
	// Höhe, in der das Gratfeld rechnet (eine AMPLITUDE -- skaliert mit der Dämpfung mit).
	field.ridgedUnit = noiseBumps.length ? Math.max(...noiseBumps.map((bump) => bump.a)) : 0;
	// Breite des Randauslaufs (eine LÄNGE in Kartenkoordinaten -- skaliert NICHT mit der Dämpfung).
	// Eine halbe grobe Buckelzelle: schmal genug, dass die Grate das Innere tragen, breit genug, dass
	// der Übergang zur Nachbarfläche nicht als Kante steht.
	field.ridgedEnvelope = coarseCell * 0.5;
	if (field.method === "ridged") {
		// Nur für dieses Verfahren -- 2.304 Randabstände kosten Zeit, die die anderen drei nicht brauchen.
		buildEcosystemEdgeDistanceGrid(field);
	}

	// Rauschmaximum über ALLE Stufen messen (ohne Gipfel, noch relativ), dann auf den Zielpegel ziehen.
	// Abgetastet wird über die bbox der FLÄCHE, nicht über eine Leinwand fester Größe.
	buildEcosystemHeightIndex(field, noiseBumps);
	const measuring = { ...field, peakBumps: [] };
	let loudest = 0;
	// Der Mittelwert wird nur gesammelt, wenn auch einer gefordert ist. Ohne Durchschnittshöhe läuft die
	// Messschleife wortgleich wie vor 2026-07-29 -- keine Liste, kein Polygontest, keine Suche.
	const wantsMean = Number.isFinite(Number(options.meanHeight)) && options.meanHeight !== null;
	const samples = wantsMean ? [] : null;
	const step = Math.max(0.5, Math.min(spanX, spanY) / 60);
	for (let y = bounds.min_y; y <= bounds.max_y; y += step) {
		for (let x = bounds.min_x; x <= bounds.max_x; x += step) {
			const value = sampleEcosystemHeightField(measuring, x, y, 1);
			if (value > loudest) {
				loudest = value;
			}
			if (wantsMean) {
				// 🔴 GEMITTELT WIRD ÜBER DIE FLÄCHE, NICHT ÜBER DIE BBOX. Der Rand der bbox liegt bei einer
				// schräg liegenden Fläche zur Hälfte ausserhalb; mitgezählt zöge er den Mittelwert beliebig
				// weit nach unten, und die eingestellte Zahl wäre nie erreichbar.
				//
				// 💣 Der Polygontest läuft NUR auf den Nullwerten. Jeder Buckel hat kompakten Träger und
				// einen Radius ≤ dem Randabstand seines Mittelpunkts -- seine Scheibe liegt also ganz in der
				// Fläche, und ein Wert > 0 BEWEIST damit, dass der Punkt drin liegt. Das ist kein Näherung,
				// sondern dieselbe Auskunft für einen Bruchteil der Kosten: der teure Test trifft nur den
				// bbox-Rand und die wenigen toten Stellen am Innenrand.
				if (value > 0) {
					samples.push(value);
				} else if (pointInGeometry([x, y], field.geometry)) {
					samples.push(0);
				}
			}
		}
	}
	// 🔴 Die eingestellte Durchschnittshöhe der Fläche gewinnt, sonst wird abgeleitet (V8, Owner
	// 2026-07-28: die drei Regler hängen je FLÄCHE). `null`/undefined heisst „ableiten wie bisher" --
	// eine eingetragene 0 dagegen heisst flach und wird wörtlich genommen, wie überall in diesem Modul.
	// 💣 `Math.min(...[])` ist +Infinity, und `0,4 · Infinity` ebenfalls -- ohne Gipfel wäre die Ableitung
	// also keine Zahl. Sie kann hier auch gar nicht greifen: ohne Gipfel kommt man nur mit einer
	// eingetragenen Maximalhöhe bis hierher (siehe die beiden Riegel oben), und die gewinnt ohnehin.
	const derivedTarget = field.peakBumps.length
		? ECOSYSTEM_HEIGHT_NOISE_SHARE * Math.min(...field.peakBumps.map((bump) => bump.a))
		: explicitTarget;
	const target = explicitTarget !== null ? explicitTarget : derivedTarget;
	// 🔴 Die eingestellte DURCHSCHNITTShöhe ist der zweite Zwang (Owner 2026-07-29). Sie sucht die Potenz;
	// die Maximalhöhe darüber bleibt in jedem Fall getroffen, weil der Faktor danach aus ihr folgt.
	// `null`/undefined heisst wieder „ableiten wie bisher" -- und das ist hier buchstäblich Potenz 1.
	//
	// 🪤 Geklemmt unter das Maximum, auch wenn der Dialog das schon tut: über den Schreibweg kann eine
	// Zahl auch anders hereinkommen, und ein Verhältnis ≥ 1 wäre unerfüllbar (der Mittelwert einer
	// Fläche kann ihren Höchstwert nicht erreichen, solange der Rand auf 0 ausläuft).
	let exponent = 1;
	if (wantsMean && loudest > 0 && target > 0) {
		const ratio = Math.min(0.999, Math.max(0.001, Number(options.meanHeight) / target));
		exponent = solveEcosystemNoiseExponent(samples, loudest, ratio);
	}
	if (exponent === 1) {
		// Der alte Weg, unverändert: eine reine Skalierung lässt sich in die Amplituden falten, und dann
		// kostet sie in der Malschleife gar nichts. Radien und damit der Index bleiben gültig.
		const damping = loudest > 0 ? target / loudest : 0;
		noiseBumps.forEach((bump) => { bump.a *= damping; });
		// 💣 Der Hüllenbezug MUSS mitskalieren. Er wird in sampleEcosystemHeightFieldRaw gegen die
		// Buckelsumme verglichen; bliebe er ungedämpft, stünde die Hülle nach dem Dämpfen überall unter 1
		// und das Gratfeld liefe auf einen Bruchteil seiner Höhe -- ein Gebirge, das leise verschwindet.
		// 💣 NUR die Amplitude. `ridgedEnvelope` ist eine Länge -- sie mitzudämpfen zöge den Randauslauf
		// auf einen Bruchteil zusammen und machte aus ihm die Kante, die er verhindern soll.
		field.ridgedUnit *= damping;
	} else {
		// Mit Potenz geht das nicht: `(s·Σ)^p ≠ s·Σ^p`. Die Amplituden bleiben roh, und Faktor wie Potenz
		// wandern ans Feld -- angewandt wird beides in sampleEcosystemHeightFieldRaw, auf die SUMME.
		field.noiseExponent = exponent;
		field.noiseScale = target / Math.pow(loudest, exponent);
	}
	field.bumps = noiseBumps.concat(field.peakBumps);

	return field;
}

// Höhe dieser einen Fläche an einer Stelle (Prototyp rawArea :464).
//
// `noiseWindow` kommt von aussen, weil es über ALLE Flächen gilt (siehe buildEcosystemPeakWindow).
// Ohne Angabe 1 -- damit bleibt eine einzelne Fläche für sich testbar.
// Das rohe Feld: Gipfelbuckel plus gefenstertes Rauschen, ohne Darstellungsverfahren. Getrennt, weil
// „Exponential Slope Weighting" seine eigene Nachbarschaft abtasten muss und sich sonst selbst aufriefe.
function sampleEcosystemHeightFieldRaw(field, x, y, noiseWindow = 1) {
	if (!field || !field.geometry) {
		return 0;
	}
	// Felder EINMAL in Locals holen, nicht in den Schleifen wiederholt als Eigenschaft lesen.
	const peakBumps = field.peakBumps;
	const grid = field.grid;

	let peaksHeight = 0;
	for (let k = 0; k < peakBumps.length; k++) {
		const bump = peakBumps[k];
		const dx = x - bump.x;
		const dy = y - bump.y;
		const q = (dx * dx + dy * dy) * bump.i;
		if (q < 1) {
			const u = 1 - q;
			peaksHeight += bump.a * u * u * u;
		}
	}

	let noise = 0;
	if (grid) {
		const i = Math.floor((x - field.gridOriginX) / field.gridCell);
		const j = Math.floor((y - field.gridOriginY) / field.gridCell);
		if (i >= 0 && j >= 0 && i < field.gridWidth && j < field.gridHeight) {
			const cell = grid[j * field.gridWidth + i];
			if (cell) {
				for (let k = 0; k < cell.length; k++) {
					const bump = cell[k];
					const dx = x - bump.x;
					const dy = y - bump.y;
					const q = (dx * dx + dy * dy) * bump.i;
					if (q < 1) {
						const u = 1 - q;
						noise += bump.a * u * u * u;
					}
				}
			}
		}
	}

	// 💣 NICHT `noise > 0` fragen: das ist bei NaN false und würde einen Rechenfehler in eine stumm
	// flache Landschaft verwandeln statt ihn zu zeigen. Genau das ist im Prototyp einmal passiert (:485).
	if (noise === 0) {
		return peaksHeight;
	}

	// 🔴 GRATE: das Gratmuster ERSETZT die Buckelsumme, es überlagert sie nicht.
	//
	// 💣 DAS IST DER GANZE UNTERSCHIED, und ich bin erst in die falsche Hälfte gelaufen: die Buckelsumme
	// bloss mit dem Gratmuster zu MULTIPLIZIEREN gibt Buckel mit feiner Maserung, keine Grate. Sichtbar
	// wird ein Grat erst, wenn er die tragende Struktur IST -- die Buckel bleiben rund, egal wie fein man
	// sie schraffiert. Die Instruction sagt genau das („`1 − |n|` STATT der Buckelsumme"); gerendert sieht
	// man den Unterschied sofort, im Zahlenbild überhaupt nicht.
	//
	// Die Buckelsumme bleibt trotzdem gebraucht -- als HÜLLE. Sie hat kompakten Träger (jeder Radius ≤ dem
	// Randabstand seines Mittelpunkts), ist also am Rand exakt 0 und liegt schon indiziert vor. Auf 0..1
	// normiert wird sie damit genau die Randabsenkung, die das globale Gratmuster NICHT von selbst hat:
	//   Höhe = Hülle(Buckelsumme) · Grat
	// Am Rand ist die Hülle 0 ⇒ das Produkt ist 0. Die Fusshöhe-0-Invariante gilt WÖRTLICH.
	//
	// 💣 Der naheliegende Weg wäre, stattdessen mit dem RANDABSTAND einzuhüllen -- und genau so habe ich
	// es beim Ausprobieren gerechnet. In der Malschleife liefe das je Abfragepunkt über jede Polygonkante,
	// 203.000-mal je Bild; dieselbe Rechnung, die sich das Warp-Verfahren aus genau diesem Grund schon
	// verkneift (siehe dort). Das Buckelfeld ist die bereits bezahlte Hülle.
	//
	// 💣 VOR der Potenz. Die Messschleife misst mit Potenz 1, misst also das fertige Gratfeld; wird die
	// Potenz danach auf dasselbe Feld gelegt, treffen Maximal- und Durchschnittshöhe genau das, was
	// gemessen wurde. Andersherum wäre die Messung eine andere Größe als die Anwendung.
	if (field.method === "ridged") {
		const threshold = field.ridgedEnvelope;
		if (!(threshold > 0)) {
			return peaksHeight;
		}
		// `ridgedUnit` ist die Höhe, in der das Gratfeld rechnet -- damit Dämpfung und Potenz danach
		// dasselbe Maß vorfinden wie bei den anderen drei Verfahren.
		const envelope = ecosystemEdgeEnvelope(field, x, y, threshold);
		noise = field.ridgedUnit * envelope * ecosystemRidgedNoise(field.seed, x, y, field.ridgedCell);
		if (noise === 0) {
			return peaksHeight;
		}
	}

	// Die Umformung, mit der Ø und Maximum getrennt getroffen werden (siehe Kopf). Ohne eingestellte
	// Durchschnittshöhe ist die Potenz exakt 1 und hier passiert nichts als dieser Vergleich.
	//
	// 💣 VOR dem Fenster, nicht danach. `noiseWindow` ist am Gipfel 0; multipliziert man erst und potenziert
	// dann, wäre der Gipfelwert `s·0^p` -- rechnerisch auch 0, aber die Steigung der Dämpfung wäre eine
	// andere und der Hochpunkt könnte wieder wandern. So bleibt die Fensterung genau die geprüfte.
	// 💣 Und am Rand ist die Summe 0 -- oben schon abgefangen, `0^p` käme also gar nicht vor. Die
	// Fusshöhe-0-Invariante hängt nicht an der Potenz, sondern am kompakten Träger der Buckel.
	if (field.noiseExponent !== 1) {
		noise = field.noiseScale * Math.pow(noise, field.noiseExponent);
	}

	return peaksHeight + noiseWindow * noise;
}

// Glattes, seedfestes Wertrauschen in [-1, 1]. Bilinear zwischen vier Zellhashes, mit der üblichen
// Glättung 3t²−2t³ -- billig und stetig; ein roher Hash je Punkt ergäbe Rauschen statt einer Struktur.
//
// 🪤 `level` gehört zum Hash, nicht zur Zellgröße: zwei Oktaven mit VERSCHIEDENER Zellgröße, aber
// gleichem `level` lägen an denselben Gitterpunkten aufeinander und ergäben sichtbare Kreuze.
function ecosystemValueNoise(seed, x, y, cell, level, salt) {
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const fx = x / cell - gx;
	const fy = y / cell - gy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = ecosystemHeightCellHash(seed, level, gx, gy, salt);
	const b = ecosystemHeightCellHash(seed, level, gx + 1, gy, salt);
	const c = ecosystemHeightCellHash(seed, level, gx, gy + 1, salt);
	const d = ecosystemHeightCellHash(seed, level, gx + 1, gy + 1, salt);
	const top = a + (b - a) * sx;
	const bottom = c + (d - c) * sx;

	return (top + (bottom - top) * sy) * 2 - 1;
}

// Ein glatter, seedfester Versatz für Domain Warping. Unverändert in der Wirkung -- die Rechnung wohnt
// jetzt in ecosystemValueNoise, damit Warping und Grate DIESELBE Primitive benutzen statt zweier Kopien.
function ecosystemWarpOffset(seed, x, y, salt) {
	return ecosystemValueNoise(seed, x, y, 40, 90, salt);
}

// Randabstandskarte auf einem groben Raster, EINMAL je Feldbau.
//
// 🔴 WARUM VORBERECHNET. Das Gratmuster braucht eine Hülle, die zum Rand hin abfällt -- die richtige
// Größe dafür ist der Randabstand. Je Abfragepunkt gerechnet liefe er über jede Polygonkante, in der
// Malschleife 203.000-mal; das ist die Rechnung, die sich das Warp-Verfahren aus genau diesem Grund
// verkneift. Auf 48×48 vorberechnet sind es 2.304 Aufrufe beim Bauen und danach vier Lesezugriffe je
// Abfrage.
//
// 💣 ZWEI HÜLLEN, DIE ICH VORHER PROBIERT HABE, UND WARUM SIE NICHT GEHEN -- beide sahen in den Zahlen
// gut aus und erst im gerenderten Bild falsch:
//   - Buckelsumme mit hoher Schwelle: sättigt im Inneren nicht, also trägt die runde Buckelhandschrift
//     sich ins Gratbild durch. Ergebnis waren Buckel mit Maserung statt Grate.
//   - Buckelsumme mit niedriger Schwelle: sättigt zwar, aber dann steht die Hülle auf JEDER einzelnen
//     Buckelscheibe sofort auf 1 -- und deren kompakter Trägerrand wird als KREIS sichtbar. Am Rand der
//     Fläche stand eine Perlenkette aus Kreisen.
// Der Randabstand hat beide Probleme nicht: er ist glatt und kennt nur die Fläche, nicht die Buckel.
const ECOSYSTEM_RIDGED_EDGE_GRID = 48;

function buildEcosystemEdgeDistanceGrid(field) {
	const bounds = field.bounds;
	const size = ECOSYSTEM_RIDGED_EDGE_GRID;
	const stepX = (bounds.max_x - bounds.min_x) / (size - 1);
	const stepY = (bounds.max_y - bounds.min_y) / (size - 1);
	const grid = new Float64Array(size * size);
	for (let j = 0; j < size; j++) {
		const y = bounds.min_y + j * stepY;
		for (let i = 0; i < size; i++) {
			const x = bounds.min_x + i * stepX;
			grid[j * size + i] = pointInGeometry([x, y], field.geometry)
				? distanceToEcosystemEdge([x, y], field.geometry)
				: 0;
		}
	}
	field.edgeGrid = grid;
	field.edgeGridStepX = stepX > 0 ? stepX : 1;
	field.edgeGridStepY = stepY > 0 ? stepY : 1;
}

// Hülle 0..1 aus der vorberechneten Karte, bilinear.
//
// ⚠️ Sie ist NICHT die Zusicherung „am Rand exakt 0" -- ein interpoliertes Raster trifft die Kante nur
// näherungsweise. Die Zusicherung kommt weiterhin vom kompakten Träger der Buckel: wo die Buckelsumme
// 0 ist, kehrt sampleEcosystemHeightFieldRaw schon vorher zurück. Diese Hülle FORMT nur den Auslauf.
function ecosystemEdgeEnvelope(field, x, y, falloff) {
	const grid = field.edgeGrid;
	if (!grid || !(falloff > 0)) {
		return 1;
	}
	const size = ECOSYSTEM_RIDGED_EDGE_GRID;
	const fx = (x - field.bounds.min_x) / field.edgeGridStepX;
	const fy = (y - field.bounds.min_y) / field.edgeGridStepY;
	let i = Math.floor(fx);
	let j = Math.floor(fy);
	if (i < 0) { i = 0; } else if (i > size - 2) { i = size - 2; }
	if (j < 0) { j = 0; } else if (j > size - 2) { j = size - 2; }
	const tx = Math.min(1, Math.max(0, fx - i));
	const ty = Math.min(1, Math.max(0, fy - j));
	const a = grid[j * size + i];
	const b = grid[j * size + i + 1];
	const c = grid[(j + 1) * size + i];
	const d = grid[(j + 1) * size + i + 1];
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	const distance = top + (bottom - top) * ty;

	return distance >= falloff ? 1 : distance / falloff;
}

// Ridged Noise: `1 − |n|` über mehrere Oktaven, Ergebnis 0..1.
//
// 🔴 WARUM DAS GRATE GIBT. `|n|` hat dort einen Knick, wo das Rauschen durch NULL geht -- also entlang
// einer Linie, nicht an einem Punkt. `1 − |n|` macht daraus einen Kamm, und weil das über alle Oktaven
// zugleich passiert, verzweigen sich die Kämme wie ein Gebirgszug. Das ist der ganze Unterschied zur
// Buckelsumme: dort ist das Maximum ein PUNKT je Zelle, hier eine LINIE.
//
// ⚠️ Für sich genommen ist das ein GLOBALES Feld -- es wird gerade dort groß, wo das Rauschen durch null
// geht, und das passiert auch am Flächenrand. Die Fusshöhe-0-Invariante kommt deshalb NICHT von hier,
// sondern davon, dass der Aufrufer damit nur das Buckelfeld MULTIPLIZIERT (siehe
// sampleEcosystemHeightFieldRaw). Wer diese Funktion je woanders einsetzt, muss sich die Hülle wieder
// eigens besorgen.
function ecosystemRidgedNoise(seed, x, y, baseCell) {
	let sum = 0;
	let total = 0;
	let amplitude = 1;
	let cell = baseCell > 0 ? baseCell : 1;
	for (let k = 0; k < ECOSYSTEM_RIDGED_OCTAVES; k++) {
		// 💣 Eigenes `level` JE OKTAVE (100+k), sonst fallen die Gitter aufeinander -- siehe oben.
		const ridge = 1 - Math.abs(ecosystemValueNoise(seed, x, y, cell, 100 + k, 7));
		let sharp = ridge;
		for (let s = 1; s < ECOSYSTEM_RIDGED_SHARPNESS; s++) {
			sharp *= ridge;                    // ganzzahlige Potenz ohne Math.pow -- das läuft je Pixel
		}
		sum += amplitude * sharp;
		total += amplitude;
		amplitude *= ECOSYSTEM_RIDGED_GAIN;
		cell /= 2;
	}

	// Auf 0..1 normiert, damit das Verfahren die HÖHE nicht mitverschiebt: es formt nur, skaliert wird
	// weiterhin allein über Maximal- und Durchschnittshöhe.
	return total > 0 ? sum / total : 0;
}

// Die öffentliche Abfrage: rohes Feld plus das Darstellungsverfahren der Fläche.
//
// 💣 Beide Verfahren kosten zusätzliche Abtastungen -- Warping eine, Slope zwei. Das ist der Preis und
// er ist bekannt: die Malschleife läuft mit 4 px Raster, also rund einem Sechzehntel der Pixel.
function sampleEcosystemHeightField(field, x, y, noiseWindow = 1) {
	if (!field || !field.geometry) {
		return 0;
	}
	const method = field.method || "perlin";

	if (method === "warp") {
		// Domain Warping: das Feld NICHT an der gefragten Stelle lesen, sondern an einer verzogenen.
		// Aus runden Kuppen werden dadurch gewundene Rücken -- was Hügelland ausmacht.
		// 🪤 Der Versatz ist seedfest und stetig, sonst flackerte das Bild bei jedem Neubau.
		//
		// 💣 AM GIPFEL MUSS DER VERSATZ AUF NULL. Eine frühere Fassung behauptete im Kopfkommentar, das
		// sei von selbst so -- es ist es nicht: der Warp verschiebt um bis zu 6 Einheiten, und der Gipfel
		// las dadurch 2.970 statt seiner eingetragenen 3.000. Der Unit-Test hat es gefangen, nicht das
		// Auge; im Bild wäre es nie aufgefallen und hätte still jede Höhe verfälscht.
		//
		// `noiseWindow` ist genau das richtige Dämpfungsmass und liegt schon vor: es ist am Gipfel 0 und
		// weit weg 1 -- dieselbe Funktion, die dort auch das Rauschen ausblendet, mit Steigung null.
		// 💣 UND AM RAND EBENSO AUF NULL, aus einem zweiten Grund. Dort ist das Gipfelfenster 1, der
		// Warp verschöbe also voll -- und läse Höhe von WEITER INNEN an eine Stelle, die exakt 0 sein
		// muss. Damit bräche die Fusshöhe-0-Invariante, an der die ganze Verschmelzung zweier Flächen
		// hängt: sichtbar wäre es nur an den Nahtstellen, und dort als Stufe. Auch das hat der
		// Unit-Test gefangen, nicht das Auge.
		//
		// Gedämpft wird mit dem FELD SELBST: wo es null ist, ist der Versatz null, und der Rückgabewert
		// ist dann ebenfalls null -- die Invariante gilt exakt, nicht näherungsweise. Das kostet eine
		// zusätzliche Abtastung, dieselbe, die das Slope-Verfahren ohnehin braucht. Ein Randabstand je
		// Punkt wäre die andere Antwort und liefe über jede Polygonkante -- deutlich teurer für dasselbe.
		const atPoint = sampleEcosystemHeightFieldRaw(field, x, y, noiseWindow);
		if (atPoint <= 0) {
			return 0;
		}
		const damp = Math.min(1, atPoint / Math.max(1, 0.25 * field.hmax));
		const strength = ECOSYSTEM_TERRAIN_WARP_STRENGTH * noiseWindow * damp;
		const dx = ecosystemWarpOffset(field.seed, x, y, 11) * strength;
		const dy = ecosystemWarpOffset(field.seed, x, y, 23) * strength;

		return sampleEcosystemHeightFieldRaw(field, x + dx, y + dy, noiseWindow);
	}

	const here = sampleEcosystemHeightFieldRaw(field, x, y, noiseWindow);
	if (method !== "slope" || here <= 0) {
		return here;
	}

	// Exponential Slope Weighting (amanpriyanshu.github.io/The-Mountains-of-Madness):
	//   s = |∇h|,  h' = h · e^(−α·s)
	// Steile Flanken flachen ab, sanfte bleiben. Am GIPFEL ist die Neigung null, dort ändert sich
	// also nichts -- der Gipfel liest weiter exakt seine eingetragene Höhe. Am Rand ist h = 0 und
	// bleibt 0. Beide Invarianten überstehen das Verfahren, und genau deshalb ist es hier brauchbar.
	// 💣 ZENTRALE Differenz, nicht vorwärts. Mathematisch ist die Neigung am Gipfel null; NUMERISCH ist
	// sie das nur bei einer zentralen Differenz. Die Vorwärtsdifferenz misst dort den Abfall EINER Seite
	// und meldet eine steile Flanke -- ein 3.000er las dadurch 2.744, und zwar leise, weil ein etwas zu
	// niedriger Gipfel im Bild wie eine Gestaltungsfrage aussieht und nicht wie ein Rechenfehler.
	// Der Unit-Test hat auch das gefangen. Preis: vier Abtastungen statt zwei.
	const step = 1.5;
	const gx = (sampleEcosystemHeightFieldRaw(field, x + step, y, noiseWindow)
		- sampleEcosystemHeightFieldRaw(field, x - step, y, noiseWindow)) / (2 * step);
	const gy = (sampleEcosystemHeightFieldRaw(field, x, y + step, noiseWindow)
		- sampleEcosystemHeightFieldRaw(field, x, y - step, noiseWindow)) / (2 * step);
	// Auf die Höhe normiert, damit α nicht davon abhängt, ob ein Berg 2.000 oder 9.000 hoch ist.
	const slope = Math.hypot(gx, gy) / Math.max(1, field.hmax / 100);

	return here * Math.exp(-ECOSYSTEM_TERRAIN_SLOPE_ALPHA * slope);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_HEIGHT_LEVELS,
		ECOSYSTEM_HEIGHT_DEFAULT,
		ECOSYSTEM_HEIGHT_PLACEHOLDER,
		ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO,
		ECOSYSTEM_NOISE_EXPONENT_MIN,
		ECOSYSTEM_NOISE_EXPONENT_MAX,
		solveEcosystemNoiseExponent,
		ecosystemValueNoise,
		ecosystemRidgedNoise,
		ECOSYSTEM_PEAK_SUBTYPES,
		isEcosystemPeakSubtype,
		ecosystemHeightSeed,
		ecosystemHeightCellHash,
		buildEcosystemPeakWindow,
		buildEcosystemHeightField,
		sampleEcosystemHeightField,
		sampleEcosystemHeightFieldRaw,
		ECOSYSTEM_TERRAIN_METHODS,
	};
}
