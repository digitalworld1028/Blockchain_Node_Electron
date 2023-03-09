
module.exports = function(app, dataHandler){
  app.get('/getOneEntry', (req, res) => {
    var data = req.query;
    var type = data.type;
    if(typeof type !== "string") return res.send("type is not string!");
    var timestamp = data.timestamp;
    dataHandler.getOneEntry(type, timestamp, (error, data) => {
    	res.send(data);
    });
  });
  app.get('/getMultiEntry', (req, res) => {
    var data = req.query;
    var type = data.type;
    if(typeof type !== "string") return res.send("type is not string!");
    var timeStart = data.timeStart;
    var timeEnd = data.timeEnd;
    dataHandler.getMultiEntries(type, timeStart, timeEnd, (error, data) => {
    	res.send(data);
    });
  });
  app.get('/getLastEntries', (req, res) => {
    console.log('getLastEntries');
    dataHandler.getLastEntries((data) => {
      res.send(data);
    });
  });
  app.get('/hello', (req, res) => {
    res.send("Hello everyone!");
  })
};

