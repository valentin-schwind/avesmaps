import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_NOTICES } from "@avesmaps3d/shared";

/**
 * Die Fristen im Datenschutztext der Reisebilder sind die der Datenbank (WI-0272 §15, wie `auth-privacy-text.test.ts` für die Anmeldung):
 * `photobox_aufbewahren` (Migration 0284) löscht nach genau diesen Fristen. Wer eine davon ändert, kommt hier vorbei, und der Text geht mit der Änderung zur Abnahme an den Betreiber.
 */
describe("Datenschutz: Reisebilder, Fristen wie in `photobox_aufbewahren()` (Migration 0284)", () => {
    const sql = readFileSync(new URL("../migrations/0284_photobox_folge.sql", import.meta.url), "utf8");
    const tage = (muster: RegExp): string => muster.exec(sql)?.[1] ?? "fehlt";
    const verfall = tage(/state_changed_at < p_jetzt - interval '(\d+) days';/u);
    const loeschung = tage(/state_changed_at < p_jetzt - interval '(\d+) days' AS abgelaufen/u);
    const beendet = tage(
        /s\.state IN \('rejected', 'withdrawn', 'expired'\) AND s\.state_changed_at < p_jetzt - interval '(\d+) days'/u,
    );

    it("🔴 unentschiedene verfallen nach 60 Tagen, beendete werden 30 Tage danach gelöscht, abgelehnte und zurückgezogene nach 30 Tagen", () => {
        expect(verfall).toBe("60");
        expect(loeschung).toBe("30");
        expect(beendet).toBe("30");
        const deutsch = JSON.stringify(LEGAL_NOTICES.hinweise).replaceAll("**", "").replaceAll(" ", " ");
        expect(deutsch).toContain(`nach ${beendet} Tagen`);
        expect(deutsch).toContain(
            `unentschiedene verfallen nach ${verfall} Tagen und werden ${loeschung} Tage danach gelöscht`,
        );
    });
});
