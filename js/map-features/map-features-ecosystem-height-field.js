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
const ECOSYSTEM_TERRAIN_METHODS = ["perlin", "warp", "slope"];
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
const ECOSYSTEM_HEIGHT_NOISE_SHARE = 0.4;

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
	if (own.length === 0) {
		return field;                          // flach, statt ein Gebirge ohne Stützpunkt zu erfinden
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
		const radius = Math.min(distanceToEcosystemEdge([x, y], geometry), 0.72 * separation, 150);
		if (!(radius > 0)) {
			return;                            // ein Gipfel genau auf dem Rand trägt keinen Buckel
		}
		field.peakBumps.push({ x, y, r: radius, a: height, i: 1 / (radius * radius) });
	});
	if (field.peakBumps.length === 0) {
		return field;
	}
	field.hmax = Math.max(...field.peakBumps.map((bump) => bump.a));

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

	// Rauschmaximum über ALLE Stufen messen (ohne Gipfel, noch relativ), dann auf den Zielpegel ziehen.
	// Abgetastet wird über die bbox der FLÄCHE, nicht über eine Leinwand fester Größe.
	buildEcosystemHeightIndex(field, noiseBumps);
	const measuring = { ...field, peakBumps: [] };
	let loudest = 0;
	const step = Math.max(0.5, Math.min(spanX, spanY) / 60);
	for (let y = bounds.min_y; y <= bounds.max_y; y += step) {
		for (let x = bounds.min_x; x <= bounds.max_x; x += step) {
			const value = sampleEcosystemHeightField(measuring, x, y, 1);
			if (value > loudest) {
				loudest = value;
			}
		}
	}
	// 🔴 Die eingestellte Durchschnittshöhe der Fläche gewinnt, sonst wird abgeleitet (V8, Owner
	// 2026-07-28: die drei Regler hängen je FLÄCHE). `null`/undefined heisst „ableiten wie bisher" --
	// eine eingetragene 0 dagegen heisst flach und wird wörtlich genommen, wie überall in diesem Modul.
	const derivedTarget = ECOSYSTEM_HEIGHT_NOISE_SHARE * Math.min(...field.peakBumps.map((bump) => bump.a));
	const target = Number.isFinite(Number(options.avgHeight)) && options.avgHeight !== null
		? Number(options.avgHeight)
		: derivedTarget;
	const damping = loudest > 0 ? target / loudest : 0;
	// Nur die Amplituden skalieren -- Radien und damit der Index bleiben gültig, kein Neuaufbau nötig.
	noiseBumps.forEach((bump) => { bump.a *= damping; });
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

	return peaksHeight + noiseWindow * noise;
}

// Ein glatter, seedfester Versatz für Domain Warping. Bilinear zwischen vier Zellhashes -- billig und
// stetig; ein roher Hash je Punkt ergäbe Rauschen statt einer Verzerrung.
function ecosystemWarpOffset(seed, x, y, salt) {
	const cell = 40;
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const fx = x / cell - gx;
	const fy = y / cell - gy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = ecosystemHeightCellHash(seed, 90, gx, gy, salt);
	const b = ecosystemHeightCellHash(seed, 90, gx + 1, gy, salt);
	const c = ecosystemHeightCellHash(seed, 90, gx, gy + 1, salt);
	const d = ecosystemHeightCellHash(seed, 90, gx + 1, gy + 1, salt);

	return ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy) * 2 - 1;
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
