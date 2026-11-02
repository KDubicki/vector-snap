"""Edit SVG documents (VectorSnap contract) on the server: the editor's tools for services
and scripts. See docs/05-api-specification.md#svg.

- `colors`: join similar colors, recolor, snap to filaments.
- `cuts`: knife and lasso.
- `shapes`: delete, merge, transform and simplify shapes.
- `document`: crop the document, reorder its color layers.
- `info`: statistics of a document, contract check.
- `batch`: several of the edits in one request.
"""

from fastapi import APIRouter

from app.api.routes.svg import batch, colors, cuts, document, info, shapes

router = APIRouter(prefix="/svg", tags=["svg"])
for module in (colors, cuts, shapes, document, info, batch):
    router.include_router(module.router)
