# Stabilization Smoke Test

Run the read-only smoke test against production:

```powershell
py tools/smoke_test.py --base-url "https://avesmaps.de/"
```

Optional DB/table status check with the import/admin token:

```powershell
py tools/smoke_test.py --base-url "https://avesmaps.de/" --admin-token "YOUR_IMPORT_TOKEN"
```

The script does not create, edit, or delete map data. It checks:

- frontend reachability and SQL/stylized configuration
- `api/map-features.php` JSON, feature count, and revision
- basic geometry bounds
- duplicate public IDs
- anonymous access rejection for review/audit APIs
- optional admin DB status when a token is supplied

## Manual Smoke Checklist

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
