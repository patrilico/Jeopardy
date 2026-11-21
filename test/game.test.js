const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { io } = require('socket.io-client');

const root = path.join(__dirname, '..');
let server;
let baseUrl;

function receive(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }
    socket.once(event, handler);
  });
}

async function connect() {
  const socket = io(baseUrl, { forceNew: true, reconnection: false, autoConnect: false });
  const connected = receive(socket, 'connect');
  socket.connect();
  await connected;
  return socket;
}

async function register(socket, name, playerId) {
  socket.emit('setRole', 'player');
  return socket.timeout(3000).emitWithAck('registerPlayer', { name, playerId });
}

before(async () => {
  server = spawn(process.execPath, ['src/server/index.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    server.stderr.on('data', chunk => { output += chunk; });
    server.once('error', reject);
    server.once('exit', code => { if (!baseUrl) reject(new Error(`Server exited ${code}: ${output}`)); });
  });
});

after(() => server?.kill());

test('serves the local interface and prepared audio', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Host the game/);
  assert.equal((await fetch(`${baseUrl}/.env`)).status, 404);
  const socket = await connect();
  try {
    const voice = receive(socket, 'ttsAudio');
    socket.emit('fetchTTS', 'Welcome contestants!! ... Here are your Jeopardy categories.');
    const { url } = await voice;
    assert.match(url, /^\/sounds\/voice\/[a-f0-9]{64}\.mp3$/);
    const audio = await fetch(`${baseUrl}${url}`);
    assert.equal(audio.status, 200);
    assert.match(audio.headers.get('content-type'), /audio\/mpeg/);
    assert.ok((await audio.arrayBuffer()).byteLength > 1000);

    const missing = receive(socket, 'ttsAudio');
    socket.emit('fetchTTS', 'This recording has not been generated.');
    assert.equal((await missing).url, null);
  } finally {
    socket.disconnect();
  }
});

test('the classic game exposes its original five clue values', async () => {
  const board = await connect();
  try {
    board.emit('setRole', 'main-table');
    const loaded = receive(board, 'categoriesData');
    board.emit('loadGame', '1991-07-18');
    const { categories } = await loaded;
    assert.equal(categories.length, 6);
    categories.forEach(category => assert.deepEqual(category.questions, [100, 200, 300, 400, 500]));
  } finally {
    board.disconnect();
  }
});

test('players can buzz, wager, score, reconnect and finish a game', async () => {
  const sockets = [];
  const board = await connect(); sockets.push(board);
  const host = await connect(); sockets.push(host);
  const playerA = await connect(); sockets.push(playerA);
  let playerB = await connect(); sockets.push(playerB);
  try {
    board.emit('setRole', 'main-table');
    host.emit('setRole', 'quiz-master');
    assert.deepEqual(await register(playerA, 'Ada', 'test-ada'), { ok: true });
    assert.deepEqual(await register(playerB, 'Ben', 'test-ben'), { ok: true });
    const duplicate = await connect(); sockets.push(duplicate);
    assert.match((await register(duplicate, 'ada', 'other-id')).error, /already in use/i);

    const loaded = receive(board, 'categoriesData');
    board.emit('loadGame', '2023-09-12');
    const categories = (await loaded).categories;
    const first = categories.find(category => category.questions.includes(200));
    assert.ok(first);
    const clue = receive(host, 'displayQuestionAndAnswer');
    board.emit('setCurrentQuestionIsDailyDouble', false);
    board.emit('selectQuestion', { category: first.name, value: 200 });
    assert.equal((await clue).value, 200);

    const premature = receive(host, 'buzzIn', 200).catch(() => null);
    playerA.emit('buzzIn', 'Ada');
    assert.equal(await premature, null);
    const enabled = receive(playerA, 'enableBuzzers');
    board.emit('enableBuzzers');
    await enabled;
    const buzz = receive(host, 'buzzIn');
    playerA.emit('buzzIn', 'Ada');
    assert.equal(await buzz, 'Ada');

    const retry = receive(board, 'startSecondChanceTimer');
    host.emit('removePoints', { name: 'Ada', value: 200 });
    assert.equal((await retry).exclude, 'Ada');
    const secondBuzz = receive(host, 'buzzIn');
    playerB.emit('buzzIn', 'Ben');
    assert.equal(await secondBuzz, 'Ben');
    const scored = receive(host, 'updatePlayers');
    host.emit('awardPoints', { name: 'Ben', value: 200 });
    assert.equal(Object.values(await scored).find(player => player.name === 'Ben').score, 200);

    const disconnected = receive(host, 'updatePlayers');
    playerB.disconnect();
    await disconnected;
    playerB = await connect(); sockets.push(playerB);
    const restored = receive(host, 'updatePlayers');
    assert.deepEqual(await register(playerB, 'Ben', 'test-ben'), { ok: true });
    assert.equal(Object.values(await restored).find(player => player.name === 'Ben').score, 200);

    const dailyBuzz = receive(host, 'buzzIn');
    const wagerPrompt = receive(playerA, 'showWagerInput');
    board.emit('setCurrentQuestionIsDailyDouble', true);
    board.emit('selectQuestion', { category: first.name, value: 200 });
    await receive(playerA, 'currentQuestionIsDailyDouble');
    playerA.emit('buzzIn', 'Ada');
    assert.equal(await dailyBuzz, 'Ada');
    await wagerPrompt;
    assert.match((await playerA.timeout(3000).emitWithAck('submitWager', { name: 'Ada', wager: 1001 })).error, /maximum/i);
    assert.deepEqual(await playerA.timeout(3000).emitWithAck('submitWager', { name: 'Ada', wager: 200 }), { ok: true });
    const dailyClue = receive(host, 'displayQuestionAndAnswer');
    playerA.emit('wagerSubmitted', 'Ada');
    await dailyClue;
    const dailyScore = receive(host, 'updatePlayers');
    host.emit('awardPoints', { name: 'Ada', value: 200 });
    assert.equal(Object.values(await dailyScore).find(player => player.name === 'Ada').score, 0);

    const finalRound = receive(board, 'advanceToFinalJeopardy');
    host.emit('advanceToFinalJeopardy');
    await finalRound;
    assert.match((await playerA.timeout(3000).emitWithAck('submitWager', { name: 'Ada', wager: 1 })).error, /maximum/i);
    assert.deepEqual(await playerA.timeout(3000).emitWithAck('submitWager', { name: 'Ada', wager: 0 }), { ok: true });
    assert.deepEqual(await playerB.timeout(3000).emitWithAck('submitWager', { name: 'Ben', wager: 100 }), { ok: true });
    playerA.emit('finalJeopardyWagerSubmitted', 'Ada');
    playerB.emit('finalJeopardyWagerSubmitted', 'Ben');
    const finalClue = receive(playerB, 'showFinalQuestion');
    host.emit('showFinalQuestion');
    assert.ok(await finalClue);
    const finalTimer = receive(playerB, 'startFinalTimer');
    board.emit('finalClueRead');
    await finalTimer;
    playerB.emit('submitFinalAnswer', { name: 'Ben', answer: 'What is a test?' });

    const earlyScore = receive(board, 'finalJeopardyShowWager', 200).catch(() => null);
    host.emit('finalJeopardyAwardPoints', 'Ben');
    assert.equal(await earlyScore, null);

    const revealed = receive(board, 'displayFinalAnswer');
    host.emit('revealFinalAnswer');
    await revealed;
    const duplicateReveal = receive(board, 'displayFinalAnswer', 200).catch(() => null);
    host.emit('revealFinalAnswer');
    assert.equal(await duplicateReveal, null);
    const revealedPlayer = receive(board, 'displayPlayerFinalAnswer');
    host.emit('revealPlayerFinalAnswer', 'Ben');
    assert.equal((await revealedPlayer).answer, 'What is a test?');

    const winner = receive(board, 'announceWinner');
    host.emit('finalJeopardyAwardPoints', 'Ada');
    host.emit('finalJeopardyAwardPoints', 'Ben');
    const result = await winner;
    assert.deepEqual(result.names, ['Ben']);
    assert.equal(result.score, 300);
  } finally {
    sockets.forEach(socket => socket.disconnect());
  }
});

test('all contestants who answered incorrectly stay locked out of the clue', async () => {
  const sockets = [];
  const board = await connect(); sockets.push(board);
  const host = await connect(); sockets.push(host);
  const ada = await connect(); sockets.push(ada);
  const ben = await connect(); sockets.push(ben);
  const cleo = await connect(); sockets.push(cleo);
  try {
    board.emit('setRole', 'main-table');
    host.emit('setRole', 'quiz-master');
    await register(ada, 'Ada', 'retry-ada');
    await register(ben, 'Ben', 'retry-ben');
    await register(cleo, 'Cleo', 'retry-cleo');

    const loaded = receive(board, 'categoriesData');
    board.emit('loadGame', '2023-09-12');
    const category = (await loaded).categories[0];
    const clue = receive(host, 'displayQuestionAndAnswer');
    board.emit('setCurrentQuestionIsDailyDouble', false);
    board.emit('selectQuestion', { category: category.name, value: category.questions[0] });
    await clue;
    const enabled = receive(cleo, 'enableBuzzers');
    board.emit('enableBuzzers');
    await enabled;

    for (const [contestant, name] of [[ada, 'Ada'], [ben, 'Ben']]) {
      const buzz = receive(host, 'buzzIn');
      contestant.emit('buzzIn');
      assert.equal(await buzz, name);
      const retry = receive(cleo, 'startSecondChanceTimer');
      host.emit('removePoints', { name });
      const { excluded } = await retry;
      assert.ok(excluded.includes(name));
      if (name === 'Ben') assert.deepEqual(excluded, ['Ada', 'Ben']);
    }

    const rejected = receive(host, 'buzzIn', 200).catch(() => null);
    ada.emit('buzzIn');
    assert.equal(await rejected, null);
    const nextBuzz = receive(host, 'buzzIn');
    cleo.emit('buzzIn');
    assert.equal(await nextBuzz, 'Cleo');
  } finally {
    sockets.forEach(socket => socket.disconnect());
  }
});
