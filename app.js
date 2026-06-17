const {
  useState,
  useMemo,
  useEffect
} = React;

// ── GitHub raw 資料來源 ──────────────────────────────────────────
const GITHUB_RAW = "https://raw.githubusercontent.com/mn19-design/football-data-public/main";

// ── 把 pipeline 輸出的隊伍資料轉成前端格式 ──────────────────────
const TLA_FLAGS = {
  ARG:"🇦🇷",FRA:"🇫🇷",BRA:"🇧🇷",ENG:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",GER:"🇩🇪",ESP:"🇪🇸",
  ITA:"🇮🇹",POR:"🇵🇹",NED:"🇳🇱",BEL:"🇧🇪",CRO:"🇭🇷",MAR:"🇲🇦",
  URU:"🇺🇾",JPN:"🇯🇵",KOR:"🇰🇷",USA:"🇺🇸",MEX:"🇲🇽",COL:"🇨🇴",
  AUS:"🇦🇺",SEN:"🇸🇳",CMR:"🇨🇲",GHA:"🇬🇭",EGY:"🇪🇬",KSA:"🇸🇦",
  IRN:"🇮🇷",POL:"🇵🇱",SUI:"🇨🇭",DEN:"🇩🇰",SWE:"🇸🇪",NOR:"🇳🇴",
  SRB:"🇷🇸",UKR:"🇺🇦",AUT:"🇦🇹",TUN:"🇹🇳",CPV:"🇨🇻",PAN:"🇵🇦",
  ECU:"🇪🇨",QAT:"🇶🇦",CAN:"🇨🇦",SLO:"🇸🇮",SVK:"🇸🇰",HUN:"🇭🇺",
  ALB:"🇦🇱",ROU:"🇷🇴",GEO:"🇬🇪",TUR:"🇹🇷",
};
const POS_DEF = {
  FW:{ovr:80,pac:80,sho:80,pas:75,dri:80,def:35,phy:70,sta:82},
  MF:{ovr:80,pac:72,sho:68,pas:80,dri:76,def:76,phy:78,sta:86},
  DF:{ovr:78,pac:74,sho:40,pas:70,dri:66,def:84,phy:82,sta:84},
  GK:{ovr:80,pac:0, sho:0, pas:0, dri:0, def:0, phy:0, sta:80},
};
function createTeamFromData(t) {
  const tla  = t.tla || (t.name||"").slice(0,3).toUpperCase();
  const rd   = t.restDays || 5;
  // 4-3-3 預設 11 人陣容（賽前公佈前的佔位）
  const LINEUP_433 = [
    {pos:"GK", label:"門將"},
    {pos:"DF", label:"右後衛"}, {pos:"DF", label:"中後衛"}, {pos:"DF", label:"中後衛"}, {pos:"DF", label:"左後衛"},
    {pos:"MF", label:"中場"}, {pos:"MF", label:"中場"}, {pos:"MF", label:"攻擊中場"},
    {pos:"FW", label:"右翼"}, {pos:"FW", label:"中鋒"}, {pos:"FW", label:"左翼"},
  ];
  const dflt = LINEUP_433.map((p, i) => ({
    pos:p.pos, name:`${p.label} （待公佈）`, ...POS_DEF[p.pos],
    restDays:rd, load3:240, lastRating:7.0, err3:0, status:"avail", reason:"",
    _isDefault: true
  }));
  return {
    name:    t.name    || "Unknown",
    code:    tla,
    flag:    t.flag    || TLA_FLAGS[tla] || "⚽",
    rank:    t.rank    || 50,
    form:    t.form    || [],
    players: (t.players && t.players.length) ? t.players : dflt,
  };
}
function h2hFromMatch(h) {
  if (!h) return {w:0,d:0,l:0,note:"無近期交手紀錄"};
  return {
    w:h.w||0, d:h.d||0, l:h.l||0,
    note:(h.last5||[]).length ? `近 ${(h.last5||[]).length} 次交手紀錄` : "無近期交手紀錄",
  };
}

// UTC 時間轉台灣時間格式 "MM/DD HH:mm"
function fmtMatchTime(utcStr) {
  if (!utcStr) return "";
  try {
    const d = new Date(utcStr);
    const tai = new Date(d.getTime() + 8 * 3600 * 1000); // UTC+8
    const mm  = String(tai.getUTCMonth() + 1).padStart(2, "0");
    const dd  = String(tai.getUTCDate()).padStart(2, "0");
    const hh  = String(tai.getUTCHours()).padStart(2, "0");
    const min = String(tai.getUTCMinutes()).padStart(2, "0");
    return `${mm}/${dd} ${hh}:${min}`;
  } catch(e) { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 足球賽事 AI 分析儀表板 — 原型 (Prototype) v3
//
// ⚠️ 重要說明：
//  • 所有球員/球隊數據為「模擬資料」，僅示範分析流程與 UI。
//  • FIFA/EA 評分為「能力基準線」，非真實當下狀態。
//  • 即時體力 FIT = 體能上限 × 休息恢復 × 近期負荷 × 上場表現，為示範模型。
//  • 出賽狀態(出賽/受傷/停賽)會影響戰力計算與機率。資料須以官方公佈名單為準。
//  • 「模型機率」是簡化計算，不保證任何贏率。本工具為決策輔助，非投注建議。
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#10140F",
  panel: "#171C14",
  panel2: "#1E2419",
  line: "#2C3526",
  chalk: "#E8EBE2",
  mute: "#8A937E",
  pitch: "#4ADE80",
  pitchDim: "#2E7D4F",
  amber: "#E6B450",
  rust: "#D9694A",
  sky: "#6FA8DC"
};

// 出賽狀態定義
const STATUS = {
  avail: {
    txt: "可出賽",
    short: "出賽",
    icon: "✅",
    color: C.pitch,
    light: "🟢"
  },
  injured: {
    txt: "受傷缺陣",
    short: "受傷",
    icon: "❌",
    color: C.rust,
    light: "🔴"
  },
  suspended: {
    txt: "停賽",
    short: "停賽",
    icon: "⛔",
    color: C.amber,
    light: "🟡"
  },
  doubt: {
    txt: "傷況待確認",
    short: "待確認",
    icon: "⚠️",
    color: C.sky,
    light: "🟠"
  }
};

// ── 模擬球隊資料 ──────────────────────────────────────────────
// status: avail / injured / suspended / doubt
// reason: 缺席原因白話說明
const TEAMS = {
  ARG: {
    name: "阿根廷",
    code: "ARG",
    flag: "🇦🇷",
    rank: 1,
    form: ["W", "W", "D", "W", "W"],
    players: [{
      pos: "FW",
      name: "L. Messi",
      ovr: 90,
      pac: 80,
      sho: 89,
      pas: 90,
      dri: 94,
      def: 33,
      phy: 64,
      sta: 72,
      restDays: 3,
      load3: 250,
      lastRating: 8.4,
      err3: 0,
      status: "avail",
      reason: ""
    }, {
      pos: "FW",
      name: "J. Álvarez",
      ovr: 85,
      pac: 86,
      sho: 84,
      pas: 80,
      dri: 84,
      def: 52,
      phy: 76,
      sta: 90,
      restDays: 5,
      load3: 215,
      lastRating: 7.6,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "E. Fernández",
      ovr: 85,
      pac: 73,
      sho: 78,
      pas: 86,
      dri: 82,
      def: 78,
      phy: 79,
      sta: 92,
      restDays: 4,
      load3: 270,
      lastRating: 7.2,
      err3: 1,
      status: "suspended",
      reason: "累積兩張黃牌停賽一場"
    }, {
      pos: "MF",
      name: "R. De Paul",
      ovr: 84,
      pac: 78,
      sho: 75,
      pas: 83,
      dri: 82,
      def: 80,
      phy: 81,
      sta: 94,
      restDays: 4,
      load3: 260,
      lastRating: 7.0,
      err3: 2,
      status: "avail",
      reason: ""
    }, {
      pos: "DF",
      name: "C. Romero",
      ovr: 85,
      pac: 80,
      sho: 40,
      pas: 68,
      dri: 66,
      def: 87,
      phy: 86,
      sta: 85,
      restDays: 6,
      load3: 240,
      lastRating: 7.8,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "GK",
      name: "E. Martínez",
      ovr: 86,
      pac: 0,
      sho: 0,
      pas: 0,
      dri: 0,
      def: 0,
      phy: 0,
      sta: 80,
      restDays: 6,
      load3: 270,
      lastRating: 7.1,
      err3: 0,
      status: "avail",
      reason: ""
    }]
  },
  FRA: {
    name: "法國",
    code: "FRA",
    flag: "🇫🇷",
    rank: 2,
    form: ["W", "L", "W", "W", "D"],
    players: [{
      pos: "FW",
      name: "K. Mbappé",
      ovr: 91,
      pac: 97,
      sho: 90,
      pas: 80,
      dri: 92,
      def: 36,
      phy: 78,
      sta: 88,
      restDays: 2,
      load3: 268,
      lastRating: 8.9,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "FW",
      name: "O. Dembélé",
      ovr: 86,
      pac: 93,
      sho: 78,
      pas: 82,
      dri: 90,
      def: 40,
      phy: 65,
      sta: 84,
      restDays: 2,
      load3: 255,
      lastRating: 7.4,
      err3: 2,
      status: "injured",
      reason: "大腿拉傷，預計缺席 2–3 週"
    }, {
      pos: "MF",
      name: "A. Tchouaméni",
      ovr: 85,
      pac: 76,
      sho: 70,
      pas: 82,
      dri: 78,
      def: 85,
      phy: 84,
      sta: 91,
      restDays: 3,
      load3: 270,
      lastRating: 7.0,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "A. Griezmann",
      ovr: 86,
      pac: 78,
      sho: 84,
      pas: 86,
      dri: 86,
      def: 64,
      phy: 70,
      sta: 89,
      restDays: 3,
      load3: 230,
      lastRating: 7.7,
      err3: 0,
      status: "avail",
      reason: ""
    }, {
      pos: "DF",
      name: "W. Saliba",
      ovr: 85,
      pac: 84,
      sho: 38,
      pas: 72,
      dri: 70,
      def: 86,
      phy: 84,
      sta: 87,
      restDays: 3,
      load3: 270,
      lastRating: 7.3,
      err3: 2,
      status: "doubt",
      reason: "腳踝輕傷，賽前測試決定"
    }, {
      pos: "GK",
      name: "M. Maignan",
      ovr: 87,
      pac: 0,
      sho: 0,
      pas: 0,
      dri: 0,
      def: 0,
      phy: 0,
      sta: 82,
      restDays: 3,
      load3: 270,
      lastRating: 7.0,
      err3: 1,
      status: "avail",
      reason: ""
    }]
  },
  BRA: {
    name: "巴西",
    code: "BRA",
    flag: "🇧🇷",
    rank: 3,
    form: ["D", "W", "W", "L", "W"],
    players: [{
      pos: "FW",
      name: "Vinícius Jr.",
      ovr: 89,
      pac: 95,
      sho: 83,
      pas: 81,
      dri: 92,
      def: 29,
      phy: 68,
      sta: 86,
      restDays: 4,
      load3: 245,
      lastRating: 8.1,
      err3: 3,
      status: "avail",
      reason: ""
    }, {
      pos: "FW",
      name: "Rodrygo",
      ovr: 86,
      pac: 90,
      sho: 82,
      pas: 80,
      dri: 88,
      def: 35,
      phy: 64,
      sta: 85,
      restDays: 4,
      load3: 200,
      lastRating: 7.2,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "Bruno G.",
      ovr: 84,
      pac: 70,
      sho: 74,
      pas: 82,
      dri: 78,
      def: 82,
      phy: 83,
      sta: 90,
      restDays: 5,
      load3: 265,
      lastRating: 6.9,
      err3: 2,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "Raphinha",
      ovr: 85,
      pac: 88,
      sho: 82,
      pas: 83,
      dri: 86,
      def: 45,
      phy: 70,
      sta: 87,
      restDays: 4,
      load3: 255,
      lastRating: 8.0,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "DF",
      name: "Marquinhos",
      ovr: 85,
      pac: 78,
      sho: 42,
      pas: 74,
      dri: 72,
      def: 86,
      phy: 82,
      sta: 84,
      restDays: 5,
      load3: 250,
      lastRating: 7.4,
      err3: 0,
      status: "avail",
      reason: ""
    }, {
      pos: "GK",
      name: "Alisson",
      ovr: 88,
      pac: 0,
      sho: 0,
      pas: 0,
      dri: 0,
      def: 0,
      phy: 0,
      sta: 81,
      restDays: 5,
      load3: 270,
      lastRating: 7.2,
      err3: 2,
      status: "avail",
      reason: ""
    }]
  },
  ENG: {
    name: "英格蘭",
    code: "ENG",
    flag: "🏴",
    rank: 4,
    form: ["W", "D", "D", "W", "W"],
    players: [{
      pos: "FW",
      name: "H. Kane",
      ovr: 90,
      pac: 70,
      sho: 92,
      pas: 84,
      dri: 83,
      def: 47,
      phy: 83,
      sta: 84,
      restDays: 7,
      load3: 270,
      lastRating: 8.2,
      err3: 0,
      status: "avail",
      reason: ""
    }, {
      pos: "FW",
      name: "B. Saka",
      ovr: 87,
      pac: 88,
      sho: 82,
      pas: 84,
      dri: 88,
      def: 50,
      phy: 70,
      sta: 88,
      restDays: 7,
      load3: 260,
      lastRating: 7.6,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "J. Bellingham",
      ovr: 88,
      pac: 80,
      sho: 84,
      pas: 85,
      dri: 87,
      def: 78,
      phy: 83,
      sta: 93,
      restDays: 6,
      load3: 270,
      lastRating: 8.5,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "MF",
      name: "D. Rice",
      ovr: 86,
      pac: 76,
      sho: 72,
      pas: 82,
      dri: 78,
      def: 86,
      phy: 86,
      sta: 92,
      restDays: 6,
      load3: 270,
      lastRating: 7.4,
      err3: 1,
      status: "avail",
      reason: ""
    }, {
      pos: "DF",
      name: "J. Stones",
      ovr: 85,
      pac: 74,
      sho: 45,
      pas: 80,
      dri: 76,
      def: 85,
      phy: 80,
      sta: 83,
      restDays: 8,
      load3: 180,
      lastRating: 7.1,
      err3: 2,
      status: "injured",
      reason: "肌肉不適，本場退出名單"
    }, {
      pos: "GK",
      name: "J. Pickford",
      ovr: 84,
      pac: 0,
      sho: 0,
      pas: 0,
      dri: 0,
      def: 0,
      phy: 0,
      sta: 80,
      restDays: 7,
      load3: 270,
      lastRating: 7.0,
      err3: 3,
      status: "avail",
      reason: ""
    }]
  }
};
const TEAM_KEYS = Object.keys(TEAMS);

// ── 對戰歷史 H2H (模擬，近 5 次交手，key 用 "A_B"，值為 A 視角的 勝/平/負) ──
const H2H = {
  "ARG_FRA": {
    w: 2,
    d: 1,
    l: 2,
    note: "近 5 次平分秋色，含一場世界盃決賽互有勝負"
  },
  "ARG_BRA": {
    w: 2,
    d: 2,
    l: 1,
    note: "南美宿敵，阿根廷近期略佔上風"
  },
  "ARG_ENG": {
    w: 3,
    d: 1,
    l: 1,
    note: "阿根廷歷史交手勝多"
  },
  "FRA_BRA": {
    w: 1,
    d: 1,
    l: 3,
    note: "巴西近 5 次交手壓制法國"
  },
  "FRA_ENG": {
    w: 3,
    d: 0,
    l: 2,
    note: "法國近期對英格蘭佔優"
  },
  "BRA_ENG": {
    w: 2,
    d: 2,
    l: 1,
    note: "勢均力敵，巴西略勝"
  }
};
function getH2H(homeKey, awayKey) {
  const direct = H2H[`${homeKey}_${awayKey}`];
  if (direct) return {
    ...direct,
    flip: false
  };
  const rev = H2H[`${awayKey}_${homeKey}`];
  if (rev) return {
    w: rev.l,
    d: rev.d,
    l: rev.w,
    note: rev.note,
    flip: true
  }; // 從主隊視角翻轉
  return {
    w: 0,
    d: 0,
    l: 0,
    note: "無近期交手紀錄",
    flip: false
  };
}

// ── 天氣/場地預設 ──
// tempo: 對比賽節奏的影響(<1 拉低)；tech: 對技術型(盤帶/傳球)發揮的影響
// 追蹤的聯賽目錄（對應 football-data.org competition code）
const LEAGUE_CATALOG = [
  { code:"WC",  name:"FIFA 世界盃",    flag:"🌍",  country:"國際"   },
  { code:"PL",  name:"英超",           flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", country:"英格蘭" },
  { code:"ELC", name:"英冠",           flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", country:"英格蘭" },
  { code:"BL1", name:"德甲",           flag:"🇩🇪", country:"德國"   },
  { code:"FL1", name:"法甲",           flag:"🇫🇷", country:"法國"   },
  { code:"SA",  name:"義甲",           flag:"🇮🇹", country:"義大利" },
  { code:"PD",  name:"西甲",           flag:"🇪🇸", country:"西班牙" },
  { code:"CL",  name:"歐冠",           flag:"⭐",  country:"歐洲"   },
  { code:"EC",  name:"歐洲盃",         flag:"🇪🇺", country:"歐洲"   },
  { code:"CLI", name:"南美解放者盃",   flag:"🇧🇷", country:"南美"   },
];

const WEATHER = {
  clear: {
    label: "晴朗 乾爽",
    icon: "☀️",
    tempo: 1.00,
    tech: 1.00,
    note: "理想條件，技術型球隊正常發揮"
  },
  hot: {
    label: "高溫 悶熱",
    icon: "🥵",
    tempo: 0.94,
    tech: 0.98,
    note: "高溫消耗體能，比賽節奏放慢"
  },
  rain: {
    label: "下雨 濕滑",
    icon: "🌧️",
    tempo: 0.92,
    tech: 0.93,
    note: "場地濕滑，盤帶傳球易失誤，拉近強弱差"
  },
  heavy: {
    label: "大雨 積水",
    icon: "⛈️",
    tempo: 0.85,
    tech: 0.86,
    note: "積水嚴重，技術大打折扣，爆冷與和局機率升高"
  },
  snow: {
    label: "雪地 低溫",
    icon: "❄️",
    tempo: 0.88,
    tech: 0.89,
    note: "雪地低溫，控球困難，強隊優勢被削弱"
  },
  wind: {
    label: "強風",
    icon: "🌬️",
    tempo: 0.95,
    tech: 0.94,
    note: "強風影響長傳與射門準度"
  }
};
const PITCH = {
  good: {
    label: "草皮良好",
    factor: 1.00
  },
  worn: {
    label: "草皮老化",
    factor: 0.97
  },
  artificial: {
    label: "人工草皮",
    factor: 0.96
  }
};

// 球隊「技術依賴度」：盤帶+傳球越高，越吃場地天氣 (用前場球員均值估)
function techReliance(t) {
  const outfield = t.players.filter(p => p.pos !== "GK");
  const avg = outfield.reduce((s, p) => s + (p.dri + p.pas) / 2, 0) / outfield.length;
  return avg; // 約 70–90
}

// ── 進攻 / 防守強度拆分 (只計可出賽，並以即時體力加權) ────────────
// 回傳 0–100 級的攻/防強度
function attackDefense(t) {
  const roster = t.players.filter(p => !isOut(p)).length ? t.players.filter(p => !isOut(p)) : t.players;
  const fitW = p => computeFit(p) / 100; // 體力越低，貢獻越打折
  // 進攻：前場/中場為主，取 射門/盤帶/傳球/速度
  const attackers = roster.filter(p => p.pos === "FW" || p.pos === "MF");
  const atkRaw = attackers.length ? attackers.reduce((s, p) => s + (p.sho * 0.35 + p.dri * 0.25 + p.pas * 0.25 + p.pac * 0.15) * fitW(p), 0) / attackers.length : 60;
  // 防守：後衛/中場/門將，取 防守/身體；門將用 ovr 代表撲救
  const defenders = roster.filter(p => p.pos === "DF" || p.pos === "MF" || p.pos === "GK");
  const defRaw = defenders.length ? defenders.reduce((s, p) => {
    const v = p.pos === "GK" ? p.ovr : p.def * 0.7 + p.phy * 0.3;
    return s + v * fitW(p);
  }, 0) / defenders.length : 60;
  return {
    atk: atkRaw,
    def: defRaw
  };
}

// ── 預期進球 xG ────────────────────────────────────────────────
// 聯盟基準每隊每場約 1.35 球；攻防差每 10 點 ≈ ±0.45 球
const BASE_GOALS = 1.35;
function expectedGoals(home, away, ctx) {
  const c = ctx || {};
  const aH = attackDefense(home),
    aA = attackDefense(away);
  // 主隊 xG：主攻 vs 客防
  let xgH = BASE_GOALS * Math.exp((aH.atk - aA.def) / 22);
  let xgA = BASE_GOALS * Math.exp((aA.atk - aH.def) / 22);
  // 主場：進攻小幅提升、失球小幅減少
  if (!c.neutral) {
    xgH *= 1.12;
    xgA *= 0.92;
  }
  // 天氣：壓低總進球(濕滑/雪地不利傳導)
  const wx = c.weather || {
    tempo: 1
  };
  const tempoF = 0.7 + wx.tempo * 0.3; // tempo=1→1.0，tempo=0.85→0.955
  xgH *= tempoF;
  xgA *= tempoF;
  // 安全範圍
  xgH = Math.max(0.2, Math.min(4.0, xgH));
  xgA = Math.max(0.2, Math.min(4.0, xgA));
  return {
    xgH,
    xgA,
    aH,
    aA
  };
}

// ── Poisson 比分機率 ───────────────────────────────────────────
function poisson(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// 產生比分矩陣與各盤口機率
function scoreMatrix(xgH, xgA, maxGoals = 6) {
  const m = [];
  let pHome = 0,
    pDraw = 0,
    pAway = 0;
  let over25 = 0,
    btts = 0;
  const cells = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(h, xgH) * poisson(a, xgA);
      row.push(p);
      if (h > a) pHome += p;else if (h === a) pDraw += p;else pAway += p;
      if (h + a >= 3) over25 += p;
      if (h >= 1 && a >= 1) btts += p;
      cells.push({
        h,
        a,
        p
      });
    }
    m.push(row);
  }
  // 正規化(截斷誤差)
  const tot = pHome + pDraw + pAway;
  cells.sort((x, y) => y.p - x.p);
  return {
    matrix: m,
    pHome: pHome / tot,
    pDraw: pDraw / tot,
    pAway: pAway / tot,
    over25,
    under25: 1 - over25,
    btts,
    topScores: cells.slice(0, 4)
  };
}

// 讓分盤：主隊讓 line 球後的勝率 (line 為負代表主隊讓球, 例 -1.0)
function handicapProbs(xgH, xgA, line, maxGoals = 8) {
  let win = 0,
    push = 0,
    lose = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(h, xgH) * poisson(a, xgA);
      const margin = h + line - a; // 主隊加上讓分後的淨勝
      if (Math.abs(margin) < 1e-9) push += p;else if (margin > 0) win += p;else lose += p;
    }
  }
  const tot = win + push + lose;
  return {
    win: win / tot,
    push: push / tot,
    lose: lose / tot
  };
}
const FIT_NOTE = {
  ARG: "Messi 僅休 3 天且上場踢滿，疲勞風險需留意",
  FRA: "全隊僅休 2–3 天、負荷高，體能普遍下修",
  BRA: "休息充分，鋒線狀態佳",
  ENG: "休息 6–8 天最充分，但部分球員恐比賽節奏生疏"
};
function isOut(p) {
  return p.status === "injured" || p.status === "suspended";
}

// ── 即時體力 FIT 模型 ────────────────────────────────────────
function restFactor(d) {
  if (d <= 1) return 0.80;
  if (d === 2) return 0.86;
  if (d === 3) return 0.93;
  if (d === 4) return 0.98;
  if (d <= 6) return 1.00;
  if (d <= 8) return 0.98;
  return 0.95;
}
function loadFactor(min3) {
  const t = Math.min(Math.max(min3, 0), 270) / 270;
  return 1.0 - t * 0.12;
}
function formFactor(rating) {
  return 0.96 + (rating - 7.0) * 0.025;
}
// 近期失誤 → 可靠度係數。後衛/門將失誤權重高(直接關係失分)
function errWeight(pos) {
  if (pos === "GK") return 0.06; // 門將每次失誤扣 6%
  if (pos === "DF") return 0.05; // 後衛 5%
  if (pos === "MF") return 0.035; // 中場 3.5%
  return 0.03; // 前鋒(把握失機)3%
}
function reliabilityFactor(p) {
  const w = errWeight(p.pos);
  return Math.max(0.78, 1 - (p.err3 || 0) * w); // 下限 0.78，避免單一因素過度壓低
}
function computeFit(p) {
  const base = p.sta === 0 && p.pos === "GK" ? 88 : p.sta;
  return clamp(base * restFactor(p.restDays) * loadFactor(p.load3) * formFactor(p.lastRating) * reliabilityFactor(p));
}
function clamp(v) {
  return Math.round(Math.max(40, Math.min(100, v)));
}
function fatigueTag(p) {
  if ((p.err3 || 0) >= 3) return {
    txt: "近期失誤多",
    color: C.rust
  };
  const high = p.restDays <= 2 && p.load3 >= 250;
  if (high) return {
    txt: "疲勞風險",
    color: C.rust
  };
  if ((p.err3 || 0) >= 2) return {
    txt: "失誤偏多",
    color: C.amber
  };
  if (p.restDays <= 3 && p.load3 >= 260) return {
    txt: "負荷偏高",
    color: C.amber
  };
  if (p.restDays >= 9) return {
    txt: "節奏生疏",
    color: C.sky
  };
  if (p.restDays >= 5 && p.load3 <= 230 && (p.err3 || 0) === 0) return {
    txt: "狀態穩定",
    color: C.pitch
  };
  return null;
}

// ── 戰力與機率 (只計可出賽球員) ───────────────────────────────
function formScore(form) {
  if (!form || !form.length) return 50; // 無近期戰績：給中性分
  const map = { W: 1, D: 0.4, L: 0 };
  return form.reduce((s, r) => s + (map[r] ?? 0.4), 0) / form.length * 100;
}
function availablePlayers(t) {
  return t.players.filter(p => !isOut(p));
}
function teamStrength(t) {
  const avail = availablePlayers(t);
  const roster = avail.length ? avail : t.players; // 安全網
  const ovr = roster.reduce((s, p) => s + p.ovr, 0) / roster.length;
  const fit = roster.reduce((s, p) => s + computeFit(p), 0) / roster.length;
  // 關鍵球員缺陣的額外懲罰：每名缺席的前三黃金球員依其總評加權扣分
  const golden = goldenThree(t).map(g => g.name);
  const missingGolden = t.players.filter(p => isOut(p) && golden.includes(p.name));
  const penalty = missingGolden.reduce((s, p) => s + (p.ovr - 75) * 0.25, 0);
  return ovr * 0.5 + fit * 0.3 + formScore(t.form) * 0.2 - penalty;
}
function modelProbs(home, away, ctx) {
  const c = ctx || {};
  let sh = teamStrength(home),
    sa = teamStrength(away);

  // (1) 主客場優勢：中立場不給；否則主隊 +homeAdv 點戰力
  const homeAdv = c.neutral ? 0 : c.homeAdv != null ? c.homeAdv : 3.0;
  sh += homeAdv;

  // (2) 對戰歷史 H2H：近 5 次交手淨勝場給小幅修正
  let h2hShift = 0;
  if (c.h2h) {
    const net = c.h2h.w - c.h2h.l; // 主隊視角淨勝
    h2hShift = net * 0.6; // 每淨勝 1 場 ≈ 0.6 點
    sh += h2hShift;
  }

  // (3) 天氣/場地：壓低比賽節奏，並依「技術依賴度差」拉近強弱
  const wx = c.weather || WEATHER.clear;
  const pitchF = (c.pitch || PITCH.good).factor;
  const envTech = wx.tech * pitchF; // 綜合技術發揮係數 (≤1)
  // 技術型球隊在惡劣環境吃虧更多 → 縮小雙方戰力差
  const techGap = c.techHome - c.techAway || 0;
  const techPenalty = (1 - envTech) * techGap * 0.5; // 技術較高的一方被環境拖累
  sh -= Math.max(0, techPenalty);
  sa -= Math.max(0, -techPenalty);
  const diff = sh - sa;
  const pHome = 1 / (1 + Math.exp(-diff / 6));
  const pAwayRaw = 1 - pHome;
  // 惡劣天氣 → 比賽節奏低、爆冷與和局機率升高
  const drawBoost = 1 + (1 - wx.tempo) * 1.4;
  const draw = Math.min(0.42, 0.32 * Math.exp(-Math.abs(diff) / 8) * drawBoost);
  const w = pHome * (1 - draw),
    l = pAwayRaw * (1 - draw),
    total = w + draw + l;
  return {
    home: w / total,
    draw: draw / total,
    away: l / total,
    sh,
    sa,
    homeAdv,
    h2hShift,
    envTech
  };
}
function impliedProbs(oh, od, oa) {
  const ih = 1 / oh,
    id = 1 / od,
    ia = 1 / oa,
    sum = ih + id + ia;
  return {
    home: ih / sum,
    draw: id / sum,
    away: ia / sum,
    margin: (sum - 1) * 100
  };
}
function avgFit(t) {
  const r = availablePlayers(t);
  const roster = r.length ? r : t.players;
  return Math.round(roster.reduce((s, p) => s + computeFit(p), 0) / roster.length);
}

// 黃金球員前三 (按總評)
function goldenThree(t) {
  return [...t.players].sort((a, b) => b.ovr - a.ovr).slice(0, 3);
}

// 白話解讀關鍵球員缺陣
function impactLine(team) {
  const golden = goldenThree(team);
  const outGolden = golden.filter(isOut);
  if (outGolden.length === 0) {
    // 都能上場，但檢查是否有近期失誤多的隱憂
    const shaky = golden.filter(p => (p.err3 || 0) >= 2);
    if (shaky.length) return {
      txt: `主力 ${shaky.map(p => p.name).join("、")} 近期失誤偏多，狀態存疑。`,
      color: C.amber
    };
    return {
      txt: "三大主力全數可上場，狀態穩定。",
      color: C.pitch
    };
  }
  const names = outGolden.map(p => p.name).join("、");
  const top = golden[0];
  if (outGolden.includes(top)) return {
    txt: `頭號球星 ${top.name} 缺陣，戰力明顯下降。`,
    color: C.rust
  };
  return {
    txt: `主力 ${names} 缺席，實力略受影響。`,
    color: C.amber
  };
}
const ATTRS = [{
  k: "pac",
  label: "速度 PAC"
}, {
  k: "sho",
  label: "射門 SHO"
}, {
  k: "pas",
  label: "傳球 PAS"
}, {
  k: "dri",
  label: "盤帶 DRI"
}, {
  k: "def",
  label: "防守 DEF"
}, {
  k: "phy",
  label: "身體 PHY"
}];

// ─────────────────────────────────────────────────────────────
function App() {
  const [homeKey, setHomeKey] = useState("ARG");
  const [awayKey, setAwayKey] = useState("FRA");
  const [odds, setOdds] = useState({
    home: "2.10",
    draw: "3.40",
    away: "3.20"
  });
  const [stake, setStake] = useState("1000");
  const [selPlayer, setSelPlayer] = useState(null);
  const [neutral, setNeutral] = useState(false);
  const [weatherKey, setWeatherKey] = useState("clear");
  const [pitchKey, setPitchKey] = useState("good");
  const [hcapLine, setHcapLine] = useState(-1.0);
  // ── 真實資料狀態 ─────────────────────────────────────────────
  const [liveFixtures, setLiveFixtures] = useState([]);
  const [liveMatch,    setLiveMatch]    = useState(null);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [dataDate,     setDataDate]     = useState("");
  const [aiPicks,      setAiPicks]      = useState([]);
  const [fixtureOpen,  setFixtureOpen]     = useState(true);
  const [expandedLeague, setExpandedLeague] = useState({});
  const [selLeague,    setSelLeague]        = useState(null); // null = 全部

  useEffect(() => {
    fetch(`${GITHUB_RAW}/data/fixtures.json`)
      .then(r => r.json())
      .then(d => {
        setLiveFixtures(d.fixtures || []);
        setDataDate((d.generated_at||"").slice(0,10));
      })
      .catch(() => {});
  }, []);

  // ── AI 精選：載入全部比賽資料後跑模型，取信心最高3場 ──────────────
  useEffect(() => {
    if (liveFixtures.length === 0) return;
    Promise.all(
      liveFixtures.map(fx =>
        fetch(`${GITHUB_RAW}/data/match_${fx.id}.json`)
          .then(r => r.json())
          .then(d => ({ fx, d }))
          .catch(() => null)
      )
    ).then(results => {
      const picks = results
        .filter(Boolean)
        .map(({ fx, d }) => {
          const ht  = createTeamFromData(d.home);
          const at  = createTeamFromData(d.away);
          const h2h = h2hFromMatch(d.h2h);
          const ctx = {
            neutral: true,
            weather: WEATHER.clear,
            pitch:   PITCH.good,
            h2h,
            techHome: techReliance(ht),
            techAway: techReliance(at),
          };
          const mdl     = modelProbs(ht, at, ctx);
          const maxProb = Math.max(mdl.home, mdl.draw, mdl.away);
          const pick    = mdl.home >= mdl.away && mdl.home >= mdl.draw ? "home"
                        : mdl.away >= mdl.home && mdl.away >= mdl.draw ? "away"
                        : "draw";
          return { fx, d, mdl, maxProb, pick, ht, at };
        })
        .sort((a, b) => b.maxProb - a.maxProb)
        .slice(0, 3);
      setAiPicks(picks);
    });
  }, [liveFixtures]);

  function loadMatch(fx) {
    setLoadingMatch(true);
    fetch(`${GITHUB_RAW}/data/match_${fx.id}.json`)
      .then(r => r.json())
      .then(d  => { setLiveMatch(d); setLoadingMatch(false); })
      .catch(() => setLoadingMatch(false));
  }

  const home = liveMatch ? createTeamFromData(liveMatch.home) : (TEAMS[homeKey] || TEAMS["ARG"]);
  const away = liveMatch ? createTeamFromData(liveMatch.away) : (TEAMS[awayKey] || TEAMS["FRA"]);
  const h2h = useMemo(() =>
    liveMatch ? h2hFromMatch(liveMatch.h2h) : getH2H(homeKey, awayKey),
    [homeKey, awayKey, liveMatch]);
  const ctx = useMemo(() => ({
    neutral,
    weather: WEATHER[weatherKey],
    pitch: PITCH[pitchKey],
    h2h,
    techHome: techReliance(home),
    techAway: techReliance(away)
  }), [neutral, weatherKey, pitchKey, h2h, homeKey, awayKey, liveMatch]);
  const model = useMemo(() => modelProbs(home, away, ctx), [homeKey, awayKey, ctx, liveMatch]);
  const xg = useMemo(() => expectedGoals(home, away, ctx), [homeKey, awayKey, ctx, liveMatch]);
  const sm = useMemo(() => scoreMatrix(xg.xgH, xg.xgA), [xg]);
  const hcap = useMemo(() => handicapProbs(xg.xgH, xg.xgA, hcapLine), [xg, hcapLine]);
  const oh = parseFloat(odds.home) || 0,
    od = parseFloat(odds.draw) || 0,
    oa = parseFloat(odds.away) || 0;
  const implied = useMemo(() => oh > 1 && od > 1 && oa > 1 ? impliedProbs(oh, od, oa) : null, [oh, od, oa]);
  const edge = implied ? {
    home: model.home - implied.home,
    draw: model.draw - implied.draw,
    away: model.away - implied.away
  } : null;
  const stakeNum = parseFloat(stake) || 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: C.bg,
      color: C.chalk,
      fontFamily: "'Inter', system-ui, sans-serif"
    },
    className: "app-root"
  }, /*#__PURE__*/React.createElement("style", null, `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        .osw { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        select, input { font-family: inherit; }
        .pquad:hover { background: ${C.panel2}; border-color: ${C.pitchDim}; }
        .app-root { padding-left: 260px; }
        .fix-sidebar { position: fixed; left: 0; top: 0; width: 260px; height: 100vh; overflow-y: auto; z-index: 80; background: #111711; border-right: 1px solid #2a3a28; }
        .fix-sidebar::-webkit-scrollbar { width: 4px; } .fix-sidebar::-webkit-scrollbar-thumb { background: #2a3a28; }
        @media (max-width: 880px){ .grid2 { grid-template-columns: 1fr !important; } .vs-wrap { flex-direction: column !important; } .app-root { padding-left: 0; } .fix-sidebar { position: relative; width: 100%; height: auto; border-right: none; border-bottom: 1px solid #2a3a28; } }
      `),
    /* ── AI 精選 3 場 ───────────────────────────────────── */
    aiPicks.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        background: "#0d1a0b", borderBottom: `2px solid ${C.pitch}`,
        padding: "10px 24px", display: "flex", gap: 12,
        flexWrap: "wrap", alignItems: "center"
      }
    },
      /*#__PURE__*/React.createElement("span", {
        className: "osw",
        style: { color: C.pitch, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: "0.05em" }
      }, "🤖 AI 精選"),
      ...aiPicks.map((pick, i) => {
        const recLabel = pick.pick === "home"
          ? `${pick.fx.home.tla||pick.fx.home.name.slice(0,3)} 贏`
          : pick.pick === "away"
          ? `${pick.fx.away.tla||pick.fx.away.name.slice(0,3)} 贏`
          : "和局";
        const recProb = Math.round(pick.maxProb * 100);
        const accent  = [C.pitch, C.amber, C.rust][i];
        return /*#__PURE__*/React.createElement("button", {
          key: pick.fx.id,
          onClick: () => loadMatch(pick.fx),
          style: {
            background: liveMatch && liveMatch.fixture_id === pick.fx.id ? C.pitchDim : "transparent",
            border: `1px solid ${accent}`,
            borderRadius: 6, padding: "5px 12px", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1
          }
        },
          /*#__PURE__*/React.createElement("span", {
            style: { fontSize: 11, color: accent, fontWeight: 700 }
          }, `#${i+1} ${recLabel} ${recProb}%`),
          /*#__PURE__*/React.createElement("span", {
            style: { fontSize: 10, color: C.mute }
          }, `${pick.fx.home.tla||pick.fx.home.name} vs ${pick.fx.away.tla||pick.fx.away.name}`)
        );
      })
    ),
    /* ── 今日賽事（分組面板，仿運彩格式）─────────────────── */
    /*#__PURE__*/React.createElement("div", {
      className: "fix-sidebar"
    },
      /* 面板 header */
      /*#__PURE__*/React.createElement("div", {
        style: {
          padding: "12px 16px 10px", borderBottom: `1px solid ${C.line}`,
          display: "flex", alignItems: "center", gap: 8
        }
      },
        /*#__PURE__*/React.createElement("span", {
          className: "osw",
          style: { fontSize: 13, color: C.pitch, fontWeight: 700, letterSpacing: "0.05em", flex: 1 }
        }, "⚽ 聯賽"),
        /*#__PURE__*/React.createElement("span", {
          style: { fontSize: 10, color: C.mute }
        }, dataDate),
        loadingMatch && /*#__PURE__*/React.createElement("span", {
          style: { fontSize: 10, color: C.amber }
        }, "⏳")
      ),
      /* 聯賽目錄 + 比賽清單 */
      (()=>{
        // 今日各聯賽的比賽數量 (by league.code)
        const countByCode = {};
        liveFixtures.forEach(fx => {
          const c = fx.league.code;
          countByCode[c] = (countByCode[c] || 0) + 1;
        });
        // 過濾顯示哪些比賽（依選中聯賽）
        const visibleFx = selLeague
          ? liveFixtures.filter(fx => fx.league.code === selLeague)
          : liveFixtures;
        return /*#__PURE__*/React.createElement("div", null,
          /* ── 聯賽目錄列表 ── */
          /*#__PURE__*/React.createElement("div", {
            style: { borderBottom: `1px solid ${C.line}`, paddingBottom: 4 }
          },
            /* 全部 */
            /*#__PURE__*/React.createElement("button", {
              onClick: () => setSelLeague(null),
              style: {
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "7px 16px", background: selLeague === null ? C.pitchDim : "none",
                border: "none", borderLeft: selLeague === null ? `3px solid ${C.pitch}` : "3px solid transparent",
                cursor: "pointer", color: selLeague === null ? C.chalk : C.mute
              }
            },
              /*#__PURE__*/React.createElement("span", { style: { fontSize: 13 } }, "📋"),
              /*#__PURE__*/React.createElement("span", { style: { fontSize: 12, flex: 1, textAlign: "left" } }, "全部聯賽"),
              liveFixtures.length > 0
              ? /*#__PURE__*/React.createElement("span", {
                  style: { fontSize: 10, background: C.pitch, color: "#000", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }
                }, liveFixtures.length)
              : /*#__PURE__*/React.createElement("span", { style: { fontSize: 10, color: C.mute } }, "…")
            ),
            /* LEAGUE_CATALOG 各聯賽 */
            ...LEAGUE_CATALOG.map(lc => {
              const cnt    = countByCode[lc.code] || 0;
              const isSel  = selLeague === lc.code;
              const hasMatch = cnt > 0;
              return /*#__PURE__*/React.createElement("button", {
                key: lc.code,
                onClick: () => hasMatch ? setSelLeague(isSel ? null : lc.code) : null,
                style: {
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 16px", background: isSel ? C.pitchDim : "none",
                  border: "none", borderLeft: isSel ? `3px solid ${C.pitch}` : "3px solid transparent",
                  cursor: hasMatch ? "pointer" : "default",
                  color: hasMatch ? (isSel ? C.chalk : "#b8c4b0") : "#4a5a48",
                  opacity: hasMatch ? 1 : 0.5
                }
              },
                /*#__PURE__*/React.createElement("span", { style: { fontSize: 13, minWidth: 18 } }, lc.flag),
                /*#__PURE__*/React.createElement("span", {
                  style: { fontSize: 12, flex: 1, textAlign: "left", fontWeight: hasMatch ? 500 : 400 }
                }, lc.name),
                hasMatch && /*#__PURE__*/React.createElement("span", {
                  style: { fontSize: 10, background: isSel ? C.pitch : C.line, color: isSel ? "#000" : C.mute, borderRadius: 10, padding: "1px 6px", fontWeight: 700 }
                }, cnt)
              );
            })
          ),
          /* ── 比賽清單 ── */
          fixtureOpen && visibleFx.length > 0 && /*#__PURE__*/React.createElement("div", {
            style: { padding: "6px 0 8px" }
          }, ...visibleFx.map(fx => {
            const isActive = liveMatch && liveMatch.fixture_id === fx.id;
            const t = fmtMatchTime(fx.date);
            return /*#__PURE__*/React.createElement("button", {
              key: fx.id,
              onClick: () => loadMatch(fx),
              style: {
                width: "100%", display: "flex", flexDirection: "column", gap: 2,
                padding: "7px 16px", background: isActive ? C.pitchDim : "none",
                border: "none", borderLeft: isActive ? `3px solid ${C.pitch}` : "3px solid transparent",
                cursor: "pointer", color: isActive ? C.chalk : "#b8c4b0",
                textAlign: "left", transition: "all 0.12s"
              }
            },
              /*#__PURE__*/React.createElement("span", {
                style: { fontSize: 10, color: isActive ? C.pitch : C.mute, fontFamily: "monospace" }
              }, fx.league.code, " · ", t),
              /*#__PURE__*/React.createElement("span", { style: { fontSize: 12, fontWeight: 500, lineHeight: 1.4 } },
                `${fx.home.name} vs ${fx.away.name}`
              )
            );
          }))
        );
      })()
    ),
    /* ── Header ─────────────────────────────────────────── */
    /*#__PURE__*/React.createElement("header", {
    style: {
      borderBottom: `1px solid ${C.line}`,
      padding: "20px 24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 22,
      fontWeight: 700,
      textTransform: "uppercase"
    }
  }, "\u6230\u8853\u5206\u6790\u53F0 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.pitch
    }
  }, "/ Pitch Read")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.mute,
      fontSize: 12,
      marginTop: 2
    }
  }, "\u8DB3\u7403\u8CFD\u4E8B AI \u5206\u6790\u539F\u578B \xB7 \u542B xG/\u6BD4\u5206/\u5927\u5C0F\u7403/\u8B93\u5206\u76E4\u7B49\u9032\u968E\u6A21\u578B \xB7 \u6A21\u64EC\u8CC7\u6599")), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 11,
      color: C.amber,
      border: `1px solid ${C.line}`,
      padding: "6px 10px",
      borderRadius: 4,
      maxWidth: 320
    }
  }, "\u26A0 \u793A\u7BC4\u539F\u578B \xB7 \u975E\u6295\u6CE8\u5EFA\u8B70 \xB7 \u4E0D\u4FDD\u8B49\u8D0F\u7387")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1180,
      margin: "0 auto",
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 24,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "vs-wrap",
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 28
    }
  }, /*#__PURE__*/React.createElement(TeamPicker, {
    side: "\u4E3B\u968A HOME",
    value: homeKey,
    onChange: v => v !== awayKey && setHomeKey(v),
    team: home,
    accent: C.pitch
  }), /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 40,
      fontWeight: 700,
      color: C.mute
    }
  }, "VS"), /*#__PURE__*/React.createElement(TeamPicker, {
    side: "\u5BA2\u968A AWAY",
    value: awayKey,
    onChange: v => v !== homeKey && setAwayKey(v),
    team: away,
    accent: C.sky,
    align: "right"
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u5148\u767C\u60C5\u5831 \xB7 \u4E09\u5927\u9EC3\u91D1\u7403\u54E1\u51FA\u8CFD\u72C0\u6CC1"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 16
    }
  }, "\uD83D\uDFE2 \u53EF\u51FA\u8CFD\u3000\uD83D\uDD34 \u53D7\u50B7\u3000\uD83D\uDFE1 \u505C\u8CFD\u3000\uD83D\uDFE0 \u5F85\u78BA\u8A8D \u2014 \u7F3A\u5E2D\u7684\u95DC\u9375\u7403\u54E1\u6703\u81EA\u52D5\u5F9E\u6230\u529B\u6263\u9664"), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(GoldenPanel, {
    team: home,
    accent: C.pitch
  }), /*#__PURE__*/React.createElement(GoldenPanel, {
    team: away,
    accent: C.sky
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u8CFD\u6CC1\u8A2D\u5B9A \xB7 \u4E3B\u5BA2\u5834 \xB7 \u5C0D\u6230\u6B77\u53F2 \xB7 \u5929\u6C23\u5834\u5730"), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: C.chalk,
      marginBottom: 10
    }
  }, "\uD83C\uDFDF\uFE0F \u5834\u5730\u512A\u52E2"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNeutral(false),
    style: venueBtn(!neutral)
  }, home.flag, " ", home.name, " \u4E3B\u5834 ", !neutral && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.pitch
    }
  }, "+", model.homeAdv.toFixed(1))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setNeutral(true),
    style: venueBtn(neutral)
  }, "\u2696\uFE0F \u4E2D\u7ACB\u7403\u5834 (\u7121\u4E3B\u5834\u512A\u52E2)"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 8,
      lineHeight: 1.5
    }
  }, neutral ? "中立場：雙方無主場加成，常見於世界盃決賽圈。" : `主場球隊獲得 +${model.homeAdv.toFixed(1)} 戰力加成(球迷、熟悉場地、無舟車勞頓)。`)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: C.chalk,
      marginBottom: 10
    }
  }, "\uD83D\uDCDC \u5C0D\u6230\u6B77\u53F2 H2H"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(H2HStat, {
    label: "\u52DD",
    v: h2h.w,
    color: C.pitch
  }), /*#__PURE__*/React.createElement(H2HStat, {
    label: "\u5E73",
    v: h2h.d,
    color: C.amber
  }), /*#__PURE__*/React.createElement(H2HStat, {
    label: "\u8CA0",
    v: h2h.l,
    color: C.rust
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      lineHeight: 1.5
    }
  }, home.flag, home.name, " \u8996\u89D2 \xB7 \u8FD1 5 \u6B21\u4EA4\u624B", /*#__PURE__*/React.createElement("br", null), h2h.note), model.h2hShift !== 0 && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 11,
      marginTop: 8,
      color: model.h2hShift > 0 ? C.pitch : C.rust
    }
  }, "H2H \u4FEE\u6B63 ", model.h2hShift > 0 ? "+" : "", model.h2hShift.toFixed(1), " \u6230\u529B")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: C.chalk,
      marginBottom: 10
    }
  }, "\uD83C\uDF26\uFE0F \u5929\u6C23\u8207\u5834\u5730"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 8
    }
  }, Object.keys(WEATHER).map(k => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setWeatherKey(k),
    title: WEATHER[k].label,
    style: {
      fontSize: 18,
      padding: "4px 7px",
      borderRadius: 6,
      cursor: "pointer",
      background: weatherKey === k ? C.panel : "transparent",
      border: `1px solid ${weatherKey === k ? C.sky : C.line}`
    }
  }, WEATHER[k].icon))), /*#__PURE__*/React.createElement("select", {
    value: pitchKey,
    onChange: e => setPitchKey(e.target.value),
    style: {
      width: "100%",
      background: C.panel,
      color: C.chalk,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: "6px 8px",
      fontSize: 12,
      marginBottom: 8
    }
  }, Object.keys(PITCH).map(k => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, PITCH[k].label))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      lineHeight: 1.5
    }
  }, WEATHER[weatherKey].icon, " ", WEATHER[weatherKey].note), model.envTech < 0.99 && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 11,
      marginTop: 8,
      color: C.amber
    }
  }, "\u6280\u8853\u767C\u63EE \xD7", model.envTech.toFixed(2), " \xB7 \u5F37\u5F31\u5DEE\u88AB\u62C9\u8FD1")))), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1.3fr 1fr",
      gap: 20,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u52DD\u8CA0\u6A5F\u7387 \xB7 \u6A21\u578B vs \u5E02\u5834"), /*#__PURE__*/React.createElement(ProbRow, {
    label: `${home.flag} 主勝`,
    model: model.home,
    implied: implied?.home,
    color: C.pitch
  }), /*#__PURE__*/React.createElement(ProbRow, {
    label: "\uD83E\uDD1D \u548C\u5C40",
    model: model.draw,
    implied: implied?.draw,
    color: C.amber
  }), /*#__PURE__*/React.createElement(ProbRow, {
    label: `${away.flag} 客勝`,
    model: model.away,
    implied: implied?.away,
    color: C.sky
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      marginTop: 16,
      fontSize: 11,
      color: C.mute
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-block",
      width: 10,
      height: 10,
      background: C.chalk,
      borderRadius: 2,
      marginRight: 5
    }
  }), "\u6A21\u578B\u4F30\u8A08"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-block",
      width: 10,
      height: 10,
      background: "transparent",
      border: `1px solid ${C.mute}`,
      borderRadius: 2,
      marginRight: 5
    }
  }), "\u8CE0\u7387\u96B1\u542B")), edge && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      borderTop: `1px solid ${C.line}`,
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.mute,
      marginBottom: 8
    }
  }, "\u5E02\u5834\u504F\u5DEE (\u6A21\u578B \u2212 \u96B1\u542B\uFF0C\u6B63\u503C=\u5E02\u5834\u6216\u4F4E\u4F30)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(EdgeChip, {
    label: "\u4E3B\u52DD",
    v: edge.home
  }), /*#__PURE__*/React.createElement(EdgeChip, {
    label: "\u548C\u5C40",
    v: edge.draw
  }), /*#__PURE__*/React.createElement(EdgeChip, {
    label: "\u5BA2\u52DD",
    v: edge.away
  })), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 10,
      color: C.mute,
      marginTop: 10
    }
  }, "\u838A\u5BB6\u62BD\u6C34 margin \u2248 ", implied.margin.toFixed(1), "%"))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u904B\u5F69\u8CE0\u7387\u8207\u671F\u671B\u503C"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 12
    }
  }, "\u624B\u52D5\u8F38\u5165\u53F0\u7063\u904B\u5F69\u8CE0\u7387 (\u6B50\u5F0F)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(OddsInput, {
    label: "\u4E3B\u52DD",
    value: odds.home,
    onChange: v => setOdds({
      ...odds,
      home: v
    })
  }), /*#__PURE__*/React.createElement(OddsInput, {
    label: "\u548C\u5C40",
    value: odds.draw,
    onChange: v => setOdds({
      ...odds,
      draw: v
    })
  }), /*#__PURE__*/React.createElement(OddsInput, {
    label: "\u5BA2\u52DD",
    value: odds.away,
    onChange: v => setOdds({
      ...odds,
      away: v
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 6
    }
  }, "\u5047\u8A2D\u4E0B\u6CE8\u91D1\u984D (NT$)"), /*#__PURE__*/React.createElement("input", {
    className: "mono",
    value: stake,
    onChange: e => setStake(e.target.value.replace(/[^0-9]/g, "")),
    style: {
      width: "100%",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      color: C.chalk,
      padding: "10px 12px",
      borderRadius: 6,
      fontSize: 15
    }
  })), implied && stakeNum > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      borderTop: `1px solid ${C.line}`,
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 10
    }
  }, "\u5404\u6CE8\u55AE\u671F\u671B\u503C (\u4EE5\u6A21\u578B\u6A5F\u7387\u4F30\u7B97)"), /*#__PURE__*/React.createElement(EVRow, {
    label: "\u4E3B\u52DD",
    p: model.home,
    odd: oh,
    stake: stakeNum
  }), /*#__PURE__*/React.createElement(EVRow, {
    label: "\u548C\u5C40",
    p: model.draw,
    odd: od,
    stake: stakeNum
  }), /*#__PURE__*/React.createElement(EVRow, {
    label: "\u5BA2\u52DD",
    p: model.away,
    odd: oa,
    stake: stakeNum
  }), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 10,
      color: C.rust,
      marginTop: 12,
      lineHeight: 1.5
    }
  }, "\u671F\u671B\u503C\u70BA\u6B63\u4E0D\u4EE3\u8868\u6703\u8D0F\uFF0C\u50C5\u4EE3\u8868\u300C\u82E5\u6A21\u578B\u6A5F\u7387\u6B63\u78BA\u300D\u7684\u9577\u671F\u6578\u5B78\u671F\u671B\u3002\u6A21\u578B\u672C\u8EAB\u6709\u8AA4\u5DEE\u3002")))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u9032\u653B / \u9632\u5B88\u5F37\u5EA6 \xB7 \u9810\u671F\u9032\u7403 xG"), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(AtkDefCard, {
    team: home,
    accent: C.pitch,
    ad: xg.aH,
    xg: xg.xgH
  }), /*#__PURE__*/React.createElement(AtkDefCard, {
    team: away,
    accent: C.sky,
    ad: xg.aA,
    xg: xg.xgA
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      textAlign: "center",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: C.mute
    }
  }, "\u9810\u671F\u7E3D\u9032\u7403 (xG \u5408\u8A08)\u3000"), /*#__PURE__*/React.createElement("span", {
    className: "mono osw",
    style: {
      fontSize: 26,
      fontWeight: 700,
      color: C.amber
    }
  }, (xg.xgH + xg.xgA).toFixed(2)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: C.mute
    }
  }, "\u3000\u7403"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 4
    }
  }, home.flag, " ", xg.xgH.toFixed(2), " \u2014 ", xg.xgA.toFixed(2), " ", away.flag, "\u3000\xB7\u3000xG \u7531\u653B\u9632\u5F37\u5EA6\u5C0D\u6BD4 + \u4E3B\u5834/\u5929\u6C23\u4FEE\u6B63\u63A8\u7B97"))), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr",
      gap: 20,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u6700\u53EF\u80FD\u6BD4\u5206 \xB7 Poisson \u63A8\u7B97"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap"
    }
  }, sm.topScores.map((sc, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "1 1 80px",
      textAlign: "center",
      background: i === 0 ? C.panel2 : "transparent",
      border: `1px solid ${i === 0 ? C.amber : C.line}`,
      borderRadius: 8,
      padding: "12px 8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 22,
      fontWeight: 700
    }
  }, sc.h, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, "\u2013"), sc.a), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 12,
      color: i === 0 ? C.amber : C.mute
    }
  }, (sc.p * 100).toFixed(1), "%")))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 10
    }
  }, "\u7531\u5169\u968A xG \u8DD1\u6CCA\u677E\u5206\u5E03\uFF0C\u5217\u51FA\u6A5F\u7387\u6700\u9AD8\u7684\u56DB\u7A2E\u6BD4\u5206(\u4E3B\u968A\u2013\u5BA2\u968A)\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      marginTop: 16,
      borderTop: `1px solid ${C.line}`,
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement(MiniStat, {
    label: "\u96D9\u65B9\u9032\u7403 BTTS",
    v: sm.btts,
    color: C.sky
  }), /*#__PURE__*/React.createElement(MiniStat, {
    label: "\u4E3B\u52DD(\u6BD4\u5206\u6A21\u578B)",
    v: sm.pHome,
    color: C.pitch
  }), /*#__PURE__*/React.createElement(MiniStat, {
    label: "\u5BA2\u52DD(\u6BD4\u5206\u6A21\u578B)",
    v: sm.pAway,
    color: C.sky
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u5927\u5C0F\u7403 Over / Under 2.5"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 30,
      background: C.panel2,
      borderRadius: 6,
      overflow: "hidden",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${sm.over25 * 100}%`,
      background: C.rust,
      display: "flex",
      alignItems: "center",
      paddingLeft: 10,
      transition: "width .4s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 12,
      fontWeight: 600
    }
  }, "\u5927 ", (sm.over25 * 100).toFixed(0), "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingRight: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: C.pitch
    }
  }, (sm.under25 * 100).toFixed(0), "% \u5C0F"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 10,
      lineHeight: 1.6
    }
  }, "\u300C\u5927\u7403\u300D= \u5168\u5834 3 \u7403\u4EE5\u4E0A\u3002\u9810\u671F\u7E3D\u9032\u7403 ", (xg.xgH + xg.xgA).toFixed(2), "\uFF0C", xg.xgH + xg.xgA >= 2.7 ? "偏向大球。" : xg.xgH + xg.xgA <= 2.2 ? "偏向小球。" : "接近 2.5 拉鋸，可看天氣與陣容微調。"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      padding: "10px 12px",
      background: C.panel2,
      borderRadius: 6,
      fontSize: 11,
      color: C.mute,
      lineHeight: 1.6
    }
  }, "\u60E1\u52A3\u5929\u6C23\u6216\u95DC\u9375\u653B\u64CA\u624B\u7F3A\u9663\u6703\u58D3\u4F4E xG \u2192 \u5C0F\u7403\u6A5F\u7387\u4E0A\u5347\uFF1B\u653B\u5F37\u5B88\u5F31\u5C0D\u6230\u5247\u76F8\u53CD\u3002"))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u8B93\u5206\u76E4 Handicap \xB7 ", home.flag, " ", home.name, " \u8B93 ", Math.abs(hcapLine).toFixed(hcapLine % 1 === 0 ? 0 : 2), " \u7403"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 16
    }
  }, [-2, -1.5, -1, -0.5, 0, 0.5, 1].map(ln => /*#__PURE__*/React.createElement("button", {
    key: ln,
    onClick: () => setHcapLine(ln),
    style: {
      padding: "7px 12px",
      borderRadius: 6,
      cursor: "pointer",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      background: hcapLine === ln ? C.panel2 : "transparent",
      color: hcapLine === ln ? C.amber : C.chalk,
      border: `1px solid ${hcapLine === ln ? C.amber : C.line}`
    }
  }, ln > 0 ? "+" : "", ln))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(HcapCell, {
    label: `${home.flag} 主隊讓分贏盤`,
    v: hcap.win,
    color: C.pitch
  }), /*#__PURE__*/React.createElement(HcapCell, {
    label: "\u8D70\u76E4 (\u9000\u6B3E)",
    v: hcap.push,
    color: C.amber
  }), /*#__PURE__*/React.createElement(HcapCell, {
    label: `${away.flag} 客隊受讓贏盤`,
    v: hcap.lose,
    color: C.sky
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 12,
      lineHeight: 1.6
    }
  }, "\u8CA0\u8B93\u5206(\u5982 \u22121)\u4EE3\u8868\u770B\u597D\u4E3B\u968A\u300C\u6DE8\u52DD\u8D85\u904E\u8A72\u7403\u6578\u300D\u624D\u7B97\u8D0F\u76E4\uFF1B\u8D70\u76E4=\u525B\u597D\u7B49\u65BC\u8B93\u5206\u7DDA\uFF0C\u672C\u91D1\u9000\u56DE\u3002\u7531 xG \u8DD1\u6CCA\u677E\u6A21\u578B\u4F30\u7B97\uFF0C\u53EF\u5C0D\u7167\u904B\u5F69\u8B93\u5206\u8CE0\u7387\u627E\u50F9\u503C\u3002")), /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "\u7D9C\u5408\u6230\u529B \xB7 \u5373\u6642\u9AD4\u529B + \u51FA\u8CFD\u9663\u5BB9\u52A0\u6B0A"), /*#__PURE__*/React.createElement(StrengthBar, {
    home: home,
    away: away,
    sh: model.sh,
    sa: model.sa
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(FitNote, {
    team: home,
    accent: C.pitch,
    note: FIT_NOTE[homeKey]
  }), /*#__PURE__*/React.createElement(FitNote, {
    team: away,
    accent: C.sky,
    note: FIT_NOTE[awayKey]
  }))), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Squad, {
    team: home,
    accent: C.pitch,
    onSelect: setSelPlayer,
    sel: selPlayer
  }), /*#__PURE__*/React.createElement(Squad, {
    team: away,
    accent: C.sky,
    onSelect: setSelPlayer,
    sel: selPlayer
  })), selPlayer && /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 22,
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, selPlayer.name, " \xB7 \u80FD\u529B\u8207\u9AD4\u529B\u5206\u6790"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSelPlayer(null),
    style: {
      background: "none",
      border: `1px solid ${C.line}`,
      color: C.mute,
      borderRadius: 6,
      padding: "4px 10px",
      cursor: "pointer",
      fontSize: 12
    }
  }, "\u95DC\u9589 \u2715")), isOut(selPlayer) && /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${STATUS[selPlayer.status].color}`,
      borderRadius: 6,
      padding: "10px 14px",
      marginBottom: 14,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: STATUS[selPlayer.status].color
    }
  }, STATUS[selPlayer.status].icon, " ", STATUS[selPlayer.status].txt), selPlayer.reason && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, " \u2014 ", selPlayer.reason)), /*#__PURE__*/React.createElement("div", {
    className: "vs-wrap",
    style: {
      display: "flex",
      gap: 28,
      alignItems: "flex-start",
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Radar, {
    player: selPlayer,
    accent: selPlayer._accent
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 240
    }
  }, /*#__PURE__*/React.createElement(StatLine, {
    label: "\u7E3D\u8A55 OVR",
    v: selPlayer.ovr,
    accent: selPlayer._accent
  }), /*#__PURE__*/React.createElement(StatLine, {
    label: "\u9AD4\u80FD\u4E0A\u9650 STA",
    v: selPlayer.sta,
    accent: C.amber
  }), /*#__PURE__*/React.createElement(StatLine, {
    label: "\u5373\u6642\u9AD4\u529B FIT",
    v: computeFit(selPlayer),
    accent: C.rust
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: C.chalk,
      marginBottom: 10,
      textTransform: "uppercase"
    }
  }, "\u9AD4\u529B\u8870\u6E1B\u5206\u89E3"), /*#__PURE__*/React.createElement(FactorRow, {
    label: "\u4F11\u606F\u5929\u6578",
    detail: `${selPlayer.restDays} 天`,
    factor: restFactor(selPlayer.restDays)
  }), /*#__PURE__*/React.createElement(FactorRow, {
    label: "\u8FD1 3 \u5834\u8CA0\u8377",
    detail: `${selPlayer.load3} 分鐘`,
    factor: loadFactor(selPlayer.load3)
  }), /*#__PURE__*/React.createElement(FactorRow, {
    label: "\u4E0A\u5834\u8868\u73FE",
    detail: `評分 ${selPlayer.lastRating}`,
    factor: formFactor(selPlayer.lastRating)
  }), /*#__PURE__*/React.createElement(FactorRow, {
    label: "\u8FD1 3 \u5834\u5931\u8AA4",
    detail: `${selPlayer.err3 || 0} 次`,
    factor: reliabilityFactor(selPlayer)
  }), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 10,
      color: C.mute,
      marginTop: 10,
      lineHeight: 1.6
    }
  }, "FIT = \u9AD4\u80FD\u4E0A\u9650 \xD7 \u4F11\u606F \xD7 \u8CA0\u8377 \xD7 \u8868\u73FE \xD7 \u53EF\u9760\u5EA6\uFF0C\u88C1\u5207\u65BC 40\u2013100\u3002", /*#__PURE__*/React.createElement("br", null), "\u5931\u8AA4\u5C0D\u9580\u5C07/\u5F8C\u885B\u6B0A\u91CD\u66F4\u9AD8(\u76F4\u63A5\u95DC\u4FC2\u5931\u5206)\u3002\u7686\u70BA\u793A\u7BC4\u6A21\u578B\u3002"))))), /*#__PURE__*/React.createElement("footer", {
    style: {
      marginTop: 28,
      padding: 18,
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      fontSize: 11,
      color: C.mute,
      lineHeight: 1.7
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: C.amber
    }
  }, "\u8CC7\u6599\u8207\u9650\u5236\u8AAA\u660E\uFF1A"), /*#__PURE__*/React.createElement("br", null), "\u2022 \u6578\u64DA\u70BA\u6A21\u64EC\u3002\u63A5\u771F\u5BE6\u7CFB\u7D71\uFF1A\u51FA\u8CFD/\u50B7\u505C\u540D\u55AE\u53EF\u6293 API-Football \u7684 injuries \u8207 lineups \u7AEF\u9EDE\uFF0C\u6216\u5B98\u65B9\u8CFD\u524D\u516C\u4F48\u540D\u55AE\uFF1B\u4F11\u606F\u5929\u6578/\u5206\u9418\u4F86\u81EA fixtures\uFF0C\u80FD\u529B\u7528 FIFA/EA \u8CC7\u6599\u96C6\uFF0C\u8CE0\u7387\u624B\u52D5\u8F38\u5165\u904B\u5F69\u5B98\u7DB2\u3002", /*#__PURE__*/React.createElement("br", null), "\u2022 \u53D7\u50B7/\u505C\u8CFD\u7403\u54E1\u6703\u81EA\u52D5\u6392\u9664\u65BC\u6230\u529B\u8A08\u7B97\uFF0C\u4E14\u82E5\u70BA\u4E09\u5927\u9EC3\u91D1\u7403\u54E1\u6703\u984D\u5916\u6263\u5206\u3002\u8FD1 3 \u5834\u5931\u8AA4\u6578\u8F49\u70BA\u300C\u53EF\u9760\u5EA6\u300D\u4FC2\u6578\u58D3\u4F4E\u5373\u6230\u50F9\u503C\uFF0C\u9580\u5C07/\u5F8C\u885B\u6B0A\u91CD\u66F4\u9AD8(\u5931\u8AA4\u8CC7\u6599\u53EF\u6293 FotMob/SofaScore \u7684 error-led-to-goal\u3001big-chance-missed \u7B49\u4E8B\u4EF6\u7D71\u8A08)\uFF1B\u4FC2\u6578\u70BA\u793A\u7BC4\u503C\uFF0C\u9808\u7528\u6B77\u53F2\u8CC7\u6599\u56DE\u6E2C\u6821\u6E96\u3002", /*#__PURE__*/React.createElement("br", null), "\u2022 \u4E3B\u5BA2\u5834\u512A\u52E2\u3001\u5C0D\u6230\u6B77\u53F2(H2H)\u3001\u5929\u6C23\u5834\u5730\u7686\u5373\u6642\u5F71\u97FF\u6230\u529B\u8207\u6A5F\u7387\uFF1A\u4E3B\u5834\u7D66\u56FA\u5B9A\u52A0\u6210(\u4E2D\u7ACB\u5834\u4E0D\u7D66)\uFF0CH2H \u8FD1 5 \u6B21\u6DE8\u52DD\u5834\u7D66\u5C0F\u5E45\u4FEE\u6B63\uFF0C\u60E1\u52A3\u5929\u6C23\u58D3\u4F4E\u6BD4\u8CFD\u7BC0\u594F\u4E26\u62C9\u8FD1\u5F37\u5F31\u5DEE\u3001\u63D0\u9AD8\u548C\u5C40\u8207\u7206\u51B7\u6A5F\u7387\u3002\u771F\u5BE6\u8CC7\u6599\uFF1A\u4E3B\u5BA2\u5834/H2H \u4F86\u81EA API-Football fixtures \u8207 head-to-head \u7AEF\u9EDE\uFF0C\u5929\u6C23\u53EF\u63A5 OpenWeather \u5C0D\u61C9\u6BD4\u8CFD\u5730\u9EDE\u8207\u958B\u8CFD\u6642\u9593\u3002", /*#__PURE__*/React.createElement("br", null), "\u2022 \u9032\u653B/\u9632\u5B88\u5F37\u5EA6\u7531\u7403\u54E1\u80FD\u529B\u5206\u4F4D\u7F6E\u5408\u6210\u4E26\u4EE5\u5373\u6642\u9AD4\u529B\u52A0\u6B0A\uFF1B\u9810\u671F\u9032\u7403 xG \u7531\u653B\u9632\u5C0D\u6BD4 + \u4E3B\u5834/\u5929\u6C23\u63A8\u7B97\uFF1B\u6700\u53EF\u80FD\u6BD4\u5206\u3001\u5927\u5C0F\u7403\u3001\u96D9\u65B9\u9032\u7403(BTTS)\u3001\u8B93\u5206\u76E4\u7686\u7531 xG \u8DD1\u6CCA\u677E(Poisson)\u5206\u5E03\u4F30\u7B97,\u908F\u8F2F\u8FD1\u4F3C Dixon-Coles \u7B49\u5B78\u8853\u6A21\u578B,\u4F46\u4FC2\u6578\u70BA\u793A\u7BC4\u503C,\u9808\u7528\u6B77\u53F2\u6BD4\u5206\u56DE\u6E2C\u6821\u6E96\u3002", /*#__PURE__*/React.createElement("br", null), "\u2022 \u6A21\u578B\u6A5F\u7387\u3001\u5E02\u5834\u504F\u5DEE\u3001\u671F\u671B\u503C\u50C5\u4F9B\u5206\u6790\u5E02\u5834\u5B9A\u50F9\uFF0C", /*#__PURE__*/React.createElement("strong", null, "\u4E0D\u4FDD\u8B49\u4EFB\u4F55\u8D0F\u7387\uFF0C\u4EA6\u975E\u6295\u6CE8\u5EFA\u8B70"), "\u3002\u7406\u6027\u4E0B\u6CE8\u3001\u91CF\u529B\u800C\u70BA\u3002")));
}

// ── 元件 ────────────────────────────────────────────────────
function SectionTitle({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 14,
      fontWeight: 600,
      textTransform: "uppercase",
      color: C.chalk,
      marginBottom: 14,
      letterSpacing: "0.04em"
    }
  }, children);
}

// 黃金球員面板 (小白友善)
function GoldenPanel({
  team,
  accent
}) {
  const golden = goldenThree(team);
  const impact = impactLine(team);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "osw",
    style: {
      fontSize: 15,
      fontWeight: 600,
      color: accent
    }
  }, team.flag, " ", team.name), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: C.mute
    }
  }, "\u982D\u865F\u7403\u661F TOP 3")), golden.map((p, i) => {
    const s = STATUS[p.status];
    const out = isOut(p);
    return /*#__PURE__*/React.createElement("div", {
      key: p.name,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderBottom: i < 2 ? `1px solid ${C.line}` : "none",
        opacity: out ? 0.6 : 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "osw",
      style: {
        fontSize: 20,
        fontWeight: 700,
        color: C.mute,
        width: 22
      }
    }, i + 1), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 22
      }
    }, s.light), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        textDecoration: out ? "line-through" : "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, p.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: s.color
      }
    }, s.icon, " ", s.txt, p.reason ? ` · ${p.reason}` : "", !out && (p.err3 || 0) >= 2 ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.rust
      }
    }, " \xB7 \u8FD1 3 \u5834 ", p.err3, " \u5931\u8AA4") : null)), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "mono",
      style: {
        fontSize: 16,
        fontWeight: 600,
        color: accent
      }
    }, p.ovr), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.mute
      }
    }, "\u7E3D\u8A55")));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      padding: "10px 12px",
      background: C.panel,
      borderRadius: 6,
      borderLeft: `3px solid ${impact.color}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.mute,
      marginBottom: 2
    }
  }, "\u4E00\u53E5\u8A71\u89E3\u8B80"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: impact.color,
      fontWeight: 500
    }
  }, impact.txt)));
}
function TeamPicker({
  side,
  value,
  onChange,
  team,
  accent,
  align = "left"
}) {
  const outCount = team.players.filter(isOut).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: align === "right" ? "right" : "left",
      minWidth: 160
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 6
    }
  }, side), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 44,
      lineHeight: 1
    }
  }, team.flag), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      display: "flex",
      flexWrap: "wrap",
      gap: 4,
      justifyContent: align === "right" ? "flex-end" : "flex-start"
    }
  }, TEAM_KEYS.map(k => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => onChange(k),
    style: {
      background: value === k ? accent : C.panel2,
      color: value === k ? "#0a0f09" : C.chalk,
      border: `1px solid ${value === k ? accent : C.line}`,
      borderRadius: 4,
      padding: "4px 9px",
      fontSize: 12,
      fontWeight: value === k ? 700 : 400,
      cursor: "pointer",
      transition: "all 0.15s",
      whiteSpace: "nowrap"
    }
  }, `${TEAMS[k].flag} ${TEAMS[k].name}`))), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      marginTop: 8,
      fontSize: 11,
      color: C.mute
    }
  }, "FIFA\u6392\u540D #", team.rank, " \xB7 \u8FD1\u6CC1 ", team.form.map((r, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      color: r === "W" ? C.pitch : r === "D" ? C.amber : C.rust
    }
  }, r))), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      marginTop: 4,
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, "\u5168\u968A\u5373\u6642\u9AD4\u529B "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.rust
    }
  }, avgFit(team)), outCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.amber
    }
  }, " \xB7 ", outCount, " \u4EBA\u7F3A\u9663")));
}
function AtkDefCard({
  team,
  accent,
  ad,
  xg
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "osw",
    style: {
      fontSize: 15,
      fontWeight: 600,
      color: accent
    }
  }, team.flag, " ", team.name), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 12,
      color: C.mute
    }
  }, "\u9810\u671F\u9032\u7403 ", /*#__PURE__*/React.createElement("span", {
    className: "osw",
    style: {
      fontSize: 18,
      color: C.amber
    }
  }, xg.toFixed(2)))), /*#__PURE__*/React.createElement(StrengthMeter, {
    label: "\u9032\u653B\u5F37\u5EA6",
    v: ad.atk,
    color: C.rust
  }), /*#__PURE__*/React.createElement(StrengthMeter, {
    label: "\u9632\u5B88\u5F37\u5EA6",
    v: ad.def,
    color: C.pitch
  }));
}
function StrengthMeter({
  label,
  v,
  color
}) {
  const pct = Math.max(0, Math.min(100, v));
  const grade = v >= 85 ? "頂級" : v >= 78 ? "強" : v >= 70 ? "中上" : v >= 62 ? "中等" : "偏弱";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 12,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color
    }
  }, v.toFixed(1), " \xB7 ", grade)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 10,
      background: C.panel2,
      borderRadius: 5,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct}%`,
      height: "100%",
      background: color,
      transition: "width .4s"
    }
  })));
}
function MiniStat({
  label,
  v,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono osw",
    style: {
      fontSize: 20,
      fontWeight: 700,
      color
    }
  }, (v * 100).toFixed(0), "%"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.mute
    }
  }, label));
}
function HcapCell({
  label,
  v,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: "14px 8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono osw",
    style: {
      fontSize: 26,
      fontWeight: 700,
      color
    }
  }, (v * 100).toFixed(1), "%"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginTop: 4
    }
  }, label));
}
function venueBtn(active) {
  return {
    width: "100%",
    textAlign: "left",
    display: "block",
    marginBottom: 8,
    background: active ? C.panel : "transparent",
    color: C.chalk,
    border: `1px solid ${active ? C.pitch : C.line}`,
    borderRadius: 6,
    padding: "9px 11px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit"
  };
}
function H2HStat({
  label,
  v,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: "center",
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: "8px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 20,
      fontWeight: 700,
      color
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.mute
    }
  }, label));
}
function ProbRow({
  label,
  model,
  implied,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 13,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    className: "mono"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color
    }
  }, (model * 100).toFixed(1), "%"), implied != null && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, " \xB7 \u5E02\u5834 ", (implied * 100).toFixed(1), "%"))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 16,
      background: C.panel2,
      borderRadius: 4,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      width: `${model * 100}%`,
      background: color,
      opacity: 0.85,
      transition: "width .4s"
    }
  }), implied != null && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `${implied * 100}%`,
      width: 2,
      background: C.chalk,
      boxShadow: `0 0 0 1px ${C.bg}`
    }
  })));
}
function EdgeChip({
  label,
  v
}) {
  const pos = v >= 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      padding: "6px 10px",
      borderRadius: 6,
      background: C.panel2,
      border: `1px solid ${pos ? C.pitchDim : C.line}`,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, label, " "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: pos ? C.pitch : C.rust
    }
  }, pos ? "+" : "", (v * 100).toFixed(1), "%"));
}
function OddsInput({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.mute,
      marginBottom: 4,
      textAlign: "center"
    }
  }, label), /*#__PURE__*/React.createElement("input", {
    className: "mono",
    value: value,
    onChange: e => onChange(e.target.value.replace(/[^0-9.]/g, "")),
    style: {
      width: "100%",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      color: C.chalk,
      padding: "10px 6px",
      borderRadius: 6,
      fontSize: 15,
      textAlign: "center"
    }
  }));
}
function EVRow({
  label,
  p,
  odd,
  stake
}) {
  const ev = p * (odd - 1) * stake - (1 - p) * stake;
  const pos = ev >= 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "7px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 13,
      color: pos ? C.pitch : C.rust
    }
  }, pos ? "+" : "", Math.round(ev).toLocaleString(), " NT$"));
}
function StrengthBar({
  home,
  away,
  sh,
  sa
}) {
  const total = sh + sa,
    ph = sh / total * 100;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: 28,
      borderRadius: 6,
      overflow: "hidden",
      border: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${ph}%`,
      background: C.pitchDim,
      display: "flex",
      alignItems: "center",
      paddingLeft: 10,
      transition: "width .4s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "osw",
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, home.flag, " ", sh.toFixed(1))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${100 - ph}%`,
      background: "#2B4258",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingRight: 10,
      transition: "width .4s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "osw",
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, sa.toFixed(1), " ", away.flag))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 11,
      color: C.mute,
      marginTop: 8
    }
  }, "\u7D9C\u5408\u6230\u529B = \u5E73\u5747\u7E3D\u8A55\xD70.5 + \u5E73\u5747\u5373\u6642\u9AD4\u529B\xD70.3 + \u8FD1\u6CC1\xD70.2 \u2212 \u95DC\u9375\u7F3A\u9663\u61F2\u7F70"));
}
function FitNote({
  team,
  accent,
  note
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: accent,
      marginBottom: 4
    }
  }, team.flag, " ", team.name, " \u9AD4\u80FD\u5099\u8A3B"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.mute,
      lineHeight: 1.5
    }
  }, note));
}
function Squad({
  team,
  accent,
  onSelect,
  sel
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "osw",
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: accent,
      marginBottom: 12
    }
  }, team.flag, " ", team.name, " \xB7 \u4E3B\u529B\u540D\u55AE",
    team.players.length > 0 && team.players[0]._isDefault &&
      /*#__PURE__*/React.createElement("span", {
        style: { fontSize:10, color: C.mute, fontWeight:400, marginLeft:8 }
      }, "\u2014 \u9810\u8A2D\u9663\u5BB9\uFF0C\u8CFD\u524D\u516C\u4F48\u5F8C\u66F4\u65B0")
  ), team.players.map(p => {
    const active = sel && sel.name === p.name;
    const fit = computeFit(p);
    const tag = fatigueTag(p);
    const out = isOut(p);
    const s = STATUS[p.status];
    return /*#__PURE__*/React.createElement("button", {
      key: p.name,
      className: "pquad",
      onClick: () => onSelect({
        ...p,
        _accent: accent
      }),
      style: {
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: active ? C.panel2 : "transparent",
        border: `1px solid ${active ? accent : C.line}`,
        borderRadius: 6,
        padding: "9px 11px",
        marginBottom: 7,
        cursor: "pointer",
        color: C.chalk,
        transition: "all .15s",
        opacity: out ? 0.55 : 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 10,
        color: C.mute,
        width: 24
      }
    }, p.pos), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        width: 20,
        textAlign: "center"
      }
    }, s.light), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "block",
        fontSize: 13,
        fontWeight: 500,
        textDecoration: out ? "line-through" : "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, p.name), out ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: s.color
      }
    }, s.icon, " ", s.txt) : tag && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: tag.color
      }
    }, "\u25CF ", tag.txt, " \xB7 \u4F11", p.restDays, "\u5929")), /*#__PURE__*/React.createElement(Pip, {
      label: "OVR",
      v: p.ovr,
      color: accent
    }), /*#__PURE__*/React.createElement(Pip, {
      label: p.pos === "GK" ? "STA" : p.pos === "DF" ? "DEF" : p.pos === "FW" ? "SHO" : "PAS",
      v: p.pos === "GK" ? p.sta : p.pos === "DF" ? p.def : p.pos === "FW" ? p.sho : p.pas,
      color: C.amber
    }), /*#__PURE__*/React.createElement(Pip, {
      label: "\u9AD4\u529B",
      v: out ? 0 : fit,
      color: C.rust,
      highlight: !out && fit < p.sta - 6
    }));
  }), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9,
      color: C.mute,
      marginTop: 6
    }
  }, "\uD83D\uDFE2\u53EF\u51FA\u8CFD \uD83D\uDD34\u53D7\u50B7 \uD83D\uDFE1\u505C\u8CFD \uD83D\uDFE0\u5F85\u78BA\u8A8D \xB7 \u522A\u9664\u7DDA=\u672C\u5834\u7F3A\u9663"));
}
function Pip({
  label,
  v,
  color,
  highlight
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "center",
      minWidth: 36
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 600,
      color: v ? color : C.mute,
      textShadow: highlight ? `0 0 6px ${color}` : "none"
    }
  }, v || "—"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 8,
      color: C.mute
    }
  }, label));
}
function StatLine({
  label,
  v,
  accent
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 12,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: accent
    }
  }, v)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      background: C.panel2,
      borderRadius: 3,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${v}%`,
      height: "100%",
      background: accent
    }
  })));
}
function FactorRow({
  label,
  detail,
  factor
}) {
  const pct = (factor - 1) * 100,
    pos = pct >= 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "5px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12
    }
  }, label, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.mute,
      fontSize: 11
    }
  }, detail)), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 12,
      color: pos ? C.pitch : C.rust
    }
  }, "\xD7", factor.toFixed(2), " (", pos ? "+" : "", pct.toFixed(0), "%)"));
}
function Radar({
  player,
  accent
}) {
  const size = 200,
    cx = size / 2,
    cy = size / 2,
    R = 72;
  const vals = ATTRS.map(a => player[a.k] || 0);
  const pts = vals.map((v, i) => {
    const ang = Math.PI * 2 * i / ATTRS.length - Math.PI / 2;
    const r = v / 100 * R;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  });
  const poly = pts.map(p => p.join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      flexShrink: 0
    }
  }, rings.map((rr, ri) => {
    const ringPts = ATTRS.map((_, i) => {
      const ang = Math.PI * 2 * i / ATTRS.length - Math.PI / 2;
      return [cx + R * rr * Math.cos(ang), cy + R * rr * Math.sin(ang)].join(",");
    }).join(" ");
    return /*#__PURE__*/React.createElement("polygon", {
      key: ri,
      points: ringPts,
      fill: "none",
      stroke: C.line,
      strokeWidth: "1"
    });
  }), ATTRS.map((a, i) => {
    const ang = Math.PI * 2 * i / ATTRS.length - Math.PI / 2;
    const lx = cx + (R + 16) * Math.cos(ang),
      ly = cy + (R + 16) * Math.sin(ang);
    return /*#__PURE__*/React.createElement("g", {
      key: a.k
    }, /*#__PURE__*/React.createElement("line", {
      x1: cx,
      y1: cy,
      x2: cx + R * Math.cos(ang),
      y2: cy + R * Math.sin(ang),
      stroke: C.line,
      strokeWidth: "1"
    }), /*#__PURE__*/React.createElement("text", {
      x: lx,
      y: ly,
      fill: C.mute,
      fontSize: "8",
      textAnchor: "middle",
      dominantBaseline: "middle",
      fontFamily: "JetBrains Mono"
    }, a.label.split(" ")[1]));
  }), /*#__PURE__*/React.createElement("polygon", {
    points: poly,
    fill: accent,
    fillOpacity: "0.25",
    stroke: accent,
    strokeWidth: "2"
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: "2.5",
    fill: accent
  })));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(App));
