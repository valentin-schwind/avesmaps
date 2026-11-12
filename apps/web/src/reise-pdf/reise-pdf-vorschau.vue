<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { t } from "../i18n/i18n";
import { oeffnePdf, zeichneSeite } from "./vorschau";

/**
 * Die Vorschau von „Reise als PDF“ (WI-0306, Entwurf Fassung 6): rechts im Fenster die große Seite, darüber „Seite n von m“ mit ‹ ›, darunter
 * die Daumenleiste aller Seiten. 🔴 Sie zeigt das ECHTE PDF, nicht einen Nachbau: pdf.js zeichnet die Seiten des Dokuments, das „PDF erstellen“
 * speichert (`vorschau.ts`). Ein Klick auf die Seite blättert weiter.
 *
 * - Ein neues PDF bricht die Zeichnung des alten ab; die gewählte Seite bleibt, solange es sie gibt.
 * - Die große Seite passt sich der Fläche an (ResizeObserver), scharf in der Dichte des Bildschirms.
 */
const props = defineProps<{
    pdf?: { blob: Blob; lauf: number } | undefined;
    laeuft: boolean;
    fehler: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ seiten: [anzahl: number] }>();

const dokument = shallowRef<PDFDocumentProxy | undefined>(undefined);
const seite = ref(1);
const anzahl = computed(() => dokument.value?.numPages ?? 0);
const buehne = useTemplateRef<HTMLDivElement>("buehne");
const gross = useTemplateRef<HTMLCanvasElement>("gross");
/** Die Leinwände der Daumen je Seite (ab 1); eine Liste aus `ref` in `v-for` hielte die Reihenfolge nicht zugesagt. */
const daumen = new Map<number, HTMLCanvasElement>();
const merkeDaumen = (nummer: number, el: unknown): void => {
    if (el instanceof HTMLCanvasElement) daumen.set(nummer, el);
    else daumen.delete(nummer);
};
/** Die Höhe der Daumen wie im Entwurf, am Telefon niedriger. */
const DAUMEN_HOEHE = { rechner: 112, telefon: 78 } as const;
let aufgaben: RenderTask[] = [];
let lauf = 0;

function brichAb(): void {
    for (const aufgabe of aufgaben) aufgabe.cancel();
    aufgaben = [];
}

async function zeichneGross(): Promise<void> {
    const pdf = dokument.value;
    const flaeche = buehne.value;
    const leinwand = gross.value;
    if (pdf === undefined || flaeche === null || leinwand === null) return;
    const box = flaeche.getBoundingClientRect();
    if (box.width < 20 || box.height < 20) return;
    const stil = getComputedStyle(flaeche);
    const breite = box.width - Number.parseFloat(stil.paddingLeft) - Number.parseFloat(stil.paddingRight);
    const hoehe = box.height - Number.parseFloat(stil.paddingTop) - Number.parseFloat(stil.paddingBottom);
    try {
        const aufgabe = await zeichneSeite(pdf, Math.min(seite.value, pdf.numPages), leinwand, breite, hoehe);
        if (aufgabe) {
            aufgaben.push(aufgabe);
            await aufgabe.promise;
        }
    } catch {
        // Abgebrochen: eine neuere Zeichnung läuft.
    }
}

async function zeichneDaumen(eigenerLauf: number): Promise<void> {
    const pdf = dokument.value;
    if (pdf === undefined) return;
    const hoehe = props.telefon ? DAUMEN_HOEHE.telefon : DAUMEN_HOEHE.rechner;
    for (let nummer = 1; nummer <= pdf.numPages; nummer += 1) {
        if (eigenerLauf !== lauf) return;
        const leinwand = daumen.get(nummer);
        if (leinwand === undefined) continue;
        try {
            const aufgabe = await zeichneSeite(pdf, nummer, leinwand, hoehe, hoehe);
            if (aufgabe) {
                aufgaben.push(aufgabe);
                await aufgabe.promise;
            }
        } catch {
            return;
        }
    }
}

watch(
    () => props.pdf,
    async (neu) => {
        if (neu === undefined) return;
        const eigenerLauf = ++lauf;
        brichAb();
        try {
            const pdf = await oeffnePdf(neu.blob);
            if (eigenerLauf !== lauf) {
                void pdf.loadingTask.destroy();
                return;
            }
            const alt = dokument.value;
            dokument.value = pdf;
            void alt?.loadingTask.destroy();
            seite.value = Math.min(seite.value, pdf.numPages);
            emit("seiten", pdf.numPages);
            await nextTick();
            await zeichneGross();
            await zeichneDaumen(eigenerLauf);
        } catch {
            // Die Hülle zeigt den Fehler über `fehler`.
        }
    },
    { immediate: true },
);

watch(seite, () => void zeichneGross());
watch(
    () => props.telefon,
    () => void nextTick(() => zeichneDaumen(lauf)),
);

let beobachter: ResizeObserver | undefined;
let geplant = 0;
onMounted(() => {
    if (buehne.value === null || typeof ResizeObserver !== "function") return;
    beobachter = new ResizeObserver(() => {
        cancelAnimationFrame(geplant);
        geplant = requestAnimationFrame(() => void zeichneGross());
    });
    beobachter.observe(buehne.value);
});
onBeforeUnmount(() => {
    beobachter?.disconnect();
    cancelAnimationFrame(geplant);
    brichAb();
    lauf += 1;
    void dokument.value?.loadingTask.destroy();
});

function blaettere(schritt: number): void {
    const neu = Math.max(1, Math.min(anzahl.value, seite.value + schritt));
    if (neu !== seite.value) seite.value = neu;
}

/** Die große Seite neu zeichnen, wenn die Fläche erst jetzt sichtbar wird (am Telefon der Reiter „Vorschau“). */
defineExpose({ zeichneNeu: () => void nextTick(() => zeichneGross()) });
</script>

<template>
    <section class="rp-vorschau" :aria-label="t('reisePdf.vorschau.titel')" data-testid="reise-pdf-vorschau">
        <div class="rp-vorschau__kopf">
            <strong v-if="!telefon" class="rp-vorschau__titel">{{ t("reisePdf.vorschau.titel") }}</strong>
            <span class="rp-vorschau__zahl" data-testid="reise-pdf-seitenzahl">{{
                anzahl > 0 ? t("reisePdf.vorschau.seite", { n: seite, m: anzahl }) : ""
            }}</span>
            <button
                type="button"
                class="rp-blaettern"
                :disabled="seite <= 1"
                :aria-label="t('reisePdf.vorschau.zurueck')"
                :title="t('reisePdf.vorschau.zurueck')"
                data-testid="reise-pdf-zurueck"
                @click="blaettere(-1)"
            >
                ‹
            </button>
            <button
                type="button"
                class="rp-blaettern"
                :disabled="seite >= anzahl"
                :aria-label="t('reisePdf.vorschau.vor')"
                :title="t('reisePdf.vorschau.vor')"
                data-testid="reise-pdf-vor"
                @click="blaettere(1)"
            >
                ›
            </button>
        </div>
        <div ref="buehne" class="rp-vorschau__buehne">
            <button
                v-show="anzahl > 0"
                type="button"
                class="rp-vorschau__seite"
                :title="t('reisePdf.vorschau.klick')"
                :aria-label="t('reisePdf.vorschau.seite', { n: seite, m: anzahl })"
                data-testid="reise-pdf-seite"
                @click="blaettere(seite >= anzahl ? 1 - anzahl : 1)"
            >
                <canvas ref="gross"></canvas>
            </button>
            <p v-if="laeuft && anzahl === 0" class="rp-vorschau__satz" role="status">
                {{ t("reisePdf.vorschau.entsteht") }}
            </p>
            <p v-else-if="fehler" class="rp-vorschau__satz" role="alert">{{ t("reisePdf.vorschau.fehler") }}</p>
        </div>
        <div class="rp-daumen" :aria-label="t('reisePdf.vorschau.daumen')">
            <button
                v-for="nummer in anzahl"
                :key="nummer"
                type="button"
                class="rp-daumen__knopf"
                :aria-current="nummer === seite"
                :aria-label="t('reisePdf.vorschau.seiteN', { n: nummer })"
                :data-testid="`reise-pdf-daumen-${nummer}`"
                @click="seite = nummer"
            >
                <canvas :ref="(el) => merkeDaumen(nummer, el)" class="rp-daumen__bild"></canvas>
                <small>{{ nummer === 1 ? t("reisePdf.vorschau.deckblatt") : nummer }}</small>
            </button>
        </div>
    </section>
</template>

<style scoped>
.rp-vorschau {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    background: var(--color-panel-muted);
}

.rp-vorschau__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rp-vorschau__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    font-weight: inherit;
}

.rp-vorschau__zahl {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}

.rp-blaettern {
    display: grid;
    place-items: center;
    width: calc(var(--avm-control-h) - var(--space-2));
    height: calc(var(--avm-control-h) - var(--space-2));
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.rp-blaettern:hover:not(:disabled) {
    background: var(--color-button-soft-hover);
}

.rp-blaettern:active:not(:disabled) {
    background: var(--color-button-soft-active);
}

.rp-blaettern:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.rp-blaettern:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.rp-vorschau__buehne {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    padding: var(--space-4) var(--space-16) var(--space-8);
    overflow: hidden;
}

/* Die Seite als Knopf: ein Klick blättert weiter. Sie liegt wie ein Blatt auf dem Tisch. */
.rp-vorschau__seite {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    box-shadow: var(--shadow-panel);
    cursor: pointer;
    line-height: 0;
}

.rp-vorschau__seite:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), var(--shadow-panel);
}

.rp-vorschau__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rp-daumen {
    display: flex;
    gap: var(--space-8);
    padding: var(--space-6) var(--space-10) var(--space-10);
    overflow-x: auto;
}

.rp-daumen__knopf {
    flex: none;
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition: border-color 120ms ease;
}

.rp-daumen__knopf:hover {
    border-color: var(--color-border-strong);
}

.rp-daumen__knopf[aria-current="true"] {
    border-color: var(--color-accent);
    color: var(--color-text-strong);
}

.rp-daumen__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.rp-daumen__bild {
    display: block;
    box-shadow: var(--shadow-field-rest);
}

@media (prefers-reduced-motion: reduce) {
    .rp-blaettern,
    .rp-daumen__knopf {
        transition: none;
    }
}
</style>
