import { canonColour } from "@avesmaps3d/shared";
import { LINIEN_ZEICHEN, type LinienForm, type LinienZeichen } from "./reisebild-zeichen";
import { zeichneBildzeichen } from "./stelle-layer";

/**
 * Die Bilder der Reisebilder auf der Karte (WI-0272 S4, Aufgabe 26): MapLibre kennt keine Formen, also zeichnet dieses Modul sie als Laufzeitbilder (`map/runtime-images.ts`), Pixelverhältnis 2.
 * Maße und Farben sind die der Probierseite (`.marke`, `.ortfoto`), die Farben aus dem Kanon; die Karte hat kein dunkles Thema, darum gibt es keine Dunkelwerte.
 *
 * - **Das Zeichen** (`zeichneZeichen`): eine Scheibe von 30 px mit dem Bildzeichen (17 px), ab zwei Bildern mit Zahlmarke (ab 100 „99+“). Bei einem KI-Bild trägt sie unten rechts das Linienzeichen
 *   `roboter` (`LINIEN_ZEICHEN`): ein Zeichen statt Schrift, damit es in jeder Sprache gilt.
 * - **Die Fahne** (`zeichneFahne`): die Pille an einem Ort, 22 px hoch, Bildzeichen (13 px) und Zahl. Auch bei einem Bild steht die Zahl dabei.
 * - **Der Abzug** (`zeichneVorschau`): bei offener Leiste das Bild selbst, 40 px (frei) oder 30 px (Fahne) groß, mit Rand im Papier der Karte; ab zwei Bildern liegen zwei Abzüge versetzt dahinter. Beim
 *   Zeichen (40) zeigen sie nach rechts oben, die Zahlmarke sitzt an der Ecke rechts oben; bei der Fahne (30) nach LINKS oben: Die Fahne hängt mit dem Abzug unten rechts am Versatz (`FAHNE_VERSATZ`), und
 *   alles Überstehende darf diese Ecke nicht wegschieben. (Abweichung von der Probierseite, dort sitzt die Fahne ohne Anker an einer Ecke.)
 * - 🪤 **Die Bilder sind so gezeichnet, wie ihre Anker sitzen:** Das Zeichen und der Abzug 40 mittig in einer quadratischen Leinwand (Rand rundum gleich), die Fahne und der Abzug 30 mit dem Papier bündig
 *   unten rechts (bis auf die Haarlinie von 1 px).
 * - **Schrift:** Zahlen in einer Systemschrift (`Arial`): Die Hausschrift ist beim Zeichnen nicht sicher geladen, und ein Ersatz je nach Zeitpunkt sähe auf jedem Gerät anders aus (wie `drawApproximateBadgeImage`).
 */

/** Das Pixelverhältnis aller Laufzeitbilder (`registerRuntimeImages`). */
export const BILD_PIXELVERHAELTNIS = 2;

const SCHEIBE = 30;
const SCHEIBE_RAND = 12;
const BILDZEICHEN_IN_SCHEIBE = 17;
const BILDZEICHEN_IN_FAHNE = 13;
const FAHNE_HOEHE = 22;
const MARKE_HOEHE = 18;
const MARKE_SCHRIFT = 11;
const SCHRIFT = `Arial, "Helvetica Neue", sans-serif`;
const HAARLINIE = 1;
/** Wie weit der Abzug 40/30 über das Papier hinaus Platz braucht (Stapel 8, Zahlmarke 14 oben und 16 seitlich). */
const ABZUG_UEBERSTAND = 18;
const ABZUG_STAPEL = 4;
const ABZUG_RAND = 2;
const ABZUG_ECKE = 4;

/** Die Größen des Abzugs, wie `zeichneVorschau` sie kennt. */
export type AbzugKante = 40 | 30;

/** Der Text der Zahlmarke und der Kennungen: ab 100 „99+“. */
export const zahlText = (zahl: number): string => (zahl >= 100 ? "99+" : String(Math.max(1, Math.floor(zahl))));

export const bildIdZeichen = (zahl: number, ki: boolean): string =>
    `photobox-zeichen-${zahlText(zahl)}${ki ? "-ki" : ""}`;
export const bildIdFahne = (zahl: number): string => `photobox-fahne-${zahlText(zahl)}`;
export const bildIdVorschau = (id: string, kante: AbzugKante, zahl: number, ki: boolean): string =>
    `photobox-vorschau-${String(kante)}-${id}-${zahlText(zahl)}${ki ? "-ki" : ""}`;

interface Flaeche {
    readonly ctx: CanvasRenderingContext2D;
    readonly breite: number;
    readonly hoehe: number;
    /** Die fertige Leinwand als Bild, so groß wie angelegt. */
    lies(): ImageData;
}

/** Eine Leinwand in logischen Pixeln; gezeichnet wird in logischen Einheiten, das Pixelverhältnis steckt in der Skalierung. */
function leinwand(breite: number, hoehe: number, pixelRatio: number): Flaeche {
    const flaeche = document.createElement("canvas");
    flaeche.width = breite * pixelRatio;
    flaeche.height = hoehe * pixelRatio;
    const ctx = flaeche.getContext("2d");
    if (ctx === null) throw new Error("Keine 2D-Fläche für die Reisebild-Zeichen");
    ctx.scale(pixelRatio, pixelRatio);
    return { ctx, breite, hoehe, lies: () => ctx.getImageData(0, 0, breite * pixelRatio, hoehe * pixelRatio) };
}

/** Der Pfad eines Rechtecks mit runden Ecken (ohne `roundRect`, das ältere Browser nicht kennen). */
function rundesRechteck(ctx: CanvasRenderingContext2D, x: number, y: number, b: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + b - r, y);
    ctx.arc(x + b - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + b, y + h - r);
    ctx.arc(x + b - r, y + h - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
}

/** Ein Linienzeichen des Hauses (`LINIEN_ZEICHEN`, Raster 24 × 24, Strich 1,75) mittig um (`mx`, `my`) in `kante` Einheiten. */
function zeichneLinienZeichen(
    ctx: CanvasRenderingContext2D,
    name: LinienZeichen,
    mx: number,
    my: number,
    kante: number,
    farbe: string,
): void {
    ctx.save();
    ctx.translate(mx - kante / 2, my - kante / 2);
    ctx.scale(kante / 24, kante / 24);
    ctx.strokeStyle = farbe;
    ctx.lineWidth = 1.75;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const form of LINIEN_ZEICHEN[name] as readonly LinienForm[]) {
        if (form.art === "pfad") ctx.stroke(new Path2D(form.d));
        else if (form.art === "kreis") {
            ctx.beginPath();
            ctx.arc(form.cx, form.cy, form.r, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            rundesRechteck(ctx, form.x, form.y, form.w, form.h, form.rx);
            ctx.stroke();
        }
    }
    ctx.restore();
}

/** Das Zeichen für KI-Bilder: ein kleines Plättchen mit dem Linienzeichen `roboter`, mittig um (`mx`, `my`). Keine Schrift. */
function zeichneKiPlaettchen(ctx: CanvasRenderingContext2D, mx: number, my: number): void {
    const radius = 7;
    ctx.beginPath();
    ctx.arc(mx, my, radius, 0, Math.PI * 2);
    ctx.fillStyle = canonColour("panel");
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = canonColour("borderStrong");
    ctx.stroke();
    zeichneLinienZeichen(ctx, "roboter", mx, my, 10, canonColour("textStrong"));
}

/** Die Zahlmarke: dunkle Pille mit Papierrand; `rechts` ist ihre rechte Kante, `oben` ihre obere. Gibt die Breite zurück. */
function zeichneZahlmarke(
    ctx: CanvasRenderingContext2D,
    zahl: number,
    kante: "rechts" | "links",
    x: number,
    y: number,
) {
    const text = zahlText(zahl);
    ctx.font = `600 ${String(MARKE_SCHRIFT)}px ${SCHRIFT}`;
    const breite = Math.max(MARKE_HOEHE, Math.ceil(ctx.measureText(text).width) + 8 + 3);
    const links = kante === "rechts" ? x - breite : x;
    rundesRechteck(ctx, links, y, breite, MARKE_HOEHE, MARKE_HOEHE / 2);
    ctx.fillStyle = canonColour("button");
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canonColour("mapPaper");
    rundesRechteck(ctx, links + 0.75, y + 0.75, breite - 1.5, MARKE_HOEHE - 1.5, MARKE_HOEHE / 2 - 0.75);
    ctx.stroke();
    ctx.fillStyle = canonColour("buttonText");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, links + breite / 2, y + MARKE_HOEHE / 2 + 0.5);
    return breite;
}

/**
 * Das Zeichen eines freien Bildes oder Bündels: Scheibe mit Bildzeichen, ab `zahl` 2 mit Zahlmarke, bei `ki` mit dem Plättchen `roboter` unten rechts. Quadratisch, die Scheibe in der Mitte.
 */
export function zeichneZeichen(zahl: number, ki: boolean, pixelRatio = BILD_PIXELVERHAELTNIS): ImageData {
    const kante = SCHEIBE + 2 * SCHEIBE_RAND;
    const { ctx, lies } = leinwand(kante, kante, pixelRatio);
    const mitte = kante / 2;
    // Haarlinie außen, darunter der weiche Schatten; dann Papier, Rand, Bildzeichen.
    ctx.beginPath();
    ctx.arc(mitte, mitte, SCHEIBE / 2 + HAARLINIE, 0, Math.PI * 2);
    ctx.fillStyle = canonColour("markerHairline");
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.beginPath();
    ctx.arc(mitte, mitte, SCHEIBE / 2, 0, Math.PI * 2);
    ctx.fillStyle = canonColour("panel");
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mitte, mitte, SCHEIBE / 2 - 0.75, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canonColour("borderStrong");
    ctx.stroke();
    zeichneBildzeichen(ctx, mitte, mitte, BILDZEICHEN_IN_SCHEIBE, canonColour("textStrong"));
    if (ki) zeichneKiPlaettchen(ctx, mitte + 11, mitte + 11);
    // Die Zahlmarke ragt 7 px über den oberen und 9 px über den rechten Rand der Scheibe.
    if (zahl >= 2) zeichneZahlmarke(ctx, zahl, "rechts", mitte + SCHEIBE / 2 + 9, mitte - SCHEIBE / 2 - 7);
    return lies();
}

/**
 * Die Fahne an einem Ort: eine Pille von 22 px Höhe mit Bildzeichen (13 px) und der Zahl. Die Haarlinie liegt rundum, das Papier der Pille sitzt 1 px vom unteren und rechten Rand: Die Fahne
 * hängt mit dieser Ecke an ihrem Versatz (`icon-anchor: bottom-right`).
 */
export function zeichneFahne(zahl: number, pixelRatio = BILD_PIXELVERHAELTNIS): ImageData {
    // Die Breite braucht die Schrift; gemessen wird auf einer Leinwand im selben Pixelverhältnis.
    const messung = leinwand(1, 1, pixelRatio).ctx;
    messung.font = `${String(MARKE_SCHRIFT)}px ${SCHRIFT}`;
    const text = zahlText(zahl);
    const textBreite = Math.ceil(messung.measureText(text).width);
    const pille = 1.5 + 5 + BILDZEICHEN_IN_FAHNE + 3 + textBreite + 6 + 1.5;
    const breite = Math.ceil(pille) + 2 * HAARLINIE;
    const hoehe = FAHNE_HOEHE + 2 * HAARLINIE;
    const { ctx, lies } = leinwand(breite, hoehe, pixelRatio);
    rundesRechteck(ctx, 0, 0, breite, hoehe, hoehe / 2);
    ctx.fillStyle = canonColour("markerHairline");
    ctx.fill();
    const papierBreite = breite - 2 * HAARLINIE;
    rundesRechteck(ctx, HAARLINIE, HAARLINIE, papierBreite, FAHNE_HOEHE, FAHNE_HOEHE / 2);
    ctx.fillStyle = canonColour("panel");
    ctx.fill();
    rundesRechteck(
        ctx,
        HAARLINIE + 0.75,
        HAARLINIE + 0.75,
        papierBreite - 1.5,
        FAHNE_HOEHE - 1.5,
        FAHNE_HOEHE / 2 - 0.75,
    );
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = canonColour("borderStrong");
    ctx.stroke();
    const mitteY = hoehe / 2;
    zeichneBildzeichen(
        ctx,
        HAARLINIE + 1.5 + 5 + BILDZEICHEN_IN_FAHNE / 2,
        mitteY,
        BILDZEICHEN_IN_FAHNE,
        canonColour("textStrong"),
    );
    ctx.font = `${String(MARKE_SCHRIFT)}px ${SCHRIFT}`;
    ctx.fillStyle = canonColour("textStrong");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, HAARLINIE + 1.5 + 5 + BILDZEICHEN_IN_FAHNE + 3, mitteY + 0.5);
    return lies();
}

export interface VorschauOptionen {
    readonly kante: AbzugKante;
    readonly zahl: number;
    readonly ki: boolean;
}

/**
 * Der Abzug: das Bild in einem Rand aus Kartenpapier (2 px, Ecken 4 px), darum die Haarlinie. Ab `zahl` 2 liegen zwei Abzüge versetzt dahinter und die Zahlmarke an der Ecke; bei `ki` das
 * Plättchen `roboter` unten rechts. Das Bild füllt das Quadrat (zugeschnitten, nicht verzerrt).
 */
export function zeichneVorschau(
    bild: Pick<ImageBitmap, "width" | "height"> & CanvasImageSource,
    optionen: VorschauOptionen,
    pixelRatio = BILD_PIXELVERHAELTNIS,
): ImageData {
    const { kante, zahl, ki } = optionen;
    const fahne = kante === 30;
    // Frei: rundum gleich viel Rand (mittig verankert). Fahne: Rand nur links und oben, unten und rechts bündig bis auf die Haarlinie.
    const rechts = fahne ? HAARLINIE : ABZUG_UEBERSTAND;
    const unten = fahne ? HAARLINIE : ABZUG_UEBERSTAND;
    const x = ABZUG_UEBERSTAND;
    const y = ABZUG_UEBERSTAND;
    const { ctx, lies } = leinwand(x + kante + rechts, y + kante + unten, pixelRatio);
    // Die Abzüge dahinter: bei der Freien nach rechts oben, bei der Fahne nach links oben.
    const richtung = fahne ? -1 : 1;
    const abzug = (dx: number, dy: number, schatten: boolean): void => {
        rundesRechteck(
            ctx,
            x + dx - HAARLINIE,
            y + dy - HAARLINIE,
            kante + 2 * HAARLINIE,
            kante + 2 * HAARLINIE,
            ABZUG_ECKE + 1,
        );
        ctx.fillStyle = canonColour("markerHairline");
        if (schatten) {
            ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;
        }
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        rundesRechteck(ctx, x + dx, y + dy, kante, kante, ABZUG_ECKE);
        ctx.fillStyle = canonColour("mapPaper");
        ctx.fill();
    };
    if (zahl >= 2) {
        abzug(richtung * 2 * ABZUG_STAPEL, -2 * ABZUG_STAPEL, false);
        abzug(richtung * ABZUG_STAPEL, -ABZUG_STAPEL, false);
    }
    abzug(0, 0, !fahne);
    // Das Bild füllt das Quadrat innerhalb des Rands (zugeschnitten auf die Mitte).
    const innen = kante - 2 * ABZUG_RAND;
    const seite = Math.min(bild.width, bild.height);
    ctx.save();
    rundesRechteck(ctx, x + ABZUG_RAND, y + ABZUG_RAND, innen, innen, ABZUG_ECKE - 1);
    ctx.clip();
    ctx.drawImage(
        bild,
        (bild.width - seite) / 2,
        (bild.height - seite) / 2,
        seite,
        seite,
        x + ABZUG_RAND,
        y + ABZUG_RAND,
        innen,
        innen,
    );
    ctx.restore();
    if (ki) zeichneKiPlaettchen(ctx, x + kante - 6, y + kante - 6);
    // Die Zahlmarke sitzt an der Ecke, an der die Abzüge herausragen: 14 px über dem Papier, 16 px darüber hinaus.
    if (zahl >= 2) {
        if (fahne) zeichneZahlmarke(ctx, zahl, "links", x - 16, y - 14);
        else zeichneZahlmarke(ctx, zahl, "rechts", x + kante + 16, y - 14);
    }
    return lies();
}
