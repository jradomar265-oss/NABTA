import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from analyze_sheets import (
    composite_checkerboard,
    find_components,
    inspect_sheet,
    validate_manual_regions,
)


class AnalyzeSheetsTests(unittest.TestCase):
    def test_components_use_nonzero_alpha_and_eight_connectivity(self) -> None:
        image = Image.new("RGBA", (5, 5), (0, 0, 0, 0))
        image.putpixel((0, 0), (12, 34, 56, 1))
        image.putpixel((1, 1), (12, 34, 56, 128))
        image.putpixel((4, 4), (12, 34, 56, 255))

        components = find_components(image)

        self.assertEqual(
            components,
            [
                {"x": 0, "y": 0, "width": 2, "height": 2, "alpha_pixel_count": 2},
                {"x": 4, "y": 4, "width": 1, "height": 1, "alpha_pixel_count": 1},
            ],
        )

    def test_checkerboard_preview_preserves_source_dimensions(self) -> None:
        image = Image.new("RGBA", (7, 5), (30, 180, 90, 255))

        preview = composite_checkerboard(image)

        self.assertEqual(preview.size, image.size)
        self.assertEqual(preview.mode, "RGB")

    def test_manual_regions_split_objects_inside_one_connected_frame(self) -> None:
        image = Image.new("RGBA", (4, 2), (20, 90, 40, 255))
        self.assertEqual(len(find_components(image)), 1)

        regions = validate_manual_regions(
            image.size,
            [
                {"id": "left_object", "x": 0, "y": 0, "width": 2, "height": 2},
                {"id": "right_object", "x": 2, "y": 0, "width": 2, "height": 2},
            ],
        )

        self.assertEqual([region["id"] for region in regions], ["left_object", "right_object"])

    def test_manual_region_rejects_out_of_bounds_boxes(self) -> None:
        with self.assertRaises(ValueError):
            validate_manual_regions(
                (4, 4),
                [{"id": "outside", "x": 3, "y": 0, "width": 2, "height": 1}],
            )

    def test_manual_region_rejects_path_like_ids(self) -> None:
        with self.assertRaises(ValueError):
            validate_manual_regions(
                (4, 4),
                [{"id": "../tree", "x": 0, "y": 0, "width": 1, "height": 1}],
            )

    def test_overlapping_and_large_regions_are_flagged_for_review(self) -> None:
        regions = validate_manual_regions(
            (100, 100),
            [
                {"id": "large_region", "x": 0, "y": 0, "width": 61, "height": 85},
                {"id": "overlap", "x": 10, "y": 10, "width": 20, "height": 20},
            ],
        )

        self.assertIn("large_manual_region", regions[0]["review_flags"])
        self.assertIn("overlaps_other_manual_region", regions[0]["review_flags"])
        self.assertEqual(regions[0]["overlaps_with"], ["overlap"])
        self.assertEqual(regions[1]["overlaps_with"], ["large_region"])

    def test_manual_overrides_export_two_crops_from_one_component(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_dir = root / "source"
            output_dir = root / "output"
            source_dir.mkdir()
            image = Image.new("RGBA", (4, 2), (20, 90, 40, 255))
            image.save(source_dir / "shared_frame.png")
            regions = {
                "shared_frame.png": [
                    {"id": "left_object", "x": 0, "y": 0, "width": 2, "height": 2},
                    {"id": "right_object", "x": 2, "y": 0, "width": 2, "height": 2},
                ]
            }

            sheet = inspect_sheet(
                "shared_frame.png",
                "objects",
                source_dir,
                output_dir,
                root,
                regions,
            )

            self.assertEqual(sheet["component_count"], 1)
            self.assertEqual(sheet["manual_region_count"], 2)
            for region in sheet["manual_regions"]:
                crop_path = root / region["exported_file"]
                self.assertTrue(crop_path.is_file())
                with Image.open(crop_path) as crop:
                    self.assertEqual(crop.size, (2, 2))
                    self.assertEqual(crop.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()