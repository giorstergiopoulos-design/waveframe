const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');
const path = require('path');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const svgPath = path.join(__dirname, 'icon.svg');

async function main() {
  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await sharp(svgPath).resize(size, size).png().toBuffer();
    pngBuffers.push(buf);
    if (size === 256) {
      fs.writeFileSync(path.join(__dirname, 'icon.png'), buf);
    }
  }
  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), icoBuffer);
  console.log('icon.ico written');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
