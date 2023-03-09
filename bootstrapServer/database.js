const ExchangeRate = require('./models/ExchangeRate');

class Database {
  addData(data, cb) {
    ExchangeRate.insertMany(data, function(err, response){
      if(err) console.log("Database error");
      cb();
    });
  }
  async getLastEntry(cb) {
    var response = await ExchangeRate.find().sort({t: -1, type: -1}).limit(1).catch((error)=>{console.log(error); return cb(false)});
    return cb(true, response);
  }
  async getOneEntry(type, timestamp, cb) {
    if(timestamp) {
      var response = await ExchangeRate.findOne({type: type, t: {$gt: Number(timestamp) - 60, $lte: timestamp}}).catch((error)=>{
        console.log("Database error");
        return cb(false, null);
      });
      return cb(true, response);
    }
    else {
      var response = await ExchangeRate.find({type: type}).sort({t: -1}).limit(1).catch((error)=>{console.log(error); return cb(false, null)});
      return cb(true, response);
    }
  }
  getMultiEntry(type = '', timestampStart = null, timestampEnd = null, cb) {
    var query = {};
    if(type) query.type = type;
    if(timestampStart !== null) query.t = {$gte: timestampStart};
    if(timestampEnd !== null) query.t = {...query.t, $lte: timestampEnd};
    ExchangeRate.find(query, function(err, response) {
      if(err) return cb(false, null);
      else return cb(true, response); 
    })
  }
}

const database = new Database();
module.exports = database;