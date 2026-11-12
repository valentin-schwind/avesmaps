import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { berechnePlan, gesuchteTitelAus, type Plan, type PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import { entscheideZeile } from "../src/wiki/abgleich/uebernahme/entscheiden.ts";
import { gipfelSchreiber } from "../src/wiki/abgleich/uebernahme/gipfel.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import { sammleSeiten } from "../src/wiki/dump/seiten-sammler.ts";
import { baueDump, findeBzip2, neuerOrdner } from "./support/wiki-dump-fixture.ts";

/**
 * Die Wiki-Höhe nur bei Berggipfel und Vulkan (WI-0271 L3, §7.5): Eine Landmarke ohne Gelände (Höhle, Quelle …) liegt in derselben Tabelle und im selben
 * WikiSync-Bereich „gipfel“, führt aber keine Höhe (CHECK `terrain_peak_hoehe_nur_gelaende`). Rein, ohne Datenbank: der Plan gegen einen Fixture-Dump und die
 * Entscheidung der Übernahme.
 *
 * Problemfälle: Der Plan vergleicht die Höhe einer Höhle wie die eines Gipfels (ihre Zeile trüge dann den leeren Wert am Objekt statt des Wiki-Stands); die
 * Übernahme füllt die leere Höhe einer Höhle aus dem Wiki (`fuelltLeereFelder`) und scheitert am CHECK; ein Berggipfel verliert dabei seine Wiki-Höhe.
 */

const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;
const DUMP = [
    {
        titel: "Zackenberg",
        ns: 0,
        text: "{{Infobox Region\n|Name=Zackenberg\n|Art=Berg\n|Höhe=1200 Schritt\n}}\nEin Berg.",
    },
    {
        titel: "Zackenhöhle",
        ns: 0,
        text: "{{Infobox Region\n|Name=Zackenhöhle\n|Art=Höhle\n|Höhe=900 Schritt\n}}\nEine Höhle.",
    },
];
const TAFEL = wikiNamespaceTafel();
const bzip2 = findeBzip2();
let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let dumpPfad: string;

beforeAll(async () => {
    ordner = await neuerOrdner("landmarken-wikisync");
    dumpPfad = join(ordner.pfad, "dewa_dump_small_20261031.xml");
    await writeFile(dumpPfad, baueDump(DUMP));
});
afterAll(async () => {
    await ordner.weg();
});

/** Der Wiki-Stand, wie ihn das Wiki schon kennt (nur die Höhe weicht ab), damit allein die Höhe eine Zeile ergibt. */
const stand = (name: string, art: string, beschreibung: string, hoehe: string): ReadonlyMap<string, string | null> =>
    new Map([
        ["name", name],
        ["art", art],
        ["description", beschreibung],
        ["height", hoehe],
    ]);

const BERG: PlanObjekt = {
    bereich: "gipfel",
    objektArt: "peak",
    id: "a1271000-0000-4000-8000-000000000001",
    name: "Zackenberg",
    adresse: wiki("Zackenberg"),
    zustand: "zugewiesen",
    herkunft: "unknown",
    hauptzuweisung: true,
    lokal: new Map([["height", { zustand: "text", wert: "1100", vermerk: "wiki" }]]),
    schnappschuss: stand("Zackenberg", "Berg", "Ein Berg.", "1100"),
    schnappschussUnbekannt: new Set(),
};
/** Wie `ladeGipfel` eine Höhle liefert: keine Höhe am Objekt, das Feld nicht geführt. */
const HOEHLE: PlanObjekt = {
    ...BERG,
    id: "a1271000-0000-4000-8000-000000000002",
    name: "Zackenhöhle",
    adresse: wiki("Zackenhöhle"),
    lokal: new Map(),
    schnappschuss: stand("Zackenhöhle", "Höhle", "Eine Höhle.", "800"),
    nichtGefuehrt: new Set(["height"]),
};

async function plan(objekte: readonly PlanObjekt[]): Promise<Plan> {
    const gelesen = await sammleSeiten(dumpPfad, gesuchteTitelAus(objekte), TAFEL, bzip2 === null ? {} : { bzip2 });
    return berechnePlan({
        bereiche: ["gipfel"],
        objekte,
        dump: { gefunden: gelesen.gefunden, kandidaten: [] },
        tafel: TAFEL,
        legacyBereiche: new Set(),
        bekannteTitel: new Set(),
    });
}

const alsVorschau = (zeile: Plan["zeilen"][number]): VorschauZeile => ({ ...zeile, id: 1 }) as unknown as VorschauZeile;

describe("Wiki-Höhe nur bei Berggipfel und Vulkan (WI-0271 L3)", () => {
    it("🔴 der Plan vergleicht die Höhe des Bergs am Objekt, die der Höhle nur im Wiki-Stand", async () => {
        const zeilen = (await plan([BERG, HOEHLE])).zeilen.filter((zeile) => zeile.feld === "height");
        expect(zeilen.find((zeile) => zeile.objektId === BERG.id)).toMatchObject({
            alt: "1100",
            neu: "1200",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        // Am Wiki-Stand gemessen (800), nicht am leeren Feld der Höhle.
        expect(zeilen.find((zeile) => zeile.objektId === HOEHLE.id)).toMatchObject({ alt: "800", neu: "900" });
    });

    it("🔴 die Übernahme schreibt die Höhe der Höhle nur in den Wiki-Stand, die des Bergs auch ans Objekt", async () => {
        const zeilen = (await plan([BERG, HOEHLE])).zeilen.filter((zeile) => zeile.feld === "height");
        const objekte = new Map([BERG, HOEHLE].map((objekt) => [objekt.id, objekt]));
        const schritt = (id: string) => {
            const zeile = zeilen.find((z) => z.objektId === id)!;
            const ergebnis = entscheideZeile("gipfel", alsVorschau(zeile), objekte, gipfelSchreiber);
            expect(ergebnis.befunde).toEqual([]);
            return ergebnis.schritte[0];
        };
        expect(schritt(BERG.id)).toMatchObject({ wirksam: { vorher: "1100", nachher: "1200" } });
        const hoehle = schritt(HOEHLE.id);
        expect(hoehle).toMatchObject({ schnappschuss: { vorher: "800", nachher: "900" } });
        expect(hoehle?.wirksam).toBeUndefined();
    });

    it("eine Höhle ohne Wiki-Höhe davor: auch das leere Feld füllt die Übernahme nicht (`fuelltLeereFelder` gilt nur für geführte Felder)", () => {
        const ohne: PlanObjekt = { ...HOEHLE, schnappschuss: stand("Zackenhöhle", "Höhle", "Eine Höhle.", "") };
        const ergebnis = entscheideZeile(
            "gipfel",
            {
                id: 1,
                bereich: "gipfel",
                objektArt: "peak",
                objektId: ohne.id,
                objektName: ohne.name,
                objekte: 1,
                objektIds: [ohne.id],
                artikel: "Zackenhöhle",
                feld: "height",
                alt: null,
                altZustand: "kein",
                neu: "900",
                neuZustand: "text",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
            } as VorschauZeile,
            new Map([[ohne.id, ohne]]),
            gipfelSchreiber,
        );
        expect(ergebnis.schritte.every((schritt) => schritt.wirksam === undefined)).toBe(true);
    });
});
