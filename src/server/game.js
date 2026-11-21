const fs = require('fs');
const path = require('path');
const { audioUrl } = require('./voice-cache');

// One local server hosts one shared game. State lives in memory until restart.
module.exports = function registerGame(io, gamesDirectory) {
  const gameKeys = fs.readdirSync(gamesDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const players = Object.create(null);
  const roles = new Map();
  const playerIds = new Map();
  const rememberedPlayers = new Map();
  const state = {
    round: 'jeopardy',
    categories: [],
    double: null,
    final: null,
    current: null,
    dailyDouble: false,
    firstBuzz: null,
    buzzersOpen: false,
    attempted: new Set(),
    wagers: Object.create(null),
    wageredPlayers: [],
    finalAnswers: Object.create(null),
    finalStartScores: Object.create(null),
    finalCluePending: false,
    finalRevealed: false
  };

  // Keep scores for a disconnected player for three hours.
  const cleanup = setInterval(() => {
    const activeIds = new Set(playerIds.values());
    for (const [id, data] of rememberedPlayers) {
      if (!activeIds.has(id) && Date.now() - data.lastActive > 3 * 60 * 60 * 1000) rememberedPlayers.delete(id);
    }
  }, 5 * 60 * 1000);
  cleanup.unref();

  function emitToRoles(events) {
    for (const [id, role] of roles) {
      const event = events[role];
      if (event) io.to(id).emit(event.name, event.data);
    }
  }

  function boardCategories() {
    return state.categories.map(category => ({
      name: category.name,
      questions: category.questions.map(clue => clue.value)
    }));
  }

  function broadcastBoard() {
    io.emit('categoriesData', {
      categories: state.round === 'final' ? [] : boardCategories(),
      isDoubleJeopardy: state.round === 'double',
      isFinalJeopardy: state.round === 'final'
    });
  }

  function displayClue() {
    const { question, answer, image = '', value } = state.current;
    const playerClue = { name: 'displayQuestion', data: { question, image, isDailyDouble: state.dailyDouble } };
    emitToRoles({
      player: playerClue,
      'main-table': playerClue,
      'quiz-master': { name: 'displayQuestionAndAnswer', data: { question, answer, image, value } }
    });
    io.emit('revealQuestion');
  }

  function changeScore(name, amount) {
    const entry = Object.entries(players).find(([, player]) => player.name === name);
    if (!entry || !Number.isInteger(amount)) return null;
    const [socketId, player] = entry;
    player.score += amount;
    const remembered = rememberedPlayers.get(playerIds.get(socketId));
    if (remembered) Object.assign(remembered, { score: player.score, lastActive: Date.now() });
    io.emit('updatePlayers', players);
    return player.score;
  }

  function announceWinner() {
    if (state.round !== 'final' || Object.keys(state.wagers).length) return;
    const entries = Object.values(players).map(({ name, score }) => ({ name, score })).sort((a, b) => b.score - a.score);
    const standings = Object.create(null);
    let rank = 0;
    let previousScore = null;
    entries.forEach((entry, index) => {
      if (previousScore === null || entry.score < previousScore) rank = index + 1;
      previousScore = entry.score;
      standings[entry.name] = { rank, score: entry.score };
    });
    const score = entries[0]?.score ?? 0;
    io.emit('announceWinner', { names: entries.filter(entry => entry.score === score).map(entry => entry.name), score, standings });
  }

  function settleFinalWager(name, correct) {
    if (!Object.hasOwn(state.wagers, name)) return;
    const wager = state.wagers[name];
    const newScore = changeScore(name, correct ? wager : -wager);
    if (newScore === null) return;
    delete state.wagers[name];
    io.emit('finalJeopardyShowWager', { playerName: name, wager, correct });
    io.emit('finalJeopardyUpdateScore', { playerName: name, newScore });
    announceWinner();
  }

  io.on('connection', socket => {
    const isHost = () => roles.get(socket.id) === 'quiz-master';
    const isBoard = () => roles.get(socket.id) === 'main-table';
    const error = message => socket.emit('errorMessage', message);

    socket.emit('gamesList', gameKeys);

    // Roles, game selection and reconnectable player registration.
    socket.on('setRole', value => {
      const role = value && typeof value === 'object' ? value.role : value;
      if (!['player', 'main-table', 'quiz-master'].includes(role)) return;
      roles.set(socket.id, role);
      if (role === 'main-table' || role === 'quiz-master') socket.emit('gamesList', gameKeys);
      if (role === 'quiz-master') socket.emit('updatePlayers', players);
    });

    socket.on('registerPlayer', (data = {}, acknowledge = () => {}) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      const id = typeof data?.playerId === 'string' && /^[\w-]{1,100}$/.test(data.playerId) ? data.playerId : socket.id;
      if (roles.get(socket.id) !== 'player' || !name || name.length > 28) return respond({ error: 'Enter a name of up to 28 characters.' });
      if (Object.entries(players).some(([otherId, player]) => otherId !== socket.id && player.name.toLowerCase() === name.toLowerCase())) {
        return respond({ error: 'That name is already in use. Choose another name.' });
      }
      const previous = rememberedPlayers.get(id);
      players[socket.id] = { name, score: previous?.name === name ? previous.score : 0 };
      rememberedPlayers.set(id, { ...players[socket.id], lastActive: Date.now() });
      playerIds.set(socket.id, id);
      io.emit('updatePlayers', players);
      respond({ ok: true });
    });

    socket.on('loadGame', gameKey => {
      if (!isBoard()) return;
      if (!gameKeys.includes(gameKey)) return error('That game is not available.');
      try {
        const directory = path.join(gamesDirectory, gameKey);
        const read = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        const first = read('questions.json');
        const double = read('double_questions.json');
        const final = read('final_question.json');
        if (!Array.isArray(first.categories) || !Array.isArray(double.categories) || !final.question) throw new Error('Invalid game data');
        Object.assign(state, {
          round: 'jeopardy', categories: first.categories, double, final, current: null,
          dailyDouble: false, firstBuzz: null, buzzersOpen: false, wagers: Object.create(null),
          wageredPlayers: [], finalRevealed: false
        });
        state.attempted.clear();
        io.emit('currentQuestionIsDailyDouble', false);
        broadcastBoard();
        io.emit('updatePlayers', players);
      } catch (problem) {
        console.error(`Could not load game ${gameKey}: ${problem.message}`);
        error('Could not load game data.');
      }
    });

    // Audio lookups only read local files; the preparation script is separate.
    socket.on('fetchTTS', request => {
      const text = typeof request === 'string' ? request : request?.text;
      const purpose = typeof request === 'object' && request ? request.purpose : undefined;
      socket.emit('ttsAudio', { url: audioUrl(text), text, purpose });
    });
    socket.on('fetchCategoryTTS', text => socket.emit('ttsCategoryAudio', { url: audioUrl(text), text }));

    // Clue selection, buzzers and Daily Double wagers.
    socket.on('setCurrentQuestionIsDailyDouble', isDailyDouble => {
      if (!isBoard() && !isHost()) return;
      state.dailyDouble = Boolean(isDailyDouble);
      state.buzzersOpen = state.dailyDouble;
      state.firstBuzz = null;
      io.emit('currentQuestionIsDailyDouble', state.dailyDouble);
    });

    socket.on('selectQuestion', ({ category, value } = {}) => {
      if (!isBoard() || state.round === 'final') return;
      const selectedCategory = state.categories.find(item => item.name === category);
      const clue = selectedCategory?.questions.find(item => item.value === value);
      if (!clue) return error('That clue could not be found.');
      state.current = clue;
      state.attempted.clear();
      if (!state.dailyDouble) displayClue();
    });

    socket.on('enableBuzzers', () => {
      if (!isBoard() || !state.current || state.round === 'final') return;
      state.buzzersOpen = true;
      io.emit('enableBuzzers');
    });

    socket.on('disableBuzzers', () => {
      if (!isBoard() && !isHost()) return;
      state.buzzersOpen = false;
      io.emit('disableBuzzers');
    });

    socket.on('buzzIn', () => {
      const player = players[socket.id];
      if (!player || !state.current || !state.buzzersOpen || state.firstBuzz || state.attempted.has(player.name)) return;
      state.firstBuzz = player.name;
      state.buzzersOpen = false;
      io.emit('buzzIn', player.name);
      if (state.dailyDouble) socket.emit('showWagerInput');
    });

    socket.on('resetBuzzers', ({ exclude } = {}) => {
      if (!isBoard() && !isHost()) return;
      state.firstBuzz = null;
      state.buzzersOpen = isHost() && Boolean(state.current) && state.round !== 'final' && !state.dailyDouble;
      io.emit('resetBuzzers', { exclude, excluded: [...state.attempted], enabled: state.buzzersOpen });
    });

    socket.on('submitWager', ({ name, wager } = {}, acknowledge = () => {}) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const player = players[socket.id];
      if (!player || player.name !== name || !Number.isInteger(wager) || wager < 0 ||
          (state.round !== 'final' && (!state.dailyDouble || state.firstBuzz !== name))) {
        return respond({ error: 'Enter a valid wager.' });
      }
      const maximum = state.round === 'final' ? Math.max(player.score, 0) : Math.max(player.score, state.round === 'double' ? 2000 : 1000);
      if (wager > maximum) return respond({ error: `Maximum wager is $${maximum}.` });
      state.wagers[name] = wager;
      emitToRoles({ 'quiz-master': { name: 'notifyWager', data: { name, wager } } });
      respond({ ok: true });
    });

    socket.on('wagerSubmitted', name => {
      if (state.dailyDouble && state.firstBuzz === name && players[socket.id]?.name === name && Object.hasOwn(state.wagers, name)) displayClue();
    });
    socket.on('finalJeopardyWagerSubmitted', name => {
      if (state.round !== 'final' || players[socket.id]?.name !== name || !Object.hasOwn(state.wagers, name)) return;
      if (!state.wageredPlayers.includes(name)) state.wageredPlayers.push(name);
      io.emit('updateWageredPlayers', state.wageredPlayers);
    });

    // Host scoring and clue controls.
    function judgeClue(name, correct) {
      if (!isHost() || !state.current || state.firstBuzz !== name) return;
      const amount = Object.hasOwn(state.wagers, name) ? state.wagers[name] : state.current.value;
      if (changeScore(name, correct ? amount : -amount) === null) return;
      delete state.wagers[name];
      state.firstBuzz = null;
      state.buzzersOpen = !correct && !state.dailyDouble;
      if (!correct) {
        state.attempted.add(name);
        const excluded = [...state.attempted];
        io.emit('resetBuzzers', { exclude: name, excluded, enabled: state.buzzersOpen });
        if (state.buzzersOpen) io.emit('startSecondChanceTimer', { exclude: name, excluded });
      }
    }
    socket.on('awardPoints', ({ name } = {}) => judgeClue(name, true));
    socket.on('removePoints', ({ name } = {}) => judgeClue(name, false));

    socket.on('updatePlayerScore', ({ playerId, score } = {}) => {
      if (!isHost() || !players[playerId] || !Number.isInteger(score)) return;
      changeScore(players[playerId].name, score - players[playerId].score);
    });
    socket.on('questionClosed', () => {
      if (!isHost()) return;
      state.attempted.clear();
      state.buzzersOpen = false;
      state.dailyDouble = false;
      state.firstBuzz = null;
      state.current = null;
      io.emit('currentQuestionIsDailyDouble', false);
      io.emit('questionClosed');
    });
    socket.on('cancelTimers', () => { if (isHost()) io.emit('cancelTimers'); });

    // Round transitions and Final Jeopardy.
    socket.on('advanceToDoubleJeopardy', () => {
      if (!isHost()) return;
      if (!state.double) return error('Select a game on the main board first.');
      state.round = 'double';
      state.categories = state.double.categories;
      state.current = null;
      state.buzzersOpen = false;
      state.dailyDouble = false;
      state.firstBuzz = null;
      state.wagers = Object.create(null);
      state.attempted.clear();
      io.emit('currentQuestionIsDailyDouble', false);
      broadcastBoard();
      io.emit('advanceToDoubleJeopardy');
    });
    socket.on('advanceToFinalJeopardy', () => {
      if (!isHost()) return;
      if (!state.final) return error('Select a game on the main board first.');
      state.round = 'final';
      state.current = null;
      state.buzzersOpen = false;
      state.dailyDouble = false;
      state.firstBuzz = null;
      state.finalCluePending = false;
      state.finalRevealed = false;
      state.finalAnswers = Object.create(null);
      state.wagers = Object.create(null);
      state.wageredPlayers = [];
      state.finalStartScores = Object.fromEntries(Object.values(players).map(player => [player.name, player.score]));
      io.emit('currentQuestionIsDailyDouble', false);
      broadcastBoard();
      io.emit('advanceToFinalJeopardy', state.final.category);
    });
    socket.on('startFinalJeopardy', () => {
      if (isBoard() && state.round === 'final') io.emit('startFinalJeopardy', state.finalStartScores);
    });
    socket.on('showFinalQuestion', () => {
      if (!isHost() || state.round !== 'final') return;
      state.finalCluePending = true;
      const playerClue = { name: 'showFinalQuestion', data: state.final.question };
      emitToRoles({
        player: playerClue,
        'main-table': playerClue,
        'quiz-master': { name: 'displayQuestionAndAnswer', data: { question: state.final.question, answer: state.final.answer, image: '', value: 0 } }
      });
      socket.emit('updateFinalJeopardyPlayers', { players: state.wageredPlayers, wagers: state.wagers });
    });
    socket.on('finalClueRead', () => {
      if (!isBoard() || state.round !== 'final' || !state.finalCluePending) return;
      state.finalCluePending = false;
      io.emit('startFinalTimer');
    });
    socket.on('submitFinalAnswer', ({ name, answer } = {}) => {
      if (state.round === 'final' && !state.finalRevealed && players[socket.id]?.name === name && typeof answer === 'string') state.finalAnswers[name] = answer.slice(0, 250);
    });
    socket.on('revealPlayerFinalAnswer', name => {
      if (!isHost() || state.round !== 'final' || !state.finalRevealed) return;
      io.emit('displayPlayerFinalAnswer', { playerName: name, answer: state.finalAnswers[name] || 'No answer submitted.', wager: state.wagers[name] ?? 0 });
    });
    socket.on('revealFinalAnswer', () => {
      if (!isHost() || state.round !== 'final' || state.finalRevealed) return;
      state.finalRevealed = true;
      io.emit('displayFinalAnswer');
    });
    socket.on('finalJeopardyAwardPoints', name => { if (isHost() && state.finalRevealed) settleFinalWager(name, true); });
    socket.on('finalJeopardyDeductPoints', name => { if (isHost() && state.finalRevealed) settleFinalWager(name, false); });

    socket.on('disconnect', () => {
      const player = players[socket.id];
      if (player) {
        const remembered = rememberedPlayers.get(playerIds.get(socket.id));
        if (remembered) remembered.lastActive = Date.now();
        delete players[socket.id];
        playerIds.delete(socket.id);
        io.emit('updatePlayers', players);
        emitToRoles({ 'quiz-master': { name: 'playerDisconnected', data: { name: player.name } } });
      }
      roles.delete(socket.id);
    });
  });
};
