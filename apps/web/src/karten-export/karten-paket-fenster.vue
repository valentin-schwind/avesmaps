<script setup lang="ts">
/**
 * Was die Person sieht, die einen Token-Link bekommt (WI-0280, `/paket#<token>`): die Karten, ein großer Knopf, wie lange der Link gilt, die Nennung samt Lizenz. Für Besucher
 * einladend und ruhig, ohne Anrede. Das Token geht nur im Kopf der Anfrage; der Download trägt ein kurzlebiges Ticket.
 */
import { computed, onMounted, reactive, ref } from "vue";
import type { KartenPaketSicht } from "@avesmaps3d/shared";
import { groesseText, kartenName, oeffnePaket, speichere, vorschauVon } from "./karten-export";
import { ApiFailure } from "../auth/api";
import AvmFenster from "../fenster/avm-fenster.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";

const props = defineProps<{ token: string | null }>();
const offen = defineModel<boolean>("offen", { required: true });

const sicht = ref<KartenPaketSicht | null>(null);
const zustand = ref<"laedt" | "da" | "weg" | "fehler">("laedt");
const bilder = reactive<Record<string, string | null>>({});
const TAG_MS = 86_400_000;

async function lade(): Promise<void> {
    zustand.value = "laedt";
    if (props.token === null) {
        zustand.value = "weg";
        return;
    }
    try {
        sicht.value = await oeffnePaket(props.token);
        zustand.value = "da";
        for (const karte of sicht.value.karten) {
            if (karte.art === "png") void vorschauVon(karte.id).then((adresse) => (bilder[karte.id] = adresse));
        }
    } catch (error) {
        zustand.value = error instanceof ApiFailure && error.status === 410 ? "weg" : "fehler";
    }
}

onMounted(() => void lade());

const frist = computed(() => {
    if (sicht.value === null) return "";
    const rest = Math.ceil((new Date(sicht.value.laeuftAb).getTime() - Date.now()) / TAG_MS);
    return rest <= 1 ? t("kartenPaket.fristTag") : t("kartenPaket.frist", { n: rest });
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="entscheiden"
        :titel="zustand === 'weg' ? t('kartenPaket.weg.titel') : t('kartenPaket.titel')"
        testid="karten-paket-fenster"
    >
        <div class="paket">
            <p v-if="zustand === 'laedt'" class="paket__satz">{{ t("kartenPaket.laedt") }}</p>
            <p v-else-if="zustand === 'weg'" class="paket__satz" data-testid="karten-paket-weg">
                {{ t("kartenPaket.weg.text") }}
            </p>
            <template v-else-if="zustand === 'fehler'">
                <p class="paket__satz" role="alert">{{ t("kartenPaket.ladeFehler") }}</p>
                <AvmKnopf testid="karten-paket-erneut" @click="lade">{{ t("kartenExport.erneut") }}</AvmKnopf>
            </template>
            <template v-else-if="sicht">
                <ul class="paket__liste">
                    <li v-for="karte in sicht.karten" :key="karte.id" :data-testid="`karten-paket-${karte.id}`">
                        <img v-if="bilder[karte.id]" class="paket__bild" :src="bilder[karte.id]!" alt="" />
                        <span v-else class="paket__bild paket__bild--zeichen" aria-hidden="true">
                            <svg
                                v-if="karte.art === 'svg'"
                                width="28"
                                height="22"
                                viewBox="0 0 28 22"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.3"
                                stroke-linecap="round"
                            >
                                <path d="M2 17C7 5 10 16 14 10s7-7 12-5" />
                                <circle cx="2" cy="17" r="1.6" fill="currentColor" />
                                <circle cx="14" cy="10" r="1.6" fill="currentColor" />
                                <circle cx="26" cy="5" r="1.6" fill="currentColor" />
                            </svg>
                        </span>
                        <span>{{ kartenName(karte) }}</span>
                        <span class="paket__zahl">{{ groesseText(karte.bytes ?? 0) }}</span>
                    </li>
                </ul>
                <AvmKnopf
                    art="gefuellt"
                    breit
                    class="paket__knopf"
                    testid="karten-paket-laden"
                    @click="speichere(sicht.datei)"
                >
                    <span aria-hidden="true">⇩ </span
                    >{{ t("kartenPaket.laden", { groesse: groesseText(sicht.bytes) }) }}
                </AvmKnopf>
                <p class="paket__frist">{{ frist }}</p>
                <div class="paket__nennung">
                    <img class="paket__logo" src="/img/dsa-fanprojekt-logo.webp" :alt="t('kartenPaket.logoAlt')" />
                    <div>
                        <span v-for="zeile in sicht.nennung" :key="zeile">{{ zeile }}. </span>
                        {{ t("kartenPaket.hinweis") }}
                        <span class="paket__adresse">{{ sicht.lizenz.uri }}</span>
                    </div>
                </div>
            </template>
        </div>
    </AvmFenster>
</template>

<style scoped>
.paket {
    display: grid;
    gap: var(--space-12);
}

.paket__satz {
    margin: 0;
    font-size: var(--font-size-reading);
    line-height: var(--leading-normal);
}

.paket__liste {
    display: grid;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.paket__liste li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-8);
    align-items: center;
    font-size: var(--font-size-reading);
}

.paket__bild {
    display: block;
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    object-fit: cover;
}

.paket__bild--zeichen {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
}

.paket__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    font-variant-numeric: tabular-nums;
}

.paket__knopf :deep(.knopf) {
    min-height: calc(var(--avm-control-h) + var(--space-12));
    font-size: var(--font-size-reading);
}

.paket__frist {
    margin: 0;
    color: var(--color-text-muted);
    text-align: center;
}

.paket__nennung {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-8);
    align-items: center;
    padding-top: var(--space-12);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.paket__logo {
    display: block;
    width: calc(var(--space-24) * 3);
    height: auto;
}

.paket__adresse {
    overflow-wrap: anywhere;
}
</style>
