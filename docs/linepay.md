# LINE Pay 自動扣款：設定步驟

POS 結帳選 LINE Pay 時，會跳出視窗讓店員掃客人 LINE Pay 的「付款碼」，由後端直接跟 LINE Pay 扣款；作廢那筆時會自動退款。

**安全：** LINE Pay 的 Channel Secret 只存在 Google 的 Secret Manager，**不會**出現在這個 GitHub repo 或網頁裡。請不要把 Channel ID／Secret 貼到 repo、網頁設定或聊天裡。

## 1. 跟 LINE Pay 申請 API

1. 登入 LINE Pay 商家後台（pay.line.me）。
2. 申請開通 API，並說明要用 **線下（Offline）付款**，也就是店員掃客人的付款碼。
3. 拿到 **Channel ID** 和 **Channel Secret**。後台通常也有測試用（Sandbox）的 ID 和 Secret，可以先用測試的。
4. 對照 LINE Pay 給你的 API 文件，確認 `functions/index.js` 用的路徑一樣：
   - 收款 `POST /v2/payments/oneTimeKeys/pay`
   - 查詢 `GET /v2/payments/orders/{orderId}/check`
   - 退款 `POST /v2/payments/orders/{orderId}/refund`

## 2. Firebase 升級成 Blaze（用多少付多少）

1. 到 Firebase 主控台，打開專案 **qipao-ledger-62842**，左下角選「升級」，改成 **Blaze**。
2. 到 Google Cloud 的「預算與快訊」設一個預算提醒，例如每月 NT$300。
3. 店裡的用量很小，一般會在免費額度內，幾乎不用錢。

## 3. 在電腦上部署後端（只要做一次）

需要一台裝了 Node.js 20 以上的電腦。

```bash
npm install -g firebase-tools
firebase login                     # 用 Firebase 專案的 Google 帳號登入
git clone https://github.com/chipaoanping/qipao-ledger.git
cd qipao-ledger/functions && npm install && cd ..

# 填 LINE Pay 的帳密（會問你，輸入後存在 Google，不會存在電腦或 GitHub）
firebase functions:secrets:set LINEPAY_CHANNEL_ID
firebase functions:secrets:set LINEPAY_CHANNEL_SECRET

firebase deploy --only functions
```

部署時會問 `LINEPAY_MODE`：

- 先填 `sandbox`（測試環境，不會真的扣錢），用 LINE Pay 的測試帳密測。
- 測好後，把 Secret 換成正式的帳密，再部署一次，這次填 `production`。

要改模式時，修改 `functions/.env.qipao-ledger-62842` 裡的 `LINEPAY_MODE=production`，再跑一次 `firebase deploy --only functions`。

## 4. 在 POS 打開

用妃妃或郁雯的帳號登入 POS，到「設定」→「LINE Pay 自動扣款」，按「開」。兩家店會一起套用。

要暫停時按「關（只記錄金額）」，就會回到原本的做法：用店裡的收款碼收款，POS 只記錄金額。

## 會發生什麼

- **扣款失敗**（付款碼過期、餘額不足等）：會顯示原因，這筆不會結帳，購物車還在，可以再掃一次或改其他付款方式。
- **LINE Pay 沒有回應**：會提醒你到 LINE Pay 商家後台確認這筆有沒有扣到。
- **沒有網路**：不能用 LINE Pay 扣款，請改其他付款方式。
- **作廢**：會先跟 LINE Pay 退全額。退款失敗時會問你要不要還是作廢；選要的話，請自己到商家後台退款。
- 每筆扣款和退款都記在 Firestore 的 `linepay/{訂單代碼}`。只有後端能寫，網頁不需要額外的 Firestore 規則。
