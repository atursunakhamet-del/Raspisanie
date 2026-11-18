import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'oqu-smoke-')),origin='http://localhost:5567';
const child=spawn(process.execPath,['local-server.mjs'],{env:{...process.env,PORT:'5567',OQU_DATA_DIR:dir,AUTH_SECRET:'local-smoke-test-only-secret-123456789012345',SETUP_CODE:'LOCAL-SMOKE-SETUP'},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes('http://localhost:5567')){clearTimeout(timer);resolve();}});child.on('exit',()=>reject(Error('Server exited early')));});
 const page=await fetch(origin);assert.equal(page.status,200);assert.ok((await page.text()).includes('account.js'));
 const config=await (await fetch(origin+'/api/config')).json();assert.equal(config.setupRequired,true);
 const post=(path,payload,cookie)=>fetch(origin+'/api'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-oqu-request':'1',...(cookie?{cookie}:{})},body:JSON.stringify(payload)});
 const signup=await post('/register',{role:'admin',code:'LOCAL-SMOKE-SETUP',name:'Smoke admin',login:'admin',password:'LocalSmokePassword123!'});assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie').split(';')[0];
 const me=await (await fetch(origin+'/api/me',{headers:{cookie}})).json();assert.equal(me.user.role,'admin');
 const saved=await (await fetch(origin+'/api/data',{headers:{cookie}})).json();assert.equal(saved.revision,1);assert.equal(saved.data.groups.length,2);assert.equal(saved.data.schedule.length,84);
 assert.equal((await post('/logout',{},cookie)).status,200);const after=await (await fetch(origin+'/api/me',{headers:{cookie}})).json();assert.equal(after.user,null);
 console.log('Standalone Node server: HTTP, static assets, SQLite migration, signup, session and logout passed.');
}finally{child.kill();if(child.exitCode===null)await once(child,'exit');await rm(dir,{recursive:true,force:true});}
