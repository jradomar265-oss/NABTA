import unittest

from PIL import Image

from analyze_sheets import composite_checkerboard, find_components


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


if __name__ == "__main__":
    unittest.main()