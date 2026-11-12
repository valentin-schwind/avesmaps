import { AVENTURIA_SERIES, canonColour, LEGAL_NOTICES, type MapSeries } from "@avesmaps3d/shared";
import { GRADNETZ_RAHMEN_BREITE } from "../map/gradnetz-rahmen";

/**
 * Die Nennung im Screenshot (WI-0274, Vali 2026-11-01): Ein weitergegebenes Bild verbreitet Material von Ulisses, deshalb trägt jedes
 * Bild unten rechts das DSA-Fanprojekt-Logo, die Nennung der Kartenserie und die Adresse der Fan-Richtlinie.
 *
 * - **Logo:** Lizenz des Kartenpakets, Abschnitt 2, und Fan-Richtlinie verlangen es; dieselbe Datei wie im Fenster „Hinweise“.
 * - **Text:** keine neue Tafel, sondern `attribution` der gezeigten Kartenserie (einstellbar im Reiter „Kartenserien“; außer auf Deutsch
 *   die englische).
 * - **Adresse:** 🔴 die Fan-Richtlinie (`LEGAL_NOTICES`), Entscheidung des Betreibers („Nur Fan-Richtlinie“). Die Lizenz des Kartenpakets
 *   verlangt nach ihrem Wortlaut ihre eigene Adresse (`license.uri`, Wiki Aventurica); das war ihm gesagt.
 * - **Sie liegt im Bild** über der Karte: Das Format des Bilds bleibt genau. Papier und Tinte wie der Rahmen. Die Schrift wächst mit dem
 *   Bild; ist es schmal, bricht der Text um und das Logo steht darüber.
 */

const LOGO_URL = "/img/dsa-fanprojekt-logo.webp";

let logoLaedt: Promise<HTMLImageElement | undefined> | undefined;

/** Das Logo, einmal geladen und dann behalten. Scheitert es, gibt es `undefined`; das Bild trägt dann den Text und der nächste Versuch lädt neu. */
export function ladeNennungsLogo(): Promise<HTMLImageElement | undefined> {
    logoLaedt ??= new Promise((fertig) => {
        const bild = new Image();
        bild.onload = () => fertig(bild);
        bild.onerror = () => {
            logoLaedt = undefined;
            fertig(undefined);
        };
        bild.src = LOGO_URL;
    });
    return logoLaedt;
}

/** Trennt die Teile der Nennung und bleibt dabei am Ende der Zeile, nie am Anfang der nächsten. */
const TRENNER = " · ";

export function nennungText(serie: Pick<MapSeries, "attribution" | "en">, deutsch: boolean): string {
    const eigen = (deutsch ? serie.attribution : serie.en.attribution).trim();
    // Eine selbst angelegte Serie kann ohne Nennung sein; das Material bleibt dasselbe.
    const basis = AVENTURIA_SERIES.series[0];
    const vorgabe = (deutsch ? basis?.attribution : basis?.en.attribution) ?? "";
    const adresse = LEGAL_NOTICES.project.fanGuidelinesUri;
    return `${eigen === "" ? vorgabe : eigen}${TRENNER}${adresse}`.replaceAll(" · ", TRENNER);
}

/** Zerlegt ein Wort, das allein zu breit ist: eine Adresse nach jedem „/“, was dann noch nicht passt, Zeichen für Zeichen. */
function teile(wort: string, breite: number, miss: (text: string) => number): string[] {
    if (miss(wort) <= breite) return [wort];
    const stuecke = wort.split(/(?<=\/)/);
    const aus: string[] = [];
    let zeile = "";
    for (const stueck of stuecke.length > 1 ? stuecke : [...wort]) {
        if (zeile !== "" && miss(zeile + stueck) > breite) {
            aus.push(zeile);
            zeile = "";
        }
        if (miss(stueck) > breite && stuecke.length > 1) {
            aus.push(...teile(stueck, breite, miss));
        } else {
            zeile += stueck;
        }
    }
    if (zeile !== "") aus.push(zeile);
    return aus;
}

/** Bricht den Text in Zeilen um, die höchstens `breite` breit sind. */
export function umbreche(text: string, breite: number, miss: (text: string) => number): string[] {
    const zeilen: string[] = [];
    let zeile = "";
    for (const wort of text.split(" ")) {
        const zusammen = zeile === "" ? wort : `${zeile} ${wort}`;
        if (miss(zusammen) <= breite) {
            zeile = zusammen;
            continue;
        }
        if (zeile !== "") zeilen.push(zeile);
        const stuecke = teile(wort, breite, miss);
        zeilen.push(...stuecke.slice(0, -1));
        zeile = stuecke.at(-1) ?? "";
    }
    if (zeile !== "") zeilen.push(zeile);
    return zeilen;
}

/** Die Schriftgröße zur kurzen Seite der Kartenfläche (CSS-Pixel): wie der Rahmen 11 px, in großen Bildern bis 16 px. */
export function nennungSchrift(breite: number, hoehe: number): number {
    return Math.round(Math.min(16, Math.max(11, Math.min(breite, hoehe) / 90)));
}

const RAND = 6;
const POLSTER = 5;
const ABSTAND = 8;
/** So hoch steht das Logo, gemessen an der Schrift: Sein Schriftzug bleibt damit lesbar. */
const LOGO_JE_SCHRIFT = 2.6;
/** Bleibt neben dem Logo weniger Platz für den Text, steht das Logo darüber. */
const TEXT_MIN = 150;

export interface NennungLage {
    x: number;
    y: number;
    w: number;
    h: number;
    zeilen: readonly string[];
    zeilenhoehe: number;
    textX: number;
    textY: number;
    logo?: { x: number; y: number; w: number; h: number };
}

/** Wo Kasten, Logo und Zeilen in der Kartenfläche `innen` stehen; `logoVerhaeltnis` ist Breite durch Höhe, ohne Logo `undefined`. */
export function nennungLage(
    innen: { links: number; rechts: number; unten: number },
    text: string,
    groesse: number,
    logoVerhaeltnis: number | undefined,
    miss: (text: string) => number,
): NennungLage {
    const platz = Math.max(40, innen.rechts - innen.links - 2 * (RAND + POLSTER));
    const logoH = logoVerhaeltnis === undefined ? 0 : Math.round(groesse * LOGO_JE_SCHRIFT);
    const logoW = logoVerhaeltnis === undefined ? 0 : Math.round(logoH * logoVerhaeltnis);
    const mitLogo = logoW > 0;
    const daneben = mitLogo && platz - logoW - ABSTAND >= TEXT_MIN;
    const zeilen = umbreche(text, daneben ? platz - logoW - ABSTAND : platz, miss);
    const zeilenhoehe = Math.round(groesse * 1.3);
    const textW = Math.ceil(Math.max(...zeilen.map(miss)));
    const textH = zeilen.length * zeilenhoehe;
    const inhaltW = daneben ? logoW + ABSTAND + textW : Math.max(logoW, textW);
    const inhaltH = daneben ? Math.max(logoH, textH) : (mitLogo ? logoH + ABSTAND : 0) + textH;
    const w = inhaltW + 2 * POLSTER;
    const h = inhaltH + 2 * POLSTER;
    const x = innen.rechts - RAND - w;
    const y = innen.unten - RAND - h;
    const lage: NennungLage = {
        x,
        y,
        w,
        h,
        zeilen,
        zeilenhoehe,
        textX: x + POLSTER + (daneben ? logoW + ABSTAND : 0),
        textY: y + POLSTER + (daneben ? (inhaltH - textH) / 2 : mitLogo ? logoH + ABSTAND : 0),
    };
    if (mitLogo) {
        lage.logo = { x: x + POLSTER, y: y + POLSTER + (daneben ? (inhaltH - logoH) / 2 : 0), w: logoW, h: logoH };
    }
    return lage;
}

/** Zeichnet die Nennung unten rechts in den Kasten, in CSS-Pixeln des Kartenbehälters; ein Rahmen nimmt die äußeren Pixel ein. */
export function maleNennung(
    ctx: CanvasRenderingContext2D,
    kasten: { links: number; oben: number; rechts: number; unten: number },
    text: string,
    mitRahmen: boolean,
    logo: HTMLImageElement | undefined,
): void {
    const rand = mitRahmen ? GRADNETZ_RAHMEN_BREITE : 0;
    const innen = { links: kasten.links + rand, rechts: kasten.rechts - rand, unten: kasten.unten - rand };
    const groesse = nennungSchrift(innen.rechts - innen.links, innen.unten - kasten.oben - rand);
    const schrift = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "serif";
    ctx.save();
    ctx.font = `${String(groesse)}px ${schrift}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const verhaeltnis = logo && logo.naturalHeight > 0 ? logo.naturalWidth / logo.naturalHeight : undefined;
    const lage = nennungLage(innen, text, groesse, verhaeltnis, (teil) => ctx.measureText(teil).width);
    ctx.fillStyle = canonColour("panel");
    ctx.fillRect(lage.x, lage.y, lage.w, lage.h);
    ctx.strokeStyle = canonColour("text");
    ctx.lineWidth = 1;
    ctx.strokeRect(lage.x + 0.5, lage.y + 0.5, lage.w - 1, lage.h - 1);
    if (logo && lage.logo) ctx.drawImage(logo, lage.logo.x, lage.logo.y, lage.logo.w, lage.logo.h);
    ctx.fillStyle = canonColour("text");
    lage.zeilen.forEach((zeile, nr) => {
        ctx.fillText(zeile, lage.textX, lage.textY + lage.zeilenhoehe * (nr + 0.5));
    });
    ctx.restore();
}
