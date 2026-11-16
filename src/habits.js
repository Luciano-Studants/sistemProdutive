// Regras do módulo de hábitos e do Pomodoro. Funções puras (sem tela, rede ou armazenamento)
// para poderem ser testadas isoladas.
//
// Hábito:
// { id, name, desc, icon, cat, start:'AAAA-MM-DD', paused:boolean, link:''|'screen', tpl:'',
//   freq:{mode:'days'|'week', days:[0..6], perWeek:n},
//   period:'any'|'morning'|'afternoon'|'night',
//   goal:{type:'duration'|'count'|'time', value:minutos|número|null, unit:'texto', time:'HH:MM'},
//   remind:{on:boolean, time:'HH:MM'},
//   end:{mode:'none'|'date'|'days', date:'', days:n},
//   hist:[{from:'AAAA-MM-DD', goal, freq}],   // configurações em vigor a partir de cada data
//   logs:{ 'AAAA-MM-DD': [{id, v, at}] } }
// Mudar meta ou frequência só vale daqui para frente: dias passados usam a configuração
// que estava em vigor naquele dia (hist).

const pad = (n) => String(n).padStart(2, '0');
export const parse = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const dowOf = (k) => parse(k).getDay();
export const weekStart = (k) => addDays(k, -((dowOf(k) + 6) % 7)); // segunda-feira

export const CATS = ['Saúde', 'Sono', 'Produtividade', 'Desenvolvimento pessoal', 'Bem-estar', 'Organização', 'Outros'];
export const PERIODS = { any: 'Qualquer horário', morning: 'Manhã', afternoon: 'Tarde', night: 'Noite' };

/* Modelos: trazem só o que é sugestão. Metas, horários e prazos pessoais ficam em branco. */
export const TEMPLATES = [
  { id: 'screen', name: 'Tempo de tela diário', desc: 'Acompanhar e controlar o tempo diário de utilização de dispositivos.', cat: 'Produtividade', icon: '📱',
    freq: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 5 }, period: 'any',
    goal: { type: 'duration', value: null, unit: '', time: '' }, link: 'screen', tpl: 'screen' },
  { id: 'water', name: 'Beber água', desc: 'Acompanhar a frequência de consumo de água durante o dia.', cat: 'Saúde', icon: '💧',
    freq: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 5 }, period: 'any',
    goal: { type: 'count', value: null, unit: '', time: '' }, link: '', tpl: 'water' },
  { id: 'wake', name: 'Horário de acordar', desc: 'Desenvolver regularidade no horário de acordar.', cat: 'Sono', icon: '⏰',
    freq: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 5 }, period: 'morning',
    goal: { type: 'time', value: null, unit: '', time: '' }, link: '', tpl: 'wake' },
  { id: 'sleep', name: 'Horário de dormir', desc: 'Desenvolver regularidade no horário de dormir.', cat: 'Sono', icon: '😴',
    freq: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 5 }, period: 'night',
    goal: { type: 'time', value: null, unit: '', time: '' }, link: '', tpl: 'sleep' }
];

/* ---------- configuração em vigor e fim do acompanhamento ---------- */
export function cfgAt(h, key) {
  let cur = { goal: h.goal, freq: h.freq };
  if (Array.isArray(h.hist)) {
    cur = null;
    for (const e of h.hist) if (e.from <= key) cur = e;
    if (!cur) cur = h.hist[0] || { goal: h.goal, freq: h.freq };
  }
  return cur;
}
/* Último dia de acompanhamento (inclusive); '' se não termina. */
export function lastDay(h) {
  const e = h.end || { mode: 'none' };
  if (e.mode === 'date' && e.date) return e.date;
  if (e.mode === 'days' && e.days > 0) return addDays(h.start, e.days - 1);
  return '';
}
export function isFinished(h, today) {
  const l = lastDay(h);
  return !!l && today > l;
}

/* ---------- valores do dia ---------- */
export const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
export function timeDiff(planned, actual) {
  // diferença em minutos, circular: planejado 23:00 e real 00:30 dá +90. Valor inválido: null.
  if (!isTime(planned) || !isTime(actual)) return null;
  const m = (t) => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
  return ((m(actual) - m(planned) + 720 + 1440) % 1440) - 720;
}
export function logsOf(h, key) { return (h.logs && h.logs[key]) || []; }

/* Valor registrado no dia: número (soma), horário 'HH:MM' (último) ou null se não há registro. */
export function dayValue(h, key, S) {
  if (h.link === 'screen') {
    const d = S.days && S.days[key];
    return d && d.screen != null ? d.screen : null;
  }
  const items = logsOf(h, key);
  if (!items.length) return null;
  const type = cfgAt(h, key).goal.type;
  // Registro de outro tipo (hábito que mudou de horário para quantidade, ou o contrário) é ignorado.
  if (type === 'time') {
    const t = items.filter((x) => isTime(x && x.v));
    return t.length ? t[t.length - 1].v : null;
  }
  const n = items.filter((x) => x && (typeof x.v === 'number' || (typeof x.v === 'string' && x.v !== '' && !isNaN(Number(x.v)))) && isFinite(Number(x.v)));
  return n.length ? n.reduce((a, x) => a + Number(x.v), 0) : null;
}
/* Dia cumprido. Tempo de tela é limite (no máximo a meta); os demais, no mínimo a meta.
   Sem meta preenchida, qualquer registro conta, e nunca vira "meta zero". */
export function dayDone(h, key, S) {
  const v = dayValue(h, key, S);
  if (v == null) return false;
  const g = cfgAt(h, key).goal;
  if (g.type === 'time' || g.value == null) return true;
  return h.link === 'screen' ? v <= g.value : v >= g.value;
}
/* Tem registro mas ainda não cumpriu. */
export function dayPartial(h, key, S) {
  return dayValue(h, key, S) != null && !dayDone(h, key, S);
}
export function isScheduled(h, key, S) {
  const f = cfgAt(h, key).freq;
  if (f.mode === 'days') return f.days.indexOf(dowOf(key)) >= 0;
  return true;
}
export function weekDone(h, key, S) {
  const ws = weekStart(key);
  let n = 0;
  for (let i = 0; i < 7; i++) if (dayDone(h, addDays(ws, i), S)) n++;
  return n;
}

/* Estado do hábito hoje: finished | paused | done | pending | active */
export function habitState(h, today, S) {
  if (isFinished(h, today)) return 'finished';
  if (h.paused) return 'paused';
  if (dayDone(h, today, S)) return 'done';
  const f = cfgAt(h, today).freq;
  if (f.mode === 'days') return f.days.indexOf(dowOf(today)) >= 0 ? 'pending' : 'active';
  return weekDone(h, today, S) < f.perWeek ? 'pending' : 'active';
}
export const STATE_LABEL = { finished: 'Finalizado', paused: 'Pausado', done: 'Concluído hoje', pending: 'Pendente', active: 'Ativo' };

export function hasAnyLog(h, S) {
  if (h.link === 'screen') {
    for (const k in (S.days || {})) if (k >= h.start && S.days[k].screen != null) return true;
    return false;
  }
  return Object.keys(h.logs || {}).some((k) => (h.logs[k] || []).length);
}

/* ---------- estatísticas ---------- */
/* Esperado x cumprido num intervalo [from, to], cortado ao período de acompanhamento. */
export function rangeStats(h, S, from, to, today) {
  const end = [to, today, lastDay(h) || to].reduce((a, b) => (a < b ? a : b));
  const a = from < h.start ? h.start : from;
  if (a > end) return { expected: 0, done: 0 };
  let expected = 0, done = 0;
  // Percorre por semanas (segunda a domingo) para poder tratar "X dias por semana".
  let ws = weekStart(a);
  while (ws <= end) {
    const s = ws < a ? a : ws;
    const we = addDays(ws, 6);
    const e = we > end ? end : we;
    const f = cfgAt(h, s).freq;
    let d = 0, sched = 0, dd = 0;
    for (let k = s; k <= e; k = addDays(k, 1)) {
      const ok = dayDone(h, k, S);
      if (ok) d++;
      if (f.mode === 'days' && f.days.indexOf(dowOf(k)) >= 0) { sched++; if (ok) dd++; }
    }
    if (f.mode === 'days') {
      expected += sched; done += dd;
    } else {
      const span = diffDays(e, s) + 1;
      const exp = Math.min(f.perWeek, span);
      expected += exp; done += Math.min(d, exp);
    }
    ws = addDays(ws, 7);
  }
  return { expected, done };
}
export function rate(h, S, today) {
  const r = rangeStats(h, S, h.start, today, today);
  return r.expected ? Math.round(r.done / r.expected * 100) : null;
}
export function totalDone(h, S, today) {
  let n = 0;
  const end = lastDay(h) && lastDay(h) < today ? lastDay(h) : today;
  for (let k = h.start; k <= end; k = addDays(k, 1)) if (dayDone(h, k, S)) n++;
  return n;
}
export function weeklyEvolution(h, S, today, n = 8) {
  const out = [];
  const w0 = weekStart(today);
  for (let i = n - 1; i >= 0; i--) {
    const s = addDays(w0, -7 * i);
    const r = rangeStats(h, S, s, addDays(s, 6), today);
    out.push({ key: s, expected: r.expected, done: r.done, pct: r.expected ? Math.round(r.done / r.expected * 100) : null });
  }
  return out;
}
export function monthlyEvolution(h, S, today, n = 6) {
  const out = [];
  const t = parse(today);
  for (let i = n - 1; i >= 0; i--) {
    const first = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const last = new Date(t.getFullYear(), t.getMonth() - i + 1, 0);
    const r = rangeStats(h, S, ymd(first), ymd(last), today);
    out.push({ key: ymd(first), expected: r.expected, done: r.done, pct: r.expected ? Math.round(r.done / r.expected * 100) : null });
  }
  return out;
}

/* ---------- validação do formulário ---------- */
export function validateHabit(h) {
  if (!h.name || !h.name.trim()) return 'Dê um nome ao hábito.';
  if (h.freq.mode === 'days' && !h.freq.days.length) return 'Escolha pelo menos um dia da semana.';
  if (h.freq.mode === 'week' && !(h.freq.perWeek >= 1 && h.freq.perWeek <= 7)) return 'Informe de 1 a 7 dias por semana.';
  if (h.goal.value != null && !(h.goal.value > 0)) return 'A meta precisa ser maior que zero (ou deixe em branco).';
  if (h.remind.on && !/^\d{2}:\d{2}$/.test(h.remind.time || '')) return 'Escolha o horário do lembrete.';
  if (h.end.mode === 'date') {
    if (!h.end.date) return 'Escolha a data de término.';
    if (h.end.date < h.start) return 'A data de término não pode ser antes do início.';
  }
  if (h.end.mode === 'days' && !(h.end.days >= 1)) return 'Informe depois de quantos dias o hábito termina.';
  return '';
}

/* ---------- avisos: dias com lembrete nos próximos dias ---------- */
export function reminderDays(h, today, S, horizon = 7) {
  const out = [];
  if (!h.remind || !h.remind.on || !h.remind.time || h.paused) return out;
  for (let i = 0; i < horizon; i++) {
    const k = addDays(today, i);
    if (k < h.start) continue;
    const l = lastDay(h);
    if (l && k > l) break;
    if (!isScheduled(h, k, S)) continue;
    if (cfgAt(h, k).freq.mode === 'week' && weekDone(h, k, S) >= cfgAt(h, k).freq.perWeek) continue;
    if (i === 0 && dayDone(h, k, S)) continue;
    out.push(k);
  }
  return out;
}

/* ---------- Pomodoro ---------- */
export const POMO = {
  25: { short: 5, long: 15, every: 4, min: 10 },
  50: { short: 10, long: 30, every: 2, min: 20 }
};
/* Divide o tempo total de estudo em focos e pausas. O total inclui as pausas.
   A pausa longa vem a cada `every` focos. Se o que sobra depois de uma pausa for menor
   que o foco mínimo (10 min para 25, 20 min para 50), essa sobra entra no último foco. */
export function pomoPlan(total, focus) {
  const cfg = POMO[focus] || POMO[25];
  const f = POMO[focus] ? focus : 25;
  const out = [];
  let rem = Math.max(1, Math.round(total)), n = 0;
  while (rem > 0) {
    const len = Math.min(f, rem);
    n++; out.push({ t: 'f', m: len }); rem -= len;
    if (rem <= 0) break;
    const isLong = n % cfg.every === 0;
    const br = isLong ? cfg.long : cfg.short;
    if (rem - br < cfg.min) { out[out.length - 1].m += rem; rem = 0; break; }
    out.push({ t: isLong ? 'l' : 's', m: br }); rem -= br;
  }
  return out;
}

/* ---- Referência de uso saudável de telas (dormindo às 00h00) ----
   [acordar em min, saudável em min, reduzido em min, pausas curtas, pausas de 15 min]. Máximo contínuo: 60 min (limite 90). */
export const SCREEN_TABLE = [
  [300, 480, 360, '8', '4'], [330, 480, 360, '8', '4'], [360, 480, 360, '8', '4'],
  [390, 465, 345, '8', '4'], [420, 450, 330, '8', '4'], [460, 420, 300, '7', '3–4'],
  [480, 420, 300, '7', '3'], [510, 405, 285, '7', '3'], [540, 390, 270, '7', '3'],
  [570, 360, 240, '6', '3'], [600, 360, 240, '6', '3']
];
export const SCREEN_SPLIT = [
  { name: 'Saudável', work: 360, own: 60 },
  { name: 'Saudável, dia intenso', work: 420, own: 60 },
  { name: 'Reduzido', work: 270, own: 30 },
  { name: 'Reduzido, dia leve', work: 300, own: 60 }
];
export const SCREEN_RULES = [
  ['A cada 20 min de tela', 'Olhar algo distante por 20 segundos (regra 20-20-20)'],
  ['A cada 60 min de tela', 'Pausa de 5 a 10 min fora da tela'],
  ['A cada 2 h acumuladas', 'Pausa maior de 15 min'],
  ['Após 60 min contínuos', 'Ideal: levantar e fazer uma pausa'],
  ['Após 90 min contínuos', 'Limite: pausa obrigatória'],
  ['Últimas 2–3 h antes de dormir', 'Reduzir telas ao máximo; ideal, zero tela na última hora']
];
export function wakeMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : null;
}
/* Linha da tabela mais próxima do horário de acordar (5h00 a 10h00). */
export function screenRow(wake) {
  if (wake == null) return null;
  let best = SCREEN_TABLE[0];
  SCREEN_TABLE.forEach(function (r) { if (Math.abs(r[0] - wake) < Math.abs(best[0] - wake)) best = r; });
  return { wake: best[0], awake: 1440 - best[0], healthy: best[1], reduced: best[2], short: best[3], long: best[4], exact: best[0] === wake, outside: wake < 300 || wake > 600 };
}
