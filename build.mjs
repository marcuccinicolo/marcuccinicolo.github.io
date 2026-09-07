#!/usr/bin/env node
// Builds the static site into dist/. Node standard library only — no dependencies.
//
//   node build.mjs          build once
//   node build.mjs --serve  build, then serve dist/ on http://localhost:8000
//
// Content lives in src/data/. Adding a project means adding one JSON file to
// src/data/projects/ — nothing here needs to change.

import { readFile, readdir, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const SRC = new URL('src/', import.meta.url);
const DIST = new URL('dist/', import.meta.url);

/* ------------------------------------------------------------------ text -- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ESCAPES[c]);

// A deliberately tiny inline formatter: **bold**, `code`, and [text](url).
// Everything else is escaped. Case studies are prose, not documents — if this
// ever needs headings or lists, that is a sign the copy is too long.
export function inline(text = '') {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" rel="noopener">$1</a>');
}

const paras = (value = []) =>
  (Array.isArray(value) ? value : [value]).map(p => `<p>${inline(p)}</p>`).join('\n');

/* ---------------------------------------------------------- image sizing -- */

// Reads intrinsic dimensions straight out of the file so every <img> can carry
// width and height, and the page never reflows as images arrive.
async function imageSize(path) {
  const buf = await readFile(path);
  if (buf[0] === 0x89 && buf[1] === 0x50) {                    // PNG: IHDR
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {                    // JPEG: walk to SOF
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf &&
          ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  throw new Error(`cannot read dimensions of ${path}`);
}

const sizeCache = new Map();
async function figureAttrs(src) {
  if (!sizeCache.has(src)) {
    sizeCache.set(src, await imageSize(new URL(`public/${src}`, import.meta.url)));
  }
  const { width, height } = sizeCache.get(src);
  return `width="${width}" height="${height}"`;
}

/* -------------------------------------------------------------- partials -- */

const isTodo = value => typeof value === 'string' && value.startsWith('TODO_');

// Every page below the root is served from its own directory, so asset paths
// have to be absolute or /baseline/ would look for /baseline/img/...
const asset = src => (src.startsWith('/') ? src : `/${src}`);

async function figure({ src, alt, caption }, { lazy = true } = {}) {
  if (isTodo(src)) {
    return `<figure class="figure figure--todo">
      <div class="figure__placeholder">${esc(src)}</div>
      ${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}
    </figure>`;
  }
  return `<figure class="figure">
    <img src="${esc(asset(src))}" alt="${esc(alt)}" ${await figureAttrs(src)}
         ${lazy ? 'loading="lazy" decoding="async"' : ''}>
    ${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}
  </figure>`;
}

const tags = list => `<ul class="tags">${
  list.map(t => `<li>${esc(t)}</li>`).join('')
}</ul>`;

// A link is only rendered as a button when it actually points somewhere. An
// unfinished demo shows as a disabled note instead of a dead button.
function actions(links, { size = '' } = {}) {
  const out = [];
  if (links.demo && !isTodo(links.demo)) {
    out.push(`<a class="btn btn--primary" href="${esc(links.demo)}" rel="noopener">Live demo</a>`);
  } else if (isTodo(links.demo)) {
    out.push(`<span class="btn btn--todo">${esc(links.demo)}</span>`);
  }
  if (links.code && !isTodo(links.code)) {
    out.push(`<a class="btn" href="${esc(links.code)}" rel="noopener">Code</a>`);
  }
  if (!out.length) return '';
  return `<div class="actions ${size}">${out.join('')}</div>`;
}

/* ----------------------------------------------------------------- pages -- */

function layout({ title, description, body, path }) {
  const canonical = `https://marcuccinicolo.github.io${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${body}
</body>
</html>
`;
}

function header(profile, { home = false } = {}) {
  return `<header class="site-header">
  <div class="wrap site-header__inner">
    ${home
      ? `<span class="site-header__name">${esc(profile.name)}</span>`
      : `<a class="site-header__name" href="/">${esc(profile.name)}</a>`}
    <nav aria-label="Primary">
      <a href="/#projects">Projects</a>
      <a href="/#how-i-work">How I work</a>
      <a href="${esc(profile.links.cv)}">CV</a>
    </nav>
  </div>
</header>`;
}

function footer(profile) {
  const link = (href, label) =>
    `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`;
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="site-footer__links">
      ${link(profile.links.github, 'GitHub')}
      ${link(profile.links.linkedin, 'LinkedIn')}
      ${link(profile.links.cv, 'CV (PDF)')}
      ${link(`mailto:${profile.links.email}`, profile.links.email)}
    </p>
    <p class="site-footer__note">Built as a static site with no dependencies.
      <a href="${esc(profile.links.siteSource)}" rel="noopener">Source</a>.</p>
  </div>
</footer>`;
}

async function projectCard(p) {
  return `<article class="card">
  <a class="card__media" href="/${esc(p.slug)}/" tabindex="-1" aria-hidden="true">
    ${isTodo(p.card.image)
      ? `<span class="figure__placeholder">${esc(p.card.image)}</span>`
      : `<img src="${esc(asset(p.card.image))}" alt="" ${await figureAttrs(p.card.image)}
             loading="lazy" decoding="async"
             style="object-position:${esc(p.card.focus || 'center')}">`}
  </a>
  <div class="card__body">
    <h3 class="card__title"><a href="/${esc(p.slug)}/">${esc(p.title)}</a></h3>
    <p class="card__line">${inline(p.tagline)}</p>
    ${tags(p.stack)}
    ${actions(p.links)}
  </div>
</article>`;
}

async function renderIndex(profile, projects) {
  const cards = (await Promise.all(projects.map(projectCard))).join('\n');

  const body = `${header(profile, { home: true })}
<main id="main">
  <section class="wrap intro">
    <h1>${esc(profile.name)}</h1>
    <p class="intro__role">${inline(profile.role)}</p>
    ${paras(profile.intro)}
    <p class="intro__links">
      <a class="btn btn--primary" href="${esc(profile.links.cv)}">CV (PDF)</a>
      <a class="btn" href="${esc(profile.links.github)}" rel="noopener">GitHub</a>
      <a class="btn" href="${esc(profile.links.linkedin)}" rel="noopener">LinkedIn</a>
      <a class="btn" href="mailto:${esc(profile.links.email)}">Email</a>
    </p>
  </section>

  <section class="wrap section" id="projects" aria-labelledby="projects-h">
    <h2 id="projects-h" class="section__title">Projects</h2>
    <p class="section__lead">${inline(profile.projectsLead)}</p>
    <div class="grid">${cards}</div>
  </section>

  <section class="wrap section" id="how-i-work" aria-labelledby="how-h">
    <h2 id="how-h" class="section__title">How I work</h2>
    <div class="principles">
      ${profile.howIWork.map(item => `<div class="principle">
        <h3>${esc(item.title)}</h3>
        <p>${inline(item.body)}</p>
      </div>`).join('\n')}
    </div>
    <h2 class="section__title section__title--sub" id="skills">Tools</h2>
    <p class="section__lead">${inline(profile.skillsLead)}</p>
    <dl class="skills">
      ${profile.skills.map(g => `<div class="skills__row">
        <dt>${esc(g.level)}</dt>
        <dd>${esc(g.items.join(' · '))}</dd>
      </div>`).join('\n')}
    </dl>
  </section>

  <section class="wrap section" id="contact" aria-labelledby="contact-h">
    <h2 id="contact-h" class="section__title">Contact</h2>
    ${paras(profile.contact)}
    <p class="intro__links">
      <a class="btn btn--primary" href="mailto:${esc(profile.links.email)}">${esc(profile.links.email)}</a>
      <a class="btn" href="${esc(profile.links.linkedin)}" rel="noopener">LinkedIn</a>
    </p>
  </section>
</main>
${footer(profile)}`;

  return layout({
    title: `${profile.name} — ${profile.shortRole}`,
    description: profile.metaDescription,
    path: '/',
    body,
  });
}

async function renderProject(profile, p, projects) {
  const cs = p.caseStudy;
  const others = projects.filter(o => o.slug !== p.slug).slice(0, 2);

  const section = async (id, heading, content, images = []) => `
  <section class="case__section" aria-labelledby="${id}">
    <h2 id="${id}">${esc(heading)}</h2>
    ${paras(content)}
    ${(await Promise.all(images.map(i => figure(i)))).join('\n')}
  </section>`;

  const body = `${header(profile)}
<main id="main" class="case">
  <div class="wrap">
    <p class="case__back"><a href="/#projects">← All projects</a></p>

    <header class="case__head">
      <h1>${esc(p.title)}</h1>
      <p class="case__tagline">${inline(p.tagline)}</p>
      <dl class="case__meta">${
        // A row whose value is unknown is left out rather than filled with a guess.
        [['Year', p.year], ['Role', p.role], ['Stack', p.stack.join(' · ')]]
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
          .join('')
      }</dl>
      ${actions(p.links, { size: 'actions--lg' })}
    </header>

    ${await figure(cs.hero, { lazy: false })}

    ${await section('problem', 'The problem', cs.problem)}
    ${await section('data', cs.dataHeading || 'The data', cs.data)}
    ${await section('built', 'What I built', cs.built, cs.images || [])}
    ${await section('result', 'The result', cs.result)}

    <section class="case__section case__tech" aria-labelledby="tech">
      <h2 id="tech">Technical notes</h2>
      <p class="case__tech-hint">For anyone who wants the detail.</p>
      ${paras(cs.technical)}
    </section>

    ${actions(p.links, { size: 'actions--lg' })}

    <nav class="case__next" aria-label="More projects">
      <h2>More projects</h2>
      <ul>${others.map(o =>
        `<li><a href="/${esc(o.slug)}/"><strong>${esc(o.title)}</strong>
         <span>${inline(o.tagline)}</span></a></li>`).join('')}</ul>
    </nav>
  </div>
</main>
${footer(profile)}`;

  return layout({
    title: `${p.title} — ${profile.name}`,
    description: p.tagline,
    path: `/${p.slug}/`,
    body,
  });
}

/* ----------------------------------------------------------------- build -- */

const readJSON = async url => JSON.parse(await readFile(url, 'utf8'));

async function build() {
  const profile = await readJSON(new URL('data/profile.json', SRC));

  const dir = new URL('data/projects/', SRC);
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
  const projects = await Promise.all(files.map(f => readJSON(new URL(f, dir))));
  projects.sort((a, b) => a.order - b.order);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(new URL('public/', import.meta.url), DIST, { recursive: true });
  await cp(new URL('styles.css', SRC), new URL('styles.css', DIST));

  await writeFile(new URL('index.html', DIST), await renderIndex(profile, projects));
  for (const p of projects) {
    await mkdir(new URL(`${p.slug}/`, DIST), { recursive: true });
    await writeFile(new URL(`${p.slug}/index.html`, DIST),
      await renderProject(profile, p, projects));
  }
  // GitHub Pages serves 404.html for unknown paths.
  await writeFile(new URL('404.html', DIST), layout({
    title: `Not found — ${profile.name}`,
    description: 'Page not found.',
    path: '/404.html',
    body: `${header(profile)}<main id="main" class="wrap section">
      <h1>Not found</h1>
      <p>That page does not exist. <a href="/">Back to the start</a>.</p>
    </main>${footer(profile)}`,
  }));

  const todos = JSON.stringify({ profile, projects }).match(/TODO_[A-Z_]+/g) || [];
  console.log(`built ${projects.length + 2} pages → dist/`);
  if (todos.length) {
    const counts = todos.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
    console.log('open placeholders:');
    for (const [t, n] of counts) console.log(`  ${t} ×${n}`);
  }
}

/* ----------------------------------------------------------------- serve -- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.pdf': 'application/pdf',
};

function serve(port = 8000) {
  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = new URL('.' + path, DIST);
    const stream = createReadStream(file);
    stream.on('error', () => {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      createReadStream(new URL('404.html', DIST)).pipe(res);
    });
    stream.on('open', () => {
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      stream.pipe(res);
    });
  }).listen(port, () => console.log(`serving dist/ → http://localhost:${port}`));
}

await build();
if (process.argv.includes('--serve')) serve();
