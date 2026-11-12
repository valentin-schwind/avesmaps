<script setup lang="ts">
import type { MailAnhang } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { anhangAdressen, anhangGrundSatz, anhangZeichen, groesseSatz } from "./mail-ansicht-modell";

/**
 * Die Anhänge einer eingehenden Mail unter ihrer Nachricht (WI-0268 C6b; Bedienkonzept §3.2): das Zeichen der Art, der Name, die Größe, „Ansehen“ (Bild, PDF) und „Herunterladen“. Ein Anhang ohne Datei steht
 * gestrichelt da, mit dem Grund („Dateityp gesperrt, nicht übernommen“, „über der Grenze …“); Name und Größe bleiben. Am Telefon steht der Name in voller Breite, die Verweise darunter.
 *
 * Die Verweise gehen an die Route der Anhänge (`read_mailbox`): Der Browser lädt mit den Cookies der Redaktion, die Datei kommt als Download oder, bei Bild und PDF, zum Ansehen in einem neuen Tab.
 */
defineProps<{
    nummer: string;
    anhaenge: readonly MailAnhang[];
    testid?: string | undefined;
}>();
</script>

<template>
    <ul class="anhaenge" :aria-label="t('community.mails.anhang.liste')" :data-testid="testid ?? 'community-anhaenge'">
        <li
            v-for="anhang in anhaenge"
            :key="anhang.id"
            class="anhang"
            :class="{ 'anhang--ohne': anhangGrundSatz(anhang.grund) !== undefined }"
            :data-testid="`${testid ?? 'community-anhaenge'}-${String(anhang.id)}`"
        >
            <span class="anhang__zeichen" aria-hidden="true">{{ anhangZeichen(anhang) }}</span>
            <span class="anhang__name">{{ anhang.name }}</span>
            <span class="anhang__meta">{{ groesseSatz(anhang.groesse) }}</span>
            <span
                v-if="anhangGrundSatz(anhang.grund) !== undefined"
                class="anhang__grund"
                :data-testid="`${testid ?? 'community-anhaenge'}-${String(anhang.id)}-grund`"
                >{{ anhangGrundSatz(anhang.grund) }}</span
            >
            <span v-else class="anhang__verweise">
                <a
                    v-if="anhangAdressen(nummer, anhang).ansehen !== undefined"
                    class="verweis"
                    :href="anhangAdressen(nummer, anhang).ansehen"
                    target="_blank"
                    rel="noopener noreferrer"
                    :data-testid="`${testid ?? 'community-anhaenge'}-${String(anhang.id)}-ansehen`"
                    >{{ t("community.mails.anhang.ansehen") }}</a
                >
                <a
                    class="verweis"
                    :href="anhangAdressen(nummer, anhang).laden"
                    download
                    :data-testid="`${testid ?? 'community-anhaenge'}-${String(anhang.id)}-laden`"
                    >{{ t("community.mails.anhang.laden") }}</a
                >
            </span>
        </li>
    </ul>
</template>

<style scoped>
.anhaenge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.anhang {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    font-size: var(--font-size-small);
}

/* Ein Anhang ohne Datei: gestrichelt und leise, damit er nicht für etwas gehalten wird, das sich öffnen lässt. */
.anhang--ohne {
    border-style: dashed;
    background: transparent;
    color: var(--color-text-muted);
}

.anhang__zeichen {
    color: var(--color-text-muted);
}

.anhang__name {
    min-width: 0;
    flex: 1 1 12rem;
    overflow-wrap: anywhere;
}

.anhang__meta,
.anhang__grund {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.anhang__verweise {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
}

/* Am Telefon steht der Name in voller Breite, die Verweise darunter. */
@media (max-width: 520px) {
    .anhang__name {
        flex-basis: 100%;
    }
}

.verweis {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: underline;
    transition: color 120ms ease;
}

.verweis:hover,
.verweis:active {
    color: var(--color-link-hover);
}

.verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .verweis {
        transition: none;
    }
}
</style>
