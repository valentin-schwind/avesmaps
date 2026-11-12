<script setup lang="ts">
import { t } from "../i18n/i18n";
import type { LinkLine } from "./catalog-link-model";

/**
 * Die Links eines Eintrags im Verzeichnis (WI-0118; Legacy `advRowLinkMarkup`, Mirror `cbe278210`): ein Anker je Fundstelle, benannt nach
 * dem Ziel („Wiki Aventurica“, „F-Shop“), dahinter - nur bei einem bekannten JA - „(kostenpflichtig)“.
 *
 * 🔴 Jeder Link führt aus Avesmaps hinaus und trägt das ↗; es kommt aus der Hausregel `a[target="_blank"]::after` (`styles/canon.css`,
 * WI-0107), nie von Hand. `rel="noopener noreferrer"`: Das Ziel erfährt weder das Fenster noch die Herkunft. Ein Prüfzustand der Links
 * (online, offline) steht bewusst nicht da.
 *
 * Ohne Link steht - wenn das Fenster es will - ein leiser Satz („keine Fundstelle“), nie eine leere Spalte.
 */
defineProps<{ links: readonly LinkLine[]; empty?: string | undefined }>();
</script>

<template>
    <ul v-if="links.length > 0" class="links" data-testid="catalog-links">
        <li v-for="link in links" :key="link.url" class="links__zeile">
            <a
                class="links__anker"
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="link.url"
                data-testid="catalog-link"
                >{{ link.label }}</a
            >
            <span v-if="link.paid" class="links__hinweis" data-testid="catalog-link-paid"
                >({{ t("catalog.link.paid") }})</span
            >
        </li>
    </ul>
    <span v-else-if="empty !== undefined" class="links__leer" data-testid="catalog-links-empty">{{ empty }}</span>
</template>

<style scoped>
.links {
    margin: 0;
    padding: 0;
    list-style: none;
}

.links__zeile {
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.links__anker {
    color: var(--color-link);
    text-decoration: none;
}

.links__anker:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.links__anker:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.links__hinweis,
.links__leer {
    color: var(--color-text-muted);
}

/* Der Pfeil der Hausregel hängt am Anker; das Wort dahinter steht mit einem Atemzug Abstand, nicht an ihm. */
.links__hinweis {
    margin-left: var(--space-2);
}

.links__leer {
    font-size: var(--font-size-caption);
}
</style>
