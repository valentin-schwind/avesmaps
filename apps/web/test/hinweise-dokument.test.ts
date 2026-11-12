import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { HinweiseDokument, LEGAL_NOTICES, type HinweisBlock } from "@avesmaps3d/shared";
import { hinweisAdresse, hinweisAusSuche, sucheOhneHinweis } from "../src/legal/hinweis-adresse.ts";
import { abschnittJeKennung, alleKennungen, gliedereBloecke, kennungenVon } from "../src/legal/hinweise-dokument.ts";
import { istHinweisZiel, klartext, zerlegeInline, zieleVon } from "../src/legal/hinweise-inline.ts";
import type { ReisebildHinweisZiel } from "../src/legal/hinweise-ziel.ts";

/**
 * Die Hinweise als EIN Dokument (`LEGAL_NOTICES.hinweise`, abgenommenes Mockup vom 2026-11-04): ob das Dokument in sich stimmt und wie sein Text gelesen wird. Den Wortlaut selbst nimmt der Betreiber ab, nicht dieser Test.
 */
const dokument = LEGAL_NOTICES.hinweise;
const bloecke = dokument.abschnitte.flatMap((abschnitt) => abschnitt.bloecke);

/** Jeder Text eines Blocks, der Auszeichnung tragen darf. */
function texteVon(block: HinweisBlock): string[] {
    switch (block.art) {
        case "lead":
        case "absatz":
            return [block.text];
        case "fakten":
            return block.zeilen.flatMap((zeile) => [zeile.begriff, ...zeile.werte.flat()]);
        case "tafel":
            return block.zeilen.flatMap((zeile) => zeile.zellen);
        case "liste":
            return block.punkte;
        case "kasten":
            return block.absaetze;
        case "frage":
            return [block.antwort];
        case "sprungliste":
            return block.ziele.map((ziel) => `[${ziel.text}](${ziel.ziel})`);
        default:
            return [];
    }
}

const texte = bloecke.flatMap(texteVon);

describe("Das Dokument der Hinweise", () => {
    it("ist gültig nach dem Schema und steht in der Reihenfolge des Mockups", () => {
        expect(Value.Check(HinweiseDokument, dokument)).toBe(true);
        expect(dokument.abschnitte.map((abschnitt) => abschnitt.titel)).toEqual([
            "Bedienung",
            "Häufige Fragen",
            "Projekt und Mitmachen",
            "Inhalte und Datenquellen",
            "Karten auf Avesmaps",
            "Urheberrecht, Marken und Bildrechte",
            "Technik und künstliche Intelligenz",
            "Reisebilder",
            "Grenzen der Karte und Haftung",
            "Datenschutz",
            "Kontakt und Impressum",
        ]);
    });

    it("🔴 jede Kennung gibt es genau einmal: Sie ist eine öffentliche Adresse", () => {
        const kennungen = alleKennungen(dokument).map((eintrag) => eintrag.kennung);
        expect(kennungen.filter((kennung, stelle) => kennungen.indexOf(kennung) !== stelle)).toEqual([]);
        expect(kennungen.length).toBeGreaterThan(200);
    });

    it("jeder Verweis im Fenster trifft eine Kennung", () => {
        const bekannt = abschnittJeKennung(dokument);
        const ziele = texte.flatMap((text) => zieleVon(zerlegeInline(text))).filter((ziel) => ziel.startsWith("#"));
        expect(ziele.length).toBeGreaterThan(20);
        expect(ziele.filter((ziel) => !bekannt.has(ziel.slice(1)))).toEqual([]);
    });

    it("🔴 die festen Ziele der Aufrufer stehen im Dokument", () => {
        const bekannt = abschnittJeKennung(dokument);
        // Die Taste „?“, das Formular der Reisebilder (`hinweise-ziel.ts`).
        const reisebilder: ReisebildHinweisZiel[] = ["reisebilder", "datenschutz-bei-reisebildern"];
        for (const ziel of ["bedienung", ...reisebilder]) expect(bekannt.has(ziel), ziel).toBe(true);
        expect(bekannt.get("datenschutz-bei-reisebildern")).toBe("datenschutz");
        expect(bekannt.get("discord")).toBe("bedienung");
    });

    it("🔴 Verweise nur über https, http, mailto und #: Alles andere kommt nie in ein href", () => {
        const roh = [...JSON.stringify(dokument).matchAll(/\]\(([^)]*)\)/gu)].map((treffer) => treffer[1] as string);
        expect(roh.length).toBeGreaterThan(50);
        expect(roh.filter((ziel) => !istHinweisZiel(ziel))).toEqual([]);
    });

    it("🔴 die Mailadresse steht nicht ausgeschrieben im Bündel: Der Text trägt {mail}", () => {
        const roh = JSON.stringify(dokument);
        expect(roh).not.toContain(`${LEGAL_NOTICES.imprint.mailUser}@`);
        expect(roh).toContain("[{mail}](mailto:{mail})");
    });

    it("🔴 keine Tafel und keine Faktenzeilen direkt unter einer Überschrift", () => {
        const funde = dokument.abschnitte.flatMap((abschnitt) =>
            abschnitt.bloecke.flatMap((block, stelle) => {
                const davor = abschnitt.bloecke[stelle - 1];
                const unterUeberschrift = davor?.art === "h3" || davor?.art === "h4";
                return unterUeberschrift && (block.art === "tafel" || block.art === "fakten")
                    ? [`${abschnitt.id}: ${davor.id}`]
                    : [];
            }),
        );
        expect(funde).toEqual([]);
    });

    it("die Bilder kommen vom eigenen Server", () => {
        const bilder = bloecke.filter((block) => block.art === "bild");
        expect(bilder.length).toBeGreaterThan(0);
        for (const bild of bilder) expect(bild.src.startsWith("/img/"), bild.src).toBe(true);
    });

    it("die Tafeln halten ihre Spalten", () => {
        for (const block of bloecke) {
            if (block.art !== "tafel") continue;
            expect(block.schluesselSpalten).toBeLessThanOrEqual(block.kopf.length);
            for (const zeile of block.zeilen) expect(zeile.zellen, zeile.id).toHaveLength(block.kopf.length);
        }
    });

    it("was unter einer Unterüberschrift steht, gehört zu ihr, bis zur nächsten Überschrift", () => {
        const absatz = (text: string): HinweisBlock => ({ art: "absatz", text });
        const glieder = gliedereBloecke([
            absatz("vorn"),
            { art: "h3", id: "a", text: "A" },
            absatz("unter a"),
            { art: "h4", id: "b", text: "B" },
            absatz("unter b"),
            { art: "h4", id: "c", text: "C" },
            { art: "h3", id: "d", text: "D" },
            absatz("unter d"),
        ]);
        expect(
            glieder.map((glied) =>
                glied.art === "gruppe" ? `${glied.kopf.id}:${String(glied.rumpf.length)}` : glied.block.art,
            ),
        ).toEqual(["absatz", "h3", "absatz", "b:1", "c:0", "h3", "absatz"]);
        expect(kennungenVon({ art: "frage", id: "f", frage: "F?", antwort: "A." })).toEqual(["f"]);
    });
});

describe("Die Auszeichnung im Text", () => {
    it("Link und Schattierung, auch ineinander", () => {
        expect(zerlegeInline("vor [Text](https://example.org/a) nach")).toEqual([
            { art: "text", text: "vor " },
            { art: "link", ziel: "https://example.org/a", kinder: [{ art: "text", text: "Text" }] },
            { art: "text", text: " nach" },
        ]);
        expect(zerlegeInline("**rund 14 Tage** danach")).toEqual([
            { art: "hell", kinder: [{ art: "text", text: "rund 14 Tage" }] },
            { art: "text", text: " danach" },
        ]);
        expect(zerlegeInline("[**fett**](#a)")).toEqual([
            { art: "link", ziel: "#a", kinder: [{ art: "hell", kinder: [{ art: "text", text: "fett" }] }] },
        ]);
        expect(zerlegeInline("**a [b](#c) d**")).toEqual([
            {
                art: "hell",
                kinder: [
                    { art: "text", text: "a " },
                    { art: "link", ziel: "#c", kinder: [{ art: "text", text: "b" }] },
                    { art: "text", text: " d" },
                ],
            },
        ]);
    });

    it("🪤 ein einzelner Stern bleibt Text, auch in einer Adresse", () => {
        const text = "Der [A*-Algorithmus](https://de.wikipedia.org/wiki/A*-Algorithmus) sucht **schnell**.";
        expect(klartext(text)).toBe("Der A*-Algorithmus sucht schnell.");
        expect(zieleVon(zerlegeInline(text))).toEqual(["https://de.wikipedia.org/wiki/A*-Algorithmus"]);
        expect(klartext("2 * 3 und **offen")).toBe("2 * 3 und **offen");
    });

    it("🔴 ein Ziel mit fremdem Schema wird kein Verweis, sein Text bleibt", () => {
        for (const ziel of ["javascript:alert(1)", "data:text/html,x", "/lokal", "#Gross", "#a b"]) {
            const knoten = zerlegeInline(`[Text](${ziel})`);
            expect(zieleVon(knoten), ziel).toEqual([]);
        }
        expect(klartext("[Text](javascript:alert(1))")).toBe("Text");
    });

    it("eine Klammer in der Adresse gehört zur Adresse", () => {
        expect(zieleVon(zerlegeInline("[Ort](https://example.org/Ort_(Berg)) und"))).toEqual([
            "https://example.org/Ort_(Berg)",
        ]);
    });

    it("🔴 im ganzen Dokument bleibt keine Rohauszeichnung stehen", () => {
        const funde = texte.map(klartext).filter((text) => /\*\*|\]\(|\]$|\[[^\]]*\]/u.test(text));
        expect(funde).toEqual([]);
    });
});

describe("Die Adresse einer Stelle", () => {
    it("gehört in die Suche, nicht in den Hash, und führt immer auf die Karte", () => {
        expect(hinweisAdresse("https://avesmaps.de", "server-logdaten")).toBe(
            "https://avesmaps.de/?hinweis=server-logdaten",
        );
        expect(hinweisAusSuche("?hinweis=server-logdaten&lang=de")).toBe("server-logdaten");
    });

    it("fehlt oder ist leer: kein Ziel", () => {
        expect(hinweisAusSuche("")).toBeNull();
        expect(hinweisAusSuche("?hinweis=")).toBeNull();
        expect(hinweisAusSuche("?lang=de")).toBeNull();
    });

    it("beim Vergessen bleiben die anderen Parameter", () => {
        expect(sucheOhneHinweis("?hinweis=a&lang=de")).toBe("?lang=de");
        expect(sucheOhneHinweis("?hinweis=a")).toBe("");
    });
});
