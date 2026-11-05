# Landing site

Independent static Astro site. The screenshots use staged open-film data and generated sample clips. The landing page never connects to local files, installed apps, or devices.

## Development

Run inside `site/`:

```sh
bun install --frozen-lockfile
bun run dev
bun run verify
```

`verify` type-checks Astro, builds static output, and checks routes, discovery, anchors, assets, and documentation. Browser review covers desktop/mobile layouts, keyboard access, demo interactions and reset, theme switching, copy buttons, and optional-detail disclosures.

## Vercel

The dedicated Vercel project is `tvcast` in `pushkar-patels-projects`. GitHub Actions deploys from `site/`, so leave the Vercel **Root Directory** unset. Use **Framework: Astro**, **Install Command: `bun install --frozen-lockfile`**, **Build Command: `bun run verify`**, **Output Directory: `dist`**, and Node.js 24.

`.github/workflows/site.yml` verifies pull requests without deployment credentials. Every push to `main` runs `vercel pull`, `vercel build --prod`, and `vercel deploy --prebuilt --prod`. The build runs all site checks before publishing the resulting artifact. Production runs are serialized; manual dispatch is supported on `main`. Existing application workflows run independently. Leave Vercel Git integration disconnected to avoid duplicate deployments.

GitHub repository variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` identify the destination. The `VERCEL_TOKEN` repository secret is a dedicated project-scoped token. Rotate it in Vercel and replace the GitHub secret when needed; never commit credentials or the generated `.env.local` and `.vercel/` files. The public site itself requires no runtime environment variables or backend.

`vercel.json` supplies build settings and response headers. Add the production hostname from `astro.config.mjs` and `src/content.json` under Vercel Domains, then add the exact CNAME Vercel supplies at the current DNS provider.

## Content and discovery

`src/pages/index.astro` contains the concise landing flow. `src/content.json` supplies shared copy for `/index.md` and `/llms.txt`. `src/agent-guide.md` supplies the installation and usage guide at `/agents.md`; keep its commands and behavior aligned with the repository README and supported interfaces. Edit it to keep installation instructions, supported interfaces, and limitations consistent. `src/components/Demo.astro` provides the interactive preview. Capture descriptions and links are also included in the Markdown overview.

Canonical and social URLs use the production subdomain. `/robots.txt` and `/sitemap.xml` use the same host. Public production must be reachable without Vercel Authentication or browser challenges so unauthenticated people and agents can read it. Builds with `VERCEL_ENV=preview` emit a `noindex` meta tag; Vercel also supplies a noindex response header on preview URLs. Preview access can remain protected.

Search and social titles, social image descriptions, and supported operating systems live in `src/content.json`. `PageHead.astro` emits Open Graph, Twitter cards, and SoftwareApplication JSON-LD with author and product screenshots. Keep `public/social.svg` and its 1200 × 630 PNG export synchronized with the headline. `verify` checks the generated metadata, PNG dimensions, and environment-specific indexing policy.

After deployment, check the custom-domain homepage, `/social.png`, `/index.md`, `/agents.md`, `/llms.txt`, `/robots.txt`, and `/sitemap.xml` without authentication. Confirm the production response has no noindex directive and preview responses do. Submit the sitemap in Search Console and link the production site from the repository README and portfolio. These external launch steps require the public domains to be live.

The screenshots use actual application UI with staged data. Official Blender Studio posters are licensed CC BY 4.0; source links, license links, creator credits, and usage notes are in the footer and `public/artwork/ATTRIBUTION.txt`. TV Cast uses its existing application icon. The site makes no third-party font or analytics requests. Product documentation is authoritative for the installed version.

## Updating app captures

Run `bun scripts/preview-fixture.ts` from `site/`. It serves the checked-in `tvcast/panel.html`, scripts, and styles at `http://127.0.0.1:4331`, with a read-only staged catalogue. The fixture does not run the Python service or access media or TVs.

Use an isolated browser session at 740 × 820 with device scale factor 2. Capture `/?theme=dark#/library` to `public/screenshots/library.png`, then `/?theme=dark#/movie/sample-0` to `details.png`. Repeat with `theme=light` for `library-light.png` and `details-light.png`. Wait for the movie details and artwork to load, and blur the focused heading before capture. Pass absolute screenshot output paths to agent-browser. Stop the fixture server afterward; it is not part of the static deployment.

`public/app-icon.svg` is copied from `docs/images/shortcut-icon.svg`; `public/favicon.svg` is decoded from the app panel's favicon. Keep these synchronized with the app identity.

## Appearance

One icon button cycles System (default) → Light → Dark → System. Its icon shows the current mode; its tooltip and accessible label identify the current mode and next action. CSS `color-scheme` and `light-dark()` follow the OS automatically in System mode, including without JavaScript. An explicit choice is applied before paint and saved in local storage; resetting to System removes the override. TV Cast and IINA demo frames follow the effective page theme. The MLS terminal retains its dark terminal palette.

The product layouts are independent. Shared utilities cover metadata, theme selection, copy controls and attribution. Keep user-facing product copy and the Markdown content in `src/content.json` consistent when changing the page.

## Interactive preview

The preview places the real TV Cast panel inside a Mac browser window. Open a film locally to launch a separate mock IINA player, or cast it to the paired Samsung TV. Local playback and TV playback have independent position and play/pause state. Both use poster artwork, without video or audio streaming. The browser never accesses real devices or local files. Reset clears the app, local player, and TV.

Run `bun run demo:build` after changing the upstream app UI or files in `demo/`. The builder reads the real app sources and writes a self-contained `public/demo/index.html`; include that generated artifact with the site. Normal dev/build and Vercel deployment use the artifact directly, so no fixture server, parent-source build access, or backend is required.

The frame permits scripts and local form events, without same-origin privileges. Storage and service operations remain in memory, and its CSP blocks network connections and form navigation. Theme messages validate their source window. Configuration/token controls and advanced app, typing, and power controls are omitted from the demo. The compact frame styles keep transport controls on one row, with Stop underneath. Static screenshots remain available as a no-JavaScript fallback and in the Markdown guide.

The mock TV beside the app listens only to state messages from its own sandboxed iframe. It displays public poster artwork with simulated playback, timeline, volume, and mute; no media is streamed. Reset clears both the app and TV to a paired Samsung sample. TV menu choices also support direct clicks; messages are restricted to the owning frame and parent. The browser scrolls inside a fixed landscape laptop viewport, with the smaller TV on the right at desktop widths.
