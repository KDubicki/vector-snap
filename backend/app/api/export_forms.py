"""Form fields the exports share: the uploaded SVG, the 3D model and 3MF package options,
the colors to leave out.

Every 3D endpoint (STL, STL parts, 3MF, filament plan, model size, color changes) reads
the same options, so they are declared once here as FastAPI dependencies. See
docs/05-api-specification.md.
"""

from typing import Annotated

from fastapi import Depends, File, Form, UploadFile

from app.api.deps import read_upload
from app.core.config import Settings, get_settings
from app.schemas.export import (
    parse_color_stacks,
    parse_filaments,
    parse_flag,
    parse_layer_heights,
    parse_shape_heights,
)
from app.schemas.palette import parse_palette_indices
from app.services.base_plate import BaseShape, LoopPosition
from app.services.export_3mf import Layout, ThreeMfOptions
from app.services.mesh import StlFormat
from app.services.model_options import Origin, Relief, StackOrder, StlOptions
from app.services.svg_geometry import VectorDocument, parse_svg


async def uploaded_svg(
    settings: Annotated[Settings, Depends(get_settings)],
    svg: Annotated[UploadFile, File(description="SVG in the VectorSnap contract")],
) -> VectorDocument:
    """Read and parse the `svg` form field every export takes."""
    return parse_svg(await read_upload(svg, settings))


UploadedSvg = Annotated[VectorDocument, Depends(uploaded_svg)]


def stl_options(
    width_mm: Annotated[float, Form(gt=0, le=10_000, description="Model width")] = 100.0,
    base_mm: Annotated[float, Form(ge=0, le=100, description="Base plate thickness")] = 1.0,
    layer_mm: Annotated[float, Form(gt=0, le=100, description="Height per color layer")] = 1.0,
    layered: Annotated[
        str | None,
        Form(description="Stack color layers at increasing heights (true or false, default true)"),
    ] = None,
    layer_heights: Annotated[
        str, Form(description='Per-color height, e.g. {"0": 0, "2": 3.5}; 0 omits a color')
    ] = "{}",
    shape_heights: Annotated[
        str,
        Form(description='Per-shape height, e.g. {"p-2-0": 3}; overrides its color, 0 omits'),
    ] = "{}",
    mirror: Annotated[bool, Form(description="Mirror horizontally (stamps)")] = False,
    min_feature_mm: Annotated[
        float, Form(ge=0, le=10, description="Remove parts narrower than this (nozzle width)")
    ] = 0.0,
    simplify_mm: Annotated[
        float, Form(ge=0, le=2, description="Simplify outlines to this tolerance; 0 = exact")
    ] = 0.0,
    color_gap_mm: Annotated[
        float, Form(ge=0, le=2, description="Gap between neighbouring colors; 0 = none")
    ] = 0.0,
    print_layer_mm: Annotated[
        float, Form(ge=0, le=1, description="Printer layer height; heights snap to it")
    ] = 0.0,
    base_shape: Annotated[
        BaseShape,
        Form(description="Base plate: design outline, rectangle, rounded, circle, oval, hexagon"),
    ] = "outline",
    base_margin_mm: Annotated[
        float, Form(ge=0, le=100, description="How far the base plate extends beyond the design")
    ] = 0.0,
    stack_order: Annotated[
        StackOrder, Form(description="Bottom-to-top color order: document or by brightness")
    ] = "document",
    relief: Annotated[
        Relief,
        Form(
            description="Colors raised on the base plate, inlaid flush into it, or engraved "
            "(cut out of it: lettering made of missing filament)"
        ),
    ] = "raised",
    origin: Annotated[
        Origin, Form(description="corner: x and y from 0; center: footprint centered on 0")
    ] = "corner",
    rim_mm: Annotated[
        float, Form(ge=0, le=50, description="Raised rim along the base plate's edge; 0 = none")
    ] = 0.0,
    rim_height_mm: Annotated[
        float, Form(ge=0, le=100, description="Rim height above the base; 0 = tallest color")
    ] = 0.0,
    loop_hole_mm: Annotated[
        float, Form(ge=0, le=20, description="Hanging loop hole diameter on the base; 0 = none")
    ] = 0.0,
    loop_position: Annotated[
        LoopPosition, Form(description="Side of the base plate the hanging loop is on")
    ] = "top",
    magnet_mm: Annotated[
        float, Form(ge=0, le=50, description="Magnet pocket diameter under the base; 0 = none")
    ] = 0.0,
    magnet_depth_mm: Annotated[
        float, Form(gt=0, le=20, description="Magnet pocket depth (below base_mm - 0.4)")
    ] = 2.0,
    magnet_count: Annotated[
        int, Form(ge=1, le=4, description="Magnet pockets, spread along the longer side")
    ] = 1,
    screw_holes: Annotated[
        int,
        Form(ge=0, le=4, description="Screw holes through the plate beside the design: 0, 2 or 4"),
    ] = 0,
    screw_hole_mm: Annotated[float, Form(gt=0, le=10, description="Screw hole diameter")] = 4.0,
    outline_mm: Annotated[
        float, Form(ge=0, le=5, description="Outline along every color's edges; 0 = none")
    ] = 0.0,
    outline_color: Annotated[
        str, Form(pattern=r"^#[0-9a-fA-F]{6}$", description="Outline filament, #rrggbb")
    ] = "#000000",
    outline_height_mm: Annotated[
        float, Form(ge=0, le=100, description="Outline height above the base; 0 = tallest color")
    ] = 0.0,
    elephant_foot_mm: Annotated[
        float, Form(ge=0, le=0.5, description="Inset the base plate's first layer; 0 = off")
    ] = 0.0,
    copies: Annotated[
        int, Form(ge=1, le=100, description="Copies of the model on the bed, in a grid")
    ] = 1,
    copy_gap_mm: Annotated[float, Form(ge=0, le=100, description="Space between the copies")] = 5.0,
    filaments: Annotated[
        str,
        Form(description='Mixed colors: loaded filaments, e.g. ["#ffffff", "#ff0000"]'),
    ] = "[]",
    color_stacks: Annotated[
        str,
        Form(
            description="Mixed colors: per color its filaments from the top down, e.g. "
            '{"0": {"base": 0, "top": [[1, 0.16]]}}'
        ),
    ] = "{}",
) -> StlOptions:
    """3D model options shared by STL and 3MF."""
    return StlOptions(
        width_mm=width_mm,
        base_mm=base_mm,
        layer_mm=layer_mm,
        layered=parse_flag(layered, "layered", default=True),
        layer_heights=parse_layer_heights(layer_heights),
        shape_heights=parse_shape_heights(shape_heights),
        mirror=mirror,
        min_feature_mm=min_feature_mm,
        simplify_mm=simplify_mm,
        color_gap_mm=color_gap_mm,
        print_layer_mm=print_layer_mm,
        base_shape=base_shape,
        base_margin_mm=base_margin_mm,
        stack_order=stack_order,
        relief=relief,
        origin=origin,
        rim_mm=rim_mm,
        rim_height_mm=rim_height_mm,
        loop_hole_mm=loop_hole_mm,
        loop_position=loop_position,
        magnet_mm=magnet_mm,
        magnet_depth_mm=magnet_depth_mm,
        magnet_count=magnet_count,
        screw_holes=screw_holes,
        screw_hole_mm=screw_hole_mm,
        outline_mm=outline_mm,
        outline_color=outline_color.lower(),
        outline_height_mm=outline_height_mm,
        elephant_foot_mm=elephant_foot_mm,
        filaments=parse_filaments(filaments),
        color_stacks=parse_color_stacks(color_stacks),
        copies=copies,
        copy_gap_mm=copy_gap_mm,
    )


ModelOptions = Annotated[StlOptions, Depends(stl_options)]
StlFormatField = Annotated[
    StlFormat, Form(description="binary (compact) or ascii (text, for tools that need it)")
]


def package_options(
    title: Annotated[str, Form(max_length=200, description="Model name and title")] = "",
    designer: Annotated[str, Form(max_length=200, description="Designer metadata")] = "",
    description: Annotated[str, Form(max_length=2000, description="Description metadata")] = "",
    layout: Annotated[
        Layout, Form(description="assembly: parts of one model; objects: separate models")
    ] = "assembly",
    slicer_config: Annotated[
        str | None,
        Form(
            description="Assign a filament in its color to every part for Orca-based slicers "
            "(Anycubic Slicer Next, OrcaSlicer, Bambu Studio); true or false, default true"
        ),
    ] = None,
    thumbnail: Annotated[
        str | None,
        Form(
            description="Top view of the colored model as the package thumbnail (PNG); "
            "true or false, default true"
        ),
    ] = None,
) -> ThreeMfOptions:
    """3MF package details: name, metadata, layout, slicer config and thumbnail."""
    return ThreeMfOptions(
        title=title.strip(),
        designer=designer.strip(),
        description=description.strip(),
        layout=layout,
        slicer_config=parse_flag(slicer_config, "slicer_config", default=True),
        thumbnail=parse_flag(thumbnail, "thumbnail", default=True),
    )


PackageOptions = Annotated[ThreeMfOptions, Depends(package_options)]


def excluded_colors(
    exclude_colors: Annotated[
        str, Form(description="JSON array of palette indices to leave out, e.g. the background")
    ] = "[]",
) -> frozenset[int]:
    """Colors a 2D export leaves out (cookie cutter, sticker, stencil, coloring page)."""
    return frozenset(parse_palette_indices(exclude_colors, "exclude_colors"))


ExcludedColors = Annotated[frozenset[int], Depends(excluded_colors)]
