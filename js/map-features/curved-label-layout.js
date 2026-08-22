// Die reine Rechnung hinter Text auf einer gebogenen Linie: Glyphenlagen aus der Bogenlaenge,
// Drehung aus der Tangente, Leserichtung, Huellbox, Ausweichreihenfolge.
//
// 🔴 Umgezogen am 22.08.2026 aus map-features-path-label-canvas-overlay.js -- WOERTLICH, nur eine
// Ebene Einrueckung weniger. Grund: die Kurvenbeschriftung der Landschaftsflaechen braucht dieselbe
// Rechnung, und in der IIFE des Overlays war sie weder erreichbar noch pruefbar. Derselbe Schnitt
// wie bei label-placement.js drei Tage zuvor: was rein ist, steht fuer sich und laesst sich testen.
//
// 💣 Rein heisst hier woertlich rein: kein ctx, kein map, kein document, kein Leaflet. Nachgemessen
// an allen zwoelf Funktionen. Wer hier etwas ergaenzt, das die Karte anfasst, nimmt der Datei ihren
// einzigen Vorzug -- dann steht der naechste Test wieder vor einer IIFE.
//
// ⚠️ findFreePlacement fragt zwei GLOBALE der Belegungskarte ab (avesmapsLabelOccupancy,
// labelOccupancyBlocksGlyphs), beide per `typeof` abgesichert. Im Test sind sie schlicht nicht da,
// und dann weicht nur niemand aus -- das ist gewollt, kein Loch.

// Läuft der Abschnitt, den der Text TATSÄCHLICH belegt (drawGlyphsAlong zentriert ihn immer auf
// dem übergebenen Punkte-Array), netto nach links? Die Aufrufer drehen nur die GANZE Polyline
// links->rechts -- eine Serpentine kann in ihrer Mitte trotzdem zurücklaufen, und genau dort stand
// die Schrift auf dem Kopf (Discord #34). Gleiche Konvention wie dort, nur auf dem Teilstück.
function labelSpanRunsLeftward(pts, textLen) {
	const cum = [0];
	for (let i = 1; i < pts.length; i += 1) {
		cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
	}
	const total = cum[cum.length - 1];
	if (!(total > 0) || textLen > total) {
		return false;
	}
	const xAt = (d) => {
		for (let i = 1; i < pts.length; i += 1) {
			if (d <= cum[i]) {
				const segLen = cum[i] - cum[i - 1];
				const t = segLen > 0 ? (d - cum[i - 1]) / segLen : 0;
				return pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
			}
		}
		return pts[pts.length - 1].x;
	};
	const spanStart = (total - textLen) / 2;
	return xAt(spanStart + textLen) < xAt(spanStart);
}

// --- Discord #18: "Beschriftung legt sich an Flussbiegung an" -------------------------------
// Zwei getrennte Hebel, beide lassen die Leitlinie unangetastet (der Name bleibt EXAKT auf der
// sichtbaren Linie -- die 2026-06-10 verworfene Glaettung kommt NICHT zurueck):
//
//   A  WO steht der Name? Nicht mehr stur auf der Mitte des angebotenen Stuecks, sondern auf dem
//      ruhigsten Abschnitt in Reichweite. Das entscheiden die AUFRUFER, bevor sie ihr Fenster
//      ausschneiden -- drawGlyphsAlong beschriftet weiter genau das Stueck, das es bekommt, und
//      Fall #34 pinnt per Test, dass es dabei nichts verschiebt.
//   B  WIE dicht stehen die Buchstaben? Siehe drawGlyphsAlong.
//
// Gemessen ueber alle 320 beschrifteten Fluss-Einheiten (Zoom 4, echte Geometrie): 2151 ueberlappende
// Glyphen in 286 Fluessen vorher, 447 in 127 nachher.
const LABEL_TURN_PROFILE_STEP_PX = 5;

// Richtungsprofil einer Bildschirm-Polylinie: Kurs alle LABEL_TURN_PROFILE_STEP_PX Pixel, dazu die
// aufsummierte |Richtungsaenderung| als Praefixsumme. EIN Vorwaertslauf (O(n+m)); danach kostet jede
// Spannen-Frage zwei Array-Zugriffe. Ohne das liefe die Suche unten pro Kandidat neu ueber die ganze
// Kette -- bei ~50 Kandidaten je Platzierung waere das pro Redraw spuerbar. Pur.
function buildLabelTurningProfile(pts, stepPx) {
	const step = Number(stepPx) > 0 ? Number(stepPx) : 5;
	if (!Array.isArray(pts) || pts.length < 2) {
		return { step, total: 0, prefix: [0] };
	}
	const cum = [0];
	for (let i = 1; i < pts.length; i += 1) {
		cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
	}
	const total = cum[cum.length - 1];
	const headings = [];
	let i = 1;
	for (let d = 0; d <= total; d += step) {
		while (i < pts.length - 1 && cum[i] < d) i += 1;
		headings.push(Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x));
	}
	const prefix = [0];
	for (let k = 1; k < headings.length; k += 1) {
		const raw = headings[k] - headings[k - 1];
		prefix.push(prefix[k - 1] + Math.abs(Math.atan2(Math.sin(raw), Math.cos(raw))));
	}
	return { step, total, prefix };
}

// Gesamte Richtungsaenderung (Radiant) ueber [fromDist, fromDist + spanLen]. Pur.
function labelSpanTurning(profile, fromDist, spanLen) {
	if (!profile || !profile.prefix || profile.prefix.length < 2) {
		return 0;
	}
	const last = profile.prefix.length - 1;
	const a = Math.max(0, Math.min(last, Math.round(fromDist / profile.step)));
	const b = Math.max(0, Math.min(last, Math.round((fromDist + spanLen) / profile.step)));
	return Math.max(0, profile.prefix[b] - profile.prefix[a]);
}

// A: die ruhigste Mitte in Reichweite. `anchorWeight` haelt den Namen in der Naehe seiner Sollstelle,
// damit die Wiederholungen entlang einer Kette nicht zusammenklumpen; die Strafe ist relativ zur
// Krummheit der Sollstelle, sonst wuerde sie auf geraden Ketten (base ~ 0) alles dominieren. Pur.
function findCalmLabelCenter(profile, center, textLen, searchPx, anchorWeight) {
	const reach = Number(searchPx) || 0;
	if (!(reach > 0) || !profile || profile.total <= 0) {
		return center;
	}
	const half = textLen / 2;
	const low = Math.max(half + 8, center - reach);
	const high = Math.min(profile.total - half - 8, center + reach);
	if (!(high > low)) {
		return center;
	}
	const base = labelSpanTurning(profile, center - half, textLen);
	const weight = Number(anchorWeight) || 0;
	let best = center;
	let bestCost = base;
	for (let c = low; c <= high; c += profile.step) {
		const cost = labelSpanTurning(profile, c - half, textLen)
			+ weight * (Math.abs(c - center) / reach) * Math.max(base, 0.35);
		if (cost < bestCost) {
			bestCost = cost;
			best = c;
		}
	}
	return best;
}

// (Das Teilstueck um `center` schneidet sliceLabelWindowAt aus -- es bekommt die kumulierte Laenge
// der Kette mit, statt sie je Fenster neu zu bauen. Die Ausweichsuche fragt bis zu 50 Fenster je
// Platzierung ab; ein eigener Aufbau je Fenster liefe jedes Mal ueber die ganze Kette.)

// Halbe Fensterbreite fuer eine Platzierung: Textbreite plus etwas Luft, und mit Kruemmungs-Ausgleich
// zusaetzlich eine Schrifthoehe -- der Zuschlag verlaengert den Namen, und laeuft er ueber das Fenster
// hinaus, staut at() die letzten Buchstaben am Fensterende.
function labelWindowHalf(textLen, fontSize, relief) {
	return textLen / 2 + 4 + (relief > 0 ? Math.max(0, Number(fontSize) || 0) : 0);
}

// Glyphen einzeln entlang der Pixel-Polyline platzieren (zentriert auf dem jeweiligen Slot, tangential
// rotiert) -- die reine RECHNUNG, ohne zu zeichnen. Getrennt vom Malen, weil das Ausweichen vor
// Ortsnamen die Buchstabenlagen BRAUCHT, bevor entschieden ist, ob hier ueberhaupt gezeichnet wird
// (siehe findFreePlacement). Eine Rechnung, zwei Aufrufer: drawGlyphsAlong malt genau das hier.
function layoutGlyphsAlong(pts, chars, widths, ls, perpOffset, fontSize) {
	const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;
	// Vor dem perpOffset-Shift umdrehen, damit „positiv = oben" für den gedrehten Lauf gilt.
	if (labelSpanRunsLeftward(pts, textLen)) {
		pts = pts.slice().reverse();
	}
	if (perpOffset) {
		// Alle Punkte senkrecht zur Linie verschieben (positiv = „oben"/über der Linie für links->rechts).
		const shifted = [];
		for (let i = 0; i < pts.length; i += 1) {
			const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
			let tx = b.x - a.x, ty = b.y - a.y; const tm = Math.hypot(tx, ty) || 1; tx /= tm; ty /= tm;
			shifted.push({ x: pts[i].x + ty * perpOffset, y: pts[i].y - tx * perpOffset });
		}
		pts = shifted;
	}
	const seg = [];
	let total = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		seg.push({ cum: total, len: d, a: pts[i - 1], b: pts[i] });
		total += d;
	}
	if (!seg.length) {
		return null;
	}
	if (textLen > total) {
		return null; // Linie zu kurz für den Namen
	}
	const at = (d) => {
		for (const s of seg) {
			if (d <= s.cum + s.len) {
				const t = (d - s.cum) / (s.len || 1);
				return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) };
			}
		}
		const l = seg[seg.length - 1];
		return { x: l.b.x, y: l.b.y, ang: Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) };
	};

	// B (Discord #18): Auf einem Bogen dreht jeder Buchstabe gegen seinen Nachbarn. Weil ein Glyph ein
	// starrer Kasten ist, stossen die Kaesten an der INNENSEITE zusammen -- genau das ist das
	// "zusammengedrueckt" der Meldung. Der Zuschlag (Hoehe/2)*|dTheta| auf den Vorschub ist der Betrag,
	// den die Drehung der Innenkante wegnimmt. Ohne fontSize (Altaufruf) oder mit relief = 0 laeuft
	// alles wie zuvor -- darauf steht der #34-Test.
	const relief = typeof PATH_LABEL_CURVATURE_RELIEF !== "undefined" ? Number(PATH_LABEL_CURVATURE_RELIEF) || 0 : 0;
	const halfHeight = (Number(fontSize) > 0 ? Number(fontSize) : 0) * 0.72 / 2;
	const place = (startDist, strength) => {
		const glyphs = [];
		let dist = startDist;
		let previousAngle = null;
		for (let i = 0; i < chars.length; i += 1) {
			const w = widths[i];
			let p = at(dist + w / 2);
			if (strength > 0 && halfHeight > 0 && previousAngle !== null) {
				const raw = p.ang - previousAngle;
				const turn = Math.abs(Math.atan2(Math.sin(raw), Math.cos(raw)));
				if (turn > 0) {
					dist += halfHeight * turn * strength;
					p = at(dist + w / 2);
				}
			}
			// w/h reisen mit: die Ausweichpruefung braucht den (gedrehten) Kasten jedes Buchstabens,
			// und 0.72 x Schriftgrad ist dieselbe Tintenhoehe, mit der schon #18 gemessen wurde.
			glyphs.push({ x: p.x, y: p.y, ang: p.ang, w, h: (Number(fontSize) > 0 ? Number(fontSize) : 0) * 0.72 });
			previousAngle = p.ang;
			dist += w + ls;
		}
		return { glyphs, consumed: dist - ls - startDist };
	};

	// ⚠ DER ZUSCHLAG DARF DEN NAMEN NIE UEBER SEIN STUECK HINAUS SCHIEBEN. at() klemmt jenseits des
	// Endes auf den letzten Punkt -- die ueberstehenden Buchstaben laegen dann exakt aufeinander, und
	// der Name verlaere sichtbar sein letztes Zeichen ("Der Grosse Fluss" -> "Der Grosse Flus").
	// Passt er nicht, wird der Ausgleich halbiert, bis er passt; im letzten Schritt auf 0. Mit 0 ist
	// consumed == textLen, und textLen > total ist oben schon abgefangen -> die Schleife endet immer.
	let strength = relief;
	let run = place((total - textLen) / 2, strength);
	for (let guard = 0; guard < 4 && run.consumed > total; guard += 1) {
		strength = guard === 3 ? 0 : strength / 2;
		run = place((total - textLen) / 2, strength);
	}
	// Mittig nachziehen: sonst waechst der laengere Name nur nach RECHTS aus seinem Fenster.
	if (run.consumed > textLen) {
		run = place((total - run.consumed) / 2, strength);
	}
	return run.glyphs;
}

// Wie krumm steht dieser Name? Summe der Richtungsaenderung von Buchstabe zu Buchstabe, in Grad --
// dasselbe Mass, mit dem Discord #18 gemessen wurde, nur an der fertigen Platzierung statt an der
// Linie. Ein gerader Name liefert 0, ein Name um eine Flussschlinge mehrere hundert Grad. Pur.
function labelGlyphRunTurningDegrees(glyphs) {
	if (!Array.isArray(glyphs) || glyphs.length < 2) {
		return 0;
	}
	let sum = 0;
	for (let i = 1; i < glyphs.length; i += 1) {
		const raw = glyphs[i].ang - glyphs[i - 1].ang;
		sum += Math.abs(Math.atan2(Math.sin(raw), Math.cos(raw)));
	}
	return sum * 180 / Math.PI;
}

// Die grobe Huelle einer Platzierung: erst damit wird das Belegungsgitter befragt, danach nur noch
// gegen die wenigen Treffer genau geprueft. Gleiche Rechnung wie die Selbstkollisions-Box unten
// (Buchstabenlagen + eine Schriftgroesse Polster).
function glyphsHullBox(glyphs, fontSize) {
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const glyph of glyphs) {
		if (glyph.x < left) left = glyph.x;
		if (glyph.x > right) right = glyph.x;
		if (glyph.y < top) top = glyph.y;
		if (glyph.y > bottom) bottom = glyph.y;
	}
	const pad = Number(fontSize) || 0;
	return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

// Die Reihenfolge, in der das Ausweichen unten seine Kandidatenstellen abklopft.
//
// 💣 DAS AUSWEICHEN DARF DIE BOGENSUCHE NICHT WIEDER AUFHEBEN. Bis 2026-08-06 lief es stur
// 0, +12, -12, +24, -24 ... und nahm die ERSTE freie Stelle -- ohne zu fragen, wie krumm die
// ist. findCalmLabelCenter hatte davor genau dafuer das ruhigste Stueck gesucht (Discord #18),
// und der erste Ortsname im Weg warf das wieder weg. Messbar wurde es am Unterschied zwischen
// zwei Ansichten: derselbe Fluss, derselbe Ausschnitt, in Landschaften (kaum etwas belegt, also
// Offset 0) auf 38 Grad Kruemmung -- in der Standardansicht auf 110 (Warna; Hils 2 gegen 40,
// Tarnel 45 gegen 83).
//
// ⚠️ DIESE FUNKTION ALLEIN ZIEHT DIE BEIDEN ANSICHTEN NICHT GLEICH, und sie soll es auch nicht
// vorgeben. Am echten Bestand nachgespielt (Live-Geometrie, echte Belegungskarte, 2026-08-06)
// aenderte die neue Reihenfolge bei Warna, Hils und Tarnel GAR NICHTS: die ruhige Stelle war dort
// nicht bloss ungefragt, sie war besetzt -- von einem Ortsnamen bzw. von "Talloner Huegelsteig".
// Gleich aussehen laesst die Namen erst PATH_LABEL_MAX_TURN_DEG (der Deckel, siehe unten in der
// Suche). Die Reihenfolge hier ist dessen Vorbedingung: sie sorgt dafuer, dass der Deckel nur die
// Namen wegnimmt, fuer die es wirklich keine ruhige Stelle gibt, statt die naechstbeste zu nehmen
// und dann daran zu scheitern.
//
// 🔴 DIE NULL BLEIBT VORN. Eine FREIE Wunschstelle behaelt der Name -- sonst tauschte das
// Ausweichen sie auch dort gegen eine ruhigere, wo gar nichts im Weg steht, und veraenderte das
// Bild in der leeren Landschaften-Ansicht. Sortiert werden nur die Ausweichstellen, und zwar
// nach denselben Kosten wie in findCalmLabelCenter: Kruemmung des Stuecks plus Anker-Strafe fuer
// die Entfernung. Gleichstand faellt auf die alte Reihenfolge zurueck (naeher zuerst, vorwaerts
// vor rueckwaerts) -- auf einer geraden Linie ist deshalb alles wie bisher. Ohne Profil (die
// Bogensuche ist per ?pathtune=1 abschaltbar) bleibt die alte Reihenfolge ganz. Pur.
function orderDodgeOffsets(slide, step, profile, wishCenter, textLen, anchorWeight) {
	const offsets = [];
	for (let d = step; d <= slide; d += step) {
		offsets.push(d);
		offsets.push(-d);
	}
	if (!profile || offsets.length === 0) {
		return [0, ...offsets];
	}
	const reach = slide > 0 ? slide : 1;
	const weight = Number(anchorWeight) || 0;
	const base = labelSpanTurning(profile, wishCenter - textLen / 2, textLen);
	const ranked = offsets.map((offset, index) => ({
		offset,
		index,
		cost: labelSpanTurning(profile, wishCenter + offset - textLen / 2, textLen)
			+ weight * (Math.abs(offset) / reach) * Math.max(base, 0.35),
	}));
	ranked.sort((first, second) => (first.cost - second.cost) || (first.index - second.index));
	return [0, ...ranked.map((entry) => entry.offset)];
}

// Die freie Stelle fuer einen Namen an SEINER EIGENEN Linie: Sollstelle zuerst, danach die
// Ausweichstellen in PATH_LABEL_DODGE_STEP_PX-Schritten bis PATH_LABEL_DODGE_SLIDE_PX -- in der
// Reihenfolge, die orderDodgeOffsets vorgibt (ruhigstes Stueck zuerst, siehe dort).
// Zur Seite weicht hier nichts aus -- ein Strassenname gehoert auf seine Strasse. Findet sich keine
// freie Stelle, gibt es null zurueck und der Aufrufer laesst diese Platzierung aus; der naechste
// Name derselben Kette steht ~WAY_LABEL_SCREEN_INTERVAL_PX weiter.
// `blockedByOwnKind` prueft die Selbstkollision der Wegnamen untereinander (Kanal A), `hull`/`glyphs`
// gehen an die gemeinsame Belegungskarte (Orts-, Landschafts-, Gebietsnamen).
function findFreePlacement(chainPts, cum, total, wishCenter, chars, widths, ls, fontSize, blockedByOwnKind, turningProfile = null) {
	const slide = typeof PATH_LABEL_DODGE_SLIDE_PX !== "undefined" ? Math.max(0, Number(PATH_LABEL_DODGE_SLIDE_PX) || 0) : 0;
	const step = typeof PATH_LABEL_DODGE_STEP_PX !== "undefined" ? Math.max(1, Number(PATH_LABEL_DODGE_STEP_PX) || 1) : 12;
	const textLen = widths.reduce((sum, w) => sum + w + ls, 0) - ls;
	const bend = pathLabelBendSettings();
	const half = labelWindowHalf(textLen, fontSize, bend.relief);
	const perp = -(typeof PATH_LABEL_DY !== "undefined" ? PATH_LABEL_DY : 0);

	const offsets = orderDodgeOffsets(slide, step, turningProfile, wishCenter, textLen, bend.anchor);
	for (const offset of offsets) {
		const center = wishCenter + offset;
		// Nicht ueber die Enden der eigenen Kette hinaus -- dort staut at() die Buchstaben aufeinander.
		if (center < textLen / 2 || center > total - textLen / 2) {
			continue;
		}
		const windowPts = sliceLabelWindowAt(chainPts, cum, total, center, half);
		if (windowPts.length < 2) {
			continue;
		}
		const glyphs = layoutGlyphsAlong(windowPts, chars, widths, ls, perp, fontSize);
		if (!glyphs || glyphs.length === 0) {
			continue;
		}
		// 🔴 ZU KRUMM IST WIE BESETZT. Der Name rutscht weiter, statt sich in den Bogen zu legen;
		// findet er nirgends eine ruhige Stelle, faellt die Platzierung aus -- genau wie bei einem
		// belegten Platz. Vor den Belegungsfragen, weil es die billigere Pruefung ist.
		if (bend.maxTurn > 0 && labelGlyphRunTurningDegrees(glyphs) > bend.maxTurn) {
			continue;
		}
		const hull = glyphsHullBox(glyphs, fontSize);
		if (typeof blockedByOwnKind === "function" && blockedByOwnKind(hull)) {
			continue;
		}
		if (typeof labelOccupancyBlocksGlyphs === "function"
			&& labelOccupancyBlocksGlyphs(avesmapsLabelOccupancy, hull, glyphs)) {
			continue;
		}
		return { center, windowPts, glyphs, hull };
	}
	return null;
}

// Teilstueck von `pts` um `center` (+/- `half`), Enden interpoliert. layoutGlyphsAlong zentriert immer
// auf dem, was es bekommt -- die AUSWAHL der Stelle passiert hier. Die kumulierte Laenge kommt von
// aussen: die Ausweichsuche schneidet bis zu 50 Fenster je Platzierung aus, und sie je Fenster neu
// aufzubauen liefe jedes Mal ueber die ganze Kette. Pur.
function sliceLabelWindowAt(pts, cum, total, center, half) {
	const start = Math.max(0, center - half);
	const end = Math.min(total, center + half);
	const at = (d) => {
		for (let i = 1; i < pts.length; i += 1) {
			if (d <= cum[i]) {
				const segLen = cum[i] - cum[i - 1];
				const t = segLen > 0 ? (d - cum[i - 1]) / segLen : 0;
				return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
			}
		}
		return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
	};
	const out = [at(start)];
	for (let i = 0; i < pts.length; i += 1) {
		if (cum[i] > start && cum[i] < end) out.push(pts[i]);
	}
	out.push(at(end));
	return out;
}

// Kumulierte Laenge je Punkt einer Bildschirm-Polylinie.
function cumulativeLengths(pts) {
	const cum = [0];
	for (let i = 1; i < pts.length; i += 1) {
		cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
	}
	return cum;
}

// Die fertig gerechneten Glyphen malen. textAlign/textBaseline werden in redraw() gesetzt;
// Halo = weicher Schatten + scharfe Kontur.
