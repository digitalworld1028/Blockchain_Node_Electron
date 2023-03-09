const secp256k1 = require("secp256k1/elliptic");
const sha256 = require("sha256");

function privateKeyGenerator (userInfo){
    const randomText = userInfo.randomText;
    let privKey;

    do {
        var time = new Date();
        time = time.toString();
        var privKey_string = sha256(randomText+time);
        privKey = Uint8Array.from(Buffer.from(privKey_string, 'hex'));
    } while (!secp256k1.privateKeyVerify(privKey));
    return privKey;
}

function signObjectGenerator(msg,privKey){
    const pubKey = publicKeyGenerator(privKey);
    // const pubKey_string = Buffer.from(pubKey).toString('hex');
    const msg_hash = sha256(JSON.stringify(msg));
    const signObj = secp256k1.ecdsaSign(Uint8Array.from(Buffer.from(msg_hash, 'hex')), privKey);
    return signObj;
}

function publicKeyGenerator (privKey) {
    return secp256k1.publicKeyCreate(privKey);
}

module.exports = {privateKeyGenerator, signObjectGenerator, publicKeyGenerator};