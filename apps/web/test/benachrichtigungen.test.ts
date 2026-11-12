import { describe, expect, it } from "vitest";
import type { Benachrichtigung } from "@avesmaps3d/shared";
import {
    absender,
    createBenachrichtigungen,
    kreisVon,
    neuUndArchiv,
    satzTeile,
    schnittAusGelesen,
    standSatz,
    wartetAufAntwort,
} from "../src/auth/benachrichtigungen.ts";

/** Die Glocke (WI-0136 N2/N3): Kreis, Satz, Stand und der Abruf mit ETag. */
const basis: Benachrichtigung = {
    id: 12,
    art: "kanal_fix_live",
    von: { art: "claudio", id: null, name: null },
    ops: "OPS-000127",
    text: "See-321 wird sichtbar",
    frageGeloest: true,
    erstelltAt: "2026-10-11T09:00:00.000Z",
    gelesenAt: null,
    beantwortetAt: null,
    antwort: null,
    vorgang: { status: "zur_abnahme", abgenommenVon: null, abgenommenAt: null },
};
const mit = (patch: Partial<Benachrichtigung>): Benachrichtigung => ({ ...basis, ...patch });
const zeit = (iso: string) => `um ${iso.slice(11, 16)}`;

describe("Glocke: Kreis, Satz und Stand", () => {
    it("🔴 ○ ungelesen, ◐ gelesen und wartet auf die eigene Antwort, ● erledigt", () => {
        expect(kreisVon(basis)).toBe("leer");
        expect(kreisVon(mit({ gelesenAt: "2026-10-11T09:05:00.000Z" }))).toBe("halb");
        expect(kreisVon(mit({ gelesenAt: "x", antwort: "geloest", beantwortetAt: "x" }))).toBe("voll");
        // Hat jemand im Kanal abgenommen, wartet nichts mehr auf die Antwort.
        const abgenommen = mit({
            gelesenAt: "x",
            vorgang: { status: "abgenommen", abgenommenVon: "Thomas", abgenommenAt: "x" },
        });
        expect(wartetAufAntwort(abgenommen)).toBe(false);
        expect(kreisVon(abgenommen)).toBe("voll");
        // Die Info an die übrigen Betreiber fragt nichts.
        expect(kreisVon(mit({ gelesenAt: "x", frageGeloest: false }))).toBe("voll");
    });

    it("🔴 der Satz trägt die OPS-Nummer als eigenen Teil (Link) und den Kurztitel, nie mehr", () => {
        expect(satzTeile(basis)).toEqual({
            vor: "Fix für ",
            ops: "OPS-000127",
            nach: " „See-321 wird sichtbar“ ist live. Neu laden und prüfen.",
        });
        expect(satzTeile(mit({ text: null }))).toEqual({
            vor: "Fix für ",
            ops: "OPS-000127",
            nach: " ist live. Neu laden und prüfen.",
        });
        expect(satzTeile(mit({ art: "kanal_rueckfrage", text: null }))).toEqual({
            vor: "Claudio hat eine Rückfrage zu ",
            ops: "OPS-000127",
            nach: ".",
        });
        const person = mit({
            art: "kanal_wiederherstellung",
            von: { art: "person", id: "p", name: "Thomas" },
            text: null,
        });
        expect(satzTeile(person).vor).toBe("Thomas hat eine Wiederherstellung beantragt: ");
        expect(absender(mit({ von: { art: "person", id: "p", name: null } }))).toBe("Ehemalige Person");
    });

    it("der Stand nach einer Antwort oder einer Abnahme im Kanal ersetzt die Knöpfe", () => {
        expect(standSatz(basis, zeit)).toBeNull();
        expect(standSatz(mit({ antwort: "geloest", beantwortetAt: "x" }), zeit)).toBe("Als gelöst bestätigt.");
        expect(
            standSatz(
                mit({
                    vorgang: {
                        status: "abgenommen",
                        abgenommenVon: "Thomas",
                        abgenommenAt: "2026-10-11T10:15:00.000Z",
                    },
                }),
                zeit,
            ),
        ).toBe("Akzeptiert von Thomas, um 10:15.");
        expect(
            standSatz(mit({ vorgang: { status: "in_arbeit", abgenommenVon: null, abgenommenAt: null } }), zeit),
        ).toBe("Wieder in Arbeit.");
        expect(standSatz(mit({ art: "kanal_rueckfrage" }), zeit)).toBeNull();
    });
});

describe("Glocke: Abruf", () => {
    it("🔴 schickt den ETag mit; 304 behält die Liste; ein Fehler setzt nur den Fehler", async () => {
        const anfragen: (string | undefined)[] = [];
        let antwort: Response = new Response(JSON.stringify({ ungelesen: 1, eintraege: [basis] }), {
            status: 200,
            headers: { etag: '"b1"' },
        });
        const fetcher = (async (_url: string, init?: RequestInit) => {
            anfragen.push((init?.headers as Record<string, string> | undefined)?.["if-none-match"]);
            return antwort;
        }) as typeof fetch;
        const glocke = createBenachrichtigungen({ fetcher, sichtbar: () => true });
        await glocke.lies();
        expect(glocke.ungelesen.value).toBe(1);
        antwort = new Response(null, { status: 304 });
        await glocke.lies();
        expect(anfragen).toEqual([undefined, '"b1"']);
        expect(glocke.liste.value?.eintraege).toHaveLength(1);
        antwort = new Response("{}", { status: 503 });
        await glocke.lies();
        expect(glocke.fehler.value).toBe(true);
        expect(glocke.liste.value?.eintraege).toHaveLength(1);
    });
});

/**
 * „Neu“ und „Archiv“ (Betreiber 2026-10-13: „benachrichtungen sollen für nutzer nicht verschwinden, wenn sie was gelesen haben, soll es
 * ausgegraut oder in archiv“).
 *
 * 🔴 Eine Regel ohne Zahlen: Was beim Öffnen ungelesen war, steht unter „Neu“ — bis zum nächsten Öffnen. Kein Stichtag, keine Menge.
 */
describe("Glocke: Neu und Archiv", () => {
    const zeilen = [4, 3, 2, 1].map((id) =>
        mit({ id, gelesenAt: id <= 2 ? "2026-10-11T09:05:00.000Z" : null, frageGeloest: false }),
    );

    it("trennt am gemerkten Schnitt: was danach kam, ist neu", () => {
        const { neu, archiv } = neuUndArchiv(zeilen, 2);
        expect(neu.map((e) => e.id)).toEqual([4, 3]);
        expect(archiv.map((e) => e.id)).toEqual([2, 1]);
    });

    it("🔴 ohne gemerkten Schnitt entscheidet der Server: ungelesen ist neu", () => {
        const { neu, archiv } = neuUndArchiv(zeilen, null);
        expect(neu.map((e) => e.id)).toEqual([4, 3]);
        expect(archiv.map((e) => e.id)).toEqual([2, 1]);
    });

    it("🔴 ein Eintrag, den man gerade gelesen hat, bleibt bis zum nächsten Öffnen unter „Neu“", () => {
        // Der Schnitt steht auf 2; dass 3 und 4 beim Öffnen als gelesen markiert wurden, verschiebt sie nicht.
        const nachDemOeffnen = zeilen.map((e) => ({ ...e, gelesenAt: "2026-10-13T12:00:00.000Z" }));
        expect(neuUndArchiv(nachDemOeffnen, 2).neu.map((e) => e.id)).toEqual([4, 3]);
    });

    it("beim nächsten Öffnen ist alles im Archiv, und nichts geht verloren", () => {
        const { neu, archiv } = neuUndArchiv(zeilen, 4);
        expect(neu).toEqual([]);
        expect(archiv).toHaveLength(zeilen.length);
    });

    it("leere Liste bleibt leer", () => {
        expect(neuUndArchiv([], 7)).toEqual({ neu: [], archiv: [] });
    });

    it("🔴 erstes Öffnen ohne gemerkten Schnitt: der eingefrorene Schnitt hält die ungelesenen unter „Neu“, auch nachdem sie gelesen sind", () => {
        // Vorher fiel die Glocke ohne Schnitt auf „gelesen“ zurück; das Öffnen markiert alles als gelesen, und alles stand im Archiv.
        const schnitt = schnittAusGelesen(zeilen);
        expect(schnitt).toBe(2);
        const nachDemOeffnen = zeilen.map((e) => ({ ...e, gelesenAt: "2026-10-19T12:00:00.000Z" }));
        expect(neuUndArchiv(nachDemOeffnen, schnitt).neu.map((e) => e.id)).toEqual([4, 3]);
        expect(schnittAusGelesen(zeilen.map((e) => ({ ...e, gelesenAt: null })))).toBe(0);
    });
});
