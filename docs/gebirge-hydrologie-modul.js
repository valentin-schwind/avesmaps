// Lokale Gebirgssimulation je Flaeche -- PROTOTYP zur Machbarkeitsfrage vom 04.09.2026.
//
// ⚠️ ER IST NICHT DIE PRODUKTION. Nichts davon ist in Avesmaps gebaut; kein Produktivcode ist
// angefasst. Herausgeloest, damit er unter Node pruefbar ist und ein zweiter Leser ihn nicht
// abschreiben muss -- derselbe Schritt wie bei docs/kurvenlabel-pipeline.js (24.08.2026),
// docs/flusstaeler-talmodul.js und docs/kammanwuchs-modul.js (03.09.2026).
//
// 🔴 WAS ES ANDERS MACHT ALS ALLES BISHERIGE. Das heutige Hoehenfeld ist eine FUNKTION -- eine
// Summe kompakter Buckel, die man an jeder Stelle zustandslos abfragt. Hier wird auf einem RASTER
// gerechnet, und zwar in dieser Reihenfolge:
//
//     Polygon -> Raster -> Constraints (Gipfel/Kamm/Fluss/See) -> Randwertaufgabe
//              -> Rauschen -> [Senken fuellen -> D8 -> Akkumulation -> Stream Power -> Diffusion]*
//
// Der Unterschied ist nicht die Erosion, sondern was sie vorfindet:
//   - Buckelsumme: ein Berg ist ein PUNKTmaximum, zwei Buckel ADDIEREN sich. Gemessen am
//     Livebestand: 27 von 49 Gipfeln lesen ihre Zahl NICHT, bis +5.820 Schritt zu hoch (Hoher
//     Stumpen: eingetragen 2.300, gelesen 8.120). Das ist zugleich der "weisse Blob".
//   - Randwertaufgabe: die Gipfel werden FESTGEHALTEN, dazwischen wird interpoliert. Jeder Gipfel
//     liest exakt seine Zahl (gemessen: Abweichung 0,0000 Schritt), und zwischen zwei Gipfeln
//     entsteht ein GRAT statt zweier Kegel.
//
// 💣 UND DER TERM, AN DEM DER TROPFEN-VERSUCH GESCHEITERT IST, IST DIE HEBUNG. Ohne sie traegt
// Stream Power das Gebirge bis auf Basisniveau ab -- gemessen Ø 1.361 -> 27 Schritt. Das ist kein
// Parameterfehler, sondern Geomorphologie: ein Gebirge ohne Hebung wird eingeebnet. Deshalb stand
// in der Analyse vom 03.09.2026 "ES GIBT KEINE MILDE EROSIONSEINSTELLUNG" -- die gibt es sehr wohl,
// sobald der Hebungsterm dasteht.
//
// Alles in KARTENkoordinaten 0..1024; gerechnet wird intern in SCHRITT (1 Einheit = 3.000 Schritt),
// damit Hoehe und Laenge dieselbe Einheit haben (AGENTS.md §5).

const SCHRITT_JE_EINHEIT = 3000;

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. RASTER UND MASKEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Das lokale Raster einer Flaeche. `n` ist die Zahl der Zellen auf der LAENGEREN bbox-Kante.
//
// ⚠️ Die Zellweite ist kein freier Wert: `avesmapsTerrainGuardRasterShape` weist alles feiner als
// AVESMAPS_TERRAIN_CELL_SIZE (0,25 Einheiten) ab. Der Grund steht dort -- der Anstieg ist eine
// TOTALVARIATION und waechst mit der Abtastdichte, zwei Flaechen in verschiedener Aufloesung haetten
// unvergleichbare `ascent_schritt`. Bei der Roten Sichel (64,6 Einheiten) trifft n = 256 die 0,25
// fast genau; das ist keine Wahl, sondern die vorhandene Randbedingung.
function baueRaster(bounds, n, istDrin) {
	const spanX = bounds.max_x - bounds.min_x;
	const spanY = bounds.max_y - bounds.min_y;
	const cell = Math.max(spanX, spanY) / (n - 1);
	const w = Math.round(spanX / cell) + 1;
	const hh = Math.round(spanY / cell) + 1;
	const drin = new Uint8Array(w * hh);
	let drinN = 0;
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			if (istDrin(bounds.min_x + i * cell, bounds.min_y + j * cell)) {
				drin[j * w + i] = 1;
				drinN++;
			}
		}
	}

	return {
		w, hh, cell, drin, drinN, bounds,
		cellS: cell * SCHRITT_JE_EINHEIT,
		x: (i) => bounds.min_x + i * cell,
		y: (j) => bounds.min_y + j * cell,
		i: (x) => Math.round((x - bounds.min_x) / cell),
		j: (y) => Math.round((y - bounds.min_y) / cell),
	};
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE CONSTRAINTS
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Gipfel als festgehaltene Zellen -- als KEGEL, nicht als Punkt.
//
// 💣 EIN PUNKT IST IN DER LAPLACE-LOESUNG EINE SINGULARITAET: ein Dorn, den die Diffusion sofort
// wieder abrundet. Ein Gipfel ist eine Kuppe, kein Nadelstich. Deshalb mindestens Radius 1 Zelle.
//
// 🔴 DER RADIUS IST DIE „BEDEUTUNG DES EINZELBERGS" (Owner 04.09.2026). Er entscheidet, wie weit ein
// Berg ausstrahlt, bevor das Grundrelief uebernimmt -- mit Radius 0 ist er ein Nadelstich im Kamm,
// mit grossem Radius ein eigenstaendiges Massiv.
//     h(d) = H · (1 − (d/rad)²)³        die Kuppe des heutigen Feldbaus, Zeichen fuer Zeichen
// 🔴 ABER ALS CONSTRAINT, NICHT ALS SUMMAND -- und das ist der ganze Unterschied zur Buckelsumme.
// Zwei ueberlappende Kegel ADDIEREN sich nicht, es gewinnt der hoehere. Genau daran scheitert das
// heutige Feld: 27 von 49 Gipfeln lesen ihre Zahl nicht, bis +5.820 Schritt zu hoch, weil sich bis
// zu fuenf Kuppen mit 27 Meilen Radius aufsummieren. Hier bleibt jeder Gipfel exakt bei seiner Zahl,
// egal wie viele Kegel sich ueberlagern.
//
// 🔴 Ohne erfasste Hoehe gilt ECOSYSTEM_HEIGHT_DEFAULT = 5.000 Schritt (Owner-Entscheid 2026-07-28) --
// dieselbe Zahl, mit der die Karte heute rechnet, nicht eine neue.
// ⚠️ `radius` in KARTENeinheiten. 0 (oder fehlend) heisst: nur die 3×3-Zellen wie bisher.
// 💣 ZWEI DURCHGAENGE, UND DIE REIHENFOLGE IST TRAGEND: erst alle KERNE, dann die Kegel.
// Ein Kegel mit 7,5 Meilen Radius ueberlappt seine Nachbarn, und "der Hoehere gewinnt" laesst dann
// einen 5.300er den Kern eines 3.000ers ueberschreiben -- gemessen 34,8 Schritt Abweichung, sobald
// die Bergform ueber null steht. Der KERN eines Gipfels ist unantastbar, der Kegelmantel nicht.
// ⚠️ `kern` reist heraus, weil auch die Seen ihn brauchen: ein Bergsee im Kegelmantel muss den
// Mantel ueberschreiben duerfen (sonst ist sein Spiegel nicht eben, gemessen 190 Schritt Spanne),
// einen Gipfelkern aber nie.
function stempleGipfel(r, h, fest, gipfel, vorgabe, kern) {
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	let gesetzt = 0;

	// Die Kerne (3×3), unantastbar. Die FORM des Berges kommt danach und ADDITIV
	// (addiereGipfelkegel) -- festgenagelt erzeugt sie einen Graben um jeden Gipfel.
	for (const p of gipfel) {
		const i = r.i(p.x);
		const j = r.j(p.y);
		if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
			continue;
		}
		const H = Number(p.h) > 0 ? Number(p.h) : standard;
		for (let dj = -1; dj <= 1; dj++) {
			for (let di = -1; di <= 1; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
					continue;
				}
				const k = jj * r.w + ii;
				if (!r.drin[k]) {
					continue;
				}
				if (H >= h[k]) { h[k] = H; fest[k] = 1; gesetzt++; if (kern) { kern[k] = 1; } }
			}
		}
	}

	return gesetzt;
}

// DIE EINZELBERGE -- ADDIERT, nicht festgenagelt (Owner 04.09.2026: „berge haben um sich herum
// keinen graben, sondern addieren sich aufs höhenfeld auf").
//
// 💣 DER GRABEN, UND WARUM ER ENTSTAND. Die erste Fassung stempelte den Kegel als CONSTRAINT. Am
// Kegelrand laeuft `H·(1−(d/rad)²)³` auf null aus -- festgenagelt heisst das: „hier ist die Hoehe
// null", und die Randwertaufgabe interpoliert von diesem 0-Ring nach aussen. Um jeden Gipfel lag
// ein dunkler Hof. Im Zahlenbild war nichts zu sehen (alle vier Invarianten blieben gruen), im
// gerenderten Feld sofort.
//
// 🔴 DIE FORM IST EINE UEBERHOEHUNG UEBER DEM ORTLICHEN NIVEAU, keine absolute Hoehe:
//     h(x) += (H − relief(Gipfelzelle)) · (1 − (d/rad)²)³
// Am Gipfel steht damit genau H, am Kegelrand exakt das Grundrelief -- kein Graben, keine Stufe.
//
// 🔴 UND DAS IST NICHT DIE BUCKELSUMME VON HEUTE. Dort ist die Amplitude die VOLLE Gipfelhoehe, und
// zwei Buckel addieren sich zu doppelter Hoehe (gemessen: 27 von 49 Gipfeln zu hoch, bis +5.820).
// Hier ist die Amplitude nur die UEBERHOEHUNG, und der Radius wird auf `0,72 × Abstand zum naechsten
// Gipfel` geklemmt -- die Hausregel aus `buildEcosystemHeightField`. Damit reicht kein Kegel bis zu
// einem anderen Gipfel, und jeder liest weiter genau seine Zahl.
// ⚠️ `fest`-Zellen (Gipfelkern, Kamm, spaeter Fluss/See) bleiben unberuehrt.
function addiereGipfelkegel(r, h, gipfel, radius, vorgabe, fest, mantel) {
	const rad0 = Number(radius) > 0 ? Number(radius) : 0;
	if (!(rad0 > 0)) {
		return { zellen: 0, wirksam: [] };
	}
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	let gesetzt = 0;
	const wirksam = [];                        // die WIRKLICH benutzten Radien, je Gipfel

	for (const p of gipfel) {
		const i = r.i(p.x);
		const j = r.j(p.y);
		if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) {
			continue;
		}
		const H = Number(p.h) > 0 ? Number(p.h) : standard;
		// 🔴 Die Klemme aus dem heutigen Feldbau: 0,72 × Abstand zu SEINEM naechsten Nachbarn.
		// Ohne sie ueberlagern sich die Ueberhoehungen zweier Gipfel und beide lesen zu hoch.
		let naechster = Infinity;
		for (const q of gipfel) {
			if (q === p) { continue; }
			const d = Math.hypot(p.x - q.x, p.y - q.y);
			if (d < naechster) { naechster = d; }
		}
		const rad = Math.min(rad0, 0.72 * naechster);
		wirksam.push({ name: p.n || "", rad, geklemmt: 0.72 * naechster < rad0 });
		if (!(rad > 0)) { continue; }

		// 💣 DIE BASIS IST DAS NIVEAU AM KEGELRAND, NICHT AM GIPFEL. Am Gipfel steht seine
		// eingetragene Zahl -- er ist dort festgenagelt --, also waere `H − h[Gipfelzelle]` immer
		// exakt null und der Regler wirkungslos. Genau so gemessen: alle vier Bergform-Stufen
		// lieferten dasselbe Bild. Der Berg sitzt auf dem Niveau seines FUSSES auf.
		const reich = Math.ceil(rad / r.cell);
		let randSumme = 0;
		let randZahl = 0;
		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) { continue; }
				const k = jj * r.w + ii;
				if (!r.drin[k]) { continue; }
				const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
				if (d < 0.85 * rad || d > rad) { continue; }
				randSumme += h[k];
				randZahl++;
			}
		}
		const basis = randZahl > 0 ? randSumme / randZahl : 0;
		const ueber = H - basis;
		if (!(ueber > 0)) { continue; }        // das Relief traegt den Gipfel schon

		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
					continue;
				}
				const k = jj * r.w + ii;
				if (!r.drin[k] || (fest && fest[k])) {
					continue;
				}
				const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
				if (d >= rad) {
					continue;
				}
				const u = 1 - ((d / rad) * (d / rad));
				h[k] += ueber * u * u * u;
				if (mantel) { mantel[k] = 1; }
				gesetzt++;
			}
		}
	}

	return { zellen: gesetzt, wirksam };
}

// Minimaler Spannbaum (Prim) ueber die Gipfel -- er verbindet jeden mit seinem naechsten Nachbarn,
// ohne Kreise. Bei einem langgestreckten Gebirge ergibt das die Kammlinie.
function spannbaum(punkte) {
	const n = punkte.length;
	if (n < 2) {
		return [];
	}
	const drin = new Array(n).fill(false);
	const kanten = [];
	drin[0] = true;
	for (let s = 1; s < n; s++) {
		let bi = -1;
		let bj = -1;
		let bd = Infinity;
		for (let i = 0; i < n; i++) {
			if (!drin[i]) { continue; }
			for (let j = 0; j < n; j++) {
				if (drin[j]) { continue; }
				const d = Math.hypot(punkte[i].x - punkte[j].x, punkte[i].y - punkte[j].y);
				if (d < bd) { bd = d; bi = i; bj = j; }
			}
		}
		if (bj < 0) { break; }
		drin[bj] = true;
		kanten.push([bi, bj]);
	}

	return kanten;
}

// Der KAMM als Constraint.
//
// 🔴 DIE KAMMLINIE IST DIE BESCHRIFTUNGSKURVE DER FLAECHE, nicht eine eigene Rechnung.
// `properties.curve_label_line` reist in der Kartennutzlast mit (32 Punkte, Kartenkoordinaten) und
// entsteht in `api/_internal/app/curve-labels.php`: segmentieren -> vereinfachen -> Delaunay ->
// Innendreiecke -> Chordal Axis -> laengster Pfad -> Polynomglaettung. Das IST die Mittelachse --
// dieselbe Linie, auf der der Name der Landschaft laeuft.
// 🪤 Die erste Fassung dieses Prototyps baute statt dessen einen Spannbaum ueber die Gipfel. Der
// funktioniert, ist aber eine ZWEITE Antwort auf eine Frage, die das Haus laengst beantwortet --
// und man sieht es: seine geraden Segmente stehen als Knick im Kamm. Live haben 43 der 69
// Gebirgsflaechen eine Kurve.
// ⚠️ Der Spannbaum bleibt als RUECKFALL fuer die uebrigen 26 -- ein Gebirge ohne Kurve bekommt so
// trotzdem einen Kamm, sofern es mindestens zwei Gipfel hat.
//
// 🔴 DER UNTERSCHIED ZUM KAMM-ANWUCHS VOM 03.09.2026. Dort war der Kamm eine HUELLE, mit der die
// Buckelsumme multipliziert wurde -- eine Korrektur an einem Feld, dessen Struktur schon falsch war.
// Hier ist er eine RANDBEDINGUNG: die Loesung waechst von selbst zu ihm hin. Am Finsterkamm ist das
// der Unterschied zwischen neun isolierten Sternen und einem durchgehenden Grat (im Bild gemessen).
//
// 💣 EINE SCHON FESTE ZELLE IST EIN GIPFEL -- unantastbar. Der Riegel "nur anheben" reicht NICHT:
// eine Kammlinie laeuft ueber einen niedrigen Gipfel hinweg und hebt ihn an. Beim Bau genau so
// passiert -- der Hohe Stumpen las 2.394 statt seiner eingetragenen 2.300.
//
// Die HOEHE des Kamms an einer Stelle kommt von den Gipfeln: mit inversem Quadrat gewichtet, damit
// ein naher Gipfel den Ton angibt und ein ferner nur noch mittraegt. `sattel` senkt sie dort ab, wo
// kein Gipfel in der Naehe steht (0,75 = ein Sattel liegt bei drei Vierteln).
function kammHoeheAn(x, y, pts, sattel) {
	let summe = 0;
	let gewicht = 0;
	let naechster = Infinity;
	for (const p of pts) {
		const d2 = ((x - p.x) * (x - p.x)) + ((y - p.y) * (y - p.y));
		if (d2 < 1e-9) { return p.h; }
		const g = 1 / d2;
		summe += g * p.h;
		gewicht += g;
		if (d2 < naechster) { naechster = d2; }
	}
	if (!(gewicht > 0)) { return 0; }
	const mittel = summe / gewicht;
	// Durchhang: direkt an einem Gipfel voll, dazwischen auf `sattel` abgesenkt. Der Uebergang folgt
	// dem Abstand zum naechsten Gipfel, gemessen in Kammlaenge -- nicht in einer festen Zahl.
	const d = Math.sqrt(naechster);
	const nah = Math.exp(-d * d / (2 * 4 * 4));   // 4 Karteneinheiten = 12 Meilen Halbwertsbreite
	return mittel * (sattel + (1 - sattel) * nah);
}

// 💣 DER KAMM DARF NUR ANHEBEN, NIE ABSENKEN -- und dafuer muss er NACH einer ersten Loesung
// gestempelt werden. Die erste Fassung lief davor, als `h[k]` noch ueberall 0 war; der Riegel
// `H > h[k]` war damit wirkungslos, und die Kammhoehe wurde als feste Randbedingung eingefroren,
// auch wo die Gipfel ringsum das Gelaende hoeher ziehen. Ergebnis war eine RINNE statt eines Grats:
// gemessen am Finsterkamm lag die Kammzelle im Median **266 Schritt UNTER** ihrem hoechsten
// Nachbarn, und nur 26 % der Kammzellen standen erhaben. Im Bild sah das wie ein Spalt auf dem
// Bergkamm aus -- vom Owner gesehen, von keiner Kennzahl.
// ⭐ Deshalb ruft der Ablauf: Gipfel stempeln -> loesen -> Kamm stempeln (nur wo hoeher) -> loesen.
function stempleKamm(r, h, fest, gipfel, sattel, vorgabe, kurve, marke) {
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	const pts = gipfel.map((p) => ({
		x: p.x, y: p.y, h: Number(p.h) > 0 ? Number(p.h) : standard,
	}));
	if (!pts.length) {
		return { quelle: "keine", kanten: 0, zellen: 0 };
	}

	// Die Linien, entlang derer gestempelt wird: die echte Kurve, sonst der Spannbaum.
	let linien = [];
	let quelle = "kurve";
	if (Array.isArray(kurve) && kurve.length >= 2) {
		linien = [kurve];
	} else {
		quelle = "spannbaum";
		linien = spannbaum(pts).map(([a, c]) => [[pts[a].x, pts[a].y], [pts[c].x, pts[c].y]]);
	}

	let zellen = 0;
	let stuecke = 0;
	for (const linie of linien) {
		for (let s = 1; s < linie.length; s++) {
			stuecke++;
			const [ax, ay] = linie[s - 1];
			const [bx, by] = linie[s];
			const len = Math.hypot(bx - ax, by - ay);
			const schritte = Math.max(2, Math.ceil((len / r.cell) * 2));
			for (let t = 0; t <= schritte; t++) {
				const u = t / schritte;
				const x = ax + (bx - ax) * u;
				const y = ay + (by - ay) * u;
				const i = r.i(x);
				const j = r.j(y);
				if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
					continue;
				}
				const k = j * r.w + i;
				if (!r.drin[k] || fest[k]) {
					continue;                      // fest = Gipfel, siehe oben
				}
				const H = kammHoeheAn(x, y, pts, sattel);
				if (H > h[k]) { h[k] = H; fest[k] = 1; zellen++; if (marke) { marke[k] = 1; } }
			}
		}
	}

	return { quelle, kanten: stuecke, zellen };
}

// Die FLUSSLAEUFE als Constraint.
//
// 🔴 DAS IST DER GANZE VORTEIL DER RANDWERTAUFGABE: es gibt KEINEN Talbreiten-Parameter. Der Fluss
// wird auf seiner Achse festgehalten, und die Loesung zieht das Gelaende ringsum nach unten -- das
// Tal entsteht als LOESUNG, nicht als gestempelte Form. Der Entwurf vom 03.09.2026 (Fall #109)
// brauchte dafuer Talbreite, Bach-Anteil und Tiefe als drei einzustellende Zahlen; hier braucht es
// keine davon, weil das Tal nicht gezeichnet, sondern gerechnet wird.
//
// 🔴 DER TALBODEN FLIESST NIE BERGAUF (Fall #109 woertlich). Entlang des Laufs wird der kumulative
// Tiefstwert flussabwaerts genommen -- was einmal gefallen ist, steigt nicht wieder.
//
// 💣 AUSSERHALB DER FLAECHE SAGT DAS FELD NICHTS, NICHT NULL. Ohne diese Regel zieht jeder von
// aussen kommende Fluss einen Canyon auf Fusshoehe 0 durch das Massiv -- so gemessen in der ersten
// Fassung des Talmoduls am 03.09.2026. Punkte ausserhalb treiben den Talboden also nicht.
//
// Orientiert wird nach `dir` (`forward`/`reverse`, dieselbe Quelle wie die Fliessrichtungs-Pfeile);
// fehlt sie, ist die Quelle das hoehere Ende des ungeschnittenen Reliefs.
// 🔴 `seeMaske` ist die Ausnahme, und sie ist hydrologisch: EIN FLUSS IM SEE IST DER SEE. Laeuft ein
// Lauf durch eine Wasserflaeche, gilt dort der Seespiegel -- der Fluss ueberschreibt ihn nicht, er
// UEBERNIMMT ihn (und traegt ihn flussabwaerts weiter, weil der Talboden ein Minimum ist).
// 💣 Ohne diese Regel bleibt der See schief: beim Bau gemessen 1.027 Schritt Spanne ueber einer
// Wasserflaeche, weil Weisswasser und Flussweg-5186 durch fuenf der sieben Seen der Roten Sichel
// laufen und ihre Zellen zuerst belegten.
function stempleFluesse(r, h, fest, fluesse, leser, tiefe, seeMaske, mantel) {
	const anteil = Number.isFinite(Number(tiefe)) ? Math.max(0, Math.min(1, Number(tiefe))) : 1;
	let zellen = 0;
	let geraten = 0;
	const spuren = [];

	for (const f of fluesse) {
		// Dicht abtasten: die gespeicherten Stuetzpunkte liegen teils weit auseinander, und der
		// Talboden folgte dann einer Sehne statt dem Gelaende.
		const dicht = [];
		for (let s = 1; s < f.p.length; s++) {
			const [ax, ay] = f.p[s - 1];
			const [bx, by] = f.p[s];
			const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r.cell * 0.5)));
			for (let t = 0; t < n; t++) {
				dicht.push([ax + (bx - ax) * (t / n), ay + (by - ay) * (t / n)]);
			}
		}
		dicht.push(f.p[f.p.length - 1]);

		// Nur Punkte IN der Flaeche treiben den Talboden.
		const innen = dicht.filter(([x, y]) => {
			const i = r.i(x);
			const j = r.j(y);

			return i >= 0 && j >= 0 && i < r.w && j < r.hh && r.drin[j * r.w + i];
		});
		if (innen.length < 2) {
			continue;
		}

		let lauf = innen;
		if (f.dir === "reverse") {
			lauf = innen.slice().reverse();
		} else if (!f.dir) {
			geraten++;
			const hA = leser(lauf[0][0], lauf[0][1]);
			const hB = leser(lauf[lauf.length - 1][0], lauf[lauf.length - 1][1]);
			if (hB > hA) { lauf = lauf.slice().reverse(); }
		}

		// Kumulativer Tiefstwert flussabwaerts.
		let boden = Infinity;
		const spur = [];
		for (const [x, y] of lauf) {
			const gelaende = leser(x, y);
			boden = Math.min(boden, gelaende);
			// Der Regler „Tiefe": 1 = bis auf den Talboden (die reine Regel aus #109), darunter
			// bleibt ein Anteil der oertlichen Hoehe stehen. ⚠️ Unter 1 kann Wasser im Modell
			// bergauf fliessen -- dafuer wird aus einem Fluss am Flaechenrand kein Schlitz.
			const ziel = anteil >= 1 ? boden : Math.max(boden, (1 - anteil) * gelaende);
			const i = r.i(x);
			const j = r.j(y);
			const k = j * r.w + i;
			if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[k]) {
				continue;
			}
			if (seeMaske && seeMaske[k]) {
				// Im See: der Spiegel gilt. Der Talboden UEBERNIMMT ihn und traegt ihn weiter --
				// deshalb wird `boden` hier nachgezogen, statt den Punkt nur zu ueberspringen.
				boden = Math.min(boden, h[k]);
				spur.push([x, y]);
				continue;
			}
			// ⚠️ Wie beim See: ein Fluss darf sich durch den KEGELMANTEL eines Gipfels schneiden --
			// er ist ein gezeichneter Lauf, der Mantel nur eine Form.
			// 💣 Ohne das stieg der Anstieg entlang der Laeufe von 271 auf 1.102 Schritt, sobald die
			// Bergform ueber null steht: der Lauf uebersprang die Mantelzellen und behielt dort deren
			// Hoehe. Ein Fluss, der ueber einen Berghang steigt, ist genau der Fehler aus Fall #109.
			// 💣 UND ES IST DER MANTEL, NICHT „ALLES AUSSER DEM KERN": mit der weiten Fassung
			// ueberschreibt ein Zufluss die schon gesetzten Zellen des Hauptlaufs, und der Anstieg
			// sprang auf 5.980 Schritt bei doppelter Punktzahl (Rote Sichel, 50 verzweigte Stuecke).
			// Eine Flusszelle ist fest, sobald sie EINMAL gesetzt wurde.
			if (fest[k] && !(mantel && mantel[k])) {
				continue;
			}
			if (!(h[k] > 0) || ziel < h[k]) { h[k] = Math.max(0, ziel); }
			fest[k] = 1;
			// 💣 Dieselbe Regel wie beim See: der Talboden ist eine Messung, keine Form. Ohne das
			// erodierte der Lauf mit und stieg wieder an -- gemessen 11.448 statt 1.102 Schritt.
			if (mantel) { mantel[k] = 0; }
			zellen++;
			spur.push([x, y]);
		}
		if (spur.length) { spuren.push({ n: f.n, bach: f.bach, geraten: !f.dir, p: spur }); }
	}

	return { zellen, geraten, spuren };
}

// Die SEEN als Constraint.
//
// 🔴 EIN SEE IST EIN KNOTEN MIT EINER HOEHE, keine Strecke: seine Wasserflaeche ist EBEN. Gemessen
// am heutigen Feld schwankt sie ueber die Rote Sichel bis zu 2.811 Schritt (Donnerkessel) -- ein
// See, der 2.811 Schritt Gefaelle hat, ist kein See.
//
// Der Spiegel ist der Tiefstwert des Reliefs ueber der Wasserflaeche: tiefer als jeder Punkt seines
// Randes kann er nicht stehen, hoeher wuerde er ueberlaufen.
//
// ⚠️ Der See wird zusaetzlich als `senke` markiert -- die Senkenfuellung darf ihn NICHT anheben.
// Er IST eine Senke, das ist keine Stoerung des Abflussnetzes, sondern seine Muendung.
function stempleSeen(r, h, fest, senke, seen, istImSee, leser, mantel) {
	let zellen = 0;
	const spiegel = [];
	for (let s = 0; s < seen.length; s++) {
		const zellenDesSees = [];
		let tiefster = Infinity;
		for (let j = 0; j < r.hh; j++) {
			for (let i = 0; i < r.w; i++) {
				const k = j * r.w + i;
				if (!r.drin[k]) { continue; }
				if (!istImSee(s, r.x(i), r.y(j))) { continue; }
				zellenDesSees.push(k);
				tiefster = Math.min(tiefster, leser(r.x(i), r.y(j)));
			}
		}
		if (!zellenDesSees.length || !isFinite(tiefster)) { continue; }
		for (const k of zellenDesSees) {
			// ⚠️ Ein Bergsee darf im Kegelmantel eines Gipfels liegen und gewinnt dort -- er ist ein
			// gezeichnetes Objekt, der Mantel nur eine Form. Alles andere Feste bleibt.
			if (fest[k] && !(mantel && mantel[k])) { continue; }
			h[k] = Math.max(0, tiefster);
			fest[k] = 1;
			senke[k] = 1;
			// 💣 WER DEN MANTEL UEBERSCHREIBT, LOESCHT SEINE MARKE. Sonst gilt die Zelle weiter als
			// „Form" und wird mit-erodiert -- ein Wasserspiegel, der erodiert, ist keiner mehr
			// (gemessen 41 Schritt Spanne, nachdem der Mantel erodieren durfte).
			if (mantel) { mantel[k] = 0; }
			zellen++;
		}
		spiegel.push({ i: s, hoehe: tiefster, zellen: zellenDesSees.length });
	}

	return { zellen, spiegel };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DAS GRUNDRELIEF -- die Randwertaufgabe
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// ∇²h = 0 mit den Constraints als Dirichlet-Randwerten, geloest per SOR in Rot-Schwarz-Ordnung.
//
// ⚠️ Nachbarn AUSSERHALB der Flaeche zaehlen als Hoehe 0. Das ist die Fusshoehe-0-Invariante, an der
// die Verschmelzung zweier ueberlappender Flaechen haengt (map-features-ecosystem-height-combine.js) --
// sie gilt hier woertlich und nicht naeherungsweise.
function sorDurchgang(h, w, hh, drin, fest, omega, farbe) {
	for (let j = 1; j < hh - 1; j++) {
		for (let i = 1 + ((j + farbe) & 1); i < w - 1; i += 2) {
			const k = j * w + i;
			if (!drin[k] || fest[k]) { continue; }
			const s = (drin[k + 1] ? h[k + 1] : 0) + (drin[k - 1] ? h[k - 1] : 0)
				+ (drin[k + w] ? h[k + w] : 0) + (drin[k - w] ? h[k - w] : 0);
			const neu = h[k] + omega * (s / 4 - h[k]);
			h[k] = neu < 0 ? 0 : neu;
		}
	}
}

function vergroebern(h, drin, fest, w, hh) {
	const w2 = w >> 1;
	const h2 = hh >> 1;
	const H = new Float64Array(w2 * h2);
	const D = new Uint8Array(w2 * h2);
	const F = new Uint8Array(w2 * h2);
	for (let j = 0; j < h2; j++) {
		for (let i = 0; i < w2; i++) {
			let s = 0;
			let n = 0;
			let f = 0;
			let d = 0;
			for (let dj = 0; dj < 2; dj++) {
				for (let di = 0; di < 2; di++) {
					if (2 * j + dj >= hh || 2 * i + di >= w) { continue; }
					const k = (2 * j + dj) * w + (2 * i + di);
					if (drin[k]) { d = 1; s += h[k]; n++; if (fest[k]) { f = 1; } }
				}
			}
			const K = j * w2 + i;
			D[K] = d; F[K] = f; H[K] = n ? s / n : 0;
		}
	}

	return { h: H, drin: D, fest: F, w: w2, hh: h2 };
}

// 🔴 WARUM MEHRGITTER. SOR traegt Information je Durchgang nur EINE Zelle weit -- auf 256² braeuchte
// ein Gipfel hunderte Durchgaenge, bis er den Rand ueberhaupt „sieht". Grob vorloesen kostet ein
// Sechzehntel und bringt die grosse Form in wenigen Durchgaengen. Gemessen: 34 ms fuer die Rote Sichel.
function loeseRelief(h, w, hh, drin, fest, stufen, iterGrob, iterFein, omega) {
	if (stufen > 0 && w > 32 && hh > 32) {
		const g = vergroebern(h, drin, fest, w, hh);
		loeseRelief(g.h, g.w, g.hh, g.drin, g.fest, stufen - 1, iterGrob, iterGrob, omega);
		for (let j = 0; j < hh; j++) {
			for (let i = 0; i < w; i++) {
				const k = j * w + i;
				if (!drin[k] || fest[k]) { continue; }
				h[k] = g.h[Math.min(g.hh - 1, j >> 1) * g.w + Math.min(g.w - 1, i >> 1)];
			}
		}
	}
	for (let n = 0; n < iterFein; n++) {
		sorDurchgang(h, w, hh, drin, fest, omega, 0);
		sorDurchgang(h, w, hh, drin, fest, omega, 1);
	}

	return h;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   4. RAUSCHEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 💣 OHNE STOERUNG WIRD DAS NETZ RADIAL. Eine glatte Loesung hat keine Vorzugsrichtung; die Erosion
// findet dann in jeder Richtung dasselbe Gefaelle und zeichnet einen Stern statt eines Flussnetzes.
// Das Rauschen ist keine Verzierung, es ist der Keim der Verzweigung.
//
// 🔴 MULTIPLIKATIV, damit der Rand exakt 0 bleibt und ein Gipfel seine Zahl behaelt -- dieselbe
// Bauform wie `Faktor · Rohwert^Potenz` im heutigen Feldmodul, und aus demselben Grund.
// 🔴 KEIN Math.random(): die Saat kommt aus der Identitaet der Flaeche. Echter Zufall lieferte bei
// jedem Neuberechnen andere Reisezeiten und verschoebe Routen lautlos (oekosystem-instruction §4.2).
function hash2(seed, ix, iy) {
	let n = (seed ^ Math.imul(ix, 0x85EBCA6B) ^ Math.imul(iy, 0xC2B2AE35)) | 0;
	n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D); n ^= n >>> 12;
	n = Math.imul(n ^ (n >>> 15), 0x297A2D39); n ^= n >>> 15;

	return (n >>> 0) / 4294967296;
}

function wertRauschen(seed, x, y, cell) {
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const fx = x / cell - gx;
	const fy = y / cell - gy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash2(seed, gx, gy);
	const b = hash2(seed, gx + 1, gy);
	const c = hash2(seed, gx, gy + 1);
	const d = hash2(seed, gx + 1, gy + 1);
	const t = a + (b - a) * sx;
	const u = c + (d - c) * sx;

	return (t + (u - t) * sy) * 2 - 1;
}

function fbm(seed, x, y, cell, oktaven, gain) {
	let s = 0;
	let amp = 1;
	let tot = 0;
	let c = cell;
	for (let o = 0; o < oktaven; o++) {
		s += amp * wertRauschen(seed + o * 7919, x, y, c);
		tot += amp;
		amp *= gain;
		c /= 2;
	}

	return tot > 0 ? s / tot : 0;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   5. HYDROLOGIE
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

function Heap() { this.a = []; }
Heap.prototype.push = function (k, v) {
	const a = this.a;
	a.push([k, v]);
	let i = a.length - 1;
	while (i > 0) {
		const p = (i - 1) >> 1;
		if (a[p][0] <= a[i][0]) { break; }
		const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
	}
};
Heap.prototype.pop = function () {
	const a = this.a;
	const top = a[0];
	const last = a.pop();
	if (a.length) {
		a[0] = last;
		let i = 0;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let s = i;
			if (l < a.length && a[l][0] < a[s][0]) { s = l; }
			if (r < a.length && a[r][0] < a[s][0]) { s = r; }
			if (s === i) { break; }
			const t = a[s]; a[s] = a[i]; a[i] = t; i = s;
		}
	}

	return top;
};
Heap.prototype.size = function () { return this.a.length; };

// Senken fuellen (Priority-Flood + epsilon).
//
// 🔴 WARUM UEBERHAUPT. Ein D8-Netz braucht von JEDER Zelle einen Weg nach draussen. Eine Senke ist
// eine Sackgasse: dort bricht die Akkumulation ab -- genau da, wo ein Tal entstehen sollte. Das
// epsilon gibt jeder gefuellten Zelle ein winziges Gefaelle, damit die Fliessrichtung eindeutig bleibt.
// ⚠️ `senke` nimmt die echten SEEN aus -- die SIND Senken und sollen es bleiben.
function fuelleSenken(h, w, hh, drin, eps, senke) {
	const out = new Float64Array(h.length);
	const fertig = new Uint8Array(h.length);
	const q = new Heap();
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			const k = j * w + i;
			if (!drin[k]) { fertig[k] = 1; continue; }
			let rand = i === 0 || j === 0 || i === w - 1 || j === hh - 1;
			if (!rand) {
				for (let dj = -1; dj <= 1 && !rand; dj++) {
					for (let di = -1; di <= 1; di++) {
						if (!drin[(j + dj) * w + i + di]) { rand = true; break; }
					}
				}
			}
			if (rand) { out[k] = h[k]; fertig[k] = 1; q.push(h[k], k); } else { out[k] = Infinity; }
		}
	}
	while (q.size()) {
		const [, k] = q.pop();
		const i = k % w;
		const j = (k - i) / w;
		for (let dj = -1; dj <= 1; dj++) {
			for (let di = -1; di <= 1; di++) {
				if (!di && !dj) { continue; }
				const ni = i + di;
				const nj = j + dj;
				if (ni < 0 || nj < 0 || ni >= w || nj >= hh) { continue; }
				const nk = nj * w + ni;
				if (fertig[nk] || !drin[nk]) { continue; }
				out[nk] = (senke && senke[nk]) ? h[nk] : Math.max(h[nk], out[k] + eps);
				fertig[nk] = 1;
				q.push(out[nk], nk);
			}
		}
	}
	for (let k = 0; k < out.length; k++) {
		if (!drin[k] || !isFinite(out[k])) { out[k] = h[k]; }
	}

	return out;
}

// D8: jede Zelle bekommt EINEN Empfaenger -- den steilsten Abstieg unter acht Nachbarn.
// 💣 Gefaelle je LAENGE, nicht je Zelle: diagonal ist 1,414 mal weiter, und ohne das bevorzugt D8
// die Diagonalen sichtbar.
// ⚠️ Ein Nachbar ausserhalb der Flaeche zaehlt als Hoehe 0 -- das ist der Abfluss aus dem Gebirge.
function flussrichtung(h, w, hh, drin, cellS) {
	const rec = new Int32Array(h.length).fill(-1);
	const dist = new Float64Array(h.length);
	const diag = cellS * Math.SQRT2;
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			const k = j * w + i;
			if (!drin[k]) { continue; }
			let best = 0;
			let bk = -1;
			let bd = cellS;
			for (let dj = -1; dj <= 1; dj++) {
				for (let di = -1; di <= 1; di++) {
					if (!di && !dj) { continue; }
					const ni = i + di;
					const nj = j + dj;
					if (ni < 0 || nj < 0 || ni >= w || nj >= hh) { continue; }
					const nk = nj * w + ni;
					const d = (di && dj) ? diag : cellS;
					const s = (h[k] - (drin[nk] ? h[nk] : 0)) / d;
					if (s > best) { best = s; bk = drin[nk] ? nk : -2; bd = d; }
				}
			}
			rec[k] = bk;
			dist[k] = bd;
		}
	}
	// Topologische Reihenfolge: Empfaenger vor Gebern, per Zaehlsortierung ueber die Zuflusszahl.
	const nrec = new Int32Array(h.length);
	for (let k = 0; k < h.length; k++) { if (drin[k] && rec[k] >= 0) { nrec[rec[k]]++; } }
	const stapel = new Int32Array(h.length);
	let sp = 0;
	const ordnung = new Int32Array(h.length);
	let op = 0;
	for (let k = 0; k < h.length; k++) { if (drin[k] && nrec[k] === 0) { stapel[sp++] = k; } }
	while (sp) {
		const k = stapel[--sp];
		ordnung[op++] = k;
		if (rec[k] >= 0 && --nrec[rec[k]] === 0) { stapel[sp++] = rec[k]; }
	}

	return { rec, dist, ordnung, n: op };
}

// Flow Accumulation: in topologischer Reihenfolge reicht jede Zelle ihre Flaeche weiter.
//
// 🔴 HIER ENTSTEHT DAS NETZ. Nicht durch Zufallstreffer wie beim Tropfen-Verfahren, sondern
// deterministisch aus dem Relief. `vorgabe` prägt den GEZEICHNETEN Fluesen ihre Akkumulation auf --
// das ist „bekannte Hauptfluesse + simulierte Nebenentwaesserung" in einer Zeile.
function akkumuliere(fd, drin, zellFlaeche, vorgabe) {
	const acc = new Float64Array(drin.length);
	for (let k = 0; k < drin.length; k++) {
		if (drin[k]) { acc[k] = zellFlaeche + (vorgabe ? vorgabe[k] : 0); }
	}
	for (let n = 0; n < fd.n; n++) {
		const k = fd.ordnung[n];
		if (fd.rec[k] >= 0) { acc[fd.rec[k]] += acc[k]; }
	}

	return acc;
}

// Stream Power, IMPLIZIT geloest (Braun & Willett 2013, „FastScape").
//
//     dh/dt = -K · A^m · S^n     mit n = 1 analytisch:
//     h_i = (h_i + K·dt·A^m · h_rec / L) / (1 + K·dt·A^m / L)
//
// 🔴 DESHALB GEHEN GROSSE ZEITSCHRITTE: die Form ist unbedingt stabil, und die Hoehe kann per
// Konstruktion nie unter die ihres Empfaengers fallen. Ein Tropfen ist faktisch ein EXPLIZITES
// Verfahren und braucht winzige Schritte -- das ist der Grund, warum dort „keine milde Einstellung"
// existierte.
// ⚠️ In UMGEKEHRTER topologischer Reihenfolge: der Empfaenger muss schon neu stehen.
function streamPower(h, fd, acc, K, m, dt, fest) {
	for (let n = fd.n - 1; n >= 0; n--) {
		const k = fd.ordnung[n];
		if (fest && fest[k]) { continue; }
		const r = fd.rec[k];
		const hr = r >= 0 ? h[r] : 0;              // -2 = fliesst aus der Flaeche, Basis 0
		if (h[k] <= hr) { continue; }
		const f = K * dt * Math.pow(acc[k], m) / fd.dist[k];
		h[k] = (h[k] + f * hr) / (1 + f);
	}
}

// Hangdiffusion: was die Rinnen einschneiden, rundet das Kriechen wieder ab. Ohne sie wird das Bild
// nadelig; mit ihr entstehen die glatten Flanken zwischen den Rinnen.
//
// 💣 STABILITAETSGRENZE. Explizite Diffusion in 2D ist nur fuer D·dt/cell² ≤ 0,25 stabil. Beim Bau
// mit 0,78 gefahren -- die Durchschnittshoehe explodierte auf 4,2e29. Deshalb in Teilschritte
// zerlegt, statt den Wert stillschweigend zu klemmen: eingestellt wird eine STAERKE, keine
// Schrittweite.
function diffundiere(h, w, hh, drin, D, dt, cellS, fest) {
	const gesamt = D * dt / (cellS * cellS);
	const schritte = Math.max(1, Math.ceil(gesamt / 0.2));
	const f = gesamt / schritte;
	let cur = h;
	for (let s = 0; s < schritte; s++) {
		const out = Float64Array.from(cur);
		for (let j = 1; j < hh - 1; j++) {
			for (let i = 1; i < w - 1; i++) {
				const k = j * w + i;
				if (!drin[k] || (fest && fest[k])) { continue; }
				const e = drin[k + 1] ? cur[k + 1] : 0;
				const we = drin[k - 1] ? cur[k - 1] : 0;
				const su = drin[k + w] ? cur[k + w] : 0;
				const no = drin[k - w] ? cur[k - w] : 0;
				out[k] = cur[k] + f * (e + we + su + no - 4 * cur[k]);
				if (out[k] < 0) { out[k] = 0; }
			}
		}
		cur = out;
	}

	return cur;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6. DER LAUF
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Ein Erosionsschritt samt HEBUNG.
//
// 💣 DIE HEBUNG WIRD NICHT EINGESTELLT, SONDERN GEMESSEN: nach jedem Schritt wird genau so viel
// gehoben, wie abgetragen wurde -- verteilt nach dem Startrelief (wo das Gebirge hoch ist, hebt es
// sich). Damit bleibt die Durchschnittshoehe von selbst stehen, und es gibt keine Zahl zu raten.
// ⚠️ Das ist die Antwort auf „es gibt keine milde Erosionseinstellung" (03.09.2026): mild oder stark
// aendert jetzt die FORM, nicht mehr die HOEHE. Gemessen ueber 150 Schritte: Ø 1.361 -> 1.392.
//
// 🔴 ZWEI MASKEN, UND DIE GRENZE HEISST: GEMESSENE GROESSE GEGEN MODELLIERTE FORM.
// Eine festgehaltene Zelle nimmt an der Hebung NICHT teil und wird auch nicht erodiert oder
// verrauscht. Fuer eine EINGETRAGENE Zahl ist das richtig, fuer eine erfundene Form ist es falsch:
//   `fest`     -- die Randwertaufgabe: Gipfelkern + Kegelmantel + Kamm + Fluss + See
//   `festEro`  -- die Erosion: nur Gipfelkern + Fluss + See (was wirklich gemessen ist)
//
// 💣 DAS IST ZWEIMAL SICHTBAR DANEBENGEGANGEN, beide Male vom Owner gesehen und von keiner Kennzahl:
//  - **Der Spalt auf dem Bergkamm.** Der Kamm liegt nur wenig ueber seiner Umgebung; die waechst mit
//    jeder Hebung an ihm vorbei. Gemessen am Finsterkamm: VOR der Erosion Median 1 Schritt unter dem
//    hoechsten Nachbarn, DANACH 360 -- nur 11 % der Kammzellen noch erhaben. Mit der Trennung: 21
//    Schritt, 49 % erhaben.
//  - **Die Bergform wurde zur glatten Kugel.** Ein festgehaltener Kegelmantel bekommt weder Rauschen
//    noch Rinnen und steht als polierte Halbkugel im Gelaende -- derselbe „weisse Blob", nur an
//    anderer Stelle erzeugt.
// ⚠️ Fehlt `festEro`, gilt `fest` -- der alte Stand, damit ein Aufrufer ohne die zweite Maske nicht
// stillschweigend seine Gipfel verliert.
function erosionsSchritt(zustand, opt) {
	const { r, senke, relief } = zustand;
	const fest = zustand.festEro || zustand.fest;
	let h = zustand.h;
	let vorher = 0;
	for (let k = 0; k < r.drin.length; k++) { if (r.drin[k]) { vorher += h[k]; } }

	const gefuellt = fuelleSenken(h, r.w, r.hh, r.drin, 1e-4, senke);
	const fd = flussrichtung(gefuellt, r.w, r.hh, r.drin, r.cellS);
	const acc = akkumuliere(fd, r.drin, r.cellS * r.cellS, zustand.accVorgabe);
	streamPower(h, fd, acc, opt.K, opt.m || 0.5, 1, fest);
	h = diffundiere(h, r.w, r.hh, r.drin, opt.D * r.cellS * r.cellS, 1, r.cellS, fest);

	let nachher = 0;
	for (let k = 0; k < r.drin.length; k++) { if (r.drin[k]) { nachher += h[k]; } }
	const verlust = vorher - nachher;
	if (verlust > 0 && zustand.hebungSumme > 0) {
		const rate = verlust / zustand.hebungSumme;
		for (let k = 0; k < r.drin.length; k++) {
			if (r.drin[k] && !fest[k]) { h[k] += rate * relief[k]; }
		}
	}

	zustand.h = h;
	zustand.fd = fd;
	zustand.acc = acc;

	return zustand;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SCHRITT_JE_EINHEIT, baueRaster,
		stempleGipfel, addiereGipfelkegel, spannbaum, stempleKamm, kammHoeheAn, stempleFluesse, stempleSeen,
		loeseRelief, fbm,
		fuelleSenken, flussrichtung, akkumuliere, streamPower, diffundiere, erosionsSchritt,
	};
}
