import { ensureSourceImport } from './source-import.js';
import { emptyState, valid } from './state.js';
const enc=new TextEncoder(),SESSION_AGE=7*24*60*60*1000;
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const id=()=>crypto.randomUUID();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
async function digest(s){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export async function passwordHash(password,secret,salt=random().slice(0,32)){
 const pepper=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const material=await crypto.subtle.sign('HMAC',pepper,enc.encode(password));
 const key=await crypto.subtle.importKey('raw',material,'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256);
 return `pbkdf2-sha256$100000$${salt}$${hex(hash)}`;
}
async function verify(password,stored,secret){const parts=String(stored).split('$');if(parts.length!==4)return false;return equal(await passwordHash(password,secret,parts[2]),stored);}
class ApiError extends Error{constructor(status,message,field){super(message);this.status=status;this.field=field;}}
const fail=(s,m,field)=>{throw new ApiError(s,m,field);};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin',...headers}});
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'JSON форматын пайдаланыңыз.');const reader=request.body?.getReader();if(!reader)fail(400,'Деректер жоқ.');let total=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2000000){await reader.cancel();fail(413,'Деректер көлемі тым үлкен.');}chunks.push(value);}const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'JSON деректері жарамсыз.');}}
const publicUser=u=>({id:u.id,login:u.login,name:u.name,role:u.role,groupId:u.group_id||'',teacherId:u.teacher_id||''});
const settingsValid=(s,groupIds)=>s&&typeof s.enabled==='boolean'&&typeof s.sound==='boolean'&&[5,10,15,30,60].includes(s.lead)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s.evening)&&typeof s.group==='string'&&(!s.group||groupIds.includes(s.group));
async function loadState(db){const row=await db.prepare('SELECT json,revision FROM school_state WHERE id=1').first();return row?{data:JSON.parse(row.json),revision:row.revision}:{data:emptyState(),revision:0};}
async function userData(db,u){const {data,revision}=await loadState(db);let settings;try{settings=JSON.parse(u.settings||'{}');}catch{settings={};}data.settings={...emptyState().settings,...settings};if(!data.groups.some(g=>g.id===data.settings.group))data.settings.group='';
 const done=await db.prepare('SELECT task_id FROM completions WHERE user_id=?').bind(u.id).all();const completed=new Set(done.results.map(x=>x.task_id));
 if(u.role==='student'){data.groups=data.groups.filter(g=>g.id===u.group_id);data.schedule=data.schedule.filter(l=>l.groups===u.group_id);data.tasks=data.tasks.filter(t=>t.groups===u.group_id);data.settings.group=u.group_id||'';}
 data.tasks=data.tasks.map(t=>({...t,done:completed.has(t.id)}));data.demo=false;return {data,revision};}
async function rate(db,key,max,windowMs){const now=Date.now();const r=await db.prepare('INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(key,now+windowMs,now,now).first();if(r.count>max)fail(429,'Әрекет тым көп. Біраз уақыттан кейін қайталаңыз.');}
async function currentUser(request,db){const cookies=request.headers.get('cookie')||'',match=cookies.match(/(?:^|;\s*)(?:__Host-oqu_session|oqu_session)=([a-f0-9]{64})(?:;|$)/);if(!match)return null;const user=await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>?').bind(await digest(match[1]),Date.now()).first();return user?.role==='student'&&!corporateEmail(user.login)?null:user;}
const cookieName=request=>new URL(request.url).protocol==='https:'?'__Host-oqu_session':'oqu_session';
async function createSession(request,db,u){const token=random();await db.prepare('INSERT INTO sessions (hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token),u.id,Date.now()+SESSION_AGE).run();return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_AGE/1000}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
function canTalk(u,peer){return u.id!==peer.id&&(u.role!=='student'||['teacher','admin'].includes(peer.role))&&(peer.role!=='student'||['teacher','admin'].includes(u.role));}
async function peerUser(db,u,peerId){if(typeof peerId!=='string')fail(400,'Алушыны таңдаңыз.');const peer=await db.prepare('SELECT id,login,name,role,group_id,teacher_id FROM users WHERE id=?').bind(peerId).first();if(!peer||!canTalk(u,peer))fail(403,'Бұл пайдаланушымен хат алмасуға рұқсат жоқ.');return peer;}
function notice(db,userId,kind,title,text,peerId=null){return db.prepare('INSERT INTO notifications (id,user_id,kind,title,body,peer_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(id(),userId,kind,title,text,peerId,Date.now());}
export const corporateEmail=login=>typeof login==='string'&&login.length<=254&&/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@college-narxoz\.kz$/.test(login)&&!login.includes('..');
function checkCredentials(b){
 const login=String(b.login||'').trim().toLowerCase(),name=String(b.name||'').trim(),password=b.password;
 if(b.role==='student'&&!corporateEmail(login))fail(400,'Тек @college-narxoz.kz корпоративтік поштасын енгізіңіз.','login');
 if(b.role!=='student'&&!corporateEmail(login)&&!/^[a-z0-9._-]{3,32}$/.test(login))fail(400,'Логин: 3–32 латын әрпі, сан, нүкте, сызықша немесе корпоративтік пошта.','login');
 if(!name||name.length>100)fail(400,'Аты-жөніңізді енгізіңіз (100 таңбаға дейін).','name');
 if(typeof password!=='string'||password.length<10||password.length>128)fail(400,'Құпиясөз 10–128 таңбадан тұруы керек.','password');
 return {login,name,password};
}
export async function handleApi(request,env){
 try{
  const db=env.DB;if(!db)fail(503,'Дерекқор әзірге қолжетімсіз.');if(!env.AUTH_SECRET||env.AUTH_SECRET.length<32)fail(503,'Сервердің кіру баптауы аяқталмаған.');
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),method=request.method;
  if(!['GET','POST','PUT'].includes(method))fail(405,'Әдіске рұқсат жоқ.');
  if(method!=='GET'){if(request.headers.get('x-oqu-request')!=='1')fail(403,'Сұрау расталмады.');const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail(403,'Басқа сайттан сұрауға рұқсат жоқ.');}
  if(['/api/admin-recovery/info','/api/admin-recovery/reset'].includes(path)&&method==='POST'){
   const b=await body(request),now=Date.now();
   await rate(db,'admin-recovery:'+await digest(env.AUTH_SECRET+(request.headers.get('cf-connecting-ip')||'local')),10,600000);
   const expires=Number(env.ADMIN_RECOVERY_EXPIRES_AT);
   if(!env.ADMIN_RECOVERY_TOKEN_HASH||!env.ADMIN_RECOVERY_USER_ID||!env.ADMIN_RECOVERY_PASSWORD_HASH||!Number.isSafeInteger(expires)||expires<=now||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||!equal(await digest(b.token),env.ADMIN_RECOVERY_TOKEN_HASH))fail(410,'Қалпына келтіру сілтемесі жарамсыз немесе мерзімі аяқталған.');
   const admin=await db.prepare("SELECT id,login,name,password FROM users WHERE id=? AND role='admin' AND password=?").bind(env.ADMIN_RECOVERY_USER_ID,env.ADMIN_RECOVERY_PASSWORD_HASH).first();
   if(!admin)fail(410,'Қалпына келтіру сілтемесі пайдаланылған немесе жарамсыз.');
   if(path==='/api/admin-recovery/info')return json({login:admin.login,name:admin.name});
   if(typeof b.next!=='string'||b.next.length<10||b.next.length>128)fail(400,'Жаңа құпиясөз 10–128 таңбадан тұруы керек.','next');
   const hash=await passwordHash(b.next,env.AUTH_SECRET);
   const result=await db.batch([
    db.prepare("UPDATE users SET password=? WHERE id=? AND role='admin' AND password=?").bind(hash,admin.id,admin.password),
    db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)').bind(admin.id,admin.id,hash),
    db.prepare('INSERT INTO notifications (id,user_id,kind,title,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)').bind(id(),admin.id,'account','Әкімші құпиясөзі жаңартылды','Жеке қалпына келтіру сілтемесі пайдаланылды. Бұрынғы сеанстар жабылды.',now,admin.id,hash)
   ]);
   if(!result[0].meta.changes)fail(410,'Сілтеме пайдаланылған. Кіру бетін ашыңыз.');
   return json({ok:true,login:admin.login});
  }
  if(!env.DISABLE_SOURCE_IMPORT){try{await ensureSourceImport(db);}catch(error){console.error('Schedule source import pending:',error.message);}}
  if(path==='/api/config'&&method==='GET'){const admin=await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();const {data}=await loadState(db);return json({setupRequired:!admin,groups:data.groups.map(g=>({id:g.id,name:g.name}))});}
  if(path==='/api/register'&&method==='POST'){
   const b=await body(request),{login,name,password}=checkCredentials(b);const ip=request.headers.get('cf-connecting-ip')||'local';await rate(db,'register:'+await digest(env.AUTH_SECRET+ip),12,3600000);
   const mode=b.role;if(!['student','teacher','admin'].includes(mode))fail(400,'Рөлді таңдаңыз.');const {data}=await loadState(db);let groupId=null,teacherId=null,invite=null;
   if(mode==='admin'){if(!env.SETUP_CODE||!equal(await digest(String(b.code||'')),await digest(env.SETUP_CODE)))fail(403,'Бастапқы тіркеу коды дұрыс емес.');if(await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first())fail(403,'Әкімші тіркелген. Кіру бетін пайдаланыңыз.');}
   if(mode==='teacher'){invite=await db.prepare('SELECT * FROM invitations WHERE hash=? AND used_by IS NULL AND expires_at>?').bind(await digest(String(b.code||'')),Date.now()).first();if(!invite||!data.teachers.some(t=>t.id===invite.teacher_id))fail(403,'Шақыру коды жарамсыз немесе мерзімі аяқталған.');teacherId=invite.teacher_id;if(await db.prepare("SELECT id FROM users WHERE teacher_id=? AND role='teacher'").bind(teacherId).first())fail(409,'Оқытушының кабинеті бұрын тіркелген.');}
   if(mode==='student'){if(!data.groups.some(g=>g.id===b.groupId))fail(400,'Оқу тобын таңдаңыз.','groupId');groupId=b.groupId;}
   const userId=id(),hash=await passwordHash(password,env.AUTH_SECRET);let result;
   const admins=mode==='admin'?[]:(await db.prepare("SELECT id FROM users WHERE role='admin'").all()).results;
   const registrationNotices=admins.map(a=>notice(db,a.id,'registration','Жаңа пайдаланушы тіркелді',`${name} · ${login} · ${mode==='student'?'Оқушы':'Оқытушы'}${groupId?' · '+data.groups.find(g=>g.id===groupId).name:''}`));
   try{if(invite){result=await db.batch([db.prepare('INSERT INTO users (id,login,name,role,group_id,teacher_id,password,settings,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE hash=? AND used_by IS NULL AND expires_at>?)').bind(userId,login,name,mode,groupId,teacherId,hash,'{}',Date.now(),invite.hash,Date.now()),db.prepare('UPDATE invitations SET used_by=? WHERE hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)').bind(userId,invite.hash,userId),...registrationNotices]);if(!result[0].meta.changes)fail(409,'Шақыру коды пайдаланылған.');}else await db.batch([db.prepare('INSERT INTO users (id,login,name,role,group_id,teacher_id,password,settings,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(userId,login,name,mode,groupId,teacherId,hash,'{}',Date.now()),...registrationNotices]);}catch(e){if(e instanceof ApiError)throw e;if(String(e.message).includes('UNIQUE'))fail(409,'Бұл пошта, логин немесе кабинет бұрын тіркелген.','login');throw e;}
   const u=await db.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();return json({user:publicUser(u)},201,{'set-cookie':await createSession(request,db,u)});
  }
  if(path==='/api/login'&&method==='POST'){
   const b=await body(request);const login=String(b.login||'').trim().toLowerCase(),password=typeof b.password==='string'?b.password:'';if(login.length>254||password.length>128)fail(400,'Логин немесе құпиясөз дұрыс емес.');await rate(db,'login-name:'+await digest(login),12,600000);await rate(db,'login-ip:'+await digest(env.AUTH_SECRET+(request.headers.get('cf-connecting-ip')||'local')),35,600000);
   const u=await db.prepare('SELECT * FROM users WHERE login=?').bind(login).first();const ok=u?await verify(password,u.password,env.AUTH_SECRET):(await passwordHash(password,env.AUTH_SECRET,'00000000000000000000000000000000'),false);if(!ok)fail(401,'Пошта/логин немесе құпиясөз дұрыс емес. Енгізілген деректерді тексеріңіз.');if(u.role==='student'&&!corporateEmail(u.login))fail(403,'Оқушы тек корпоративтік поштамен кіреді. Бұрынғы аккаунтыңызға пошта қосу үшін әкімшіге хабарласыңыз.','login');return json({user:publicUser(u)},200,{'set-cookie':await createSession(request,db,u)});
  }
  const u=await currentUser(request,db);
  if(path==='/api/me'&&method==='GET')return json({user:u?publicUser(u):null});
  if(!u)fail(401,'Жалғастыру үшін кіріңіз.');
  if(path==='/api/logout'&&method==='POST'){const cookies=request.headers.get('cookie')||'',token=cookies.match(/(?:^|;\s*)(?:__Host-oqu_session|oqu_session)=([a-f0-9]{64})/)?.[1];if(token)await db.prepare('DELETE FROM sessions WHERE hash=?').bind(await digest(token)).run();return json({ok:true},200,{'set-cookie':`${cookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});}
  if(path==='/api/password'&&method==='POST'){const b=await body(request);await rate(db,'password:'+u.id,8,600000);if(typeof b.current!=='string'||!(await verify(b.current,u.password,env.AUTH_SECRET)))fail(400,'Қазіргі құпиясөз дұрыс емес.','current');if(typeof b.next!=='string'||b.next.length<10||b.next.length>128)fail(400,'Жаңа құпиясөз: 10–128 таңба.','next');const hash=await passwordHash(b.next,env.AUTH_SECRET);await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(hash,u.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]);return json({ok:true},200,{'set-cookie':await createSession(request,db,u)});}
  if(path==='/api/reset-password'&&method==='POST'){
   if(u.role!=='admin')fail(403,'Құпиясөзді тек әкімші қалпына келтіреді.');const b=await body(request);await rate(db,'reset:'+u.id,10,600000);if(typeof b.current!=='string'||!(await verify(b.current,u.password,env.AUTH_SECRET)))fail(403,'Әкімшінің құпиясөзі дұрыс емес.','current');if(typeof b.next!=='string'||b.next.length<10||b.next.length>128)fail(400,'Жаңа құпиясөз: 10–128 таңба.','next');const target=await db.prepare('SELECT id,role FROM users WHERE id=?').bind(String(b.userId||'')).first();if(!target||target.role==='admin')fail(400,'Оқушыны немесе оқытушыны таңдаңыз.');await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(await passwordHash(b.next,env.AUTH_SECRET),target.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id),notice(db,target.id,'account','Құпиясөз жаңартылды','Әкімші құпиясөзіңізді қалпына келтірді. Жеке кабинетте оны өзгертіңіз.')]);return json({ok:true});
  }
  if(path==='/api/student-email'&&method==='POST'){
   if(u.role!=='admin')fail(403,'Поштаны тек әкімші байланыстырады.');const b=await body(request);await rate(db,'student-email:'+u.id,10,600000);
   if(typeof b.current!=='string'||!(await verify(b.current,u.password,env.AUTH_SECRET)))fail(403,'Әкімшінің құпиясөзі дұрыс емес.','current');
   const login=String(b.login||'').trim().toLowerCase();if(!corporateEmail(login))fail(400,'Тек @college-narxoz.kz корпоративтік поштасын енгізіңіз.','login');
   const target=await db.prepare('SELECT id,role FROM users WHERE id=?').bind(String(b.userId||'')).first();if(!target||target.role!=='student')fail(400,'Оқушыны таңдаңыз.','userId');
   try{await db.batch([db.prepare('UPDATE users SET login=? WHERE id=?').bind(login,target.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id),notice(db,target.id,'account','Корпоративтік пошта байланыстырылды',`Енді ${login} поштасымен және бұрынғы құпиясөзіңізбен кіріңіз.`)]);}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'Бұл пошта басқа аккаунтта тіркелген.','login');throw e;}return json({ok:true});
  }
  if(path==='/api/data'&&method==='GET')return json(await userData(db,u));
  if(path==='/api/data'&&method==='PUT'){
   if(!['teacher','admin'].includes(u.role))fail(403,'Кестені тек оқытушы өзгерте алады.');const b=await body(request),d=b.data;if(!valid(d)||!Number.isSafeInteger(b.revision))fail(400,'Кесте деректері жарамсыз немесе сабақтар қиылысады.');const previous=await loadState(db);if(previous.revision!==b.revision)fail(409,'Басқа оқытушы кестені өзгертті. Бетті жаңартып, қайта енгізіңіз.');
   const accountGroups=await db.prepare("SELECT DISTINCT group_id FROM users WHERE role='student'").all();if(accountGroups.results.some(x=>!d.groups.some(g=>g.id===x.group_id)))fail(400,'Оқушы тіркелген топты жоюға болмайды.');const teacherAccounts=await db.prepare("SELECT teacher_id FROM users WHERE role='teacher'").all();if(teacherAccounts.results.some(x=>x.teacher_id&&!d.teachers.some(t=>t.id===x.teacher_id)))fail(400,'Кабинеті бар оқытушыны жоюға болмайды.');
   const completed=d.tasks.filter(t=>t.done).map(t=>t.id),settings=d.settings;const clean={...d,tasks:d.tasks.map(t=>({...t,done:false})),settings:emptyState().settings,demo:false};
   await db.prepare('INSERT OR IGNORE INTO school_state (id,json,revision) VALUES (1,?,0)').bind(JSON.stringify(emptyState())).run();
   const update=await db.prepare('UPDATE school_state SET json=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(clean),b.revision).run();if(!update.meta.changes)fail(409,'Кесте өзгерді. Бетті жаңартыңыз.');
   const ops=[db.prepare('UPDATE users SET settings=? WHERE id=?').bind(JSON.stringify(settings),u.id),db.prepare('DELETE FROM completions WHERE user_id=?').bind(u.id),...completed.map(t=>db.prepare('INSERT INTO completions (id,user_id,task_id) VALUES (?,?,?)').bind(id(),u.id,t))];await db.batch(ops);
   const changedSchedule=JSON.stringify(previous.data.schedule)!==JSON.stringify(clean.schedule),changedTasks=JSON.stringify(previous.data.tasks)!==JSON.stringify(clean.tasks);
   if(changedSchedule||changedTasks){const students=await db.prepare("SELECT id,group_id FROM users WHERE role='student'").all();const notices=students.results.filter(s=>{const own=x=>x.filter(t=>t.groups===s.group_id);return JSON.stringify(own(previous.data.schedule))!==JSON.stringify(own(clean.schedule))||JSON.stringify(own(previous.data.tasks))!==JSON.stringify(own(clean.tasks));}).map(s=>notice(db,s.id,'school','Оқу жоспары жаңартылды',`${u.name} сабақ кестесін немесе үй тапсырмаларын өзгертті.`));for(let i=0;i<notices.length;i+=80)await db.batch(notices.slice(i,i+80));}
   const fresh=await db.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first();return json(await userData(db,fresh));
  }
  if(path==='/api/progress'&&method==='POST'){
   const b=await body(request),{data}=await userData(db,u);if(!Array.isArray(b.completed)||b.completed.length>5000||!b.completed.every(t=>data.tasks.some(x=>x.id===t))||new Set(b.completed).size!==b.completed.length||!settingsValid(b.settings,data.groups.map(g=>g.id)))fail(400,'Тапсырма күйі немесе баптау жарамсыз.');
   await db.batch([db.prepare('UPDATE users SET settings=? WHERE id=?').bind(JSON.stringify(b.settings),u.id),db.prepare('DELETE FROM completions WHERE user_id=?').bind(u.id),...b.completed.map(t=>db.prepare('INSERT INTO completions (id,user_id,task_id) VALUES (?,?,?)').bind(id(),u.id,t))]);return json(await userData(db,{...u,settings:JSON.stringify(b.settings)}));
  }
  if(path==='/api/people'&&method==='GET'){const people=await db.prepare('SELECT id,login,name,role,group_id,teacher_id FROM users WHERE id<>? ORDER BY name LIMIT 500').bind(u.id).all();return json({people:people.results.filter(p=>canTalk(u,p)).map(publicUser)});}
  if(path==='/api/messages'&&method==='GET'){
   const peer=await peerUser(db,u,url.searchParams.get('peer'));const before=Number(url.searchParams.get('before')||Date.now()+1);if(!Number.isSafeInteger(before))fail(400,'Күн жарамсыз.');const rows=await db.prepare('SELECT id,sender_id,recipient_id,body,created_at,read_at FROM messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND created_at<? ORDER BY created_at DESC,id DESC LIMIT 51').bind(u.id,peer.id,peer.id,u.id,before).all();
   return json({peer:publicUser(peer),messages:rows.results.slice(0,50).reverse(),hasMore:rows.results.length>50});
  }
  if(path==='/api/messages/read'&&method==='POST'){const b=await body(request),peer=await peerUser(db,u,b.peer);const now=Date.now();await db.batch([db.prepare('UPDATE messages SET read_at=? WHERE sender_id=? AND recipient_id=? AND read_at IS NULL').bind(now,peer.id,u.id),db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND peer_id=? AND kind=? AND read_at IS NULL').bind(now,u.id,peer.id,'message')]);return json({ok:true});}
  if(path==='/api/messages'&&method==='POST'){
   const b=await body(request),peer=await peerUser(db,u,b.peer);const text=String(b.text||'').trim();if(!text||text.length>3000)fail(400,'Хабарлама 1–3000 таңбадан тұруы керек.');await rate(db,'messages:'+u.id,40,60000);const messageId=id(),now=Date.now();await db.batch([db.prepare('INSERT INTO messages (id,sender_id,recipient_id,body,created_at) VALUES (?,?,?,?,?)').bind(messageId,u.id,peer.id,text,now),notice(db,peer.id,'message',u.name,text.slice(0,150),u.id)]);return json({ok:true,id:messageId},201);
  }
  if(path==='/api/notifications'&&method==='GET'){const rows=await db.prepare('SELECT id,kind,title,body,peer_id,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 80').bind(u.id).all();const c=await db.prepare('SELECT count(*) as n FROM notifications WHERE user_id=? AND read_at IS NULL').bind(u.id).first();return json({notifications:rows.results,unread:c.n});}
  if(path==='/api/notifications/read'&&method==='POST'){const b=await body(request);if(b.id==='all')await db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(Date.now(),u.id).run();else if(typeof b.id==='string')await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').bind(Date.now(),b.id,u.id).run();else fail(400,'Хабарламаны таңдаңыз.');return json({ok:true});}
  if(path==='/api/invite'&&method==='POST'){if(u.role!=='admin')fail(403,'Шақыруды тек әкімші жасайды.');const b=await body(request),{data}=await loadState(db);if(!data.teachers.some(t=>t.id===b.teacherId))fail(400,'Алдымен оқытушыны анықтамалыққа қосыңыз.');if(await db.prepare("SELECT id FROM users WHERE teacher_id=? AND role='teacher'").bind(b.teacherId).first())fail(409,'Бұл оқытушы тіркелген.');const token=random(),expiresAt=Date.now()+7*86400000;await db.prepare('INSERT INTO invitations (hash,teacher_id,created_by,expires_at) VALUES (?,?,?,?)').bind(await digest(token),b.teacherId,u.id,expiresAt).run();return json({code:token,expiresAt});}
  fail(404,'Сұрау табылмады.');
 }catch(e){if(e instanceof ApiError)return json({error:e.message,...(e.field?{field:e.field}:{})},e.status);console.error('Oqu API error',e?.message);return json({error:'Сервер қатесі. Кейінірек қайталаңыз.'},500);}
}
