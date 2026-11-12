// Der Schlüssel der Production-Freigabe (Weg B, Vali 2026-10-31; Claudio `2026-10-31-community-weg-b-antwort-an-claudia.md`).
//
//   node scripts/dev/release-schluessel.ts erzeuge   legt das Ed25519-Paar an: privat nach <Daten>/geheim/release-freigabe.key (nie ins Repository),
//                                                     öffentlich nach ops/corridor/release-freigabe.pub (zum Committen; Claudios Bootstrap spielt ihn ein)
//   node scripts/dev/release-schluessel.ts pruefe    unterschreibt eine Probe und prüft sie gegen ops/corridor/release-freigabe.pub
//
// Den privaten Pfad ändert `RELEASE_FREIGABE_SCHLUESSEL` (derselbe, den der Starter beim Schreiben der Freigabe liest, `freigabeSchluesselPfad`).
// 🔴 Das Skript gibt den privaten Schlüssel nie aus und überschreibt keinen vorhandenen: Ein neues Paar heißt, Claudio muss den öffentlichen neu
// einspielen, sonst liefert der Korridor nichts mehr aus.
//
// Nur Node-Bordmittel, wie die übrigen Release-Skripte.
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freigabeSchluesselPfad } from "./release-abholer.ts";
import { freigabeNotiz, pruefeNotizUnterschrift, unterschreibeNotiz } from "./release-freigabe.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Der öffentliche Schlüssel im Repository; Claudios Bootstrap legt ihn nach `/etc/avesmaps3d/release-freigabe.pub`. */
export const OEFFENTLICH = join(REPO, "ops", "corridor", "release-freigabe.pub");

/** Der Fingerabdruck des öffentlichen Schlüssels (SHA-256 über die DER-Form), zum Vergleichen mit Claudios Seite. */
export function fingerabdruck(oeffentlichPem: string): string {
    const der = createPublicKey(oeffentlichPem).export({ type: "spki", format: "der" });
    return createHash("sha256").update(der).digest("hex");
}

function erzeuge(): number {
    const privat = freigabeSchluesselPfad({});
    if (existsSync(privat)) {
        console.error(`Es gibt schon einen Schlüssel: ${privat}. Nichts überschrieben.`);
        return 1;
    }
    const paar = generateKeyPairSync("ed25519");
    mkdirSync(dirname(privat), { recursive: true });
    writeFileSync(privat, paar.privateKey.export({ type: "pkcs8", format: "pem" }), { encoding: "utf8", mode: 0o600 });
    const oeffentlich = paar.publicKey.export({ type: "spki", format: "pem" }).toString();
    mkdirSync(dirname(OEFFENTLICH), { recursive: true });
    writeFileSync(OEFFENTLICH, oeffentlich, "utf8");
    process.stdout.write(
        `privat: ${privat}\nöffentlich: ${OEFFENTLICH}\nFingerabdruck: ${fingerabdruck(oeffentlich)}\n`,
    );
    return 0;
}

function pruefe(): number {
    const privat = freigabeSchluesselPfad({});
    if (!existsSync(privat) || !existsSync(OEFFENTLICH)) {
        console.error(`Es fehlt ${existsSync(privat) ? OEFFENTLICH : privat}.`);
        return 1;
    }
    const oeffentlich = readFileSync(OEFFENTLICH, "utf8");
    const probe = freigabeNotiz({
        sha: "0".repeat(40),
        zeit: new Date().toISOString(),
        kennung: "RT-00000000-0000-0000-0000-000000000000",
        von: "Probe",
    });
    const gut = pruefeNotizUnterschrift(unterschreibeNotiz(probe, readFileSync(privat, "utf8")), oeffentlich);
    process.stdout.write(
        gut
            ? `passt (Fingerabdruck ${fingerabdruck(oeffentlich)})\n`
            : "passt NICHT: privater und öffentlicher Schlüssel gehören nicht zusammen\n",
    );
    return gut ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const befehl = process.argv[2];
    process.exitCode = befehl === "erzeuge" ? erzeuge() : befehl === "pruefe" ? pruefe() : 2;
    if (process.exitCode === 2) console.error("Aufruf: node scripts/dev/release-schluessel.ts erzeuge|pruefe");
}
