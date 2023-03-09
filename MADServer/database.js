const ExchangeRate = require('./models/ExchangeRate');

class Database {
  addData(data, cb) {
    ExchangeRate.find({type: data.type, t: data.t} , (err, res) => {
      if(res.length) {
        cb();
      }
      else {
        ExchangeRate.insertMany(data, function(err, response){
          if(err) console.log("Database error");
          cb();
        });
      }
    })
  }
  async getLastEntries(cb) {
    var lastData = await ExchangeRate.find().sort({t: -1}).limit(1).catch((error)=>{console.log(error);});
    if(!lastData || !lastData[0] || !lastData[0].t) return cb(false);
    var response = await ExchangeRate.find({t: lastData[0].t}).catch((error)=>{console.log(error); return false});
    return cb(response);
  }
  async getOneEntry(type, timestamp, cb) {
    if(timestamp) {
      var query = {type: type, t: {$gt: (timestamp - 60).toString(), $lte: timestamp}};
      var response = await ExchangeRate.find(query).catch((error)=>{console.log(error); return cb(false, null)});
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
      if(err) return cb(false, "Database error");
      else return cb(true, response); 
    })
  }
}

const database = new Database();
module.exports = database;