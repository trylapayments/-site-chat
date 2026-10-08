/* Interactive marketing scenes: local demonstrations, with no external writes. */
(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const text = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = value; };
  const link = (selector, title, href) => { const el = document.querySelector(selector); if (el) { el.textContent = title; el.href = href; } };
  const replay = (el) => { if (!el || reducedMotion.matches) return; el.classList.remove('mx-enter'); void el.offsetWidth; el.classList.add('mx-enter'); };
  const motionAllowed = () => !document.hidden && !reducedMotion.matches && !document.body.classList.contains('motion-paused') && !document.querySelector('dialog[open]');
  function accessibleTabs(tabs, panel, onSelect) {
    if (!tabs.length || !panel) return;
    panel.id ||= `${tabs[0].dataset.platform ? 'platform' : tabs[0].dataset.build ? 'build' : 'business'}-panel`;
    panel.setAttribute('role', 'tabpanel');
    tabs.forEach((tab, i) => {
      tab.id ||= `${panel.id}-tab-${i}`;
      tab.setAttribute('aria-controls', panel.id);
      tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
      if (tab.tabIndex === 0) panel.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => onSelect(tab, true));
      tab.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + direction + tabs.length) % tabs.length;
        tabs[next].focus(); tabs[next].click();
      });
    });
  }
  function selectTab(tabs, tab, panel) {
    tabs.forEach(t => { const chosen = t === tab; t.setAttribute('aria-selected', String(chosen)); t.tabIndex = chosen ? 0 : -1; });
    panel.setAttribute('aria-labelledby', tab.id);
  }

  const platform = document.querySelector('.mx-command');
  if (platform) {
    const tabs = [...platform.querySelectorAll('[data-platform]')];
    const panel = platform.querySelector('.mx-command-body');
    const answer = platform.querySelector('.mx-engine-answer');
    const pauseButton = platform.querySelector('.mx-cycle');
    let selected = 'chat', question = 'delivery', paused = reducedMotion.matches, visible = false;
    const scenes = {
      chat: { kicker: 'A WARMER WELCOME', title: 'A real conversation.\nRight on your website.', label: 'Alex · Customer care', source: ['Live chat · Delivery question', 'Live chat · Return question'], answer: ['Hi Emma! Standard delivery takes 3–5 business days. Where is it going? Let’s find the best option for you.', 'Of course, Emma. Unused items can be returned within 30 days. I can help you with the next step.'], status: '✓ Delivered · Your customer is connected', teamTitle: 'Be there when it matters.', teamText: 'Messages, files and voice notes. Everything your customer needs to ask a better question.', link: 'Explore live chat ↗', href: '/features/live-chat' },
      team: { kicker: 'YOUR PEOPLE, CONNECTED', title: 'One shared inbox.\nA personal answer.', label: 'Alex · Customer care', source: ['Delivery context received', 'Return context received'], answer: ['Hi Emma, I have your delivery question and the details you shared. Let’s check the best option together.', 'Hi Emma, I can help with your return. I have the conversation here, so there’s no need to start again.'], status: '✓ Assigned to Alex · Context included', teamTitle: 'The right person. In the loop.', teamText: 'Shared ownership, internal notes and conversation history. Give your team the full picture.', link: 'Explore the team inbox ↗', href: '/features/team-inbox' },
      context: { kicker: 'SEE THE PERSON BEHIND THE MESSAGE', title: 'More context.\nLess back and forth.', label: 'Customer context', source: ['Returning customer · Delivery page', 'Returning customer · Order details'], answer: ['Emma is visiting your delivery page. Her previous conversations and store context are right beside your reply.', 'Emma has a question about her order. Her customer profile and conversation history help your team pick up the thread.'], status: '✓ Customer profile · Page history · Connected tools', teamTitle: 'Start with the full picture.', teamText: 'Know who you’re helping and what they need. Keep useful customer information beside every conversation.', link: 'Explore customer context ↗', href: '/features/customer-context' },
      workflow: { kicker: 'YOUR WORKFLOW, CONNECTED', title: 'The right conversation.\nThe right teammate.', label: 'Conversation workflow', source: ['Route: Delivery question', 'Route: Return request'], answer: ['A delivery question arrives → your team is notified → an available operator takes ownership with the customer context in view.', 'A return request arrives → your support team receives it → the operator has the conversation and order context together.'], status: '✓ Your rules · Your team · One flow', teamTitle: 'A clear next step.', teamText: 'Connect your tools and route useful context to the people who can move things forward.', link: 'Explore connected workflows ↗', href: '/integrations?category=Automation' }
    };
    function updatePause() {
      pauseButton?.setAttribute('aria-pressed', String(paused));
      pauseButton?.setAttribute('aria-label', paused ? 'Play platform animation' : 'Pause platform animation');
      if (pauseButton) pauseButton.textContent = paused ? '▶' : 'Ⅱ';
      platform.dataset.paused = String(paused);
    }
    function render(userAction = false) {
      const scene = scenes[selected], q = question === 'returns' ? 1 : 0;
      selectTab(tabs, tabs.find(t => t.dataset.platform === selected), panel);
      answer.setAttribute('aria-live', userAction ? 'polite' : 'off');
      text('#mx-engine-kicker', scene.kicker); text('#mx-engine-title', scene.title);
      text('#mx-answer-label', scene.label); text('#mx-answer-source', scene.source[q]);
      text('#mx-answer-text', scene.answer[q]); text('#mx-answer-status', scene.status);
      text('#mx-team-title', scene.teamTitle); text('#mx-team-text', scene.teamText);
      link('#mx-engine-link', scene.link, scene.href);
      platform.dataset.scene = selected;
      if (userAction) { paused = true; updatePause(); }
      replay(answer);
    }
    accessibleTabs(tabs, panel, (tab, user) => { selected = tab.dataset.platform; render(user); });
    platform.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => {
      question = button.dataset.question;
      platform.querySelectorAll('[data-question]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      render(true);
    }));
    pauseButton?.addEventListener('click', () => { paused = !paused; updatePause(); });
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }, { threshold: .35 }).observe(platform);
    setInterval(() => {
      if (!visible || paused || !motionAllowed() || platform.matches(':hover') || platform.contains(document.activeElement)) return;
      selected = tabs[(tabs.findIndex(t => t.dataset.platform === selected) + 1) % tabs.length].dataset.platform;
      render();
    }, 8500);
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { paused = true; updatePause(); } });
    updatePause(); render();
  }

  const builder = document.querySelector('.mx-build');
  if (builder) {
    const tabs = [...builder.querySelectorAll('[data-build]')];
    const stage = builder.querySelector('.mx-build-stage');
    const body = builder.querySelector('.mx-stage-body');
    let step = 0;
    const stories = [
      { label: '01 / YOUR BRAND', title: 'One workspace.\nMade to feel like you.', sources: [['W','Willow Atelier','Sage · Online store ✓'],['N','Northline Studio','Cobalt · Services ✓'],['H','Harbour Software','Navy · Software ✓']], result: 'Your brand. Every conversation.', detail: 'Individual widgets and rules. One shared team inbox.' },
      { label: '02 / YOUR TEAM', title: 'Shared work.\nA personal touch.', sources: [['◉','Alex · Support','Available to help ✓'],['◉','Sam · Success','Customer context ✓'],['◫','Team inbox','Everyone in the loop ✓']], result: 'Every conversation has a clear owner.', detail: 'Assignments, internal notes and availability, together.' },
      { label: '03 / YOUR TOOLS', title: 'The tools you love.\nAll in the conversation.', sources: [['S','Shopify','Store context ✓'],['S','Salesforce','Customer relationships ✓'],['S','Slack','Your team connected ✓']], result: 'More context. Less switching between tabs.', detail: 'Your customers, store and team, working better together.' }
    ];
    function render(tab, user = true) {
      step = Number(tab.dataset.build); const data = stories[step];
      selectTab(tabs, tab, stage);
      text('.mx-stage-label', data.label); text('.mx-stage-title', data.title);
      body.querySelectorAll('.mx-stage-sources>div').forEach((el, i) => {
        el.querySelector('b').textContent = data.sources[i][0]; el.querySelector('strong').textContent = data.sources[i][1]; el.querySelector('span').textContent = data.sources[i][2];
      });
      text('.mx-stage-result', data.result); text('.mx-stage-detail', data.detail);
      stage.querySelector('.mx-stage-progress i').style.transform = `translateX(${step * 100}%)`;
      if (user) replay(body);
    }
    accessibleTabs(tabs, stage, render);
    builder.querySelector('.mx-build-replay').addEventListener('click', () => render(tabs[(step + 1) % tabs.length]));
    builder.querySelector('.mx-build-replay').setAttribute('aria-label', 'Next workspace setup step');
  }

  const business = document.querySelector('.mx-usecases');
  if (business) {
    const tabs = [...business.querySelectorAll('[data-business]')];
    const stage = business.querySelector('.mx-business-stage');
    const scenarios = {
      store: { eyebrow: 'MILL FOR COMMERCE', title: 'Turn a little uncertainty\ninto a confident next step.', description: 'Help shoppers understand products, find delivery details and get personal help when they need it.', question: '“Can you help me choose the right one?”', answer: 'Of course. Tell me what you’re looking for, and we’ll find a good fit.', note: 'A question before checkout?', noteCopy: 'Your team has the product context to help.', image: 'customer-shopping.webp', alt: 'Customer receiving help while shopping online', link: 'Explore Mill for online stores ↗', href: '/solutions/ecommerce' },
      software: { eyebrow: 'MILL FOR SOFTWARE TEAMS', title: 'Help users move from\n“how?” to “got it.”', description: 'Make onboarding feel easier. Connect your product knowledge and give technical questions a clear path to your team.', question: '“How do I invite my team?”', answer: 'Open your team settings, choose Invite, and add their email addresses. I can walk you through it.', note: 'An easier first day.', noteCopy: 'Product knowledge, right where users need it.', image: 'team-collaboration.webp', alt: 'Software team collaborating at a laptop', link: 'Explore Mill for software teams ↗', href: '/solutions/software' },
      services: { eyebrow: 'MILL FOR PROFESSIONAL SERVICES', title: 'Start the relationship.\nMake the next step simple.', description: 'Understand what a visitor needs, bring the right specialist into the conversation and keep every enquiry in view.', question: '“Can I speak with someone about a project?”', answer: 'Absolutely. Tell us a little about what you have in mind, and we’ll connect you with the right person.', note: 'From enquiry to connection.', noteCopy: 'Your team has the context to help personally.', image: 'customer-care-hero.webp', alt: 'Professional ready to help with a customer enquiry', link: 'Explore Mill for professional services ↗', href: '/solutions/services' }
    };
    accessibleTabs(tabs, stage, tab => {
      const data = scenarios[tab.dataset.business];
      selectTab(tabs, tab, stage);
      for (const name of ['eyebrow','title','description','question','answer','note']) text(`#mx-business-${name}`, data[name]);
      text('#mx-business-note-copy', data.noteCopy);
      const image = stage.querySelector('.mx-business-photo>img'); image.src = `/assets/${data.image}`; image.alt = data.alt;
      link('#mx-business-link', data.link, data.href); replay(stage);
    });
  }

  const integrations = window.MILL_INTEGRATIONS || [];
  if (integrations.length) {
    const dialog = document.createElement('dialog');
    dialog.className = 'mx-dialog'; dialog.setAttribute('aria-labelledby', 'mx-integration-title');
    dialog.innerHTML = '<div class="mx-dialog-head"><button class="mx-dialog-close" aria-label="Close integration details">×</button><span class="mx-dialog-category"></span><div class="mx-dialog-brand"><span class="mx-app-logo"><img alt="" width="32" height="32"></span><b></b></div><h2 id="mx-integration-title"></h2></div><div class="mx-dialog-body"><p></p><ul></ul><div class="mx-dialog-links"><a class="button" href="https://app.mill.chat/signup">Start Free Trial ↗</a><a href="/product">Explore Mill ↗</a></div><small>14 days free · No credit card required</small></div>';
    document.body.append(dialog);
    let opener;
    const close = () => dialog.close();
    dialog.querySelector('.mx-dialog-close').addEventListener('click', close);
    dialog.addEventListener('click', e => { if (e.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) close(); } });
    dialog.addEventListener('close', () => { document.body.classList.remove('mx-modal-open'); opener?.focus({ preventScroll: true }); });
    document.querySelectorAll('[data-integration]').forEach(button => {
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        const data = integrations.find(item => item.id === button.dataset.integration); if (!data) return;
        opener = button;
        dialog.querySelector('.mx-dialog-category').textContent = `${data.category} integration`;
        dialog.querySelector('.mx-dialog-brand b').textContent = data.name;
        dialog.querySelector('.mx-dialog-brand img').src = `/assets/integrations/${data.id}.svg`;
        dialog.querySelector('h2').textContent = `${data.name}, meet Mill.`;
        dialog.querySelector('.mx-dialog-body>p').textContent = data.description;
        const list = dialog.querySelector('ul'); list.replaceChildren();
        data.features.forEach(feature => { const li = document.createElement('li'); li.textContent = feature; list.append(li); });
        document.body.classList.add('mx-modal-open'); dialog.showModal();
      });
    });
  }
  const search = document.querySelector('#mx-integration-search');
  if (search) {
    const filters = [...document.querySelectorAll('[data-filter]')];
    const cards = [...document.querySelectorAll('.mx-directory-grid [data-integration]')];
    const empty = document.querySelector('.mx-integration-empty');
    const params = new URLSearchParams(location.search);
    const requested = params.get('category');
    search.value = (params.get('search') || '').slice(0, 100);
    let category = filters.some(f => f.dataset.filter === requested) ? requested : 'All';
    function filter() {
      const query = search.value.trim().toLocaleLowerCase(); let count = 0;
      cards.forEach(card => {
        const data = integrations.find(item => item.id === card.dataset.integration);
        const match = (category === 'All' || data.category === category) && `${data.name} ${data.category} ${data.description}`.toLocaleLowerCase().includes(query);
        card.hidden = !match; if (match) count++;
      });
      filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === category)));
      text('#mx-integration-count', `${count} integration${count === 1 ? '' : 's'}`); empty.hidden = count > 0;
    }
    filters.forEach(button => button.addEventListener('click', () => { category = button.dataset.filter; filter(); }));
    search.addEventListener('input', filter);
    document.querySelector('#mx-reset-integrations').addEventListener('click', () => { category = 'All'; search.value = ''; filter(); search.focus(); });
    filter();
  }
})();

/* Try the visitor experience directly in the hero. All replies stay in this demo. */
(() => {
  const card = document.querySelector('.mx-live-card');
  if (!card) return;
  const thread = card.querySelector('.mx-live-thread');
  const form = card.querySelector('.mx-live-form');
  const input = form.querySelector('input');
  const send = form.querySelector('button');
  const suggestions = [...card.querySelectorAll('[data-chat-prompt]')];
  const handover = card.querySelector('#mx-live-human');
  let timer, busy = false, operator = 'Alex · Mill team';
  const initial = thread.innerHTML;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function setBusy(value) {
    busy = value; send.disabled = value; suggestions.forEach(b => b.disabled = value); handover.disabled = value;
  }
  function addMessage(message, who, href, linkLabel) {
    const row = document.createElement('div'); row.className = `mx-live-message mx-live-${who}`;
    const label = document.createElement('span'); label.textContent = who === 'visitor' ? 'You' : operator;
    const bubble = document.createElement('p'); bubble.textContent = message;
    if (href) { bubble.append(document.createElement('br')); const a = document.createElement('a'); a.href = href; a.textContent = linkLabel; bubble.append(a); }
    row.append(label, bubble); thread.append(row);
    while (thread.children.length > 8) thread.firstElementChild.remove();
    thread.scrollTop = thread.scrollHeight;
  }
  function respond(message) {
    const q = message.toLocaleLowerCase();
    if (/trial|free|try|проб|бесплат/.test(q)) return ['You can try Mill free for 14 days. No credit card required — just bring your team and start a conversation.', '/pricing', 'Explore the plans ↗'];
    if (/\b20\b|\b199\b|business|enterprise|large/.test(q)) return ['Business includes 20 operators and 10 websites for $199 per month. Your team can manage different brands together in one workspace.', '/pricing#plan-business', 'See Business ↗'];
    if (/\b10\b|\b89\b|growth/.test(q)) return ['Growth gives you 10 operators and 3 websites for $89 per month. A shared inbox keeps your team and customer conversations connected.', '/pricing#plan-growth', 'See Growth ↗'];
    if (/\b5\b|\b49\b|essential/.test(q)) return ['Essential is a good fit: 5 operators, 2 websites and your own widget branding for $49 per month.', '/pricing#plan-essential', 'See Essential ↗'];
    if (/\b[123]\b|\b29\b|starter|small|solo/.test(q)) return ['Starter includes 3 operators and 1 website for $29 per month. You get live chat and a shared team inbox, with Powered by Mill branding.', '/pricing#plan-starter', 'See Starter ↗'];
    if (/widget|brand|colour|color|custom|mobile|виджет|бренд/.test(q)) return ['Absolutely. Choose your colours, greeting and launcher, with separate looks for desktop and mobile. Each website can have its own branding and rules.', '/features/widget', 'Try the widget customiser ↗'];
    if (/integrat|shopify|slack|salesforce|wordpress|интегра/.test(q)) return ['Keep your website, store and customer tools close to the conversation. Explore connections for Shopify, Salesforce, Slack and more.', '/integrations', 'Browse integrations ↗'];
    if (/\bai\b|automat|artificial|ии|искусствен/.test(q)) return ['Mill AI helps alongside your team — with reply suggestions, summaries and answers from your knowledge. You choose how it supports your conversations.', '/ai', 'Explore Mill AI ↗'];
    if (/year|annual|год/.test(q)) return ['Annual billing gives you 12 months for the price of 10: Starter $290, Essential $490, Growth $890 and Business $1,990 per year.', '/pricing', 'Compare billing options ↗'];
    if (/team|operator|inbox|assign|команд|оператор/.test(q)) return ['Your team shares one inbox. Assign conversations, add internal notes and hand over with the full history, so customers don’t have to repeat themselves.', '/features/team-inbox', 'See the team inbox ↗'];
    if (/price|plan|cost|pay|тариф|цен/.test(q)) return ['Plans start at $29 per month for 3 operators. Essential is $49, Growth $89 and Business $199. How many people will be replying to customers?', '/pricing', 'Compare all plans ↗'];
    if (/thank|спасибо/.test(q)) return ['You’re welcome! Try another question, explore a feature or start your 14-day free trial.'];
    if (/hello|hi\b|hey|привет|здравств/.test(q)) return ['Hi there! Welcome to the Mill chat preview. Ask about plans, your team, widget customisation or integrations.'];
    return ['Explore plans, team inbox, widget customisation or integrations — or see how a handover works.'];
  }
  function conversation(message, transfer = false) {
    if (busy || !message.trim()) return;
    addMessage(message.trim(), 'visitor'); setBusy(true);
    const dots = document.createElement('div'); dots.className = 'mx-live-message mx-live-assistant mx-live-typing'; dots.setAttribute('aria-label', 'Preparing a demo reply'); dots.innerHTML = '<p aria-hidden="true"><i></i><i></i><i></i></p>'; thread.append(dots); thread.scrollTop = thread.scrollHeight;
    const finish = () => {
      dots.remove();
      if (transfer) {
        operator = operator.startsWith('Alex') ? 'Sam · Customer success' : 'Alex · Mill team';
        card.querySelector('#mx-live-agent').textContent = operator;
        card.querySelector('#mx-live-status').innerHTML = '<i></i> Online · Conversation received';
        card.dataset.human = 'true';
        addMessage('Hi! I have the conversation and everything you’ve shared. No need to start again — what can I help you with?', 'assistant');
      } else addMessage(...[respond(message)[0], 'assistant', ...respond(message).slice(1)]);
      setBusy(false);
    };
    timer = setTimeout(finish, reduced.matches || document.body.classList.contains('motion-paused') ? 0 : 650);
  }
  suggestions.forEach(button => button.addEventListener('click', () => conversation(button.dataset.chatPrompt)));
  form.addEventListener('submit', e => { e.preventDefault(); if (busy || !input.value.trim()) return; const message = input.value; input.value = ''; conversation(message); });
  handover.addEventListener('click', () => conversation('Could you connect me with another teammate?', true));
  card.querySelector('.mx-live-reset').addEventListener('click', () => {
    clearTimeout(timer); thread.innerHTML = initial; operator = 'Alex · Mill team'; card.querySelector('#mx-live-agent').textContent = operator; card.querySelector('#mx-live-status').innerHTML = '<i></i> Online · Here to help'; delete card.dataset.human; input.value = ''; setBusy(false); thread.scrollTop = 0;
  });
})();
