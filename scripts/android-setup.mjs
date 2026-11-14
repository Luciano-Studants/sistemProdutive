// Ajusta o projeto Android gerado pelo Capacitor antes do build no GitHub Actions.
// - versionCode sobe a cada execução, para o celular aceitar a atualização por cima.
// - ícone do app e ícone das notificações vêm de android-res/.
import { readFileSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';

const run = Number(process.env.RUN_NUMBER || '1');
const file = 'android/app/build.gradle';
let g = readFileSync(file, 'utf8');

if (!/versionCode \d+/.test(g)) throw new Error('versionCode não encontrado em ' + file);
g = g.replace(/versionCode \d+/, `versionCode ${run}`);
g = g.replace(/versionName "[^"]*"/, `versionName "1.0.${run}"`);
writeFileSync(file, g);
console.log(`Android: versionCode ${run}, versionName 1.0.${run}`);

const res = 'android/app/src/main/res';
cpSync('android-res', res, { recursive: true });
// Sem o ícone adaptativo do modelo, o Android usa os PNGs copiados acima.
for (const f of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
  const p = `${res}/${f}`;
  if (existsSync(p)) rmSync(p);
}
console.log('Android: ícones aplicados');
