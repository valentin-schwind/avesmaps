-- Avesmaps political territory cleanup
--
-- Problem:
-- Generic Wiki hierarchy buckets such as "Unabhängig" can become synthetic
-- top-level political territories. If a real territory geometry is assigned
-- below such a bucket, the map layer may aggregate to the generic bucket when
-- zoomed out and display "Unabhängig" instead of the intended political root.
--
-- Strategy:
-- 1. Re-parent Sinoda/Shîkanydad children from a generic synthetic root to the
--    wiki-backed Shîkanydad root when that root exists.
-- 2. Hide empty synthetic generic roots from the political hierarchy. They are
--    editorial grouping artefacts, not map territories.
--
-- This script is intentionally conservative: it does not deactivate generic
-- roots that own active geometry.

START TRANSACTION;

-- Prefer the real, wiki-backed Shîkanydad root over the synthetic
-- "Unabhängig" bucket for Sinoda-related child nodes.
UPDATE political_territory AS child
INNER JOIN political_territory AS generic_root
    ON generic_root.id = child.parent_id
INNER JOIN political_territory AS normal_root
    ON normal_root.continent = child.continent
    AND normal_root.is_active = 1
    AND normal_root.wiki_id IS NOT NULL
    AND normal_root.id <> child.id
    AND normal_root.slug IN (
        'shikanydad-von-sinoda',
        'shikanydad'
    )
SET child.parent_id = normal_root.id,
    child.editor_notes = TRIM(CONCAT(
        COALESCE(child.editor_notes, ''),
        CASE WHEN COALESCE(child.editor_notes, '') = '' THEN '' ELSE '\n' END,
        '2026-05-18: Von generischer Sammelkategorie auf den Shîkanydad-Root umgehängt.'
    ))
WHERE child.continent = 'Aventurien'
    AND child.is_active = 1
    AND generic_root.wiki_id IS NULL
    AND generic_root.slug IN (
        'unabhaengig',
        'unabhangig',
        'umstritten',
        'ungeklaert',
        'ungeklart'
    )
    AND (
        child.slug LIKE '%sinoda%'
        OR child.slug LIKE '%shikanydad%'
        OR child.name LIKE '%Sinoda%'
        OR child.name LIKE '%Shîkanydad%'
        OR child.name LIKE '%Shikanydad%'
    );

-- Empty synthetic category roots should not become map display territories.
UPDATE political_territory AS root
LEFT JOIN (
    SELECT territory_id, COUNT(*) AS active_geometry_count
    FROM political_territory_geometry
    WHERE is_active = 1
    GROUP BY territory_id
) AS geometry_counts
    ON geometry_counts.territory_id = root.id
SET root.is_active = 0,
    root.editor_notes = TRIM(CONCAT(
        COALESCE(root.editor_notes, ''),
        CASE WHEN COALESCE(root.editor_notes, '') = '' THEN '' ELSE '\n' END,
        '2026-05-18: Generische Wiki-Sammelkategorie ausgeblendet; kein eigenständiges Kartenreich.'
    ))
WHERE root.continent = 'Aventurien'
    AND root.wiki_id IS NULL
    AND root.slug IN (
        'unabhaengig',
        'unabhangig',
        'umstritten',
        'ungeklaert',
        'ungeklart'
    )
    AND COALESCE(geometry_counts.active_geometry_count, 0) = 0;

COMMIT;
