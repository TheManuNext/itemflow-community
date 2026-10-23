# ItemFlow — Compatibility and support policy

Supported versions, and how updates to Frappe/ERPNext are handled.

---

## Supported stack

| Component | Supported | Notes |
|---|---|---|
| Frappe Framework | **v16** (branch `version-16`) | One major version at a time. |
| ERPNext | **v16** (branch `version-16`) | `required_apps = ["erpnext"]`. |
| Python | **3.14** (`>=3.14,<3.15`) | Matches Frappe v16's own pin (`frappe/pyproject.toml`). |
| MariaDB | tested with **11.8** | Database engine used in development and the reference production setup. |
| Node.js | **24** | Only needed to build front-end assets (`bench build`). |
| Redis | cache + queue | Provided by the bench (cache, queue and Socket.IO). |

> The environment is validated against the versions above. Other minor versions
> of the same major are expected to work, but are only verified when the CI
> pipeline runs against them.

Verify the running versions with:

```bash
bench version
bench --site <site> list-apps
```

---

## Versioning

ItemFlow follows semantic versioning:

- **Features** → minor bump (for example, `2.6.0` → `2.7.0`).
- **Fixes and refinements** → patch bump (for example, `2.6.0` → `2.6.1`).

Every release is tagged (`vX.Y.Z`) on the `version-16` branch.

---

## Update policy

- The app tracks the **`version-16`** branch and supports only the **latest
  16.x** of Frappe/ERPNext. Older 16.x point releases are not separately
  supported.
- **Minor updates** to Frappe/ERPNext:
  1. Update the stack.
  2. Run `bench --site <site> migrate`.
  3. Run the CI checks locally: `pre-commit run --all-files`,
     `bench --site <site> run-tests --app itemflow` and `yarn test` (vitest).
  4. Validate in **staging** before production.
- **Major updates** (for example, v16 → v17): a new branch (`version-17`) is
  created and the app is reviewed for API and hook changes. A major upgrade is a
  deliberate, reviewed change; never assume it works.
- Only **one** Frappe/ERPNext major is supported at a time. Support for a major
  ends when the next major becomes the target.

---

## App requirements

- `pyproject.toml` pins `requires-python = ">=3.14,<3.15"` to mirror Frappe v16.
- `frappe` itself is installed and managed by the bench (it is not declared as a
  hard dependency), and `erpnext` is required at install time.
- No separate process: ItemFlow runs inside the standard bench process model.
