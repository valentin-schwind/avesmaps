<script setup lang="ts">
import type { Map as MapLibreMap } from "maplibre-gl";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import AvmBildansicht from "../controls/avm-bildansicht.vue";
import type { AnsichtBild } from "../controls/avm-bildansicht-modell";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { showAktionToast, showToast } from "../feedback/toast";
import { locale, t } from "../i18n/i18n";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { maleRahmen } from "../map/gradnetz-rahmen";
import { kartenserie } from "../map/kartenserien-stand";
import {
    alsPng,
    dateiname,
    dichte,
    feldGrenzen,
    feldMasse,
    formatName,
    inZwischenablage,
    kartenbild,
    legeFeld,
    naechstesRechteck,
    QUADRAT,
    RECHTECK_VORGABE,
    RECHTECKE,
    schneide,
    speichern,
    type Kasten,
} from "./kartenbild";
import { ladeNennungsLogo, maleNennung, nennungText } from "./nennung";

/**
 * „Screenshot machen“ aus dem Kartenmenü (WI-0274; Entwurf Fassung 5 https://claude.ai/artifact/U9ERwXoYntSb7qveKCAK4A, Vali
 * 2026-11-01 „perfekt“, „Ja, bauen“).
 *
 * - **Die Auswahl** steht mittig auf dem Schirm (Vali: „tu das screenshot menü in die mitte vom bildschirm“): drei Kacheln, darunter
 *   „Rahmen“ und „Raster: Aus · Hex · Grid“. Hex ist das Hexraster der Karte, Grid das Gradnetz (Vali 2026-11-01: an Gradnetz und
 *   Hexraster andocken, kein zweites Raster). Die Wahl schaltet die Karte sofort um und gilt nur für die Aufnahme; danach kehrt die
 *   Anzeige zurück. Vorbelegt mit dem, was eingeschaltet ist.
 * - **Die Aufnahme** greift die Karte beim Start einmal ab (`kartenbild`) und zeigt dieses Standbild über allem: Die Bedienfelder
 *   verschwinden, die Karte steht still, und was man sieht, ist das Bild. Die Deckschicht nimmt alle Zeiger, das Mausrad und den
 *   Rechtsklick; die Karte darunter bekommt nichts, deshalb meldet sie sich nicht beim Koordinator der Karte an.
 * - **Das Feld** folgt der Maus, ein Klick nimmt auf; es ist so groß, wie es passt (`feldMasse`). Beim Rechteck wechselt das Mausrad
 *   das Seitenverhältnis (je Raste ein Schritt, ein Touchpad sammelt), Umschalt + Mausrad die Größe; beim Quadrat das Mausrad die
 *   Größe. Am Finger: ziehen oder hintippen, die Knöpfe der Leiste. Esc bricht ab (Stufe `action`, die Auswahl in `menus`).
 * - **Der Rahmen** ist der des Gradnetzes (`maleRahmen`), in den Rand des Felds gezeichnet: Das Bild hat genau das Format.
 * - **Die Nennung** (Fanprojekt-Logo, Nennung der Kartenserie, Adresse der Fan-Richtlinie) steht in jedem Bild (`nennung.ts`); die
 *   Vorschau zeigt sie schon.
 * - **Danach** liegt das PNG in der Zwischenablage (im Klick angestoßen, sonst gilt die Geste nicht mehr), und der Toast zeigt es
 *   mit „Ansehen“ (die Bildansicht) und „Speichern unter …“.
 */

export type ScreenshotRaster = "aus" | "hex" | "grid";

const props = defineProps<{
    karte: () => MapLibreMap | undefined;
    /** Die gezeigte Kartenserie: Ihre Nennung steht im Bild. */
    serie: () => string;
    /** Das Raster der Karte, gelesen und gesetzt über die Schalter Hexraster und Gradnetz des Auge-Menüs. */
    anzeige: { lies: () => ScreenshotRaster; setze: (raster: ScreenshotRaster) => void };
}>();

type Form = "quadrat" | "rechteck" | "ganz";
const phase = ref<"zu" | "wahl" | "laden" | "aufnahme">("zu");
const rahmen = ref(false);
const raster = ref<ScreenshotRaster>("aus");
let rasterVorher: ScreenshotRaster = "aus";
const form = ref<Form>("quadrat");
/** Das zuletzt gewählte Rechteck bleibt für den nächsten Screenshot. */
const rechteckStelle = ref(RECHTECK_VORGABE);
const format = computed(() => (form.value === "rechteck" ? (RECHTECKE[rechteckStelle.value] ?? QUADRAT) : QUADRAT));

const KACHELN: readonly { form: Form; label: "screenshot.quadrat" | "screenshot.rechteck" | "screenshot.ganz" }[] = [
    { form: "quadrat", label: "screenshot.quadrat" },
    { form: "rechteck", label: "screenshot.rechteck" },
    { form: "ganz", label: "screenshot.ganz" },
];
const rasterWahl = computed(() => [
    { value: "aus", label: t("screenshot.raster.aus") },
    { value: "hex", label: t("screenshot.raster.hex"), hinweis: t("screenshot.raster.hexHinweis") },
    { value: "grid", label: t("screenshot.raster.grid"), hinweis: t("screenshot.raster.gridHinweis") },
]);
const rasterModell = computed({
    get: () => raster.value,
    set: (wert: string) => {
        if (wert === "aus" || wert === "hex" || wert === "grid") raster.value = wert;
    },
});

const wahlEl = useTemplateRef<HTMLDivElement>("wahlEl");
const standbildEl = useTemplateRef<HTMLDivElement>("standbildEl");
const rahmenEl = useTemplateRef<HTMLCanvasElement>("rahmenEl");

/** Das Standbild der Karte, wo sie auf dem Schirm liegt und wie viele Bildpunkte auf ein CSS-Pixel kommen. */
let standbild: HTMLCanvasElement | undefined;
const behaelter = shallowRef<Kasten>({ x: 0, y: 0, w: 0, h: 0 });
let faktor = 1;
/** Das Feld in Bildschirmkoordinaten. */
const feld = shallowRef<Kasten>({ x: 0, y: 0, w: 0, h: 0 });
const finger = ref(false);
const grob = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : undefined;

function oeffne(): void {
    if (phase.value !== "zu") return;
    rasterVorher = props.anzeige.lies();
    raster.value = rasterVorher;
    rahmen.value = rasterVorher === "grid";
    phase.value = "wahl";
    void nextTick(() => wahlEl.value?.querySelector<HTMLButtonElement>(".kachel")?.focus({ preventScroll: true }));
}
defineExpose({ oeffne });

// Die Wahl zeigt sich sofort auf der Karte.
watch(raster, (wert) => {
    if (phase.value !== "zu") props.anzeige.setze(wert);
});

/** Zu, und die Anzeige der Karte wieder wie vorher. */
function schliesse(): void {
    phase.value = "zu";
    standbild = undefined;
    zug = null;
    if (props.anzeige.lies() !== rasterVorher) props.anzeige.setze(rasterVorher);
}

function grenzen(): Kasten {
    const b = behaelter.value;
    const g = feldGrenzen(b.w, b.h);
    return { ...g, x: g.x + b.x, y: g.y + b.y };
}
const mitte = (k: Kasten): { x: number; y: number } => ({ x: k.x + k.w / 2, y: k.y + k.h / 2 });

/** Das Feld um `um`, im aktuellen Format, höchstens `bisBreite` breit (ohne: so groß, wie es passt). */
function setzeFeld(um: { x: number; y: number }, bisBreite?: number): void {
    const g = grenzen();
    feld.value = legeFeld(um, feldMasse(format.value.r, g, bisBreite), g);
    zeichneRahmen();
}

async function starte(gewaehlt: Form): Promise<void> {
    const map = props.karte();
    if (!map) {
        schliesse();
        return;
    }
    form.value = gewaehlt;
    finger.value = grob?.matches === true;
    phase.value = "laden";
    let bild: HTMLCanvasElement;
    try {
        [bild, logo] = await Promise.all([kartenbild(map), ladeNennungsLogo()]);
    } catch {
        showToast(t("screenshot.fehler"), "warning");
        schliesse();
        return;
    }
    // Inzwischen abgebrochen (Esc)?
    if (phase.value !== "laden") return;
    standbild = bild;
    const r = map.getContainer().getBoundingClientRect();
    behaelter.value = { x: r.left, y: r.top, w: r.width, h: r.height };
    faktor = dichte(map);
    phase.value = "aufnahme";
    await nextTick();
    Object.assign(bild.style, { display: "block", width: "100%", height: "100%" });
    standbildEl.value?.replaceChildren(bild);
    if (gewaehlt === "ganz") {
        feld.value = { ...behaelter.value };
        zeichneRahmen();
    } else {
        setzeFeld(mitte(grenzen()));
    }
}

/** Die Himmelsrichtungen der Grade im Rahmen, wie auf der Karte. */
const richtung = (): { nord: string; sued: string; ost: string; west: string } => ({
    nord: t("gradnetz.nord"),
    sued: t("gradnetz.sued"),
    ost: t("gradnetz.ost"),
    west: t("gradnetz.west"),
});
/** Das Feld in Koordinaten des Kartenbehälters: Darin rechnen Leinwand und Rahmen. */
function imBehaelter(): Kasten {
    const b = behaelter.value;
    const f = feld.value;
    return { x: f.x - b.x, y: f.y - b.y, w: f.w, h: f.h };
}
const alsRand = (k: Kasten): { links: number; oben: number; rechts: number; unten: number } => ({
    links: k.x,
    oben: k.y,
    rechts: k.x + k.w,
    unten: k.y + k.h,
});

let rahmenGeplant = 0;
/** Die Nennung der gezeigten Kartenserie samt Adresse der Fan-Richtlinie. */
const nennung = (): string => nennungText(kartenserie(props.serie()), locale.value === "de");
/** Das Fanprojekt-Logo: vor der Aufnahme geladen, damit Vorschau und Bild es sofort tragen. */
let logo: HTMLImageElement | undefined;

/** Rahmen und Nennung als Vorschau im Feld, höchstens einmal je Bild. */
function zeichneRahmen(): void {
    if (rahmenGeplant !== 0) return;
    rahmenGeplant = requestAnimationFrame(() => {
        rahmenGeplant = 0;
        const leinwand = rahmenEl.value;
        const map = props.karte();
        const ctx = leinwand?.getContext("2d");
        if (!leinwand || !map || !ctx) return;
        const b = behaelter.value;
        const dpr = window.devicePixelRatio || 1;
        if (leinwand.width !== Math.round(b.w * dpr) || leinwand.height !== Math.round(b.h * dpr)) {
            leinwand.width = Math.round(b.w * dpr);
            leinwand.height = Math.round(b.h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, b.w, b.h);
        const rand = alsRand(imBehaelter());
        if (rahmen.value) maleRahmen(ctx, map, rand, richtung());
        maleNennung(ctx, rand, nennung(), rahmen.value, logo);
    });
}

// --- Zeiger, Mausrad, Tasten

let zug: { id: number; x0: number; y0: number; um: { x: number; y: number }; bewegt: boolean } | null = null;
const beimFeld = (): boolean => phase.value === "aufnahme" && form.value !== "ganz";

function druck(ereignis: PointerEvent): void {
    finger.value = ereignis.pointerType !== "mouse" || grob?.matches === true;
    if (!beimFeld() || !finger.value) return;
    zug = { id: ereignis.pointerId, x0: ereignis.clientX, y0: ereignis.clientY, um: mitte(feld.value), bewegt: false };
    (ereignis.currentTarget as HTMLElement).setPointerCapture(ereignis.pointerId);
}
function zeige(ereignis: PointerEvent): void {
    if (!beimFeld()) return;
    if (zug && ereignis.pointerId === zug.id) {
        const dx = ereignis.clientX - zug.x0;
        const dy = ereignis.clientY - zug.y0;
        if (Math.hypot(dx, dy) > 6) zug.bewegt = true;
        if (zug.bewegt) setzeFeld({ x: zug.um.x + dx, y: zug.um.y + dy }, feld.value.w);
        return;
    }
    if (ereignis.pointerType === "mouse" && !finger.value)
        setzeFeld({ x: ereignis.clientX, y: ereignis.clientY }, feld.value.w);
}
function los(ereignis: PointerEvent): void {
    // Tippen ohne Ziehen setzt das Feld dorthin.
    if (zug && ereignis.pointerId === zug.id && !zug.bewegt)
        setzeFeld({ x: ereignis.clientX, y: ereignis.clientY }, feld.value.w);
    zug = null;
}
function klick(): void {
    if (phase.value !== "aufnahme") return;
    if (form.value === "ganz" || !finger.value) aufnehmen();
}

function groesse(faktorWert: number): void {
    if (beimFeld()) setzeFeld(mitte(feld.value), feld.value.w * faktorWert);
}
function wechsleFormat(schritt: 1 | -1, rundum = false): void {
    if (!beimFeld() || form.value !== "rechteck") return;
    const neu = naechstesRechteck(rechteckStelle.value, schritt, rundum);
    if (neu === rechteckStelle.value) return;
    rechteckStelle.value = neu;
    // So groß, wie es passt: nie aus der vorigen Größe (Vali 2026-11-01: „das rechteck wird immer kleiner“).
    setzeFeld(mitte(feld.value));
}
let radSumme = 0;
let radZeit = 0;
function rad(ereignis: WheelEvent): void {
    if (!beimFeld()) return;
    // Umschalt + Mausrad meldet Windows als waagerechtes Rollen.
    const d = ereignis.deltaY || ereignis.deltaX;
    if (d === 0) return;
    if (form.value !== "rechteck" || ereignis.shiftKey) {
        groesse(d < 0 ? 1.08 : 1 / 1.08);
        return;
    }
    // Ein Touchpad liefert viele kleine Schritte: sammeln, damit eine Raste genau ein Format weiter springt.
    if (ereignis.timeStamp - radZeit > 250) radSumme = 0;
    radZeit = ereignis.timeStamp;
    radSumme += d;
    if (Math.abs(radSumme) < 50) return;
    wechsleFormat(radSumme < 0 ? -1 : 1);
    radSumme = 0;
}
function taste(ereignis: KeyboardEvent): void {
    if (phase.value !== "aufnahme") return;
    // Enter auf einem Knopf der Leiste gehört dem Knopf.
    if (ereignis.key === "Enter" && (ereignis.target as Element | null)?.closest?.("button")) return;
    if (ereignis.key === "Enter") aufnehmen();
    else if (ereignis.key === "+" || ereignis.key === "-") groesse(ereignis.key === "+" ? 1.08 : 1 / 1.08);
    else if (ereignis.key === "ArrowUp" || ereignis.key === "ArrowDown")
        wechsleFormat(ereignis.key === "ArrowUp" ? -1 : 1);
    else return;
    ereignis.preventDefault();
}

// --- Aufnehmen und danach

const blitz = shallowRef<Kasten | undefined>();
const ansicht = ref<number | null>(null);
const ansichtBilder = shallowRef<AnsichtBild[]>([]);
let ergebnisUrl: string | undefined;

function aufnehmen(): void {
    const map = props.karte();
    const bild = standbild;
    if (phase.value !== "aufnahme" || !map || !bild) return;
    const kasten = imBehaelter();
    const mitRahmen = rahmen.value;
    const richt = richtung();
    const text = nennung();
    const leinwand = schneide(bild, kasten, faktor, (ctx) => {
        if (mitRahmen) maleRahmen(ctx, map, alsRand(kasten), richt);
        maleNennung(ctx, alsRand(kasten), text, mitRahmen, logo);
    });
    const png = alsPng(leinwand);
    const ablage = inZwischenablage(png);
    blitz.value = { ...feld.value };
    setTimeout(() => (blitz.value = undefined), 350);
    const name = dateiname();
    const masse = { breite: leinwand.width, hoehe: leinwand.height };
    schliesse();
    png.then(
        async (blob) => {
            const kopiert = await ablage.then(
                () => true,
                () => false,
            );
            zeigeErgebnis(blob, name, masse, kopiert);
        },
        () => showToast(t("screenshot.fehler"), "warning"),
    );
}

function zeigeErgebnis(blob: Blob, name: string, masse: { breite: number; hoehe: number }, kopiert: boolean): void {
    if (ergebnisUrl) URL.revokeObjectURL(ergebnisUrl);
    ergebnisUrl = URL.createObjectURL(blob);
    ansichtBilder.value = [{ url: ergebnisUrl, breite: masse.breite, hoehe: masse.hoehe, titel: name }];
    showAktionToast(
        kopiert ? t("screenshot.kopiert", masse) : t("screenshot.nichtKopiert", masse),
        {
            bild: { url: ergebnisUrl, alt: t("screenshot.vorschau") },
            aktionen: [
                { text: t("screenshot.ansehen"), tun: () => (ansicht.value = 0) },
                { text: t("screenshot.speichern"), haupt: true, tun: () => void sichere(blob, name) },
            ],
        },
        kopiert ? "success" : "warning",
    );
}

async function sichere(blob: Blob, name: string): Promise<void> {
    const ergebnis = await speichern(blob, name, t("screenshot.png"));
    if (ergebnis.wie === "dialog") showToast(t("screenshot.gespeichert", { name: ergebnis.name }), "success");
    else if (ergebnis.wie === "download") showToast(t("screenshot.heruntergeladen"), "success");
}

// --- Was die Leiste und das Maß sagen

const masz = computed(() => {
    const breite = Math.round(feld.value.w * faktor);
    const hoehe = Math.round(feld.value.h * faktor);
    return form.value === "ganz"
        ? t("screenshot.maszGanz", { breite, hoehe })
        : t("screenshot.masz", { format: formatName(format.value, t), breite, hoehe });
});
const maszLage = computed(() => {
    const f = feld.value;
    const b = behaelter.value;
    const top = form.value === "ganz" ? b.y + b.h - 40 : f.y + f.h + 10;
    return { left: `${String(f.x + f.w / 2)}px`, top: `${String(top)}px` };
});
const hinweis = computed(() => {
    if (finger.value) {
        return {
            stark: form.value === "ganz" ? t("screenshot.leiste.ganzKurz") : t("screenshot.leiste.ziehen"),
            rest: "",
        };
    }
    if (form.value === "ganz") return { stark: t("screenshot.leiste.klickGanz"), rest: t("screenshot.leiste.esc") };
    const rest =
        form.value === "rechteck"
            ? [t("screenshot.leiste.radFormat"), t("screenshot.leiste.umschaltGroesse"), t("screenshot.leiste.esc")]
            : [t("screenshot.leiste.radGroesse"), t("screenshot.leiste.esc")];
    return { stark: t("screenshot.leiste.klick"), rest: rest.join(" · ") };
});
const px = (k: Kasten): Record<string, string> => ({
    left: `${String(k.x)}px`,
    top: `${String(k.y)}px`,
    width: `${String(k.w)}px`,
    height: `${String(k.h)}px`,
});

watch(rahmen, zeichneRahmen);

// --- Ein Klick neben die Auswahl schließt sie, Esc auch (Kaskade).

function daneben(ereignis: PointerEvent): void {
    if (phase.value === "wahl" && !wahlEl.value?.contains(ereignis.target as Node)) schliesse();
}
const cascade = inject(ESCAPE_CASCADE_KEY, undefined);
const abmelden: (() => void)[] = [];
onMounted(() => {
    document.addEventListener("pointerdown", daneben, true);
    document.addEventListener("keydown", taste);
    if (cascade) {
        abmelden.push(
            cascade.register("menus", () => {
                if (phase.value !== "wahl") return false;
                schliesse();
                return true;
            }),
            cascade.register("action", () => {
                if (phase.value !== "laden" && phase.value !== "aufnahme") return false;
                schliesse();
                return true;
            }),
        );
    }
});
onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", daneben, true);
    document.removeEventListener("keydown", taste);
    for (const ab of abmelden) ab();
    if (rahmenGeplant !== 0) cancelAnimationFrame(rahmenGeplant);
    if (ergebnisUrl) URL.revokeObjectURL(ergebnisUrl);
});
</script>

<template>
    <Teleport to="body">
        <div
            v-if="phase === 'wahl'"
            ref="wahlEl"
            class="wahl"
            role="menu"
            :aria-label="t('screenshot.titel')"
            data-testid="screenshot-wahl"
            @contextmenu.prevent
        >
            <div class="wahl__kopf">{{ t("screenshot.titel") }}</div>
            <div class="wahl__kacheln">
                <button
                    v-for="kachel in KACHELN"
                    :key="kachel.form"
                    type="button"
                    role="menuitem"
                    class="kachel"
                    :data-testid="`screenshot-${kachel.form}`"
                    @click="void starte(kachel.form)"
                >
                    <svg viewBox="0 0 64 44" aria-hidden="true">
                        <template v-if="kachel.form === 'ganz'">
                            <rect class="kachel__feld" x="2" y="2" width="60" height="40" rx="3" />
                        </template>
                        <template v-else>
                            <rect class="kachel__rand" x="2" y="2" width="60" height="40" rx="3" />
                            <rect
                                v-if="kachel.form === 'quadrat'"
                                class="kachel__feld"
                                x="18"
                                y="8"
                                width="28"
                                height="28"
                                rx="1.5"
                            />
                            <template v-else>
                                <rect class="kachel__feld" x="11" y="11" width="42" height="22" rx="1.5" />
                                <rect class="kachel__hoch" x="23" y="6" width="18" height="32" rx="1.5" />
                            </template>
                        </template>
                    </svg>
                    <span class="kachel__name">{{ t(kachel.label) }}</span>
                </button>
            </div>
            <div class="wahl__optionen">
                <AvmKaestchen
                    art="checkbox"
                    :checked="rahmen"
                    :hinweis="t('screenshot.rahmenHinweis')"
                    testid="screenshot-rahmen"
                    @change="(an: boolean) => (rahmen = an)"
                    >{{ t("screenshot.rahmen") }}</AvmKaestchen
                >
                <span class="wahl__raster">
                    <span class="wahl__rastername">{{ t("screenshot.raster") }}</span>
                    <AvmSegmente
                        v-model="rasterModell"
                        :options="rasterWahl"
                        :label="t('screenshot.raster')"
                        testid="screenshot-raster"
                    >
                        <template #zeichen="{ option }">
                            <span class="segment">
                                <svg v-if="option.value === 'hex'" viewBox="0 0 14 14" aria-hidden="true">
                                    <path d="M7 1.2l5.1 2.9v5.8L7 12.8 1.9 9.9V4.1z" />
                                </svg>
                                <svg v-else-if="option.value === 'grid'" viewBox="0 0 14 14" aria-hidden="true">
                                    <path d="M1.5 1.5h11v11h-11zM5.2 1.5v11M8.8 1.5v11M1.5 5.2h11M1.5 8.8h11" />
                                </svg>
                                <span class="einzeilig">{{ option.label }}</span>
                            </span>
                        </template>
                    </AvmSegmente>
                </span>
            </div>
        </div>

        <div
            v-if="phase === 'aufnahme'"
            class="aufnahme"
            :class="`aufnahme--${form}`"
            data-testid="screenshot-aufnahme"
            @pointerdown="druck"
            @pointermove="zeige"
            @pointerup="los"
            @pointercancel="zug = null"
            @click="klick"
            @wheel.prevent="rad"
            @contextmenu.prevent
        >
            <div ref="standbildEl" class="aufnahme__bild" :style="px(behaelter)"></div>
            <canvas ref="rahmenEl" class="aufnahme__rahmen" :style="px(behaelter)"></canvas>
            <div v-if="form === 'ganz'" class="aufnahme__ganz" :style="px(behaelter)"></div>
            <div v-else class="aufnahme__feld" :style="px(feld)" data-testid="screenshot-feld"></div>
            <span class="aufnahme__masz" :style="maszLage" data-testid="screenshot-masz">{{ masz }}</span>
            <div class="aufnahme__leiste" data-testid="screenshot-leiste" @click.stop @pointerdown.stop>
                <span v-if="!(finger && form === 'rechteck')" class="aufnahme__hinweis avm-versalmitte"
                    ><span class="aufnahme__stark">{{ hinweis.stark }}</span
                    ><template v-if="hinweis.rest"> · {{ hinweis.rest }}</template></span
                >
                <template v-if="finger">
                    <template v-if="form !== 'ganz'">
                        <AvmKnopf groesse="zeile" :aria-label="t('screenshot.kleiner')" @click="groesse(1 / 1.12)"
                            >−</AvmKnopf
                        >
                        <AvmKnopf groesse="zeile" :aria-label="t('screenshot.groesser')" @click="groesse(1.12)"
                            >+</AvmKnopf
                        >
                    </template>
                    <AvmKnopf
                        v-if="form === 'rechteck'"
                        groesse="zeile"
                        :title="t('screenshot.naechstesFormat')"
                        testid="screenshot-format"
                        @click="wechsleFormat(1, true)"
                        >{{ formatName(format, t) }}</AvmKnopf
                    >
                    <AvmKnopf groesse="zeile" art="gefuellt" testid="screenshot-aufnehmen" @click="aufnehmen">{{
                        t("screenshot.aufnehmen")
                    }}</AvmKnopf>
                </template>
                <AvmKnopf
                    groesse="zeile"
                    :aria-label="t('screenshot.abbrechen')"
                    :title="t('screenshot.abbrechen')"
                    testid="screenshot-abbrechen"
                    @click="schliesse"
                    >✕</AvmKnopf
                >
            </div>
        </div>

        <div v-if="blitz" class="blitz" :style="px(blitz)"></div>
        <AvmBildansicht v-model="ansicht" :bilder="ansichtBilder" testid="screenshot-ansicht" />
    </Teleport>
</template>

<style scoped>
/* Die Auswahl: dasselbe Blatt wie das Kartenmenü (`map-context-menu.vue`), mittig auf dem Schirm. */
.wahl {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: calc(var(--z-dialog-high) + 2);
    display: grid;
    gap: var(--space-6);
    /* Breit genug, dass Rahmen und Raster in einer Zeile stehen (gemessen auf der Stage: 80 + 244 px samt Abstand); am Telefon brechen sie um. */
    width: min(384px, calc(100vw - 16px));
    box-sizing: border-box;
    padding: var(--space-6);
    transform: translate(-50%, -50%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
}

.wahl__kopf {
    padding: var(--space-4) var(--space-10) 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.wahl__kacheln {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
}

.kachel {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-10) var(--space-4) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.kachel:hover {
    border-color: var(--color-border-strong);
    background: var(--color-hover-wash);
}

.kachel:active {
    background: var(--color-active-wash);
}

.kachel:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
    box-shadow: var(--focus-ring);
}

.kachel svg {
    width: 64px;
    height: 44px;
}

.kachel__rand {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.5;
}

.kachel__feld {
    fill: var(--color-hover-wash);
    stroke: var(--color-accent);
    stroke-width: 1.5;
}

/* Das Rechteck: quer und hoch übereinander, das Seitenverhältnis wählt das Mausrad. */
.kachel__hoch {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 1.2;
    stroke-dasharray: 2.5 2;
}

.kachel__name {
    text-align: center;
}

.wahl__optionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6) var(--space-12);
    padding: var(--space-6) var(--space-2) var(--space-2) var(--space-10);
    border-top: 1px solid var(--color-border);
}

.wahl__raster {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.wahl__rastername {
    color: var(--color-text-muted);
}

.segment {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-2);
}

.segment svg {
    flex: none;
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
}

/* Die Aufnahme: das Standbild über allem, darüber Feld, Maß und Leiste. Sie blendet ein; die Bedienfelder darunter scheinen zu verschwinden. */
.aufnahme {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-dialog-high) + 2);
    overflow: hidden;
    background: var(--color-panel);
    cursor: crosshair;
    touch-action: none;
    user-select: none;
    animation: aufnahme-ein 160ms ease;
}

@keyframes aufnahme-ein {
    from {
        opacity: 0;
    }
}

.aufnahme__bild,
.aufnahme__rahmen,
.aufnahme__ganz {
    position: absolute;
    pointer-events: none;
}

/* Das Feld: hell umrandet, die Ecken in Gold, außen der Schleier. */
.aufnahme__feld {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid var(--color-map-context-anchor-contour);
    box-shadow:
        0 0 0 1px var(--color-map-context-anchor-outline),
        /* Der Schleier liegt auf dem Standbild, wie der Spoiler-Deckel auf einem Bild; `scrim-dialog` gehört den Fenstern (`fenster-huelle.test.ts`). */
        0 0 0 200vmax var(--color-scrim-spoiler);
    pointer-events: none;
}

.aufnahme__feld::before {
    position: absolute;
    inset: -7px;
    border: 3px solid var(--color-accent);
    content: "";
    mask:
        linear-gradient(#000 0 0) top left / 22px 22px no-repeat,
        linear-gradient(#000 0 0) top right / 22px 22px no-repeat,
        linear-gradient(#000 0 0) bottom left / 22px 22px no-repeat,
        linear-gradient(#000 0 0) bottom right / 22px 22px no-repeat;
}

.aufnahme__ganz {
    box-shadow: inset 0 0 0 3px var(--color-accent);
}

.aufnahme__masz {
    position: absolute;
    padding: var(--space-2) var(--space-8);
    transform: translateX(-50%);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
}

.aufnahme__leiste {
    position: absolute;
    top: var(--space-10);
    left: 50%;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    max-width: calc(100% - 24px);
    box-sizing: border-box;
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-12);
    transform: translateX(-50%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text-muted);
    cursor: default;
    white-space: nowrap;
}

.aufnahme__hinweis {
    min-width: 0;
    overflow: hidden;
    padding-right: var(--space-4);
}

.aufnahme__stark {
    color: var(--color-text);
}

/* Der Auslöser: ein kurzes helles Aufblitzen über genau dem aufgenommenen Feld. */
.blitz {
    position: fixed;
    z-index: calc(var(--z-dialog-high) + 3);
    background: var(--color-map-context-anchor-contour);
    opacity: 0;
    pointer-events: none;
    animation: blitz 300ms ease-out;
}

@keyframes blitz {
    from {
        opacity: 0.85;
    }
}

@media (prefers-reduced-motion: reduce) {
    .kachel {
        transition: none;
    }

    .aufnahme,
    .blitz {
        animation: none;
    }
}
</style>
