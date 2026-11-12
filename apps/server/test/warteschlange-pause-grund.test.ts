import { describe, expect, it } from "vitest";
import { WAIT_REASONS } from "@avesmaps3d/shared";
import { KEIN_UMSTAND, wartegrund, type Warteumstand } from "../src/jobs/wartegrund.ts";

/**
 * Der Wartegrund einer wartenden Zeile (WI-0160, `jobs/wartegrund.ts`): die EINE Stelle, die ihn ausrechnet, ohne Datenbank prüfbar.
 *
 * Problemfall, der das Paket ausgelöst hat: In Production läuft kein Planer, also schreibt niemand `job.wait_reason` — eine
 * wartende Zeile stand dort stumm da („in der warteschlange bei production [wird] nicht abgearbeitet, obwohl da neue aufträge drin
 * stehen“, Betreiber 2026-10-15). Soll: Jede wartende Zeile nennt einen Grund, und die Pause übersteuert jeden anderen.
 */

const umstand = (teile: Partial<Warteumstand> = {}): Warteumstand => ({ ...KEIN_UMSTAND, ...teile });
const zeile = (kind: string, waitReason: string | null = null) => ({ kind, state: "QUEUED", waitReason });

describe("Wartegrund einer wartenden Zeile (WI-0160)", () => {
    it("🔴 pausiert übersteuert jeden anderen Grund, auch einen geschriebenen", () => {
        const pausiert = umstand({ queuePaused: true, plannerActive: true, pickupKinds: new Set(["legacy_zug"]) });
        expect(wartegrund(zeile("terrain_full"), pausiert)).toBe("waits_queue_paused");
        // „Wartet auf Speicher“ wäre im pausierten Zustand eine Lüge: Es wartet auf das Fortsetzen.
        expect(wartegrund(zeile("terrain_full", "waits_memory"), pausiert)).toBe("waits_queue_paused");
        expect(wartegrund(zeile("legacy_zug", "waits_pickup"), pausiert)).toBe("waits_queue_paused");
    });

    it("der geschriebene Grund des Planers gilt vor jeder Ableitung", () => {
        const laufend = umstand({ plannerActive: true, runningKinds: new Set(["terrain_full"]) });
        expect(wartegrund(zeile("terrain_full", "waits_dependency"), laufend)).toBe("waits_dependency");
        expect(wartegrund(zeile("terrain_full", "waits_slot"), laufend)).toBe("waits_slot");
        // Auch ein Freitext aus dem Betrieb (ein aufgezeichneter Ablauf, WI-0143) bleibt stehen.
        expect(wartegrund(zeile("stage_rollout", "hinter Gelände voll: Fassung 17"), laufend)).toBe(
            "hinter Gelände voll: Fassung 17",
        );
    });

    it("🔴 ein laufender Auftrag derselben Art: Abholer wie Worker nehmen immer nur einen", () => {
        const laeuft = umstand({ pickupKinds: new Set(["legacy_zug"]), runningKinds: new Set(["legacy_zug"]) });
        expect(wartegrund(zeile("legacy_zug"), laeuft)).toBe("waits_running_kind");
        // Eine andere Art wartet nicht deswegen.
        expect(wartegrund(zeile("production_pull"), laeuft)).toBe("waits_no_worker");
    });

    it("🔴 eine Abholart wartet auf den Abholer, auch ohne Planer — genau der Fall in Production", () => {
        const production = umstand({ plannerActive: false, pickupKinds: new Set(["legacy_zug", "terrain_full"]) });
        expect(wartegrund(zeile("legacy_zug"), production)).toBe("waits_pickup");
        expect(wartegrund(zeile("terrain_full"), production)).toBe("waits_pickup");
    });

    it("🔴 eine Art, die hier niemand annimmt, sagt das — statt stumm zu warten", () => {
        const ohneWorker = umstand({ plannerActive: false });
        expect(wartegrund(zeile("media_settle"), ohneWorker)).toBe("waits_no_worker");
        // Läuft ein Planer, wartet die Zeile nur auf seinen nächsten Takt; das sagt die Oberfläche aus `null`.
        expect(wartegrund(zeile("media_settle"), umstand({ plannerActive: true }))).toBeNull();
    });

    it("eine Zeile, die nicht wartet, bekommt keinen Grund", () => {
        for (const state of ["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]) {
            expect(wartegrund({ kind: "legacy_zug", state, waitReason: "waits_pickup" }, umstand())).toBeNull();
        }
    });

    it("🔴 die drei abgeleiteten Gründe stehen im gemeinsamen Katalog: die Oberfläche kann sie übersetzen", () => {
        for (const grund of ["waits_queue_paused", "waits_running_kind", "waits_no_worker"]) {
            expect(WAIT_REASONS as readonly string[]).toContain(grund);
        }
    });
});
