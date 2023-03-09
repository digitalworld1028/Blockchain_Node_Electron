const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const config = require('./config.json');

const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/'+config.db, { useCreateIndex: true, useUnifiedTopology: true, useNewUrlParser: true });

const nodes = [];

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var http = require('http').Server(app);

require('./route')(app, nodes);

const io = require('socket.io')(http);
require('./socket.js')(io, nodes);



const port = process.env.PORT || config.port;

http.listen(port, () => console.log(`Listening on port ${port}!`));