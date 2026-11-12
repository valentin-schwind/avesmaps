<script setup lang="ts">
import { computed } from "vue";
import type { FreigabeSicht } from "@avesmaps3d/shared";
import { locale, t } from "../i18n/i18n";
import { kurzStand, zeitpunkt, type StationStand } from "./freigabe";
import { erhalteneReleases } from "./umgebungen-leiste";

/**
 * Unter der Leiste auf Production: die erhaltenen Releases (WI-0248; Vali: „auf production eine zusammenfassung erhaltener releases“).
 *
 * 🔴 Production weiß wenig über sich. Den Stand, der gerade läuft, kennt sie (`RELEASE_ID`, samt Schnittzeit). Frühere Auslieferungen stehen im
 * Vorgangskanal, und der liegt auf der Stage; die Production-Datenbank führt ihn nicht. Kennt die Sicht trotzdem welche, stehen sie hier;
 * sonst sagt die Ansicht ehrlich, dass sie nicht bekannt sind, und nennt, wo sie stehen.
 */
const props = defineProps<{
    sicht: FreigabeSicht | null;
    stand: StationStand;
    /** Seit wann beziehungsweise von wann der Stand ist, schon in der Sprache der Seite; ein Strich, wenn unbekannt. */
    zeit: string;
}>();

const liste = computed(() => erhalteneReleases(props.sicht));
const zeitText = (iso: string | null): string => zeitpunkt(iso, locale.value);
/** Eine Freigabe ohne Nachweis trägt die Kennung `?`: Dort ist der Stand nicht bekannt. */
const standText = (release: string): string => (release === "?" ? "–" : kurzStand(release));
const aktuell = computed(() => {
    if (props.stand.stand === null) return t("admin.umgebungen.erhalten.aktuellOhne");
    const satz = t("admin.umgebungen.erhalten.aktuell", { stand: props.stand.stand });
    return props.zeit === "–" ? satz : `${satz} ${props.zeit}`;
});
</script>

<template>
    <section class="erhalten" data-testid="umgebungen-erhalten">
        <h4 class="ueberschrift">{{ t("admin.umgebungen.erhalten.titel") }}</h4>
        <p class="satz" data-testid="umgebungen-erhalten-aktuell">{{ aktuell }}</p>
        <ul v-if="liste.length > 0" class="liste" data-testid="umgebungen-erhalten-liste">
            <li v-for="lauf in liste" :key="lauf.ops ?? lauf.at" class="liste__zeile">
                <span class="liste__stand">{{ standText(lauf.release) }}</span>
                <span class="satz">{{ zeitText(lauf.at) }}</span>
                <span class="satz">{{ [lauf.ops, lauf.wer].filter((teil) => teil !== null).join(" · ") }}</span>
            </li>
        </ul>
        <p v-else class="satz satz--leise" data-testid="umgebungen-erhalten-unbekannt">
            {{ t("admin.umgebungen.erhalten.unbekannt") }}
        </p>
    </section>
</template>

<style scoped>
.erhalten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-16);
}

.ueberschrift {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-bold);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--leise {
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.liste__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-12);
    padding: var(--space-6) 0;
    border-top: 1px solid var(--color-divider);
}

.liste__stand {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}
</style>
