// Regenerates data/videos.json by scanning each curated project's README for
// a "Demo" section and extracting a linked video. Run by
// .github/workflows/update-videos.yml so the live site never has to call the
// GitHub API from a visitor's browser (which hits the 60 req/hour
// unauthenticated rate limit almost immediately).
import fs from 'node:fs';

const GITHUB_USER = 'Masimba249';
const TOKEN = process.env.GITHUB_TOKEN;
const API_HEADERS = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

function githubBlobToRaw(url) {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (!m) return url;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
}

function safeUrl(url, base) {
  try {
    const u = new URL(url, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function extractDemoSection(readme) {
  if (!readme) return null;
  const headingRe = /^(#{1,6})[ \t]*.*demo.*$/gim;
  const match = headingRe.exec(readme);
  if (!match) return null;
  const level = match[1].length;
  const rest = readme.slice(headingRe.lastIndex);
  const nextHeadingRe = new RegExp(`^#{1,${level}}[ \\t]`, 'm');
  const nextMatch = nextHeadingRe.exec(rest);
  return nextMatch ? rest.slice(0, nextMatch.index) : rest;
}

function findVideoRef(section) {
  if (!section) return null;
  const yt = section.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i);
  if (yt) return { type: 'youtube', id: yt[1] };
  const vm = section.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return { type: 'vimeo', id: vm[1] };
  const vs = section.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
  if (vs) return { type: 'file', ref: vs[1] };
  const direct = section.match(/https?:\/\/[^\s")>\]]+\.(?:mp4|webm|mov)(?:\?[^\s")>\]]*)?/i);
  if (direct) return { type: 'file', ref: direct[0] };
  const md = section.match(/\]\(([^)\s]+\.(?:mp4|webm|mov)(?:\?[^)\s]*)?)\)/i);
  if (md) return { type: 'file', ref: md[1] };
  return null;
}

function extractProjects(html) {
  const projects = [];
  const cardRe = /<a href="(https:\/\/github\.com\/[^"]+)" target="_blank" class="project-card"[\s\S]*?<div class="project-name">([^<]+)<\/div>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const url = m[1];
    const displayName = m[2].trim();
    const repoMatch = url.match(/github\.com\/[^/]+\/([^/?#]+)/i);
    if (repoMatch) projects.push({ repo: repoMatch[1], url, displayName });
  }
  return projects;
}

async function resolveVideo(repo, ref) {
  if (ref.type !== 'file') return ref;

  const converted = githubBlobToRaw(ref.ref);
  if (/^https?:\/\//i.test(converted)) {
    const url = safeUrl(converted);
    return url ? { type: 'file', url } : null;
  }

  let branch = 'main';
  const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${repo}`, { headers: API_HEADERS });
  if (repoRes.ok) {
    branch = (await repoRes.json()).default_branch || 'main';
  }
  const rawBase = `https://raw.githubusercontent.com/${GITHUB_USER}/${repo}/${branch}/`;
  const url = safeUrl(converted, rawBase);
  return url ? { type: 'file', url } : null;
}

async function main() {
  const html = fs.readFileSync('index.html', 'utf8');
  const projects = extractProjects(html);
  const results = [];

  for (const project of projects) {
    let video = null;
    try {
      const readmeRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${project.repo}/readme`, {
        headers: { ...API_HEADERS, Accept: 'application/vnd.github.v3.raw' }
      });
      if (readmeRes.ok) {
        const readme = await readmeRes.text();
        const ref = findVideoRef(extractDemoSection(readme));
        if (ref) video = await resolveVideo(project.repo, ref);
      } else if (readmeRes.status !== 404) {
        console.error(`${project.repo}: readme fetch returned ${readmeRes.status}`);
      }
    } catch (e) {
      console.error(`${project.repo}: ${e.message}`);
    }
    results.push({ ...project, video });
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/videos.json', JSON.stringify(results, null, 2) + '\n');
  console.log(`Wrote data/videos.json with ${results.length} projects.`);
}

main();
