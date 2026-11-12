/**
 * Passkeys im Browser (WI-0120 A9, ADR-0021, AUTH-0001 §11.4): Der Server schickt die Optionen als JSON mit base64url-Texten,
 * der Browser braucht `ArrayBuffer`; zurück geht das Ergebnis wieder als base64url. Die eingebaute WebAuthn-Schnittstelle
 * genügt, eine Bibliothek braucht es auch im Browser nicht.
 *
 * 🪤 `PublicKeyCredential.parseCreationOptionsFromJSON` und `credential.toJSON()` (WebAuthn Level 3) fehlen in älteren
 * Browsern; die Umwandlung steht deshalb hier, zwanzig Zeilen statt einer Abhängigkeit vom Browserstand.
 */

export function fromBase64Url(value: string): ArrayBuffer {
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
    const bytes =
        buffer instanceof ArrayBuffer
            ? new Uint8Array(buffer)
            : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Kann dieser Browser Passkeys? (Ohne sichere Herkunft, etwa über eine IP-Adresse per http, fehlt die Schnittstelle.) */
export function passkeysAvailable(): boolean {
    return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

interface CredentialDescriptorJson {
    type: "public-key";
    id: string;
    transports?: string[];
}

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
    if (!Array.isArray(list)) return undefined;
    return (list as CredentialDescriptorJson[]).map((entry) => ({
        type: "public-key",
        id: fromBase64Url(entry.id),
        ...(entry.transports === undefined ? {} : { transports: entry.transports as AuthenticatorTransport[] }),
    }));
}

/** Optionen für `navigator.credentials.create()` aus der Antwort von `/api/account/passkeys/register/options`. */
export function creationOptions(publicKey: Record<string, unknown>): PublicKeyCredentialCreationOptions {
    const user = publicKey["user"] as { id: string; name: string; displayName: string };
    const exclude = descriptors(publicKey["excludeCredentials"]);
    return {
        ...(publicKey as unknown as PublicKeyCredentialCreationOptions),
        challenge: fromBase64Url(publicKey["challenge"] as string),
        user: { ...user, id: fromBase64Url(user.id) },
        ...(exclude === undefined ? {} : { excludeCredentials: exclude }),
    };
}

/** Optionen für `navigator.credentials.get()` aus der Antwort von `/api/auth/passkey/confirm/options`. */
export function requestOptions(publicKey: Record<string, unknown>): PublicKeyCredentialRequestOptions {
    const allow = descriptors(publicKey["allowCredentials"]);
    return {
        ...(publicKey as unknown as PublicKeyCredentialRequestOptions),
        challenge: fromBase64Url(publicKey["challenge"] as string),
        ...(allow === undefined ? {} : { allowCredentials: allow }),
    };
}

export interface RegistrationJson {
    id: string;
    rawId: string;
    type: string;
    response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
    authenticatorAttachment?: string | null;
    clientExtensionResults: Record<string, never>;
}

export interface AssertionJson {
    id: string;
    rawId: string;
    type: string;
    response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
    clientExtensionResults: Record<string, never>;
}

/** Das Ergebnis von `create()` so, wie `/api/account/passkeys/register/verify` es erwartet. */
export function registrationJson(credential: PublicKeyCredential): RegistrationJson {
    const response = credential.response as AuthenticatorAttestationResponse;
    const transports = typeof response.getTransports === "function" ? response.getTransports() : undefined;
    return {
        id: credential.id,
        rawId: toBase64Url(credential.rawId),
        type: credential.type,
        response: {
            clientDataJSON: toBase64Url(response.clientDataJSON),
            attestationObject: toBase64Url(response.attestationObject),
            ...(transports === undefined ? {} : { transports }),
        },
        authenticatorAttachment: credential.authenticatorAttachment ?? null,
        clientExtensionResults: {},
    };
}

/** Das Ergebnis von `get()` so, wie `/api/auth/passkey/confirm/verify` es erwartet. */
export function assertionJson(credential: PublicKeyCredential): AssertionJson {
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
        id: credential.id,
        rawId: toBase64Url(credential.rawId),
        type: credential.type,
        response: {
            clientDataJSON: toBase64Url(response.clientDataJSON),
            authenticatorData: toBase64Url(response.authenticatorData),
            signature: toBase64Url(response.signature),
            userHandle: response.userHandle === null ? null : toBase64Url(response.userHandle),
        },
        clientExtensionResults: {},
    };
}
