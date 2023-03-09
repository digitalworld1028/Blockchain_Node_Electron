const io_cli = require("socket.io-client");
const nodes = require('./config.json').nodes;

module.exports = function(dataHandler) {
  var ioClients = [];
  for(var i = 0; i < nodes.length; i++) {
    ioClients[i] = io_cli.connect(nodes[i], {reconnect: true});
    ioClients[i].on('connect', function() {
      dataHandler.nodePlus();
      console.log("node connect");
    });
    ioClients[i].on('disconnect', function() {
      dataHandler.nodeMinus();
      console.log("node disconnect");
    });
    ioClients[i].on('broadcast', function(data) {
      dataHandler.addOtherBuffers("server"+i, data);
    });
  }
}