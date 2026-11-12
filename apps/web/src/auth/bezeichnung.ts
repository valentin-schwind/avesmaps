import { BEZEICHNUNGEN, SONDERROLLEN_NAMEN, type Bezeichnung, type SonderrolleAnzeige } from "@avesmaps3d/shared";
import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die Rollen einer Person in ihrer Wortform (WI-0279 E10), für alle Stellen, die eine Person bezeichnen. Ohne Wahl steht die neutrale Form.
 * Wo eine Rolle als solche gemeint ist (Rollen & Rechte, Auswahl der Rolle, Protokoll), bleibt ihr Name aus `auth.role.<rolle>`.
 */
type Wahl = Bezeichnung | null | undefined;

function wortform(prefix: string, wert: string, bezeichnung: Wahl): string {
    const form = `${prefix}.${wert}.${bezeichnung ?? "neutral"}`;
    if (isMessageKey(form)) return t(form);
    const name = `${prefix}.${wert}`;
    return isMessageKey(name) ? t(name) : wert;
}

export const rollenName = (rolle: string, bezeichnung?: Wahl): string => wortform("auth.role", rolle, bezeichnung);
export const sonderrollenName = (sonderrolle: string, bezeichnung?: Wahl): string =>
    wortform("auth.sonderrolle", sonderrolle, bezeichnung);

export interface SonderrollenZeile {
    readonly sonderrolle: string;
    readonly name: string;
    readonly regionen: readonly string[];
    /** „Ortskundige:r (Weiden, Greifenfurt)“. */
    readonly text: string;
}

/** Je Sonderrolle eine Zeile in der Reihenfolge des Katalogs, die Regionen zusammengefasst (E3b). */
export function sonderrollenZeilen(
    rollen: readonly SonderrolleAnzeige[] | undefined,
    bezeichnung: Wahl,
): SonderrollenZeile[] {
    return SONDERROLLEN_NAMEN.flatMap((sonderrolle) => {
        const eigene = (rollen ?? []).filter((rolle) => rolle.sonderrolle === sonderrolle);
        if (eigene.length === 0) return [];
        const name = sonderrollenName(sonderrolle, bezeichnung);
        const regionen = eigene.flatMap((rolle) => (rolle.region === null ? [] : [rolle.region]));
        const text =
            regionen.length === 0 ? name : t("auth.sonderrolle.mitRegionen", { name, regionen: regionen.join(", ") });
        return [{ sonderrolle, name, regionen, text }];
    });
}

/**
 * Die drei Knöpfe im Konto: jeder zeigt die Wortform selbst. Dafür taugt die erste eigene Rolle, deren Formen sich unterscheiden (`Admin` hat
 * nur eine), sonst steht `Editor` als Beispiel; Sprachen ohne Formen bekommen das Adjektiv.
 */
export function bezeichnungsWahlen(
    rolle: string,
    rollen: readonly SonderrolleAnzeige[] | undefined,
): { value: Bezeichnung; label: string; hinweis: string }[] {
    const beispiele = [
        (form: Bezeichnung) => rollenName(rolle, form),
        ...(rollen ?? []).map((eigene) => (form: Bezeichnung) => sonderrollenName(eigene.sonderrolle, form)),
        (form: Bezeichnung) => rollenName("editor", form),
    ];
    const beispiel = beispiele.find((name) => new Set(BEZEICHNUNGEN.map(name)).size === BEZEICHNUNGEN.length);
    return BEZEICHNUNGEN.map((form) => {
        const hinweis = t(`auth.account.bezeichnung.${form}`);
        return { value: form, label: beispiel?.(form) ?? hinweis, hinweis };
    });
}
