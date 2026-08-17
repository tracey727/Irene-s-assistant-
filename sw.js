const CACHE='gigi-v4-polished';
const ASSETS=['/','/index.html','/styles.css','/security.css','/wellbeing.css','/polish.css','/app.js','/secure-features.js','/wellbeing.js','/manifest.webmanifest','/assets/gigi-mark.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request))));
