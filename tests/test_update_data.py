import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'scripts/update_data.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class ParserTests(unittest.TestCase):
    def xml(self):
        return {
            'serverData': b'<serverData serverId="ru182" timestamp="1"><name>Dione</name><galaxies>4</galaxies><systems>499</systems></serverData>',
            'players': b'<players serverId="ru182" timestamp="2"><player id="42" name="Test" status="vI"/></players>',
            'universe': b'<universe serverId="ru182" timestamp="3"><planet id="1" player="42" name="Test planet" coords="1:2:8"><moon id="2" name="Moon"/></planet><planet id="3" player="42" coords="5:250:1"/></universe>'
        }

    def test_moons_are_excluded_and_administrative_planets_are_retained(self):
        result = updater.parse_snapshot({'number': 182, 'name': 'Dione'}, self.xml())
        self.assertEqual(len(result['planets']), 2)
        self.assertNotIn('moon', result['planets']['1:2:8'])
        self.assertEqual(result['players']['42']['status'], 'vI')
        self.assertEqual(result['timestamps']['universe'], 3)

    def test_wrong_server_identity_is_rejected(self):
        xml = self.xml()
        xml['players'] = xml['players'].replace(b'ru182', b'ru103')
        with self.assertRaises(ValueError):
            updater.parse_snapshot({'number': 182, 'name': 'Dione'}, xml)

    def test_duplicate_coordinates_are_rejected(self):
        xml = self.xml()
        xml['universe'] = xml['universe'].replace(b'5:250:1', b'1:2:8')
        with self.assertRaises(ValueError):
            updater.parse_snapshot({'number': 182, 'name': 'Dione'}, xml)


if __name__ == '__main__':
    unittest.main()
