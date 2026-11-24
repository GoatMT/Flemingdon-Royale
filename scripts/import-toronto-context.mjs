import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const [roadPath, parkPath, outputPath] = args.filter(value => !value.startsWith('--'));
if (!roadPath || !parkPath || (!inspect && !outputPath)) {
  console.error('Usage: node scripts/import-toronto-context.mjs <centreline.csv> <green-spaces.geojson> [output.json] [--inspect]');
  process.exitCode = 2;
} else {
  const centerLon = -79.3335, centerLat = 43.7135, width = 2200, depth = 2200;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const xFactor = 111320 * cosLat, zFactor = 111320;
  const project = (lon, lat) => [(lon - centerLon) * xFactor, (lat - centerLat) * zFactor];
  const inMap = ([x, z]) => Math.abs(x) <= width / 2 && Math.abs(z) <= depth / 2;
  const csvText = await readFile(roadPath, 'utf8');
  const rows = csvRows(csvText);
  const headers = rows.next().value || [];
  const geometryIndex = headers.findIndex(name => /geometry|wkt|shape/i.test(name));
  const nameIndex = headers.findIndex(name => /linear_name_full|street_name|road_name|streetname|name_full/i.test(name));
  const classIndex = headers.findIndex(name => /feature_code_desc|road_class_desc|roadtype_desc/i.test(name));
  const roadRows = [];
  let rowCount = 0;
  let firstSample = null;
  for (const row of rows) {
    rowCount++;
    if (geometryIndex < 0 || !row[geometryIndex]) continue;
    const paths = parseRoadGeometry(row[geometryIndex]);
    if (!firstSample) firstSample = { name: row[nameIndex], roadClass: row[classIndex], geometryField: headers[geometryIndex], geometrySample: row[geometryIndex].slice(0, 140) };
    const roadClass = String(row[classIndex] || '').trim();
    if (/river|railway|hydro line/i.test(roadClass)) continue;
    for (const path of paths) {
      const projected = path.map(([lon, lat]) => project(lon, lat));
      for (const clipped of clipPath(projected, width / 2, depth / 2)) {
        if (clipped.length < 2) continue;
        const name = String(row[nameIndex] || '').trim() || 'LOCAL ROAD';
        roadRows.push({ name, class: roadClass, width: roadWidth(roadClass), points: clipped.map(([x, z]) => [round(x), round(z)]), label: false });
      }
    }
  }
  markRoadLabels(roadRows);

  const parkRaw = JSON.parse(await readFile(parkPath, 'utf8'));
  const parks = new Map();
  let firstPark = null;
  const localParkSamples = [];
  for (const feature of parkRaw.features || []) {
    const properties = feature.properties || {};
    const name = parkName(properties), parkClass = String(properties.AREA_CLASS || 'Park');
    const polygons = geoPolygons(feature.geometry).map(polygon => polygon.map(ring => ring.map(([lon, lat]) => {
      const [x, z] = project(lon, lat); return [round(x), round(z)];
    })));
    if (!polygons.some(polygon => polygonIntersectsMap(polygon, width / 2, depth / 2))) continue;
    if (!firstPark) firstPark = { properties: feature.properties, geometryType: feature.geometry?.type };
    if (localParkSamples.length < 20) localParkSamples.push({ name, class: parkClass, desc: properties.AREA_DESC });
    const group = parks.get(name) || { name, classes: [], polygons: [], signatures: new Set() };
    if (!group.classes.includes(parkClass)) group.classes.push(parkClass);
    for (const polygon of polygons) {
      const signature = polygonSignature(polygon);
      if (!group.signatures.has(signature)) { group.signatures.add(signature); group.polygons.push(polygon); }
    }
    parks.set(name, group);
  }

  if (inspect) {
    console.log(JSON.stringify({
      roadFile: basename(roadPath), roadRows: rowCount, roadHeaders: headers,
      roadGeometryField: headers[geometryIndex], roadNameField: headers[nameIndex], roadClassField: headers[classIndex],
      firstRoadInsideData: firstSample, localRoadSegments: roadRows.length,
      parkFile: basename(parkPath), parkFeatureTotal: parkRaw.features?.length || 0,
      firstPark, parksIntersectingMap: parks.size, localParkSamples,
      map: { centerLat, centerLon, widthMeters: width, depthMeters: depth },
    }, null, 2));
  } else {
    const output = {
      source: {
        roads: 'City of Toronto, Toronto Centreline (TCL), Version 2, WGS84',
        parks: 'City of Toronto, Green Spaces, WGS84',
        license: 'Open Government Licence - Toronto',
      },
      map: { centerLat, centerLon, widthMeters: width, depthMeters: depth },
      roads: roadRows,
      parks: [...parks.values()].map(({ signatures, ...park }) => park),
    };
    await writeFile(outputPath, JSON.stringify(output));
    console.log(`Wrote ${roadRows.length.toLocaleString()} road segments and ${parks.size.toLocaleString()} park areas to ${outputPath}`);
  }
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

function parseWkt(value) {
  const text = String(value).trim();
  if (/^MULTILINESTRING/i.test(text)) return [...text.matchAll(/\(([^()]*)\)/g)].map(match => parseCoordinateList(match[1]));
  if (/^LINESTRING/i.test(text)) return [parseCoordinateList(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')) )];
  return [];
}

function parseRoadGeometry(value) {
  const text = String(value).trim();
  if (text.startsWith('{')) {
    try {
      const geometry = JSON.parse(text);
      if (geometry.type === 'LineString') return [geometry.coordinates.map(point => point.slice(0, 2))];
      if (geometry.type === 'MultiLineString') return geometry.coordinates.map(path => path.map(point => point.slice(0, 2)));
      return [];
    } catch { return []; }
  }
  return parseWkt(text);
}

function parseCoordinateList(text) {
  return text.split(',').map(pair => pair.trim().split(/\s+/).slice(0, 2).map(Number)).filter(point => point.length === 2 && point.every(Number.isFinite));
}

function clipPath(points, halfWidth, halfDepth) {
  const paths = [];
  let current = [];
  for (let index = 0; index < points.length - 1; index++) {
    const segment = clipSegment(points[index], points[index + 1], halfWidth, halfDepth);
    if (!segment) { if (current.length > 1) paths.push(current); current = []; continue; }
    const [start, end] = segment;
    if (current.length && distance(current[current.length - 1], start) < .15) current.push(end);
    else { if (current.length > 1) paths.push(current); current = [start, end]; }
  }
  if (current.length > 1) paths.push(current);
  return paths;
}

function clipSegment(a, b, halfWidth, halfDepth) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const checks = [[-dx, a[0] + halfWidth], [dx, halfWidth - a[0]], [-dz, a[1] + halfDepth], [dz, halfDepth - a[1]]];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dz], [a[0] + t1 * dx, a[1] + t1 * dz]];
}

function roadWidth(roadClass) {
  const value = roadClass.toLowerCase();
  if (value.includes('trail')) return 5;
  if (value.includes('walkway')) return 4;
  if (value.includes('expressway') || value.includes('freeway')) return 34;
  if (value.includes('arterial') && !value.includes('minor')) return 27;
  if (value.includes('minor')) return 21;
  if (value.includes('collector')) return 15;
  if (value.includes('local')) return 10;
  if (value.includes('other') || value.includes('pending')) return 7;
  return 6;
}

function markRoadLabels(roads) {
  const longest = new Map();
  for (const road of roads) {
    let length = 0;
    for (let i = 1; i < road.points.length; i++) length += distance(road.points[i - 1], road.points[i]);
    const previous = longest.get(road.name);
    if (!previous || length > previous.length) longest.set(road.name, { road, length });
  }
  for (const { road, length } of longest.values()) road.label = length > 140 && /arterial|expressway|collector/i.test(road.class);
}

function geoPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function parkName(properties) {
  const key = Object.keys(properties).find(name => /park.*name|name.*park|official.*name/i.test(name));
  return String((key && properties[key]) || properties.AREA_NAME || properties.AREA_DESC || properties.NAME || 'GREEN SPACE').trim();
}

function polygonIntersectsMap(polygon, halfWidth, halfDepth) {
  const outer = polygon[0] || [];
  if (!outer.length) return false;
  const xs = outer.map(point => point[0]), zs = outer.map(point => point[1]);
  return Math.min(...xs) <= halfWidth && Math.max(...xs) >= -halfWidth && Math.min(...zs) <= halfDepth && Math.max(...zs) >= -halfDepth;
}

function polygonSignature(polygon) {
  const points = polygon.flat();
  const xs = points.map(point => point[0]), zs = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map(value => round(value)).join(':');
}

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function round(value) { return Math.round(value * 10) / 10; }
