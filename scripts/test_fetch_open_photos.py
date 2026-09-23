import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_data import venue_photo_records
from scripts.fetch_open_photos import (
    FLICKR_OPEN_LICENSE_IDS,
    PhotoRecord,
    candidate_is_rejected,
    candidate_is_relevant,
    commons_license_ok,
    commons_name_search_eligible,
    commons_query_props,
    merge_open_photo_entry,
    open_photo_count,
    parse_commons_pages,
    photos_needed,
    registered_photo,
    select_unique_candidates,
    unregister_open_photos,
)


def photo_record(
    title, description=None, categories=None, original_url="https://example.org/photo.jpg"
):
    return PhotoRecord(
        source="Wikimedia Commons",
        title=title,
        page_url="https://commons.wikimedia.org/wiki/File:photo.jpg",
        original_url=original_url,
        download_url=original_url,
        original_width=1600,
        original_height=1200,
        local_original=None,
        site_file=None,
        artist="A photographer",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        usage_terms="CC BY 4.0",
        date_taken=None,
        description=description,
        lat=None,
        lon=None,
        distance_m=None,
        venue_slug=None,
        fetched_at=None,
        categories=categories or [],
    )


class CommonsLicenseTests(unittest.TestCase):
    def test_allowed_and_rejected_licences(self):
        cases = (
            ("CC BY-SA 4.0", True),
            ("CC BY 2.0", True),
            ("CC0", True),
            ("Public domain", True),
            ("CC BY-NC-SA 2.0", False),
            ("CC BY-ND 4.0", False),
            ("GFDL", False),
            (None, False),
        )
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(commons_license_ok(value), expected)

    def test_flickr_excludes_no_derivatives(self):
        self.assertEqual(FLICKR_OPEN_LICENSE_IDS, "4,5,9,10")


class CommonsPageParsingTests(unittest.TestCase):
    def test_filters_titles_and_builds_metadata_with_photo_coordinates(self):
        pages = {
            "1": {
                "title": "File:Bukit Timah trail.jpg",
                "coordinates": [{"lat": 1.3556, "lon": 103.7764}],
                "categories": [{"title": "Category:Hiking trails in Singapore"}],
                "imageinfo": [
                    {
                        "url": "https://upload.wikimedia.org/bukit-timah.jpg",
                        "thumburl": "https://upload.wikimedia.org/thumb/bukit-timah.jpg",
                        "descriptionurl": "https://commons.wikimedia.org/wiki/File:Bukit_Timah_trail.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {
                            "LicenseShortName": {"value": "CC BY-SA 4.0"},
                            "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
                            "Artist": {"value": "<a>Ada &amp; Bee</a>"},
                            "UsageTerms": {"value": "Attribution required"},
                            "DateTimeOriginal": {"value": "2024:05:11 09:30:00"},
                            "ImageDescription": {"value": "A trail on Bukit Timah Hill"},
                        },
                    }
                ],
            },
            "2": {
                "title": "File:Bukit Timah Map.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/map.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "3": {
                "title": "File:Bukit Timah view.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/nc.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY-NC-SA 2.0"}},
                    }
                ],
            },
            "4": {
                "title": "File:Bukit Timah Summit 09-08-2025(7).jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/numbered-set.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "5": {
                "title": "File:Bukit Timah Summit - panoramio.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/panoramio.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "6": {
                "title": "File:Mount Apo Boundary Marker.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/marker.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "7": {
                "title": "File:A hike to Bukit Timah Summit - img 18.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/numbered-image.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "8": {
                "title": "File:Bukit Timah summit view.jpg",
                "categories": [{"title": "Category:Plants of Singapore"}],
                "imageinfo": [
                    {
                        "url": "https://example.org/category-rejected.jpg",
                        "mime": "image/jpeg",
                        "width": 2400,
                        "height": 1600,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
            "9": {
                "title": "File:Bukit Timah thumbnail.jpg",
                "imageinfo": [
                    {
                        "url": "https://example.org/small.jpg",
                        "mime": "image/jpeg",
                        "width": 799,
                        "height": 400,
                        "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}},
                    }
                ],
            },
        }

        records = parse_commons_pages(pages, 1.3546, 103.7764, "Bukit Timah Hill")

        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record.title, "Bukit Timah trail.jpg")
        self.assertEqual(record.download_url, "https://upload.wikimedia.org/thumb/bukit-timah.jpg")
        self.assertEqual(record.artist, "Ada & Bee")
        self.assertEqual(record.description, "A trail on Bukit Timah Hill")
        self.assertEqual(record.categories, ["Hiking trails in Singapore"])
        self.assertEqual((record.lat, record.lon), (1.3556, 103.7764))
        self.assertAlmostEqual(record.distance_m or 0, 111.2, delta=1.0)


class CommonsRelevanceTests(unittest.TestCase):
    def test_taxon_titles_are_rejected(self):
        titles = (
            "Cephalotaxus harringtonia 134865109.jpg",
            "Xylanche himalaica 23695312.jpg",
            "Salix taiwanalpina branches on Mount Nanhu.jpg",
            "Hemipilia alpestris.jpg",
            "Rosa transmorrisonensis.jpg",
            "Araiostegia perdurans.jpg",
            "Smilax vaginata.jpg",
            "Pinus morrisonicola.jpg",
            "Angelica nagasawae.jpg",
            "Luzula effusa.jpg",
            "Anaphalis nagasawae.jpg",
            "Plantago glacialis.jpg",
            "Apis laboriosa.jpg",
            "Bulbophyllum elmeri.jpg",
            "Lagopus muta 01.jpg",
            "Bombus monozonus and Rhododendron rubropilosum near Dabajianshan.jpg",
        )
        for title in titles:
            with self.subTest(title=title):
                self.assertTrue(candidate_is_rejected(photo_record(title)))

    def test_irrelevant_titles_and_extensions_are_rejected(self):
        for title in (
            "ISS053_E_209155_View_of_Earth.jpg",
            "DVIDSHUB USS Bunker Hill media.jpg",
            "Bunga edelweis di kawasan puncak welirang.jpg",
            "Carte du Japon 1864 (Malte-Brun).jpg",
            "Route 945.jpg",
            "Goa Kelelawar di Taman Nasional Gunung Leuser.jpg",
            "昌仕橋舊址.jpg",
            "Hypericum choisianum GUNUNG ARJUNO.jpg",
            "Rue Malte-Brun, Paris 12 March 2016.jpg",
            "2014 Thomas Silberhorn.jpg",
            "Thomas Silberhorn 2012.jpg",
            "2014 Thomas Silberhorn 2.jpg",
            "Thomas Silberhorn at the Tomb of the Unknown Soldier.jpg",
        ):  
            with self.subTest(title=title):
                self.assertTrue(candidate_is_rejected(photo_record(title)))
        self.assertTrue(
            candidate_is_rejected(photo_record("Yushan Summit.png", original_url="https://example.org/yushan.png"))
        )

    def test_category_rejection_and_relevant_mountain_photos(self):
        plant_photo = photo_record("Bukit Timah summit view.jpg", categories=["Plants in Taiwan"])
        wildlife_photo = photo_record("Bukitlawang.jpg", categories=["Orangutans in Sumatra"])
        portrait_photo = photo_record("Silberhorn.jpg", categories=["Portraits of climbers"])
        torii_photo = photo_record("Mt Fuji - panoramio (7).jpg", categories=["Wooden torii in Japan"])
        self.assertTrue(candidate_is_rejected(plant_photo))
        self.assertTrue(candidate_is_rejected(wildlife_photo))
        self.assertTrue(candidate_is_rejected(portrait_photo))
        self.assertTrue(candidate_is_rejected(torii_photo))

        self.assertTrue(candidate_is_relevant(photo_record("Yushan Summit 2024.jpg"), "Yushan", "yushan-123"))
        self.assertTrue(
            candidate_is_relevant(
                photo_record("玉山北峰令人感動的夕陽 - panoramio.jpg"),
                "玉山北峰",
                "yushan-north-peak-123",
            )
        )
        self.assertTrue(
            candidate_is_relevant(photo_record("Mount Murud Summit 02.jpg"), "Mount Murud", "mount-murud-123")
        )
        self.assertTrue(
            candidate_is_relevant(
                photo_record("Eruption of Raung Volcano (19684852442).jpg"),
                "Mount Raung",
                "gunung-raung-546451027",
            )
        )
        lush_details = photo_record("Lush Details.jpg")
        self.assertFalse(candidate_is_rejected(lush_details))
        self.assertFalse(candidate_is_relevant(lush_details, "Malte-Brun", "malte-brun-123"))

    def test_commons_queries_include_visible_categories(self):
        props = commons_query_props(5)
        self.assertEqual(props["prop"], "imageinfo|coordinates|categories")
        self.assertEqual(props["cllimit"], "max")
        self.assertEqual(props["clshow"], "!hidden")


class CommonsNameSearchTests(unittest.TestCase):
    def test_rejects_fallback_files_with_no_description_or_geotag(self):
        record = PhotoRecord(
            source="Wikimedia Commons",
            title="Gunung Irau (The Mossy Forest) (25580759504).jpg",
            page_url="https://commons.wikimedia.org/wiki/File:Gunung_Irau.jpg",
            original_url="https://example.org/irau.jpg",
            download_url="https://example.org/irau.jpg",
            original_width=2500,
            original_height=1667,
            local_original=None,
            site_file=None,
            artist="A photographer",
            license="CC BY 2.0",
            license_url="https://creativecommons.org/licenses/by/2.0/",
            usage_terms="CC BY 2.0",
            date_taken=None,
            description="Gunung Irau (The Mossy Forest)",
            lat=None,
            lon=None,
            distance_m=None,
            venue_slug=None,
            fetched_at=None,
        )

        self.assertFalse(commons_name_search_eligible(record, "Gunung Irau"))
        record.description = "A mossy forest trail on Gunung Irau"
        record.distance_m = 2_000
        self.assertFalse(commons_name_search_eligible(record, "Gunung Irau", 1_000))
        record.distance_m = None
        self.assertTrue(commons_name_search_eligible(record, "Gunung Irau", 1_000))


class PhotosJsonRegistrationTests(unittest.TestCase):
    def test_registered_photo_uses_public_relative_path(self):
        record = PhotoRecord(
            source="Wikimedia Commons",
            title="Bukit Timah trail.jpg",
            page_url="https://commons.wikimedia.org/wiki/File:Bukit_Timah_trail.jpg",
            original_url="https://upload.wikimedia.org/bukit-timah.jpg",
            download_url="https://upload.wikimedia.org/thumb/bukit-timah.jpg",
            original_width=1600,
            original_height=1000,
            local_original="open_trail_media/bukit-timah/trail.jpg",
            site_file="photos/open/bukit_timah_trail.webp",
            artist="Ada Bee",
            license="CC BY-SA 4.0",
            license_url="https://creativecommons.org/licenses/by-sa/4.0/",
            usage_terms="Attribution required",
            date_taken=None,
            description=None,
            lat=1.3556,
            lon=103.7764,
            distance_m=111.2,
            venue_slug="bukit-timah-hill",
            fetched_at="2026-03-10T00:00:00+00:00",
        )

        registered = registered_photo(record)

        self.assertTrue(registered["file"].startswith("photos/open/"))
        self.assertEqual(registered["source"], "Wikimedia Commons")
        self.assertEqual(registered["license"], "CC BY-SA 4.0")


class MultiPhotoTests(unittest.TestCase):
    def test_per_venue_cap_and_original_url_uniqueness(self):
        first = photo_record("Mount Murud Summit 01.jpg", original_url="https://example.org/1.jpg")
        duplicate = photo_record("Another title.jpg", original_url="https://example.org/1.jpg")
        second = photo_record("Mount Murud Summit 02.jpg", original_url="https://example.org/2.jpg")
        third = photo_record("Mount Murud Summit 03.jpg", original_url="https://example.org/3.jpg")

        selected = select_unique_candidates([first, duplicate, second, third], 2)

        self.assertEqual(selected, [first, second])
        self.assertEqual(select_unique_candidates([first, second, third], 2, {first.original_url}), [second, third])

    def test_missing_count_and_build_style_more_merge(self):
        primary_record = photo_record("Mount Murud Summit 01.jpg", original_url="https://example.org/1.jpg")
        primary_record.site_file = "photos/open/murud-1.webp"
        more_records = [
            photo_record(f"Mount Murud Summit 0{index}.jpg", original_url=f"https://example.org/{index}.jpg")
            for index in (2, 3)
        ]
        for index, record in enumerate(more_records, start=2):
            record.site_file = f"photos/open/murud-{index}.webp"
        primary = registered_photo(primary_record)
        additions = [registered_photo(record) for record in more_records]

        self.assertEqual(photos_needed(primary, 3), 2)
        merged = merge_open_photo_entry(primary, additions, 3)

        self.assertEqual(open_photo_count(merged), 3)
        self.assertEqual(merged["file"], "photos/open/murud-1.webp")
        self.assertEqual([photo["file"] for photo in merged["more"]], [
            "photos/open/murud-2.webp",
            "photos/open/murud-3.webp",
        ])

    def test_build_data_emits_primary_and_optional_gallery(self):
        entry = {
            "file": "photos/open/primary.webp",
            "creator": "Primary Author",
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "sourceUrl": "https://commons.wikimedia.org/primary",
            "source": "Wikimedia Commons",
            "more": [
                {
                    "file": "photos/open/second.webp",
                    "creator": "Second Author",
                    "license": "CC BY-SA 4.0",
                    "source": "Wikimedia Commons",
                },
                {"file": "photos/open/third.webp", "creator": "Third Author"},
                {"file": "photos/open/ignored-fourth.webp", "creator": "Not kept"},
            ],
        }

        primary, gallery = venue_photo_records(entry)

        self.assertEqual(primary["file"], "photos/open/primary.webp")
        self.assertIsNotNone(gallery)
        self.assertEqual(
            [photo["file"] for photo in gallery or []],
            ["photos/open/primary.webp", "photos/open/second.webp", "photos/open/third.webp"],
        )
        single_primary, no_gallery = venue_photo_records({"file": "photos/open/only.webp"})
        self.assertEqual(single_primary["file"], "photos/open/only.webp")
        self.assertIsNone(no_gallery)


class PhotosJsonCleanupTests(unittest.TestCase):
    def test_unregister_only_removes_open_photos(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            photos_path = Path(temporary_directory) / "photos.json"
            photos_path.write_text(
                json.dumps(
                    {
                        "source": "Mapillary",
                        "photos": {
                            "bad-open": {
                                "file": "photos/open/bad.webp",
                                "source": "Wikimedia Commons",
                            },
                            "mapillary": {"file": "photos/mapillary.webp", "creator": "A"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            with patch("scripts.fetch_open_photos.PHOTOS_JSON", photos_path):
                removed = unregister_open_photos(["bad-open", "mapillary"])
            document = json.loads(photos_path.read_text(encoding="utf-8"))

        self.assertEqual(removed, ["bad-open"])
        self.assertEqual(document["source"], "Mapillary")
        self.assertEqual(document["photos"], {"mapillary": {"file": "photos/mapillary.webp", "creator": "A"}})


if __name__ == "__main__":
    unittest.main()
