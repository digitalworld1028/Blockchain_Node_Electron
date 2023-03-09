// const SHA256 = require('crypto-js/sha256');
const database = require('./database');

// function computeHash(data){
//   return SHA256(data).toString();
// }
module.exports = class DataHandler {
  constructor(io) {
    this.io = io;
    this.totalNodes = 1;
    this.ownBuffer = {};
    this.otherBuffers = {};
    this.verifyStatus = false;
    this.initState = 0;//0: init, 1: start, 2: end
  }
  getOneEntry(type, timestamp, cb) {
    var self = this;
    database.getOneEntry(type, timestamp, function(state, response) {
      if(state) {
        cb(false, response);
      }
      else cb(true, null);
    });
  }
  getMultiEntries(type, tstart, tend, cb) {
    database.getMultiEntry(type, tstart, tend, function(state, response) {
      if(state) {
        cb(false, response);
      }
      else cb(true, null);
    });
  }
  getLastEntries(cb) {
    var data = database.getLastEntries((data) => {
      if(data) return cb(data);
    });
  }
  nodePlus() {
    this.totalNodes++;
  }
  nodeMinus() {
    this.totalNodes--;
  }
  //data: [{type: 'BTCUSD', data:[...]}]
  receiveData(data) {
    this.addDataToBuffer(data);
  }
  addDataToBuffer(data) {
    var last;
    if(this.ownBuffer[data.type] && Array.isArray(this.ownBuffer[data.type]) && this.ownBuffer[data.type].length) {
      last = this.ownBuffer[data.type][this.ownBuffer[data.type].length-1];
    }
    var broadcastData = {type: data.type, data: []};
    if(!last) {
      this.ownBuffer[data.type] = data.data;
      broadcastData.data = data.data;
    }
    else {
      for (var i = 0; i < data.data.length; i++) {
        if(data.data[i].t > last.t) {
          this.ownBuffer[data.type] = data.data[i];
          broadcastData.data.push(data.data[i]);
        }
      }
    }
    if(broadcastData.data.length) this.broadcastData(broadcastData);
  }
  broadcastData(broadcastData) {
    if(this.totalNodes > 1) this.io.emit('broadcast', broadcastData);
    else {
      if(!this.verifyStatus) this.verifyData();
    }
  }
  addOtherBuffers(index, data) {
    var type = data.type;
    var array = data.data;
    if(this.otherBuffers[index] && this.otherBuffers[index][type] && Array.isArray(this.otherBuffers[index][type])) this.otherBuffers[index][type].push(array);
    else {
      array[type] = array;
      this.otherBuffers[index] = array;
    }
    this.otherBuffers[index][type].sort(function(a,b) {
      if(a.t > b.t) return true;
      return false;
    })
    if(!this.verifyStatus) this.verifyData();
  }
  //check data and save
  verifyData() {
    this.verifyStatus = true;
    const self = this;
    var type;
    var own;
    var total = 1;
    var checked = 0;
    for(type in this.ownBuffer) {
      if(Array.isArray(this.ownBuffer[type]) && this.ownBuffer[type].length) {
        own = this.ownBuffer[type].shift();
        own = {index: "own", data: own};
        checked++;
        break;
      }
    }
    if(!own) own = {};
    var others = [];
    for(var server in self.otherBuffers) {
      total++;
      if(Array.isArray(self.otherBuffers[server][type] && self.otherBuffers[server][type]) && self.otherBuffers[server][type].length) {
        while(self.otherBuffers[server][type].length) {
          var each = self.otherBuffers[server][type].shift();
          if((!own.t && !others.length) || each.t === own.t) {
            others.push({index: server, data: each});
            checked++;
            break ;
          }
          else if(each.t > own.t) {
            checked++;
            break; 
          }
        }
      }
    }
    if(!checked) {
      this.verifyStatus = false;
      return;
    }
    var [state, trueData] = this.getTrueData(own, others, type, total, checked);
    if(!state) {
      this.verifyStatus = false;
      return;
    }
    database.addData(trueData, function () {
      self.verifyData();
    });
  }
  getTrueData(own, others, type, total, checked) {
    var all = others;
    if(JSON.stringify(own) !== '{}') {
      all.push(own);
    }
    all.sort(function(a,b) {
      if(a.data.t > b.data.t) return true;
      else return false;
    });
    var checkArray = [];
    for(var each of all) {
      if(!checkArray.length) checkArray.push([each]);
      else {
        var state = false;
        for(var checkArray_each of checkArray) {
          if(each.data.t === checkArray_each[0].data.t) {
            state = true;
            checkArray_each.push(each);
            break;
          }
        }
        if(!state) checkArray.push([each]);
      }
    }
    checkArray.sort((a, b) => {
      if(a.length < b.length) return true;
      else return false;
    });
    if(checkArray[0].length*2 >= total || checked === total) {
      return [true, {type: type, ...checkArray[0][0].data}];
    }
    else {
      console.log('add failed');
      for(var eachArray of checkArray) {
        for(var each of eachArray) {
          if(each.index === "own") this.ownBuffer[type].unshift(each.data);
          else this.otherBuffers[each.index][type].unshift(each.data);
        }
      }
      return [false, undefined];
    }
  }
}
