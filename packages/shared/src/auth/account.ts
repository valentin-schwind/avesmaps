import { Type, type Static } from "@sinclair/typebox";
import { OperationId, UUID_PATTERN } from "../operation.ts";
import { BezeichnungWert } from "./session.ts";

/**
 * Das eigene Konto (WI-0120 A9, AUTH-0001 §6.6, §12.2 `konto-fenster`). `GET /api/account` liefert dieselbe Detailform wie die
 * Verwaltung (`AdminPersonDetail`), nur für die eigene Person; die Rechte und die Stufe der Sitzung stehen in
 * `GET /api/auth/session`.
 */
const strict = { additionalProperties: false } as const;

/** Eigene Sitzungen beenden: ohne `sessionId` alle anderen, mit `sessionId` genau diese (nie die laufende: „Abmelden“). */
export const AccountSessionsRevokeBody = Type.Object(
    { operationId: OperationId, sessionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })) },
    strict,
);
export type AccountSessionsRevokeBody = Static<typeof AccountSessionsRevokeBody>;

export const DisplayNameBody = Type.Object(
    {
        operationId: OperationId,
        displayName: Type.String({ minLength: 1, maxLength: 80 }),
        baseRevision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type DisplayNameBody = Static<typeof DisplayNameBody>;

/** Discord lösen: nur frisch bestätigt und nur, wenn ein Passwort bleibt (§6.6). */
export const OperationOnlyBody = Type.Object({ operationId: OperationId }, strict);
export type OperationOnlyBody = Static<typeof OperationOnlyBody>;

/**
 * „Verantwortlich für:“ (WI-0133, Betreiber 2026-10-10): ein freiwilliger Freitext an der Person, eine Zeile, höchstens
 * `RESPONSIBILITY_MAX` Zeichen; leer heißt „nicht gesetzt“ (`null`). Ändern darf ihn die Person selbst (`/api/account/responsibility`,
 * Stufe R) und ein Betreiber bei jeder Person (`/api/admin/people/responsibility`, `set_responsibility`, Stufe V). Später steht er bei
 * den Statusanzeigen unter dem Namen („Vali – Verantwortlich für: …“); dafür tragen `AdminPerson` und `SessionPerson` ihn.
 *
 * Dieselbe Regel gilt im Server (vor dem Schreiben), im Fenster (vor dem Senden) und als CHECK in der Tafel (Migration 0097).
 */
export const RESPONSIBILITY_MAX = 120;

/** Was an einem Text nicht geht: ein Zeilenumbruch oder anderes Steuerzeichen, oder mehr als `RESPONSIBILITY_MAX` Zeichen. */
export type ResponsibilityProblem = "line" | "too_long";

// Steuerzeichen (C0, DEL, C1) und die Trenner für Zeile und Absatz: Sie machen aus einer Zeile mehrere.
const LINE_BREAKING = /[\p{Cc}\u2028\u2029]/u;
// Richtungs- und Nullbreitenzeichen fallen still weg, wie beim Anzeigenamen (sie verdrehen die Anzeige, ohne zu sehen zu sein).
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Bereinigt einen eingegebenen Text: NFC, unsichtbare Richtungszeichen weg, außen getrimmt; leer (auch nur Leerzeichen) ergibt
 * `null`. Ein Zeilenumbruch IM Text oder eine Überlänge ist ein Fehler, kein stilles Kürzen.
 */
export function cleanResponsibility(
    value: string,
): { ok: true; value: string | null } | { ok: false; problem: ResponsibilityProblem } {
    const clean = value.normalize("NFC").replace(INVISIBLE, "").trim();
    if (clean === "") return { ok: true, value: null };
    if (LINE_BREAKING.test(clean)) return { ok: false, problem: "line" };
    if ([...clean].length > RESPONSIBILITY_MAX) return { ok: false, problem: "too_long" };
    return { ok: true, value: clean };
}

/** Den eigenen Eintrag ändern; leer (`""`) leert ihn. Der Server prüft mit `cleanResponsibility`, die Grenze hier bremst nur Unfug. */
export const ResponsibilityBody = Type.Object(
    {
        operationId: OperationId,
        responsibleFor: Type.String({ maxLength: 1000 }),
        baseRevision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type ResponsibilityBody = Static<typeof ResponsibilityBody>;

/** Die eigene Bezeichnung wählen (WI-0279 E10). Ohne Revision: Nur die Person selbst schreibt sie, und die Spalte zählt nicht mit. */
export const BezeichnungBody = Type.Object({ operationId: OperationId, bezeichnung: BezeichnungWert }, strict);
export type BezeichnungBody = Static<typeof BezeichnungBody>;
