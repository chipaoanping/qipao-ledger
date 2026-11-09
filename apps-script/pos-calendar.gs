/* 旗跑・旗時 POS「今日預約」：讀 Google 日曆今天的預約，給 POS 帶入顧客姓名、電話
   安裝方式見 docs/calendar.md。用店裡的 Google 帳號（chipao.anping@gmail.com）建立。
   網址裡的 key 是密碼，只貼在 POS 的設定裡，不要放到 GitHub。 */
const CALS = {
  qp: '0030b2fcc0fd6886428daa0e8997835e72849902ea678bcbc01221b7f5c6e5ad@group.calendar.google.com',  // 旗跑（安平）
  yl: '65168488b6bccdea9e7fe98c9e393a0b606159ba07bdf9583bfcc9a8e4e0356a@group.calendar.google.com',  // 旗時（永樂）
};
const TZ = 'Asia/Taipei';

/* 第一次安裝時執行一次：產生 key，執行紀錄裡會顯示 */
function makeKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('POS_KEY', key);
  Logger.log('key = ' + key + '\n部署成網頁應用程式後，把網址後面加上 ?key=' + key + ' 貼到 POS 設定');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const key = PropertiesService.getScriptProperties().getProperty('POS_KEY');
  if (!key || p.key !== key) return out({error: 'key'});
  const id = CALS[p.br];
  if (!id) return out({error: 'branch'});
  const cal = CalendarApp.getCalendarById(id);
  if (!cal) return out({error: 'calendar'});
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const start = new Date(day + 'T00:00:00+08:00'), end = new Date(start.getTime() + 864e5);
  const events = cal.getEvents(start, end).map(ev => ({
    id: ev.getId(),
    title: ev.getTitle(),
    desc: ev.getDescription() || '',
    start: ev.isAllDayEvent() ? '' : Utilities.formatDate(ev.getStartTime(), TZ, 'HH:mm'),
  }));
  return out({date: day, events});
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
