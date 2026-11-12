<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { authState } from "../auth/session-state";
import { useBenachrichtigungen } from "../auth/benachrichtigungen";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { medienOffen, oeffneReisebilder, reisebilderStand } from "../medien/medien-oeffnen";
import {
    STAPEL_RECHT,
    faecher,
    faecherWeite,
    ladeStapelNeu,
    stapelSignatur,
    stapelZeigen,
    stapelZustand,
} from "./photobox-stapel-modell";

/**
 * Der Stapel neuer Reisebilder oben in Community › Meldungen (WI-0272 S3, Aufgabe 19): ein ruhiger Fächer der Vorschaubilder, die Zahl und der Verweis „In der Medienverwaltung prüfen“, der die
 * Medienverwaltung im Korb „PhotoBox-Uploads“, Unterteilung Offen, öffnet. Zwei Zeilen, kompakt; ohne `view_media_private` und bei `offen = 0` rendert das Bauteil nichts.
 *
 * - Die Zahl wird beim Öffnen des Reiters geladen (Einhängen, und wenn das Panel wieder zu sehen ist) und aufgefrischt, wenn sich in der Glocke für die Reisebilder etwas ändert. Keine eigene
 *   Abfrageschleife: Die Glocke fragt ohnehin im Takt nach.
 * - 🔴 **Nach der Prüfung nicht von gestern** (Review S3 I3): Das Panel steht während der Medienverwaltung unverändert da (kein Wechsel von `sichtbar`), und die Glocke meldet nur Neues. Darum lädt der
 *   Stapel auch neu, wenn die Medienverwaltung zugeht, und nach jeder Operation an einer Reisebild-Einreichung (`reisebilderStand`).
 * - Die Vorschauen sind Zierde (`alt=""`): Der Satz daneben sagt, was sie sind. Sie kommen über den privaten Weg der Medienverwaltung, nie öffentlich.
 */
const props = defineProps<{
    /** Das Panel ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Zahl nicht von gestern ist. */
    sichtbar?: boolean | undefined;
}>();

const glocke = useBenachrichtigungen();
const stapel = stapelZustand.stapel;
const darf = computed(() => authState.value.capabilities.includes(STAPEL_RECHT));
const zeigen = computed(() => stapelZeigen(authState.value.capabilities, stapel.value));
const bilder = computed(() => faecher(stapel.value?.vorschau ?? []));
const zahl = computed(() => {
    const offen = stapel.value?.offen ?? 0;
    return tPlural("photobox.stapel.zahl", offen, { n: formatNumber(offen, 0) });
});

/** Der Stand der Glocke, bei dem zuletzt geladen wurde: Nur eine Änderung der Reisebilder lädt noch einmal. */
let geladenBei = stapelSignatur(glocke.liste.value?.eintraege);
function lade(): void {
    if (!darf.value) return;
    geladenBei = stapelSignatur(glocke.liste.value?.eintraege);
    void ladeStapelNeu();
}

onMounted(lade);
watch(
    () => props.sichtbar,
    (an) => {
        if (an === true) lade();
    },
);
// Die Medienverwaltung ging zu, oder die Redaktion hat ein Reisebild erledigt: Der Stapel zählt neu.
watch(medienOffen, (offen, vorher) => {
    if (vorher && !offen) lade();
});
watch(reisebilderStand, lade);
watch(
    () => stapelSignatur(glocke.liste.value?.eintraege),
    (jetzt) => {
        if (jetzt !== geladenBei) lade();
    },
);
</script>

<template>
    <section v-if="zeigen" class="stapel" :aria-label="t('photobox.stapel.bezeichnung')" data-testid="photobox-stapel">
        <div class="stapel__zeile">
            <span
                v-if="bilder.length > 0"
                class="stapel__bilder"
                :style="{ '--stapel-weite': faecherWeite(bilder) }"
                aria-hidden="true"
                data-testid="photobox-stapel-bilder"
            >
                <img
                    v-for="bild in bilder"
                    :key="bild.publicId"
                    class="stapel__bild"
                    :src="bild.url"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                    :style="{ '--drehung': `${bild.drehung}deg`, '--versatz': bild.versatz, zIndex: bild.ebene }"
                />
            </span>
            <span class="stapel__zahl" data-testid="photobox-stapel-zahl">{{ zahl }}</span>
        </div>
        <button
            type="button"
            class="stapel__pruefen"
            data-testid="photobox-stapel-pruefen"
            @click="oeffneReisebilder()"
        >
            <span aria-hidden="true">→ </span>{{ t("photobox.stapel.pruefen") }}
        </button>
    </section>
</template>

<style scoped>
/* Zwei ruhige Zeilen über der Liste, im Stil der Listenzeilen (Trennlinie unten, keine Farbbalken). */
.stapel {
    --stapel-breite: 3.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--color-divider);
}

.stapel__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
}

/* Der Fächer: Die Bilder liegen übereinander, jedes um einen Teil seiner Breite weiter rechts, leicht gedreht um die Mitte. */
.stapel__bilder {
    position: relative;
    flex: none;
    width: calc(var(--stapel-breite) * var(--stapel-weite, 1));
    height: calc(var(--stapel-breite) * 0.75 + var(--space-4));
}

.stapel__bild {
    position: absolute;
    top: 50%;
    left: calc(var(--stapel-breite) * var(--versatz, 0));
    box-sizing: border-box;
    width: var(--stapel-breite);
    height: calc(var(--stapel-breite) * 0.75);
    border: 2px solid var(--color-panel);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-panel);
    object-fit: cover;
    transform: translateY(-50%) rotate(var(--drehung, 0deg));
    transform-origin: center bottom;
    background: var(--color-divider);
}

.stapel__zahl {
    min-width: 0;
    color: var(--color-text-strong);
}

.stapel__pruefen {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        color 120ms ease,
        background-color 120ms ease;
}

.stapel__pruefen:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.stapel__pruefen:active {
    border-radius: var(--radius-sm);
    background: var(--color-active-wash);
    color: var(--color-link-hover);
}

.stapel__pruefen:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .stapel__pruefen {
        transition: none;
    }
}
</style>
