import { describe, expect, it } from "vitest";
import { AUDIT_DETAIL_KEYS } from "../../server/src/auth/audit.ts";
import { de } from "../src/i18n/de.ts";

/**
 * 💣 **Jede Handlung im Protokoll braucht einen Titel** (Betreiber 2026-10-16: „bezeichner sind nicht aufgelöst“).
 *
 * `label("admin.event", …)` fällt auf den Rohwert zurück, wenn der Schlüssel fehlt — dann steht im Protokoll
 * `system.production_release` statt „Nach Production freigegeben“. Genau das war am 2026-10-16 bei vier Handlungen der
 * Fall: die zwei Neuigkeiten (WI-0139) und die zwei der Production-Freigabe (FREIGABE-0001). Sie kamen später dazu als
 * die Sprachtafel, und nichts hat es gemerkt.
 *
 * 🔴 Die übrigen sechs Sprachtafeln hält der Typcheck gleich (`Record<MessageKey, string>`); hier zählt, dass die
 * SERVERSEITIGE Liste der Handlungen und die deutsche Tafel zusammenpassen.
 */
describe("Protokoll: jede Handlung hat einen Titel", () => {
    const aktionen = Object.keys(AUDIT_DETAIL_KEYS);

    it("die Liste der Handlungen ist nicht leer — sonst prüft dieser Test nichts", () => {
        expect(aktionen.length).toBeGreaterThan(40);
    });

    it("🔴 keine Handlung ohne `admin.event.<handlung>`", () => {
        const ohneTitel = aktionen.filter((aktion) => de[`admin.event.${aktion}` as keyof typeof de] === undefined);
        expect(ohneTitel).toEqual([]);
    });

    it("💣 eine erfundene Handlung fiele auf — der Wächter kann rot werden", () => {
        expect(de["admin.event.system.gibt_es_nicht" as keyof typeof de]).toBeUndefined();
    });
});
