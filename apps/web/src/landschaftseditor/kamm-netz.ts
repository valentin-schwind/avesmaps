import {
    linieMitHoehen,
    punktHoeheBegrenzt,
    type EditorGebirge,
    type EditorLandscapePeak,
    type LinienRang,
    type PunktHoehe,
    type PunktHoehen,
} from "@avesmaps3d/shared";
import type { Punkt, Teil, Ziel } from "../map/geometrie/geometrie";
import { schluessel } from "../map/geometrie/rechnung";
import { KEIN_GEWAESSER, mitWasserHoehen, wasserHoehe, type Gewaesser, type WasserTeil } from "./kamm-netz-wasser";

/**
 * Das gezeichnete Netz eines Gebirges im Entwurf (WI-0245 D2; EDIT-0003 §6 „Gebirgsnetz“; Bauvorlage Gebirge-Entwurf V16): reine Rechnung
 * zwischen dem Netz, wie es der Entwurf hält (`EditorGebirge["stand"]["netz"]`, Netzvertrag der Topographie), und den Teilen des
 * Geometrie-Moduls (Art `GEBIRGSNETZ`).
 *
 * - **EIN Objekt je Gebirgsfläche** (`objekt` = Kennung der Teilfläche): die Kämme als Linien mit `nr` 0 bis n−1 in ihrer Folge, dahinter
 *   die Nebengipfel als Punkte. So bleibt jede `nr` stabil, solange kein Kamm dazukommt oder geht.
 * - **Ziele** zum Einrasten: die Gipfel des Gebirges und die Nebengipfel (`gipfel`), die Punkte der Kämme (`ecke`, mit Stelle).
 * - **Höhen je Punkt** (WI-0249 P9): Jeder Stützpunkt einer Kamm- oder Tallinie, jeder Nebengipfel und jede Mulde hat eine Höhe (eigen oder
 *   die Vorgabe des Modells). Ein Ort hat EINE Höhe: Setzen trifft alle deckungsgleichen Punkte des Netzes (`mitHoehen`).
 * - **Flüsse und Seen** (WI-0249, WI-0259): Ihre Stücke stehen hinter Kämmen, Nebengipfeln und Mulden (`wasserBasis`), nur zum Wählen. „Löschen“ nimmt
 *   an ihnen nur die eigenen Höhen weg (`ohneAuswahl`, `loeschArt`); den Verlauf ändert nur der Wegeditor.
 * - Nichts hier fragt den Server oder die Karte.
 */

export type GebirgsNetz = EditorGebirge["stand"]["netz"];
export const LEERES_NETZ: GebirgsNetz = { kaemme: [], nebengipfel: [] };

/** Steht im Netz schon etwas Gezeichnetes: ein Kamm (auch ein Tal), ein Nebengipfel oder eine Mulde? */
export const netzHatTeile = (netz: GebirgsNetz): boolean =>
    netz.kaemme.length > 0 || netz.nebengipfel.length > 0 || (netz.mulden?.length ?? 0) > 0;

/**
 * Das Werkzeug beim Öffnen von „Kämme zeichnen“ (OPS-055, OPS-057; Thomas fand weder Punkt löschen noch verschieben noch nachträgliches
 * Bearbeiten): Hat das Gebirge schon ein Netz, öffnet der Modus mit „Wählen“ (ziehen, Doppelklick, Entf); ohne Netz beginnt er mit dem
 * Zeichnen des ersten Kamms.
 */
export const startWerkzeug = (netz: GebirgsNetz): "kamm" | "waehlen" => (netzHatTeile(netz) ? "waehlen" : "kamm");

/** Eine Stelle der Auswahl: ein ganzer Teil (`index` fehlt) oder ein Stützpunkt einer Linie. */
export interface NetzStelle {
    readonly nr: number;
    readonly index?: number | undefined;
}
/** Ein einzelner Punkt des Netzes: Stützpunkt einer Linie, sonst Nebengipfel oder Mulde mit `index` 0. */
export interface NetzPunkt {
    readonly nr: number;
    readonly index: number;
}

const punkt = ([x, y]: readonly [number, number]): Punkt => ({ x, y });
const paar = (p: Punkt): [number, number] => [p.x, p.y];

/** Wo die Gewässer in der Folge der `nr` beginnen: hinter Kämmen, Nebengipfeln und Mulden (WI-0249, `kamm-netz-wasser.ts`). */
export const wasserBasis = (netz: GebirgsNetz): number =>
    netz.kaemme.length + netz.nebengipfel.length + (netz.mulden?.length ?? 0);

/** Der Fluss- oder Seeteil zu einer `nr`, sonst keiner. */
export function wasserTeilVon(netz: GebirgsNetz, gew: Gewaesser, nr: number): WasserTeil | undefined {
    const i = nr - wasserBasis(netz);
    return i >= 0 ? gew.teile[i] : undefined;
}

/** Die Teile des Geometrie-Moduls zu einem Netz; dahinter die Flüsse und Seen nur zum Wählen (`Teil.fest`, WI-0249). */
export function teileAus(
    flaeche: string,
    name: string,
    netz: GebirgsNetz,
    revision: number,
    gew: Gewaesser = KEIN_GEWAESSER,
): Teil[] {
    const kaemme: Teil[] = netz.kaemme.map((kamm, nr) => ({
        objekt: flaeche,
        name,
        nr,
        art: "linie",
        punkte: kamm.punkte.map(punkt),
        revision,
    }));
    const gipfel: Teil[] = netz.nebengipfel.map((n, i) => ({
        objekt: flaeche,
        name,
        nr: netz.kaemme.length + i,
        art: "punkt",
        punkte: [{ x: n.x, y: n.y }],
        revision,
    }));
    const mulden = (netz.mulden ?? []).map((n, i): Teil => ({
        objekt: flaeche,
        name,
        nr: kaemme.length + gipfel.length + i,
        art: "punkt",
        punkte: [{ x: n.x, y: n.y }],
        revision,
    }));
    const basis = wasserBasis(netz);
    const wasser = gew.teile.map((teil, i): Teil => ({
        objekt: flaeche,
        name,
        nr: basis + i,
        art: teil.art === "fluss" && teil.punkte.length > 1 ? "linie" : "punkt",
        punkte: teil.punkte,
        revision,
        fest: true,
        // Die Nachbarn im Flussweg gehen in die Rundung ein (Catmull-Rom wie auf der Karte, `flussKurve` in `arten.ts`).
        ...(teil.vor === undefined && teil.nach === undefined ? {} : { anschluss: { vor: teil.vor, nach: teil.nach } }),
    }));
    return [...kaemme, ...gipfel, ...mulden, ...wasser];
}

/**
 * Die Punkthöhen einer Linie nach einer Handbewegung (WI-0249 P9): Gleich viele Punkte behalten ihre Höhen an ihrer Stelle (Ziehen). Sonst
 * folgt jede Höhe ihrem Punkt (gleiche Lage); ein neu eingefügter Punkt bekommt die Höhe zwischen seinen Nachbarn mit eigener Höhe (über die
 * Strecke gemittelt), mit nur einem solchen Nachbarn dessen Höhe, sonst die Vorgabe. Ein gelöschter Punkt nimmt seine Höhe mit.
 */
function hoehenNachZug(
    alt: readonly (readonly [number, number])[],
    neu: readonly Punkt[],
    hoehen: readonly (number | null)[] | undefined,
): (number | null)[] | undefined {
    if (hoehen === undefined || alt.length === neu.length) return hoehen?.slice();
    const schluesselAlt = alt.map((p) => schluessel(punkt(p)));
    let i = 0;
    const zugeordnet = neu.map((p) => {
        const k = schluessel(p);
        const gefunden = schluesselAlt.indexOf(k, i);
        if (gefunden < 0) return undefined;
        i = gefunden + 1;
        return hoehen[gefunden] ?? null;
    });
    return zugeordnet.map((h, j) => {
        if (h !== undefined) return h;
        let a = j - 1;
        while (a >= 0 && (zugeordnet[a] === undefined || zugeordnet[a] === null)) a--;
        let b = j + 1;
        while (b < neu.length && (zugeordnet[b] === undefined || zugeordnet[b] === null)) b++;
        const ha = a >= 0 ? (zugeordnet[a] as number) : null;
        const hb = b < neu.length ? (zugeordnet[b] as number) : null;
        if (ha === null || hb === null) return ha ?? hb;
        const d = (u: number, v: number) => Math.hypot(neu[v]!.x - neu[u]!.x, neu[v]!.y - neu[u]!.y);
        const vorn = d(a, j);
        return Math.round(ha + ((hb - ha) * vorn) / Math.max(1e-9, vorn + d(j, b)));
    });
}

/** Das Netz nach einer Handbewegung: die Lagen aus den Teilen, Rang und Höhe aus dem Netz davor (die `nr` bleiben gleich). */
export function netzAus(teile: readonly Teil[], vorher: GebirgsNetz): GebirgsNetz {
    const kaemme = vorher.kaemme.map((kamm, nr) => {
        const teil = teile.find((t) => t.nr === nr);
        if (teil === undefined) return kamm;
        return linieMitHoehen(teil.punkte.map(paar), kamm.rang, hoehenNachZug(kamm.punkte, teil.punkte, kamm.hoehen));
    });
    const nebengipfel = vorher.nebengipfel.map((n, i) => {
        const p = teile.find((t) => t.nr === vorher.kaemme.length + i)?.punkte[0];
        return p === undefined ? n : { x: p.x, y: p.y, h: n.h };
    });
    const mulden = vorher.mulden?.map((n, i) => {
        const p = teile.find((t) => t.nr === vorher.kaemme.length + vorher.nebengipfel.length + i)?.punkte[0];
        return p === undefined ? n : { ...n, x: p.x, y: p.y };
    });
    // Die Höhen an Flüssen und Seen (WI-0249) bleiben: Ihre Lage ändert kein Zug.
    return { ...vorher, kaemme, nebengipfel, ...(mulden === undefined ? {} : { mulden }) };
}

/** Ist diese `nr` ein Kamm oder ein Nebengipfel? */
export const istKamm = (netz: GebirgsNetz, nr: number): boolean => nr >= 0 && nr < netz.kaemme.length;
export const istNebengipfel = (netz: GebirgsNetz, nr: number): boolean =>
    nr >= netz.kaemme.length && nr < netz.kaemme.length + netz.nebengipfel.length;

export const istMulde = (netz: GebirgsNetz, nr: number): boolean =>
    nr >= netz.kaemme.length + netz.nebengipfel.length &&
    nr < netz.kaemme.length + netz.nebengipfel.length + (netz.mulden?.length ?? 0);

/** Eine neue Mulde; ohne Höhe gilt ihr Boden aus dem Talboden (kein Punkt bekommt einen Startwert, WI-0249). */
export const mitMulde = (netz: GebirgsNetz, at: Punkt): GebirgsNetz => ({
    ...netz,
    mulden: [...(netz.mulden ?? []), { x: at.x, y: at.y, h: null }],
});

/** Ein neuer Kamm am Ende der Folge, mit den Punkthöhen seiner Stützpunkte (`null` = Vorgabe). */
export const mitKamm = (
    netz: GebirgsNetz,
    punkte: readonly Punkt[],
    rang: LinienRang,
    hoehen?: readonly (number | null)[],
): GebirgsNetz => ({
    ...netz,
    kaemme: [...netz.kaemme, linieMitHoehen(punkte.map(paar), rang, hoehen)],
});

/** Ein neuer Nebengipfel; mit `h` gespeichert, ohne (neu gesetzt, WI-0249: kein Startwert) gilt die Vorgabe des Modells. */
export const mitNebengipfel = (netz: GebirgsNetz, at: Punkt, h: number | null = null): GebirgsNetz => ({
    ...netz,
    nebengipfel: [...netz.nebengipfel, { x: at.x, y: at.y, h: punktHoeheBegrenzt(h) }],
});

/** Einen Kamm oder Nebengipfel entfernen (die `nr` dahinter rücken nach). */
export function ohneTeil(netz: GebirgsNetz, nr: number): GebirgsNetz {
    if (istKamm(netz, nr)) return { ...netz, kaemme: netz.kaemme.filter((_, i) => i !== nr) };
    if (istNebengipfel(netz, nr)) {
        const i = nr - netz.kaemme.length;
        return { ...netz, nebengipfel: netz.nebengipfel.filter((_, j) => j !== i) };
    }
    if (istMulde(netz, nr))
        return {
            ...netz,
            mulden: netz.mulden!.filter((_, i) => i !== nr - netz.kaemme.length - netz.nebengipfel.length),
        };
    return netz;
}

/** Mehrere Teile entfernen (die gewählten), von hinten, damit die `nr` davor stimmen. */
export function ohneTeile(netz: GebirgsNetz, nrn: readonly number[]): GebirgsNetz {
    return [...new Set(nrn)].sort((a, b) => b - a).reduce(ohneTeil, netz);
}

/** Die gewählten Punkte von Flüssen und Seen, die eine eigene Höhe tragen (WI-0259). */
export function wasserPunkteMitHoehe(
    netz: GebirgsNetz,
    auswahl: readonly NetzStelle[],
    gew: Gewaesser = KEIN_GEWAESSER,
): NetzPunkt[] {
    return punkteDerAuswahl(
        netz,
        auswahl.filter((s) => wasserTeilVon(netz, gew, s.nr) !== undefined),
        gew,
    ).filter((p) => {
        const h = eigeneHoehe(netz, p, gew);
        return h !== null && h !== undefined;
    });
}

/**
 * Was „Löschen“ und Entf an der Auswahl tun können (WI-0259): `teile` entfernt gewählte Kämme, Nebengipfel und Mulden (und nimmt eigene Höhen
 * gewählter Flusspunkte mit), `hoehen` nimmt nur die eigenen Höhen gewählter Flusspunkte und Seen weg (den Verlauf eines Flusses ändert nur der
 * Wegeditor), `undefined`: nichts davon.
 */
export function loeschArt(
    netz: GebirgsNetz,
    auswahl: readonly NetzStelle[],
    gew: Gewaesser = KEIN_GEWAESSER,
): "teile" | "hoehen" | undefined {
    if (auswahl.some((s) => istKamm(netz, s.nr) || istNebengipfel(netz, s.nr) || istMulde(netz, s.nr))) return "teile";
    return wasserPunkteMitHoehe(netz, auswahl, gew).length > 0 ? "hoehen" : undefined;
}

/** Die Auswahl löschen: gewählte Teile entfernen, die eigenen Höhen gewählter Flusspunkte und Seen wegnehmen (WI-0259). */
export function ohneAuswahl(
    netz: GebirgsNetz,
    auswahl: readonly NetzStelle[],
    gew: Gewaesser = KEIN_GEWAESSER,
): GebirgsNetz {
    const hoehen = wasserPunkteMitHoehe(netz, auswahl, gew).map((p) => ({ ...p, h: null }));
    return ohneTeile(
        hoehen.length > 0 ? mitHoehen(netz, hoehen, gew) : netz,
        auswahl.map((s) => s.nr),
    );
}

/** Den Rang eines Kamms setzen. */
export function mitRang(netz: GebirgsNetz, nr: number, rang: LinienRang): GebirgsNetz {
    if (!istKamm(netz, nr) || netz.kaemme[nr]!.rang === rang) return netz;
    return { ...netz, kaemme: netz.kaemme.map((kamm, i) => (i === nr ? { ...kamm, rang } : kamm)) };
}

/** Die Lage eines Punkts im Netz (mit `gew` auch an Flüssen und Seen). */
export function punktLage(netz: GebirgsNetz, p: NetzPunkt, gew: Gewaesser = KEIN_GEWAESSER): Punkt | undefined {
    const wasser = wasserTeilVon(netz, gew, p.nr);
    if (wasser !== undefined) return wasser.punkte[p.index];
    if (istKamm(netz, p.nr)) {
        const q = netz.kaemme[p.nr]!.punkte[p.index];
        return q === undefined ? undefined : punkt(q);
    }
    if (istNebengipfel(netz, p.nr)) return netz.nebengipfel[p.nr - netz.kaemme.length];
    if (istMulde(netz, p.nr)) return netz.mulden![p.nr - netz.kaemme.length - netz.nebengipfel.length];
    return undefined;
}

/** Die gespeicherte Höhe eines Punkts (`null` = Vorgabe), `undefined`, wenn es ihn nicht gibt (mit `gew` auch an Flüssen und Seen). */
export function eigeneHoehe(
    netz: GebirgsNetz,
    p: NetzPunkt,
    gew: Gewaesser = KEIN_GEWAESSER,
): number | null | undefined {
    const wasser = wasserTeilVon(netz, gew, p.nr);
    if (wasser !== undefined) {
        const at = wasser.punkte[p.index];
        return at === undefined ? undefined : wasserHoehe(netz, wasser, at);
    }
    if (istKamm(netz, p.nr)) {
        const kamm = netz.kaemme[p.nr]!;
        return p.index < kamm.punkte.length ? (kamm.hoehen?.[p.index] ?? null) : undefined;
    }
    if (istNebengipfel(netz, p.nr)) return netz.nebengipfel[p.nr - netz.kaemme.length]!.h;
    if (istMulde(netz, p.nr)) return netz.mulden![p.nr - netz.kaemme.length - netz.nebengipfel.length]!.h;
    return undefined;
}

/** Die Höhe, die an einem Punkt gilt (eigen oder Vorgabe), aus den gerechneten Punkthöhen (`punktHoehen` der Topographie). */
export function hoeheAn(netz: GebirgsNetz, hoehen: PunktHoehen, p: NetzPunkt): PunktHoehe | undefined {
    if (istKamm(netz, p.nr)) return hoehen.linien[p.nr]?.[p.index];
    if (istNebengipfel(netz, p.nr)) return hoehen.nebengipfel[p.nr - netz.kaemme.length];
    if (istMulde(netz, p.nr)) return hoehen.mulden[p.nr - netz.kaemme.length - netz.nebengipfel.length];
    return undefined;
}

/**
 * Die einzelnen Punkte einer Auswahl, ohne Doppel: je Stützpunkt er selbst, je ganze Linie alle ihre Stützpunkte, je Nebengipfel und Mulde
 * der Punkt. Was es nicht (mehr) gibt, fällt weg.
 */
export function punkteDerAuswahl(
    netz: GebirgsNetz,
    auswahl: readonly NetzStelle[],
    gew: Gewaesser = KEIN_GEWAESSER,
): NetzPunkt[] {
    const aus: NetzPunkt[] = [];
    const gesehen = new Set<string>();
    const nimm = (p: NetzPunkt): void => {
        const k = `${String(p.nr)}:${String(p.index)}`;
        if (gesehen.has(k) || eigeneHoehe(netz, p, gew) === undefined) return;
        gesehen.add(k);
        aus.push(p);
    };
    for (const stelle of auswahl) {
        const wasser = wasserTeilVon(netz, gew, stelle.nr);
        if (wasser !== undefined) {
            if (stelle.index !== undefined) nimm({ nr: stelle.nr, index: stelle.index });
            else wasser.punkte.forEach((_, index) => nimm({ nr: stelle.nr, index }));
            continue;
        }
        if (istKamm(netz, stelle.nr)) {
            if (stelle.index !== undefined) nimm({ nr: stelle.nr, index: stelle.index });
            else netz.kaemme[stelle.nr]!.punkte.forEach((_, index) => nimm({ nr: stelle.nr, index }));
        } else nimm({ nr: stelle.nr, index: 0 });
    }
    return aus;
}

/** Liegen zwei Stellen der Auswahl gleich? */
export const gleicheStelle = (a: NetzStelle, b: NetzStelle): boolean => a.nr === b.nr && a.index === b.index;

/**
 * Die Höhen an Punkten setzen (Schritt, ganzzahlig, in den Grenzen von `terrain_peak.height_schritt`; `null` ist die Vorgabe). Ein Ort hat EINE
 * Höhe (WI-0249 P9): Jeder deckungsgleiche Punkt des Netzes bekommt denselben Wert, Kamm- und Talstützpunkte wie Nebengipfel und Mulden.
 */
export function mitHoehen(
    netz: GebirgsNetz,
    werte: readonly (NetzPunkt & { h: number | null })[],
    gew: Gewaesser = KEIN_GEWAESSER,
): GebirgsNetz {
    // Flüsse und Seen (WI-0249) haben ihre eigene Liste nach Lage; ein Kammpunkt an derselben Stelle bleibt davon unberührt.
    const wasser = werte.flatMap((w) => {
        const teil = wasserTeilVon(netz, gew, w.nr);
        const at = teil?.punkte[w.index];
        return teil === undefined || at === undefined ? [] : [{ teil, at, h: w.h }];
    });
    if (wasser.length > 0)
        return mitHoehen(
            mitWasserHoehen(netz, wasser),
            werte.filter((w) => wasserTeilVon(netz, gew, w.nr) === undefined),
        );
    const an = new Map<string, number | null>();
    for (const w of werte) {
        const lage = punktLage(netz, w);
        if (lage !== undefined) an.set(schluessel(lage), punktHoeheBegrenzt(w.h));
    }
    if (an.size === 0) return netz;
    const neu = (lage: Punkt, alt: number | null): number | null => {
        const k = schluessel(lage);
        return an.has(k) ? an.get(k)! : alt;
    };
    const kaemme = netz.kaemme.map((kamm) => {
        if (!kamm.punkte.some((p) => an.has(schluessel(punkt(p))))) return kamm;
        return linieMitHoehen(
            kamm.punkte,
            kamm.rang,
            kamm.punkte.map((p, s) => neu(punkt(p), kamm.hoehen?.[s] ?? null)),
        );
    });
    const nebengipfel = netz.nebengipfel.map((n) => {
        const h = neu(n, n.h);
        return h === n.h ? n : { ...n, h };
    });
    const mulden = netz.mulden?.map((m) => {
        const h = neu(m, m.h);
        return h === m.h ? m : { ...m, h };
    });
    return { ...netz, kaemme, nebengipfel, ...(mulden === undefined ? {} : { mulden }) };
}

/** Die Höhe eines ganzen Teils setzen: an allen Stützpunkten einer Linie, am Nebengipfel oder an der Mulde. */
export const mitHoehe = (netz: GebirgsNetz, nr: number, h: number | null): GebirgsNetz =>
    mitHoehen(
        netz,
        punkteDerAuswahl(netz, [{ nr }]).map((p) => ({ ...p, h })),
    );

/**
 * Alle eigenen Punkthöhen verhältnisgleich zur Kammhöhe (Betreiber 2026-10-24 zur Frage, ob Punkte mit eigener Höhe einer späteren
 * Änderung der Kammhöhe folgen: „doch relativ dazu“; Orchestrierung: Verhältnis statt fester Verschiebung, damit Täler beim Absenken nicht
 * unter 0 fallen, auf die Grenzen geklemmt). Punkte ohne eigene Höhe folgen ohnehin über die Vorgabe und bleiben `null`.
 */
export function netzSkaliert(netz: GebirgsNetz, faktor: number): GebirgsNetz {
    if (!Number.isFinite(faktor) || faktor <= 0 || faktor === 1) return netz;
    const mal = (h: number | null): number | null => (h === null ? null : punktHoeheBegrenzt(h * faktor));
    return {
        ...netz,
        kaemme: netz.kaemme.map((kamm) =>
            kamm.hoehen === undefined ? kamm : linieMitHoehen(kamm.punkte, kamm.rang, kamm.hoehen.map(mal)),
        ),
        nebengipfel: netz.nebengipfel.map((n) => (n.h === null ? n : { ...n, h: mal(n.h) })),
        ...(netz.mulden === undefined
            ? {}
            : { mulden: netz.mulden.map((m) => (m.h === null ? m : { ...m, h: mal(m.h) })) }),
    };
}

/** Eine Beschriftung der Höhe an einem Ort: die Höhe, die dort gilt, eigen oder Vorgabe, und welche Punkte dort liegen. */
export interface HoehenOrt {
    readonly at: Punkt;
    readonly h: number;
    readonly eigen: boolean;
    readonly punkte: readonly NetzPunkt[];
}

/**
 * Je Ort des Netzes eine Höhe (deckungsgleiche Punkte zusammen; eigen, sobald einer dort eine eigene Höhe trägt). Mit `gew` dahinter die
 * Punkte der Flüsse und Seen (WI-0249): eigen mit ihrer Höhe, sonst `h` NaN (die Beschriftung nimmt dann die Fläche der Vorschau).
 */
export function hoehenOrte(netz: GebirgsNetz, hoehen: PunktHoehen, gew: Gewaesser = KEIN_GEWAESSER): HoehenOrt[] {
    const orte = new Map<string, { at: Punkt; h: number; eigen: boolean; punkte: NetzPunkt[] }>();
    const nimm = (at: Punkt, p: NetzPunkt, wert: PunktHoehe | undefined): void => {
        if (wert === undefined) return;
        const k = schluessel(at);
        const ort = orte.get(k);
        if (ort === undefined) orte.set(k, { at, h: wert.h, eigen: wert.eigen, punkte: [p] });
        else {
            ort.punkte.push(p);
            if (wert.eigen && !ort.eigen) Object.assign(ort, { h: wert.h, eigen: true });
        }
    };
    netz.kaemme.forEach((kamm, nr) =>
        kamm.punkte.forEach((q, index) => nimm(punkt(q), { nr, index }, hoehen.linien[nr]?.[index])),
    );
    netz.nebengipfel.forEach((n, i) => nimm(n, { nr: netz.kaemme.length + i, index: 0 }, hoehen.nebengipfel[i]));
    (netz.mulden ?? []).forEach((m, i) =>
        nimm(m, { nr: netz.kaemme.length + netz.nebengipfel.length + i, index: 0 }, hoehen.mulden[i]),
    );
    const basis = wasserBasis(netz);
    const wasser: HoehenOrt[] = gew.teile.flatMap((teil, t) =>
        teil.punkte.map((at, index) => {
            const h = wasserHoehe(netz, teil, at);
            return { at, h: h ?? Number.NaN, eigen: h !== null, punkte: [{ nr: basis + t, index }] };
        }),
    );
    return [...orte.values(), ...wasser];
}

/**
 * Woran ein Punkt einrastet: die Gipfel des Gebirges (`gipfel`, ihr eigener Name), die Nebengipfel (`gipfel`, mit Stelle) und jeder Punkt
 * eines Kamms (`ecke`, mit Stelle). Gipfel ohne Lage fehlen.
 */
export function netzZiele(
    flaeche: string,
    name: string,
    netz: GebirgsNetz,
    gipfel: readonly Pick<EditorLandscapePeak, "id" | "name" | "position">[],
): Ziel[] {
    const ziele: Ziel[] = gipfel.map((g) => ({
        art: "gipfel",
        at: { x: g.position[0], y: g.position[1] },
        objekt: g.id,
        name: g.name,
    }));
    netz.kaemme.forEach((kamm, nr) =>
        kamm.punkte.forEach((p, index) =>
            ziele.push({ art: "ecke", at: punkt(p), objekt: flaeche, name, stelle: { objekt: flaeche, nr, index } }),
        ),
    );
    netz.nebengipfel.forEach((n, i) =>
        ziele.push({
            art: "gipfel",
            at: { x: n.x, y: n.y },
            objekt: flaeche,
            name,
            stelle: { objekt: flaeche, nr: netz.kaemme.length + i, index: 0 },
        }),
    );
    (netz.mulden ?? []).forEach((n, i) =>
        ziele.push({
            art: "ecke",
            at: { x: n.x, y: n.y },
            objekt: flaeche,
            name,
            stelle: { objekt: flaeche, nr: netz.kaemme.length + netz.nebengipfel.length + i, index: 0 },
        }),
    );
    return ziele;
}
