const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

module.exports = {
  HOST: process.env.HOST || '0.0.0.0',
  PORT: process.env.PORT === undefined ? 3000 : Number(process.env.PORT)
};
