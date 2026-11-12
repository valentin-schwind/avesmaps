import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    MAIL_ABRUF_ERGEBNISSE,
    MAIL_ABRUF_GRUENDE,
    MAIL_ABRUF_WARTEZEIT_MS,
    MAIL_ROUTINE_ARTEN,
    MAIL_VERSAND_ERGEBNISSE,
    MAIL_VERSAND_GRUENDE,
    MailRoutineBody,
    MailStand,
} from "../src/index.ts";

/**
 * Das Panel „Mailpostfach“ (WI-0268 C6c): Form des Stands und des Schalters. 🔴 Der Stand ist streng: Ein Feld für Nutzer, Kennwort oder Absenderadresse gibt es nicht, und eines, das ein Fehler dazugäbe,
 * fiele bei der Antwort durch (Fastify prüft die Antwort gegen dieses Schema).
 */

const routine = { aktiv: true, geaendertAt: null, geaendertVon: null };
const stand = () => ({
    abruf: {
        betrieb: "holt_ab",
        grund: null,
        wartenBis: null,
        zugang: "hinterlegt",
        server: "imap.example.invalid",
        ordner: "INBOX",
        routine,
        letzterLauf: null,
        letzterErfolg: null,
        startpunkt: { uidValidity: 1782729528, letzteUid: 275 },
        letzteMailAt: null,
    },
    versand: {
        betrieb: "sendet",
        grund: null,
        zugang: "hinterlegt",
        server: "smtp.example.invalid",
        routine,
        letzterLauf: null,
        letzterErfolg: null,
        wartend: 0,
        fehler7Tage: 0,
    },
});

describe("Panel Mailpostfach: Schema", () => {
    it("🔴 der Stand nimmt nur die benannten Felder; Nutzer, Kennwort und Adresse haben keinen Platz", () => {
        expect(Value.Check(MailStand, stand())).toBe(true);
        for (const feld of ["nutzer", "kennwort", "absender", "ablage"]) {
            const mit = stand();
            (mit.abruf as Record<string, unknown>)[feld] = "x";
            expect(Value.Check(MailStand, mit), feld).toBe(false);
            const versand = stand();
            (versand.versand as Record<string, unknown>)[feld] = "x";
            expect(Value.Check(MailStand, versand), feld).toBe(false);
        }
    });

    it("Läufe und Gründe kommen aus festen Listen; ein fremdes Wort fällt durch", () => {
        const mit = stand();
        (mit.abruf as Record<string, unknown>)["letzterLauf"] = { at: "2026-11-01T12:00:00.000Z", ergebnis: "gelesen" };
        expect(Value.Check(MailStand, mit)).toBe(true);
        (mit.abruf as Record<string, unknown>)["letzterLauf"] = {
            at: "2026-11-01T12:00:00.000Z",
            ergebnis: "gesendet",
        };
        expect(Value.Check(MailStand, mit)).toBe(false);
        const grund = stand();
        (grund.versand as Record<string, unknown>)["grund"] = "nicht_eingerichtet";
        expect(Value.Check(MailStand, grund)).toBe(false);
        expect(MAIL_ABRUF_GRUENDE).toContain("nicht_eingerichtet");
        expect(MAIL_VERSAND_GRUENDE).not.toContain("nicht_eingerichtet");
        // Die Wörter der Datenbankfunktion `community_mail_lauf` (Migration 0289).
        expect([...MAIL_ABRUF_ERGEBNISSE].sort()).toEqual(
            ["anmeldung_abgelehnt", "ausgeschaltet", "gelesen", "gestoert", "ordner_fehlt", "zugang_fehlt"].sort(),
        );
        expect([...MAIL_VERSAND_ERGEBNISSE].sort()).toEqual(
            [
                "adresse_abgelehnt",
                "anmeldung_abgelehnt",
                "gesendet",
                "gestoert",
                "zugang_fehlt",
                "zurueckgehalten",
            ].sort(),
        );
        expect(MAIL_ABRUF_WARTEZEIT_MS).toBe(6 * 3_600_000);
    });

    it("der Schalter nimmt Art und Zielzustand mit Kennung, sonst nichts", () => {
        const kennung = "5c0f4a2e-8b0a-4e53-9d58-6a4f1f3b2c11";
        expect(MAIL_ROUTINE_ARTEN).toEqual(["abruf", "versand"]);
        expect(Value.Check(MailRoutineBody, { operationId: kennung, art: "abruf", aktiv: false })).toBe(true);
        expect(Value.Check(MailRoutineBody, { operationId: kennung, art: "post", aktiv: false })).toBe(false);
        expect(Value.Check(MailRoutineBody, { operationId: kennung, art: "abruf" })).toBe(false);
        expect(Value.Check(MailRoutineBody, { operationId: kennung, art: "abruf", aktiv: false, nutzer: "x" })).toBe(
            false,
        );
        expect(Value.Check(MailRoutineBody, { art: "abruf", aktiv: false })).toBe(false);
    });
});
