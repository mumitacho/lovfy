(function () {
  'use strict';

  /* ---------------------------------- Loading bar ---------------------------------- */
  var loadingBar = document.getElementById('loadingBar');
  if (loadingBar) {
    requestAnimationFrame(function () { loadingBar.style.width = '70%'; });
    window.addEventListener('load', function () {
      loadingBar.classList.add('is-done');
      setTimeout(function () { loadingBar.remove(); }, 500);
    });
  }

  /* ---------------------------------- Header scroll shadow ---------------------------------- */
  var header = document.getElementById('header');
  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------------------------- Mobile nav toggle ---------------------------------- */
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('nav');

  function closeNav() {
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Abrir menu');
  }

  navToggle.addEventListener('click', function () {
    var isOpen = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    navToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
  });

  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeNav);
  });

  /* ---------------------------------- Scroll reveal ---------------------------------- */
  var revealEls = document.querySelectorAll('[data-reveal]');
  var revealObserver = null;
  if ('IntersectionObserver' in window && revealEls.length) {
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------------------------------- Contador de downloads ---------------------------------- */
  var counterEl = document.querySelector('.counter__number');
  if (counterEl) {
    var target = parseInt(counterEl.getAttribute('data-target'), 10) || 0;
    var counterDone = false;

    function animateCounter() {
      if (counterDone) return;
      counterDone = true;
      var start = 0;
      var duration = 1400;
      var startTime = null;

      function tick(now) {
        if (startTime === null) startTime = now;
        var progress = Math.min((now - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = Math.round(start + (target - start) * eased);
        counterEl.textContent = value.toLocaleString('pt-BR');
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          counterEl.textContent = target.toLocaleString('pt-BR');
        }
      }
      requestAnimationFrame(tick);
    }

    if ('IntersectionObserver' in window) {
      var counterObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter();
            counterObserver.disconnect();
          }
        });
      }, { threshold: 0.4 });
      counterObserver.observe(counterEl);
    } else {
      counterEl.textContent = target.toLocaleString('pt-BR');
    }
  }

  /* ---------------------------------- FAQ accordion ---------------------------------- */
  document.querySelectorAll('.accordion__trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      var isOpen = trigger.getAttribute('aria-expanded') === 'true';

      trigger.setAttribute('aria-expanded', String(!isOpen));
      if (panel) panel.classList.toggle('is-open', !isOpen);
    });
  });

  /* ---------------------------------- Voltar ao topo ---------------------------------- */
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    function toggleBackToTop() {
      backToTop.classList.toggle('is-visible', window.scrollY > 600);
    }
    toggleBackToTop();
    window.addEventListener('scroll', toggleBackToTop, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------------------------------- Ano do rodapé ---------------------------------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
