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
