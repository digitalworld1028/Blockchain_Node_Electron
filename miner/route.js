const config = require('./config.json');
const tools = require('./tools');

module.exports = function(app, Miner){
  
  //receive other mining nodes address as array
  // app.post('/getNodes', (req, res) => {
  //   const nodes = req.body.nodes;
  //   console.log("receive other nodes address array");
  //   Miner.setNodes(nodes);
  //   Miner.linkNodes();//link to other nodes using socket
  // });
'use strict';

const { networkInterfaces } = require('os');

const nets = networkInterfaces();
const results = {};

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
            if (!results[name]) {
                results[name] = [];
            }
            results[name].push(net.address);
        }
    }
}
app.get('/', (req, res) => {
  res.send(results);
})
};

