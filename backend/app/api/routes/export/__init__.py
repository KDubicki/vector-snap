"""Export SVG documents (VectorSnap contract) to other formats. See docs/13-export-formats.md.

- `models`: 3D models to print (STL, 3MF, tiles, lithophane, cookie cutter).
- `estimates`: what printing the 3D model takes (size, filament changes, thin shapes).
- `drawings`: 2D files (DXF, PDF, EPS, PNG, a file per color, palette).
- `crafts`: sheets to cut or color in (sticker, stencil, coloring page).
"""

from fastapi import APIRouter

from app.api.routes.export import crafts, drawings, estimates, models

router = APIRouter(prefix="/export", tags=["export"])
for module in (models, estimates, drawings, crafts):
    router.include_router(module.router)
