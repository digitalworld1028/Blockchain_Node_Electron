// const SHA256 = require('crypto-js/sha256');
const io_cli = require("socket.io-client");
const tools = require('./tools');
const config = require('./config.json');
var fs = require('fs');
const { Worker } = require('worker_threads');
var worker = new Worker('./worker.js');
var madWorker;

module.exports = class MiningNode {
  constructor(port) {
    this.port = port;
    this.address = 'http://localhost:'+port;
    this.privKey;
    this.publicKey;
    this.nodeRoom = {};//{address:{socket,publicKey}}
    this.clientRoom = {};//{publickey:socket}
    this.blockchain = [];//{id, prevhash, nonce, transactions, timestamp, hash}
    this.blockchainState = 'init';// 'processing', 'stop', 'ready', 'finish'
    this.sendBlockchainNode = {};//node socket variable that this node is sending blockchain to
    this.buffer = [];//received transactions {transaction: {sign, publickey, content, result}, validate: {address:{sign,state(win, loss, undefined, unable)}};
    this.miningState = false;
    this.getNodes();
    this.blockchain_receive_timer;
    this.blocksBuffer = [];
    //get MADLedger
    this.MADLedger = {};
    setInterval(() => {
      this.getLastMADLedger();
    }, config.getMADLedger_time);
    this.gettingMADLedgerState = false;
    this.gettingMADLedgerBuffer = [];
  }
  //link to main server, get other nodes' address(for test, address+port), connect with them. If there isn't any node, create genesis block
  getNodes() {
    this.privKey = tools.createPrivKey();
    this.publicKey = tools.getPublicKey(this.privKey);
    const serverSocket = io_cli.connect(config.mainServer, {
      query: {
        "link_type":"miner",
        "port":this.port,//for test
        "publickey":this.publicKey
      }
    });
    serverSocket.on('connect', () => {
      console.log('bootstrapServer is connected');
      serverSocket.emit('allNodes');
    })
    serverSocket.on('disconnect', () => {
      console.log("bootstrapServer is disconnected.")
    })
    serverSocket.on('allNodes_response', (nodes) => {//addresses of nodes
      var isNodes = false;
      for(var each of nodes) {
        if(each == null || each == this.address) continue;
        isNodes = true;
        ((each) => {
          if(this.nodeRoom[each.address]) return;
          var eachSocket = io_cli.connect(each.address, {
            query: {
              "link_type":"miner",
              "port":this.port,//for test
              "publickey":this.publicKey
            }
          });
          eachSocket.on('connect', () => {
            console.log(each.address+" is connected.");
            this.nodeRoom[each.address] = {socket: eachSocket, publicKey: each.publickey};
            this.setNodeSocketListener(eachSocket, each.address, each.publickey);
            eachSocket.on('disconnect', () => {
              console.log(each.address+" disconnected");
              delete this.nodeRoom[each.address];
              delete this.sendBlockchainNode[each.address];
              eachSocket.removeAllListeners();
            })
          })
        })(each)
      }
      if(isNodes == false && this.blockchain.length == 0) {
        this.createGenesisBlock();
      }
      else {
        this.getBlockchain();
      }
      console.log('blockchainState:'+this.blockchainState);
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
      delete this.sendBlockchainNode[address];
      socket.removeAllListeners();
    })
    this.setNodeSocketListener(socket, address, publicKey);
  }
  setNodeSocketListener(socket, address, publicKey) {
    socket.on('getLastBlockID', () => {
      console.log('getLastBlockID request received');
      if(this.blockchain.length) socket.emit('getLastBlockID_response', this.blockchain[this.blockchain.length - 1].id);
    });
    socket.on('getLastBlockID_response', (id) => {
      console.log('getLastBlockID response received');
      console.log('last blockID: '+ id);
      if(this.blockchainState != 'init') return;
      if(this.lastBlockIDArray && this.lastBlockIDArray.length) this.lastBlockIDArray.push({id: id, socket: socket});
      else this.lastBlockIDArray = [{id: id, socket: socket}];
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
          console.log('lastBlock error reason: '+reason);
          socket.emit('lastBlock_error', reason);
          return;
        }
        this.sendBlockchain(address, lastBlock.id); 
      }
      else this.sendBlockchain(address, 0);
    })
    socket.on('lastBlock_error', (reason) => {
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
    socket.on('getBlockchain_response', (data) => {
      console.log('receive blockchain');
      clearTimeout(this.blockchain_receive_timer);
      var blocks = data.blocks;
      for(var block of blocks) {
        if(block.id == 1 && !this.blockchain.length) {
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
        socket.emit('getBuffer', this.blockchain.length);
      }
      else this.blockchain_receive_timer = setTimeout(() => {
        this.blockchainState = 'stop';
        this.getBlockchain(this.blockchain[this.blockchain.length - 1]);
      }, config.timegap_for_send_blocks * 3);
      console.log('receiving state: '+state);
      console.log('blockchain length: '+this.blockchain.length);
    })
    socket.on('getBlockchain_error', (data) => {
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
    socket.on('getBuffer', (lastBlockid) => {
      if(lastBlockid == this.blockchain.length) socket.emit('getBuffer_response', {buffer: this.buffer});
      else socket.emit('getBuffer_response', {blocks: this.blockchain.slice(lastBlockid), buffer: this.buffer});
    })
    socket.on('getBuffer_response', (data) => {
      //check validate self
      for(var eachBuffer of data.buffer) {
        var validate = eachBuffer.validate;
        if(validate.self) {
          var sign = validate.self.sign;
          var state = validate.self.state;
          delete validate.self;
          validate[address].sign = sign;
          validate[address].state = state;
        }
      }
      
      var rest = [];
      if(this.buffer) rest = this.buffer;
      this.buffer = data.buffer;
      if(rest.length) {
        for(var each of rest) {
          var state = false;
          for(var i = this.buffer.length - 1; i >= 0; i--) {
            if(this.buffer[i].transaction.publickey == each.transaction.publickey && this.buffer[i].transaction.content.nonce == each.transaction.content.nonce) {
              state = true;
              break;
            }
            if(this.buffer[i].transaction.publickey == each.transaction.publickey && this.buffer[i].transaction.content.nonce < each.transaction.content.nonce) {
              this.buffer.splice(i+1, 0, each);
              state = true;
              break;
            }
          }
          if(!state) this.buffer.unshift(each);
        }
      }
      if(data.blocks) {
        for(var eachBlock of data.blocks) {
          this.handleNewBlock(eachBlock);
        }
      }
      this.blockchainState = "finish";
    })
    socket.on('broadcastTransaction', (transaction) => {
      console.log('broadcast transaction received');
      if(!tools.validateSign(transaction.sign, transaction.content, transaction.publickey)) return console.log('sign incorrect');
      if(this.blockchainState != 'finish' && this.blockchainState != 'ready') {
        return this.sendEachTransactionValidating(transaction, tools.getSign(this.privKey, {publickey: transaction.publickey, nonce: transaction.content.nonce, state:'unable'}), 'unable');
      }
      else {
        var newEntry = {transaction:transaction, validate: {}};
        if(this.checkTransactionNonce(transaction)) {
          this.addTransactionToBuffer(newEntry);
          this.getMADLedger(transaction.content.type, transaction.content.timestamp);
        }
      }
    })
    socket.on('eachTransactionValidating', (data) => {//node checks transaction with MAD and broadcast result
      console.log('each transaction validating received from '+address+' state:'+data.state);
      var publickey = data.publickey;
      var nonce = data.nonce;
      var state = data.state;
      var sign = data.sign;
      if(tools.validateSign(sign, {publickey: publickey, nonce: nonce, state:state}, publicKey)) {
        for(var each of this.buffer) {
          var transaction = each.transaction;
          if(transaction.publickey == publickey && transaction.content.nonce == nonce && !transaction.result) {
            each.validate[address] = {sign:sign, state:state};
            console.log('transaction validate added');
            if(this.checkTransactionValid(each)) {
              this.broadcastValidTransaction(each);
              if(this.clientRoom[publickey]) this.clientRoom[publickey].emit('transactionState', {nonce: nonce, state: state});
              if(!this.miningState) this.mineTransactions();
            }
          }
        }
      }
    })
    socket.on('broadcastValidTransaction', (eachBuffer) => {
      console.log('validated transaction received');
      if(!this.blockchainState == 'finish' || !this.blockchainState == 'ready') return;
      var publickey = eachBuffer.transaction.publickey;
      var nonce = eachBuffer.transaction.content.nonce;
      var result = eachBuffer.transaction.result;
      var validate = eachBuffer.validate;
      var num_state = 0;
      var num_unable = 0;
      var lastnonceofblockchain = this.getLastNonceOfBlockchain(publickey);
      if(nonce <= lastnonceofblockchain) {
        console.log('aleady blocked transaction');
        return;
      }
      for(var eachAddress in validate) {
        if(eachAddress == 'self') {
          eachAddress = address;
          validate[address] = validate.self;
          delete validate.self;
        } 
        // if(eachAddress == this.address) var eachKey = this.publicKey;
        // else if(this.nodeRoom[eachAddress] && this.nodeRoom[eachAddress].publicKey) var eachKey = this.nodeRoom[eachAddress].publicKey;
        // else {
        //   console.log(this.nodeRoom);
        //   continue;
        // }
        // if(!tools.validateSign(validate[eachAddress].sign, {publickey: pubickey, nonce: nonce, state: state}, eachKey)) continue;
        if(validate[eachAddress].state == result) num_state++;
        if(validate[eachAddress].state == 'unable') num_unable++;
      }
      for(var [index, each] of Object.entries(this.buffer)) {
        if(each.transaction.publickey == publickey && each.transaction.content.nonce == nonce) {
          if(!each.transaction.result && num_state >= (Object.keys(this.nodeRoom).length - num_unable)/2) each.transaction.result = result;
          break;
        }
        if(each.transaction.publickey == publickey && each.transaction.content.nonce > nonce) {
          if(tools.validateSign(each.transaction.sign, each.transaction.content, each.transaction.publickey)) this.buffer.splice(index, 0, eachBuffer);
          break;
        }
      }
      this.mineTransactions();
    })
    // socket.on('askTransaction_response', (transaction) => {
    //   console.log('askTransaction_response received');
    //   if(!this.askTransaction || !this.askTransaction.length) return;
    //   var matchIndex = this.askTransaction.find(each => each.userid == transaction.userid && each.nonce == transaction.transaction.nonce);
    //   if(!matchIndex) return;
    //   var match = this.askTransaction[match];
    //   if(tools.validateSign(transaction.sigObj, transaction.transaction, transaction.publickey)) {
    //     transaction.transaction.result = match.state;
    //     var newEntry = {transaction: transaction, validate: this.askTransaction[transaction.id].validate};
    //     this.addTransactionToBuffer(newEntry);
    //     this.askTransaction.splice(matchIndex, 1);
    //     this.mineTransactions();
    //   }
    // })
    // socket.on('askTransaction', (data) => {
    //   console.log('askTransaction received');
    //   var userid = data.userid;
    //   var nonce = data.nonce;
    //   var lastnonce = this.getLastNonce(userid);
    //   var lastnonceofblockchain = this.getLastNonceOfBlockchain(userid);
    //   if(nonce > lastnonceofblockchain && nonce <= lastnonce) {
    //     for(var each of this.buffer) {
    //       if(each.transaction.userid == userid && each.transaction.transaction.nonce == nonce) {
    //         return socket.emit('askTransaction_response', each.transaction);
    //       }
    //     }
    //   }
    //   if(nonce <= lastnonceofblockchain) {
    //     for(var block of this.blockchain) {
    //       for(var transaction of block.transactions) {
    //         if(transaction.userid == userid && transaction.transaction.nonce == nonce) {
    //           return socket.emit('askTransaction_response', transaction);
    //         }
    //       }
    //     }
    //   }
    // })
    socket.on('broadcastNewBlock', async (newBlock) => {//{id, prevhash, transactions, timestamp, hash}
      if(newBlock.timestamp < Date.now() / 1000 - 5) return;
      if(this.blockchainState != 'finish' && this.blockchainState != 'ready') return;
      this.handleNewBlock(newBlock);
    })
  }
  handleNewBlock(newBlock) {
    for(var eachTrans of newBlock.transactions) {
      if(!tools.validateSign(eachTrans.sign, eachTrans.content, eachTrans.publickey)) return;
    }
    if(this.blockchainState == 'ready') {
      this.blocksBuffer.push(newBlock);
      return;
    }
    var lastBlock = this.blockchain[this.blockchain.length-1];
    //check block id
    console.log('broadcastblock received');
    if(newBlock.id < lastBlock.id) return;
    else if(newBlock.id == lastBlock.id) {
      console.log('blockid duplicated');
      if(newBlock.timestamp >= lastBlock.timestamp) return;
      else {
        console.log('prev timestamp detected');
        if(newBlock.timestamp <= this.blockchain[this.blockchain.length - 2].timestamp) return;
        else {
          if(newBlock.prevhash == lastBlock.prevhash) {
            console.log('prevhash is coincided');
            var check = this.checkBlockTransactionValid(1, newBlock);//check nonce, valid, multicheck
            if(check.state == true) {
              console.log('last block changed');
              this.buffer = lastBlock.transactions.concat(this.buffer);
              this.blockchain[this.blockchain.length - 1] = newBlock;
              for(const each of newBlock.transactions) {
                if(this.clientRoom[each.publickey]) this.clientRoom[each.publickey].emit('transactionState', {nonce: each.content.nonce, state: each.result, blocknumber: newBlock.id});
              }
              this.deleteVerifiedTransactionsFromBuffer(newBlock);
            }
            else if(check.state == false && check.multiCheck == true) {
              console.log('add new block to buffer');
              this.blocksBuffer.push(newBlock);
            }
            else {
              console.log('new block canceled');
            }
          }
          else {
            console.log('prevhash is different');
            // if(this.checkState(0, newBlock)) {
            //   this.newBlock = newBlock;
            //   getBlock({id:this.blockchain.length - 1});//check prev block by timestamp and prevhash. if prevhash error, get blockchain again 
            // }
          }
        }
      }
    }
    else {
      if(newBlock.id == lastBlock.id + 1) {
        console.log('receive next block id');
        if(newBlock.prevhash == lastBlock.hash) {
          console.log('prevhash is right');
          var check = this.checkBlockTransactionValid(0, newBlock);
          if(check.state == true) {
            if(this.miningState) {
              worker.terminate();
              worker = new Worker('./worker.js');
              console.log('stop mining');
              this.miningState = false;
            }
            console.log('add new block');
            this.blockchain.push(newBlock);
            for(const each of newBlock.transactions) {
              if(this.clientRoom[each.publickey]) this.clientRoom[each.publickey].emit('transactionState', {nonce: each.content.nonce, state: each.result, blocknumber: newBlock.id});
            }
            this.deleteVerifiedTransactionsFromBuffer(newBlock);
          }
          else if(check.state == false && check.multiCheck == true) {
            console.log('add new block to buffer');
            this.blocksBuffer.push(newBlock);
          }
          else {
            console.log('new block canceled');
          }
        }
        else {
          console.log('prevhash is different');
          //
        }
      }
      else {
        console.log('block id is 2+')
        //
      }
    }
  }
  checkBlockTransactionValid(offset, newBlock) {
    //check nonce
    for(var eachTran of newBlock.transactions) {
      var lastnonce = this.getLastNonceOfBlockchain(eachTran.publickey, offset);
      if(eachTran.content.nonce <= lastnonce) return {state: false, reason: 'nonce-'};
      if(eachTran.content.nonce > lastnonce + 1) {
        var checknonce = false;
        for(var eachTranagain of newBlock.transactions) {
          if(eachTran.content.nonce == eachTranagain.content.nonce + 1) {
            checknonce = true;
            break;
          }
        }
        if(checknonce == false) return {state: false, reason: 'nonce+'};
      }
    }
    //check valid
    for(var eachTran of newBlock.transactions) {
      var check = false;
      for(var eachBuffer of this.buffer) {
        if(eachTran.publickey == eachBuffer.transaction.publickey && eachTran.content.nonce == eachBuffer.transaction.content.nonce) {
          check = true;
          if(eachBuffer.transaction.result){
            if(eachTran.result != eachBuffer.transaction.result) return {state: false, reason: 'result!'};
            // else this.checkagain()
          }
        }
      }
      if(check == false && offset == 1) {
        var oldBlock = this.blockchain[this.blockchain.length - 1];
        for(var eachTranold of oldBlock) {
          if(eachTran.publickey == eachTranold.publickey && eachTran.content.nonce == eachTranold.content.nonce) {
            check = true;
            if(eachTran.result != eachTranold.result) return {state: false, reason: 'result!'};
          }
        }
      }
    }
    return {state: true};
  }
  createGenesisBlock() {
    if(this.blockchain.length) return;
    console.log('create genesis Block');
    this.blockchain.push(tools.createGenesisBlock());
    this.blockchainState = 'finish';
  }
  sendBlockchain(address, lastID) {
    if(!this.sendBlockchainNode[address]) return;
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
    console.log('getBlockchain');
    if(this.blockchainState != 'init' && this.blockchainState != "stop") return;
    console.log(this.blockchainState);
    for(var address of Object.keys(this.nodeRoom)) {
      var socket = this.nodeRoom[address].socket;
      socket.emit('getLastBlockID');
    }
    setTimeout(() => {
      if(this.lastBlockIDArray && this.lastBlockIDArray.length) {
        this.blockchainState = 'processing';
        console.log(this.blockchainState);
        this.lastBlockIDArray.sort((a, b) => Number(b.id) - Number(a.id));
        console.log('last block: ' + this.lastBlockIDArray[0].id)
        this.lastBlockIDArray[0].socket.emit('getBlockchain', lastBlock);
        delete this.lastBlockIDArray;
        this.blockchain_receive_timer = setTimeout(() => {
          console.log('getBlockchain again');
          this.blockchainState = 'stop';
          this.getBlockchain(lastBlock);
        }, config.timegap_for_send_blocks * 10);
      }
      else {
        this.getBlockchain(lastBlock);
      }
    }, 1000);
  }
  // checkState(id_difference, newBlock, prevhash_state) {
  //   if(id_difference == 0) {
  //     if(prevhash_state) {
  //       //check nonce of newBlock
  //       for(var each of newBlock.transactions) {
  //         var available_nonce;
  //         for(var eachtransaction of this.blockchain[this.blockchain.length - 1].transactions) {
  //           if(eachtransaction.userid == each.userid) {
  //             available_nonce = eachtransaction.transaction.nonce;
  //             break;
  //           }
  //         }
  //         if(!available_nonce) {
  //           available_nonce = this.getLastNonceOfBlockchain(each.userid) + 1;
  //         }
  //         if(each.transaction.nonce > available_nonce) {
  //           var isavailable = false;
  //           for(var eachtrans of newBlock.transactions) {
  //             if(eachtrans.userid == each.userid && each.transaction.nonce == eachtrans.transaction.nonce+1) {
  //               isavailable = true;
  //               break;
  //             }
  //           }
  //           if(!isavailable) return false;
  //         }
  //       }
  //       //check content
  //       for(var each of newBlock.transactions) {
  //         var isInBuffer = false;
  //         for(var eachbuffer of this.buffer) {
  //           if(each.userid == eachbuffer.transaction.userid && each.transaction.nonce == eachbuffer.transaction.transaction.nonce) {
  //             isInBuffer = true;
  //             if(eachbuffer.transaction.result && tools.getHash(each) == tools.getHash(eachbuffer.transaction))break;
  //             else {
  //               this.checkNewBlockByAnotherNodes(newBlock);
  //               return false;
  //             }
  //           }
  //         }
  //         if(isInBuffer) continue;
  //         var isInBlock = false;
  //         for(var eachTransaction of this.blockchain[this.blockchain.length - 1].transactions) {
  //           if(each.userid == eachTransaction.userid && each.transaction.nonce == eachTransaction.transaction.nonce) {
  //             isInBlock = true;
  //             if(tools.getHash(each) == tools.getHash(eachTransaction)) break;
  //             else {
  //               this.checkNewBlockByAnotherNodes(newBlock);
  //               return false;
  //             }
  //           }
  //         }
  //         if(isInBlock) continue;
  //         this.checkNewBlockByAnotherNodes(newBlock);
  //       }
  //       return true;
  //     }
  //     else {
        
  //     }
  //   }
  //   else if(id_difference == 1) {
  //     if(prevhash_state) {
  //       //check nonce of newBlock
  //       for(var each of newBlock.transactions) {
  //         var available_nonce = this.getLastNonceOfBlockchain(each.userid) + 1;
  //         if(each.transaction.nonce > available_nonce) {
  //           var isavailable = false;
  //           for(var eachtrans of newBlock.transactions) {
  //             if(eachtrans.userid == each.userid && each.transaction.nonce == eachtrans.transaction.nonce+1) {
  //               isavailable = true;
  //               break;
  //             }
  //           }
  //           if(!isavailable) return false;
  //         }
  //       }
  //       //check content
  //       for(var each of newBlock.transactions) {
  //         var isInBuffer = false;
  //         for(var eachbuffer of this.buffer) {
  //           if(each.userid == eachbuffer.transaction.userid && each.transaction.nonce == eachbuffer.transaction.transaction.nonce) {
  //             isInBuffer = true;
  //             if(eachbuffer.transaction.result && tools.getHash(each) == tools.getHash(eachbuffer.transaction))break;
  //             else {
  //               this.checkNewBlockByAnotherNodes(newBlock);
  //               return false;
  //             }
  //           }
  //         }
  //         if(isInBuffer) continue;
  //         else {
  //           this.checkNewBlockByAnotherNodes(newBlock);
  //           return;
  //         }
  //       }
  //     }
  //     else {

  //     }
  //   }
  //   else if(id_difference > 1) {

  //   }
  // }
  checkTransactionValid(eachBuffer) {
    var num_win = 0;
    var num_loss = 0;
    var num_undefined = 0;
    var num_unable = 0;
    for(var each in eachBuffer.validate) {
      if(eachBuffer.validate[each].state == 'win') num_win++;
      if(eachBuffer.validate[each].state == 'loss') num_loss++;
      if(eachBuffer.validate[each].state == 'undefined') num_undefined++;
      if(eachBuffer.validate[each].state == 'unable') num_unable++;
    }
    if(num_win >= num_loss && num_win >= num_undefined && num_win >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('win');
      eachBuffer.transaction.result = 'win';
      return true;
    }
    if(num_loss >= num_win && num_loss >= num_undefined && num_loss >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('loss')
      eachBuffer.transaction.result = 'loss';
      return true;
    }
    if(num_undefined >= num_win && num_undefined >= num_loss && num_undefined >= Math.ceil((Object.keys(this.nodeRoom).length+1 - num_unable)/2)) {
      console.log('undefined')
      eachBuffer.transaction.result = 'undefined';
      return true;
    }
    return false;
  }
  broadcastValidTransaction(eachBuffer) {
    console.log('broadcast valid transaction');
    for(var each in this.nodeRoom) {
      this.nodeRoom[each].socket.emit('broadcastValidTransaction', eachBuffer);
    }
  }
  addUser(socket) {
    var publickey = socket.handshake.query.publicKey;
    this.clientRoom[publickey] = socket;
    socket.emit('transactionHistory', this.getUserTransactionHistory(publickey));//{returnData, ismore}
    this.setUserSocketListener(socket);
  }
  getUserTransactionHistory(publickey, last_nonce = null, numPerPage = config.num_per_sendUserTransaction) {
    var returnData = [];
    //get transactions from buffer
    for(var i = this.buffer.length - 1; i >= 0; i--) {
      if(this.buffer[i].transaction.publickey == publickey) {
        if(returnData.length == numPerPage) return {returnData: returnData, ismore: true};
        if(last_nonce == null) last_nonce = this.buffer[i].transaction.content.nonce+1;
        if(last_nonce > this.buffer[i].transaction.content.nonce && this.buffer[i].transaction.content.nonce >= last_nonce - numPerPage) returnData.push(this.buffer[i].transaction);
      }
    }
    //get transactions from blockchain
    for(var i = this.blockchain.length-1; i > 0; i--) {
      for(var j = this.blockchain[i].transactions.length - 1; j >= 0; j--) {
        if(this.blockchain[i].transactions[j].publickey == publickey) {
          if(returnData.length == numPerPage) return {returnData: returnData, ismore: true};
          if(last_nonce == null) last_nonce = this.blockchain[i].transactions[j].content.nonce + 1;
          if(last_nonce > this.blockchain[i].transactions[j].content.nonce && this.blockchain[i].transactions[j].content.nonce >= last_nonce - numPerPage) returnData.push({blockid: this.blockchain[i].id, ...this.blockchain[i].transactions[j]});
        }
      }
    }
    return {returnData: returnData, ismore: false};
  }
  broadcastTransaction(transaction) {
    for(var each in this.nodeRoom) {
      this.nodeRoom[each].socket.emit('broadcastTransaction', transaction);
    }
  }
  getLastNonce(publickey) {
    console.log('get last nonce');
    for(var i = this.buffer.length - 1; i >= 0; i--) {
      if(this.buffer[i].transaction.publickey == publickey) return this.buffer[i].transaction.content.nonce;
    }
    for (var i = this.blockchain.length - 1; i >= 0; i--) {
      var transactions = this.blockchain[i].transactions;
      for (var j = transactions.length - 1; j >= 0; j--) {
        if(transactions[j].publickey == publickey) return transactions[j].content.nonce;
      }
    }
    return 0;
  }
  getLastNonceOfBlockchain(publickey, depth = 0) {
    console.log('get last nonce of blockchain');
    for (var i = this.blockchain.length - 1 - depth; i >= 0; i--) {
      var transactions = this.blockchain[i].transactions;
      for (var j = transactions.length - 1; j >= 0; j--) {
        if(transactions[j].publickey == publickey) return transactions[j].content.nonce;
      }
    }
    return 0;
  }
  setUserSocketListener(socket) {
    const publickey = socket.handshake.query.publicKey;
    socket.on('transaction', (transaction) => {//{publickey, sign, content}
      console.log('receive transaction from user: ' + publickey);
      console.log(transaction);
      if(tools.validateSign(transaction.sign, transaction.content, transaction.publickey)) {
        var newEntry = {transaction:transaction, validate: {}};
        if(this.checkTransactionNonce(transaction)) {
          this.addTransactionToBuffer(newEntry);
          socket.emit('transactionState', {nonce: newEntry.transaction.content.nonce, state: 'pending'});
          this.broadcastTransaction(transaction);
          this.getMADLedger(transaction.content.type, transaction.content.timestamp);
        }
        else {
          socket.emit('transactionState', {nonce: newEntry.transaction.content.nonce, state: 'duplicatedNonce'});
        }
      }
      else {
        console.log('sign incorrect');
        return socket.emit('transactionState', {nonce: transaction.content.nonce, state: 'invalidSign'});
      }
    });
    //client disconnect
    socket.on('disconnect', () => {
      console.log('a user disconnected');
      delete this.clientRoom[publickey];
      socket.removeAllListeners();
    });
  }
  checkTransactionNonce(transaction) {
    const publickey = transaction.publickey;
    const nonce = transaction.content.nonce;
    var lastNonce = this.getLastNonce(publickey);
    var lastNonceOfBlockchain = this.getLastNonceOfBlockchain(publickey);
    //check trnasaction with blockchain
    if(nonce <= lastNonceOfBlockchain) {
      console.log('nonce duplicated');
      return false;
    }
    if(nonce > lastNonce) {
      console.log('nonce available');
      return true;
    }
    for(const [index, each] of this.buffer.entries()) {
      if(publickey === each.transaction.publickey) {
        if (nonce < each.transaction.content.nonce) {
          console.log('nonce available');
          return true;
        }
        if (nonce === each.transaction.content.nonce) {
          console.log('nonce duplicated');
          return false;
        }
      }
    }
  }
  addTransactionToBuffer(newEntry) {
    var lastNonce = this.getLastNonce(newEntry.transaction.publickey);
    if(newEntry.transaction.content.nonce > lastNonce) {
      console.log('transaction added');
      this.buffer.push(newEntry);
    }
    for(const [index, each] of this.buffer.entries()) {
      if(newEntry.transaction.publickey === each.transaction.publickey) {
        if (newEntry.transaction.content.nonce < each.transaction.content.nonce) {
          this.buffer.splice(index, 0, newEntry);
          console.log('transaction added');
          break;
        }
      }
    }
  }
  getMADLedger(type, timestamp) {
    if(!this.MADLedger[type] || !this.MADLedger[type].length || timestamp < this.MADLedger[type][0].t) {
      if(this.gettingMADLedgerState) {
        this.gettingMADLedgerBuffer.push({type: type, timestamp: timestamp});
        return;
      }
      this.gettingMADLedgerState = true;
      madWorker = new Worker('./madWorker.js');
      madWorker.on('message', (data) => {
        console.log(data.MADLedger.length);
        if(data.state == true) {
          if(this.MADLedger[data.type] && this.MADLedger[data.type].length) this.MADLedger[data.type] = data.MADLedger.concat(this.MADLedger[data.type]);
          else this.MADLedger[data.type] = data.MADLedger;
        }
        madWorker.terminate();
        this.gettingMADLedgerState = false;
        if(data.state == false) return setTimeout(() => {
          this.getMADLedger(data.type, data.timestamp);
        }, 500);
        if(this.gettingMADLedgerBuffer.length) {
          var each = this.gettingMADLedgerBuffer.shift();
          this.getMADLedger(each.type, each.timestamp);
        }
      })
      madWorker.on('error', (e) => {
        console.log('worker error');
        console.log(e);
      })
      madWorker.on('exit', () => {
        console.log('worker exit');
      })
      var timestampEnd = this.MADLedger[type] && this.MADLedger[type].length ? this.MADLedger[type][0].t-1 : Math.floor(Date.now()/1000);
      madWorker.postMessage({type: type, timestamp: timestamp, timestampEnd: timestampEnd});
    }
  }
  mineTransactions() {
    if(this.buffer.length < config.transactionsForBlock || this.miningState) return;
    this.miningState = true;
    console.log('mining data');
    //get verified transactions from buffer
    var transactionsForMining = [];
    for(var eachBuffer of this.buffer) {
      var transaction = eachBuffer.transaction;
      if(transaction.result) {
        var publickey = transaction.publickey;
        var lastNonce = this.getLastNonceOfBlockchain(publickey);
        if(transaction.content.nonce - lastNonce == 1) {
          transactionsForMining.push(transaction);
        }
        else {
          for(const each of transactionsForMining) {
            if(transaction.publickey == each.publickey && trnasaction.content.nonce - each.content.nonce == 1) transactionsForMining.push(transaction);
          }
        }
      }
      if(transactionsForMining.length === config.transactionsForBlock) break;
    }
    if(transactionsForMining.length < config.transactionsForBlock) {
      this.miningState = false;
      return;
    }
    var blockId = Number(this.blockchain[this.blockchain.length -1].id) + 1;
    var prevhash = this.blockchain[this.blockchain.length - 1].hash;
    worker.on('message', data => {
      if(data.type == 'newBlock' && data.newBlock.id == this.blockchain.length + 1) {
        this.broadcastNewBlock(data.newBlock);
        this.blockchain.push(data.newBlock);
        console.log('new block mined');
        console.log(this.blockchain[this.blockchain.length - 1]);
        //delete blocked transactions from buffer
        this.deleteVerifiedTransactionsFromBuffer(data.newBlock);
        //send changed state to user
        for(const each of data.newBlock.transactions) {
          if(this.clientRoom[each.publickey]) this.clientRoom[each.publickey].emit('transactionState', {nonce: each.content.nonce, state: each.result, blocknumber: data.newBlock.id});
        }
      }
      worker.terminate();
      worker = new Worker('./worker.js');
      this.miningState = false;
      this.mineTransactions();
    })
    worker.on('error', () => {
      console.log('worker error');
    })
    worker.on('exit', () => {
      console.log('worker exit');
    })
    worker.postMessage({transactions: transactionsForMining, prevhash: prevhash, blockId: blockId});
  }
  broadcastNewBlock(newBlock) {
    for(var each in this.nodeRoom) {
      console.log('broadcast new Block to: '+each)
      this.nodeRoom[each].socket.emit('broadcastNewBlock', newBlock);
    }
  }
  deleteVerifiedTransactionsFromBuffer(newBlock) {
    var verifiedIndexes = [];
    for(var [index, eachBuffer] of Object.entries(this.buffer)) {
      for(var verifiedTransaction of newBlock.transactions) {
        if(verifiedTransaction.publickey == eachBuffer.transaction.publickey && verifiedTransaction.content.nonce == eachBuffer.transaction.content.nonce) {
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
  checkWinOrLoss(eachBuffer) {
    console.log('checkWinOrLoss');
    console.log(this.gettingMADLedgerState);
    var content = eachBuffer.transaction.content;
    var type = content.type;
    var timestamp = content.timestamp;
    //get MADLedger
    if(eachBuffer.transaction.result) return "checked";
    if(!this.MADLedger[type] || !this.MADLedger[type].length) return false;
    else if(timestamp < this.MADLedger[type][0].t && this.gettingMADLedgerState) return false;
    console.log('checking');
    //get start index
    var startIndex = 0;
    for(var i = this.MADLedger[type].length - 1; i >= 0; i--) {
      if(this.MADLedger[type][i].t < timestamp) startIndex = i+1;
    }
    //check win or loss
    //if "buy" tp > entry_price > sl, if "sell" sl > entry_price > tp
    for(var i = startIndex; i < this.MADLedger[type].length; i++) {
      if(content.action === "buy" && this.MADLedger[type][i].h >= content.tp && this.MADLedger[type][i].l > content.sl) return "win";
      if(content.action === "buy" && this.MADLedger[type][i].h < content.tp && this.MADLedger[type][i].l <= content.sl) return "loss";
      if(content.action === "sell" && this.MADLedger[type][i].h <= content.tp && this.MADLedger[type][i].l < content.sl) return "win";
      if(content.action === "sell" && this.MADLedger[type][i].h > content.tp && this.MADLedger[type][i].l >= content.sl) return "loss";
      if((content.action === "buy" && this.MADLedger[type][i].h >= content.tp && this.MADLedger[type][i].l <= content.sl) || (content.action === "sell" && this.MADLedger[type][i].h <= content.tp && this.MADLedger[type][i].l >= content.sl)) {
        return "undefined";
      }
    }
    return false;
  }
  getLastMADLedger() {
    console.log('get recent MADLedger');
    tools.getLastMADLedger((data) => {
      if(!data.state) return setTimeout(() => {
        this.getLastMADLedger();
      }, 500);
      var lastIndexes = data.lastMADLedger;
      if(lastIndexes) {
        for(var each of lastIndexes) {
          // if(this.MADLedger[each.type] && this.MADLedger[each.type].length) {
          //   console.log(this.MADLedger[each.type].slice(-2));
          //   console.log(each.type);
          // }
          if(!this.MADLedger[each.type] || !this.MADLedger[each.type].length) this.MADLedger[each.type] = [{t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v}];
          else if(this.MADLedger[each.type][this.MADLedger[each.type].length - 1].t < each.t) this.MADLedger[each.type].push({t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v});
        }
      }
      this.checkTransactionsInBuffer();
    });
  }
  async checkTransactionsInBuffer() {
    console.log('check transactions in buffer: '+this.buffer.length);
    if(this.buffer.length) this.checkEachTransactionInBuffer(0);
  }
  checkEachTransactionInBuffer(index) {
    if(this.buffer.length <= index) return;
    var eachBuffer = this.buffer[index];
    if(eachBuffer.validate.self || eachBuffer.transaction.result) {
      this.checkEachTransactionInBuffer(index + 1);
      return;
    }
    var result = this.checkWinOrLoss(eachBuffer);
    console.log(result);
    if(result == "win" || result == "loss" || result == "undefined") {
      console.log("self checked: "+result);
      var publickey = eachBuffer.transaction.publickey
      const sign = tools.getSign(this.privKey, {publickey: publickey, nonce: eachBuffer.transaction.content.nonce, state: result});
      this.sendEachTransactionValidating(eachBuffer.transaction, sign, result);
      eachBuffer.validate.self = {sign: sign, state: result};
      if(this.checkTransactionValid(eachBuffer)) {
        this.broadcastValidTransaction(eachBuffer);
        if(this.clientRoom[publickey]) this.clientRoom[publickey].emit('transactionState', {nonce: eachBuffer.transaction.content.nonce, state: result});
        if(!this.miningState) this.mineTransactions();
      }
    }
    setImmediate(() => this.checkEachTransactionInBuffer(index + 1));
  }
  sendEachTransactionValidating(transaction, sign, state) {
    console.log('broadcast transaction state:'+state);
    var publickey = transaction.publickey;
    var nonce = transaction.content.nonce;
    for(var each in this.nodeRoom) {
      this.nodeRoom[each].socket.emit('eachTransactionValidating', {publickey:publickey, nonce:nonce, state:state, sign: sign});
    }
  }
}
