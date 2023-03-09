const {app, BrowserWindow, Notification} = require('electron');
const axios = require("axios");
const ipc = require('electron').ipcMain;
const DataStore = require('nedb');
db = new DataStore({ filename: 'data.db', autoload: true });
const socket_client = require('socket.io-client');
var userData;//{private_key: doc.private_key, user_id: doc.user_id, nodes: doc.nodes}
var transactionState = [];

// const WebSocket = require("ws");
// const wss = new WebSocket.Server( { port: 1040 } );

const keyLib = require("./src/controller/KeyGenerator") ;
const {config} = require("./src/controller/config");
var page = 0;
var socket;

function showNotification (notification) {
    new Notification(notification).show();
}

function linkSocket(doc, cb) {
    const privKey_string = doc.private_key;
    const privKey = Uint8Array.from(Buffer.from(privKey_string, 'hex'));
    const pubKey = keyLib.publicKeyGenerator(privKey);
    const pubKey_string = Buffer.from(pubKey).toString('hex');

    const userid = doc.user_id;
    const nodes = doc.nodes;
    socket = socket_client.connect(nodes[0],  {
        reconnectionAttempts : 10,
        timeout: 5000,
        reconnection: false,
        query: {link_type:"client", publicKey: pubKey_string, numPerPage: config.numPerPage}
    });
    socket.on('connect', function() {
        console.log('node connected');
    });
    socket.on('transactionHistory', function(returnData) {//{returnData, ismore}
        cb({state: true, returnData: returnData});
    })
    socket.on('disconnect', function(reason) {
        console.log('node disconnected. Try to other node');
        reconnectToOtherNode(doc, cb);
    });
    socket.on('connect_error', function (error) {
        console.log('connect error. Try to other node');
        reconnectToOtherNode(doc, cb);
    });
    socket.on('transactionState', function(state) {
        transactionState.push(state);
    })
    socket.on('invalidData', )
}

function reconnectToOtherNode(doc, cb) {
    try {
        axios.post(config.server+"/getNodes").then(function(res){
            if(res.data.state) {
                console.log(res.data);
                var nodes = res.data.nodes;
                doc.nodes = nodes;
                console.log(userData);
                console.log(doc);
                db.update({user_id: userData.user_id}, {$set: {nodes: nodes}}, {}, function (err, newrec) {
                    if(!err){
                    }
                    linkSocket(doc, cb);
                });
            }else {
                console.log('no node');
            }
        });
    }
    catch(e) {
        notification.body = "Unexpected error";
        showNotification(notification);
    }
}

function register(store, event) {
    let notification = {
        title : "Register",
        body : ""
    }
    var privKey = keyLib.privateKeyGenerator(store.randomText);
    var privKey_string = Buffer.from(privKey).toString('hex');
    var requestMsg = {userid: store.userId, firstName: store.firstName, lastName: store.lastName};
    var loginSignObject = keyLib.signObjectGenerator(requestMsg, privKey);

    const pubKey = keyLib.publicKeyGenerator(privKey);
    const pubKey_string = Buffer.from(pubKey).toString('hex');

    try {
        console.log('register');
        console.log([Buffer.from(loginSignObject.signature).toString('hex'), requestMsg, pubKey_string]);
        axios.post(config.server+"/register", {message: [Buffer.from(loginSignObject.signature).toString('hex'), requestMsg, pubKey_string]}).then(function(res){
            if(res.data.state) {
                var rec = { private_key: privKey_string, user_id:store.userId, first_name:store.firstName, last_name:store.lastName, password:store.password, nodes:res.data.nodes};
                db.insert(rec, function (err, newrec) {
                    if(!err){
                    }
                });
                event.reply('register_response', res.data);
            }else {
                if (res.data.reason === 'duplicate public key') {
                    console.log('duplicate public key');
                    return register(store);
                }
                else {
                    event.reply('register_response', res.data);
                }
            }
        });
    }
    catch(e) {
        notification.body = "Unexpected error";
        showNotification(notification);
    }
}

function createWindow () {
    const win = new BrowserWindow({
        width:1024,
        height:768,
        webPreferences:{
            nodeIntegration: true
        }
    });
    ipc.on('hello', function(event, store) {
        //console.log(store);
        const notification = {
            title : 'Message test',
            body : store
        }
        showNotification(notification);
    });

    ipc.on('getData', function(event, store) {
        var last_nonce = store.last_nonce;
        if(last_nonce == null) {
            linkSocket(userData, function(transactionHistory) {
                if(transactionHistory.state) event.reply('getData_response', transactionHistory.returnData);
            });
        }
        else {
            socket.emit('getTransactionHistory', {last_nonce: last_nonce});
        }
    })

    ipc.on('login', function(event, store) {
        //console.log(store);
        var  notification = {
            title : 'Login',
            body : ''
        }
        //showNotification(notification);
        db.findOne({ user_id: store.userId }, function (err, doc) {
            if (!err){
                if(doc){
                    if(doc.password == store.password){
                        userData = {private_key: doc.private_key, user_id: doc.user_id, nodes: doc.nodes};
                        win.loadFile('src/view/transaction/table.html');
                    }else {
                        event.reply('login_response', {state: false, reason: 'password'})
                    }
                }else {
                    event.reply('login_response', {state: false, reason: 'userid'})
                }
            }
        });
    });

    ipc.on('register', function(event, store) {
        console.log(store.userId);
        register(store, event);
    });

    ipc.on('submitTransaction', function(event, store) {
        console.log(store);
        console.log('submit transaction');
        const privKey_string = userData.private_key;
        const privKey = Uint8Array.from(Buffer.from(privKey_string, 'hex'));
        const sign = keyLib.signObjectGenerator(store, privKey);
        const pubKey = keyLib.publicKeyGenerator(privKey);
        const pubKey_string = Buffer.from(pubKey).toString('hex');
        if(socket) socket.emit('transaction', {publickey: pubKey_string, sign: Buffer.from(sign.signature).toString('hex'), content: store});
        else console.log('socket error: submit transaction failed');
    });

    ipc.on('getTransactionState', function(event, store) {
        if(transactionState.length) {
            event.reply('getTransactionState_response', transactionState);
            transactionState = [];
        }
    })

    win.loadFile('src/view/login/index.html');
}

app.setUserTasks([
    {
      program: process.execPath,
      arguments: '--new-window',
      iconPath: process.execPath,
      iconIndex: 0,
      title: 'New Window',
      description: 'Create a new window'
    }
]);

app.whenReady().then(createWindow).then(()=>{
    const mainNotification = {
        title:'Main Process',
        body:'This is Main Process Alert'
    }
    showNotification(mainNotification);
});

app.on('window-all-closed', ()=>{
    if (process.platform !== 'darwin'){
        app.quit();
    }
})

app.on('activate', ()=>{
    if (BrowserWindow.getAllWindows === 0){
        createWindow();
    }
})