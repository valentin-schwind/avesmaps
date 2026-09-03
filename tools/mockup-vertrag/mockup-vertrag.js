/**
 * DER MOCKUP-VERTRAG — ein Mockup, das nicht bindet, ist eine Zeichnung.
 *
 * 💣 WARUM ES DAS GIBT. Am 02.09.2026 sagte der Owner: „wieso schaffst du es eigentlich nicht
 * diese beiden formulare erstellen und editieren gleich aussehen zu lassen? […] du hast doch das
 * mockup. warum machen wir das mockup?" Die Antwort war unangenehm: das Mockup zeigte das Ziel,
 * band aber nichts. Gebaut wurde danach am nächstliegenden Markup entlang — vier Rezepturen für
 * EINEN Rahmen (`.fs-adresse`, `.fs-eintrag`, `.fs-korpus`, `.fs-edit__group`), im Browser
 * gemessen 10px/normal gegen 11px/fett, 8px gegen 10px Polster, solid gegen dashed.
 *
 * 🔴 UND EIN QUELLTEXT-PRÜFER HÄTTE DAS NICHT GEFUNDEN. Jede der vier Regeln liest sich für sich
 * genommen tadellos; der Fehler ist der UNTERSCHIED, und den sieht nur, wer beide nebeneinander
 * legt. Genau das tut diese Datei — und sie tut es als TEST, nicht als Empfehlung: das Deploy-Tor
 * lädt bei einem roten Test nichts hoch (AGENTS.md §9).
 *
 * ## Wie ein Mockup verbindlich wird
 *
 * Es erklärt in seinem `<style>`, welche Datei seine Regeln tragen muss:
 *
 *     /* ══ VERTRAG: css/features/feature-sources.css ══ *\/
 *     .fs-scope { border: 1px solid var(--color-accent-brown); … }
 *     /* ══ VERTRAG ENDE ══ *\/
 *
 * Ab da gilt: jede Eigenschaft, die zwischen den Marken steht, MUSS in der genannten Datei
 * zeichengleich stehen. Wer im Produktivcode 10px schreibt, wo das Mockup 11px zeigt, macht einen
 * Test rot — und zwar den, der vor dem Push ohnehin läuft.
 *
 * ⚠️ ES IST EINE UNTERGRENZE, KEINE OBERGRENZE. Die Produktionsdatei darf mehr Eigenschaften und
 * mehr Selektoren tragen (Zustände, Hover, Telefon-Umbrüche); geprüft wird nur, was das Mockup
 * ZUSAGT. Andersherum wäre jedes Mockup ein Käfig, und niemand baute je wieder eins.
 * ⚠️ Und es prüft DEKLARATIONEN, nicht das gerechnete Bild — Spezifität und Ladereihenfolge sieht
 * es nicht. Dafür gibt es den Blick im Browser; siehe `.claude/agents/mockup-treue.md`.
 */

"use strict";

/**
 * Schneidet die Vertragsblöcke aus einem Mockup.
 *
 * 💣 KEIN Kommentar-Entferner davor. Die Marken SIND Kommentare — wer erst strippt, hat nichts
 * mehr zu finden. (Die umgekehrte Falle, ein Test der an seinem eigenen Kommentar anschlägt,
 * kostet dieses Haus regelmäßig einen Deploy; hier ist sie durch die Marken ausgeschlossen.)
 *
 * @param {string} html der Inhalt der Mockup-Datei
 * @returns {Array<{datei: string, css: string}>}
 */
function vertragsBloecke(html) {
	const text = String(html || "").replace(/\r\n/g, "\n");
	const bloecke = [];
	// ⚠️ Die Marke DARF weiterreden. Sie erklärt in der Praxis, was der Vertrag bedeutet und wer
	// ihn bewacht -- das Muster endet deshalb NICHT am `*/`, sondern springt dorthin. Die erste
	// Fassung verlangte einen Kommentar, der sofort schließt, und fand daraufhin genau null
	// Verträge, während die Marke sichtbar dastand: ein grüner Lauf, der nichts geprüft hat.
	const marke = /\/\*[^*]*?═*\s*VERTRAG:\s*([^\s*]+)/g;
	let treffer;
	while ((treffer = marke.exec(text)) !== null) {
		const kommentarEnde = text.indexOf("*/", marke.lastIndex);
		if (kommentarEnde === -1) {
			throw new Error("VERTRAG-Marke ohne Kommentarende in " + treffer[1]);
		}
		const ab = kommentarEnde + 2;
		marke.lastIndex = ab;
		const ende = text.indexOf("VERTRAG ENDE", ab);
		if (ende === -1) {
			throw new Error("VERTRAG ohne VERTRAG ENDE in " + treffer[1]);
		}
		// Zurück bis zum Beginn des schließenden Kommentars, damit er nicht im CSS landet.
		const bis = text.lastIndexOf("/*", ende);
		bloecke.push({ datei: treffer[1], css: text.slice(ab, bis === -1 ? ende : bis) });
	}
	return bloecke;
}

/**
 * Liest CSS zu `{ selektor: { eigenschaft: wert } }`.
 *
 * 🔴 BEWUSST KLEIN — kein Parser für die ganze Sprache. Er kann flache Regeln und lässt alles
 * andere weg: `@media`, `@supports`, Verschachtelung. Ein Vertrag, der eine Umbruchregel zusagt,
 * gehört nicht hierher, sondern in einen Test, der die Regel wirklich anwendet.
 * 💣 Und er entfernt Kommentare ZUERST: ein `/* border: 1px *\/` in einer Erklärung wäre sonst
 * eine Zusage, die niemand geschrieben hat.
 */
function regelnLesen(css) {
	const ohneKommentare = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
	const regeln = {};
	const muster = /([^{}]+)\{([^{}]*)\}/g;
	let treffer;
	while ((treffer = muster.exec(ohneKommentare)) !== null) {
		const rumpf = treffer[2];
		// Ein `@media`-Kopf bleibt als Selektorrest übrig -- der Rumpf gehört nicht ihm.
		treffer[1].split(",").forEach((roh) => {
			const selektor = normalisiereSelektor(roh);
			if (selektor === "" || selektor.startsWith("@")) {
				return;
			}
			const felder = regeln[selektor] || (regeln[selektor] = {});
			rumpf.split(";").forEach((paar) => {
				const doppelpunkt = paar.indexOf(":");
				if (doppelpunkt === -1) {
					return;
				}
				const name = paar.slice(0, doppelpunkt).trim().toLowerCase();
				const wert = normalisiereWert(paar.slice(doppelpunkt + 1));
				if (name !== "" && wert !== "") {
					felder[name] = wert;
				}
			});
		});
	}
	return regeln;
}

/** Mehrfache Leerzeichen weg, damit `a  >  b` und `a > b` dasselbe sind. */
function normalisiereSelektor(roh) {
	return String(roh || "").replace(/\s+/g, " ").trim();
}

/**
 * ⚠️ Der Wert wird nur in der Schreibweise normalisiert, nie im Inhalt: `1px solid var(--x)`
 * bleibt genau das. `0.5` und `.5` sind DASSELBE, `8px` und `8PX` auch — alles andere ist ein
 * Unterschied und soll auffallen.
 */
function normalisiereWert(roh) {
	return String(roh || "")
		.replace(/\s+/g, " ")
		.replace(/\s*([,()])\s*/g, "$1")
		.replace(/(^|[\s(,])\.(\d)/g, "$10.$2")
		.trim()
		.toLowerCase();
}

/**
 * Hält einen Vertragsblock gegen die Produktionsdatei.
 *
 * @returns {Array<{selektor: string, eigenschaft: string, mockup: string, produktion: string|null}>}
 *   leere Liste = eingehalten
 */
function vertragPruefen(mockupCss, produktionsCss) {
	const soll = regelnLesen(mockupCss);
	const ist = regelnLesen(produktionsCss);
	const abweichungen = [];
	Object.keys(soll).forEach((selektor) => {
		const sollFelder = soll[selektor];
		const istFelder = ist[selektor] || null;
		Object.keys(sollFelder).forEach((eigenschaft) => {
			const istWert = istFelder ? (istFelder[eigenschaft] ?? null) : null;
			if (istWert !== sollFelder[eigenschaft]) {
				abweichungen.push({
					selektor,
					eigenschaft,
					mockup: sollFelder[eigenschaft],
					produktion: istWert,
				});
			}
		});
	});
	return abweichungen;
}

/** Eine Abweichung als Satz, der sagt, was zu tun ist. */
function abweichungText(a) {
	if (a.produktion === null) {
		return "  " + a.selektor + " { " + a.eigenschaft + " } fehlt in der Produktionsdatei"
			+ " (Mockup: " + a.mockup + ")";
	}
	return "  " + a.selektor + " { " + a.eigenschaft + " }: Mockup " + a.mockup
		+ " -- Produktion " + a.produktion;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { vertragsBloecke, regelnLesen, vertragPruefen, abweichungText,
		normalisiereSelektor, normalisiereWert };
}
