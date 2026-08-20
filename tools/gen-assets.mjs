#!/usr/bin/env node
// ============================================================================
// Emberfall asset generator.
//
// Reads tools/art-briefs.json and produces PNGs into assets/, then writes
// assets/manifest.json. The game loads that manifest at boot and uses each PNG
// as an OVERRIDE on top of its procedural sprite, so this step is always
// optional — the game is fully playable without ever running it.
//
//   node tools/gen-assets.mjs              generate everything still missing
//   node tools/gen-assets.mjs --only tree  generate keys matching a substring
//   node tools/gen-assets.mjs --force      regenerate even if the file exists
//   node tools/gen-assets.mjs --list       show every asset key and its status
//   node tools/gen-assets.mjs --manifest   just rebuild manifest.json
//   node tools/gen-assets.mjs --codex      print a prompt to hand to Codex
//
// Direct generation needs OPENAI_API_KEY (billed to your OpenAI API account).
// Without one, use --codex and paste the prompt into the Codex CLI, whose
// built-in image_gen tool bills your ChatGPT/Codex credits instead.
// ============================================================================

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = join(ROOT, 'assets');
const BRIEFS = join(ROOT, 'tools', 'art-briefs.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function main() {
  const briefs = JSON.parse(await readFile(BRIEFS, 'utf8'));
  await mkdir(ASSET_DIR, { recursive: true });

  const only = valueOf('--only');
  let list = briefs.assets;
  if (only) list = list.filter((a) => a.key.includes(only) || a.file.includes(only));

  if (has('--list')) {
    for (const a of briefs.assets) {
      const there = await exists(join(ASSET_DIR, a.file));
      console.log(`${there ? '✓' : '·'}  ${a.key.padEnd(26)} ${a.file}`);
    }
    const done = (await Promise.all(briefs.assets.map((a) => exists(join(ASSET_DIR, a.file))))).filter(Boolean).length;
    console.log(`\n${done}/${briefs.assets.length} generated.`);
    return;
  }

  if (has('--manifest')) { await writeManifest(briefs); return; }

  if (has('--codex')) {
    const pending = [];
    for (const a of list) if (has('--force') || !(await exists(join(ASSET_DIR, a.file)))) pending.push(a);
    console.log(codexPrompt(pending));
    return;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('No OPENAI_API_KEY set.\n');
    console.error('Either export one, or run:  node tools/gen-assets.mjs --codex');
    console.error('and hand the printed prompt to the Codex CLI (its image_gen tool bills');
    console.error('your ChatGPT credits rather than the OpenAI API).');
    process.exitCode = 1;
    return;
  }

  let made = 0;
  for (const a of list) {
    const out = join(ASSET_DIR, a.file);
    if (!has('--force') && await exists(out)) { console.log(`·  skip ${a.key} (exists)`); continue; }
    process.stdout.write(`→  ${a.key} … `);
    try {
      const png = await generate(key, briefs, a);
      await writeFile(out, png);
      console.log(`${(png.length / 1024).toFixed(0)} KB`);
      made++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
    }
  }
  console.log(`\n${made} image(s) generated.`);
  await writeManifest(briefs);
}

async function generate(apiKey, briefs, asset) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: briefs.model || 'gpt-image-2',
      prompt: `${briefs.style} ${asset.prompt}`,
      size: '1024x1024',
      background: 'transparent',
      output_format: 'png',
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image payload returned');
  return Buffer.from(b64, 'base64');
}

/** The manifest is what the game actually reads; only present files are listed. */
async function writeManifest(briefs) {
  const assets = {};
  for (const a of briefs.assets) {
    if (await exists(join(ASSET_DIR, a.file))) assets[a.key] = { file: a.file };
  }
  const manifest = { generated: new Date().toISOString(), model: briefs.model, assets };
  await writeFile(join(ASSET_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`manifest.json written — ${Object.keys(assets).length} override(s) active.`);
}

function codexPrompt(pending) {
  if (!pending.length) return 'Nothing pending — every asset already exists.';
  return `You have an image generation tool (image_gen). Generate game art PNGs for the RTS
game in this project.

Read tools/art-briefs.json. It has a shared "style" string and an "assets" array of
{key, file, prompt}. Generate ONLY these keys:

${pending.map((a) => `  ${a.key}`).join('\n')}

For each:
1. Final prompt = <style> + " " + <that asset's prompt>.
2. Generate 1024x1024, transparent background if the tool supports it.
3. Post-process with Pillow and save to assets/<file>:
   - Ensure RGBA. If opaque, key out the background: flood-fill from all four corners
     with tolerance ~40-60, feather the mask ~1px, despill edge halos.
   - Crop transparent margins, then re-pad so the subject is horizontally centred and its
     lowest opaque pixel sits exactly on the bottom edge.
   - Resize longest side to 512px. Save PNG with alpha.
4. Print each saved path, its pixel size, and the fraction of pixels with alpha > 0.

Then run:  node tools/gen-assets.mjs --manifest
Do not change any source file.`;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
