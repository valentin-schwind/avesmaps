import { describe, expect, it, vi } from "vitest";
import { installGebietWechsel, wechsleGebiet, type GebietWechselSeite } from "../src/gebietseditor/gebiet-wechsel";
import type { HitContext, InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types";

/** Der Klick auf ein anderes Gebiet im Modus „Grenzen bearbeiten“ (OPS-000077). */

function besitzer(seite: Partial<GebietWechselSeite>): { owner: InteractionOwner; wechsle: ReturnType<typeof vi.fn> } {
    let owner: InteractionOwner | undefined;
    const wechsle = vi.fn();
    const coordinator = {
        register(neu: InteractionOwner) {
            owner = neu;
            return () => undefined;
        },
    } as unknown as MapInteractionCoordinator;
    installGebietWechsel(coordinator, {
        laeuft: () => true,
        traegt: () => false,
        layers: () => ["gebiete"],
        gebiete: () => [{ id: "klein" }, { id: "gross" }],
        wechsle,
        ...seite,
    });
    return { owner: owner!, wechsle };
}
const klick = { kind: "click", point: { x: 5, y: 5 } } as unknown as HitContext;

describe("Gebietswechsel per Klick (OPS-000077)", () => {
    it("🔴 ein Klick außerhalb der Fläche und ihres Saums wechselt zum kleinsten Gebiet unter dem Zeiger", async () => {
        const { owner, wechsle } = besitzer({});
        const anspruch = await owner.hit?.(klick);
        expect(anspruch).toBeDefined();
        owner.apply?.("click", anspruch!, klick);
        expect(wechsle).toHaveBeenCalledWith("klein", klick);
    });

    it("🔴 in der bearbeiteten Fläche und in ihrem Saum nimmt er nichts: Dort setzt der Doppelklick einen Punkt (T59)", () => {
        expect(besitzer({ traegt: () => true }).owner.hit?.(klick)).toBeUndefined();
    });

    it("ohne Gebiet unter dem Zeiger bleibt der Klick frei; außerhalb des Modus ist der Besitzer aus", () => {
        expect(besitzer({ gebiete: () => [] }).owner.hit?.(klick)).toBeUndefined();
        expect(besitzer({ laeuft: () => false }).owner.enabled?.()).toBe(false);
    });

    it("🔴 Ungespeichertes wird erst geschrieben, dann beginnt das nächste Gebiet", async () => {
        const folge: string[] = [];
        let laeuft = true;
        await wechsleGebiet(
            {
                ungespeichert: 3,
                fertig: () => {
                    folge.push("fertig");
                    laeuft = false;
                    return Promise.resolve();
                },
                laeuft: () => laeuft,
            },
            () => {
                folge.push("beginne");
                return Promise.resolve();
            },
        );
        expect(folge).toEqual(["fertig", "beginne"]);
    });

    it("🔴 lehnt der Server ab, bleibt die Bearbeitung stehen und nichts Neues beginnt", async () => {
        const beginne = vi.fn(() => Promise.resolve());
        await wechsleGebiet({ ungespeichert: 1, fertig: () => Promise.resolve(), laeuft: () => true }, beginne);
        expect(beginne).not.toHaveBeenCalled();
    });

    it("ohne Änderung oder ohne laufende Bearbeitung wird nichts geschrieben", async () => {
        const fertig = vi.fn(() => Promise.resolve());
        const beginne = vi.fn(() => Promise.resolve());
        await wechsleGebiet({ ungespeichert: 0, fertig, laeuft: () => true }, beginne);
        await wechsleGebiet(undefined, beginne);
        expect(fertig).not.toHaveBeenCalled();
        expect(beginne).toHaveBeenCalledTimes(2);
    });
});
