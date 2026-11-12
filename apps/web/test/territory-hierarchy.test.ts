import { describe, expect, it } from "vitest";
import { territoryHierarchy } from "../src/route-planner/territory-hierarchy";

const entry = (id: string, parentId: string | null = null, name = id) => ({ id, parentId, name });
const rows = (stages: Parameters<typeof territoryHierarchy>[0]) =>
    territoryHierarchy(stages).map(({ entry, depth }) => [entry.id, depth]);

describe("territory hierarchy", () => {
    it("groups descendants below their parents, preserving sibling order and deduplicating stages", () => {
        expect(
            rows([
                [entry("child", "root"), entry("other"), entry("root"), entry("sibling", "root")],
                [entry("child", "root"), entry("grandchild", "child")],
            ]),
        ).toEqual([
            ["other", 0],
            ["root", 0],
            ["child", 1],
            ["grandchild", 2],
            ["sibling", 1],
        ]);
    });
    it("uses identities rather than names, and keeps absent parents at root level", () => {
        expect(
            rows([[entry("a", null, "Same"), entry("b", null, "Same"), entry("c", "b"), entry("d", "missing")]]),
        ).toEqual([
            ["a", 0],
            ["b", 0],
            ["c", 1],
            ["d", 0],
        ]);
    });
    it("terminates on cycles and self references without dropping or repeating entries", () => {
        expect(rows([[entry("a", "b"), entry("b", "a"), entry("self", "self")]])).toEqual([
            ["self", 0],
            ["a", 0],
            ["b", 1],
        ]);
        expect(rows([])).toEqual([]);
    });
});
