const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const config = require('./config.json');

const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/'+config.db, { useCreateIndex: true, useUnifiedTopology: true, useNewUrlParser: true });

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var http = require('http').Server(app);
var io = require('socket.io')(http);

const DataHandler = require("./DataHandler");
const dataHandler = new DataHandler(io);

require('./route')(app, dataHandler);

require('./socket')(dataHandler);

const port = process.env.PORT || config.port;

http.listen(port, () => console.log(`Listening on port ${port}!`));
function getData() {
    for(var each of config.support) {
        getEachData(each);
    }
}
function getEachData(each) {
    axios.get(config.scraper+'/trading/'+each+'/1/1/').then((respond) => {
        var data = respond.data;
        if(typeof data === "string") {
            data = data.trim();
            if(data === "") return;
            data = JSON.parse(data.replace(/'/g, '"'));
        }
        if(!Array.isArray(data)) return;
        if(!data.length) return;
        if(typeof data === 'object' && data !== null) {
            data = {type: each, data: data};
        }
        dataHandler.receiveData(data);
    }).catch((error) => {
        console.log(error);
    });
}
getData();
setInterval(() => {
  getData();
}, 30000);
