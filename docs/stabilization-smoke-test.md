# Stabilization Smoke Test

Run the read-only smoke test against production:

```powershell
py tools/smoke_test.py --base-url "https://avesmaps.de/"
```

Optional DB/table status check with the import/admin token:

```powershell
py tools/smoke_test.py --base-url "https://avesmaps.de/"
```

The script does not create, edit, or delete map data. It checks:

- frontend reachability and SQL/stylized configuration
- `api/map-features.php` JSON, feature count, and revision
- basic geometry bounds
- duplicate public IDs
- anonymous access rejection for review/audit APIs
- optional admin DB status when a token is supplied

## Local Smoke-Test Scope

- `python -m http.server 8000` is suitable for static UI and asset checks only.
- Full SQL data and routing smoke tests require configured read-only API endpoints (`MAP_FEATURES_API_URL`, `MAP_SEARCH_API_URL`, `POLITICAL_TERRITORIES_API_URL`).
- Use one of these options for full tests:
  - run against [https://avesmaps.de/](https://avesmaps.de/)
  - or set explicit frontend overrides before loading Avesmaps:

```html
<script>
	window.AVESMAPS_MAP_FEATURES_ENDPOINT = "https://example.org/api/map-features.php";
	window.AVESMAPS_MAP_SEARCH_ENDPOINT = "https://example.org/api/map-search.php";
	window.AVESMAPS_POLITICAL_TERRITORIES_ENDPOINT = "https://example.org/api/political-territories.php";
</script>
```

- When a local frontend calls a public API, CORS must allow the exact local origin (for example `http://localhost:8000`).
- For local PHP/API tests, run `php -S localhost:8000` and provide `api/config.local.php` or the required `AVESMAPS_DB_*` and `AVESMAPS_ALLOWED_ORIGINS` environment variables.

## Manual Smoke Checklist

- Detailed routing/transport regression cases: `docs/routing-transport-smoke-checklist.md`
- Frontpage loads the stylized map and SQL vector data.
- Route planning works for a simple route between two existing locations.
- Location class toggles show and hide markers and location-name labels together.
- `/edit/` requires login.
- In edit mode, `Mapstyle` switches between `Old` and `Stylized`.
- Create, edit, move, and delete a temporary test location.
- Create, edit, and delete a temporary crossing.
- Create, edit, and delete a temporary path.
- Edit one existing path geometry and verify the change is logged.
- Edit one region color/opacity, then restore it.
- Create, edit, and delete a temporary label.
- Review panel loads and can focus a reported location.
- Change log loads and can focus changed objects.
- `/admin/` requires admin login and lists users.
