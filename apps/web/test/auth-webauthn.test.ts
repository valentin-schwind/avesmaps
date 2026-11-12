import { describe, expect, it } from "vitest";
import {
    assertionJson,
    creationOptions,
    fromBase64Url,
    registrationJson,
    requestOptions,
    toBase64Url,
} from "../src/auth/webauthn.ts";

/**
 * Passkeys im Browser (WI-0120 A9, ADR-0021): Die Umwandlung zwischen den JSON-Texten des Servers und den Puffern der
 * WebAuthn-Schnittstelle ist verlustfrei, in beide Richtungen, auch für Bytes, die base64url mit `-` und `_` schreibt.
 */
const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

describe("WebAuthn im Browser", () => {
    it("🔴 base64url hin und zurück, ohne Füllzeichen, mit - und _", () => {
        const raw = bytes(0xfb, 0xff, 0xbf, 0x00, 0x01);
        const text = toBase64Url(raw);
        expect(text).toBe("-_-_AAE");
        expect(new Uint8Array(fromBase64Url(text))).toEqual(new Uint8Array(raw));
        for (let length = 0; length < 40; length += 1) {
            const data = new Uint8Array(length).map((_, index) => (index * 37 + length) % 256);
            expect(new Uint8Array(fromBase64Url(toBase64Url(data)))).toEqual(data);
        }
    });

    it("🔴 Optionen des Servers: Herausforderung, Kennung der Person und bekannte Passkeys werden Puffer", () => {
        const challenge = toBase64Url(bytes(1, 2, 3, 4));
        const options = creationOptions({
            challenge,
            rp: { id: "avesmaps.test", name: "Avesmaps (test)" },
            user: { id: toBase64Url(bytes(9, 9)), name: "rondrikan", displayName: "Rondrikan" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            excludeCredentials: [{ type: "public-key", id: toBase64Url(bytes(7)), transports: ["internal"] }],
        });
        expect(new Uint8Array(options.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(new Uint8Array(options.user.id as ArrayBuffer)).toEqual(new Uint8Array([9, 9]));
        expect(options.user.displayName).toBe("Rondrikan");
        expect(options.excludeCredentials?.[0]).toMatchObject({ type: "public-key", transports: ["internal"] });
        const request = requestOptions({ challenge, rpId: "avesmaps.test", allowCredentials: [] });
        expect(request.rpId).toBe("avesmaps.test");
        expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("🔴 Ergebnis von create() und get() in der Form, die der Server prüft", () => {
        const registration = registrationJson({
            id: "AQI",
            rawId: bytes(1, 2),
            type: "public-key",
            authenticatorAttachment: "platform",
            response: {
                clientDataJSON: bytes(3),
                attestationObject: bytes(4),
                getTransports: () => ["internal", "hybrid"],
            },
        } as unknown as PublicKeyCredential);
        expect(registration).toEqual({
            id: "AQI",
            rawId: "AQI",
            type: "public-key",
            response: { clientDataJSON: "Aw", attestationObject: "BA", transports: ["internal", "hybrid"] },
            authenticatorAttachment: "platform",
            clientExtensionResults: {},
        });
        const assertion = assertionJson({
            id: "AQI",
            rawId: bytes(1, 2),
            type: "public-key",
            response: { clientDataJSON: bytes(3), authenticatorData: bytes(5), signature: bytes(6), userHandle: null },
        } as unknown as PublicKeyCredential);
        expect(assertion.response).toEqual({
            clientDataJSON: "Aw",
            authenticatorData: "BQ",
            signature: "Bg",
            userHandle: null,
        });
    });
});
