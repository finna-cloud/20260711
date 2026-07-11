const MODULE = 'ark07-survival-terminal';

function mount() {
  if (document.getElementById('ark07-launcher')) return;

  const launcher = document.createElement('button');
  launcher.id = 'ark07-launcher';
  launcher.type = 'button';
  launcher.textContent = 'ARK-07';
  launcher.title = '開啟方舟七號生存終端';

  const panel = document.createElement('section');
  panel.id = 'ark07-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <header id="ark07-panel-head">
      <strong>ARK-07｜方舟七號</strong>
      <button id="ark07-close" type="button" aria-label="關閉">×</button>
    </header>
    <iframe id="ark07-frame" title="ARK-07 生存終端"></iframe>`;

  document.body.append(launcher, panel);
  const frame = panel.querySelector('#ark07-frame');
  frame.src = new URL('./game.html', import.meta.url).href;

  const toggle = (open) => {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
  };
  launcher.addEventListener('click', () => toggle(!panel.classList.contains('open')));
  panel.querySelector('#ark07-close').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

console.info(`[${MODULE}] loaded`);
