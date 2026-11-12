import { COMMUNITY_GRENZEN } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/auth/api";
import { t } from "../src/i18n/i18n";
import {
    erneutSendenGrund,
    leereNeueMail,
    neueMailSperrSatz,
    weiterfuehrenSperrSatz,
    neuerWeiterfuehrenEntwurf,
} from "../src/community/mails-modell";
import { abschlussSperrSatz, neuerAbschluss, wiedereroeffnenSperrSatz } from "../src/community/meldungen-modell";
import { REDAKTION_FEHLER_SATZ } from "../src/community/redaktion-api";
import {
    codepunkte,
    istMailwegAus,
    redaktionGrund,
    redaktionSatz,
    zuLangSatz,
} from "../src/community/redaktion-ablehnung";

/**
 * Genaue Gründe in den Redaktionsfenstern (WI-0291): Fachcode des Servers → Satz, Konflikt mit Hinweis auf das Neuladen, Rückfälle, und die Vorabprüfung neben dem Knopf (Codepunkte statt UTF-16).
 * Erwartet wird über `t(key, params)`, nicht über den deutschen Wortlaut.
 */

const K = "community.redaktion.ablehnung.";
const fehler = (status: number, code: string, details?: Record<string, unknown>, satz = "Satz des Servers.") =>
    new ApiFailure(status, code, satz, details);

describe("Redaktion: der genaue Grund eines Fehlers", () => {
    it("ein Fachcode der Datenbank sagt seinen eigenen Satz, nicht den Sammelsatz", () => {
        expect(redaktionGrund(fehler(422, "community_invalid", { reason: "begruendung_fehlt" }))).toBe(
            t(`${K}begruendungFehlt` as never),
        );
        expect(redaktionSatz(fehler(422, "community_invalid", { reason: "oeffnen_grund_fehlt" }))).toBe(
            t(`${K}oeffnenGrundFehlt` as never),
        );
    });

    it("eine Dublette, die es nicht gibt, nennt den ANDEREN Vorgang mit seiner Nummer (404)", () => {
        const f = fehler(404, "community_not_found", { reason: "dublette_unbekannt", nummer: "COM-000999" });
        expect(redaktionSatz(f)).toBe(t(`${K}dubletteUnbekannt` as never, { nummer: "COM-000999" }));
    });

    it("zuständig, Nummer des anderen Vorgangs und Mailweg haben ihren Satz; der Mailweg wird als aus erkannt", () => {
        expect(
            redaktionSatz(fehler(422, "community_invalid", { reason: "zustaendig_unmoeglich", anfrage: true })),
        ).toBe(t(`${K}zustaendigAnfrage` as never));
        expect(
            redaktionSatz(fehler(422, "community_invalid", { reason: "zustaendig_unmoeglich", anfrage: false })),
        ).toBe(t(`${K}zustaendigMeldung` as never));
        expect(redaktionSatz(fehler(422, "community_invalid", { reason: "dublette_nummer_ungueltig" }))).toBe(
            t(`${K}dubletteNummer` as never),
        );
        const aus = fehler(409, "community_transition", { reason: "mailweg_aus" });
        expect(redaktionSatz(aus)).toBe(t(`${K}neuGeladen` as never, { grund: t(`${K}mailwegAus` as never) }));
        expect(istMailwegAus(aus)).toBe(true);
        expect(istMailwegAus(fehler(409, "community_transition"))).toBe(false);
    });

    it("Konflikt und Übergang bleiben beim Neuladen, der Satz sagt den genauen Grund dazu", () => {
        const konflikt = fehler(409, "community_conflict", { reason: "vorgang_geaendert" });
        expect(redaktionSatz(konflikt)).toBe(
            t(`${K}neuGeladenKonflikt` as never, { grund: t(`${K}vorgangGeaendert` as never) }),
        );
        const uebergang = fehler(409, "community_transition", { reason: "nicht_abgeschlossen" });
        expect(redaktionSatz(uebergang)).toBe(
            t(`${K}neuGeladen` as never, { grund: t(`${K}nichtAbgeschlossen` as never) }),
        );
        // Ohne Grund bleibt der alte Satz zur Fehlerart.
        expect(redaktionSatz(fehler(409, "community_conflict"))).toBe(t("community.redaktion.fehler.konflikt"));
    });

    it("Besucher-Codes in der Redaktion: schon abgeschlossen und Grund wählen", () => {
        expect(redaktionSatz(fehler(409, "community_transition", { reason: "vorgang_abgeschlossen" }))).toBe(
            t(`${K}neuGeladen` as never, { grund: t(`${K}schonAbgeschlossen` as never) }),
        );
        expect(redaktionSatz(fehler(422, "community_invalid", { reason: "grund_fehlt" }))).toBe(
            t(`${K}bewertungGrundFehlt` as never),
        );
    });

    it("das fehlende Recht (403) sagt welches; ein unbekanntes Recht bleibt beim allgemeinen Satz", () => {
        expect(
            redaktionSatz(fehler(403, "community_forbidden", { reason: "recht_fehlt", recht: "moderate_community" })),
        ).toBe(t(`${K}rechtModerieren` as never));
        expect(redaktionSatz(fehler(403, "community_forbidden", { reason: "recht_fehlt", recht: "unbekannt" }))).toBe(
            t(REDAKTION_FEHLER_SATZ.verboten),
        );
    });

    it("Rückfälle: unbekannter Code bei 422 zeigt den Satz des Servers; der Sammelsatz nennt keine Besucherfelder mehr", () => {
        expect(redaktionSatz(fehler(422, "community_invalid", { reason: "ganz_neu" }, "Neuer Satz."))).toBe(
            "Neuer Satz.",
        );
        expect(REDAKTION_FEHLER_SATZ.ungueltig).toBe("community.redaktion.ablehnung.ungueltig");
        expect(redaktionSatz(fehler(404, "community_not_found"))).toBe(t("community.redaktion.fehler.nichtGefunden"));
    });

    it("ein Schemafehler nennt das Feld mit der Grenze des Fensters", () => {
        const schema = (pfad: string, rule: string) =>
            fehler(400, "validation_failed", { issues: [{ path: pfad, rule }] }, "Ungültig.");
        expect(redaktionGrund(schema("body/begruendung", "maxLength"))).toBe(
            t(`${K}feldZuLang` as never, {
                feld: t(`${K}feldBegruendung` as never),
                max: COMMUNITY_GRENZEN.begruendungMax,
            }),
        );
        expect(redaktionGrund(schema("body/text", "maxLength"), { textMax: COMMUNITY_GRENZEN.textMax })).toBe(
            t(`${K}feldZuLang` as never, { feld: t(`${K}feldText` as never), max: COMMUNITY_GRENZEN.textMax }),
        );
    });
});

describe("Redaktion: Vorabprüfung neben dem Knopf", () => {
    it("zählt in Codepunkten wie der Server: 2000 Emoji passen, 2001 sind eins zu viel", () => {
        expect(codepunkte("😀")).toBe(1);
        expect(zuLangSatz("begruendung", "😀".repeat(2000), 2000)).toBeUndefined();
        expect(zuLangSatz("begruendung", "😀".repeat(2001), 2000)).toBe(
            t(`${K}zuLangBegruendung` as never, { n: 1, max: 2000 }),
        );
    });

    it("Abschließen: Begründung und Nachricht haben die Grenzen des Schemas", () => {
        const start = neuerAbschluss("meldung", ["abgelehnt"], ["statusseite"]);
        const ok = { ...start, begruendung: "Passt nicht.", nachricht: "Danke." };
        expect(abschlussSperrSatz(ok, "COM-000001")).toBeUndefined();
        expect(abschlussSperrSatz({ ...ok, begruendung: "x".repeat(2001) }, "COM-000001")).toBe(
            t(`${K}zuLangBegruendung` as never, { n: 1, max: COMMUNITY_GRENZEN.begruendungMax }),
        );
        expect(abschlussSperrSatz({ ...ok, nachricht: "x".repeat(4005) }, "COM-000001")).toBe(
            t(`${K}zuLangNachricht` as never, { n: 5, max: COMMUNITY_GRENZEN.nachrichtMax }),
        );
        // Ohne Nachricht an den Melder zählt ihr Text nicht.
        expect(
            abschlussSperrSatz({ ...ok, nachrichtSenden: false, nachricht: "x".repeat(5000) }, "COM-000001"),
        ).toBeUndefined();
    });

    it("Wiedereröffnen: der Grund fehlt oder ist zu lang", () => {
        expect(wiedereroeffnenSperrSatz("  ")).toBe(t("community.redaktion.grund.grundFehlt"));
        expect(wiedereroeffnenSperrSatz("x".repeat(2002))).toBe(
            t(`${K}zuLangGrund` as never, { n: 2, max: COMMUNITY_GRENZEN.begruendungMax }),
        );
        expect(wiedereroeffnenSperrSatz("Doch noch offen.")).toBeUndefined();
    });

    it("Erneut senden wird ohne Mailweg nicht angeboten und sagt warum", () => {
        const rechte = ["answer_community"];
        expect(erneutSendenGrund(rechte, false, true)).toBeUndefined();
        expect(erneutSendenGrund(rechte, false, false)).toBe(t(`${K}erneutMailweg` as never));
        expect(erneutSendenGrund([], false, true)).toBe(t("community.mails.grund.antwortRecht"));
        expect(erneutSendenGrund(rechte, true, true)).toBe(t("community.redaktion.grund.imPapierkorb"));
    });

    it("Neue Mail: Text und Betreff über der Grenze sperren mit Zahl statt stillem Abschneiden", () => {
        const e = { an: "alrike@example.org", betreff: "Hallo", text: "Guten Tag." };
        expect(neueMailSperrSatz(e, ["send_new_mail"], true)).toBeUndefined();
        expect(neueMailSperrSatz({ ...e, text: "x".repeat(4003) }, ["send_new_mail"], true)).toBe(
            t(`${K}zuLangText` as never, { n: 3, max: COMMUNITY_GRENZEN.nachrichtMax }),
        );
        expect(neueMailSperrSatz({ ...e, betreff: "b".repeat(151) }, ["send_new_mail"], true)).toBe(
            t(`${K}zuLangBetreff` as never, { n: 1, max: COMMUNITY_GRENZEN.betreffNeuMax }),
        );
        expect(neueMailSperrSatz(leereNeueMail(), ["send_new_mail"], true)).toBe(t("community.mails.neu.grund.an"));
    });

    it("Als Meldung weiterführen: die Grenze steht mit Zahl im Satz, nicht als wörtliches {max}", () => {
        const entwurf = {
            ...neuerWeiterfuehrenEntwurf(""),
            kategorie: "sonstiges" as const,
            bezug: { art: "stelle" as const, lage: { x: 1, y: 2 } },
        };
        const lang = weiterfuehrenSperrSatz({ ...entwurf, text: "x".repeat(2001) }, ["answer_community"]);
        expect(lang).toBe(t("community.sperre.textLang", { max: COMMUNITY_GRENZEN.textMax }));
        expect(lang).not.toContain("{max}");
        expect(weiterfuehrenSperrSatz({ ...entwurf, text: "x".repeat(20), quelle: "q".repeat(1001) }, [])).toBe(
            t(`${K}zuLangQuelle` as never, { n: 1, max: COMMUNITY_GRENZEN.quelleMax }),
        );
    });
});
