import { readFile, writeFile } from 'node:fs/promises';

const [shapePath, outputPath] = process.argv.slice(2);
if (!shapePath || !outputPath) {
  console.error('Usage: node scripts/import-toronto-sidewalks.mjs <sidewalks.shp> <output.json>');
  process.exitCode = 2;
} else {
  const centerLon = -79.3335, centerLat = 43.7135, halfWidth = 1100, halfDepth = 1100;
  const xFactor = 111320 * Math.cos(centerLat * Math.PI / 180), zFactor = 111320;
  const project = ([lon, lat]) => [(lon - centerLon) * xFactor, (lat - centerLat) * zFactor];
  const shape = await readFile(shapePath), fileType = shape.readInt32LE(32);
  if (fileType !== 3) throw new Error(`Expected a polyline shapefile; got shape type ${fileType}.`);

  const paths = [];
  let offset = 100, recordIndex = 0;
  while (offset + 8 <= shape.length) {
    const bytes = shape.readInt32BE(offset + 4) * 2, content = offset + 8;
    if (bytes < 44 || content + bytes > shape.length) throw new Error(`Invalid sidewalk record at byte ${offset}.`);
    const type = shape.readInt32LE(content);
    if (type === 3) {
      const partCount = shape.readInt32LE(content + 36), pointCount = shape.readInt32LE(content + 40);
      const partsOffset = content + 44, pointsOffset = partsOffset + partCount * 4, starts = [];
      for (let i = 0; i < partCount; i++) starts.push(shape.readInt32LE(partsOffset + i * 4));
      starts.push(pointCount);
      for (let part = 0; part < partCount; part++) {
        const points = [];
        for (let i = starts[part]; i < starts[part + 1]; i++) {
          const pointOffset = pointsOffset + i * 16;
          points.push(project([shape.readDoubleLE(pointOffset), shape.readDoubleLE(pointOffset + 8)]));
        }
        paths.push(...clipPath(points, halfWidth, halfDepth));
      }
    }
    offset = content + bytes;
    recordIndex++;
  }
  const output = {
    source: 'City of Toronto, Sidewalk Inventory, WGS84, Open Government Licence - Toronto',
    surveyNote: 'Inventory geometry was interpreted from spring 2015 aerial photography and may be incomplete or out of date.',
    map: { centerLat, centerLon, widthMeters: halfWidth * 2, depthMeters: halfDepth * 2 },
    paths,
  };
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Wrote ${paths.length.toLocaleString()} clipped sidewalk paths from ${recordIndex.toLocaleString()} source records.`);
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
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
