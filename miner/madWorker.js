const { parentPort } = require('worker_threads');
const tools = require('./tools');
const config = require('./config.json');

parentPort.once('message',
    async function(data) {
      var type = data.type;
      var timestamp = data.timestamp;
      var timestampStart = timestamp - 60;
      var timestampEnd = data.timestampEnd;
      console.log(timestampStart);
      console.log(timestampEnd);
      var returnData = [];
      console.log('in madworker');
      for(var i = 0; i < Math.ceil(Math.ceil(Number(timestampEnd) - Number(timestampStart)) / (config.MADLedger_per_receive * 60)); i++) {
        var eachTimestamp = Number(timestampStart) + config.MADLedger_per_receive * 60 * i + 1;
        var eachTimestampEnd = Number(timestampStart) + config.MADLedger_per_receive * 60 * (i + 1);
        if(eachTimestampEnd > Number(timestampEnd)) eachTimestampEnd = timestampEnd;
        try {
          var response = await tools.getMADLedger(type, eachTimestamp, eachTimestampEnd);
          console.log('getData');
          if(response.data && response.data.length) {
            for(var j = 0; j < response.data.length; j++) {
              var each = response.data[j];
              returnData.push({t:each.t, o:each.o, h:each.h, l:each.l, c:each.c, v:each.v});
            }
          }
        }
        catch(err) {
          console.log('failed get MADLedger');
          return parentPort.postMessage({state: false, timestamp: timestamp});
        }
      }
      console.log(returnData.length);
      parentPort.postMessage({state: true, type: type, MADLedger: returnData});
    }
)