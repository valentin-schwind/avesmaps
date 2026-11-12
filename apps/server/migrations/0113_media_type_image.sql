-- Typbilder (WI-0068, Betreiber 2026-10-11, wörtlich: „kannst du im MAM die neue kategorie „Typbilder“ machen, wo man sich typbilde
-- anlegen und für jede kategorie eins auswählen kann, markiere diese immer dann mit einem stern und erlaube, dass andere bilder aus
-- assets ausgewählt werden können, wobei das alte typbild seinen stern/status verliert.“).
--
-- Je Kategorie (eine der Kopfgrafiken der Arten, `HEADER_GRAPHICS` in packages/shared/src/header-graphics.ts) trägt genau EINE aktive
-- Zeile den ★: das gültige Typbild. Ein Wechsel zieht die bisherige Zeile zurück (`retired_at`) und legt eine neue an; die alte bleibt
-- als Verlauf, das Asset bleibt unberührt. Die Zeile ist eine Verwendung der Rolle `header` (`readUsages`): Ob das Typbild öffentlich
-- erscheint, entscheidet die EINE Policy wie bei jedem Kopfbild, und der Abgleich (`media_settle`) rechnet die öffentliche Datei.
--
-- `origin`: `release` für die eingebauten Grafiken, die der Klick „Eingebaute Typbilder übernehmen“ anlegt; `editor` für einen Wechsel in
-- der Medienverwaltung. Kein Import schreibt die Tafel.
--
-- Additiv: eine neue Tafel, nichts Bestehendes ändert sich. Rechte: Die App-Rolle schreibt sie über die Default-Privilegien der
-- Migrationsrolle; die Jobs-Rolle liest sie (Abgleich), Zeile in media-grants.psql. `revision` zählt `public.revision_bump()` (0079).

CREATE TABLE IF NOT EXISTS media_type_image (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL CHECK (category ~ '^[a-z]{2,40}$'),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    origin TEXT NOT NULL DEFAULT 'editor' CHECK (origin IN ('release', 'editor')),
    publication_override TEXT NOT NULL DEFAULT 'none' CHECK (publication_override IN ('none', 'approved', 'blocked')),
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at TIMESTAMPTZ
);

-- Genau ein ★ je Kategorie.
CREATE UNIQUE INDEX IF NOT EXISTS media_type_image_one_active ON media_type_image (category) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS media_type_image_asset ON media_type_image (media_asset_id);

CREATE OR REPLACE TRIGGER media_type_image_revision BEFORE UPDATE ON media_type_image
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE media_type_image IS
    'Typbilder (WI-0068): je Kategorie (Kopfgrafik der Art) genau eine aktive Zeile = das gültige Typbild (★); zurückgezogene Zeilen sind der Verlauf. Eine Verwendung der Rolle header; öffentlich nach der Policy.';
COMMENT ON COLUMN media_type_image.origin IS
    'release: aus den eingebauten Grafiken übernommen (ein Klick des Betreibers); editor: in der Medienverwaltung gewählt.';
