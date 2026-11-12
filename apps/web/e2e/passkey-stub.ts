import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { ME } from "./verwaltung-stub.ts";

/**
 * Ein Passkey im virtuellen Authenticator von Chromium und die zwei Routen der Bestätigung (`/api/auth/passkey/confirm/*`), für
 * die Browserfälle der Verwaltung (WI-0127 SYS-5, Hotfix 2026-10-10). Der Browser fragt wirklich (WebAuthn über CDP); der Nachbau
 * des Servers nimmt jede Antwort mit Signatur an und zählt sie (`verifiziert`), `optionen` zählt die begonnenen Zeremonien.
 */
export interface PasskeyStub {
    verifiziert: () => number;
    optionen: () => number;
    zeichen: () => Promise<number>;
}

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function passkeyBereit(page: Page): Promise<PasskeyStub> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await cdp.send("WebAuthn.addCredential", {
        authenticatorId,
        credential: {
            credentialId: randomBytes(16).toString("base64"),
            isResidentCredential: true,
            rpId: "localhost",
            privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
            userHandle: Buffer.from(ME.id).toString("base64"),
            signCount: 0,
        },
    });
    let verifiziert = 0;
    let optionen = 0;
    await page.route("**/api/auth/passkey/confirm/options", (route) => {
        optionen += 1;
        return json(route, 200, {
            publicKey: {
                challenge: randomBytes(32).toString("base64url"),
                rpId: "localhost",
                allowCredentials: [],
                userVerification: "required",
                timeout: 60_000,
            },
        });
    });
    await page.route("**/api/auth/passkey/confirm/verify", (route) => {
        const body = route.request().postDataJSON() as { credential?: { response?: { signature?: string } } };
        if (typeof body.credential?.response?.signature !== "string")
            return json(route, 400, { error: { code: "passkey_rejected", message: "vom Nachbau" } });
        verifiziert += 1;
        return json(route, 200, { status: "confirmed" });
    });
    return {
        verifiziert: () => verifiziert,
        optionen: () => optionen,
        zeichen: async () => {
            const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
            return credentials[0]?.signCount ?? 0;
        },
    };
}
