import type { WikisyncRegelBedingung } from "@avesmaps3d/shared";
import { bedingungGruppen, gruppeKurz, verknuepfungName } from "../wikisync/wikisync-regeln-text";

/**
 * Der Satz einer Regel in Stücken (WI-0254; vorher in `inhalte-regel-karte.vue`, jetzt auch für die Vorschau von „Regeln als Text“): die Bedingungen mit UND, ODER und OHNE, gleiche ODER-Bedingungen
 * zusammengefasst, eine wartende Fläche mit „!“. Ohne Vue, damit Karte und Vorschau denselben Satz bauen.
 */

/** Ein Stück Satz; „!“ vor dem Namen einer Fläche, die es noch nicht gibt, steht hervorgehoben. */
export interface SatzStueck {
    text: string;
    bang: boolean;
}

export function satzStuecke(text: string): SatzStueck[] {
    const aus: SatzStueck[] = [];
    let rest = text;
    for (;;) {
        const treffer = /(^|\s)! /u.exec(rest);
        if (treffer === null) break;
        const vor = rest.slice(0, treffer.index + treffer[1]!.length);
        if (vor !== "") aus.push({ text: vor, bang: false });
        aus.push({ text: "!", bang: true });
        rest = ` ${rest.slice(treffer.index + treffer[0].length)}`;
    }
    if (rest !== "") aus.push({ text: rest, bang: false });
    return aus;
}

/** Eine Gruppe des Satzes: der Operator davor (leer bei der ersten) und ihre Stücke. */
export interface SatzGruppe {
    op: string | undefined;
    stuecke: SatzStueck[];
}

export const satzGruppen = (bedingungen: readonly WikisyncRegelBedingung[]): SatzGruppe[] =>
    bedingungGruppen(bedingungen).map((gruppe, i) => ({
        op: i === 0 ? undefined : verknuepfungName(gruppe[0]?.verknuepfung ?? "und"),
        stuecke: satzStuecke(gruppeKurz(gruppe)),
    }));

/** Der Satz als Text, etwa für den Namen einer Karte für Vorleser. */
export const satzText = (gruppen: readonly SatzGruppe[]): string =>
    gruppen.map((g) => `${g.op ?? ""} ${g.stuecke.map((s) => s.text).join("")}`).join(" ");
