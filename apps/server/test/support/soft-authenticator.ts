import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { AssertionCredential, RegistrationCredential } from "../../src/auth/webauthn.ts";

/**
 * Ein Authenticator in Software für Tests (WI-0120 A6, ADR-0021): erzeugt Schlüssel (ES256, EdDSA, RS256), baut
 * `attestationObject` und Anmeldeantworten genau so, wie ein Browser sie liefert, und lässt jedes Feld gezielt verfälschen.
 */

// --- CBOR schreiben (nur für die Tests) ---
function head(major: number, length: number): Buffer {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    if (length < 65536) {
        const out = Buffer.alloc(3);
        out[0] = (major << 5) | 25;
        out.writeUInt16BE(length, 1);
        return out;
    }
    const out = Buffer.alloc(5);
    out[0] = (major << 5) | 26;
    out.writeUInt32BE(length, 1);
    return out;
}

export function encodeCbor(value: unknown): Buffer {
    if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
    if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
    if (typeof value === "string") {
        const bytes = Buffer.from(value, "utf8");
        return Buffer.concat([head(3, bytes.length), bytes]);
    }
    if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
    if (value instanceof Map) {
        const parts: Buffer[] = [head(5, value.size)];
        for (const [key, entry] of value) parts.push(encodeCbor(key), encodeCbor(entry));
        return Buffer.concat(parts);
    }
    if (value === true) return Buffer.from([0xf5]);
    if (value === false) return Buffer.from([0xf4]);
    if (value === null) return Buffer.from([0xf6]);
    throw new Error("cbor: Typ nicht unterstützt");
}

export type Algorithm = "ES256" | "EdDSA" | "RS256";

function coseKey(publicKey: KeyObject, algorithm: Algorithm): Map<number, unknown> {
    const jwk = publicKey.export({ format: "jwk" });
    const bytes = (value: string | undefined): Buffer => Buffer.from(value!, "base64url");
    if (algorithm === "ES256")
        return new Map<number, unknown>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, bytes(jwk.x)],
            [-3, bytes(jwk.y)],
        ]);
    if (algorithm === "EdDSA")
        return new Map<number, unknown>([
            [1, 1],
            [3, -8],
            [-1, 6],
            [-2, bytes(jwk.x)],
        ]);
    return new Map<number, unknown>([
        [1, 3],
        [3, -257],
        [-1, bytes(jwk.n)],
        [-2, bytes(jwk.e)],
    ]);
}

export interface SoftAuthenticatorOptions {
    rpId: string;
    origin: string;
    algorithm?: Algorithm;
}

export interface Tamper {
    type?: string;
    origin?: string;
    rpId?: string;
    userVerified?: boolean;
    userPresent?: boolean;
    signCount?: number;
    badSignature?: boolean;
    crossOrigin?: boolean;
}

export class SoftAuthenticator {
    readonly credentialId: Buffer = Buffer.from(randomBytes(32));
    readonly algorithm: Algorithm;
    private readonly privateKey: KeyObject;
    private readonly publicKey: KeyObject;
    private counter = 0;
    private readonly options: SoftAuthenticatorOptions;

    constructor(options: SoftAuthenticatorOptions) {
        this.options = options;
        this.algorithm = options.algorithm ?? "ES256";
        const pair =
            this.algorithm === "ES256"
                ? generateKeyPairSync("ec", { namedCurve: "P-256" })
                : this.algorithm === "EdDSA"
                  ? generateKeyPairSync("ed25519")
                  : generateKeyPairSync("rsa", { modulusLength: 2048 });
        this.privateKey = pair.privateKey;
        this.publicKey = pair.publicKey;
    }

    get id(): string {
        return this.credentialId.toString("base64url");
    }

    private authData(tamper: Tamper, attested: boolean): Buffer {
        const flags =
            (tamper.userPresent === false ? 0 : 0x01) |
            (tamper.userVerified === false ? 0 : 0x04) |
            0x08 |
            0x10 |
            (attested ? 0x40 : 0);
        const count = Buffer.alloc(4);
        count.writeUInt32BE(tamper.signCount ?? this.counter, 0);
        const parts: Buffer[] = [
            createHash("sha256")
                .update(tamper.rpId ?? this.options.rpId)
                .digest(),
            Buffer.from([flags]),
            count,
        ];
        if (attested) {
            const length = Buffer.alloc(2);
            length.writeUInt16BE(this.credentialId.length, 0);
            parts.push(
                Buffer.alloc(16),
                length,
                this.credentialId,
                encodeCbor(coseKey(this.publicKey, this.algorithm)),
            );
        }
        return Buffer.concat(parts);
    }

    private clientData(type: string, challenge: string, tamper: Tamper): Buffer {
        return Buffer.from(
            JSON.stringify({
                type: tamper.type ?? type,
                challenge,
                origin: tamper.origin ?? this.options.origin,
                ...(tamper.crossOrigin === undefined ? {} : { crossOrigin: tamper.crossOrigin }),
            }),
        );
    }

    /** Antwort auf `navigator.credentials.create()` (toJSON-Form). */
    register(challenge: string, tamper: Tamper = {}): RegistrationCredential {
        const attestationObject = encodeCbor(
            new Map<string, unknown>([
                ["fmt", "none"],
                ["attStmt", new Map()],
                ["authData", this.authData(tamper, true)],
            ]),
        );
        return {
            id: this.id,
            rawId: this.id,
            type: "public-key",
            response: {
                clientDataJSON: this.clientData("webauthn.create", challenge, tamper).toString("base64url"),
                attestationObject: attestationObject.toString("base64url"),
                transports: ["internal"],
            },
        };
    }

    /** Antwort auf `navigator.credentials.get()`; zählt den Signaturzähler hoch. */
    assert(challenge: string, tamper: Tamper = {}): AssertionCredential {
        this.counter += 1;
        const authenticatorData = this.authData(tamper, false);
        const clientDataJSON = this.clientData("webauthn.get", challenge, tamper);
        const data = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
        let signature =
            this.algorithm === "ES256"
                ? sign("sha256", data, { key: this.privateKey, dsaEncoding: "der" })
                : sign(this.algorithm === "EdDSA" ? null : "sha256", data, this.privateKey);
        if (tamper.badSignature === true)
            signature = Buffer.from(signature.map((byte, index) => (index === 10 ? byte ^ 0xff : byte)));
        return {
            id: this.id,
            rawId: this.id,
            type: "public-key",
            response: {
                clientDataJSON: clientDataJSON.toString("base64url"),
                authenticatorData: authenticatorData.toString("base64url"),
                signature: signature.toString("base64url"),
                userHandle: null,
            },
        };
    }
}
