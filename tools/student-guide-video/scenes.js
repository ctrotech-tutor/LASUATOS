/* The student guide storyboard. One global: window.setTime(tSeconds).
 *
 * Layout: 1080x1920. The phone (612pt wide, 1400 tall) centres the captured screens;
 * the caption card lives in a fixed band BELOW the phone (top:1570) so captions never
 * cover the video content; a rail on the left tracks the ten parts. Everything is
 * plain DOM positioned by scene functions, so every frame is deterministic
 * (render.mjs scrubs time and screenshots).
 */
(function () {
  const W = 1080;
  const NAVY = '#153b5b';
  const NAVY_DEEP = '#0e2438';
  const GOLD = '#d8b15c';
  const OCHRE = '#c59a42';
  const PAPER = '#f2f3ee';
  const INK = '#12202e';

  const BRAND_SVG = `<svg viewBox="0 0 48 48" fill="none" style="width:100%;height:100%"><rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C"/></svg>`;

  /* ---------------- helpers ---------------- */

  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOutCubic = ease;
  const easeOutBack = (x) => 1 + 1.70158 * Math.pow(x - 1, 3) + 2.70158 * Math.pow(x - 1, 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  /** Keyframed value: K(t, [[0,0],[1.2,60],[3,60]]) with easing between keys. */
  const K = (t, keys) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        return v0 + (v1 - v0) * easeInOut(clamp01((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };

  const el = (tag, style, html) => {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  const FADE = 0.32; // shot crossfade length
  const SEG_XF = 0.42; // segment-to-segment transition length

  /* ---------------- chrome: header, rail, captions ---------------- */

  const SECTIONS = [
    'Welcome', 'Your matric number', 'Is this you?', 'The email code', 'Your password',
    'Your face', 'On your home screen', 'Marking attendance', 'If something goes wrong', 'Your record',
  ];

  const header = {
    root: null,
    chip: null,
    build(root) {
      this.root = el('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 84px 0 100px;');
      const lockup = el('div', 'display:flex;align-items:center;gap:18px;');
      lockup.appendChild(el('div', 'width:64px;height:64px;', BRAND_SVG));
      lockup.appendChild(el('div', `font-family:'Plus Jakarta Sans var';font-weight:800;font-size:34px;letter-spacing:.14em;color:${NAVY};`, 'LASUATOS'));
      this.root.appendChild(lockup);
      this.chip = el('div', `font-family:'Inter var';font-weight:600;font-size:26px;color:#fff;background:${NAVY};padding:14px 26px;border-radius:999px;letter-spacing:.02em;`);
      this.root.appendChild(this.chip);
      root.appendChild(this.root);
    },
    set(section, index, total, opacity) {
      this.chip.textContent = `${section}  ·  ${index}/${total}`;
      this.root.style.opacity = opacityText(opacity);
    },
  };

  function opacityText(o) { return String(Math.round(o * 100) / 100); }

  const rail = {
    ticks: [],
    build(root) {
      this.ticks = SECTIONS.map(() => {
        const tick = el('div', `width:12px;height:12px;border-radius:999px;background:${NAVY};opacity:.22;transition:none;`);
        root.appendChild(tick);
        return tick;
      });
    },
    set(active, progress) {
      this.ticks.forEach((tick, i) => {
        if (i === active) {
          tick.style.opacity = '1';
          tick.style.background = OCHRE;
          tick.style.height = `${12 + progress * 34}px`;
        } else {
          tick.style.height = '12px';
          tick.style.background = NAVY;
          tick.style.opacity = i < active ? '0.85' : '0.22';
        }
      });
    },
  };

  const captions = {
    card: null,
    text: null,
    build(root) {
      this.card = el('div', `background:rgba(255,255,255,.97);border-radius:28px;border:1px solid rgba(18,32,46,.07);box-shadow:0 22px 54px rgba(18,32,46,.13), 0 2px 0 rgba(18,32,46,.03);display:flex;overflow:hidden;height:100%;align-items:center;`);
      this.card.appendChild(el('div', `width:10px;align-self:stretch;background:linear-gradient(${GOLD},${OCHRE});flex:none;`));
      this.text = el('div', `padding:0 36px;font-weight:560;line-height:1.36;color:${INK};`);
      this.card.appendChild(this.text);
      root.appendChild(this.card);
    },
    set(phrase, opacity) {
      this.card.style.opacity = opacityText(opacity);
      this.card.style.transform = `translateY(${(1 - opacity) * 18}px)`;
      if (phrase !== this.last) {
        this.last = phrase;
        const size = phrase.length > 86 ? 31 : phrase.length > 58 ? 34 : 37;
        this.text.style.fontSize = `${size}px`;
        this.text.textContent = phrase;
      }
    },
    hide() { this.card.style.opacity = '0'; this.last = null; },
  };

  /** Captions for one segment: phrases with start times (the narration's phrase marks). */
  function captionAt(phrases, t) {
    let current = phrases[0];
    for (const phrase of phrases) if (t >= phrase.at) current = phrase;
    const next = phrases[phrases.indexOf(current) + 1];
    const out = next ? next.at : Infinity;
    let opacity = 1;
    if (t < current.at + 0.22) opacity = (t - current.at) / 0.22;
    if (out - t < 0.18) opacity = Math.min(opacity, Math.max(0, (out - t) / 0.18));
    return { text: current.text, opacity: clamp01(opacity) };
  }

  /* ---------------- the phone ---------------- */

  const PHONE_W = 640;
  const PHONE_SCREEN = 7; // bezel
  const PHONE_H = 1370;
  const PHONE_TOP = 152;

  function makePhone(shotSrc) {
    const phone = el('div', `position:absolute;width:${PHONE_W}px;height:${PHONE_H}px;left:${(W - PHONE_W) / 2}px;top:${PHONE_TOP}px;border-radius:72px;background:${NAVY_DEEP};box-shadow:0 54px 110px rgba(14,36,56,.34), 0 10px 26px rgba(14,36,56,.22);padding:${PHONE_SCREEN}px;will-change:transform,opacity;`);
    const screenWrap = el('div', 'position:relative;width:100%;height:100%;border-radius:64px;overflow:hidden;background:#fff;');
    const img = el('img');
    img.src = shotSrc;
    img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 40%;';
    screenWrap.appendChild(img);
    const hole = el('div', `position:absolute;top:22px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:999px;background:#0a1622;box-shadow:inset 0 0 4px rgba(255,255,255,.25);z-index:5;`);
    phone.appendChild(screenWrap);
    phone.appendChild(hole);
    return { phone, img, screenWrap };
  }

  /* ---------------- scene primitives ---------------- */

  /** A full-stage layer that shows one phone shot (or a custom builder). */
  function shotLayer(src) {
    const { phone, img, screenWrap } = makePhone(`shots/${src}`);
    const layer = el('div', 'position:absolute;inset:0;');
    layer.appendChild(phone);
    return { layer, phone, img, screenWrap };
  }

  function chip(text, opts = {}) {
    const bg = opts.bg ?? NAVY;
    const fg = opts.fg ?? '#fff';
    const node = el('div', `position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:${bg};color:${fg};font-weight:650;font-size:32px;padding:20px 34px;border-radius:22px;box-shadow:0 18px 44px rgba(14,36,56,.28);white-space:nowrap;`);
    node.style.bottom = `${opts.bottom ?? 360}px`;
    if (opts.icon) node.insertAdjacentHTML('afterbegin', opts.icon);
    node.appendChild(el('span', '', text));
    return node;
  }

  function rippleFx(parent, x, y, size = 130) {
    // A gold ring pulsing once where the tap lands (x, y in stage px).
    const ring = el('div', `position:absolute;left:${x}px;top:${y}px;width:0;height:0;z-index:60;pointer-events:none;`);
    const a = el('div', `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border:6px solid ${OCHRE};border-radius:999px;`);
    ring.appendChild(a);
    parent.appendChild(ring);
    return (t) => {
      const p = clamp01(t / 0.62);
      a.style.width = a.style.height = `${ease(p) * size}px`;
      a.style.opacity = String(1 - p);
    };
  }

  /** Converts a point in shot-image fractions to stage px, for the centred phone. */
  function phonePoint(fx, fy) {
    return { x: (W - PHONE_W) / 2 + PHONE_SCREEN + fx * (PHONE_W - 2 * PHONE_SCREEN), y: PHONE_TOP + PHONE_SCREEN + fy * (PHONE_H - 2 * PHONE_SCREEN) };
  }

  /* ---------------- title and outro cards ---------------- */

  function titleCard(t, layer) {
    layer.style.background = PAPER;
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      const center = el('div', 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:38px;');
      center.appendChild(el('div', 'width:200px;height:200px;', BRAND_SVG));
      center.appendChild(el('div', `font-family:'Plus Jakarta Sans var';font-weight:800;font-size:88px;color:${NAVY};letter-spacing:.12em;`, 'LASUATOS'));
      center.appendChild(el('div', `font-size:40px;font-weight:600;color:#3d5266;text-align:center;line-height:1.4;max-width:800px;`, 'Open your account.<br>Mark your attendance.<br>Be exam-eligible.'));
      const chipNode = el('div', `margin-top:10px;font-size:30px;font-weight:650;color:${NAVY};border:3px solid ${OCHRE};padding:16px 34px;border-radius:999px;`, 'For students · about 2 minutes');
      center.appendChild(chipNode);
      layer.appendChild(center);
      layer._center = center;
    }
    const p = clamp01(t / 0.9);
    const q = easeOutBack(p);
    layer._center.style.opacity = opacityText(p);
    layer._center.style.transform = `translateY(${(1 - q) * 54}px)`;
  }

  function outroCard(t, layer) {
    layer.style.background = `linear-gradient(168deg, ${NAVY} 0%, ${NAVY_DEEP} 78%)`;
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      const center = el('div', 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;');
      center.appendChild(el('div', 'width:176px;height:176px;', BRAND_SVG.replace('#153B5B', '#f7f8f4').replaceAll('#F7F8F4', '#153B5B').replaceAll('#D8B15C', '#d8b15c')));
      center.appendChild(el('div', `font-family:'Plus Jakarta Sans var';font-weight:800;font-size:64px;color:#f7f8f4;text-align:center;line-height:1.28;max-width:840px;`, 'Open your account once.<br>Then just scan.'));
      center.appendChild(el('div', `font-size:36px;font-weight:600;color:${GOLD};letter-spacing:.06em;`, 'lasuatos.vercel.app'));
      layer.appendChild(center);
      layer._center = center;
    }
    const p = clamp01(t / 0.8);
    const q = easeOutBack(p);
    layer._center.style.opacity = opacityText(p);
    layer._center.style.transform = `scale(${0.93 + q * 0.07})`;
  }

  /* ---------------- segment 07 mocks: home screen, Android menu, iPhone share ---------------- */

  function homeScreenMock(t, layer) {
    layer.style.background = 'linear-gradient(155deg,#1d4670,#0e2438)';
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      const grid = el('div', 'position:absolute;left:50%;top:400px;transform:translateX(-50%);display:grid;grid-template-columns:repeat(4,150px);gap:54px 44px;');
      const colors = ['#274b6b', '#28536f', '#234a68', '#2a5470', '#254e6c', '#2b5571', '#24496a', '#295369'];
      for (let i = 0; i < 8; i += 1) grid.appendChild(el('div', `width:150px;height:150px;border-radius:38px;background:${colors[i]};opacity:.5;`));
      const ours = el('div', 'display:flex;flex-direction:column;align-items:center;gap:14px;');
      ours.appendChild(el('div', 'width:150px;height:150px;filter:drop-shadow(0 14px 30px rgba(0,0,0,.45));', BRAND_SVG));
      ours.appendChild(el('div', 'color:#eaf0f6;font-size:28px;font-weight:600;', 'LASUATOS'));
      grid.appendChild(ours);
      layer.appendChild(grid);
      layer._ours = ours;
    }
    const p = clamp01((t - 0.4) / 0.8);
    layer._ours.style.opacity = opacityText(p);
    layer._ours.style.transform = `scale(${0.5 + ease(p) * 0.5})`;
  }

  function androidMenuMock(t, layer) {
    layer.style.background = '#e8ecef';
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      // Chrome bar
      const bar = el('div', `position:absolute;left:90px;right:90px;top:296px;height:96px;background:#fff;border-radius:999px;box-shadow:0 4px 18px rgba(18,32,46,.12);display:flex;align-items:center;padding:0 34px;gap:20px;`);
      bar.appendChild(el('div', `width:34px;height:34px;border-radius:8px;border:3px solid #5b6873;`));
      bar.appendChild(el('div', `font-size:34px;color:#1f2a33;font-weight:600;letter-spacing:.01em;`, 'lasuatos.vercel.app'));
      bar.appendChild(el('div', `margin-left:auto;font-size:44px;font-weight:800;color:#1f2a33;letter-spacing:4px;line-height:0;`, '⋮'));
      layer.appendChild(bar);
      // Menu card
      const menu = el('div', `position:absolute;right:90px;top:416px;width:560px;background:#fff;border-radius:26px;box-shadow:0 30px 70px rgba(18,32,46,.25);padding:18px 0;`);
      ['New tab', 'History', 'Downloads', 'Bookmarks', 'Recent tabs', 'Install app…', 'Settings'].forEach((item) => {
        const row = el('div', `padding:26px 40px;font-size:34px;color:#1f2a33;font-weight:${item.startsWith('Install') ? 700 : 500};display:flex;align-items:center;gap:22px;`, item);
        if (item.startsWith('Install')) row.dataset.install = '1';
        menu.appendChild(row);
      });
      layer.appendChild(menu);
      layer._menu = menu;
      layer._installRow = menu.querySelector('[data-install]');
    }
    const menuIn = clamp01((t - 4.9) / 0.5);
    layer._menu.style.opacity = opacityText(menuIn);
    layer._menu.style.transform = `translateY(${(1 - ease(menuIn)) * -18}px) scale(${0.96 + ease(menuIn) * 0.04})`;
    layer._menu.style.transformOrigin = 'top right';
    const hot = clamp01((t - 6.4) / 0.5) * clamp01((8.9 - t) / 0.4);
    layer._installRow.style.background = `rgba(197,154,66,${0.28 * hot})`;
    layer._installRow.style.boxShadow = hot > 0.02 ? `inset 0 0 0 3px rgba(197,154,66,${0.9 * hot})` : 'none';
    layer._installRow.style.borderRadius = '18px';
  }

  function iphoneShareMock(t, layer) {
    layer.style.background = '#e8ecef';
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      const bar = el('div', `position:absolute;left:90px;right:90px;top:296px;height:96px;background:#fff;border-radius:999px;box-shadow:0 4px 18px rgba(18,32,46,.12);display:flex;align-items:center;justify-content:center;`);
      bar.appendChild(el('div', `font-size:34px;color:#1f2a33;font-weight:600;`, 'lasuatos.vercel.app'));
      layer.appendChild(bar);
      // Share sheet
      const sheet = el('div', `position:absolute;left:60px;right:60px;bottom:190px;background:rgba(255,255,255,.97);border-radius:38px;box-shadow:0 34px 80px rgba(18,32,46,.28);padding:34px 0;`);
      sheet.appendChild(el('div', `padding:0 44px 22px;font-size:30px;color:#5b6873;font-weight:600;border-bottom:2px solid #e3e7ea;`, 'Share'));
      ['Copy', 'Add to Favourites', 'Add to Home Screen', 'Print'].forEach((item) => {
        const row = el('div', `padding:30px 44px;font-size:36px;color:#1f2a33;font-weight:${item === 'Add to Home Screen' ? 700 : 500};display:flex;align-items:center;gap:24px;`);
        const icon = el('div', `width:56px;height:56px;border-radius:14px;background:${item === 'Add to Home Screen' ? NAVY : '#eef1f3'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:30px;`, item === 'Add to Home Screen' ? '＋' : '▢');
        row.appendChild(icon);
        row.appendChild(el('span', '', item));
        if (item === 'Add to Home Screen') row.dataset.add = '1';
        sheet.appendChild(row);
      });
      layer.appendChild(sheet);
      layer._sheet = sheet;
      layer._addRow = sheet.querySelector('[data-add]');
    }
    const sheetIn = clamp01((t - 9.1) / 0.55);
    layer._sheet.style.opacity = opacityText(sheetIn);
    layer._sheet.style.transform = `translateY(${(1 - ease(sheetIn)) * 120}px)`;
    const hot = clamp01((t - 10.0) / 0.5);
    layer._addRow.style.background = `rgba(197,154,66,${0.26 * hot})`;
    layer._addRow.style.borderRadius = '20px';
  }

  /* ---------------- segment 08 opener: the hall with the QR ---------------- */

  function hallScene(t, layer, { withTimer = false } = {}) {
    if (!layer.dataset.built) {
      layer.dataset.built = '1';
      layer.style.overflow = 'hidden';
      const img = el('img');
      img.src = 'media/lecture-hall.jpg';
      img.style.cssText = 'position:absolute;inset:-4%;width:108%;height:108%;object-fit:cover;filter:saturate(1.02);';
      layer.appendChild(img);
      const shade = el('div', 'position:absolute;inset:0;background:linear-gradient(rgba(10,20,30,.08) 40%, rgba(10,22,34,.55));');
      layer.appendChild(shade);
      // The QR where the projector screen is (photo: screen spans ~ x 13-86%, y 10-45% of frame height)
      const card = el('div', `position:absolute;left:50%;top:21%;transform:translateX(-50%);background:#fff;border-radius:26px;padding:34px;box-shadow:0 30px 70px rgba(0,0,0,.4);display:flex;flex-direction:column;align-items:center;gap:18px;`);
      const qr = el('img');
      qr.src = 'media/qr-card.png';
      qr.style.cssText = 'width:380px;height:380px;display:block;';
      card.appendChild(qr);
      card.appendChild(el('div', `font-size:30px;font-weight:700;color:${NAVY};letter-spacing:.08em;`, 'ECE 101 · ECE Lecture Theatre'));
      layer.appendChild(card);
      layer._card = card;
      if (withTimer) {
        const ring = el('div', 'position:absolute;inset:-24px;');
        ring.innerHTML = `<svg viewBox="0 0 100 100" style="width:100%;height:100%"><circle cx="50" cy="50" r="48.4" fill="none" stroke="rgba(216,177,92,.25)" stroke-width="2.4"/><circle class="sweep" cx="50" cy="50" r="48.4" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="304" stroke-dashoffset="304" transform="rotate(-90 50 50)"/></svg>`;
        card.style.position = 'absolute';
        card.appendChild(ring);
        layer._sweep = ring.querySelector('.sweep');
      }
    }
    const p = clamp01(t / 0.7);
    layer._card.style.opacity = opacityText(p);
    layer._card.style.transform = `translateX(-50%) translateY(${(1 - ease(p)) * 34}px)`;
    if (withTimer && layer._sweep) {
      const sweep = clamp01((t - 15.6) / 3.4); // a fast-forwarded 30 seconds
      layer._sweep.style.strokeDashoffset = String(304 * (1 - sweep));
    }
  }

  /* ---------------- the storyboard ---------------- */

  // Each segment: audio file, length, phrases (caption, start), and scene(t, stage) painting.
  // Times are seconds from the segment start. Phrase marks come from the narration's pauses.

  const SEGMENTS = [
    {
      id: '01-welcome', len: 20.32, section: 0,
      phrases: [
        { at: 0.0, text: 'Welcome to LASUATOS.' },
        { at: 2.30, text: 'In about two minutes, you’ll know everything you need, from opening your account to being marked present in class.' },
        { at: 5.13, text: 'Before you start, have three things ready:' },
        { at: 8.78, text: 'your matric number,' },
        { at: 11.19, text: 'your LASU student email,' },
        { at: 12.34, text: 'and your phone.' },
        { at: 13.97, text: 'Your HOC has already put your class on LASUATOS, so your name is waiting for you.' },
        { at: 15.33, text: 'Your HOC has already put your class on LASUATOS, so your name is waiting for you.' },
      ],
      scene(t, stage) {
        if (t < 2.55) { titleCard(t, stage.a); stage.a.style.opacity = opacityText(clamp01((2.9 - t) / 0.4)); return; }
        stage.a.style.opacity = '0';
        const s = stage.shot('home-top.png');
        s.img.style.transformOrigin = '50% 18%';
        const zoom = K(t, [[2.55, 1.02], [20.3, 1.09]]);
        s.img.style.transform = `scale(${zoom})`;
        // Once the "three things" chips are up, dim the page behind them.
        if (!s.veil) {
          s.veil = el('div', 'position:absolute;inset:0;background:linear-gradient(180deg, rgba(10,24,38,.58), rgba(10,24,38,.7));opacity:0;z-index:4;');
          s.screenWrap.appendChild(s.veil);
        }
        s.veil.style.opacity = String(clamp01((t - 10.9) / 0.6));
        const items = [['Your matric number', 11.19], ['Your LASU student email', 12.34], ['Your phone', 13.97]];
        stage.chips(items.map(([text, at], i) => ({ text, at, bottom: 360, slot: 2 - i })), t);
      },
    },
    {
      id: '02-matric', len: 15.52, section: 1,
      phrases: [
        { at: 0.0, text: 'Open lasuatos dot vercel dot app on your phone, and tap Open your account.' },
        { at: 5.80, text: 'Type the nine digits of your matric number.' },
        { at: 8.19, text: 'LASUATOS finds you the moment you type the last digit.' },
        { at: 11.64, text: 'Direct Entry, with no matric number yet? Use your JAMB number instead.' },
        { at: 13.85, text: 'Direct Entry, with no matric number yet? Use your JAMB number instead.' },
      ],
      scene(t, stage) {
        if (t < 5.55) {
          // Browser bar mock over the landing page
          const s = stage.shot('home-top.png');
          s.img.style.transform = `scale(${K(t, [[0, 1.02], [5.5, 1.06]])})`;
          stage.browserBar('lasuatos.vercel.app', t);
          const p = phonePoint(0.57, 0.739); // "Open your student account" link on the landing page
          stage.rippleAt(p.x, p.y, t, 4.6);
          return;
        }
        stage.clearBrowserBar();
        // All nine digits land evenly, one about every half second, then the card pops in.
        const digit = Math.max(0, Math.min(9, Math.floor((t - 5.7) / 0.58)));
        const typing = t < 11.64;
        const s = stage.shot(typing ? `matric-${String(digit).padStart(2, '0')}.png` : 'found-00.png', !typing);
        if (typing) s.img.style.transform = 'scale(1.05) translateY(-1.5%)';
        else s.img.style.transform = `scale(${K(t, [[11.64, 1.12], [12.4, 1.0]])}) translateY(${K(t, [[11.64, -2.5], [12.4, 0]])}%)`;
      },
    },
    {
      id: '03-is-this-you', len: 13.84, section: 2,
      phrases: [
        { at: 0.0, text: 'Check the card.' },
        { at: 1.54, text: 'Your name, department and level come from your class list.' },
        { at: 5.25, text: 'If it’s you, tap Yes, send my code.' },
        { at: 6.10, text: 'If it’s you, tap Yes, send my code.' },
        { at: 8.57, text: 'Name wrong, or not found?' },
        { at: 10.73, text: 'Your HOC can fix the class list in a minute.' },
      ],
      scene(t, stage) {
        const s = stage.shot('found-00.png');
        // Zoom onto the ID card while it is being checked, back out for the tap.
        s.img.style.transformOrigin = '50% 34%';
        const zoom = K(t, [[0, 1.0], [1.6, 1.06], [5.4, 1.06], [6.6, 1.0], [13.84, 1.02]]);
        const dy = K(t, [[0, 0], [1.6, -2], [5.4, -2], [6.6, 0], [13.84, 0]]);
        s.img.style.transform = `scale(${zoom}) translateY(${dy}%)`;
        const p = phonePoint(0.5, 0.78); // "Yes, send my code"
        stage.rippleAt(p.x, p.y, t, 6.3);
        if (t > 10.6) stage.chips([{ text: 'Your HOC can fix it', at: 10.73, bottom: 360 }], t);
      },
    },
    {
      id: '04-code', len: 16.28, section: 3,
      phrases: [
        { at: 0.0, text: 'A six-digit code goes to your LASU student email.' },
        { at: 3.77, text: 'Open Gmail with your LASU account, and type the code.' },
        { at: 7.08, text: 'Faster still, tap Continue with Google,' },
        { at: 8.05, text: 'and pick your LASU account.' },
        { at: 9.84, text: 'Can’t open your email right now?' },
        { at: 11.73, text: 'Ask your HOC for a one-time setup code.' },
        { at: 13.41, text: 'Ask your HOC for a one-time setup code.' },
      ],
      scene(t, stage) {
        if (t < 7.0) {
          const frames = ['code-00.png', 'code-01.png', 'code-03.png', 'code-04.png', 'code-06.png'];
          const idx = Math.min(frames.length - 1, Math.floor(K(t, [[3.9, 0], [6.9, frames.length - 1]])));
          const s = stage.shot(t < 3.9 ? 'code-00.png' : frames[idx]);
          s.img.style.transform = `scale(${K(t, [[0, 1.04], [3.9, 1.08], [6.9, 1.05], [7.0, 1.0]])})`;
          return;
        }
        const s = stage.shot('found-00.png');
        s.img.style.transformOrigin = '50% 30%';
        s.img.style.transform = `scale(${K(t, [[7.0, 1.0], [7.6, 1.03], [9.8, 1.03], [10.6, 1.0], [16.28, 1.0]])}) translateY(${K(t, [[7.0, 0], [7.6, -3], [9.8, -3], [10.6, 0], [16.28, 0]])}%)`;
        const google = phonePoint(0.5, 0.865); // "Yes, continue with Google"
        stage.rippleAt(google.x, google.y, t, 7.3);
        if (t > 9.7) {
          const setup = phonePoint(0.62, 0.945); // "Use a setup code"
          stage.rippleAt(setup.x, setup.y, t, 11.9, 90);
        }
      },
    },
    {
      id: '05-password', len: 12.52, section: 4,
      phrases: [
        { at: 0.0, text: 'You’re in!' },
        { at: 1.12, text: 'Your password is in the same style as the LASU portal:' },
        { at: 4.64, text: 'the word LASU,' },
        { at: 5.89, text: 'then your matric number,' },
        { at: 7.19, text: 'then your surname in capitals.' },
        { at: 9.34, text: 'Save it, then tap,' },
        { at: 10.04, text: 'Save it, then tap,' },
        { at: 10.80, text: 'I’ve saved it, continue.' },
        { at: 11.70, text: 'I’ve saved it, continue.' },
      ],
      scene(t, stage) {
        const s = stage.shot('password-00.png');
        // Zoom into the password card as the three parts are named.
        s.img.style.transformOrigin = '50% 36%';
        const zoom = K(t, [[0, 1.0], [4.4, 1.12], [9.5, 1.12], [10.1, 1.0], [12.52, 1.0]]);
        const dy = K(t, [[0, 0], [4.4, -4.5], [9.5, -4.5], [10.1, 0], [12.52, 0]]);
        s.img.style.transform = `scale(${zoom}) translateY(${dy}%)`;
        const p = phonePoint(0.5, 0.70); // "I've saved it, continue"
        stage.rippleAt(p.x, p.y, t, 10.9);
      },
    },
    {
      id: '06-face', len: 20.00, section: 5,
      phrases: [
        { at: 0.0, text: 'The last step is your face.' },
        { at: 2.29, text: 'It makes sure only you can mark your attendance.' },
        { at: 5.22, text: 'Tick the box to agree,' },
        { at: 6.62, text: 'then open the camera.' },
        { at: 8.27, text: 'Look straight at it, blink,' },
        { at: 9.52, text: 'then turn your head left and right.' },
        { at: 10.36, text: 'then turn your head left and right.' },
        { at: 12.75, text: 'The photos take themselves, in about fifteen seconds.' },
        { at: 16.09, text: 'Tip: face a light,' },
        { at: 16.80, text: 'and hold the phone at eye level.' },
        { at: 17.91, text: 'and hold the phone at eye level.' },
      ],
      scene(t, stage) {
        if (t < 5.0) {
          const s = stage.shot('face-00.png');
          s.img.style.transform = `scale(${K(t, [[0, 1.0], [5.0, 1.05]])})`;
          return;
        }
        if (t < 8.1) {
          const s = stage.shot('face-01.png');
          s.img.style.transform = `scale(${K(t, [[5.0, 1.06], [8.1, 1.02]])}) translateY(${K(t, [[5.0, -2], [8.1, 0]])}%)`;
          const box = phonePoint(0.135, 0.475); // the consent tick
          stage.rippleAt(box.x, box.y, t, 5.35, 90);
          const cam = phonePoint(0.5, 0.60); // "Open the camera"
          stage.rippleAt(cam.x, cam.y, t, 7.35);
          return;
        }
        if (t < 9.4) { stage.shot('face-live-front.png'); return; }
        if (t < 10.3) { stage.shot('face-live-blink.png'); return; }
        if (t < 12.0) { stage.shot('face-live-left.png'); return; }
        if (t < 14.6) { stage.shot('face-live-right.png'); return; }
        if (t < 16.7) {
          const s = stage.shot('face-review.png');
          s.img.style.transform = `scale(${K(t, [[14.6, 1.0], [16.7, 1.05]])})`;
          return;
        }
        const s = stage.shot('done-00.png');
        s.img.style.transform = `scale(${K(t, [[16.7, 1.08], [17.6, 1.0]])})`;
        if (t > 17.8) stage.chips([{ text: 'Face a light · phone at eye level', at: 17.91, bottom: 360 }], t);
      },
    },
    {
      id: '07-install', len: 12.08, section: 6,
      phrases: [
        { at: 0.0, text: 'Now put LASUATOS on your home screen.' },
        { at: 2.93, text: 'No app store needed.' },
        { at: 4.63, text: 'On Android, open the Chrome menu and tap Install app.' },
        { at: 8.73, text: 'On iPhone, tap Share,' },
        { at: 9.63, text: 'then Add to Home Screen.' },
        { at: 10.52, text: 'then Add to Home Screen.' },
      ],
      scene(t, stage) {
        if (t < 4.63) { homeScreenMock(t, stage.custom('home')); stage.tagPlatform(null); return; }
        if (t < 8.73) { androidMenuMock(t, stage.custom('android')); stage.tagPlatform('Android'); return; }
        iphoneShareMock(t, stage.custom('iphone'));
        stage.tagPlatform('iPhone');
      },
    },
    {
      id: '08-mark', len: 20.88, section: 7,
      phrases: [
        { at: 0.0, text: 'In class, your lecturer shows a QR code.' },
        { at: 3.31, text: 'Point your camera at it and tap the link, or open LASUATOS and scan from there.' },
        { at: 5.56, text: 'Point your camera at it and tap the link, or open LASUATOS and scan from there.' },
        { at: 8.24, text: 'Check it’s the right course.' },
        { at: 9.83, text: 'If your phone asks for your location, tap Allow.' },
        { at: 12.73, text: 'Then look at the camera, and you’re marked present.' },
        { at: 14.03, text: 'Then look at the camera, and you’re marked present.' },
        { at: 15.37, text: 'The code changes every thirty seconds, so a photo sent to a friend outside won’t work.' },
      ],
      scene(t, stage) {
        if (t < 3.31) { hallScene(t, stage.custom('hall')); return; }
        if (t < 8.24) {
          const s = stage.shot('scan-view.png');
          s.phone.style.transform = `translateY(${K(t, [[3.31, 60], [4.1, 0]])}px) scale(${K(t, [[3.31, 0.94], [4.1, 1]])})`;
          const p = clamp01((t - 5.9) / 0.5) * clamp01((8.3 - t) / 0.4);
          stage.scanRing(p);
          return;
        }
        stage.clearScanRing();
        if (t < 12.6) {
          const s = stage.shot('checkin-00.png');
          const zoom = K(t, [[8.24, 1.0], [9.83, 1.14], [12.6, 1.1]]);
          const dy = K(t, [[8.24, 0], [9.83, -5.5], [12.6, -5]]);
          s.img.style.transform = `scale(${zoom}) translateY(${dy}%)`;
          const p = phonePoint(0.5, 0.70); // "Mark me present"
          stage.rippleAt(p.x, p.y, t, 12.65);
          return;
        }
        if (t < 14.05) { stage.shot('checkin-face-live-right.png'); return; }
        if (t < 15.6) {
          const s = stage.shot('checkin-done.png');
          s.img.style.transform = `scale(${K(t, [[14.05, 1.07], [14.9, 1.0], [15.6, 1.0]])})`;
          return;
        }
        hallScene(t, stage.custom('hall2'), { withTimer: true });
      },
    },
    {
      id: '09-problems', len: 16.12, section: 8,
      phrases: [
        { at: 0.0, text: 'If the QR code won’t scan, type the six-character code shown under it.' },
        { at: 2.25, text: 'If the QR code won’t scan, type the six-character code shown under it.' },
        { at: 5.01, text: 'Phone dead? Borrow a classmate’s phone.' },
        { at: 5.81, text: 'After they’re marked, they tap Mark a classmate,' },
        { at: 7.54, text: 'and you sign in with your own details.' },
        { at: 10.38, text: 'It marks only you,' },
        { at: 12.71, text: 'and nothing of yours stays on their phone.' },
        { at: 14.03, text: 'and nothing of yours stays on their phone.' },
      ],
      scene(t, stage) {
        if (t < 5.01) {
          const s = stage.shot('scan-code-typed.png');
          s.img.style.transform = `scale(${K(t, [[0, 1.0], [2.25, 1.1], [5.01, 1.1]])}) translateY(${K(t, [[0, 0], [2.25, -3.5], [5.01, -3.5]])}%)`;
          return;
        }
        if (t < 7.54) {
          const s = stage.shot('checkin-done.png');
          s.img.style.transform = `scale(${K(t, [[5.01, 1.02], [7.54, 1.1]])}) translateY(${K(t, [[5.01, 0], [7.54, -3]])}%)`;
          const p = phonePoint(0.5, 0.86); // "Mark a classmate"
          stage.rippleAt(p.x, p.y, t, 7.3);
          return;
        }
        const s = stage.shot('checkin-classmate.png');
        s.img.style.transform = `scale(${K(t, [[7.54, 1.08], [8.3, 1.0], [12.71, 1.0], [13.6, 1.05], [16.12, 1.05]])})`;
        if (t > 10.3) {
          stage.chips([
            { text: 'It marks only you', at: 10.38, bottom: 530 },
            { text: 'Nothing of yours stays on their phone', at: 12.71, bottom: 360 },
          ], t);
        }
      },
    },
    {
      id: '10-record', len: 21.88, section: 9,
      phrases: [
        { at: 0.0, text: 'Open My attendance any time to see your percentage in every course.' },
        { at: 4.82, text: 'Most departments need seventy-five percent to sit the exam,' },
        { at: 8.14, text: 'and LASUATOS tells you how many more lectures you can miss.' },
        { at: 11.67, text: 'Stuck?' },
        { at: 12.57, text: 'For your name or matric number, speak to your HOC.' },
        { at: 15.63, text: 'For everything else, open the Help page.' },
        { at: 17.88, text: 'That’s it. Open your account once, then just scan at every class.' },
        { at: 18.62, text: 'That’s it. Open your account once, then just scan at every class.' },
      ],
      scene(t, stage) {
        if (t < 8.14) {
          const s = stage.shot('attendance-00.png');
          const zoom = K(t, [[0, 1.0], [4.82, 1.16], [8.14, 1.12]]);
          const dy = K(t, [[0, 0], [4.82, -2.5], [8.14, -2.5]]);
          s.img.style.transform = `scale(${zoom}) translateY(${dy}%)`;
          return;
        }
        if (t < 17.5) {
          const s = stage.shot('attendance-01.png');
          s.img.style.transform = `scale(${K(t, [[8.14, 1.08], [9.0, 1.0], [17.5, 1.02]])})`;
          if (t > 12.4) {
            stage.chips([
              { text: 'Name or matric number? Your HOC', at: 12.57, bottom: 530 },
              { text: 'Anything else? The Help page', at: 15.63, bottom: 360 },
            ], t);
          }
          return;
        }
        stage.a.style.opacity = opacityText(clamp01((t - 17.5) / 0.5));
        outroCard(t - 17.5, stage.a);
      },
    },
  ];

  /* ---------------- stage plumbing ---------------- */

  const stageRoot = document.getElementById('stage');
  const bgRoot = document.getElementById('bg');
  const captionRoot = document.getElementById('caption-wrap');

  bgRoot.style.background = `radial-gradient(120% 90% at 78% -10%, #e9edf2 0%, ${PAPER} 55%), ${PAPER}`;

  header.build(document.getElementById('chrome-top'));
  rail.build(document.getElementById('rail'));
  captions.build(captionRoot);

  // One persistent layer for full-stage scenes (title, hall, outro) and one shot layer
  // reused with crossfade between shots.
  const layerA = el('div', 'position:absolute;inset:0;opacity:0;will-change:transform,opacity;transform-origin:50% 40%;');
  stageRoot.appendChild(layerA);
  const layerShot = el('div', 'position:absolute;inset:0;will-change:transform,opacity;transform-origin:50% 40%;');
  stageRoot.appendChild(layerShot);
  const layerCustom = el('div', 'position:absolute;inset:0;will-change:transform,opacity;transform-origin:50% 40%;');
  stageRoot.appendChild(layerCustom);
  const fxLayer = el('div', 'position:absolute;inset:0;pointer-events:none;');
  stageRoot.appendChild(fxLayer);
  const chipLayer = el('div', 'position:absolute;inset:0;pointer-events:none;z-index:20;');
  stageRoot.appendChild(chipLayer);
  // A thin diagonal sheen that sweeps the stage during segment transitions.
  const sweepNode = el('div', 'position:absolute;top:-12%;bottom:-12%;left:0;width:36%;background:linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,252,242,.62) 46%, rgba(216,177,92,.30) 54%, rgba(255,255,255,0) 100%);pointer-events:none;opacity:0;z-index:24;filter:blur(1.5px);');
  stageRoot.appendChild(sweepNode);

  let currentShot = null; // { key, layer, phone, img, since, prev }
  let currentCustom = null; // key
  let layerShotHiddenAt = null; // when layerShot started fading out (custom took over)
  let layerCustomHiddenAt = null; // when layerCustom started fading out (a shot took over)
  let ripples = [];
  let lastSegment = -1;
  let now = 0;
  let browserBarNode = null;
  let scanRingNode = null;
  let platformTag = null;

  const stage = {
    a: layerA,
    /** Show a shot in the phone, crossfading (in scrubbed time) when the shot changes. */
    shot(src, instant = false) {
      if (currentCustom !== null) { currentCustom = null; layerCustomHiddenAt = now; }
      if (currentShot && currentShot.key === src) {
        currentShot.layer.style.opacity = '1';
        layerShot.style.opacity = '1';
        return currentShot;
      }
      const node = shotLayer(src);
      node.layer.style.opacity = '0';
      node.layer.style.transformOrigin = '50% 40%';
      node.layer.style.willChange = 'transform, opacity';
      layerShot.appendChild(node.layer);
      const prev = currentShot;
      currentShot = { key: src, layer: node.layer, phone: node.phone, img: node.img, screenWrap: node.screenWrap, since: now, prev: instant || !prev ? null : prev };
      layerShot.style.opacity = '1';
      return currentShot;
    },
    /** Full-stage custom scene (title, hall, menus), rebuilt when the key changes. */
    custom(key) {
      if (currentShot) { currentShot = null; layerShotHiddenAt = now; }
      if (currentCustom !== key) {
        layerCustom.innerHTML = '';
        delete layerCustom.dataset.built;
        layerCustom.dataset.key = key;
        currentCustom = key;
      }
      layerCustom.style.opacity = '1';
      return layerCustom;
    },
    /** Per-frame: run the shot crossfade in scrubbed time (no wall-clock transitions).
     *  Incoming shot settles from a slight zoom; the outgoing one recedes. */
    tick() {
      if (!currentShot) return;
      if (!currentShot.prev) { currentShot.layer.style.opacity = '1'; currentShot.layer.style.transform = ''; return; }
      const p = clamp01((now - currentShot.since) / FADE);
      const e = easeOutCubic(p);
      currentShot.layer.style.opacity = opacityText(e);
      currentShot.layer.style.transform = e >= 1 ? '' : `scale(${1 + (1 - e) * 0.028})`;
      currentShot.prev.layer.style.opacity = opacityText(1 - e);
      currentShot.prev.layer.style.transform = `scale(${1 - (1 - e) * 0.014})`;
      if (p >= 1) { currentShot.prev.layer.remove(); currentShot.prev = null; }
    },
    /** Per-frame: fade out whichever full-stage layer stopped being driven. */
    tickLayers() {
      if (layerCustomHiddenAt !== null) {
        const p = clamp01((now - layerCustomHiddenAt) / FADE);
        if (p >= 1) { layerCustom.style.opacity = '0'; layerCustomHiddenAt = null; }
        else layerCustom.style.opacity = opacityText(1 - easeOutCubic(p));
      }
      if (layerShotHiddenAt !== null) {
        const p = clamp01((now - layerShotHiddenAt) / FADE);
        if (p >= 1) { layerShot.style.opacity = '0'; layerShot.innerHTML = ''; layerShotHiddenAt = null; }
        else layerShot.style.opacity = opacityText(1 - easeOutCubic(p));
      }
    },
    clearShot() { layerShot.innerHTML=''; currentShot = null; },
    /** A caption chip that pops in at its time; several stack upward by slot. */
    chips(list, t) {
      chipLayer.innerHTML = '';
      for (const item of list) {
        const slot = item.slot ?? 0;
        const p = clamp01((t - item.at) / 0.35);
        if (p <= 0) continue;
        const node = chip(item.text, { bottom: item.bottom + slot * 92 });
        node.style.opacity = opacityText(p);
        node.style.transform = `translateX(-50%) translateY(${(1 - ease(p)) * 26}px)`;
        chipLayer.appendChild(node);
      }
    },
    rippleAt(x, y, t, at, size = 130) {
      ripples = ripples.filter((r) => t - r.at < 0.7);
      if (t >= at && !ripples.some((r) => r.at === at)) ripples.push({ at, x, y, size, fx: rippleFx(fxLayer, x, y, size) });
      for (const r of ripples) r.fx(t - r.at);
      if (ripples.length === 0) fxLayer.innerHTML = '';
    },
    browserBar(url, t) {
      if (!browserBarNode) {
        browserBarNode = el('div', `position:absolute;left:${(W - PHONE_W) / 2 + 26}px;top:168px;width:${PHONE_W - 52}px;height:118px;background:#fff;border-radius:999px;box-shadow:0 10px 34px rgba(18,32,46,.18);display:flex;align-items:center;padding:0 30px;gap:18px;z-index:15;`);
        const lock = el('div', 'width:30px;height:30px;color:#5b6873;', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="width:100%;height:100%"><rect x="4.5" y="10" width="15" height="10" rx="2.4"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/></svg>');
        const text = el('div', `font-size:33px;color:#1f2a33;font-weight:600;letter-spacing:.01em;`);
        browserBarNode.appendChild(lock);
        browserBarNode.appendChild(text);
        browserBarNode._text = text;
        stageRoot.appendChild(browserBarNode);
      }
      const typed = Math.floor(K(t, [[0.7, 0], [3.6, url.length]]));
      browserBarNode._text.textContent = url.slice(0, Math.max(0, typed)) + (typed < url.length ? '▍' : '');
    },
    clearBrowserBar() { browserBarNode?.remove(); browserBarNode = null; },
    scanRing(p) {
      if (!scanRingNode) {
        const { x, y } = phonePoint(0.5, 0.235);
        scanRingNode = el('div', `position:absolute;left:${x - 210}px;top:${y - 210}px;width:420px;height:420px;border:8px solid ${GOLD};border-radius:36px;box-shadow:0 0 0 8px rgba(216,177,92,.25);z-index:16;`);
        stageRoot.appendChild(scanRingNode);
      }
      scanRingNode.style.opacity = opacityText(p);
      scanRingNode.style.transform = `scale(${1.12 - ease(p) * 0.12})`;
    },
    clearScanRing() { scanRingNode?.remove(); scanRingNode = null; },
    tagPlatform(name) {
      if (!name) { platformTag?.remove(); platformTag = null; return; }
      if (!platformTag) {
        platformTag = el('div', `position:absolute;left:50%;top:230px;transform:translateX(-50%);background:${NAVY};color:#fff;font-weight:700;font-size:30px;padding:14px 32px;border-radius:999px;z-index:18;box-shadow:0 14px 34px rgba(14,36,56,.3);`);
        stageRoot.appendChild(platformTag);
      }
      platformTag.textContent = name;
    },
    /** Diagonal sheen sweeping the stage during a segment transition. p: 0..1. */
    fxSweep(p) {
      if (p <= 0 || p >= 1) { sweepNode.style.opacity = '0'; return; }
      sweepNode.style.opacity = opacityText(Math.sin(Math.PI * p) * 0.6);
      sweepNode.style.transform = `translateX(${(-0.45 + p * 1.9) * W}px)`;
    },
  };

  const starts = [];
  SEGMENTS.forEach((seg, i) => {
    starts.push(i === 0 ? 0 : starts[i - 1] + SEGMENTS[i - 1].len);
  });
  const TOTAL = SEGMENTS.reduce((sum, seg) => sum + seg.len, 0);

  /** Render the frame for global time t (seconds). */
  window.setTime = (t) => {
    now = t;
    let index = SEGMENTS.length - 1;
    for (let i = 0; i < SEGMENTS.length; i += 1) {
      if (t < starts[i] + SEGMENTS[i].len) { index = i; break; }
    }
    const seg = SEGMENTS[index];
    const local = Math.min(seg.len - 0.001, Math.max(0, t - starts[index]));

    // Ripple rings and chips are rebuilt from scratch every frame: a scene branch
    // that stops asking for them must not leave them frozen on screen.
    ripples = [];
    fxLayer.innerHTML = '';
    chipLayer.innerHTML = '';
    if (index !== lastSegment) {
      lastSegment = index;
      stage.clearBrowserBar();
      stage.clearScanRing();
      stage.tagPlatform(null);
      stage.clearShot();
      if (seg.id !== '01-welcome' && seg.id !== '10-record') layerA.style.opacity = '0';
    }

    seg.scene(local, stage);
    stage.tick();
    stage.tickLayers();

    // Segment transition: a short settle-in on the layers the scene just painted,
    // plus a light sheen sweeping the stage.
    const segIn = clamp01(local / SEG_XF);
    const segOut = clamp01((seg.len - local) / SEG_XF);
    const inE = easeOutCubic(segIn);
    const outE = easeOutCubic(segOut);
    const mult = Math.min(inE, outE);
    const fromIn = 1 - inE;
    const fromOut = 1 - outE;
    layerShot.style.transform = `translateY(${fromIn * 46 - fromOut * 30}px) scale(${1 + fromIn * 0.03 + fromOut * 0.025})`;
    layerShot.style.opacity = opacityText(Math.min(1, parseFloat(layerShot.style.opacity || '1')) * mult);
    layerCustom.style.transform = `translateY(${fromIn * 46 - fromOut * 30}px) scale(${1 + fromIn * 0.03 + fromOut * 0.025})`;
    layerCustom.style.opacity = opacityText(Math.min(1, parseFloat(layerCustom.style.opacity || '1')) * mult);
    layerA.style.transform = `translateY(${fromIn * 34 - fromOut * 24}px) scale(${1 + fromIn * 0.02 + fromOut * 0.02})`;
    let sweepP = 0;
    if (local < SEG_XF) sweepP = local / SEG_XF;
    else if (seg.len - local < SEG_XF) sweepP = 1 - (seg.len - local) / SEG_XF;
    stage.fxSweep(sweepP);

    header.set(SECTIONS[seg.section], seg.section + 1, SECTIONS.length, 1);
    rail.set(seg.section, local / seg.len);
    // The outro card and the home-screen mock are dark: fade the dark chrome there.
    let chromeO = 1;
    if (seg.id === '07-install') chromeO = Math.min(1, (1 - clamp01(local / 0.3)) + clamp01((local - 4.23) / 0.4));
    if (seg.id === '10-record') chromeO = Math.min(chromeO, clamp01((17.9 - local) / 0.5));
    header.root.style.opacity = opacityText(chromeO);
    document.getElementById('rail').style.opacity = opacityText(chromeO);
    const cap = captionAt(seg.phrases, local);
    captions.set(cap.text, cap.opacity);
    return { segment: seg.id, local, total: TOTAL };
  };

  window.__TOTAL = TOTAL;
  window.__SEGMENTS = SEGMENTS.map((seg, i) => ({ id: seg.id, len: seg.len, start: starts[i] }));
})();
