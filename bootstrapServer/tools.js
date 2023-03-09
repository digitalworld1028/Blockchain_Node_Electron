const sha256 = require('sha256');
const secp256k1 = require('secp256k1/elliptic');
const axios = require('axios');

module.exports = {

  validateSign: (signature_str, data, pubKey_string) => {
    const data_hash = sha256(JSON.stringify(data));
    const signature = Uint8Array.from(Buffer.from(signature_str, 'hex'));
    const pubKey = Uint8Array.from(Buffer.from(pubKey_string, 'hex'));
    return secp256k1.ecdsaVerify(signature, Uint8Array.from(Buffer.from(data_hash, 'hex')), pubKey);
  },
  
  validateTransaction: (transaction) => {
    const action = transaction.action.trim().toLowerCase();
    const entryPrice = transaction.entry_price.trim();
    const timestamp = transaction.timestamp.trim();
    const tp = transaction.tp.trim();
    const sl = transaction.sl.trim();
    const timeframe = transaction.timeframe.trim();
    const tid = transaction.tid.trim();
    if(timestamp <= 0 && Number(timestamp) > Date.now()/1000) return {state: false, error: "invalid timestamp"};
    if(!((action === "buy" && Number(entryPrice) <= Number(tp) && Number(entryPrice) >= Number(sl) && Number(sl) > 0) || (action === "sell" && Number(entryPrice) >= Number(tp) && Number(entryPrice) <= Number(sl) && Number(tp) > 0))) return {state: false, error: "invalid price"};
    if(!(action === "sell" || action === "buy")) return {state: false, error: "invalid action"};
    if(!timeframe || !tid) return {state: false, error: "no timeframe or tid"};
    return {state: true};
  },

  async getMADLedger(type, timestampStart, timestampEnd) {
    var response = await axios.get(`http://192.46.216.136/getMultiEntry?type=${type}&timeStart=${timestampStart}&timeEnd=${timestampEnd}`);
    return response;
  },

  getLastMADLedger(cb) {
    axios.get('http://192.46.216.136/getLastEntries').then(resp => {
      cb(resp.data);
    });
  },
  
  createBlock(transactionsForMining, lastBlock) {
    const id = lastBlock.id + 1;
    const prevhash = lastBlock.hash;
    const transactions = transactionsForMining;
    const timestamp = Date.now() / 1000;
    const hash = sha256(JSON.stringify({id: id, prevhash: prevhash, transactions: transactions, timestamp: timestamp}));
    return {id: id, prevhash: prevhash, transactions: transactions, timestamp: timestamp, hash: hash};
  },

  createGenesisBlock() {
    const id = 1;
    const prevhash = 0;
    const transactions="This is genesis block";
    const timestamp = Date.now() / 1000;
    const hash = sha256(JSON.stringify({id: id, prevhash: prevhash, transactions: transactions, timestamp: timestamp}));
    return {id: id, prevhash: prevhash, transactions: transactions, timestamp: timestamp, hash: hash};
  }
}