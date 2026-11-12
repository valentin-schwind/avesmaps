import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { LOKAL_IM_MENUE } from "./karteneinstellungen.ts";

/**
 * Der Stand der Umgebungen für das Umgebungsmenü an der Pille der Kopfleiste (WI-0180 §6, §9; Claudio 2026-10-16,
 * `project-control/handovers/2026-10-16-umgebungsmenue-stand-und-tailnet-an-claudia.md`).
 *
 * - Jede Umgebung kennt ihren eigenen Stand (`RELEASE_ID`) und fragt den der Gegenseite serverseitig über deren `/health` auf
 *   127.0.0.1 (`GEGENSEITE_HEALTH_URL`; Stage → Production und umgekehrt). Lokal fehlt die Variable, dann ist `gegenseite` null.
 * - An den Browser gehen nur `releaseId` und „erreichbar“, nie der rohe Inhalt der Gegenseite.
 * - Dieselbe Route soll auch der Reiter „Umgebungen“ der Systemsteuerung lesen, damit es für den Stand je Umgebung nur einen Weg
 *   gibt (Absprache WI-0180 §9). Die Statusdatei der Production-Freigabe bleibt der Freigabe vorbehalten.
 *
 *     GET /api/admin/system/umgebungen   eigener Stand und der der Gegenseite   switch_environment (V)
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const UMGEBUNGEN_URL = "/api/admin/system/umgebungen";

export const UmgebungGegenseite = Type.Object(
    {
        /** Der `releaseId` aus dem `/health` der Gegenseite; null, wenn sie nicht antwortet oder keinen lesbaren schickt. */
        releaseId: Nullable(Type.String()),
        erreichbar: Type.Boolean(),
    },
    strict,
);
export type UmgebungGegenseite = Static<typeof UmgebungGegenseite>;

export const UmgebungLokal = Type.Object(
    {
        /** `https://<name>[:port]`, gebaut von `lokalAdresse`. */
        adresse: Type.String(),
        /** `erreichbar`: nur, wenn die Probe aus dem Browser antwortet; `immer`: auch ohne Probe. */
        imMenue: Type.Union(LOKAL_IM_MENUE.map((wert) => Type.Literal(wert))),
    },
    strict,
);
export type UmgebungLokal = Static<typeof UmgebungLokal>;

export const UmgebungenStand = Type.Object(
    {
        eigene: Type.Object({ releaseId: Type.String() }, strict),
        /** null, wo keine Gegenseite eingerichtet ist (lokal, oder `GEGENSEITE_HEALTH_URL` fehlt oder taugt nicht). */
        gegenseite: Nullable(UmgebungGegenseite),
        /**
         * Die Adresse von Lokal aus den privaten Karteneinstellungen (WI-0180 §8, eingetragen im Reiter „Umgebungen“); null ohne
         * Namen. Nur Betreiber sehen sie, wie die ganze Route.
         */
        lokal: Nullable(UmgebungLokal),
    },
    strict,
);
export type UmgebungenStand = Static<typeof UmgebungenStand>;

/** Die Form eines `RELEASE_ID`: Zeitpunkt des Schnitts in UTC und Commit, etwa `20261016T143003Z-6e6dee0`. */
const RELEASE_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{7,40})$/;

/**
 * Ein `RELEASE_ID` zerlegt in Zeitpunkt und kurzen Commit; `dev` (lokal) und alles Fremde geben null. Der Server prüft damit, was
 * er von der Gegenseite weitergibt, und die Oberfläche schreibt daraus „Stand 16.10., 16:30 · 6e6dee0“.
 */
export function releaseStand(releaseId: string | null | undefined): { zeit: Date; commit: string } | null {
    const treffer = RELEASE_ID.exec(releaseId ?? "");
    if (treffer === null) return null;
    const [jahr, monat, tag, stunde, minute, sekunde] = treffer.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
    ];
    const zeit = new Date(Date.UTC(jahr, monat - 1, tag, stunde, minute, sekunde));
    if (Number.isNaN(zeit.getTime()) || zeit.getUTCMonth() !== monat - 1 || zeit.getUTCDate() !== tag) return null;
    return { zeit, commit: treffer[7]!.slice(0, 7) };
}

/**
 * Die eine Adresse von Lokal aus Name und Port (Absprache mit WI-0204: getrennt gespeichert, hier zusammengesetzt, eine Regel für
 * Menü, Probe und Anzeige): `https://<name>`, der Port nur, wenn er nicht 443 ist. Ohne Namen gibt es keine Adresse.
 */
export function lokalAdresse(name: string, port: number): string | null {
    if (name === "") return null;
    return port === 443 ? `https://${name}` : `https://${name}:${String(port)}`;
}
