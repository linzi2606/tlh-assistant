const express = require('express');
const app = express();
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN   || '8459359851:AAEzRwSwxSSk0NZjBDVH8ZXkIIjpWizHCvc';
const FIREBASE_URL= process.env.FIREBASE_URL || 'https://lichdonphongtlh-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_KEY= process.env.FIREBASE_KEY || 'AIzaSyBzH9hVSbu9JYnjdI6UFlU64KUTIIx2SYA';
const PORT        = process.env.PORT         || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'tlh2024secret';

// Branch mapping: tên trong tin nhắn → branchId app
const BRANCH_MAP = {
  'riverside 1': 'fb_RVS1cn8', 'riverside1': 'fb_RVS1cn8', 'rvs1': 'fb_RVS1cn8', 'rvs 1': 'fb_RVS1cn8',
  'riverside 2': 'fb_RVS2cn7', 'riverside2': 'fb_RVS2cn7', 'rvs2': 'fb_RVS2cn7', 'rvs 2': 'fb_RVS2cn7',
  'tan an 1': 'fb_TNAN1', 'tân an 1': 'fb_TNAN1', 'tanan1': 'fb_TNAN1',
  'tan an 2': 'fb_TNAN2', 'tân an 2': 'fb_TNAN2', 'tanan2': 'fb_TNAN2',
  'tan an 3': 'fb_TNAN3', 'tân an 3': 'fb_TNAN3', 'tanan3': 'fb_TNAN3',
  'ben tre 1': 'fb_BNTRE1', 'bến tre 1': 'fb_BNTRE1', 'bentre1': 'fb_BNTRE1',
  'ben tre 2': 'fb_BNTRE2', 'bến tre 2': 'fb_BNTRE2', 'bentre2': 'fb_BNTRE2',
  'ho van nhanh': 'fb_HVNNHNH', 'hồ văn nhánh': 'fb_HVNNHNH', 'hvn': 'fb_HVNNHNH',
  'pham thanh': 'fb_PHMTHANH', 'phạm thanh': 'fb_PHMTHANH',
  'le van pham 1': 'fb_LVNPHM1', 'lê văn phẩm 1': 'fb_LVNPHM1', 'lvp1': 'fb_LVNPHM1', 'lvp 1': 'fb_LVNPHM1',
  'le van pham 2': 'fb_LVNPHM2', 'lê văn phẩm 2': 'fb_LVNPHM2', 'lvp2': 'fb_LVNPHM2', 'lvp 2': 'fb_LVNPHM2',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normText(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').trim(); }

function resolveBranchId(branchRaw){
  const n = normText(branchRaw);
  for(const [key, id] of Object.entries(BRANCH_MAP)){
    if(n.includes(normText(key))) return id;
  }
  return null;
}

function genId(){
  return Math.random().toString(36).slice(2,8).toUpperCase();
}

function parseDate(str){
  // Format: 08-06-2026, 17:00
  const m = str.match(/(\d{2})-(\d{2})-(\d{4}),?\s*(\d{2}):(\d{2})/);
  if(!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+07:00`;
}

function parseAmount(str){
  return String(str||'').replace(/[^\d]/g,'') || '0';
}

function detectType(ci, co){
  if(!ci||!co) return 'gio';
  const d1 = new Date(ci), d2 = new Date(co);
  const hours = (d2-d1)/3600000;
  const ciH = d1.getHours();
  if(hours >= 20) return 'ngay';
  if(ciH >= 19 || ciH < 6) return 'dem';
  if(hours >= 8) return 'combo8';
  if(hours >= 6) return 'combo6';
  if(hours >= 4) return 'combo4';
  if(hours >= 3) return 'combo3';
  if(hours >= 2) return 'combo2';
  return 'gio';
}

// ── Firebase ──────────────────────────────────────────────────────────────────
async function fbGet(path){
  const res = await fetch(`${FIREBASE_URL}${path}.json?auth=${FIREBASE_KEY}`);
  return res.json();
}

async function fbSet(path, data){
  const res = await fetch(`${FIREBASE_URL}${path}.json?auth=${FIREBASE_KEY}`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  return res.json();
}

async function fbPatch(path, data){
  const res = await fetch(`${FIREBASE_URL}${path}.json?auth=${FIREBASE_KEY}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  return res.json();
}

// ── Parse tin đặt phòng mới ───────────────────────────────────────────────────
// Format:
// 🪅 Đơn đặt phòng mới
// Mã đơn đặt phòng: BOOK20260608171635151
// Họ và tên: Văn Ngọc
// Số điện thoại: 0923692558
// Chi nhánh: Riverside 1 (Mỹ Tho)
// Phòng: RVS1-PHÒNG DELUXE CỬA SỐ VIEW THÀNH PHỐ 301
// Check in: 08-06-2026, 17:00
// Check out: 09-06-2026, 12:00
// Tổng tiền: 550.000đ
// Trạng thái: Đã thanh toán
function parseBookingMsg(text){
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const get = (keys) => {
    for(const line of lines){
      for(const key of keys){
        const re = new RegExp(`^${key}[:\\s]+(.+)$`, 'i');
        const m = line.match(re);
        if(m) return m[1].trim();
      }
    }
    return '';
  };

  const orderId   = get(['Mã đơn đặt phòng','Mã đơn','Mã ĐH','Order ID']);
  const name      = get(['Họ và tên','Tên khách','Khách hàng','Họ tên']);
  const phone     = get(['Số điện thoại','SĐT','Phone']);
  const branchRaw = get(['Chi nhánh','Branch']);
  const roomRaw   = get(['Phòng','Room']);
  const ciRaw     = get(['Check in','Check-in','Checkin','Ngày vào']);
  const coRaw     = get(['Check out','Check-out','Checkout','Ngày ra']);
  const totalRaw  = get(['Tổng tiền','Total','Tổng']);
  const statusRaw = get(['Trạng thái','Status','Thanh toán']);

  if(!orderId || !name || !ciRaw) return null;

  // Parse phòng: lấy số phòng cuối cùng trong chuỗi
  const roomMatch = roomRaw.match(/(\d+)\s*$/);
  const room = roomMatch ? roomMatch[1] : roomRaw;

  const checkIn  = parseDate(ciRaw);
  const checkOut = parseDate(coRaw);
  const paid = /đã thanh toán|paid|thanh toan/i.test(statusRaw);
  const branchId = resolveBranchId(branchRaw);
  const type = detectType(checkIn, checkOut);

  return {
    id: orderId.replace(/^BOOK/,'').slice(-6) || genId(),
    orderId,
    guestName: name,
    guestPhone: phone,
    cccd: '',
    branchId: branchId || 'unknown',
    branchName: branchRaw,
    room,
    checkIn,
    checkOut,
    type,
    price: parseAmount(totalRaw),
    deposit: parseAmount(totalRaw),
    extra: '0',
    discType: 'none',
    guestCount: '1',
    paid,
    source: 'telegram',
    status: 'active',
    telegramRaw: { orderId, roomRaw, branchRaw, ciRaw, coRaw, totalRaw, statusRaw },
    history: [{ action: 'NHAN BOOKING TU TELEGRAM', date: new Date().toLocaleString('vi-VN'), detail: 'Bot Railway parse từ nhóm Telegram' }],
    createdAt: new Date().toISOString(),
    booking_token: `tg_${orderId}_${Math.random().toString(36).slice(2,8)}`,
  };
}

// ── Parse tin hủy ─────────────────────────────────────────────────────────────
// Format:
// 🚫 Đơn hàng bị huỷ bởi admin:
// Mã ĐH: BVRCNY
// Khách hàng: Mỹ duyên
// SĐT: 1234567890
function parseCancelMsg(text){
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const get = (keys) => {
    for(const line of lines){
      for(const key of keys){
        const re = new RegExp(`^${key}[:\\s]+(.+)$`, 'i');
        const m = line.match(re);
        if(m) return m[1].trim();
      }
    }
    return '';
  };
  const orderId = get(['Mã ĐH','Mã đơn','Mã đơn đặt phòng','Order ID']);
  const name    = get(['Khách hàng','Họ và tên','Tên khách']);
  if(!orderId) return null;
  return { orderId, name };
}

// ── Phân loại tin nhắn ────────────────────────────────────────────────────────
function classifyMsg(text){
  if(!text) return 'ignore';
  // Bỏ qua check-in reminder
  if(/CHECK-IN SẮP DIỄN RA|check.in sắp/i.test(text)) return 'ignore';
  // Tin hủy
  if(/bị huỷ|bi huy|huỷ đơn|hủy đơn|cancelled|🚫/i.test(text)) return 'cancel';
  // Tin đặt phòng mới
  if(/đơn đặt phòng mới|don dat phong moi|Mã đơn đặt phòng|🪅/i.test(text)) return 'booking';
  return 'ignore';
}

// ── Tìm booking trong Firebase theo orderId ────────────────────────────────────
async function findBookingByOrderId(orderId){
  const data = await fbGet('/bookings');
  if(!data) return null;
  // Tìm theo orderId hoặc id khớp
  for(const [key, val] of Object.entries(data)){
    if(!val || typeof val !== 'object') continue;
    const tgOrderId = val.telegramRaw?.orderId || val.orderId || '';
    const rawId = val.id || key;
    if(
      tgOrderId === orderId ||
      rawId === orderId ||
      key === orderId ||
      tgOrderId.endsWith(orderId) ||
      orderId.endsWith(rawId)
    ) return { key, val };
  }
  return null;
}

// ── Xử lý booking mới ────────────────────────────────────────────────────────
async function handleBooking(text){
  const bk = parseBookingMsg(text);
  if(!bk){ console.log('⚠️ Parse booking thất bại'); return; }

  // Kiểm tra trùng theo orderId
  const existing = await findBookingByOrderId(bk.orderId);
  if(existing){ console.log(`ℹ️ Booking ${bk.orderId} đã tồn tại — bỏ qua`); return; }

  await fbSet(`/bookings/${bk.id}`, bk);
  console.log(`✅ Đã ghi booking mới: ${bk.id} | ${bk.guestName} | ${bk.branchName} P.${bk.room}`);
}

// ── Xử lý hủy ────────────────────────────────────────────────────────────────
async function handleCancel(text){
  const cancel = parseCancelMsg(text);
  if(!cancel){ console.log('⚠️ Parse cancel thất bại'); return; }

  const found = await findBookingByOrderId(cancel.orderId);
  if(!found){
    console.log(`⚠️ Không tìm thấy booking để hủy: ${cancel.orderId}`);
    return;
  }

  const { key } = found;
  await fbPatch(`/bookings/${key}`, {
    status: 'cancelled',
    cancelReason: 'Hủy từ nhóm Telegram',
    cancelRefund: 'Không',
    _cancelledAt: new Date().toISOString(),
    history: [
      ...(found.val.history || []),
      { action: 'HỦY TỪ TELEGRAM', date: new Date().toLocaleString('vi-VN'), detail: `Admin hủy qua nhóm Telegram. Mã: ${cancel.orderId}` }
    ]
  });
  console.log(`🚫 Đã hủy booking: ${key} | ${cancel.orderId} | ${cancel.name}`);
}

// ── Webhook endpoint ──────────────────────────────────────────────────────────
app.post(`/webhook/${WEBHOOK_SECRET}`, async (req, res) => {
  res.sendStatus(200); // Trả về ngay để Telegram không retry

  try {
    const msg = req.body?.message || req.body?.channel_post;
    if(!msg) return;

    const text = msg.text || msg.caption || '';
    if(!text) return;

    const type = classifyMsg(text);
    console.log(`📨 [${type.toUpperCase()}] ${text.slice(0,80).replace(/\n/g,' ')}`);

    if(type === 'booking') await handleBooking(text);
    else if(type === 'cancel') await handleCancel(text);
    // ignore: bỏ qua

  } catch(e){
    console.error('❌ Error:', e.message);
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', bot: 'TLH Booking Bot', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`🚀 TLH Bot running on port ${PORT}`));
