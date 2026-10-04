// Gera um vídeo .y4m com um código de barras EAN-13 para a câmera falsa do Chrome
// (--use-fake-device-for-media-stream --use-file-for-fake-video-capture=arquivo.y4m). Uso nos testes do leitor.
import fs from 'node:fs';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Bits(code) {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 precisa de 13 dígitos');
  const d = [...code].map(Number); const par = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

/** escreve o .y4m (640x480, alguns quadros iguais; o Chrome repete em loop) */
export function writeEan13Y4m(code, file, { w = 640, h = 480, module = 4, frames = 8 } = {}) {
  const bits = ean13Bits(code);
  const Y = Buffer.alloc(w * h, 235);
  const bw = bits.length * module; const x0 = Math.round((w - bw) / 2); const y0 = Math.round(h * 0.25); const y1 = Math.round(h * 0.75);
  for (let y = y0; y < y1; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') Y.fill(16, y * w + x0 + i * module, y * w + x0 + (i + 1) * module);
  const UV = Buffer.alloc((w / 2) * (h / 2), 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < frames; f++) parts.push(Buffer.from('FRAME\n'), Y, UV, UV);
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

if (process.argv[1] && process.argv[1].endsWith('barcode-video.mjs')) {
  const [code = '7891000004012', file = '/tmp/ean.y4m'] = process.argv.slice(2);
  console.log(writeEan13Y4m(code, file));
}
