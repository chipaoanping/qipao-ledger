/* 旗跑帳本：讓手機可以「加入主畫面」、在網路不穩時先開啟畫面，並接收提醒通知 */
const CACHE='qipao-ledger-v5';
const SHELL=['./','index.html','config.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','pos.html','pos.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match(/pos\.html$/.test(u.pathname)?'pos.html':'index.html'))));
});
/* 推播提醒 */
self.addEventListener('push',e=>{
  let j={}; try{ j=e.data?e.data.json():{}; }catch(_){ j={data:{body:e.data&&e.data.text()}}; }
  const d=Object.assign({},j.notification||{},j.data||{});
  e.waitUntil(self.registration.showNotification(d.title||'旗跑・旗時',{body:d.body||'',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||undefined,data:{url:d.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{ for(const c of cs){ if('focus' in c){ c.navigate&&c.navigate(url).catch(()=>{}); return c.focus(); } } return self.clients.openWindow(url); }));
});
