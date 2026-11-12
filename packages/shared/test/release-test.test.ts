import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    RELEASE_TEST_ERROR_STATUS,
    RELEASE_TEST_SCHRITTE,
    ReleaseTestAbbrechenBody,
    ReleaseTestKandidat,
    ReleaseTestLauf,
    ReleaseTestSicht,
    ReleaseTestStartBody,
    ReleaseTestStartvorgang,
    releaseTestBeschaeftigt,
    releaseTestCommit,
} from "../src/system/release-test.ts";

/**
 * Der Vertrag des Release-Tests auf dem Entwicklungsrechner (WI-0248 L): Körper, Sicht und die zwei Regeln, die Server und Oberfläche teilen.
 * Die Form der Antwort des Starters prüft `apps/server/test/release-abholer.test.ts` gegen diese Schemata.
 */

const SHA = "a".repeat(40);
const lauf = {
    zustand: "laeuft",
    sha: SHA,
    fertigeTeile: [],
    sperre: true,
    lebt: true,
    jetzt: "2026-10-23T10:00:00.000Z",
    schritte: RELEASE_TEST_SCHRITTE.map((id) => ({ id, zustand: "offen", erwartetMs: 1000, schaetzung: true })),
    erwartetMs: 14_000,
    erwartetSchaetzung: true,
    fortschritt: 0.5,
    verbleibendMs: 7000,
};
const sicht = (patch: object = {}) => ({
    now: "2026-10-23T10:00:00.000Z",
    verfuegbar: true,
    fehler: null,
    kandidat: { stage: { sha: SHA, zeit: "z" }, auftrag: null },
    lauf,
    start: null,
    ...patch,
});

describe("Release-Test: Körper der Schreibwege", () => {
    const id = "0f8e5a52-6d0b-4f43-9c1e-2b7d9a3c4e51";

    it("🔴 Starten und Abbrechen verlangen eine vollständige SHA in Kleinbuchstaben und nichts weiter", () => {
        for (const schema of [ReleaseTestStartBody, ReleaseTestAbbrechenBody]) {
            expect(Value.Check(schema, { operationId: id, commit: SHA })).toBe(true);
            expect(Value.Check(schema, { operationId: id, commit: SHA.slice(0, 39) })).toBe(false);
            expect(Value.Check(schema, { operationId: id, commit: "A".repeat(40) })).toBe(false);
            expect(Value.Check(schema, { operationId: id, commit: `${SHA}; rm -rf /` })).toBe(false);
            expect(Value.Check(schema, { operationId: id, commit: "--stand" })).toBe(false);
            expect(Value.Check(schema, { operationId: id, commit: SHA, extra: 1 })).toBe(false);
            expect(Value.Check(schema, { commit: SHA })).toBe(false);
        }
    });
});

describe("Release-Test: die Sicht", () => {
    it("nimmt die Sicht mit laufendem Test an, auch ohne Lauf und ohne Kandidat", () => {
        expect(Value.Check(ReleaseTestSicht, sicht())).toBe(true);
        expect(
            Value.Check(ReleaseTestSicht, sicht({ lauf: null, kandidat: null, verfuegbar: false, fehler: "x" })),
        ).toBe(true);
        expect(
            Value.Check(ReleaseTestSicht, sicht({ start: { commit: SHA, seit: "z", zustand: "baut", grund: null } })),
        ).toBe(true);
    });

    it("🔴 lehnt Fremdes ab: eine falsche Zahl, ein unbekannter Schritt, ein Pfad der Statusdatei", () => {
        expect(Value.Check(ReleaseTestLauf, { ...lauf, fortschritt: 1.5 })).toBe(false);
        expect(Value.Check(ReleaseTestLauf, { ...lauf, statuspfad: "C:/x/status.json" })).toBe(false);
        expect(
            Value.Check(ReleaseTestLauf, {
                ...lauf,
                schritte: [{ id: "unbekannt", zustand: "offen", erwartetMs: 1, schaetzung: true }],
            }),
        ).toBe(false);
        expect(Value.Check(ReleaseTestKandidat, { stage: { sha: "kurz", zeit: "z" }, auftrag: null })).toBe(false);
        // Der Bericht ist begrenzt: höchstens zwanzig Fälle, höchstens sechzig Protokollzeilen.
        const fehler = (faelle: number, zeilen: number) => ({
            ...lauf,
            zustand: "rot",
            fehler: {
                schritt: "tests",
                grund: "x",
                faelle: Array.from({ length: faelle }, () => ({ datei: "a", name: "b", meldung: [] })),
                faelleGesamt: faelle,
                protokollEnde: Array.from({ length: zeilen }, () => "z"),
            },
        });
        expect(Value.Check(ReleaseTestLauf, fehler(20, 60))).toBe(true);
        expect(Value.Check(ReleaseTestLauf, fehler(21, 60))).toBe(false);
        expect(Value.Check(ReleaseTestLauf, fehler(20, 61))).toBe(false);
    });
});

describe("Release-Test: der Start in der Datei des Starters", () => {
    const vorgang = {
        commit: SHA,
        seit: "2026-10-23T17:00:00.000Z",
        zustand: "fehler",
        grund: "Testpaket nicht gebaut",
    };

    it("🔴 der Lauf trägt den Startvorgang des Starters (additiv: ohne ihn bleibt jeder bisherige Lauf gültig)", () => {
        expect(Value.Check(ReleaseTestLauf, lauf)).toBe(true);
        expect(Value.Check(ReleaseTestLauf, { ...lauf, startvorgang: vorgang })).toBe(true);
        expect(
            Value.Check(ReleaseTestLauf, { ...lauf, startvorgang: { ...vorgang, zustand: "baut", grund: null } }),
        ).toBe(true);
        expect(Value.Check(ReleaseTestStartvorgang, vorgang)).toBe(true);
    });

    it("lehnt einen Startvorgang ab, der nicht zu einer SHA gehört, einen unbekannten Zustand und jedes Feld mehr (etwa die Prozessnummer des Starters)", () => {
        expect(Value.Check(ReleaseTestLauf, { ...lauf, startvorgang: { ...vorgang, commit: "kurz" } })).toBe(false);
        expect(Value.Check(ReleaseTestLauf, { ...lauf, startvorgang: { ...vorgang, zustand: "kaputt" } })).toBe(false);
        expect(Value.Check(ReleaseTestLauf, { ...lauf, startvorgang: { ...vorgang, pid: 4711 } })).toBe(false);
    });
});

describe("Release-Test: geteilte Regeln", () => {
    it("🔴 geprüft wird der aktuelle Stage-Stand (WI-0248), sonst die jüngste Freigabe, sonst der frühere Auftrag", () => {
        const B = "b".repeat(40);
        const C = "c".repeat(40);
        const freigabe = {
            sha: C,
            zeit: "z",
            kennung: "RT-00000000-0000-4000-8000-000000000001",
            von: "Vali",
            zustand: "laeuft" as const,
            ausliefern: false,
            grund: "läuft",
        };
        expect(
            releaseTestCommit({
                stage: { sha: SHA, zeit: "z" },
                auftrag: { sha: B, zeit: "z", ops: "OPS-000001" },
                freigabe,
            }),
        ).toBe(SHA);
        expect(releaseTestCommit({ stage: null, auftrag: { sha: B, zeit: "z", ops: "OPS-000001" }, freigabe })).toBe(C);
        expect(releaseTestCommit({ stage: null, auftrag: { sha: B, zeit: "z", ops: "OPS-000001" } })).toBe(B);
        expect(releaseTestCommit({ stage: { sha: SHA, zeit: "z" }, auftrag: null })).toBe(SHA);
        expect(releaseTestCommit({ stage: null, auftrag: null })).toBeNull();
        expect(releaseTestCommit(null)).toBeNull();
    });

    it("beschäftigt ist, wer einen laufenden Test hat oder dessen Start das Testpaket baut", () => {
        expect(releaseTestBeschaeftigt(null)).toBe(false);
        expect(releaseTestBeschaeftigt(sicht() as ReleaseTestSicht)).toBe(true);
        expect(releaseTestBeschaeftigt(sicht({ lauf: { ...lauf, zustand: "gruen" } }) as ReleaseTestSicht)).toBe(false);
        expect(
            releaseTestBeschaeftigt(
                sicht({
                    lauf: null,
                    start: { commit: SHA, seit: "z", zustand: "baut", grund: null },
                }) as ReleaseTestSicht,
            ),
        ).toBe(true);
        expect(
            releaseTestBeschaeftigt(
                sicht({
                    lauf: null,
                    start: { commit: SHA, seit: "z", zustand: "fehler", grund: "x" },
                }) as ReleaseTestSicht,
            ),
        ).toBe(false);
    });

    it("jeder Fachcode hat einen Status: Zustände sind 409, Fehler des Starters 502, ein fehlender Starter 503", () => {
        expect(RELEASE_TEST_ERROR_STATUS).toEqual({
            release_test_unavailable: 503,
            release_test_stale: 409,
            release_test_laeuft: 409,
            release_test_gruen: 409,
            release_test_sperre: 409,
            release_test_kein_lauf: 409,
            release_test_kein_roter_lauf: 409,
            release_test_fehler: 502,
            release_test_freigabe: 503,
            release_test_kein_bericht: 404,
        });
    });
});
