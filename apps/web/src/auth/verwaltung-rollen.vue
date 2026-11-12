<script setup lang="ts">
/**
 * Der Reiter „Rollen & Rechte“ (WI-0120 A10; Mockup `04-rollen`, AUTH-0001 §7.2 und §12.4; WI-0279, E9b): zum Nachlesen, eine Seite mit
 * Grundrollen, Sonderrollen, Berechtigungen und Einzelrechten. Alles kommt aus dem EINEN Katalog (`packages/shared`), nicht aus einer
 * zweiten Liste hier. Einzelrechte teilt der Betreiber im Personendetail zu, Sonderrollen im Reiter „Sonderrollen“.
 */
import { computed, inject } from "vue";
import {
    CAPABILITIES,
    CAPABILITY_NAMES,
    GRANTABLE_CAPABILITIES,
    ROLES,
    SONDERROLLEN_NAMEN,
    roleRank,
    sonderrolleSpec,
    type Capability,
    type SonderrolleName,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { authState } from "./session-state";
import { ZEIGE_ANSICHT, type Administration } from "./verwaltung";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import { label } from "./verwaltung-text";

const props = defineProps<{ verwaltung: Administration }>();

/** Die Gruppen der Matrix, in der Reihenfolge des Katalogs. */
const GRUPPEN: readonly { id: string; namen: readonly Capability[] }[] = [
    {
        id: "view",
        namen: [
            "view_editor_series",
            "view_flow_directions",
            "search_sea_route_names",
            "pin_selection",
            "use_editor_menu",
        ],
    },
    {
        id: "editorial",
        namen: [
            "moderate_submissions",
            "moderate_photobox",
            "moderate_map_suggestions",
            "view_media_private",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_territory_form",
            "edit_landscapes",
            "edit_landscape_form",
            "edit_mountains",
            "edit_languages",
            "manage_sources",
            "upload_media",
            "edit_map_collection",
            "upload_social_image",
            "review_media_rights",
            "suspend_media_publication",
            "publish_media",
            "social_communication",
            "view_own_jobs",
        ],
    },
    {
        id: "admin",
        namen: [
            "view_operations",
            "read_audit",
            "manage_people",
            "manage_invitations",
            "assign_roles",
            "create_backup",
            "manage_display_settings",
        ],
    },
    {
        id: "system",
        namen: [
            "assign_admin",
            "grant_special_capabilities",
            "manage_passkeys",
            "delete_media",
            "manage_media_rules",
            "edit_community_license",
            "merge_media_all",
            "switch_environment",
            "manage_routing",
            "publish_social",
            "release_map_series",
            "export_maps",
            "trash_mail",
        ],
    },
];
// Was der Katalog kennt und keine Gruppe nennt, landet am Ende statt zu fehlen.
// Die Rechte des Legacy-Zugs bleiben im Katalog und in den Grants, stehen hier aber nicht: Seit dem Cutoff 02.11. gibt es in der
// Oberfläche keinen Zug aus Legacy mehr, und ein Recht dafür soll keinen Betreiber glauben machen, er sei noch möglich.
const NICHT_GEZEIGT: readonly Capability[] = ["run_legacy_sync", "run_legacy_zug"];
const gruppiert = new Set(GRUPPEN.flatMap((gruppe) => gruppe.namen));
const uebrige = CAPABILITY_NAMES.filter(
    (name) =>
        !gruppiert.has(name) &&
        !NICHT_GEZEIGT.includes(name) &&
        !(GRANTABLE_CAPABILITIES as readonly string[]).includes(name),
);
const gruppen = uebrige.length > 0 ? [...GRUPPEN, { id: "other", namen: uebrige }] : GRUPPEN;

const hat = (role: (typeof ROLES)[number], capability: Capability): boolean =>
    roleRank(role) >= roleRank(CAPABILITIES[capability].minRole);
const stufe = (capability: Capability): string => CAPABILITIES[capability].assurance.toUpperCase();

const jetzt = new Date();
const umgebung = label("auth.environment.name", authState.value.environment ?? "");
const betreiber = computed(() =>
    (props.verwaltung.roles.value?.operators ?? []).map((person) => person.displayName).join(", "),
);
const inhaber = (capability: string) =>
    (props.verwaltung.roles.value?.grants ?? []).filter((grant) => grant.capability === capability);

const zeigeAnsicht = inject(ZEIGE_ANSICHT, undefined);
const personenMit = (role: (typeof ROLES)[number]): number =>
    props.verwaltung.people.value.filter((person) => person.role === role && person.access === "active").length;
/** Die Personen je Sonderrolle: wer zwei Regionen betreut, zählt einmal. */
const inhaberVon = (rolle: SonderrolleName): number =>
    new Set(
        (props.verwaltung.sonderrollen.value?.zuteilungen ?? [])
            .filter((zeile) => zeile.sonderrolle === rolle && zeile.entzogenAm === null)
            .map((zeile) => zeile.person.id),
    ).size;
/** Die Sonderrollen, die ein Recht auch denen geben, deren Grundrolle es nicht hat. */
const durchSonderrolle = (capability: Capability): string =>
    SONDERROLLEN_NAMEN.filter((rolle) => sonderrolleSpec(rolle).rechte.includes(capability))
        .map((rolle) => label("auth.sonderrolle", rolle))
        .join(", ");
</script>

<template>
    <p class="rollen__lead">{{ t("admin.roles.lead") }}</p>

    <p class="rollen__ueberschrift">{{ t("admin.roles.grundrollen") }}</p>
    <FensterTafel :beschriftung="t('admin.roles.grundrollen')" art="text" grund="fenster">
        <table data-testid="rollen-grundrollen">
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.roles.col.role") }}</th>
                    <th scope="col">{{ t("admin.roles.col.appliesTo") }}</th>
                    <th scope="col">{{ t("admin.roles.col.people") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="role in ROLES" :key="role" :data-testid="`grundrolle-${role}`">
                    <th scope="row">{{ label("auth.role", role) }}</th>
                    <td>{{ label("admin.roles.gilt", role) }}</td>
                    <td>{{ personenMit(role) }}</td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>

    <p class="rollen__ueberschrift">{{ t("admin.tab.sonderrollen") }}</p>
    <FensterTafel :beschriftung="t('admin.tab.sonderrollen')" art="text" grund="fenster">
        <table data-testid="rollen-sonderrollen">
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.roles.col.sonderrolle") }}</th>
                    <th scope="col">{{ t("admin.roles.col.meaning") }}</th>
                    <th scope="col">{{ t("admin.roles.col.rights") }}</th>
                    <th scope="col">{{ t("admin.roles.col.holders") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="rolle in SONDERROLLEN_NAMEN" :key="rolle" :data-testid="`rollen-sonderrolle-${rolle}`">
                    <th scope="row">{{ label("auth.sonderrolle", rolle) }}</th>
                    <td>{{ label("admin.sonderrollen.kurz", rolle) }}</td>
                    <td>{{ sonderrolleSpec(rolle).rechte.length }}</td>
                    <td>
                        <button
                            v-if="zeigeAnsicht !== undefined"
                            type="button"
                            class="rollen__verweis"
                            @click="zeigeAnsicht('sonderrollen')"
                        >
                            {{ inhaberVon(rolle) }} ›
                        </button>
                        <template v-else>{{ inhaberVon(rolle) }}</template>
                    </td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>

    <p class="rollen__ueberschrift">{{ t("admin.roles.matrix") }}</p>
    <FensterTafel :beschriftung="t('admin.roles.matrix')" grund="fenster">
        <table class="rollen__matrix" data-testid="rollen-matrix">
            <colgroup>
                <col class="rollen__spalte-recht" />
                <col class="rollen__spalte-zahl" />
                <col v-for="role in ROLES" :key="role" class="rollen__spalte-zahl" />
                <col class="rollen__spalte-durch" />
            </colgroup>
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.roles.col.capability") }}</th>
                    <th scope="col">{{ t("admin.roles.col.level") }}</th>
                    <th v-for="role in ROLES" :key="role" scope="col">{{ label("auth.role", role) }}</th>
                    <th scope="col">{{ t("admin.roles.col.through") }}</th>
                </tr>
            </thead>
            <tbody v-for="gruppe in gruppen" :key="gruppe.id">
                <tr>
                    <th scope="rowgroup" :colspan="ROLES.length + 3">{{ label("admin.roles.group", gruppe.id) }}</th>
                </tr>
                <tr v-for="name in gruppe.namen" :key="name" :data-testid="`rollen-${name}`">
                    <th scope="row">
                        {{ label("auth.capability", name) }}
                        <span class="fenster-tafel__zusatz">{{ label("admin.capability", name) }}</span>
                    </th>
                    <td :title="label('admin.roles.level', CAPABILITIES[name].assurance)">{{ stufe(name) }}</td>
                    <td v-for="role in ROLES" :key="role" :data-leer="hat(role, name) ? undefined : ''">
                        {{ hat(role, name) ? "✓" : "–" }}
                    </td>
                    <td :data-leer="durchSonderrolle(name) === '' ? '' : undefined">
                        {{ durchSonderrolle(name) === "" ? "–" : durchSonderrolle(name) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>
    <p class="rollen__leise">{{ t("admin.roles.levels") }}</p>

    <p class="rollen__ueberschrift">{{ t("admin.roles.special") }}</p>
    <p class="rollen__lead">{{ t("admin.roles.specialLead") }}</p>
    <VerwaltungLadeproblem
        v-if="verwaltung.loadProblems.has('roles')"
        :problems="verwaltung.loadProblems.get('roles')"
        :fehlt="verwaltung.unconfirmed.get('roles')"
        testid="rollen-ladeproblem"
        @bestaetigen="verwaltung.confirmAgain()"
    />
    <FensterTafel v-else :beschriftung="t('admin.roles.special')" art="text" grund="fenster">
        <table data-testid="rollen-sonderrechte">
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.roles.col.special") }}</th>
                    <th scope="col">{{ t("admin.roles.col.meaning") }}</th>
                    <th scope="col">{{ t("admin.roles.col.holders") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="name in GRANTABLE_CAPABILITIES" :key="name" :data-testid="`sonderrecht-${name}`">
                    <th scope="row">{{ label("auth.capability", name) }}</th>
                    <td>{{ label("admin.capability", name) }}</td>
                    <td>
                        <span class="rollen__zeile">{{
                            betreiber === ""
                                ? t("admin.roles.holdersOperators")
                                : t("admin.roles.holdersOperatorsNamed", { names: betreiber })
                        }}</span>
                        <span v-for="grant in inhaber(name)" :key="grant.person.id" class="rollen__zeile">
                            {{
                                t("admin.roles.holder", {
                                    name: grant.person.displayName,
                                    time: relativeTime(new Date(grant.grantedAt), jetzt, locale),
                                    by: grant.grantedBy?.displayName ?? "?",
                                })
                            }}
                        </span>
                    </td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>
    <AvmHinweis
        ><strong class="rollen__erst">{{ t("admin.roles.perEnvironmentFirst") }}</strong>
        {{ t("admin.roles.perEnvironment", { env: umgebung }) }}</AvmHinweis
    >
</template>

<style scoped>
.rollen__lead {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.rollen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rollen__ueberschrift {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Die Spalten stehen fest: Sonst nimmt die Spalte der Sonderrollen den Platz, und die Rollen im Kopf trennen nach Silben. */
.rollen__matrix {
    min-width: 640px;
    table-layout: fixed;
}

.rollen__spalte-recht {
    width: 36%;
}

.rollen__spalte-zahl {
    width: 7.5%;
}

.rollen__spalte-durch {
    width: 19%;
}

.rollen__zeile {
    display: block;
}

.rollen__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-strong);
    cursor: pointer;
    font: inherit;
}

.rollen__verweis:hover {
    text-decoration: underline;
}

.rollen__verweis:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.rollen__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}
</style>
