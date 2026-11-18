/**
 * The LASUATOS cursor on the status page: the same viewfinder as the app
 * (apps/web/components/public/site-cursor.tsx), as a plain script because this page has no
 * React and its policy only runs the one nonce'd script.
 *
 * - A dot sits exactly on the pointer. Four corner brackets trail it, lock on to a link or
 *   button and frame it in gold, and close in when it is pressed.
 * - Here they also frame a single day of the history bars, so the page "scans" the day whose
 *   tooltip is showing.
 * - Mouse and trackpad only. Touch, reduced motion, forced colours, Data Saver and weak
 *   hardware keep the system cursor, and so does a device that keeps stalling.
 * - Text fields and the scrollbar keep the system cursor.
 * - It costs five composited transforms while the mouse moves. No timers run once
 *   everything has settled.
 *
 * cursor.test.ts checks the shared numbers, selectors and colours against the app's file, so
 * if you change one, change both.
 */

export const CURSOR = {
  corner: 8, // bracket size, px
  free: 12, // half-size of the resting viewfinder, px
  lockMaxW: 520, // bigger targets are not framed, just hinted
  lockMaxH: 220,
  easeFree: 38, // ms time constants for the trailing brackets
  easeLock: 62,
  stallMs: 200,
  stallsToStop: 3,
  stallWindowMs: 10_000,
} as const;

/** The app's list, word for word (checked by the test). */
export const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"], summary, label[for], select, [data-cursor="lock"]';
const TEXT_FIELD = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"], [type="image"]), textarea, [contenteditable]:not([contenteditable="false"])';
const NATIVE_ZONE = 'dialog, [popover], [data-cursor="native"]';
/** The navy footer and the bar tooltip. */
const DARK = '.ft, .tip, [data-cursor="dark"]';
const LIGHT = '[data-cursor="light"]';
const DAY = '.bars span';
const OFF_KEY = 'lasuatos:cursor-off';

const q = JSON.stringify;

/** Starts with `;` so it can follow another script that ends in `})()` without becoming a call. */
export const CURSOR_SCRIPT = `;(()=>{const d=document,html=d.documentElement,nav=navigator;
const C=${CURSOR.corner},FREE=${CURSOR.free},MW=${CURSOR.lockMaxW},MH=${CURSOR.lockMaxH};
const INTERACTIVE=${q(`${INTERACTIVE}, ${DAY}`)},TEXT=${q(TEXT_FIELD)},NATIVE=${q(NATIVE_ZONE)},DARK=${q(DARK)},LIGHT=${q(LIGHT)},DAY=${q(DAY)},KEY=${q(OFF_KEY)};
const fine=matchMedia('(hover: hover) and (pointer: fine)'),calm=matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
const weak=()=>(nav.deviceMemory!==undefined&&nav.deviceMemory<=2)||(nav.hardwareConcurrency>0&&nav.hardwareConcurrency<=2)||!!(nav.connection&&nav.connection.saveData);
const off=()=>{try{return sessionStorage.getItem(KEY)==='1'}catch{return false}};
const allowed=()=>fine.matches&&!calm.matches&&!weak()&&!off();
const root=d.createElement('div');root.className='site-cursor';root.setAttribute('aria-hidden','true');
root.innerHTML='<i class="site-cursor-dot"><b></b></i><i class="site-cursor-c is-tl"></i><i class="site-cursor-c is-tr"></i><i class="site-cursor-c is-bl"></i><i class="site-cursor-c is-br"></i>';
d.body.append(root);
const [dot,...corners]=root.children;
let running=false,raf=0,last=0,x=-100,y=-100,seen=false,visible=false,native=false,pressed=false,lock=null,hint=false,stalls=[],obs=null;
const at=[0,1,2,3].map(()=>({x:0,y:0}));
const cls=(n,on)=>root.classList.toggle(n,on);
const show=on=>{if(visible===on)return;visible=on;cls('is-hidden',!on)};
const rectFor=el=>{const rs=el.getClientRects();if(!rs.length)return null;if(rs.length===1)return rs[0];let best=null,bd=1/0;for(const r of rs){const dd=Math.max(r.left-x,0,x-r.right)+Math.max(r.top-y,0,y-r.bottom);if(dd<bd){best=r;bd=dd}}return best};
const box=()=>{if(lock){const r=rectFor(lock);
if(!r||x<r.left-2||x>r.right+2||y<r.top-2||y>r.bottom+2){lock=null;cls('is-lock',false)}
else{const day=lock.matches(DAY),small=r.height<30,px=day?3:small?6:7,py=day?4:small?4:7,cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
const ux=day?0:Math.max(-4,Math.min(4,(x-cx)*.06)),uy=day?0:Math.max(-3,Math.min(3,(y-cy)*.12)),inset=pressed?2.5:0;
return{l:r.left-px+ux+inset,t:r.top-py+uy+inset,r:r.right+px+ux-inset,b:r.bottom+py+uy-inset}}}
const s=pressed?FREE-3:hint?FREE+3:FREE;return{l:x-s,t:y-s,r:x+s,b:y+s}};
const frame=now=>{raf=0;const dt=last?Math.min(64,now-last):16;last=now;const b=box();
const goals=[[b.l,b.t],[b.r-C,b.t],[b.l,b.b-C],[b.r-C,b.b-C]],k=1-Math.exp(-dt/(lock?${CURSOR.easeLock}:${CURSOR.easeFree}));let moving=false;
for(let i=0;i<4;i++){const p=at[i],gx=goals[i][0],gy=goals[i][1],dx=gx-p.x,dy=gy-p.y;if(Math.abs(dx)>.05||Math.abs(dy)>.05){p.x+=dx*k;p.y+=dy*k;moving=true}else{p.x=gx;p.y=gy}}
dot.style.transform='translate3d('+x+'px,'+y+'px,0)';for(let i=0;i<4;i++)corners[i].style.transform='translate3d('+at[i].x+'px,'+at[i].y+'px,0)';
if(moving)raf=requestAnimationFrame(frame);else last=0};
const schedule=()=>{if(!raf&&running)raf=requestAnimationFrame(frame)};
const classify=t=>{const el=t instanceof Element?t:null;
native=!el||!!d.fullscreenElement||!!el.closest(NATIVE)||el.matches(TEXT)||!!el.closest(TEXT);if(native){show(false);return}
if(seen)show(true);
if(lock&&lock.parentElement===el&&lock.matches(DAY)){schedule();return}
const c=el.closest(INTERACTIVE),blocked=c?c.matches(':disabled, [aria-disabled="true"]'):false;let nl=null,nh=false;
if(c&&!blocked){const r=c.getBoundingClientRect();if(r.width<=MW&&r.height<=MH)nl=c;else nh=true}
lock=nl;hint=nh;cls('is-lock',!!nl);cls('is-hint',nh);cls('is-blocked',blocked);const dk=el.closest(DARK),lt=dk&&el.closest(LIGHT);cls('is-dark',!!dk&&!(lt&&dk.contains(lt)));schedule()};
const onMove=e=>{if(e.pointerType!=='mouse'||d.fullscreenElement){show(false);return}x=e.clientX;y=e.clientY;
if(!seen){seen=true;for(const p of at){p.x=x-C/2;p.y=y-C/2}html.classList.add('cursor-on');classify(e.target)}
if(x>=html.clientWidth||y>=html.clientHeight)show(false);else if(!native)show(true);schedule()};
const onOver=e=>{if(e.pointerType==='mouse')classify(e.target)};
const onDown=e=>{if(e.pointerType!=='mouse'||e.button!==0)return;pressed=true;cls('is-press',true);schedule()};
const onUp=()=>{if(!pressed)return;pressed=false;cls('is-press',false);schedule()};
const onLeave=e=>{if(!e.relatedTarget)show(false)};
const onBlur=()=>{show(false);onUp()};
const onScroll=()=>{if(lock)schedule()};
const L=[[window,'pointermove',onMove],[d,'pointerover',onOver],[window,'pointerdown',onDown],[window,'pointerup',onUp],[window,'pointercancel',onUp],[d,'mouseout',onLeave],[window,'blur',onBlur],[window,'scroll',onScroll]];
const start=()=>{if(running||!allowed())return;running=true;cls('is-live',true);cls('is-hidden',true);visible=false;
for(const [t,n,f] of L)t.addEventListener(n,f,{passive:true,capture:n==='scroll'});
if(typeof PerformanceObserver!=='undefined'&&(PerformanceObserver.supportedEntryTypes||[]).includes('longtask')){
obs=new PerformanceObserver(list=>{if(!visible)return;for(const en of list.getEntries())if(en.duration>=${CURSOR.stallMs})stalls.push(en.startTime);
const recent=performance.now()-${CURSOR.stallWindowMs};stalls=stalls.filter(s=>s>=recent);
if(stalls.length>=${CURSOR.stallsToStop}){try{sessionStorage.setItem(KEY,'1')}catch{}stop()}});obs.observe({type:'longtask'})}};
const stop=()=>{if(!running)return;running=false;if(raf)cancelAnimationFrame(raf);raf=0;last=0;seen=false;lock=null;if(obs)obs.disconnect();obs=null;
html.classList.remove('cursor-on');root.className='site-cursor';for(const [t,n,f] of L)t.removeEventListener(n,f,{capture:n==='scroll'})};
const onMedia=()=>{if(allowed())start();else stop()};fine.addEventListener('change',onMedia);calm.addEventListener('change',onMedia);start()})()`;

/** The app's cursor styles (globals.css, "Site cursor"), with this page's colours. */
export const CURSOR_CSS = `
html.cursor-on,html.cursor-on body,html.cursor-on body *:not(dialog,dialog *,[popover],[popover] *,[data-cursor="native"],[data-cursor="native"] *){cursor:none!important}
:where(html.cursor-on) :where(dialog,[popover],[data-cursor="native"]){cursor:auto}
html.cursor-on body :is(${TEXT_FIELD}){cursor:text!important}
.site-cursor{position:fixed;top:0;left:0;z-index:2147483000;display:none;width:0;height:0;pointer-events:none;transition:opacity 180ms ease}
.site-cursor.is-live{display:block}.site-cursor.is-hidden{opacity:0}
.site-cursor>i{position:absolute;top:0;left:0;will-change:transform}
.site-cursor-dot b{position:absolute;top:-3.5px;left:-3.5px;width:7px;height:7px;border-radius:50%;background:#10202e;box-shadow:0 0 0 1.5px rgb(255 255 255/90%);transition:transform 200ms cubic-bezier(.22,1,.36,1),opacity 160ms ease}
.site-cursor-c{width:8px;height:8px;border:0 solid rgb(16 32 46/46%);transition:border-color 180ms ease}
.site-cursor-c.is-tl{border-width:2px 0 0 2px;border-top-left-radius:3px}
.site-cursor-c.is-tr{border-width:2px 2px 0 0;border-top-right-radius:3px}
.site-cursor-c.is-bl{border-width:0 0 2px 2px;border-bottom-left-radius:3px}
.site-cursor-c.is-br{border-width:0 2px 2px 0;border-bottom-right-radius:3px}
.site-cursor.is-hint .site-cursor-c{border-color:rgb(16 32 46/80%)}
.site-cursor.is-lock .site-cursor-c{border-color:#b8872e}
.site-cursor.is-lock .site-cursor-dot b{transform:scale(.55)}
.site-cursor.is-press .site-cursor-dot b{transform:scale(.4)}
.site-cursor.is-blocked .site-cursor-dot b{opacity:.4}
.site-cursor.is-dark .site-cursor-dot b{background:#fff;box-shadow:0 0 0 1.5px rgb(11 36 57/55%)}
.site-cursor.is-dark .site-cursor-c{border-color:rgb(255 255 255/58%)}
.site-cursor.is-dark.is-hint .site-cursor-c{border-color:rgb(255 255 255/90%)}
.site-cursor.is-dark.is-lock .site-cursor-c{border-color:#e3bf6f}
@media print{.site-cursor{display:none!important}}
`;
