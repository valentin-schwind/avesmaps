<script setup lang="ts">
import { computed } from "vue";
import type { EditorGebirge, EditorLandscapePeak } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { toenung } from "./gebirge-vorschau-bild";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";

/**
 * Die große Vorschau im Reiter „Gebirge“ (V1 der abgenommenen Bauvorlage Gebirge-Entwurf V16/V17, Betreiber 2026-10-20: „beides“, V1 „rollt
 * mit“): dasselbe Bild wie die Vorschau im Umriss auf der Karte (V2, `gebirge-vorschau-karte.ts`), Norden oben, darüber nur, was die Daten
 * tragen: der Umriss, Flüsse, Seen und Pässe („Fluss, See, Pass einzeichnen“), die Gipfel der Fläche und das gezeichnete Netz (Kämme,
 * Nebengipfel). Die Lagen liegen als SVG in Karteneinheiten über dem Bild; sie nehmen keinen Klick. Die Gipfel tragen Namen und Höhe
 * (die Höhe im Entwurf, sonst die gespeicherte), darunter steht die Höhenskala der Tönung von 0 bis zur höchsten Stelle (Entwurf V16).
 *
 * Immer quadratisch (Betreiber 2026-10-21: „dauerhaft quadratisch wär gut“): Das Gebirge steht mittig im Quadrat um seinen Rahmen, Bild,
 * Lagen und Namen teilen dasselbe Quadrat, nichts wird verzerrt.
 */
const props = defineProps<{
    /** Das Bild der letzten Rechnung und seine Ecken (oben links, oben rechts, unten rechts, unten links); ohne: noch keins. */
    bild: { url: string; ecken: readonly (readonly [number, number])[]; hoechste?: number } | undefined;
    eingabe: EditorGebirge["eingabe"];
    netz: EditorGebirge["stand"]["netz"] | undefined;
    peaks: readonly EditorLandscapePeak[];
    /** Die Höhen der Gipfel im Entwurf; sie gelten vor den gespeicherten. */
    gipfelHoehen?: Readonly<Record<string, number>> | undefined;
    /** „Kämme n · Nebengipfel m“ unten links im Bild. */
    zahl?: string | undefined;
    /** Der Satz unter dem Bild (Zellen, Zeit, Überhöhung) oder „rechnet …“. */
    satz?: string | undefined;
    kennung: string;
}>();

const aufloesung = defineModel<1 | 2 | 4>("aufloesung", { default: 1 });
const aufloesungsWahl = computed<string>({
    get: () => String(aufloesung.value),
    set: (wert) => {
        if (wert === "1" || wert === "2" || wert === "4") aufloesung.value = Number(wert) as 1 | 2 | 4;
    },
});
const aufloesungsOptionen = [1, 2, 4].map((wert) => ({ wert: String(wert), text: `${String(wert)}×` }));

/** Der Rahmen in Karteneinheiten: aus den Ecken des Bilds, sonst aus dem Umriss. */
const rahmen = computed(() => {
    const ecken = props.bild?.ecken;
    if (ecken !== undefined && ecken.length === 4)
        return { links: ecken[0]![0], oben: ecken[0]![1], rechts: ecken[2]![0], unten: ecken[2]![1] };
    const b = props.eingabe.bounds;
    return { links: b.min_x, oben: b.max_y, rechts: b.max_x, unten: b.min_y };
});
/** Das Quadrat um den Rahmen (Karteneinheiten), mittig: Seite ist die längere Seite des Rahmens. */
const quadrat = computed(() => {
    const r = rahmen.value;
    const seite = Math.max(1e-6, r.rechts - r.links, r.oben - r.unten);
    const mx = (r.links + r.rechts) / 2;
    const my = (r.oben + r.unten) / 2;
    return { links: mx - seite / 2, oben: my + seite / 2, seite };
});
/** Eine Lage im Quadrat in Prozent (für Bild und Namen). */
const prozentX = (x: number): number => ((x - quadrat.value.links) / quadrat.value.seite) * 100;
const prozentY = (y: number): number => ((quadrat.value.oben - y) / quadrat.value.seite) * 100;
/** Das SVG zählt y nach unten, die Karte nach oben (Norden): gezeichnet wird mit −y. */
const viewBox = computed(() => {
    const q = quadrat.value;
    return `${String(q.links)} ${String(-q.oben)} ${String(q.seite)} ${String(q.seite)}`;
});
/** Das Bild an seinem Platz im Quadrat. */
const bildLage = computed(() => {
    const r = rahmen.value;
    return {
        left: `${String(prozentX(r.links))}%`,
        top: `${String(prozentY(r.oben))}%`,
        width: `${String(((r.rechts - r.links) / quadrat.value.seite) * 100)}%`,
        height: `${String(((r.oben - r.unten) / quadrat.value.seite) * 100)}%`,
    };
});
/** Strichstärke in Karteneinheiten: etwa ein Bildpunkt bei 420 px Breite. */
const strich = computed(() => quadrat.value.seite / 420);

const linie = (punkte: readonly (readonly number[])[]): string =>
    punkte.map(([x, y]) => `${String(x)},${String(-(y ?? 0))}`).join(" ");
const ringe = (g: EditorGebirge["eingabe"]["geometry"]): string => {
    const polygone = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
    return polygone
        .flatMap((polygon) =>
            polygon.map((ring) => `M${ring.map(([x, y]) => `${String(x)},${String(-(y ?? 0))}`).join("L")}Z`),
        )
        .join(" ");
};
const umriss = computed(() => ringe(props.eingabe.geometry));
const seen = computed(() => props.eingabe.seen.map((see) => ({ name: see.n, d: ringe(see.g) })));
/** Die Namen der Gipfel als HTML über dem Bild (in Prozent des Rahmens), damit die Schrift nicht mit dem Bild verzerrt. */
const gipfelNamen = computed(() => {
    return props.peaks.map((gipfel) => {
        const h = props.gipfelHoehen?.[gipfel.id] ?? gipfel.height;
        return {
            id: gipfel.id,
            text: h === undefined ? gipfel.name : `${gipfel.name} ${formatNumber(h, 0)}`,
            links: `${String(prozentX(gipfel.position[0]))}%`,
            oben: `${String(prozentY(gipfel.position[1]))}%`,
        };
    });
});
const rgb = (anteil: number): string =>
    `rgb(${toenung(anteil)
        .map((wert) => String(Math.round(wert)))
        .join(", ")})`;
/** Die Höhenskala: dieselbe Tönung wie das Bild, ohne Schummerung. */
const skala = computed(() => {
    const hoechste = props.bild?.hoechste;
    if (hoechste === undefined) return undefined;
    const stufen = [0, 0.25, 0.5, 0.75, 1].map((a) => `${rgb(a)} ${String(a * 100)}%`).join(", ");
    return {
        verlauf: `linear-gradient(to right, ${stufen})`,
        bis: t("scale.schritt", { n: formatNumber(hoechste, 0) }),
    };
});
const paesse = computed(
    () => (props.eingabe as { paesse?: { name?: string | null; punkte: [number, number][] }[] }).paesse ?? [],
);
</script>

<template>
    <figure class="gross" :data-testid="`${kennung}-gebirge-vorschau-gross`">
        <div class="gross__bildrahmen">
            <div class="gross__bild">
                <div class="gross__quadrat">
                    <img v-if="bild" :src="bild.url" alt="" class="gross__raster" :style="bildLage" />
                    <svg class="gross__lagen" :viewBox="viewBox" preserveAspectRatio="none" aria-hidden="true">
                        <path class="gross__umriss" :d="umriss" :stroke-width="strich * 1.5" />
                        <path
                            v-for="see in seen"
                            :key="see.name"
                            class="gross__see"
                            :d="see.d"
                            :stroke-width="strich"
                        />
                        <polyline
                            v-for="(fluss, i) in eingabe.fluesse"
                            :key="`f${String(i)}`"
                            class="gross__fluss"
                            :points="linie(fluss.p)"
                            :stroke-width="strich * (fluss.bach ? 1 : 2)"
                        />
                        <polyline
                            v-for="(pass, i) in paesse"
                            :key="`p${String(i)}`"
                            class="gross__pass"
                            :points="linie(pass.punkte)"
                            :stroke-width="strich * 1.5"
                            :stroke-dasharray="`${String(strich * 4)} ${String(strich * 3)}`"
                        />
                        <polyline
                            v-for="(kamm, i) in netz?.kaemme ?? []"
                            :key="`k${String(i)}`"
                            class="gross__kamm"
                            :class="{ gross__tal: kamm.rang === 'tal' }"
                            :points="linie(kamm.punkte)"
                            :stroke-width="strich * (kamm.rang === 'haupt' ? 2.5 : 1.5)"
                        />
                        <circle
                            v-for="(n, i) in netz?.nebengipfel ?? []"
                            :key="`n${String(i)}`"
                            class="gross__nebengipfel"
                            :cx="n.x"
                            :cy="-n.y"
                            :r="strich * 3"
                        />
                        <circle
                            v-for="(n, i) in netz?.mulden ?? []"
                            :key="`m${String(i)}`"
                            class="gross__mulde"
                            :cx="n.x"
                            :cy="-n.y"
                            :r="strich * 3"
                        />
                        <circle
                            v-for="gipfel in peaks"
                            :key="gipfel.id"
                            class="gross__gipfel"
                            :cx="gipfel.position[0]"
                            :cy="-gipfel.position[1]"
                            :r="strich * 4"
                            :stroke-width="strich"
                        />
                    </svg>
                    <span
                        v-for="name in gipfelNamen"
                        :key="name.id"
                        class="gross__name"
                        :style="{ left: name.links, top: name.oben }"
                        data-testid="gebirge-vorschau-gipfelname"
                        >{{ name.text }}</span
                    >
                    <span v-if="zahl" class="gross__zahl" :data-testid="`${kennung}-gebirge-vorschau-zahl`">{{
                        zahl
                    }}</span>
                    <span class="gross__norden" aria-hidden="true">{{
                        t("landschaftseditor.gebirge.vorschau.norden")
                    }}</span>
                    <span v-if="!bild" class="gross__leer">{{ t("landschaftseditor.gebirge.vorschau.rechnet") }}</span>
                </div>
            </div>
            <AvmMenueknopf
                v-model="aufloesungsWahl"
                class="gross__aufloesung"
                :im-fenster="true"
                :optionen="aufloesungsOptionen"
                :bezeichnung="`${t('landschaftseditor.gebirge.vorschau.aufloesung')}: ${aufloesung}×`"
                :menue-bezeichnung="t('landschaftseditor.gebirge.vorschau.aufloesung')"
                :testid="`${kennung}-gebirge-aufloesung`"
            >
                <template #knopf
                    ><span class="gross__aufloesungstext">{{ aufloesung }}× ▾</span></template
                >
            </AvmMenueknopf>
        </div>
        <div v-if="skala" class="gross__skala" :data-testid="`${kennung}-gebirge-vorschau-skala`">
            <span>0</span>
            <span class="gross__verlauf" :style="{ background: skala.verlauf }" aria-hidden="true" />
            <span>{{ skala.bis }}</span>
        </div>
        <figcaption v-if="satz" class="gross__satz">{{ satz }}</figcaption>
    </figure>
</template>

<style scoped>
.gross {
    margin: 0;
    width: 100%;
    min-width: 0;
    background: var(--color-panel);
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
}

/* Das Quadrat nutzt die volle Eigenschaftsbreite, auch im gelösten Fenster. */
.gross__bildrahmen {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
}

.gross__bild {
    display: grid;
    place-items: center;
    container-type: size;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.gross__quadrat {
    position: relative;
    width: min(100cqw, 100cqh);
    height: min(100cqw, 100cqh);
}

.gross__aufloesung {
    position: absolute;
    right: var(--space-6);
    bottom: var(--space-6);
    z-index: 1;
}
.gross__aufloesungstext {
    padding-inline: var(--space-6);
    font-size: var(--font-size-small);
}

.gross__skala,
.gross__satz {
    flex: none;
}

.gross__lagen {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.gross__raster {
    position: absolute;
}

.gross__raster {
    image-rendering: auto;
}

.gross__lagen {
    pointer-events: none;
}

.gross__umriss {
    fill: none;
    stroke: var(--color-text-muted);
}

.gross__see {
    fill: var(--color-link);
    fill-opacity: 0.55;
    stroke: var(--color-link);
}

.gross__fluss {
    fill: none;
    stroke: var(--color-link);
    stroke-linecap: round;
    stroke-linejoin: round;
}

.gross__pass {
    fill: none;
    stroke: var(--color-text);
}

/* Kämme und Nebengipfel im Rot der Bearbeitung (Betreiber 2026-10-21: „kammlinien rötlicher“; T2 Signalrot), wie auf der Karte. */
.gross__kamm {
    fill: none;
    stroke: var(--color-edit-edge);
    stroke-linecap: round;
    stroke-linejoin: round;
}

.gross__nebengipfel {
    fill: var(--color-edit-edge);
}

.gross__gipfel {
    fill: var(--color-panel);
    stroke: var(--color-text-strong);
}

.gross__name {
    position: absolute;
    transform: translate(0.45em, -50%);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
    text-shadow:
        0 0 2px var(--color-panel),
        0 0 4px var(--color-panel);
}

.gross__zahl {
    position: absolute;
    bottom: var(--space-2);
    left: var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    pointer-events: none;
    text-shadow:
        0 0 2px var(--color-panel),
        0 0 4px var(--color-panel);
}

.gross__norden {
    position: absolute;
    top: var(--space-2);
    left: var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    pointer-events: none;
    text-shadow:
        0 0 2px var(--color-panel),
        0 0 4px var(--color-panel);
}

.gross__skala {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gross__verlauf {
    flex: 1;
    height: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
}

.gross__leer {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gross__satz {
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
.gross__tal {
    stroke: var(--color-profile-river);
}
.gross__mulde {
    fill: var(--color-profile-river);
}
</style>
