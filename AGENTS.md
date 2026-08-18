# Repository Guidance

- In this Codex desktop environment, `node` and `npm` are not on the default `PATH`. Use the bundled runtime at `/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` or prepend that directory to `PATH` before running `pnpm` commands.
- The bundled `pnpm` executable lives at `/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm`.
- For local verification here, a reliable setup is:
  - `export PATH="/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"`
  - `pnpm install && pnpm build`
- This site is prepared for GitHub Pages. Use `SITE_URL=https://<username>.github.io` and:
  - no `BASE_PATH` for a `<username>.github.io` repository
  - `BASE_PATH=/repo-name` for a project site repository
- Decap CMS GitHub login needs an OAuth handler. Update `public/admin/config.yml` with your deployed worker URL before testing `/admin`.
