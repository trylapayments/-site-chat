/* Product previews are local, isolated from a customer's real workspace. */
(() => {
  'use strict';
  const widget = document.querySelector('.ds-brand-stage');
  if (widget) {
    widget.querySelectorAll('[data-ds-colour]').forEach(button => button.addEventListener('click', () => {
      widget.querySelector('.ds-widget-shell header').style.background = button.dataset.dsColour;
      widget.querySelectorAll('[data-ds-colour]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    }));
    widget.querySelectorAll('[data-ds-device]').forEach(button => button.addEventListener('click', () => {
      widget.dataset.device = button.dataset.dsDevice;
      widget.querySelectorAll('[data-ds-device]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    }));
  }
  const setup = document.querySelector('.ds-start-stage');
  if (setup) {
    const scenes = [
      ['◫','Create your workspace','Your company. Your team. One place to work.','WORKSPACE','Willow Atelier','Ready for your team'],
      ['◈','Make it feel like you','Choose your colours, greeting and launcher.','YOUR BRAND','Sage · A personal welcome','A look for desktop and mobile'],
      ['↗','Connect your website','Add your domain and install your widget.','YOUR WEBSITE','willowatelier.example','Your site goes here'],
      ['◧','Say your first hello','Send a test message. Reply from your inbox.','YOUR TEAM INBOX','Hi! Can you help me get started?','Assigned to Alex · Ready to reply']
    ];
    setup.querySelectorAll('[data-setup-step]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.setupStep), scene = scenes[index];
      const selectors = ['.ds-start-icon','.ds-start-preview h2','.ds-start-preview>p','.ds-start-record>span','.ds-start-record>strong','.ds-start-record>small'];
      selectors.forEach((selector,i) => setup.querySelector(selector).textContent = scene[i]);
      setup.querySelectorAll('[data-setup-step]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      setup.querySelectorAll('.ds-start-progress>span').forEach((bar,i) => bar.classList.toggle('active',i <= index));
    }));
  }
  const search = document.querySelector('#ds-faq-search');
  if (search) {
    let category = 'all';
    const questions = [...document.querySelectorAll('[data-faq-category]')];
    const filters = [...document.querySelectorAll('[data-faq-filter]')];
    function filter() {
      const query = search.value.trim().toLowerCase();
      let count = 0;
      questions.forEach(question => {
        const shown = (category === 'all' || question.dataset.faqCategory === category) && (!query || question.textContent.toLowerCase().includes(query));
        question.hidden = !shown;
        if (shown) count++;
      });
      document.querySelector('#ds-faq-count').textContent = count + (count === 1 ? ' question' : ' questions');
      document.querySelector('.ds-faq-empty').hidden = count !== 0;
    }
    search.addEventListener('input', filter);
    filters.forEach(button => button.addEventListener('click', () => {
      category = button.dataset.faqFilter;
      filters.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      filter();
    }));
    document.querySelector('#ds-faq-reset').addEventListener('click', () => {
      search.value = ''; category = 'all';
      filters.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.faqFilter === 'all')));
      filter();search.focus();
    });
  }
})();
