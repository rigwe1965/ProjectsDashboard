// The AI guide's chat panel. Everything a customer or the model writes is put on the page with textContent only, never as HTML.
(() => {
  const log = document.getElementById('log'), form = document.getElementById('form'), msg = document.getElementById('msg'), send = document.getElementById('send'), leftEl = document.getElementById('left');
  let left = Number(document.body.dataset.left) || 0, busy = false;

  const add = (cls, text) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; log.appendChild(p); log.scrollTop = log.scrollHeight; return p; };
  const refresh = () => {
    leftEl.textContent = left + (left === 1 ? ' message left' : ' messages left');
    const off = busy || left <= 0;
    send.disabled = off; msg.disabled = left <= 0;
  };

  add('bot', 'Hello! I am the demo guide, an AI assistant. Ask me how to find or do something in the demo.');
  refresh();

  async function ask(text) {
    busy = true; refresh();
    add('me', text);
    const bot = add('bot wait', '');
    const done = () => { bot.classList.remove('wait'); if (!bot.textContent) bot.remove(); };
    try {
      const r = await fetch('/_pd/guide/chat', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text }) });
      if (!r.ok) {
        let info = {}; try { info = await r.json(); } catch { /* not JSON */ }
        done(); add('err', info.error || 'The guide could not answer just now. Please try again.');
        if (typeof info.left === 'number') left = info.left;
        return;
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          let ev; try { ev = JSON.parse(chunk.slice(6)); } catch { continue; }
          if (ev.t === 'text') { bot.classList.remove('wait'); bot.textContent += ev.d; log.scrollTop = log.scrollHeight; }
          else if (ev.t === 'note') add('note', ev.d);
          else if (ev.t === 'error') { done(); add('err', ev.d); }
          else if (ev.t === 'done') left = Number(ev.left) || 0;
        }
      }
    } catch {
      done(); add('err', 'The connection was lost. Please try again.');
    } finally {
      done(); busy = false; refresh();
      if (left > 0) msg.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msg.value.trim();
    if (!text || busy || left <= 0) return;
    msg.value = '';
    ask(text);
  });
  msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
})();
