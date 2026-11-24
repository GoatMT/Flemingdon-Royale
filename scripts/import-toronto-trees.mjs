import { readFile, writeFile } from 'node:fs/promises';

const [treeShapePath, streetTreeCsvPath, outputPath] = process.argv.slice(2);
if (!treeShapePath || !streetTreeCsvPath || !outputPath) {
  console.error('Usage: node scripts/import-toronto-trees.mjs <tree-points.shp> <street-tree-data.csv> <output.json>');
  process.exitCode = 2;
} else {
  const centerLon = -79.3335, centerLat = 43.7135;
  const xFactor = 111320 * Math.cos(centerLat * Math.PI / 180), zFactor = 111320;
  const project = ([lon, lat]) => [(lon - centerLon) * xFactor, (lat - centerLat) * zFactor];
  const inMap = ([x, z]) => Math.abs(x) <= 1100 && Math.abs(z) <= 1100;
  const shape = await readFile(treeShapePath);
  const dbfPath = treeShapePath.replace(/\.shp$/i, '.dbf');
  const dbf = await readFile(dbfPath);
  const dbfMeta = readDbfMeta(dbf);
  const shapeType = shape.readInt32LE(32);
  if (shapeType !== 1) throw new Error(`Expected a WGS84 point shapefile; got shape type ${shapeType}.`);

  const trees = [];
  let offset = 100, rowIndex = 0;
  while (offset + 8 <= shape.length) {
    const bytes = shape.readInt32BE(offset + 4) * 2, content = offset + 8;
    if (bytes < 20 || content + bytes > shape.length) throw new Error(`Invalid point record at byte ${offset}.`);
    const type = shape.readInt32LE(content);
    if (type === 1) {
      const [x, z] = project([shape.readDoubleLE(content + 4), shape.readDoubleLE(content + 12)]);
      if (inMap([x, z])) {
        const fields = readDbfRow(dbf, dbfMeta, rowIndex);
        const height = Number(fields.DERIVED_HE);
        trees.push({
          x: round(x), z: round(z),
          height: Number.isFinite(height) && height > 0 ? round(Math.min(56, height)) : 10,
          id: fields.OBJECTID || String(rowIndex + 1),
          species: '', commonName: '', dbh: 0,
        });
      }
    }
    offset = content + bytes;
    rowIndex++;
  }

  const inventory = [];
  const csvRowsIterator = csvRows(await readFile(streetTreeCsvPath, 'utf8'));
  const headers = csvRowsIterator.next().value || [];
  const column = name => headers.findIndex(header => header.toLowerCase() === name.toLowerCase());
  const geometryAt = column('geometry'), speciesAt = column('BOTANICAL_NAME'), commonAt = column('COMMON_NAME'), dbhAt = column('DBH_TRUNK');
  for (const row of csvRowsIterator) {
    let geometry;
    try { geometry = JSON.parse(row[geometryAt]); } catch { continue; }
    const point = firstPoint(geometry);
    if (!point) continue;
    const [x, z] = project(point);
    if (!inMap([x, z])) continue;
    inventory.push({ x, z, species: clean(row[speciesAt]), commonName: clean(row[commonAt]), dbh: Number(row[dbhAt]) || 0 });
  }

  const cellSize = 12, treeGrid = new Map(), candidates = [];
  trees.forEach((tree, index) => {
    const key = cellKey(tree.x, tree.z, cellSize);
    const list = treeGrid.get(key) || [];
    list.push(index);
    treeGrid.set(key, list);
  });
  for (const record of inventory) {
    const cx = Math.floor(record.x / cellSize), cz = Math.floor(record.z / cellSize);
    let bestIndex = -1, bestDistance = 5.01;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (const index of treeGrid.get(`${gx},${gz}`) || []) {
        const tree = trees[index], gap = Math.hypot(record.x - tree.x, record.z - tree.z);
        if (gap < bestDistance) { bestDistance = gap; bestIndex = index; }
      }
    }
    if (bestIndex >= 0) candidates.push({ index: bestIndex, gap: bestDistance, record });
  }

  const usedTrees = new Set(), usedInventory = new Set();
  candidates.sort((a, b) => a.gap - b.gap);
  for (const candidate of candidates) {
    if (candidate.gap > 5 || usedTrees.has(candidate.index) || usedInventory.has(candidate.record)) continue;
    const tree = trees[candidate.index];
    tree.species = candidate.record.species;
    tree.commonName = candidate.record.commonName;
    tree.dbh = candidate.record.dbh;
    tree.form = visualForm(tree.species, tree.commonName);
    usedTrees.add(candidate.index);
    usedInventory.add(candidate.record);
  }

  const output = {
    source: {
      locations: 'City of Toronto, Topographic Mapping - Physical Location of Trees, WGS84',
      heights: 'City of Toronto, Topographic Mapping - Physical Location of Trees, DERIVED_HE',
      species: 'City of Toronto, Street Tree Data, matched to tree points within 5 metres',
      license: 'Open Government Licence - Toronto',
      caveat: 'Tree points provide location and derived height, not species. Street-tree species are attached only when a City inventory point is within 5 metres; unmapped tree points use generic visual canopy variants.',
    },
    map: { centerLat, centerLon, widthMeters: 2200, depthMeters: 2200 },
    trees,
  };
  await writeFile(outputPath, JSON.stringify(output));
  const forms = trees.reduce((result, tree) => { const form = tree.form || 'mixed-canopy'; result[form] = (result[form] || 0) + 1; return result; }, {});
  console.log(`Wrote ${trees.length.toLocaleString()} mapped trees; matched ${usedTrees.size.toLocaleString()} inventoried species points within 5 m.`);
  console.log(`Tree visual forms: ${JSON.stringify(forms)}`);
}

function readDbfMeta(buffer) {
  const records = buffer.readUInt32LE(4), headerLength = buffer.readUInt16LE(8), recordLength = buffer.readUInt16LE(10), fields = [];
  for (let offset = 32; offset < headerLength && buffer[offset] !== 0x0d; offset += 32) {
    const end = buffer.indexOf(0, offset), nameEnd = end >= offset && end < offset + 11 ? end : offset + 11;
    fields.push({ name: buffer.toString('ascii', offset, nameEnd), length: buffer[offset + 16] });
  }
  return { records, headerLength, recordLength, fields };
}
function readDbfRow(buffer, meta, index) {
  if (index >= meta.records) return {};
  let cursor = meta.headerLength + index * meta.recordLength + 1;
  const decoder = new TextDecoder('windows-1252'), result = {};
  for (const field of meta.fields) {
    result[field.name] = decoder.decode(buffer.subarray(cursor, cursor + field.length)).trim();
    cursor += field.length;
  }
  return result;
}
function* csvRows(text) {
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); yield row; row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); yield row; }
}
function firstPoint(geometry) {
  if (geometry?.type === 'Point') return geometry.coordinates;
  if (geometry?.type === 'MultiPoint') return geometry.coordinates?.[0] || null;
  return null;
}
function visualForm(species, commonName) {
  const text = `${species} ${commonName}`.toLowerCase();
  if (/picea|abies|pinus|cedrus|thuja|juniper|spruce|pine|cedar|fir|yew/.test(text)) return 'evergreen';
  if (/betula|birch/.test(text)) return 'birch';
  if (/acer|maple/.test(text)) return 'maple';
  if (/quercus|oak/.test(text)) return 'oak';
  if (/tilia|linden|basswood/.test(text)) return 'linden';
  if (/ginkgo/.test(text)) return 'ginkgo';
  if (/ulmus|elm|fraxinus|ash|carpinus|hornbeam/.test(text)) return 'upright';
  return 'broadleaf';
}
function cellKey(x, z, size) { return `${Math.floor(x / size)},${Math.floor(z / size)}`; }
function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function round(value) { return Math.round(value * 100) / 100; }
