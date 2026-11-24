import { readFile, writeFile } from 'node:fs/promises';

const SCHOOL_DROPS = new Map([
  ['GRENOBLE PUBLIC SCHOOL', 'grenoble-school'],
  ['GATEWAY PUBLIC SCHOOL', 'gateway-school'],
  ['MARC GARNEAU COLLEGIATE INSTITUTE', 'marc-garneau'],
]);
const FACILITY_DROPS = new Map([
  ['FLEMINGDON PARK', 'flemingdon-park'],
  ['FLEMINGDON COMMUNITY CENTRE AND PLAYGROUND PARADISE', 'community-centre'],
  ['E.T. SETON PARK', 'et-seton-park'],
  ['CHARLES SAURIOL CONSERVATION AREA', 'charles-sauriol'],
]);
const LABEL_FACILITIES = new Set([
  'FLEMINGDON PARK',
  'FLEMINGDON COMMUNITY CENTRE AND PLAYGROUND PARADISE',
  'ANGELA JAMES ARENA',
  'E.T. SETON PARK',
  'CHARLES SAURIOL CONSERVATION AREA',
]);

const [schoolPath, libraryPath, recreationPath, outputPath] = process.argv.slice(2);
if (!schoolPath || !libraryPath || !recreationPath || !outputPath) {
  console.error('Usage: node scripts/import-toronto-landmarks.mjs <schools.geojson> <libraries.geojson> <recreation.csv> <output.json>');
  process.exitCode = 2;
} else {
  const centerLon = -79.3335, centerLat = 43.7135;
  const xFactor = 111320 * Math.cos(centerLat * Math.PI / 180), zFactor = 111320;
  const project = ([lon, lat]) => [(lon - centerLon) * xFactor, (lat - centerLat) * zFactor];
  const insideMap = ([x, z]) => Math.abs(x) <= 1100 && Math.abs(z) <= 1100;
  const landmarks = [];

  const schools = JSON.parse(await readFile(schoolPath, 'utf8'));
  for (const feature of schools.features || []) {
    const properties = feature.properties || {};
    const point = firstPoint(feature.geometry);
    if (!point) continue;
    const [x, z] = project(point);
    if (!insideMap([x, z])) continue;
    const name = clean(properties.NAME);
    landmarks.push({
      name,
      address: clean(properties.ADDRESS_FULL || properties.SOURCE_ADDRESS),
      kind: 'school',
      x: round(x), z: round(z),
      label: true,
      dropId: SCHOOL_DROPS.get(name.toUpperCase()) || null,
    });
  }

  const libraries = JSON.parse(await readFile(libraryPath, 'utf8'));
  for (const feature of libraries.features || []) {
    const properties = feature.properties || {};
    const name = clean(properties.BranchName);
    if (!/flemingdon park/i.test(name)) continue;
    const point = firstPoint(feature.geometry);
    if (!point) continue;
    const [x, z] = project(point);
    if (!insideMap([x, z])) continue;
    landmarks.push({ name: `${name} Library`, address: clean(properties.Address), kind: 'library', x: round(x), z: round(z), label: true, dropId: 'flemingdon-library' });
  }

  const csv = csvRows(await readFile(recreationPath, 'utf8'));
  const headers = csv.next().value || [];
  const column = name => headers.findIndex(header => header.toLowerCase() === name.toLowerCase());
  const nameAt = column('ASSET_NAME'), typeAt = column('TYPE'), addressAt = column('ADDRESS'), geometryAt = column('geometry');
  for (const row of csv) {
    let geometry;
    try { geometry = JSON.parse(row[geometryAt]); } catch { continue; }
    const point = firstPoint(geometry);
    if (!point) continue;
    const [x, z] = project(point);
    if (!insideMap([x, z])) continue;
    const name = clean(row[nameAt]);
    const kind = clean(row[typeAt]).toLowerCase().replace(/\s+/g, '-') || 'facility';
    landmarks.push({
      name, address: clean(row[addressAt]), kind, x: round(x), z: round(z),
      label: LABEL_FACILITIES.has(name.toUpperCase()),
      dropId: FACILITY_DROPS.get(name.toUpperCase()) || null,
    });
  }

  landmarks.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const output = {
    source: {
      schools: 'City of Toronto, School Locations - All Types, WGS84',
      libraries: 'Toronto Public Library, Library Branch General Information, WGS84',
      recreation: 'City of Toronto, Parks and Recreation Facilities, WGS84',
      license: 'Open Government Licence - Toronto',
    },
    map: { centerLat, centerLon, widthMeters: 2200, depthMeters: 2200 },
    landmarks,
  };
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Wrote ${landmarks.length} sourced neighborhood landmarks to ${outputPath}`);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function round(value) { return Math.round(value * 10) / 10; }
function firstPoint(geometry) {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  if (geometry.type === 'Point') return coordinates;
  if (geometry.type === 'MultiPoint') return coordinates[0] || null;
  return null;
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
