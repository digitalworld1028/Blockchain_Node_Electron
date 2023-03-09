

module.exports = function(io, Miner) {
    io.use(function(socket, next){
      next();
    })
    .on('connection', (socket) => {
      var query = socket.handshake.query;
      const link_type = query.link_type;
      if(link_type == "client") {
        console.log('user '+query.userid+' connected');
        const userid = query.userid;
        Miner.addUser(userid, socket);
      }
      else if(link_type == "miner") {
        console.log(socket.handshake.query.port+' is connected');
        console.log('publicKey:'+socket.handshake.query.publickey);
        Miner.addMiner(socket);
      }
    });
  }