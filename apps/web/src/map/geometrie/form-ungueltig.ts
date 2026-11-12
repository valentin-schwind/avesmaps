import { t } from "../../i18n/i18n";
import type { Marke, Punkt } from "./geometrie";

/**
 * Eine ungültige Form beim Speichern (Vali 2026-11-09 zu „Die Form schneidet sich selbst, oder ein Loch liegt über ihrem Rand.“: „kurze
 * hilfe, was bedeutet das“, dann „Ja, bauen“ auf die Frage, ob der Editor die Stelle markieren soll). Der Server schickt mit dem Code
 * `form_ungueltig` in `details`, was falsch ist (`art`), wo (`stelle`, Kartenkoordinaten aus `ST_IsValidDetail`) und an welcher Fläche
 * (`landschaft`: die eigene oder ein mitgezogener Nachbar; `apps/server/src/editor/landscape-reshape.ts`).
 *
 * - Die Leiste und der Fuß sagen es in der Sprache der Oberfläche (`abgelehntSatz`), nicht mit dem deutschen Satz des Servers.
 * - „Ecken bearbeiten“ markiert die Stelle mit einem roten Ring und fliegt hin (`landschaftseditor/ecken-anbindung.ts`). Die Marke gilt nur
 *   für den Stand, den der Server abgelehnt hat: Der nächste Schritt, ↶, Verwerfen und das Ende des Modus nehmen sie weg (`formFehlerMarken`).
 * - Ein Server ohne Stelle (vor diesem Release) bleibt beim Satz des Servers.
 * - **Dazu seit 2026-11-10** (Vali: „editoren werden immer wieder beim editieren gehindert“): `ring_unter_drei` (Art `zu_wenig_ecken`) und
 *   `nachbar_umgezeichnet` tragen ebenso `stelle` und die Fläche, beim Gebiet als `gebiet` statt `landschaft`. Der Editor prüft jeden
 *   Schritt schon mit derselben Regel (`form-regel.ts`); hier kommt nur noch an, was ein älterer Entwurf mitbringt.
 */

export type FormFehlerArt =
    "schneidet_sich" | "beruehrt_sich" | "loch_ueber_rand" | "sonst" | "zu_wenig_ecken" | "nachbar_umgezeichnet";

const ARTEN: readonly FormFehlerArt[] = [
    "schneidet_sich",
    "beruehrt_sich",
    "loch_ueber_rand",
    "zu_wenig_ecken",
    "sonst",
];

export interface FormUngueltig {
    readonly art: FormFehlerArt;
    readonly stelle: Punkt;
    /** Der Name der Fläche, an der die Stelle liegt. */
    readonly name: string;
    /** Die bearbeitete Fläche selbst (`true`) oder ein mitgezogener Nachbar. */
    readonly eigene: boolean;
}

/** Was eine Ablehnung trägt (`BearbeitungsZustand` „abgelehnt“ in `fenster/bearbeitung.ts`). */
export interface Ablehnung {
    readonly art: string;
    readonly satz?: string;
    readonly details?: Readonly<Record<string, unknown>> | undefined;
}

/** Die Gründe des Servers, die eine Stelle tragen. */
const GRUENDE: ReadonlySet<unknown> = new Set(["form_ungueltig", "ring_unter_drei", "nachbar_umgezeichnet"]);

const zahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

/** Die ungültige Form aus einer Ablehnung; `undefined`, wenn es keine ist oder der Server keine Stelle nennt. */
export function formUngueltigAus(zustand: Ablehnung | undefined): FormUngueltig | undefined {
    if (zustand?.art !== "abgelehnt") return undefined;
    const details = zustand.details;
    const grund = details?.["reason"];
    if (details === undefined || !GRUENDE.has(grund)) return undefined;
    const stelle = details["stelle"] as { x?: unknown; y?: unknown } | undefined;
    if (!zahl(stelle?.x) || !zahl(stelle?.y)) return undefined;
    const landschaft = (details["landschaft"] ?? details["gebiet"]) as { name?: unknown; eigene?: unknown } | undefined;
    const art: FormFehlerArt =
        grund === "ring_unter_drei"
            ? "zu_wenig_ecken"
            : grund === "nachbar_umgezeichnet"
              ? "nachbar_umgezeichnet"
              : (ARTEN.find((bekannt) => bekannt === details["art"]) ?? "sonst");
    return {
        art,
        stelle: { x: stelle.x, y: stelle.y },
        name: typeof landschaft?.name === "string" ? landschaft.name : "",
        eigene: landschaft?.eigene !== false,
    };
}

/** Der Satz dazu: was falsch ist und was zu tun ist; bei einem Nachbarn, warum er dabei ist. */
export function formUngueltigSatz(form: FormUngueltig, telefon = false): string {
    const name = form.name;
    const satz = {
        schneidet_sich: () => t("formentwurf.ungueltig.schneidetSich", { name }),
        beruehrt_sich: () => t("formentwurf.ungueltig.beruehrtSich", { name }),
        loch_ueber_rand: () => t("formentwurf.ungueltig.lochUeberRand", { name }),
        sonst: () => t("formentwurf.ungueltig.sonst", { name }),
        zu_wenig_ecken: () => t("formentwurf.ungueltig.zuWenigEcken", { name }),
        nachbar_umgezeichnet: () => t("formentwurf.ungueltig.nachbarUmgezeichnet", { name }),
    }[form.art]();
    // Am umgezeichneten Nachbarn sagt der Satz schon, worum es geht.
    if (form.eigene || form.art === "nachbar_umgezeichnet") return satz;
    const nachbar = telefon
        ? t("formentwurf.ungueltig.nachbarFinger", { name })
        : t("formentwurf.ungueltig.nachbar", { name });
    return `${satz} ${nachbar}`;
}

/** Der Satz einer Ablehnung für Leiste und Fuß: bei einer ungültigen Form der eigene, sonst der des Servers. */
export function abgelehntSatz(zustand: Ablehnung & { readonly satz: string }, telefon = false): string {
    const form = formUngueltigAus(zustand);
    return form === undefined ? zustand.satz : formUngueltigSatz(form, telefon);
}

/**
 * Die Marke an der Stelle, solange der abgelehnte Stand steht: `abgelehnt` ist der Stand beim Ablehnen, `jetzt` der heutige (der Entwurf
 * ersetzt ihn bei jedem Schritt, ↶ und Verwerfen durch einen neuen).
 */
export function formFehlerMarken(
    form: FormUngueltig | undefined,
    abgelehnt: unknown,
    jetzt: unknown,
): readonly Marke[] {
    return form === undefined || abgelehnt !== jetzt ? [] : [{ at: form.stelle, art: "fehler" }];
}
