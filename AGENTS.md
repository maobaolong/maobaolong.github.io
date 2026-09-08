# Repository Guidance

- In this Codex desktop environment, `node` and `npm` are not on the default `PATH`. Use the bundled runtime at `/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` or prepend that directory to `PATH` before running `pnpm` commands.
- The bundled `pnpm` executable lives at `/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm`.
- For local verification here, a reliable setup is:
  - `export PATH="/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/mbl/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"`
  - `pnpm install && pnpm build`
- Quote YAML frontmatter strings that contain GitHub issue or PR references such as `#4998`; in an unquoted `description`, `#` starts a YAML comment and silently truncates the rendered metadata.
- The Pages workflow currently emits a Node.js 20 deprecation annotation for `actions/checkout@v4`, `actions/configure-pages@v5`, and `actions/deploy-pages@v4`; GitHub forces them onto Node.js 24 and the deployment still succeeds, so treat it as an upstream-action migration warning rather than an Astro build failure.
- This site is prepared for GitHub Pages. Use `SITE_URL=https://<username>.github.io` and:
  - no `BASE_PATH` for a `<username>.github.io` repository
  - `BASE_PATH=/repo-name` for a project site repository
- The current production architecture does not use Decap CMS. `/admin/` and the interactive widgets use GitHub OAuth Device Flow through the `auth-service/` Vercel helper, and comments/guestbook use GitHub Issues plus Reactions.
- For the `auth-service/` Vercel helper, prefer zero-config Node API routes. Pinning `@vercel/node` inside `vercel.json` caused `peer-version-mismatch` on direct API deployments.
- New Vercel team projects may default to SSO protection for non-custom domains. If the auth helper returns a Vercel SSO redirect or anonymous 404s, clear project `ssoProtection` before validating the public GitHub Pages integration.
