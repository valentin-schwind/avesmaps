import { describe, expect, it } from "vitest";
import type { SocialZeile } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import {
    passtNicht,
    pruefungVon,
    socialAblehnung,
    sperrgrundAus,
    sperrSatzMitTun,
    tunSatz,
} from "../src/community/social-modell";
import { genauerGrund } from "../src/system/ablehnung";

/**
 * WI-0291 (Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“): Der Fachcode des Servers wird zu einem Satz in der Sprache der Oberfläche,
 * ein unbekannter Code zum Satz des Servers, und erst ohne jeden Satz bleibt der allgemeine des Fensters.
 */

const abgelehnt = (status: number, code: string, satz: string, details?: Record<string, unknown>): ApiFailure =>
    new ApiFailure(status, code, satz, details);

describe("genauerGrund", () => {
    const abbildung = {
        gruende: { zeitraum_verkehrt: () => "eigener Satz" },
        felder: { nachricht: (regel: string) => (regel === "maxLength" ? "Nachricht zu lang" : undefined) },
    };

    it("🔴 ein bekannter Fachcode gibt den eigenen Satz, auch bei 409 und 413", () => {
        expect(genauerGrund(abgelehnt(422, "x_invalid", "Deutsch.", { reason: "zeitraum_verkehrt" }), abbildung)).toBe(
            "eigener Satz",
        );
        expect(
            genauerGrund(abgelehnt(413, "x_too_large", "Deutsch.", { reason: "zeitraum_verkehrt" }), abbildung),
        ).toBe("eigener Satz");
    });

    it("🔴 ein unbekannter Code bei 400/422 gibt den Satz des Servers statt nichts (Rückfall, nur Deutsch)", () => {
        expect(genauerGrund(abgelehnt(422, "community_invalid", "Die Bildbeschreibung fehlt."), abbildung)).toBe(
            "Die Bildbeschreibung fehlt.",
        );
        expect(genauerGrund(abgelehnt(422, "community_invalid", "Neu.", { reason: "unbekannt" }), abbildung)).toBe(
            "Neu.",
        );
    });

    it("ein Übergang (409 …_transition) nennt seinen Zustand, ein Konflikt nicht", () => {
        expect(genauerGrund(abgelehnt(409, "community_transition", "die Meldung ist zurückgezogen"))).toBe(
            "die Meldung ist zurückgezogen",
        );
        expect(genauerGrund(abgelehnt(409, "community_conflict", "veraltet"))).toBeUndefined();
    });

    it("ein Schemafehler nennt das Feld, wenn das Fenster es kennt; sonst bleibt der allgemeine Satz", () => {
        const schema = (path: string, rule: string): ApiFailure =>
            abgelehnt(400, "validation_failed", "Die Anfrage ist unvollständig oder falsch geformt.", {
                issues: [{ path, rule }],
            });
        expect(genauerGrund(schema("body/nachricht", "maxLength"), abbildung)).toBe("Nachricht zu lang");
        expect(genauerGrund(schema("body/unbekannt", "maxLength"), abbildung)).toBeUndefined();
    });

    it("Netz, Drossel und Ausfall bekommen nie einen Satz von hier", () => {
        expect(genauerGrund(new ApiFailure(0, "network", "Keine Verbindung zum Server."))).toBeUndefined();
        expect(genauerGrund(abgelehnt(429, "community_rate", "Zu viele."))).toBeUndefined();
        expect(genauerGrund(abgelehnt(503, "community_unavailable", "Nicht eingerichtet."))).toBeUndefined();
        expect(genauerGrund(new Error("kaputt"))).toBeUndefined();
    });
});

describe("Social Hub: Fachcode der Zählung (S1, S2, S3)", () => {
    it("🔴 S1: der Sperrgrund des Servers wird derselbe Satz wie am gesperrten Knopf, mit dem, was zu tun ist", () => {
        const fehler = abgelehnt(422, "community_invalid", "Die Rechte des Bildes lassen keinen Beitrag zu.", {
            reason: "bild_nicht_geklaert",
            sperrgrund: { art: "bild_nicht_geklaert", grund: "moderation_pending" },
        });
        const satz = genauerGrund(fehler, socialAblehnung(true));
        expect(satz).toBe(sperrSatzMitTun({ art: "bild_nicht_geklaert", grund: "moderation_pending" }, true));
        expect(satz).toBe(
            "Das Bild geht nicht in einen Beitrag: Moderation offen. Das Bild in der Medienverwaltung moderieren oder ein anderes nehmen.",
        );
    });

    it("🔴 ein Bild der Kategorie „Social Media Posts“ mit offenen Rechten: „Rechte bestätigen“; jedes andere: die Medienverwaltung", () => {
        expect(tunSatz({ art: "bild_nicht_geklaert", grund: "clearance_pending" }, true)).toBe(
            "Beim Bild „Rechte bestätigen“ wählen oder ein anderes Bild nehmen.",
        );
        expect(tunSatz({ art: "bild_nicht_geklaert", grund: "clearance_pending" }, false)).toBe(
            "Die Rechte in der Medienverwaltung klären oder ein anderes Bild nehmen.",
        );
        expect(tunSatz({ art: "bild_nicht_geklaert", grund: "switched_off" })).toBe(
            "Ein anderes Bild nehmen oder den Inhaltsschalter in der Systemsteuerung lösen.",
        );
    });

    it("ein Sperrgrund in falscher Form wird nicht geraten: dann der Satz des Servers", () => {
        expect(sperrgrundAus({ sperrgrund: { art: "zu_lang", kanal: "mastodon", zuviel: "12", teil: "text" } })).toBe(
            undefined,
        );
        expect(sperrgrundAus({ sperrgrund: { art: "kanal_nicht_verbunden", kanal: "myspace" } })).toBeUndefined();
        const fehler = abgelehnt(422, "community_invalid", "Mastodon: 12 Zeichen zu viel.", {
            reason: "zu_lang",
            sperrgrund: { art: "zu_lang", kanal: "mastodon" },
        });
        expect(genauerGrund(fehler, socialAblehnung())).toBe("Mastodon: 12 Zeichen zu viel.");
        expect(sperrgrundAus({ sperrgrund: { art: "zu_lang", kanal: "mastodon", zuviel: 12, teil: "text" } })).toEqual({
            art: "zu_lang",
            kanal: "mastodon",
            zuviel: 12,
            teil: "text",
        });
    });

    it("die übrigen Codes des Hubs haben eigene Sätze", () => {
        expect(
            genauerGrund(
                abgelehnt(422, "community_invalid", "x", { reason: "kanal_ohne_zugang", kanal: "neuigkeiten" }),
                socialAblehnung(),
            ),
        ).toBe("Neuigkeiten wird nicht von hier zurückgenommen. Den Beitrag dort selbst entfernen.");
        expect(
            genauerGrund(abgelehnt(422, "community_invalid", "x", { reason: "hashtag_form" }), socialAblehnung()),
        ).toContain("Nach dem #");
    });

    it("🔴 S3: das ✓ der Liste kennt das Urteil über das Bild und sperrt mit demselben Satz wie der Server", () => {
        const zeile: Pick<
            SocialZeile,
            "titel" | "text" | "hashtags" | "bild" | "bildBeschreibung" | "kanaele" | "bildUrteil"
        > = {
            titel: "T",
            text: "Ein Text.",
            hashtags: [],
            bild: "33333333-3333-4333-8333-333333333333",
            bildBeschreibung: "Eine Karte.",
            kanaele: ["neuigkeiten"],
            bildUrteil: { erlaubt: false, grund: "clearance_pending", oeffentlich: true, social: true },
        };
        expect(passtNicht(pruefungVon(zeile), true)).toBe(
            sperrSatzMitTun({ art: "bild_nicht_geklaert", grund: "clearance_pending" }, true),
        );
        expect(
            passtNicht(pruefungVon({ ...zeile, bildUrteil: { ...zeile.bildUrteil!, erlaubt: true } })),
        ).toBeUndefined();
        // Ohne Urteil (älterer Server) zählt die Zeile wie bisher nur Text, Titel und Kanal.
        const ohneUrteil: typeof zeile = { ...zeile };
        delete ohneUrteil.bildUrteil;
        expect(passtNicht(pruefungVon(ohneUrteil))).toBeUndefined();
    });
});
