import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubjectRef } from "@avesmaps3d/shared";
import { useTraegerKarten } from "../src/fenster/traeger-karten";
import { kachelGruppen } from "../src/editor-panel/karteninhalte-kacheln";
import { medienOffen, medienZustand, oeffneMedien } from "../src/medien/medien-oeffnen";

/**
 * Der Reiter „Karten“ am Objekt (Vali 2026-11-02: „als tab im eigenschaftseditor von objekten die eine karte haben bzw in der kartensammlung sind, sollen hier alle karten gelistet werden. ein klick öffnet den
 * eintrag im MAM“): Die Liste kommt aus der Sektion des Objekts, ohne Karten fällt der Reiter weg, und der Klick öffnet genau diesen Eintrag.
 */

const antwort = (maps: readonly { id: string; title: string }[]): Response =>
    new Response(JSON.stringify({ subject: {}, revision: "r", maps }), { status: 200 });
const warten = async (): Promise<void> => {
    await nextTick();
    await new Promise((fertig) => setTimeout(fertig));
    await nextTick();
};

describe("Der Reiter „Karten“", () => {
    afterEach(() => {
        medienOffen.value = false;
    });

    it("🔴 liest die Karten des Objekts unter seiner Adresse; ein anderes Objekt liest neu", async () => {
        const fetcher = vi.fn(async (url: string | URL | Request) =>
            antwort(String(url).includes("/place/a") ? [{ id: "k1", title: "Stadtplan" }] : []),
        ) as unknown as typeof fetch;
        const ziel = ref<SubjectRef | undefined>({ kind: "place", id: "a" });
        const beiLeer = vi.fn();
        const scope = effectScope();
        const karten = scope.run(() => useTraegerKarten(() => ziel.value, beiLeer, fetcher))!;
        await warten();
        expect(karten.value.map((karte) => karte.id)).toEqual(["k1"]);
        expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain("/place/a/citymaps");
        expect(beiLeer).not.toHaveBeenCalled();

        ziel.value = { kind: "place", id: "b" };
        await warten();
        expect(karten.value).toEqual([]);
        expect(beiLeer).toHaveBeenCalledTimes(1);
        scope.stop();
    });

    it("🔴 ein Fehler sagt nichts und lässt den Reiter wegfallen", async () => {
        const fetcher = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
        const beiLeer = vi.fn();
        const scope = effectScope();
        const karten = scope.run(() => useTraegerKarten(() => ({ kind: "territory", id: "c" }), beiLeer, fetcher))!;
        await warten();
        expect(karten.value).toEqual([]);
        expect(beiLeer).toHaveBeenCalled();
        scope.stop();
    });

    it("🔴 der Klick öffnet die Medienverwaltung genau bei diesem Eintrag der Kartensammlung", () => {
        oeffneMedien({ karte: "k1", kartenSuche: "Stadtplan" });
        expect(medienOffen.value).toBe(true);
        expect(medienZustand.value).toMatchObject({
            auswahl: { objekt: "kartensammlung" },
            karte: "k1",
            q: "Stadtplan",
        });
    });

    it("die graue Kachel „Karten“ gibt es nicht mehr", () => {
        const alle = kachelGruppen(["use_editor_menu"]).flatMap((gruppe) => gruppe.kacheln.map((kachel) => kachel.id));
        expect(alle).not.toContain("karten");
    });
});
