import { argon2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ARGON2_PARAMETERS, hashPassword, parseHash, verifyPassword } from "../src/auth/password-hash.ts";
import { checkPassword } from "../src/auth/password-policy.ts";
import { waitSeconds } from "../src/auth/throttle.ts";

/** Passwörter ohne Datenbank (WI-0120 A4, AUTH-0001 §6.4; Recherche B). */

describe("Argon2id aus node:crypto", () => {
    it("🔴 reproduziert den Testvektor aus RFC 9106 §5.3 (Argon2id, Version 19)", () => {
        const tag = argon2Sync("argon2id", {
            message: Buffer.alloc(32, 0x01),
            nonce: Buffer.alloc(16, 0x02),
            secret: Buffer.alloc(8, 0x03),
            associatedData: Buffer.alloc(12, 0x04),
            memory: 32,
            passes: 3,
            parallelism: 4,
            tagLength: 32,
        });
        expect(Buffer.from(tag).toString("hex")).toBe(
            "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
        );
    });

    it("🔴 schreibt PHC mit den OWASP-Parametern, prüft richtig und falsch, normalisiert NFC", async () => {
        const phc = await hashPassword("Silbermond über Gareth, 1032 BF");
        expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/u);
        expect(await verifyPassword("Silbermond über Gareth, 1032 BF", phc)).toEqual({ ok: true, needsRehash: false });
        expect((await verifyPassword("Silbermond uber Gareth, 1032 BF", phc)).ok).toBe(false);
        // „ü“ zusammengesetzt (NFC) und zerlegt (NFD) sind dasselbe Passwort.
        expect((await verifyPassword("Silbermond über Gareth, 1032 BF", phc)).ok).toBe(true);
        expect(await hashPassword("Silbermond über Gareth, 1032 BF")).not.toBe(phc);
    });

    it("🔴 ein Hash mit schwächeren alten Kosten gilt und verlangt das Neuberechnen; Fremdes gilt nie", async () => {
        const salt = Buffer.alloc(16, 7);
        const key = argon2Sync("argon2id", {
            message: Buffer.from("ein sehr langes Passwort", "utf8"),
            nonce: salt,
            memory: 9216,
            passes: 4,
            parallelism: 1,
            tagLength: 32,
        });
        const b64 = (value: Buffer): string => value.toString("base64").replace(/=+$/u, "");
        const old = `$argon2id$v=19$m=9216,t=4,p=1$${b64(salt)}$${b64(Buffer.from(key))}`;
        expect(parseHash(old)?.memory).toBe(9216);
        expect(await verifyPassword("ein sehr langes Passwort", old)).toEqual({ ok: true, needsRehash: true });
        expect(await verifyPassword("ein falsches langes Passwort", old)).toEqual({ ok: false, needsRehash: false });
        expect(await verifyPassword("x", "$2y$10$bcrypt")).toEqual({ ok: false, needsRehash: false });
        expect(ARGON2_PARAMETERS.memory).toBe(19_456);
    });
});

describe("Passwortregeln (NIST SP 800-63B-4)", () => {
    it("🔴 mindestens 15 Zeichen, gezählt in Unicode-Zeichen; Obergrenze in Zeichen und Byte", () => {
        expect(checkPassword("kurz und gut 1")).toEqual(["too_short"]);
        expect(checkPassword("ein Satz mit Ö!")).toEqual([]);
        expect(checkPassword("🐉".repeat(14))).toEqual(["too_short"]);
        expect(checkPassword("x".repeat(257))).toEqual(["too_long"]);
        expect(checkPassword("€".repeat(342))).toEqual(["too_long"]);
    });

    it("🔴 keine Zeichenklassen-Pflicht, aber häufige, Muster und Kontext werden abgelehnt", () => {
        expect(checkPassword("die drachen von gareth singen")).toEqual([]);
        expect(checkPassword("passwordpassword")).toContain("common");
        expect(checkPassword("abcabcabcabcabcabc")).toContain("pattern");
        expect(checkPassword("qwertzuiopasdfgh")).toContain("pattern");
        expect(checkPassword("98765432109876543")).toContain("pattern");
        expect(checkPassword("avesmaps2026avesmaps", {})).toContain("contextual");
        expect(checkPassword("rondrikan123456789", { loginName: "rondrikan" })).toContain("contextual");
        expect(checkPassword("Rondrikan reitet nach Perricum", { loginName: "rondrikan" })).toEqual([]);
    });
});

describe("Drossel", () => {
    it("fünf Fehlversuche frei, dann verdoppelnd bis höchstens 15 Minuten", () => {
        expect([1, 4, 5, 6, 7, 10, 30].map(waitSeconds)).toEqual([0, 0, 1, 2, 4, 32, 900]);
    });
});
