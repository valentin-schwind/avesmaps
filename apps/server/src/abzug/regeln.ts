import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { AbzugRegeln, type AbzugRegelTafel } from "@avesmaps3d/shared";

/**
 * Die Regeln des Abzugs (WI-0251): `config/abzug/regeln.json`, EINE Datei für den Plan (`scripts/ops/abzug-plan.ts`, den Claudios Export
 * benutzt) und das Einspielen. Sie ordnet jede Tafel des Schemas ein (mitnehmen, weglassen, mit leeren Personenfeldern); der Wächter
 * `apps/server/test/abzug-regeln.test.ts` hält sie gegen das Schema der Datenbank, und neue Tafeln ohne Eintrag machen ihn rot.
 */
export const REGELN_PFAD = new URL("../../../../config/abzug/regeln.json", import.meta.url);

export interface GeladeneRegeln {
    readonly regeln: AbzugRegeln;
    /** SHA-256 der Datei mit einheitlichen Zeilenenden: Plan, Manifest und Einspielen vergleichen damit, ob sie dieselben Regeln meinen. */
    readonly pruefsumme: string;
}

/** Prüfsumme eines Regeltextes; Zeilenenden zählen nicht (eine Windows-Kopie hat dieselbe wie Linux). */
export function regelnPruefsumme(text: string): string {
    return createHash("sha256").update(text.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
}

/** Liest und prüft einen Regeltext; ein Fehler nennt die ersten Befunde, nie die Datei still hinnehmen. */
export function parseRegeln(text: string): GeladeneRegeln {
    let roh: unknown;
    try {
        roh = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Abzug-Regeln: kein gültiges JSON (${error instanceof Error ? error.message : String(error)})`,
            {
                cause: error,
            },
        );
    }
    if (!Value.Check(AbzugRegeln, roh)) {
        const befunde = [...Value.Errors(AbzugRegeln, roh)]
            .slice(0, 5)
            .map((fehler) => `${fehler.path || "/"}: ${fehler.message}`);
        throw new Error(`Abzug-Regeln: entsprechen nicht dem Schema (${befunde.join("; ")})`);
    }
    return { regeln: roh, pruefsumme: regelnPruefsumme(text) };
}

export function ladeRegeln(pfad: URL | string = REGELN_PFAD): GeladeneRegeln {
    return parseRegeln(readFileSync(pfad, "utf8"));
}

/** `schema.tafel` zerlegt. */
export function tafelName(voll: string): { schema: string; name: string } {
    const punkt = voll.indexOf(".");
    return { schema: voll.slice(0, punkt), name: voll.slice(punkt + 1) };
}

/** Die Tafeln, die mitkommen, in der Reihenfolge der Datei. */
export function mitgenommeneTafeln(regeln: AbzugRegeln): string[] {
    return Object.entries(regeln.tafeln)
        .filter(([, regel]) => regel.art === "mitnehmen")
        .map(([tafel]) => tafel);
}

export function regelFuer(regeln: AbzugRegeln, tafel: string): AbzugRegelTafel | undefined {
    return regeln.tafeln[tafel];
}

/** Die Tafeln, die lokal beim Einspielen mit geleert werden, weil ihre Zeilen auf mitgenommene verweisen. */
export function lokalZuLeerendeTafeln(regeln: AbzugRegeln): string[] {
    return Object.entries(regeln.tafeln)
        .filter(([, regel]) => regel.art === "weglassen" && regel.lokalLeeren === true)
        .map(([tafel]) => tafel);
}
