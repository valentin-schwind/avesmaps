/**
 * Ein Punkt mit eigener Höhe trifft seine Höhe (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe, 2026-10-26). Das Auslaufen zum Umriss,
 * die Rinnen der Vorschau und die Erosion des Geländes wirken nur zwischen den Punkten: Nach der vollen Rechnung wird die Fläche an jedem Punkt
 * mit eigener Höhe auf diese Höhe angeheftet, weich ausgeblendet.
 *
 * - **Am Punkt** heißt: in der Rasterzelle, die dem Punkt am nächsten liegt (wie die Grundform eine Punkthöhe trägt, wie ein Gipfel seine
 *   Spitze hat und wie die Prüfungen eine Punkthöhe lesen, `zelleAn`). Diese Zelle trägt genau die Höhe; die Zellen daneben behalten ihr Muster.
 * - **Anheften:** Am Punkt fehlt `c = Ziel − Fläche`. Die Fläche hebt oder senkt sich um `c`, voll im Kern (anderthalb Zellen) und von dort weich
 *   (`smoothstep`) bis zum Radius `R = |c| / (Steilheit · 3.000)` in Grenzen. So wird aus einem großen Unterschied ein breiter Hang statt einer
 *   Nadel, und ein kleiner bleibt klein.
 * - **Strecken:** Zwischen zwei benachbarten Stützpunkten eines Kamms oder Tals, die beide eine eigene Höhe tragen, geht die Korrektur entlang der
 *   Strecke von der einen zur anderen über (linear), quer dazu fällt sie weich ab. Sonst hübe jeder Stützpunkt einen eigenen Buckel und der Kamm
 *   dazwischen bliebe tief (eine Perlenkette); so bleibt die Form der Rinnen auf dem Kamm erhalten, nur angehoben oder gesenkt. Um jeden Punkt
 *   (ihre Enden und jeden anderen in der Nähe) blendet die Strecke aus, vom Kern bis zum dreifachen Kern: Dort formt der Punkt selbst, und ein
 *   Nebengipfel neben dem Kamm bleibt spitz.
 * - **Nie darüber hinaus:** Eine Zelle hebt sich höchstens bis zur höheren, senkt sich höchstens bis zur tieferen Zielhöhe ihres Trägers. Was schon
 *   höher steht als die Punkte daneben, bleibt stehen. Im Gelände dazu nie über die Saat (`TreffRaster.vorbild`), die die Punkte schon trifft:
 *   Die Erosion des Geländes wird nahe den Punkten zurückgenommen, nicht überboten. Zuletzt nimmt die Zelle am Punkt den Rest, der dann noch
 *   fehlt.
 * - **Überlagerung:** Die Träger (Strecken, Flüsse, dann Punkte) wirken nacheinander, jeder mit dem Rest, den die vor ihm ließen: keine doppelte
 *   Hebung, wo zwei Hänge sich überdecken. Einige Durchgänge, bis jeder Punkt trifft.
 * - **Widerspruch:** Zwei Punkte mit verschiedener Höhe näher als `widerspruchZellen` Zellen kann keine Fläche auf diesem Raster tragen (nur als
 *   Nadel). Dann gilt der mit Vorrang (ein einzelner Punkt vor dem Stützpunkt einer Linie), bei gleichem der zuerst genannte; der andere bleibt,
 *   wie die Rechnung ihn lässt.
 * - **Rand:** Ein Punkt, dessen Zelle sich nicht ändern darf oder dessen Kern zu mehr als der Hälfte außerhalb der Fläche oder auf gesperrten
 *   Zellen liegt, trifft nicht (er läge auf fremdem Gelände, und die wenigen Zellen in der Fläche würden zur Nadel).
 * - **Welche Punkte:** Stützpunkte von Kämmen und Tälern mit eigener Höhe, Nebengipfel und Mulden mit eigener Höhe, Stützpunkte von Flüssen mit
 *   eigenen Höhen, Punkte am Ufer von Seen mit eigener Höhe (`eigeneZiele`, siehe unten). Nichts in einem See. Punkte ohne eigene Höhe bleiben,
 *   wie die Rechnung sie lässt.
 * - **Flüsse** (WI-0259, OPS-071; Vali 2026-10-30: „meine idee wär, dass flüsse automatische kammtäler sind (die es schon gibt), deren
 *   verlauf im kammeditor auch in der höhe verändert werden kann“): Ein Fluss mit eigenen Höhen wirkt wie ein gezeichnetes Tal mit eigenen Höhen. Ziele sind seine Stützpunkte vom
 *   ersten bis zum letzten mit eigener Höhe; die freien dazwischen tragen die Höhe über die Bogenlänge (`flussHoeheAn`, wie `wasserFest` sie
 *   rechnet), so folgt die Kette dem Lauf und nicht der Luftlinie. Zwischen benachbarten gilt eine Strecke: entlang linear, quer weich. Ein
 *   Stützpunkt im See oder außerhalb der Fläche ist kein Ziel, dort bricht die Kette. Das Bett trägt seine Höhe schon (`wasserFest`, Einbrennen)
 *   und bleibt, wie es ist, ebenso jeder See: Am Bett fehlte nichts (`c = 0`), und daneben stünde ein Damm (Fluss 2.300, Umland 500).
 * - **Umland eines Flusspunkts:** Der Fehlbetrag `c` wird darum am Umland gemessen, als Median der Zellen im Ring vom Kern bis zum doppelten
 *   Kern um den Stützpunkt, die sich im Abfall ändern dürfen (kein Wasser, keine Senke). Der Ring, weil er gleich hinter dem voll gehobenen
 *   Kern liegt: Gemessen wird das Ufer, das man neben dem Fluss sieht, nicht der Hang weiter draußen, und dort greift die Korrektur fast ganz.
 *   Der Median, weil der Ring quer über Talflanken, Rinnen und Rücken reicht und einzelne Bettzellen streifen kann: Ein Mittelwert folgte jedem
 *   Ausreißer. Liegt die nächste Zelle, die sich ändern darf, weiter draußen als der Kern (im Gelände ist der Flusskorridor gesperrt,
 *   `dryLandMask`), beginnt der Ring dort; trägt er weniger als `umlandZellen` Zellen, wird er um je einen Kern breiter, höchstens bis `rMaxE`.
 * - **Ein Fluss trägt als Kette**, nicht als Strecken und Punkte: Jede Zelle hebt oder senkt sich einmal je Durchgang, nach dem Stück des Laufs,
 *   das ihr am nächsten liegt, mit Rest und Radius entlang linear. Als Strecken und Punkte hob jeder Stützpunkt eine eigene Scheibe neben die
 *   Strecken, die um ihn ausblenden (am Probefluss eine Delle von 240 Schritt im Ufer an jedem Stützpunkt), und zwei Stücke hoben dieselbe Zelle
 *   doppelt (der Hang wurde steiler, als `steil` sagt). Voll gehoben wird bis an den Ring, und der Radius reicht mindestens einen Kern über ihn
 *   hinaus: Sonst bliebe sein äußerer Teil fast ungehoben, und die Messung käme in `durchgaenge` Runden nicht an (am Probefluss der Blutzinnen
 *   blieben 6 Schritt). Für kleine Fehlbeträge ist der Hang an einem Fluss darum etwas breiter als an einem Punkt. Im Kern gilt, was im Kern
 *   einer Strecke gilt (kein Wasser); keine Zelle nimmt einen Rest genau. Um jeden anderen Punkt blendet der Fluss aus wie eine Strecke, und eine
 *   Strecke blendet um keinen Flusspunkt aus. Flusspunkte widersprechen einander nicht (keiner setzt eine Zelle genau, es entsteht keine Nadel);
 *   gegen jeden anderen Punkt weichen sie (Vorrang 0). Ein Flusspunkt gilt, wenn sein Ring genug Umland trägt.
 * - **Seen** (WI-0259; Vali 2026-10-30 auf die Frage, ob das Ufer eines hoch gesetzten Sees nachzieht wie beim Fluss: „nein genau, das verhält
 *   sich dann glaub genau gleich“): Ein See mit eigener Höhe wirkt wie ein Fluss. Seine Zellen tragen den Spiegel schon (`wasserFest`, Ebnen
 *   der Seen) und bleiben; das Ufer folgt. Ziele sind Punkte auf jedem Ring des Sees (Ufer und Inseln), gleichmäßig höchstens `uferE`
 *   auseinander, als geschlossene Kette auf der Höhe des Sees; sie messen ihr Umland wie ein Flusspunkt im Ring um sich (der See selbst darf
 *   sich nicht ändern, der Ring liegt also außerhalb, im Gelände jenseits des gesperrten Ufers). Je Uferpunkt gemessen, nicht einmal für den
 *   ganzen See: Ein Median über das ganze Ufer stünde am Ziel, sobald die höhere Hälfte es erreicht, und die tiefere Seite bliebe ein Damm
 *   unter dem Spiegel.
 * - **Rand eines Sees** (OPS-000086, Thomas: „Seen sollen automatisch eine mindestens ebene Fläche um sich herum erhalten, die ihrer eigenen Höhe
 *   entspricht. So das ein Seebecken im Gebirge entsteht und der Seen nicht undefiniert abfällt.“): Nach den Ketten bekommt jede Zelle um das äußere Ufer
 *   eines Sees mit eigener Höhe einen Boden: bis `seeRandE` vom Ufer der Spiegel, dahinter fällt er mit der Neigung `steil`. Wer tiefer liegt, hebt sich
 *   auf den Boden; wer höher liegt, bleibt, denn das ist die Wand des Beckens. So entsteht der ebene Rand und außen ein Hang, der ins Gelände läuft, und
 *   das Muster des Geländes bleibt, wo es über dem Boden liegt. Nur Land, das sich im Abfall ändern darf: Bett, Täler und Mulden behalten ihre Form. Um
 *   jeden anderen Punkt blendet der Rand aus wie ein Fluss, und um einen Fluss mit eigenen Höhen beginnt er erst hinter dessen Umland (dort gilt die Höhe des Flusses). Eine
 *   Insel im See bekommt keinen: Sie läge sonst ganz auf dem Spiegel. Das ist die Saat und die Vorschau; im fertigen Gelände bekommt jeden See sein Becken
 *   (`apps/server/src/terrain/domain/see-becken.ts`, Fassung mit `generator.lakes.randBreite`, dieselbe Breite).
 * - **Fluss am See:** Läuft ein Fluss mit seinen eigenen Höhen in einen See mit eigener Höhe hinein oder heraus, endet oder beginnt seine
 *   Kette am Ufer, wo der Lauf es kreuzt, mit der Höhe des Sees. Den Rest trägt die Kette des Ufers: Der See ist das Stück mit fester Höhe
 *   zwischen beiden Teilen des Flusses. Ein Stück quer über den See hübe Land, wo das Ufer nach innen springt, und brächte nichts, weil der See
 *   sich nicht ändert. Am Flusspunkt vor dem See die Höhe des Flusses (wie das Bett sie trägt), am Ufer die des Sees: Das Ufer an der Mündung
 *   geht von der einen zur anderen über, statt dass Fluss und See dieselben Zellen gegeneinander heben und senken. Ein See ohne eigene Höhe hat
 *   vor der Rechnung keinen Spiegel; dort bricht die Kette wie zuvor.
 *
 * Reine Rechnung auf einem Raster mit Zeile 0 im Süden (`x0 + i · Zelle`, `y0 + j · Zelle`), für Saat und Vorschau (`rechne.ts`) wie für das
 * Gelände (`finishDomainTerrain`).
 */
import { pointInGeometry } from "../geometry.ts";
import type { V12Geometry, V12Input } from "../types.ts";
import type { WasserHoehe } from "./netz-vertrag.ts";
import { bogen, flussHoeheAn, flussMarken, seeSpiegel } from "./wasser.ts";

/** Ein Ziel: Lage in Karteneinheiten, Höhe in Schritt; `vorrang` entscheidet einen Widerspruch (höher gilt, ohne Angabe 0). */
export interface PunktZiel {
    x: number;
    y: number;
    h: number;
    vorrang?: number;
    /**
     * Ein Wasserpunkt (WI-0259): ein Stützpunkt eines Flusses oder ein Punkt am Ufer eines Sees (auch wo ein Fluss in ihn mündet). Fehlbetrag am
     * Umland, Bett und See bleiben (siehe Kopf).
     */
    wasser?: "fluss" | "see";
    /** Ein Punkt am äußeren Ufer eines Sees: So breit (E) bleibt um den See mindestens sein Spiegel (OPS-000086, siehe Kopf). */
    rand?: number;
}

/** Die Ziele eines Gebirges: Punkte und die Strecken zwischen benachbarten Stützpunkten (Indizes in `punkte`). */
export interface TreffZiele {
    readonly punkte: readonly PunktZiel[];
    readonly strecken: readonly (readonly [number, number])[];
}

/**
 * Stand dieser Regel im Fingerabdruck der Saat (`terrain/inputs.ts`): nur bei Gebirgen der Fassung 19 mit eigenen Höhen. Gebirge ohne sie
 * behalten ihren Fingerabdruck und ihre Saat Zeichen für Zeichen.
 */
export const TREFFEN_QUELLE = "treffen@WI-0249-1";

/**
 * Stand der Regel für Flüsse mit eigenen Höhen (WI-0259) im Fingerabdruck der Saat, zusätzlich zu `TREFFEN_QUELLE`: nur bei Gebirgen, in denen
 * mindestens ein Flusspunkt Ziel ist. Alle anderen behalten Fingerabdruck und Saat Zeichen für Zeichen.
 */
export const TREFFEN_FLUSS_QUELLE = "treffen@WI-0259-1";

/**
 * Stand der Regel für Seen mit eigener Höhe (WI-0259, Seen wie Flüsse) im Fingerabdruck der Saat, zusätzlich zu `TREFFEN_QUELLE`: nur bei
 * Gebirgen, in denen ein Punkt am Ufer eines Sees Ziel ist. Alle anderen behalten Fingerabdruck und Saat Zeichen für Zeichen.
 */
export const TREFFEN_SEE_QUELLE = "treffen-see@WI-0259-3";

/** Schritt je Karteneinheit (`SCHRITT_JE_EINHEIT`). */
const SCHRITT_JE_E = 3000;

/**
 * VORSCHLAG: Die Grenzen des Anheftens. `steil`: höchste mittlere Neigung des Hangs um einen Punkt (Höhe je Strecke), daraus der Radius; `rMinE`,
 * `rMaxE`: Grenzen des Radius in E (mindestens drei Zellen); `durchgaenge`: höchstens so viele Runden; `toleranz`: Rest in Schritt, ab dem ein Punkt
 * als getroffen gilt; `widerspruchZellen`: Abstand, unter dem zwei verschiedene Höhen einander widersprechen; `gleich`: so nah beieinander gelten
 * zwei Höhen als gleich (Schritt); `randAnteil`: so viel vom Kern eines Punkts muss aus Zellen bestehen, die sich ändern dürfen;
 * `umlandZellen`: so viele Zellen braucht der Ring, an dem ein Wasserpunkt sein Umland misst, sonst wächst er (WI-0259); `uferE`: höchster
 * Abstand der Punkte am Ufer eines Sees (E, WI-0259); `seeRandE`: Breite des ebenen Rands um einen See mit eigener Höhe (E, OPS-000086).
 */
export const TREFFEN = {
    steil: 0.4,
    rMinE: 0.5,
    rMaxE: 3,
    durchgaenge: 16,
    toleranz: 0.5,
    widerspruchZellen: 3,
    gleich: 10,
    randAnteil: 0.5,
    umlandZellen: 6,
    uferE: 0.5,
    seeRandE: 1.5,
} as const;

/** Wie weit das Anheften auf einem Raster mit Zellweite `cell` höchstens reicht (E): der größte Radius und eine Zelle Rand. */
export function treffReichweite(cell: number): number {
    return Math.max(TREFFEN.rMaxE, TREFFEN.rMinE, 3 * cell) + TREFFEN.seeRandE + cell;
}

/** Wie eine Zelle angefasst wird: im Kern eines Punkts, im Kern einer Strecke oder im weichen Abfall. */
export type TreffArt = "punkt" | "strecke" | "abfall";

export interface TreffRaster {
    readonly w: number;
    readonly hh: number;
    readonly cell: number;
    readonly x0: number;
    readonly y0: number;
    /** Die Höhen, Zeile für Zeile ab Süden; wird an Ort und Stelle geändert. */
    readonly h: { [k: number]: number; readonly length: number };
    /** Ganze Schritt (gespeichertes Gelände, `Uint16Array`): runden und auf 0 bis 65.535 begrenzen. */
    readonly ganzzahlig?: boolean;
    /** Darf diese Zelle sich ändern, und wie (`TreffArt`)? Ohne Angabe jede Zelle. */
    darf?(k: number, art: TreffArt): boolean;
    /**
     * Das Vorbild an dieser Zelle (Schritt; `NaN` ohne), im Gelände die Saat: Eine Zelle hebt sich nie über es und senkt sich nie unter es
     * (außer der Zelle am Punkt). Ohne Angabe keine solche Grenze.
     */
    vorbild?(k: number): number;
}

export interface TreffBericht {
    /**
     * Je Punkt der Eingabe: Höhe in seiner Zelle − Ziel vor und nach dem Anheften (Schritt), an einem Wasserpunkt sein Umland − Ziel; `NaN`
     * außerhalb des Rasters.
     */
    vorher: number[];
    nachher: number[];
    /** Je Punkt: angeheftet (`true`) oder ausgelassen (außerhalb, am Rand, im Widerspruch). */
    gilt: boolean[];
}

const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};

/** Bilinear gelesen, am Rand des Rasters geklemmt (wie der Leser des Geländes, `dem-tiles.ts`). */
export function liesBilinear(
    r: Pick<TreffRaster, "w" | "hh" | "cell" | "x0" | "y0" | "h">,
    x: number,
    y: number,
): number {
    const fx = Math.max(0, Math.min(r.w - 1, (x - r.x0) / r.cell));
    const fy = Math.max(0, Math.min(r.hh - 1, (y - r.y0) / r.cell));
    const i = Math.min(Math.floor(fx), Math.max(0, r.w - 2));
    const j = Math.min(Math.floor(fy), Math.max(0, r.hh - 2));
    const tx = fx - i;
    const ty = fy - j;
    const rechts = Math.min(i + 1, r.w - 1);
    const oben = Math.min(j + 1, r.hh - 1);
    return (
        (r.h[j * r.w + i] as number) * (1 - tx) * (1 - ty) +
        (r.h[j * r.w + rechts] as number) * tx * (1 - ty) +
        (r.h[oben * r.w + i] as number) * (1 - tx) * ty +
        (r.h[oben * r.w + rechts] as number) * tx * ty
    );
}

/** Die Rasterzelle, die einem Punkt am nächsten liegt, oder `-1` außerhalb des Rasters. */
export function zelleAmPunkt(r: Pick<TreffRaster, "w" | "hh" | "cell" | "x0" | "y0">, x: number, y: number): number {
    const i = Math.round((x - r.x0) / r.cell);
    const j = Math.round((y - r.y0) / r.cell);
    return i >= 0 && j >= 0 && i < r.w && j < r.hh ? j * r.w + i : -1;
}

/**
 * Heftet die Fläche an jedem Ziel auf seine Höhe (siehe Kopf). Ändert nur Zellen, die `darf` zulässt, und nur in einem Umkreis von höchstens
 * `treffReichweite` um die Ziele.
 */
export function triffPunkte(r: TreffRaster, ziele: TreffZiele | readonly PunktZiel[]): TreffBericht {
    const { punkte, strecken } = Array.isArray(ziele)
        ? { punkte: ziele as readonly PunktZiel[], strecken: [] as readonly (readonly [number, number])[] }
        : (ziele as TreffZiele);
    const zellen = punkte.map((z) => zelleAmPunkt(r, z.x, z.y));
    const kern = 1.5 * r.cell;
    const rMin = Math.max(TREFFEN.rMinE, 3 * r.cell);
    const rMax = Math.max(TREFFEN.rMaxE, rMin);
    // Das Umland je Wasserpunkt (siehe Kopf): die Zellen, die sich im Abfall ändern dürfen, im Ring einen Kern breit ab der nächsten solchen Zelle,
    // mindestens ab dem Kern (`innen` bis `aussen`); mit zu wenigen wird er um je einen Kern breiter. Fest für die ganze Rechnung (`darf` hängt
    // nicht an den Höhen).
    const umlandRing = (z: PunktZiel): { zellen: number[]; innen: number; aussen: number } => {
        const frei: { k: number; d: number }[] = [];
        const i0 = Math.max(0, Math.floor((z.x - rMax - r.x0) / r.cell));
        const i1 = Math.min(r.w - 1, Math.ceil((z.x + rMax - r.x0) / r.cell));
        const j0 = Math.max(0, Math.floor((z.y - rMax - r.y0) / r.cell));
        const j1 = Math.min(r.hh - 1, Math.ceil((z.y + rMax - r.y0) / r.cell));
        let naechste = Infinity;
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const d = Math.hypot(r.x0 + i * r.cell - z.x, r.y0 + j * r.cell - z.y);
                if (d > rMax || (r.darf && !r.darf(j * r.w + i, "abfall"))) continue;
                frei.push({ k: j * r.w + i, d });
                naechste = Math.min(naechste, d);
            }
        const innen = Math.max(kern, Math.min(naechste, rMax - kern));
        for (let aussen = innen + kern; ; aussen = Math.min(rMax, aussen + kern)) {
            const ring = frei.filter((f) => f.d > kern && f.d >= innen && f.d <= aussen).map((f) => f.k);
            if (ring.length >= TREFFEN.umlandZellen || aussen >= rMax) return { zellen: ring, innen, aussen };
        }
    };
    const ringe = punkte.map((z, i) => (z.wasser !== undefined && zellen[i]! >= 0 ? umlandRing(z) : null));
    const median = (ring: readonly number[]): number => {
        if (ring.length === 0) return Number.NaN;
        const werte = ring.map((k) => r.h[k] as number).sort((a, b) => a - b);
        const m = werte.length >> 1;
        return werte.length % 2 === 1 ? werte[m]! : (werte[m - 1]! + werte[m]!) / 2;
    };
    // Die Höhe, an der ein Ziel gemessen wird: die Zelle am Punkt, an einem Wasserpunkt sein Umland.
    const lies = (i: number): number => {
        const ring = ringe[i];
        return ring ? median(ring.zellen) : (r.h[zellen[i]!] as number);
    };
    const vorher = punkte.map((z, i) => (zellen[i]! >= 0 ? lies(i) - z.h : Number.NaN));
    // Rand: Die Zelle am Punkt darf sich ändern, und mindestens die Hälfte seines Kerns. Ein Wasserpunkt braucht genug Umland (Bett, Ufer und
    // Kern liegen im Gelände im gesperrten Korridor oder Ufer).
    const gilt = punkte.map((z, i) => {
        const k = zellen[i]!;
        if (k < 0) return false;
        if (z.wasser !== undefined) return (ringe[i]?.zellen.length ?? 0) >= TREFFEN.umlandZellen;
        if (!r.darf) return true;
        if (!r.darf(k, "punkt")) return false;
        let alle = 0;
        let frei = 0;
        const ci = k % r.w;
        const cj = Math.floor(k / r.w);
        for (let j = Math.max(0, cj - 2); j <= Math.min(r.hh - 1, cj + 2); j++)
            for (let i = Math.max(0, ci - 2); i <= Math.min(r.w - 1, ci + 2); i++) {
                if (Math.hypot(r.x0 + i * r.cell - z.x, r.y0 + j * r.cell - z.y) > kern) continue;
                alle++;
                if (r.darf(j * r.w + i, "punkt")) frei++;
            }
        return frei >= TREFFEN.randAnteil * alle;
    });
    // Widerspruch: nach Vorrang, dann nach Reihenfolge; ein Punkt weicht, wenn ein geltender mit anderer Höhe zu nah liegt. Flusspunkte
    // untereinander nicht: Keiner setzt seine Zelle genau, und dicht gesetzte Stützpunkte eines steigenden Laufs sind kein Widerspruch.
    const nah = TREFFEN.widerspruchZellen * r.cell;
    const reihe = punkte
        .map((_, i) => i)
        .sort((a, b) => (punkte[b]!.vorrang ?? 0) - (punkte[a]!.vorrang ?? 0) || a - b);
    const behalten: number[] = [];
    for (const i of reihe) {
        if (!gilt[i]) continue;
        const z = punkte[i]!;
        const gegen = behalten.some((k) => {
            const o = punkte[k]!;
            if (o.wasser !== undefined && z.wasser !== undefined) return false;
            return Math.abs(o.h - z.h) > TREFFEN.gleich && Math.hypot(o.x - z.x, o.y - z.y) < nah;
        });
        if (gegen) gilt[i] = false;
        else behalten.push(i);
    }
    const aktiv = punkte.map((_, i) => i).filter((i) => gilt[i]);
    const linien = strecken.filter(([a, b]) => gilt[a] && gilt[b]);
    // Flüsse und Seen (WI-0259) tragen als Ketten (`trageKette`), nicht als Strecken und Punkte: eine Kette je Folge geltender Wasserpunkte
    // eines Laufs oder Ufers (aus den Strecken zwischen ihnen), ein einzelner geltender Wasserpunkt für sich. Ohne Wasserpunkte bleibt alles wie
    // zuvor.
    const istWasser = (i: number): boolean => punkte[i]!.wasser !== undefined;
    const ohneWasser = aktiv.filter((i) => !istWasser(i));
    const kammLinien = linien.filter(([a, b]) => !(istWasser(a) && istWasser(b)));
    const ketten: number[][] = [];
    for (const [a, b] of linien) {
        if (!(istWasser(a) && istWasser(b))) continue;
        const letzte = ketten.at(-1);
        if (letzte !== undefined && letzte.at(-1) === a) letzte.push(b);
        else ketten.push([a, b]);
    }
    const inKette = new Set(ketten.flat());
    for (const i of aktiv) if (istWasser(i) && !inKette.has(i)) ketten.push([i]);
    if (aktiv.length === 0) return { vorher, nachher: vorher.slice(), gilt };

    const setze = (k: number, wert: number): void => {
        r.h[k] = r.ganzzahlig ? Math.max(0, Math.min(65535, Math.round(wert))) : wert;
    };
    const radiusFuer = (c: number): number =>
        Math.min(rMax, Math.max(rMin, Math.abs(c) / (TREFFEN.steil * SCHRITT_JE_E)));
    // Ein Träger: ein Punkt (a = b) oder eine Strecke von a nach b; die Korrektur geht entlang linear über. Jeder Träger liest den Rest, wie die
    // Träger vor ihm ihn ließen (keine doppelte Hebung, wo zwei Hänge sich überdecken).
    const trage = (a: number, b: number): void => {
        const pa = punkte[a]!;
        const pb = punkte[b]!;
        const ca = pa.h - lies(a);
        const cb = a === b ? ca : pb.h - lies(b);
        if (Math.abs(ca) <= TREFFEN.toleranz && Math.abs(cb) <= TREFFEN.toleranz) return;
        const radius = radiusFuer(Math.max(Math.abs(ca), Math.abs(cb)));
        // Nie über das Ziel hinaus: Eine Zelle hebt sich höchstens bis zur höheren, senkt sich höchstens bis zur tieferen Zielhöhe des Trägers
        // (sonst stiege ein Kamm zwischen zwei Punkten über beide, wo er schon hoch stand).
        const oben = Math.max(pa.h, pb.h);
        const unten = Math.min(pa.h, pb.h);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const ll = dx * dx + dy * dy;
        const istPunkt = a === b || ll === 0;
        // Die Punkte, um die eine Strecke ausblendet: ihre Enden und jeder andere Punkt in ihrer Reichweite (dort formt der Punkt selbst).
        const reichweite = radius + 3 * kern;
        const nahe = istPunkt
            ? []
            : ohneWasser
                  .map((i) => punkte[i]!)
                  .filter((q) => {
                      const t = Math.max(0, Math.min(1, ((q.x - pa.x) * dx + (q.y - pa.y) * dy) / ll));
                      return Math.hypot(q.x - pa.x - t * dx, q.y - pa.y - t * dy) <= reichweite;
                  });
        const i0 = Math.max(0, Math.floor((Math.min(pa.x, pb.x) - radius - r.x0) / r.cell));
        const i1 = Math.min(r.w - 1, Math.ceil((Math.max(pa.x, pb.x) + radius - r.x0) / r.cell));
        const j0 = Math.max(0, Math.floor((Math.min(pa.y, pb.y) - radius - r.y0) / r.cell));
        const j1 = Math.min(r.hh - 1, Math.ceil((Math.max(pa.y, pb.y) + radius - r.y0) / r.cell));
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const x = r.x0 + i * r.cell;
                const y = r.y0 + j * r.cell;
                const t = istPunkt ? 0 : Math.max(0, Math.min(1, ((x - pa.x) * dx + (y - pa.y) * dy) / ll));
                const d = Math.hypot(x - (pa.x + t * dx), y - (pa.y + t * dy));
                if (d > radius) continue;
                const art: TreffArt = d <= kern ? (istPunkt ? "punkt" : "strecke") : "abfall";
                const k = j * r.w + i;
                if (r.darf && !r.darf(k, art)) continue;
                // Um jeden Punkt (Enden und andere in der Nähe) formt der Punkt selbst: vom Kern bis zum dreifachen Kern eingeblendet.
                let naechster = Infinity;
                for (const q of nahe) naechster = Math.min(naechster, Math.hypot(x - q.x, y - q.y));
                const enden = istPunkt ? 1 : glatt((naechster - kern) / (2 * kern));
                const w = (d <= kern ? 1 : 1 - glatt((d - kern) / Math.max(1e-9, radius - kern))) * enden;
                if (w <= 0) continue;
                const roh = ca + t * (cb - ca);
                const hk = r.h[k] as number;
                let c = roh > 0 ? Math.min(roh, Math.max(0, oben - hk)) : Math.max(roh, Math.min(0, unten - hk));
                if (c !== 0 && r.vorbild) {
                    const v = r.vorbild(k);
                    if (Number.isFinite(v))
                        c = c > 0 ? Math.min(c, Math.max(0, v - hk)) : Math.max(c, Math.min(0, v - hk));
                }
                if (c !== 0) setze(k, hk + w * c);
            }
        // Zuletzt genau: die Zelle am Punkt um den Rest.
        if (istPunkt) {
            const rest = pa.h - lies(a);
            if (Math.abs(rest) > TREFFEN.toleranz) setze(zellen[a]!, pa.h);
        }
    };
    // Der Radius an einem Fluss: wie oben, und mindestens einen Kern über den Ring seines Umlands hinaus (siehe Kopf).
    const radiusAmWasser = (c: number, aussen: number): number =>
        Math.max(radiusFuer(c), Math.min(rMax, aussen + kern));
    // Ein Fluss als Träger (WI-0259): Jede Zelle hebt oder senkt sich einmal je Durchgang, nach dem Stück des Laufs, das ihr am nächsten liegt;
    // Rest und Radius gehen entlang linear über. So hebt kein Stützpunkt eine eigene Scheibe neben die Strecken (eine Delle im Ufer an jedem
    // Stützpunkt, wo die Strecken ausblenden), und zwei Stücke heben dieselbe Zelle nicht doppelt (ein steiler Hang, wo beide an der Höhe des
    // Flusses enden). Voll bis an den Ring des Umlands, weich bis zum Radius; um jeden anderen Punkt in der Nähe blendet der Fluss aus wie eine
    // Strecke. Jede Zelle hängt nur von sich selbst ab, die Folge ist gleichgültig.
    const trageKette = (kette: readonly number[]): void => {
        const rest = kette.map((v) => punkte[v]!.h - lies(v));
        if (rest.every((c) => Math.abs(c) <= TREFFEN.toleranz)) return;
        const stuecke = Math.max(1, kette.length - 1);
        const ende = (s: number): number => Math.min(s + 1, kette.length - 1);
        const voll = (s: number): number => Math.max(ringe[kette[s]!]!.innen, ringe[kette[ende(s)]!]!.innen);
        const aussen = (s: number): number => Math.max(ringe[kette[s]!]!.aussen, ringe[kette[ende(s)]!]!.aussen);
        // Je Zelle das nächste Stück (bei gleichem Abstand das erste) und die Lage darauf.
        const naechstes = new Map<number, { d: number; s: number; t: number }>();
        let weit = 0;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let s = 0; s < stuecke; s++) {
            const pa = punkte[kette[s]!]!;
            const pb = punkte[kette[ende(s)]!]!;
            const radius = radiusAmWasser(Math.max(Math.abs(rest[s]!), Math.abs(rest[ende(s)]!)), aussen(s));
            weit = Math.max(weit, radius);
            x0 = Math.min(x0, pa.x, pb.x);
            y0 = Math.min(y0, pa.y, pb.y);
            x1 = Math.max(x1, pa.x, pb.x);
            y1 = Math.max(y1, pa.y, pb.y);
            const dx = pb.x - pa.x;
            const dy = pb.y - pa.y;
            const ll = dx * dx + dy * dy;
            const i0 = Math.max(0, Math.floor((Math.min(pa.x, pb.x) - radius - r.x0) / r.cell));
            const i1 = Math.min(r.w - 1, Math.ceil((Math.max(pa.x, pb.x) + radius - r.x0) / r.cell));
            const j0 = Math.max(0, Math.floor((Math.min(pa.y, pb.y) - radius - r.y0) / r.cell));
            const j1 = Math.min(r.hh - 1, Math.ceil((Math.max(pa.y, pb.y) + radius - r.y0) / r.cell));
            for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                    const x = r.x0 + i * r.cell;
                    const y = r.y0 + j * r.cell;
                    const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - pa.x) * dx + (y - pa.y) * dy) / ll));
                    const d = Math.hypot(x - (pa.x + t * dx), y - (pa.y + t * dy));
                    if (d > radius) continue;
                    const k = j * r.w + i;
                    const da = naechstes.get(k);
                    if (da === undefined || d < da.d) naechstes.set(k, { d, s, t });
                }
        }
        const reichweite = weit + 3 * kern;
        const nahe = ohneWasser
            .map((i) => punkte[i]!)
            .filter(
                (q) =>
                    q.x >= x0 - reichweite &&
                    q.x <= x1 + reichweite &&
                    q.y >= y0 - reichweite &&
                    q.y <= y1 + reichweite,
            );
        for (const [k, { d, s, t }] of naechstes) {
            const pa = punkte[kette[s]!]!;
            const pb = punkte[kette[ende(s)]!]!;
            const roh = rest[s]! + t * (rest[ende(s)]! - rest[s]!);
            const v = voll(s);
            const radius = radiusAmWasser(roh, aussen(s));
            if (d > radius) continue;
            if (r.darf && !r.darf(k, d <= kern ? "strecke" : "abfall")) continue;
            const x = r.x0 + (k % r.w) * r.cell;
            const y = r.y0 + Math.floor(k / r.w) * r.cell;
            let naechster = Infinity;
            for (const q of nahe) naechster = Math.min(naechster, Math.hypot(x - q.x, y - q.y));
            const enden = glatt((naechster - kern) / (2 * kern));
            const w = (d <= v ? 1 : 1 - glatt((d - v) / Math.max(1e-9, radius - v))) * enden;
            if (w <= 0) continue;
            const hk = r.h[k] as number;
            // Nie über das Ziel hinaus (die höhere, die tiefere Zielhöhe des Stücks), nie über das Vorbild.
            let c =
                roh > 0
                    ? Math.min(roh, Math.max(0, Math.max(pa.h, pb.h) - hk))
                    : Math.max(roh, Math.min(0, Math.min(pa.h, pb.h) - hk));
            if (c !== 0 && r.vorbild) {
                const vb = r.vorbild(k);
                if (Number.isFinite(vb))
                    c = c > 0 ? Math.min(c, Math.max(0, vb - hk)) : Math.max(c, Math.min(0, vb - hk));
            }
            if (c !== 0) setze(k, hk + w * c);
        }
    };
    // Der Rand eines Sees (OPS-000086): Die Zelle hebt sich auf den Boden, den ihr Abstand zum Ufer sagt; was höher liegt, bleibt.
    const istRandKette = (kette: readonly number[]): boolean => kette.every((v) => punkte[v]!.rand !== undefined);
    // Die Stücke der Flüsse und ihrer Mündungen: Dort gilt ihre Höhe. Der Rand beginnt erst hinter dem Ring ihres Umlands, das Umland bleibt also, wie die
    // Kette es ließ.
    const flussStuecke = ketten
        .filter((kette) => !istRandKette(kette))
        .flatMap((kette) =>
            (kette.length > 1 ? kette.slice(0, -1) : kette).map((v, s) => ({
                a: punkte[v]!,
                b: punkte[kette[Math.min(s + 1, kette.length - 1)]!]!,
                frei: Math.max(ringe[v]!.aussen, ringe[kette[Math.min(s + 1, kette.length - 1)]!]!.aussen),
            })),
        );
    const trageRand = (kette: readonly number[]): void => {
        const { h: spiegel, rand: breite } = punkte[kette[0]!]!;
        const reichweite = breite! + rMax;
        const naechstes = new Map<number, number>();
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let s = 0; s < Math.max(1, kette.length - 1); s++) {
            const pa = punkte[kette[s]!]!;
            const pb = punkte[kette[Math.min(s + 1, kette.length - 1)]!]!;
            x0 = Math.min(x0, pa.x, pb.x);
            y0 = Math.min(y0, pa.y, pb.y);
            x1 = Math.max(x1, pa.x, pb.x);
            y1 = Math.max(y1, pa.y, pb.y);
            const dx = pb.x - pa.x;
            const dy = pb.y - pa.y;
            const ll = dx * dx + dy * dy;
            const i0 = Math.max(0, Math.floor((Math.min(pa.x, pb.x) - reichweite - r.x0) / r.cell));
            const i1 = Math.min(r.w - 1, Math.ceil((Math.max(pa.x, pb.x) + reichweite - r.x0) / r.cell));
            const j0 = Math.max(0, Math.floor((Math.min(pa.y, pb.y) - reichweite - r.y0) / r.cell));
            const j1 = Math.min(r.hh - 1, Math.ceil((Math.max(pa.y, pb.y) + reichweite - r.y0) / r.cell));
            for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                    const x = r.x0 + i * r.cell;
                    const y = r.y0 + j * r.cell;
                    const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - pa.x) * dx + (y - pa.y) * dy) / ll));
                    const d = Math.hypot(x - (pa.x + t * dx), y - (pa.y + t * dy));
                    if (d > reichweite) continue;
                    const k = j * r.w + i;
                    const da = naechstes.get(k);
                    if (da === undefined || d < da) naechstes.set(k, d);
                }
        }
        const nahe = ohneWasser
            .map((i) => punkte[i]!)
            .filter(
                (q) =>
                    q.x >= x0 - reichweite - 3 * kern &&
                    q.x <= x1 + reichweite + 3 * kern &&
                    q.y >= y0 - reichweite - 3 * kern &&
                    q.y <= y1 + reichweite + 3 * kern,
            );
        for (const [k, d] of naechstes) {
            const boden = spiegel - Math.max(0, d - breite!) * TREFFEN.steil * SCHRITT_JE_E;
            const hk = r.h[k] as number;
            if (hk >= boden || (r.darf && !r.darf(k, "abfall"))) continue;
            const x = r.x0 + (k % r.w) * r.cell;
            const y = r.y0 + Math.floor(k / r.w) * r.cell;
            let naechster = Infinity;
            for (const q of nahe) naechster = Math.min(naechster, Math.hypot(x - q.x, y - q.y));
            let w = glatt((naechster - kern) / (2 * kern));
            for (const { a, b, frei } of flussStuecke) {
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const ll = dx * dx + dy * dy;
                const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / ll));
                w *= glatt((Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) - frei) / (2 * kern));
            }
            if (w <= 0) continue;
            const vb = r.vorbild?.(k) ?? Number.NaN;
            const c = Number.isFinite(vb) ? Math.min(boden - hk, Math.max(0, vb - hk)) : boden - hk;
            if (c > 0) setze(k, hk + w * c);
        }
    };
    // Erst die Strecken (sie heben den Kamm zwischen den Punkten mit), dann die Flüsse, dann die Stützpunkte, zuletzt die einzelnen Punkte mit
    // Vorrang.
    const punktTraeger = ohneWasser
        .slice()
        .sort((a, b) => (punkte[a]!.vorrang ?? 0) - (punkte[b]!.vorrang ?? 0) || a - b);
    for (let runde = 0; runde < TREFFEN.durchgaenge; runde++) {
        let groesster = 0;
        for (const i of aktiv) groesster = Math.max(groesster, Math.abs(punkte[i]!.h - lies(i)));
        if (groesster <= TREFFEN.toleranz) break;
        for (const [a, b] of kammLinien) trage(a, b);
        for (const kette of ketten) trageKette(kette);
        for (const i of punktTraeger) trage(i, i);
    }
    // Zuletzt der Rand der Seen (siehe Kopf): einmal, weil jede Zelle nur von ihrem Abstand zum Ufer abhängt. Davor verschöbe er die Messung der
    // Flusspunkte, und zwischen ihnen bliebe eine Delle im Ufer.
    for (const kette of ketten) if (istRandKette(kette)) trageRand(kette);
    return { vorher, nachher: punkte.map((z, i) => (zellen[i]! >= 0 ? lies(i) - z.h : Number.NaN)), gilt };
}

/** Vorrang bei Widerspruch: ein einzelner Punkt (Nebengipfel, Mulde) vor dem Stützpunkt einer Linie, der vor einem Wasserpunkt. */
const VORRANG = { wasser: 0, stuetzpunkt: 1, punkt: 2 } as const;

/**
 * Die Punkte mit eigener Höhe einer Eingabe (siehe Kopf): Stützpunkte von Kämmen und Tälern, Nebengipfel und Mulden mit eigener Höhe; dazu die
 * Strecken zwischen benachbarten Stützpunkten mit eigener Höhe. Danach die Stützpunkte der Flüsse mit eigenen Höhen (`flussHoehen`, WI-0259),
 * dann die Punkte am Ufer der Seen mit eigener Höhe (`seeHoehen`), mit ihren Strecken, nur mit `geometry` in der Fläche. Leer, wenn das
 * Gebirge keine eigenen Höhen trägt.
 */
export function eigeneZiele(input: {
    readonly kaemme?: readonly {
        readonly punkte: readonly (readonly [number, number])[];
        readonly hoehen?: readonly (number | null)[] | undefined;
    }[];
    readonly nebengipfel?: readonly { readonly x: number; readonly y: number; readonly h?: number | null }[];
    readonly mulden?: readonly { readonly x: number; readonly y: number; readonly h?: number | null }[];
    readonly seen?: readonly { readonly g?: V12Input["seen"][number]["g"] | null }[];
    readonly fluesse?: readonly { readonly p: readonly (readonly [number, number])[] }[] | undefined;
    readonly flussHoehen?: readonly WasserHoehe[] | undefined;
    readonly seeHoehen?: readonly WasserHoehe[] | undefined;
    /** Die Fläche des Gebirges: Ein Wasserpunkt außerhalb ist kein Ziel. */
    readonly geometry?: V12Geometry | null | undefined;
}): TreffZiele {
    const seen = (input.seen ?? []).filter((see) => !!see.g);
    const imSee = (x: number, y: number): boolean => seen.some((see) => pointInGeometry([x, y], see.g!));
    const punkte: PunktZiel[] = [];
    const strecken: [number, number][] = [];
    // Ein Ort, eine Höhe: deckungsgleiche Punkte (ein Knoten zweier Kämme, ein eingerasteter Nebengipfel) nur einmal, mit dem höheren Vorrang.
    const orte = new Map<string, number>();
    const nimm = (x: number, y: number, h: number, vorrang: number): number | null => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(h) || imSee(x, y)) return null;
        const schluessel = `${x.toFixed(6)},${y.toFixed(6)}`;
        const da = orte.get(schluessel);
        if (da !== undefined) {
            const p = punkte[da]!;
            p.vorrang = Math.max(p.vorrang ?? 0, vorrang);
            return da;
        }
        punkte.push({ x, y, h, vorrang });
        orte.set(schluessel, punkte.length - 1);
        return punkte.length - 1;
    };
    for (const linie of input.kaemme ?? []) {
        let davor: number | null = null;
        linie.punkte.forEach(([x, y], s) => {
            const h = linie.hoehen?.[s];
            const hier = typeof h === "number" ? nimm(x, y, h, VORRANG.stuetzpunkt) : null;
            if (hier !== null && davor !== null && hier !== davor) strecken.push([davor, hier]);
            davor = hier;
        });
    }
    for (const n of input.nebengipfel ?? []) if (Number(n.h) > 0) nimm(n.x, n.y, Number(n.h), VORRANG.punkt);
    for (const m of input.mulden ?? [])
        if (m.h !== null && m.h !== undefined && Number.isFinite(Number(m.h)))
            nimm(m.x, m.y, Number(m.h), VORRANG.punkt);
    // Seen mit eigener Höhe (WI-0259): ihr Spiegel je See, `null` ohne.
    const spiegel = input.seeHoehen?.length ? seeSpiegel(seen, input.seeHoehen) : seen.map(() => null);
    const gehobenerSee = (x: number, y: number): number =>
        seen.findIndex((see, nr) => spiegel[nr] !== null && pointInGeometry([x, y], see.g!));
    const inFlaeche = (x: number, y: number): boolean => !input.geometry || pointInGeometry([x, y], input.geometry);
    // Flüsse (WI-0259): jeder Stützpunkt vom ersten bis zum letzten mit eigener Höhe, die freien mit der Höhe über die Bogenlänge, und die
    // Strecken zwischen benachbarten. Nicht im See und nicht außerhalb der Fläche: Dort bricht die Kette. Ein Ort zweier Flüsse (Mündung) nur
    // einmal; mit den Punkten der Linien nicht zusammengelegt (deren Zelle trägt ihre Höhe genau, die eines Flusspunkts nicht). Läuft der Fluss
    // mit seinen eigenen Höhen in einen See mit eigener Höhe hinein oder aus ihm heraus, endet oder beginnt die Kette am Ufer, wo der Lauf es
    // kreuzt, mit der Höhe des Sees (siehe Kopf).
    if (input.flussHoehen?.length) {
        const flussOrte = new Map<string, number>();
        const nimmWasser = (x: number, y: number, h: number, wasser: "fluss" | "see"): number => {
            const schluessel = `${x.toFixed(6)},${y.toFixed(6)}`;
            const da = flussOrte.get(schluessel);
            if (da !== undefined) return da;
            punkte.push({ x, y, h, vorrang: VORRANG.wasser, wasser });
            flussOrte.set(schluessel, punkte.length - 1);
            return punkte.length - 1;
        };
        for (const f of input.fluesse ?? []) {
            const marken = flussMarken(f.p, input.flussHoehen, seen);
            if (marken.length === 0) continue;
            const laenge = bogen(f.p);
            let davor: number | null = null;
            f.p.forEach(([x, y], v) => {
                const h = flussHoeheAn(marken, laenge[v]!, 0);
                let hier: number | null = null;
                if (h !== undefined && Number.isFinite(x) && Number.isFinite(y) && !imSee(x, y) && inFlaeche(x, y))
                    hier = nimmWasser(x, y, h, "fluss");
                // Am Ufer eines Sees mit eigener Höhe: hinein (die Kette endet dort) oder heraus (sie beginnt dort).
                if (v > 0 && (davor !== null || hier !== null)) {
                    const [px, py] = f.p[v - 1]!;
                    const see = davor !== null ? gehobenerSee(x, y) : gehobenerSee(px, py);
                    const u = see >= 0 ? kreuzung([px, py], [x, y], seen[see]!.g!, davor === null) : undefined;
                    if (u !== undefined) {
                        const ux = px + u * (x - px);
                        const uy = py + u * (y - py);
                        const s = laenge[v - 1]! + u * (laenge[v]! - laenge[v - 1]!);
                        if (flussHoeheAn(marken, s, 0) !== undefined && inFlaeche(ux, uy)) {
                            const ufer = nimmWasser(ux, uy, spiegel[see]!, "see");
                            if (davor !== null && ufer !== davor) strecken.push([davor, ufer]);
                            else if (davor === null && ufer !== hier) strecken.push([ufer, hier!]);
                        }
                    }
                }
                if (hier !== null && davor !== null && hier !== davor) strecken.push([davor, hier]);
                davor = hier;
            });
        }
    }
    // Seen (WI-0259, Seen wie Flüsse): jeder Ring eines Sees mit eigener Höhe (Ufer und Inseln) als geschlossene Kette von Punkten im Abstand
    // höchstens `uferE`, alle auf der Höhe des Sees. Außerhalb der Fläche oder in einem anderen See bricht die Kette. Das äußere Ufer trägt den Rand.
    const seeOrte = new Map<string, number>();
    seen.forEach((see, nr) => {
        const h = spiegel[nr];
        if (h === null || h === undefined) return;
        const aussen = aeussereRinge(see.g!);
        for (const ring of ringeVon(see.g!)) {
            const ufer = uferPunkte(ring, TREFFEN.uferE);
            const mitRand = aussen.some((a) => a[0]?.[0] === ring[0]?.[0] && a[0]?.[1] === ring[0]?.[1]);
            const n = ufer.length;
            const drin = ufer.map(
                ([x, y]) =>
                    inFlaeche(x, y) && !seen.some((anderer, m) => m !== nr && pointInGeometry([x, y], anderer.g!)),
            );
            if (!drin.some(Boolean)) continue;
            // Ganz drin: geschlossen. Sonst beginnt die erste Kette nach einer Lücke, damit keine über das Ende des Rings läuft.
            const ganz = drin.every(Boolean);
            const start = ganz ? 0 : drin.findIndex((d, i) => d && !drin[(i + n - 1) % n]);
            let erster: number | null = null;
            let davor: number | null = null;
            for (let s = 0; s < n; s++) {
                const i = (start + s) % n;
                let hier: number | null = null;
                if (drin[i]) {
                    const [x, y] = ufer[i]!;
                    const schluessel = `${x.toFixed(6)},${y.toFixed(6)}`;
                    hier = seeOrte.get(schluessel) ?? null;
                    if (hier === null) {
                        punkte.push({
                            x,
                            y,
                            h,
                            vorrang: VORRANG.wasser,
                            wasser: "see",
                            ...(mitRand ? { rand: TREFFEN.seeRandE } : {}),
                        });
                        hier = punkte.length - 1;
                        seeOrte.set(schluessel, hier);
                    }
                }
                if (s === 0) erster = hier;
                if (hier !== null && davor !== null && hier !== davor) strecken.push([davor, hier]);
                davor = hier;
            }
            if (ganz && erster !== null && davor !== null && erster !== davor) strecken.push([davor, erster]);
        }
    });
    return { punkte, strecken };
}

/** Alle Ringe einer Fläche (außen und Inseln, je Polygon), ohne den wiederholten Schlusspunkt. */
function ringeVon(g: V12Geometry): (readonly (readonly [number, number])[])[] {
    const c = g.coordinates as unknown;
    const ringe = g.type === "Polygon" ? (c as [number, number][][]) : (c as [number, number][][][]).flat();
    return ringe
        .map((ring) =>
            ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]
                ? ring.slice(0, -1)
                : ring,
        )
        .filter((ring) => ring.length >= 3);
}

/** Die äußeren Ringe einer Fläche, je Polygon einer: Die übrigen Ringe sind Inseln im See. */
function aeussereRinge(g: V12Geometry): (readonly (readonly [number, number])[])[] {
    const c = g.coordinates as unknown;
    const polygone = g.type === "Polygon" ? [c as [number, number][][]] : (c as [number, number][][][]);
    return polygone.map((polygon) => polygon[0] ?? []);
}

/** Punkte auf einem geschlossenen Ring, gleichmäßig über den Umfang, höchstens `abstand` auseinander, mindestens drei. */
function uferPunkte(ring: readonly (readonly [number, number])[], abstand: number): [number, number][] {
    const n = ring.length;
    const kanten = ring.map((p, i) => Math.hypot(ring[(i + 1) % n]![0] - p[0], ring[(i + 1) % n]![1] - p[1]));
    const umfang = kanten.reduce((a, b) => a + b, 0);
    if (!(umfang > 0)) return [];
    const zahl = Math.max(3, Math.ceil(umfang / abstand));
    const aus: [number, number][] = [];
    let kante = 0;
    let bis = 0;
    for (let k = 0; k < zahl; k++) {
        const s = (k * umfang) / zahl;
        while (kante < n - 1 && bis + kanten[kante]! < s) bis += kanten[kante++]!;
        const [ax, ay] = ring[kante]!;
        const [bx, by] = ring[(kante + 1) % n]!;
        const u = kanten[kante]! > 0 ? Math.min(1, (s - bis) / kanten[kante]!) : 0;
        aus.push([ax + u * (bx - ax), ay + u * (by - ay)]);
    }
    return aus;
}

/**
 * Wo die Strecke a → b den Rand einer Fläche kreuzt: der Anteil `u` in [0, 1] des ersten Schnitts von a aus, mit `letzter` des letzten; ohne
 * Schnitt `undefined`.
 */
function kreuzung(
    a: readonly [number, number],
    b: readonly [number, number],
    g: V12Geometry,
    letzter: boolean,
): number | undefined {
    let best: number | undefined;
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    for (const ring of ringeVon(g))
        for (let i = 0; i < ring.length; i++) {
            const [px, py] = ring[i]!;
            const [qx, qy] = ring[(i + 1) % ring.length]!;
            const sx = qx - px;
            const sy = qy - py;
            const nenner = rx * sy - ry * sx;
            if (Math.abs(nenner) < 1e-15) continue;
            const u = ((px - a[0]) * sy - (py - a[1]) * sx) / nenner;
            const t = ((px - a[0]) * ry - (py - a[1]) * rx) / nenner;
            if (u < 0 || u > 1 || t < 0 || t > 1) continue;
            if (best === undefined || (letzter ? u > best : u < best)) best = u;
        }
    return best;
}
