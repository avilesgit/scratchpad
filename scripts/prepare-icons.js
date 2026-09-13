const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'assets', 'icons');
const outputDir = path.join(root, 'build', 'icons');
const fallback = path.join(root, 'icon_256.png');

let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(iconsDir, 'icons.json'), 'utf8')); } catch (_err) {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isPng(buf) {
  return buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}
function isIco(buf) {
  return buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1;
}

function pngToIco(pngBuf) {
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(dir.length + entry.length, 12);

  return Buffer.concat([dir, entry, pngBuf]);
}

function toIco(buf) {
  if (isIco(buf)) return buf;
  if (isPng(buf)) return pngToIco(buf);
  return pngToIco(fs.readFileSync(fallback));
}

fs.mkdirSync(outputDir, { recursive: true });
for (const name of ['app', 'txt', 'md', 'bb']) {
  const configured = typeof config[name] === 'string' ? config[name] : '';
  const candidate = path.resolve(iconsDir, configured);
  const isInsideIcons = candidate.startsWith(path.resolve(iconsDir) + path.sep);
  const source = isInsideIcons && fs.existsSync(candidate) ? candidate : fallback;
  const sourceBuf = fs.readFileSync(source);

  fs.copyFileSync(source, path.join(outputDir, `${name}.png`));
  fs.writeFileSync(path.join(outputDir, `${name}.ico`), toIco(sourceBuf));
}
