/* Runs the REAL Code.gs against the fake Google services, exercising the
   whole team flow the way 15 people would actually hit it. */
const fs = require('fs');
function mkStore(){ const s={}; return {
  getItem:k=>k in s?s[k]:null, setItem:(k,v)=>{s[k]=String(v)}, removeItem:k=>{delete s[k]} }; }
global.localStorage = mkStore(); global.sessionStorage = mkStore();
global.location = { href:'https://script.google.com/macros/s/FAKE/exec' };
global.window = global;
eval(fs.readFileSync(__dirname + '/../fake-google.js','utf8'));
eval(fs.readFileSync(__dirname + '/../Code.gs','utf8'));

let pass=0, fail=[];
const ck=(n,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  ok?pass++:fail.push(`${n}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  console.log((ok?'  ok  ':'  FAIL')+' '+n); };
const ckT=(n,c)=>ck(n,!!c,true);
const throws=(n,fn,frag)=>{ let m=null; try{fn()}catch(e){m=e.message}
  const ok=m&&(!frag||m.includes(frag));
  ok?pass++:fail.push(`${n}: expected throw${frag?' ~"'+frag+'"':''}, got ${m===null?'no throw':'"'+m+'"'}`);
  console.log((ok?'  ok  ':'  FAIL')+` ${n} → "${m}"`); };

console.log('\n— setup & identity —');
ck('empty app needs setup', api(null,'state').setupNeeded, true);
const setup = api(null,'setup',{name:'Rahul', company:'5 Circles'});
ckT('founder created', setup.ok && setup.token);
ckT('founder gets a 4-digit PIN', /^\d{4}$/.test(setup.pin));
const RAHUL = setup.token;
ck('founder is Admin', setup.me.role, 'Admin');
ck('second setup refused', api(null,'setup',{name:'Imposter'}).error, 'Already set up. Sign in instead.');
ck('login screen hides roles', Object.keys(api(null,'state').people[0]).sort(), ['id','name']);

console.log('\n— building a team of 15 —');
const team = {};
const names = ['Priya','Aman','Neha','Vikas','Sana','Rohit','Kavya','Arjun','Meera','Dev','Isha','Karan','Tara','Nikhil'];
names.forEach(n=>{ const r=api(RAHUL,'addPerson',{name:n, dept:'Ops', role:'Member'});
  if(!r.ok) fail.push('addPerson '+n+': '+r.error); else team[n]={id:r.person.id, pin:r.pin}; });
ck('team size is 15', api(RAHUL,'pull',{}).people.length, 15);
ckT('each new member gets their own PIN', Object.values(team).every(p=>/^\d{4}$/.test(p.pin)));

const priyaLogin = api(null,'login',{personId:team.Priya.id, pin:team.Priya.pin});
ckT('member signs in with name + PIN', priyaLogin.ok && priyaLogin.token);
const PRIYA = priyaLogin.token;
ck('member is not admin', priyaLogin.me.role, 'Member');
ck('wrong PIN refused', api(null,'login',{personId:team.Aman.id, pin:'0000'}).ok, false);

console.log('\n— PIN lockout —');
for(let i=0;i<4;i++) api(null,'login',{personId:team.Aman.id, pin:'1111'});
const locked = api(null,'login',{personId:team.Aman.id, pin:team.Aman.pin});
ck('locked out after 5 wrong PINs', locked.ok, false);
ckT('lockout message explains the wait', /minute|locked/i.test(locked.error||''));

console.log('\n— permissions —');
ck('member cannot add people', api(PRIYA,'addPerson',{name:'Ghost'}).ok, false);
ck('member cannot reset PINs', api(PRIYA,'resetPin',{personId:team.Neha.id}).ok, false);
ck('member cannot remove people', api(PRIYA,'removePerson',{personId:team.Neha.id}).ok, false);
ck('bad token rejected', api('not-a-token','pull',{}).auth, false);

console.log('\n— tasks —');
const t1 = api(RAHUL,'createTask',{title:'Call the printer about Saturday banners', ownerId:team.Priya.id, due:'2026-09-04'});
ckT('founder assigns a task', t1.ok);
let st = api(PRIYA,'pull',{});
ck('task visible to everyone', st.tasks.length, 1);
ck('task records who gave it', st.tasks[0].by_id, setup.me.id);
ckT('owner can move it', api(PRIYA,'setStatus',{taskId:t1.taskId, status:'Doing'}).ok);
ck('status changed', api(RAHUL,'pull',{}).tasks[0].status, 'Doing');
ckT('owner can raise stuck', api(PRIYA,'toggleStuck',{taskId:t1.taskId, stuck:true, note:'vendor not answering'}).ok);
ck('stuck is visible company-wide', api(RAHUL,'pull',{}).tasks[0].stuck, true);
const t2 = api(PRIYA,'createTask',{title:'My own task', ownerId:team.Priya.id, due:'2026-09-02'});
ckT('member can create own task', t2.ok);
throws('task needs a title', ()=>createTask({id:setup.me.id,name:'R',role:'Admin'},{title:'  ', ownerId:team.Priya.id}));

console.log('\n— content —');
const c1 = api(PRIYA,'addContent',{topic:'Theta: the rent you pay to hold hope', account:'5 Circles', format:'Reel', date:'2026-09-01'});
ckT('post added', c1.ok);
ck('starts at Idea', api(RAHUL,'pull',{}).content[0].stage, 'Idea');
ckT('stage advances', api(RAHUL,'setStage',{id:c1.id, stage:'Shoot'}).ok);
ck('stage saved', api(PRIYA,'pull',{}).content[0].stage, 'Shoot');
ck('bad stage refused', api(RAHUL,'setStage',{id:c1.id, stage:'Whatever'}).ok, false);
ck('bad account refused', api(RAHUL,'addContent',{topic:'x', account:'LinkedIn', format:'Reel', date:'2026-09-01'}).ok, false);
ck('bad date refused', api(RAHUL,'addContent',{topic:'x', account:'Rahul', format:'Reel', date:'next tuesday'}).ok, false);

console.log('\n— leads —');
const l1 = api(PRIYA,'addLead',{name:'Aman Verma', phone:'98765 43210', source:'Ad', program:'Options Lab', next:'2026-09-01'});
ckT('lead logged', l1.ok);
ck('lead starts New', api(RAHUL,'pull',{}).leads[0].status, 'New');
ckT('lead added-date stamped by server', /^\d{4}-\d{2}-\d{2}$/.test(api(RAHUL,'pull',{}).leads[0].added));
ckT('status moves', api(PRIYA,'setLeadStatus',{id:l1.id, status:'Interested', next:'2026-09-05'}).ok);
ck('follow-up kept', api(RAHUL,'pull',{}).leads[0].next, '2026-09-05');
api(PRIYA,'setLeadStatus',{id:l1.id, status:'Joined'});
ck('joined lead stops chasing', api(RAHUL,'pull',{}).leads[0].next, '');
ck('invalid status refused', api(PRIYA,'setLeadStatus',{id:l1.id, status:'Maybe'}).ok, false);

console.log('\n— day close —');
const d1 = api(PRIYA,'addClose',{done:'Called 6 leads, 2 booked', stuck:'', tomorrow:'Finish the reel'});
ckT('close filed', d1.ok && d1.replaced===false);
ck('one row', api(RAHUL,'pull',{}).closes.length, 1);
const d2 = api(PRIYA,'addClose',{done:'Called 8 leads, 3 booked', stuck:'Need mic fixed', tomorrow:'Finish the reel'});
ck('same-day refile edits, never duplicates', d2.replaced, true);
ck('still one row for the day', api(RAHUL,'pull',{}).closes.length, 1);
ck('latest text kept', api(RAHUL,'pull',{}).closes[0].done, 'Called 8 leads, 3 booked');
const notices = api(RAHUL,'pull',{}).messages.filter(m=>m.kind==='notice' && /is stuck/.test(m.text));
ckT('a blocker in a close raises a flare to the team', notices.length===1);
ck('close needs content', api(PRIYA,'addClose',{done:'   '}).ok, false);
ck('server sets the date, not the phone', api(RAHUL,'pull',{}).closes[0].date, todayISO());

console.log('\n— communication —');
const m1 = api(PRIYA,'send',{toId:'', text:'Banners are printed', kind:'chat'});
ckT('team message posts', m1.ok);
const m2 = api(RAHUL,'send',{toId:team.Priya.id, text:'Please confirm by 6pm', kind:'ring'});
ckT('founder can ring a person', m2.ok);
const forPriya = api(PRIYA,'pull',{}).messages.filter(m=>m.kind==='ring' && m.to_id===team.Priya.id);
ck('ring reaches that person', forPriya.length, 1);
ckT('ring can be answered', api(PRIYA,'ack',{messageId:forPriya[0].id, text:'confirmed'}).ok);
const acked = api(RAHUL,'pull',{}).messages.find(m=>m.id===forPriya[0].id);
ck('founder sees the answer', acked.acks.length, 1);
const cm = api(PRIYA,'send',{toId:'', text:'printer says Tuesday', kind:'chat', taskId:t1.taskId});
ckT('comment attaches to a task', cm.ok);
const thread = api(RAHUL,'pull',{}).messages.filter(m=>m.task_id===t1.taskId);
ckT('the task keeps a full thread (assignment + comments)', thread.length >= 2);
ckT('the comment is in the thread', thread.some(m=>m.text==='printer says Tuesday'));

console.log('\n— transparency —');
const founderView = api(RAHUL,'pull',{});
const memberView  = api(PRIYA,'pull',{});
ck('everyone sees the same tasks', memberView.tasks.length, founderView.tasks.length);
ck('everyone sees the same leads', memberView.leads.length, founderView.leads.length);
ck('everyone sees the same closes', memberView.closes.length, founderView.closes.length);
ckT('only admin gets the raw sheet link', founderView.sheetUrl !== '' && memberView.sheetUrl === '');
ckT('no PIN hash ever leaves the server',
  !JSON.stringify(founderView).includes('pin_hash') && !/"salt"/.test(JSON.stringify(founderView)));

console.log('\n— polling is cheap —');
const v = api(RAHUL,'pull',{}).v;
const again = api(RAHUL,'pull',{since:v});
ckT('unchanged poll short-circuits', again.unchanged === true);
ckT('presence still travels on an idle poll', !!again.seen);
api(PRIYA,'createTask',{title:'something new', ownerId:team.Priya.id, due:'2026-09-09'});
ckT('a change busts the version', api(RAHUL,'pull',{since:v}).unchanged !== true);

console.log('\n— leaving the team —');
const openBefore = api(RAHUL,'pull',{}).tasks.filter(t=>t.owner_id===team.Priya.id && t.status!=='Done').length;
ckT('Priya has open work', openBefore > 0);
const rm = api(RAHUL,'removePerson',{personId:team.Priya.id});
ckT('founder can remove a member', rm.ok);
const after = api(RAHUL,'pull',{});
ck('their open work is not orphaned', after.tasks.filter(t=>t.owner_id===team.Priya.id && t.status!=='Done').length, 0);
ck('their day close stays on the record', after.closes.length, 1);
ck('removed member cannot act', api(PRIYA,'pull',{}).auth, false);
throws('last admin cannot be removed', ()=>removePerson({id:setup.me.id,role:'Admin',name:'Rahul'},{personId:setup.me.id}));

console.log('\n— a Sheets hiccup must not wipe the team —');
window.FAKE_OPEN_FAILS = true;
const hiccup = api(RAHUL,'pull',{});
ck('outage surfaces as an error, not a fresh empty app', hiccup.ok, false);
window.FAKE_OPEN_FAILS = false;
const post = api(RAHUL,'pull',{});
ck('everyone still on the roster after the outage', post.people.length, 15);
ck('and the removed member is marked inactive, not erased', post.people.filter(p=>p.active).length, 14);

console.log(`\n${pass} passed, ${fail.length} failed`);
if(fail.length){ console.log('\nFAILURES:\n'+fail.join('\n')); process.exit(1); }
