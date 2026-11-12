import { postJson, type Fetcher } from "./api";
import type { Phrase } from "./formular";
import { formProblems } from "./formular";
import { assertionJson, creationOptions, passkeysAvailable, registrationJson, requestOptions } from "./webauthn";

/**
 * Passkeys einrichten und damit bestätigen (WI-0120 A9, ADR-0021, AUTH-0001 §11.4). Den ersten richtet nur ein, wer einen
 * Einrichtungslink für sich hat oder im Notzugang ist; jeden weiteren, wer gerade mit einem vorhandenen bestätigt hat. Das prüft
 * der Server; hier stehen nur die Schritte im Browser.
 */
export interface PasskeyDeps {
    fetcher?: Fetcher;
    credentials?: Pick<CredentialsContainer, "create" | "get">;
    available?: () => boolean;
}

export class PasskeyProblem extends Error {
    readonly phrases: Phrase[];

    constructor(phrases: Phrase[]) {
        super(phrases.map((phrase) => phrase.key).join(", "));
        this.name = "PasskeyProblem";
        this.phrases = phrases;
    }
}

/** Was die WebAuthn-Schnittstelle des Browsers meldet, als eigener Satz (abgebrochen, schon da, nicht möglich). */
function browserProblem(error: unknown): PasskeyProblem {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "NotAllowedError" || name === "AbortError")
        return new PasskeyProblem([{ key: "auth.passkey.cancelled" }]);
    if (name === "InvalidStateError") return new PasskeyProblem([{ key: "auth.passkey.exists" }]);
    return new PasskeyProblem([{ key: "auth.passkey.browserFailed" }]);
}

function container(deps: PasskeyDeps): Pick<CredentialsContainer, "create" | "get"> {
    if (!(deps.available ?? passkeysAvailable)()) throw new PasskeyProblem([{ key: "auth.passkey.unavailable" }]);
    return deps.credentials ?? globalThis.navigator.credentials;
}

async function server<T>(url: string, body: unknown, deps: PasskeyDeps): Promise<T> {
    try {
        return await postJson<T>(url, body, deps.fetcher);
    } catch (error) {
        throw new PasskeyProblem(formProblems(error));
    }
}

/** Einen Passkey einrichten; `enrollmentToken` für den ersten (Link), sonst nach frischer Bestätigung. */
export async function registerPasskey(
    input: { enrollmentToken?: string | null; label?: string },
    deps: PasskeyDeps = {},
): Promise<void> {
    const credentials = container(deps);
    const token = input.enrollmentToken ?? undefined;
    const { publicKey } = await server<{ publicKey: Record<string, unknown> }>(
        "/api/account/passkeys/register/options",
        token === undefined ? {} : { enrollmentToken: token },
        deps,
    );
    let credential: Credential | null;
    try {
        credential = await credentials.create({ publicKey: creationOptions(publicKey) });
    } catch (error) {
        throw browserProblem(error);
    }
    if (credential === null) throw new PasskeyProblem([{ key: "auth.passkey.cancelled" }]);
    const label = input.label?.trim();
    await server(
        "/api/account/passkeys/register/verify",
        {
            credential: registrationJson(credential as PublicKeyCredential),
            ...(label === undefined || label === "" ? {} : { label }),
            ...(token === undefined ? {} : { enrollmentToken: token }),
        },
        deps,
    );
}

/** Mit einem vorhandenen Passkey bestätigen (Stufe V mit Passwort, frischer Nachweis für Stufe S). */
export async function confirmWithPasskey(deps: PasskeyDeps = {}): Promise<void> {
    const credentials = container(deps);
    const { publicKey } = await server<{ publicKey: Record<string, unknown> }>(
        "/api/auth/passkey/confirm/options",
        {},
        deps,
    );
    let credential: Credential | null;
    try {
        credential = await credentials.get({ publicKey: requestOptions(publicKey) });
    } catch (error) {
        throw browserProblem(error);
    }
    if (credential === null) throw new PasskeyProblem([{ key: "auth.passkey.cancelled" }]);
    await server(
        "/api/auth/passkey/confirm/verify",
        { credential: assertionJson(credential as PublicKeyCredential) },
        deps,
    );
}

export function passkeyPhrases(error: unknown): Phrase[] {
    return error instanceof PasskeyProblem ? error.phrases : formProblems(error);
}
