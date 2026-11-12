import type { MediaUsageResult } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { freigabeSatz } from "../src/medien/medien-inspektor-modell.ts";

const nutzung = (role: string, reason: string, oeffentlich = true): MediaUsageResult =>
    ({ usages: [{ role, publication: { public: oeffentlich, reason } }] }) as unknown as MediaUsageResult;

describe("Bild der Kategorie „Social Media Posts“ im Inspektor (WI-0278)", () => {
    it("ist öffentlich, weil die Rechte bestätigt sind, nicht „ohne Prüfung“", () => {
        expect(freigabeSatz(nutzung("social_post", "automatic"))).toBe("Öffentlich: Rechte bestätigt.");
        expect(freigabeSatz(nutzung("social_post", "override_approved"))).toBe("Öffentlich: Rechte bestätigt.");
    });

    it("nicht öffentlich und jede andere Rolle behalten den Grund der Policy", () => {
        expect(freigabeSatz(nutzung("social_post", "unreviewed", false))).not.toContain("Rechte bestätigt");
        expect(freigabeSatz(nutzung("header", "automatic"))).toBe("Öffentlich: ohne Prüfung freigegeben.");
    });
});
