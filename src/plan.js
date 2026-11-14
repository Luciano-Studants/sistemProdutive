// Lógica pura dos avisos: quando cada notificação deve sair.
// Sem acesso a tela, rede ou armazenamento, para poder ser testada isolada.

export const LEAD = 4; // dias de antecedência

export const ROUTINE = [
  { id: 101, h: 18, m: 0, t: 'Hora de planejar', b: 'Escolha a tarefa principal de hoje.' },
  { id: 102, h: 18, m: 30, t: 'Bloco de foco', b: 'Celular longe e uma tarefa só por duas horas.' },
  { id: 103, h: 21, m: 0, t: 'Segundo bloco', b: 'Estudo ou projeto. Pausa de 10 minutos a cada 50.' },
  { id: 104, h: 22, m: 30, t: 'Fechamento do dia', b: 'Marque o que fez e escreva a primeira ação de amanhã.' },
  { id: 105, h: 23, m: 0, t: 'Hora de desacelerar', b: 'Sem telas estimulantes. Durma cedo.' }
];

export const KIND_LABEL = { dl: 'Entrega', step: 'Etapa', ev: 'Compromisso', task: 'Tarefa' };

const pad = (n) => String(n).padStart(2, '0');
const TIME_RE = /^\d{2}:\d{2}$/;

export function parseKey(k) {
  const p = k.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
export function diffDays(a, b) {
  return Math.round((parseKey(a) - parseKey(b)) / 86400000);
}
function at(key, offsetDays, h, m) {
  const d = parseKey(key);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(h, m, 0, 0);
  return d;
}
function hm(t) {
  const p = t.split(':').map(Number);
  return [p[0], p[1]];
}

/* Texto do prazo: "atrasada 2 dias", "hoje às 15:30", "em 3 dias · 18/11". */
export function fmtDue(n, time, dateKey) {
  const tail = time ? ' às ' + time : '';
  if (n < 0) return (n === -1 ? 'atrasada 1 dia' : 'atrasada ' + -n + ' dias');
  if (n === 0) return 'hoje' + tail;
  if (n === 1) return 'amanhã' + tail;
  const p = dateKey.split('-');
  return 'em ' + n + ' dias · ' + p[2] + '/' + p[1] + tail;
}

/*
 item: { kind, title, sub, date:'AAAA-MM-DD', time:'HH:MM'|'', overdue:boolean }
 Devolve a lista de avisos { at:Date, title, body } desse item.

 Entregas, etapas e compromissos:
   4 a 1 dia antes: 08:00 e 18:00
   no dia: sem horário -> 08:00, 12:00, 18:00 e 21:00
           com horário -> 08:00, 1 hora antes e na hora
   atrasadas (entregas e etapas): 08:00 e 18:00 por 3 dias
 Tarefas com horário: 10 minutos antes e na hora.
*/
export function planItem(it) {
  const out = [];
  const label = KIND_LABEL[it.kind] || 'Aviso';
  const body = (it.sub ? it.sub + ': ' : '') + it.title;
  const hasTime = TIME_RE.test(it.time || '');
  const tail = hasTime ? ' às ' + it.time : '';

  if (it.kind === 'task') {
    if (!hasTime) return out;
    const [h, m] = hm(it.time);
    const t = at(it.date, 0, h, m);
    const before = new Date(t.getTime() - 10 * 60000);
    out.push({ at: before, title: 'Tarefa em 10 minutos', body: it.title });
    out.push({ at: t, title: 'Hora da tarefa', body: it.title });
    return out;
  }

  for (let n = LEAD; n >= 1; n--) {
    const when = n === 1 ? 'amanhã' : 'em ' + n + ' dias';
    out.push({ at: at(it.date, -n, 8, 0), title: label + ' ' + when + tail, body });
    out.push({ at: at(it.date, -n, 18, 0), title: label + ' ' + when + tail, body });
  }

  if (hasTime) {
    const [h, m] = hm(it.time);
    const t = at(it.date, 0, h, m);
    const morning = at(it.date, 0, 8, 0);
    const before = new Date(t.getTime() - 60 * 60000);
    if (morning < before) out.push({ at: morning, title: label + ' hoje' + tail, body });
    out.push({ at: before, title: label + ' em 1 hora' + tail, body });
    out.push({ at: t, title: label + ' agora', body });
  } else {
    [[8, 0], [12, 0], [18, 0], [21, 0]].forEach(([h, m]) =>
      out.push({ at: at(it.date, 0, h, m), title: label + ' hoje', body }));
  }

  if (it.overdue) {
    for (let n = 1; n <= 3; n++) {
      const since = n === 1 ? 'venceu ontem' : 'venceu há ' + n + ' dias';
      out.push({ at: at(it.date, n, 8, 0), title: label + ' atrasada (' + since + ')', body });
      out.push({ at: at(it.date, n, 18, 0), title: label + ' atrasada (' + since + ')', body });
    }
  }
  return out;
}

/* Próximos avisos a partir de `now`, em ordem, limitados a `cap` (o Android aceita
   poucas centenas de alarmes por app). */
export function buildPlan(items, now, cap) {
  const list = [];
  items.forEach((it) => planItem(it).forEach((p) => { if (p.at > now) list.push(p); }));
  list.sort((a, b) => a.at - b.at);
  return list.slice(0, cap);
}

/* Avisos que deveriam ter saído nos últimos `windowMs` (usado pela web, que verifica
   a cada poucos segundos), incluindo os lembretes fixos da rotina. */
export function dueNow(items, now, windowMs) {
  const from = now.getTime() - windowMs;
  const out = [];
  items.forEach((it) => planItem(it).forEach((p) => {
    const t = p.at.getTime();
    if (t > from && t <= now.getTime()) out.push(p);
  }));
  ROUTINE.forEach((r) => {
    const d = new Date(now);
    d.setHours(r.h, r.m, 0, 0);
    const t = d.getTime();
    if (t > from && t <= now.getTime()) out.push({ at: d, title: r.t, body: r.b });
  });
  return out;
}

/* Itens do popup ao abrir: atrasados e os que vencem em até LEAD dias. */
export function alertItems(items, today) {
  const out = [];
  items.forEach((it) => {
    if (it.kind === 'task') return;
    const n = diffDays(it.date, today);
    if (n < 0 && !it.overdue) return;
    if (n > LEAD) return;
    out.push(Object.assign({}, it, { n }));
  });
  out.sort((a, b) => a.n - b.n || (a.time || '').localeCompare(b.time || ''));
  return out;
}
