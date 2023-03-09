// const SHA256 = require('crypto-js/sha256');
const io_cli = require("socket.io-client");

const database = require('./database');
const tools = require('./tools');
const config = require('./config.json');
const axios = require('axios');
var fs = require('fs');
const { clear } = require("console");

module.exports = class MiningNode {
  constructor(io) {
    this.privKey;
    this.publicKey;
    this.nodeRoom = {};//{address:{socket,publicKey}}
    this.clientRoom = {};//{userid:socket}
    this.blockchain = [];//{id, prevhash, transactions, timestamp, hash}
    this.blockchainState = 'init';// 'processing', 'stop', 'ready', 'finish'
    this.sendBlockchainNode = {};//node socket variable that this node is sending blockchain to
    this.buffer = [];//received transactions {transaction: {userid, sign, publickey, transaction, result}, validate: {win, loss, undefined, unable, self:}};
    this.miningState = false;
    this.getNodes();
    this.MADLedger = {};
    this.getLastMADLedger();
    this.getBlockchain();
    this.blockchain_receive_timer;

  }
  //link to main server, get other nodes' address(for test, address+port), connect with them. If there isn't any node, create genesis block
  getNodes() {
    this.privKey = tools.createPrivKey();
    this.publicKey = tools.getPublicKey(this.privKey);
    const serverSocket = io_cli.connect(config.mainServer, {
      query: {
        "link_type":"miner",
        "port":config.port,//for test
        "publickey":this.publicKey
      }
    });
    console.log('connecting to bootstrapServer')
    serverSocket.on('connect', () => {
      console.log('bootstrapServer is connected');
      serverSocket.emit('allNodes');
    })
    serverSocket.on('disconnect', () => {
      console.log("bootstrapServer is disconnected.")
    })
    serverSocket.on('allNodes_response', (nodes) => {//addresses of nodes
      console.log(nodes);
      var isNodes = false;
      for(var each of nodes) {
        if(each == null) continue;
        if(each == 'http://localhost:'+config.port) continue;//for test
        isNodes = true;
        ((each) => {
          if(this.nodeRoom[each.address]) return;
          var eachSocket = io_cli.connect(each.address, {
            query: {
              "link_type":"miner",
              "port":config.port,//for test
              "publickey":this.publicKey
            }
          });
          eachSocket.on('connect', () => {
            console.log(JSON.stringify(each)+" is connected.");
            this.nodeRoom[each] = {socket: eachSocket, publicKey: each.publickey};
            this.setNodeSocketListener(eachSocket, each.address, each.publickey);
            eachSocket.on('disconnect', () => {
              console.log(each.address+" disconnected");
              delete this.nodeRoom[each.address];
              eachSocket.removeAllListeners();
            })
          })
        })(each)
      }
      if(isNodes == false && this.blockchain.length == 0) {
        this.createGenesisBlock();
        this.blockchainState = 'finish';
      }
    })
  }
  addMiner(socket) {
    const address = 'http://localhost:'+socket.handshake.query.port;//for test
    if(this.nodeRoom[address]) return;
    const publicKey = socket.handshake.query.publickey;
    this.nodeRoom[address] = {socket:socket, publicKey: publicKey};
    socket.on('disconnect', () => {
      console.log(address+" disconnected");
      delete this.nodeRoom[address];
      socket.removeAllListeners();
    })
    this.setNodeSocketListener(socket, address, publicKey);
  }
  setNodeSocketListener(socket, address, publicKey){
    socket.on('getLastBlockID', () => {//sender
      console.log('getLastBlockID request received');
      socket.emit('getLastBlockID_response', this.blockchain[this.blockchain.length - 1].id);
    });
    socket.on('getLastBlockID_response', (id) => {//receiver
      console.log('getLastBlockID response received');
      console.log('last blockID: '+ id);
      if(this.blockchainState != 'init') return;
      if(this.lastBlockIDArray) this.lastBlockIDArray.push({id: id, address: address});
      else this.lastBlockIDArray = [{id: id, address: address}];
    });
    socket.on('getBlockchain', (lastBlock) => {//sender send blockchain
      console.log('blockchain request received');
      this.sendBlockchainNode[address] = socket;
      if(lastBlock && lastBlock.id) {
        var checkBlock = this.blockchain[lastBlock.id - 1];
        var reason;
        if(lastBlock.id > 1 && checkBlock.prevhash != lastBlock.prevhash) reason = "prevhash";
        else if(checkBlock.hash != lastBlock.hash) reason = "hash";
        if(reason) {
          console.log('lastBlock error');
          console.log('reason: '+reason);
          socket.emit('lastBlock_error', reason);
          return;
        }
      }
      if(lastBlock && lastBlock.id) this.sendBlockchain(address, lastBlock.id);
      else this.sendBlockchain(address, 0);
    })
    socket.on('lastBlock_error', (reason) => {//receiver last block error
      console.log('lastBlock_error');
      console.log('reason: '+reason);
      if(reason == "prevhash") {
        if(this.blockchain.length > 50) this.blockchain.slice(0, this.blockchain.length - 50);
        else this.blockchain = [];
        socket.emit('getBlockchain', this.blockchain.length ? this.blockchain[this.blockchain.length - 1] : undefined);
      }
      if(reason == "hash") {
        this.blockchain.pop();
        socket.emit('getBlockchain', this.blockchain.length ? this.blockchain[this.blockchain.length - 1] : undefined);
      }
    })
    socket.on('getBlockchain_response', (data) => {//receiver
      console.log('receive blockchain');
      clearTimeout(this.blockchain_receive_timer);
      var blocks = data.blocks;
      for(var block of blocks) {
        if(block.id == 1) {
          this.blockchain.push(block);
          continue;
        }
        if(block.id == Number(this.blockchain[this.blockchain.length - 1].id) + 1 && block.prevhash == this.blockchain[this.blockchain.length - 1].hash) this.blockchain.push(block);
        else {
          if(block.id < Number(this.blockchain[this.blockchain.length - 1].id) + 1) continue;
          var reason;
          if(block.id != Number(this.blockchain[this.blockchain.length - 1].id) + 1) reason = "id";
          else if(block.prevhash != this.blockchain[this.blockchain.length - 1].hash) reason = "hash";
          console.log('received blockchain error: '+reason);
          socket.emit('getBlockchain_error', {id: this.blockchain.length, reason: reason});
          this.blockchainState = "stop";
          this.getBlockchain(this.blockchain[this.blockchain.length - 1]);
          return;
        }
      }
      var state = data.state;
      if(state == "end") {
        this.blockchainState = "ready";
        socket.emit('getBuffer');
      }
      else this.blockchain_receive_timer = setTimeout(() => {
        this.blockchainState = 'stop';
        this.getBlockchain(this.blockchain[this.blockchain.length - 1]);
      }, config.timegap_for_send_blocks * 3);
      console.log('receiving state: '+state);
      console.log('blockchain length: '+this.blockchain.length);
    })
    socket.on('getBlockchain_error', (data) => {//sender
      console.log('sended blockchain error: '+data.reason)
      delete this.sendBlockchainNode[address];
      if(this.blockchain[data.id].id == Number(data.id) + 1 && this.blockchain[data.id - 1].hash == this.blockchain[data.id].prevhash) return;
      else {
        this.sendBlockchainNode = {};
        this.blockchain.slice(0, data.id);
        this.blockchainState = 'stop';
        console.log('blockchainState: stop');
        console.log('getBlockchain');
        this.getBlockchain(this.blockchain[this.blockchain.length - 1]);
      }
    })
    socket.on('getBuffer', () => {
      socket.emit('getBuffer_response', this.buffer);
    })
    socket.on('getBuffer_response', (buffer) => {
      for(var eachBuffer of buffer) {
        var validate = eachBuffer.validate;
        if(validate.self) {
          var sign;
          for(var state of Object.keys(validate)) {
            if(validate[state].self) {
              sign = validate[state].self;
              delete validate[state].self;
              validate[state][address] = sign;
            }
          }
          validate.self = false;
        }
      }
      var rest = [];
      if(this.buffer) rest = this.buffer;
      this.buffer = buffer;
      if(rest.length) {
        for(var i = this.buffer.length - 1; i >= 0; i--) {
          for(var [index, each] of Object.entries(rest)) {
            if(this.buffer[i].transaction.userid == each.transaction.userid && this.buffer[i].transaction.transaction.nonce == each.transaction.transaction.nonce) {
              rest.splice(index, 1);
              break;
            }
            if(this.buffer[i].transaction.userid == each.transaction.userid && this.buffer[i].transaction.transaction.nonce < each.transaction.transaction.nonce) {
              this.buffer.splice(i+1, 0, each);
              rest.splice(index, 1);
              break;
            }
          }
          if(!rest.length) break;
        }
      }
      this.blockchainState = "finish";
    })
    socket.on('broadcastTransaction', (transactionData) => {
      console.log('broadcast transaction received');
      if(this.blockchainState != 'finish' || this.blockchainState != 'ready') {
        return this.sendEachTransactionValidating(transactionData, tools.getSign(this.privKey, {userid: transactionData.userid, nonce: transactionData.transaction.nonce, state:'unable'}), 'unable');
      }
      if(tools.validateSign(transactionData.sigObj, transactionData.transaction, transactionData.publickey)) {
        var lastNonce = this.getLastNonce(transactionData.userid);
        var lastNonceOfBlockchain = this.getLastNonceOfBlockchain(transactionData.userid);
        if(transactionData.transaction.nonce <= lastNonceOfBlockchain) return;
        if(transactionData.transaction.nonce > lastNonce) {
          console.log('transaction added');
          this.buffer.push({transaction:transactionData, validate: {win:[], loss:[], undefined:[], unable:[], self: false}});
          return;
        }
        for(const [index, each] of this.buffer.entries()) {
          if(userid === each.userid) {
            if (transactionData.transaction.nonce < each.transaction.transaction.nonce) {
              this.buffer.splice(index, 0, {transaction:transactionData, validate: {win:[], loss:[], undefined:[], unable:[], self: false}});
              console.log('transaction added');
              return;
            }
            if (transactionData.transaction.nonce === each.transaction.transaction.nonce) {
              console.log('nonce duplicated');
              return;
            }
          }
        }
      }
      else{
        console.log('sign incorrect');
      }
    })
    socket.on('eachTransactionValidating', (data) => {//node checks transaction with MAD and broadcast result
      console.log('each transaction validating received from '+address+' state:'+data.state);
      var userid = data.userid;
      var nonce = data.nonce;
      var state = data.state;
      var sign = data.sign;
      if(tools.validateSign(sign, {userid: userid, nonce: nonce, state:state}, publicKey)) {
        for(var each of this.buffer) {
          var transaction = each.transaction;
          if(transaction.userid == userid && transaction.transaction.nonce == nonce && !transaction.result) {
            for(var eachState in each.validate) {
              for(var index of Object.keys(eachState)) {
                if(index == address) return;
              }
            }
            each.validate[state][address] = sign;
            this.checkTransactionValid(each);
          }
        }
      }
    })
    socket.on('broadcastValidTransaction', (data) => {
      console.log('validated transaction received');
      if(this.blockchainState != 'finish') return;
      var userid = data.userid;
      var nonce = data.nonce;
      var state = data.state;
      var validate = data.validate;
      for(var eachAddress of Object.keys(validate[state])) {
        if(eachAddress == self) {
          eachAddress = address;
          validate[state][address] = validate[state].self;
          delete validate[state].self;
          validate.self = false;
        }
        var eachKey = this.nodeRoom[eachAddress].publicKey;
        if(!tools.validateSign(validate[state][eachAddress], {userid: userid, nonce: nonce, state: state}, eachKey)) return;
      }
      for(var eachAddress of Object.keys(validate.unable)) {
        var eachKey = this.nodeRoom[eachAddress].publicKey;
        if(!tools.validateSign(validate.unable[eachAddress], {userid: userid, nonce: nonce, state: 'unable'}, eachKey)) return;
      }
      if(Object.keys(validate[state]).length < (Object.keys(this.nodeRoom).length - Object.keys(validate.unable).length)/2) return;
      var inBuffer = false;
      for(var each of this.buffer) {
        if(each.transaction.userid == userid && each.transaction.transaction.nonce == nonce) {
          inBuffer = true;
          if(!each.transaction.result) each.transaction.result == state;
        }
      }
      if(!inBuffer) {
        var lastnonce = this.getLastNonce(userid);
        var lastnonceofblockchain = this.getLastNonceOfBlockchain(userid);
        if(nonce < lastnonce && nonce > lastnonceofblockchain) {
          console.log('askTransaction');
          socket.emit('askTransaction', {userid: userid, nonce: nonce});
          if(this.askTransaction && this.askTransaction.length && this.askTransaction.find(each => each.userid == userid && each.nonce == nonce)) return;

          if(this.askTransaction && this.askTransaction.length) this.askTransaction.push(data);
          else this.askTransaction = [data];
        }
      }
      else {
        console.log('check validated transaction successfully');
        this.mineTransactions();
      }
    })
    socket.on('askTransaction_response', (transaction) => {
      console.log('askTransaction_response received');
      if(!this.askTransaction || !this.askTransaction.length) return;
      var matchIndex = this.askTransaction.find(each => each.userid == transaction.userid && each.nonce == transaction.transaction.nonce);
      if(!matchIndex) return;
      var match = this.askTransaction[match];
      if(tools.validateSign(transaction.sigObj, transaction.transaction, transaction.publickey)) {
        transaction.transaction.result = match.state;
        var newEntry = {transaction: transaction, validate: this.askTransaction[transaction.id].validate};
        this.addTransactionToBuffer(newEntry);
        this.askTransaction.splice(matchIndex, 1);
        this.mineTransactions();
      }
    })
    socket.on('askTransaction', (data) => {
      console.log('askTransaction received');
      var userid = data.userid;
      var nonce = data.nonce;
      var lastnonce = this.getLastNonce(userid);
      var lastnonceofblockchain = this.getLastNonceOfBlockchain(userid);
      if(nonce > lastnonceofblockchain && nonce <= lastnonce) {
        for(var each of this.buffer) {
          if(each.transaction.userid == userid && each.transaction.transaction.nonce == nonce) {
            return socket.emit('askTransaction_response', each.transaction);
          }
        }
      }
      if(nonce <= lastnonceofblockchain) {
        for(var block of this.blockchain) {
          for(var transaction of block.transactions) {
            if(transaction.userid == userid && transaction.transaction.nonce == nonce) {
              return socket.emit('askTransaction_response', transaction);
            }
          }
        }
      }
    })
    socket.on('broadcastNewBlock', async (newBlock, stateCheck) => {//{id, prevhash, transactions, timestamp, hash}
      if(this.blockchainState != 'finish' || this.blockchainState != 'ready') return;
      var lastBlock = this.blockchain[this.blockchain.length-1];
      //check block id
      if(newBlock.id < lastBlock.id) return;
      else if(newBlock.id == lastBlock.id) {
        if(newBlock.timestamp >= lastBlock.timestamp) return;
        else {
          if(newBlock.timestamp <= this.blockchain[this.blockchain.length - 2]) return;
          else {
            if(newBlock.prevhash == lastBlock.prevhash) {
              if(this.checkState(newBlock, stateCheck)) this.blockchain[this.blockchain.length - 1] = newBlock;
            }
            else {
              if(this.checkState(newBlock, stateCheck)) {
                this.newBlock = newBlock;
                getBlock({id:this.blockchain.length - 1});//check prev block by timestamp and prevhash. if prevhash error, get blockchain again 
              }
            }
          }
        }
      }
      else {
        if(newBlock.id == lastBlock.id + 1) {
          if(newBlock.prevhash == lastBlock.hash) {
            var [state, reason] = this.checkState(1, newBlock, stateCheck);
            if(state) this.blockchain.push(newBlock);
            else {
              if(reason == '') {}
            }
          }
        }
      }
    })
  }
  createGenesisBlock() {
    console.log('create genesis Block');
    this.blockchain.push(tools.createGenesisBlock());
  }
  sendBlockchain(address, lastID) {
    if(!this.sendBlockchainNode[address]) return;//there is error
    var lastSendBlockID = lastID;
    var blocksForSend = this.blockchain.slice(lastSendBlockID, config.blocks_per_send);
    lastSendBlockID += config.blocks_per_send;
    var state = "continue";
    if(lastSendBlockID >= this.blockchain.length) state = "end";
    console.log('send blockchain state: '+state);
    this.sendBlockchainNode[address].emit('getBlockchain_response', {blocks: blocksForSend, state: state});
    if(state == "end") {
      delete this.sendBlockchainNode[address];
      return; 
    }
    setTimeout(() => {
      this.sendBlockchain(address, lastSendBlockID);
    }, config.timegap_for_send_blocks);
  }
  // If there are connected nodes, get lastBlockID using socket. After 1 second, get Blockchain from the longest blockchain node.
  getBlockchain(lastBlock = undefined) {
    if(this.blockchainState != 'init' || this.blockchainState != "stop") return;
    console.log(this.blockchainState);
    if(!Object.keys(this.nodeRoom).length) setTimeout(() => {
      this.getBlockchain(lastBlock);
    }, config.timegap_for_send_blocks * 3);
    for(var address of Object.keys(this.nodeRoom)) {
      var socket = this.nodeRoom[address].socket;
      socket.emit('getLastBlockID');
      setTimeout(() => {
        if(this.lastBlockIDArray && this.lastBlockIDArray.length) {
          this.blockchainState = 'processing';
          console.log(this.blockchainState);
          this.lastBlockIDArray.sort((a, b) => Number(b.id) - Number(a.id));
          this.lastBlockIDArray[0].socket.emit('getBlockchain', lastBlock);
          delete this.lastBlockIDArray;
          this.blockchain_receive_timer = setTimeout(() => {
            console.log('getBlockchain again');
            this.blockchainState = 'init';
            this.getBlockchain(lastBlock);
          }, config.timegap_for_send_blocks * 10);
        }
      }, 1000);
    }
  }
  checkState(index, newBlock, stateCheck) {
    for (var [index, each] of Object.entries(newBlock.transactions)) {
      var userid = newBlock.transactions[index].userid;
      var lastnonce = this.getLastNonceOfBlockchain(userid);
    }
  }
  getBlock(id) {
    
  }
  checkTransactionValid(eachBuffer) {
    var num_win = eachBuffer.validate.win.length;
    var num_loss = eachBuffer.validate.loss.length;
    var num_undefined = eachBuffer.validate.undefined.length;
    var num_unable = eachBuffer.validate.unable.length;
    if(num_win >= num_loss && num_win >= num_undefined && num_win >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('win')
      this.broadcastValidTransaction({transaction:eachBuffer.transaction, state: 'win', validate: eachBuffer.validate});
      eachBuffer.transaction.result = 'win';
      if(!this.miningState) this.mineTransactions();
    }
    if(num_loss >= num_win && num_loss >= num_undefined && num_loss >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('loss')
      this.broadcastValidTransaction({transaction:eachBuffer.transaction, state: 'loss', validate: eachBuffer.validate});
      eachBuffer.transaction.result = 'loss';
      if(!this.miningState) this.mineTransactions();
    }
    if(num_undefined >= num_win && num_undefined >= num_loss && num_undefined >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('undefined')
      this.broadcastValidTransaction({transaction:eachBuffer.transaction, state: 'undefined', validate: eachBuffer.validate});
      eachBuffer.transaction.result = 'undefined';
      if(!this.miningState) this.mineTransactions();
    }
  }
  broadcastValidTransaction(data) {
    var userid = data.transaction.userid;
    var nonce = data.transaction.transaction.nonce;
    var state = data.state;
    var validate = data.validate;
    for(var each in this.nodeRoom) {
      each.socket.emit('broadcastValidTransaction', {userid: userid, nonce: nonce, state: state, validate: validate});
    }
    if(this.clientRoom[userid]) this.clientRoom[userid].emit('transactionState', {nonce: nonce, state: state});
  }
  addUser(userid, socket) {
    this.clientRoom[userid] = socket;
    socket.emit('transactionHistory', this.getUserTransactionHistory(userid));//{returnData, ismore}
    this.setUserSocketListener(socket);
  }
  getUserTransactionHistory(userid, last_nonce = null) {
    var returnData = [];
    //get transactions from buffer
    for(var i = this.buffer.length - 1; i >= 0; i--) {
      if(this.buffer[i].transaction.userid === userid) {
        if(returnData.length == config.num_per_sendUserTransaction) return {returnData: returnData, ismore: true};
        if(last_nonce == null) last_nonce = this.buffer[i].transaction.transaction.nonce+1;
        if(last_nonce > this.buffer[i].transaction.transaction.nonce && this.buffer[i].transaction.transaction.nonce >= last_nonce - config.num_per_sendUserTransaction) returnData.push(this.buffer[i].transaction);
      }
    }
    //get transactions from blockchain
    for(var i = this.blockchain.length-1; i > 0; i--) {
      for(var j = this.blockchain[i].transactions.length - 1; j >= 0; j--) {
        if(this.blockchain[i].transactions[j].userid === userid) {
          if(returnData.length == config.num_per_sendUserTransaction) return {returnData: returnData, ismore: true};
          if(last_nonce == null) last_nonce = this.blockchain[i].transactions[j].transaction.nonce + 1;
          if(last_nonce > this.blockchain[i].transactions[j].transaction.nonce && this.blockchain[i].transactions[j].transaction.nonce >= last_nonce - config.num_per_sendUserTransaction) returnData.push({blockid: this.blockchain[i].id, ...this.blockchain[i].transactions[j]});
        }
      }
    }
    return {returnData: returnData, ismore: false};
  }
  broadcastTransaction(transaction) {
    for(var each in this.nodeRoom) {
      each.socket.emit('broadcastTransaction', transaction);
    }
  }
  getLastNonce(userid) {
    console.log('get last nonce');
    for(var i = this.buffer.length - 1; i >= 0; i--) {
      if(this.buffer[i].transaction.userid == userid) return this.buffer[i].transaction.transaction.nonce;
    }
    for (var i = this.blockchain.length - 1; i >= 0; i--) {
      var transactions = this.blockchain[i].transactions;
      for (var j = transactions.length - 1; j >= 0; j--) {
        if(transactions[j].userid == userid) return transactions[j].transaction.nonce;
      }
    }
    return 0;
  }
  getLastNonceOfBlockchain(userid) {
    console.log('get last nonce of blockchain');
    for (var i = this.blockchain.length - 1; i >= 0; i--) {
      var transactions = this.blockchain[i].transactions;
      for (var j = transactions.length - 1; j >= 0; j--) {
        if(transactions[j].userid == userid) return transactions[j].transaction.nonce;
      }
    }
    return 0;
  }
  setUserSocketListener(socket) {
    const userid = socket.handshake.query.userid;
    const publickey = socket.handshake.query.publicKey;
    socket.on('transaction', (transaction) => {//{sigObj, data}
      console.log('receive transaction from user: ' + userid);
      if(tools.validateSign(transaction.sigObj, transaction.data, publickey)) {
        const transactionData = {userid: userid, sign: transaction.sigObj, publickey: publickey, transaction: transaction.data};
        var newEntry = {transaction:transactionData, validate: {win:[], loss:[], undefined:[], unable:[], self: false}};
        var state = this.addTransactionToBuffer(userid, newEntry);
        socket.emit('transactionState', {nonce: newEntry.transaction.transaction.nonce, state: state});
        if(state == true) this.broadcastTransaction(transactionData);
        this.checkTransactionsInBuffer();
      }
      else {
        console.log('sign incorrect');
        return socket.emit('transactionState', {nonce: transaction.data.nonce, state: 'invalidSign'});
      }
    });
    //client disconnect
    socket.on('disconnect', () => {
      console.log('a user disconnected');
      delete this.clientRoom[userid];
      socket.removeAllListeners();
    });
  }
  addTransactionToBuffer(userid, newEntry) {
    var lastNonce = this.getLastNonce(userid);
    var lastNonceOfBlockchain = this.getLastNonceOfBlockchain(userid);
    //check trnasaction with blockchain
    if(newEntry.transaction.transaction.nonce <= lastNonceOfBlockchain) {
      console.log('nonce duplicated');
      return 'duplicatedNonce';
    }
    if(newEntry.transaction.transaction.nonce > lastNonce) {
      console.log('transaction added');
      this.buffer.push(newEntry);
      return true;
    }
    //check transaction with buffer
    for(const [index, each] of this.buffer.entries()) {
      if(userid === each.transaction.userid) {
        if (newEntry.transaction.transaction.nonce < each.transaction.transaction.nonce) {
          this.buffer.splice(index, 0, newEntry);
          console.log('transaction added');
          return true;
        }
        if (newEntry.transaction.transaction.nonce === each.transaction.transaction.nonce) {
          console.log('nonce duplicated');
          return 'duplicatedNonce';
        }
      }
    }
  }
  async mineTransactions() {
    if(this.buffer.length < config.transactionsForBlock || this.miningState) return;
    this.miningState = true;
    console.log('mining data');
    //get verified transactions from buffer
    var transactionsForMining = [];
    for(var eachBuffer of this.buffer) {
      if(eachBuffer.transaction.result) {
        var userid = eachBuffer.transaction.userid;
        var lastNonce = this.getLastNonceOfBlockchain(userid);
        if(eachBuffer.transaction.transaction.nonce - lastNonce == 1) {
          transactionsForMining.push(eachBuffer.transaction);
        }
        else {
          for(const each of transactionsForMining) {
            if(eachBuffer.transaction.userid == each.userid && eachBuffer.trnasaction.nonce - each.nonce == 1) transactionsForMining.push(eachBuffer.transaction);
          }
        }
      }
      if(transactionsForMining.length === config.transactionsForBlock) break;
    }
    if(transactionsForMining.length < config.transactionsForBlock) {
      this.miningState = false;
      return;
    }
    //create new block
    const newBlock = tools.createBlock(transactionsForMining, this.blockchain[this.blockchain.length - 1].hash, Number(this.blockchain[this.blockchain.length -1].id) + 1);
    this.broadcastNewBlock(newBlock);
    this.blockchain.push(newBlock);
    console.log('new block mined');
    console.log(this.blockchain[this.blockchain.length - 1]);
    //delete blocked transactions from buffer
    this.deleteVerifiedTransactionsFromBuffer(newBlock);
    //send changed state to user
    for(const each of newBlock.transactions) {
      if(this.clientRoom[each.userid]) this.clientRoom[each.userid].emit('transactionState', {nonce: each.nonce, blocknumber: newBlock.id});
    } 
    this.miningState = false;
    this.mineTransactions();
  }
  broadcastNewBlock(newBlock) {
    for(var each in this.nodeRoom) {
      each.socket.emit('broadcastNewBlock', newBlock);
    }
  }
  deleteVerifiedTransactionsFromBuffer(newBlock) {
    var verifiedIndexes = [];
    for(var [index, transaction] of Object.entries(this.buffer)) {
      for(var verifiedTransaction of newBlock.transactions) {
        if(verifiedTransaction.userid == transaction.transaction.userid && verifiedTransaction.transaction.nonce == transaction.transaction.transaction.nonce) {
          verifiedIndexes.push(index);
          break;
        }
      }
    }
    verifiedIndexes.sort().reverse();
    for(var eachIndex of verifiedIndexes) {
      this.buffer.splice(eachIndex, 1);
    }
    console.log('delete mined transactions: '+verifiedIndexes.length);
  }
  async checkWinOrLoss(eachBuffer) {
    var transaction = eachBuffer.transaction.transaction;
    var type = transaction.type;
    var timestamp = transaction.timestamp;
    //get MADLedger
    if(eachBuffer.transaction.result) return "checked";
    if(!this.MADLedger[type] || !this.MADLedger[type].length) {
      var response = await tools.getMADLedger(type, timestamp-60, Date.now()/1000);
      this.MADLedger[type] = response.data;
    }
    else if(timestamp < this.MADLedger[type][0].t) {
      var response = await tools.getMADLedger(type, timestamp-60, this.MADLedger[type][0].t-60);
      this.MADLedger[type].unshift(response.data);
    }
    //get start index
    var startIndex = 0;
    for(var i = this.MADLedger[type].length - 1; i >= 0; i--) {
      if(this.MADLedger[type][i].t < timestamp) startIndex = i+1;
    }
    //check win or loss
    //if "buy" tp > entry_price > sl, if "sell" sl > entry_price > tp
    for(var i = startIndex; i < this.MADLedger[type].length; i++) {
      if(transaction.action === "buy" && this.MADLedger[type][i].h >= transaction.tp && this.MADLedger[type][i].l > transaction.sl) {
        return "win";
      }
      if(transaction.action === "buy" && this.MADLedger[type][i].h < transaction.tp && this.MADLedger[type][i].l <= transaction.sl) return "loss";
      if(transaction.action === "sell" && this.MADLedger[type][i].h <= transaction.tp && this.MADLedger[type][i].l < transaction.sl) return "win";
      if(transaction.action === "sell" && this.MADLedger[type][i].h > transaction.tp && this.MADLedger[type][i].l >= transaction.sl) return "loss";
      if((transaction.action === "buy" && this.MADLedger[type][i].h >= transaction.tp && this.MADLedger[type][i].l <= transaction.sl) || (transaction.action === "sell" && this.MADLedger[type][i].h <= transaction.tp && this.MADLedger[type][i].l >= transaction.sl)) {
        return "undefined";
      }
    }
    return false;
  }
  getLastMADLedger() {
    console.log('get recent MADLedger');
    tools.getLastMADLedger((lastIndexes) => {
      if(lastIndexes) {
        for(var each of lastIndexes) {
          if(!this.MADLedger[each.type] || !this.MADLedger[each.type].length) this.MADLedger[each.type] = [{t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v}];
          else if(this.MADLedger[each.type][this.MADLedger[each.type].length - 1].t < each.t) this.MADLedger[each.type].push({t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v});
        }
      }
      if(this.buffer.length) this.checkTransactionsInBuffer();
    });
    setTimeout(() => {
      this.getLastMADLedger();
    }, config.getMADLedger_time);
  }
  async checkTransactionsInBuffer() {
    for(var each of this.buffer) {
      if(!each.validate.self && !each.transaction.result) {
        var result = await this.checkWinOrLoss(each);
        if(result == "win" || result == "loss" || result == "undefined") {
          console.log("self checked: "+result);
          const sign = tools.getSign(this.privKey, {userid: each.transaction.userid, nonce: each.transaction.transaction.nonce, state: result});
          this.sendEachTransactionValidating(each.transaction, sign, result);
          each.validate.self = "checked";
          each.validate[result] = [{self:sign}];
          this.checkTransactionValid(each);
        }
      }
    }
  }
  sendEachTransactionValidating(transactionData, sign, state) {
    console.log('broadcast transaction state:'+state);
    var userid = transactionData.userid;
    var nonce = transactionData.transaction.nonce;
    for(var each in this.nodeRoom) {
      each.socket.emit('eachTransactionValidating', {userid:userid, nonce:nonce, state:state, sign: sign});
    }
  }
}
