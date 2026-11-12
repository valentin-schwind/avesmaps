<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import { t } from "../i18n/i18n";
import {
    DERO_EBENEN,
    ebeneDerWahl,
    istDero,
    KARTEN_MODI,
    serieDerWahl,
    type DeroEbene,
    type KartenWahl,
    type ReisePdfEinstellungen,
    type WahlSerie,
} from "./einstellungen";
import ReisePdfZeichen from "./reise-pdf-zeichen.vue";

/**
 * „Kartenbild auf dem Deckblatt“ (WI-0306, Entwurf Fassung 6): das Vorschaufeld, die drei Kacheln „Ganze Route“ · „Ausschnitt“ · „Ohne Bild“
 * und darunter EINE Wahl „Karte“ als flache Knöpfe mit Bildchen links: die Serien, „Politisch“ und in einer Klappbox die sieben Ebenen der
 * Derographie. Der goldene Punkt steht an dem, was gerade auf der Karte ist (Legende „gerade auf der Karte“); die gewählte Ebene steht im
 * Kopf der zugeklappten Box.
 *
 * - Die Bildchen sind kleine statische Ausschnitte (`public/img/reise-pdf/`, je Serie und Ansicht); eine Serie ohne eigenes Bildchen zeigt die
 *   leere Fläche.
 * - Ohne Karte (kein Zugang, `ohneKarte`) sind „Ganze Route“ und „Ausschnitt“ gesperrt, das Deckblatt nennt dann die Stationen.
 * - „Politisch“ ist gesperrt, solange die Gebiete fehlen: Die Karte zeigte sonst die Standardansicht.
 */
const props = defineProps<{
    einstellungen: ReisePdfEinstellungen;
    serien: readonly WahlSerie[];
    jetzt?: KartenWahl | undefined;
    vorschau?: string | undefined;
    nimmtAuf: boolean;
    fehler: boolean;
    ohneKarte: boolean;
    politischBereit: boolean;
}>();
/** Die Einstellungen sind EIN reaktives Objekt, das das Fenster hält; die Felder hier schreiben hinein. */
const e = props.einstellungen;

const kennung = useId();
const BILDCHEN = new Set(["modern", "original", "old"]);
const bildchenVon = (wahl: KartenWahl): string | undefined => {
    const serie = serieDerWahl(wahl);
    if (serie !== undefined) return BILDCHEN.has(serie) ? `/img/reise-pdf/${serie}.webp` : undefined;
    if (wahl === "politisch") return "/img/reise-pdf/politisch.webp";
    return `/img/reise-pdf/${ebeneDerWahl(wahl) ?? "alle"}.webp`;
};
const ebenenName = (ebene: DeroEbene): string =>
    ebene === "hoehenstufen" ? t("topography.hoehenstufen") : t(`layer.${ebene}`);

interface WahlEintrag {
    wahl: KartenWahl;
    name: string;
    bild?: string | undefined;
    gesperrt: boolean;
}

const karten = computed((): WahlEintrag[] => [
    ...props.serien.map((serie) => ({
        wahl: `serie:${serie.id}` as const,
        name: serie.label,
        bild: bildchenVon(`serie:${serie.id}`),
        gesperrt: false,
    })),
    { wahl: "politisch", name: t("view.political"), bild: bildchenVon("politisch"), gesperrt: !props.politischBereit },
]);
const ebenen = computed((): WahlEintrag[] =>
    DERO_EBENEN.map((ebene) => ({
        wahl: `dero:${ebene}` as const,
        name: ebenenName(ebene),
        bild: bildchenVon(`dero:${ebene}`),
        gesperrt: false,
    })),
);

/** Der Name der Wahl im Etikett des Vorschaufelds: „Modern“, „Politisch“, „Derographie, Vegetation“. */
const wahlName = computed(() => {
    const ebene = ebeneDerWahl(e.wahl);
    if (ebene !== undefined) return `${t("view.landscapes")}, ${ebenenName(ebene)}`;
    return karten.value.find((k) => k.wahl === e.wahl)?.name ?? "";
});
const etikett = computed(() =>
    e.karte === "ohne"
        ? t("reisePdf.karte.etikett.ohne")
        : t(e.karte === "route" ? "reisePdf.karte.etikett.route" : "reisePdf.karte.etikett.ausschnitt", {
              karte: wahlName.value,
          }),
);
const deroOffen = ref(istDero(e.wahl));
watch(
    () => e.wahl,
    (wahl) => {
        if (istDero(wahl)) deroOffen.value = true;
    },
);
const deroKopf = computed(() => {
    const ebene = ebeneDerWahl(e.wahl);
    return ebene === undefined ? t("reisePdf.karte.ebenen", { n: DERO_EBENEN.length }) : ebenenName(ebene);
});

const MODUS_ZEICHEN = { route: "route", ausschnitt: "ausschnitt", ohne: "ohne" } as const;
</script>

<template>
    <fieldset class="rb__abschnitt" data-testid="reise-pdf-karte">
        <legend class="rb__titel">
            <img class="rb__sym" src="/icons/route/compass.webp" alt="" />{{ t("reisePdf.karte.titel") }}
        </legend>
        <div
            class="rp-platz"
            :class="{ 'rp-platz--ohne': e.karte === 'ohne' || vorschau === undefined }"
            data-testid="reise-pdf-kartenplatz"
        >
            <img v-if="e.karte !== 'ohne' && vorschau !== undefined" class="rp-platz__bild" :src="vorschau" alt="" />
            <span v-if="nimmtAuf && e.karte !== 'ohne'" class="rp-platz__laeuft" role="status">{{
                t("reisePdf.karte.nimmtAuf")
            }}</span>
            <span v-else-if="fehler && e.karte !== 'ohne'" class="rp-platz__laeuft" role="status">{{
                t("reisePdf.karte.fehler")
            }}</span>
            <span class="rp-platz__etikett">{{ etikett }}</span>
        </div>
        <div class="rb__chips rp-drei" role="radiogroup" :aria-label="t('reisePdf.karte.modus.beschriftung')">
            <label v-for="modus in KARTEN_MODI" :key="modus" class="rb__chip" :data-testid="`reise-pdf-modus-${modus}`">
                <input
                    v-model="e.karte"
                    class="rb__chipwahl"
                    type="radio"
                    :name="`${kennung}-modus`"
                    :value="modus"
                    :disabled="ohneKarte && modus !== 'ohne'"
                />
                <ReisePdfZeichen :name="MODUS_ZEICHEN[modus]" />{{ t(`reisePdf.karte.modus.${modus}`) }}
            </label>
        </div>
        <div v-if="e.karte !== 'ohne'" class="rp-wahl">
            <span class="rb__satz"
                >{{ t("reisePdf.karte.wahl") }}
                <span class="rp-legende" aria-hidden="true">{{ t("reisePdf.karte.jetzt") }}</span></span
            >
            <div class="rp-serien" role="radiogroup" :aria-label="t('reisePdf.karte.wahl')">
                <label
                    v-for="eintrag in karten"
                    :key="eintrag.wahl"
                    class="rp-serie"
                    :data-testid="`reise-pdf-wahl-${eintrag.wahl}`"
                >
                    <input
                        v-model="e.wahl"
                        class="rb__chipwahl"
                        type="radio"
                        :name="`${kennung}-wahl`"
                        :value="eintrag.wahl"
                        :disabled="eintrag.gesperrt"
                    />
                    <img v-if="eintrag.bild" class="rp-serie__bild" :src="eintrag.bild" alt="" />
                    <span v-else class="rp-serie__bild" aria-hidden="true"></span>
                    <span class="rp-serie__name">{{ eintrag.name }}</span>
                    <span v-if="eintrag.wahl === jetzt" class="rp-serie__jetzt"
                        ><span class="rb__nur-vorleser">{{ t("reisePdf.karte.jetzt") }}</span></span
                    >
                </label>
            </div>
            <AvmDisclosure
                v-model:open="deroOffen"
                class="rp-dero"
                :class="{ 'rp-dero--gewaehlt': ebeneDerWahl(e.wahl) !== undefined }"
                :label="t('view.landscapes')"
                :secondary="deroKopf"
                toggle-testid="reise-pdf-dero"
            >
                <div class="rp-serien rp-serien--klein" role="radiogroup" :aria-label="t('view.landscapes')">
                    <label
                        v-for="eintrag in ebenen"
                        :key="eintrag.wahl"
                        class="rp-serie rp-serie--klein"
                        :data-testid="`reise-pdf-wahl-${eintrag.wahl}`"
                    >
                        <input
                            v-model="e.wahl"
                            class="rb__chipwahl"
                            type="radio"
                            :name="`${kennung}-wahl`"
                            :value="eintrag.wahl"
                        />
                        <img v-if="eintrag.bild" class="rp-serie__bild" :src="eintrag.bild" alt="" />
                        <span class="rp-serie__name">{{ eintrag.name }}</span>
                        <span v-if="eintrag.wahl === jetzt" class="rp-serie__jetzt"
                            ><span class="rb__nur-vorleser">{{ t("reisePdf.karte.jetzt") }}</span></span
                        >
                    </label>
                </div>
            </AvmDisclosure>
        </div>
    </fieldset>
</template>

<style scoped src="../photobox/formular-stil.css"></style>
<style scoped>
/* Das Vorschaufeld: so hoch wie im Entwurf (sechs Takte), das Bild deckt es, das Etikett unten links. */
.rp-platz {
    position: relative;
    height: calc(6 * var(--space-24));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
}

.rp-platz--ohne {
    border-style: dashed;
}

.rp-platz__bild {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: cover;
}

.rp-platz__laeuft {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--space-8);
    background: color-mix(in srgb, var(--color-panel-soft) 72%, transparent);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: center;
}

.rp-platz__etikett {
    position: absolute;
    bottom: var(--space-6);
    left: var(--space-6);
    max-width: calc(100% - 2 * var(--space-6));
    padding: 0 var(--space-6);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-field-rest);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Drei Kacheln nebeneinander, etwas dichter (Entwurf `.rb__chips--drei`). */
.rp-drei {
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.rp-drei .rb__chip {
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-small);
}

.rp-wahl {
    display: grid;
    gap: var(--space-4);
}

/* „gerade auf der Karte“: der goldene Punkt als Legende. */
.rp-legende {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: var(--space-6);
    font-size: var(--font-size-caption);
}

.rp-legende::before,
.rp-serie__jetzt {
    content: "";
    width: var(--space-4);
    height: var(--space-4);
    border-radius: 50%;
    background: var(--color-accent);
}

/* Die Wahl als flache Knöpfe, das Bildchen klein links (Entwurf Fassung 5, Vali: „etwas kleiner, kleinerer thumb, im button links“). */
.rp-serien {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(4 * var(--space-24)), 1fr));
    gap: var(--space-6);
}

.rp-serie {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: calc(var(--avm-control-h) + var(--space-6));
    padding: var(--space-2) var(--space-4) var(--space-2) var(--space-2);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease,
        background-color 120ms ease;
}

.rp-serie__bild {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    box-shadow: 0 0 0 1px var(--color-border);
    object-fit: cover;
}

.rp-serie__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.rp-serie__jetzt {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
}

.rp-serie:hover:not(:has(input:disabled)) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 7%, var(--color-panel));
}

.rp-serie:active:not(:has(input:disabled)) {
    background: color-mix(in srgb, var(--color-accent) 18%, var(--color-panel));
}

.rp-serie:has(input:checked) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel));
    box-shadow: inset 0 0 0 1px var(--color-accent);
    color: var(--color-text-strong);
}

.rp-serie:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
}

.rp-serie:has(input:disabled) {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.rp-serie:has(input:disabled) .rp-serie__bild {
    filter: grayscale(1);
}

.rp-serien--klein {
    padding-top: var(--space-4);
}

.rp-serie--klein {
    font-size: var(--font-size-caption);
}

.rp-dero--gewaehlt {
    border-color: var(--color-accent);
}

@media (prefers-reduced-motion: reduce) {
    .rp-serie {
        transition: none;
    }
}
</style>
