import { ApiFailure } from "../auth/api";

/**
 * Der genaue Grund einer Ablehnung in der Sprache der Oberfläche (Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe. mit so quatsch kann kein
 * mensch was anfangen“). Ein Fenster zeigte bei 422 nur „Die Angaben wurden nicht angenommen. Beschreibung, Quelle und Name prüfen.“, während der Server den Grund schon
 * geschickt hatte.
 *
 * - **Fachcode zuerst:** Der Server schickt in `details.reason` einen stabilen Code (ADR-0018, derselbe, den das Protokoll als `grund` führt), das Fenster bildet ihn auf
 *   einen eigenen Satz ab, der sagt, was zu tun ist. Angaben, die der Satz braucht (Kanal, Zeichen zu viel), stehen daneben in `details`.
 * - **Schemafehler (400 `validation_failed`):** `details.issues` nennt Pfad und Regel; ein Fenster nennt das Feld in seinen Worten (`felder`).
 * - **Rückfall:** Kennt das Fenster den Code nicht, aber der Server hat abgelehnt (400, 422) oder einen Übergang verweigert (409 `…_transition`), steht sein Satz da
 *   (nur Deutsch), nie ein Satz, der nichts sagt.
 *   Erst ohne jeden Satz bleibt der allgemeine des Fensters (`undefined`).
 */

/** Ein Satz zu einem Fachcode; er liest, was er braucht, aus `details` und gibt `undefined`, wenn die Angaben nicht passen (dann gilt der Rückfall). */
export type GrundSatz = (details: Readonly<Record<string, unknown>>) => string | undefined;

/** Ein Satz zu einem Feld bei einem Schemafehler; `regel` ist das Schlüsselwort des Schemas (`maxLength`, `format`, `required` …). */
export type FeldSatz = (regel: string) => string | undefined;

export interface Abbildung {
    /** Die Sätze je Fachcode (`details.reason`). */
    readonly gruende?: Readonly<Record<string, GrundSatz>>;
    /** Die Sätze je Feld: das letzte Glied von `details.issues[].path` (`body/nachricht` → `nachricht`). Bei `required` nennt der Pfad das umgebende Objekt, nicht das fehlende Feld. */
    readonly felder?: Readonly<Record<string, FeldSatz>>;
}

/** Abgelehnte Angaben: Nur bei 400 und 422 ist der Satz des Servers ein Grund und kein Zustand (Drossel, Ausfall, Konflikt sagt das Fenster selbst). */
const ABGELEHNT = new Set([400, 422]);

/** Ein Schritt, der in diesem Zustand nicht (mehr) geht (409 `…_transition`): Sein Satz nennt den Zustand („die Meldung ist zurückgezogen“), auch er ist ein Grund. */
const istUebergang = (fehler: ApiFailure): boolean => fehler.status === 409 && fehler.code.endsWith("_transition");

/** Was Fastify bei einem Schemafehler sagt; ohne Feld ist dieser Satz kein Grund. */
const SCHEMA_CODE = "validation_failed";

/** Der Fachcode einer Ablehnung (`details.reason`), wenn der Server einen schickt. */
export function ablehnungsCode(fehler: unknown): string | undefined {
    if (!(fehler instanceof ApiFailure)) return undefined;
    const reason = fehler.details?.["reason"];
    return typeof reason === "string" && reason !== "" ? reason : undefined;
}

/** Die Felder eines Schemafehlers mit ihrer Regel, in der Reihenfolge des Servers. */
function schemaFelder(fehler: ApiFailure): { feld: string; regel: string }[] {
    const issues = fehler.details?.["issues"];
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: unknown) => {
        const pfad = (issue as { path?: unknown } | null)?.path;
        const regel = (issue as { rule?: unknown } | null)?.rule;
        if (typeof pfad !== "string") return [];
        const feld =
            pfad
                .split("/")
                .filter((teil) => teil !== "" && !/^\d+$/u.test(teil))
                .at(-1) ?? "";
        return [{ feld, regel: typeof regel === "string" ? regel : "" }];
    });
}

/**
 * Der genaue Satz zu einem Fehler, oder `undefined`, wenn es keinen gibt (dann zeigt der Aufrufer seinen allgemeinen Satz). Netz, Drossel und Ausfall bleiben beim Aufrufer:
 * Für sie gibt es hier nie einen Satz.
 */
export function genauerGrund(fehler: unknown, abbildung: Abbildung = {}): string | undefined {
    if (!(fehler instanceof ApiFailure) || fehler.status < 400 || fehler.status >= 500) return undefined;
    // Ein bekannter Fachcode gilt bei jedem Status unter 500 (auch 409, 413, 415): Das Fenster hat für ihn einen eigenen Satz.
    const code = ablehnungsCode(fehler);
    if (code !== undefined) {
        const satz = abbildung.gruende?.[code]?.(fehler.details ?? {});
        if (satz !== undefined) return satz;
    }
    if (!ABGELEHNT.has(fehler.status) && !istUebergang(fehler)) return undefined;
    for (const { feld, regel } of schemaFelder(fehler)) {
        const satz = abbildung.felder?.[feld]?.(regel);
        if (satz !== undefined) return satz;
    }
    // Ein Schemafehler ohne bekanntes Feld sagt nur „unvollständig oder falsch geformt“: Das ist kein Grund, dann lieber der Satz des Fensters.
    if (code === undefined && fehler.code === SCHEMA_CODE) return undefined;
    const satz = fehler.message.trim();
    return satz === "" ? undefined : satz;
}

/** Eine Zahl aus `details` (etwa Zeichen zu viel); `undefined`, wenn sie fehlt oder keine ist. */
export function zahlAus(details: Readonly<Record<string, unknown>>, name: string): number | undefined {
    const wert = details[name];
    return typeof wert === "number" && Number.isFinite(wert) ? wert : undefined;
}

/** Ein Text aus `details`; `undefined`, wenn er fehlt. */
export function textAus(details: Readonly<Record<string, unknown>>, name: string): string | undefined {
    const wert = details[name];
    return typeof wert === "string" && wert !== "" ? wert : undefined;
}
