"""Edit SVG documents (VectorSnap contract) on the server: the editor's tools for services
and scripts. See docs/05-api-specification.md#svg.

- `colors`: join similar colors, recolor, snap to filaments.
- `cuts`: knife and lasso.
- `shapes`: delete, merge, transform and simplify shapes.
- `info`: statistics of a document.
"""

from fastapi import APIRouter

from app.api.routes.svg import colors, cuts, info, shapes

router = APIRouter(prefix="/svg", tags=["svg"])
for module in (colors, cuts, shapes, info):
    router.include_router(module.router)
