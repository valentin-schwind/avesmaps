import { describe, expect, it } from "vitest";
import type { MediaAssetDetail, MediaUsageResult } from "@avesmaps3d/shared";
import {
    NOTAUS_GRUND_MAX,
    aktiverNotausStand,
    notausGrundFehler,
    notausUmfang,
} from "../src/medien/medien-notaus-modell";

/**
 * Was das Blatt des Einzelbild-Notaus rechnet (WI-0068, Betreiber 2026-10-10). Der Punkt dieser Fälle: Die Bestätigung muss die
 * WIRKLICHE Reichweite nennen — der Notaus gilt den Bytes, also auch den anderen Werken mit derselben Datei. Wer nur „dieses Asset“
 * zählt, verspricht zu wenig und nimmt mehr offline, als er ankündigt.
 */

const verwendung = (teil: Partial<MediaUsageResult> = {}): MediaUsageResult =>
    ({ usages: [], sameFile: [], retired: 0, ...teil }) as unknown as MediaUsageResult;

const nutzung = (oeffentlich: boolean): unknown => ({ publication: { public: oeffentlich, reason: "rule" } });

describe("Was der Notaus trifft", () => {
    it("zählt die eigenen Verwendungen und davon die öffentlichen", () => {
        const u = notausUmfang(verwendung({ usages: [nutzung(true), nutzung(false), nutzung(true)] as never }));
        expect(u).toMatchObject({ verwendungen: 3, oeffentlich: 2, weitereWerke: 0, weitereVerwendungen: 0 });
    });

    it("🔴 zählt die Werke mit DERSELBEN Datei mit - sie verschwinden ebenfalls", () => {
        const u = notausUmfang(
            verwendung({
                usages: [nutzung(true)] as never,
                sameFile: [
                    { asset: { id: "a", title: null }, usages: [nutzung(true), nutzung(true)] },
                    { asset: { id: "b", title: null }, usages: [nutzung(false)] },
                ] as never,
            }),
        );
        expect(u).toMatchObject({ verwendungen: 1, oeffentlich: 1, weitereWerke: 2, weitereVerwendungen: 3 });
    });

    it("hält ein noch nicht geladenes Lesemodell aus", () => {
        expect(notausUmfang(undefined)).toEqual({
            verwendungen: 0,
            oeffentlich: 0,
            weitereWerke: 0,
            weitereVerwendungen: 0,
        });
    });
});

describe("Ob gerade ein Notaus gilt", () => {
    const detail = (suspensions: unknown[]): MediaAssetDetail => ({ suspensions }) as unknown as MediaAssetDetail;

    it("findet den aktiven Eintrag samt Revision für das Aufheben", () => {
        const stand = aktiverNotausStand(
            detail([
                { revision: 4, sha256: "a".repeat(64), liftedAt: null },
                { revision: 2, sha256: "b".repeat(64), liftedAt: "2026-10-01T00:00:00.000Z" },
            ]),
        );
        expect(stand).toEqual({ revision: 4, sha256: "a".repeat(64) });
    });

    it("🔴 ein aufgehobener Eintrag zählt nicht - sonst stünde „freigeben“ an einem freien Bild", () => {
        expect(
            aktiverNotausStand(detail([{ revision: 2, sha256: "b".repeat(64), liftedAt: "2026-10-01" }])),
        ).toBeUndefined();
        expect(aktiverNotausStand(detail([]))).toBeUndefined();
        expect(aktiverNotausStand(undefined)).toBeUndefined();
    });
});

describe("Der Pflichtgrund", () => {
    it("🔴 leer und nur Leerzeichen gehen nicht - der Grund steht später im Protokoll", () => {
        expect(notausGrundFehler("")).toBe("leer");
        expect(notausGrundFehler("   ")).toBe("leer");
        expect(notausGrundFehler("\n\t ")).toBe("leer");
    });

    it("ein Grund genügt, auch ein kurzer", () => {
        expect(notausGrundFehler("Rechte unklar")).toBeUndefined();
        expect(notausGrundFehler("  x  ")).toBeUndefined();
    });

    it("zu lang wird gemeldet, gemessen am getrimmten Text", () => {
        expect(notausGrundFehler("a".repeat(NOTAUS_GRUND_MAX))).toBeUndefined();
        expect(notausGrundFehler("a".repeat(NOTAUS_GRUND_MAX + 1))).toBe("zuLang");
        expect(notausGrundFehler(`  ${"a".repeat(NOTAUS_GRUND_MAX)}  `)).toBeUndefined();
    });
});
