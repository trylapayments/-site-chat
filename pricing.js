/* Local pricing tools. They never change a real subscription. */
(() => {
  'use strict';
  const tiers = [
    { name:'Starter', price:29, seats:3, sites:1, description:'A small team. A brilliant first hello.' },
    { name:'Essential', price:49, seats:5, sites:2, description:'Your team, your sites, your own brand.' },
    { name:'Growth', price:89, seats:10, sites:3, description:'More teammates. More conversations.' },
    { name:'Business', price:199, seats:20, sites:10, description:'Your whole operation, connected.' }
  ];
  const money = (value, decimals = 0) => '$' + value.toLocaleString('en-US', { minimumFractionDigits:decimals, maximumFractionDigits:decimals });
  const seats = document.querySelector('#mp-seats');
  const sites = document.querySelector('#mp-sites');
  const fit = document.querySelector('.mp-fit');
  let yearly = false;
  let previousTier = '';
  function recommend() {
    const count = Number(seats.value), siteCount = Number(sites.value);
    const tier = tiers.find(t => t.seats >= count && t.sites >= siteCount);
    if (!tier) return;
    document.querySelector('#mp-seat-count').textContent = count;
    seats.style.setProperty('--range', ((count - 1) / 19 * 100) + '%');
    document.querySelector('[data-seat-step="-1"]').disabled = count <= 1;
    document.querySelector('[data-seat-step="1"]').disabled = count >= 20;
    const values = {
      'mp-fit-name': tier.name,
      'mp-fit-description': tier.description,
      'mp-fit-price': yearly ? money(tier.price * 10 / 12, 2) : money(tier.price),
      'mp-fit-charge': yearly ? money(tier.price * 10) + ' billed yearly · Save ' + money(tier.price * 2) + ' per year' : 'Billed monthly · Operator seats included',
      'mp-fit-period': yearly ? 'Yearly billing' : 'Monthly billing',
      'mp-fit-seats': tier.seats,
      'mp-fit-sites': tier.sites,
      'mp-fit-saving': yearly ? 'A full year, for the price of 10 months.' : 'Choose yearly and save ' + money(tier.price * 2) + ' over 12 months.'
    };
    Object.entries(values).forEach(([id, value]) => document.getElementById(id).textContent = value);
    const link = document.querySelector('#mp-fit-link');
    link.href = '#plan-' + tier.name.toLowerCase();
    link.innerHTML = 'Explore ' + tier.name + ' <span>↗</span>';
    const visual = document.querySelector('.mp-seat-visual');
    visual.replaceChildren(...Array.from({ length:tier.seats }, (_, i) => {
      const seat = document.createElement('span');
      if (i >= count) seat.className = 'is-spare';
      return seat;
    }));
    if (previousTier && previousTier !== tier.name) {
      fit.classList.remove('mp-fit-updated'); void fit.offsetWidth; fit.classList.add('mp-fit-updated');
    }
    previousTier = tier.name;
  }
  document.querySelectorAll('[data-billing]').forEach(button => button.addEventListener('click', () => {
    yearly = button.dataset.billing === 'year';
    document.querySelectorAll('[data-billing]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    document.querySelectorAll('.mp-plan').forEach(card => {
      const price = Number(card.dataset.price);
      card.querySelector('[data-price-display]').textContent = yearly ? money(price * 10 / 12, 2) : money(price);
      card.querySelector('.mp-charge-note').textContent = yearly ? money(price * 10) + ' billed yearly · Save ' + money(price * 2) : 'Billed monthly';
    });
    document.querySelectorAll('.mp-table-scroll thead th>span').forEach((el, i) => {
      el.textContent = (yearly ? money(tiers[i].price * 10 / 12, 2) : money(tiers[i].price)) + ' / month';
    });
    recommend();
  }));
  seats.addEventListener('input', recommend);
  sites.addEventListener('change', recommend);
  document.querySelectorAll('[data-seat-step]').forEach(button => button.addEventListener('click', () => {
    seats.value = Math.max(1, Math.min(20, Number(seats.value) + Number(button.dataset.seatStep)));
    recommend();
  }));
  recommend();
  document.querySelectorAll('[data-compare]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-compare]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    document.querySelectorAll('[data-compare-group]').forEach(row => row.hidden = button.dataset.compare !== 'all' && row.dataset.compareGroup !== button.dataset.compare);
  }));
  const assign = document.querySelector('#mp-assign-demo');
  let assigned = false;
  assign.addEventListener('click', () => {
    assigned = !assigned;
    assign.innerHTML = assigned ? '✓ Assigned to Sam <span>↺</span>' : 'Assign to Sam <span>↗</span>';
    assign.setAttribute('aria-pressed', String(assigned));
    document.querySelector('.mp-assign-result').textContent = assigned ? 'Sam has the conversation, note and full history.' : 'One conversation. The whole team in the loop.';
  });
  document.querySelectorAll('[data-widget-colour]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('#mp-widget-colour').style.background = button.dataset.widgetColour;
    document.querySelectorAll('[data-widget-colour]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
})();
