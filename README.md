# Jeopardy game

## Play on your local network

Install Node.js 18 or newer, open a terminal in this folder, and run:

```sh
npm install
npm start
```

Open `http://localhost:3000` on this computer. The terminal also prints a local-network address such as `http://192.168.1.20:3000`: use that address on phones or other computers connected to the same network. Allow Node.js through the local firewall if the other devices cannot connect. Stop the server with Ctrl+C.

Choose **Show the board** on the shared display, select a game, and let the intro finish. Choose **Host the game** on the host's device, and **Play the game** on each contestant's device. Contestants can tap their buzzer or press the spacebar after the clue is read. The host judges responses, edits scores if needed, and advances the rounds. Final Jeopardy responses are submitted automatically after the timer.

Game state and scores are held in memory while the server is running. A disconnected contestant can reconnect with the same name on the same device to recover their score for up to three hours.

The server listens on all local interfaces by default. To change the bind address or port, set `HOST` or `PORT` in the ignored `.env` file; see [.env.example](./.env.example). Set `HOST=127.0.0.1` to accept connections only from this computer.

The host screen asks for a PIN (default `1234`). Set `HOST_PIN` in `.env` or in Render's environment variables to change it.

## Resetting the game

On the host screen, **Reset game for new players** (with a confirmation) clears all players, scores and the loaded game, then sends every connected device back to the role screen. Use it between groups when hosting on a shared server such as Render. State is also lost whenever the server restarts or spins down.

## Voice recordings

The game plays saved MP3s from `public/sounds/voice/` and never calls ElevenLabs while a game is running. Alex Trebek was not available in the account's voice library, so the saved recordings use ElevenLabs' free premade **Bill** voice. The 1991-07-18 and 2025-09-11 games have complete sets; the intro and category announcements are saved for all included games. For clues without recordings, the board uses an English voice installed on that computer when the browser provides one; if none is available, play continues without narration.

To prepare another game's recordings once, set `ELEVEN_API_KEY` and `ELEVEN_VOICE_ID` in `.env` (the example uses Bill). Preview the number of recordings and characters first:

```sh
npm run voice:prepare -- --game 2023-09-12
npm run voice:prepare -- --game 2023-09-12 --generate
```

The second command uses ElevenLabs credits. Existing recordings are reused on subsequent runs. Use `--all` instead of `--game DATE` to prepare all games, or add `--categories-only` for category announcements. Use `npm run voice:inspect` to see the account's available voices and allowance. Changing the voice for recordings already saved requires `--replace` and uses credits again. Keep `.env` private; it is excluded from Git.

## Tests

```sh
npm test
```
