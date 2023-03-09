// const SHA256 = require('crypto-js/sha256');
const database = require('./database');

// function computeHash(data){
//   return SHA256(data).toString();
// }
module.exports = class DataHandler {
  constructor(io) {
    this.io = io;
    this.totalNodes = 1;
    this.ownBuffer = [];
    this.otherBuffers = {};
    this.lastAdded = undefined;
    this.getLast();
    this.verifyStatus = false;
    this.initState = 0;//0: init, 1: start, 2: end
  }
  getLast() {
    var self = this;
    database.getLastEntry(function(state, response) {
      if(state) {
        if(response.length) {
          self.lastAdded = {type: response[0].type, t: response[0].t};
        }
      }
      console.log(self.lastAdded);
    });
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
  nodePlus() {
    this.totalNodes++;
  }
  nodeMinus() {
    this.totalNodes--;
  }
  createOtherBuffers(index) {
    this.otherBuffers[index] = [];
  }
  //data: [{type: 'BTCUSD', data:[...]}]
  receiveData(data) {
    this.addDataToBuffer(data);
  }
  addDataToBuffer(data) {
    var array = [];
    for (var i = 0; i < data.length; i++) {
      var type = data[i].type;
      for(var each of data[i].data) {
        each.type = type;
        array.push(each);
      }
    }
    array.sort(function(a,b) {
      if(a.t > b.t) return true;
      if(a.t === b.t && a.type > b.type) return true;
    });
    this.ownBuffer = this.ownBuffer.concat(array);
    // if(this.initState === 0) {
    //   if(this.totalNodes === 1) this.initState = 2;
    //   else {
    //     this.initState = 1;
    //     this.getFormerData(this.lastAdded, this.ownBuffer[0]);
    //   }
    // }
    this.broadcastData(array);
  }
  broadcastData(array) {
    if(this.totalNodes > 1) this.io.emit('broadcast', array);
    else {
      if(!this.verifyStatus) this.verifyData();
    }
  }
  addOtherBuffers(index, data) {
    this.otherBuffers[index].concat(data);
    if(!this.verifyStatus) this.verifyData();
  }
  //check data and save
  verifyData() {
    this.verifyStatus = true;
    const self = this;
    if(this.ownBuffer.length) {
      var own = this.ownBuffer.shift();
      if(this.lastAdded) {
        while(this.lastAdded.t > own.t || (this.lastAdded.t === own.t && this.lastAdded.type >= own.type)) {
          if(this.ownBuffer.length) own = this.ownBuffer.shift();
          else {
            own = {};
            break;
          }
        }
      }
    }
    else var own = {};
    var others = [];
    for(var [key, each] of Object.entries(self.otherBuffers)) {
      if(each.length) {
        var other = each.shift();
        if(this.lastAdded) {
          while(this.lastAdded.t > other.t || (this.lastAdded.t === other.t && this.lastAdded.type >= other.type)) {
            if(each.length) other = each.shift();
            else {
              other = {};
              break;
            }
          }
        }
        if(other !== {}) {
          other.src = key;
          others.push(other);
        }
      }
    }
    if(own === {} && others === []) {
      this.verifyStatus = false;
      return;
    }
    var [state, trueData] = this.getTrueData(own, others);
    if(!state) {
      this.verifyStatus = false;
      return;
    }
    database.addData(trueData, function () {
      self.lastAdded = {type: trueData.type, t: trueData.t};
      self.verifyData();
    });
  }
  getTrueData(own, others) {
    var all = others;
    if(JSON.stringify(own) !== '{}') {
      own.src = "own";
      all.push(own);
    }
    if(!all.length) return [false, undefined];
    all.sort(function(a,b) {
      if(a.t > b.t || (a.t === b.t && a.type > b.type)) return true;
      else return false;
    });
    var total = all.length;
    var checkArray = [];
    var type = all[0].type;
    var timestamp = all[0].t;
    for(var each of all) {
      if(!checkArray.length) checkArray.push([each]);
      else {
        if(each.type !== type || each.t !== timestamp) {
          if(each.src === "own") this.ownBuffer.unshift({type: each.type, t: each.t, o: each.o, h: each.h, l: each.l, c: each.c, v: each.v});
          this.otherBuffers[each.src].unshift({type: each.type, t: each.t, o: each.o, h: each.h, l: each.l, c: each.c, v: each.v});
        }
        else {
          for(var i = 0; i < checkArray.length; i++){
            if(checkArray[i][0].o === each.o && checkArray[i][0].h === each.h &&checkArray[i][0].l === each.l &&checkArray[i][0].c === each.c &&checkArray[i][0].v === each.v) checkArray[i].push(each);
            else {
              if(i < checkArray.length - 1) continue;
              else checkArray.push([each]);
            }
          }
        }
      }
    }
    checkArray.sort((a, b) => {
      if(a.length < b.length) return true;
      else return false;
    });
    if(checkArray[0].length*2 > total || total >= this.totalNodes) return [true, {type: checkArray[0][0].type, t: checkArray[0][0].t, o: checkArray[0][0].o, h: checkArray[0][0].h, l: checkArray[0][0].l, c: checkArray[0][0].c, v: checkArray[0][0].v}];
    else {
      for(var eachArray of checkArray) {
        for(var each of eachArray) {
          if(each.src === "own") this.ownBuffer.unshift({type: each.type, t: each.t, o: each.o, h: each.h, l: each.l, c: each.c, v: each.v});
          this.otherBuffers[each.src].unshift({type: each.type, t: each.t, o: each.o, h: each.h, l: each.l, c: each.c, v: each.v});
        }
      }
      return [false, undefined];
    }
  }
}
