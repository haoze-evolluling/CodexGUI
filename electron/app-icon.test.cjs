const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const ICO_PATH = path.join(__dirname, 'assets', 'app-icon.ico');
const EXPECTED_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

function parseIco(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, 'reserved must be 0');
  assert.equal(buffer.readUInt16LE(2), 1, 'type must be 1 (icon)');
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    entries.push({
      width: buffer.readUInt8(base) || 256,
      height: buffer.readUInt8(base + 1) || 256,
      planes: buffer.readUInt16LE(base + 4),
      bitCount: buffer.readUInt16LE(base + 6),
      bytesInRes: buffer.readUInt32LE(base + 8),
      imageOffset: buffer.readUInt32LE(base + 12),
    });
  }
  return { count, entries };
}

function parsePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buffer.subarray(0, 8).equals(signature), 'PNG signature');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const idat = [];
  let offset = 8;
  let foundIend = false;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    if (type === 'IDAT') idat.push(buffer.subarray(dataStart, dataStart + length));
    if (type === 'IEND') foundIend = true;
    offset = dataStart + length + 4;
  }
  assert.ok(foundIend, 'IEND chunk present');
  return { width, height, bitDepth, colorType, idat };
}

test('app icon ICO exists and contains all expected sizes', () => {
  assert.ok(fs.existsSync(ICO_PATH), `missing ${ICO_PATH}`);
  const buffer = fs.readFileSync(ICO_PATH);
  const { count, entries } = parseIco(buffer);
  assert.equal(count, EXPECTED_SIZES.length, 'entry count');
  assert.deepEqual(entries.map(e => e.width), EXPECTED_SIZES, 'entry sizes');
  assert.ok(entries.every(e => e.width === e.height), 'entries are square');
  for (const entry of entries) {
    assert.equal(entry.planes, 1, 'planes');
    assert.equal(entry.bitCount, 32, 'bit count');
    assert.ok(entry.bytesInRes > 0, 'has image data');
    assert.ok(entry.imageOffset + entry.bytesInRes <= buffer.length, 'data within file');
  }
});

test('each ICO entry decodes to the declared dimensions', () => {
  const buffer = fs.readFileSync(ICO_PATH);
  const { entries } = parseIco(buffer);
  for (const entry of entries) {
    const data = buffer.subarray(entry.imageOffset, entry.imageOffset + entry.bytesInRes);
    if (entry.width === 256) {
      const png = parsePng(data);
      assert.equal(png.width, 256, 'PNG width');
      assert.equal(png.height, 256, 'PNG height');
      assert.equal(png.bitDepth, 8, 'PNG bit depth');
      assert.equal(png.colorType, 6, 'PNG color type RGBA');
      const inflated = zlib.inflateSync(Buffer.concat(png.idat));
      assert.equal(inflated.length, (1 + png.width * 4) * png.height, 'PNG pixel data size');
    } else {
      const size = entry.width;
      assert.equal(data.readUInt32LE(0), 40, 'BITMAPINFOHEADER size');
      assert.equal(data.readInt32LE(4), size, 'biWidth');
      assert.equal(data.readInt32LE(8), size * 2, 'biHeight includes AND mask');
      assert.equal(data.readUInt16LE(12), 1, 'biPlanes');
      assert.equal(data.readUInt16LE(14), 32, 'biBitCount');
      assert.equal(data.readUInt32LE(16), 0, 'biCompression BI_RGB');
      const andStride = Math.ceil(size / 32) * 4;
      assert.equal(data.length, 40 + size * size * 4 + andStride * size, 'BMP data length');
      let hasVisiblePixels = false;
      for (let i = 40; i < 40 + size * size * 4; i += 4) {
        if (data[i + 3] !== 0) {
          hasVisiblePixels = true;
          break;
        }
      }
      assert.ok(hasVisiblePixels, `BMP entry ${size}px contains visible pixels`);
    }
  }
});

test('source PNG is retained and electron-builder references the ICO', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'codex-color.png')), 'source PNG kept at repo root');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.build.appId, 'com.leeha.codexgui');
  assert.equal(pkg.build.win.icon, 'electron/assets/app-icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'electron/assets/app-icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'electron/assets/app-icon.ico');
  assert.equal(pkg.build.nsis.installerHeaderIcon, 'electron/assets/app-icon.ico');
  assert.ok(pkg.build.files.includes('electron/**/*'), 'electron assets are packaged');
});

test('main process wires AUMID and window icon', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.match(main, /const APP_ID = 'com\.leeha\.codexgui';/);
  assert.match(main, /app\.setAppUserModelId\(APP_ID\);/);
  assert.match(main, /icon: APP_ICON/);
});
