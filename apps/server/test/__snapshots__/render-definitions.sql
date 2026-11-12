-- VIEW climate_band_render
SELECT b.type_key,
    t.label,
    t.sort_order,
    map_domain_to_render('aventuria'::text, part.geom)::geometry(Polygon,3857) AS geom
   FROM climate_band b
     JOIN climate_zone_type t ON t.type_key = b.type_key
     LEFT JOIN climate_band_smooth s ON s.type_key = b.type_key AND s.source_fingerprint = b.source_fingerprint
     CROSS JOIN LATERAL st_dump(COALESCE(s.geom, b.geom)) part(path, geom)
  WHERE t.is_active
  ORDER BY b.type_key, part.path;

-- VIEW climate_label_render
SELECT b.type_key,
    t.label AS name,
    kante.seite,
    t.sort_order,
    map_domain_to_render('aventuria'::text, st_setsrid(st_makepoint(kante.anker_x::double precision, (span.y_min + span.y_max) / 2.0::double precision), 0))::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
   FROM climate_band b
     JOIN climate_zone_type t ON t.type_key = b.type_key
     CROSS JOIN LATERAL ( VALUES ('west'::text,0.0,0.0), ('ost'::text,1024.0,1024.0 - 1024.0 / 4096::numeric)) kante(seite, x, anker_x)
     CROSS JOIN LATERAL climate_band_edge_span(b.geom, kante.x::double precision) span(y_min, y_max)
  WHERE t.is_active AND (span.y_max - span.y_min) >= 8::double precision
  ORDER BY b.type_key, kante.seite;

-- VIEW landscape_label_run_render
SELECT r.id AS run_id,
    reg.public_id AS region_public_id,
    l.name,
    reg.region_layer,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(reg.map_domain_id, r.geom)::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type,
    l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL AS own_span
   FROM landscape_label_run r
     JOIN region reg ON reg.id = r.region_id
     JOIN map_label l ON l.id = r.style_label_id
     JOIN map_label_effective e ON e.label_id = l.id
  WHERE reg.is_active AND NOT reg.is_hidden AND l.is_active AND l.show_name IS DISTINCT FROM false
  ORDER BY reg.public_id, r.instance_count, r.instance;

-- VIEW ley_node_basis_render
SELECT p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    'place'::text AS node_kind,
    p.map_domain_id,
    p.geom AS domain_geom
   FROM place p
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = p.subtype
  WHERE p.is_active AND (p.is_nodix OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.from_public_id = p.public_id)) OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.to_public_id = p.public_id)))
UNION ALL
 SELECT l.public_id,
    l.name,
    'stadt'::text AS subtype,
    false AS is_hidden,
    NULL::smallint AS label_min_zoom_override,
    NULL::smallint AS label_max_zoom_override,
    NULL::boolean AS label_visible_override,
    NULL::numeric(4,1) AS label_size_override,
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
    false AS is_ruined,
    'label'::text AS node_kind,
    l.map_domain_id,
    l.geom AS domain_geom
   FROM map_label l
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'stadt'::text
  WHERE l.is_active AND (l.is_nodix IS TRUE OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.from_public_id = l.public_id)) OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.to_public_id = l.public_id)))
UNION ALL
 SELECT n.public_id,
    NULL::text AS name,
    'dorf'::text AS subtype,
    false AS is_hidden,
    NULL::smallint AS label_min_zoom_override,
    NULL::smallint AS label_max_zoom_override,
    NULL::boolean AS label_visible_override,
    NULL::numeric(4,1) AS label_size_override,
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
    false AS is_ruined,
    'nodix'::text AS node_kind,
    n.map_domain_id,
    n.geom AS domain_geom
   FROM nodix n
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'dorf'::text
  WHERE n.is_active
UNION ALL
 SELECT t.public_id,
    t.name,
    'gebaeude'::text AS subtype,
    'verborgen'::text = ANY (t.merkmale) AS is_hidden,
    NULL::smallint AS label_min_zoom_override,
    NULL::smallint AS label_max_zoom_override,
    NULL::boolean AS label_visible_override,
    NULL::numeric(4,1) AS label_size_override,
    label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
    false AS is_ruined,
    'landmark'::text AS node_kind,
    t.map_domain_id,
    t.geom AS domain_geom
   FROM terrain_peak t
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'gebaeude'::text
  WHERE t.is_active AND (('nodix'::text = ANY (t.merkmale)) OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.from_public_id = t.public_id)) OR (EXISTS ( SELECT 1
           FROM powerline pl
          WHERE pl.is_active AND pl.to_public_id = t.public_id)))
  ORDER BY 1;

-- VIEW ley_node_render
SELECT public_id,
    name,
    subtype,
    is_hidden,
    label_min_zoom_override,
    label_max_zoom_override,
    label_visible_override,
    label_size_override,
    geom,
    collision_rank,
    is_ruined,
    node_kind
   FROM ( SELECT p.public_id,
            p.name,
            p.subtype,
            p.is_hidden,
            p.label_min_zoom_override,
            p.label_max_zoom_override,
            p.label_visible_override,
            p.label_size_override,
            map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point,3857) AS geom,
            label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
            p.is_ruined,
            'place'::text AS node_kind
           FROM place p
             LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = p.subtype
          WHERE p.is_active AND (p.is_nodix OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.from_public_id = p.public_id)) OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.to_public_id = p.public_id)))
        UNION ALL
         SELECT l.public_id,
            l.name,
            'stadt'::text AS subtype,
            false AS is_hidden,
            NULL::smallint AS label_min_zoom_override,
            NULL::smallint AS label_max_zoom_override,
            NULL::boolean AS label_visible_override,
            NULL::numeric(4,1) AS label_size_override,
            map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
            label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
            false AS is_ruined,
            'label'::text AS node_kind
           FROM map_label l
             LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'stadt'::text
          WHERE l.is_active AND (l.is_nodix IS TRUE OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.from_public_id = l.public_id)) OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.to_public_id = l.public_id)))
        UNION ALL
         SELECT n.public_id,
            NULL::text AS name,
            'dorf'::text AS subtype,
            false AS is_hidden,
            NULL::smallint AS label_min_zoom_override,
            NULL::smallint AS label_max_zoom_override,
            NULL::boolean AS label_visible_override,
            NULL::numeric(4,1) AS label_size_override,
            map_domain_to_render(n.map_domain_id, n.geom)::geometry(Point,3857) AS geom,
            label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
            false AS is_ruined,
            'nodix'::text AS node_kind
           FROM nodix n
             LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'dorf'::text
          WHERE n.is_active
        UNION ALL
         SELECT t.public_id,
            t.name,
            'gebaeude'::text AS subtype,
            'verborgen'::text = ANY (t.merkmale) AS is_hidden,
            NULL::smallint AS label_min_zoom_override,
            NULL::smallint AS label_max_zoom_override,
            NULL::boolean AS label_visible_override,
            NULL::numeric(4,1) AS label_size_override,
            map_domain_to_render(t.map_domain_id, t.geom)::geometry(Point,3857) AS geom,
            label_collision_rank(cr.rank, NULL::smallint, NULL::smallint) AS collision_rank,
            false AS is_ruined,
            'landmark'::text AS node_kind
           FROM terrain_peak t
             LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = 'gebaeude'::text
          WHERE t.is_active AND (('nodix'::text = ANY (t.merkmale)) OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.from_public_id = t.public_id)) OR (EXISTS ( SELECT 1
                   FROM powerline pl
                  WHERE pl.is_active AND pl.to_public_id = t.public_id)))) knoten
  ORDER BY public_id;

-- VIEW map_domain_bounds_render
SELECT id AS map_domain_id,
    min_x,
    min_y,
    (2::numeric * 20037508.342789244)::double precision / GREATEST(max_x - min_x, max_y - min_y) AS skala
   FROM map_domain d
  ORDER BY id;

-- VIEW map_label_render
SELECT l.public_id,
    l.name,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    (EXISTS ( SELECT 1
           FROM landscape_label_run r
          WHERE r.region_id = l.region_id)) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type,
    ((reg.region_layer = ANY (ARRAY['vegetation'::text, 'topographie'::text])) AND (EXISTS ( SELECT 1
           FROM region zwilling
          WHERE zwilling.is_active AND (zwilling.region_layer = ANY (ARRAY['vegetation'::text, 'topographie'::text])) AND zwilling.name = reg.name AND zwilling.id <> reg.id AND (EXISTS ( SELECT 1
                   FROM region_area a
                  WHERE a.region_id = zwilling.id AND a.is_active))))) IS TRUE AS name_twin,
    l.label_min_zoom IS NOT NULL AND l.label_max_zoom IS NOT NULL AS own_span
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active AND l.show_name IS DISTINCT FROM false AND NOT (EXISTS ( SELECT 1
           FROM region verborgen
          WHERE verborgen.id = l.region_id AND verborgen.is_hidden))
  ORDER BY l.public_id;

-- VIEW path_basis_render
SELECT p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction,
    p.is_tunnel,
    p.mark,
    p.map_domain_id,
    v.geom AS domain_geom
   FROM path p
     JOIN path_visual v ON v.path_id = p.id
  WHERE p.is_active
UNION ALL
 SELECT p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction,
    p.is_tunnel,
    p.mark,
    p.map_domain_id,
    p.geom AS domain_geom
   FROM path p
  WHERE p.is_active AND NOT (EXISTS ( SELECT 1
           FROM path_visual v
          WHERE v.path_id = p.id))
  ORDER BY 1;

-- VIEW path_label_render
SELECT name,
    subtype,
    count(*)::integer AS segment_count,
    st_linemerge(st_collect(map_domain_to_render(map_domain_id, geom)))::geometry(Geometry,3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
   FROM path p
  WHERE is_active AND label_visible
  GROUP BY name, subtype, map_domain_id
  ORDER BY name, subtype;

-- VIEW path_label_run_basis_render
SELECT r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    k.mark,
    r.is_bach,
    r.map_domain_id,
    r.geom AS domain_geom
   FROM path_label_run r
     LEFT JOIN LATERAL ( SELECT p.mark
           FROM path p
          WHERE p.map_domain_id = r.map_domain_id AND p.name = r.name AND p.subtype = r.subtype AND p.mark IS NOT NULL AND p.is_active
         LIMIT 1) k ON true
  ORDER BY r.name, r.subtype, r.part, r.instance;

-- VIEW path_label_run_render
SELECT r.name,
    r.subtype,
    r.part,
    r.instance,
    r.instance_count,
    r.run_min_zoom,
    r.run_max_zoom,
    r.name_width_px,
    map_domain_to_render(r.map_domain_id, r.geom)::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    k.mark,
    r.is_bach
   FROM path_label_run r
     LEFT JOIN LATERAL ( SELECT p.mark
           FROM path p
          WHERE p.map_domain_id = r.map_domain_id AND p.name = r.name AND p.subtype = r.subtype AND p.mark IS NOT NULL AND p.is_active
         LIMIT 1) k ON true
  ORDER BY r.name, r.subtype, r.part, r.instance;

-- VIEW path_render
SELECT p.public_id,
    p.name,
    p.subtype,
    p.label_visible,
    p.is_bach,
    map_domain_to_render(p.map_domain_id, COALESCE(v.geom, p.geom))::geometry(LineString,3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank,
    p.flow_direction,
    p.is_tunnel,
    p.mark
   FROM path p
     LEFT JOIN path_visual v ON v.path_id = p.id
  WHERE p.is_active
  ORDER BY p.public_id;

-- VIEW place_basis_render
SELECT p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    p.is_nodix,
    tcb.bands AS capital_bands,
    p.is_approximate,
    COALESCE(pc.canon = 'unofficial'::text, ( SELECT s.display
           FROM canon_object_label_setting s
          WHERE s.object_kind = 'place'::text), false) AS is_unofficial,
    p.map_domain_id,
    p.geom AS domain_geom
   FROM place p
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = p.subtype
     LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
     LEFT JOIN place_canon pc ON pc.place_id = p.id
  WHERE p.is_active
  ORDER BY p.public_id;

-- VIEW place_render
SELECT p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    p.is_ruined,
    p.is_nodix,
    tcb.bands AS capital_bands,
    p.is_approximate,
    COALESCE(pc.canon = 'unofficial'::text, ( SELECT s.display
           FROM canon_object_label_setting s
          WHERE s.object_kind = 'place'::text), false) AS is_unofficial
   FROM place p
     LEFT JOIN label_class_rank cr ON cr.scope = 'place'::text AND cr.class_key = p.subtype
     LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
     LEFT JOIN place_canon pc ON pc.place_id = p.id
  WHERE p.is_active
  ORDER BY p.public_id;

-- VIEW powerline_render
SELECT public_id,
    name,
    label_visible,
    map_domain_to_render(map_domain_id, drawn_geom)::geometry(LineString,3857) AS geom
   FROM powerline p
  WHERE is_active
  ORDER BY public_id;

-- VIEW region_area_eckig_render
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    a.map_domain_id,
    a.geom AS domain_geom
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)))
  ORDER BY a.public_id;

-- VIEW region_area_render
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden
UNION ALL
 SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry,3857) AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)))
  ORDER BY 1;

-- VIEW region_area_rund_render
SELECT a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    s.render_geom AS geom,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at AND region_area_is_smoothed(r.region_layer, r.region_type)
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden
  ORDER BY a.public_id;

-- VIEW sprache_flaeche_render
SELECT a.public_id,
    s.public_id AS sprache_public_id,
    s.schluessel,
    s.name,
    s.farbe,
    s.reihenfolge,
    round(st_area(a.geom)::numeric, 2)::double precision AS area,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry,3857) AS geom
   FROM sprache_flaeche a
     JOIN sprache s ON s.id = a.sprache_id
  WHERE a.is_active AND s.is_active
  ORDER BY a.public_id;

-- VIEW sprache_misch_render
SELECT a.schluessel AS schluessel_a,
    b.schluessel AS schluessel_b,
    a.farbe AS farbe_a,
    b.farbe AS farbe_b,
    m.teil,
    round(st_area(m.geom)::numeric, 2)::double precision AS area,
    map_domain_to_render(m.map_domain_id, m.geom)::geometry(Geometry,3857) AS geom
   FROM sprache_misch m
     JOIN sprache a ON a.id = m.sprache_a_id
     JOIN sprache b ON b.id = m.sprache_b_id
  WHERE a.is_active AND b.is_active
  ORDER BY a.schluessel, b.schluessel, m.teil;

-- VIEW terrain_contour_detail_render
SELECT c.id,
    c.ele,
    c.level,
    c.render_geom AS geom
   FROM terrain_contour c
     JOIN terrain_display_height h ON h.revision = c.revision AND h.is_current
  WHERE c.detail
  ORDER BY c.id;

-- VIEW terrain_contour_render
SELECT c.id,
    c.ele,
    c.level,
    c.render_geom AS geom
   FROM terrain_contour c
     JOIN terrain_display_height h ON h.revision = c.revision AND h.is_current
  WHERE NOT c.detail
  ORDER BY c.id;

-- VIEW terrain_height_band_render
SELECT b.id,
    b.step,
    b.render_geom AS geom
   FROM terrain_height_band b
     JOIN terrain_display_height h ON h.revision = b.revision AND h.is_current
  ORDER BY b.id;

-- VIEW terrain_peak_render
SELECT public_id,
    name,
    subtype,
    height_schritt AS height,
    map_domain_to_render(map_domain_id, geom)::geometry(Point,3857) AS geom,
    subtype = ANY (ARRAY['berggipfel'::text, 'vulkan'::text]) AS formt_gelaende,
    'verborgen'::text = ANY (merkmale) AS is_hidden,
    'ungefaehr'::text = ANY (merkmale) AS is_approximate,
    show_name
   FROM terrain_peak p
  WHERE is_active AND NOT ('nur_gelaende'::text = ANY (merkmale))
  ORDER BY public_id;

-- VIEW terrain_water_eckig_render
SELECT a.public_id,
    r.region_type,
    r.public_id AS region_public_id,
    r.name,
    a.map_domain_id,
    a.geom AS domain_geom
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text])) AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at))
  ORDER BY a.public_id;

-- VIEW terrain_water_render
SELECT a.public_id,
    r.region_type,
    s.render_geom AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text]))
UNION ALL
 SELECT a.public_id,
    r.region_type,
    map_domain_to_render(a.map_domain_id, terrain_water_smooth(a.geom))::geometry(Geometry,3857) AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text])) AND NOT (EXISTS ( SELECT 1
           FROM region_area_smooth s
          WHERE s.region_area_id = a.id AND s.source_updated_at = a.updated_at))
  ORDER BY 1;

-- VIEW terrain_water_rund_render
SELECT a.public_id,
    r.region_type,
    s.render_geom AS geom,
    r.public_id AS region_public_id,
    r.name,
    round(st_area(a.geom)::numeric, 2)::double precision AS area
   FROM region_area a
     JOIN region r ON r.id = a.region_id
     JOIN region_area_smooth s ON s.region_area_id = a.id AND s.source_updated_at = a.updated_at
  WHERE a.is_active AND r.is_active AND NOT r.is_hidden AND (r.region_type = ANY (ARRAY['see'::text, 'meer'::text]))
  ORDER BY a.public_id;

-- VIEW territory_border_render
SELECT b.band,
    b.kind,
    b.level,
    t.public_id AS territory_public_id,
    b.render_geom AS geom,
    b.label_name,
    COALESCE(b.run_to, b.band) AS band_to
   FROM territory_border b
     JOIN territory t ON t.id = b.territory_id
  WHERE t.is_active AND b.band = COALESCE(b.run_from, b.band)
  ORDER BY b.band, b.kind, t.public_id;

-- VIEW territory_claim_render
SELECT cs.band,
    d.public_id AS territory_public_id,
    d.name,
    d.territory_type,
    p.public_id AS parent_public_id,
    p.name AS parent_name,
    round(sh.area::numeric, 2)::double precision AS area,
    x.public_id AS claimed_public_id,
    (('claim-'::text || cs.band::text) || '-'::text) || stripes.colors AS pattern,
    cs.render_geom AS geom
   FROM territory_claim_shape cs
     JOIN territory x ON x.id = cs.territory_id AND x.is_active
     JOIN territory d ON d.id = cs.display_territory_id AND d.is_active
     JOIN territory_shape sh ON sh.band = cs.band AND sh.territory_id = cs.display_territory_id
     LEFT JOIN territory p ON p.id = sh.parent_id
     CROSS JOIN LATERAL ( SELECT lower(replace(x.color, '#'::text, ''::text)) || COALESCE('-'::text || string_agg(lower(replace(c.color, '#'::text, ''::text)), '-'::text ORDER BY tc.sort_order, tc.id), ''::text) AS colors
           FROM territory_claim tc
             JOIN territory c ON c.id = tc.claimant_id AND c.is_active
          WHERE tc.territory_id = x.id AND tc.is_active) stripes
  ORDER BY cs.band, x.public_id;

-- VIEW territory_fill_render
SELECT s.band,
    t.public_id AS territory_public_id,
    t.name,
    t.territory_type,
    p.public_id AS parent_public_id,
    p.name AS parent_name,
    t.color,
    t.opacity::double precision AS opacity,
    t.sort_order,
    s.depth,
    round(s.area::numeric, 2)::double precision AS area,
    COALESCE(s.fill_render_geom, s.render_geom) AS geom,
    s.hatched,
    COALESCE(s.run_to, s.band) AS band_to
   FROM territory_shape s
     JOIN territory t ON t.id = s.territory_id
     LEFT JOIN territory p ON p.id = s.parent_id
  WHERE t.is_active AND s.band = COALESCE(s.run_from, s.band)
  ORDER BY s.band, t.public_id;

-- VIEW territory_label_render
SELECT s.band,
    t.public_id AS territory_public_id,
    t.name,
    t.territory_type,
    t.sort_order,
    s.depth,
    round(s.area::numeric, 2)::double precision AS area,
    map_domain_to_render(t.map_domain_id, s.label_geom)::geometry(Point,3857) AS geom,
    COALESCE(s.run_to, s.band) AS band_to
   FROM territory_shape s
     JOIN territory t ON t.id = s.territory_id
  WHERE t.is_active AND s.band = COALESCE(s.run_from, s.band)
  ORDER BY s.band, t.public_id;

-- FUNCTION label_collision_rank(class_rank smallint, label_priority smallint, appearance_zoom smallint)
CREATE OR REPLACE FUNCTION public.label_collision_rank(class_rank smallint, label_priority smallint, appearance_zoom smallint)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
    SELECT COALESCE(class_rank, 0)::integer * 1000
         -- 5 gewinnt, MapLibre platziert klein zuerst - also gespiegelt. NULL wirkt wie 3.
         + (5 - COALESCE(label_priority, 3))::integer * 100
         -- Bei gleicher Priorität behält den Platz, was schon länger sichtbar war. Legacys
         -- Kommentar dazu wörtlich: „bei gleicher Priorität wird zuerst platziert, was schon
         -- länger sichtbar ist". Das ist der Fall Albernia: ab z1 sichtbar gegen Nachbarn ab z2.
         + COALESCE(appearance_zoom, 0)::integer;
$function$

-- FUNCTION landscape_label_run_tile(z integer, x integer, y integer)
CREATE OR REPLACE FUNCTION public.landscape_label_run_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    tile bytea;
BEGIN
    -- Die Sortierung steht im Aggregat (render-order.test.ts): erst die Mitte je Lauf.
    SELECT ST_AsMVT(source, 'landscape_label_run' ORDER BY source.region_public_id, source.instance_count, source.instance, source.candidate)
    INTO tile
    FROM (
        SELECT
            run.run_id,
            run.region_public_id,
            run.name,
            run.region_layer,
            run.region_type,
            run.label_type,
            run.label_size,
            run.label_priority,
            run.collision_rank,
            run.instance,
            run.instance_count,
            kandidat.ordnung AS candidate,
            run.own_span,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom
        FROM landscape_label_run_render run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd (wie 0030).
        CROSS JOIN LATERAL (
            VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)
        ) AS kandidat(ordnung, versatz)
        CROSS JOIN LATERAL (
            SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte,
                   (need.target / 2.0) / need.laenge AS halb
        ) lage
        CROSS JOIN LATERAL (
            SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo,
                   LEAST(1.0, lage.mitte + lage.halb) AS hi
        ) cut
        WHERE z BETWEEN run.run_min_zoom AND run.run_max_zoom
          AND (
                kandidat.ordnung = 0
                OR (
                    run.instance_count = 1
                    AND lage.mitte - lage.halb >= 0.0
                    AND lage.mitte + lage.halb <= 1.0
                )
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION ley_node_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.ley_node_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'ley_node_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.is_hidden, p.label_min_zoom_override, p.label_max_zoom_override, p.label_visible_override,
            p.label_size_override, p.collision_rank, p.is_ruined, p.node_kind,
            ST_AsMVTGeom(
                ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857),
                envelope, 4096, 64, true
            ) AS geom
        FROM ley_node_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id, p.node_kind
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION map_domain_to_render(domain_id text, geom geometry)
CREATE OR REPLACE FUNCTION public.map_domain_to_render(domain_id text, geom geometry)
 RETURNS geometry
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT ST_SetSRID(
        ST_Translate(
            ST_Scale(
                ST_Translate(geom, -d.min_x, -d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y)
            ),
            -20037508.342789244,
            -20037508.342789244
        ),
        3857
    )
    FROM map_domain d
    WHERE d.id = domain_id;
$function$

-- FUNCTION path_label_run_tile(z integer, x integer, y integer)
CREATE OR REPLACE FUNCTION public.path_label_run_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    units_per_pixel double precision := (2 * 20037508.342789244) / (512.0 * power(2, z));
    karte geometry;
    kleinste_skala double precision;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
               (ST_XMin(envelope) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
               (ST_YMin(envelope) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
               (ST_XMax(envelope) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
               (ST_YMax(envelope) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
               0
           ))),
           min(d.skala)
    INTO karte, kleinste_skala
    FROM map_domain_bounds_render d;

    SELECT ST_AsMVT(
               source,
               'path_label_run'
               ORDER BY source.name, source.subtype, source.part, source.instance, source.candidate
           )
    INTO tile
    FROM (
        SELECT
            run.name,
            run.subtype,
            run.part,
            run.instance,
            run.instance_count,
            run.collision_rank,
            kandidat.ordnung AS candidate,
            ST_AsMVTGeom(ST_LineSubstring(run.geom, cut.lo, cut.hi), envelope, 4096, 4096, false) AS geom,
            run.mark,
            run.is_bach
        FROM (
            SELECT
                b.name, b.subtype, b.part, b.instance, b.instance_count, b.name_width_px, b.collision_rank, b.mark, b.is_bach,
                ST_SetSRID(
                    ST_Translate(ST_Scale(ST_Translate(b.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244),
                    3857
                )::geometry(LineString, 3857) AS geom
            FROM path_label_run_basis_render b
            JOIN map_domain_bounds_render d ON d.map_domain_id = b.map_domain_id
            WHERE z BETWEEN b.run_min_zoom AND b.run_max_zoom
              AND ST_Intersects(
                      ST_LineInterpolatePoint(b.domain_geom, 0.5),
                      ST_Expand(karte, GREATEST(b.name_width_px * units_per_pixel / kleinste_skala, ST_Length(b.domain_geom)) / 2.0)
                  )
            OFFSET 0
        ) run
        CROSS JOIN LATERAL (
            SELECT run.name_width_px * units_per_pixel AS target, NULLIF(ST_Length(run.geom), 0) AS laenge
        ) need
        -- Reihenfolge = Vorrang: erst die Mitte, dann nah, dann weiter, je abwechselnd.
        CROSS JOIN LATERAL (
            VALUES (0, 0.0), (1, 0.125), (2, -0.125), (3, 0.25), (4, -0.25)
        ) AS kandidat(ordnung, versatz)
        CROSS JOIN LATERAL (
            SELECT 0.5 + kandidat.versatz * need.target / need.laenge AS mitte,
                   (need.target / 2.0) / need.laenge AS halb
        ) lage
        CROSS JOIN LATERAL (
            SELECT GREATEST(0.0, lage.mitte - lage.halb) AS lo,
                   LEAST(1.0, lage.mitte + lage.halb) AS hi
        ) cut
        WHERE (
                kandidat.ordnung = 0
                OR (lage.mitte - lage.halb >= 0.0 AND lage.mitte + lage.halb <= 1.0)
              )
          AND ST_Intersects(
                  ST_LineInterpolatePoint(run.geom, 0.5),
                  ST_Expand(envelope, GREATEST(need.target, ST_Length(run.geom)) / 2.0)
              )
    ) source;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION path_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.path_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'path_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.label_visible, p.is_bach, p.collision_rank, p.flow_direction, p.is_tunnel, p.mark,
            ST_AsMVTGeom(
                ST_Simplify(
                    ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)::geometry(LineString, 3857),
                    toleranz
                ),
                envelope, 4096, 64, true
            ) AS geom
        FROM path_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION place_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.place_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'place_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            p.public_id, p.name, p.subtype, p.is_hidden, p.label_min_zoom_override, p.label_max_zoom_override, p.label_visible_override,
            p.label_size_override, p.collision_rank, p.is_ruined, p.is_nodix, p.capital_bands, p.is_approximate, p.is_unofficial,
            ST_AsMVTGeom(
                ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(p.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857),
                envelope, 4096, 64, true
            ) AS geom
        FROM place_basis_render p
        JOIN map_domain_bounds_render d ON d.map_domain_id = p.map_domain_id
        WHERE p.domain_geom && karte
        ORDER BY p.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION region_area_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.region_area_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'region_area_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            a.public_id, a.region_public_id, a.name, a.region_layer, a.region_type, a.stack_order, a.is_locked, a.area,
            ST_AsMVTGeom(ST_Simplify(a.render_form, toleranz), envelope, 4096, 64, true) AS geom
        FROM (
            SELECT r.public_id, r.region_public_id, r.name, r.region_layer, r.region_type, r.stack_order, r.is_locked, r.area,
                   r.geom AS render_form
            FROM region_area_rund_render r
            WHERE r.geom && rahmen
            UNION ALL
            SELECT e.public_id, e.region_public_id, e.name, e.region_layer, e.region_type, e.stack_order, e.is_locked,
                   round(ST_Area(e.domain_geom)::numeric, 2)::double precision,
                   ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(e.domain_geom, -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)
            FROM region_area_eckig_render e
            JOIN map_domain_bounds_render d ON d.map_domain_id = e.map_domain_id
            WHERE e.domain_geom && karte
        ) a
        ORDER BY a.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION terrain_contour_detail_tile(z integer, x integer, y integer)
CREATE OR REPLACE FUNCTION public.terrain_contour_detail_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_contour_detail_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT c.id, c.ele, c.level, ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_contour_detail_render c
        WHERE c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION terrain_contour_tile(z integer, x integer, y integer)
CREATE OR REPLACE FUNCTION public.terrain_contour_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    niedrigste smallint := CASE WHEN z < 4 THEN 2 WHEN z < 5 THEN 1 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_contour_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT c.id, c.ele, c.level, ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_contour_render c
        WHERE c.level >= niedrigste AND c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION terrain_height_band_tile(z integer, x integer, y integer)
CREATE OR REPLACE FUNCTION public.terrain_height_band_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 1024.0 ELSE 0 END;
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'terrain_height_band_render', 4096, 'geom', 'id')
    INTO tile
    FROM (
        SELECT b.id, b.step, ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM terrain_height_band_render b
        WHERE b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION terrain_water_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.terrain_water_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    rahmen geometry := ST_Expand(envelope, breite * 64 / 4096);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    karte geometry;
    tile bytea;
BEGIN
    SELECT ST_Envelope(ST_Collect(ST_MakeEnvelope(
        (ST_XMin(rahmen) + 20037508.342789244) / d.skala + d.min_x - 1e-6,
        (ST_YMin(rahmen) + 20037508.342789244) / d.skala + d.min_y - 1e-6,
        (ST_XMax(rahmen) + 20037508.342789244) / d.skala + d.min_x + 1e-6,
        (ST_YMax(rahmen) + 20037508.342789244) / d.skala + d.min_y + 1e-6,
        0
    )))
    INTO karte
    FROM map_domain_bounds_render d;
    SELECT ST_AsMVT(source, 'terrain_water_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            w.public_id, w.region_type, w.region_public_id, w.name, w.area,
            ST_AsMVTGeom(ST_Simplify(w.render_form, toleranz), envelope, 4096, 64, true) AS geom
        FROM (
            SELECT r.public_id, r.region_type, r.region_public_id, r.name, r.area, r.geom AS render_form
            FROM terrain_water_rund_render r
            WHERE r.geom && rahmen
            UNION ALL
            SELECT e.public_id, e.region_type, e.region_public_id, e.name,
                   round(ST_Area(e.domain_geom)::numeric, 2)::double precision,
                   ST_SetSRID(ST_Translate(ST_Scale(ST_Translate(ST_ChaikinSmoothing(e.domain_geom, 3), -d.min_x, -d.min_y), d.skala, d.skala), -20037508.342789244, -20037508.342789244), 3857)
            FROM terrain_water_eckig_render e
            JOIN map_domain_bounds_render d ON d.map_domain_id = e.map_domain_id
            WHERE e.domain_geom && karte
        ) w
        ORDER BY w.public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION territory_border_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.territory_border_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    -- Die niedrigste Bandnummer, die eine Kachel dieses Zooms tragen muss (siehe oben); nach oben trägt jede Kachel alle Bänder.
    lowest smallint := GREATEST(0, z - 3);
    tile bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_border_render', 4096, 'geom')
    INTO tile
    FROM (
        SELECT
            b.band, b.band_to, b.kind, b.level, b.territory_public_id, b.label_name,
            ST_AsMVTGeom(ST_Simplify(b.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_border_render b
        WHERE b.band_to >= lowest AND b.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY b.band, b.kind, b.level, b.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(tile, ''::bytea);
END;
$function$

-- FUNCTION territory_tile(z integer, x integer, y integer, query_params json)
CREATE OR REPLACE FUNCTION public.territory_tile(z integer, x integer, y integer, query_params json)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    envelope geometry := ST_TileEnvelope(z, x, y);
    breite double precision := ST_XMax(envelope) - ST_XMin(envelope);
    toleranz double precision := CASE WHEN z < 8 THEN breite / 2048.0 ELSE 0 END;
    -- Die niedrigste Bandnummer, die eine Kachel dieses Zooms tragen muss (siehe oben); nach oben trägt jede Kachel alle Bänder.
    lowest smallint := GREATEST(0, z - 3);
    fill bytea;
    labels bytea;
    claims bytea;
BEGIN
    SELECT ST_AsMVT(source, 'territory_fill_render', 4096, 'geom')
    INTO fill
    FROM (
        SELECT
            f.band, f.band_to, f.territory_public_id, f.name, f.territory_type, f.parent_public_id, f.parent_name,
            f.color, f.sort_order, f.depth, f.area, f.hatched,
            ST_AsMVTGeom(ST_Simplify(f.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_fill_render f
        WHERE f.band_to >= lowest AND f.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY f.band, f.sort_order, f.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    SELECT ST_AsMVT(source, 'territory_label_render', 4096, 'geom')
    INTO labels
    FROM (
        SELECT
            l.band, l.band_to, l.territory_public_id, l.name, l.territory_type, l.sort_order, l.depth, l.area,
            ST_AsMVTGeom(l.geom, envelope, 4096, 64, true) AS geom
        FROM territory_label_render l
        WHERE l.band_to >= lowest AND l.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY l.band, l.sort_order, l.territory_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    SELECT ST_AsMVT(source, 'territory_claim_render', 4096, 'geom')
    INTO claims
    FROM (
        SELECT
            c.band, c.territory_public_id, c.name, c.territory_type, c.parent_public_id, c.parent_name, c.area,
            c.claimed_public_id, c.pattern,
            ST_AsMVTGeom(ST_Simplify(c.geom, toleranz), envelope, 4096, 64, true) AS geom
        FROM territory_claim_render c
        WHERE c.band >= lowest AND c.geom && ST_Expand(envelope, breite * 64 / 4096)
        ORDER BY c.band, c.claimed_public_id
    ) source
    WHERE source.geom IS NOT NULL;
    RETURN COALESCE(fill, ''::bytea) || COALESCE(labels, ''::bytea) || COALESCE(claims, ''::bytea);
END;
$function$
