"""What printing the 3D model takes: its size, filament changes and thin shapes (JSON)."""

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.concurrency import run_in_threadpool

from app.api.export_forms import ModelOptions, UploadedSvg
from app.schemas.export import (
    ColorChangesResponse,
    FilamentConflictModel,
    FilamentPlanResponse,
    FilamentStepModel,
    FilamentUseModel,
    ModelSizeResponse,
    PrintCheckResponse,
    ThinShapeModel,
)
from app.services.color_changes import PLA_DENSITY, ChangeCosts, estimate_color_changes
from app.services.export_stl import model_size
from app.services.filament_plan import filament_plan
from app.services.print_check import check_print

router = APIRouter()


@router.post("/filament-plan", response_model=FilamentPlanResponse)
async def export_filament_plan(
    document: UploadedSvg, options: ModelOptions
) -> FilamentPlanResponse:
    """Where to change filament when printing the STL/3MF on a single-extruder printer."""
    plan = await run_in_threadpool(filament_plan, document, options)
    return FilamentPlanResponse(
        steps=[FilamentStepModel(z_mm=s.z_mm, layer=s.layer, color=s.color) for s in plan.steps],
        conflicts=[FilamentConflictModel(z_mm=c.z_mm, colors=c.colors) for c in plan.conflicts],
        height_mm=plan.height_mm,
    )


@router.post("/model-size", response_model=ModelSizeResponse)
async def export_model_size(document: UploadedSvg, options: ModelOptions) -> ModelSizeResponse:
    """Size of the STL/3MF model, to check it against a printer's build volume."""
    size = await run_in_threadpool(model_size, document, options)
    return ModelSizeResponse(x_mm=size.x_mm, y_mm=size.y_mm, z_mm=size.z_mm)


@router.post("/print-check", response_model=PrintCheckResponse)
async def export_print_check(
    document: UploadedSvg,
    options: ModelOptions,
    nozzle_mm: Annotated[float, Form(gt=0, le=2, description="Nozzle width")] = 0.4,
) -> PrintCheckResponse:
    """Shapes of the STL/3MF model narrower than the nozzle where they print: the slicer
    skips them, and min_feature_mm drops them from the export."""
    check = await run_in_threadpool(check_print, document, options, nozzle_mm)
    return PrintCheckResponse(
        nozzle_mm=check.nozzle_mm,
        shapes=[
            ThinShapeModel(
                id=shape.shape_id,
                palette_index=shape.palette_index,
                color=shape.color,
                area_mm2=shape.area_mm2,
                thin_mm2=shape.thin_mm2,
                vanishes=shape.vanishes,
            )
            for shape in check.shapes
        ],
        thin_mm2=check.thin_mm2,
    )


@router.post("/color-changes", response_model=ColorChangesResponse)
async def export_color_changes(
    document: UploadedSvg,
    options: ModelOptions,
    change_s: Annotated[
        float, Form(ge=0, le=600, description="Time of one filament change (seconds)")
    ] = 0.0,
    purge_mm3: Annotated[
        float, Form(ge=0, le=5000, description="Filament purged per change (flush + prime tower)")
    ] = 0.0,
    density_g_cm3: Annotated[
        float, Form(gt=0, le=5, description="Filament density for purge_g")
    ] = PLA_DENSITY,
) -> ColorChangesResponse:
    """How many filament changes a multi-color printer (AMS, ACE, MMU) makes for the 3MF,
    what they cost in time and purged filament, and how much of each filament the model
    takes. Needs print_layer_mm."""
    costs = ChangeCosts(change_s=change_s, purge_mm3=purge_mm3, density_g_cm3=density_g_cm3)
    estimate = await run_in_threadpool(estimate_color_changes, document, options, costs)
    return ColorChangesResponse(
        filaments=[
            FilamentUseModel(color=use.color, volume_mm3=use.volume_mm3, grams=use.grams)
            for use in estimate.filaments
        ],
        layers=estimate.layers,
        changes=estimate.changes,
        max_colors_per_layer=estimate.max_colors_per_layer,
        change_time_s=estimate.change_time_s,
        purge_mm3=estimate.purge_mm3,
        purge_g=estimate.purge_g,
    )
