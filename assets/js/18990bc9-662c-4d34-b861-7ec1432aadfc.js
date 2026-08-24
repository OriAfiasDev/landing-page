(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var raf = null;
  function clamp(v){ return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(p){ return 1 - Math.pow(1 - p, 3); }
  function tick(){
    raf = null;
    if (document.readyState === 'loading') return;
    var vh = window.innerHeight;
    var bar = document.querySelector('[data-progress]');
    if (bar){
      var sc = document.scrollingElement || document.documentElement, top = window.scrollY || sc.scrollTop || 0,
          max = sc.scrollHeight - sc.clientHeight;
      if (max < 40){
        var host = bar.parentElement;
        while (host){
          if (host.scrollHeight - host.clientHeight > 40){ top = host.scrollTop; max = host.scrollHeight - host.clientHeight; break; }
          host = host.parentElement;
        }
      }
      bar.style.transform = 'scaleX(' + (max > 0 ? clamp(top / max) : 0) + ')';
    }
    document.querySelectorAll('[data-hero-exit],[data-card3d],[data-slide-end],[data-slide-start],[data-sticky-pop],[data-zoom],[data-reveal],[data-parallax]').forEach(function(el){
      var r = el.getBoundingClientRect();
      if (el.hasAttribute('data-hero-exit')){
        var out = clamp((-r.top) / (vh * 0.9));
        el.style.opacity = String(1 - out * 0.88);
        el.style.transform = 'scale(' + (1 - out * 0.12) + ') translateY(' + (-70 * out) + 'px)';
        el.style.filter = 'blur(' + (7 * out) + 'px)';
        return;
      }
      var p = ease(clamp((vh - r.top) / (vh * 0.62)));
      if (el.hasAttribute('data-parallax')){
        el.style.transform = 'translateY(' + (10 - 20 * p) + 'px)';
        return;
      }
      el.style.opacity = String(p);
      if (el.hasAttribute('data-card3d'))
        el.style.transform = 'perspective(1200px) rotateX(' + (24 * (1 - p)) + 'deg) rotateZ(' + (-3 * (1 - p)) + 'deg) translateY(' + (70 * (1 - p)) + 'px) scale(' + (0.9 + 0.1 * p) + ')';
      else if (el.hasAttribute('data-slide-end'))
        el.style.transform = 'translateX(' + (-90 * (1 - p)) + 'px) rotate(' + (2 * (1 - p)) + 'deg)';
      else if (el.hasAttribute('data-slide-start'))
        el.style.transform = 'translateX(' + (90 * (1 - p)) + 'px) rotate(' + (-2 * (1 - p)) + 'deg)';
      else if (el.hasAttribute('data-sticky-pop'))
        el.style.transform = 'scale(' + (0.94 + 0.06 * p) + ')';
      else if (el.hasAttribute('data-zoom')){
        el.style.opacity = '1';
        el.style.transform = 'scale(' + (1.14 - 0.14 * p) + ')';
      }
      else el.style.transform = 'translateY(' + (38 * (1 - p)) + 'px)';
    });
  }
  function loop(){ tick(); requestAnimationFrame(loop); }
  function schedule(){ if (!raf) raf = requestAnimationFrame(tick); }
  window.addEventListener('scroll', schedule, {passive:true, capture:true});
  document.addEventListener('scroll', schedule, {passive:true, capture:true});
  document.addEventListener('wheel', schedule, {passive:true, capture:true});
  document.addEventListener('touchmove', schedule, {passive:true, capture:true});
  window.addEventListener('resize', schedule, {passive:true});
  document.addEventListener('DOMContentLoaded', schedule);
  requestAnimationFrame(loop);
})();
