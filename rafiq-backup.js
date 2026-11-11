'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.RafiqBackup=api;
})(globalThis,function(){
  const MAX_BYTES=12*1024*1024;
  const ITERATIONS=600000;
  const text=new TextEncoder();
  const aad=text.encode('rafiq-backup/v1');
  function supported(webCrypto=globalThis.crypto){return !!(webCrypto?.subtle&&webCrypto?.getRandomValues);}
  function b64(bytes){
    let data='';
    for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(data);
  }
  function fromB64(value,max){
    if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!(/^[A-Za-z0-9+/]*={0,2}$/).test(value)||value.length%4!==0)throw new Error('invalid backup bytes');
    const decoded=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
    if(decoded.length>max)throw new Error('invalid backup bytes');
    return decoded;
  }
  function passwordOK(value){return typeof value==='string'&&value.trim().length>=10&&value.length<=256;}
  async function keyFor(password,salt,crypto,usage){
    const base=await crypto.subtle.importKey('raw',text.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},base,{name:'AES-GCM',length:256},false,[usage]);
  }
  async function encrypt(payload,password,crypto=globalThis.crypto){
    if(!supported(crypto))throw new Error('encryption not available');
    if(!passwordOK(password))throw new Error('invalid password length');
    const source=text.encode(JSON.stringify(payload));
    if(source.length>MAX_BYTES)throw new Error('backup too large');
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await keyFor(password,salt,crypto,'encrypt');
    const result=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,source));
    return {app:'rafiq',encrypted:true,schema:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-GCM-256',salt:b64(salt),iv:b64(iv),payload:b64(result)};
  }
  async function decrypt(envelope,password,crypto=globalThis.crypto){
    if(!supported(crypto))throw new Error('decryption not available');
    if(!passwordOK(password))throw new Error('invalid password length');
    if(envelope?.app!=='rafiq'||envelope.encrypted!==true||envelope.schema!==1||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==ITERATIONS||envelope.cipher!=='AES-GCM-256')throw new Error('unknown encrypted backup');
    const salt=fromB64(envelope.salt,16),iv=fromB64(envelope.iv,12),ciphertext=fromB64(envelope.payload,MAX_BYTES+16);
    if(salt.length!==16||iv.length!==12||ciphertext.length<17)throw new Error('invalid encrypted backup');
    const key=await keyFor(password,salt,crypto,'decrypt');
    const opened=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,ciphertext);
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(opened));
  }
  return {encrypt,decrypt,supported,passwordOK,MAX_FILE_BYTES:18*1024*1024};
});
