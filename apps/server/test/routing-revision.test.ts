import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import {
    changedParts,
    DATA_PART_INPUTS,
    ROUTING_DATA_PARTS,
    ROUTING_REVISION_PARTS,
    revisionKey,
    seaGraphIdentity,
    staleDataParts,
    travelModelVersion,
    type RoutingDataPart,
    type RoutingDataRevision,
} from "../src/routing/revision.ts";
import { revisionOf } from "./support/routing-revision.ts";

/**
 * Die Naht der Routing-Revision (Hardening Review M6): Schlüssel und Vergleich. Die Abfrage aus der Datenbank
 * und ihre Abdeckung der Loader-Tabellen stehen in `route-service.test.ts` und
 * `routing-fingerprint-coverage.test.ts`.
 */

const voll: RoutingDataRevision = {
    map: "10/2026-09-28 10:00:00+00|3/-|8/2026-09-28 10:00:00+00|1/-|4/2026-09-28 10:00:00+00",
    travelModel: "0123456789ab",
    terrain: "7/aaaa|1/2026-09-28 10:00:00+00|2/2026-09-28 10:00:00+00",
    pathProfiles: "12/bbbb",
    seaGraph: "sichtgraph-f1:cccc",
    climate: "9/dddd",
    territories: "ca7f4157a0d5@1049|1753/2026-09-30 01:47:47+00|44",
    settings: "ca7f4157a0d5@1049|1753/2026-09-30 01:47:47+00|44",
    settingsLive: "3/0bb1c1f6a0d5",
};

describe("revisionKey", () => {
    it("ist ein Kurzschlüssel aus zwölf Hexzeichen, wie die routing_graph_revision bisher", () => {
        expect(revisionKey(voll)).toMatch(/^[0-9a-f]{12}$/);
        expect(revisionKey(revisionOf("r1"))).toMatch(/^[0-9a-f]{12}$/);
    });

    it("bleibt für dieselben Daten gleich, auch bei anderer Schlüsselreihenfolge des Objekts", () => {
        const umgestellt: RoutingDataRevision = {
            settingsLive: voll.settingsLive,
            settings: voll.settings,
            territories: voll.territories,
            climate: voll.climate,
            seaGraph: voll.seaGraph,
            pathProfiles: voll.pathProfiles,
            terrain: voll.terrain,
            travelModel: voll.travelModel,
            map: voll.map,
        };
        expect(revisionKey(umgestellt)).toBe(revisionKey(voll));
        expect(revisionKey({ ...voll })).toBe(revisionKey(voll));
    });

    it("🔴 jeder Teil geht ein: eine Änderung an irgendeinem gibt einen anderen Schlüssel", () => {
        const keys = new Set([revisionKey(voll)]);
        for (const part of ROUTING_REVISION_PARTS) {
            keys.add(revisionKey({ ...voll, [part]: `${String(voll[part])}!` }));
        }
        // Einer ohne Änderung plus je Teil einer.
        expect(keys.size).toBe(ROUTING_REVISION_PARTS.length + 1);
    });

    it("unterscheidet „Teil fehlt“ von einem Teil mit dem Text „null“ und vom leeren Text", () => {
        const fehlt = revisionKey({ ...voll, terrain: null });
        expect(fehlt).not.toBe(revisionKey({ ...voll, terrain: "null" }));
        expect(fehlt).not.toBe(revisionKey({ ...voll, terrain: "" }));
    });

    it("verwechselt keine Teile: derselbe Text in einem anderen Teil ist ein anderer Stand", () => {
        const a = revisionKey({ ...voll, terrain: "x", pathProfiles: null });
        const b = revisionKey({ ...voll, terrain: null, pathProfiles: "x" });
        expect(a).not.toBe(b);
    });
});

describe("changedParts", () => {
    it("nennt nichts, wenn sich nichts geändert hat", () => {
        expect(changedParts(voll, { ...voll })).toEqual([]);
    });

    it("nennt genau die geänderten Teile, in der festen Reihenfolge", () => {
        expect(changedParts(voll, { ...voll, terrain: "anders" })).toEqual(["terrain"]);
        expect(changedParts(voll, { ...voll, climate: "anders", map: "anders" })).toEqual(["map", "climate"]);
        expect(changedParts(voll, { ...voll, seaGraph: null, pathProfiles: null })).toEqual([
            "pathProfiles",
            "seaGraph",
        ]);
    });

    it("zählt das Erscheinen und Verschwinden eines Teils als Änderung", () => {
        expect(changedParts({ ...voll, terrain: null }, voll)).toEqual(["terrain"]);
        expect(changedParts(voll, { ...voll, terrain: null })).toEqual(["terrain"]);
    });

    it("kennt ohne Vorgänger nur Neues: alle Teile", () => {
        expect(changedParts(null, voll)).toEqual([...ROUTING_REVISION_PARTS]);
    });

    it("stimmt mit dem Schlüssel überein: gleicher Schlüssel, keine Änderung - und umgekehrt", () => {
        const andere = [
            voll,
            { ...voll, terrain: "anders" },
            { ...voll, travelModel: "ffffffffffff" },
            { ...voll, seaGraph: null },
        ];
        for (const a of andere) {
            for (const b of andere) {
                expect(changedParts(a, b).length === 0).toBe(revisionKey(a) === revisionKey(b));
            }
        }
    });
});

describe("staleDataParts: was ein neuer Stand neu laden muss", () => {
    const stale = (after: Partial<RoutingDataRevision>): RoutingDataPart[] => [
        ...staleDataParts(voll, { ...voll, ...after }),
    ];

    it("lädt nichts, wenn nichts anders ist - und alles ohne Vorgänger", () => {
        expect(stale({})).toEqual([]);
        expect([...staleDataParts(null, voll)]).toEqual(ROUTING_DATA_PARTS);
    });

    it("🔴 eine Ortsänderung lässt Gelände und Klima stehen: nur Netz, Wasser, Land, Flüsse und Boden laden", () => {
        expect(stale({ map: "11/x|3/-|8/x|1/-|4/x" })).toEqual(["network", "water", "land", "rivers", "ground"]);
    });

    describe("🔴 die Abschnitte von `map` (WI-0298): jeder Bestandteil lädt nur, wenn sich eine SEINER Tabellen ändert", () => {
        // Die heutige Form: Orte, Wege, Regionen, Flächen, je Anzahl und letzte Änderung (`readRoutingRevision`).
        const vier: RoutingDataRevision = { ...voll, map: "10/t0|3/t0|8/t0|4/t0" };
        const nach = (map: string): RoutingDataPart[] => [...staleDataParts(vier, { ...vier, map })];

        it("ein Ort lädt nur das Netz: Wasser, Land, Flüsse und Boden bleiben dieselben Objekte", () => {
            expect(nach("10/t1|3/t0|8/t0|4/t0")).toEqual(["network"]);
            expect(nach("11/t1|3/t0|8/t0|4/t0")).toEqual(["network"]);
        });

        it("ein Weg lädt Netz und Flüsse (die Flüsse sind Wege)", () => {
            expect(nach("10/t0|3/t1|8/t0|4/t0")).toEqual(["network", "rivers"]);
        });

        it("eine Region oder Fläche lädt Wasser, Land und Boden, nicht das Netz", () => {
            expect(nach("10/t0|3/t0|8/t1|4/t0")).toEqual(["water", "land", "ground"]);
            expect(nach("10/t0|3/t0|8/t0|5/t1")).toEqual(["water", "land", "ground"]);
        });

        it("alles zugleich lädt alles, was an `map` hängt", () => {
            expect(nach("11/t1|4/t1|9/t1|5/t1")).toEqual(["network", "water", "land", "rivers", "ground"]);
        });

        it("eine unbekannte Form lädt sicherheitshalber alles, was an `map` hängt", () => {
            expect(nach("11/t1|3/t0|8/t0|4/t0|1/-")).toEqual(["network", "water", "land", "rivers", "ground"]);
            expect(nach("anders")).toEqual(["network", "water", "land", "rivers", "ground"]);
        });

        it("die anderen Teile wirken weiter wie vorher", () => {
            expect([...staleDataParts(vier, { ...vier, map: "10/t1|3/t0|8/t0|4/t0", climate: "x" })]).toEqual([
                "network",
                "climate",
            ]);
            expect([...staleDataParts(vier, { ...vier, map: "10/t0|3/t0|8/t1|4/t0", travelModel: "x" })]).toEqual(
                ROUTING_DATA_PARTS,
            );
        });
    });

    it("🔴 eine Geländeableitung lädt das Gelände neu, aber nicht Wasser, Land, Flüsse und Boden", () => {
        expect(stale({ terrain: "8/anders|1/x|2/x" })).toEqual(["heights"]);
        // Die Wegprofile gehören zum Netz.
        expect(stale({ pathProfiles: "13/anders" })).toEqual(["network"]);
        expect(stale({ terrain: "8/anders|1/x|2/x", pathProfiles: "13/anders" })).toEqual(["network", "heights"]);
    });

    it("das Klima lädt nur das Klima; der Seegraph lädt nichts, er kommt erst auf Verlangen", () => {
        expect(stale({ climate: "10/anders" })).toEqual(["climate"]);
        expect(stale({ seaGraph: "sichtgraph-f2:eeee" })).toEqual([]);
    });

    it("🔴 eine neue Ableitung der Herrschaftsgebiete lädt NUR die Zollgebiete (WI-0065); ohne Ableitung fehlt der Teil", () => {
        expect(stale({ territories: "0123456789ab@1049|1753/2026-10-01 00:00:00+00|44" })).toEqual(["territories"]);
        // Das Jahr gehört zum Teil: eine Ableitung für ein anderes Anzeigejahr lädt neu.
        expect(stale({ territories: "ca7f4157a0d5@1050|1753/2026-09-30 01:47:47+00|44" })).toEqual(["territories"]);
        // Ein Import entwertet die Ableitung: der Teil fehlt, die Zollgebiete werden leer neu geladen.
        expect(stale({ territories: null })).toEqual(["territories"]);
        expect(staleDataParts({ ...voll, territories: null }, voll).has("territories")).toBe(true);
        // Umgekehrt lädt keine andere Änderung die Zollgebiete: Orte, Gelände, Klima und Seegraph lassen sie stehen.
        expect(stale({ map: "11/x|3/-|8/x|1/-|4/x", terrain: null, climate: null, seaGraph: null })).not.toContain(
            "territories",
        );
    });

    it("das Erscheinen und Verschwinden eines Teils lädt seine Bestandteile", () => {
        expect(staleDataParts({ ...voll, terrain: null }, voll).has("heights")).toBe(true);
        expect(staleDataParts(voll, { ...voll, terrain: null }).has("heights")).toBe(true);
        expect(staleDataParts({ ...voll, pathProfiles: null }, voll).has("network")).toBe(true);
    });

    it("ein anderes Reisemodell lädt alles: Flüsse, Boden und Gelände rechnen damit", () => {
        expect([...staleDataParts(voll, { ...voll, travelModel: "ffffffffffff" })]).toEqual(ROUTING_DATA_PARTS);
    });

    it("jeder Bestandteil hängt von mindestens einem Teil ab, und jeder Teil ist ein Teil der Revision", () => {
        for (const part of ROUTING_DATA_PARTS) {
            expect(DATA_PART_INPUTS[part].length, part).toBeGreaterThan(0);
            for (const input of DATA_PART_INPUTS[part]) expect(ROUTING_REVISION_PARTS).toContain(input);
        }
    });
});

describe("Hilfen", () => {
    it("die Version des Reisemodells ist zwölf Hexzeichen und hängt am Inhalt", () => {
        const version = travelModelVersion(AVENTURIA_TRAVEL_MODEL);
        expect(version).toMatch(/^[0-9a-f]{12}$/);
        expect(travelModelVersion(structuredClone(AVENTURIA_TRAVEL_MODEL))).toBe(version);
        const anders = {
            ...AVENTURIA_TRAVEL_MODEL,
            meilenJeKarteneinheit: {
                ...AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit,
                wert: AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert + 1,
            },
        };
        expect(travelModelVersion(anders)).not.toBe(version);
    });

    it("die Kennung eines Seegraphen trennt Algorithmus und Quellen", () => {
        expect(seaGraphIdentity("algo", "quelle")).toBe("algo:quelle");
        expect(seaGraphIdentity("algo", "quelle")).not.toBe(seaGraphIdentity("algo-q", "uelle"));
    });
});
