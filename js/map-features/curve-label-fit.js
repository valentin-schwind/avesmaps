// Die Passung eines Namens auf seine Kurve: Sperrung, Verlaengerung, Verkleinerung, Verteilung
// mehrerer Namen. Rein -- Bildschirmpunkte und gemessene Zeichenbreiten herein, Fenster heraus.
// Wer misst, ist der Aufrufer; wer zeichnet, ist das Overlay.
//
// 🔴 PORTIERT, NICHT ERFUNDEN. Das Verfahren steht fertig und vom Owner abgenommen im Prototyp
// docs/kurvenlabel-mockup.html (zeichneOverlay + richtungWaehlen, ruhigstesFenster, beruhigen,
// verlaengern, teilStueck, habenKollision). Hier steht dieselbe REGEL; wo curved-label-layout.js
// dasselbe schon kann, gilt die Hausfassung.
//
// 💣 Der Prototyp rechnet in [x, y]-Paaren, dieses Modul in {x, y}-Punkten -- so liefert Leaflet
// sie, und so erwartet layoutGlyphsAlong sie. Die Umschreibung ist im ganzen Modul durchgezogen;
// es gibt keine Stelle mehr, die ein Paar sieht.
//
// 🔴 Die Werte unten sind die Tafel aus Entwurf §6.1. Sie stehen HIER, an einer Stelle, mit ihren
// Vorgaben -- Plan 4 haengt die Kachel „Darstellung" daran, ohne eine Zahl zu suchen.
// ⚠️ Zwei davon sind an SECHS Flaechen geraten, nicht an 644 gemessen: der Mindestabstand zweier
// Namen und der Ausweichweg. Der Owner sieht sie nach dem Bau an allen Flaechen gemeinsam durch
// (Entwurf §6.1, §9.14). Deshalb stehen sie in einer Tafel und nicht verstreut im Code.
const AVESMAPS_CURVE_LABEL_DEFAULTS = {
	maxTurnDeg: 30,           // §5.1 Beruhigung gegen die Sehne
	extendMaxPct: 30,         // §4.4 Mittel 1: Kurve verlaengern
	trackingPct: 20,          // §5.2 Sperrung ueber die Flaeche
	trackingMaxPct: 50,       // §5.2 🔴 Deckel, nie darueber
	trackingMaxPerGapEm: 0.6, // §5.2 💣 der Deckel, den man am Schirm sieht
	minFontPx: 8,             // §4.4 Mittel 2: Untergrenze
	headroomPct: 15,          // §4.4 Vorhalt, damit nicht jedes Label ins Verlaengern laeuft
	safetyPct: 4,             // §4.4 Sicherheitsrand der Passung
	minGapEm: 2.0,            // §4.2 Mindestabstand zweier Namen -- GERATEN
	dodgePx: 6,               // §7.2 Ausweichweg -- GERATEN
	// ⚠️ Steht nicht in der Tabelle von §6.1, gehoert aber in dieselbe Tafel: im Prototyp heisst er
	// MITTE_GEWICHT und ist mit 2,5 der Grund, warum bei der Schwarzen Sichel nicht beide Namen an
	// der gemeinsamen Naht landen (§5.1). Eine Zahl, die das entscheidet, gehoert nicht in den Code.
	calmAnchorWeight: 2.5,
};

// Toleranz der Leserichtungsprobe, in PIXELN (Prototyp: LESE_TOLERANZ).
// 💣 Nicht zu verwechseln mit dem abgeschafften Band: jenes war ein ANTEIL (rund 15°) und liess
// eine Sehne von -102° durch (Entwurf §4.1). Ein Pixel ist keine Stellung, sondern Rundung.
const CURVE_LABEL_READ_TOLERANCE_PX = 1.0;

// Wie fein ein Abschnitt abgetastet wird, bevor das ruhigste Stueck darin gesucht wird.
// ⚠️ Dieselben 160 wie im Prototyp (ruhigstesFenster -> K.resample(line, 160)). Sie sind kein
// Genauigkeitsmass, sondern die Grundlage von zwei Rechnungen: die Beruhigung mischt punktweise
// zur Sehne, und mit drei Punkten kaeme statt einer beruhigten Kurve ein anders geknickter Zug
// heraus. Fest, nicht laengenabhaengig -- so war es abgenommen.
const CURVE_LABEL_RESAMPLE_N = 160;

// Wie viele Punkte je Grundlinie die Kollisionsprobe abtastet (Prototyp: K.resample(basis, 16)).
const CURVE_LABEL_COLLISION_SAMPLES = 16;

// Bogenlaenge einer Bildschirm-Polylinie. Die Hausfassung cumulativeLengths liefert das Feld, hier
// interessiert nur der letzte Wert.
function curveLabelLineLength(pts) {
	if (!Array.isArray(pts) || pts.length < 2) {
		return 0;
	}
	const cum = cumulativeLengths(pts);
	return cum[cum.length - 1];
}

// Eine Polylinie gleichmaessig auf `n` Punkte abtasten (Prototyp: K.resample).
function curveLabelResample(pts, n) {
	if (!Array.isArray(pts) || pts.length < 2 || !(n > 1)) {
		return Array.isArray(pts) ? pts.slice() : [];
	}
	const cum = cumulativeLengths(pts);
	const total = cum[cum.length - 1];
	if (!(total > 0)) {
		return pts.slice();
	}
	const out = [];
	let seg = 1;
	for (let k = 0; k < n; k += 1) {
		const ziel = (total * k) / (n - 1);
		while (seg < cum.length - 1 && cum[seg] < ziel) {
			seg += 1;
		}
		const t = (ziel - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1);
		out.push({
			x: pts[seg - 1].x + (pts[seg].x - pts[seg - 1].x) * t,
			y: pts[seg - 1].y + (pts[seg].y - pts[seg - 1].y) * t,
		});
	}
	return out;
}

// §4.1 Der erste Buchstabe steht weiter links als der letzte -- die ganze Leserichtungsregel, in
// EINER Funktion. Owner 22.08.2026, woertlich: „kannst du nicht überprüfen ob der 1. buchstabe
// weiter links ist wie der letzte?"
//
// ⭐ Das Vorzeichen von dx entscheidet die Hausfassung labelSpanRunsLeftward, ueber die GANZE
// uebergebene Linie (textLen = Bogenlaenge). Was sie nicht kennt, ist der senkrechte Fall: dort ist
// dx null, beide Richtungen lesen sich gleich gut, und es gilt die kartografische Gewohnheit „von
// unten nach oben". Genau dieser Fall sind die Koschberge (Entwurf §4.1, dx = 0).
//
// 💣 Innerhalb der Toleranz wird NICHT gedreht, sondern nach y entschieden -- ein Band um die
// verbotene Stellung herum erlaubt die verbotene Stellung, und daran ist der zweite Anlauf des
// Entwurfs gescheitert. Ein Pixel ist Rundung, kein Band.
function curveLabelReadingOrder(pts) {
	if (!Array.isArray(pts) || pts.length < 2) {
		return pts;
	}
	const erster = pts[0];
	const letzter = pts[pts.length - 1];
	const dx = letzter.x - erster.x;
	if (Math.abs(dx) <= CURVE_LABEL_READ_TOLERANCE_PX) {
		// y waechst am Schirm nach unten: laeuft die Linie abwaerts, wird sie umgedreht.
		return letzter.y > erster.y ? pts.slice().reverse() : pts;
	}
	return labelSpanRunsLeftward(pts, curveLabelLineLength(pts)) ? pts.slice().reverse() : pts;
}

// Eine Linie anteilig zu ihrer Sehne hin mischen (Prototyp: K.straighten). Die Endpunkte bleiben
// liegen, die Leserichtung aendert sich also nicht.
function curveLabelStraighten(pts, amount) {
	if (!(amount > 0) || !Array.isArray(pts) || pts.length < 2) {
		return pts;
	}
	const a = pts[0];
	const b = pts[pts.length - 1];
	const cum = cumulativeLengths(pts);
	const total = cum[cum.length - 1] || 1;
	return pts.map((p, i) => {
		const t = cum[i] / total;
		return {
			x: p.x + (a.x + (b.x - a.x) * t - p.x) * amount,
			y: p.y + (a.y + (b.y - a.y) * t - p.y) * amount,
		};
	});
}

// §5.1 Beruhigung: so weit zur Sehne hin mischen, bis kein Stueck mehr als `maxTurnRad` von ihr
// abweicht. Im Extremfall wird daraus eine Gerade -- was ein Kartograf bei einem stark geknickten
// Objekt auch tut.
// ⚠️ Sie KUERZT den Bogen (eine Sehne ist kuerzer als ihr Bogen). Deshalb steht die Passung unten
// NACH dieser Stelle und nicht davor -- genau daran entstand im Prototyp „CHWARZE SICHE".
function curveLabelCalmToChord(pts, maxTurnRad) {
	if (!Array.isArray(pts) || pts.length < 3 || !(maxTurnRad > 0)) {
		return pts;
	}
	const sehne = Math.atan2(pts[pts.length - 1].y - pts[0].y, pts[pts.length - 1].x - pts[0].x);
	for (let a = 0; a <= 1.0001; a += 0.08) {
		const kand = a > 0 ? curveLabelStraighten(pts, a) : pts;
		let schlimmste = 0;
		for (let i = 1; i < kand.length; i += 1) {
			const roh = Math.atan2(kand[i].y - kand[i - 1].y, kand[i].x - kand[i - 1].x) - sehne;
			const d = Math.abs(Math.atan2(Math.sin(roh), Math.cos(roh)));
			if (d > schlimmste) {
				schlimmste = d;
			}
		}
		if (schlimmste <= maxTurnRad) {
			return kand;
		}
	}
	return curveLabelStraighten(pts, 1);
}

// §4.4 Mittel 1 und 3: eine Grundlinie tangential verlaengern, an beiden Enden gleich viel.
// ⚠️ Die Richtung wird ueber mehrere Punkte gemittelt -- die letzte Einzelstrecke ist nach dem
// Abtasten sehr kurz und ihre Richtung entsprechend zittrig; ein daraus verlaengertes Ende knickt
// sichtbar weg.
function curveLabelExtend(pts, ziel) {
	const laenge = curveLabelLineLength(pts);
	if (!(ziel > laenge) || !Array.isArray(pts) || pts.length < 2) {
		return pts;
	}
	const zusatz = (ziel - laenge) / 2;
	const richtung = (p, q) => {
		const dx = p.x - q.x;
		const dy = p.y - q.y;
		const l = Math.hypot(dx, dy) || 1;
		return { x: dx / l, y: dy / l };
	};
	const k = Math.min(4, pts.length - 1);
	const va = richtung(pts[0], pts[k]);
	const vb = richtung(pts[pts.length - 1], pts[pts.length - 1 - k]);
	return [{ x: pts[0].x + va.x * zusatz, y: pts[0].y + va.y * zusatz }]
		.concat(pts, [{ x: pts[pts.length - 1].x + vb.x * zusatz, y: pts[pts.length - 1].y + vb.y * zusatz }]);
}

// §4.2 Stossen zwei Namen DESSELBEN Objekts aneinander? Gemessen an Kreisen entlang der Grundlinie
// -- eine achsenparallele Huellbox waere bei einem schraeg laufenden Namen ein Vielfaches zu gross
// und meldete Kollisionen, die es nicht gibt.
// ⚠️ Nur INNERHALB einer Flaeche. Labels verschiedener Objekte gegeneinander sind die bestehende
// Kollisionsaufloesung der Karte (§7.2), nicht diese Rechnung.
function curveLabelWindowsCollide(fenster, minGapEm) {
	if (!Array.isArray(fenster) || fenster.length < 2) {
		return false;
	}
	// `minGapEm` ist der geforderte LICHTE Abstand zweier Namen in Schriftgroessen -- also je Label
	// die Haelfte davon als Radius.
	const kreise = fenster.map((f) => ({
		p: curveLabelResample(f.pts, CURVE_LABEL_COLLISION_SAMPLES),
		r: (f.fontSize * minGapEm) / 2,
	}));
	for (let i = 0; i < kreise.length; i += 1) {
		for (let j = i + 1; j < kreise.length; j += 1) {
			const grenze = kreise[i].r + kreise[j].r;
			for (const a of kreise[i].p) {
				for (const c of kreise[j].p) {
					if (Math.hypot(a.x - c.x, a.y - c.y) < grenze) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

// Aus einer projizierten Kurve, einem Namen und den Schriftmassen bis zu `anzahl` Textfenster.
//
// `punkte`  Bildschirmpunkte {x, y} der Beschriftungskurve (vom Server, projiziert vom Aufrufer)
// `zeichen` die Buchstaben des anzuzeigenden Namens
// `breiten` deren gemessene Breiten BEI `schriftgroesse`
// `anzahl`  Hoechstwert, kein Sollwert (§4.2)
//
// -> { fenster: [{ pts, ls, fontSize, chars, widths }], hinweise: [...] }  oder  null
//
// Die Fenster kommen so heraus, dass layoutGlyphsAlong(pts, chars, widths, ls, ..., fontSize) sie
// annimmt: Summe(widths) + ls x (chars-1) <= Bogenlaenge von pts. Das ist die Zusicherung, an der
// „CHWARZE SICHE" haengt -- ein textPath bricht nicht um und staucht nicht, er laesst Buchstaben weg.
function avesmapsCurveLabelFit(punkte, zeichen, breiten, schriftgroesse, anzahl) {
	const tafel = AVESMAPS_CURVE_LABEL_DEFAULTS;
	if (!Array.isArray(punkte) || punkte.length < 2) {
		return null;
	}
	if (!Array.isArray(zeichen) || zeichen.length === 0) {
		return null;
	}
	if (!Array.isArray(breiten) || breiten.length !== zeichen.length) {
		return null;
	}
	const grundGroesse = Number(schriftgroesse) > 0 ? Number(schriftgroesse) : 0;
	if (!(grundGroesse > 0)) {
		return null;
	}
	const rohBreiten = breiten.map((b) => (Number(b) > 0 ? Number(b) : 0));
	const rohBreite = rohBreiten.reduce((s, b) => s + b, 0);
	if (!(rohBreite > 0)) {
		return null;
	}

	// --- Schritt 1: Leserichtung der ganzen Kurve -------------------------------------------------
	// ⚠️ Hier steht sie, damit die Fenster in Schirmreihenfolge herauskommen -- die eigentliche
	// Entscheidung faellt weiter unten JE FENSTER. Der Prototyp hat die Wahl auf der ganzen Kurve
	// ausdruecklich abgeschafft („KEINE Leserichtung auf der ganzen Kurve mehr"): bei der Schwarzen
	// Sichel biegt die obere Haelfte zurueck, erbte die Richtung der unteren und stand damit auf dem
	// Kopf (Entwurf §4.1, erster Anlauf). Beide Aufrufe teilen sich EINE Regel -- curveLabelReadingOrder.
	const kurve = curveLabelReadingOrder(punkte);
	const kurveCum = cumulativeLengths(kurve);
	const gesamt = kurveCum[kurveCum.length - 1];
	if (!(gesamt > 0)) {
		return null;
	}

	const maxN = Math.max(1, Math.floor(Number(anzahl) || 1));
	const mindestAbstand = tafel.minGapEm * grundGroesse;
	const luecken = zeichen.length - 1;

	// §4.2 Die Bogenlaenge in `n` gleiche Abschnitte teilen. Zwischen zwei Abschnitten bleibt der
	// halbe Mindestabstand frei -- beide zusammen ergeben ihn ganz.
	// ⚠️ An den AUSSEN-Enden wird nicht eingezogen: dort steht kein zweiter Name, von dem Abstand zu
	// halten waere, und die Verlaengerung (§4.4) darf ohnehin ueber das Kurvenende hinausgehen.
	const abschnitteFuer = (n) => {
		const out = [];
		for (let i = 0; i < n; i += 1) {
			const von = (gesamt * i) / n + (i > 0 ? mindestAbstand / 2 : 0);
			const bis = (gesamt * (i + 1)) / n - (i < n - 1 ? mindestAbstand / 2 : 0);
			if (bis - von < 1) {
				return [];
			}
			out.push({ von, bis });
		}
		return out;
	};

	// Ein Abschnitt -> ein fertiges Fenster. Hier steht die ganze Passungsregel.
	// ⚠️ Diese Funktion fuehrt KEINE Zaehler -- sie laeuft auch fuer Kandidaten, die der
	// Kollisionsabbau gleich wieder verwirft, und wuerde die Hinweise sonst aufblasen.
	const fensterFuer = (abschnitt) => {
		const teilMitte = (abschnitt.von + abschnitt.bis) / 2;
		const teilHalb = (abschnitt.bis - abschnitt.von) / 2;
		const grob = sliceLabelWindowAt(kurve, kurveCum, gesamt, teilMitte, teilHalb);
		if (grob.length < 2) {
			return null;
		}
		// Erst hier abtasten, nicht auf der ganzen Kurve: die Beruhigung mischt punktweise, und ein
		// Abschnitt aus zwei Punkten liesse sich nicht beruhigen (siehe CURVE_LABEL_RESAMPLE_N).
		const teil = curveLabelResample(grob, CURVE_LABEL_RESAMPLE_N);
		const teilCum = cumulativeLengths(teil);
		const teilLaenge = teilCum[teilCum.length - 1];
		if (!(teilLaenge > 0)) {
			return null;
		}

		let g = grundGroesse;
		let widths = rohBreiten.slice();
		let w = rohBreite;
		// 💣 Sicherheitsrand: ein textPath zeichnet NICHTS, was ueber das Pfadende hinausragt -- ohne
		// Rand fehlt bei jedem Rundungsrest der erste und letzte Buchstabe.
		let benoetigt = w * (1 + tafel.safetyPct / 100);
		// ⚠️ Das Fenster wird um den Vorhalt groesser angefordert, als der Name braucht: die Beruhigung
		// verkuerzt den Bogen immer ein Stueck. Ohne den Vorhalt liefe jedes Label ins Verlaengern --
		// und die Meldung „verlaengert" waere kein Befund mehr, sondern Grundrauschen.
		const wunsch = benoetigt * (1 + tafel.headroomPct / 100);
		const passtRoh = wunsch <= teilLaenge;

		// --- §5.1 Das ruhigste Stueck ---------------------------------------------------------------
		// 💣 Gesucht wird NUR innerhalb des eigenen Abschnitts, und der Zuschlag fuer den Abstand zur
		// Mitte ist auf die FREIE Strecke normiert. Ohne beides wandern bei einer gebogenen Flaeche
		// alle Namen an dieselbe Stelle: bei der Schwarzen Sichel liegt die ruhigste Stelle beider
		// Haelften an der gemeinsamen Naht, und die zwei Grundlinien standen gemessen 4 px auseinander,
		// wo 566 px Platz waren. Mit normiertem Zuschlag: 172 px.
		// 🪤 Das sah wie eine Kollision aus und war die Fenstersuche. Wer es dafuer haelt und die
		// Kollisionsschwelle nachzieht, zementiert den Fehler und schluckt kuenftig stumm Labels.
		const fensterLaenge = Math.min(teilLaenge, wunsch);
		const halb = fensterLaenge / 2;
		const profil = buildLabelTurningProfile(teil, LABEL_TURN_PROFILE_STEP_PX);
		const freieStrecke = Math.max(0, (teilLaenge - fensterLaenge) / 2);
		const mitte = findCalmLabelCenter(profil, teilLaenge / 2, fensterLaenge, freieStrecke, tafel.calmAnchorWeight);
		let basis = sliceLabelWindowAt(teil, teilCum, teilLaenge, mitte, halb);
		if (basis.length < 2) {
			return null;
		}
		basis = curveLabelCalmToChord(basis, (tafel.maxTurnDeg * Math.PI) / 180);
		// §4.1 je Fenster, nicht je Kurve -- hier faellt die Entscheidung.
		basis = curveLabelReadingOrder(basis);
		let laenge = curveLabelLineLength(basis);
		if (!(laenge > 0)) {
			return null;
		}

		// --- §4.4 Kein abgeschnittener Buchstabe ----------------------------------------------------
		// Drei Mittel, alle vom Owner benannt, in dieser Reihenfolge: Kurve verlaengern (gedeckelt) ->
		// Schrift verkleinern -> und wenn beides nicht reicht, doch weiter verlaengern.
		let gedehnt = false;
		let geschrumpft = false;
		if (benoetigt > laenge) {
			const deckel = laenge * (1 + tafel.extendMaxPct / 100);
			if (deckel > laenge) {
				basis = curveLabelExtend(basis, Math.min(benoetigt, deckel));
				laenge = curveLabelLineLength(basis);
				gedehnt = true;
			}
		}
		if (benoetigt > laenge) {
			// ⚠️ `breiten` sind bei `schriftgroesse` gemessen; bei kleinerer Schrift skalieren sie
			// LINEAR mit. Canvas-Schriften skalieren metrisch linear -- das ist zulaessig, und es steht
			// hier, damit niemand spaeter auf die Idee kommt, neu zu messen.
			const kleiner = Math.max(tafel.minFontPx, Math.floor(g * (laenge / benoetigt)));
			if (kleiner < g) {
				g = kleiner;
				widths = rohBreiten.map((b) => (b * g) / grundGroesse);
				w = widths.reduce((s, b) => s + b, 0);
				benoetigt = w * (1 + tafel.safetyPct / 100);
				geschrumpft = true;
			}
		}
		if (benoetigt > laenge) {
			basis = curveLabelExtend(basis, benoetigt);
			laenge = curveLabelLineLength(basis);
			gedehnt = true;
		}

		// --- §5.2 Die Sperrung ----------------------------------------------------------------------
		// Der Name soll die Flaeche aufspannen; gesperrt wird nur der ABSTAND, nie die Glyphe.
		// 💣 Der Anteil allein genuegt nicht: bei Zoom 7 ist die Drachenstein-Kurve 11 246 px lang und
		// der Name 197 px; 20 % davon waeren Buchstaben mit 50 px Abstand, die als Wort nicht mehr
		// lesbar sind. Gedeckelt wird zusaetzlich der ZUSATZ je Luecke in Schriftgroessen -- das ist
		// die Zahl, die man am Schirm sieht. Der kleinere Deckel gewinnt.
		// 🪤 GEMESSEN: in DIESEM Bau kann der Deckel je Luecke nie ausloesen. Das Fenster wird nach dem
		// NAMEN bemessen (hoechstens Vorhalt + Sicherheitsrand, also 1,196 x Textbreite), der freie Rest
		// betraegt damit hoechstens 15 % des Textes und der Zusatz je Luecke bleibt weit unter 0,6 em.
		// Die 11 246 px baendigt nicht dieser Deckel, sondern die Fenstergroesse. Er bleibt trotzdem
		// stehen -- er ist die Regel aus §5.2, und er greift in dem Augenblick, in dem jemand das
		// Fenster ueber den Namen hinaus aufzieht, damit der Name die Flaeche wirklich aufspannt.
		const nutzbar = laenge / (1 + tafel.safetyPct / 100);
		const anteil = Math.min(tafel.trackingPct, tafel.trackingMaxPct) / 100;
		const zielBreite = Math.min(
			w + Math.max(0, nutzbar - w) * anteil,
			w + Math.max(1, luecken) * tafel.trackingMaxPerGapEm * g,
			nutzbar
		);
		let ls = luecken > 0 ? Math.max(0, (zielBreite - w) / luecken) : 0;

		// 💣 DIE LETZTE HANDLUNG, und sie steht NACH der Beruhigung: passt der gesperrte Text in seinen
		// Bogen? Haelt die Probe nicht, wird verlaengert, bis sie haelt -- abgeschnitten wird nie.
		// ⚠️ Nach der Konstruktion oben (zielBreite <= nutzbar) haelt sie immer; sie bleibt trotzdem
		// stehen, weil sie das einzige ist, was die Zusicherung gegen jede kuenftige Aenderung an der
		// Sperrung oder an der Beruhigung haelt.
		for (let schutz = 0; schutz < 8 && w + ls * luecken > laenge + 1e-9; schutz += 1) {
			basis = curveLabelExtend(basis, (w + ls * luecken) * (1 + tafel.safetyPct / 100));
			laenge = curveLabelLineLength(basis);
			gedehnt = true;
		}
		if (w + ls * luecken > laenge + 1e-9) {
			// Letzter Ausweg: die Sperrung ganz aufgeben, statt einen Buchstaben zu verlieren.
			ls = 0;
		}

		return {
			pts: basis, ls, fontSize: g, chars: zeichen.slice(), widths,
			passtRoh, gedehnt, geschrumpft,
		};
	};

	// --- §4.2 Die Zahl ist ein HOECHSTwert ----------------------------------------------------------
	// Von `anzahl` abwaerts bis 1; die erste Belegung, in der alle Namen passen UND keine zwei
	// aneinanderstossen, gewinnt. 🔴 Abgebaut wird durch NEUVERTEILEN, nicht durch Weglassen: weil bei
	// jedem `n` neu geteilt wird, verteilt sich der verbleibende Name ueber die GANZE Kurve.
	// 🔴 Bei n = 1 wird angenommen, ohne zu fragen -- was dann noch nicht passt, loest die Passung
	// oben (verlaengern, verkleinern). Ein Name faellt nie aus.
	let gewaehlt = null;
	for (let n = maxN; n >= 1; n -= 1) {
		const abschnitte = abschnitteFuer(n);
		if (abschnitte.length !== n) {
			continue;
		}
		const kandidaten = [];
		for (const abschnitt of abschnitte) {
			const kandidat = fensterFuer(abschnitt);
			if (!kandidat) {
				break;
			}
			kandidaten.push(kandidat);
		}
		if (kandidaten.length !== n) {
			continue;
		}
		if (n === 1) {
			gewaehlt = kandidaten;
			break;
		}
		if (kandidaten.every((k) => k.passtRoh) && !curveLabelWindowsCollide(kandidaten, tafel.minGapEm)) {
			gewaehlt = kandidaten;
			break;
		}
	}
	if (!gewaehlt) {
		return null;
	}

	// Je Fenster ein Wort, wenn verlaengert oder verkleinert wurde -- der Befund, den die Abnahme misst.
	// ⚠️ Der Abbau von `anzahl` steht NICHT darin: er ist an fenster.length ablesbar und braucht kein
	// zweites Vokabular.
	const hinweise = [];
	gewaehlt.forEach((k) => {
		if (k.gedehnt) {
			hinweise.push("verlaengert");
		}
		if (k.geschrumpft) {
			hinweise.push("verkleinert");
		}
	});

	return {
		fenster: gewaehlt.map((k) => ({
			pts: k.pts, ls: k.ls, fontSize: k.fontSize, chars: k.chars, widths: k.widths,
		})),
		hinweise,
	};
}
