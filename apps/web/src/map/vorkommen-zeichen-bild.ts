import { labelFamily, type InhalteVorkommenArt } from "@avesmaps3d/shared";
import { istKategorie, KATEGORIE_FORMEN, type ZeichenForm } from "../controls/kategorie-zeichen";
import { climateHaloColour, climateLabelWidth, climateNameColour } from "./landscape-layers";
import { patternPixelRatio } from "./stripe-pattern";
import type { ImageSink, StyleImageResolver } from "./style-image-resolver";

/**
 * Das Kategoriezeichen vor dem Namen eines gewählten Vorkommens auf der Karte (WI-0257 S5): Blatt, gefüllte Pfote, Korb, Person aus denselben Formen wie
 * die Oberfläche (`controls/kategorie-zeichen.ts`), als Bild im Text des Namens (MapLibre `["image", …]` in `format`).
 *
 * - **In der Farbe des Namens:** der dunkle Ton der Vorkommensfarbe mit blassem Saum, die Regel der Klima- und Sprachnamen (`climateNameColour`,
 *   `climateHaloColour`). MapLibre färbt ein Bild im Text nicht ein (kein SDF in `format`), deshalb trägt jede Farbe ihr eigenes Bild; der Name des Bildes
 *   nennt Kategorie, Farbe und Schriftgröße, gebaut wird es beim ersten Bedarf (`vorkommenZeichenResolver`, angemeldet an der EINEN Stelle für alle
 *   Laufzeitbilder, `style-image-resolver.ts`).
 * - **Klein lesbar:** Die Kante misst `ZEICHEN_ANTEIL` der Schriftgröße (20 px bei 22 px, 14 px am Telefon bei 16 px), der Strich ist mit
 *   `STRICH` etwas kräftiger als in der Oberfläche (1,5), und der Saum liegt um jede Form wie um die Buchstaben: Die Pfote ist gefüllt und braucht keinen
 *   Strich, Blatt, Korb und Person bleiben auf dem Gelände lesbar.
 */

export const VORKOMMEN_ZEICHEN_PREFIX = "vorkommen-zeichen-";

/** Die Kante des Zeichens als Anteil der Schriftgröße: etwas über der Versalhöhe, damit die Pfote nicht kleiner wirkt als die Buchstaben. */
const ZEICHEN_ANTEIL = 0.9;

/** Die Strichstärke im 16er-Raster (die Oberfläche: 1,5). */
const STRICH = 1.75;

/** Der Name des Bildes: Kategorie, Farbe des Vorkommens ohne `#`, Schriftgröße des Namens. */
export function zeichenBildName(kind: InhalteVorkommenArt, farbe: string, schrift: number): string {
    return `${VORKOMMEN_ZEICHEN_PREFIX}${kind}-${farbe.replace("#", "").toLowerCase()}-${String(schrift)}`;
}

/** Kategorie, Farbe und Schriftgröße aus dem Namen; `undefined`, wenn er nicht von hier stammt. */
export function leseZeichenBildName(
    id: string,
): { kind: InhalteVorkommenArt; farbe: string; schrift: number } | undefined {
    const treffer = /^vorkommen-zeichen-([a-z]+)-([0-9a-f]{6})-(\d{1,3})$/u.exec(id);
    const kind = treffer?.[1];
    if (!treffer || kind === undefined || !istKategorie(kind)) return undefined;
    const schrift = Number(treffer[3]);
    if (schrift <= 0) return undefined;
    return { kind, farbe: `#${treffer[2]!}`, schrift };
}

/** Kante, Rand für den Saum und Saumbreite in CSS-Pixeln zu einer Schriftgröße. */
export function zeichenMasse(schrift: number): { kante: number; rand: number; saum: number; breite: number } {
    const kante = Math.round(schrift * ZEICHEN_ANTEIL);
    const saum = schrift * labelFamily("climate").haloWidthRatio;
    const rand = Math.ceil(saum) + 1;
    return { kante, rand, saum, breite: kante + 2 * rand };
}

/** So breit steht ein Name samt Zeichen und Leerraum davor im Bild (Bildpunkte): für das Ausweichen der Namen (`area-labels.ts`, `flaechen.breite`). */
export function nameMitZeichenBreite(name: string, schrift: number): number {
    return zeichenMasse(schrift).breite + climateLabelWidth(` ${name}`, schrift);
}

function mitDrehung(ctx: CanvasRenderingContext2D, form: ZeichenForm, zeichne: (pfad: Path2D) => void): void {
    ctx.save();
    if (form.drehung !== undefined) {
        const [winkel, x, y] = form.drehung;
        ctx.translate(x, y);
        ctx.rotate((winkel * Math.PI) / 180);
        ctx.translate(-x, -y);
    }
    zeichne(new Path2D(form.d));
    ctx.restore();
}

/** Malt das Zeichen in einen Kasten der Kante `kante` (CSS-Pixel mal `pixelRatio`) mit Rand `rand`: zuerst der Saum um jede Form, dann die Form. */
export function maleZeichen(
    ctx: CanvasRenderingContext2D,
    kind: InhalteVorkommenArt,
    farben: { schrift: string; saum: string },
    masse: { kante: number; rand: number; saum: number },
    pixelRatio: number,
): void {
    const skala = (masse.kante / 16) * pixelRatio;
    const saum = (2 * masse.saum * pixelRatio) / skala;
    const formen = KATEGORIE_FORMEN[kind];
    ctx.save();
    ctx.translate(masse.rand * pixelRatio, masse.rand * pixelRatio);
    ctx.scale(skala, skala);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = farben.saum;
    ctx.fillStyle = farben.saum;
    for (const form of formen) {
        mitDrehung(ctx, form, (pfad) => {
            ctx.lineWidth = (form.gefuellt === true ? 0 : STRICH) + saum;
            ctx.stroke(pfad);
            if (form.gefuellt === true) ctx.fill(pfad);
        });
    }
    ctx.strokeStyle = farben.schrift;
    ctx.fillStyle = farben.schrift;
    ctx.lineWidth = STRICH;
    for (const form of formen) {
        mitDrehung(ctx, form, (pfad) => {
            if (form.gefuellt === true) ctx.fill(pfad);
            else ctx.stroke(pfad);
        });
    }
    ctx.restore();
}

/** Legt das Zeichen eines Vorkommens an, sobald MapLibre es braucht; ein neuer Stil fragt es wieder an. */
export function vorkommenZeichenResolver(map: ImageSink): StyleImageResolver {
    return {
        prefix: VORKOMMEN_ZEICHEN_PREFIX,
        resolve(id) {
            const gelesen = leseZeichenBildName(id);
            if (!gelesen || map.hasImage(id)) return;
            const masse = zeichenMasse(gelesen.schrift);
            const pixelRatio = patternPixelRatio();
            const seite = Math.ceil(masse.breite * pixelRatio);
            const leinwand = document.createElement("canvas");
            leinwand.width = seite;
            leinwand.height = seite;
            const ctx = leinwand.getContext("2d");
            if (!ctx) return;
            maleZeichen(
                ctx,
                gelesen.kind,
                { schrift: climateNameColour(gelesen.farbe), saum: climateHaloColour(gelesen.farbe) },
                masse,
                pixelRatio,
            );
            const pixel = ctx.getImageData(0, 0, seite, seite);
            map.addImage(id, { width: seite, height: seite, data: new Uint8Array(pixel.data.buffer) }, { pixelRatio });
        },
    };
}
