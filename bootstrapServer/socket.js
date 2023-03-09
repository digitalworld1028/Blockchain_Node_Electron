const { addData } = require('./database');
const config = require('./config.json');


module.exports = function(io, nodes) {
  io.on('connection', (socket) => {
    console.log(socket.handshake.query.port+' connected');
    if(socket.handshake.query.link_type === "miner") {
      var port = socket.handshake.query.port;//for test
      var publickey = socket.handshake.query.publickey;
      if(!nodes.filter((each) => each.address == 'http://localhost:'+port).length) {
        nodes.push({address:'http://localhost:'+port, publickey: publickey});
      }
    }
    console.log(nodes);
    socket.on('disconnect', () => {
      console.log(socket.handshake.query.port+"disconnected");
      nodes = nodes.filter((each) => each.address != 'http://localhost:'+socket.handshake.query.port);
      socket.removeAllListeners();
    })
    socket.on('allNodes', ()=>{
      socket.emit('allNodes_response', nodes.map((each) => {if(each.address != 'http://localhost:'+socket.handshake.query.port) return each;}));
    })
  });
  // console.log("linking socket...");
  // var ioClients = [];
  // for(var i = 0; i < nodes.length; i++) {
  //   ioClients[i] = io_cli.connect(nodes[i]);
  //   ioClients[i].on('connect', function() {
  //     dataHandler.nodePlus();
  //     console.log('node added');
  //   });
  //   ioClients[i].on('disconnect', function() {
  //     dataHandler.nodeMinus();
  //     console.log('node disconnected');
  //   });
  //   dataHandler.createOtherBuffers("server"+i);
  //   ioClients[i].on('broadcast', function(data) {
  //     dataHandler.addOtherBuffers("server"+i, data);
  //   });
  // }
}