-- WI-0068 D1: zwei Werke mit DENSELBEN BYTES werden eines.
--
-- Legacy legte je Verwendung ein eigenes Werk an: im Bestand teilen 1.025 Assets ihre Quelldatei mit einem anderen, in 218
-- Gruppen, die größte mit 15 (Bewertung `2026-10-11-medien-duplikate-bewertung.md`). Betreiber 2026-10-11, wörtlich: „genau, nur
-- bei byte-identischen bildern, aber das sind ja einige“, und 2026-10-13: „bytegleiche bilder die doppelt sind sollen zu einem
-- werden - verlier die referenzen nicht“.
--
-- 🔴 NIE AUTOMATISCH (WI-0068 §21): Diese Migration legt nur die Tafeln an. Zusammengeführt wird über eine Operation, die ein
-- Mensch auslöst; auf Stage drückt der Betreiber selbst.
--
-- 🔴 Das aufgegangene Werk wird NICHT GELÖSCHT. Es behält Original, Rechte, Herkunft und `source_ref` und steht am bleibenden
-- Werk als Verlauf. Nur seine Verwendungen ziehen um — und genau die hält `media_merge_move` fest, damit „Zusammenführung
-- aufheben“ exakt dasselbe wiederherstellen kann und nicht raten muss, welche Bindung vorher wem gehörte.

CREATE TABLE IF NOT EXISTS media_merge (
    id BIGSERIAL PRIMARY KEY,
    -- Das Werk, das aufgeht: es verliert seine Verwendungen und fällt aus Liste und Körben.
    merged_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    -- Das Werk, das bleibt: es trägt danach auch die Verwendungen des anderen.
    kept_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    -- Die Bytes, über die beide zusammengehörten; sie halten fest, WARUM das erlaubt war.
    source_sha256 TEXT NOT NULL,
    reason TEXT,
    merged_by_person UUID NOT NULL,
    merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lifted_at TIMESTAMPTZ,
    lifted_by_person UUID,
    lift_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_merge_not_self CHECK (merged_asset_id <> kept_asset_id),
    CONSTRAINT media_merge_sha256_format CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_merge_lift_has_person CHECK ((lifted_at IS NULL) = (lifted_by_person IS NULL)),
    CONSTRAINT media_merge_lift_after_merge CHECK (lifted_at IS NULL OR lifted_at >= merged_at),
    CONSTRAINT media_merge_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
    CONSTRAINT media_merge_lift_reason_needs_lift CHECK (
        lift_reason IS NULL OR (lifted_at IS NOT NULL AND btrim(lift_reason) <> '')
    )
);

-- 🔴 Ein Werk geht höchstens EINMAL auf. Eine aufgehobene Zusammenführung bleibt als Verlauf stehen und erlaubt eine neue.
CREATE UNIQUE INDEX IF NOT EXISTS media_merge_one_active
    ON media_merge (merged_asset_id)
    WHERE lifted_at IS NULL;

-- Der Weg, den der Medienimport geht: „wohin zeigt dieser Schlüssel jetzt?“
CREATE INDEX IF NOT EXISTS media_merge_kept ON media_merge (kept_asset_id) WHERE lifted_at IS NULL;

COMMENT ON TABLE media_merge IS
    'Zwei bytegleiche Werke werden eines (WI-0068 D1). Nie automatisch; das aufgegangene Werk bleibt bestehen und ist umkehrbar.';
COMMENT ON COLUMN media_merge.source_sha256 IS
    'Die geteilten Bytes zur Zeit der Zusammenfuehrung. Aendert Legacy sie spaeter, meldet der Lauf einen Befund.';

-- Was umgezogen ist, Zeile für Zeile. Ohne diese Spur wüsste „aufheben“ nicht, welche der Bindungen des bleibenden Werks
-- vorher dem anderen gehörten — und gäbe ihm entweder zu viele zurück oder zu wenige.
CREATE TABLE IF NOT EXISTS media_merge_move (
    merge_id BIGINT NOT NULL REFERENCES media_merge (id) ON DELETE CASCADE,
    -- Die Tafel der Verwendung; die Liste steht im Code (`media-editor/merge.ts`) und im Test `media-asset-referenzen.test.ts`.
    target_table TEXT NOT NULL,
    target_id BIGINT NOT NULL,
    -- `umgehaengt`: die Zeile zeigt jetzt auf das bleibende Werk. `zurueckgezogen`: am selben Platz hing das bleibende Werk
    -- schon, zwei Zeilen gehen dort nicht nebeneinander (Eindeutigkeit je Platz und Rolle) - die Zeile wurde deshalb
    -- zurueckgezogen statt umgehaengt. `aktiviert`: dabei musste die vorhandene Zeile des bleibenden Werks wieder aktiv werden.
    kind TEXT NOT NULL,
    PRIMARY KEY (merge_id, target_table, target_id),
    CONSTRAINT media_merge_move_kind_known CHECK (kind IN ('umgehaengt', 'zurueckgezogen', 'aktiviert'))
);

COMMENT ON TABLE media_merge_move IS
    'Je Zusammenfuehrung, welche Verwendungszeile wie umgezogen ist - die Grundlage fuer das exakte Aufheben (WI-0068 D1).';

-- Die Revision der beteiligten Werke steigt NICHT: `media_asset_revision` zaehlt nur die fachlichen Spalten (Titel, Art,
-- Herkunft ...). Eine Verwendung ist keine Spalte am Asset - auch eine gewoehnliche Bindung hebt sie nicht.
