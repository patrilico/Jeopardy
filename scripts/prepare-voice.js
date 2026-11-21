#!/usr/bin/env node

// Generate recordings ahead of time. The game server never calls ElevenLabs.
const fs = require('fs');
const path = require('path');
const { VOICE_DIRECTORY, MANIFEST_PATH, audioKey, audioPath, readManifest } = require('../src/server/voice-cache');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const GAMES_DIRECTORY = path.join(__dirname, '..', 'src', 'games');
const INTRO = 'Welcome contestants!! ... Here are your Jeopardy categories.';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function availableGames() {
  return fs.readdirSync(GAMES_DIRECTORY, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function gameLines(gameKeys, categoriesOnly = false) {
  const lines = new Set([INTRO]);
  for (const gameKey of gameKeys) {
    for (const filename of ['questions.json', 'double_questions.json']) {
      const game = JSON.parse(fs.readFileSync(path.join(GAMES_DIRECTORY, gameKey, filename), 'utf8'));
      game.categories.forEach((category, index) => {
        const name = category.name.toUpperCase();
        lines.add(index === game.categories.length - 1 ? `and... ${name}` : name);
        if (!categoriesOnly) {
          category.questions.forEach(clue => {
            if (typeof clue.question === 'string' && clue.question.trim()) lines.add(clue.question);
          });
        }
      });
    }
    const final = JSON.parse(fs.readFileSync(path.join(GAMES_DIRECTORY, gameKey, 'final_question.json'), 'utf8'));
    if (final.category) lines.add(final.category);
    if (!categoriesOnly && final.question) lines.add(final.question);
  }
  return [...lines];
}

async function request(endpoint, apiKey, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io/v1/${endpoint}`, {
    ...options,
    headers: { 'xi-api-key': apiKey, ...options.headers }
  });
  if (!response.ok) {
    let reason = '';
    try {
      const body = await response.json();
      reason = body.detail?.status ? ` (${body.detail.status})` : '';
    } catch (_) {
      // Some errors have no JSON body.
    }
    throw new Error(`ElevenLabs ${endpoint.split('?')[0]} returned HTTP ${response.status}${reason}.`);
  }
  return response;
}

async function inspect(apiKey) {
  const subscription = await (await request('user/subscription', apiKey)).json();
  console.log(`Plan: ${subscription.tier}; credits used: ${subscription.character_count}; credit limit: ${subscription.character_limit}`);
  const voices = await (await request('voices', apiKey)).json();
  console.log('Available account voices:');
  voices.voices.forEach(voice => console.log(`  ${voice.name} | ${voice.voice_id} | ${voice.category}`));
  try {
    const shared = await (await request('shared-voices?search=Alex%20Trebek&page_size=10', apiKey)).json();
    console.log('Voice-library search for Alex Trebek:');
    if (!shared.voices?.length) console.log('  No matching voices.');
    else shared.voices.forEach(voice => console.log(`  ${voice.name} | ${voice.voice_id} | ${voice.category || 'shared'}`));
  } catch (error) {
    console.log(`  Voice-library search unavailable: ${error.message}`);
  }
}

async function main() {
  const apiKey = process.env.ELEVEN_API_KEY;
  if (process.argv.includes('--inspect')) {
    if (!apiKey) throw new Error('Set ELEVEN_API_KEY in .env to inspect ElevenLabs voices.');
    await inspect(apiKey);
    return;
  }

  const games = availableGames();
  const selected = process.argv.includes('--all') ? games : [option('--game')].filter(Boolean);
  if (!selected.length) throw new Error('Choose --game YYYY-MM-DD or --all. Add --generate to create recordings.');
  for (const game of selected) {
    if (!games.includes(game)) throw new Error(`Unknown game: ${game}`);
  }

  const voiceId = option('--voice') || process.env.ELEVEN_VOICE_ID;
  const model = option('--model') || process.env.ELEVEN_MODEL_ID || DEFAULT_MODEL;
  const manifest = readManifest();
  const lines = gameLines(selected, process.argv.includes('--categories-only'));
  const replace = process.argv.includes('--replace');
  const existing = lines.filter(text => fs.existsSync(audioPath(text)));
  const conflicts = existing.filter(text => {
    const entry = manifest[audioKey(text)];
    return entry && voiceId && (entry.voiceId !== voiceId || entry.model !== model);
  });
  if (conflicts.length && !replace) {
    throw new Error(`${conflicts.length} existing recordings use another voice or model. Keep the existing voice, or use --replace to regenerate them.`);
  }
  const pending = lines.filter(text => !fs.existsSync(audioPath(text)) || (replace && conflicts.includes(text)));
  const characters = pending.reduce((total, text) => total + text.length, 0);
  console.log(`Games: ${selected.join(', ')}`);
  console.log(`Recordings: ${lines.length} total, ${lines.length - pending.length} already saved, ${pending.length} to generate (${characters} characters).`);

  if (!process.argv.includes('--generate')) {
    console.log('Dry run only. Add --generate to use ElevenLabs credits.');
    return;
  }
  if (!pending.length) return;
  if (!apiKey || !voiceId) throw new Error('Set ELEVEN_API_KEY and ELEVEN_VOICE_ID in .env before generating audio.');

  const subscription = await (await request('user/subscription', apiKey)).json();
  const remaining = subscription.character_limit - subscription.character_count;
  if (remaining < characters) throw new Error(`The account has ${remaining} credits remaining; this batch needs up to ${characters}. No audio was generated.`);

  fs.mkdirSync(VOICE_DIRECTORY, { recursive: true });
  for (const [index, text] of pending.entries()) {
    const response = await request(`text-to-speech/${encodeURIComponent(voiceId)}`, apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    fs.writeFileSync(audioPath(text), Buffer.from(await response.arrayBuffer()));
    manifest[audioKey(text)] = { voiceId, model };
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Saved ${index + 1}/${pending.length}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
