# Contributing

ItemFlow is a personal project maintained as time allows. Contributions are
welcome, but review times may vary.

Repository: https://github.com/TheManuNext/itemflow-community

---

## Issues

A useful issue includes:

- Frappe/ERPNext and ItemFlow versions
- The doctype where the problem occurs
- Steps to reproduce it
- Screenshots and console errors

Please keep each issue focused on one problem. If you are unsure whether
something is a bug or expected behaviour, open an issue and describe what you
expected to happen.

---

## Pull requests

- Keep the change focused on one problem.
- Explain the expected behaviour, not only the code.
- If the change affects the interface, include before and after screenshots.
- For larger changes, open an issue first to discuss the approach.
- Add or update tests where the change affects logic or configuration.
- Run the checks below before submitting.

---

## Development setup

```bash
yarn install --frozen-lockfile
yarn test
```

For backend tests, use a bench with a test site:

```bash
bench --site <site> set-config allow_tests true
bench --site <site> run-tests --app itemflow
```

The same checks run in CI on every push and pull request.

---

## Areas where help is most useful

- Frappe ecosystem structure and conventions
- Performance with large catalogues (2,000+ items, not yet tested)
- Compatibility with different installations and versions
- Multi-UOM and multi-company use cases
- Accessibility and interface clarity

---

## AI-generated code

The code has been generated with AI and directed by a human. Reviews that
identify bugs, poor practices or inconsistent logic are especially valuable.

---

## Licence

By contributing, you agree that your contribution will be distributed under
GPLv3, the same licence as the project.
