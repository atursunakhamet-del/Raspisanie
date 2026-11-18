import source from './data/bq331332.js';
import { emptyState, valid } from './state.js';
const groupKey=s=>s.toUpperCase().replace(/[\s–—-]/g,'');
const nameKey=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function mergeSourceSchedule(current){
 const data=structuredClone(current),targetIds=new Set();
 function catalog(kind,label){let entry=data[kind].find(x=>nameKey(x.name)===nameKey(label));
  if(!entry&&kind==='groups')entry=data.groups.find(x=>groupKey(x.name)===groupKey(label));
  if(!entry&&kind==='teachers'&&label==='Аида Толеген')entry=data.teachers.find(x=>['аида тулеген','аида толеген'].includes(nameKey(x.name)));
  if(!entry){entry={id:crypto.randomUUID(),name:label};data[kind].push(entry);}else if(kind==='teachers'&&label==='Аида Толеген')entry.name=label;
  if(kind==='groups')entry.course=3;return entry.id;
 }
 const groups=new Map(source.groups.map(g=>[g,catalog('groups',g)]));for(const id of groups.values())targetIds.add(id);
 data.schedule=data.schedule.filter(l=>!targetIds.has(l.groups));
 for(const [index,record] of source.records.entries()){
  const teacherIds=record.teacherNames.map(t=>catalog('teachers',t));
  data.schedule.push({id:`bq-source-${record.group.slice(-3)}-${record.cell}-${index}`,groups:groups.get(record.group),subjects:catalog('subjects',record.subject),teachers:teacherIds[0],teacherIds,rooms:catalog('rooms',record.room),day:record.day,start:record.start,end:record.end,weeks:record.weeks,source:{file:source.file,sheet:source.sheet,cell:record.cell,subject:record.sourceSubject,teachers:record.sourceTeachers},...(teacherIds.length>1?{note:'Кестеде екі оқытушы көрсетілген.'}:{})});
 }
 data.demo=false;if(!valid(data))throw Error('Source import conflicts with the existing timetable.');return {data,targetIds:[...targetIds]};
}
// Application-data import, separate from schema-only SQL migrations. The durable marker
// makes this a one-time operation, so later manual edits are never overwritten.
export async function ensureSourceImport(db){
 if(await db.prepare('SELECT id FROM data_imports WHERE id=?').bind(source.id).first())return;
 for(let attempt=0;attempt<3;attempt++){
  const row=await db.prepare('SELECT json,revision FROM school_state WHERE id=1').first();const previous=row?JSON.parse(row.json):emptyState(),revision=row?.revision||0;
  const {data,targetIds}=mergeSourceSchedule(previous),payload=JSON.stringify(data),now=Date.now();
  const students=await db.prepare("SELECT id,group_id FROM users WHERE role='student'").all();
  const notices=students.results.filter(u=>targetIds.includes(u.group_id)).map(u=>db.prepare('INSERT OR IGNORE INTO notifications (id,user_id,kind,title,body,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM data_imports WHERE id=?)').bind(source.id+'-'+u.id,u.id,'school','Сабақ кестесі жаңартылды','БҚ-331 және БҚ-332 топтарының пәндері, оқытушылары және уақыттары қосылды.',now,source.id));
  const result=await db.batch([
   db.prepare('INSERT OR IGNORE INTO school_state (id,json,revision) VALUES (1,?,0)').bind(JSON.stringify(emptyState())),
   db.prepare('UPDATE school_state SET json=?,revision=revision+1 WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM data_imports WHERE id=?)').bind(payload,revision,source.id),
   db.prepare('INSERT OR IGNORE INTO data_imports (id,backup_json,backup_revision,applied_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM school_state WHERE id=1 AND revision=? AND json=?)').bind(source.id,JSON.stringify(previous),revision,now,revision+1,payload),
   ...notices
  ]);
  if(result[1].meta.changes||await db.prepare('SELECT id FROM data_imports WHERE id=?').bind(source.id).first())return;
 }
 throw Error('Source import deferred because the timetable is being edited.');
}
