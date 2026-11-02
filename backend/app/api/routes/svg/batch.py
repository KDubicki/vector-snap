"""Several SVG edits in one request: a clean-up script as JSON steps, run in order on the
uploaded document. See docs/05-api-specification.md#post-apiv1svgbatch."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from app.api.export_forms import UploadedSvg
from app.core.errors import InvalidParameters
from app.schemas.svg_batch import (
    MAX_STEPS,
    STEPS,
    CropStep,
    DeleteStep,
    FillHolesStep,
    MergeSimilarStep,
    OffsetStep,
    RecolorStep,
    ReorderStep,
    SimplifyStep,
    Step,
    SvgBatchResponse,
    SvgBatchStepModel,
    TransformStep,
)
from app.services.svg_crop import crop_document
from app.services.svg_edit import merge_similar_colors, recolor, serialize_svg
from app.services.svg_geometry import VectorDocument
from app.services.svg_holes import fill_holes
from app.services.svg_offset import offset_shapes
from app.services.svg_reorder import reorder_layers
from app.services.svg_shapes import delete_shapes
from app.services.svg_simplify import simplify_shapes
from app.services.svg_transform import transform_shapes

router = APIRouter()


def _nothing_to_do(what: str) -> InvalidParameters:
    return InvalidParameters(f"Nothing to do: {what}.")


def _run(document: VectorDocument, step: Step) -> tuple[VectorDocument, int]:
    """One step: the edited document and how much it changed."""
    match step:
        case DeleteStep():
            if not step.ids and step.smaller_than == 0:
                raise _nothing_to_do("give `ids` or `smaller_than`")
            deleted = delete_shapes(document, step.ids, step.smaller_than)
            return deleted.document, len(deleted.deleted)
        case MergeSimilarStep():
            merged = merge_similar_colors(document, step.max_delta_e)
            return merged.document, len(merged.changes)
        case RecolorStep():
            if not step.colors and not step.filaments:
                raise _nothing_to_do("give `colors` or `filaments`")
            recolored = recolor(document, step.colors, step.filaments)
            return recolored.document, len(recolored.changes)
        case SimplifyStep():
            simple = simplify_shapes(document, step.tolerance, step.ids)
            return simple.document, len(simple.simplified)
        case OffsetStep():
            if step.distance == 0:
                raise _nothing_to_do("a `distance` of 0")
            moved = offset_shapes(document, step.distance, step.ids, step.corners)
            return moved.document, len(moved.offset) + len(moved.removed)
        case FillHolesStep():
            filled = fill_holes(document, step.smaller_than, step.ids)
            return filled.document, filled.filled
        case TransformStep():
            if (step.dx, step.dy, step.rotate, step.scale, step.flip) == (0, 0, 0, 1, "none"):
                raise _nothing_to_do("give a move, scale, rotate or flip")
            transformed = transform_shapes(
                document,
                step.ids,
                dx=step.dx,
                dy=step.dy,
                scale=step.scale,
                rotate=step.rotate,
                flip=step.flip,
            )
            return transformed.document, len(transformed.transformed)
        case CropStep():
            cropped = crop_document(document, step.padding, step.ignore_colors)
            return cropped.document, sum(len(layer.shapes) for layer in document.layers)
        case ReorderStep():
            if bool(step.order) == (step.sort is not None):
                raise InvalidParameters("Give either `order` or `sort`.")
            reordered = reorder_layers(document, step.order, step.sort)
            shifted = sum(
                before is not after
                for before, after in zip(document.layers, reordered.layers, strict=True)
            )
            return reordered, shifted


def run_steps(
    document: VectorDocument, steps: list[Step]
) -> tuple[VectorDocument, list[SvgBatchStepModel]]:
    """Every step in order; a failing one names its position (`details.step`, from 0)."""
    done = []
    for index, step in enumerate(steps):
        try:
            document, changed = _run(document, step)
        except InvalidParameters as error:
            raise InvalidParameters(
                f"Step {index + 1} ({step.op}): {error.message}",
                {**error.details, "step": index},
            ) from error
        done.append(SvgBatchStepModel(op=step.op, changed=changed))
    return document, done


@router.post("/batch", response_model=SvgBatchResponse)
async def batch_svg(
    document: UploadedSvg,
    operations: Annotated[
        str,
        Form(
            description=f"JSON array of up to {MAX_STEPS} steps, run in order, e.g. "
            '[{"op": "delete", "smaller_than": 25}, {"op": "merge_similar"}, '
            '{"op": "simplify", "tolerance": 1}]'
        ),
    ],
) -> SvgBatchResponse:
    """Several edits in one request, each step on the previous one's result: delete,
    merge_similar, recolor, simplify, offset, fill_holes, transform, crop, reorder."""
    try:
        steps = STEPS.validate_json(operations)
    except ValidationError as error:
        problems = [
            {"loc": list(problem["loc"]), "msg": problem["msg"]}
            for problem in error.errors(include_input=False, include_url=False)
        ]
        raise InvalidParameters(
            "`operations` must be a JSON array of known steps with valid values.",
            {"field": "operations", "errors": problems},
        ) from error
    edited, done = await run_in_threadpool(run_steps, document, steps)
    return SvgBatchResponse(svg=serialize_svg(edited), steps=done)
