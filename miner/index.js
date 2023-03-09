const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config.json');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var http = require('http').Server(app);

const io = require('socket.io')(http);

const port = process.env.PORT || 3000;

const MiningNode = require('./miningNode');
const Miner = new MiningNode(port);

require('./route')(app, Miner);
require('./socket')(io, Miner);

http.listen(port, () => console.log(`Listening on port ${port}!`));