# LSL: Flemingdon Royale

A standalone browser Battle Royale prototype using the Lantern Soccer League's 2026 roster. One player drops into a neighbourhood-scale Flemingdon Park map with 11 CPU contestants. The match has collectible weapons and supplies, a shrinking zone, health and shields, and a solo results screen.

## Run it

Install Node.js if it is not already installed, then run this folder's local static server:

```powershell
node scripts/serve.mjs
```

Open <http://127.0.0.1:4173> in a desktop or mobile browser. The game loads its roster and Three.js module from files in this folder; it does not need a build step or runtime CDN.

## Controls

- **WASD** move; **Shift** sprint; **Space** jump
- **Mouse** aim; **left click** fire; **right click** is reserved
- **E** pick up nearby loot; **R** reload
- **1–3** choose a weapon; **H** use a med kit; **J** use a shield cell
- **Esc** pause
- On touch screens, use the left movement pad and the right action buttons; drag the open play area to aim.

## Current scope

The match is local solo play against 11 CPU players. Online matchmaking is a future phase and the lobby labels it as unavailable. The 2,200 m by 2,200 m real-world-scale map uses 1,012 mapped building outlines/heights, 364 road and trail segments, 312 clipped sidewalk paths, 19 greenspace groups, 21 local landmark points, and 11,209 individually mapped tree points with derived heights. The tree mesh uses smooth, varied canopy shapes; recorded species are used only for close matches to the City's street-tree inventory, and other points use generic visual forms. All six nearby schools, plus library, park, and recreation locations, drive map pins and the drop selector. Buildings use mapped roof outlines, simplified facades, and a restrained window grid; roads, sidewalks, and parks follow published geometry. The terrain is currently flat: the Ontario elevation service returned an empty crop for this map, so ravine slopes are not represented. This is a data-driven neighborhood map, not a one-to-one photogrammetric model. The City describes its massing as illustrative and disclaims completeness and accuracy, so it is not an official survey or architectural model.

Map data sources: [3D Massing](https://open.toronto.ca/dataset/3d-massing/), [Toronto Centreline (TCL)](https://open.toronto.ca/dataset/toronto-centreline-tcl/), [Sidewalk Inventory](https://open.toronto.ca/dataset/sidewalk-inventory/), [Green Spaces](https://open.toronto.ca/dataset/green-spaces/), [physical tree locations](https://open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/), [Street Tree Data](https://open.toronto.ca/dataset/street-tree-data/), [School Locations](https://open.toronto.ca/dataset/school-locations-all-types/), [Toronto Public Library branches](https://open.toronto.ca/dataset/library-branch-general-information/), and [Parks and Recreation Facilities](https://open.toronto.ca/dataset/parks-and-recreation-facilities/). Reused under the Open Government Licence - Toronto. The sidewalk inventory comes from 2015 imagery, and the 3D Massing dataset's illustrative-use disclaimer is retained in `data/flemingdon-buildings.json`.

Official player names, numbers, team colors, OVR values, and supplied gameplay profiles feed the character selection and CPU/player movement and shooting traits. Character bodies and stylized weapons are original low-detail game models. The clipped map assets can be regenerated with the scripts in `scripts/` from fresh WGS84 downloads listed above and the City's 2025 massing shapefile. `import-toronto-landmarks.mjs` accepts schools, library, and recreation files; `import-toronto-trees.mjs` accepts the tree-points shapefile and street-tree inventory CSV; `import-toronto-sidewalks.mjs` accepts the Sidewalk Inventory shapefile.
