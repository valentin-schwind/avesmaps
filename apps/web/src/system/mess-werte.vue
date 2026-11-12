<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MESSWERTE_TAKT_MS, MESSWERTE_URL, type Messwerte } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { messeClient } from "./client-messung";

/**
 * Die Messwerte selbst (WI-0138 V15): oben wer gerade da ist, darunter der Server und dieser Browser.
 *
 * Dasselbe Bauteil steht **angedockt** im Reiter „Status“ und **gelöst** im Messfenster (Betreiber 2026-10-13: „die idee mit
 * dem andocken in status ist gut“). Angedockt ist es so breit wie das Panel; die beiden Seiten rutschen dann untereinander.
 *
 * - **Server und Browser getrennt**: Die Trennung ist der Punkt — ein hängendes Bild liegt fast nie am Server.
 * - **Unbekannt heißt unbekannt**: Die erste CPU-Zahl nach dem Start fehlt (sie ist eine Differenz), den Speicher kennt nur
 *   Chromium, und die Maschinenlast meldet Windows nicht. Überall steht dann „–“, nie eine erfundene Null.
 * - Der Takt ist zwei Sekunden und läuft nur, solange `aktiv` gilt.
 */
const props = withDefaults(defineProps<{ aktiv: boolean; zeigeOnline?: boolean }>(), { zeigeOnline: true });

const werte = ref<Messwerte | undefined>(undefined);
const fehler = ref(false);
const client = messeClient();
let timer: ReturnType<typeof setInterval> | undefined;

async function hole(): Promise<void> {
    try {
        const antwort = await fetch(MESSWERTE_URL, { cache: "no-store", headers: { accept: "application/json" } });
        if (!antwort.ok) throw new Error(String(antwort.status));
        werte.value = (await antwort.json()) as Messwerte;
        fehler.value = false;
    } catch {
        fehler.value = true;
    }
}

function starte(): void {
    if (timer !== undefined) return;
    void hole();
    timer = setInterval(() => void hole(), MESSWERTE_TAKT_MS);
}

function halte(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
}

onMounted(() => {
    if (props.aktiv) starte();
});
watch(
    () => props.aktiv,
    (jetztAktiv) => (jetztAktiv ? starte() : halte()),
);
onBeforeUnmount(() => {
    halte();
    client.halt();
});

/** Byte in MB oder GB, je nach Größe; `null` bleibt ein Strich. */
function speicherText(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return "–";
    if (bytes >= 1024 ** 3) return `${formatNumber(bytes / 1024 ** 3, 1)} GB`;
    return `${formatNumber(bytes / 1024 / 1024, 0)} MB`;
}

/**
 * Ein Anteil als Prozent. Unter zehn Prozent mit einer Nachkommastelle.
 *
 * 🔴 **Eine gemessene Kleinigkeit ist keine Null.** Ein ruhiger Server verbraucht 0,4 % einer Kernzeit; auf ganze
 * Prozent gerundet stand dort „0 %“ und behauptete Stillstand (Betreiber 2026-10-14, Production). Die Stelle hinter dem
 * Komma gibt es deshalb nur unterhalb eines Prozents — darüber wäre „7,0 %“ nur Unruhe. Dass gar nicht gemessen wurde,
 * sagt weiterhin der Strich; die beiden dürfen nie gleich aussehen.
 */
function anteilText(anteil: number | null | undefined): string {
    if (anteil === null || anteil === undefined) return "–";
    const prozent = anteil * 100;
    return `${formatNumber(prozent, prozent > 0 && prozent < 1 ? 1 : 0)} %`;
}

/** Wie lange der Serverprozess schon läuft; das Fenster trägt es als Zusatz im Kopf. */
const laufzeit = computed(() => {
    const sekunden = werte.value?.server.laeuftSeit;
    if (sekunden === undefined) return "–";
    if (sekunden < 3600) return t("messwerte.minuten", { zahl: String(Math.round(sekunden / 60)) });
    if (sekunden < 86_400) return t("messwerte.stunden", { zahl: formatNumber(sekunden / 3600, 1) });
    return t("messwerte.tage", { zahl: formatNumber(sekunden / 86_400, 1) });
});
defineExpose({ laufzeit });

const serverZeilen = computed(() => [
    { wort: t("messwerte.cpu"), wert: anteilText(werte.value?.server.cpu), hinweis: t("messwerte.cpuHinweis") },
    { wort: t("messwerte.rss"), wert: speicherText(werte.value?.server.rss), hinweis: t("messwerte.rssHinweis") },
    {
        wort: t("messwerte.ram"),
        wert:
            werte.value === undefined
                ? "–"
                : `${speicherText(werte.value.server.ramBelegt)} / ${speicherText(werte.value.server.ramGesamt)}`,
        hinweis: t("messwerte.ramHinweis"),
    },
    {
        wort: t("messwerte.last"),
        wert:
            werte.value?.server.last === null || werte.value === undefined ? "–" : anteilText(werte.value.server.last),
        hinweis: t("messwerte.lastHinweis", { kerne: String(werte.value?.server.kerne ?? 0) }),
    },
]);

const clientZeilen = computed(() => [
    {
        wort: t("messwerte.fps"),
        wert: client.fps.value === null ? "–" : String(client.fps.value),
        hinweis: t("messwerte.fpsHinweis"),
    },
    {
        wort: t("messwerte.hauptthread"),
        wert: anteilText(client.last.value),
        hinweis: t("messwerte.hauptthreadHinweis"),
    },
    {
        wort: t("messwerte.speicher"),
        wert:
            client.speicher.value === null
                ? "–"
                : `${speicherText(client.speicher.value)} / ${speicherText(client.speicherGrenze.value)}`,
        hinweis: t("messwerte.speicherHinweis"),
    },
]);
</script>

<template>
    <div class="mess">
        <p v-if="fehler" class="mess__satz">{{ t("messwerte.fehler") }}</p>

        <div v-if="props.zeigeOnline" class="mess__jetzt">
            <span class="mess__jetztWert">{{ formatNumber(werte?.jetzt.besucher ?? 0, 0) }}</span>
            <span class="mess__jetztWort">{{ t("messwerte.nutzer") }}</span>
            <span class="mess__jetztWert mess__jetztWert--sorte">{{
                formatNumber(werte?.jetzt.editoren ?? 0, 0)
            }}</span>
            <span class="mess__jetztWort">{{ t("messwerte.editoren") }}</span>
            <span class="mess__fenster">{{
                t("messwerte.fenster", { minuten: String(werte?.jetzt.fensterMinuten ?? 5) })
            }}</span>
        </div>

        <div class="mess__seiten">
            <section>
                <h3 class="mess__titel">{{ t("messwerte.server") }}</h3>
                <dl class="mess__liste">
                    <template v-for="zeile in serverZeilen" :key="zeile.wort">
                        <dt :title="zeile.hinweis">{{ zeile.wort }}</dt>
                        <dd>{{ zeile.wert }}</dd>
                    </template>
                </dl>
            </section>
            <section>
                <h3 class="mess__titel">{{ t("messwerte.client") }}</h3>
                <dl class="mess__liste">
                    <template v-for="zeile in clientZeilen" :key="zeile.wort">
                        <dt :title="zeile.hinweis">{{ zeile.wort }}</dt>
                        <dd>{{ zeile.wert }}</dd>
                    </template>
                </dl>
            </section>
        </div>
    </div>
</template>

<style scoped>
.mess {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.mess__satz {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-danger);
}

/* Wer gerade da ist, steht oben und groß: die Zahl, die man im Betrieb sucht. */
.mess__jetzt {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-6);
    padding-bottom: var(--space-8);
    border-bottom: 1px solid var(--color-divider);
}

.mess__jetztWert {
    font-size: var(--font-size-display);
    line-height: 1;
    color: var(--color-text-strong);
}

.mess__jetztWert--sorte {
    margin-left: var(--space-10);
    color: var(--color-chart2);
}

.mess__jetztWort {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.mess__fenster {
    margin-left: auto;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

/* Zwei Seiten nebeneinander, solange sie passen; im Panel (400 px) stehen sie untereinander. */
.mess__seiten {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: var(--space-10) var(--space-16);
}

.mess__titel {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--color-text-muted);
}

/* 🪤 Ohne Grenze stünde der Wert in einem breit gezogenen Fenster einen halben Bildschirm neben seinem Wort. */
.mess__liste {
    display: grid;
    max-width: var(--avm-fenster-lesespalte);
    grid-template-columns: 1fr auto;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    font-size: var(--font-size-small);
}

.mess__liste dt {
    color: var(--color-text-muted);
}

.mess__liste dd {
    margin: 0;
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}
</style>
