import { describe, expect, it } from "vitest";
import { anzeigeAbschnitte, resolvePathChain, resolvePathGroup } from "../src/subjects/path-group.ts";
import { buildPathIndex, type PathIndexRow } from "../src/subjects/subject-index.ts";

/**
 * Welche Abschnitte beim „Anzeigen“ eines Wegs leuchten (OPS-000109): Seit WI-0302 nennt der Server sie (`SubjectDetail.abschnitte`), und die Karte filtert nicht
 * mehr nach dem Namen. Ein Fluss, dessen Artikel nur an einem Teil der Abschnitte hängt, zerfällt in den Wiki-Weg und eine Namensgruppe der übrigen; leuchten
 * soll trotzdem die ganze Kette seines Namens.
 *
 * Die kleine Welt: zehn Abschnitte „Dergel“ (Flussweg), acht mit dem Artikel, der Oberlauf und die Mündung ohne. Dazu ein anderer Fluss gleichen Namens mit eigenem
 * Artikel, eine Straße, die den Artikel als weiteren Straßennamen trägt, ein Seeweg gleichen Namens und ein Griff ohne echten Namen.
 */

const D = (n: number): string => `0e100109-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function abschnitt(
    publicId: string,
    name: string,
    subtype: string,
    mainKey: string | null,
    further: string[] = [],
): PathIndexRow {
    return {
        public_id: publicId,
        name,
        subtype,
        main_key: mainKey,
        main_url: mainKey === null ? null : `https://de.wiki-aventurica.de/wiki/${mainKey}`,
        main_name: mainKey === null ? null : `Artikel ${mainKey}`,
        further: further.map((key) => ({
            key,
            name: `Artikel ${key}`,
            url: `https://de.wiki-aventurica.de/wiki/${key}`,
        })),
    };
}

/** Der Dergel: Oberlauf (1) und Mündung (10) ohne Artikel, dazwischen acht mit. */
const DERGEL = Array.from({ length: 10 }, (_, i) => D(i + 1));
const OHNE_ARTIKEL = [D(1), D(10)];
const FREMDER_DERGEL = D(0x20);
const GETEILT = D(0x30);
const ANDERE_STRASSE = D(0x31);
const SEEWEG = D(0x40);
const GRIFF = D(0x50);

function welt(extra: PathIndexRow[] = []): ReturnType<typeof buildPathIndex> {
    const rows = [
        ...DERGEL.map((id) => abschnitt(id, "Dergel", "Flussweg", OHNE_ARTIKEL.includes(id) ? null : "dergel")),
        abschnitt(GETEILT, "Brückenweg", "Strasse", "brueckenweg", ["dergel"]),
        abschnitt(ANDERE_STRASSE, "Brückenweg", "Strasse", null),
        abschnitt(SEEWEG, "Dergel", "Seeweg", null),
        abschnitt(GRIFF, "Flussweg", "Flussweg", null),
        ...extra,
    ];
    return buildPathIndex([...rows].sort((a, b) => a.public_id.localeCompare(b.public_id)));
}

describe("Anzeigen leuchtet die ganze Kette eines Wegs (OPS-000109)", () => {
    it("Suche nach dem Dergel: der Wiki-Weg, und alle zehn Abschnitte seines Namens leuchten, dazu der geteilte", () => {
        const index = welt();
        const gruppe = resolvePathChain(index, "name:Dergel");
        expect(gruppe?.id).toBe("wiki:dergel");
        // Die Gruppe selbst bleibt, wie WI-0063 sie rechnet: die acht mit Artikel und der geteilte Abschnitt.
        expect(gruppe?.members).toHaveLength(9);
        expect(anzeigeAbschnitte(index, gruppe!)).toEqual([...DERGEL, GETEILT].sort());
    });

    it("Klick auf den Oberlauf ohne Artikel: die Namensgruppe, und der ganze Dergel leuchtet", () => {
        const index = welt();
        const gruppe = resolvePathGroup(index, D(1));
        expect(gruppe?.id).toBe("name:dergel");
        expect(anzeigeAbschnitte(index, gruppe!)).toEqual([...DERGEL]);
    });

    it("ein anderer Fluss gleichen Namens mit eigenem Artikel bleibt dunkel; dann gehören die Abschnitte ohne Artikel keinem Artikel allein", () => {
        const index = welt([abschnitt(FREMDER_DERGEL, "Dergel", "Flussweg", "dergel-fluss-im-norden")]);
        const wiki = resolvePathChain(index, "name:Dergel");
        expect(wiki?.id).toBe("wiki:dergel");
        expect(anzeigeAbschnitte(index, wiki!)).not.toContain(FREMDER_DERGEL);
        expect(anzeigeAbschnitte(index, wiki!)).toEqual([...DERGEL, GETEILT].sort());
        const namen = resolvePathGroup(index, D(1));
        expect(anzeigeAbschnitte(index, namen!)).toEqual(OHNE_ARTIKEL);
    });

    it("die Straße des geteilten Abschnitts nimmt den Dergel nicht mit, und ihre Kette nicht in den Dergel", () => {
        const index = welt();
        const strasse = resolvePathGroup(index, GETEILT);
        expect(strasse?.id).toBe("wiki:brueckenweg");
        expect(anzeigeAbschnitte(index, strasse!)).toEqual([GETEILT, ANDERE_STRASSE].sort());
        expect(anzeigeAbschnitte(index, resolvePathChain(index, "name:Dergel")!)).not.toContain(ANDERE_STRASSE);
    });

    it("ein Seeweg gleichen Namens bleibt für sich, ein Griff ohne echten Namen ist keine Kette", () => {
        const index = welt();
        expect(anzeigeAbschnitte(index, resolvePathChain(index, "name:Dergel")!)).not.toContain(SEEWEG);
        expect(anzeigeAbschnitte(index, resolvePathGroup(index, SEEWEG)!)).toEqual([SEEWEG]);
        expect(anzeigeAbschnitte(index, resolvePathGroup(index, GRIFF)!)).toEqual([GRIFF]);
    });
});
