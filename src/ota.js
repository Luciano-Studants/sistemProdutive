// Atualização do código do app dentro do APK, sem reinstalar.
// O site publicado no GitHub Pages guarda update/version.json e update/bundle.zip.
// O app compara o número da versão, baixa só o pacote novo (poucas centenas de KB)
// e o plugin o aplica quando o app for para segundo plano ou for reaberto.
// Se o pacote novo não abrir, o plugin volta sozinho para a versão anterior
// (notifyAppReady é chamado assim que o app inicia sem erro).
import { CapacitorUpdater } from '@capgo/capacitor-updater';

export const BUILD = Number(import.meta.env.VITE_BUILD || 0);
const BASE = (import.meta.env.VITE_UPDATE_URL || '').replace(/\/?$/, '/');

export function otaEnabled() {
  return !!import.meta.env.VITE_UPDATE_URL && BUILD > 0;
}

/* Compara a versão do pacote em uso com a do servidor. Funções puras ficam fora do plugin
   para poderem ser testadas. */
export function decide(remote, localBuild, nativeApi) {
  if (!remote || typeof remote.version !== 'number' || !remote.zip || !/^[0-9a-f]{64}$/.test(remote.checksum || '')) return { act: 'none', why: 'invalid' };
  if (remote.version <= localBuild) return { act: 'none', why: 'current' };
  if ((remote.nativeApi || 1) > nativeApi) return { act: 'reinstall', why: 'native' };
  return { act: 'download' };
}

export async function markReady() {
  try { await CapacitorUpdater.notifyAppReady(); } catch (e) { /* plugin ausente: ignora */ }
}

/* Versão em uso: a do pacote baixado (se houver) ou a embutida no APK. */
export async function currentBuild() {
  try {
    const cur = await CapacitorUpdater.current();
    const v = cur && cur.bundle && cur.bundle.version;
    const n = Number(v);
    const native = String((cur && cur.native) || '1').split('.')[0];
    return { build: cur.bundle.id === 'builtin' || !n ? BUILD : n, nativeApi: Number(native) || 1 };
  } catch (e) {
    return { build: BUILD, nativeApi: 1 };
  }
}

let pending = null; // pacote baixado e pronto para aplicar

export function pendingUpdate() { return pending; }

/* Retorna { state: 'current'|'ready'|'reinstall'|'error', version?, step?, why? }
   step diz onde falhou: 'check' (consultar o servidor) ou 'download' (baixar o pacote). */
export async function checkUpdate() {
  if (!otaEnabled()) return { state: 'error', step: 'check', why: 'atualizações desligadas neste build' };
  if (pending) return { state: 'ready', version: pending.version };
  const msg = (e) => String((e && e.message) || e).slice(0, 140);
  let remote;
  try {
    const r = await fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('servidor respondeu ' + r.status);
    remote = await r.json();
  } catch (e) {
    return { state: 'error', step: 'check', why: msg(e) };
  }
  try {
    const cur = await currentBuild();
    const d = decide(remote, cur.build, cur.nativeApi);
    if (d.why === 'invalid') return { state: 'error', step: 'check', why: 'arquivo de versão incompleto no servidor' };
    if (d.act === 'reinstall') return { state: 'reinstall', version: remote.version };
    if (d.act !== 'download') return { state: 'current', version: cur.build };
    // O plugin exige o SHA-256 do zip e confere antes de aceitar o pacote.
    const b = await CapacitorUpdater.download({ url: BASE + remote.zip, version: String(remote.version), checksum: remote.checksum });
    await CapacitorUpdater.next({ id: b.id });
    pending = { id: b.id, version: remote.version };
    return { state: 'ready', version: remote.version };
  } catch (e) {
    return { state: 'error', step: 'download', why: msg(e) };
  }
}

/* Reinicia o app já com o pacote novo. */
export async function applyNow() {
  if (!pending) return;
  await CapacitorUpdater.set({ id: pending.id });
}
