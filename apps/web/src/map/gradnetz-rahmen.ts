import type { Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    GRADNETZ_STUFEN,
    canonColour,
    fromRenderLngLat,
    gradAusKartenpunkt,
    gradnetzStufe,
    gradText,
    type Himmelsrichtungen,
} from "@avesmaps3d/shared";
import {
    coveredEdges,
    layoutBox,
    measureOverlays,
    NO_INSETS,
    type Box,
    type Insets,
    type Overlay,
} from "./camera/visible-area";

/**
 * Der Rahmen des Gradnetzes (WI-0273, OPS-069): ein Papierrand mit Gradleiste wie im Atlas, darin die Grade, wo die Linien
 * den Rand kreuzen (Entwurf Fassung 2, Betreiber 2026-10-31: „Gradnetz, Rahmen, bis Bogenminuten“).
 *
 * Er weicht nur Panels aus, die eine Kante fast ganz belegen (`rahmenRaender`), etwa einem angedockten Editor. Ein schwebendes
 * Panel wie der Reiseplaner liegt über dem Rahmen wie über der Karte; sonst lief unter ihm die Karte außerhalb des Rahmens weiter
 * (Betreiber 2026-10-31, Bild der Stage). Wo die Linien den Rand kreuzen, misst er an
 * Stichproben entlang der Innenkante (`unproject`), nicht an den Linien selbst: So stimmt er auch geneigt, gedreht und über
 * dem Gelände, und über dem Horizont bleibt die Leiste einfach leer. Jede Leiste trägt die Achse, die sie öfter kreuzt.
 */
export const GRADNETZ_RAHMEN_BREITE = 22;
const LEISTE = 5;
const STICHPROBE_PX = 20;
const LUFT_PX = 8;

interface Treffer {
    pos: number;
    k: number;
}

interface Kante {
    /** Bildpunkt auf der Innenkante bei Anteil `t` (0…1). */
    punkt(t: number): [number, number];
    laenge: number;
    waagerecht: boolean;
    /** Wo Leiste und Schrift liegen: Anfang der Leiste quer zur Kante, Mitte der Schrift. */
    leiste: number;
    schrift: number;
}

/** Ab diesem Anteil seiner Kante zählt ein Panel als Rand der Karte. */
export const GANZE_KANTE = 0.8;

/** Die Ränder, denen der Rahmen ausweicht: je Kante das weiteste Panel, das sie zu mindestens `GANZE_KANTE` belegt. */
export function rahmenRaender(karte: Box, panels: readonly Overlay[]): Insets {
    const belegt = (panel: Overlay): number => {
        const { box, edge } = panel;
        if (edge === "left" || edge === "right") {
            return (
                (Math.min(box.top + box.height, karte.top + karte.height) - Math.max(box.top, karte.top)) / karte.height
            );
        }
        return (
            (Math.min(box.left + box.width, karte.left + karte.width) - Math.max(box.left, karte.left)) / karte.width
        );
    };
    return coveredEdges(
        karte,
        panels.filter((panel) => belegt(panel) >= GANZE_KANTE),
    );
}

export interface GradnetzRahmen {
    zeichne(): void;
    /** Die Panels neu messen (eins geht auf, zu oder ändert seine Größe) und neu zeichnen. */
    messe(): void;
    entferne(): void;
}

interface Optionen {
    sichtbar: () => boolean;
    richtung: () => Himmelsrichtungen;
}

export function installGradnetzRahmen(map: MapLibreMap, optionen: Optionen): GradnetzRahmen {
    const leinwand = document.createElement("canvas");
    leinwand.className = "gradnetz-rahmen";
    leinwand.setAttribute("aria-hidden", "true");
    // 🪤 Eine Leinwand ist ein ersetztes Element: `inset: 0` allein dehnt sie nicht, sie behielte ihre Pixelgröße (× dpr).
    Object.assign(leinwand.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "1",
    });
    map.getContainer().appendChild(leinwand);
    const ctx = leinwand.getContext("2d");

    // Gemessen wird nur, wenn sich Karte oder Panels ändern, nicht in jedem Bild (WI-0249: kein erzwungenes Layout je Bild).
    let raender: Insets = NO_INSETS;
    let geplant = 0;
    const zeichne = (): void => {
        if (geplant !== 0) return;
        geplant = requestAnimationFrame(() => {
            geplant = 0;
            if (ctx) male(map, leinwand, ctx, optionen, raender);
        });
    };
    const messe = (): void => {
        raender = rahmenRaender(layoutBox(map.getContainer()), measureOverlays(document));
        zeichne();
    };
    for (const ereignis of ["move", "idle"] as const) map.on(ereignis, zeichne);
    map.on("resize", messe);
    messe();
    return {
        zeichne,
        messe,
        entferne() {
            if (geplant !== 0) cancelAnimationFrame(geplant);
            for (const ereignis of ["move", "idle"] as const) map.off(ereignis, zeichne);
            map.off("resize", messe);
            leinwand.remove();
        },
    };
}

function male(
    map: MapLibreMap,
    leinwand: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    optionen: Optionen,
    frei: Insets,
): void {
    const behaelter = map.getContainer();
    const w = behaelter.clientWidth;
    const h = behaelter.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (leinwand.width !== Math.round(w * dpr) || leinwand.height !== Math.round(h * dpr)) {
        leinwand.width = Math.round(w * dpr);
        leinwand.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!optionen.sichtbar()) return;
    const kasten = { links: frei.left, oben: frei.top, rechts: w - frei.right, unten: h - frei.bottom };
    maleRahmen(ctx, map, kasten, optionen.richtung());
}

/**
 * Der Rahmen um einen Kasten der Karte, in CSS-Pixeln des Kartenbehälters: auf der Karte um die freie Fläche, im Screenshot
 * (WI-0274) in den Rand des aufgenommenen Felds, damit das Bild aussieht wie die Karte. Zeichnet nur, löscht nichts.
 */
export function maleRahmen(
    ctx: CanvasRenderingContext2D,
    map: MapLibreMap,
    kasten: { links: number; oben: number; rechts: number; unten: number },
    richtung: Himmelsrichtungen,
): void {
    const B = GRADNETZ_RAHMEN_BREITE;
    const { links, oben, rechts, unten } = kasten;
    if (rechts - links < 6 * B || unten - oben < 6 * B) return;

    const papier = canonColour("panel");
    const tinte = canonColour("text");
    const schrift = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "serif";
    ctx.fillStyle = papier;
    ctx.fillRect(links, oben, rechts - links, B);
    ctx.fillRect(links, unten - B, rechts - links, B);
    ctx.fillRect(links, oben, B, unten - oben);
    ctx.fillRect(rechts - B, oben, B, unten - oben);

    const stufe = GRADNETZ_STUFEN[gradnetzStufe(map.getZoom())] ?? GRADNETZ_STUFEN[0];
    if (!stufe) return;
    const schritt = stufe.schritt;
    const innen = { links: links + B, oben: oben + B, rechts: rechts - B, unten: unten - B };
    const breite = innen.rechts - innen.links;
    const hoehe = innen.unten - innen.oben;
    const kanten: Kante[] = [
        {
            punkt: (t) => [innen.links + t * breite, innen.oben],
            laenge: breite,
            waagerecht: true,
            leiste: innen.oben - LEISTE,
            schrift: oben + (B - LEISTE) / 2,
        },
        {
            punkt: (t) => [innen.links + t * breite, innen.unten],
            laenge: breite,
            waagerecht: true,
            leiste: innen.unten,
            schrift: unten - (B - LEISTE) / 2,
        },
        {
            punkt: (t) => [innen.links, innen.oben + t * hoehe],
            laenge: hoehe,
            waagerecht: false,
            leiste: innen.links - LEISTE,
            schrift: links + (B - LEISTE) / 2,
        },
        {
            punkt: (t) => [innen.rechts, innen.oben + t * hoehe],
            laenge: hoehe,
            waagerecht: false,
            leiste: innen.rechts,
            schrift: rechts - (B - LEISTE) / 2,
        },
    ];

    ctx.font = `11px ${schrift}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const kante of kanten) {
        const messung = miss(map, kante, schritt);
        const anfang = kante.waagerecht ? innen.links : innen.oben;
        // Die Gradleiste: Felder zwischen den Kreuzungen, abwechselnd Tinte und Papier, nur wo die Karte Boden zeigt.
        if (messung) {
            const { treffer, von, bis, steigt } = messung;
            const grenzen = [von, ...treffer.map((t) => t.pos), bis];
            const erstes = treffer[0];
            const letztes = treffer[treffer.length - 1];
            for (let i = 0; i < grenzen.length - 1; i += 1) {
                const a = grenzen[i] ?? von;
                const b = grenzen[i + 1] ?? bis;
                let feld: number;
                if (!erstes || !letztes) feld = 0;
                else if (i === 0) feld = steigt ? erstes.k - 1 : erstes.k;
                else if (i === grenzen.length - 2) feld = steigt ? letztes.k : letztes.k - 1;
                else feld = Math.min(treffer[i - 1]?.k ?? 0, treffer[i]?.k ?? 0);
                ctx.fillStyle = ((feld % 2) + 2) % 2 === 0 ? tinte : papier;
                if (kante.waagerecht) ctx.fillRect(anfang + a, kante.leiste, b - a, LEISTE);
                else ctx.fillRect(kante.leiste, anfang + a, LEISTE, b - a);
            }
        }
        ctx.strokeStyle = tinte;
        ctx.lineWidth = 1;
        if (kante.waagerecht) ctx.strokeRect(innen.links, kante.leiste, breite, LEISTE);
        else ctx.strokeRect(kante.leiste, innen.oben, LEISTE, hoehe);
        if (!messung) continue;
        // Die Grade, ohne dass sich Nachbarn berühren.
        ctx.fillStyle = tinte;
        let letzteEnde = -Infinity;
        for (const t of messung.treffer) {
            const text = gradText(t.k * schritt, messung.achse, schritt < 1, richtung);
            const halb = ctx.measureText(text).width / 2;
            if (t.pos - halb < letzteEnde + LUFT_PX || t.pos - halb < 0 || t.pos + halb > kante.laenge) continue;
            letzteEnde = t.pos + halb;
            ctx.save();
            if (kante.waagerecht) ctx.translate(anfang + t.pos, kante.schrift);
            else {
                ctx.translate(kante.schrift, anfang + t.pos);
                ctx.rotate(-Math.PI / 2);
            }
            ctx.fillText(text, 0, 1);
            ctx.restore();
        }
    }
    ctx.strokeStyle = tinte;
    ctx.lineWidth = 1;
    ctx.strokeRect(links + 0.5, oben + 0.5, rechts - links - 1, unten - oben - 1);
}

/** Wo die Linien der Stufe die Kante kreuzen, in Bildpunkten ab ihrem Anfang; `undefined`, wenn dort kein Kartenboden ist. */
function miss(
    map: MapLibreMap,
    kante: Kante,
    schritt: number,
): { achse: "lon" | "lat"; treffer: Treffer[]; von: number; bis: number; steigt: boolean } | undefined {
    const anzahl = Math.max(2, Math.ceil(kante.laenge / STICHPROBE_PX));
    const proben: { pos: number; lon: number; lat: number }[] = [];
    for (let i = 0; i <= anzahl; i += 1) {
        const t = i / anzahl;
        const ort = map.unproject(kante.punkt(t));
        if (!Number.isFinite(ort.lng) || !Number.isFinite(ort.lat) || Math.abs(ort.lat) > 85) continue;
        const punkt = fromRenderLngLat(AVENTURIA.coordinateSpace, ort);
        if (punkt.x < 0 || punkt.x > 1024 || punkt.y < 0 || punkt.y > 1024) continue;
        proben.push({ pos: t * kante.laenge, ...gradAusKartenpunkt(punkt) });
    }
    const erste = proben[0];
    const letzte = proben[proben.length - 1];
    if (!erste || !letzte || proben.length < 2) return undefined;
    const kreuzungen = (achse: "lon" | "lat"): Treffer[] => {
        const treffer: Treffer[] = [];
        for (let i = 0; i < proben.length - 1; i += 1) {
            const p = proben[i];
            const q = proben[i + 1];
            if (!p || !q) continue;
            const a = p[achse];
            const b = q[achse];
            for (let k = Math.ceil(Math.min(a, b) / schritt - 1e-9); k * schritt <= Math.max(a, b) + 1e-9; k += 1) {
                const anteil = b === a ? 0 : (k * schritt - a) / (b - a);
                treffer.push({ pos: p.pos + anteil * (q.pos - p.pos), k });
            }
        }
        // Liegt eine Probe genau auf einer Linie, melden beide Nachbarstrecken sie.
        return treffer.sort((x, y) => x.pos - y.pos).filter((t, i, alle) => alle[i - 1]?.k !== t.k);
    };
    const lon = kreuzungen("lon");
    const lat = kreuzungen("lat");
    const achse = lon.length >= lat.length ? "lon" : "lat";
    return {
        achse,
        treffer: achse === "lon" ? lon : lat,
        von: erste.pos,
        bis: letzte.pos,
        steigt: letzte[achse] >= erste[achse],
    };
}
