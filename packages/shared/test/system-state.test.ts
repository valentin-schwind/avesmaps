import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    API_ERROR_CODE_PATTERN,
    HealthModeResponse,
    SYSTEM_ERROR_STATUS,
    SYSTEM_REASON_MAX,
    SystemEffectiveState,
    SystemLockBody,
    SystemModeBody,
} from "../src/index.ts";

/** Die Verträge des Betriebszustands (WI-0127 SYS-2, SYS-0001 §4.2, §4.6). */
describe("Betriebszustand: Verträge", () => {
    const operationId = "6d616d74-0000-4000-8000-0000000000aa";

    it("jeder Fachcode folgt dem Muster und hat einen Fehlerstatus", () => {
        const pattern = new RegExp(API_ERROR_CODE_PATTERN);
        for (const [code, status] of Object.entries(SYSTEM_ERROR_STATUS)) {
            expect(pattern.test(code), code).toBe(true);
            expect(status).toBeGreaterThanOrEqual(400);
        }
        expect(SYSTEM_ERROR_STATUS.system_state_unknown).toBe(503);
    });

    it("🔴 keine Stellung „Wartung“: die Wartung ist Claudios root-Datei, nie ein Wert der Anwendung", () => {
        const body = { operationId, baseRevision: 3, mode: "restricted", reason: "Abnahme" };
        expect(Value.Check(SystemModeBody, body)).toBe(true);
        expect(Value.Check(SystemModeBody, { ...body, mode: "maintenance" })).toBe(false);
        expect(Value.Check(SystemModeBody, { ...body, baseRevision: undefined })).toBe(false);
        expect(Value.Check(SystemModeBody, { ...body, reason: "x".repeat(SYSTEM_REASON_MAX + 1) })).toBe(false);
        expect(Value.Check(SystemLockBody, { operationId, baseRevision: 3, lock: "map", locked: true })).toBe(true);
        expect(Value.Check(SystemLockBody, { operationId, baseRevision: 3, lock: "karte", locked: true })).toBe(false);
    });

    it("🔴 unbekannt heißt null, nie Normal; /health/mode trägt den wirksamen Zustand flach, dazu eingestellt und LISTEN", () => {
        const unknown = {
            source: "unknown",
            mode: null,
            mapLock: null,
            systemLock: null,
            revision: null,
            contentRevision: null,
            readAt: null,
            ready: false,
        };
        expect(Value.Check(SystemEffectiveState, unknown)).toBe(true);
        expect(Value.Check(SystemEffectiveState, { ...unknown, source: "maintenance" })).toBe(false);
        expect(
            Value.Check(HealthModeResponse, {
                releaseId: "dev",
                ...unknown,
                listen: { connected: false, generation: 0, lastResyncAt: null },
                configured: null,
            }),
        ).toBe(true);
    });
});
