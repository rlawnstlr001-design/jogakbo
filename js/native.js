// 앱(Capacitor) 안에서만 쓰는 기능. 웹에서는 isApp=false라 모두 웹 방식으로 대신한다.
// www 빌드 때 넣는 js/capacitor.js(코어)가 window.Capacitor를 만든다 — 트립N빵·안부한장과 같은 구조.
const C = window.Capacitor;
export const isApp = !!C?.isNativePlatform?.();
export const platform = isApp ? C.getPlatform() : 'web';

const plug = (name) => (isApp ? C.registerPlugin(name) : null);
const App = plug('App');
const Haptics = plug('Haptics');
const StatusBar = plug('StatusBar');
const Share = plug('Share');
const Filesystem = plug('Filesystem');
const Notify = plug('LocalNotifications');

const REVIEW_ID = 7001;

export function haptic() {
  if (!isApp) return;
  (platform === 'ios' ? Haptics.impact({ style: 'LIGHT' }) : Haptics.vibrate({ duration: 18 })).catch(() => {});
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// 앱 안에서는 내려받기가 안 되므로 임시 파일로 쓰고 공유 시트로 넘긴다 (저장·카톡·드라이브 등 사용자가 고름)
export async function shareFile(blob, name, title) {
  if (!isApp) return false;
  try {
    const data = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    await Share.share({ title, files: [uri], dialogTitle: title });
  } catch { /* 닫음 */ }
  return true;
}

// ---- 매일 아침 "오늘의 조각" 알림 ----
export async function notifyPermission(ask = false) {
  if (!isApp) return 'unsupported';
  try {
    let p = await Notify.checkPermissions();
    if (p.display !== 'granted' && ask) p = await Notify.requestPermissions();
    return p.display;
  } catch { return 'unavailable'; }
}

// time: 'HH:MM' 또는 null(끄기)
export async function scheduleReview(time) {
  if (!isApp) return false;
  try {
    await Notify.cancel({ notifications: [{ id: REVIEW_ID }] }).catch(() => {});
    if (!time) return true;
    if ((await notifyPermission(true)) !== 'granted') return false;
    if (platform === 'android') {
      await Notify.createChannel({ id: 'review', name: '오늘의 조각', description: '매일 아침 지난 조각 세 장 알림', importance: 3, vibration: true }).catch(() => {});
    }
    const [hour, minute] = time.split(':').map(Number);
    await Notify.schedule({
      notifications: [{
        id: REVIEW_ID,
        title: '오늘의 조각',
        body: '지난 조각 세 장을 꺼내 두었어요. 다시 읽어 볼까요?',
        channelId: 'review',
        schedule: { on: { hour, minute }, allowWhileIdle: true },
        extra: { hash: '#/today' },
      }],
    });
    return true;
  } catch { return false; }
}

export function initNative({ onBack, onOpenHash }) {
  if (!isApp) return;
  document.documentElement.classList.add('is-app', `is-${platform}`);
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  StatusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
  if (platform === 'android') StatusBar.setBackgroundColor({ color: dark ? '#141B24' : '#F3EFE6' }).catch(() => {});
  App.addListener('backButton', () => { if (!onBack()) App.exitApp(); });
  Notify.addListener('localNotificationActionPerformed', ({ notification }) => {
    const h = notification?.extra?.hash;
    if (h) onOpenHash(h);
  });
}
