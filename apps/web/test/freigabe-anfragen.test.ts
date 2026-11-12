import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorLockIncoming, EditorLockTarget } from "@avesmaps3d/shared";
import { createFreigabeAnfragen } from "../src/editor-sperre/freigabe-anfragen.ts";
import type { FreigabeAusgang } from "../src/editor-sperre/sperre.ts";

/**
 * „Freigabe erbitten“ beim Inhaber (WI-0262, OPS-000059; Vali 2026-10-30): Hinweis mit „Freigeben“ und „Später“.
 *
 * Problemfälle: „Freigeben“ antwortet, bevor gespeichert ist; ein gescheitertes Speichern (Prüfung, 409) gibt die Sperre trotzdem ab
 * oder beantwortet die Bitte; der Hinweis nennt den Grund nicht oder verschwindet; „Später“ lässt die Bitte unbeantwortet; ein
 * Doppelklick speichert zweimal; zwei Bitten an dasselbe Objekt brauchen zwei Klicks; eine abgelaufene Bitte bleibt stehen, bis der
 * nächste Herzschlag kommt; eine Bitte, die mitten im Speichern aus der Liste fällt, nimmt den Hinweis mit.
 */
const ZIEL = "f3f3f3f3-0000-4000-8000-0000000000a1";
const bitte = (nr: number, extra: Partial<EditorLockIncoming> = {}): EditorLockIncoming => ({
    requestId: `f3f3f3f3-0000-4000-8000-0000000000b${String(nr)}`,
    kind: "place",
    id: ZIEL,
    from: { id: "f3f3f3f3-0000-4000-8000-0000000000f1", name: "Thomas" },
    createdAt: "2026-10-30T10:00:00.000Z",
    expiresAt: "2026-10-30T10:05:00.000Z",
    ...extra,
});
const JETZT = Date.parse("2026-10-30T10:01:00.000Z");

afterEach(() => {
    vi.useRealTimers();
});

function aufbau(gibFrei: (ziel: EditorLockTarget) => Promise<FreigabeAusgang> = async () => ({ ok: true })) {
    let hoerer!: (liste: readonly EditorLockIncoming[]) => void;
    const aufrufe: string[] = [];
    const sperre = {
        beiAnfragen: (h: typeof hoerer) => {
            hoerer = h;
            return () => undefined;
        },
        gibFreiAufBitte: vi.fn(async (ziel: EditorLockTarget) => {
            aufrufe.push(`speichern ${ziel.kind}:${ziel.id}`);
            return gibFrei(ziel);
        }),
        antworte: vi.fn(async (id: string, antwort: string) => {
            aufrufe.push(`antwort ${id.slice(-2)} ${antwort}`);
            return true;
        }),
        titelVon: () => "Gareth",
    };
    vi.useFakeTimers({ now: JETZT });
    const modell = createFreigabeAnfragen({ sperre, jetzt: () => Date.now() });
    return { modell, sperre, aufrufe, liefere: (liste: EditorLockIncoming[]) => hoerer(liste) };
}

describe("Hinweise beim Inhaber", () => {
    it("🔴 die Bitte erscheint mit dem Namen des Bittenden und des Objekts; eine beantwortete fällt beim nächsten Herzschlag weg", () => {
        const t = aufbau();
        t.liefere([bitte(1)]);
        expect(t.modell.eintraege.value).toEqual([
            {
                id: bitte(1).requestId,
                kind: "place",
                objektId: ZIEL,
                wer: "Thomas",
                name: "Gareth",
                bis: "2026-10-30T10:05:00.000Z",
                stand: "offen",
                grund: undefined,
            },
        ]);
        t.liefere([]);
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });

    it("🔴 Freigeben: ERST speichern und abgeben, DANN antworten „freigegeben“; der Hinweis geht", async () => {
        const t = aufbau();
        t.liefere([bitte(1)]);
        await t.modell.freigeben(bitte(1).requestId);
        expect(t.aufrufe).toEqual([`speichern place:${ZIEL}`, "antwort b1 released"]);
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });

    it("🔴 scheitert das Speichern: der Hinweis bleibt mit dem Grund, keine Antwort, die Knöpfe gelten weiter; ein zweiter Versuch geht", async () => {
        let ausgang: FreigabeAusgang = { ok: false, grund: "Die Art fehlt noch." };
        const t = aufbau(async () => ausgang);
        t.liefere([bitte(1)]);
        await t.modell.freigeben(bitte(1).requestId);
        expect(t.aufrufe).toEqual([`speichern place:${ZIEL}`]);
        expect(t.modell.eintraege.value).toMatchObject([{ stand: "fehler", grund: "Die Art fehlt noch." }]);
        // Der nächste Herzschlag nennt die Bitte weiter: Grund und Stand bleiben.
        t.liefere([bitte(1)]);
        expect(t.modell.eintraege.value).toMatchObject([{ stand: "fehler", grund: "Die Art fehlt noch." }]);
        // Ohne Grund aus der Bearbeitung gilt der allgemeine Satz.
        ausgang = { ok: false, grund: undefined };
        await t.modell.freigeben(bitte(1).requestId);
        expect(t.modell.eintraege.value).toMatchObject([
            { stand: "fehler", grund: "Das Speichern ist nicht gelungen." },
        ]);
        // Danach gelingt es: gespeichert, abgegeben, beantwortet.
        ausgang = { ok: true };
        await t.modell.freigeben(bitte(1).requestId);
        expect(t.aufrufe.at(-1)).toBe("antwort b1 released");
        expect(t.aufrufe.filter((a) => a.startsWith("antwort"))).toEqual(["antwort b1 released"]);
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });

    it("Später lehnt ab: Antwort „later“, ohne zu speichern; der Hinweis geht", async () => {
        const t = aufbau();
        t.liefere([bitte(1)]);
        await t.modell.spaeter(bitte(1).requestId);
        expect(t.aufrufe).toEqual(["antwort b1 later"]);
        expect(t.sperre.gibFreiAufBitte).not.toHaveBeenCalled();
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });

    it("🔴 ein Doppelklick speichert nicht zweimal, und während des Speicherns gilt „Später“ nicht", async () => {
        let fertig!: (a: FreigabeAusgang) => void;
        const t = aufbau(() => new Promise<FreigabeAusgang>((r) => (fertig = r)));
        t.liefere([bitte(1)]);
        const erst = t.modell.freigeben(bitte(1).requestId);
        await t.modell.freigeben(bitte(1).requestId);
        await t.modell.spaeter(bitte(1).requestId);
        expect(t.sperre.gibFreiAufBitte).toHaveBeenCalledTimes(1);
        expect(t.modell.eintraege.value).toMatchObject([{ stand: "speichert" }]);
        // Fällt die Bitte mitten im Speichern aus der Liste (das Speichern gab die Sperre ab), bleibt der Hinweis bis zum Ende.
        t.liefere([]);
        expect(t.modell.eintraege.value).toMatchObject([{ stand: "speichert" }]);
        fertig({ ok: true });
        await erst;
        expect(t.modell.eintraege.value).toEqual([]);
        expect(t.aufrufe).toEqual([`speichern place:${ZIEL}`, "antwort b1 released"]);
        t.modell.destroy();
    });

    it("🔴 zwei Bitten an dasselbe Objekt: EIN Freigeben erfüllt beide, beide bekommen die Antwort", async () => {
        const t = aufbau();
        t.liefere([bitte(1), bitte(2, { from: { id: "f3f3f3f3-0000-4000-8000-0000000000f2", name: "Valentin" } })]);
        expect(t.modell.eintraege.value.map((e) => e.wer)).toEqual(["Thomas", "Valentin"]);
        await t.modell.freigeben(bitte(1).requestId);
        expect(t.sperre.gibFreiAufBitte).toHaveBeenCalledTimes(1);
        expect(t.aufrufe.filter((a) => a.startsWith("antwort")).sort()).toEqual([
            "antwort b1 released",
            "antwort b2 released",
        ]);
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });

    it("🔴 eine Bitte verschwindet, wenn sie abläuft, auch ohne Herzschlag", async () => {
        const t = aufbau();
        t.liefere([bitte(1)]);
        await vi.advanceTimersByTimeAsync(3 * 60_000);
        expect(t.modell.eintraege.value).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2 * 60_000);
        expect(t.modell.eintraege.value).toEqual([]);
        // Eine schon abgelaufene Bitte erscheint gar nicht erst.
        t.liefere([bitte(2, { expiresAt: "2026-10-30T10:00:00.000Z" })]);
        expect(t.modell.eintraege.value).toEqual([]);
        t.modell.destroy();
    });
});
