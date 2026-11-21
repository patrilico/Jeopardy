// src/client/js/main.js

// Initialize Socket.io connection
const socket = io({
  pingInterval: 2000,   // send a ping every 2 seconds
  pingTimeout: 2400000,  // wait for 40 minutes before disconnecting
});

// Element references
const roleSelection       = document.getElementById('role-selection');
const gameSelection       = document.getElementById('game-selection');
const gameList            = document.getElementById('game-list');
const boardContainer      = document.getElementById('board-container');
const playerNameContainer = document.getElementById('player-name-container');
const playerView          = document.getElementById('player-view');
const playerNameInput     = document.getElementById('player-name-input');
const submitNameBtn       = document.getElementById('submit-name-btn');
const jeopardyBoard       = document.getElementById('jeopardy-board');
const modal               = document.getElementById('question-modal');
const modalContent        = document.getElementById('modal-content');
const buzzedInDisplay     = document.getElementById('buzzed-in-info');
const scoreTableFooter    = document.getElementById('score-table-footer');

const wagerContainer      = document.getElementById('wager-container');
const wagerInput          = document.getElementById('wager-input');
const submitWagerBtn      = document.getElementById('submit-wager-btn');
const buzzerContainer     = document.getElementById('buzzer-container');

const finalAnswerContainer= document.getElementById('final-answer-container');
const finalAnswerInput    = document.getElementById('final-answer-input');
const playerStatus        = document.getElementById('player-status');
const playerNameError     = document.getElementById('player-name-error');
const wagerError          = document.getElementById('wager-error');
const playerMessage       = document.getElementById('player-message');

const quizMasterBtn            = document.getElementById('quiz-master-btn');
const quizMasterView           = document.getElementById('quiz-master-view');
const quizMasterQuestion       = document.getElementById('quiz-master-question');
const quizMasterAnswer         = document.getElementById('quiz-master-answer');
const quizMasterWager          = document.getElementById('quiz-master-wager');
const quizMasterWagerList     = document.getElementById('quiz-master-wager-list');
const quizMasterBuzz          = document.getElementById('quiz-master-buzzed-in');
const quizMasterResetButton    = document.getElementById('quiz-master-reset-buzzers');

const quizMasterAwardButton        = document.getElementById('quiz-master-award-points');
const quizMasterRemovePointsButton = document.getElementById('quiz-master-remove-points');
const quizMasterCloseQuestionBtn   = document.getElementById('quiz-master-close-question');
const advanceToDoubleJeopardyBtn   = document.getElementById('advance-to-double-jeopardy-btn');
const advanceToFinalJeopardyBtn    = document.getElementById('advance-to-final-jeopardy-btn');
const showFinalQuestionBtn         = document.getElementById('show-final-question-btn');
const showFinalAnswerBtn           = document.getElementById('show-final-answer-btn');

const dingSound          = document.getElementById('ding-sound');
const dailyDoubleSound   = document.getElementById('daily-double-sound');
const timesUpSound       = document.getElementById('times-up-sound');
const finalJeopardySound = document.getElementById('final-jeopardy-sound');
const boardFillSound     = document.getElementById('board-fill-sound');

// State variables
let categoriesData              = [];
let playerName                  = '';
let players                     = {};
let firstBuzzedPlayer           = null;
let currentQuestionValue        = 0;
let currentCategory             = '';
let dailyDoubleCells            = [];
let currentQuestionIsDailyDouble= false;
let role                        = null;
let storedQuestionText          = '';

let isDoubleJeopardy            = false;
let isFinalJeopardy             = false;
let finalJeopardyCategory       = '';
let finalJeopardyStartScores    = {};
let quizMasterWagers            = {};
let finalResultsVisible         = false;
let finalRevealTimer            = null;
const settledFinalPlayers       = new Set();

let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = 'player_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('playerId', playerId);
}

// Role selection handlers
document.getElementById('main-table-btn').addEventListener('click', () => {
  document.body.className = 'main-table-screen';
  roleSelection.style.display = 'none';
  gameSelection.style.display = 'block';
  role = 'main-table';
  socket.emit('setRole', 'main-table');
  scoreTableFooter.style.display = 'none';
});

document.getElementById('player-btn').addEventListener('click', () => {
  document.body.className = 'player-screen';
  roleSelection.style.display = 'none';
  playerNameContainer.style.display = 'flex';
  role = 'player';
  socket.emit('setRole', { role: 'player', playerId: playerId });
  playerNameInput.focus();
});

let hostPin = '';
quizMasterBtn.addEventListener('click', () => {
  const pin = prompt('Enter the host PIN');
  if (pin === null) return;
  socket.emit('setRole', { role: 'quiz-master', pin: pin.trim() }, (response) => {
    if (!response?.ok) {
      alert(response?.error || 'Could not start as host.');
      return;
    }
    hostPin = pin.trim();
    document.body.className = 'quiz-master-screen';
    roleSelection.style.display = 'none';
    quizMasterView.style.display = 'block';
    role = 'quiz-master';
    scoreTableFooter.style.display = 'block';

    updateEditScoresInterface();
  });
});

document.querySelector('[data-back-to-roles]').addEventListener('click', () => {
  playerNameContainer.style.display = 'none';
  roleSelection.style.display = 'flex';
  document.body.className = 'role-screen';
  playerNameError.textContent = '';
  role = null;
});

// Populate the game-list
socket.on('gamesList', (games) => {
  gameList.innerHTML = '';
  games.forEach((gameKey) => {
    const li = document.createElement('li');
    li.textContent = gameKey;
    li.addEventListener('click', () => {
      socket.emit('loadGame', gameKey);
      gameSelection.style.display = 'none';
      boardContainer.style.display = 'block';
    });
    gameList.appendChild(li);
  });
});

// Quiz Master button handlers

socket.on('cancelTimers', () => {
  clearInterval(timerInterval);

  const display = document.getElementById('timer-display');
  if (display) {
    display.textContent = '';
    display.style.display = 'none';
  }
  // If the sound is mid-play, stop it:
  if (!timesUpSound.paused) {
    timesUpSound.pause();
    timesUpSound.currentTime = 0;
  }
});

quizMasterAwardButton.addEventListener('click', () => {
  if (firstBuzzedPlayer) {
    socket.emit('awardPoints', { name: firstBuzzedPlayer, value: currentQuestionValue });
    socket.emit('cancelTimers');
    clearInterval(timerInterval);
    socket.emit('disableBuzzers');
    closeQuestion();
  }
});
quizMasterRemovePointsButton.addEventListener('click', () => {
  if (firstBuzzedPlayer) {
    // stop any existing timers before deducting points so the
    // second chance timer isn't immediately cancelled
    socket.emit('cancelTimers');
    socket.emit('removePoints', { name: firstBuzzedPlayer, value: currentQuestionValue });
  }
});
quizMasterCloseQuestionBtn.addEventListener('click', () => {
  socket.emit('questionClosed');
  socket.emit('cancelTimers');
});
quizMasterResetButton.addEventListener('click', () => socket.emit('resetBuzzers'));
document.getElementById('quiz-master-reset-game').addEventListener('click', () => {
  if (confirm('Reset the game? This removes all players, scores and the loaded game on every device.')) socket.emit('resetGame');
});
// Every device returns to the role screen with a fresh player identity.
socket.on('gameReset', () => {
  localStorage.removeItem('playerId');
  location.reload();
});
advanceToDoubleJeopardyBtn.addEventListener('click', () => socket.emit('advanceToDoubleJeopardy'));
advanceToFinalJeopardyBtn.addEventListener('click', () => socket.emit('advanceToFinalJeopardy'));
showFinalQuestionBtn.addEventListener('click', () => {
  socket.emit('showFinalQuestion');
  showFinalQuestionBtn.style.display = 'none';
  showFinalAnswerBtn.style.display = 'block';
  showFinalAnswerBtn.disabled = true;
});
showFinalAnswerBtn.addEventListener('click', () => socket.emit('revealFinalAnswer'));

// Show both Q & A to the Quiz-Master
socket.on('displayQuestionAndAnswer', ({ question, answer, value }) => {
  if (role === 'quiz-master') {
    quizMasterQuestion.textContent       = question;
    quizMasterAnswer.textContent         = answer;
    currentQuestionValue                  = value;
    quizMasterAwardButton.disabled       = !firstBuzzedPlayer;
    quizMasterRemovePointsButton.disabled = !firstBuzzedPlayer;
    if (isFinalJeopardy) quizMasterBuzz.textContent = 'The final clue is being read.';
  }
});

// Player name submit
submitNameBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    playerNameError.textContent = 'Please enter your name.';
    return;
  }
  playerNameError.textContent = '';
  submitNameBtn.disabled = true;
  socket.timeout(5000).emit('registerPlayer', { name, playerId }, (error, result) => {
    submitNameBtn.disabled = false;
    if (error || result?.error) {
      playerNameError.textContent = result?.error || 'Could not join. Check your connection and try again.';
      return;
    }
    playerName = name;
    playerNameContainer.style.display = 'none';
    playerView.style.display = 'block';
    document.getElementById('player-name').textContent = name;
    updatePlayerScores();
  });
});

playerNameInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') submitNameBtn.click();
});

// Player buzzer and spacebar mapping
const buzzer = document.getElementById('buzzer');
buzzer.addEventListener('click', () => {
  if (!isFinalJeopardy && !firstBuzzedPlayer) {
    socket.emit('buzzIn', playerName);
    buzzer.disabled = true;
    if (navigator.vibrate) navigator.vibrate(200);
  }
});


// Quiz Master hears buzzIn too
socket.on('buzzIn', (name) => {
  firstBuzzedPlayer = name;
  // Quiz-Master view
  if (role === 'quiz-master') {
    quizMasterBuzz.textContent = `${name} buzzed in`;
    quizMasterBuzz.classList.add('is-active');
    quizMasterAwardButton.disabled       = false;
    quizMasterRemovePointsButton.disabled = false;
  }

  if (role === 'player') {
    buzzer.disabled = true;
    playerStatus.textContent = name === playerName ? 'You buzzed in! Give your response.' : `${name} buzzed in first`;
  }

  highlightBuzzedPlayer(name);

  // Main board view: show a little “Buzzed in: Name” banner
  if (role === 'main-table') {
    if (!currentQuestionIsDailyDouble) {
      buzzedInDisplay.textContent = `${name} buzzed in`;
      buzzedInDisplay.style.display = 'block';
    }
    dingSound.currentTime = 0;
    dingSound.play();

    // On normal questions give 7 seconds to answer
    if (!currentQuestionIsDailyDouble) {
      clearInterval(timerInterval);
      startTimer(7);
    } else {
      // Hide timer until the Daily Double wager is complete
      clearInterval(timerInterval);
      const display = document.getElementById('timer-display');
      if (display) {
        display.textContent = '';
        display.style.display = 'none';
      }
    }
  }
});


// Display Daily Double banner
function showDailyDouble() {
  // hide the board, show the question modal
  boardContainer.style.display = 'none';
  modal.style.display          = 'block';

  // hide and reset the timer while waiting for a wager
  clearInterval(timerInterval);
  const timerDisplay = document.getElementById('timer-display');
  if (timerDisplay) {
    timerDisplay.textContent = '';
    timerDisplay.style.display = 'none';
  }

  // remove padding so the logo truly fills the screen
  modalContent.style.padding = '0';

  // play the sound
  dailyDoubleSound.currentTime = 0;
  dailyDoubleSound.play();

  // append the banner
  const banner = document.createElement('img');
  banner.id    = 'daily-double-banner';
  banner.src   = '/images/daily_double_logo.PNG';
  banner.style.cssText = `
    width: 100vw;
    height: 100vh;
    object-fit: cover;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 9999;
  `;
  modalContent.appendChild(banner);
}

// Wager input and reveal for Daily Double
function showWagerForm() {
  const score = Object.values(players).find(player => player.name === playerName)?.score ?? 0;
  const maximum = isFinalJeopardy ? Math.max(score, 0) : Math.max(score, isDoubleJeopardy ? 2000 : 1000);
  document.getElementById('wager-help').textContent = `You can wager up to $${maximum}.`;
  wagerInput.value = '0';
  wagerError.textContent = '';
  wagerContainer.style.display = 'block';
  buzzerContainer.style.display = 'none';
  playerStatus.textContent = isFinalJeopardy ? 'Final Jeopardy: enter your wager' : 'Daily Double: enter your wager';
  wagerInput.focus();
}
socket.on('showWagerInput', showWagerForm);

// Notification of a player's wager amount for the Quiz Master
socket.on('notifyWager', ({ name, wager }) => {
  if (quizMasterWager) {
    quizMasterWager.textContent = `${name} wagered $${wager}`;
    quizMasterWager.style.display = 'block';
  }
  if (isFinalJeopardy) {
    quizMasterWagers[name] = wager;
    updateQuizMasterWagerList();
  }
});

function updateQuizMasterWagerList() {
  if (!quizMasterWagerList) return;
  quizMasterWagerList.innerHTML = '';
  const entries = Object.entries(quizMasterWagers);
  if (entries.length > 0) {
    const title = document.createElement('div');
    title.textContent = 'Final Wagers';
    quizMasterWagerList.appendChild(title);
  }
  entries.forEach(([n, w]) => {
    const row = document.createElement('div');
    row.textContent = `${n}: $${w}`;
    quizMasterWagerList.appendChild(row);
  });
}

submitWagerBtn.addEventListener('click', () => {
  const wagerAmount = Number(wagerInput.value);
  if (!wagerInput.value || !Number.isInteger(wagerAmount) || wagerAmount < 0) {
    wagerError.textContent = 'Enter a whole dollar amount of $0 or more.';
    return;
  }
  wagerError.textContent = '';
  submitWagerBtn.disabled = true;
  socket.timeout(5000).emit('submitWager', { name: playerName, wager: wagerAmount }, (error, result) => {
    submitWagerBtn.disabled = false;
    if (error || result?.error) {
      wagerError.textContent = result?.error || 'Could not submit your wager. Try again.';
      return;
    }
    wagerContainer.style.display = 'none';
    wagerInput.value = '0';
    playerStatus.textContent = isFinalJeopardy ? 'Wager submitted. Waiting for the final clue.' : 'Wager submitted. Listen to the clue.';
    document.getElementById('player-message-kicker').textContent = isFinalJeopardy ? 'FINAL JEOPARDY!' : 'DAILY DOUBLE';
    document.getElementById('player-message-title').textContent = isFinalJeopardy ? 'Wager locked in.' : 'You’re up!';
    document.getElementById('player-message-body').textContent = isFinalJeopardy
      ? 'Get ready to write your response when the final clue appears.'
      : 'Listen to the clue, then give your response aloud.';
    playerMessage.style.display = 'block';
    socket.emit(isFinalJeopardy ? 'finalJeopardyWagerSubmitted' : 'wagerSubmitted', playerName);
  });
});

// Show wagered players on Final Jeopardy main table
socket.on('updateWageredPlayers', (wagered) => {
  if (role === 'quiz-master') {
    quizMasterBuzz.textContent = `${wagered.length} of ${Object.keys(players).length} wagers received`;
  }
  if (role === 'main-table') {
    const div = document.getElementById('wagered-players');
    if (div) {
      div.innerHTML = '';
      if (wagered.length > 0) {
        const title = document.createElement('div');
        title.textContent = 'Players who submitted wagers';
        title.classList.add('wager-title');
        div.appendChild(title);
      }
      wagered.forEach(name => {
        const entry = document.createElement('div');
        entry.textContent = name;
        entry.classList.add('wager-name');
        div.appendChild(entry);
      });
      div.style.display = 'block';
    }
  }
});

// revealQuestion
socket.on('revealQuestion', () => {
  const banner = document.getElementById('daily-double-banner');
  if (banner) banner.remove();
  modalContent.style.padding = '20px';

  if (role === 'main-table') {
    requestVoice(storedQuestionText, 'question');
  } else if (role === 'player') {
    buzzer.disabled = true;
    playerStatus.textContent = 'Listen to the clue';
  }
});

// ttsAudio
function requestVoice(text, purpose) {
  socket.emit('fetchTTS', { text, purpose });
}

socket.on('ttsAudio', ({ url, text, purpose }) => {
  window.playVoiceOver(url, text, () => handleTTSEnd(purpose, text));
});

function handleTTSEnd(purpose, text) {
  if (role === 'main-table' && purpose === 'question') {
    if (storedQuestionText !== text) return;
    if (currentQuestionIsDailyDouble) {
      clearInterval(timerInterval);
      startTimer(15);
    } else {
      socket.emit('enableBuzzers');
    }
  } else if (role === 'main-table' && purpose === 'final-category') {
    socket.emit('startFinalJeopardy');
  } else if (role === 'main-table' && purpose === 'final') {
    socket.emit('finalClueRead');
  }
}

// enableBuzzers
socket.on('enableBuzzers', () => {
  if (role === 'player') {
    buzzerContainer.style.display = 'block';
    playerMessage.style.display = 'none';
    buzzer.disabled = false;
    playerStatus.textContent = 'Buzz in now!';
  }
  if (role === 'main-table') {
    clearInterval(timerInterval);
    startTimer(12);
  }
});

// disableBuzzers
socket.on('disableBuzzers', () => {
  if (role === 'player') {
    playerStatus.textContent = 'Waiting for the next clue';
  }
  // stop any running timer locally, just in case
  clearInterval(timerInterval);

  // disable the buzzer button if it exists
  const buzzerBtn = document.getElementById('buzzer');
  if (buzzerBtn) buzzerBtn.disabled = true;

  // if you want to hide the "buzzed in" banner on the main-table:
  if (role === 'main-table') {
    buzzedInDisplay.style.display = 'none';
  }
});

// Second-chance timer (7 seconds)
socket.on('startSecondChanceTimer', ({ exclude, excluded = [] } = {}) => {
  if (role === 'player') {
    const btn = document.getElementById('buzzer');
    btn.disabled = exclude === playerName || excluded.includes(playerName);
    playerStatus.textContent = btn.disabled ? 'Waiting for another response' : 'Buzz in now!';
  }
  if (role === 'main-table') {
    clearInterval(timerInterval);
    startTimer(7);
  }
});

// displayQuestion
socket.on('displayQuestion', ({ question, image }) => {
  if (role !== 'main-table') return;

  boardContainer.style.display = 'none';
  modal.style.display = 'block';

  const placeholder = document.getElementById('question-placeholder');
  placeholder.innerHTML = '';

  if (image) {
    const img = document.createElement('img');
    img.src = `/images/${image}`;
    img.onload = adjustQuestionFontSize;
    placeholder.appendChild(img);
  }

  const qText = document.createElement('div');
  qText.id = 'question-text';
  qText.textContent = question;
  placeholder.appendChild(qText);

  adjustQuestionFontSize();

  storedQuestionText    = question;
});



// adjustQuestionFontSize
function adjustQuestionFontSize() {
  const el = document.getElementById('question-text');
  const container = document.getElementById('question-placeholder');
  if (!el || !container) return;
  let size = 100;
  el.style.fontSize = size + 'px';
  while (container.scrollHeight > container.clientHeight && size > 20) {
    size--;
    el.style.fontSize = size + 'px';
  }
}

// Question timer
let timerInterval = null;
function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;

  const display = document.getElementById('timer-display');
  display.style.display = 'block';
  display.textContent = remaining;

  timerInterval = setInterval(() => {
    remaining--;
    if (remaining >= 0) {
      display.textContent = remaining;
    }
    if (remaining <= 0) {
      clearInterval(timerInterval);
      display.textContent = "Time’s up!";

      // only main-table should hear the sound, except in Final Jeopardy
      if (role === 'main-table' && !isFinalJeopardy) {
        timesUpSound.currentTime = 0;
        timesUpSound.play();
      }
      socket.emit('disableBuzzers');
    }
  }, 1000);
}

// closeQuestion
function closeQuestion() {
  if (role === 'quiz-master') socket.emit('questionClosed');
  if (role === 'main-table') {
    modal.style.display = 'none';
    boardContainer.style.display = 'block';
  }
  const banner = document.getElementById('daily-double-banner');
  if (banner) banner.remove();

  firstBuzzedPlayer            = null;
  currentQuestionIsDailyDouble = false;
  storedQuestionText           = '';
  const placeholder            = document.getElementById('question-placeholder');
  placeholder.innerHTML        = '';
  placeholder.style.fontSize   = '36px';


  const timerDisplay = document.getElementById('timer-display');
  if (timerDisplay) timerDisplay.textContent = '';

  if (buzzedInDisplay) buzzedInDisplay.style.display = 'none';

  const wageredPlayersDiv = document.getElementById('wagered-players');
  if (wageredPlayersDiv) wageredPlayersDiv.style.display = 'none';

  const answersDiv = document.getElementById('final-jeopardy-answers');
  if (answersDiv) {
    answersDiv.style.display = 'none';
    answersDiv.innerHTML = '';
  }

  if (role === 'quiz-master') {
    resetHostClue();
  }
}

function resetHostClue() {
  quizMasterQuestion.textContent = 'Waiting for a clue to be selected.';
  quizMasterAnswer.textContent = 'The response will appear here.';
  quizMasterBuzz.textContent = 'Waiting for a buzz';
  quizMasterBuzz.classList.remove('is-active');
  quizMasterWager.style.display = 'none';
  quizMasterWager.textContent = '';
  quizMasterAwardButton.disabled = true;
  quizMasterRemovePointsButton.disabled = true;
  firstBuzzedPlayer = null;
}

socket.on('questionClosed', () => {
  if (role === 'main-table') closeQuestion();
  if (role === 'quiz-master') resetHostClue();
  if (role === 'player') {
    buzzer.disabled = true;
    playerMessage.style.display = 'none';
    buzzerContainer.style.display = 'block';
    playerStatus.textContent = 'Waiting for the next clue';
  }
});

// generateJeopardyBoard
function generateJeopardyBoard(categoriesData, startAnimations = true) {
  jeopardyBoard.innerHTML = '';
  dailyDoubleCells = [];

  categoriesData.forEach((categoryData, idx) => {
    const categoryHeader = document.createElement('div');
    categoryHeader.classList.add('category-header');

    // Insert the category name as text, then let the helper shrink it to fit
    categoryHeader.textContent = categoryData.name;
    adjustCategoryFontSizeForHeader(categoryHeader);

    jeopardyBoard.appendChild(categoryHeader);
  });

  // Older Jeopardy games used different dollar values; use each game's data.
  const values = [...new Set(categoriesData.flatMap(category => category.questions))].sort((a, b) => a - b);

  const categoryValuesMap = {};
  categoriesData.forEach((categoryData) => {
    categoryValuesMap[categoryData.name] = new Set(categoryData.questions);
  });

  const potentialDailyDoubleCells = [];

  values.forEach((value) => {
    categoriesData.forEach((categoryData) => {
      const category = categoryData.name;

      if (categoryValuesMap[category].has(value)) {
        const cell = document.createElement('div');
        cell.classList.add('jeopardy-cell');
        cell.textContent = '';
        cell.dataset.value = value;
        cell.dataset.category = category;

        if (value !== values[0]) {
          potentialDailyDoubleCells.push(cell);
        }

        cell.addEventListener('click', () => {
          if (isFinalJeopardy || cell.dataset.played) return;
          cell.dataset.played = 'true';

          cell.textContent = '';

          animateCellToFullscreen(cell, () => {
            currentQuestionValue = parseInt(cell.dataset.value);
            currentCategory = cell.dataset.category;
            buzzedInDisplay.textContent = '';
            buzzedInDisplay.style.display = 'none';

            socket.emit('resetBuzzers');

            storedQuestionText = '';
            const questionPlaceholder = document.getElementById('question-placeholder');
            questionPlaceholder.innerHTML = '';
            questionPlaceholder.style.fontSize = '36px';

            const timerDisplay = document.getElementById('timer-display');
            if (timerDisplay) {
              timerDisplay.textContent = '';
            }

            clearInterval(timerInterval);

            if (dailyDoubleCells.includes(cell)) {
              currentQuestionIsDailyDouble = true;
              showDailyDouble();
              socket.emit('setCurrentQuestionIsDailyDouble', true);
            } else {
              currentQuestionIsDailyDouble = false;
              socket.emit('setCurrentQuestionIsDailyDouble', false);
            }

            socket.emit('selectQuestion', {
              category: currentCategory,
              value: currentQuestionValue,
            });
          });
        });

        jeopardyBoard.appendChild(cell);
      } else {
        const cell = document.createElement('div');
        cell.classList.add('jeopardy-cell');
        cell.textContent = '';
        jeopardyBoard.appendChild(cell);
      }
    });
  });

  const assignedDailyDoubleCategories = new Set();

  let dailyDoubleCount = 0;
  const maxDailyDoubles = isDoubleJeopardy ? 2 : 1;

  while (dailyDoubleCount < maxDailyDoubles && potentialDailyDoubleCells.length > 0) {
    const randomIndex = Math.floor(Math.random() * potentialDailyDoubleCells.length);
    const dailyDoubleCell = potentialDailyDoubleCells.splice(randomIndex, 1)[0];

    const category = dailyDoubleCell.dataset.category;
    if (!assignedDailyDoubleCategories.has(category)) {
      assignedDailyDoubleCategories.add(category);
      dailyDoubleCells.push(dailyDoubleCell);
      dailyDoubleCell.dataset.dailyDouble = 'true';
      dailyDoubleCount++;
    }
  }

  if (role === 'main-table' && startAnimations) {
    // Hide the board, reveal all categories full-screen, then show board + fill values
    animateCategoryTitles(categoriesData);
  }
}

// animateCellToFullscreen
function animateCellToFullscreen(cell, callback) {
  const cellRect = cell.getBoundingClientRect();

  const overlay = cell.cloneNode(true);
  document.body.appendChild(overlay);

  overlay.style.position = 'absolute';
  overlay.style.left = `${cellRect.left}px`;
  overlay.style.top = `${cellRect.top}px`;
  overlay.style.width = `${cellRect.width}px`;
  overlay.style.height = `${cellRect.height}px`;
  overlay.style.zIndex = '1000';
  overlay.style.backgroundColor = '#003366';
  overlay.style.color = 'white';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.fontSize = '2em';

  overlay.getBoundingClientRect();
  overlay.style.transition = 'all 0.5s ease-in-out';

  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.fontSize = '5em';

  overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    overlay.remove();
    if (callback) callback();
  });
}

// Announce categories using the original board transitions.
function animateCategoryTitles(categoriesData) {
  // Grab the board container so we can hide/show it later
  const boardWrapper = document.getElementById('board-container');
  boardWrapper.style.display = 'none'; // Start with it hidden

  // Timing constants (ms)
  const logoShowTime  = 1500;  // how long to display the logo before crossfade
  const crossfadeTime = 1000;  // duration of logo→text fade
  const slideTime     = 750;   // how long the slide animation takes

  function revealBoard() {
    document.querySelectorAll('.category-overlay').forEach(element => element.remove());
    modal.style.display = 'none';
    document.querySelectorAll('.category-header').forEach((header, index) => {
      header.textContent = categoriesData[index].name;
      adjustCategoryFontSizeForHeader(header);
    });
    boardWrapper.style.display = 'block';
    boardWrapper.style.opacity = 0;
    boardWrapper.style.transition = 'opacity 0.5s ease-in-out';
    void boardWrapper.offsetWidth;
    boardWrapper.style.opacity = 1;
    setTimeout(animateDollarValues, 500);
  }

  // Recursive function to show category index i
  function showCategory(i) {
    if (i >= categoriesData.length) {
      revealBoard();
      return;
    }

    // Build a full-screen overlay for category #i
    const overlay = document.createElement('div');
    overlay.classList.add('category-overlay');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = '#003366'; // Jeopardy blue
    overlay.style.zIndex = '9999';
    overlay.style.overflow = 'hidden';

    // Create the centered Jeopardy logo
    const logo = document.createElement('img');
    logo.src = isDoubleJeopardy ? '/images/double_jeopardy.PNG' : '/images/jeopardylogo.jpg';
    logo.alt = isDoubleJeopardy ? 'Double Jeopardy' : 'Jeopardy Logo';
    logo.classList.add('category-logo');
    logo.style.position = 'absolute';
    logo.style.top = '50%';
    logo.style.left = '50%';
    logo.style.transform = 'translate(-50%, -50%)';
    logo.style.maxWidth = '90%';
    logo.style.maxHeight = '90%';
    logo.style.objectFit = 'contain';
    logo.style.opacity = '1';
    logo.style.transition = `opacity ${crossfadeTime}ms ease-in-out`;

    // Create the category‐name text (initially hidden)
    const textDiv = document.createElement('div');
    textDiv.classList.add('category-text');
    textDiv.textContent = categoriesData[i].name.toUpperCase();
    textDiv.style.position = 'absolute';
    textDiv.style.top = '50%';
    textDiv.style.left = '50%';
    textDiv.style.transform = 'translate(-50%, -50%)';
    textDiv.style.color = 'white';
    textDiv.style.fontSize = '10vw';
    textDiv.style.textTransform = 'uppercase';
    textDiv.style.textAlign = 'center';
    textDiv.style.opacity = '0';
    textDiv.style.transition = `opacity ${crossfadeTime}ms ease-in-out`;

    // Append logo + text to overlay, then attach to <body>
    overlay.appendChild(logo);
    overlay.appendChild(textDiv);
    document.body.appendChild(overlay);
    overlay.getBoundingClientRect(); // force reflow so CSS transitions run

    // After logoShowTime ms, cross-fade logo → text
    setTimeout(() => {
      logo.style.opacity = '0';     // fade out logo
      textDiv.style.opacity = '1';  // fade in text
    }, logoShowTime);

    // Once crossfade finishes (after logoShowTime + crossfadeTime), start TTS
    setTimeout(() => {
      const isLast = (i === categoriesData.length - 1);

      // A) Fire off the TTS request for this category name
      const ttsText = isLast
        ? `and... ${categoriesData[i].name.toUpperCase()}`
        : categoriesData[i].name.toUpperCase();
      socket.emit('fetchCategoryTTS', ttsText);

      // B) Install a one‐time callback that runs when TTS audio ends
      window._onCategoryTTSDone = () => {
        if (isLast) {
          revealBoard();
        } else {
          // If not the last category, build the “next overlay” off-screen to the right
          const nextIdx = i + 1;
          const nextOverlay = document.createElement('div');
          nextOverlay.classList.add('category-overlay');
          nextOverlay.style.position = 'fixed';
          nextOverlay.style.top = '0';
          nextOverlay.style.left = '0';
          nextOverlay.style.width = '100vw';
          nextOverlay.style.height = '100vh';
          nextOverlay.style.backgroundColor = '#003366';
          nextOverlay.style.zIndex = '9999';
          nextOverlay.style.overflow = 'hidden';
          nextOverlay.style.transform = 'translateX(100vw)';
          nextOverlay.style.opacity = '1';

          // Put the Jeopardy logo into nextOverlay
          const nextLogo = document.createElement('img');
          nextLogo.src = isDoubleJeopardy ? '/images/double_jeopardy.PNG' : '/images/jeopardylogo.jpg';
          nextLogo.alt = isDoubleJeopardy ? 'Double Jeopardy' : 'Jeopardy Logo';
          nextLogo.classList.add('category-logo');
          nextLogo.style.position = 'absolute';
          nextLogo.style.top = '50%';
          nextLogo.style.left = '50%';
          nextLogo.style.transform = 'translate(-50%, -50%)';
          nextLogo.style.maxWidth = '90%';
          nextLogo.style.maxHeight = '90%';
          nextLogo.style.objectFit = 'contain';
          nextLogo.style.opacity = '1';
          nextLogo.style.transition = `opacity ${crossfadeTime}ms ease-in-out`;
          nextOverlay.appendChild(nextLogo);

          // Put the next category’s text (hidden) into nextOverlay
          const nextText = document.createElement('div');
          nextText.classList.add('category-text');
          nextText.textContent = categoriesData[nextIdx].name.toUpperCase();
          nextText.style.position = 'absolute';
          nextText.style.top = '50%';
          nextText.style.left = '50%';
          nextText.style.transform = 'translate(-50%, -50%)';
          nextText.style.color = 'white';
          nextText.style.fontSize = '10vw';
          nextText.style.textTransform = 'uppercase';
          nextText.style.textAlign = 'center';
          nextText.style.opacity = '0';
          nextText.style.transition = `opacity ${crossfadeTime}ms ease-in-out`;
          nextOverlay.appendChild(nextText);

          document.body.appendChild(nextOverlay);
          nextOverlay.getBoundingClientRect(); // force reflow for slide

          // Slide current overlay off‐screen left, bring nextOverlay into view
          overlay.style.transition = `transform ${slideTime}ms ease-in-out`;
          overlay.style.transform = 'translateX(-100vw)';
          nextOverlay.style.transition = `transform ${slideTime}ms ease-in-out`;
          nextOverlay.style.transform = 'translateX(0)';

          // After the slide finishes, remove the old overlay and recurse
          setTimeout(() => {
            overlay.remove();
            showCategory(nextIdx);
          }, slideTime);
        }
      };
    }, logoShowTime + crossfadeTime);
  }

  // Start the entire sequence at index 0
  showCategory(0);
}

// animateDollarValues
function animateDollarValues() {
  const cells = Array.from(document.querySelectorAll('.jeopardy-cell'));
  const validCells = cells.filter((cell) => cell.dataset.value);

  const shuffledCells = shuffleArray(validCells);

  if (boardFillSound) {
    boardFillSound.currentTime = 0;
    boardFillSound.play();
  }

  let index = 0;
  function fillNextCell() {
    if (index >= shuffledCells.length) {
      return;
    }

    const cell = shuffledCells[index];
    const value = cell.dataset.value;
    cell.textContent = `$${value}`;

    index++;
    setTimeout(fillNextCell, 50);
  }

  fillNextCell();
}

// shuffleArray
function shuffleArray(array) {
  let currentIndex = array.length,
    temporaryValue,
    randomIndex;

  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

// adjustCategoryFontSizeForHeader
function adjustCategoryFontSizeForHeader(header) {
  let fontSize = 32;                // start larger for readability
  header.style.fontSize = fontSize + 'px';
  header.style.whiteSpace = 'normal';
  header.style.lineHeight = '1';     // ← lock line-height so multi-line wrapping is tight

  while (
    (header.scrollHeight > header.clientHeight ||
      header.scrollWidth  > header.clientWidth) &&
    fontSize > 10
  ) {
    fontSize -= 1;
    header.style.fontSize = fontSize + 'px';
  }
}

// Helper: playIntroVideo(callback)
function playIntroVideo(callback) {
  const introVid = document.createElement('video');
  introVid.src = '/video/introvid.mp4';
  introVid.id  = 'intro-video';
  introVid.autoplay = true;
  introVid.playsInline = true;
  introVid.muted = true;               // keep built-in audio silent
  introVid.style.position = 'fixed';
  introVid.style.top      = '0';
  introVid.style.left     = '0';
  introVid.style.width    = '100vw';
  introVid.style.height   = '100vh';
  introVid.style.objectFit = 'cover';
  introVid.style.zIndex   = '99999';

  document.body.appendChild(introVid);

  // Stop any leftover timers/sounds from the previous round
  clearInterval(timerInterval);
  timesUpSound.pause();
  timesUpSound.currentTime = 0;

  // Play separate intro music while the video runs
  const introMusic = new Audio('/sounds/intromusic.mp3');
  introMusic.volume = 0.6;          // start a bit quieter
  introMusic.play().catch(() => {});

  const fadeStart = 8;              // begin fading before TTS starts
  const fadeEnd   = 12;             // mostly faded by the time TTS begins

  introMusic.addEventListener('timeupdate', () => {
    if (introMusic.currentTime >= fadeStart && introMusic.currentTime <= fadeEnd) {
      const remaining = fadeEnd - introMusic.currentTime;
      introMusic.volume = Math.max(remaining / (fadeEnd - fadeStart), 0);
    }
  });

  introMusic.addEventListener('ended', () => {
    introMusic.remove();
  });

  setTimeout(() => {
    // Slight pause between the two phrases for clarity
    requestVoice('Welcome contestants!! ... Here are your Jeopardy categories.', 'intro');
  }, 12000);

  const startTime = Date.now();
  const MIN_INTRO_TIME = 15000; // allow welcome TTS to finish

  const cleanup = (overlay) => {
    introMusic.pause();
    introMusic.remove();
    if (overlay) overlay.remove();
    if (callback) callback();
  };

  let cleanupScheduled = false;
  const maybeCleanup = () => {
    if (cleanupScheduled) return;
    cleanupScheduled = true;

    const elapsed = Date.now() - startTime;
    const delay = Math.max(MIN_INTRO_TIME - elapsed, 0);

    // Show the Jeopardy logo while waiting for the board to appear
    const overlay = document.createElement('div');
    overlay.id = 'intro-logo-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = '#003366';
    overlay.style.zIndex = '99998';

    const logoImg = document.createElement('img');
    logoImg.src = '/images/jeopardylogo.jpg';
    logoImg.alt = 'Jeopardy Logo';
    logoImg.style.position = 'absolute';
    logoImg.style.top = '50%';
    logoImg.style.left = '50%';
    logoImg.style.transform = 'translate(-50%, -50%)';
    logoImg.style.width = '100%';
    logoImg.style.height = '100%';
    logoImg.style.objectFit = 'cover';

    overlay.appendChild(logoImg);
    document.body.appendChild(overlay);

    // Remove the video element now that it has finished
    introVid.remove();

    setTimeout(() => cleanup(overlay), delay);
  };

  introVid.addEventListener('ended', maybeCleanup);
  introVid.addEventListener('click', maybeCleanup);
  introVid.addEventListener('error', maybeCleanup);
}


// currentQuestionIsDailyDouble
socket.on('currentQuestionIsDailyDouble', (isDailyDouble) => {
  currentQuestionIsDailyDouble = isDailyDouble;
  if (role === 'player' && isDailyDouble) {
    buzzer.disabled = false;
    playerStatus.textContent = 'Daily Double! Buzz in to wager.';
  }
});

// updatePlayerScores
function updatePlayerScores() {
  if (role !== 'player' && role !== 'main-table') return;
  const everyone = Object.values(players);
  if (role === 'player') {
    const ownPlayer = everyone.find(player => player.name === playerName);
    if (ownPlayer) {
      const score = document.getElementById('player-score');
      score.textContent = formatScore(ownPlayer.score);
      score.classList.toggle('negative-score', ownPlayer.score < 0);
    }
  }
  if (role === 'main-table' && !isFinalJeopardy) {
    scoreTableFooter.style.display = 'none';
    return;
  }
  const visiblePlayers = everyone.filter(player => role !== 'player' || player.name !== playerName);
  scoreTableFooter.replaceChildren();
  visiblePlayers.forEach(player => {
    const entry = document.createElement('div');
    entry.className = 'score-entry';
    entry.dataset.playerName = player.name;
    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = player.name;
    const score = document.createElement('span');
    score.className = 'score-value';
    score.textContent = formatScore(player.score);
    if (player.score < 0) score.classList.add('negative-score');
    entry.append(name, score);
    scoreTableFooter.appendChild(entry);
  });
  scoreTableFooter.style.display = visiblePlayers.length ? (role === 'player' ? 'flex' : 'block') : 'none';
  highlightBuzzedPlayer(firstBuzzedPlayer);
}

function formatScore(score) {
  return score < 0 ? `-$${Math.abs(score)}` : `$${score}`;
}

function highlightBuzzedPlayer(name) {
  document.querySelectorAll('#score-table-footer .score-entry').forEach((el) => {
    if (el.dataset.playerName === name) {
      el.classList.add('buzzed');
    } else {
      el.classList.remove('buzzed');
    }
  });
}


// updateEditScoresInterface
function updateEditScoresInterface() {
  const playerScoresDiv = document.getElementById('player-scores');
  playerScoresDiv.replaceChildren();
  const count = Object.keys(players).length;
  document.getElementById('host-player-count').textContent = `${count} ${count === 1 ? 'PLAYER' : 'PLAYERS'}`;
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'empty-players';
    empty.textContent = 'No players yet. Contestants can join from their own devices.';
    playerScoresDiv.appendChild(empty);
  }

  for (const id in players) {
    const player = players[id];
    const playerDiv = document.createElement('div');
    playerDiv.classList.add('player-score-entry');

    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name;

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.value = player.score;
    scoreInput.dataset.playerId = id;
    scoreInput.setAttribute('aria-label', `Score for ${player.name}`);

    const updateButton = document.createElement('button');
    updateButton.textContent = 'Save';
    updateButton.addEventListener('click', () => {
      const newScore = Number(scoreInput.value);
      if (scoreInput.value && Number.isInteger(newScore)) socket.emit('updatePlayerScore', { playerId: id, score: newScore });
    });

    playerDiv.appendChild(nameSpan);
    playerDiv.appendChild(scoreInput);
    playerDiv.appendChild(updateButton);

    if (isFinalJeopardy) {
      const showAnswerButton = document.createElement('button');
      showAnswerButton.textContent = 'Show Answer';
      showAnswerButton.disabled = !finalResultsVisible;
      showAnswerButton.addEventListener('click', () => {
        socket.emit('revealPlayerFinalAnswer', player.name);
      });

      const awardPointsButton = document.createElement('button');
      awardPointsButton.textContent = 'Award Points';
      awardPointsButton.disabled = !finalResultsVisible || !Object.hasOwn(quizMasterWagers, player.name) || settledFinalPlayers.has(player.name);
      awardPointsButton.addEventListener('click', () => {
        socket.emit('finalJeopardyAwardPoints', player.name);
      });

      const removePointsButton = document.createElement('button');
      removePointsButton.textContent = 'Remove Points';
      removePointsButton.disabled = awardPointsButton.disabled;
      removePointsButton.addEventListener('click', () => {
        socket.emit('finalJeopardyDeductPoints', player.name);
      });

      const finalActions = document.createElement('div');
      finalActions.className = 'final-player-actions';
      finalActions.append(showAnswerButton, awardPointsButton, removePointsButton);
      playerDiv.appendChild(finalActions);
    }

    playerScoresDiv.appendChild(playerDiv);
  }
}

// Socket event: updatePlayers
socket.on('updatePlayers', (updatedPlayers) => {
  players = updatedPlayers;
  updatePlayerScores();

  if (role === 'quiz-master') {
    updateEditScoresInterface();
  }
});

// Socket event: resetBuzzers
socket.on('resetBuzzers', ({ exclude, excluded = [], enabled = false } = {}) => {
  if (role === 'player') {
    buzzer.disabled = !enabled || exclude === playerName || excluded.includes(playerName);
    playerStatus.textContent = buzzer.disabled ? 'Waiting for the next clue' : 'Buzz in now!';
  }
  if (role === 'quiz-master') {
    quizMasterBuzz.textContent = 'Waiting for a buzz';
    quizMasterBuzz.classList.remove('is-active');
    quizMasterAwardButton.disabled = true;
    quizMasterRemovePointsButton.disabled = true;
  }
  firstBuzzedPlayer = null;
  buzzedInDisplay.textContent = '';
  buzzedInDisplay.style.display = 'none';
  highlightBuzzedPlayer(null);
});

// Advance to Double Jeopardy
socket.on('advanceToDoubleJeopardy', () => {
  isDoubleJeopardy = true;
  document.getElementById('host-round').textContent = 'DOUBLE JEOPARDY!';
  if (role === 'quiz-master') advanceToDoubleJeopardyBtn.style.display = 'none';
  showDoubleJeopardyScreen();
});

function showDoubleJeopardyScreen() {
  if (role === 'main-table') {
    boardContainer.style.display = 'none';
    modal.style.display = 'none';

    const doubleJeopardyScreen = document.createElement('div');
    doubleJeopardyScreen.id = 'double-jeopardy-screen';
    doubleJeopardyScreen.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: #003366;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;

    const djImage = document.createElement('img');
    djImage.src = '/images/double_jeopardy.PNG';
    djImage.style.width = '100%';
    djImage.style.height = '100%';
    djImage.style.objectFit = 'cover';
    doubleJeopardyScreen.appendChild(djImage);
    document.body.appendChild(doubleJeopardyScreen);

    setTimeout(() => {
      doubleJeopardyScreen.remove();

      // 6a) Now generate the new board AND let it auto-animate (logo→text→dollar)
      generateJeopardyBoard(categoriesData, true);
      boardContainer.style.display = 'block';
    }, 7000);
  }
}

// Advance to Final Jeopardy
socket.on('advanceToFinalJeopardy', (category) => {
  isFinalJeopardy = true;
  quizMasterWagers = {};
  finalResultsVisible = false;
  settledFinalPlayers.clear();
  clearTimeout(finalRevealTimer);
  updateQuizMasterWagerList();
  if (role === 'quiz-master') {
    resetHostClue();
    quizMasterBuzz.textContent = 'Waiting for final wagers';
    advanceToDoubleJeopardyBtn.style.display = 'none';
    advanceToFinalJeopardyBtn.style.display = 'none';
    quizMasterResetButton.disabled = true;
    quizMasterCloseQuestionBtn.disabled = true;
  } else if (role === 'player') {
    buzzer.disabled = true;
    playerStatus.textContent = 'Waiting for the final category';
  }
  document.getElementById('host-round').textContent = 'FINAL JEOPARDY!';
  finalJeopardyCategory = category;
  if (role === 'main-table') {
    scoreTableFooter.style.display = 'block';
  }
  showFinalJeopardyScreen();
});

function showFinalJeopardyScreen() {
  if (role === 'main-table') {
    boardContainer.style.display = 'none';
    modal.style.display = 'none';

    const finalJeopardyScreen = document.createElement('div');
    finalJeopardyScreen.id = 'final-jeopardy-screen';

    const fjImage = document.createElement('img');
    fjImage.src = '/images/final_jeopardy.PNG';

    finalJeopardyScreen.appendChild(fjImage);
    document.body.appendChild(finalJeopardyScreen);

    setTimeout(() => {
      finalJeopardyScreen.remove();

      const wageredPlayersDiv = document.getElementById('wagered-players');
      if (wageredPlayersDiv) {
        wageredPlayersDiv.style.display = 'none';
      }

      storedQuestionText = `${finalJeopardyCategory}`;

      const answersDiv = document.getElementById('final-jeopardy-answers');
      answersDiv.innerHTML = '';
      answersDiv.style.display = 'none';

      modal.style.display = 'block';
      const questionPlaceholder = document.getElementById('question-placeholder');
      questionPlaceholder.innerHTML = '';

      const questionText = document.createElement('div');
      questionText.id = 'question-text';
      questionText.textContent = storedQuestionText;
      questionPlaceholder.appendChild(questionText);

      adjustQuestionFontSize();

      if (wageredPlayersDiv) {
        wageredPlayersDiv.style.display = 'none';
      }

      requestVoice(finalJeopardyCategory, 'final-category');
    }, 10000);
  }

}

// startFinalJeopardy
socket.on('startFinalJeopardy', (startScores) => {
  if (startScores) finalJeopardyStartScores = startScores;
  if (role === 'quiz-master') showFinalQuestionBtn.style.display = 'block';
  if (role === 'player') {
    playerMessage.style.display = 'none';
    showWagerForm();
    finalAnswerContainer.style.display = 'none';
    scoreTableFooter.style.display = 'flex';
  }
  if (role === 'main-table') {
    scoreTableFooter.style.display = 'block';
  }
});

// showFinalQuestion
socket.on('showFinalQuestion', (question) => {
  storedQuestionText = question;

  if (role === 'main-table') {
    const questionPlaceholder = document.getElementById('question-placeholder');
    questionPlaceholder.innerHTML = '';

    const questionText = document.createElement('div');
    questionText.id = 'question-text';
    questionText.textContent = storedQuestionText;
    questionPlaceholder.appendChild(questionText);

    adjustQuestionFontSize();

    const wageredPlayersDiv = document.getElementById('wagered-players');
    if (wageredPlayersDiv) {
      wageredPlayersDiv.style.display = 'none';
    }
    requestVoice(question, 'final');
  }
});

socket.on('startFinalTimer', () => {
  if (role === 'quiz-master') {
    quizMasterBuzz.textContent = 'Players have 60 seconds to respond.';
    clearTimeout(finalRevealTimer);
    finalRevealTimer = setTimeout(() => {
      showFinalAnswerBtn.disabled = false;
      quizMasterBuzz.textContent = 'Time is up. Reveal the responses.';
    }, 60 * 1000);
  }
  startFinalJeopardyTimer();
});

socket.on('updateFinalJeopardyPlayers', ({ wagers }) => {
  if (role === 'quiz-master') {
    if (wagers) quizMasterWagers = { ...quizMasterWagers, ...wagers };
    updateQuizMasterWagerList();
  }
});

// startFinalJeopardyTimer
function startFinalJeopardyTimer() {
  if (role === 'main-table') {
    finalJeopardySound.currentTime = 0;
    finalJeopardySound.play();

    startTimer(60);

    let playCount = 0;
    finalJeopardySound.onended = function () {
      playCount++;
      if (playCount < 2) {
        finalJeopardySound.currentTime = 0;
        finalJeopardySound.play();
      } else {
        finalJeopardySound.onended = null;
      }
    };
  }

  if (role === 'player') {
    finalAnswerContainer.style.display = 'block';
    playerMessage.style.display = 'none';
    buzzerContainer.style.display     = 'none';
    finalAnswerInput.value = '';
    finalAnswerInput.disabled = false;
    playerStatus.textContent = 'Write your final response';
    setTimeout(() => {
      finalAnswerInput.disabled = true;
      const answer = finalAnswerInput.value.trim();
      socket.emit('submitFinalAnswer', { name: playerName, answer });
      playerStatus.textContent = 'Response submitted';
    }, 60 * 1000);
  }
}

// Keep the response current so it is available as soon as the timer ends.
finalAnswerInput.addEventListener('input', () => {
  if (role === 'player' && isFinalJeopardy && !finalAnswerInput.disabled) {
    socket.emit('submitFinalAnswer', { name: playerName, answer: finalAnswerInput.value.trim() });
  }
});

// displayPlayerFinalAnswer
socket.on('displayPlayerFinalAnswer', ({ playerName, answer }) => {
  if (role === 'main-table') {
    const span = document.getElementById(`answer-${playerName}`);
    if (span) span.textContent = answer;
  }
});

// finalJeopardyUpdateScore
socket.on('finalJeopardyUpdateScore', ({ playerName, newScore }) => {
  if (role === 'main-table') {
    const totalSpan = document.getElementById(`total-${playerName}`);
    if (totalSpan) totalSpan.textContent = `$${newScore}`;
  }
});

socket.on('finalJeopardyShowWager', ({ playerName, wager, correct }) => {
  if (role === 'quiz-master') {
    settledFinalPlayers.add(playerName);
    updateEditScoresInterface();
  }
  if (role === 'main-table') {
    const span = document.getElementById(`wager-${playerName}`);
    if (span) {
      span.textContent = `$${wager}`;
      span.style.color = correct ? 'lime' : 'red';
    }
  }
});

socket.on('announceWinner', ({ names, score, standings }) => {
  if (role === 'main-table') {
    names.forEach(name => {
      const row = document.getElementById(`row-${name}`);
      if (row) row.classList.add('fj-winner');
    });
  }
  if (role === 'player') {
    const winDiv = document.getElementById('winner-announcement');
    if (!winDiv) return;
    const standing = standings && standings[playerName];
    if (!standing) return;

    finalAnswerContainer.style.display = 'none';
    playerStatus.textContent = 'Final results';

    let message = '';
    const rank = standing.rank;
    const suffix = ordinalSuffix(rank);

    if (names.includes(playerName)) {
      message = 'You are the Winner!';
      if (navigator.vibrate) navigator.vibrate([200,100,200,100,200]);
    } else {
      const tiedCount = Object.values(standings).filter(s => s.rank === rank).length;
      if (tiedCount > 1) message = `You are tied for ${suffix}`;
      else message = `You came in ${suffix}`;
    }

    winDiv.innerHTML = `<h2>${message}</h2>`;
    winDiv.style.display = 'block';
  }
});

function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return n + 'st';
  if (j === 2 && k !== 12) return n + 'nd';
  if (j === 3 && k !== 13) return n + 'rd';
  return n + 'th';
}

// displayFinalAnswer
socket.on('displayFinalAnswer', () => {
  if (role === 'quiz-master') {
    finalResultsVisible = true;
    showFinalAnswerBtn.style.display = 'none';
    quizMasterBuzz.textContent = 'Show and score each contestant’s response.';
    updateEditScoresInterface();
  }
  if (role === 'main-table') {
    clearInterval(timerInterval);
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay) timerDisplay.style.display = 'none';
    const wageredPlayersDiv = document.getElementById('wagered-players');
    if (wageredPlayersDiv) wageredPlayersDiv.style.display = 'none';

    const questionPlaceholder = document.getElementById('question-placeholder');
    questionPlaceholder.innerHTML = '';

    const answersDiv = document.getElementById('final-jeopardy-answers');
    answersDiv.innerHTML = '';
    answersDiv.style.display = 'flex';

    const header = document.createElement('div');
    header.classList.add('fj-result-row', 'fj-header-row');

    const hName = document.createElement('span');
    hName.textContent = 'Player';
    hName.classList.add('fj-name');

    const hStart = document.createElement('span');
    hStart.textContent = 'Start';
    hStart.classList.add('fj-start-score');

    const hAnswer = document.createElement('span');
    hAnswer.textContent = 'Answer';
    hAnswer.classList.add('fj-answer');

    const hWager = document.createElement('span');
    hWager.textContent = 'Wager';
    hWager.classList.add('fj-wager');

    const hTotal = document.createElement('span');
    hTotal.textContent = 'Total Score';
    hTotal.classList.add('fj-final');

    header.appendChild(hName);
    header.appendChild(hStart);
    header.appendChild(hAnswer);
    header.appendChild(hWager);
    header.appendChild(hTotal);

    answersDiv.appendChild(header);

    const names = Object.keys(finalJeopardyStartScores)
      .sort((a, b) => finalJeopardyStartScores[a] - finalJeopardyStartScores[b]);
    names.forEach(name => {
      const row = document.createElement('div');
      row.classList.add('fj-result-row');
      row.id = `row-${name}`;

      const nameSpan = document.createElement('span');
      nameSpan.classList.add('fj-name');
      nameSpan.textContent = name;

      const startSpan = document.createElement('span');
      startSpan.classList.add('fj-start-score');
      startSpan.textContent = `$${finalJeopardyStartScores[name]}`;

      const ansSpan = document.createElement('span');
      ansSpan.classList.add('fj-answer');
      ansSpan.id = `answer-${name}`;

      const wagerSpan = document.createElement('span');
      wagerSpan.classList.add('fj-wager');
      wagerSpan.id = `wager-${name}`;

      const finalSpan = document.createElement('span');
      finalSpan.classList.add('fj-final');
      finalSpan.id = `total-${name}`;

      row.appendChild(nameSpan);
      row.appendChild(startSpan);
      row.appendChild(ansSpan);
      row.appendChild(wagerSpan);
      row.appendChild(finalSpan);

      answersDiv.appendChild(row);
    });
  }
});

// disconnect / reconnect / error / playerDisconnected
socket.on('disconnect', () => {
  if (role === 'player') {
    buzzer.disabled = true;
    playerStatus.textContent = 'Connection lost. Reconnecting…';
  }
});

socket.on('connect', () => {
  if (role) {
    if (role === 'player') {
      socket.emit('setRole', { role: 'player', playerId: playerId });
      if (playerName) {
        socket.emit('registerPlayer', { name: playerName, playerId: playerId });
        playerStatus.textContent = 'Reconnected. Waiting for the next clue.';
      }
    } else if (role === 'quiz-master') {
      socket.emit('setRole', { role, pin: hostPin });
    } else {
      socket.emit('setRole', role);
    }
  }
});

socket.on('error', (error) => {
  console.error('Socket error:', error);
});

socket.on('playerDisconnected', ({ name }) => {
  if (role === 'quiz-master') {
    const notice = `${name} disconnected`;
    quizMasterBuzz.textContent = notice;
    quizMasterBuzz.classList.remove('is-active');
    setTimeout(() => {
      if (quizMasterBuzz.textContent === notice) quizMasterBuzz.textContent = 'Waiting for a buzz';
    }, 5000);
  }
});

socket.on('errorMessage', message => {
  if (role === 'quiz-master') quizMasterBuzz.textContent = message;
  else if (role === 'player') playerStatus.textContent = message;
  else {
    alert(message);
    gameSelection.style.display = 'block';
    boardContainer.style.display = 'none';
  }
});

// spacebar buzz
document.addEventListener('keydown', (e) => {
  if (role === 'player' && playerView.style.display !== 'none') {
    if (e.code === 'Space') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      const buzzerButton = document.getElementById('buzzer');
      if (buzzerButton && !buzzerButton.disabled) {
        e.preventDefault();
        buzzerButton.click();
      }
    }
  }
});

// categoriesData from server
socket.on('categoriesData', (data) => {
  categoriesData   = data.categories;
  isDoubleJeopardy = data.isDoubleJeopardy;
  isFinalJeopardy  = data.isFinalJeopardy || false;

  if (role === 'main-table') {
    const startAnimations = !isDoubleJeopardy && !isFinalJeopardy;

    const runBoard = () => {
      generateJeopardyBoard(categoriesData, startAnimations);
    };

    if (startAnimations) {
      playIntroVideo(runBoard);
    } else {
      runBoard();
    }
  }
  else if (role === 'quiz-master') {
    document.getElementById('host-round').textContent = isFinalJeopardy ? 'FINAL JEOPARDY!' : isDoubleJeopardy ? 'DOUBLE JEOPARDY!' : 'JEOPARDY! ROUND';
    quizMasterResetButton.disabled = isFinalJeopardy;
    quizMasterCloseQuestionBtn.disabled = isFinalJeopardy;
    if (!isFinalJeopardy) {
      advanceToDoubleJeopardyBtn.style.display = isDoubleJeopardy ? 'none' : 'block';
      advanceToFinalJeopardyBtn.style.display = 'block';
      showFinalQuestionBtn.style.display = 'none';
      showFinalAnswerBtn.style.display = 'none';
    }
    updateEditScoresInterface();
  }
});

// Voice playback for category animation
socket.on('ttsCategoryAudio', ({ url, text }) => {
  window.playVoiceOver(url, text, () => {
    if (window._onCategoryTTSDone) {
      const callback = window._onCategoryTTSDone;
      window._onCategoryTTSDone = null;
      callback();
    }
  });
});
