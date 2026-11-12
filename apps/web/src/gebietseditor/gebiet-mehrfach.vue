<script setup lang="ts">
import { computed, ref } from "vue";
import type { EditorTerritoryDetailField, EditorTerritoryRow, TerritoryRetireBody } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import { ueberAlle, type Ueber } from "../fenster/sammel";
import ZoomSpanne from "../fenster/zoomspanne.vue";
import { formatNumber, t } from "../i18n/i18n";
import { DETAIL_KAESTEN } from "./gebiet-detailfelder";
import GebietFarbfeld from "./gebiet-farbfeld.vue";
import GebietMehrfachEntfernen from "./gebiet-mehrfach-entfernen.vue";
import GebietMehrfachWiki from "./gebiet-mehrfach-wiki.vue";
import GebietObergebiet from "./gebiet-obergebiet.vue";
import type { GebietSammel, GebietSammelFelder } from "./gebiet-sammel";
import GebietUmhaengen from "./gebiet-umhaengen.vue";

/**
 * Die Eigenschaften mehrerer Herrschaftsgebiete (EDIT-0003 T57; Fassung 5, Betreiber 2026-10-19: „perfekt genau das wollen wir“;
 * Probierseite https://claude.ai/artifact/HhKu7U5yJamSVeq7unPa9L) in den Kästen der Eigenschaften (`gebiet-eigenschaften.vue`).
 *
 * - **Gemeinsam:** Art und Status (Textfelder), das Obergebiet („Umhängen …“, dazu „Unter neues Obergebiet …“), Farbe und
 *   Zoomspanne, ↺ der Wiki-Felder. Ein Feld
 *   steht mit dem Wert aller oder „gemischt“ da und überschreibt erst, wenn man es ändert; dann steht „gilt für alle n“ daran.
 * - **Nur einzeln:** Name, Kurzname und Hauptstadt stehen gesperrt da; das gesperrte Feld nennt „Nur einzeln“ selbst.
 * - Geschrieben wird mit „Fertig“ in der Leiste, EINE Operation für alle (`gebiet-sammel.ts`). „Entfernen …“ schreibt sofort, wie am
 *   einzelnen, und geht erst, wenn nichts ungeschrieben ist.
 */
const props = defineProps<{
    sammel: GebietSammel;
    /** Die Gebiete der Liste: die gewählten darin, und die Ziele für „Umhängen“. */
    zeilen: readonly EditorTerritoryRow[];
    kennung: string;
    /** Darf entfernen (Rechte wie am einzelnen); ohne gibt es den Knopf nicht. */
    entfernen?: boolean | undefined;
    /** Darf diese Sitzung Obergebiet und Zoomspanne ändern? Beide zählen zur Form (WI-0279, E2a); ohne das Recht stehen sie still da. */
    formFrei?: boolean | undefined;
}>();

const nachId = computed(() => new Map(props.zeilen.map((zeile) => [zeile.id, zeile])));
const gewaehlte = computed(() =>
    props.sammel.ids.map((id) => nachId.value.get(id)).filter((z): z is EditorTerritoryRow => z !== undefined),
);
const n = computed(() => props.sammel.ids.length);
const gelesen = computed(() => props.sammel.gelesen.value);
const felder = computed(() => props.sammel.stand.value.felder);
const laedt = computed(() =>
    props.sammel.grenze !== undefined
        ? props.sammel.grenze
        : gelesen.value === undefined
          ? props.sammel.lesefehler.value
              ? t("gebietseditor.sammel.lesefehler")
              : t("gebietseditor.sammel.laedt")
          : undefined,
);
const gemischt = t("fenster.sammel.gemischt");

// --- Kopf: die gewählten als Streifen ---
const STREIFEN = 6;
const streifen = computed(() => gewaehlte.value.slice(0, STREIFEN).map((z) => z.name));

// --- Textfelder: der Wert aller, sonst leer mit „gemischt“ als Platzhalter ---
type TextFeld = "type" | "status";
const ueber = computed((): Record<TextFeld | "name", Ueber<string>> => ({
    name: ueberAlle(gewaehlte.value, (z) => z.name),
    type: ueberAlle(gewaehlte.value, (z) => z.type ?? ""),
    status:
        gelesen.value === undefined ? { gleich: false } : ueberAlle(gelesen.value.territories, (g) => g.status ?? ""),
}));
function textWert(feld: TextFeld | "name"): string {
    if (feld !== "name" && felder.value[feld] !== undefined) return felder.value[feld]!;
    const u = ueber.value[feld];
    return u.gleich ? u.wert : "";
}
function platzhalter(feld: TextFeld | "name"): string | undefined {
    if (feld !== "name" && felder.value[feld] !== undefined) return undefined;
    return ueber.value[feld].gleich ? undefined : gemischt;
}
function setze<K extends keyof GebietSammelFelder>(feld: K, wert: GebietSammelFelder[K]): void {
    props.sammel.setze(feld, wert);
}

// --- Wiki-Felder: der Wert aller oder gemischt, ↺ für alle (`gebiet-mehrfach-wiki.vue`) ---
const wikiFelder = (kasten: keyof typeof DETAIL_KAESTEN): readonly EditorTerritoryDetailField[] =>
    gelesen.value === undefined ? [] : DETAIL_KAESTEN[kasten];
/** Die Kästen vor der Darstellung, die nur Wiki-Felder tragen (wie in den Eigenschaften; „Wiki und Quellen“ steht danach). */
const NUR_WIKI = [
    { id: "landUndLeute", titel: "gebietseditor.abschnitt.landUndLeute" },
    { id: "zeit", titel: "gebietseditor.abschnitt.zeit" },
] as const;

// --- Im Baum: EIN Obergebiet für alle ---
const obergebiet = computed(() => ueberAlle(gewaehlte.value, (z) => z.parent ?? ""));
const obergebietWert = computed((): { id: string; name: string } | undefined => {
    const neu = felder.value.parent;
    if (neu !== undefined) return neu ?? undefined;
    const u = obergebiet.value;
    if (!u.gleich || u.wert === "") return undefined;
    return { id: u.wert, name: nachId.value.get(u.wert)?.name ?? "" };
});

// --- „Unter neues Obergebiet …“ (T57, A): sofort geschrieben, erst ohne Ungeschriebenes ---
const oberOffen = ref(false);
const oberSendet = ref(false);
const oberSatz = ref<string | undefined>(undefined);
const oberGesperrt = computed(() =>
    oberSendet.value
        ? t("gebietseditor.entfernen.sendet")
        : props.sammel.lage.value.aktiv
          ? t("gebietseditor.entfernen.erstFertig")
          : laedt.value,
);
async function obergebietAnlegen(daten: {
    name: string;
    parent: string | undefined;
    color: string;
    zoom: { minZoom: number; maxZoom: number };
}): Promise<void> {
    if (oberSendet.value) return;
    oberSendet.value = true;
    oberSatz.value = undefined;
    const antwort = await props.sammel.obergebiet({
        ...(daten.name === "" ? {} : { name: daten.name }),
        ...(daten.parent === undefined ? {} : { parent: daten.parent }),
        color: daten.color,
        zoom: daten.zoom,
    });
    oberSendet.value = false;
    if (antwort.ok) oberOffen.value = false;
    else oberSatz.value = antwort.satz;
}

// --- „Entfernen …“ für alle: sofort geschrieben, erst ohne Ungeschriebenes ---
const entfernenOffen = ref(false);
const entfernenSendet = ref(false);
const entfernenSatz = ref<string | undefined>(undefined);
const entfernenGesperrt = computed(() =>
    entfernenSendet.value
        ? t("gebietseditor.entfernen.sendet")
        : props.sammel.lage.value.aktiv
          ? t("gebietseditor.entfernen.erstFertig")
          : laedt.value,
);
async function entferne(stage: TerritoryRetireBody["stage"]): Promise<void> {
    if (entfernenSendet.value) return;
    entfernenSendet.value = true;
    entfernenSatz.value = undefined;
    const antwort = await props.sammel.entferne(stage);
    entfernenSendet.value = false;
    if (antwort.ok) entfernenOffen.value = false;
    else entfernenSatz.value = antwort.satz;
}

// --- Darstellung: Farbe und Zoomspanne für alle ---
const farbe = computed(() => ueberAlle(gewaehlte.value, (z) => z.color.toLowerCase()));
const farbeJetzt = computed(() => felder.value.color ?? (farbe.value.gleich ? farbe.value.wert : undefined));
const spanne = computed(() =>
    ueberAlle(
        gewaehlte.value,
        (z) => ({ von: z.minZoom, bis: z.maxZoom }),
        (a, b) => a.von === b.von && a.bis === b.bis,
    ),
);
const spanneJetzt = computed(() => felder.value.zoom ?? (spanne.value.gleich ? spanne.value.wert : undefined));
const spanneText = computed(() => {
    const s = spanneJetzt.value;
    if (s === undefined) return gemischt;
    return t("gebietseditor.unter.spanne", { von: s.von ?? 0, bis: s.bis ?? 8 });
});
</script>

<template>
    <div class="mehrfach" :data-testid="`${kennung}-mehrfach`">
        <div class="mehrfach__kopf">
            <strong>{{ t("gebietseditor.sammel.gewaehlt", { n: formatNumber(n, 0) }) }}</strong>
            <div class="mehrfach__streifen" :data-testid="`${kennung}-mehrfach-streifen`">
                <span v-for="name in streifen" :key="name" class="einzeilig">{{ name }}</span>
                <span v-if="n > STREIFEN">{{
                    t("gebietseditor.sammel.weitere", { n: formatNumber(n - STREIFEN, 0) })
                }}</span>
            </div>
        </div>
        <p v-if="laedt" class="mehrfach__hinweis" role="status">{{ laedt }}</p>

        <section class="mehrfach__abschnitt">
            <h4 class="mehrfach__titel">{{ t("gebietseditor.abschnitt.identitaet") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.name") }}</dt>
                <dd>
                    <AvmEingabe
                        :model-value="textWert('name')"
                        :placeholder="platzhalter('name')"
                        :aria-label="t('gebietseditor.feld.name')"
                        :gesperrt="t('fenster.sammel.nurEinzeln')"
                        :testid="`${kennung}-mehrfach-name`"
                    />
                </dd>
                <dt>{{ t("gebietseditor.feld.kurzname") }}</dt>
                <dd>
                    <AvmEingabe
                        model-value=""
                        :aria-label="t('gebietseditor.feld.kurzname')"
                        :gesperrt="t('fenster.sammel.nurEinzeln')"
                    />
                </dd>
                <dt>{{ t("infoPanel.field.art") }}</dt>
                <dd>
                    <AvmEingabe
                        :model-value="textWert('type')"
                        :placeholder="platzhalter('type')"
                        :aria-label="t('infoPanel.field.art')"
                        :testid="`${kennung}-mehrfach-art`"
                        @update:model-value="(wert: string) => setze('type', wert)"
                    />
                    <SammelHinweis v-if="felder.type !== undefined" art="alle" :n="n" />
                </dd>
                <dt>{{ t("infoPanel.field.status") }}</dt>
                <dd>
                    <AvmEingabe
                        :model-value="textWert('status')"
                        :placeholder="platzhalter('status')"
                        :aria-label="t('infoPanel.field.status')"
                        :gesperrt="laedt"
                        :testid="`${kennung}-mehrfach-status`"
                        @update:model-value="(wert: string) => setze('status', wert)"
                    />
                    <SammelHinweis v-if="felder.status !== undefined" art="alle" :n="n" />
                </dd>
            </FensterFeldzeilen>
            <GebietMehrfachWiki :felder="wikiFelder('identitaet')" :sammel="sammel" :kennung="kennung" />
        </section>

        <section class="mehrfach__abschnitt">
            <h4 class="mehrfach__titel">{{ t("gebietseditor.abschnitt.imBaum") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.obergebiet") }}</dt>
                <dd v-if="!formFrei" :data-testid="`${kennung}-mehrfach-obergebiet`">
                    {{
                        obergebiet.gleich
                            ? (obergebietWert?.name ?? t("gebietseditor.obergebiet.keins"))
                            : t("fenster.sammel.gemischt")
                    }}
                </dd>
                <dd v-else :data-testid="`${kennung}-mehrfach-obergebiet`">
                    <GebietUmhaengen
                        :gebiet="gewaehlte[0] ?? { id: '', name: '' }"
                        :mehrere="gewaehlte"
                        :gemischt="felder.parent === undefined && !obergebiet.gleich"
                        :wert="obergebietWert"
                        :zeilen="zeilen"
                        :eigen="false"
                        :kennung="`${kennung}-mehrfach`"
                        @wahl="(neu) => setze('parent', neu ?? null)"
                    />
                    <SammelHinweis v-if="felder.parent !== undefined" art="alle" :n="n" />
                </dd>
            </FensterFeldzeilen>
            <GebietObergebiet
                v-if="oberOffen"
                :gewaehlte="gewaehlte"
                :zeilen="zeilen"
                :kennung="kennung"
                :gesperrt="oberGesperrt"
                @anlegen="obergebietAnlegen"
                @abbrechen="oberOffen = false"
            />
            <p v-else-if="formFrei" class="mehrfach__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="oberGesperrt"
                    :testid="`${kennung}-obergebiet-neu-oeffnen`"
                    @click="oberOffen = true"
                >
                    {{ t("gebietseditor.sammel.oberOeffnen") }}
                </AvmKnopf>
            </p>
            <p v-if="oberSatz" class="mehrfach__hinweis" role="alert">{{ oberSatz }}</p>
            <GebietMehrfachWiki :felder="wikiFelder('imBaum')" :sammel="sammel" :kennung="kennung" />
        </section>

        <section class="mehrfach__abschnitt">
            <h4 class="mehrfach__titel">{{ t("gebietseditor.abschnitt.herrschaft") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("infoPanel.field.capital") }}</dt>
                <dd>
                    <AvmEingabe
                        model-value=""
                        :aria-label="t('infoPanel.field.capital')"
                        :gesperrt="t('fenster.sammel.nurEinzeln')"
                    />
                </dd>
            </FensterFeldzeilen>
            <GebietMehrfachWiki :felder="wikiFelder('herrschaft')" :sammel="sammel" :kennung="kennung" />
        </section>

        <section v-for="kasten in NUR_WIKI" :key="kasten.id" class="mehrfach__abschnitt">
            <h4 class="mehrfach__titel">{{ t(kasten.titel) }}</h4>
            <p v-if="laedt" class="mehrfach__hinweis">{{ laedt }}</p>
            <GebietMehrfachWiki :felder="wikiFelder(kasten.id)" :sammel="sammel" :kennung="kennung" />
        </section>

        <section class="mehrfach__abschnitt">
            <h4 class="mehrfach__titel">{{ t("gebietseditor.abschnitt.darstellung") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.farbe") }}</dt>
                <dd>
                    <span class="mehrfach__reihe">
                        <GebietFarbfeld
                            :farbe="farbeJetzt ?? '#808080'"
                            :gemischt="farbeJetzt === undefined"
                            :wahl="t('gebietseditor.sammel.farbe', { n: formatNumber(n, 0) })"
                            :testid="`${kennung}-mehrfach-farbe-wahl`"
                            @farbe="(neu: string) => setze('color', neu)"
                        />
                        <span v-if="farbeJetzt" :data-testid="`${kennung}-mehrfach-farbe`">{{ farbeJetzt }}</span>
                        <span v-else class="mehrfach__gemischt" :data-testid="`${kennung}-mehrfach-farbe`">{{
                            gemischt
                        }}</span>
                    </span>
                    <SammelHinweis v-if="felder.color !== undefined" art="alle" :n="n" />
                </dd>
                <dt>{{ t("gebietseditor.feld.zoomspanne") }}</dt>
                <dd>
                    <span class="mehrfach__reihe">
                        <ZoomSpanne
                            v-if="formFrei"
                            class="mehrfach__spanne"
                            :von="spanneJetzt?.von"
                            :bis="spanneJetzt?.bis"
                            :vorgabe="spanneJetzt === undefined ? { von: 0, bis: 8 } : undefined"
                            paar
                            tippen
                            :name="t('gebietseditor.sammel.spanneName', { n: formatNumber(n, 0) })"
                            :testid="`${kennung}-mehrfach-spanne`"
                            @aendere="(neu) => setze('zoom', neu)"
                        />
                        <span
                            :class="{ mehrfach__gemischt: spanneJetzt === undefined }"
                            :data-testid="`${kennung}-mehrfach-spanne-text`"
                            >{{ spanneText }}</span
                        >
                    </span>
                    <SammelHinweis v-if="felder.zoom !== undefined" art="alle" :n="n" />
                </dd>
            </FensterFeldzeilen>
        </section>

        <section v-if="entfernen" class="mehrfach__abschnitt" :data-testid="`${kennung}-mehrfach-entfernen-abschnitt`">
            <GebietMehrfachEntfernen
                v-if="entfernenOffen"
                :gewaehlte="gewaehlte"
                :zeilen="zeilen"
                :kennung="kennung"
                :gesperrt="entfernenGesperrt"
                @entfernen="entferne"
                @abbrechen="entfernenOffen = false"
            />
            <AvmKnopf
                v-else
                art="gefahr"
                groesse="zeile"
                :gesperrt="entfernenGesperrt"
                :testid="`${kennung}-mehrfach-entfernen-oeffnen`"
                @click="entfernenOffen = true"
            >
                {{ t("gebietseditor.entfernen.oeffnen") }}
            </AvmKnopf>
            <p v-if="entfernenSatz" class="mehrfach__hinweis" role="alert">{{ entfernenSatz }}</p>
        </section>
    </div>
</template>

<style scoped>
.mehrfach {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.mehrfach__kopf {
    display: grid;
    gap: var(--space-4);
}

.mehrfach__kopf strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.mehrfach__streifen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    min-width: 0;
}

.mehrfach__streifen span {
    max-width: 100%;
    padding: 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-muted);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Wie die Abschnitte der Eigenschaften (`gebiet-eigenschaften.vue`), bis O3 sie in einen Baustein zieht. */
.mehrfach__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.mehrfach__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.mehrfach__reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    align-items: center;
}

.mehrfach__spanne {
    flex: 1 1 12rem;
    min-width: 9rem;
}

.mehrfach__gemischt {
    color: var(--color-placeholder);
    font-style: italic;
}

.mehrfach__knoepfe {
    margin: 0;
}

.mehrfach__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
