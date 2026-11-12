import { describe, expect, it } from "vitest";
import {
    decodeCbor,
    verifyAssertion,
    verifyRegistration,
    WebAuthnError,
    type RelyingParty,
} from "../src/auth/webauthn.ts";
import { encodeCbor, SoftAuthenticator, type Algorithm, type Tamper } from "./support/soft-authenticator.ts";

/** Die eigene Passkey-Prüfung (WI-0120 A6, ADR-0021): alle Algorithmen, alle Ablehnungsgründe. */

const rp: RelyingParty = { rpId: "stage.avesmaps.de", origins: ["https://stage.avesmaps.de"] };
const challengeOf = (expected: string) => async (actual: string) => actual === expected;

async function reason(work: Promise<unknown>): Promise<string> {
    try {
        await work;
        return "ok";
    } catch (error) {
        if (error instanceof WebAuthnError) return error.reason;
        throw error;
    }
}

describe("CBOR", () => {
    it("liest Zahlen, Bytes, Text, Listen, Maps und lehnt Doppelschlüssel ab", () => {
        const value = new Map<unknown, unknown>([
            [1, 2],
            [-3, Buffer.from([1, 2])],
            ["a", ["x", true, null, 70000]],
        ]);
        expect(decodeCbor(encodeCbor(value)).value).toEqual(value);
        expect(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(/duplicate/u);
        expect(() => decodeCbor(Buffer.from([0x5f]))).toThrow(WebAuthnError);
        expect(() => decodeCbor(Buffer.from([0x58, 0x05, 0x01]))).toThrow(/truncated/u);
    });
});

describe.each<Algorithm>(["ES256", "EdDSA", "RS256"])("Passkey %s", (algorithm) => {
    it("🔴 registrieren, dann anmelden; der Zähler steigt", async () => {
        const authenticator = new SoftAuthenticator({ rpId: rp.rpId, origin: rp.origins[0]!, algorithm });
        const registered = await verifyRegistration(authenticator.register("C1"), rp, challengeOf("C1"));
        expect(registered.credentialId).toBe(authenticator.id);
        expect(registered.deviceType).toBe("multiDevice");
        const stored = {
            credentialId: registered.credentialId,
            publicKeySpki: registered.publicKeySpki,
            signCount: registered.signCount,
        };
        const first = await verifyAssertion(authenticator.assert("C2"), stored, rp, challengeOf("C2"));
        expect(first.signCount).toBe(1);
        const second = await verifyAssertion(
            authenticator.assert("C3"),
            { ...stored, signCount: 1 },
            rp,
            challengeOf("C3"),
        );
        expect(second.signCount).toBe(2);
    });
});

describe("🔴 Ablehnungen", () => {
    const fresh = () => new SoftAuthenticator({ rpId: rp.rpId, origin: rp.origins[0]! });

    it("bei der Registrierung: Challenge, Typ, Herkunft, fremde Seite, RP-ID, ohne Nutzerprüfung", async () => {
        const cases: [Tamper | "challenge", string][] = [
            ["challenge", "challenge"],
            [{ type: "webauthn.get" }, "client_data_type"],
            [{ origin: "https://avesmaps.de" }, "origin"],
            [{ origin: "https://evil.example" }, "origin"],
            [{ crossOrigin: true }, "cross_origin"],
            [{ rpId: "avesmaps.de" }, "rp_id"],
            [{ userVerified: false }, "user_not_verified"],
            [{ userPresent: false }, "user_not_present"],
        ];
        for (const [tamper, expected] of cases) {
            const authenticator = fresh();
            const response =
                tamper === "challenge" ? authenticator.register("FALSCH") : authenticator.register("C", tamper);
            expect(await reason(verifyRegistration(response, rp, challengeOf("C"))), expected).toBe(expected);
        }
    });

    it("bei der Anmeldung: Signatur, Zählerrückschritt, fremder Passkey, RP-ID, ohne Nutzerprüfung", async () => {
        const authenticator = fresh();
        const registered = await verifyRegistration(authenticator.register("C"), rp, challengeOf("C"));
        const stored = { credentialId: registered.credentialId, publicKeySpki: registered.publicKeySpki, signCount: 5 };
        expect(
            await reason(
                verifyAssertion(authenticator.assert("A", { badSignature: true }), stored, rp, challengeOf("A")),
            ),
        ).toBe("signature");
        expect(
            await reason(verifyAssertion(authenticator.assert("A", { signCount: 5 }), stored, rp, challengeOf("A"))),
        ).toBe("counter_regression");
        expect(
            await reason(
                verifyAssertion(
                    authenticator.assert("A", { rpId: "avesmaps.de", signCount: 9 }),
                    stored,
                    rp,
                    challengeOf("A"),
                ),
            ),
        ).toBe("rp_id");
        expect(
            await reason(
                verifyAssertion(
                    authenticator.assert("A", { userVerified: false, signCount: 9 }),
                    stored,
                    rp,
                    challengeOf("A"),
                ),
            ),
        ).toBe("user_not_verified");
        const other = fresh();
        expect(await reason(verifyAssertion(other.assert("A"), stored, rp, challengeOf("A")))).toBe("credential_id");
        expect(
            await reason(verifyAssertion(authenticator.assert("A", { signCount: 9 }), stored, rp, challengeOf("B"))),
        ).toBe("challenge");
    });

    it("🔴 ein Stage-Passkey gilt nicht für Production (ADR-0021: RP-ID je Umgebung)", async () => {
        const stage = fresh();
        const registered = await verifyRegistration(stage.register("C"), rp, challengeOf("C"));
        const production: RelyingParty = { rpId: "avesmaps.de", origins: ["https://avesmaps.de"] };
        const stored = { credentialId: registered.credentialId, publicKeySpki: registered.publicKeySpki, signCount: 0 };
        expect(await reason(verifyAssertion(stage.assert("A"), stored, production, challengeOf("A")))).toBe("origin");
    });
});
