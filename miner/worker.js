const { parentPort } = require('worker_threads');
const tools = require('./tools');

parentPort.once('message',
    function(data) {
      console.log('here is worker');
      const transactions = data.transactions, prevhash = data.prevhash, blockId = data.blockId;
      do {
        var nonce = tools.createRandomNonce();
        var newBlock = tools.createBlock(transactions, prevhash, blockId, nonce);
      }while(newBlock.hash > '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      parentPort.postMessage({type: 'newBlock', newBlock: newBlock});
    }
)