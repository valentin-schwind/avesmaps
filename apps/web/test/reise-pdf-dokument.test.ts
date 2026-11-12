import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { karteneinstellungVorgaben } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { nl } from "../src/i18n/nl.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { es } from "../src/i18n/es.ts";
import { pl } from "../src/i18n/pl.ts";
import { da } from "../src/i18n/da.ts";
import { sv } from "../src/i18n/sv.ts";
import { kartenFeld, reiseDokument, satzspiegel } from "../src/reise-pdf/dokument.ts";
import { vorgaben, wirksamerInhalt, type ReisePdfEinstellungen } from "../src/reise-pdf/einstellungen.ts";
import type { Inhalt, Knoten } from "../src/reise-pdf/pdf-knoten.ts";
import { pdfWorte, reiseDaten, verfuegbar } from "../src/reise-pdf/reise-daten.ts";
import { abdeckung, ERSATZ, saeuberer } from "../src/reise-pdf/zeichen.ts";
import { landschaften, optionen, reise, vorkommen } from "./reise-pdf-fixture.ts";

/**
 * Das PDF von „Reise als PDF“ (WI-0306) als Beschreibung für pdfmake: Seiten, Fuß mit der Nennung, Deckblatt, Reisetagebuch auf neuer Seite,
 * die Hausschrift und ihr Säuberer. Ob pdfmake daraus ein PDF macht, zeigt die Browserprobe; hier steht, was hineingeht.
 */

const ttf = readFileSync(resolve(import.meta.dirname, "../../../assets/fonts/FacultyGlyphic-Regular.ttf"));
const kann = abdeckung(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));

function dokument(
    aenderung: Partial<ReisePdfEinstellungen> = {},
    bilder: Record<string, string> = {},
    saeubern = (s: string) => s,
) {
    const daten = reiseDaten({
        route: reise(),
        options: optionen(),
        pointNames: new Map(),
        landscapes: landschaften(),
        unterwegs: vorkommen(),
    });
    const einstellungen = {
        ...vorgaben(karteneinstellungVorgaben(), daten.titel, "de", daten.datei, "serie:modern"),
        ...aenderung,
    };
    return reiseDokument({
        daten,
        worte: pdfWorte(),
        einstellungen,
        inhalt: wirksamerInhalt(
            { ...einstellungen.inhalt, gebiete: true, unterwegs: true, tagebuch: true },
            verfuegbar(daten),
        ),
        link: "https://avesmaps.de/?route=Gareth~Elenvina~Havena",
        nennung: "Kartenmaterial © Ulisses Spiele · https://ulisses-spiele.de/fan-richtlinie/",
        kartenNennung: "Kartenmaterial © Ulisses Spiele",
        bilder,
        saeubern,
        schrift: "FacultyGlyphic",
        sprache: "de",
    });
}

/** Alle Knoten eines Inhalts, tief. */
function knoten(inhalt: Inhalt | Inhalt[] | null | undefined): Knoten[] {
    if (inhalt === null || inhalt === undefined || typeof inhalt === "string") return [];
    if (Array.isArray(inhalt)) return inhalt.flatMap(knoten);
    const kinder: Inhalt[] = [
        ...(inhalt.stack ?? []),
        ...(inhalt.columns ?? []),
        ...(inhalt.table?.body.flat() ?? []),
        ...(inhalt.ol ?? []),
        ...(Array.isArray(inhalt.text) ? inhalt.text : []),
    ];
    return [inhalt, ...kinder.flatMap(knoten)];
}
const texte = (alle: Knoten[]): string[] =>
    alle.flatMap((k) =>
        typeof k.text === "string"
            ? [k.text]
            : Array.isArray(k.text)
              ? k.text.filter((t): t is string => typeof t === "string")
              : [],
    );

describe("Die Seiten", () => {
    it("A4 hoch in Punkten, quer getauscht, A5 enger und kleiner", () => {
        expect(dokument().pageSize).toEqual({ width: 595.28, height: 841.89 });
        expect(dokument({ lage: "quer" }).pageSize).toEqual({ width: 841.89, height: 595.28 });
        expect(dokument({ format: "letter" }).pageSize).toEqual({ width: 612, height: 792 });
        expect(satzspiegel("a5")).toEqual({ rand: 24, f: 0.82 });
    });

    it("🔴 der Fuß jeder Seite trägt die Nennung, das Logo und „Seite n von m“", () => {
        const fuss = dokument({}, { logo: "data:image/png;base64,AA" }).footer?.(3, 7, { width: 595, height: 842 });
        const alle = knoten(fuss);
        expect(texte(alle)).toContain("Kartenmaterial © Ulisses Spiele · https://ulisses-spiele.de/fan-richtlinie/");
        expect(texte(alle)).toContain("Seite 3 von 7");
        expect(alle.some((k) => k.image === "logo")).toBe(true);
    });

    it("Pergament druckt einen Grund in der Farbe des Kartenpapiers, Weiß keinen", () => {
        expect(dokument().background).toBeTypeOf("function");
        expect(dokument({ papier: "weiss" }).background).toBeUndefined();
    });

    it("die Hausschrift, nie fett", () => {
        const doc = dokument();
        expect(doc.defaultStyle.font).toBe("FacultyGlyphic");
        expect(JSON.stringify(doc.content)).not.toContain('"bold"');
    });
});

describe("Das Deckblatt", () => {
    it("Titel, QR-Code mit dem Planer-Link und ohne Bild die Stationen", () => {
        const alle = knoten(dokument().content);
        expect(texte(alle)).toContain("Die Reise von Gareth über Elenvina nach Havena");
        expect(alle.find((k) => k.qr !== undefined)?.qr).toBe("https://avesmaps.de/?route=Gareth~Elenvina~Havena");
        expect(alle.some((k) => k.image === "karte")).toBe(false);
    });

    it("mit Kartenbild deckt es sein Feld, und ohne QR-Code fehlt der Code", () => {
        const alle = knoten(
            dokument(
                { inhalt: { ...vorgaben(karteneinstellungVorgaben(), "", "de", "", "politisch").inhalt, qr: false } },
                { karte: "data:image/jpeg;base64,AA" },
            ).content,
        );
        const bild = alle.find((k) => k.image === "karte");
        expect(bild?.cover?.width).toBeGreaterThan(400);
        expect(alle.some((k) => k.qr !== undefined)).toBe(false);
    });

    it("das Feld des Kartenbilds passt das Deckblatt auf eine Seite: hoch höchstens 1,15 : 1, quer breiter", () => {
        const hoch = kartenFeld("a4", "hoch");
        const quer = kartenFeld("a4", "quer");
        expect(hoch.breite / hoch.hoehe).toBeGreaterThanOrEqual(1.15);
        expect(quer.breite / quer.hoehe).toBeGreaterThan(hoch.breite / hoch.hoehe);
        expect(kartenFeld("a4", "hoch", 2, true).hoehe).toBeLessThan(hoch.hoehe);
    });
});

describe("Die Inhaltsseiten", () => {
    it("der Verlauf beginnt auf neuer Seite, das Reisetagebuch auch", () => {
        const doc = dokument();
        const umbrueche = doc.content.filter((k): k is Knoten => typeof k !== "string" && k.pageBreak === "before");
        expect(umbrueche).toHaveLength(2);
        expect(texte(knoten(umbrueche[1]))).toContain("Reisetagebuch");
    });

    it("„Jede Etappe“ setzt eine Tafel mit Wiederholkopf und den „Dazu“-Zeilen", () => {
        const alle = knoten(dokument({ etappenArt: "lang" }).content);
        const tafeln = alle.filter((k) => k.table?.headerRows === 2);
        expect(tafeln.length).toBe(2);
        expect(texte(alle)).toContain("Gareth – Weyring");
        expect(texte(alle)).toContain("Herz des Kontinents");
    });

    it("die Zusätze folgen der Wahl: ohne „Derographie“ keine Gegend", () => {
        const ohne = knoten(
            dokument({
                etappenArt: "kurz",
                zusaetze: { gegend: false, gebiet: true, sprache: false, gelaende: true, neu: true },
            }).content,
        );
        expect(texte(ohne).join("|")).not.toContain("Goldene Au");
        expect(texte(knoten(dokument({ etappenArt: "kurz" }).content)).join("|")).toContain(
            "Herz des Kontinents, Goldene Au",
        );
        // „Jede Etappe“ (die Vorgabe seit Vali 2026-11-10) nennt die Gegend an ihrer Etappe.
        expect(texte(knoten(dokument().content)).join("|")).toContain("Goldene Au");
    });

    it("das Wetter zum Ankreuzen nur mit dem Schalter", () => {
        expect(texte(knoten(dokument().content))).toContain("Regen/Schnee");
        expect(texte(knoten(dokument({ wetter: false }).content))).not.toContain("Regen/Schnee");
    });

    it("🔴 jeder Text geht durch den Säuberer der Schrift", () => {
        const alle = knoten(dokument({}, {}, (s) => s.toLocaleUpperCase("de")).content);
        const klein = texte(alle).filter((s) => /\p{Ll}/u.test(s));
        expect(klein).toEqual([]);
    });
});

describe("Die Hausschrift und ihr Säuberer", () => {
    const sauber = saeuberer(kann);

    it("liest ihre Zeichen aus der Schrift: Umlaute, Polnisch, „·“ und „–“ ja, Pfeile und ● nein", () => {
        for (const z of "äöüßÄÖÜąęłńśźżćó·–—„“”‘’•…−×") expect(kann(z.codePointAt(0)!), z).toBe(true);
        for (const z of "→↑↓● ") expect(kann(z.codePointAt(0)!), z).toBe(false);
    });

    it("ersetzt sauber: Pfeil, schmaler Zwischenraum, Variante, sonst ohne Akzent, sonst „?“", () => {
        expect(sauber("Gareth → Havena")).toBe("Gareth – Havena");
        expect(sauber("1 234,5")).toBe("1 234,5");
        expect(sauber("↑︎")).toBe("+");
        expect(sauber("ǹ")).toBe("n");
        expect(sauber("Ж")).toBe("?");
        expect(sauber("a\u0007b\nc")).toBe("ab\nc");
    });

    it("🔴 jeder Ersatz steht selbst in der Schrift", () => {
        for (const ersatz of Object.values(ERSATZ))
            for (const z of ersatz) expect(kann(z.codePointAt(0)!), z).toBe(true);
    });

    it.each([
        ["de", de],
        ["en", en],
        ["fr", fr],
        ["nl", nl],
        ["it", itTafel],
        ["es", es],
        ["pl", pl],
        ["da", da],
        ["sv", sv],
    ] as const)("🔴 %s: jeder Text von „Reise als PDF“ steht ohne Ersatzzeichen in der Schrift", (_name, tafel) => {
        const fehlt = Object.entries(tafel)
            .filter(([schluessel]) => schluessel.startsWith("reisePdf."))
            .filter(([, text]) => sauber(text) !== text);
        expect(fehlt).toEqual([]);
    });
});
