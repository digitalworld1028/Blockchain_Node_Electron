const database = require('./database');
const config = require('./config.json');
const tools = require('./tools');

module.exports = function(app, nodes){
  app.post('/check_userID', (req, res) => {
    const userID = req.body.userID;
    console.log(userID);
    database.check_userID(userID, (state, reason) => {
      res.send({isUnique: state, reason: reason});
    });
  });
  app.post('/register', (req, res) => {
    console.log('register request coming');
    const message = req.body.message;
    const signature = message[0];
    console.log(signature);
    const data = message[1];
    const pubKey_string = message[2];
    if(tools.validateSign(signature, data, pubKey_string)) {
      database.check_userID(data.userid, (state, reason) => {
        if(!state) {
          console.log(reason);
          return res.send({state: false, reason: reason});
        }
        database.addUser({userID: data.userid, first_name: data.firstName, last_name: data.lastName, public_key: pubKey_string}, (state, reason) => {
          if(!state) {
            console.log(reason)
            return res.send({state: false, reason: reason});
          }
          else {
            console.log(nodes[Math.floor(Math.random()*nodes.length)]);
            res.send({state: true, nodes: [nodes[Math.floor(Math.random()*nodes.length)]]});
          }
        });
      })
    }
    else {
      console.log('invalid data');
      return res.send({state: false, reason: "invalid data"});
    }
  });
  app.get('/getOneEntry', (req, res) => {
    var data = req.query;
    var type = data.type;
    if(typeof type !== "string") return;
    var timestamp = data.timestamp;
    if(timestamp && typeof timestamp !== "string") return;
    dataHandler.getOneEntry(type, timestamp, (error, data) => {
    	res.send(data);
    });
  });
  app.get('/getMultiEntry', (req, res) => {
    var data = req.query;
    var type = data.type;
    if(typeof type !== "string") return;
    var timeStart = data.timeStart;
    if(timeStart && typeof timeStart !== "string") return;
    var timeEnd = data.timeEnd;
    if(timeEnd && typeof timeEnd !== "string") return;
    dataHandler.getMultiEntries(type, timeStart, timeEnd, (error, data) => {
    	res.send(data);
    });
  });
  app.get('/hello', (req, res) => {
    res.send("Hello everyone!");
  })
};

