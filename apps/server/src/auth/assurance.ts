import { assuranceFor, type Capability } from "@avesmaps3d/shared";
import type { AuthConfig } from "./config.ts";
import type { SessionRecord } from "./session-store.ts";

/**
 * Sicherheitsstufen (AUTH-0001 §11.2, Betreiber 2026-10-09: D2 B′; Nachtrag 2026-10-10):
 * - R Redaktion: jede gültige Sitzung.
 * - V Verwaltung: Sitzung mit zweitem Faktor (`strong`) oder Notzugang, **für ihre ganze Laufzeit**. 🔴 Betreiber 2026-10-10:
 *   „ich will keine frist des 2. faktors. das is bescheuert.“ und „entweder ich bin angemeldet oder nicht (also 2 faktoren oder
 *   keiner)“. Die frühere Frische (Bestätigung ≤ 12 h, letzte Anfrage ≤ 60 min) ist damit abgelöst; die Sitzung selbst hat keine
 *   Laufzeit mehr (`session-store.ts`). 🔴 Der zweite Faktor ist allein der Passkey, gleich nach der Anmeldung (Passwort oder
 *   Discord) oder später als Bestätigung in der Sitzung (Betreiber 2026-10-10: „4. B“); Discord-2FA zählt nie
 *   (`effectiveAssurance`, `routes/auth-discord.ts`).
 * - S System: V und ein frischer Passkey-Nachweis (≤ 5 min) unmittelbar vor der Handlung, unverändert (WI-0119 E5: „Bestätigung
 *   nur im Moment“). Eine Discord-Sitzung genügt dafür nie.
 *
 * Zusätzlich kann eine Route eine Bestätigung verlangen: `recent` (≤ 15 min, Passkey oder Discord-Zustimmung) oder
 * `passkey` (≤ 5 min, nur Passkey).
 *
 * Lokal und auf der Stage gelten beide Fristen einen Tag lang, auch für die Release-Rechte (Vali 2026-11-07, `config.ts`
 * `sessionFristen`). Production bleibt wie oben.
 */
export type Confirmation = "recent" | "passkey";

export type AssuranceVerdict =
    | { ok: true }
    | { ok: false; code: "assurance_required" | "reauth_required"; need: "second_factor" | "confirmation" | "passkey" };

const MINUTE_MS = 60_000;

function within(moment: Date | null, minutes: number, now: Date): boolean {
    return moment !== null && now.getTime() - moment.getTime() <= minutes * MINUTE_MS;
}

export function checkAssurance(
    session: SessionRecord,
    capability: Capability,
    config: AuthConfig,
    confirmation: Confirmation | undefined,
    now: Date = new Date(),
): AssuranceVerdict {
    const level = assuranceFor(capability);
    if (level !== "r" && session.assurance === "basic") {
        return { ok: false, code: "assurance_required", need: "second_factor" };
    }
    if (level === "s" || confirmation === "passkey") {
        if (!within(session.passkeyConfirmedAt, config.session.systemStepUpMinutes, now)) {
            return { ok: false, code: "reauth_required", need: "passkey" };
        }
    }
    if (confirmation === "recent" && !within(session.confirmedAt, config.session.stepUpMinutes, now)) {
        return { ok: false, code: "reauth_required", need: "confirmation" };
    }
    return { ok: true };
}
