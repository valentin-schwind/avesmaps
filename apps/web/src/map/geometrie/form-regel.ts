import {
    AVENTURIA,
    RING_MINDESTENS,
    abweichendeEcke,
    bereinigeRing,
    formMangel,
    imKartenraum,
    ringSchluessel,
    type RingPunkt,
} from "@avesmaps3d/shared";
import type { FormStand } from "./formentwurf";
import type { Punkt, Teil } from "./geometrie";

/**
 * Jeder Schritt eines Formentwurfs mit der Rechnung des Servers geprüft (Vali 2026-11-10 zu zwei Ablehnungen an Fläche-452: „editoren
 * werden immer wieder beim editieren gehindert. kannst du irgendwas machen, dass solche sachen nicht passieren“). Die Regeln stehen EINMAL
 * in `@avesmaps3d/shared` (`flaechen-ringe.ts`); der Server prüft mit ihnen „Fertig“ (`landscape-reshape.ts`, `territory-reshape.ts`).
 *
 * Zwei Ablehnungen kamen erst beim Speichern, obwohl der Editor die Schritte davor zuließ:
 *
 * - **`zu_wenig_ecken`** (`ring_unter_drei`): Aufeinanderliegende Ecken werden beim Speichern eine. Rastet eine Ecke auf einer Ecke in der
 *   Nähe ein (in einem schmalen Streifen bei Zoom 7 leicht), zählt der Editor zwei, der Server eine. Ein kleiner Ring, eigener oder des
 *   Nachbarn, fällt so unter drei Ecken.
 * - **`nachbar_umgezeichnet`**: Rastet eine Ecke auf einer Ecke des Nachbarn ein, die vorher nicht gemeinsam war, zieht der Editor sie danach
 *   mit. Löst man die beiden später (Strg) oder löscht die eigene Ecke, bleibt die Ecke des Nachbarn dort, wo die Fläche nicht ist. Der
 *   Server sieht nur Anfang und Ende: für ihn ein umgezeichneter Nachbar.
 *
 * Dazu, was der Server sonst an der Form ablehnt und der Editor beim Ziehen erzeugen kann (Bestandsaufnahme 2026-11-10, WI-0178):
 *
 * - **`schneidet_sich`, `beruehrt_sich`** (`form_ungueltig`; `flaechen-gueltig.ts`): Eine Kante kreuzt eine andere, oder eine Ecke landet
 *   auf dem eigenen Rand, im schmalen Streifen etwa beim Einrasten an der Ecke gegenüber. Geprüft an der eigenen Fläche und an jedem
 *   mitgezogenen Nachbarn. Beim Gebiet prüft der Server das nicht; der Editor hält es trotzdem fern.
 * - **`ausserhalb`** (`ecke_ausserhalb`): eine Ecke außerhalb der Karte.
 *
 * Ein Schritt, der eine solche Lage NEU schafft, wird nicht übernommen (`neueVerstoesse`): Der Formentwurf meldet die Stelle, markiert sie
 * rot und bleibt beim Stand davor. Was ein Entwurf schon mitbringt (gesichert vor diesem Release), hält keinen Schritt auf; das sagt der
 * Server beim Speichern mit Stelle (`form-ungueltig.ts`).
 */

export type FormVerstossGrund =
    "zu_wenig_ecken" | "nachbar_umgezeichnet" | "schneidet_sich" | "beruehrt_sich" | "ausserhalb";

export interface FormVerstoss {
    readonly grund: FormVerstossGrund;
    readonly objekt: string;
    readonly nr: number;
    /** Der Name der Fläche, an der es liegt. */
    readonly name: string;
    /** Die bearbeitete Fläche selbst (`true`) oder ein Nachbar. */
    readonly eigene: boolean;
    readonly stelle: Punkt;
}

const tupel = (teil: Teil): RingPunkt[] => teil.punkte.map((p) => [p.x, p.y] as const);
const punkt = (p: RingPunkt): Punkt => ({ x: p[0], y: p[1] });
const gleicheLage = (a: Teil, b: Teil): boolean =>
    a.punkte === b.punkte ||
    (a.punkte.length === b.punkte.length &&
        a.punkte.every((p, i) => ringSchluessel([p.x, p.y]) === ringSchluessel([b.punkte[i]!.x, b.punkte[i]!.y])));

const was = (teil: Teil, eigene: boolean): Pick<FormVerstoss, "objekt" | "nr" | "name" | "eigene"> => ({
    objekt: teil.objekt,
    nr: teil.nr,
    name: teil.name,
    eigene,
});

/** Die Ecken der eigenen Teile als Schlüssel; je Stand einmal gerechnet. */
const eckenJeStand = new WeakMap<readonly Teil[], Set<string>>();
function eckenVon(teile: readonly Teil[]): Set<string> {
    let ecken = eckenJeStand.get(teile);
    if (ecken === undefined) {
        ecken = new Set(teile.flatMap((teil) => teil.punkte.map((p) => ringSchluessel([p.x, p.y]))));
        eckenJeStand.set(teile, ecken);
    }
    return ecken;
}

const GRENZEN = AVENTURIA.coordinateSpace.bounds;

/** War ein Objekt schon beim Start mangelhaft (Legacy)? Je Start und Objekt einmal gerechnet. */
const schonMangelhaft = new WeakMap<readonly Teil[], Map<string, boolean>>();
function warMangelhaft(start: readonly Teil[], objekt: string): boolean {
    let jeObjekt = schonMangelhaft.get(start);
    if (jeObjekt === undefined) {
        jeObjekt = new Map();
        schonMangelhaft.set(start, jeObjekt);
    }
    let war = jeObjekt.get(objekt);
    if (war === undefined) {
        const ringe = start.filter((t) => t.objekt === objekt && t.art === "ring").map(tupel);
        war = formMangel(ringe) !== undefined;
        jeObjekt.set(objekt, war);
    }
    return war;
}

/**
 * Kreuzt oder berührt sich ein Objekt (alle seine Ringe), an den Ringen, die sich gegenüber dem Start geändert haben? Ein Objekt, das schon
 * beim Start mangelhaft war (Legacy, auf der Stage am 2026-11-10 19 von 906 Gebietsflächen), bleibt bearbeitbar, wie am Server
 * (`ST_IsValid(alt) AND NOT ST_IsValid(neu)`): Sonst nähme der Editor an seinem Rand keinen Schritt mehr an.
 */
function formMaengel(
    objekte: Map<string, Teil[]>,
    start: readonly Teil[],
    eigene: boolean,
    raus: FormVerstoss[],
): void {
    for (const [objekt, ringe] of objekte) {
        if (warMangelhaft(start, objekt)) continue;
        const geaendert = ringe.map((teil) => {
            const vorher = start.find((t) => t.objekt === teil.objekt && t.nr === teil.nr);
            return vorher === undefined || !gleicheLage(vorher, teil);
        });
        if (!geaendert.some(Boolean)) continue;
        const befund = formMangel(ringe.map(tupel), (ring) => geaendert[ring] === true);
        if (befund !== undefined)
            raus.push({ ...was(ringe[befund.ring]!, eigene), grund: befund.art, stelle: punkt(befund.stelle) });
    }
}

/** Die Ringe je Objekt, nur Ringe. */
function jeObjekt(teile: readonly Teil[]): Map<string, Teil[]> {
    const raus = new Map<string, Teil[]>();
    for (const teil of teile) if (teil.art === "ring") raus.set(teil.objekt, [...(raus.get(teil.objekt) ?? []), teil]);
    return raus;
}

/** Eine Ecke der geänderten Ringe außerhalb der Karte. */
function ausserhalb(teile: readonly Teil[], start: readonly Teil[], eigene: boolean, raus: FormVerstoss[]): void {
    for (const teil of teile) {
        const vorher = start.find((t) => t.objekt === teil.objekt && t.nr === teil.nr);
        if (teil.art !== "ring" || (vorher !== undefined && gleicheLage(vorher, teil))) continue;
        const draussen = teil.punkte.find((p) => !imKartenraum([p.x, p.y], GRENZEN));
        if (draussen !== undefined) raus.push({ ...was(teil, eigene), grund: "ausserhalb", stelle: draussen });
    }
}

/**
 * Was der Server an `jetzt` gegenüber `start` ablehnen würde: Ringe unter drei Ecken, Ecken außerhalb der Karte, Nachbarn mit mehr als den
 * gemeinsamen Ecken, Flächen, die sich kreuzen oder berühren.
 */
export function formVerstoesse(start: FormStand, jetzt: FormStand): FormVerstoss[] {
    const raus: FormVerstoss[] = [];
    for (const teil of jetzt.teile) {
        if (teil.art !== "ring") continue;
        const ring = bereinigeRing(tupel(teil));
        const ecke = ring[0] ?? tupel(teil)[0];
        if (ring.length < RING_MINDESTENS && ecke !== undefined)
            raus.push({ ...was(teil, true), grund: "zu_wenig_ecken", stelle: punkt(ecke) });
    }
    const eigeneAlt = eckenVon(start.teile);
    const eigeneNeu = eckenVon(jetzt.teile);
    for (const teil of jetzt.nachbarn) {
        if (teil.art !== "ring") continue;
        const vorher = start.nachbarn.find((t) => t.objekt === teil.objekt && t.nr === teil.nr);
        if (vorher === undefined || gleicheLage(vorher, teil)) continue;
        const ring = bereinigeRing(tupel(teil));
        if (ring.length < RING_MINDESTENS) {
            const ecke = ring[0] ?? tupel(teil)[0];
            if (ecke !== undefined) raus.push({ ...was(teil, false), grund: "zu_wenig_ecken", stelle: punkt(ecke) });
            continue;
        }
        const ecke = abweichendeEcke(bereinigeRing(tupel(vorher)), ring, eigeneAlt, eigeneNeu);
        if (ecke !== undefined) raus.push({ ...was(teil, false), grund: "nachbar_umgezeichnet", stelle: punkt(ecke) });
    }
    ausserhalb(jetzt.teile, start.teile, true, raus);
    ausserhalb(jetzt.nachbarn, start.nachbarn, false, raus);
    formMaengel(jeObjekt(jetzt.teile), start.teile, true, raus);
    formMaengel(jeObjekt(jetzt.nachbarn), start.nachbarn, false, raus);
    return raus;
}

const kennung = (v: FormVerstoss): string => `${v.grund} ${v.objekt} ${String(v.nr)}`;

/** Was erst der Schritt von `vorher` nach `nachher` schafft; was `vorher` schon hatte, zählt nicht. */
export function neueVerstoesse(start: FormStand, vorher: FormStand, nachher: FormStand): FormVerstoss[] {
    const neu = formVerstoesse(start, nachher);
    if (neu.length === 0) return neu;
    const alt = new Set(formVerstoesse(start, vorher).map(kennung));
    return neu.filter((v) => !alt.has(kennung(v)));
}
