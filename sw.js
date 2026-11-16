/* offline cache: only active when served over https.
   The build (tools/build.js) replaces this name with one made from the page's
   contents, so each new version replaces the last on the phone. */
const CACHE = 'oklahoma-gin-925fad70ce';
const PAGE = './index.html';   // the one page: every launch of the app is served this
const ASSETS = [PAGE, './icon-512.png', './icon-192.png', './apple-touch-icon.png', './manifest.webmanifest'];

/* A new version installs and waits when an open page speaks the update
   protocol (below). The page offers it on the home screen (main.js); a tap
   there sends 'take-over'. Ignored, it takes over at the next launch (launch,
   below). The files are fetched past the browser's own cache, so what is
   stored is the build this name was made from.                             */
/* The safety net for a page that cannot ask: once its files are stored, the new
   version asks the open windows whether they speak this protocol (main.js answers
   'update-protocol'). If none answers within ASK_MS (a page from before the
   protocol, or no window open at all), it takes over at once, as versions before
   this one did. A page that answers keeps the polite flow: wait, offer the note,
   never in a hand. Asked once per install; nothing here reloads a page, and the
   old version's files stay until this one has activated (activate, below).    */
const ASK_MS = 2000;
let heard = null;   // set while the open windows are being asked
function pageSpeaksUpdates() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    if (!list || !list.length) return false;
    return new Promise(done => {
      const ports = [];
      let settled = false;
      const finish = yes => {
        if (settled) return;
        settled = true; heard = null;
        ports.forEach(p => { try { p.close(); } catch (err) {} });
        done(yes);
      };
      heard = () => finish(true);
      list.forEach(c => {
        try {
          const ch = new MessageChannel();
          ch.port1.onmessage = ev => { if (ev.data && ev.data.type === 'update-protocol') finish(true); };
          ports.push(ch.port1);
          c.postMessage({ type: 'update-protocol?' }, [ch.port2]);
        } catch (err) {
          try { c.postMessage({ type: 'update-protocol?' }); } catch (err2) { /* that window cannot be asked */ }
        }
      });
      setTimeout(() => finish(false), ASK_MS);
    });
  }).catch(() => false);
}
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(pageSpeaksUpdates)
    .then(polite => { if (!polite) return self.skipWaiting(); }));
});
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'take-over') self.skipWaiting();
  else if (e.data.type === 'update-protocol' && heard) heard();   // an answer sent back without the channel
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
/* A launch with no window of the app open while a new version waits: the
   page comes from the new version's files and the new version takes over,
   so it arrives with this launch, never in the middle of one. Anything that
   goes wrong here falls back to this version's own page.                  */
async function launch(req) {
  try {
    const next = self.registration.waiting;
    if (next && !(await self.clients.matchAll({ type: 'window' })).length) {
      const theirs = (await caches.keys()).filter(k => k !== CACHE && k.indexOf('oklahoma-gin-') === 0).pop();
      const page = theirs && await (await caches.open(theirs)).match(PAGE);
      if (page) { next.postMessage({ type: 'take-over' }); return page; }
    }
  } catch (err) { /* this version's page, below */ }
  const own = await caches.open(CACHE).then(c => c.match(PAGE)).catch(() => null);
  return own || fetch(req).catch(() => caches.match(PAGE));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') { e.respondWith(launch(e.request)); return; }
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
