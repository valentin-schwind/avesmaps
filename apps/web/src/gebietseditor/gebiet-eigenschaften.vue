<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
    EditorTerritoryDetail,
    EditorTerritoryDetailField,
    EditorTerritoryFinding,
    EditorTerritoryPlace,
    EditorTerritoryRow,
    TerritoryRetireBody,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t } from "../i18n/i18n";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { felderAus, type GebietFelder } from "./gebiet-art";
import GebietFarbfeld from "./gebiet-farbfeld.vue";
import GebietHauptstadt from "./gebiet-hauptstadt.vue";
import GebietUmhaengen from "./gebiet-umhaengen.vue";
import GebietEntfernen from "./gebiet-entfernen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import ZoomSpanne from "../fenster/zoomspanne.vue";
import WikiBox from "../fenster/wiki-box.vue";
import GebietPruefen from "./gebiet-pruefen.vue";
import GebietSpannenFolgen from "./gebiet-spannen-folgen.vue";
import GebietWikiFelder from "./gebiet-wiki-felder.vue";
import { DETAIL_KAESTEN, DETAIL_NAMEN, gebietWikiBoxFelder } from "./gebiet-detailfelder";
import { artName } from "./gebiete-liste";
import type { GebietBearbeitung, GebietReiter } from "./gebietseditor-steuerung";
import type { Spanne, SpannenFolge } from "./zoombaender";

/**
 * Der Reiter „Eigenschaften“ des Gebietseditors, lesend (WI-0209 A3; Blatt „Herrschaftsgebiete“, Rückmeldung 2026-10-16: „schau ob du
 * alle felder hast“): alle Felder, die ein Gebiet bei uns trägt (`territory`, Migration 0055, und die Wiki-Texte aus `territory_detail`,
 * 0076), in den Kästen des Blatts: Identität, Im Baum, Herrschaft, Land und Leute, Zeit, Darstellung, Wiki, Ansprüche.
 *
 * - 🔴 **Wiki, Wappen und Quellen sind getrennt** (WI-0253, Betreiber 2026-10-26: „das bitte trennen in Wiki - Wappen gehören zu einem Bilder-Tab und
 *   Quellen in eine Quellen-Tab (wie bei Orten)“): Der Kasten „Wiki“ ist die Wiki-Box (`fenster/wiki-box.vue`: Artikel, Schlüssel, Wiki-Typ, Stand des Syncs,
 *   Zuweisen · Sync · Entfernen); das Wappen steht im Reiter „Bilder“ (`gebiet-bilder.vue`), die Quellen im Reiter „Quellen“ des Fensters. Die Zugehörigkeit
 *   (roh) steht im Kasten „Im Baum“, wo sie hingehört, wie am Ort jedes Wiki-Feld im Kasten seines Themas steht.
 *
 * - Die Namen der Wiki-Felder sind die des Infopanels (`infoPanel.field.*`): dasselbe Feld heißt überall gleich.
 * - ✎ am Wert: Legacy hat einen eigenen Wert gesetzt (`origin = override`); ↺ auf den Wiki-Wert kommt mit B2.
 * - **Hauptstadt und Herrschaftssitz** sind Orte. Die Hauptstadt wird mit B2 wählbar (Ortssuche), der Sitz bleibt nur lesend (EDIT-0005
 *   E1: Legacy hat für ihn keinen Schreibweg). Nennt das Wiki einen anderen Namen, steht er darunter.
 * - Die Deckkraft steht nur da (Frage 11): Die Karte zeigt alle Gebiete gleich.
 * - **Schreibbar** (B2), wenn das Fenster eine Bearbeitung reicht: Name, Kurzname, Art, Status und die Hauptstadt (Ortssuche,
 *   `gebiet-hauptstadt.vue`) gehen in den EINEN Entwurf (`fenster/bearbeitung.ts`); „Fertig“ in der Leiste schreibt `territory.update`.
 *   Tippen in einem Feld ist EIN Schritt, bis das Feld verlassen wird. Die 17 Detailfelder stehen als Zeilen des Wiki-Felds
 *   (`gebiet-wiki-felder.vue`, G6): Wiki-Wert durchgestrichen hinter der Beschriftung, ↺ am Zeilenende.
 * - **Prüfen** (D6) steht oben, wie im Ortseditor: die Befunde des Gebiets, nie eine Sperre (`gebiet-pruefen.vue`).
 * - **Zoomspanne** (T51; Betreiber 2026-10-19, wörtlich: „Zoomspanne: A, Untergebiete ziehen mit, ein Haken für Farbe und Zoomspanne.“):
 *   die Spanne als gemeinsames Bauteil (`fenster/zoomspanne.vue`) im selben Entwurf wie die Farbe. EIN Haken unter beiden: An rücken die
 *   Spannen der Untergebiete um dieselben Bänder wie das obere Ende; was sich verschiebt, steht vor „Fertig“ darunter, ohne Haken was
 *   bleibt und wo sich Gebiet und Untergebiete überlagern.
 */
const props = defineProps<{
    detail: EditorTerritoryDetail;
    /** Das Anzeigejahr der Liste (BF). */
    jahr: number;
    kennung: string;
    /** Die Befunde dieses Gebiets (D6). */
    befunde?: readonly EditorTerritoryFinding[] | undefined;
    /** Die Bearbeitung, wenn geschrieben werden darf (B2); ohne sie lesend. */
    bearbeitung?: GebietBearbeitung | undefined;
    /** Darf diese Sitzung das Obergebiet ändern? Es zählt zur Form (WI-0279, E2a); ohne das Recht bleibt der Rest bearbeitbar. */
    formFrei?: boolean | undefined;
    /**
     * Die Farbe, wenn sie sich ändern lässt (D4, T51): `jetzt` mit dem Entwurf „Farben und Zoombänder“, `mitziehen` dessen Schalter.
     * Geschrieben wird in jenen Entwurf, nicht in die Bearbeitung der Felder; ohne Angabe nur gezeigt.
     */
    farbe?: { jetzt: string; mitziehen: boolean } | undefined;
    /**
     * Die Zoomspanne, wenn sie sich ändern lässt (T51, Entscheid A): `jetzt` mit dem Entwurf „Farben und Zoombänder“, `folgen` die
     * Untergebiete vorher und jetzt (`spannenFolgen`), `mitziehen` derselbe Haken wie an der Farbe. Ohne Angabe nur gezeigt.
     */
    spanne?: { jetzt: Spanne; folgen: readonly SpannenFolge[]; mitziehen: boolean } | undefined;
    /** Die Gebiete der Liste: Daraus wählt „Umhängen“ das neue Obergebiet (D1). */
    gebiete?: readonly EditorTerritoryRow[] | undefined;
    /** Ein Ziel für „Umhängen“ von außen (Ziehen im Baum); `null` heißt Wurzel. */
    umhaengenNach?: { id: string; name: string } | null | undefined;
    /** „Entfernen“ (D3): schreibt sofort; ohne Angabe gibt es den Knopf nicht (ohne Recht). */
    entferne?:
        | ((
              stage: TerritoryRetireBody["stage"],
              children: TerritoryRetireBody["children"],
          ) => Promise<{ ok: true } | { ok: false; satz: string }>)
        | undefined;
    /** Warum gerade nicht entfernt werden kann (eine laufende Bearbeitung); fehlt: es geht. */
    entfernenGesperrt?: string | undefined;
    /** Eben angelegt (C3, Frage 3): Der Name steht markiert, damit Tippen ihn ersetzt. */
    nameMarkieren?: boolean | undefined;
}>();
const emit = defineEmits<{
    waehle: [id: string];
    reiter: [reiter: GebietReiter];
    /** Die Wiki-Box hat zugewiesen, entfernt oder gesynct: Detail und Liste lesen neu (WI-0253). */
    wiki: [];
    farbe: [farbe: string];
    spanne: [spanne: Spanne];
    mitziehen: [an: boolean];
    umhaengenErledigt: [];
    nameMarkiert: [];
}>();

// --- Der Name eines eben angelegten Gebiets (C3) ---
const nameFeld = ref<{ focus(): void; select(): void } | null>(null);
watch(
    () => props.nameMarkieren === true && nameFeld.value !== null,
    (bereit) => {
        if (!bereit) return;
        void nextTick(() => {
            nameFeld.value?.focus();
            nameFeld.value?.select();
            emit("nameMarkiert");
        });
    },
    { immediate: true },
);

// --- Entfernen (D3) ---
const entfernenOffen = ref(false);
const entfernenSendet = ref(false);
const entfernenSatz = ref<string | undefined>(undefined);
async function entfernen(
    stage: TerritoryRetireBody["stage"],
    children: TerritoryRetireBody["children"],
): Promise<void> {
    if (props.entferne === undefined || entfernenSendet.value) return;
    entfernenSendet.value = true;
    entfernenSatz.value = undefined;
    const antwort = await props.entferne(stage, children);
    entfernenSendet.value = false;
    if (antwort.ok) entfernenOffen.value = false;
    else entfernenSatz.value = antwort.satz;
}

// --- Schreibbare Felder (B2) ---
const stand = computed(() => props.bearbeitung?.stand.value);
function setze<K extends keyof GebietFelder>(feldName: K, wert: GebietFelder[K], verschmelze?: string): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, [feldName]: wert }), verschmelze);
}

const leer = (wert: string | undefined): string => (wert === undefined || wert.trim() === "" ? "–" : wert);
const ortArt = (art: string | undefined): string => {
    const key = `place.${art ?? ""}`;
    return isMessageKey(key) ? t(key) : (art ?? "");
};
/** Ein Ort aus den Daten: Name und Art, ein Verweis ins Leere als Befund. */
function ortText(ort: EditorTerritoryPlace | undefined): string | undefined {
    if (ort === undefined) return undefined;
    if (ort.missing === true) return t("gebietseditor.ort.fehlt");
    const art = ortArt(ort.kind);
    return art === "" ? (ort.name ?? "–") : `${ort.name ?? "–"} · ${art}`;
}
/** Was das Wiki nennt, wenn es nicht der verknüpfte Ort ist. */
function wikiOrt(ort: EditorTerritoryPlace | undefined, wiki: EditorTerritoryDetailField): string | undefined {
    const text = props.detail.details[wiki]?.value?.trim() ?? "";
    if (text === "") return undefined;
    if (
        ort !== undefined &&
        ort.missing !== true &&
        (ort.name ?? "").toLocaleLowerCase("de") === text.toLocaleLowerCase("de")
    )
        return undefined;
    return text;
}
const hauptstadt = computed(() => ortText(props.detail.capital));
const hauptstadtWiki = computed(() => wikiOrt(props.detail.capital, "capital_name"));
const sitz = computed(() => {
    const ort = ortText(props.detail.seat);
    if (ort !== undefined) return ort;
    const wiki = wikiOrt(undefined, "seat_name");
    return wiki === undefined ? "–" : t("gebietseditor.sitz.wiki", { name: wiki });
});
const sitzWiki = computed(() =>
    props.detail.seat === undefined ? undefined : wikiOrt(props.detail.seat, "seat_name"),
);

const obergebiet = computed(() => props.detail.parents[0]);
const kette = computed(() =>
    props.detail.parents
        .slice()
        .reverse()
        .map((p) => p.name)
        .join(" › "),
);
const jahrText = (wert: number | undefined): string =>
    wert === undefined || wert === 9999 ? t("gebietseditor.gueltig.offen") : t("gebietseditor.jahr.bf", { jahr: wert });
const spanneJetzt = computed(
    (): Spanne => props.spanne?.jetzt ?? { min: props.detail.minZoom, max: props.detail.maxZoom },
);
const spanneText = (s: Spanne): string => t("gebietseditor.unter.spanne", { von: s.min ?? 0, bis: s.max ?? 8 });
/** Der eine Haken für Farbe und Zoomspanne (T51). */
const mitziehen = computed(() => props.farbe?.mitziehen ?? props.spanne?.mitziehen ?? false);
const deckkraft = computed(() =>
    t("gebietseditor.deckkraft.text", { n: formatNumber(Math.round(props.detail.opacity * 100), 0) }),
);

// --- Die Wiki-Box (WI-0253): der Artikel des Gebiets, Zuweisen · Sync · Entfernen. Sie wirkt auf dem Server, nicht im Entwurf; darum sperrt sie bei ungespeicherten
// Änderungen, und nach einer Änderung liest das Fenster das Gebiet neu. ---
const schreibt = computed(() => props.bearbeitung !== undefined && stand.value !== undefined);
const wikiBoxUngespeichert = computed(() => {
    const lage = props.bearbeitung?.lage.value;
    return lage !== undefined && (lage.ungespeichert > 0 || lage.form);
});
const wikiBoxFelder = computed(() =>
    gebietWikiBoxFelder(stand.value?.felder ?? felderAus(props.detail), !schreibt.value, (feld) =>
        t(DETAIL_NAMEN[feld]),
    ),
);
const namen = (refs: readonly { name: string }[]): string =>
    refs.length === 0 ? t("gebietseditor.keine") : refs.map((r) => r.name).join(", ");
</script>

<template>
    <div class="gebiet" :data-testid="`${kennung}-felder`">
        <GebietPruefen
            :befunde="befunde ?? []"
            :kennung="kennung"
            :hierarchie-frei="formFrei"
            @waehle="(id: string) => emit('waehle', id)"
            @reiter="(neu: GebietReiter) => emit('reiter', neu)"
        />
        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.identitaet") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.name") }}</dt>
                <dd v-if="bearbeitung && stand">
                    <AvmEingabe
                        ref="nameFeld"
                        :model-value="stand.felder.name"
                        :aria-label="t('gebietseditor.feld.name')"
                        :testid="`${kennung}-feld-name`"
                        @update:model-value="(wert: string) => setze('name', wert, 'name')"
                        @blur="bearbeitung.feldVerlassen()"
                    />
                </dd>
                <dd v-else :data-testid="`${kennung}-feld-name`">{{ detail.name }}</dd>
                <dt>{{ t("gebietseditor.feld.kurzname") }}</dt>
                <dd v-if="bearbeitung && stand">
                    <AvmEingabe
                        :model-value="stand.felder.shortName"
                        :aria-label="t('gebietseditor.feld.kurzname')"
                        :testid="`${kennung}-feld-kurzname`"
                        @update:model-value="(wert: string) => setze('shortName', wert, 'kurzname')"
                        @blur="bearbeitung.feldVerlassen()"
                    />
                </dd>
                <dd v-else>{{ leer(detail.shortName) }}</dd>
                <dt>{{ t("infoPanel.field.art") }}</dt>
                <dd v-if="bearbeitung && stand">
                    <AvmEingabe
                        :model-value="stand.felder.type"
                        :aria-label="t('infoPanel.field.art')"
                        :testid="`${kennung}-feld-art`"
                        @update:model-value="(wert: string) => setze('type', wert, 'art')"
                        @blur="bearbeitung.feldVerlassen()"
                    />
                </dd>
                <dd v-else>{{ artName(detail.type) }}</dd>
                <dt>{{ t("infoPanel.field.status") }}</dt>
                <dd v-if="bearbeitung && stand">
                    <AvmEingabe
                        :model-value="stand.felder.status"
                        :aria-label="t('infoPanel.field.status')"
                        :testid="`${kennung}-feld-status`"
                        @update:model-value="(wert: string) => setze('status', wert, 'status')"
                        @blur="bearbeitung.feldVerlassen()"
                    />
                </dd>
                <dd v-else>{{ leer(detail.status) }}</dd>
            </FensterFeldzeilen>
            <GebietWikiFelder
                :felder="DETAIL_KAESTEN.identitaet"
                :detail="detail"
                :bearbeitung="bearbeitung"
                :kennung="kennung"
            />
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.imBaum") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.obergebiet") }}</dt>
                <dd v-if="bearbeitung && stand && formFrei" :data-testid="`${kennung}-feld-obergebiet`">
                    <GebietUmhaengen
                        :gebiet="{ id: detail.id, name: detail.name }"
                        :wert="stand.felder.parent"
                        :zeilen="gebiete ?? []"
                        :eigen="detail.parentOrigin === 'override' || stand.felder.parent?.id !== detail.parents[0]?.id"
                        :kennung="kennung"
                        :vorschlag="umhaengenNach"
                        @wahl="(neu) => setze('parent', neu)"
                        @waehle="(id: string) => emit('waehle', id)"
                        @vorschlag-erledigt="emit('umhaengenErledigt')"
                    />
                </dd>
                <dd v-else :data-testid="`${kennung}-feld-obergebiet`">
                    <button
                        v-if="obergebiet"
                        type="button"
                        class="gebiet__verweis"
                        :title="kette"
                        @click="emit('waehle', obergebiet.id)"
                    >
                        {{ obergebiet.name }}
                    </button>
                    <template v-else>{{ t("gebietseditor.obergebiet.keins") }}</template>
                    <span
                        v-if="detail.parentOrigin === 'override'"
                        class="gebiet__eigen"
                        :title="t('gebietseditor.umhaengen.eigen')"
                        >✎</span
                    >
                </dd>
                <template v-if="detail.parents.length > 1">
                    <dt>{{ t("gebietseditor.feld.kette") }}</dt>
                    <dd>{{ kette }}</dd>
                </template>
                <dt>{{ t("gebietseditor.feld.untergebiete") }}</dt>
                <dd>
                    <button
                        v-if="detail.children.length > 0"
                        type="button"
                        class="gebiet__verweis"
                        @click="emit('reiter', 'untergebiete')"
                    >
                        {{ formatNumber(detail.children.length, 0) }} ›
                    </button>
                    <template v-else>{{ t("gebietseditor.keine") }}</template>
                </dd>
            </FensterFeldzeilen>
            <GebietWikiFelder
                :felder="DETAIL_KAESTEN.imBaum"
                :detail="detail"
                :bearbeitung="bearbeitung"
                :kennung="kennung"
            />
            <p class="gebiet__hinweis">{{ t("gebietseditor.zugehoerigkeit.hinweis") }}</p>
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.herrschaft") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("infoPanel.field.capital") }}</dt>
                <dd v-if="bearbeitung && stand">
                    <GebietHauptstadt
                        :wert="stand.felder.capital"
                        :kennung="kennung"
                        @wahl="(ort) => setze('capital', ort)"
                    />
                    <small v-if="hauptstadtWiki" class="gebiet__zusatz">{{
                        t("gebietseditor.ort.wiki", { name: hauptstadtWiki })
                    }}</small>
                </dd>
                <dd v-else :data-testid="`${kennung}-feld-hauptstadt`">
                    {{ hauptstadt ?? "–" }}
                    <small v-if="hauptstadtWiki" class="gebiet__zusatz">{{
                        t("gebietseditor.ort.wiki", { name: hauptstadtWiki })
                    }}</small>
                </dd>
                <dt>{{ t("infoPanel.field.seat") }}</dt>
                <dd :data-testid="`${kennung}-feld-sitz`" :title="t('gebietseditor.sitz.nurLesen')">
                    {{ sitz }}
                    <small v-if="sitzWiki" class="gebiet__zusatz">{{
                        t("gebietseditor.ort.wiki", { name: sitzWiki })
                    }}</small>
                </dd>
            </FensterFeldzeilen>
            <GebietWikiFelder
                :felder="DETAIL_KAESTEN.herrschaft"
                :detail="detail"
                :bearbeitung="bearbeitung"
                :kennung="kennung"
            />
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.landUndLeute") }}</h4>
            <GebietWikiFelder
                :felder="DETAIL_KAESTEN.landUndLeute"
                :detail="detail"
                :bearbeitung="bearbeitung"
                :kennung="kennung"
            />
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.zeit") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.gueltigAb") }}</dt>
                <dd>{{ jahrText(detail.validFromBf) }}</dd>
                <dt>{{ t("gebietseditor.feld.gueltigBis") }}</dt>
                <dd>{{ jahrText(detail.validToBf) }}</dd>
                <template v-if="detail.validLabel">
                    <dt>{{ t("infoPanel.field.validity") }}</dt>
                    <dd>{{ detail.validLabel }}</dd>
                </template>
            </FensterFeldzeilen>
            <p v-if="detail.notInYear" class="gebiet__hinweis">{{ t("gebietseditor.jahr.giltNicht", { jahr }) }}</p>
            <GebietWikiFelder
                :felder="DETAIL_KAESTEN.zeit"
                :detail="detail"
                :bearbeitung="bearbeitung"
                :kennung="kennung"
            />
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.darstellung") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("gebietseditor.feld.farbe") }}</dt>
                <dd class="gebiet__reihe">
                    <GebietFarbfeld
                        :farbe="farbe?.jetzt ?? detail.color"
                        :wahl="farbe ? t('gebietseditor.farben.aendern', { name: detail.name }) : undefined"
                        :testid="`${kennung}-farbe-wahl`"
                        @farbe="(neu: string) => emit('farbe', neu)"
                    />
                    <span :data-testid="`${kennung}-feld-farbe`">{{ farbe?.jetzt ?? detail.color }}</span>
                    <button
                        v-if="detail.children.length > 0 && formFrei"
                        type="button"
                        class="gebiet__verweis"
                        @click="emit('reiter', 'hierarchie')"
                    >
                        {{ t("gebietseditor.farbe.hierarchie") }}
                    </button>
                </dd>
                <dt>{{ t("gebietseditor.feld.zoomspanne") }}</dt>
                <dd class="gebiet__reihe">
                    <ZoomSpanne
                        v-if="spanne"
                        class="gebiet__spanne"
                        :von="spanneJetzt.min"
                        :bis="spanneJetzt.max"
                        tippen
                        :name="detail.name"
                        :testid="`${kennung}-spanne`"
                        @aendere="(neu) => emit('spanne', { min: neu.von, max: neu.bis })"
                    />
                    <span :data-testid="`${kennung}-feld-spanne`">{{ spanneText(spanneJetzt) }}</span>
                </dd>
                <dt>{{ t("gebietseditor.feld.deckkraft") }}</dt>
                <dd>{{ deckkraft }}</dd>
            </FensterFeldzeilen>
            <AvmKaestchen
                v-if="(farbe || spanne) && detail.children.length > 0"
                art="checkbox"
                :checked="mitziehen"
                :hinweis="t('gebietseditor.darstellung.mitziehenHinweis')"
                :testid="`${kennung}-farbe-mitziehen`"
                @change="(an: boolean) => emit('mitziehen', an)"
            >
                {{ t("gebietseditor.farben.mitziehen") }}
            </AvmKaestchen>
            <GebietSpannenFolgen
                v-if="spanne"
                :folgen="spanne.folgen"
                :spanne="spanneJetzt"
                :testid="`${kennung}-spanne-folgen`"
            />
        </section>

        <section class="gebiet__abschnitt">
            <WikiBox
                :id="detail.id"
                art="gebiet"
                :recht="schreibt ? 'schreiben' : 'lesen'"
                :ungespeichert="wikiBoxUngespeichert"
                :felder="wikiBoxFelder"
                :lesestand="detail.revision"
                :kennung="kennung"
                @geaendert="emit('wiki')"
            >
                <template #zeilen>
                    <dt>{{ t("gebietseditor.feld.wikiTyp") }}</dt>
                    <dd :data-testid="`${kennung}-feld-wikityp`">{{ leer(detail.wikiType) }}</dd>
                </template>
            </WikiBox>
        </section>

        <section class="gebiet__abschnitt">
            <h4 class="gebiet__titel">{{ t("gebietseditor.abschnitt.ansprueche") }}</h4>
            <FensterFeldzeilen>
                <dt>{{ t("infoPanel.field.contested") }}</dt>
                <dd>{{ namen(detail.claimedBy) }}</dd>
                <dt>{{ t("gebietseditor.feld.beansprucht") }}</dt>
                <dd>{{ namen(detail.claims) }}</dd>
            </FensterFeldzeilen>
        </section>

        <section v-if="entferne" class="gebiet__abschnitt" :data-testid="`${kennung}-entfernen-abschnitt`">
            <GebietEntfernen
                v-if="entfernenOffen"
                :detail="detail"
                :kennung="kennung"
                :gesperrt="entfernenSendet ? t('gebietseditor.entfernen.sendet') : entfernenGesperrt"
                @entfernen="entfernen"
                @abbrechen="entfernenOffen = false"
            />
            <AvmKnopf
                v-else
                art="gefahr"
                groesse="zeile"
                :gesperrt="entfernenGesperrt"
                :testid="`${kennung}-entfernen-oeffnen`"
                @click="entfernenOffen = true"
            >
                {{ t("gebietseditor.entfernen.oeffnen") }}
            </AvmKnopf>
            <p v-if="entfernenSatz" class="gebiet__hinweis" role="alert">{{ entfernenSatz }}</p>
        </section>
    </div>
</template>

<style scoped>
.gebiet {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Wie die Abschnitte des Landschaftseditors, bis O3 sie in einen Baustein zieht. */
.gebiet__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gebiet__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gebiet__reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
}

.gebiet__spanne {
    flex: 1 1 12rem;
    min-width: 9rem;
}

.gebiet__zusatz {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebiet__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gebiet__eigen {
    color: var(--color-text-muted);
    cursor: help;
}

.gebiet__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.gebiet__verweis:hover {
    color: var(--color-link-hover);
}

.gebiet__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
