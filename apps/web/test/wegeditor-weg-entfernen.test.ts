import { describe, expect, it, vi } from "vitest";
import {
    PATH_SAMMEL_MAX,
    type EditorPathDetail,
    type PathRemovalBody,
    type PathSammelRemovalBody,
    type PathStreetRemovalBody,
} from "@avesmaps3d/shared";
import { createWegEntfernen, zuViele, type EntfernenAntwort } from "../src/wegeditor/weg-entfernen";

/**
 * „Weg entfernen …“ (WI-0177 Stufe 3): die Steuerung des Blatts. Problemfälle: „Los“ ohne Wahl oder gegen eine alte Revision; die Wahl
 * „Von der Karte nehmen“ löscht (oder umgekehrt); eine Ablehnung schließt das Blatt und verschluckt den Satz; „Zurück auf die Karte“
 * gegen eine andere Revision als die des Abschnitts. Mehrfachauswahl (WI-0252): „Ganz löschen“ trifft nur einen Weg statt aller
 * gewählten, schickt mehrere Operationen, nimmt alte Revisionen aus dem Anhaken, oder das Blatt nennt nicht die Zahl der Wege.
 */

const WEG = "5a5a5a5a-0000-4000-8000-0000000000e1";
const detail = { publicId: WEG, revision: 7, name: "Weg-12", subtype: "Weg", active: true } as EditorPathDetail;

function aufbau(antwort: EntfernenAntwort) {
    const gesendet: { wie: string; body: PathRemovalBody | PathStreetRemovalBody | PathSammelRemovalBody }[] = [];
    const schreibt = (wie: string) =>
        vi.fn(async (_id: string, body: PathRemovalBody | PathStreetRemovalBody) => {
            gesendet.push({ wie, body });
            return antwort;
        });
    const schreibtAuswahl = (wie: string) =>
        vi.fn(async (body: PathSammelRemovalBody) => {
            gesendet.push({ wie, body });
            return antwort;
        });
    const daten = {
        loescheAuswahl: schreibtAuswahl("auswahl-loeschen"),
        nimmAuswahlAb: schreibtAuswahl("auswahl-abnehmen"),
        weg: vi.fn(async () => detail),
        loesche: schreibt("loeschen"),
        nimmAb: schreibt("abnehmen"),
        legeZurueck: schreibt("zurueck"),
        loescheStrasse: schreibt("strasse-loeschen"),
        nimmStrasseAb: schreibt("strasse-abnehmen"),
    };
    return { blatt: createWegEntfernen(daten, () => "op-1"), daten, gesendet };
}

const ok: EntfernenAntwort = {
    ok: true,
    quittung: {
        operationId: "op-1",
        status: "applied",
        environment: "test",
        affected: [{ kind: "path", id: WEG, revision: 8 }],
        derivedWork: [],
        warnings: [],
        mapRevision: 12,
    },
};

describe("Weg entfernen (WI-0177 Stufe 3)", () => {
    it("🔴 „Los“ erst nach der Wahl, gegen die gelesene Revision; jede Wahl schreibt ihre EINE Operation, danach ist das Blatt zu", async () => {
        const t = aufbau(ok);
        await t.blatt.bitte(WEG);
        expect(t.blatt.stand.value).toMatchObject({ phase: "bereit", wahl: undefined });
        expect(await t.blatt.los()).toBeUndefined();
        t.blatt.waehle("abnehmen");
        const ab = await t.blatt.los();
        expect(ab).toMatchObject({ wahl: "abnehmen", quittung: { mapRevision: 12 } });
        expect(t.blatt.stand.value).toBeUndefined();
        await t.blatt.bitte(WEG);
        t.blatt.waehle("loeschen");
        expect((await t.blatt.los())?.wahl).toBe("loeschen");
        expect(t.gesendet).toEqual([
            { wie: "abnehmen", body: { operationId: "op-1", baseRevision: 7 } },
            { wie: "loeschen", body: { operationId: "op-1", baseRevision: 7 } },
        ]);
    });

    it("„Zurück auf die Karte“ schreibt gegen die Revision des Abschnitts, ohne das Blatt", async () => {
        const t = aufbau(ok);
        expect((await t.blatt.zurueck(WEG, 9)).ok).toBe(true);
        expect(t.gesendet).toEqual([{ wie: "zurueck", body: { operationId: "op-1", baseRevision: 9 } }]);
        expect(t.blatt.stand.value).toBeUndefined();
    });

    it("eine Ablehnung lässt das Blatt offen und nennt den Satz des Servers", async () => {
        const t = aufbau({
            ok: false,
            status: 409,
            fehler: { code: "object_locked", message: "Thorn bearbeitet das gerade." },
        });
        await t.blatt.bitte(WEG);
        t.blatt.waehle("loeschen");
        expect(await t.blatt.los()).toBeUndefined();
        expect(t.blatt.stand.value).toMatchObject({ phase: "bereit", satz: "Thorn bearbeitet das gerade." });
    });

    it("🔴 Mehrfachauswahl (WI-0252): das Blatt liest die Abschnitte ALLER gewählten Wege frisch, nennt ihre Zahl, und „Los“ schreibt EINE Operation über alle", async () => {
        const t = aufbau(ok);
        const zweiter = "5a5a5a5a-0000-4000-8000-0000000000e2";
        const dritter = "5a5a5a5a-0000-4000-8000-0000000000e3";
        const lies = vi.fn(async () => ({
            wege: 2,
            abschnitte: [
                { publicId: WEG, revision: 7 },
                { publicId: zweiter, revision: 3 },
                { publicId: dritter, revision: 5 },
            ],
        }));
        const offen = t.blatt.bitteAuswahl(lies);
        // Beim Lesen steht das Blatt auf „Lädt …“, ohne Abschnitt; Los geht noch nicht.
        expect(t.blatt.stand.value).toMatchObject({ phase: "laedt", publicId: "" });
        t.blatt.waehle("loeschen");
        expect(t.blatt.stand.value?.wahl).toBeUndefined();
        await offen;
        expect(lies).toHaveBeenCalledOnce();
        expect(t.daten.weg).not.toHaveBeenCalled();
        expect(t.blatt.stand.value).toMatchObject({ phase: "bereit", publicId: WEG, auswahl: { wege: 2 } });
        t.blatt.waehle("loeschen");
        const geloescht = await t.blatt.los();
        expect(geloescht).toMatchObject({ wahl: "loeschen", wege: 2, quittung: { mapRevision: 12 } });
        expect(t.blatt.stand.value).toBeUndefined();
        expect(t.gesendet).toEqual([
            {
                wie: "auswahl-loeschen",
                body: {
                    operationId: "op-1",
                    sections: [
                        { publicId: WEG, baseRevision: 7 },
                        { publicId: zweiter, baseRevision: 3 },
                        { publicId: dritter, baseRevision: 5 },
                    ],
                },
            },
        ]);
        // „Von der Karte nehmen“ ist dieselbe Auswahl über den anderen Weg; ein einzelner Weg meldet keine Zahl.
        await t.blatt.bitteAuswahl(lies);
        t.blatt.waehle("abnehmen");
        expect((await t.blatt.los())?.wahl).toBe("abnehmen");
        expect(t.gesendet.at(-1)?.wie).toBe("auswahl-abnehmen");
        await t.blatt.bitte(WEG);
        t.blatt.waehle("loeschen");
        expect((await t.blatt.los())?.wege).toBeUndefined();
    });

    it("🔴 Mehrfachauswahl über der Grenze einer Operation (500 Abschnitte): „Los“ schreibt nichts, statt vom Server „falsch geformt“ zu hören", async () => {
        const t = aufbau(ok);
        const viele = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                publicId: `5a5a5a5a-0000-4000-8000-${String(i).padStart(12, "0")}`,
                revision: 1,
            }));
        await t.blatt.bitteAuswahl(async () => ({ wege: 3, abschnitte: viele(PATH_SAMMEL_MAX + 1) }));
        expect(zuViele(t.blatt.stand.value!.auswahl!)).toBe(true);
        t.blatt.waehle("loeschen");
        expect(await t.blatt.los()).toBeUndefined();
        expect(t.gesendet).toEqual([]);
        // Genau an der Grenze geht es.
        await t.blatt.bitteAuswahl(async () => ({ wege: 3, abschnitte: viele(PATH_SAMMEL_MAX) }));
        expect(zuViele(t.blatt.stand.value!.auswahl!)).toBe(false);
        t.blatt.waehle("loeschen");
        expect(await t.blatt.los()).toMatchObject({ wege: 3 });
        expect(t.gesendet).toHaveLength(1);
    });

    it("Mehrfachauswahl: lässt sich die Auswahl nicht lesen, steht das Blatt auf dem Ladefehler und schreibt nichts", async () => {
        const t = aufbau(ok);
        await t.blatt.bitteAuswahl(async () => undefined);
        expect(t.blatt.stand.value).toMatchObject({ phase: "ladefehler" });
        t.blatt.waehle("loeschen");
        expect(await t.blatt.los()).toBeUndefined();
        await t.blatt.bitteAuswahl(async () => {
            throw new Error("Netz");
        });
        expect(t.blatt.stand.value).toMatchObject({ phase: "ladefehler" });
        expect(t.gesendet).toEqual([]);
    });

    it("🔴 „Ganze Straße (n Abschnitte) …“ (T49): EINE Operation über alle Abschnitte, jeder gegen seine Revision", async () => {
        const t = aufbau(ok);
        await t.blatt.bitteStrasse([
            { publicId: WEG, revision: 7 },
            { publicId: "5a5a5a5a-0000-4000-8000-0000000000e2", revision: 3 },
        ]);
        expect(t.blatt.stand.value).toMatchObject({ phase: "bereit", strasse: [{ revision: 7 }, { revision: 3 }] });
        t.blatt.waehle("loeschen");
        expect((await t.blatt.los())?.wahl).toBe("loeschen");
        expect(t.gesendet).toEqual([
            {
                wie: "strasse-loeschen",
                body: {
                    operationId: "op-1",
                    sections: [
                        { publicId: WEG, baseRevision: 7 },
                        { publicId: "5a5a5a5a-0000-4000-8000-0000000000e2", baseRevision: 3 },
                    ],
                },
            },
        ]);
    });
});
