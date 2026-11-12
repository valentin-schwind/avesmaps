<script setup lang="ts">
/**
 * Der Ablauf von Hochladen und Zerlegen (WI-0220 Schnitt 3; Vorlage Fassung 4): Hochladen · Prüfen · Warten in der Warteschlange ·
 * Zerlegen · Umschalten, je mit ○ ◐ ● (Kreis in jeder Liste, Editor-Stilregeln), darunter der Balken und eine Zeile. Beim Hochladen
 * lässt es sich anhalten und fortsetzen; einen gescheiterten Auftrag nennt die Fehlerzeile.
 */
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { label } from "../auth/verwaltung-text";
import { ABLAUF_SCHRITTE, type AblaufSicht } from "./kartenserien";

defineProps<{
    titel: string;
    sicht: AblaufSicht;
    fuss: string;
    /** Gerade wird hochgeladen (dann gibt es Anhalten); angehalten (dann Fortsetzen, sofern die Datei noch da ist). */
    hochladen?: "laeuft" | "angehalten" | undefined;
    testid: string;
}>();
const emit = defineEmits<{ anhalten: []; fortsetzen: [] }>();
const zeichen = (i: number, schritt: number) => (i < schritt ? "●" : i === schritt ? "◐" : "○");
</script>

<template>
    <FensterKarte :titel="titel" :data-testid="testid">
        <ol class="ablauf">
            <li
                v-for="(name, i) in ABLAUF_SCHRITTE"
                :key="name"
                class="ablauf__schritt"
                :class="{ 'ablauf__schritt--fertig': i < sicht.schritt, 'ablauf__schritt--jetzt': i === sicht.schritt }"
                :data-testid="`${testid}-schritt-${name}`"
            >
                <span class="ablauf__kreis" aria-hidden="true">{{ zeichen(i, sicht.schritt) }}</span>
                <span>{{ label("admin.kartenserien.ablauf.schritt", name) }}</span>
            </li>
        </ol>
        <div
            class="ablauf__balken"
            role="progressbar"
            :aria-valuenow="sicht.prozent"
            aria-valuemin="0"
            aria-valuemax="100"
            :data-testid="`${testid}-balken`"
        >
            <i :style="{ width: `${sicht.prozent}%` }"></i>
        </div>
        <p v-if="sicht.zeile !== ''" class="ablauf__leise" :data-testid="`${testid}-zeile`">{{ sicht.zeile }}</p>
        <p v-if="sicht.fehler !== null" class="ablauf__fehler" :data-testid="`${testid}-fehler`">{{ sicht.fehler }}</p>
        <div v-if="hochladen !== undefined" class="ablauf__knoepfe">
            <AvmKnopf v-if="hochladen === 'laeuft'" :testid="`${testid}-anhalten`" @click="emit('anhalten')">{{
                t("admin.kartenserien.ablauf.anhalten")
            }}</AvmKnopf>
            <AvmKnopf v-else :testid="`${testid}-fortsetzen`" @click="emit('fortsetzen')">{{
                t("admin.kartenserien.ablauf.fortsetzen")
            }}</AvmKnopf>
        </div>
        <span class="ablauf__leise">{{ fuss }}</span>
    </FensterKarte>
</template>

<style scoped>
.ablauf {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-8);
    padding: 0;
    list-style: none;
}

.ablauf__schritt {
    display: flex;
    gap: var(--space-6);
    align-items: baseline;
    color: var(--color-text-muted);
}

.ablauf__schritt--fertig,
.ablauf__schritt--jetzt {
    color: var(--color-text);
}

.ablauf__kreis {
    color: var(--color-accent-strong);
}

.ablauf__balken {
    height: 6px;
    border-radius: 3px;
    background: var(--color-panel-muted);
    overflow: hidden;
}

.ablauf__balken i {
    display: block;
    height: 100%;
    background: var(--color-accent-strong);
    transition: width 0.4s ease;
}

.ablauf__leise {
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ablauf__fehler {
    margin: var(--space-4) 0 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.ablauf__knoepfe {
    display: flex;
    gap: var(--space-6);
    margin-top: var(--space-6);
}
</style>
