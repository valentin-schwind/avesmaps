import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";

/**
 * Passkeys prüfen, ohne Bibliothek (WI-0120 A6, ADR-0021; W3C WebAuthn Level 3 §7.1 Registrierung, §7.2 Anmeldung).
 *
 * Geprüft wird: Typ, Challenge, Herkunft (exakt), RP-ID-Hash, User Present UND User Verified, Algorithmus aus der Positivliste
 * (ES256, EdDSA, RS256), Signatur, Signaturzähler. Eine Attestierung wird nicht ausgewertet (`attestation: "none"`).
 * 🔴 Jede Abweichung ist ein `WebAuthnError` mit einem kurzen Grund; nichts davon geht ungeprüft durch.
 */
export class WebAuthnError extends Error {
    readonly reason: string;
    constructor(reason: string) {
        super(`WebAuthn: ${reason}`);
        this.name = "WebAuthnError";
        this.reason = reason;
    }
}

// --- CBOR (RFC 8949), nur was WebAuthn braucht: ganze Zahlen, Bytes, Text, Listen, Maps, true/false/null -------------------

const MAX_DEPTH = 8;

function readLength(buffer: Buffer, offset: number, info: number): { value: number; next: number } {
    if (info < 24) return { value: info, next: offset };
    if (info === 24) return { value: buffer.readUInt8(offset), next: offset + 1 };
    if (info === 25) return { value: buffer.readUInt16BE(offset), next: offset + 2 };
    if (info === 26) return { value: buffer.readUInt32BE(offset), next: offset + 4 };
    if (info === 27) {
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new WebAuthnError("cbor_integer_too_large");
        return { value: Number(big), next: offset + 8 };
    }
    throw new WebAuthnError("cbor_indefinite_or_reserved");
}

function decodeItem(buffer: Buffer, offset: number, depth: number): { value: unknown; next: number } {
    if (depth > MAX_DEPTH) throw new WebAuthnError("cbor_too_deep");
    if (offset >= buffer.length) throw new WebAuthnError("cbor_truncated");
    const head = buffer.readUInt8(offset);
    const major = head >> 5;
    const info = head & 0x1f;
    const { value: length, next } = readLength(buffer, offset + 1, info);
    switch (major) {
        case 0:
            return { value: length, next };
        case 1:
            return { value: -1 - length, next };
        case 2:
        case 3: {
            if (next + length > buffer.length) throw new WebAuthnError("cbor_truncated");
            const bytes = buffer.subarray(next, next + length);
            return { value: major === 2 ? Buffer.from(bytes) : bytes.toString("utf8"), next: next + length };
        }
        case 4: {
            const items: unknown[] = [];
            let cursor = next;
            for (let index = 0; index < length; index += 1) {
                const item = decodeItem(buffer, cursor, depth + 1);
                items.push(item.value);
                cursor = item.next;
            }
            return { value: items, next: cursor };
        }
        case 5: {
            const map = new Map<unknown, unknown>();
            let cursor = next;
            for (let index = 0; index < length; index += 1) {
                const key = decodeItem(buffer, cursor, depth + 1);
                const value = decodeItem(buffer, key.next, depth + 1);
                if (map.has(key.value)) throw new WebAuthnError("cbor_duplicate_key");
                map.set(key.value, value.value);
                cursor = value.next;
            }
            return { value: map, next: cursor };
        }
        case 7:
            if (info === 20) return { value: false, next: offset + 1 };
            if (info === 21) return { value: true, next: offset + 1 };
            if (info === 22) return { value: null, next: offset + 1 };
            throw new WebAuthnError("cbor_unsupported_simple");
        default:
            throw new WebAuthnError("cbor_unsupported_type");
    }
}

/** Ein CBOR-Wert am Anfang von `buffer`; gibt auch zurück, wie viele Byte er belegt. */
export function decodeCbor(buffer: Buffer): { value: unknown; length: number } {
    const { value, next } = decodeItem(buffer, 0, 0);
    return { value, length: next };
}

// --- authenticatorData (§6.1) ---------------------------------------------------------------------------------------------

export interface AuthenticatorData {
    rpIdHash: Buffer;
    userPresent: boolean;
    userVerified: boolean;
    backupEligible: boolean;
    backedUp: boolean;
    signCount: number;
    attested?: { aaguid: Buffer; credentialId: Buffer; publicKey: Map<unknown, unknown> };
}

export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
    if (data.length < 37) throw new WebAuthnError("auth_data_too_short");
    const flags = data.readUInt8(32);
    const result: AuthenticatorData = {
        rpIdHash: data.subarray(0, 32),
        userPresent: (flags & 0x01) !== 0,
        userVerified: (flags & 0x04) !== 0,
        backupEligible: (flags & 0x08) !== 0,
        backedUp: (flags & 0x10) !== 0,
        signCount: data.readUInt32BE(33),
    };
    if ((flags & 0x40) !== 0) {
        if (data.length < 55) throw new WebAuthnError("attested_data_too_short");
        const aaguid = data.subarray(37, 53);
        const idLength = data.readUInt16BE(53);
        if (idLength === 0 || idLength > 1023 || 55 + idLength > data.length)
            throw new WebAuthnError("credential_id_length");
        const credentialId = data.subarray(55, 55 + idLength);
        const key = decodeCbor(data.subarray(55 + idLength));
        if (!(key.value instanceof Map)) throw new WebAuthnError("cose_key_not_map");
        result.attested = {
            aaguid: Buffer.from(aaguid),
            credentialId: Buffer.from(credentialId),
            publicKey: key.value,
        };
    }
    return result;
}

// --- COSE-Schlüssel (RFC 9052/9053) -> Node-Schlüssel --------------------------------------------------------------------

/** Die erlaubten Algorithmen: ES256 (-7), EdDSA (-8), RS256 (-257). */
export const ALLOWED_ALGORITHMS = [-7, -8, -257] as const;

const b64url = (value: Buffer): string => value.toString("base64url");

function bytesAt(map: Map<unknown, unknown>, key: number): Buffer {
    const value = map.get(key);
    if (!Buffer.isBuffer(value)) throw new WebAuthnError(`cose_missing_${String(key)}`);
    return value;
}

export function coseToKey(cose: Map<unknown, unknown>): KeyObject {
    const kty = cose.get(1);
    const alg = cose.get(3);
    if (kty === 2 && alg === -7) {
        if (cose.get(-1) !== 1) throw new WebAuthnError("cose_curve");
        return createPublicKey({
            key: { kty: "EC", crv: "P-256", x: b64url(bytesAt(cose, -2)), y: b64url(bytesAt(cose, -3)) },
            format: "jwk",
        });
    }
    if (kty === 1 && alg === -8) {
        if (cose.get(-1) !== 6) throw new WebAuthnError("cose_curve");
        return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url(bytesAt(cose, -2)) }, format: "jwk" });
    }
    if (kty === 3 && alg === -257) {
        const modulus = bytesAt(cose, -1);
        if (modulus.length < 256) throw new WebAuthnError("rsa_key_too_small");
        return createPublicKey({
            key: { kty: "RSA", n: b64url(modulus), e: b64url(bytesAt(cose, -2)) },
            format: "jwk",
        });
    }
    throw new WebAuthnError("algorithm_not_allowed");
}

export function verifyWithKey(key: KeyObject, data: Buffer, signature: Buffer): boolean {
    switch (key.asymmetricKeyType) {
        case "ec":
            return verifySignature("sha256", data, { key, dsaEncoding: "der" }, signature);
        case "rsa":
            return verifySignature("sha256", data, key, signature);
        case "ed25519":
            return verifySignature(null, data, key, signature);
        default:
            return false;
    }
}

// --- Zeremonien ------------------------------------------------------------------------------------------------------------

export interface RelyingParty {
    rpId: string;
    /** Erlaubte Herkünfte; in Stage und Production genau eine. */
    origins: readonly string[];
}

interface ClientData {
    type: string;
    challenge: string;
    origin: string;
    crossOrigin?: boolean;
}

function fromB64url(value: unknown, field: string): Buffer {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) throw new WebAuthnError(`${field}_encoding`);
    return Buffer.from(value, "base64url");
}

function parseClientData(
    encoded: unknown,
    type: "webauthn.create" | "webauthn.get",
    rp: RelyingParty,
): { data: ClientData; raw: Buffer } {
    const raw = fromB64url(encoded, "client_data");
    let data: ClientData;
    try {
        data = JSON.parse(raw.toString("utf8")) as ClientData;
    } catch {
        throw new WebAuthnError("client_data_json");
    }
    if (data.type !== type) throw new WebAuthnError("client_data_type");
    if (typeof data.challenge !== "string" || data.challenge === "") throw new WebAuthnError("challenge_missing");
    if (!rp.origins.includes(data.origin)) throw new WebAuthnError("origin");
    if (data.crossOrigin === true) throw new WebAuthnError("cross_origin");
    return { data, raw };
}

function checkAuthData(auth: AuthenticatorData, rp: RelyingParty): void {
    const expected = createHash("sha256").update(rp.rpId, "utf8").digest();
    if (!auth.rpIdHash.equals(expected)) throw new WebAuthnError("rp_id");
    if (!auth.userPresent) throw new WebAuthnError("user_not_present");
    if (!auth.userVerified) throw new WebAuthnError("user_not_verified");
}

export interface RegistrationCredential {
    id: string;
    rawId: string;
    type: string;
    response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
}

export interface VerifiedRegistration {
    credentialId: string;
    publicKeySpki: Buffer;
    signCount: number;
    backedUp: boolean;
    deviceType: "singleDevice" | "multiDevice";
    transports: string[];
}

/** Registrierung prüfen; `challengeOk` prüft und verbraucht die Challenge (einmalig, an Sitzung und Zweck gebunden). */
export async function verifyRegistration(
    credential: RegistrationCredential,
    rp: RelyingParty,
    challengeOk: (challenge: string) => Promise<boolean>,
): Promise<VerifiedRegistration> {
    if (credential.type !== "public-key") throw new WebAuthnError("credential_type");
    const { data } = parseClientData(credential.response.clientDataJSON, "webauthn.create", rp);
    if (!(await challengeOk(data.challenge))) throw new WebAuthnError("challenge");
    const attestation = decodeCbor(fromB64url(credential.response.attestationObject, "attestation_object")).value;
    if (!(attestation instanceof Map)) throw new WebAuthnError("attestation_not_map");
    const authBytes = attestation.get("authData");
    if (!Buffer.isBuffer(authBytes)) throw new WebAuthnError("auth_data_missing");
    const auth = parseAuthenticatorData(authBytes);
    checkAuthData(auth, rp);
    if (auth.attested === undefined) throw new WebAuthnError("attested_data_missing");
    const rawId = fromB64url(credential.rawId, "raw_id");
    if (!rawId.equals(auth.attested.credentialId) || credential.id !== b64url(rawId))
        throw new WebAuthnError("credential_id");
    const key = coseToKey(auth.attested.publicKey);
    const transports = (credential.response.transports ?? [])
        .filter((entry) => /^[a-z-]{2,20}$/u.test(entry))
        .slice(0, 6);
    return {
        credentialId: b64url(rawId),
        publicKeySpki: key.export({ type: "spki", format: "der" }),
        signCount: auth.signCount,
        backedUp: auth.backedUp,
        deviceType: auth.backupEligible ? "multiDevice" : "singleDevice",
        transports,
    };
}

export interface AssertionCredential {
    id: string;
    rawId: string;
    type: string;
    response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
}

export interface StoredPasskey {
    credentialId: string;
    publicKeySpki: Buffer;
    signCount: number;
}

/**
 * Eine Anmeldung oder Bestätigung prüfen. Wirft bei jeder Abweichung; ein Zählerrückschritt ist der Grund `counter_regression`
 * (ein möglicher Klon, der Aufrufer sperrt dann den Passkey).
 */
export async function verifyAssertion(
    credential: AssertionCredential,
    stored: StoredPasskey,
    rp: RelyingParty,
    challengeOk: (challenge: string) => Promise<boolean>,
): Promise<{ signCount: number; backedUp: boolean }> {
    if (credential.type !== "public-key") throw new WebAuthnError("credential_type");
    if (
        credential.id !== stored.credentialId ||
        b64url(fromB64url(credential.rawId, "raw_id")) !== stored.credentialId
    ) {
        throw new WebAuthnError("credential_id");
    }
    const { data, raw } = parseClientData(credential.response.clientDataJSON, "webauthn.get", rp);
    if (!(await challengeOk(data.challenge))) throw new WebAuthnError("challenge");
    const authBytes = fromB64url(credential.response.authenticatorData, "auth_data");
    const auth = parseAuthenticatorData(authBytes);
    checkAuthData(auth, rp);
    const signed = Buffer.concat([authBytes, createHash("sha256").update(raw).digest()]);
    const key = createPublicKey({ key: stored.publicKeySpki, format: "der", type: "spki" });
    if (!verifyWithKey(key, signed, fromB64url(credential.response.signature, "signature")))
        throw new WebAuthnError("signature");
    if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) {
        throw new WebAuthnError("counter_regression");
    }
    return { signCount: auth.signCount, backedUp: auth.backedUp };
}
