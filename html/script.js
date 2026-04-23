// Mobile menu toggle
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav');

if (burger && nav) {
  burger.addEventListener('click', () => {
    const expanded = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!expanded));
    nav.classList.toggle('nav--open');
  });
}

// Smooth-close mobile nav after clicking a link
document.querySelectorAll('.nav__link').forEach((link) => {
  link.addEventListener('click', () => {
    if (nav?.classList.contains('nav--open')) {
      nav.classList.remove('nav--open');
      burger?.setAttribute('aria-expanded', 'false');
    }
  });
});

// Subtle parallax for the hero mascot
const mascot = document.querySelector('.hero__mascot');
if (mascot && window.matchMedia('(hover: hover)').matches) {
  const heroVisual = document.querySelector('.hero__visual');
  heroVisual?.addEventListener('mousemove', (e) => {
    const rect = heroVisual.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mascot.style.transform = `translate(${x * 10}px, ${y * 10}px)`;
  });
  heroVisual?.addEventListener('mouseleave', () => {
    mascot.style.transform = '';
  });
}

// ---------- Modals ----------
const body = document.body;
let lastFocused = null;

function openModal(id) {
  const modal = document.getElementById(`modal-${id}`);
  if (!modal) return;
  lastFocused = document.activeElement;
  modal.hidden = false;
  body.classList.add('no-scroll');
  const closeBtn = modal.querySelector('.modal__close');
  closeBtn?.focus();
}

function closeModal(modal) {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) {
    body.classList.remove('no-scroll');
  }
  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus();
  }
}

document.querySelectorAll('[data-modal-open]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal(btn.dataset.modalOpen);
  });
});

document.querySelectorAll('[data-modal-close]').forEach((el) => {
  el.addEventListener('click', () => {
    closeModal(el.closest('.modal'));
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openedModal = document.querySelector('.modal:not([hidden])');
    if (openedModal) closeModal(openedModal);
  }
});
