import { type KarteOrteZielart, type MamKarteDetail, type SearchHit } from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";

/**
 * Was der Kasten „Orte und Regionen“ am Eintrag der Kartensammlung rechnet (WI-0287 Stufe 3, Entwurf Fassung 6). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * - **Zweite Zeile** (`zielZeile`): Art und Gruppe, z. B. „Küste · Region“, „Dorf · Ort“; ist die Art gleich der Gruppe oder fehlt sie (Legacy-Zeilen), steht nur die Gruppe („Region“,
 *   „Herrschaftsgebiet“, „Gipfel“, „Weg“). Die Arten kommen aus den Tafeln der Suche (`place.<subtype>`, `landscape.type.<subtype>`), ein unbekannter Schlüssel nie roh.
 * - **Treffer** (`trefferAusSuche`): dieselbe Suche wie die Karte (`fetchSearch`), Orte (`kind: "ort"`) und Regionen (`kind: "landschaft"`). Nur mit öffentlicher Kennung: Bei einem Ort ist es
 *   `hit.id`, bei einer Landschaft die Region dahinter (`hit.region`; `hit.id` ist dort die Kennung des LABELS und kein Ziel). Höchstens acht.
 */

export type MamKarteOrt = MamKarteDetail["places"][number];
type OrtZiel = NonNullable<MamKarteOrt["target"]>;

/** Wie viele Treffer die Liste zeigt. */
export const ORTE_TREFFER_MAX = 8;
/** Ab so vielen Zeichen wird gesucht. */
export const ORTE_MIN_ZEICHEN = 2;

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Die Gruppe eines Ziels in Worten: Ort, Region, Herrschaftsgebiet, Gipfel, Weg. */
export const gruppenName = (kind: OrtZiel["kind"]): string => t(`medien.karten.ziel.${kind}` as MessageKey);

/** Die Art eines Ziels in Worten, oder `undefined`, wenn es keine führt oder die Tafel sie nicht kennt. */
export function artName(kind: OrtZiel["kind"], type: string | null | undefined): string | undefined {
    if (type === null || type === undefined || type === "") return undefined;
    const schluessel = kind === "place" ? `place.${type}` : kind === "region" ? `landscape.type.${type}` : "";
    return isMessageKey(schluessel) ? t(schluessel) : undefined;
}

/** Die zweite Zeile: „Art · Gruppe“, ist die Art gleich der Gruppe oder fehlt sie, nur die Gruppe. */
export function zielZeile(kind: OrtZiel["kind"], type: string | null | undefined): string {
    const gruppe = gruppenName(kind);
    const art = artName(kind, type);
    return art === undefined || art === gruppe ? gruppe : `${art} · ${gruppe}`;
}

/** Eine Zeile des Kastens, wie sie der Eintrag führt. */
export interface OrtZeile {
    /** Die Stelle in der Liste der aktiven Zeilen (so nennt sie der Server). */
    readonly index: number;
    /** Der Name des Ziels, sonst der Rohname aus Legacy. */
    readonly name: string;
    readonly rohname: string;
    readonly aufgeloest: boolean;
    /** Art und Gruppe; bei einer nicht aufgelösten Zeile `null`. */
    readonly zeile2: string | null;
    /** „Auf Karte zeigen“ gibt es für Orte, Herrschaftsgebiete und Regionen, die nicht stillgelegt sind (`medienAufKarte` in `app.vue`). */
    readonly aufKarte: NonNullable<MamKarteOrt["target"]> | null;
}

/** Die Arten, zu denen „Auf Karte zeigen“ fliegt; Gipfel und Wege hängt der Kasten nicht an. */
const AUF_KARTE: ReadonlySet<string> = new Set(["place", "territory", "region"]);

export function ortZeilen(orte: readonly MamKarteOrt[]): OrtZeile[] {
    return orte.map((ort, index) => {
        const ziel = ort.target;
        return {
            index,
            name: ziel?.name ?? ort.name,
            rohname: ort.name,
            aufgeloest: ziel !== null,
            zeile2: ziel === null ? null : zielZeile(ziel.kind, ziel.type),
            aufKarte: ziel !== null && ziel.active && AUF_KARTE.has(ziel.kind) ? ziel : null,
        };
    });
}

/** Die Schlüssel der Ziele, die schon am Eintrag hängen (`<art>:<kennung>`). */
export const schonAngehaengt = (orte: readonly MamKarteOrt[]): ReadonlySet<string> =>
    new Set(orte.flatMap((ort) => (ort.target === null ? [] : [zielSchluessel(ort.target.kind, ort.target.id)])));

export const zielSchluessel = (kind: string, id: string): string => `${kind}:${id}`;

/** Ein Treffer der Suche, wählbar als Ziel. */
export interface OrtTreffer {
    readonly kind: KarteOrteZielart;
    readonly id: string;
    readonly name: string;
    /** Art und Gruppe („Küste · Region“). */
    readonly zeile2: string;
    readonly schon: boolean;
}

/** Aus den Treffern der Kartensuche die Orte und Regionen mit öffentlicher Kennung, höchstens acht; die schon angehängten bleiben stehen, gesperrt. */
export function trefferAusSuche(treffer: readonly SearchHit[], schon: ReadonlySet<string>): OrtTreffer[] {
    const liste: OrtTreffer[] = [];
    for (const hit of treffer) {
        if (liste.length >= ORTE_TREFFER_MAX) break;
        const kind: KarteOrteZielart | undefined =
            hit.kind === "ort" ? "place" : hit.kind === "landschaft" ? "region" : undefined;
        if (kind === undefined) continue;
        const id = kind === "place" ? hit.id : hit.region;
        if (id === undefined || !KENNUNG.test(id)) continue;
        liste.push({
            kind,
            id,
            name: hit.name,
            zeile2: zielZeile(kind, hit.subtype),
            schon: schon.has(zielSchluessel(kind, id)),
        });
    }
    return liste;
}

/** Der Hinweis nach dem Speichern, je nach Handlung und Ziel (Entwurf Fassung 6, wörtlich). */
export type OrteHinweis =
    | { readonly art: "gespeichert"; readonly name: string; readonly kind: KarteOrteZielart }
    | { readonly art: "geloest"; readonly name: string }
    | { readonly art: "geloestOffen"; readonly name: string };

export function hinweisText(hinweis: OrteHinweis): string {
    switch (hinweis.art) {
        case "gespeichert":
            return t(
                hinweis.kind === "region"
                    ? "medien.karten.orteRegionen.gespeichertRegion"
                    : "medien.karten.orteRegionen.gespeichertOrt",
                { name: hinweis.name },
            );
        case "geloest":
            return t("medien.karten.orteRegionen.geloest", { name: hinweis.name });
        case "geloestOffen":
            return t("medien.karten.orteRegionen.geloestOffen", { name: hinweis.name });
    }
}
