import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    API_ERROR_CODE_PATTERN,
    API_ERROR_STATUS,
    ApiErrorBody,
    MutationEnvelope,
    OperationReceipt,
} from "../src/index.ts";

describe("Fehlerumschlag (ADR-0018)", () => {
    it("jeder gemeinsame Code folgt dem Muster und hat einen Fehlerstatus", () => {
        const pattern = new RegExp(API_ERROR_CODE_PATTERN);
        for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
            expect(pattern.test(code), code).toBe(true);
            expect(status).toBeGreaterThanOrEqual(400);
        }
    });

    it("nimmt Code, Satz und Details an und lehnt fremde Felder und schlechte Codes ab", () => {
        expect(
            Value.Check(ApiErrorBody, {
                error: { code: "edit_conflict", message: "x", details: { currentRevision: 2 } },
            }),
        ).toBe(true);
        expect(Value.Check(ApiErrorBody, { error: { code: "Edit-Conflict", message: "x" } })).toBe(false);
        expect(Value.Check(ApiErrorBody, { error: { code: "forbidden", message: "x", stack: "…" } })).toBe(false);
        expect(Value.Check(ApiErrorBody, { error: "database_unavailable" })).toBe(false);
    });
});

describe("Operation und Quittung (ADR-0019)", () => {
    const operationId = "0b6f2c1e-4a8d-4c1b-9f3e-2d7a5b8c9e10";

    it("verlangt eine UUID als Kennung, `baseRevision` ist freiwillig", () => {
        expect(Value.Check(MutationEnvelope, { operationId })).toBe(true);
        expect(Value.Check(MutationEnvelope, { operationId, baseRevision: 4 })).toBe(true);
        expect(Value.Check(MutationEnvelope, { operationId: "nochmal" })).toBe(false);
        expect(Value.Check(MutationEnvelope, { operationId, baseRevision: -1 })).toBe(false);
    });

    it("die Quittung nennt Status, Umgebung, Betroffenes, Folgearbeit und Hinweise", () => {
        expect(
            Value.Check(OperationReceipt, {
                operationId,
                status: "replayed",
                environment: "staging",
                affected: [{ kind: "person_access", id: "p1", revision: 5 }],
                derivedWork: [],
                warnings: [],
            }),
        ).toBe(true);
        expect(
            Value.Check(OperationReceipt, {
                operationId,
                status: "maybe",
                environment: "staging",
                affected: [],
                derivedWork: [],
                warnings: [],
            }),
        ).toBe(false);
    });
});
