// DOU SNS 승인 알림 수신 (v20). 캐시/오프라인 기능 없음.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch{d={body:e.data?e.data.text():''};}
e.waitUntil(self.registration.showNotification(d.title||'DOU SNS',{body:d.body||'',icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||'dou-sns',renotify:true,data:{url:d.url||'./?tab=approval'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
e.waitUntil((async()=>{const all=await clients.matchAll({type:'window',includeUncontrolled:true});for(const c of all){if(c.url.startsWith(self.registration.scope)){await c.focus();try{await c.navigate(url);}catch{}return;}}await clients.openWindow(url);})());});
