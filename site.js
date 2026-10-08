document.querySelectorAll('[data-interval]').forEach(button=>button.addEventListener('click',()=>{const annual=button.dataset.interval==='year';document.querySelectorAll('[data-interval]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-monthly]').forEach(p=>{const monthly=Number(p.dataset.monthly);p.innerHTML=annual?`$${(monthly*10/12).toFixed(2)} <small>/ month</small>`:`$${monthly} <small>/ month</small>`;p.closest('.plan').querySelector('.charge-note').textContent=annual?`$${(monthly*10).toLocaleString('en-US')} billed yearly`:'Billed monthly';});}));
const triggers=document.querySelectorAll('.nav-trigger');
function closeMenus(){triggers.forEach(t=>{t.setAttribute('aria-expanded','false');document.getElementById(t.getAttribute('aria-controls')).hidden=true})}
triggers.forEach(t=>t.addEventListener('click',()=>{const open=t.getAttribute('aria-expanded')!=='true';closeMenus();t.setAttribute('aria-expanded',String(open));document.getElementById(t.getAttribute('aria-controls')).hidden=!open}));
document.addEventListener('click',e=>{if(!e.target.closest('.nav-group'))closeMenus()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});
document.querySelectorAll('[data-colour]').forEach(b=>b.addEventListener('click',()=>{document.getElementById('lab-header').style.background=b.dataset.colour;document.querySelectorAll('[data-colour]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)))}));
document.getElementById('widget-title')?.addEventListener('input',e=>document.getElementById('lab-title').textContent=e.target.value||'How can we help?');
document.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>{document.getElementById('demo-reply').textContent=b.dataset.demo==='delivery'?'Demo reply: Happy to help. Tell us a little about your delivery question.':'Demo reply: Of course. What can we help you with today?'}));

// Product choreography is decorative; it never changes real customer data.
const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
const motionButton=document.querySelector('.motion-toggle');
let motionPaused=false;
const productAnimations=[];
function syncMotion(){
 const paused=motionPaused||motionPreference.matches||document.hidden;
 productAnimations.forEach(a=>{if(paused){if(motionPaused&&a.effect.getTiming().duration===12000)a.currentTime=8000;a.pause()}else a.play()});
 document.body.classList.toggle('motion-paused',paused);
}
function animateProduct(el,frames,options){if(!el)return;const a=el.animate(frames,options);productAnimations.push(a);return a;}
const chat=document.querySelector('.animated-chat');
if(chat){
 const messages=chat.querySelectorAll('.bubble');
 animateProduct(messages[0],[{opacity:0,transform:'translateY(12px) scale(.96)',offset:0},{opacity:1,transform:'none',offset:.09},{opacity:1,transform:'none',offset:.94},{opacity:0,transform:'translateY(-3px)',offset:1}],{duration:12000,iterations:Infinity});
 animateProduct(messages[1],[{opacity:0,transform:'translateY(10px) scale(.96)',offset:0},{opacity:0,transform:'translateY(10px) scale(.96)',offset:.24},{opacity:1,transform:'none',offset:.32},{opacity:1,transform:'none',offset:.94},{opacity:0,transform:'translateY(-3px)',offset:1}],{duration:12000,iterations:Infinity});
 animateProduct(chat.querySelector('.typing-indicator'),[{opacity:0,offset:0},{opacity:0,offset:.12},{opacity:1,offset:.14},{opacity:1,offset:.24},{opacity:0,offset:.28},{opacity:0,offset:1}],{duration:12000,iterations:Infinity});
 chat.querySelectorAll('.typing-indicator i').forEach((dot,i)=>animateProduct(dot,[{transform:'translateY(0)'},{transform:'translateY(-3px)'},{transform:'translateY(0)'}],{duration:700,delay:i*130,iterations:Infinity}));
 animateProduct(document.querySelector('.conversation-toast'),[{opacity:0,transform:'translateY(-8px)',offset:0},{opacity:1,transform:'none',offset:.08},{opacity:1,transform:'none',offset:.92},{opacity:0,transform:'translateY(-8px)',offset:1}],{duration:12000,iterations:Infinity});
}
// Reveal each section once, keeping content visible when JavaScript is unavailable.
const reveals=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){if(!motionPreference.matches&&!motionPaused)entry.target.animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'none'}],{duration:650,easing:'cubic-bezier(.2,.7,.2,1)'});reveals.unobserve(entry.target)}}),{threshold:.12});
document.querySelectorAll('.section-head,.feature-grid article,.inbox,.brand-demo,.link-card,.start-band').forEach(el=>reveals.observe(el));
motionButton?.addEventListener('click',()=>{motionPaused=!motionPaused;motionButton.setAttribute('aria-pressed',String(motionPaused));motionButton.setAttribute('aria-label',motionPaused?'Resume animations':'Pause animations');motionButton.textContent=motionPaused?'▶':'Ⅱ';syncMotion()});
motionPreference.addEventListener('change',()=>{if(motionPreference.matches)productAnimations.forEach(a=>a.cancel());else location.reload()});
document.addEventListener('visibilitychange',syncMotion);
if(motionPreference.matches)productAnimations.forEach(a=>a.cancel());else syncMotion();
const copilotButton=document.querySelector('.copilot-replay');
const copilotAnswer=document.querySelector('.copilot-answer');
let copilotTimer;
copilotButton?.addEventListener('click',()=>{
 clearInterval(copilotTimer);
 const reply="Of course. You can return unused items within 30 days. I can help you with the next step.";
 const result=document.querySelector('.ai-demo-result');
 if(motionPreference.matches||motionPaused){copilotAnswer.textContent=reply;result.textContent='✓ Ready for your review';return}
 let cursor=0;copilotAnswer.textContent='';result.textContent='Preparing a reply from your knowledge…';copilotButton.disabled=true;
 copilotTimer=setInterval(()=>{cursor=Math.min(cursor+3,reply.length);copilotAnswer.textContent=reply.slice(0,cursor);if(cursor===reply.length){clearInterval(copilotTimer);copilotButton.disabled=false;result.textContent='✓ Ready for your review'}},35);
});
document.querySelectorAll('[data-cart-question]').forEach(button=>button.addEventListener('click',()=>{const reply=document.querySelector('.cart-demo-reply');reply.textContent=button.dataset.cartQuestion==='delivery'?'Standard delivery takes 3–5 business days. We can help you choose the right option.':'Yes — the reading lamp has a dimmer, so you can find just the right light.';if(!motionPreference.matches&&!motionPaused)reply.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:350})}));
document.querySelectorAll('[data-brand-demo]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-brand-demo]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelector('.brand-window header').style.background=button.dataset.brandDemo;document.querySelector('.brand-launcher').style.background=button.dataset.brandDemo}));
if(!motionPreference.matches){
 document.querySelectorAll('.integration-tile').forEach((tile,i)=>animateProduct(tile,[{transform:'translateY(0)'},{transform:'translateY(-4px)'},{transform:'translateY(0)'}],{duration:4400+i*150,delay:i*230,iterations:Infinity,easing:'ease-in-out'}));
 animateProduct(document.querySelector('.signal-dot'),[{transform:'translateX(0)',opacity:0},{opacity:1,offset:.2},{transform:'translateX(35px)',opacity:0}],{duration:2600,iterations:Infinity});
 animateProduct(document.querySelector('.routing-label'),[{opacity:.4,transform:'translateY(3px)'},{opacity:1,transform:'none'},{opacity:1,transform:'none'}],{duration:4800,iterations:Infinity});
 syncMotion();
}
document.querySelectorAll('.shopping-demo,.integration-hub,.feature-stories article,.ai-motion-demo').forEach(el=>reveals.observe(el));
const film=document.querySelector('.film-window');
const filmScenes={inbox:{title:'A shared inbox that keeps everyone in step.',copy:'See who is helping, keep ownership clear and pick up with the full conversation.',action:'Conversation assigned. Your team is in the loop.',draft:'Write a reply…',icon:'✓'},context:{title:'The person, the purchase and the full picture.',copy:'See order details alongside the conversation. Help with the right context already in view.',action:'Order #JL–2048 · Reading lamp · Shipped',draft:'Your reading lamp is on its way. Let me check the tracking for you.',icon:'↗'},ai:{title:'A useful answer. Ready for your judgement.',copy:'Mill AI finds the relevant knowledge and drafts a reply for your operator to review.',action:'Mill AI · Suggested reply from your delivery policy',draft:'Your order has shipped. Standard delivery takes 3–5 business days.',icon:'✦'}};
function setFilmScene(scene){if(!film)return;film.dataset.scene=scene;document.querySelectorAll('[data-film]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.film===scene)));const data=filmScenes[scene];document.querySelector('.film-action-text').textContent=data.action;document.querySelector('.film-action-icon').textContent=data.icon;document.querySelector('.film-draft').textContent=data.draft;document.querySelector('.film-caption-title').textContent=data.title;document.querySelector('.film-caption-copy').textContent=data.copy;if(!motionPreference.matches&&!motionPaused){film.querySelector('.film-action').animate([{opacity:.1,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:480,easing:'ease-out'});film.querySelector('.film-draft').animate([{opacity:.1},{opacity:1}],{duration:650})}}
let filmTimer;let filmRunning=false;let filmIndex=0;const filmPlay=document.querySelector('.film-play');
function stopFilm(){clearInterval(filmTimer);filmRunning=false;if(filmPlay){filmPlay.textContent='▶ Play tour';filmPlay.setAttribute('aria-pressed','false');filmPlay.setAttribute('aria-label','Play product tour')}}
document.querySelectorAll('[data-film]').forEach(b=>b.addEventListener('click',()=>{stopFilm();setFilmScene(b.dataset.film)}));
filmPlay?.addEventListener('click',()=>{if(filmRunning){stopFilm();return}filmRunning=true;filmPlay.textContent='Ⅱ Pause tour';filmPlay.setAttribute('aria-label','Pause product tour');filmPlay.setAttribute('aria-pressed','true');filmIndex=0;setFilmScene('inbox');filmTimer=setInterval(()=>{if(document.hidden||motionPaused||!filmVisible)return;filmIndex=(filmIndex+1)%3;setFilmScene(['inbox','context','ai'][filmIndex])},4200)});
if(!motionPreference.matches){animateProduct(document.querySelector('.team-note'),[{opacity:.45},{opacity:1},{opacity:1}],{duration:5200,iterations:Infinity});animateProduct(document.querySelector('.purchase-toast'),[{transform:'translateY(0)'},{transform:'translateY(-5px)'},{transform:'translateY(0)'}],{duration:5500,iterations:Infinity,easing:'ease-in-out'});syncMotion()}
document.querySelectorAll('.team-media,.customer-media-photo,.film-window').forEach(el=>reveals.observe(el));
if(!motionPreference.matches){
 document.querySelectorAll('.handoff-step').forEach((step,i)=>animateProduct(step,[{backgroundColor:'#f8fbff',borderColor:'#dbe5f3',transform:'translateY(0)',offset:0},{backgroundColor:'#e7f0ff',borderColor:'#9dbef4',transform:'translateY(-3px)',offset:.3},{backgroundColor:'#e7f0ff',borderColor:'#9dbef4',transform:'translateY(-3px)',offset:.7},{backgroundColor:'#f8fbff',borderColor:'#dbe5f3',transform:'translateY(0)',offset:1}],{duration:5200,delay:i*1500,iterations:Infinity,easing:'ease-in-out'}));
 animateProduct(document.querySelector('.film-presence .dot'),[{boxShadow:'0 0 0 0 #80bc9700'},{boxShadow:'0 0 0 5px #80bc9730'},{boxShadow:'0 0 0 9px #80bc9700'}],{duration:3000,iterations:Infinity});
 syncMotion();
}

// Each visible product scene tells a short story; off-screen scenes stop advancing.
const sceneTimelines=new Map();
const scenePeriod=1800;
const copilotFullReply='Of course. You can return unused items within 30 days. I can help you with the next step.';
function renderScene(el,stage){
 el.dataset.stage=String(stage);
 const progress=el.querySelector('.scene-progress i');if(progress)progress.style.width=`${(stage+1)/6*100}%`;
 switch(el.dataset.autoScene){
 case 'knowledge':{const state=el.querySelector('.knowledge-state');state.textContent=['Your sources, in one place','Connecting approved sources','Learning from your knowledge','Finding the relevant answer','Answer ready, source included','Ready for your next customer'][stage];el.querySelectorAll('.source-status').forEach(s=>s.textContent=stage<2?'Connecting…':'Connected ✓');break}
 case 'workflow':el.querySelector('.workflow-result-text').textContent=['A new visitor starts a conversation','Question received · Checking context','AI checks your approved knowledge','A routine question answered by AI','A complex question connected to Alex','Full context shared. Ready to help.'][stage];break;
 case 'copilot':{if(copilotButton?.disabled)break;el.querySelector('.copilot-answer').textContent=stage<2?'Finding the right answer in your knowledge…':stage===2?copilotFullReply.slice(0,42):stage===3?copilotFullReply.slice(0,72):copilotFullReply;el.querySelector('.ai-demo-result').textContent=stage<4?'Preparing a reply from your knowledge…':'✓ Ready for your review';break}
 case 'shopping':el.querySelector('.cart-demo-reply').textContent=['We’re here to help you choose.','A question about your reading lamp?','Yes — the reading lamp has a dimmer.','Find just the right light for your space.','Standard delivery takes 3–5 business days.','A useful answer. A confident next step.'][stage];break;
 case 'integrations':el.querySelectorAll('.integration-tile').forEach((t,i)=>t.classList.toggle('integration-active',i===stage));break;
 case 'branding':{const colours=['#145df1','#145df1','#355b4c','#355b4c','#a35c40','#a35c40'];el.querySelector('header').style.background=colours[stage];el.querySelector('.brand-launcher').style.background=colours[stage];el.querySelectorAll('[data-brand-demo]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brandDemo===colours[stage])));break}
 case 'routing':el.querySelector('.routing-label').textContent=stage<2?'Finding the right teammate…':'Assigned to Alex ✓';break;
 case 'team':el.querySelector('.team-note').textContent=stage<2?'A new conversation needs a teammate.':stage<4?'Alex has the conversation and its history.':'✓ Context shared. Customer connected.';break;
 }
}
function stopScene(el){const state=sceneTimelines.get(el);if(state){clearInterval(state.timer);state.timer=null}}
function startScene(el){const state=sceneTimelines.get(el);if(!state||state.timer||state.localPaused||motionPreference.matches)return;renderScene(el,state.stage);state.timer=setInterval(()=>{if(motionPaused||document.hidden)return;state.stage=(state.stage+1)%6;renderScene(el,state.stage)},scenePeriod)}
const sceneVisibility=new IntersectionObserver(entries=>entries.forEach(entry=>{const state=sceneTimelines.get(entry.target);if(!state)return;state.visible=entry.isIntersecting;if(state.visible)startScene(entry.target);else stopScene(entry.target)}),{threshold:.18});
document.querySelectorAll('[data-auto-scene]').forEach(el=>{sceneTimelines.set(el,{stage:0,timer:null,visible:false,localPaused:false});if(!motionPreference.matches)sceneVisibility.observe(el);el.querySelector('.scene-pause')?.addEventListener('click',e=>{const state=sceneTimelines.get(el);state.localPaused=!state.localPaused;e.currentTarget.setAttribute('aria-pressed',String(state.localPaused));e.currentTarget.textContent=state.localPaused?'▶':'Ⅱ';e.currentTarget.setAttribute('aria-label',`${state.localPaused?'Resume':'Pause'} ${el.dataset.autoScene} animation`);if(state.localPaused){stopScene(el);renderScene(el,5)}else if(state.visible)startScene(el)})});
// A hands-on interaction takes ownership of its scene until the page reloads.
document.addEventListener('click',e=>{const control=e.target.closest('[data-brand-demo],[data-cart-question],.copilot-replay');const scene=control?.closest('[data-auto-scene]');if(scene){const state=sceneTimelines.get(scene);state.localPaused=true;stopScene(scene)}},true);
// The large product tour starts by itself once in view; users retain full control.
if(film&&!motionPreference.matches){let autoStarted=false;const tourVisibility=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting&&!autoStarted){autoStarted=true;filmPlay.click();tourVisibility.disconnect()}}),{threshold:.3});tourVisibility.observe(film)}
window.addEventListener('pagehide',()=>{sceneTimelines.forEach((state,el)=>stopScene(el));stopFilm();clearInterval(copilotTimer)});

let filmVisible=false;
if(film){const filmViewport=new IntersectionObserver(entries=>entries.forEach(entry=>filmVisible=entry.isIntersecting),{threshold:.15});filmViewport.observe(film)}
motionPreference.addEventListener('change',()=>{if(motionPreference.matches){sceneTimelines.forEach((state,el)=>{stopScene(el);renderScene(el,5)});stopFilm()}});
const pricingSeats=document.getElementById('pricing-seats');
const pricingSites=document.getElementById('pricing-sites');
function recommendPlan(){
 if(!pricingSeats||!pricingSites)return;
 const operators=Number(pricingSeats.value);const websites=Number(pricingSites.value);
 const tiers=[{name:'Starter',seats:3,sites:1,ai:0},{name:'Essential',seats:5,sites:2,ai:100},{name:'Growth',seats:10,sites:3,ai:500},{name:'Business',seats:20,sites:10,ai:1000}];
 const tier=tiers.find(t=>t.seats>=operators&&t.sites>=websites);
 document.getElementById('seat-value').textContent=String(operators);
 document.getElementById('recommended-plan').textContent=tier.name;
 document.getElementById('recommendation-detail').textContent=`${tier.seats} operators · ${tier.sites} website${tier.sites===1?'':'s'} · ${tier.ai?tier.ai.toLocaleString('en-US')+' AI conversations / month':'Human-powered live chat'}`;
 const link=document.getElementById('recommendation-link');link.textContent=`See ${tier.name} ↗`;link.setAttribute('href',`#plan-${tier.name.toLowerCase()}`);
}
pricingSeats?.addEventListener('input',recommendPlan);pricingSites?.addEventListener('change',recommendPlan);
if(!motionPreference.matches){document.querySelectorAll('.ai-allowance-row i').forEach((bar,i)=>animateProduct(bar,[{transform:'scaleX(.1)',offset:0},{transform:'scaleX(1)',offset:.18},{transform:'scaleX(1)',offset:.94},{transform:'scaleX(.1)',offset:1}],{duration:10000,delay:i*130,iterations:Infinity,easing:'ease-in-out'}));syncMotion()}
document.querySelectorAll('.pricing-seat-card,.plan,.plan-finder,.pricing-ai-visual,.pricing-value-grid article').forEach(el=>reveals.observe(el));

// Compact, useful navigation through long product pages.
const sectionTitles=[...document.querySelectorAll('main h2')].filter(h=>h.closest('section')&&!h.closest('.start-band'));
if(sectionTitles.length>2){
 const jump=document.createElement('nav');jump.className='section-jump';jump.setAttribute('aria-label','On this page');
 sectionTitles.slice(0,6).forEach((h,i)=>{const section=h.closest('section');if(!section.id)section.id='explore-section-'+i;const a=document.createElement('a');a.href='#'+section.id;a.textContent=h.innerText.replace(/\s+/g,' ').trim();jump.append(a)});
 const intro=document.querySelector('main>.hero,main>.page-intro');if(intro)intro.insertAdjacentElement('afterend',jump);
}
const pageProgress=document.createElement('div');pageProgress.className='page-progress';pageProgress.setAttribute('aria-hidden','true');document.body.append(pageProgress);
function updatePageProgress(){const max=document.documentElement.scrollHeight-innerHeight;pageProgress.style.transform='scaleX('+(max>0?scrollY/max:0)+')'}
addEventListener('scroll',updatePageProgress,{passive:true});addEventListener('resize',updatePageProgress);updatePageProgress();
// A local product demonstration of chat, private notes and team handover.
document.querySelectorAll('.teamwork-demo').forEach((section,index)=>{
 const buttons=[...section.querySelectorAll('[data-teamwork]')];
 const panel=section.querySelector('.teamwork-window');
 const scenes=[
  {person:'Alex',initials:'AL',status:'Reply delivered',caption:'A personal reply, right where the customer needs it.',reply:'Hi Emma! I can help with that. Let me check the delivery options for your order.',note:false,handover:false},
  {person:'Alex',initials:'AL',status:'Private note added',caption:'Your team sees the note. Your customer only sees the conversation.',reply:'Hi Emma! I can help with that. Let me check the delivery options for your order.',note:true,handover:false},
  {person:'Sam',initials:'SM',status:'Assigned to Sam',caption:'The next teammate gets the full history. No starting from scratch.',reply:'Hi Emma, I’m Sam. Alex shared the details with me — let’s find the best delivery option for you.',note:true,handover:true}
 ];
 panel.id='teamwork-panel-'+index;panel.setAttribute('role','tabpanel');
 function select(button){
  const step=Number(button.dataset.teamwork),scene=scenes[step];
  buttons.forEach(b=>{const active=b===button;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1});
  panel.setAttribute('aria-labelledby',button.id);section.dataset.step=String(step);
  panel.querySelector('.teamwork-owner-name').textContent=scene.person;
  panel.querySelector('.teamwork-owner-avatar').textContent=scene.initials;
  panel.querySelector('.teamwork-reply-author').textContent=scene.person+' · Customer care';
  panel.querySelector('.teamwork-reply-text').textContent=scene.reply;
  panel.querySelector('.teamwork-note').hidden=!scene.note;
  panel.querySelector('.teamwork-handoff').hidden=!scene.handover;
  panel.querySelector('.teamwork-status').textContent='✓ '+scene.status;
  section.querySelector('.teamwork-caption').textContent=scene.caption;
  panel.classList.remove('teamwork-changed');void panel.offsetWidth;panel.classList.add('teamwork-changed');
 }
 buttons.forEach((button,i)=>{
  button.id='teamwork-tab-'+index+'-'+i;button.setAttribute('aria-controls',panel.id);
  button.addEventListener('click',()=>select(button));
  button.addEventListener('keydown',e=>{
   if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
   e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+buttons.length)%buttons.length;
   buttons[next].focus();select(buttons[next]);
  });
 });
 select(buttons[0]);
});
const labStories={
 ai:[['When will my order arrive?','Standard delivery takes 3–5 business days. I can help you track your order.','Answered from your delivery policy'],['Can I return an unused item?','Yes. Your returns policy allows unused items to be returned within 30 days.','Source: Returns policy'],['Could I speak to someone?','Of course. I’ll pass the conversation and its context to your team.','Assigned to an operator']],
 assist:[['A customer asks about a return.','Suggested reply: Of course — you can return an unused item within 30 days. I can help you with the next step.','Draft ready for operator review'],['Make my reply warmer.','Happy to help! Let’s take a look together and find the best next step for you.','Operator stays in control'],['Summarise this conversation.','Customer asked about delivery and returns. Delivery information shared. A return request needs operator follow-up.','Summary ready']],
 knowledge:[['What are your delivery times?','Standard delivery takes 3–5 business days.','Source: Connected website'],['What does the product warranty cover?','I found the warranty information in your approved product document.','Source: Product documentation'],['How do I get started?','Your getting-started article explains the next steps. I can guide you through them.','Source: Help centre']],
 inbox:[['Can you help me choose?','Of course, Emma. Tell me a little about what you’re looking for, and we’ll find the right fit.','Alex · Reply delivered'],['Could you check the delivery options?','Absolutely. I’ve left a note for Sam with your order details so we can check that together.','Private note added · Only your team'],['Can someone help me with delivery?','Hi Emma, Sam here. I have the details from Alex — no need to start again. Let’s check your delivery.','Assigned to Sam · Full history included']],
 context:[['Can you help with my account?','Emma is a returning visitor. Her previous conversations are available alongside the reply.','Customer profile available'],['Where is my order?','Your order context is beside the conversation, so the team can check it before replying.','Order details in view'],['I was looking at your product page.','Your team can see the page behind the question and reply with the right context.','Visited pages in view']],
 sites:[['Willow Atelier — can you help me choose?','Welcome to Willow Atelier. Let’s find the right piece for your home.','Willow · Sage brand · Store knowledge'],['Northline Studio — can we discuss a project?','Welcome to Northline. Tell us a little about your project.','Northline · Blue brand · Service knowledge'],['Harbour Software — how do I get started?','Welcome to Harbour. I can help you find the next step.','Harbour · Navy brand · Product knowledge']],
 chat:[['Hi! Can someone help?','Of course. Your conversation is ready for the team.','Visitor connected'],['I have a picture to share.','You can share your file right in the conversation, so the operator can see the details.','File shared with the team'],['Thanks for your help.','You’re welcome. Would you like a copy of the conversation?','Closed · Rating & transcript available']],
 commerce:[['When will it arrive?','Standard delivery takes 3–5 business days.','Delivery policy'],['Can you help me choose the right size?','Tell me what you’re looking for, and I’ll help with the product information.','Product context available'],['Can you check my order?','Your team can review the order context and help with the next step.','Order context passed to operator']],
 services:[['I’d like to ask about your services.','Welcome. Tell us what you need, and we’ll help you find the right next step.','New enquiry'],['Can I arrange a consultation?','Your team can help arrange a suitable time and keep the details in this conversation.','Consultation enquiry'],['This needs a specialist.','I’ll pass your question and its context to the right person.','Team handover']],
 software:[['How do I get started?','I can guide you through the first steps using your approved getting-started content.','Knowledge-based answer'],['I have an account question.','Let’s get your question to the team with the account context alongside it.','Customer context available'],['I need technical help.','Your conversation and the details you shared will reach an operator together.','Technical support handover']]
};
document.querySelectorAll('[data-lab]').forEach(lab=>{
 const stories=labStories[lab.dataset.lab]||labStories.inbox;const tabs=[...lab.querySelectorAll('[role=tab]')];let selected=0;let timer;
 const thread=lab.querySelector('.lab-thread');const detail=lab.querySelector('.lab-detail');const status=lab.querySelector('.lab-status');const run=lab.querySelector('.lab-run');
 function render(play=false){clearTimeout(timer);run.disabled=false;run.firstChild.textContent='Play scenario ';thread.replaceChildren();const [question,answer,event]=stories[selected];const incoming=document.createElement('div');incoming.className='lab-incoming';incoming.textContent=question;thread.append(incoming);detail.textContent=event;
 const finish=()=>{thread.querySelector('.lab-dots')?.remove();const reply=document.createElement('div');reply.className='lab-outgoing'+(lab.dataset.lab==='assist'?' assist':'');reply.textContent=answer;thread.append(reply);const note=document.createElement('div');note.className='lab-event';note.textContent=event;thread.append(note);thread.classList.add('animate');run.disabled=false;run.firstChild.textContent='Replay scenario ';status.lastChild.textContent=' '+event};
 thread.classList.remove('animate');if(play){const dots=document.createElement('div');dots.className='lab-dots';dots.textContent='•••';thread.append(dots);run.disabled=true;run.firstChild.textContent='Playing… ';timer=setTimeout(finish,900)}else finish();
 }
 tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>{selected=index;tabs.forEach(t=>t.setAttribute('aria-selected',String(t===tab)));render(true)});tab.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click()}})});run.addEventListener('click',()=>render(true));render();
});
document.querySelectorAll('.human-tech-section').forEach(section=>{section.querySelectorAll('[data-collaboration]').forEach(button=>button.addEventListener('click',()=>{
 const human=button.dataset.collaboration==='human';section.dataset.mode=human?'human':'ai';section.querySelectorAll('[data-collaboration]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 section.querySelector('.human-tech-card strong').textContent=human?'Alex · Customer care':'Mill AI';section.querySelector('.human-tech-card small').textContent=human?'Conversation context received':'Connected to your knowledge';section.querySelector('.human-tech-answer').textContent=human?'Hi Emma, I have the details from your conversation. Let’s take a look together.':'I found the answer in your delivery policy. Standard delivery takes 3–5 business days.';section.querySelector('.human-tech-result').textContent=human?'✓ Assigned to Alex':'✓ Answer ready';section.querySelector('.human-tech-description').textContent=human?'Your operator receives the conversation and its context, ready to help personally.':'Mill AI finds an answer in your approved knowledge. Your team stays in control.';
}))});
