import type { SearchLeuchtAnfrage, SearchLeuchten, SearchLeuchtenForm, VorkommenRahmen } from "@avesmaps3d/shared";
import { leuchtenUrl } from "./search-client";

/**
 * Mehrere Leuchtanfragen als EIN Leuchten (WI-0257 S5, Vali 2026-10-30: „Vorkommen unterwegs“ mit Mehrfachauswahl): Alle gewählten Einträge leuchten
 * zusammen. Die Vereinigung entsteht im Browser aus den Antworten der vorhandenen Route (`GET /api/search/leuchten`), eine je Eintrag; einen
 * Endpunkt für mehrere gibt es nicht. REIN: Antworten hinein, eine Antwort hinaus, die die Karte zeichnet wie jede andere (`map/such-leuchten.ts`).
 */

/**
 * Der Schlüssel der Vereinigung, wie `aktiv` ihn trägt: Bei EINER Anfrage ist es ihre Adresse (`leuchtenUrl`), damit „Alle zeigen“ in der Infobox
 * des einen Eintrags gewählt steht wie bisher; bei mehreren die sortierten Adressen, unabhängig von der Reihenfolge der Wahl.
 */
export function vereinigtSchluessel(anfragen: readonly SearchLeuchtAnfrage[]): string {
    const adressen = anfragen.map(leuchtenUrl);
    if (adressen.length === 1) return adressen[0] as string;
    return [...new Set(adressen)].sort().join("\n");
}

function rahmenVon(rahmen: readonly (VorkommenRahmen | null)[]): VorkommenRahmen | null {
    let raus: VorkommenRahmen | null = null;
    for (const r of rahmen) {
        if (r === null) continue;
        raus =
            raus === null
                ? { ...r }
                : {
                      x0: Math.min(raus.x0, r.x0),
                      y0: Math.min(raus.y0, r.y0),
                      x1: Math.max(raus.x1, r.x1),
                      y1: Math.max(raus.y1, r.y1),
                  };
    }
    return raus;
}

const einmal = <T>(liste: readonly T[], schluessel: (eintrag: T) => string): T[] => {
    const gesehen = new Set<string>();
    return liste.filter((eintrag) => {
        const k = schluessel(eintrag);
        if (gesehen.has(k)) return false;
        gesehen.add(k);
        return true;
    });
};

/**
 * Die Vereinigung der Antworten: ganze Gegenden und Gebiete je Kennung einmal, angeschnittene Stücke und Orte alle (ein Ort je Kennung einmal), der Rahmen
 * umfasst alle. Was keiner Landschaft gehört (`rest`), wird ein angeschnittenes Stück mit der Kennung seines Eintrags: Die Karte zeichnet beides gleich, und
 * eine Antwort kennt nur EINEN Rest. Der Kontinent steht als Umriss, sobald einer der Einträge nur „Aventurien“ nennt. Eine ausgeblendete Art (`pausiert`)
 * trägt nichts bei. Bei EINER Antwort ist die Vereinigung diese Antwort selbst (dieselbe Gestalt, dieselben gemerkten Merkmale der Karte).
 */
export function vereinigeLeuchten(antworten: readonly SearchLeuchten[]): SearchLeuchten | undefined {
    if (antworten.length <= 1) return antworten[0];
    const sichtbar = antworten.filter((antwort) => !antwort.pausiert);
    const erste = sichtbar[0];
    if (erste === undefined) return antworten[0];
    if (sichtbar.length === 1) return erste;
    const reste: SearchLeuchtenForm[] = sichtbar.flatMap((antwort) =>
        antwort.rest === undefined
            ? []
            : [
                  {
                      publicId: antwort.begriff.eintrag ?? erste.begriff.eintrag ?? "",
                      name: antwort.titel,
                      form: antwort.rest.form,
                      rahmen: antwort.rest.rahmen,
                  },
              ],
    );
    const ganz = einmal(
        sichtbar.flatMap((antwort) => antwort.ganz),
        (id) => id,
    );
    const gebieteGanz = einmal(
        sichtbar.flatMap((antwort) => antwort.gebiete.ganz),
        (id) => id,
    );
    const angeschnitten = [...sichtbar.flatMap((antwort) => antwort.angeschnitten), ...reste];
    const gebieteAngeschnitten = sichtbar.flatMap((antwort) => antwort.gebiete.angeschnitten);
    const kontinent = sichtbar.find((antwort) => antwort.nurKontinent && antwort.kontinent !== undefined)?.kontinent;
    return {
        titel: sichtbar.map((antwort) => antwort.titel).join(" · "),
        begriff: erste.begriff,
        pausiert: false,
        ganz,
        angeschnitten,
        gebiete: { ganz: gebieteGanz, angeschnitten: gebieteAngeschnitten },
        orte: einmal(
            sichtbar.flatMap((antwort) => antwort.orte),
            (ort) => ort.id,
        ),
        gegenden: ganz.length + gebieteGanz.length + angeschnitten.length - reste.length + gebieteAngeschnitten.length,
        rahmen: rahmenVon(sichtbar.map((antwort) => antwort.rahmen)),
        nurKontinent: kontinent !== undefined,
        ...(kontinent === undefined ? {} : { kontinent }),
    };
}
