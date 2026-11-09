/* 旗跑・旗時 POS 的 LINE Pay 後端
   - Channel ID / Channel Secret 只存在 Google Secret Manager（firebase functions:secrets:set），不會出現在網頁或 GitHub
   - 只有登入 POS 的店員帳號（public/staff 名單）可以呼叫
   - 收款：店員掃客人 LINE Pay App 的「付款碼」（oneTimeKey），這裡跟 LINE Pay 扣款
   - 退款：POS 作廢有 LINE Pay 扣款的那筆時，這裡跟 LINE Pay 退款
   每筆收款／退款都記在 Firestore linepay/{訂單代碼}（只有後端能寫）
   使用 LINE Pay 線下（Offline）API v2；正式上線前請對照 LINE Pay 給你的 API 文件確認路徑 */
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {defineSecret, defineString} = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const CHANNEL_ID = defineSecret('LINEPAY_CHANNEL_ID');
const CHANNEL_SECRET = defineSecret('LINEPAY_CHANNEL_SECRET');
const MODE = defineString('LINEPAY_MODE', {default: 'sandbox'});  /* sandbox = 測試環境；production = 正式收錢 */

const OPTS = {region: 'asia-east1', secrets: [CHANNEL_ID, CHANNEL_SECRET], timeoutSeconds: 60, maxInstances: 3};
const host = () => (MODE.value() === 'production' ? 'https://api-pay.line.me' : 'https://sandbox-api-pay.line.me');

/* 店員帳號的 email：跟 pos.html 的 emailOf 一樣 */
const hexOf = s => Buffer.from(String(s), 'utf8').toString('hex');
const emailOf = (name, v) => `s${hexOf(name)}${(v || 1) > 1 ? '-v' + v : ''}@qipao-ledger.app`;
async function requireStaff(req) {
  const em = req.auth && req.auth.token && req.auth.token.email;
  if (!em) throw new HttpsError('unauthenticated', '請先登入 POS');
  const d = await db.doc('public/staff').get();
  const ok = ((d.exists && d.data().people) || []).some(p => emailOf(p.name, p.v) === em);
  if (!ok) throw new HttpsError('permission-denied', '這個帳號不是店員');
  return em;
}

async function linePay(path, body, method = 'POST', timeoutMs = 40000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(host() + path, {
      method, signal: ctl.signal,
      headers: {'Content-Type': 'application/json', 'X-LINE-ChannelId': CHANNEL_ID.value(), 'X-LINE-ChannelSecret': CHANNEL_SECRET.value()},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return {...j, httpStatus: r.status};
  } finally { clearTimeout(t); }
}

const ORDER_RE = /^[A-Za-z0-9_-]{6,80}$/;

/* 收款：{orderId, amount, oneTimeKey, productName} */
exports.linePayPay = onCall(OPTS, async req => {
  const by = await requireStaff(req);
  const {orderId, oneTimeKey} = req.data || {};
  const amount = Math.round(Number(req.data && req.data.amount));
  const productName = String((req.data && req.data.productName) || '旗跑・旗時').slice(0, 100);
  if (!ORDER_RE.test(String(orderId || ''))) throw new HttpsError('invalid-argument', '訂單代碼不對');
  if (!(amount > 0 && amount <= 500000)) throw new HttpsError('invalid-argument', '金額不對');
  const key = String(oneTimeKey || '').replace(/\D/g, '');
  if (key.length < 12 || key.length > 24) throw new HttpsError('invalid-argument', '付款碼不對，請再掃一次');

  const ref = db.doc('linepay/' + orderId);
  const prev = await ref.get();
  if (prev.exists && prev.data().status === 'paid') return {ok: true, transactionId: prev.data().transactionId, already: true};
  /* 每次嘗試用新的 LINE Pay 訂單編號（同一個編號失敗後 LINE Pay 不給重用） */
  const lpOrderId = `${orderId}-${Date.now().toString(36)}`;
  await ref.set({orderId, lpOrderId, amount, status: 'paying', by, at: Date.now(), returnCode: '', returnMessage: ''}, {merge: true});

  let res;
  try {
    res = await linePay('/v2/payments/oneTimeKeys/pay', {productName, amount, currency: 'TWD', orderId: lpOrderId, oneTimeKey: key});
  } catch (e) {
    /* 逾時：問 LINE Pay 這筆到底有沒有成功 */
    const chk = await linePay(`/v2/payments/orders/${encodeURIComponent(lpOrderId)}/check`, null, 'GET', 15000).catch(() => null);
    if (chk && chk.returnCode === '0000') res = chk;
    else { await ref.set({status: 'unknown', err: 'timeout'}, {merge: true}); throw new HttpsError('deadline-exceeded', 'LINE Pay 沒有回應，請到 LINE Pay 商家後台確認這筆有沒有扣款'); }
  }
  if (res.returnCode !== '0000') {
    await ref.set({status: 'failed', returnCode: res.returnCode || '', returnMessage: res.returnMessage || ''}, {merge: true});
    throw new HttpsError('failed-precondition', `LINE Pay 扣款失敗（${res.returnCode || res.httpStatus}）${res.returnMessage || ''}`);
  }
  const transactionId = String((res.info && res.info.transactionId) || '');
  await ref.set({status: 'paid', transactionId, paidAt: Date.now(), mode: MODE.value()}, {merge: true});
  return {ok: true, transactionId};
});

/* 退款：{orderId}，退那筆的全額 */
exports.linePayRefund = onCall(OPTS, async req => {
  const by = await requireStaff(req);
  const orderId = String((req.data && req.data.orderId) || '');
  if (!ORDER_RE.test(orderId)) throw new HttpsError('invalid-argument', '訂單代碼不對');
  const ref = db.doc('linepay/' + orderId), d = await ref.get();
  if (!d.exists || d.data().status !== 'paid') {
    if (d.exists && d.data().status === 'refunded') return {ok: true, already: true};
    throw new HttpsError('failed-precondition', '這筆沒有 LINE Pay 扣款紀錄');
  }
  const res = await linePay(`/v2/payments/orders/${encodeURIComponent(d.data().lpOrderId || orderId)}/refund`, {refundAmount: d.data().amount});
  if (res.returnCode !== '0000') throw new HttpsError('failed-precondition', `LINE Pay 退款失敗（${res.returnCode || res.httpStatus}）${res.returnMessage || ''}`);
  await ref.set({status: 'refunded', refundTransactionId: String((res.info && res.info.refundTransactionId) || ''), refundedAt: Date.now(), refundBy: by}, {merge: true});
  return {ok: true};
});

/* 給測試用 */
exports._test = {emailOf};
