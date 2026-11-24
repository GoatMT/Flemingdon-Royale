import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const inspectOnly = args.includes('--inspect');
const positional = args.filter(value => value !== '--inspect');
const shpPath = positional[0];
const outputPath = positional[1];

if (!shpPath || (!inspectOnly && !outputPath)) {
  console.error('Usage: node scripts/import-toronto-buildings.mjs <file.shp> [output.json] [--inspect]');
  process.exitCode = 2;
} else {
  const shp = await readFile(shpPath);
  const stem = basename(shpPath).replace(/\.shp$/i, '');
  const dbfPath = join(dirname(shpPath), `${stem}.dbf`);
  const dbf = await readFile(dbfPath);
  const meta = readDbfMeta(dbf);
  const geometryType = shp.readInt32LE(32);
  const fileBounds = Array.from({ length: 4 }, (_, i) => shp.readDoubleLE(36 + i * 8));
  const radians = 43.7135 * Math.PI / 180;
  const mercatorRadius = 6378137;
  const centerLon = -79.3335;
  const centerLat = 43.7135;
  const halfWidth = 1100;
  const halfDepth = 1100;
  const groundScale = Math.cos(radians);
  const centerX = mercatorRadius * centerLon * Math.PI / 180;
  const centerY = mercatorRadius * Math.log(Math.tan(Math.PI / 4 + radians / 2));
  const clip = {
    west: centerX - halfWidth / groundScale,
    east: centerX + halfWidth / groundScale,
    south: centerY - halfDepth / groundScale,
    north: centerY + halfDepth / groundScale,
    crs: 'EPSG:3857',
  };
  const summary = {
    file: basename(shpPath),
    shapeType: geometryType,
    shapeBounds: fileBounds,
    records: meta.records,
    fields: meta.fields.map(field => ({ name: field.name, type: field.type, length: field.length, decimals: field.decimals })),
    mapClip: clip,
  };

  if (geometryType !== 5 && geometryType !== 15) {
    throw new Error(`Expected Polygon or PolygonZ shapefile; got shape type ${geometryType}.`);
  }

  const features = [];
  let firstLocal = null;
  let offset = 100;
  let recordIndex = 0;
  while (offset + 8 <= shp.length) {
    const bytes = shp.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    if (bytes < 4 || content + bytes > shp.length) throw new Error(`Invalid shape record at byte ${offset}.`);
    const type = shp.readInt32LE(content);
    if (type === 5 || type === 15) {
      const west = shp.readDoubleLE(content + 4);
      const south = shp.readDoubleLE(content + 12);
      const east = shp.readDoubleLE(content + 20);
      const north = shp.readDoubleLE(content + 28);
      if (east >= clip.west && west <= clip.east && north >= clip.south && south <= clip.north) {
        if (!firstLocal) firstLocal = readProperties(dbf, meta, recordIndex);
        if (!inspectOnly) features.push(readFeature(shp, dbf, meta, content, bytes, recordIndex, type, groundScale, centerX, centerY));
        summary.clippedFeatureCount = (summary.clippedFeatureCount || 0) + 1;
      }
    }
    offset = content + bytes;
    recordIndex++;
  }
  summary.dbfSampleInsideClip = firstLocal;
  if (inspectOnly) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const output = {
      source: 'City of Toronto, 3D Massing 2025, Open Government Licence - Toronto',
      sourceUrl: 'https://open.toronto.ca/dataset/3d-massing/',
      map: { centerLat, centerLon, widthMeters: halfWidth * 2, depthMeters: halfDepth * 2 },
      disclaimer: 'The City provides context massing for illustrative use and disclaims completeness and accuracy; building extents and heights may be incomplete or inaccurate.',
      features: features.filter(feature => feature.parts.length && feature.height > 0),
    };
    await writeFile(outputPath, JSON.stringify(output));
    console.log(`Wrote ${output.features.length.toLocaleString()} buildings to ${outputPath}`);
    console.log(`Selected ${output.features.length.toLocaleString()} of ${summary.records.toLocaleString()} citywide records.`);
  }
}

function readDbfMeta(buffer) {
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; offset < headerLength && buffer[offset] !== 0x0d; offset += 32) {
    const end = buffer.indexOf(0, offset);
    const nameEnd = end >= offset && end < offset + 11 ? end : offset + 11;
    fields.push({
      name: buffer.toString('ascii', offset, nameEnd),
      type: String.fromCharCode(buffer[offset + 11]),
      length: buffer[offset + 16],
      decimals: buffer[offset + 17],
    });
  }
  return { records, headerLength, recordLength, fields };
}

function readProperties(buffer, meta, index) {
  const base = meta.headerLength + index * meta.recordLength;
  const properties = {};
  let cursor = base + 1;
  const decoder = new TextDecoder('windows-1252');
  for (const field of meta.fields) {
    const raw = decoder.decode(buffer.subarray(cursor, cursor + field.length)).trim();
    properties[field.name] = field.type === 'N' || field.type === 'F' ? (raw === '' ? null : Number(raw)) : raw;
    cursor += field.length;
  }
  return properties;
}

function readFeature(shp, dbf, meta, content, bytes, index, fileType, groundScale, centerX, centerY) {
  const partsCount = shp.readInt32LE(content + 36);
  const pointsCount = shp.readInt32LE(content + 40);
  const partOffset = content + 44;
  const pointOffset = partOffset + partsCount * 4;
  const points = [];
  let zMin = null;
  let zMax = null;
  for (let i = 0; i < pointsCount; i++) {
    const x = shp.readDoubleLE(pointOffset + i * 16);
    const y = shp.readDoubleLE(pointOffset + i * 16 + 8);
    points.push([x, y]);
  }
  if (fileType === 15) {
    const zRangeOffset = pointOffset + pointsCount * 16;
    if (zRangeOffset + 16 <= content + bytes) {
      zMin = shp.readDoubleLE(zRangeOffset);
      zMax = shp.readDoubleLE(zRangeOffset + 8);
    }
  }
  const cuts = Array.from({ length: partsCount }, (_, i) => shp.readInt32LE(partOffset + i * 4));
  cuts.push(pointsCount);
  const rings = [];
  for (let i = 0; i < partsCount; i++) {
    const ring = points.slice(cuts[i], cuts[i + 1]).map(([x, y]) => [
      round((x - centerX) * groundScale),
      round((y - centerY) * groundScale),
    ]);
    if (ring.length >= 4) rings.push(ring);
  }
  const props = readProperties(dbf, meta, index);
  const height = findHeight(props, zMin, zMax);
  const id = props.OBJECTID ?? props.BLDG_ID ?? props.BUILDING_ID ?? index + 1;
  return { id, height: round(height), parts: rings };
}

function findHeight(properties, zMin, zMax) {
  const average = Number(properties.AVG_HEIGHT);
  if (Number.isFinite(average) && average > 2 && average < 400) return average;
  const minimum = Number(properties.MIN_HEIGHT), maximum = Number(properties.MAX_HEIGHT);
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && maximum - minimum > 2 && maximum - minimum < 400) return maximum - minimum;
  for (const key of ['AVG_HEIGHT', 'MAX_HEIGHT', 'HEIGHT']) {
    const value = Number(properties[key]);
    if (Number.isFinite(value) && value > 2 && value < 400) return value;
  }
  if (Number.isFinite(zMin) && Number.isFinite(zMax) && zMax - zMin > 2 && zMax - zMin < 400) return zMax - zMin;
  return 10;
}

function round(value) { return Math.round(value * 10) / 10; }
