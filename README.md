# marcuccinicolo.github.io

My portfolio. A static site with **no dependencies** — the build script uses only
the Node standard library, so there is no `npm install`, no lockfile, and nothing
to keep updated.

```bash
node build.mjs           # build into dist/
node build.mjs --serve   # build, then serve dist/ at http://localhost:8000
```

## How it fits together

```
src/data/profile.json        me, links, "how I work", tools
src/data/projects/*.json     one file per project — the only thing you normally edit
src/styles.css               the whole design; no framework
public/                      images, CV, favicon — copied to dist/ as-is
build.mjs                    renders the JSON into dist/
.github/workflows/deploy.yml builds and publishes on every push to main
```

`build.mjs` reads the JSON, renders the home page and one case-study page per
project, and writes everything to `dist/`. `dist/` is generated — it is
gitignored and never committed. GitHub Actions rebuilds it on push.

## Adding a project

1. **Add the image.** Put it in `public/img/`. Aim for roughly 1400px wide and
   under ~250 KB. To resize and compress one on macOS without installing anything:

   ```bash
   sips -s format jpeg -s formatOptions 80 -Z 1400 source.png --out public/img/my-project.jpg
   ```

2. **Add the JSON.** Copy an existing file in `src/data/projects/` and edit it.
   The filename does not matter; `order` decides where the card appears.

   ```jsonc
   {
     "order": 6,                        // position in the grid
     "slug": "my-project",              // becomes /my-project/
     "title": "My Project",
     "tagline": "One sentence. **Bold** and *italics* work here.",
     "year": "2026",
     "role": "Solo — analysis and write-up",
     "stack": ["Python", "SQL"],        // shown as small tags
     "links": {
       "demo": "https://example.com",   // null hides the button entirely
       "code": "https://github.com/..." // null for a private repo
     },
     "card": {
       "image": "img/my-project.jpg",
       "focus": "top"                   // optional: object-position for the crop
     },
     "caseStudy": {
       "hero":  { "src": "img/my-project.jpg", "alt": "...", "caption": "..." },
       "problem": ["One or two paragraphs."],
       "dataHeading": "The data",       // optional: rename this section
       "data":   ["Where it came from, and what it cannot support."],
       "built":  ["What you actually made."],
       "images": [{ "src": "...", "alt": "...", "caption": "..." }],
       "result": ["What came out of it."],
       "technical": ["The detail, for people who want it."]
     }
   }
   ```

3. **Build and look at it.**

   ```bash
   node build.mjs --serve
   ```

4. **Push.** The Action rebuilds and publishes within a minute or two.

### Writing rules that keep the site honest

- Every text field is an **array of paragraphs**. Keep the four narrative
  sections to about 200 words in total — the case study is a summary, not a report.
- Inline formatting is deliberately limited to `**bold**`, `*italics*`,
  `` `code` `` and `[links](https://…)`. If you find yourself wanting headings or
  bullet lists inside a case study, the copy is too long.
- Any string starting with `TODO_` is treated as a placeholder: it renders
  visibly on the page in a dashed box, and `node build.mjs` prints a count of
  what is still open. Nothing with a `TODO_` in it should be linked from a job
  application.
- A `"demo"` or `"code"` set to `null` hides that button instead of rendering a
  dead link.

## Deploying

The site is already configured for GitHub Pages via Actions. First time:

1. Create a **public** repository named exactly `marcuccinicolo.github.io`.
2. Push this folder to it:

   ```bash
   git remote add origin https://github.com/marcuccinicolo/marcuccinicolo.github.io.git
   git branch -M main
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Watch the **Actions** tab. When it finishes the site is at
   <https://marcuccinicolo.github.io>.

After that, every push to `main` redeploys. There is nothing to build locally
before pushing — `dist/` is not committed.

### Using a custom domain later

Add a file called `CNAME` to `public/` containing just the domain, point the
domain's DNS at GitHub Pages, and set it under Settings → Pages.

## Design notes

- **No webfonts.** Headings and prose use a system serif stack, interface text a
  system sans. Nothing is fetched from a third party, so there is no flash of
  unstyled text and no request to Google.
- **Light and dark are both designed**, driven by `prefers-color-scheme`. Colours
  live in custom properties at the top of `styles.css`; that is the only place to
  change them.
- **Images carry real `width` and `height`.** `build.mjs` reads the dimensions
  out of the JPEG and PNG headers at build time, so the page never reflows as
  images load.
- **Accessibility is structural**, not a pass at the end: semantic landmarks, a
  skip link, visible focus rings, alt text on every meaningful image, decorative
  card images hidden from screen readers, and a `prefers-reduced-motion` rule.
