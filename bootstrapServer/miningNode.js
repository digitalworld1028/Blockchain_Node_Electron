// const SHA256 = require('crypto-js/sha256');

const database = require('./database');
const tools = require('./tools');
const config = require('./config.json');

// function computeHash(data){
//   return SHA256(data).toString();
// }
module.exports = class MiningNode {
  constructor(io) {
    this.blockchain = [];
    this.createGenesisBlock();
    this.buffer = [];
    this.miningState = false;

    this.io = io;
    this.clientRoom = {};
    this.MADLedger = {};
    // var nodeRoom = [];
    this.socketInit();
    this.getLastMADLedger();
  }
  createGenesisBlock() {
    console.log('create genesis Block');
    this.blockchain.push(tools.createGenesisBlock());
    console.log('genesis Block created');
    console.log(this.blockchain);
  }
  socketInit() {
    this.io.use(function(socket, next){
      // if (socket.handshake.auth){
      //   //verify socket link
      //   console.log(socket.handshake.auth);
      //   next();
      // }
      // else {
      //   next(new Error("Authentication error"));
      // }    
      next();
    })
    .on('connection', (socket) => {
      if(socket.handshake.query.link_type === "client") {
        console.log('a user connected');
        //client link
        const userid = socket.handshake.query.userid;
        const publickey = socket.handshake.query.publicKey;
        const numPerPage = socket.handshake.query.numPerPage;
        this.deleteUserInRoom(userid);
        this.clientRoom[userid] = socket;
        console.log('a user added to clientRoom');
        console.log(this.clientRoom);
        //send client prev transaction
        console.log('send user history');
        socket.emit('transactionHistory', this.getUserHistory(userid, 0, numPerPage));
        //handle transaction
        socket.on('transaction', (transaction) => {//{sigObj, data}
          console.log(transaction);
          if(tools.validateSign(transaction.sigObj, transaction.data, publickey)) {
            const validState = tools.validateTransaction(transaction.data, userid, publickey);
            console.log(validState);
            if(!validState.state) return socket.emit('transactionState', {timestamp: transaction.data.timestamp, state: validState.error});
            const transactionData = {userid: userid, sign: transaction.sigObj, publickey: publickey, data: transaction.data, nonce: transaction.nonce | -1};
            const result = this.addTransaction(transactionData);
            if(!result.state) socket.emit('transactionState', {timestamp: transaction.data.timestamp, state: 'duplicatedNonce'});
            else {
              console.log({timestamp: transaction.data.timestamp, nonce: result.nonce, state: "checked"});
              socket.emit('transactionState', {timestamp: transaction.data.timestamp, nonce: result.nonce, state: "checked"});
              if(!this.miningState) this.mineData();
            }
          }
          else return socket.emit('transactionState', {timestamp: transaction.data.timestamp, state: "invalid"});
        });
        //client disconnect
        socket.on('disconnect', () => {
          console.log('a user disconnected');
          this.deleteUserInRoom(userid);
          socket.removeAllListeners();
        });
      }
      else {
        console.log('server connected');
      }
        socket.emit('hello', 'hello world');
    });
  }
  deleteUserInRoom(userid) {
    if(this.clientRoom[userid]) delete this.clientRoom[userid];
    return;
  }
  getUserHistory(userid, pageNum, numPerPage) {
    var userData = [];
    var lastIndex = null;
    for(var i = this.buffer.length - 1; i >= 0; i--) {
      if(this.buffer[i].userid === userid) {
        if(lastIndex === null) lastIndex = this.buffer[i].nonce;
        if(this.buffer[i].nonce <= lastIndex-pageNum*numPerPage) userData.push(this.buffer[i]);
      }
      if(userData.length === numPerPage) return userData;
    }
    console.log(userData);
    console.log('blockchain')
    for(var i = this.blockchain.length-1; i > 0; i--) {
      for(var j = this.blockchain[i].transactions.length - 1; j >= 0; j--) {
        if(this.blockchain[i].transactions[j].userid === userid) {
          if(lastIndex === null) lastIndex = this.blockchain[i].transactions[j].nonce;
          if(this.blockchain[i].transactions[j].nonce <= lastIndex-pageNum*numPerPage) userData.push({blockid: this.blockchain[i].id, nonce: this.blockchain[i].transactions[j].nonce, ...this.blockchain[i].transactions[j].data});
        }
        if(userData.length === numPerPage) return userData;
      }
    }
    console.log(userData);
    return userData;
  }
  addTransaction(transaction) {
    const userid = transaction.userid;
    var lastNonce = this.getLastNonce(userid);
    if(transaction.nonce == -1) transaction.nonce = lastNonce + 1;
    if(transaction.nonce <= lastNonce) return {state: false};
    for(const [index, each] of this.buffer.entries()) {
      if(userid === each.userid) {
        if (transaction.nonce < each.nonce) {
          this.buffer.splice(index, 0, transaction);
          return {state: true, nonce: transaction.nonce};
        }
        if (transaction.nonce === each.nonce) return {state: false};
      }
    }
    console.log('add transaction to buffer');
    this.buffer.push(transaction);
    return {state: true, nonce: transaction.nonce};
  }
  getLastNonce(userid) {
    const chainLength = this.blockchain.length;
    for (var i = chainLength - 1; i >= 0; i--) {
      var transactions = this.blockchain[i].transactions;
      var blockLength = transactions.length;
      for (var j = blockLength - 1; j >= 0; j--) {
        if(transactions[j].userid === userid) {
          var lastNonce = transactions[j].nonce;
          return lastNonce;
        }
      }
    }
    return 0;
  }
  async mineData() {
    if(this.buffer.length < config.transactionsForBlock) return;
    this.miningState = true;
    var transactionsForMining = [];
    for(var transaction of this.buffer) {
      if(!transaction.result) {
        var result = await this.checkWinOrLoss(transaction);
        console.log('win or loss');
        console.log(result);
        if(!result) continue;
        transaction.data.result = result;
      }
      var userid = transaction.userid;
      var lastNonce = this.getLastNonce(userid);
      if(transaction.nonce - lastNonce === 1) {
        transactionsForMining.push(transaction);
      }
      else {
        for(const each of transactionsForMining) {
          if(transaction.userid === each.userid && trnasaction.nonce - each.nonce === 1) transactionsForMining.push(transaction);
        }
      }
      if(transactionsForMining.length === config.transactionsForBlock) break;
    }
    if(transactionsForMining.length < config.transactionsForBlock) {
      this.miningState = false;
      return;
    }
    const newBlock = tools.createBlock(transactionsForMining, this.blockchain[this.blockchain.length - 1]);
    this.blockchain.push(newBlock);
    this.deleteVerifiedTransactionsFromBuffer(newBlock);
    console.log(this.blockchain);
    for(const each of newBlock.transactions) {
      if(this.clientRoom[each.userid]) this.clientRoom[each.userid].emit('transactionState', {nonce: each.nonce, state: each.data.result, blocknumber: newBlock.id});
    } 
    this.miningState = false;
    this.mineData();
  }
  deleteVerifiedTransactionsFromBuffer(newBlock) {
    var verifiedIndexes = [];
    for(var verifiedTransaction of newBlock.transactions) {
      for(var [index, transaction] of Object.entries(this.buffer)) {
        if(verifiedTransaction.userid === transaction.userid && verifiedTransaction.data.timestamp === transaction.data.timestamp) {
          verifiedIndexes.push(index);
          break;
        }
      }
    }
    verifiedIndexes.sort().reverse();
    for(var eachIndex of verifiedIndexes) {
      this.buffer.splice(eachIndex, 1);
    }
  }
  async checkWinOrLoss(transaction) {
    var type = 'AUDUSD';
    var timestamp = transaction.data.timestamp;
    if(timestamp > Date.now()/1000) return false;
    var startIndex = 0;
    if(!this.MADLedger[type] || !this.MADLedger[type].length) {
      var response = await tools.getMADLedger(type, timestamp-60, Date.now()/1000);
      if(this.MADLedger[type] && this.MADLedger[type].length) this.MADLedger[type].push(response.data);
      else this.MADLedger[type] = response.data;
    }
    else if(timestamp < this.MADLedger[type][0].t) {
      var response = await tools.getMADLedger(type, timestamp-60, this.MADLedger[type][0].t-1);
      this.MADLedger[type].unshift(response.data);
    }
    else {
      for(var i = this.MADLedger[type].length - 1; i >= 0; i++) {
        if(this.MADLedger[type][i].t < timestamp) startIndex = i+1;
      }
    }
    console.log(startIndex);
    console.log(this.MADLedger[type].length);
    for(var i = startIndex; i < this.MADLedger[type].length; i++) {
      if(transaction.data.action === "buy" && this.MADLedger[type][i].h >= transaction.data.tp && this.MADLedger[type][i].l > transaction.data.sl) return "win";
      if(transaction.data.action === "buy" && this.MADLedger[type][i].h < transaction.data.tp && this.MADLedger[type][i].l <= transaction.data.sl) return "loss";
      if(transaction.data.action === "sell" && this.MADLedger[type][i].h <= transaction.data.tp && this.MADLedger[type][i].l < transaction.data.sl) return "win";
      if(transaction.data.action === "sell" && this.MADLedger[type][i].h > transaction.data.tp && this.MADLedger[type][i].l >= transaction.data.sl) return "loss";
      if((transaction.data.action === "buy" && this.MADLedger[type][i].h < transaction.data.tp && this.MADLedger[type][i].l > transaction.data.sl) || (transaction.data.action === "sell" && this.MADLedger[type][i].h > transaction.data.tp && this.MADLedger[type][i].l < transaction.data.sl)) return "undefined";
    }
    return false;
  }
  getLastMADLedger() {
    tools.getLastMADLedger((lastIndexes) => {
      if(lastIndexes) {
        for(var each of lastIndexes) {
          if(!this.MADLedger[each.type] || !this.MADLedger[each.type].length) this.MADLedger[each.type] = [{t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v}];
          else if(this.MADLedger[each.type][this.MADLedger[each.type].length - 1].t < each.t) this.MADLedger[each.type].push({t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v});
        }
      }
      if(!this.miningState) this.mineData();
    });
    setInterval(() => {
      tools.getLastMADLedger((lastIndexes) => {
        if(lastIndexes) {
          for(var each of lastIndexes) {
            if(!this.MADLedger[each.type] || !this.MADLedger[each.type].length) {
              this.MADLedger[each.type] = [{t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v}];
            }
            else if(this.MADLedger[each.type][this.MADLedger[each.type].length - 1].t < each.t) this.MADLedger[each.type].push({t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v});
          }
        }
        if(!this.miningState) this.mineData();
      });
    }, 60000);
  }
}
