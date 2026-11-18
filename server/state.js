const CATS={groups:'Топтар',teachers:'Оқытушылар',subjects:'Пәндер',rooms:'Аудиториялар'};
const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseDate=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const timeValid=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const dayValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&dateKey(parseDate(s))===s;
const lessonTeachers=l=>l.teacherIds||[l.teachers];
const lessonWeeks=l=>l.weeks||[1,16];
export function conflict(a,b){const aw=lessonWeeks(a),bw=lessonWeeks(b);return a.day===b.day&&Math.max(aw[0],bw[0])<=Math.min(aw[1],bw[1])&&minute(a.start)<minute(b.end)&&minute(b.start)<minute(a.end)&&(a.groups===b.groups||a.rooms===b.rooms||lessonTeachers(a).some(t=>lessonTeachers(b).includes(t)));}
export const emptyState=()=>({version:2,groups:[],teachers:[],subjects:[],rooms:[],schedule:[],tasks:[],settings:{enabled:false,lead:10,evening:'20:00',sound:true,group:''},demo:false});
export function valid(d){
 if(!d||d.version!==2||!Object.keys(CATS).every(k=>Array.isArray(d[k]))||!Array.isArray(d.schedule)||!Array.isArray(d.tasks)||d.schedule.length>3000||d.tasks.length>5000)return false;
 for(const k of Object.keys(CATS)){if(d[k].length>1000||d[k].some(x=>!x||typeof x.id!=='string'||!x.id||x.id.length>100||typeof x.name!=='string'||!x.name.trim()||x.name.length>100)||new Set(d[k].map(x=>x.id)).size!==d[k].length||new Set(d[k].map(x=>x.name.toLocaleLowerCase())).size!==d[k].length)return false;}
 const refs=(x,ks)=>ks.every(k=>d[k].some(a=>a.id===x[k]));
 if(new Set(d.schedule.map(x=>x?.id)).size!==d.schedule.length||new Set(d.tasks.map(x=>x?.id)).size!==d.tasks.length)return false;
 for(const l of d.schedule)if(!l||typeof l.id!=='string'||!Number.isInteger(l.day)||l.day<0||l.day>4||!timeValid(l.start)||!timeValid(l.end)||minute(l.start)>=minute(l.end)||!refs(l,Object.keys(CATS))||(l.weeks!==undefined&&(!Array.isArray(l.weeks)||l.weeks.length!==2||!l.weeks.every(n=>Number.isInteger(n)&&n>=1&&n<=16)||l.weeks[0]>l.weeks[1]))||(l.teacherIds!==undefined&&(!Array.isArray(l.teacherIds)||!l.teacherIds.length||!l.teacherIds.includes(l.teachers)||new Set(l.teacherIds).size!==l.teacherIds.length||l.teacherIds.some(id=>!d.teachers.some(t=>t.id===id)))))return false;
 for(const t of d.tasks)if(!t||typeof t.id!=='string'||!refs(t,['groups','subjects','teachers'])||typeof t.text!=='string'||!t.text.trim()||t.text.length>2000||!dayValid(t.due)||typeof t.done!=='boolean')return false;
 const s=d.settings;if(!s||typeof s.enabled!=='boolean'||typeof s.sound!=='boolean'||![5,10,15,30,60].includes(s.lead)||!timeValid(s.evening)||typeof s.group!=='string'||(s.group&&!d.groups.some(g=>g.id===s.group)))return false;
 return !d.schedule.some((a,i)=>d.schedule.slice(i+1).some(b=>conflict(a,b)));
}
