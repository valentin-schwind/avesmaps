<script setup lang="ts">
/** Der Reiter „API-Schlüssel“ (WI-0280): die Schlüssel und daneben der Vertrag, so wie ein Werkzeug ihn braucht. Die Kennungen stehen in `packages/shared/src/karten-export.ts`. */
import { computed, ref } from "vue";
import { KARTEN_API_URL, KARTEN_VERTRAG_FASSUNG, type KartenExportStand } from "@avesmaps3d/shared";
import type { KartenExportSicht } from "./karten-export";
import KartenZugaenge from "./karten-zugaenge.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";

const props = defineProps<{ sicht: KartenExportSicht; stand: KartenExportStand }>();
const emit = defineEmits<{ neu: [] }>();

const herkunft = globalThis.location?.origin ?? "";
const basis = `${herkunft}${KARTEN_API_URL}`;
const kennungen = computed(() => props.stand.karten.filter((k) => !k.id.startsWith("svg-eigen-")).map((k) => k.id));
const beispiel = computed(() =>
    [
        "curl --fail-with-body \\",
        '  -H "Authorization: Bearer $AVESMAPS_KEY" \\',
        "  -o karten.zip \\",
        `  "${basis}/paket.zip?ids=${kennungen.value.slice(0, 2).join(",")}"`,
    ].join("\n"),
);
const kopiert = ref(false);

async function kopiere(): Promise<void> {
    await navigator.clipboard.writeText(beispiel.value).catch(() => undefined);
    kopiert.value = true;
}
</script>

<template>
    <div class="api" data-testid="karten-api">
        <KartenZugaenge art="schluessel" :sicht="sicht" :stand="stand" @neu="emit('neu')" />
        <section
            class="vertrag"
            :aria-label="t('kartenExport.vertrag.titel', { n: KARTEN_VERTRAG_FASSUNG })"
            data-testid="karten-vertrag"
        >
            <h3 class="vertrag__titel">{{ t("kartenExport.vertrag.titel", { n: KARTEN_VERTRAG_FASSUNG }) }}</h3>
            <div class="vertrag__wege">
                <table>
                    <tbody>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.basis") }}</th>
                            <td>
                                <code>{{ basis }}</code>
                            </td>
                        </tr>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.anmeldung") }}</th>
                            <td>
                                <code>Authorization: Bearer avk_…</code> {{ t("kartenExport.vertrag.anmeldungText") }}
                            </td>
                        </tr>
                        <tr>
                            <th><code>GET /</code></th>
                            <td>{{ t("kartenExport.vertrag.liste") }}</td>
                        </tr>
                        <tr>
                            <th><code>GET /{id}.zip</code></th>
                            <td>{{ t("kartenExport.vertrag.eine") }}</td>
                        </tr>
                        <tr>
                            <th><code>GET /paket.zip?ids=…</code></th>
                            <td>{{ t("kartenExport.vertrag.mehrere") }}</td>
                        </tr>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.kennungen") }}</th>
                            <td>
                                <code>{{ kennungen.join(" · ") }}</code>
                                {{ t("kartenExport.vertrag.kennungenText") }}
                            </td>
                        </tr>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.antwort") }}</th>
                            <td>
                                <code>ETag</code>, <code>X-Avesmaps-SHA256</code>,
                                <code>X-Avesmaps-Kartenfassung</code>; <code>304</code> · <code>If-None-Match</code>;
                                <code>Range</code> {{ t("kartenExport.vertrag.antwortText") }}
                            </td>
                        </tr>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.imZip") }}</th>
                            <td>
                                {{ t("kartenExport.vertrag.imZipText") }}
                                <code>xmlns:avm="https://avesmaps.de/ns/export/1"</code>
                            </td>
                        </tr>
                        <tr>
                            <th>{{ t("kartenExport.vertrag.fehler") }}</th>
                            <td>
                                <code>401 unauthorized</code> · <code>403 not_in_scope</code> ·
                                <code>404 export_not_available</code> ·
                                <code>429 too_many_requests</code>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <pre data-testid="karten-vertrag-beispiel">{{ beispiel }}</pre>
            <AvmKnopf testid="karten-vertrag-kopieren" @click="kopiere">
                {{ kopiert ? t("ui.copy.done") : t("kartenExport.vertrag.kopieren") }}
            </AvmKnopf>
        </section>
    </div>
</template>

<style scoped>
.api {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: var(--space-16);
    align-items: start;
}

.vertrag {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.vertrag__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.vertrag__wege {
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-small);
}

th {
    padding: var(--space-2) var(--space-8) var(--space-2) 0;
    color: var(--color-text-muted);
    font-weight: normal;
    text-align: left;
    vertical-align: top;
    white-space: nowrap;
}

td {
    padding: var(--space-2) 0;
    vertical-align: top;
}

tr + tr th,
tr + tr td {
    border-top: 1px solid var(--color-divider);
}

code,
pre {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: var(--font-size-small);
}

pre {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    line-height: var(--leading-normal);
}

@media (max-width: 860px) {
    .api {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
