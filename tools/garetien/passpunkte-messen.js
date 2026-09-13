/**
 * DIE PASSPUNKT-MESSUNG, in EINEM Stueck zum Einfuegen.
 *
 * Anwendung: auf https://avesmaps.de als ANGEMELDETER EDITOR die Entwicklerkonsole oeffnen
 * (F12 -> Konsole), diese Datei ganz hineinkopieren, Enter.
 *
 * Entwurf: docs/superpowers/specs/2026-09-13-garetien-passpunkte-design.md §6
 *
 * ⚠️ EIN Aufruf, keine Schleife. Der Lauf geht ueber alle aktiven Ortspunkte -- CLAUDE.md:
 * auf STRATO nie einen schweren Endpunkt wiederholt fahren.
 * ⚠️ Vorbedingung: im Garetien-Importer muss ein Lauf im Staging liegen ("Dump holen").
 */
(async () => {
	const antwort = await fetch("/api/edit/map/garetien-import.php", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "passpunkte" }),
		credentials: "same-origin"
	});

	/* 💣 ERST DEN TEXT, DANN DAS JSON. Ein Fatal Error in PHP antwortet mit HTTP 200 und
	   einem LEEREN Rumpf; `response.json()` wirft dann "Unexpected end of JSON input", und
	   das liest sich wie ein Netzfehler statt wie ein Programmfehler. Der Rohtext sagt, was
	   wirklich kam -- eine Anmelde-Weiterleitung zum Beispiel. */
	const roh = await antwort.text();
	let d;
	try {
		d = JSON.parse(roh);
	} catch (e) {
		console.error("Keine JSON-Antwort (HTTP " + antwort.status + "). Rohtext, erste 400 Zeichen:");
		console.error(roh.length ? roh.slice(0, 400) : "(leerer Rumpf — das ist das Bild eines PHP-Fatals)");
		return;
	}
	if (!d.ok) {
		console.error("Der Endpunkt lehnt ab (HTTP " + antwort.status + "):", d.error || d);
		if (antwort.status === 401 || antwort.status === 403) {
			console.error("→ Nicht angemeldet, oder die Fähigkeit `edit` fehlt.");
		}
		return;
	}

	const zahl = (v, n = 2) => (typeof v === "number" ? v.toFixed(n) : "—");

	console.log("%c Passpunkt-Messung ", "background:#5b5548;color:#f6efe1;font-weight:bold");

	/* 🔴 ZUERST die Selbstprüfung. Eine vertauschte Achse oder ein falscher Lauf sieht in
	   diesen Zahlen wie ein gewaltiger, wunderbar zusammenhängender Versatz aus -- also genau
	   wie das Ergebnis, das jemanden dazu brächte, eine Korrekturmatrix zu bauen. */
	const sp = d.selbstpruefung || {};
	const verdaechtig = Boolean(sp.warnung);
	if (verdaechtig) {
		console.warn("⚠️ SELBSTPRÜFUNG: " + sp.warnung);
		console.warn("   Nichts deuten, bevor das geklärt ist.");
	} else {
		console.log("✓ Selbstprüfung bestanden — Median " + zahl(sp.median)
			+ " Meilen, p90 " + zahl(sp.p90) + " (Entwurf §2.1 belegt 1,24).");
	}

	const b = d.bericht || {};
	console.log("Lauf " + b.lauf + ": " + b.paare + " Passpunkte aus "
		+ b.ihre_ortspunkte + " ihrer und " + b.unsere_ortspunkte + " unserer Ortspunkte."
		+ " Mehrdeutig verworfen: " + b.mehrdeutig_verworfen
		+ ", nur bei ihnen: " + b.nur_bei_ihnen + ".");

	/* 💣 BEI ANGESCHLAGENER SELBSTPRÜFUNG WIRD DAS URTEIL ZURÜCKGEHALTEN, nicht nur
	   kommentiert. Die erste Fassung hat oben gewarnt und darunter trotzdem ein sattgrünes
	   "TRÄGT" gesetzt -- und ein Banner schlägt eine Warnzeile, die drei Zeilen höher steht.
	   Genau so entsteht der Fehler, gegen den die Selbstprüfung gebaut ist: vertauschte Achsen
	   sehen wie ein perfekt korrigierbares Feld aus, und dann steht da "TRÄGT". Die Zahlen
	   darunter bleiben stehen -- sie helfen beim Suchen; nur die ENTSCHEIDUNG entfällt. */
	const u = d.urteil || {};
	if (verdaechtig) {
		console.log("%c KEIN URTEIL — SELBSTPRÜFUNG OFFEN ",
			"background:#b8860b;color:#fff;font-weight:bold");
		console.log("Die Zahlen unten stehen zur Fehlersuche da, nicht zur Deutung."
			+ " Erst klären, warum der Median so weit von 1,24 Meilen entfernt liegt:"
			+ " richtiger Lauf? Achsen vertauscht? Falschpaare nicht gefiltert?");
	} else {
		const farbe = { traegt: "#2f7d3a", traegt_nicht: "#9d3a2e", zu_wenig: "#706557" }[u.stufe] || "#706557";
		console.log("%c " + (u.stufe || "?").toUpperCase() + " ", "background:" + farbe + ";color:#fff;font-weight:bold");
		console.log(u.satz || "");
	}

	console.log("Nachbarprobe:");
	console.table((d.nachbarprobe || []).map((p) => ({
		Nachbarn: p.k,
		"vorher (mi)": Number(zahl(p.vorher_median)),
		"nachher (mi)": Number(zahl(p.nachher_median)),
		"besser %": Math.round((p.anteil_besser || 0) * 100),
		Einigkeit: Number(zahl(p.uebereinstimmung))
	})));

	const g = d.globaler_versatz || {};
	console.log("Ein einziger konstanter Versatz brächte: "
		+ zahl(g.vorher_median) + " → " + zahl(g.nachher_median) + " Meilen"
		+ "  (er wäre dx " + zahl(g.versatz_dx) + " / dy " + zahl(g.versatz_dy) + " Meilen).");

	const t = d.west_sued_trend || {};
	console.log('Behauptung "je weiter Westen, desto weiter Süden": '
		+ zahl(t.sued_je_100_west) + " Meilen je 100 Meilen West, p = " + zahl(t.p_wert, 3)
		+ (t.p_wert > 0.05 ? "  → zu oft Zufall, stützt die Behauptung NICHT."
		                   : "  → selten genug, um sie ernst zu nehmen."));

	/* Die zehn grössten Einzelversätze -- dort schaut ein Editor zuerst hin. */
	const groesste = (d.residuen || []).slice().sort((a, x) => x.betrag - a.betrag).slice(0, 10);
	console.log("Die zehn grössten Versätze:");
	console.table(groesste.map((r) => ({
		Ort: r.name, "Betrag (mi)": Number(zahl(r.betrag)), Richtung: r.richtung,
		dx: Number(zahl(r.dx)), dy: Number(zahl(r.dy))
	})));

	window.__passpunkte = d;
	try {
		await navigator.clipboard.writeText(JSON.stringify(d));
		console.log("%c Die ganze Antwort liegt in der Zwischenablage. ",
			"background:#bfa03a;color:#2e271e");
	} catch (e) {
		console.log("Zwischenablage ging nicht — die Antwort steht in window.__passpunkte;"
			+ " mit copy(window.__passpunkte) kopieren.");
	}
	console.log("→ In docs/garetien-passpunkte-mockup.html unten einfügen, dann erscheint das Bild.");
})();
