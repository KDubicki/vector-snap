from app.services.svg_validate import validate_svg
from tests.vectors import contract_svg

NS = 'xmlns="http://www.w3.org/2000/svg"'


def _codes(data: bytes) -> list[str]:
    return [problem.code for problem in validate_svg(data).problems]


def test_a_contract_svg_has_no_problems() -> None:
    result = validate_svg(contract_svg(40, 20, [("#ffffff", ["M0,0 H40 V20 H0 Z"])]))

    assert (result.valid, result.colors, result.shapes, result.problems) == (True, 1, 1, [])


def test_documents_that_cannot_be_read_are_errors() -> None:
    for data in (b"not xml", f"<svg {NS} viewBox='0 0 10 10'></svg>".encode()):
        result = validate_svg(data)
        assert not result.valid
        assert [problem.code for problem in result.problems] == ["invalid_svg"]


def test_reports_what_the_parser_repairs_or_leaves_out() -> None:
    data = f"""<svg {NS} viewBox="0 0 10 10">
      <rect width="5" height="5"/>
      <g fill="red">
        <path d="M0,0 h5 v5 h-5 z"/>
        <path id="a" d="M1,1 h2 v2 h-2 z"/>
        <circle r="2"/>
      </g>
      <g data-palette-index="0" fill="#00ff00">
        <path id="a" d="M8,8 h5 v5 h-5 z"/>
        <path id="flat" d="M0,0 L5,0 Z"/>
        <path id="blank" d=""/>
      </g>
    </svg>""".encode()

    result = validate_svg(data)

    assert result.valid
    assert [problem.code for problem in result.problems] == [
        "ignored_elements",
        "group_without_fill",
        "group_without_index",
        "duplicate_palette_index",
        "path_without_data",
        "path_without_id",
        "duplicate_id",
        "shape_without_area",
        "shape_outside_viewbox",
    ]
    by_code = {problem.code: problem for problem in result.problems}
    assert "1 <circle>, 1 <rect>" in by_code["ignored_elements"].message
    assert by_code["duplicate_id"].ids == ["a"]
    assert by_code["shape_without_area"].ids == ["flat"]
    assert by_code["shape_outside_viewbox"].ids == ["a"]
    assert all(problem.severity == "warning" for problem in result.problems)
