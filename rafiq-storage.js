'use strict';

(function (root, factory) {
  const create = factory();
  if (typeof module === 'object' && module.exports) module.exports = {createStorage:create};
  else {
    let mirror, indexed;
    try { mirror=root.localStorage; } catch {}
    try { indexed=root.indexedDB; } catch {}
    root.RafiqStorage=create({mirror,indexedDB:indexed});
  }
})(globalThis,function () {
  const ACCOUNT_KEY=/^rafiq-v50:(?:local|user:[^:]+):/;
  const DB_NAME='rafiq-account-data';
  const TABLE='entries';

  return function createStorage({mirror,indexedDB,timeout=1800}={}) {
    const records=new Map();
    let database=null, opening=null, mode='compatibility', writing=Promise.resolve();

    function close() {
      const old=database;
      database=null;mode='compatibility';
      if(old) old.close();
    }

    function open() {
      return new Promise((resolve,reject)=>{
        const request=indexedDB.open(DB_NAME,1);
        let done=false;
        const finish=(error,value)=>{
          if(done){value?.close();return;}
          done=true;clearTimeout(timer);
          if(error)reject(error);else resolve(value);
        };
        const timer=setTimeout(()=>finish(new Error('database open timeout')),timeout);
        request.onupgradeneeded=()=>{
          if(!request.result.objectStoreNames.contains(TABLE)) request.result.createObjectStore(TABLE,{keyPath:'key'});
        };
        request.onblocked=()=>finish(new Error('database upgrade blocked'));
        request.onerror=()=>finish(request.error||new Error('database unavailable'));
        request.onsuccess=()=>finish(null,request.result);
      });
    }

    function transaction(db,mode,callback) {
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(TABLE,mode);
        const timer=setTimeout(()=>{
          try {tx.abort();}catch{}
          reject(new Error('database transaction timeout'));
        },timeout);
        const finish=(error,value)=>{
          clearTimeout(timer);if(error)reject(error);else resolve(value);
        };
        let request;
        tx.oncomplete=()=>finish(null,request?.result);
        tx.onabort=tx.onerror=()=>finish(tx.error||new Error('database transaction failed'));
        try {request=callback(tx.objectStore(TABLE));}
        catch(error){try{tx.abort();}catch{}finish(error);}
      });
    }

    function persist(db,changes) {
      return transaction(db,'readwrite',store=>{
        for(const [key,value] of changes) {
          if(value===null)store.delete(key);
          else store.put({key,value});
        }
      });
    }

    function queue(changes) {
      const db=database;
      if(!db||!changes.length)return;
      writing=writing.then(()=>database===db?persist(db,changes):undefined).catch(()=>{
        if(database===db)close();
      });
    }

    function readMirror() {
      if(!mirror)return null;
      const found=new Map();
      try {
        for(let i=0;i<mirror.length;i++){
          const key=mirror.key(i);
          if(!key||!ACCOUNT_KEY.test(key))continue;
          const value=mirror.getItem(key);
          if(value!==null)found.set(key,value);
        }
        return found;
      } catch {return null;}
    }

    async function initialize() {
      if(!indexedDB)return mode;
      try {
        database=await open();
        const db=database;
        db.onversionchange=()=>{if(database===db)close();};
        const rows=await transaction(db,'readonly',store=>store.getAll());
        if(database!==db)return mode;
        for(const row of rows)if(typeof row.value==='string'&&ACCOUNT_KEY.test(row.key))records.set(row.key,row.value);
        const live=readMirror();
        if(live) {
          const edits=[];
          for(const [key,value] of live)if(records.get(key)!==value)edits.push([key,value]);
          // A legacy build or another tab may have removed a link or a record.
          // Do not restore a key deleted from a readable compatibility store.
          for(const key of records.keys())if(!live.has(key))edits.push([key,null]);
          records.clear();for(const [key,value] of live)records.set(key,value);
          if(edits.length)await persist(db,edits);
        }
        if(database===db)mode='indexeddb';
      } catch {close();}
      return mode;
    }

    function reconcile(key,value) {
      if(!ACCOUNT_KEY.test(key))return;
      if((records.get(key)??null)===value)return;
      if(value===null)records.delete(key);else records.set(key,value);
      queue([[key,value]]);
    }

    const store={
      getItem(key) {
        try {
          if(mirror){const value=mirror.getItem(key);reconcile(key,value);return value;}
        } catch {}
        return records.get(key)??null;
      },
      setItem(key,value) {
        if(!mirror)throw new Error('local persistence unavailable');
        value=String(value);
        // Write synchronously before acknowledging save, even if the page closes
        // before its IndexedDB transaction commits. Keep v51 rollback compatible.
        mirror.setItem(key,value);reconcile(key,value);
      },
      removeItem(key) {
        if(!mirror)throw new Error('local persistence unavailable');
        mirror.removeItem(key);reconcile(key,null);
      }
    };
    return {store,prepare(){return opening??=(initialize());},flush(){return writing;},mode:()=>mode};
  };
});
