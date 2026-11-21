const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const { HOST, PORT } = require('./config');
const registerGame = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 1200000 });
const root = path.join(__dirname, '..', '..');

// Serve the interface and the game's existing media, including saved voices.
app.use(express.static(path.join(root, 'src', 'client')));
for (const directory of ['images', 'sounds', 'video']) {
  app.use(`/${directory}`, express.static(path.join(root, 'public', directory)));
}
registerGame(io, path.join(root, 'src', 'games'));

server.listen(PORT, HOST, () => {
  const port = server.address().port;
  console.log(`On this computer: http://localhost:${port}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter(address => address && address.family === 'IPv4' && !address.internal)
      .map(address => address.address);
    [...new Set(addresses)].forEach(address => console.log(`On your local network: http://${address}:${port}`));
  } else if (HOST !== 'localhost' && HOST !== '127.0.0.1') {
    console.log(`On your local network: http://${HOST}:${port}`);
  }
});
