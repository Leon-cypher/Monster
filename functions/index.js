const { setGlobalOptions } = require("firebase-functions/v2");

// ======================================================================
//  匯入依賴
// ======================================================================
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

// 設定全域配置
setGlobalOptions({ region: "asia-east1", cors: true });
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const xlsx = require("xlsx");

// ======================================================================
//  初始化 Firebase Admin SDK
// ======================================================================
admin.initializeApp();
const db = getFirestore();

// ======================================================================
//  Admin Token 驗證
// ======================================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function requireAdmin(request) {
  const token = request.data?.adminToken;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    throw new HttpsError('permission-denied', '未授權的操作');
  }
}

// ======================================================================
//  共用工具函數
// ======================================================================

function getBranchFromFileName(fileName) {
  if (!fileName) return "unknown";
  const match = fileName.match(/^(?:pos)_(.+?)_\d{8}\.xlsx/i);
  return match && match[1] ? match[1] : "unknown";
}

function getDateFromFileName(fileName) {
  if (!fileName) return null;
  const match = fileName.match(/_(\d{4})(\d{2})(\d{2})\.xlsx/i);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getPlayerId(row) {
  return String(row["顧客編號"] || row["會員編號"] || row["玩家ID"] || "");
}

function getPlayerName(row) {
  return String(row["顧客姓名"] || row["持卡人"] || row["姓名"] || "");
}

function getCheckoutTime(row) {
  const checkoutTimeStr = row["結帳時間"] || row["checkout_time"] || "";
  if (!checkoutTimeStr) return null;
  try {
    const timeStr = String(checkoutTimeStr).trim();
    const fullTimeStr = timeStr.includes(':') && timeStr.split(':').length === 2 ? timeStr + ':00' : timeStr;
    const taipeiTimeStr = fullTimeStr + '+08:00';
    const date = new Date(taipeiTimeStr);
    return isNaN(date.getTime()) ? null : date;
  } catch (error) {
    return null;
  }
}

function parseItemValue(itemname) {
  if (!itemname) return 0;
  const match = String(itemname).match(/\d{3,5}/);
  return match ? parseInt(match[0], 10) : 0;
}

function getRandomSuffix() {
  return Math.random().toString(36).substring(2, 6);
}

function getFormattedTimestamp(date) {
  let validDate = (date && typeof date.toDate === 'function') ? date.toDate() : (date instanceof Date ? date : new Date(date));
  if (isNaN(validDate.getTime())) validDate = new Date();
  
  const YYYY = validDate.getFullYear();
  const MM = String(validDate.getMonth() + 1).padStart(2, '0');
  const DD = String(validDate.getDate()).padStart(2, '0');
  const HH = String(validDate.getHours()).padStart(2, '0');
  const mm = String(validDate.getMinutes()).padStart(2, '0');
  const ss = String(validDate.getSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}-${HH}${mm}${ss}`;
}

// ======================================================================
//  1. 處理 POS 報表上傳 (自動觸發)
// ======================================================================
exports.processPOS = onObjectFinalized(
  { region: "asia-east1", memory: "256MiB", minInstances: 0 },
  async (event) => {
    const filePath = event.data.name;
    const fileName = filePath.split("/").pop();

    if (!filePath.startsWith("reports/") || !fileName.toLowerCase().startsWith("pos_")) return null;

    const recordDate = getDateFromFileName(fileName);
    const branchId = getBranchFromFileName(fileName);
    if (!recordDate || branchId === 'unknown') return null;

    try {
      const bucket = admin.storage().bucket(event.data.bucket);
      const [fileBuffer] = await bucket.file(filePath).download();
      const workbook = xlsx.read(fileBuffer, { type: "buffer" });
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      if (data.length === 0) return null;

      // 1. 預先產生所有 docId 並收集
      const rowsToProcess = [];
      const transactionItemTracker = {};
      const docIds = [];

      for (const row of data) {
        const tId = String(row["銷售單號"] || row["單號"] || "");
        const pId = getPlayerId(row);
        if (!tId || !pId) continue;

        const itemName = String(row["商品名稱"] || "");
        const trackerKey = `${tId}_${itemName}`;
        transactionItemTracker[trackerKey] = (transactionItemTracker[trackerKey] || 0) + 1;
        const itemSequence = transactionItemTracker[trackerKey];
        const docId = `${branchId}_${tId}_${itemName}_${itemSequence}`.replace(/\s+/g, '');
        
        docIds.push(docId);
        rowsToProcess.push({ docId, row, tId, pId, itemName });
      }

      if (docIds.length === 0) return null;

      // 2. 批次抓取這些 ID 的現有狀態 (每 500 筆一組)
      const processedIds = new Set();
      const docRefs = docIds.map(id => db.collection("pos_records").doc(id));
      
      // 分段處理以符合 getAll 的限制
      for (let i = 0; i < docRefs.length; i += 500) {
        const chunk = docRefs.slice(i, i + 500);
        const snapshots = await db.getAll(...chunk);
        snapshots.forEach(snap => {
          if (snap.exists && snap.data().processed === true) {
            processedIds.add(snap.id);
          }
        });
      }

      const batch = db.batch();
      let newlyAdded = 0;
      let batchCount = 0;

      for (const item of rowsToProcess) {
        if (processedIds.has(item.docId)) continue;

        batch.set(db.collection("pos_records").doc(item.docId), {
          playerId: item.pId, playerName: getPlayerName(item.row), branchId: branchId,
          date: recordDate, itemName: item.itemName, transactionId: item.tId,
          checkoutTime: getCheckoutTime(item.row), processed: false,
          sourceFile: fileName, createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        
        newlyAdded++;
        if (++batchCount >= 450) { await batch.commit(); batchCount = 0; }
      }

      if (batchCount > 0) await batch.commit();
      logger.info(`[POS] ${fileName} 處理完成。新增: ${newlyAdded}`);
      return null;
    } catch (error) {
      logger.error(`[POS] 錯誤:`, error);
      return null;
    }
  }
);

// ======================================================================
//  2. 每日排程計算點數 (15:00)
// ======================================================================
exports.scheduledCalculatePoints = onSchedule(
  { schedule: "0 15 * * *", timeZone: "Asia/Taipei", region: "asia-east1", memory: "256MiB", minInstances: 0 },
  async (event) => {
    return await runCalculationLogic("SCHEDULED");
  }
);

// ======================================================================
//  階段自動切換排程 (Asia/Taipei)
// ======================================================================
async function activatePhase(phaseNumber) {
  const labels = [
    '第一階段　4/1 ～ 4/16',
    '第二階段　4/17 ～ 5/1',
    '第三階段　5/2 ～ 5/16',
    '第四階段　5/17 ～ 5/31',
  ];
  const batch = db.batch();
  for (let i = 1; i <= 4; i++) {
    batch.set(db.collection('phases').doc(String(i)), {
      active: i === phaseNumber,
      ...(i === phaseNumber ? { label: labels[phaseNumber - 1] } : {}),
    }, { merge: true });
  }
  await batch.commit();
  logger.info(`[Phase] 已自動切換至第 ${phaseNumber} 階段`);
}

// 第一階段：4/1 00:00 台北時間
exports.activatePhase1 = onSchedule(
  { schedule: "0 0 1 4 *", timeZone: "Asia/Taipei", region: "asia-east1", memory: "128MiB", minInstances: 0 },
  async () => { await activatePhase(1); }
);

// 第二階段：4/17 11:00 台北時間
exports.activatePhase2 = onSchedule(
  { schedule: "0 11 17 4 *", timeZone: "Asia/Taipei", region: "asia-east1", memory: "128MiB", minInstances: 0 },
  async () => { await activatePhase(2); }
);

// 第三階段：5/2 11:00 台北時間
exports.activatePhase3 = onSchedule(
  { schedule: "0 11 2 5 *", timeZone: "Asia/Taipei", region: "asia-east1", memory: "128MiB", minInstances: 0 },
  async () => { await activatePhase(3); }
);

// 第四階段：5/17 11:00 台北時間
exports.activatePhase4 = onSchedule(
  { schedule: "0 11 17 5 *", timeZone: "Asia/Taipei", region: "asia-east1", memory: "128MiB", minInstances: 0 },
  async () => { await activatePhase(4); }
);

// ======================================================================
//  5. 手動觸發計分 API
// ======================================================================
exports.triggerManualCalculation = onCall({ cors: true, region: "asia-east1", memory: "128MiB", minInstances: 0, invoker: "public" }, async (request) => {
  requireAdmin(request);
  return await runCalculationLogic("MANUAL");
});

// 核心計分邏輯封裝
async function runCalculationLogic(operator) {
  // 設定斷點：當日台北時間 06:00:00 (確保只處理已結束的營業日)
  const now = new Date();
  const taipeiOffset = 8 * 60 * 60 * 1000;
  const taipeiNow = new Date(now.getTime() + taipeiOffset);
  
  // 建立台北時間今天 06:00:00 的 Date
  const cutoffTaipei = new Date(taipeiNow);
  cutoffTaipei.setUTCHours(6, 0, 0, 0);
  
  // 轉回標準 UTC Date 供 Firestore 查詢
  const cutoff = new Date(cutoffTaipei.getTime() - taipeiOffset);

  logger.info(`[Calculation] 操作者: ${operator}, 台北現在: ${taipeiNow.toISOString()}, 台北斷點: ${cutoffTaipei.toISOString()}, 查詢斷點 (UTC): ${cutoff.toISOString()}`);

  const recordsSnapshot = await db.collection('pos_records')
    .where('processed', '==', false)
    .where('checkoutTime', '<=', cutoff)
    .get();

  if (recordsSnapshot.empty) {
    logger.info(`[Calculation] 斷點前無待處理資料。`);
    return { success: true, message: "無待處理資料 (已過濾斷點)" };
  }

  logger.info(`[Calculation] 發現 ${recordsSnapshot.size} 筆待處理紀錄。`);

  const branchPlayerEvents = {}; 
  recordsSnapshot.forEach(doc => {
    const r = doc.data();
    const val = parseItemValue(r.itemName);
    let pts = 0;
    if (val >= 11000) pts = 5;
    else if (val >= 6600) pts = 3;
    else if (val >= 3400) pts = 2;
    else if (val >= 1200) pts = 1;

    if (pts > 0) {
      if (!branchPlayerEvents[r.branchId]) branchPlayerEvents[r.branchId] = {};
      if (!branchPlayerEvents[r.branchId][r.playerId]) {
        branchPlayerEvents[r.branchId][r.playerId] = { events: [], playerName: r.playerName };
      }
      branchPlayerEvents[r.branchId][r.playerId].events.push({
        points: pts, sourceRecordId: doc.id, sourceFile: r.sourceFile || 'unknown',
        checkoutTime: r.checkoutTime, description: `參加 ${r.itemName}`
      });
    }
  });

  for (const bId in branchPlayerEvents) {
    for (const pId in branchPlayerEvents[bId]) {
      const { events, playerName } = branchPlayerEvents[bId][pId];
      const totalPts = events.reduce((s, e) => s + e.points, 0);
      const pRef = db.collection("playerScores").doc(`${pId}_${bId}`);

      await db.runTransaction(async (transaction) => {
        const pDoc = await transaction.get(pRef);
        const curP = pDoc.exists ? pDoc.data().points || 0 : 0;
        const curC = pDoc.exists ? pDoc.data().lotteryChances || 0 : 0;
        const total = curP + totalPts;
        
        transaction.set(pRef, {
          playerId: pId, branchId: bId, points: total % 10, lotteryChances: curC + Math.floor(total / 10),
          lastUpdated: FieldValue.serverTimestamp(), playerName: playerName
        }, { merge: true });

        events.forEach(e => {
          const tId = `${getFormattedTimestamp(e.checkoutTime || new Date())}_${pId}_EARN_${getRandomSuffix()}`;
          transaction.set(db.collection("pointTransactions").doc(tId), {
            playerId: pId, branchId: bId, checkoutTime: e.checkoutTime || new Date(),
            type: 'EARN_POINTS', pointsChanged: e.points, chancesChanged: 0,
            description: e.description, operator: operator, sourceRecordId: e.sourceRecordId, sourceFile: e.sourceFile
          });
        });

        const newCards = Math.floor(total / 10);
        if (newCards > 0) {
          const tId = `${getFormattedTimestamp(new Date())}_${pId}_REDEEM_${getRandomSuffix()}`;
          transaction.set(db.collection("pointTransactions").doc(tId), {
            playerId: pId, branchId: bId, checkoutTime: new Date(),
            type: 'REDEEM_CARD', pointsChanged: -(newCards * 10), chancesChanged: newCards,
            description: `自動兌換 ${newCards} 張`, operator: 'SYSTEM'
          });
        }
      });
    }
  }
  
  const finalBatch = db.batch();
  recordsSnapshot.forEach(doc => finalBatch.update(doc.ref, { processed: true }));
  await finalBatch.commit();
  return { success: true, message: "計算完成" };
}

// ======================================================================
//  3. 查詢玩家資訊 API
// ======================================================================
exports.getUserPoints = onCall({ cors: true, region: "asia-east1", memory: "128MiB", minInstances: 0, invoker: "public" }, async (request) => {
  const { playerId, branchId } = request.data;
  if (!playerId || !branchId) throw new HttpsError('invalid-argument', '缺少參數');

  const playerRef = db.collection('playerScores').doc(`${playerId}_${branchId}`);
  const historyQuery = db.collection('pointTransactions')
    .where('playerId', '==', String(playerId))
    .where('branchId', '==', String(branchId))
    .orderBy('checkoutTime', 'desc').limit(50);

  try {
    const [pDoc, hSnap] = await Promise.all([playerRef.get(), historyQuery.get()]);
    const pData = pDoc.exists ? pDoc.data() : { points: 0, lotteryChances: 0 };
    const history = hSnap.docs.map(doc => {
      const d = doc.data();
      let ts = d.checkoutTime || d.timestamp;
      if (ts && typeof ts.toDate === 'function') ts = ts.toDate().toISOString();
      return { ...d, checkoutTime: ts };
    });

    return {
      success: true,
      data: {
        player: { totalPoints: pData.points || 0, scratchCardChances: pData.lotteryChances || 0, playerName: pData.playerName || `玩家${playerId}` },
        transactions: history
      }
    };
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// ======================================================================
//  4. 扣除抽獎次數 API
// ======================================================================
exports.redeemChance = onCall({ cors: true, region: "asia-east1", memory: "128MiB", minInstances: 0, invoker: "public" }, async (request) => {
  requireAdmin(request);
  const { playerId, branchId, deductTimes, reason, operator } = request.data;
  const num = Number(deductTimes);
  if (!playerId || !branchId || isNaN(num) || num < 1) throw new HttpsError('invalid-argument', '參數錯誤');

  const pRef = db.collection('playerScores').doc(`${playerId}_${branchId}`);
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(pRef);
      if (!doc.exists || (doc.data().lotteryChances || 0) < num) throw new HttpsError('failed-precondition', '次數不足');
      t.update(pRef, { lotteryChances: FieldValue.increment(-num), lastUpdated: FieldValue.serverTimestamp() });
      const tId = `${getFormattedTimestamp(new Date())}_${playerId}_DEDUCT_${getRandomSuffix()}`;
      t.set(db.collection("pointTransactions").doc(tId), {
        playerId, branchId, checkoutTime: new Date(), type: 'ADMIN_DEDUCT',
        pointsChanged: 0, chancesChanged: -num, description: reason, operator
      });
    });
    return { success: true };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', e.message);
  }
});

// ======================================================================
//  6. 手動調整 API
// ======================================================================
exports.manualAdjustPoints = onCall({ cors: true, region: "asia-east1", memory: "128MiB", minInstances: 0, invoker: "public" }, async (request) => {
  requireAdmin(request);
  const { playerId, branchId, pointsAdjustment, chancesAdjustment, reason, operator } = request.data;
  const pAdj = Number(pointsAdjustment) || 0;
  const cAdj = Number(chancesAdjustment) || 0;
  const pRef = db.collection('playerScores').doc(`${playerId}_${branchId}`);

  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(pRef);
      const curP = doc.exists ? doc.data().points || 0 : 0;
      const curC = doc.exists ? doc.data().lotteryChances || 0 : 0;
      
      // 計算調整後的總點數與總次數
      let newTotalPoints = curP + pAdj;
      let newTotalChances = curC + cAdj;

      if (newTotalPoints < 0 || newTotalChances < 0) throw new HttpsError('failed-precondition', '調整後不能為負數');

      // 自動轉換邏輯：如果點數 >= 10，則自動兌換成次數
      if (newTotalPoints >= 10) {
        const convertedChances = Math.floor(newTotalPoints / 10);
        newTotalChances += convertedChances;
        newTotalPoints = newTotalPoints % 10;

        // 記錄自動兌換的交易
        const tIdRedeem = `${getFormattedTimestamp(new Date())}_${playerId}_AUTO_REDEEM_${getRandomSuffix()}`;
        t.set(db.collection("pointTransactions").doc(tIdRedeem), {
          playerId, branchId, checkoutTime: new Date(),
          type: 'REDEEM_CARD', pointsChanged: -(convertedChances * 10), chancesChanged: convertedChances,
          description: `手動加點後自動兌換 ${convertedChances} 張`, operator: 'SYSTEM'
        });
      }
      
      t.set(pRef, {
        points: newTotalPoints, lotteryChances: newTotalChances, 
        lastUpdated: FieldValue.serverTimestamp(), playerId, branchId
      }, { merge: true });

      const tId = `${getFormattedTimestamp(new Date())}_${playerId}_ADJUST_${getRandomSuffix()}`;
      t.set(db.collection("pointTransactions").doc(tId), {
        playerId, branchId, checkoutTime: new Date(), type: 'MANUAL_ADJUST',
        pointsChanged: pAdj, chancesChanged: cAdj, description: reason, operator
      });
    });
    return { success: true, message: "調整成功" };
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});


// ======================================================================
//  8. 批次撤銷 API
// ======================================================================
exports.rollbackPOSBatch = onCall({
  cors: true, region: "asia-east1", memory: "512MiB", minInstances: 0, timeoutSeconds: 300, invoker: "public"
}, async (request) => {
  requireAdmin(request);
  const { fileName } = request.data;
  if (!fileName) throw new HttpsError('invalid-argument', '必須提供檔名');

  try {
    let snap = await db.collection('pointTransactions').where('sourceFile', '==', fileName).get();
    let docs = snap.docs;

    if (docs.length === 0) {
      const posSnap = await db.collection('pos_records').where('sourceFile', '==', fileName).where('processed', '==', true).get();
      if (!posSnap.empty) {
        const sIds = posSnap.docs.map(d => d.id);
        const bName = getBranchFromFileName(fileName);
        const allTx = await db.collection('pointTransactions').where('branchId', '==', bName).get();
        docs = allTx.docs.filter(d => sIds.includes(d.data().sourceRecordId));
      }
    }

    if (docs.length === 0) {
      const bName = getBranchFromFileName(fileName);
      const rDate = getDateFromFileName(fileName);
      if (bName !== 'unknown' && rDate) {
        const idPrefix = `${bName}_${rDate}`;
        const fallbackSnap = await db.collection('pointTransactions')
          .where('branchId', '==', bName)
          .where('sourceRecordId', '>=', idPrefix)
          .where('sourceRecordId', '<', idPrefix + '\uf8ff')
          .get();
        docs = fallbackSnap.docs;
      }
    }

    if (docs.length === 0) return { success: false, message: "找不到紀錄" };

    const playerAdj = {};
    docs.forEach(d => {
      const tx = d.data();
      if (tx.type === 'EARN_POINTS') {
        const key = `${tx.playerId}_${tx.branchId}`;
        if (!playerAdj[key]) playerAdj[key] = { pts: 0, refs: [] };
        playerAdj[key].pts += tx.pointsChanged;
        playerAdj[key].refs.push(d.ref);
      }
    });

    let affected = 0;
    for (const key in playerAdj) {
      const adj = playerAdj[key];
      const [pId, bId] = key.split('_');
      await db.runTransaction(async (t) => {
        const pRef = db.collection('playerScores').doc(key);
        const pDoc = await t.get(pRef);
        if (!pDoc.exists) return;
        const cur = pDoc.data();
        const total = ((cur.lotteryChances || 0) * 10) + (cur.points || 0);
        const final = Math.max(0, total - adj.pts);
        const newChances = Math.floor(final / 10);
        const chanceDiff = newChances - (cur.lotteryChances || 0);
        t.update(pRef, { points: final % 10, lotteryChances: newChances, lastUpdated: FieldValue.serverTimestamp() });
        // Mark original transactions as rolled back
        adj.refs.forEach(r => t.update(r, { type: 'ROLLED_BACK', description: `[已撤銷] ${fileName}` }));
        // Write a new rollback transaction entry for full audit trail
        const tId = `${getFormattedTimestamp(new Date())}_${pId}_ROLLBACK_${getRandomSuffix()}`;
        t.set(db.collection('pointTransactions').doc(tId), {
          playerId: pId, branchId: bId, checkoutTime: new Date(),
          type: 'ROLLED_BACK', pointsChanged: -adj.pts, chancesChanged: chanceDiff,
          description: `[已撤銷] ${fileName}`, operator: 'ADMIN', sourceFile: fileName,
        });
      });
      affected++;
    }

    const posSnap = await db.collection('pos_records').where('sourceFile', '==', fileName).get();
    const posBatch = db.batch();
    posSnap.forEach(d => posBatch.update(d.ref, { processed: false, status: 'ROLLED_BACK' }));
    await posBatch.commit();

    return { success: true, message: `成功撤銷，影響 ${affected} 人` };
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});



// ======================================================================
//  submitDraw — 兌獎登記
// ======================================================================
exports.submitDraw = onCall({ cors: true, region: "asia-east1", memory: "128MiB", minInstances: 0, invoker: "public" }, async (request) => {
  requireAdmin(request);
  const { playerId, phase, card1, card2, result } = request.data;
  if (!playerId || !phase || !result) throw new HttpsError('invalid-argument', '缺少參數');
  if (!['大獎', '普獎', '無'].includes(result)) throw new HttpsError('invalid-argument', '無效的獎項結果');

  const statField = result === '大獎' ? 'stats.grand' : result === '普獎' ? 'stats.regular' : 'stats.none';

  // 找出 phase label 對應的 doc ID (1–4)
  const PHASE_LABELS = ['第一階段', '第二階段', '第三階段', '第四階段'];
  const phaseIndex = PHASE_LABELS.indexOf(phase);
  if (phaseIndex === -1) throw new HttpsError('invalid-argument', '無效的階段');

  try {
    const batch = db.batch();
    const newDrawRef = db.collection('draws').doc();
    const phaseRef = db.collection('phases').doc(String(phaseIndex + 1));
    batch.set(newDrawRef, { playerId, phase, card1: card1 || '', card2: card2 || '', result, timestamp: FieldValue.serverTimestamp() });
    batch.update(phaseRef, { [statField]: FieldValue.increment(1) });
    await batch.commit();
    return { success: true };
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// ======================================================================
//  adminLogin — 後台帳密驗證（伺服器端，不暴露資料庫內容）
// ======================================================================
exports.adminLogin = onCall(async (request) => {
  const { account, password } = request.data || {};
  if (!account || !password) {
    throw new HttpsError('invalid-argument', '請提供帳號與密碼');
  }
  const snap = await db.collection('adminaccount')
    .where('account', '==', account)
    .limit(1)
    .get();
  if (snap.empty || snap.docs[0].data().password !== password) {
    throw new HttpsError('unauthenticated', '帳號或密碼錯誤');
  }
  return { success: true };
});
