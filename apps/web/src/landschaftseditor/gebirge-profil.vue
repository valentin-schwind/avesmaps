<script setup lang="ts">
import { computed, ref } from "vue";
import { bogen, pointInGeometry, seeSpiegel, type EditorGebirge, type V12Geometry } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { flussZahlen, lagenEntlang, passZahlen, type ProfilLinie } from "./gebirge-gewaesser";
import {
    gezogeneHoehe,
    hoeheAmProfil,
    hoeheVonY,
    PROFIL_SCHRITT,
    profilAchse,
    profilGriffe,
    profilRand,
    profilX,
    seePlatten,
    yVonHoehe,
    type Achse,
} from "./gebirge-profil-fluss";
import { LEERES_NETZ, wasserBasis, type GebirgsNetz, type NetzPunkt, type NetzStelle } from "./kamm-netz";
import { flussAnsicht, flussHoehenZahlen, teilImFluss, teilImSee } from "./kamm-netz-fluss";
import type { KammNetzProfil } from "./kamm-netz-profil";

/**
 * Das Höhenprofil eines Flusses oder Passes im Reiter „Gebirge“ (WI-0245, Entwurf V16/V17, Bilder 8 und 9): die Kurve, hell hinterlegt
 * das Stück in der Fläche, am Pass die Kammhöhe gestrichelt; darunter die Zahlen und woher die Höhen kommen. Der Fluss steht mit der
 * Quelle links (nach seiner Fließrichtung), der Pass in seiner Richtung. Die Höhen kommen aus dem Höhenmodell der Wegfindung
 * (`GET …/:area/profile`).
 *
 * Der Fluss ist blau, und wo er einen See durchquert, steht der See als Platte darunter, kräftiger als die Fläche, mit eigener Marke in der
 * Legende (WI-0249, Vali 2026-10-25: „wärs cool, wen die linien, blau sind und die seen "Platten" etwas deutlicher hervorgehoben weredn“).
 *
 * **Eigene Höhen** (WI-0259, OPS-071; Vali 2026-10-30: „wenn du clever bist kannst du da die punkte die den fluss bilden mit hoch-runter-pfeil
 * zusätzlich zum editor zur reinen höhenveränderung verwenden“; Probierseite abgenommen: „der kammeditor mit dem editierbaren flussprofil passt“):
 * - Gestrichelt läuft der Verlauf mit den eigenen Höhen (`kamm-netz-fluss.ts`, dieselbe Rechnung wie das „!“ an der Karte), gelb die Stücke,
 *   auf denen der Fluss in Fließrichtung steigt. Zwei feine Linien zeigen die höchste und die tiefste Stelle mit Zahl; die Zahlenzeile folgt
 *   den Höhen. Ein See mit eigener Höhe steht flach auf seinem Spiegel.
 * - Außerhalb des Modus „Kämme zeichnen“ zeigt das Profil eigene Höhen nur als gefüllte Punkte. Läuft der Modus, ist es doppelt so hoch und hat
 *   Griffe: an jedem Stützpunkt in der Fläche (die anderen sind grau) und an der Platte eines Sees. Nach oben oder unten ziehen setzt die Höhe
 *   (10er-Schritt, eine Blase nennt den Wert) im EINEN Entwurf des Kammeditors (↶, „Verwerfen“, „Fertig“ gelten); ein Doppelklick nimmt die
 *   eigene Höhe weg (ausgewertet über `detail` im Klick, weil der erste Klick neu zeichnet); Pfeil hoch und runter tun dasselbe. Die Auswahl
 *   teilen Karte und Profil.
 */
const props = defineProps<{
    art: "fluss" | "pass";
    /** Die Linie in Karteneinheiten, in der Folge der Abtastung. */
    linie: readonly (readonly [number, number])[];
    profil: ProfilLinie;
    flaeche: V12Geometry;
    /** Der Name des Gebirges für „in …“. */
    name?: string | undefined;
    /** Die Kammhöhe für die gestrichelte Linie am Pass. */
    kamm?: number | undefined;
    /** Die Seen, die der Fluss durchquert: Dort steht eine Platte unter der Kurve (ohne `eingabe`). */
    seen?: readonly V12Geometry[] | undefined;
    /** Der Index des Flusses in `eingabe.fluesse` (WI-0259); ohne ihn und ohne `eingabe` zeigt das Profil keine eigenen Höhen. */
    flussNr?: number | undefined;
    /** Die Eingabe der Fläche: Fließrichtung, alle Seen. */
    eingabe?: EditorGebirge["eingabe"] | undefined;
    /** Das Netz im Entwurf (Reiter „Gebirge“); läuft der Modus, gilt stattdessen das des Kammeditors. */
    netz?: GebirgsNetz | undefined;
    /** Der Zugriff auf den laufenden Kammeditor; nur gesetzt, solange „Kämme zeichnen“ läuft (`kamm-netz-profil.ts`). */
    steuerung?: KammNetzProfil | undefined;
}>();

const zahlen = computed(() => (props.art === "fluss" ? flussZahlen(props.profil) : undefined));
const pass = computed(() => (props.art === "pass" ? passZahlen(props.profil) : undefined));

/** Breite und Höhe der Zeichnung in ihren eigenen Einheiten; gestreckt auf die Breite des Abschnitts. */
const B = 300;
const netz = computed(() => props.steuerung?.netz() ?? props.netz ?? LEERES_NETZ);

/** Der Fluss mit seinen wirksamen Höhen; ohne Eingabe oder Index keiner. */
const bogenLaengen = computed(() => (props.art === "fluss" ? bogen(props.linie) : []));
const ansicht = computed(() => {
    if (props.art !== "fluss" || props.flussNr === undefined || props.eingabe === undefined) return undefined;
    const fluss = props.eingabe.fluesse[props.flussNr];
    if (fluss === undefined) return undefined;
    const n = netz.value;
    return flussAnsicht(
        fluss,
        { flussHoehen: n.flussHoehen, seeHoehen: n.seeHoehen, seen: props.eingabe.seen, flaeche: props.flaeche },
        // Das Gelände zählt nur in der Fläche: Außerhalb zieht dieses Gebirge nichts nach (und die Karte kennt es dort auch nicht).
        (i) => {
            const q = props.linie[i];
            return q !== undefined && pointInGeometry([q[0], q[1]], props.flaeche)
                ? hoeheAmProfil(props.profil, bogenLaengen.value[i] ?? 0)
                : undefined;
        },
    );
});
/** Läuft der Kammeditor und gehört dieses Profil zu seiner Fläche? Dann hat es Griffe. */
const bearbeiten = computed(() => props.steuerung !== undefined && ansicht.value !== undefined);
const H = computed(() => (bearbeiten.value ? 160 : 80));
const rand = computed(() => profilRand(bearbeiten.value));
const vorwaerts = computed(() => ansicht.value?.vorwaerts ?? zahlen.value?.umgedreht !== true);
const laenge = computed(() => {
    const a = ansicht.value?.gesamt ?? 0;
    return a > 0 ? a : (props.profil.at.at(-1) ?? 0);
});
const xAchse = computed(() => ({ vorwaerts: vorwaerts.value, gesamt: laenge.value }));
const x = (s: number): number => profilX(xAchse.value, s) * B;

/** Die Achse; während eines Zugs bleibt sie, wie sie ist (oben ist Luft zum Hochziehen), damit sich das Bild nicht unter dem Zeiger streckt. */
const achseFest = ref<Achse | undefined>(undefined);
const achse = computed((): Achse => {
    if (achseFest.value !== undefined) return achseFest.value;
    const werte = props.profil.h.filter((h): h is number => h !== null && Number.isFinite(h));
    const a = ansicht.value;
    if (a !== undefined)
        for (const p of a.punkte) {
            if (p.hoehe !== undefined) werte.push(p.hoehe);
            if (p.gelaende !== undefined) werte.push(p.gelaende);
        }
    if (props.art === "pass") werte.push(props.kamm ?? 0);
    return profilAchse(werte, bearbeiten.value);
});
const y = (h: number): number => yVonHoehe(h, achse.value, H.value, rand.value);
const prozentX = (xx: number): string => `${(xx * 100).toFixed(2)}%`;
const prozentY = (yy: number): string => `${((yy / H.value) * 100).toFixed(2)}%`;

const zeichnung = computed(() => {
    const at = props.profil.at;
    const hoehen = props.profil.h.filter((h): h is number => h !== null && Number.isFinite(h));
    if (laenge.value <= 0 || hoehen.length < 2) return undefined;
    const punkte = at
        .map((s, i) => {
            const h = props.profil.h[i];
            return h === null || h === undefined || !Number.isFinite(h)
                ? undefined
                : `${x(s).toFixed(1)},${y(h).toFixed(1)}`;
        })
        .filter((p): p is string => p !== undefined)
        .join(" ");
    // Die Stücke in der Fläche als helle Bänder.
    const lagen = lagenEntlang(props.linie, at);
    const baender: { x: number; w: number }[] = [];
    let anfang: number | undefined;
    at.forEach((s, i) => {
        const drin = pointInGeometry(lagen[i]!, props.flaeche);
        if (drin && anfang === undefined) anfang = s;
        if ((!drin || i === at.length - 1) && anfang !== undefined) {
            const a = x(anfang);
            const b = x(s);
            baender.push({ x: Math.min(a, b), w: Math.max(1, Math.abs(b - a)) });
            anfang = undefined;
        }
    });
    const kammY = props.art === "pass" && props.kamm !== undefined ? y(props.kamm) : undefined;
    return { punkte, baender, kammY, lagen };
});

/** Die Platten der Seen: je See jedes Stück, das der Fluss in ihm läuft; mit eigenem Spiegel flach auf dessen Höhe. */
const platten = computed(() => {
    const z = zeichnung.value;
    if (z === undefined) return [];
    const seen = props.eingabe?.seen ?? (props.seen ?? []).map((g) => ({ g }));
    const spiegel = seeSpiegel(seen, netz.value.seeHoehen);
    return seePlatten(xAchse.value, props.profil, z.lagen, seen, spiegel).map((p) => {
        const x0 = p.x0 * B;
        const x1 = p.x1 * B;
        const oben = y(p.h);
        return {
            ...p,
            x: x0,
            y: oben,
            w: Math.max(1, x1 - x0),
            punkte: p.eigen
                ? `${x0.toFixed(1)},${oben.toFixed(1)} ${x1.toFixed(1)},${oben.toFixed(1)}`
                : p.kurve.map(([px, ph]) => `${(px * B).toFixed(1)},${y(ph).toFixed(1)}`).join(" "),
        };
    });
});

/** Der Verlauf mit den eigenen Höhen (gestrichelt) und die Stücke, auf denen der Fluss steigt (gelb). */
const verlauf = computed(() => {
    const a = ansicht.value;
    if (a === undefined || !a.eigeneHoehen) return undefined;
    const pt = (k: number): string | undefined => {
        const q = a.punkte[k];
        return q?.hoehe === undefined ? undefined : `${x(q.s).toFixed(1)},${y(q.hoehe).toFixed(1)}`;
    };
    const eigen: string[] = [];
    for (let k = a.von; k <= a.bis; k++) {
        const p = pt(k);
        if (p !== undefined) eigen.push(p);
    }
    const steigend: string[] = [];
    a.punkte.forEach((q, j) => {
        if (!q.steigt) return;
        const davor = a.vorwaerts ? j - 1 : j + 1;
        const von = pt(davor);
        const bis = pt(j);
        if (von !== undefined && bis !== undefined) steigend.push(`${von} ${bis}`);
    });
    return { eigen: eigen.join(" "), steigend };
});

/** Die beiden feinen Linien an der höchsten und der tiefsten Stelle, mit ihrer Zahl. */
const achsenlinien = computed(() => {
    const a = ansicht.value;
    if (a === undefined || a.hoechste === undefined || a.tiefste === undefined) return [];
    if (!a.eigeneHoehen && !bearbeiten.value) return [];
    return [a.hoechste, a.tiefste].map((h) => ({ h, y: y(h) }));
});

const schritt = (h: number): string => formatNumber(Math.round(h), 0);
/** Die Zahlen unter dem Bild: mit eigenen Höhen die der wirksamen Höhen, sonst Anfang und Ende des Höhenmodells. */
const flussZeile = computed(() => {
    const a = ansicht.value;
    return a?.eigeneHoehen ? flussHoehenZahlen(a) : zahlen.value;
});
const steigtIrgendwo = computed(() => ansicht.value?.punkte.some((p) => p.steigt) === true);

// --- Griffe ---
interface Ziel {
    readonly schluessel: string;
    readonly punkt: NetzPunkt;
    readonly stelle: NetzStelle;
    readonly eigen: boolean;
    readonly h: number;
    readonly titel: string;
}
interface Griff extends Ziel {
    readonly links: string;
    readonly oben: string;
    readonly ziehbar: boolean;
    readonly gewaehlt: boolean;
    readonly steigt: boolean;
}
const basis = computed(() => wasserBasis(netz.value));
const gewaehlt = computed(() => props.steuerung?.gewaehlt() ?? new Set<string>());
const GRIFF_SCHLUESSEL = (nr: number, index: number): string => `${String(nr)}:${String(index)}`;

const griffe = computed((): Griff[] => {
    const a = ansicht.value;
    if (a === undefined || props.flussNr === undefined) return [];
    const gew = props.steuerung?.gewaesser();
    return profilGriffe(a, (k) => hoeheAmProfil(props.profil, bogenLaengen.value[k] ?? 0)).flatMap((g): Griff[] => {
        // Außerhalb des Modus nur die Punkte mit eigener Höhe, als Zeichen.
        if (!bearbeiten.value && !g.eigen) return [];
        const teil = gew === undefined ? undefined : teilImFluss(gew, props.flussNr!, g.k);
        const t0 = teil === undefined ? undefined : gew!.teile[teil.teil];
        const nr = teil === undefined ? -1 : basis.value + teil.teil;
        const index = teil?.index ?? 0;
        const ziehbar = bearbeiten.value && g.drin && teil !== undefined;
        const punkt: NetzPunkt = { nr, index };
        const titel = !g.drin
            ? t("landschaftseditor.gebirge.profil.punktAussen", { n: String(g.k + 1) })
            : t(
                  g.eigen
                      ? "landschaftseditor.gebirge.profil.punktEigen"
                      : "landschaftseditor.gebirge.profil.punktGelaende",
                  { n: String(g.k + 1), h: schritt(g.h) },
              ) + (g.steigt ? ` · ${t("landschaftseditor.gebirge.profil.steigtVor")}` : "");
        return [
            {
                schluessel: `p${String(g.k)}`,
                punkt,
                stelle: t0 !== undefined && t0.punkte.length > 1 ? { nr, index } : { nr },
                eigen: g.eigen,
                h: g.h,
                titel,
                links: prozentX(g.x),
                oben: prozentY(y(g.h)),
                ziehbar,
                gewaehlt: ziehbar && gewaehlt.value.has(GRIFF_SCHLUESSEL(nr, index)),
                steigt: g.steigt,
            },
        ];
    });
});

/** Die Griffe an den Platten der Seen: ziehen hebt oder senkt die ganze Platte. */
const seeGriffe = computed((): Griff[] => {
    const gew = props.steuerung?.gewaesser();
    if (!bearbeiten.value || gew === undefined) return [];
    return platten.value.flatMap((p, i): Griff[] => {
        const teil = p.see < 0 ? undefined : teilImSee(gew, p.see);
        if (teil === undefined) return [];
        const nr = basis.value + teil;
        const name = gew.teile[teil]!.name;
        return [
            {
                schluessel: `s${String(i)}`,
                punkt: { nr, index: 0 },
                stelle: { nr },
                eigen: p.eigen,
                h: p.h,
                titel: t(
                    p.eigen
                        ? "landschaftseditor.gebirge.profil.seeEigen"
                        : "landschaftseditor.gebirge.profil.seeGelaende",
                    { name, h: schritt(p.h) },
                ),
                links: prozentX((p.x0 + p.x1) / 2),
                oben: prozentY(p.y),
                ziehbar: true,
                gewaehlt: gewaehlt.value.has(GRIFF_SCHLUESSEL(nr, 0)),
                steigt: false,
            },
        ];
    });
});

// --- Ziehen, Doppelklick, Tasten ---
const plot = ref<HTMLElement | null>(null);
interface Zug {
    readonly griff: Griff;
    readonly pointerId: number;
    readonly startY: number;
    readonly achse: Achse;
    bewegt: boolean;
}
let zug: Zug | undefined;
/** Der letzte Zug hat bewegt: Der Klick danach gilt nicht als Hälfte eines Doppelklicks. */
let gezogen = false;
const blase = ref<{ links: string; oben: string; text: string } | undefined>(undefined);

function beginne(ereignis: PointerEvent, griff: Griff): void {
    if (!griff.ziehbar || props.steuerung === undefined) return;
    if (ereignis.pointerType === "mouse" && ereignis.button !== 0) return;
    ereignis.preventDefault();
    props.steuerung.waehle(griff.stelle, ereignis.shiftKey);
    zug = { griff, pointerId: ereignis.pointerId, startY: ereignis.clientY, achse: achse.value, bewegt: false };
    gezogen = false;
    try {
        (ereignis.currentTarget as HTMLElement).setPointerCapture(ereignis.pointerId);
    } catch {
        // Ohne Aufnahme geht es auch.
    }
}
function bewege(ereignis: PointerEvent, griff: Griff): void {
    const z = zug;
    const st = props.steuerung;
    if (
        z === undefined ||
        st === undefined ||
        z.griff.schluessel !== griff.schluessel ||
        z.pointerId !== ereignis.pointerId
    )
        return;
    // Esc hat den Zug abgebrochen (der Kammeditor hat ihn zurückgestellt): Die Geste ist vorbei.
    if (z.bewegt && !st.zugLaeuft()) {
        ende();
        return;
    }
    if (!z.bewegt && Math.abs(ereignis.clientY - z.startY) < 4) return;
    if (!z.bewegt) achseFest.value = z.achse;
    z.bewegt = true;
    const rahmen = plot.value?.getBoundingClientRect();
    if (rahmen === undefined || rahmen.height <= 0) return;
    const yy = ((ereignis.clientY - rahmen.top) / rahmen.height) * H.value;
    const h = gezogeneHoehe(hoeheVonY(yy, z.achse, H.value, rand.value), z.achse);
    st.ziehe(griff.punkt, h);
    // Die Blase über dem Griff (unter ihm, wenn oben kein Platz ist) nennt den Wert.
    const ty = yVonHoehe(h, z.achse, H.value, rand.value);
    blase.value = {
        links: prozentX(Math.min(0.9, Math.max(0.1, parseFloat(griff.links) / 100))),
        oben: prozentY(ty < 36 ? ty + 24 : ty - 24),
        text: t("landschaftseditor.gebirge.profil.blase", { h: schritt(h) }),
    };
}
function ende(ereignis?: PointerEvent): void {
    const z = zug;
    if (z === undefined || (ereignis !== undefined && z.pointerId !== ereignis.pointerId)) return;
    zug = undefined;
    achseFest.value = undefined;
    blase.value = undefined;
    if (z.bewegt) {
        gezogen = true;
        if (props.steuerung?.zugLaeuft() === true) props.steuerung.zugEnde();
    }
}
function abbruch(ereignis: PointerEvent): void {
    const z = zug;
    if (z === undefined || z.pointerId !== ereignis.pointerId) return;
    zug = undefined;
    achseFest.value = undefined;
    blase.value = undefined;
    if (z.bewegt && props.steuerung?.zugLaeuft() === true) props.steuerung.zugAb();
}
/** Doppelklick über `detail`: Der erste Klick wählt und zeichnet neu, ein `dblclick` käme am neuen Element nicht mehr an. */
function klick(ereignis: MouseEvent, griff: Griff): void {
    if (gezogen) {
        gezogen = false;
        return;
    }
    if (ereignis.detail >= 2 && griff.ziehbar && griff.eigen) props.steuerung?.entferne(griff.punkt);
}
function taste(ereignis: KeyboardEvent, griff: Griff): void {
    const st = props.steuerung;
    if (st === undefined || !griff.ziehbar) return;
    if (ereignis.key === "ArrowUp" || ereignis.key === "ArrowDown") {
        ereignis.preventDefault();
        const richtung = ereignis.key === "ArrowUp" ? 1 : -1;
        // Pfeil hoch und runter: ein Schritt von 10 (mit Umschalt 100), nur an die Grenzen einer Punkthöhe gebunden.
        st.setzeHoehe(
            griff.punkt,
            gezogeneHoehe(griff.h + richtung * PROFIL_SCHRITT * (ereignis.shiftKey ? 10 : 1), {
                lo: Number.NEGATIVE_INFINITY,
                hi: Number.POSITIVE_INFINITY,
            }),
        );
    } else if (ereignis.key === "Delete" || ereignis.key === "Backspace") {
        ereignis.preventDefault();
        if (griff.eigen) st.entferne(griff.punkt);
    } else if (ereignis.key === "Enter" || ereignis.key === " ") {
        ereignis.preventDefault();
        st.waehle(griff.stelle, ereignis.shiftKey);
    }
}
</script>

<template>
    <figure v-if="zeichnung" class="profil" :data-testid="`gebirge-profil-${art}`">
        <div ref="plot" class="profil__plot" :class="{ 'profil__plot--hoch': bearbeiten }">
            <svg class="profil__bild" :viewBox="`0 0 ${B} ${H}`" preserveAspectRatio="none" aria-hidden="true">
                <rect
                    v-for="(band, i) in zeichnung.baender"
                    :key="i"
                    class="profil__drin"
                    :x="band.x"
                    y="0"
                    :width="band.w"
                    :height="H"
                />
                <line
                    v-if="zeichnung.kammY !== undefined"
                    class="profil__kamm"
                    x1="0"
                    :x2="B"
                    :y1="zeichnung.kammY"
                    :y2="zeichnung.kammY"
                />
                <line
                    v-for="(marke, i) in achsenlinien"
                    :key="`achse${i}`"
                    class="profil__achsenlinie"
                    x1="0"
                    :x2="B"
                    :y1="marke.y"
                    :y2="marke.y"
                />
                <rect
                    v-for="(platte, i) in platten"
                    :key="`see${i}`"
                    class="profil__see"
                    :x="platte.x"
                    :y="platte.y"
                    :width="platte.w"
                    :height="H - platte.y"
                />
                <polyline class="profil__linie" :class="`profil__linie--${art}`" :points="zeichnung.punkte" />
                <polyline
                    v-for="(platte, i) in platten"
                    :key="`seelinie${i}`"
                    class="profil__seelinie"
                    :points="platte.punkte"
                />
                <template v-if="verlauf">
                    <polyline class="profil__eigen" :points="verlauf.eigen" data-testid="gebirge-profil-verlauf" />
                    <template v-for="(stueck, i) in verlauf.steigend" :key="`steigt${i}`">
                        <polyline class="profil__steigt-unter" :points="stueck" />
                        <polyline class="profil__steigt" :points="stueck" data-testid="gebirge-profil-steigt" />
                    </template>
                </template>
            </svg>
            <span
                v-for="(marke, i) in achsenlinien"
                :key="`zahl${i}`"
                class="profil__achse"
                :style="{ top: prozentY(marke.y) }"
                :class="{ 'profil__achse--unten': i === 1 }"
                data-testid="gebirge-profil-achse"
                >{{ schritt(marke.h) }}</span
            >
            <template v-if="griffe.length > 0 || seeGriffe.length > 0">
                <span
                    v-for="g in griffe"
                    :key="g.schluessel"
                    class="profil__griff"
                    :class="{
                        'profil__griff--eigen': g.eigen,
                        'profil__griff--gewaehlt': g.gewaehlt,
                        'profil__griff--aussen': bearbeiten && !g.ziehbar,
                        'profil__griff--zeichen': !bearbeiten,
                        'profil__griff--steigt': g.steigt,
                    }"
                    :style="{ left: g.links, top: g.oben }"
                    :role="g.ziehbar ? 'slider' : undefined"
                    :tabindex="g.ziehbar ? 0 : undefined"
                    :aria-label="bearbeiten ? g.titel : undefined"
                    :aria-valuenow="g.ziehbar ? Math.round(g.h) : undefined"
                    :aria-disabled="bearbeiten && !g.ziehbar ? 'true' : undefined"
                    :aria-hidden="bearbeiten ? undefined : 'true'"
                    :title="g.titel"
                    data-testid="gebirge-profil-griff"
                    :data-eigen="g.eigen"
                    :data-gewaehlt="g.gewaehlt"
                    :data-ziehbar="g.ziehbar"
                    :data-steigt="g.steigt"
                    :data-hoehe="Math.round(g.h)"
                    @pointerdown="beginne($event, g)"
                    @pointermove="bewege($event, g)"
                    @pointerup="ende($event)"
                    @pointercancel="abbruch($event)"
                    @click="klick($event, g)"
                    @keydown="taste($event, g)"
                    @blur="steuerung?.abschluss()"
                />
                <span
                    v-for="g in seeGriffe"
                    :key="g.schluessel"
                    class="profil__seegriff"
                    :class="{ 'profil__seegriff--gewaehlt': g.gewaehlt, 'profil__seegriff--eigen': g.eigen }"
                    :style="{ left: g.links, top: g.oben }"
                    role="slider"
                    tabindex="0"
                    :aria-label="g.titel"
                    :aria-valuenow="Math.round(g.h)"
                    :title="g.titel"
                    data-testid="gebirge-profil-seegriff"
                    :data-eigen="g.eigen"
                    :data-hoehe="Math.round(g.h)"
                    @pointerdown="beginne($event, g)"
                    @pointermove="bewege($event, g)"
                    @pointerup="ende($event)"
                    @pointercancel="abbruch($event)"
                    @click="klick($event, g)"
                    @keydown="taste($event, g)"
                    @blur="steuerung?.abschluss()"
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" />
                    </svg>
                </span>
            </template>
            <span
                v-if="blase"
                class="profil__blase"
                :style="{ left: blase.links, top: blase.oben }"
                data-testid="gebirge-profil-blase"
                >{{ blase.text }}</span
            >
        </div>
        <figcaption class="profil__satz">
            <span class="profil__legende">
                <span class="profil__marke" aria-hidden="true" />
                {{ t("landschaftseditor.gebirge.profil.drin", { name: name ?? "" }) }}
                <template v-if="platten.length > 0">
                    <span class="profil__marke profil__marke--see" aria-hidden="true" />
                    {{ t("landschaftseditor.gebirge.gewaesser.see") }}
                </template>
                <template v-if="art === 'fluss'"> · {{ t("landschaftseditor.gebirge.profil.richtung") }}</template>
                <template v-else-if="kamm !== undefined">
                    · {{ t("landschaftseditor.gebirge.profil.kamm", { k: schritt(kamm) }) }}</template
                >
                <template v-if="verlauf">
                    <span class="profil__marke profil__marke--eigen" aria-hidden="true" />
                    {{ t("landschaftseditor.gebirge.profil.legendeEigen") }}
                    <template v-if="steigtIrgendwo">
                        <span class="profil__marke profil__marke--steigt" aria-hidden="true" />
                        {{ t("landschaftseditor.gebirge.profil.legendeSteigt") }}
                    </template>
                </template>
            </span>
            <span v-if="flussZeile" data-testid="gebirge-profil-zahlen">
                {{
                    t("landschaftseditor.gebirge.profil.fluss", {
                        q: schritt(flussZeile.quelle),
                        m: schritt(flussZeile.muendung),
                        g: schritt(flussZeile.gefaelle),
                    })
                }}
            </span>
            <span v-if="pass" data-testid="gebirge-profil-zahlen">
                {{
                    t("landschaftseditor.gebirge.profil.pass", {
                        h: schritt(pass.hoechster),
                        s: formatNumber(pass.steigung, 1),
                        a: schritt(pass.anstieg),
                        b: schritt(pass.abstieg),
                    })
                }}
            </span>
            <span v-if="bearbeiten" class="profil__hinweis" data-testid="gebirge-profil-hinweis">
                {{ t("landschaftseditor.gebirge.profil.hinweisGriffe") }}
            </span>
            <em class="profil__quelle">{{ t("landschaftseditor.gebirge.profil.quelle") }}</em>
        </figcaption>
    </figure>
</template>

<style scoped>
.profil {
    display: grid;
    gap: var(--space-2);
    margin: 0;
}

/* Der Rahmen der Zeichnung; die Griffe, die Zahlen an den Linien und die Blase liegen als Elemente darüber (rund, nicht gestreckt). */
.profil__plot {
    position: relative;
    height: 5rem;
}

.profil__plot--hoch {
    height: 10rem;
}

.profil__bild {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.profil__drin {
    fill: var(--color-border);
    opacity: 0.6;
}

.profil__kamm {
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
}

.profil__linie {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.profil__linie--fluss {
    stroke: var(--color-profile-river);
    stroke-width: 2;
}

/* Der See als Platte unter der Kurve: kräftiger als das Stück in der Fläche, die Kurve darüber in der Farbe des tiefen Wassers. */
.profil__see {
    fill: var(--color-profile-river);
    opacity: 0.45;
}

.profil__seelinie {
    fill: none;
    stroke: var(--color-profile-sea);
    stroke-width: 3;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
}

.profil__linie--pass {
    stroke: var(--color-text-strong);
}

/* Der Verlauf mit eigenen Höhen: gestrichelt; wo der Fluss steigt, gelb auf einem Warnsaum (WI-0259). */
.profil__eigen {
    fill: none;
    stroke: var(--color-text-strong);
    stroke-width: 2;
    stroke-dasharray: 5 4;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.profil__steigt-unter {
    fill: none;
    stroke: var(--color-warning);
    stroke-width: 6;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
}

.profil__steigt {
    fill: none;
    stroke: var(--color-map-selection);
    stroke-width: 3.4;
    stroke-linecap: round;
    stroke-dasharray: 5 4;
    vector-effect: non-scaling-stroke;
}

.profil__achsenlinie {
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 1 3;
    opacity: 0.55;
    vector-effect: non-scaling-stroke;
}

.profil__achse {
    position: absolute;
    left: var(--space-2);
    transform: translateY(-115%);
    color: var(--color-text-muted);
    font-size: 10.5px;
    line-height: 1;
    opacity: 0.85;
    pointer-events: none;
}

.profil__achse--unten {
    transform: translateY(25%);
}

/*
 * Die Griffe (WI-0259), §30.5: Ruhe hohl (Fläche, Rand in der Farbe der Flüsse), eigene Höhe gefüllt; Hover Rand in Braun; gewählt gelber Ring;
 * Fokus der Ring der Seite; gesperrt (außerhalb der Fläche) grau mit `not-allowed`; Übergang 120 ms. Die Trefferfläche ist größer als der Punkt.
 */
.profil__griff,
.profil__seegriff {
    position: absolute;
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    margin: -0.875rem 0 0 -0.875rem;
    place-items: center;
    border-radius: 50%;
    cursor: ns-resize;
    outline: none;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
}

.profil__griff::before {
    box-sizing: border-box;
    width: 0.9rem;
    height: 0.9rem;
    border: 2.5px solid var(--color-profile-river);
    border-radius: 50%;
    background: var(--color-panel);
    content: "";
    transition:
        border-color 120ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.profil__griff--eigen::before {
    border-color: var(--color-panel);
    border-width: 2.2px;
    background: var(--color-profile-sea);
}

.profil__griff:hover::before {
    border-color: var(--color-accent-brown);
}

.profil__griff--eigen:hover::before {
    border-color: var(--color-panel);
    box-shadow: 0 0 0 3px var(--color-hover-wash);
}

.profil__griff:active {
    cursor: grabbing;
}

.profil__griff:active::before {
    box-shadow: 0 0 0 3px var(--color-active-wash);
}

.profil__griff--gewaehlt::before {
    box-shadow:
        0 0 0 3px var(--color-map-selection),
        0 0 0 4.5px var(--color-panel);
}

.profil__griff:focus-visible::before,
.profil__seegriff:focus-visible {
    box-shadow: var(--focus-ring);
}

/* Das „!“ der Karte als kleine Marke am Griff, damit es auch ohne die Gelbfärbung des Stücks gelesen wird. */
.profil__griff--steigt::after {
    position: absolute;
    top: -0.15rem;
    right: -0.15rem;
    display: grid;
    width: 0.8rem;
    height: 0.8rem;
    border: 1px solid var(--color-warning-soft-border);
    border-radius: 50%;
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    content: "!";
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 1;
    place-items: center;
    pointer-events: none;
}

.profil__griff--aussen {
    cursor: not-allowed;
}

.profil__griff--aussen::before {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
}

/* Außerhalb des Modus ist ein Punkt mit eigener Höhe nur ein Zeichen: kleiner, ohne Zeiger. */
.profil__griff--zeichen {
    width: 1rem;
    height: 1rem;
    margin: -0.5rem 0 0 -0.5rem;
    cursor: default;
    pointer-events: none;
}

.profil__griff--zeichen::before {
    width: 0.65rem;
    height: 0.65rem;
}

/* Der Griff an der Platte eines Sees: ein Knopf mit ↕ an der Oberkante in der Mitte. */
.profil__seegriff {
    border: 2px solid var(--color-profile-sea);
    background: var(--color-panel);
    color: var(--color-profile-sea);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.profil__seegriff svg {
    width: 0.95rem;
    height: 0.95rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
}

.profil__seegriff:hover {
    border-color: var(--color-accent-brown);
}

.profil__seegriff:active {
    cursor: grabbing;
    box-shadow: 0 0 0 3px var(--color-active-wash);
}

.profil__seegriff--gewaehlt {
    box-shadow:
        0 0 0 3px var(--color-map-selection),
        0 0 0 4.5px var(--color-panel);
}

.profil__seegriff--gewaehlt:focus-visible {
    box-shadow:
        0 0 0 3px var(--color-map-selection),
        0 0 0 4.5px var(--color-panel),
        var(--focus-ring);
}

/* Die Blase beim Ziehen: der Wert in Schritt über dem Griff. */
.profil__blase {
    position: absolute;
    padding: 2px var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-text-strong);
    color: var(--color-panel);
    font-size: var(--font-size-small);
    line-height: 1.3;
    opacity: 0.92;
    pointer-events: none;
    transform: translate(-50%, -50%);
    white-space: nowrap;
}

.profil__satz {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.profil__legende {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
}

.profil__marke {
    display: inline-block;
    width: 0.9em;
    height: 0.6em;
    background: var(--color-border);
}

.profil__marke--see {
    border-top: 2px solid var(--color-profile-sea);
    background: color-mix(in srgb, var(--color-profile-river) 45%, transparent);
}

.profil__marke--eigen {
    height: 0;
    border-top: 2px dashed var(--color-text-strong);
    background: none;
}

.profil__marke--steigt {
    height: 0;
    border-top: 3px solid var(--color-map-selection);
    background: none;
}

.profil__hinweis {
    color: var(--color-text-muted);
}

.profil__quelle {
    font-style: italic;
}

@media (prefers-reduced-motion: reduce) {
    .profil__griff::before,
    .profil__seegriff {
        transition: none;
    }
}
</style>
