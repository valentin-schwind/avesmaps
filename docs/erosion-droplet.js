// Hydraulische Erosion nach dem TROPFEN-Prinzip (droplet / particle-based erosion), als PROTOTYP.
//
// 🔴 DER ENTSCHEIDENDE UNTERSCHIED ZU ALLEM ANDEREN IM HOEHENMODELL: Erosion braucht ein
// VERAENDERBARES Raster. Alles uebrige ist eine FUNKTION -- man fragt (x, y) und bekommt eine Zahl,
// ohne Zustand, und genau daran haengt, dass der Feldbau billig, seedfest und in jeder Reihenfolge
// abfragbar ist. Ein Tropfen dagegen traegt Sediment von A nach B; also muss B sich MERKEN, dass
// dort jetzt etwas liegt. Erosion ist damit kein Nachbearbeitungsschritt der Zeichenfunktion,
// sondern gehoert in den RASTERLAUF (`terrain-store.php`, Knopf "Hoehenraster rechnen").
// ⚠️ Wer sie in `sampleEcosystemHeightField` einbaut, bekommt bei jedem Bild ein anderes Gebirge.
//
// 🔴 UND SIE STEHT IM KONFLIKT MIT DEN ZWEI TRAGENDEN INVARIANTEN -- das ist der eigentliche Befund,
// nicht die Rechnung. Erosion traegt Hochpunkte ab (ein Gipfel wuerde seine eingetragene Zahl
// verlieren) und lagert Sediment ab (am Rand entstuende Hoehe > 0, und damit braeche die
// Verschmelzung zweier ueberlappender Flaechen).
//
// 💣 UND EINE DAEMPFUNG REICHT DAFUER NICHT -- das ist die Falle, die dieses Modul beim Bauen
// gestellt hat. Der erste Entwurf multiplizierte jede Aenderung mit dem Gipfelfenster, also mit
// derselben Groesse, mit der sich das Warping-Verfahren gegen genau diesen Fehler absichert (es las
// sonst 2.970 statt 3.000). Gemessen an einem 3.000er Kegel, 20.000 Tropfen: der Gipfel las
// **2.944** und die Randzellen wanderten um **21** Schritt. Der Grund ist die ITERATION -- beim
// Warping ist es EIN Versatz, hier sind es 20.000 kleine Aenderungen, und ein Faktor von 0,04
// summiert sich ueber so viele Schritte zu 236 Schritt Abtrag. **Ein Faktor daempft eine einmalige
// Rechnung; gegen eine iterative braucht es einen RIEGEL.**
//
// 🔴 DIE LOESUNG IST DIE HAUSFORM, nicht ein schaerferer Faktor: **erodiert wird das RAUSCHFELD, die
// Gipfelbuckel kommen danach obendrauf.**
//     h = Gipfelbuckel + Gipfelfenster · erodiertes Rauschen
// Am Gipfel ist das Fenster 0, der Buckel traegt dort also exakt seine eingetragene Zahl -- egal was
// die Erosion mit dem Rauschen macht. Das ist keine Naeherung mehr, sondern algebraisch dicht, und es
// ist Zeichen fuer Zeichen dieselbe Bauform wie der Kamm-Anwuchs daneben.
// Fuer den RAND bleibt ein harter Riegel: eine Zelle, deren Ausgangshoehe 0 ist, wird nicht angefasst.
//
// 🔴 UND DER SOCKEL LOEST DEN LETZTEN WIDERSPRUCH. Ohne die Gipfel im Feld sieht das Wasser die Berge
// nicht und graebt keine einzige Rinne an einem Hang -- mit ihnen IM Raster ist der Gipfel der
// Rasteraufloesung ausgeliefert (gemessen: 968 Schritt Verlust an der Schwarzen Sichel; kein Riegel
// heilt das, weil schon der bilineare Lesekern die Nachbarzellen hineinmischt). Also beides: die
// Gipfelbuckel reisen als `sockel` mit, werden bei jeder Hoehen- und Gefaelleabfrage ADDIERT und nie
// veraendert. Der Tropfen sieht den Berg, der Berg bleibt.
//
// Alles in KARTENkoordinaten [x, y], 1 Einheit = 3 Meilen = 3.000 Schritt (AGENTS.md §5).
// Kein DOM, kein Leaflet, kein Modulzustand. Laeuft unter Node und im Browser.

// Rasterweite. Feiner als das Randabstandsraster des Gratverfahrens (48), weil eine Rinne, die
// ueber zwei Zellen breit ist, keine Rinne mehr ist.
const EROSION_GRID = 128;
// Wirkradius eines Tropfens in ZELLEN.
//
// 🔴 EINS, UND DAS IST DER GANZE UNTERSCHIED ZWISCHEN RINNEN UND GLATTGEBUEGELT. Hier stand 3, mit
// der Begruendung, ein Tropfen duerfe nicht nur eine einzelne Zelle anfassen. Das stimmt -- aber
// Radius 1 fasst bereits FUENF Zellen an (die eigene und ihre vier direkten Nachbarn), und Radius 3
// deren neunundvierzig: jede Rinne wird ueber sieben Zellen Breite verschmiert, also genau so breit
// gebuegelt, wie sie tief werden sollte.
//
// Gemessen an der Roten Sichel, Rinnentiefe (wie tief liegt eine Zelle unter dem hoechsten Punkt
// ihrer Umgebung) vorher -> nachher, 4.000 Tropfen:
//   Radius 3:  574 ->   763 Schritt   (+189)
//   Radius 1:  574 -> 1.858 Schritt (+1.284)
// Mit 3 GLAETTET die Erosion das Gebirge messbar mehr, als sie es furcht -- man sieht danach weniger
// Struktur als vorher. Mit 1 entstehen die Rinnen, um deren willen man das Verfahren ueberhaupt
// einsetzt.
const EROSION_RADIUS = 1;
// Traegheit der Richtung: 0 = folgt strikt dem Gefaelle, 1 = fliegt geradeaus weiter.
// ⚠️ Klein halten. Bei hoher Traegheit laufen Tropfen ueber Kaemme hinweg und schneiden Kerben
// dort, wo gar kein Wasser hinkommt.
const EROSION_INERTIA = 0.05;
// Wieviel Sediment ein Tropfen bei gegebenem Gefaelle, Wasser und Tempo tragen kann.
const EROSION_CAPACITY = 4;
// Untergrenze des Gefaelles in der Kapazitaetsformel. 💣 Ohne sie ist die Kapazitaet in der Ebene
// exakt 0, der Tropfen laesst alles auf einen Fleck fallen und baut einen Turm.
const EROSION_MIN_SLOPE = 0.01;
// Anteil des Ueberschusses, der je Schritt abgelagert bzw. abgetragen wird.
const EROSION_DEPOSIT = 0.3;
const EROSION_ERODE = 0.3;
// Verdunstung je Schritt. Sie beendet den Lauf von selbst -- ohne sie laeuft ein Tropfen bis zum
// Schrittdeckel und traegt dabei Sediment durch die halbe Flaeche.
const EROSION_EVAPORATE = 0.02;
const EROSION_GRAVITY = 4;
// Schrittdeckel je Tropfen -- als VIELFACHES DER RASTERWEITE, nicht als feste Zahl.
//
// 💣 HIER STAND 64, UND DAS WAR DER GRUND, WARUM KEIN FLUSSNETZ ENTSTAND. Ein Tropfen geht je
// Schritt EINE Zelle weit; auf einem 256er Raster braucht er also ueber hundert Schritte, um von
// einem Kamm bis in die Ebene zu laufen. Gemessen bei 20.000 Tropfen auf 256²: **57 % liefen in
// den Deckel**, der Median lag exakt auf 64. Mehr als die Haelfte aller Tropfen wurde mitten im
// Hang abgeschnitten -- und ein Netz entsteht nur, wo viele Tropfen denselben LANGEN Weg zu Ende
// gehen. Bei 96² fiel es weniger auf (41 % im Deckel), weil dort ein Tropfen ohnehin nach wenigen
// Schritten unten ist.
// ⚠️ Der Riegel bleibt ein Riegel -- er ist nur an die Rastergroesse gebunden statt an eine Zahl,
// die bei jeder Aufloesung etwas anderes bedeutet.
const EROSION_STEP_SHARE = 1.5;
const EROSION_START_WATER = 1;
const EROSION_START_SPEED = 1;
// Ab welchem Anteil der Maximalhoehe eine Aenderung voll wirkt. Darunter wird sie linear
// heruntergezogen, damit der Auslauf zum Rand hin unberuehrt bleibt (siehe Kopf).
const EROSION_EDGE_SHARE = 0.08;
// Unterhalb dieses Gipfelfensters wird gar nichts mehr geaendert (nur wenn `peakGuard` an ist, also
// wenn die Erosion auf dem VOLLEN Feld laeuft). Quadratisch im Abstand: 0,25 = halber Fensterradius.
const EROSION_PEAK_GUARD = 0.25;

// Seedfester Zufall. 🔴 KEIN Math.random(): dieselbe Begruendung wie im Feldmodul -- echter Zufall
// liefert bei jedem Lauf ein anderes Gebirge und damit andere Reisezeiten.
function erosionRandom(seed) {
	let s = (seed | 0) || 1;

	return function () {
		s ^= s << 13; s |= 0;
		s ^= s >>> 17;
		s ^= s << 5; s |= 0;

		return ((s >>> 0) % 100000) / 100000;
	};
}

// Das Raster aus einer Feldabfrage aufbauen, plus die zwei Masken, die die Invarianten halten.
//
// @param bounds  {min_x, min_y, max_x, max_y} in Kartenkoordinaten
// @param sampler (x, y) => Hoehe in Schritt -- das FERTIGE Feld (also nach Kamm-Anwuchs und Taelern)
// @param options {inside, peakWindow, hmax, grid}
//        inside     (x, y) => bool, der Polygontest der Flaeche
//        peakWindow das Gipfelfenster des Stapels (sample(x, y) -> 0 am Gipfel, 1 weit weg)
function buildErosionField(bounds, sampler, options) {
	const opts = options || {};
	const size = Number.isInteger(opts.grid) && opts.grid > 8 ? opts.grid : EROSION_GRID;
	const stepX = (bounds.max_x - bounds.min_x) / (size - 1);
	const stepY = (bounds.max_y - bounds.min_y) / (size - 1);
	const hoehe = new Float64Array(size * size);
	const start = new Float64Array(size * size);
	const drin = new Uint8Array(size * size);
	const gipfel = new Float64Array(size * size);
	// 🔴 DER SOCKEL -- das, was das Wasser SIEHT, aber nicht anfassen darf: die Gipfelbuckel.
	// Er wird zur Hoehe addiert, wenn ein Tropfen Hoehe und Gefaelle liest, und NIE veraendert.
	const sockel = new Float64Array(size * size);
	const inside = typeof opts.inside === "function" ? opts.inside : () => true;
	const win = opts.peakWindow && typeof opts.peakWindow.sample === "function" ? opts.peakWindow : null;
	const sockelFn = typeof opts.sockel === "function" ? opts.sockel : null;
	let hmax = 0;
	for (let j = 0; j < size; j++) {
		const y = bounds.min_y + j * stepY;
		for (let i = 0; i < size; i++) {
			const x = bounds.min_x + i * stepX;
			const k = j * size + i;
			if (!inside(x, y)) {
				continue;                                    // ausserhalb: 0 und unantastbar
			}
			drin[k] = 1;
			const h = sampler(x, y);
			hoehe[k] = h > 0 ? h : 0;
			start[k] = hoehe[k];
			gipfel[k] = win ? win.sample(x, y) : 1;
			if (sockelFn) { sockel[k] = sockelFn(x, y); }
			if (hoehe[k] > hmax) { hmax = hoehe[k]; }
		}
	}

	return {
		hoehe, start, drin, gipfel, sockel,
		size,
		minX: bounds.min_x,
		minY: bounds.min_y,
		stepX: stepX > 0 ? stepX : 1,
		stepY: stepY > 0 ? stepY : 1,
		hmax,
		// Laeuft die Erosion auf dem vollen Feld (Gipfel drin)? Dann braucht sie den Gipfel-Riegel.
		peakGuard: !!opts.peakGuard,
		// Wie stark eine Aenderung an dieser Zelle ueberhaupt wirken darf.
		//
		// 🔴 ZWEI STUFEN, und die erste ist ein RIEGEL, keine Daempfung (siehe Kopf): eine Zelle mit
		// Ausgangshoehe 0 wird NICHT angefasst. Ein Faktor allein hat in der Messung nicht gehalten --
		// 20.000 Tropfen summieren jeden Restfaktor auf.
		// ⚠️ Das Gipfelfenster steht hier NICHT mehr drin. Es muss nicht: erodiert wird das Rauschfeld,
		// und der Gipfelbuckel wird danach addiert -- dort traegt er exakt seine Zahl, ohne Riegel.
		// Der Faktor bleibt trotzdem als weicher Auslauf zum Rand hin, damit die Naht zur Nachbarflaeche
		// keine Stufe bekommt.
		erlaubt(k) {
			if (!(this.start[k] > 0)) {
				return 0;                                    // Riegel 1: hier war nichts, hier bleibt nichts
			}
			// 🔴 RIEGEL 2 -- DER GIPFEL, und er ist der Grund, warum die Erosion auf dem VOLLEN Feld
			// laufen darf. Ohne ihn muss man die Gipfelbuckel herausrechnen, und dann fliesst kein
			// Tropfen von einem Gipfel herab: das Wasser sieht den Berg gar nicht. Mit ihm sieht es ihn,
			// laeuft an ihm hinunter und gräbt seine Rinnen -- nur AENDERN darf es ihn nicht.
			//
			// 💣 HART, nicht als Faktor. Genau daran ist der erste Entwurf gescheitert (siehe Kopf):
			// 20.000 Tropfen summieren jeden Restfaktor auf, ein 3.000er las 2.944.
			// 💣 UND MIT LUFT: die Schwelle riegelt eine Zone, die BREITER ist als eine Rasterzelle --
			// sonst aendert sich die Nachbarzelle und der bilineare Lesekern zieht das in den Gipfel
			// (das 62-Schritt-Leck). Das Gipfelfenster waechst quadratisch im Abstand, EROSION_PEAK_GUARD
			// = 0,25 entspricht also dem halben Fensterradius.
			if (this.peakGuard && this.gipfel[k] < EROSION_PEAK_GUARD) {
				return 0;
			}

			return this.hmax > 0 ? Math.min(1, this.start[k] / (EROSION_EDGE_SHARE * this.hmax)) : 0;
		},
		tropfen: 0,
		abtrag: 0,
		auftrag: 0,
	};
}

// Bilinear lesen -- Zeile fuer Zeile die Bauform von ecosystemEdgeEnvelope / ecosystemKammEnvelope.
function sampleErosionField(er, x, y) {
	if (!er) {
		return 0;
	}
	const size = er.size;
	const fx = (x - er.minX) / er.stepX;
	const fy = (y - er.minY) / er.stepY;
	let i = Math.floor(fx);
	let j = Math.floor(fy);
	if (i < 0) { i = 0; } else if (i > size - 2) { i = size - 2; }
	if (j < 0) { j = 0; } else if (j > size - 2) { j = size - 2; }
	const tx = Math.min(1, Math.max(0, fx - i));
	const ty = Math.min(1, Math.max(0, fy - j));
	const g = er.hoehe;
	const a = g[j * size + i];
	const b = g[j * size + i + 1];
	const c = g[(j + 1) * size + i];
	const d = g[(j + 1) * size + i + 1];
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;

	return top + (bottom - top) * ty;
}

// Hoehe und Gefaelle an einer RASTERstelle (in Zellkoordinaten), bilinear.
// 💣 Der Gradient wird aus DENSELBEN vier Ecken gerechnet wie die Hoehe. Zwei getrennte Abfragen
// (Hoehe bilinear, Gefaelle aus Nachbarzellen) laufen an Zellgrenzen auseinander, und der Tropfen
// springt dann seitlich weg -- im Bild sieht das wie Rauschen aus, nicht wie ein Fehler.
function erosionHeightAndGradient(er, fx, fy) {
	const size = er.size;
	let i = Math.floor(fx);
	let j = Math.floor(fy);
	if (i < 0) { i = 0; } else if (i > size - 2) { i = size - 2; }
	if (j < 0) { j = 0; } else if (j > size - 2) { j = size - 2; }
	const tx = fx - i;
	const ty = fy - j;
	// 🔴 HOEHE + SOCKEL. Das ist der ganze Trick, mit dem sich die zwei Anforderungen vertragen:
	// der Tropfen SIEHT den Berg (er laeuft an seiner Flanke hinunter und graebt dort seine Rinne),
	// aber der Berg LIEGT NICHT im Raster und kann deshalb weder abgetragen noch von einer Skalierung
	// verzogen werden. Ein Gipfel IM Raster ist der Rasteraufloesung ausgeliefert -- gemessen: die
	// Schwarze Sichel verlor so 968 Schritt an ihrem hoechsten Punkt, und kein Riegel heilt das, weil
	// schon der bilineare Lesekern die Nachbarzellen hineinmischt.
	const g = er.hoehe, so = er.sockel;
	const nw = g[j * size + i] + so[j * size + i];
	const ne = g[j * size + i + 1] + so[j * size + i + 1];
	const sw = g[(j + 1) * size + i] + so[(j + 1) * size + i];
	const se = g[(j + 1) * size + i + 1] + so[(j + 1) * size + i + 1];

	return {
		height: nw * (1 - tx) * (1 - ty) + ne * tx * (1 - ty) + sw * (1 - tx) * ty + se * tx * ty,
		gx: (ne - nw) * (1 - ty) + (se - sw) * ty,
		gy: (sw - nw) * (1 - tx) + (se - ne) * tx,
	};
}

// Eine Aenderung ueber den Wirkradius verteilen, mit linear abfallendem Gewicht.
// 🔴 HIER STEHEN DIE INVARIANTEN: jede Zelle bekommt ihren Anteil mit `erlaubt(k)` multipliziert,
// also 0 am Gipfel und 0 am Rand. Ohne das traegt der erste Tropfen den hoechsten Berg ab.
function erosionApply(er, cx, cy, betrag) {
	const size = er.size;
	const r = EROSION_RADIUS;
	const i0 = Math.max(0, Math.floor(cx) - r);
	const i1 = Math.min(size - 1, Math.floor(cx) + r);
	const j0 = Math.max(0, Math.floor(cy) - r);
	const j1 = Math.min(size - 1, Math.floor(cy) + r);
	let summe = 0;
	for (let j = j0; j <= j1; j++) {
		for (let i = i0; i <= i1; i++) {
			const k = j * size + i;
			if (!er.drin[k]) { continue; }
			const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
			if (d > r) { continue; }
			summe += (1 - d / r) * er.erlaubt(k);
		}
	}
	if (!(summe > 0)) {
		return 0;                                            // hier darf sich nichts aendern
	}
	let bewegt = 0;
	for (let j = j0; j <= j1; j++) {
		for (let i = i0; i <= i1; i++) {
			const k = j * size + i;
			if (!er.drin[k]) { continue; }
			const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
			if (d > r) { continue; }
			const anteil = ((1 - d / r) * er.erlaubt(k)) / summe;
			let delta = betrag * anteil;
			// 💣 Nie unter 0 abtragen: eine negative Hoehe reisst ein Loch in die Fusshoehe-0-Regel,
			// und der bilineare Rueckweg zieht die Nachbarzellen mit hinein.
			if (er.hoehe[k] + delta < 0) { delta = -er.hoehe[k]; }
			er.hoehe[k] += delta;
			bewegt += delta;
		}
	}

	return bewegt;
}

// Der Lauf. Jeder Tropfen startet an einer zufaelligen Stelle INNERHALB der Flaeche.
//
// @param options {tropfen, seed, erode, deposit, inertia, capacity, evaporate}
function runErosionDroplets(er, options) {
	const opts = options || {};
	const anzahl = Number(opts.tropfen) > 0 ? Math.floor(opts.tropfen) : 10000;
	const erode = Number.isFinite(Number(opts.erode)) ? Number(opts.erode) : EROSION_ERODE;
	const deposit = Number.isFinite(Number(opts.deposit)) ? Number(opts.deposit) : EROSION_DEPOSIT;
	const inertia = Number.isFinite(Number(opts.inertia)) ? Number(opts.inertia) : EROSION_INERTIA;
	const capacity = Number.isFinite(Number(opts.capacity)) ? Number(opts.capacity) : EROSION_CAPACITY;
	const evaporate = Number.isFinite(Number(opts.evaporate)) ? Number(opts.evaporate) : EROSION_EVAPORATE;
	const rnd = erosionRandom(Number(opts.seed) || 1);
	const size = er.size;
	// Der Deckel waechst mit dem Raster (siehe EROSION_STEP_SHARE).
	const maxSteps = Math.max(48, Math.round(size * EROSION_STEP_SHARE));

	// Startzellen einmal sammeln: nur Zellen INNERHALB, und nur solche mit Hoehe. Wuerfeln bis ein
	// Treffer kommt waere bei einer schmalen Flaeche in einer weiten bbox beliebig langsam.
	const start = [];
	for (let k = 0; k < er.drin.length; k++) {
		if (er.drin[k] && er.start[k] > 0) { start.push(k); }
	}
	if (start.length === 0) {
		return er;
	}

	let abtrag = 0, auftrag = 0, abgesetzt = 0;
	for (let n = 0; n < anzahl; n++) {
		const k = start[Math.floor(rnd() * start.length) % start.length];
		let px = (k % size) + rnd();
		let py = Math.floor(k / size) + rnd();
		let dx = 0, dy = 0;
		let wasser = EROSION_START_WATER;
		let tempo = EROSION_START_SPEED;
		let sediment = 0;
		let stehen = 0;

		for (let schritt = 0; schritt < maxSteps; schritt++) {
			const zelle = Math.floor(py) * size + Math.floor(px);
			const hier = erosionHeightAndGradient(er, px, py);
			// Richtung: Traegheit gegen Gefaelle.
			dx = dx * inertia - hier.gx * (1 - inertia);
			dy = dy * inertia - hier.gy * (1 - inertia);
			const len = Math.hypot(dx, dy);
			if (!(len > 0)) {
				abgesetzt += erosionApply(er, px, py, sediment); sediment = 0;
				break;                                       // exakt flach: der Tropfen bleibt liegen
			}
			dx /= len; dy /= len;
			const nx = px + dx;
			const ny = py + dy;
			if (nx < 0 || ny < 0 || nx >= size - 1 || ny >= size - 1) {
				abgesetzt += erosionApply(er, px, py, sediment); sediment = 0;
				break;                                       // aus dem Raster gelaufen
			}
			const nk = Math.floor(ny) * size + Math.floor(nx);
			if (!er.drin[nk]) {
				// 🔴 MASSENERHALTUNG: die Ladung bleibt DA, sie verlaesst die Flaeche nicht.
				// Ohne das traegt jeder Tropfen sein Sediment ueber den Rand hinaus, und das Gebirge
				// sinkt gleichmaessig ab, statt sich zu strukturieren -- gemessen kostete das ein
				// Drittel bis zwei Drittel der Durchschnittshoehe, und mit ihr den Kontrast zwischen
				// Rinne und Ruecken. Genau deshalb waren die Rinnen im Bild nicht zu sehen.
				abgesetzt += erosionApply(er, px, py, sediment); sediment = 0;
				break;                                       // aus der FLAECHE gelaufen: Schluss.
			}
			const neu = erosionHeightAndGradient(er, nx, ny).height;
			const dh = neu - hier.height;

			if (dh > 0) {
				// Bergauf: der Tropfen fuellt die Senke, die er gerade verlaesst -- hoechstens bis zur
				// Kante, nie darueber (sonst waechst hier ein Huegel).
				const ablage = Math.min(dh, sediment);
				sediment -= ablage;
				auftrag += erosionApply(er, px, py, ablage);
			} else {
				const kap = Math.max(-dh * tempo * wasser * capacity, EROSION_MIN_SLOPE);
				if (sediment > kap) {
					const ablage = (sediment - kap) * deposit;
					sediment -= ablage;
					auftrag += erosionApply(er, px, py, ablage);
				} else {
					// 💣 Nie mehr abtragen als das Gefaelle hergibt (`-dh`): sonst grabt der Tropfen
					// sich in die Flanke ein und erzeugt eine Stufe, die es bergab nicht gibt.
					const weg = Math.min((kap - sediment) * erode, -dh);
					const bewegt = -erosionApply(er, px, py, -weg);
					sediment += bewegt;
					abtrag += bewegt;
				}
			}

			tempo = Math.sqrt(Math.max(0, tempo * tempo + -dh * EROSION_GRAVITY));
			wasser *= (1 - evaporate);
			if (wasser < 0.01) {
				abgesetzt += erosionApply(er, px, py, sediment); sediment = 0;
				break;
			}
			px = nx; py = ny;
			// 💣 EIN Schritt in derselben Zelle ist KEIN Kreisen -- die Schrittweite ist eine Zelle,
			// also landet ein Tropfen regelmaessig noch einmal in seiner eigenen. Hier stand der
			// Abbruch nach dem ERSTEN solchen Schritt, und er hat auf 256² **35 % aller Tropfen**
			// mitten im Lauf gestoppt. Erst mehrere Schritte hintereinander in derselben Zelle sind
			// ein Kreisen; dann greift der Riegel weiterhin.
			if (zelle === nk) {
				stehen++;
				if (stehen >= 3) {
					abgesetzt += erosionApply(er, px, py, sediment); sediment = 0;
					break;
				}
			} else {
				stehen = 0;
			}
		}
		// Der Schrittdeckel ist der letzte Ausgang -- auch er darf keine Masse verschlucken.
		if (sediment > 0) { abgesetzt += erosionApply(er, px, py, sediment); }
	}
	er.tropfen = anzahl;
	er.abtrag = abtrag;
	er.auftrag = auftrag;
	// Was die Tropfen beim Anhalten noch abgelegt haben (Massenerhaltung, siehe oben).
	er.abgesetzt = abgesetzt;

	return er;
}

// Was der Lauf am Bestand geaendert hat -- fuer die Gegenprobe der Invarianten.
function erosionBilanz(er) {
	let maxAbtrag = 0, maxAuftrag = 0, randMax = 0, gipfelMax = 0, n = 0;
	for (let k = 0; k < er.hoehe.length; k++) {
		if (!er.drin[k]) { continue; }
		const d = er.hoehe[k] - er.start[k];
		if (d < maxAbtrag) { maxAbtrag = d; }
		if (d > maxAuftrag) { maxAuftrag = d; }
		// 🔴 Randzellen sind die mit Ausgangshoehe EXAKT 0 -- dort MUSS die Aenderung 0 sein, und das
		// ist eine Zusicherung, keine Toleranz. "fast 0" (< 1 % von hmax) waere die falsche Frage: das
		// ist der AUSLAUF, und dass der sich formt, ist erlaubt.
		if (!(er.start[k] > 0)) { randMax = Math.max(randMax, Math.abs(d)); }
		// Gipfelzellen: die, an denen das Gipfelfenster fast 0 ist. Hier wird nur noch GEMESSEN, nicht
		// zugesichert -- die Gipfelinvariante haengt daran, dass der Buckel NACH der Erosion addiert
		// wird, nicht an dieser Zelle. Die Zahl sagt, wieviel Rauschen dort abgetragen wurde, und das
		// darf beliebig sein: das Gipfelfenster loescht es ohnehin.
		if (er.gipfel[k] < 0.05) { gipfelMax = Math.max(gipfelMax, Math.abs(d)); }
		n++;
	}

	// 🔴 RINNENTIEFE -- wie tief liegt eine Zelle unter dem hoechsten Punkt ihrer Umgebung?
	// Das ist das Mass fuer "sind Rinnen zu sehen": ein gleichmaessig abgesenktes Gebirge hat
	// denselben Mittelwert wie ein zerfurchtes, aber viel weniger davon. Gemessen wird gegen das
	// Feld VOR dem Lauf, damit man den Zuwachs an Struktur ablesen kann, nicht die Struktur selbst.
	const R = 2;
	let rinneVor = 0, rinneNach = 0, m = 0;
	for (let j = R; j < er.size - R; j++) {
		for (let i = R; i < er.size - R; i++) {
			const k = j * er.size + i;
			if (!er.drin[k] || !(er.start[k] > 0)) { continue; }
			let hochVor = 0, hochNach = 0, alleDrin = true;
			for (let dj = -R; dj <= R && alleDrin; dj++) {
				for (let di = -R; di <= R; di++) {
					const kk = (j + dj) * er.size + (i + di);
					if (!er.drin[kk]) { alleDrin = false; break; }
					if (er.start[kk] > hochVor) { hochVor = er.start[kk]; }
					if (er.hoehe[kk] > hochNach) { hochNach = er.hoehe[kk]; }
				}
			}
			if (!alleDrin) { continue; }
			rinneVor += hochVor - er.start[k];
			rinneNach += hochNach - er.hoehe[k];
			m++;
		}
	}

	return {
		maxAbtrag, maxAuftrag, randMax, gipfelMax, zellen: n,
		rinneVor: m > 0 ? rinneVor / m : 0,
		rinneNach: m > 0 ? rinneNach / m : 0,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		EROSION_GRID, EROSION_RADIUS, EROSION_INERTIA, EROSION_CAPACITY, EROSION_MIN_SLOPE,
		EROSION_DEPOSIT, EROSION_ERODE, EROSION_EVAPORATE, EROSION_GRAVITY, EROSION_STEP_SHARE,
		EROSION_EDGE_SHARE, EROSION_PEAK_GUARD,
		erosionRandom, buildErosionField, sampleErosionField, erosionHeightAndGradient,
		erosionApply, runErosionDroplets, erosionBilanz,
	};
}
