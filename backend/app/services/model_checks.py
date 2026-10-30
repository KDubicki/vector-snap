"""Option combinations a 3D model cannot be built with, rejected before any body is made,
naming the field to change. See docs/13-export-formats.md.
"""

from app.core.errors import InvalidParameters
from app.services.base_plate import MAGNET_ROOF_MM
from app.services.model_options import StlOptions
from app.services.model_parts import Part


def check_options(options: StlOptions, base: float) -> None:
    """Reject option combinations that cannot be built, naming the field to change."""
    engrave = options.relief == "engrave"
    if engrave and options.filaments:
        raise InvalidParameters(
            "An engraving is one filament: it cannot use mixed colors.", {"field": "filaments"}
        )
    if engrave and base <= 0:
        raise InvalidParameters(
            "An engraving needs a base plate to cut into (base_mm > 0).", {"field": "base_mm"}
        )
    if options.loop_hole_mm > 0 and base <= 0:
        raise InvalidParameters(
            "A hanging loop needs a base plate (base_mm > 0).", {"field": "loop_hole_mm"}
        )
    if options.screw_holes not in (0, 2, 4):
        raise InvalidParameters("Screw holes come in 2 or 4.", {"field": "screw_holes"})
    if options.screw_holes and base <= 0:
        raise InvalidParameters(
            "Screw holes need a base plate (base_mm > 0).", {"field": "screw_holes"}
        )
    if options.outline_mm > 0 and (options.relief != "raised" or options.filaments):
        raise InvalidParameters(
            "Outlines stand on the base plate: they need raised colors, not inlaid, "
            "engraved or mixed ones.",
            {"field": "outline_mm"},
        )
    if options.rim_mm > 0 and base <= 0:
        raise InvalidParameters("A rim needs a base plate (base_mm > 0).", {"field": "rim_mm"})
    if options.elephant_foot_mm > 0 and base <= 0:
        raise InvalidParameters(
            "Elephant's foot compensation needs a base plate (base_mm > 0).",
            {"field": "elephant_foot_mm"},
        )


def check_magnet(options: StlOptions, base: float, plate_top: float) -> None:
    """The magnet pockets fit in the solid plate below the inlaid colors, with a roof."""
    if options.magnet_mm > 0 and options.magnet_depth_mm > plate_top - MAGNET_ROOF_MM + 1e-9:
        raise InvalidParameters(
            f"A {options.magnet_depth_mm:g} mm deep magnet pocket needs a base plate of at "
            f"least {options.magnet_depth_mm + MAGNET_ROOF_MM:g} mm"
            + (" below the inlaid colors." if plate_top < base else "."),
            {"field": "magnet_depth_mm"},
        )


def deepest_inlay(parts: list[Part], base: float, options: StlOptions) -> float:
    """How deep the inlaid or engraved colors reach into the base plate (0 for raised
    colors). An engraving may go through the plate."""
    if options.relief == "raised":
        return 0.0
    deepest = max(part.height for part in parts)
    if options.relief == "engrave":
        if deepest > base + 1e-9:
            raise InvalidParameters(
                f"Engraved colors cannot be deeper than the base plate ({base:g} mm); the "
                f"deepest is {deepest:g} mm. As deep as the plate cuts through.",
                {"field": "base_mm"},
            )
        return deepest
    if deepest > base - 1e-9:
        raise InvalidParameters(
            f"Inlaid colors need a base plate thicker than the deepest color ({deepest:g} mm); "
            f"it is {base:g} mm.",
            {"field": "base_mm"},
        )
    return deepest
