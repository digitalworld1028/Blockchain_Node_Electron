function register(signObj,msg,privKey ) {
    const pubKey = publicKeyGenerator(privKey);
    const pubKey_string = Buffer.from(pubKey).toString('hex');
    try {
        const res = await axios.post(config.server+"/register", {message: [sigObj, msg, pubKey_string]});
        if(res.state) return {state: true, user:{userid: userid, firstName: firstName, lastName: lastName, password: password, privKey: privKey_string, pubKey: pubKey_string}, nodes: res.nodes, serverSign: res.serverSign};
        else {
            if(res.reason === 'duplicate public key') {
                return setTimeout(() => {
                    createUserData(data);
                }, 1000);
            }
        }
        return {state: false, user: undefined, reason: res.reason};
    }
    catch(e) {
        return {state: false, user: undefined, reason: "Unexpected error"};
    }
}