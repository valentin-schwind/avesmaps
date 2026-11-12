import { afterEach, describe, expect, it } from "vitest";
import { BENACHRICHTIGUNG_ARTEN, COMMUNITY_GLOCKEN_ARTEN, type Benachrichtigung } from "@avesmaps3d/shared";
import { absender, absenderRolle, istCommunityArt, satzTeile } from "../src/auth/benachrichtigungen.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { setLocale } from "../src/i18n/i18n.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { PLURAL_FORMS, type Locale } from "../src/i18n/plural.ts";
import { sv } from "../src/i18n/sv.ts";

/**
 * Die Glocke zeigt die Meldungen der Community (WI-0268 C5; Bedienkonzept WI-0263 §2.2 Nr. 1, §2.3 Nr. 3 und 4): Sätze aus Art und COM-Nummer, nie aus dem
 * Text des Melders; die Nummer ist der Link, die gebündelte „3 neue Meldungen“ führt in die Liste. Die Anrede (kein Du, Sie, „you“, „please“) hält
 * `ui-anrede.test.ts` für alle Schlüssel; hier steht, dass jede Art in jeder der neun Sprachen einen Satz hat.
 */
const basis: Benachrichtigung = {
    id: 31,
    art: "community_neu",
    von: { art: "system", id: null, name: null },
    ops: null,
    text: "COM-000123",
    frageGeloest: false,
    erstelltAt: "2026-10-31T09:00:00.000Z",
    gelesenAt: null,
    beantwortetAt: null,
    antwort: null,
    vorgang: null,
};
const mit = (patch: Partial<Benachrichtigung>): Benachrichtigung => ({ ...basis, ...patch });
const tafeln = { de, en, da, es, fr, it: itTafel, nl, pl, sv } as const satisfies Record<
    Locale,
    Record<string, string>
>;

afterEach(async () => {
    await setLocale("de");
});

describe("Glocke: die Meldungen der Community", () => {
    it("alle vier Arten stehen im Katalog der Glocke und werden als Community erkannt", () => {
        for (const art of COMMUNITY_GLOCKEN_ARTEN) {
            expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
            expect(istCommunityArt(art)).toBe(true);
        }
        expect(istCommunityArt("kanal_antwort")).toBe(false);
    });

    it("🔴 neue Meldung: „Neue Meldung COM-…“, die Nummer ist der Link", () => {
        expect(satzTeile(basis)).toEqual({
            vor: "Neue Meldung ",
            ops: null,
            nach: ".",
            com: { text: "COM-000123", nummer: "COM-000123" },
        });
    });

    it("🔴 neue Anfrage (WI-0268 C4): „Neue Nachricht COM-…“ aus Art und Nummer, nie aus dem Inhalt; die Nummer ist der Link, nie gebündelt", () => {
        const nachricht = mit({ art: "community_nachricht", text: "COM-000124" });
        expect(satzTeile(nachricht)).toEqual({
            vor: "Neue Nachricht ",
            ops: null,
            nach: ".",
            com: { text: "COM-000124", nummer: "COM-000124" },
        });
        // Eine Zahl im Text ist hier keine Bündelung (Anfragen tragen immer ihre Nummer), und was keine Nummer ist, wird nicht gezeigt.
        expect(satzTeile(mit({ art: "community_nachricht", text: "3" })).com).toBeUndefined();
        expect(JSON.stringify(satzTeile(mit({ art: "community_nachricht", text: "Geheimer Inhalt" })))).not.toContain(
            "Geheimer",
        );
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            expect(tafel["notify.text.community_nachricht"], sprache).toContain("{text}");
        }
    });

    it("🔴 gebündelt: „3 neue Meldungen“ als Ganzes ein Link in die Liste, ohne Nummer", () => {
        expect(satzTeile(mit({ text: "3" }))).toEqual({
            vor: "",
            ops: null,
            nach: ".",
            com: { text: "3 neue Meldungen", nummer: null },
        });
        expect(satzTeile(mit({ text: "12" })).com?.text).toBe("12 neue Meldungen");
    });

    it("Zuweisung, Antwort und Frist nennen die Nummer; die Zuweisung den, der sie vornahm", () => {
        const adrian = { art: "person", id: "p-1", name: "Adrian" } as const;
        const zugewiesen = satzTeile(mit({ art: "community_zugewiesen", von: adrian }));
        // Derselbe Satzbau wie bei den Sonderrollen (WI-0279), ohne Anrede.
        expect(zugewiesen).toEqual({
            vor: "Eine neue Meldung, zugewiesen von Adrian: ",
            ops: null,
            nach: ".",
            com: { text: "COM-000123", nummer: "COM-000123" },
        });
        expect(satzTeile(mit({ art: "community_zugewiesen", von: { art: "person", id: "p-1", name: null } })).vor).toBe(
            "Eine neue Meldung, zugewiesen von Ehemalige Person: ",
        );
        expect(satzTeile(mit({ art: "community_antwort" }))).toEqual({
            vor: "",
            ops: null,
            nach: ": Antwort des Melders.",
            com: { text: "COM-000123", nummer: "COM-000123" },
        });
        expect(satzTeile(mit({ art: "community_frist" }))).toEqual({
            vor: "",
            ops: null,
            nach: " wartet seit 30 Tagen.",
            com: { text: "COM-000123", nummer: "COM-000123" },
        });
    });

    it("🔴 Sonderrolle (WI-0279): eine Nummer führt in die Meldung, mehrere in die Liste; beim Eingang heißt der Absender Avesmaps", () => {
        const vali = { art: "person", id: "p-1", name: "Vali" } as const;
        expect(satzTeile(mit({ art: "community_rolle", von: vali, text: "derograph COM-000072" }))).toEqual({
            vor: "Eine neue Meldung für Derograph, zugewiesen von Vali: ",
            ops: null,
            nach: ".",
            com: { text: "COM-000072", nummer: "COM-000072" },
        });
        const system = { art: "system", id: null, name: null } as const;
        const viele = mit({ art: "community_rolle", von: system, text: "topograph COM-000072 COM-000075" });
        expect(satzTeile(viele)).toEqual({
            vor: "2 neue Meldungen für Topograph, zugewiesen von Avesmaps: ",
            ops: null,
            nach: ".",
            com: { text: "COM-000072, COM-000075", nummer: null },
        });
        expect(absender(viele)).toBe("Avesmaps");
        expect(absenderRolle(viele)).toBe("beim Eingang");
        // Gezählt über das, was in den Text passt: die Zahl gilt, die Nummern enden mit …
        expect(satzTeile(mit({ art: "community_rolle", von: vali, text: "odologe #40 COM-000072" })).com).toEqual({
            text: "COM-000072 …",
            nummer: null,
        });
        // Das System anderer Arten bleibt „System“.
        expect(absender(mit({ art: "community_frist", von: system }))).toBe("System");
    });

    it("🔴 nie ein Text des Melders: Was im text keine COM-Nummer (oder bei der Bündelung Zahl) ist, wird nicht gezeigt und nicht verlinkt", () => {
        const fremd = "Wehrheim liegt zu weit im Westen";
        for (const art of COMMUNITY_GLOCKEN_ARTEN) {
            const teile = satzTeile(mit({ art, text: fremd }));
            expect(JSON.stringify(teile), art).not.toContain("Wehrheim");
            expect(teile.com, art).toBeUndefined();
        }
        expect(satzTeile(mit({ text: null })).com).toBeUndefined();
        // Eine Zahl ist nur bei community_neu eine Anzahl; sonst ist sie keine Nummer.
        expect(satzTeile(mit({ art: "community_frist", text: "3" })).com).toBeUndefined();
    });

    it("🔴 jede Art hat in jeder der neun Sprachen einen Satz, die gebündelte in jeder Zählform ihrer Sprache", () => {
        for (const [sprache, tafel] of Object.entries(tafeln) as [Locale, Record<string, string>][]) {
            for (const art of COMMUNITY_GLOCKEN_ARTEN)
                expect(tafel[`notify.text.${art}`], `${sprache} ${art}`).toBeTruthy();
            for (const form of PLURAL_FORMS[sprache])
                expect(tafel[`notify.text.community_neuViele.${form}`], `${sprache} ${form}`).toContain("{n}");
            // Der Satz trägt die Nummer ({text}); nur die Zuweisung nennt außerdem, wer sie vornahm.
            for (const art of ["community_neu", "community_zugewiesen", "community_antwort", "community_frist"])
                expect(tafel[`notify.text.${art}`], `${sprache} ${art}`).toContain("{text}");
            expect(tafel["notify.text.community_zugewiesen"], sprache).toContain("{wer}");
        }
    });

    it("die Zählform wählt die Sprache: Polnisch unterscheidet 2 und 5, Englisch kennt zwei Formen", async () => {
        await setLocale("pl");
        expect(satzTeile(mit({ text: "2" })).com?.text).toBe("2 nowe zgłoszenia");
        expect(satzTeile(mit({ text: "5" })).com?.text).toBe("5 nowych zgłoszeń");
        expect(satzTeile(mit({ text: "22" })).com?.text).toBe("22 nowe zgłoszenia");
        await setLocale("en");
        expect(satzTeile(mit({ text: "3" })).com?.text).toBe("3 new reports");
        expect(satzTeile(mit({ text: "COM-000123" }))).toMatchObject({ vor: "New report ", nach: "." });
    });
});
