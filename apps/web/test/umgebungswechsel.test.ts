import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    STAGE_MERKZEICHEN,
    sprungziel,
    stageGesehen,
    stageMerkzeichen,
    umgebungsEintraege,
    type UmgebungsEintrag,
} from "../src/auth/umgebungswechsel";

/**
 * Das Umgebungsmenü an der Pille (WI-0180). Die Regel steht hier und nicht im Browser, weil sie aus dem Hostnamen folgt: Auf
 * `localhost` gibt es den Stage- und den Production-Fall nicht, und ein Browsertest kann sie deshalb nicht zeigen.
 */
const ort = (hostname: string, pathname = "/edit", search = "", hash = "", host = hostname) => ({
    hostname,
    host,
    pathname,
    search,
    hash,
});
const kurz = (eintraege: UmgebungsEintrag[] | undefined) =>
    eintraege?.map((e) => `${e.umgebung}${e.aktuell ? "*" : ""}${e.gesperrt ? "!" : ""} ${e.ziel ?? e.host}`);

describe("🔴 Umgebungsmenü an der Pille", () => {
    it("🔴 Production und Stage führen aufeinander, mit Pfad, Parametern und Fragment", () => {
        const search = "?route=Gareth~Perricum&profil=schnellste";
        const hash = "#7.5/1234.5/-678.25/45/60&togglePaths=0";
        expect(kurz(umgebungsEintraege(true, "production", ort("avesmaps.de", "/edit", search, hash), true))).toEqual([
            `staging https://stage.avesmaps.de/edit${search}${hash}`,
            "production* avesmaps.de",
        ]);
        expect(kurz(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de", "/", search, hash), false))).toEqual([
            "staging* stage.avesmaps.de",
            `production https://avesmaps.de/${search}${hash}`,
        ]);
    });

    /** Betreiber 2026-10-16 zur Tafel: „die andern beiden sind für die betreiber sichtbar“ — auch von lokal aus. */
    it("🔴 lokal führt auf die öffentlichen Adressen; Lokal steht nur da, wo man gerade ist", () => {
        expect(
            kurz(
                umgebungsEintraege(
                    true,
                    "development",
                    ort("localhost", "/edit", "", "#5/1/2", "localhost:5173"),
                    false,
                ),
            ),
        ).toEqual([
            "development* localhost:5173",
            "staging https://stage.avesmaps.de/edit#5/1/2",
            "production https://avesmaps.de/edit#5/1/2",
        ]);
        // Lokal als Ziel kommt erst mit der Probierrunde „Umgebungen“ (WI-0180 §8): von Stage und Production aus fehlt es.
        expect(
            umgebungsEintraege(true, "staging", ort("stage.avesmaps.de"), true)?.map((e) => e.umgebung),
        ).not.toContain("development");
    });

    it("🔴 nur mit dem Recht; sonst bleibt die Pille eine Angabe", () => {
        expect(umgebungsEintraege(false, "production", ort("avesmaps.de"), true)).toBeUndefined();
        expect(umgebungsEintraege(false, "development", ort("localhost"), true)).toBeUndefined();
    });

    it("🔴 rät keine Adresse, die es nicht gibt", () => {
        expect(umgebungsEintraege(true, "staging", ort("localhost"), true)).toBeUndefined();
        expect(umgebungsEintraege(true, "staging", ort("100.102.26.41"), true)).toBeUndefined();
        expect(umgebungsEintraege(true, "production", ort(""), true)).toBeUndefined();
        expect(umgebungsEintraege(true, "test", ort("localhost"), true)).toBeUndefined();
        expect(umgebungsEintraege(true, null, ort("avesmaps.de"), true)).toBeUndefined();
        // Stünde `production` fälschlich an einer stage.-Adresse, entstünde sonst `stage.stage.avesmaps.de`.
        expect(umgebungsEintraege(true, "production", ort("stage.avesmaps.de"), true)).toBeUndefined();
    });

    /** Betreiber 2026-10-16: „die adresse von lokalhost bestimmt, ob das obere angezeigt wird“ (WI-0180 §8, §11). */
    it("🔴 Lokal steht oben, sobald das Menü eine Adresse bekommt, mit Pfad und Fragment; nur über HTTPS", () => {
        const lokal = { adresse: "https://rechner.tailnet.ts.net:8443" };
        expect(
            kurz(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de", "/edit", "", "#5/1/2"), true, lokal)),
        ).toEqual([
            "development https://rechner.tailnet.ts.net:8443/edit#5/1/2",
            "staging* stage.avesmaps.de",
            "production https://avesmaps.de/edit#5/1/2",
        ]);
        // Zwei Ziele: Die Pille springt nicht mehr, sie öffnet die Tafel.
        expect(sprungziel(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de"), true, lokal)!)).toBeUndefined();
        // Ohne Adresse (nicht erreichbar oder nicht eingetragen) bleibt es beim Sprung.
        expect(
            sprungziel(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de"), true, undefined)!)?.umgebung,
        ).toBe("production");
        // Eine http-Adresse oder eine mit Pfad nimmt das Menü nicht: Aus einer https-Seite blockt der Browser sie ohnehin.
        for (const adresse of ["http://100.102.26.41:5174", "https://rechner.tailnet.ts.net/x", "kaputt"])
            expect(umgebungsEintraege(true, "production", ort("avesmaps.de"), true, { adresse })?.length, adresse).toBe(
                2,
            );
        // Lokal selbst braucht keine Adresse: Dort ist Lokal die aktuelle Umgebung.
        expect(
            kurz(
                umgebungsEintraege(true, "development", ort("localhost", "/", "", "", "localhost:5173"), true, lokal),
            )?.[0],
        ).toBe("development* localhost:5173");
    });

    /** Betreiber 2026-10-16: „und nutzer, die noch nie auf stage eingeloggt waren, sehen stage deaktiviert“ (gewählt „Je Browser“). */
    it("🔴 sperrt Stage auf Production, solange dieser Browser dort nie angemeldet war; lokal nie", () => {
        expect(kurz(umgebungsEintraege(true, "production", ort("avesmaps.de"), false))).toEqual([
            "staging! https://stage.avesmaps.de/edit",
            "production* avesmaps.de",
        ]);
        expect(umgebungsEintraege(true, "development", ort("localhost"), false)?.some((e) => e.gesperrt)).toBe(false);
        expect(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de"), false)?.some((e) => e.gesperrt)).toBe(
            false,
        );
    });

    /** Betreiber 2026-10-16 zur Probierseite: „bei zwei zielen: springt direkt“. */
    it("🔴 springt direkt bei genau einem freien Ziel; ist es gesperrt oder gibt es zwei, öffnet die Tafel", () => {
        expect(sprungziel(umgebungsEintraege(true, "staging", ort("stage.avesmaps.de"), false)!)?.ziel).toBe(
            "https://avesmaps.de/edit",
        );
        expect(sprungziel(umgebungsEintraege(true, "production", ort("avesmaps.de"), true)!)?.umgebung).toBe("staging");
        expect(sprungziel(umgebungsEintraege(true, "production", ort("avesmaps.de"), false)!)).toBeUndefined();
        expect(sprungziel(umgebungsEintraege(true, "development", ort("localhost"), true)!)).toBeUndefined();
    });

    it("🔴 das Merkzeichen setzt nur die Stage, für die Eltern-Domain, mit Ablauf statt Sitzungsende", () => {
        expect(stageMerkzeichen("staging", "stage.avesmaps.de", true)).toBe(
            `${STAGE_MERKZEICHEN}=1; Domain=avesmaps.de; Path=/; Max-Age=34560000; Secure; SameSite=Lax`,
        );
        // Wer kein Betreiber ist, behält es nicht: Derselbe Satz mit Ablauf 0 räumt es ab.
        expect(stageMerkzeichen("staging", "stage.avesmaps.de", false)).toBe(
            `${STAGE_MERKZEICHEN}=1; Domain=avesmaps.de; Path=/; Max-Age=0; Secure; SameSite=Lax`,
        );
        expect(stageMerkzeichen("production", "avesmaps.de", true)).toBeUndefined();
        expect(stageMerkzeichen("staging", "localhost", true)).toBeUndefined();
        expect(stageMerkzeichen("development", "localhost", true)).toBeUndefined();
        // Production liest es; ein ähnlicher Name oder ein anderer Wert zählt nicht.
        expect(stageGesehen(`foo=1; ${STAGE_MERKZEICHEN}=1; bar=2`)).toBe(true);
        expect(stageGesehen(`${STAGE_MERKZEICHEN}=0`)).toBe(false);
        expect(stageGesehen(`x${STAGE_MERKZEICHEN}=1`)).toBe(false);
        expect(stageGesehen("")).toBe(false);
    });

    /**
     * 💣 Die Zusicherung, die man beim Aufräumen verliert: Die Adresse ist kein reaktiver Wert, und ihr Fragment wandert mit jedem
     * Kartenzug (`map/view-state.ts`). Das Menü liest sie deshalb neu, sobald `frisch` sich ändert — beim Öffnen und beim Zeigen,
     * Fokussieren oder Drücken der Sprungpille. Ohne diesen Anstoß trüge der Link den Ausschnitt vom ersten Zeichnen.
     */
    it("💣 das Menü liest die Adresse bei jedem Anstoß neu", () => {
        const quelle = readFileSync(
            join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src/auth/umgebungs-menue.vue"),
            "utf8",
        ).replace(/\/\*[\s\S]*?\*\//g, "");
        const block = /const eintraege = computed<[^>]*>\(\(\) => \{([\s\S]*?)\n\}\);/.exec(quelle)?.[1];
        expect(block).toContain("frisch.value");
        expect(block).toContain("globalThis.location");
        for (const ereignis of ["@pointerenter", "@pointerdown", "@focus"])
            expect(quelle).toContain(`${ereignis}="auffrischen"`);
    });

    it("der alte ☰-Eintrag ist fort, das Hauptmenü kennt keinen Umgebungswechsel mehr", () => {
        const wurzel = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");
        expect(readFileSync(join(wurzel, "auth/konto-menue.vue"), "utf8")).not.toMatch(/umgebungswechsel/i);
        expect(readFileSync(join(wurzel, "auth/app-kopfleiste.vue"), "utf8")).not.toContain("umgebungswechselZiel");
    });
});
