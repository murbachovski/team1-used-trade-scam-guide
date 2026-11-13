/* 중고거래 피해 대응 길잡이 — 목업
   분류는 기획서 〈표 7〉 규칙표를 코드로 한다. AI는 결과 화면 추가 질문에만 쓰고,
   목업에서는 근거 문서에서 미리 옮겨 쓴 예시 답을 보여 준다. */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── 위기 표현 (정해진 단어 목록) ───────────────── */
const CRISIS_WORDS = ["죽고 싶", "죽고싶", "자살", "극단적", "살기 싫", "살기싫", "사라지고 싶", "뛰어내리", "목숨", "끝내고 싶", "자해", "죽어버리", "죽을래"];
const hasCrisis = (t) => CRISIS_WORDS.some((w) => t.replace(/\s+/g, " ").includes(w));

/* ── 사실 항목 질문 (〈표 5〉) ───────────────── */
const Q = {
  situation: {
    ask: "어떤 일이 있었나요?",
    label: "상황 구분",
    opts: [
      ["trade", "중고거래에서 피해를 입었어요", "돈을 보냈거나 물건을 받았는데 문제가 생겼어요"],
      ["mistake", "계좌번호나 금액을 잘못 입력해 송금했어요", "착오송금"],
      ["phishing", "인증번호·비밀번호를 알려 줬거나 링크로 앱을 설치했어요", "보이스피싱 등 다른 피해"],
      ["unknown", "잘 모르겠어요", ""],
    ],
  },
  clarify: {
    ask: "계좌번호나 금액을 잘못 입력하셨나요, 거래 상대에게 보냈는데 문제가 생겼나요?",
    label: "다시 확인",
    opts: [
      ["mistake", "계좌번호나 금액을 잘못 입력했어요", ""],
      ["trade", "거래 상대에게 보냈는데 문제가 생겼어요", ""],
      ["unknown", "그것도 잘 모르겠어요", ""],
    ],
  },
  item: {
    ask: "무엇을 사셨나요?",
    label: "상품 종류",
    opts: [
      ["real", "실물", "옷·전자기기처럼 손에 받는 물건"],
      ["voucher", "비실물", "기프티콘·쿠폰·상품권·티켓"],
      ["unknown", "모름", ""],
    ],
  },
  pay: {
    ask: "돈은 어떻게 보내셨나요?",
    label: "송금 방법",
    opts: [
      ["bank", "계좌이체", ""],
      ["safe", "플랫폼 안전결제", ""],
      ["cash", "직거래 현장 결제", ""],
      ["unknown", "모름", ""],
    ],
  },
  recv: {
    ask: "물건은 받으셨나요?",
    label: "수령 상태",
    opts: [
      ["none", "못 받음", ""],
      ["shipping", "배송 중이라고 함", ""],
      ["mismatch", "받았는데 설명과 상태가 다름", ""],
      ["different", "전혀 다른 물건이 옴", ""],
      ["broken", "배송 중 파손됨", ""],
      ["used", "쿠폰·번호가 이미 사용됐거나 없음", ""],
      ["fake", "가품이 의심됨", ""],
      ["unknown", "모름", ""],
    ],
  },
  contact: {
    ask: "지금 판매자와 연락이 되나요?",
    label: "연락 상태",
    opts: [
      ["ok", "연락돼요", ""],
      ["blocked", "답이 없거나 차단됐어요", ""],
      ["gone", "판매 글이나 계정이 사라졌어요", ""],
      ["unknown", "모름", ""],
    ],
  },
  fake: {
    ask: "판매 글에서 이상한 점을 보셨나요?",
    label: "가짜 판매 글 정황",
    opts: [
      ["photo", "판매 사진이 남의 사진이었어요", ""],
      ["victims", "같은 판매자의 다른 피해 글을 봤어요", ""],
      ["none", "없었어요", ""],
      ["unknown", "모름", ""],
    ],
  },
};
const ORDER = ["item", "pay", "recv", "contact", "fake"];

/* ── 〈표 7〉 분류 규칙표: 위에서부터 처음 맞는 줄 ───────────────── */
const RULES = [
  { no: "1", recv: "different", kind: "fraud", cond: "전혀 다른 물건이 옴" },
  { no: "2", fake: "photo", kind: "fraud", cond: "판매 사진이 남의 사진이었음" },
  { no: "3", fake: "victims", kind: "fraud", cond: "다른 피해 글을 봄" },
  { no: "4", recv: "none", contact: "blocked", kind: "fraud", cond: "못 받음 + 답 없음·차단" },
  { no: "5", recv: "none", contact: "gone", kind: "fraud", cond: "못 받음 + 판매 글·계정 사라짐" },
  { no: "6", recv: "used", kind: "fraud", cond: "쿠폰·번호가 이미 사용됨·없음" },
  { no: "7", recv: "mismatch", contact: "ok", kind: "dispute", cond: "설명과 상태가 다름 + 연락됨" },
  { no: "8", recv: "broken", contact: "ok", kind: "dispute", cond: "배송 중 파손 + 연락됨" },
  { no: "9", recv: "fake", kind: "unsure", cond: "가품 의심" },
];
const ELSE_RULE = { no: "-", kind: "unsure", cond: "그 밖의 모든 경우" };
const KIND_NAME = { fraud: "사기 의심", dispute: "거래 분쟁", out: "범위 밖", unsure: "판단 어려움" };

function classify(f) {
  for (const r of RULES) {
    if (r.recv && r.recv !== f.recv) continue;
    if (r.contact && r.contact !== f.contact) continue;
    if (r.fake && r.fake !== f.fake) continue;
    return r;
  }
  return ELSE_RULE;
}

/* ── 상태 ───────────────── */
const state = { answers: [], notes: [], crisis: false, asks: [] };

function facts() {
  const f = {};
  for (const [q, v] of state.answers) f[q] = v;
  return f;
}
function optLabel(q, v) {
  const o = Q[q].opts.find((x) => x[0] === v);
  return o ? o[1] : v;
}
function nextQ() {
  const f = facts();
  if (!("situation" in f)) return "situation";
  if (f.situation === "unknown" && !("clarify" in f)) return "clarify";
  if (situation(f) !== "trade") return null;
  return ORDER.find((q) => !(q in f)) || null;
}
function situation(f) {
  if (f.situation === "unknown") return f.clarify || "unknown";
  return f.situation;
}

/* ── 결과 ───────────────── */
function outcome() {
  const f = facts();
  const s = situation(f);
  if (s === "mistake") return { kind: "out", sub: "mistake" };
  if (s === "phishing") return { kind: "out", sub: "phishing" };
  if (s === "unknown") return { kind: "unsure", rule: { no: "-", cond: "어떤 일인지 가리기 어려움" }, early: true };
  const rule = classify(f);
  return { kind: rule.kind, rule };
}

function todoList(o, f) {
  if (o.kind === "fraud") {
    const t = ["<b>더 보내지 마세요.</b> 판매자와의 대화 화면과 판매 글을 지금 바로 캡처해 두세요. 지워지기 전에 남겨야 해요."];
    if (f.pay === "bank" || f.pay === "unknown") t.push("<b>이체한 은행에 연락해</b> 지급정지가 되는지 물어보세요. 은행마다 판단이 달라요.");
    if (f.pay === "safe") t.push("<b>거래한 플랫폼에 신고하세요.</b> 채팅방이나 판매자 프로필의 신고 메뉴를 쓰면 돼요.");
    if (f.item === "voucher" || f.recv === "used") t.push("<b>쿠폰 발행처에서 사용 내역을 확인하고</b> 그 화면도 증거로 남기세요.");
    t.push("<b>경찰청 사이버범죄 신고시스템(ECRM)</b>에 신고하거나 경찰서에 가세요. 아래 증거 정리표를 들고 가면 돼요.");
    return t;
  }
  if (o.kind === "dispute") {
    return [
      "<b>판매자에게 요청 메시지를 보내세요.</b> 아래 초안을 고쳐 써도 돼요.",
      "답이 없거나 합의가 안 되면 <b>거래한 플랫폼에 1차 조정</b>을 요청하세요.",
      "그래도 풀리지 않으면 <b>전자문서·전자거래분쟁조정위원회</b>에 조정을 신청하세요.",
    ];
  }
  if (o.kind === "out" && o.sub === "mistake") {
    return [
      "<b>송금한 은행에 반환을 요청하세요.</b>",
      "돌려받지 못하면 <b>예금보험공사 착오송금 반환지원</b>을 문의하세요(☎1588-0037). 금액과 절차는 예금보험공사에서 확인해 주세요.",
    ];
  }
  if (o.kind === "out") {
    return [
      "<b>지금 바로 112에 신고하세요.</b>",
      "<b>송금한 은행 콜센터</b>에 피해신고와 계좌 지급정지를 신청하세요. 금융감독원 1332에서도 연결해 줘요.",
    ];
  }
  return [
    "판매자와의 대화, 판매 글, 받은 물건 사진을 <b>캡처해 두세요.</b>",
    "<b>온라인피해 365센터 상담원</b>과 이야기해 보세요. ☎142-235(평일 09:00~18:00, 점심 12:00~13:00 제외), 온라인 신청은 www.helpos.kr 에서 24시간 받아요.",
    "아래 증거 정리표를 함께 내면 같은 질문을 다시 받지 않아도 돼요.",
  ];
}

const TITLES = {
  fraud: "사기가 의심되는 상황이에요",
  dispute: "거래 분쟁으로 안내해 드려요",
  unsure: "상담원과 함께 살펴보는 게 좋겠어요",
  mistake: "착오송금은 다른 창구에서 도와줘요",
  phishing: "보이스피싱은 지금 바로 신고하세요",
};

function whyText(o) {
  if (o.kind === "out" && o.sub === "mistake") return "거래 상대에게 보냈는데 물건을 못 받은 경우는 착오송금이 아니에요. 그런 경우라면 처음부터 다시 해서 「중고거래에서 피해를 입었어요」를 골라 주세요.";
  if (o.kind === "out") return "보이스피싱은 길잡이가 다루는 중고거래 피해가 아니라서 규칙표보다 먼저 가렸어요.";
  if (o.early) return "어떤 일인지 가리기 어려워 규칙표로 나누지 않았어요.";
  if (o.rule.no === "9") return "규칙 9: 가품 의심. 판매자가 가품인 걸 알고 팔았는지는 길잡이가 가릴 수 없어서 상담원에게 이어 드려요.";
  if (o.rule.no === "-") return "규칙표의 어느 줄에도 들어맞지 않았어요. 신호가 섞여 있으면 상담원이 살펴보는 게 정확해요.";
  return `규칙 ${o.rule.no}: ${o.rule.cond}`;
}

function draftMessage(f) {
  const what = f.recv === "broken" ? "배송 중 파손되어" : "판매 글 설명과 상태가 달라";
  return `안녕하세요. ○월 ○일에 거래한 [상품명] 구매자예요.\n받은 물건이 ${what} 연락드려요. 사진을 함께 보내 드려요.\n반품 후 환불과 수리 비용 부담 가운데 어떻게 처리할지 ○월 ○일까지 답을 부탁드려요.`;
}

/* ── 증거 정리표 (6칸, 순서 고정) ───────────────── */
const CHECKS = {
  fraud: ["판매자와의 대화 내역 전체 캡처 (날짜·시간이 보이게)", "판매 글 캡처와 글 주소 (지워지기 전)", "상대방 프로필 화면 (닉네임·ID)", "입금확인서 (이체 확인증)"],
  dispute: ["판매 글 설명 캡처", "받은 물건 사진 (문제가 있는 부분)", "판매자와의 대화 내역 캡처", "판매자에게 보낸 요청 메시지", "결제 내역"],
  unsure: ["판매자와의 대화 내역 캡처", "판매 글 캡처와 글 주소", "받은 물건 사진", "결제 내역"],
};
function agencies(o, f) {
  if (o.kind === "fraud") {
    const a = [];
    if (f.pay === "safe") a.push("거래 플랫폼 : 신고 메뉴로 신고");
    else if (f.pay !== "cash") a.push("이체한 은행 : 지급정지 문의 (은행마다 판단이 다름)");
    a.push("경찰청 사이버범죄 신고시스템 ecrm.police.go.kr 또는 경찰서");
    a.push("도움이 더 필요하면 온라인피해 365센터 ☎142-235");
    return a;
  }
  if (o.kind === "dispute") {
    return ["판매자 : 요청 메시지", "거래 플랫폼 : 1차 조정", "전자문서·전자거래분쟁조정위원회 : 조정 신청", "돈을 돌려받는 게 목적이고 상대가 응하지 않으면 대한법률구조공단 ☎132 (지급명령 상담)"];
  }
  return ["온라인피해 365센터 ☎142-235 · www.helpos.kr"];
}

/* ── 추가 질문 AI (목업 예시 답) ───────────────── */
const ANSWERS = {
  bank: {
    test: /지급정지|은행|계좌.*(막|정지|묶)/,
    text: [
      "중고거래 사기는 「전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법」상 지급정지 의무 대상이 아니에요(제2조제2호 단서). 그래서 은행이 반드시 계좌를 막아주지는 않고, 은행마다 판단이 달라요.",
      "경찰에 신고하면 수사기관이 은행에 지급정지를 요청할 수 있지만 거절될 수도 있어요. 피해금 회수는 보통 형사고소나 민사소송으로 진행돼요.",
      "2026년 7월에 중고거래 사기도 지급정지 대상에 넣는 개정안이 발의됐지만, 발의된 법안이고 현재 시행 중인 법은 아니에요.",
    ],
    src: ["기사 요약: 은행권, 투자·중고 사기 의심계좌 지급정지 외면 · 핵심 내용", "전기통신금융사기 지급정지(법제처 생활법령정보) · 제2조(정의)"],
    basis: "근거 조문: 전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법 제2조제2호 단서",
  },
  gift: {
    test: /기프티콘|쿠폰/,
    text: [
      "이미 사용한 기프티콘을 중고 플랫폼에 올려 팔고, 계좌이체를 받은 뒤 연락을 끊는 수법이 알려져 있어요. 같은 쿠폰을 여러 번 올려 피해자가 여럿 생기기도 해요.",
      "개인 간 거래라 피해자가 직접 사기를 입증하고 경찰에 신고해야 해요. 쿠폰 발행처에서 사용 내역을 확인해 그 화면을 증거로 남기세요.",
    ],
    src: ["기사 요약: 이미 사용된 기프티콘 중고 판매 사기 · 핵심 내용"],
    basis: "출처: 소비자가 만드는 신문, 2021. 12. 30. 기사 요약",
  },
  mediation: {
    test: /분쟁조정|조정/,
    text: [
      "전자문서·전자거래분쟁조정위원회는 개인 간 전자거래의 배송·계약·반품·환불 분쟁도 다뤄요. 당사자나 대리인 누구나 신청할 수 있어요.",
      "누리집 「조정신청」으로 접수하거나 방문·우편·이메일(ecmc@kisa.or.kr)·팩스(061-820-2613)로 신청해요. 신청서 양식은 누리집 「정보마당」에 있어요.",
      "신청일로부터 45일 안에 조정안을 받을 수 있고, 받은 날부터 15일 안에 동의 여부를 알려야 해요. 양쪽이 모두 수락하면 재판상 화해와 같은 효력이 생겨요.",
    ],
    src: ["전자문서·전자거래분쟁조정위원회 자주하는 질문 (요약) · 조정 대상과 신청 자격", "전자문서·전자거래분쟁조정위원회 자주하는 질문 (요약) · 신청 방법", "전자문서·전자거래분쟁조정위원회 자주하는 질문 (요약) · 진행 절차"],
    basis: "출처: usr.ecmc.or.kr 자주하는 질문",
  },
  order: {
    test: /지급명령|소송|법원/,
    text: [
      "지급명령은 돈을 돌려달라는 청구에 이유가 있으면, 법원이 변론 없이 상대에게 지급을 명하는 재판이에요(민사소송법 제462조).",
      "상대가 국내에서 서류를 받을 수 있어야 해요. 상대가 외국에 있거나 어디 있는지 알 수 없으면 대상이 되지 않아요.",
      "상대는 송달받은 날부터 2주 안에 이의신청할 수 있고, 이의신청이 없으면 확정판결과 같은 효력이 생겨요. 절차 상담은 대한법률구조공단(☎132)에서 받을 수 있어요.",
    ],
    src: ["지급명령 (대한법률구조공단 혼자하는 소송) · 지급명령의 개념", "지급명령 (대한법률구조공단 혼자하는 소송) · 요건", "지급명령 (대한법률구조공단 혼자하는 소송) · 효력 / 신청 절차"],
    basis: "근거 조문: 민사소송법 제462조·제468조·제474조",
  },
  police: {
    test: /신고|경찰|ecrm/i,
    text: [
      "경찰청 사이버범죄 신고시스템(ECRM, ecrm.police.go.kr)에 먼저 신고 접수한 뒤 경찰서를 방문하면 빠르게 처리할 수 있어요. 가족 같은 대리인도 경찰서 방문이나 국민신문고로 신고할 수 있어요.",
      "환불·배송지연·개인 간 다툼 같은 민사 소송 대상은 ECRM으로 신고할 수 없어요. 긴급신고는 112(무료, 24시간)예요.",
    ],
    src: ["중고거래 피해 신고와 대응방법 (찾기쉬운 생활법령정보) · 경찰서 신고", "경찰청 · 사이버범죄 신고시스템(ECRM)"],
    basis: "출처: 법제처 찾기쉬운 생활법령정보 「중고거래 피해 신고와 대응방법」",
  },
  center: {
    test: /365|상담원|상담 ?시간|언제/,
    text: [
      "온라인피해 365센터 전화 상담은 ☎142-235(국번없이, 수신자부담)로 평일 09:00~12:00, 13:00~18:00에 받아요.",
      "홈페이지 www.helpos.kr 「온라인상담」과 카카오톡 채널 「온라인피해365센터」는 365일 24시간 신청할 수 있고, 답변은 전화 상담시간에 와요.",
    ],
    src: ["방송미디어통신위원회 · 온라인피해365센터 안내"],
    basis: "출처: kmcc.go.kr 온라인피해365센터 안내",
  },
};
const CHIPS = {
  fraud: ["은행이 계좌를 막아 주나요?", "경찰 신고는 어떻게 해요?", "기프티콘이 이미 사용된 거면요?"],
  dispute: ["분쟁조정은 어떻게 신청해요?", "지급명령이 뭐예요?"],
  unsure: ["365센터 상담은 언제 받을 수 있어요?", "분쟁조정은 어떻게 신청해요?"],
  out: [],
};
function mockAnswer(q) {
  for (const a of Object.values(ANSWERS)) if (a.test.test(q)) return a;
  return null;
}

/* ── 그리기 ───────────────── */
const chat = $("#chat");
const dock = $("#dock");

function botHTML(inner, cls = "") { return `<div class="msg bot ${cls}">${inner}</div>`; }

function render() {
  let h = botHTML("<p>안녕하세요. 중고거래 피해를 입으셨다면 <b>어디에 먼저 가야 하는지</b> 같이 정리해 볼게요.</p><p>버튼을 누르면 돼요. 사기인지 판정하지는 않아요.</p>");
  for (const n of state.notes) {
    h += `<div class="msg me"><p>${esc(n)}</p></div>`;
    h += botHTML("<p>적어 주신 글은 위기 표현이 있는지만 확인했어요. 상황은 버튼으로 여쭤볼게요.</p>");
  }
  state.answers.forEach(([q, v], i) => {
    h += botHTML(`<p>${Q[q].ask}</p>`);
    h += `<div class="msg me"><p>${esc(optLabel(q, v))}</p><button class="btn-text edit" data-rewind="${i}" style="padding:0;min-height:0">이 답 고치기</button></div>`;
  });

  const q = nextQ();
  if (q) {
    h += botHTML(`<p>${Q[q].ask}</p>`);
    chat.innerHTML = h;
    renderOptions(q);
  } else {
    h += summaryHTML();
    h += resultHTML();
    chat.innerHTML = h;
    dock.innerHTML = "";
    bindResult();
  }
}

function renderOptions(q) {
  const f = facts();
  let opts = Q[q].opts;
  if (q === "recv" && f.item === "voucher") {
    opts = [...opts].sort((a, b) => (b[0] === "used") - (a[0] === "used"));
  }
  let h = `<p class="q-label">${Q[q].label} · 하나를 골라 주세요</p><div class="opt-wrap">`;
  for (const [v, t, sub] of opts) {
    h += `<button class="btn btn-secondary opt" data-q="${q}" data-v="${v}"><span>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
  }
  h += "</div>";
  if (q === "situation") {
    h += `<form class="free" id="freeForm" autocomplete="off">
      <label class="skip" for="freeText">직접 적기</label>
      <input class="input" id="freeText" placeholder="직접 적어도 돼요 (주민등록번호·비밀번호는 적지 마세요)">
      <button class="btn btn-primary" type="submit">보내기</button>
    </form>`;
  }
  dock.innerHTML = h;
  const ff = $("#freeForm");
  if (ff) ff.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("#freeText").value.trim();
    if (!t) return;
    state.notes.push(t);
    if (hasCrisis(t)) showCrisis();
    render();
  });
}

function summaryHTML() {
  const f = facts();
  if (situation(f) !== "trade") return "";
  const rows = ["situation", ...ORDER].map((q) => {
    const v = q === "situation" ? "trade" : f[q];
    const label = q === "situation" ? "중고거래 피해" : optLabel(q, v);
    return `<dt>${Q[q].label}</dt><dd>${esc(label)}</dd>`;
  }).join("");
  return botHTML(`<p>이렇게 정리했어요. 다른 부분은 위에서 「이 답 고치기」를 누르면 돼요.</p><dl class="facts">${rows}</dl>`, "wide");
}

function resultHTML() {
  const f = facts();
  const o = outcome();
  const title = o.kind === "out" ? TITLES[o.sub] : TITLES[o.kind];
  let h = `<section class="result ${o.kind} wide appear" id="result" tabindex="-1" aria-labelledby="resTitle">
    <span class="result-kind">${KIND_NAME[o.kind]}</span>
    <h2 id="resTitle">${title}</h2>
    <p class="why">${esc(whyText(o))}</p>
    <ol class="todo">${todoList(o, f).map((t) => `<li><span>${t}</span></li>`).join("")}</ol>
    <p class="disclaim">※ 이 안내는 법적 판단이 아니에요.</p>
    <p class="line109">마음이 많이 힘들다면 <a href="tel:109">자살예방 상담전화 <b>☎109</b></a></p>
  </section>`;

  if (!o.early && o.kind !== "out") h += rulesHTML(o);

  if (o.kind === "dispute") {
    h += `<div class="msg bot wide"><p><b>판매자에게 보낼 요청 메시지 초안</b></p><div class="draft" id="draftText">${esc(draftMessage(f))}</div><button class="btn btn-secondary" data-copy="draftText">초안 복사하기</button></div>`;
  }
  if (o.kind === "unsure") {
    h += `<div class="msg bot wide"><p>정리한 내용을 상담원에게 함께 넘기면 같은 질문을 다시 받지 않아요.</p><p style="margin-top:10px"><button class="btn btn-primary" id="handoff">정리한 내용과 함께 상담원 연결 요청하기</button></p></div>`;
  }
  if (o.kind !== "out") h += sheetHTML(o, f);
  h += askHTML(o);
  h += `<div class="row-btns"><button class="btn btn-secondary" id="restart">처음부터 다시 하기</button></div>`;
  return h;
}

function rulesHTML(o) {
  const hitIdx = o.rule.no === "-" ? RULES.length : RULES.findIndex((r) => r.no === o.rule.no);
  const all = [...RULES, ELSE_RULE];
  const rows = all.map((r, i) => {
    const st = i < hitIdx ? "pass" : i === hitIdx ? "hit" : "after";
    return `<li class="rule ${st}" data-st="${st}"><span class="rule-no">${r.no}</span><span class="rule-cond">${esc(r.cond)}</span><span class="rule-res">${KIND_NAME[r.kind]}</span></li>`;
  }).join("");
  return `<details class="rules result ${o.kind} wide" open style="padding:0;background:var(--white)">
    <summary>왜 이렇게 안내했나요 · 규칙 ${o.rule.no === "-" ? "그 밖" : o.rule.no}</summary>
    <p class="rules-note">규칙표를 위에서부터 차례로 대 보고 처음 맞는 줄로 안내해요. 사기 신호가 있는 줄이 위에 있어요.</p>
    <ol class="rule-list" id="ruleList">${rows}</ol>
  </details>`;
}

function sheetHTML(o, f) {
  const res = o.rule.no === "-" ? `${KIND_NAME[o.kind]} (${o.rule.cond})` : `${KIND_NAME[o.kind]} (규칙 ${o.rule.no}: ${o.rule.cond})`;
  const checks = [...CHECKS[o.kind]];
  if (o.kind === "fraud" && (f.item === "voucher" || f.recv === "used")) checks.push("쿠폰 발행처의 사용 내역 확인 화면");
  return `<section class="sheet wide" aria-labelledby="sheetT">
    <div class="sheet-head">
      <h3 id="sheetT">증거 정리표</h3>
      <p class="detail" style="margin:0">칸과 순서는 늘 같아요. 모르는 칸은 비워 두면 「모름」으로 적혀요. 입력한 내용은 이 브라우저 밖으로 보내지 않아요.</p>
    </div>
    <div class="cell"><p class="cell-t" style="margin:0"><span>1</span>진단 결과</p><div class="cell-fixed" id="sv1">${esc(res)}</div></div>
    <div class="cell field"><label class="cell-t" for="sv2"><span>2</span>사건 타임라인</label>
      <textarea class="area" id="sv2" placeholder="예: 10/01 판매 글 확인 (중고거래 앱 OO)&#10;10/02 14:10 150,000원 계좌이체&#10;10/05 연락 두절"></textarea></div>
    <div class="cell field"><label class="cell-t" for="sv3"><span>3</span>피해 금액</label>
      <input class="input" id="sv3" inputmode="numeric" placeholder="예: 150,000원 (계좌이체 1회)"></div>
    <div class="cell"><p class="cell-t" style="margin:0"><span>4</span>상대방 정보</p>
      <div class="field"><label for="sv4a">거래 앱 / 닉네임 / 프로필 ID</label><input class="input" id="sv4a" placeholder="예: OO 앱 / OO마켓 / #ab12cd"></div>
      <div class="field"><label for="sv4b">입금 계좌 (은행·번호·예금주)</label><input class="input" id="sv4b" placeholder="예: OO은행 123-XXX-XXXX (예금주 홍OO)"></div>
      <div class="field"><label for="sv4c">연락처</label><input class="input" id="sv4c" placeholder="모르면 비워 두세요"></div>
    </div>
    <div class="cell"><p class="cell-t" style="margin:0"><span>5</span>필수 첨부 증거 체크리스트</p>
      <div class="checks">${checks.map((c, i) => `<label class="check"><input type="checkbox" data-check="${esc(c)}" id="ck${i}"><span>${esc(c)}</span></label>`).join("")}</div></div>
    <div class="cell"><p class="cell-t" style="margin:0"><span>6</span>우선 제출 기관 (순서)</p>
      <div class="cell-fixed"><ol style="margin:0;padding-left:18px">${agencies(o, f).map((a) => `<li>${esc(a)}</li>`).join("")}</ol></div></div>
    <button class="btn btn-primary btn-block" id="download">증거 정리표 내려받기 (TXT)</button>
  </section>`;
}

function askHTML(o) {
  const chips = CHIPS[o.kind] || [];
  return `<section class="ask wide" aria-labelledby="askT">
    <h3 class="h4" id="askT" style="margin:0">기관 절차가 더 궁금하면 물어보세요</h3>
    <p class="detail" style="margin:0">공공기관 안내 문서에서 찾아 근거 문서 이름과 함께 답해요. 분류나 판정에는 쓰지 않아요.</p>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<button class="chip" data-ask="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
    <div id="askLog" style="display:grid;gap:12px"></div>
    <form class="free" id="askForm" autocomplete="off">
      <label class="skip" for="askText">질문 적기</label>
      <input class="input" id="askText" placeholder="예: 분쟁조정은 얼마나 걸려요?">
      <button class="btn btn-primary" type="submit">묻기</button>
    </form>
  </section>`;
}

function askRender() {
  const log = $("#askLog");
  if (!log) return;
  log.innerHTML = state.asks.map((a) => {
    let h = `<div class="msg me"><p>${esc(a.q)}</p></div>`;
    if (a.loading) return h + botHTML(`<p aria-label="답을 찾는 중">답을 찾는 중이에요…</p>`);
    if (a.crisis) return h + botHTML("<p>먼저 화면 맨 위의 109 안내를 봐 주세요. 원하시면 이어서 질문에 답해 드릴게요.</p>");
    const ans = a.ans;
    if (!ans) {
      return h + botHTML(`<span class="ai-tag">AI가 만든 문장 · 목업 예시</span><p>근거 문서에서 이 내용을 찾지 못했어요. 온라인피해 365센터(☎142-235, www.helpos.kr)에 문의해 주세요.</p>`, "wide");
    }
    return h + botHTML(`<span class="ai-tag">AI가 만든 문장 · 목업 예시</span>${ans.text.map((t) => `<p>${esc(t)}</p>`).join("")}
      <div class="src">근거 문서<ul>${ans.src.map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p style="margin:4px 0 0">${esc(ans.basis)}</p></div>`, "wide");
  }).join("");
}

function ask(q) {
  q = q.trim();
  if (!q) return;
  const item = { q, loading: true };
  state.asks.push(item);
  if (hasCrisis(q)) { item.loading = false; item.crisis = true; showCrisis(); askRender(); return; }
  askRender();
  setTimeout(() => { item.loading = false; item.ans = mockAnswer(q); askRender(); }, 600);
}

/* ── 위기 상자 ───────────────── */
function showCrisis() {
  if (state.crisis) { window.scrollTo({ top: 0 }); return; }
  state.crisis = true;
  $("#crisisSlot").innerHTML = `<section class="crisis appear" role="alert" aria-labelledby="crT">
    <h2 id="crT">지금 많이 힘드시죠</h2>
    <p>혼자 견디지 않으셔도 돼요. 자살예방 상담전화에서 이야기를 들어 드려요.</p>
    <a class="call109" href="tel:109"><b>109</b><span>자살예방 상담전화 걸기</span></a>
    <button class="btn btn-ghost btn-block" id="crisisGo">원하시면 이어서 피해 상황을 정리해 드릴게요</button>
  </section>`;
  $("#crisisGo").addEventListener("click", () => $("#chat").scrollIntoView({ behavior: "smooth" }));
  window.scrollTo({ top: 0 });
}

/* ── 결과 화면 동작 ───────────────── */
function bindResult() {
  const res = $("#result");
  if (res) res.focus({ preventScroll: true });
  scanRules();
  $("#restart").addEventListener("click", () => { state.answers = []; state.notes = []; state.asks = []; render(); window.scrollTo({ top: 0 }); });
  const dl = $("#download");
  if (dl) dl.addEventListener("click", downloadSheet);
  const ho = $("#handoff");
  if (ho) ho.addEventListener("click", () => toast("목업 화면이라 실제로 보내지 않았어요."));
  const cp = document.querySelector("[data-copy]");
  if (cp) cp.addEventListener("click", () => {
    const t = $("#" + cp.dataset.copy).textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("초안을 복사했어요."), () => toast("복사하지 못했어요. 초안을 길게 눌러 직접 복사하세요."));
  });
  document.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.ask)));
  $("#askForm").addEventListener("submit", (e) => { e.preventDefault(); const i = $("#askText"); ask(i.value); i.value = ""; });
  askRender();
}

/* 시그니처: 규칙표를 위에서부터 한 줄씩 대 보는 모습 */
function scanRules() {
  const rows = [...document.querySelectorAll("#ruleList .rule")];
  if (!rows.length) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  rows.forEach((r) => { r.dataset.final = r.className; r.className = "rule pending"; });
  rows.forEach((r, i) => setTimeout(() => { r.className = r.dataset.final; }, 70 * (i + 1)));
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function downloadSheet() {
  const v = (id) => ($("#" + id).value.trim() || "모름");
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  const checks = [...document.querySelectorAll("[data-check]")].map((c) => `[${c.checked ? "v" : " "}] ${c.dataset.check}`);
  const ag = [...document.querySelectorAll(".sheet .cell-fixed ol li")].map((li, i) => `${"①②③④⑤"[i]} ${li.textContent}`);
  const line = "==================================================";
  const txt = [
    line, "[온라인피해365센터] 중고거래 피해 제출용 증거 정리표", line,
    `작성일시 : ${stamp} (중고거래 피해 대응 길잡이)`, "",
    `1. 진단 결과 : ${$("#sv1").textContent}`, "",
    "2. 사건 타임라인", ...v("sv2").split("\n").map((l) => `- ${l}`), "",
    `3. 피해 금액 : ${v("sv3")}`, "",
    "4. 상대방 정보", `- 거래 앱 / 닉네임 / 프로필 ID : ${v("sv4a")}`, `- 입금 계좌 : ${v("sv4b")}`, `- 연락처 : ${v("sv4c")}`, "",
    "5. 필수 첨부 증거 체크리스트", ...checks, "",
    "6. 우선 제출 기관 (순서)", ...ag,
    "--------------------------------------------------",
    "※ 위 내용은 피해자가 확인·수정한 것입니다. 원본 캡처 파일을 함께 내세요.",
    "※ 본 정리표는 안내용이며 법적 효력을 갖지 않습니다.",
    line, "",
  ].join("\r\n");
  const blob = new Blob(["﻿" + txt], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `증거정리표_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("증거 정리표를 내려받았어요.");
}

/* ── 이벤트 ───────────────── */
document.addEventListener("click", (e) => {
  const opt = e.target.closest("[data-q]");
  if (opt) {
    state.answers.push([opt.dataset.q, opt.dataset.v]);
    render();
    const target = nextQ() ? dock : $("#result");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const rw = e.target.closest("[data-rewind]");
  if (rw) {
    state.answers = state.answers.slice(0, +rw.dataset.rewind);
    state.asks = [];
    render();
    dock.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

render();
