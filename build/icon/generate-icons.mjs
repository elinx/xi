/**
 * Generate app icons from SVG for all platforms.
 * Usage: node build/icon/generate-icons.mjs
 */
import sharp from 'sharp'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconDir = __dirname
const svgPath = join(iconDir, 'icon.svg')
const svgBuffer = readFileSync(svgPath)

// PNG sizes needed for Electron + various platforms
const pngSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]

async function generatePngs() {
  for (const size of pngSizes) {
    const outPath = join(iconDir, `${size}.png`)
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath)
    console.log(`  ✓ ${size}x${size} → ${outPath}`)
  }
}

async function generateIco() {
  // ICO: 16, 32, 48, 256 bundled
  const icoSizes = [16, 32, 48, 256]
  const pngBuffers = []
  for (const size of icoSizes) {
    const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer()
    pngBuffers.push({ size, buf })
  }

  // ICO file format
  const headerSize = 6
  const entrySize = 16
  const numImages = pngBuffers.length
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)    // reserved
  header.writeUInt16LE(1, 2)    // type: icon
  header.writeUInt16LE(numImages, 4)

  const entries = []
  let offset = headerSize + entrySize * numImages
  for (const { size, buf } of pngBuffers) {
    const entry = Buffer.alloc(entrySize)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)  // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)  // height
    entry.writeUInt8(0, 2)          // color palette
    entry.writeUInt8(0, 3)          // reserved
    entry.writeUInt16LE(1, 4)       // color planes
    entry.writeUInt16LE(32, 6)      // bits per pixel
    entry.writeUInt32LE(buf.length, 8)  // image size
    entry.writeUInt32LE(offset, 12)     // offset
    entries.push(entry)
    offset += buf.length
  }

  const ico = Buffer.concat([header, ...entries, ...pngBuffers.map(p => p.buf)])
  const icoPath = join(iconDir, 'icon.ico')
  const { writeFileSync } = await import('fs')
  writeFileSync(icoPath, ico)
  console.log(`  ✓ icon.ico → ${icoPath}`)
}

async function generateIcns() {
  // macOS icns via iconutil: create iconset dir, then convert
  const iconsetDir = join(iconDir, 'icon.iconset')
  if (!existsSync(iconsetDir)) mkdirSync(iconsetDir, { recursive: true })

  const mappings = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ]

  for (const { size, name } of mappings) {
    const outPath = join(iconsetDir, name)
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath)
  }

  // Use iconutil to create icns
  const { execSync } = await import('child_process')
  const icnsPath = join(iconDir, 'icon.icns')
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`)
    console.log(`  ✓ icon.icns → ${icnsPath}`)
  } catch (err) {
    console.warn('  ⚠ iconutil failed (macOS only), skipping .icns generation')
  }
}

async function main() {
  console.log('Generating Xi app icons from SVG...\n')

  console.log('PNG files:')
  await generatePngs()

  console.log('\nWindows ICO:')
  await generateIco()

  console.log('\nmacOS ICNS:')
  await generateIcns()

  console.log('\n✅ Done! Icons generated in build/icon/')
}

main().catch(console.error)
